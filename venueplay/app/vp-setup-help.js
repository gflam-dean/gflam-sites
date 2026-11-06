/* EVERY GAME'S SETTINGS AND THEIR "?" WORDS (Dean, 6 Nov 2026, INBOX 104c; round 2 the same day). ONE list, used by
   the setup wizard's game screens (vp-gamesetup.js) and, later, by the real settings pages (trivia/host.html Advanced,
   musical/host.html, the bingo console in index.html, raffle/host.html, members/host.html), so the words cannot drift.

   Every setting is saved under a key the game Worker keeps (vp_venue_settings.game_prefs.<prefs>, migration 121,
   through /host/game-prefs, whose GAME_PREFS_KEYS keeps only its own list); members draws through
   /host/members/settings into vp_member_draws. "def" is TODAY'S DEFAULT, the one the console uses when nothing is
   saved ("Defaults stay as they are today", Dean, 6 Nov 2026), except where Dean set one in round 2: musical bingo's
   default playlist is the popular songs (Pub Classics). Never here: paid or free for the night, unsold tickets,
   permits. Members draws have NO defaults (Dean: "we would be making up their money").

     help      one or two plain lines: what it does, and when to change it (the "?")
     prompt    the short question the wizard asks for an advanced setting
     options   [saved value, words on screen] for seg and select; a yes/no seg saves true/false
     kind      seg | select | number | text | range (keys) | money (dollars shown, cents saved) | date | info |
               sets (trivia categories, read from vp_question_sets) | playlists (musical bingo, pick one or many) |
               prizelist (one box, or one per round or prize: countFrom / sameFrom name the settings that decide)
     showIf    { key: value }: shown only while that setting has that value
     fills     a date that fills another box (members draws: the start date fills the draw day)
     quick     musical bingo's three quick questions on the first open (Dean, round 2)

   Plain words, lowercase venueplay, no em dashes, musical bingo is not bingo. Checked by tools/test-game-setup.js
   (length, no dashes, every key on the Worker's list, every default the console's own). */
(function (root) {
  "use strict";
  var ON_OFF = [[true, "On"], [false, "Off"]];
  var YES_NO = [[true, "Yes"], [false, "No"]];
  /* THE POPULAR SONGS (Dean, 6 Nov 2026): a few crowd-favourite lists that take turns week to week, so the same songs
     are not played every week. Musical bingo's default music; the console plays this week's one
     (VPGameSetup.weekPick, Brisbane weeks from Monday). Ids from venueplay/data/musical-library.json. */
  var POPULAR = ["all-the-hits", "pub-classics", "80s-pop", "90s", "2000s"];   // "All the hits" first (Dean, round 3; tools/make-hits-playlist.py)
  /* WHAT EACH TRIVIA CATEGORY COVERS (Dean, round 3: "show what each includes"). The library's categories are the
     20 themes venueplay-backend/seed-trivia.py rolls the questions up into (THEME_RULES); these words are a short
     plain summary of each theme's rule there. A category not listed shows its question count only. */
  var INCLUDES = {
    "General Knowledge": "A bit of everything", "Australiana": "Aussie places, people and history",
    "Space & Astronomy": "Planets, stars and space travel", "Music": "Songs, bands, singers and albums",
    "Film & TV": "Movies, shows, actors and soaps", "Anime, Comics & Cartoons": "Cartoons, superheroes and anime",
    "Video Games": "Consoles, classic games and gaming", "Sport": "Footy, cricket, the Olympics and more",
    "Food & Drink": "Food, cooking, beer, wine and spirits", "Technology & Transport": "Gadgets, inventions, cars, planes and trains",
    "Science & Nature": "Animals, the body, plants and science", "History": "Wars, empires, explorers and the past",
    "Geography": "Countries, capitals, flags and landmarks", "Books & Literature": "Books, authors and poems",
    "Art & Culture": "Art, fashion, design and festivals", "Mythology & Religion": "Myths, legends and gods",
    "Maths & Puzzles": "Numbers, riddles and brain teasers", "Language & Words": "Words, sayings and grammar",
    "People & Celebrities": "Famous people, royals and leaders", "Hobbies & Collectables": "Games, crafts and pastimes"
  };
  var GAMES = [
    { key: "trivia", name: "trivia", title: "Trivia", console: "/app/trivia/host.html", prefs: "trivia", settings: [
      { key: "set_mode", label: "Your questions", kind: "seg", options: [["mix", "Give me a mix"], ["pick", "Pick categories"]], def: "mix",
        help: "A mix takes questions from every category. Or pick the categories your crowd likes best." },
      { key: "set_ids", label: "Categories", kind: "categories", def: [], showIf: { set_mode: "pick" },
        help: "Tick the categories to play. Each one says what it covers." },
      { key: "rounds", label: "Rounds a night", kind: "number", unit: "rounds", def: 3, min: 1, max: 20,
        help: "How many rounds of trivia you play in a night. Each round is one game on the console." },
      { key: "count", label: "Questions in a round", kind: "number", unit: "questions", def: 10, min: 1, max: 100,
        help: "How many questions a round has. Most venues start with 10, and a night you build yourself plays in full." },
      { key: "prize_list", label: "Usual prizes", kind: "prizebank", def: [], prizes: true, placeholder: "e.g. $50 bar tab",
        help: "We load all your usual prizes so you can tap and go on the night." },
      { key: "buzzer", label: "A buzz when time is up", kind: "seg", options: ON_OFF, def: false, advanced: true, prompt: "A buzz when time is up?",
        brief: function (v) { return v ? "a buzz when time is up" : ""; },
        help: "A short buzz when the clock runs out on each question, so the room knows answers are closed." },
      { key: "buzzer_where", label: "Where the buzz plays", kind: "seg", options: [["tv", "TV"], ["device", "This device"]], def: "tv", showIf: { buzzer: true }, advanced: true, prompt: "Where should the buzz play?",
        help: "TV plays it through the TV's own sound or soundbar. This device plays it from the phone or tablet you host on." },
      { key: "time_s", label: "Seconds to answer", kind: "number", unit: "seconds", def: 30, min: 5, max: 60, advanced: true,
        brief: function (v) { return v ? v + " seconds to answer" : ""; },
        prompt: "How long should everyone get to answer?",
        help: "How long the room has to answer each question. 30 seconds suits most rooms." },
      { key: "base_points", label: "Points for a right answer", kind: "number", unit: "points", def: 100, min: 0, max: 100000, advanced: true,
        brief: function (v) { return v != null ? v + " points a right answer" : ""; },
        prompt: "How many points is a right answer worth?",
        help: "Points for each right answer. A wrong answer scores 0." },
      { key: "speed_bonus", label: "Faster answers score more", kind: "seg", options: ON_OFF, def: true, advanced: true,
        brief: function (v) { return v ? "faster answers score more" : "no speed bonus"; },
        prompt: "Should faster answers score more?",
        help: "A quick right answer scores up to half as much again, so a lightning-fast one scores 150 instead of 100." },
      { key: "double_points", label: "Double points at the end", kind: "seg", options: ON_OFF, def: false, advanced: true,
        brief: function (v) { return v ? "double points at the end" : "no double points"; },
        prompt: "Should the last few questions be worth double?",
        help: "The last few questions of the night are worth double points, so teams near the bottom can still catch up." },
      { key: "double_last", label: "How many questions are worth double", kind: "number", unit: "questions", def: 10, min: 1, max: 100, advanced: true, showIf: { double_points: true },
        help: "How many of the last questions are worth double points. 10 means the last 10 questions of the night." }
    ], popovers: ["set_mode", "speed_bonus", "double_points"] },

    /* MUSICAL BINGO (Dean, round 3): rounds a night, a prize for each round one under the other (not the same every
       round unless they say so, and "no prize this round" allowed), the same each week. No pattern: that is picked on
       the night with the crowd. */
    { key: "musical", name: "musical bingo", title: "Musical bingo", console: "/app/musical/host.html", prefs: "musical", settings: [
      { key: "playlists", label: "Your music", kind: "playlists", def: POPULAR, quick: true,
        help: "Pick one or more kinds of music your crowd knows. With more than one, a different one plays each week." },
      { key: "rounds", label: "Rounds a night", kind: "number", unit: "rounds", def: 3, min: 1, max: 10, quick: true,
        help: "How many games you play in a night, so the TV can show the next round coming up." },
      { key: "prize_same", label: "Prizes", kind: "seg", options: [[false, "A different prize each round"], [true, "The same prize every round"]], def: false, quick: true,
        help: "A different prize each round (type them one under the other, or tick No prize), or the same prize every round." },
      { key: "prizes", label: "Prize", kind: "prizelist", def: "", placeholder: "e.g. $20 bar tab", max: 120, countFrom: "rounds", sameFrom: "prize_same", each: "Round", none: true, prizes: true, quick: true, underPrev: true,
        help: "What each round's winner gets. Tick \"No prize\" for a round you play just for fun." },
      { key: "prize_weekly", label: "Same prizes every week?", kind: "seg", options: YES_NO, def: true, advanced: true, prompt: "Same prizes every week?",
        brief: function (v) { return v === false ? "new prizes each week" : "the same prizes every week"; },
        help: "Yes: we load these prizes every night. No: you add the night's prizes when you start the game." },
      { key: "reveal", label: "When the TV shows the song name", kind: "select", def: "end", advanced: true,
        brief: function (v) { return ({ instant: "song name straight away", "15": "song name after 15 seconds", end: "song name when the clip ends", never: "you call the song name" })[v] || ""; },
        options: [["instant", "Straight away"], ["15", "After 15 seconds"], ["end", "When the clip ends"], ["never", "Never, I call it"]],
        prompt: "When should the TV give the song away?",
        help: "Until then the TV shows a big question mark, so the room has to know the song, not read it off the wall." },
      { key: "hits_only", label: "Well-known songs only", kind: "seg", options: ON_OFF, def: true, advanced: true,
        brief: function (v) { return v ? "well-known songs only" : "any song"; },
        prompt: "Stick to the songs everyone knows?",
        help: "On: the night leans on songs everyone knows. Off: any song in your music can come up, deep cuts and all." },
      { key: "sound", label: "The music plays from your TV", kind: "info", soundHelp: true, advanced: true, prompt: "Sound through your speakers",
        words: "To fill the room, play the TV's sound through your venue's speakers.",
        help: "The music comes out of the TV. Most venues run it through their own speakers so everyone can hear." }
    ], popovers: ["playlists", "prize_same", "hits_only"] },

    /* BINGO FOLLOWS THE VENUE'S STATE AND WHETHER IT IS A PUB OR A CLUB (Dean, 6 Nov 2026), from the rules in
       vp-gaming.js (VPGameSetup.bingoRules): where phones may not be tickets, "phone tickets" is switched off and
       one plain line says why; where bingo is not open to a pub at all (SA, NT), there is no bingo setup. Paper
       tickets are the venue's OWN books: venueplay never prints or checks them. No pattern: picked on the night. */
    { key: "bingo", name: "bingo", title: "Bingo", console: "/app/", prefs: "bingo", noMore: true, settings: [
      { key: "ticket_kind", label: "Phone tickets or paper tickets?", kind: "seg", options: [["phone", "Phone tickets"], ["paper", "Paper tickets"]], def: "phone",
        help: "Phone tickets are checked by venueplay when someone calls BINGO. Paper tickets are your own books, checked by your caller." },
      { key: "paper_note", label: "With paper tickets", kind: "info", showIf: { ticket_kind: "paper" },
        words: "Your own books. Your caller checks a win; the numbers show on the TV.",
        help: "venueplay shows every number on the TV either way. Your caller checks a paper ticket when someone calls BINGO." },
      { key: "caller", label: "Who draws the numbers?", kind: "seg", options: [[false, "We can draw them for you"], [true, "You draw real balls"]], def: false, showIf: { ticket_kind: "paper" },
        help: "venueplay can draw the numbers on the TV for you, or your caller draws real balls and taps each number in as it's called." },
      { key: "cards", label: "Phone tickets for each player", kind: "select", def: 6, showIf: { ticket_kind: "phone" },
        options: [[1, "1 ticket"], [2, "2 tickets"], [3, "3 tickets"], [4, "4 tickets"], [5, "5 tickets"], [6, "6 tickets (a book)"]],
        help: "How many tickets each player gets on their phone. 6 (a full book) is the usual." },
      { key: "prize_list", label: "Prizes you usually give", kind: "prizebank", def: [], prizes: true, placeholder: "e.g. Meat tray",
        help: "Any prizes you give for bingo: meat trays, vouchers, cash, anything. They become tap-and-go buttons on the night." },
      { key: "allow_early", label: "Let players call BINGO early", kind: "seg", options: ON_OFF, def: false, advanced: true, showIf: { ticket_kind: "phone" },
        brief: function (v) { return v ? "players can call BINGO early" : "no early BINGO calls"; },
        prompt: "Let players call BINGO early, for a laugh?",
        help: "Players can call BINGO before they've really won. A wrong call comes to you and you just tap Play on." }
    ], popovers: ["ticket_kind", "caller", "prize_list"] },

    { key: "raffles", name: "raffles", title: "Raffles", console: "/app/raffle/host.html", prefs: "raffle", noMore: true, settings: [
      { key: "prize_count", label: "Prizes in each raffle", kind: "number", unit: "prizes", unitOne: "prize", def: 1, min: 1, max: 12,
        help: "How many prizes you draw in a raffle. Each prize gets its own draw on the night." },
      { key: "prizes", label: "Prize", kind: "prizelist", def: "Meat Tray", placeholder: "e.g. Meat Tray", max: 80, countFrom: "prize_count", each: "Prize", prizes: true, ownList: true,
        help: "Your prizes are saved as buttons on the raffle console, so each one is a single tap on the night." },
      { key: "prizes_weekly", label: "The same prizes each week?", kind: "seg", options: YES_NO, def: true, advanced: true, prompt: "The same prizes every raffle night?",
        brief: function (v) { return v === false ? "new prizes each raffle night" : "the same prizes every raffle night"; },
        help: "Yes: we keep these prizes for every raffle. No: you add the night's prizes on the raffle console." },
      { key: "range", keys: ["range_min", "range_max"], label: "Ticket numbers", kind: "range", def: [1, 150], min: 0, max: 999999,
        help: "The first and last numbers in your ticket book. Only numbers in this range can be drawn." },
      { key: "time_to_present", label: "Seconds to claim a prize", kind: "number", unit: "seconds", def: 180, min: 0, max: 3600, advanced: true,
        brief: function (v) { return v ? v + " seconds to claim" : "no time limit to claim"; },
        prompt: "How long does a winner get to bring their ticket up?",
        help: "How long a winner has to show their ticket before you can draw again (180 seconds is 3 minutes). Put 0 for no limit." },
      { key: "jackpot_on", label: "Cash jackpot", kind: "seg", options: ON_OFF, def: false, advanced: true,
        brief: function (v) { return v ? "a cash jackpot" : ""; },
        prompt: "Is this a cash jackpot instead of a prize?",
        help: "For a cash jackpot rather than a prize. The default is $500, and we warn you if it's over your state's limit." },
      { key: "jackpot_amount_cents", label: "Jackpot amount ($)", kind: "money", def: 50000, advanced: true, showIf: { jackpot_on: true },
        help: "The cash jackpot, when the raffle has one. The console warns you if it's over your state's limit." },
      { key: "allow_redraw", label: "Draw again if the winner isn't here", kind: "seg", options: ON_OFF, def: true, advanced: true,
        brief: function (v) { return v ? "draw again if nobody claims" : ""; },
        prompt: "Draw again if the winner isn't here?",
        help: "If nobody claims in time, you can draw again straight away, in front of the room." },
      { key: "spin_seconds", label: "How long the numbers spin", kind: "select", def: 4, advanced: true,
        options: [[3, "3 seconds"], [4, "4 seconds"], [5, "5 seconds"], [6, "6 seconds"], [8, "8 seconds"]],
        prompt: "How long should the numbers spin on the TV?",
        help: "How long the numbers spin on the TV before the winner shows. Longer builds the suspense." }
    ], popovers: ["prize_count", "range", "allow_redraw"] },

    /* MEMBERS DRAWS: no defaults (every box starts empty), and the draw's own settings are saved by
       /host/members/settings (manager or owner), which makes the draw. A skipped members draw is never called saved. */
    { key: "members", name: "members draws", title: "Members draws", console: "/app/members/host.html", prefs: "members", needsDetails: true, noMore: true, settings: [
      { key: "name", label: "Draw name", kind: "text", def: "", placeholder: "Friday Members Draw", max: 80, quick: true,
        help: "The name on the TV. Leave it and we call it after your draw night, like Friday Members Draw." },
      { key: "date_started", label: "When did it start?", kind: "date", def: "", quick: true,
        help: "The date of your first draw. The TV uses it to say how long the draw has been running." },
      { key: "draw_time", label: "Draw time", kind: "time", def: "",
        help: "The time you draw. It shows on the TV beside the day." },
      { key: "current_jackpot_cents", label: "Jackpot now", pre: "$", kind: "money", def: "", placeholder: "e.g. 1,250", quick: true, firstOnly: true,
        help: "What the jackpot is at today, so the TV starts from the right amount." },
      { key: "starting_amount_cents", label: "Starting jackpot", pre: "$", kind: "money", def: "", placeholder: "e.g. 250",
        help: "What the jackpot starts at, and what it goes back to after someone wins it." },
      { key: "increment_cents", label: "It goes up each week by", pre: "$", kind: "money", def: "", placeholder: "e.g. 50", quick: true,
        help: "How much the jackpot goes up each week nobody wins it." },
      { key: "max_jackpot_cents", label: "Most it can reach", pre: "$", kind: "money", def: "", placeholder: "No limit",
        help: "The most the jackpot can grow to, or leave it empty for no limit. We warn you about your state's limit." },
      { key: "over_max", label: "Once it hits the most, the weekly amount is", kind: "seg", def: "keep", setupOnly: true,
        options: [["keep", "Kept for later"], ["second", "Another draw"], ["none", "Not added"]],
        showWhen: function (all) { var v = all.value("max_jackpot_cents"); return v != null && v > 0; },
        help: "Kept: it starts the next jackpot after a win; another draw: it builds a second jackpot. Not added: it just stops growing." },
      { key: "time_to_claim_seconds", label: "Seconds to claim", kind: "number", unit: "seconds", def: "", placeholder: "180", min: 30, max: 3600, advanced: true,
        prompt: "How long does a drawn member get to reach the host?",
        brief: function (v) { return v ? v + " seconds to reach the host" : "the usual time to reach the host"; },
        help: "How long a drawn member has to get to the host. At least 30 seconds, so they can make it across the room." }
    ], popovers: ["date_started", "increment_cents", "max_jackpot_cents"] }
  ];
  function byKey(k) { return GAMES.filter(function (g) { return g.key === k; })[0] || null; }
  /* A game's saved values from its defaults, for the keys the Worker keeps (members: none, it has no defaults). */
  /* opts.bank: the usual prizes shared across games. opts.bingo: the venue's bingo rules (VPGameSetup.bingoRules): no phone tickets there means paper by default,
     and venueplay drawing the numbers wherever that is allowed. */
  function defaults(k, opts) {
    var g = byKey(k), out = {};
    if (!g || g.needsDetails) return out;
    var br = (opts && opts.bingo) || null;
    g.settings.forEach(function (s) {
      /* the venue's usual prizes, when they said they use them across games (Dean, round 3): every game's buttons */
      if (s.kind === "prizebank") { if (opts && Array.isArray(opts.bank) && opts.bank.length) out[s.key] = opts.bank.slice(0, 8); return; }
      if (s.kind === "info" || s.kind === "sets" || s.kind === "categories" || s.kind === "taglist") return;   // words only, or theirs to give
      if (s.kind === "range") { out[s.keys[0]] = s.def[0]; out[s.keys[1]] = s.def[1]; return; }
      if (s.kind === "playlists") { out.playlists = s.def.slice(); out.playlist = s.def[0]; return; }
      if (s.kind === "prizelist") { if (s.def) { out[s.key] = [s.def]; if (k === "musical") out.prize = s.def; } return; }
      if (s.def === "" || s.def == null) return;   // an empty prize is "not set", the console's own empty box
      if (s.showIf && k === "bingo" && br && !br.phones && s.showIf.ticket_kind === "phone") return;
      if (s.showIf && k === "bingo" && (!br || br.phones) && s.showIf.ticket_kind === "paper") return;
      out[s.key] = s.def;
    });
    if (k === "bingo" && br && !br.phones) { out.ticket_kind = "paper"; out.caller = br.autoDraw === false; }
    return out;
  }
  root.VPSetupHelp = { GAMES: GAMES, byKey: byKey, defaults: defaults, POPULAR: POPULAR, DEFAULT_PLAYLIST: POPULAR[0], INCLUDES: INCLUDES };
})(typeof window !== "undefined" ? window : this);
