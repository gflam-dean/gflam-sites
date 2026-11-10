/* THE BINGO PHONE'S LOBBY IS THE SAME AS EVERY GAME'S (Dean, 6 Nov 2026, round 7), AND ITS MENU OFFERS "JOIN {VENUE}'S LIST".

   /app/vp-tonight.js and /app/vp-tonight.css (tested in tools/test-vp-tonight.js) draw the lobby, the venue's ad sits
   under it (/app/vp-phonead.js), and the menu's "Join the list" goes through /join/list (tools/test-join-list.js). This
   checks the bingo phone (play.html) hands them the right things: it RUNS route() lifted from the page on a fake DOM for
   the plain lobby, and reads the wiring for the rest.

   Run from the repo root:  jsc tools/test-bingo-tonight.js
*/
var PLAY = readFile('venueplay/play.html');
var ran = 0, bad = 0;
function ok(n, c, saw) { ran++; print((c ? '  ok   ' : '  FAIL ') + n + (c || saw === undefined ? '' : '   saw: ' + saw)); if (!c) bad++; }
function lift(name) {
  var i = PLAY.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('cannot find ' + name);
  var d = 0, k = PLAY.indexOf('{', i);
  do { if (PLAY[k] === '{') d++; else if (PLAY[k] === '}') d--; k++; } while (d > 0);
  return PLAY.slice(i, k);
}
ok('loads the shared look, the ad and the module', PLAY.indexOf('<link rel="stylesheet" href="/app/vp-tonight.css">') > 0 && PLAY.indexOf('<script src="/app/vp-phonead.js"></script>') > 0 && PLAY.indexOf('<script src="/app/vp-tonight.js"></script>') > 0);
ok('the lobby has the old block (waitIn), the module\'s place (vpTonight), and the page has the one ad slot', /<div id="waitIn">/.test(PLAY) && /<div class="vpt hidden" id="vpTonight"><\/div>/.test(PLAY) && /<div id="vpAd" hidden><\/div>/.test(PLAY));

function els() { var m = {}; return function (id) { if (!m[id]) { var o = { id: id, textContent: '', innerHTML: '', cls: { hidden: true } }; o.classList = { toggle: function (c, on) { o.cls[c] = on === undefined ? !o.cls[c] : !!on; }, contains: function (c) { return !!o.cls[c]; }, add: function (c) { o.cls[c] = true; }, remove: function (c) { delete o.cls[c]; } }; m[id] = o; } return m[id]; }; }
function boot(P, withModule) {
  var $ = els(), shown = [], drawn = [], timers = [];
  var VPT = withModule ? { lobby: function (b, o) { drawn.push(o); } } : undefined;
  var route = new Function('P', '$', 'show', 'renderCards', 'askHowItWent', 'loadJoinInfo', 'VPTonight', 'hostNote', 'esc', 'patName', 'setTimeout', '_paper',
    lift('route') + '; return route;')(P, $, function (v) { shown.push(v); }, function () {}, function () {}, function () {}, VPT, function () {}, function (x) { return String(x); }, function () { return 'a line'; }, function (f, ms) { timers.push(ms); }, false);
  route();
  return { $: $, shown: shown, drawn: drawn, timers: timers };
}
var base = { room: 'ACDE23', joined: true, name: 'Ann', cards: [], stageWins: [], active: false };
var b = boot(JSON.parse(JSON.stringify(base)), true);
ok('the plain lobby is drawn by the module with this phone\'s game ("bingo") and its name, the old block hidden', b.drawn.length === 1 && b.drawn[0].me === 'bingo' && b.drawn[0].name === 'Ann' && b.$('waitIn').cls.hidden === true && b.$('vpTonight').cls.hidden === false && b.shown[0] === 'vWait', JSON.stringify(b.drawn));
ok('a phone already in asks once for the week and the ad, after the seat', b.timers.length === 1 && b.timers[0] === 1500);
var ow = JSON.parse(JSON.stringify(base)); ow.stageWins = [{ pattern: 'one', cardNo: 7 }];
var b2 = boot(ow, true);
ok('a prize owed keeps the old block, which says so (never hidden behind the lobby)', b2.drawn.length === 0 && b2.$('waitIn').cls.hidden === false);
var b3 = boot(JSON.parse(JSON.stringify(base)), false);
ok('without the module: the old block, nothing asked', b3.drawn.length === 0 && b3.$('waitIn').cls.hidden === false && b3.timers.length === 0);
ok('the ad shows on the lobby only, compact', /VPPhoneAd\.show\(which==="vWait"\)/.test(PLAY) && /ap\.classList\.toggle\("vpt-on", which==="vWait"\);/.test(PLAY));
ok('the join stays as cheap as it was: the slides are asked for only once the phone is in', /if\(P\.joined\) b\.ad=1;/.test(PLAY));
ok('/join/info\'s week, nights, games and what the venue collects are kept, for a phone that is in too', /P\.week=\(r&&Array\.isArray\(r\.week\)\)\?r\.week:null;/.test(PLAY) && /P\.collect=\(r&&r\.collect\)\|\|null;/.test(PLAY));
ok('"Join {venue}\'s list" in the menu, only where the venue collects the tick and a way to reach them, only once in, gone once on the list',
   /<div id="vpListItem"><\/div>/.test(PLAY) && /if\(typeof VPTonight!=="object" \|\| !P\.joined \|\| onList\(\) \|\| !\(c\.marketing_optin && \(c\.email \|\| c\.mobile\)\)\)\{ b\.innerHTML=""; return; \}/.test(PLAY));
ok('it goes through /join/list, and a ticked send (or the tick when joining) puts the phone on the list', /fetch\(VP_GAME_API\+"\/join\/list"/.test(PLAY) && /if\(optin===true && r && r\.stored\) setOnList\(\);/.test(PLAY) && /if\(P\.capture && P\.capture\.marketing_optin===true\) setOnList\(\); else paintListItem\(\);/.test(PLAY));
print('');
print(bad ? (bad + ' FAILED, ' + ran + ' run') : ('ALL ' + ran + ' CHECKS PASSED'));
