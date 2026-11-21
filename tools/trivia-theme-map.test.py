#!/usr/bin/env python3
"""A TRIVIA SET SERVES ONLY ITS OWN QUESTIONS (Jobs 525, real night 20 Nov 2026, The Mini Bar).

The library set "Music (1822)" asked about rock climbing, Butch Cassidy and a 1903 silent film. The game Worker draws
a round only from the set picked; the questions were in the wrong SET, put there by the theme map, which matched a
keyword anywhere inside a category's words ("band" in "bandits", "rock" in "rock climbers" and "rock formations").

This RUNS the one theme map (venueplay-backend/trivia_themes.py, used by seed-trivia.py and add-trivia.py) over every
fine category in venueplay-backend/data/trivia-library.json and checks:
  - the three categories go to History, Sport and Geography, never Music
  - every category the map puts in Music names music as a whole word (or starts with "music"), and none of them is
    about climbing, canyons, rock formations, robberies or bandits
  - the real music categories (Rock and heavy metal, Hip hop and rap, Musicals and the theatre, 2010s pop ...) stay
  - no category other than those three changes theme compared with the old keyword-anywhere rule
  - seed-trivia.py and add-trivia.py both use this one map and carry no copy of their own
  - migration 227 moves exactly the categories the map moves, to the same sets, and only library sets

No network, no database.   python3 tools/trivia-theme-map.test.py
"""
import collections, importlib.util, json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BK = os.path.join(ROOT, 'venueplay-backend')
ran = bad = 0


def ok(name, cond, extra=''):
    global ran, bad
    ran += 1
    if cond:
        print('  ok   ' + name)
    else:
        bad += 1
        print('  FAIL ' + name + (('   saw: ' + str(extra)[:400]) if extra != '' else ''))


spec = importlib.util.spec_from_file_location('trivia_themes', os.path.join(BK, 'trivia_themes.py'))
T = importlib.util.module_from_spec(spec)
spec.loader.exec_module(T)

# the OLD rule, for the "nothing else moved" check: a keyword anywhere in the padded category
def old_theme(cat):
    c = ' ' + (cat or '').lower() + ' '
    for t, kws in T.THEME_RULES:
        for k in kws:
            if k in c:
                return t
    return 'General Knowledge'


LIB = json.load(open(os.path.join(BK, 'data', 'trivia-library.json'), encoding='utf-8'))['questions']
CATS = collections.Counter(q.get('category') for q in LIB)

print('the three categories that were in Music')
WANT = {'Famous train robberies and bandits': 'History', 'Famous rock climbers and cliffs': 'Sport',
        'Famous canyons and rock formations': 'Geography'}
for cat, th in WANT.items():
    ok('"%s" goes to %s, not Music (%d questions)' % (cat, th, CATS.get(cat, 0)), T.theme(cat) == th and CATS.get(cat, 0) > 0, T.theme(cat))
ok('and the old rule really did put them in Music (this test can see the fault)', all(old_theme(c) == 'Music' for c in WANT), [old_theme(c) for c in WANT])
ok('a bandits category the map has never seen does not go to Music either', T.theme('Bandits of the old west') != 'Music', T.theme('Bandits of the old west'))

print('every category in the Music set is about music')
MUSIC_WORD = re.compile(r'(?<![a-z])(music\w*|songs?|bands?|albums?|singers?|rock|pop|hip hop|jazz|opera|mtv|eurovision|lyrics?|musicians?|instruments?|choirs?|dj)(?![a-z])', re.I)
NOT_MUSIC = re.compile(r'climb|canyon|formation|robber|bandit|cliff', re.I)
in_music = [c for c in CATS if T.theme(c) == 'Music']
ok('the Music set has categories (%d, %d questions)' % (len(in_music), sum(CATS[c] for c in in_music)), len(in_music) > 20)
ok('each names music as a whole word', all(MUSIC_WORD.search(c or '') for c in in_music), [c for c in in_music if not MUSIC_WORD.search(c or '')])
ok('none is about climbing, canyons, rock formations, robberies or bandits', not any(NOT_MUSIC.search(c or '') for c in in_music), [c for c in in_music if NOT_MUSIC.search(c or '')])
for keep in ('Rock and heavy metal', 'Hip hop and rap', 'Musicals and the theatre', '2010s pop', 'Bands and their members',
             'Famous rock guitarists and solos', 'lyrics', 'Famous jazz and blues singers'):
    ok('"%s" is still Music' % keep, T.theme(keep) == 'Music', T.theme(keep))

print('nothing else moved')
moved = sorted(c for c in CATS if T.theme(c) != old_theme(c))
ok('exactly those three categories change set, over the whole library', moved == sorted(WANT), moved)

print('one map, used by both scripts')
for f in ('seed-trivia.py', 'add-trivia.py'):
    src = open(os.path.join(BK, f), encoding='utf-8').read()
    ok(f + ' imports theme from trivia_themes', re.search(r'^from trivia_themes import [^\n]*\btheme\b', src, re.M) is not None)
    ok(f + ' carries no theme map of its own', 'THEME_RULES = [' not in src and 'def theme(' not in src)

print('migration 227 moves what the map moves')
MIG = open(os.path.join(BK, 'supabase', 'venueplay-227-music-set-own-questions.sql'), encoding='utf-8').read()
BODY = re.sub(r'--[^\n]*', '', MIG)   # the statements, not the comments
pairs = re.findall(r"set set_id = s_(\w+), seq = base \+ m\.rn\s+from \(select id, row_number\(\) over \(order by seq, id\) as rn from vp_questions\s+"
                   r"where set_id = s_music and lower\(btrim\(category\)\) = '([^']+)'\)", BODY)
SETVAR = {'history': 'History', 'sport': 'Sport', 'geo': 'Geography'}
ok('it moves three categories out of the Music set', len(pairs) == 3, pairs)
ok('the same three, each to the set the map names', sorted((cat, SETVAR.get(v)) for v, cat in pairs) == sorted((c.lower(), t) for c, t in WANT.items()), pairs)
ok('and the map names them the same way (CATEGORY_THEME)', T.CATEGORY_THEME == {c.lower(): t for c, t in WANT.items()}, T.CATEGORY_THEME)
for v in ('music', 'history', 'sport', 'geo'):
    m = re.search(r"select id into strict s_%s\s+from vp_question_sets where title = '([^']+)'\s+and visibility = 'library' and owner_venue_id is null and status = 'active';" % v, BODY)
    ok('s_%s is one active LIBRARY set found by title (strict: refuses none or two)' % v, m is not None and (v == 'music' and m.group(1) == 'Music' or SETVAR.get(v) == (m.group(1) if m else None)), m and m.group(0))
ok('it refuses while a round on the Music set is running', re.search(r"tg\.question_set_id = s_music and g\.status = 'running'\) then\s+raise exception", BODY) is not None)
ok('question_count moves by the number moved on all four sets', BODY.count('update vp_question_sets set question_count') == 4)
ok('it deletes nothing', not re.search(r'\bdelete\b|\btruncate\b|\bdrop\b', BODY, re.I))

if bad:
    print('%d FAILED, %d run' % (bad, ran))
    sys.exit(1)
print('ALL %d CHECKS PASSED' % ran)
