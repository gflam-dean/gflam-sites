/* THE LAST-CALL PAGE MUST PICK THE SAME STATE THE WORKER WILL.

   Every other founding page carries one hardcoded code because it is one state.
   /last-call is national: it goes to the addresses no verifier could prove, and
   to anyone who stumbles across the link. A national page cannot carry a national
   code, because the Worker's gate is `codeActive && stateOk` and stateOk compares
   the code's PREFIX to the venue's POSTCODE. A made-up prefix matches no postcode,
   so every venue would read $2.50 and be charged $3.00. That already happened on
   /qld and /vic once.

   So the page mirrors vpaStateFromPostcode() from the Worker. Two copies of the
   same ranges is a drift risk, and drift here is silent: the venue sees one price
   and the card takes another. This runs BOTH implementations over all ten thousand
   postcodes and requires they never disagree.

   Run: jsc venueplay-backend/worker/founding-postcode-agree.test.js
*/
function grab(file, fn){
  var t = readFile(file);
  var i = t.indexOf("function " + fn + "(");
  if (i < 0) throw new Error("no " + fn + " in " + file);
  var d=0, started=false;
  for (var j=i;j<t.length;j++){
    if(t[j]==="{"){d++;started=true;} else if(t[j]==="}"){d--; if(started&&d===0) return t.slice(i,j+1);}
  }
  throw new Error("unterminated " + fn);
}
var W = grab("venueplay-backend/worker/venueplay-api-FULL.js","vpaStateFromPostcode");
var P = grab("venueplay/last-call.html","vpStateFromPostcode");
var C = grab("venueplay/last-call.html","vpFoundingCode");
eval(W.replace(/\bconst\b/g,"var"));
eval(P); eval(C);
var bad=0, checked=0, firstBad=[];
for (var n=0;n<=9999;n++){
  var pc = ("0000"+n).slice(-4);
  var w = vpaStateFromPostcode(pc);
  var p = vpStateFromPostcode(pc);
  checked++;
  if (w !== p){ bad++; if(firstBad.length<6) firstBad.push(pc+": worker="+w+" page="+p); }
}
print("postcodes compared        : " + checked);
print("DISAGREEMENTS             : " + bad);
firstBad.forEach(function(x){ print("   " + x); });
/* and the code that would actually be sent */
var samples = {"2000":"NSW","2600":"NSW","0800":"NT","3000":"VIC","8000":"VIC","4000":"QLD","9000":"QLD","5000":"SA","6000":"WA","7000":"TAS","0200":"NSW","2912":"NSW"};
print("\nthe code the page would send:");
var wrong=0;
for (var pc in samples){
  var got = vpFoundingCode(pc);
  var want = samples[pc] + "-DEC-2026";
  if (got !== want){ wrong++; print("  BAD  " + pc + " -> " + got + "  (expected " + want + ")"); }
  else print("  ok   " + pc + " -> " + got);
}
print("\nunrecognised postcode 9999999 -> '" + vpFoundingCode("9999999") + "' (empty = standard price, the safe failure)");
var total = checked + Object.keys(samples).length + 1;
if (bad === 0 && wrong === 0) print("\nALL " + total + " CHECKS PASSED");
else { print("\nFAILED " + (bad + wrong) + " of " + total); throw new Error("postcode mapping drift"); }
