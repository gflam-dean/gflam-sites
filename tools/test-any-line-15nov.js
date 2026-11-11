/* MUSICAL BINGO "ANY LINE" (Dean, 11 Nov 2026, INBOX 256), RUN, not read.

   On The Mini Bar Dean finished the right-hand COLUMN on "One line across" and expected a win. "One line" is rows
   only, so he chose a new pattern, "Any line": a full row, column or diagonal. It is the default for NEW venues;
   existing venues keep theirs (migration 186 writes each venue's pattern down first). The label is "Any line" on
   the player phone; the host console and the TV say "Any line (across, down or diagonal)".

   Every place that judges the pattern must agree: the Worker's checkMusicPattern (the claim, the paper card check),
   the phone's own checkPattern (it decides whether the claim is even sent), and the phone's markedPattern (the faint
   or bright "I've got a line" button) and its outlines. Each is lifted out of the file that ships and run.

   256.2 (a fully ticked 2nd row looked faint): the suspicion was index 12 always counting as marked when the centre
   is a real song. Every card is dealt by generateMusicCard with a FREE centre (0 at index 12), and the 2nd row is
   squares 5 to 9, which does not include 12; both are pinned below.

   MUSICAL BINGO IS NOT BINGO: its own game, never restricted.

   Run: jsc tools/test-any-line-15nov.js   (from the repo root) */
var bad = 0, ran = 0;
function pass(n, c, why){ ran++; print((c ? "  ok   " : "  FAIL ") + n + (c || why === undefined ? "" : "   saw: " + why)); if(!c) bad++; }
var W = readFile("venueplay-backend/worker/venueplay-game.js");
var PLAY = readFile("venueplay/app/musical/play.html");
var HOST = readFile("venueplay/app/musical/host.html");
var SCREEN = readFile("venueplay/app/musical/screen.html");
var MIG = (function(){ try { return readFile("venueplay-backend/supabase/venueplay-186-musical-any-line.sql"); } catch(e){ return ""; } })();
function grab(name, src){
  var i = src.indexOf("function " + name + "(");
  if (i < 0) return "function " + name + "(){ throw new Error('missing " + name + "'); }";
  var depth = 0, started = false;
  for (var j = i; j < src.length; j++){
    if (src[j] === "{"){ depth++; started = true; }
    else if (src[j] === "}"){ depth--; if (started && depth === 0) return src.slice(i, j + 1); }
  }
  throw new Error("unclosed " + name);
}
/* a `var X = {...};` or `const X = (...)();` statement, by its name, to the first ";" at depth 0 */
function grabVar(kw, name, src){
  var i = src.indexOf(kw + " " + name + "=");
  if (i < 0) i = src.indexOf(kw + " " + name + " =");
  if (i < 0) return "";
  var depth = 0;
  for (var j = i; j < src.length; j++){
    var ch = src[j];
    if (ch === "{" || ch === "(" || ch === "[") depth++;
    else if (ch === "}" || ch === ")" || ch === "]") depth--;
    else if (ch === ";" && depth === 0) return src.slice(i, j + 1);
  }
  return "";
}
function lit(kw, name, src){ var s = grabVar(kw, name, src); if (!s) return {}; return new Function(s + "\nreturn " + name + ";")(); }

/* ---- the Worker ---- */
var workerCheck = new Function(grabVar("const", "MUSIC_ANY_LINES", W) + "\n" + grab("checkMusicPattern", W) + "\nreturn checkMusicPattern;")();
var genCard = new Function("randInt", grab("generateMusicCard", W) + "\nreturn generateMusicCard;")(function(n){ return 0; });
var SONGS = []; for (var s = 0; s < 30; s++) SONGS.push({ id: "s" + s, title: "Song " + s });
var CARD = genCard(SONGS);
function idsAt(idx){ var out = []; idx.forEach(function(i){ if (i !== 12) out.push(CARD[i].song_id); }); return out; }
function played(idx){ return new Set(idsAt(idx)); }

var RIGHT_COL = [4, 9, 14, 19, 24], ROW2 = [5, 6, 7, 8, 9], COL3 = [2, 7, 12, 17, 22], DIAG = [0, 6, 12, 18, 24], ANTI = [4, 8, 12, 16, 20];

print("\n1. THE WORKER: checkMusicPattern('any_line')");
var r = workerCheck("any_line", CARD, played(RIGHT_COL));
pass("the right-hand COLUMN complete is a win (Dean's card on The Mini Bar)", r.valid === true && String(r.cells) === String(RIGHT_COL), JSON.stringify(r));
r = workerCheck("any_line", CARD, played(ROW2));
pass("the 2nd ROW complete is a win", r.valid === true && String(r.cells) === String(ROW2), JSON.stringify(r));
r = workerCheck("any_line", CARD, played(DIAG));
pass("the diagonal top-left to bottom-right, through the FREE centre, is a win", r.valid === true && String(r.cells) === String(DIAG), JSON.stringify(r));
r = workerCheck("any_line", CARD, played(ANTI));
pass("the other diagonal, through the FREE centre, is a win", r.valid === true && String(r.cells) === String(ANTI), JSON.stringify(r));
r = workerCheck("any_line", CARD, played(COL3));
pass("the middle column (FREE centre in it) is a win with its 4 songs", r.valid === true, JSON.stringify(r));
r = workerCheck("any_line", CARD, played([4, 9, 14, 19]));
pass("four of the right-hand column is not a win", r.valid === false, JSON.stringify(r));
r = workerCheck("any_line", CARD, played([0, 6, 18]));
pass("three of a diagonal plus the FREE centre is not a win", r.valid === false, JSON.stringify(r));
r = workerCheck("any_line", CARD, played([0, 1, 2, 3, 9, 14, 19, 24, 20, 16]));
pass("an L and a broken diagonal are not a win", r.valid === false, JSON.stringify(r));
r = workerCheck("one_line", CARD, played(RIGHT_COL));
pass("'One line across' stays rows only: the right-hand column is NOT a win there (existing venues unchanged)", r.valid === false, JSON.stringify(r));
r = workerCheck("one_line", CARD, played(ROW2));
pass("'One line across': the 2nd row still wins", r.valid === true, JSON.stringify(r));
r = workerCheck("two_lines", CARD, played(RIGHT_COL.concat([0, 5, 10, 15, 20])));
pass("'Two lines' stays rows only: two full columns are not two lines", r.valid === false, JSON.stringify(r));
r = workerCheck("any_line", CARD.map(function(c, i){ return (i === 2 || i === 22) ? { s: c.song_id, t: c.title } : c; }), played(COL3));
pass("the compact {s,t} square shape is read the same for Any line", r.valid === true, JSON.stringify(r));

print("\n2. THE CENTRE (256.2)");
pass("every card the Worker deals has a FREE centre (0 at index 12)", CARD[12] === 0 && typeof CARD[11] === "object" && typeof CARD[13] === "object", JSON.stringify(CARD[12]));
pass("Dean's 2nd row is squares 5 to 9: the centre is not in it, so a centre rule cannot make it faint", ROW2.indexOf(12) < 0);
var realCentre = CARD.slice(); realCentre[12] = { song_id: "sC", title: "Centre song" };
r = workerCheck("any_line", realCentre, played(ROW2));
pass("even with a real song in the centre, the 2nd row is judged on its own 5 songs", r.valid === true, JSON.stringify(r));

/* ---- the phone ---- */
var PHONE_FNS = ["cellTitle", "cellId", "playedSet", "isCovered", "checkPattern", "rowMarks", "lineMarks", "anyLine", "markedPattern", "lineRows"].map(function(n){ return grab(n, PLAY); }).join("\n");
var phone = new Function("P", grabVar("var", "ANY_LINES", PLAY) + "\n" + PHONE_FNS +
  "\nreturn { check: checkPattern, marked: markedPattern, any: (typeof anyLine === 'function') ? anyLine : null };");
function phoneFor(pattern, daubIdx, playedIdx){
  var P = { cells: CARD, pattern: pattern, daubs: { 12: true }, played: [], playedIds: [] };
  daubIdx.forEach(function(i){ P.daubs[i] = true; });
  (playedIdx || []).forEach(function(i){ if (i !== 12){ P.played.push(CARD[i].title); P.playedIds.push(CARD[i].song_id); } });
  return phone(P);
}
print("\n3. THE PHONE: the button is bright when the marks make Any line, and the claim is sent");
var f = phoneFor("any", RIGHT_COL, RIGHT_COL);
pass("right-hand column ticked: 'I've got a line' is BRIGHT (markedPattern)", f.marked() === true);
pass("right-hand column played: the phone sends the claim (checkPattern)", f.check() === true);
f = phoneFor("any", ROW2, ROW2);
pass("2nd row ticked: bright, and the claim is sent", f.marked() === true && f.check() === true);
f = phoneFor("any", ANTI, ANTI);
pass("a diagonal ticked: bright, and the claim is sent", f.marked() === true && f.check() === true);
f = phoneFor("any", [4, 9, 14, 19], [4, 9, 14, 19]);
pass("four of a column: still faint, no claim", f.marked() === false && f.check() === false);
f = phoneFor("one", RIGHT_COL, RIGHT_COL);
pass("'One line across': a column stays faint and is not sent (rows only, as the Worker)", f.marked() === false && f.check() === false);
f = phoneFor("one", ROW2, ROW2);
pass("'One line across': the 2nd row ticked is BRIGHT (256.2 not in the code)", f.marked() === true && f.check() === true);
f = phoneFor("any", RIGHT_COL, []);
var al = f.any ? f.any() : null;
pass("the outline on an Any line night goes round the finished column", !!al && al.done === true && String(al.cells) === String(RIGHT_COL), JSON.stringify(al));
f = phoneFor("any", [0, 6, 18], []);
al = f.any ? f.any() : null;
pass("no line yet: the outline is the nearest line, dashed (the diagonal with 4 of 5)", !!al && al.done === false && String(al.cells) === String(DIAG), JSON.stringify(al));

print("\n4. THE WORKER AND THE PHONE AGREE ON EVERY CARD");
(function(){
  var seed = 12345; function rnd(n){ seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; }
  var disagree = 0, wins = 0, cols = 0, first = "";
  for (var t = 0; t < 800; t++){
    var k = 4 + rnd(14), idx = [];
    while (idx.length < k){ var i = rnd(25); if (i !== 12 && idx.indexOf(i) < 0) idx.push(i); }
    var wk = workerCheck("any_line", CARD, played(idx)).valid;
    var ph = phoneFor("any", idx, idx);
    var a = ph.check(), b = ph.marked();
    if (wk) wins++;
    if (wk && !workerCheck("one_line", CARD, played(idx)).valid) cols++;
    if (wk !== a || wk !== b){ disagree++; if (!first) first = JSON.stringify([idx, wk, a, b]); }
  }
  pass("800 cards: the Worker's verdict, the phone's claim check and the bright button all agree", disagree === 0, first);
  pass("and the sample had real Any line wins, some that 'One line across' would not have paid", wins > 20 && cols > 5, [wins, cols]);
})();

print("\n5. EVERY PLACE NAMES IT PLAINLY, AND THE PATTERN TRAVELS");
var PN_PHONE = lit("var", "PATTERN_NAMES", PLAY), PN_HOST = lit("var", "PATTERN_NAMES", HOST), PN_TV = lit("var", "PATTERN_NAMES", SCREEN);
pass("the phone says just 'Any line'", PN_PHONE.any === "Any line", PN_PHONE.any);
pass("the host console says 'Any line (across, down or diagonal)'", PN_HOST.any === "Any line (across, down or diagonal)", PN_HOST.any);
pass("the TV says 'Any line (across, down or diagonal)'", PN_TV.any === "Any line (across, down or diagonal)", PN_TV.any);
pass("the TV's sentence: 'Any line wins ...'", lit("var", "PATTERN_SHORT", SCREEN).any === "Any line");
pass("the TV's claim line names a line, never bingo", lit("var", "CLAIM_EYE", SCREEN).any === "Someone has a line");
pass("the phone's claim button says 'I've got a line'", lit("var", "CLAIM_WORDS", PLAY).any === "I've got a line");
pass("'One line across' keeps its name everywhere", PN_PHONE.one === "One line across" && PN_HOST.one === "One line across" && PN_TV.one === "One line across");
pass("console 'any' goes to the Worker as 'any_line'", lit("var", "PAT_TO_WORKER", HOST).any === "any_line");
pass("the Worker's 'any_line' comes back to the console as 'any' (a reload mid-game)", lit("var", "WORKER_TO_PAT", HOST).any_line === "any");
pass("and to the phone as 'any'", lit("var", "PAT_FROM_WORKER", PLAY).any_line === "any");
(function(){
  var m = W.match(/async function hostStartMusical[\s\S]*?const patternMap = (\{[\s\S]*?\});/), m2 = W.match(/async function handleMusicPattern[\s\S]*?const patternMap = (\{[\s\S]*?\});/);
  var a = m ? new Function("return " + m[1])() : {}, b = m2 ? new Function("return " + m2[1])() : {};
  pass("the Worker starts an 'any' game as 'any_line' (and keeps one_line as it was)", a.any === "any_line" && a.any_line === "any_line" && a.one === "one_line", JSON.stringify(a));
  pass("the carry-on route accepts 'any' too", b.any === "any_line" && b.any_line === "any_line", JSON.stringify(b));
  var gp = W.match(/  musical: \{[\s\S]*?pattern:\s+(\(v\) => \(\{[^}]*\}\[v\] \? v : undefined\))/);
  var f2 = gp ? new Function("return " + gp[1])() : function(){};
  pass("the venue's saved setup keeps 'any' (game_prefs)", f2("any") === "any" && f2("one") === "one" && f2("x") === undefined, gp && gp[1]);
})();
(function(){
  var sel = (HOST.match(/<select id="patternSel">([\s\S]*?)<\/select>/) || [])[1] || "";
  var opts = sel.match(/<option[^>]*>[^<]*<\/option>/g) || [];
  pass("the host dropdown offers 'Any line (across, down or diagonal)' FIRST and selected (new venues)", /^<option value="any" selected>Any line \(across, down or diagonal\)<\/option>$/.test(opts[0] || ""), opts[0]);
  pass("and still offers One line, Two lines, Four corners and Full house", /value="one"/.test(sel) && /value="two"/.test(sel) && /value="corners"/.test(sel) && /value="full"/.test(sel));
  var G0 = (HOST.match(/status:"setup", pattern:"(\w+)"/) || [])[1];
  pass("the console's starting pattern matches the dropdown's default", G0 === "any", G0);
  var np = new Function(grab("nextPat", HOST) + grab("nextPatOptions", HOST) + "\nreturn [nextPat('any'), nextPatOptions('any')];")();
  pass("after an Any line win the host can carry on to two lines or a full house", np[0] === "two" && String(np[1]) === "two,full", JSON.stringify(np));
})();

print("\n6. MIGRATION 186: EXISTING VENUES KEEP THEIRS");
var body = MIG.replace(/--[^\n]*/g, "");
var iSnap = body.indexOf("insert into public.vp_backup_186_game_prefs"), iUpd = body.indexOf("update public.vp_venue_settings"), iIns = body.indexOf("insert into public.vp_venue_settings");
pass("the snapshot is taken before any venue is touched", iSnap > 0 && iUpd > iSnap && iIns > iSnap, [iSnap, iUpd, iIns]);
pass("each existing venue gets 'one' written down explicitly (what it plays today)", /'\{"pattern":"one"\}'::jsonb/.test(body) && /'\{"musical":\{"pattern":"one"\}\}'::jsonb/.test(body));
pass("only where no pattern is saved: a venue's own choice is never overwritten", /where coalesce\(s\.game_prefs -> 'musical' ->> 'pattern', ''\) = ''/.test(body));
pass("the musical object is merged, not replaced (other settings and games kept)", /coalesce\(s\.game_prefs -> 'musical', '\{\}'::jsonb\) \|\| '\{"pattern":"one"\}'::jsonb/.test(body));
pass("the snapshot table is locked (RLS on, nothing granted)", /alter table public\.vp_backup_186_game_prefs enable row level security/.test(body) && /revoke all on public\.vp_backup_186_game_prefs from anon, authenticated/.test(body));
pass("vp_music_games.pattern is allowed 'any_line'", /'any_line', 'one_line', 'two_lines', 'four_corners', 'full_house'/.test(body) && /add value if not exists/.test(body));

print("\n" + (ran - bad) + " of " + ran + " checks passed" + (bad ? "  (" + bad + " FAILED)" : ""));
if (bad) throw new Error(bad + " failed");
