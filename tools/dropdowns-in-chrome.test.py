#!/usr/bin/env python3
"""EVERY DROPDOWN ON THE ADMIN PAGES IS ON BRAND, MEASURED IN A REAL BROWSER, AT DESK AND PHONE WIDTH.

Dean, 19 Oct 2026: the customer-facing admin dropdowns, and the show manager's, look off-brand.
Some were the browser's own light-grey control on a black page; some had a dark box and no arrow,
because a page rule's `background:` shorthand wiped the drawn arrow. venueplay/app/vp-select.css is
now the one rule set, linked last on every admin page with a dropdown; touring/manage.html has its
own in the touring brand.

This opens the REAL pages (tools/browser-rig/admin_site.py: the real billing Worker behind them, a
stand-in supabase-js, nothing else changed) in headless Chrome at 1280px and as an iPhone (390px,
mobile, iPhone user agent), gets each screen to where its dropdowns are, and asks the browser what it
PAINTS for every <select> in the page: the computed appearance, arrow image, colours, padding, the
open-list colour scheme, the focus ring, and on a phone a 16px font (iOS zooms into anything smaller).
It also runs, on the same pages:
  - Your account's opening line (Dean, 19 Oct: "Reductions" read as "deductions")
  - HQ's "Unlimited trivia and musical bingo nights" switch, clicked, through the real Worker,
    which must flip the venue and write the audit row

NOT CHECKED HERE: real iOS Safari. There is no headless WebKit on this Mac; the iPhone pass is Chrome
emulating one. The rules use the -webkit- prefixed and standard forms that Safari honours.

    python3 tools/dropdowns-in-chrome.test.py
    python3 tools/dropdowns-in-chrome.test.py --shots DIR --label after [--root CHECKOUT] [--no-checks]
"""
import argparse, json, os, sys, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools', 'browser-rig'))
import admin_site  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument('--root', default=ROOT)
ap.add_argument('--shots')
ap.add_argument('--label', default='after')
ap.add_argument('--no-checks', action='store_true')
A = ap.parse_args()
CHECK = not A.no_checks

PASS, FAIL = [0], [0]


def ok(label, good, detail=''):
    if not CHECK:
        return
    if good:
        PASS[0] += 1
        print('  ok   %s%s' % (label, ('  (%s)' % detail) if detail else ''))
    else:
        FAIL[0] += 1
        print('  FAIL %s%s' % (label, ('  (%s)' % detail) if detail else ''))


S = admin_site.Site(root=A.root, fonts=bool(A.shots))
V1 = S.W.info['venue']

# ---- what each screen must do to show its dropdowns ----------------------------------------
def tab(name):
    return lambda sid: (S.until(sid, '!!document.querySelector(\'[data-tab="%s"]\') && document.getElementById("content").style.display!=="none"' % name, 20),
                        S.js(sid, 'document.querySelector(\'[data-tab="%s"]\').click(); true' % name), time.sleep(1.2))


def console_bingo(sid):
    S.until(sid, 'document.querySelectorAll("#venuePickList button, #venuePickList [data-id], #venuePickList a").length > 0', 20)
    S.js(sid, '(function(){var b=document.querySelector("#venuePickList button, #venuePickList [data-id], #venuePickList a"); if(b) b.click(); return true;})()')
    S.until(sid, '!!document.querySelector(\'[data-game="bingo"]\') && document.querySelector(\'[data-game="bingo"]\').offsetParent!==null', 20)
    S.js(sid, 'document.querySelector(\'[data-game="bingo"]\').click(); true')
    S.until(sid, '!!document.getElementById("paidSel") && document.getElementById("paidSel").offsetParent!==null', 10)
    time.sleep(0.6)


def hq_details(sid):
    S.until(sid, 'document.querySelectorAll("button[data-details]").length > 0', 20)
    S.js(sid, 'document.querySelector("button[data-details]").click(); true')
    S.until(sid, '!!document.querySelector("select.gament") && document.querySelector("select.gament").offsetParent!==null', 10)
    time.sleep(0.4)


def touring(sid):
    S.until(sid, '!!document.getElementById("pinInput") && typeof submitPin === "function" && document.readyState === "complete"', 15)
    for _ in range(3):
        S.js(sid, 'document.getElementById("pinInput").value="pw"; submitPin(); true')
        if S.until(sid, '!!document.querySelector(".afield select")', 8):
            break
    time.sleep(0.5)


def settle(sid):
    time.sleep(2.5)


def builder_questions(sid):
    """The builder's dropdowns live on step 2 (Questions), behind a night that has been started.
    Starting one writes to the database, which this stand-in does not keep, so the step is opened
    the way goStep(2) does it and the library panel is opened with its own button."""
    time.sleep(2.5)
    S.js(sid, 'document.getElementById("step1").classList.add("hidden"); document.getElementById("step2").classList.remove("hidden");'
              'document.querySelector(\'#step2 [data-panel="lib"]\').click(); true')
    time.sleep(0.5)


SCENES = [
    # name, path, prepare, brand
    ('account-screen', '/app/billing.html', tab('screen'), 'vp'),
    ('account-draws', '/app/billing.html', tab('draws'), 'vp'),
    ('account-nights', '/app/billing.html', tab('nights'), 'vp'),
    ('hq-venue-details', '/app/hq.html?as=admin', hq_details, 'vp'),
    ('console-bingo-setup', '/app/', console_bingo, 'vp'),
    ('members-draw', '/app/members/host.html?venue=' + V1, settle, 'vp'),
    ('musical-setup', '/app/musical/host.html?venue=' + V1, settle, 'vp'),
    ('trivia-setup', '/app/trivia/host.html?venue=' + V1, settle, 'vp'),
    ('trivia-builder', '/app/trivia/builder.html?venue=' + V1, builder_questions, 'vp'),
    ('onboard', '/app/onboard.html?as=admin', settle, 'vp'),
    ('marketing', '/app/marketing.html', settle, 'vp'),
    ('touring-show-manager', '/touring/manage.html', touring, 'touring'),
]
RING = {'vp': '255, 31, 142', 'touring': '254, 101, 195'}

MEASURE = r'''(function(){
  function lum(c){ var m=/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?/.exec(c||''); if(!m) return null;
    var a=m[4]==null?1:+m[4]; var r=+m[1],g=+m[2],b=+m[3];
    /* a translucent box sits on a dark page: blend with the page's own background */
    var bg=getComputedStyle(document.body).backgroundColor, n=/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)/.exec(bg)||[0,10,10,11];
    r=r*a+(+n[1])*(1-a); g=g*a+(+n[2])*(1-a); b=b*a+(+n[3])*(1-a);
    return (0.2126*r+0.7152*g+0.0722*b)/255; }
  var out=[];
  [].forEach.call(document.querySelectorAll("select"), function(s){
    var cs=getComputedStyle(s);
    var multi = s.multiple || (s.size && s.size>1);
    var o=s.options[0] ? getComputedStyle(s.options[0]) : null;
    out.push({ id: s.id || s.className || s.name || "(no id)", visible: !!(s.offsetParent || s.getClientRects().length),
      appearance: cs.appearance || cs.webkitAppearance, arrow: multi ? "n/a" : cs.backgroundImage,
      bg: lum(cs.backgroundColor), fg: lum(cs.color), scheme: cs.colorScheme, pr: parseFloat(cs.paddingRight),
      radius: parseFloat(cs.borderTopLeftRadius), font: parseFloat(cs.fontSize), multi: !!multi,
      optbg: o ? lum(o.backgroundColor) : null, optfg: o ? lum(o.color) : null });
  });
  return JSON.stringify(out);
})()'''


def judge(rows, phone):
    bad = []
    for r in rows:
        why = []
        if r['appearance'] != 'none': why.append('native control (appearance %s)' % r['appearance'])
        if not r['multi'] and 'svg' not in (r['arrow'] or ''): why.append('no drawn arrow')
        if r['bg'] is None or r['bg'] > 0.2: why.append('box not dark (%s)' % r['bg'])
        if r['fg'] is None or r['fg'] < 0.6: why.append('text not light (%s)' % r['fg'])
        if 'dark' not in (r['scheme'] or ''): why.append('open list not dark (color-scheme %s)' % r['scheme'])
        if not r['multi'] and r['pr'] < 30: why.append('text runs under the arrow (padding-right %s)' % r['pr'])
        if r['radius'] < 5: why.append('square corners')
        if r['optfg'] is not None and r['optbg'] is not None and r['optfg'] - r['optbg'] < 0.4:
            why.append('options unreadable')
        if phone and r['font'] < 16: why.append('%spx text: iOS zooms the page' % r['font'])
        if why:
            bad.append('%s: %s' % (r['id'], ', '.join(why)))
    return bad


def shoot(sid, name, width_name):
    if not A.shots:
        return
    os.makedirs(A.shots, exist_ok=True)
    S.js(sid, '(function(){var s=[].filter.call(document.querySelectorAll("select"),function(x){return x.offsetParent;})[0];'
              'if(s) s.scrollIntoView({block:"center"}); return true;})()')
    time.sleep(0.4)
    S.shot(sid, os.path.join(A.shots, '%s-%s-%s.png' % (A.label, name, width_name)))


try:
    print('\nevery dropdown, on every admin page, at desk and phone width')
    for name, path, prep, brand in SCENES:
        for width_name, w, h, mobile in (('desktop-chrome', 1280, 900, False), ('iphone-emulated', 390, 844, True)):
            tid, sid = S.open(path, w, h, mobile)
            try:
                prep(sid)
                rows = json.loads(S.js(sid, MEASURE) or '[]')
                vis = [r for r in rows if r['visible']]
                bad = judge(rows, mobile)
                ok('%s at %s: every dropdown on brand' % (name, width_name), rows and vis and not bad,
                   ('%d dropdowns, %d on screen' % (len(rows), len(vis))) if not bad else '; '.join(bad[:3]))
                if not mobile:
                    S.js(sid, '(function(){var s=[].filter.call(document.querySelectorAll("select"),function(x){return x.offsetParent && !x.disabled;})[0];'
                              'if(s) s.focus(); return true;})()')
                    time.sleep(0.6)   # several pages fade the ring in over 0.2s; read it once it has landed
                    ring = S.js(sid, '(function(){var s=document.activeElement; if(!s || s.tagName!=="SELECT") return "no select focused";'
                                     'return getComputedStyle(s).boxShadow + " | " + getComputedStyle(s).borderTopColor;})()')
                    ok('%s: a focused dropdown gets the brand focus ring' % name, isinstance(ring, str) and RING[brand] in ring, ring)
                    S.js(sid, 'document.activeElement && document.activeElement.blur(); true')
                shoot(sid, name, width_name)
                errs = S.js(sid, 'JSON.stringify(window.__errs||[])')
                if errs not in ('[]', None) and CHECK:
                    print('       (page errors: %s)' % errs[:200])
            finally:
                S.close_tab(tid)

    if CHECK:
        print('\nYour account says what happens when you add or lower, in plain words')
        tid, sid = S.open('/app/billing.html')
        S.until(sid, 'document.getElementById("content").style.display!=="none" && /venues/.test(document.getElementById("lede").textContent)', 20)
        lede = S.js(sid, 'document.getElementById("lede").textContent')
        ok('the monthly account intro is the new sentence, word for word',
           lede == ("Your plan, venues, hosts and next payment. You can add players or venues anytime and they apply straight away. "
                    "If you lower your players or remove a venue, that change applies from your next renewal, so you're never left short."), lede)
        ok('"Reductions" is nowhere on the page', 'Reductions' not in (S.js(sid, 'document.body.innerText') or 'Reductions'))
        S.close_tab(tid)

        print('\nHQ: the unlimited nights switch, clicked, through the real Worker')
        S.W.seed('vp_platform_admins', [{'auth_user_id': S.W.info['uid'], 'role': 'owner', 'label': 'Dean'}])
        tid, sid = S.open('/app/hq.html?as=admin')
        hq_details(sid)
        box = 'document.querySelector(\'input.weeklyoff[data-vid="%s"]\')' % V1
        label = S.js(sid, '(function(){var b=%s; return b ? b.closest("label").textContent.trim() + "|" + b.checked + "|" + b.disabled : "none";})()' % box)
        ok('the Details panel shows "Unlimited trivia and musical bingo nights", off', label == 'Unlimited trivia and musical bingo nights|false|false', label)
        S.js(sid, '%s.click(); true' % box)
        S.until(sid, '!!%s && %s.checked && !%s.disabled' % (box, box, box), 10)
        row = [v for v in S.W.table('vp_venues') if v['id'] == V1]
        ok('clicking it switches the venue on in the database, through /admin/venue-gaming',
           row and row[0].get('weekly_limit_off') is True, row and row[0].get('weekly_limit_off'))
        aud = [a for a in S.W.table('vp_admin_audit') if a.get('action') == 'venue_unlimited_nights_on']
        ok('and the audit log records who, which venue and from off to on',
           len(aud) == 1 and aud[0].get('actor_label') == 'Dean' and aud[0].get('target') == 'venue:' + V1 and
           (aud[0].get('detail') or {}).get('to') is True, aud)
        note = S.js(sid, '%s.closest("div").querySelector(".note").textContent' % box)
        ok('the panel now says it is ON', isinstance(note, str) and note.startswith('ON:'), note)
        S.js(sid, '%s.click(); true' % box)
        S.until(sid, '!!%s && !%s.checked && !%s.disabled' % (box, box, box), 10)
        row = [v for v in S.W.table('vp_venues') if v['id'] == V1]
        ok('clicking again switches it off, and that is recorded too',
           row and row[0].get('weekly_limit_off') is False and
           len([a for a in S.W.table('vp_admin_audit') if a.get('action') == 'venue_unlimited_nights_off']) == 1,
           row and row[0].get('weekly_limit_off'))
        S.close_tab(tid)
finally:
    S.close()

if CHECK:
    total = PASS[0] + FAIL[0]
    print('')
    print('%d of %d checks passed' % (PASS[0], total))
    EXPECTED = len(SCENES) * 3 + 2 + 5
    if total != EXPECTED:
        print('EXPECTED %d checks and ran %d.' % (EXPECTED, total))
        sys.exit(1)
    sys.exit(1 if FAIL[0] else 0)
print('shots written to %s' % A.shots)
