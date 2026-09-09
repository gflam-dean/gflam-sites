/* THE ROOM IS OPT IN, AND FALLING BACK MUST NOT LOSE A MESSAGE.

   Three pages can now join a Cloudflare room instead of a Supabase Realtime channel:
   the TV, the bingo console and the player's phone. A room only works if EVERYONE in
   the venue is in it, so getting the opt-in wrong is not a small bug: a host talking
   into an empty room is a night with no balls on the wall.

   These checks read the real pages, not a copy of them.

   Run: jsc venueplay/app/room-optin.test.js
*/
function find(rel) {
  var tries = [rel, '../' + rel, '../../' + rel];
  for (var i = 0; i < tries.length; i++) {
    try { var t = readFile(tries[i]); if (t && t.length > 500) return t; } catch (e) {}
  }
  throw new Error('cannot open ' + rel);
}
var TV = find('venueplay/tv.html');
var CONSOLE = find('venueplay/app/index.html');
var PLAY = find('venueplay/play.html');
var CLIENT = find('venueplay/app/vp-room.js');
var EXPECT = 25;
var ran = 0, bad = 0;
function ok(n, c, extra) {
  ran++;
  if (c) print('  ok   ' + n); else { bad++; print('  FAIL ' + n + (extra ? '   ' + extra : '')); }
}

print('== every page that can join a room actually loads the client ==');
ok('the TV loads vp-room.js', /<script src="\/app\/vp-room\.js">/.test(TV));
ok('the console loads vp-room.js', /<script src="\/app\/vp-room\.js">/.test(CONSOLE));
ok('the phone loads vp-room.js', /<script src="\/app\/vp-room\.js">/.test(PLAY));

print('== and none of them joins one unless the link asks ==');
[['TV', TV], ['console', CONSOLE], ['phone', PLAY]].forEach(function (p) {
  ok(p[0] + ' only opts in on ?room=1', /_useRoom\s*=\s*\/\[\?&\]room=1/.test(p[1]),
     'a page that joins a room by default would go silent against a Worker with no binding');
});

print('== a room that is not there must send the page back to Supabase ==');
ok('the client treats 503 as not enabled', /r\.status === 503/.test(CLIENT));
ok('and tells the page so', /onUnavailable/.test(CLIENT));
[['TV', TV], ['console', CONSOLE], ['phone', PLAY]].forEach(function (p) {
  ok(p[0] + ' has an onUnavailable that reconnects', /onUnavailable: function\(\)\{ _useRoom=false; _room=null;/.test(p[1]));
});

print('== nothing is sent into a socket the page does not have ==');
ok('the console send tries the room first, then the channel',
   /function rawSend\(p\)\{[\s\S]{0,220}if\(_room\)[\s\S]{0,200}ch\.send/.test(CONSOLE));
ok('the phone send tries the room first, then the channel',
   /function wireOut\(obj\)\{[\s\S]{0,200}if\(_room\)[\s\S]{0,200}ch\.send/.test(PLAY));
ok('the phone queues a message it could not send', /if\(!wireOut\(obj\)\) sendQueue\.push\(obj\)/.test(PLAY));
ok('the console queues a message it could not send', /sendQueue\.push\(p\)/.test(CONSOLE));
ok('the phone flush stops instead of dropping what it cannot send',
   /flushQueue\(\)\{ while\(sendQueue\.length && \(ch \|\| _room\)\)[\s\S]{0,200}break;/.test(PLAY));
ok('the console flush puts back what it cannot send', /sendQueue\.unshift\(p\); break;/.test(CONSOLE));

print('== the TV still says hello, and not through a shared function it cannot use ==');
ok('the TV greets the room down the socket', /_room\.send\(\{ t:"tv_here"/.test(TV),
   'tvSend only speaks Supabase and is one of the three kept byte-identical');

print('== the host announces itself in the room, or the TV never learns it is there ==');
ok('the console sends host_here on open', /if\(st==="open"\)\{[\s\S]{0,200}t:"host_here"/.test(CONSOLE));
ok('and asks the phones to re-announce', /t:"rollcall"/.test(CONSOLE));

print('== joining a room must not skip the rest of connect() ==');
/* THE FAULT THIS EXISTS FOR. The first version returned out of connect() as soon as the
   room was handed back, so go("vConsole") never ran and the host console rendered its
   header and nothing else. Dean: "loads a blank page. has the header but nothing else".
   The Supabase branch must be SKIPPED, not jumped over. */
ok('the console still paints itself after joining a room',
   /\}catch\(err\)\{ _useRoom=false; _room=null; \}\s*\}\s*if\(!_room\)\{/.test(CONSOLE),
   'a return here means the console never runs go("vConsole")');
ok('the phone still paints itself after joining a room',
   /\}catch\(err\)\{ _useRoom=false; _room=null; \}\s*\}\s*if\(!_room\)\{/.test(PLAY));
ok('neither page returns out of connect from the room branch',
   !/return;\s*\}catch\(err\)\{ _useRoom=false/.test(CONSOLE) && !/return;\s*\}catch\(err\)\{ _useRoom=false/.test(PLAY));
ok('the console only opens a Supabase channel when it is not in a room',
   /if\(!_room\)\{\s*ch=client\.channel/.test(CONSOLE));
ok('the phone only opens a Supabase channel when it is not in a room',
   /if\(!_room\)\{\s*ch=client\.channel/.test(PLAY));

if (ran !== EXPECT) { print('\nONLY ' + ran + ' OF ' + EXPECT + ' CHECKS RAN.'); throw new Error('incomplete'); }
if (bad) { print('\n' + bad + ' OF ' + EXPECT + ' FAILED'); throw new Error(bad + ' failed'); }
print('\nALL ' + EXPECT + ' CHECKS PASSED');
