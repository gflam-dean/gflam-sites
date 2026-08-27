var m={exports:{}};
(new Function("module","globalThis", readFile("/Users/dean.tindale/partyplay/lib/pp-licence.js")))(m, this);
var L=m.exports;
var pass=0,fail=0;
function ok(c,msg){ if(c) pass++; else { fail++; print("  FAIL  "+msg); } }
var H=3600000, T0=1756000000000;

print("== plans ==");
ok(L.plan(1).hours===24, "one day is 24 hours");
ok(L.plan(3).hours===72, "three days is 72 hours");
ok(L.PRICE_CENTS[1]===5000 && L.PRICE_CENTS[3]===12000, "prices unchanged at $50 and $120");
[0,2,4,1.5,"x",null,undefined,NaN].forEach(function(v){
  var threw=false; try{ L.plan(v); }catch(e){ threw=true; }
  ok(threw, "rejects days="+String(v));
});

print("== the clock starts when they say go ==");
var a=L.activate(1,T0);
ok(a.startsAt===T0, "starts exactly now");
ok(a.endsAt===T0+24*H, "one day ends 24 hours later");
ok(L.activate(3,T0).endsAt===T0+72*H, "three days ends 72 hours later");
ok(a.startsAtIso.slice(-1)==="Z" && a.endsAtIso.slice(-1)==="Z", "stored as UTC instants");

print("== no timezone anywhere ==");
var src=readFile("/Users/dean.tindale/partyplay/lib/pp-licence.js");
ok(src.indexOf("Intl")<0, "no Intl, so nothing to get wrong about whose midnight it is");
ok(src.indexOf("Australia/")<0, "no timezone table to maintain");
ok(src.toLowerCase().indexOf("daylight")<0 || src.indexOf("daylight saving, and the whole")>0,
   "daylight saving is only mentioned in the comment explaining why it is gone");

print("== live boundaries ==");
ok(!L.isLive(a, T0-1), "dead one ms before it starts");
ok(L.isLive(a, T0), "live at the instant it starts");
ok(L.isLive(a, a.endsAt-1), "live one ms before the end");
ok(!L.isLive(a, a.endsAt), "dead exactly at the end");
ok(!L.isLive(null), "an unstarted licence is not live");
ok(!L.isLive({}), "a licence with no start is not live");

print("== time remaining, rounded up ==");
ok(L.msLeft(a,T0)===24*H, "24 hours at the start");
ok(L.msLeft(a,a.endsAt+9999)===0, "never negative");
ok(L.timeLeft(a,T0)==="1 day left", "reads '1 day left', got "+L.timeLeft(a,T0));
ok(L.timeLeft(a,a.endsAt-90*60000)==="1 hour 30 min left", "got "+L.timeLeft(a,a.endsAt-90*60000));
ok(L.timeLeft(a,a.endsAt-30*60000)==="30 minutes left", "got "+L.timeLeft(a,a.endsAt-30*60000));
ok(L.timeLeft(a,a.endsAt-60000)==="1 minute left", "singular minute, got "+L.timeLeft(a,a.endsAt-60000));
ok(L.timeLeft(a,a.endsAt-1)==="1 minute left", "rounds UP so it never says zero while play continues");
ok(L.timeLeft(a,a.endsAt)==="Finished", "says Finished at the end");
var b=L.activate(3,T0);
ok(L.timeLeft(b,T0)==="3 days left", "got "+L.timeLeft(b,T0));
ok(L.timeLeft(b,T0+30*H)==="1 day 18h left", "got "+L.timeLeft(b,T0+30*H));

print("== an unused licence does not last forever ==");
ok(L.unusedExpiry(T0)===T0+365*24*H, "unused expiry is 12 months from purchase");

print("== the confirmation wording ==");
var w=L.startWarning(1);
ok(/24 hours/.test(w), "names the length");
ok(/clock runs from this moment/.test(w), "says the consequence");
ok(/keep building/.test(w), "tells them the safe alternative");
ok(/3 days/.test(L.startWarning(3)), "three day version says three days");

print("\n"+(fail?"FAILED "+fail+" of "+(pass+fail):"ALL "+pass+" CHECKS PASSED"));
