#!/usr/bin/env python3
"""TRIVIA BUILD-A-NIGHT: LIBRARY QUESTIONS ARE SWAPPED OR REMOVED, NEVER EDITED (Dean, 5 Nov 2026, item 45c).

Opens the REAL venueplay/app/trivia/builder.html (tools/browser-rig/admin_site.py: a stand-in supabase-js with one
saved night; the game Worker's /host/trivia/ routes answered from the page by a small stub that behaves like the real
ones: the list says which questions are the library's, swap replaces in place, update refuses a library question) in
headless Chrome at 1280 and as an iPhone (390), opens the night and checks:

  - a library question has a Swap button and a remove button and NO edit pencil; a question the host created has
    the pencil and the remove button and no Swap
  - each row says "Library" or "Your own"
  - "Create your own" is its own button on the RIGHT of the three, and "+ Write your own" is gone
  - tapping Swap calls /host/trivia/questions/swap with that question and the row shows the new question, same place
  - a tap on an edit control for a library question (even one forced into the page) is refused with a sentence and
    sends nothing; editing your own question still opens the form, filled in
  - nothing runs off the side of a phone, and the buttons are 44px tall

The server-side refusals are proved in venueplay-backend/worker/trivia-library-swap.test.js; this is the page.

    python3 tools/trivia-library-swap-in-chrome.test.py [--shots DIR] [--label after] [--root CHECKOUT] [--no-checks] [--no-lock]
"""
import argparse, json, os, sys, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
sys.path.insert(0, os.path.join(ROOT, 'tools', 'browser-rig'))
import gatelib  # noqa: E402
import admin_site  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument('--root', default=ROOT)
ap.add_argument('--shots')
ap.add_argument('--label', default='after')
ap.add_argument('--no-checks', action='store_true')
ap.add_argument('--no-lock', action='store_true', help='one-off screenshot render, no heavy lock')
A = ap.parse_args()
CHECK = not A.no_checks
PASS, FAIL = [0], [0]

if CHECK and not A.no_lock and not gatelib.hold_lock_or_refuse('trivia-library-swap-in-chrome.test.py', wait_s=int(os.environ.get('VP_WAIT_LOCK', '0') or 0)):
    print('REFUSED: another live Chrome run holds /tmp/vp-heavy.lock')
    sys.exit(3)


def ok(label, good, detail=''):
    if not CHECK:
        return
    if good:
        PASS[0] += 1
        print('  ok   %s' % label)
    else:
        FAIL[0] += 1
        print('  FAIL %s%s' % (label, ('  (%s)' % (str(detail)[:400],)) if detail != '' else ''))


NIGHT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
V1 = None
STUB = r'''
window.__calls = [];
window.__qs = [
  {id:"q1", seq:1, question:"What is the capital of France?", options:["Paris","Lyon","Nice","Lille"], correct_index:0, category:"Geography", difficulty:"easy", image_url:null, own:false},
  {id:"q2", seq:2, question:"Which pub on the Gold Coast has the longest bar?", options:["The Local","The Royal","The Tavern","The Club"], correct_index:1, category:"Local", difficulty:"medium", image_url:null, own:true},
  {id:"q3", seq:3, question:"What is the longest river in Africa?", options:["Nile","Congo","Niger","Zambezi"], correct_index:0, category:"Geography", difficulty:"hard", image_url:null, own:false}
];
var __f = window.fetch;
window.fetch = function(u, o){
  u = String(u);
  if (u.indexOf("/host/trivia/") < 0) return __f.apply(this, arguments);
  var body = {}; try { body = JSON.parse((o && o.body) || "{}"); } catch(e){}
  var path = u.slice(u.indexOf("/host/trivia/"));
  window.__calls.push({ path: path.split("?")[0], body: body });
  function reply(obj, status){ return Promise.resolve(new Response(JSON.stringify(obj), { status: status || 200, headers: {"Content-Type":"application/json"} })); }
  if (path.indexOf("/host/trivia/set/questions") === 0) return reply({ questions: window.__qs });
  if (path.indexOf("/host/trivia/questions/swap") === 0) {
    for (var i = 0; i < window.__qs.length; i++) if (window.__qs[i].id === body.question_id) {
      var n = { id: body.question_id, seq: window.__qs[i].seq, question: "What is the capital of Spain?", options:["Madrid","Seville","Valencia","Bilbao"], correct_index:0, category: window.__qs[i].category, difficulty: window.__qs[i].difficulty, image_url:null, own:false };
      window.__qs[i] = n; return reply({ ok:true, question:n });
    }
    return reply({ error:"Question not found" }, 404);
  }
  if (path.indexOf("/host/trivia/questions/update") === 0) return reply({ error:"Library questions cannot be edited. Swap it for another library question, or create your own.", code:"library_question" }, 403);
  return reply({ ok:true });
};
'''
S = admin_site.Site(root=A.root, fonts=bool(A.shots), extra_db={'vp_question_sets': [
    {'id': NIGHT, 'title': 'Friday night', 'question_count': 3, 'visibility': 'private', 'owner_venue_id': None, 'status': 'active', 'created_at': '2026-11-01T00:00:00Z'},
    {'id': 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'title': 'Geography', 'question_count': 500, 'visibility': 'library', 'owner_venue_id': None, 'status': 'active', 'created_at': '2026-10-01T00:00:00Z'}]})
V1 = S.W.info['venue']
# the night belongs to this venue (set after V1 is known)
S.extra_db['vp_question_sets'][0]['owner_venue_id'] = V1


def js(sid, e):
    return S.js(sid, e)


def shot(sid, name):
    if A.shots:
        os.makedirs(A.shots, exist_ok=True)
        js(sid, 'var e=document.getElementById("step2"); if(e) e.scrollIntoView({block:"start"}); true')
        time.sleep(0.3)
        S.shot(sid, os.path.join(A.shots, '%s-%s.png' % (A.label, name)))


try:
    for wname, w, h, mobile in (('desktop', 1280, 1000, False), ('iphone', 390, 1400, True)):
        print('\nbuild-a-night questions at %s' % wname)
        tid, sid = S.open('/app/trivia/builder.html?venue=' + V1, w, h, mobile, pre=STUB)
        S.until(sid, 'document.querySelectorAll("#nightList .night").length > 0', 25)
        js(sid, 'document.querySelector("#nightList .night").click(); true')
        S.until(sid, 'document.querySelectorAll("#qList .qrow").length === 3', 15)
        time.sleep(0.5)
        shot(sid, 'questions-%s' % wname)
        rows = js(sid, '[].map.call(document.querySelectorAll("#qList .qrow"),function(r){return {id:r.getAttribute("data-qid"), edit:!!r.querySelector("button[data-ed]"), swap:!!r.querySelector("button[data-sw]"), rm:!!r.querySelector("button[data-rm]"), tag:(r.querySelector(".qtag")||{}).textContent||""};})') or []
        by = dict((r['id'], r) for r in rows)
        ok('%s: a library question has Swap and remove, and no edit pencil' % wname,
           all(by.get(i, {}).get('swap') and by[i]['rm'] and not by[i]['edit'] for i in ('q1', 'q3')), rows)
        ok('%s: a question you created has the pencil and remove, and no Swap' % wname,
           by.get('q2', {}).get('edit') and by['q2']['rm'] and not by['q2']['swap'], rows)
        ok('%s: each row says Library or Your own' % wname, [by[i]['tag'] for i in ('q1', 'q2', 'q3')] == ['Library', 'Your own', 'Library'], rows)
        btns = js(sid, '[].map.call(document.querySelectorAll("#step2 .addrow .btn"),function(b){var r=b.getBoundingClientRect(); return {t:b.textContent.trim(), l:Math.round(r.left), r:Math.round(r.right), top:Math.round(r.top), h:Math.round(r.height)};})') or []
        txt = [b['t'] for b in btns]
        ok('%s: the buttons are "+ From the library", "+ Search a topic" and "Create your own" (no "Write your own")' % wname,
           txt == ['+ From the library', '+ Search a topic', 'Create your own'], txt)
        if not mobile:
            ok('desktop: "Create your own" is on the right of the other two', len(btns) == 3 and btns[2]['l'] >= btns[1]['r'] and btns[0]['top'] == btns[2]['top'], btns)
        else:
            ok('iphone: the three buttons stack, each at least 44px tall', len(btns) == 3 and all(b['h'] >= 44 for b in btns), btns)
        js(sid, 'document.querySelector("#qList button[data-sw=q1]").click(); true')
        S.until(sid, '/capital of Spain/i.test(document.getElementById("qList").innerText)', 10)
        calls = js(sid, 'JSON.stringify(window.__calls.filter(function(c){return /swap/.test(c.path);}))')
        ok('%s: Swap calls /host/trivia/questions/swap for that question only' % wname, calls == '[{"path":"/host/trivia/questions/swap","body":{"question_id":"q1"}}]', calls)
        first = js(sid, 'document.querySelector("#qList .qrow .qt").textContent')
        ok('%s: the row now shows the new question, in the same place (first), with the same category' % wname, 'capital of Spain' in first and 'Geography' in first and 'easy' in first, first)
        ok('%s: and says so' % wname, 'Swapped' in (js(sid, 'document.getElementById("listStatus").textContent') or ''), js(sid, 'document.getElementById("listStatus").textContent'))
        shot(sid, 'questions-%s-after-swap' % wname)
        # a forced edit control on a library question
        js(sid, 'var b=document.createElement("button"); b.setAttribute("data-ed","q3"); b.id="forcedEdit"; document.getElementById("qList").appendChild(b); b.click(); true')
        time.sleep(0.3)
        ok('%s: a tap on an edit control for a library question is refused with a sentence and opens no form' % wname,
           'cannot be edited' in (js(sid, 'document.getElementById("listStatus").textContent') or '') and js(sid, 'document.getElementById("panelOwn").classList.contains("hidden")') is True)
        ok('%s: and nothing was sent to the server' % wname, js(sid, 'window.__calls.filter(function(c){return /update/.test(c.path);}).length') == 0)
        js(sid, 'document.querySelector("#qList button[data-ed=q2]").click(); true')
        time.sleep(0.4)
        form = js(sid, '[document.getElementById("panelOwn").classList.contains("hidden"), document.getElementById("ownQ").value, document.getElementById("addOwnBtn").textContent]')
        ok('%s: editing your own question still opens the form, filled in' % wname, form and form[0] is False and 'longest bar' in form[1] and form[2] == 'Save changes', form)
        shot(sid, 'edit-own-%s' % wname)
        ok('%s: nothing runs off the side' % wname, js(sid, 'document.documentElement.scrollWidth <= window.innerWidth + 1') is True, js(sid, '[document.documentElement.scrollWidth, window.innerWidth]'))
        sizes = js(sid, '[].map.call(document.querySelectorAll("#qList .qrow button.qs, #qList .qrow button.qx, #qList .qrow button.qe"),function(b){var r=b.getBoundingClientRect(); return Math.round(r.height);})') or []
        ok('%s: Swap, remove and edit are 44px tall to tap' % wname, sizes and all(x >= 44 for x in sizes), sizes)
        errs = js(sid, 'JSON.stringify(window.__errs||[])')
        ok('%s: no script error' % wname, errs in ('[]', None), errs)
        S.close_tab(tid)
finally:
    S.close()

if CHECK:
    total = PASS[0] + FAIL[0]
    print('')
    print('%d of %d checks passed' % (PASS[0], total))
    EXPECTED = 28
    if total != EXPECTED:
        print('EXPECTED %d checks and ran %d.' % (EXPECTED, total))
        sys.exit(1)
    sys.exit(1 if FAIL[0] else 0)
print('shots written to %s' % A.shots)
