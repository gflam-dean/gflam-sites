/* A SLIDE THAT SAYS "SCAN TO JOIN" CARRIES THE REAL JOIN QR ON THE TV (Dean, 12 Nov 2026, INBOX 335.2: "slides that say
   'scan to join' need the real QR on the TV ... check the TV shows the join QR beside slides; if not, add it").

   Before this the TV showed a QR only on a game's own screens (the join screen, bingo's corner) and on the set-up card:
   a venue's slide that said "scan to join" had no QR beside it. Now a slide saved with qr:true gets the venue's join QR
   (/play?venue=<slug>, the address the printed signs carry) in the bottom-right corner, inside the 5% safe box. This RUNS
   the real code from three files:
     venueplay/tv.html                      slideQrURL, slideQrHtml, entryInner, drawSlideQrs
     venueplay-backend/worker/venueplay-api-FULL.js   vpbCleanSlides (the one save every screen write goes through)
     venueplay/app/billing.html             slideRow + gatherScreen (the owner's tick box, kept through a save)
   The page is stood in for; nothing else. The real wall at 1920x1080 and 1280x720: tools/tv-slide-qr-in-chrome.test.py.

   Run from the repo root:  jsc tools/test-slide-qr.js
*/
var fails = 0, ran = 0;
function check(name, ok, saw) { ran++; if (ok) print('  ok   ' + name); else { fails++; print('  FAIL ' + name + (saw === undefined ? '' : '   saw: ' + JSON.stringify(saw).slice(0, 300))); } }
function liftFrom(text, n, label) {
  var i = text.indexOf('async function ' + n + '('); if (i < 0) i = text.indexOf('function ' + n + '(');
  if (i < 0) throw new Error('cannot find ' + n + ' in ' + label + ': a test that cannot find its subject cannot fail');
  var d = 0, k = text.indexOf('{', i);
  do { if (text[k] === '{') d++; else if (text[k] === '}') d--; k++; } while (d > 0 && k < text.length);
  return text.slice(i, k) + '\n';
}
var TV = readFile('venueplay/tv.html'), API = readFile('venueplay-backend/worker/venueplay-api-FULL.js'), BILL = readFile('venueplay/app/billing.html');

print('the wall: which slide gets the QR, and where it goes');
var VP_DEMO = false, VENUE_SLUG = 'tugun-bowls', ORIGIN = 'https://venueplay.com.au', playURL = 'https://venueplay.com.au/play?room=ABC234';
var PROBED = [], DRAWN = [];
function probeImg(u) { PROBED.push(u); }
function esc(s) { return String(s); } function escBr(s) { return String(s); } function accentHex() { return '#FF1F8E'; }
function drawQR(el, url, size) { DRAWN.push([el.id || 'canvas', url, size]); }
eval(liftFrom(TV, 'slideQrURL', 'tv.html'));
eval(liftFrom(TV, 'slideQrHtml', 'tv.html'));
eval(liftFrom(TV, 'drawSlideQrs', 'tv.html'));
var EI = liftFrom(TV, 'entryInner', 'tv.html');
// entryInner's holding branch reaches for helpers this test does not need: a slide entry never touches them.
eval(EI);
var PIC = 'https://db.example/storage/v1/object/public/venue-ads/v/abc.jpg';
var withQr = entryInner({ type: 'slide', slide: { image_url: PIC, seconds: 7, qr: true } });
var without = entryInner({ type: 'slide', slide: { image_url: PIC, seconds: 7 } });
var textQr = entryInner({ type: 'slide', slide: { head: 'Join our members list', sub: 'Scan to join', qr: true } });
check('a picture slide saved with qr:true carries the QR box (canvas + "Scan to join")', /class="slideqr"/.test(withQr) && /<canvas class="sqcan">/.test(withQr) && /Scan<br>to join/.test(withQr), withQr);
check('the QR sits after the picture, inside the same slide (it fades in and out with it)', withQr.indexOf('adimg') < withQr.indexOf('slideqr'), withQr);
check('a slide without qr:true has no QR (nothing changes for every slide saved before today)', !/slideqr/.test(without), without);
check('qr must be exactly true: "yes", 1 or "true" are not', ['yes', 1, 'true'].every(function (v) { return !/slideqr/.test(entryInner({ type: 'slide', slide: { image_url: PIC, qr: v } })); }));
check('a text slide with qr:true carries it too', /slideqr/.test(textQr), textQr);
check('the QR goes to the venue\'s own join address (the printed signs\' /play?venue=)', slideQrURL() === 'https://venueplay.com.au/play?venue=tugun-bowls', slideQrURL());
VENUE_SLUG = 'a b&c';
check('the venue\'s address is encoded', slideQrURL() === 'https://venueplay.com.au/play?venue=a%20b%26c', slideQrURL());
VENUE_SLUG = '';
check('a wall with no venue shows no QR at all (never a code to nowhere)', slideQrHtml({ qr: true }) === '' && !/slideqr/.test(entryInner({ type: 'slide', slide: { image_url: PIC, qr: true } })));
VP_DEMO = true;
check('a demo wall\'s QR is its demo phone', slideQrURL() === playURL);
VP_DEMO = false; VENUE_SLUG = 'tugun-bowls';
// drawSlideQrs paints every slide QR in the swapped-in slides, with the address on it for a check to read
var c1 = { attrs: {}, setAttribute: function (k, v) { this.attrs[k] = v; } }, c2 = { attrs: {}, setAttribute: function (k, v) { this.attrs[k] = v; } };
drawSlideQrs({ querySelectorAll: function (sel) { return sel === '.slideqr canvas' ? [c1, c2] : []; } });
check('buildAds\' hand-off draws each slide QR once, at 240, with the venue address', DRAWN.length === 2 && DRAWN.every(function (d) { return d[1] === 'https://venueplay.com.au/play?venue=tugun-bowls' && d[2] === 240; }) && c1.attrs['data-qr-url'] === 'https://venueplay.com.au/play?venue=tugun-bowls', DRAWN);
check('buildAds calls it after the swap', /drawSlideQrs\(host\);/.test(liftFrom(TV, 'buildAds', 'tv.html')));

print('the place on the wall: inside the 5% safe box');
var css = TV.slice(TV.indexOf('.ad .slideqr{'), TV.indexOf('.ad .slideqr{') + 900);
check('bottom-right of the wall (the wall is the safe box)', /\.ad \.slideqr\{position:absolute;right:2cqw;bottom:2cqw;/.test(css), css.slice(0, 120));
check('on a full-bleed photo slide, 5vw/5vh in from the window\'s edge first (the safe box), then the same 2cqw', /#tvAds \.ad-photo \.slideqr\{right:calc\(5vw \+ 2cqw\);bottom:calc\(5vh \+ 2cqw\)\}/.test(css), css);

print('the save: the flag survives the Worker');
eval(liftFrom(API, 'vpbScreenStr', 'venueplay-api-FULL.js'));
var VPB_MAX_SLIDES = 20;
eval(liftFrom(API, 'vpbCleanSlides', 'venueplay-api-FULL.js'));
var cl = vpbCleanSlides([{ image_url: PIC, seconds: 7, qr: true }, { image_url: PIC + '?2', seconds: 7 }, { image_url: PIC + '?3', qr: 'yes' }, { image_url: PIC + '?4', qr: 1 }]);
check('qr:true is kept', cl[0].qr === true, cl[0]);
check('no qr, or anything but true, is not written at all', !('qr' in cl[1]) && !('qr' in cl[2]) && !('qr' in cl[3]), cl);
var prosp = liftFrom(API, 'vpaProspectSetUp', 'venueplay-api-FULL.js');
// the parse line itself, run on its own (b and slidesIn stood in for)
var mq = /const slidesQr = (\(Array\.isArray\(b\.slides_qr\)[^\n]*);/.exec(prosp);
var b = { slides_qr: [0, '2', 9, -1, 'x'] }, slidesIn = ['a', 'b', 'c'];
var sq = mq ? eval(mq[1]) : null;
check('a new prospect\'s starter slides: slides_qr names which say scan to join (0-based, in range only)', JSON.stringify(sq) === '[0,2]', sq);
check('and the slide it names is saved with qr:true, in the same set-up', /if \(slidesQr\.indexOf\(i\) !== -1\) sl\.qr = true;[^\n]*\n\s*slides\.push\(sl\);/.test(prosp));

print('the owner\'s screen page: the tick box, kept through a save');
function FakeEl(cls) { this.className = cls; this.value = ''; this.checked = false; }
var rowHtml = null;
var document = { createElement: function () { return { className: '', attrs: {}, setAttribute: function (k, v) { this.attrs[k] = v; }, getAttribute: function (k) { return this.attrs[k]; },
  set innerHTML(h) { rowHtml = h; }, querySelector: function () { return { style: {}, addEventListener: function () {}, click: function () {} }; } }; } };
try { eval(liftFrom(BILL, 'slideRow', 'billing.html')); slideRow({ image_url: PIC, seconds: 7, qr: true }); } catch (e) { /* the listeners need the real page; the markup is already built */ }
check('a slide saved with qr:true shows the box ticked', rowHtml && /<input type="checkbox" class="ad-qr" checked>/.test(rowHtml), rowHtml && rowHtml.slice(-400));
rowHtml = null;
try { slideRow({ image_url: PIC, seconds: 7 }); } catch (e) {}
check('every other slide shows it unticked (off unless the owner ticks it)', rowHtml && /<input type="checkbox" class="ad-qr">/.test(rowHtml), rowHtml && rowHtml.slice(-400));
check('the words say what it is for', rowHtml && /Show the join QR on this slide \(for a slide that says scan to join\)/.test(rowHtml));
function mkRow(url, checked) {
  var f = { '.ad-secs': { value: '9' }, '.ad-starts': { value: '' }, '.ad-ends': { value: '' }, '.ad-qr': { checked: checked } };
  return { getAttribute: function () { return url; }, querySelector: function (s) { return f[s]; } };
}
var ROWS = [mkRow(PIC, true), mkRow(PIC + '?b', false)];
function $(id) { return { querySelectorAll: function () { return ROWS; } }; }
eval(liftFrom(BILL, 'gatherScreen', 'billing.html'));
var g = gatherScreen().slides;
check('gatherScreen sends qr:true for the ticked slide only', g[0].qr === true && !('qr' in g[1]), g);
check('ticking it marks the screen unsaved, like the seconds and dates', /e\.target\.closest\("\.ad-secs, \.ad-starts, \.ad-ends, \.ad-qr"\)\) markScreenDirty\(\)/.test(BILL));

print('\n' + (fails ? fails + ' OF ' + ran + ' CHECKS FAILED' : 'ALL ' + ran + ' CHECKS PASSED'));
if (fails) throw new Error(fails + ' failed');
