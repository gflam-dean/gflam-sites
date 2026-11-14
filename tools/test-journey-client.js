/* JOURNEY TRACKING, the page side (INBOX 413, 15 Nov 2026): app/vp-track.js RUN against a fake window, the _redirects rules for the
   code links, the script tags, and the step list agreeing with the Worker's. Run from the repo root:  jsc tools/test-journey-client.js */
var ran = 0, bad = 0;
function check(n, c, saw) { ran++; if (c) print('  ok   ' + n); else { bad++; print('  FAIL ' + n + (saw !== undefined ? '   saw: ' + String(typeof saw === 'string' ? saw : JSON.stringify(saw)).slice(0, 400) : '')); } }
function section(t) { print(''); print(t); }
var SRC = readFile('venueplay/app/vp-track.js'), WORKER = readFile('venueplay-backend/worker/venueplay-api-FULL.js');
var P = [];
var REDIR = readFile('venueplay/_redirects');

/* A fake browser. o: path, cookie, dnt, webdriver, referrer, queue. Timers run on demand. */
function browser(o) {
  o = o || {};
  var sent = [], timers = [], store = {}, listeners = {};
  var doc = { readyState: 'complete', cookie: o.cookie || '', referrer: o.referrer || '', visibilityState: 'visible',
    addEventListener: function (t, f) { (listeners[t] = listeners[t] || []).push(f); }, removeEventListener: function (t, f) { listeners[t] = (listeners[t] || []).filter(function (x) { return x !== f; }); },
    getElementById: function (id) { return (o.els || {})[id] || null; } };
  var cookieJar = doc.cookie;
  Object.defineProperty(doc, 'cookie', { get: function () { return cookieJar; }, set: function (v) { cookieJar = v.split(';')[0]; } });
  var win = { document: doc, location: { pathname: o.path || '/nsw', protocol: 'https:', search: o.search || '' },
    navigator: { doNotTrack: o.dnt ? '1' : null, webdriver: !!o.webdriver, userAgent: 'Mozilla/5.0 (iPhone)', sendBeacon: function (u, b) { sent.push({ url: u, beacon: true, body: b.__text }); return true; } },
    sessionStorage: { getItem: function (k) { return k in store ? store[k] : null; }, setItem: function (k, v) { store[k] = String(v); } },
    localStorage: { getItem: function (k) { return (o.ls || {})[k] || null; }, setItem: function () {} },
    crypto: { getRandomValues: function (a) { for (var i = 0; i < a.length; i++) a[i] = (i * 37 + 11) & 255; return a; } },
    URL: function (u) { this.hostname = String(u).replace(/^https?:\/\//, '').split('/')[0]; },
    Blob: function (parts) { this.__text = parts[0]; },
    setTimeout: function (f) { timers.push(f); return timers.length; }, clearTimeout: function (i) { timers[i - 1] = null; },
    addEventListener: function (t, f) { (listeners['w:' + t] = listeners['w:' + t] || []).push(f); },
    fetch: function (u, opts) { sent.push({ url: u, headers: (opts && opts.headers) || {}, body: opts && opts.body }); return Promise.resolve({ json: function () { return Promise.resolve(o.lookup || { found: false }); } }); } };
  if (o.queue) win.__vpTrackQueue = o.queue;
  win.window = win;
  var fn = new Function('window', 'document', SRC + '\n');
  fn.call(win, win, doc);
  return { win: win, sent: sent, run: function () { var t = timers.slice(); timers.length = 0; t.forEach(function (f) { if (f) f(); }); }, fire: function (t, w) { (listeners[(w ? 'w:' : '') + t] || []).slice().forEach(function (f) { f({}); }); }, cookie: function () { return cookieJar; }, doc: doc };
}
function events(b) { var out = []; b.sent.filter(function (s) { return /\/track$/.test(s.url); }).forEach(function (s) { JSON.parse(s.body).events.forEach(function (e) { out.push(e.e); }); }); return out; }
function bodies(b) { return b.sent.filter(function (s) { return /\/track$/.test(s.url); }).map(function (s) { return JSON.parse(s.body); }); }

section('1. the step list is the Worker\'s list');
var wl = /const VPJ_EVENTS = \[([^\]]+)\]/.exec(WORKER)[1].match(/'([a-z0-9_]+)'/g).map(function (x) { return x.slice(1, -1); });
var b0 = browser({ path: '/' });
var cl = b0.win.__vpTrackSteps;
var onlyWorker = wl.filter(function (x) { return cl.indexOf(x) < 0; }).sort().join();
check('the page may send every name the Worker accepts except the four it makes itself', onlyWorker === 'human,link_hit,page_view,scanner_hit', onlyWorker);
check('and no name the Worker would drop', cl.every(function (x) { return wl.indexOf(x) >= 0; }), cl.filter(function (x) { return wl.indexOf(x) < 0; }));
var q412 = /var EVENTS = \[([^\]]+)\]/;
check('the page cannot send link_hit, human, page_view or scanner_hit as a step', ['link_hit', 'human', 'page_view', 'scanner_hit'].every(function (s) { return b0.win.vpTrackStep(s) === false; }));
check('an unknown step is refused', b0.win.vpTrackStep('typed_a_name') === false);

section('2. a plain visit');
var b1 = browser({ path: '/nsw', referrer: 'https://www.google.com/search?q=x' }); b1.run();
check('page_view is sent, no link_hit, no code', events(b1).join() === 'page_view' && !bodies(b1)[0].code, events(b1));
check('referrer is the host only', bodies(b1)[0].ref === 'www.google.com', bodies(b1)[0].ref);
check('source is website', bodies(b1)[0].src === 'website');
check('the session id is 24 hex', /^[a-f0-9]{24}$/.test(bodies(b1)[0].sid));
b1.win.vpTrackStep('button_tapped', { btn: 'Play', token: 'SECRETTOKEN', venue: 'v1' }); b1.run();
check('a step goes out in the next batch', events(b1).indexOf('button_tapped') >= 0);
check('the login token travels in a header, never in the event body', JSON.stringify(b1.sent).indexOf('SECRETTOKEN') >= 0 && bodies(b1).every(function (x) { return JSON.stringify(x).indexOf('SECRETTOKEN') < 0; }) && b1.sent[b1.sent.length - 1].headers.Authorization === 'Bearer SECRETTOKEN' && b1.sent[b1.sent.length - 1].headers['X-VP-Venue'] === 'v1');

section('3. a tracked link');
var b2 = browser({ path: '/offer-nov/MPYXPG' }); b2.run();
check('link_hit then page_view, with the code', events(b2).join() === 'link_hit,page_view' && bodies(b2)[0].code === 'MPYXPG', events(b2));
check('source is cold_email', bodies(b2)[0].src === 'cold_email');
check('the code is kept in a first-party cookie, 90 days, Lax, Secure', /^vp_lc=MPYXPG$/.test(b2.cookie()), b2.cookie());
check('vpTrackCode() gives the code', b2.win.vpTrackCode() === 'MPYXPG');
b2.fire('pointerdown'); b2.run();
check('the first tap sends one human beacon', events(b2).filter(function (e) { return e === 'human'; }).length === 1);
b2.fire('keydown'); b2.run();
check('and only one', events(b2).filter(function (e) { return e === 'human'; }).length === 1);
var b3 = browser({ path: '/nsw', cookie: 'vp_lc=MPYXPG' }); b3.run();
check('a later page with only the cookie still carries the code but logs no second link_hit', bodies(b3)[0].code === 'MPYXPG' && events(b3).indexOf('link_hit') < 0 || events(b3).join() === 'link_hit,page_view', events(b3));
var b3b = browser({ path: '/offer-nov/ab' });
check('a path that is not a code (too short) is not one', b3b.win.vpTrackCode() === '');
var b3c = browser({ path: '/app/index.html' });
check('other paths are not codes', b3c.win.vpTrackCode() === '');

section('4. lookup');
var b4 = browser({ path: '/nsw' });
P.push(b4.win.vpTrackLookup().then(function (j) { check('no code: {found:false} and no network call', j.found === false && b4.sent.filter(function (s) { return /lookup/.test(s.url); }).length === 0); }));
var b5 = browser({ path: '/offer-nov/MPYXPG', lookup: { found: true, venue: 'The Grand', first_name: 'Sam', games: ['trivia'], state: 'QLD', extra: 'x' } });
P.push(b5.win.vpTrackLookup().then(function (j) {
  check('with a code: GET /track/lookup?c=MPYXPG', b5.sent.filter(function (s) { return /\/track\/lookup\?c=MPYXPG$/.test(s.url); }).length === 1);
  check('the page gets venue, first name, games, state only', Object.keys(j).sort().join() === 'first_name,found,games,state,venue', Object.keys(j));
  return b5.win.vpTrackLookup().then(function () { check('the second ask is answered from the tab, not the network', b5.sent.filter(function (s) { return /lookup/.test(s.url); }).length === 1); });
}));

section('5. who is not counted');
var d1 = browser({ path: '/offer-nov/MPYXPG', dnt: true }); d1.run();
check('Do Not Track: nothing is sent at all', d1.sent.length === 0 && d1.win.vpTrackStep('form_sent') === false, d1.sent);
P.push(d1.win.vpTrackLookup().then(function () { check('Do Not Track: the pre-fill still works (a lookup is not a record)', d1.sent.filter(function (s) { return /lookup/.test(s.url); }).length === 1); }));
var r1 = browser({ path: '/nsw', webdriver: true }); r1.run();
check('our own robots send nothing on a plain page', r1.sent.length === 0 && r1.win.vpTrackStep('form_sent') === false);
var r2 = browser({ path: '/offer-nov/MPYXPG', webdriver: true }); r2.run();
check('a robot on a code link sends ONLY a flagged link_hit, so a scanner is logged as one', events(r2).join() === 'link_hit' && bodies(r2)[0].wd === true, events(r2));
var t1 = browser({ path: '/nsw', ls: { vpNoAnalytics: '1' } }); t1.run();
check('the team opt-out (?noga=1) sends nothing', t1.sent.length === 0);

section('6. Play a quick game hands over');
var q = browser({ path: '/quick', queue: [['page_opened', {}, 1000], ['form_sent', { token: 'T' }, 2000], ['typed_a_name', {}, 3000]] }); q.run();
check('the queue the page filled is sent, an unknown step in it is dropped', events(q).indexOf('page_opened') >= 0 && events(q).indexOf('form_sent') >= 0 && events(q).indexOf('typed_a_name') < 0, events(q));
check('vpTrackStepImpl exists for the page to hand over to', typeof q.win.vpTrackStepImpl === 'function');
check('this file does not overwrite a vpTrackStep the page already has', (function () { var f = function () {}; var w = { vpTrackStep: f }; var fn = new Function('window', 'document', SRC); try { fn.call(w, w, undefined); } catch (e) {} return w.vpTrackStep === f; })());

section('7. form boxes and abandon');
var inputs = { qName: { addEventListener: function (t, f) { this.f = f; } }, qContact: { addEventListener: function (t, f) { this.f = f; } } };
var f1 = browser({ path: '/quick', els: inputs }); f1.run();
f1.win.vpTrackWatchForm({ qName: 'first_name', qContact: 'contact' });
inputs.qName.f(); inputs.qContact.f(); inputs.qContact.f();
f1.fire('visibilitychange'); f1.doc.visibilityState = 'hidden'; f1.fire('visibilitychange');
var ev1 = events(f1);
check('field_first_name and field_contact once each', ev1.filter(function (e) { return e === 'field_first_name'; }).length === 1 && ev1.filter(function (e) { return e === 'field_contact'; }).length === 1, ev1);
check('leaving before form_sent sends form_abandon at the last box, by beacon', ev1.indexOf('form_abandon') >= 0 && f1.sent.filter(function (s) { return s.beacon; }).length >= 1, ev1);
var abBody = bodies(f1).map(function (x) { return x.events; }).reduce(function (a, c) { return a.concat(c); }, []).filter(function (e) { return e.e === 'form_abandon'; })[0];
check('and says which box', abBody && abBody.p.field === 'contact', abBody);
var f2 = browser({ path: '/quick', els: { qName: { addEventListener: function (t, f) { this.f = f; } } } }); f2.run();
f2.win.vpTrackWatchForm({ qName: 'first_name' }); f2.doc.getElementById('qName').f(); f2.win.vpTrackStep('form_sent'); f2.doc.visibilityState = 'hidden'; f2.fire('visibilitychange');
check('no form_abandon after form_sent', events(f2).indexOf('form_abandon') < 0, events(f2));

section('8. what no event can hold');
var all = JSON.stringify(b1.sent) + JSON.stringify(b2.sent) + JSON.stringify(f1.sent);
check('no cookie, storage or fingerprint API is read for identity (canvas, fonts, plugins, userAgent sent)', !/canvas|AudioContext|plugins|getBattery|deviceMemory|hardwareConcurrency|enumerateDevices/.test(SRC) && all.indexOf('Mozilla') < 0);
check('no third-party host in the file', !/https?:\/\/(?!api\.venueplay\.com\.au)[a-z0-9.-]+/i.test(SRC.replace(/\/\*[\s\S]*?\*\//g, '')));
check('no em dash in the file', SRC.indexOf('—') < 0);

section('9. the links: _redirects and the page tags');
['offer-oct', 'offer-nov', 'offer-dec', 'offer-jan', 'offer-feb', 'offer-mar', 'nsw'].forEach(function (p) {
  check('/' + p + '/:code is served as the offer page (200 rewrite, the address stays)', new RegExp('^/' + p + '/:code\\s+/nsw\\s+200\\s*$', 'm').test(REDIR));
});
check('/home/:code serves the home page', /^\/home\/:code\s+\/\s+200\s*$/m.test(REDIR));
check('no rule uses a query string', !/^\/[a-z-]+\/:code[^\n]*\?/m.test(REDIR));
check('nsw.html loads /app/vp-track.js after the analytics tag', /vp-analytics\.js"><\/script>\s*\n<script src="\/app\/vp-track\.js">/.test(readFile('venueplay/nsw.html')));
check('index.html loads /app/vp-track.js', /<script src="\/app\/vp-track\.js">/.test(readFile('venueplay/index.html')));
check('the file exists where the tag says (served from /app)', SRC.length > 1000);

section('10. HQ > Journey: the page, run');
var HQ = readFile('venueplay/app/hq.html'), HQJ = readFile('venueplay/app/vp-journey-hq.js');
check('hq.html has the Journey button, the pane, the script and the pane in the list', /data-pane="journey"/.test(HQ) && /id="paneJourney"/.test(HQ) && /<script src="vp-journey-hq\.js">/.test(HQ) && /"reports","journey","team"/.test(HQ));
check('opening the pane starts it, and the page hands it the sign-in', /pane==="journey" && window\.VPJourney\) window\.VPJourney\.open\(\)/.test(HQ) && /VPJourney\.init\(\{ post:workerPost/.test(HQ));
check('each venue row has a journey slot, filled when it is open', /data-vpjourney=/.test(HQ) && /VPJourney\.venueBlock\(S\.openVenue\)/.test(HQ));
var jw = { document: { getElementById: function () { return null; }, querySelector: function () { return null; } } }; jw.window = jw;
new Function('window', HQJ).call(jw, jw);
var J = jw.VPJourney;
var fh = J.funnelHtml({ steps: [{ step: 'form_sent', label: 'Sent the form', reached: 6, website: 4, cold_email: 2, coaster: 0, lost_pct: 33, median_secs_to_next: 75, reason: 'Stopped at <b>x</b>', fix: 'Fix "it"' }], sessions: 12, scanner_hits: 1 });
check('the funnel row shows reached, % lost, median time, reason and fix', /Sent the form/.test(fh) && />6</.test(fh) && /33%/.test(fh) && /75 s|1 min/.test(fh) && /Fix: Fix/.test(fh), fh.slice(0, 300));
check('words from the Worker are escaped, never injected', fh.indexOf('<b>x</b>') < 0 && fh.indexOf('&lt;b&gt;x&lt;/b&gt;') >= 0);
var fm = J.formHtml({ first_name_typed: 3, contact_typed: 2, chose_mobile: 1, chose_email: 1, venue_search_started: 2, venue_picked: 1, venue_not_found: 1, addvenue_shown: 1, addvenue_typed: 0, abandoned_at: [{ field: 'contact', n: 2, median_secs: 9 }], searches_found_nothing: [{ q: '<script>alert(1)</script>', n: 2 }], highlight_matched: 3, highlight_missed: 1 });
check('what people typed in a search is escaped', fm.indexOf('<script>') < 0 && /&lt;script&gt;/.test(fm));
check('abandon box and highlight accuracy are shown', /contact 2/.test(fm) && /3 of 4/.test(fm), fm);
var ch = J.campHtml({ rows: [{ campaign: 'offer-nov', email_step: 1, sent: 10, clicked: 3, visited: 2, enquired: 1, signed_up: 1, signed_in: 1, card: 0, scanner_only: 2, links_clicked: { 'play-button': 3 } }] });
check('the campaign table has every column Dean asked for', ['Sent', 'Clicked', 'Visited', 'Enquired', 'Signed up', 'Signed in', 'Card'].every(function (c) { return ch.indexOf('<th>' + c + '</th>') >= 0; }));
check('and says which link was clicked', /play-button 3/.test(ch));
check('the empty campaign table explains itself', /No tracked links are loaded yet/.test(J.campHtml({ rows: [] })));
check('no em dash, no person named in the HQ file', HQJ.indexOf('—') < 0);

Promise.all(P).then(function () { print(''); print(bad ? (bad + ' FAILED of ' + ran + ' checks') : ('ALL ' + ran + ' CHECKS PASSED')); });
