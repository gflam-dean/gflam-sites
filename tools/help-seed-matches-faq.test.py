#!/usr/bin/env python3
"""THE PAGE TEST READS THE WORDS THE DATABASE WAS GIVEN (review of 19 Oct 2026).

help-desk-pages.test.py builds its stand-in Help panels from venueplay/data/help-faq.json and
partyplay/data/help-faq.json. Live phones do not read those files: they read vp_help_faq, which
migration 106 seeded. If the two ever disagreed, the page test would be checking words no phone
shows, which is the "suite reads the wrong file" fault this repo has paid for before.

So this reads the seed out of the migration itself (the SQL as committed, parsed by the same reader
gate check D54 uses, so a string with a line break in it is one string), and requires every
brand and audience to hold exactly the JSON's questions and answers, in the JSON's order.

Words Dean changes later in HQ live only in the database; they are his to change and no file in
the repo is meant to follow them. This guards the starting point, which is what the tests use.

Run from the repo root:  python3 tools/help-seed-matches-faq.test.py
"""
import importlib.util, json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
spec = importlib.util.spec_from_file_location('cmp', os.path.join(ROOT, 'tools', 'check-migrations-parse.py'))
cmp_ = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cmp_)

fails = ran = 0


def check(name, ok, saw=None):
    global fails, ran
    ran += 1
    print(('  ok   ' if ok else '  FAIL ') + name + ('' if ok or saw is None else '   saw: ' + json.dumps(saw)[:300]))
    if not ok:
        fails += 1


def values(stmt):
    """The literals inside VALUES ( ... ) of one INSERT: 'strings' (with '' inside), numbers, words."""
    i = stmt.lower().index('values') + len('values')
    i = stmt.index('(', i) + 1
    out, cur = [], ''
    while i < len(stmt):
        c = stmt[i]
        if c == "'":
            j, buf = i + 1, ''
            while True:
                if stmt[j] == "'" and j + 1 < len(stmt) and stmt[j + 1] == "'":
                    buf += "'"; j += 2; continue
                if stmt[j] == "'":
                    break
                buf += stmt[j]; j += 1
            out.append(buf); i = j + 1; cur = None
            continue
        if c in ',)':
            if cur is not None and cur.strip():
                out.append(cur.strip())
            cur = ''
            if c == ')':
                return out
        elif cur is not None:
            cur += c
        i += 1
    return out


mig = os.path.join(ROOT, 'venueplay-backend', 'supabase', 'venueplay-106-help-desk.sql')
stmts, fault = cmp_.scan(open(mig, encoding='utf-8').read())
check('migration 106 reads cleanly', fault is None, fault)
seed = {}
for _, body in stmts:
    if re.match(r'insert\s+into\s+public\.vp_help_faq\b', body, re.I):
        v = values(body)                       # id, brand, audience, position, question, answer
        seed.setdefault((v[1], v[2]), []).append((int(v[3]), v[4], v[5]))
vp = json.load(open(os.path.join(ROOT, 'venueplay', 'data', 'help-faq.json'), encoding='utf-8'))
pp = json.load(open(os.path.join(ROOT, 'partyplay', 'data', 'help-faq.json'), encoding='utf-8'))
want = {('venueplay', 'patron'): vp['patron']['items'], ('venueplay', 'venue'): vp['venue']['items'],
        ('partyplay', 'guest'): pp['guest']['items'], ('partyplay', 'host'): pp['host']['items']}
check('the seed holds the four sets the Help panels ask for, and no others', sorted(seed) == sorted(want), sorted(seed))
for key, items in want.items():
    got = [(q, a) for _, q, a in sorted(seed.get(key, []))]
    exp = [(it['q'], it['a']) for it in items]
    label = '%s %s' % key
    check(label + ': the same questions, in the same order', [g[0] for g in got] == [e[0] for e in exp], [g[0] for g in got])
    diff = [e[0] for g, e in zip(got, exp) if g[1] != e[1]]
    check(label + ': every answer word for word, line breaks included', not diff and len(got) == len(exp), diff)

print('')
print(('%d FAILED, %d run' % (fails, ran)) if fails else ('ALL %d CHECKS PASSED' % ran))
sys.exit(1 if fails else 0)
