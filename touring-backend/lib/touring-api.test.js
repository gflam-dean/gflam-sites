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
      return null;
    } },
    json: function () {
      if (opts.badJson) return Promise.reject(new Error('bad'));
      return Promise.resolve(opts.body || {});
    },
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

// 12. a browser preflight is answered
run(req('OPTIONS', '/shows'), env(), function (s) { ok('OPTIONS preflight is answered', s === 204, 'status ' + s); });

var EXPECTED = 30;   // bump this when you add a check; a suite that silently
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
