/* THE TRY-IT DEMO ON THE ONE TRIVIA ENGINE IS NEVER BILLED (Dean, 5 Nov 2026; INBOX 82, 84b, 92c, 93; migration 172).

   RUNS the real venueplay-game.js on tools/rig-game-worker.js, through the same handlers a real night uses:
     1. POST /session {demo:true}: a demo session carries is_demo; a real /session while a demo is live closes the
        demo and opens a NEW real one (a real night never runs on a demo's session); a demo while a real night is
        live is refused and the real night is untouched; at most 3 demos a venue in 24 hours; trivia only.
     2. /join/info on a demo asks the name, email, mobile and the one tick; a real night asks what the venue set.
     3. /join with 50 phones: up to 10 for the demo, the 11th to 50th refused before any row is written; a phone
        already in gets back in.
     4. The opt-in tick: ticked, the player (email, mobile, opt-in, consent time) is on THIS venue's session and
        nowhere else; not ticked, no email or mobile is kept at all; nothing is written to any other table.
     5. /host/game on a demo: 5 questions of 30 s whatever is sent, no double points, no paper; no weekly check
        or stamp, no vp_asked_questions, no saved trivia prefs, no 402 overage ask even with the room over the
        plan; one round only; trivia only. A real night beside it does all of those (the control).
     6. chargeNightOverage on a demo with 50 players over a 5 player plan, approved: no Stripe call, and the
        three-big-nights streak is untouched. The same night not a demo bills (Stripe is called), and a real
        quiet night resets the streak (the path the demo must never reach).
     7. Metering and group overage leave a demo out (DEMO_OFF on the read).
     8. A prospect venue that has not ticked the Terms plays the demo; its real night still waits for the tick.

   Run from the repo root:  jsc tools/test-try-demo.js */
load('tools/rig-game-worker.js');

var SET = '0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a', OTHER = '0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b0b';
var CODE = 'RXYTKM', OCODE = 'MTKXYR';
var OUT = [];   // every request that left the Worker for anything but the database (Stripe)
var rigFetch = fetch;
fetch = async function (url, opts) {
  var u = String(url);
  if (u.indexOf('/rest/v1/') < 0) { OUT.push({ url: u, body: String((opts && opts.body) || '') }); return resp(200, { id: 'ii_fake', status: 'paid' }); }
  /* The database's own default (vp_players.kicked boolean default false); the rig's fake has no defaults. */
  if (/\/rest\/v1\/vp_players$/.test(u) && opts && opts.method === 'POST') {
    var pb = JSON.parse(opts.body); (Array.isArray(pb) ? pb : [pb]).forEach(function (r) { if (r.kicked === undefined) r.kicked = false; });
    opts = Object.assign({}, opts, { body: JSON.stringify(pb) });
  }
  return rigFetch(url, opts);
};
function world() {
  DB = {}; LOG.length = 0; OUT.length = 0;
  DB.vp_venues = [
    { id: VENUE, name: 'The Royal', slug: 'royal', status: 'active', au_state: 'QLD', entity_type: 'for_profit', terms_required: false,
      max_players: 5, founding_id: 'f1', join_code: CODE, timezone: 'Australia/Brisbane', created_at: '2026-01-01T00:00:00Z',
      overage_streak: 2, overage_streak_peaks: [9, 9], overage_streak_day: '2026-09-17', last_trivia_at: null, last_trivia_session_id: null },
    { id: OTHER, name: 'The Other Pub', slug: 'other', status: 'active', au_state: 'QLD', entity_type: 'for_profit', terms_required: false,
      max_players: 5, founding_id: 'f2', join_code: OCODE, timezone: 'Australia/Brisbane', created_at: '2026-01-01T00:00:00Z',
      overage_streak: 2, overage_streak_peaks: [9, 9], overage_streak_day: '2026-09-17', last_trivia_at: null, last_trivia_session_id: null }];
  DB.venueplay_founding = [
    { id: 'f1', status: 'active', stripe_customer_id: 'cus_1', stripe_subscription_id: 'sub_1', first_signin_at: '2026-01-01T00:00:00Z', created_at: '2026-01-01T00:00:00Z' },
    { id: 'f2', status: 'active', stripe_customer_id: 'cus_2', stripe_subscription_id: 'sub_2', first_signin_at: '2026-01-01T00:00:00Z', created_at: '2026-01-01T00:00:00Z' }];
  DB.vp_sessions = []; DB.vp_players = []; DB.vp_games = []; DB.vp_venue_settings = []; DB.vp_asked_questions = []; DB.vp_trivia_games = [];
  DB.vp_question_sets = [{ id: SET, owner_venue_id: null, visibility: 'library', title: 'General knowledge', question_count: 20, status: 'active' }];
  DB.vp_questions = [];
  for (var i = 1; i <= 20; i++) DB.vp_questions.push({ id: 'qqqqqqqq-qqqq-4qqq-8qqq-' + ('000000000000' + i).slice(-12), set_id: SET, seq: i, parked_at: null });
}
async function call(fn, body) {
  BODY = body;
  try { return await fn({ headers: { get: function () { return ''; } }, url: 'https://game.example/x' }, ENV, json); }
  catch (e) { return { status: e.status || 500, body: { error: e.message } }; }
}
function sess(id) { return DB.vp_sessions.filter(function (s) { return s.id === id; })[0]; }
function rowsOf(t) { return (DB[t] || []).length; }

(async function () {
  print('1. Opening a demo, and never turning one into the other');
  world();
  var d = await call(handleCreateSession, { venue_id: VENUE, format: 'trivia', road: 'supabase', demo: true });
  show('a demo opens: 200, demo:true, up to 10', d.status === 200 && d.body.demo === true && d.body.demo_max === 10, JSON.stringify(d.body));
  var DEMO = d.body.session_id;
  show('the session row carries is_demo true', sess(DEMO) && sess(DEMO).is_demo === true);
  var again = await call(handleCreateSession, { venue_id: VENUE, format: 'trivia', road: 'supabase', demo: true });
  show('asking for the demo again hands back the same demo', again.body.session_id === DEMO && again.body.demo === true);
  var real = await call(handleCreateSession, { venue_id: VENUE, format: 'trivia', road: 'supabase' });
  show('a REAL /session while the demo is live is a NEW session, not the demo', real.status === 200 && real.body.session_id && real.body.session_id !== DEMO, JSON.stringify(real.body));
  show('...and the demo was closed (finished, ended_at)', sess(DEMO).status === 'finished' && !!sess(DEMO).ended_at);
  show('...and the real session has no demo flag', sess(real.body.session_id) && sess(real.body.session_id).is_demo !== true);
  var refused = await call(handleCreateSession, { venue_id: VENUE, format: 'trivia', road: 'supabase', demo: true });
  show('a demo while a real night is live is refused (409 demo_night_live)', refused.status === 409 && refused.body.code === 'demo_night_live', JSON.stringify(refused.body));
  show('...and the real night is untouched (still live, still not a demo)', sess(real.body.session_id).status === 'lobby' && sess(real.body.session_id).is_demo !== true);
  var mus = await call(handleCreateSession, { venue_id: OTHER, format: 'musical_bingo', road: 'supabase', demo: true });
  show('a musical bingo demo is refused (trivia only)', mus.status === 400 && mus.body.code === 'demo_trivia_only');

  world();
  var opened = 0;
  for (var k = 0; k < 4; k++) {
    var r = await call(handleCreateSession, { venue_id: VENUE, format: 'trivia', road: 'supabase', demo: true });
    if (r.status === 200) { opened++; sess(r.body.session_id).status = 'finished'; sess(r.body.session_id).ended_at = new Date().toISOString(); }
    else var fourth = r;
  }
  show('three demos a day, the fourth is refused (429 demo_daily_limit)', opened === 3 && fourth && fourth.status === 429 && fourth.body.code === 'demo_daily_limit', String(opened));
  show('...a demo from more than 24 hours ago does not count', (function () {
    DB.vp_sessions.forEach(function (s) { s.opened_at = '2026-09-17T09:00:00.000Z'; }); return true; })() &&
    (await call(handleCreateSession, { venue_id: VENUE, format: 'trivia', road: 'supabase', demo: true })).status === 200);

  print('');
  print('2. The demo join screen asks for the name, email, mobile and the one tick');
  world();
  DEMO = (await call(handleCreateSession, { venue_id: VENUE, format: 'trivia', road: 'supabase', demo: true })).body.session_id;
  var ji = await call(handleJoinInfo, { code: CODE, fresh: 1 });
  var c = ji.body && ji.body.collect;
  show('/join/info on the demo: demo true, up to 10', ji.body.demo === true && ji.body.demo_max === 10, JSON.stringify(ji.body));
  show('...collects first name, email, mobile and offers the tick', c && c.first_name && c.email && c.mobile && c.marketing_optin && !c.last_name && !c.postcode);
  var oreal = (await call(handleCreateSession, { venue_id: OTHER, format: 'trivia', road: 'supabase' })).body;
  var jr = await call(handleJoinInfo, { code: OCODE, fresh: 1 });
  show('CONTROL: a real night at a venue that collects nothing asks only the name', jr.body.demo !== true && jr.body.collect && !jr.body.collect.email && !jr.body.collect.mobile && !jr.body.collect.marketing_optin, JSON.stringify(jr.body.collect));

  print('');
  print('3. Fifty phones: up to 10 for the demo');
  var okJ = 0, full = 0, other = [];
  for (var p = 1; p <= 50; p++) {
    var j = await call(handleJoin, { code: CODE, pid: 'phone' + ('000' + p).slice(-3) + 'abc', name: 'Team ' + p });
    if (j.status === 200 && j.body.token) okJ++; else if (j.status === 403 && j.body.code === 'demo_full') full++; else other.push(j.status + ' ' + JSON.stringify(j.body));
  }
  show('50 phones try: 10 are in', okJ === 10, okJ + ' ' + other.join(';'));
  show('...40 are told "Up to 10 for the demo" (403 demo_full)', full === 40 && /Up to 10 for the demo/.test((await call(handleJoin, { code: CODE, pid: 'phone999abc', name: 'Late' })).body.error));
  show('...and only 10 player rows exist for the demo', DB.vp_players.filter(function (x) { return x.session_id === DEMO; }).length === 10);
  var back = await call(handleJoin, { code: CODE, pid: 'phone001abc', name: 'Team 1' });
  show('a phone already in gets back in (same row)', back.status === 200 && DB.vp_players.filter(function (x) { return x.session_id === DEMO; }).length === 10, JSON.stringify(back.body).slice(0, 120));
  var J50 = 0;
  for (var q = 1; q <= 12; q++) { var jj = await call(handleJoin, { code: OCODE, pid: 'other' + ('000' + q).slice(-3) + 'abc', name: 'T' + q }); if (jj.status === 200) J50++; }
  show('CONTROL: a real night takes the 11th and 12th phone', J50 === 12);

  print('');
  print('4. The opt-in tick puts them on THEIR OWN venue\'s list, only on the tick');
  world();
  DEMO = (await call(handleCreateSession, { venue_id: VENUE, format: 'trivia', road: 'supabase', demo: true })).body.session_id;
  var before = {}; Object.keys(DB).forEach(function (t) { before[t] = rowsOf(t); });
  await call(handleJoin, { code: CODE, pid: 'ownerphone01', name: 'Dean', first_name: 'Dean', email: 'dean@royal.example', mobile: '0400000001', marketing_optin: true });
  await call(handleJoin, { code: CODE, pid: 'ownerphone02', name: 'Sam', first_name: 'Sam', email: 'sam@royal.example', mobile: '0400000002', marketing_optin: false });
  var ticked = DB.vp_players.filter(function (x) { return x.device_id === 'ownerphone01'; })[0];
  var unticked = DB.vp_players.filter(function (x) { return x.device_id === 'ownerphone02'; })[0];
  show('ticked: email, mobile, opt-in and its time are kept', ticked && ticked.email === 'dean@royal.example' && ticked.mobile === '0400000001' && ticked.marketing_optin === true && !!ticked.marketing_optin_at, JSON.stringify(ticked));
  show('...on THIS venue\'s demo session (the opt-in list reads players by their session\'s venue)', ticked && ticked.session_id === DEMO && sess(DEMO).venue_id === VENUE);
  show('not ticked: no email and no mobile are kept, and no opt-in', unticked && !unticked.email && !unticked.mobile && !unticked.marketing_optin && unticked.first_name === 'Sam', JSON.stringify(unticked));
  var grew = Object.keys(DB).filter(function (t) { return t !== 'vp_players' && t !== '__events' && rowsOf(t) !== (before[t] || 0); });
  show('nothing is written to any other table (no other list, none of ours)', grew.length === 0, grew.join(','));
  show('a "marketing_optin" sent without a contact is not consent', (await call(handleJoin, { code: CODE, pid: 'ownerphone03', name: 'Jo', first_name: 'Jo', marketing_optin: true })) &&
    !DB.vp_players.filter(function (x) { return x.device_id === 'ownerphone03'; })[0].marketing_optin);

  print('');
  print('5. Starting the demo round: 5 questions of 30 s, nothing remembered, nothing asked about money');
  for (var z = 1; z <= 7; z++) await call(handleJoin, { code: CODE, pid: 'room' + z + 'phoneab', name: 'R' + z });   // 10 in a 5 player plan
  var g = await call(handleHostGame, { session_id: DEMO, format: 'trivia', question_set_id: SET, question_count: 20, time_limit_s: 60, double_points: true, double_last: 3, paper: true, base_points: 100 });
  show('the demo round starts with the room over the plan: no 402 overage ask', g.status === 200, JSON.stringify(g.body));
  var game = DB.vp_games.filter(function (x) { return x.session_id === DEMO; })[0], cfg = (game && game.config) || {};
  show('...5 questions whatever was sent', cfg.question_count === 5 && cfg.question_seqs.length === 5, JSON.stringify(cfg));
  show('...30 seconds a question whatever was sent', cfg.time_limit_s === 30);
  show('...no double points, no paper round, marked demo', !cfg.double_seqs && !cfg.defer_reveal && cfg.demo === true);
  show('...no question burned for 12 months (vp_asked_questions empty)', DB.vp_asked_questions.length === 0);
  show('...no trivia preferences saved for the venue', DB.vp_venue_settings.filter(function (x) { return x.venue_id === VENUE; }).length === 0);
  var v = DB.vp_venues[0];
  show('...the once-a-week trivia night is not stamped', !v.last_trivia_at && !v.last_trivia_session_id, JSON.stringify([v.last_trivia_at, v.last_trivia_session_id]));
  var g2 = await call(handleHostGame, { session_id: DEMO, format: 'trivia', question_set_id: SET });
  show('a second demo round is refused (409 demo_one_round)', g2.status === 409 && g2.body.code === 'demo_one_round');
  var gm = await call(handleHostGame, { session_id: DEMO, format: 'musical' });
  show('musical bingo on a demo session is refused', gm.status === 400 && gm.body.code === 'demo_trivia_only');

  var R = (await call(handleCreateSession, { venue_id: OTHER, format: 'trivia', road: 'supabase' })).body.session_id;
  for (var y = 1; y <= 7; y++) await call(handleJoin, { code: OCODE, pid: 'real' + y + 'phoneab', name: 'X' + y });
  var gr = await call(handleHostGame, { session_id: R, format: 'trivia', question_set_id: SET, question_count: 20, time_limit_s: 60, double_points: true, double_last: 3 });
  show('CONTROL: a real night over its plan is asked about the extras (402)', gr.status === 402 && gr.body.needs_overage_ack === true, JSON.stringify(gr.body));
  sess(R).overage_approved = true; sess(R).overage_approved_count = 7;
  gr = await call(handleHostGame, { session_id: R, format: 'trivia', question_set_id: SET, question_count: 20, time_limit_s: 60, double_points: true, double_last: 3 });
  var rg = DB.vp_games.filter(function (x) { return x.session_id === R; })[0], rc = (rg && rg.config) || {};
  show('CONTROL: the real round keeps its 20 questions and 60 s', gr.status === 200 && rc.question_count === 20 && rc.time_limit_s === 60, JSON.stringify(gr.body));
  show('CONTROL: the real round burns its questions', DB.vp_asked_questions.filter(function (x) { return x.venue_id === OTHER; }).length === 20);
  show('CONTROL: the real round saves the venue\'s trivia prefs', DB.vp_venue_settings.filter(function (x) { return x.venue_id === OTHER && x.trivia_time_limit_s === 60; }).length === 1);
  show('CONTROL: the real round stamps the once-a-week night', DB.vp_venues[1].last_trivia_session_id === R, JSON.stringify(DB.vp_venues[1].last_trivia_session_id));

  print('');
  print('6. Closing: the demo is never billed and never moves the three-big-nights streak');
  var benv = { SUPABASE_URL: ENV.SUPABASE_URL, SUPABASE_SERVICE_KEY: 'x', STRIPE_SECRET_KEY: 'k' + 'ey' };
  for (var w = 1; w <= 40; w++) DB.vp_players.push({ id: 'extra' + w, session_id: DEMO, device_id: 'extra-dev-' + w, kicked: false });   // 50 in all, as if typed
  sess(DEMO).overage_approved = true; sess(DEMO).overage_approved_count = 60;
  OUT.length = 0;
  var demoRow = JSON.parse(JSON.stringify(sess(DEMO)));
  try { await chargeNightOverage(benv, demoRow); } catch (e) { print('    threw ' + e.message); }
  show('a demo with 50 players on a 5 player plan, approved: Stripe never called', OUT.length === 0, JSON.stringify(OUT).slice(0, 200));
  show('...and the streak is untouched (2, same peaks, same day)', DB.vp_venues[0].overage_streak === 2 && DB.vp_venues[0].overage_streak_peaks.length === 2 && DB.vp_venues[0].overage_streak_day === '2026-09-17');
  var closeD = await call(handleSessionClose, { session_id: DEMO });
  show('the host closing the demo (the real close path) bills nothing either', closeD.status === 200 && closeD.body.status === 'finished' && OUT.length === 0);

  var notDemo = JSON.parse(JSON.stringify(demoRow)); notDemo.is_demo = false;
  OUT.length = 0;
  try { await chargeNightOverage(benv, notDemo); } catch (e) { print('    threw ' + e.message); }
  show('CONTROL: the same night, not a demo, is billed (Stripe is called)', OUT.some(function (o) { return /stripe\.com/.test(o.url); }), JSON.stringify(OUT).slice(0, 200));
  var quiet = { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', venue_id: OTHER, plan_cap_at_start: 5, status: 'lobby', opened_at: '2026-09-19T08:00:00.000Z' };
  DB.vp_sessions.push(quiet); DB.vp_players.push({ id: 'q1', session_id: quiet.id, device_id: 'q-dev-1', kicked: false });
  DB.vp_venues[1].overage_streak = 2;
  try { await chargeNightOverage(benv, quiet); } catch (e) { print('    threw ' + e.message); }
  show('CONTROL: a real quiet night resets the streak (what a demo must never do)', DB.vp_venues[1].overage_streak === 0, String(DB.vp_venues[1].overage_streak));

  print('');
  print('7. Metering and group overage leave a demo out');
  LOG.length = 0;
  var saveAdmin = requireScreenAdmin; requireScreenAdmin = async function () { return {}; };
  var met = await call(handleMetering, {});
  requireScreenAdmin = saveAdmin;
  var mread = LOG.filter(function (l) { return /^GET vp_sessions\?opened_at=gte/.test(l); })[0] || '';
  show('the metering read asks is_demo=not.is.true', /is_demo=not\.is\.true/.test(mread), mread);
  var metIds = JSON.stringify(met.body || {});
  show('...and the demo session is not in what it counts', metIds.indexOf(DEMO) < 0 && met.status === 200, metIds.slice(0, 160));
  var gsrc = String(handleGroupOverage);
  show('group overage reads its sessions with DEMO_OFF', /'vp_sessions',\s*'venue_id=eq\.' \+ enc\(v\.id\) \+ '&opened_at=gte\.' \+ enc\(since\) \+ DEMO_OFF/.test(gsrc));

  print('');
  print('8. A new venue plays the demo before the Terms tick; a real night still waits for it');
  world();
  DB.vp_venues[0].terms_required = true; DB.vp_venues[0].compliance_accepted_at = null;
  var hd = await call(handleCreateSession, { venue_id: VENUE, format: 'trivia', road: 'supabase', demo: true });
  show('a venue that has not ticked opens the demo', hd.status === 200 && hd.body.demo === true, JSON.stringify(hd.body));
  var hg = await call(handleHostGame, { session_id: hd.body.session_id, format: 'trivia', question_set_id: SET });
  show('...and starts its 5-question round', hg.status === 200 && hg.body.question_count === 5, JSON.stringify(hg.body));
  sess(hd.body.session_id).status = 'finished'; sess(hd.body.session_id).ended_at = new Date().toISOString();
  var hr = await call(handleCreateSession, { venue_id: VENUE, format: 'trivia', road: 'supabase' });
  show('a real night at the same venue is still held for the tick (terms_first)', hr.status === 403 && hr.body.code === 'terms_first', JSON.stringify(hr.body));

  print('');
  print(bad ? ('FAILED ' + bad + ' of ' + ran) : ('ALL ' + ran + ' CHECKS PASSED'));
})().catch(function (e) { print('  FAIL suite threw: ' + e + '\n' + (e && e.stack)); bad++; });
