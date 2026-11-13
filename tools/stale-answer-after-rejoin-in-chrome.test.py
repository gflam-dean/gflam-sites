#!/usr/bin/env python3
"""A LATE ANSWER FOR A TOKEN THE PHONE NO LONGER HOLDS IS IGNORED, NOT ACTED ON (13 Nov 2026).

The one-phone race (reports/one-phone-race-13nov): a phone that arrives holding last game's token asks for its card with
that token AND checks its night. When the night check wins, the page re-joins and holds a NEW token; then the card answer
for the OLD token lands: "stale" (or a 401). The page used to act on it: drop the good new token and join a second time.
Harmless on the live database (same row, a rotated token) but wasteful, and it made one-phone-a-night-in-chrome flake under
load. A page now acts on an answer only for the token it still holds.

This is the race with the timing taken out. The test holds the old token's /player/ answer in the page, lets the re-join
finish, and only THEN lets the late answer land (as "stale" for the musical card, and as a 401 on the musical phone;
the trivia phone's identical guards are read in its source), so the order is the same on every machine:

  the phone arrives with a saved name, an old token and an old (finished) night; it asks with the old token (held)
  the night check runs, the phone re-joins ONCE and holds a new token
  the late answer lands -> no second /join, the new token is still the one held and saved, the Worker has ONE row for the
  phone in the live night and the new token works on it

One phone, one player throughout. VP_SHOTS is not used. Takes /tmp/vp-heavy.lock first (VP_WAIT_LOCK seconds to wait).

    python3 tools/stale-answer-after-rejoin-in-chrome.test.py
"""
import json, os, sys, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
sys.path.insert(0, os.path.join(ROOT, 'tools', 'browser-rig'))
import rig  # noqa: E402

ran = bad = 0
def ok(name, cond, saw=''):
    global ran, bad
    ran += 1
    print(('  ok   ' if cond else '  FAIL ') + name + ('' if cond else '   saw: ' + str(saw)[:500]))
    sys.stdout.flush()
    if not cond: bad += 1

OLD = 'oldtoken' + '0' * 56
SOLD = '57a1e000-0000-4000-8000-000000000001'
SNEW = '57a1e000-0000-4000-8000-000000000002'
R = None
def js(sid, expr, wait=8): return R.ask(sid, expr, wait)
def table(name):
    W = R.W
    with W.lock:
        W.p.stdin.write(json.dumps({'table': name}) + '\n'); W.p.stdin.flush()
        return json.loads(W.p.stdout.readline())['body']

# THE PHONE ARRIVES WITH LAST GAME'S IDENTITY in storage, and the page's answers for the OLD token are held until the test lets them go.
# `kind` is how the late answer lands: 'stale' (the Worker's {stale:true} for a token of a finished night) or '401'.
# The night check (/snapshot of the old night) is held until the old-token ask is out, so the ask is always in flight first.
def BEFORE(prefix, room, pid, kind):
    return r'''(function(){
  var OLD=%s, ROOM=%s, PID=%s, KIND=%s, PFX=%s;
  try{ localStorage.setItem("vpDeviceId", PID); localStorage.setItem(PFX+"pid-"+ROOM, PID); localStorage.setItem(PFX+"name-"+ROOM, "Ann");
       localStorage.setItem(PFX+"token-"+ROOM, OLD); localStorage.setItem(PFX+"sess-"+ROOM, %s); }catch(e){}
  window.__joins=0; window.__heldOld=[]; window.__oldPaths=[]; window.__snapHeld=[]; window.__lateSent=false;
  var f=window.fetch;
  window.fetch=function(u,o){
    var url=String(u), path=url.split("?")[0], h=(o&&o.headers)||{}, tok=h["X-Player-Token"]||"";
    if(/\/join$/.test(path)) window.__joins++;
    if(tok===OLD && /\/player\//.test(path)){
      window.__oldPaths.push(path.replace(/^.*\/\/[^\/]+/,""));
      return new Promise(function(res){ window.__heldOld.push(function(){ window.__lateSent=true;
        res(KIND==="401" ? new Response(JSON.stringify({error:"Invalid player token"}),{status:401,headers:{"Content-Type":"application/json"}})
                         : new Response(JSON.stringify({stale:true}),{status:200,headers:{"Content-Type":"application/json"}})); }); });
    }
    if(/\/snapshot$/.test(path) && url.indexOf(%s)>=0){
      var args=arguments, self=this;
      return new Promise(function(res){ window.__snapHeld.push(function(){ res(f.apply(self,args)); }); });
    }
    return f.apply(this,arguments);
  };
})();''' % (json.dumps(OLD), json.dumps(room), json.dumps(pid), json.dumps(kind), json.dumps(prefix), json.dumps(SOLD), json.dumps(SOLD))


def scene(label, page, prefix, kind, pid, name, token_key, lobby_fmt):
    W = R.W
    code = W.info['code']
    print('\n%s: the late %s answer for the old token lands AFTER the re-join' % (label, kind))
    tid, ph = R.open(page + '?room=' + code, before=BEFORE(prefix, code, pid, kind), width=390, height=844)
    saw = R.until(ph, 'window.__heldOld && window.__heldOld.length>=1', 40)
    ok('%s: the phone asks the Worker with its OLD token (that ask is held)' % label, saw is True, [js(ph, 'JSON.stringify(window.__oldPaths)'), js(ph, 'location.href')])
    if saw is not True:
        R.close_tab(tid); return
    # the old night's check goes now: the phone re-joins
    ok('%s: the old night is checked (held until now)' % label, R.until(ph, 'window.__snapHeld && window.__snapHeld.length>=1', 20) is True, js(ph, 'JSON.stringify(window.__oldPaths)'))
    js(ph, 'window.__snapHeld.forEach(function(g){ g(); }); true')
    key = '%s%s-%s' % (prefix, 'token', code)
    newtok = R.until(ph, '(function(){ var t=localStorage.getItem(%s)||""; return t && t!==%s ? t : false; })()' % (json.dumps(key), json.dumps(OLD)), 30)
    ok('%s: the phone re-joined and holds a NEW token' % label, bool(newtok), js(ph, 'localStorage.getItem(%s)' % json.dumps(key)))
    tok1 = js(ph, 'localStorage.getItem(%s)' % json.dumps(key))
    j1 = js(ph, 'window.__joins')
    ok('%s: exactly one /join so far' % label, j1 == 1, j1)
    # NOW the late answer for the old token lands.
    js(ph, 'window.__heldOld.forEach(function(g){ g(); }); true')
    time.sleep(2.5)   # the page's own reaction to it (a promise chain and a timer): nothing arrives to wait for when it does the right thing
    j2 = js(ph, 'window.__joins')
    tok2 = js(ph, 'localStorage.getItem(%s)' % json.dumps(key))
    ok('%s: the late answer was ignored: still ONE /join (no second join)' % label, j2 == 1, j2)
    ok('%s: and the good token is still the one saved (not dropped, not replaced)' % label, bool(tok1) and tok1 == tok2 and tok2 != OLD, [tok1, tok2])
    rows = [p for p in table('vp_players') if p.get('device_id') == pid]
    live = [p for p in rows if p.get('session_id') == SNEW]
    ok('%s: the Worker holds ONE row for the phone in the live night' % label, len(live) == 1, [(p.get('session_id'), p.get('display_name')) for p in rows])
    cs = R.W.ask('GET', '/player/card', {}, {'X-Player-Token': tok2}).get('status') if tok2 else None
    ok('%s: and the token the phone holds is known to the Worker' % label, cs in (200, 204) or cs == 200, cs)
    ok('%s: the page threw nothing' % label, js(ph, 'JSON.stringify(window.__errs||[])') in ('[]', None), js(ph, 'JSON.stringify(window.__errs||[])'))
    R.close_tab(tid)


def run():
    global R
    R = rig.Rig()
    W = R.W
    v, code = W.info['venue'], W.info['code']
    with W.lock:
        W.p.stdin.write(json.dumps({'now': int(time.time() * 1000)}) + '\n'); W.p.stdin.flush(); W.p.stdout.readline()
    W.ask('POST', '/host/gaming/declare', {'venue_id': v, 'format': 'bingo', 'state': 'QLD', 'category_claimed': 'test rig'}, {})
    def sessions(fmt):
        W.seed('vp_sessions', [{'id': SOLD, 'venue_id': v, 'join_code': code, 'status': 'finished', 'lobby_format': 'trivia', 'created_at': '2026-11-12T08:00:00Z'},
                               {'id': SNEW, 'venue_id': v, 'join_code': code, 'status': 'lobby', 'lobby_format': fmt,
                                'created_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}], replace=True)
        W.seed('vp_players', [], replace=True)
    sessions('musical_bingo')
    scene('musical (stale card)', '/app/musical/play.html', 'vp-m', 'stale', 'annphone0000000000000001', 'Ann', 'vp-mtoken-', 'musical_bingo')
    sessions('musical_bingo')
    scene('musical (401)', '/app/musical/play.html', 'vp-m', '401', 'bobphone0000000000000002', 'Ann', 'vp-mtoken-', 'musical_bingo')
    trivia_source()


def trivia_source():
    """THE TRIVIA PHONE HAS THE SAME GUARDS, READ AT THE SOURCE. Its old-token asks (/player/alive, /player/score, /player/answer) only go out
    while a question is on, which a one-phone scene cannot hold still without a whole quiz, so the guards are read where they are written:
    every asker passes the token it sent, deadToken drops only when that is still the token held, and the two other places that drop a
    token on an answer (the answers room's session_ok:false, a 403 'not in this game') compare first."""
    import re
    print('\ntrivia phone: the same guard, read in the page source')
    src = open(os.path.join(ROOT, 'venueplay', 'app', 'trivia', 'play.html'), encoding='utf-8').read()
    m = re.search(r'function deadToken\(e, path, sent\)\{(.*?)\n  \}', src, re.S)
    body = m.group(1) if m else ''
    ok('trivia: deadToken takes the token the ask went out with', m is not None, src[src.find('function deadToken'):][:120])
    ok('trivia: a 401 drops the token only while that token is still the one held', re.search(r'if\(P\.token===\(sent\|\|""\)\)\{ try\{ dropStaleJoin\(\)', body) is not None, body[:300])
    ok('trivia: playerPost and playerGet both pass the token they sent', len(re.findall(r'return deadToken\(e, path, sent\)', src)) == 2, len(re.findall(r'return deadToken\(e, path, sent\)', src)))
    ok('trivia: the answers room drops a token on session_ok:false only if it is still the one the ask was made with', 'P.token===sentTok){ AR.staleFor=game; dropStaleJoin();' in src, '')
    ok('trivia: a 403 "not in this game" for a token already replaced keeps the new token', 'if(!(sentTok && P.token && P.token!==sentTok)){ dropStaleJoin(); ready=rejoinNow(); }' in src, '')


def main():
    import gatelib
    if not gatelib.hold_lock_or_refuse('stale-answer-after-rejoin-in-chrome.test.py', wait_s=int(os.environ.get('VP_WAIT_LOCK', '0') or 0)):
        print('\n0 of 1 checks passed'); sys.exit(1)
    try:
        run()
    except Exception as e:
        import traceback; traceback.print_exc()
        ok('the scenes ran to the end', False, repr(e))
    finally:
        if R: R.close()
    print('')
    print(('%d FAILED, %d run' % (bad, ran)) if bad else ('ALL %d CHECKS PASSED' % ran))
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
