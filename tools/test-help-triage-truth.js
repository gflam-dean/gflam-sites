/* THE HELP STEPS SAY WHAT THE PRODUCT DOES (Dean, 21 Oct 2026).

   Dean, reviewing the venue Help panel: "Players cannot join" told a venue to "check your player
   limit", as if the plan could stop people joining. It never does: /join has no plan cap, and the
   cap is only asked about when the host starts a game (the console shows the extra players and the
   host taps Start game). And the steps were in the wrong order: "have they got the link" belongs
   first.

   So this:
     1. builds the steps the database ends up with, the way Postgres would: migration 106's seed,
        then every later guarded "update public.vp_help_steps" (113 so far), applied only where
        its guard matches. Then it checks the order, the words and the pins.
     2. RUNS the real /join out of the shipped game Worker, at a venue whose plan is 1 player,
        with 3 already in: a fourth phone still gets in. If that ever changes, the words are wrong.
     3. checks the button the words name ("Start game") is the button on the extra-players message
        in all three consoles.

   Run from the repo root:  jsc tools/test-help-triage-truth.js
*/
load('tools/rig-game-worker.js');
var fails = 0, ranT = 0;
function check(name, ok, saw) { ranT++; if (ok) print('  ok   ' + name); else { fails++; print('  FAIL ' + name + (saw === undefined ? '' : '   saw: ' + JSON.stringify(saw).slice(0, 400))); } }

var ISSUE = '927e1377-e4c3-5065-9b7b-03d937321928', TV = '857c3542-d097-54c2-afba-9cdbd1f5a193';
var Q = "'((?:[^']|'')*)'";
function unq(s) { return s.replace(/''/g, "'"); }

/* ---- 1. the steps as the database ends up with them ---- */
var steps = {}, tvSteps = {};
var seed = readFile('venueplay-backend/supabase/venueplay-106-help-desk.sql');
var ins = new RegExp("insert into public\\.vp_help_steps \\(id, issue_id, position, body, pinned\\) values \\(" + Q + ", " + Q + ", (\\d+), " + Q + ", (true|false)\\)", 'g'), m;
while ((m = ins.exec(seed))) { var row0 = { id: m[1], position: +m[3], body: unq(m[4]), pinned: m[5] === 'true' }; if (m[2] === ISSUE) steps[m[1]] = row0; else if (m[2] === TV) tvSteps[m[1]] = row0; }
check('migration 106 seeds three steps for "Players cannot join"', Object.keys(steps).length === 3, Object.keys(steps));

function apply(file) {
  var src = readFile(file), n = 0;
  var up = /update public\.vp_help_steps\s+set([\s\S]*?)\s+where([\s\S]*?);/g, u;
  while ((u = up.exec(src))) {
    var set = u[1], where = u[2];
    var id = new RegExp('id = ' + Q).exec(where); id = id && id[1];
    var row = steps[id] || tvSteps[id]; if (!row) continue;
    var guards = [];
    var gin = /and body in \(([\s\S]*?)\)\s*$/.exec(where), geq = new RegExp('and body = ' + Q + '\\s*$').exec(where);
    if (gin) { var g, gr = new RegExp(Q, 'g'); while ((g = gr.exec(gin[1]))) guards.push(unq(g[1])); }
    else if (geq) guards.push(unq(geq[1]));
    if (!guards.length || guards.indexOf(row.body) < 0) continue;
    var b = new RegExp('body = ' + Q).exec(set); if (b) row.body = unq(b[1]);
    var p = /position = (\d+)/.exec(set); if (p) row.position = +p[1];
    var pn = /pinned = (true|false)/.exec(set); if (pn) row.pinned = pn[1] === 'true';
    n++;
  }
  return n;
}
var applied = apply('venueplay-backend/supabase/venueplay-113-help-join-steps-true.sql');
check('migration 113 changes all five (three join steps, two TV steps), each only where it still reads as seeded', applied === 5, applied);
var before = JSON.stringify(steps);
check('and running 113 a second time changes nothing (its guard also accepts its own words)', apply('venueplay-backend/supabase/venueplay-113-help-join-steps-true.sql') === 3 && JSON.stringify(steps) === before);
var tv = Object.keys(tvSteps).map(function (k) { return tvSteps[k]; }).sort(function (a, b) { return a.position - b.position; }).map(function (x) { return x.body; });
check('TV step 2 names the venue\'s own link: the {tv_link} the Help panel fills in', tv[1] === 'Check the TV is showing {tv_link}.', tv[1]);
check('TV step 3 says what online means', tv[2] === 'Check the TV is connected to the internet: try opening another website on it.', tv[2]);
var list = Object.keys(steps).map(function (k) { return steps[k]; }).sort(function (a, b) { return a.position - b.position; });
var words = list.map(function (s) { return s.body; });
check('step 1 is the way in: the QR code on the TV, or venueplay.com.au/play', /QR code on the TV/.test(words[0]) && /venueplay\.com\.au\/play/.test(words[0]), words[0]);
check('step 2 is the code they typed against the code on the TV', /code they typed matches the code on the TV/.test(words[1]), words[1]);
check('steps 1 and 2 are pinned, so the automatic reorder can never move them', list[0].pinned && list[1].pinned, list.map(function (s) { return s.pinned; }));
check('no step says the player limit can stop anyone joining', !words.some(function (w) { return /player limit|check your (plan|limit)/i.test(w); }), words);
check('the extra-players step says the plan never stops a join, and names Start game', /never stops anyone joining/.test(words[2]) && /Start game/.test(words[2]), words[2]);
check('house rules: no long dashes, under the 300 characters the column allows', words.every(function (w) { return w.indexOf('—') < 0 && w.indexOf('–') < 0 && w.length <= 300; }));
// The same order, run through the Worker's own reorder: nothing moves however the answers fall.
// Lifted out of the shipped billing Worker as written (loading its rig as well would swap this
// suite's fake database for its own): the reorder, its two constants and the rate it sorts by.
var API = readFile('venueplay-backend/worker/venueplay-api-FULL.js');
function lift(re) { var x = re.exec(API); return x ? x[0] : ''; }
var liftSrc = [lift(/^const HELP_REORDER_MIN_TRIES = [^\n]*/m), lift(/^const HELP_REORDER_MARGIN = [^\n]*/m),
               lift(/^function helpRate\(s\) [^\n]*/m), lift(/^function helpOrder\(steps\) \{[\s\S]*?\n\}/m)].join('\n');
check('the reorder and what it needs are in the billing Worker', liftSrc.split('\n').length >= 4 && /function helpOrder/.test(liftSrc));
var helpOrder = (0, eval)('(function(){' + liftSrc.replace(/^const /gm, 'var ') + '; return helpOrder; })()');
var fixed = list.map(function (s, i) { return { id: s.id, pinned: s.pinned, tries: 100, fixes: i === 2 ? 90 : 1 }; });
check("the billing Worker's own helpOrder keeps the join link first even when step 3 fixes most", JSON.stringify(helpOrder(fixed)) === JSON.stringify(list.map(function (s) { return s.id; })), helpOrder(fixed));

/* ---- 2. the plan never stops a join: the real /join, over the cap ---- */
var CODE = 'HJKMNP', SID = '33333333-3333-4333-8333-333333333333';
DB.vp_venues = [{ id: VENUE, name: 'Test Alpha', status: 'active', max_players: 1 }];
DB.vp_sessions = [{ id: SID, venue_id: VENUE, join_code: CODE, status: 'running', plan_cap_at_start: 1, created_at: '2026-09-19T09:00:00Z' }];
DB.vp_players = [1, 2, 3].map(function (i) { return { id: '44444444-4444-4444-8444-00000000000' + i, session_id: SID, device_id: 'phone-' + i, kicked: false, display_name: 'P' + i }; });
DB.vp_venue_settings = []; DB.vp_games = [];
var hdrs = { get: function () { return ''; } };
(async function () {
  try {
    BODY = { code: CODE, name: 'Fourth', pid: 'phone-4abc' };
    var r = await handleJoin({ headers: hdrs }, ENV, json);
    check('a fourth phone joins a venue whose plan is 1 player, with 3 already in', r.status === 200 && !!(r.body && r.body.token), r);
    check('and is a real player row in that session', DB.vp_players.filter(function (p) { return p.session_id === SID; }).length === 4, DB.vp_players.length);
    BODY = { code: 'ZZZZZZ', name: 'Nobody', pid: 'phone-zzz' };
    var r2; try { r2 = await handleJoin({ headers: hdrs }, ENV, json); } catch (e) { r2 = { status: 'threw' }; }
    check('control: a code with no game IS refused, so the join above was a real test', r2.status !== 200, r2);
  } catch (e) { check('the join ran', false, String(e && e.stack || e)); }

  /* ---- 3. the button the words name is the one on screen ---- */
  ['venueplay/app/index.html', 'venueplay/app/musical/host.html', 'venueplay/app/trivia/host.html'].forEach(function (f) {
    var src = readFile(f);
    check(f + ': the extra-players message approves with a button reading "Start game"', /<button[^>]*id="ovgGo"[^>]*>Start game<\/button>/.test(src));
  });
  var faq = JSON.parse(readFile('venueplay/data/help-faq.json'));
  var bill = faq.venue.items.filter(function (i) { return i.q === 'Billing and players'; })[0];
  var contact = faq.venue.items.filter(function (i) { return i.q === 'Contacting us'; })[0];
  check('the FAQ "Contacting us" no longer tells anyone to tick a box that is gone, and says a game on makes it urgent', contact && !/Happening now|tick/i.test(contact.a) && /game is on/.test(contact.a), contact && contact.a);
  var mig = readFile('venueplay-backend/supabase/venueplay-113-help-join-steps-true.sql');
  check('and 113 changes it in the database from either the seeded words or migration 112\'s', (mig.match(/where id = 'df7d1acb-f519-5a1a-8889-518c0d69cb87'/g) || []).length === 2 && mig.indexOf('(tick "Happening now" if it cannot wait)') > 0);
  check('the FAQ "Billing and players" no longer says the plan sets how many can join', bill && !/sets how many players can join/.test(bill.a) && /never stops anyone joining/.test(bill.a), bill && bill.a);

  print('');
  print(fails ? (fails + ' FAILED, ' + ranT + ' run') : ('ALL ' + ranT + ' CHECKS PASSED'));
})().catch(function (e) { print('  FAIL the suite threw: ' + (e && e.stack || e)); print('1 FAILED'); });
