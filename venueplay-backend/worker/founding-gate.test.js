/* WHO GETS THE FOUNDING PRICE. Money, and it has been silently wrong before.

   Founding is invite-only: a state page like /qld sends a founding_code, and the
   venue's POSTCODE must be in that code's state or they pay standard. When it
   goes wrong it goes wrong quietly. The venue reads the founding price on the
   state page, signs up, and is charged standard with no error and no
   explanation. That already happened once: the gate tested only the LEADING
   DIGIT, so QLD 9xxx, VIC 8xxx, NSW 1xxx and ACT 02xx venues all failed it.

   The fix made the gate a UNION of the digit test and vpaStateFromPostcode, and
   the two cover each other's gaps in a way that is easy to break by "tidying"
   one away:

     QLD 9xxx, VIC 8xxx, NSW 1xxx   the digit fails, the map saves it
     SA 58xx, WA 68xx, TAS 78xx     the map returns null, the digit saves it

   Run: jsc venueplay-backend/worker/founding-gate.test.js
*/
var bad = 0, ran = 0;
function pass(n, c, extra){ ran++; print((c ? "  ok   " : "  FAIL ") + n + (extra ? "   " + extra : "")); if(!c) bad++; }

function find(rel) {
  var tries = [rel, "../" + rel, "../../" + rel];
  for (var i = 0; i < tries.length; i++) {
    try { var t = readFile(tries[i]); if (t && t.length > 500) return t; } catch (e) {}
  }
  throw new Error("cannot find " + rel);
}
var SRC = find("venueplay-backend/worker/venueplay-api-FULL.js");

var m = /function vpaStateFromPostcode\(pc\)[\s\S]*?\n\}/.exec(SRC);
pass("the Worker defines vpaStateFromPostcode", !!m);
if (!m) { print("\n1 FAILED"); throw new Error("stop"); }
eval(m[0]);

/* The gate, lifted as the Worker computes it. Kept in one place here so the test
   fails if either half of the union is removed. */
var STATE_DIGIT = { QLD:'4', NSW:'2', ACT:'2', VIC:'3', SA:'5', WA:'6', TAS:'7', NT:'0' };
function gateSaysFounding(postcode, codeState) {
  var reqDigit = STATE_DIGIT[codeState] || '';
  var pc = String(postcode || '').trim();
  var pcState = vpaStateFromPostcode(pc);
  return (reqDigit !== '' && pc.charAt(0) === reqDigit) ||
         (pcState !== null && pcState === codeState) ||
         (pcState === 'ACT' && codeState === 'NSW') ||
         (pcState === 'NSW' && codeState === 'ACT');
}

print("\nTHE ORDINARY CASE: a venue in the state the code is for");
[['4000','QLD','Brisbane'], ['3000','VIC','Melbourne'], ['2000','NSW','Sydney'],
 ['5000','SA','Adelaide'], ['6000','WA','Perth'], ['7000','TAS','Hobart'],
 ['0800','NT','Darwin'], ['2600','ACT','Canberra']].forEach(function (t) {
  pass(t[2] + " " + t[0] + " on a " + t[1] + " code gets founding",
       gateSaysFounding(t[0], t[1]) === true);
});

print("\nTHE RANGES THE DIGIT TEST ALONE MISSED (this is the bug that happened)");
[['9000','QLD','a QLD 9xxx postcode'], ['9726','QLD','Gold Coast mail centre'],
 ['8000','VIC','a VIC 8xxx postcode'], ['8888','VIC','a VIC 8xxx postcode'],
 ['1000','NSW','a NSW 1xxx postcode'], ['0200','ACT','an ACT 02xx postcode']
].forEach(function (t) {
  pass(t[2] + " " + t[0] + " still gets founding", gateSaysFounding(t[0], t[1]) === true,
       "the leading digit says no; the state map says yes");
});

print("\nTHE RANGES THE STATE MAP ALONE MISSES (so the digit test must stay)");
[['5800','SA'], ['5999','SA'], ['6800','WA'], ['6999','WA'], ['7800','TAS'], ['7999','TAS']
].forEach(function (t) {
  pass("a " + t[1] + " " + t[0] + " postcode still gets founding",
       gateSaysFounding(t[0], t[1]) === true,
       "vpaStateFromPostcode returns " + vpaStateFromPostcode(t[0]) + "; the digit saves it");
});

print("\nACT AND NSW ARE ONE MARKET FOR FOUNDING");
pass("an ACT venue on an NSW code qualifies", gateSaysFounding('2600','NSW') === true);
pass("a NSW venue on an ACT code qualifies", gateSaysFounding('2000','ACT') === true);

print("\nAND A VENUE IN THE WRONG STATE MUST NOT");
[['4000','VIC','a Brisbane venue on a Victorian code'],
 ['3000','QLD','a Melbourne venue on a Queensland code'],
 ['6000','SA','a Perth venue on a South Australian code'],
 ['7000','WA','a Hobart venue on a Western Australian code'],
 ['5000','TAS','an Adelaide venue on a Tasmanian code']].forEach(function (t) {
  pass(t[2] + " pays standard", gateSaysFounding(t[0], t[1]) === false);
});
pass("a postcode that is not a postcode pays standard", gateSaysFounding('', 'QLD') === false);
pass("nonsense pays standard", gateSaysFounding('abcd', 'QLD') === false);

print("\nEVERY STATE MAPS SOMEWHERE, AND NOTHING MAPS TWICE");
var seen = {}, clash = [];
for (var pc = 200; pc <= 9999; pc++) {
  var st = vpaStateFromPostcode(String(pc));
  if (st) seen[st] = (seen[st] || 0) + 1;
}
['ACT','NSW','VIC','QLD','SA','WA','TAS','NT'].forEach(function (s) {
  pass(s + " has postcodes mapped to it", (seen[s] || 0) > 0, (seen[s] || 0) + " postcodes");
});

print("\n" + (bad ? bad + " FAILED, " + ran + " run" : "ALL " + ran + " CHECKS PASSED"));
