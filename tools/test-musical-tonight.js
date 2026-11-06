/* THE MUSICAL PHONE'S WAITING SCREEN USES THE SHARED ROUND 5 LOBBY (Dean, 6 Nov 2026).

   /app/vp-tonight.js (built and tested on fix/trivia-live-fixes-6nov, tools/test-vp-tonight.js) draws "You're in, Sam",
   the Tonight spot and the This week here strip for every phone. This checks the musical phone hands it the right things:
     - it loads the module, and keeps its old "You're in" block for when the module is not there (it is not on this
       branch until fix/trivia-live-fixes-6nov is merged: the page then shows the old block, never an error)
     - route() draws the lobby with this phone's game ("musical"), its name, a REAL prize only, and the venue's week
     - the week comes from /join/info, and a phone already in asks for it once
   It RUNS route() lifted from the page on a fake DOM, with and without the module.

   Run from the repo root:  jsc tools/test-musical-tonight.js
*/
var PLAY = readFile('venueplay/app/musical/play.html');
var ran = 0, bad = 0;
function ok(n, c, saw) { ran++; print((c ? '  ok   ' : '  FAIL ') + n + (c || saw === undefined ? '' : '   saw: ' + saw)); if (!c) bad++; }
function lift(name) {
  var i = PLAY.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('cannot find ' + name);
  var d = 0, k = PLAY.indexOf('{', i);
  do { if (PLAY[k] === '{') d++; else if (PLAY[k] === '}') d--; k++; } while (d > 0);
  return PLAY.slice(i, k);
}
ok('loads the shared module after the ad module', PLAY.indexOf('<script src="/app/vp-tonight.js"></script>') > PLAY.indexOf('<script src="/app/vp-phonead.js"></script>'));
ok('the wait screen has the old block (id waitIn) and the module\'s place (id vpTonight)', /<div class="vp-in" id="waitIn">/.test(PLAY) && /<div class="vpt hidden" id="vpTonight"><\/div>/.test(PLAY));

function els() { var m = {}; return function (id) { return m[id] || (m[id] = { id: id, textContent: '', cls: { hidden: true }, classList: { toggle: function (c, on) { this._o.cls[c] = on === undefined ? !this._o.cls[c] : !!on; }, contains: function (c) { return !!this._o.cls[c]; } } }); }; }
function boot(withModule, P) {
  var $ = els(), shown = [], drawn = [], asked = 0;
  ['vpTonight', 'waitIn', 'vWait'].forEach(function (k) { $(k).classList._o = $(k); });
  var VPT = withModule ? { lobby: function (box, o) { drawn.push(o); } } : undefined;
  var route = new Function('P', '$', 'show', 'renderCard', 'askHowItWent', 'loadJoinInfo', 'VPTonight',
    lift('route') + '; return route;')(P, $, function (v) { shown.push(v); }, function () {}, function () {}, function () { asked++; }, VPT);
  route();
  return { $: $, shown: shown, drawn: drawn, asked: function () { return asked; }, route: route };
}
var P = { room: 'ACDE23', joined: true, name: 'Sam', prize: 'Meat tray', week: [{ day: 'wed', games: [{ game: 'musical', start: '19:30' }] }], nights: [], games: [] };
var b = boot(true, P);
ok('with the module: the lobby is drawn, the old block hidden', b.drawn.length === 1 && b.$('waitIn').cls.hidden === true && b.$('vpTonight').cls.hidden === false && b.shown[0] === 'vWait');
ok('with this phone\'s game, its name, its real prize and the venue\'s week', b.drawn[0].me === 'musical' && b.drawn[0].name === 'Sam' && b.drawn[0].prize === 'Meat tray' && b.drawn[0].week === P.week, JSON.stringify(b.drawn[0]));
var b2 = boot(true, { room: 'ACDE23', joined: true, name: 'Sam', prize: 'the prize', week: null });
ok('"the prize" (none set) is not shown as a prize', b2.drawn[0].prize === '');
var b3 = boot(true, { room: 'ACDE23', joined: true, name: 'Sam', prize: '' });
ok('a phone already in that never asked for the week asks once', b3.asked() === 1);
b3.route();
ok('and only once', b3.asked() === 1);
var b4 = boot(false, { room: 'ACDE23', joined: true, name: 'Sam', prize: '' });
ok('without the module: the old block, the module\'s place hidden, nothing asked', b4.$('waitIn').cls.hidden === false && b4.$('vpTonight').cls.hidden === true && b4.asked() === 0 && b4.shown[0] === 'vWait');
ok('the week comes from /join/info', /P\.week=\(r&&Array\.isArray\(r\.week\)\)\?r\.week:null;/.test(PLAY));

print('ROUND 7 (Dean, 6 Nov 2026): the same lobby as every game, the ad and our logo always fit, and "Join the list" in the menu');
ok('loads the shared look', PLAY.indexOf('<link rel="stylesheet" href="/app/vp-tonight.css">') > 0);
ok('no "One line across" pill on the lobby (row two only on the join steps and the card)', /paintRow2\(!!P\.room && \(which==="vCard" \|\| which==="vJoin"\)\);/.test(PLAY));
ok('the compact ad under the lobby', /ap\.classList\.toggle\("vpt-on", !!AD_VIEWS\[which\]\);/.test(PLAY));
ok('"Join {venue}\'s list" in the menu, only where the venue collects the tick and a way to reach them, only once in, gone once on the list',
   /<div id="vpListItem"><\/div>/.test(PLAY) && /if\(typeof VPTonight!=="object" \|\| !P\.joined \|\| onList\(\) \|\| !\(c\.marketing_optin && \(c\.email \|\| c\.mobile\)\)\)\{ b\.innerHTML=""; return; \}/.test(PLAY));
ok('it sends through /join/list with this phone\'s token, and a ticked send puts the phone on the list', /fetch\(VP_GAME_API\+"\/join\/list"/.test(PLAY) && /if\(optin===true && r && r\.stored\) setOnList\(\);/.test(PLAY));
ok('a player who ticked the offers when joining is on the list (no row)', /if\(P\.capture && P\.capture\.marketing_optin===true\) setOnList\(\); else paintListItem\(\);/.test(PLAY));
ok('a phone already in asks what the venue collects when the menu opens', /if\(P\.joined && P\.collect===undefined && !P\.collectAsked\)\{ P\.collectAsked=true; loadJoinInfo\(\); \}/.test(PLAY));
print('');
print(bad ? (bad + ' FAILED, ' + ran + ' run') : ('ALL ' + ran + ' CHECKS PASSED'));
