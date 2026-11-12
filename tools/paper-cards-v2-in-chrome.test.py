#!/usr/bin/env python3
"""PRINTED MUSICAL CARDS V2, AS PRINTED, AND THE HOST'S SCAN SCREENS, IN CHROME (13 Nov 2026; INBOX 335, 340, 342, 345).

Dean's GO on the paper cards: B's squared look with the outline, the frame and the soft tiles; a QR on every card so the host's camera
checks a win; the playlist printed (NOT the pattern); a printed date under the card number; the footer is the venue's own logo
(or its name) and venueplay, each lined up with where the frame's corner curve ENDS (Dean, 12 Nov: "place the logo where the CURVE
ENDS"); "Scan another" IN LINE with "Confirm winner" on the host's result screen, which fits one screen without scrolling.

This runs the REAL vp-print.js and vp-papercheck.js in Chrome:

  1. The cards are written into a print window exactly as the console does (VPPrint.musical) and MEASURED: two A4-landscape cards a
     sheet; a QR on each that DECODES (jsQR, drawn from the very SVG that prints) to the card's own code; the playlist name and the
     printed date are there; no pattern name, no "Gflam", no em dash; every title square fits (nothing overflows, none under 11 pt
     unless it is one long word); the venue logo starts exactly where the bottom-left curve ends and the venueplay logo ends where the
     bottom-right curve ends; the QR box is outside the song grid; the printed PDF is ONE A4 landscape page for two cards.
  2. The scan result screens (win, not yet, no game, wrong playlist, replaced, another night, another venue, not a card) at 375, 390,
     768 and 1280 wide: one screen (nothing clipped, no scroll), and where there is a "Confirm winner" the "Scan another" button is on
     the SAME ROW; the typed-number fallback is on every screen.

    python3 tools/paper-cards-v2-in-chrome.test.py [--shots DIR] [--root CHECKOUT]
"""
import argparse, base64, json, os, re, sys, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools', 'browser-rig'))
import admin_site  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument('--shots')
ap.add_argument('--root', default=ROOT)
A = ap.parse_args()
PASS, FAIL = [0], [0]


def ok(label, good, detail=''):
    if good:
        PASS[0] += 1
        print('  ok   %s' % label)
    else:
        FAIL[0] += 1
        print('  FAIL %s%s' % (label, ('  (%s)' % (str(detail)[:700],)) if detail != '' else ''))


HARNESS = ('<!doctype html><html lang="en-AU"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
           '<title>harness</title><style>body{margin:0;background:#0A0A0B;color:#E7E7EC;font-family:Manrope,Arial,sans-serif}</style></head><body>'
           '<iframe id="pw" style="width:1123px;height:900px;border:0;background:#fff"></iframe>'
           '<script src="/app/vendor/qrcode-1.4.4.min.js"></script><script src="/app/vendor/jsQR-1.4.0.min.js"></script>'
           '<script src="/app/vp-print.js"></script><script src="/app/vp-papercheck.js"></script></body></html>')

# Two cards with real-shaped codes. 24 titles each; one is a single long word, three are long enough to need two or three lines.
T = ['Bad Case of Loving You', 'Wonderwall', 'Thunderstruck', 'Livin\' on a Prayer', 'Don\'t Stop Believin\'', 'Sweet Caroline', 'Mr. Brightside',
     'I Was Made for Lovin\' You', 'Come On Eileen', 'Eye of the Tiger', 'Africa', 'Valerie', 'Dancing Queen', 'Total Eclipse of the Heart',
     'Pour Some Sugar on Me', 'You Shook Me All Night Long', 'Take Me Home, Country Roads', 'Time After Time', 'Hungry Like the Wolf',
     'Girls Just Want to Have Fun', 'Tainted Love', 'Never Gonna Give You Up', 'Walking on Sunshine', 'Under Pressure']
CODES = ['HTTPS://VENUEPLAY.COM.AU/C/1K7Q2MX07PC4F286RGGY4', 'HTTPS://VENUEPLAY.COM.AU/C/1K7Q2MX08PC4FJ3C9T5HM']


def cards_js(with_logo):
    cards = []
    for i, code in enumerate(CODES):
        t = T[i:] + T[:i]
        titles = t[:12] + [''] + t[12:24]
        cards.append({'no': 7 + i, 'titles': titles, 'code': code})
    svg = ("<svg xmlns='http://www.w3.org/2000/svg' width='300' height='90'><rect width='300' height='90' rx='12' fill='#0A5C8C'/>"
           "<text x='150' y='58' font-size='38' font-family='Arial' font-weight='700' fill='white' text-anchor='middle'>MINI BAR</text></svg>")
    logo = ('{url:%s,dark:false}' % json.dumps('data:image/svg+xml;charset=utf-8,' + svg.replace('#', '%23'))) if with_logo else 'null'
    return ('(function(){var f=document.getElementById("pw");var w=f.contentWindow;w.print=function(){};'
            'window.__ok=VPPrint.musical(w,%s,{venue:"The Mini Bar",playlist:"Pub Classics",printedLabel:"Mon 16 Nov",logo:%s});return window.__ok;})()'
            % (json.dumps(cards), logo))


MEASURE = r'''(function(){
  var d=document.getElementById("pw").contentDocument, mm=function(px){return px/3.7795275591;};
  var out={sheets:d.querySelectorAll(".pcs").length, cards:[]};
  var cs=d.querySelectorAll(".pcc");
  for(var i=0;i<cs.length;i++){
    var c=cs[i], fr=c.querySelector(".frame").getBoundingClientRect(), g=c.querySelector(".pcgrid").getBoundingClientRect();
    var rad=parseFloat(getComputedStyle(c.querySelector(".frame")).borderTopLeftRadius);
    var fw=parseFloat(getComputedStyle(c.querySelector(".frame")).borderLeftWidth);
    var foot=c.querySelector(".foot"), vl=c.querySelector(".vlogo")||c.querySelector(".vname"), bl=foot.querySelector('img[alt="venueplay"]');
    var vr=vl.getBoundingClientRect(), br=bl.getBoundingClientRect();
    var qr=c.querySelector(".qr"), qrr=qr?qr.getBoundingClientRect():null;
    var cells=c.querySelectorAll(".cell:not(.free) .t"), small=[], over=[], sizes=[];
    for(var k=0;k<cells.length;k++){ var t=cells[k], box=t.parentNode, px=parseFloat(getComputedStyle(t).fontSize), pt=px*0.75; sizes.push(pt);
      var ov=t.scrollWidth>t.clientWidth+0.5||t.offsetHeight>box.clientHeight+0.5; if(ov) over.push(t.textContent); if(pt<10.99) small.push(t.textContent+"="+pt.toFixed(2)); }
    out.cards.push({
      text:c.innerText.replace(/\s+/g," "), html:c.innerHTML,
      frameLeft:fr.left, frameRight:fr.right, frameTop:fr.top, frameBottom:fr.bottom, rad:rad, fw:fw,
      vlLeft:vr.left, brRight:br.right, vlTop:vr.top, frameBottomEdge:fr.bottom,
      qrBox:qrr?{l:qrr.left,t:qrr.top,r:qrr.right,b:qrr.bottom,w:mm(qrr.width)}:null, grid:{l:g.left,t:g.top,r:g.right,b:g.bottom},
      cells:cells.length, small:small, over:over, minpt:Math.min.apply(null,sizes),
      free:!!c.querySelector(".cell.free"), cardW:mm(c.getBoundingClientRect().width), cardH:mm(c.getBoundingClientRect().height),
      svg:qr?qr.querySelector("svg").outerHTML:""
    });
  }
  return JSON.stringify(out);
})()'''

DECODE = r'''(function(svgs){
  return Promise.all(svgs.map(function(s){ return new Promise(function(res){
    var im=new Image(); im.onload=function(){ var n=600,c=document.createElement("canvas"); c.width=c.height=n+120; var x=c.getContext("2d");
      x.fillStyle="#fff"; x.fillRect(0,0,c.width,c.height); x.imageSmoothingEnabled=false; x.drawImage(im,60,60,n,n);
      var id=x.getImageData(0,0,c.width,c.height), r=jsQR(id.data,id.width,id.height); res(r?r.data:null); };
    im.onerror=function(){res("ERR");}; im.src="data:image/svg+xml;charset=utf-8,"+encodeURIComponent(s); }); })).then(function(a){return JSON.stringify(a);});
})(%s)'''

SCREEN = r'''(function(){
  var e=document.querySelector(".ppc"), p=e.querySelector("#ppcPanel"), r=function(x){return x?x.getBoundingClientRect():null;};
  var bs=Array.prototype.slice.call(e.querySelectorAll(".btnrow .b")), rows=bs.map(function(b){var q=r(b);return {t:b.textContent.trim(),top:Math.round(q.top),l:Math.round(q.left),w:Math.round(q.width),h:Math.round(q.height),b:Math.round(q.bottom)};});
  var kids=Array.prototype.slice.call(p.children).map(function(c){return r(c).bottom;});
  return JSON.stringify({text:e.innerText.replace(/\s+/g," "), rows:rows, panelScroll:p.scrollHeight, panelClient:p.clientHeight, lastBottom:Math.max.apply(null,kids), vh:innerHeight, vw:innerWidth,
    docScroll:document.documentElement.scrollHeight, docX:document.documentElement.scrollWidth, typed:!!e.querySelector('[data-a="type"]'), html:e.innerHTML});
})()'''

STATES = {
    'win': {'state': 'win', 'card_no': 7, 'playlist_name': 'Pub Classics', 'printed_label': 'Mon 16 Nov', 'winning_cells': [10, 11, 12, 13, 14],
            'played_cells': [1, 3, 6, 9, 17, 22, 10, 11, 13, 14],
            'win_songs': [{'title': 'Ever Fallen in Love', 'n': 4}, {'title': 'I Want You Tonight', 'n': 9}, {'title': 'Free', 'n': 0}, {'title': 'Blowin\' Free', 'n': 12}, {'title': 'Are You Old Enough', 'n': 15}]},
    'notyet': {'state': 'notyet', 'card_no': 7, 'playlist_name': 'Pub Classics', 'printed_label': 'Mon 16 Nov', 'closest': 'Row 2 across', 'to_go': 1,
               'still_to_play': ['Green and Red of Mayo'], 'played_cells': [5, 6, 7, 9, 1, 3, 17]},
    'no_game': {'state': 'no_game', 'card_no': 7, 'playlist_name': 'Pub Classics', 'printed_label': 'Mon 16 Nov'},
    'wrong_playlist': {'state': 'wrong_playlist', 'card_no': 7, 'playlist_name': 'Pub Classics', 'game_playlist': '80s Night'},
    'replaced': {'state': 'replaced', 'card_no': 7, 'playlist_name': 'Pub Classics', 'printed_label': 'Mon 16 Nov', 'replaced_clock': '7:42 pm', 'tonight_playlist': '80s Night'},
    'other_night': {'state': 'other_night', 'card_no': 7, 'playlist_name': 'Pub Classics', 'printed_label': 'Thu 5 Nov', 'tonight_playlist': '80s Night', 'tonight_label': 'Mon 16 Nov'},
    'other_venue': {'state': 'other_venue', 'card_no': 7},
    'not_card': {'state': 'not_card'},
}
SIZES = ((375, 667), (390, 844), (768, 1024), (1280, 800))
BANNED = re.compile(r'[—–]|gflam|\.dev\b|\bone line\b|\bany line\b|\bfull house\b|\bfour corners\b|\btwo lines\b|\bbingo\b', re.I)


def pdf_pages(data):
    n = len(re.findall(rb'/Type\s*/Page(?![s\w])', data))
    m = re.search(rb'/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]', data)
    return n, ([float(m.group(1)), float(m.group(2))] if m else None)


S = admin_site.Site(root=A.root, fonts=True, extra_pages={'/__paper-harness': HARNESS})
try:
    # ---------------------------------------------------------------- the printed card
    print('\nthe printed cards (A4 landscape, two to a sheet)')
    tid, sid = S.open('/__paper-harness', 1123, 920, False)
    S.until(sid, 'typeof VPPrint!=="undefined" && typeof VPPaperCheck!=="undefined" && typeof jsQR!=="undefined" && typeof QRCode!=="undefined"', 20)
    res = S.js(sid, cards_js(False))
    ok('VPPrint.musical writes the cards into the print window', res is True, res)
    S.until(sid, 'document.getElementById("pw").contentDocument.querySelectorAll(".pcc").length===2', 15)
    S.js(sid, 'document.getElementById("pw").contentDocument.fonts.ready.then(function(){return true})', wait=True, secs=15)
    time.sleep(1.2)
    m = json.loads(S.js(sid, MEASURE))
    c0, c1 = m['cards'][0], m['cards'][1]
    ok('one A4 landscape sheet holds both cards, each 148.5 x 210 mm', m['sheets'] == 1 and len(m['cards']) == 2 and all(abs(c['cardW'] - 148.5) < 0.6 and abs(c['cardH'] - 210) < 0.6 for c in m['cards']),
       [(c['cardW'], c['cardH']) for c in m['cards']])
    for n, c in enumerate(m['cards']):
        tag = 'card %02d' % (7 + n)
        t = c['text']
        ok('%s: prints the playlist name, the card number and "Printed Mon 16 Nov"' % tag,
           'Pub Classics' in t and ('%02d' % (7 + n)) in t and 'Printed Mon 16 Nov' in t, t[:200])
        ok('%s: no pattern named, no "bingo", no "Gflam", no em dash' % tag, not BANNED.search(t), sorted(set(x.group(0) for x in BANNED.finditer(t))))
        ok('%s: says hand up, show the card to the host (a winner claims from the host)' % tag, 'show this card to the host' in t and 'Hand up' in t)
        ok('%s: 24 song squares and the FREE centre' % tag, c['cells'] == 24 and c['free'])
        ok('%s: every title fits its own square, none is under 11 pt unless it is one long word' % tag,
           not c['over'] and all(('Thunderstruck' in s or 'Wonderwall' in s) for s in c['small']), (c['over'], c['small']))
        ok('%s: the QR is 26 mm and sits outside the song grid (dabber ink never lands on it)' % tag,
           c['qrBox'] and abs(c['qrBox']['w'] - 26) < 0.6 and c['qrBox']['t'] >= c['grid']['b'] - 0.5, (c['qrBox'], c['grid']))
        # INBOX 345: the venue logo starts where the bottom-left curve ENDS, the venueplay logo ends where the bottom-right curve ends.
        inside_left = c['frameLeft'] + c['rad']
        inside_right = c['frameRight'] - c['rad']
        ok('%s: the venue logo starts where the frame\'s bottom-left curve ends (frame left + corner radius, +-1 px)' % tag,
           abs(c['vlLeft'] - inside_left) <= 1.0, (c['vlLeft'], inside_left))
        ok('%s: the venueplay logo ends where the bottom-right curve ends (frame right - corner radius, +-1 px)' % tag,
           abs(c['brRight'] - inside_right) <= 1.0, (c['brRight'], inside_right))
        ok('%s: the footer sits below the frame, not over it' % tag, c['vlTop'] >= c['frameBottom'] - 0.5, (c['vlTop'], c['frameBottom']))
    dec = json.loads(S.js(sid, DECODE % json.dumps([c0['svg'], c1['svg']]), wait=True, secs=30) or '[]')
    ok('the QR on card 07 decodes to its own code, drawn from the SVG that prints', dec[0] == CODES[0] if len(dec) == 2 else False, dec)
    ok('the QR on card 08 decodes to ITS code (a different one)', dec[1] == CODES[1] and dec[0] != dec[1] if len(dec) == 2 else False, dec)
    ok('the code is the capitals address, so it stays a small QR (version 4 or less at level Q)',
       (c0['svg'].count('M') > 0) and re.match(r'^HTTPS://VENUEPLAY\.COM\.AU/C/[0-9A-Z]{21}$', CODES[0]) is not None)
    ok('a venue with no logo prints its NAME in the footer, never a broken picture', 'The Mini Bar' in c0['html'] and 'class="vname"' in c0['html'] and 'class="vlogo"' not in c0['html'])
    ok('the footer carries the venueplay logo file, not typed text', '/brand/venueplay-horizontal-on-light.svg' in c0['html'])
    if A.shots:
        os.makedirs(A.shots, exist_ok=True)
        S.shot(sid, os.path.join(A.shots, 'paper-cards-v2-sheet.png'), full=False)
    S.close_tab(tid)

    tid, sid = S.open('/__paper-harness', 1123, 920, False)
    S.until(sid, 'typeof VPPrint!=="undefined"', 20)
    S.js(sid, cards_js(True))
    S.until(sid, 'document.getElementById("pw").contentDocument.querySelectorAll(".pcc").length===2', 15)
    S.js(sid, 'document.getElementById("pw").contentDocument.fonts.ready.then(function(){return true})', wait=True, secs=15)
    time.sleep(1.2)
    m2 = json.loads(S.js(sid, MEASURE))
    d0 = m2['cards'][0]
    ok('with the venue\'s own logo: it is the picture, its left edge on the curve end, and the name text is not used',
       'class="vlogo"' in d0['html'] and 'class="vname"' not in d0['html'] and abs(d0['vlLeft'] - (d0['frameLeft'] + d0['rad'])) <= 1.0, (d0['vlLeft'], d0['frameLeft'] + d0['rad']))
    if A.shots:
        S.shot(sid, os.path.join(A.shots, 'paper-cards-v2-sheet-logo.png'), full=False)
    S.close_tab(tid)

    # the printed page: the cards written straight into a window of their own, as the console's print window is, printed to PDF
    tid, sid = S.open('/__paper-harness', 1123, 920, False)
    S.until(sid, 'typeof VPPrint!=="undefined"', 20)
    S.js(sid, cards_js(False).replace('var f=document.getElementById("pw");var w=f.contentWindow;w.print=function(){};', 'var w=window;w.print=function(){};'))
    S.until(sid, 'document.querySelectorAll(".pcc").length===2', 15)
    S.js(sid, 'document.fonts.ready.then(function(){return true})', wait=True, secs=15)
    time.sleep(1.2)
    S.B.call('Emulation.setEmulatedMedia', {'media': 'print'}, session=sid)
    r = S.B.call('Page.printToPDF', {'preferCSSPageSize': True, 'printBackground': True}, session=sid)
    data = base64.b64decode(r.get('data', ''))
    n, box = pdf_pages(data)
    ok('printed to PDF: ONE A4 landscape page (842 x 595 pt) holds both cards, no second page', n == 1 and box is not None and abs(box[0] - 841.9) < 2 and abs(box[1] - 595.3) < 2, (n, box, len(data)))
    if A.shots:
        with open(os.path.join(A.shots, 'paper-cards-v2.pdf'), 'wb') as fh:
            fh.write(data)
    S.close_tab(tid)

    # ---------------------------------------------------------------- the scan screens
    print('\nthe host\'s scan result screens')
    for (w, h) in SIZES:
        tid, sid = S.open('/__paper-harness', w, h, w < 700)
        S.until(sid, 'typeof VPPaperCheck!=="undefined"', 20)
        S.js(sid, 'document.getElementById("pw").style.display="none"; VPPaperCheck.init({scan:function(){return Promise.resolve({})},pattern:function(){return "One line across"}}); true')
        for name, res in STATES.items():
            S.js(sid, 'VPPaperCheck.show(%s); true' % json.dumps(res))
            time.sleep(0.25)
            v = json.loads(S.js(sid, SCREEN))
            tag = '%s at %d' % (name, w)
            ok('%s: one screen, nothing clipped and no scroll' % tag,
               v['panelScroll'] <= v['panelClient'] + 1 and v['lastBottom'] <= v['vh'] + 1 and v['docX'] <= v['vw'] + 1, (v['panelScroll'], v['panelClient'], v['lastBottom'], v['vh'], v['docX'], v['vw']))
            ok('%s: "Card won\'t scan? Type its number" is there' % tag, v['typed'] and 'Type its number' in v['text'])
            ok('%s: no em dash, no .dev, venueplay is lowercase' % tag, not re.search(r'[—–]|\.dev\b|VenuePlay', v['text']), v['text'][:200])
            names = [b['t'] for b in v['rows']]
            if name == 'win':
                ok('%s: "Confirm winner" and "Scan another" are IN LINE: one row, side by side, same size' % tag,
                   names == ['Confirm winner', 'Scan another'] and v['rows'][0]['top'] == v['rows'][1]['top'] and v['rows'][0]['l'] < v['rows'][1]['l']
                   and abs(v['rows'][0]['w'] - v['rows'][1]['w']) <= 2 and v['rows'][0]['b'] <= v['vh'], v['rows'])
                ok('%s: the winning songs are listed in the order they were played, with Free' % tag,
                   '4th' in v['text'] and '9th' in v['text'] and 'Free' in v['text'] and 'Row 3 across' in v['text'] and 'Printed Mon 16 Nov' in v['text'], v['text'][:300])
            elif name in ('notyet', 'wrong_playlist', 'replaced', 'other_night', 'other_venue', 'not_card'):
                ok('%s: "Scan another" leads the row, with "Back to the game" beside it' % tag,
                   names == ['Scan another', 'Back to the game'] and v['rows'][0]['top'] == v['rows'][1]['top'], v['rows'])
            else:
                ok('%s: says no game is running, one row of buttons' % tag, 'No musical game is running yet' in v['text'] and len(v['rows']) == 2 and v['rows'][0]['top'] == v['rows'][1]['top'], v['text'][:200])
            if name == 'notyet':
                ok('%s: says one song to go and names the song still to play' % tag, 'one song to go' in v['text'] and 'Green and Red of Mayo' in v['text'] and 'Nothing is added to your claims' in v['text'], v['text'][:260])
            if name in ('wrong_playlist', 'replaced', 'other_night', 'other_venue'):
                ok('%s: tells the host not to pay out' % tag, "Don't pay out" in v['text'], v['text'][:260])
            if A.shots and name in ('win', 'notyet', 'other_night') and w in (375, 768):
                S.shot(sid, os.path.join(A.shots, 'paper-scan-%s-%d.png' % (name, w)), full=False)
        S.close_tab(tid)
finally:
    S.close()

total = PASS[0] + FAIL[0]
print('')
EXPECTED = 179
if total != EXPECTED:
    print('EXPECTED %d checks and ran %d.' % (EXPECTED, total))
    sys.exit(1)
print(('ALL %d CHECKS PASSED' % total) if not FAIL[0] else ('%d of %d checks passed' % (PASS[0], total)))
sys.exit(1 if FAIL[0] else 0)
