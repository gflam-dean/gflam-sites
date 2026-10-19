#!/usr/bin/env python3
"""A VENUE'S LOGO, CHOSEN, SHRUNK, CUT OUT AND SAVED, IN THE REAL PAGE, AGAINST THE REAL WORKER.

Dean, 19 Oct 2026: the logo upload refused anything "over 1 MB", and he wants the background taken
off automatically. Your account > Screen now opens a chosen picture in an editor (venueplay/app/
vp-logo.js): shrunk to 1200px, shown on a checkerboard, "Remove background" (flood fill from the
edges, with a slider), Original still selectable, and Save sends something the Worker will take.
The second "logo option" (a card on Venue settings) is gone; the Screen tab is the one place.

This opens the REAL billing.html in headless Chrome (tools/browser-rig/admin_site.py), with the REAL
billing Worker behind it in jsc, so every saved logo is judged by the real vpbLogoUpload (PNG or WebP
by the bytes, 1 MB or less, sensible size) and what reached storage is read back from the rig.

Pictures are made here, honestly big:
  photo.jpg            a 4000 x 3000 phone photo, about 5 MB
  white-box-logo.png   a dark ring and a pink bar on a slightly noisy white box, stored uncompressed
                       (3.8 MB); the ring's inside is white too and must SURVIVE (edges only)
  see-through.png      a logo that already has a transparent background, 1.3 MB

    python3 tools/logo-tools-in-chrome.test.py
"""
import io, json, os, random, struct, sys, tempfile, time, zlib

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


def png(path, w, h, pixel, alpha=False):
    rows = bytearray()
    for y in range(h):
        rows.append(0)
        for x in range(w):
            rows += bytes(pixel(x, y))
    def chunk(tag, data):
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)
    data = (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6 if alpha else 2, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(bytes(rows), 0)) + chunk(b'IEND', b''))
    with open(path, 'wb') as f:
        f.write(data)
    return len(data)


tmp = tempfile.mkdtemp(prefix='logo-tools-')
rnd = random.Random(7)

# A phone photo: smooth light and colour with sensor noise, as a camera writes it.
from PIL import Image  # noqa: E402  (installed on this Mac; the photo has to be a real JPEG)
PHOTO = os.path.join(tmp, 'photo.jpg')
im = Image.new('RGB', (4000, 3000))
px = im.load()
for y in range(3000):
    for x in range(4000):
        n = rnd.randint(-14, 14)
        px[x, y] = ((x * 255 // 4000 + n) % 256, (y * 255 // 3000 + n) % 256, ((x + y) * 255 // 7000 + n) % 256)
im.save(PHOTO, 'JPEG', quality=95)
photo_bytes = os.path.getsize(PHOTO)

# A logo on a white box: a dark ring (its inside white too) and a pink bar, the white slightly noisy
# the way an exported JPEG-turned-PNG is.
W, H = 1600, 800
CX, CY, R1, R2 = 500, 400, 260, 180
NOISE = [rnd.randint(-14, 14) for _ in range(100 * 50)]
def boxed(x, y):
    d2 = (x - CX) ** 2 + (y - CY) ** 2
    if R2 * R2 <= d2 <= R1 * R1:
        return (20, 20, 24)
    if 900 <= x <= 1400 and 330 <= y <= 470:
        return (255, 31, 142)
    # Blotchy, not speckled: 16px patches each up to 14 levels off white, the way a scanned or
    # re-saved logo's "white" really is. Speckle would be averaged away by the shrink to 1200px.
    v = 240 + NOISE[(y // 16) * 100 + (x // 16)]
    return (v, v, v)
BOXED = os.path.join(tmp, 'white-box-logo.png')
boxed_bytes = png(BOXED, W, H, boxed)

def clear(x, y):
    if 100 <= x <= 700 and 120 <= y <= 280:
        return (255, 255, 255, 255)
    return (0, 0, 0, 0)
CLEAR = os.path.join(tmp, 'see-through.png')
clear_bytes = png(CLEAR, 800, 400, clear, alpha=True)

S = admin_site.Site()
V1 = S.W.info['venue']


def stored():
    return S.W.stored()


def open_screen():
    tid, sid = S.open('/app/billing.html')
    S.until(sid, 'document.getElementById("content").style.display!=="none" && !!document.querySelector(\'[data-tab="screen"]\')', 20)
    S.js(sid, 'document.querySelector(\'[data-tab="screen"]\').click(); true')
    S.until(sid, 'typeof window.VPLogo === "object" && !!document.getElementById("logoFile")', 10)
    time.sleep(1.5)    # the Screen tab asks the Worker for this venue's screen first
    return tid, sid


def choose(sid, path, w, h):
    """Choose a file and wait for THAT picture to be in the editor (the editor may still be open
    on the last one, so "the editor is open" alone proves nothing)."""
    S.js(sid, 'document.getElementById("logoCanvas").width = 1; true')
    S.set_file(sid, '#logoFile', path)
    return S.until(sid, '!document.getElementById("logoEdit").hidden && document.getElementById("logoCanvas").width === %d '
                        '&& document.getElementById("logoCanvas").height === %d' % (w, h), 20)


def save(sid, before):
    S.js(sid, 'document.getElementById("logoSave").click(); true')
    S.until(sid, 'document.getElementById("logoEdit").hidden || /msg err/.test(document.getElementById("msg").className)', 30)
    time.sleep(0.3)
    after = stored()
    return after[len(before):], S.js(sid, 'document.getElementById("msg").textContent')


PIXEL = '(function(x,y){var c=document.getElementById("logoCanvas"),k=c.width/%d;var d=c.getContext("2d").getImageData(Math.floor(x*k),Math.floor(y*k),1,1).data;return [d[0],d[1],d[2],d[3]];})(%d,%d)'

try:
    print('\nany phone photo goes up: shrunk in the browser, under 1 MB, judged by the real Worker')
    tid, sid = open_screen()
    ok('CONTROL: the test photo really is over 1 MB', photo_bytes > 2 * 1024 * 1024, '%d bytes' % photo_bytes)
    ok('choosing it opens the editor instead of refusing it', choose(sid, PHOTO, 1200, 900) is True,
       S.js(sid, 'document.getElementById("msg").textContent'))
    dims = S.js(sid, '[document.getElementById("logoCanvas").width, document.getElementById("logoCanvas").height]')
    ok('it is shrunk to 1200 pixels on its longest side', dims == [1200, 900], dims)
    before = stored()
    new, msg = save(sid, before)
    ok('Save sends it and the real Worker takes it', len(new) == 1 and 'saved' in (msg or '').lower(), msg)
    ok('what reached storage is under 1 MB and a WebP (the photo has no see-through parts)',
       len(new) == 1 and new[0]['bytes'] <= 1024 * 1024 and new[0]['type'] == 'image/webp',
       new and '%d bytes, %s' % (new[0]['bytes'], new[0]['type']))
    ok('nothing said "over 1MB"', 'over 1' not in (S.js(sid, 'document.body.innerText') or '').lower())
    ok('the logo box now shows it', bool(S.js(sid, 'document.getElementById("logoThumb").style.backgroundImage')))

    print('\na logo on a white box: Remove background, from the edges in, with a slider')
    ok('CONTROL: the boxed logo is stored over 1 MB', boxed_bytes > 1024 * 1024, '%d bytes' % boxed_bytes)
    choose(sid, BOXED, 1200, 600)
    ok('Original is shown first, opaque', S.js(sid, PIXEL % (W, 10, 10))[3] == 255, S.js(sid, PIXEL % (W, 10, 10)))
    S.js(sid, 'document.getElementById("logoCutBtn").click(); true')
    time.sleep(0.4)
    corner = S.js(sid, PIXEL % (W, 10, 10))
    far = S.js(sid, PIXEL % (W, 1550, 760))
    ring = S.js(sid, PIXEL % (W, CX + 220, CY))
    inside = S.js(sid, PIXEL % (W, CX, CY))
    bar = S.js(sid, PIXEL % (W, 1150, 400))
    ok('the white box is gone at the corners', corner[3] == 0 and far[3] == 0, [corner, far])
    ok('the ring and the pink bar are kept, solid', ring[3] == 255 and bar[3] == 255 and bar[0] > 200 and bar[1] < 80, [ring, bar])
    ok('the white INSIDE the ring is kept (it never touches an edge)', inside[3] == 255 and inside[0] > 230, inside)
    ok('Original and Background removed are both offered, Background removed chosen',
       S.js(sid, '!document.getElementById("logoModes").hidden && document.getElementById("logoModeCut").checked && !document.getElementById("logoModeOrig").checked'))
    ok('the preview sits on a checkerboard', 'linear-gradient' in (S.js(sid, 'getComputedStyle(document.getElementById("logoPrev")).backgroundImage') or ''))
    # The slider: at 0 only the exact colour goes, so most of a noisy white stays; further right it all goes.
    GONE = ('(function(){var c=document.getElementById("logoCanvas"),d=c.getContext("2d").getImageData(0,0,c.width,c.height).data,n=0;'
            'for(var i=3;i<d.length;i+=4) if(d[i]===0) n++; return Math.round(100*n/(c.width*c.height));})()')
    S.js(sid, 'var t=document.getElementById("logoTol"); t.value="0"; t.dispatchEvent(new Event("input")); true')
    time.sleep(0.5)
    at0 = S.js(sid, GONE)
    S.js(sid, 'var t=document.getElementById("logoTol"); t.value="25"; t.dispatchEvent(new Event("input")); true')
    time.sleep(0.5)
    at25 = S.js(sid, GONE)
    # The white box is about 78% of the picture.
    ok('the slider changes how much is taken (0 leaves most of a blotchy white, 25 takes it all)',
       isinstance(at0, int) and isinstance(at25, int) and at0 < 40 and at25 >= 70, '%s%% then %s%% see-through' % (at0, at25))
    before = stored()
    new, msg = save(sid, before)
    ok('Save with the background removed sends a PNG (it has see-through parts now)',
       len(new) == 1 and new[0]['type'] == 'image/png' and new[0]['bytes'] <= 1024 * 1024,
       new and '%d bytes, %s' % (new[0]['bytes'], new[0]['type']))
    aud = [a for a in S.W.table('vp_admin_audit') if a.get('action') == 'logo_set']
    ok('...and the real Worker read transparency in it', aud and (aud[-1].get('detail') or {}).get('alpha') is True, aud and aud[-1].get('detail'))
    ok('...and no "solid background" warning is shown', S.js(sid, 'document.getElementById("logoHint").hidden') is True)

    print('\nthe original stays one tap away')
    choose(sid, BOXED, 1200, 600)
    S.js(sid, 'document.getElementById("logoCutBtn").click(); true')
    time.sleep(0.3)
    S.js(sid, 'var o=document.getElementById("logoModeOrig"); o.checked=true; o.dispatchEvent(new Event("change")); true')
    time.sleep(0.3)
    ok('choosing Original puts the white box back in the preview', S.js(sid, PIXEL % (W, 10, 10))[3] == 255)
    before = stored()
    new, msg = save(sid, before)
    aud = [a for a in S.W.table('vp_admin_audit') if a.get('action') == 'logo_set']
    ok('Save sends the original, opaque, as a WebP under 1 MB',
       len(new) == 1 and new[0]['type'] == 'image/webp' and new[0]['bytes'] <= 1024 * 1024 and (aud[-1].get('detail') or {}).get('alpha') is False,
       new and '%d bytes, %s' % (new[0]['bytes'], new[0]['type']))
    ok('...and the page says it will show as a box, and how to fix that',
       S.js(sid, '!document.getElementById("logoHint").hidden && /Remove background/.test(document.getElementById("logoHint").textContent)'))

    print('\na logo that is already see-through stays a PNG')
    choose(sid, CLEAR, 800, 400)
    before = stored()
    new, msg = save(sid, before)
    aud = [a for a in S.W.table('vp_admin_audit') if a.get('action') == 'logo_set']
    ok('it goes up as a PNG with its transparency', len(new) == 1 and new[0]['type'] == 'image/png' and (aud[-1].get('detail') or {}).get('alpha') is True,
       new and new[0]['type'])
    ok('Cancel closes the editor and sends nothing', (choose(sid, CLEAR, 800, 400) is True) and
       S.js(sid, 'document.getElementById("logoCancel").click(); document.getElementById("logoEdit").hidden') is True and len(stored()) == len(before) + 1)

    print('\na browser that cannot write WebP (older Safari) still gets under 1 MB')
    fallback = S.js(sid, '''(function(){
      var c=document.createElement("canvas"); c.width=1200; c.height=900; var x=c.getContext("2d"), id=x.createImageData(1200,900), s=7;
      for(var i=0;i<id.data.length;i+=4){ s=(s*1103515245+12345)&0x7fffffff; id.data[i]=s&255; id.data[i+1]=(s>>8)&255; id.data[i+2]=(s>>16)&255; id.data[i+3]=255; }
      x.putImageData(id,0,0);
      var real=HTMLCanvasElement.prototype.toDataURL;
      HTMLCanvasElement.prototype.toDataURL=function(t,q){ return real.call(this, t==="image/webp" ? "image/png" : t, q); };
      return VPLogo.encode(c).then(function(o){ HTMLCanvasElement.prototype.toDataURL=real; return JSON.stringify({type:o.type, bytes:o.bytes, w:o.width}); },
                                   function(e){ HTMLCanvasElement.prototype.toDataURL=real; return JSON.stringify({error:String(e.message)}); });
    })()''', wait=True, secs=60)
    fb = json.loads(fallback) if isinstance(fallback, str) else {}
    ok('pure noise with no WebP comes back a PNG, smaller, under the limit',
       fb.get('type') == 'image/png' and 0 < fb.get('bytes', 0) <= 950 * 1024 and fb.get('w', 9999) < 1200, fb)
    errs = S.js(sid, 'JSON.stringify(window.__errs||[])')
    ok('no script error on the page', errs == '[]', errs)
    S.close_tab(tid)

    print('\none place for the logo')
    tid, sid = S.open('/app/settings.html?venue=' + V1)
    S.until(sid, 'document.readyState==="complete" && !!document.getElementById("saveBtn")', 15)
    time.sleep(1.5)
    ok('Venue settings no longer has a logo card', S.js(sid, '!document.getElementById("logoSignpost") && !/Your logo/i.test(document.body.innerText)') is True)
    S.close_tab(tid)
    tid, sid = open_screen()
    ok('Your account > Screen still has it', S.js(sid, '!!document.getElementById("logoCard") && document.getElementById("logoCard").offsetParent!==null') is True)
    S.close_tab(tid)
finally:
    S.close()

total = PASS[0] + FAIL[0]
print('')
print('%d of %d checks passed' % (PASS[0], total))
EXPECTED = 27
if total != EXPECTED:
    print('EXPECTED %d checks and ran %d.' % (EXPECTED, total))
    sys.exit(1)
sys.exit(1 if FAIL[0] else 0)
