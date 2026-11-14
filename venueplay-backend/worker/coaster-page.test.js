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
pass("a result shows the suburb and the state: 'Tugun, QLD' (INBOX 396.3)", L.placeLabel({ suburb: "Tugun", postcode: "4224", state: "QLD" }) === "Tugun, QLD");
pass("never a postcode: a venue with no suburb held reads just 'NSW', not '2000 NSW'", L.placeLabel({ suburb: "", postcode: "2000", state: "NSW" }) === "NSW" && !/\d/.test(L.placeLabel({ suburb: "Bodalla", postcode: "2537", state: "NSW" })));
pass("venueplay venues come first, a game on now before the rest, the Worker's order kept otherwise (396.b)",
  L.playableFirst([{ n: 1 }, { n: 2, on: true }, { n: 3, on: true, live: true }, { n: 4 }, { n: 5, on: true }]).map(function (m) { return m.n; }).join() === "3,2,5,1,4");
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
var TOP = L.shareText(435, "The Mini Bar", 4), OUT = L.shareText(435, "The Mini Bar", 0);
pass("in tonight's top 10 the words are: I'm 4th on the Coaster Trivia board at The Mini Bar tonight. Come down and knock me off. (396 update 4)", TOP === "I'm 4th on the Coaster Trivia board at The Mini Bar tonight. Come down and knock me off.", TOP);
pass("outside the top 10 the words are: I scored 435 on Coaster Trivia at The Mini Bar. Your turn. Reckon you can beat it?", OUT === "I scored 435 on Coaster Trivia at The Mini Bar. Your turn. Reckon you can beat it?", OUT);
pass("10th place is in the top 10, 11th is out", /10th on the Coaster/.test(L.shareText(100, "X", 10)) && /^I scored 100 on Coaster Trivia/.test(L.shareText(100, "X", 11)));
pass("the venue is always named in the text", /The Mini Bar/.test(TOP) && /The Mini Bar/.test(OUT) && /my pub/.test(L.shareText(5, "", 0)));
pass("NO drink, shout, round or booze wording anywhere in the share words (liquor licensing: never promote drinking)",
  !/drink|shout|beer|round|pint|booze|bar tab|cheers|wine|shot/i.test(TOP.replace("The Mini Bar", "") + OUT.replace("The Mini Bar", "")) && !/\b(drink|shout|next round|beer|pint|booze)\b/i.test(PAGE.slice(PAGE.indexOf("function shareText("), PAGE.indexOf("var SHARE_TITLE"))));
var ORD = { 1: "1st", 2: "2nd", 3: "3rd", 4: "4th", 10: "10th", 11: "11th", 12: "12th", 13: "13th", 14: "14th", 21: "21st", 22: "22nd", 23: "23rd", 24: "24th", 101: "101st", 111: "111th", 112: "112th", 113: "113th", 121: "121st", 122: "122nd", 123: "123rd" };
pass("ordinals are right: 1st 2nd 3rd 4th, the teens 11th 12th 13th, 21st 22nd 23rd, 101st 111th 112th 113th 121st", Object.keys(ORD).every(function (k) { return L.ordinal(+k) === ORD[k]; }), Object.keys(ORD).filter(function (k) { return L.ordinal(+k) !== ORD[k]; }));
pass("the share words use the shared place: two on 725 are both 1st (the one on 580 is 3rd), top 10 only",
  L.topTenPlace([{ place: 1, points: 725 }, { place: 2, points: 725, you: true }, { place: 3, points: 580 }]) === 1 && L.topTenPlace([{ place: 1, points: 725 }, { place: 2, points: 725 }, { place: 3, points: 580, you: true }]) === 3 &&
  L.topTenPlace((function () { var r = []; for (var i = 1; i <= 11; i++) r.push({ place: i, points: 1000 - i, you: i === 11 }); return r; })()) === 0);
pass("the game's name is Coaster Trivia: page title, og title, the line before a venue is picked, and the share sheet's title",
  /<title>Coaster Trivia \| venueplay<\/title>/.test(PAGE) && /og:title" content="Coaster Trivia \| venueplay"/.test(PAGE) && /id="hdrVenueName">Coaster Trivia</.test(PAGE) && L.SHARE_TITLE === "Coaster Trivia" && /'Playing at ' \+ venueName/.test(PAGE));
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
  /<button class="linkbtn" id="skipWhere" type="button" hidden>Play now<\/button>/.test(PAGE) && PAGE.indexOf("Just play, no board") < 0 &&
  /\$\('whereHint'\)\.textContent = 'The search is having a rest\. Try again in a minute, or just play\.'; \$\('skipWhere'\)\.hidden = false; return; \}/.test(PAGE) &&
  /\$\('skipWhere'\)\.hidden = true;\n      var m = d\.matches/.test(PAGE));
pass("the venue step asks 'What venue are you at?' (Dean 12 Nov, INBOX 309.1a), never 'Where are you playing?'",
  /<h[12] class="vp-h one" id="whereHead">What venue are you at\?<\/h[12]>/.test(PAGE) && PAGE.indexOf("Where are you playing") < 0);
pass("not on our list: the Add your venue form drops down straight away with what they typed", /if \(!m\.length\) openLead\(typed\);/.test(PAGE));
var sms = L.smsHref("I scored 520 at The Mini Bar. Reckon you can beat me?", "https://venueplay.com.au/live-here-now?c=ABC234");
pass("the text-message fallback opens Messages with the words and the link", sms === "sms:?&body=" + encodeURIComponent("I scored 520 at The Mini Bar. Reckon you can beat me? https://venueplay.com.au/live-here-now?c=ABC234"), sms);
pass("Share (396 update 2): 'Want to challenge your mates?' then ONE pink Share button; navigator.share gets title, words and link; a cancelled share (AbortError) says nothing; no share sheet means the text message and Copy link ('Link copied')",
  /<p class="cq">Want to challenge your mates\?<\/p>\s*<button class="btn pink" id="challenge" type="button">Share<\/button>/.test(PAGE) &&
  /navigator\.share\(\{ title: L\.SHARE_TITLE, text: c\.text, url: c\.url \}\)/.test(PAGE) && /err\.name === 'AbortError'\) return;/.test(PAGE) &&
  /if \(!canShare\(\)\) return textFallback\(\);/.test(PAGE) && /textContent = 'Link copied'/.test(PAGE) && /Text your mates a challenge/.test(PAGE) &&
  PAGE.indexOf('id="challengeBox"') < PAGE.indexOf('id="board"'));
pass("equal scores share a place (725 and 725 are both 1st, the next is 3rd), and your own place follows it", L.sharedPlaces([{ place: 1, points: 725 }, { place: 2, points: 725 }, { place: 3, points: 580 }]).join() === "1,1,3" &&
  L.myPlace([{ place: 1, points: 725 }, { place: 2, points: 725, you: true }], 2) === 1);
pass("the reveal beat: 'The answer was B' and 'Time's up. The answer was B.'", L.verdict(false, 0, "B").text === "The answer was B" && L.verdict(null, 0, "B").text === "Time's up. The answer was B." && L.verdict(true, 120, "B").text === "Correct!");
pass("the sting plays before question 1 and the round starts after it (Worker clock); sound starts ON (update 7) at half volume (update 8) with the switch top right",
  /<script src="\/app\/vp-sting\.js"><\/script>/.test(PAGE) && /ST\.start\(\{ words: ST\.phoneWords\('TRIVIA'\), layout: 'phone' \}\)/.test(PAGE) && /if \(ST && ST\.on && !startShow\) \{/.test(PAGE) && /setItem\('vpqMute', '0'\)/.test(PAGE) && /id="soundTxt">Sound on</.test(PAGE) === false && /window\.VP_SOUND_GAIN = 0\.5/.test(PAGE));

print("\nA PUBLIC PAGE'S RULES");
var css = PAGE.slice(PAGE.indexOf("<style>"), PAGE.indexOf("</style>"));
var small = (css.match(/font-size:\s*(\d+(?:\.\d+)?)px/g) || []).filter(function (x) { return parseFloat(x.replace(/[^\d.]/g, "")) < 15; });
/* the one exception is Dean's own: "Can't find your venue? Add it" is 3/4 the size of the search placeholder (INBOX 405 update 4) */
var addlink = /\.addlink\{font-size:12px;/.test(css);
pass("nothing on the page is under 15px (but the Add it link, 12px at Dean's word, and the offers line that shrinks to fit)", small.length === (addlink ? 1 : 0) && (!addlink || small[0] === "font-size:12px"), small);
var text = PAGE.replace(/<!--[\s\S]*?-->/g, "").replace(/<script[\s\S]*?<\/script>/g, function (s) { return s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, ""); });
pass("'From a venue? Click here' goes to /coaster, today's offer, never the home page", /<a class="owner" id="ownerLink" href="\/coaster">From a venue\? Click here<\/a>/.test(PAGE));
pass("the games are named in order: trivia, musical bingo, bingo", /Trivia, musical bingo and bingo on the pub TV/.test(PAGE) && !/Trivia, bingo and musical bingo/.test(PAGE));
/* The one exception is the legal line, the same on every page of the site (test-terms-put-compliance-on-the-venue.js). */
pass("'venueplay' is lowercase wherever a person reads it (the legal footer line aside)", !/VenuePlay|Venueplay|VENUEPLAY/.test(text));
pass("no em dash anywhere", PAGE.indexOf("—") < 0);
pass("no phone number on a public page", !/07 ?5228|5228 ?3667|04\d\d ?\d{3} ?\d{3}/.test(text));
pass("no .dev or workers.dev address", !/workers\.dev|\.dev\b/.test(PAGE));
pass("never 'roster'", !/roster/i.test(text));
pass("no price or offer on the coaster page itself", !/\$\d|offer/i.test(text.replace(/\/\*[\s\S]*?\*\//g, "")));
pass("the only inputs: the first name, the venue's own sign-up (last name, email, mobile), the venue search, the TWO 'Add it' boxes (name and suburb only, INBOX 405.7) and the challenge link",
  (PAGE.match(/<input /g) || []).length === 8 && (PAGE.match(/<select /g) || []).length === 0 && ["nameIn", "lastIn", "whereIn", "leadIn", "leadSuburb", "optinEmail", "optinMobile"].every(function (id) { return PAGE.indexOf('id="' + id + '"') > 0; }) &&
  !/leadState|leadSite/.test(PAGE) && /id="copyUrl" readonly/.test(PAGE), (PAGE.match(/<input [^>]*id="[^"]+"/g) || []).map(function (x) { return /id="([^"]+)"/.exec(x)[1]; }));
print("\nYOUR DETAILS BEFORE PLAY (INBOX 309.1c)");
var det = PAGE.slice(PAGE.indexOf("  function askDetails(venueName, added) {"), PAGE.indexOf("  /* the details go with the round"));
pass("the venue's rows show only when the Worker says this venue has its sign-up on (S.optin from /coaster/ask), with the phones' one tick (VPConsent), never ticked",
  /if \(o && \(o\.email \|\| o\.mobile\) && venueName && window\.VPConsent\) \{/.test(det) && /window\.VPConsent\.render\(\$\('optinTick'\), /.test(det) &&
  /<script src="\/app\/vp-consent\.js"><\/script>/.test(PAGE) && !/checked/.test(PAGE.slice(PAGE.indexOf('id="nameForm"'), PAGE.indexOf('id="nameBtn"'))));
pass("the venue first, then the details: picking a venueplay venue asks the Worker what to ask (/coaster/ask), anything else asks the name only",
  /if \(!\/\^v:\/\.test\(place\)\) return askDetails\(name\);/.test(PAGE) && /call\('GET', '\/coaster\/ask\?place=' \+ encodeURIComponent\(place\)/.test(PAGE) &&
  /else askWhere\(\);   \/\/ the venue first/.test(PAGE));
pass("a ticked sign-up carries consent_version; no tick, no consent recorded", /cap\.marketing_optin = !!\(window\.VPConsent && window\.VPConsent\.optedIn\(cap\)\);\n      if \(cap\.marketing_optin\) cap\.consent_version = window\.VPConsent\.VERSION;/.test(det.concat(PAGE.slice(PAGE.indexOf("  $('nameForm').addEventListener"), PAGE.indexOf("  function sendDetails()")))));
pass("the details go to /coaster/optin only once the round has started there (its secret proves the round), then are dropped from the page",
  /S\.optin = d\.optin \|\| null;\n[^\n]*VPPhoneAd[^\n]*\n          sendDetails\(\);/.test(PAGE) && /var c = S\.details;\n    S\.details = null;\n    if \(!c \|\| !S\.play \|\| !S\.optin\) return;/.test(PAGE));
pass("an added venue is sent to /coaster/lead and the round starts with NO place (no board from typed text)",
  /call\('POST', '\/coaster\/lead', f, /.test(PAGE) && /S\.place = \(st === 200 && d && \/\^c:\/\.test\(d\.place \|\| ''\)\) \? d\.place : null; S\.venue = null; S\.optin = null; S\.venueName = f\.name;\n[^\n]*\n[^\n]*\n      askDetails\(f\.name, st === 200\);/.test(PAGE) && !/choose\(d\.place/.test(PAGE));
pass("the page says nothing untrue or off-brand (396): no '60-second trivia', no lowercase 'Coaster trivia' eyebrow, no Gflam in the foot, no top header bar",
  !/60-second/i.test(PAGE) && !/Coaster trivia/.test(PAGE) && !/Gflam/.test(PAGE) && !/<header>/.test(PAGE));
pass("INBOX 405: no footer at all (no Help, Privacy or Terms, no (c) line, no divider above our logo); the game's own header says COASTER TRIVIA in the title spot; no pink glow or gradient",
  !/<footer/.test(PAGE) && !/&copy;|vp-year|href="\/help"|href="\/privacy"|href="\/terms"/.test(PAGE) && /<span class="vname" id="hdrVenueName">Coaster Trivia<\/span>/.test(PAGE) &&
  /<div class="ptop">/.test(PAGE) && /<div class="pfoot" id="footMark">/.test(PAGE) && !/radial-gradient|linear-gradient/.test(css) && !/shadow:[^;}]*(255,31,142|var\(--pink\))/.test(css));
pass("under the title, '5 questions, 20 seconds each' is the one honest line (396.a), and the search box carries its own placeholder (396.2)",
  /5 questions, 20 seconds each/.test(PAGE) && /placeholder="Start typing your pub or club"/.test(PAGE));
print("\nINBOX 405 UPDATES 4 TO 8");
pass("4.1 'Can't find your venue? Add it' sits straight under the search box (before the hint line), 3/4 the placeholder's size (12px of 16px), its tap area reaching past the text",
  PAGE.indexOf('id="whereIn"') < PAGE.indexOf('id="notListed"') && PAGE.indexOf('id="notListed"') < PAGE.indexOf('id="whereHint"') && /#whereIn::placeholder\{font-size:16px\}/.test(css) && /\.addlink\{font-size:12px;/.test(css) && /\.addlink::before\{content:"";position:absolute;left:0;right:0;top:0;bottom:-28px\}/.test(css));
pass("4.2 Add your venue is compact: no labels, two small fields and a small button (42px), a 15px heading",
  !/<label for="lead/.test(PAGE) && /\.addcard \.vp-field\{[^}]*min-height:42px/.test(css) && /\.addcard \.btn\{[^}]*min-height:42px/.test(css) && /\.addcard h2\{[^}]*font-size:15px/.test(css));
pass("4.3 buttons are smaller than before everywhere (48px, 17px, the join step's pill; ghost 44px)", /\.btn,\.vp-step \.vp-cta\{[^}]*min-height:48px;[^}]*font-size:17px/.test(css) && /\.btn\.ghost\{[^}]*min-height:44px/.test(css));
pass("4.4 Play sits low on the details step, the real join step's way (a growing spacer before it)", /<div class="vp-grow"><\/div>\s*<button class="vp-cta" id="nameBtn"/.test(PAGE) && /#nameForm \.vp-grow\{flex:1/.test(css));
pass("4.5 the venue's name sits under the title on the name step, the questions and the score (venueLine), the logo in the header when it has one",
  /<div class="vline" id="vline" hidden>/.test(PAGE) && /function venueLine\(name\)/.test(PAGE) && /venueLine\(''\);   \/\/ the name step already says/.test(PAGE) && /venueLine\(\(S\.venue && S\.venue\.name\) \|\| S\.venueName \|\| ''\);/.test(PAGE) && /img\.onload = function \(\) \{\n        img\.hidden = false; nm\.hidden = true;/.test(PAGE));
pass("4.6 the score is a bigger moment: the number pops in, the place stands out as a big chip, the game's confetti (vp-celebrate) bursts, Copy link is centred under Share",
  /#scoreN\.pop\{animation:scorepop/.test(css) && /\.placeline b\{[^}]*font-size:40px/.test(css) && /window\.VPCelebrate\.burst\(document\.body, place > 0 && place <= 3 \? 48 : 22, \{ className: 'cfetti' \}\)/.test(PAGE) && /\.challenge \.linkbtn\{margin:6px auto 0;justify-content:center/.test(css));
pass("4.7 the venue's own ad is the very bottom of the score (the last thing in it, before our logo), set from the round's venue and shown on the score only; the page loads vp-phonead.js and vp-tonight.css",
  PAGE.indexOf('id="vpAd"') > PAGE.indexOf('class="bigscreen"') && /<div id="vpAd" hidden><\/div>[^\n]*\n  <\/section>/.test(PAGE) && /VPPhoneAd\.set\(\(d\.venue && d\.venue\.slides\) \|\| \[\]/.test(PAGE) && /VPPhoneAd\.show\(id === 'score'\)/.test(PAGE) && /<script src="\/app\/vp-phonead\.js"><\/script>/.test(PAGE) && /vp-tonight\.css/.test(PAGE));
pass("6 the END show: the real game's phone show again before the score, \"THAT'S A WRAP\", held as long as the start show (phoneSeconds + 120 ms), the question screen hushed behind it; none with ?sting=0",
  /if \(ST && ST\.on && !endShow\) \{/.test(PAGE) && /words: \{ big: 'THAT\\u2019S A WRAP', small: 'COASTER TRIVIA' \}, layout: 'phone'/.test(PAGE) && /\(ST\.phoneSeconds \|\| 2\.3\) \* 1000\) \+ 120\);\n      return;\n    \}\n    showScore\(\);/.test(PAGE));
pass("8 every coaster sound is at half volume: the page sets VP_SOUND_GAIN 0.5 and vp-celebrate.js multiplies each sound by it (unchanged where no page sets it)",
  /window\.VP_SOUND_GAIN = 0\.5/.test(PAGE) && /root\.VP_SOUND_GAIN > 0 \? root\.VP_SOUND_GAIN : 1/.test(find("venueplay/app/vp-celebrate.js")));
pass("NO DRINK words anywhere a person or a link preview can read (liquor licensing): the title, description, og and twitter text and the visible words say none of drink, shout, pour, beer, pint, booze, cheers",
  (function () {
    var head = (PAGE.match(/<title>[^<]*<\/title>|<meta [^>]*content="[^"]*"/g) || []).join(" ");
    var vis = PAGE.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<style[\s\S]*?<\/style>/g, "").replace(/<!--[\s\S]*?-->/g, "");
    return !/\b(drinks?|shouts?|pour(ing)?|beer|pints?|booze|cheers)\b/i.test(head) && !/\b(drinks?|shouts?|pour(ing)?|beer|pints?|booze|cheers)\b/i.test(vis.replace(/<[^>]+>/g, " "));
  })() && /name="description" content="Five quick trivia questions while you wait for your mate\. Points for speed, a board for your pub tonight/.test(PAGE) && /og:description" content="Five quick trivia questions while you wait for your mate\. Can you beat your mates\?/.test(PAGE));
pass("the answers use the trivia phone's sizes: 24px, 21px for a longer answer (over 22 letters), 18px for the longest (over 40)",
  /font-size:24px;line-height:1\.12;/.test(css) && /\.panswers\.alen-2 \.ans\{font-size:21px\}/.test(css) && /\.panswers\.alen-3 \.ans\{font-size:18px\}/.test(css) && /alen > 40 \? ' alen-3' : alen > 22 \? ' alen-2' : ''/.test(PAGE));
pass("the offers line shrinks to ONE line (down to 12px) and a name too long even then wraps at 15px, never cut; the venue name line wraps too",
  /while \(sz > 12 && l\.scrollWidth > l\.clientWidth \+ 1\)/.test(PAGE) && /l\.style\.whiteSpace = 'normal'; t\.style\.fontSize = '15px'/.test(PAGE) && /\.vline span\{min-width:0;overflow-wrap:anywhere\}/.test(css));
pass("the end has no second sign-up card", PAGE.indexOf('id="optinCard"') < 0);

print("\nONE SOUND PLAYER, A NAMED SLOT PER MOMENT (INBOX 317/318)");
var CEL = find("venueplay/app/vp-celebrate.js"), QR = find("venueplay/app/vp-qring.js");
var tapFns = [];
var fakeRoot = { document: { addEventListener: function (ev, fn) { if (ev === "pointerdown") tapFns.push(fn); }, removeEventListener: function () {} }, localStorage: { getItem: function () { return null; }, setItem: function () {} }, location: { pathname: "/live-here-now", search: "" },
  Audio: function () { this.play = function () { fakeRoot.played = (fakeRoot.played || 0) + 1; }; }, navigator: {} };
new Function("window", "self", "root", CEL.replace(/\}\)\(typeof window !== ["']undefined["'] \? window : this\);?\s*$/, "})(window);"))(fakeRoot, fakeRoot, fakeRoot);
var VC = fakeRoot.VPCelebrate;
pass("vp-celebrate.js is the one sound player: named slots 'timesup', 'podium' and 'answerup' hold Dean's files (13 Nov 2026)", !!VC && VC.SOUNDS && /^\/app\/sounds\/.+\.mp3$/.test(VC.SOUNDS.timesup) && /^\/app\/sounds\/.+\.mp3$/.test(VC.SOUNDS.podium) && /^\/app\/sounds\/.+\.mp3$/.test(VC.SOUNDS.answerup) && typeof VC.sound === "function", VC && VC.SOUNDS);
tapFns.forEach(function (f) { f(); });   // the player has tapped the page
fakeRoot.played = 0;   // the first tap also warms the audio element with a silent clip: not a sound
pass("the coaster has no host switch, so its sounds stay off (the per-game Game sounds switch says OFF until told)", VC.sound("timesup") === false && VC.sound("podium") === false && !fakeRoot.played);
VC.SOUNDS.podium = "";
pass("an empty slot plays nothing (never a synth stand-in), even with its game ON", (VC.setGameSounds("trivia", true), VC.sound("podium")) === false && !fakeRoot.played);
VC.SOUNDS.podium = "/sounds/podium.mp3";
pass("dropping a file in a slot is all it takes: it then plays, after a tap, once the game's sounds are ON", VC.sound("podium") === true && fakeRoot.played === 1, fakeRoot.played);
VC.setGameSounds("trivia", false);
/* answerup (INBOX 282.5): a slot for the trivia answer going up before the clock reaches 0, played by the WALL (a TV is
   driven by a remote and is never tapped), never by a phone that has not been tapped. A fresh player with no tap yet. */
var fakeRoot2 = { document: { addEventListener: function () {}, removeEventListener: function () {} }, localStorage: { getItem: function () { return "1"; }, setItem: function () {} }, location: { pathname: "/app/trivia/screen", search: "" },
  Audio: function () { this.play = function () { fakeRoot2.played = (fakeRoot2.played || 0) + 1; }; }, navigator: {} };
new Function("window", "self", "root", CEL.replace(/\}\)\(typeof window !== ["']undefined["'] \? window : this\);?\s*$/, "})(window);"))(fakeRoot2, fakeRoot2, fakeRoot2);
var VC2 = fakeRoot2.VPCelebrate;
pass("the 'answerup' slot holds Dean's chime, and it plays nothing while the game's sounds are OFF, even on the wall", VC2 && /^\/app\/sounds\/.+\.mp3$/.test(VC2.SOUNDS.answerup) && VC2.sound("answerup", { wall: true }) === false && !fakeRoot2.played, VC2 && VC2.SOUNDS);
VC2.setGameSounds("trivia", true);
pass("sounds ON: a phone never tapped (and muted) stays silent, the wall plays it with no tap", VC2.sound("answerup") === false && VC2.sound("answerup", { wall: true }) === true && fakeRoot2.played === 1, fakeRoot2.played);
pass("Time's up asks the one player for its slot and the one buzz, and has no player of its own", /c\.sound\('timesup'\)/.test(QR) && /c\.buzz\(180\)/.test(QR) && !/new root\.Audio|\.play\(\)|vibrate/.test(QR));
print("\nTHE PODIUM (INBOX 313): IN THE LEAD OR TOP 3, THE TRIVIA NIGHT'S STEPS, THEN THE BOARD");
var PR = {};
new Function("window", find("venueplay/app/vp-trivia-finale.js") + "\n" + find("venueplay/app/vp-podium.js"))(PR);
var POD = PR.VPPodium;
function rowsOf(pts, you) { return pts.map(function (p, i) { return { place: i + 1, name: "P" + i, points: p, you: i === you }; }); }
pass("who stands where is the trivia finale's own rule (VPTriviaFinale.podiumEntries), not a copy", !!POD && /F\.podiumEntries\(/.test(find("venueplay/app/vp-podium.js")));
pass("in the lead: the top step", POD && POD.mine(rowsOf([500, 400, 300, 200], 0)) === 1);
pass("3rd: the third step", POD && POD.mine(rowsOf([500, 400, 300, 200], 2)) === 3);
pass("4th: no podium, straight to the board", POD && POD.mine(rowsOf([500, 400, 300, 200], 3)) === 0);
pass("a tie for 2nd shares the step", POD && POD.mine(rowsOf([500, 400, 400, 200], 2)) === 2);
pass("'You're in the lead!' and '3rd tonight!'", L.podiumTitle(1) === "You're in the lead!" && L.podiumTitle(3) === "3rd tonight!");
pass("the end shows the podium first and hands to the board with their row marked; otherwise the board straight away",
  /if \(!\(window\.VPPodium && window\.VPPodium\.show\(b\.rows, \{ title: L\.podiumTitle\(myPl\), onDone: toMyRow \}\)\)\) toMyRow\(\);/.test(PAGE) &&
  PAGE.indexOf('<script src="/app/vp-podium.js"></script>') > 0 && PAGE.indexOf('<script src="/app/vp-trivia-finale.js"></script>') > 0);
pass("its confetti and sound are the one celebration file's (burst, the 'podium' slot)", /C\.burst\(el, 40,/.test(find("venueplay/app/vp-podium.js")) && /C\.sound\("podium"\)/.test(find("venueplay/app/vp-podium.js")));

var TP = find("venueplay/app/trivia/play.html");
var lo = TP.slice(TP.indexOf("  function lockOut(moment){"), TP.indexOf("  function lockOut(moment){") + 600);
pass("the real trivia phone plays the same Time's up moment (VPQRing.timesUp), once a question, only when its own clock ran out or the host locked everyone, never on a catch-up",
  /if\(moment && !P\.q\.upShown && window\.VPQRing\)\{ P\.q\.upShown=true; try\{ window\.VPQRing\.timesUp\(\); \}catch\(e\)\{\} \}/.test(lo) &&
  /if\(P\.q\.endsAt-Date\.now\(\)<=0\)\{ stopCd\(\); lockOut\(true\); \}/.test(TP) && /stopCd\(\); lockOut\(!m\.to\);/.test(TP) &&
  /if\(lk\)\{ stopCd\(\); lockOut\(\); \}/.test(TP) && TP.indexOf('<script src="/app/vp-qring.js"></script>') > 0);
pass("the coaster page loads the one player before the ring", PAGE.indexOf('<script src="/app/vp-celebrate.js"></script>') > 0 && PAGE.indexOf('<script src="/app/vp-celebrate.js"></script>') < PAGE.indexOf('<script src="/app/vp-qring.js"></script>'));

print("");
if (bad) { print(bad + " OF " + ran + " CHECKS FAILED"); throw new Error(bad + " failed"); }
print("ALL " + ran + " CHECKS PASSED");
