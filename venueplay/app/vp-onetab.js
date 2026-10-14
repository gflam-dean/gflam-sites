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
    }
  };

  function take(){
    setFlag("");
    post({ t: "take" });
    // Give the message a beat to leave before this page goes.
    setTimeout(function(){ try { root.location.reload(); } catch (e) {} }, 150);
  }

  function showNotice(wasStoodDown){
    var d = root.document; if (!d || !d.body) return;
    if (d.getElementById("vpOneTab")) return;
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
    h.textContent = wasStoodDown ? "This game moved to another tab" : "This game is already open in another tab";
    var p = d.createElement("div");
    p.style.cssText = "font-size:15px;opacity:.85;margin-bottom:18px";
    p.textContent = wasStoodDown
      ? "You opened it again in another tab on this device, so this one has stepped back. Use that tab, or bring the game back here."
      : "Running it in two tabs at once splits the game: what you do in one is not in the other. Use the other tab, or move the game here.";
    var b = d.createElement("button");
    b.type = "button"; b.id = "vpOneTabTake";
    b.style.cssText = "font:inherit;font-size:16px;font-weight:800;padding:12px 20px;border:0;border-radius:999px;" +
      "background:#ff1f8e;color:#fff;cursor:pointer;min-width:220px";
    b.textContent = "Use this tab instead";
    b.addEventListener("click", function(){ b.disabled = true; b.textContent = "Moving the game here..."; take(); });
    card.appendChild(h); card.appendChild(p); card.appendChild(b);
    box.appendChild(card);
    d.body.appendChild(box);
  }

  var waiting = null;
  /* Resolves when this tab is the live console for k. Never resolves while
     another tab holds it: the page stays on the notice, which is the point. */
  function claim(k){
    k = String(k || "");
    if (!bc || !k) return Promise.resolve(true);
    if (key === k && state === "live") return Promise.resolve(true);
    if (key === k && waiting) return waiting;
    key = k; state = "asking"; heard = false;
    var flagged = readFlag() === k;
    if (readFlag() && !flagged) setFlag("");   // a flag for some other console in this tab means nothing here
    waiting = new Promise(function(resolve){
      /* A TAB THAT WAS JUST STOOD DOWN WAITS FOR THE TAKER. It reloads the moment "Use this tab
         instead" is pressed elsewhere, and the taker reloads 150ms after it, so with the usual
         half second the stood-down tab finished loading first, heard nobody, and took the game
         straight back: three tries out of three on the live site (14 Oct 2026). So it listens
         long enough for the taker to load and announce itself (it says "live" the moment it is),
         asking again half way. If nobody comes (that tab was closed) it carries on, so the flag
         alone still never locks a console out. */
      var wait = flagged ? FLAG_WAIT_MS : ASK_MS;
      post({ t: "hello" });
      if (flagged) setTimeout(function(){ if (state === "asking") post({ t: "hello" }); }, wait / 2);
      setTimeout(function(){
        if (heard) { state = "blocked"; showNotice(flagged); return; }
        // Nobody else is live (closed, or never there): this tab is, whatever the flag said.
        setFlag("");
        state = "live"; since = Date.now();
        sayLive();   // and say so, so a tab that asked at the same moment finds out
        resolve(true);
      }, wait);
    });
    return waiting;
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
    // False only once this tab has been stood down or is waiting behind another.
    live: function(){ return state !== "down" && state !== "blocked"; },
    state: function(){ return state; }
  };
})(typeof window !== "undefined" ? window : this);
