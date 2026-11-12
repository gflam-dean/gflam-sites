/* THE COASTER PAGE'S OWN LOGIC, RUN (/live-here-now v2, Dean 4 Nov 2026).

   venueplay/live-here-now.html keeps everything that decides WHAT the page says in one block with no
   screen, no network and no clock read inside it (var VPCoaster ... END LOGIC). This lifts that block
   out of the shipped page and runs it:
     - the hour's five: the same on every phone in an hour, different the next hour, never one this
       phone has seen, and a challenge link's five taken from the bank in its order
     - the first name the phone shows is the first word only, as the Worker keeps it
     - "Correct! +130", "Nice one, Sam", "4 of 5", "520 points", "2nd tonight at The Mini Bar"
     - the challenge link is venueplay.com.au (never a .dev address) and its words follow the house rules
     - the board escapes every name and marks only your own row
   and holds the page to the numbers it shares with the game Worker (five a round, the 1.3 second
   reveal the Worker's clock allows for) and to the copy rules for a public page. The page played by
   tapping, at 320 / 375 / 390 / 430 and desktop, is tools/live-here-now-in-chrome.test.py.

   Run: jsc venueplay-backend/worker/coaster-page.test.js
*/
var bad = 0, ran = 0;
function pass(n, c, extra) {
  if (typeof n !== "string" || typeof c !== "boolean") throw new Error("pass(name, boolean) called wrongly for " + n);
  ran++; print((c ? "  ok   " : "  FAIL ") + n + (c || extra === undefined ? "" : "   saw: " + JSON.stringify(extra).slice(0, 300))); if (!c) bad++;
}
function find(rel) {
  var tries = [rel, "../" + rel, "../../" + rel, "../../../" + rel];
  for (var i = 0; i < tries.length; i++) { try { var t = readFile(tries[i]); if (t && t.length > 1000) return t; } catch (e) {} }
  throw new Error("cannot find " + rel);
}
var PAGE = find("venueplay/live-here-now.html");
var GAME = find("venueplay-backend/worker/venueplay-game.js");
var BANK = JSON.parse(find("venueplay/data/live-here-now.json")).q;

var a = PAGE.indexOf("var VPCoaster = (function () {"), b = PAGE.indexOf("/* ===== END LOGIC ===== */", a);
pass("the page's logic block is in the shipped page", a > 0 && b > a);
var LOGIC = PAGE.slice(a, b);
pass("the logic block reads no screen, network or clock", !/document\.|XMLHttpRequest|fetch\(|localStorage|Date\.now|new Date/.test(LOGIC));
var L = new Function(LOGIC + "\nreturn VPCoaster;")();

print("\nTHE HOUR'S FIVE");
var H = 491234;
var p1 = L.pickFive(BANK, H, []), p2 = L.pickFive(BANK, H, []);
var ids = function (x) { return x.map(function (q) { return q[0]; }).join(","); };
pass("five questions, all different", p1.length === 5 && ids(p1).split(",").filter(function (x, i, arr) { return arr.indexOf(x) === i; }).length === 5);
pass("two phones in the same hour get the same five (a fair 'beat the table')", ids(p1) === ids(p2));
pass("the next hour is a different five", ids(L.pickFive(BANK, H + 1, [])) !== ids(p1));
var seen = p1.map(function (q) { return q[0]; });
var p3 = L.pickFive(BANK, H, seen);
pass("Play again: five more, none of them seen", p3.length === 5 && p3.every(function (q) { return seen.indexOf(q[0]) < 0; }));
var tiny = BANK.slice(0, 6);
var allSeen = tiny.map(function (q) { return q[0]; });
pass("a phone that has seen the whole bank still gets five", L.pickFive(tiny, H, allSeen).length === 5);
var five = BANK.slice(10, 15).map(function (q) { return q[0]; });
var got = L.byIds(BANK, five);
pass("a challenge link's five come from the bank in its order", got && ids(got) === five.join(","), got && ids(got));
pass("a challenge whose question has left the bank gives null (the page plays a fresh round)", L.byIds(BANK, five.slice(0, 4).concat(["gone"])) === null);
pass("four ids are not a round", L.byIds(BANK, five.slice(0, 4)) === null);

print("\nTHE FIRST NAME");
pass("'  sam smith' shows as 'Sam' (first word, no surname)", L.firstName("  sam smith") === "Sam", L.firstName("  sam smith"));
pass("an apostrophe and a hyphen stay: o'neil-ray", L.firstName("o'neil-ray") === "O'neil-ray");
pass("accents stay: zoë", L.firstName("zoë") === "Zoë");
pass("digits alone are not a name", L.firstName("0412 345 678") === "");
pass("a long name is cut to 14 letters, as the Worker keeps it", L.firstName("Maximilianalexander").length === 14);
var wf = /function coasterFirstName\(raw\) \{[\s\S]*?\n\}/.exec(GAME);
pass("the Worker keeps the same 14 letters and the same letters", !!wf && /\.slice\(0, 14\)/.test(wf[0]) && wf[0].indexOf("[^A-Za-z\\u00C0-\\u024F'\\-]") > 0);
pass("three letters means three letters after a leading 'the'", L.letters("the mi") === 2 && L.letters("Roy") === 3 && L.letters("The Royal") === 5);

print("\nWHAT THE PAGE SAYS");
pass("a right answer with points says 'Correct!' and '+130'", L.verdict(true, 130).text === "Correct!" && L.verdict(true, 130).pts === "+130");
pass("before the board answers, 'Correct!' with no number", L.verdict(true, 0).pts === "");
pass("a wrong answer says 'Not quite' and no points", L.verdict(false, 130).text === "Not quite" && L.verdict(false, 130).pts === "");
pass("4 of 5 is 'Nice one, Sam' (Dean: \"Nice one, Sam: 4 of 5\")", L.headline("Sam", 4, 5) === "Nice one, Sam");
pass("5 of 5 is 'Perfect round, Sam'", L.headline("Sam", 5, 5) === "Perfect round, Sam");
pass("0 of 5 is kind about it", L.headline("Sam", 0, 5) === "Tough round, Sam");
pass("'520 points, 81 seconds'", L.pointsLine(520, 81) === "520 points, 81 seconds");
pass("one point and one second are singular", L.pointsLine(1, 1) === "1 point, 1 second");
pass("'2nd tonight at The Mini Bar'", L.placeLine(2, "night", "The Mini Bar") === "2nd tonight at The Mini Bar");
pass("'1st this week at Tugun Tavern'", L.placeLine(1, "week", "Tugun Tavern") === "1st this week at Tugun Tavern");
pass("past the top 200 it says 'On the board', never a wrong place", L.placeLine(null, "night", "The Mini Bar") === "On the board tonight at The Mini Bar");
var ords = [1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111, 112].map(L.ordinal).join(" ");
pass("places read 1st 2nd 3rd 4th 11th 12th 13th 21st 22nd 23rd 101st 111th 112th", ords === "1st 2nd 3rd 4th 11th 12th 13th 21st 22nd 23rd 101st 111th 112th", ords);
pass("a coaster venue reads 'Tugun 4224'", L.placeLabel({ suburb: "Tugun", postcode: "4224", state: "QLD" }) === "Tugun 4224");
pass("a venueplay venue (no suburb held) reads '2485 NSW'", L.placeLabel({ suburb: "", postcode: "2485", state: "NSW" }) === "2485 NSW");
pass("a venue on our list (no postcode shown) reads 'Bodalla NSW'", L.placeLabel({ suburb: "Bodalla", postcode: "", state: "NSW" }) === "Bodalla NSW");
pass("only a venue with a venueplay login reads 'On venueplay' ('Game on now' while a game is open); every other pick reads 'Not on venueplay yet'",
  L.statusWords({ on: true }).text === "On venueplay" && L.statusWords({ on: true, live: true }).text === "Game on now" && L.statusWords({ on: false, live: true }).text === "Not on venueplay yet" &&
  L.statusWords({}).text === "Not on venueplay yet" && L.statusWords({ on: true }).cls === "on" && L.statusWords({ on: false }).cls === "off");
pass("Add it: name, suburb and one of the eight states are needed; the website is optional but must look like one",
  L.addCheck({ name: "Royal Hotel", suburb: "Bowral", state: "NSW", website: "" }) === null && L.addCheck({ name: "Royal Hotel", suburb: "Bowral", state: "NSW", website: "royalhotel.com.au" }) === null &&
  L.addCheck({ name: "ab", suburb: "Bowral", state: "NSW" }).field === "name" && L.addCheck({ name: "Royal Hotel", suburb: "", state: "NSW" }).field === "suburb" &&
  L.addCheck({ name: "Royal Hotel", suburb: "Bowral", state: "" }).field === "state" && L.addCheck({ name: "Royal Hotel", suburb: "Bowral", state: "NSW", website: "not a site" }).field === "website" &&
  L.STATES.join() === "QLD,NSW,VIC,SA,WA,TAS,NT,ACT");

print("\nTHE CHALLENGE LINK");
pass("the link is venueplay.com.au/live-here-now?c=CODE", L.shareUrl("ABC234") === "https://venueplay.com.au/live-here-now?c=ABC234");
var st = L.shareText("Sam", 4, 520, "The Mini Bar");
pass("its words: 'Sam got 4 of 5 (520 points) at The Mini Bar. Same five questions: can you beat it?'", st === "Sam got 4 of 5 (520 points) at The Mini Bar. Same five questions: can you beat it?", st);
pass("the code is read from ?c=, in capitals", L.readCode("?c=abc234") === "ABC234" && L.readCode("?v=the-mini-bar&c=ABC234") === "ABC234");
pass("anything else is not a code", L.readCode("?c=abc") === "" && L.readCode("?c=abcdefg") === "" && L.readCode("?cc=ABC234") === "");

print("\nTHE BOARD");
var html = L.boardHtml([{ place: 1, name: "<img src=x onerror=alert(1)>", points: 600, you: false }, { place: 2, name: "Sam", points: 520, you: true }], "night");
pass("a name is escaped, never drawn as HTML", html.indexOf("<img") < 0 && html.indexOf("&lt;img") >= 0, html);
pass("only your own row is marked", (html.match(/class="row you"/g) || []).length === 1 && /Sam \(you\)/.test(html));
pass("places and points are on each row", /<span class="rk">1st<\/span>/.test(html) && /<span class="pt">520<\/span>/.test(html));
pass("an empty board invites the mates", /Nobody on the board tonight yet/.test(L.boardHtml([], "night")) && /this week/.test(L.boardHtml([], "week")));
var canonical = 'function esc(s){ return String(s==null?"":s).replace(/[&<>"\']/g,function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;",\'"\':"&quot;","\'":"&#39;"}[c]; }); }';
pass("esc() is the site's one esc, character for character", LOGIC.indexOf(canonical) >= 0);

print("\nTHE PAGE AND THE WORKER AGREE");
var reveal = /const COASTER_REVEAL_MS = (\d+);/.exec(GAME), pause = /var PAUSE_MS = (\d+);/.exec(PAGE);
pass("the page's reveal pause is the 1.3 seconds the Worker's clock allows for", !!reveal && !!pause && reveal[1] === pause[1], [reveal && reveal[1], pause && pause[1]]);
var rnd = /const COASTER_ROUND = (\d+);/.exec(GAME);
pass("five a round on both sides", !!rnd && +rnd[1] === L.PER_SCAN && L.PER_SCAN === 5);
pass("the page talks to game.venueplay.com.au (never a .dev address)", /var API = window\.VP_GAME_API \|\| 'https:\/\/game\.venueplay\.com\.au';/.test(PAGE));
var beginFn = PAGE.slice(PAGE.indexOf("  function begin() {"), PAGE.indexOf("  /* the clock: counts up, never down */"));
pass("a round sends only the first name, the place and the five ids (or a challenge code)",
  /var body = S\.code \? \{ name: S\.name, code: S\.code \} : \{ name: S\.name, place: S\.place, qids: local\.map\(function \(q\) \{ return q\[0\]; \}\) \};/.test(beginFn));
pass("with no venue picked (Just play), nothing is sent and the round plays on the phone", /if \(!S\.code && !S\.place\) return go\('local', local\);/.test(beginFn));
pass("a refused or failed start plays the round on the phone, never a dead page", /go\('local', local\);\n    \}\);/.test(beginFn));
var ans = PAGE.slice(PAGE.indexOf("  function answer(i) {"), PAGE.indexOf("  /* 4. THE END */"));
pass("each answer goes to /coaster/answer with only the round, its secret, the question and the letter", /call\('POST', '\/coaster\/answer', \{ play: S\.play, token: S\.token, i: n, a: i \}/.test(ans));
pass("a board that stops answering mid-round finishes the round on the phone", /S\.mode = 'local';      \/\/ the board went away mid-round/.test(ans));

print("\nTHE TIME (INBOX 310/311: 'Done in 2062 seconds' on a 60-second round)");
var secsW = /const COASTER_SECS = (\d+);/.exec(GAME);
pass("the ring's 20 seconds a question is the Worker's own", !!secsW && +secsW[1] === L.QUESTION_SECS && L.QUESTION_SECS === 20, secsW && secsW[1]);
pass("a question's time is shown to tapped: 4.2 s", L.tookMs(1000, 5200) === 4200);
pass("...never more than its 20 seconds (a phone left on the table for 34 minutes)", L.tookMs(1000, 1000 + 2062000) === 20000);
pass("...and never less than nothing (a clock that went backwards)", L.tookMs(5000, 1000) === 0);
pass("the round's time is the five added up: 2 + 10 + 5 + 20 + 4 = 41 s", L.roundSecs([2000, 10000, 5000, 20000, 4000]) === 41);
pass("five questions can never come to more than 100 seconds, whatever is passed in", L.roundSecs([2062000, 99999999, 20000, 20000, 20000]) === 100);
pass("the ring reads 20 at the start, 15 after 5 s, 0 at 20 s and after", L.secsLeft(0, 0) === 20 && L.secsLeft(0, 5000) === 15 && L.secsLeft(0, 20000) === 0 && L.secsLeft(0, 99000) === 0);
pass("'Done in 41 seconds.' and 'Done in 1 second.'", L.doneLine(41) === "Done in 41 seconds." && L.doneLine(1) === "Done in 1 second.");
var fin = PAGE.slice(PAGE.indexOf("  function finish() {"), PAGE.indexOf("  function paintBoard("));
pass("the end's time is the questions' own times added up (roundSecs of tooks), never a start time from page load or a visit",
  /L\.doneLine\(L\.roundSecs\(tooks\)\)/.test(fin) && !/startedAt|stoppedAt|secs\(\)/.test(PAGE), fin.slice(0, 200));
var ansFn = PAGE.slice(PAGE.indexOf("  function answer(i) {"), PAGE.indexOf("  /* 4. THE END */"));
pass("each answer keeps that question's own time, from when it was shown", /tooks\.push\(L\.tookMs\(shownAt, Date\.now\(\)\)\);/.test(ansFn) && /shownAt = Date\.now\(\);/.test(PAGE.slice(PAGE.indexOf("  function show() {"), PAGE.indexOf("  function tag("))));
pass("tooks start empty for every round", /results = \[\]; total = 0; ended = null; tooks = \[\];/.test(PAGE));
pass("the ring is the trivia phone's (one copy: /app/vp-qring.css and vp-qring.js, also loaded by the trivia phone)",
  /<link rel="stylesheet" href="\/app\/vp-qring\.css">/.test(PAGE) && /<script src="\/app\/vp-qring\.js"><\/script>/.test(PAGE) && /id="pqRing"/.test(PAGE) &&
  PAGE.indexOf(".pq-ring{flex") < 0 && PAGE.indexOf(".pq-ring .rfg{") < 0 && /window\.VPQRing\.paint\(\$\('pqRing'\), \$\('pqCdNum'\)/.test(PAGE));
pass("when the ring hits 0: Time's up, then the answer is sent as -1 (the Worker's time's up)",
  /if \(left <= 0\) \{ clearInterval\(ticker\); timeUp\(\); \}/.test(PAGE) && /window\.VPQRing\.timesUp\(\);\n    setTimeout\(function \(\) \{ answer\(-1\); \}, 900\);/.test(PAGE));
pass("Time's up reads as such, not 'Not quite'", L.verdict(null, 0).text === "Time's up" && L.verdict(false, 0).text === "Not quite");

print("\nPICK OR ADD A VENUE, AND TEXT YOUR MATES (INBOX 309.1)");
pass("there is no 'Just play, no board': Play now is hidden, shown only while the search is down",
  /<button class="linkbtn quiet" id="skipWhere" type="button" hidden>Play now<\/button>/.test(PAGE) && PAGE.indexOf("Just play, no board") < 0 &&
  /\$\('whereHint'\)\.textContent = 'The search is having a rest\. Try again in a minute, or just play\.'; \$\('skipWhere'\)\.hidden = false; return; \}/.test(PAGE) &&
  /\$\('skipWhere'\)\.hidden = true;\n      var m = d\.matches/.test(PAGE));
pass("not on our list: the Add your venue form drops down straight away with what they typed", /if \(!m\.length\) openLead\(typed\);/.test(PAGE));
var sms = L.smsHref("Sam got 4 of 5 (520 points). Same five questions: can you beat it?", "https://venueplay.com.au/live-here-now?c=ABC234");
pass("Challenge your mates opens a text message with the words and the link", sms === "sms:?&body=" + encodeURIComponent("Sam got 4 of 5 (520 points). Same five questions: can you beat it? https://venueplay.com.au/live-here-now?c=ABC234"), sms);
pass("...the text first, the link to copy second", /window\.location\.href = L\.smsHref\(text, url\);/.test(PAGE) && PAGE.indexOf('id="challenge"') < PAGE.indexOf('id="copyLink"') && /Or copy the link/.test(PAGE));

print("\nA PUBLIC PAGE'S RULES");
var css = PAGE.slice(PAGE.indexOf("<style>"), PAGE.indexOf("</style>"));
var small = (css.match(/font-size:\s*(\d+(?:\.\d+)?)px/g) || []).filter(function (x) { return parseFloat(x.replace(/[^\d.]/g, "")) < 15; });
pass("nothing on the page is under 15px", small.length === 0, small);
var text = PAGE.replace(/<!--[\s\S]*?-->/g, "").replace(/<script[\s\S]*?<\/script>/g, function (s) { return s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, ""); });
pass("'From a venue? Click here' goes to /coaster, today's offer, never the home page", /<a class="owner" id="ownerLink" href="\/coaster">From a venue\? Click here<\/a>/.test(PAGE));
pass("the games are named in order: trivia, musical bingo, bingo", /Trivia, musical bingo and bingo on the pub TV/.test(PAGE) && !/Trivia, bingo and musical bingo/.test(PAGE));
/* The one exception is the legal line, the same on every page of the site (test-terms-put-compliance-on-the-venue.js). */
pass("'venueplay' is lowercase wherever a person reads it (the legal footer line aside)", !/VenuePlay|Venueplay|VENUEPLAY/.test(text.replace("Gflam Group Pty Ltd, trading as VenuePlay", "")));
pass("no em dash anywhere", PAGE.indexOf("—") < 0);
pass("no phone number on a public page", !/07 ?5228|5228 ?3667|04\d\d ?\d{3} ?\d{3}/.test(text));
pass("no .dev or workers.dev address", !/workers\.dev|\.dev\b/.test(PAGE));
pass("never 'roster'", !/roster/i.test(text));
pass("no price or offer on the coaster page itself", !/\$\d|offer/i.test(text.replace(/\/\*[\s\S]*?\*\//g, "")));
pass("the only inputs: the first name, the venue search, the four 'Add it' boxes (name, suburb, state, website), the challenge link, and the venue's own sign-up (email, mobile)",
  (PAGE.match(/<input /g) || []).length === 8 && (PAGE.match(/<select /g) || []).length === 1 && ["nameIn", "whereIn", "leadIn", "leadSuburb", "leadSite", "optinEmail", "optinMobile"].every(function (id) { return PAGE.indexOf('id="' + id + '"') > 0; }) &&
  /<select id="leadState">/.test(PAGE) && /id="copyUrl" readonly/.test(PAGE), (PAGE.match(/<input [^>]*id="[^"]+"/g) || []).map(function (x) { return /id="([^"]+)"/.exec(x)[1]; }));
pass("the sign-up is hidden until the Worker says this venue has it switched on, and its one tick is the phones' own (VPConsent, consent_version)",
  /<form class="optin-card" id="optinCard" novalidate hidden>/.test(PAGE) && /<script src="\/app\/vp-consent\.js"><\/script>/.test(PAGE) &&
  /window\.VPConsent\.render\(tick, /.test(PAGE) && /body\.consent_version = window\.VPConsent\.VERSION/.test(PAGE) && /var o = S\.optin, card = \$\('optinCard'\);/.test(PAGE) && !/checked/.test(PAGE.slice(PAGE.indexOf('id="optinCard"'), PAGE.indexOf('id="optinOk"'))));
pass("the old free-text board is gone: an added venue is sent to /coaster/lead and the round starts with NO place",
  /call\('POST', '\/coaster\/lead', f, /.test(PAGE) && /S\.place = null; S\.venue = null;\n      setTimeout\(begin,/.test(PAGE) && !/choose\(d\.place/.test(PAGE));

print("");
if (bad) { print(bad + " OF " + ran + " CHECKS FAILED"); throw new Error(bad + " failed"); }
print("ALL " + ran + " CHECKS PASSED");
