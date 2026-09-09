/* TWO BALLS IN QUICK SUCCESSION MUST NOT LEAVE AN OLD NUMBER ON THE WALL.

   Dean, 10 Sep 2026, after migration 76 cut calling a ball from six database round trips
   to one: "it has sped up heaps! but the ball doesnt blend with the old number ... the old
   number kinda flashes over the new."

   The reveal takes 2.1 seconds: 1.3 to pop and hold, then 0.8 to glide onto the resting
   called-number ball, at which point landBall() writes the new number into it. That was
   comfortably shorter than a ball used to take to arrive, so two reveals never overlapped.
   Making the ball fast put the host's next tap INSIDE the animation. The second reveal
   cleared the first one's timers, so its landBall() never ran, the resting ball kept an
   older number, and the new ball glided down on top of a stale one.

   This is the third time today that making something faster exposed a race that slowness
   had been hiding. The other two were the console's signing key and the ad rebuild.

   Run: jsc venueplay/app/tv-fast-balls.test.js
*/
function find(rel) {
  var tries = [rel, '../' + rel, '../../' + rel];
  for (var i = 0; i < tries.length; i++) {
    try { var t = readFile(tries[i]); if (t && t.length > 500) return t; } catch (e) {}
  }
  throw new Error('cannot open ' + rel);
}
var TV = find('venueplay/tv.html');
var EXPECT = 7;
var ran = 0, bad = 0;
function ok(n, c, extra) {
  ran++;
  if (c) print('  ok   ' + n); else { bad++; print('  FAIL ' + n + (extra ? '   ' + extra : '')); }
}

ok('the TV remembers which number is in flight', /inFlightNum/.test(TV),
   'without it, an interrupted reveal cannot be finished off');
ok('a new ball finishes the one still flying', /if\(ballInFlight && inFlightNum && inFlightNum !== n\)\{/.test(TV),
   'this is the check that stops a stale number being left on the resting ball');
ok('it writes the interrupted number into the resting ball',
   /restNum\.textContent=inFlightNum;/.test(TV));
ok('and clears both reveal timers first',
   /if\(ballInFlight && inFlightNum[\s\S]{0,220}clearTimeout\(revealT1\)[\s\S]{0,120}clearTimeout\(revealT2\)/.test(TV));
ok('the flying ball is hidden and reset, not left mid-transform',
   /if\(ballInFlight && inFlightNum[\s\S]{0,420}el\.classList\.add\("hidden"\); b\.style\.transition="none"; b\.style\.transform="";/.test(TV));
ok('landing clears the in-flight number', /ballInFlight=false; inFlightNum=0;/.test(TV),
   'otherwise the next ball thinks one is still flying and snaps for no reason');
ok('the resting ball still keeps the OLD number while one is genuinely in flight',
   /if\(!ballInFlight\)\{\s*\$\("cbNum"\)\.textContent = n \? n : "--";/.test(TV),
   'that is the whole point of the reveal: the new ball overtakes the old one');

if (ran !== EXPECT) { print('\nONLY ' + ran + ' OF ' + EXPECT + ' RAN'); throw new Error('incomplete'); }
if (bad) { print('\n' + bad + ' OF ' + EXPECT + ' FAILED'); throw new Error(bad + ' failed'); }
print('\nALL ' + EXPECT + ' CHECKS PASSED');
