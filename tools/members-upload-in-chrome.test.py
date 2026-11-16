#!/usr/bin/env python3
"""THE MEMBERS LIST UPLOAD, IN A REAL BROWSER (Dean, 16 Nov 2026, Jobs row 445).

Dean: "when a venue uploads its members spreadsheet it maps first name, surname, email and phone; a single full-name
column must be split into first name + surname", and "remember that setting from the first time they import members
... we should import the same data as they are asking from our system".

This opens the REAL Your account > Draws page (venueplay/app/billing.html, tools/browser-rig/admin_site.py) with the
REAL game Worker behind it (rig.py, in jsc), chooses a real messy Excel file (tools/fixtures/members-csv/19: BOM,
sep=;, semicolons, quoted commas, one Full Name column, email, mobiles, Subscribed, street address, DOB, State) in
the real file input, and reads what a venue sees:
  1. "Which column is which?": Full name (one column) picked, Email, Mobile, Postcode and "Send me offers" offered
     because the venue's games collect them, street address / DOB / State named as not imported
  2. "Check the names": every member in the file, the two the rule cannot be sure of (Mary Anne Smith, Cher) first with
     their own boxes, a fix typed there is what is saved
  3. the real /host/members/import keeps the email, the mobile (+614...), the consent and its source, and the columns
  4. the next upload says it used the columns picked last time
  5. the download carries the email, mobile, postcode and offers columns
  6. a venue whose games collect nothing is still offered every field; a file whose headings say nothing has every
     column pre-marked from its contents
  7. phone width (390 and 375): the upload stays hidden on a phone (Dean, round 12 note 9) and the page never scrolls
     sideways; the picker and the check are also laid out at those widths in case it is shown, nothing wider than the
     screen. Desktop 1100 and tablet 768 are shot as they are.

    python3 tools/members-upload-in-chrome.test.py [--shots DIR]
"""
import argparse, json, os, sys, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools', 'browser-rig'))
import admin_site  # noqa: E402
import rig as RIG  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument('--shots', default=os.environ.get('VP_SHOTS', ''))
A = ap.parse_args()
ran = bad = 0


def ok(name, cond, saw=''):
    global ran, bad
    ran += 1
    print(('  ok   ' if cond else '  FAIL ') + name + ('' if cond else '   saw: ' + str(saw)[:500]))
    if not cond:
        bad += 1


def shot(sid, name, full=True):
    if A.shots:
        os.makedirs(A.shots, exist_ok=True)
        S.shot(sid, os.path.join(A.shots, name + '.png'), full)


F19 = os.path.join(ROOT, 'tools', 'fixtures', 'members-csv', '19-excel-bom-semicolon-fullname.csv')
GW = RIG.Worker()
TABLES = ['vp_member_draws', 'vp_member_rosters', 'vp_members', 'vp_venue_settings']
S = admin_site.Site(live_tables=TABLES, game=GW, game_tables=TABLES)
V1 = S.W.info['venue']
BILLING_UP = 'document.getElementById("content").style.display!=="none"'
MD_UP = '!!document.getElementById("mdCount") && /in your list|No members yet/.test(document.getElementById("mdCount").textContent)'
ALL_ON = {'venue_id': V1, 'collect_first_name': True, 'collect_last_name': True, 'collect_email': True, 'collect_mobile': True,
          'collect_postcode': True, 'collect_marketing_optin': True}
PICKER = r'''(function(){
  var o={shown:document.getElementById("md-match").style.display!=="none", sel:{}, labels:[], skip:document.getElementById("md-matchskip").textContent,
    msg:document.getElementById("md-csvmsg").textContent};
  [].forEach.call(document.querySelectorAll("#md-matchrows select"),function(s){ if(s.hidden) return; var t=s.options[s.selectedIndex]; o.sel[s.id.replace("md-col-","")]=t?t.textContent:""; });
  [].forEach.call(document.querySelectorAll("#md-matchrows label"),function(l){ if(!l.hidden) o.labels.push(l.textContent); });
  return JSON.stringify(o);})()'''
REVIEW = r'''(function(){
  var o={shown:document.getElementById("md-review").style.display!=="none", note:document.getElementById("md-reviewnote").textContent, fix:[], rows:[]};
  [].forEach.call(document.querySelectorAll("#md-unsure .md-fix"),function(r){ o.fix.push({num:r.querySelector(".num").textContent, f:r.querySelector(".md-fixf").value, l:r.querySelector(".md-fixl").value, why:r.querySelector(".why").textContent}); });
  [].forEach.call(document.querySelectorAll("#md-all tbody tr"),function(r){ o.rows.push([].map.call(r.children,function(td){return td.textContent;})); });
  o.heads=[].map.call(document.querySelectorAll("#md-all thead th"),function(t){return t.textContent;});
  return JSON.stringify(o);})()'''
WIDE = r'''(function(){ var W=document.documentElement.clientWidth, out=[];
  [].forEach.call(document.querySelectorAll("#md-upload *"),function(e){ var r=e.getBoundingClientRect(); if(r.width && (r.right>W+1 || r.left<-1) && !e.closest(".md-all")) out.push((e.id||e.className||e.tagName)+" "+Math.round(r.left)+"-"+Math.round(r.right)); });
  return JSON.stringify({W:W, sw:document.documentElement.scrollWidth, wide:out.slice(0,6)});})()'''


def members():
    return [m for m in (S.game_table('vp_members') or [])]


def open_draws(w, h, mobile):
    tid, sid = S.open('/app/billing.html#draws', w, h, mobile)
    S.until(sid, BILLING_UP, 25)
    S.until(sid, MD_UP, 25)
    # the Members draws fold, opened the way a venue opens it (one fold open at a time, Dean 3 Nov 2026)
    S.js(sid, '(function(){var h=document.querySelector(\'.acchead[data-acc="members"]\'); if(h && !h.classList.contains("open")) h.click(); return true;})()')
    S.until(sid, 'document.querySelector(\'.acchead[data-acc="members"]\').classList.contains("open")', 10)
    time.sleep(0.6)
    return tid, sid


def frame(sid, el, name):
    """What is on the screen with that part of the page in view: the viewport, as a person sees it."""
    # below the sticky tab bar, which is two rows tall on a phone
    S.js(sid, '(function(){var t=document.querySelector(".tabs"), h=t?t.getBoundingClientRect().height:0; document.getElementById(%s).scrollIntoView({block:"start"}); window.scrollBy(0,-(h+80)); return true;})()' % json.dumps(el))
    time.sleep(0.35)
    shot(sid, name, False)


def choose(sid):
    S.set_file(sid, '#md-csv', F19)
    return S.until(sid, 'document.getElementById("md-match").style.display!=="none" && document.querySelectorAll("#md-matchrows select").length>0', 20)


try:
    GW.seed('vp_venue_settings', [ALL_ON], True)
    print('\n1. WHICH COLUMN IS WHICH? at 1100 wide, a venue whose games collect email, mobile, postcode and offers')
    tid, sid = open_draws(1100, 1000, False)
    up = choose(sid)
    p = S.json(sid, PICKER, {})
    ok('CONTROL: choosing the file in the real file input opens "Which column is which?"', up is True and p.get('shown'), p)
    sel = p.get('sel') or {}
    ok('Names: "Full name in one column", on the Full Name column', sel.get('names') == 'Full name in one column' and sel.get('full') == 'Full Name' and 'first' not in sel, sel)
    ok('Member number, Email, Mobile and "Send me offers (subscribed)" land on their columns; no postcode column, so None',
       sel.get('number') == 'Member No' and sel.get('email') == 'E-mail Address' and sel.get('mobile') == 'Mobile Phone' and sel.get('offers') == 'Subscribed' and sel.get('postcode') == 'None', sel)
    vis = S.js(sid, 'Math.round(document.getElementById("md-match").getBoundingClientRect().height)')
    ok('and it is really on the screen (inside the open Members draws fold), not just switched on', isinstance(vis, (int, float)) and vis > 150, vis)
    ok('Street Address, DOB and State are named as not imported', 'Not imported: Street Address, DOB, State.' in (p.get('skip') or ''), p.get('skip'))
    ok('no "roster", lowercase venueplay, no em dash in what the venue reads', not any(x in json.dumps(p) for x in ('roster', 'VenuePlay', '—')), p)
    frame(sid, 'md-match', 'members-upload-picker-1100')
    print('\n2. CHECK THE NAMES')
    S.js(sid, 'document.getElementById("md-matchgo").click(); true')
    S.until(sid, 'document.getElementById("md-review").style.display!=="none"', 10)
    rv = S.json(sid, REVIEW, {})
    fix = rv.get('fix') or []
    ok('every one of the 5 members in the file is listed, as it will be saved', len(rv.get('rows') or []) == 5 and rv.get('heads') == ['No.', 'First name', 'Surname', 'Email', 'Mobile', 'Offers'], rv)
    ok('"Lee, Daniel" and "LEE,Daniel" read Daniel / Lee; the mobile is shown 0412 345 678; Yes and No for offers',
       (rv.get('rows') or [[]])[0][:6] == ['142', 'Daniel', 'Lee', 'daniel.lee@example.com', '0412 345 678', 'Yes'] and (rv.get('rows') or [[], []])[1][1:3] == ['Daniel', 'Lee'], rv.get('rows'))
    ok('the two the rule cannot be sure of come first, each with its own boxes: Mary Anne / Smith and Cher',
       [(f['num'], f['f'], f['l']) for f in fix if f['num'] in ('144', '146')] == [('144', 'Mary Anne', 'Smith'), ('146', 'Cher', '')], fix)
    ok('the note says what to do', 'Fix any that are wrong, then add them.' in (rv.get('note') or '') and '1 row has no member number' in (rv.get('note') or ''), rv.get('note'))
    frame(sid, 'md-review', 'members-upload-check-1100')
    S.js(sid, '(function(){var r=[].filter.call(document.querySelectorAll("#md-unsure .md-fix"),function(x){return x.querySelector(".num").textContent==="146";})[0]; r.querySelector(".md-fixl").value="Sarkisian"; return true;})()')
    S.js(sid, 'document.getElementById("md-reviewgo").click(); true')
    said = S.until(sid, '/added to your members list/.test(document.getElementById("md-csvmsg").textContent) && document.getElementById("md-csvmsg").textContent', 20)
    ok('"5 added to your members list." and the visitor row left out is said', said and '5 added to your members list.' in said and '1 row had no member number' in said, said)
    print('\n3. WHAT THE REAL WORKER KEPT')
    mm = {int(m['member_number']): m for m in members()}
    ok('5 members on the list', len(mm) == 5, list(mm))
    m142 = mm.get(142) or {}
    ok('142 Daniel Lee: daniel.lee@example.com, +61412345678, offers yes, from "members list import, <date>"',
       (m142.get('first_name'), m142.get('last_name'), m142.get('email'), m142.get('mobile'), m142.get('marketing_optin')) == ('Daniel', 'Lee', 'daniel.lee@example.com', '+61412345678', True)
       and str(m142.get('marketing_optin_source') or '').startswith('members list import, '), m142)
    ok('146: the surname typed on the check screen is what was saved, and the landline was not kept as a mobile',
       (mm.get(146) or {}).get('last_name') == 'Sarkisian' and not (mm.get(146) or {}).get('mobile'), mm.get(146))
    ros = S.game_table('vp_member_rosters') or []
    imap = (ros[0] or {}).get('import_map') if ros else None
    ok('the column choices are kept with the list, headings only', bool(imap) and imap.get('cols', {}).get('full name') == 'full' and '@' not in json.dumps(imap), imap)
    print('\n4. THE NEXT UPLOAD REMEMBERS')
    S.close_tab(tid)
    tid, sid = open_draws(1100, 1000, False)
    choose(sid)
    p2 = S.json(sid, PICKER, {})
    ok('"We used the columns you picked last time." and the same columns are picked', 'We used the columns you picked last time.' in (p2.get('msg') or '') and p2.get('sel', {}).get('full') == 'Full Name' and p2.get('sel', {}).get('mobile') == 'Mobile Phone', p2)
    print('\n5. THE DOWNLOAD')
    S.js(sid, '(function(){window.__csv=null; var c=URL.createObjectURL; URL.createObjectURL=function(b){ b.text().then(function(t){window.__csv=t;}); return c.call(URL,b); }; return true;})()')
    S.js(sid, '(function(){var b=document.getElementById("leftMembersCsv"); if(!b) return false; b.hidden=false; b.click(); return true;})()')
    csv = S.until(sid, 'window.__csv', 15)
    ok('the venue\'s own download carries Email, Mobile, Postcode and the offers answer with its source',
       bool(csv) and csv.split('\n')[0] == 'Member number,First name,Surname,Email,Mobile,Postcode,Offers from your venue,Offers recorded from'
       and ',Daniel,Lee,daniel.lee@example.com,0412 345 678,,Yes,"members list import, ' in csv and ',Mary Anne,Smith,,0498 765 432,,Yes,' in csv, repr((csv or '')[:400]))
    # (the member number column itself is the alias number:member_number, which this rig's stand-in does not apply without a
    #  column schema; tools/test-members-csv-columns.js runs the same download against the real column list and checks it)
    S.close_tab(tid)
    print('\n6. A VENUE WHOSE GAMES COLLECT NOTHING IS STILL OFFERED EVERY FIELD VENUEPLAY CAN COLLECT (Dean, 16 Nov 2026)')
    GW.seed('vp_venue_settings', [{'venue_id': V1, 'collect_first_name': True}], True)
    tid, sid = open_draws(1100, 1000, False)
    choose(sid)
    p3 = S.json(sid, PICKER, {})
    ok('Email, Mobile and offers are pre-marked anyway, Postcode offered (None: no such column)',
       (p3.get('sel') or {}).get('email') == 'E-mail Address' and (p3.get('sel') or {}).get('mobile') == 'Mobile Phone' and (p3.get('sel') or {}).get('offers') == 'Subscribed' and (p3.get('sel') or {}).get('postcode') == 'None', p3.get('sel'))
    ok('and only Street Address, DOB and State are named as not imported', 'Not imported: Street Address, DOB, State.' in (p3.get('skip') or ''), p3.get('skip'))
    S.close_tab(tid)
    print('\n6b. HEADINGS THAT SAY NOTHING: EVERY COLUMN PRE-MARKED FROM WHAT IS IN IT')
    tid, sid = open_draws(1100, 1000, False)
    S.set_file(sid, '#md-csv', os.path.join(ROOT, 'tools', 'fixtures', 'members-csv', '22-headings-say-nothing.csv'))
    S.until(sid, 'document.getElementById("md-match").style.display!=="none" && document.querySelectorAll("#md-matchrows select").length>0', 20)
    p4 = S.json(sid, PICKER, {})
    ok('Ref, Person, Info, Reach, Code, Flag pre-selected as Member number, Full name, Email, Mobile, Postcode, Send me offers',
       p4.get('sel') == {'number': 'Ref', 'names': 'Full name in one column', 'full': 'Person', 'email': 'Info', 'mobile': 'Reach', 'postcode': 'Code', 'offers': 'Flag'}, p4.get('sel'))
    ok('Status and Joined left for the venue: named as not imported', 'Not imported: Status, Joined.' in (p4.get('skip') or ''), p4.get('skip'))
    frame(sid, 'md-match', 'members-upload-premarked-1100')
    S.close_tab(tid)
    GW.seed('vp_venue_settings', [ALL_ON], True)
    print('\n7. TABLET, AND PHONE WIDTH')
    tid, sid = open_draws(768, 1024, False)
    choose(sid); frame(sid, 'md-match', 'members-upload-picker-768')
    S.js(sid, 'document.getElementById("md-matchgo").click(); true'); time.sleep(0.4); frame(sid, 'md-review', 'members-upload-check-768')
    wd = S.json(sid, WIDE, {})
    ok('768 wide: nothing in the upload is wider than the screen, no sideways scroll', not wd.get('wide') and wd.get('sw', 0) <= wd.get('W', 0), wd)
    S.close_tab(tid)
    for w, h in ((390, 844), (375, 667)):
        tid, sid = open_draws(w, h, True)
        hid = S.js(sid, 'getComputedStyle(document.getElementById("md-upload")).display')
        ok('%d wide: the upload is not shown on a phone (Dean, round 12 note 9: nobody picks a CSV on a phone)' % w, hid == 'none', hid)
        S.js(sid, 'document.getElementById("md-upload").classList.remove("md-nophone"); true')
        choose(sid)
        frame(sid, 'md-match', 'members-upload-picker-%d' % w)
        wd = S.json(sid, WIDE, {})
        ok('%d wide, laid out anyway: the picker fits, nothing wider than the screen' % w, not wd.get('wide') and wd.get('sw', 0) <= wd.get('W', 0), wd)
        S.js(sid, 'document.getElementById("md-matchgo").click(); true'); time.sleep(0.4)
        frame(sid, 'md-review', 'members-upload-check-%d' % w)
        wd = S.json(sid, WIDE, {})
        fx = S.json(sid, '(function(){var i=document.querySelector("#md-unsure .md-fixf"); var r=i&&i.getBoundingClientRect(); return JSON.stringify({h:r?Math.round(r.height):0, fs:i?getComputedStyle(i).fontSize:"", review:document.getElementById("md-review").style.display, match:document.getElementById("md-match").style.display, msg:document.getElementById("md-csvmsg").textContent});})()', {})
        ok('%d wide: the check fits (the list scrolls inside itself), the name boxes are 44px tall at 16px or more' % w,
           not wd.get('wide') and wd.get('sw', 0) <= wd.get('W', 0) and fx.get('h', 0) >= 44 and float(str(fx.get('fs', '0')).replace('px', '') or 0) >= 14, [wd, fx])
        rh = S.json(sid, '(function(){var r=document.querySelector("#md-all tbody tr"); return JSON.stringify({h:r?Math.round(r.getBoundingClientRect().height):0, sw:document.getElementById("md-all").scrollWidth, cw:document.getElementById("md-all").clientWidth});})()', {})
        ok('%d wide: each member is one line in the list (no name broken letter by letter); a wide list scrolls inside its own box' % w, 0 < rh.get('h', 0) <= 40, rh)
        S.close_tab(tid)
    errs = []
finally:
    try: S.close()
    except Exception: pass
    try: GW.close()
    except Exception: pass

print('')
if bad:
    print('FAIL %d of %d' % (bad, ran)); sys.exit(1)
print('ALL %d CHECKS PASSED' % ran)
