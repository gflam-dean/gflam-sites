/* THE PRINTABLE SIGNS, WITH A VENUE LOGO ON THEM.

   Dean: "the printables need to be looked at when you add a logo it mixes writing together".
   A sign is fitted by measuring it and solving for the one length unit that fills the paper.
   The logo is fetched from the venue's screen settings and arrives late, and a picture that has
   not arrived measures ZERO high, so the sign was fitted as if there were no logo at all. The
   logo then landed at full size on top of a layout that had no room for it and pushed the venue
   name, the headline and the code into each other and into the VenuePlay mark at the foot.

   This test runs the REAL fit code, read out of venueplay/signage.html between the two
   VP-SIGN-FIT markers, against a fake sign whose parts have known sizes. Nothing here is a copy
   of the page's maths. It lives in venueplay/app because that is one of the two folders the gate
   sweeps for suites; a suite written beside signage.html itself would run nowhere.

   NOT covered here, because jsc has no browser: what the paper actually looks like.

   Run: jsc venueplay/app/signage-logo.test.js  (the gate runs it from the repo root) */
function find(rel) {
  var tries = [rel, '../' + rel, '../../' + rel];
  for (var i = 0; i < tries.length; i++) {
    try { var t = readFile(tries[i]); if (t && t.length > 5000) return t; } catch (e) {}
  }
  throw new Error('cannot open ' + rel);
}
var H = find('venueplay/signage.html');
var block = H.split('// VP-SIGN-FIT-START')[1];
if (!block) throw new Error('no VP-SIGN-FIT-START marker in signage.html');
block = block.split('// VP-SIGN-FIT-END')[0];
if (!block || block.length < 400) throw new Error('fit block is empty or truncated');

/* --- the smallest fake sign the real code can be run against ---------------------------------
   Heights are in multiples of u, the way the stylesheet writes them, except the logo, which is a
   fixed slice of the SIGN and does not shrink with u. That is the whole point of the slot. */
var SIGN_H = 1000, SIGN_W = 707;   // an A4-ish sheet in screen pixels
function makeSign(opts) {
  var u = 10, wide = !!opts.wide;
  var el = {
    style: { setProperty: function (k, v) { if (k === '--u') { el.uRaw = v; if (/px$/.test(v)) u = parseFloat(v); } } },
    uRaw: '',
    classList: { contains: function (c) { return c === 'wide' && wide; } },
    getBoundingClientRect: function () { return { height: SIGN_H, width: SIGN_W }; },
    querySelector: function (sel) {
      if (sel === '.qrbox') return rect(function () { return { height: u * 14, width: u * 14 }; });
      if (sel === '.head')  return rect(function () { return { height: opts.logoH + u * 6.5, width: u * 12 }; });
      if (sel === '.tail')  return rect(function () { return { height: u * 5, width: u * 12 }; });
      if (sel === 'h2')     return rect(function () { return { height: u * 3.9, width: u * 12 }; });
      if (sel === '.vlogo') {
        if (!opts.logoW) return null;
        var img = rect(function () { return { height: opts.logoH, width: opts.logoW }; });
        img.hidden = !!opts.logoHidden;
        return img;
      }
      return null;
    },
    css: function () {
      var pad = wide ? u * 2.4 : null;
      return {
        paddingTop: (wide ? pad : u * 3) + 'px', paddingBottom: (wide ? pad : u * 3) + 'px',
        paddingLeft: (wide ? pad : u * 2.6) + 'px', paddingRight: (wide ? pad : u * 2.6) + 'px',
        rowGap: (wide ? u * 0.9 : u * 1.2) + 'px', columnGap: (wide ? u * 2.2 : u * 1.2) + 'px',
        getPropertyValue: function (k) { return k === '--u' ? u + 'px' : ''; }
      };
    }
  };
  return el;
}
function rect(f) { return { getBoundingClientRect: f, scrollWidth: f().width, hidden: false }; }
var getComputedStyle = function (el) { return el.css(); };
var document = { createRange: function () { throw new Error('no ranges here, fall back to scrollWidth'); } };
eval(block);

// Run the real fitSign and give back the unit it settled on, in pixels.
function fittedU(opts) {
  var el = makeSign(opts);
  fitSign(el);
  var m = /^([\d.]+)cqh$/.exec(el.uRaw);
  if (!m) throw new Error('fitSign did not store a cqh unit, it stored ' + el.uRaw);
  return parseFloat(m[1]) / 100 * SIGN_H / 0.985;
}
// Does the content at that unit actually fit inside the paper?
function fitsWith(opts, u) {
  var el = makeSign(opts);
  return fitsAt(el, u, { height: SIGN_H, width: SIGN_W });
}

var EXPECT = 14, ran = 0, bad = 0;
function ok(n, c, extra) { ran++; if (c) print('  ok   ' + n); else { bad++; print('  FAIL ' + n + (extra ? '   ' + extra : '')); } }

var NOLOGO = { logoH: 0, logoW: 0 };
var TALL   = { logoH: 140, logoW: 90 };    // a tall narrow logo, filling the slot height
var WIDE   = { logoH: 140, logoW: 500 };   // a wide short one, letterboxed in the same slot
var uNone = fittedU(NOLOGO), uTall = fittedU(TALL), uWide = fittedU(WIDE);

ok('a sign with no logo still fits the paper', fitsWith(NOLOGO, uNone));
ok('a tall narrow logo still fits the paper', fitsWith(TALL, uTall), 'u=' + uTall.toFixed(2));
ok('a wide short logo still fits the paper', fitsWith(WIDE, uWide), 'u=' + uWide.toFixed(2));
ok('adding a logo makes everything else smaller, it does not overlap it', uTall < uNone,
   'no logo ' + uNone.toFixed(2) + ' vs logo ' + uTall.toFixed(2));
ok('the fit that was chosen without a logo does NOT fit once the logo lands',
   !fitsWith(TALL, uNone));
ok('so the sign has to be fitted again when the picture arrives, and the page does that',
   /addEventListener\("load", refitAll\)/.test(H));
ok('and again if the picture never arrives, with the empty slot taken away',
   /addEventListener\("error", function\(\)\{ img\.hidden=true; img\.removeAttribute\("src"\); refitAll\(\); \}\)/.test(H));
ok('a hidden logo takes no width in the sum, so no-logo signs are unchanged',
   fittedU({ logoH: 0, logoW: 500, logoHidden: true }) === uNone);

// The wide tent face: the logo sits in the same column as the words.
var wNone = fittedU({ wide: true, logoH: 0, logoW: 0 });
var wFat  = fittedU({ wide: true, logoH: 90, logoW: 460 });
// Worked out here from the stylesheet, NOT from the page's own sum, so a page that forgot the
// logo cannot agree with itself and pass.
function wideWidthAt(u, logoW) { return 2 * 2.4 * u + 14 * u + 2.2 * u + Math.max(12 * u, logoW); }
function tallWidthAt(u, logoW) { return 2 * 2.6 * u + Math.max(14 * u, 12 * u, logoW); }
ok('on a tent, a logo wider than the headline is not allowed to run off the paper',
   wideWidthAt(wFat, 460) <= SIGN_W, 'needs ' + wideWidthAt(wFat, 460).toFixed(0) + 'px of ' + SIGN_W);
// 640 is wider than the 52cqw the stylesheet allows a logo. The cap is the first defence; this
// proves the fit itself is the second, so a wider cap later cannot put a logo over the edge.
var uVeryWide = fittedU({ logoH: 140, logoW: 640 });
ok('on a poster, a logo wider than the paper is shrunk into it, not sliced off the edge',
   tallWidthAt(uVeryWide, 640) <= SIGN_W, 'needs ' + tallWidthAt(uVeryWide, 640).toFixed(0) + 'px of ' + SIGN_W);
ok('and the stylesheet caps a logo well inside the paper before that even comes up',
   /max-width:52cqw/.test(H) && /\.sign\.wide \.vlogo\{max-width:30cqw/.test(H));
ok('and that wide logo is what makes the tent sign shrink', wFat < wNone,
   'plain ' + wNone.toFixed(2) + ' vs wide logo ' + wFat.toFixed(2));

/* --- the two things that keep the printed page honest ---------------------------------------- */
ok('the logo has a fixed slot, not a max-height that collapses before it loads',
   /\.sign \.vlogo\{height:14cqh;/.test(H) && !/\.sign \.vlogo\{max-height/.test(H));
ok('the print button waits for the logo before it opens the dialog',
   /logosReady\(\)\.then\(function\(\)\{ refitAll\(\); setTimeout\(function\(\)\{ window\.print\(\); \}, 60\); \}\)/.test(H));

if (ran !== EXPECT) { print('ONLY ' + ran + ' OF ' + EXPECT + ' CHECKS RAN'); throw new Error('incomplete'); }
if (bad) { print(bad + ' OF ' + EXPECT + ' FAILED'); throw new Error(bad + ' failed'); }
print('ALL ' + EXPECT + ' CHECKS PASSED');
