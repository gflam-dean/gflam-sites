/* WHERE THE CODE ACTUALLY IS.

   These paths used to point into /Users/dean.tindale/partyplay, a copy of this
   project that stopped being the one we ship. On 3 Sep it was 6.5 KB and 148
   lines behind the repo, so every PartyPlay suite reported all checks passing
   against code nobody deploys. A test pointed at the wrong file cannot fail, and
   that is worse than no test: the green line says it did the job. */
function ppFile(rel) {
  var tries = [rel, "partyplay-backend/" + rel, "../" + rel, "../../" + rel,
               "/Users/dean.tindale/gflam-sites-current/" + rel];
  for (var i = 0; i < tries.length; i++) {
    try { var t = readFile(tries[i]); if (t && t.length > 100) return tries[i]; } catch (e) {}
  }
  throw new Error("cannot find " + rel);
}

var m={exports:{}};
(new Function("module","globalThis", readFile(ppFile("partyplay-backend/lib/pp-video.js"))))(m, this);
var V=m.exports;
var pass=0,fail=0;
function ok(c,msg){ if(c) pass++; else { fail++; print("  FAIL  "+msg); } }

print("== the size, which is the whole reason for the design ==");
var clip = V.estimateBytes(30);
ok(clip < 11*1024*1024, "30s at 720p stays under 11 MB, got "+(clip/1048576).toFixed(1)+" MB");
ok(clip > 6*1024*1024, "and is not so compressed it looks awful, got "+(clip/1048576).toFixed(1)+" MB");
var thirty1080 = V.estimateBytes(30, 8000000, 128000);
ok(thirty1080 > 3*clip, "the same 30s at 1080p would be "+(thirty1080/1048576).toFixed(0)+
   " MB, over 3x, which is why the resolution is capped and not the length");
print("  30s at 720p : " + (clip/1048576).toFixed(1) + " MB   <- what we record");
print("  30s at 1080p: " + (thirty1080/1048576).toFixed(0) + " MB  (not built, on purpose)");

print("== a party's worth ==");
var hundred = 100*10*clip;
ok(hundred/1073741824 < 15, "100 parties, 10 clips each = "+(hundred/1073741824).toFixed(1)+" GB");
print("  10 clips x 100 parties: " + (hundred/1073741824).toFixed(1) + " GB");
print("  same at 30s 1080p     : " + (100*10*thirty1080/1073741824).toFixed(0) + " GB");

print("== limits line up with the Worker ==");
ok(V.MAX_SECONDS===30, "capped at 30 seconds");
ok(V.TARGET_HEIGHT===720, "720p");
ok(V.HARD_LIMIT===25*1024*1024, "hard limit 25 MB, well over a real clip but a real backstop");
ok(V.HARD_LIMIT > clip*2, "the backstop is far enough above a real clip to never fire by accident");

print("== container ==");
ok(V.extFor("video/mp4;codecs=avc1")==="mp4", "Safari gives mp4");
ok(V.extFor("video/webm;codecs=vp9,opus")==="webm", "Chrome gives webm");
ok(V.extFor("")==="webm", "an unknown type falls back to webm rather than nothing");
ok(V.pickMime([])==="" , "no MediaRecorder here, so it reports none rather than guessing");
ok(V.supported()===false, "and supported() is honest about it in this environment");

print("== camera constraints ==");
var c=V.constraints();
ok(c.audio===true, "audio on: it is a message, not a silent film");
ok(c.video.height.ideal===720, "asks for 720");
ok(c.video.width.ideal===1280, "16:9, got "+c.video.width.ideal);
ok(c.video.frameRate.max===30, "caps the frame rate, since 60fps doubles the size for nothing");
ok(V.constraints("environment").video.facingMode==="environment", "can face outward too");
ok(V.constraints().video.facingMode==="user", "but defaults to selfie, which is what a message is");

print("== wording ==");
ok(V.niceSeconds(1)==="1 second", "singular");
ok(V.niceSeconds(30)==="30 seconds", "plural");

print("\n"+(fail?"FAILED "+fail+" of "+(pass+fail):"ALL "+pass+" CHECKS PASSED"));
