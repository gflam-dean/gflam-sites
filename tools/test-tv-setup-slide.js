/* THE TV SET-UP SLIDE (item 102, Dean, 6 Nov 2026): a venue with NO promo slides and NO logo gets, on its idle
   TV, "welcome to venueplay / Please set up your screen" with a QR to the Screen tab sign-in and the link in
   full under it. Any venue with a logo, a slide, a raffle or draws keeps today's "Waiting for the host" card.
   A game, a join code and "Setting up this screen" win. This RUNS the real loopEntries / setupSlideWanted /
   entryInner lifted from venueplay/tv.html, and the real slide from venueplay/app/vp-tvhold.js.
   Run: jsc tools/test-tv-setup-slide.js */
var ran = 0, bad = 0;
function ok(n, c, saw) { ran++; if (c) print('  ok   ' + n); else { bad++; print('  FAIL ' + n + (saw !== undefined ? '   saw: ' + String(saw).slice(0, 300) : '')); } }
var TV = readFile('venueplay/tv.html'), HOLD = readFile('venueplay/app/vp-tvhold.js');
function lift(src, head) {
  var i = src.indexOf(head), d = 0, j = i, st = false;
  if (i < 0) return '';
  for (; j < src.length; j++) { if (src[j] === '{') { d++; st = true; } else if (src[j] === '}') { d--; if (st && d === 0) break; } }
  return src.slice(i, j + 1);
}
var FNS = ['function setupSlideWanted(){', 'function loopEntries(){', 'function entryInner(e){', 'function esc(s){', 'function escBr(s){', 'function tvHoldHtml(line, breathe, o){'].map(function (h) { return lift(TV, h); });
ok('tv.html has the functions under test', FNS.every(function (f) { return f.length > 20; }));

var QR = [];
function world(o) {
  var window = { VPTvHold: null };
  var doc = { getElementById: function () { return null; }, createElement: function () { return { id: '', className: '', innerHTML: '', setAttribute: function () {}, appendChild: function () {} }; }, head: { appendChild: function () {} }, documentElement: {}, body: { classList: { toggle: function () {} } } };
  window.document = doc; window.VPQR = { draw: function (el, url, size) { QR.push([url, size]); } };
  (new Function('window', 'document', HOLD))(window, doc);
  var src = 'var VENUE_SLUG=' + JSON.stringify(o.slug === undefined ? 'test-alpha' : o.slug) + ', VP_DEMO=' + !!o.demo + ', venueScreenKnown=' + (o.known !== false) +
    ', venueLogoUrl=' + JSON.stringify(o.logo || '') + ', screenLoadingNow=' + !!o.loading + ', holdVenueName="Test Alpha", VENUE_CONFIRMED=true, ORIGIN="https://venueplay.com.au", ADS=' + JSON.stringify(o.ads || { slides: [] }) + ';' +
    'function screenLoading(){return screenLoadingNow;} function venuePending(){return false;} function slideVisible(){return true;} var BAD_IMG={}; function accentHex(){return "#FF1F8E";} function probeImg(){} function todayAU(){return "friday";}' +
    'var TV_SETUP_LINE="Setting up this screen", TV_WAITING_LINE="Waiting for the host";' + FNS.join('\n') +
    '; return {entries:loopEntries(), inner:function(e){return entryInner(e);}};';
  return (new Function('window', src))(window);
}
function view(o) { var w = world(o); return { e: w.entries, html: w.inner(w.entries[0]) }; }

print('shown only with no slides and no logo');
var a = view({});
ok('no slides, no logo: the set-up slide', a.e.length === 1 && a.e[0].type === 'holding' && a.e[0].v === 'setup' && /class="tvhold tvsetup"/.test(a.html), JSON.stringify(a.e));
ok('it says welcome to venueplay (lowercase) and please set up your screen', /welcome to venueplay</.test(a.html) && /Please set up your screen</.test(a.html));
ok('the link is written out in full under the QR', /class="tvs-qr"><canvas data-vp-setup-qr="1"[^>]*><\/canvas><\/div><div class="tvs-link">venueplay\.com\.au\/app\/billing#screen<\/div>/.test(a.html));
ok('the QR goes onto a <canvas> (the drawer\'s target), not a div', /<canvas data-vp-setup-qr="1"/.test(a.html));
ok('no em dash or en dash anywhere in the slide', !/[—–]/.test(a.html));
var b = view({ logo: 'https://x/logo.png' });
ok('a logo keeps today\'s card (Waiting for the host)', b.e[0].v === 'venue' && /Waiting for the host/.test(b.html) && !/tvsetup/.test(b.html), JSON.stringify(b.e));
var c = view({ ads: { slides: [{ tag: 'Raffle', head: 'Meat raffle' }] } });
ok('a promo slide keeps its slides (no set-up slide)', c.e.length === 1 && c.e[0].type === 'slide' && !/tvsetup/.test(c.html), JSON.stringify(c.e));
var c2 = view({ ads: { slides: [], raffle: { label: 'Meat Raffle' } } });
ok('a raffle routine counts as content: no set-up slide', c2.e[0].type === 'auto-raffle', JSON.stringify(c2.e));
var c3 = view({ ads: { slides: [], draws: [{ day: 'Friday', jackpot: '$100', time: '7pm' }] } });
ok('members draws count as content: no set-up slide', c3.e[0].type === 'auto-draws', JSON.stringify(c3.e));
var d1 = view({ loading: true });
ok('"Setting up this screen" wins while the screen has not answered', d1.e[0].v !== 'setup' && /Setting up this screen/.test(d1.html) && !/tvsetup/.test(d1.html), d1.html.slice(0, 120));
var d2 = view({ known: false });
ok('a screen that never answered (logo unknown) never shows it', d2.e[0].v !== 'setup' && /Waiting for the host/.test(d2.html));
ok('no venue in the address: not the set-up slide', view({ slug: '' }).e[0].v !== 'setup');
ok('a demo is not the set-up slide', view({ demo: true }).e[0].v !== 'setup');

print('a game and a join code win');
ok('the slide lives in #tvAds inside #adsRoot, which every game and join-code mode hides',
   /\$\("adsRoot"\)\.classList\.add\("hidden"\)/.test(TV) && (TV.match(/\$\("adsRoot"\)\.classList\.add\("hidden"\)/g) || []).length >= 3 && /function refreshAds\(\)\{ if\(tvMode!=="ads"\)/.test(TV));
ok('the join code is on the game screen, not on the idle slides: syncFloor only says "Scan to play" for the floor', /var words = scan \? "Scan to play" : TV_WAITING_LINE/.test(TV));

print('the QR');
QR.length = 0;
var root = { querySelectorAll: function () { return [{}]; } };
var W2 = { VPQR: { draw: function (el, url, size) { QR.push([url, size]); } } }, D2 = { getElementById: function () { return {}; }, head: { appendChild: function () {} }, documentElement: {} };
(new Function('window', 'document', HOLD))(W2, D2);
W2.VPTvHold.drawSetupQr(root);
ok('VPQR.draw gets exactly the sign-in link and nothing else', QR.length === 1 && QR[0][0] === 'https://venueplay.com.au/app/billing#screen', JSON.stringify(QR));
ok('the shared drawer is used, not a second QR function', /VPQR\.draw\(l\[i\], SETUP_URL, 560\)/.test(HOLD) && !/qrcode|toCanvas/i.test(HOLD.replace(/\/\*[\s\S]*?\*\//g, '')));
var urlLine = (HOLD.match(/var SETUP_URL = "[^"]*"/) || [''])[0];
ok('the address is one fixed string: no venue, slug, code, token or query', /^var SETUP_URL = "https:\/\/venueplay\.com\.au\/app\/billing#screen"$/.test(urlLine) && !/\?|slug|code|token|venue=/i.test(urlLine.replace('venueplay', '')), urlLine);
ok('the QR call takes no data from the page (no location, no venue, no storage in the draw function)', !/location|localStorage|VENUE_SLUG/.test(lift(HOLD, 'function drawSetupQr(root) {') + lift(HOLD, 'function setupHtml() {')));
ok('buildAds draws it after the slide is in the page', /adBuilt=true; adsSig=sig;\s*try\{ if\(window\.VPTvHold && window\.VPTvHold\.drawSetupQr\) window\.VPTvHold\.drawSetupQr\(host\)/.test(TV));

print('look and safe area');
var CSS = (HOLD.match(/\.tvsetup \.tvs-in\{[^']*\}/) || [''])[0];
ok('inside the 5% overscan: 6cqw side margins, content centred vertically', /left:6cqw;right:6cqw;top:50%/.test(CSS), CSS);
ok('large type for across a bar: headline 5cqw or more, steps 2cqw or more, link 1.9cqw or more',
   /tvs-h\{[^}]*font-size:(5|6)\.?\d*cqw/.test(HOLD) && /tvs-step\{[^}]*font-size:2\.\dcqw/.test(HOLD) && /tvs-link\{[^}]*font-size:(1\.9|2)\.?\d*cqw/.test(HOLD));
ok('brand: Hanken Grotesk, pink #FF1F8E, white, near-black card, no other face', /tvs-link\{[^}]*Hanken Grotesk/.test(HOLD) && /tvs-h2\{[^}]*#FF1F8E/.test(HOLD) && !/Anton|Manrope|Outfit/.test(lift(HOLD, 'function setupHtml() {')));
ok('the widths add up inside the margins (44 + 5 + 38 = 87cqw of 88)', /flex:0 0 44cqw/.test(HOLD) && /flex:0 0 38cqw/.test(HOLD) && /gap:5cqw/.test(HOLD));
ok('static: nothing animates on the set-up slide (no breathe class)', !/breathe/.test(lift(HOLD, 'function setupHtml() {')));
ok('the logo on it is the shared tv lockup, no second copy', /LOGO \+ '<\/div>'/.test(lift(HOLD, 'function setupHtml() {')));

print('');
if (bad) { print(bad + ' OF ' + ran + ' CHECKS FAILED'); throw new Error(bad + ' failed'); }
print('ALL ' + ran + ' CHECKS PASSED');
