/* DAY 21: THE GAMES A FREE-MONTH VENUE PICKED AND HAS NOT PLAYED (Dean, 10 Nov 2026, INBOX 129).

   "On day 21 of a free month, HQ Prospects flags any venue that has NOT played one or more of the games it
   picked at sign-up (wizard answers, migration 163), e.g. picked trivia + bingo, played neither = flag
   'picked trivia, bingo; played none', played trivia only = flag 'bingo not played'. Flag shows in the
   Prospects list and on the venue, plus one line in Dean's HQ alert. Venues with no wizard answers: flag if
   no game at all by day 21. Nothing is sent to the venue by this flag."

   Runs the REAL billing Worker (tools/rig-billing-worker.js) on a FAKE CLOCK (every time below is fixed):
     1. vpaProspectsData, the read behind HQ > Prospects: day 20 no flag; day 21 the flag; played one of two;
        played none; no wizard answers (nothing played = flag, anything played = none); musical bingo is
        never bingo; a try-it demo game is not a game; broadcast bingo reports and members draws count;
        house order; a card added during the month still flagged; cancelled and ended months never
     2. vpaProspectDay21Sweep, Dean's HQ alert: nothing before 9am Brisbane; at 9am ONE sales ticket with
        ONE line per venue, pushed to HQ's phones; once a day; each venue once ever; nothing to any venue
     3. the HQ pane (venueplay/app/vp-prospects-hq.js): the badge in the list, the line on the venue, the
        "Games not played" filter, and nothing at all for a venue with no flag

   Run from the repo root:  jsc tools/test-day21-flag.js */
var ran = 0, bad = 0;
function check(n, c, saw) { ran++; if (c) print('  ok   ' + n); else { bad++; print('  FAIL ' + n + (saw !== undefined ? '   saw: ' + String(typeof saw === 'string' ? saw : JSON.stringify(saw)).slice(0, 500) : '')); } }
function section(t) { print(''); print(t); }

load('tools/rig-billing-worker.js');
var __rnd = 7;   /* the help desk's reply token needs random bytes; jsc has no crypto */
if (typeof crypto === 'undefined') crypto = { getRandomValues: function (a) { for (var i = 0; i < a.length; i++) { __rnd = (Math.imul(__rnd, 1103515245) + 12345) >>> 0; a[i] = (__rnd >>> 16) & 255; } return a; } };
var PUSHED = [];
helpPushNew = function (env, t) { PUSHED.push(t); return Promise.resolve({ sent: 1 }); };
var SMS = [];
var rigFetch = globalThis.fetch;
globalThis.fetch = function (url, opts) {
  var u = String(url);
  if (u.indexOf('clicksend') !== -1 || u.indexOf('twilio') !== -1) { SMS.push(u); }
  return rigFetch(url, opts);
};

function U(n) { return '21000000-0000-4000-8000-' + ('000000000000' + n).slice(-12); }
var FIRST = '2026-11-01T00:00:00Z';                  // 10am Brisbane, Sun 1 Nov: day 0 of the free month
var DAY20 = Date.parse('2026-11-21T02:00:00Z');      // noon Brisbane, Sat 21 Nov: day 20
var DAY21 = Date.parse('2026-11-22T02:00:00Z');      // noon Brisbane, Sun 22 Nov: day 21
var DAY21_8AM = Date.parse('2026-11-21T22:00:00Z');  // 8am Brisbane, Sun 22 Nov: day 21, before the alert hour
var DAY21_9AM = Date.parse('2026-11-21T23:00:00Z');  // 9am Brisbane, Sun 22 Nov
var DAY22 = Date.parse('2026-11-23T02:00:00Z');
var ENDED = Date.parse('2026-12-02T02:00:00Z');      // the day after the free month's last day

var N = 0, SES = 0;
function venue(name, opts) {
  opts = opts || {};
  var id = U(++N), fid = 'f' + N;
  DB.vp_venues.push({ id: id, name: name, slug: 'v' + N, postcode: '4220', au_state: 'QLD', founding_id: fid, group_id: null, status: 'active', suspended_reason: null });
  DB.venueplay_founding.push({ id: fid, status: opts.card ? 'card_on_file' : 'trial', stripe_subscription_id: opts.card ? 'sub_' + N : null, bill_by_invoice: false, mobile: null });
  DB.vp_prospects.push({ venue_id: id, founding_id: fid, source: 'hq', contact_name: 'Sam', email: 'v' + N + '@x.example', phone: null,
    created_at: '2026-10-30T00:00:00Z', first_signin_at: opts.first || FIRST, free_month_ends_at: null, paused_at: null,
    cancelled_at: opts.cancelled || null, reminders_sent: [] });
  if (opts.games !== undefined) DB.vp_venue_settings.push({ venue_id: id, setup_answers: opts.games === null ? null : { games: opts.games, nights: ['fri'] } });
  (opts.played || []).forEach(function (f) {
    var demo = /^demo:/.test(f); f = f.replace(/^demo:/, '');
    if (f === 'report') { DB.vp_game_reports.push({ id: 'r' + N, venue_id: id, format: 'bingo' }); return; }
    if (f === 'members') { DB.vp_member_draws.push({ id: 'd' + N, venue_id: id }); DB.vp_member_draw_results.push({ id: 'dr' + N, draw_id: 'd' + N }); return; }
    if (f === 'members_no_result') { DB.vp_member_draws.push({ id: 'd' + N, venue_id: id }); return; }
    var sid = 's' + (++SES);
    DB.vp_sessions.push({ id: sid, venue_id: id, is_demo: demo });
    DB.vp_games.push({ id: 'g' + SES, session_id: sid, format: f });
  });
  return id;
}
function world() {
  DB = { vp_venues: [], venueplay_founding: [], vp_prospects: [], vp_venue_settings: [], vp_sessions: [], vp_games: [], vp_game_reports: [],
    vp_member_draws: [], vp_member_draw_results: [], vp_venue_staff: [], vp_admin_audit: [], vp_help_tickets: [] };
  sent.length = 0; PUSHED.length = 0; SMS.length = 0; N = 0; SES = 0;
  delete ENV.VAPID_PRIVATE_JWK;
}
function byName(d, name) { return (d.prospects || []).concat(d.card_added || []).filter(function (p) { return p.name === name; })[0] || null; }
function words(d, name) { var p = byName(d, name); return p && p.day21 ? p.day21.words : null; }
function shown(d, name) { var p = byName(d, name); return p ? { status: p.status, day21: p.day21 } : null; }

(async function () {
  section('1. HQ > Prospects works it out on every read (vpaProspectsData, fake clock)');
  world();
  venue('Trivia Bingo Arms', { games: ['trivia', 'bingo'] });
  venue('Half Played Hotel', { games: ['trivia', 'bingo'], played: ['trivia'] });
  venue('All Played Tavern', { games: ['trivia', 'musical'], played: ['trivia', 'musical_bingo'] });
  venue('Musical Only Inn', { games: ['bingo'], played: ['musical_bingo'] });
  venue('No Answers Club', {});
  venue('No Answers Played', { games: null, played: ['raffle'] });
  venue('Demo Only Bar', { games: ['trivia'], played: ['demo:trivia'] });
  venue('Report Bingo Hotel', { games: ['bingo'], played: ['report'] });
  venue('House Order Club', { games: ['members', 'raffles', 'trivia'], played: ['members'] });
  venue('Draw No Result RSL', { games: ['members'], played: ['members_no_result'] });
  venue('Card Added Hotel', { games: ['trivia'], card: true });
  venue('Cancelled Arms', { games: ['trivia'], cancelled: '2026-11-10T00:00:00Z' });
  venue('Other Only Pub', { games: ['other'] });
  venue('Bingo90 Tavern', { games: ['bingo', 'musical'], played: ['bingo90'] });

  var d20 = await vpaProspectsData(ENV, { now: DAY20 });
  var any20 = (d20.prospects || []).concat(d20.card_added || []).filter(function (p) { return p.day21; });
  check('day 20: no venue is flagged, whatever it has played', d20.ok === true && any20.length === 0 && d20.day21_count === 0, any20.map(function (p) { return p.name; }));

  var d = await vpaProspectsData(ENV, { now: DAY21 });
  check('day 21: picked trivia + bingo, played neither = "picked trivia, bingo; played none"', words(d, 'Trivia Bingo Arms') === 'picked trivia, bingo; played none', byName(d, 'Trivia Bingo Arms'));
  check('day 21: picked trivia + bingo, played trivia only = "bingo not played"', words(d, 'Half Played Hotel') === 'bingo not played', byName(d, 'Half Played Hotel'));
  check('played every game it picked: no flag', words(d, 'All Played Tavern') === null && byName(d, 'All Played Tavern') !== null, byName(d, 'All Played Tavern'));
  check('MUSICAL BINGO IS NOT BINGO: picked bingo, played only musical bingo = "bingo not played" (not "played none": they played something)', words(d, 'Musical Only Inn') === 'bingo not played', shown(d, 'Musical Only Inn'));
  check('no wizard answers and no game at all by day 21 = "no game played yet"', words(d, 'No Answers Club') === 'no game played yet' && byName(d, 'No Answers Club').day21.played_none === true, byName(d, 'No Answers Club'));
  check('no wizard answers but a game played (a raffle): no flag', words(d, 'No Answers Played') === null, byName(d, 'No Answers Played'));
  check('a try-it demo game is not a game: picked trivia, played it only in the demo = "picked trivia; played none"', words(d, 'Demo Only Bar') === 'picked trivia; played none', shown(d, 'Demo Only Bar'));
  check('a broadcast bingo report (no session) counts as bingo played', words(d, 'Report Bingo Hotel') === null, byName(d, 'Report Bingo Hotel'));
  check('a members draw that drew counts; the rest in HOUSE ORDER: "trivia, raffles not played"', words(d, 'House Order Club') === 'trivia, raffles not played', byName(d, 'House Order Club'));
  check('a members draw set up but never drawn is not played', words(d, 'Draw No Result RSL') === 'picked members draws; played none', shown(d, 'Draw No Result RSL'));
  check('a card added during the free month is still flagged, in the Card added list', words(d, 'Card Added Hotel') === 'picked trivia; played none' && (d.card_added || []).some(function (p) { return p.name === 'Card Added Hotel'; }), shown(d, 'Card Added Hotel'));
  check('a cancelled free month is never flagged', words(d, 'Cancelled Arms') === null, byName(d, 'Cancelled Arms'));
  check('a wizard answer of only "Something else" is treated as no answer: nothing played = "no game played yet"', words(d, 'Other Only Pub') === 'no game played yet', byName(d, 'Other Only Pub'));
  check('bingo90 (the 1-90 game) is bingo; musical bingo still not played', words(d, 'Bingo90 Tavern') === 'musical bingo not played', byName(d, 'Bingo90 Tavern'));
  check('the flag carries the day (21), what was picked and what is missing', (function (p) { return p && p.day21.day === 21 && JSON.stringify(p.day21.picked) === '["trivia","bingo"]' && JSON.stringify(p.day21.missing) === '["bingo"]'; })(byName(d, 'Half Played Hotel')), byName(d, 'Half Played Hotel'));
  check('the list counts them for the head line (day21_count) and names the day', d.day21_count === 10 && d.day21_day === 21, [d.day21_count, d.day21_day]);
  var dEnd = await vpaProspectsData(ENV, { now: ENDED });
  check('after the free month has ended: no flag on anyone', (dEnd.prospects || []).concat(dEnd.card_added || []).every(function (p) { return !p.day21; }));
  FAIL['vp_venue_settings:GET'] = 1;
  var dFail = await vpaProspectsData(ENV, { now: DAY21 });
  check('the wizard answers cannot be read: no flag on anyone (never a wrong one), and the list still loads', dFail.ok === true && (dFail.prospects || []).every(function (p) { return !p.day21; }) && dFail.prospects.length > 5, dFail.prospects && dFail.prospects.length);
  FAIL = {};
  check('reading the flags sent nothing to anyone', sent.length === 0 && SMS.length === 0, sent);

  section('2. Dean\'s HQ alert (vpaProspectDay21Sweep): one line per venue, once');
  var r8 = await vpaProspectDay21Sweep(ENV, DAY21_8AM);
  check('8am Brisbane on day 21: no alert yet', r8.alerted === 0 && DB.vp_help_tickets.length === 0, r8);
  var r20 = await vpaProspectDay21Sweep(ENV, DAY20);
  check('day 20, noon: no alert', r20.alerted === 0 && DB.vp_help_tickets.length === 0, r20);
  var r9 = await vpaProspectDay21Sweep(ENV, DAY21_9AM);
  var t = DB.vp_help_tickets[0] || {};
  check('9am Brisbane on day 21: ONE HQ ticket, in Sales', DB.vp_help_tickets.length === 1 && t.category === 'sales' && t.brand === 'venueplay', DB.vp_help_tickets);
  check('its title says how many', t.subject === 'Day 21: 10 free-month venues have not played their games', t.subject);
  var lines = String(t.message || '').split('\n').filter(function (l) { return / \(day 21\): /.test(l); });
  check('ONE line per flagged venue, each named once, in its own words',
    lines.length === 10 && lines.indexOf('Trivia Bingo Arms (day 21): picked trivia, bingo; played none') !== -1 && lines.indexOf('Half Played Hotel (day 21): bingo not played') !== -1
    && lines.indexOf('No Answers Club (day 21): no game played yet') !== -1 && !/All Played Tavern|Cancelled Arms|Report Bingo Hotel|No Answers Played/.test(t.message), t.message);
  check('it says nothing was sent to the venues', /Nothing has been sent to these venues\./.test(t.message || ''), t.message);
  check('it is pushed to HQ\'s phones, once', PUSHED.length === 1 && PUSHED[0].subject === t.subject, PUSHED.length);
  check('nothing goes to any venue: no email, no text, no contact on the ticket', sent.length === 0 && SMS.length === 0 && !t.contact_email && !t.contact_phone, [sent.length, SMS.length, t.contact_email]);
  check('each venue is recorded as alerted (vp_admin_audit prospect_day21_flag)', DB.vp_admin_audit.filter(function (a) { return a.action === 'prospect_day21_flag'; }).length === 10);
  var rAgain = await vpaProspectDay21Sweep(ENV, DAY21_9AM + 3600000);
  check('the next hour, same day: no second alert', rAgain.alerted === 0 && DB.vp_help_tickets.length === 1 && PUSHED.length === 1, rAgain);
  var late = venue('Late Starter Hotel', { games: ['trivia', 'musical'], played: ['trivia'], first: '2026-11-02T00:00:00Z' });
  var r22 = await vpaProspectDay21Sweep(ENV, DAY22);
  var t2 = DB.vp_help_tickets[1] || {};
  check('the next day: a new ticket with ONLY the venue that reached day 21 today; nobody is alerted twice',
    r22.alerted === 1 && DB.vp_help_tickets.length === 2 && t2.subject === 'Day 21: 1 free-month venue has not played their games'
    && /^Late Starter Hotel \(day 21\): musical bingo not played$/m.test(t2.message || '') && !/Trivia Bingo Arms/.test(t2.message || '') && t2.venue_id === late, [r22, t2]);
  var r23 = await vpaProspectDay21Sweep(ENV, DAY22 + 86400000);
  check('the day after: everyone already alerted, no ticket', r23.alerted === 0 && DB.vp_help_tickets.length === 2, r23);
  world();
  venue('Played Everything Arms', { games: ['trivia'], played: ['trivia'] });
  var rNone = await vpaProspectDay21Sweep(ENV, DAY21_9AM);
  check('nobody flagged: no ticket and no push', rNone.alerted === 0 && DB.vp_help_tickets.length === 0 && PUSHED.length === 0, rNone);

  section('3. The HQ pane: the flag in the Prospects list and on the venue');
  var PANE = readFile('venueplay/app/vp-prospects-hq.js');
  var W = { VP: null, fetch: function () { return Promise.resolve({ status: 200, ok: true, json: function () { return Promise.resolve({}); } }); }, setTimeout: function () {}, CustomEvent: function () {} };
  W.document = { readyState: 'complete', getElementById: function () { return null; }, addEventListener: function () {} };
  (new Function('window', PANE))(W);
  var T = W.VPProspects._t;
  var base = { venue_id: U(90), name: 'Half Played Hotel', contact_name: 'Sam', email: 's@x.example', phone: null, tel: null, source: 'hq', created_at: '2026-10-30T00:00:00Z',
    days_since_setup: 23, welcome: null, last_sign_in_at: '2026-11-20T00:00:00Z', sign_in_known: true, flag: null, called: null, status: 'free_month', days_left: 10,
    first_signin_at: FIRST, free_month_ends_at: '2026-12-01T13:59:59Z' };
  var flagged = Object.assign({}, base, { day21: { day: 21, picked: ['trivia', 'bingo'], missing: ['bingo'], played_none: false, words: 'bingo not played' } });
  var none = Object.assign({}, base, { venue_id: U(91), name: 'Picked None Arms', day21: { day: 21, picked: ['trivia', 'bingo'], missing: ['trivia', 'bingo'], played_none: true, words: 'picked trivia, bingo; played none' } });
  var clean = Object.assign({}, base, { venue_id: U(92), name: 'Clean Tavern', day21: null });
  var hF = T.cardHtml(flagged), hN = T.cardHtml(none), hC = T.cardHtml(clean);
  var top = function (h) { return h.slice(h.indexOf('<div class="prtop">'), h.indexOf('<div class="prmore"')); };
  check('the list row (always visible) shows the flag beside the status: "Bingo not played"', /<span class="badge prd21" data-pr-day21="1"[^>]*>Bingo not played<\/span>/.test(top(hF)), top(hF));
  check('...and "Picked trivia, bingo; played none"', /data-pr-day21="1"[^>]*>Picked trivia, bingo; played none<\/span>/.test(top(hN)), top(hN));
  check('on the venue (its details): the day, the words, and that nothing was sent to them',
    /data-pr-day21line="1">Day 21 of their free month: bingo not played\. Nothing has been sent to them about it\.<\/div>/.test(hF), hF);
  check('a venue with no flag shows neither', !/data-pr-day21/.test(hC), hC);
  T.S.filter = 'not_played';
  var lh = T.listHtml({ prospects: [flagged, clean], card_added: [none], follow_up_count: 0, follow_up_days: 3, last_days: 3, day21_day: 21 });
  check('the "Games not played by day 21" filter lists only the flagged venues, Card added included', /Games not played by day 21 \(2\)/.test(lh) && /Half Played Hotel/.test(lh) && /Picked None Arms/.test(lh) && !/Clean Tavern<span/.test(lh) && !/data-pr-id="' + U(92) + '"/.test(lh) && lh.indexOf('data-pr-id="' + U(92) + '"') === -1, lh.slice(0, 1500));
  T.S.filter = 'all';
  check('the pane head explains the red flag and that nothing is sent', /From day 21 of a free month, a venue that has not played the games it picked at setup \(or any game, if it did not say\) is flagged in red; nothing is sent to them\./.test(T.listHtml({ prospects: [clean], day21_day: 21 })));
  check('no em or en dash in the pane', !/[—–]/.test(PANE));

  print(''); print(bad ? ('FAILED ' + bad + ' of ' + ran) : ('PASS ' + ran + ' checks'));
  if (bad) throw new Error(bad + ' failed');
})().catch(function (e) { print('  FAIL ' + (e && e.message) + ' ' + (e && e.stack || e)); });
drainMicrotasks();
