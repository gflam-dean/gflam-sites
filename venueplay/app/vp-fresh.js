/* ============================================================================
   A VENUE SCREEN NEVER RUNS AN OLD RELEASE (Dean, live play on The Mini Bar with the Kogan TV app,
   12 Nov 2026, INBOX 282.9: the old musical intro, no fades, the old raffle look).

   Why a TV ran an old screen: the HTTP headers were never the problem. Every page and script is
   served "Cache-Control: no-cache, must-revalidate" (venueplay/_headers), so ANY load gets the live
   file. But a venue TV loads /tv ONCE and keeps it up for days: the TV app opens it and never
   navigates away, a kiosk browser the same. Nothing told it a release had gone out: the build it
   reports (TV_BUILD in tv.html) is a constant last changed on 1 Nov 2026, and a reload only came
   from HQ (reload_at / command) or a change to the room's formats. So /tv and the scripts it loaded
   (vp-tvgame.js, vp-sting.js, vp-drawstyle.js, ...) stayed whatever was live when the TV was
   switched on, release after release.

   What this does: it takes a fingerprint of the screen as it is on the site when the page loads
   (the page's own HTML, fetched with no cache, and the ETag of every script the page loaded from
   this site), then looks again every 10 minutes. A different fingerprint means a release has gone
   out since this page loaded, and the page is told (onNew). tv.html reloads straight away on the
   ads, or the moment the game on the wall ends, never over a game.

   Cheap on a pub's internet: one page fetch (compressed) and one HEAD per script every 10 minutes.
   A fetch that fails changes nothing: the next look tries again. ES5, no dependencies: it runs on
   the Tizen and webOS TV engines (Chromium 68/69).

       <script src="/app/vp-fresh.js"></script>
       VPFresh.start({ onNew: function(){ ... } });
   ========================================================================== */
(function (root) {
  var EVERY_MS = 10 * 60 * 1000;

  function fnv(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h * 16777619) >>> 0; }
    return ("00000000" + h.toString(16)).slice(-8);
  }

  // The scripts this page loaded from its own site, in page order.
  function ownScripts(doc, origin) {
    var out = [], list = doc.getElementsByTagName("script");
    for (var i = 0; i < list.length; i++) {
      var src = list[i].getAttribute("src");
      if (!src) continue;
      if (/^https?:\/\//i.test(src) && src.indexOf(origin + "/") !== 0) continue;   // another site's: not ours to judge
      if (/^\/\//.test(src)) continue;
      out.push(src);
    }
    return out;
  }

  /* The screen as the site has it now: "<html hash>|<etag of each script>". Rejects if any part
     cannot be read, so a half-read fingerprint is never compared. */
  function fingerprint(o) {
    var f = o.fetch, page = o.page, scripts = o.scripts || [];
    return f(page, { cache: "no-store", credentials: "same-origin" }).then(function (r) {
      if (!r || !r.ok) throw new Error("page " + (r && r.status));
      return r.text();
    }).then(function (html) {
      var parts = [fnv(String(html || ""))], i = 0;
      function next() {
        if (i >= scripts.length) return parts.join("|");
        var src = scripts[i++];
        return f(src, { method: "HEAD", cache: "no-store", credentials: "same-origin" }).then(function (r) {
          if (!r || !r.ok) throw new Error("script " + src + " " + (r && r.status));
          var tag = (r.headers && r.headers.get) ? (r.headers.get("etag") || "") : "";
          parts.push(tag.replace(/^W\//, ""));
          return next();
        });
      }
      return next();
    });
  }

  function start(o) {
    o = o || {};
    var w = o.window || root;
    var f = o.fetch || (w.fetch ? function (u, x) { return w.fetch(u, x); } : null);
    if (!f) return null;
    var setT = o.setTimeout || function (fn, ms) { return w.setTimeout(fn, ms); };
    var every = o.every || EVERY_MS;
    var loc = w.location || {};
    var page = o.page || ((loc.pathname || "/") + (loc.search || ""));
    var scripts = o.scripts || ownScripts(w.document, loc.origin || "");
    var base = null, told = false, stopped = false;
    function look() {
      if (stopped || told) return;
      fingerprint({ fetch: f, page: page, scripts: scripts }).then(function (fp) {
        if (base === null) { base = fp; return; }
        if (fp !== base) { told = true; try { if (o.onNew) o.onNew(fp, base); } catch (e) {} }
      }, function () { /* a failed look changes nothing */ }).then(function () {
        if (!stopped && !told) setT(look, every);
      });
    }
    look();
    return { look: look, stop: function () { stopped = true; }, base: function () { return base; } };
  }

  root.VPFresh = { start: start, fingerprint: fingerprint, ownScripts: ownScripts, fnv: fnv, EVERY_MS: EVERY_MS };
})(typeof window !== "undefined" ? window : this);
