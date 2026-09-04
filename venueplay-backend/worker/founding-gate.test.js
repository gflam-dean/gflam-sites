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

/* THE REAL GATE, LIFTED OUT OF THE WORKER. Not a copy.

   The first version of this file re-implemented the union here, and that is
   precisely why a SECOND broken gate survived 38 passing checks: these tests
   would have passed unchanged if the Worker's gate had been deleted, and they
   never looked at vpaFoundingForPostcode at all. HQ-onboarded venues in SA 58xx,
   WA 68xx and TAS 78xx were put on the standard price for life while these
   checks were green. Found by audit 5 Sep 2026. */
var gsrc = /function vpaFoundingStateOk\(postcode, codeState\)[\s\S]*?\n\}/.exec(SRC);
var dsrc = /const VPA_STATE_DIGIT = \{[^}]*\};/.exec(SRC);
pass("the Worker defines ONE shared gate", !!gsrc && !!dsrc,
     "if this fails, somebody has re-introduced a second copy");
if (!gsrc || !dsrc) { print("\n" + bad + " FAILED, " + ran + " run"); throw new Error("stop"); }
// eval of a `const` keeps it inside the eval's own scope, so the lifted
// function cannot see it. Hoist it onto the global instead.
eval(dsrc[0].replace('const VPA_STATE_DIGIT =', 'globalThis.VPA_STATE_DIGIT ='));
eval(gsrc[0]);
var gateSaysFounding = vpaFoundingStateOk;

/* And the HQ path, which is the one that was wrong. It loops the live codes and
   must reach the same answer as checkout for the same postcode. */
var hq = /function vpaFoundingForPostcode\(env, postcode\)[\s\S]*?\n\}/.exec(SRC);
pass("the HQ path exists", !!hq);
if (hq) { eval(hq[0]); }
function hqSaysFounding(postcode, codeState) {
  return vpaFoundingForPostcode({ FOUNDING_CODES: codeState + '-SEP-2026' }, postcode);
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

print("\nHQ ONBOARDING AND SELF-SERVE MUST AGREE, FOR EVERY POSTCODE");
/* Two links to the same product. A venue that qualifies through /qld must qualify
   through the welcome email too, or its price depends on which door it came in. */
var disagree = [], checked = 0;
['QLD','NSW','VIC','SA','WA','TAS','NT','ACT'].forEach(function (st) {
  for (var pc = 200; pc <= 9999; pc += 1) {
    var p = String(pc);
    while (p.length < 4) p = '0' + p;
    checked++;
    if (gateSaysFounding(p, st) !== hqSaysFounding(p, st)) disagree.push(st + ' ' + p);
  }
});
pass("both paths agree on all " + checked + " postcode and state pairs", disagree.length === 0,
     disagree.length ? (disagree.length + " disagree, e.g. " + disagree.slice(0, 4).join(', ')) : "");

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
