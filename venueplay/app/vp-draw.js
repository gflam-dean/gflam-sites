/* =====================================================================
 * VP-DRAW, CONSOLE HALF: THE REGULATED BINGO CODE THAT RUNS ON THE HOST'S TABLET
 * =====================================================================
 * The server (venueplay-backend/worker/vp-draw.js) draws every ball, deals every ticket and decides
 * every claim. The tablet does any of that ONLY when the server cannot be reached, and only where
 * TABLET_FALLBACK_OFF_STATES allows. Everything the tablet then uses is in this one file:
 *
 *   cryptoInt       the scaler (the same rejection sampler as the server's randInt, and every other
 *                   copy in the site, which the gate keeps identical)
 *   drawFromPool    a ball from what is left of 1..90, one at a time, never ahead of the call
 *   makeStrip       a strip of six housie tickets holding 1..90 once
 *   cardWins        the claim rule, the same as the server's bingoTicketWins (a suite runs both),
 *                   including a venue's own custom pattern (ruleClean reads one; VP-DRAW-1.2)
 *   isRefusal, standInAllowed   when the tablet may stand in: never on a refusal, never where the
 *                   state's switch is off
 *
 * Its rules are constants here. Nothing a venue, host, HQ or the server sends can change them. Any
 * change must raise VERSION (the same string as the Worker's VP_DRAW_VERSION) and regenerate
 * tools/regulated-manifest.json in the same commit; the gate and release.py refuse anything else.
 */
(function (root) {
  "use strict";
  var VERSION = "VP-DRAW-1.3";
  /* The states where the tablet may never stand in. MUST equal the Worker's TABLET_FALLBACK_OFF_STATES
     (tools/regulated.py refuses the release if they differ). Default none: Dean keeps the fallbacks. */
  var TABLET_FALLBACK_OFF_STATES = [];

  function cryptoInt(max){ var a=new Uint32Array(1),lim=Math.floor(4294967296/max)*max,x; do{ crypto.getRandomValues(a); x=a[0]; }while(x>=lim); return x%max; }

  // ---- VP-STRIP BEGIN: the one strip algorithm, the same text in both halves of VP-DRAW (tools/regulated.py refuses a difference) ----
  /* A STRIP of six 90-ball tickets that between them hold 1..90 exactly once, the way paper housie is sold.
     rnd(n) is the half's own uniform integer in [0, n): randInt on the server, cryptoInt on the tablet,
     the same rejection sampler over crypto.getRandomValues. Every strip is checked before it is returned
     (stripIsValid); one that is not is thrown away and another made. Returns six tickets of 27 values,
     row-major, blanks 0, or null if 200 tries all failed (never seen). */
  function stripColRange(c){ return c === 0 ? [1, 9] : (c === 8 ? [80, 90] : [c * 10, c * 10 + 9]); }
  function stripColCounts(rnd){
    var TOTAL = [9, 10, 10, 10, 10, 10, 10, 10, 11];   // numbers per column across a strip: sums to 90
    for (var attempt = 0; attempt < 600; attempt++) {
      var extra = [], rowLeft = [], r, c, i, ok = true;
      for (r = 0; r < 6; r++) { extra.push([0, 0, 0, 0, 0, 0, 0, 0, 0]); rowLeft.push(6); }   // 15 - the 9 every ticket starts with
      var cols = [0, 1, 2, 3, 4, 5, 6, 7, 8];
      for (i = cols.length - 1; i > 0; i--) { var j = rnd(i + 1), t = cols[i]; cols[i] = cols[j]; cols[j] = t; }
      for (var ci = 0; ci < 9 && ok; ci++) {
        c = cols[ci];
        var need = TOTAL[c] - 6, keys = [];
        for (r = 0; r < 6; r++) keys.push({ r: r, k: rnd(1000000) });
        // fill from the tickets with most room left, so nothing gets stranded; ties broken at random
        keys.sort(function (a, b) { return (rowLeft[b.r] - rowLeft[a.r]) || (a.k - b.k); });
        for (i = 0; i < 6 && need > 0; i++) {
          r = keys[i].r;
          var take = Math.min(2 - extra[r][c], rowLeft[r], need);
          if (take <= 0) continue;
          extra[r][c] += take; rowLeft[r] -= take; need -= take;
        }
        if (need > 0) ok = false;
      }
      for (r = 0; r < 6 && ok; r++) { if (rowLeft[r] !== 0) ok = false; }
      if (!ok) continue;
      var out = [];
      for (r = 0; r < 6; r++) { var row = []; for (c = 0; c < 9; c++) row.push(1 + extra[r][c]); out.push(row); }
      return out;
    }
    return null;
  }
  function stripTicketRows(rnd, counts){
    for (var attempt = 0; attempt < 400; attempt++) {
      var assign = [], tally = [0, 0, 0], c, i;
      for (c = 0; c < 9; c++) {
        var pick = [0, 1, 2];
        for (i = pick.length - 1; i > 0; i--) { var j = rnd(i + 1), t = pick[i]; pick[i] = pick[j]; pick[j] = t; }
        var rows = pick.slice(0, counts[c]).sort(function (a, b) { return a - b; });
        assign.push(rows);
        for (i = 0; i < rows.length; i++) tally[rows[i]]++;
      }
      if (tally[0] === 5 && tally[1] === 5 && tally[2] === 5) return assign;
    }
    return null;
  }
  // A valid 90-ball ticket: 27 cells, 5 numbers a row, 1 to 3 a column, each in its column's range,
  // ascending down the column, no repeats.
  function ticketIsValid(cells){
    if (!cells || cells.length !== 27) return false;
    var seen = {}, r, c;
    for (r = 0; r < 3; r++) { var n = 0; for (c = 0; c < 9; c++) { if (cells[r * 9 + c]) n++; } if (n !== 5) return false; }
    for (c = 0; c < 9; c++) {
      var rg = stripColRange(c), last = 0, k = 0;
      for (r = 0; r < 3; r++) {
        var v = cells[r * 9 + c];
        if (!v) continue;
        if (v !== Math.floor(v) || v < rg[0] || v > rg[1] || v <= last || seen[v]) return false;
        seen[v] = true; last = v; k++;
      }
      if (k < 1 || k > 3) return false;
    }
    return true;
  }
  function stripIsValid(tickets){
    if (!tickets || tickets.length !== 6) return false;
    var seen = {}, n = 0;
    for (var t = 0; t < 6; t++) {
      if (!ticketIsValid(tickets[t])) return false;
      for (var i = 0; i < 27; i++) { var v = tickets[t][i]; if (v) { if (seen[v]) return false; seen[v] = true; n++; } }
    }
    return n === 90;
  }
  function stripOfSix(rnd){
    for (var attempt = 0; attempt < 200; attempt++) {
      var m = stripColCounts(rnd); if (!m) continue;
      var assigns = [], t, c, i, ok = true;
      for (t = 0; t < 6 && ok; t++) { var a = stripTicketRows(rnd, m[t]); if (!a) ok = false; else assigns.push(a); }
      if (!ok) continue;
      var tickets = [];
      for (t = 0; t < 6; t++) { var cells = []; for (i = 0; i < 27; i++) cells.push(0); tickets.push(cells); }
      for (c = 0; c < 9; c++) {
        var rg = stripColRange(c), pool = [];
        for (i = rg[0]; i <= rg[1]; i++) pool.push(i);
        for (i = pool.length - 1; i > 0; i--) { var j = rnd(i + 1), x = pool[i]; pool[i] = pool[j]; pool[j] = x; }
        var at = 0;
        for (t = 0; t < 6; t++) {
          var chunk = pool.slice(at, at + m[t][c]).sort(function (p, q) { return p - q; });
          at += m[t][c];
          for (i = 0; i < assigns[t][c].length; i++) tickets[t][assigns[t][c][i] * 9 + c] = chunk[i];
        }
      }
      if (stripIsValid(tickets)) return tickets;
    }
    return null;
  }
  // ---- VP-STRIP END ----

  // The tablet's strip: the same algorithm as the server's, with the tablet's sampler, checked, as 3 rows of 9.
  function makeStrip(){
    var s = stripOfSix(cryptoInt);
    if (!s) return null;
    return s.map(function (c) { return [c.slice(0, 9), c.slice(9, 18), c.slice(18, 27)]; });
  }

  // A ball from the pool of numbers not yet called. Removed from the pool: never drawn twice.
  function drawFromPool(pool){
    if(!pool || !pool.length) return null;
    var k=cryptoInt(pool.length);
    return pool.splice(k,1)[0];
  }

  /* THE CLAIM RULE. card is 3 rows of 9 (blanks 0), called is { number: true } for every ball out.
     A row is complete when every number on it is called. one/two/full = at least that many complete
     rows; top/middle/bottom = that row; corners = the first and last number of the top and bottom rows;
     custom = the venue's saved rule, passed as `rule` (see ruleClean). */
  function cardWins(card, called, pattern, rule){
    if(!card) return false;
    if(pattern==="custom") return customWins(card, called, rule);
    function isCalled(n){ return !!called[n]; }
    function rowComplete(row){ for(var c=0;c<9;c++){ var v=card[row][c]; if(v && !isCalled(v)) return false; } return true; }
    function completeRows(){ var n=0; for(var r=0;r<3;r++){ if(rowComplete(r)) n++; } return n; }
    function cornerNums(){
      var out=[]; [0,2].forEach(function(r){ var row=card[r], first=0, last=0;
        for(var c=0;c<9;c++){ if(row[c]){ if(!first) first=row[c]; last=row[c]; } }
        if(first) out.push(first); if(last && last!==first) out.push(last); });
      return out;
    }
    switch(pattern){
      case "one": return completeRows()>=1;
      case "two": return completeRows()>=2;
      case "full": return completeRows()>=3;
      case "top": return rowComplete(0);
      case "middle": return rowComplete(1);
      case "bottom": return rowComplete(2);
      case "corners": var cn=cornerNums(); if(!cn.length) return false; for(var i=0;i<cn.length;i++){ if(!isCalled(cn[i])) return false; } return true;
    }
    return false;
  }

  /* A VENUE'S OWN PATTERN (VP-DRAW-1.2), the server's bingoRuleClean and customTicketWins in the tablet's
     words. {type:"any", n}: at least n of the ticket's numbers called (n 1 to 15). {type:"shape", cells}:
     every NUMBER in the chosen squares (row-major 0..26) called; a chosen square that is blank on this
     ticket counts as done, and a ticket with no number in the shape never wins. Anything else: null. */
  function ruleClean(rule){
    if(!rule || typeof rule!=="object") return null;
    if(rule.type==="any"){ var n=Number(rule.n); return (n===Math.floor(n) && n>=1 && n<=15) ? { type:"any", n:n } : null; }
    if(rule.type==="shape"){
      if(!Array.isArray(rule.cells) || !rule.cells.length || rule.cells.length>27) return null;
      var seen={}, out=[];
      for(var k=0;k<rule.cells.length;k++){ var i=Number(rule.cells[k]); if(i!==Math.floor(i) || i<0 || i>26) return null; if(!seen[i]){ seen[i]=true; out.push(i); } }
      out.sort(function(a,b){ return a-b; });
      return { type:"shape", cells:out };
    }
    return null;
  }
  function customWins(card, called, rule){
    var r=ruleClean(rule); if(!r) return false;
    function at(i){ return card[Math.floor(i/9)][i%9]; }
    var i, n=0;
    if(r.type==="any"){ for(i=0;i<27;i++){ if(at(i) && called[at(i)]) n++; } return n>=r.n; }
    for(var k=0;k<r.cells.length;k++){ var v=at(r.cells[k]); if(!v) continue; n++; if(!called[v]) return false; }
    return n>0;
  }

  /* A REFUSAL IS NOT AN OUTAGE. A 4xx (signed out 401, paused 403, finished 409) is the server saying
     no; the tablet never stands in for that. 429 means wait. */
  function isRefusal(r){ return !!r && r.status>=400 && r.status<500 && r.status!==429; }
  // May the tablet stand in at a venue in this state? Only where the switch above allows.
  function standInAllowed(state){ return TABLET_FALLBACK_OFF_STATES.indexOf(String(state||"").toUpperCase())<0; }

  root.VPDraw = Object.freeze({
    VERSION: VERSION,
    TABLET_FALLBACK_OFF_STATES: Object.freeze(TABLET_FALLBACK_OFF_STATES.slice()),
    drawFromPool: drawFromPool, makeStrip: makeStrip, cardWins: cardWins, ruleClean: ruleClean,
    isRefusal: isRefusal, standInAllowed: standInAllowed
  });
})(typeof window !== "undefined" ? window : this);
