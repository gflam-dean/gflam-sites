/* THE ONBOARDING STOP LIST (Dean, 23 Nov 2026): does "Stop these reminders" really stop the onboarding reminders, and ONLY those?
 *
 * Drives the REAL billing Worker (venueplay-api-FULL.js, routing included) against a fake PostgREST that models
 * vp_onboarding_stops, vp_unsubscribes and the Auth user, a fake Resend and a fake SMS provider, and looks IN THE TABLES:
 *   - GET /stop/<token> shows one button and writes nothing (link scanners); POST records the venue's login email AND mobile
 *   - it writes vp_onboarding_stops ONLY: never vp_unsubscribes (cold / marketing), never Resend, never Instantly
 *   - a bad or cut-short token is refused and touches nothing
 *   - the quiet list leaves a stopped venue out (by venue id, by email, by mobile), hands every other venue its stop_url,
 *     and an unreadable list (or migration 228 not run) is a 503, not an empty list
 *   - the nudge and the nudge text refuse a stopped venue at send time; a cold-outreach row on vp_unsubscribes does NOT block them
 *   - every reminder text carries the opt-out LINK ({stop} filled; an old "Reply STOP to opt out" is rewritten); one without is refused
 *
 *   jsc venueplay-backend/worker/onboarding-stop.test.js
 */
var pass = 0, fail = 0, steps = [];
function ok(label, good, detail) {
  if (typeof good !== 'boolean') throw new Error('condition must be a boolean: ' + label);
  if (good) { pass++; print('  PASS  ' + label + (detail ? '  (' + detail + ')' : '')); }
  else { fail++; print('  FAIL  ' + label + (detail ? '  (' + detail + ')' : '')); }
}
function findFile(rel) {
  var tries = [rel, '../' + rel, '../../' + rel];
  for (var i = 0; i < tries.length; i++) {
    try { var t = readFile(tries[i]); if (t && t.length > 500) return tries[i]; } catch (e) {}
  }
  throw new Error('cannot find ' + rel);
}
var SRC_PATH = findFile('venueplay-backend/worker/venueplay-api-FULL.js');
var src = readFile(SRC_PATH);
if (src.indexOf("worker: 'venueplay-api'") < 0 || src.indexOf('vpaHandleOnboardingStop') < 0) throw new Error('that is not the billing Worker with the onboarding stop list: ' + SRC_PATH);
load(findFile('partyplay-backend/worker/_test-sha256.js'));

globalThis.TextEncoder = function () { this.encode = function (s) { return { _s: String(s) }; }; };
globalThis.crypto = { subtle: {
  importKey: function (fmt, k) { return Promise.resolve({ _k: k._s }); },
  sign: function (alg, key, msg) { return Promise.resolve(new Uint8Array(SHA.hmac(key._k, msg._s)).buffer); },
  digest: function () { return Promise.resolve(new Uint8Array(32).buffer); },
} };
globalThis.Response = function (body, init) { this.body = body; this.status = (init && init.status) || 200; this.headers = (init && init.headers) || {}; };
globalThis.URL = function (u) {
  var m = String(u).match(/^https?:\/\/[^\/]+(\/[^?]*)(\?(.*))?$/);
  this.pathname = m ? m[1] : '/';
  var qs = m && m[3] ? m[3] : '';
  this.searchParams = { get: function (k) {
    var parts = qs.split('&');
    for (var i = 0; i < parts.length; i++) { var kv = parts[i].split('='); if (decodeURIComponent(kv[0]) === k) return decodeURIComponent(kv[1] || ''); }
    return null; } };
};

globalThis.setTimeout = function () { return 1; }; globalThis.clearTimeout = function () {};
globalThis.AbortController = function () { this.signal = {}; this.abort = function () {}; };
var VID = '11111111-2222-4333-8444-555555555555';
var VID2 = '99999999-2222-4333-8444-555555555555';
var STOPS = [], UNSUB = [], SENT = [], SMS = [], calls = [], AUDIT = [];
var HB = 'fresh';      // the sync heartbeat table: fresh | stale | missing | down | throw (the fetch itself errors)
var HB_WRITES = [], HB_ROW = null;
function nonAlert() { return SENT.filter(function (m) { return !/Reminders on hold/.test(m.subject || ''); }); }
function setHB(mode) { HB = mode; HB_ROW = mode === 'missing' ? null : { id: 1, last_sync_at: new Date(Date.now() - (mode === 'stale' ? 27 * 3600000 : 60000)).toISOString(), stale_alert_at: null }; }
var AUTH_PHONE = true;      // the login has a mobile (the text-code sign-in) or is email only
var STOPS_STATUS = 200;     // 404 = migration 228 not run, 500 = down
var PROSPECT = { venue_id: VID, auth_user_id: 'au-1', email: 'login@example.test', phone: '0412 345 678' };
function qs(url) { var out = {}, i = url.indexOf('?'); if (i < 0) return out; url.slice(i + 1).split('&').forEach(function (p) { var kv = p.split('='); out[decodeURIComponent(kv[0])] = decodeURIComponent(kv.slice(1).join('=')); }); return out; }
function respond(status, body) {
  var text = body == null ? '' : (typeof body === 'string' ? body : JSON.stringify(body));
  return Promise.resolve({ ok: status < 400, status: status, text: function () { return Promise.resolve(text); }, json: function () { return Promise.resolve(JSON.parse(text)); } });
}
globalThis.fetch = function (url, init) {
  url = String(url); init = init || {};
  var method = init.method || 'GET';
  calls.push({ url: url, method: method, body: init.body, headers: init.headers || {} });
  if (url.indexOf('https://api.resend.com/emails') === 0) { SENT.push(JSON.parse(init.body)); return respond(200, { id: 'm' + SENT.length }); }
  if (url.indexOf('https://api.mobilemessage.com.au') === 0) { SMS.push(JSON.parse(init.body).messages[0]); return respond(200, { results: [{ status: 'success', message_id: 's1' }] }); }
  var f = qs(url);
  if (/\/rest\/v1\/vp_onboarding_sync/.test(url)) {
    if (HB === 'throw') throw new Error('network down');
    if (HB === 'down') return respond(503, { message: 'x' });
    if (method === 'POST') {
      var hb = JSON.parse(init.body); HB_WRITES.push(hb);
      if (/ignore-duplicates/.test((init.headers || {}).Prefer || '')) { if (HB_ROW) return respond(201, []); HB_ROW = hb; return respond(201, [hb]); }
      HB_ROW = hb; return respond(201, null);
    }
    if (method === 'PATCH') {
      var patch = JSON.parse(init.body);
      if (HB_ROW && !HB_ROW.stale_alert_at) { HB_ROW.stale_alert_at = patch.stale_alert_at; return respond(200, [HB_ROW]); }
      return respond(200, []);
    }
    return respond(200, HB_ROW ? [HB_ROW] : []);
  }
  if (/\/rest\/v1\/vp_onboarding_stops/.test(url)) {
    if (STOPS_STATUS !== 200) return respond(STOPS_STATUS, { message: 'x' });
    if (method === 'GET') {
      var rows = STOPS.slice();
      if (f.or) {   // models the one filter this code uses: or=(venue_id.eq.X,email.eq."e",mobile.eq."m")
        var parts = f.or.replace(/^\(|\)$/g, '').split(',');
        rows = rows.filter(function (r) { return parts.some(function (c) {
          var k = c.slice(0, c.indexOf('.')), v = c.slice(c.indexOf('.eq.') + 4).replace(/"/g, '');
          return String(r[k] || '').toLowerCase() === v.toLowerCase(); }); });
      }
      var off = parseInt(f.offset || '0', 10), lim = parseInt(f.limit || '1000', 10);
      return respond(200, rows.slice(off, off + lim));
    }
    if (method === 'POST') {
      var row = JSON.parse(init.body);
      if (row.venue_id) for (var i = 0; i < STOPS.length; i++) if (STOPS[i].venue_id === row.venue_id) return respond(409, { code: '23505' });
      STOPS.push(row); return respond(201, null);
    }
  }
  if (/\/rest\/v1\/vp_unsubscribes/.test(url)) {
    if (method === 'GET') {
      var em = (f.email || '').replace(/^ilike\./, '').toLowerCase();
      if (f.email) {
        var hit = UNSUB.filter(function (r) { return r.email.toLowerCase() === em; });
        return respond(200, hit.map(function (r) { return { source: r.source, created_at: r.created_at || null, last_unsubscribed_at: r.last_unsubscribed_at || null }; }));
      }
      return respond(200, UNSUB.map(function (r) { return { email: r.email }; }));
    }
    if (method === 'POST') { UNSUB.push(JSON.parse(init.body)); return respond(201, null); }
  }
  if (/\/rest\/v1\/vp_prospects\?/.test(url) && method === 'GET') return respond(200, f.venue_id === 'eq.' + VID ? [PROSPECT] : []);
  if (/\/auth\/v1\/admin\/users\/au-1/.test(url)) return respond(200, { id: 'au-1', email: 'Login@Example.test', phone: AUTH_PHONE ? '61412345678' : '' });
  if (/\/rest\/v1\/vp_venues\?/.test(url) && method === 'GET') return respond(200, [{ id: VID, founding_id: 'f-1', name: 'The Test Tavern' }]);
  if (/\/rest\/v1\/venueplay_founding\?/.test(url) && method === 'GET') return respond(200, [{ mobile: '0412345678' }]);
  if (/\/rest\/v1\/vp_admin_audit/.test(url) && method === 'POST') { AUDIT.push(JSON.parse(init.body)); return respond(201, [{}]); }
  return respond(404, { message: 'not stubbed: ' + method + ' ' + url });
};

var worker;
eval(src.replace('export default {', 'worker = {').replace(/\};\s*$/, '};'));

var SECRET = 'vector-secret-23nov';
var MAC = '7994ba0a69149893';                  // Python: hmac('vp-onb-stop:'+secret, VID)[:16]
var TOKEN = VID.replace(/-/g, '') + MAC;
var API = 'https://api.venueplay.com.au';
var KEY = 'k'.repeat(40);
var ENV = { STRIPE_SECRET_KEY: 'x', STRIPE_WEBHOOK_SECRET: 'x', STRIPE_PRICE_MONTHLY: 'x', STRIPE_PRICE_ANNUAL: 'x',
            SUPABASE_URL: 'https://db.example.co', SUPABASE_SERVICE_KEY: 'k', RESEND_API_KEY: 're_x',
            MOBILEMESSAGE_USERNAME: 'u', MOBILEMESSAGE_PASSWORD: 'p', CARD_LINK_SECRET: 'c', VP_UNSUB_SECRET: SECRET,
            PROSPECT_AUTOPILOT_KEY: KEY, PROSPECT_SMS_ON: 'on' };
function env(over) { var e = {}; for (var k in ENV) e[k] = ENV[k]; for (var k2 in (over || {})) e[k2] = over[k2]; return e; }
function req(method, path, body, headers) {
  return { method: method, url: API + path, headers: { get: function (n) { return (headers || {})[n] || null; } }, text: function () { return Promise.resolve(body || ''); } };
}
function auto(method, path, body) { return worker.fetch(req(method, path, body == null ? '' : JSON.stringify(body), { 'X-Autopilot-Key': KEY }), env()); }
function parse(r) { try { return JSON.parse(r.body); } catch (e) { return {}; } }
function reset() { setHB('fresh'); HB_WRITES = []; STOPS = []; UNSUB = []; SENT = []; SMS = []; calls = []; AUDIT = []; STOPS_STATUS = 200; }
function step(fn) { steps.push(fn); }

// 0. The token and the link: unguessable, per venue, on the api host.
step(function () {
  return vpaOnbToken(env(), VID).then(function (t) {
    ok('the token is the venue id (32 hex) plus 16 hex of an HMAC, and matches the Python vector', t === TOKEN && /^[0-9a-f]{48}$/.test(t), t);
    return vpaOnbStopUrl(env(), VID);
  }).then(function (u) {
    ok('the link is on the api host, /stop/<token>', u === API + '/stop/' + TOKEN, u);
    ok('the link has no .dev address', u.indexOf('.dev') < 0);
    return vpaOnbToken(env(), VID2);
  }).then(function (t2) {
    ok('another venue gets a different token', t2 !== TOKEN && t2.slice(0, 32) !== TOKEN.slice(0, 32));
    return vpaOnbStopUrl(env({ VP_UNSUB_SECRET: '' }), VID);
  }).then(function (none) { ok('no secret, no link (never a link anyone could forge)', none === ''); });
});

// 1. GET: one button, and NOTHING written.
step(function () {
  reset();
  return worker.fetch(req('GET', '/stop/' + TOKEN), env()).then(function (r) {
    ok('GET answers 200 with a page', r.status === 200 && /<html/i.test(r.body), String(r.status));
    ok('the page has ONE "Stop these reminders" button that posts', /<button type="submit">Stop these reminders<\/button>/.test(r.body) && r.body.indexOf('method="POST"') >= 0);
    ok('the page is lowercase venueplay, with no em dash', />venueplay<\/div>/.test(r.body) && r.body.indexOf('VenuePlay') < 0 && r.body.indexOf('—') < 0);
    ok('the page says the account carries on', /account, and anything about billing, carries on/.test(r.body));
    ok('the footer is its OWN words (stops these reminders only; account and billing emails carry on), not the cold page\'s "marketing email" line', /This only stops these reminders\. Your account, and account and billing emails, carry on as normal\./.test(r.body) && !/marketing email/.test(r.body), r.body.slice(-300));
    ok('the page is not cached or indexed', r.headers['cache-control'] === 'no-store' && r.headers['x-robots-tag'] === 'noindex');
    ok('the GET wrote nothing and read nothing (link scanners)', calls.length === 0 && STOPS.length === 0, calls.length + ' calls');
  });
});

// 2. POST: the venue's login email AND mobile land on the new list, and only there.
step(function () {
  reset();
  return worker.fetch(req('POST', '/stop/' + TOKEN, 'via=page'), env()).then(function (r) {
    ok('POST answers 200', r.status === 200, r.status + ' ' + r.body);
    ok('ONE row is in vp_onboarding_stops', STOPS.length === 1, JSON.stringify(STOPS));
    var row = STOPS[0] || {};
    ok('it has the venue id', row.venue_id === VID, row.venue_id);
    ok('it has the login email, lower-cased', row.email === 'login@example.test', row.email);
    ok('it has the mobile in +61 form', row.mobile === '+61412345678', row.mobile);
    ok('the source says it came from the page link', row.source === 'link', row.source);
    var writes = calls.filter(function (c) { return c.method !== 'GET' && !/vp_admin_audit/.test(c.url); });
    ok('the ONLY write was to vp_onboarding_stops', writes.length === 1 && /vp_onboarding_stops/.test(writes[0].url), writes.map(function (c) { return c.url; }).join(' '));
    ok('NOTHING went to vp_unsubscribes (the cold / marketing list)', UNSUB.length === 0 && !calls.some(function (c) { return /vp_unsubscribes/.test(c.url); }));
    ok('no email, text or Instantly call was made', SENT.length === 0 && SMS.length === 0 && !calls.some(function (c) { return /instantly/i.test(c.url) || /resend|mobilemessage/.test(c.url); }));
    ok('the stop was audited', AUDIT.length === 1 && AUDIT[0].action === 'onboarding_stop');
  });
});

// 3. The page's script says the words Dean asked for; a repeat is harmless.
step(function () {
  return worker.fetch(req('GET', '/stop/' + TOKEN), env()).then(function (r) {
    ok('the confirmation says "we won\'t send you any more reminders. Your account still works."',
       /Done, we won&#39;t send you any more reminders\. Your account still works\./.test(r.body));
    return worker.fetch(req('POST', '/stop/' + TOKEN, 'List-Unsubscribe=One-Click'), env());
  }).then(function (r) {
    ok('a repeat (a mail app one-click) answers 200', r.status === 200, String(r.status));
    ok('still one row', STOPS.length === 1, String(STOPS.length));
  });
});

// 4. Bad tokens touch nothing.
step(function () {
  reset();
  var bad = TOKEN.slice(0, 47) + (TOKEN.slice(47) === '0' ? '1' : '0');
  return worker.fetch(req('GET', '/stop/' + bad), env()).then(function (r) {
    ok('GET with a wrong token: 403 and a polite page', r.status === 403 && /That link looks wrong/.test(r.body), String(r.status));
    return worker.fetch(req('POST', '/stop/' + bad), env());
  }).then(function (r) {
    ok('POST with a wrong token: 403', r.status === 403, String(r.status));
    return worker.fetch(req('POST', '/stop/' + TOKEN.slice(0, 40)), env());
  }).then(function (r) {
    ok('POST with a cut-short token: 403', r.status === 403, String(r.status));
    return worker.fetch(req('POST', '/stop/' + VID2.replace(/-/g, '') + MAC), env());
  }).then(function (r) {
    ok("one venue's mac cannot stop another venue", r.status === 403, String(r.status));
    ok('no bad link touched the database', calls.length === 0 && STOPS.length === 0, calls.length + ' calls');
    return worker.fetch(req('POST', '/stop/' + TOKEN), env({ VP_UNSUB_SECRET: '' }));
  }).then(function (r) { ok('no secret: refused, nothing written', r.status === 503 && STOPS.length === 0, String(r.status)); });
});

// 5. A failed write is never reported as done.
step(function () {
  reset(); STOPS_STATUS = 500;
  return worker.fetch(req('POST', '/stop/' + TOKEN, 'via=page'), env()).then(function (r) {
    ok('a failed write is a 502, not "done"', r.status === 502, String(r.status));
    return worker.fetch(req('GET', '/stop/' + 'z'), env());
  }).then(function (r) {
    ok('the by-hand words never tell a text recipient to reply: call or email hello@', /Call us on 07 5228 3667 or email hello@venueplay\.com\.au/.test(r.body) && !/Reply to the reminder/.test(r.body), r.body.slice(0, 300));
  });
});

// 6. The Mac records a reply STOP on the SAME list (key needed), by venue id or by email alone.
step(function () {
  reset();
  return worker.fetch(req('POST', '/autopilot/onboarding-stop', JSON.stringify({ venue_id: VID }), {}), env()).then(function (r) {
    ok('no key: refused', r.status === 401 && STOPS.length === 0, String(r.status));
    return auto('POST', '/autopilot/onboarding-stop', { venue_id: VID, email: 'Reply@Example.test', source: 'email-reply' });
  }).then(function (r) {
    ok('a reply STOP by venue id is recorded', r.status === 200 && STOPS.length === 1 && STOPS[0].venue_id === VID && STOPS[0].source === 'email-reply', r.status + JSON.stringify(STOPS));
    return auto('POST', '/autopilot/onboarding-stop', { email: 'who@example.test', source: 'sms-reply' });
  }).then(function (r) {
    ok('a reply STOP by email alone is recorded with no venue id', r.status === 200 && STOPS.length === 2 && !STOPS[1].venue_id && STOPS[1].email === 'who@example.test' && STOPS[1].source === 'sms-reply', JSON.stringify(STOPS[1]));
    ok('neither went to vp_unsubscribes', UNSUB.length === 0 && !calls.some(function (c) { return /vp_unsubscribes/.test(c.url); }));
    return auto('POST', '/autopilot/onboarding-stop', { venue_id: VID2, email: 'cold@example.test', source: 'mac-cold-stop', stop_at: '2026-11-21T01:00:00Z' });
  }).then(function (r) {
    ok('the Mac records a cold STOP it saw (mac-cold-stop) with its date, on OUR list only', r.status === 200 && STOPS.length === 3 && STOPS[2].source === 'mac-cold-stop' && STOPS[2].stop_at === '2026-11-21T01:00:00.000Z' && UNSUB.length === 0 && !calls.some(function (c) { return /vp_unsubscribes|instantly/i.test(c.url) && c.method !== 'GET'; }), JSON.stringify(STOPS[2]));
    return auto('POST', '/autopilot/onboarding-stop', { venue_id: VID2, source: 'mac-cold-stop' });
  }).then(function (r) {
    ok('...and a repeat is harmless (idempotent: still one row for that venue)', r.status === 200 && STOPS.filter(function (x) { return x.venue_id === VID2; }).length === 1, JSON.stringify(STOPS));
    return auto('GET', '/autopilot/onboarding-stops');
  }).then(function (r) {
    var b = parse(r);
    ok('the Mac can read the whole list', r.status === 200 && b.stops && b.stops.length === 3, r.body);
  });
});

// 7. The quiet list leaves out anyone on the list, hands the rest a stop_url, and fails closed.
function quietProspect(id, email, mobile) { return { venue_id: id, name: 'V ' + id.slice(0, 2), email: email, mobile: mobile, status: 'not_signed_in', sign_in_known: true, last_sign_in_at: null, no_contact: false }; }
step(function () {
  reset();
  var ps = [quietProspect(VID, 'a@example.test', null), quietProspect(VID2, 'b@example.test', '0411 222 333'), quietProspect('aaaaaaaa-2222-4333-8444-555555555555', 'c@example.test', null),
            quietProspect('bbbbbbbb-2222-4333-8444-555555555555', 'stopped-email@example.test', null), quietProspect('cccccccc-2222-4333-8444-555555555555', 'd@example.test', '0400 111 222')];
  vpaProspectsData = function () { return Promise.resolve({ prospects: ps }); };
  STOPS = [{ venue_id: VID, email: 'x@example.test', mobile: null }, { venue_id: null, email: 'Stopped-Email@example.test', mobile: null }, { venue_id: null, email: null, mobile: '+61400111222' }];
  return auto('GET', '/autopilot/prospects/quiet').then(function (r) {
    var b = parse(r), ids = (b.prospects || []).map(function (p) { return p.venue_id; });
    ok('quiet answers 200', r.status === 200, r.status + r.body.slice(0, 120));
    ok('the venue on the list (by venue id) is left out', ids.indexOf(VID) < 0, ids.join());
    ok('the venue whose email is on the list (any case) is left out', ids.indexOf('bbbbbbbb-2222-4333-8444-555555555555') < 0);
    ok('the venue whose MOBILE is on the list is left out', ids.indexOf('cccccccc-2222-4333-8444-555555555555') < 0);
    ok('everybody else is still on it', ids.indexOf(VID2) >= 0 && ids.indexOf('aaaaaaaa-2222-4333-8444-555555555555') >= 0 && ids.length === 2, ids.join());
    var p2 = (b.prospects || []).filter(function (p) { return p.venue_id === VID2; })[0] || {};
    var urls = (b.prospects || []).map(function (p) { return p.stop_url; });
    ok('every row has a stop_url and no two venues share one (a shared link would stop the wrong venue)', urls.length === 2 && urls.every(function (u) { return /\/stop\/[0-9a-f]{48}$/.test(u); }) && urls[0] !== urls[1], urls);
    ok('the stop_url of a venue is the one for ITS OWN venue id', (b.prospects || []).every(function (p) { return p.stop_url.indexOf('/stop/' + p.venue_id.replace(/-/g, '')) >= 0; }), urls);
    return vpaOnbStopUrl(env(), VID2).then(function (u) { ok('each row carries its own stop_url', p2.stop_url === u && /\/stop\/[0-9a-f]{48}$/.test(u), p2.stop_url); });
  }).then(function () {
    STOPS_STATUS = 404;     // migration 228 not run
    return auto('GET', '/autopilot/prospects/quiet');
  }).then(function (r) {
    ok('table missing (migration 228 not run): 503, NOT an empty list that sends to everyone', r.status === 503 && !parse(r).prospects, r.status + r.body.slice(0, 100));
    STOPS_STATUS = 500;
    return auto('GET', '/autopilot/prospects/quiet');
  }).then(function (r) { ok('list down: 503', r.status === 503 && !parse(r).prospects, String(r.status)); });
});

// 8. The nudge text (SMS): the opt-out LINK is required, filled, and a stopped venue is refused at send time.
function stubSendPath() {
  vpaProspectsData = function () { return Promise.resolve({ prospects: [{ venue_id: VID, name: 'The Test Tavern', email: 'login@example.test', mobile: '0412345678', created_at: '2026-11-01T00:00:00Z', link_from: null, status: 'not_signed_in', sign_in_known: true, last_sign_in_at: null }] }); };
  vpaProspectLinkWindow = function () { return Promise.resolve(null); };
  vpaProspectTappedLink = function () { return Promise.resolve(false); };
  vpaProspectOneLink = function () { return Promise.resolve({ token: 'ABCDEFGHJKMN', short: true, expiresAt: Date.now() + 40 * 86400000 }); };
  vpaMintSigninLinkFor = vpaProspectOneLink;
  vpaSelect = (function (orig) { return function (e, t, q) {
    if (t === 'vp_prospects') return Promise.resolve([{ auth_user_id: 'au-1', created_at: '2026-11-01T00:00:00Z', link_from: null }]);
    if (t === 'vp_signin_links') return Promise.resolve([]);
    if (t === 'vp_venue_staff') return Promise.resolve([{ venue_id: VID, role: 'owner' }]);
    return orig(e, t, q); }; })(typeof vpaSelect === 'function' ? vpaSelect : function () { return Promise.resolve([]); });
}
var SMS_BASE = 'venueplay: Hi Pat, your sign-in link for The Test Tavern expires in {days} days. Tap to sign in, no password needed: {link} Questions? 07 5228 3667. ';
step(function () {
  reset(); stubSendPath();
  return auto('POST', '/autopilot/prospect/nudge-sms', { venue_id: VID, text: SMS_BASE + 'Opt out: {stop}' }).then(function (r) {
    ok('a text with "Opt out: {stop}" goes', r.status === 200, r.status + ' ' + r.body);
    var m = (SMS[0] || {}).message || '';
    ok('the link in the sent text is the venue\'s own stop link, no https', m.indexOf('Opt out: api.venueplay.com.au/stop/' + TOKEN) >= 0, m);
    ok('the sent text no longer says "Reply STOP"', !/Reply STOP/i.test(m), m);
    ok('no {stop} placeholder is left in what was sent', m.indexOf('{stop}') < 0 && m.indexOf('{optout}') < 0);
    reset(); stubSendPath();
    return auto('POST', '/autopilot/prospect/nudge-sms', { venue_id: VID, text: SMS_BASE + 'Reply STOP to opt out' });
  }).then(function (r) {
    var m = (SMS[0] || {}).message || '';
    ok('an already-queued text that says "Reply STOP to opt out" is rewritten to the link, not lost', r.status === 200 && m.indexOf('Opt out: api.venueplay.com.au/stop/' + TOKEN) >= 0 && !/Reply STOP/i.test(m), r.status + ' ' + m);
    reset(); stubSendPath();
    return auto('POST', '/autopilot/prospect/nudge-sms', { venue_id: VID, text: SMS_BASE.trim() });
  }).then(function (r) {
    ok('a text with NO opt-out is refused (400) and nothing is sent', r.status === 400 && SMS.length === 0, r.status + ' ' + r.body.slice(0, 120));
    reset(); stubSendPath(); STOPS = [{ venue_id: VID, email: null, mobile: null }];
    return auto('POST', '/autopilot/prospect/nudge-sms', { venue_id: VID, text: SMS_BASE + 'Opt out: {stop}' });
  }).then(function (r) {
    ok('a venue on the stop list: refused at SEND time, nothing sent', r.status === 409 && SMS.length === 0, r.status + ' ' + r.body.slice(0, 120));
    reset(); stubSendPath(); STOPS = [{ venue_id: null, email: null, mobile: '+61412345678' }];
    return auto('POST', '/autopilot/prospect/nudge-sms', { venue_id: VID, text: SMS_BASE + 'Opt out: {stop}' });
  }).then(function (r) {
    ok('their MOBILE on the stop list: refused too', r.status === 409 && SMS.length === 0, String(r.status));
    reset(); stubSendPath(); STOPS_STATUS = 500;
    return auto('POST', '/autopilot/prospect/nudge-sms', { venue_id: VID, text: SMS_BASE + 'Opt out: {stop}' });
  }).then(function (r) {
    ok('the stop list cannot be read: nothing sent (503, stays queued)', r.status === 503 && SMS.length === 0, String(r.status));
    reset(); stubSendPath(); UNSUB = [{ email: 'login@example.test', source: 'instantly', created_at: '2026-10-01T00:00:00Z' }];
    return auto('POST', '/autopilot/prospect/nudge-sms', { venue_id: VID, text: SMS_BASE + 'Opt out: {stop}' });
  }).then(function (r) {
    ok('a COLD-email STOP dated BEFORE the venue asked for its account does not block the reminder text', r.status === 200 && SMS.length === 1, r.status + ' ' + r.body.slice(0, 100));
  });
});

// 9. The nudge EMAIL: stop link in the words, the footer and the mail app's own button; a stopped venue gets nothing.
step(function () {
  reset(); stubSendPath();
  var gate = function (over) { return vpaSendSigninLink(env(), 'au-1', VID, Object.assign({ hqCap: true, nudge: 'Hey Pat,\n\nHere is your link {link}.\n\nDon\'t want these reminders? {stop} or reply STOP.\n\nCheers', subject: 'Your venueplay sign-in link' }, over || {})).catch(function (e) { return { ok: false, reason: 'threw: ' + e }; }); };
  STOPS = [{ venue_id: VID, email: null, mobile: null }];
  return gate().then(function (r) {
    ok('a stopped venue: vpaSendSigninLink refuses (reason unsubscribed) and sends nothing', r.ok === false && r.reason === 'unsubscribed' && SENT.length === 0, JSON.stringify(r));
    reset(); stubSendPath(); STOPS = [{ venue_id: null, email: 'login@example.test', mobile: null }];
    return gate();
  }).then(function (r) {
    ok('their login email on the list: refused', r.ok === false && r.reason === 'unsubscribed' && SENT.length === 0, JSON.stringify(r));
    reset(); stubSendPath(); STOPS_STATUS = 404;
    return gate();
  }).then(function (r) {
    ok('migration 228 not run: refused (unsub_unread), nothing sent', r.ok === false && r.reason === 'unsub_unread' && SENT.length === 0, JSON.stringify(r));
    reset(); stubSendPath(); UNSUB = [{ email: 'login@example.test', source: 'instantly', created_at: '2026-10-01T00:00:00Z' }, { email: 'login@example.test', source: 'reply-stop', created_at: '2026-10-02T00:00:00Z' }];
    return gate();
  }).then(function (r) {
    ok('cold-email STOPs (instantly, reply-stop) dated BEFORE set-up do NOT block the onboarding nudge', r.reason !== 'unsubscribed' && r.reason !== 'unsub_unread', JSON.stringify(r).slice(0, 160));
    reset(); stubSendPath(); UNSUB = [{ email: 'login@example.test', source: 'instantly', created_at: '2026-12-01T00:00:00Z' }];
    return gate();
  }).then(function (r) {
    ok('a cold STOP dated AFTER set-up blocks it (reason unsubscribed), nothing sent', r.ok === false && r.reason === 'unsubscribed' && SENT.length === 0, JSON.stringify(r).slice(0, 160));
    reset(); stubSendPath(); UNSUB = [{ email: 'login@example.test', source: 'reply-stop' }];
    return gate();
  }).then(function (r) {
    ok('a cold STOP with NO date blocks it (cannot tell)', r.ok === false && r.reason === 'unsubscribed', JSON.stringify(r).slice(0, 160));
    reset(); stubSendPath(); UNSUB = [{ email: 'login@example.test', source: 'link', created_at: '2026-01-01T00:00:00Z' }];
    return gate();
  }).then(function (r) {
    ok('their own click on one of our unsubscribe links stops it, whatever its date', r.ok === false && r.reason === 'unsubscribed', JSON.stringify(r).slice(0, 160));
  });
});
step(function () {
  return vpaOnbHeaders(env(), VID).then(function (h) {
    ok('List-Unsubscribe for a reminder is the /stop/ link (the mail app button lands on the onboarding list)', h['List-Unsubscribe'].indexOf('<' + API + '/stop/' + TOKEN + '>') === 0 && h['List-Unsubscribe-Post'] === 'List-Unsubscribe=One-Click', JSON.stringify(h));
    ok('and it is NOT the cold-list /unsubscribe address', h['List-Unsubscribe'].indexOf('/unsubscribe?') < 0);
    ok('it is the link ONLY: no mailto to hello@ (a reply there reaches the help desk, not the stop list)', h['List-Unsubscribe'] === '<' + API + '/stop/' + TOKEN + '>' && h['List-Unsubscribe'].indexOf('mailto') < 0, h['List-Unsubscribe']);
    ok('{stop} in the words is filled with the full link for an email', vpaOnbFill('x {stop} y', API + '/stop/T', false) === 'x ' + API + '/stop/T y');
    ok('{stop} in a text is filled without https', vpaOnbFill('x {stop} y', API + '/stop/T', true) === 'x api.venueplay.com.au/stop/T y');
    var t = vpaReminderSmsText({ kind: 'last', firstName: 'Pat', venueName: 'The Test Tavern', endsWhen: 'on Friday', stopUrl: API + '/stop/T' });
    ok('the card reminder text carries the link, not "Reply STOP"', /Opt out: api\.venueplay\.com\.au\/stop\/T$/.test(t) && !/Reply STOP/.test(t), t);
  });
});

// 10. AN UNKNOWN SIGN-UP DATE BLOCKS (fail closed); a known one is compared. Called directly, since the routes always know it.
step(function () {
  reset();
  UNSUB = [{ email: 'old@example.test', source: 'instantly', created_at: '2026-10-01T00:00:00Z' }];
  return vpaOnbColdBlocks(env(), 'old@example.test', Date.parse('2026-11-01T00:00:00Z')).then(function (a) {
    ok('a cold STOP from October, a venue set up in November: ignored', a === false, String(a));
    return vpaOnbColdBlocks(env(), 'old@example.test', null);
  }).then(function (b) {
    ok('the SAME STOP with the sign-up date UNKNOWN: it BLOCKS (cannot tell, fail closed)', b === true, String(b));
    ok('no sign-up date on a row is unknown too: vpaOnbAskedAt({}) is null', vpaOnbAskedAt({}) === null && vpaOnbAskedAt({ created_at: 'not a date' }) === null);
    ok('a resend never moves the date: the FIRST set-up only', vpaOnbAskedAt({ created_at: '2026-11-01T00:00:00Z', link_from: '2026-11-20T00:00:00Z' }) === Date.parse('2026-11-01T00:00:00Z'));
  });
});

// 11. The migration is safe to re-run on a table that already exists (an earlier 228 without stop_at).
step(function () {
  var sql = readFile(findFile('venueplay-backend/supabase/venueplay-228-onboarding-stop-list.sql'));
  var stmts = sql.replace(/--[^\n]*/g, '').split(';').map(function (x) { return x.replace(/\s+/g, ' ').trim(); }).filter(Boolean);
  ok('every create is "if not exists" and every alter that adds a column is "add column if not exists"', stmts.every(function (x) { return !/^create (table|index|unique index)/i.test(x) || /if not exists/i.test(x); }) && stmts.every(function (x) { return !/add column/i.test(x) || /add column if not exists/i.test(x); }), stmts.join(' ;; ').slice(0, 300));
  ok('stop_at is added by an alter ... add column if not exists (so an older 228 gets it on a re-run)', stmts.some(function (x) { return /^alter table public\.vp_onboarding_stops add column if not exists stop_at timestamptz$/i.test(x); }));
  ok('re-running changes nothing else: policies and comments are not created twice', stmts.every(function (x) { return !/^create policy/i.test(x); }));
  return Promise.resolve();
});

// 12. The Mac lists EVERY prospect (signed in too) that is not already stopped.
step(function () {
  reset();
  vpaProspectsData = function () { return Promise.resolve({ prospects: [
    { venue_id: VID, name: 'Signed In', email: 'a@example.test', status: 'free_month', last_sign_in_at: '2026-11-02T00:00:00Z', created_at: '2026-11-01T00:00:00Z' },
    { venue_id: VID2, name: 'Never', email: 'b@example.test', status: 'not_signed_in', created_at: '2026-11-01T00:00:00Z', link_from: '2026-11-10T00:00:00Z' },
    { venue_id: 'cccccccc-2222-4333-8444-555555555555', name: 'Stopped', email: 'c@example.test', status: 'free_month', created_at: '2026-11-01T00:00:00Z' },
    { venue_id: 'dddddddd-2222-4333-8444-555555555555', name: 'No email', email: '', status: 'free_month' } ] }); };
  STOPS = [{ venue_id: 'cccccccc-2222-4333-8444-555555555555', email: null, mobile: null }];
  return auto('GET', '/autopilot/prospects/all').then(function (r) {
    var ids = (parse(r).prospects || []).map(function (p) { return p.venue_id; });
    ok('every prospect with an email that is not already stopped, signed in or not, with created_at and link_from', r.status === 200 && ids.length === 2 && ids.indexOf(VID) >= 0 && ids.indexOf(VID2) >= 0, r.body.slice(0, 200));
    return worker.fetch(req('GET', '/autopilot/prospects/all', '', {}), env());
  }).then(function (r) { ok('no key: refused', r.status === 401, String(r.status)); });
});

// 13. THE SYNC HEARTBEAT: the Mac posts it; the Worker's reminders hold (not drop) when it is stale, missing or unreadable; fresh sends.
step(function () {
  reset(); stubSendPath();
  var T = SMS_BASE + 'Opt out: {stop}';
  return auto('POST', '/autopilot/onboarding-sync-heartbeat', {}).then(function (r) {
    ok('the Mac\'s heartbeat is recorded (key needed, idempotent upsert on id 1)', r.status === 200 && HB_WRITES.length === 1 && HB_WRITES[0].id === 1 && /^20/.test(HB_WRITES[0].last_sync_at), JSON.stringify(HB_WRITES));
    return worker.fetch(req('POST', '/autopilot/onboarding-sync-heartbeat', '{}', {}), env());
  }).then(function (r) {
    ok('...and refused without the key', r.status === 401 && HB_WRITES.length === 1, String(r.status));
    return auto('POST', '/autopilot/prospect/nudge-sms', { venue_id: VID, text: T });
  }).then(function (r) {
    ok('FRESH heartbeat: the reminder text goes', r.status === 200 && SMS.length === 1, r.status + ' ' + r.body.slice(0, 100));
    reset(); stubSendPath(); setHB('stale');
    return auto('POST', '/autopilot/prospect/nudge-sms', { venue_id: VID, text: T });
  }).then(function (r) {
    ok('STALE heartbeat (27 hours): the text is HELD (503, held, sync_stale), nothing sent, nothing refused-and-dropped', r.status === 503 && parse(r).held === true && SMS.length === 0 && !AUDIT.some(function (a) { return /refused/.test(a.action); }), r.status + ' ' + r.body.slice(0, 120));
    reset(); stubSendPath(); setHB('missing');
    return auto('POST', '/autopilot/prospect/nudge-sms', { venue_id: VID, text: T });
  }).then(function (r) {
    ok('MISSING heartbeat (never synced): HELD', r.status === 503 && parse(r).held === true && SMS.length === 0, r.status);
    reset(); stubSendPath(); setHB('down');
    return auto('POST', '/autopilot/prospect/nudge-sms', { venue_id: VID, text: T });
  }).then(function (r) {
    ok('heartbeat table unreadable: HELD', r.status === 503 && SMS.length === 0, r.status);
    reset(); stubSendPath(); setHB('stale');
    return vpaSendSigninLink(env(), 'au-1', VID, { hqCap: true, nudge: 'Hi Sam,\n\nJust checking you got your account.\n\nCheers', subject: 'Your venueplay sign-in link' }).catch(function (e) { return { ok: false, reason: 'threw' }; });
  }).then(function (r) {
    ok('the nudge email path with a STALE heartbeat: nothing sent (held)', r.ok === false && nonAlert().length === 0 && r.stale === true, JSON.stringify(r));
    reset(); stubSendPath(); setHB('stale');
    return auto('POST', '/autopilot/prospect/nudge', { venue_id: VID, text: 'Hi Sam, just checking you got your venueplay account today.' });
  }).then(function (r) {
    reset(); stubSendPath(); setHB('throw');
    return auto('POST', '/autopilot/prospect/nudge-sms', { venue_id: VID, text: T });
  }).then(function (r) {
    ok('the heartbeat FETCH ERRORS (the request itself throws): the reminder text is still HELD, nothing sent', r.status === 503 && parse(r).held === true && SMS.length === 0, r.status + ' ' + r.body.slice(0, 120));
    reset(); stubSendPath(); setHB('stale');
    return auto('POST', '/autopilot/prospect/nudge-sms', { venue_id: VID, text: T });
  }).then(function (r) {
    var alerts = SENT.filter(function (m) { return /Reminders on hold/.test(m.subject || ''); });
    ok('STALE: Dean is told (the same staff alert path: venueplay \u00b7 FYI, to the cancel-alert addresses)', alerts.length === 2 && alerts.every(function (m) { return /^venueplay \u00b7 FYI: /.test(m.subject); }) && alerts[0].to.indexOf('dean@venueplay.com.au') >= 0 || alerts.some(function (m) { return m.to.indexOf('dean@venueplay.com.au') >= 0; }), SENT.map(function (m) { return m.subject; }));
    ok('...in plain words: the Mac has not synced since <time>, nothing is lost, they send once it syncs; no em dash', alerts.length > 0 && /the Mac has not synced since 20\d\d-\d\d-\d\d \d\d:\d\d Brisbane time\. Nothing is lost; they send once it syncs\./.test(alerts[0].html) && alerts[0].html.indexOf('\u2014') < 0, alerts[0] && alerts[0].html.slice(0, 300));
    ok('the marker is set (stale_alert_at)', !!(HB_ROW && HB_ROW.stale_alert_at), JSON.stringify(HB_ROW));
    SENT = [];
    return auto('POST', '/autopilot/prospect/nudge-sms', { venue_id: VID, text: T });
  }).then(function (r) {
    ok('a second reminder in the same outage does NOT tell him again (one alert per outage)', SENT.filter(function (m) { return /Reminders on hold/.test(m.subject || ''); }).length === 0, SENT.map(function (m) { return m.subject; }));
    return auto('POST', '/autopilot/onboarding-sync-heartbeat', {});
  }).then(function () {
    ok('the next fresh heartbeat clears the marker', HB_ROW && HB_ROW.stale_alert_at === null, JSON.stringify(HB_ROW));
    HB_ROW.last_sync_at = new Date(Date.now() - 30 * 3600000).toISOString(); SENT = [];
    return auto('POST', '/autopilot/prospect/nudge-sms', { venue_id: VID, text: T });
  }).then(function () {
    ok('a LATER outage tells him again, once', SENT.filter(function (m) { return /Reminders on hold/.test(m.subject || ''); }).length === 2, SENT.map(function (m) { return m.subject; }));
    reset(); stubSendPath(); setHB('missing');
    return auto('POST', '/autopilot/prospect/nudge-sms', { venue_id: VID, text: T });
  }).then(function () {
    ok('a Mac that has NEVER synced: held and Dean is told once too ("since ever")', SENT.filter(function (m) { return /Reminders on hold/.test(m.subject || ''); }).length === 2 && !!(HB_ROW && HB_ROW.stale_alert_at), SENT.map(function (m) { return m.subject; }));
    reset(); stubSendPath(); setHB('fresh');
    return auto('POST', '/autopilot/prospect/nudge-sms', { venue_id: VID, text: T });
  }).then(function () {
    ok('a FRESH heartbeat sends no alert', SENT.filter(function (m) { return /Reminders on hold/.test(m.subject || ''); }).length === 0);
    reset(); stubSendPath(); setHB('stale');
    return auto('POST', '/autopilot/prospect/nudge', { venue_id: VID, text: 'Hi Sam, just checking you got your venueplay account today.' });
  }).then(function (r) {
    ok('the nudge ROUTE with a stale heartbeat answers 503 held', r.status === 503 && parse(r).held === true && nonAlert().length === 0, r.status + ' ' + r.body.slice(0, 120));
  });
});


// 10. THE JOURNEY OF 23 NOV 2026 on the Worker: steps day3 / day27 / final (expiry retired), no Worker-added link-days sentence,
//     the quiet row's real account-state fields, and a past-its-life 'final' refused as a clean 409 ended.
step(function () {
  reset(); stubSendPath();
  var NUDGE = 'Hey Pat,\n\nJust a heads up, your venueplay trial for The Test Tavern expires in 3 days.\n\nDon\'t want these reminders? {stop} or reply STOP.\n\nCheers,\nthe venueplay team';
  var FINAL = 'Hey Pat,\n\nOne last note from us: your venueplay account for The Test Tavern is still set up and waiting.\n\nDon\'t want these reminders? {stop} or reply STOP.\n\nCheers,\nthe venueplay team';
  var allDays = function (m) { return /available for \d+ days?|link is available|expires in \d+ days?|\{days\}|\{expires\}|\b90\b/i.test((m.html || '') + ' ' + (m.text || '')); };
  return auto('POST', '/autopilot/prospect/nudge', { venue_id: VID, step: 'day27', subject: 'Your venueplay trial expires in 3 days', text: NUDGE }).then(function (r) {
    var m = nonAlert()[0] || {};
    ok('a day27 email goes (200)', r.status === 200 && nonAlert().length === 1, r.status + ' ' + r.body.slice(0, 160));
    ok('the Worker adds NO link-days sentence to it ("This link is available for N days, until ...", "expires in N days", 90): its only "expires" is the 3 days the Mac wrote',
       !/available for \d+ days?|link is available|\{days\}|\b90\b/i.test(m.html || '') && /expires in 3 days/.test(m.html || '') && !/expires in (?!3 days)\d+/.test(m.html || ''), (m.html || '').slice(-400));
    ok('ONE opt-out only: the words already carry the venue\'s own stop link, so the Worker adds no second "Stop these reminders" footer line', !/Stop these reminders/.test(m.html || '') && (m.html || '').indexOf('/stop/' + TOKEN) >= 0, (m.html || '').slice(-600));
    ok('...the button line is still there, and the link carries the day-27 tag /e7', /The button opens your own account and nothing else\./.test(m.html || '') && /\/s\/[A-Z0-9]{12}\/e7/.test(m.html || ''), (m.html || '').slice(-500));
    reset(); stubSendPath();
    return auto('POST', '/autopilot/prospect/nudge', { venue_id: VID, step: 'final', subject: 'Your venueplay account is still waiting', text: FINAL });
  }).then(function (r) {
    var m = nonAlert()[0] || {};
    ok('a final email goes (200), tagged /ef, with no Worker link-days sentence at all', r.status === 200 && !allDays(m) && /\/s\/[A-Z0-9]{12}\/ef/.test(m.html || ''), r.status + ' ' + (m.html || '').slice(-400));
    reset(); stubSendPath();
    return auto('POST', '/autopilot/prospect/nudge', { venue_id: VID, step: 'day3', subject: 'Your venueplay sign-in link again', text: 'Hey Pat,\n\nWe noticed you haven\'t logged in yet. Here\'s your sign-in link again.\n\nDon\'t want these reminders? {stop} or reply STOP.\n\nCheers,\nthe venueplay team' });
  }).then(function (r) {
    var m = nonAlert()[0] || {};
    ok('a day3 email goes with no link-days sentence from the Worker and the /e3 tag', r.status === 200 && !allDays(m) && /\/s\/[A-Z0-9]{12}\/e3/.test(m.html || ''), r.status + ' ' + (m.html || '').slice(-300));
    reset(); stubSendPath();
    return auto('POST', '/autopilot/prospect/nudge', { venue_id: VID, step: 'expiry', subject: 'x', text: NUDGE });
  }).then(function (r) {
    reset(); stubSendPath();
    return auto('POST', '/autopilot/prospect/nudge', { venue_id: VID, step: 'day3', subject: 'x', text: 'Hey Pat,\n\nYour link expires in {days} days, here it is.\n\nCheers,\nthe team' });
  }).then(function (r) {
    ok('...the day3 email with {days}: 400', r.status === 400 && nonAlert().length === 0, r.status + ' ' + r.body.slice(0, 160));
    reset(); stubSendPath();
    return auto('POST', '/autopilot/prospect/nudge', { venue_id: VID, step: 'day27', subject: 'x', text: 'Hey Pat,\n\nYour trial expires in 3 days, here is your link.\n\nCheers,\nthe team' });
  }).then(function (r) {
    var m = nonAlert()[0] || {};
    ok('words WITHOUT their own stop link still get the Worker\'s footer line (the one opt-out is always there)', r.status === 200 && /Stop these reminders/.test(m.html || ''), r.status + ' ' + (m.html || '').slice(-300));
    reset(); stubSendPath();
    return auto('POST', '/autopilot/prospect/nudge', { venue_id: VID, step: 'expiry', subject: 'x', text: NUDGE });
  }).then(function (r) {
    ok('the retired step "expiry" on the nudge route: 400 retired_step, nothing sent', r.status === 400 && parse(r).retired_step === true && nonAlert().length === 0, r.status + ' ' + r.body.slice(0, 160));
    return auto('POST', '/autopilot/prospect/nudge-sms', { venue_id: VID, step: 'expiry', text: SMS_BASE + 'Opt out: {stop}' });
  }).then(function (r) {
    ok('...and on the nudge text route: 400, no text', r.status === 400 && parse(r).retired_step === true && SMS.length === 0, r.status + ' ' + r.body.slice(0, 160));
    return auto('POST', '/autopilot/prospect/signin-link', { venue_id: VID, step: 'expiry' });
  }).then(function (r) {
    ok('...and on the sign-in link route: 400, no link made', r.status === 400 && parse(r).retired_step === true && !parse(r).url, r.status + ' ' + r.body.slice(0, 160));
    return auto('POST', '/autopilot/prospect/nudge', { venue_id: VID, step: 'final', text: FINAL.replace('Hey Pat,', 'Hey Pat, your link ends {expires}.') });
  }).then(function (r) {
    ok('a final email with {expires} in the words is refused (400): the Worker never fills a link-days sentence into it', r.status === 400 && nonAlert().length === 0, r.status + ' ' + r.body.slice(0, 160));
    return auto('POST', '/autopilot/prospect/nudge-sms', { venue_id: VID, step: 'day27', text: SMS_BASE + 'Opt out: {stop}' });
  }).then(function (r) {
    ok('a day27 text with {days} in the words is refused (400), nothing sent', r.status === 400 && SMS.length === 0, r.status + ' ' + r.body.slice(0, 160));
    reset(); stubSendPath();
    return auto('POST', '/autopilot/prospect/nudge-sms', { venue_id: VID, step: 'day27', text: 'venueplay: Hi Pat, just a heads up, your venueplay trial for The Test Tavern expires in 3 days. Here\'s your sign-in link, no password needed: {link} Questions? 07 5228 3667. Opt out: {stop}' });
  }).then(function (r) {
    var m = (SMS[0] || {}).message || '';
    ok('the day27 text goes, its link is tagged /t7, and it says "expires in 3 days" and nothing else about days', r.status === 200 && /\/t7(\s|$)/.test(m) && /expires in 3 days/.test(m) && !/\d+ days/.test(m.replace('expires in 3 days', '')), r.status + ' ' + m);
    // a link whose real life is over: a clean 409 with ended: true, on the email, the text and the thread link, and NOTHING is sent
    reset(); stubSendPath();
    vpaProspectLinkWindow = function () { return Promise.resolve({ from: Date.now() - 95 * 86400000, end: Date.now() - 5 * 86400000, ended: true, row: { created_at: '2026-08-01T00:00:00Z' } }); };
    return auto('POST', '/autopilot/prospect/nudge', { venue_id: VID, step: 'final', subject: 'x', text: FINAL });
  }).then(function (r) {
    ok('a final email to a venue past its real link life: 409, refused, ended: true (a clean skip for the Mac), nothing sent', r.status === 409 && parse(r).ended === true && parse(r).refused === true && nonAlert().length === 0, r.status + ' ' + r.body.slice(0, 200));
    return auto('POST', '/autopilot/prospect/nudge-sms', { venue_id: VID, step: 'day27', text: 'venueplay: Hi Pat, your venueplay trial expires in 3 days. {link} Opt out: {stop}' });
  }).then(function (r) {
    ok('...the same for the text: 409, ended: true, nothing sent', r.status === 409 && parse(r).ended === true && SMS.length === 0, r.status + ' ' + r.body.slice(0, 200));
    AUTH_PHONE = false;
    return auto('POST', '/autopilot/prospect/signin-link', { venue_id: VID, step: 'final' });
  }).then(function (r) {
    AUTH_PHONE = true;
    ok('...and for the thread link the Mac asks for (an email login): 409, ended: true', r.status === 409 && parse(r).ended === true && parse(r).refused === true, r.status + ' ' + r.body.slice(0, 200));
    // the quiet row's REAL account-state fields
    stubSendPath();
    var base = quietProspect(VID2, 'b@example.test', '0411 222 333');
    vpaProspectsData = function () { return Promise.resolve({ prospects: [Object.assign({}, base, { cancelled_at: null, paused_at: null, created_at: '2026-11-01T00:00:00Z' }),
      Object.assign(quietProspect('aaaaaaaa-2222-4333-8444-555555555555', 'c@example.test', null), { status: 'cancelled', cancelled_at: '2026-11-05T00:00:00Z' }),
      Object.assign(quietProspect('cccccccc-2222-4333-8444-555555555555', 'd@example.test', null), { status: 'paused', paused_at: '2026-11-05T00:00:00Z' }),
      Object.assign(quietProspect('bbbbbbbb-2222-4333-8444-555555555555', 'e@example.test', null), { status: 'card_added' })] }); };
    return auto('GET', '/autopilot/prospects/quiet');
  }).then(function (r) {
    var b = parse(r), rows = b.prospects || [];
    ok('the quiet list leaves out a cancelled, a paused and a card-added venue altogether (so "still active" is true of every row on it)', rows.length === 1 && rows[0].venue_id === VID2, JSON.stringify(rows.map(function (p) { return p.venue_id; })));
    ok('the quiet list says journey "23nov" (the Mac drafts and sends nothing unless it reads it)', b.journey === '23nov', JSON.stringify(Object.keys(b)));
    ok('each quiet row says its REAL state fields: status "not_signed_in", cancelled_at null, paused_at null', rows[0] && rows[0].status === 'not_signed_in' && rows[0].cancelled_at === null && rows[0].paused_at === null && ('cancelled_at' in rows[0]) && ('paused_at' in rows[0]), JSON.stringify(rows[0]).slice(0, 300));
    ok('the HQ resend draft (Dean approves it) carries no "expires in {days} days" sentence either, in either wording', !/expir|\{days\}|\b90\b/i.test(vpaResendDraftText('bounced', 'Pat') + vpaResendDraftText('never_opened', 'Pat')) && /sign-in link again/.test(vpaResendDraftText('never_opened', 'Pat')), vpaResendDraftText('never_opened', 'Pat'));
  });
});

var chain = Promise.resolve();
steps.forEach(function (s) { chain = chain.then(s).catch(function (e) { ok('step threw', false, String(e && e.stack || e)); }); });
chain.then(function () { print((fail ? 'FAILED: ' : '') + pass + ' of ' + (pass + fail) + ' checks passed'); });
