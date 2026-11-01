/* "ALLOW EARLY BINGO CALLS" NEVER CHANGES BY ITSELF ACROSS A RELOAD.

   Live test night, 1 Nov 2026, Test Alpha: the box was unticked when the game started; the console
   was reloaded mid-game and it showed TICKED, and nobody had touched it. A host setting has to say
   what the game does, before and after a reload.

   Runs the REAL bingo console (app/index.html, with vp-draw.js) on tools/rig-bingo-room.js:
     - the browser putting back a box it remembers from before the reload does not win over the game
     - a tick or an untick made during a game survives a reload straight after it, with no ball between
     - and the two boxes carry autocomplete="off", so a browser does not restore them at all

   Run from the repo root:  jsc tools/test-early-bingo-restore.js
*/
load('tools/rig-bingo-room.js');

var PASS = 0, FAIL = 0;
function check(name, cond, saw) {
  if (cond) { PASS++; print('  ok   ' + name); }
  else { FAIL++; print('  FAIL ' + name + (saw !== undefined ? '   saw: ' + JSON.stringify(saw) : '')); }
}
function boxes(h) { return [h.G.allowEarly, h.$('allowEarlyChk').checked, h.$('allowEarlyLive').checked]; }
function change(el, v) { el.checked = v; (el._on.change || []).forEach(function (f) { f.call(el, { target: el }); }); }
function fire(h, ev) { (h.dom.window._on[ev] || []).forEach(function (f) { try { f({}); } catch (e) {} }); }
async function running() {
  BUS = {}; QUEUE = []; TIMERS = [];
  var host = bootHost(); await advance(300);
  var ann = bootPhone('Ann'); await advance(300);
  ann.$('nameIn').value = 'Ann'; ann.join(); await advance(200);
  host.$('prizeInput').value = '$50'; host.$('patternSel').value = 'one'; host.$('cardsSel').value = '1'; host.$('paidSel').value = '';
  host.openLobby(); await advance(200); host.startGame(); await advance(300);
  var n = host.G.pool[0]; host.G.pool.splice(0, 1); host.commitBall(n, false); await advance(300);
  return host;
}

(async function () {
  var HTML = readFile('venueplay/app/index.html');
  print('The browser does not get a say');
  check('the setup box carries autocomplete="off"', /<input type="checkbox" id="allowEarlyChk" autocomplete="off"/.test(HTML));
  check('so does the box shown during the game', /<input type="checkbox" id="allowEarlyLive" autocomplete="off"/.test(HTML));

  print('\nUnticked at the start, reloaded mid-game');
  var host = await running();
  check('control: the game is running with early calls off', host.G.status === 'running' && boxes(host).join() === 'false,false,false', boxes(host));
  var h2 = bootHost({ store: host.dom.localStorage._s }); await advance(2000);
  check('the reloaded console has the game back with early calls still off', h2.G.status === 'running' && boxes(h2).join() === 'false,false,false', boxes(h2));
  h2.$('allowEarlyChk').checked = true; h2.$('allowEarlyLive').checked = true;   // a browser putting back what it remembers
  fire(h2, 'pageshow');
  check('a box the browser ticks behind the page\'s back is put back to what the game says', boxes(h2).join() === 'false,false,false', boxes(h2));

  print('\nA change made during the game survives a reload straight after it');
  host = await running();
  change(host.$('allowEarlyLive'), true); await advance(50);
  check('control: the host ticked it mid-game', host.G.allowEarly === true);
  h2 = bootHost({ store: host.dom.localStorage._s }); await advance(2000);
  check('reloaded with no ball since: still ticked, and the game really allows it', boxes(h2).join() === 'true,true,true', boxes(h2));
  change(h2.$('allowEarlyLive'), false); await advance(50);
  var h3 = bootHost({ store: h2.dom.localStorage._s }); await advance(2000);
  check('and an untick survives a reload the same way', boxes(h3).join() === 'false,false,false', boxes(h3));

  print('');
  print(PASS + ' passed, ' + FAIL + ' failed');
  if (FAIL) { print('FAILED ' + FAIL); throw new Error(FAIL + ' check(s) failed'); }
  print('PASS');
})().catch(function (e) { print('RIG ERROR ' + e + '\n' + (e && e.stack)); throw e; });
