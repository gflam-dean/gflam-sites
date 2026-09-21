/* A BINGO ROOM IN A BOX: the REAL console and the REAL phone page, on a fake channel.

   Written by the audit of 20 Sep 2026 to reproduce the wiped-winner-screen fault, and kept,
   because nothing else in this repo could have found it: the fault lives BETWEEN two pages.
   It executes the inline scripts of venueplay/app/index.html and venueplay/play.html straight
   from the repo (not copies), wires them to one in-memory bus, and gives them a virtual clock
   so thirty seconds of heartbeats costs nothing.

   Used by tools/test-winner-screen-survives.js. Paths are relative to the repo root, which is
   where the gate runs every suite from.
*/
/* Offline rig: runs the WHOLE shipped inline script of the bingo console and the player phone
   against a fake realtime bus. Nothing here touches the network or the repo. */
var REPO="";
function inlineScript(path){
  var html=readFile(REPO+path);
  // the last <script> block with no src
  var re=/<script>([\s\S]*?)<\/script>/g, m, last=null, best="";
  while((m=re.exec(html))){ if(m[1].length>best.length) best=m[1]; }
  return best;
}
// ---------- fake clock ----------
var NOW=0, TIMERS=[], TID=1;
function fSetTimeout(fn,ms){ var id=TID++; TIMERS.push({id:id,at:NOW+(ms||0),fn:fn,every:0}); return id; }
function fSetInterval(fn,ms){ var id=TID++; TIMERS.push({id:id,at:NOW+ms,fn:fn,every:ms}); return id; }
function fClear(id){ TIMERS=TIMERS.filter(function(t){ return t.id!==id; }); }
async function drain(){ for(var i=0;i<12;i++){ await Promise.resolve(); } pump(); for(var j=0;j<12;j++){ await Promise.resolve(); } pump(); }
async function advance(ms){
  var end=NOW+ms;
  for(;;){
    TIMERS.sort(function(a,b){ return a.at-b.at; });
    var t=TIMERS[0];
    if(!t || t.at>end) break;
    NOW=t.at;
    if(t.every){ t.at+=t.every; } else { TIMERS.shift(); }
    try{ t.fn(); }catch(e){ print("  [timer threw] "+e); }
    await drain();
  }
  NOW=end; await drain();
}
// ---------- fake bus ----------
var BUS={}, QUEUE=[], LOG=[];
function pump(){
  var guard=0;
  while(QUEUE.length && guard++<100000){
    var q=QUEUE.shift();
    (BUS[q.name]||[]).forEach(function(sub){ if(sub!==q.from && sub.live){ try{ sub.cb({payload:JSON.parse(JSON.stringify(q.payload))}); }catch(e){ print("  [onMsg threw in "+sub.who+"] "+e+" "+(e.stack||"")); } } });
  }
}
function makeSupabase(who){
  return { createClient:function(){ return {
    auth:{ getSession:function(){ return Promise.resolve({data:{session:null}}); }, signInWithOtp:function(){return Promise.resolve({});}, verifyOtp:function(){return Promise.resolve({});} },
    channel:function(name){
      var sub={ who:who, cb:function(){}, live:false, statusCb:null };
      var ch={ on:function(a,b,cb){ sub.cb=cb; return ch; },
        subscribe:function(cb){ sub.statusCb=cb; (BUS[name]=BUS[name]||[]).push(sub); sub.live=true; fSetTimeout(function(){ cb("SUBSCRIBED"); },1); return ch; },
        send:function(msg){ LOG.push({from:who,p:msg.payload}); QUEUE.push({name:name,from:sub,payload:msg.payload}); },
        unsubscribe:function(){ sub.live=false; }, _sub:sub };
      return ch; } }; } };
}
// ---------- fake DOM ----------
function makeDom(search, store0){
  var made={};
  function el(id){
    var raw="";
    var node={ id:id||"", textContent:"", value:"", disabled:false, checked:false, children:[], _on:{}, _attr:{},
      style:{ setProperty:function(){}, display:"" },
      appendChild:function(n){ this.children.push(n); n.parentNode=this; return n; },
      insertBefore:function(n){ this.children.unshift(n); return n; },
      removeChild:function(n){ return n; },
      addEventListener:function(ev,fn){ (this._on[ev]=this._on[ev]||[]).push(fn); },
      setAttribute:function(k,v){ this._attr[k]=String(v); }, getAttribute:function(k){ return this._attr[k]==null?null:this._attr[k]; },
      querySelector:function(){ return null; }, querySelectorAll:function(){ return []; },
      closest:function(){ return null; }, focus:function(){}, select:function(){}, click:function(){ (this._on.click||[]).forEach(function(f){ f.call(node,{target:node,preventDefault:function(){},stopPropagation:function(){}}); }); },
      classList:{ _s:{}, add:function(c){this._s[c]=1;}, remove:function(c){delete this._s[c];}, toggle:function(c,on){ if(on===undefined) on=!this._s[c]; if(on) this._s[c]=1; else delete this._s[c]; }, contains:function(c){ return !!this._s[c]; } } };
    Object.defineProperty(node,"innerHTML",{ get:function(){return raw;}, set:function(v){ raw=String(v); node.children=[]; } });
    Object.defineProperty(node,"className",{ get:function(){ return Object.keys(node.classList._s).join(" "); }, set:function(v){ node.classList._s={}; String(v).split(/\s+/).forEach(function(c){ if(c) node.classList._s[c]=1; }); } });
    return node;
  }
  var document={ _on:{}, visibilityState:"visible", documentElement:el("html"), body:el("body"),
    getElementById:function(id){ if(!made[id]) made[id]=el(id); return made[id]; },
    createElement:function(){ return el(); }, querySelector:function(){ return null; }, querySelectorAll:function(){ return []; },
    addEventListener:function(ev,fn){ (this._on[ev]=this._on[ev]||[]).push(fn); } };
  var store=store0||{};
  var ls={ getItem:function(k){ return Object.prototype.hasOwnProperty.call(store,k)?store[k]:null; }, setItem:function(k,v){ store[k]=String(v); }, removeItem:function(k){ delete store[k]; }, _s:store };
  var window={ _on:{}, location:{ search:search||"", href:"", replace:function(u){ window._replaced=u; } }, addEventListener:function(ev,fn){ (this._on[ev]=this._on[ev]||[]).push(fn); } };
  return { document:document, window:window, localStorage:ls, sessionStorage:{getItem:function(){return null;},setItem:function(){},removeItem:function(){}}, made:made };
}
var fakeCrypto={ getRandomValues:function(a){ for(var i=0;i<a.length;i++) a[i]=Math.floor(Math.random()*4294967296); return a; } };
function runPage(src, sandbox, exportsList){
  var tail="__export({"+exportsList.map(function(n){ return n+":(typeof "+n+"!=='undefined'?"+n+":undefined)"; }).join(",")+"});";
  var k=src.lastIndexOf("})();");
  src=src.slice(0,k)+tail+src.slice(k);
  var out={};
  sandbox.__export=function(o){ for(var n in o) out[n]=o[n]; };
  var proxy=new Proxy(sandbox,{ has:function(){ return true; }, get:function(t,key){ if(key===Symbol.unscopables) return undefined; if(key in t) return t[key]; return globalThis[key]; }, set:function(t,key,v){ t[key]=v; return true; } });
  var fn=new Function("__sb","with(__sb){\n"+src+"\n}");
  fn(proxy);
  return out;
}
function baseSandbox(dom, who){
  var sb={ document:dom.document, window:dom.window, localStorage:dom.localStorage, sessionStorage:dom.sessionStorage,
    supabase:makeSupabase(who), crypto:fakeCrypto, setTimeout:fSetTimeout, setInterval:fSetInterval, clearTimeout:fClear, clearInterval:fClear,
    fetch:function(){ return Promise.reject(new Error("offline rig")); }, navigator:{}, location:dom.window.location,
    console:{ log:function(){}, info:function(){}, warn:function(){}, error:function(){} }, confirm:function(){ return true; }, alert:function(){} };
  dom.window.crypto=fakeCrypto;
  return sb;
}
var CODE="ACDEFG";
function bootHost(opts){
  opts=opts||{};
  var dom=makeDom("", opts.store);
  var sb=baseSandbox(dom,"host");
  var ctx={ authed:true, scope:"staff", role:"owner", isAdmin:false, currentVenueId:"v1", user:{user_metadata:{name:"Dean"}},
            venue:{ id:"v1", slug:"test-pub", name:"Test Pub", status:"active", max_players:(opts.cap||100), created_at:"2026-01-01T00:00:00Z" }, staff:[{venue_id:"v1"}] };
  var VP={ useClient:function(){}, ready:function(){ return Promise.resolve(ctx); }, refresh:function(){ return Promise.resolve(ctx); }, suspensionBanner:function(){},
    venueCode:function(){ return CODE; }, venueJoinCode:function(){ return Promise.resolve(null); }, getClient:function(){ return { auth:{ getSession:function(){ return Promise.resolve({data:{session:null}}); } } }; },
    gameApiPost:function(path,body){ (sb.__posts=sb.__posts||[]).push({path:path,body:body}); return Promise.resolve(opts.post?opts.post(path,body):{error:"offline"}); },
    gameApiCall:function(path,body){ (sb.__calls=sb.__calls||[]).push({path:path,body:body}); return Promise.resolve(opts.call?opts.call(path,body):{status:503,json:{}}); },
    setGameActive:function(){}, enforceShift:function(){}, noteOpenSession:function(){}, closeOpenSessions:function(){}, listVenues:function(){ return Promise.resolve([]); }, signOut:function(){},
    homeHref:function(c){ var st=(c&&c.staff)||[]; return (st.length && st.every(function(x){ return x.role==="marketing"; })) ? "marketing.html" : "index.html"; } };
  sb.VP=VP; dom.window.VP=VP;
  var HOLD={ busy:function(){ return false; }, hold:function(){}, release:function(){} };
  sb.VP_HOLD=HOLD; dom.window.VP_HOLD=HOLD;
  var ex=runPage(inlineScript("venueplay/app/index.html"), sb, ["G","nextBall","startGame","openLobby","newGame","endGame","hostConfirm","hostReject","keepPlaying","finishGame","onMsg","commitBall","NIGHT","topUpFor","dealFor","makeStrip","checkPattern","saveGame","restoreGame"]);
  ex.dom=dom; ex.sb=sb; ex.$=function(id){ return dom.document.getElementById(id); };
  return ex;
}
function bootPhone(name){
  var dom=makeDom("?room="+CODE);
  var sb=baseSandbox(dom,"phone:"+name);
  var ex=runPage(inlineScript("venueplay/play.html"), sb, ["P","onMsg","pressBingo","join","route","leaveGame","onChannelStatus"]);
  ex.dom=dom; ex.sb=sb; ex.$=function(id){ return dom.document.getElementById(id); };
  ex.name=name;
  return ex;
}
function viewOf(ph){ var v=["vNoRoom","vJoin","vWait","vCard","vWon","vLost"]; for(var i=0;i<v.length;i++){ if(!ph.$(v[i]).classList.contains("hidden")) return v[i]; } return "?"; }
