/* Does an ARCHIVED venue actually let go of the host?
   ============================================================================
   Dean, 18 Sep 2026: "your tab with the GFLAM group has the Mini Bar loaded but says
   the games are on hold at the moment again."

   A fix shipped that morning and did NOT fix it. The guard swapped away from a stored
   archived venue by clearing localStorage and re-picking, but pickVenue() only ever had
   venue IDS, never their status, so the re-pick returned staff[0] with no status test at
   all. When the archived venue happened to be first in an UNORDERED vp_venue_staff query,
   the host landed straight back on it. Same user, same data, different outcome depending
   on Postgres row order, which is why it looked intermittent.

   It also broke HQ "View as": hq.html stores the id then NAVIGATES to index.html, so an
   explicit choice arrived looking exactly like a restore, the guard threw it away, and the
   admin was bounced back to HQ with no message.

   This runs the SHIPPED venueplay/app/vp-session.js. Not a copy. Under jsc with stubbed
   window/document/localStorage/sessionStorage and a fake Supabase whose staff-row ORDER the
   test controls, because the order is the whole bug.

   Run:  jsc tools/test-archived-venue-restore.js
   ========================================================================== */

var PASS = 0, FAIL = 0;
function ok(name, cond, detail) {
  if (cond) { PASS++; print('  ok    ' + name); }
  else { FAIL++; print('  FAIL  ' + name + (detail ? '  -> ' + detail : '')); }
}

var SRC = (function () {
  var p = 'venueplay/app/vp-session.js';
  var s = readFile(p);
  if (!s || s.length < 5000) throw new Error('could not read ' + p);
  return s;
})();

/* Build a fresh VP against a described world.
   venues: { id: {status, suspended_reason} }
   staff:  [ids] in the ORDER the database hands them back
   stored: what localStorage already holds
   explicitSession: what (if anything) an explicit choice recorded this session */
function boot(world) {
  var store = {};
  if (world.stored) store['vpCurrentVenue'] = world.stored;
  var session = {};
  if (world.explicitSession) session['vpVenueExplicit'] = world.explicitSession;

  var reads = [];
  var painted = [];
  function table(name) {
    var q = {
      _rows: [],
      select: function () { return q; },
      eq: function () { return q; },
      in: function (col, vals) { q._in = vals; return q; },
      order: function () { q._ordered = true; return q; },
      maybeSingle: function () {
        reads.push(name);
        if (name === 'vp_platform_admins') {
          return Promise.resolve({ data: world.isAdmin ? { role: 'admin', label: 'HQ' } : null });
        }
        if (name === 'vp_venues') {
          // loadVenue() reads ONE venue by id with maybeSingle. Answering null here is
          // what made the first draft of this test lie: isArchived(null) is false, so
          // the guard never fired and every check went red for the wrong reason.
          var v = world.venues[q._id];
          return Promise.resolve({
            data: v ? { id: q._id, status: v.status,
                        suspended_reason: v.suspended_reason || null,
                        name: 'Venue ' + q._id }
                    : null,
            error: null
          });
        }
        if (name === 'vp_venue_settings') {
          return Promise.resolve({ data: { venue_id: q._id, brand_colour: '#000' }, error: null });
        }
        return Promise.resolve({ data: null });
      },
      then: function (res) {
        reads.push(name);
        var data = [];
        if (name === 'vp_venue_staff') {
          data = world.staff.map(function (id) {
            return { venue_id: id, role: 'owner', display_name: 'X' };
          });
        } else if (name === 'vp_venues') {
          var ids = q._in || Object.keys(world.venues);
          data = ids.filter(function (id) { return world.venues[id]; })
                    .map(function (id) {
                      var v = world.venues[id];
                      return { id: id, status: v.status,
                               suspended_reason: v.suspended_reason || null,
                               name: 'Venue ' + id };
                    });
          // hand them back in an order the caller must not rely on
          if (world.reverseVenueRows) data.reverse();
        } else if (name === 'vp_venue_settings') {
          data = [];
        }
        return Promise.resolve({ data: data, error: null }).then(res);
      },
      single: function () {
        reads.push(name);
        var id = q._id;
        var v = world.venues[id];
        return Promise.resolve({
          data: v ? { id: id, status: v.status,
                      suspended_reason: v.suspended_reason || null, name: 'Venue ' + id }
                  : null,
          error: null
        });
      }
    };
    return q;
  }

  var client = {
    from: function (name) {
      var q = table(name);
      var origEq = q.eq;
      q.eq = function (col, val) {
        if (col === 'id' || col === 'venue_id') q._id = val;
        return origEq.call(q, col, val);
      };
      return q;
    },
    auth: {
      getSession: function () {
        return Promise.resolve({ data: { session: { user: { id: 'u1' } } } });
      }
    }
  };

  var win = {
    supabase: { createClient: function () { return client; } },
    localStorage: {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
      setItem: function (k, v) { store[k] = String(v); },
      removeItem: function (k) { delete store[k]; }
    },
    sessionStorage: {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(session, k) ? session[k] : null; },
      setItem: function (k, v) { session[k] = String(v); },
      removeItem: function (k) { delete session[k]; }
    },
    location: { href: '', pathname: '/app/index.html', search: '' },
    // suspensionBanner() WRITES to the DOM and returns nothing, so the only way to read
    // the wording is to capture what it inserts.
    document: { addEventListener: function () {}, readyState: 'complete',
                createElement: function () {
                  return { style: {}, innerHTML: '', id: '',
                           appendChild: function () {} };
                },
                body: { firstChild: null,
                        appendChild: function (el) { painted.push(el); },
                        insertBefore: function (el) { painted.push(el); } },
                head: { appendChild: function () {} },
                getElementById: function () { return null; },
                querySelector: function () { return null; },
                querySelectorAll: function () { return []; } },
    addEventListener: function () {},
    setTimeout: function (f) { return 0; },
    navigator: { userAgent: 'jsc' },
    fetch: function () { return Promise.resolve({ ok: true, json: function () { return Promise.resolve({}); } }); }
  };
  win.window = win;
  win.top = win;
  win.self = win;

  var fn = new Function('window', 'localStorage', 'sessionStorage', 'document',
                        'location', 'setTimeout', 'fetch', 'navigator',
                        SRC + '\nreturn window.VP;');
  var VP = fn(win, win.localStorage, win.sessionStorage, win.document,
              win.location, win.setTimeout, win.fetch, win.navigator);
  return { VP: VP, store: store, session: session, reads: reads, painted: painted };
}

var A_ARCH = { status: 'suspended', suspended_reason: 'archived' };
var C_ARCH = { status: 'suspended', suspended_reason: 'archived_cancelling' };
var B_LIVE = { status: 'active' };
var N_SUSP = { status: 'suspended', suspended_reason: 'nonpayment' };

function run(label, world, check) {
  var b;
  try { b = boot(world); }
  catch (e) { FAIL++; print('  FAIL  ' + label + '  -> boot threw: ' + e); return; }
  return b.VP.ready().then(function (ctx) { check(ctx, b); })
    .catch(function (e) { FAIL++; print('  FAIL  ' + label + '  -> ' + e); });
}

print('Archived venue must let go of the host');
print('');

var chain = Promise.resolve();

/* 1 + 2. THE BUG DEAN REPORTED. Stored venue is archived. The host must end up on their
   live venue, in BOTH staff orders. The order is the entire fault. */
chain = chain.then(function () {
  return run('archived stored, archived FIRST in the staff list -> lands on the live venue',
    { staff: ['A', 'B'], venues: { A: A_ARCH, B: B_LIVE }, stored: 'A' },
    function (ctx) {
      ok('archived first: currentVenueId is B', ctx.currentVenueId === 'B',
         'got ' + ctx.currentVenueId);
      ok('archived first: the venue handed over is not archived',
         ctx.venue && ctx.venue.status === 'active',
         'got ' + (ctx.venue && ctx.venue.status));
    });
});

chain = chain.then(function () {
  return run('archived stored, archived SECOND in the staff list',
    { staff: ['B', 'A'], venues: { A: A_ARCH, B: B_LIVE }, stored: 'A' },
    function (ctx) {
      ok('archived second: currentVenueId is B', ctx.currentVenueId === 'B',
         'got ' + ctx.currentVenueId);
    });
});

/* 3. Two archived out of three. It must find the one live venue, not another dead one. */
chain = chain.then(function () {
  return run('two archived and one live -> finds the live one',
    { staff: ['A', 'C', 'B'], venues: { A: A_ARCH, C: C_ARCH, B: B_LIVE }, stored: 'C' },
    function (ctx, b) {
      ok('picks the only live venue', ctx.currentVenueId === 'B', 'got ' + ctx.currentVenueId);
      ok('storage is left holding the live venue, not a dead one',
         b.store['vpCurrentVenue'] === 'B', 'got ' + b.store['vpCurrentVenue']);
    });
});

/* 4. archived_cancelling counts as archived too. */
chain = chain.then(function () {
  return run('archived_cancelling is treated as archived',
    { staff: ['C', 'B'], venues: { C: C_ARCH, B: B_LIVE }, stored: 'C' },
    function (ctx) {
      ok('archived_cancelling is swapped away from', ctx.currentVenueId === 'B',
         'got ' + ctx.currentVenueId);
    });
});

/* 5. THE REGRESSION. An explicit choice must survive a page navigation.
   HQ stores the id then navigates, so this arrives looking like a restore. */
chain = chain.then(function () {
  return run('an EXPLICIT choice of an archived venue is honoured after a navigation',
    { staff: ['A', 'B'], venues: { A: A_ARCH, B: B_LIVE },
      stored: 'A', explicitSession: 'A' },
    function (ctx) {
      ok('explicit archived choice is kept', ctx.currentVenueId === 'A',
         'got ' + ctx.currentVenueId);
    });
});

chain = chain.then(function () {
  return run('an admin with NO staff rows keeps the archived venue they chose',
    { staff: [], isAdmin: true, venues: { A: A_ARCH }, stored: 'A', explicitSession: 'A' },
    function (ctx) {
      ok('admin View as keeps currentVenueId', ctx.currentVenueId === 'A',
         'got ' + ctx.currentVenueId);
    });
});

/* 6. A LONE archived venue must be kept, so the banner can explain.
   Swapping it for nothing would be worse than the banner. */
chain = chain.then(function () {
  return run('a lone archived venue is kept so the banner can speak',
    { staff: ['A'], venues: { A: A_ARCH }, stored: 'A' },
    function (ctx, b) {
      ok('lone archived venue is kept', ctx.currentVenueId === 'A', 'got ' + ctx.currentVenueId);
      b.VP.suspensionBanner(ctx);
      var banner = b.painted.map(function (el) { return el.innerHTML || ''; }).join(' ');
      ok('and the banner says archived rather than "on hold"',
         /archived/i.test(banner) && !/on hold/i.test(banner),
         JSON.stringify(banner.slice(0, 110)));
    });
});

/* 7. A genuinely suspended venue must NOT be swapped away. Nonpayment is a real problem
   the host needs to see, not a venue somebody switched off on purpose. */
chain = chain.then(function () {
  return run('a nonpayment suspension is NOT treated as archived',
    { staff: ['N', 'B'], venues: { N: N_SUSP, B: B_LIVE }, stored: 'N' },
    function (ctx) {
      ok('nonpayment venue is kept so the host sees it', ctx.currentVenueId === 'N',
         'got ' + ctx.currentVenueId);
    });
});

/* 8. No flip-flop. Two consecutive loads must settle, not alternate. */
chain = chain.then(function () {
  var world = { staff: ['A', 'B'], venues: { A: A_ARCH, B: B_LIVE }, stored: 'A' };
  var b = boot(world);
  return b.VP.ready().then(function (first) {
    var after = b.store['vpCurrentVenue'];
    var b2 = boot({ staff: world.staff, venues: world.venues, stored: after });
    return b2.VP.ready().then(function (second) {
      ok('the second load agrees with the first (no flip-flop)',
         first.currentVenueId === second.currentVenueId && second.currentVenueId === 'B',
         first.currentVenueId + ' then ' + second.currentVenueId);
      ok('storage is not left empty', !!after, 'got ' + after);
    });
  }).catch(function (e) { FAIL++; print('  FAIL  flip-flop check -> ' + e); });
});

/* 9. The re-pick must not cost a second pair of round trips in the common case. */
chain = chain.then(function () {
  var b = boot({ staff: ['A', 'B'], venues: { A: A_ARCH, B: B_LIVE }, stored: 'A' });
  return b.VP.ready().then(function () {
    var venueReads = b.reads.filter(function (r) { return r === 'vp_venues'; }).length;
    ok('does not read venues more than twice to resolve one choice', venueReads <= 2,
       'vp_venues read ' + venueReads + ' times');
  }).catch(function (e) { FAIL++; print('  FAIL  round-trip check -> ' + e); });
});

chain.then(function () {
  print('');
  print(PASS + ' passed, ' + FAIL + ' failed');
  if (FAIL) throw new Error(FAIL + ' check(s) failed');
});
