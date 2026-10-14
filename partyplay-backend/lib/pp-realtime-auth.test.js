/* WHO MAY SPEAK ON A PARTY'S CHANNEL (15 Oct 2026).

   The 14 Oct audit: anybody holding the six characters on the telly could join the realtime
   channel and speak as the HOST (a forged "You won" on one phone, any caption, board or outside
   photo on the wall) or as any GUEST (answer in Alice's name, raise her hand, shout her FULL
   HOUSE), and the console let in any name that said hello, past the fifty cap.

   This runs the real pages, not their source text: run.html, play.html and tv.html each boot in
   jsc (tools/rig-partyplay-pages.js) with their own copy of lib/pp-sign.js and
   lib/pp-phonekey.js, on one fake channel, against a small fake Worker. A stranger is whatever
   the test injects into the channel. The Worker's own routes are run at the bottom, from the
   real Worker source.

   WebCrypto is tools/rig-fake-webcrypto.js: it keeps the one property signing relies on and
   proves nothing about ECDSA. The real curve was exercised in headless Chrome (15 Oct report).

   Run from the repo root:  jsc partyplay-backend/lib/pp-realtime-auth.test.js */
function findUp(rel) {
  var tries = [rel, "../../" + rel, "../" + rel];
  for (var i = 0; i < tries.length; i++) { try { if (readFile(tries[i]).length > 50) return tries[i]; } catch (e) {} }
  throw new Error("cannot find " + rel);
}
load(findUp("tools/rig-fake-webcrypto.js"));
var __rnd = 7;
crypto.getRandomValues = function (a) { for (var i = 0; i < a.length; i++) { __rnd = (__rnd * 1103515245 + 12345) & 0x7fffffff; a[i] = __rnd & 255; } return a; };
var window = this;
load(findUp("partyplay/lib/pp-config.js"));
load(findUp("partyplay/lib/pp-ticket.js"));
load(findUp("partyplay/lib/pp-quiz.js"));
load(findUp("partyplay/lib/pp-games.js"));
load(findUp("partyplay/lib/pp-licence.js"));
load(findUp("tools/rig-partyplay-pages.js"));

var ran = 0, bad = 0;
function ok(name, cond, saw) { ran++; if (cond) print("  ok   " + name); else { bad++; print("  FAIL " + name + (saw === undefined ? "" : "   saw: " + String(saw).slice(0, 300))); } }

var CODE = "QZXKMP", HOSTKEY = "hostkey-for-the-test-party-0001";
var GAMES = [{ id: "g1", format: "bingo90", title: "", config: {} },
             { id: "g2", format: "trivia", title: "", config: { items: [{ q: "Capital of France?", a: "Paris" }, { q: "2+2?", a: "4" }] } },
             { id: "g3", format: "draw", title: "", config: {} }];
var W = new PPRig.Worker(), room = new PPRig.Room();
W.add(CODE, HOSTKEY, { games: GAMES });
var CH = PPConfig.channel(CODE);

function tv(opts) {
  var t = PPRig.boot("partyplay/tv.html", Object.assign({ search: "?code=" + CODE, worker: W, room: room, name: "tv" }, opts || {}));
  return t;
}
function tvText(t) { return t.dom.get("screen").innerHTML; }
function phone(name) {
  var p = PPRig.boot("partyplay/play.html", { search: "?code=" + CODE, worker: W, room: room, name: name });
  p.dom.get("code").value = CODE; p.dom.get("name").value = name; p.dom.get("email").value = "";
  p.dom.get("mkt").checked = false;
  (p.dom.get("go").onclick || []).forEach(function (f) { f(); });
  PPRig.settle(60);
  return p;
}

print("== a party with no key yet renders as it always did ==");
var tvEarly = tv();
room.subscribeAll(); room.flush();
room.inject(CH, { t: "big", text: "BEFORE ANY CONSOLE", sub: "" });
room.flush();
ok("CONTROL: no console has opened, so the party has no key, and the telly renders an unsigned caption (fail open, as before)",
   /BEFORE ANY CONSOLE/.test(tvText(tvEarly)), tvText(tvEarly));

print("\n== the first console mints the party's key in the browser and hands it to the Worker ==");
var con = PPRig.boot("partyplay/run.html", { search: "?code=" + CODE + "&key=" + HOSTKEY, worker: W, room: room, name: "console",
  exportNames: ["send", "admitName", "onClaim", "runBingo", "nextBall", "bingoState"],
  extra: "players:function(){ return players; }, G:function(){ return G; }, ROOM:function(){ return ROOM; }" });
PPRig.settle(80);
var party = W.parties[CODE];
ok("the Worker now holds a key for the party, minted by the console", !!(party.sign && party.sign.kid && party.sign.public_jwk && party.sign.private_jwk),
   JSON.stringify(party.sign));
ok("and the console asked for one first, with its host key", W.calls.some(function (c) { return c.path === "/party/signing/private" && c.body.key === HOSTKEY; }));
ok("the console fetched the Worker's guest list with its host key", W.calls.some(function (c) { return c.path === "/party/players" && c.qs.key === HOSTKEY; }));
room.subscribeAll(); room.flush();
var lobbyMsg = room.log.filter(function (l) { return l.from === "console" && l.payload.t === "lobby"; })[0];
ok("what the console sends is signed", !!(lobbyMsg && lobbyMsg.payload._sig && lobbyMsg.payload._kid === party.sign.kid), JSON.stringify(lobbyMsg));

print("\n== the telly, once the party has a key ==");
var tv1 = tv();
room.subscribeAll(); room.flush();
ok("a telly that boots after the key exists shows the console's lobby (signed, so it renders)", /Join the party/.test(tvText(tv1)), tvText(tv1));
room.inject(CH, { t: "big", text: "FORGED CAPTION", sub: "" });
room.flush();
ok("a stranger's unsigned caption does NOT go on the wall", !/FORGED/.test(tvText(tv1)), tvText(tv1));
con.x.send({ t: "big", text: "The real one", sub: "from the host" }); room.flush();
ok("CONTROL: the host's own caption does", /The real one/.test(tvText(tv1)), tvText(tv1));
var real = room.log.filter(function (l) { return l.payload.text === "The real one"; })[0].payload;
var edited = JSON.parse(JSON.stringify(real)); edited.text = "EDITED AFTER SIGNING"; edited._n = "freshnonce1";
room.inject(CH, edited); room.flush();
ok("the host's signed message with the words changed is dropped", !/EDITED/.test(tvText(tv1)), tvText(tv1));
con.x.send({ t: "big", text: "Second caption", sub: "" }); room.flush();
room.inject(CH, real); room.flush();
ok("the host's own earlier message played back is dropped (a replay)", /Second caption/.test(tvText(tv1)), tvText(tv1));
/* The real attack: his own key, signed properly, claiming the party's key id. */
var kp = null; crypto.subtle.generateKey().then(function (k) { kp = k; }); PPRig.settle();
var forged = { t: "big", text: "SIGNED BY A STRANGER", sub: "", _ts: Date.now(), _n: "strangernonce", _kid: party.sign.kid };
var sigP = null; crypto.subtle.sign({}, kp.privateKey, new TextEncoder().encode(con.win.PPSign.canon(forged))).then(function (s) { sigP = s; }); PPRig.settle();
var b = new Uint8Array(sigP), str = ""; for (var i = 0; i < b.length; i++) str += String.fromCharCode(b[i]);
forged._sig = btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
room.inject(CH, forged); room.flush();
ok("a message properly signed with somebody else's key under the party's key id is dropped", !/STRANGER/.test(tvText(tv1)), tvText(tv1));
room.inject(CH, { t: "photoscreen", url: "https://evil.example/x.jpg", q: "Who is this?", n: 1, of: 1 }); room.flush();
ok("a forged outside photo is not put on the wall", !/evil\.example/.test(tvText(tv1)), tvText(tv1));
con.x.send({ t: "photoscreen", url: "https://evil.example/y.jpg", q: "Who?", n: 1, of: 1 }); room.flush();
ok("and even a SIGNED photo is shown only from this party's Worker (a party with no key yet is covered too)",
   !/evil\.example/.test(tvText(tv1)) && /could not be loaded/.test(tvText(tv1)), tvText(tv1));

print("\n== a telly that opened before the key existed learns it from the first signed message ==");
con.x.send({ t: "big", text: "Signed, to the early telly", sub: "" }); room.flush();
ok("it fetched the key on seeing a signed message, and showed it", /Signed, to the early telly/.test(tvText(tvEarly)), tvText(tvEarly));
room.inject(CH, { t: "big", text: "FORGED LATER", sub: "" }); room.flush();
ok("and from then on drops a stranger's unsigned caption", !/FORGED LATER/.test(tvText(tvEarly)), tvText(tvEarly));

print("\n== a missing key never blacks out a telly ==");
W.down["/party/signing/public"] = true;
var tvBlind = tv();
room.subscribeAll(); room.flush();
con.x.send({ t: "big", text: "Signed, to a blind telly", sub: "" }); room.flush();
ok("a telly that cannot fetch the key still renders the host's messages", /Signed, to a blind telly/.test(tvText(tvBlind)), tvText(tvBlind));
W.down["/party/signing/public"] = false;

print("\n== guests: a phone's key is its identity, and the Worker's list is who is in ==");
var alice = phone("Alice"), bob = phone("Bob");
room.subscribeAll(); room.flush(); con.timers.run(); room.flush();
var rowA = party.players.filter(function (r) { return r.name === "Alice"; })[0];
ok("a phone sends its key's fingerprint with /join and the Worker keeps it", !!(rowA && /^k1_/.test(rowA.pid)), JSON.stringify(rowA));
ok("both guests are admitted by the console", con.x.players().indexOf("Alice") >= 0 && con.x.players().indexOf("Bob") >= 0, JSON.stringify(con.x.players()));
var helloA = room.log.filter(function (l) { return l.from === "Alice" && l.payload.t === "hello"; })[0];
ok("a guest's hello is signed with their own key", !!(helloA && helloA.payload.sig && helloA.payload.pid === rowA.pid), JSON.stringify(helloA && helloA.payload));
room.inject(CH, { t: "hello", name: "Mallory" }); room.flush(); con.timers.run(); room.flush();
ok("a name the Worker never let in is NOT admitted (the fifty cap and the guest list mean something now)", con.x.players().indexOf("Mallory") < 0, JSON.stringify(con.x.players()));
var hisKey = null; con.win.PPPhoneKey.ensure("OTHERPARTY").then(function (k) { hisKey = k; }); PPRig.settle();
var hisHello = null; hisKey.sign({ t: "hello", name: "Eve" }).then(function (m) { hisHello = m; }); PPRig.settle();
room.inject(CH, hisHello); room.flush(); con.timers.run(); room.flush();
ok("nor is a stranger with a key of their own who never joined", con.x.players().indexOf("Eve") < 0, JSON.stringify(con.x.players()));

print("\n== nobody can answer in somebody else's name ==");
con.dom.tap("", { "data-run": "1" });            // trivia
con.dom.tap("next");                             // first question
room.flush();
var q0 = alice.app();
ok("CONTROL: Alice's phone has the question", /Capital of France/.test(q0), q0);
room.inject(CH, { t: "answer", name: "Alice", i: 0, answer: "Paris" }); room.flush(); con.timers.run(); room.flush();
ok("an UNSIGNED answer in Alice's name is not counted (her phone has a key)", con.x.G().answers.length === 0, JSON.stringify(con.x.G().answers));
var forgedAns = null; hisKey.sign({ t: "answer", name: "Alice", i: 0, answer: "Paris" }).then(function (m) { forgedAns = m; }); PPRig.settle();
room.inject(CH, forgedAns); room.flush(); con.timers.run(); room.flush();
ok("a SIGNED answer in Alice's name from another key is not counted either", con.x.G().answers.length === 0, JSON.stringify(con.x.G().answers));
/* The real attack on a keyed guest: his own key, signed properly, with HER pid pasted in. */
var aliceRow = party.players.filter(function (r) { return r.name === "Alice"; })[0];
var pm = { t: "answer", name: "Alice", i: 0, answer: "Paris", pid: aliceRow.pid, n: Date.now() + 5, pk: hisHello.pk };
(function () { var priv = null;
  var saved = JSON.parse(con.store.getItem("ppKey:OTHERPARTY"));
  crypto.subtle.importKey("jwk", saved.jwk).then(function (k) { priv = k; }); PPRig.settle();
  crypto.subtle.sign({}, priv, new TextEncoder().encode(con.win.PPPhoneKey.canon(pm))).then(function (s) {
    var b = new Uint8Array(s), t = ""; for (var i = 0; i < b.length; i++) t += String.fromCharCode(b[i]);
    pm.sig = btoa(t).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }); PPRig.settle(); })();
room.inject(CH, pm); room.flush(); con.timers.run(); room.flush();
ok("his own key, signed properly, with Alice's pid pasted in: not counted (the key is not her pid)", con.x.G().answers.length === 0, JSON.stringify(con.x.G().answers));
var bobAsAlice = null;
bob.win.PPPhoneKey.ensure(CODE).then(function (k) { k.sign({ t: "answer", name: "Alice", i: 0, answer: "Lyon" }).then(function (m) { bobAsAlice = m; }); }); PPRig.settle();
room.inject(CH, bobAsAlice); room.flush(); con.timers.run(); room.flush();
var got = con.x.G().answers;
ok("Bob's own phone typing Alice's name counts as BOB, because the name comes from the Worker's list",
   got.length === 1 && got[0].name === "Bob" && got[0].answer === "Lyon", JSON.stringify(got));
alice.dom.tap("", { "data-opt": "Paris" }); room.flush();
got = con.x.G().answers;
ok("CONTROL: Alice tapping her own answer counts, as Alice", got.length === 2 && got[1].name === "Alice" && got[1].answer === "Paris", JSON.stringify(got));
room.inject(CH, room.log.filter(function (l) { return l.from === "Alice" && l.payload.t === "answer"; })[0].payload); room.flush();
ok("her answer played back again is not counted twice", con.x.G().answers.length === 2);

print("\n== a phone on the page from before this shipped still plays ==");
party.players.push({ name: "Carol", token: "TOKCAROLXXXXXXXXXXXXXXXX", pid: null });   // joined on the old page: no key on file
room.inject(CH, { t: "hello", name: "Carol" }); room.flush(); con.timers.run(); room.flush();
ok("an unsigned hello from a guest the Worker let in, with no key on file, is admitted", con.x.players().indexOf("Carol") >= 0, JSON.stringify(con.x.players()));
room.inject(CH, { t: "answer", name: "Carol", i: 0, answer: "4" }); room.flush(); con.timers.run(); room.flush();
ok("and her unsigned answer counts", con.x.G().answers.some(function (a) { return a.name === "Carol"; }));

print("\n== admitName, the rule itself ==");
var A = con.x.admitName, L = { byPid: { k1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa: { name: "Alice", pid: "k1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" } },
  byName: { alice: { name: "Alice", pid: "k1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }, dan: { name: "Dan", pid: null } } };
var keyed = function (pid) { return { ok: true, legacy: false, pid: pid }; }, legacy = { ok: true, legacy: true };
ok("a bad signature is refused whatever it says", !!A({ name: "Alice" }, { ok: false, why: "bad signature" }, L, {}, true).refuse);
ok("the Worker's name wins over the message's", A({ name: "Zed", pid: "k1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }, keyed("k1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"), L, {}, false).name === "Alice");
ok("an unknown key is asked about again before it is refused", !!A({ name: "Alice", pid: "k1_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }, keyed("k1_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"), L, {}, false).unknown);
ok("then refused for a name whose row holds another key", !!A({ name: "Alice", pid: "k1_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }, keyed("k1_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"), L, {}, true).refuse);
var bound = {};
ok("a guest who joined before keys gets their name held by the first key that speaks for it", A({ name: "Dan", pid: "k1_cccccccccccccccccccccccccccccccc" }, keyed("k1_cccccccccccccccccccccccccccccccc"), L, bound, true).name === "Dan");
ok("and a second key for that name is then refused", !!A({ name: "Dan", pid: "k1_dddddddddddddddddddddddddddddddd" }, keyed("k1_dddddddddddddddddddddddddddddddd"), L, bound, true).refuse);
ok("and so is an unsigned message for it", !!A({ name: "Dan" }, legacy, L, bound, true).refuse);
ok("an unsigned message for a keyed guest is refused", !!A({ name: "Alice" }, legacy, L, {}, true).refuse);
ok("an unsigned message for a name not on the list is refused", !!A({ name: "Nobody" }, legacy, L, {}, true).refuse);
var b2 = {};
ok("with NO list (old Worker, no signal) a name is held by the first key", A({ name: "Sam", pid: "k1_eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" }, keyed("k1_eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"), null, b2, false).name === "Sam");
ok("and another key, or no key, cannot take it", !!A({ name: "Sam", pid: "k1_ffffffffffffffffffffffffffffffff" }, keyed("k1_ffffffffffffffffffffffffffffffff"), null, b2, false).refuse &&
   !!A({ name: "Sam" }, legacy, null, b2, false).refuse);
ok("CONTROL: with no list an unsigned old phone is still heard, as before", A({ name: "Old phone" }, legacy, null, {}, false).name === "Old phone");

print("\n== the phones drop what the host did not say ==");
con.dom.tap("back"); con.dom.tap("", { "data-run": "2" }); room.flush();     // the prize draw
room.inject(CH, { t: "draw", winner: "Alice" }); room.flush();
ok("a forged draw does NOT tell Alice she won", !/You won/.test(alice.app()), alice.app());
room.inject(CH, { t: "lobby" }); room.inject(CH, { t: "ask", i: 9, q: "FORGED QUESTION", options: ["a", "b"], n: 1, of: 1 }); room.flush();
ok("nor does a forged question reach her phone", !/FORGED QUESTION/.test(alice.app()), alice.app());
con.dom.tap("drawnow"); room.flush();
var winner = con.x.G().last;
var winPhone = winner === "Alice" ? alice : (winner === "Bob" ? bob : null);
ok("CONTROL: the host's real draw does reach the winner's phone", !winPhone || /You won/.test(winPhone.app()), winner + " | " + (winPhone && winPhone.app()));

print("\n== the Worker's routes, from the real Worker source ==");
(function () {
  /* The ticket seed the Worker hands the console must be the one the phone builds from. */
  var wsrc = readFile(findUp("partyplay-backend/worker/SOURCE-do-not-paste-partyplay-api.js"));
  var m = /function ticketSeed\(token\) \{[\s\S]*?\n\}/.exec(wsrc);
  ok("the Worker has ticketSeed", !!m);
  var ticketSeed = (new Function(m[0] + "; return ticketSeed;"))();
  var same = true;
  for (var i = 0; i < 300; i++) { var tok = "TOKEN" + i + "ACDEFGHJKMNPQRSTUVWXY".slice(i % 10); if (ticketSeed(tok) !== PPTicket.seed(tok)) same = false; }
  ok("the Worker's ticketSeed is the phone's seed, for 300 tokens", same);
  var t = "ABCDEFGHJKMNPQRSTUVWXY34";
  ok("and the console's ticket from that seed is the phone's ticket", JSON.stringify(PPTicket.buildFromSeed(ticketSeed(t))) === JSON.stringify(PPTicket.build(t)));
  var cre = /const CODE_RE = (\/[^\n;]+\/);/.exec(wsrc);
  var WRE = (new Function("return " + cre[1]))();
  var agree = ["QZXKMP", "ABCDEF", "BX", "<b>x", "OOOOOO", "ABS3KM", "abs 3km", "QZXKM", "QZXKMPP"].every(function (c) { return WRE.test(PPConfig.code(c)) === PPConfig.valid(c); });
  ok("PPConfig.valid and the Worker's CODE_RE agree on what a code is", agree);
})();

print("");
if (bad) { print(bad + " OF " + ran + " CHECKS FAILED"); throw new Error(bad + " failed"); }
print("ALL " + ran + " CHECKS PASSED");
