var m={exports:{}};
(new Function("module","globalThis", readFile("/Users/dean.tindale/partyplay/lib/pp-ticket.js")))(m, this);
var T=m.exports;
var pass=0, fail=0;
function ok(c,msg){ if(c) pass++; else { fail++; print("  FAIL  "+msg); } }

print("== ticket shape, across 400 tokens ==");
var badRow=0, badCol=0, badCount=0, badRange=0, badOrder=0, dupes=0;
for (var i=0;i<400;i++){
  var g = T.build("token-"+i);
  ok(g.length===3, "3 rows");
  var nums = T.numbersOf(g);
  if (nums.length!==15) badCount++;
  var seen={}; nums.forEach(function(n){ if(seen[n]) dupes++; seen[n]=1; });
  g.forEach(function(row){ if(row.filter(Boolean).length!==5) badRow++; });
  for (var c=0;c<9;c++){
    var col=[g[0][c],g[1][c],g[2][c]].filter(Boolean);
    if(col.length<1||col.length>3) badCol++;
    var r=T.colRange(c);
    col.forEach(function(n){ if(n<r.lo||n>r.hi) badRange++; });
    for(var k=1;k<col.length;k++) if(col[k]<=col[k-1]) badOrder++;
  }
}
ok(badCount===0, badCount+" tickets did not have exactly 15 numbers");
ok(badRow===0,   badRow+" rows did not have exactly 5 numbers");
ok(badCol===0,   badCol+" columns had fewer than 1 or more than 3");
ok(badRange===0, badRange+" numbers were outside their column range");
ok(badOrder===0, badOrder+" columns were not in ascending order");
ok(dupes===0,    dupes+" duplicate numbers on a ticket");

print("== deterministic ==");
var a=JSON.stringify(T.build("same-token")), b=JSON.stringify(T.build("same-token"));
ok(a===b, "same token gives the same ticket, so a reload does not lose the card");
ok(JSON.stringify(T.build("other"))!==a, "different tokens give different tickets");

print("== spread ==");
var uniq={}; for(i=0;i<300;i++) uniq[JSON.stringify(T.build("t"+i))]=1;
ok(Object.keys(uniq).length>=295, "300 tokens gave "+Object.keys(uniq).length+" distinct tickets");

print("== progress ==");
var g2=T.build("progress-check"), all=T.numbersOf(g2);
var p0=T.progress(g2,[]);
ok(p0.fullHouseNeeds===15 && !p0.hasLine, "nothing called: 15 to go, no line");
var firstRow=g2[0].filter(Boolean);
var p1=T.progress(g2,firstRow);
ok(p1.hasLine, "a full row counts as a line");
ok(p1.bestLineNeeds===0, "best line needs 0");
var p2=T.progress(g2, firstRow.slice(0,4));
ok(p2.bestLineNeeds===1, "four of five is one away, got "+p2.bestLineNeeds);
ok(p2.bestLineMissing.length===1 && p2.bestLineMissing[0]===firstRow[4], "it names the number still needed");
var p3=T.progress(g2, all);
ok(p3.fullHouse && p3.fullHouseNeeds===0, "everything called is a full house");

print("\n"+(fail? "FAILED "+fail+" of "+(pass+fail) : "ALL "+pass+" CHECKS PASSED"));
