/* THE MUSICAL BINGO CONSOLE, RUN, not read. From the audit of 27 Sep 2026.

   1. A false "Lost the connection" on the console. openGameChannel removed the old channel while
      gch still pointed at it; supabase-js reports CLOSED to that channel INSIDE removeChannel, so
      the console read its own replacement as a drop the moment a lobby opened. No retry either,
      and the warning never came down. The fix is trivia/host.html's, and this is the running test
      from venueplay-backend/app/trivia/trivia-night.test.js section 7, against musical.
   2. Paper cards: the Print modal promised "printing again gives you the same cards", which is
      only true from the same playlist now that the Worker replaces a set from another playlist
      before the first game (tools/test-musical-print.js runs that side). And after a print the
      console never said which playlist the cards on the tables came from.
   5. Playlist cards said "312 songs" while a game plays GAME_SONGS of them.

   Every function here is lifted out of the page that ships and run.

   Run: jsc tools/test-musical-host.js   (from the repo root) */
var bad = 0, ran = 0;
function pass(n, c, why){ ran++; print((c ? "  ok   " : "  FAIL ") + n + (c || !why ? "" : "   " + why)); if(!c) bad++; }
var host = readFile("venueplay/app/musical/host.html");
pass("the musical console is readable", !!host && host.length > 20000);

function grab(name, src){
  var i = src.indexOf("function " + name + "(");
  if (i < 0) return "";
  var depth = 0, started = false;
  for (var j = i; j < src.length; j++){
    if (src[j] === "{"){ depth++; started = true; }
    else if (src[j] === "}"){ depth--; if (started && depth === 0) return src.slice(i, j + 1); }
  }
  return "";
}
// A statement that starts at `from` and runs to its matching close, e.g. one addEventListener call.
function grabCall(from, src){
  var i = src.indexOf(from); if (i < 0) return "";
  var depth = 0, started = false;
  for (var j = i; j < src.length; j++){
    if (src[j] === "(" ){ depth++; started = true; }
    else if (src[j] === ")"){ depth--; if (started && depth === 0) return src.slice(i, j + 2); }
  }
  return "";
}

print("");
print("1. THE PLAYERS' CHANNEL: no false 'lost connection', and it really reconnects");
(function(){
  /* A fake realtime client that behaves like supabase-js: removeChannel() reports CLOSED to the
     old channel INSIDE the call. */
  var a = host.indexOf("  var _leaving=false;"), b = host.indexOf("  // ---- host game state (the Worker is authoritative");
  var SRC = (a > 0 && b > a) ? host.slice(a, b) : "";
  var LEAVE = grabCall('window.addEventListener("beforeunload", function(){ _leaving=true; })', host) +
              grabCall('window.addEventListener("pagehide", function(){ _leaving=true; })', host) +
              grabCall('window.addEventListener("pageshow", function(ev){', host);
  pass("the players' channel code is where the test expects it", !!SRC && SRC.indexOf("function openGameChannel(") > 0);
  pass("the page marks itself as leaving, and a pageshow takes that back", LEAVE.split("addEventListener").length - 1 === 3, LEAVE.slice(0, 200));
  var timers = [], shown = [], cleared = 0, chans = [], tid = 0, listeners = {};
  var client = { channel: function(name){ var c = { name: name, on: function(){ return c; }, subscribe: function(cb){ c.cb = cb; return c; } }; chans.push(c); return c; },
                 removeChannel: function(c){ if (c && c.cb) c.cb("CLOSED"); } };
  var env = { client: client, G: { status: "setup", joinCode: "ABC123" },
              hostError: function(m){ shown.push(m); }, clearHostError: function(){ cleared++; },
              gflush: function(){}, gsend: function(){}, onMsg: function(){},
              window: { addEventListener: function(ev, fn){ (listeners[ev] = listeners[ev] || []).push(fn); } },
              setTimeout: function(fn, ms){ var t = { fn: fn, ms: ms, id: ++tid }; timers.push(t); return t.id; },
              clearTimeout: function(id){ timers = timers.filter(function(t){ return t.id !== id; }); } };
  var names = Object.keys(env);
  var api = (new Function(names.join(","), "var gch=null, gsub=false;" + SRC + LEAVE +
    "; return { open: openGameChannel, cur: function(){ return gch; }, sub: function(){ return gsub; }, leaving: function(){ return _leaving; } };")).apply(null, names.map(function(k){ return env[k]; }));
  function fire(){ var t = timers.slice(); timers = []; t.forEach(function(x){ x.fn(); }); }
  function emit(ev, arg){ (listeners[ev] || []).forEach(function(fn){ fn(arg); }); }

  api.open("ABC123"); api.cur().cb("SUBSCRIBED");
  api.open("ABC123");                       // printing, then opening the lobby, reopens it
  pass("replacing the channel is not mistaken for a drop: no reconnect, no warning booked", timers.length === 0, JSON.stringify(timers.map(function(t){ return t.ms; })));
  env.G.status = "running"; api.open("ABC123"); env.G.status = "setup";
  pass("...even mid-game (a reload restores a live game and reopens it)", timers.length === 0);
  fire();
  pass("opening a lobby shows no 'lost connection'", shown.length === 0, JSON.stringify(shown));

  env.G.status = "running"; shown.length = 0; timers = [];
  var healed = api.cur(), opened = chans.length;
  healed.cb("TIMED_OUT"); healed.cb("SUBSCRIBED"); fire();
  pass("a blip that heals inside 8 seconds says nothing", shown.length === 0, JSON.stringify(shown));
  pass("...and the retry it booked is cancelled, so a working channel is not torn down", chans.length === opened && api.cur() === healed);
  timers = []; api.cur().cb("CHANNEL_ERROR");
  pass("a drop stops the console sending into a dead socket", api.sub() === false);
  var waits = timers.map(function(t){ return t.ms; });
  pass("a real drop books a retry and an 8 second warning", waits.indexOf(8000) >= 0 && waits.some(function(ms){ return ms >= 2000 && ms !== 8000; }), JSON.stringify(waits));
  var before = chans.length; fire();
  pass("still down after 8 seconds in a live game: the host is told", shown.length === 1 && /hold off on the next song/.test(shown[0]), JSON.stringify(shown));
  pass("and the retry really opens a fresh channel", chans.length === before + 1);
  api.cur().cb("SUBSCRIBED");
  pass("when it comes back the warning is taken down, once", cleared === 1 && api.sub() === true);
  api.cur().cb("SUBSCRIBED");
  pass("a second SUBSCRIBED does not clear some other error the host is reading", cleared === 1);

  env.G.status = "lobby"; shown.length = 0; timers = [];
  api.cur().cb("TIMED_OUT"); fire();
  pass("in the lobby, a drop retries quietly and warns nobody", shown.length === 0 && chans.length === before + 2);

  env.G.status = "running"; api.cur().cb("SUBSCRIBED"); shown.length = 0; timers = [];
  emit("pagehide");
  pass("leaving the page marks it as leaving", api.leaving() === true);
  api.cur().cb("CLOSED");
  pass("the channel closing as the page goes is not a drop: no retry, no warning", timers.length === 0 && shown.length === 0);
  emit("pageshow", { persisted: true });
  pass("back from the back/forward cache: drops count again", api.leaving() === false);
  pass("...and the channel that closed while it was away is opened again", chans.length === before + 3);
  timers = []; api.cur().cb("CHANNEL_ERROR"); fire();
  pass("a real drop after that restore is reported, not ignored", shown.length === 1);
})();

print("");
print("2. PAPER CARDS: the Print modal tells the truth about which cards you get");
(function(){
  var fns = ["esc", "paperPrintIntro", "paperPrintedNote", "paperPrintOutcome"].map(function(n){ return grab(n, host); });
  pass("the paper wording has its own functions", fns.every(Boolean));
  var api = (new Function(fns.join("\n") + "; return { intro: paperPrintIntro, note: paperPrintedNote, outcome: paperPrintOutcome };"))();
  var t = api.intro(0, "", "Pub Classics").replace(/<[^>]+>/g, "");
  pass("first print: just how many", t === "How many cards? Up to 10 a night.", t);
  t = api.intro(3, "Pub Classics", "Pub Classics").replace(/<[^>]+>/g, "");
  pass("same playlist again: the same cards plus extra, and says which playlist", /printed 3 already from Pub Classics/.test(t) && /same playlist gives you the same cards, plus any extra/.test(t), t);
  t = api.intro(3, "Pub Classics", "80s Anthems").replace(/<[^>]+>/g, "");
  pass("a different playlist: does NOT promise the same cards", !/gives you the same cards/.test(t), t);
  pass("...says the earlier cards are replaced before the first game, and kept once one is played",
       /Before the first game, printing replaces the Pub Classics cards/.test(t) && /every game tonight plays Pub Classics/.test(t), t);
  pass("a playlist name is escaped before it goes into the modal", api.intro(1, "<b>x", "y").indexOf("<b>x") < 0);
  pass("after a print, the note under the button names the playlist", /printed tonight from 80s Anthems\./.test(api.note(4, "80s Anthems")), api.note(4, "80s Anthems"));
  pass("the note before any print is unchanged", /^Up to 10 a night, printed from the playlist above\./.test(api.note(0, "")));
  var o = api.outcome({ playlist_name: "Pub Classics", kept: true }, "80s Anthems");
  pass("kept mid-night: the host is told the cards are Pub Classics, not what they picked", /These cards are from Pub Classics, not 80s Anthems/.test(o), o);
  o = api.outcome({ playlist_name: "80s Anthems", replaced: true }, "80s Anthems");
  pass("replaced: the host is told to throw the earlier cards away", /Throw away any cards printed earlier tonight/.test(o), o);
  pass("an ordinary reprint says nothing extra", api.outcome({ playlist_name: "Pub Classics" }, "Pub Classics") === "");
  pass("the modal uses the wording, not the old promise", host.indexOf("printing again gives you the same cards, plus any extra") < 0 && host.indexOf("paperPrintIntro(had, had ? paperPrintedFrom() : \"\", picked)") > 0);
  pass("the print remembers which playlist it came from", host.indexOf("savePaperPrinted(r.cards.length, r.playlist_name||\"\")") > 0);
  pass("no em dash in any paper wording", !/\u2014/.test(fns.join("")));
})();

print("");
print("5. A PLAYLIST CARD SAYS HOW MANY SONGS A GAME PLAYS");
(function(){
  var m = /var GAME_SONGS=(\d+);/.exec(host);
  var GS = m ? +m[1] : 0;
  pass("GAME_SONGS is read from the page", GS > 0);
  var fn = grab("playlistCountLabel", host), render = grab("renderPlCards", host);
  pass("the count wording has one function, and the playlist cards use it", !!fn && render.indexOf("playlistCountLabel(o.count)") > 0);
  var label = (new Function("GAME_SONGS", fn + "; return playlistCountLabel;"))(GS);
  pass("312 songs shows " + GS + " of 312 songs", label(312) === GS + " of 312 songs", label(312));
  pass("a big library shows the thousands separator", label(17245) === GS + " of 17,245 songs", label(17245));
  pass("a playlist no bigger than a game shows just its size", label(GS) === GS + " songs" && label(40) === "40 songs", label(40));
  pass("Surprise Mix says how many it draws", label(null) === GS + " songs, random each game", label(null));
  /* Run the real renderPlCards against a tiny fake DOM, so a card that bypasses the label is caught. */
  var made = [];
  function el(){ var e = { className: "", textContent: "", children: [], attrs: {}, classList: { toggle: function(){} },
    appendChild: function(c){ e.children.push(c); }, setAttribute: function(k, v){ e.attrs[k] = v; }, addEventListener: function(){} }; made.push(e); return e; }
  var grid = el(); grid.innerHTML = "";
  var doc = { createElement: function(){ return el(); } };
  var PL = [{ id: "p1", name: "Pub Classics", count: 312 }, { id: "surprise", name: "Surprise Mix", count: null }];
  (new Function("$", "document", "PL_OPTS", "G", "GAME_SONGS", fn + render + "; renderPlCards('');"))(function(){ return grid; }, doc, PL, { playlistId: "p1" }, GS);
  var cts = made.filter(function(e){ return e.className === "ct"; }).map(function(e){ return e.textContent; });
  pass("the cards on screen say " + GS + " of 312 songs, and " + GS + " songs, random each game", cts[0] === GS + " of 312 songs" && cts[1] === GS + " songs, random each game", JSON.stringify(cts));
})();

print("");
print("6. TONIGHT: FREE ENTRY OR TICKETS SOLD, and what the rules gate is told (live audit, 16 Oct 2026)");
(function(){
  /* The gate was asked with no per-game flag, so a venue unlocked to charge saw every musical night
     as ticketed and a FREE night was hard blocked where the state says the venue may not charge.
     Lift the choice and the Start button's handler out of the page and run them. */
  var a = host.indexOf("  function paidNightKey(){"), s = host.indexOf('$("startBtn").addEventListener("click", function(){', a), e = s < 0 ? -1 : host.indexOf("\n  });", s);
  pass("the Tonight choice and the Start handler are where this test lifts them from", a > 0 && s > a && e > s);
  if (!(a > 0 && s > a && e > s)) return;
  pass("the markup has the choice, defaulting to free, hidden until the venue is known to be allowed to charge", /<select id="paidSel">\s*<option value="">Free entry/.test(host) && /id="paidField" style="display:none"/.test(host));
  var SRC = host.slice(a, e + "\n  });".length);
  var store = {}, els = {}, gated = [], opened = 0, started = 0;
  function el(id){ if (!els[id]) els[id] = { id: id, value: "", style: {}, listeners: {}, addEventListener: function(t, f){ (this.listeners[t] = this.listeners[t] || []).push(f); } }; return els[id]; }
  var fakeLocal = { getItem: function(k){ return store[k] == null ? null : store[k]; }, setItem: function(k, v){ store[k] = String(v); }, removeItem: function(k){ delete store[k]; } };
  var G = { status: "setup", freeEntry: false };
  var VPGaming = { gateFor: function(fmt, go, opts){ gated.push({ fmt: fmt, opts: opts }); VPGaming.last = go; } };
  var RealDate = Date;
  function fakeDate(ms){ var F = function(x){ return new RealDate(x); }; F.now = function(){ return ms; }; return F; }
  var api = new Function("$", "localStorage", "G", "window", "VPGaming", "Date", "startGame", "openLobby",
    SRC + "\n return { paidNightKey: paidNightKey, paidTonight: paidTonight, setPaidTonight: setPaidTonight, syncPaidSel: syncPaidSel, showPaidField: showPaidField };")(
    el, fakeLocal, G, { VPGaming: VPGaming }, VPGaming, fakeDate(new RealDate(2026, 9, 17, 1, 0, 0).getTime()), function(){ started++; }, function(){ opened++; });
  pass("by default tonight is free entry", api.paidTonight() === false && el("paidSel").value === "");
  el("startBtn").listeners.click[0]();
  pass("Start asks the gate for a FREE musical game (gameIsPaid:false, onlyIfPaid kept)", gated.length === 1 && gated[0].fmt === "musical" && gated[0].opts.gameIsPaid === false && gated[0].opts.onlyIfPaid === true && gated[0].opts.freeEntry === false, JSON.stringify(gated[0] && gated[0].opts));
  VPGaming.last();
  pass("and the lobby opens", opened === 1 && started === 0);
  el("paidSel").value = "paid"; el("paidSel").listeners.change[0]();
  pass("choosing Tickets sold is remembered for the night", api.paidTonight() === true && /^paid:\d{4}-\d{2}-\d{2}$/.test(store.vpMusicPaid || ""), store);
  el("startBtn").listeners.click[0]();
  pass("Start now asks the gate for a PAID game", gated.length === 2 && gated[1].opts.gameIsPaid === true, JSON.stringify(gated[1] && gated[1].opts));
  VPGaming.last({ free: true });   // the state said no: "Start as a free-entry game" was pressed
  pass("\"Start as a free-entry game\" switches tonight back to free, on the page and in storage, and still opens the lobby", G.freeEntry === true && api.paidTonight() === false && el("paidSel").value === "" && opened === 2, { free: G.freeEntry, store: store, sel: el("paidSel").value });
  el("startBtn").listeners.click[0]();
  pass("every gate from then on is for a free game", gated.length === 3 && gated[2].opts.gameIsPaid === false && gated[2].opts.freeEntry === true, JSON.stringify(gated[2].opts));
  api.setPaidTonight(true); store.vpMusicPaid = "paid:2020-01-01";
  pass("a choice from another night does not carry over", api.paidTonight() === false);
  api.showPaidField({ paid_entry_enabled: true });
  pass("the choice is shown when the venue may charge", el("paidField").style.display === "");
  api.showPaidField({ paid_entry_enabled: false }); var d1 = el("paidField").style.display; api.showPaidField(null);
  pass("and hidden when it may not, or no venue is known", d1 === "none" && el("paidField").style.display === "none");
  /* the night key: 1am belongs to the night before, 7am to the new day */
  var keyFn = new Function("Date", host.slice(a, host.indexOf("\n", a)) + "\n return paidNightKey;");
  pass("1am still counts as the night before (a night runs past midnight)", keyFn(fakeDate(new RealDate(2026, 9, 17, 1, 0, 0).getTime()))() === "2026-10-16");
  pass("7am is the new day", keyFn(fakeDate(new RealDate(2026, 9, 17, 7, 0, 0).getTime()))() === "2026-10-17");
})();

print("");
print("7. A REFUSED START STAYS ON SCREEN (live play test, 24 Oct 2026)");
(function(){
  /* Start game came back 429 "Musical bingo runs once a week per venue..." and the host saw nothing:
     apiPost cleared the bar on every reply that worked, and the /session re-say that openSession
     fires (not awaited) answered 200 just after. The real beginRound, openSession, apiPost,
     hostError, clearHostError and clearErrForAction run here against a fake Worker. */
  var fns = ["hostError", "clearHostError", "clearErrForAction", "apiPost", "openSession", "beginRound"].map(function(n){ return grab(n, host); });
  pass("the start path is where this test lifts it from", !!fns[0] && !!fns[1] && !!fns[3] && !!fns[4] && !!fns[5]);
  var bar = { cls: {}, style: {}, parentNode: null, classList: { add: function(c){ bar.cls[c] = 1; }, remove: function(c){ delete bar.cls[c]; } } };
  var txt = { textContent: "" }, btn = { disabled: false, textContent: "" };
  var els = { hostErrBar: bar, hostErrText: txt, statusText: { textContent: "" }, startBtn: btn };
  var later = [], calls = [];
  var WEEKLY = "Musical bingo runs once a week per venue. Your next musical bingo night is available from Monday 26 October.";
  function reply(status, body){ return { ok: status >= 200 && status < 300, status: status, json: function(){ return Promise.resolve(body); } }; }
  var env = {
    $: function(id){ return els[id] || null; }, document: { body: { appendChild: function(){} }, querySelector: function(){ return null; } },
    window: { scrollTo: function(){} }, VP_ONETAB: undefined, VP_GAME_API: "https://w", AbortController: undefined,
    setTimeout: function(){ return 1; }, clearTimeout: function(){},
    getToken: function(){ return Promise.resolve("t"); }, confirmOverage: function(){ return Promise.resolve(true); },
    fetch: function(url){ calls.push(url);
      if (/\/session$/.test(url)) return new Promise(function(res){ later.push(function(){ res(reply(200, { session_id: "s1", join_code: "ABC123" })); }); });
      if (/\/host\/game$/.test(url)) return Promise.resolve(reply(429, { error: WEEKLY }));
      return Promise.resolve(reply(200, {})); },
    G: { venueId: "v1", sessionId: "s1", joinCode: "ABC123", busy: false, pattern: "one", prize: "Meat tray", autoDaub: true },
    gLostShown: false, VP: {}, paperPrinted: function(){ return 0; }, askPaperDeclared: function(){ return 0; },
    bcast: function(){}, PAT_TO_WORKER: { one: "one_line" }, playlistPayload: function(){ return { name: "x", songs: [] }; },
    renderConsole: function(){}
  };
  var names = Object.keys(env);
  var api = (new Function(names.join(","), fns.join("\n") + "\n return { beginRound: beginRound, hostError: hostError, clear: (typeof clearErrForAction==='function') ? clearErrForAction : clearHostError, setLost: function(v){ gLostShown = v; } };"))
    .apply(null, names.map(function(k){ return env[k]; }));
  function shown(){ return bar.cls.show ? txt.textContent : ""; }
  api.beginRound(btn, "Open lobby"); drainMicrotasks();
  pass("CONTROL: Start re-says /session first, then asks for the game, which is refused", calls.length === 2 && /\/session$/.test(calls[0]) && /\/host\/game$/.test(calls[1]) && /once a week/.test(shown()), { calls: calls, shown: shown() });
  later.forEach(function(f){ f(); }); drainMicrotasks();
  pass("the weekly refusal is still on screen after /session answers 200 a moment later", /once a week/.test(shown()), shown());
  api.beginRound(btn, "Open lobby");
  pass("and it comes down when the host taps Start again", shown() === "", shown());
  drainMicrotasks(); later.forEach(function(f){ f(); }); drainMicrotasks();
  api.setLost(true); api.hostError("Lost the connection to the players' phones.");
  api.clear();
  pass("a host action never takes down 'Lost the connection' while the phones are still down", /Lost the connection/.test(shown()), shown());
})();

print("");
print("8. ONE PHONE IS ONE PLAYER, WHICHEVER PAGE IT IS ON (live play test, 24 Oct 2026)");
(function(){
  /* Phones left on the bingo page from the game before answered the musical console's rollcall with
     a bingo join (pid = the bingo page's key fingerprint), and the same phones' musical pages joined
     under their own pids: PLAYERS 4, "Phone Sam, Phone Jo" twice. The real onMsg and renderPlayers run. */
  var fns = ["rosterKey", "playerCount", "onMsg", "renderPlayers", "esc"].map(function(n){ return grab(n, host); });
  pass("the join path is where this test lifts it from", !!fns[1] && !!fns[2] && !!fns[3]);
  var list = { innerHTML: "" }, sent = [];
  var G = { status: "lobby", players: {}, order: [], peak: 0 };
  var env = { G: G, $: function(id){ return id === "playerList" ? list : { textContent: "" }; }, window: {},
              sendPlayers: function(){ sent.push(G.order.length); }, sendState: function(){}, renderJoinCounts: function(){},
              tvHere: function(){}, hostError: function(){} };
  var names = Object.keys(env);
  var api = (new Function(names.join(","), fns.join("\n") + "\n return { onMsg: onMsg, count: playerCount, render: renderPlayers };")).apply(null, names.map(function(k){ return env[k]; }));
  api.onMsg({ t: "join", pid: "k1_samkeyfingerprint", name: "Phone Sam", cards: 1, did: "devsam000001" });   // bingo page, answering rollcall
  api.onMsg({ t: "join", pid: "k1_jokeyfingerprint0", name: "Phone Jo", cards: 1, did: "devjo0000001" });
  api.onMsg({ t: "join", pid: "msam1234abcd", name: "Phone Sam", did: "devsam000001" });                     // musical page, same phone
  api.onMsg({ t: "join", pid: "mjo01234abcd", name: "Phone Jo", did: "devjo0000001" });
  api.onMsg({ t: "join", pid: "msam1234abcd", name: "Phone Sam", did: "devsam000001" });                     // and again, on a reconnect
  api.render();
  pass("two phones on two pages each are TWO players, not four", api.count() === 2, api.count());
  pass("and each name is listed once", (list.innerHTML.match(/Phone Sam/g) || []).length === 1 && (list.innerHTML.match(/Phone Jo/g) || []).length === 1, list.innerHTML);
  api.onMsg({ t: "join", pid: "mann1234abcd", name: "Ann", did: "devann000001" });
  api.onMsg({ t: "join", pid: "oldpage00001", name: "Bob" });                                                // an older page with no device id
  pass("CONTROL: a different phone is a new player, and a join with no device id still counts by its pid", api.count() === 4, api.count());
  api.onMsg({ t: "join", pid: "oldpage00001", name: "Bob", did: "devbob000001" });                          // the same pid, now with its device id
  pass("a pid seen first without a device id is not counted twice once it sends one", api.count() === 4, api.count());
})();

/* 7. END GAME, TAPPED TWICE (live play at Test Charlie, 27 Oct 2026). vpAsk queues a question asked while
   one is open, so a double tap on End game put a second "End this game?" up AFTER the first OK had
   already ended the game. The real endGame runs against a vpAsk that behaves like the shipped one:
   each call is a prompt, answered by the test in order. */
(function(){
  var fn = grab("endGame", host);
  pass("End game is where this test lifts it from", !!fn);
  var prompts = [], ended = 0;
  function vpAsk(msg){ var t = { msg: msg, then: function(ok, no){ t.ok = ok; t.no = no; return t; } }; prompts.push(t); return t; }
  function answer(v){ var t = prompts.shift(); if (!t) throw new Error("no prompt open to answer"); t.ok(v); }
  var G = { busy: false, status: "running", gameId: "g1" };
  var env = { G: G, vpAsk: vpAsk, endGameAsked: function(){ ended++; G.status = "setup"; G.gameId = ""; } };
  var names = Object.keys(env);
  var endGame = (new Function(names.join(","), fn + "\n return endGame;")).apply(null, names.map(function(k){ return env[k]; }));
  endGame(); endGame(); endGame();
  pass("three taps on End game open ONE prompt", prompts.length === 1 && prompts[0].msg.indexOf("End this game?") === 0, prompts.length);
  answer(true);
  pass("OK ends the game once", ended === 1 && G.status === "setup", ended);
  endGame();
  pass("a tap after the game has ended does nothing: no second prompt", prompts.length === 0 && ended === 1, prompts.length);
  /* and it must not make End game dead: Cancel, then a second thought */
  G.status = "running"; G.gameId = "g2";
  endGame();
  pass("CONTROL: with a game running the prompt comes up", prompts.length === 1, prompts.length);
  answer(false);
  pass("CONTROL: Cancel leaves the game running", ended === 1 && G.status === "running", G.status);
  endGame();
  pass("CONTROL: and End game can be asked again after a Cancel", prompts.length === 1, prompts.length);
  answer(true);
  pass("CONTROL: the second time it is confirmed, the game ends", ended === 2 && G.status === "setup", ended);
  /* a prompt that the game outlives (a full house ended it from the carry-on modal while the question was open) */
  G.status = "running"; G.gameId = "g3";
  endGame();
  G.status = "setup"; G.gameId = "";   // endGameNow() ran meanwhile
  answer(true);
  pass("an OK on a prompt the game outlived ends nothing twice", ended === 2, ended);
})();

print("");
print(bad ? ("  " + bad + " FAILED") : ("ALL " + ran + " CHECKS PASSED"));
if (bad) throw new Error(bad + " failed");
