/* ============================================================================
   KEEP AN OPEN LOBBY ACROSS A CONSOLE REFRESH (website audit part 1b, 13 Nov 2026).

   A host refreshing a tablet in the LOBBY, before the game starts, threw the lobby away: the console
   came back on setup with 0 players and the phones sat on "You're in" for ever. Once a game is
   running the consoles already recover (trivia/musical save a pointer and read /snapshot). The lobby
   has no game row yet, so nothing was saved. This is the same mechanism for the lobby, in one place:

     VP_LOBBY.save(format, venueId, ptr)   ptr = { sessionId, joinCode, ...whatever setup the console wants back }
     VP_LOBBY.read(format, venueId)        the pointer, or null (stale after 6 hours, broken, none)
     VP_LOBBY.clear(format, venueId)       lobby closed, cancelled, started or gone
     VP_LOBBY.live(api, ptr)               resolves { session_id, join_code } when the server still has that
                                           night open with NO game running, otherwise null (night gone)

   The Worker is the truth: the pointer is only "which night was I in". The same session id and the same
   join code come back, so the phones (same device id, same token) are the same players. Nothing here
   ever opens a session; the console re-says its format to /session, which reuses the live one.
   ========================================================================== */
(function (root) {
  "use strict";
  var MAX_AGE = 6 * 60 * 60 * 1000;
  function key(format, venueId) { return "vpLobby-" + format + "-" + (venueId || ""); }
  function save(format, venueId, ptr) {
    try {
      if (!venueId || !ptr || !ptr.sessionId) return;
      var o = {}; for (var k in ptr) if (Object.prototype.hasOwnProperty.call(ptr, k)) o[k] = ptr[k];
      o.v = 1; o.ts = Date.now();
      root.localStorage.setItem(key(format, venueId), JSON.stringify(o));
    } catch (e) {}
  }
  function clear(format, venueId) { try { root.localStorage.removeItem(key(format, venueId)); } catch (e) {} }
  function read(format, venueId) {
    var raw; try { raw = root.localStorage.getItem(key(format, venueId)); } catch (e) { return null; }
    if (!raw) return null;
    var p; try { p = JSON.parse(raw); } catch (e) { clear(format, venueId); return null; }
    if (!p || !p.sessionId || !p.ts || (Date.now() - p.ts) > MAX_AGE) { clear(format, venueId); return null; }
    return p;
  }
  /* null = the night is gone (closed, finished, or a game is running which the running-game restore owns).
     undefined = could not tell (no network): the caller keeps the pointer and carries on as before. */
  function live(api, ptr) {
    if (!ptr || !ptr.sessionId) return Promise.resolve(null);
    return root.fetch(String(api).replace(/\/$/, "") + "/snapshot?session=" + encodeURIComponent(ptr.sessionId))
      .then(function (res) { if (res.status === 404 || res.status === 400) return null; return res.ok ? res.json() : undefined; })
      .then(function (s) {
        if (s === undefined) return undefined;
        if (!s || s.error) return null;
        var open = s.status === "lobby" || s.status === "running" || s.status === "paused";
        if (!open || s.game) return null;
        return { session_id: s.session_id, join_code: s.join_code || ptr.joinCode || "", player_count: s.player_count };
      }, function () { return undefined; });
  }
  root.VP_LOBBY = { save: save, read: read, clear: clear, live: live, key: key };
})(typeof window !== "undefined" ? window : this);
