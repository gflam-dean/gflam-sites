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

/* Run the file against a described browser and report what it loaded, plus a way to
   fire a click at it afterwards. */
function run(nav, opts) {
  opts = opts || {};
  var appended = [];
  var handlers = [];
  var store = opts.store || {};
  var win = { navigator: nav, dataLayer: undefined,
              location: { pathname: '/', host: 'venueplay.com.au',
                          search: opts.search || '' },
              localStorage: {
                getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
                setItem: function (k, v) { store[k] = String(v); },
                removeItem: function (k) { delete store[k]; }
              } };
  win._store = store;
  var doc = {
    head: { appendChild: function (el) { appended.push(el.src || ''); } },
    createElement: function () { return { async: false, src: '' }; },
    addEventListener: function (type, fn) { if (type === 'click') handlers.push(fn); }
  };
  win.window = win;
  win.document = doc;
  var fn = new Function('window', 'document', 'navigator', 'location', 'localStorage', SRC);
  fn(win, doc, nav, win.location, win.localStorage);

  // A stand-in for the element a real click lands on: usually a span INSIDE the anchor.
  function clickOn(tag, href, text, path) {
    if (path) win.location.pathname = path;
    var el = { tagName: tag, getAttribute: function (k) {
                 return k === 'href' ? href : null; }, textContent: text };
    var inner = { closest: function () { return el; } };
    handlers.forEach(function (h) { h({ target: inner }); });
    return win.dataLayer ? win.dataLayer[win.dataLayer.length - 1] : null;
  }
  return { loaded: appended, dataLayer: win.dataLayer, clickOn: clickOn,
           handlers: handlers.length, store: store };
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

/* A CLICK MUST BE VISIBLE, especially an in-page anchor.
   "Get started" and "See the game modes" both point at #claim and #modes. GA4's own click
   tracking only covers links LEAVING the site, so every press of the main button on the
   homepage was invisible. 292 people saw that page in 30 days and nobody could say whether
   one of them touched it. */
var c = run(PERSON);
check('a click handler is registered at all', c.handlers === 1, c.handlers);

var ev = c.clickOn('A', '#claim', 'Get started');
check('an in-page anchor click is reported', !!ev && ev[0] === 'event' && ev[1] === 'cta_click',
      ev && [ev[0], ev[1]]);
check('and it is labelled with what the button says',
      !!ev && ev[2] && ev[2].cta_label === 'Get started', ev && ev[2]);
check('and marked as an anchor, which is the invisible kind',
      !!ev && ev[2] && ev[2].cta_kind === 'anchor', ev && ev[2] && ev[2].cta_kind);

var ev2 = c.clickOn('A', 'https://example.com/x', 'Somewhere else');
check('a link off the site is marked outbound',
      !!ev2 && ev2[2].cta_kind === 'outbound', ev2 && ev2[2] && ev2[2].cta_kind);

var ev3 = c.clickOn('A', '/nsw', 'See the NSW price');
check('a link to another page of ours is marked internal',
      !!ev3 && ev3[2].cta_kind === 'internal', ev3 && ev3[2] && ev3[2].cta_kind);

var ev4 = c.clickOn('A', 'mailto:hello@venueplay.com.au', 'Email us');
check('an email link is marked as email',
      !!ev4 && ev4[2].cta_kind === 'email', ev4 && ev4[2] && ev4[2].cta_kind);

/* WHICH PAGE was it pressed on. The homepage and the state pages quote different
   prices, so a "Get started" on /nsw is a different event to one on /. */
var s1 = c.clickOn('A', '#claim', 'Get started', '/nsw');
check('a press on /nsw is tagged NSW', !!s1 && s1[2].cta_state === 'NSW',
      s1 && s1[2] && s1[2].cta_state);
var s2 = c.clickOn('A', '#claim', 'Get started', '/');
check('a press on the homepage is tagged home', !!s2 && s2[2].cta_state === 'home',
      s2 && s2[2] && s2[2].cta_state);
var s3 = c.clickOn('A', '#claim', 'Get started', '/qld.html');
check('the .html form of a state page is tagged the same', !!s3 && s3[2].cta_state === 'QLD',
      s3 && s3[2] && s3[2].cta_state);
var s4 = c.clickOn('A', '#x', 'Watch', '/see-a-night');
check('a non-state page keeps its own name', !!s4 && s4[2].cta_state === 'see-a-night',
      s4 && s4[2] && s4[2].cta_state);

/* A robot must not register a click handler either, or our own checks would post
   fake button presses on top of fake visits. */
var rc = run(ROBOT);
check('a robot registers no click handler at all', rc.handlers === 0, rc.handlers);

/* THE TEAM OPT-OUT, because the IP route is closed: Dean is behind Carrier Grade NAT,
   so his public address is shared with other subscribers and an IP filter would bin
   their traffic too, silently. This one travels with the browser instead. */
var o1 = run(PERSON, { search: '?noga=1' });
check('?noga=1 stops counting this browser', o1.loaded.length === 0, o1.loaded);
check('and it is remembered for next time', o1.store.vpNoAnalytics === '1', o1.store);

var o2 = run(PERSON, { store: { vpNoAnalytics: '1' } });
check('a browser already opted out stays out with no parameter',
      o2.loaded.length === 0, o2.loaded);
check('and registers no click handler either', o2.handlers === 0, o2.handlers);

var o3 = run(PERSON, { search: '?noga=0', store: { vpNoAnalytics: '1' } });
check('?noga=0 turns counting back on', o3.loaded.length === 1, o3.loaded);
check('and forgets the opt-out', o3.store.vpNoAnalytics === undefined, o3.store);

var o4 = run(PERSON, { search: '?utm_source=email&noga=1' });
check('it still works alongside other query parameters', o4.loaded.length === 0, o4.loaded);

/* ?noga=10 is the case that actually tests the word boundary. ?nogay=1 does NOT contain
   "noga=1" at all, so the first version of this check could not fail: removing the \b from
   the pattern left it green. Caught by mutating the file and watching nothing happen. */
var o5 = run(PERSON, { search: '?noga=10' });
check('a value that merely STARTS with 1 does not opt out',
      o5.loaded.length === 1, o5.loaded);

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
