/* vp-tvpaired.js -- THE VENUE THIS SCREEN WAS PAIRED TO BY ITS OWN SCREEN CODE, AND NOTHING ELSE (5 Nov 2026).

   WHY THERE ARE TWO KEYS, AND WHY THEY MUST NEVER BE MERGED BACK INTO ONE.

   vpTvVenue (tv.html rememberVenue, and the four game screens) is written by ANY visit to /tv?venue=<slug>:
   a prospect's slides, HQ "View as", the TV app, a link in an email, the game screens moving between
   games. It says "the last venue screen this browser opened", which is not the same as "this screen's
   venue". Dean, 1 Nov 2026, live: his own laptop had opened a prospect's slides, and bare /tv then put
   THAT pub's advertising up full screen ("it was picking up on the last TV channel it played on, so we
   thought it was just picking a random person"). So bare /tv stopped reading vpTvVenue at all, and it
   must never read it again.

   vpTvPaired (this file) is written ONLY when this screen has been set up by its own screen code: the
   six characters from the host console, keyed in on this screen's own setup card (tv.html askCode) and
   confirmed real by the game Worker. Dean, 5 Nov 2026: every customer text now says just
   venueplay.com.au/tv and "type the screen code", and "I don't want them to ask for the code again on
   the TV, no way." So bare /tv opens the paired venue straight away, and only that one.

   What never writes it: /tv?venue=<slug> on its own, ?demo=1, the see-a-night and home-page demo frames,
   HQ "View as", a prospect's slides, the venue-name picker, the TV apps (they keep their own memory and
   always open /tv?venue=). What clears it: Change venue in the screen's staff settings (hold OK for five
   seconds), and the Worker saying twice, thirty seconds apart, that the paired venue does not exist
   (tv.html forgetVenue, the same two strikes as before).

   The shape is {slug, at}: at is when it was paired (ms), for whoever has to read a screen's memory.
   Anything else in the key (old shape, junk, a hand edit) reads as "not paired", never as a venue.
   Tested by tools/test-venue-url.js (this file, in jsc) and tools/tv-bare-setup-in-chrome.test.py.
   Plain ES5, no dependencies beyond /app/vp-venueurl.js for target(). */
(function (root) {
  "use strict";
  var KEY = "vpTvPaired";
  var HOLD_MS = 5000;

  function store() { try { return root.localStorage || null; } catch (e) { return null; } }
  function clean(s) {
    s = String(s == null ? "" : s).toLowerCase();
    return /^[a-z0-9][a-z0-9-]{0,99}$/.test(s) ? s : "";
  }
  function read() {
    var ls = store(), raw = null, o = null;
    if (!ls) return null;
    try { raw = ls.getItem(KEY); } catch (e) { return null; }
    if (!raw) return null;
    try { o = JSON.parse(raw); } catch (e) { return null; }
    var s = o && typeof o === "object" ? clean(o.slug) : "";
    return s ? { slug: s, at: +o.at || 0 } : null;
  }
  function slug() { var o = read(); return o ? o.slug : ""; }
  /* Called from ONE place: tv.html askCode, once the Worker has answered the code with a real venue. */
  function save(s) {
    var ls = store(); s = clean(s);
    if (!ls || !s) return false;
    try { ls.setItem(KEY, JSON.stringify({ slug: s, at: Date.now() })); return true; } catch (e) { return false; }
  }
  function clear() { var ls = store(); if (ls) { try { ls.removeItem(KEY); } catch (e) {} } }
  /* Two strikes against <s>: forget the pairing only if it is THAT venue. A screen opened at a mistyped
     /tv?venue=the-grand-hotel must not lose the real venue it was paired to. */
  function forget(s) { var p = slug(); if (p && p === clean(s)) clear(); }

  /* WHERE BARE /tv GOES. "" means stay: the setup card, exactly as before. Otherwise the same page with
     the paired venue in its address, so everything after it (the intro, the loading floor, the two-strikes
     check, the slides, signing) is the ordinary /tv?venue= screen with nothing of its own.
     Never for a demo (hermetic), a probe (a tool is not a screen), an address that already names a venue,
     or one that asked for a venue it could not read (?venue= empty: that screen says so). Anything else in the
     address (?intro=0, a tracking tag) still opens the paired venue, and is carried over. */
  function target(search, path, hash) {
    search = String(search || "");
    if (/[?&](demo|probe)=1(&|$)/.test(search)) return "";
    var U = root.VPVenueURL;
    if (!U || U.slug(search)) return "";
    if (/(^|[?&])(venue|slug)=/i.test(search)) return "";   // a venue was asked for and could not be read: that screen says so, never swapped for another
    var s = slug();
    if (!s) return "";
    var rest = search.replace(/^\?/, "");
    return String(path || "/tv") + "?venue=" + encodeURIComponent(s) + (rest ? "&" + rest : "") + String(hash || "");
  }
  /* Run once from tv.html's <head>. Hides the page while it moves on, so the setup card never flashes
     up first; shown again after four seconds whatever happens, so a navigation that somehow did not
     take can never leave a black wall. */
  var OPEN_KEY = "vpTvPairedOpen";   // sessionStorage, this tab only: "the venue screen you are about to load was opened from bare /tv"
  function go(loc) {
    loc = loc || root.location;
    var to = "";
    try { to = target(loc.search, loc.pathname, loc.hash); } catch (e) { to = ""; }
    if (!to) return false;
    try { root.sessionStorage.setItem(OPEN_KEY, JSON.stringify({ slug: slug(), at: Date.now() })); } catch (e) {}
    try {
      var de = root.document && root.document.documentElement;
      if (de) { de.style.visibility = "hidden"; root.setTimeout(function () { de.style.visibility = ""; }, 4000); }
    } catch (e) {}
    try { loc.replace(to); } catch (e) { return false; }
    return true;
  }

  /* Read once, by the venue screen go() just opened: true only for THAT venue, within a minute. Removed as
     it is read, so a reload of the venue's own address is an ordinary open, not a paired one. */
  function openedPaired(s) {
    var raw = null, o = null;
    try { raw = root.sessionStorage.getItem(OPEN_KEY); if (raw) root.sessionStorage.removeItem(OPEN_KEY); } catch (e) { return false; }
    if (!raw) return false;
    try { o = JSON.parse(raw); } catch (e) { return false; }
    return !!o && clean(o.slug) !== "" && clean(o.slug) === clean(s) && Date.now() - (+o.at || 0) < 60000;
  }

  /* "GET THE APP", ON A BROWSER TV THAT HAS ONE (Dean, 5 Nov 2026: "prompt them to download the app if they
     have one of those TVs, just for like maybe 20 or 30 seconds every time").
     Every time bare /tv opens the paired venue (openedPaired), on a TV whose OWN store carries the app with a
     live address in VPTvType.STORES (today Google Play only: Samsung and LG are coming soon, no address, no
     prompt). Never inside a TV app, never in a demo, never on a laptop, PC, phone or a TV we cannot tell (their
     setup line lists every store, not one). A card in the bottom right corner, clear of the join code and its
     QR (bottom left), the venue's logo (top left) and the venueplay corner (top right); it is up only while
     the advertising is, and comes down for a game. APP_MS of it, counted while it is actually on the wall.
     o: { kind, inApp, demo, adsUp: function(){ true while the ads are on the wall } }. Returns the store or "". */
  var APP_MS = 25000;
  function appStore(kind) {
    var T = root.VPTvType;
    if (!T || !T.setup || !T.STORES) return "";
    var s = null;
    try { s = T.setup(kind); } catch (e) { return ""; }
    if (!s || s.app !== "show" || !s.stores || s.stores.length !== 1) return "";
    var st = T.STORES[s.stores[0]];
    return st && st.url ? s.stores[0] : "";
  }
  function appPrompt(o) {
    o = o || {};
    var d = root.document;
    if (!d || o.inApp || o.demo) return "";
    var store = appStore(o.kind);
    if (!store) return "";
    var st = root.VPTvType.STORES[store], card = null, shownMs = 0, last = 0, startedAt = Date.now(), t = 0;
    function build() {
      card = d.createElement("div");
      card.id = "vpGetApp"; card.setAttribute("data-store", store); card.setAttribute("data-fit-avoid", "");
      card.style.cssText = "position:fixed;right:2vw;bottom:2vw;z-index:59;display:flex;align-items:center;gap:1.2vw;max-width:34vw;" +
        "background:rgba(13,10,22,.92);border:2px solid #FF1F8E;border-radius:1.2vw;padding:1vw 1.4vw 1vw 1vw;color:#fff;" +
        "font-family:Manrope,system-ui,sans-serif;pointer-events:none;box-shadow:0 .6vw 2vw rgba(0,0,0,.5)";
      var qb = d.createElement("div");
      qb.style.cssText = "flex:none;background:#fff;border-radius:.6vw;padding:.4vw;line-height:0";
      var qc = d.createElement("canvas"); qc.id = "vpGetAppQR"; qc.style.display = "block";
      /* important: the QR library writes its own pixel width onto the canvas as it draws */
      qc.style.setProperty("width", "8vw", "important"); qc.style.setProperty("height", "8vw", "important");
      qb.appendChild(qc); card.appendChild(qb);
      var tx = d.createElement("div");
      var h = d.createElement("div"); h.style.cssText = "font-weight:800;font-size:clamp(16px,1.6vw,34px);line-height:1.2";
      h.textContent = "Get the venueplay TV app on " + st.name;
      var p = d.createElement("div"); p.style.cssText = "font-weight:600;font-size:clamp(13px,1.15vw,24px);line-height:1.35;color:rgba(255,255,255,.8);margin-top:.35em";
      p.textContent = "It opens your venue on its own. Scan the code, or search venueplay TV in " + st.name + ".";
      tx.appendChild(h); tx.appendChild(p); card.appendChild(tx);
      d.body.appendChild(card);
      try { if (root.VPQR) root.VPQR.draw(qc, st.url, 240); } catch (e) {}
    }
    function done() { root.clearInterval(t); if (card && card.parentNode) card.parentNode.removeChild(card); card = null; }
    t = root.setInterval(function () {
      var now = Date.now(), up = false;
      try { up = !!(o.adsUp && o.adsUp()); } catch (e) {}
      if (up) {
        if (!card) build();
        card.style.display = "flex";   // never "": that wipes the card's own display:flex and stacks it
        if (last) shownMs += now - last;
        last = now;
        if (shownMs >= APP_MS) { done(); return; }
      } else {
        if (card) card.style.display = "none";
        last = 0;
        if (now - startedAt > 10 * 60 * 1000) done();   // a game all night: not offered over it, and not later either
      }
    }, 250);
    return store;
  }

  /* STAFF SETTINGS ON A BROWSER TV: hold OK (Enter) for five seconds, or hold a press on the screen, the
     same gesture as the venueplay TV apps (~/venueplay-tv-apps shared/js/app.js). Two buttons: Back to the
     screen, and Change venue, which forgets the pairing and opens the setup card. Never inside a TV app
     (it has its own settings, /app/vp-tvapp.js) and never in a demo; tv.html decides, and calls this only
     on a screen that has a venue. o: { inApp, name: function(){ venue name }, path: "/tv" }. */
  function staff(o) {
    o = o || {};
    var d = root.document;
    if (!d || !d.addEventListener || o.inApp) return null;
    var panel = null, hint = null, held = null, since = 0, timer = 0, swallow = false, idle = 0;

    function el(tag, css, text) { var n = d.createElement(tag); if (css) n.style.cssText = css; if (text != null) n.textContent = text; return n; }
    function showHint(t) {
      if (!hint) {
        hint = el("div", "position:fixed;left:50%;bottom:6vh;transform:translateX(-50%);z-index:2147483000;background:rgba(13,10,22,.92);color:#fff;" +
          "font:600 clamp(14px,1.6vw,26px) Manrope,system-ui,sans-serif;padding:.7em 1.2em;border-radius:.6em;border:1px solid rgba(255,255,255,.18);pointer-events:none");
        hint.id = "vpStaffHint";
        d.body.appendChild(hint);
      }
      hint.textContent = t; hint.style.display = "";
    }
    function hideHint() { if (hint) hint.style.display = "none"; }
    function close() {
      if (panel && panel.parentNode) panel.parentNode.removeChild(panel);
      panel = null; root.clearTimeout(idle);
    }
    function changeVenue() {
      clear();
      close();
      try { root.location.replace(String(o.path || "/tv")); } catch (e) {}
    }
    function btn(parent, text, pink, fn) {
      var b = el("button", "font:700 clamp(15px,1.7vw,28px) Manrope,system-ui,sans-serif;padding:.75em 1.4em;border-radius:.6em;cursor:pointer;margin:0 .5em;" +
        (pink ? "background:#FF1F8E;color:#fff;border:2px solid #FF1F8E" : "background:transparent;color:#fff;border:2px solid rgba(255,255,255,.45)"), text);
      b.type = "button";
      b.addEventListener("click", function (e) { e.preventDefault(); fn(); });
      b.addEventListener("focus", function () { b.style.outline = "3px solid #FFD6EA"; b.style.outlineOffset = "3px"; });
      b.addEventListener("blur", function () { b.style.outline = ""; });
      parent.appendChild(b);
      return b;
    }
    function open() {
      if (panel) return;
      hideHint();
      var name = "";
      try { name = String((o.name && o.name()) || ""); } catch (e) {}
      panel = el("div", "position:fixed;inset:0;z-index:2147483001;display:flex;align-items:center;justify-content:center;background:rgba(5,3,10,.82)");
      panel.id = "vpStaffSettings";
      var card = el("div", "background:#15101F;color:#fff;border:1px solid rgba(255,255,255,.14);border-radius:1.2vw;padding:3vw 4vw;text-align:center;max-width:70vw;" +
        "font-family:Manrope,system-ui,sans-serif");
      card.appendChild(el("div", "font:800 clamp(22px,2.6vw,44px) Manrope,system-ui,sans-serif;margin-bottom:.4em", "Screen settings"));
      card.appendChild(el("div", "font:600 clamp(15px,1.7vw,28px) Manrope,system-ui,sans-serif;color:rgba(255,255,255,.75);margin-bottom:1.4em",
        name ? "This screen shows " + name + "." : "This screen shows a venue."));
      var row = el("div", "display:flex;justify-content:center;flex-wrap:wrap;gap:.6em");
      var back = btn(row, "Back to the screen", false, close);
      var change = btn(row, "Change venue", true, changeVenue);
      back.id = "vpStaffBack"; change.id = "vpStaffChange";
      card.appendChild(row);
      panel.appendChild(card);
      d.body.appendChild(panel);
      try { back.focus(); } catch (e) {}
      root.clearTimeout(idle);
      idle = root.setTimeout(close, 30000);   // never left over a pub's wall
    }
    function tick() {
      if (!held) return;
      var t = Date.now() - since;
      if (t >= HOLD_MS) { held = null; swallow = true; open(); return; }
      if (t >= 1000) showHint("Keep holding for settings ... " + Math.ceil((HOLD_MS - t) / 1000));
      timer = root.setTimeout(tick, 200);
    }
    function start(kind) { if (held || panel) return; held = kind; since = Date.now(); root.clearTimeout(timer); timer = root.setTimeout(tick, 200); }
    function stop(kind) { if (held !== kind) return; held = null; root.clearTimeout(timer); hideHint(); }

    d.addEventListener("keydown", function (e) {
      var k = e.keyCode;
      if (swallow && (k === 13 || e.repeat)) { e.preventDefault(); e.stopPropagation(); return; }   // the key that opened it is still down
      if (panel) {
        if (k === 27 || k === 8 || k === 10009 || k === 461) { e.preventDefault(); close(); return; }
        if (k === 37 || k === 39) {
          e.preventDefault();
          var bs = panel.querySelectorAll("button"), i = [].indexOf.call(bs, d.activeElement);
          var n = bs[(i < 0 ? 0 : i + (k === 39 ? 1 : -1) + bs.length) % bs.length]; if (n) n.focus();
        }
        root.clearTimeout(idle); idle = root.setTimeout(close, 30000);
        return;
      }
      if (k === 13) { if (held !== "key") start("key"); else tick(); }
    }, true);
    d.addEventListener("keyup", function (e) { if (e.keyCode === 13) { swallow = false; stop("key"); } }, true);
    d.addEventListener("pointerdown", function (e) { if (!panel && e.isPrimary !== false) start("ptr"); }, true);
    ["pointerup", "pointercancel", "pointerleave"].forEach(function (ev) { d.addEventListener(ev, function () { stop("ptr"); swallow = false; }, true); });
    return { open: open, close: close, changeVenue: changeVenue };
  }

  root.VPTvPaired = { KEY: KEY, HOLD_MS: HOLD_MS, read: read, slug: slug, save: save, clear: clear, forget: forget,
                      target: target, go: go, openedPaired: openedPaired, appStore: appStore, appPrompt: appPrompt,
                      APP_MS: APP_MS, staff: staff };
})(window);
