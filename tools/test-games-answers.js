/* What venues play: the one internal email a month to Dean (INBOX 104a, Nov 2026), RUN on a fake
   month and every number checked against a hand count.

   Runs the REAL billing Worker on tools/rig-billing-worker.js (a fake PostgREST and a fake Resend
   that records what was sent). The clock is pinned. Nothing leaves this machine.

   THE HAND COUNT, October 2026 (the sweep at 3am on 1 Nov Brisbane reports on October):
     V1 The Royal Hotel   active   trivia, musical, raffles      games_at 2026-10-05   setup trivia done, musical later
     V2 The Anchor Pub    active   bingo, trivia                 games_at 2026-09-20   setup bingo done, trivia shown
     V3 The Big Club      active   members, raffles, musical x2  games_at 2026-10-30   setup members done, raffles done
     V4 Test Alpha        active, a TEST venue, every game, games_at 2026-10-10         left out
     V5 The Old Inn       cancelled, trivia, games_at 2026-10-02                         left out
     V6 The Quiet Inn     active, never answered the games question                     counted as a venue, not an answer
   = 4 active venues, 3 answered, 2 of them in October (V1, V3).
     Trivia         plays 2 (V1 V2)   new 1 (V1)      set up 1 (V1)
     Musical bingo  plays 2 (V1 V3)   new 2           set up 0 (V1 said later)
     Bingo          plays 1 (V2)      new 0           set up 1 (V2)
     Raffles        plays 2 (V1 V3)   new 2           set up 1 (V3)
     Members draws  plays 1 (V3)      new 1           set up 1 (V3)

   Run from the repo root:  jsc tools/test-games-answers.js
*/
load('tools/rig-billing-worker.js');
function fnv(bytes, seed) { var out = new Uint8Array(32), h = (2166136261 ^ seed) >>> 0; for (var r = 0; r < 32; r++) { for (var i = 0; i < bytes.length; i++) { h ^= bytes[i] + r; h = Math.imul(h, 16777619) >>> 0; } out[r] = h & 255; } return out; }
if (typeof TextEncoder === 'undefined') { TextEncoder = function () {}; TextEncoder.prototype.encode = function (s) { s = unescape(encodeURIComponent(String(s))); var a = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return a; }; }
if (typeof crypto === 'undefined') crypto = { subtle: {
  importKey: function (fmt, raw) { return Promise.resolve({ k: fnv(new Uint8Array(raw), 2)[0] }); },
  sign: function (alg, key, data) { return Promise.resolve(fnv(new Uint8Array(data), 3 + key.k).buffer); } } };
var V1 = 'b0000000-0000-4000-8000-000000000001', V2 = 'b0000000-0000-4000-8000-000000000002', V3 = 'b0000000-0000-4000-8000-000000000003',
    V4 = 'b0000000-0000-4000-8000-000000000004', V5 = 'b0000000-0000-4000-8000-000000000005', V6 = 'b0000000-0000-4000-8000-000000000006';
var fails = 0, ran = 0;
function check(name, ok, saw) { ran++; if (ok) print('  ok   ' + name); else { print('  FAIL ' + name + (saw === undefined ? '' : '   saw: ' + JSON.stringify(saw).slice(0, 400))); fails++; } }
vpaVerifyJWT = async function (t) { return t ? { sub: t } : null; };
var NOW = Date.parse('2026-10-31T17:00:00Z');              // 3am on Sun 1 Nov in Brisbane
Date.now = function () { return NOW; };
var ADMIN = '60000000-0000-4000-8000-000000000009', STAFF_ADMIN = '60000000-0000-4000-8000-000000000010';
function as(user, body) { var h = { Authorization: 'Bearer ' + user };
  return { headers: { get: function (k) { return h[k] || ''; } }, text: function () { return Promise.resolve(JSON.stringify(body || {})); }, json: function () { return Promise.resolve(body || {}); } }; }
async function call(fn, user, body) { try { return await fn(as(user, body), ENV, J); } catch (e) { return { status: 'THREW', body: { error: String(e) } }; } }
var RIG_FETCH = globalThis.fetch;
var COLUMN_MISSING = false;
globalThis.fetch = function (url, opts) {
  var u = String(url);
  /* Before migration 163 PostgREST answers 400 (42703, column does not exist) for a select naming setup_answers. */
  if (COLUMN_MISSING && u.indexOf('/rest/v1/vp_venue_settings') !== -1 && u.indexOf('setup_answers') !== -1)
    return Promise.resolve({ ok: false, status: 400, json: function () { return Promise.resolve({ code: '42703' }); },
      text: function () { return Promise.resolve('{"code":"42703","message":"column vp_venue_settings.setup_answers does not exist"}'); } });
  return RIG_FETCH(url, opts);
};

function world() {
  DB = {}; sent.length = 0; FAIL = {}; COLUMN_MISSING = false; vprForget();
  DB.venueplay_founding = [{ id: 'f1', contact_email: 'owner@royalhotel.com.au', contact_name: 'Sam Smith', plan: 'monthly', status: 'card_on_file' },
                           { id: 'f2', contact_email: 'boss@anchorpub.com.au', plan: 'monthly', status: 'card_on_file' },
                           { id: 'f3', contact_email: 'big@bigclub.com.au', plan: 'monthly', status: 'card_on_file' },
                           { id: 'f4', contact_email: 'dean@test.com.au', plan: 'monthly', status: 'card_on_file' },
                           { id: 'f5', contact_email: 'old@oldinn.com.au', plan: 'monthly', status: 'cancelled' },
                           { id: 'f6', contact_email: 'quiet@quietinn.com.au', plan: 'monthly', status: 'card_on_file' }];
  function V(id, name, f, slug, status) { return { id: id, name: name, founding_id: f, slug: slug, status: status, timezone: 'Australia/Brisbane', created_at: '2026-08-01T00:00:00Z' }; }
  DB.vp_venues = [V(V1, 'The Royal Hotel', 'f1', 'royal', 'active'), V(V2, 'The Anchor Pub', 'f2', 'anchor', 'active'),
                  V(V3, 'The Big Club', 'f3', 'big-club', 'active'), V(V4, 'Test Alpha', 'f4', 'test-alpha', 'active'),
                  V(V5, 'The Old Inn', 'f5', 'old-inn', 'cancelled'), V(V6, 'The Quiet Inn', 'f6', 'quiet-inn', 'active')];
  DB.vp_venue_settings = [
    { venue_id: V1, setup_answers: { tvs: '2', nights: ['fri'], games: ['trivia', 'musical', 'raffles'], name_ok: true, games_at: '2026-10-05', setup: { trivia: 'done', musical: 'later' } } },
    { venue_id: V2, setup_answers: { tvs: '1', games: ['bingo', 'trivia'], games_at: '2026-09-20', setup: { bingo: 'done', trivia: 'shown' } } },
    { venue_id: V3, setup_answers: { games: ['members', 'raffles', 'musical', 'musical'], games_at: '2026-10-30', setup: { members: 'done', raffles: 'done' } } },
    { venue_id: V4, setup_answers: { games: ['trivia', 'musical', 'bingo', 'raffles', 'members'], games_at: '2026-10-10', setup: { trivia: 'done', bingo: 'done' } } },
    { venue_id: V5, setup_answers: { games: ['trivia'], games_at: '2026-10-02', setup: { trivia: 'done' } } },
    { venue_id: V6, setup_answers: { tvs: '1' } }];
  DB.vp_platform_admins = [{ auth_user_id: ADMIN, role: 'owner', label: 'Dean' }, { auth_user_id: STAFF_ADMIN, role: 'staff', label: 'Helper' }];
  DB.vp_admin_audit = []; DB.vp_unsubscribes = [];
  /* One real night at The Royal in October, so a venue report has something to send. */
  DB.vp_sessions = [{ id: 'S1', venue_id: V1, created_at: '2026-10-02T08:30:00Z', opened_at: '2026-10-02T08:30:00Z', ended_at: '2026-10-02T12:00:00Z' }];
  DB.vp_games = [{ id: 'g1', session_id: 'S1', format: 'trivia', started_at: '2026-10-02T09:00:00Z' }];
  DB.vp_players = [1, 2, 3].map(function (n) { return { id: 'p' + n, session_id: 'S1', device_id: 'd' + n, is_test: false, kicked: false, joined_at: '2026-10-02T08:40:00Z', played_at: null }; });
}
var ENVON = Object.assign({}, ENV, { MONTHLY_REPORTS: 'on', VP_UNSUB_SECRET: 'u' });
function gamesMail() { return sent.filter(function (m) { return /^What venues play/.test(m.subject); }); }
function gamesAudits() { return DB.vp_admin_audit.filter(function (a) { return a.action === 'games_answers_sent'; }); }
function row(html, name) {
  var m = new RegExp('>' + name + '</td>((?:<td[^>]*>\\d+</td>){3})').exec(html);
  return m ? m[1].replace(/<[^>]+>/g, ' ').trim().split(/\s+/).map(Number).join(',') : null;
}

(async function () {
  print('the count, by hand');
  world();
  var venues = DB.vp_venues.slice();
  var tests = await vprTestVenueIds(ENV, venues);
  var t = vprGamesTally(DB.vp_venue_settings, venues, tests, '2026-10');
  check('4 active venues that are not test venues', t.venues === 4, t.venues);
  check('3 answered the games question (the test venue, the cancelled one and the one with no answer are out)', t.answered === 3, t.answered);
  check('2 answered in October (an answer from 20 September is not new)', t.answered_month === 2, t.answered_month);
  check('Trivia: 2 play it, 1 new in October, 1 set up', t.games.trivia.plays === 2 && t.games.trivia.new_month === 1 && t.games.trivia.set_up === 1, t.games.trivia);
  check('Musical bingo: 2 play it (a venue that ticked it twice counts once), 2 new, 0 set up ("later" is not done)', t.games.musical.plays === 2 && t.games.musical.new_month === 2 && t.games.musical.set_up === 0, t.games.musical);
  check('Bingo: 1 plays it, 0 new, 1 set up (musical bingo is not bingo)', t.games.bingo.plays === 1 && t.games.bingo.new_month === 0 && t.games.bingo.set_up === 1, t.games.bingo);
  check('Raffles: 2, 2 new, 1 set up', t.games.raffles.plays === 2 && t.games.raffles.new_month === 2 && t.games.raffles.set_up === 1, t.games.raffles);
  check('Members draws: 1, 1 new, 1 set up', t.games.members.plays === 1 && t.games.members.new_month === 1 && t.games.members.set_up === 1, t.games.members);
  var tSep = vprGamesTally(DB.vp_venue_settings, venues, tests, '2026-09');
  check('for September only the Anchor is new, and only bingo and trivia', tSep.answered === 3 && tSep.answered_month === 1 && tSep.games.bingo.new_month === 1 && tSep.games.trivia.new_month === 1 && tSep.games.musical.new_month === 0, tSep);
  var odd = vprGamesTally([{ venue_id: V1, setup_answers: { games: ['trivia'], games_at: 'October' } }, { venue_id: V1, setup_answers: { games: ['bingo'] } }, { venue_id: V2, setup_answers: null }], venues, tests, '2026-10');
  check('a games_at that is not a date is answered but not new; a venue counts once; a null answer is no answer', odd.answered === 1 && odd.answered_month === 0 && odd.games.trivia.plays === 1 && odd.games.bingo.plays === 0, odd);

  print('the email');
  var mail = vprGamesEmail(ENV, '2026-10', t);
  check('to dean@venueplay.com.au only', mail.to === 'dean@venueplay.com.au', mail.to);
  check('the subject in plain words', mail.subject === 'What venues play: October 2026', mail.subject);
  check('it says it is internal', /This is an internal email/.test(mail.html));
  check('each game row carries its hand-counted numbers (plays, new in October, set up)',
    row(mail.html, 'Trivia') === '2,1,1' && row(mail.html, 'Musical bingo') === '2,2,0' && row(mail.html, 'Bingo') === '1,0,1'
    && row(mail.html, 'Raffles') === '2,2,1' && row(mail.html, 'Members draws') === '1,1,1',
    [row(mail.html, 'Trivia'), row(mail.html, 'Musical bingo'), row(mail.html, 'Bingo'), row(mail.html, 'Raffles'), row(mail.html, 'Members draws')]);
  var at = ['>Trivia<', '>Musical bingo<', '>Bingo<', '>Raffles<', '>Members draws<'].map(function (s) { return mail.html.indexOf(s); });
  check('the games in the house order: Trivia, Musical bingo, Bingo, Raffles, Members draws', at.every(function (x, i) { return x > 0 && (i === 0 || x > at[i - 1]); }), at);
  check('the totals in words', /3 of 4 active venues have told us which games they play\. 2 of them answered in October 2026\./.test(mail.html));
  check('no long dash, venueplay in lower case, never Gflam', !/[\u2014\u2013]|&mdash;|&ndash;/.test(mail.html + mail.subject) && !/VenuePlay|Venueplay|VENUEPLAY/.test(mail.html.replace(/alt="[^"]*"/g, '')) && !/gflam/i.test(mail.html));
  check('the new-look staff card (logo band and the for-your-info pill)', /venueplay-email-on-dark\.png/.test(mail.html) && /FOR YOUR INFO/.test(mail.html));

  print('the dry run sends nothing');
  world();
  var dry = await vprGamesDryRun(ENV, '2026-10');
  check('it returns exactly what would go: to, subject, html and the tally', dry.to === 'dean@venueplay.com.au' && dry.subject === 'What venues play: October 2026' && /Members draws/.test(dry.html) && dry.tally.answered === 3 && dry.tally.games.raffles.plays === 2, dry);
  check('and sends and records nothing', sent.length === 0 && DB.vp_admin_audit.length === 0, [sent.length, DB.vp_admin_audit.length]);
  var pv = await call(vpaHandleMonthReport, ADMIN, { action: 'games-preview', month: '2026-10' });
  check('HQ preview (owner): the subject, html and tally, sent false', pv.status === 200 && pv.body.subject === 'What venues play: October 2026' && pv.body.sent === false && pv.body.tally.answered === 3 && /Trivia/.test(pv.body.html), pv);
  check('the HQ preview sends nothing and writes nothing', sent.length === 0 && DB.vp_admin_audit.length === 0, [sent.length, DB.vp_admin_audit]);
  var pvs = await call(vpaHandleMonthReport, STAFF_ADMIN, { action: 'games-preview', month: '2026-10' });
  check('a staff HQ login cannot preview it', pvs.status === 403 && !pvs.body.html, pvs);
  COLUMN_MISSING = true;
  var pvm = await call(vpaHandleMonthReport, ADMIN, { action: 'games-preview', month: '2026-10' });
  check('before migration 163 the preview says so and does not fail', pvm.status === 200 && /163/.test(pvm.body.skipped || '') && !pvm.body.html, pvm);

  print('the sweep: off, waiting, then once');
  world();
  var off = await vprMonthlySweep(ENV, NOW);
  check('switch off: nothing sent', off.off === true && sent.length === 0 && gamesAudits().length === 0, off);
  check('switch "yes" is still off', (await vprMonthlySweep(Object.assign({}, ENV, { MONTHLY_REPORTS: 'yes' }), NOW)).off === true && sent.length === 0);
  var mid = await vprMonthlySweep(ENVON, Date.parse('2026-11-12T17:00:00Z'));
  check('switched on, the 13th: nothing sent', mid.waiting === true && sent.length === 0, mid);
  check('switched on, 8pm on the 1st: nothing sent', (await vprMonthlySweep(ENVON, Date.parse('2026-11-01T10:00:00Z'))).waiting === true && sent.length === 0);
  check('switched on, 3am on the 4th: nothing sent', (await vprMonthlySweep(ENVON, Date.parse('2026-11-03T17:00:00Z'))).waiting === true && sent.length === 0);
  var run1 = await vprMonthlySweep(ENVON, NOW);
  var g = gamesMail();
  check('3am on the 1st: exactly one games email', g.length === 1 && run1.games && run1.games.sent === 1, [g.length, run1.games]);
  check('to dean@venueplay.com.au and nobody else', g.length === 1 && g[0].to.length === 1 && g[0].to[0] === 'dean@venueplay.com.au' && !g[0].cc && !g[0].bcc, g[0] && g[0].to);
  check('no venue contact ever gets the games email, and Dean gets nothing else', sent.every(function (m) { return /^What venues play/.test(m.subject) === (m.to[0] === 'dean@venueplay.com.au'); }), sent.map(function (m) { return [m.to, m.subject]; }));
  check('it is October\'s, with October\'s numbers', g.length === 1 && g[0].subject === 'What venues play: October 2026' && row(g[0].html, 'Raffles') === '2,2,1');
  check('the venue reports went too (The Royal had a night)', sent.some(function (m) { return m.to[0] === 'owner@royalhotel.com.au'; }) && run1.sent === 1, run1);
  var ga = gamesAudits();
  check('one record, target games-answers:2026-10, with what was sent', ga.length === 1 && ga[0].target === 'games-answers:2026-10' && ga[0].detail.answered === 3 && ga[0].detail.accepted === true, ga);
  var before = sent.length;
  var run2 = await vprMonthlySweep(ENVON, Date.parse('2026-10-31T18:00:00Z'));
  check('the next tick the same month sends nothing more', sent.length === before && gamesMail().length === 1 && gamesAudits().length === 1 && run2.games.already === true, [sent.length, run2.games]);
  await vprMonthlySweep(ENVON, Date.parse('2026-11-02T19:00:00Z'));
  check('nor on the 3rd', gamesMail().length === 1 && gamesAudits().length === 1);

  print('before migration 163');
  world(); COLUMN_MISSING = true;
  var miss = await vprMonthlySweep(ENVON, NOW);
  check('no setup_answers column: no games email and no record', gamesMail().length === 0 && gamesAudits().length === 0, miss.games);
  check('and it says why', miss.games && /163/.test(miss.games.skipped || ''), miss.games);
  check('the venue reports still go', sent.some(function (m) { return m.to[0] === 'owner@royalhotel.com.au'; }) && DB.vp_admin_audit.some(function (a) { return a.action === 'monthly_report_sent'; }), [miss, sent.length]);
  COLUMN_MISSING = false;
  await vprMonthlySweep(ENVON, Date.parse('2026-10-31T19:00:00Z'));
  check('once the column is there, the next tick sends it, once', gamesMail().length === 1 && gamesAudits().length === 1);

  print('nobody has answered yet, or the record cannot be written');
  world();
  DB.vp_venue_settings.forEach(function (r) { r.setup_answers = {}; });
  var none = await vprMonthlySweep(ENVON, NOW);
  check('no answers anywhere: no games email, no record', gamesMail().length === 0 && gamesAudits().length === 0 && /answered/.test(none.games.skipped || ''), none.games);
  world();
  FAIL['vp_admin_audit:POST'] = 1;                         // the first write of the tick is the games record
  var nowrite = await vprMonthlySweep(ENVON, NOW);
  check('a record that cannot be written means no email (so it can never go twice)', gamesMail().length === 0 && nowrite.games.failed === true, nowrite.games);
  check('and the venue reports still go', sent.some(function (m) { return m.to[0] === 'owner@royalhotel.com.au'; }));
  await vprMonthlySweep(ENVON, Date.parse('2026-10-31T18:00:00Z'));
  check('the next tick sends it, once', gamesMail().length === 1 && gamesAudits().length === 1);

  print(fails ? fails + ' OF ' + ran + ' CHECKS FAILED' : 'ALL ' + ran + ' CHECKS PASSED');
})().catch(function (e) { print('  FAIL threw: ' + e + '\n' + (e && e.stack)); });
