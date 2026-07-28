/* ===========================================================================
   THE MINI BAR - core.js
   Shared foundation for the guest kiosk and the back-office admin console,
   both built against this exact same core.

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
   localStorage 'storage' event fallback), so a kiosk tab and an admin console
   tab in the same browser stay in sync in real time.
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
    // is deliberately no human-approval step - that is the clunky competitor
    // model this machine exists to replace. 'automated' is the only mode.
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
     (kiosk checkout, audit, receipts). */
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
    bus:       "mb_bus"         // last cross-tab message (storage-event fallback)
  };

  /* =========================================================================
     5. CROSS-TAB BUS
     Real-time messaging between tabs (kiosk <-> admin console). Uses
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
  var Store = {

    /* ---- Audit trail ---------------------------------------------------
       Every age check, payment, vend and restock is written here with a
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
    getPurchases: function () { return LS.get(KEYS.purchases, []); }
  };

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
     build the *Outcome hooks would be removed.
     ========================================================================= */
  MB.demo = {
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
                     (a.event === "otp_failed");
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

/* ===========================================================================
   ADMIN EXTENSIONS - PART 3  (the real back-office hierarchy + money model)
   ---------------------------------------------------------------------------
   This is the real operator back office. It SUPERSEDES the flat mock fleet and
   commission helpers above by redefining the relevant MB.admin methods (later
   definitions win), and adds the full three-level model:

       CHAIN  (hotel group)  ->  PROPERTY (individual hotel)  ->  MACHINE

   plus:
     - ROLE-BASED ACCESS: an owner/accounts vs staff current-user concept.
       Staff never see a dollar figure or commission anywhere.
     - CHAIN-LEVEL PRICING + PLANOGRAM overrides, with a price-resolution
       function MB.priceFor(productId, ref) the kiosk can adopt later.
     - PER-PROPERTY POLICY (cap / stay window / buffer age) overriding config.
     - REAL PER-MACHINE STOCK + PAR, a printable pick list, and a machine
       restock flow gated behind a 4-digit staff PIN.
     - MONTHLY PAYOUT run rolled up per chain, commission = the property's own
       commission % x that property's sales, with a STUB "Sync to Xero" hook.

   Strictly additive to the guest kiosk: nothing the kiosk calls is changed.
   Everything persists to localStorage and gossips over the same bus.
   =========================================================================== */
(function () {
  "use strict";
  var MB = window.MB;
  if (!MB || !MB.admin) return;

  /* ---- tiny localStorage wrapper (same behaviour as the core) ---- */
  var _mem = {};
  var _lsOk = (function () {
    try { window.localStorage.setItem("__mba3__", "1"); window.localStorage.removeItem("__mba3__"); return true; }
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
    hier: "mb_hier_v1",   // { chains:[], properties:[], machines:[] }
    role: "mb_role_v1"    // current-user role id
  };

  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
  function hashStr(s) {
    var h = 2166136261; s = String(s);
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

  // Par (capacity) for a product's machine column.
  function parFor(item) { return item.category === "Essentials" ? 6 : 10; }

  /* =========================================================================
     ROLE-BASED ACCESS
     OWNER (Dean) and ACCOUNTS can see + edit every dollar figure and every
     commission. STAFF see NO money and NO commission anywhere. This is a
     current-user concept the admin console reads to decide what to render.
     ========================================================================= */
  MB.roles = {
    owner:    { id: "owner",    name: "Dean (Owner)",    email: "dean@theminibar.com.au",     money: true },
    accounts: { id: "accounts", name: "Accounts",        email: "accounts@theminibar.com.au", money: true },
    staff:    { id: "staff",    name: "Operations Staff", email: "staff@theminibar.com.au",    money: false }
  };
  MB.getRole = function () {
    var id = lsGet(K.role, "owner");
    return MB.roles[id] ? MB.roles[id] : MB.roles.owner;
  };
  MB.setRole = function (id) {
    if (!MB.roles[id]) return MB.getRole();
    lsSet(K.role, id);
    MB.bus.post("role:changed", { role: id });
    return MB.roles[id];
  };
  // The one gate the whole UI asks: may the current user see dollar figures?
  MB.canSeeMoney = function () { return !!MB.getRole().money; };

  /* =========================================================================
     SEED - realistic AU hotel chains -> properties -> machines
     ========================================================================= */
  function seedHier() {
    var chains = [
      { id: "ch_mantra",  name: "Mantra Hotels",
        priceOverrides: { "a-craft-lager": 1300, "a-pale-ale": 1300, "d-water-still": 500, "s-chips": 650 },
        planogram: null },                 // null = stocks the full master catalogue
      { id: "ch_rydges",  name: "Rydges Hotels",
        priceOverrides: { "a-craft-lager": 1250, "a-shiraz": 1500, "e-charger": 2800 },
        planogram: catalogueIdsExcept(["e-earplugs"]) }, // Rydges drops ear plugs
      { id: "ch_peppers", name: "Peppers Retreats",
        priceOverrides: {},                // no overrides -> demonstrates default fallback
        planogram: null }
    ];
    var properties = [
      { id: "pr_mantra_view",   chainId: "ch_mantra",  name: "Mantra on View, Surfers Paradise", city: "Surfers Paradise", state: "QLD",
        levels: ["Level 8", "Level 12"], phones: ["07 5579 1000"], emails: ["reservations@mantraonview.com.au"],
        notes: "Flagship high-rise. Loading dock access via Ferny Ave, use service lift 3.",
        commissionPct: 12, policy: { DAILY_ALCOHOL_CAP: 4, STAY_WINDOW_DAYS: 4, BUFFER_AGE: 27 } },
      { id: "pr_mantra_south",  chainId: "ch_mantra",  name: "Mantra Southbank, Melbourne", city: "Melbourne", state: "VIC",
        levels: ["Level 5"], phones: ["03 9020 3000"], emails: ["stay@mantrasouthbank.com.au"],
        notes: "Tighter VIC responsible-service posture: lower daily cap agreed with the venue.",
        commissionPct: 12, policy: { DAILY_ALCOHOL_CAP: 3, STAY_WINDOW_DAYS: 5, BUFFER_AGE: 27 } },
      { id: "pr_rydges_airport", chainId: "ch_rydges", name: "Rydges Gold Coast Airport, Bilinga", city: "Bilinga", state: "QLD",
        levels: ["Level 2", "Level 3"], phones: ["07 5589 0000"], emails: ["frontdesk@rydgesgca.com.au"],
        notes: "Airport property, high turnover. Restock mornings before 10am check-out rush.",
        commissionPct: 10, policy: { DAILY_ALCOHOL_CAP: 4, STAY_WINDOW_DAYS: 3, BUFFER_AGE: 27 } },
      { id: "pr_rydges_southbank", chainId: "ch_rydges", name: "Rydges South Bank, Brisbane", city: "Brisbane", state: "QLD",
        levels: ["Level 9"], phones: ["07 3364 0800"], emails: ["reception@rydgessouthbank.com.au"],
        notes: "",
        commissionPct: 10, policy: { DAILY_ALCOHOL_CAP: 4, STAY_WINDOW_DAYS: 4, BUFFER_AGE: 27 } },
      { id: "pr_peppers_broadbeach", chainId: "ch_peppers", name: "Peppers Broadbeach", city: "Broadbeach", state: "QLD",
        levels: ["Level 14", "Level 20"], phones: ["07 5635 1000"], emails: ["broadbeach@peppers.com.au"],
        notes: "Premium residences. Guest expectation is high, keep facings full.",
        commissionPct: 14, policy: { DAILY_ALCOHOL_CAP: 5, STAY_WINDOW_DAYS: 7, BUFFER_AGE: 27 } }
    ];
    var machineDefs = [
      { id: "MB-MV-01", propertyId: "pr_mantra_view",       level: "Level 8",  status: "online",    pin: "4917" },
      { id: "MB-MV-02", propertyId: "pr_mantra_view",       level: "Level 12", status: "low_stock", pin: "4917" },
      { id: "MB-MS-01", propertyId: "pr_mantra_south",      level: "Level 5",  status: "online",    pin: "2280" },
      { id: "MB-RA-01", propertyId: "pr_rydges_airport",    level: "Level 2",  status: "online",    pin: "7731" },
      { id: "MB-RA-02", propertyId: "pr_rydges_airport",    level: "Level 3",  status: "online",    pin: "7731" },
      { id: "MB-RS-01", propertyId: "pr_rydges_southbank",  level: "Level 9",  status: "offline",   pin: "5064" },
      { id: "MB-PB-01", propertyId: "pr_peppers_broadbeach", level: "Level 14", status: "online",   pin: "3390" },
      { id: "MB-PB-02", propertyId: "pr_peppers_broadbeach", level: "Level 20", status: "online",   pin: "3390" }
    ];
    var machines = machineDefs.map(function (md) {
      var prop = findIn(properties, md.propertyId);
      var chain = findIn(chains, prop.chainId);
      var pids = planogramIdsFor(chain);
      var stock = {}, par = {};
      var rnd = seededRand(hashStr(md.id));
      var slots = [];
      for (var i = 0; i < pids.length; i++) {
        var it = MB.findItem(pids[i]); if (!it) continue;
        var p = parFor(it);
        par[it.id] = p;
        // seed most slots below par so a pick list always has real content
        var cur = md.status === "offline" ? 0 : Math.round(p * (0.15 + rnd() * 0.7));
        stock[it.id] = clamp(cur, 0, p);
        slots.push(it.slot);
      }
      return {
        id: md.id, propertyId: md.propertyId, level: md.level, status: md.status,
        pin: md.pin, slotRange: slotRange(slots), stock: stock, par: par,
        lastVend: "2026-07-27T22:00:00"
      };
    });
    return { chains: chains, properties: properties, machines: machines };
  }

  function catalogueIdsExcept(excl) {
    var out = [];
    for (var i = 0; i < MB.catalogue.length; i++) {
      if (excl.indexOf(MB.catalogue[i].id) === -1) out.push(MB.catalogue[i].id);
    }
    return out;
  }
  function planogramIdsFor(chain) {
    if (chain && chain.planogram && chain.planogram.length) return chain.planogram.slice();
    return MB.catalogue.map(function (x) { return x.id; }); // full master catalogue
  }
  function findIn(arr, id) { for (var i = 0; i < arr.length; i++) if (arr[i].id === id) return arr[i]; return null; }
  function slotRange(slots) {
    if (!slots.length) return "-";
    slots.sort();
    return slots[0] + "-" + slots[slots.length - 1];
  }

  /* ---- load / save the whole hierarchy blob ---- */
  function loadHier() {
    var h = lsGet(K.hier, null);
    if (!h || !h.chains || !h.chains.length) { h = seedHier(); lsSet(K.hier, h); }
    return h;
  }
  function saveHier(h) { lsSet(K.hier, h); }

  /* =========================================================================
     ACCESSORS
     ========================================================================= */
  MB.admin.getChains = function () { return loadHier().chains.slice(); };
  MB.admin.getChain = function (id) { return findIn(loadHier().chains, id); };

  MB.admin.getProperties = function (chainId) {
    var props = loadHier().properties;
    if (!chainId) return props.slice();
    return props.filter(function (p) { return p.chainId === chainId; });
  };
  MB.admin.getProperty = function (id) { return findIn(loadHier().properties, id); };

  MB.admin.getMachinesForProperty = function (propertyId) {
    return loadHier().machines.filter(function (m) { return m.propertyId === propertyId; });
  };
  MB.admin.getMachine = function (id) { return findIn(loadHier().machines, id); };

  // Sum of current stock over sum of par, as a whole-number percentage.
  function stockPctOf(machine) {
    var cur = 0, cap = 0;
    for (var pid in machine.par) { if (!machine.par.hasOwnProperty(pid)) continue; cap += machine.par[pid]; cur += (machine.stock[pid] || 0); }
    return cap ? Math.round(cur / cap * 100) : 0;
  }

  /* getMachines(): flattened fleet view. REDEFINES the old flat mock so the
     dashboard / any legacy caller keeps working, but every row now carries its
     property + chain context and a live stockPct computed from real stock. */
  MB.admin.getMachines = function () {
    var h = loadHier();
    return h.machines.map(function (m) {
      var prop = findIn(h.properties, m.propertyId) || {};
      var chain = findIn(h.chains, prop.chainId) || {};
      return {
        id: m.id, status: m.status, level: m.level, floor: m.level,
        propertyId: m.propertyId, propertyName: prop.name || "", city: prop.city || "", state: prop.state || "",
        chainId: chain.id || "", chainName: chain.name || "",
        hotel: prop.name || "",           // legacy alias used by older views
        slots: m.slotRange || "-", slotRange: m.slotRange || "-",
        stockPct: stockPctOf(m), lastVend: m.lastVend, pin: m.pin
      };
    });
  };

  /* =========================================================================
     CHAIN-LEVEL PRICING + PLANOGRAM  +  PRICE RESOLUTION
     ========================================================================= */

  // Resolve any reference (chainId | propertyId | machineId) to its chain.
  function resolveChain(ref) {
    var h = loadHier();
    var c = findIn(h.chains, ref); if (c) return c;
    var p = findIn(h.properties, ref); if (p) return findIn(h.chains, p.chainId);
    var m = findIn(h.machines, ref);
    if (m) { var pp = findIn(h.properties, m.propertyId); if (pp) return findIn(h.chains, pp.chainId); }
    return null;
  }
  MB.admin.resolveChain = resolveChain;

  /* MB.priceFor(productId, ref)
     The price a given machine/property/chain charges for a product: the chain's
     override if it set one, otherwise the master catalogue default. `ref` may be
     a chain id, a property id or a machine id (all resolve to the chain). With
     no ref, returns the default. This is the function the kiosk can adopt in a
     later pass; the kiosk's current display is deliberately left unchanged. */
  MB.priceFor = function (productId, ref) {
    var item = MB.findItem(productId);
    var dflt = item ? item.priceCents : 0;
    var chain = ref ? resolveChain(ref) : null;
    if (chain && chain.priceOverrides && chain.priceOverrides.hasOwnProperty(productId)) {
      return chain.priceOverrides[productId];
    }
    return dflt;
  };

  /* Products this reference stocks (the chain planogram, else the full
     catalogue), as an ordered array of catalogue item objects. */
  MB.planogramFor = function (ref) {
    var chain = ref ? resolveChain(ref) : null;
    var ids = planogramIdsFor(chain);
    var out = [];
    for (var i = 0; i < ids.length; i++) { var it = MB.findItem(ids[i]); if (it) out.push(it); }
    return out;
  };

  /* A chain's full price list: every catalogue item with its default price, the
     chain's override (if any) and the effective price. Drives the chain price
     editor. */
  MB.admin.chainPriceList = function (chainId) {
    var chain = MB.admin.getChain(chainId);
    if (!chain) return null;
    var inPlan = {};
    var ids = planogramIdsFor(chain);
    for (var i = 0; i < ids.length; i++) inPlan[ids[i]] = true;
    var lines = MB.catalogue.map(function (it) {
      var has = chain.priceOverrides && chain.priceOverrides.hasOwnProperty(it.id);
      return {
        id: it.id, name: it.name, category: it.category, slot: it.slot, isAlcohol: !!it.isAlcohol,
        defaultCents: it.priceCents,
        overrideCents: has ? chain.priceOverrides[it.id] : null,
        effectiveCents: has ? chain.priceOverrides[it.id] : it.priceCents,
        stocked: !!inPlan[it.id]
      };
    });
    return { chain: chain, lines: lines };
  };

  /* Save a chain's price overrides + planogram in one go.
     overrides: { productId: priceCents | null }  (null clears an override)
     stockedIds: array of productIds the chain stocks (its planogram); pass null
                 to leave the planogram as-is. */
  MB.admin.saveChainPricing = function (chainId, overrides, stockedIds) {
    var h = loadHier();
    var chain = findIn(h.chains, chainId);
    if (!chain) return null;
    chain.priceOverrides = chain.priceOverrides || {};
    if (overrides) {
      for (var pid in overrides) {
        if (!overrides.hasOwnProperty(pid)) continue;
        var v = overrides[pid];
        if (v === null || v === "" || isNaN(Number(v))) { delete chain.priceOverrides[pid]; }
        else { chain.priceOverrides[pid] = Math.max(0, Math.round(Number(v))); }
      }
    }
    if (stockedIds) {
      // if every catalogue item is stocked, store null (means "full catalogue")
      chain.planogram = (stockedIds.length >= MB.catalogue.length) ? null : stockedIds.slice();
    }
    saveHier(h);
    MB.bus.post("chains:changed", { chainId: chainId });
    MB.store.audit("admin_chain_pricing", { chainId: chainId, name: chain.name,
      overrides: Object.keys(chain.priceOverrides).length, planogram: chain.planogram ? chain.planogram.length : MB.catalogue.length }, {});
    return chain;
  };

  /* =========================================================================
     PER-PROPERTY EDITOR + POLICY
     ========================================================================= */

  // Effective policy for a machine/property: property override merged over the
  // global config defaults. Exposed for the kiosk to adopt per-machine later.
  MB.policyFor = function (ref) {
    var h = loadHier();
    var prop = findIn(h.properties, ref);
    if (!prop) { var m = findIn(h.machines, ref); if (m) prop = findIn(h.properties, m.propertyId); }
    var pol = (prop && prop.policy) || {};
    return {
      DAILY_ALCOHOL_CAP: pol.DAILY_ALCOHOL_CAP != null ? pol.DAILY_ALCOHOL_CAP : MB.config.DAILY_ALCOHOL_CAP,
      STAY_WINDOW_DAYS:  pol.STAY_WINDOW_DAYS  != null ? pol.STAY_WINDOW_DAYS  : MB.config.STAY_WINDOW_DAYS,
      BUFFER_AGE:        pol.BUFFER_AGE        != null ? pol.BUFFER_AGE        : MB.config.BUFFER_AGE
    };
  };

  /* Update a property record. Commission is only written when the caller passes
     it AND the current user may see money (owner/accounts) - staff can never set
     a commission. Everything else (levels, phones, emails, notes, policy) is
     editable by any role. */
  MB.admin.updateProperty = function (id, patch) {
    var h = loadHier();
    var prop = findIn(h.properties, id);
    if (!prop) return null;
    patch = patch || {};
    if ("name" in patch)  prop.name = String(patch.name);
    if ("city" in patch)  prop.city = String(patch.city);
    if ("state" in patch) prop.state = String(patch.state);
    if ("levels" in patch)  prop.levels = cleanList(patch.levels);
    if ("phones" in patch)  prop.phones = cleanList(patch.phones);
    if ("emails" in patch)  prop.emails = cleanList(patch.emails);
    if ("notes" in patch)   prop.notes = String(patch.notes || "");
    if (patch.policy) {
      prop.policy = prop.policy || {};
      ["DAILY_ALCOHOL_CAP", "STAY_WINDOW_DAYS", "BUFFER_AGE"].forEach(function (k) {
        if (k in patch.policy && patch.policy[k] !== null && patch.policy[k] !== "") {
          var v = Math.round(Number(patch.policy[k]));
          if (!isNaN(v) && v >= 0) prop.policy[k] = v;
        }
      });
    }
    // commission is money: only owner/accounts may write it
    if ("commissionPct" in patch && MB.canSeeMoney()) {
      var c = Number(patch.commissionPct);
      if (!isNaN(c)) prop.commissionPct = Math.round(clamp(c, 0, 100) * 100) / 100;
    }
    saveHier(h);
    MB.bus.post("properties:changed", { id: id });
    MB.store.audit("admin_property_update", { id: id, name: prop.name }, {});
    return prop;
  };
  function cleanList(v) {
    if (Array.isArray(v)) return v.map(function (x) { return String(x).trim(); }).filter(function (x) { return x; });
    return String(v || "").split(/[\n,]/).map(function (x) { return x.trim(); }).filter(function (x) { return x; });
  }

  // Commission setter kept for compatibility; routes to the property record and
  // is refused for staff (they cannot see or set money).
  MB.admin.setPropertyCommission = function (propertyId, pct) {
    if (!MB.canSeeMoney()) return null;
    return MB.admin.updateProperty(propertyId, { commissionPct: pct });
  };

  /* =========================================================================
     MACHINE STOCK, PICK LIST + RESTOCK FLOW (4-digit staff PIN)
     ========================================================================= */

  // Real per-slot stock for a machine (only the products it planograms).
  MB.admin.getMachineStock = function (machineId) {
    var h = loadHier();
    var m = findIn(h.machines, machineId);
    if (!m) return null;
    var prop = findIn(h.properties, m.propertyId) || {};
    var chain = findIn(h.chains, prop.chainId) || {};
    var lines = [];
    for (var pid in m.par) {
      if (!m.par.hasOwnProperty(pid)) continue;
      var it = MB.findItem(pid); if (!it) continue;
      lines.push({
        id: pid, slot: it.slot, name: it.name, category: it.category, isAlcohol: !!it.isAlcohol,
        par: m.par[pid], current: m.stock[pid] || 0,
        priceCents: MB.priceFor(pid, machineId)
      });
    }
    lines.sort(function (a, b) { return (a.slot || "").localeCompare(b.slot || ""); });
    return {
      machine: { id: m.id, level: m.level, status: m.status, slotRange: m.slotRange, stockPct: stockPctOf(m), lastVend: m.lastVend },
      property: prop, chain: chain, lines: lines
    };
  };

  /* pickList(machineId): every stocked product with par, current and the qty to
     pick to reach par. `lines` is the full set (for the on-screen table); `needed`
     is ONLY the items that need restocking (qty > 0) - that is what the compact
     printable PDF prints. */
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
    var needed = lines.filter(function (l) { return l.pick > 0; });
    var totalPick = 0;
    for (var i = 0; i < needed.length; i++) totalPick += needed[i].pick;
    return {
      machine: stock.machine, property: stock.property, chain: stock.chain,
      generatedAt: new Date().toISOString(),
      lines: lines, needed: needed,
      totals: { unitsToPick: totalPick, skusToPick: needed.length, slots: lines.length }
    };
  };

  // Verify the 4-digit staff PIN held behind the machine's red button.
  MB.admin.verifyStaffPin = function (machineId, pin) {
    var m = MB.admin.getMachine(machineId);
    if (!m) return false;
    return String(pin || "") === String(m.pin || "");
  };
  // Exposed so the demo restock screen can show the right code to type.
  MB.admin.machinePin = function (machineId) {
    var m = MB.admin.getMachine(machineId); return m ? m.pin : null;
  };

  /* restockMachine(machineId, opts) - simulate a staff restock at the machine.
     Requires a valid staff PIN (the red button + PIN gate).
       opts.staffPin  : the 4-digit PIN entered
       opts.mode      : 'par'      -> top every slot to par (Refill all)
                        'picklist' -> accept the suggested pick quantities
                                      (also lands every below-par slot at par)
                        'custom'   -> live per-slot counts from opts.counts
       opts.counts    : { productId: newCurrent } for 'custom'
       opts.staffName : who is loading (audit only)
     Updates machine stock, refreshes status, writes a 'restock' audit entry. */
  MB.admin.restockMachine = function (machineId, opts) {
    opts = opts || {};
    var h = loadHier();
    var m = findIn(h.machines, machineId);
    if (!m) return { ok: false, reason: "no_machine" };
    if (!MB.admin.verifyStaffPin(machineId, opts.staffPin)) return { ok: false, reason: "bad_pin" };

    var before = {}; for (var pid in m.stock) before[pid] = m.stock[pid];
    var added = 0, touched = 0;

    if (opts.mode === "custom" && opts.counts) {
      for (var cid in opts.counts) {
        if (!m.par.hasOwnProperty(cid)) continue;
        var nv = clamp(Math.round(Number(opts.counts[cid])), 0, m.par[cid]);
        if (nv !== m.stock[cid]) { if (nv > (m.stock[cid] || 0)) added += nv - (m.stock[cid] || 0); m.stock[cid] = nv; touched++; }
      }
    } else {
      // 'par' and 'picklist' both bring every below-par slot up to par
      for (var ppid in m.par) {
        if (!m.par.hasOwnProperty(ppid)) continue;
        var cur = m.stock[ppid] || 0, par = m.par[ppid];
        if (cur < par) { added += par - cur; m.stock[ppid] = par; touched++; }
      }
    }

    // status refresh: a well-stocked machine comes back online
    var pct = stockPctOf(m);
    if (m.status !== "offline") m.status = pct < 30 ? "low_stock" : "online";
    m.lastRestock = new Date().toISOString();
    saveHier(h);

    var prop = findIn(h.properties, m.propertyId) || {};
    MB.store.audit("restock", {
      machineId: machineId, property: prop.name, level: m.level,
      mode: opts.mode || "par", unitsAdded: added, slotsTouched: touched,
      staff: opts.staffName || "staff", stockPct: pct
    }, { room: null });
    MB.bus.post("machines:changed", { id: machineId, restock: true });
    return { ok: true, unitsAdded: added, slotsTouched: touched, stockPct: pct, mode: opts.mode || "par" };
  };

  // Directly set one slot's live count during a restock (used as staff load).
  MB.admin.setMachineSlot = function (machineId, productId, current) {
    var h = loadHier();
    var m = findIn(h.machines, machineId);
    if (!m || !m.par.hasOwnProperty(productId)) return null;
    m.stock[productId] = clamp(Math.round(Number(current) || 0), 0, m.par[productId]);
    saveHier(h);
    return m.stock[productId];
  };

  /* =========================================================================
     VENUES (properties) + MONTHLY PAYOUT, ROLLED UP PER CHAIN
     ========================================================================= */
  var MONTH_NAMES = ["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"];
  function monthKeyOf(date) { var d = date || new Date(); return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2); }
  function monthLabel(mk) { var p = String(mk).split("-"); return (MONTH_NAMES[parseInt(p[1], 10) - 1] || "?") + " " + p[0]; }
  function daysInMonth(mk) { var p = String(mk).split("-"); return new Date(parseInt(p[0], 10), parseInt(p[1], 10), 0).getDate(); }
  // The payout run happens on the 1st for the PREVIOUS month. Default month key.
  MB.admin.previousMonthKey = function (fromDate) {
    var d = fromDate || new Date();
    var y = d.getFullYear(), m = d.getMonth(); // 0-based; previous month
    if (m === 0) { m = 12; y--; } // becomes December of last year
    return y + "-" + ("0" + m).slice(-2);
  };
  MB.admin.availablePayoutMonths = function (count) {
    count = count || 6;
    var out = [], now = new Date();
    var y = now.getFullYear(), m = now.getMonth(); // start at CURRENT month
    for (var i = 0; i < count; i++) {
      var mk = y + "-" + ("0" + (m + 1)).slice(-2);
      out.push({ key: mk, label: monthLabel(mk) });
      m--; if (m < 0) { m = 11; y--; }
    }
    return out;
  };
  function payDateFor(mk) {
    var p = String(mk).split("-"); var y = parseInt(p[0], 10), m = parseInt(p[1], 10);
    m += 1; if (m > 12) { m = 1; y++; }
    return "01/" + ("0" + m).slice(-2) + "/" + y;
  }

  // Deterministic simulated month of trading for one property.
  function simulatedPropertyMonth(prop, machineCount, mk) {
    var days = daysInMonth(mk);
    // future month -> no trading
    var now = new Date(); var p = String(mk).split("-");
    var first = new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, 1);
    var monthStartOfNow = new Date(now.getFullYear(), now.getMonth(), 1);
    if (first.getTime() > monthStartOfNow.getTime()) return { salesCents: 0, units: 0, txns: 0 };
    if (machineCount <= 0) return { salesCents: 0, units: 0, txns: 0 };
    var rnd = seededRand(hashStr(prop.id + "|" + mk));
    var perMachineDaily = 5 + Math.floor(rnd() * 10);
    var txns = Math.round(perMachineDaily * machineCount * days);
    var units = Math.round(txns * (1.3 + rnd() * 0.9));
    var salesCents = units * (700 + Math.round(rnd() * 550));
    return { salesCents: salesCents, units: units, txns: txns };
  }

  // Attribute real kiosk purchases across properties for the month.
  function realSalesByProperty(mk, properties) {
    var by = {};
    for (var i = 0; i < properties.length; i++) by[properties[i].id] = { salesCents: 0, units: 0, txns: 0 };
    if (!properties.length) return by;
    var purchases = MB.store.getPurchases();
    for (var p = 0; p < purchases.length; p++) {
      var pur = purchases[p];
      if (monthKeyOf(new Date(pur.ts)) !== mk) continue;
      var key = pur.mobile || pur.room || pur.id || "";
      var idx = hashStr(key) % properties.length;
      var b = by[properties[idx].id];
      b.salesCents += pur.totalCents || 0; b.txns += 1;
      var lines = pur.lines || [];
      for (var l = 0; l < lines.length; l++) b.units += lines[l].qty || 0;
    }
    return by;
  }

  /* payoutReport(monthKey): the monthly payout run for the given trading month
     (defaults to the PREVIOUS month, matching the 1st-of-month schedule).
     Rolled up CHAIN -> PROPERTY. commission = the property's OWN commission % x
     that property's sales. Returns chain subtotals and a fleet total.

     NOTE (future): each property row is exactly what a XERO sync would post as an
     accounts-payable bill on the 1st. See MB.admin.syncPayoutToXero (a stub). */
  MB.admin.payoutReport = function (monthKey) {
    var mk = monthKey || MB.admin.previousMonthKey();
    var h = loadHier();
    var real = realSalesByProperty(mk, h.properties);
    var chains = [];
    var totals = { salesCents: 0, units: 0, txns: 0, commissionCents: 0, machineCount: 0, propertyCount: 0 };
    for (var c = 0; c < h.chains.length; c++) {
      var chain = h.chains[c];
      var props = h.properties.filter(function (p) { return p.chainId === chain.id; });
      var chRows = [];
      var chSub = { salesCents: 0, units: 0, txns: 0, commissionCents: 0, machineCount: 0 };
      for (var pi = 0; pi < props.length; pi++) {
        var prop = props[pi];
        var mCount = h.machines.filter(function (m) { return m.propertyId === prop.id; }).length;
        var sim = simulatedPropertyMonth(prop, mCount, mk);
        var r = real[prop.id] || { salesCents: 0, units: 0, txns: 0 };
        var salesCents = sim.salesCents + r.salesCents;
        var units = sim.units + r.units;
        var txns = sim.txns + r.txns;
        var pct = prop.commissionPct || 0;
        var commissionCents = Math.round(salesCents * pct / 100);
        chRows.push({
          propertyId: prop.id, name: prop.name, city: prop.city, state: prop.state,
          machineCount: mCount, commissionPct: pct,
          salesCents: salesCents, units: units, txns: txns,
          commissionCents: commissionCents, realTxns: r.txns
        });
        chSub.salesCents += salesCents; chSub.units += units; chSub.txns += txns;
        chSub.commissionCents += commissionCents; chSub.machineCount += mCount;
      }
      chains.push({ chainId: chain.id, name: chain.name, rows: chRows, subtotal: chSub });
      totals.salesCents += chSub.salesCents; totals.units += chSub.units; totals.txns += chSub.txns;
      totals.commissionCents += chSub.commissionCents; totals.machineCount += chSub.machineCount;
      totals.propertyCount += props.length;
    }
    return {
      month: mk, monthLabel: monthLabel(mk), payDate: payDateFor(mk),
      chains: chains, totals: totals
    };
  };

  /* getVenues(): flat list of properties with commission + machine count,
     newest model equivalent of the old per-hotel venue list. */
  MB.admin.getVenues = function () {
    var h = loadHier();
    return h.properties.map(function (p) {
      var chain = findIn(h.chains, p.chainId) || {};
      return {
        propertyId: p.id, hotel: p.name, name: p.name, chainId: p.chainId, chainName: chain.name || "",
        city: p.city, state: p.state, commissionPct: p.commissionPct || 0,
        machineCount: h.machines.filter(function (m) { return m.propertyId === p.id; }).length
      };
    });
  };

  /* -------- STUB: Sync to Xero --------------------------------------------
     Would post each property's monthly commission as an accounts-payable bill in
     Xero on the 1st, from exactly the payoutReport figures. Deliberately does NO
     network call: it is a placeholder pending the real Xero API credentials
     (client id/secret, tenant connection + OAuth). See the UI note beside the
     button in admin.html.
     TODO(real): Xero Accounting API - POST /Bills (ACCPAY invoices), one per
     property, using an OAuth2 access token for the connected tenant. */
  MB.admin.syncPayoutToXero = function (monthKey) {
    var rep = MB.admin.payoutReport(monthKey);
    var billCount = 0;
    for (var i = 0; i < rep.chains.length; i++) billCount += rep.chains[i].rows.length;
    MB.store.audit("xero_sync_stub", {
      month: rep.month, bills: billCount, totalCommissionCents: rep.totals.commissionCents
    }, {});
    // No network. Returns what WOULD have been posted, so the UI can confirm.
    return {
      ok: false, stub: true,
      message: "Stub only. Pending Xero API credentials - no invoice was posted.",
      month: rep.month, monthLabel: rep.monthLabel, payDate: rep.payDate,
      billsThatWouldPost: billCount, totalCommissionCents: rep.totals.commissionCents
    };
  };

  /* -------- one-shot reset of the hierarchy back to the seed (demo) -------- */
  MB.admin.resetHierarchy = function () { var h = seedHier(); saveHier(h); MB.bus.post("chains:changed", { reset: true }); return h; };

  // Ensure the hierarchy is seeded on first load so the fleet is never empty.
  loadHier();
})();
