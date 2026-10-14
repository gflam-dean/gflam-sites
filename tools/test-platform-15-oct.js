/* THE PUBLIC SITE, AFTER THE AUDIT OF 14 OCT 2026.

   1. The demos named a real customer (its name, its logo, its promo artwork) on the sales
      pages. Dean's rule: never name a real venue to a prospect. The demo pub is The Local.
   2. The Meta pixel fired on load, so every crawler and mail scanner was a Meta visitor.
      It now waits on the same gate as Google Analytics (vpWhenHuman in vp-analytics.js).
   3. Unknown addresses answered 200 with the homepage. 404.html switches that off, so every
      route a page or an email sends people to must exist as a file or a _redirects rule.
   4. sitemap.xml, robots.txt, llms.txt and the canonical tags named www, which 301s.
   5. Internal pages without noindex; the old Tester Hub (with a personal email on it) public.
   10. unsubscribe.html wrote the opt-out on page load, so a mail scanner that runs the page
      unsubscribed people who never asked.

   The demo blocks, both analytics tags and the unsubscribe script are lifted out of the
   shipped files and RUN against stubs. Run: jsc tools/test-platform-15-oct.js (repo root). */
var ran = 0, bad = 0;
function ok(n, c, saw) { ran++; if (c) print('  ok   ' + n); else { bad++; print('  FAIL ' + n + (saw !== undefined ? '   saw: ' + saw : '')); } }
function read(rel) { return readFile(rel); }
function exists(rel) { try { var b = readFile(rel, 'binary'); return !!b && b.length > 100; } catch (e) { return false; } }

/* the text from `start` to its matching close brace, skipping strings and comments */
function block(src, start) {
  var i = src.indexOf(start); if (i < 0) return null;
  var k = src.indexOf('{', i), d = 0, q = null;
  for (; k < src.length; k++) {
    var c = src[k], n = src[k + 1];
    if (q) { if (c === '\\') { k++; continue; } if (c === q) q = null; continue; }
    if (c === '/' && n === '*') { k = src.indexOf('*/', k + 2) + 1; continue; }
    if (c === '/' && n === '/') { k = src.indexOf('\n', k); continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if (c === '{') d++;
    else if (c === '}') { d--; if (d === 0) return src.slice(src.indexOf('{', i) + 1, k); }
  }
  return null;
}
function stripComments(t) {
  return t.replace(/<!--[\s\S]*?-->/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:\\'"])\/\/[^\n]*/g, '$1');
}

print('== 1. the demo pub is invented, on every screen a prospect sees ==');
['musical', 'trivia', 'members', 'raffle'].forEach(function (g) {
  var src = read('venueplay/app/' + g + '/screen.html');
  var b = block(src, 'if(VP_DEMO){\n    /* The demo venue');
  if (!b) { ok(g + ': the demo block came out of the screen', false); return; }
  var tag = { textContent: '', hidden: false }, painted = null;
  var doc = { getElementById: function (id) { return id === 'venueNameTag' ? tag : null; } };
  new Function('window', 'document', 'paintVenueLogo', b)({ location: { search: '' } }, doc, function (u) { painted = u; });
  ok(g + ': the wall is named The Local', tag.textContent === 'The Local', tag.textContent);
  ok(g + ': and wears The Local\'s logo, a file on this site', painted === '/logos/venue-the-local.png' && exists('venueplay' + painted), painted);
});
var TV = read('venueplay/tv.html');
var tvb = block(TV, 'if(DEMO){\n      setVenueName(');
ok('tv.html: the demo block came out of loadVenueScreen', !!tvb);
if (tvb) {
  var named = null, logo = null, ADS = {};
  var runTv = new Function('setVenueName', 'setVenueLogo', 'buildAds', 'startAds', 'ADS', 'location', 'window',
    'return (function(){' + tvb + '})();');
  runTv(function (n) { named = n; }, function (u) { logo = u; }, function () {}, function () {}, ADS,
        { origin: 'https://venueplay.com.au' }, { location: { search: '' } });
  ok('tv.html: the corner says The Local', named === 'The Local', named);
  ok('tv.html: the demo logo is The Local\'s, and the file is there', logo === '/logos/venue-the-local.png' && exists('venueplay' + logo), logo);
  var imgs = (ADS.slides || []).filter(function (s) { return s.image_url; });
  ok('tv.html: the photo slides are still in the loop (four)', imgs.length === 4, imgs.length);
  var missing = imgs.filter(function (s) { return !exists('venueplay' + s.image_url.replace('https://venueplay.com.au', '')); });
  ok('tv.html: every photo slide is a file on this site', !missing.length, missing.map(function (s) { return s.image_url; }).join(', '));
  ok('tv.html: no slide, name or logo names a real venue', !/tugun/i.test(JSON.stringify(ADS) + named + logo), JSON.stringify(ADS).slice(0, 200));
  var logo2 = null;
  runTv(function () {}, function (u) { logo2 = u; }, function () {}, function () {}, {}, { origin: 'x' }, { location: { search: '?logo=%2Flogos%2Fprospect.png' } });
  ok('control: ?logo=/path still puts a prospect\'s own logo up', logo2 === '/logos/prospect.png', logo2);
}
var SAN = read('venueplay/see-a-night.html');
var sanImgs = SAN.match(/\/logos\/ad-slides\/[a-z-]+\.jpg/g) || [];
ok('see-a-night: its four ad pictures are files on this site', sanImgs.length === 4 && sanImgs.every(function (p) { return exists('venueplay' + p); }), sanImgs.join(', '));
/* Every page and script the site serves, comments aside (they are the history of why), names no
   real venue. The list of names is the one Dean has had to rule on; add to it, never remove. */
var REAL = /tugun/i;
var served = ['index.html', 'nsw.html', 'see-a-night.html', 'tv.html', 'play.html', 'signage.html', 'training.html',
  'screen-check.html', 'jag-check.html', '404.html', 'leave-behind.html', 'leave-behind-club.html', 'leave-behind-pub.html',
  'leave-behind-rsl.html', 'privacy.html', 'terms.html', 'unsubscribe.html', 'add-card.html',
  'app/musical/screen.html', 'app/trivia/screen.html', 'app/members/screen.html', 'app/raffle/screen.html',
  'app/jag/screen.html', 'app/topanswers/screen.html', 'emails/welcome-hq.html'];
var named2 = served.filter(function (f) { return REAL.test(stripComments(read('venueplay/' + f))); });
ok('no public page names a real venue outside a comment', !named2.length, named2.join(', '));

print('\n== 2. the Meta pixel waits for a person, through the same gate as Analytics ==');
var GA = read('venueplay/app/vp-analytics.js'), PX = read('venueplay/app/vp-pixel.js');
function browse(nav, opts) {
  opts = opts || {};
  var loaded = [], human = [], store = opts.store || {};
  var win = { navigator: nav, location: { pathname: '/', host: 'venueplay.com.au', hostname: 'venueplay.com.au', search: opts.search || '' },
              localStorage: { getItem: function (k) { return k in store ? store[k] : null; }, setItem: function (k, v) { store[k] = String(v); }, removeItem: function (k) { delete store[k]; } } };
  win.window = win;
  win.addEventListener = function (t, fn) { human.push(fn); };
  win.removeEventListener = function () {};
  var doc = { head: { appendChild: function (el) { loaded.push(el.src); } },
              createElement: function () { return { async: false, src: '' }; },
              getElementsByTagName: function () { return [{ parentNode: { insertBefore: function (el) { loaded.push(el.src); } } }]; },
              addEventListener: function () {} };
  function runFile(src) { new Function('window', 'document', 'navigator', 'location', 'localStorage', src)(win, doc, nav, win.location, win.localStorage); }
  if (!opts.noAnalytics) runFile(GA);
  runFile(PX);
  var before = loaded.slice(), fbqBefore = !!win.fbq;
  if (!opts.noInput) human.slice().forEach(function (h) { h({ type: 'pointermove' }); });
  return { before: before, fbqBefore: fbqBefore, after: loaded, win: win };
}
var PERSON = { webdriver: false, userAgent: 'Mozilla/5.0 (iPhone) Safari/605.1' };
var ROBOT = { webdriver: true, userAgent: 'Mozilla/5.0 Chrome/127' };
function meta(list) { return list.filter(function (s) { return /connect\.facebook\.net/.test(s); }).length; }
var p = browse(PERSON);
ok('a page that has only loaded has sent Meta nothing', meta(p.before) === 0 && !p.fbqBefore, p.before.join(', '));
ok('a person moves the mouse: the pixel loads, once', meta(p.after) === 1, p.after.join(', '));
var q = (p.win.fbq && p.win.fbq.queue || []).map(function (a) { return Array.prototype.slice.call(a).join(':'); });
ok('and it counts one PageView on the VenuePlay dataset', q.indexOf('init:1587841132831183') >= 0 && q.indexOf('track:PageView') >= 0, q.join(' | '));
ok('and Analytics loads on the same move', p.after.filter(function (s) { return /googletagmanager/.test(s); }).length === 1, p.after.join(', '));
var scanner = browse(PERSON, { noInput: true });
ok('a mail scanner that opens the link and never moves: no pixel', meta(scanner.after) === 0 && !scanner.win.fbq, scanner.after.join(', '));
var robot = browse(ROBOT);
ok('an automated browser, even one that moves: no pixel', meta(robot.after) === 0, robot.after.join(', '));
var team = browse(PERSON, { search: '?noga=1' });
ok('our own team (?noga=1) is not a Meta visitor either', meta(team.after) === 0, team.after.join(', '));
var alone = browse(PERSON, { noAnalytics: true });
ok('with no gate loaded the pixel stays off rather than counting everybody', meta(alone.after) === 0, alone.after.join(', '));

print('\n== 3. every address we send people to exists, now that a miss is a real 404 ==');
var redirects = {};
read('venueplay/_redirects').split('\n').forEach(function (l) { l = l.trim(); if (l && l[0] !== '#') redirects[l.split(/\s+/)[0]] = l.split(/\s+/)[1]; });
function isFile(rel) { try { readFile('venueplay/' + rel, 'binary'); return true; } catch (e) { return false; } }
/* How Cloudflare Pages answers a path with no SPA fallback: a file, path.html, path/index.html,
   or a _redirects rule (whose target must itself resolve). */
function resolves(path, depth) {
  path = path.split('?')[0].split('#')[0];
  if (redirects[path]) return (depth || 0) < 3 && resolves(redirects[path], (depth || 0) + 1);
  var rel = path.replace(/^\//, '');
  if (rel === '') return isFile('index.html');
  if (/\/$/.test(rel)) return isFile(rel + 'index.html');
  // Most likely form first: jsc prints a line for every file it fails to open.
  if (/\.[a-z0-9]+$/i.test(rel)) return isFile(rel);
  return isFile(rel + '.html') || isFile(rel + '/index.html');
}
var ROUTES = ['/', '/tv', '/play', '/see-a-night', '/nsw', '/privacy', '/terms', '/unsubscribe', '/add-card',
  '/signage', '/training', '/jag-check', '/screen-check', '/leave-behind', '/leave-behind-club', '/leave-behind-pub',
  '/leave-behind-rsl', '/app', '/app/', '/app/billing', '/app/hq', '/app/onboard', '/app/settings', '/app/marketing',
  '/app/trivia/host', '/app/trivia/play', '/app/trivia/screen', '/app/trivia/builder', '/app/musical/host',
  '/app/musical/play', '/app/musical/screen', '/app/raffle/host', '/app/raffle/screen', '/app/members/host',
  '/app/members/screen', '/app/jag/host', '/app/jag/screen', '/app/topanswers/screen', '/offer', '/offer-oct',
  '/offer-nov', '/qld', '/vic', '/last-call', '/email/signature', '/llms.txt', '/robots.txt', '/sitemap.xml',
  '/data/musical-library.json', '/data/trivia-count.json', '/data/music-count.json'];
var dead = ROUTES.filter(function (r) { return !resolves(r); });
ok('every route the product and the emails use resolves to a file or a redirect (' + ROUTES.length + ')', !dead.length, dead.join(', '));
var redirectDead = Object.keys(redirects).filter(function (k) { return !resolves(redirects[k]); });
ok('every _redirects rule lands on something real', !redirectDead.length, redirectDead.join(', '));
ok('control: a made-up address does NOT resolve', !resolves('/this-does-not-exist') && !resolves('/pricing'));
var F404 = read('venueplay/404.html');
ok('404.html is at the root, so Pages answers a miss with 404 and not the homepage', F404.length > 500);
ok('and it is noindex', /<meta name="robots" content="noindex/.test(F404));
var links404 = (F404.match(/href="(\/[^"]*)"/g) || []).map(function (h) { return h.slice(6, -1); });
ok('and every link on it goes somewhere real, from any depth (absolute)', links404.length >= 4 && links404.every(function (h) { return resolves(h); }), links404.join(', '));

print('\n== 4. search engines are pointed at the address that answers ==');
['sitemap.xml', 'robots.txt', 'llms.txt', 'index.html', 'nsw.html', 'terms.html', 'privacy.html', 'see-a-night.html'].forEach(function (f) {
  ok(f + ' names no www address (www 301s to the bare domain)', read('venueplay/' + f).indexOf('https://www.venueplay.com.au') < 0);
});
var locs = (read('venueplay/sitemap.xml').match(/<loc>([^<]+)<\/loc>/g) || []).map(function (l) { return l.replace(/<\/?loc>/g, '').replace('https://venueplay.com.au', '') || '/'; });
ok('every sitemap address resolves', locs.length >= 5 && locs.every(function (l) { return resolves(l); }), locs.join(', '));
var llms = (read('venueplay/llms.txt').match(/https:\/\/venueplay\.com\.au(\/[^\s)]*)?/g) || []).map(function (u) { return u.replace('https://venueplay.com.au', '') || '/'; });
ok('every llms.txt link resolves (/pricing and /contact were homepage soft 404s)', llms.length >= 5 && llms.every(function (l) { return resolves(l); }), llms.join(', '));

print('\n== 5. internal pages stay out of search ==');
['jag-check.html', 'leave-behind.html', 'leave-behind-club.html', 'leave-behind-pub.html', 'leave-behind-rsl.html',
 'training.html', 'signage.html', 'screen-check.html', 'unsubscribe.html'].forEach(function (f) {
  ok(f + ' is noindex', /<meta name="robots" content="noindex/.test(read('venueplay/' + f)));
});
ok('the old Tester Hub is no longer served at all', !isFile('test.html'));

print('\n== 7. the leave-behinds fit a phone and still print as A4 ==');
['leave-behind.html', 'leave-behind-club.html', 'leave-behind-pub.html', 'leave-behind-rsl.html'].forEach(function (f) {
  var css = read('venueplay/' + f);
  var phone = block(css, '@media screen and (max-width:820px)');
  ok(f + ': a screen-only rule lets the sheet shrink to the phone', !!phone && /\.sheet\{width:auto/.test(phone) && /\.cols\{grid-template-columns:1fr\}/.test(phone));
  ok(f + ': and print still gets its own A4 rule', /@media print\{/.test(css) && /@page\{size:A4 portrait/.test(css));
});

print('\n== 10. opening an unsubscribe link changes nothing; pressing the button does ==');
var UNS = read('venueplay/unsubscribe.html');
var script = (UNS.match(/<script>([\s\S]*?)<\/script>/) || [])[1];
function unsub(search) {
  var els = {}, posts = [], submit = null;
  function el(id) {
    if (!els[id]) els[id] = { id: id, value: '', textContent: '', disabled: false, hidden: {},
      classList: { _h: true, toggle: function (c, on) { this._h = !on; } },
      addEventListener: function (t, fn) { if (t === 'submit') submit = fn; }, focus: function () {} };
    return els[id];
  }
  var doc = { getElementById: el };
  var fetchSpy = function (url, init) { posts.push({ url: url, body: JSON.parse(init.body) }); return Promise.resolve({ ok: true, status: 201 }); };
  new Function('document', 'location', 'fetch', script)(doc, { search: search }, fetchSpy);
  return { els: els, posts: posts, press: function () { submit({ preventDefault: function () {} }); } };
}
var u = unsub('?e=Sam%40ThePub.com.au');
ok('a link with the address writes NOTHING on load', u.posts.length === 0, JSON.stringify(u.posts));
ok('it fills the address in for them', u.els.em.value === 'Sam@ThePub.com.au', u.els.em.value);
ok('and tells them to press the button', /Press the button/.test(u.els.lead.textContent), u.els.lead.textContent);
u.press();
ok('pressing it writes the opt-out once, lower case, marked as from the link',
   u.posts.length === 1 && u.posts[0].body.email === 'sam@thepub.com.au' && u.posts[0].body.source === 'link' &&
   /vp_unsubscribes/.test(u.posts[0].url), JSON.stringify(u.posts));
var plain = unsub('');
ok('control: no address in the link, nothing written and nothing filled in', plain.posts.length === 0 && (plain.els.em || { value: '' }).value === '');

print('\n' + (ran - bad) + ' of ' + ran + ' checks passed');
if (bad) throw new Error(bad + ' platform checks failed');
