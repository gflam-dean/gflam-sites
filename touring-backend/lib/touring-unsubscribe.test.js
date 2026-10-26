/* DOES THE UNSUBSCRIBE LINK IN A GFLAM EMAIL ACTUALLY TAKE SOMEBODY OFF THE LIST?
 *
 * Dean, 26 Oct 2026: "why's it not a link that you click and it automates it".
 * This drives the REAL handler in the DEPLOY build of touring-api against a fake
 * gflam_customers table that behaves like PostgREST for the calls the handler makes
 * (PATCH with filters, insert with on_conflict + ignore-duplicates), and then looks
 * IN THE TABLE, because the screen saying Done is how PartyPlay's broken button hid.
 *
 *   jsc touring-backend/lib/touring-unsubscribe.test.js
 */
function findFile(rel) {
  var tries = [rel, '../' + rel, '../../' + rel];
  for (var i = 0; i < tries.length; i++) {
    try { var t = readFile(tries[i]); if (t && t.length > 500) return tries[i]; } catch (e) {}
  }
  throw new Error('cannot find ' + rel);
}
var SRC_PATH = findFile('touring-backend/worker/DEPLOY-touring-api.js');
var src = readFile(SRC_PATH);
if (src.indexOf('touring-api') < 0 || src.indexOf('handleGflamUnsubscribe') < 0) {
  throw new Error('that is not the touring worker with the unsubscribe: ' + SRC_PATH);
}
load(findFile('partyplay-backend/worker/_test-sha256.js'));   // a real HMAC, checked below

var pass = 0, fail = 0, steps = [];
function ok(label, good, detail) {
  if (good) { pass++; print('  PASS  ' + label + (detail ? '  (' + detail + ')' : '')); }
  else { fail++; print('  FAIL  ' + label + (detail ? '  (' + detail + ')' : '')); }
}

// ---- WebCrypto stand-in: real HMAC-SHA256 from _test-sha256.js -------------------
globalThis.TextEncoder = function () { this.encode = function (s) { return { _s: String(s) }; }; };
globalThis.crypto = { subtle: {
  importKey: function (fmt, k) { return Promise.resolve({ _k: k._s }); },
  sign: function (alg, key, msg) { return Promise.resolve(new Uint8Array(SHA.hmac(key._k, msg._s)).buffer); },
  digest: function () { return Promise.resolve(new Uint8Array(32).buffer); },
} };

// ---- the fake table ---------------------------------------------------------------
var TABLE = {};          // email -> row
var calls = [];
var FAIL_DB = false;
function filtersOf(qs) {
  var out = {};
  qs.split('&').forEach(function (p) {
    var kv = p.split('='); var k = decodeURIComponent(kv[0]); var v = decodeURIComponent(kv.slice(1).join('='));
    out[k] = v;
  });
  return out;
}
function respond(status, body) {
  var text = body == null ? '' : JSON.stringify(body);
  return Promise.resolve({ ok: status < 400, status: status, text: function () { return Promise.resolve(text); } });
}
globalThis.fetch = function (url, init) {
  url = String(url); init = init || {};
  var method = init.method || 'GET';
  calls.push({ url: url, method: method, body: init.body });
  if (FAIL_DB) return respond(500, { message: 'down' });
  var m = url.match(/\/rest\/v1\/gflam_customers\?(.*)$/);
  if (!m) return respond(404, { message: 'not stubbed: ' + url });
  var f = filtersOf(m[1]);
  if (method === 'PATCH') {
    var patch = JSON.parse(init.body);
    if (!('unsubscribe_source' in patch)) return respond(400, { message: 'patch without source' });
    var email = (f.email || '').replace(/^eq\./, '');
    var row = TABLE[email];
    var hits = [];
    if (row && (f.unsubscribed_at !== 'is.null' || row.unsubscribed_at == null)) {
      for (var k in patch) row[k] = patch[k];
      hits.push(row);
    }
    return respond(200, hits);
  }
  if (method === 'POST') {
    var prefer = (init.headers && (init.headers.Prefer || init.headers.prefer)) || '';
    var rows = JSON.parse(init.body);
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (!r.source || !r.consent) return respond(400, { message: 'not null violated' });
      if (TABLE[r.email]) {
        if (prefer.indexOf('ignore-duplicates') < 0) return respond(409, { message: 'duplicate key' });
        continue;
      }
      TABLE[r.email] = JSON.parse(JSON.stringify(r));
    }
    return respond(201, null);
  }
  return respond(405, null);
};
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

var worker;
eval(src.replace('export default {', 'worker = {').replace(/\};\s*$/, '};'));

var SECRET = 'vector-secret-26oct';
var VECTOR = 'bca393cbe4284029351e1e4c98244abc';   // Python: hmac('gflam-unsub:'+secret, 'queen@example.com')[:32]
var ENV = { MANAGE_PASSWORD: 'x', SUPABASE_URL: 'https://db.example.co', SUPABASE_SERVICE_KEY: 'k',
            GFLAM_UNSUB_SECRET: SECRET };
function env(over) { var e = {}; for (var k in ENV) e[k] = ENV[k]; for (var k2 in (over || {})) e[k2] = over[k2]; return e; }
function req(method, path, body) {
  return { method: method, url: 'https://touring-api.example.workers.dev' + path,
    headers: { get: function (h) { return String(h).toLowerCase() === 'origin' ? null : null; } },
    text: function () { return Promise.resolve(body || ''); } };
}
function step(fn) { steps.push(fn); }
function link(email, tok, extra) { return '/unsubscribe?e=' + encodeURIComponent(email) + '&t=' + tok + (extra || ''); }

// 0. The Worker and the mail-out agree on the token, character for character.
step(function () {
  return gflamUnsubToken(env(), '  Queen@Example.com ').then(function (t) {
    ok('the token matches the Python vector (case and spaces ignored)', t === VECTOR, t);
  });
});

// 1. GET with a valid token: a branded page, and NOTHING written (scanners fetch links).
step(function () {
  TABLE = { 'queen@example.com': { email: 'queen@example.com', source: 'oztix', consent: 'yes', unsubscribed_at: null } };
  calls = [];
  return worker.fetch(req('GET', link('queen@example.com', VECTOR, '&c=dragbingo-jan27')), env()).then(function (r) {
    ok('GET valid link answers 200', r.status === 200, r.status);
    ok('the page says it is Gflam Touring / Drag Bingo', /Gflam Touring &middot; Drag Bingo/.test(r.body));
    ok('the page posts back to the same signed URL', r.body.indexOf('method:"POST"') >= 0 && r.body.indexOf(VECTOR) >= 0);
    ok('the page says "You\'re off the list" once it has posted', /You&#39;re off the list/.test(r.body));
    ok('the page has no em dash', r.body.indexOf('—') < 0);
    ok('the GET writes nothing (link scanners)', calls.length === 0 && TABLE['queen@example.com'].unsubscribed_at == null, calls.length + ' calls');
  });
});

// 2. The page's POST (a human, after the click) writes unsubscribed_at and the source.
step(function () {
  calls = [];
  return worker.fetch(req('POST', link('queen@example.com', VECTOR, '&c=dragbingo-jan27'), 'via=page'), env()).then(function (r) {
    var row = TABLE['queen@example.com'];
    ok('POST from the page answers 200', r.status === 200, r.status);
    ok('unsubscribed_at is set IN THE TABLE', !!row.unsubscribed_at, row.unsubscribed_at);
    ok('the source says link + campaign', row.unsubscribe_source === 'link:dragbingo-jan27', row.unsubscribe_source);
    ok('the consent source is left alone', row.source === 'oztix', row.source);
  });
});

// 3. A repeat click changes nothing and still says done. The first time is the proof.
step(function () {
  var first = TABLE['queen@example.com'].unsubscribed_at;
  TABLE['queen@example.com'].unsubscribed_at = '2026-01-01T00:00:00.000Z';
  return worker.fetch(req('POST', link('queen@example.com', VECTOR), 'List-Unsubscribe=One-Click'), env()).then(function (r) {
    var row = TABLE['queen@example.com'];
    ok('a repeat answers 200', r.status === 200, r.status);
    ok('a repeat keeps the first unsubscribe time', row.unsubscribed_at === '2026-01-01T00:00:00.000Z', row.unsubscribed_at);
    ok('a repeat keeps the first source', row.unsubscribe_source === 'link:dragbingo-jan27', row.unsubscribe_source);
    ok('one row, not two', Object.keys(TABLE).length === 1);
    void first;
  });
});

// 4. RFC 8058 one-click for somebody NOT on the list: a row that records only the opt-out.
step(function () {
  var who = 'stranger@example.org';
  return gflamUnsubToken(env(), who).then(function (t) {
    return worker.fetch(req('POST', link(who, t), 'List-Unsubscribe=One-Click'), env()).then(function (r) {
      var row = TABLE[who];
      ok('one-click POST answers 200 with no page', r.status === 200 && !/<html/i.test(r.body), r.status + ' ' + r.body);
      ok('a row is created for an address not on the list', !!row && !!row.unsubscribed_at);
      ok('it is marked as an unsubscribe, never as consent', row && row.source === 'unsubscribe' && /never be mailed/.test(row.consent) && row.lists.length === 0);
      ok('the source says one-click', row && row.unsubscribe_source === 'one-click', row && row.unsubscribe_source);
    });
  });
});

// 5. Bad tokens: polite page, 403, NO database call at all.
step(function () {
  TABLE = { 'queen@example.com': { email: 'queen@example.com', source: 'oztix', consent: 'yes', unsubscribed_at: null } };
  calls = [];
  var bad = VECTOR.slice(0, 31) + (VECTOR.slice(31) === '0' ? '1' : '0');
  return worker.fetch(req('GET', link('queen@example.com', bad)), env()).then(function (r) {
    ok('GET with a wrong token is refused politely', r.status === 403 && /That link looks wrong/.test(r.body), r.status);
    return worker.fetch(req('POST', link('queen@example.com', bad), 'List-Unsubscribe=One-Click'), env());
  }).then(function (r) {
    ok('POST with a wrong token is refused', r.status === 403, r.status);
    return worker.fetch(req('POST', '/unsubscribe?e=queen%40example.com', 'List-Unsubscribe=One-Click'), env());
  }).then(function (r) {
    ok('POST with no token is refused', r.status === 403, r.status);
    return worker.fetch(req('POST', link('other@example.com', VECTOR), 'List-Unsubscribe=One-Click'), env());
  }).then(function (r) {
    ok("one person's token cannot unsubscribe another", r.status === 403, r.status);
    ok('no bad link touched the database', calls.length === 0 && TABLE['queen@example.com'].unsubscribed_at == null, calls.length + ' calls');
  });
});

// 6. An unset secret never means "any token will do".
step(function () {
  calls = [];
  return worker.fetch(req('POST', link('queen@example.com', VECTOR), 'List-Unsubscribe=One-Click'), env({ GFLAM_UNSUB_SECRET: '' })).then(function (r) {
    ok('no secret: refused, nothing written', r.status === 503 && calls.length === 0, r.status);
  });
});

// 7. When the database fails, nobody is told they are off the list.
step(function () {
  FAIL_DB = true;
  return worker.fetch(req('POST', link('queen@example.com', VECTOR), 'List-Unsubscribe=One-Click'), env()).then(function (r) {
    FAIL_DB = false;
    ok('a failed write is not reported as done', r.status === 502, r.status);
  });
});

// 8. /health names the secret when it is missing, and never prints it.
step(function () {
  return worker.fetch(req('GET', '/health'), env({ GFLAM_UNSUB_SECRET: '' })).then(function (r) {
    var b = JSON.parse(r.body);
    ok('/health names GFLAM_UNSUB_SECRET when it is missing', b.missing.indexOf('GFLAM_UNSUB_SECRET') >= 0 && !b.ok);
    return worker.fetch(req('GET', '/health'), env());
  }).then(function (r) {
    ok('/health never echoes the secret', r.body.indexOf(SECRET) < 0);
  });
});

var chain = Promise.resolve();
steps.forEach(function (s) { chain = chain.then(s).catch(function (e) { ok('step threw', false, String(e)); }); });
chain.then(function () {
  print((fail ? 'FAILED: ' : '') + pass + ' of ' + (pass + fail) + ' checks passed');
});
