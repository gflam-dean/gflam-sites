#!/usr/bin/env python3
"""THE BINGO CONSOLE'S TICKETS CHOICE, FREE BINGO'S RULES, AND THE DRAW SETUP'S MAXIMUM JACKPOT,
IN THE REAL PAGES (state audit, 20 Oct 2026: C6, C9, C12).

  C6   The bingo console's "Tickets" choice (Free / Paid by the ticket / Paid by the sheet) shows
       only where HQ has unlocked paid entry for the venue, as the musical console's "Tonight"
       choice already does. Everywhere else the only outcome of picking Paid was a hard block.
  C9   A FREE bingo night shows its state's free-entry rules once a night in NSW, VIC, ACT and TAS,
       whose letters attach conditions to free bingo; elsewhere (QLD here) it stays silent.
  C12  Your account > Members draw asks the maximum jackpot the lawyer strongly recommends, fills it
       from the draw, and sends it to /host/members/settings only when it was typed (a blank typed
       box clears it). The game Worker's handling of that field is run by tools/test-jackpot-cap-15-oct.js.

Opens the REAL /app/ console and billing.html in headless Chrome (tools/browser-rig/admin_site.py).
The rig has no game Worker, so the draw save is caught at the page's own fetch and answered the way
the Worker answers (the saved draw).

    python3 tools/console-paid-and-draw-max-in-chrome.test.py
"""
import json, os, sys, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools', 'browser-rig'))
import admin_site  # noqa: E402

PASS, FAIL = [0], [0]


def ok(label, good, detail=''):
    if good:
        PASS[0] += 1
        print('  ok   %s%s' % (label, ('  (%s)' % (detail,)) if detail != '' else ''))
    else:
        FAIL[0] += 1
        print('  FAIL %s%s' % (label, ('  (%s)' % (detail,)) if detail != '' else ''))


W0 = admin_site.BillingWorker(ROOT)
INFO = W0.info
W0.close()
UID = INFO['uid']
V3 = '22222222-2222-4222-8222-222222222231'
BASE = {'status': 'active', 'suspended_reason': None, 'max_players': 80, 'included_players': None,
        'created_at': '2026-09-01T00:00:00Z', 'founding_id': 'f1', 'weekly_limit_off': False, 'permits': {},
        'venue_kind': None, 'compliance_accepted_at': '2026-10-16T00:00:00Z'}
VENUES = [
    dict(BASE, id=INFO['venue'], name='Deepwater Hotel', slug='deepwater-hotel', join_code='DPW123', au_state='NSW',
         postcode='2371', timezone='Australia/Sydney', entity_type='for_profit', paid_entry_enabled=False),
    dict(BASE, id=INFO['venue2'], name='Fitzroy Social', slug='fitzroy-social', join_code='FTZ456', au_state='VIC',
         postcode='3065', timezone='Australia/Melbourne', entity_type='non_profit', paid_entry_enabled=True),
    dict(BASE, id=V3, name='Tugun Bowls Club', slug='tugun-bowls', join_code='TUG789', au_state='QLD',
         postcode='4224', timezone='Australia/Brisbane', entity_type='non_profit', paid_entry_enabled=False),
]
DRAW = {'id': '44444444-4444-4444-8444-444444444441', 'venue_id': INFO['venue'], 'name': 'Friday Members Draw',
        'date_started': '2026-09-04', 'draw_day': 'Friday', 'draw_time': '7:30pm', 'time_to_claim_seconds': 120,
        'starting_amount_cents': 10000, 'increment_cents': 2000, 'current_jackpot_cents': 34000,
        'max_jackpot_cents': 120000, 'reserve_cents': 0, 'created_at': '2026-09-04T00:00:00Z'}
S = admin_site.Site(root=ROOT, extra_db={
    'vp_venues': VENUES,
    'vp_venue_staff': [{'auth_user_id': UID, 'venue_id': V3, 'role': 'owner', 'display_name': 'Olive Owner'}],
    'vp_member_draws': [DRAW]})


IDS = {v['name']: v['id'] for v in VENUES}


def console_for(name):
    # ?venue= names the venue for this console (vp-session.js): the remembered choice is shared by tabs.
    tid, sid = S.open('/app/?venue=' + IDS[name])
    S.until(sid, '!!document.querySelector(\'[data-game="bingo"]\') && document.querySelector(\'[data-game="bingo"]\').offsetParent!==null', 20)
    S.js(sid, 'document.querySelector(\'[data-game="bingo"]\').click(); true')
    S.until(sid, '!!document.getElementById("cardsSel") && document.getElementById("cardsSel").offsetParent!==null', 10)
    time.sleep(0.5)
    venue = S.js(sid, '(VP.getContext()||{}).venue && VP.getContext().venue.name')
    if venue != name:
        print('  (the console opened %r, not %r)' % (venue, name))
    return tid, sid


# The field's own display, not offsetParent: with no TV paired in this rig the console sits behind
# the pairing screen, but the setup it would show is what is judged.
TICKETS = 'JSON.stringify({ shown: getComputedStyle(document.getElementById("ticketsField")).display !== "none", value: document.getElementById("paidSel").value })'
try:
    # One venue at a time: the console remembers the current venue for the browser, so two tabs
    # on two venues would each read whichever was picked last.
    seen, rules = {}, {}
    for name in ('Deepwater Hotel', 'Tugun Bowls Club', 'Fitzroy Social'):
        tid, sid = console_for(name)
        t = json.loads(S.js(sid, TICKETS))
        t['opts'] = S.js(sid, 'Array.prototype.map.call(document.getElementById("paidSel").options, function(o){ return o.value; }).join(",")')
        seen[name] = t
        S.js(sid, 'try{ localStorage.removeItem("vpGamingAck"); Object.keys(localStorage).forEach(function(k){ if(/^vpg|ack/i.test(k)) localStorage.removeItem(k); }); }catch(e){} document.getElementById("prizeInput").value="Meat tray"; document.getElementById("startBtn").click(); true')
        S.until(sid, '!!document.querySelector(".vpg-wrap")', 4)
        rules[name] = S.js(sid, '(function(){ var w=document.querySelector(".vpg-wrap"); return w ? w.innerText : ""; })()') or ''
        rules[name + ':errs'] = S.js(sid, 'JSON.stringify(window.__errs||[])')
        S.close_tab(tid)
    print('C6: the Tickets choice only where paid entry is unlocked')
    ok('an NSW pub (paid entry off): no Tickets choice, the night is free', not seen['Deepwater Hotel']['shown'] and seen['Deepwater Hotel']['value'] == '', seen['Deepwater Hotel'])
    ok('a Queensland club (paid entry blocked): no Tickets choice', not seen['Tugun Bowls Club']['shown'], seen['Tugun Bowls Club'])
    ok('a Victorian club HQ unlocked: the Tickets choice is there, defaulting to free', seen['Fitzroy Social']['shown'] and seen['Fitzroy Social']['value'] == '', seen['Fitzroy Social'])
    ok('...with both paid options to pick from', seen['Fitzroy Social']['opts'] == ',card,sheet', seen['Fitzroy Social']['opts'])

    print('\nC9: a free bingo night shows the state\'s free-entry rules where a letter attaches conditions')
    ok('NSW free bingo: the popup shows the free lottery rules (no cash prizes, $30,000)', 'free lottery' in rules['Deepwater Hotel'] and '30,000' in rules['Deepwater Hotel'], rules['Deepwater Hotel'][:200])
    ok('VIC free bingo: the popup shows the s8.2.4A conditions', 's8.2.4A' in rules['Fitzroy Social'], rules['Fitzroy Social'][:200])
    ok('QLD free bingo: no popup, the night is recorded silently as before', rules['Tugun Bowls Club'] == '', rules['Tugun Bowls Club'][:200])
    ok('no script error on any console', all(rules[k + ':errs'] in ('[]', None) for k in ('Deepwater Hotel', 'Fitzroy Social', 'Tugun Bowls Club')),
       {k: rules[k + ':errs'] for k in ('Deepwater Hotel', 'Fitzroy Social', 'Tugun Bowls Club')})

    print('\nC12: Your account > Draws asks the maximum jackpot when a draw is edited')
    tid, sid = S.open('/app/billing.html?venue=' + IDS['Deepwater Hotel'])
    S.until(sid, 'document.getElementById("content").style.display!=="none" && !!document.querySelector(\'[data-tab="draws"]\')', 20)
    S.js(sid, '''(function(){ window.__sent=[]; var real=window.fetch; window.fetch=function(u,o){
        if(String(u).indexOf("/__game/host/members/settings")>=0){ var b=JSON.parse(o.body); window.__sent.push(b);
          var d=Object.assign({}, %s, b); if("max_jackpot_cents" in b) d.max_jackpot_cents=b.max_jackpot_cents;
          return Promise.resolve(new Response(JSON.stringify({ draw:d }), { status:200, headers:{ "Content-Type":"application/json" } })); }
        return real.apply(this, arguments); }; return true; })()''' % json.dumps(DRAW))
    S.js(sid, 'document.querySelector(\'[data-tab="draws"]\').click(); true')
    # Since 24 Oct 2026 every draw is listed with Edit and Remove: open this one with its own Edit.
    S.until(sid, '!!document.querySelector(\'#mdList .drow[data-draw="%s"] .dedit\')' % DRAW['id'], 15)
    S.js(sid, 'document.querySelector(\'#mdList .drow[data-draw="%s"] .dedit\').click(); true' % DRAW['id'])
    S.until(sid, 'document.getElementById("md-name").value==="Friday Members Draw"', 15)
    shown = S.js(sid, 'JSON.stringify({ vis: document.getElementById("md-max").offsetParent!==null, v: document.getElementById("md-max").value, label: document.querySelector(\'label[for="md-max"]\').textContent })')
    shown = json.loads(shown)
    ok('the setup shows "Maximum jackpot ($)", filled from the draw ($1,200)', shown['vis'] and shown['v'] == '1200' and shown['label'] == 'Maximum jackpot ($)', shown)
    S.js(sid, 'document.getElementById("mdSave").click(); true')
    S.until(sid, 'window.__sent.length===1', 10)
    sent = json.loads(S.js(sid, 'JSON.stringify(window.__sent)'))
    ok('a save that did not touch the box leaves the maximum alone (not in the request)', sent and 'max_jackpot_cents' not in sent[0], sent)
    S.js(sid, 'var m=document.getElementById("md-max"); m.value="1500"; m.dispatchEvent(new Event("input")); document.getElementById("mdSave").click(); true')
    S.until(sid, 'window.__sent.length===2', 10)
    sent = json.loads(S.js(sid, 'JSON.stringify(window.__sent)'))
    ok('typing $1,500 sends max_jackpot_cents 150000 to /host/members/settings', sent[1].get('max_jackpot_cents') == 150000, sent[1])
    S.until(sid, 'document.getElementById("md-max").value==="1500"', 5)
    S.js(sid, 'var m=document.getElementById("md-max"); m.value=""; m.dispatchEvent(new Event("input")); document.getElementById("mdSave").click(); true')
    S.until(sid, 'window.__sent.length===3', 10)
    sent = json.loads(S.js(sid, 'JSON.stringify(window.__sent)'))
    ok('clearing the box and saving sends null: no maximum', 'max_jackpot_cents' in sent[2] and sent[2]['max_jackpot_cents'] is None, sent[2])
    ok('no script error on Your account', S.js(sid, 'JSON.stringify(window.__errs||[])') == '[]', S.js(sid, 'JSON.stringify(window.__errs||[])'))
    S.close_tab(tid)
finally:
    S.close()

total = PASS[0] + FAIL[0]
print('')
print('%d of %d checks passed' % (PASS[0], total))
EXPECTED = 13
if total != EXPECTED:
    print('EXPECTED %d checks and ran %d.' % (EXPECTED, total))
    sys.exit(1)
sys.exit(1 if FAIL[0] else 0)
