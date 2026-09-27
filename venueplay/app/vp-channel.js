/* vp-channel.js  -- A REALTIME CHANNEL THAT COMES BACK BY ITSELF. ONE ANSWER, EVERY PAGE.

   Audit, 27 Sep 2026. The venue screens (trivia, musical, raffle, members), the bingo channel
   on /tv and both phones said "Reconnecting" when their channel dropped, and then did nothing
   else. supabase-js retries a CHANNEL_ERROR or a TIMED_OUT itself, but a CLOSED channel stays
   closed: it never rejoins. So one wifi blip that ended in CLOSED left a wall deaf, or a phone
   tapping answers into a queue nothing would ever flush, for the rest of the night.

   Three pages had already been fixed by hand, each its own way (the trivia console, the router
   in vp-screen-router.js and the TV's four game channels), and a fourth copy per page is how
   this codebase gets faults. So the rules live here, once:

     1. A NEW CHANNEL PER RETRY. A channel can be subscribed once; subscribing it again throws.
     2. LET GO OF THE OLD ONE BEFORE REMOVING IT. removeChannel() makes the old channel report
        CLOSED inside that very call. If it is still "the current one" when that arrives, it
        reads as a fresh failure and books another retry: the flap that re-joined a venue TV
        3,588 times in half an hour (20 Sep 2026).
     3. A STATUS FROM A CHANNEL WE HAVE REPLACED OR LET GO IS HISTORY, NOT NEWS. That is also
        what stops Leave, or a phone moving to another code, from painting "Reconnecting" on
        the screen it moved to: the channel it hung up reports CLOSED afterwards.
     4. BACK OFF, 2s, 4s, 8s, 16s, then every 30s. One retry in flight at a time.
     5. IF IT HEALS BY ITSELF, CANCEL THE RETRY. Tearing down a channel that just came back is
        a gap of deafness for nothing.

   HOW A PAGE USES IT. keep() returns something shaped like a channel, so a page swaps one call
   and nothing else changes:

       var ch = window.VPChannel ? VPChannel.keep(client, name, opts) : client.channel(name, opts);
       ch.on("broadcast", { event:"msg" }, handler);   // re-attached to every rebuilt channel
       ch.subscribe(function(status){ ... });          // hears only the CURRENT channel
       ch.send(msg);                                   // goes down the current channel; throws if none
       ch.unsubscribe();                               // hang up for good: no more retries, no more news

   The page's status callback is told SUBSCRIBED when a channel joins and the drop status
   (CHANNEL_ERROR, TIMED_OUT, CLOSED) when the current one fails, exactly as before, so every
   page keeps clearing its own "subscribed" flag in its own words. It is never told about a
   channel it has already been told is gone.

   Tested by tools/test-channel-recovery-*.js, which run THIS file against a fake client that
   keeps the real library's two rules (subscribe once; removeChannel reports CLOSED at once).
   ES5, no dependencies. */
(function (root) {
  "use strict";
  var MIN_MS = 2000, MAX_MS = 30000;

  function backoff(tries) { return Math.min(MAX_MS, MIN_MS * Math.pow(2, Math.min(tries, 4))); }
  function isDrop(s) { return s === "CHANNEL_ERROR" || s === "TIMED_OUT" || s === "CLOSED"; }
  function log(msg) { try { root.console && root.console.log("[VenuePlay] " + msg); } catch (e) {} }

  function keep(client, name, opts) {
    var onStatus = null;     // the page's own status callback
    var cur = null,          // the channel we are on now; null between a drop and its rebuild
        listeners = [],      // every .on(), replayed onto each new channel
        retryT = null, tries = 0, stopped = false;

    function schedule() {
      if (retryT || stopped) return;               // one retry in flight, however many errors land
      var wait = backoff(tries); tries++;
      log(name + " dropped, rebuilding in " + (wait / 1000) + "s");
      retryT = setTimeout(rebuild, wait);
    }
    function rebuild() {
      retryT = null;
      if (stopped) return;
      var old = cur;
      cur = null;                                  // rule 2: let go BEFORE removing
      if (old) { try { client.removeChannel(old); } catch (e) {} }
      try { build(); }
      catch (e) { schedule(); }                    // a throw building the next one is not the end of it
    }
    function tell(status) {
      if (!onStatus) return;
      try { onStatus(status); } catch (e) { log(name + " status handler threw: " + e); }
    }
    function build() {
      var mine = client.channel(name, opts);
      cur = mine;
      for (var i = 0; i < listeners.length; i++) mine.on(listeners[i][0], listeners[i][1], listeners[i][2]);
      mine.subscribe(function (status) {
        if (stopped || mine !== cur) return;       // rule 3
        if (status === "SUBSCRIBED") {
          tries = 0;
          if (retryT) { clearTimeout(retryT); retryT = null; }   // rule 5
          tell(status);
          return;
        }
        if (!isDrop(status)) return;
        tell(status);
        schedule();
      });
    }

    var kept = {
      on: function (type, filter, fn) {
        listeners.push([type, filter, fn]);
        if (cur) cur.on(type, filter, fn);
        return kept;
      },
      subscribe: function (cb) {
        onStatus = cb || null;
        if (!cur && !retryT && !stopped) { try { build(); } catch (e) { schedule(); } }
        return kept;
      },
      send: function (msg) {
        if (!cur) throw new Error("VenuePlay: " + name + " has no channel right now");
        return cur.send(msg);
      },
      unsubscribe: function () {
        stopped = true;
        if (retryT) { clearTimeout(retryT); retryT = null; }
        var old = cur; cur = null;                 // rule 2 again: its CLOSED is not news
        if (old) { try { client.removeChannel(old); } catch (e) {} }
        return Promise.resolve("ok");
      },
      current: function () { return cur; },
      retrying: function () { return !!retryT; }
    };
    return kept;
  }

  root.VPChannel = { keep: keep, backoff: backoff };
})(typeof window !== "undefined" ? window : this);
