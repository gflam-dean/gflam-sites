/* Which phones are told "tonight you play on paper"?

   In SA, ACT and Tasmania a bingo ticket has to be on paper, and the phone page blanks itself
   when the Worker says so. That flag has been wrong twice: first it ignored the format (a TRIVIA
   player in Adelaide had their phone wiped), and then it included musical bingo, which the musical
   phone page never obeyed, so the two halves of the product disagreed. Dean settled it on
   21 Sep 2026: musical bingo is not housie and keeps its phone tickets.

   Runs the REAL handleJoinInfo out of the shipped game Worker against the rig's fake database.
   Run from the repo root:  jsc tools/test-paper-is-for-bingo-only.js
*/
load('tools/rig-game-worker.js');
var finished = false;
var V = { SA: '10000000-0000-4000-8000-000000000001', ACT: '10000000-0000-4000-8000-000000000002', TAS: '10000000-0000-4000-8000-000000000003', NSW: '10000000-0000-4000-8000-000000000004' };
DB.vp_venues = Object.keys(V).map(function (st) { return { id: V[st], name: 'The ' + st + ' Hotel', slug: 'the-' + st.toLowerCase(), au_state: st, status: 'active' }; });
DB.vp_venue_settings = []; DB.vp_sessions = []; DB.vp_games = [];
var n = 0;
function night(st, format) {   // a live session at that venue running that format, and its join code
  n++; var sid = '20000000-0000-4000-8000-' + ('000000000000' + n).slice(-12), code = 'CODE' + ('00' + n).slice(-2);
  DB.vp_sessions.push({ id: sid, venue_id: V[st], status: 'running', join_code: code, created_at: '2026-09-19T09:00:00Z' });
  DB.vp_games.push({ id: '30000000-0000-4000-8000-' + ('000000000000' + n).slice(-12), session_id: sid, seq: 1, format: format, status: 'running' });
  return code;
}
venueByCode = async function (env, code) { var m = /^VENUE-(\w+)$/.exec(code); return m ? V[m[1]] : null; };   // broadcast bingo: the venue's own code

(async function () {
  async function paper(code) { BODY = { code: code }; var r = await handleJoinInfo({}, ENV, json); return r.body; }
  print('the three paper states');
  for (var st of ['SA', 'ACT', 'TAS']) {
    var b = await paper('VENUE-' + st);
    show(st + ': ordinary bingo is on paper', b.paper_bingo === true, JSON.stringify(b).slice(0, 120));
  }
  for (var st2 of ['SA', 'ACT', 'TAS']) {
    var mu = await paper(night(st2, 'musical'));
    show(st2 + ': MUSICAL bingo keeps its phone tickets', mu.format === 'musical' && mu.paper_bingo === false, JSON.stringify(mu).slice(0, 120));
  }
  var tr = await paper(night('SA', 'trivia'));
  show('SA: a trivia player is never told to play on paper', tr.format === 'trivia' && tr.paper_bingo === false, JSON.stringify(tr).slice(0, 120));
  print('everywhere else');
  var nsw = await paper('VENUE-NSW');
  show('NSW: bingo is on the phone', nsw.paper_bingo === false, JSON.stringify(nsw).slice(0, 120));
  finished = true;
})().catch(function (e) { print('  FAIL the test itself threw: ' + e + '\n' + e.stack); bad++; });
drainMicrotasks();
if (!finished) { print('  FAIL the test did not run to the end'); bad++; }
if (bad) throw new Error('paper flag: ' + bad + ' of ' + ran + ' failed');
print('PASS ' + ran + ' checks');
