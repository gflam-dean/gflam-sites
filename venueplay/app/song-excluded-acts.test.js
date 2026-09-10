/* CERTAIN ACTS DO NOT GO IN A PACK, WHATEVER THE CHARTS SAY.

   On 9 Sep 2026 an agent added 805 songs from Australian chart data. Gary Glitter and
   Rolf Harris came with them, because they charted, and the pipeline has never asked
   whether a song is a PROBLEM. It asks whether it charted, whether it has a preview
   clip, whether the title is explicit. Three of their songs sat live in the Rock, 70s
   and Pop packs until somebody read the list.

   Both men are convicted sex offenders. Most Australian radio will not play either, and
   Two Little Boys coming up on a bingo card in a pub is not a music problem, it is a
   phone call to Dean.

   Dean, 10 Sep 2026: "pull glitter and harris."

   The list is a judgement and it is his. This suite exists so the judgement survives the
   next bulk import, which is exactly how it got in.

   Run: jsc venueplay/app/song-excluded-acts.test.js
*/
function find(rel) {
  var tries = [rel, '../' + rel, '../../' + rel];
  for (var i = 0; i < tries.length; i++) {
    try { var t = readFile(tries[i]); if (t && t.length > 500) return t; } catch (e) {}
  }
  throw new Error('cannot open ' + rel);
}
var LIB = JSON.parse(find('venueplay/data/musical-library.json'));
var EXCLUDED = ['gary glitter', 'rolf harris'];
var EXPECT = 6;
var ran = 0, bad = 0;
function ok(n, c, extra) {
  ran++;
  if (c) print('  ok   ' + n); else { bad++; print('  FAIL ' + n + (extra ? '   ' + extra : '')); }
}

var inPack = {};
for (var i = 0; i < LIB.playlists.length; i++) {
  var p = LIB.playlists[i];
  for (var j = 0; j < p.songIds.length; j++) {
    (inPack[p.songIds[j]] = inPack[p.songIds[j]] || []).push(p.name);
  }
}
var offenders = [];
for (var k = 0; k < LIB.songs.length; k++) {
  var s = LIB.songs[k], who = String(s.artist || '').toLowerCase();
  for (var e = 0; e < EXCLUDED.length; e++) {
    if (who.indexOf(EXCLUDED[e]) >= 0 && inPack[s.id]) {
      offenders.push(s.title + ' by ' + s.artist + ' in ' + inPack[s.id].join(', '));
    }
  }
}
ok('no excluded act is in any pack', offenders.length === 0, offenders.join(' | '));

/* THEY ARE OUT OF THE LIBRARY ENTIRELY. Dean, on being told they were still held with
   the packs cleared: "just put them in a never to return folder i guess." So they live
   in venueplay/data/songs-never-again.json, which exists to say never again and to keep
   the record of who decided and why. Leaving them in the library meant every future
   import, dedupe and pack builder still had to walk past them. */
var stillHeld = 0;
for (var m = 0; m < LIB.songs.length; m++) {
  var w = String(LIB.songs[m].artist || '').toLowerCase();
  for (var x = 0; x < EXCLUDED.length; x++) if (w.indexOf(EXCLUDED[x]) >= 0) stillHeld++;
}
ok('they are gone from the library, not merely out of the packs', stillHeld === 0,
   'the packs are only half of it: an import or a pack builder walks the library');

var NEVER = JSON.parse(find('venueplay/data/songs-never-again.json'));
ok('the never-again file holds them, so the decision is not just a deletion',
   (NEVER.songs || []).length === 3 && (NEVER.artists || []).length === 2,
   'a deletion with no record is a decision the next person cannot see');
ok('and it says who decided and why', /Dean/.test(NEVER.decided_by || '') && (NEVER.why || '').length > 100);

/* The tool that does it must keep the list, or the next import walks them back in. */
var TOOL = find('tools/pull-from-packs.py');
ok('the pull tool holds the excluded list', /PULL_ARTISTS/.test(TOOL));
ok('and matches on the ARTIST, not a song id', /a in who for a in PULL_ARTISTS/.test(TOOL),
   'matching by id would miss the same act under a different title');

if (ran !== EXPECT) { print('\nONLY ' + ran + ' OF ' + EXPECT + ' RAN'); throw new Error('incomplete'); }
if (bad) { print('\n' + bad + ' OF ' + EXPECT + ' FAILED'); throw new Error(bad + ' failed'); }
print('\nALL ' + EXPECT + ' CHECKS PASSED');
