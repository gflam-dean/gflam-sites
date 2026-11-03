/* WHAT KIND OF TV IS THIS (Dean, 1 Nov 2026; migration 139). This RUNS the real code from four files:
     venueplay/app/vp-tvtype.js   detect() against real user agent strings for every TV family, the
                                  one list of labels, and the setup line each TV gets
     venueplay/tv.html            tvKindParam, tvKindAnswered, tvShownParam, tvSetupFits: the type
                                  rides the poll ONCE per page load, never with the slide tally
     venueplay-game.js            screenKindParam and handleVenueLookup: still ONE database call,
                                  vp_screen_poll_kind, and the fallback before migration 139
     venueplay/app/hq.html        tvTypesSummary, tvTypesHtml, tvTypeBadge, loadTvTypes: the counts
   and reads migration 139 for its locks. The page, the clock and the database are stood in for.

   Run from the repo root:  jsc tools/test-tv-type.js
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
var TT = readFile('venueplay/app/vp-tvtype.js'), TV = readFile('venueplay/tv.html'),
    GAME = readFile('venueplay-backend/worker/venueplay-game.js'), HQ = readFile('venueplay/app/hq.html'),
    SQL = readFile('venueplay-backend/supabase/venueplay-139-screen-devices.sql');

var window = {};
(new Function('window', TT))(window);
var T = window.VPTvType;
check('vp-tvtype.js defines VPTvType', !!(T && T.detect && T.label && T.setup && T.LABELS));

print('the table, against real user agents');
var UAS = [
  ['app',        'Mozilla/5.0 (Linux; Android 12; Chromecast Build/STTE.230319.008; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.6099.230 Mobile Safari/537.36 VenuePlayTV/1.2', 'our Google Play app on a Chromecast'],
  ['app',        'Mozilla/5.0 (Linux; Android 11; SHIELD Android TV Build/RQ1A.210105.003; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/119.0.6045.163 Mobile Safari/537.36 VenuePlayTV/1.0', 'our app on a Shield'],
  ['samsung',    'Mozilla/5.0 (SMART-TV; LINUX; Tizen 6.0) AppleWebKit/537.36 (KHTML, like Gecko) 76.0.3809.146/6.0 TV Safari/537.36', 'Samsung Tizen 6.0'],
  ['samsung',    'Mozilla/5.0 (SMART-TV; Linux; Tizen 5.5) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/3.0 Chrome/69.0.3497.106 TV Safari/537.36', 'Samsung Tizen 5.5 (2020 sets)'],
  ['samsung',    'Mozilla/5.0 (SMART-TV; LINUX; Tizen 7.0) AppleWebKit/537.36 (KHTML, like Gecko) 94.0.4606.31/7.0 TV Safari/537.36', 'Samsung Tizen 7.0'],
  ['lg',         'Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/79.0.3945.79 Safari/537.36 WebAppManager', 'LG webOS 6'],
  ['lg',         'Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/68.0.3440.106 Safari/537.36 WebAppManager', 'LG webOS 5'],
  ['lg',         'Mozilla/5.0 (DirectFB; Linux armv7l) AppleWebKit/534.26+ (KHTML, like Gecko) Version/5.0 Safari/534.26+ LG Browser/5.00.00(+mouse+3D+SCREEN+TUNER; LGE; 42LM6700-UA; 04.02.00; 0x00000001;); LG NetCast.TV-2012 0', 'LG NetCast (2012)'],
  ['firetv',     'Mozilla/5.0 (Linux; Android 9; AFTKA Build/PS7633.3445N; wv) AppleWebKit/537.36 (KHTML, like Gecko) Silk/112.5.1 like Chrome/112.0.5615.213 Safari/537.36', 'Fire TV Stick 4K Max, Silk'],
  ['firetv',     'Mozilla/5.0 (Linux; Android 9; AFTMM Build/PS7233; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/108.0.5359.160 Mobile Safari/537.36', 'Fire TV Stick 4K, a web view (Fully Kiosk)'],
  ['firetv',     'Mozilla/5.0 (Linux; Android 9; AFTR Build/PS7656; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/108.0.5359.160 Mobile Safari/537.36', 'Fire TV Cube'],
  ['googletv',   'Mozilla/5.0 (Linux; Android 10; BRAVIA 4K UR3 Build/QTG3.200305.006.S292; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/103.0.5060.129 Mobile Safari/537.36', 'Sony Bravia on Google TV'],
  ['googletv',   'Mozilla/5.0 (Linux; Android 11; SHIELD Android TV Build/RQ1A.210105.003; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/119.0.6045.163 Mobile Safari/537.36', 'NVIDIA Shield'],
  ['googletv',   'Mozilla/5.0 (Linux; Android 11; Smart TV Pro Build/RTT2.211108.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/114.0.5735.196 Mobile Safari/537.36', 'TCL Google TV'],
  ['googletv',   'Mozilla/5.0 (Linux; Android 9; MIBOX4 Build/PI; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/96.0.4664.104 Mobile Safari/537.36', 'Xiaomi Mi Box'],
  ['googletv',   'Mozilla/5.0 (Linux; Android 9; Philips TV Build/PTT1.190826.001) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/87.0.4280.141 Safari/537.36', 'Philips Android TV'],
  ['googletv',   'Mozilla/5.0 (Linux; Android 12; Chromecast Build/STTE.230319.008; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.6099.230 Mobile Safari/537.36', 'Chromecast with Google TV (4K): a Google TV, so Google Play'],
  ['googletv',   'Mozilla/5.0 (Linux; Android 12; Chromecast HD Build/STTE.230319.008; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/119.0.6045.163 Mobile Safari/537.36', 'Chromecast with Google TV (HD)'],
  ['googletv',   'Mozilla/5.0 (Linux; Android 14; Google TV Streamer Build/UTT3.240625.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.6478.134 Mobile Safari/537.36', 'Google TV Streamer'],
  ['chromecast', 'Mozilla/5.0 (X11; Linux armv7l) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.225 Safari/537.36 CrKey/1.56.500000 DeviceType/Chromecast', 'the old cast-only Chromecast'],
  ['sony',       'Opera/9.80 (Linux mips; U; HbbTV/1.1.1 (; Sony; KDL32W650A; PKG3.211EUA; 2013;); ; en) Presto/2.12.362 Version/12.11', 'Sony Bravia before Android'],
  ['philips',    'Mozilla/5.0 (Linux; U; HbbTV/1.2.1 (+RTSP;Philips;TV;5.1.0;;) ce-html/1.0 NETTV/4.4.1 SmartTvA/3.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/62.0.3202.84 Safari/537.36', 'Philips NetTV'],
  ['hisense',    'Mozilla/5.0 (Linux; VIDAA 6.0; Hisense SmartTV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.77 Safari/537.36', 'Hisense VIDAA'],
  ['tcl',        'Mozilla/5.0 (Linux; TCL MT9602) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/88.0.4324.93 Safari/537.36 HbbTV/1.5.1 (+DRM; TCL; MT9602; V8-R51MT05-LF1V1;)', 'TCL, not Android'],
  ['othertv',    'Mozilla/5.0 (X11; FreeBSD; U; Viera; en-AU) AppleWebKit/537.11 (KHTML, like Gecko) Viera/3.10.0 Chrome/23.0.1271.97 Safari/537.11', 'Panasonic Viera'],
  ['othertv',    'Mozilla/5.0 (Linux; U; HbbTV/1.4.1 (+DRM; Toshiba; TV; 1.0; ;) ) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/75.0 Safari/537.36 OPR/46.0', 'another HbbTV set'],
  ['apple',      'AppleCoreMedia/1.0.0.20K71 (Apple TV; U; CPU OS 16_1 like Mac OS X; en_au)', 'Apple TV'],
  ['mobile',     'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1', 'iPhone'],
  ['mobile',     'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36', 'Samsung phone (not a Samsung TV)'],
  ['mobile',     'Mozilla/5.0 (Linux; Android 9; Sony G8441 Build/47.2.A.10.107) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36', 'Sony Xperia phone (not a Sony TV)'],
  ['mobile',     'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36', 'Chrome on Android, reduced user agent'],
  ['mobile',     'Mozilla/5.0 (Linux; Android 11; KFTRWI) AppleWebKit/537.36 (KHTML, like Gecko) Silk/120.4.1 like Chrome/120.0.6099.230 Safari/537.36', 'Kindle Fire tablet (not a Fire TV)'],
  ['pc',         'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36', 'Windows laptop'],
  ['pc',         'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15', 'Mac'],
  ['pc',         'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36', 'Chromebook'],
  ['pc',         'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36', 'Linux PC'],
  ['unknown',    'curl/8.4.0', 'something that is not a browser'],
  ['unknown',    '', 'no user agent at all']
];
UAS.forEach(function (u) { var got = T.detect(u[1], null, 0); check(u[2] + ' is ' + u[0], got === u[0], got); });
check('an iPad asking for the desktop site (Macintosh with touch) is a phone or tablet',
      T.detect('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15', null, 5) === 'mobile');
check('userAgentData is used when the string says nothing', T.detect('', { platform: 'Windows', mobile: false }, 0) === 'pc' && T.detect('', { platform: 'Android', mobile: true }, 0) === 'mobile');
check('a broken argument is Unknown, never a throw', (function () { try { return T.detect(null, 'x', 'y') === 'unknown' && T.detect(undefined) === 'unknown'; } catch (e) { return false; } })());
var FAMILIES = ['app', 'samsung', 'lg', 'firetv', 'googletv', 'chromecast', 'sony', 'philips', 'hisense', 'tcl', 'othertv', 'apple', 'pc', 'mobile', 'unknown'];
check('every family in the list is reached by at least one real user agent above',
      FAMILIES.every(function (f) { return UAS.some(function (u) { return u[0] === f; }); }));

print('the one list');
var codes = T.LABELS.map(function (l) { return l[0]; }), names = T.LABELS.map(function (l) { return l[1]; });
check('the list holds exactly the agreed types, in order', JSON.stringify(codes) === JSON.stringify(FAMILIES), codes);
check('the agreed names', T.label('app') === 'venueplay app' && T.label('samsung') === 'Samsung (Tizen)' && T.label('lg') === 'LG (webOS)' &&
      T.label('firetv') === 'Fire TV' && T.label('googletv') === 'Google TV / Android TV' && T.label('chromecast') === 'Chromecast' &&
      T.label('othertv') === 'Other smart TV' && T.label('apple') === 'Apple TV / AirPlay' && T.label('pc') === 'Laptop or PC' &&
      T.label('mobile') === 'Phone or tablet' && T.label('unknown') === 'Unknown', names);
check('every code fits the shape the Worker and the database accept', codes.every(function (c) { return /^[a-z]{2,12}$/.test(c); }));
check('no two types share a name', names.filter(function (n, i) { return names.indexOf(n) !== i; }).length === 0);
check('a code nobody knows is named Unknown', T.label('zz') === 'Unknown' && T.label(undefined) === 'Unknown' && T.isCode('lg') && !T.isCode('toString'));
check('hq.html and tv.html both load the one list', /<script src="\/app\/vp-tvtype\.js"><\/script>/.test(HQ) && /<script src="\/app\/vp-tvtype\.js"><\/script>/.test(TV));
check('no other file keeps its own copy of the names', !/"Samsung \(Tizen\)"/.test(HQ) && !/"Samsung \(Tizen\)"/.test(TV) && !/Samsung \(Tizen\)/.test(GAME));

print('the setup line for each TV');
var allWords = FAMILIES.map(function (f) { var s = T.setup(f); return [s.head, s.text, s.appHead, s.appText].join(' '); }).join(' ');
check('Fire TV and the other sets have no Google Play and no venueplay app: that half comes off and the browser steps say which app',
      ['firetv', 'sony', 'philips', 'hisense', 'tcl', 'othertv'].every(function (f) { var s = T.setup(f); return s.app === 'hide' && /screen code/.test(s.text) && /^On this /.test(s.head); }) &&
      /Internet app/.test(T.setup('samsung').head) && /LG TV/.test(T.setup('lg').head));
check('a Samsung and an LG: their own store, "coming soon", never Google Play, and the browser steps beside it (3 Nov 2026)',
      ['samsung', 'lg'].every(function (f) { var s = T.setup(f); return s.app === 'show' && s.stores.join() === f && /coming soon/.test(s.appHead) && !/Google Play/.test(s.appHead + s.appText) && /screen code/.test(s.text) && /^On this /.test(s.head); }) &&
      /Samsung Apps/.test(T.setup('samsung').appText) && /LG Content Store/.test(T.setup('lg').appText));
check('the store table: Google Play is live, Samsung Apps and the LG Content Store have no address yet (so nothing links to them)',
      T.STORES.play.url === 'https://play.google.com/store/apps/details?id=au.com.venueplay.tv' && T.STORES.samsung.url === '' && T.STORES.lg.url === '' &&
      T.STORES.samsung.name === 'Samsung Apps' && T.STORES.lg.name === 'LG Content Store');
check('a TV it cannot tell (and a computer or a phone): all three stores, Google Play first',
      ['unknown', 'nonsense', 'pc', 'mobile'].every(function (f) { return T.setup(f).stores.join() === 'play,samsung,lg'; }));
check('a Google TV and a Chromecast: Google Play only; Fire TV and our own app: no store', T.setup('googletv').stores.join() === 'play' && T.setup('chromecast').stores.join() === 'play' && !T.setup('firetv').stores && !T.setup('app').stores);
check('a Google TV and a Chromecast keep the Google Play line and say so', T.setup('googletv').app === 'show' && /Google Play/.test(T.setup('googletv').appHead) && T.setup('chromecast').app === 'show');
check('inside our own app the Google Play line comes off', T.setup('app').app === 'hide');
check('an unknown TV keeps the card exactly as written', T.setup('unknown').app === 'show' && T.setup('unknown').head === null && T.setup('unknown').text === null && T.setup('nonsense').head === null);
check('house rules: venueplay lowercase, no long dashes, no phone number, no .dev, never roster',
      !/VenuePlay|Venueplay/.test(allWords) && !/[–—]|&mdash;|&ndash;/.test(allWords) && !/\d{2}\s?\d{4}\s?\d{4}/.test(allWords) && !/\.dev\b|workers/.test(allWords) && !/roster/i.test(allWords), allWords.slice(0, 200));

print('the TV page: once per page load, on the poll it already makes');
var STORE = {}, SESSION = {};
var localStorage = { getItem: function (k) { return k in STORE ? STORE[k] : null; }, setItem: function (k, v) { STORE[k] = String(v); }, removeItem: function (k) { delete STORE[k]; } };
var sessionStorage = { getItem: function (k) { return k in SESSION ? SESSION[k] : null; }, setItem: function (k, v) { SESSION[k] = String(v); } };
var document = { visibilityState: 'visible' };
var crypto = { getRandomValues: function (a) { for (var i = 0; i < a.length; i++) a[i] = (i * 53 + 7) & 255; return a; } };
var UA_SAMSUNG = 'Mozilla/5.0 (SMART-TV; LINUX; Tizen 6.0) AppleWebKit/537.36 (KHTML, like Gecko) 76.0.3809.146/6.0 TV Safari/537.36';
var navigator = { userAgent: UA_SAMSUNG, maxTouchPoints: 0 };
window.location = { search: '' };
var VP_DEMO = false, VENUE_TZ = 'Australia/Brisbane', tvMode = 'ads';
var NOW = Date.parse('2026-10-09T10:00:00Z');
Date.now = function () { return NOW; };
var start = TV.indexOf('  var TV_SHOWN_SEND_MS'), end = TV.indexOf('  function tvShownBuild(');
var kStart = TV.indexOf('  var TV_KIND = '), kEnd = TV.indexOf('  /* A venue-linked screen does not need pairing');
check('the tally block and the TV type block are in tv.html', start > 0 && end > start && kStart > end && kEnd > kStart);
eval(TV.slice(start, end).replace(/^  var /mg, 'var '));
eval(liftFrom(TV, 'tvShownBuild', 'tv.html'));
eval(TV.slice(kStart, kEnd).replace(/^  var /mg, 'var '));
check('this TV is worked out as a Samsung, by the shared table', TV_KIND === 'samsung', TV_KIND);
check('it keeps one random id for this TV, nothing else', /^d[0-9a-f]{18}$/.test(tvKindDev) && STORE.vpTvDev === tvKindDev, tvKindDev);
check('the poll address carries the type ahead of the tally, both guarded',
      /\+\(typeof tvKindParam==="function" \? tvKindParam\(\) : ""\)\+\(typeof tvShownParam==="function" \? tvShownParam\(Date\.now\(\)\) : ""\)\)/.test(liftFrom(TV, 'validateVenue', 'tv.html')));
check('the answer is reported back, guarded, before anything else is read',
      /\.then\(function\(d\)\{\s*try\{ if\(typeof tvKindAnswered==="function"\) tvKindAnswered\(!!d\); \}catch\(e\)\{\}\s*if\(!d\)\{ return; \}/.test(liftFrom(TV, 'validateVenue', 'tv.html')));
/* The poll as validateVenue builds its tail: the type first, then the tally. */
function pollTail() { return tvKindParam() + tvShownParam(NOW); }
tvShownCount({ type: 'slide', slide: { head: 'Parma night' } }, 7000);
var t1 = pollTail();
check('the first poll says the type, and only the code and the id', t1 === '&tvk=samsung&tvd=' + tvKindDev, t1);
check('the user agent never leaves the TV', t1.indexOf('Tizen') < 0 && t1.indexOf('Mozilla') < 0 && t1.indexOf('SMART') < 0);
check('that poll carries no tally: it waits for the next one, so the Worker still makes one call', t1.indexOf('&shown=') < 0 && tvShownLastSent === 0);
tvKindAnswered(true);
NOW += 30000;
var t2 = pollTail();
check('the next poll does not say the type again, and the tally goes', t2.indexOf('&tvk=') < 0 && /^&shown=/.test(t2), t2.slice(0, 40));
NOW += 30000;
check('nor any poll after it, for the rest of the page load', [1, 2, 3, 4, 5].every(function () { NOW += 30000; return pollTail().indexOf('&tvk=') < 0; }));
// a fresh page load whose first polls go unanswered
tvKindDone = false; tvKindTries = 0; tvKindThisPoll = false;
var tries = 0;
for (var i = 0; i < 6; i++) { if (tvKindParam().indexOf('&tvk=') === 0) tries++; tvKindAnswered(false); }
check('an unanswered poll is tried again, at most three times a page load', tries === 3, tries);
tvKindDone = false; tvKindTries = 0;
var saved = TV_SHOWN_OFF; TV_SHOWN_OFF = true;
check('a probe and the demo page never say a type', tvKindParam() === '');
TV_SHOWN_OFF = saved;
var savedDev = tvKindDev; tvKindDev = '';
check('with no good random id, nothing is sent', tvKindParam() === '');
tvKindDev = savedDev;
var savedKind = TV_KIND; TV_KIND = 'Samsung Tizen 6.0';
check('a type that is not a code from the list is never sent', tvKindParam() === '');
TV_KIND = savedKind;
check('the same id after a reload: two screens are two, one screen is one', (function () {
  var before = tvKindDev; eval(TV.slice(kStart, kEnd).replace(/^  var /mg, 'var ')); return tvKindDev === before; })());

print('the setup card on this TV');
function El() { var e = { style: {}, innerHTML: '', attrs: {}, kids: {} }; e.querySelector = function (q) { return e.kids[q] || null; }; e.setAttribute = function (k, v) { e.attrs[k] = v; }; return e; }
function card() {
  var app = El(), code = El(), pp = El();
  app.kids['.su-head'] = El(); app.kids['.su-head'].innerHTML = 'Got a TV with Google Play? <b>Get the venueplay TV app</b>';
  app.kids['.su-text'] = El(); app.kids['.su-text'].innerHTML = 'Search for <b>venueplay TV</b> in the Play Store on this TV, open it and put in your screen code.';
  code.kids['.su-head'] = El(); code.kids['.su-head'].innerHTML = 'Or use this TV&rsquo;s web browser';
  code.kids['.su-text'] = El(); code.kids['.su-text'].innerHTML = 'Put in the six-character screen code from your host console.';
  return { suApp: app, suCode: code, pairPanel: pp };
}
var C;
function $(id) { return C[id] || null; }
eval(liftFrom(TV, 'tvSetupFits', 'tv.html'));
eval(liftFrom(TV, 'tvStoresFit', 'tv.html'));
check('tv.html applies the fitting line inside the set up card, after the app check', /if\(IN_APP\)\{ var a=\$\("suApp"\); if\(a\) a\.style\.display="none"; \}\s*tvSetupFits\(TV_KIND\);/.test(TV));
C = card(); tvSetupFits('samsung');
check('a Samsung: the app half says coming soon, not Google Play; the Internet app named, the screen code steps', C.suApp.style.display !== 'none' && /Samsung TVs is <b>coming soon/.test(C.suApp.kids['.su-head'].innerHTML) && /Samsung Apps/.test(C.suApp.kids['.su-text'].innerHTML) && /Samsung TV, use its Internet app/.test(C.suCode.kids['.su-head'].innerHTML) && /screen code/.test(C.suCode.kids['.su-text'].innerHTML) && C.pairPanel.attrs['data-tv-kind'] === 'samsung');
C = card(); tvSetupFits('lg');
check('an LG: the same, with the LG Content Store and its Web Browser', C.suApp.style.display !== 'none' && /LG TVs is <b>coming soon/.test(C.suApp.kids['.su-head'].innerHTML) && /LG TV, use its Web Browser/.test(C.suCode.kids['.su-head'].innerHTML));
C = card(); tvSetupFits('firetv');
check('a Fire TV: no Google Play and no venueplay app, so the app half comes off and only the browser steps stay', C.suApp.style.display === 'none' && /Fire TV, use its web browser/.test(C.suCode.kids['.su-head'].innerHTML));
C = card(); tvSetupFits('googletv');
check('a Google TV: the Google Play line stays and says this TV has it', C.suApp.style.display !== 'none' && /This TV has Google Play/.test(C.suApp.kids['.su-head'].innerHTML));
C = card(); tvSetupFits('unknown');
check('an unknown TV: the card is left exactly as written', C.suApp.style.display !== 'none' && /^Got a TV with Google Play/.test(C.suApp.kids['.su-head'].innerHTML) && /^Or use this TV/.test(C.suCode.kids['.su-head'].innerHTML));
function storeCard() { var c = card(); c.tvPlayLink = El(); c.suStore = El(); c.suStore.hidden = true; c.suStoreName = El(); c.suSoon = El(); return c; }
C = storeCard(); tvSetupFits('samsung');
check('a Samsung: the Google Play badge is hidden and the store box says Samsung Apps, coming soon', C.tvPlayLink.style.display === 'none' && C.suStore.hidden === false && C.suStoreName.textContent === 'Samsung Apps' && C.suSoon.hidden === true);
C = storeCard(); tvSetupFits('lg');
check('an LG: the LG Content Store', C.tvPlayLink.style.display === 'none' && C.suStore.hidden === false && C.suStoreName.textContent === 'LG Content Store');
C = storeCard(); tvSetupFits('googletv');
check('a Google TV: the badge, no store box, no coming-soon line', C.tvPlayLink.style.display === '' && C.suStore.hidden === true && C.suSoon.hidden === true);
C = storeCard(); tvSetupFits('unknown');
check('a TV it cannot tell: the badge first, then "Samsung Apps and LG Content Store: coming soon"', C.tvPlayLink.style.display === '' && C.suStore.hidden === true && C.suSoon.hidden === false && C.suSoon.textContent === 'Samsung Apps and LG Content Store: coming soon');
var savedT = window.VPTvType; window.VPTvType = undefined; C = card();
check('without the shared script the card is untouched and nothing throws', (function () { try { tvSetupFits('samsung'); return C.suApp.style.display !== 'none'; } catch (e) { return false; } })());
window.VPTvType = savedT;

print('the game Worker: one call, the type inside it');
var enc = encodeURIComponent;
function URL(u) { var q = u.indexOf('?') >= 0 ? u.slice(u.indexOf('?') + 1) : '', map = {};
  q.split('&').forEach(function (kv) { if (!kv) return; var i = kv.indexOf('='); map[decodeURIComponent(i < 0 ? kv : kv.slice(0, i))] = i < 0 ? '' : decodeURIComponent(kv.slice(i + 1)); });
  this.searchParams = { get: function (k) { return (k in map) ? map[k] : null; } }; }
function json(o) { return { _json: o }; }
var console = { log: function () {}, warn: function () {} };
function sbHeaders() { return {}; }
var CALLS = [], MISSING = {};
function fetch(url, opts) {
  var fn = url.split('/rpc/')[1];
  CALLS.push({ fn: fn, body: JSON.parse(opts.body) });
  if (MISSING[fn]) return Promise.resolve({ status: 404, ok: false });
  return Promise.resolve({ status: 200, ok: true, json: function () { return Promise.resolve([{ id: 'v1', name: 'The Royal Hotel', slug: 'royal', status: 'active' }]); } });
}
function venueLookupThreeTrips() { CALLS.push({ fn: 'three-trips' }); return Promise.resolve(null); }
function venueLookupReply(j, v) { return j({ exists: true, name: v.name }); }
var screenPollRpcMissing = false, screenShownRpcMissing = false, screenKindRpcMissing = false;
eval(liftFrom(GAME, 'screenShownTally', 'venueplay-game.js'));
eval(liftFrom(GAME, 'screenKindParam', 'venueplay-game.js'));
eval(liftFrom(GAME, 'handleVenueLookup', 'venueplay-game.js'));
function req(q) { return { url: 'https://api/venue?' + q }; }
var TALLY = enc(JSON.stringify({ n: '2026-10-09', s: 'tvABCDEF12', c: { 'i:parma-1.jpg': [3, 21] } }));

(async function () {
  CALLS = [];
  var r = await handleVenueLookup(req('venue=royal&code=KQ7M2N&v=x&tvk=samsung&tvd=d07' + '3c'.repeat(8)), {}, json);
  check('a poll with the type is ONE call, to vp_screen_poll_kind, and the screen gets its answer',
        CALLS.length === 1 && CALLS[0].fn === 'vp_screen_poll_kind' && r._json.exists === true, CALLS.map(function (c) { return c.fn; }));
  check('it carries the slug, the code, the build, the type and the id, nothing else',
        CALLS[0].body.p_kind === 'samsung' && CALLS[0].body.p_device === 'd07' + '3c'.repeat(8) && CALLS[0].body.p_slug === 'royal' &&
        Object.keys(CALLS[0].body).sort().join() === 'p_code,p_device,p_kind,p_slug,p_version', CALLS[0].body);
  CALLS = [];
  await handleVenueLookup(req('venue=royal&code=KQ7M2N&v=x'), {}, json);
  check('a plain poll is still one call to vp_screen_poll', CALLS.length === 1 && CALLS[0].fn === 'vp_screen_poll' && !('p_kind' in CALLS[0].body));
  var badOnes = ['tvk=Samsung&tvd=d0123456789', 'tvk=' + enc('Mozilla/5.0 (SMART-TV)') + '&tvd=d0123456789', 'tvk=samsung&tvd=x', 'tvk=samsung', 'tvd=d0123456789', 'tvk=averyveryverylongcode&tvd=d0123456789'];
  var allPlain = true;
  for (var b = 0; b < badOnes.length; b++) { CALLS = []; await handleVenueLookup(req('venue=royal&code=KQ7M2N&v=x&' + badOnes[b]), {}, json); if (!(CALLS.length === 1 && CALLS[0].fn === 'vp_screen_poll')) allPlain = false; }
  check('a type that is not a code, a user agent, or an id of the wrong shape is ignored and the screen answered as before', allPlain);
  CALLS = [];
  await handleVenueLookup(req('venue=royal&code=KQ7M2N&v=x&probe=1&tvk=pc&tvd=d0123456789'), {}, json);
  check('a probe never writes a type', CALLS.every(function (c) { return c.fn !== 'vp_screen_poll_kind'; }), CALLS);
  CALLS = [];
  await handleVenueLookup(req('venue=royal&code=KQ7M2N&v=x&shown=' + TALLY + '&tvk=pc&tvd=d0123456789'), {}, json);
  check('if a type ever comes with a tally, the tally wins and it is still one call', CALLS.length === 1 && CALLS[0].fn === 'vp_screen_poll_shown' && !('p_kind' in CALLS[0].body), CALLS);
  MISSING.vp_screen_poll_kind = true; CALLS = [];
  var r2 = await handleVenueLookup(req('venue=royal&code=KQ7M2N&v=x&tvk=lg&tvd=d0123456789'), {}, json);
  check('before migration 139: the new function 404s, the same request falls back to vp_screen_poll and the screen still gets its answer',
        CALLS.map(function (c) { return c.fn; }).join() === 'vp_screen_poll_kind,vp_screen_poll' && r2._json.exists === true && screenKindRpcMissing === true && !('p_kind' in CALLS[1].body), CALLS);
  CALLS = [];
  await handleVenueLookup(req('venue=royal&code=KQ7M2N&v=x&tvk=lg&tvd=d0123456789'), {}, json);
  check('and from then on that isolate asks only vp_screen_poll', CALLS.length === 1 && CALLS[0].fn === 'vp_screen_poll', CALLS);
  check('and the fast poll itself is never given up because of the type', screenPollRpcMissing === false);

  print('HQ: TVs by type');
  var S = { testFlag: { vTest: true } };
  var esc = function (s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); };
  var TV_TYPES_DAYS = 30;
  eval(liftFrom(HQ, 'tvTypeLabel', 'hq.html'));
  eval(liftFrom(HQ, 'tvTypesSummary', 'hq.html'));
  eval(liftFrom(HQ, 'tvTypesHtml', 'hq.html'));
  eval(liftFrom(HQ, 'tvTypeBadge', 'hq.html'));
  check('HQ looks back thirty days', /var TV_TYPES_DAYS = 30;/.test(HQ));
  var HQNOW = Date.parse('2026-11-01T10:00:00Z'), day = 86400000;
  function at(d) { return new Date(HQNOW - d * day).toISOString(); }
  var ROWS = [
    { venue_id: 'vRoyal', device_id: 'd1', kind: 'samsung', last_seen_at: at(0) },
    { venue_id: 'vRoyal', device_id: 'd2', kind: 'samsung', last_seen_at: at(2) },
    { venue_id: 'vRoyal', device_id: 'd3', kind: 'firetv', last_seen_at: at(1) },
    { venue_id: 'vTugun', device_id: 'd4', kind: 'lg', last_seen_at: at(3) },
    { venue_id: 'vTugun', device_id: 'd5', kind: 'samsung', last_seen_at: at(40) },        // gone quiet: not counted
    { venue_id: 'vTest', device_id: 'd6', kind: 'pc', last_seen_at: at(0) },               // a test venue
    { venue_id: 'vBistro', device_id: 'd7', kind: 'zzfuture', last_seen_at: at(0) }       // a code from a newer list
  ];
  var sum = tvTypesSummary(ROWS, function (id) { return !!S.testFlag[id]; }, HQNOW);
  check('counted by type across venues, most first, ties in the list\'s order', JSON.stringify(sum.byKind) === JSON.stringify([['samsung', 'Samsung (Tizen)', 2], ['lg', 'LG (webOS)', 1], ['firetv', 'Fire TV', 1], ['zzfuture', 'Unknown', 1]]), sum.byKind);
  check('5 screens at 3 venues: a TV not heard from in 30 days and the test venue left out', sum.total === 5 && sum.venues === 3, [sum.total, sum.venues]);
  check('per venue: The Royal has two Samsungs and a Fire TV', JSON.stringify(sum.perVenue.vRoyal) === '{"samsung":2,"firetv":1}', sum.perVenue.vRoyal);
  check('a test venue still shows its own TV on its own row', JSON.stringify(sum.perVenue.vTest) === '{"pc":1}');
  var html = tvTypesHtml(sum);
  check('the summary paints the counts with their names', /TVs by type/.test(html) && /Samsung \(Tizen\) <b class="mono" style="color:#fff">2<\/b>/.test(html) && /5 screens at 3 venues/.test(html) && /test venues left out/.test(html), html.slice(0, 200));
  check('in HQ\'s own badges', (html.match(/class="badge indep"/g) || []).length === 4);
  var badge = tvTypeBadge(sum.perVenue.vRoyal);
  check('the venue row says what its TVs are', /TV: Samsung \(Tizen\) x2, Fire TV<\/span>$/.test(badge), badge);
  check('a venue with no TV heard from says nothing', tvTypeBadge(undefined) === '' && tvTypeBadge({}) === '');
  check('before migration 139 HQ says so', /migration 139 is run/.test(tvTypesHtml(null)));
  check('no TV has said yet: HQ says that, not zero', /no venue screen has said yet/.test(tvTypesHtml(tvTypesSummary([], null, HQNOW))));
  var nasty = tvTypesHtml(tvTypesSummary([{ venue_id: 'x', kind: '<img src=x onerror=alert(1)>', last_seen_at: at(0) }], null, HQNOW));
  check('a code is never painted as markup', nasty.indexOf('<img') < 0, nasty);
  check('the venue row carries the badge in its own span, repainted when the read lands',
        /statusCell \+= ' <span data-tvtype="'\+esc\(v\.id\)\+'">' \+ tvTypeBadge\(S\.tvTypes && S\.tvTypes\.perVenue\[v\.id\]\) \+ '<\/span>';/.test(HQ) && /id="tvTypesOut"/.test(HQ) && /renderVenues\(\); loadTvTypes\(\);/.test(HQ));

  // loadTvTypes, against a stand-in for the database that pages the way PostgREST does
  var BIG = []; for (var n = 0; n < 2345; n++) BIG.push({ venue_id: 'v' + (n % 400), device_id: 'd' + n, kind: n % 3 ? 'samsung' : 'lg', last_seen_at: new Date(Date.now() - day).toISOString() });
  var REFUSE = false, ASKED = [];
  var OUT = { innerHTML: '' }, SPANS = [{ k: 'v1', innerHTML: '', getAttribute: function () { return 'v1'; } }];
  var VP = { getClient: function () { return { from: function (t) {
    var q = { t: t, f: 0, l: 0 };
    var b = { select: function () { return b; }, gte: function () { return b; }, order: function () { return b; },
      range: function (f, l) { q.f = f; q.l = l; ASKED.push(t + ':' + f); return Promise.resolve(REFUSE ? { data: null, error: { message: 'relation "public.vp_screen_devices" does not exist' } } : { data: BIG.slice(f, Math.min(l + 1, f + 1000)), error: null }); } };
    return b; } }; } };
  var $ = function (id) { return id === 'tvTypesOut' ? OUT : null; };
  var document = { querySelectorAll: function () { return SPANS; } };
  eval(liftFrom(HQ, 'loadTvTypes', 'hq.html'));
  await loadTvTypes();
  check('HQ reads every row, paging past 1,000 until an empty page', S.tvTypes && S.tvTypes.total === 2345 && ASKED.join() === 'vp_screen_devices:0,vp_screen_devices:1000,vp_screen_devices:2000,vp_screen_devices:2345', ASKED);
  check('and paints the summary and each venue row', /2345 screens at 400 venues/.test(OUT.innerHTML) && /^<span class="badge indep"/.test(SPANS[0].innerHTML), OUT.innerHTML.slice(0, 120));
  REFUSE = true; ASKED = [];
  await loadTvTypes();
  check('a refused read (migration 139 not run, or not an HQ login) says so and touches nothing else', S.tvTypes === null && /migration 139 is run/.test(OUT.innerHTML));

  print('the migration: locked, one call, bounded');
  check('vp_screen_poll_kind answers first with vp_screen_poll\'s own rows', /return query select \* from public\.vp_screen_poll\(p_slug, p_code, p_version\);/.test(SQL));
  check('the type cannot cost the screen its answer: its own exception block', /exception when others then\s+return;/.test(SQL));
  check('only a code and an id of the right shape are kept', /p_kind !~ '\^\[a-z\]\{2,12\}\$'/.test(SQL) && /p_device !~ '\^\[A-Za-z0-9_-\]\{6,40\}\$'/.test(SQL) && /check \(kind ~ '\^\[a-z\]\{2,12\}\$'\)/.test(SQL));
  check('at most twenty recent screens a venue, and old ones cleared', /\) >= 20 then/.test(SQL) && /interval '180 days'/.test(SQL));
  check('the table keeps no user agent, no address, nothing about a person',
        (function () { var m = SQL.match(/create table if not exists public\.vp_screen_devices \(([\s\S]*?)\n\);/); return m && !/user_agent|\bua\b|ip_|address|email|phone|name/i.test(m[1]); })());
  check('anon reaches nothing: every grant revoked from anon by name', /revoke all on public\.vp_screen_devices from public, anon, authenticated;/.test(SQL) && !/grant [^;]* on public\.vp_screen_devices to [^;]*anon/.test(SQL));
  check('a venue login reads nothing: SELECT for authenticated only through an HQ-admin policy', /grant select on public\.vp_screen_devices to authenticated;/.test(SQL) && /for select to authenticated\s+using \(public\.vp_is_platform_admin\(\)\);/.test(SQL) && /enable row level security/.test(SQL));
  check('the function is the service role\'s alone', /revoke all on function public\.vp_screen_poll_kind\(text, text, text, text, text\) from public, anon, authenticated;/.test(SQL) && /grant execute on function public\.vp_screen_poll_kind\(text, text, text, text, text\) to service_role;/.test(SQL));
  check('and the migration refuses to commit if anon or a venue login could read or write it', /has_table_privilege\('anon', 'public\.vp_screen_devices', 'select'\)/.test(SQL) && /raise exception 'Migration 139 self-check/.test(SQL));
  check('MIGRATIONS.md records it', /venueplay-139-screen-devices\.sql/.test(readFile('venueplay-backend/supabase/MIGRATIONS.md')));

  print(fails ? (fails + ' of ' + ran + ' checks FAILED') : ('ALL ' + ran + ' CHECKS PASSED'));
})().catch(function (e) { print('  FAIL the suite threw: ' + e + (e && e.stack ? '\n' + e.stack : '')); print('1 of 1 checks FAILED'); });
