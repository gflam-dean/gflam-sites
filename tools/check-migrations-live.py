#!/usr/bin/env python3
"""EVERY DATABASE CHANGE IN A RELEASE IS ALREADY LIVE BEFORE THE CODE THAT NEEDS IT GOES OUT.

Dean runs migrations EARLY now (11 Nov 2026, INBOX 217): the SQL goes into the live database
first, and only then does the release that reads the new table or column get pushed. Until
today nothing checked the order. A migration file carries a "NOT RUN" comment when it is
written and nobody edits it when Dean runs it, so the file cannot say; only the database can.

So, for every venueplay-backend/supabase/venueplay-NNN-*.sql that this branch ADDS (it is in
`git diff --name-only --diff-filter=A <base>...HEAD`, or new and not yet committed) and that
origin/main does not have, this reads the SQL for what it creates and asks the LIVE database,
read-only, whether each thing is there:

  create table T (a, b, ...)      GET /rest/v1/T?select=a,b,...&limit=1
  create view V                   GET /rest/v1/V?select=*&limit=1
  alter table T add column C      GET /rest/v1/T?select=C&limit=1
  alter table T rename column x to C / rename to T2   the new name, the same way
  create function F (not a trigger function)   F is a path (/rpc/F) in the REST schema
                                               document (one GET of /rest/v1/, never a call)
  -- live-probe: <path>           a probe written into the migration by hand, for a change the
                                  lines above cannot see (a seed row, say): GET /rest/v1/<path>
                                  must answer 200 with at least one row. Never rpc/.

Only GETs, with the service key from ~/.gflam-migrate.env (NEW_SUPABASE_URL, NEW_SERVICE_KEY).
The key is read into memory and sent as a header; it is never printed, logged or written.

A missing table (PGRST205) or column (42703) is RED: "Migration NNN is not live yet: Dean runs
it first". An answer that is neither yes nor a clear no (no key, no network, a 500) is RED too,
because "could not ask" is not "it is there". A migration that only changes policies, indexes,
grants, constraints, triggers or rows, with no probe written into it, cannot be seen through
REST: it is printed as "cannot be probed (policy/index only)" (or "(data change only)") and is
not failed. A table outside the public schema is said the same way.

    python3 tools/check-migrations-live.py                  against origin/main
    python3 tools/check-migrations-live.py --base <sha>     against a named commit (release.py)
    python3 tools/check-migrations-live.py --plan           list what it would ask, ask nothing

Exit 0 green, 1 red. The last line is "N of N checks passed" (one check per new migration),
or "0 of 0 checks passed: no new migration" when there is nothing to ask. Its logic is proven
without a network by tools/migrations-live.test.py (a fake database).
"""
import io, json, os, re, subprocess, sys, urllib.error, urllib.parse, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MIG_RE = re.compile(r'^venueplay-backend/supabase/venueplay-(\d+)-[^/]*\.sql$')
ENV_FILE = os.path.expanduser('~/.gflam-migrate.env')

NOT_COLUMNS = {'constraint', 'primary', 'unique', 'foreign', 'check', 'exclude', 'like'}
# Statements REST has no window onto. Seen in a migration with nothing probeable, they make it
# "cannot be probed" instead of red.
SCHEMA_ONLY = [('policy', r'\b(create|alter|drop)\s+policy\b'),
               ('index', r'\b(create|drop)\s+(unique\s+)?index\b'),
               ('grant', r'\b(grant|revoke)\b'),
               ('constraint', r'\b(add|drop)\s+constraint\b'),
               ('row level security', r'\b(enable|disable|force)\s+row\s+level\s+security\b'),
               ('trigger', r'\b(create|drop)\s+(or\s+replace\s+)?(constraint\s+)?trigger\b'),
               ('comment', r'\bcomment\s+on\b')]
DATA_ONLY = [('update', r'\bupdate\s+[\w."]+\s+(\w+\s+)?set\b'),
             ('insert', r'\binsert\s+into\b'),
             ('delete', r'\bdelete\s+from\b')]


# ---------------------------------------------------------------- reading the SQL

def _strip(sql):
    """Comments out, and every quoted literal blanked, so a word inside a string or a comment is
    never read as a statement. Dollar-quoted bodies are KEPT: a DO $$ ... $$ block is where a
    careful migration puts its alter table (141, 174)."""
    out, i, n = [], 0, len(sql)
    while i < n:
        c = sql[i]
        if sql.startswith('--', i):
            j = sql.find('\n', i)
            i = n if j < 0 else j
            continue
        if sql.startswith('/*', i):
            j = sql.find('*/', i + 2)
            i = n if j < 0 else j + 2
            out.append(' ')
            continue
        if c == "'":
            j = i + 1
            while j < n:
                if sql[j] == "'" and j + 1 < n and sql[j + 1] == "'":
                    j += 2
                    continue
                if sql[j] == "'":
                    break
                j += 1
            out.append("''")
            i = j + 1
            continue
        out.append(c)
        i += 1
    return ''.join(out)


def _name(raw):
    """'public."vp_x"' -> ('public', 'vp_x'); 'vp_x' -> ('public', 'vp_x')."""
    parts = [p.strip().strip('"') for p in raw.strip().split('.')]
    if len(parts) == 1:
        return 'public', parts[0]
    return parts[-2].lower(), parts[-1]


def _bracketed(text, start):
    """The text inside the bracket that opens at text[start], to its matching close."""
    depth = 0
    for k in range(start, len(text)):
        if text[k] == '(':
            depth += 1
        elif text[k] == ')':
            depth -= 1
            if depth == 0:
                return text[start + 1:k]
    return text[start + 1:]


def _split_top(body):
    parts, depth, cur = [], 0, []
    for ch in body:
        if ch == '(':
            depth += 1
        elif ch == ')':
            depth -= 1
        if ch == ',' and depth == 0:
            parts.append(''.join(cur))
            cur = []
        else:
            cur.append(ch)
    parts.append(''.join(cur))
    return [p.strip() for p in parts if p.strip()]


IDENT = r'(?:"[^"]+"|[A-Za-z_][\w$]*)(?:\s*\.\s*(?:"[^"]+"|[A-Za-z_][\w$]*))?'


def parse(sql):
    """What a migration creates that the live database can be asked about.

    Returns {'tables': {name: [cols]}, 'views': [names], 'columns': [(table, col)],
             'functions': [names], 'probes': [paths], 'unseen': [what REST cannot see],
             'outside': [names not in public], 'kinds': [schema/data statement kinds seen]}"""
    probes = [m.group(1).strip() for m in re.finditer(r'^\s*--\s*live-probe:\s*(\S+)\s*$', sql, re.M | re.I)]
    s = _strip(sql)
    low = s.lower()
    out = {'tables': {}, 'views': [], 'columns': [], 'functions': [], 'probes': probes,
           'unseen': [], 'outside': [], 'kinds': []}

    for m in re.finditer(r'\bcreate\s+(?:unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?(' + IDENT + r')\s*\(', s, re.I):
        schema, name = _name(m.group(1))
        if schema != 'public':
            out['outside'].append('%s.%s' % (schema, name))
            continue
        cols = []
        for part in _split_top(_bracketed(s, m.end() - 1)):
            first = part.split()[0].strip('"') if part.split() else ''
            if first and first.lower() not in NOT_COLUMNS:
                cols.append(first)
        out['tables'][name] = cols

    for m in re.finditer(r'\bcreate\s+(?:or\s+replace\s+)?(?:materialized\s+)?view\s+(?:if\s+not\s+exists\s+)?(' + IDENT + r')', s, re.I):
        schema, name = _name(m.group(1))
        (out['views'] if schema == 'public' else out['outside']).append(name if schema == 'public' else '%s.%s' % (schema, name))

    for m in re.finditer(r'\balter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?(' + IDENT + r')(.*?);', s, re.I | re.S):
        schema, table = _name(m.group(1))
        body = m.group(2)
        if schema != 'public':
            if re.search(r'\badd\b|\brename\b', body, re.I):
                out['outside'].append('%s.%s' % (schema, table))
            continue
        for a in re.finditer(r'\badd\s+(?:column\s+)?(?:if\s+not\s+exists\s+)?("[^"]+"|[A-Za-z_][\w$]*)', body, re.I):
            col = a.group(1).strip('"')
            if col.lower() not in NOT_COLUMNS:
                out['columns'].append((table, col))
        for a in re.finditer(r'\brename\s+(?:column\s+)?("[^"]+"|[A-Za-z_][\w$]*)\s+to\s+("[^"]+"|[A-Za-z_][\w$]*)', body, re.I):
            out['columns'].append((table, a.group(2).strip('"')))
        for a in re.finditer(r'\brename\s+to\s+("[^"]+"|[A-Za-z_][\w$]*)', body, re.I):
            out['tables'].setdefault(a.group(1).strip('"'), [])

    for m in re.finditer(r'\bcreate\s+(?:or\s+replace\s+)?function\s+(' + IDENT + r')\s*\(', s, re.I):
        schema, name = _name(m.group(1))
        rest = low[m.end():m.end() + 4000]
        returns = re.search(r'\breturns\s+(setof\s+)?([\w."]+)', rest)
        if returns and returns.group(2).strip('"').endswith('trigger'):
            out['unseen'].append('trigger function %s (never in the REST schema)' % name)
        elif schema != 'public':
            out['outside'].append('%s.%s()' % (schema, name))
        else:
            out['functions'].append(name)

    for kind, pat in SCHEMA_ONLY + DATA_ONLY:
        if re.search(pat, low):
            out['kinds'].append(kind)
    # de-duplicate, keep order
    out['columns'] = list(dict.fromkeys(out['columns']))
    out['functions'] = list(dict.fromkeys(out['functions']))
    out['views'] = list(dict.fromkeys(out['views']))
    return out


def plan(parsed):
    """[(what, kind, path)]: kind 'rest' (a GET of /rest/v1/<path>), 'rows' (the same, must have a row)
    or 'rpc' (the name must be a /rpc/ path in the schema document). A column of a table this same
    migration creates is asked with the table, not twice."""
    asks = []
    for t, cols in parsed['tables'].items():
        sel = ','.join(cols) if cols else '*'
        asks.append(('table %s' % t, 'rest', '%s?select=%s&limit=1' % (t, urllib.parse.quote(sel, safe=',*_'))))
    for v in parsed['views']:
        asks.append(('view %s' % v, 'rest', '%s?select=*&limit=1' % v))
    for t, c in parsed['columns']:
        if t in parsed['tables'] and c in parsed['tables'][t]:
            continue
        asks.append(('column %s.%s' % (t, c), 'rest', '%s?select=%s&limit=1' % (t, c)))
    for f in parsed['functions']:
        asks.append(('function %s()' % f, 'rpc', f))
    for p in parsed['probes']:
        asks.append(('probe %s' % p, 'rows', p.lstrip('/')))
    return asks


# ---------------------------------------------------------------- which migrations are new

def new_migrations(root, base):
    """(sorted [(number, rel path)], error or ''). Added on this branch since base, plus new files
    not yet committed. A real checkout that git cannot answer is an error, never "none"."""
    def git(*a):
        return subprocess.run(['git', '-C', root] + list(a), capture_output=True, text=True)
    r = git('diff', '--name-only', '--diff-filter=A', '%s...HEAD' % base)
    if r.returncode != 0:
        return [], 'git could not compare with %s: %s' % (base, (r.stderr or '').strip()[:160])
    names = set(r.stdout.split())
    u = git('ls-files', '--others', '--exclude-standard', '--', 'venueplay-backend/supabase')
    s = git('diff', '--name-only', '--cached', '--diff-filter=A', 'HEAD', '--', 'venueplay-backend/supabase')
    if u.returncode != 0 or s.returncode != 0:
        return [], 'git could not list new files'
    names |= set(u.stdout.split()) | set(s.stdout.split())
    out = []
    for n in names:
        m = MIG_RE.match(n)
        if m and os.path.isfile(os.path.join(root, n)):
            out.append((int(m.group(1)), n))
    return sorted(out), ''


# ---------------------------------------------------------------- asking the live database

def read_env(path=ENV_FILE):
    env = {}
    try:
        for line in io.open(path, encoding='utf-8'):
            line = line.strip()
            if '=' in line and not line.startswith('#'):
                k, v = line.split('=', 1)
                env[k.strip()] = v.strip().strip('"').strip("'")
    except Exception:
        pass
    return env


def live_getter(env):
    """A function path -> (status, body bytes) that GETs /rest/v1/<path> with the service key, or
    None when the env file does not have both values. The key never leaves this closure."""
    base = (env.get('NEW_SUPABASE_URL') or '').rstrip('/')
    key = env.get('NEW_SERVICE_KEY') or ''
    if not base or not key:
        return None

    def get(path, accept='application/json'):
        req = urllib.request.Request(base + '/rest/v1/' + path, method='GET',
                                     headers={'apikey': key, 'Authorization': 'Bearer ' + key, 'Accept': accept})
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return r.status, r.read()
        except urllib.error.HTTPError as e:
            return e.code, e.read()
        except Exception as e:
            return 0, ('%s' % type(e).__name__).encode()
    return get


def _code(body):
    try:
        return str(json.loads(body).get('code') or '')
    except Exception:
        return ''


def ask(asks, get):
    """[(what, verdict, detail)], verdict 'live', 'missing' or 'unknown'."""
    res, schema = [], None
    for what, kind, path in asks:
        if kind == 'rpc':
            if schema is None:
                st, body = get('', 'application/openapi+json')
                try:
                    schema = set(json.loads(body).get('paths', {})) if st == 200 else ('HTTP %s' % st)
                except Exception:
                    schema = 'unreadable schema document'
            if isinstance(schema, str):
                res.append((what, 'unknown', schema))
            else:
                res.append((what, 'live' if '/rpc/' + path in schema else 'missing',
                            '' if '/rpc/' + path in schema else 'no /rpc/%s in the live schema' % path))
            continue
        if kind == 'rows' and (path.startswith('rpc/') or '/rpc/' in path):
            res.append((what, 'unknown', 'a live-probe may not call a function'))
            continue
        st, body = get(path)
        code = _code(body)
        if st == 200:
            if kind == 'rows':
                try:
                    rows = json.loads(body)
                except Exception:
                    rows = None
                if isinstance(rows, list) and rows:
                    res.append((what, 'live', ''))
                else:
                    res.append((what, 'missing', 'the probe found no row'))
            else:
                res.append((what, 'live', ''))
        elif code in ('PGRST205', '42P01', '42703', 'PGRST204') or (st == 404 and not code):
            res.append((what, 'missing', 'HTTP %s %s' % (st, code)))
        else:
            res.append((what, 'unknown', 'HTTP %s %s' % (st, code or (body or b'')[:60].decode('utf-8', 'replace'))))
    return res


def judge(root, migrations, get):
    """[(number, ok, line)]. Pure apart from get(): the unit test hands it a fake database."""
    out = []
    for num, rel in migrations:
        sql = io.open(os.path.join(root, rel), encoding='utf-8', errors='replace').read()
        p = parse(sql)
        asks = plan(p)
        side = []
        if p['outside']:
            side.append('%s cannot be probed (not in the public schema)' % ', '.join(p['outside'][:3]))
        if p['unseen']:
            side.append('; '.join(p['unseen'][:2]))
        if not asks:
            kinds = p['kinds']
            if kinds and not any(k for k, _ in DATA_ONLY if k in kinds):
                why = 'cannot be probed (policy/index only)'
            elif kinds and all(k in dict(DATA_ONLY) for k in kinds):
                why = 'cannot be probed (data change only: %s)' % ', '.join(kinds)
            else:
                why = 'cannot be probed (policy/index/data only: %s)' % (', '.join(kinds) or 'nothing REST can see')
            out.append((num, True, 'Migration %03d %s; not failed. Add a "-- live-probe: <table>?select=..." line '
                        'to it if it should be checked%s' % (num, why, ('; ' + '; '.join(side)) if side else '')))
            continue
        if get is None:
            out.append((num, False, 'Migration %03d cannot be checked: NEW_SUPABASE_URL and NEW_SERVICE_KEY are not '
                        'both in ~/.gflam-migrate.env, so nobody can say it is live' % num))
            continue
        res = ask(asks, get)
        missing = [w + (' (%s)' % d if d else '') for w, v, d in res if v == 'missing']
        unknown = [w + ' (%s)' % d for w, v, d in res if v == 'unknown']
        extra = ''
        if 'policy' in p['kinds'] or 'index' in p['kinds']:
            side.append('its policy/index changes cannot be probed')
        if side:
            extra = '; ' + '; '.join(side)
        if missing:
            out.append((num, False, 'Migration %03d is not live yet: Dean runs it first. Missing on the live database: %s%s'
                        % (num, ', '.join(missing[:5]), extra)))
        elif unknown:
            out.append((num, False, 'Migration %03d could not be confirmed live (the database did not answer yes or no): '
                        '%s. Dean runs it first, or fix the reading%s' % (num, ', '.join(unknown[:4]), extra)))
        else:
            out.append((num, True, 'Migration %03d is live: %s%s' % (num, ', '.join(w for w, _, _ in res)[:220], extra)))
    return out


def main(argv):
    base = 'origin/main'
    if '--base' in argv:
        i = argv.index('--base')
        base = argv[i + 1] if i + 1 < len(argv) else base
    migrations, err = new_migrations(ROOT, base)
    if err:
        print('FAIL  %s' % err)
        print('0 of 1 checks passed')
        return 1
    if not migrations:
        print('no migration in this release that %s does not already have' % base)
        print('0 of 0 checks passed: no new migration')
        return 0
    if '--plan' in argv:
        for num, rel in migrations:
            for what, kind, path in plan(parse(io.open(os.path.join(ROOT, rel), encoding='utf-8').read())):
                print('  %03d  %-40s %s %s' % (num, what, kind, path))
        return 0
    get = live_getter(read_env())
    rows = judge(ROOT, migrations, get)
    good = 0
    for num, okay, line in rows:
        good += okay
        print('%s  %s' % ('ok  ' if okay else 'FAIL', line))
    print('%d of %d checks passed' % (good, len(rows)))
    return 0 if good == len(rows) else 1


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
