/* ONE NIGHT, ONE CARD.

   The Account page's Nights tab (and HQ's nights report) list sessions, then merge in the
   end-of-game reports, because broadcast bingo once opened no session and existed only as a
   report. Bingo and musical bingo open sessions now, so every game was listed twice: on
   14 Oct 2026 Test Charlie showed one Wednesday four times plus a fifth card. This RUNS the
   shipped reportsOutsideSessions() against a night with a session and reports inside it, and a
   broadcast-only report with no session around it.

   Run: jsc venueplay-backend/worker/nights-dedup.test.js
*/
function find(rel) {
  var tries = [rel, '../' + rel, '../../' + rel];
  for (var i = 0; i < tries.length; i++) {
    try { var t = readFile(tries[i]); if (t && t.length > 5000) return t; } catch (e) {}
  }
  throw new Error('cannot open ' + rel);
}
var src = find('venueplay-backend/worker/venueplay-api-FULL.js');
var i = src.indexOf('function reportsOutsideSessions(');
if (i < 0) throw new Error('reportsOutsideSessions is not in the billing Worker - a test that cannot find its subject cannot fail');
var d = 0, k = src.indexOf('{', i);
do { if (src[k] === '{') d++; else if (src[k] === '}') d--; k++; } while (d > 0 && k < src.length);
eval(src.slice(i, k));

var bad = 0, ran = 0;
function ok(n, c, extra) { ran++; if (c) print('  ok   ' + n); else { bad++; print('  FAIL ' + n + (extra ? '   ' + extra : '')); } }

var sessions = [
  { id: 's1', opened_at: '2026-10-14T09:00:00Z', ended_at: '2026-10-14T11:00:00Z' },
  { id: 's2', opened_at: '2026-10-15T09:00:00Z', ended_at: null },                     // still open
];
var reports = [
  { id: 'r1', started_at: '2026-10-14T09:10:00Z' },   // inside s1
  { id: 'r2', started_at: '2026-10-14T10:40:00Z' },   // inside s1
  { id: 'r3', started_at: '2026-10-15T09:30:00Z' },   // inside the open s2
  { id: 'r4', started_at: '2026-10-12T19:00:00Z' },   // a broadcast-only night: no session
];
var kept = reportsOutsideSessions(sessions, reports).map(function (r) { return r.id; });
ok('reports inside a finished session are not listed again', kept.indexOf('r1') < 0 && kept.indexOf('r2') < 0, kept.join(','));
ok('a report inside a session that is still open is not listed again', kept.indexOf('r3') < 0, kept.join(','));
ok('a broadcast-only night with no session keeps its card', kept.length === 1 && kept[0] === 'r4', kept.join(','));
ok('no sessions at all keeps every report', reportsOutsideSessions([], reports).length === 4);

/* Both views use it. A second copy of the merge is how this came back last time. */
var uses = src.split('for (const r of reportsOutsideSessions(sessions, reports))').length - 1;
ok('HQ and the Account page both use the one helper', uses === 2, 'used ' + uses + ' times');

print('');
if (bad) { print(bad + ' OF ' + ran + ' CHECKS FAILED'); throw new Error(bad + ' failed'); }
print('ALL ' + ran + ' CHECKS PASSED');
