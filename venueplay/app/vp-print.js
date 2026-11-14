/* PRINTED PAPER CARDS AND SHEETS. Dean, 25 Sep 2026: the regulars who will not use a phone play
   musical bingo on a printed card and trivia on a printed answer sheet. One file for both games, so
   the wording a person holds in their hand exists in one place.

   The page opens its window FIRST (VPPrint.open(), inside the click, so no pop-up blocker stops
   it), asks the Worker for the cards, then fills the window with VPPrint.musical() or
   VPPrint.trivia(). Printing is the browser's own dialog; nothing here sends anything.

   The words on the paper are the product's promises, kept plain (Dean: "As long as the paper
   thing is clear"): what to mark, when to hand it in, who to show a win to (the HOST). */
(function () {
  function esc(s){ return String(s==null?"":s).replace(/[&<>"']/g,function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]; }); }

  var CSS =
    /* margin 0 so Chrome prints no date, title or address across the top of a card; the page pads itself */
    '@page{size:A4 portrait;margin:0}' +
    '*{box-sizing:border-box}' +
    'body{margin:0;font-family:Arial,Helvetica,sans-serif;color:#111;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}' +
    '.wait{padding:40px;font-size:18px;text-align:center}' +
    '.sheet{padding:12mm 14mm;page-break-after:always;break-after:page}' +
    '.sheet:last-child{page-break-after:auto;break-after:auto}' +
    '.card{border:2px solid #111;border-radius:6px;padding:5mm;margin-bottom:6mm;page-break-inside:avoid;break-inside:avoid}' +
    '.head{display:flex;justify-content:space-between;align-items:baseline;gap:8px;margin-bottom:3mm}' +
    '.brand{font-weight:800;font-size:13pt}.brand b{color:#FF1F8E}' +
    '.num{font-weight:800;font-size:20pt}' +
    '.how{font-size:9.5pt;line-height:1.35;margin:0 0 3mm}' +
    '.grid{display:grid;grid-template-columns:repeat(5,1fr);border-top:1.5px solid #111;border-left:1.5px solid #111}' +
    '.sq{height:21mm;border-right:1.5px solid #111;border-bottom:1.5px solid #111;display:flex;align-items:center;justify-content:center;text-align:center;padding:1.5mm;font-size:8.5pt;line-height:1.15;font-weight:600;overflow:hidden}' +
    '.free{background:#111;color:#fff;font-weight:800;font-size:11pt}' +
    '.strip{border:2px solid #111;border-radius:6px;padding:4mm 5mm;margin-bottom:5mm;page-break-inside:avoid;break-inside:avoid}' +
    '.cut{border:0;border-top:1.5px dashed #777;margin:0 0 5mm;position:relative}' +
    '.team{font-size:10.5pt;margin:0 0 3mm}.team span{display:inline-block;min-width:60mm;border-bottom:1px solid #111}' +
    'table{width:100%;border-collapse:collapse;font-size:10pt}' +
    'td{padding:1.1mm 1mm;border-bottom:1px solid #ccc}td.q{width:14mm;font-weight:700}' +
    '.box{display:inline-block;width:10mm;height:6mm;border:1.5px solid #111;border-radius:2px;margin-right:4mm;text-align:center;font-weight:700;line-height:6mm;font-size:9pt}' +
    '';

  function open(title) {
    var w = null;
    try { w = window.open('', '_blank'); } catch (e) {}
    if (!w) return null;
    try {
      w.document.open();
      w.document.write('<!doctype html><html lang="en-AU"><head><meta charset="utf-8"><title>' + esc(title) +
        '</title><style>' + CSS + '</style></head><body><div class="wait">Getting your ' + esc(title.toLowerCase()) + ' ready...</div></body></html>');
      w.document.close();
    } catch (e) {}
    return w;
  }

  /* extra: {css, head, ready}. css is added AFTER the shared sheet (so its @page wins), head goes in <head> (the card fonts),
     ready(w) runs once the page is written and may return a promise: the browser's print dialog opens only after it. */
  function fill(w, title, bodyHtml, count, noun, extra) {
    if (!w || w.closed) return false;
    extra = extra || {};
    /* INBOX 392 (Dean, 14 Nov): NO print bar, no text, no button, no count. The console's own Print button is the only control;
       this window opens straight into the print dialog, and cancelling it leaves a page with nothing on it but the cards. */
    w.document.open();
    w.document.write('<!doctype html><html lang="en-AU"><head><meta charset="utf-8"><title>' + esc(title) +
      '</title>' + (extra.head || '') + '<style>' + CSS + (extra.css || '') + '</style></head><body>' + bodyHtml + '</body></html>');
    w.document.close();
    var go = function () { try { w.focus(); setTimeout(function () { try { w.print(); } catch (e) {} }, 400); } catch (e) {} };
    var done = false, once = function () { if (done) return; done = true; go(); };
    try {
      var p = extra.ready ? extra.ready(w) : null;
      if (p && p.then) { p.then(once, once); setTimeout(once, 6000); } else once();
    } catch (e) { once(); }
    return true;
  }

  function fail(w, msg) {
    if (!w || w.closed) return;
    try { w.document.body.innerHTML = '<div class="wait">' + esc(msg) + '</div>'; } catch (e) {}
  }

  /* ---- PAPER CARDS V2 (INBOX 335, 340, 342, 345; layout from reports/musical-cards-print-12nov, 12 Nov 2026) ----
     A4 landscape, two A5 cards to a sheet, cut down the middle. B's squared grid with A's soft tiles inside one strong rounded
     frame; the playlist is printed BIG and the pattern is NOT printed at all; the printed date sits under the card number; a QR
     on every card is the host's scan-to-check code; the footer is the venue's own logo and venueplay, each lined up with the
     point where the frame's corner curve ENDS (the footer is inset by the frame's corner radius). Each square uses the biggest
     size that fits its OWN title (never split a word, never under 11 pt, only a one-long-word title goes smaller than 13 pt). */
  var CARD_FONTS = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Anton&family=Hanken+Grotesk:wght@600;700;800&family=Manrope:wght@500;600;700;800&display=swap">';
  var CARD_CSS =
    '@page{size:297mm 210mm;margin:0}' +
    '.pcs{position:relative;width:297mm;height:210mm;overflow:hidden;background:#fff;break-after:page;page-break-after:always;font-family:Manrope,Arial,sans-serif;color:#0A0A0B}' +
    '.pcs:last-child{break-after:auto;page-break-after:auto}' +
    '.pcs.one .pcc{padding-right:3mm}' +
    '.pccut{position:absolute;left:148.5mm;top:0;bottom:0;border-left:.25mm dashed #8A8A95}' +
    '.pccutlbl{position:absolute;left:148.5mm;top:3mm;transform:translateX(-50%);background:#fff;padding:1mm 0;font:600 6.5pt Manrope,Arial,sans-serif;color:#6A6A74;writing-mode:vertical-rl}' +
    '.pcc{position:absolute;top:0;width:148.5mm;height:210mm;padding:10mm 10mm 7mm;display:flex;flex-direction:column;--fw:1.5mm;--rad:4mm}' +
    '.pcc.L{left:0;padding-right:3mm}.pcc.R{left:148.5mm;padding-left:3mm}' +
    '.pcc .k{font-weight:700;color:#55555E;line-height:1.1}' +
    '.pcc .play{font-family:Anton,Impact,sans-serif;font-weight:400;text-transform:uppercase;line-height:.95;letter-spacing:.005em;overflow-wrap:anywhere}' +
    '.pcc .qr{flex:none;background:#fff}.pcc .qr svg{display:block;width:100%;height:100%}' +
    '.pcc .frame{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;border:var(--fw) solid #0A0A0B;border-radius:var(--rad);overflow:hidden}' +
    '.pcc .gwrap{flex:1 1 auto;min-height:0;display:flex;border-top:var(--fw) solid #0A0A0B;padding:1mm}' +
    '.pcc .pcgrid{flex:1;display:grid;grid-template-columns:repeat(5,minmax(0,1fr));grid-template-rows:repeat(5,minmax(0,1fr));gap:.8mm}' +
    '.pcc .cell{position:relative;display:flex;align-items:center;justify-content:center;text-align:center;min-width:0;min-height:0;overflow:hidden;background:#ECECEF;border-radius:.7mm;padding:1mm .1mm}' +
    '.pcc .cell .t{display:block;width:100%;font-family:"Hanken Grotesk",Arial,sans-serif;font-weight:700;line-height:1.08;letter-spacing:-.015em;word-break:normal;overflow-wrap:normal;hyphens:manual;text-wrap:balance}' +
    /* THE FREE SQUARE SAYS FREE PLAY (Dean, INBOX 385, 14 Nov 2026: a pink play button alone did not tell anyone it was the free
       square; "FREE PLAY" is his name for it). FREE PLAY in black on one line, the small pink play mark above it. The colour is set here on purpose: the old sheet's
       .free rule above made it white, which is how the word vanished from the first V2 card. */
    '.pcc .cell.free{flex-direction:column;gap:.9mm;background:#fff;color:#0A0A0B;box-shadow:inset 0 0 0 .5mm #0A0A0B}' +
    '.pcc .cell.free img{width:4.2mm;height:4.8mm}' +
    '.pcc .cell.free .f{font-family:Anton,Impact,sans-serif;font-weight:400;font-size:13pt;line-height:1;letter-spacing:.03em;white-space:nowrap;color:#0A0A0B}' +
    '.pcc .pcstrip{flex:none;border-top:var(--fw) solid #0A0A0B;display:flex;align-items:center}' +
    '.pcc .pchow{font-weight:600;line-height:1.3;font-size:9pt}.pcc .pchow b{font-weight:800}' +
    '.pcc .nameln{display:flex;align-items:flex-end;gap:2mm;font-weight:700;font-size:9pt;margin-top:2.6mm}.pcc .nameln span{flex:1;border-bottom:.3mm solid #0A0A0B;height:1em}' +
    '.pcc .scanbox{align-self:stretch;border-left:var(--fw) solid #0A0A0B;display:flex;align-items:center;gap:3mm;padding:3mm 3.4mm;background:#F3F3F5}' +
    '.pcc .foot{flex:none;display:flex;align-items:center;justify-content:space-between;gap:6mm;margin-top:3mm;padding:0 var(--rad)}';
  /* The pub's logo box in the footer (/app/vp-paper-style.js): every shape of logo fits it, contained. */
  var LOGO_BOX = { w: 52, h: 17 };   /* INBOX 392 (14 Nov): was 42 x 12, the bottom of the sheet had spare room */

  /* The QR as an SVG string, drawn here from the qrcode library the console page loads. Level Q (a quarter of it can be
     smudged and it still reads), the capitals address so it stays a small code. No margin: the box round it is the quiet zone. */
  function qrSvg(text) {
    var q = window.QRCode && window.QRCode.create ? window.QRCode.create(text, { errorCorrectionLevel: 'Q' }) : null;
    if (!q) return '';
    var n = q.modules.size, d = q.modules.data, path = '';
    for (var r = 0; r < n; r++) {
      var c = 0;
      while (c < n) {
        if (d[r * n + c]) { var s = c; while (c < n && d[r * n + c]) c++; path += 'M' + s + ' ' + r + 'h' + (c - s) + 'v1h-' + (c - s) + 'z'; }
        else c++;
      }
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + n + ' ' + n + '" shape-rendering="crispEdges"><path fill="#0A0A0B" d="' + path + '"/></svg>';
  }

  /* Per square: start at 13 pt and step down 0.25 pt to the 11 pt floor, until the title fits its own square. */
  function fitCells(doc) {
    var els = doc.querySelectorAll('.pcc .cell:not(.free) .t');
    for (var i = 0; i < els.length; i++) {
      var t = els[i], box = t.parentNode, pt = 13;
      t.style.fontSize = pt + 'pt';
      var over = function () { return t.scrollWidth > t.clientWidth + 0.5 || t.offsetHeight > box.clientHeight + 0.5; };
      while (over() && pt > 11) { pt -= 0.25; t.style.fontSize = pt + 'pt'; }
      /* A single long word that still does not fit at 11 pt goes smaller, square by square, never the whole card. Down to 3 pt
         if it must (a 34-letter word, INBOX 385 long-title test): small but whole, never split and never cut off. */
      while (over() && pt > 3) { pt -= 0.25; t.style.fontSize = pt + 'pt'; }
    }
  }

  function playlistSize(name) { var n = String(name || '').length; return n > 22 ? 17 : (n > 16 ? 20 : (n > 11 ? 23 : 25)); }

  /* cards: [{no, titles:[25 strings, '' at the FREE centre], code}] from /host/paper/print (titles already carry the bracket
     rule). o: {venue, playlist, printedLabel, logo:{url,dark}|null}. Two cards to an A4 landscape sheet. */
  function musical(w, cards, o) {
    o = o || {};
    var origin = '';
    try { origin = window.location.origin; } catch (e) {}
    var how = '<b>Mark a song when you hear it.</b> Got the pattern on the TV? Hand up, don\'t call out, and <b>show this card to the host</b>.';
    var PS = window.VPPaperStyle;
    if (!PS) { fail(w, 'The card style did not load. Reload the page and print again.'); return false; }
    var foot = '<div class="foot">' + PS.logoBox(o.logo, o.venue, LOGO_BOX) +
      '<img alt="venueplay" src="' + origin + '/brand/venueplay-horizontal-on-light.svg" style="width:34mm;display:block"></div>';
    function one(c, side) {
      var no = (c.no < 10 ? '0' : '') + c.no, g = '';
      for (var i = 0; i < 25; i++) {
        if (i === 12) { g += '<div class="cell free"><img src="' + origin + '/brand/venueplay-icon-pink.svg" alt=""><span class="f">FREE PLAY</span></div>'; continue; }
        /* SQUARE i SHOWS TITLE i (INBOX 385 (3), 14 Nov 2026). The Worker sends 25 titles with '' at the centre, so the squares
           are read by position. A running count here skipped the centre's '' one square late: the square right of FREE PLAY
           printed blank on every card and every square after it showed its neighbour's song, which is not the card the scan
           judges. Phone, TV and the host's scan all read by position already. */
        g += '<div class="cell"><span class="t">' + esc(c.titles[i] || '') + '</span></div>';
      }
      var qr = c.code ? '<div class="scanbox"><div class="qr" style="width:26mm;height:26mm">' + qrSvg(c.code) + '</div>' +
        '<div style="width:21mm"><div style="font-family:\'Hanken Grotesk\',Arial,sans-serif;font-weight:800;font-size:9.5pt;line-height:1.15">Host scan</div>' +
        '<div class="k" style="font-size:7.5pt;margin-top:1.4mm;line-height:1.25">Card ' + esc(no) + '<br>' + esc(o.playlist || '') + '</div></div></div>' : '';
      /* THE HEADER Dean likes (INBOX 384/385): the black band, the playlist big in white, the card number big on the pink block. */
      return '<div class="pcc ' + side + '"><div class="frame">' +
        PS.head({ kicker: 'Playlist', title: o.playlist || '', titlePt: playlistSize(o.playlist), num: no, numPt: 44, sub: o.printedLabel ? 'Printed ' + o.printedLabel : '' }) +
        '<div class="gwrap"><div class="pcgrid">' + g + '</div></div>' +
        '<div class="pcstrip"><div style="flex:1;padding:3mm 4mm"><div class="pchow">' + how + '</div><div class="nameln">Name <span></span></div></div>' + qr + '</div></div>' + foot + '</div>';
    }
    var html = '';
    for (var i = 0; i < cards.length; i += 2) {
      var two = i + 1 < cards.length;
      html += '<div class="pcs' + (two ? '' : ' one') + '">' + one(cards[i], 'L') + (two ? one(cards[i + 1], 'R') + '<div class="pccut"></div><div class="pccutlbl">cut here</div>' : '') + '</div>';
    }
    return fill(w, 'Musical bingo paper cards', html, cards.length, 'card', {
      css: PS.CSS + CARD_CSS, head: CARD_FONTS,
      ready: function (win) {
        var d = win.document, fonts = d.fonts && d.fonts.ready ? d.fonts.ready : Promise.resolve();
        var imgs = Array.prototype.slice.call(d.images || []).map(function (im) { return im.complete ? 0 : new Promise(function (r) { im.onload = im.onerror = r; }); });
        return Promise.all([fonts].concat(imgs)).then(function () { fitCells(d); });
      }
    });
  }

  /* The venue's logo for the paper: read, measured and given the ink rule by /app/vp-paper-style.js (one copy for every
     printed page). No style file, or a logo that cannot be read: null, and the card prints the venue's NAME instead. */
  function prepLogo(url) { return window.VPPaperStyle ? window.VPPaperStyle.prepLogo(url) : Promise.resolve(null); }

  /* o: {teams, questions, roundSize, venue}. One page per team, a strip per round, cut lines between. */
  function trivia(w, o) {
    var teams = Math.max(1, o.teams | 0), qn = Math.max(1, o.questions | 0), rs = Math.max(1, o.roundSize | 0);
    var rounds = Math.ceil(qn / rs), html = '';
    for (var t = 1; t <= teams; t++) {
      html += '<div class="sheet">';
      for (var r = 1; r <= rounds; r++) {
        var from = (r - 1) * rs + 1, to = Math.min(r * rs, qn);
        if (r > 1) html += '<hr class="cut">';
        html += '<div class="strip"><div class="head"><div class="brand">Trivia' + (o.venue ? ' at ' + esc(o.venue) : '') +
          ' <b>venueplay</b></div><div class="num">Team ' + t + ' &middot; Round ' + r + '</div></div>' +
          '<p class="team">Team name: <span>&nbsp;</span></p>' +
          '<p class="how">Tick one box for each question. When the TV says <b>Paper teams, hand in your sheets</b>, tear off this round and give it to the host. ' +
          'The answers go up on the TV once the host has every sheet, and your score goes on the leaderboard.</p><table>';
        for (var q = from; q <= to; q++) {
          html += '<tr><td class="q">Q' + q + '</td><td><span class="box">A</span><span class="box">B</span><span class="box">C</span><span class="box">D</span></td></tr>';
        }
        html += '</table></div>';
      }
      html += '</div>';
    }
    return fill(w, 'Trivia answer sheets', html, teams, 'team sheet');
  }

  window.VPPrint = { open: open, musical: musical, trivia: trivia, fail: fail, prepLogo: prepLogo, qrSvg: qrSvg };
})();
