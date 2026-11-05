/* ONE VENUE MATCHER, RUN (INBOX 60, 61, 62, 81; Dean, 5 Nov 2026).

   "Is this the same venue?" is answered by vpVenueKey, vpVenuePostcode and vpVenueMatch. The source is
   venueplay-backend/worker/vp-venue-match.js and the billing Worker carries a copy (the gate holds them
   identical). This lifts the copy the billing Worker SHIPS and runs it on the traps a typed pub name falls
   into: case and punctuation, an apostrophe, "&", a leading "The", accents, the right name at the wrong
   postcode, a made-up name, and a name that is only part of another.

   Run: jsc venueplay-backend/worker/venue-match.test.js */
var bad = 0, ran = 0;
function pass(n, c, extra){ ran++; print((c ? "  ok   " : "  FAIL ") + n + (extra !== undefined ? "   saw: " + extra : "")); if(!c) bad++; }
var src = null;
["venueplay-backend/worker/venueplay-api-FULL.js", "venueplay-api-FULL.js"].forEach(function (p) {
  if (src) return; try { var t = readFile(p); if (t && t.length > 1000) src = t; } catch (e) {}
});
if (!src) throw new Error("could not find the billing Worker");
function lift(name){
  var i = src.indexOf("\nfunction " + name + "(");
  if (i < 0) throw new Error("cannot find " + name + ": a test that cannot find its subject cannot fail");
  var d = 0, k = src.indexOf("{", i);
  do { if (src[k] === "{") d++; else if (src[k] === "}") d--; k++; } while (d > 0 && k < src.length);
  return src.slice(i, k);
}
eval(lift("vpVenueKey")); eval(lift("vpVenuePostcode")); eval(lift("vpVenueMatch")); eval(lift("vpaSlugify"));

print("");
print("1. The name, shaped the way the slug allocator shapes it");
pass("a plain name keys exactly as its slug does (royal-hotel)", vpVenueKey("Royal Hotel") === vpaSlugify("Royal Hotel") && vpVenueKey("Royal Hotel") === "royal-hotel", vpVenueKey("Royal Hotel"));
pass("case, double spaces and a full stop do not make a new venue", vpVenueKey("ROYAL  HOTEL.") === "royal-hotel", vpVenueKey("ROYAL  HOTEL."));
pass("a leading The is dropped: The Royal Hotel = Royal Hotel", vpVenueKey("The Royal Hotel") === "royal-hotel", vpVenueKey("The Royal Hotel"));
pass("a The inside a word is kept: Theatre Royal stays theatre-royal", vpVenueKey("Theatre Royal") === "theatre-royal", vpVenueKey("Theatre Royal"));
pass("an apostrophe is not a word break: Olim's = Olims", vpVenueKey("Olim's Canberra Hotel") === vpVenueKey("Olims Canberra Hotel"), vpVenueKey("Olim's Canberra Hotel"));
pass("a curly apostrophe too: Olim’s = Olims", vpVenueKey("Olim’s Canberra Hotel") === "olims-canberra-hotel", vpVenueKey("Olim’s Canberra Hotel"));
pass("& is and: Bat & Ball = Bat and Ball", vpVenueKey("Bat & Ball Hotel") === vpVenueKey("Bat and Ball Hotel"), vpVenueKey("Bat & Ball Hotel"));
pass("accents go: Café Royal = Cafe Royal", vpVenueKey("Café Royal") === "cafe-royal", vpVenueKey("Café Royal"));
pass("an accent inside a word goes too: Cr\u00e8me Bar = Creme Bar", vpVenueKey("Cr\u00e8me Bar") === "creme-bar", vpVenueKey("Cr\u00e8me Bar"));
pass("nothing but punctuation is no name at all", vpVenueKey("!!! ...") === "" && vpVenueKey(null) === "" && vpVenueKey("") === "");

print("");
print("2. The postcode: four digits, or none");
pass("4000 QLD reads as 4000", vpVenuePostcode("4000 QLD") === "4000");
pass("spaces inside are fine: 40 00", vpVenuePostcode(" 40 00 ") === "4000");
pass("five digits is not a postcode", vpVenuePostcode("40001") === "");
pass("three digits is not a postcode (no zero is invented)", vpVenuePostcode("800") === "");
pass("a number arrives the same as text", vpVenuePostcode(4217) === "4217");

print("");
print("3. Same venue, a different venue, or cannot tell");
pass("the same pub typed differently is the same venue", vpVenueMatch("The Royal Hotel", "4000", "royal hotel", "4000 QLD") === "same", vpVenueMatch("The Royal Hotel", "4000", "royal hotel", "4000 QLD"));
pass("THE RIGHT NAME AT THE WRONG POSTCODE is a different venue", vpVenueMatch("Royal Hotel", "4000", "Royal Hotel", "2026") === null, vpVenueMatch("Royal Hotel", "4000", "Royal Hotel", "2026"));
pass("A FAKE NAME matches nothing", vpVenueMatch("Totally Made Up Tavern", "4000", "Royal Hotel", "4000") === null);
pass("part of a name is not the name: Royal is not Royal Hotel", vpVenueMatch("Royal", "4000", "Royal Hotel", "4000") === null);
pass("no postcode on one side cannot tell two Royals apart: unsure", vpVenueMatch("Royal Hotel", "", "Royal Hotel", "4000") === "unsure" && vpVenueMatch("Royal Hotel", "4000", "Royal Hotel", null) === "unsure");
pass("an empty name never matches an empty name", vpVenueMatch("", "4000", "", "4000") === null && vpVenueMatch("...", "4000", "!!", "4000") === null);

print("");
if (bad) print(bad + " of " + ran + " checks FAILED"); else print("ALL " + ran + " CHECKS PASSED");
