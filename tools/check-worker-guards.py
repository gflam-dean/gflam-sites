#!/usr/bin/env python3
"""THE EDITS A CARELESS HAND MAKES TO A WORKER, AND A GREEN GATE LET THROUGH.

    python3 tools/check-worker-guards.py [--game FILE] [--api FILE]

The audit of 20 Sep 2026 applied five edits to a scratch copy, one at a time, and ran the whole
local gate after each. All five passed:

  1. a host route's staff check replaced by a constant, so any signed-in host could draw any
     venue's raffle
  2. the raffle pick swapped from the crypto generator to Math.random. It is still uniform, so
     the fairness test stayed green. It is also a licence matter under the OLGR RNG standard.
  3. the 300 second tolerance deleted from the Stripe signature check, so one captured
     invoice.paid replays for ever (tools/test-worker-guards.js RUNS that one)
  4. a paged read of vp_questions turned back into a single read: the first-1000-rows bug
  5. the absolute ceiling on a night's extra players raised tenfold

This is the static half. It is deliberately about SHAPE, which a static check can honestly
see: which function a route calls, and whether that function, or something it calls, makes the
two calls that matter. It follows calls because most handlers delegate, and it counts what it
looked at, because a route table it cannot parse would otherwise pass as "nothing wrong".
"""
import io, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
def arg(flag, default):
    return sys.argv[sys.argv.index(flag) + 1] if flag in sys.argv else os.path.join(ROOT, default)
GAME = arg('--game', 'venueplay-backend/worker/venueplay-game.js')
API = arg('--api', 'venueplay-backend/worker/venueplay-api-FULL.js')

bad = 0
def ok(what, good, detail=''):
    global bad
    print(('  ok   ' if good else '  FAIL ') + what + (('   ' + detail) if (detail and not good) else ''))
    if not good: bad += 1

def functions(src):
    pos = [(m.group(1), m.start()) for m in re.finditer(r"\n(?:async )?function (\w+)\s*\(", src)]
    return {name: src[p:(pos[k + 1][1] if k + 1 < len(pos) else len(src))] for k, (name, p) in enumerate(pos)}

def reaches(bodies, name, target, depth=3, seen=None):
    seen = seen if seen is not None else set()
    if name in seen or name not in bodies: return False
    seen.add(name)
    if re.search(target, bodies[name]): return True
    if depth == 0: return False
    return any(reaches(bodies, c, target, depth - 1, seen)
               for c in set(re.findall(r"\b(\w+)\s*\(", bodies[name])) & set(bodies) if c != name)

game = io.open(GAME, encoding='utf-8').read()
api = io.open(API, encoding='utf-8').read()
gb = functions(game)

print('every /host/ route proves who is asking AND that they work at that venue')
routes = re.findall(r"path === '(/host/[^']+)'[^\n]*?return (?:await )?(\w+)\(", game)
ok('the route table can be read at all (%d host routes)' % len(routes), len(routes) >= 30,
   'found %d: the route table has changed shape and this check is blind' % len(routes))
# A staff check is requireStaff, or one of the one-trip SQL functions that make the same check
# inside the database (migration 76 and friends).
STAFF = r"requireStaff\(|'vp_host_staff'|'vp_host_question'|'vp_host_reveal'|'vp_bingo_ball'|'vp_members_draw'"
for path, handler in routes:
    jwt = reaches(gb, handler, r"verifyHostJwt\(")
    staff = reaches(gb, handler, STAFF)
    ok('%s checks the login and the venue' % path, jwt and staff,
       '%s: %s%s' % (handler, '' if jwt else 'never verifies the host token. ', '' if staff else 'never checks they are staff at the venue.'))

print('the draws use the crypto generator, and nothing else')
ALLOWED = ["Date.now() + '-' + Math.random().toString(36)"]   # an upload's file name. Not a draw.
for label, src in (('game Worker', game), ('billing Worker', api)):
    lines = [l.strip() for l in src.splitlines() if 'Math.random' in l and not l.strip().startswith(('//', '*', '/*'))]
    stray = [l for l in lines if not any(a in l for a in ALLOWED)]
    ok('Math.random appears nowhere in the %s except an upload file name' % label, not stray, (stray[0][:110] if stray else ''))
ok('the raffle still picks with randInt over crypto.getRandomValues',
   'crypto.getRandomValues' in gb.get('randInt', '') + gb.get('cryptoInt', '') and re.search(r"min \+ randInt\(span\)", gb.get('handleHostDraw', '')) is not None,
   'handleHostDraw no longer picks with min + randInt(span), or randInt no longer reads crypto.getRandomValues')

print('numbers somebody chose, that should not move without somebody choosing again')
m = re.search(r"OVERAGE_ABSOLUTE_MAX\s*=\s*(\d+)", game + api)
ok('the ceiling on one night\'s extra players is still 500', bool(m) and m.group(1) == '500', 'it is %s' % (m.group(1) if m else 'missing'))
m = re.search(r"Math\.abs\(Math\.floor\(Date\.now\(\) / 1000\) - ts\) > (\d+)", api)
ok('a Stripe signature older than 300 seconds is refused', bool(m) and m.group(1) == '300', 'tolerance is %s' % (m.group(1) if m else 'GONE'))

print('tables that outgrow one read are read in pages')
# WHAT CAN OUTGROW 1,000 ROWS IN ONE READ, and what cannot. A library question set already has
# (General Knowledge was 1,158 on 20 Sep 2026), a members list does (clubs have thousands), and
# the opt-in export does. One session's players and one game's cards cannot: the player ceiling
# is far under it, and those reads sit on the join path where a second trip per read is the
# capacity wall. So this names the scope, not just the table: a read of one of these tables has
# to be ONE ROW by key, or carry a limit, or go through sbGetAll.
GROWS = {'vp_questions': r"(?<![a-z_])id=eq\.", 'vp_members': r"(?<![a-z_])id=eq\.|member_number=eq\.",
         'v_vp_player_optins': r"(?<![a-z_])id=eq\."}
offenders, looked = [], 0
for m in re.finditer(r"\bsbGet\(\s*env\s*,\s*'(\w+)'\s*,\s*([\s\S]{0,500}?)\);", game):
    table, q = m.group(1), m.group(2)
    if table not in GROWS: continue
    looked += 1
    line = game.count('\n', 0, m.start()) + 1
    if re.match(r"^\w+$", q.strip()):
        # The query is a variable built above. Read back to where it was built and look there.
        back = game[max(0, m.start() - 1500):m.start()]
        q = ' '.join(re.findall(r"\b" + re.escape(q.strip()) + r"\s*\+?=\s*([^\n]+)", back))
    if 'limit=' in q or re.search(GROWS[table], q): continue
    offenders.append('%s at line %d' % (table, line))
ok('the check can see the reads it is about (%d single reads of %s)' % (looked, ', '.join(sorted(GROWS))), looked >= 5,
   'found %d: the call shape has changed and this check is blind' % looked)
ok('every one of them is one row by key, or limited, or paged with sbGetAll', not offenders, 'unpaged: ' + ', '.join(offenders[:4]))

print()
print('FAILED: %d' % bad if bad else 'all worker guards in place')
sys.exit(1 if bad else 0)
