#!/usr/bin/env python3
"""HQ, TAB BY TAB, IN THE REAL PAGE, AGAINST THE REAL BILLING WORKER (Dean, 21 Oct 2026).

Opens the REAL hq.html in headless Chrome (tools/browser-rig/admin_site.py) with a whole business
behind it (tools/browser-rig/hq_scenario.py), signed in as an owner admin, and uses each screen the
way Dean does:

  Audit      a search: last 7 days by default; a venue picked by typing its name; Today, Last 30
             days and picked dates; what changed; who did it; each narrows on the SERVER (the
             request says so) and every row shown matches; Older and Newer page through by cursor,
             never loading the table; a sentence per entry and the raw row under Details; a direct
             database delete of a screen shows as outside VenuePlay and leads to its screen history
  Groups     one row per group or account, all closed; a tap opens one, a second tap closes it, two
             can be open; the search finds a group, and a VENUE inside a group (opening that group);
             View as, Details, Rename, the venue ticks and the discount form are inside
  Billing    three declines of one card are one line naming Tugun Bowls Club; only the ones that need
             a look until "Show every payment"; History opens the attempts
  Cancelled  a contacted venue is one line with its last day and who rang; Reactivate emails them a
             link (through the real Worker) and charges and changes nothing; Open shows the card;
             a venue whose subscription ended is on the list
  Quiet      the archive panel has its padding back and every row's buttons sit in one tidy row
  Venues     one line per venue, no screen address under the name; search still finds it by address
  Team       no raw login ids; Flagged names the venue; an account nobody has approved no longer
             stops the page drawing
  Phone      every tab fits a 390 pixel screen without sideways scrolling

    python3 tools/hq-tabs-in-chrome.test.py [--shots DIR]
"""
import argparse, json, os, sys, time, urllib.parse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools', 'browser-rig'))
import admin_site, hq_scenario  # noqa: E402
from hq_scenario import vid, TUGUN, LEAVING, ENDED  # noqa: E402

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


def shot(sid, name, full=True):
    if A.shots:
        os.makedirs(A.shots, exist_ok=True)
        S.shot(sid, os.path.join(A.shots, name + '.png'), full=full)


S = admin_site.Site(fonts=bool(A.shots), extra_db=hq_scenario.extra_db(), live_tables=['vp_admin_audit'])
hq_scenario.seed(S)


def js(sid, e):
    return S.js(sid, e)


def click(sid, sel):
    return js(sid, '(function(){var b=document.querySelector(%s); if(!b) return false; b.click(); return true;})()' % json.dumps(sel))


def pane(sid, p):
    click(sid, '#hqNav button[data-pane="%s"]' % p)
    time.sleep(0.4)


def searches():
    return [c[0] for c in S.W.calls if c[0].startswith('/admin/audit-search')]


def last_q():
    s = searches()
    return dict(urllib.parse.parse_qsl(s[-1].split('?', 1)[1])) if s and '?' in s[-1] else {}


def audit_rows(sid):
    return js(sid, '[].map.call(document.querySelectorAll("#auRows .auent"), function(e){return {key:e.getAttribute("data-aukey"), '
                   'when:e.querySelector(".auwhen").textContent, who:e.querySelector(".auwho").textContent, say:e.querySelector(".ausay").textContent, '
                   'kind:e.querySelector(".badge").textContent};})') or []


def wait_search(sid, n_before):
    S.until(sid, 'true', 1)
    t = time.time() + 20
    while time.time() < t:
        if len(searches()) > n_before and js(sid, '!/Searching/.test(document.getElementById("auRows").innerText)'):
            return True
        time.sleep(0.2)
    return False


def no_sideways(sid):
    return js(sid, 'document.documentElement.scrollWidth <= window.innerWidth + 1')


def raw_of(key):
    a = [r for r in S.W.table('vp_admin_audit') if 'a' + str(r.get('id')) == key]
    return a[0] if a else None


try:
    tid, sid = S.open('/app/hq.html?as=admin', 1280, 1000)
    S.until(sid, 'document.querySelectorAll("#venueRows tr").length > 0', 25)
    time.sleep(2)

    print('\nVenues: one line each')
    ok('no screen address line under any venue name', js(sid, 'document.querySelectorAll("#venueRows td .vt.mono").length') == 0)
    ok('every venue row is one line tall', js(sid, 'Math.max.apply(null,[].map.call(document.querySelectorAll("#venueRows tr:not(.detail) .vn"), function(e){return e.getBoundingClientRect().height;}))') < 24)
    js(sid, 'var i=document.getElementById("venueSearch"); i.value="function-centre"; i.dispatchEvent(new Event("input")); true')
    time.sleep(0.3)
    ok('search still finds a venue by its screen address', js(sid, '[].map.call(document.querySelectorAll("#venueRows .vn"), function(e){return e.textContent;})') == ['Connies Country Club'])
    js(sid, 'var i=document.getElementById("venueSearch"); i.value=""; i.dispatchEvent(new Event("input")); true')
    click(sid, 'button[data-details="%s"]' % vid(4))
    time.sleep(0.3)
    ok('and the address is in Details', 'connies-country-club-and-function-centre' in (js(sid, 'document.getElementById("venueRows").innerText') or ''))
    shot(sid, 'venues-desktop')

    print('\nAudit: a search')
    n = len(searches())
    pane(sid, 'audit')
    wait_search(sid, n)
    q = last_q()
    rows = audit_rows(sid)
    ok('opening the tab asks the Worker for one page of the last 7 days', q.get('size') == '50' and 'from' in q and 'before' not in q, q)
    ok('50 on the first page', len(rows) == 50, len(rows))
    keys = [r['key'] for r in rows]
    raws = [raw_of(k) for k in keys if k.startswith('a')]
    ok('...each one really is inside the 7 days', all(r and r['created_at'] >= hq_scenario.ago(8) for r in raws), [r and r['created_at'] for r in raws][:5])
    ok('...newest first', [r['created_at'] for r in raws] == sorted([r['created_at'] for r in raws], reverse=True))
    ok('entries read as sentences, never JSON or ids', all('{' not in r['say'] and 'cus_' not in r['say'] and '4000-8000' not in r['say'] for r in rows), [r['say'] for r in rows][:3])
    dec = [r for r in rows if 'declined' in r['say'] and 'Tugun' in r['say']]
    ok('a declined card names Tugun Bowls Club and says who: Automatic (Stripe)', dec and dec[0]['who'] == 'Automatic (Stripe)', dec[:1])
    shot(sid, 'audit-default-desktop')

    k0 = keys[0]
    click(sid, 'button[data-auraw="%s"]' % k0)
    time.sleep(0.2)
    rawtxt = js(sid, '(document.querySelector(\'[data-aukey="%s"] .auraw\')||{}).textContent' % k0) or ''
    ok('Details opens the raw row for that entry', '"action"' in rawtxt or '"op"' in rawtxt, rawtxt[:80])
    shot(sid, 'audit-details-open-desktop')

    print('\nAudit: paging, on the server')
    n = len(searches())
    click(sid, '#auOlder')
    wait_search(sid, n)
    q2 = last_q()
    rows2 = audit_rows(sid)
    ok('Older asks for the next page by cursor, the same filters', 'before' in q2 and q2.get('from') == q.get('from'), q2)
    ok('page 2 holds different, older entries', rows2 and not (set(r['key'] for r in rows2) & set(keys)) and
       raw_of(rows2[0]['key'])['created_at'] <= raws[-1]['created_at'] if rows2 and rows2[0]['key'].startswith('a') else bool(rows2), len(rows2))
    ok('it says Page 2', js(sid, 'document.getElementById("auPage").textContent') == 'Page 2')
    n = len(searches())
    click(sid, '#auNewer')
    wait_search(sid, n)
    ok('Newer goes back to exactly page 1', [r['key'] for r in audit_rows(sid)] == keys)

    print('\nAudit: each filter')
    n = len(searches())
    js(sid, 'var i=document.getElementById("auVenue"); i.value="tugun"; i.dispatchEvent(new Event("input")); true')
    time.sleep(0.3)
    sugg = js(sid, '[].map.call(document.querySelectorAll("#auVenueList button"), function(b){return b.textContent;})')
    ok('typing "tugun" offers Tugun Bowls Club', sugg and sugg[0].startswith('Tugun Bowls Club'), sugg)
    js(sid, 'document.querySelector("#auVenueList button").dispatchEvent(new MouseEvent("mousedown",{bubbles:true})); true')
    wait_search(sid, n)
    q = last_q()
    rows = audit_rows(sid)
    ok('picking it searches that venue on the server', q.get('venue') == TUGUN, q)
    ok('and every entry is about Tugun', rows and all('Tugun' in r['say'] for r in rows), [r['say'] for r in rows])
    out = [r for r in rows if r['key'].startswith('h')]
    ok('the screen row deleted straight in the database is there, marked as outside VenuePlay', out and 'NOT through VenuePlay' in out[0]['who'] and 'DELETED' in out[0]['say'], out)
    shot(sid, 'audit-venue-tugun-desktop')
    n = len(searches())
    click(sid, '[data-aukey="%s"] button[data-auscreen]' % out[0]['key'])
    S.until(sid, '!document.getElementById("paneVenues").classList.contains("hidden") && /DELETED/.test((document.querySelector(\'[data-scrhistout="%s"]\')||{}).innerText||"")' % TUGUN, 20)
    ok('Screen history takes you to Tugun\'s versions, where Restore lives',
       'Restore this version' in (js(sid, '(document.querySelector(\'[data-scrhistout="%s"]\')||{}).innerText' % TUGUN) or ''))
    shot(sid, 'audit-to-screen-history-desktop')
    pane(sid, 'audit')
    time.sleep(0.5)

    def setsel(id_, val):
        n = len(searches())
        js(sid, 'var s=document.getElementById("%s"); s.value=%s; s.dispatchEvent(new Event("change")); true' % (id_, json.dumps(val)))
        wait_search(sid, n)
        return last_q(), audit_rows(sid)

    js(sid, 'document.getElementById("auReset").click(); true')
    time.sleep(1)
    q, rows = setsel('auWhen', 'today')
    tz = hq_scenario.datetime
    import datetime as _dt
    bne_today = (_dt.datetime.now(_dt.timezone.utc) + _dt.timedelta(hours=10)).strftime('%Y-%m-%d')
    start = (_dt.datetime.strptime(bne_today, '%Y-%m-%d') - _dt.timedelta(hours=10)).strftime('%Y-%m-%dT%H:%M:%S')
    ok('Today asks from the start of the Brisbane day', q.get('from', '').startswith(start), (q.get('from'), start))
    ok('...and shows only today\'s entries', all(raw_of(r['key']) is None or raw_of(r['key'])['created_at'] >= q.get('from', '') for r in rows), len(rows))
    q30, rows30 = setsel('auWhen', '30')
    ok('Last 30 days reaches further back than today', q30.get('from') < q.get('from'), (q30.get('from'), q.get('from')))
    js(sid, 'var s=document.getElementById("auWhen"); s.value="custom"; s.dispatchEvent(new Event("change")); true')
    time.sleep(0.5)
    ok('Pick dates shows two date boxes', js(sid, '[].every.call(document.querySelectorAll(".aucustom"), function(x){return !x.hidden;})') is True)
    n = len(searches())
    d_from = (_dt.datetime.strptime(bne_today, '%Y-%m-%d') - _dt.timedelta(days=20)).strftime('%Y-%m-%d')
    d_to = (_dt.datetime.strptime(bne_today, '%Y-%m-%d') - _dt.timedelta(days=15)).strftime('%Y-%m-%d')
    js(sid, 'document.getElementById("auFrom").value="%s"; var t=document.getElementById("auTo"); t.value="%s"; t.dispatchEvent(new Event("change")); true' % (d_from, d_to))
    wait_search(sid, n)
    qc, rowsc = last_q(), audit_rows(sid)
    lo = (_dt.datetime.strptime(d_from, '%Y-%m-%d') - _dt.timedelta(hours=10)).strftime('%Y-%m-%dT%H:%M:%S')
    hi = (_dt.datetime.strptime(d_to, '%Y-%m-%d') + _dt.timedelta(hours=14)).strftime('%Y-%m-%dT%H:%M:%S')
    ok('picked dates ask from the first Brisbane day to the end of the last', qc.get('from', '').startswith(lo) and qc.get('to', '').startswith(hi), qc)
    ok('...and every entry is inside them', rowsc and all(lo <= raw_of(r['key'])['created_at'] < hi + 'Z' for r in rowsc if r['key'].startswith('a')), len(rowsc))
    shot(sid, 'audit-picked-dates-desktop')
    js(sid, 'var s=document.getElementById("auWhen"); s.value="all"; s.dispatchEvent(new Event("change")); true')
    time.sleep(1.5)
    q, rows = setsel('auKind', 'billing')
    ok('What changed: Billing searches billing on the server', q.get('kind') == 'billing', q)
    ok('...and every entry is a billing one', rows and all(r['kind'] == 'Billing and payments' for r in rows), set(r['kind'] for r in rows))
    shot(sid, 'audit-billing-desktop')
    q, rows = setsel('auWho', 'hq')
    ok('Who: Dean and the HQ team, together with Billing', q.get('who') == 'hq' and q.get('kind') == 'billing', q)
    ok('...shows Dean\'s discount and nothing by Stripe', rows and all(r['who'] == 'Dean' for r in rows) and any('discount' in r['say'] for r in rows), rows)
    q, rows = setsel('auKind', '')
    q, rows = setsel('auWho', 'venue')
    ok('Who: a venue shows only the venues\' own logins', rows and all(r['who'].startswith('The venue') for r in rows), set(r['who'] for r in rows))
    q, rows = setsel('auWho', 'system')
    ok('Who: automatic shows only automatic entries', rows and all(r['who'].startswith('Automatic') for r in rows), set(r['who'] for r in rows))
    js(sid, 'document.getElementById("auReset").click(); true')
    time.sleep(1.5)
    ok('Clear filters goes back to the last 7 days, anyone, anything', js(sid, 'document.getElementById("auWhen").value') == '7' and last_q().get('who') is None)

    print('\nGroups: one row each')
    pane(sid, 'groups')
    time.sleep(0.5)
    heads = js(sid, '[].map.call(document.querySelectorAll("#groupList .grow .gn"), function(e){return e.textContent;})') or []
    ok('one row per group and account', len(heads) == 4 and any('Coastline Hotels' in h for h in heads) and any('Deepwater Hotel' in h for h in heads), heads)
    ok('all closed on arrival', js(sid, 'document.querySelectorAll("#groupList .gbody").length') == 0)
    ok('billing at a glance on each row', 'INVOICED BY HAND' in (js(sid, 'document.getElementById("groupList").innerText') or '').upper())
    shot(sid, 'groups-collapsed-desktop')
    click(sid, '[data-gtoggle="%s"]' % hq_scenario.COAST)
    time.sleep(0.3)
    ok('a tap opens Coastline Hotels and shows its venues', 'Coastline Kirra' in (js(sid, 'document.querySelector(\'[data-gid="%s"] .gbody\').innerText' % hq_scenario.COAST) or ''))
    inner = js(sid, '(function(){var g=document.querySelector(\'[data-gid="%s"]\'); return {va:g.querySelectorAll("button[data-viewas]").length, det:g.querySelectorAll("button[data-gdetails]").length, '
                    'rn:g.querySelectorAll("button[data-grename]").length, chk:g.querySelectorAll(".gvchk").length, disc:g.querySelectorAll(".dform").length};})()' % hq_scenario.COAST)
    ok('every action is inside: View as, Details, Rename, the venue ticks, the group discount', inner and inner['va'] == 3 and inner['det'] == 3 and inner['rn'] == 1 and inner['chk'] >= 5 and inner['disc'] == 1, inner)
    click(sid, '[data-gtoggle="acct:f1"]')
    time.sleep(0.3)
    ok('a second group opens and the first stays open', js(sid, 'document.querySelectorAll("#groupList .gbody").length') == 2)
    shot(sid, 'groups-two-open-desktop')
    click(sid, '[data-gtoggle="%s"]' % hq_scenario.COAST)
    time.sleep(0.3)
    ok('a second tap closes it', js(sid, '!document.querySelector(\'[data-gid="%s"] .gbody\')' % hq_scenario.COAST) is True)
    click(sid, '[data-gtoggle="acct:f1"]')
    js(sid, 'var i=document.getElementById("gSearch"); i.value="burleigh"; i.dispatchEvent(new Event("input")); true')
    time.sleep(0.3)
    ok('searching a VENUE finds its group, opened, with the venue picked out',
       js(sid, '[].map.call(document.querySelectorAll("#groupList .grow .gn"), function(e){return e.textContent;})') == ['Coastline Hotels Group'] and
       js(sid, 'document.querySelectorAll("#groupList tr.ghit").length') == 1, js(sid, 'document.getElementById("groupList").innerText'))
    shot(sid, 'groups-search-venue-desktop')
    js(sid, 'var i=document.getElementById("gSearch"); i.value="sunshine"; i.dispatchEvent(new Event("input")); true')
    time.sleep(0.3)
    ok('searching a group name finds the group, still closed', js(sid, 'document.querySelectorAll("#groupList .grow").length') == 1 and js(sid, 'document.querySelectorAll("#groupList .gbody").length') == 0)
    js(sid, 'var i=document.getElementById("gSearch"); i.value=""; i.dispatchEvent(new Event("input")); true')

    print('\nBilling: one line per venue, named')
    pane(sid, 'billing')
    S.until(sid, '!!document.querySelector("#healthList .hline")', 20)
    lines = js(sid, '[].map.call(document.querySelectorAll("#healthList .hline"), function(e){return e.innerText;})') or []
    tug = [l for l in lines if l.startswith('Tugun Bowls Club')]
    ok('Tugun\'s three declines are ONE line, naming the venue', len(tug) == 1 and '3 declines' in tug[0], lines)
    ok('no line says "your VenuePlay subscription" without a venue, or a Stripe id', all('cus_' not in l for l in lines) and all(not l.startswith('your') for l in lines), lines)
    ok('only the ones that need a look by default', all('NEEDS A LOOK' in l.upper() for l in lines), lines)
    click(sid, 'button[data-hopen^="account:f2"]')
    time.sleep(0.3)
    ok('History opens Tugun\'s three attempts', js(sid, 'document.querySelectorAll(\'[data-hkey="account:f2"] .hev\').length') == 3)
    shot(sid, 'billing-health-desktop')
    js(sid, 'var c=document.getElementById("healthAll"); c.checked=true; c.dispatchEvent(new Event("change",{bubbles:true})); true')
    time.sleep(0.3)
    ok('"Show every payment" adds the ones that went through', (js(sid, 'document.querySelectorAll("#healthList .hline").length') or 0) > len(lines), len(lines))

    print('\nCancelled: one line once contacted, and a safe way back')
    pane(sid, 'cancelled')
    S.until(sid, '!!document.querySelector(\'.cxline[data-cxvid="%s"]\')' % LEAVING, 20)
    line = js(sid, '(document.querySelector(\'.cxline[data-cxvid="%s"]\')||{}).innerText' % LEAVING) or ''
    ok('Leaving Lounge, contacted, is one line: name, last day, who rang and when', 'Leaving Lounge' in line and 'last day 30 Oct 2026' in line and 'by Dean' in line, line)
    ok('the ended venue is on the list, not lost for 30 days', 'Ended Bowls' in (js(sid, 'document.getElementById("cxList").innerText') or ''))
    shot(sid, 'cancelled-desktop')
    before_v = json.dumps(S.W.table('vp_venues'), sort_keys=True)
    click(sid, 'button[data-cxinvite="%s"]' % LEAVING)
    S.until(sid, '!!document.getElementById("vpAskGo")', 5)
    ok('Reactivate first says what it will and will not do', 'Nothing is charged' in (js(sid, 'document.body.innerText') or ''))
    click(sid, '#vpAskGo')
    S.until(sid, 'document.body.innerText.indexOf("Sent to leaving@example.com")!==-1', 15)
    inv = [a for a in S.W.table('vp_admin_audit') if a.get('action') == 'venue_invited_back']
    ok('Reactivate goes through the real Worker: an invitation, audited, to the account contact', len(inv) == 1 and inv[0]['detail'].get('to') == 'leaving@example.com', inv)
    ok('...and no venue row changed (nothing switched on, nothing charged)', json.dumps(S.W.table('vp_venues'), sort_keys=True) == before_v)
    js(sid, '(function(){var b=document.querySelector("[id$=Go]"); if(b) b.click();})()')
    time.sleep(0.3)
    click(sid, 'button[data-cxfull="%s"]' % LEAVING)
    time.sleep(0.3)
    ok('Open shows the whole card again', 'It costs too much' in (js(sid, 'document.getElementById("cxList").innerText') or ''))

    print('\nQuiet, Team, Flagged')
    pane(sid, 'quiet')
    S.until(sid, '!!document.querySelector("#quietRows .actcell")', 20)
    ok('the "Venues that have left" panel has its padding back', js(sid, 'parseFloat(getComputedStyle(document.getElementById("archiveCheck").closest(".panel")).paddingLeft)') >= 16)
    tops = js(sid, '[].map.call(document.querySelectorAll("#quietRows .actcell"), function(c){var t=[].map.call(c.querySelectorAll("button"), function(b){return Math.round(b.getBoundingClientRect().top);}); return Math.max.apply(null,t)-Math.min.apply(null,t);})') or [1]
    ok('each row\'s buttons sit in one row', max(tops) <= 2, tops)
    shot(sid, 'quiet-desktop')
    pane(sid, 'team')
    ok('Team shows no raw login ids', '…' not in (js(sid, 'document.getElementById("teamRows").innerText') or '') and js(sid, 'document.querySelectorAll("#paneTeam th").length') == 3)
    pane(sid, 'flagged')
    ft = js(sid, 'document.getElementById("flaggedRows").innerText') or ''
    ok('Flagged names the venue, never "(venue)"', '(venue)' not in ft and 'Connies Country Club' in ft, ft)
    ok('accounts nobody has approved, or that were told no, are drawn (they used to stop the whole page)',
       'NAME ONLY' in (js(sid, 'document.getElementById("optinRows").innerText') or '').upper() and 'NEVER (YOU SAID NO)' in (js(sid, 'document.getElementById("optinRows").innerText') or '').upper())
    errs = js(sid, 'JSON.stringify(window.__errs||[])')
    ok('no script error anywhere on the desktop run', errs == '[]', errs)
    S.close_tab(tid)

    print('\nPhone: every tab fits')
    tid, sid = S.open('/app/hq.html?as=admin', 390, 844, True)
    S.until(sid, 'document.querySelectorAll("#venueRows tr").length > 0', 25)
    time.sleep(2)
    bad = []
    for p in ('venues', 'live', 'quiet', 'cancelled', 'billing', 'groups', 'usage', 'team', 'flagged', 'audit'):
        pane(sid, p)
        time.sleep(1.2)
        if not no_sideways(sid):
            bad.append(p)
        if p in ('audit', 'groups', 'venues', 'billing', 'cancelled', 'quiet'):
            shot(sid, p + '-phone')
    ok('no tab scrolls sideways at 390 pixels', not bad, bad)
    pane(sid, 'venues')
    time.sleep(0.5)
    ok('the venue list fits its box on a phone, nothing hidden off to the side',
       js(sid, '(function(){var t=document.querySelector("#paneVenues table.vtable"); return t.scrollWidth <= t.parentNode.clientWidth + 1;})()') is True,
       js(sid, '(function(){var t=document.querySelector("#paneVenues table.vtable"); return [t.scrollWidth, t.parentNode.clientWidth];})()'))
    pane(sid, 'audit')
    ok('the audit search works on a phone', len(audit_rows(sid)) == 50)
    pane(sid, 'groups')
    click(sid, '[data-gtoggle="%s"]' % hq_scenario.SUNNY)
    time.sleep(0.4)
    ok('a group opens on a phone', js(sid, 'document.querySelectorAll("#groupList .gbody").length') == 1)
    shot(sid, 'groups-open-phone')
    errs = js(sid, 'JSON.stringify(window.__errs||[])')
    ok('no script error on the phone run', errs == '[]', errs)
    S.close_tab(tid)
finally:
    S.close()

total = PASS[0] + FAIL[0]
print('')
print('%d of %d checks passed' % (PASS[0], total))
EXPECTED = 64
if total != EXPECTED:
    print('EXPECTED %d checks and ran %d.' % (EXPECTED, total))
    sys.exit(1)
sys.exit(1 if FAIL[0] else 0)
