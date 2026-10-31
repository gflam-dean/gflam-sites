/* DOES THE UNSUBSCRIBE IN THE HQ WIN-BACK EMAIL ACTUALLY TAKE A VENUE OFF THE LIST,
 * AND DOES THE WIN-BACK REFUSE TO GO TO SOMEBODY WHO IS ON IT?
 *
 * Dean, 26 Oct 2026: "I need unsubscribe links on ALL marketing emails we send". The audit
 * that day found one VenuePlay marketing email with none: "Keep <venue> on VenuePlay?", sent
 * from HQ > Cancelled > Invite them back. This drives the REAL billing Worker (the whole of
 * venueplay-api-FULL.js, routing included) against a fake PostgREST that models limit and
 * offset for vp_unsubscribes, a fake Resend that keeps what it was asked to send, and then
 * looks IN THE TABLE and IN THE MESSAGE, because a page that says Done is how PartyPlay's
 * broken button hid for its whole life.
 *
 *   jsc venueplay-backend/worker/winback-unsubscribe.test.js
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
if (src.indexOf("worker: 'venueplay-api'") < 0 || src.indexOf('vpHandleUnsubscribe') < 0) {
  throw new Error('that is not the billing Worker with the unsubscribe: ' + SRC_PATH);
}
load(findFile('partyplay-backend/worker/_test-sha256.js'));   // a real HMAC, checked against Python below

// ---- the Worker's runtime, the little of it this path touches ---------------------
globalThis.TextEncoder = function () { this.encode = function (s) { return { _s: String(s) }; }; };
globalThis.crypto = { subtle: {
  importKey: function (fmt, k) { return Promise.resolve({ _k: k._s }); },
  sign: function (alg, key, msg) { return Promise.resolve(new Uint8Array(SHA.hmac(key._k, msg._s)).buffer); },
  digest: function () { return Promise.resolve(new Uint8Array(32).buffer); },
} };
globalThis.Response = function (body, init) {
  this.body = body; this.status = (init && init.status) || 200; this.headers = (init && init.headers) || {};
};
globalThis.URL = function (u) {
  var m = String(u).match(/^https?:\/\/[^\/]+(\/[^?]*)(\?(.*))?$/);
  this.pathname = m ? m[1] : '/';
  var qs = m && m[3] ? m[3] : '';
  this.searchParams = { get: function (k) {
    var parts = qs.split('&');
    for (var i = 0; i < parts.length; i++) {
      var kv = parts[i].split('=');
      if (decodeURIComponent(kv[0]) === k) return decodeURIComponent(kv[1] || '');
    }
    return null;
  } };
};

// ---- the fake database and the fake Resend ---------------------------------------
var UNSUB = [];          // vp_unsubscribes rows, in insert order
var VENUE = null, ACCT = null, AUDIT = [], SENT = [], calls = [];
var FAIL_DB = false, FAIL_LIST = false;
function qs(url) {
  var out = {}, i = url.indexOf('?');
  if (i < 0) return out;
  url.slice(i + 1).split('&').forEach(function (p) {
    var kv = p.split('='); out[decodeURIComponent(kv[0])] = decodeURIComponent(kv.slice(1).join('='));
  });
  return out;
}
function respond(status, body) {
  var text = body == null ? '' : (typeof body === 'string' ? body : JSON.stringify(body));
  return Promise.resolve({ ok: status < 400, status: status,
    text: function () { return Promise.resolve(text); },
    json: function () { return Promise.resolve(JSON.parse(text)); } });
}
globalThis.fetch = function (url, init) {
  url = String(url); init = init || {};
  var method = init.method || 'GET';
  calls.push({ url: url, method: method, body: init.body, headers: init.headers || {} });
  if (url.indexOf('https://api.resend.com/emails') === 0) {
    SENT.push(JSON.parse(init.body));
    return respond(200, { id: 'msg_' + SENT.length });
  }
  if (FAIL_DB) return respond(500, { message: 'down' });
  var f = qs(url);
  if (/\/rest\/v1\/vp_unsubscribes/.test(url)) {
    if (method === 'GET') {
      if (FAIL_LIST) return respond(500, { message: 'down' });
      /* limit and offset HONOURED, offset first, the way PostgREST does it: a fake that
         returns the same rows for every page cannot model the bug the paging exists to fix. */
      var all = UNSUB.map(function (r) { return { email: r.email }; })
        .sort(function (a, b) { return a.email < b.email ? -1 : a.email > b.email ? 1 : 0; });
      var off = parseInt(f.offset || '0', 10), lim = parseInt(f.limit || '1000', 10);
      return respond(200, all.slice(off, off + lim));
    }
    if (method === 'POST') {
      var row = JSON.parse(init.body);
      if (!row.email || row.email.length < 5 || row.email.indexOf('@') < 0) return respond(400, { message: 'check violated' });
      for (var i = 0; i < UNSUB.length; i++) {
        if (UNSUB[i].email.toLowerCase() === String(row.email).toLowerCase()) {
          return respond(409, { code: '23505', message: 'duplicate key value violates unique constraint "vp_unsubscribes_email_uniq"' });
        }
      }
      row.created_at = '2026-10-26T12:00:00.000Z'; UNSUB.push(row);
      return respond(201, null);
    }
  }
  if (/\/rest\/v1\/vp_venues\?/.test(url) && method === 'GET') return respond(200, VENUE && f.id === 'eq.' + VENUE.id ? [VENUE] : []);
  if (/\/rest\/v1\/venueplay_founding\?/.test(url) && method === 'GET') return respond(200, ACCT && f.id === 'eq.' + ACCT.id ? [ACCT] : []);
  if (/\/rest\/v1\/vp_admin_audit/.test(url) && method === 'POST') { var a = JSON.parse(init.body); AUDIT.push(a); return respond(201, [a]); }
  return respond(404, { message: 'not stubbed: ' + method + ' ' + url });
};

var worker;
eval(src.replace('export default {', 'worker = {').replace(/\};\s*$/, '};'));
// HQ's admin check talks to Supabase Auth; the thing under test is what happens AFTER it.
vpaRequireAdmin = async function () { return { actorId: 'admin-1', label: 'Dean' }; };

var SECRET = 'vector-secret-26oct';
var VECTOR = 'ec1cd32e1edc8fdd2c5d190e1b0ed1a7';   // Python: hmac('vp-unsub:'+secret, 'queen@example.com')[:32]
var API = 'https://api.venueplay.com.au';
var ENV = { STRIPE_SECRET_KEY: 'x', STRIPE_WEBHOOK_SECRET: 'x', STRIPE_PRICE_MONTHLY: 'x', STRIPE_PRICE_ANNUAL: 'x',
            SUPABASE_URL: 'https://db.example.co', SUPABASE_SERVICE_KEY: 'k', RESEND_API_KEY: 're_x',
            MOBILEMESSAGE_USERNAME: 'u', MOBILEMESSAGE_PASSWORD: 'p', CARD_LINK_SECRET: 'c',
            VP_UNSUB_SECRET: SECRET };
function env(over) { var e = {}; for (var k in ENV) e[k] = ENV[k]; for (var k2 in (over || {})) e[k2] = over[k2]; return e; }
function req(method, path, body) {
  return { method: method, url: API + path,
    headers: { get: function () { return null; } },
    text: function () { return Promise.resolve(body || ''); } };
}
function step(fn) { steps.push(fn); }
function link(email, tok, extra) { return '/unsubscribe?e=' + encodeURIComponent(email) + '&t=' + tok + (extra || ''); }
function resetVenue() {
  VENUE = { id: '11111111-2222-4333-8444-555555555555', name: 'The Test Tavern', founding_id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
            group_id: null, status: 'active', suspended_reason: null, cancel_at_period_end: true };
  ACCT = { id: VENUE.founding_id, contact_email: 'Queen@Example.com', contact_name: 'Queenie Royale' };
}
function inviteBack(e) { return worker.fetch(req('POST', '/admin/invite-back', JSON.stringify({ venue_id: VENUE.id })), e || env()); }
function parse(r) { try { return JSON.parse(r.body); } catch (e) { return {}; } }

// 0. The token is the shared scheme, character for character.
step(function () {
  return vpUnsubToken(env(), '  Queen@Example.com ').then(function (t) {
    ok('the token matches the Python vector (case and spaces ignored)', t === VECTOR, t);
  });
});

// 1. GET with a valid token: a branded page, and NOTHING written (scanners fetch links).
step(function () {
  UNSUB = []; calls = [];
  return worker.fetch(req('GET', link('queen@example.com', VECTOR, '&c=winback')), env()).then(function (r) {
    ok('GET valid link answers 200', r.status === 200, String(r.status));
    ok('the page is branded VenuePlay', /VenuePlay<\/div>/.test(r.body) && /<title>[^<]*\| VenuePlay<\/title>/.test(r.body));
    ok('the page posts back to the same signed URL', r.body.indexOf('method:"POST"') >= 0 && r.body.indexOf(VECTOR) >= 0 && r.body.indexOf('&c=winback') >= 0);
    ok('the page says "You\'re off the list" once it has posted', /You&#39;re off the list/.test(r.body));
    ok('the page has a no-script button that does the same', /<noscript><button type="submit">/.test(r.body));
    ok('the page has no em dash', r.body.indexOf('—') < 0);
    ok('the page is not cached and not indexed', r.headers['cache-control'] === 'no-store' && r.headers['x-robots-tag'] === 'noindex');
    ok('the GET writes nothing (link scanners)', calls.length === 0 && UNSUB.length === 0, calls.length + ' calls');
  });
});

// 2. The page's POST (a human, after the click) lands a row in vp_unsubscribes.
step(function () {
  calls = [];
  return worker.fetch(req('POST', link('queen@example.com', VECTOR, '&c=winback'), 'via=page'), env()).then(function (r) {
    ok('POST from the page answers 200 with no page', r.status === 200 && !/<html/i.test(r.body), r.status + ' ' + r.body);
    ok('a row is IN THE TABLE, lower-cased', UNSUB.length === 1 && UNSUB[0].email === 'queen@example.com', JSON.stringify(UNSUB));
    ok('the source says link + campaign', UNSUB.length === 1 && UNSUB[0].source === 'link:winback', UNSUB[0] && UNSUB[0].source);
    ok('the write used the service role, not the anon key', calls.length === 1 && calls[0].headers.Authorization === 'Bearer k');
  });
});

// 3. A repeat click changes nothing and still says done. The first row is the proof.
step(function () {
  UNSUB[0].created_at = '2026-01-01T00:00:00.000Z';
  return worker.fetch(req('POST', link('QUEEN@example.com', VECTOR), 'List-Unsubscribe=One-Click'), env()).then(function (r) {
    ok('a repeat answers 200', r.status === 200, String(r.status));
    ok('one row, not two', UNSUB.length === 1, String(UNSUB.length));
    ok('a repeat keeps the first row as it was', UNSUB[0].created_at === '2026-01-01T00:00:00.000Z' && UNSUB[0].source === 'link:winback');
  });
});

// 4. RFC 8058 one-click from a mail app, for an address not yet on the list.
step(function () {
  var who = 'stranger@example.org';
  return vpUnsubToken(env(), who).then(function (t) {
    return worker.fetch(req('POST', link(who, t), 'List-Unsubscribe=One-Click'), env()).then(function (r) {
      ok('one-click POST answers 200 with no page', r.status === 200 && !/<html/i.test(r.body), r.status + ' ' + r.body);
      ok('the row is there and says one-click', UNSUB.length === 2 && UNSUB[1].email === who && UNSUB[1].source === 'one-click', JSON.stringify(UNSUB[1]));
    });
  });
});

// 5. Bad tokens: polite page, 403, NO database call at all.
step(function () {
  UNSUB = []; calls = [];
  var bad = VECTOR.slice(0, 31) + (VECTOR.slice(31) === '0' ? '1' : '0');
  return worker.fetch(req('GET', link('queen@example.com', bad)), env()).then(function (r) {
    ok('GET with a wrong token is refused politely', r.status === 403 && /That link looks wrong/.test(r.body), String(r.status));
    return worker.fetch(req('POST', link('queen@example.com', bad), 'List-Unsubscribe=One-Click'), env());
  }).then(function (r) {
    ok('POST with a wrong token is refused', r.status === 403, String(r.status));
    return worker.fetch(req('POST', '/unsubscribe?e=queen%40example.com', 'List-Unsubscribe=One-Click'), env());
  }).then(function (r) {
    ok('POST with no token is refused', r.status === 403, String(r.status));
    return worker.fetch(req('POST', link('other@example.com', VECTOR), 'List-Unsubscribe=One-Click'), env());
  }).then(function (r) {
    ok("one person's token cannot unsubscribe another", r.status === 403, String(r.status));
    ok('no bad link touched the database', calls.length === 0 && UNSUB.length === 0, calls.length + ' calls');
  });
});

// 6. An unset secret never means "any token will do".
step(function () {
  calls = [];
  return worker.fetch(req('POST', link('queen@example.com', VECTOR), 'List-Unsubscribe=One-Click'), env({ VP_UNSUB_SECRET: '' })).then(function (r) {
    ok('no secret: refused, nothing written', r.status === 503 && calls.length === 0, String(r.status));
  });
});

// 7. When the database fails, nobody is told they are off the list.
step(function () {
  FAIL_DB = true;
  return worker.fetch(req('POST', link('queen@example.com', VECTOR), 'List-Unsubscribe=One-Click'), env()).then(function (r) {
    FAIL_DB = false;
    ok('a failed write is not reported as done', r.status === 502, String(r.status));
  });
});

// 8. /health says whether the secret is set, and never what it is.
step(function () {
  return worker.fetch(req('GET', '/health'), env({ VP_UNSUB_SECRET: '' })).then(function (r) {
    var b = parse(r);
    ok('/health reports can.unsubscribe false when the secret is missing', b.can && b.can.unsubscribe === false && b.ok === false && /unsubscribe/.test(b.warning || ''));
    return worker.fetch(req('GET', '/health'), env());
  }).then(function (r) {
    var b = parse(r);
    ok('/health reports can.unsubscribe true when it is set', b.can && b.can.unsubscribe === true);
    ok('/health never echoes the secret', r.body.indexOf(SECRET) < 0);
  });
});

// 9. THE SEND. The HQ win-back carries the link in the footer and both headers.
step(function () {
  resetVenue(); UNSUB = []; SENT = []; AUDIT = []; calls = [];
  return inviteBack().then(function (r) {
    var b = parse(r), m = SENT[0] || {};
    ok('HQ invite-back answers ok', r.status === 200 && b.ok === true, r.status + ' ' + r.body);
    ok('one email went to the contact, lower-cased', SENT.length === 1 && m.to && m.to[0] === 'queen@example.com', JSON.stringify(m.to));
    ok('the subject is the win-back', m.subject === 'Keep The Test Tavern on VenuePlay?', m.subject);
    var lu = (m.headers || {})['List-Unsubscribe'] || '';
    ok('List-Unsubscribe carries the Worker https link with the token', lu.indexOf('<' + API + '/unsubscribe?e=queen%40example.com&t=' + VECTOR + '&c=winback>') === 0, lu);
    ok('List-Unsubscribe carries the mailto fallback too', /<mailto:hello@venueplay\.com\.au\?subject=unsubscribe>/.test(lu), lu);
    ok('List-Unsubscribe-Post is the RFC 8058 value', (m.headers || {})['List-Unsubscribe-Post'] === 'List-Unsubscribe=One-Click');
    var html = m.html || '';
    // 31 Oct 2026: the BODY carries no workers.dev address (Ozemail's filter bounced one). The footer link is our own
    // venueplay.com.au/unsubscribe page, which writes to the same list; only the header names the Worker.
    ok('the footer link is venueplay.com.au/unsubscribe for that address, as a link', html.indexOf('href="https://venueplay.com.au/unsubscribe?e=queen%40example.com"') >= 0, html.slice(-700));
    ok('the email body names no workers.dev address', html.indexOf('workers.dev') < 0 && String(m.text || '').indexOf('workers.dev') < 0);
    ok('the footer says who is sending (ABN)', /ABN 35 679 383 049/.test(html));
    ok('the email is a whole document', /^<!doctype html>/i.test(html));
    ok('the email has no em dash', html.indexOf('—') < 0);
    ok('the win-back still says nothing is charged unless they tap', /Nothing changes and nothing is charged unless you do/.test(html));
    ok('the send was audited as accepted', AUDIT.length === 1 && AUDIT[0].action === 'venue_invited_back' && /"accepted":true/.test(JSON.stringify(AUDIT[0])));
  });
});

// 10. THE SKIP. An address on vp_unsubscribes (any case) is never sent the win-back.
step(function () {
  resetVenue(); SENT = []; AUDIT = [];
  UNSUB = [{ email: 'QUEEN@EXAMPLE.COM', source: 'form', created_at: '2026-10-20T00:00:00.000Z' }];
  return inviteBack().then(function (r) {
    var b = parse(r);
    ok('invite-back refuses an unsubscribed address', r.status === 409 && /has unsubscribed/.test(b.error || ''), r.status + ' ' + r.body);
    ok('NOTHING was sent', SENT.length === 0, String(SENT.length));
    ok('the refusal is audited as held, not sent', AUDIT.length === 1 && /"held":"unsubscribed"/.test(JSON.stringify(AUDIT[0])) && /"accepted":false/.test(JSON.stringify(AUDIT[0])));
    ok('HQ\'s audit line says it was NOT emailed', /Did not email/.test(vpaAuditSentence({ action: 'venue_invited_back', detail: AUDIT[0].detail, target: 'venue:x' }, 'The Test Tavern')));
  });
});

// 11. The skip reads PAST the first page. 1,200 rows, the address at the end.
step(function () {
  resetVenue(); SENT = []; AUDIT = []; UNSUB = []; calls = [];
  for (var i = 0; i < 1199; i++) UNSUB.push({ email: 'a' + String(1000 + i) + '@example.net', source: 'form' });
  UNSUB.push({ email: 'queen@example.com', source: 'one-click' });   // sorts after every a1xxx
  return inviteBack().then(function (r) {
    var pages = calls.filter(function (c) { return /vp_unsubscribes/.test(c.url) && c.method === 'GET'; }).length;
    ok('an address on page two of the list is still held back', r.status === 409 && SENT.length === 0, r.status + ' sent=' + SENT.length);
    ok('the list was read in more than one page', pages >= 2, pages + ' pages');
  });
});

// 12. The send FAILS CLOSED: list unreadable, or no secret to make the link with.
step(function () {
  resetVenue(); SENT = []; AUDIT = []; UNSUB = [];
  FAIL_LIST = true;
  return inviteBack().then(function (r) {
    FAIL_LIST = false;
    ok('cannot read the list: nothing sent, HQ told why', r.status === 503 && SENT.length === 0 && /unsubscribe list/.test(parse(r).error || ''), r.status + ' ' + r.body);
    return inviteBack(env({ VP_UNSUB_SECRET: '' }));
  }).then(function (r) {
    ok('no secret: nothing sent, HQ told which secret', r.status === 503 && SENT.length === 0 && /VP_UNSUB_SECRET/.test(parse(r).error || ''), r.status + ' ' + r.body);
  });
});

// 13. A transactional send is untouched: no headers key unless a sender passes some.
step(function () {
  SENT = [];
  return vpaSendEmail(env(), 'queen@example.com', 'Your VenuePlay invoice', '<p>receipt</p>').then(function (went) {
    ok('a plain send still goes', went === true && SENT.length === 1);
    ok('a plain send carries no List-Unsubscribe', SENT.length === 1 && !('headers' in SENT[0]), JSON.stringify(Object.keys(SENT[0] || {})));
  });
});

var chain = Promise.resolve();
steps.forEach(function (s) { chain = chain.then(s).catch(function (e) { ok('step threw', false, String(e && e.stack || e)); }); });
chain.then(function () {
  print((fail ? 'FAILED: ' : '') + pass + ' of ' + (pass + fail) + ' checks passed');
});
