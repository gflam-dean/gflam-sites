/* THE REST OF THE 14 OCT PARTYPLAY AUDIT, RUN (15 Oct 2026).

   Each block is one finding, played on the real pages in jsc (tools/rig-partyplay-pages.js:
   run.html, play.html, tv.html, booked.html and unsubscribe.html boot from their own inline script
   on one fake channel against a small fake Worker). The checks read what a person would see.

   Run from the repo root:  jsc partyplay-backend/lib/pp-fixes-15-oct.test.js */
function findUp(rel) {
  var tries = [rel, "../../" + rel, "../" + rel];
  for (var i = 0; i < tries.length; i++) { try { if (readFile(tries[i]).length > 50) return tries[i]; } catch (e) {} }
  throw new Error("cannot find " + rel);
}
load(findUp("tools/rig-fake-webcrypto.js"));
/* Seeded, so a run is repeatable, and kept in 32 bits with Math.imul. It used to multiply in
   floating point, which loses the low bits past 2^53: the stream collapsed to zeros after a few
   hundred draws, every signed nonce came out AAAAAAAAAAAAAAAA, and the second message a phone saw
   after that was dropped as a replay. A telly that says hello more often (18 Oct 2026) moved the
   collapse onto a checked message. mulberry32: */
var __rnd = 11;
crypto.getRandomValues = function (a) { for (var i = 0; i < a.length; i++) { __rnd = (__rnd + 0x6D2B79F5) | 0;
  var t = Math.imul(__rnd ^ (__rnd >>> 15), 1 | __rnd); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; a[i] = (t ^ (t >>> 14)) >>> 0; } return a; };
var window = this;
load(findUp("partyplay/lib/pp-config.js"));
load(findUp("partyplay/lib/pp-ticket.js"));
load(findUp("partyplay/lib/pp-quiz.js"));
load(findUp("partyplay/lib/pp-games.js"));
load(findUp("partyplay/lib/pp-licence.js"));
load(findUp("tools/rig-partyplay-pages.js"));

var ran = 0, bad = 0;
function ok(name, cond, saw) { ran++; if (cond) print("  ok   " + name); else { bad++; print("  FAIL " + name + (saw === undefined ? "" : "   saw: " + String(saw).slice(0, 300))); } }

var CODE = "MPKQZX", HOSTKEY = "hostkey-for-the-fixes-party-0002";
var GAMES = [{ id: "b1", format: "bingo90", title: "", config: {} },
             { id: "t1", format: "trivia", title: "", config: { items: [{ q: "Capital of France?", a: "Paris" }, { q: "2+2?", a: "4" }] } },
             { id: "w1", format: "truths", title: "", config: {} },
             { id: "d1", format: "draw", title: "", config: {} },
             { id: "c1", format: "charades", title: "", config: { items: [{ q: "Titanic" }, { q: "Jaws" }] } },
             { id: "h1", format: "howwell", title: "", config: { items: [{ q: "Her middle name?", a: "Rose" }] } }];
var W = new PPRig.Worker(), room = new PPRig.Room();
W.add(CODE, HOSTKEY, { games: GAMES });
var CH = PPConfig.channel(CODE), party = W.parties[CODE];
var EXPORTS = { exportNames: ["send", "onClaim", "nextBall", "bingoState"],
  extra: "players:function(){ return players; }, G:function(){ return G; }" };
function consoleBoot(store, key) {
  return PPRig.boot("partyplay/run.html", Object.assign({ search: "?code=" + CODE + "&key=" + (key || HOSTKEY), worker: W, room: room,
    name: "console", store: store }, EXPORTS));
}
function phone(name, store) {
  var p = PPRig.boot("partyplay/play.html", { search: "?code=" + CODE, worker: W, room: room, name: name, store: store });
  if (!store) {
    p.dom.get("code").value = CODE; p.dom.get("name").value = name; p.dom.get("email").value = ""; p.dom.get("mkt").checked = false;
    (p.dom.get("go").onclick || []).forEach(function (f) { f(); });
  }
  PPRig.settle(60);
  return p;
}
function tv() { return PPRig.boot("partyplay/tv.html", { search: "?code=" + CODE, worker: W, room: room, name: "tv" }); }
function wall(t) { return t.dom.get("screen").innerHTML; }
function everyone() { room.subscribeAll(); room.flush(); con.timers.run(); room.flush(); }
function paints(p) {      // count every time a phone's screen is redrawn
  var el = p.dom.get("app"), v = el.innerHTML; p.paints = 0;
  Object.defineProperty(el, "innerHTML", { get: function () { return v; }, set: function (x) { v = x; p.paints++; } });
}

var con = consoleBoot();
var alice = phone("Alice"), bob = phone("Bob");
var telly = tv();
everyone();

print("== a telly that wakes up mid-game shows the game, not the lobby (finding 2) ==");
con.dom.tap("", { "data-run": "1" }); con.dom.tap("next"); room.flush();
ok("CONTROL: the telly has the question up", /Capital of France/.test(wall(telly)), wall(telly));
alice.dom.tap("", { "data-opt": "Paris" }); room.flush();
var before = alice.app();
var telly2 = tv(); room.subscribeAll(); room.flush();
ok("a telly that reloads mid-question shows that question, not \"Join the party\"", /Capital of France/.test(wall(telly2)) && !/Join the party/.test(wall(telly2)), wall(telly2));
ok("and what was sent back for it is marked for the telly only", room.log.some(function (l) { return l.from === "console" && l.payload.tvOnly && l.payload.t === "big"; }));
ok("so a guest's locked-in answer on their phone is untouched", alice.app() === before && /Locked in/.test(alice.app()), alice.app());
con.x.send({ t: "lobby", tvOnly: true }); room.flush();
ok("a picture sent again for the telly never moves a phone, even a lobby", /Locked in/.test(alice.app()), alice.app());

print("\n== bingo: a console that reloads and resumes (finding 4) ==");
con.dom.tap("back"); con.dom.tap("", { "data-run": "0" }); room.flush();
con.dom.tap("call"); con.dom.tap("call"); con.dom.tap("call"); room.flush();
var G = con.x.G(), last = G.called[G.called.length - 1];
ok("CONTROL: three balls called, Alice's phone shows the last one", alice.app().indexOf('<div class="n">' + last + '</div>') >= 0, alice.app());
var con2 = consoleBoot(con.store);          // the same tablet, reloaded
everyone();
con2.dom.tap("", { "data-run": "0" }); room.flush();
ok("the reloaded console picks up the same game", con2.x.G().gid === G.gid && con2.x.G().called.length === 3);
ok("and the phones show the ball that is up, not \"--\"", alice.app().indexOf('<div class="n">' + last + '</div>') >= 0 && alice.app().indexOf('<div class="n">--</div>') < 0, alice.app());
var erin = phone("Erin"); everyone();
ok("a guest who walks in mid-bingo sees the ball that is up, not \"--\"", erin.app().indexOf('<div class="n">' + last + '</div>') >= 0, erin.app());
var telly3 = tv(); room.subscribeAll(); room.flush();
ok("a telly that wakes mid-bingo shows the ball that is up", wall(telly3).indexOf(String(last)) >= 0, wall(telly3));
con = con2;

/* Claims are checked against the guest's OWN ticket. */
var tokA = party.players.filter(function (r) { return r.name === "Alice"; })[0].token;
var tokB = party.players.filter(function (r) { return r.name === "Bob"; })[0].token;
var tA = PPTicket.build(tokA), tB = PPTicket.build(tokB);
var lineA = tA[0].filter(Boolean), lineB = tB[1].filter(Boolean);
var notA = []; for (var n = 1; n <= 90 && notA.length < 5; n++) if (PPTicket.numbersOf(tA).indexOf(n) < 0) notA.push(n);
G = con.x.G();
function call(list) { list.forEach(function (x) { if (G.called.indexOf(x) < 0) { G.called.push(x); G.pool.splice(G.pool.indexOf(x), 1); } }); }
call(notA);
ok("a line made of called numbers that are NOT on Alice's ticket is refused", con.x.onClaim("Alice", "line", notA) === "not on their ticket");
call(lineA); con.dom.tap("call"); room.flush();       // the phones hear the calls with the next ball
lineA.forEach(function (x) { alice.dom.tap("", { "data-n": String(x) }); });   // and Alice marks her row
ok("CONTROL: Alice's phone offers her the line", /data-claim="line"/.test(alice.app()), alice.app());
ok("CONTROL: a line that really is on her ticket is announced", con.x.onClaim("Alice", "line", lineA) === "ok");
room.flush();
ok("the caption carries who has the line", room.log.some(function (l) { return l.payload.t === "big" && l.payload.text === "Alice" && l.payload.won && l.payload.won.line[0] === "Alice"; }));
ok("the same guest shouting it again is not announced twice", con.x.onClaim("Alice", "line", lineA) === "already");
call(lineB.slice(0, 4)); con.dom.tap("call"); call(lineB); con.dom.tap("call"); room.flush();
lineB.forEach(function (x) { bob.dom.tap("", { "data-n": String(x) }); });
ok("a second line on a LATER ball is told the line has gone", con.x.onClaim("Bob", "line", lineB) === "line gone");
paints(alice); alice.timers.run(); room.flush();
ok("Alice's phone no longer offers \"Line! Shout out\" for the line she has", !/data-claim="line"/.test(alice.app()), alice.app());
ok("Bob's phone says the line has gone instead of offering it", !/data-claim="line"/.test(bob.app()) && /line has gone to Alice/.test(bob.app()), bob.app());
call(PPTicket.numbersOf(tA));
ok("a full house on her ticket is announced", con.x.onClaim("Alice", "full", PPTicket.numbersOf(tA)) === "ok");
var calledNow = G.called.length;
con.dom.tap("call");
ok("nothing is called after a full house", G.called.length === calledNow && con.dom.get("call").disabled === true && /game over/.test(con.dom.get("call").textContent),
   G.called.length + " " + calledNow + " " + con.dom.get("call").textContent);
ok("and a claim after it is refused", con.x.onClaim("Bob", "full", []) === "over");
room.flush();
ok("every phone is told the game is over", /got the full house|That is you/.test(bob.app()) && /That is you/.test(alice.app()), bob.app());

print("\n== a phone that already shouted is not offered it again after a reload (finding 4) ==");
con.dom.tap("again"); room.flush();               // a new game
G = con.x.G();
call(lineB);
con.dom.tap("call"); room.flush();
lineB.forEach(function (x) { bob.dom.tap("", { "data-n": String(x) }); });
ok("CONTROL: Bob has a line on his phone", /data-claim="line"/.test(bob.app()), bob.app());
bob.dom.tap("", { "data-claim": "line" }); room.flush();
var bob2 = phone("Bob", bob.store);               // Bob's phone reloaded
everyone();
ok("after his phone reloads it does not offer the same shout again", !/data-claim="line"/.test(bob2.app()), bob2.app());

print("\n== two truths: a late guest does not wipe what everyone is typing (finding 3) ==");
con.dom.tap("back"); con.dom.tap("", { "data-run": "2" }); room.flush();
ok("CONTROL: Alice has the form", /Two truths and a lie/.test(alice.app()) && /Send it in/.test(alice.app()), alice.app());
paints(alice);
var dan = phone("Dan"); everyone();
ok("Dan, who walked in late, gets the form", /Send it in/.test(dan.app()), dan.app());
ok("and Alice's form is not redrawn (her half-typed statements stay)", alice.paints === 0, alice.paints);
var askT = room.log.filter(function (l) { return l.from === "console" && l.payload.t === "ask-truths" && l.payload.to; });
ok("the console asked Dan alone", askT.length >= 1 && askT.every(function (l) { return l.payload.to === "Dan" || l.payload.to === "Bob"; }), JSON.stringify(askT.map(function (l) { return l.payload; })));
room.inject(CH, { t: "ask-truths" }); room.flush();
ok("a repeat of the form while a phone is on it changes nothing (an old console's broadcast)", alice.paints === 0, alice.paints);

print("\n== the draw lets go when the next game starts with only a caption (finding 14) ==");
con.dom.tap("back"); con.dom.tap("", { "data-run": "3" }); room.flush();
con.dom.tap("drawnow"); room.flush();
var w = con.x.G().last, wp = { Alice: alice, Bob: bob2, Dan: dan, Erin: erin }[w], other = w === "Alice" ? dan : alice;
ok("CONTROL: the winner's phone says so and the caption that follows does not replace it", wp && /You won/.test(wp.app()), w + " | " + (wp && wp.app()));
ok("and everybody else's says who won", new RegExp(w + "[\\s\\S]*won that one").test(other.app()), other.app());
/* No lobby in between: the next thing the room hears is only a caption (the draw's own "Start over",
   or a game that opens with one). The old hold swallowed every caption until something else came. */
con.x.send({ t: "big", text: "Great Minds", sub: "Get your phones out" }); room.flush();
ok("the next game's opening caption reaches the phone that showed the draw", /Get your phones out/.test(other.app()), other.app());
con.dom.tap("back"); room.flush();

print("\n== charades: the warning is a sheet, and comes before the first actor (finding 6) ==");
var sentBefore = room.log.length;
con.dom.tap("", { "data-run": "4" });
var sheet = con.dom.body.filter(function (e) { return e.id === "ppWarn" && !e.removed; })[0];
ok("\"Before you start\" is up when charades opens", !!sheet && /Before you start/.test(sheet.innerHTML));
room.flush();
ok("and no actor has been sent yet", !room.log.slice(sentBefore).some(function (l) { return l.payload.t === "charades"; }));
var css = PPRig.src("partyplay/run.html").match(/<style>([\s\S]*?)<\/style>/)[1];
ok("run.html styles the sheet as an overlay (it had no .ask CSS at all)", /\.ask\{position:fixed;inset:0/.test(css) && /\.askbox\{/.test(css));

print("\n== who won, said properly (finding 9) ==");
var Wn = PPQuiz.winners;
ok("nobody scoring is nobody winning", Wn([{ name: "Sam", score: 0 }, { name: "Jo", score: 0 }]).line === "Nobody scored");
ok("a tie is a tie", Wn([{ name: "Alice", score: 300 }, { name: "Eve", score: 300 }, { name: "Jo", score: 100 }]).line === "Alice and Eve win, a tie");
ok("on the telly too", Wn([{ name: "Alice", score: 300 }, { name: "Eve", score: 300 }]).text === "Alice and Eve" && /Joint winners/.test(Wn([{ name: "Alice", score: 300 }, { name: "Eve", score: 300 }]).sub));
ok("CONTROL: one winner is one winner", Wn([{ name: "Alice", score: 300 }, { name: "Eve", score: 200 }]).line === "Alice wins");
con.dom.tap("back"); con.dom.tap("", { "data-run": "5" }); con.dom.tap("next"); room.flush();
con.dom.tap("reveal"); con.dom.tap("next"); room.flush();
ok("How well do you know, nobody answering: the phone does not crown anybody", !/ wins/.test(alice.app()) || /Nobody scored/.test(alice.app()), alice.app());

print("\n== a mistyped host key is a way back, not a dead end (finding 5) ==");
var lost = consoleBoot(null, "this-key-has-a-typo-in-it-000");
var si = lost.app();
ok("it opens the sign-in with the party code filled in", /value="MPKQZX"/.test(si), si);
ok("says what is wrong", /does not match party MPKQZX/.test(si), si);
ok("and offers to send the email again", /Send it again/.test(si), si);

print("\n== the telly refuses something that is not a code (finding 8) ==");
var badTv = PPRig.boot("partyplay/tv.html", { search: "?code=%3Cb%3Ex", worker: W, room: room, name: "badtv",
  before: function (dom) { var el = dom.get("screen"), v = "", seen = []; dom.screenSeen = seen;
    Object.defineProperty(el, "innerHTML", { get: function () { return v; }, set: function (x) { v = x; seen.push(x); } }); } });
ok("/tv?code=<b>x never puts \"BX\" up as a join code, not even for a moment", !/Join the party/.test(wall(badTv)) &&
   !badTv.dom.screenSeen.some(function (h) { return />BX</.test(h); }), badTv.dom.screenSeen.join(" || ").slice(0, 300));
ok("it asks for the code, saying that one does not look right", /Enter your party code/.test(wall(badTv)) && /does not look right/.test(wall(badTv)), wall(badTv));
ok("CONTROL: a real code still gets the lobby", /Join the party/.test(wall(PPRig.boot("partyplay/tv.html", { search: "?code=" + CODE, worker: W, room: room, name: "oktv" }))));

print("\n== /booked says what is true (finding 7) ==");
function booked(q) { return PPRig.boot("partyplay/booked.html", { search: q, worker: W, sign: false, keys: false }); }
var bNone = booked("");
ok("no code: it does not say \"You are booked\"", bNone.dom.get("head").textContent !== "You are booked" && /could not find your booking/i.test(bNone.dom.get("head").textContent), bNone.dom.get("head").textContent);
var bPending = booked("?code=ACDEFG");
ok("a code that is not paid yet: \"Checking\", not booked", /Checking/.test(PPRig.src("partyplay/booked.html").match(/<h1 id="head">([^<]*)/)[1]) && bPending.dom.get("head").textContent !== "You are booked");
for (var k = 0; k < 11; k++) bPending.timers.run();
ok("and still unpaid after half a minute it says so plainly", /Still confirming/.test(bPending.dom.get("head").textContent), bPending.dom.get("head").textContent);
var bPaid = booked("?code=" + CODE);
ok("CONTROL: a paid code says booked", bPaid.dom.get("head").textContent === "You are booked", bPaid.dom.get("head").textContent);

print("\n== /unsubscribe does nothing until the button is pressed, and carries the token (finding 12) ==");
var calls0 = W.calls.length;
var un = PPRig.boot("partyplay/unsubscribe.html", { search: "?e=guest%40example.com&t=abc123def4567890", worker: W, sign: false, keys: false });
ok("opening the page sends nothing", W.calls.length === calls0, JSON.stringify(W.calls.slice(calls0)));
ok("it shows the address and the button", un.dom.get("who").textContent === "guest@example.com" && !un.dom.get("ask").hidden);
(un.dom.get("form").onsubmit || []).forEach(function (f) { f({ preventDefault: function () {} }); }); PPRig.settle();
var post = W.calls.slice(calls0).filter(function (c) { return c.path === "/unsubscribe"; })[0];
ok("pressing it posts the address WITH the token from the link", !!post && post.body.email === "guest@example.com" && post.body.t === "abc123def4567890", JSON.stringify(post));

print("\n== Great Minds: a guess past the third says so (finding 10) ==");
(function () {
  var host = { innerHTML: "", querySelector: function () { return null; } };
  var doc = { getElementById: function () { return {}; } };
  var R = {}; (new Function("window", readFile(findUp("partyplay/lib/pr-phone.js"))))(R);
  var ph = R.PRPhone.mount(host, { send: function () {}, me: function () { return { pid: "Sam", name: "Sam" }; } }, doc);
  ph.onMsg({ t: "ta_board", round: 1, q: "Name a fruit", name: "Great Minds", endsAt: Date.now() + 40000 });
  ph.onMsg({ t: "pr_result", to: "Sam", round: 1, text: "kiwi", hit: false, why: "no_guesses", left: 0 });
  ok("it reads \"no guesses left\", not \"not on the board\"", /no guesses left/.test(host.innerHTML) && !/not on the board/.test(host.innerHTML), host.innerHTML);
  ok("CONTROL: a real miss still reads \"not on the board\"", (function () { ph.onMsg({ t: "ta_board", round: 2, q: "Name a colour", name: "x", endsAt: Date.now() + 40000 });
    ph.onMsg({ t: "pr_result", to: "Sam", round: 2, text: "zzz", hit: false, why: "miss", left: 2 }); return /not on the board/.test(host.innerHTML); })());
  ok("PartyPlay's copy and VenuePlay's are the same file", readFile(findUp("partyplay/lib/pr-phone.js")) === readFile(findUp("venueplay/app/topanswers/pr-phone.js")));
})();

print("\n== the words (finding 11) ==");
var idx = PPRig.src("partyplay/index.html");
ok("the header button cannot wrap", /nav \.go,\.navr \.signin\{white-space:nowrap\}/.test(idx));
ok("the footer no longer says to pick a date", !/Pick the date later/.test(idx));
var icons = {}, dupe = [];
PPGames.formats().forEach(function (f) { var i = PPGames.icon(f); if (icons[i]) dupe.push(icons[i] + "/" + f); icons[i] = f; });
ok("every game has its own icon", !dupe.length, dupe.join(", "));
var host = PPRig.src("partyplay/host.html");
ok("the builder's \"we will just call it\" adds no full stop after an ellipsis", /esc\(t\.name\) \+ \(\/\\\.\\\.\\\.\$\/\.test\(t\.name\) \? '' : '\.'\)/.test(host));

print("");
if (bad) { print(bad + " OF " + ran + " CHECKS FAILED"); throw new Error(bad + " failed"); }
print("ALL " + ran + " CHECKS PASSED");
