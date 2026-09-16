/* WHAT TIME IS IT AT THIS VENUE? One answer, from the postcode, on every path that
   creates a venue.

   Until 16 Sep 2026 there were three creation paths and three different answers. The
   self-serve one derived au_state from the postcode in the very same insert and then wrote
   timezone: 'Australia/Brisbane' regardless. HQ's path fell back to Brisbane whenever its
   form did not send one, which it never does. Only the group path used the helper.

   Today that is invisible for NSW, VIC, TAS and ACT, because those clocks agree with
   Brisbane until daylight saving starts on 5 October. After that it is an hour wrong in
   three places at once: sessions close at 4am instead of 3am, a members draw shows
   "Tonight" on the wrong day for an hour either side of midnight, and the last-day email
   lands at 9am instead of 8. WA and SA are wrong all year round. */
var bad=0, ran=0;
function pass(n,c,x){ if(typeof n!=="string")throw new Error("name first");
  if(typeof c!=="boolean")throw new Error("condition must be a boolean: "+n);
  ran++; print((c?"  ok   ":"  FAIL ")+n+(x?"   "+x:"")); if(!c)bad++; }
function find(rel){ var t=[rel,"../"+rel]; for(var i=0;i<t.length;i++){ try{var s=readFile(t[i]); if(s&&s.length>500) return s;}catch(e){} } throw new Error("cannot find "+rel); }
function lift(src,name){ var m=new RegExp("(?:async\\s+)?function\\s+"+name+"\\s*\\(").exec(src); if(!m)return null;
  var i=src.indexOf("{",m.index),d=0; for(var j=i;j<src.length;j++){ if(src[j]==="{")d++; else if(src[j]==="}"){d--; if(!d) return src.slice(m.index,j+1);} } return null; }
var BILL=find("venueplay-backend/worker/venueplay-api-FULL.js");
eval(lift(BILL,"vpaStateFromPostcode"));
eval(lift(BILL,"vpaTimezoneFromPostcode"));

/* Real postcodes, one per state, including the ranges the old leading-digit test got
   wrong: QLD 9xxx, VIC 8xxx, NSW 1xxx, ACT 02xx. */
/* THE STATE IS ASSERTED AS WELL AS THE CLOCK, and it has to be. Deleting QLD's 9xxx
   range from the map passed every timezone check, because an unknown postcode falls back
   to Brisbane and Brisbane is what a 9xxx venue should get anyway. The clock hid it. But
   au_state is what decides which state's gaming rules a venue is shown and whether the
   paper-ticket rule applies, so a 9xxx venue reading as no state at all is a real fault
   that the clock alone can never catch. */
var CASES=[
  ["2000","Sydney CBD","NSW","Australia/Sydney"],
  ["1234","NSW 1xxx (Sydney business)","NSW","Australia/Sydney"],
  ["2026","Bondi","NSW","Australia/Sydney"],
  ["2600","Canberra ACT","ACT","Australia/Sydney"],
  ["2914","ACT 29xx","ACT","Australia/Sydney"],
  ["3000","Melbourne CBD","VIC","Australia/Melbourne"],
  ["8000","VIC 8xxx (Melbourne business)","VIC","Australia/Melbourne"],
  ["4000","Brisbane","QLD","Australia/Brisbane"],
  ["4727","Ilfracombe, Wellshot Hotel","QLD","Australia/Brisbane"],
  ["9000","QLD 9xxx (Brisbane business)","QLD","Australia/Brisbane"],
  ["5000","Adelaide","SA","Australia/Adelaide"],
  ["6000","Perth","WA","Australia/Perth"],
  ["7000","Hobart","TAS","Australia/Hobart"],
  ["0800","Darwin","NT","Australia/Darwin"],
];
for (var i=0;i<CASES.length;i++){
  var pc=CASES[i][0], what=CASES[i][1], wantSt=CASES[i][2], want=CASES[i][3];
  var got=vpaTimezoneFromPostcode(pc), gotSt=vpaStateFromPostcode(pc);
  pass(pc+"  "+what, got===want && gotSt===wantSt,
       (got===want && gotSt===wantSt) ? "" : "got "+gotSt+"/"+got+", wanted "+wantSt+"/"+want);
}
/* An unknown postcode has to land somewhere, and Brisbane is the safest guess for an
   Australian venue. But it must be the FALLBACK, never the answer for a known one. */
pass("an unreadable postcode falls back to Brisbane", vpaTimezoneFromPostcode("")==="Australia/Brisbane");
pass("and so does a nonsense one", vpaTimezoneFromPostcode("zzzz")==="Australia/Brisbane");

/* THE THING THAT ACTUALLY WENT WRONG: a creation path writing the clock by hand. */
var hard=(BILL.match(/timezone:\s*'Australia\/[A-Za-z_]+'/g)||[]);
pass("NO creation path hardcodes a timezone any more", hard.length===0,
     hard.length ? hard.join(", ") : "");
var derived=(BILL.match(/timezone:\s*vpaTimezoneFromPostcode\(/g)||[]).length;
pass("every venue insert derives it from the postcode instead", derived>=2, derived+" insert(s)");
pass("HQ no longer defaults to Brisbane when its form sends no timezone",
     BILL.indexOf("b.timezone || 'Australia/Brisbane'")===-1);
pass("HQ derives it from the postcode it already requires",
     /timezoneIn \|\| vpaTimezoneFromPostcode\(venuePostcode\)/.test(BILL));

/* The clock and the state must come from the same postcode, or a venue can be shown one
   state's gaming rules on another state's clock. */
var disagree=[];
for (var j=0;j<CASES.length;j++){
  var p2=CASES[j][0];
  var st=vpaStateFromPostcode(p2), tz=vpaTimezoneFromPostcode(p2);
  var expect={NSW:"Australia/Sydney",ACT:"Australia/Sydney",VIC:"Australia/Melbourne",
              QLD:"Australia/Brisbane",SA:"Australia/Adelaide",WA:"Australia/Perth",
              TAS:"Australia/Hobart",NT:"Australia/Darwin"}[st];
  if (expect && expect!==tz) disagree.push(p2+" is "+st+" but "+tz);
}
pass("the state and the clock never disagree about the same postcode", disagree.length===0,
     disagree.join("; "));

print((bad?"  "+bad+" FAILED, ":"  ALL ")+ran+" CHECKS"+(bad?"":" PASSED"));
if(bad) throw new Error(bad+" failed");
