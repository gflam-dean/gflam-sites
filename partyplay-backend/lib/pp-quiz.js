/* Turning a host's question-and-answer list into something a guest can tap.
 *
 * The host wrote "Where did Nicole go on her honeymoon?" and "Fiji". Typing that
 * on a phone at a party is miserable and impossible to mark fairly, so we give
 * four options instead.
 *
 * The decoys come from the OTHER answers in the same round, which costs the host
 * nothing extra and is usually funnier than anything we could invent: the wrong
 * answers to a question about Nicole are other true things about Nicole.
 *
 * A host who wants to write their own options can, and those win.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PPQuiz = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var CORRECT_POINTS = 100;

  function norm(s) { return String(s == null ? '' : s).trim().toLowerCase().replace(/\s+/g, ' '); }

  function rng(seed) {
    var a = (seed >>> 0) || 1;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function shuffle(arr, rand) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(rand() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  /* Options for question `index`. Deterministic for a given seed so the host's
     screen, the television and every phone agree on the order without having to
     send it three times and hope. */
  function options(items, index, seed) {
    var it = items[index] || {};
    var correct = String(it.a == null ? '' : it.a).trim();

    // A host's own options always win.
    if (Array.isArray(it.options) && it.options.length >= 2) {
      var own = it.options.map(function (x) { return String(x).trim(); }).filter(Boolean);
      if (own.indexOf(correct) < 0 && correct) own.push(correct);
      return { correct: correct, options: shuffle(own, rng(seed + index)), derived: false };
    }

    if (!correct) return { correct: '', options: [], derived: false };

    /* Decoys: other answers in this round, deduped against the right one, and
       against each other, so "Fiji" never appears twice as two options. */
    var pool = [], seen = {};
    seen[norm(correct)] = true;
    items.forEach(function (other, i) {
      if (i === index) return;
      var v = String(other.a == null ? '' : other.a).trim();
      if (!v || seen[norm(v)]) return;
      seen[norm(v)] = true;
      pool.push(v);
    });

    var rand = rng(seed + index);
    var picked = shuffle(pool, rand).slice(0, 3);
    // A round with fewer than four distinct answers just gets fewer buttons, which
    // is better than inventing something or showing a blank one.
    return { correct: correct, options: shuffle([correct].concat(picked), rand), derived: true };
  }

  function isRight(given, correct) { return !!correct && norm(given) === norm(correct); }

  /* Scoring. NO speed bonus, deliberately: VenuePlay gives up to 50 for answering
     fast, which is right in a pub and wrong in a lounge room where it quietly
     excludes anyone older or slower with a phone. Everyone who knows it gets 100. */
  function score(answers, items, seed) {
    var totals = {};
    (answers || []).forEach(function (a) {
      var who = a.name;
      if (!who) return;
      if (totals[who] == null) totals[who] = 0;
      var o = options(items, a.i, seed);
      if (isRight(a.answer, o.correct)) totals[who] += CORRECT_POINTS;
    });
    return Object.keys(totals)
      .map(function (n) { return { name: n, score: totals[n] }; })
      .sort(function (x, y) { return y.score - x.score || x.name.localeCompare(y.name); });
  }

  return { options: options, isRight: isRight, score: score, CORRECT_POINTS: CORRECT_POINTS };
}));
