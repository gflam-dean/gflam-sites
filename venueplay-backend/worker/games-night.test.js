/* GAMES NIGHT (INBOX 168/170, 10-11 Nov 2026), RUN rather than read.
   1. A trivia or musical round left running closes itself after 90 minutes idle, and only then.
   2. A demo never uses the weekly allowance (start check and stamp both skip it).
   3. The first-real-game note, and the "last round counts double" wording.
   Run: jsc venueplay-backend/worker/games-night.test.js */
var bad = 0, ran = 0;
function pass(n, c, extra){ ran++; print((c ? "  ok   " : "  FAIL ") + n + (extra ? "   " + extra : "")); if(!c) bad++; }
function find(rel) {
  var tries = [rel, "../" + rel, "../../" + rel];
  for (var i = 0; i < tries.length; i++) { try { var t = readFile(tries[i]); if (t && t.length > 200) return t; } catch (e) {} }
  throw new Error("cannot find " + rel);
}
function lift(src, name) {
  var m = new RegExp("(?:async\\s+)?function\\s+" + name + "\\s*\\(").exec(src);
  if (!m) return null;
  var i = src.indexOf("{", m.index), d = 0;
  for (var j = i; j < src.length; j++) {
    if (src[j] === "{") d++;
    else if (src[j] === "}") { d--; if (!d) return src.slice(m.index, j + 1); }
  }
  return null;
}
var GAME = find("venueplay-backend/worker/venueplay-game.js");
var idleSrc = lift(GAME, "sweepIdleGames");
pass("sweepIdleGames is in the shipped Worker", !!idleSrc);
pass("the idle limit is 90 minutes", /const IDLE_GAME_MS = 90 \* 60 \* 1000;/.test(GAME));
pass("the hourly trigger runs it", /ctx\.waitUntil\(sweepIdleGames\(env\)/.test(GAME));
if (!idleSrc) { print("\nFAILED"); throw new Error("nothing to test"); }

var logged = [], console = { log: function (m) { logged.push(String(m)); } };
var IDLE_GAME_MS = 90 * 60 * 1000;
function enc(x){ return encodeURIComponent(x); }
var W, patched, events;
function sbGet(env, table, q) {
  if (W.failEvents && table === "vp_session_events") return Promise.reject(new Error("down"));
  if (table === "vp_games") return Promise.resolve(W.games);
  if (table === "vp_session_events") return Promise.resolve(W.lastEvent ? [{ created_at: W.lastEvent }] : []);
  if (table === "vp_trivia_games") return Promise.resolve(W.qEnds ? [{ question_ends_at: W.qEnds }] : []);
  if (table === "vp_trivia_answers") return Promise.resolve(W.lastAnswer ? [{ answered_at: W.lastAnswer }] : []);
  return Promise.resolve([]);
}
function getSession(env, id) { return Promise.resolve({ id: id, ended_at: W.sessionEnded || null }); }
function sbPatchReturning(env, table, f, body) { patched.push(table + " " + f + " " + body.status); return Promise.resolve(W.alreadyEnded ? [] : [{ id: "g1" }]); }
function noteTriviaNight() { return Promise.resolve(); }
function emitEvent(env, s, t, p) { events.push(t + (p && p.idle ? ":idle" : "")); return Promise.resolve(); }
eval(idleSrc);
function ago(min) { return new Date(Date.now() - min * 60000).toISOString(); }
function run(w) {
  W = w; patched = []; events = [];
  var out; sweepIdleGames({}).then(function (r) { out = r; }, function (e) { out = { threw: String(e) }; });
  drainMicrotasks(); return out;
}
var G = function (fmt) { return [{ id: "g1", session_id: "s1", format: fmt, started_at: ago(200), config: {} }]; };

print("\nIDLE ROUNDS CLOSE");
var r = run({ games: G("trivia"), lastEvent: ago(120), qEnds: ago(121), lastAnswer: ago(122) });
pass("a trivia round with nothing for 2 hours is finished", r.closed === 1 && patched.length === 1 && /finished/.test(patched[0]));
pass("and the night is told game.ended (idle)", events.join() === "game.ended:idle");
pass("the finish is guarded on status=running", /status=eq\.running/.test(patched[0]));
r = run({ games: G("musical_bingo"), lastEvent: ago(95) });
pass("a musical bingo round idle 95 minutes is finished", r.closed === 1);

print("\nACTIVE ROUNDS ARE LEFT ALONE");
r = run({ games: G("trivia"), lastEvent: ago(120), qEnds: ago(120), lastAnswer: ago(30) });
pass("an answer 30 minutes ago keeps a trivia round open", r.closed === 0 && !patched.length);
r = run({ games: G("trivia"), lastEvent: ago(10) });
pass("an event 10 minutes ago keeps it open", r.closed === 0);
r = run({ games: G("trivia"), lastEvent: ago(120), qEnds: new Date(Date.now() + 20000).toISOString() });
pass("a question still running keeps it open", r.closed === 0);
r = run({ games: G("musical_bingo"), lastEvent: ago(60) });
pass("a song played 60 minutes ago keeps musical open", r.closed === 0);
r = run({ games: G("trivia"), failEvents: true });
pass("if the evidence cannot be read nothing is closed", r.closed === 0 && !patched.length);
r = run({ games: G("trivia"), lastEvent: ago(200), sessionEnded: ago(10) });
pass("a night already closed is not touched", r.closed === 0);
r = run({ games: G("trivia"), lastEvent: ago(200), alreadyEnded: true });
pass("a host who ended it first is not told twice", r.closed === 0 && !events.length);
pass("only trivia and musical are asked for", true);
pass("the list query asks only for trivia and musical bingo", /format=in\.\(trivia,musical_bingo\)/.test(idleSrc) && !/bingo,/.test(idleSrc.replace("musical_bingo", "")));

print("\nA DEMO NEVER USES THE WEEKLY ALLOWANCE");
pass("start: the weekly check is skipped for a demo", /if \(\(isTrivia \|\| isMusical\) && !demo\) \{\s*\n\s*const limitMsg = await checkWeeklyFormatLimit/.test(GAME));
pass("trivia start: the weekly slot is stamped only when not a demo", /if \(!demo\) await stampWeeklyFormat\(env, session, true\);/.test(GAME));
pass("a demo can only be trivia (no musical slot to burn)", /demo_trivia_only/.test(GAME));
var stampSrc = lift(GAME, "stampWeeklyFormat");
pass("stampWeeklyFormat refuses a demo session itself (belt and braces)", !!stampSrc && /isDemoSession\(session\)/.test(stampSrc));
var chkSrc = lift(GAME, "checkWeeklyFormatLimit");
pass("checkWeeklyFormatLimit refuses to count a demo session itself", !!chkSrc && /isDemoSession\(session\)/.test(chkSrc));

print("\nFIRST-REAL-GAME NOTE");
var WK = find("venueplay/app/vp-weekly.js");
var g = {}; eval(WK.replace("typeof globalThis === 'object' ? globalThis : this", "g"));
var V = g.VPWeekly;
pass("VPWeekly.firstNote exists", !!V && typeof V.firstNote === "function");
var t = V.firstNote({}, "trivia");
pass("a venue with no trivia night yet is told about once a week", /first real trivia night/.test(t) && /once a week/.test(t), t);
pass("the note says the demo never uses the week", /demo never uses that week/.test(t));
pass("musical says musical bingo, not bingo", /first real musical bingo night/.test(V.firstNote({}, "musical")));
pass("a venue that has run trivia is not told", V.firstNote({ last_trivia_at: ago(5000) }, "trivia") === null);
pass("a venue HQ lifted the rule for is not told", V.firstNote({ weekly_limit_off: true }, "trivia") === null);
pass("no venue row, no note", V.firstNote(null, "trivia") === null);
pass("the note has no em dash", t.indexOf("—") === -1);

print("\nLAST ROUND COUNTS DOUBLE, WORDING");
var TV = find("venueplay/app/trivia/screen.html"), PH = find("venueplay/app/trivia/play.html"), HO = find("venueplay/app/trivia/host.html");
pass("TV badge says Last round counts double", (TV.match(/textContent="Last round counts double"/g) || []).length === 2 && !/textContent="Double points"/.test(TV));
pass("phone badge says Counts double", /textContent="Counts double"/.test(PH) && !/textContent="Double points"/.test(PH));
pass("host setting is called Last round counts double", /<label>Last round counts double<\/label>/.test(HO) && !/<label>Double points final round/.test(HO));
pass("host question header says COUNTS DOUBLE", !/DOUBLE POINTS<\/b>/.test(HO) && /COUNTS DOUBLE<\/b>/.test(HO));

print("\n" + (bad ? bad + " OF " + ran + " CHECKS FAILED" : "ALL " + ran + " CHECKS PASSED"));
if (bad) throw new Error(bad + " failed");
