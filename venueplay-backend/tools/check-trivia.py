#!/usr/bin/env python3
"""Is the trivia bank sound?

Run this before adding questions and after, because a bad batch is invisible
until a room of people is looking at it on a wall.

  python3 tools/check-trivia.py                    the whole library
  python3 tools/check-trivia.py new-batch.json     a batch before you add it

What it looks for, and why each one matters on the night:

  no options / not four        the screen has four slots
  correctIndex out of range    nobody can be right
  answer disagrees with the
    option at correctIndex     the two schemas in this file both exist, and a
                               row carrying both must agree or the score is wrong
  duplicate options            two identical buttons, one of them "correct"
  the same question twice      it comes round again in the same night
  answer-position bias         if the correct answer is usually B, regulars
                               notice, and a round that is 60% B feels rigged

Two schemas live in the library on purpose: the imported questions carry an id,
an answer string, a licence and a source; the Australian originals carry only
what a question needs. The seeder uses neither the id nor the answer, so a row
without them is fine and is NOT reported.
"""
import collections, io, json, os, re, sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT = os.path.join(HERE, 'data', 'trivia-library.json')

def load(path):
    d = json.load(io.open(path, encoding='utf-8'))
    return d if isinstance(d, list) else d.get('questions', d)

def main():
    path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT
    if not os.path.isfile(path):
        sys.exit('no such file: ' + path)
    qs = load(path)
    print('  %s' % path)
    print('  %d questions\n' % len(qs))

    faults = collections.OrderedDict()
    def flag(k, q, why=''):
        faults.setdefault(k, []).append((str(q.get('question', ''))[:60], why))

    seen = {}
    for q in qs:
        opts = q.get('options') or []
        ci = q.get('correctIndex')
        ans = q.get('answer')

        if not str(q.get('question', '')).strip():
            flag('no question text', q)
        if len(opts) != 4:
            flag('not four options', q, '%d' % len(opts))
        if not isinstance(ci, int) or ci < 0 or ci >= len(opts):
            flag('nobody can be right: correctIndex is out of range', q,
                 'index %r of %d options' % (ci, len(opts)))
        elif ans is not None and str(opts[ci]).strip() != str(ans).strip():
            flag('the answer and the option at correctIndex disagree', q,
                 '%r vs %r' % (str(ans)[:24], str(opts[ci])[:24]))
        if len(set(str(o).strip().lower() for o in opts)) != len(opts):
            flag('two identical options', q)
        if any(not str(o).strip() for o in opts):
            flag('a blank option', q)

        key = re.sub(r'\W+', '', str(q.get('question', '')).lower())
        if key:
            if key in seen:
                flag('the same question twice', q)
            seen[key] = 1

    for k, rows in faults.items():
        print('  %s%-56s %d' % ('' , k, len(rows)))
        for text, why in rows[:3]:
            print('      %s' % text)
            if why:
                print('         %s' % why)
        if len(rows) > 3:
            print('      ... and %d more' % (len(rows) - 3))
        print()

    # Position bias. Only judged on the whole bank: a single small batch is
    # allowed to be lopsided, because the seeder reshuffles every row on ingest.
    c = collections.Counter(q.get('correctIndex') for q in qs)
    n = len(qs) or 1
    spread = ['%s %.1f%%' % ('ABCD'[i], 100.0 * c.get(i, 0) / n) for i in range(4)]
    worst = max(100.0 * c.get(i, 0) / n for i in range(4))
    biased = worst > 32 and n >= 400
    print('  where the correct answer sits:  %s' % '   '.join(spread))
    if biased:
        print('  %sLOPSIDED.%s A round out of this will feel rigged. add-trivia.py reshuffles'
              % ('', ''))
        print('  every row on ingest, so this usually means rows went in another way.')
    print()

    if faults or biased:
        print('  %d kind(s) of fault' % (len(faults) + (1 if biased else 0)))
        return 1
    print('  nothing wrong with any of them')
    return 0

if __name__ == '__main__':
    sys.exit(main())
