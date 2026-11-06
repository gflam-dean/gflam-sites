#!/usr/bin/env python3
"""THE OFFER PAGE'S "HAVE A PLAY FOR FREE" BUTTON, IN CHROME (Dean, 5 Nov 2026, for the 6 Nov release).

A page-only stopgap until the no-card sign-up: on /offer-nov (venueplay/nsw.html, venueplay/_redirects) the hero's
FIRST button is "Have a play for free" and "See pricing" is second. It opens the EXISTING "Talk to us" form with the
topic "Set me up a free account" shown and the message started the same way, and sending it goes through the
existing POST /contact, so the enquiry is an ordinary sales help desk ticket (no new route, no Worker change). The
thank-you line for this topic says when: "Thanks, we'll set up your free account and send it through, usually within
one business day." Plain "Talk to us" is unchanged. The home page never carries the button.

This opens the REAL nsw.html at the REAL address with the REAL billing Worker behind it (tools/browser-rig/admin_site.py,
jsc), at phone and desktop width, and reads the ticket the Worker wrote.

    python3 tools/offer-free-play-in-chrome.test.py [--root CHECKOUT]
"""
import argparse, os, re, sys, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools', 'browser-rig'))
import admin_site  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument('--root', default=ROOT)
A = ap.parse_args()

PASS, FAIL = [0], [0]
TOPIC = 'Set me up a free account'
THANKS = 'Thanks, we’ll set up your free account and send it through, usually within one business day.'


def ok(label, good, detail=''):
    if good:
        PASS[0] += 1
        print('  ok   %s' % label)
    else:
        FAIL[0] += 1
        print('  FAIL %s%s' % (label, ('  (%s)' % (str(detail)[:600],)) if detail != '' else ''))


HERO = ('(function(){var a=[].map.call(document.querySelectorAll("#top .hero-cta a"),function(x){var r=x.getBoundingClientRect();'
        'return {t:x.textContent.trim(),href:x.getAttribute("href"),topic:x.getAttribute("data-topic")||"",'
        'l:Math.round(r.left),r:Math.round(r.right),w:Math.round(r.width),h:Math.round(r.height)};});'
        'return {btns:a,vw:document.documentElement.clientWidth};})()')
FORM = ('(function(){var t=document.getElementById("ct-topic"),m=document.getElementById("ct-message");'
        'return {topicShown:!!t&&!t.hidden&&t.getBoundingClientRect().height>0,topic:t?t.textContent.trim():"",msg:m?m.value:""};})()')
FILL = ('(function(){function v(i,x){document.getElementById(i).value=x;}v("ct-name","Kim Offer");v("ct-email","kim@kirrabeachhotel.com.au");'
        'v("ct-venue","Kirra Beach Hotel");v("ct-postcode","4225");document.getElementById("ct-submit").click();return true;})()')
DONE = ('(function(){var s=document.getElementById("ct-success");return s&&s.classList.contains("show")'
        '?document.getElementById("ct-thanks").textContent.trim():"";})()')


def contact_bodies(S):
    return [b for (p, b) in S.W.calls if p == '/contact']


S = admin_site.Site(root=A.root)
try:
    print('THE ADDRESS IS THE REAL ONE')
    ok('/offer-nov is served from nsw.html (venueplay/_redirects), the file this opens',
       S.rewrites().get('/offer-nov') == '/nsw', S.rewrites().get('/offer-nov'))

    for w, h, mobile in ((390, 844, True), (1280, 900, False)):
        where = '%dpx' % w
        print('\n/offer-nov AT %s: THE BUTTON, THEN THE FORM, THEN THE TICKET' % where)
        n0 = len(contact_bodies(S))
        tid, sid = S.open('/offer-nov', w, h, mobile=mobile)
        S.until(sid, '!!document.getElementById("ct-submit") && document.querySelectorAll("#top .hero-cta a").length>=2', 20)
        time.sleep(0.8)
        v = S.json(sid, HERO, {})
        b = v.get('btns') or []
        ok('%s: the hero\'s first button is "Have a play for free" and opens the Talk to us form' % where,
           len(b) >= 2 and b[0]['t'] == 'Have a play for free' and b[0]['href'] == '#contact' and b[0]['topic'] == 'free-account', b[:1])
        ok('%s: "See pricing" is the second button' % where, len(b) >= 2 and b[1]['t'] == 'See pricing' and b[1]['href'] == '#offer', b[1:2])
        ok('%s: every hero button sits inside the page (no sideways scroll), at least 44px tall' % where,
           b and all(x['l'] >= 0 and x['r'] <= v.get('vw', 0) and x['h'] >= 44 for x in b), b)
        f = S.json(sid, FORM, {})
        ok('%s: before the button, the form has no topic line and an empty message (plain Talk to us)' % where,
           not f.get('topicShown') and f.get('msg') == '', f)
        S.js(sid, 'document.querySelector("#top .hero-cta a[data-topic=free-account]").click(); true')
        S.until(sid, '!document.getElementById("ct-topic").hidden', 5)
        f = S.json(sid, FORM, {})
        ok('%s: the button shows the topic "Set me up a free account" on the form' % where,
           f.get('topicShown') and f.get('topic') == 'Topic: ' + TOPIC, f)
        ok('%s: and starts the message the same way' % where, (f.get('msg') or '').startswith(TOPIC), f.get('msg'))
        S.js(sid, FILL)
        th = S.until(sid, DONE, 15)
        ok('%s: sent, the thank-you says the account comes within one business day, word for word' % where, th == THANKS, th)
        bodies = contact_bodies(S)[n0:]
        ok('%s: it went to the existing POST /contact, once, with the topic leading the message' % where,
           len(bodies) == 1 and (bodies[0].get('message') or '').startswith(TOPIC) and bodies[0].get('venue') == 'Kirra Beach Hotel', bodies)
        S.close_tab(tid)

    print('\nTHE WORKER MADE IT AN ORDINARY SALES TICKET')
    tickets = [t for t in S.W.table('vp_help_tickets') if TOPIC in (t.get('subject') or t.get('title') or '')]
    ok('two sales tickets from the web form, each titled with the topic', len(tickets) == 2
       and all(t.get('category') == 'sales' and t.get('channel') == 'web_form' for t in tickets),
       [(t.get('category'), t.get('channel'), t.get('subject') or t.get('title')) for t in S.W.table('vp_help_tickets')])

    print('\nPLAIN "TALK TO US" IS UNCHANGED')
    n0 = len(contact_bodies(S))
    tid, sid = S.open('/offer-nov', 390, 844, mobile=True)
    S.until(sid, '!!document.getElementById("ct-submit")', 20)
    time.sleep(0.6)
    S.js(sid, 'document.querySelector("#top .hero-cta a[data-cta=hero-contact]").click(); true')
    time.sleep(0.4)
    f = S.json(sid, FORM, {})
    ok('Talk to us shows no topic and leaves the message empty', not f.get('topicShown') and f.get('msg') == '', f)
    S.js(sid, 'document.getElementById("ct-message").value="How does trivia work on a Tuesday?"; true')
    S.js(sid, FILL)
    th = S.until(sid, DONE, 15)
    ok('and its thank-you is the usual one', th == 'Thanks, we\'ve got it and we\'ll be in touch soon.', th)
    bodies = contact_bodies(S)[n0:]
    ok('and the message goes as typed, with no topic added', len(bodies) == 1 and bodies[0].get('message') == 'How does trivia work on a Tuesday?', bodies)
    S.close_tab(tid)
finally:
    S.close()

print('\nTHE HOME PAGE NEVER CARRIES IT; THE WORDS KEEP THE HOUSE RULES')
home = open(os.path.join(A.root, 'venueplay', 'index.html'), encoding='utf-8').read()
ok('index.html has no "Have a play for free" and no free-account topic', 'Have a play for free' not in home and 'free-account' not in home)
page = open(os.path.join(A.root, 'venueplay', 'nsw.html'), encoding='utf-8').read()
new = re.findall(r'Have a play for free|Set me up a free account[^\'"<]*|we\\u2019ll set up your free account[^\'"]*', page)
ok('the new words have no em dash and no capitalised VenuePlay', new and not any('—' in x or 'VenuePlay' in x for x in new), new)

total = PASS[0] + FAIL[0]
print('')
EXPECTED = 23
if total != EXPECTED:
    print('EXPECTED %d checks and ran %d.' % (EXPECTED, total))
    sys.exit(1)
print(('ALL %d CHECKS PASSED' % total) if not FAIL[0] else ('%d of %d checks passed' % (PASS[0], total)))
sys.exit(1 if FAIL[0] else 0)
