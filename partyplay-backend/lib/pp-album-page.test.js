/* THE ALBUM PAGE HAD NO TEST AT ALL, and it is the thing a guest is promised at the
   door: "everyone at the party shares one album, leave your email and we will send it
   to you tomorrow". Two faults were sitting on it on 15 Sep 2026, found by uploading a
   photo and opening the share link:

     "1 thing in here. Tap any of them to save it."
     "These are deleted on Thursday 15 October, which is 31 days away."

   One photo is not a thing and there is not more than one of them to tap. And the day
   count was Math.ceil on the raw millisecond gap, so an album that goes at nine in the
   evening on 15 October read 31 days on the morning of 15 September: the number and the
   date in the same sentence disagreed, and 31 also contradicts the thirty days the
   privacy page promises.

   Like pp-run-games, this loads the real page rather than a copy of its logic.

   Run: jsc partyplay-backend/lib/pp-album-page.test.js
*/
function ppFile(rel) {
  var tries = [rel, "partyplay-backend/" + rel, "../" + rel, "../../" + rel];
  for (var i = 0; i < tries.length; i++) {
    try { var t = readFile(tries[i]); if (t && t.length > 100) return tries[i]; } catch (e) {}
  }
  throw new Error("cannot find " + rel);
}
var src = readFile(ppFile("partyplay/album.html"));
var body = src.match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/)[1];

var g = {};
g.window = g;
g.document = { getElementById: function(){ return { innerHTML:"", addEventListener:function(){} }; } };
g.location = { search:"?share=abc" };
g.fetch = function(){ return { then:function(){ return this; }, catch:function(){ return this; } }; };
g.PPConfig = { API:"https://x" };
g.URLSearchParams = function(){ this.get = function(){ return "abc"; }; };

var EXPORT = "\n; globalThis.__A = { albumDays:albumDays, albumCount:albumCount };\n";
var cut = body.lastIndexOf("})();");
if (cut < 0) { print("could not find the end of the IIFE"); throw new Error("no IIFE"); }
var harness = body.slice(0, cut) + EXPORT + body.slice(cut);
try {
  (new Function("globalThis","window","document","location","fetch","PPConfig","URLSearchParams", harness))
    (g, g, g.document, g.location, g.fetch, g.PPConfig, g.URLSearchParams);
} catch (e) { print("LOAD FAILED: " + e); throw e; }

var A = g.__A;   // NOT globalThis: the harness passes its own object in under that name
var pass = 0, fail = 0;
function ok(c, m){ if(c) pass++; else { fail++; print("  FAIL  " + m); } }

print("== the album page ==");

/* THE ONE THAT WAS WRONG, to the hour. The album is deleted at 21:51 local on
   15 October; it is read at 11:09 local on 15 September. Math.ceil said 31. */
var LATE  = "2026-10-15T11:51:44.089+00:00";              // 21:51 Brisbane
var READ  = Date.parse("2026-09-15T01:09:34.585Z");       // 11:09 Brisbane, same zone
ok(A.albumDays(LATE, READ) === 30,
   "15 Sep to 15 Oct is 30 days, got " + A.albumDays(LATE, READ));

/* And it has to keep agreeing with the date printed beside it, whatever the clock says. */
ok(A.albumDays("2026-09-16T00:01:00+10:00", Date.parse("2026-09-15T23:59:00+10:00")) === 1,
   "two minutes apart across midnight is one day, got " +
   A.albumDays("2026-09-16T00:01:00+10:00", Date.parse("2026-09-15T23:59:00+10:00")));
ok(A.albumDays("2026-09-15T23:59:00+10:00", Date.parse("2026-09-15T00:01:00+10:00")) === 0,
   "the same day is today, however many hours are left in it, got " +
   A.albumDays("2026-09-15T23:59:00+10:00", Date.parse("2026-09-15T00:01:00+10:00")));
ok(A.albumDays("not a date", READ) === null, "a date that will not parse says nothing");

/* Daylight saving. Brisbane has none but the guest opening the link might not be in
   Brisbane, and a 23 hour day must not read as 0 days or a 25 hour one as 2. */
ok(A.albumDays("2026-10-05T12:00:00+11:00", Date.parse("2026-10-04T12:00:00+10:00")) === 1,
   "a day that is 23 hours long is still one day, got " +
   A.albumDays("2026-10-05T12:00:00+11:00", Date.parse("2026-10-04T12:00:00+10:00")));

print("== what is in the album, said out loud ==");
var one = A.albumCount(1, [{}]);
ok(one.indexOf("1 photo in here") === 0, "one photo is a photo, not a thing: " + one);
ok(one.indexOf("Tap it") >= 0 && one.indexOf("any of them") < 0,
   "and there is only one of them to tap: " + one);

var many = A.albumCount(12, [{},{},{}]);
ok(many.indexOf("12 photos in here") === 0, "more than one is photos: " + many);
ok(many.indexOf("any of them") >= 0, "and more than one is any of them: " + many);

var clip = A.albumCount(1, [{video:true}]);
ok(clip.indexOf("1 clip in here") === 0, "a video on its own is a clip: " + clip);
var clips = A.albumCount(3, [{video:true},{video:true},{video:true}]);
ok(clips.indexOf("3 clips in here") === 0, "all videos are clips: " + clips);
var mixed = A.albumCount(3, [{video:true},{},{}]);
ok(mixed.indexOf("3 photos and clips in here") === 0, "a mix says both: " + mixed);

ok(A.albumCount(2, null).indexOf("2 photos in here") === 0,
   "no list at all does not throw and reads as photos");

print("");
print(fail ? "FAILED " + fail + " of " + (pass+fail) : "ALL " + pass + " CHECKS PASSED");
