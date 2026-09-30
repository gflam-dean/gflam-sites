/* PUNTERS RECKON: the host console's referee. Pure logic, no page, so it can be run by a test.

   How a board plays in a room of phones (decided 29 Sep 2026):
     - the host puts up a board: the question, and how many answers are hidden (never the answers)
     - every phone gets GUESSES_PER_BOARD guesses, typed, until the clock runs out
     - a guess that matches an answer scores that answer's points for that player, once per answer
     - the first time anyone finds an answer it flips on the TV, with who found it
     - at the end of the board the rest turn over, greyed, and the leaderboard goes up
   Nothing here is money or gaming: it is a quiz, scored like trivia. Players count for billing the
   way every game does (the phone calls /player/alive), and a night of this is NOT the weekly trivia
   night (Dean, 29 Sep 2026).

   Needs TAMatch (ta-match.js). Boards come from TABoards (ta-boards.js). ES5.

   ONE ENGINE, TWO PRODUCTS. PartyPlay runs this same file as its own game (a byte-for-byte copy in
   partyplay/lib, checked by partyplay-backend/lib/pp-great-minds.test.js) with family boards and its own name. */
(function (root) {
  "use strict";
  var NAME = "Punters Reckon";          // the one place the name lives; Dean may still change it
  var GUESSES_PER_BOARD = 3;
  var DEFAULT_SECS = 45;

  function Game(opts) {
    opts = opts || {};
    this.name = opts.name || NAME;   // PartyPlay plays the same game under its own name
    this.match = opts.match || (root.TAMatch && root.TAMatch.match);
    this.boards = opts.boards || root.TABoards || [];
    this.now = opts.now || function () { return Date.now(); };
    this.pick = opts.pick || function (n) {           // unbiased pick; the host console passes crypto
      var a = new Uint32Array(1), lim = Math.floor(4294967296 / n) * n, x;
      do { root.crypto.getRandomValues(a); x = a[0]; } while (x >= lim);
      return x % n;
    };
    this.used = {};          // board ids already played tonight
    this.scores = {};        // pid -> { name, pts }
    this.round = 0;
    this.board = null;       // the board in play, WITH answers: this object never leaves the console
    this.found = {};         // answer index -> name of the first finder
    this.guesses = {};       // pid -> { left, got: {answerIndex: true} }
    this.endsAt = 0;
  }

  /* The next board, never one already played tonight while any are left. Returns the PUBLIC
     message for the TV and phones: the question and a count, and nothing that gives an answer away. */
  Game.prototype.nextBoard = function (secs) {
    var fresh = this.boards.filter(function (b) { return !this.used[b.id]; }, this);
    if (!fresh.length) { this.used = {}; fresh = this.boards.slice(); }
    if (!fresh.length) return null;
    var b = fresh[this.pick(fresh.length)];
    this.used[b.id] = true;
    this.round += 1; this.board = b; this.found = {}; this.guesses = {};
    var s = (secs > 0 && secs <= 300) ? secs : DEFAULT_SECS;
    this.endsAt = this.now() + s * 1000;
    return { t: "ta_board", round: this.round, q: b.q, n: b.answers.length, secs: s, endsAt: this.endsAt, name: this.name };
  };

  /* One typed guess from one phone. Returns:
       { to: pid, result: {t:"pr_result", ...} for that phone only,
         reveal: {t:"ta_reveal", i, a, pts, by} for everyone, ONLY the first time an answer is found } */
  Game.prototype.guess = function (pid, name, text) {
    pid = String(pid || ""); name = String(name || "Player").slice(0, 24);
    var out = { to: pid, result: { t: "pr_result", to: pid, round: this.round, text: String(text || "").slice(0, 60) }, reveal: null };
    if (!this.board || !pid) { out.result.why = "no_board"; return out; }
    if (this.now() > this.endsAt) { out.result.why = "time"; return out; }
    var g = this.guesses[pid] || (this.guesses[pid] = { left: GUESSES_PER_BOARD, got: {} });
    if (g.left <= 0) { out.result.why = "no_guesses"; out.result.left = 0; return out; }
    var i = this.match(this.board, text);
    if (i >= 0 && g.got[i]) {                         // they already have this one: no guess used
      out.result.why = "already"; out.result.a = this.board.answers[i].a; out.result.left = g.left; return out;
    }
    g.left -= 1;
    out.result.left = g.left;
    if (i < 0) { out.result.hit = false; return out; }
    var ans = this.board.answers[i];
    g.got[i] = true;
    var s = this.scores[pid] || (this.scores[pid] = { name: name, pts: 0 });
    s.name = name; s.pts += ans.pts;
    out.result.hit = true; out.result.a = ans.a; out.result.pts = ans.pts; out.result.total = s.pts;
    if (this.found[i] === undefined) {
      this.found[i] = name;
      out.reveal = { t: "ta_reveal", i: i, a: ans.a, pts: ans.pts, by: name };
    }
    return out;
  };

  /* End the board: the answers nobody found, and the leaderboard. */
  Game.prototype.endBoard = function () {
    if (!this.board) return null;
    var b = this.board, rest = [];
    for (var i = 0; i < b.answers.length; i++) {
      if (this.found[i] === undefined) rest.push({ i: i, a: b.answers[i].a, pts: b.answers[i].pts });
    }
    this.board = null; this.endsAt = 0;
    return { showall: { t: "ta_showall", rest: rest }, leaderboard: { t: "leaderboard", title: this.name + ": after round " + this.round, rows: this.rows() } };
  };

  Game.prototype.rows = function () {
    var s = this.scores;
    return Object.keys(s).map(function (k) { return { name: s[k].name, points: s[k].pts }; })
      .sort(function (a, b) { return b.points - a.points || a.name.localeCompare(b.name); });
  };

  /* Survives a console reload, INCLUDING a board in play: a host who reloads mid-board must get the
     same board back with what was already found and how many guesses each phone has left, or the
     room loses the round (seen live at Test Alpha, 30 Sep 2026). This is saved on the host's own
     tablet only, never sent anywhere, so holding the board id here gives nothing away. */
  Game.prototype.save = function () {
    return JSON.stringify({ used: this.used, scores: this.scores, round: this.round,
      board: this.board ? this.board.id : null, found: this.found, guesses: this.guesses, endsAt: this.endsAt });
  };
  Game.prototype.load = function (json) {
    try {
      var o = JSON.parse(json || "{}"); this.used = o.used || {}; this.scores = o.scores || {}; this.round = o.round || 0;
      var b = null;
      if (o.board) { for (var k = 0; k < this.boards.length; k++) { if (this.boards[k].id === o.board) { b = this.boards[k]; break; } } }
      this.board = b; this.found = b ? (o.found || {}) : {}; this.guesses = b ? (o.guesses || {}) : {}; this.endsAt = b ? (+o.endsAt || 0) : 0;
    } catch (e) {}
  };
  /* The public messages that put a restored board back on the TV and phones: the board (no answers)
     and one reveal per answer already found. Null when no board is in play. */
  Game.prototype.replay = function () {
    if (!this.board) return null;
    var b = this.board, out = [{ t: "ta_board", round: this.round, q: b.q, n: b.answers.length,
      secs: Math.max(0, Math.ceil((this.endsAt - this.now()) / 1000)), endsAt: this.endsAt, name: this.name }];
    for (var i = 0; i < b.answers.length; i++) {
      if (this.found[i] !== undefined) out.push({ t: "ta_reveal", i: i, a: b.answers[i].a, pts: b.answers[i].pts, by: this.found[i] });
    }
    return out;
  };

  root.PRGame = { Game: Game, NAME: NAME, GUESSES_PER_BOARD: GUESSES_PER_BOARD };
}(typeof window !== "undefined" ? window : this));
