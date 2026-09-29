/* THE RAFFLE, MEMBERS AND BINGO CONSOLES GET THEIR CHANNEL BACK.
   Review, 28 Sep 2026: the dropped-channel rebuild of 27 Sep ("every screen and phone") never
   reached these three consoles. A CLOSED channel does not rejoin by itself, and raffle/members
   only reopened one on a tab switch, so a draw stopped reaching the TV until the host went away
   and came back. RUNS the real openChannel() out of raffle/host.html and members/host.html with
   the REAL /app/vp-channel.js against a fake client that keeps the library's two rules
   (subscribe once; removeChannel reports CLOSED at once). Run: jsc tools/test-channel-recovery-consoles.js */
var ran = 0, bad = 0;
function show(n, c, extra){ ran++; print((c?'  ok   ':'  FAIL ')+n+(extra?'   -> '+extra:'')); if(!c) bad++; }
function lift(src, name){ var m=new RegExp("function\\s+"+name+"\\s*\\(").exec(src); if(!m) return null; var i=src.indexOf("{",m.index), d=0;
  for(var j=i;j<src.length;j++){ if(src[j]==="{") d++; else if(src[j]==="}"){ d--; if(!d) return src.slice(m.index,j+1); } } return null; }
var timers=[]; function setTimeout(f,ms){ timers.push({f:f,ms:ms}); return timers.length; } function clearTimeout(){}
function fire(){ var t=timers.shift(); if(t) t.f(); }
var window={}; (new Function("window","setTimeout","clearTimeout", readFile("venueplay/app/vp-channel.js")))(window, setTimeout, clearTimeout);
show("vp-channel.js loaded", !!window.VPChannel);
function fakeClient(){ var chans=[]; return { chans:chans, channel:function(name,opts){ var c={ name:name, subs:0, cb:null, sent:[], on:function(a,b,h){ this.h=h; return this; },
    subscribe:function(cb){ this.subs++; this.cb=cb; return this; }, send:function(m){ this.sent.push(m); }, unsubscribe:function(){ if(this.cb) this.cb("CLOSED"); } }; chans.push(c); return c; },
  removeChannel:function(c){ if(c.cb) c.cb("CLOSED"); } }; }
["raffle","members","jag"].forEach(function(game){
  print("\n== "+game+" console ==");
  var src=readFile("venueplay/app/"+game+"/host.html");
  var body=lift(src,"openChannel"); show("openChannel() lifted", !!body);
  show('the page loads /app/vp-channel.js', src.indexOf('<script src="/app/vp-channel.js"></script>')>0);
  var client=fakeClient(), els={}, sent=[], ch=null, subscribed=false, _leaving=false, _closed=false, queue=[];
  function $(id){ return els[id]||(els[id]={ classList:{ remove:function(){ this.on=false; }, add:function(){ this.on=true; } }, textContent:"" }); }
  var api=(new Function("client","window","$","send","flushQueue","onPair","onMsg","VPChannel","setTimeout","clearTimeout",
     "var ch=null, subscribed=false, _leaving=false, _closed=false;\n"+body+"\nreturn { open:openChannel, ch:function(){ return ch; }, sub:function(){ return subscribed; } };"))
     (client, window, $, function(m){ sent.push(m); }, function(){ queue.push("flush"); }, function(){}, function(){}, window.VPChannel, setTimeout, clearTimeout);
  api.open("ACDEFG"); timers=[];
  show("it opens one real channel", client.chans.length===1 && client.chans[0].subs===1);
  client.chans[0].cb("SUBSCRIBED");
  show("connected: subscribed, and the backlog flushed", api.sub()===true && queue.length===1);
  client.chans[0].cb("CLOSED");
  show("the channel drops: subscribed is cleared and the host sees Reconnecting", api.sub()===false && $("statusText").textContent==="Reconnecting");
  show("a rebuild is booked with a backoff", timers.length===1 && timers[0].ms>=2000, JSON.stringify(timers.map(function(t){ return t.ms; })));
  fire();
  show("the rebuild opens a FRESH channel (a closed one never rejoins)", client.chans.length===2 && client.chans[1].subs===1);
  client.chans[1].cb("SUBSCRIBED");
  show("back: subscribed again and the backlog flushed again", api.sub()===true && queue.length===2);
  client.chans[0].cb("CHANNEL_ERROR");
  show("the old channel speaking up afterwards changes nothing", api.sub()===true);
});
print("\n== bingo console (Supabase fallback) ==");
var b=readFile("venueplay/app/index.html");
show('the bingo console loads /app/vp-channel.js', b.indexOf('<script src="/app/vp-channel.js"></script>')>0);
show('its Supabase fallback channel is a kept one', /if\(!_room\)\{[\s\S]{0,400}ch=window\.VPChannel \? VPChannel\.keep\(client, "vp-"\+code/.test(b));
print("\n"+(ran-bad)+" of "+ran+" checks passed");
if(bad) throw new Error(bad+" console channel checks failed");
