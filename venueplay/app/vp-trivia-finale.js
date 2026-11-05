/* THE END OF A TRIVIA NIGHT, ONE TIMELINE (Dean, 5 Nov 2026, INBOX 77, 78 and 79).

   The host taps ONCE. The TV then runs the whole reveal BY ITSELF:
     Game setting "Suspense reveal at the end of the night" ON (the default):
       "And the winners are..." (the podium covered) while the host has not tapped yet,
       then 3rd place, 2nd place, "And the winner is...", the winner,
       the whole leaderboard 60 seconds after the winner, for 2 minutes, then back to the slides.
     OFF: straight to the whole leaderboard, for 2 minutes, then back to the slides.
   The last answer stays up 30 seconds first. If the host never taps, the suspense screen comes
   up by itself at 30 seconds and the reveal starts by itself 90 seconds after that.

   ONE NUMBER DRIVES IT: how long ago the reveal started ("elapsed", in ms; negative while it is
   still to come). The console sends it with every finale message and every replay, so a TV that
   reloads mid-reveal works out where the show is and lands there, and the console's preview and
   its small "comes up in 0:30" lines read the very same plan. The show only ever moves FORWARD:
   a tap, or "Show the whole leaderboard now", brings the start earlier, never later.

   Plain ES5 on purpose: older pub TVs (Tizen 5.5, webOS 5) run this. No DOM in here, so the
   suites run it as it ships. Used by app/trivia/screen.html, app/trivia/host.html and settings.html. */
(function (root) {
  "use strict";
  var MS = {
    lastAnswer: 30000,     // the last answer stays up this long before the final scores come
    cover: 90000,          // the suspense screen waits this long for the host's tap
    third: 7000,           // "In third place" is up this long
    second: 7000,          // "In second place"
    drum: 5000,            // "And the winner is..."
    boardAfterWinner: 60000,
    boardStays: 120000
  };
  // The Game settings, and what a venue that never touched them gets (both ON, item 78).
  var DEFAULTS = { end_suspense: true, round_board: true };
  function prefs(p) {
    p = (p && typeof p === "object") ? p : {};
    return {
      end_suspense: (typeof p.end_suspense === "boolean") ? p.end_suspense : DEFAULTS.end_suspense,
      round_board: (typeof p.round_board === "boolean") ? p.round_board : DEFAULTS.round_board
    };
  }

  /* Who stands on the steps. Ties share a step (two teams on 850 both stand on it), up to four
     columns so the wall never overflows; the rest are on the whole leaderboard that follows. */
  function podiumEntries(top, rows) {
    var src = (Array.isArray(rows) && rows.length >= (top || []).length) ? rows : (top || []);
    var out = [], rank = 1;
    for (var i = 0; i < src.length && out.length < 4; i++) {
      if (i > 0 && (Number(src[i].points) || 0) !== (Number(src[i - 1].points) || 0)) rank = i + 1;
      if (rank > 3) break;
      out.push({ p: src[i], rank: rank });
    }
    return out;
  }

  /* The steps of the show, each with the time it starts (ms from the start of the reveal).
     A night with only two teams has no 3rd place step; a tie for first has no 2nd place. */
  function plan(suspense, rows) {
    rows = Array.isArray(rows) ? rows : [];
    var steps = [];
    if (!suspense || !rows.length) {
      steps.push({ stage: "board", at: 0 });
      steps.push({ stage: "ads", at: MS.boardStays });
      return steps;
    }
    var ents = podiumEntries(null, rows), has = {};
    for (var i = 0; i < ents.length; i++) has[ents[i].rank] = true;
    var t = 0;
    steps.push({ stage: "cover", at: -MS.cover });
    if (has[3]) { steps.push({ stage: "third", at: t }); t += MS.third; }
    if (has[2]) { steps.push({ stage: "second", at: t }); t += MS.second; }
    steps.push({ stage: "drum", at: t }); t += MS.drum;
    steps.push({ stage: "winner", at: t });
    steps.push({ stage: "board", at: t + MS.boardAfterWinner });
    steps.push({ stage: "ads", at: t + MS.boardAfterWinner + MS.boardStays });
    return steps;
  }
  function stageStart(steps, stage) {
    for (var i = 0; i < steps.length; i++) if (steps[i].stage === stage) return steps[i].at;
    return null;
  }
  /* Where the show is at `elapsed` ms: { stage, next } where next is the ms until the following
     step (null on the last). Before the first step it is "wait": the last answer is still up. */
  function stageAt(steps, elapsed) {
    var e = Number(elapsed) || 0, cur = "wait", next = null;
    for (var i = 0; i < steps.length; i++) {
      if (e >= steps[i].at) cur = steps[i].stage;
      else { next = steps[i].at - e; break; }
    }
    return { stage: cur, next: next };
  }
  /* The moment the phones may be told how they placed: the winner on a suspense night, the
     leaderboard otherwise. A phone told "you came 2nd" before the TV says it spoils the room. */
  function phonesAt(steps) {
    var w = stageStart(steps, "winner");
    return (w === null) ? stageStart(steps, "board") : w;
  }
  /* "1:30", "0:05". For the console's small lines. */
  function clock(ms) {
    var s = Math.max(0, Math.ceil((Number(ms) || 0) / 1000));
    var m = Math.floor(s / 60), r = s % 60;
    return m + ":" + (r < 10 ? "0" : "") + r;
  }
  /* The reveal's start on the console's clock, when the last answer went up at `revealedAt`. */
  function runAtFromReveal(revealedAt, suspense) {
    return Number(revealedAt) + MS.lastAnswer + (suspense ? MS.cover : 0);
  }
  /* Moving the show: only ever forward (earlier start). */
  function forward(runAt, wanted) {
    if (typeof runAt !== "number" || !isFinite(runAt)) return wanted;
    return Math.min(runAt, wanted);
  }
  /* The TV's words over the podium, per step. */
  function title(stage, tiedFirst) {
    switch (stage) {
      case "cover": return { text: "And the winners are", dots: true };
      case "third": return { text: "In third place", dots: false };
      case "second": return { text: "In second place", dots: false };
      case "drum": return { text: tiedFirst ? "And the winners are" : "And the winner is", dots: true };
      default: return { text: "Winners", tail: "tonight", dots: false };
    }
  }
  /* Which places stand uncovered on the podium at each step. */
  function shown(stage) {
    return { cover: {}, third: { 3: 1 }, second: { 3: 1, 2: 1 }, drum: { 3: 1, 2: 1 },
             winner: { 1: 1, 2: 1, 3: 1 } }[stage] || { 1: 1, 2: 1, 3: 1 };
  }

  root.VPTriviaFinale = {
    MS: MS, DEFAULTS: DEFAULTS, prefs: prefs, podiumEntries: podiumEntries, plan: plan,
    stageAt: stageAt, stageStart: stageStart, phonesAt: phonesAt, clock: clock,
    runAtFromReveal: runAtFromReveal, forward: forward, title: title, shown: shown
  };
})(typeof window !== "undefined" ? window : this);
