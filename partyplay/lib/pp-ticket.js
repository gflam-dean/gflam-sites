/* A 90-ball bingo ticket, built deterministically from the player's token.
 *
 * Deterministic on purpose. A phone at a party gets backgrounded, runs out of
 * battery, loses the wifi and gets reloaded, repeatedly. If the ticket lived only
 * in memory the guest would come back to a different one and lose their night; if
 * it lived on the server it would be a round trip on pub-grade wifi for something
 * we can just recompute. Same token in, same ticket out, forever.
 *
 * The real rules, because a "bingo ticket" that ignores them plays wrong:
 *   3 rows, 9 columns, 15 numbers.
 *   Exactly 5 numbers in every row.
 *   Column 1 holds 1 to 9, columns 2 to 8 hold decades, column 9 holds 80 to 90.
 *   Every column holds at least 1 and at most 3, and within a column they run
 *   down the ticket in order.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PPTicket = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function seedFrom(str) {
    var h = 2166136261;
    for (var i = 0; i < String(str).length; i++) {
      h ^= String(str).charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }
  // mulberry32: small, fast, good enough spread for a party game
  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function shuffled(arr, rand) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(rand() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function colRange(c) {
    if (c === 0) return { lo: 1,  hi: 9  };
    if (c === 8) return { lo: 80, hi: 90 };
    return { lo: c * 10, hi: c * 10 + 9 };
  }

  /* How many numbers each column gets: nine columns, fifteen numbers, every column
     at least one and at most three. Start all at one, then hand out the remaining
     six at random without letting any column pass three. */
  function columnCounts(rand) {
    var counts = [1,1,1,1,1,1,1,1,1], left = 15 - 9;
    while (left > 0) {
      var c = Math.floor(rand() * 9);
      if (counts[c] < 3) { counts[c]++; left--; }
    }
    return counts;
  }

  /* Placing them so every ROW ends up with exactly five is the fiddly half. Fill
     column by column, always choosing from the rows that are currently emptiest,
     which converges without needing to backtrack. */
  function layout(counts, rand) {
    var grid = [[null,null,null,null,null,null,null,null,null],
                [null,null,null,null,null,null,null,null,null],
                [null,null,null,null,null,null,null,null,null]];
    var rowCount = [0,0,0];
    var order = shuffled([0,1,2,3,4,5,6,7,8], rand);
    order.forEach(function (c) {
      var need = counts[c];
      var rows = [0,1,2].filter(function (r) { return rowCount[r] < 5; });
      rows.sort(function (a, b) {
        if (rowCount[a] !== rowCount[b]) return rowCount[a] - rowCount[b];
        return rand() - 0.5;
      });
      for (var i = 0; i < need && i < rows.length; i++) {
        grid[rows[i]][c] = 0;            // placeholder: a number goes here
        rowCount[rows[i]]++;
      }
    });
    return { grid: grid, rowCount: rowCount };
  }

  function build(token) {
    var rand = rng(seedFrom(token));
    var placed, tries = 0;
    do {
      placed = layout(columnCounts(rand), rand);
      tries++;
    } while (tries < 80 && !(placed.rowCount[0] === 5 && placed.rowCount[1] === 5 && placed.rowCount[2] === 5));

    var grid = placed.grid;
    for (var c = 0; c < 9; c++) {
      var r0 = colRange(c);
      var pool = [];
      for (var n = r0.lo; n <= r0.hi; n++) pool.push(n);
      var need = [0,1,2].filter(function (r) { return grid[r][c] !== null; });
      // within a column, numbers run DOWN the ticket in order
      var chosen = shuffled(pool, rand).slice(0, need.length).sort(function (a,b) { return a - b; });
      need.forEach(function (r, i) { grid[r][c] = chosen[i]; });
    }
    return grid;
  }

  function numbersOf(grid) {
    var out = [];
    grid.forEach(function (row) { row.forEach(function (v) { if (v) out.push(v); }); });
    return out;
  }

  /* How close is this ticket, given what has been called? Returns the best line
     and whether the whole ticket is done. */
  function progress(grid, called) {
    var mark = {}; (called || []).forEach(function (n) { mark[n] = true; });
    var lines = grid.map(function (row) {
      var nums = row.filter(Boolean);
      var hit = nums.filter(function (n) { return mark[n]; }).length;
      return { need: nums.length - hit, missing: nums.filter(function (n) { return !mark[n]; }) };
    });
    var best = lines.reduce(function (a, b) { return b.need < a.need ? b : a; });
    var all = numbersOf(grid);
    var allHit = all.filter(function (n) { return mark[n]; }).length;
    return {
      lines: lines,
      bestLineNeeds: best.need,
      bestLineMissing: best.missing,
      fullHouseNeeds: all.length - allHit,
      hasLine: lines.some(function (l) { return l.need === 0; }),
      fullHouse: allHit === all.length
    };
  }

  return { build: build, numbersOf: numbersOf, progress: progress, colRange: colRange };
}));
