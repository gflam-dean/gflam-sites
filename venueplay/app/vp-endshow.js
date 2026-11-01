/* THE END-OF-GAME SHOW ON THE TV (2 Nov 2026): the bookend to the start-of-game show in /app/vp-sting.js.
   OFF unless the page's address has ?endshow=1. A TV passes its ?endshow=1 on to the game screen in its
   frame, the way it passes the start show's switch.

   One copy for every TV screen. A page calls VPEndShow.play(o) when its game ends, with what the page
   already knows about the result, and VPEndShow.heard(m) with every message, so anything that starts
   the next game (a "started", a ball, a question, a song, a draw) stops the show at once: the room's
   next game always wins over the last one's goodbye.

   o = { kind:"bingo"|"musical"|"trivia"|"raffle",
         eye:"WE HAVE A WINNER",                  the pink line over the result
         big:"SAM", sub:"One line \u00b7 Meat tray",   ONE result, said big
         rows:[{lead:"1", main:"QUIZ WIZARDS", tail:"840"}, ...],   OR up to three, first at the top
         more:"and 2 more prizes",                under the rows when there were more than three
         venue:"The Mini Bar" }                   defaults to the page's own #venueNameTag text
   No result at all (a game that ran and nobody won): the show is the close on its own, about 3 s.

   The show, about 5.8 s, silent, over a dimmed and blurred wall like the start show:
     1. the neon play triangle strikes on above centre; the result slams in under it in Anton (one
        winner big, or the top three as rows, third, second, then first);
     2. the result gives way to THANKS FOR PLAYING and the venue's name; the triangle flies down and
        drops into the a of the venueplay wordmark, vanishes, relights, fills solid and pulses twice;
     3. it all fades and the wall underneath (the ads, the final scores) is simply there.
   Under prefers-reduced-motion: the same words and the finished logo, faded in and out, nothing moves
   and nothing flickers. No light flashes more than three times a second (one dim blink per strike).

   Every name and prize is set as TEXT (textContent), never as HTML: they arrive over a public channel.
   The whole show is drawn on a 1920x1080 stage scaled to fit the screen, so it fits every TV size; any
   line too wide for its space is scaled down to fit, never cut.

   The logo is the 2026 logo kit's, triangle at 112%. Its path data and triangle geometry are the SAME
   as /app/vp-sting.js (tools/tv-endshow-in-chrome.test.py fails if the two copies ever differ).
   window.__vpEndShowManual (set only by a recorder, before the page loads) swaps the clock for
   VPEndShow.frame(t), so a contact sheet can step the show to an exact moment. */
(function(){
  "use strict";
  var ON = /[?&]endshow=1(&|$)/.test(location.search || "");
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
  // the brand triangle, the same geometry as vp-sting.js: 112% of F4 round its centroid; origin at the a's counter centre
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
  var CX=3830, CY=-245, INKW=4676, INKL=-1;

  /* THE STAGE, 1920x1080. The wordmark in the close: 640 wide, centred, its baseline at 930. */
  var WMW=640, KW=WMW/INKW, WOX=960-(INKW/2+INKL)*KW, WOY=930, FX=WOX+CX*KW, FY=WOY+CY*KW;
  var TOPX=960, TOPY=200, TOPH=118;                     // where the triangle strikes on, over the result
  var DUR_FULL=5.8, DUR_CLOSE=3.0, SHIFT=2.8;           // with a result; the close on its own starts SHIFT in

  var root=null, el={}, stage={s:1,x:0,y:0}, playing=false, t0=0, raf=0, cur=null, waiters=[];
  var stats={ plays:0, cutShort:0, last:"", kind:"" };
  var NEXT={ started:1, ball:1, question:1, played:1, drawing:1, ta_board:1, mode:1 };   // the next game: the show gives way

  /* Text off the wire, made fit to show: no control or zero-width characters, one space between words,
     cut with an ellipsis past `max` characters. Only ever set as textContent. */
  function clean(s, max){
    s=String(s==null?"":s).replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g,"").replace(/\s+/g," ").trim();
    var cp=Array.from ? Array.from(s) : s.split("");
    if(max && cp.length>max) s=cp.slice(0,max-1).join("").replace(/\s+$/,"")+"\u2026";
    return s;
  }
  // Anton is shown in capitals; the name is lowercase "venueplay" always, even inside a venue's name
  function caps(s){ return String(s||"").toUpperCase().replace(/VENUEPLAY/g,"venueplay"); }
  function pageVenue(){ var v=document.getElementById("venueNameTag"); return v ? v.textContent : ""; }

  function fit(){
    var W=innerWidth, H=innerHeight, s=Math.min(W/1920,H/1080);
    stage={ s:s, x:(W-1920*s)/2, y:(H-1080*s)/2 };
    if(el.vpeStage) el.vpeStage.style.transform="translate("+f(stage.x)+"px,"+f(stage.y)+"px) scale("+s+")";
  }
  function div(id, cls, css){ var d=document.createElement("div"); if(id) d.id=id; if(cls) d.className=cls; if(css) d.style.cssText=css; return d; }
  function span(text){ var s=document.createElement("span"); s.textContent=text; return s; }
  /* Scale a line down until it fits `w` px of the stage. Never up. The span is measured as laid out. */
  function shrink(line, w){ var s=line.firstChild; if(!s) return 1; var k=Math.min(1, w/Math.max(1, s.offsetWidth)); line.setAttribute("data-k", k.toFixed(4)); return k; }

  function build(o){
    root=div("vpEndShow", "", "position:fixed;inset:0;z-index:2147483001;pointer-events:none;overflow:hidden");
    root.setAttribute("aria-hidden","true");
    var st=document.createElement("style"); st.id="vpEndShowCss";
    st.textContent=
      ".vpe-t{position:absolute;left:0;width:1920px;display:flex;justify-content:center;white-space:nowrap;line-height:1;transform-origin:960px 50%;opacity:0}"+
      ".vpe-a{font-family:Anton,Impact,sans-serif;font-weight:400}"+
      ".vpe-pink{color:#FF1F8E;text-shadow:0 0 30px rgba(255,31,142,.55)}"+
      ".vpe-white{color:#fff;text-shadow:0 6px 40px rgba(0,0,0,.6)}"+
      ".vpe-sub{font-family:'Hanken Grotesk',system-ui,sans-serif;font-weight:800;font-size:60px;letter-spacing:.01em;color:rgba(255,255,255,.9);text-shadow:0 3px 18px rgba(0,0,0,.7)}"+
      ".vpe-sweep{color:transparent!important;text-shadow:none!important}.vpe-sweep span{background:linear-gradient(100deg,rgba(255,255,255,0) 40%,rgba(255,214,234,.85) 50%,rgba(255,255,255,0) 60%);background-size:250% 100%;-webkit-background-clip:text;background-clip:text;color:transparent}"+
      ".vpe-row{position:absolute;left:180px;width:1560px;height:150px;box-sizing:border-box;display:flex;align-items:center;gap:36px;padding:0 54px 0 28px;border-radius:30px;background:rgba(255,255,255,.05);border:2px solid rgba(255,255,255,.10);opacity:0;transform-origin:50% 50%}"+
      ".vpe-row.first{border-color:rgba(255,31,142,.85);box-shadow:0 0 40px rgba(255,31,142,.35),inset 0 0 24px rgba(255,31,142,.12)}"+
      ".vpe-lead{flex:0 0 108px;height:108px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-family:Anton,Impact,sans-serif;font-size:76px;line-height:1;color:#FF1F8E;border:4px solid #FF1F8E;box-shadow:0 0 22px rgba(255,31,142,.55),inset 0 0 14px rgba(255,31,142,.35);text-shadow:0 0 18px rgba(255,31,142,.6)}"+
      ".vpe-main{flex:1 1 auto;min-width:0;overflow:visible;white-space:nowrap;font-family:Anton,Impact,sans-serif;font-size:104px;line-height:1;color:#fff;text-shadow:0 4px 24px rgba(0,0,0,.6)}"+
      ".vpe-main span{display:inline-block;transform-origin:0 50%}"+
      ".vpe-row.first .vpe-main{font-size:116px}"+
      ".vpe-tail{flex:0 0 auto;white-space:nowrap;font-family:'Hanken Grotesk',system-ui,sans-serif;font-weight:800;font-size:58px;color:rgba(255,255,255,.88)}"+
      ".vpe-tail.num{font-family:'JetBrains Mono',ui-monospace,monospace;font-weight:700;font-size:80px;color:#fff}"+
      ".vpe-tail span{display:inline-block;transform-origin:100% 50%}";
    document.head.appendChild(st);
    var back0=div("vpeBack","","position:absolute;inset:0;background:rgba(5,5,6,0)");
    var sg=div("vpeStage","","position:absolute;left:0;top:0;width:1920px;height:1080px;transform-origin:0 0");
    sg.appendChild(div("vpeAmb","","position:absolute;inset:0"));
    root.appendChild(back0); root.appendChild(sg);
    document.body.appendChild(root);

    /* 1. THE RESULT */
    var A=div("vpeA","","position:absolute;inset:0"); sg.appendChild(A);
    var eye=div("vpeEye","vpe-t vpe-a vpe-pink","top:296px;font-size:92px;letter-spacing:.08em"); eye.appendChild(span(o.eye)); A.appendChild(eye);
    if(o.big){
      var big=div("vpeBig","vpe-t vpe-a vpe-white","top:420px;font-size:300px;letter-spacing:.015em"); big.appendChild(span(o.big)); A.appendChild(big);
      var bigw=div("vpeBigW","vpe-t vpe-a vpe-sweep","top:420px;font-size:300px;letter-spacing:.015em"); bigw.appendChild(span(o.big)); A.appendChild(bigw);
      if(o.sub){ var sub=div("vpeSub","vpe-t vpe-sub","top:770px"); sub.appendChild(span(o.sub)); A.appendChild(sub); }
    }
    el.rows=[];
    (o.rows||[]).forEach(function(r,i){
      var row=div("vpeRow"+(i+1),"vpe-row"+(i===0?" first":""),"top:"+(430+i*176)+"px");
      if(r.lead){ var ld=div("","vpe-lead"); ld.textContent=r.lead; row.appendChild(ld); }
      var mn=div("","vpe-main"); mn.appendChild(span(r.main)); row.appendChild(mn);
      if(r.tail){ var tl=div("","vpe-tail"+(r.num?" num":"")); tl.appendChild(span(r.tail)); row.appendChild(tl); }
      A.appendChild(row); el.rows.push(row);
    });
    if(o.more){ var mo=div("vpeMore","vpe-t vpe-sub","top:"+(430+3*176+4)+"px;font-size:44px;color:rgba(255,255,255,.7)"); mo.appendChild(span(o.more)); A.appendChild(mo); }

    /* 2. THE CLOSE */
    var B=div("vpeB","","position:absolute;inset:0"); sg.appendChild(B);
    var v=o.venue;
    var l1=div("vpeThanks","vpe-t vpe-a vpe-pink", v ? "top:300px;font-size:140px;letter-spacing:.06em" : "top:330px;font-size:150px;letter-spacing:.06em");
    l1.appendChild(span(v ? "THANKS FOR PLAYING" : "THANKS FOR")); B.appendChild(l1);
    var l2=div("vpeVenue","vpe-t vpe-a vpe-white", v ? "top:462px;font-size:250px;letter-spacing:.015em" : "top:478px;font-size:290px;letter-spacing:.015em");
    l2.appendChild(span(v ? v : "PLAYING")); B.appendChild(l2);
    var l2w=div("vpeVenueW","vpe-t vpe-a vpe-sweep", l2.style.cssText); l2w.appendChild(span(v ? v : "PLAYING")); B.appendChild(l2w);

    var NS="http://www.w3.org/2000/svg";
    var svg=document.createElementNS(NS,"svg"); svg.id="vpeWord"; svg.setAttribute("viewBox","0 0 1920 1080");
    svg.setAttribute("style","position:absolute;left:0;top:0;width:1920px;height:1080px;overflow:visible;opacity:0");
    svg.innerHTML='<g transform="translate('+f(WOX)+' '+f(WOY)+') scale('+KW.toFixed(6)+')"><path fill="#fff" d="'+REST+'"/><path fill="#fff" d="'+ANEON+'"/></g>';
    sg.appendChild(svg);
    var tri=document.createElementNS(NS,"svg"); tri.id="vpeTri"; tri.setAttribute("viewBox","0 0 1920 1080");
    tri.setAttribute("style","position:absolute;left:0;top:0;width:1920px;height:1080px;overflow:visible");
    tri.innerHTML='<g id="vpeTg"><path id="vpeBand" fill="#FF1F8E" fill-rule="evenodd"/><path id="vpeCore" fill="#FFD6EA" fill-rule="evenodd"/></g>';
    sg.appendChild(tri);
    ["vpeBack","vpeStage","vpeAmb","vpeA","vpeEye","vpeBig","vpeBigW","vpeSub","vpeMore","vpeB","vpeThanks","vpeVenue","vpeVenueW","vpeWord","vpeTri","vpeTg","vpeBand","vpeCore"].forEach(function(i){ el[i]=document.getElementById(i); });
    fit();
    // Fit every line to its space, measured as laid out (Anton is the TV's own font, already loaded)
    el.k={ eye:shrink(eye,1700), big:o.big?shrink(el.vpeBig,1700):1, sub:el.vpeSub?shrink(el.vpeSub,1700):1,
           thanks:shrink(l1,1700), venue:shrink(l2,1700), more:el.vpeMore?shrink(el.vpeMore,1500):1 };
    el.rows.forEach(function(row){
      var mn=row.querySelector(".vpe-main"), s=mn.firstChild, tl=row.querySelector(".vpe-tail span");
      var room=mn.getBoundingClientRect().width/stage.s;
      var k=Math.min(1, room/Math.max(1, s.offsetWidth)); s.style.transform="scale("+k.toFixed(4)+")"; row.setAttribute("data-k",k.toFixed(4));
      if(tl){ var kt=Math.min(1, 520/Math.max(1, tl.offsetWidth)); tl.style.transform="scale("+kt.toFixed(4)+")"; }
    });
  }

  function render(t){
    var o=cur, hasA=o.hasA, D=o.dur, u=hasA ? t : t+SHIFT;     // u: the time on the full show's clock
    var dim=eout(seg(t,0,0.25)), out=eio(seg(t,D-0.55,D)), vis=1-out;
    el.vpeBack.style.backdropFilter=el.vpeBack.style.webkitBackdropFilter=(dim*vis)>0.002?"blur("+(18*dim*vis*stage.s).toFixed(2)+"px) brightness("+(1-0.84*dim*vis).toFixed(3)+")":"none";
    el.vpeBack.style.background="rgba(5,5,6,"+(0.35*dim*vis).toFixed(3)+")";
    el.vpeStage.style.opacity=vis.toFixed(3);
    var aOut=eio(seg(u,2.85,3.08));
    function slam(e,a,s0,k){ if(!e) return; k=k||1;
      if(REDUCED){ e.style.opacity=(clamp(a*1.5)*(1-aOut)).toFixed(3); e.style.transform="scale("+k+")"; return; }
      var sh=(a>0.4&&a<0.8)?Math.sin(u*210)*5*(0.8-a)/0.4:0;
      e.style.opacity=(clamp(a*3)*(1-aOut)).toFixed(3); e.style.transform="translate("+f(sh)+"px,"+f(sh*0.5)+"px) scale("+(k*lerp(s0,1,back(a))*(1-0.06*aOut))+")"; }
    if(hasA){
      slam(el.vpeEye, REDUCED?seg(u,0.20,0.50):seg(u,0.25,0.42), 1.4, el.k.eye);
      if(o.big){
        var bs=REDUCED?seg(u,0.30,0.60):seg(u,0.42,0.62);
        slam(el.vpeBig, bs, 1.7, el.k.big); slam(el.vpeBigW, bs, 1.7, el.k.big);
        var sw=REDUCED?0:seg(u,0.78,1.20);
        el.vpeBigW.firstChild.style.backgroundPosition=(-60+220*eio(sw)).toFixed(1)+"% 0";
        if(sw<=0||sw>=1) el.vpeBigW.style.opacity=0;
        if(el.vpeSub){ var sa=seg(u,0.75,0.98); el.vpeSub.style.opacity=(eout(sa)*(1-aOut)).toFixed(3); el.vpeSub.style.transform="translateY("+f(REDUCED?0:lerp(24,0,eout(sa)))+"px) scale("+el.k.sub+")"; }
      }
      // the rows land third, second, then first: the winner last and biggest
      var n=el.rows.length;
      el.rows.forEach(function(row,i){ var st=0.48+(n-1-i)*0.30; slam(row, REDUCED?seg(u,0.30,0.60):seg(u,st,st+0.20), i===0?1.35:1.22, 1); });
      if(el.vpeMore){ el.vpeMore.style.opacity=(eout(seg(u,1.30,1.50))*(1-aOut)).toFixed(3); el.vpeMore.style.transform="scale("+el.k.more+")"; }
    }
    // the close: THANKS FOR PLAYING, the venue, the wordmark the triangle drops into
    function slamB(e,a,s0,k){ if(REDUCED){ e.style.opacity=clamp(a*1.5).toFixed(3); e.style.transform="scale("+k+")"; return; }
      e.style.opacity=clamp(a*3).toFixed(3); e.style.transform="scale("+(k*lerp(s0,1,back(a)))+")"; }
    slamB(el.vpeThanks, REDUCED?seg(u,3.00,3.30):seg(u,3.05,3.22), 1.4, el.k.thanks);
    var vs=REDUCED?seg(u,3.05,3.35):seg(u,3.16,3.36);
    slamB(el.vpeVenue, vs, 1.6, el.k.venue); slamB(el.vpeVenueW, vs, 1.6, el.k.venue);
    var sw2=REDUCED?0:seg(u,3.45,3.90);
    el.vpeVenueW.firstChild.style.backgroundPosition=(-60+220*eio(sw2)).toFixed(1)+"% 0";
    if(sw2<=0||sw2>=1) el.vpeVenueW.style.opacity=0;
    var wf=REDUCED?seg(u,3.05,3.35):eout(seg(u,3.35,3.55)); el.vpeWord.style.opacity=wf.toFixed(3);

    // THE TRIANGLE
    var p, x, y, lit, fill, kin=KW, p0=TOPH/(HT*KW);
    if(REDUCED){   // still: over the result, then solid in the a; one fade between, no flicker
      var inB=u>=3.05;
      p=inB?1:p0; x=inB?FX:TOPX; y=inB?FY:TOPY; lit=inB?wf:(hasA?eout(seg(u,0.05,0.35))*(1-aOut):0); fill=inB?1:0;
    } else {
      var t1=hasA?0.06:SHIFT+0.05;
      if(u<3.84){ lit=strike(u,t1);
        var g=eio(seg(u,3.20,3.55)), d=seg(u,3.55,3.76), v=seg(u,3.76,3.84), overY=WOY-729*KW-36-0.5*HT*KW*1.3;
        p=lerp(p0,1.3,g); x=lerp(TOPX,FX,g); y=lerp(TOPY,overY,g);
        if(d>0){ p=lerp(1.3,1,eio(d)); y=lerp(overY,FY,d*d); }
        if(v>0){ p=lerp(1,0,v*v*(3-2*v)); y=FY; } }
      else { p=u<3.98?0:1; x=FX; y=FY; lit=strike(u,3.98); }
      fill=eio(seg(u,4.22,4.42));
    }
    var k=kin*p;
    el.vpeTri.style.opacity=(p<=0.002||lit<=0.001)?0:1;
    el.vpeTg.setAttribute("transform","translate("+f(x)+" "+f(y)+") scale("+Math.max(k,1e-6).toFixed(6)+")");
    var tube=lerp(28*T,SOLID,fill), coreA=REDUCED?0:clamp((lit-0.3)/0.6)*(1-fill);
    el.vpeBand.setAttribute("d",band(RO,RO-tube));
    el.vpeBand.setAttribute("fill",(!REDUCED&&lit<0.3)?"#5a1438":"#FF1F8E");
    el.vpeBand.setAttribute("opacity",REDUCED?lit.toFixed(3):(lit<0.3?0.25+lit*2.5:1));
    el.vpeCore.setAttribute("d",coreA>0.002?band(4.64*T,-2.64*T):""); el.vpeCore.setAttribute("opacity",coreA.toFixed(3));
    var beat=function(q){ return Math.pow(Math.sin(Math.PI*q),2); };
    var relight=(!REDUCED&&u>3.98)?Math.sin(Math.PI*seg(u,4.02,4.30))*0.5:0;
    var beats=REDUCED?0:(beat(seg(u,4.42,4.76))+beat(seg(u,4.76,5.10)))*0.9;
    var gl=REDUCED?0:clamp(lit)*(1-fill)+relight+beats;
    el.vpeTri.style.filter=gl>0.003?"drop-shadow(0 0 "+Math.max(10*k*(1+relight),1.2*(1+beats*0.6)).toFixed(2)+"px rgba(255,31,142,"+(0.95*Math.min(1,gl)).toFixed(3)+")) drop-shadow(0 0 "+Math.max(30*k*(1+relight),4.5*(1+beats*0.8)).toFixed(2)+"px rgba(255,31,142,"+(0.55*Math.min(1.3,gl)).toFixed(3)+"))":"none";
    var bloom=function(q0,a){ return u>q0?a*Math.exp(-(u-q0)*7):0; }, bl=REDUCED?0:bloom(hasA?0.23:SHIFT+0.22,0.22)+bloom(4.15,0.12);
    el.vpeAmb.style.background="radial-gradient(circle at "+f(x)+"px "+f(y)+"px, rgba(255,31,142,"+(0.10*clamp(lit)*Math.min(p,3)/3+0.05*relight+bl).toFixed(3)+") 0, rgba(255,31,142,0) "+f(380*(1+bl*2))+"px)";
  }

  function finish(how){
    if(!playing) return;
    playing=false; if(raf) cancelAnimationFrame(raf); raf=0;
    if(root && root.parentNode) root.parentNode.removeChild(root);
    var css=document.getElementById("vpEndShowCss"); if(css && css.parentNode) css.parentNode.removeChild(css);
    root=null; el={}; cur=null;
    stats.last=how; if(how!=="done") stats.cutShort++;
    window.removeEventListener("resize",fit);
    var w=waiters; waiters=[];
    w.forEach(function(fn){ try{ fn(how); }catch(e){} });
  }
  function loop(now){ if(!playing) return; var t=(now-t0)/1000; if(t>=cur.dur){ render(cur.dur); finish("done"); return; } render(t); raf=requestAnimationFrame(loop); }

  /* What the room is told, from what the page knows. Rows: at most three, first at the top. */
  function shape(o){
    o=o||{};
    var rows=(o.rows||[]).filter(function(r){ return r && clean(r.main); }).slice(0,3).map(function(r){
      return { lead:clean(r.lead,3), main:caps(clean(r.main,28)), tail:clean(r.tail,26), num:!!r.num }; });
    var big=caps(clean(o.big,24)), venue=caps(clean(o.venue==null?pageVenue():o.venue,40));
    var hasA=!!(big || rows.length);
    return { kind:String(o.kind||""), eye:caps(clean(o.eye,32))||"WE HAVE A WINNER", big:rows.length?"":big, sub:clean(o.sub,48),
             rows:rows, more:rows.length?clean(o.more,40):"", venue:venue, hasA:hasA, dur:hasA?DUR_FULL:DUR_CLOSE };
  }
  function play(o){
    if(!ON || playing) return false;
    cur=shape(o);
    build(cur);
    window.addEventListener("resize",fit);
    playing=true; stats.plays++; stats.last="playing"; stats.kind=cur.kind;
    render(0);
    if(!window.__vpEndShowManual){ t0=performance.now(); raf=requestAnimationFrame(loop);
      /* A HIDDEN TAB NEVER FIRES requestAnimationFrame (a Fire Stick whose launcher came forward). The
         show must still end and hand the wall back, so a timer ends it whatever the frames did. */
      var mine=stats.plays; setTimeout(function(){ if(playing && stats.plays===mine) finish("done"); }, cur.dur*1000+400); }
    return true;
  }

  window.VPEndShow={
    on:ON, reduced:REDUCED, seconds:DUR_FULL, closeSeconds:DUR_CLOSE,
    play:play,
    /* every message the page hears: the next game's first word stops the show at once */
    heard:function(m){ if(playing && m && NEXT[m.t]) finish("next"); },
    stop:function(why){ if(playing) finish(why||"stop"); },
    playing:function(){ return playing; },
    left:function(){ return playing && !window.__vpEndShowManual ? Math.max(0, cur.dur*1000-(performance.now()-t0)) : (playing ? cur.dur*1000 : 0); },
    /* run fn once the show is over (or now, when none is playing): a page's "back to the ads" waits for it */
    after:function(fn){ if(playing) waiters.push(fn); else fn("none"); },
    shown:function(){ if(!playing || !root) return null;
      var txt=function(e){ return e ? e.textContent : ""; };
      return { eye:txt(el.vpeEye), big:txt(el.vpeBig), sub:txt(el.vpeSub), rows:el.rows.map(function(r){ return Array.prototype.map.call(r.children, function(c){ return c.textContent; }); }),
               more:txt(el.vpeMore), thanks:txt(el.vpeThanks), venue:txt(el.vpeVenue), kind:cur.kind, dur:cur.dur }; },
    stats:function(){ return { plays:stats.plays, cutShort:stats.cutShort, last:stats.last, kind:stats.kind, playing:playing }; },
    frame:function(t){ if(!playing) return false; if(t>=cur.dur){ render(cur.dur); finish("done"); return false; } render(t); return true; },
    clean:clean
  };
})();
