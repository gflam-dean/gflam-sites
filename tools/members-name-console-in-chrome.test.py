#!/usr/bin/env python3
"""THE MEMBERS CONSOLE SAYS "Mia Wilson", NOT "Wilson,Mia" (INBOX 426 item 2, 16 Nov 2026).

The real-night run of 16 Nov found the Pay step of the members draw console saying "Wilson,Mia won $200." (the name as the members list
stores it) while the TV said MIA WILSON. tools/test-members-console.js runs the shipped renderDone() on its own; this plays it on the real
page: the real members console and the real TV on the browser rig, a members list with one member stored "Wilson,Mia", a draw, the winner
card, "They're here, pay", and the Pay step.

SINCE FRIDAY 20 NOV (live, Jobs row 445, d15ca119f) the Worker reads a one-box "Wilson,Mia" as surname, first name, and names the
winner in the venue's own format: "Mia W" by default (abbrev_last), "Mia Wilson" when the venue picked the full name
(worker/one-trip-draws.test.js: "Lee,Daniel" is Daniel L, D Lee, Daniel Lee). The TV is sent that same name. So this suite checks
the console agrees with the venue's setting, and keeps one scene where the stored "Wilson,Mia" still reaches the console: a pick
drawn before that fix and picked back up within its 30 minutes (the Worker hands back the stored winner_name as it was written).
That is the only path the console's own niceName() still guards, and prove-checks breaks it. The suite said "Mia Wilson" for a
default venue until the Sunday 22 Nov gate (21 Nov), which was the pre-Friday Worker leaving "Wilson,Mia" whole.

At a phone (390x844, 375x667), for each scene (default setting / full-name setting / a stored pick picked back up) it checks:

  1. the winner card on the console says the expected name (Mia W / Mia Wilson / Mia Wilson)
  2. the Pay step (the outcome box after the claim) says "<that name> won $200." and never "Wilson,Mia"
  3. nothing on the console's whole page prints "Wilson,Mia" or "Wilson, Mia" at that point
  VP_SHOTS=<dir> keeps the console at each step.

    python3 tools/members-name-console-in-chrome.test.py
"""
import json, os, re, sys, time
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
sys.path.insert(0, os.path.join(ROOT, 'tools', 'browser-rig'))
import rig  # noqa: E402
import gatelib  # noqa: E402

SHOTS = os.environ.get('VP_SHOTS', '')
if not SHOTS and os.path.isdir('/home/vp/venue-enrich/reports'):
    SHOTS = '/home/vp/venue-enrich/reports/members-name-shots'
if SHOTS: os.makedirs(SHOTS, exist_ok=True)
ran = bad = 0


def ok(name, cond, saw=''):
    global ran, bad
    ran += 1
    print(('  ok   ' if cond else '  FAIL ') + name + ('' if cond else '   saw: ' + str(saw)[:400]))
    sys.stdout.flush()
    if not cond: bad += 1


TAKEOVER = '(function(){var b=document.getElementById("vpTakeoverGo"); if(b){ b.click(); return true; } return false;})()'
ASKGO = '(function(){var b=document.getElementById("vpAskGo")||document.querySelector(".vp-ask button"); if(b){ b.click(); return true; } return false;})()'
ACCEPT = ('(function(){var b=[].slice.call(document.querySelectorAll("button")).filter(function(x){ return x.offsetParent!==null && '
          '/I understand|Accept|Start as a free/i.test(x.textContent); })[0]; if(b) b.click(); return !!b;})()')
BODY = 'document.body.innerText.replace(/\\s+/g," ")'


SCENES = {
    # scene: (what the console should say, what the scene is)
    'default': ('Mia W', "the venue's default name format (first name + last initial), as the TV is sent it"),
    'full': ('Mia Wilson', 'a venue that picked the full name'),
    'stored': ('Mia Wilson', 'a pick stored as "Wilson,Mia" before the Friday fix, picked back up'),
}


def run(w, h, tag, scene):
    want, what = SCENES[scene]
    tag = '%s-%s' % (tag, scene)
    print('\nconsole %dx%d, %s' % (w, h, what))
    R = rig.Rig(host_pages=('/app/members/host.html',))
    R.srv.handle_error = lambda request, client_address: None
    W = R.W
    def table(name):
        with W.lock:
            W.p.stdin.write(json.dumps({'table': name}) + '\n'); W.p.stdin.flush()
            return json.loads(W.p.stdout.readline())['body']
    def shot(sid, name):
        if SHOTS: time.sleep(0.6); R.shot(sid, os.path.join(SHOTS, '%s-%s.jpg' % (tag, name)))
    def dialogs(sid, rounds=3):
        for _ in range(rounds):
            time.sleep(0.8)
            if not (R.ask(sid, TAKEOVER) or R.ask(sid, ASKGO) or R.ask(sid, ACCEPT)): break
    try:
        W.ask('POST', '/host/gaming/declare', {'venue_id': W.info['venue'], 'format': 'members', 'state': 'QLD', 'category_claimed': 'test rig'}, {})
        W.seed('vp_venue_screen', [{'venue_id': W.info['venue'], 'slug': W.info['slug'], 'slides': [], 'logo_url': None}], replace=True)
        made = W.ask('POST', '/host/members/settings', {'venue_id': W.info['venue'], 'name': 'Thursday draw', 'current_jackpot_cents': 20000}, {})['body']
        did = (made.get('draw') or {}).get('id')
        imp = W.ask('POST', '/host/members/import', {'draw_id': did, 'members': [{'number': 107, 'name': 'Wilson,Mia'}]}, {})['body']
        ok('CONTROL: one member stored the way the members list stores it, "Wilson,Mia"', bool(did) and imp.get('added') == 1, (made, imp))
        if scene == 'full':
            W.seed('vp_venue_settings', [{'venue_id': W.info['venue'], 'name_display': 'full'}], replace=True)
        if scene == 'stored':
            mem = [m for m in table('vp_members') if str(m.get('member_number')) == '107']
            W.seed('vp_member_draw_results', [{'id': '00000000-0000-4000-8000-00000000a107', 'draw_id': did, 'outcome': 'drawn',
                                               'member_id': mem[0]['id'] if mem else None, 'member_number': 107, 'winner_name': 'Wilson,Mia',
                                               'amount_cents': 20000,
                                               'drawn_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(time.time() - 120))}])
            ok('CONTROL: a pick from before the fix waits, stored as "Wilson,Mia"', bool(mem), table('vp_member_draw_results'))
        for t in ('vp_member_draws', 'vp_member_rosters', 'vp_members'): R.db[t] = table(t)
        t_tv, tv = R.open('/tv?venue=' + W.info['slug'], width=1280, height=720)
        t_h, host = R.open('/app/members/host.html', width=w, height=h)
        ok('the console loads', R.until(host, '!!document.getElementById("drawBtn") && document.getElementById("drawBtn").offsetParent!==null', 60) is True, R.ask(host, BODY))
        R.until(host, '!!document.querySelector("#tvLine .tvline-btn")', 30); R.ask(host, 'var b=document.querySelector("#tvLine .tvline-btn"); if(b) b.click(); true')
        time.sleep(2)
        R.ask(host, 'setTimeout(function(){ document.getElementById("drawBtn").click(); }, 0); true')
        for _ in range(14):
            if R.ask(host, 'document.getElementById("winnerCard").classList.contains("show")') is True: break
            R.ask(host, ACCEPT); time.sleep(1.2)
        ok('the winner card is up', R.until(host, 'document.getElementById("winnerCard").classList.contains("show")', 40) is True, R.ask(host, BODY))
        wc = R.ask(host, 'document.getElementById("wcName").textContent')
        ok('1. the winner card says %s' % want, wc == want, wc)
        shot(host, '1-winner')
        R.ask(host, 'document.getElementById("claimBtn").click(); true'); dialogs(host)
        ok('the Pay step is up', R.until(host, '/won \\$/.test(document.getElementById("doneHead").textContent)', 30) is True, R.ask(host, 'document.getElementById("doneHead").textContent'))
        head = R.ask(host, 'document.getElementById("doneHead").textContent')
        ok('2. the Pay step says "%s won $200."' % want, head == want + ' won $200.', head)
        body = R.ask(host, BODY) or ''
        ok('3. nowhere on the console page does "Wilson,Mia" or "Wilson, Mia" show', not re.search(r'Wilson,\s*Mia', body), body[:300])
        shot(host, '2-pay-step')
        ok('no script errors', (R.ask(host, 'window.__errs.length') or 0) == 0, R.ask(host, 'JSON.stringify(window.__errs)'))
    finally:
        R.close()


if __name__ == '__main__':
    if not gatelib.hold_lock_or_refuse('members-name-console-in-chrome.test.py', wait_s=int(os.environ.get('VP_WAIT_LOCK', '0') or 0)):
        sys.exit(2)
    for sc in ('default', 'full', 'stored'):
        run(390, 844, 'con390', sc)
        run(375, 667, 'con375', sc)
    print('\nALL %d CHECKS PASSED' % ran if not bad else '\n%d OF %d CHECKS FAILED' % (bad, ran))
    sys.exit(1 if bad else 0)
