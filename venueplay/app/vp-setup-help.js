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
    { key: "trivia", name: "trivia", title: "Trivia", console: "/app/trivia/host.html", prefs: "trivia",
      moreWords: "Time to answer, points, and the buzzer.", settings: [
      { key: "set_mode", label: "Your questions", kind: "seg", options: [["mix", "Give me a mix"], ["pick", "Pick categories"]], def: "mix",
        help: "A mix asks from every category. Or pick the ones your crowd likes." },
      { key: "set_ids", label: "Categories", kind: "categories", def: [], showIf: { set_mode: "pick" },
        help: "Tick the ones to play. General Knowledge is a bit of everything." },
      { key: "rounds", label: "Rounds a night", kind: "number", def: 3, min: 1, max: 20,
        help: "How many rounds you play in a night." },
      { key: "count", label: "Questions in a round", kind: "number", def: 10, min: 1, max: 100,
        help: "How many questions in each round. Most venues use 10." },
      { key: "prize_list", label: "Usual prizes", kind: "prizebank", def: [], prizes: true, placeholder: "e.g. $50 bar tab",
        help: "Your prizes become buttons on the night, so you tap instead of type." },
      /* asked for trivia too, as for musical bingo (Dean, round 9 point 13) */
      { key: "prize_weekly", label: "Same prizes every week?", kind: "seg", options: YES_NO, def: true,
        help: "Yes: these prizes load every night. No: you add them on the night." },
      /* DOUBLE POINTS (Dean, round 9 points 10, 26 and 27): Yes or No, off unless they say Yes. Each round of the night
         is its own game, and the game doubles the last double_last questions of each one, so Yes asks how many in each
         round. "The whole last round" needs the double points round (feature/trivia-countdown-double-9nov): later. */
      { key: "double_points", label: "Double points?", kind: "seg", options: YES_NO, def: false,
        help: "The last questions of every round score double, so teams at the bottom can catch up. Off unless you say Yes." },
      { key: "double_last", label: "How many questions in each round are worth double?", kind: "number", def: 2, min: 1, max: 100, showIf: { double_points: true },
        help: "For example 2: the last 2 questions of every round score double." },
      /* PICTURE ROUNDS (Dean, round 9 point 28) */
      { key: "picture_note", label: "Picture rounds", kind: "info",
        words: "A picture question shows its picture on the TV and on phones. Paper teams look at the TV.",
        help: "Add a picture to any question in the question builder. Paper teams play it too, from the TV." },
      { key: "time_s", label: "Seconds to answer", kind: "number", def: 30, min: 5, max: 60, advanced: true,
        prompt: "Seconds to answer each question",
        help: "How long everyone has to answer. 30 seconds suits most rooms." },
      { key: "base_points", label: "Points for a right answer", kind: "number", def: 100, min: 0, max: 100000, advanced: true,
        prompt: "Points for a right answer",
        help: "Points for each right answer. A wrong answer scores nothing." },
      { key: "speed_bonus", label: "Faster answers score more", kind: "seg", options: ON_OFF, def: true, advanced: true,
        prompt: "Faster answers score more",
        help: "A quick right answer scores up to half as much again. Paper teams don't get the speed bonus." },
      { key: "buzzer", label: "A buzz when time is up", kind: "seg", options: ON_OFF, def: false, advanced: true, prompt: "Buzz when time is up",
        help: "A short buzz when time runs out, so the room knows answers are closed." },
      { key: "buzzer_where", label: "Where the buzz plays", kind: "seg", options: [["tv", "TV"], ["device", "This device"]], def: "tv", showIf: { buzzer: true }, advanced: true, prompt: "Where the buzz plays",
        help: "From the TV's sound, or from the phone or tablet you host on." }
    ], popovers: ["set_mode", "speed_bonus", "double_points"] },

    /* MUSICAL BINGO (Dean, rounds 3 to 8): rounds a night, a prize for each round (or no prize), the same each week
       asked on the first open too. No pattern: that is picked on the night with the crowd. */
    { key: "musical", name: "musical bingo", title: "Musical bingo", console: "/app/musical/host.html", prefs: "musical",
      moreWords: "When the song name shows, which songs play, and your speakers.", settings: [
      { key: "playlists", label: "Your music", kind: "playlists", def: POPULAR, quick: true,
        help: "Pick one or more. With more than one, a different one plays each week." },
      { key: "rounds", label: "Rounds a night", kind: "number", def: 3, min: 1, max: 10, quick: true,
        help: "How many games you play in a night." },
      { key: "prize_same", label: "Prizes", kind: "seg", options: [[false, "Different each round"], [true, "Same every round"]], def: false, quick: true,
        help: "Pick a prize for each round, or tick No prize. Or one prize for every round." },
      { key: "prizes", label: "Prize", kind: "prizelist", def: "", placeholder: "e.g. $20 bar tab", max: 120, countFrom: "rounds", sameFrom: "prize_same", each: "Round", none: true, prizes: true, quick: true, underPrev: true,
        help: "What each round's winner gets." },
      { key: "prize_weekly", label: "Same prizes every week?", kind: "seg", options: YES_NO, def: true, quick: true,
        help: "Yes: these prizes load every night. No: you add them on the night." },
      { key: "reveal", label: "When the TV shows the song name", kind: "select", def: "end", advanced: true,
        options: [["instant", "Straight away"], ["15", "After 15 seconds"], ["end", "When the clip ends"], ["never", "Only in the played-songs list"]],
        prompt: "When the TV shows the song name",
        help: "Until then the TV shows a question mark, so players have to know the song. Only in the played-songs list: the name never shows while the song plays, only in the TV's list of songs already played." },
      { key: "hits_only", label: "Well-known songs only", kind: "seg", options: ON_OFF, def: true, advanced: true,
        prompt: "Only songs everyone knows",
        help: "On: songs everyone knows. Off: any song in your music." },
      { key: "sound", label: "Your speakers", kind: "info", soundHelp: true, advanced: true, prompt: "Your speakers",
        help: "The TV's own speakers play it already. This is for a venue whose sound runs through a separate amp or PA." }
    ], popovers: ["playlists", "prize_same", "hits_only"] },

    /* BINGO FOLLOWS THE VENUE'S STATE AND WHETHER IT IS A PUB OR A CLUB (Dean, 6 Nov 2026), from the rules in
       vp-gaming.js (VPGameSetup.bingoRules). Paper tickets are the venue's OWN books: venueplay never prints or checks
       them. No pattern: picked on the night. A prize for each game of the night (Dean, round 8b point 11). */
    { key: "bingo", name: "bingo", title: "Bingo", console: "/app/", prefs: "bingo", noMore: true, settings: [
      { key: "ticket_kind", label: "Phone tickets or paper tickets?", kind: "seg", options: [["phone", "Phone tickets"], ["paper", "Paper tickets"]], def: "phone",
        help: "We check phone tickets when someone calls BINGO. Your caller checks paper ones." },
      { key: "paper_note", label: "With paper tickets", kind: "info", showIf: { ticket_kind: "paper" },
        words: "Your own books. Your caller checks a win; the numbers show on the TV.",
        help: "The numbers show on the TV either way." },
      { key: "caller", label: "Who draws the numbers?", kind: "seg", options: [[false, "We can draw them for you"], [true, "You draw real balls"]], def: false, showIf: { ticket_kind: "paper" },
        help: "We draw on the TV, or your caller draws real balls and taps each one in." },
      { key: "cards", label: "Phone tickets for each player", kind: "select", def: 6, showIf: { ticket_kind: "phone" },
        options: [[1, "1 ticket"], [2, "2 tickets"], [3, "3 tickets"], [4, "4 tickets"], [5, "5 tickets"], [6, "6 tickets (a book)"]],
        help: "How many tickets each player gets. 6 (a full book) is usual." },
      { key: "rounds", label: "Games a night", kind: "number", def: 3, min: 1, max: 30,
        help: "How many games of bingo you play in a night." },
      { key: "round_prizes", label: "Prize for each game", kind: "prizelist", def: "", placeholder: "e.g. Meat tray", max: 80, countFrom: "rounds", each: "Game", none: true, prizes: true,
        help: "What each game's winner gets: a meat tray, a voucher, cash, anything." },
      { key: "allow_early", label: "Let players call BINGO early", kind: "seg", options: ON_OFF, def: false, advanced: true, showIf: { ticket_kind: "phone" },
        prompt: "Let players call BINGO early, for a laugh?",
        help: "A wrong call comes to you and you just tap Play on." }
    ], popovers: ["ticket_kind", "caller", "round_prizes"] },

    /* RAFFLES (Dean, round 8b point 7): how many raffles a night and how many prizes in each, which can differ; the
       prizes are the console's buttons. Ticket numbers are not asked: the console starts each raffle after the last. */
    { key: "raffles", name: "raffles", title: "Raffles", console: "/app/raffle/host.html", prefs: "raffle", noMore: true, settings: [
      { key: "raffles", label: "Raffles a night", kind: "number", def: 1, min: 1, max: 12,
        help: "How many raffles you draw in a night." },
      /* EACH RAFFLE ASKS THE SAME QUESTIONS (Dean, round 9 point 20): how many prizes, are they all the same, and the
         prizes. Nothing filled in for them; a usual prize or "Winner's choice" is one tap. */
      { key: "raffle_plan", label: "Your raffles", kind: "raffleplan", def: [], countFrom: "raffles", min: 1, max: 12, placeholder: "e.g. Meat tray",
        help: "How many prizes each raffle has, and what they are. Your prizes become buttons on the raffle console." },
      { key: "time_to_present", label: "How long do winners have to claim?", kind: "select", def: 180,
        options: [[60, "1 minute"], [120, "2 minutes"], [180, "3 minutes"], [300, "5 minutes"], [600, "10 minutes"], [0, "No limit"]],
        help: "How long a winner has to show their ticket before you can draw again." },
      { key: "prizes_weekly", label: "The same prizes each week?", kind: "seg", options: YES_NO, def: true, advanced: true, prompt: "The same prizes each week?",
        help: "Yes: we keep these prizes. No: you add them on the night." },
      { key: "jackpot_on", label: "Cash jackpot", kind: "seg", options: ON_OFF, def: false, advanced: true, prompt: "A cash jackpot instead of a prize?",
        help: "For a cash jackpot instead of a prize. We warn you if it's over your state's limit." },
      { key: "jackpot_amount_cents", label: "Jackpot amount ($)", kind: "money", def: 50000, advanced: true, showIf: { jackpot_on: true },
        help: "The cash jackpot. We warn you if it's over your state's limit." },
      { key: "allow_redraw", label: "Draw again if the winner isn't here", kind: "seg", options: ON_OFF, def: true, advanced: true, prompt: "Draw again if the winner isn't here?",
        help: "If nobody claims in time, you can draw again straight away." },
      { key: "spin_seconds", label: "How long the numbers spin", kind: "select", def: 4, advanced: true, prompt: "How long the numbers spin",
        options: [[3, "3 seconds"], [4, "4 seconds"], [5, "5 seconds"], [6, "6 seconds"], [8, "8 seconds"]],
        help: "How long the numbers spin on the TV before the winner shows." }
    ], popovers: ["raffles", "raffle_plan", "time_to_present"] },

    /* MEMBERS DRAWS: no defaults (every box starts empty), and the draw's own settings are saved by
       /host/members/settings (manager or owner), which makes the draw. A skipped members draw is never called saved. */
    { key: "members", name: "members draws", title: "Members draws", console: "/app/members/host.html", prefs: "members", needsDetails: true, noMore: true, settings: [
      { key: "name", label: "Draw name", kind: "text", def: "", placeholder: "Friday Members Draw", max: 80, quick: true,
        help: "The name on the TV. Leave it empty and we name it after your draw night." },
      { key: "date_started", label: "When did it start?", kind: "date", def: "", quick: true,
        help: "Your first draw. The TV says how long the draw has been running." },
      { key: "draw_time", label: "Draw time", kind: "time", def: "",
        help: "The time you draw. It comes from the night you picked." },
      { key: "current_jackpot_cents", label: "Current jackpot for the next draw", pre: "$", kind: "money", def: "", placeholder: "e.g. 1250", quick: true,
        help: "What the next draw is worth, so the TV starts from the right amount." },
      { key: "starting_amount_cents", label: "After a win it goes back to", pre: "$", kind: "money", def: "", placeholder: "e.g. 250",
        help: "What the jackpot goes back to after someone wins it." },
      { key: "increment_cents", label: "It goes up each week by", pre: "$", kind: "money", def: "", placeholder: "e.g. 50", quick: true,
        help: "How much it goes up each week nobody wins." },
      { key: "max_jackpot_cents", label: "Most it can reach", pre: "$", kind: "money", def: "", placeholder: "None",
        help: "Leave it empty for no limit. We warn you about your state's limit." },
      { key: "over_max", label: "Once it hits the most, the weekly amount is", kind: "seg", def: "keep", setupOnly: true,
        options: [["keep", "Kept for later"], ["second", "Another draw"], ["none", "Not added"]],
        showWhen: function (all) { var v = all.value("max_jackpot_cents"); return v != null && v > 0; },
        help: "Kept: it starts the next jackpot after a win. Another draw: it builds a second one." },
      { key: "time_to_claim_seconds", label: "Seconds to claim", kind: "number", def: "", placeholder: "180", min: 30, max: 3600, advanced: true,
        prompt: "How long does a drawn member get to reach the host?",
        help: "At least 30 seconds, so they can make it across the room." }
    ], popovers: ["date_started", "current_jackpot_cents", "max_jackpot_cents"] }
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
      if (s.kind === "prizebank") { if (opts && Array.isArray(opts.bank) && opts.bank.length) out[s.key] = opts.bank.slice(0, 8); else if (Array.isArray(s.def) && s.def.length) out[s.key] = s.def.slice(); return; }
      if (s.kind === "countlist" || s.kind === "raffleplan") return;   // how many prizes in each raffle, and which: theirs to give
      if (s.kind === "info" || s.kind === "sets" || s.kind === "categories" || s.kind === "taglist") return;   // words only, or theirs to give
      if (s.kind === "range") { out[s.keys[0]] = s.def[0]; out[s.keys[1]] = s.def[1]; return; }
      if (s.kind === "playlists") { out.playlists = s.def.slice(); out.playlist = s.def[0]; return; }
      if (s.kind === "prizelist") { if (s.def) { out[s.key] = [s.def]; if (k === "musical") out.prize = s.def; } return; }
      if (s.def === "" || s.def == null) return;   // an empty prize is "not set", the console's own empty box
      /* a setting shown only after another answer (double_last after double points Yes) is not written as a default */
      if (s.showIf && k !== "bingo" && Object.keys(s.showIf).some(function (w) { var o = g.settings.filter(function (x) { return x.key === w; })[0]; return !o || o.def !== s.showIf[w]; })) return;
      if (s.showIf && k === "bingo" && br && !br.phones && s.showIf.ticket_kind === "phone") return;
      if (s.showIf && k === "bingo" && (!br || br.phones) && s.showIf.ticket_kind === "paper") return;
      out[s.key] = s.def;
    });
    if (k === "bingo" && br && !br.phones) { out.ticket_kind = "paper"; out.caller = br.autoDraw === false; }
    return out;
  }
  root.VPSetupHelp = { GAMES: GAMES, byKey: byKey, defaults: defaults, POPULAR: POPULAR, DEFAULT_PLAYLIST: POPULAR[0], INCLUDES: INCLUDES };
})(typeof window !== "undefined" ? window : this);
