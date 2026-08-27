var m={exports:{}};
(new Function("module","globalThis", readFile("/Users/dean.tindale/partyplay/lib/pp-photo.js")))(m, this);
var P=m.exports;
var pass=0,fail=0;
function ok(c,msg){ if(c) pass++; else { fail++; print("  FAIL  "+msg); } }

print("== resizing keeps the shape ==");
var cases=[[4032,3024,"landscape phone"],[3024,4032,"portrait phone"],[1200,900,"already small"],
           [6000,4000,"a real camera"],[1000,4000,"a panorama"],[1600,1600,"exactly at the limit"]];
cases.forEach(function(c){
  var t=P.targetSize(c[0],c[1]);
  ok(Math.max(t.w,t.h)<=P.MAX_EDGE, c[2]+": long edge within 1600, got "+t.w+"x"+t.h);
  var before=c[0]/c[1], after=t.w/t.h;
  ok(Math.abs(before-after)<0.01, c[2]+": aspect ratio kept ("+before.toFixed(3)+" vs "+after.toFixed(3)+")");
  ok(t.w>0 && t.h>0, c[2]+": no zero dimension");
});
ok(!P.targetSize(1200,900).scaled, "a small photo is left alone");
ok(P.targetSize(4032,3024).scaled, "a big photo is marked as scaled");
ok(P.targetSize(1600,1200).scaled===false, "exactly 1600 is not scaled again");

print("== the numbers that make this worth doing ==");
var t=P.targetSize(4032,3024);
ok(t.w===1600 && t.h===1200, "a 12MP phone photo becomes 1600x1200, got "+t.w+"x"+t.h);
var pixelsBefore=4032*3024, pixelsAfter=t.w*t.h;
ok(pixelsAfter/pixelsBefore < 0.17, "that is "+(100*pixelsAfter/pixelsBefore).toFixed(0)+"% of the pixels");

print("== sizes read like sizes ==");
ok(P.niceSize(512)==="512 B", "bytes");
ok(P.niceSize(307200)==="300 KB", "kilobytes, got "+P.niceSize(307200));
ok(P.niceSize(3355443)==="3.2 MB", "megabytes, got "+P.niceSize(3355443));

print("== refuses what it should ==");
ok(P.HARD_LIMIT===5*1024*1024, "hard limit is 5 MB, matching the Worker");
var threw=false;
P.shrink(null).catch(function(e){ threw=true;
  ok(/not a photo/i.test(e.message), "a non-photo is refused in words, got: "+e.message);
  print("\n"+(fail?"FAILED "+fail+" of "+(pass+fail):"ALL "+pass+" CHECKS PASSED"));
});
