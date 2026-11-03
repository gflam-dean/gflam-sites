/* THE START-OF-GAME STING ON THE TV AND THE PLAYERS' PHONES (Dean, 1 Nov 2026). ON by default on every
   screen and phone again since its layout was fixed on 3 Nov 2026; ?sting=0 on a page's address switches it
   off for that one screen (a TV passes its ?sting=0 on to the game screen in its frame). History: on by
   default from the 2 Nov midday release, it played out of place live (fit() scaled el.stage, which never
   existed, so the 1920x1080 stage was never fitted to the window: LET'S PLAY sat off to the right and the
   game name was huge and clipped), so the 2 Nov evening hotfix turned it off. tools/tv-sting-in-chrome
   section 8 now measures the painted words, triangle and logo inside the window on trivia, musical bingo,
   bingo and raffle, from 1280x720 to 3840x2160 (back on from the 4 Nov 2026 release).

   One copy for every screen. A page calls VPSting.start({words, layout}) when its game starts and
   VPSting.stop("why") when its first real content arrives (a ball, a question, a song, a draw);
   bingo's TV and phone just pass every message to VPSting.onMsg. words: {l1:"LET'S PLAY", l2:"BINGO"}
   for a game, {line:"<i>IT'S</i> RAFFLE <i>TIME</i>"} for a draw (raffles and members draws are not
   games). layout: "tv" (default) or "phone" (portrait, about 2.3 s, a simple fade under
   prefers-reduced-motion).

   When the console starts a bingo game the TV plays a ~4 second show over its own lobby: the screen
   dims, the neon play triangle strikes on above centre, LET'S PLAY / BINGO slams in (Anton, the TV's
   headline face), the venueplay wordmark appears, the triangle drops into its a, vanishes, re-lights,
   and the logo flies to the top-right corner, turns solid as it lands and pulses twice. The corner
   mark is then the new logo for the rest of the night. Silent. No light flashes more than three times
   a second (one dim blink per strike).

   It never hides a called number. The console holds its first Next number for the length of the show
   (index.html, STING_HOLD_SECONDS), so the first ball lands after it. If a ball arrives anyway (a
   console with ?sting=0, a real-balls night where the host taps the grid), the show stops at once
   and the ball is shown: the room's number wins over the show, always.
   Plays at the start of a game only: never when a ball has landed in the last two minutes (a repeated
   "started" mid-game), never on a TV that joins a game already running (that hears "state").

   The logo is the 2026 logo kit's, triangle at 112%, as path data below (logo-kit-1nov, build/sting_js.py).
   window.__vpStingManual (set only by a recorder, before the page loads) swaps the clock for
   VPSting.frame(t), so a recording can step the show at exactly 25 frames a second. */
(function(){
  "use strict";
  var ON = !/[?&]sting=0(&|$)/.test(location.search || "");   // on unless ?sting=0
  var DUR = 3.95, PDUR = 2.3;
  var REDUCED = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  var REST = "M198.0 -0.0L-1.0 -489.0L185.0 -489.0L312.0 -77.0L241.0 -77.0L367.0 -489.0L551.0 -489.0L352.0 -0.0L198.0 -0.0ZM821.0 11.0Q739.0 11.0 676.0 -21.5Q613.0 -54.0 577.0 -112.0Q541.0 -170.0 541.0 -245.0Q541.0 -319.0 576.0 -376.5Q611.0 -434.0 671.5 -467.5Q732.0 -501.0 808.0 -501.0Q882.0 -501.0 939.5 -469.5Q997.0 -438.0 1029.5 -382.5Q1062.0 -327.0 1062.0 -256.0Q1062.0 -241.0 1060.5 -225.5Q1059.0 -210.0 1054.0 -190.0L623.0 -188.0L623.0 -300.0L985.0 -303.0L907.0 -254.0Q906.0 -295.0 895.0 -321.5Q884.0 -348.0 863.0 -362.0Q842.0 -376.0 810.0 -376.0Q777.0 -376.0 753.0 -360.0Q729.0 -344.0 716.0 -315.0Q703.0 -286.0 703.0 -245.0Q703.0 -203.0 717.0 -173.5Q731.0 -144.0 757.0 -129.0Q783.0 -114.0 821.0 -114.0Q857.0 -114.0 884.5 -126.0Q912.0 -138.0 934.0 -163.0L1025.0 -72.0Q989.0 -31.0 937.5 -10.0Q886.0 11.0 821.0 11.0ZM1429.0 -0.0L1429.0 -276.0Q1429.0 -310.0 1409.0 -329.5Q1389.0 -349.0 1358.0 -349.0Q1337.0 -349.0 1320.5 -340.0Q1304.0 -331.0 1295.0 -315.0Q1286.0 -299.0 1286.0 -276.0L1218.0 -308.0Q1218.0 -367.0 1244.0 -409.5Q1270.0 -452.0 1315.5 -475.5Q1361.0 -499.0 1419.0 -499.0Q1472.0 -499.0 1513.5 -474.5Q1555.0 -450.0 1579.0 -409.0Q1603.0 -368.0 1603.0 -316.0L1603.0 -0.0L1429.0 -0.0ZM1112.0 -0.0L1112.0 -489.0L1286.0 -489.0L1286.0 -0.0L1112.0 -0.0ZM1903.0 11.0Q1834.0 11.0 1780.5 -16.5Q1727.0 -44.0 1696.5 -93.5Q1666.0 -143.0 1666.0 -206.0L1666.0 -489.0L1840.0 -489.0L1840.0 -206.0Q1840.0 -186.0 1848.0 -171.0Q1856.0 -156.0 1870.0 -148.0Q1884.0 -140.0 1903.0 -140.0Q1931.0 -140.0 1948.5 -158.0Q1966.0 -176.0 1966.0 -206.0L1966.0 -489.0L2140.0 -489.0L2140.0 -206.0Q2140.0 -142.0 2110.0 -93.0Q2080.0 -44.0 2026.5 -16.5Q1973.0 11.0 1903.0 11.0ZM2460.0 11.0Q2378.0 11.0 2315.0 -21.5Q2252.0 -54.0 2216.0 -112.0Q2180.0 -170.0 2180.0 -245.0Q2180.0 -319.0 2215.0 -376.5Q2250.0 -434.0 2310.5 -467.5Q2371.0 -501.0 2447.0 -501.0Q2521.0 -501.0 2578.5 -469.5Q2636.0 -438.0 2668.5 -382.5Q2701.0 -327.0 2701.0 -256.0Q2701.0 -241.0 2699.5 -225.5Q2698.0 -210.0 2693.0 -190.0L2262.0 -188.0L2262.0 -300.0L2624.0 -303.0L2546.0 -254.0Q2545.0 -295.0 2534.0 -321.5Q2523.0 -348.0 2502.0 -362.0Q2481.0 -376.0 2449.0 -376.0Q2416.0 -376.0 2392.0 -360.0Q2368.0 -344.0 2355.0 -315.0Q2342.0 -286.0 2342.0 -245.0Q2342.0 -203.0 2356.0 -173.5Q2370.0 -144.0 2396.0 -129.0Q2422.0 -114.0 2460.0 -114.0Q2496.0 -114.0 2523.5 -126.0Q2551.0 -138.0 2573.0 -163.0L2664.0 -72.0Q2628.0 -31.0 2576.5 -10.0Q2525.0 11.0 2460.0 11.0ZM3042.0 10.0Q2995.0 10.0 2955.0 -7.0Q2915.0 -24.0 2889.0 -53.5Q2863.0 -83.0 2857.0 -122.0L2857.0 -360.0Q2863.0 -399.0 2889.5 -430.5Q2916.0 -462.0 2955.5 -480.5Q2995.0 -499.0 3042.0 -499.0Q3113.0 -499.0 3167.0 -466.5Q3221.0 -434.0 3251.5 -376.0Q3282.0 -318.0 3282.0 -244.0Q3282.0 -171.0 3251.5 -113.5Q3221.0 -56.0 3167.0 -23.0Q3113.0 10.0 3042.0 10.0ZM2751.0 207.0L2751.0 -489.0L2925.0 -489.0L2925.0 -366.0L2896.0 -248.0L2921.0 -129.0L2921.0 207.0L2751.0 207.0ZM3009.0 -145.0Q3038.0 -145.0 3060.0 -158.0Q3082.0 -171.0 3094.0 -193.5Q3106.0 -216.0 3106.0 -245.0Q3106.0 -274.0 3094.0 -296.0Q3082.0 -318.0 3060.0 -331.0Q3038.0 -344.0 3010.0 -344.0Q2983.0 -344.0 2961.0 -331.5Q2939.0 -319.0 2927.0 -296.5Q2915.0 -274.0 2915.0 -245.0Q2915.0 -216.0 2927.0 -193.5Q2939.0 -171.0 2960.5 -158.0Q2982.0 -145.0 3009.0 -145.0ZM3338.0 -0.0L3338.0 -729.0L3512.0 -729.0L3512.0 -0.0L3338.0 -0.0ZM4331.0 1.0L4135.0 -489.0L4321.0 -489.0L4441.0 -86.0L4368.0 -86.0L4489.0 -489.0L4675.0 -489.0L4474.0 1.0L4331.0 1.0ZM4215.0 207.0L4360.0 -112.0L4474.0 1.0L4390.0 207.0L4215.0 207.0Z";
  var ANEON = "M3802.0 10.0Q3734.0 10.0 3681.0 -23.0Q3628.0 -56.0 3598.0 -113.5Q3568.0 -171.0 3568.0 -244.0Q3568.0 -318.0 3598.0 -376.0Q3628.0 -434.0 3681.0 -466.5Q3734.0 -499.0 3802.0 -499.0Q3848.0 -499.0 3886.0 -482.5Q3924.0 -466.0 3948.5 -436.0Q3973.0 -406.0 3978.0 -368.0L3978.0 -122.0Q3973.0 -83.0 3948.5 -53.5Q3924.0 -24.0 3886.0 -7.0Q3848.0 10.0 3802.0 10.0ZM3721.3 -112.8C3721.3 -107.1 3724.4 -101.9 3729.3 -99.1C3734.3 -96.3 3740.4 -96.4 3745.2 -99.3L3965.9 -231.4C3970.6 -234.3 3973.6 -239.4 3973.6 -245.0C3973.6 -250.6 3970.6 -255.7 3965.9 -258.6L3745.2 -390.7C3740.4 -393.6 3734.3 -393.7 3729.3 -390.9C3724.4 -388.1 3721.3 -382.9 3721.3 -377.2L3721.3 -112.8ZM3928.0 -0.0L3928.0 -131.0L3978.0 -140.0L3978.0 -360.0L3928.0 -369.0L3928.0 -489.0L4099.0 -489.0L4099.0 -0.0L3928.0 -0.0Z";
  var clamp=function(x,a,b){ a=a==null?0:a; b=b==null?1:b; return Math.max(a,Math.min(b,x)); };
  var seg=function(t,a,b){ return clamp((t-a)/(b-a)); };
  var lerp=function(a,b,u){ return a+(b-a)*u; };
  var eio=function(u){ return u<.5?4*u*u*u:1-Math.pow(-2*u+2,3)/2; };
  var eout=function(u){ return 1-Math.pow(1-u,3); };
  var back=function(u){ var c=1.70158,c3=c+1; return 1+c3*Math.pow(u-1,3)+c*Math.pow(u-1,2); };
  function strike(t,t0){ var d=t-t0; if(d<0) return 0; if(d<0.07) return 0.55; if(d<0.17) return 0.08; return Math.min(1,0.9+(d-0.17)*1.2); }
  // the brand triangle: 112% of F4 round its centroid; local units, origin at the a's counter centre, y down
  var T=1.12, GX=(2*-85+112)/3;
  var P=[[-85,-118],[112,0],[-85,118]].map(function(p){ return [GX+(p[0]-GX)*T, p[1]*T]; });
  function side(a,b){ return Math.hypot(b[0]-a[0],b[1]-a[1]); }
  var la=side(P[1],P[2]), lb=side(P[2],P[0]), lc=side(P[0],P[1]), PER=la+lb+lc;
  var IC=[(la*P[0][0]+lb*P[1][0]+lc*P[2][0])/PER,(la*P[0][1]+lb*P[1][1]+lc*P[2][1])/PER];
  var AREA=Math.abs((P[1][0]-P[0][0])*(P[2][1]-P[0][1])-(P[2][0]-P[0][0])*(P[1][1]-P[0][1]))/2, RHO=2*AREA/PER;
  var N=P.map(function(p,i){ var q=P[(i+1)%3],dx=q[0]-p[0],dy=q[1]-p[1],l=Math.hypot(dx,dy); return [dy/l,-dx/l]; });
  function f(v){ return v.toFixed(3); }
  function off(d){
    if(d>0){ var s=""; for(var i=0;i<3;i++){ var a=P[i],b=P[(i+1)%3],n=N[i],n2=N[(i+1)%3];
      s+=(i?"L":"M")+f(a[0]+d*n[0])+" "+f(a[1]+d*n[1])+"L"+f(b[0]+d*n[0])+" "+f(b[1]+d*n[1])+"A"+f(d)+" "+f(d)+" 0 0 1 "+f(b[0]+d*n2[0])+" "+f(b[1]+d*n2[1]); }
      return s+"Z"; }
    var k=(RHO+d)/RHO; if(k<=0) return "";
    return "M"+P.map(function(p){ return f(IC[0]+(p[0]-IC[0])*k)+" "+f(IC[1]+(p[1]-IC[1])*k); }).join("L")+"Z";
  }
  var RO=15*T, SOLID=RO+RHO+0.5, HT=266*T;
  function band(o,i){ return i<=-RHO ? off(o) : off(o)+off(i); }
  var CX=3830, CY=-245, INKW=4676, INKL=-1, ASC=729;
  var K0=1300/INKW, OX0=960-(INKW/2+INKL)*K0, OY0=560+261*K0;
  var TOPX=960, TOPY=235, TOPH=210;
  var NS="http://www.w3.org/2000/svg";

  var root=null, el={}, stage={s:1,x:0,y:0}, corner=null, playing=false, t0=0, raf=0, onDone=null;
  var stats={ plays:0, cutShort:0, last:"" }, lastBall=0, drawSeen=false, seenContent=false;

  function wordSvg(w){   // the solid logo for the corner, same geometry as the kit file
    // inline size: the screens' own ".tv-corner svg" rule squeezes any svg there to the old 24px mark
    var h=w*936/4676;
    return '<svg class="vp-newmark" xmlns="'+NS+'" viewBox="-1 -729 4676 936" width="'+w.toFixed(1)+'" height="'+h.toFixed(1)+'" style="width:'+w.toFixed(1)+'px;height:'+h.toFixed(1)+'px;max-width:none;filter:drop-shadow(0 1px 2px rgba(0,0,0,.85))" aria-label="venueplay">'+
      '<path fill="#fff" d="'+REST+'"/><path fill="#fff" d="'+ANEON+'"/><path fill="#FF1F8E" transform="translate('+CX+' '+CY+')" d="'+off(RO)+'"/></svg>';
  }
  /* Measured with the show's own hiding lifted for the one read (no frame is painted in between): mid-show the
     mark is display:none, and the corner can still move under the show when the venue's logo arrives and
     VPVenueLogo.alignMark drops it to the logo's middle. The flight then lands on the moved mark, instead of
     the mark and TRIVIA jumping down 35px once the show is over (Dean, 4 Nov 2026). */
  function measureCorner(){
    var c=cornerEl(); if(!c) return null;
    var hid=c.classList.contains("vp-sting-mark"); if(hid) c.classList.remove("vp-sting-mark");
    try{ return measureMark(c); } finally{ if(hid) c.classList.add("vp-sting-mark"); }
  }
  function cornerDrop(){ var c=cornerEl(); return c ? (c.getAttribute("data-drop")||"")+"|"+(c.style.transform||"") : ""; }
  function measureMark(c){
    /* The OLD MARK, not the whole corner: the venue's name can sit on a second row of the corner and be
       wider. The new logo takes the old mark's width and right edge, and its top. */
    var sv=c.querySelector("svg:not(.vp-newmark)"), vn=c.querySelector(".vn");
    var a=sv&&sv.getBoundingClientRect(), b=vn&&vn.getBoundingClientRect();
    if(a && b && b.width){ return { right:b.right, top:a.top, width:b.right-a.left }; }   // the mark's own top: its .vn wrapper is a line box 2.8px taller (3 Nov 2026)
    /* No name beside it (a venue with a logo hides it): the mark's own box, not the corner's. The corner is
       a little taller than the mark it centres, so its top sat 2.8px above the mark and the new mark landed
       that much high (2 Nov 2026, tv-logo-centre-in-chrome). */
    if(a && a.width && a.height){ return { right:a.right, top:a.top, width:a.width }; }
    var r=c.getBoundingClientRect(); if(!r.width) return null;
    return { right:r.right, top:r.top, width:r.width };
  }
  function cornerEl(){ return document.getElementById("tvCorner") || document.querySelector(".tv-corner"); }
  function toStage(px,py){ return [(px-stage.x)/stage.s, (py-stage.y)/stage.s]; }
  function fit(){
    var W=innerWidth, H=innerHeight, s=Math.min(W/1920,H/1080);
    stage={ s:s, x:(W-1920*s)/2, y:(H-1080*s)/2 };
    if(el.vpsStage) el.vpsStage.style.transform="translate("+stage.x+"px,"+stage.y+"px) scale("+s+")";   // el keys are the element ids (build); el.stage never existed, so the 1920x1080 stage went unscaled on every other size until 3 Nov 2026
  }
  function build(){
    root=document.createElement("div"); root.id="vpSting";
    root.style.cssText="position:fixed;inset:0;z-index:2147483000;pointer-events:none;overflow:hidden";
    root.innerHTML=
      '<div id="vpsBack" style="position:absolute;inset:0;backdrop-filter:none;-webkit-backdrop-filter:none;background:rgba(5,5,6,0)"></div>'+
      '<div id="vpsStage" style="position:absolute;left:0;top:0;width:1920px;height:1080px;transform-origin:0 0">'+
        '<div id="vpsAmb" style="position:absolute;inset:0"></div>'+
        '<div class="vps-t" id="vpsL1" style="top:395px;font-size:150px;letter-spacing:.06em;color:#FF1F8E;text-shadow:0 0 30px rgba(255,31,142,.55)"><span>LET’S PLAY</span></div>'+
        '<div class="vps-t" id="vpsL2" style="top:548px;font-size:360px;letter-spacing:.015em;color:#fff;text-shadow:0 6px 40px rgba(0,0,0,.6)"><span id="vpsL2s">BINGO</span></div>'+
        '<div class="vps-t vps-sweep" id="vpsL2w" style="top:548px;font-size:360px;letter-spacing:.015em"><span id="vpsL2ws">BINGO</span></div>'+
        '<div class="vps-t" id="vpsL3" style="top:430px;font-size:330px;letter-spacing:.015em;color:#fff;text-shadow:0 6px 40px rgba(0,0,0,.6)"><span id="vpsL3s"></span></div>'+
        '<div class="vps-t vps-sweep" id="vpsL3w" style="top:430px;font-size:330px;letter-spacing:.015em"><span id="vpsL3ws"></span></div>'+
        '<svg id="vpsWord" viewBox="0 0 1920 1080" style="position:absolute;left:0;top:0;width:1920px;height:1080px;overflow:visible"><g id="vpsWg"><path fill="#fff" d="'+REST+'"/><path fill="#fff" d="'+ANEON+'"/></g></svg>'+
        '<svg viewBox="0 0 1920 1080" style="position:absolute;left:0;top:0;width:1920px;height:1080px;overflow:visible"><path id="vpsGh3" fill="#FF1F8E" fill-rule="evenodd" opacity="0"/><path id="vpsGh2" fill="#FF1F8E" fill-rule="evenodd" opacity="0"/><path id="vpsGh1" fill="#FF1F8E" fill-rule="evenodd" opacity="0"/></svg>'+
        '<svg id="vpsTri" viewBox="0 0 1920 1080" style="position:absolute;left:0;top:0;width:1920px;height:1080px;overflow:visible"><g id="vpsTg"><path id="vpsBand" fill="#FF1F8E" fill-rule="evenodd"/><path id="vpsCore" fill="#FFD6EA" fill-rule="evenodd"/></g></svg>'+
      '</div>';
    var st=document.createElement("style"); st.id="vpStingCss";
    st.textContent=".vps-t{position:absolute;left:0;width:1920px;display:flex;justify-content:center;font-family:Anton,Impact,sans-serif;font-weight:400;white-space:nowrap;line-height:1;transform-origin:960px 50%;opacity:0}"+
      ".vps-t i{font-style:normal;color:#FF1F8E;text-shadow:0 0 30px rgba(255,31,142,.55)}.vps-sweep i{color:transparent!important;text-shadow:none!important}.vps-sweep{color:transparent!important;text-shadow:none!important}.vps-sweep span{background:linear-gradient(100deg,rgba(255,255,255,0) 40%,rgba(255,214,234,.85) 50%,rgba(255,255,255,0) 60%);background-size:250% 100%;-webkit-background-clip:text;background-clip:text;color:transparent}"+
      ".vp-sting-mark>svg:not(.vp-newmark),.vp-sting-mark>.vn:not(.vp-keepline){display:none!important}.vp-sting-mark>.vn.vp-keepline>svg:not(.vp-newmark){display:none!important}.vp-sting-mark>.vp-newmark{display:block}.vp-sting-mark>.vn.vp-keepline>.vp-newmark{display:inline-block;vertical-align:middle}";
    document.head.appendChild(st);
    document.body.appendChild(root);
    ["vpsBack","vpsStage","vpsAmb","vpsL1","vpsL2","vpsL2s","vpsL2w","vpsL2ws","vpsL3","vpsL3s","vpsL3w","vpsL3ws","vpsWord","vpsWg","vpsTri","vpsTg","vpsBand","vpsCore","vpsGh1","vpsGh2","vpsGh3"].forEach(function(i){ el[i]=document.getElementById(i); });
    for(var i=1;i<=3;i++) el["vpsGh"+i].setAttribute("d",band(RO,RO-28*T));
    fit();
  }
  var L2S=1, WORDS={l1:"LET\u2019S PLAY", l2:"BINGO"};
  function render(t){
    if(LAYOUT==="phone") return renderPhone(t);
    var dim=eout(seg(t,0,0.22))*(1-eio(seg(t,2.65,3.10)));
    el.vpsBack.style.backdropFilter=el.vpsBack.style.webkitBackdropFilter=dim>0.002?"blur("+(20*dim*stage.s).toFixed(2)+"px) brightness("+(1-0.84*dim).toFixed(3)+")":"none";
    var out=eio(seg(t,1.02,1.18)), sh=(t>0.50&&t<0.60)?Math.sin(t*210)*6*(0.60-t)/0.1:0;
    function slam(e,a,s0,sc){ e.style.opacity=clamp(a*3)*(1-out); e.style.transform="translate("+f(sh)+"px,"+f(sh*0.5)+"px) scale("+(sc*lerp(s0,1,back(a))*(1-0.08*out))+")"; }
    if(WORDS.line){ slam(el.vpsL3,seg(t,0.34,0.52),1.7,L2S); slam(el.vpsL3w,seg(t,0.34,0.52),1.7,L2S); }
    else { slam(el.vpsL1,seg(t,0.28,0.44),1.45,1); slam(el.vpsL2,seg(t,0.40,0.56),1.7,L2S); slam(el.vpsL2w,seg(t,0.40,0.56),1.7,L2S); }
    var sw=seg(t,WORDS.line?0.66:0.62,WORDS.line?1.00:0.96), swv=(-60+220*eio(sw)).toFixed(1)+"% 0";
    el.vpsL2ws.style.backgroundPosition=swv; el.vpsL3ws.style.backgroundPosition=swv;
    if(sw<=0||sw>=1){ el.vpsL2w.style.opacity=0; el.vpsL3w.style.opacity=0; }
    // the wordmark centre stage, then to the corner by its right and top edges
    if(cornerDrop()!==corner.drop) aimCorner();   // the corner moved under the show (its venue logo arrived): land where it is now
    var j=eio(seg(t,2.55,3.10)), KC=corner.w/INKW;
    var kw=Math.exp(lerp(Math.log(K0),Math.log(KC),j));
    var right=lerp(OX0+(INKW+INKL)*K0,corner.r,j), top=lerp(OY0-ASC*K0,corner.t,j);
    var ox=right-(INKW+INKL)*kw, oy=top+ASC*kw, wf=eout(seg(t,1.20,1.42));
    el.vpsWord.style.opacity=wf; el.vpsWg.setAttribute("transform","translate("+f(ox)+" "+f(oy+lerp(16,0,wf))+") scale("+kw.toFixed(6)+")");
    var FX=ox+CX*kw, FY=oy+CY*kw, p0=TOPH/(HT*K0), overY=OY0-729*K0-20-0.5*HT*K0*1.25;
    function triAt(t){ var p,x,y,lit;
      if(t<1.86){ lit=strike(t,0.06); var g=eio(seg(t,1.30,1.55)), d=seg(t,1.55,1.78), v=seg(t,1.78,1.86);
        p=lerp(p0,1.25,g); x=lerp(TOPX,FX,g); y=lerp(TOPY,overY,g);
        if(d>0){ p=lerp(1.25,1,eio(d)); y=lerp(overY,FY,d*d); }
        if(v>0){ p=lerp(1,0,v*v*(3-2*v)); y=FY; } }
      else { p=t<2.02?0:1; x=FX; y=FY; lit=strike(t,2.02); }
      return [p,x,y,lit]; }
    var tr=triAt(t), p=tr[0], x=tr[1], y=tr[2], lit=tr[3], k=kw*p;
    for(var i=1;i<=3;i++){ var gh=el["vpsGh"+i], tt=t-0.03*i, on=t>1.32&&t<1.80&&tt>1.30;
      if(!on){ gh.setAttribute("opacity",0); continue; }
      var q=triAt(tt); gh.setAttribute("opacity",(0.30-0.08*i).toFixed(3)); gh.setAttribute("transform","translate("+f(q[1])+" "+f(q[2])+") scale("+Math.max(kw*q[0],1e-6).toFixed(6)+")"); }
    el.vpsTri.style.opacity=p<=0.002?0:1;
    el.vpsTg.setAttribute("transform","translate("+f(x)+" "+f(y)+") scale("+Math.max(k,1e-6).toFixed(6)+")");
    var fill=eio(seg(t,3.00,3.25)), tube=lerp(28*T,SOLID,fill), coreA=clamp((lit-0.3)/0.6)*(1-eio(seg(t,2.95,3.15)));
    el.vpsBand.setAttribute("d",band(RO,RO-tube)); el.vpsBand.setAttribute("fill",lit<0.3?"#5a1438":"#FF1F8E"); el.vpsBand.setAttribute("opacity",lit<0.3?0.25+lit*2.5:1);
    el.vpsCore.setAttribute("d",coreA>0.002?band(4.64*T,-2.64*T):""); el.vpsCore.setAttribute("opacity",coreA);
    var relight=t>2.02?Math.sin(Math.PI*seg(t,2.07,2.40))*0.5:0, beat=function(u){ return Math.pow(Math.sin(Math.PI*u),2); };
    var beats=(beat(seg(t,3.25,3.60))+beat(seg(t,3.60,3.95)))*0.9, base=clamp(lit)*(1-fill), gl=base+relight+beats;
    var r1=Math.max(10*k*(1+relight),lerp(0.7,1.2,fill)*j*(1+beats*0.6)), r2=Math.max(30*k*(1+relight),lerp(1.9,4.5,fill)*j*(1+beats*0.8));
    el.vpsTri.style.filter=gl>0.003?"drop-shadow(0 0 "+r1.toFixed(2)+"px rgba(255,31,142,"+(0.95*Math.min(1,gl)).toFixed(3)+")) drop-shadow(0 0 "+r2.toFixed(2)+"px rgba(255,31,142,"+(0.55*Math.min(1.3,gl)).toFixed(3)+"))":"none";
    var bloom=function(t0,a){ return t>t0?a*Math.exp(-(t-t0)*7):0; }, bl=bloom(0.23,0.22)+bloom(2.19,0.12);
    el.vpsAmb.style.background="radial-gradient(circle at "+f(x)+"px "+f(y)+"px, rgba(255,31,142,"+(0.10*clamp(lit)*(1-j)*Math.min(p,3)/3+0.05*relight+bl).toFixed(3)+") 0, rgba(255,31,142,0) "+f(lerp(380,60,j)*(1+bl*2))+"px)";
  }
  /* THE PHONE IS PERSONAL (Dean, 1 Nov 2026): "LET'S PLAY, SAM!" big, the format small under it; a team
     name in team trivia; "GOOD LUCK, SAM!" for a draw. No name, the plain words. The name is the one the
     phone joined with, cleaned here and only ever set as TEXT (textContent), never as HTML. Emoji stay
     (the phone's own emoji font draws them inside Anton text); control and zero-width characters go. */
  function cleanName(n){
    n=String(n==null?"":n).replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g,"").replace(/\s+/g," ").trim();
    var cp=Array.from ? Array.from(n) : n.split("");
    if(cp.length>16) n=cp.slice(0,15).join("").replace(/\s+$/,"")+"\u2026";
    return n.toUpperCase();
  }
  function phoneWords(fmt, name, draw){
    var nm=cleanName(name), F=String(fmt||"BINGO").toUpperCase();
    if(nm) return { big:(draw?"GOOD LUCK, ":"LET\u2019S PLAY, ")+nm+"!", small:F };
    return draw ? { big:"GOOD LUCK!", small:F } : { l1:"LET\u2019S PLAY", l2:F };
  }
  /* ---------------- THE PHONE: portrait, small, light ---------------- */
  function buildPhone(){
    root=document.createElement("div"); root.id="vpSting";
    root.style.cssText="position:fixed;inset:0;z-index:2147483000;pointer-events:none;overflow:hidden;background:rgba(5,5,6,0)";
    var W=innerWidth, H=innerHeight;
    root.innerHTML=
      '<div class="vpp-t" id="vppL1" style="top:'+(H*0.40).toFixed(0)+'px;font-size:'+(W*0.10).toFixed(1)+'px;letter-spacing:.06em;color:#FF1F8E;text-shadow:0 0 14px rgba(255,31,142,.55)"></div>'+
      '<div class="vpp-t" id="vppL2" style="top:'+(H*0.465).toFixed(0)+'px;font-size:'+(W*0.24).toFixed(1)+'px;letter-spacing:.015em;color:#fff"><span id="vppL2s"></span></div>'+
      '<svg id="vppSvg" viewBox="0 0 '+W+' '+H+'" style="position:absolute;inset:0;width:100%;height:100%;overflow:visible">'+
        '<g id="vppWg" opacity="0"><path fill="#fff" d="'+REST+'"/><path fill="#fff" d="'+ANEON+'"/></g>'+
        '<g id="vppTg"><path id="vppBand" fill="#FF1F8E" fill-rule="evenodd"/><path id="vppCore" fill="#FFD6EA" fill-rule="evenodd"/></g></svg>';
    var st=document.createElement("style"); st.id="vpStingCss";
    st.textContent=".vpp-t{position:absolute;left:0;right:0;display:flex;justify-content:center;font-family:Anton,Impact,sans-serif;font-weight:400;white-space:nowrap;line-height:1;opacity:0}.vpp-t i{font-style:normal;color:#FF1F8E}";
    document.head.appendChild(st); document.body.appendChild(root);
    ["vppL1","vppL2","vppL2s","vppSvg","vppWg","vppTg","vppBand","vppCore"].forEach(function(i){ el[i]=document.getElementById(i); });
    L1S=1;
    if(WORDS.big){   // personal: the name line big and white, the format small and pink under it
      el.vppL1.innerHTML='<span id="vppL1s"></span>'; el.vppL1s=document.getElementById("vppL1s"); el.vppL1s.textContent=WORDS.big;
      el.vppL1.style.cssText+=";top:"+(H*0.42).toFixed(0)+"px;font-size:"+(W*0.135).toFixed(1)+"px;color:#fff;letter-spacing:.01em;text-shadow:0 4px 20px rgba(0,0,0,.6)";
      el.vppL2s.textContent=WORDS.small;
      el.vppL2.style.cssText+=";top:"+(H*0.42+W*0.17).toFixed(0)+"px;font-size:"+(W*0.085).toFixed(1)+"px;color:#FF1F8E;letter-spacing:.08em;text-shadow:0 0 14px rgba(255,31,142,.55)";
      L1S=Math.min(1,W*0.90/(el.vppL1s.offsetWidth||1));
    }
    else { el.vppL1.textContent=WORDS.l1; el.vppL2s.textContent=WORDS.l2; }
    var sw=el.vppL2s.offsetWidth||1; L2S=Math.min(1,W*0.88/sw);
    PH={ W:W, H:H, kw:W*0.62/INKW, tx:W/2, ty:H*0.27, th:Math.min(W*0.30,H*0.17) };
    PH.ox=W/2-(INKW/2+INKL)*PH.kw; PH.oy=H*0.56+261*PH.kw;
    el.vppWg.setAttribute("transform","translate("+f(PH.ox)+" "+f(PH.oy)+") scale("+PH.kw.toFixed(6)+")");
    /* WHERE IT LANDS (Dean, 2 Nov 2026: "land where the logo actually sits", as the TV's flies to its corner).
       The page's own header wordmark, measured where it is painted, never a hard-coded spot. If the page
       has none on screen, the show ends as it always did, with a fade. Under reduced motion: the fade. */
    PH.head = REDUCED ? null : headMark();
    if(PH.head && !landing()) PH.head=null;
    PH.land=!!PH.head;
    if(PH.head){ PH.headVis=PH.head.style.visibility; PH.head.style.visibility="hidden"; PH.hid=true; }   // ours stands in for it until the hand-over
  }
  var PH=null, L1S=1, PFLY0=1.95, PFLY1=2.50, PHAND=2.55, PLAND=2.75;
  function headMark(){ return document.querySelector('.brand svg[data-vp-mark="wordmark"]') || document.querySelector("svg.vp-wm"); }
  /* The header mark's own box mapped into the show's units: the same viewBox (-1 -729 4676 936), drawn
     xMidYMid meet, so the landing is exact rather than eyeballed. Measured every frame of the flight, so a
     page that scrolls or turns still gets it right. null when it is not on the screen. */
  function landing(){
    var h=PH && PH.head; if(!h || !h.isConnected) return null;
    var r=h.getBoundingClientRect(), cs=getComputedStyle(h);
    if(!r.width || !r.height || cs.display==="none" || r.bottom<0 || r.top>innerHeight || r.right<0 || r.left>innerWidth) return null;
    var k=Math.min(r.width/4676, r.height/936);
    return { kw:k, ox:r.left+(r.width-4676*k)/2+1*k, oy:r.top+(r.height-936*k)/2+729*k, color:cs.color };
  }
  function headBack(){ if(PH && PH.head && PH.hid){ PH.head.style.visibility=PH.headVis||""; PH.hid=false; } }
  function rgb(c){ var m=/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/.exec(c||""); return m ? [+m[1],+m[2],+m[3]] : [255,255,255]; }
  function renderPhone(t){
    var W=PH.W, H=PH.H, kw=PH.kw, ox=PH.ox, oy=PH.oy;
    /* THE LANDING: from 1.95 s the wordmark shrinks and flies into the header's own wordmark, lines up with it
       (and takes its colour, for a light header), and at 2.55 s hands over: the real header mark comes back
       underneath, exactly where ours is, and ours goes. The dark fades as it flies, so the page is there. */
    var L=t>=PFLY0 && PH.head ? landing() : null;
    if(PH.head && t>=PFLY0 && !L){ headBack(); PH.head=null; }   // the header went off the screen mid-flight: just fade
    if(L){
      var j=eio(seg(t,PFLY0,PFLY1)), cx0=ox+(INKL+INKW/2)*kw, cy0=oy-261*kw, cx1=L.ox+(INKL+INKW/2)*L.kw, cy1=L.oy-261*L.kw;
      kw=Math.exp(lerp(Math.log(kw),Math.log(L.kw),j));
      ox=lerp(cx0,cx1,j)-(INKL+INKW/2)*kw; oy=lerp(cy0,cy1,j)+261*kw;
      el.vppWg.setAttribute("transform","translate("+f(ox)+" "+f(oy)+") scale("+kw.toFixed(6)+")");
      var c0=[255,255,255], c1=rgb(L.color), cc=c0.map(function(v,i){ return Math.round(lerp(v,c1[i],j)); });
      [].forEach.call(el.vppWg.querySelectorAll("path"), function(pa){ pa.setAttribute("fill","rgb("+cc.join(",")+")"); });
      if(t>=PHAND) headBack();
    }
    var FX=ox+CX*kw, FY=oy+CY*kw;
    var bgA=eout(seg(t,0,0.15))*(1-eio(L ? seg(t,2.00,2.45) : seg(t,1.95,2.30)));
    root.style.background="rgba(5,5,6,"+(0.93*bgA).toFixed(3)+")";
    var fade=L ? 1-seg(t,PHAND,PLAND) : 1-eio(seg(t,1.95,2.30));
    if(REDUCED){   // a simple fade: the words and the finished logo, no movement
      var a=eout(seg(t,0,0.3))*fade;
      el.vppL1.style.opacity=el.vppL2.style.opacity=clamp(a*(1-seg(t,0.9,1.1)));
      el.vppL1.style.transform="scale("+L1S+")"; el.vppL2.style.transform="scale("+L2S+")";
      el.vppWg.setAttribute("opacity",(clamp(seg(t,0.9,1.1))*fade).toFixed(3));
      el.vppTg.setAttribute("transform","translate("+f(FX)+" "+f(FY)+") scale("+kw.toFixed(6)+")");
      el.vppBand.setAttribute("d",off(RO)); el.vppBand.setAttribute("opacity",(clamp(seg(t,0.9,1.1))*fade).toFixed(3)); el.vppCore.setAttribute("d","");
      return;
    }
    var out=eio(seg(t,0.95,1.08));
    function slam(e,a,s0,sc){ e.style.opacity=clamp(a*3)*(1-out); e.style.transform="scale("+(sc*lerp(s0,1,back(a))*(1-0.06*out))+")"; }
    if(WORDS.big){ slam(el.vppL1,seg(t,0.22,0.40),1.5,L1S); slam(el.vppL2,seg(t,0.36,0.50),1.3,L2S); }
    else { slam(el.vppL1,seg(t,0.20,0.34),1.4,1); slam(el.vppL2,seg(t,0.30,0.46),1.6,L2S); }
    var wf=eout(seg(t,1.00,1.18)); el.vppWg.setAttribute("opacity",(wf*fade).toFixed(3));
    var lit=strike(t,0.05), p0=PH.th/(HT*kw), g=eio(seg(t,1.05,1.40)), p=lerp(p0,1,g);
    var x=lerp(PH.tx,FX,g), y=lerp(PH.ty,FY,g*g); if(L){ x=FX; y=FY; p=1; }
    var k=kw*p, fill=eio(seg(t,1.45,1.65));
    el.vppTg.setAttribute("transform","translate("+f(x)+" "+f(y)+") scale("+k.toFixed(6)+")");
    el.vppBand.setAttribute("d",band(RO,RO-lerp(28*T,SOLID,fill))); el.vppBand.setAttribute("fill",lit<0.3?"#5a1438":"#FF1F8E");
    el.vppBand.setAttribute("opacity",((lit<0.3?0.25+lit*2.5:1)*fade).toFixed(3));
    var coreA=clamp((lit-0.3)/0.6)*(1-fill)*fade; el.vppCore.setAttribute("d",coreA>0.002?band(4.64*T,-2.64*T):""); el.vppCore.setAttribute("opacity",coreA.toFixed(3));
    var pulse=Math.sin(Math.PI*seg(t,1.65,1.95))*0.8, gl=(clamp(lit)*(1-fill)+pulse)*fade;
    el.vppSvg.style.filter=gl>0.003?"drop-shadow(0 0 "+Math.max(10*k,2).toFixed(2)+"px rgba(255,31,142,"+(0.9*Math.min(1,gl)).toFixed(3)+"))":"none";
  }
  function finish(how){
    if(!playing) return;
    playing=false; if(raf) window.cancelAnimationFrame(raf); raf=0;
    var c=LAYOUT==="tv" && cornerEl();
    if(c && corner){ if(!c.querySelector(".vp-newmark")) (function(){ var v=c.querySelector(".vn"); var host=(v && v.querySelector("svg:not(.vp-newmark)")) ? v : c; if(host!==c) v.classList.add("vp-keepline"); host.insertAdjacentHTML("afterbegin", wordSvg(corner.cssW)); })(); c.classList.add("vp-sting-mark"); }   // inside the .vn wrapper when there is one, so the new mark keeps the old mark's line and does not sit 2.8px high (3 Nov 2026)
    headBack();   // the phone's header mark is always given back, however the show ended
    if(root && root.parentNode) root.parentNode.removeChild(root);
    root=null; el={};
    stats.last=how; if(how==="ball"||how==="content") stats.cutShort++;
    window.removeEventListener("resize",fit);
    /* "the show is over" for anything that measures the corner (VPVenueLogo.alignMark: the mark it hid is
       back, as the new mark, so the two logos are lined up again now, not never). */
    try{ var ev=document.createEvent("Event"); ev.initEvent("vp-sting-done", false, false); window.dispatchEvent(ev); }catch(e){}
    if(LAYOUT==="tv") said(false);
  }
  function aimCorner(){ var c=measureCorner(); if(!c) return; var a=toStage(c.right,c.top); corner={ r:a[0], t:a[1], w:c.width/stage.s, cssW:c.width, drop:cornerDrop() }; }
  var LAYOUT="tv";
  function dur(){ return LAYOUT==="phone" ? (PH && PH.land ? PLAND : PDUR) : DUR; }
  function loop(now){ if(!playing) return; var t=(now-t0)/1000; if(t>=dur()){ render(dur()); finish("done"); return; } render(t); raf=requestAnimationFrame(loop); }
  function play(opts){
    if(playing) return;
    opts=opts||{};
    LAYOUT=opts.layout==="phone"?"phone":"tv";
    WORDS=opts.words||{l1:"LET\u2019S PLAY", l2:"BINGO"};
    if(LAYOUT==="phone"){ buildPhone(); playing=true; stats.plays++; stats.last="playing"; render(0);
      if(!window.__vpStingManual){ t0=performance.now(); raf=requestAnimationFrame(loop); } return; }
    var c=measureCorner(); if(!c) return;
    build();
    if(WORDS.line){ el.vpsL3s.innerHTML=WORDS.line; el.vpsL3ws.innerHTML=WORDS.line; }
    else { el.vpsL1.firstChild.textContent=WORDS.l1; el.vpsL2s.textContent=WORDS.l2; el.vpsL2ws.textContent=WORDS.l2; }
    var a=toStage(c.right,c.top);
    corner={ r:a[0], t:a[1], w:c.width/stage.s, cssW:c.width, drop:cornerDrop() };
    var tc=cornerEl(); if(tc){ tc.classList.add("vp-sting-mark"); var old=tc.querySelector(".vp-newmark"); if(old) old.parentNode.removeChild(old); }
    try{ var sp=WORDS.line?el.vpsL3s:el.vpsL2s; L2S=Math.min(1,(WORDS.line?1700:1640)/Math.max(1,sp.offsetWidth)); }catch(e){}
    window.addEventListener("resize",fit);
    playing=true; stats.plays++; stats.last="playing";
    said(true);
    render(0);
    if(!window.__vpStingManual){ t0=performance.now(); raf=requestAnimationFrame(loop); }
  }
  /* "a show is on the wall" / "it is over", for anything that should step aside for it (tv.html fades the
     venue's top-left logo, 3 Nov 2026). Said on this window, and to the TV page when this is the game in its
     frame. An end-of-game show says the same two things. */
  function said(on){
    if(on){ try{ var ev=document.createEvent("Event"); ev.initEvent("vp-sting-start", false, false); window.dispatchEvent(ev); }catch(e){} }   // "done" is vp-sting-done, in finish()
    try{ if(window.parent && window.parent!==window) window.parent.postMessage({ vp:"sting", on:!!on }, window.location.origin); }catch(e){}
  }
  /* Called by tv.html with every message, before the TV acts on it. info: the TV's own view. */
  function onMsg(m, info){
    if(!ON || !m) return;
    if(m.t==="ball"){ lastBall=Date.now(); }
    if(m.t==="ball" && playing){ finish("ball"); return; }        // the room's number wins over the show
    if(m.t!=="started") return;
    info=info||{};
    var lb=Math.max(info.lastBallAt||0, lastBall);
    if(lb && Date.now()-lb < 120000 && info.phase==="running") return;   // mid-game: never
    play({ layout:info.layout, words:info.words });
  }
  window.VPSting={
    on:ON, seconds:DUR, phoneSeconds:PDUR, onMsg:onMsg,
    start:function(o){ if(ON) play(o); },
    phoneWords:phoneWords, cleanName:cleanName,
    /* The other games, one line each in their page's onMsg. A game's "started" plays it (never a TV or phone
       that joins later: that hears "state"), and its first real content (a question, a song, a board) makes
       the show give way at once. A draw has no "started": the first word from the host plays it, once per
       page and only before anything is drawn, and the first "drawing" makes it give way. */
    forGame:function(m, words, first, layout){
      if(!ON || !m) return;
      if(first[m.t]){ seenContent=true; if(playing) finish("content"); return; }
      if(m.t==="started"){ seenContent=false; play({ words:words, layout:layout }); }
    },
    forDraw:function(m, words, layout){
      if(!ON || !m) return;
      if(m.t==="drawing"){ drawSeen=true; if(playing) finish("content"); return; }
      if(!drawSeen && !stats.plays && (m.t==="state" || m.t==="host_here")) play({ words:words, layout:layout });
    },
    shown:function(){ var a=document.getElementById("vppL1"), b=document.getElementById("vppL2"); return a ? [a.textContent, b.textContent] : null; },               // a page's own "the game has started"
    stop:function(why){ if(playing) finish(why||"stop"); },   // a page's first real content: the show gives way
    playing:function(){ return playing; },
    stats:function(){ return { plays:stats.plays, cutShort:stats.cutShort, last:stats.last, playing:playing }; },
    frame:function(t){ if(!playing) return false; if(t>=dur()){ render(dur()); finish("done"); return false; } render(t); return true; }
  };
})();
