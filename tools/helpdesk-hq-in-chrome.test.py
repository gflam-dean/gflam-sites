#!/usr/bin/env python3
"""THE HQ HELP DESK, USED THE WAY DEAN USES IT, IN THE REAL PAGE, AGAINST THE REAL BILLING WORKER
(Dean, 29 Oct 2026: "helpdesk needs to be easier to use with templates we can use to reply and just
all round easier to use tbh").

Opens the REAL hq.html in headless Chrome (tools/browser-rig/admin_site.py), signed in as an HQ owner,
with the REAL venueplay-api-FULL.js answering every /admin/help/ request from a fake database holding
six test tickets (never a real one; nothing leaves this machine, and no email goes anywhere but the
rig's fake Resend, which this suite reads back). Then, at desk width and at phone width:

  The list     starts on Needs reply; each of Needs reply, Waiting on them, Closed and All shows its
               count; urgent first, then newest; the search finds a party code or an email; the brand
               filter is asked of the Worker; Report and Help words are out of the way
  A ticket     opens in place of the list (Back returns, the phone's Back too); the desk's own lines
               ("Opened by Dean") are one quiet grey line, not a box; who they are, a phone to tap,
               their venue and their other tickets sit beside it; Ticket details folded away
  Saved reply  BEFORE migration 126 (the table answers 404 as live did): the picker offers the built-in
               starter set, only the ones for that kind of customer, filled from the ticket: their first
               name, the venue, the venue's own TV address, the party code
  Send         "Send and close" sends ONE email (read back from the fake Resend, with the words in it)
               and closes the ticket in one tap; a plain Send leaves it waiting on them; the counts move
  Guards       the support line on a player's ticket is refused before anything is sent; so is a
               fill-in left in braces; an internal note is its own tab and never sent
  Manage       Saved replies says the migration is not run and shows the starters read-only; after it
               "runs" (the rig's table appears, seeded as the migration seeds), add, change, reorder and
               a two-tap delete each reach the database, and a new reply is offered in a ticket
  Phone        390 wide: no sideways scrolling anywhere, the ticket's buttons on screen and big enough to tap

    python3 tools/helpdesk-hq-in-chrome.test.py [--shots DIR]
"""
import argparse, json, os, sys, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools', 'browser-rig'))
import admin_site  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument('--shots')
A = ap.parse_args()
PASS, FAIL = [0], [0]


def ok(label, good, detail=''):
    if good:
        PASS[0] += 1
        print('  ok   %s' % label)
    else:
        FAIL[0] += 1
        print('  FAIL %s%s' % (label, ('  (%s)' % (str(detail)[:400],)) if detail != '' else ''))


S = admin_site.Site(fonts=bool(A.shots))
UID, V1, V2 = S.W.info['uid'], S.W.info['venue'], S.W.info['venue2']


def shot(sid, name, full=False):
    if A.shots:
        os.makedirs(A.shots, exist_ok=True)
        S.shot(sid, os.path.join(A.shots, name + '.png'), full=full)


def tk(n, **kw):
    base = {'id': '80000000-0000-4000-8000-%012d' % n, 'ticket_no': n, 'brand': 'venueplay', 'category': 'venue_support', 'channel': 'venue_form',
            'status': 'open', 'priority': 'normal', 'reply_token': 'tok%013d' % n, 'contact_typed': False, 'message': 'Test message %d.' % n}
    base.update(kw)
    base.setdefault('updated_at', base.get('created_at'))
    return base


TICKETS = [
    tk(1001, status='new', priority='urgent', venue_id=V1, subject='TV is blank', contact_name='Sam Smith', contact_email='sam@deepwater.example',
       contact_phone='0400 111 222', created_at='2026-10-28T08:00:00Z', message='The TV went blank in the middle of bingo.'),
    tk(1002, category='patron_support', channel='patron_form', venue_id=V1, subject="Can't join the game", contact_name='Jo',
       contact_email='jo@example.com', created_at='2026-10-28T09:00:00Z'),
    tk(1003, brand='partyplay', channel='patron_form', room_code='KFP7QX', subject='Guests stuck on the code', contact_name='Pat Lee',
       contact_email='pat@example.com', created_at='2026-10-28T10:00:00Z'),
    tk(1004, category='accounts', channel='email', status='waiting', subject='Invoice question', contact_name='Sam Smith',
       contact_email='Sam@Deepwater.example', created_at='2026-10-20T10:00:00Z', updated_at='2026-10-21T10:00:00Z'),
    tk(1005, category='sales', channel='web_form', status='closed', venue_id=V2, subject='Pricing question', contact_name='Rae',
       contact_email='rae@royalarms.example', created_at='2026-10-10T10:00:00Z', closed_at='2026-10-11T10:00:00Z'),
    tk(1006, subject='Logo looks blurry', venue_id=V2, contact_name='Rae', contact_email='rae@royalarms.example', created_at='2026-10-28T11:00:00Z'),
]
S.W.seed('vp_platform_admins', [{'auth_user_id': UID, 'role': 'owner', 'label': 'Dean'}])
S.W.seed('vp_help_tickets', TICKETS)
S.W.seed('vp_help_ticket_notes', [
    {'id': 'n1', 'ticket_id': TICKETS[3]['id'], 'kind': 'reply', 'body': 'Your invoice is on the Account page.', 'author': 'Dean (from accounts@venueplay.com.au to sam@deepwater.example)', 'created_at': '2026-10-21T10:00:00Z'}])
S.W.missing('vp_help_saved_replies', True)   # migration 126 not run, as on the live database today


def js(sid, e):
    return S.js(sid, e)


def text(sid, e):
    """A string from the page, or '' (never a thrown-error dict, which `in` and slicing choke on)."""
    v = S.js(sid, e)
    return v if isinstance(v, str) else ''


def click(sid, sel):
    return js(sid, '(function(){var b=document.querySelector(%s); if(!b) return false; b.click(); return true;})()' % json.dumps(sel))


def row_nos(sid):
    return js(sid, '[].map.call(document.querySelectorAll("#hdRows [data-id]"), function(r){return +r.querySelector(".no").textContent.slice(1);})') or []


def counts(sid):
    return js(sid, '(function(){var o={};[].forEach.call(document.querySelectorAll("#hdViews [data-n]"),function(e){o[e.getAttribute("data-n")]=+e.textContent;});return o;})()') or {}


def ticket(n):
    return [t for t in S.W.table('vp_help_tickets') if t['ticket_no'] == n][0]


def view(sid, v):
    click(sid, '#hdViews [data-view="%s"]' % v)
    time.sleep(0.2)


def open_no(sid, n):
    click(sid, '#hdRows [data-id="80000000-0000-4000-8000-%012d"]' % n)
    return S.until(sid, '!!document.getElementById("hdtReply") && /#%d/.test(document.getElementById("hdTicket").textContent)' % n, 10)


def back_to_list(sid):
    click(sid, '#hdBack')
    return S.until(sid, '!document.getElementById("hdListWrap").classList.contains("hidden")', 8)


def picker(sid):
    return js(sid, '[].slice.call(document.getElementById("hdtPick").options,1).map(function(o){return o.textContent;})') or []


def pick(sid, title):
    return js(sid, '(function(){var s=document.getElementById("hdtPick");var o=[].filter.call(s.options,function(x){return x.textContent===%s;})[0];'
                   'if(!o)return false;s.value=o.value;s.dispatchEvent(new Event("change"));return true;})()' % json.dumps(title))


def wait_list(sid):
    return S.until(sid, '!document.getElementById("hdListWrap").classList.contains("hidden") && document.querySelectorAll("#hdRows [data-id]").length > 0', 10)


def venue_details(sid, vid):
    """HQ > Venues, that venue's Details open (the venues table, not the help desk)."""
    click(sid, '#hqNav button[data-pane="venues"]')
    S.until(sid, '!!document.querySelector(\'[data-details="%s"]\')' % vid, 10)
    if not js(sid, '(function(){var d=document.querySelector(\'[data-vphd="%s"]\');return !!d&&!d.closest("tr").classList.contains("hidden");})()' % vid):
        click(sid, '[data-details="%s"]' % vid)


def venue_panel(sid, vid, need=1):
    S.until(sid, 'document.querySelectorAll(\'[data-vphd="%s"] [data-vphdno]\').length>=%d' % (vid, need), 10)
    return js(sid, '(function(){var d=document.querySelector(\'[data-vphd="%s"]\');if(!d)return null;'
                   'return {nos:[].map.call(d.querySelectorAll("[data-vphdno]"),function(b){return +b.getAttribute("data-vphdno");}),'
                   'rows:[].map.call(d.querySelectorAll("[data-vphdno]"),function(b){return [].map.call(b.children,function(c){return c.textContent;});}),text:d.innerText};})()' % vid)


SEED = None
LIGHT = ('(function(sel){ var bad=[]; [].forEach.call(document.querySelectorAll(sel), function(e){ if(!e.offsetParent) return;'
         ' var c=getComputedStyle(e).backgroundColor.match(/[0-9]+/g)||[255,255,255]; if (+c[0]+ +c[1]+ +c[2] > 200) bad.push(e.id||e.tagName); }); return bad; })')
try:
    tid, sid = S.open('/app/hq.html?as=admin', 1280, 1000)
    S.until(sid, '!!document.getElementById("hdTab")', 25)
    click(sid, '#hdTab')
    wait_list(sid)
    time.sleep(0.5)
    SEED = js(sid, 'window.VPHelpdeskReplies && window.VPHelpdeskReplies.SEED') or []
    print('\nThe list')
    c = counts(sid)
    ok('each status shows its count: 4 need a reply, 1 waiting on them, 1 closed, 6 in all', c == {'needs': 4, 'waiting': 1, 'closed': 1, 'all': 6}, c)
    # Looked at, 29 Oct 2026: the class was there but the selected chip's own rule painted the number pale grey on white.
    hot = js(sid, '(function(){var e=document.querySelector("[data-n=needs]"),s=getComputedStyle(e);return [e.parentNode.classList.contains("on"),s.backgroundColor,s.color];})()')
    ok('the Needs reply count is PAINTED red, white figures, while anything needs a reply (and its chip is the one selected)',
       hot == [True, 'rgb(229, 72, 77)', 'rgb(255, 255, 255)'], hot)
    ok('it opens on Needs reply: urgent first, then the newest (1001 urgent, then 1006, 1003, 1002)', row_nos(sid) == [1001, 1006, 1003, 1002], row_nos(sid))
    ok('the urgent ticket is marked down its edge', js(sid, 'document.querySelector("#hdRows [data-id$=\'001001\']").classList.contains("urg")') is True)
    ok('each row says who, where, the brand and the kind, in words', 'Sam Smith' in (js(sid, 'document.querySelector("#hdRows [data-id$=\'001001\']").innerText') or '')
       and 'Deepwater Hotel' in (js(sid, 'document.querySelector("#hdRows [data-id$=\'001001\']").innerText') or '')
       and 'Host support' in (js(sid, 'document.querySelector("#hdRows [data-id$=\'001003\']").innerText') or ''))
    ok('the Report and Help words sit in their own sections, out of the way', js(sid, 'document.getElementById("hdSecReport").classList.contains("hidden") && document.getElementById("hdSecWords").classList.contains("hidden") && !document.getElementById("hdSecTickets").classList.contains("hidden")') is True)
    ok('the rarer filters are folded under More filters', js(sid, 'document.getElementById("hdfMoreBox").classList.contains("hidden")') is True)
    light = js(sid, LIGHT + '("#paneHelpdesk input, #paneHelpdesk select, #paneHelpdesk textarea")')
    ok('the search and filters are HQ\'s dark fields', light == [], light)
    shot(sid, '01-list-desk')
    js(sid, 'var q=document.getElementById("hdfQ");q.value="kfp7";q.dispatchEvent(new Event("input"));true')
    ok('the search finds a party code', row_nos(sid) == [1003], row_nos(sid))
    view(sid, 'all')
    js(sid, 'var q=document.getElementById("hdfQ");q.value="SAM@deepwater";q.dispatchEvent(new Event("input"));true')
    ok('...and an email, any case, across statuses under All', sorted(row_nos(sid)) == [1001, 1004], row_nos(sid))
    js(sid, 'var q=document.getElementById("hdfQ");q.value="";q.dispatchEvent(new Event("input"));true')
    view(sid, 'waiting')
    ok('Waiting on them shows the one waiting', row_nos(sid) == [1004], row_nos(sid))
    view(sid, 'closed')
    ok('Closed shows the closed one', row_nos(sid) == [1005], row_nos(sid))
    view(sid, 'needs')
    n0 = len(S.W.calls)
    js(sid, 'var b=document.getElementById("hdfBrand");b.value="partyplay";b.dispatchEvent(new Event("change"));true')
    S.until(sid, 'document.querySelectorAll("#hdRows [data-id]").length===1', 8)
    asked = [b for p, b in S.W.calls[n0:] if p == '/admin/help/list']
    ok('picking a brand asks the Worker for that brand straight away (no Show button) and the list follows', asked and asked[-1].get('brand') == 'partyplay' and row_nos(sid) == [1003], [asked[-1:], row_nos(sid)])
    js(sid, 'var b=document.getElementById("hdfBrand");b.value="";b.dispatchEvent(new Event("change"));true')
    S.until(sid, 'document.querySelectorAll("#hdRows [data-id]").length===4', 8)

    print('\nA venue ticket, a saved reply, Send and close')
    ok('a tap on a row opens the ticket', open_no(sid, 1001))
    time.sleep(0.4)
    ok('it opens in place of the list, with Back to tickets', js(sid, 'document.getElementById("hdListWrap").classList.contains("hidden") && !!document.getElementById("hdBack")') is True)
    ok('the address bar says which ticket (a refresh or a shared link reopens it)', js(sid, 'location.hash') == '#help-1001')
    ok('opening it moved it from New to Needs reply in the database', ticket(1001)['status'] == 'open', ticket(1001)['status'])
    # Looked at, 29 Oct 2026: with nothing new, the tab still showed a red-and-white "0" (the badge's
    # display rule beat its hidden attribute), and so did Cancelled. Judge what is painted, not the attribute.
    PAINTED = '(function(e){return !!e && e.getBoundingClientRect().width > 0;})(%s)'
    gone = S.until(sid, '!' + PAINTED % 'document.getElementById("hdBadge")', 10)
    ok('nothing new left: the Help desk tab shows no badge at all, not a "0"', gone is True,
       js(sid, '[document.getElementById("hdBadge").hidden, document.getElementById("hdBadge").textContent]'))
    cx = js(sid, '(function(){var s=document.querySelector(\'#hqNav button[data-pane="cancelled"] .tabcount\');return s?[s.hidden,s.getBoundingClientRect().width]:null;})()')
    ok('...and a tab count of nought (Cancelled) is not painted either', cx == [True, 0], cx)
    q = js(sid, '(function(){var c=document.querySelector("#hdNotes .hdnote.change"),m=document.querySelector(".hdmsg");if(!c)return null;var a=getComputedStyle(c),b=getComputedStyle(m);'
                'return {text:c.textContent,bw:a.borderLeftWidth,bg:a.backgroundColor,fs:parseFloat(a.fontSize),mfs:parseFloat(b.fontSize),h:c.getBoundingClientRect().height};})()')
    ok('"Opened by Dean" is one quiet line: no box, no coloured edge, smaller than the message', bool(q) and 'Opened by Dean' in q['text'] and q['bw'] == '0px'
       and q['bg'] in ('rgba(0, 0, 0, 0)', 'transparent') and q['fs'] < q['mfs'] and q['h'] < 26, q)
    side = text(sid, 'document.querySelector(".hdside").innerText')
    ok('beside it: who, their email, a phone to tap, their venue', 'Sam Smith' in side and 'sam@deepwater.example' in side and 'Deepwater Hotel' in side
       and js(sid, '!!document.querySelector(".hdside a[href=\'tel:0400111222\']")') is True, side[:200])
    who = js(sid, '(function(){var w=document.querySelector(".hdside .hdwho"),b=w&&w.querySelector("b");if(!b)return null;var s=getComputedStyle(w);return {display:s.display,nameH:b.getBoundingClientRect().height,w:w.getBoundingClientRect().width};})()')
    ok('the Who card reads as lines of text, the name on one line (HQ\'s own .who is a flex row; this once split it into columns)',
       bool(who) and who['display'] == 'block' and who['nameH'] < 26 and who['w'] > 200, who)
    ok('...and their other tickets: #1004 by the same email in another case, #1002 at the same venue', '#1004' in side and 'Invoice question' in side and '#1002' in side, side)
    ok('the status, kind, priority, brand and who-has-it fields are folded into Ticket details', js(sid, '!document.querySelector(".hddet").open && !!document.querySelector(".hddet #hdtStatus")') is True)
    venue_titles = [r['title'] for r in SEED if r['audience'] in ('venue', 'any')]
    ok('the saved replies offered are the venue ones and the everyone ones, from the built-in set (migration 126 not run)', picker(sid) == venue_titles, picker(sid))
    ok('...the player and PartyPlay ones are not offered here', not any(t in picker(sid) for t in [r['title'] for r in SEED if r['audience'] in ('player', 'partyplay')]))
    pick(sid, 'TV not showing the game')
    txt = text(sid, 'document.getElementById("hdtReply").value')
    ok('picking one drops it into the reply box, filled in: "Hi Sam", the venue, and that venue\'s own TV address',
       txt.startswith('Hi Sam,') and 'the TV at Deepwater Hotel' in txt and 'venueplay.com.au/tv?deepwater-hotel' in txt and '{' not in txt, txt[:220])
    ok('the box keeps the focus, ready to change the words', js(sid, 'document.activeElement && document.activeElement.id') == 'hdtReply')
    fitb = js(sid, '(function(){var t=document.getElementById("hdtReply");return {h:t.clientHeight,s:t.scrollHeight};})()')
    ok('the reply box grows to show the whole saved reply, no scrolling inside it', bool(fitb) and fitb['h'] > 160 and fitb['s'] <= fitb['h'] + 4, fitb)
    js(sid, 'var t=document.getElementById("hdtReply");t.value=t.value.replace("Cheers,","PS: we can also log in remotely.\\n\\nCheers,");true')
    shot(sid, '02-ticket-desk', full=True)
    sent0 = len(S.W.sent())
    click(sid, '#hdtReplyClose')
    S.until(sid, '!document.getElementById("hdListWrap").classList.contains("hidden")', 10)
    time.sleep(0.4)
    mails = S.W.sent()[sent0:]
    ok('"Send and close" sent exactly one email, to Sam, with the edited words in it', len(mails) == 1 and mails[0]['to'] == ['sam@deepwater.example']
       and 'venueplay.com.au/tv?deepwater-hotel' in mails[0]['html'] and 'we can also log in remotely' in mails[0]['html'], [m.get('to') for m in mails])
    ok('...and closed the ticket, in one tap', ticket(1001)['status'] == 'closed' and bool(ticket(1001).get('closed_at')), ticket(1001)['status'])
    ok('back on the list, it says so, and 1001 has left Needs reply', 'ticket 1001 closed' in (js(sid, 'document.getElementById("hdDone").textContent') or '') and 1001 not in row_nos(sid), row_nos(sid))
    S.until(sid, 'document.querySelector("[data-n=needs]").textContent==="3"', 6)
    ok('the counts moved: 3 need a reply, 2 closed', counts(sid).get('needs') == 3 and counts(sid).get('closed') == 2, counts(sid))

    print('\nA player\'s ticket: the phone line stays out')
    open_no(sid, 1002)
    time.sleep(0.3)
    player_titles = [r['title'] for r in SEED if r['audience'] in ('player', 'any')]
    ok('a player\'s ticket is offered the player replies and the everyone ones only', picker(sid) == player_titles, picker(sid))
    ok('it says the support line cannot go in it', 'cannot go in it' in (js(sid, 'document.querySelector("#hdReplyBox .hdhint").textContent') or ''))
    sent0, calls0 = len(S.W.sent()), len(S.W.calls)
    js(sid, 'document.getElementById("hdtReply").value="Hi Jo, ring us on 07 5228 3667.";document.getElementById("hdtReplyGo").click();true')
    time.sleep(0.6)
    ok('typing the support line into a player\'s reply is refused on the page itself, before the Worker is asked, and nothing is sent',
       'venues only' in (js(sid, 'document.getElementById("hdtMsg").textContent') or '') and not [p for p, b in S.W.calls[calls0:] if p == '/admin/help/reply']
       and len(S.W.sent()) == sent0 and ticket(1002)['status'] == 'open')
    js(sid, 'document.getElementById("hdtReply").value="";true')
    pick(sid, "Player: can't join or game not showing")
    txt = text(sid, 'document.getElementById("hdtReply").value')
    ok('the player reply fills "Hi Jo"', txt.startswith('Hi Jo,') and '{' not in txt, txt[:80])
    click(sid, '#hdtReplyGo')
    S.until(sid, '!document.getElementById("hdListWrap").classList.contains("hidden")', 10)
    time.sleep(0.3)
    m = S.W.sent()[sent0:]
    ok('a plain Send sends it, and the ticket waits on them', len(m) == 1 and m[0]['to'] == ['jo@example.com'] and ticket(1002)['status'] == 'waiting', [ticket(1002)['status'], len(m)])
    ok('the list says it is now waiting on them', 'waiting on them' in (js(sid, 'document.getElementById("hdDone").textContent') or ''))

    print('\nA PartyPlay ticket: the party code, a stray fill-in, a note, close without replying')
    open_no(sid, 1003)
    time.sleep(0.3)
    ok('PartyPlay tickets are offered the PartyPlay replies', picker(sid) == [r['title'] for r in SEED if r['audience'] in ('partyplay', 'any')], picker(sid))
    pick(sid, "PartyPlay: guests can't join")
    txt = text(sid, 'document.getElementById("hdtReply").value')
    ok('it fills the party code and "Hi Pat"', 'the party code KFP7QX' in txt and txt.startswith('Hi Pat,'), txt[:200])
    sent0 = len(S.W.sent())
    calls0 = len(S.W.calls)
    js(sid, 'var t=document.getElementById("hdtReply");t.value+="\\nSee {tv_link}";t.dispatchEvent(new Event("input"));document.getElementById("hdtReplyGo").click();true')
    time.sleep(0.5)
    ok('a fill-in left in braces is caught on the page before sending, by name', 'Fill in {tv_link}' in (js(sid, 'document.getElementById("hdtMsg").textContent') or '')
       and len(S.W.sent()) == sent0 and not [p for p, b in S.W.calls[calls0:] if p == '/admin/help/reply'])
    click(sid, '#hdMode [data-mode="note"]')
    ok('Internal note is its own tab: the reply box goes away while it is open', js(sid, 'document.getElementById("hdReplyBox").classList.contains("hidden") && !document.getElementById("hdNoteBox").classList.contains("hidden")') is True)
    js(sid, 'document.getElementById("hdtNote").value="Rang Pat, sorted on the phone.";document.getElementById("hdtNoteGo").click();true')
    S.until(sid, '!!document.querySelector("#hdNotes .hdnote.note")', 8)
    notes = [n for n in S.W.table('vp_help_ticket_notes') if n['ticket_id'] == TICKETS[2]['id'] and n['kind'] == 'note']
    ok('the note is saved as a note, shown in gold, and emailed to nobody', len(notes) == 1 and len(S.W.sent()) == sent0
       and 'Rang Pat' in (js(sid, 'document.querySelector("#hdNotes .hdnote.note").textContent') or ''))
    js(sid, 'document.querySelector(".hddet").open=true;document.getElementById("hdtPri").value="urgent";document.getElementById("hdtSave").click();true')
    S.until(sid, '!!document.querySelector(".cxhead .badge.urgent")', 8)
    ok('Ticket details still saves (priority to urgent)', ticket(1003)['priority'] == 'urgent')
    click(sid, '#hdCloseT')
    S.until(sid, '!document.getElementById("hdListWrap").classList.contains("hidden")', 8)
    ok('"Close ticket without replying" closes it, sends nothing, and goes back to the list', ticket(1003)['status'] == 'closed' and len(S.W.sent()) == sent0
       and 'ticket 1003 closed' in text(sid, 'document.getElementById("hdDone").textContent').lower())
    errs = js(sid, 'window.__errs') or []
    ok('no script errors on the page', errs == [], errs)

    print('\nSaved replies: before the migration, then after')
    click(sid, '#hdSecs [data-sec="replies"]')
    S.until(sid, '!!document.getElementById("hsNotYet")', 8)
    ok('before migration 126 it says so, plainly', 'Migration 126 has not been run yet' in (js(sid, 'document.getElementById("hsNotYet").textContent') or ''))
    ok('...and shows every starter reply, read-only, grouped by who they are for', js(sid, 'document.querySelectorAll("#hsBox .hsitem").length') == len(SEED)
       and js(sid, 'document.querySelectorAll("#hsBox [data-hs]").length') == 0 and 'VenuePlay players' in text(sid, 'document.getElementById("hsBox").textContent'))
    time.sleep(0.4)   # HQ's pills fade their colour over 0.15s: photograph after it
    shot(sid, '03-saved-replies-before', full=True)
    # "Run" migration 126: the table appears, seeded the way the migration seeds it.
    S.W.missing('vp_help_saved_replies', False)
    S.W.seed('vp_help_saved_replies', [{'id': '90000000-0000-4000-8000-%012d' % (i + 1), 'seed_key': r['key'], 'audience': r['audience'], 'title': r['title'],
                                         'body': r['body'], 'position': (i + 1) * 10, 'created_at': '2026-10-29T00:00:00Z'} for i, r in enumerate(SEED)])
    click(sid, '#hdSecs [data-sec="tickets"]')
    click(sid, '#hdSecs [data-sec="replies"]')
    S.until(sid, 'document.querySelectorAll("#hsBox [data-hs=save]").length > 0', 8)
    ok('after it, every reply can be changed, moved and deleted', js(sid, 'document.querySelectorAll("#hsBox [data-hs=save]").length') == len(SEED) and js(sid, '!document.getElementById("hsNotYet")') is True)

    def db_replies():
        return sorted(S.W.table('vp_help_saved_replies'), key=lambda r: r['position'])
    first = db_replies()[0]['id']
    js(sid, 'var r=document.querySelector("[data-reply=\'%s\']");r.querySelector("[data-f=title]").value="TV not showing (the usual)";r.querySelector("[data-hs=save]").click();true' % first)
    S.until(sid, 'true', 1)
    time.sleep(0.6)
    ok('a change is saved to the database', [r for r in db_replies() if r['id'] == first][0]['title'] == 'TV not showing (the usual)')
    second = db_replies()[1]['id']
    S.until(sid, '!!document.querySelector("[data-hs=move][data-dir=up][data-id=\'%s\']")' % second, 6)
    click(sid, '[data-hs=move][data-dir=up][data-id="%s"]' % second)
    time.sleep(0.8)
    ok('each saved reply is folded to its name and first lines until tapped', js(sid, '[].every.call(document.querySelectorAll("#hsBox details.hsitem"),function(d){return !d.open;})') is True)
    js(sid, 'var d=document.querySelector("#hsBox details.hsitem");d.open=true;true')
    time.sleep(0.3)
    fitb = js(sid, '(function(){var t=document.querySelector("#hsBox details.hsitem[open] textarea");return t?{h:t.clientHeight,s:t.scrollHeight}:null;})()')
    ok('a tap opens its editor, with the whole reply showing in the box', bool(fitb) and fitb['s'] <= fitb['h'] + 4 and fitb['h'] > 150, fitb)
    ok('the arrow moves a reply up', [r['id'] for r in db_replies()][:2] == [second, first], [r['title'] for r in db_replies()][:2])
    last = db_replies()[-1]['id']
    S.until(sid, '!!document.querySelector("[data-hs=delete][data-id=\'%s\']")' % last, 6)
    click(sid, '[data-hs=delete][data-id="%s"]' % last)
    time.sleep(0.4)
    ok('Delete asks for a second tap on the page, and has deleted nothing yet', 'Tap again' in (js(sid, 'document.querySelector("[data-hs=delete][data-id=\'%s\']").textContent' % last) or '')
       and len(db_replies()) == len(SEED))
    click(sid, '[data-hs=delete][data-id="%s"]' % last)
    time.sleep(0.8)
    ok('the second tap deletes it', len(db_replies()) == len(SEED) - 1 and last not in [r['id'] for r in db_replies()])
    js(sid, 'document.getElementById("hsNewTitle").value="Raffle prize question";document.getElementById("hsNewAud").value="venue";'
            'document.getElementById("hsNewBody").value="Hi {first_name},\\n\\nYour raffle prizes are set on the Draws page.\\n\\nCheers,";document.querySelector("[data-hs=add]").click();true')
    time.sleep(0.8)
    ok('+ Add saved reply adds one, at the end', db_replies()[-1]['title'] == 'Raffle prize question' and db_replies()[-1]['audience'] == 'venue')
    js(sid, 'document.getElementById("hsNewTitle").value="Bad";document.getElementById("hsNewAud").value="player";'
            'document.getElementById("hsNewBody").value="Call 07 5228 3667";document.querySelector("[data-hs=add]").click();true')
    time.sleep(0.8)
    ok('a reply for players with the support line in it is refused, with the reason on the page', 'venues only' in (js(sid, 'document.getElementById("hsMsg").textContent') or '')
       and not any(r['title'] == 'Bad' for r in db_replies()))
    shot(sid, '04-saved-replies-after', full=True)
    click(sid, '#hdSecs [data-sec="tickets"]')
    view(sid, 'all')
    open_no(sid, 1006)
    time.sleep(0.3)
    ok('the new reply is offered in a venue ticket, and the changed name shows', 'Raffle prize question' in picker(sid) and 'TV not showing (the usual)' in picker(sid), picker(sid))

    print('\nA venue\'s own tickets, in HQ > Venues > Details (Dean, 29 Oct 2026)')
    back_to_list(sid)   # so a ticket found open below was opened by the tap, not left over from above
    ok('(the desk is back on its list, no ticket open)', js(sid, '!document.getElementById("hdTicket").textContent') is True)
    venue_details(sid, V2)
    vt = venue_panel(sid, V2)
    ok('the venue\'s details list its tickets, the open one first, then the closed one', bool(vt) and vt['nos'] == [1006, 1005], vt)
    ok('each row is the number, what it was about, the date and the status, nothing else',
       bool(vt) and vt['rows'] == [['#1006', 'Logo looks blurry', '28 Oct 2026', 'Needs reply'], ['#1005', 'Pricing question', '10 Oct 2026', 'Closed']], vt and vt['rows'])
    ok('...only this venue\'s tickets (none of Deepwater\'s)', bool(vt) and not set(vt['nos']) & {1001, 1002, 1004}, vt)
    asked = [b for p, b in S.W.calls if p == '/admin/help/list' and b.get('venue_id') == V2]
    ok('it asks the Worker for that venue only', bool(asked), [b for p, b in S.W.calls if p == '/admin/help/list'][-2:])
    shot(sid, '08-venue-tickets-desk')
    click(sid, '[data-vphd] [data-vphdno="1006"]')
    ok('a tap on a ticket opens it in the help desk', S.until(sid, '!document.getElementById("paneHelpdesk").classList.contains("hidden") && /#1006/.test(document.getElementById("hdTicket").textContent) && !!document.getElementById("hdtReply")', 10) is True)
    venue_details(sid, V2)
    click(sid, '[data-vphdnew="%s"]' % V2)
    pre = S.until(sid, '(function(){var b=document.getElementById("hdCallBox"),v=document.getElementById("hdcVenue");return b&&!b.classList.contains("hidden")&&v&&v.value?[v.value,document.getElementById("hdcBrand").value]:null;})()', 10)
    ok('"New ticket for this venue" opens Log a call with the venue already picked', pre == [V2, 'venueplay'], pre)
    js(sid, 'document.getElementById("hdcCat").value="venue_support";document.getElementById("hdcSubject").value="Rang about the logo";document.getElementById("hdcGo").click();true')
    S.until(sid, 'document.getElementById("hdCallBox").classList.contains("hidden")', 8)
    new = [t for t in S.W.table('vp_help_tickets') if t.get('subject') == 'Rang about the logo']
    ok('...and the ticket it saves belongs to that venue', len(new) == 1 and new[0].get('venue_id') == V2, new[:1])
    venue_details(sid, V2)
    vt = venue_panel(sid, V2, need=3)
    ok('back in the venue\'s details, the new ticket is at the top, then the other open one, then the closed one',
       bool(vt) and len(vt['nos']) == 3 and vt['nos'][1:] == [1006, 1005] and vt['rows'][0][1] == 'Rang about the logo'
       and vt['nos'][0] == new[0].get('ticket_no') and vt['rows'][0][0] == '#%s' % new[0].get('ticket_no'), vt)
    S.close_tab(tid)

    print('\nOn a phone')
    tid, sid = S.open('/app/hq.html?as=admin', 390, 844, mobile=True)
    S.until(sid, '!!document.getElementById("hdTab")', 25)
    click(sid, '#hdTab')
    wait_list(sid)
    time.sleep(0.5)
    ok('the list fits a 390 wide phone: no sideways scrolling, every row inside the screen',
       js(sid, 'document.documentElement.scrollWidth<=window.innerWidth+1 && [].every.call(document.querySelectorAll("#hdRows .hdrow"),function(r){var b=r.getBoundingClientRect();return b.left>=0&&b.right<=window.innerWidth;})') is True,
       js(sid, '[document.documentElement.scrollWidth,window.innerWidth]'))
    js(sid, 'document.documentElement.style.scrollBehavior="auto";window.scrollTo(0,document.getElementById("hdSecs").getBoundingClientRect().top+window.pageYOffset-10);true')
    time.sleep(0.3)
    shot(sid, '05-list-phone')
    open_no(sid, 1006)
    time.sleep(0.5)
    ok('a ticket fits too: no sideways scrolling', js(sid, 'document.documentElement.scrollWidth<=window.innerWidth+1') is True, js(sid, '[document.documentElement.scrollWidth,window.innerWidth]'))
    cut = js(sid, '(function(){var w=window.innerWidth,out=[];[].forEach.call(document.querySelectorAll("#hdTicket button, #hdTicket select, #hdTicket textarea"),function(e){if(!e.offsetParent)return;var r=e.getBoundingClientRect();if(r.width&&(r.right>w-8||r.left<8))out.push((e.id||e.textContent).slice(0,24));});return out;})()')
    ok('every button and box is inside the screen', cut == [], cut)
    big = js(sid, '(function(){var a=document.getElementById("hdtReplyClose").getBoundingClientRect(),b=document.getElementById("hdtReplyGo").getBoundingClientRect(),p=document.getElementById("hdtPick").getBoundingClientRect();return Math.min(a.height,b.height,p.height);})()')
    ok('Send and close, Send and the saved reply picker are big enough to tap (40 px or more)', (big or 0) >= 40, big)
    cw = js(sid, '[document.querySelector(".hdmsg").getBoundingClientRect().width, window.innerWidth]')
    ok('on a phone, the conversation takes the screen\'s width, not a squeezed column beside who they are', bool(cw) and cw[0] >= cw[1] * 0.7, cw)
    ok('on a phone, who they are comes first, above the conversation', js(sid, 'document.querySelector(".hdside").getBoundingClientRect().top < document.querySelector(".hdmsg").getBoundingClientRect().top') is True)
    shot(sid, '06-ticket-phone', full=True)
    js(sid, 'history.back();true')
    ok('the phone\'s own Back button returns to the list, not out of HQ', S.until(sid, '!document.getElementById("hdListWrap").classList.contains("hidden") && /hq\\.html/.test(location.pathname)', 8) is True)
    click(sid, '#hdSecs [data-sec="replies"]')
    S.until(sid, 'document.querySelectorAll("#hsBox [data-hs=save]").length > 0', 8)
    cut = js(sid, '(function(){var w=window.innerWidth,out=[];[].forEach.call(document.querySelectorAll("#hsBox button, #hsBox input, #hsBox select, #hsBox textarea"),function(e){if(!e.offsetParent)return;var r=e.getBoundingClientRect();if(r.width&&(r.right>w-8||r.left<8))out.push((e.id||e.textContent||e.getAttribute("data-f")).slice(0,24));});return out;})()')
    ok('Saved replies on a phone: no sideways scrolling, nothing cut off', js(sid, 'document.documentElement.scrollWidth<=window.innerWidth+1') is True and cut == [], cut)
    js(sid, 'document.documentElement.style.scrollBehavior="auto";window.scrollTo(0,document.getElementById("hdSecs").getBoundingClientRect().top+window.pageYOffset-10);true')
    time.sleep(0.4)
    shot(sid, '07-saved-replies-phone')
    venue_details(sid, V2)
    venue_panel(sid, V2)
    js(sid, 'document.documentElement.style.scrollBehavior="auto";window.scrollTo(0,document.querySelector(\'[data-vphd="%s"]\').getBoundingClientRect().top+window.pageYOffset-120);true' % V2)
    time.sleep(0.4)
    vw = js(sid, '(function(){var d=document.querySelector(\'[data-vphd="%s"]\'),w=window.innerWidth,out=[];[].forEach.call(d.querySelectorAll("button"),function(e){var r=e.getBoundingClientRect();if(r.right>w-4||r.left<4||r.height<40)out.push(e.textContent.slice(0,30)+" "+Math.round(r.left)+"-"+Math.round(r.right)+" h"+Math.round(r.height));});return out;})()' % V2)
    ok('a venue\'s tickets on a phone: every ticket and the New ticket button inside the screen and big enough to tap', vw == [], vw)
    shot(sid, '09-venue-tickets-phone')
    errs = js(sid, 'window.__errs') or []
    ok('no script errors on the phone either', errs == [], errs)
    S.close_tab(tid)
finally:
    S.close()

print('\n%d of %d checks passed' % (PASS[0], PASS[0] + FAIL[0]))
sys.exit(1 if FAIL[0] else 0)
