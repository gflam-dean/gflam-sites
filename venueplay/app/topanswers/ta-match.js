/* TOP ANSWERS: does what a player typed count as one of the answers on the board?

   A board is { q, answers: [ { a: "Beer", pts: 38, also: ["a beer", "schooner", "pint"] }, ... ] }.
   A player types on a phone, in a pub, often after a few. So the match has to forgive what a
   phone does to people (capitals, spaces, a doubled letter, one slipped key, "a" and "the" in
   front, a plural) and must NEVER hand points to a different answer. When in doubt it says no:
   a missed match costs a team one answer, a wrong match puts false points on the board in front
   of the room, and the host cannot see why.

   Rules, in order:
     1. normalise: lower case, strip accents and punctuation, drop leading a/an/the/some/my,
        collapse spaces, and drop a trailing plural s (chips = chip, beers = beer)
     2. exact match against the answer or any of its "also" words wins outright
     3. otherwise ONE typing slip (a changed, added, missed or swapped letter) is forgiven, but
        only for words of 5 letters or more, and only if exactly ONE answer on the board is that
        close. Short words ("bar" vs "car") and ties are refused.

   Used by the host console (which decides) and by the tests. ES5, no dependencies.
   Shared with nothing else on purpose: one copy of the rule. */
(function (root) {
  "use strict";

  var LEAD = /^(a|an|the|some|my|your|our)\s+/;

  function norm(s) {
    var t = String(s == null ? "" : s).toLowerCase();
    try { t = t.normalize("NFD").replace(/[̀-ͯ]/g, ""); } catch (e) {}
    t = t.replace(/&/g, " and ").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
    var prev;
    do { prev = t; t = t.replace(LEAD, ""); } while (t !== prev);
    // one trailing plural s, not on short words (bus, gas) and not a double s (glass)
    t = t.split(" ").map(function (w) {
      return (w.length > 3 && /[^s]s$/.test(w)) ? w.slice(0, -1) : w;
    }).join(" ");
    return t;
  }

  /* Optimal string alignment distance, capped: we only ever care whether it is 0, 1 or more. */
  function slips(a, b) {
    if (a === b) return 0;
    if (Math.abs(a.length - b.length) > 1) return 2;
    var d = [], i, j;
    for (i = 0; i <= a.length; i++) { d[i] = [i]; }
    for (j = 0; j <= b.length; j++) { d[0][j] = j; }
    for (i = 1; i <= a.length; i++) {
      for (j = 1; j <= b.length; j++) {
        var cost = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
        if (i > 1 && j > 1 && a.charAt(i - 1) === b.charAt(j - 2) && a.charAt(i - 2) === b.charAt(j - 1)) {
          d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
        }
      }
    }
    return d[a.length][b.length];
  }

  function formsOf(ans) {
    var out = [norm(ans.a)];
    (ans.also || []).forEach(function (x) { var n = norm(x); if (n && out.indexOf(n) < 0) out.push(n); });
    return out;
  }

  /* Returns the index of the matching answer on the board, or -1. */
  function match(board, typed) {
    var t = norm(typed);
    if (!t || !board || !board.answers) return -1;
    var answers = board.answers, i, k, forms;
    for (i = 0; i < answers.length; i++) {
      forms = formsOf(answers[i]);
      for (k = 0; k < forms.length; k++) { if (forms[k] === t) return i; }
    }
    if (t.length < 5) return -1;
    var hit = -1;
    for (i = 0; i < answers.length; i++) {
      forms = formsOf(answers[i]);
      for (k = 0; k < forms.length; k++) {
        if (forms[k].length >= 5 && slips(forms[k], t) === 1) {
          if (hit !== -1 && hit !== i) return -1;   // two answers that close: refuse, never guess
          hit = i;
        }
      }
    }
    return hit;
  }

  root.TAMatch = { norm: norm, slips: slips, match: match };
}(typeof window !== "undefined" ? window : this));
