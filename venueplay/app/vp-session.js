/* =====================================================================
   VenuePlay shared session + venue-context helper  (vp-session.js)
   ---------------------------------------------------------------------
   ONE small vanilla-JS module every management page loads AFTER the
   Supabase CDN script. It answers the three questions every page asks:
     - who is signed in?  (Supabase auth user)
     - what can they do?  (Gflam admin, or venue owner/manager/host)
     - which venue are they working on, and what are its settings?

   It does NOT touch gameplay. The live game (host console, TV, phones)
   keeps running over the anon Supabase client + Realtime broadcast on
   channel "vp-"+CODE, exactly as today. This helper is only for the
   management layer (sign-in routing, Gflam HQ, onboarding, settings).

   HOW TO LOAD (match existing pages, no build step):
     <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
     <script src="../vp-session.js"></script>   // path relative to the page
   then use the global  VP  object below.

   =====================================================================
   THE CONTRACT  (other agents wire the 5 game formats against THIS)
   ---------------------------------------------------------------------
   Everything hangs off the global  window.VP.

   VP.getClient()            -> the singleton Supabase client (sync).
                                Creates it on first call. A page that
                                already made its own client (index.html
                                does, for broadcast) should call
                                VP.useClient(existing) FIRST so there is
                                one client and one auth session.

   VP.useClient(client)      -> adopt an already-created client. Call
                                before VP.ready(). Returns the client.

   VP.ready()                -> Promise<Context>. Idempotent: resolves
                                auth + role, picks the current venue, and
                                loads that venue + its settings. Cached
                                after the first call.

   VP.refresh()              -> Promise<Context>. Force a full re-resolve
                                (call after sign-in / sign-out).

   VP.getContext()           -> the last resolved Context (sync, or null
                                before ready() has resolved once).

   VP.setCurrentVenue(id)    -> Promise<Context>. Switch the working
                                venue (a venue-switcher for multi-venue
                                staff, or an admin "view as"). Persists to
                                localStorage and reloads venue + settings.

   VP.listVenues()           -> Promise<Array<VenueRow>>. Venues the
                                caller may see: an admin gets ALL venues
                                (HQ list); a staff member gets only their
                                own. RLS does the scoping.

   VP.loadSettings(id)       -> Promise<SettingsRow|null>.
   VP.saveSettings(id, patch)-> Promise<SettingsRow>. Upsert on venue_id,
                                stamps updated_at. Manager/owner (or admin)
                                only; RLS enforces it (see migration 08).

   VP.requireAuth(opts)      -> Promise<Context>. Page guard. opts:
                                { venue:true } needs a current venue,
                                { roles:['owner','manager'] } needs one of
                                those roles at the current venue (admins
                                always pass). On failure it REDIRECTS to
                                the sign-in shell and never resolves.

   VP.signOut()              -> Promise. Clears state + redirects to /app.

   VP.homeHref(ctx)          -> string. Where a freshly signed-in person
                                should land: 'hq.html' for admins,
                                the venue console ('index.html') for staff.

   ---------------------------------------------------------------------
   Context shape (what ready()/refresh()/getContext() resolve to):
   {
     client,                 // the Supabase client
     user,                   // Supabase auth user object, or null
     authed:      Boolean,   // is anyone signed in
     scope:       'admin' | 'staff' | 'none',
     isAdmin:     Boolean,
     adminRole:   'owner' | 'accounts' | 'staff' | null,  // vp_platform_admins.role
     staff:       [ { venue_id, role, display_name } ],   // this user's vp_venue_staff rows
     currentVenueId: uuid | null,
     role:        'owner' | 'manager' | 'host' | 'admin' | null, // role AT currentVenueId ('admin' = admin view-as)
     venue:       VenueRow | null,       // full vp_venues row for currentVenueId
     settings:    SettingsRow | null     // full vp_venue_settings row for currentVenueId
   }

   VenueRow    = a row of public.vp_venues (id, name, slug, timezone,
                 status, founding_id, group_id, included_players,
                 logo_url, privacy_terms_accepted_at, created_at).
   SettingsRow = a row of public.vp_venue_settings (venue_id,
                 name_display, default_draw_length_seconds,
                 raffle_time_limit_seconds, screen_rotation_seconds,
                 auto_game_promos, updated_at, and — once migration 09 is
                 applied — collect_first_name, collect_last_name,
                 collect_postcode, collect_email, collect_mobile,
                 marketing_optin_default).
   ===================================================================== */
(function (root) {
  "use strict";

  // Same project + anon key every VenuePlay page already uses.
  var SUPA_URL  = "https://gpoolavkghnxedzrmtmc.supabase.co";
  var SUPA_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdwb29sYXZrZ2hueGVkenJtdG1jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcyMjM3MzcsImV4cCI6MjA5Mjc5OTczN30.5si7UoInmLJqkllXNnyVn9yBw_U9GhBARDZvgR_p0DE";

  var VENUE_KEY = "vpCurrentVenue";   // localStorage: last chosen venue id
  var SIGNIN    = "index.html";       // the sign-in shell (this folder)

  var _client  = null;   // the Supabase client singleton
  var _ctx     = null;   // last resolved Context
  var _ready   = null;   // in-flight ready() promise (dedupe)

  function emptyCtx(client) {
    return {
      client: client, user: null, authed: false, scope: "none",
      isAdmin: false, adminRole: null, staff: [],
      currentVenueId: null, role: null, venue: null, settings: null
    };
  }

  function getClient() {
    if (!_client) {
      if (!root.supabase || !root.supabase.createClient) {
        throw new Error("Supabase CDN script must load before vp-session.js");
      }
      _client = root.supabase.createClient(SUPA_URL, SUPA_ANON);
    }
    return _client;
  }

  // Adopt a client the page already created (so there is ONE auth session).
  function useClient(client) { if (client) _client = client; return _client; }

  function storedVenue() {
    try { return localStorage.getItem(VENUE_KEY) || null; } catch (e) { return null; }
  }
  function rememberVenue(id) {
    try { if (id) localStorage.setItem(VENUE_KEY, id); else localStorage.removeItem(VENUE_KEY); } catch (e) {}
  }

  // ---- role resolution ------------------------------------------------
  // Reads are RLS-safe: a non-admin reading vp_platform_admins simply gets
  // zero rows (not an error); a staff member reading vp_venue_staff gets
  // only their own venue's rows, which includes their own membership.
  function resolveRole(client, user) {
    var uid = user.id;
    return Promise.all([
      client.from("vp_platform_admins").select("role,label").eq("auth_user_id", uid).maybeSingle(),
      client.from("vp_venue_staff").select("venue_id,role,display_name").eq("auth_user_id", uid)
    ]).then(function (res) {
      var adminRow = (res[0] && res[0].data) || null;
      var staff    = (res[1] && res[1].data) || [];
      var isAdmin  = !!adminRow;
      return {
        isAdmin: isAdmin,
        adminRole: adminRow ? adminRow.role : null,
        staff: staff,
        scope: isAdmin ? "admin" : (staff.length ? "staff" : "none")
      };
    });
  }

  function loadVenue(client, id) {
    if (!id) return Promise.resolve(null);
    return client.from("vp_venues").select("*").eq("id", id).maybeSingle()
      .then(function (r) { return (r && r.data) || null; });
  }
  function loadSettings(id) {
    if (!id) return Promise.resolve(null);
    return getClient().from("vp_venue_settings").select("*").eq("venue_id", id).maybeSingle()
      .then(function (r) { return (r && r.data) || null; });
  }

  // Which role does this person hold at a given venue?
  function roleAtVenue(role, venueId) {
    if (role.isAdmin) {
      // admin who is ALSO staff there keeps the staff role; otherwise "admin" (view-as)
      for (var i = 0; i < role.staff.length; i++) {
        if (role.staff[i].venue_id === venueId) return role.staff[i].role;
      }
      return "admin";
    }
    for (var j = 0; j < role.staff.length; j++) {
      if (role.staff[j].venue_id === venueId) return role.staff[j].role;
    }
    return null;
  }

  // Choose the working venue: stored choice if the caller may use it,
  // else their first staff venue, else null (admin with no membership).
  function pickVenue(role) {
    var stored = storedVenue();
    var mine = role.staff.map(function (s) { return s.venue_id; });
    if (stored && (role.isAdmin || mine.indexOf(stored) >= 0)) return stored;
    if (mine.length) return mine[0];
    return null;   // admin picks a venue explicitly via setCurrentVenue()
  }

  function build() {
    var client = getClient();
    // getSession() reads the persisted session (instant, refreshes only if expired) instead of
    // getUser() which always hits the network. Routing/role only needs identity; every real
    // action still re-verifies the token at the Worker, so this is safe and much faster.
    return client.auth.getSession().then(function (r) {
      var user = (r && r.data && r.data.session && r.data.session.user) || null;
      if (!user) { _ctx = emptyCtx(client); return _ctx; }

      return resolveRole(client, user).then(function (role) {
        var venueId = pickVenue(role);
        return Promise.all([loadVenue(client, venueId), loadSettings(venueId)])
          .then(function (vs) {
            _ctx = {
              client: client, user: user, authed: true, scope: role.scope,
              isAdmin: role.isAdmin, adminRole: role.adminRole, staff: role.staff,
              currentVenueId: venueId, role: venueId ? roleAtVenue(role, venueId) : null,
              venue: vs[0], settings: vs[1]
            };
            if (venueId) rememberVenue(venueId);
            return _ctx;
          });
      });
    }).catch(function (err) {
      // Never leave the page wedged: fall back to a signed-out context.
      _ctx = emptyCtx(getClient());
      _ctx._error = err;
      return _ctx;
    });
  }

  function ready() { if (!_ready) _ready = build(); return _ready; }
  function refresh() { _ready = build(); return _ready; }
  function getContext() { return _ctx; }

  function setCurrentVenue(id) {
    return ready().then(function (ctx) {
      if (!ctx.authed) return ctx;
      var allowed = ctx.isAdmin || ctx.staff.some(function (s) { return s.venue_id === id; });
      if (!allowed) return ctx;
      rememberVenue(id);
      return Promise.all([loadVenue(getClient(), id), loadSettings(id)]).then(function (vs) {
        _ctx = Object.assign({}, ctx, {
          currentVenueId: id,
          role: (function () {
            for (var i = 0; i < ctx.staff.length; i++) { if (ctx.staff[i].venue_id === id) return ctx.staff[i].role; }
            return ctx.isAdmin ? "admin" : null;
          })(),
          venue: vs[0], settings: vs[1]
        });
        _ready = Promise.resolve(_ctx);
        return _ctx;
      });
    });
  }

  function listVenues() {
    // RLS scopes this: admins see all, staff see only their own venues.
    return getClient().from("vp_venues")
      .select("id,name,slug,timezone,status,founding_id,group_id,included_players,max_players,logo_url,created_at")
      .order("created_at", { ascending: false })
      .then(function (r) { return (r && r.data) || []; });
  }

  function saveSettings(id, patch) {
    var row = Object.assign({ venue_id: id }, patch, { updated_at: new Date().toISOString() });
    return getClient().from("vp_venue_settings").upsert(row, { onConflict: "venue_id" })
      .select().maybeSingle()
      .then(function (r) {
        if (r && r.error) throw r.error;
        return (r && r.data) || null;
      });
  }

  function homeHref(ctx) {
    ctx = ctx || _ctx || {};
    if (ctx.isAdmin) return "hq.html";
    if (ctx.scope === "staff") return "index.html";
    return "index.html";
  }

  function signOut() {
    rememberVenue(null);
    return getClient().auth.signOut().then(function () {
      _ctx = null; _ready = null;
      root.location.href = SIGNIN;
    });
  }

  function requireAuth(opts) {
    opts = opts || {};
    return ready().then(function (ctx) {
      if (!ctx.authed) { root.location.href = SIGNIN; return new Promise(function () {}); }
      if (opts.venue && !ctx.currentVenueId) { root.location.href = homeHref(ctx); return new Promise(function () {}); }
      if (opts.roles && opts.roles.length) {
        var ok = ctx.isAdmin || (ctx.role && opts.roles.indexOf(ctx.role) >= 0);
        if (!ok) { root.location.href = homeHref(ctx); return new Promise(function () {}); }
      }
      return ctx;
    });
  }

  // Deterministic 6-char code from a venue slug. The host and the TV both compute this from
  // the same venue, so they land on the same channel with NO pairing step. It doubles as the
  // players' join code (shown on the TV). Alphabet excludes ambiguous characters and matches
  // the host pair-input filter. NOTE: tv.html inlines an identical copy (it does not load VP);
  // keep the two in lockstep.
  function venueCode(slug) {
    // Strip to [a-z0-9] so the host and the TV always feed venueCode the SAME string, no matter
    // how the slug is punctuated (the TV pre-sanitises differently). Then hash to 6 chars.
    var s = String(slug || "").toLowerCase().replace(/[^a-z0-9]/g, ""), h = 2166136261 >>> 0;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    var A = "ACDEFGHJKMNPQRSTUVWXYZ2345679", out = "", x = h || 1;
    for (var j = 0; j < 6; j++) { x = (Math.imul(x, 1103515245) + 12345) >>> 0; out += A[x % A.length]; }
    return out;
  }

  /* ---- the night, and the shift ------------------------------------------
     Two things used to live ONLY in app/index.html, and so only ever happened
     if the host walked back to /app and signed out there:

       1. POST /session/close. That is what marks the night finished AND bills
          any overage the host approved. Trivia, musical bingo and raffle all
          OPEN a session; none of them could close one. A host who ran the quiz
          and shut the tablet left the night open forever: the approved overage
          was never charged and the venue read "live" in HQ indefinitely.

       2. The 4 hour forced sign-out. That timeout is a COMPLIANCE control -- the
          venue's opt-in player details sit behind this login -- so a tablet
          parked on the trivia console must not stay signed in for days.

     They live here now so every console gets both. Note the plural: a venue that
     runs trivia AND musical on the same night has TWO open sessions, and the old
     single "vpOpenSession" key silently overwrote the first, leaving it unclosable.
     ------------------------------------------------------------------------ */
  var GAME_API   = "https://venueplay-game.dean-tindale.workers.dev";
  var OPEN_KEY   = "vpOpenSessions";   // JSON array of {id, venue}
  var LEGACY_KEY = "vpOpenSession";    // the old single-object key; still drained so nothing is orphaned
  var SHIFT_KEY  = "vpShiftStart";
  var SHIFT_MAX  = 4 * 3600 * 1000;

  function readOpenSessions() {
    var out = [], seen = {};
    function add(r) { if (r && r.id && !seen[r.id]) { seen[r.id] = true; out.push(r); } }
    try { var a = JSON.parse(localStorage.getItem(OPEN_KEY) || "[]"); if (Array.isArray(a)) a.forEach(add); } catch (e) {}
    try { add(JSON.parse(localStorage.getItem(LEGACY_KEY) || "null")); } catch (e) {}
    return out;
  }
  // Called when a console opens a night. Idempotent per session id.
  function noteOpenSession(id, venueId) {
    if (!id) return;
    var list = readOpenSessions();
    for (var i = 0; i < list.length; i++) { if (list[i].id === id) return; }
    list.push({ id: id, venue: venueId || null });
    try { localStorage.setItem(OPEN_KEY, JSON.stringify(list.slice(-10))); } catch (e) {}
  }
  // Close every night this device has open. Safe to call more than once: the Worker
  // no-ops on an already-closed session and Stripe gets an idempotency key per session,
  // so a night can never be billed twice.
  function closeOpenSessions() {
    var list = readOpenSessions();
    try { localStorage.removeItem(OPEN_KEY); localStorage.removeItem(LEGACY_KEY); } catch (e) {}
    if (!list.length) return Promise.resolve(0);
    // getClient() THROWS if the Supabase CDN script has not loaded. This runs on the way out of the
    // app (sign-out, shift timeout), so it must never throw back into the caller and stop the
    // sign-out itself from happening.
    var c; try { c = getClient(); } catch (e) { return Promise.resolve(0); }
    return c.auth.getSession().then(function (r) {
      var tok = (r && r.data && r.data.session && r.data.session.access_token) || "";
      if (!tok) return 0;
      return Promise.all(list.map(function (rec) {
        // keepalive so the request still goes out if the page is closing behind it
        return fetch(GAME_API + "/session/close", {
          method: "POST", keepalive: true,
          headers: { "Content-Type": "application/json", "Authorization": "Bearer " + tok },
          body: JSON.stringify({ session_id: rec.id })
        }).catch(function () {});
      })).then(function () { return list.length; });
    }).catch(function () { return 0; });
  }

  var _shiftTimer = null;
  function endShift() {
    var p = closeOpenSessions();
    try { localStorage.removeItem(SHIFT_KEY); } catch (e) {}
    if (_shiftTimer) { clearTimeout(_shiftTimer); _shiftTimer = null; }
    return p;
  }
  // Arm (or re-arm) the forced sign-out. The start time lives in localStorage, so it is the
  // SAME shift across every console and survives reloads: hopping /app -> trivia -> raffle
  // does not hand anyone a fresh 4 hours.
  function enforceShift() {
    var now = Date.now(), start = 0;
    try { start = parseInt(localStorage.getItem(SHIFT_KEY), 10) || 0; } catch (e) {}
    function out() { endShift(); signOut(); }
    if (start && (now - start) > SHIFT_MAX) { out(); return; }
    if (!start) { start = now; try { localStorage.setItem(SHIFT_KEY, String(start)); } catch (e) {} }
    if (_shiftTimer) clearTimeout(_shiftTimer);
    _shiftTimer = setTimeout(out, Math.max(1000, SHIFT_MAX - (now - start)));
  }

  root.VP = {
    getClient: getClient,
    useClient: useClient,
    ready: ready,
    refresh: refresh,
    getContext: getContext,
    setCurrentVenue: setCurrentVenue,
    listVenues: listVenues,
    loadSettings: loadSettings,
    saveSettings: saveSettings,
    requireAuth: requireAuth,
    signOut: signOut,
    homeHref: homeHref,
    venueCode: venueCode,
    noteOpenSession: noteOpenSession,
    closeOpenSessions: closeOpenSessions,
    enforceShift: enforceShift,
    endShift: endShift
  };
})(window);
