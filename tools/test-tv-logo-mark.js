/* The venue's logo on the TV and the phone: painted only when the venue has one, sized by its SHAPE
   in one place, top-left on the TV, and kept clear.

   Dean, 7 Aug 2026: the venue's logo in the top-left corner of the TV, on /tv and on every game
   screen. 16 Oct 2026: one box everywhere, never catching a tap, and marked data-fit-avoid so
   /app/vp-fit.js moves the wall out from under it. 21 Oct 2026: "their logo on their normal games
   seems to be a bit small so I think we should be able to make it a bit bigger if it's a square
   rather than a rectangle". The one box was 120 x 56, sized for a wordmark, so a square crest came
   out 56 x 56 on a 1920 TV. Now /app/vp-venuelogo.js gives every logo the same AREA, held inside a
   height and width ceiling and a height floor, and every page asks it.

   What this RUNS:
     1. the real VPVenueLogo.box() from /app/vp-venuelogo.js, for a wide, a square, a round, a tall
        and an absurdly wide logo, at 1920x1080, 1280x720 and on a 390 and a 320 phone
     2. the real painters lifted out of tv.html (setVenueLogo, applyVenueLogo) and out of the four
        game screens (paintVenueLogo), against a small DOM WITH the real vp-venuelogo.js loaded:
          no logo_url   nothing is created, and nothing is shown
          a logo_url    one <img id="venueLogo">, fixed, never catching a tap, data-fit-avoid, and
                        sized by vp-venuelogo.js once its picture arrives
          removed       the mark comes off the wall
        and the five copies must paint exactly the same mark
     3. the logo line in the three phone pages, run with a fake answer from /join/info
     4. every one of those eight pages loads /app/vp-venuelogo.js, as a real script tag
   tools/venue-logo-in-chrome.test.py then measures what a real browser paints against the wall.

   Jag the Joker (switched off) keeps its own title in that corner, and topanswers/screen.html is
   a demo page with no venue, so neither paints a logo; this suite says so out loud.

   Run from the repo root:  jsc tools/test-tv-logo-mark.js
*/
var fails = 0, ran = 0;
function check(name, ok, saw) { ran++; if (ok) print('  ok   ' + name); else { print('  FAIL ' + name + (saw === undefined ? '' : '   saw: ' + JSON.stringify(saw).slice(0, 300))); fails++; } }

function lift(src, name, where) {
  var i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error(name + ' is not in ' + where);
  var d = 0, started = false;
  for (var j = i; j < src.length; j++) {
    if (src[j] === '{') { d++; started = true; }
    else if (src[j] === '}') { d--; if (started && d === 0) return src.slice(i, j + 1); }
  }
  throw new Error(name + ' never closes in ' + where);
}
/* cssText into numbers and words, so the check is about the box, not the spelling. */
function css(t) {
  var o = {};
  String(t || '').split(';').forEach(function (kv) { var k = kv.split(':')[0], v = kv.slice(k.length + 1); if (k.trim()) o[k.trim()] = v.trim(); });
  return o;
}

/* THE REAL SIZING FILE, loaded into a pretend window of a given size. */
var LOGO_SRC = readFile('venueplay/app/vp-venuelogo.js');
function loadSizer(W, H) {
  var win = { innerWidth: W, innerHeight: H, fits: 0, listeners: {},
    addEventListener: function (k, f) { (this.listeners[k] = this.listeners[k] || []).push(f); } };
  win.VP_FIT = function () { win.fits++; };
  new Function('window', 'document', LOGO_SRC)(win, { documentElement: { clientWidth: W, clientHeight: H } });
  return win;
}
var V = loadSizer(1920, 1080).VPVenueLogo;
check('vp-venuelogo.js loads and hands over box, limits and fit', !!V && typeof V.box === 'function' && typeof V.fit === 'function' && typeof V.limits === 'function');

/* ======================================================================== 1. the rule */
print('\n== 1. one rule: equal area, inside the limits ==');
var SHAPES = { wide: [1200, 300], square: [2000, 2000], round: [1180, 991], tall: [300, 900], banner: [1200, 200], sliver: [2000, 100] };
function sized(kind, W, H) {
  var L = V.limits(kind, W, H), out = {};
  for (var k in SHAPES) out[k] = V.box(SHAPES[k][0], SHAPES[k][1], L);
  out.L = L;
  return out;
}
function area(b) { return b.w * b.h; }
function within(b, L) { return b.w <= Math.round(L.maxW) && b.h <= Math.round(L.maxH); }

[['tv', 1920, 1080], ['tv', 1280, 720], ['phone', 390, 844], ['phone', 320, 640]].forEach(function (c) {
  var s = sized(c[0], c[1], c[2]), L = s.L, tag = c[0] + ' ' + c[1] + 'x' + c[2];
  check(tag + ': a square logo is drawn square', s.square.w === s.square.h, s.square);
  check(tag + ': a wide logo is limited by WIDTH, a square one gets the taller box', s.wide.w > s.square.w && s.square.h > s.wide.h, [s.wide, s.square]);
  check(tag + ': wide, square and round carry about the same ink (areas within 15%)',
        Math.max(area(s.wide), area(s.square), area(s.round)) <= 1.15 * Math.min(area(s.wide), area(s.square), area(s.round)),
        [area(s.wide), area(s.square), area(s.round)]);
  check(tag + ': every shape keeps its own proportions (within a pixel)',
        ['wide', 'square', 'round', 'tall', 'banner', 'sliver'].every(function (k) { var r = SHAPES[k][0] / SHAPES[k][1]; return Math.abs(s[k].w - s[k].h * r) <= Math.max(1.5, r); }),
        s);
  check(tag + ': nothing is wider or taller than the limits allow, tall and sliver included',
        ['wide', 'square', 'round', 'tall', 'banner', 'sliver'].every(function (k) { return within(s[k], L); }), s);
  check(tag + ': a tall logo stops at the height ceiling and does not run down the wall', s.tall.h === Math.round(L.maxH), [s.tall, L.maxH]);
  check(tag + ': an absurdly wide one stops at the width ceiling', s.sliver.w === Math.round(L.maxW), [s.sliver, L.maxW]);
  check(tag + ': a wordmark is never shorter than the floor unless the width ceiling forbids it',
        ['wide', 'banner', 'sliver'].every(function (k) { return s[k].h >= Math.round(L.minH) || s[k].w === Math.round(L.maxW); }), [s.wide, s.banner, s.sliver, L.minH]);
});

var T19 = sized('tv', 1920, 1080), T12 = sized('tv', 1280, 720), P39 = sized('phone', 390, 844), P32 = sized('phone', 320, 640);
check('1920 TV: a square logo is more than twice the old 56 pixels (Dean, 21 Oct)', T19.square.w >= 112 && T19.square.h >= 112, T19.square);
check('1920 TV: and never bigger than 140 tall (13% of 1080)', T19.square.h <= 140 && T19.round.h <= 140, [T19.square, T19.round]);
check('1920 TV: a 4:1 wordmark is at least as wide as before (120) and no wider than 288', T19.wide.w >= 120 && T19.wide.w <= 288, T19.wide);
check('a 1280 TV draws the same picture smaller, not a different one (scales with the screen)',
      Math.abs(T12.square.w - T19.square.w * 1280 / 1920) <= 1 && Math.abs(T12.wide.w - T19.wide.w * 1280 / 1920) <= 1, [T12.square, T19.square, T12.wide, T19.wide]);
check('the TV logo sits 23px in at 1920 and never closer than 14px', T19.L.inset === 23 && T12.L.inset >= 14, [T19.L.inset, T12.L.inset]);
check('phone: a square logo is 56 pixels (it was 30), a 4:1 wordmark is still about 112 x 28',
      P39.square.w === 56 && P39.square.h === 56 && P39.wide.w >= 108 && P39.wide.h >= 28, [P39.square, P39.wide]);
check('phone: never taller than 60, so the header stays a header', [P39, P32].every(function (p) { return p.square.h <= 60 && p.round.h <= 60 && p.tall.h <= 60; }), [P39.tall, P32.tall]);
check('phone: a 6:1 banner is lifted to the 28px floor, so its letters can be read', P39.banner.h === 28 && P39.banner.w === 168, P39.banner);
check('phone: never wider than half a narrow phone', P32.sliver.w <= 160 && P39.sliver.w <= 170, [P32.sliver, P39.sliver]);
check('a picture that has not arrived yet (no size) gets a sensible box, not zero or NaN',
      (function () { var b = V.box(0, 0, T19.L); return b.w > 0 && b.h > 0 && b.w === b.w && b.h === b.h; })(), V.box(0, 0, T19.L));

/* ======================================================================== 1b. true colours */
print('\n== 1b. true colours: a plate only behind a logo that would vanish on the dark wall ==');
function px(r, g, b, a, n) { var o = []; for (var i = 0; i < (n || 16); i++) o.push(r, g, b, a); return o; }
var Lw = V.lightness(px(255, 255, 255, 255)), Lk = V.lightness(px(0, 0, 0, 255)), Ln = V.lightness(px(10, 20, 90, 255));
var Lr = V.lightness(px(255, 0, 0, 255)), Lg = V.lightness(px(250, 200, 40, 255));
check('a white logo is light, and gets no plate', Lw > 0.95 && !(Lw < V.DARK), Lw);
check('a black logo is dark, and gets the plate', Lk < 0.05 && Lk < V.DARK, Lk);
check('a navy logo is dark, and gets the plate', Ln < V.DARK, Ln);
check('a pure red logo shows on the dark wall as it is (no plate)', !(Lr < V.DARK), Lr);
check('a gold logo shows as it is (no plate)', !(Lg < V.DARK), Lg);
check('see-through pixels do not count: black lines on a mostly empty canvas are still a dark logo',
      V.lightness(px(0, 0, 0, 255, 4).concat(px(255, 255, 255, 0, 60))) < V.DARK);
check('a logo with nothing painted is not judged at all', V.lightness(px(255, 255, 255, 0)) === null);

/* The printed signs read the same number the other way round (22 Oct 2026): a logo lighter than
   LIGHT would vanish on white paper, so signage.html puts it on a dark plate. */
function share(r, g, b, a) { return V.lightShare(px(r, g, b, a)); }
var Stug = V.lightShare(px(240, 240, 240, 255, 83).concat(px(0, 0, 0, 255, 17)));   // Tugun: white ribbons, black lettering
check('on paper: a white logo is light enough to need the dark plate', share(255, 255, 255, 255) > V.LIGHT, share(255, 255, 255, 255));
check('on paper: a white crest with black lettering (Tugun) still needs it', Stug > V.LIGHT, [Stug, V.LIGHT]);
check('on paper: a pale yellow logo needs it too', share(255, 255, 60, 255) > V.LIGHT, share(255, 255, 60, 255));
check('on paper: a gold logo prints as it is', !(share(250, 200, 40, 255) > V.LIGHT), share(250, 200, 40, 255));
check('on paper: red, navy and black logos print as they are',
      !(share(255, 0, 0, 255) > V.LIGHT) && !(share(10, 20, 90, 255) > V.LIGHT) && !(share(0, 0, 0, 255) > V.LIGHT));
check('on paper: a black wordmark with a little white in it prints as it is',
      !(V.lightShare(px(0, 0, 0, 255, 70).concat(px(255, 255, 255, 255, 30))) > V.LIGHT));
check('on paper: see-through pixels are not ink', V.lightShare(px(255, 255, 255, 0)) === null &&
      V.lightShare(px(0, 0, 0, 255, 4).concat(px(255, 255, 255, 0, 60))) === 0);
check('the pixel reading is one function the signs can call', typeof V.readTone === 'function');
/* THE SIGNS' SHAPE RULE (Dean, 23 Oct 2026: "as long as there's a system for when it does that"): one named
   constant, and both sides of it. */
check('the band rule is one named number, 2.2', V.BAND_RATIO === 2.2, V.BAND_RATIO);
check('a 2.1:1 logo is a badge: it stays in the column', V.isWide(2.1) === false);
check('a logo exactly 2.2:1 is a wordmark: it moves to the band', V.isWide(2.2) === true);
check('a 2.3:1 logo is a wordmark: it moves to the band', V.isWide(2.3) === true);
check('the printed signs read a logo with one function', typeof V.analyse === 'function');
check('nothing in the sizing rule filters, brightens, inverts or recolours a logo',
      !/filter\s*=|invert\(|brightness\(|grayscale\(|saturate\(|mix-blend/.test(LOGO_SRC.replace(/\/\*[\s\S]*?\*\//g, '')));

/* ======================================================================== 2. the painters */
print('\n== 2. tv.html and the four game screens paint one mark, sized by the shared rule ==');
function DOM() {
  var made = {}, created = 0;
  function el() { return { id: '', src: '', attrs: {}, style: { cssText: '', display: '' }, textContent: '', hidden: false, naturalWidth: 0, naturalHeight: 0, on: {},
    addEventListener: function (k, f) { (this.on[k] = this.on[k] || []).push(f); },
    arrive: function (w, h) { this.naturalWidth = w; this.naturalHeight = h; (this.on.load || []).forEach(function (f) { f(); }); },
    setAttribute: function (k, v) { this.attrs[k] = String(v); }, getAttribute: function (k) { return k === 'src' ? (this.src || null) : (this.attrs[k] == null ? null : this.attrs[k]); } }; }
  var doc = { getElementById: function (id) { return made[id] || null; },
    createElement: function () { created++; return el(); },
    body: { appendChild: function (n) { made[n.id] = n; } } };
  return { doc: doc, made: made, created: function () { return created; }, el: el };
}
function shown(m) { return !!m && m.style.display === 'block'; }

var MARKS = [];
function inspect(label, m, win) {
  var c = css(m && m.style.cssText);
  check(label + ': one fixed <img id="venueLogo"> showing that address', !!m && m.id === 'venueLogo' && m.src === 'https://db/storage/v1/object/public/venue-logos/v/abc.png' && c.position === 'fixed' && shown(m), m && { id: m.id, src: m.src, css: c });
  check(label + ': never catches a tap', c['pointer-events'] === 'none', c);
  check(label + ': shown in its own colours: the only filter is a soft drop shadow', /^drop-shadow\([^)]*\)$/.test(String(c.filter || '').replace(/rgba\([^)]*\)/g, 'c')) && !/invert|brightness|grayscale|contrast|opacity|sepia/.test(m.style.cssText), c.filter);
  check(label + ': marked as a vp-fit keep-out, so the wall moves out from under it', !!m && m.attrs['data-fit-avoid'] === '', m && m.attrs);
  /* The picture arrives: a square crest. The shared rule sizes it, and asks vp-fit to re-measure. */
  var fitsBefore = win.fits;
  m.arrive(2000, 2000);
  var want = V.box(2000, 2000, V.limits('tv', 1920, 1080));
  check(label + ': a square logo, once it arrives, is drawn ' + want.w + 'x' + want.h + ' by vp-venuelogo.js (not the old 56x56)',
        m.style.width === want.w + 'px' && m.style.height === want.h + 'px' && m.style.maxWidth === want.w + 'px' && m.style.maxHeight === want.h + 'px', m.style);
  check(label + ': 23 pixels in from the top-left corner on a 1920 TV', m.style.top === '23px' && m.style.left === '23px', m.style);
  check(label + ': and vp-fit is asked to move the wall at once, not on its next tick', win.fits > fitsBefore, [fitsBefore, win.fits]);
  m.arrive(1200, 300);
  var wide = V.box(1200, 300, V.limits('tv', 1920, 1080));
  check(label + ': a new wide logo on the same mark is re-sized, wider and shorter', m.style.width === wide.w + 'px' && m.style.height === wide.h + 'px', m.style);
  MARKS.push({ label: label, css: m && m.style.cssText, avoid: m && m.attrs['data-fit-avoid'], w: m.style.width, h: m.style.height });
}

print('tv.html');
(function () {
  var TV = readFile('venueplay/tv.html');
  var D = DOM(), document = D.doc;
  var made = D.made;
  var win = loadSizer(1920, 1080), VPVenueLogo = win.VPVenueLogo;
  made.venueNameTag = D.el(); made.tvCorner = D.el(); made.lobbyAt = D.el(); made.lobbyAtName = D.el();
  var tvMode = 'bingo', venueLogoUrl = '';
  function $(id) { return made[id] || (made[id] = D.el()); }
  eval(lift(TV, 'applyVenueLogo', 'tv.html')); eval(lift(TV, 'setVenueLogo', 'tv.html'));
  setVenueLogo('');
  check('no logo_url: nothing is created on the wall', !made.venueLogo && D.created() === 0, D.created());
  setVenueLogo('https://db/storage/v1/object/public/venue-logos/v/abc.png');
  inspect('tv.html', made.venueLogo, win);
  setVenueLogo('');
  check('the logo removed: the mark comes off the wall', !shown(made.venueLogo), made.venueLogo && made.venueLogo.style.display);
  check('loadScreen hands the Worker\'s logo_url to it, and nothing else', /setVenueLogo\(d\.logo_url \|\| ""\);/.test(lift(TV, 'loadScreen', 'tv.html')));
})();

['musical', 'trivia', 'members', 'raffle'].forEach(function (g) {
  var f = 'venueplay/app/' + g + '/screen.html';
  print(f);
  var S = readFile(f);
  var D = DOM(), document = D.doc;
  var win = loadSizer(1920, 1080), VPVenueLogo = win.VPVenueLogo;
  eval(lift(S, 'paintVenueLogo', f));
  paintVenueLogo('');
  check(g + ': no logo_url: nothing is created on the wall', !D.made.venueLogo && D.created() === 0, D.created());
  paintVenueLogo('https://db/storage/v1/object/public/venue-logos/v/abc.png');
  inspect(g, D.made.venueLogo, win);
  paintVenueLogo('');
  check(g + ': the logo removed: the mark comes off the wall', !shown(D.made.venueLogo), D.made.venueLogo && D.made.venueLogo.style.display);
  check(g + ': the venue screen read hands the Worker\'s logo_url to it', S.indexOf('.then(function(d){ if(!d) return; paint(d.logo_url||"");') !== -1);
});

print('one mark, not five');
var first = MARKS[0] || {};
check('tv.html and the four game screens paint exactly the same box', MARKS.length === 5 && MARKS.every(function (m) { return m.css === first.css && m.avoid === '' && m.w === first.w && m.h === first.h; }),
      MARKS.map(function (m) { return m.label + ' ' + m.css + ' ' + m.w + 'x' + m.h; }));
check('the Punters Reckon demo screen paints no logo (it has no venue)', readFile('venueplay/app/topanswers/screen.html').indexOf('venueLogo') === -1);

/* ======================================================================== 3. the phones */
print('\n== 3. the phone header asks the same rule ==');
['venueplay/play.html', 'venueplay/app/trivia/play.html', 'venueplay/app/musical/play.html'].forEach(function (f) {
  var S = readFile(f), short = f.replace('venueplay/', '');
  var m = /\n(\s*var lg=\$\("venueLogo"\);[^\n]*)\n/.exec(S);
  check(short + ': the logo line is there to run', !!m);
  if (!m) return;
  var D = DOM(), lg = D.el(); lg.classList = { hidden: true, remove: function (c) { if (c === 'hidden') this.hidden = false; }, add: function (c) { if (c === 'hidden') this.hidden = true; } };
  var win = loadSizer(390, 844);
  var run = new Function('$', 'r', 'VPVenueLogo', m[1]);
  run(function () { return lg; }, { logo_url: 'https://db/x.png' }, win.VPVenueLogo);
  lg.arrive(2000, 2000);
  var want = V.box(2000, 2000, V.limits('phone', 390, 844));
  check(short + ': a square logo is drawn ' + want.w + 'x' + want.h + ' in the header (it was 30x30)', !lg.classList.hidden && lg.src === 'https://db/x.png' && lg.style.width === want.w + 'px' && lg.style.height === want.h + 'px', lg.style);
  check(short + ': the phone logo is not moved into the TV corner', !lg.style.top && !lg.style.left, lg.style);
  var lg2 = D.el(); lg2.classList = { hidden: false, add: function () { this.hidden = true; }, remove: function () {} };
  run(function () { return lg2; }, { logo_url: '' }, win.VPVenueLogo);
  check(short + ': no logo: the header hides it', lg2.classList.hidden === true);
});

/* ======================================================================== 4. loaded */
print('\n== 4. every page that paints a logo loads the rule ==');
function stripComments(s) { return s.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, ''); }
['venueplay/tv.html', 'venueplay/app/trivia/screen.html', 'venueplay/app/musical/screen.html', 'venueplay/app/raffle/screen.html',
 'venueplay/app/members/screen.html', 'venueplay/play.html', 'venueplay/app/trivia/play.html', 'venueplay/app/musical/play.html'].forEach(function (f) {
  var S = stripComments(readFile(f));
  var tag = S.indexOf('<script src="/app/vp-venuelogo.js"></script>');
  var use = S.indexOf('VPVenueLogo.fit(');
  check(f.replace('venueplay/', '') + ': loads /app/vp-venuelogo.js before the code that uses it', tag !== -1 && use !== -1 && tag < use, [tag, use]);
});

(function () {
  var S = stripComments(readFile('venueplay/signage.html'));
  var tag = S.indexOf('<script src="/app/vp-venuelogo.js"></script>'), use = S.indexOf('VPVenueLogo.analyse(');
  check('signage.html: loads /app/vp-venuelogo.js before it reads a logo', tag !== -1 && use !== -1 && tag < use, [tag, use]);
})();

print('');
print(fails ? (fails + ' FAILED, ' + ran + ' run') : ('ALL ' + ran + ' CHECKS PASSED'));
if (fails) throw new Error(fails + ' failed');
