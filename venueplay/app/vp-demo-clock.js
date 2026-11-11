/* THE SALES-PAGE DEMOS' ONE CLOCK (Dean, 7 Nov 2026: "the AC/DC question seems to be a different question on the
   phone", and the phone "seems to be lagging").

   The offer page and /see-a-night show the real TV page and the real phone page side by side, each playing its
   own ?demo=1 sample night. Until now each page ran its script on its OWN setTimeout chain, started whenever
   that frame happened to finish loading:
     - the phone waited an extra 900 ms before it even started (d(900, round) in app/trivia/play.html),
     - the wall loads supabase-js, the QR library and a dozen scripts first, the phone loads none of them, so the
       two started a different, unknown time apart on every visit,
     - and a hidden tab throttles timers, so every lap after the visitor came back drifted further.
   Nothing ever pulled them back together, so the phone could sit a whole question behind the wall.

   Now neither page keeps time. Both ask THIS file where the night is: one start time, shared, and one script of
   steps, so the wall and the phone are on the same step at the same moment, every lap, after a hidden tab, and
   on a slow phone that loads late (it joins the night where it is, not at the start).

     the start time   ?t0=<ms> on the page's address (the sales page puts the SAME number on both frames when it
                      loads them: index.html, nsw.html, see-a-night.html). Without one (a demo page opened on its
                      own), the night starts when the page loads, as it always did.
     the steps        [{ at: ms into the lap, key: true|false, fn: function(ctx){...} }], sorted by at.
                      A KEY step paints the whole screen by itself (a new question, the podium), so a page that
                      arrives late, or wakes from a hidden tab, starts from the last key step that is due and
                      plays forward from there instead of replaying every step it missed. Step 0 must be a key.
     ctx              { base: the lap's start (ms since 1970), lap: which lap }. A question's clock is
                      base + its step + 12 s on both pages, so the two rings agree to the second.

   The scripts (trivia, musical bingo, bingo, the raffle and the members draw) are below too, so the timings exist in
   one place (12 Nov 2026: bingo, the raffle and the members draw joined; until then each kept its own timers). */
(function(){
  "use strict";
  var LOADED=Date.now();
  function epoch(search){
    var m=/[?&]t0=(\d{10,16})(&|$)/.exec(search==null ? (window.location.search||"") : search);
    if(!m) return LOADED;
    var t=Number(m[1]), now=Date.now();
    // A start in the future, or one more than a week old, is a pasted link and not a sales page loading its frames.
    if(!(t>0) || t>now+5000 || now-t>7*86400000) return LOADED;
    return t;
  }
  /* Where the night is at time `now`: which lap, how far into it, and the lap's start. */
  function where(e, lap, now){
    var rel=Math.max(0, now-e), n=Math.floor(rel/lap);
    return { lap:n, p:rel-n*lap, base:e+n*lap };
  }
  /* Which steps to run now. done = how many of this lap's steps have run (-1: none, and the lap is new). Returns
     the index to start from and the index to stop before: from the last key step that is due, so nothing is
     replayed that a later key step paints over anyway. */
  function due(steps, done, p){
    var hi=done<0 ? 0 : done;
    while(hi<steps.length && steps[hi].at<=p) hi++;
    var lo=done<0 ? 0 : done;
    for(var k=hi-1;k>=lo;k--){ if(steps[k].key){ lo=k; break; } }
    return { from:lo, to:hi };
  }
  function run(o){
    var steps=o.steps.slice().sort(function(a,b){ return a.at-b.at; }), lap=o.lap, e=o.epoch!=null ? o.epoch : epoch();
    var now=o.now || function(){ return Date.now(); };
    var cur=-1, done=-1, iv=null;
    function call(s, w){ try{ s.fn({ base:w.base, lap:w.lap }); }catch(err){ try{ console.warn("[demo]", err && err.message); }catch(x){} } }
    function tick(){
      var w=where(e, lap, now());
      if(w.lap!==cur){ cur=w.lap; done=-1; }
      var d=due(steps, done, w.p), fresh=(done<0);
      /* A new lap entered part way through (a late frame, a tab back from hiding): the lap's opening steps
         marked "always" (the session, the mode) still run first, and the start-of-game show they would
         set off gives way at once, since the night is already past it. */
      if(fresh && d.from>0){
        for(var a=0;a<d.from;a++){ if(steps[a].always) call(steps[a], w); }
      }
      for(var i=d.from;i<d.to;i++) call(steps[i], w);
      if(fresh && d.from>0){ try{ if(window.VPSting && window.VPSting.stop) window.VPSting.stop("demo joined late"); }catch(err){} }
      done=Math.max(done, d.to);
      /* The next tick lands ON the next step's time, not on a 200 ms beat of this frame's own, so two frames
         fire the same step in the same instant rather than up to a beat apart. */
      clearTimeout(nt);
      var nextAt = done<steps.length ? w.base+steps[done].at : w.base+lap;
      nt=setTimeout(tick, Math.max(0, nextAt-now())+2);
    }
    var nt=null;
    /* The first step after the page's own script has finished (the venue logo and the rest of the set-up below
       the demo block), as the old setTimeout(..., 0) did: a step painted mid-load lands on a half-built wall. */
    nt=setTimeout(tick, 0);
    iv=setInterval(tick, o.every||1000);   // a safety net under the step timer: a throttled or dropped timeout is caught within a second
    /* A tab that comes back does not wait for a throttled timer: it jumps straight to where the night is. */
    try{ document.addEventListener("visibilitychange", function(){ if(!document.hidden) tick(); }); }catch(err){}
    try{ window.addEventListener("pageshow", tick); window.addEventListener("focus", tick); }catch(err){}
    return { tick:tick, stop:function(){ clearInterval(iv); }, epoch:e };
  }

  /* THE TRIVIA NIGHT. The last three questions of a round of ten. After each answer the next question; the
     scores only at the END OF THE ROUND (Dean, 7 Nov 2026: "The leaderboard running after every question is not
     good"), which on a phone night is the end of the game: the podium, then the whole leaderboard so every team
     sees where it finished. The first question waits for the start-of-game show (/app/vp-sting.js, about 4 s);
     with ?sting=0 it comes at 0.9 s. */
  var TRIVIA={
    Q:[
      { text:"Which Australian city hosted the 2000 Summer Olympics?",
        options:["Melbourne","Sydney","Brisbane","Perth"], correct:1, split:[4,31,6,2] },
      { text:"Which Australian animal can sleep for up to 22 hours a day and eats almost nothing but eucalyptus leaves?",
        options:["The common wombat","The koala","The short-beaked echidna","The red-necked wallaby"], correct:1, split:[7,26,9,1] },
      { text:"Which band released the album Back in Black?",
        options:["AC/DC","Cold Chisel","INXS","Midnight Oil"], correct:0, split:[33,5,4,1] }
    ],
    FIRST_QI:8, QTOTAL:10,   // "Question 8 of 10", 9, 10: the round's last three, so the round ends inside the loop
    SECS:20, LEFT:12,        // a 20-second question joined at 12 left, so the ring shows the time already gone
    GAP:10400,               // question to question: the answer is on screen about four seconds, then the next one
    LOCK:5200, REVEAL:6200,  // into each question: pens down, then the answer
    PODIUM_AFTER:5800,       // after the round's last answer: the podium
    BOARD_AFTER:6500,        // after the podium: the whole leaderboard, "Final scores"
    IDLE_AFTER:12000, LAP_AFTER:17000,   // after the podium: the screen rests, then the night starts again
    first:function(){ return (window.VPSting && window.VPSting.on) ? 4200 : 900; },
    qAt:function(i){ return TRIVIA.first()+i*TRIVIA.GAP; },
    podiumAt:function(){ return TRIVIA.qAt(TRIVIA.Q.length-1)+TRIVIA.REVEAL+TRIVIA.PODIUM_AFTER; },
    lap:function(){ return TRIVIA.podiumAt()+TRIVIA.LAP_AFTER; },
    endsAt:function(ctx, i){ return ctx.base+TRIVIA.qAt(i)+TRIVIA.LEFT*1000; }
  };

  /* THE MUSICAL BINGO NIGHT. Five songs, one every 5.2 s, each named 2.6 s in; a claim, the win, a rest.
     NAMED AT REVEAL ON BOTH (Dean, 12 Nov 2026: "the demo phone lags behind the demo TV"). The wall used to be sent
     reveal:false, which the wall reads as its "legacy" mode and names the song 0.85 s later on its OWN timer, while
     the phone marked it 3.6 s in: the room saw the title on the TV and the phone caught up nearly three seconds
     later, every song. Now the wall holds the title until this script's reveal (REVEAL) and the phone marks the
     song at that same moment, so the TV names it and the card marks it together. */
  var MUSICAL={
    SONGS:[{ title:"Never Gonna Give You Up", artist:"Rick Astley" }, { title:"Dancing Queen", artist:"ABBA" }, { title:"Khe Sanh", artist:"Cold Chisel" }, { title:"Mr. Brightside", artist:"The Killers" }, { title:"The Horses", artist:"Daryl Braithwaite" }],
    GAP:5200, REVEAL:2600,
    MARK:0,                  // the phone marks the song this long after the wall names it: 0, the same moment
    revealAt:function(i){ return MUSICAL.songAt(i)+MUSICAL.REVEAL; },
    WIN_AFTER:2600, IDLE_AFTER:9000, LAP_AFTER:14000,   // after the claim
    first:function(){ return (window.VPSting && window.VPSting.on) ? 4200 : 1200; },
    songAt:function(i){ return MUSICAL.first()+i*MUSICAL.GAP; },
    claimAt:function(){ return MUSICAL.songAt(MUSICAL.SONGS.length); },
    lap:function(){ return MUSICAL.claimAt()+MUSICAL.LAP_AFTER; }
  };

  /* THE BINGO NIGHT (Dean, 12 Nov 2026: "the demo TV calls different numbers from what the demo phone shows").
     tv.html and play.html each ran their own setTimeout chain: the wall's first ball at 5.4 s (after the start-of-game
     show), the phone's at 2.6 s, so the phone was a ball and a half AHEAD of the TV on every visit, and its laps were a
     different length from the wall's so it drifted further every lap. And the phone's ticket never completed, so it
     sat on "One to go!" while the wall gave the game to a "Jess" nobody saw. Now both read these balls, times and
     ticket, on this clock: the same ball on the TV and the phone at the same moment, and the phone's top line
     completes on the last ball, so the TV's claim and win are this phone's ("Ann", ticket 47).

     The ticket is a legitimate 90-ball ticket: three rows of five, each column its own decade, ascending down the
     column. Row one (7 13 31 53 88) completes on the twelfth ball, 53; rows two and three stay two short. */
  var BINGO={
    BALLS:[7,42,13,88,31,64,5,77,26,90,19,53],
    TICKET:[[7,13,null,31,null,53,null,null,88],
            [9,null,24,null,42,null,64,77,null],
            [null,19,26,38,null,56,null,null,90]],
    CARD_NO:47, PLAYER:"Ann", PRIZE:"Meat tray",   // a prize as a host types it; no dollar prize on a sales page (3 Nov 2026)
    GAP:2100, STARTED:1200,
    CLAIM_AFTER:1500, WIN_AFTER:2300, IDLE_AFTER:8100, LAP_AFTER:14000,   // after the last ball
    /* The first ball waits for the start-of-game show (2 Nov 2026): "started" at 1.2 s, the show about 4 s. */
    first:function(){ return (window.VPSting && window.VPSting.on) ? 5400 : 2600; },
    ballAt:function(i){ return BINGO.first()+i*BINGO.GAP; },
    lastBallAt:function(){ return BINGO.ballAt(BINGO.BALLS.length-1); },
    claimAt:function(){ return BINGO.lastBallAt()+BINGO.CLAIM_AFTER; },
    winAt:function(){ return BINGO.claimAt()+BINGO.WIN_AFTER; },
    idleAt:function(){ return BINGO.claimAt()+BINGO.IDLE_AFTER; },
    lap:function(){ return BINGO.lastBallAt()+BINGO.LAP_AFTER; }
  };

  /* THE DRAWS IN THE NEW LOOK (Dean, 12 Nov 2026: the raffle and members draw demos were "not the new look").
     The demo walls play the draw as a venue on the new looks sees it: the TICKET ROLL for the raffle and the FLIP
     BOARD for the members draw (/app/vp-drawstyle.js, live since 12 Nov), at the "short" draw time, each draw told
     its winner the way the host's console tells it (t:"pick" while the build-up runs). On this clock too, so the
     TV in the see-a-night room and "The big screen" over it show the same draw at the same moment.

     The raffle: three prizes of the "Friday Meat Raffle", tickets 1 to 150, one winning ticket a prize (the numbers
     the see-a-night host console shows: 087, 042, 131). The members draw: John S. (142) is drawn and is not there,
     so the jackpot rolls over and grows ($1,240 to $1,320), then K. Whitely (206) is drawn and claims it. */
  var DRAW_SECS=6, INTRO_MS=1200;   // VPDrawStyle.secs("short") and VPDrawStyle.INTRO: the build-up is 7.2 s
  var RAFFLE={
    NAME:"Friday Meat Raffle", MIN:1, MAX:150, PAD:3, DRAW_SECS:DRAW_SECS,
    DRAWS:[{ ticket:87, prize:"Meat tray" }, { ticket:42, prize:"Seafood platter" }, { ticket:131, prize:"Bottle of red" }],
    EVERY:16000, PICK_AFTER:1200, WIN_AFTER:INTRO_MS+DRAW_SECS*1000, CLAIM_AFTER:12500, CLAIM_SECS:30,
    /* The first draw waits for the "IT'S RAFFLE TIME" show the wall plays when the console opens (vp-sting.js forDraw). */
    first:function(){ return (window.VPSting && window.VPSting.on) ? 4400 : 400; },
    drawAt:function(i){ return RAFFLE.first()+i*RAFFLE.EVERY; },
    lap:function(){ return RAFFLE.drawAt(RAFFLE.DRAWS.length-1)+RAFFLE.CLAIM_AFTER+7500; }
  };
  var MEMBERS={
    NAME:"Friday Members Jackpot", MIN:1, MAX:380, DRAW_SECS:DRAW_SECS, CLAIM_SECS:180,
    START_CENTS:124000, GROW_CENTS:8000, RESET_CENTS:50000,
    DRAWS:[{ number:142, name:"John S.", here:false }, { number:206, name:"K. Whitely", here:true }],
    EVERY:20000, PICK_AFTER:1200, WIN_AFTER:INTRO_MS+DRAW_SECS*1000, RESULT_AFTER:13600,
    first:function(){ return (window.VPSting && window.VPSting.on) ? 4400 : 400; },   // after "MEMBERS DRAW TIME"
    drawAt:function(i){ return MEMBERS.first()+i*MEMBERS.EVERY; },
    lap:function(){ return MEMBERS.drawAt(MEMBERS.DRAWS.length-1)+MEMBERS.RESULT_AFTER+9000; }
  };

  window.VPDemoClock={ run:run, epoch:epoch, where:where, due:due, TRIVIA:TRIVIA, MUSICAL:MUSICAL, BINGO:BINGO, RAFFLE:RAFFLE, MEMBERS:MEMBERS };
})();
