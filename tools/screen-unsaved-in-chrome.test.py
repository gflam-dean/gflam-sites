#!/usr/bin/env python3
"""NOTHING A VENUE CHOOSES FOR ITS TV IS LOST WITHOUT IT KNOWING (Dean, 21 Oct 2026).

Tugun Bowls Club's logo was chosen on Your account > Screen, shown in the preview, and never saved:
"Save logo" was a separate step and leaving the page dropped it in silence. A slide image was the
same, waiting on "Save screen". This opens the REAL billing.html in headless Chrome against the REAL
billing Worker (tools/browser-rig/admin_site.py) and checks:

  logo     choosing a file saves it at once (the real Worker stores it and writes the screen row),
           with no Save pressed; the editor stays open so Remove background is a second save; a
           removed background not yet saved puts up the "not saved yet" bar and the page asks before
           it is left; the bar's Save logo saves it and the bar goes
  slides   an uploaded slide image is saved onto the screen at once; changing a slide's seconds puts
           up the bar with Save screen and the page asks before it is left; saving clears both
  venue    switching to another venue with changes unsaved asks first, and Stay keeps you there

    python3 tools/screen-unsaved-in-chrome.test.py
"""
import os, struct, sys, tempfile, time, zlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools', 'browser-rig'))
import admin_site  # noqa: E402

PASS, FAIL = [0], [0]


def ok(label, good, detail=''):
    if good:
        PASS[0] += 1
        print('  ok   %s' % label)
    else:
        FAIL[0] += 1
        print('  FAIL %s%s' % (label, ('  (%s)' % (str(detail)[:300],)) if detail != '' else ''))


def png(path, w, h, pixel):
    rows = bytearray()
    for y in range(h):
        rows.append(0)
        for x in range(w):
            rows += bytes(pixel(x, y))
    def chunk(tag, data):
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)
    with open(path, 'wb') as f:
        f.write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0))
                + chunk(b'IDAT', zlib.compress(bytes(rows), 6)) + chunk(b'IEND', b''))


tmp = tempfile.mkdtemp(prefix='screen-unsaved-')
LOGO = os.path.join(tmp, 'boxed.png')
png(LOGO, 400, 200, lambda x, y: (255, 255, 255) if (x < 60 or x > 340 or y < 40 or y > 160) else (255, 31, 142))
SLIDE = os.path.join(tmp, 'slide.png')
png(SLIDE, 320, 180, lambda x, y: ((x * 3) % 256, (y * 5) % 256, 120))

S = admin_site.Site()
V1 = S.W.info['venue']


def screen_rows():
    return [r for r in S.W.table('vp_venue_screen') if r.get('venue_id') == V1]


def latest():
    rows = screen_rows()
    return rows[-1] if rows else {}


def bar(sid):
    return S.js(sid, '(function(){var b=document.getElementById("unsavedBar"); return b && !b.hidden ? document.getElementById("unsavedSay").textContent : "";})()')


LEAVE = '(function(){var e=new Event("beforeunload",{cancelable:true}); window.dispatchEvent(e); return e.defaultPrevented;})()'

try:
    tid, sid = S.open('/app/billing.html')
    S.until(sid, 'document.getElementById("content").style.display!=="none" && !!document.querySelector(\'[data-tab="screen"]\')', 20)
    S.js(sid, 'document.querySelector(\'[data-tab="screen"]\').click(); true')
    S.until(sid, 'typeof window.VPLogo === "object" && !!document.getElementById("logoFile")', 10)
    time.sleep(1.5)
    ok('a clean page lets you leave without asking', S.js(sid, LEAVE) is False and bar(sid) == '')

    print('\nthe logo saves itself when chosen')
    n0 = len(S.W.stored())
    S.set_file(sid, '#logoFile', LOGO)
    S.until(sid, 'document.getElementById("logoThumb").style.backgroundImage.indexOf("venue-logos")!==-1', 25)
    ok('choosing the file stored it, with no Save pressed', len(S.W.stored()) == n0 + 1, len(S.W.stored()) - n0)
    ok('...and the real Worker put it on the screen', 'venue-logos' in str(latest().get('logo_url') or ''), latest())
    ok('...the logo box shows it, and nothing is waiting to be saved', bar(sid) == '' and S.js(sid, LEAVE) is False, bar(sid))
    ok('the editor stays open, so Remove background is one tap away', S.js(sid, '!document.getElementById("logoEdit").hidden') is True)
    first = latest().get('logo_url')
    S.js(sid, 'document.getElementById("logoCutBtn").click(); true')
    time.sleep(0.4)
    ok('a removed background that is not saved yet puts up the bar', 'not saved yet' in bar(sid), bar(sid))
    ok('...and the page asks before it is left', S.js(sid, LEAVE) is True)
    S.js(sid, 'document.getElementById("unsavedLogo").click(); true')
    S.until(sid, 'document.getElementById("unsavedBar").hidden', 25)
    time.sleep(0.5)
    ok('Save logo on the bar saves the cut-out version', latest().get('logo_url') and latest().get('logo_url') != first, [first, latest().get('logo_url')])
    ok('...and the bar goes, and leaving is free again', bar(sid) == '' and S.js(sid, LEAVE) is False)

    print('\na slide image is saved onto the screen as soon as it is up')
    S.js(sid, 'document.getElementById("addSlide").click(); true')
    time.sleep(0.3)
    S.set_file(sid, '#slides .adslide:last-child .ad-file', SLIDE)
    S.until(sid, '!!document.querySelector("#slides .adslide:last-child").getAttribute("data-url")', 25)
    S.until(sid, 'true', 2)
    slides = latest().get('slides') or []
    ok('the uploaded image is on the screen row without Save screen', len(slides) == 1 and 'venue-ads' in slides[0].get('image_url', ''), latest())
    ok('...and nothing is waiting', bar(sid) == '' and S.js(sid, LEAVE) is False, bar(sid))
    S.js(sid, 'var i=document.querySelector("#slides .ad-secs"); i.value="15"; i.dispatchEvent(new Event("input",{bubbles:true})); true')
    time.sleep(0.2)
    ok('changing its seconds puts up the bar with Save screen', 'slide changes are not saved' in bar(sid).lower() and
       S.js(sid, '!document.getElementById("unsavedScreen").hidden') is True, bar(sid))
    ok('...and the page asks before it is left', S.js(sid, LEAVE) is True)

    print('\nswitching venue with changes unsaved asks first')
    S.js(sid, 'var s=document.getElementById("screenVenue"); s.value=s.options[1].value; s.dispatchEvent(new Event("change")); true')
    S.until(sid, '!!document.getElementById("vpAskGo")', 5)
    ok('it asks before leaving this venue\'s changes behind', 'without saving' in (S.js(sid, 'document.body.innerText') or ''))
    S.js(sid, 'document.getElementById("vpAskCancel").click(); true')
    time.sleep(0.5)
    ok('Stay keeps you on the same venue with the change still there', S.js(sid, 'document.getElementById("screenVenue").value') == V1 and
       S.js(sid, 'document.querySelector("#slides .ad-secs").value') == '15')
    S.js(sid, 'document.getElementById("unsavedScreen").click(); true')
    S.until(sid, 'document.getElementById("unsavedBar").hidden', 25)
    time.sleep(0.4)
    ok('Save screen on the bar saves the 15 seconds and clears the bar', (latest().get('slides') or [{}])[0].get('seconds') == 15 and bar(sid) == '' and
       S.js(sid, LEAVE) is False, latest())
    errs = S.js(sid, 'JSON.stringify(window.__errs||[])')
    ok('no script error', errs == '[]', errs)
    S.close_tab(tid)
finally:
    S.close()

total = PASS[0] + FAIL[0]
print('')
print('%d of %d checks passed' % (PASS[0], total))
EXPECTED = 17
if total != EXPECTED:
    print('EXPECTED %d checks and ran %d.' % (EXPECTED, total))
    sys.exit(1)
sys.exit(1 if FAIL[0] else 0)
