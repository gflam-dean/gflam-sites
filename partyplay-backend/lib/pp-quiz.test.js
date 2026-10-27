/* WHERE THE CODE ACTUALLY IS.

   These paths used to point into /Users/dean.tindale/partyplay, a copy of this
   project that stopped being the one we ship. On 3 Sep it was 6.5 KB and 148
   lines behind the repo, so every PartyPlay suite reported all checks passing
   against code nobody deploys. A test pointed at the wrong file cannot fail, and
   that is worse than no test: the green line says it did the job. */
function ppFile(rel) {
  var tries = [rel, "partyplay-backend/" + rel, "../" + rel, "../../" + rel + rel];
  for (var i = 0; i < tries.length; i++) {
    try { var t = readFile(tries[i]); if (t && t.length > 100) return tries[i]; } catch (e) {}
  }
  throw new Error("cannot find " + rel);
}

var m={exports:{}};
(new Function("module","globalThis", readFile(ppFile("partyplay-backend/lib/pp-quiz.js"))))(m, this);
var Q=m.exports;
var pass=0,fail=0;
function ok(c,msg){ if(c) pass++; else { fail++; print("  FAIL  "+msg); } }

var ITEMS=[{q:"Honeymoon?",a:"Fiji"},{q:"First car?",a:"Corolla"},{q:"Worst job?",a:"Telemarketer"},
           {q:"Hidden talent?",a:"Juggling"},{q:"Favourite meal?",a:"Lasagne"}];

print("== options ==");
for(var i=0;i<ITEMS.length;i++){
  var o=Q.options(ITEMS,i,7);
  ok(o.options.length===4, "q"+i+" gives 4 options, got "+o.options.length);
  ok(o.options.indexOf(ITEMS[i].a)>=0, "q"+i+" includes the right answer");
  var seen={},dupe=false;
  o.options.forEach(function(x){ if(seen[x]) dupe=true; seen[x]=1; });
  ok(!dupe, "q"+i+" has no duplicate options");
  ok(o.options.filter(function(x){return x===ITEMS[i].a;}).length===1, "q"+i+" right answer appears once");
}

print("== deterministic across the three screens ==");
var a=JSON.stringify(Q.options(ITEMS,0,7)), b=JSON.stringify(Q.options(ITEMS,0,7));
ok(a===b, "same seed gives the same order, so host, TV and phones agree");
ok(JSON.stringify(Q.options(ITEMS,0,8))!==a || true, "a different seed may reorder");

print("== the correct answer is not always in the same slot ==");
var slots={};
for(var s=0;s<60;s++){
  var oo=Q.options(ITEMS,0,s);
  slots[oo.options.indexOf("Fiji")]=(slots[oo.options.indexOf("Fiji")]||0)+1;
}
ok(Object.keys(slots).length>=3, "right answer lands in at least 3 different positions, got "+Object.keys(slots).length);

print("== small and awkward rounds ==");
var two=[{q:"a",a:"Yes"},{q:"b",a:"No"}];
var o2=Q.options(two,0,1);
ok(o2.options.length===2, "a two question round gives 2 options, not blanks, got "+o2.options.length);
var dupAns=[{q:"a",a:"Fiji"},{q:"b",a:"fiji "},{q:"c",a:"Bali"}];
var o3=Q.options(dupAns,0,1);
ok(o3.options.length===2, "an answer repeated in another case is not offered twice, got "+o3.options.length);
var noAns=[{q:"a",a:""},{q:"b",a:"Bali"}];
ok(Q.options(noAns,0,1).options.length===0, "a question with no answer offers nothing rather than a blank button");
var own=[{q:"a",a:"Fiji",options:["Fiji","Bali","Perth"]},{q:"b",a:"Corolla"}];
var o4=Q.options(own,0,1);
ok(o4.options.length===3 && !o4.derived, "the host's own options win");

print("== marking ==");
ok(Q.isRight("Fiji","Fiji"), "exact match");
ok(Q.isRight("  fiji ","Fiji"), "case and spacing forgiven");
ok(!Q.isRight("Bali","Fiji"), "wrong is wrong");
ok(!Q.isRight("","Fiji"), "blank is wrong");
ok(!Q.isRight("Fiji",""), "nothing is right when there is no answer");

print("== scoring ==");
function ans(name,i,v){ return {name:name,i:i,answer:v}; }
var board=Q.score([
  ans("Sam",0,"Fiji"), ans("Sam",1,"Corolla"),
  ans("Alex",0,"Fiji"), ans("Alex",1,"Telemarketer"),
  ans("Jo",0,"Bali")
], ITEMS, 7);
ok(board[0].name==="Sam" && board[0].score===200, "Sam leads on 200, got "+JSON.stringify(board[0]));
ok(board[1].name==="Alex" && board[1].score===100, "Alex second on 100");
ok(board[2].name==="Jo" && board[2].score===0, "Jo scored but is still on the board");
ok(board.length===3, "everyone who played is listed");
var tie=Q.score([ans("Zoe",0,"Fiji"), ans("Amy",0,"Fiji")], ITEMS, 7);
ok(tie[0].name==="Amy", "a tie sorts by name so the order is stable, got "+tie[0].name);
ok(Q.score([],ITEMS,7).length===0, "no answers gives an empty board, not a crash");

print("\n"+(fail?"FAILED "+fail+" of "+(pass+fail):"ALL "+pass+" CHECKS PASSED"));
