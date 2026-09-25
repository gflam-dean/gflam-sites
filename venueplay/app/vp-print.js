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
    '@page{size:A4 portrait;margin:12mm}' +
    '*{box-sizing:border-box}' +
    'body{margin:0;font-family:Arial,Helvetica,sans-serif;color:#111;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}' +
    '.bar{position:sticky;top:0;display:flex;gap:12px;align-items:center;justify-content:space-between;padding:12px 16px;background:#111;color:#fff;font-size:15px}' +
    '.bar button{font:inherit;font-weight:700;padding:10px 18px;border:0;border-radius:8px;background:#FF1F8E;color:#fff;cursor:pointer}' +
    '.wait{padding:40px;font-size:18px;text-align:center}' +
    '.sheet{padding:0 2mm;page-break-after:always;break-after:page}' +
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
    '@media print{.bar{display:none}}';

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

  function fill(w, title, bodyHtml, count, noun) {
    if (!w || w.closed) return false;
    var bar = '<div class="bar"><span>' + count + ' ' + noun + (count === 1 ? '' : 's') + ' ready. Print them before the night starts.</span>' +
      '<button type="button" onclick="window.print()">Print</button></div>';
    w.document.open();
    w.document.write('<!doctype html><html lang="en-AU"><head><meta charset="utf-8"><title>' + esc(title) +
      '</title><style>' + CSS + '</style></head><body>' + bar + bodyHtml + '</body></html>');
    w.document.close();
    try { w.focus(); setTimeout(function () { try { w.print(); } catch (e) {} }, 400); } catch (e) {}
    return true;
  }

  function fail(w, msg) {
    if (!w || w.closed) return;
    try { w.document.body.innerHTML = '<div class="wait">' + esc(msg) + '</div>'; } catch (e) {}
  }

  /* cards: [{no, titles:[25 strings, '' at the FREE centre]}]. Two cards to an A4 page. */
  function musical(w, cards, o) {
    o = o || {};
    var html = '';
    for (var i = 0; i < cards.length; i += 2) {
      html += '<div class="sheet">';
      for (var j = i; j < Math.min(i + 2, cards.length); j++) {
        var c = cards[j];
        html += '<div class="card"><div class="head"><div class="brand">Musical bingo' + (o.venue ? ' at ' + esc(o.venue) : '') +
          ' <b>VenuePlay</b></div><div class="num">Card ' + esc(c.no) + '</div></div>' +
          '<p class="how">Mark a square when you hear that song. When you have the pattern the host calls, call out and <b>show this card to the host</b>. ' +
          'The host checks it by typing in card number <b>' + esc(c.no) + '</b>.' + (o.playlist ? ' Playlist: ' + esc(o.playlist) + '.' : '') + '</p><div class="grid">';
        for (var k = 0; k < 25; k++) {
          html += (k === 12) ? '<div class="sq free">FREE</div>' : '<div class="sq">' + esc(c.titles[k] || '') + '</div>';
        }
        html += '</div></div>';
      }
      html += '</div>';
    }
    return fill(w, 'Musical bingo paper cards', html, cards.length, 'card');
  }

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
          ' <b>VenuePlay</b></div><div class="num">Team ' + t + ' &middot; Round ' + r + '</div></div>' +
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

  window.VPPrint = { open: open, musical: musical, trivia: trivia, fail: fail };
})();
