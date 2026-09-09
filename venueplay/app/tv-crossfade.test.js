/* THE SLIDE LEAVING MUST NEVER PAINT OVER THE SLIDE ARRIVING.

   Dean, watching the wall at The Mini Bar on 10 Sep 2026: "it flashes on every loop
   and its just as it goes onto saturday looks like flashing into members draw every
   second round maybe".

   He had it exactly right, including which slide. The cross-fade gave the incoming
   slide z-index 2 for the handover and then CLEARED it, which hands stacking back to
   DOM order. DOM order is wrong for precisely one transition in the loop: the wrap
   from the last slide to the first. The last slide sits later in the document, so once
   both were back on auto it painted ON TOP of the first while it was still fading out
   for its full 0.8 seconds. One lap, one flash of the members draw card over the
   Saturday photo, for ever. Every other transition looked fine because the incoming
   slide is later in the document and wins DOM order by luck.

   So: the slide on screen holds the top of the stack and the one leaving is put
   underneath it. Nothing is ever handed back to DOM order.

   Run: jsc venueplay/app/tv-crossfade.test.js
*/
function find(rel) {
  var tries = [rel, '../' + rel, '../../' + rel];
  for (var i = 0; i < tries.length; i++) {
    try { var t = readFile(tries[i]); if (t && t.length > 500) return t; } catch (e) {}
  }
  throw new Error('cannot open ' + rel);
}
var TV = find('venueplay/tv.html');
var EXPECT = 5;
var ran = 0, bad = 0;
function ok(n, c, extra) {
  ran++;
  if (c) print('  ok   ' + n); else { bad++; print('  FAIL ' + n + (extra ? '   ' + extra : '')); }
}

ok('the slide on its way out is pushed underneath', /out\.style\.zIndex = "1";/.test(TV),
   'without this the last slide paints over the first one on every wrap');
ok('the slide coming in is put on top', /into\.style\.zIndex = "2";/.test(TV));
ok('the incoming slide is never handed back to DOM order', !/into\.style\.zIndex = "";/.test(TV),
   'clearing z-index at the end of the fade is what caused the flash');
ok('nor is the outgoing one', !/out\.style\.zIndex = "";/.test(TV));
ok('a rebuild or a resume also puts the visible slide on top',
   /s\.style\.zIndex = \(i===cur \? "2" : "1"\)/.test(TV),
   'otherwise a resumed rotation starts with the wrong slide on top');

if (ran !== EXPECT) { print('\nONLY ' + ran + ' OF ' + EXPECT + ' RAN'); throw new Error('incomplete'); }
if (bad) { print('\n' + bad + ' OF ' + EXPECT + ' FAILED'); throw new Error(bad + ' failed'); }
print('\nALL ' + EXPECT + ' CHECKS PASSED');
