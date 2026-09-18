/* OUR OWN CHECKS MUST NOT SHOW UP AS VISITORS.

   Dean, 18 Sep 2026: "Can we also not include bots?"

   GA4 filters known spiders. It cannot filter US. tools/verify-live.py drives a REAL
   browser through three live pages every run and waits forty seconds on each, which to
   Google is not a bot, it is the most engaged visitor of the day.

   This RUNS the shipped venueplay/app/vp-analytics.js under jsc with a fake window, once
   as a robot and once as a person, and asserts what it actually appended to the head.

   Run:  jsc tools/test-analytics-ignores-robots.js
*/
var SRC = readFile('venueplay/app/vp-analytics.js');
if (!SRC || SRC.length < 400) throw new Error('could not read vp-analytics.js');

var PASS = 0, FAIL = 0;
function check(name, cond, saw) {
  if (cond) { PASS++; print('  ok   ' + name); }
  else { FAIL++; print('  FAIL ' + name + (saw !== undefined ? '   saw: ' + JSON.stringify(saw) : '')); }
}

/* Run the file against a described browser and report what it loaded. */
function run(nav) {
  var appended = [];
  var win = { navigator: nav, dataLayer: undefined };
  var doc = {
    head: { appendChild: function (el) { appended.push(el.src || ''); } },
    createElement: function () { return { async: false, src: '' }; }
  };
  win.window = win;
  win.document = doc;
  var fn = new Function('window', 'document', 'navigator', SRC);
  fn(win, doc, nav);
  return { loaded: appended, dataLayer: win.dataLayer };
}

var PERSON  = { webdriver: false, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/605.1' };
var ROBOT   = { webdriver: true,  userAgent: 'Mozilla/5.0 (Macintosh) Chrome/127.0.0.0 Safari/537.36' };
var HEADLESS= { webdriver: false, userAgent: 'Mozilla/5.0 (Macintosh) HeadlessChrome/127.0.0.0 Safari/537.36' };
var BROKEN  = { get webdriver() { throw new Error('blocked'); }, userAgent: 'Mozilla/5.0 (Windows NT 10.0) Firefox/128.0' };

print('Our own robots must not be counted as visitors');
print('');

var p = run(PERSON);
check('a real phone DOES load the tag', p.loaded.length === 1 && /googletagmanager\.com/.test(p.loaded[0]), p.loaded);
check('and the tag carries the VenuePlay measurement id',
      /id=G-E2CZM4BZCH/.test(p.loaded[0] || ''), p.loaded[0]);
check('and dataLayer was started', !!p.dataLayer && p.dataLayer.length >= 2,
      p.dataLayer && p.dataLayer.length);

var r = run(ROBOT);
check('navigator.webdriver true loads NOTHING', r.loaded.length === 0, r.loaded);
check('and does not start a dataLayer either', !r.dataLayer, r.dataLayer);

var h = run(HEADLESS);
check('a HeadlessChrome user agent loads nothing', h.loaded.length === 0, h.loaded);

/* If we cannot tell, count them. A missed visit is cheap; a venue we never knew about
   because the guard was too eager is not. */
var b = run(BROKEN);
check('when the browser refuses to say, we COUNT the visit rather than drop it',
      b.loaded.length === 1, b.loaded);

/* The id must exist in exactly one place. Fourteen pages used to carry their own copy. */
var pages = 0, inline = 0;
['index', 'nsw', 'qld', 'vic', 'sa', 'wa', 'nt', 'tas', 'act', 'terms', 'privacy',
 'training', 'see-a-night', 'last-call'].forEach(function (n) {
  var h = readFile('venueplay/' + n + '.html');
  if (!h) return;
  pages++;
  if (/G-E2CZM4BZCH/.test(h)) inline++;
});
check('no page carries its own copy of the measurement id (' + pages + ' pages checked)',
      pages >= 14 && inline === 0, inline + ' page(s) still inline it');
check('and every one of them loads the shared script',
      pages >= 14 && ['index', 'nsw', 'qld', 'vic', 'sa', 'wa', 'nt', 'tas', 'act', 'terms',
        'privacy', 'training', 'see-a-night', 'last-call']
        .every(function (n) { return /vp-analytics\.js/.test(readFile('venueplay/' + n + '.html') || ''); }));

print('');
print(PASS + ' passed, ' + FAIL + ' failed');
if (FAIL) { print('FAILED ' + FAIL); throw new Error(FAIL + ' check(s) failed'); }
print('PASS');
