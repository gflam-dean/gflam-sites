/* The homepage "Trusted by" strip shows the live venues HQ chose, and nothing at all below six.

   Dean, 7 Aug 2026, hard rule: only ACTIVE venues (live and paying) on the marketing site.
   Recommended with it: a launch guard so the strip never reads as one lonely logo. Built 16 Oct
   2026 with migration 102. Changed 20 Oct 2026 with migration 111: HQ, not the venue, chooses
   ("I dont want a venue to be able to put it on our website we should choose"), so the old
   "paying" and "not a 1-player plan" rules are gone (The Mini Bar is Dean's own business on a
   1-player plan, and he wants it shown) and HQ's old hide_from_trusted flag is not read.

   Runs the REAL billing Worker's vpbTrustedLogosRoute on tools/rig-billing-worker.js against a
   world holding one venue for each way to be left off, and the REAL /app/vp-trusted.js (the one
   file index.html and nsw.html both load) against a small DOM:
     the Worker   only name and logo_url go out; a venue HQ did not choose, an inactive one,
                  test-alpha/bravo/charlie and any "test" name, no logo and foreign or borrowed
                  addresses are all left off; a chosen venue on a 1-player plan or a comp or
                  unpaid account IS shown; a missing column gives an empty list, never an error
     the page     five logos paint nothing and hide the section; six paint, twice over for the
                  loop, with the second copy hidden from screen readers; an address that is not
                  https is dropped; a name is text, never markup; the motion pauses on hover and
                  stops for reduced motion; both landing pages load it and call it

   Run from the repo root:  jsc tools/test-trusted-logos.js
*/
load('tools/rig-billing-worker.js');
var fails = 0, ran = 0, finished = false;
function check(name, ok, saw) { ran++; if (ok) print('  ok   ' + name); else { print('  FAIL ' + name + (saw === undefined ? '' : '   saw: ' + JSON.stringify(saw).slice(0, 400))); fails++; } }

var rigFetch = globalThis.fetch, REFUSE_COLUMN = '';
globalThis.fetch = function (url, opts) {
  var u = String(url);
  (globalThis.__asked = globalThis.__asked || []).push(u);
  if (REFUSE_COLUMN && u.indexOf('/rest/v1/vp_venues') !== -1 && u.indexOf(REFUSE_COLUMN) !== -1) {
    return Promise.resolve({ ok: false, status: 400, json: function () { return Promise.resolve({}); },
      text: function () { return Promise.resolve('{"code":"42703","message":"column vp_venues.' + REFUSE_COLUMN + ' does not exist"}'); } });
  }
  return rigFetch(url, opts);
};

function V(n) { return '60000000-0000-4000-8000-' + ('000000000000' + n).slice(-12); }
var OUR = ENV.SUPABASE_URL + '/storage/v1/object/public/';
var GOOD = ['Alpha Tavern', 'Bowls Club', 'Coral Hotel', 'Dock Inn', 'Esplanade Bar', 'Ferry RSL'];
var n = 0;
function venue(name, over, acct, logo) {
  n++;
  var id = V(n), fid = 'f' + n;
  var v = { id: id, name: name, slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), status: 'active', founding_id: fid, max_players: 60,
            hide_from_trusted: false, show_logo_on_site: true };
  for (var k in (over || {})) v[k] = over[k];
  var a = { id: fid, status: 'active', stripe_subscription_id: 'sub_' + n, bill_by_invoice: false };
  for (var k2 in (acct || {})) a[k2] = acct[k2];
  DB.vp_venues.push(v); DB.venueplay_founding.push(a);
  DB.vp_venue_screen.push({ venue_id: id, logo_url: logo === undefined ? OUR + 'venue-logos/' + id + '/' + ('0'.repeat(63) + n) + '.png' : logo });
  return v;
}
function world() {
  DB = {}; FAIL = {}; REFUSE_COLUMN = ''; n = 0; globalThis.__asked = [];
  DB.vp_venues = []; DB.venueplay_founding = []; DB.vp_venue_screen = [];
  GOOD.forEach(function (g, i) { venue(g, i === 5 ? { max_players: 1 } : (i === 4 ? { hide_from_trusted: true } : {}),
                                       i === 3 ? { status: 'comp', stripe_subscription_id: null } : (i === 2 ? { stripe_subscription_id: null } : {})); });
  // One of each way to be left off. Every one of them is otherwise a perfectly good row.
  venue('Test Alpha', { slug: 'test-alpha' });
  venue('Test Bravo', { slug: 'test-bravo' });
  venue('Charlie Testing Rooms', { slug: 'test-charlie' });
  venue('Test Lounge', { slug: 'lounge-two' });
  venue('Gone Hotel', { status: 'archived' });
  venue('Suspended Arms', { status: 'suspended' });
  venue('Not Chosen Hotel', { show_logo_on_site: false });
  venue('Foreign Logo Hotel', {}, {}, 'https://evil.example/logo.png');
  venue('Borrowed Logo Hotel', {}, {}, OUR + 'venue-logos/' + V(1) + '/' + '1'.repeat(64) + '.png');   // venue 1's folder
  venue('No Logo Hotel', {}, {}, null);
  venue('Old Ad Bucket Logo', {}, {}, null);
  DB.vp_venue_screen[DB.vp_venue_screen.length - 1].logo_url = OUR + 'venue-ads/' + V(n) + '/1700000000000-abc123.png';
}

(async function () {
  print('the Worker: who is on the strip');
  world();
  var r = await vpbTrustedLogosRoute(ENV, J);
  var logos = (r.body && r.body.logos) || [];
  var names = logos.map(function (l) { return l.name; });
  check('200 with a list', r.status === 200 && Array.isArray(r.body.logos), r);
  var want = GOOD.concat(['Old Ad Bucket Logo']).sort();
  check('exactly the six good venues and the one whose logo predates the logo bucket, in name order', JSON.stringify(names) === JSON.stringify(want), names);
  check('each entry is a name and a logo address and NOTHING else (no id, slug, plan or contact)', logos.every(function (l) { return JSON.stringify(Object.keys(l).sort()) === '["logo_url","name"]'; }), logos[0]);
  check('HQ chose a venue on a 1-player plan (The Mini Bar\'s case): it is shown', names.indexOf('Ferry RSL') !== -1, names);
  check('HQ chose a venue whose account never paid: it is shown (HQ decides now, not the meter)', names.indexOf('Coral Hotel') !== -1, names);
  check('HQ chose a comp account: it is shown', names.indexOf('Dock Inn') !== -1, names);
  check('HQ\'s old hide_from_trusted flag no longer overrules HQ\'s new switch', names.indexOf('Esplanade Bar') !== -1, names);
  [['Test Alpha', 'test-alpha'], ['Test Bravo', 'test-bravo'], ['Charlie Testing Rooms', 'test-charlie (by its slug, whatever its name)'],
   ['Test Lounge', 'a venue named "Test ..." (by its name, whatever its slug)'],
   ['Gone Hotel', 'an archived venue'], ['Suspended Arms', 'a suspended venue'],
   ['Not Chosen Hotel', 'a venue HQ has not switched on'],
   ['Foreign Logo Hotel', 'a logo address outside our storage'], ['Borrowed Logo Hotel', 'a logo in ANOTHER venue\'s folder'],
   ['No Logo Hotel', 'a venue with no logo (Tugun Bowls Club today)']].forEach(function (p) {
    check('left off: ' + p[1], names.indexOf(p[0]) === -1, names);
  });
  var asked = (globalThis.__asked || []).filter(function (u) { return u.indexOf('/rest/v1/vp_venues') !== -1; });
  check('the venue read asks the database for show_logo_on_site=true, so a missing switch can never mean yes',
        asked.length >= 1 && asked.every(function (u) { return u.indexOf('show_logo_on_site=eq.true') !== -1 && u.indexOf('status=eq.active') !== -1; }), asked);
  print('the Worker: when the database refuses the switch');
  world(); REFUSE_COLUMN = 'show_logo_on_site';
  r = await vpbTrustedLogosRoute(ENV, J);
  check('the database refuses the switch filter, and the answer is an empty list, not an error', r.status === 200 && Array.isArray(r.body.logos) && r.body.logos.length === 0, r);
  world(); FAIL['vp_venue_screen:GET'] = 1;
  r = await vpbTrustedLogosRoute(ENV, J);
  check('a failed read of the logos shows nobody, never a half list', r.status === 200 && r.body.logos.length === 0, r.body);
  var src = readFile('venueplay-backend/worker/venueplay-api-FULL.js');
  check('the dispatcher answers GET /trusted-logos with no login', src.indexOf("if (request.method === 'GET' && path === '/trusted-logos') return await vpbTrustedLogosRoute(env, json);") !== -1);

  print('the page: /app/vp-trusted.js');
  var made = [];
  function node(tag) {
    return { tagName: tag, className: '', style: {}, attrs: {}, children: [], src: '', alt: '', id: '', textContent: '',
      setAttribute: function (k, v) { this.attrs[k] = String(v); },
      appendChild: function (c) { this.children.push(c); return c; },
      removeChild: function (c) { this.children.splice(this.children.indexOf(c), 1); },
      get firstChild() { return this.children[0] || null; } };
  }
  var section = node('section'), track = node('div'), head = node('head');
  section.style.display = 'none';
  var window = { fetch: null };
  var document = { head: head, body: node('body'),
    getElementById: function (id) { return id === 'trusted' ? section : id === 'trustedTrack' ? track : (id === 'vpTrustedCss' ? (head.children.filter(function (c) { return c.id === id; })[0] || null) : null); },
    createElement: function (t) { var e = node(t); made.push(e); return e; } };
  var helper = readFile('venueplay/app/vp-trusted.js');
  (new Function('window', 'document', helper))(window, document);
  var T = window.VPTrusted;
  check('it loads and says six is the floor', !!T && T.MIN === 6, T && T.MIN);
  function rows(k) { var o = []; for (var i = 0; i < k; i++) o.push({ name: 'Venue ' + i, logo_url: 'https://db/storage/v1/object/public/venue-logos/x/' + i + '.png' }); return o; }
  var shown = T.render(rows(5), section, track);
  check('five logos: nothing painted, and the section stays hidden', shown === 0 && section.style.display === 'none' && track.children.length === 0, [shown, section.style.display, track.children.length]);
  shown = T.render(rows(6), section, track);
  check('six logos: the section shows', shown === 6 && section.style.display === '', [shown, section.style.display]);
  check('painted twice over for a seamless loop', track.children.length === 12 && track.children[0].src === track.children[6].src, track.children.length);
  check('the second copy is hidden from screen readers, so each venue is read out once',
        track.children.slice(6).every(function (c) { return c.attrs['aria-hidden'] === 'true' && c.alt === ''; }) && track.children[0].alt === 'Venue 0', track.children[6]);
  check('slow whatever the count: six seconds a logo', track.style.animationDuration === '36s', track.style.animationDuration);
  var css = (head.children.filter(function (c) { return c.id === 'vpTrustedCss'; })[0] || {}).textContent || '';
  check('it pauses under the mouse', /#trusted \.marquee:hover \.track\{animation-play-state:paused\}/.test(css), css.slice(0, 200));
  check('and stands still for anyone who asked for reduced motion', /@media\(prefers-reduced-motion:reduce\)\{#trusted \.track\{animation:none/.test(css));
  shown = T.render(rows(5), section, track);
  check('dropping back to five hides it again', shown === 0 && section.style.display === 'none', section.style.display);
  var bad = rows(5).concat([{ name: 'X', logo_url: 'javascript:alert(1)' }, { name: 'Y', logo_url: 'http://plain.example/y.png' }, { name: 'Z', logo_url: 'https://a.example/z.png" onerror="alert(1)' }]);
  shown = T.render(bad, section, track);
  check('an address that is not plain https does not count toward six and is never painted', shown === 0 && section.style.display === 'none', shown);
  var sly = rows(6); sly[0].name = '<img src=x onerror=alert(1)>';
  T.render(sly, section, track);
  check('a venue name is set as text on the image, never parsed as markup', track.children[0].alt === '<img src=x onerror=alert(1)>' && track.children.every(function (c) { return c.tagName === 'img'; }), track.children[0].alt);
  check('nothing from the list is written as HTML anywhere', helper.indexOf('innerHTML') === -1);
  var asked = '';
  window.fetch = function (u) { asked = u; return Promise.resolve({ ok: true, json: function () { return Promise.resolve({ logos: rows(7) }); } }); };
  shown = await T.load('https://venueplay-api.example/');
  check('load() asks the Worker\'s /trusted-logos and paints what comes back', asked === 'https://venueplay-api.example/trusted-logos' && shown === 7, [asked, shown]);
  window.fetch = function () { return Promise.reject(new Error('offline')); };
  shown = await T.load('https://venueplay-api.example');
  check('a failed fetch hides the section rather than leaving the last list up', shown === 0 && section.style.display === 'none', shown);

  print('both landing pages use it');
  ['venueplay/index.html', 'venueplay/nsw.html'].forEach(function (p) {
    var h = readFile(p);
    check(p + ' has the hidden section and its track', /<section class="sec" id="trusted" style="display:none">/.test(h) && h.indexOf('id="trustedTrack"') !== -1);
    check(p + ' loads /app/vp-trusted.js', h.indexOf('<script src="/app/vp-trusted.js"></script>') !== -1);
    check(p + ' asks the Worker through it', h.indexOf('if (workerReady && window.VPTrusted) VPTrusted.load(VP_WORKER);') !== -1);
    check(p + ' no longer reads the view straight from the browser', h.indexOf('v_vp_trusted') === -1);
  });
  finished = true;
})().catch(function (e) { fails++; print('  FAIL threw: ' + (e && e.stack || e)); });
drainMicrotasks();
if (!finished) { fails++; print('  FAIL the suite did not finish'); }
print('');
print(fails ? (fails + ' FAILED, ' + ran + ' run') : ('ALL ' + ran + ' CHECKS PASSED'));
if (fails) throw new Error(fails + ' failed');
