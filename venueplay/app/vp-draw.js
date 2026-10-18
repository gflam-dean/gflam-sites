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
 *   cardWins        the claim rule, the same as the server's bingoTicketWins (a suite runs both)
 *   isRefusal, standInAllowed   when the tablet may stand in: never on a refusal, never where the
 *                   state's switch is off
 *
 * Its rules are constants here. Nothing a venue, host, HQ or the server sends can change them. Any
 * change must raise VERSION (the same string as the Worker's VP_DRAW_VERSION) and regenerate
 * tools/regulated-manifest.json in the same commit; the gate and release.py refuse anything else.
 */
(function (root) {
  "use strict";
  var VERSION = "VP-DRAW-1.0";
  /* The states where the tablet may never stand in. MUST equal the Worker's TABLET_FALLBACK_OFF_STATES
     (tools/regulated.py refuses the release if they differ). Default none: Dean keeps the fallbacks. */
  var TABLET_FALLBACK_OFF_STATES = [];

  function cryptoInt(max){ var a=new Uint32Array(1),lim=Math.floor(4294967296/max)*max,x; do{ crypto.getRandomValues(a); x=a[0]; }while(x>=lim); return x%max; }

  // the numbers a 90-ball ticket column holds: 1-9, 10-19, ... 70-79, 80-90
  function colRange(col){ if(col===0) return [1,9]; if(col===8) return [80,90]; return [col*10, col*10+9]; }

  /* ---- strips ----
     Paper bingo is sold in STRIPS of six: between them the six tickets carry all 90
     numbers exactly once, so every number called marks exactly one of your tickets.
     Dealing six independent tickets instead meant about a third of calls landed on
     none of a player's tickets and about a quarter landed on two, which is both
     unfamiliar to anyone who has played on paper and miserable on a phone, where
     you cannot see six tickets at once.

     COL_TOTAL is how many numbers each column contributes to a whole strip
     (column 0 is 1-9, column 8 is 80-90, the rest are ten each) and sums to 90. */
  var COL_TOTAL=[9,10,10,10,10,10,10,10,11];

  // 6 x 9 grid of per-ticket column counts: every entry 1-3, every ticket totals 15,
  // every column totals COL_TOTAL. That is what makes the six tickets a true strip.
  function stripCounts(){
    for(var attempt=0;attempt<600;attempt++){
      var extra=[],rowLeft=[],r,c;
      for(r=0;r<6;r++){ extra.push([0,0,0,0,0,0,0,0,0]); rowLeft.push(6); }  // 15 - 9 baseline
      var cols=[0,1,2,3,4,5,6,7,8];
      for(var i=cols.length-1;i>0;i--){ var j=cryptoInt(i+1),t=cols[i]; cols[i]=cols[j]; cols[j]=t; }
      var ok=true;
      for(var ci=0;ci<cols.length;ci++){
        c=cols[ci];
        var need=COL_TOTAL[c]-6;
        // fill from the tickets with most room left, so nothing gets stranded
        var order=[0,1,2,3,4,5].sort(function(a,b){ return rowLeft[b]-rowLeft[a] || (cryptoInt(2)?1:-1); });
        for(var oi=0;oi<order.length && need>0;oi++){
          r=order[oi];
          var take=Math.min(2-extra[r][c], rowLeft[r], need);
          if(take<=0) continue;
          extra[r][c]+=take; rowLeft[r]-=take; need-=take;
        }
        if(need>0){ ok=false; break; }
      }
      if(!ok) continue;
      var clean=true;
      for(r=0;r<6;r++) if(rowLeft[r]!==0) clean=false;
      if(!clean) continue;
      var out=[];
      for(r=0;r<6;r++){ var row=[]; for(c=0;c<9;c++) row.push(1+extra[r][c]); out.push(row); }
      return out;
    }
    return null;
  }

  // place one ticket's nine column counts into three rows holding exactly five each
  function stripRows(counts){
    for(var attempt=0;attempt<400;attempt++){
      var assign=[],tally=[0,0,0],c,i;
      for(c=0;c<9;c++){
        var pick=[0,1,2];
        for(i=pick.length-1;i>0;i--){ var j=cryptoInt(i+1),t=pick[i]; pick[i]=pick[j]; pick[j]=t; }
        pick=pick.slice(0,counts[c]).sort();
        assign.push(pick);
        for(i=0;i<pick.length;i++) tally[pick[i]]++;
      }
      if(tally[0]===5 && tally[1]===5 && tally[2]===5) return assign;
    }
    return null;
  }

  // a full strip of six tickets covering 1-90 exactly once
  function makeStrip(){
    for(var attempt=0;attempt<2000;attempt++){
      var m=stripCounts(); if(!m) continue;
      var assigns=[],t,ok=true;
      for(t=0;t<6;t++){ var a=stripRows(m[t]); if(!a){ ok=false; break; } assigns.push(a); }
      if(!ok) continue;
      var pools=[],c,i,j,tmp;
      for(c=0;c<9;c++){
        var rg=colRange(c),p=[];
        for(i=rg[0];i<=rg[1];i++) p.push(i);
        for(i=p.length-1;i>0;i--){ j=cryptoInt(i+1); tmp=p[i]; p[i]=p[j]; p[j]=tmp; }
        pools.push(p);
      }
      var tickets=[];
      for(t=0;t<6;t++) tickets.push([[0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0]]);
      for(c=0;c<9;c++){
        var at=0;
        for(t=0;t<6;t++){
          var chunk=pools[c].slice(at, at+m[t][c]).sort(function(a,b){ return a-b; });
          at+=m[t][c];
          var rows=assigns[t][c];
          for(i=0;i<rows.length;i++) tickets[t][rows[i]][c]=chunk[i];
        }
      }
      return tickets;
    }
    return null;
  }

  // A ball from the pool of numbers not yet called. Removed from the pool: never drawn twice.
  function drawFromPool(pool){
    if(!pool || !pool.length) return null;
    var k=cryptoInt(pool.length);
    return pool.splice(k,1)[0];
  }

  /* THE CLAIM RULE. card is 3 rows of 9 (blanks 0), called is { number: true } for every ball out.
     A row is complete when every number on it is called. one/two/full = at least that many complete
     rows; top/middle/bottom = that row; corners = the first and last number of the top and bottom rows. */
  function cardWins(card, called, pattern){
    if(!card) return false;
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

  /* A REFUSAL IS NOT AN OUTAGE. A 4xx (signed out 401, paused 403, finished 409) is the server saying
     no; the tablet never stands in for that. 429 means wait. */
  function isRefusal(r){ return !!r && r.status>=400 && r.status<500 && r.status!==429; }
  // May the tablet stand in at a venue in this state? Only where the switch above allows.
  function standInAllowed(state){ return TABLET_FALLBACK_OFF_STATES.indexOf(String(state||"").toUpperCase())<0; }

  root.VPDraw = Object.freeze({
    VERSION: VERSION,
    TABLET_FALLBACK_OFF_STATES: Object.freeze(TABLET_FALLBACK_OFF_STATES.slice()),
    drawFromPool: drawFromPool, makeStrip: makeStrip, cardWins: cardWins,
    isRefusal: isRefusal, standInAllowed: standInAllowed
  });
})(typeof window !== "undefined" ? window : this);
