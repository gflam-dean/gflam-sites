/* THE FIVE THINGS A LIVE MUSICAL BINGO NIGHT FOUND, AND A GUARD FOR EACH.

   Dean, 31 Aug: "I need to ensure these things dont happen again." Every one of
   these was invisible to the release check, cost a real night, and was fixed by a
   few lines that the next edit could quietly undo. This reads the deployed pages
   and fails if any of those lines goes away.

   Structural, not behavioural, and deliberately so: the behaviour needs a host, a
   TV and phones in a room, which no test here can have. What it CAN do is notice
   that the guard is gone, which is the moment the fault comes back. Each check
   names the night it came from, so a future edit knows what it is deleting.

   Run: jsc venueplay/app/musical/live-fixes.test.js
*/
var bad = 0;
function pass(n, c, why){ print((c ? "  ok   " : "  FAIL ") + n + (c || !why ? "" : "   " + why)); if(!c) bad++; }

function read(paths, min){
  for (var i = 0; i < paths.length; i++){
    try { var t = readFile(paths[i]); if (t && t.length > min) return t; } catch(e){}
  }
  return null;
}
function find(rel){
  return read([ "venueplay/app/" + rel,
                rel + rel ], 1000);
}

var screenSrc  = find("musical/screen.html");
var playSrc    = find("musical/play.html");
var hostSrc    = find("musical/host.html");
var trivScreen = find("trivia/screen.html");
var trivHost   = find("trivia/host.html");
pass("the pages are all readable", !!(screenSrc && playSrc && hostSrc && trivScreen && trivHost));
if (!screenSrc || !playSrc || !hostSrc || !trivScreen || !trivHost) throw new Error("missing pages");

/* 1. TWO CODES ON THE WALL.
   The setup line carries the HOST PAIRING code, which is not the player code. It
   was hidden only once a session opened, so a QR-paired screen showed both at once
   and a punter reading the wrong one landed on a channel with no game on it. */
[["musical", screenSrc], ["trivia", trivScreen]].forEach(function (p){
  var m = /setupDone\s*=([^;\n]*)/.exec(p[1]);
  pass(p[0] + ": the pairing code goes when a host connects",
       !!m && m[1].indexOf("hostSeen") !== -1,
       "setupDone no longer depends on the host being seen, so two codes can share the wall");
});

/* 2. THE ALBUM ART VANISHING.
   A state refresh carries the titles played, not the artwork, and blanked the art
   anyway. The host resends state whenever any phone announces itself, so in a busy
   room the art disappeared over and over mid-song. */
pass("the art survives a state refresh",
     /_shownTitle/.test(screenSrc) && /if\s*\(\s*t\s*!==\s*_shownTitle\s*\)/.test(screenSrc),
     "the state handler blanks the artwork again");

/* 3. THE CARD FLASHING ON EVERY SONG.
   renderCard emptied the grid and built 25 new cells each time a song played, then
   re-measured every font size. A tap landing mid-rebuild hit an element that had
   already gone. */
pass("the player card is patched, not rebuilt",
     /_cardSig/.test(playSrc) && /if\s*\(\s*fresh\s*\)\s*\{[\s\S]{0,200}innerHTML\s*=\s*""/.test(playSrc),
     "the grid is being cleared unconditionally again");

/* 4. THE LOBBY DROPPING TO THE ADS.
   An ended night and a freshly opened lobby both arrive as idle-then-state, so the
   18 second wind-down took the wall to advertising with the room still scanning.
   And silence cannot mean the host has gone: a LOCKED IPAD runs no JavaScript, so
   the screen has to ask the Worker whether the session is still open. */
pass("the console says which one it is (lobby vs ended)",
     /lobby:\s*\(\s*G\.status\s*===\s*"lobby"\s*\)/.test(hostSrc),
     "state no longer carries the lobby flag, so an open lobby reads as an ended night");
[["musical", screenSrc], ["trivia", trivScreen]].forEach(function (p){
  pass(p[0] + ": silence asks the session before clearing the wall",
       /play\/live\?code=/.test(p[1]) && /LOBBY_SILENCE_MS/.test(p[1]),
       "the screen decides from silence alone again, which a locked iPad looks exactly like");
  pass(p[0] + ": a lobby is capped at an hour",
       /LOBBY_MAX_MS\s*=\s*60\s*\*\s*60\s*\*\s*1000/.test(p[1]),
       "the hour cap is gone or has been changed");
});
[["musical", hostSrc], ["trivia", trivHost]].forEach(function (p){
  pass(p[0] + ": the console has a heartbeat",
       /HEARTBEAT_MS/.test(p[1]),
       "without it the screen cannot tell an open lobby from a closed laptop");
});

/* 4b. A HEARTBEAT MUST NOT COUNT AS "OUR GAME IS ON AIR".

   The screen router refuses to hand the wall to another game while our own game
   is still talking, on a 90 second window. The consoles send a heartbeat every
   30 seconds while merely OPEN, so once the screens started passing that through
   unfiltered, a host who finished a quiz and left the tab open owned the wall for
   the rest of the night. It is fault 2 in vp-screen-router's own header, and it
   came back the day the heartbeats were added.

   The router's onAir() already puts host_here, idle and an inactive state on the
   right side of the line. These checks exist so the screens keep asking it. */
var router = read([ "venueplay/app/vp-screen-router.js", "../vp-screen-router.js" ], 500);
pass("the router filters its own liveness signal",
     !!router && /seen:\s*function\s*\(m\)[\s\S]{0,120}onAir\(m\)/.test(router),
     "seen() counts any traffic again, so a heartbeat pins the wall to a finished game");
[["trivia", trivScreen], ["musical", screenSrc]].forEach(function (p2){
  pass(p2[0] + ": the screen passes the message to seen()",
       /_router\.seen\(m\)/.test(p2[1]),
       "calls seen() with nothing, so every heartbeat counts as gameplay");
});

/* 5. THE ROOM COULD NOT GET LOUD ENOUGH.
   An <audio> element cannot exceed the file's own level, so a laptop on HDMI tops
   out at whatever the track was mastered at. The clip runs through a gain stage
   into a limiter now. crossOrigin is load-bearing: without it the graph is fed
   SILENCE rather than erroring, which is the worst way for this to fail. */
pass("the venue sound has gain above unity",
     /createGain\(\)/.test(screenSrc) && /createDynamicsCompressor\(\)/.test(screenSrc),
     "the boost stage is gone and the room is back to the file's own level");
pass("crossOrigin is set before the clip loads",
     /crossOrigin\s*=\s*"anonymous"/.test(screenSrc),
     "without it the Web Audio graph plays SILENCE and says nothing");
pass("the boost falls back rather than going quiet",
     /_graphDead/.test(screenSrc),
     "there is no fallback if the audio graph cannot be built");
pass("the host console can turn the room up",
     /setRoomVolume/.test(hostSrc) && /volRange/.test(hostSrc));

/* 6. AND THE ONE THAT COSTS MONEY.
   The Worker de-duplicates a rejoin on the pid a phone sends. A page that omits it
   mints and BILLS another player row every time somebody reloads. */
var vpPlay = read([ "venueplay/play.html", "../../play.html" ], 1000);
pass("/play still sends its device id when it joins",
     !!vpPlay && /pid:\s*deviceId\(\)/.test(vpPlay),
     "every rejoin mints and bills another player again");
pass("/play reuses a token it already holds",
     !!vpPlay && /savedToken/.test(vpPlay),
     "a refresh joins as a new person again");

print(bad ? ("  " + bad + " FAILED") : "ALL CHECKS PASSED");
if (bad) throw new Error(bad + " failed");
