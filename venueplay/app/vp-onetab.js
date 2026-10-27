/* ============================================================================
   ONE LIVE CONSOLE PER TABLET.

   Every console keeps its night in this device's localStorage so a reload picks
   the game back up. The same thing made a SECOND TAB on the same tablet restore
   the same game, silently, as a second live console. The two then diverged:
   songs played on tab 2 were not in tab 1, and tab 1 kept heartbeating its own
   stale "game on, now playing X" at the TV. Ending the game on tab 2 and closing
   both left the venue TV frozen on NOW PLAYING for minutes after the night was
   over (live audit, 14 Oct 2026). Bingo and trivia keep their nights the same
   way and had the same hole.

   VP_ONETAB is the one copy of the fix, for every console:

     - Before a console restores or connects, it calls claim(key). This tab asks
       the others on the device (BroadcastChannel, same origin, same browser)
       whether one of them already runs this console. Nobody answers inside
       ASK_MS: this tab is the live one and claim() resolves.
     - Somebody answers: this tab shows a full-page notice instead of a second
       copy of the game, with one button, "Use this tab instead". Tapping it
       tells the other tab to stand down, then reloads, so this tab restores the
       game from the saved night as the only console.
     - A tab told to stand down stops sending at once (live() goes false, and
       the console's raw senders and API calls refuse) and reloads itself into
       that same notice, so none of its stale timers or handlers outlive it.
     - A live tab re-announces itself when it comes back to the front. An iPad
       suspends a background tab completely, so the old tab may not have
       answered the new one's question; the moment it wakes, the two find each
       other and the OLDER one stands down. The host is looking at a tab that
       says so, rather than at a stale console.

   Keyed per console and venue ("musical:<venue id>"), so a bingo console and a
   musical console open side by side are not one another's business: one room,
   one console is the Worker's question (VP.confirmTakeover), not this one's.

   No BroadcastChannel (very old browsers): claim() resolves at once and live()
   is always true, which is exactly how the consoles behaved before.

   BINGO IS ON THE MENU PAGE, so it takes three more calls (15 Oct 2026). /app is
   both the games menu and the bingo console, and a menu locked to one tab is a
   menu the second tablet cannot use. Bingo claims only when a night is actually
   open, and lets go of it when the night ends:
     - watch(k) asks the same question as claim() WITHOUT taking anything. If
       another tab holds k this tab goes quiet (live() false, no notice) and
       stays usable as a menu; if nobody does, nothing changes. A tab that has
       watched k hears a later claim by another tab and goes quiet then too.
     - notice(opts) shows the notice on demand (the host tapped Bingo), with an
       optional second button, opts.back + opts.onBack, back to the menu.
     - release(k) is End game: this tab stops being the live one and tells the
       others, which wake up, so any tab can open the next night.
   claim(k, { quiet: true }) is a claim that, when blocked, goes quiet rather
   than covering the page (the menu again). Trivia and musical call none of this.

   Load before the page's own script:
       <script src="/app/vp-onetab.js"></script>
   Then:
       VP_ONETAB.claim("musical:" + venueId).then(function(){ ...restore, connect... });
       function rawSend(p){ if(!VP_ONETAB.live()) return; ... }
   ========================================================================== */
(function(root){
  "use strict";
  var ASK_MS = 500;                 // how long a new tab waits for "I am already live"
  var FLAG_WAIT_MS = 4000;          // ...and a tab that was just stood down, so the taker can finish loading
  var DOWN_FLAG = "vpOneTabDown";   // sessionStorage: this tab was stood down (wording only)
  var bc = null;
  try { bc = (typeof root.BroadcastChannel === "function") ? new root.BroadcastChannel("vp-onetab") : null; } catch (e) { bc = null; }
  var ME = String(Date.now()) + "-" + Math.random().toString(36).slice(2);
  var key = null, state = "idle", since = 0, heard = false;   // idle | asking | live | blocked | down
  var asking = null, askedOnce = false, lastFlagged = false, noticeOpts = null;

  function post(m){ if (!bc) return; try { m.key = key; m.from = ME; bc.postMessage(m); } catch (e) {} }
  function sayLive(){ if (state === "live") post({ t: "live", since: since }); }

  function readFlag(){ try { return root.sessionStorage.getItem(DOWN_FLAG) || ""; } catch (e) { return ""; } }
  function setFlag(v){ try { if (v) root.sessionStorage.setItem(DOWN_FLAG, v); else root.sessionStorage.removeItem(DOWN_FLAG); } catch (e) {} }

  /* THE OLDER TAB STANDS DOWN. Newer means the one the host opened last, which is
     the one in front of them. Equal times (both opened in the same millisecond)
     are settled by the id so exactly one of them goes. */
  function otherIsNewer(m){
    var s = +m.since || 0;
    return s > since || (s === since && String(m.from) > ME);
  }

  function standDown(){
    if (state === "down") return;
    state = "down";
    setFlag(key);
    try { root.location.reload(); } catch (e) { showNotice(true); }
  }

  if (bc) bc.onmessage = function(e){
    var m = e && e.data;
    if (!m || !key || m.key !== key || m.from === ME) return;
    if (m.t === "hello") { sayLive(); return; }
    if (m.t === "take")  { if (state === "live") standDown(); return; }
    if (m.t === "live") {
      if (state === "asking") { heard = true; return; }
      if (state === "live") { if (otherIsNewer(m)) standDown(); else sayLive(); }
      // A tab that watched k and found it free: another tab has just claimed it (bingo, 15 Oct 2026).
      if (state === "idle") { state = "blocked"; }
      return;
    }
    // The live tab ended its night: a tab waiting behind it is free again, notice and all.
    if (m.t === "free") {
      if (state === "blocked") { state = "idle"; hideNotice(); }
    }
  };

  function take(){
    setFlag("");
    post({ t: "take" });
    // Give the message a beat to leave before this page goes.
    setTimeout(function(){ try { root.location.reload(); } catch (e) {} }, 150);
  }

  function hideNotice(){
    try { var d = root.document, n = d && d.getElementById("vpOneTab"); if (n && n.parentNode) n.parentNode.removeChild(n); } catch (e) {}
  }

  function showNotice(wasStoodDown){
    var d = root.document; if (!d || !d.body) return;
    if (d.getElementById("vpOneTab")) return;
    var o = noticeOpts || {};
    var box = d.createElement("div");
    box.id = "vpOneTab";
    box.setAttribute("role", "alertdialog");
    box.setAttribute("aria-labelledby", "vpOneTabT");
    box.style.cssText = "position:fixed;inset:0;z-index:2147483646;display:flex;align-items:center;justify-content:center;" +
      "padding:16px;background:rgba(10,6,20,.94);font-family:Manrope,system-ui,-apple-system,sans-serif;color:#fff";
    var card = d.createElement("div");
    card.style.cssText = "max-width:440px;width:100%;background:#1b1230;border:1px solid rgba(255,255,255,.14);" +
      "border-radius:16px;padding:24px;text-align:center;line-height:1.5";
    var h = d.createElement("div");
    h.id = "vpOneTabT";
    h.style.cssText = "font-size:20px;font-weight:800;margin-bottom:8px";
    h.textContent = o.title || (wasStoodDown ? "This game moved to another tab" : "This game is already open in another tab");
    var p = d.createElement("div");
    p.style.cssText = "font-size:15px;opacity:.85;margin-bottom:18px";
    p.textContent = o.text || (wasStoodDown
      ? "You opened it again in another tab on this device, so this one has stepped back. Use that tab, or bring the game back here."
      : "Running it in two tabs at once splits the game: what you do in one is not in the other. Use the other tab, or move the game here.");
    var b = d.createElement("button");
    b.type = "button"; b.id = "vpOneTabTake";
    b.style.cssText = "font:inherit;font-size:16px;font-weight:800;padding:12px 20px;border:0;border-radius:999px;" +
      "background:#ff1f8e;color:#fff;cursor:pointer;min-width:220px";
    b.textContent = o.takeLabel || "Use this tab instead";
    b.addEventListener("click", function(){
      b.disabled = true; b.textContent = o.takingLabel || "Moving the game here...";
      // Picked up on ANOTHER DEVICE: there is no tab here to tell, so just come back to life by reloading.
      if (o.onTake) { try { o.onTake(); } catch (e) {} return; }
      take();
    });
    card.appendChild(h); card.appendChild(p); card.appendChild(b);
    if (o.back) {
      var bk = d.createElement("button");
      bk.type = "button"; bk.id = "vpOneTabBack";
      bk.style.cssText = "display:block;margin:12px auto 0;font:inherit;font-size:15px;font-weight:700;padding:10px 16px;" +
        "border:0;background:none;color:#fff;opacity:.8;text-decoration:underline;cursor:pointer";
      bk.textContent = String(o.back);
      bk.addEventListener("click", function(){ hideNotice(); try { if (o.onBack) o.onBack(); } catch (e) {} });
      card.appendChild(bk);
    }
    box.appendChild(card);
    d.body.appendChild(box);
  }

  var waiting = null;
  /* Asks the other tabs whether one of them is live for k. Resolves true if one
     answered. Shared by claim() and watch(), so two asks at once are one ask. */
  function ask(k){
    if (key === k && asking) return asking;
    key = k; state = "asking"; heard = false;
    var flagged = readFlag() === k;
    lastFlagged = flagged;
    if (readFlag() && !flagged) setFlag("");   // a flag for some other console in this tab means nothing here
    asking = new Promise(function(resolve){
      /* A TAB THAT WAS JUST STOOD DOWN WAITS FOR THE TAKER. It reloads the moment "Use this tab
         instead" is pressed elsewhere, and the taker reloads 150ms after it, so with the usual
         half second the stood-down tab finished loading first, heard nobody, and took the game
         straight back: three tries out of three on the live site (14 Oct 2026). So it listens
         long enough for the taker to load and announce itself (it says "live" the moment it is),
         asking again half way. If nobody comes (that tab was closed) it carries on, so the flag
         alone still never locks a console out. */
      var wait = flagged ? FLAG_WAIT_MS : ASK_MS;
      /* Only the first ask after the reload is the race. Bingo asks again later in the same page
         (tapping Bingo, Open lobby), and four seconds on every tap is a console that feels broken. */
      if (askedOnce) wait = ASK_MS;
      askedOnce = true;
      post({ t: "hello" });
      if (flagged && wait === FLAG_WAIT_MS) setTimeout(function(){ if (state === "asking") post({ t: "hello" }); }, wait / 2);
      setTimeout(function(){ asking = null; resolve(heard); }, wait);
    });
    return asking;
  }

  /* Resolves when this tab is the live console for k. Never resolves while
     another tab holds it: the page stays on the notice, which is the point. */
  function claim(k, opts){
    k = String(k || "");
    if (!bc || !k) return Promise.resolve(true);
    if (key === k && state === "live") return Promise.resolve(true);
    if (key === k && waiting) return waiting;
    var quiet = !!(opts && opts.quiet);
    noticeOpts = opts || null;
    var me = waiting = new Promise(function(resolve){
      ask(k).then(function(h){
        if (waiting === me) waiting = null;   // blocked or live, a later claim asks afresh
        if (h) { state = "blocked"; if (!quiet) showNotice(lastFlagged); return; }
        // Nobody else is live (closed, or never there): this tab is, whatever the flag said.
        setFlag("");
        state = "live"; since = Date.now();
        sayLive();   // and say so, so a tab that asked at the same moment finds out
        resolve(true);
      });
    });
    return me;
  }

  /* Is another tab live for k? Takes nothing. Held: this tab goes quiet. Free:
     this tab is idle but listening, so a claim elsewhere quietens it later. */
  function watch(k){
    k = String(k || "");
    if (!bc || !k) return Promise.resolve(false);
    if (key === k && state === "live") return Promise.resolve(false);   // it is this tab
    return ask(k).then(function(h){
      if (state === "live") return false;           // a claim() asked the same question and won
      if (h) { state = "blocked"; return true; }
      if (state === "asking") state = "idle";
      return false;
    });
  }

  /* The night is over (End game): stop being the live tab and say so, so another
     tab can open the next one. Does nothing in a tab that does not hold k. */
  function release(k){
    k = String(k || "");
    if (!bc || !k || key !== k || state !== "live") return;
    state = "idle"; since = 0; waiting = null; setFlag("");
    post({ t: "free" });
  }

  function notice(opts){
    if (state !== "blocked" && state !== "down") return false;
    noticeOpts = opts || noticeOpts;
    hideNotice();
    showNotice(lastFlagged);
    return true;
  }

  /* PICKED UP ON ANOTHER DEVICE (vp-pickup.js, 20 Oct 2026). The other console is not a tab on this
     tablet, so BroadcastChannel never hears it; the game Worker says so instead. This tab stands
     down exactly as if another tab had taken over (live() false, so every send and API call
     refuses), and covers the page with the notice, worded for a device. Its button reloads, and the
     reload asks the host whether to pick the game back up here. */
  function moved(opts){
    state = "down";
    noticeOpts = opts || {};
    hideNotice();
    showNotice(true);
  }

  /* An iPad suspends a background tab outright, so it cannot answer while it
     sleeps. When it wakes, say so; whichever of the two is older stands down. */
  function onFront(){ if (root.document && root.document.visibilityState === "visible") sayLive(); }
  try {
    root.addEventListener("pageshow", onFront);
    root.document.addEventListener("visibilitychange", onFront);
  } catch (e) {}

  root.VP_ONETAB = {
    claim: claim,
    watch: watch,
    release: release,
    notice: notice,
    moved: moved,
    // False with no BroadcastChannel: the page then runs exactly as it did before any of this.
    available: function(){ return !!bc; },
    // False only once this tab has been stood down or is waiting behind another.
    live: function(){ return state !== "down" && state !== "blocked"; },
    state: function(){ return state; }
  };
})(typeof window !== "undefined" ? window : this);
