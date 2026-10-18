/* CAN ANYBODY BUT DEAN WRITE THE TOUR LISTINGS?
 *
 * Until 5 Sep the answer was yes. manage.html wrote shows, experience,
 * ticket_milestones and tour_categories from the browser with the PUBLIC
 * Supabase key, behind a four digit PIN whose SHA-256 was in the page source.
 * Ten thousand guesses, and irrelevant anyway, because the writes carried the
 * public key with or without the PIN.
 *
 * This drives the REAL handler out of the DEPLOY build against a stubbed
 * database and asserts the refusals, not just the happy path. The one that
 * matters most is the last: an UNSET password must never read as "open".
 *
 *   jsc touring-backend/lib/touring-api.test.js
 */
function findFile(rel) {
  var tries = [rel, '../' + rel, '../../' + rel, 'touring-backend/worker/DEPLOY-touring-api.js'];
  for (var i = 0; i < tries.length; i++) {
    try { var t = readFile(tries[i]); if (t && t.length > 500) return tries[i]; } catch (e) {}
  }
  throw new Error('cannot find ' + rel);
}

var SRC_PATH = findFile('touring-backend/worker/DEPLOY-touring-api.js');
var src = readFile(SRC_PATH);

/* THE FILE UNDER TEST IS THE ONE WE DEPLOY. Twice in this project a suite has
   tested a copy nobody ships, so assert we found the real thing before running. */
if (src.indexOf('touring-api') < 0 || src.indexOf('MANAGE_PASSWORD') < 0) {
  throw new Error('that is not the touring worker: ' + SRC_PATH);
}

var pass = 0, fail = 0, failures = [];
/* THE SUMMARY USED TO PRINT BEFORE THE CHECKS RAN. Every run() below is async, so
   the first version of this file reported "0 of 0 checks passed" and exited
   cleanly while twenty-one assertions were still pending. A suite that reports
   zero checks and returns success is worse than no suite. Every run() now
   registers its promise here and the summary waits for all of them. */
/* THE STEPS RUN ONE AT A TIME. The first version fired every request at once and
   they all shared one sbCalls log, so a test that reset the log to count its own
   database calls was reading another test's. It reported failures that were the
   suite's fault, not the worker's. Each step now gets a clean log to itself. */
var steps = [];
function ok(label, good, detail) {
  if (good) { pass++; print('  PASS  ' + label + (detail ? '  (' + detail + ')' : '')); }
  else { fail++; failures.push(label); print('  FAIL  ' + label + (detail ? '  (' + detail + ')' : '')); }
}

// ---- stubs -----------------------------------------------------------------
var sbCalls = [];
globalThis.fetch = function (url, init) {
  sbCalls.push({ url: String(url), method: (init && init.method) || 'GET',
                 body: init && init.body, headers: (init && init.headers) || {} });
  return Promise.resolve({
    ok: true, status: 200,
    text: function () { return Promise.resolve('[]'); },
  });
};
globalThis.Response = function (body, init) {
  this.body = body; this.status = (init && init.status) || 200;
  this.headers = (init && init.headers) || {};
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
globalThis.URLSearchParams = function (o) {
  this.toString = function () {
    var out = []; for (var k in o) out.push(k + '=' + encodeURIComponent(o[k])); return out.join('&');
  };
};
globalThis.TextEncoder = function () { this.encode = function (s) { return s; }; };
// jsc has no WebCrypto. The Worker only asks it for a SHA-256 to NAME a file, so a
// stand-in that is stable for the same bytes and different for different ones is
// enough to test the naming. (The real digest is Cloudflare's, not ours.)
if (!globalThis.crypto) globalThis.crypto = {};
if (!globalThis.crypto.subtle) globalThis.crypto.subtle = { digest: function (alg, data) {
  var u = new Uint8Array(data.buffer ? data.buffer : data), h = 2166136261 >>> 0, out = new Uint8Array(32);
  for (var i = 0; i < u.length; i++) { h ^= u[i]; h = Math.imul(h, 16777619) >>> 0; }
  for (var j = 0; j < 32; j++) { h ^= j; h = Math.imul(h, 16777619) >>> 0; out[j] = h & 255; }
  return Promise.resolve(out.buffer);
} };

var worker;
eval(src.replace('export default {', 'worker = {').replace(/\};\s*$/, '};'));

function req(method, path, opts) {
  opts = opts || {};
  return {
    method: method,
    url: 'https://touring-api.example.workers.dev' + path,
    headers: { get: function (h) {
      var k = String(h).toLowerCase();
      if (k === 'x-manage-key') return opts.key || null;
      if (k === 'origin') return opts.origin || 'https://www.gflamtouring.com.au';
      if (k === 'content-length') return opts.length != null ? String(opts.length) : null;
      return null;
    } },
    json: function () {
      if (opts.badJson) return Promise.reject(new Error('bad'));
      return Promise.resolve(opts.body || {});
    },
    // The Worker reads the raw text now, so it can measure a save before parsing it.
    text: function () {
      if (opts.badJson) return Promise.resolve('{"rows": [ not json');
      if (opts.rawText != null) return Promise.resolve(opts.rawText);
      return Promise.resolve(JSON.stringify(opts.body || {}));
    },
    arrayBuffer: function () { return Promise.resolve((opts.bytes || new Uint8Array(0)).buffer); },
  };
}
var GOOD = { MANAGE_PASSWORD: 'a-long-password-nobody-guesses',
             SUPABASE_URL: 'https://db.example.co',
             SUPABASE_SERVICE_KEY: 'service-key',
             SITE_ORIGIN: 'https://www.gflamtouring.com.au' };
function env(over) { var e = {}; for (var k in GOOD) e[k] = GOOD[k]; for (var k2 in (over||{})) e[k2] = over[k2]; return e; }
function run(request, e, cb) {
  steps.push(function () {
    sbCalls.length = 0;                       // this step's calls and nobody else's
    return worker.fetch(request, e).then(function (r) {
      var parsed = null; try { parsed = JSON.parse(r.body); } catch (x) {}
      cb(r.status, parsed);
    }, function (err) { cb(-1, { threw: String(err) }); });
  });
}

var ROWS = { rows: [{ id: 'aaaaaa-1', venue: 'The Bowlo' }] };

// 1. health tells you WHICH secret is missing, and never its value
run(req('GET', '/health'), env({ MANAGE_PASSWORD: '' }), function (s, b) {
  ok('health names the missing secret', b && b.missing && b.missing.indexOf('MANAGE_PASSWORD') >= 0,
     b && JSON.stringify(b.missing));
  ok('health never echoes a secret value',
     JSON.stringify(b || {}).indexOf('service-key') < 0 &&
     JSON.stringify(b || {}).indexOf('a-long-password') < 0);
});

// 2. THE ONE THAT MATTERS: an unset password is not an open door
run(req('POST', '/shows', { body: ROWS, key: '' }), env({ MANAGE_PASSWORD: '' }), function (s) {
  ok('an UNSET password refuses the write', s === 503, 'status ' + s);
});
run(req('POST', '/shows', { body: ROWS, key: 'anything' }), env({ MANAGE_PASSWORD: '' }), function (s) {
  ok('an unset password cannot be satisfied by any guess', s === 503, 'status ' + s);
});

// 3. no password, wrong password
run(req('POST', '/shows', { body: ROWS }), env(), function (s) {
  ok('no password is refused', s === 401, 'status ' + s);
});
run(req('POST', '/shows', { body: ROWS, key: 'wrong' }), env(), function (s) {
  ok('a wrong password is refused', s === 401, 'status ' + s);
});
run(req('POST', '/shows', { body: ROWS, key: GOOD.MANAGE_PASSWORD + 'x' }), env(), function (s) {
  ok('a password with one extra character is refused', s === 401, 'status ' + s);
});

// 4. the right password writes, and writes with the SERVICE key
run(req('POST', '/shows', { body: ROWS, key: GOOD.MANAGE_PASSWORD }), env(), function (s, b) {
  ok('the right password saves', s === 200 && b && b.ok === true, 'status ' + s);
  var wrote = sbCalls.filter(function (c) { return c.method === 'POST' && c.url.indexOf('/shows') >= 0; });
  ok('the save went to the database', wrote.length === 1, wrote.length + ' call(s)');
  ok('it used the service key, not the public one',
     wrote.length === 1 && String(wrote[0].headers.authorization || '').indexOf('service-key') >= 0);
});

// 5. reading stays public, because the tour pages already read these tables
run(req('GET', '/shows'), env(), function (s) {
  ok('reading needs no password', s === 200, 'status ' + s);
});

// 6. a delete id can never become a filter
run(req('POST', '/shows', { key: GOOD.MANAGE_PASSWORD,
                            body: { rows: [], delete: ['*', 'gt.0', '', 'or=(id.gt.0)'] } }), env(),
    function (s) {
      var dels = sbCalls.filter(function (c) { return c.method === 'DELETE'; });
      ok('a delete id that is not an id is ignored', s === 200 && dels.length === 0,
         dels.length + ' delete(s) issued');
    });

// 7. shape and size refusals
run(req('POST', '/shows', { key: GOOD.MANAGE_PASSWORD, body: { rows: 'not-an-array' } }), env(),
    function (s) { ok('rows must be an array', s === 400, 'status ' + s); });
var many = []; for (var i = 0; i < 501; i++) many.push({ id: 'x' + i });
run(req('POST', '/shows', { key: GOOD.MANAGE_PASSWORD, body: { rows: many } }), env(),
    function (s) { ok('an absurd number of rows is refused', s === 413, 'status ' + s); });
run(req('POST', '/shows', { key: GOOD.MANAGE_PASSWORD, badJson: true }), env(),
    function (s) { ok('malformed json is refused', s === 400, 'status ' + s); });

// 8. only the four tables, and only by name
run(req('POST', '/vp_venues', { key: GOOD.MANAGE_PASSWORD, body: ROWS }), env(),
    function (s) { ok('an unlisted table is not reachable', s === 404, 'status ' + s); });
run(req('POST', '/shows/../vp_venues', { key: GOOD.MANAGE_PASSWORD, body: ROWS }), env(),
    function (s) { ok('a path traversal is not reachable', s === 404, 'status ' + s); });
['experience', 'ticket_milestones', 'tour_categories'].forEach(function (t) {
  run(req('POST', '/' + t, { key: GOOD.MANAGE_PASSWORD, body: ROWS }), env(),
      function (s) { ok('the ' + t + ' table saves', s === 200, 'status ' + s); });
});

// 9. the replace shape, which three of the four tables have always used
run(req('POST', '/ticket_milestones', { key: GOOD.MANAGE_PASSWORD,
        body: { replace: true, rows: [{ show_name: 'The Bowlo', tickets: 40 }] } }), env(),
    function (s, b) {
      var cleared = sbCalls.filter(function (c) {
        return c.method === 'DELETE' && c.url.indexOf('id=not.is.null') >= 0; });
      ok('replace clears the table first', s === 200 && cleared.length === 1,
         'status ' + s + ', ' + cleared.length + ' clear(s)');
    });

/* THE ONE THAT WOULD HURT. An empty replace wipes a table. It is a real thing to
   want and never a thing to do by accident, so it has to be asked for. */
run(req('POST', '/ticket_milestones', { key: GOOD.MANAGE_PASSWORD,
        body: { replace: true, rows: [] } }), env(),
    function (s) { ok('an empty replace is refused by default', s === 400, 'status ' + s); });
run(req('POST', '/ticket_milestones', { key: GOOD.MANAGE_PASSWORD,
        body: { replace: true, rows: [], allow_empty: true } }), env(),
    function (s) { ok('an empty replace works when asked for out loud', s === 200, 'status ' + s); });

// 10. a new show must get its id back or the next save duplicates it
globalThis.fetch = function (url, init) {
  sbCalls.push({ url: String(url), method: (init && init.method) || 'GET',
                 body: init && init.body, headers: (init && init.headers) || {} });
  var isInsert = (init && init.method) === 'POST';
  return Promise.resolve({ ok: true, status: 200, text: function () {
    return Promise.resolve(isInsert ? '[{"id":"11111111-2222-3333-4444-555555555555","venue":"The Bowlo"}]' : '[]');
  } });
};
run(req('POST', '/shows', { key: GOOD.MANAGE_PASSWORD, body: { rows: [{ venue: 'The Bowlo' }] } }), env(),
    function (s, b) {
      ok('a new row comes back with its id',
         s === 200 && b && b.rows && b.rows[0] && b.rows[0].id === '11111111-2222-3333-4444-555555555555',
         b && b.rows ? JSON.stringify(b.rows[0] && b.rows[0].id) : 'no rows');
    });

/* 11. THE ORDER COLUMN MUST BE ONE THAT EXISTS.
   The first deploy of this worker invented `sort_order` for three of the four
   tables. shows read fine and the other three answered "read failed", because
   PostgREST refuses an order on a column that is not there, and it cost a paste
   and a round trip to find. manage.html is the authority: it has been reading
   these tables for months with orders that work, so compare against it. */
var manageSrc = null;
try { manageSrc = readFile('touring/manage.html'); } catch (e) {
  try { manageSrc = readFile('../touring/manage.html'); } catch (e2) {}
}
if (!manageSrc) {
  ok('found manage.html to compare orders against', false, 'not found');
} else {
  var wanted = {};
  var re = /rest\/v1\/(shows|experience|ticket_milestones|tour_categories)\?[^`]*?order=([a-z_]+\.(?:asc|desc))/g, mm;
  while ((mm = re.exec(manageSrc)) !== null) { if (!wanted[mm[1]]) wanted[mm[1]] = mm[2]; }
  var names = Object.keys(wanted);
  ok('manage.html names an order for all four tables', names.length === 4, names.join(', '));
  names.forEach(function (t) {
    var m2 = src.match(new RegExp(t + ':\\s*\\{ order: \'([^\']+)\''));
    ok('the worker orders ' + t + ' by a real column',
       !!m2 && m2[1] === wanted[t],
       'worker=' + (m2 ? m2[1] : 'none') + '  manage.html=' + wanted[t]);
  });
}

/* 12. ROWS WITH DIFFERENT KEYS. This is what broke the first real save: PostgREST
   refuses a bulk insert whose objects do not all carry the same keys, and all the
   caller sees is "save failed". */
run(req('POST', '/shows', { key: GOOD.MANAGE_PASSWORD, body: { rows: [
        { id: 'aaaaaaaa-1111-2222-3333-444444444444', venue: 'The Bowlo', host: 'Kiki' },
        { venue: 'The Royal' }                       // no id, no host
      ] } }), env(), function (s, b) {
  var sent = sbCalls.filter(function (c) { return c.method === 'POST' && /\/rest\/v1\/shows$/.test(c.url); });
  // Each upsert must carry one shape (PostgREST refuses a mixed batch), and a key a
  // row did not carry must never be written as null: that is how a picture would be
  // wiped when the page leaves img_src out of an unchanged row.
  var shapesOk = sent.length === 2 && sent.every(function (c) {
    var b2 = JSON.parse(c.body);
    return b2.every(function (r) { return JSON.stringify(Object.keys(r).sort()) === JSON.stringify(Object.keys(b2[0]).sort()); });
  });
  ok('rows with different keys go as separate upserts, one shape each', s === 200 && shapesOk,
     sent.length + ' upsert(s)');
  var nulled = sent.some(function (c) { return JSON.parse(c.body).some(function (r) {
    return ('host' in r && r.host === null) || ('id' in r && r.id === null); }); });
  ok('a key a row did not carry is never sent as null', s === 200 && !nulled);
});
run(req('POST', '/shows', { key: GOOD.MANAGE_PASSWORD, body: { rows: [{ a: 1 }, 'not-an-object'] } }), env(),
    function (s) { ok('a row that is not an object is refused', s === 400, 'status ' + s); });

// 13. the bare URL is a person who typed it, not a bug
run(req('GET', '/'), env(), function (s, b) {
  ok('the root explains what this worker is', s === 200 && b && b.worker === 'touring-api',
     'status ' + s);
  ok('and does not read like an error', !(b && b.error));
});
run(req('GET', '/nonsense'), env(), function (s, b) {
  ok('an unknown path still 404s, and names itself', s === 404 && b && b.path === '/nonsense',
     'status ' + s);
});

/* 15. PICTURES (19 Oct 2026). Dean could not add a show: every save re-sent every row
   with its whole base64 picture inside, and one upsert ran past the database's eight
   second limit. Pictures now go to Storage through /upload and a row keeps an address. */
function pngBytes(n) {
  var b = new Uint8Array(n);
  [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A].forEach(function (x, i) { b[i] = x; });
  for (var i = 8; i < n; i++) b[i] = (i * 31) & 255;
  return b;
}
function jpegBytes(n) {
  var b = new Uint8Array(n); b[0] = 0xFF; b[1] = 0xD8; b[2] = 0xFF; b[3] = 0xE0;
  for (var i = 4; i < n; i++) b[i] = (i * 7) & 255;
  return b;
}
var storageFetch = function (url, init) {
  sbCalls.push({ url: String(url), method: (init && init.method) || 'GET',
                 body: init && init.body, headers: (init && init.headers) || {} });
  return Promise.resolve({ ok: true, status: 200, text: function () { return Promise.resolve('{"Key":"x"}'); } });
};
steps.push(function () { globalThis.fetch = storageFetch; return Promise.resolve(); });
run(req('POST', '/upload?kind=show', { bytes: jpegBytes(200000) }), env(), function (s) {
  ok('an upload with no password is refused', s === 401, 'status ' + s);
});
run(req('POST', '/upload?kind=show', { key: GOOD.MANAGE_PASSWORD, bytes: jpegBytes(200000) }), env(),
    function (s, b) {
      var put = sbCalls.filter(function (c) { return c.method === 'POST' && c.url.indexOf('/storage/v1/object/tour-images/') >= 0; });
      ok('a JPG upload is stored in the tour-images bucket', s === 200 && put.length === 1,
         'status ' + s + ', ' + put.length + ' storage write(s)');
      ok('it is stored with the service key, under a name the Worker chose',
         put.length === 1 && String(put[0].headers.Authorization || '').indexOf('service-key') >= 0 &&
         /\/tour-images\/shows\/[0-9a-f]{32}\.jpg$/.test(put[0].url), put.length ? put[0].url : 'none');
      ok('the stored type comes from the bytes, not the browser',
         put.length === 1 && put[0].headers['Content-Type'] === 'image/jpeg');
      ok('the answer is a short public address, not the picture',
         s === 200 && b && typeof b.url === 'string' && b.url.length < 200 &&
         b.url.indexOf('https://db.example.co/storage/v1/object/public/tour-images/shows/') === 0,
         b && b.url);
    });
run(req('POST', '/upload?kind=card', { key: GOOD.MANAGE_PASSWORD, bytes: pngBytes(5000) }), env(),
    function (s, b) {
      ok('a tour card picture goes in its own folder', s === 200 && b && /\/tour-images\/cards\/[0-9a-f]{32}\.png$/.test(b.url || ''),
         b && b.url);
    });
run(req('POST', '/upload?kind=show', { key: GOOD.MANAGE_PASSWORD, bytes: pngBytes(5 * 1024 * 1024) }), env(),
    function (s) {
      var put = sbCalls.filter(function (c) { return c.url.indexOf('/storage/') >= 0; });
      ok('a 5 MB picture is refused, not stored', s === 413 && put.length === 0, 'status ' + s);
    });
run(req('POST', '/upload?kind=show', { key: GOOD.MANAGE_PASSWORD, bytes: pngBytes(5 * 1024 * 1024), length: 5 * 1024 * 1024 }), env(),
    function (s) { ok('a declared length over the cap is refused before reading', s === 413, 'status ' + s); });
var html = new Uint8Array(4000); for (var hi = 0; hi < 4000; hi++) html[hi] = 60;
run(req('POST', '/upload?kind=show', { key: GOOD.MANAGE_PASSWORD, bytes: html }), env(),
    function (s) { ok('something that is not a picture is refused', s === 415, 'status ' + s); });
run(req('POST', '/upload?kind=../../venue-ads', { key: GOOD.MANAGE_PASSWORD, bytes: jpegBytes(3000) }), env(),
    function (s, b) {
      ok('the caller cannot choose the folder', s === 200 && b && b.url.indexOf('/tour-images/shows/') > 0, b && b.url);
    });

var BIGIMG = 'data:image/png;base64,' + new Array(300001).join('A');
run(req('POST', '/shows', { key: GOOD.MANAGE_PASSWORD, body: { rows: [
        { id: 'aaaaaaaa-1111-2222-3333-444444444444', venue: 'Tugun', img_src: 'data:image/png;base64,iVBORw0KGgo=' } ] } }), env(),
    function (s) {
      var wrote = sbCalls.filter(function (c) { return c.method === 'POST'; });
      ok('a show whose picture is inside the row is refused', s === 413 && wrote.length === 0, 'status ' + s);
    });
run(req('POST', '/tour_categories', { key: GOOD.MANAGE_PASSWORD, body: { replace: true, rows: [
        { name: 'Drag Bingo', image_url: 'data:image/jpeg;base64,/9j/4AAQ' } ] } }), env(),
    function (s) {
      var dels = sbCalls.filter(function (c) { return c.method === 'DELETE'; });
      ok('a tour card with its picture inside is refused before the table is cleared', s === 413 && dels.length === 0,
         'status ' + s + ', ' + dels.length + ' clear(s)');
    });
run(req('POST', '/shows', { key: GOOD.MANAGE_PASSWORD, body: { rows: [{ id: 'aaaaaaaa-1111-2222-3333-444444444444', notes: BIGIMG.slice(22) }] } }), env(),
    function (s) { ok('a save of megabytes is refused whatever field carries it', s === 413, 'status ' + s); });
run(req('POST', '/shows', { key: GOOD.MANAGE_PASSWORD, body: ROWS, length: 3000000 }), env(),
    function (s) { ok('a declared save length over the cap is refused', s === 413, 'status ' + s); });

/* 16. REMEMBERING PERFORMERS AND VENUES. "should it not save the artists for next
   time?" A new name on a saved show is added to artists or venues; a name already
   there (in any case) is not added twice; nothing but the name and suburb is written. */
var dbArtists = [{ name: 'Vollie LaVont' }, { name: 'Scarlett Fever' }];
var dbVenues = [{ name: 'Tugun Bowls Club' }];
var rememberFetch = function (url, init) {
  url = String(url);
  sbCalls.push({ url: url, method: (init && init.method) || 'GET', body: init && init.body, headers: (init && init.headers) || {} });
  var m = (init && init.method) || 'GET', body = '[]';
  var off = /offset=(\d+)/.exec(url); off = off ? +off[1] : 0;
  if (m === 'GET' && url.indexOf('/rest/v1/artists?') >= 0) body = JSON.stringify(dbArtists.slice(off, off + 1000));
  if (m === 'GET' && url.indexOf('/rest/v1/venues?') >= 0) body = JSON.stringify(dbVenues.slice(off, off + 1000));
  if (m === 'POST' && /\/rest\/v1\/shows$/.test(url)) body = init.body;
  return Promise.resolve({ ok: true, status: 200, text: function () { return Promise.resolve(body); } });
};
steps.push(function () { globalThis.fetch = rememberFetch; return Promise.resolve(); });
run(req('POST', '/shows', { key: GOOD.MANAGE_PASSWORD, body: { rows: [
        { id: 'bbbbbbbb-1111-2222-3333-444444444444', venue: 'Coolangatta Hotel', suburb: 'Coolangatta',
          host: 'vollie lavont', queens: ['scarlett fever', 'ShuShu  Funtanna', 'TBA'] },
        { id: 'cccccccc-1111-2222-3333-444444444444', venue: 'tugun bowls club', suburb: 'Tugun',
          host: 'Vollie LaVont', queens: ['ShuShu Funtanna'] } ] } }), env(),
    function (s, b) {
      var addA = sbCalls.filter(function (c) { return c.method === 'POST' && /\/rest\/v1\/artists$/.test(c.url); });
      var addV = sbCalls.filter(function (c) { return c.method === 'POST' && /\/rest\/v1\/venues$/.test(c.url); });
      var a = addA.length ? JSON.parse(addA[0].body) : [];
      var v = addV.length ? JSON.parse(addV[0].body) : [];
      ok('a new performer is remembered once, and a known one is not added again',
         s === 200 && a.length === 1 && a[0].name === 'ShuShu Funtanna', JSON.stringify(a));
      ok('a placeholder like TBA is not remembered', a.every(function (x) { return !/tba/i.test(x.name); }));
      ok('only the name is written to artists', a.every(function (x) { return Object.keys(x).join() === 'name'; }));
      ok('a new venue is remembered with its suburb, a known one is not',
         v.length === 1 && v[0].name === 'Coolangatta Hotel' && v[0].suburb === 'Coolangatta', JSON.stringify(v));
      ok('the save says what it remembered', b && b.remembered && b.remembered.artists === 1 && b.remembered.venues === 1,
         b && JSON.stringify(b.remembered));
    });
steps.push(function () {
  globalThis.fetch = function (url, init) {
    url = String(url);
    sbCalls.push({ url: url, method: (init && init.method) || 'GET', body: init && init.body, headers: {} });
    var bad = /\/rest\/v1\/artists/.test(url);
    return Promise.resolve({ ok: !bad, status: bad ? 500 : 200, text: function () { return Promise.resolve('[]'); } });
  };
  return Promise.resolve();
});
run(req('POST', '/shows', { key: GOOD.MANAGE_PASSWORD, body: { rows: [
        { id: 'dddddddd-1111-2222-3333-444444444444', venue: 'X', queens: ['New Queen'] } ] } }), env(),
    function (s, b) {
      ok('a failure remembering names never fails the show save', s === 200 && b && b.ok === true &&
         b.remembered && b.remembered.error, 'status ' + s);
    });
steps.push(function () { globalThis.fetch = storageFetch; return Promise.resolve(); });

// 14. a browser preflight is answered
run(req('OPTIONS', '/shows'), env(), function (s) { ok('OPTIONS preflight is answered', s === 204, 'status ' + s); });

var EXPECTED = 56;   // bump this when you add a check; a suite that silently
                     // stops running assertions must not still say it passed.
steps.reduce(function (chain, step) {
  return chain.then(step);
}, Promise.resolve()).then(function () {
  print('');
  print(pass + ' of ' + (pass + fail) + ' checks passed');
  if (pass + fail !== EXPECTED) {
    print('EXPECTED ' + EXPECTED + ' checks and ran ' + (pass + fail) + '.');
    throw new Error('wrong number of checks ran');
  }
  if (fail) { print('failed: ' + failures.join(', ')); throw new Error(fail + ' check(s) failed'); }
});
