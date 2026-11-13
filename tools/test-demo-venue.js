/* THE HOME PAGE DEMO'S ADS LOOP PLAYS ONE VENUE'S LIVE SLIDES (Dean, 13 Nov 2026, INBOX 356).
   The demo (/tv?demo=1&ads=1, the home page's Advertising view) used to be typed slides in the old rounded type, a members
   draws board in the old branding, a typed raffle and four photos of Tugun's old artwork. Now it reads the chosen venue's
   own live slides, and falls back to a What's on list in the current TV style.

   This RUNS the real code: /app/vp-demo-venue.js (which venue, what plays, the ten minute memory) and /app/vp-whatson.js
   (the dated night that drops itself), and reads /demo-venue.json as shipped. The wall's own page is stood in for in
   tools/demo-ads-in-chrome.test.py (real Chrome, 1280x720 and 1920x1080).

   Run from the repo root:  jsc tools/test-demo-venue.js */
var fails = 0, ran = 0;
function check(name, ok, saw) { ran++; if (ok) print('  ok   ' + name); else { fails++; print('  FAIL ' + name + (saw === undefined ? '' : '   saw: ' + JSON.stringify(saw).slice(0, 300))); } }
var window = {};
(function () { eval(readFile('venueplay/app/vp-whatson.js')); }).call(window);
(function () { eval(readFile('venueplay/app/vp-demo-venue.js')); }).call(window);
var W = window.VPWhatsOn, D = window.VPDemoVenue;
check('both files load', !!W && !!D && typeof D.choose === 'function' && typeof D.config === 'function');

print('which venue: one setting, /demo-venue.json');
var SHIPPED = JSON.parse(readFile('venueplay/demo-venue.json'));
check('the shipped file names Tugun Bowls (tugun-bowls, the slug its own TV link uses)', SHIPPED.slug === 'tugun-bowls', SHIPPED);
check('the shipped file, read as the page reads it, is Tugun with its logo file', D.config(SHIPPED).slug === 'tugun-bowls' && D.config(SHIPPED).logo === '/logos/venue-tugun-bowls.png' && D.config(SHIPPED).name === 'Tugun Bowls Club', D.config(SHIPPED));
check('changing only the slug switches the venue (the Mini Bar)', D.config({ slug: 'the-mini-bar' }).slug === 'the-mini-bar');
check('a switched venue does not inherit Tugun\'s name or logo', D.config({ slug: 'the-mini-bar' }).name === '' && D.config({ slug: 'the-mini-bar' }).logo === '', D.config({ slug: 'the-mini-bar' }));
check('a switched venue\'s own name and same-site logo are kept as the offline values', D.config({ slug: 'the-mini-bar', name: 'The Mini Bar', logo: '/logos/mini.png' }).logo === '/logos/mini.png' && D.config({ slug: 'the-mini-bar', name: 'The Mini Bar' }).name === 'The Mini Bar');
check('a slug in capitals is read as the lowercase slug', D.config({ slug: ' The-Mini-Bar ' }).slug === 'the-mini-bar');
[['nothing', null], ['a string', 'x'], ['no slug', { name: 'x' }], ['a slug that is not one', { slug: '../x' }], ['a slug with a space', { slug: 'a b' }], ['a script', { slug: '<script>' }], ['an empty slug', { slug: '' }]].forEach(function (t) {
  check('a broken file (' + t[0] + ') is the default venue, never an error', D.config(t[1]).slug === 'tugun-bowls');
});
check('a logo that is not a path on this site is refused', D.config({ slug: 'the-mini-bar', logo: 'https://evil.example/x.png' }).logo === '' && D.config({ slug: 'the-mini-bar', logo: '//evil.example/x.png' }).logo === '');

print('what plays: the live slides, or the fallback');
var SL = [{ tag: 'Drag Bingo', head: 'Feb 27', image_url: 'https://db.example/storage/v1/object/public/venue-ads/v/a.png' }, { image_url: 'https://db.example/storage/v1/object/public/venue-ads/v/b.png' }];
var cfg = D.config(SHIPPED);
var RAW = { exists: true, name: 'Tugun Bowls Club', logo_url: 'https://db.example/logo.png', slides: SL, events: [], draws: [{ draw_day: 'Thursday', current_jackpot_cents: 140000 }], raffle: { label: 'Meat raffle', day: 'Friday' }, raffles: [{ label: 'x', day: 'Fri' }] };
var READ = D.fromScreen(RAW);
var live = D.choose(cfg, READ);
check('a full slides list is what plays, in the venue\'s order', live.source === 'live' && live.slides.length === 2 && live.slides[0].head === 'Feb 27', live);
check('the boiled-down read holds only slides, nights, name and logo: the account\'s draws and raffles are dropped at the door', Object.keys(READ).sort().join() === 'events,logo,name,slides' && JSON.stringify(READ).indexOf('1400') < 0 && JSON.stringify(READ).indexOf('Meat raffle') < 0, Object.keys(READ));
check('and no fallback nights are mixed in with them', live.events.length === 0);
check('the venue\'s own logo from the read wins over the file', live.logo === 'https://db.example/logo.png');
check('the old draws board and the raffle card are never read, whatever the account holds', !('draws' in live) && !('raffle' in live) && !('raffles' in live) && JSON.stringify(live).indexOf('1400') < 0 && JSON.stringify(live).indexOf('Meat raffle') < 0, Object.keys(live));
var onlyEv = D.choose(cfg, D.fromScreen({ exists: true, slides: [], events: [{ title: 'Quiz', day: 'wed' }] }));
check('an account with nights but no slides plays its nights, not the fallback', onlyEv.source === 'live' && onlyEv.events.length === 1 && onlyEv.events[0].title === 'Quiz');
var empty = D.choose(cfg, D.fromScreen({ exists: true, slides: [], events: [], draws: [], raffle: null }));
check('an EMPTY slides list is the fallback (What\'s on at Tugun)', empty.source === 'fallback' && empty.slides.length === 0 && empty.events.length >= 6, empty.source);
check('a missing slides list is the fallback too', D.choose(cfg, D.fromScreen({ exists: true })).source === 'fallback');
['no answer (the read failed)', 'a venue that does not exist'].forEach(function (n, i) {
  var r = D.choose(cfg, D.fromScreen(i ? { exists: false, slides: SL } : null));
  check('when the read gives ' + n + ' the fallback plays and the venue\'s name and logo file stay', r.source === 'fallback' && r.events.length >= 6 && r.name === 'Tugun Bowls Club' && r.logo === '/logos/venue-tugun-bowls.png', r);
});
check('a junk answer is no answer', D.fromScreen('x') === null && D.fromScreen(undefined) === null && D.fromScreen([]).slides.length === 0);
check('a null in the slides list costs that slide only', D.fromScreen({ exists: true, slides: [null, SL[0], 5] }).slides.length === 1);
var mini = D.choose(D.config({ slug: 'the-mini-bar' }), null);
check('a failed read for a venue that is not Tugun never shows Tugun\'s nights (nothing plays, the holding card shows the venue)', mini.source === 'fallback' && mini.events.length === 0 && mini.slides.length === 0, mini);

print('the fallback: What\'s on at Tugun, as Dean settled it');
var FB = D.fallbackEvents('tugun-bowls'), FJ = JSON.stringify(FB);
function find(t, day) { return FB.filter(function (e) { return e.title === t && (!day || e.day === day); })[0]; }
check('Tuesday Roast Night $10', find('Roast Night', 'tue') && find('Roast Night').line === '$10');
check('Wednesday Trivia & Cocktails', !!find('Trivia & Cocktails', 'wed'));
check('Thursday 50% off menu, with a drink', find('50% off menu', 'thu') && /drink/i.test(find('50% off menu').line));
check('Friday Surf + Turf $24.90 (the Facebook price, the newest)', find('Surf + Turf', 'fri') && find('Surf + Turf').line === '$24.90' && FJ.indexOf('19.90') === FJ.lastIndexOf('19.90'));
check('Saturday Parmi + Pint $19.90', find('Parmi + Pint', 'sat') && find('Parmi + Pint').line === '$19.90');
check('barefoot bowls Saturday and Sunday at 2pm', find('Barefoot bowls', 'sat').start === '14:00' && find('Barefoot bowls', 'sun').start === '14:00');
check('Sunday DJ + food trucks', !!find('DJ + food trucks', 'sun'));
var greek = find('Greek Night');
check('Greek Night: Sat 28 Nov 2026, 6pm, $69.90, TryBooking', greek && greek.date === '2026-11-28' && greek.start === '18:00' && /69\.90/.test(greek.line) && /TryBooking/.test(greek.line), greek);
check('NO bistro opening hours anywhere', !/5pm|8pm|17:00|20:00|open|closed|dinner/i.test(FJ.replace('"Sunday session"', '')) , FJ);
check('no em dash, no "venueplay" in capitals', FJ.indexOf('—') < 0 && FJ.indexOf('–') < 0 && !/VenuePlay|Venueplay/.test(FJ));
check('no night carries a picture: the poster layout is for a portrait picture and a landscape photo left blurred bands, so the list tiles fill the frame (and nothing of Tugun\'s Facebook artwork)', FB.every(function (e) { return !e.image_url; }) && FJ.indexOf('greek-night') < 0 && FJ.indexOf('fbcdn') < 0 && FJ.indexOf('facebook') < 0);
check('every night survives the What\'s on cleaner (none is silently dropped)', W.clean(FB).length === FB.length, W.clean(FB).length);

print('a dated night drops itself (real vp-whatson.js)');
function titles(today) { var out = []; (W.tvSlides(FB, today, null) || []).forEach(function (s) { (s.rows || []).forEach(function (r) { out.push(r.ev.title); }); }); return out; }
check('the week before it: Greek Night is on the wall', titles('2026-11-22').indexOf('Greek Night') >= 0, titles('2026-11-22'));
check('on the night: still there', titles('2026-11-28').indexOf('Greek Night') >= 0);
check('the day after (29 Nov): gone', titles('2026-11-29').indexOf('Greek Night') < 0, titles('2026-11-29'));
check('and gone for good (Jan 2027)', titles('2027-01-12').indexOf('Greek Night') < 0);
check('the weekly nights carry on after it is gone', titles('2026-12-02').indexOf('Roast Night') >= 0 && titles('2026-12-02').indexOf('Parmi + Pint') >= 0);
var wk = titles('2026-11-22');
check('the week it is on, every night fits in the loop (twelve rows is the most)', ['Roast Night', 'Trivia & Cocktails', '50% off menu', 'Surf + Turf', 'Parmi + Pint', 'Barefoot bowls', 'DJ + food trucks', 'Greek Night'].every(function (t) { return wk.indexOf(t) >= 0; }) && wk.length <= 12, wk);

print('the ten minute memory');
function store() { var m = {}; return { getItem: function (k) { return k in m ? m[k] : null; }, setItem: function (k, v) { m[k] = v; } }; }
var S = store(), R = D.fromScreen({ exists: true, slides: SL, name: 'Tugun Bowls Club' });
D.cachePut(S, 'tugun-bowls', R, 1000000);
check('inside ten minutes the answer is remembered', JSON.stringify(D.cacheGet(S, 'tugun-bowls', 1000000 + 599000)) === JSON.stringify(R));
check('after ten minutes it asks again', D.cacheGet(S, 'tugun-bowls', 1000000 + D.TTL_MS + 1) === null);
check('another venue\'s answer is never used (switching venues asks again)', D.cacheGet(S, 'the-mini-bar', 1000000) === null);
check('a clock that went backwards does not keep an answer for ever', D.cacheGet(S, 'tugun-bowls', 1000000 - 3600000) === null);
check('storage that throws is no memory, not an error', D.cacheGet({ getItem: function () { throw new Error('no'); } }, 'x', 1) === null && (D.cachePut({ setItem: function () { throw new Error('full'); } }, 'x', R, 1), true));
check('junk in storage is no memory', D.cacheGet({ getItem: function () { return '{"at":"x"'; } }, 'x', 1) === null);

print('the page wires it');
var TV = readFile('venueplay/tv.html');
check('tv.html loads vp-demo-venue.js before the script that uses it', TV.indexOf('<script src="/app/vp-demo-venue.js"></script>') > 0 && TV.indexOf('<script src="/app/vp-demo-venue.js"></script>') < TV.indexOf('(function loadVenueScreen(){'));
check('the ads-only demo calls the live read', /if\(DEMO_ADS_ONLY\) demoVenueRead\(/.test(TV));
check('the read asks /demo-venue.json which venue, then /screen for that slug', /fetch\("\/demo-venue\.json"/.test(TV) && /"\/screen\?venue="\+encodeURIComponent\(cfg\.slug\)/.test(TV));
check('the read plays through VPDemoVenue.choose, with the draws and raffle cleared', /VPDemoVenue\.choose\(cfg, read\)/.test(TV) && /ADS\.draws=\[\]; ADS\.raffle=null; ADS\.raffles=null/.test(TV));
check('no hard-coded slides list is left in the demo branch', !/head:"Roast night, \$14\.90"/.test(TV) && !/tugun-tuesday\.jpg|tugun-thursday\.jpg|tugun-friday\.jpg|tugun-saturday\.jpg/.test(TV));

print(fails ? '\n' + fails + ' FAILED of ' + ran : '\nALL ' + ran + ' CHECKS PASSED');
if (fails) throw new Error(fails + ' failed');
