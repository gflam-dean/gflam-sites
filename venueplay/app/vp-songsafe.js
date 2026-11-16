/* NO RUDE SONG REACHES A PUB (Dean, 16 Nov 2026: "There should never be anything on our website that fucks with a game ... That's not a song.")

   The staging play of 16 Nov found five songs in /data/musical-library.json with rude titles, in eight of the built-in playlists. Each song
   can carry a "displayTitle" (the title a pub sees, the real one kept for the clip) or "hidden": true; which one is Dean's choice per song.
   Until a song has one or the other, the console and the Worker leave it out. This is the ONE word list:

     VPSongSafe.isRude(title, artist)   true when a title or an artist has a word on the list (whole words, any case)
     VPSongSafe.shown(song)             the title a pub sees: displayTitle when set, else the title
     VPSongSafe.usable(song)            false for a hidden song or one whose SHOWN title or artist is rude: never on a card, TV, phone or search
     VPSongSafe.WORDS                   the list itself. The game Worker (SONG_RUDE_WORDS in venueplay-game.js) and the staging content copy
                                        (tools/staging/content-tables.txt) carry the SAME string, and tools/test-song-safe.js is red when
                                        they differ or when any song SHOWS a word on the list and is not hidden. A new import is red until a
                                        person gives it a displayTitle, hides it, or narrows this list (all three copies).

   ES5, no page needed (the console, jsc and the Worker's copy all run it). */
(function (root) {
  "use strict";
  var WORDS = "f+u+c+k[a-z]*|f[*@]+k[a-z]*|sh[i1*]t[a-z]*|bitch[a-z]*|biatch|cunts?|motherf[a-z]*|thots?|n[i1]gg[a-z]*|fags?|faggot[a-z]*|twats?|wank[a-z]*|slut[a-z]*|whore[a-z]*|pussy|pussies|cocks?|cocksuck[a-z]*|dicks?|dickhead[a-z]*|bastards?|bollocks|arsehole[a-z]*|assholes?|tits|titties|porn[a-z]*|cum|dildo[a-z]*|blowjob[a-z]*|piss|pissed|pissing";
  var RX = new RegExp("(^|[^a-z])(" + WORDS + ")([^a-z]|$)", "i");
  function isRude(title, artist) { return RX.test(String(title == null ? "" : title)) || RX.test(String(artist == null ? "" : artist)); }
  function shown(s) { return (s && typeof s.displayTitle === "string" && s.displayTitle.replace(/\s+/g, "")) ? s.displayTitle.trim() : String((s && s.title) || ""); }
  function usable(s) { return !!s && s.hidden !== true && !isRude(shown(s), s.artist); }
  root.VPSongSafe = { WORDS: WORDS, isRude: isRude, shown: shown, usable: usable };
})(typeof window !== "undefined" ? window : this);
