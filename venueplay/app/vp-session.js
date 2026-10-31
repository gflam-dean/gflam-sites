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
  var SUPA_URL  = "https://ijkzgmdtwtgfkedqspxm.supabase.co";
  var SUPA_ANON = "sb_publishable_9v83FWCSt7Di-jkgTvsMJQ_f6lJPovb";

  var VENUE_KEY = "vpCurrentVenue";   // localStorage: last chosen venue id
  /* An EXPLICIT choice, kept for the tab only. hq.html "View as" stores a venue id and
     then NAVIGATES to index.html, so by the time build() runs, a deliberate choice looks
     exactly like a remembered one. Without this marker the archived guard below threw the
     admin's own choice away and bounced them back to HQ with no message. sessionStorage,
     not local: the choice should last as long as the tab and no longer. */
  var EXPLICIT_KEY = "vpVenueExplicit";
  /* ABSOLUTE, NOT "index.html". This file is loaded by the game consoles too, and they live one
     folder down (/app/musical/, /app/trivia/, ...). From there "index.html" is /app/musical/index.html,
     which does not exist, and a missing page on this site answers with the MARKETING HOMEPAGE. So a
     host whose login ran out mid-night was dropped on the sales site (found 30 Sep 2026). */
  var SIGNIN    = "/app/";            // the sign-in shell

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
  function explicitVenue() {
    try { return sessionStorage.getItem(EXPLICIT_KEY) || null; } catch (e) { return null; }
  }
  function markExplicit(id) {
    try { if (id) sessionStorage.setItem(EXPLICIT_KEY, id); else sessionStorage.removeItem(EXPLICIT_KEY); } catch (e) {}
  }

  // ---- role resolution ------------------------------------------------
  // Reads are RLS-safe: a non-admin reading vp_platform_admins simply gets
  // zero rows (not an error); a staff member reading vp_venue_staff gets
  // only their own venue's rows, which includes their own membership.
  function resolveRole(client, user) {
    var uid = user.id;
    /* The THIRD read is why this function changed on 18 Sep. pickVenue() used to have
       nothing but venue ids, so it could not tell a live venue from one somebody had
       switched off, and it returned staff[0] with no status test at all. vp_venue_staff
       comes back UNORDERED, so a host whose archived venue happened to sit first landed
       straight back on it: same user, same data, different outcome depending on Postgres
       row order, which is why it read as intermittent. One extra read buys the status of
       every venue they belong to, and removes the second round trip the old guard needed. */
    return Promise.all([
      client.from("vp_platform_admins").select("role,label").eq("auth_user_id", uid).maybeSingle(),
      client.from("vp_venue_staff").select("venue_id,role,display_name").eq("auth_user_id", uid)
    ]).then(function (res) {
      var rows = (res[1] && res[1].data) || [];
      var ids = rows.map(function (r) { return r.venue_id; }).filter(Boolean);
      if (!ids.length) return [res[0], res[1], {}];
      return client.from("vp_venues").select("id,status,suspended_reason").in("id", ids)
        .then(function (vr) {
          var map = {};
          ((vr && vr.data) || []).forEach(function (v) { map[v.id] = v; });
          return [res[0], res[1], map];
        })
        // A venue-status read that fails must not cost the host their session. Fall back
        // to knowing nothing, which behaves exactly as this did before the third read.
        .catch(function () { return [res[0], res[1], {}]; });
    }).then(function (res) {
      var adminRow = (res[0] && res[0].data) || null;
      var staff    = (res[1] && res[1].data) || [];
      var isAdmin  = !!adminRow;
      return {
        isAdmin: isAdmin,
        adminRole: adminRow ? adminRow.role : null,
        staff: staff,
        venueState: res[2] || {},
        scope: isAdmin ? "admin" : (staff.length ? "staff" : "none")
      };
    });
  }

  /* THE CODE A PERSON USES, from the venue record.
     venueCode(slug) below is the BROADCAST CHANNEL: derived on purpose so a
     console and a TV meet with no round trip, never shown to anybody, and not
     secret either since the algorithm sits in public page JavaScript. The code a
     host reads off the iPad and a player types is issued once per venue and
     stored, so it is unique by constraint and stays put on a table talker.
     Falls back to the derived value when migration 68 has not run, which is what
     every venue trading today already has. */
  function venueJoinCode(id) {
    var ctx = getContext();
    var vid = id || (ctx && ctx.currentVenueId);
    if (!vid) return Promise.resolve(null);
    return getClient().from("vp_venues").select("join_code,slug").eq("id", vid).maybeSingle()
      .then(function (r) {
        var v = (r && r.data) || null;
        if (!v) return null;
        return v.join_code || (v.slug ? venueCode(v.slug) : null);
      })
      .catch(function () { return null; });
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

  /* An ARCHIVED venue is not a fault, it is a venue somebody switched off on purpose.
     It still reads status === 'suspended', so every check that only looks at status treats
     it as a problem and says so to the host. Reason is what separates the two. */
  function isArchived(v) {
    return !!(v && v.status === 'suspended' &&
              typeof v.suspended_reason === 'string' &&
              v.suspended_reason.indexOf('archived') === 0);
  }

  // Is THIS id one we know to be archived? Unknown is never treated as archived: an
  // admin viewing a venue they are not staff at has no row in the map, and guessing
  // would throw away their choice.
  function archivedId(role, id) {
    var v = id && role && role.venueState ? role.venueState[id] : null;
    return !!(v && isArchived(v));
  }

  /* Choose the working venue.
     Order of preference: the stored choice if the caller may use it AND it is not a
     venue somebody switched off, then the first of their venues that is not archived,
     then the stored one anyway, then their first venue, then null.

     Keeping a LONE archived venue is deliberate. Swapping a host's only venue for
     nothing is worse than showing them the banner, which now says "archived" and tells
     them how to bring it back. */
  function pickVenue(role, allowArchived) {
    var stored = storedVenue();
    var mine = role.staff.map(function (s) { return s.venue_id; });
    var mayUseStored = !!(stored && (role.isAdmin || mine.indexOf(stored) >= 0));

    if (mayUseStored && (allowArchived || !archivedId(role, stored))) return stored;

    for (var i = 0; i < mine.length; i++) {
      if (!archivedId(role, mine[i])) return mine[i];
    }
    if (mayUseStored) return stored;
    if (mine.length) return mine[0];
    return null;   // admin picks a venue explicitly via setCurrentVenue()
  }

  /* THE CDN CAN FAIL, AND IT MUST NOT KILL THE CONSOLE SILENTLY.
     getClient() throws synchronously when cdn.jsdelivr.net has not delivered supabase-js, and
     build() used to call it at the top, OUTSIDE any promise. So the throw escaped before a promise
     existed and every .catch() on every console never ran: the host sat on the boot splash
     forever with no error, no retry and nothing to tell them why, then reloaded into the same
     thing and rang Dean mid-service. tv.html has retried this for a while; the consoles never got
     the same treatment.
     Two parts: a rejected promise instead of a throw, so the existing .catch() handlers finally
     do their job, and a visible message with a retry, because a blocked CDN on pub wifi does not
     fix itself and a host needs to be told what is happening. */
  function cdnDown() {
    try {
      if (document.getElementById('vpCdnDown')) return;
      var d = document.createElement('div');
      d.id = 'vpCdnDown';
      d.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#0A0A0B;color:#E7E7EC;' +
        'display:flex;align-items:center;justify-content:center;padding:24px;text-align:center;' +
        'font-family:-apple-system,Segoe UI,sans-serif';
      d.innerHTML = '<div style="max-width:420px">' +
        '<p style="margin:0 0 10px;font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#FF1F8E;font-weight:800">Cannot start</p>' +
        '<h1 style="margin:0 0 12px;font-size:22px;line-height:1.25">VenuePlay could not finish loading</h1>' +
        '<p style="margin:0 0 16px;font-size:14.5px;line-height:1.5;color:#9A9AA4">Part of the app is served from the internet and it did not arrive. This is almost always the venue wifi, or a network that blocks it. Your game and your players are fine.</p>' +
        '<button id="vpCdnRetry" style="font:inherit;font-size:15px;font-weight:700;background:#FF1F8E;color:#fff;border:0;border-radius:10px;padding:12px 24px;cursor:pointer">Try again</button>' +
        '<p style="margin:14px 0 0;font-size:12.5px;color:#8A8A94">Still stuck? Use your phone hotspot, or call us on the number in your welcome email.</p>' +
        '</div>';
      document.body.appendChild(d);
      var b = document.getElementById('vpCdnRetry');
      if (b) b.addEventListener('click', function () { location.reload(); });
    } catch (e) {}
  }

  /* THE ADDRESS NAMES THE VENUE; THE CONSOLE MUST NOT QUIETLY RUN SOMEWHERE ELSE.
     Every console link carries ?venue= (the bingo console builds /app/<game>/host.html?venue=<slug>,
     HQ and billing link settings.html?venue=<id>), and nothing read it: the venue came only from the
     choice this browser last saved, which every tab shares. On 27 Sep 2026 a trivia console at
     ?venue=test-alpha opened a live lobby at Karina Bay Surf Club, a real venue, because another tab
     had switched to it. Console pages only: a TV or phone page on the same laptop must not move the
     host's console. A uuid or a slug is accepted; a venue this login may not use is REPORTED, never
     silently swapped for another one. */
  var CONSOLE_PATH = /\/app\/(?:(?:index|settings|billing|account)|(?:trivia|musical|raffle|members)\/host|trivia\/builder)?(?:\.html)?$/;
  var UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  function urlVenueParam() {
    try {
      if (!CONSOLE_PATH.test(root.location.pathname || "")) return "";
      var m = /[?&]venue=([^&#]+)/i.exec(root.location.search || "");
      /* The short form, /app/musical/host?test-charlie, is what the TV and the phones accept
         (vp-venueurl.js), and the consoles read only venue=: the musical console quietly ran at
         ANOTHER venue on the short link, no banner (break test, 14 Oct 2026). The first bare part
         that is not a setting, same rule as vp-venueurl.js. */
      if (!m) {
        var SETTINGS = { demo: 1, unified: 1, roomserver: 1, probe: 1, v: 1, t: 1, ads: 1, logo: 1,
                         tv: 1, room: 1, code: 1, from: 1, mode: 1, pr: 1, gm: 1 };
        var parts = String(root.location.search || "").replace(/^\?/, "").split("&");
        for (var i = 0; i < parts.length && !m; i++) {
          var p = parts[i]; if (p.charAt(0) === "=") p = p.slice(1);
          if (p && p.indexOf("=") < 0 && !SETTINGS[p.toLowerCase()]) m = [p, p];
        }
      }
      if (!m) return "";
      var raw = m[1]; try { raw = decodeURIComponent(raw); } catch (e) {}
      raw = String(raw).trim();
      return UUID_RX.test(raw) ? raw.toLowerCase() : raw.toLowerCase().replace(/[\s_]+/g, "-").replace(/[^a-z0-9-]/g, "");
    } catch (e) { return ""; }
  }
  function resolveUrlVenue(client, want) {
    if (!want) return Promise.resolve(null);
    var q = client.from("vp_venues").select("id,name,slug");
    q = UUID_RX.test(want) ? q.eq("id", want) : q.eq("slug", want);
    return q.maybeSingle().then(function (r) { return (r && r.data) || null; }, function () { return null; });
  }
  function urlVenueBanner(asked, workingName) {
    try {
      if (document.getElementById("vpUrlVenue")) return;
      var d = document.createElement("div");
      d.id = "vpUrlVenue";
      d.style.cssText = "background:#2A0B14;color:#fff;" +
        "border-bottom:2px solid #FF4D5E;padding:12px 16px;font:600 14px/1.4 -apple-system,Segoe UI,sans-serif;text-align:center";
      d.textContent = "This link is for " + asked + ", which this login cannot run. You are working at " +
        (workingName || "your own venue") + ". Anything you start here happens at " + (workingName || "your venue") + ".";
      var x = document.createElement("button");
      x.textContent = "OK";
      x.style.cssText = "margin-left:12px;font:inherit;background:#FF1F8E;color:#fff;border:0;border-radius:8px;padding:6px 14px;cursor:pointer";
      x.addEventListener("click", function () { statusBar("link", null); });
      d.appendChild(x);
      statusBar("link", d);   // in the one status area, under the others, never over the header (28 Oct 2026)
    } catch (e) {}
  }

  function build() {
    var client;
    try {
      client = getClient();
    } catch (e) {
      cdnDown();
      return Promise.reject(e);   // a REJECTION, so the caller's .catch() can run
    }
    // getSession() reads the persisted session (instant, refreshes only if expired) instead of
    // getUser() which always hits the network. Routing/role only needs identity; every real
    // action still re-verifies the token at the Worker, so this is safe and much faster.
    return client.auth.getSession().then(function (r) {
      var user = (r && r.data && r.data.session && r.data.session.user) || null;
      if (!user) { _ctx = emptyCtx(client); return _ctx; }

      return resolveRole(client, user).then(function (role) {
        /* An explicit choice wins, even when it is archived. Anything else prefers a
           venue that is not switched off. This replaced a guard that assembled the
           archived venue, cleared storage and re-picked: that cost two extra round
           trips, could only ever re-pick staff[0] (unordered, often the same archived
           venue), and turned HQ "View as" into a bounce back to HQ because a stored-then-
           navigated choice is indistinguishable from a restore. */
        var chosen = explicitVenue();
        var venueId = pickVenue(role, !!(chosen && chosen === storedVenue()));
        var asked = urlVenueParam();

        function assemble(id) {
          return Promise.all([loadVenue(client, id), loadSettings(id)])
            .then(function (vs) {
              _ctx = {
                client: client, user: user, authed: true, scope: role.scope,
                isAdmin: role.isAdmin, adminRole: role.adminRole, staff: role.staff,
                currentVenueId: id, role: id ? roleAtVenue(role, id) : null,
                venue: vs[0], settings: vs[1]
              };
              if (id) rememberVenue(id);
              return _ctx;
            });
        }

        if (!asked) return assemble(venueId);
        return resolveUrlVenue(client, asked).then(function (v) {
          var mine = role.staff.map(function (st) { return st.venue_id; });
          var may = !!(v && (role.isAdmin || mine.indexOf(v.id) >= 0));
          if (may) {
            if (v.id !== venueId) { markExplicit(v.id); }   // the link's venue, exactly as if picked
            return assemble(v.id);
          }
          return assemble(venueId).then(function (ctx) {
            ctx.urlVenueRefused = asked;
            urlVenueBanner(asked, ctx.venue && ctx.venue.name);
            return ctx;
          });
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

  /* HOW MANY PHONES HAVE ACTUALLY SCANNED IN, ASKED OF THE SERVER.

     A console only knows the players it personally heard announce themselves on its own
     broadcast channel. For trivia that is nobody until the round starts, because a phone
     that types the code sits on /play holding "YOU'RE IN" and does not reach the trivia
     page, or the trivia channel, until the host taps Start. On 11 Sep 2026 a phone joined
     a trivia lobby, the phone said it was in, and the host console said PLAYERS (0) for as
     long as anyone cared to watch. A host with a full room reads that as nobody turned up.

     GET /snapshot is public, already used by four consoles to recover themselves, and
     returns player_count: vp_players for the session, deduped by device id, which is the
     same figure the night is billed on.

     Resolves to null on anything going wrong, never rejects, so a caller can only ever
     end up showing nothing extra. app/index.html keeps its own serverPlayerCount: that one
     is the number printed on the end-of-night card as the billed figure, and it should not
     share a fate with a lobby hint.  */
  function sessionPlayerCount(apiBase, sessionId) {
    if (!apiBase || !sessionId) return Promise.resolve(null);
    var ctrl = (typeof AbortController === "function") ? new AbortController() : null;
    var timer = root.setTimeout(function () { if (ctrl) ctrl.abort(); }, 6000);
    return root.fetch(apiBase + "/snapshot?session=" + encodeURIComponent(sessionId),
                      { signal: ctrl ? ctrl.signal : undefined })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        root.clearTimeout(timer);
        var n = j && j.player_count;
        return (typeof n === "number" && isFinite(n) && n >= 0) ? n : null;
      })
      .catch(function () { root.clearTimeout(timer); return null; });
  }

  function setCurrentVenue(id) {
    return ready().then(function (ctx) {
      if (!ctx.authed) return ctx;
      var allowed = ctx.isAdmin || ctx.staff.some(function (s) { return s.venue_id === id; });
      if (!allowed) return ctx;
      rememberVenue(id);
      markExplicit(id);   // survives the navigation hq.html does straight after this
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
    //
    // NEVER name a column here that has not been migrated into the live database. PostgREST
    // rejects the WHOLE select with a 400 if one column is missing, so a single un-migrated
    // name empties the HQ venue list and the console's venue picker at the same time. That is
    // exactly what entity_type/paid_entry_enabled did: the code shipped ahead of migration 44,
    // and both were pulled back off this line until the migration was actually run. It has been
    // (19 Aug 2026), and tools/check-schema.py now verifies every name here against the live
    // database, so run that before adding to this list.
    /* PostgREST stops at 1000 rows on this project, SILENTLY. This is the venue list
       behind HQ and behind the venue picker on every console, so at a thousand venues
       HQ would simply stop showing the ones past it, with no error. That is not a new
       fault, it is the one sbGetAll's header already describes: the venue-code map read
       the first page, every venue after it resolved to nothing, and their screens said
       "not linked to an account" while the join codes silently failed.

       It does NOT page unconditionally. This runs on every console boot, and a loop that
       only stops on an empty page would cost a second round trip every time, for every
       host, for ever, to guard something a thousand venues away. This project's wall is
       about fifty REST calls a second and what counts is CALLS, not rows.

       IT ALSO DOES NOT GUESS THE CEILING. The first version asked for one row MORE than
       1000 and treated a short answer as the end. That cannot work, and the first run of
       tools/test-venue-list-paged.js said so: PostgREST's own max-rows caps the response
       at 1000, so the 1001st row can never arrive and "short" is indistinguishable from
       "finished". It is the same short-page trap written on sbGetAll, arriving through
       the door marked clever.

       So ASK THE DATABASE. count:'exact' returns the true total in the SAME request, so
       one call answers both "here are the rows" and "is that all of them". No guessing,
       and no cost to the common case. */
    var COLS = "id,name,slug,timezone,status,suspended_reason,founding_id,group_id," +
               "included_players,max_players,logo_url,created_at,postcode,au_state," +
               "entity_type,paid_entry_enabled";
    /* Migration 100 (15 Oct 2026): what the venue said it is, when it accepted the compliance
       line, and the permits it has recorded. Anisimoff Legal 9380, 1 Oct 2026, points 3 and 5.
       HQ reads them off this list; the console reads them off the full venue row (loadVenue
       selects *). Named SEPARATELY so that if this select is ever served by a database the
       migration has not reached, the page below retries without them rather than emptying
       the venue list, which is exactly what entity_type did on 19 Aug 2026. */
    var COLS_100 = "permits,venue_kind,compliance_accepted_at";
    var PAGE = 1000;
    var cols100 = true;

    function page(from, to, withCount) {
      var q = getClient().from("vp_venues")
        .select(cols100 ? (COLS + "," + COLS_100) : COLS, withCount ? { count: "exact" } : undefined)
        /* created_at alone is not a stable order: two venues created in the same
           millisecond can swap between pages, repeating one and skipping the other.
           id breaks the tie. */
        .order("created_at", { ascending: false }).order("id", { ascending: false })
        .range(from, to);
      return q.then(function (r) {
        // Do not swallow the failure. Returning [] on an error is indistinguishable from
        // "this venue has no venues", so a broken query looked like an empty account for
        // however long it took someone to notice. Let the caller show the real reason.
        if (r && r.error) {
          /* One retry, without the migration-100 columns, when PostgREST names one of them
             as unknown. Anything else is still thrown: this is a narrow bridge for the
             minutes between a site deploy and the migration, not a way to hide a fault. */
          var msg = String((r.error && r.error.message) || "");
          if (cols100 && /column/i.test(msg) && /permits|venue_kind|compliance_accepted_at/.test(msg)) {
            cols100 = false;
            try { console.warn("vp-session: migration 100 has not reached this database yet; venue list read without " + COLS_100); } catch (e) {}
            return page(from, to, withCount);
          }
          throw r.error;
        }
        return { rows: (r && r.data) || [], total: r ? r.count : null };
      });
    }

    return page(0, PAGE - 1, true).then(function (first) {
      var out = first.rows, total = first.total;
      // No count came back, or we already hold all of them: one call and done.
      if (total == null || out.length >= total) return out;
      function more() {
        return page(out.length, out.length + PAGE - 1, false).then(function (r) {
          if (!r.rows.length) return out;            // empty page, never a short one
          out = out.concat(r.rows);
          if (out.length >= total) return out;
          if (out.length > 200000) throw new Error("venue list did not end at " + out.length);
          return more();
        });
      }
      return more();
    });
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
    if (ctx.isAdmin) return "/app/hq.html";
    /* Marketing ONLY. Somebody who is a host at one venue and the marketing login at another
       still has games to run, so they keep the console and reach their numbers from a link. */
    var st = ctx.staff || [];
    if (ctx.scope === "staff" && st.length && st.every(function (x) { return x.role === "marketing"; })) return "/app/marketing.html";
    if (ctx.scope === "staff") return "/app/";
    return "/app/";
  }

  function signOut() {
    rememberVenue(null);
    // Must ALWAYS end up at the sign-in screen. Without the catch, a sign-out that rejected left
    // the host sitting on the page still authenticated while the shift clock had already been
    // cleared, so the next page load handed them a fresh 4 hours: the control reset itself.
    // getClient() can also throw outright if the Supabase script never loaded.
    function bail() { _ctx = null; _ready = null; root.location.href = SIGNIN; }
    try {
      return getClient().auth.signOut().then(bail, bail);
    } catch (e) { bail(); return Promise.resolve(); }
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
  var GAME_API   = "https://game.venueplay.com.au";
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
  function writeOpenSessions(list) {
    // Keep the OLDEST on overflow: an old id is the one most likely to still be open and unbilled.
    try {
      if (list.length) localStorage.setItem(OPEN_KEY, JSON.stringify(list.slice(0, 10)));
      else localStorage.removeItem(OPEN_KEY);
      localStorage.removeItem(LEGACY_KEY);
    } catch (e) {}
  }
  function currentUid() {
    var c = _ctx && _ctx.user && _ctx.user.id;
    return c || null;
  }
  // Called when a console opens a night. Idempotent per session id.
  function noteOpenSession(id, venueId) {
    if (!id) return;
    var list = readOpenSessions();
    for (var i = 0; i < list.length; i++) { if (list[i].id === id) { list[i].closing = false; writeOpenSessions(list); return; } }
    // uid so a shared bar tablet does not try to close the previous host's night with the
    // current host's token (the Worker correctly refuses, and the id would be lost doing it).
    list.push({ id: id, venue: venueId || null, uid: currentUid(), closing: false });
    writeOpenSessions(list);
  }

  // Close the nights THIS user opened on this device.
  //
  // The ordering here is the whole point. The first version cleared the stored ids and then fired
  // the requests, so one flaky moment of pub wifi at sign-out meant a night stayed open forever
  // and its host-approved overage was never charged, with nobody told. Nothing else in the product
  // calls /session/close and there is no server-side sweeper, so a lost id is lost permanently.
  // Now: POST first, and only drop an id when the server has actually answered. A network failure
  // leaves it stored and flagged, and retryPendingCloses() picks it up on the next page load.
  //
  // Safe to call more than once: the Worker no-ops on an already-closed session and Stripe gets an
  // idempotency key per session, so a night can never be billed twice.
  function closeOpenSessions(onlyPending) {
    var all = readOpenSessions();
    if (!all.length) return Promise.resolve(0);
    // getClient() THROWS if the Supabase CDN script has not loaded. This runs on the way out of
    // the app, so it must never throw back into the caller and stop the sign-out happening.
    var c; try { c = getClient(); } catch (e) { return Promise.resolve(0); }
    return c.auth.getSession().then(function (r) {
      var sess = r && r.data && r.data.session;
      var tok = (sess && sess.access_token) || "";
      var uid = (sess && sess.user && sess.user.id) || null;
      if (!tok) return 0;   // no token: keep everything stored and try again later
      var mine = [], keep = [];
      all.forEach(function (rec) {
        var ours = !rec.uid || !uid || rec.uid === uid;
        if (ours && (!onlyPending || rec.closing)) mine.push(rec); else keep.push(rec);
      });
      if (!mine.length) return 0;
      return Promise.all(mine.map(function (rec) {
        // keepalive so the request still goes out if the page is closing behind it
        return fetch(GAME_API + "/session/close", {
          method: "POST", keepalive: true,
          headers: { "Content-Type": "application/json", "Authorization": "Bearer " + tok },
          body: JSON.stringify({ session_id: rec.id })
        }).then(function (res) {
          // Any answer below 500 is final: closed, already closed, or refused. Only a network
          // failure or a server error is worth keeping, because only those can succeed later.
          if (res && res.status >= 500) { rec.closing = true; return rec; }
          return null;
        }).catch(function () { rec.closing = true; return rec; });
      })).then(function (results) {
        var failed = results.filter(Boolean);
        writeOpenSessions(keep.concat(failed));
        return mine.length - failed.length;
      });
    }).catch(function () { return 0; });
  }
  /* CLOSE THIS NIGHT NOW, WHEN THE HOST SAYS THEY ARE DONE (live audit, 19 Oct 2026).
     Close lobby, End game and End game / back to ads left the session open: only bingo's End game
     closed it. HQ read the venue as live, phones saw a live game, and the next format opened on
     the SAME tablet was asked about "a game already open at this venue on another device".
     The id is flagged `closing` first, so a close lost to the wifi is retried by
     retryPendingCloses() on the next load, exactly as a sign-out's would be. Resolves the number
     closed. "New game" and the next round never call this: they reuse the session. */
  function closeSession(id) {
    if (!id) return Promise.resolve(0);
    var list = readOpenSessions(), found = false;
    for (var i = 0; i < list.length; i++) { if (list[i].id === id) { list[i].closing = true; found = true; } }
    if (!found) list.push({ id: id, venue: null, uid: currentUid(), closing: true });
    writeOpenSessions(list);
    return closeOpenSessions(true);
  }
  // Drain closes that failed earlier. Only touches records already flagged `closing`, so a night
  // the host is still running is never closed out from under them.
  function retryPendingCloses() {
    var list = readOpenSessions();
    for (var i = 0; i < list.length; i++) { if (list[i].closing) return closeOpenSessions(true); }
    return Promise.resolve(0);
  }

  // A console tells us when it has a game actually running, via VP.setGameActive(fn). Closing a
  // session is what ENDS a night: it marks every running game finished and burns the once-a-week
  // slot for trivia and musical bingo. Doing that on the way out of a shift killed live nights.
  // The sign-out itself still happens on time (it is the compliance control protecting opt-in
  // player data); only the session close is held back, so the host can sign straight back in and
  // pick the same night up where it was.
  var _gameActive = null;
  function setGameActive(fn) { _gameActive = (typeof fn === 'function') ? fn : null; }
  function gameIsLive() { try { return !!(_gameActive && _gameActive()); } catch (e) { return false; } }

  var _shiftIv = null;
  function endShift() {
    if (_shiftIv) { clearInterval(_shiftIv); _shiftIv = null; }
    // Leave a live night open. The record stays in localStorage, so the night is still closed and
    // any approved overage still billed, either when the game ends or at the next sign-out.
    var p = gameIsLive() ? Promise.resolve(0) : closeOpenSessions();
    try { localStorage.removeItem(SHIFT_KEY); } catch (e) {}
    return p;
  }
  // The forced 4 hour sign-out. The deadline lives in localStorage so it is ONE shift across every
  // console: hopping /app -> trivia -> raffle does not hand anyone a fresh 4 hours.
  //
  // Deliberately an interval that re-reads the deadline every tick, not a single long setTimeout.
  // A 4 hour timeout is frozen at page load, so a console left open in a background tab would
  // still fire against the OLD deadline: it signed out whoever happened to be using the app at
  // that moment, which after a handover is the NEXT host, mid-game. Re-reading also means tab
  // sleep just delays the check instead of skipping it.
  function enforceShift() {
    var start = 0;
    try { start = parseInt(localStorage.getItem(SHIFT_KEY), 10) || 0; } catch (e) {}
    if (!start) { start = Date.now(); try { localStorage.setItem(SHIFT_KEY, String(start)); } catch (e) {} }
    if (_shiftIv) clearInterval(_shiftIv);
    _shiftIv = setInterval(checkShift, 30000);
    checkShift();
    /* Drain any close that failed earlier. retryPendingCloses() was written for exactly this and
       its own comment says it "picks it up on the next page load", but nothing ever called it:
       it was exported and left unused, so a night whose close was lost to a wifi blip sat unbilled
       until somebody happened to sign out on that same device. Calling it here covers all five
       consoles, since every one of them calls enforceShift() after sign-in. It only touches
       records already flagged `closing`, so a night in progress is never closed out from under
       the host. */
    try { retryPendingCloses(); } catch (e) {}
  }
  function checkShift() {
    var start = 0;
    try { start = parseInt(localStorage.getItem(SHIFT_KEY), 10) || 0; } catch (e) {}
    if (!start) return;                                   // signed out elsewhere; nothing to enforce
    if (start > Date.now()) {                             // clock skew or a tampered value
      try { localStorage.setItem(SHIFT_KEY, String(Date.now())); } catch (e) {}
      return;
    }
    if ((Date.now() - start) <= SHIFT_MAX) return;
    if (_shiftIv) { clearInterval(_shiftIv); _shiftIv = null; }
    // Close the night BEFORE signing out. signOut() clears the local session, and after a 4 hour
    // shift the access token has expired, so getSession() has to hit the network to refresh it:
    // the old fire-and-forget pair lost that race almost every time, which is precisely when a
    // night most needed billing. Capped, so a dead network can never leave a host signed in.
    var done = false;
    function finish() {
      if (done) return; done = true;
      try { localStorage.removeItem(SHIFT_KEY); } catch (e) {}
      signOut();
    }
    // Mid-game: sign out on time, but do NOT close the session. Closing it finished every running
    // game and burned the once-a-week slot, so the host signed back in to "your next trivia night
    // is available in 7 days" with the room still seated and no way to clear it. Left open, the
    // session is still live, so signing back in restores the same night and the same slot.
    if (gameIsLive()) { finish(); return; }
    // A page with no game on it (billing, settings, HQ...) only signs out. It cannot know whether
    // a console in another tab of this same tablet is mid-night, and closing from here would end
    // that night under the room. The console's own clock closes it, or the 3am sweep does.
    if (_shiftSignOutOnly) { finish(); return; }
    setTimeout(finish, 2500);
    closeOpenSessions().then(finish, finish);
  }

  /* THE SHIFT CLOCK ON EVERY PAGE THAT HOLDS PLAYER DATA, not only the consoles. Found 14 Oct
     2026: billing (which downloads the opt-in list), marketing, settings, HQ, onboarding and the
     trivia builder never called enforceShift(), so a host left signed in there stayed signed in
     for ever, and a marketing login (which goes straight to marketing.html) never had a clock at
     all. The 4h sign-out is a compliance control. One line per page: VP.guardShift(). It does
     nothing for a visitor who is not signed in (the TV and signage load this file too, and never
     call it). */
  var _shiftSignOutOnly = false;
  function guardShift() {
    _shiftSignOutOnly = true;
    try {
      getClient().auth.getSession().then(function (r) {
        if (r && r.data && r.data.session) enforceShift();
      }).catch(function () {});
    } catch (e) {}
  }

  /* ONE ROOM, ONE CONSOLE. Each console keeps its night in its own tablet's storage, so a second
     tablet at the same venue showed a plain setup screen and its Open lobby took the TV and every
     phone off the live game, and Start round ended it outright (break test, 14 Oct 2026). Every
     console asks this before opening a lobby it does not already own. Resolves true to go ahead.
     An unreachable server, or no answer in three seconds, never stops a lobby opening. */
  /* ONE QUESTION AT A TIME (19 Oct 2026 review). A second tap while the takeover question is up gets the
     SAME answer as the first, rather than a second dialog that replaced the first unanswered and left the
     first tap waiting for ever (trivia and musical had no double-tap guard of their own). */
  var _takeoverAsk = null;
  function confirmTakeover(slug) {
    if (_takeoverAsk) return _takeoverAsk;
    _takeoverAsk = confirmTakeoverOnce(slug).then(function (v) { _takeoverAsk = null; return v; });
    return _takeoverAsk;
  }
  function confirmTakeoverOnce(slug) {
    return new Promise(function (resolve) {
      if (!slug) { resolve(true); return; }
      var done = false;
      function finish(v) { if (!done) { done = true; resolve(v); } }
      setTimeout(function () { finish(true); }, 3000);
      fetch(GAME_API + "/play/live?code=" + encodeURIComponent(venueCode(slug)))
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) {
          if (done) return;
          if (!d || !d.live) { finish(true); return; }
          var f = String(d.format || "");
          var what = f.indexOf("trivia") === 0 ? "trivia night" : f.indexOf("musical") === 0 ? "musical bingo game"
                   : f.indexOf("bingo") === 0 ? "bingo game" : "game";
          done = true;
          askOnPage("A " + what + " is already open at this venue on another device.",
            "Opening a lobby here takes the TV and every phone away from it, and starting a round here ends it.",
            "Open the lobby here", "Cancel").then(resolve);
        }, function () { finish(true); });
    });
  }
  /* ASKED ON THE PAGE, NEVER WITH window.confirm() (19 Oct 2026). A native dialog stops the whole page
     until somebody answers it: a kiosk browser that blocks dialogs answers "no" for the host without a
     word, and under the browser's own automation (the live tests) the console simply froze the moment
     Open lobby was pressed at a venue with an earlier game still open. The members draw learnt this on
     the live audit; the raffle too. Same question, same two answers, on the page. Resolves true or false. */
  function askOnPage(title, text, yes, no) {
    /* The one on-page dialog, /app/vp-ask.js (Enter, Escape, a focus trap, phones). Every page that
       can open a lobby loads it; the gate checks that. */
    if (!root.vpAsk) return Promise.resolve(true);
    return root.vpAsk(title + "\n\n" + text, { yes: yes, no: no, id: "vpTakeover" });
  }


  /* ONE STATUS AREA (Dean, 28 Oct 2026). Every bar a page can show about the venue or the login
     (unpaid, the signing key, HQ View as, a link for another venue) used to be its own full-width
     element, each inserted at the top of the page on its own, most of them position:sticky;top:0
     with a huge z-index. Two or three at once were painted over each other and over the page
     header: at The Jolly Jess (suspended, viewed from HQ) the red signing bar, the gold View-as bar
     and the orange unpaid bar sat on top of each other and Dean could not read past them.
     Now every bar goes through here: one column in normal flow at the top of the page, in this
     fixed order, nothing sticky, so every bar is readable and none covers another or the header.
     Pass null to take a slot's bar away. */
  var STATUS_ORDER = ['hold', 'sign', 'viewas', 'link'];
  var _statusBars = {};
  function statusBar(slot, el) {
    if (STATUS_ORDER.indexOf(slot) < 0) throw new Error('statusBar: unknown slot ' + slot);
    if (typeof document === 'undefined' || !document.body) return null;
    var old = _statusBars[slot];
    if (old && old !== el && old.parentNode) old.parentNode.removeChild(old);
    if (el) _statusBars[slot] = el; else delete _statusBars[slot];
    var box = document.getElementById('vpStatus');
    var any = false, k;
    for (k in _statusBars) if (Object.prototype.hasOwnProperty.call(_statusBars, k)) any = true;
    if (!any) { if (box && box.parentNode) box.parentNode.removeChild(box); return null; }
    if (!box) {
      box = document.createElement('div');
      box.id = 'vpStatus';
      box.style.cssText = 'position:relative;display:flex;flex-direction:column;width:100%';
      if (document.body.firstChild) document.body.insertBefore(box, document.body.firstChild);
      else document.body.appendChild(box);
    }
    for (var i = 0; i < STATUS_ORDER.length; i++) {
      var b = _statusBars[STATUS_ORDER[i]];
      if (!b) continue;
      // A bar built elsewhere may still ask to be sticky or fixed. In here it is neither.
      if (b.style) { b.style.position = 'static'; b.style.top = 'auto'; b.style.zIndex = 'auto'; }
      if (b.setAttribute) b.setAttribute('data-vp-slot', STATUS_ORDER[i]);
      box.appendChild(b);   // appendChild moves a node already in the box, so this re-sorts it
    }
    return el || null;
  }

  /* WHAT A SWITCHED-OFF VENUE IS TOLD, by reason, in one place (28 Oct 2026). The game Worker
     refuses every host route at a venue whose status is not 'active' (assertVenueActive, called by
     requireStaff on both its paths), so the page says the same thing up front. Never the word
     "suspended": a venue reads that as an accusation, and most of these are an expired card. */
  function holdWords(v, role) {
    if (!v || v.status !== 'suspended') return null;
    var r = typeof v.suspended_reason === 'string' ? v.suspended_reason : '';
    var owner = role === 'owner' || role === 'admin';   // HQ View as reaches billing as the owner would
    if (r === 'nonpayment') {
      return { reason: 'nonpayment',
        title: 'This venue is switched off until the card is updated',
        text: owner
          ? 'Nothing has been lost. Update your card and everything comes straight back on, exactly as you left it.'
          : 'Nothing has been lost. Ask the venue owner to update the card on the account page, and everything comes straight back on, exactly as you left it.',
        link: owner ? { href: '/app/billing.html#pastDue', label: 'Update your card' } : null };
    }
    /* A PROSPECT'S FREE MONTH RAN OUT WITH NO CARD (Dean, 29 Oct 2026; migration 127). Paused, not ended:
       their TV keeps its ads, nothing is lost, a card switches it straight back on. The offer price they
       were set up on went with the pause, so a card added now is at the price of the day. */
    if (r === 'free_month_ended') {
      return { reason: 'free_month_ended',
        title: 'Your free month has ended, so your games are paused',
        text: owner
          ? 'Your TV keeps showing your ads and nothing has been lost. Add your card and everything comes straight back on, exactly as you left it. The offer price you were set up on ended with your free month, so your card is added at our price on the day you add it. If it is not for you, there is nothing you need to do.'
          : 'Your TV keeps showing your ads and nothing has been lost. Ask the venue owner or a manager to add a card, and everything comes straight back on.',
        link: owner ? { href: '#vp-card', label: 'Add your card' } : null };
    }
    if (r === 'ended' || r === 'cancelled' || isArchived(v)) {
      return { reason: 'ended',
        title: "This venue's subscription has ended",
        text: 'Its games are switched off and nothing has been lost. Email support@venueplay.com.au to start it again.',
        link: null };
    }
    return { reason: 'hold',
      title: "This venue's games are on hold",
      text: 'Nothing has been lost. Email support@venueplay.com.au and we will sort it out.',
      link: null };
  }

  /* A SWITCHED-OFF VENUE CANNOT RUN A GAME, SO THE CONSOLE DOES NOT OFFER ONE (Dean, 28 Oct 2026).
     The consoles used to paint a bar about it and then the whole setup underneath (question set,
     timer, Start), so a host could set up a night the Worker was always going to refuse. Now the
     page's .wrap shows ONE card in place of everything else, and the caller stops its boot when this
     answers true. opts.other = { label, onClick } adds a second way out (pick another venue).
     A venue that is not switched off clears any card left from an earlier venue and answers false. */
  function holdGate(ctx, opts) {
    if (typeof document === 'undefined' || !document.body) return false;
    var w = holdWords(ctx && ctx.venue, ctx && ctx.role);
    var wrap = document.querySelector ? document.querySelector('.wrap') : null;
    var card = document.getElementById('vpHoldCard');
    var kids = wrap ? Array.prototype.slice.call(wrap.children || []) : [];
    if (!w) {
      if (card && card.parentNode) card.parentNode.removeChild(card);
      kids.forEach(function (k) {
        if (k.getAttribute && k.getAttribute('data-vp-held') === '1') {
          k.style.display = k.getAttribute('data-vp-held-display') || '';
          k.removeAttribute('data-vp-held'); k.removeAttribute('data-vp-held-display');
        }
      });
      return false;
    }
    statusBar('hold', null);   // the card says it; a bar above saying it again is the stacking Dean saw
    if (!card) { card = document.createElement('div'); card.id = 'vpHoldCard'; }
    card.setAttribute('role', 'status');
    card.setAttribute('data-reason', w.reason);
    card.setAttribute('style', 'max-width:480px;margin:6vh auto 0;padding:28px 24px;text-align:center;' +
      'background:rgba(245,165,36,.08);border:1px solid rgba(245,165,36,.45);border-radius:16px;' +
      "font-family:Manrope,system-ui,sans-serif;color:#E7E7EC");
    var btn = 'display:inline-block;margin:6px;min-height:44px;padding:11px 18px;border-radius:10px;border:none;' +
      "font:700 14px/1.4 'Hanken Grotesk',Manrope,sans-serif;cursor:pointer;text-decoration:none";
    card.innerHTML =
      '<div style="font-size:22px;font-weight:800;line-height:1.3;color:#FFFFFF;margin-bottom:10px">' + w.title + '</div>' +
      '<p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#C9C9D1">' + w.text + '</p>' +
      (w.link ? '<a id="vpHoldPay" href="' + w.link.href + '" style="' + btn + ';background:#FF1F8E;color:#FFFFFF">' + w.link.label + '</a>' : '') +
      (opts && opts.other ? '<button type="button" id="vpHoldOther" style="' + btn + ';background:rgba(255,255,255,.08);color:#E7E7EC">' +
        String(opts.other.label || 'Choose another venue') + '</button>' : '');
    if (wrap) {
      kids.forEach(function (k) {
        if (k === card || !k.style) return;
        if (k.getAttribute && k.getAttribute('data-vp-held') !== '1') {
          k.setAttribute('data-vp-held', '1');
          k.setAttribute('data-vp-held-display', k.style.display || '');
        }
        k.style.display = 'none';
      });
      if (card.parentNode !== wrap) {
        if (wrap.firstChild) wrap.insertBefore(card, wrap.firstChild); else wrap.appendChild(card);
      }
    } else if (card.parentNode !== document.body) {
      document.body.appendChild(card);
    }
    /* The paused prospect's "Add your card" is their own signed card link, fetched for THIS venue
       (/account/card-link, owner or manager only), never a link written into the page. */
    var pay = document.getElementById('vpHoldPay');
    if (pay && w.link && w.link.href === '#vp-card' && ctx && ctx.venue && ctx.venue.id) {
      pay.setAttribute('aria-disabled', 'true');
      try {
        getClient().auth.getSession().then(function (r) {
          var tok = (r && r.data && r.data.session && r.data.session.access_token) || '';
          return fetch(BILLING_API + '/account/card-link', { method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + tok, 'X-VP-Venue': String(ctx.venue.id) },
            body: JSON.stringify({ venue_id: ctx.venue.id }) }).then(function (res) { return res.json(); });
        }).then(function (j) {
          if (j && j.card_url && /^https:\/\//.test(j.card_url)) { pay.setAttribute('href', j.card_url); pay.removeAttribute('aria-disabled'); }
        }, function () {});
      } catch (e) {}
    }
    var other = document.getElementById('vpHoldOther');
    if (other && opts && opts.other && typeof opts.other.onClick === 'function') {
      other.addEventListener('click', function () { holdGate(null); opts.other.onClick(); });
    }
    return true;
  }

  /* SECTION 6 OF THE TERMS, ACCEPTED ONCE (legal compliance matrix gap 1, 28 Oct 2026).
     Anisimoff Legal 9380, 1 Oct 2026, point 3: "prudent to ensure Customers actively tick a check
     box". Onboarding records that tick (vp_venues.compliance_accepted_at and _by, migration 100),
     but only since 15 Oct 2026: on 28 Oct 26 of 27 venues had no record, the live client among them,
     and nothing ever asked them. This card asks, once, at sign-in.

     WHAT IT GATES: the same as the tick has always gated, which is opening an account (/checkout and
     /admin/venue refuse without it) and nothing a game does. No console, no game Worker route and no
     draw reads compliance_accepted_at, so a venue without it keeps running every game, free or paid,
     exactly as before. Changing that would be a new gate, and a game stopping in front of a room is
     not the way to find out about a missing tick. So the card ASKS; it does not block.

     WHO SEES WHAT. An owner or a manager gets the tick, their name and Accept, which writes the record
     through the billing Worker (/account/compliance-accept) the way onboarding writes it: a typed name
     and the time. A host is told the owner or a manager needs to accept it and their games run as
     normal. HQ View as is told the venue has not accepted, and cannot accept on its behalf (the Worker
     refuses that too). A venue whose row does not carry the column (a database the migration has not
     reached) is never asked, and a switched-off venue shows its hold card instead.
     TERMS_TICK is VPA_COMPLIANCE_TICK in the billing Worker word for word, and TERMS_EFFECTIVE the
     date on terms.html: tools/test-terms-acceptance-card.js holds all three equal. */
  var BILLING_API = "https://api.venueplay.com.au";
  var TERMS_TICK = "We are responsible for complying with the gaming laws that apply to our venue, including any permit, licence or authority, age limits and attendance rules. VenuePlay supplies the software only.";
  var TERMS_EFFECTIVE = "28 October 2026";
  function termsMode(ctx) {
    var v = ctx && ctx.venue;
    if (!v || typeof v !== "object" || !("compliance_accepted_at" in v)) return null;
    if (v.compliance_accepted_at || v.status === "suspended") return null;
    var r = ctx.role;
    if (r === "owner" || r === "manager") return "accept";
    if (r === "admin") return "hq";
    return "host";
  }
  /* A VENUE SET UP FOR A PROSPECT TICKS FIRST (Dean, 28 Oct 2026; migration 122). HQ > Set up a prospect
     builds the venue with terms_required and no compliance record, because nobody read the line to them
     on a call. For THAT venue the card is not a question that can wait: the game Worker refuses to start
     any game there until the owner or a manager ticks it (code 'terms_first'), so the console says so up
     front with termsGate below, the way holdGate does for a switched-off venue. Every other venue keeps
     the card above, which asks and blocks nothing. The TV is never touched: its ads keep showing. */
  function termsBlocking(ctx) {
    var v = ctx && ctx.venue;
    return !!(termsMode(ctx) && v.terms_required === true);
  }
  function termsEl(tag, css, text) {
    var e = document.createElement(tag);
    if (css) e.setAttribute("style", css);
    if (text != null) e.textContent = text;
    return e;
  }
  function termsCard(ctx) {
    if (typeof document === "undefined" || !document.body) return false;
    var card = document.getElementById("vpTermsCard");
    var mode = termsMode(ctx);
    if (!mode) { if (card && card.parentNode) card.parentNode.removeChild(card); return false; }
    var v = ctx.venue, name = String(v.name || "your venue"), block = termsBlocking(ctx);
    if (block) mode = "block-" + mode;
    if (card && card.getAttribute("data-venue") === String(v.id) && card.getAttribute("data-mode") === mode) return true;
    if (card && card.parentNode) card.parentNode.removeChild(card);
    card = termsEl("div", "max-width:560px;margin:18px auto;padding:22px 22px 20px;background:rgba(255,31,142,.06);" +
      "border:1px solid rgba(255,31,142,.40);border-radius:16px;font-family:Manrope,system-ui,sans-serif;color:#E7E7EC;" +
      "box-sizing:border-box;width:calc(100% - 32px)");
    card.id = "vpTermsCard";
    card.setAttribute("role", "region");
    card.setAttribute("aria-label", "Updated Terms");
    card.setAttribute("data-venue", String(v.id));
    card.setAttribute("data-mode", mode);
    var EYEBROW = "margin:0 0 6px;font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#FF1F8E;font-weight:800";
    var TITLE = "margin:0 0 10px;font-size:20px;font-weight:800;line-height:1.3;color:#FFFFFF;font-family:'Hanken Grotesk',Manrope,sans-serif";
    var TEXT = "margin:0 0 14px;font-size:15px;line-height:1.55;color:#C9C9D1";
    var LINK = "color:#FF8CC6;font-weight:700;text-decoration:underline";
    card.appendChild(termsEl("p", EYEBROW, block ? "Before your first game" : "Updated Terms"));
    var read = termsEl("a", LINK, "Read section 6 of the Terms");
    read.setAttribute("href", "/terms"); read.setAttribute("target", "_blank"); read.setAttribute("rel", "noopener");
    if (mode === "block-host") {
      card.appendChild(termsEl("h2", TITLE, "Games start here once the owner or a manager ticks one box"));
      card.appendChild(termsEl("p", TEXT, "Before the first game at " + name + ", the owner or a manager needs to confirm the venue runs its own games under the gaming laws that apply to it. They will see it the next time they sign in. The TV keeps showing your ads in the meantime."));
      card.appendChild(read);
    } else if (mode === "block-hq") {
      card.appendChild(termsEl("h2", TITLE, name + " has not ticked section 6 yet, so its games cannot start"));
      card.appendChild(termsEl("p", TEXT, "It was set up for a prospect. Only the venue's owner or a manager can tick it, at their own sign-in; HQ View as cannot do it for them. Their TV keeps showing their ads."));
      card.appendChild(read);
    } else if (mode === "host") {
      card.appendChild(termsEl("h2", TITLE, "Your venue owner needs to accept the updated Terms"));
      card.appendChild(termsEl("p", TEXT, "Section 6 of the Terms needs a tick from the owner or a manager of " + name +
        ". They will be asked the next time they sign in. Your games run as normal in the meantime."));
      card.appendChild(read);
    } else if (mode === "hq") {
      card.appendChild(termsEl("h2", TITLE, name + " has not accepted section 6 of the Terms"));
      card.appendChild(termsEl("p", TEXT, "Only the venue's owner or a manager can accept it, at their own sign-in. HQ View as cannot accept it for them. Their games run as normal."));
      card.appendChild(read);
    } else {
      if (block) {
        card.appendChild(termsEl("h2", TITLE, "One tick and your games are ready, " + name));
        card.appendChild(termsEl("p", TEXT, "Section 6 of our Terms says who is responsible for the games you run: your venue conducts every game, and VenuePlay supplies the software. Tick it once and every game is ready to start. Your TV keeps showing your ads either way."));
      } else {
        card.appendChild(termsEl("h2", TITLE, "Please accept the updated Terms for " + name));
        card.appendChild(termsEl("p", TEXT, "Section 6 of our Terms says who is responsible for the games you run: your venue conducts every game, and VenuePlay supplies the software. We have no record of " +
          name + " accepting it, so we are asking once. Nothing else changes, and your games run as normal."));
      }
      var rp = termsEl("p", "margin:0 0 16px;font-size:14.5px"); rp.appendChild(read); card.appendChild(rp);
      var tickRow = termsEl("label", "display:flex;gap:12px;align-items:flex-start;padding:14px 16px;background:rgba(255,255,255,.04);" +
        "border:1px solid rgba(255,255,255,.12);border-radius:12px;cursor:pointer;margin:0 0 14px");
      var tick = termsEl("input", "width:20px;height:20px;margin:2px 0 0;flex:0 0 auto;accent-color:#FF1F8E");
      tick.setAttribute("type", "checkbox"); tick.id = "vpTermsTick";
      tickRow.appendChild(tick);
      tickRow.appendChild(termsEl("span", "font-size:14.5px;line-height:1.5;color:#E7E7EC",
        "I accept section 6 of the Terms (effective " + TERMS_EFFECTIVE + ") for " + name + ". " + TERMS_TICK));
      card.appendChild(tickRow);
      var nameLbl = termsEl("label", "display:block;font-size:13px;font-weight:700;color:#C9C9D1;margin:0 0 6px", "Your name");
      nameLbl.setAttribute("for", "vpTermsBy");
      card.appendChild(nameLbl);
      var by = termsEl("input", "display:block;width:100%;box-sizing:border-box;min-height:44px;padding:11px 14px;border-radius:10px;" +
        "border:1px solid rgba(255,255,255,.16);background:#141418;color:#FFFFFF;font:inherit;font-size:16px;margin:0 0 14px");
      by.setAttribute("type", "text"); by.setAttribute("autocomplete", "name"); by.setAttribute("maxlength", "120"); by.id = "vpTermsBy";
      var mine = (ctx.staff || []).filter(function (x) { return x && x.venue_id === v.id; })[0];
      by.value = (mine && mine.display_name) ? String(mine.display_name) : "";
      card.appendChild(by);
      var go = termsEl("button", "display:inline-block;min-height:44px;padding:11px 22px;border-radius:10px;border:none;background:#FF1F8E;" +
        "color:#FFFFFF;font:700 15px/1.4 'Hanken Grotesk',Manrope,sans-serif;cursor:pointer", "Accept");
      go.setAttribute("type", "button"); go.id = "vpTermsGo";
      card.appendChild(go);
      var msg = termsEl("p", "margin:10px 0 0;font-size:14px;line-height:1.5;color:#FF8CC6;min-height:1px", "");
      msg.id = "vpTermsMsg"; msg.setAttribute("role", "status");
      card.appendChild(msg);
      go.addEventListener("click", function () { termsAccept(ctx, card, tick, by, go, msg, block); });
    }
    var wrap = document.querySelector ? document.querySelector(".wrap") : null;
    if (wrap) { if (wrap.firstChild) wrap.insertBefore(card, wrap.firstChild); else wrap.appendChild(card); }
    else document.body.appendChild(card);
    return true;
  }
  function termsAccept(ctx, card, tick, by, go, msg, block) {
    var v = ctx.venue, who = String(by.value || "").trim();
    if (!tick.checked) { msg.textContent = "Tick the box to accept section 6 of the Terms."; return Promise.resolve(false); }
    if (!who) { msg.textContent = "Enter your name, so the record says who accepted it."; return Promise.resolve(false); }
    go.disabled = true; msg.textContent = "";
    var c; try { c = getClient(); } catch (e) { go.disabled = false; msg.textContent = "Could not reach VenuePlay. Check your connection and try again."; return Promise.resolve(false); }
    return c.auth.getSession().then(function (r) {
      var tok = (r && r.data && r.data.session && r.data.session.access_token) || "";
      return fetch(BILLING_API + "/account/compliance-accept", { method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + tok, "X-VP-Venue": String(v.id) },
        body: JSON.stringify({ venue_id: v.id, accepted: true, by: who }) })
        .then(function (res) { return res.json().catch(function () { return { error: "Something went wrong at our end. Try again in a minute." }; }); });
    }).then(function (j) {
      if (!j || j.error || !j.ok) { go.disabled = false; msg.textContent = (j && j.error) || "That did not save. Try again in a minute."; return false; }
      v.compliance_accepted_at = j.compliance_accepted_at || new Date().toISOString();
      v.compliance_accepted_by = j.compliance_accepted_by || who;
      while (card.firstChild) card.removeChild(card.firstChild);
      card.setAttribute("data-mode", "done");
      card.appendChild(termsEl("p", "margin:0 0 6px;font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#2BD47D;font-weight:800", "Accepted"));
      card.appendChild(termsEl("p", "margin:0 0 14px;font-size:15px;line-height:1.55;color:#E7E7EC",
        "Thank you. Section 6 of the Terms is recorded as accepted for " + String(v.name || "your venue") + " by " + v.compliance_accepted_by + "."));
      /* A held console (termsGate) stopped its boot to show this card, so the way on is a fresh load,
         which now finds the record and starts as normal. Anywhere else Done just takes the card away. */
      var done = termsEl("button", "display:inline-block;min-height:44px;padding:11px 22px;border-radius:10px;border:none;" +
        (block ? "background:#FF1F8E;color:#FFFFFF;" : "background:rgba(255,255,255,.08);color:#E7E7EC;") +
        "font:700 15px/1.4 'Hanken Grotesk',Manrope,sans-serif;cursor:pointer", block ? "Start a game" : "Done");
      done.setAttribute("type", "button"); done.id = "vpTermsDone";
      done.addEventListener("click", function () {
        if (block && termsHeld()) { try { window.location.reload(); } catch (e) {} return; }
        if (card.parentNode) card.parentNode.removeChild(card);
      });
      card.appendChild(done);
      return true;
    }, function () {
      go.disabled = false; msg.textContent = "Could not reach VenuePlay. Check your connection and try again."; return false;
    });
  }

  /* THE HELD CONSOLE (Dean, 28 Oct 2026; migration 122). For a prospect venue with no recorded tick,
     the page's .wrap shows the Terms card and nothing else, and the caller stops its boot when this
     answers true, exactly as it does for holdGate. Any other venue: whatever this hid comes back, and
     it answers false. Its own attribute (data-vp-terms-held), so it never undoes what holdGate hid. */
  function termsHeld() {
    var wrap = (typeof document !== "undefined" && document.querySelector) ? document.querySelector(".wrap") : null;
    return !!wrap && Array.prototype.some.call(wrap.children || [], function (k) { return k.getAttribute && k.getAttribute("data-vp-terms-held") === "1"; });
  }
  function termsGate(ctx) {
    if (typeof document === "undefined" || !document.body) return false;
    var wrap = document.querySelector ? document.querySelector(".wrap") : null;
    var kids = wrap ? Array.prototype.slice.call(wrap.children || []) : [];
    if (!termsBlocking(ctx)) {
      kids.forEach(function (k) {
        if (k.getAttribute && k.getAttribute("data-vp-terms-held") === "1") {
          k.style.display = k.getAttribute("data-vp-terms-display") || "";
          k.removeAttribute("data-vp-terms-held"); k.removeAttribute("data-vp-terms-display");
        }
      });
      return false;
    }
    termsCard(ctx);
    var card = document.getElementById("vpTermsCard");
    kids.forEach(function (k) {
      if (k === card || !k.style) return;
      if (k.getAttribute && k.getAttribute("data-vp-terms-held") !== "1") {
        k.setAttribute("data-vp-terms-held", "1");
        k.setAttribute("data-vp-terms-display", k.style.display || "");
      }
      k.style.display = "none";
    });
    return true;
  }

  /* A HOST IS THE STAFF (Dean, 28 Oct 2026). The game Worker's kill-switch answers 403 in one of two
     sets of words: the host's ("Your tab has run a bit long...") or the room's ("Games are paused
     here tonight. Have a word with the staff."), and a few host routes (opening a session among
     them) still answer in the room's. A host pressing Start at a switched-off venue was told to
     have a word with the staff. Every console runs a Worker error through here: a switched-off
     answer becomes the host's own words, and the page swaps to the switched-off card (holdGate),
     re-reading the venue first so the card gives the real reason. Anything else passes through. */
  var SWITCHED_OFF = /Have a word with the staff|Your tab has run a bit long\. Settle up on your account page/;
  function hostRefusal(status, msg) {
    if (status !== 403 || !SWITCHED_OFF.test(String(msg || ''))) return msg;
    var ctx = _ctx;
    function show(c) {
      var v = c && c.venue;
      if (v && v.status === 'suspended') return holdGate(c);
      // The venue reads active but the Worker says no: its group is switched off. Same card, no reason.
      return holdGate({ venue: { status: 'suspended', suspended_reason: '' }, role: c && c.role });
    }
    try { refresh().then(show, function () { show(ctx); }); } catch (e) { show(ctx); }
    var w = holdWords(ctx && ctx.venue && ctx.venue.status === 'suspended' ? ctx.venue : { status: 'suspended' }, ctx && ctx.role);
    return w.title + '.';
  }

  /* A suspended venue used to look completely healthy until the host tapped Start in front of a
     room and got "This venue is suspended". Nothing in the venue-facing app checked the status at
     all. Any page can call this after ready() to say so on sign-in instead. A game console calls
     holdGate() instead, which replaces the setup with one card. */
  function suspensionBanner(ctx) {
    var v = ctx && ctx.venue;
    if (!v || v.status !== 'suspended') return;
    if (document.getElementById('vpSuspendBar') || document.getElementById('vpHoldCard')) return;
    var nonpay = v.suspended_reason === 'nonpayment';
    var bar = document.createElement('div');
    bar.id = 'vpSuspendBar';
    if (bar.setAttribute) bar.setAttribute('role', 'status');
    bar.style.cssText = 'padding:12px 18px;background:#F5A524;' +
      'color:#180d00;font-family:Manrope,system-ui,sans-serif;font-size:14px;font-weight:600;' +
      'line-height:1.45;text-align:center';
    // Never the word "suspended". A venue reads that as an accusation, and most of these are an
    // expired card. Dean's line, in the voice the rest of the product uses. It names no game: this
    // bar shows on trivia, musical, raffle and members pages too (28 Oct 2026). The link is
    // absolute because the consoles live one folder down.
    bar.innerHTML = nonpay
      ? 'Your tab has run a bit long. Settle up and we will pour you another round. ' +
        '<a href="/app/billing.html#pastDue" style="color:#180d00;text-decoration:underline">Update your card</a> and everything comes straight back on, exactly as you left it.'
      // An archived venue was switched off on purpose. Telling its owner to "give us a shout
      // and we will sort it out" reads as a fault and sends them chasing a problem that is not
      // one. Say what it is, and point at the way out.
      : isArchived(v)
      ? 'This venue is archived, so its games are switched off. Nothing has been lost. Choose another venue to keep playing, or email support@venueplay.com.au to bring this one back.'
      : 'Your games are on hold for the moment. Nothing has been lost. Email support@venueplay.com.au and we will sort it out.';
    statusBar('hold', bar);
  }
  /* Fire-and-forget POST to the game Worker, signed with the caller's token.
     For side records that must never hold up or break the thing they describe:
     the gaming declaration written when a host acknowledges their state's rules.
     Resolves to null on any failure rather than rejecting, on purpose. */
  function gameApiPost(path, body) {
    var c; try { c = getClient(); } catch (e) { return Promise.resolve(null); }
    return c.auth.getSession().then(function (r) {
      var tok = (r && r.data && r.data.session && r.data.session.access_token) || "";
      if (!tok) return null;
      return fetch(GAME_API + path, {
        method: "POST", keepalive: true,
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + tok },
        body: JSON.stringify(body || {})
      }).then(function (res) { return res.json().catch(function () { return null; }); });
    }).catch(function () { return null; });
  }
  /* The same POST, for a caller that needs to know WHAT happened. Resolves with
     {status, json} for any HTTP answer, including 4xx and 5xx; REJECTS on no
     answer at all (no token, network down, or nothing back inside timeoutMs).
     The bingo console uses the difference: a 429 means "wait", a rejection means
     "the server is gone, call the rest of the night from this tablet". gameApiPost
     above flattens both into null, which is right for a side record and wrong
     for a draw. */
  function gameApiCall(path, body, timeoutMs) {
    var c; try { c = getClient(); } catch (e) { return Promise.reject(new Error("no client")); }
    var ms = timeoutMs || 4000;
    var ctrl = (typeof AbortController === "function") ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, ms);
    return c.auth.getSession().then(function (r) {
      var tok = (r && r.data && r.data.session && r.data.session.access_token) || "";
      if (!tok) throw new Error("not signed in");
      return fetch(GAME_API + path, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + tok },
        body: JSON.stringify(body || {}),
        signal: ctrl ? ctrl.signal : undefined
      });
    }).then(function (res) {
      return res.json().catch(function () { return null; }).then(function (j) {
        return { status: res.status, json: j };
      });
    }).then(function (out) { clearTimeout(timer); return out; },
            function (err) { clearTimeout(timer); throw err; });
  }

  /* ONE "ADVANCED SETTINGS" FOR EVERY GAME (Dean, 28 Oct 2026: "We need to make all the games easier.
     Maybe we have an advanced settings tab for each game?"). The choices a host makes every night stay
     on the setup; the ones a venue sets once go behind one disclosure, the same component in all five
     consoles: a <details class="vp-adv"> in the page's own markup, closed until somebody opens it, and
     this browser remembers whether it was left open (vpAdvOpen:<game>). Nothing the law needs before a
     paid game ever goes in here: paid entry, the state rules screen and the free-entry note stay in
     plain sight. The look lives here once, so the five consoles cannot drift apart. */
  var ADV_CSS =
    '.vp-adv{margin:14px 0;border:1px solid var(--line-2,rgba(255,255,255,.12));border-radius:12px;background:var(--ink-3,rgba(255,255,255,.03))}' +
    '.vp-adv>summary{list-style:none;cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:44px;padding:10px 14px;border-radius:12px;' +
      "font:700 14px/1.3 'Hanken Grotesk',Manrope,system-ui,sans-serif;color:var(--text,#E7E7EC)}" +
    '.vp-adv>summary::-webkit-details-marker{display:none}' +
    '.vp-adv>summary::after{content:"";flex:none;width:8px;height:8px;margin:-4px 4px 0 0;border-right:2px solid currentColor;border-bottom:2px solid currentColor;transform:rotate(45deg);opacity:.7;transition:transform .15s}' +
    '.vp-adv[open]>summary::after{transform:rotate(-135deg);margin-top:4px}' +
    '.vp-adv>summary:focus-visible{outline:2px solid var(--pink,#FF1F8E);outline-offset:2px}' +
    '.vp-adv-sub{display:block;margin-top:2px;font:500 12px/1.4 Manrope,system-ui,sans-serif;color:var(--faint,#8A8A94)}' +
    '.vp-adv-body{padding:4px 14px 14px}' +
    '.vp-adv-body>.field:last-child,.vp-adv-body>:last-child{margin-bottom:0}' +
    '.vp-foot-link{display:block;width:100%;min-height:44px;margin:12px 0 0;padding:10px 0;background:none;border:none;cursor:pointer;text-align:center;' +
      'font:600 13px/1.4 Manrope,system-ui,sans-serif;color:var(--muted,#B4B4BE);text-decoration:underline;text-underline-offset:3px}' +
    '.vp-foot-link:hover{color:var(--text,#E7E7EC)}' +
    '.vp-foot-link:focus-visible{outline:2px solid var(--pink,#FF1F8E);outline-offset:2px;border-radius:8px}';
  function advancedCss() {
    if (typeof document === 'undefined' || !document.createElement) return;
    if (!document.head || (document.getElementById && document.getElementById('vpAdvCss'))) return;
    var s = document.createElement('style');
    s.id = 'vpAdvCss';
    s.textContent = ADV_CSS;
    if (document.head && document.head.appendChild) document.head.appendChild(s);   // never into the page body
  }
  advancedCss();   // at load, so the disclosure never paints as the browser's own triangle first
  function advanced(el, game) {
    if (!el) return null;
    advancedCss();
    var key = 'vpAdvOpen:' + String(game || 'game');
    var open = false;
    try { open = localStorage.getItem(key) === '1'; } catch (e) {}
    el.open = open;   // closed unless this browser left it open
    if (!el._vpAdv && el.addEventListener) {
      el._vpAdv = true;
      el.addEventListener('toggle', function () {
        try { localStorage.setItem(key, el.open ? '1' : '0'); } catch (e) {}
      });
    }
    return el;
  }

  /* EVERY GAME'S SETUP SAVED FOR THE VENUE (Dean, 28 Oct 2026: "all of those settings that they change
     should be saved to the venue"). One mechanism for all five consoles, built on the musical console's
     first version: vp_venue_settings.game_prefs (migration 121), one object per game, read and MERGED
     through the game Worker's /host/game-prefs by ANY staff login (a Host included, which a direct
     vp_venue_settings write never allowed).

       var prefs = VP.gamePrefs('bingo', { venueId, collect, apply, local, fallback, token, api });
       prefs.start()   once the page can show the choices: read, apply, and from then on save changes
       prefs.queue()   a choice changed: saved a moment later, once, however many taps

     Loading, in order: the venue's saved setup; else the venue's older saved columns (fallback:
     trivia_* and raffle_template, so no venue loses what it had); else this browser's old values
     (local), which are sent up ONCE so they become the venue's; else the page's own defaults. If the
     route is not there (404, the column not added yet, offline) the page carries on with this
     browser's values and says nothing. Nothing is saved before the venue's setup has been read, so
     a fresh page's defaults never overwrite it. Never paid-or-free for the night, unsold tickets or
     permits: the Worker drops them, and no console sends them. */
  function gamePrefs(game, o) {
    o = o || {};
    var ready = false, applying = false, timer = null;
    var delay = (o.delay == null) ? 800 : o.delay;
    function api() { var a = (typeof o.api === 'function') ? o.api() : o.api; return String(a || GAME_API); }
    function venue() { return String((typeof o.venueId === 'function' ? o.venueId() : o.venueId) || ''); }
    function obj(p) { return (p && typeof p === 'object' && !Array.isArray(p)) ? p : null; }
    function token() {
      if (typeof o.token === 'function') return Promise.resolve(o.token());
      var c; try { c = getClient(); } catch (e) { return Promise.reject(e); }
      return c.auth.getSession().then(function (r) { return (r && r.data && r.data.session && r.data.session.access_token) || ''; });
    }
    function load() {
      var v = venue();
      if (!v) return Promise.resolve(null);
      return token().then(function (t) {
        return fetch(api() + '/host/game-prefs?venue_id=' + encodeURIComponent(v) + '&game=' + encodeURIComponent(game),
          { headers: { 'Authorization': 'Bearer ' + t } });
      }).then(function (r) { return (r && r.ok) ? r.json() : null; })
        .then(function (d) { return d ? (obj(d.prefs) || {}) : null; })   // {} = the route answered, nothing saved yet
        .catch(function () { return null; });                             // null = no route: this browser's values stay
    }
    function saveNow() {
      var v = venue();
      if (!v) return Promise.resolve(false);
      var p = null; try { p = obj(o.collect && o.collect()); } catch (e) { p = null; }
      if (!p || !Object.keys(p).length) return Promise.resolve(false);
      return token().then(function (t) {
        return fetch(api() + '/host/game-prefs', { method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + t },
          body: JSON.stringify({ venue_id: v, game: game, prefs: p }) });
      }).then(function (r) { return !!(r && r.ok); }).catch(function () { return false; });   // the page keeps it either way
    }
    function queue() {
      if (!ready || applying) return;   // never save the page's defaults over the venue's choices
      if (timer) clearTimeout(timer);
      timer = setTimeout(function () { timer = null; saveNow(); }, delay);
    }
    function apply(p) {
      if (typeof o.apply !== 'function') return;
      applying = true;
      try { o.apply(p); } catch (e) {} finally { applying = false; }
    }
    function start() {
      return load().then(function (saved) {
        if (saved && Object.keys(saved).length) { apply(saved); ready = true; return 'venue'; }
        var fb = null;
        try { fb = (typeof o.fallback === 'function') ? o.fallback() : null; } catch (e) { fb = null; }
        return Promise.resolve(fb).catch(function () { return null; }).then(function (older) {
          var loc = null; try { loc = (typeof o.local === 'function') ? o.local() : null; } catch (e) { loc = null; }
          var merged = {}, any = false, k;
          older = obj(older); loc = obj(loc);
          if (older) for (k in older) if (Object.prototype.hasOwnProperty.call(older, k) && older[k] != null) { merged[k] = older[k]; any = true; }
          if (loc) for (k in loc) if (Object.prototype.hasOwnProperty.call(loc, k) && loc[k] != null && !(k in merged)) { merged[k] = loc[k]; any = true; }
          if (any) apply(merged);
          ready = true;
          // The route answered and the venue has nothing yet: what this page now shows becomes the venue's, once.
          if (saved && any) return saveNow().then(function () { return 'sent'; });
          return any ? 'local' : 'default';
        });
      });
    }
    return { start: start, queue: queue, saveNow: saveNow, load: load,
             ready: function () { return ready; }, applying: function () { return applying; } };
  }

  root.VP = {
    getClient: getClient,
    useClient: useClient,
    ready: ready,
    refresh: refresh,
    getContext: getContext,
    setCurrentVenue: setCurrentVenue,
    sessionPlayerCount: sessionPlayerCount,
    listVenues: listVenues,
    gameApiPost: gameApiPost,
    gameApiCall: gameApiCall,
    loadSettings: loadSettings,
    saveSettings: saveSettings,
    requireAuth: requireAuth,
    signOut: signOut,
    homeHref: homeHref,
    venueCode: venueCode,
    venueJoinCode: venueJoinCode,
    suspensionBanner: suspensionBanner,
    statusBar: statusBar,
    holdGate: holdGate,
    holdWords: holdWords,
    termsCard: termsCard,   // section 6 of the Terms, accepted once (28 Oct 2026)
    termsGate: termsGate,   // a prospect venue's console is held on that card until it is ticked (migration 122)
    hostRefusal: hostRefusal,
    noteOpenSession: noteOpenSession,
    closeOpenSessions: closeOpenSessions,
    closeSession: closeSession,
    retryPendingCloses: retryPendingCloses,
    enforceShift: enforceShift,
    guardShift: guardShift,
    confirmTakeover: confirmTakeover,
    askOnPage: askOnPage,   // the same on-page question, for the "pick it up?" prompt (vp-pickup.js)
    endShift: endShift,
    setGameActive: setGameActive,
    advanced: advanced,     // the one "Advanced settings" disclosure (28 Oct 2026)
    gamePrefs: gamePrefs    // every game's setup saved for the venue (migration 121)
  };
})(window);
