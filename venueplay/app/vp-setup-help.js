/* EVERY GAME'S SETTINGS AND THEIR "?" WORDS (Dean, 6 Nov 2026, INBOX 104c). ONE list, used by the setup wizard's
   game screens (vp-gamesetup.js) and, later, by the real settings pages (trivia/host.html Advanced, musical/host.html,
   the bingo console in index.html, raffle/host.html, members/host.html), so the words cannot drift apart.

   Every setting is a REAL one the game's console already has: the console's own label, the key it is saved under
   (vp_venue_settings.game_prefs.<prefs>, migration 121, through the game Worker's /host/game-prefs, whose
   GAME_PREFS_KEYS keeps only these keys; members draws through /host/members/settings into vp_member_draws) and
   TODAY'S DEFAULT, the one the console uses when nothing is saved. The wizard never invents a default ("Defaults stay
   as they are today", Dean, 6 Nov 2026). Never here: paid or free for the night, unsold tickets, permits.

     help     one or two plain lines: what it does, and when to change it (the "?")
     prompt   the short question the wizard asks for an advanced setting
     options  [saved value, words on screen]; kind seg/select. A seg of On/Off saves true/false.
     kind     seg | select | number | text | range (two keys) | money (dollars on screen, cents saved) |
              info (no control, words only) | sets (trivia categories, read from vp_question_sets) |
              playlists (musical bingo themes, read from the song library)

   Plain words, lowercase venueplay, no em dashes, musical bingo is not bingo. Words checked by
   tools/test-game-setup.js (length, no dashes, every key on the Worker's list). */
(function (root) {
  "use strict";
  var ON_OFF = [[true, "On"], [false, "Off"]];
  var GAMES = [
    { key: "trivia", name: "trivia", title: "Trivia", console: "/app/trivia/host.html", prefs: "trivia", settings: [
      { key: "set_id", label: "Category", kind: "sets", def: "",
        help: "The set of questions you play. We start where your venue left off, so pick another for a fresh night." },
      { key: "count", label: "Questions this round", kind: "number", def: 10, min: 1, max: 100,
        help: "How many questions this round has. Most venues start with 10, and a night you build yourself plays in full." },
      { key: "buzzer", label: "Time's-up buzzer", kind: "seg", options: ON_OFF, def: false,
        help: "A short buzz when the clock runs out on each question, so the room knows answers are closed." },
      { key: "buzzer_where", label: "Buzzer plays on", kind: "seg", options: [["tv", "TV"], ["device", "This device"]], def: "tv",
        help: "TV plays it through the TV's own sound or soundbar. This device plays it from the phone or tablet you host on." },
      { key: "time_s", label: "Time per question (seconds)", kind: "number", def: 30, min: 5, max: 60, advanced: true,
        prompt: "How long should everyone get to answer?",
        help: "How long the room has to answer each question. 30 seconds suits most rooms." },
      { key: "base_points", label: "Correct answer points", kind: "number", def: 100, min: 0, max: 100000, advanced: true,
        prompt: "How many points is a right answer worth?",
        help: "Points for each right answer. A wrong answer scores 0." },
      { key: "speed_bonus", label: "Speed bonus", kind: "seg", options: ON_OFF, def: true, advanced: true,
        prompt: "Should faster answers score more?",
        help: "Faster right answers score up to half as much again. A lightning-fast right answer scores 150 instead of 100." },
      { key: "double_points", label: "Double points final round", kind: "seg", options: ON_OFF, def: false, advanced: true,
        prompt: "Should the last questions score double?",
        help: "The last questions of the night score double, speed bonus included, so teams near the bottom still have a chance." },
      { key: "double_last", label: "Questions in the double points round", kind: "number", def: 10, min: 1, max: 100, advanced: true,
        help: "How many of the last questions score double, when double points is on." }
    ], popovers: ["buzzer", "speed_bonus", "double_points"] },

    { key: "musical", name: "musical bingo", title: "Musical bingo", console: "/app/musical/host.html", prefs: "musical", settings: [
      { key: "playlist", label: "Playlist", kind: "playlists", def: "",
        help: "The songs the cards are made from. Pick a theme your crowd knows, like 80s or Aussie rock." },
      { key: "pattern", label: "Winning pattern", kind: "select", def: "one",
        options: [["one", "One line (any full row)"], ["two", "Two lines"], ["corners", "Four corners"], ["full", "Full house"]],
        help: "What a player needs to win. One line is the quickest game and full house runs the longest." },
      { key: "reveal", label: "Reveal the song on the TV", kind: "select", def: "end",
        options: [["instant", "Straight away"], ["15", "After 15 seconds"], ["end", "When the clip ends"], ["never", "Never, I call it"]],
        help: "When the TV shows the song name. Until then it shows a big question mark, so the room has to know the song, not read it." },
      { key: "prize", label: "Prize", kind: "text", def: "", placeholder: "e.g. $50 bar tab", max: 120,
        help: "What the winner gets, shown on the TV and on every phone. Leave it blank if you'd rather announce it." },
      { key: "hits_only", label: "Well-known songs only", kind: "seg", options: ON_OFF, def: true, advanced: true,
        prompt: "Stick to the songs everyone knows?",
        help: "On: the night leans on songs everyone knows. Off: any song in the playlist can come up, deep cuts and all." },
      { key: "sound", label: "Where the music plays", kind: "info", advanced: true, words: "HDMI from the TV to your soundbar or amp.",
        prompt: "Is your TV plugged into your speakers?",
        help: "The music plays from the TV, so plug the TV's sound into your speakers (HDMI to your soundbar or amp) and it fills the room." }
    ], popovers: ["pattern", "reveal", "hits_only"] },

    { key: "bingo", name: "bingo", title: "Bingo", console: "/app/", prefs: "bingo", settings: [
      { key: "caller", label: "Real balls (caller mode)", kind: "seg", options: ON_OFF, def: false,
        help: "Turn this on if your caller draws real balls. You tap each number in as it's called and the TV keeps up." },
      { key: "pattern", label: "Winning pattern", kind: "select", def: "one",
        options: [["one", "One line (any row)"], ["two", "Two lines"], ["full", "Full house"], ["corners", "Four corners"], ["top", "Top line"], ["middle", "Middle line"], ["bottom", "Bottom line"]],
        help: "What a ticket needs to win. You can make your own pattern later in the bingo console." },
      { key: "prize", label: "Prize", kind: "text", def: "", placeholder: "e.g. $50 bar tab", max: 120,
        help: "What the winner gets. venueplay remembers a prize for each pattern, so it fills in next time." },
      { key: "cards", label: "Tickets each player", kind: "select", def: 1, advanced: true,
        options: [[1, "1 ticket"], [2, "2 tickets"], [3, "3 tickets"], [4, "4 tickets"], [5, "5 tickets"], [6, "6 tickets (a full book)"]],
        prompt: "How many tickets does each player get?",
        help: "How many tickets everyone gets each game. More tickets means more chances and quicker wins." },
      { key: "allow_early", label: "Allow early BINGO calls", kind: "seg", options: ON_OFF, def: false, advanced: true,
        prompt: "Let players call BINGO early, for a laugh?",
        help: "Players can call BINGO before they've really won. A wrong call comes to you and you just tap Play on." }
    ], popovers: ["caller", "cards", "allow_early"] },

    { key: "raffles", name: "raffles", title: "Raffles", console: "/app/raffle/host.html", prefs: "raffle", settings: [
      { key: "prizes", label: "What you draw for", kind: "text", def: "Meat Tray", placeholder: "e.g. Meat Tray", max: 80, list: true,
        help: "Save the prizes you usually draw, like a meat tray or a bar voucher, so each one is a single tap on the night." },
      { key: "range", keys: ["range_min", "range_max"], label: "Ticket numbers", kind: "range", def: [1, 150], min: 0, max: 999999,
        help: "The first and last numbers in your ticket book. Only numbers in this range can be drawn." },
      { key: "time_to_present", label: "Time to claim (seconds)", kind: "number", def: 180, min: 0, max: 3600, advanced: true,
        prompt: "How long does a winner get to bring their ticket up?",
        help: "How long a winner has to show their ticket before you can draw again (180 seconds is 3 minutes). Put 0 for no limit." },
      { key: "jackpot_on", label: "Cash jackpot", kind: "seg", options: ON_OFF, def: false, advanced: true,
        prompt: "Is this a cash jackpot instead of a prize?",
        help: "For a cash jackpot rather than a prize. The default is $500, and we warn you if it's over your state's limit." },
      { key: "jackpot_amount_cents", label: "Jackpot amount ($)", kind: "money", def: 50000, advanced: true,
        help: "The cash jackpot, when the raffle has one. The console warns you if it's over your state's limit." },
      { key: "allow_redraw", label: "Allow a redraw if the winner isn't here", kind: "seg", options: ON_OFF, def: true, advanced: true,
        prompt: "Draw again if the winner isn't here?",
        help: "If nobody claims in time, you can draw again straight away, in front of the room." },
      { key: "spin_seconds", label: "Draw spin length", kind: "select", def: 4, advanced: true,
        options: [[3, "3s"], [4, "4s"], [5, "5s"], [6, "6s"], [8, "8s"]],
        prompt: "How long should the numbers spin on the TV?",
        help: "How long the numbers spin on the TV before the winner shows. Longer builds the suspense." }
    ], popovers: ["range", "time_to_present", "allow_redraw"] },

    /* MEMBERS DRAWS: no defaults today (every box starts empty), and the draw's own settings are saved by
       /host/members/settings (manager or owner), which makes the draw. A venue that skips this has no draw yet, so
       the words never say its defaults are saved: the console's own "new draw" form asks the first time. */
    { key: "members", name: "members draws", title: "Members draws", console: "/app/members/host.html", prefs: "members", needsDetails: true, settings: [
      { key: "name", label: "Draw name", kind: "text", def: "", placeholder: "e.g. Friday Members Draw", max: 80, required: true,
        help: "The name on the TV, like Friday Members Draw." },
      { key: "draw_day", label: "Draw day", kind: "text", def: "", placeholder: "e.g. Friday", max: 20,
        help: "When you draw each week. It shows on the TV so members know when to be in." },
      { key: "draw_time", label: "Draw time", kind: "text", def: "", placeholder: "e.g. 7:30pm", max: 20,
        help: "The time you draw. It shows on the TV beside the day." },
      { key: "date_started", label: "Start date", kind: "date", def: "",
        help: "When this draw began. The TV uses it to say how long the draw has been running." },
      { key: "starting_amount_cents", label: "Starting jackpot ($)", kind: "money", def: "",
        help: "What the jackpot starts at, and what it goes back to after someone wins it." },
      { key: "increment_cents", label: "Weekly increment ($)", kind: "money", def: "", advanced: true,
        prompt: "How much does it grow each week nobody wins?",
        help: "How much the jackpot goes up each week it isn't claimed." },
      { key: "max_jackpot_cents", label: "Maximum jackpot ($)", kind: "money", def: "", placeholder: "No maximum", advanced: true,
        prompt: "Is there a most the jackpot can reach?",
        help: "The most the jackpot can grow to, or leave it blank for no cap. We warn you if your state has a limit." },
      { key: "time_to_claim_seconds", label: "Time to claim (seconds)", kind: "number", def: "", placeholder: "e.g. 180", min: 30, max: 3600, advanced: true,
        prompt: "How long does a drawn member get to reach the host?",
        help: "How long a drawn member has to get to the host. At least 30 seconds, so they can make it across the room." }
    ], popovers: ["increment_cents", "max_jackpot_cents", "time_to_claim_seconds"] }
  ];
  function byKey(k) { return GAMES.filter(function (g) { return g.key === k; })[0] || null; }
  /* A game's saved values from today's defaults, for the keys the Worker keeps (members: none, it has no defaults). */
  function defaults(k) {
    var g = byKey(k), out = {};
    if (!g || g.needsDetails) return out;
    g.settings.forEach(function (s) {
      if (s.kind === "info" || s.kind === "sets" || s.kind === "playlists") return;   // picked on the night, or read live
      if (s.kind === "range") { out[s.keys[0]] = s.def[0]; out[s.keys[1]] = s.def[1]; return; }
      if (s.list) { out[s.key] = s.def ? [s.def] : []; return; }
      if (s.def === "" || s.def == null) return;   // an empty prize is "not set", the console's own empty box
      out[s.key] = s.def;
    });
    return out;
  }
  root.VPSetupHelp = { GAMES: GAMES, byKey: byKey, defaults: defaults };
})(typeof window !== "undefined" ? window : this);
