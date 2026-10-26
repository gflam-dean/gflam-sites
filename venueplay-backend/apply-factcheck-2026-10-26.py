#!/usr/bin/env python3
"""Apply the 26 Oct 2026 fact-check to the live trivia bank.

Six independent checkers re-read all 1,700 questions loaded on 26 Oct. Nothing was wrong; 15 were
reworded, had a second defensible answer, or carried a joke option next to a religious figure, and
one near-duplicate is taken out of play. A fixed question is rewritten IN PLACE (an UPDATE keeps its
id, so game history stays valid) and stamped improved_at; the duplicate gets parked_at. Nothing is
deleted.

Each live row is found by its exact question text and must still hold the original options, or it
is skipped and reported. Dry run by default.

    SUPABASE_URL=... SUPABASE_SERVICE_KEY=... python3 apply-factcheck-2026-10-26.py        # show
    SUPABASE_URL=... SUPABASE_SERVICE_KEY=... python3 apply-factcheck-2026-10-26.py --go   # write
"""
import datetime, glob, json, os, sys, urllib.parse, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
FC = os.path.join(HERE, 'data', 'factcheck')
URL = os.environ.get('SUPABASE_URL', '').rstrip('/'); KEY = os.environ.get('SUPABASE_SERVICE_KEY', '')
GO = '--go' in sys.argv
if not URL or not KEY:
    sys.exit('set SUPABASE_URL and SUPABASE_SERVICE_KEY')

orig = {}
for f in glob.glob(os.path.join(HERE, 'data', 'generated', 'loaded', '2026-10-26-*.json')):
    for q in json.load(open(f)):
        orig[q['question']] = (f, q)

flags = []
for f in sorted(glob.glob(os.path.join(FC, 'fc-*.json'))):
    flags += json.load(open(f))

def req(method, path, body=None):
    r = urllib.request.Request(URL + '/rest/v1/' + path, method=method,
                               data=json.dumps(body).encode() if body is not None else None)
    r.add_header('apikey', KEY); r.add_header('Authorization', 'Bearer ' + KEY)
    r.add_header('Content-Type', 'application/json')
    if method != 'GET':
        r.add_header('Prefer', 'return=minimal')
    with urllib.request.urlopen(r, timeout=60) as resp:
        t = resp.read().decode()
        return json.loads(t) if t else None

def valid(q, opts, ci):
    return (q.endswith('?') and len(opts) == 4 and len(set(o.strip().lower() for o in opts)) == 4
            and 0 <= ci <= 3 and not any(c in q + ''.join(opts) for c in '—–'))

now = datetime.datetime.utcnow().isoformat() + 'Z'
done = skipped = 0
for x in flags:
    text = x['question']
    if text not in orig:
        print('SKIP not in the loaded files:', text[:80]); skipped += 1; continue
    f, o = orig[text]
    rows = req('GET', 'vp_questions?select=id,options,correct_index,parked_at&question=eq.' + urllib.parse.quote(text, safe=''))
    # add-trivia.py shuffles the options on load, so match the SET of options and the right answer's text
    want = o['options'][o['correctIndex']].strip()
    rows = [r for r in rows if sorted(r['options']) == sorted(o['options']) and r['options'][r['correct_index']].strip() == want]
    if len(rows) != 1:
        print('SKIP %d live rows match:' % len(rows), text[:80]); skipped += 1; continue
    rid = rows[0]['id']
    fix = x.get('fix')
    if fix is None and 'swap' not in x:
        change = {'parked_at': now}
        what = 'PARK'
    else:
        if 'swap' in x:
            q, opts, ci = text, [x['swap'][1] if v == x['swap'][0] else v for v in rows[0]['options']], rows[0]['correct_index']
        else:
            q = fix['question']
            if fix.get('keep_options') or 'options' not in fix:
                opts, ci = list(rows[0]['options']), rows[0]['correct_index']
            else:
                opts, ci = fix['options'], fix['correctIndex']
        if not valid(q, opts, ci):
            print('SKIP fix fails house style:', text[:80]); skipped += 1; continue
        if opts[ci].strip() != want:
            print('NOTE answer text changes: %r -> %r' % (want, opts[ci]))
        change = {'question': q, 'options': opts, 'correct_index': ci, 'improved_at': now}
        what = 'FIX '
    print('%s %s\n     %s' % (what, text[:90], '' if what == 'PARK' else '-> ' + change['question'][:90] + ' | ' + ' / '.join(('*' if i == change['correct_index'] else '') + v for i, v in enumerate(change['options']))))
    if GO:
        req('PATCH', 'vp_questions?id=eq.' + rid, change)
    done += 1
print('\n%d %s, %d skipped.%s' % (done, 'applied' if GO else 'ready', skipped, '' if GO else ' Dry run: add --go to write.'))
