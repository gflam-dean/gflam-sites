/* MUSICAL BINGO PHONE CARD, DEAN'S 10 NOV 2026 LIVE SIGN-OFF (builds INBOX 140): THE RULES UNDER IT.

   RUNS the shipped code lifted out of app/musical/play.html, with small stubs:
     1. no hyphen, ever: no soft-hyphen code left, the tile says hyphens:none, the card is built from plain titles
     2. the square's title: a trailing bracketed part is dropped on the phone square only ("(Hot Summer Night)",
        "[Radio Edit]"); a title that starts with brackets keeps them; the full title stays for a screen reader
     3. the fitter: every square its own biggest size (Dean via main INBOX 337, 12 Nov 2026); never wider than the
        screen (no swipe), so a long word brings only its own square down
     4. the note has its own slot of fixed height, so the card never shrinks for it; every note is short
     5. FREE has its own look (gold, no tick), never the marked square's
     6. after End game ("idle") a won or lost phone leaves its end screen for the lobby; a new game cancels the wait
   The painted card is measured in Chrome by tools/musical-card-spacing-in-chrome.test.py.
   Run: jsc tools/test-musical-card-10nov.js   (from the repo root) */
var ran = 0, bad = 0;
function show(name, cond, saw) { ran++; if (cond) print('  ok   ' + name); else { bad++; print('  FAIL ' + name + (saw !== undefined ? '   saw: ' + saw : '')); } }
function lift(text, name, label) {
  var i = text.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('cannot find ' + name + ' in ' + label + ' - a test that cannot find its subject cannot fail');
  var d = 0, k = text.indexOf('{', i);
  do { if (text[k] === '{') d++; else if (text[k] === '}') d--; k++; } while (d > 0 && k < text.length);
  return text.slice(i, k) + '\n';
}
var PLAY = readFile('venueplay/app/musical/play.html');
var flat = PLAY.replace(/\s+/g, ' ');

print('\n== 1. no hyphen, ever ==');
show('no soft-hyphen helper left (softBreak / withSoftBreak gone)', PLAY.indexOf('function softBreak(') < 0 && PLAY.indexOf('function withSoftBreak(') < 0);
show('no soft hyphen character is written anywhere in the script', PLAY.indexOf('"\\u00AD"') < 0 && PLAY.indexOf('­') < 0);
show('the new-look tile says hyphens:none (and the old look already did)', /#vCard \.cc\{[^}]*hyphens:none;-webkit-hyphens:none\}/.test(flat.replace(/; /g, ';')));
show('a word is never broken: word-break and overflow-wrap normal on the tile', /#vCard \.cc\{[^}]*word-break:normal;overflow-wrap:normal/.test(flat.replace(/; /g, ';')));

print('\n== 2. the title on the square ==');
var cardTitle = new Function(lift(PLAY, 'cardTitle', 'play.html') + 'return cardTitle;')();
[["You Took the Words Right Out of My Mouth (Hot Summer Night)", "You Took the Words Right Out of My Mouth"],
 ["I'd Do Anything for Love (But I Won't Do That)", "I'd Do Anything for Love"],
 ["Everybody (Backstreet's Back) [Radio Edit]", "Everybody"],
 ["Forgot About Dre (feat. Eminem) [Instrumental]", "Forgot About Dre"],
 ["(I Can't Get No) Satisfaction", "(I Can't Get No) Satisfaction"],
 ["(Everything I Do) I Do It for You", "(Everything I Do) I Do It for You"],
 ["Thunderstruck", "Thunderstruck"],
 ["(Remastered)", "(Remastered)"],
 ["", ""]].forEach(function (p) { show(JSON.stringify(p[0]) + ' -> ' + JSON.stringify(p[1]), cardTitle(p[0]) === p[1], cardTitle(p[0])); });
show('a hyphen the title already has gets a word joiner, so the line never breaks there ("My Coo-Ca-Choo")', cardTitle('My Coo-Ca-Choo') === 'My Coo-\u2060Ca-\u2060Choo' && cardTitle('Ob-La-Di Ob-La-Da').split('\u2060').length === 5, JSON.stringify(cardTitle('My Coo-Ca-Choo')));
show('a lone dash between words is left alone ("Song - Live" style spacing is untouched)', cardTitle('A - B') === 'A - B');
show('the square is built from cardTitle, and the full title stays as its label', /ct\.textContent=cardTitle\(titles\[i\]\); cell\.setAttribute\("aria-label", titles\[i\]\);/.test(PLAY));

print('\n== 3. the fitter: per square (INBOX 337), never wider than the screen ==');
show('FIT_MIN is 15 and FIT_MAX 20', /var FIT_MAX=20, FIT_MIN=15,/.test(PLAY));
(function () {
  /* a fake card: a title fits when size * its longest word (in em) <= the square's inner width, the square widening with --aw */
  function mk(longestEm, baseW) {
    var aw = 1;
    var grid = { clientWidth: 300, style: { setProperty: function (k, v) { aw = parseFloat(v); } } };
    var els = longestEm.map(function (em) {
      var el = { classList: { contains: function () { return false; } }, style: { fontSize: '', setProperty: function () {} }, get clientWidth() { return baseW * aw; }, clientHeight: 80, clientLeft: 2, clientTop: 2 };
      var sp = { style: {}, firstChild: null, get offsetWidth() { return parseFloat(el.style.fontSize) * em; }, offsetHeight: 20 };
      el.querySelector = function () { return sp; };
      return el;
    });
    var free = { classList: { contains: function (c) { return c === 'free'; } }, style: {} };
    var all = els.concat([free]);
    var document = { getElementById: function () { return grid; }, querySelectorAll: function () { return all; }, createRange: function () { return {}; } };
    var getComputedStyle = function () { return { paddingLeft: '4', paddingRight: '4', paddingTop: '4', paddingBottom: '4' }; };
    var src = PLAY.slice(PLAY.indexOf('  var FIT_MAX=20,'), PLAY.indexOf('  (function(){\n    function refit()'));
    var f = new Function('document', 'getComputedStyle', 'cz', 'paintHint', src + 'fitCells(); return { aw:_aw, size:document.getElementById().__s };');
    var r = f(document, getComputedStyle, 1, function () {});
    var sizes = els.map(function (e) { return e.style.fontSize; });
    return { aw: r.aw, sizes: sizes, free: free.style.fontSize, fit: grid._fit };
  }
  /* PER SQUARE (Dean via main INBOX 337, 12 Nov 2026: "fit per cell, not the whole card"). REPINNED: these three used to
     say "one size for every title and Free" and "the whole card drops EVENLY". Now every square takes the biggest size
     (0.5px steps, 20px at most) its own title fits; only the long word's square goes small; Free at the middle size. */
  function biggest(r, ems, W) { return r.sizes.every(function (s, i) { var f = parseFloat(s); return f * ems[i] <= W + 0.5 && (f >= 20 || (f + 0.5) * ems[i] > W + 0.5); }); }
  function mid(r) { var v = r.sizes.map(parseFloat).sort(function (x, y) { return x - y; }); return v[Math.floor(v.length / 2)] + 'px'; }
  var a = mk([3, 4, 3.5], 80);   // short words: fits on the screen
  show('short words: no widening, every title the biggest size its own square holds, 20px at most', a.aw === 1 && biggest(a, [3, 4, 3.5], 72) && a.sizes.every(function (s) { return parseFloat(s) <= 20 && parseFloat(s) >= 15; }), JSON.stringify(a));
  show('...so the sizes differ square to square (20px, 18px, 20px), and Free is at the middle size', a.sizes.join() === '20px,18px,20px' && a.free === mid(a), JSON.stringify(a));
  var b = mk([3, 7.5, 4], 62);   // "Thunderstruck": cannot make 15px on the screen's width
  /* ALL FIVE COLUMNS ON ONE SCREEN (Dean, 12 Nov 2026, INBOX 291 / 288.8): the card is never made wider than the screen. */
  show('one long word: the card stays the screen\'s width (no swipe) and ONLY that square goes small; the others keep their own size', b.aw === 1 && parseFloat(b.sizes[1]) < 15 && parseFloat(b.sizes[0]) === 18 && parseFloat(b.sizes[2]) === 13.5 && b.free === mid(b), JSON.stringify(b));
  var c = mk([3, 20, 4], 62);    // a word longer still
  show('a longer word: still the screen\'s width, its square at the 10px floor, the rest untouched (never the whole card)', c.aw === 1 && c.sizes[1] === '10px' && c.sizes[0] === b.sizes[0] && c.sizes[2] === b.sizes[2], JSON.stringify(c));
})();
show('the card\'s width is the screen times --aw (the zoom buttons no longer stretch it by --cz)', /#vCard \.card5\{[^}]*width:calc\(100% \* var\(--aw,1\)\)/.test(flat) && /\$\("cardGrid"\)\.style\.setProperty\("--cz", 1\);/.test(PLAY));
show('a wide card says so in the slot under it: "Swipe the card sideways to see every song."', PLAY.indexOf('"Swipe the card sideways to see every song."') > 0);

print('\n== 4. the note never shrinks the card ==');
show('the note lives in its own slot between the card and the button, not in the button bar', /<div class="noteslot" id="noteSlot"><div class="bingonote hidden" id="bingoNote"[^>]*><\/div><div class="notehint" id="noteHint">/.test(PLAY) && /<div class="bingobar"><button class="btn pink bingoBtn" id="bingoBtn">/.test(PLAY));
show('the slot is a fixed height (62px), flex:none, so a note coming or going moves nothing above it', /#vCard \.noteslot\{flex:none;height:62px;/.test(PLAY));
show('the note text is 15px in the slot', /#vCard \.noteslot \.bingonote\{[^}]*font-size:15px/.test(PLAY));
(function () {
  var notes = [], re = /noteBingo\(([^;]*?),"(no|wait)"/g, m;
  while ((m = re.exec(PLAY))) notes.push(m[1]);
  var lits = [];
  notes.forEach(function (n) { (n.match(/"[^"]*"/g) || []).forEach(function (x) { lits.push(x.slice(1, -1)); }); });
  /* every sentence a note can show, as written in the page: two lines of about 36 characters at 15px on a 360 phone */
  var long = lits.filter(function (t) { return t.length > 72; });
  show('every note is short enough for two lines at 360 (72 characters or fewer; ' + lits.length + ' sentences read from the page)', lits.length >= 8 && !long.length, long);
  show('the early-mark note is the short one now', PLAY.indexOf('" not played yet. Tap "+(early.length===1?"the":"an")+" orange one to unmark it."') > 0);
  show('no note says "bingo"', !/bingo/i.test(lits.join(' ')), lits.join(' | '));
})();

print('\n== 5. FREE has its own look ==');
show('Free is a gold tile with near-black words', /#vCard \.cc\.free,#vCard \.cc\.free\.daub\{background:var\(--gold\);border-color:var\(--gold\);color:#0A0A0B;/.test(PLAY));
show('Free has no tick', /#vCard \.cc\.free::after\{display:none\}/.test(PLAY));
show('a marked song is still the dark pink tile with the pink edge', /#vCard \.cc\.daub\{background:#2B0D1D;border-color:var\(--pink\)/.test(PLAY));
show('the light screen: Free gold too, never the marked pink', /body\.light #vCard \.cc\.free\{background:var\(--gold\)/.test(PLAY) && !/body\.light #vCard \.cc\.free\{background:#FFE3F0/.test(PLAY));
show('no spaced mono capitals on this phone (kicker and lobby tile label in Manrope, no letter-spacing, as written)', /\.vp-kicker,\.vp-tiles \.k\{font-family:'Manrope',sans-serif;font-weight:700;letter-spacing:0;text-transform:none\}/.test(PLAY));

show('the lobby\'s shared pieces lose their spaced mono capitals on this phone too ("Next", "This week here", "What\'s on at")', /#vpAd \.k,\.vpt-next \.k,\.vpt-week \.k,\.vpt-night \.bd\{font-family:'Manrope',sans-serif;letter-spacing:0;text-transform:none\}/.test(PLAY));

print('\n== 6. after End game the phone moves on ==');
(function () {
  var src = PLAY.slice(PLAY.indexOf('    else if(m.t==="idle"){'), PLAY.indexOf('  // ---- connect ----'));
  src = src.slice(src.indexOf('{') + 1, src.lastIndexOf('}', src.lastIndexOf('}') - 1));
  var timers = [], routed = [];
  function run(P) {
    timers = []; routed = [];
    var f = new Function('P', 'route', 'setTimeout', 'clearTimeout', 'END_LEAVE_MS', 'var _endLeaveT=null;' + src + '; return function(){ return _endLeaveT; };');
    return f(P, function () { routed.push(P.won ? 'won' : P.ended ? 'lost' : 'lobby'); }, function (fn, ms) { timers.push({ fn: fn, ms: ms }); return timers.length; }, function () {}, 20000);
  }
  var P = { joined: true, won: true, ended: false, active: true, cells: [] };
  run(P);
  show('a winner on "You won" stays there for now (to show the host)', routed[0] === 'won' && P.active === false);
  show('...and a timer of END_LEAVE_MS (20 s) is set', timers.length === 1 && timers[0].ms === 20000);
  timers[0].fn();
  show('...when it fires the phone goes to the lobby, won cleared', P.won === false && routed[routed.length - 1] === 'lobby');
  var Q = { joined: true, won: false, ended: true, active: true, cells: [] };
  run(Q); timers[0].fn();
  show('a "Not this time" phone moves on too', Q.ended === false && routed[routed.length - 1] === 'lobby');
  var R = { joined: true, won: true, ended: false, active: true, cells: [] };
  run(R); R.active = true; timers[0].fn();
  show('a new game already on when the timer fires: nothing is undone', R.won === true);
  show('"started" cancels the wait', /else if\(m\.t==="started"\)\{\n      if\(_endLeaveT\)\{ clearTimeout\(_endLeaveT\); _endLeaveT=null; \}/.test(PLAY));
  show('END_LEAVE_MS is 20000', /var END_LEAVE_MS=20000, _endLeaveT=null;/.test(PLAY));
})();

print('\n' + (bad ? (bad + ' of ' + ran + ' checks FAILED') : ('ALL ' + ran + ' CHECKS PASSED')));
if (bad) throw new Error(bad + ' failed');
