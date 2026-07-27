/* ===========================================================================
   THE MINI BAR - core.js
   Shared foundation for the guest kiosk, the reception console and the admin
   tools (the last two to be built later against this exact same core).

   HOW IT LOADS
   ------------
   This is a CLASSIC browser script (NOT an ES module) so it works when a page
   is opened straight from disk with a file:// URL, with no build step and no
   server. It exposes a single global: window.MB.

     <script src="core.js"></script>   ->  window.MB is ready

   WHAT IS REAL vs MOCKED
   ----------------------
   Everything here is real, working MVP code EXCEPT MB.integrations.*, which
   are clearly-marked STUBS that simulate the real vendors (face age estimate,
   ID verification, payment, and the physical vend). Each stub carries a TODO
   pointing at the real vendor it stands in for, and keeps the exact interface
   shape the real one will use, so swapping in the real integration is a
   drop-in replacement. Nothing here makes a real network call.

   The "backend" (MB.store) is a MOCK NETWORKED BACKEND: it persists to
   localStorage and gossips between browser tabs over BroadcastChannel (with a
   localStorage 'storage' event fallback), so a kiosk tab and a reception
   console tab in the same browser can talk to each other in real time.
   =========================================================================== */
(function () {
  "use strict";

  var MB = {};

  /* =========================================================================
     1. CONFIG
     ========================================================================= */
  MB.config = {
    // Age (years) below which a face estimate is NOT trusted on its own. If the
    // estimate comes back under this buffer, we force a hard ID check. We never
    // sell alcohol on a face estimate alone when it lands under the buffer.
    BUFFER_AGE: 27,

    // Responsible-service daily cap: max alcoholic drinks per VERIFIED mobile
    // number per local calendar day. Resets at local midnight.
    DAILY_ALCOHOL_CAP: 4,

    // How long an OTP mobile-verification lasts before a fresh code is needed.
    // Set to a typical stay. The daily cap tracks against the verified number,
    // and the OTP is what stops a guest typing a random number to dodge the cap.
    STAY_WINDOW_DAYS: 4,

    // How alcohol is authorised. The Mini Bar is a FULLY AUTOMATED product:
    // age is verified on-device at every dispense, with a hard daily cap. There
    // is deliberately no human-approval step in the normal flow - that is the
    // clunky competitor model this machine exists to replace.
    //   'automated'  - DEFAULT. Machine verifies age on-device, no staff. This
    //                  is the product and the only path the kiosk UI uses.
    //   'supervised' / 'reception' - OPTIONAL OVERSIGHT HOOK ONLY. Left here so
    //                  that IF a regulator ever insisted on a human in the loop,
    //                  the dormant approval machinery below (requestApproval /
    //                  respondApproval / listPending) could drive a future
    //                  reception console WITHOUT re-architecting the core. Not
    //                  wired into the kiosk and not shown in the demo.
    // NOTE: nothing here asserts any mode is legally approved. That is a
    // licensing decision for each venue and jurisdiction.
    MODE: "automated",

    currency: "AUD",

    // Cosmetic: which local time the day rolls over. Kept at midnight so the
    // daily cap matches the local calendar day.
    RESET_LABEL: "midnight"
  };

  /* =========================================================================
     2. CATALOGUE
     A realistic in-property range. Prices are in CENTS (integer) to avoid
     floating-point money bugs. standardDrinks follows AU standard-drink
     guidance (10g alcohol = 1 standard drink) and is 0 for non-alcohol.
     slot is the physical machine slot the vend motor maps to.
     `icon` is a UI hint only (not part of the core data contract).
     ========================================================================= */
  /* ---- Product images ------------------------------------------------------
     Real product PHOTOS live in the sibling folder product-images/ (one JPG per
     product, named to match the slug below). Each catalogue item's `image` is a
     RELATIVE PATH to that photo. It is JUST A STRING, so it is fully swappable.
     Until a photo is dropped in, the kiosk/cart render a clean PLACEHOLDER frame
     carrying the product name (never a cartoon) via an <img> onerror fallback,
     so a tile looks premium whether the photo is present or not.
     `icon` is kept as a UI hint only (not part of the core data contract). */

  MB.catalogue = [
    // ---- Drinks (non-alcoholic) ----
    { id: "d-water-still",   name: "Still Spring Water 600ml",   category: "Drinks",    priceCents: 450,  isAlcohol: false, standardDrinks: 0,   slot: "A1", icon: "water", image: "product-images/still-spring-water-600ml.jpg" },
    { id: "d-water-sparkling", name: "Sparkling Mineral Water 500ml", category: "Drinks", priceCents: 550, isAlcohol: false, standardDrinks: 0, slot: "A2", icon: "water", image: "product-images/sparkling-mineral-water-500ml.jpg" },
    { id: "d-coke",          name: "Coca-Cola Classic 375ml",    category: "Drinks",    priceCents: 500,  isAlcohol: false, standardDrinks: 0,   slot: "A3", icon: "can", image: "product-images/coca-cola-classic-375ml.jpg" },
    { id: "d-coke-nosugar",  name: "Coke No Sugar 375ml",        category: "Drinks",    priceCents: 500,  isAlcohol: false, standardDrinks: 0,   slot: "A4", icon: "can", image: "product-images/coke-no-sugar-375ml.jpg" },
    { id: "d-sprite",        name: "Sprite 375ml",               category: "Drinks",    priceCents: 500,  isAlcohol: false, standardDrinks: 0,   slot: "A5", icon: "can", image: "product-images/sprite-375ml.jpg" },
    { id: "d-ginger",        name: "Ginger Beer (Non-Alc) 330ml", category: "Drinks",   priceCents: 600,  isAlcohol: false, standardDrinks: 0,   slot: "A6", icon: "can", image: "product-images/ginger-beer-non-alc-330ml.jpg" },
    { id: "d-coldbrew",      name: "Cold Brew Coffee 250ml",     category: "Drinks",    priceCents: 700,  isAlcohol: false, standardDrinks: 0,   slot: "A7", icon: "cup", image: "product-images/cold-brew-coffee-250ml.jpg" },
    { id: "d-oj",            name: "Orange Juice 350ml",         category: "Drinks",    priceCents: 650,  isAlcohol: false, standardDrinks: 0,   slot: "A8", icon: "cup", image: "product-images/orange-juice-350ml.jpg" },

    // ---- Alcohol ----
    { id: "a-craft-lager",   name: "Great Northern Original 375ml",    category: "Alcohol",   priceCents: 1200, isAlcohol: true,  standardDrinks: 1.4, slot: "B1", icon: "beer", image: "product-images/great-northern-original.jpg" },
    { id: "a-pale-ale",      name: "Balter XPA 375ml",  category: "Alcohol",   priceCents: 1200, isAlcohol: true,  standardDrinks: 1.4, slot: "B2", icon: "beer", image: "product-images/balter-xpa.jpg" },
    { id: "a-mid-lager",     name: "Great Northern Super Crisp Mid 375ml",   category: "Alcohol",   priceCents: 1000, isAlcohol: true,  standardDrinks: 0.9, slot: "B3", icon: "beer", image: "product-images/great-northern-super-crisp-mid.jpg" },
    { id: "a-shiraz",        name: "Wolf Blass Shiraz 187ml", category: "Alcohol",   priceCents: 1400, isAlcohol: true,  standardDrinks: 1.6, slot: "B4", icon: "wine", image: "product-images/wolf-blass-shiraz.jpg" },
    { id: "a-sauv-blanc",    name: "Oyster Bay Sauvignon Blanc 187ml", category: "Alcohol", priceCents: 1400, isAlcohol: true, standardDrinks: 1.5, slot: "B5", icon: "wine", image: "product-images/oyster-bay-sauv-blanc.jpg" },
    { id: "a-sparkling",     name: "Chandon Brut 200ml", category: "Alcohol",   priceCents: 1500, isAlcohol: true,  standardDrinks: 1.5, slot: "B6", icon: "wine", image: "product-images/chandon-brut.jpg" },
    { id: "a-vodka-soda",    name: "White Claw Natural Lime 330ml",  category: "Alcohol",   priceCents: 1300, isAlcohol: true,  standardDrinks: 1.1, slot: "B7", icon: "can", image: "product-images/white-claw-natural-lime.jpg" },
    { id: "a-gin-tonic",     name: "Gordon's Gin & Tonic 250ml",   category: "Alcohol",   priceCents: 1300, isAlcohol: true,  standardDrinks: 1.2, slot: "B8", icon: "can", image: "product-images/gordons-gin-tonic.jpg" },

    // ---- Snacks ----
    { id: "s-chips",         name: "Red Rock Deli Sea Salt 90g",  category: "Snacks",    priceCents: 600,  isAlcohol: false, standardDrinks: 0,   slot: "C1", icon: "snack", image: "product-images/red-rock-deli-sea-salt.jpg" },
    { id: "s-chocolate",     name: "Cadbury Dairy Milk 50g",   category: "Snacks",    priceCents: 750,  isAlcohol: false, standardDrinks: 0,   slot: "C2", icon: "choc", image: "product-images/cadbury-dairy-milk.jpg" },
    { id: "s-nuts",          name: "Nobby's Nuts 60g",     category: "Snacks",    priceCents: 650,  isAlcohol: false, standardDrinks: 0,   slot: "C3", icon: "snack", image: "product-images/nobbys-nuts.jpg" },
    { id: "s-protein",       name: "Choc Peanut Protein Bar",    category: "Snacks",    priceCents: 550,  isAlcohol: false, standardDrinks: 0,   slot: "C4", icon: "snack", image: "product-images/choc-peanut-protein-bar.jpg" },
    { id: "s-shortbread",    name: "Walkers Shortbread", category: "Snacks",   priceCents: 500,  isAlcohol: false, standardDrinks: 0,   slot: "C5", icon: "choc", image: "product-images/walkers-shortbread.jpg" },
    { id: "s-jerky",         name: "Byron Bay Beef Jerky",       category: "Snacks",    priceCents: 850,  isAlcohol: false, standardDrinks: 0,   slot: "C6", icon: "snack", image: "product-images/byron-bay-beef-jerky.jpg" },

    // ---- Essentials ----
    { id: "e-paracetamol",   name: "Paracetamol Pain Relief (12)", category: "Essentials", priceCents: 800, isAlcohol: false, standardDrinks: 0, slot: "D1", icon: "pill", image: "product-images/paracetamol-pain-relief-12.jpg" },
    { id: "e-charger",       name: "USB-C Fast Charger 20W",     category: "Essentials", priceCents: 2500, isAlcohol: false, standardDrinks: 0,  slot: "D2", icon: "plug", image: "product-images/usb-c-fast-charger-20w.jpg" },
    { id: "e-toothbrush",    name: "Toothbrush + Mini Paste Kit", category: "Essentials", priceCents: 900, isAlcohol: false, standardDrinks: 0,  slot: "D3", icon: "kit", image: "product-images/toothbrush-mini-paste-kit.jpg" },
    { id: "e-sanitiser",     name: "Hand Sanitiser 50ml",        category: "Essentials", priceCents: 600,  isAlcohol: false, standardDrinks: 0,  slot: "D4", icon: "kit", image: "product-images/hand-sanitiser-50ml.jpg" },
    { id: "e-earplugs",      name: "Soft Foam Ear Plugs (3pr)",  category: "Essentials", priceCents: 500,  isAlcohol: false, standardDrinks: 0,  slot: "D5", icon: "kit", image: "product-images/soft-foam-ear-plugs-3pr.jpg" }
  ];

  // Fixed category order for UI.
  MB.categories = ["Drinks", "Alcohol", "Snacks", "Essentials"];

  /* =========================================================================
     3. SMALL HELPERS (shared by every app)
     ========================================================================= */
  MB.money = function (cents) {
    var n = (Math.round(cents) / 100);
    return "$" + n.toFixed(2);
  };

  MB.findItem = function (id) {
    for (var i = 0; i < MB.catalogue.length; i++) {
      if (MB.catalogue[i].id === id) return MB.catalogue[i];
    }
    return null;
  };

  MB.uid = function (prefix) {
    return (prefix || "id") + "_" + Date.now().toString(36) + "_" +
      Math.random().toString(36).slice(2, 8);
  };

  // Local calendar day key, e.g. "2026-07-27". Drives the midnight reset.
  MB.dayKey = function (date) {
    var d = date || new Date();
    var y = d.getFullYear();
    var m = ("0" + (d.getMonth() + 1)).slice(-2);
    var day = ("0" + d.getDate()).slice(-2);
    return y + "-" + m + "-" + day;
  };

  /* Turn a cart map { itemId: qty } into a rich summary used everywhere
     (kiosk checkout, reception approval card, audit). */
  MB.summariseCart = function (cartMap) {
    var lines = [];
    var totalCents = 0, alcoholDrinks = 0, standardDrinks = 0, hasAlcohol = false;
    for (var id in cartMap) {
      if (!Object.prototype.hasOwnProperty.call(cartMap, id)) continue;
      var qty = cartMap[id];
      if (!qty || qty <= 0) continue;
      var item = MB.findItem(id);
      if (!item) continue;
      var lineCents = item.priceCents * qty;
      totalCents += lineCents;
      if (item.isAlcohol) {
        hasAlcohol = true;
        alcoholDrinks += qty;
        standardDrinks += item.standardDrinks * qty;
      }
      lines.push({ id: id, item: item, qty: qty, lineCents: lineCents });
    }
    return {
      lines: lines,
      totalCents: totalCents,
      alcoholDrinks: alcoholDrinks,
      standardDrinks: Math.round(standardDrinks * 10) / 10,
      hasAlcohol: hasAlcohol
    };
  };

  /* =========================================================================
     4. STORAGE LAYER
     localStorage with an in-memory fallback (some browsers deny localStorage
     on file://). Everything JSON in/out.
     ========================================================================= */
  var _mem = {}; // fallback store if localStorage is unavailable
  var _lsOk = (function () {
    try {
      var k = "__mb_test__";
      window.localStorage.setItem(k, "1");
      window.localStorage.removeItem(k);
      return true;
    } catch (e) { return false; }
  })();

  var LS = {
    get: function (key, dflt) {
      try {
        var raw = _lsOk ? window.localStorage.getItem(key) : _mem[key];
        if (raw === null || raw === undefined) return dflt;
        return JSON.parse(raw);
      } catch (e) { return dflt; }
    },
    set: function (key, value) {
      var raw = JSON.stringify(value);
      try {
        if (_lsOk) window.localStorage.setItem(key, raw);
        else _mem[key] = raw;
      } catch (e) { _mem[key] = raw; }
    }
  };

  var KEYS = {
    sessions:  "mb_sessions",   // { sessionId: session }
    daily:     "mb_daily",      // { "YYYY-MM-DD": { mobile: drinkCount } }
    verified:  "mb_verified",   // { mobile: { verifiedAt, expiresAt } }
    purchases: "mb_purchases",  // [ purchase, ... ]
    audit:     "mb_audit",      // [ auditEntry, ... ]
    pending:   "mb_pending",    // { requestId: approvalRequest }
    bus:       "mb_bus"         // last cross-tab message (storage-event fallback)
  };

  /* =========================================================================
     5. CROSS-TAB BUS
     Real-time messaging between tabs (kiosk <-> reception console). Uses
     BroadcastChannel where available and ALSO mirrors through a localStorage
     key so the 'storage' event delivers to tabs even when BroadcastChannel is
     flaky on file://. Messages carry an id and receivers dedupe on it.
     A message is never delivered back to the tab that sent it (matching
     BroadcastChannel semantics) - callers that need their own side-effect must
     act locally as well.
     ========================================================================= */
  var _bc = null;
  try {
    if (typeof window.BroadcastChannel === "function") {
      _bc = new window.BroadcastChannel("theminibar");
    }
  } catch (e) { _bc = null; }

  var _busListeners = [];
  var _seen = {}; // id -> true, to dedupe BC + storage double-delivery

  function _deliver(msg) {
    if (!msg || !msg.id) return;
    if (_seen[msg.id]) return;
    _seen[msg.id] = true;
    for (var i = 0; i < _busListeners.length; i++) {
      try { _busListeners[i](msg.type, msg.payload, msg); } catch (e) {}
    }
  }

  if (_bc) {
    _bc.onmessage = function (ev) { _deliver(ev.data); };
  }
  // storage-event fallback (fires only in OTHER tabs, same origin)
  window.addEventListener("storage", function (ev) {
    if (ev.key !== KEYS.bus || !ev.newValue) return;
    try { _deliver(JSON.parse(ev.newValue)); } catch (e) {}
  });

  var Bus = {
    post: function (type, payload) {
      var msg = { id: MB.uid("msg"), type: type, payload: payload, ts: Date.now() };
      _seen[msg.id] = true; // never deliver our own message back to us
      if (_bc) { try { _bc.postMessage(msg); } catch (e) {} }
      LS.set(KEYS.bus, msg); // triggers 'storage' in other tabs
    },
    on: function (cb) { _busListeners.push(cb); }
  };
  MB.bus = Bus;

  /* =========================================================================
     6. STORE  (the mock networked backend)
     ========================================================================= */
  var _approvalResolvers = {}; // requestId -> { resolve, timer }

  var Store = {

    /* ---- Audit trail ---------------------------------------------------
       Every age check, approval, payment and vend is written here with a
       timestamp. This is the hotel's due-diligence evidence, so it is
       append-only and never overwritten. */
    audit: function (event, detail, ctx) {
      ctx = ctx || {};
      var entry = {
        id: MB.uid("aud"),
        ts: new Date().toISOString(),
        event: event,                    // e.g. 'age_estimate', 'vend'
        mobile: ctx.mobile || null,
        room: ctx.room || null,
        sessionId: ctx.sessionId || null,
        mode: MB.config.MODE,
        detail: detail || {}
      };
      var log = LS.get(KEYS.audit, []);
      log.push(entry);
      LS.set(KEYS.audit, log);
      Bus.post("audit:new", entry); // consoles can tail the audit live
      return entry;
    },
    getAudit: function () { return LS.get(KEYS.audit, []); },

    /* ---- Guest sessions (keyed by mobile + room) ---------------------- */
    startSession: function (mobile, room) {
      mobile = String(mobile || "").replace(/\s/g, "");
      room = String(room || "").trim();
      var sessions = LS.get(KEYS.sessions, {});
      var id = MB.uid("sess");
      var session = {
        id: id,
        mobile: mobile,
        room: room,
        startedAt: new Date().toISOString(),
        endedAt: null
      };
      sessions[id] = session;
      LS.set(KEYS.sessions, sessions);
      Store.audit("session_start", { mobile: mobile, room: room },
        { mobile: mobile, room: room, sessionId: id });
      Bus.post("session:start", session);
      return session;
    },
    endSession: function (id) {
      var sessions = LS.get(KEYS.sessions, {});
      if (sessions[id]) {
        sessions[id].endedAt = new Date().toISOString();
        LS.set(KEYS.sessions, sessions);
        Store.audit("session_end", {}, { sessionId: id, mobile: sessions[id].mobile, room: sessions[id].room });
      }
    },
    getSession: function (id) {
      var sessions = LS.get(KEYS.sessions, {});
      return sessions[id] || null;
    },

    /* ---- OTP mobile verification (identity, NOT age) ------------------
       A mobile stays verified for STAY_WINDOW_DAYS. This is what makes the
       daily cap real: the cap tracks against a number the guest proved is
       theirs, so they cannot type a random number to reset their limit. */
    markVerified: function (mobile) {
      mobile = String(mobile || "").replace(/\s/g, "");
      var now = Date.now();
      var rec = {
        verifiedAt: new Date(now).toISOString(),
        expiresAt: new Date(now + MB.config.STAY_WINDOW_DAYS * 86400000).toISOString()
      };
      var all = LS.get(KEYS.verified, {});
      all[mobile] = rec;
      LS.set(KEYS.verified, all);
      Store.audit("otp_verified", { expiresAt: rec.expiresAt, windowDays: MB.config.STAY_WINDOW_DAYS }, { mobile: mobile });
      return rec;
    },
    verificationInfo: function (mobile) {
      mobile = String(mobile || "").replace(/\s/g, "");
      var all = LS.get(KEYS.verified, {});
      return all[mobile] || null;
    },
    // True if this mobile is currently verified within its stay window.
    isVerified: function (mobile) {
      if (MB.demo.forceWindowExpired) return false; // demo: fast-forward expiry
      var rec = Store.verificationInfo(mobile);
      if (!rec) return false;
      return Date.now() < new Date(rec.expiresAt).getTime();
    },

    /* ---- Daily alcohol counter (per mobile, resets at local midnight) -- */
    getAlcoholCount: function (mobile, date) {
      mobile = String(mobile || "").replace(/\s/g, "");
      var daily = LS.get(KEYS.daily, {});
      var day = daily[MB.dayKey(date)] || {};
      return day[mobile] || 0;
    },

    /* canBuyAlcohol(mobile, qty) -> decision object.
       qty is the number of alcoholic DRINKS the guest is trying to buy now. */
    canBuyAlcohol: function (mobile, qty) {
      qty = qty || 0;
      var cap = MB.config.DAILY_ALCOHOL_CAP;
      var used = Store.getAlcoholCount(mobile);

      // Demo hook: force the "limit reached" state for presenting.
      if (MB.demo.forceLimitReached) {
        return { ok: false, cap: cap, used: cap, requested: qty, remaining: 0, wouldBe: cap + qty, reason: "demo_forced" };
      }

      var wouldBe = used + qty;
      var ok = wouldBe <= cap;
      return {
        ok: ok,
        cap: cap,
        used: used,
        requested: qty,
        remaining: Math.max(0, cap - used),
        wouldBe: wouldBe,
        reason: ok ? null : "daily_cap"
      };
    },

    /* recordPurchase - call AFTER payment + vend succeed. Increments the daily
       alcohol counter and writes the purchase + a 'purchase_complete' audit.
       arg: { session, summary (from MB.summariseCart), txnId, vends:[{slot,dispensed}] } */
    recordPurchase: function (arg) {
      var session = arg.session || {};
      var summary = arg.summary;
      var mobile = String(session.mobile || "").replace(/\s/g, "");

      // increment the daily counter by alcoholic drinks in this order
      if (summary.alcoholDrinks > 0) {
        var daily = LS.get(KEYS.daily, {});
        var dk = MB.dayKey();
        if (!daily[dk]) daily[dk] = {};
        daily[dk][mobile] = (daily[dk][mobile] || 0) + summary.alcoholDrinks;
        LS.set(KEYS.daily, daily);
      }

      var purchase = {
        id: MB.uid("pur"),
        ts: new Date().toISOString(),
        sessionId: session.id || null,
        mobile: mobile,
        room: session.room || null,
        lines: summary.lines.map(function (l) {
          return { id: l.id, name: l.item.name, qty: l.qty, priceCents: l.item.priceCents, isAlcohol: l.item.isAlcohol, slot: l.item.slot };
        }),
        totalCents: summary.totalCents,
        alcoholDrinks: summary.alcoholDrinks,
        standardDrinks: summary.standardDrinks,
        txnId: arg.txnId || null,
        vends: arg.vends || [],
        mode: MB.config.MODE
      };
      var log = LS.get(KEYS.purchases, []);
      log.push(purchase);
      LS.set(KEYS.purchases, log);

      Store.audit("purchase_complete", {
        totalCents: purchase.totalCents,
        alcoholDrinks: purchase.alcoholDrinks,
        standardDrinks: purchase.standardDrinks,
        txnId: purchase.txnId
      }, { mobile: mobile, room: purchase.room, sessionId: purchase.sessionId });

      Bus.post("purchase:new", purchase);
      return purchase;
    },
    getPurchases: function () { return LS.get(KEYS.purchases, []); },

    /* ---- OPTIONAL OVERSIGHT HOOK (dormant) ----------------------------
       requestApproval / respondApproval / listPending exist ONLY as a future
       oversight hook. The Mini Bar ships fully automated (MODE 'automated') and
       the kiosk never calls these. They are kept so that if a regulator ever
       required a human in the loop, a reception console could be built against
       this exact core with no re-architecting.

       requestApproval(session, summary) posts a pending request over the bus; a
       console would call respondApproval to answer. Returns a Promise resolving
       with the decision. With no console connected, MB.demo.standalone
       auto-resolves after MB.demo.approvalMs. */
    requestApproval: function (session, summary) {
      var req = {
        id: MB.uid("apr"),
        ts: new Date().toISOString(),
        sessionId: session.id || null,
        mobile: session.mobile || null,
        room: session.room || null,
        summary: {
          lines: summary.lines.map(function (l) { return { name: l.item.name, qty: l.qty, isAlcohol: l.item.isAlcohol }; }),
          totalCents: summary.totalCents,
          alcoholDrinks: summary.alcoholDrinks,
          standardDrinks: summary.standardDrinks
        },
        status: "pending",   // pending | approved | denied
        decidedBy: null,
        note: null
      };

      // persist so a console can list it
      var pend = LS.get(KEYS.pending, {});
      pend[req.id] = req;
      LS.set(KEYS.pending, pend);

      Store.audit("approval_requested", {
        totalCents: summary.totalCents, alcoholDrinks: summary.alcoholDrinks
      }, { mobile: req.mobile, room: req.room, sessionId: req.sessionId });

      Bus.post("approval:request", req);

      return new Promise(function (resolve) {
        var timer = null;
        if (MB.demo.standalone) {
          // Local auto-resolve fallback (no console connected yet).
          timer = setTimeout(function () {
            _finishApproval(req.id, {
              approved: MB.demo.autoApprove !== false,
              decidedBy: "auto (standalone demo)",
              note: MB.demo.autoApprove !== false ? "No reception console connected - auto-approved for demo" : "No reception console connected - auto-denied for demo"
            });
          }, MB.demo.approvalMs || 2600);
        }
        _approvalResolvers[req.id] = { resolve: resolve, timer: timer };
      });
    },

    // Called by a RECEPTION CONSOLE (another tab) to answer a request.
    respondApproval: function (requestId, approved, decidedBy, note) {
      var result = {
        approved: !!approved,
        decidedBy: decidedBy || "reception",
        note: note || null
      };
      // update stored record on this side
      _writeApprovalOutcome(requestId, result);
      // tell the kiosk tab
      Bus.post("approval:response", { requestId: requestId, result: result });
      // if the request happens to be awaited in THIS tab too, finish it
      _finishApproval(requestId, result);
      return result;
    },

    listPending: function () {
      var pend = LS.get(KEYS.pending, {});
      var out = [];
      for (var k in pend) {
        if (pend[k].status === "pending") out.push(pend[k]);
      }
      out.sort(function (a, b) { return a.ts < b.ts ? -1 : 1; });
      return out;
    },
    getApproval: function (id) {
      var pend = LS.get(KEYS.pending, {});
      return pend[id] || null;
    }
  };

  // Update the persisted approval record with its outcome.
  function _writeApprovalOutcome(requestId, result) {
    var pend = LS.get(KEYS.pending, {});
    if (pend[requestId]) {
      pend[requestId].status = result.approved ? "approved" : "denied";
      pend[requestId].decidedBy = result.decidedBy;
      pend[requestId].note = result.note;
      pend[requestId].decidedAt = new Date().toISOString();
      LS.set(KEYS.pending, pend);
    }
    Store.audit("approval_resolved", {
      requestId: requestId, approved: result.approved, decidedBy: result.decidedBy
    }, pend[requestId] ? { mobile: pend[requestId].mobile, room: pend[requestId].room, sessionId: pend[requestId].sessionId } : {});
  }

  // Resolve the awaiting Promise in the kiosk tab (idempotent).
  function _finishApproval(requestId, result) {
    var entry = _approvalResolvers[requestId];
    if (!entry) return;
    if (entry.timer) clearTimeout(entry.timer);
    delete _approvalResolvers[requestId];
    // ensure the local record reflects the outcome even if it was decided here
    _writeApprovalOutcome(requestId, result);
    entry.resolve(result);
  }

  // Any tab awaiting a request will finish it when the response arrives.
  Bus.on(function (type, payload) {
    if (type === "approval:response" && payload && payload.requestId) {
      _finishApproval(payload.requestId, payload.result);
    }
  });

  MB.store = Store;

  /* =========================================================================
     7. INTEGRATIONS  (STUBS - the only mocked parts)
     Each keeps the REAL interface shape and returns a Promise, with realistic
     delays and a demo hook to force outcomes. Swap the body for the real
     vendor SDK call and the rest of the app is unchanged.
     ========================================================================= */
  function _wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  MB.integrations = {

    age: {
      /* estimate({ photoOptional }) -> { estimatedAge, confidence }
         TODO(real): Yoti facial age estimation SDK, on-device, no image
         retention. Returns an estimated age band + confidence; the frame
         never leaves the machine. */
      estimate: function (opts) {
        opts = opts || {};
        return _wait(2000).then(function () {
          // Demo hook: MB.demo.ageOutcome = 'pass' (clearly of age) or
          // 'under' (lands under the BUFFER_AGE so an ID check is forced).
          if (MB.demo.ageOutcome === "under") {
            return { estimatedAge: 24, confidence: 0.71 };
          }
          return { estimatedAge: 34, confidence: 0.93 };
        });
      },

      /* verifyId() -> { verified, over18 }
         TODO(real): IDVerse / greenID / Jumio document + liveness check, or
         ConnectID digital identity. Returns whether the ID verified and
         whether the holder is 18+. We never store the document. */
      verifyId: function () {
        return _wait(2200).then(function () {
          // Demo hook: MB.demo.idOutcome = 'fail' to simulate an under-18 / no
          // valid ID outcome (blocks the sale).
          if (MB.demo.idOutcome === "fail") {
            return { verified: true, over18: false };
          }
          return { verified: true, over18: true };
        });
      }
    },

    otp: {
      /* send(mobile) -> { sent, ref }
         TODO(real): Mobile Message SMS API (infra already in place). Sends a
         one-time code to the guest's mobile at LOGIN to prove the number is
         really theirs. This verifies IDENTITY, not age. */
      send: function (mobile) {
        return _wait(1200).then(function () {
          // In the real build the code is generated server-side and texted; the
          // kiosk never sees it. Here we expose a demo code so it can be typed.
          return { sent: true, ref: "OTP-" + Date.now().toString(36).toUpperCase(), demoCode: "123456", mobile: mobile };
        });
      },

      /* verify(mobile, code) -> { verified }
         TODO(real): Mobile Message verify endpoint (or server-side compare).
         On success the caller marks the number verified for STAY_WINDOW_DAYS. */
      verify: function (mobile, code) {
        return _wait(1200).then(function () {
          // Demo hook: MB.demo.otpOutcome = 'ok' | 'wrong'.
          if (MB.demo.otpOutcome === "wrong") return { verified: false, reason: "wrong_code" };
          return { verified: true };
        });
      }
    },

    payment: {
      /* charge(amountCents, ref) -> { ok, txnId }
         TODO(real): Nayax cashless reader (card / contactless tap only, no cash).
         amountCents is an integer; ref links the charge to the session for
         reconciliation. */
      charge: function (amountCents, ref) {
        return _wait(1900).then(function () {
          if (MB.demo.paymentOutcome === "decline") {
            return { ok: false, txnId: null, reason: "card_declined" };
          }
          return { ok: true, txnId: "TXN-" + Date.now().toString(36).toUpperCase(), amountCents: amountCents, ref: ref || null };
        });
      }
    },

    machine: {
      /* vend(slot) -> { dispensed }
         TODO(real): MDB cashless-authorise to the vending controller, then
         VendAssure (or equivalent) confirms the product actually dropped. One
         call per unit; the caller loops over the cart. */
      vend: function (slot) {
        return _wait(1200).then(function () {
          if (MB.demo.vendOutcome === "jam") {
            return { dispensed: false, slot: slot, reason: "vend_failed" };
          }
          return { dispensed: true, slot: slot };
        });
      }
    }
  };

  /* =========================================================================
     8. DEMO CONTROLS
     Presenting hooks only. None of this appears to a real guest, and in a real
     build MB.demo.standalone would be false and the *Outcome hooks removed.
     ========================================================================= */
  MB.demo = {
    standalone: true,       // true = reception approval auto-resolves locally
    autoApprove: true,      // when standalone, approve (true) or deny (false)
    approvalMs: 2600,       // auto-resolve delay
    ageOutcome: "pass",     // 'pass' | 'under'
    idOutcome: "ok",        // 'ok' | 'fail'
    otpOutcome: "ok",       // 'ok' | 'wrong'  (mobile OTP at login)
    forceWindowExpired: false, // true = pretend the stay window has lapsed, forcing fresh OTP
    paymentOutcome: "ok",   // 'ok' | 'decline'
    vendOutcome: "ok",      // 'ok' | 'jam'
    forceLimitReached: false // true = daily cap pretends to be already hit
  };

  /* ---- Danger button for demos: wipe all persisted state ---- */
  MB.resetAll = function () {
    LS.set(KEYS.daily, {});
    LS.set(KEYS.sessions, {});
    LS.set(KEYS.verified, {});
    LS.set(KEYS.pending, {});
    LS.set(KEYS.purchases, []);
    LS.set(KEYS.audit, []);
    LS.set(KEYS.bus, null);
  };

  MB.version = "1.0.0-mvp";
  window.MB = MB;
})();

/* ===========================================================================
   ADMIN EXTENSIONS  (additive, appended after the core above)
   ---------------------------------------------------------------------------
   These power the back-office / admin console (admin.html). They are strictly
   ADDITIVE: nothing the guest kiosk relies on is changed. Everything here talks
   to the SAME localStorage + BroadcastChannel bus as the core, so an edit made
   in the admin (a price change, a new product, a policy tweak) is persisted and
   picked up by the kiosk on its next load, and sales/refusals made at the kiosk
   show up live in the admin.

   New namespace: MB.admin.*  (catalogue add/edit/remove, policy config, mock
   machines/hotels, and read-only sales/refusal analytics.)
   =========================================================================== */
(function () {
  "use strict";
  var MB = window.MB;
  if (!MB) return;

  /* Independent tiny localStorage wrapper with the same in-memory fallback the
     core uses (the core's internal one is private, so we mirror its behaviour). */
  var _mem = {};
  var _lsOk = (function () {
    try { window.localStorage.setItem("__mba__", "1"); window.localStorage.removeItem("__mba__"); return true; }
    catch (e) { return false; }
  })();
  function lsGet(k, d) {
    try { var r = _lsOk ? window.localStorage.getItem(k) : _mem[k]; if (r === null || r === undefined) return d; return JSON.parse(r); }
    catch (e) { return d; }
  }
  function lsSet(k, v) {
    var r = JSON.stringify(v);
    try { if (_lsOk) window.localStorage.setItem(k, r); else _mem[k] = r; } catch (e) { _mem[k] = r; }
  }

  var K = {
    catalogue: "mb_catalogue",       // persisted catalogue override
    config:    "mb_config_overrides", // persisted policy overrides
    machines:  "mb_machines"          // mock machine/hotel fleet
  };

  // Pristine defaults captured BEFORE any overlay, so the admin can reset.
  var DEFAULT_CATALOGUE = MB.catalogue.map(function (x) { var o = {}; for (var k in x) o[k] = x[k]; return o; });
  var DEFAULT_CONFIG = {}; for (var ck in MB.config) { DEFAULT_CONFIG[ck] = MB.config[ck]; }
  MB._defaults = { catalogue: DEFAULT_CATALOGUE, config: DEFAULT_CONFIG };

  var BASE_CATEGORIES = ["Drinks", "Alcohol", "Snacks", "Essentials"];

  // Replace the live catalogue array IN PLACE so any held reference updates too.
  function replaceCatalogue(arr) {
    MB.catalogue.length = 0;
    for (var i = 0; i < arr.length; i++) MB.catalogue.push(arr[i]);
    rebuildCategories();
  }
  // Keep the fixed category order, then append any custom categories in use.
  function rebuildCategories() {
    var seen = {}, out = [];
    for (var i = 0; i < BASE_CATEGORIES.length; i++) { seen[BASE_CATEGORIES[i]] = 1; out.push(BASE_CATEGORIES[i]); }
    for (var j = 0; j < MB.catalogue.length; j++) {
      var c = MB.catalogue[j].category;
      if (c && !seen[c]) { seen[c] = 1; out.push(c); }
    }
    MB.categories.length = 0;
    for (var m = 0; m < out.length; m++) MB.categories.push(out[m]);
  }

  // Apply persisted overlays at load (before the kiosk/admin render).
  var savedCat = lsGet(K.catalogue, null);
  if (savedCat && savedCat.length) replaceCatalogue(savedCat); else rebuildCategories();

  var savedCfg = lsGet(K.config, null);
  if (savedCfg) { for (var kk in savedCfg) { if (Object.prototype.hasOwnProperty.call(savedCfg, kk)) MB.config[kk] = savedCfg[kk]; } }

  function persistCatalogue() {
    lsSet(K.catalogue, MB.catalogue);
    MB.bus.post("catalogue:changed", { count: MB.catalogue.length });
  }

  /* Mock fleet: one machine per floor, grouped by hotel. Realistic operator
     model for the demo. Persisted so status toggles survive a reload. */
  var DEFAULT_MACHINES = [
    { id: "MB-1041", hotel: "The Langford, Broadbeach", floor: "Level 4",  slots: "A1-D5", status: "online",     stockPct: 94, lastVend: "2026-07-27T22:14:00" },
    { id: "MB-1042", hotel: "The Langford, Broadbeach", floor: "Level 5",  slots: "A1-D5", status: "online",     stockPct: 88, lastVend: "2026-07-27T23:02:00" },
    { id: "MB-1043", hotel: "The Langford, Broadbeach", floor: "Level 6",  slots: "A1-D5", status: "low_stock",  stockPct: 21, lastVend: "2026-07-27T21:40:00" },
    { id: "MB-2011", hotel: "Coastline Suites, Surfers Paradise", floor: "Level 10", slots: "A1-D5", status: "online",  stockPct: 76, lastVend: "2026-07-27T23:31:00" },
    { id: "MB-2012", hotel: "Coastline Suites, Surfers Paradise", floor: "Level 11", slots: "A1-D5", status: "online",  stockPct: 81, lastVend: "2026-07-27T20:55:00" },
    { id: "MB-2013", hotel: "Coastline Suites, Surfers Paradise", floor: "Level 12", slots: "A1-D5", status: "restocking", stockPct: 40, lastVend: "2026-07-27T18:12:00" },
    { id: "MB-3007", hotel: "The Rivergum, Brisbane", floor: "Level 7",  slots: "A1-D5", status: "online",  stockPct: 90, lastVend: "2026-07-27T22:48:00" },
    { id: "MB-3008", hotel: "The Rivergum, Brisbane", floor: "Level 8",  slots: "A1-D5", status: "offline", stockPct: 0,  lastVend: "2026-07-26T09:20:00" }
  ];

  MB.admin = {

    /* -------- Catalogue management (persisted via core) -------- */
    getCatalogue: function () { return MB.catalogue.slice(); },

    addItem: function (item) {
      item = item || {};
      var isAl = !!item.isAlcohol;
      var it = {
        id: item.id || MB.uid("item"),
        name: String(item.name || "Untitled item"),
        category: item.category || "Drinks",
        priceCents: Math.max(0, Math.round(Number(item.priceCents) || 0)),
        isAlcohol: isAl,
        standardDrinks: isAl ? (Number(item.standardDrinks) || 0) : 0,
        slot: String(item.slot || "").toUpperCase(),
        icon: item.icon || (isAl ? "beer" : "can")
      };
      MB.catalogue.push(it);
      rebuildCategories();
      persistCatalogue();
      MB.store.audit("admin_item_add", { id: it.id, name: it.name, category: it.category, priceCents: it.priceCents, isAlcohol: it.isAlcohol }, {});
      return it;
    },

    updateItem: function (id, patch) {
      var it = MB.findItem(id);
      if (!it) return null;
      patch = patch || {};
      if ("name" in patch) it.name = String(patch.name);
      if ("category" in patch) it.category = patch.category;
      if ("priceCents" in patch) it.priceCents = Math.max(0, Math.round(Number(patch.priceCents) || 0));
      if ("isAlcohol" in patch) it.isAlcohol = !!patch.isAlcohol;
      if ("standardDrinks" in patch) it.standardDrinks = Number(patch.standardDrinks) || 0;
      if (!it.isAlcohol) it.standardDrinks = 0;
      if ("slot" in patch) it.slot = String(patch.slot || "").toUpperCase();
      if ("icon" in patch) it.icon = patch.icon;
      rebuildCategories();
      persistCatalogue();
      MB.store.audit("admin_item_edit", { id: it.id, name: it.name, priceCents: it.priceCents, isAlcohol: it.isAlcohol }, {});
      return it;
    },

    removeItem: function (id) {
      for (var i = 0; i < MB.catalogue.length; i++) {
        if (MB.catalogue[i].id === id) {
          var rm = MB.catalogue.splice(i, 1)[0];
          rebuildCategories();
          persistCatalogue();
          MB.store.audit("admin_item_remove", { id: id, name: rm.name }, {});
          return true;
        }
      }
      return false;
    },

    resetCatalogue: function () {
      var copy = MB._defaults.catalogue.map(function (x) { var o = {}; for (var k in x) o[k] = x[k]; return o; });
      replaceCatalogue(copy);
      persistCatalogue();
      MB.store.audit("admin_catalogue_reset", {}, {});
    },

    /* -------- Policy / config controls -------- */
    updateConfig: function (patch) {
      patch = patch || {};
      var changed = {};
      ["BUFFER_AGE", "DAILY_ALCOHOL_CAP", "STAY_WINDOW_DAYS"].forEach(function (k) {
        if (k in patch && patch[k] !== null && patch[k] !== "") {
          var v = Math.round(Number(patch[k]));
          if (!isNaN(v) && v >= 0) { MB.config[k] = v; changed[k] = v; }
        }
      });
      var overlay = lsGet(K.config, {}) || {};
      for (var c in changed) overlay[c] = changed[c];
      lsSet(K.config, overlay);
      MB.bus.post("config:changed", changed);
      MB.store.audit("admin_config_update", changed, {});
      return changed;
    },

    resetConfig: function () {
      var d = MB._defaults.config;
      MB.config.BUFFER_AGE = d.BUFFER_AGE;
      MB.config.DAILY_ALCOHOL_CAP = d.DAILY_ALCOHOL_CAP;
      MB.config.STAY_WINDOW_DAYS = d.STAY_WINDOW_DAYS;
      lsSet(K.config, {});
      MB.bus.post("config:changed", { reset: true });
      MB.store.audit("admin_config_reset", {}, {});
    },

    /* -------- Mock machines / hotels -------- */
    getMachines: function () {
      var m = lsGet(K.machines, null);
      if (!m) { m = DEFAULT_MACHINES.map(function (x) { var o = {}; for (var k in x) o[k] = x[k]; return o; }); lsSet(K.machines, m); }
      return m;
    },
    setMachineStatus: function (id, status) {
      var m = MB.admin.getMachines();
      for (var i = 0; i < m.length; i++) { if (m[i].id === id) m[i].status = status; }
      lsSet(K.machines, m);
      MB.bus.post("machines:changed", { id: id, status: status });
      MB.store.audit("admin_machine_status", { id: id, status: status }, {});
      return m;
    },

    /* -------- Read-only analytics over the real purchase + audit logs -------- */
    salesSummary: function (dayKey) {
      var day = dayKey || MB.dayKey();
      var purchases = MB.store.getPurchases();
      var out = { day: day, revenueCents: 0, units: 0, alcoholUnits: 0, nonAlcoholUnits: 0, standardDrinks: 0, txns: 0 };
      for (var i = 0; i < purchases.length; i++) {
        var p = purchases[i];
        if (MB.dayKey(new Date(p.ts)) !== day) continue;
        out.txns++;
        out.revenueCents += p.totalCents || 0;
        var lines = p.lines || [];
        for (var j = 0; j < lines.length; j++) {
          var l = lines[j];
          out.units += l.qty;
          if (l.isAlcohol) out.alcoholUnits += l.qty; else out.nonAlcoholUnits += l.qty;
        }
        out.standardDrinks += p.standardDrinks || 0;
      }
      out.standardDrinks = Math.round(out.standardDrinks * 10) / 10;
      return out;
    },

    // Count refusals in the audit log. Pass a dayKey to scope to one day.
    refusalCount: function (dayKey) {
      var log = MB.store.getAudit();
      var n = 0;
      for (var i = 0; i < log.length; i++) {
        var a = log[i], d = a.detail || {};
        if (dayKey && MB.dayKey(new Date(a.ts)) !== dayKey) continue;
        var refuse = (a.event === "id_verify" && !d.over18) ||
                     (a.event === "limit_check" && !d.ok) ||
                     (a.event === "payment" && !d.ok) ||
                     (a.event === "vend" && !d.dispensed) ||
                     (a.event === "otp_failed") ||
                     (a.event === "approval_resolved" && !d.approved);
        if (refuse) n++;
      }
      return n;
    }
  };
})();

/* ===========================================================================
   ADMIN EXTENSIONS - PART 2  (additive, appended after MB.admin above)
   ---------------------------------------------------------------------------
   Two back-office capabilities bolted onto the SAME MB.admin namespace, using
   the SAME localStorage the core uses. Strictly additive: nothing the kiosk
   relies on is touched, and MB.admin.* keeps all of its existing methods.

     1. VENUE COMMISSION + MONTHLY PAYOUT REPORT
        Each venue (hotel) carries a commission percentage. The Mini Bar pays
        each venue their commission on the 1st of the month. payoutReport(month)
        returns, per venue: total sales, commission %, commission owed and the
        payout total, ready to print or export as CSV.

     2. PER-MACHINE RESTOCK PICK LIST
        For a chosen machine, pickList(machineId) returns every product with its
        par (capacity), current stock and the quantity to pick to refill to par.
        This is what the restock team picks before heading to the hotel.
   =========================================================================== */
(function () {
  "use strict";
  var MB = window.MB;
  if (!MB || !MB.admin) return;

  /* Reuse the same tiny localStorage wrapper behaviour as the core/admin. */
  var _mem = {};
  var _lsOk = (function () {
    try { window.localStorage.setItem("__mba2__", "1"); window.localStorage.removeItem("__mba2__"); return true; }
    catch (e) { return false; }
  })();
  function lsGet(k, d) {
    try { var r = _lsOk ? window.localStorage.getItem(k) : _mem[k]; if (r === null || r === undefined) return d; return JSON.parse(r); }
    catch (e) { return d; }
  }
  function lsSet(k, v) {
    var r = JSON.stringify(v);
    try { if (_lsOk) window.localStorage.setItem(k, r); else _mem[k] = r; } catch (e) { _mem[k] = r; }
  }

  var K = {
    commission: "mb_venue_commission" // { "<hotel name>": percentage }
  };

  var DEFAULT_COMMISSION_PCT = 10; // house default until a venue is set otherwise
  var MONTH_NAMES = ["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"];

  /* ---- Deterministic pseudo-random so simulated figures are STABLE ----------
     A given venue+month (or machine+product) always yields the same numbers, so
     the report/pick list does not jump around between renders. This is only for
     demo/simulation; real sales come from MB.store.getPurchases(). */
  function hashStr(s) {
    var h = 2166136261;
    s = String(s);
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function seededRand(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

  /* ---- Month helpers -------------------------------------------------------- */
  function monthKeyOf(date) {
    var d = date || new Date();
    return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2);
  }
  function monthLabel(mk) {
    var p = String(mk).split("-");
    var m = parseInt(p[1], 10);
    return (MONTH_NAMES[m - 1] || "?") + " " + p[0];
  }
  // Days that count for a month: a full month in the past, elapsed days for the
  // current month, and 0 for a future month (so a payout is never overstated).
  function daysCounted(mk) {
    var p = String(mk).split("-");
    var y = parseInt(p[0], 10), m = parseInt(p[1], 10);
    var now = new Date();
    var total = new Date(y, m, 0).getDate();
    if (y === now.getFullYear() && m === now.getMonth() + 1) return now.getDate();
    var firstOfMonth = new Date(y, m - 1, 1);
    if (firstOfMonth.getTime() > now.getTime()) return 0;
    return total;
  }

  /* =========================================================================
     1. VENUE COMMISSION + MONTHLY PAYOUT REPORT
     ========================================================================= */

  /* Derive the venue list from the machine fleet (one venue per unique hotel),
     attaching each venue's commission percentage (persisted override or the
     house default) and its machine count. */
  MB.admin.getVenues = function () {
    var machines = MB.admin.getMachines();
    var overrides = lsGet(K.commission, {}) || {};
    var seen = {}, out = [];
    for (var i = 0; i < machines.length; i++) {
      var h = machines[i].hotel;
      if (!seen[h]) {
        seen[h] = { hotel: h, commissionPct: (h in overrides) ? overrides[h] : DEFAULT_COMMISSION_PCT, machineCount: 0 };
        out.push(seen[h]);
      }
      seen[h].machineCount++;
    }
    return out;
  };

  // Set (and persist) a venue's commission percentage. Clamped to 0..100.
  MB.admin.setVenueCommission = function (hotel, pct) {
    var v = Number(pct);
    if (isNaN(v)) return null;
    v = Math.round(clamp(v, 0, 100) * 100) / 100; // allow one/two decimals
    var overrides = lsGet(K.commission, {}) || {};
    overrides[hotel] = v;
    lsSet(K.commission, overrides);
    MB.bus.post("venues:changed", { hotel: hotel, commissionPct: v });
    MB.store.audit("admin_venue_commission", { hotel: hotel, commissionPct: v }, {});
    return v;
  };

  // The last `count` months (default 6) as { key, label }, newest first.
  MB.admin.availablePayoutMonths = function (count) {
    count = count || 6;
    var out = [];
    var now = new Date();
    var y = now.getFullYear(), m = now.getMonth(); // 0-based
    for (var i = 0; i < count; i++) {
      var mk = y + "-" + ("0" + (m + 1)).slice(-2);
      out.push({ key: mk, label: monthLabel(mk) });
      m--; if (m < 0) { m = 11; y--; }
    }
    return out;
  };

  /* Attribute real kiosk purchases to venues. The mock purchase log does not tag
     a hotel per sale, so we attribute each purchase deterministically across the
     venue list (by verified mobile, else room, else purchase id). This spreads
     real sales sensibly and stably without ever changing the kiosk. */
  function realSalesByVenue(mk, venues) {
    var by = {};
    for (var i = 0; i < venues.length; i++) by[venues[i].hotel] = { salesCents: 0, units: 0, txns: 0 };
    if (!venues.length) return by;
    var purchases = MB.store.getPurchases();
    for (var p = 0; p < purchases.length; p++) {
      var pur = purchases[p];
      if (monthKeyOf(new Date(pur.ts)) !== mk) continue;
      var key = pur.mobile || pur.room || pur.id || "";
      var idx = hashStr(key) % venues.length;
      var bucket = by[venues[idx].hotel];
      bucket.salesCents += pur.totalCents || 0;
      bucket.txns += 1;
      var lines = pur.lines || [];
      for (var l = 0; l < lines.length; l++) bucket.units += lines[l].qty || 0;
    }
    return by;
  }

  /* Simulate a realistic month of trading for a venue so the payout report
     always demonstrates the feature even when the live purchase log is thin.
     Deterministic: same venue + month => same figures. Scaled by machine count
     and the number of trading days counted for that month. */
  function simulatedVenueMonth(venue, mk) {
    var days = daysCounted(mk);
    if (days <= 0) return { salesCents: 0, units: 0, txns: 0 };
    var rnd = seededRand(hashStr(venue.hotel + "|" + mk));
    var perMachineDaily = 5 + Math.floor(rnd() * 10);        // 5..14 sales / machine / day
    var txns = Math.round(perMachineDaily * venue.machineCount * days);
    var avgBasketUnits = 1.3 + rnd() * 0.9;                  // 1.3..2.2 units / sale
    var units = Math.round(txns * avgBasketUnits);
    var avgUnitCents = 700 + Math.round(rnd() * 550);        // ~$7.00..$12.50 / unit
    var salesCents = units * avgUnitCents;
    return { salesCents: salesCents, units: units, txns: txns };
  }

  /* payoutReport(monthKey) -> full monthly payout run.
     Per venue: total sales (simulated month + any attributed real kiosk sales),
     commission %, commission owed, and the payout total The Mini Bar pays that
     venue on the 1st. Also returns fleet totals.

     NOTE (future): this is the hook where a XERO sync would raise each venue's
     monthly commission bill (one accounts-payable invoice per venue) from these
     same figures. For now we only compute, display and export - no network. */
  MB.admin.payoutReport = function (monthKey) {
    var mk = monthKey || monthKeyOf();
    var venues = MB.admin.getVenues();
    var real = realSalesByVenue(mk, venues);
    var rows = [];
    var totals = { salesCents: 0, units: 0, txns: 0, commissionCents: 0, payoutCents: 0 };
    for (var i = 0; i < venues.length; i++) {
      var v = venues[i];
      var sim = simulatedVenueMonth(v, mk);
      var r = real[v.hotel] || { salesCents: 0, units: 0, txns: 0 };
      var salesCents = sim.salesCents + r.salesCents;
      var units = sim.units + r.units;
      var txns = sim.txns + r.txns;
      var commissionCents = Math.round(salesCents * v.commissionPct / 100);
      // The venue is paid their commission; The Mini Bar retains the remainder.
      var payoutCents = commissionCents;
      var retainedCents = salesCents - commissionCents;
      rows.push({
        hotel: v.hotel,
        machineCount: v.machineCount,
        commissionPct: v.commissionPct,
        salesCents: salesCents,
        units: units,
        txns: txns,
        commissionCents: commissionCents,
        payoutCents: payoutCents,
        retainedCents: retainedCents,
        realSalesCents: r.salesCents,
        realTxns: r.txns
      });
      totals.salesCents += salesCents;
      totals.units += units;
      totals.txns += txns;
      totals.commissionCents += commissionCents;
      totals.payoutCents += payoutCents;
    }
    totals.retainedCents = totals.salesCents - totals.commissionCents;
    return {
      month: mk,
      monthLabel: monthLabel(mk),
      payDate: nextFirstOfMonthAfter(mk), // when The Mini Bar pays venues for this month
      rows: rows,
      totals: totals
    };
  };

  // The payout date for a trading month is the 1st of the FOLLOWING month.
  function nextFirstOfMonthAfter(mk) {
    var p = String(mk).split("-");
    var y = parseInt(p[0], 10), m = parseInt(p[1], 10); // 1-based
    m += 1; if (m > 12) { m = 1; y++; }
    return "01/" + ("0" + m).slice(-2) + "/" + y;
  }

  /* =========================================================================
     2. PER-MACHINE RESTOCK PICK LIST
     ========================================================================= */

  // Par (capacity) for a product in a machine column. Snacks/drinks/alcohol hold
  // more facings than the bulkier essentials column.
  function parFor(item) {
    return item.category === "Essentials" ? 5 : 8;
  }

  /* Deterministic simulated current stock for a machine's slots. Fuller machines
     (higher stockPct) sit closer to par; an offline/empty machine reads as fully
     depleted. Stable per machine + product so the pick list does not flicker. */
  MB.admin.getMachineStock = function (machineId) {
    var machines = MB.admin.getMachines();
    var machine = null;
    for (var i = 0; i < machines.length; i++) { if (machines[i].id === machineId) { machine = machines[i]; break; } }
    if (!machine) return null;
    var fill = clamp((machine.stockPct || 0) / 100, 0, 1);
    var lines = [];
    for (var j = 0; j < MB.catalogue.length; j++) {
      var it = MB.catalogue[j];
      var par = parFor(it);
      var rnd = seededRand(hashStr(machineId + "|" + it.id));
      // per-slot depletion varies around the machine's overall fill level
      var slotFill = clamp(fill * (0.55 + rnd() * 0.85), 0, 1);
      var current = Math.round(par * slotFill);
      if (machine.stockPct <= 0) current = 0; // offline / emptied machine
      current = clamp(current, 0, par);
      lines.push({
        id: it.id, slot: it.slot, name: it.name, category: it.category,
        isAlcohol: !!it.isAlcohol, par: par, current: current
      });
    }
    return { machine: machine, lines: lines };
  };

  /* pickList(machineId) -> the restock pick list for one machine.
     Each product with its par, current stock and QTY TO PICK to refill to par.
     Stock levels stand in for recent-sales depletion (a fuller machine needs
     less; a low/offline machine needs a full refill). Printable + CSV in admin. */
  MB.admin.pickList = function (machineId) {
    var stock = MB.admin.getMachineStock(machineId);
    if (!stock) return null;
    var order = MB.categories;
    var lines = stock.lines.map(function (l) {
      var o = {}; for (var k in l) o[k] = l[k];
      o.pick = Math.max(0, l.par - l.current);
      return o;
    });
    lines.sort(function (a, b) {
      var ca = order.indexOf(a.category), cb = order.indexOf(b.category);
      if (ca !== cb) return ca - cb;
      return (a.slot || "").localeCompare(b.slot || "");
    });
    var totalPick = 0, skusToPick = 0;
    for (var i = 0; i < lines.length; i++) { totalPick += lines[i].pick; if (lines[i].pick > 0) skusToPick++; }
    return {
      machine: stock.machine,
      generatedAt: new Date().toISOString(),
      lines: lines,
      totals: { unitsToPick: totalPick, skusToPick: skusToPick, slots: lines.length }
    };
  };
})();
