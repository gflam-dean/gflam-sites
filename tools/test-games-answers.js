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

   STATE BY STATE (vp_venues.au_state): V1 QLD, V2 '' and V6 'Queensland' (not a state code) are
   "State not set", V3 ' act ' is ACT. Test Alpha (NSW) and the Old Inn (VIC) are out, so no NSW or VIC row.
     QLD            answered 1 of 1   trivia 1, musical 1, raffles 1
     ACT            answered 1 of 1   members 1, raffles 1, musical 1
     State not set  answered 1 of 2   bingo 1, trivia 1
   SOMETHING ELSE, several entries each, comma separated (120 characters in all, 40 each):
     V1 "Karaoke, Meat raffle, Jag the Joker"
     V2 "  karaoke  ,POOL comp, karaoke"          (karaoke twice from one venue counts once)
     V3 82 characters of markup, =HYPERLINK("x"), Pool comp, and "Lawn bowls day" cut by the
        120 at "Lawn bow"; the markup entry is cut to 40 and escaped
     Test Alpha's "Test Karaoke" is not counted.
   = Karaoke 2, POOL comp 2 (first spelling kept), then one each: the markup, =HYPERLINK("x"),
     Jag the Joker, Lawn bow, Meat raffle. Ours: Jag the Joker and Meat raffle.
     Games we don't run yet: Karaoke 2, POOL comp 2, the markup 1, =HYPERLINK("x") 1, Lawn bow 1.
   RUNNING TOTAL AND NEW IN OCTOBER (round 4): new means games_at in October, so V1 and V3 are new and
   the Anchor (September) is not. By state, new: QLD 1 (trivia, musical, raffles), ACT 1 (musical,
   raffles, members), State not set 0. Something else, new: Karaoke 1 of 2, POOL comp 1 of 2, the rest 1 of 1.

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

/* The "Something else" words, typed by a venue: markup, quotes and 82 characters, so the cap and the escaping both show. */
var LONG_OTHER = '<i>Meat</i> & "darts" ' + new Array(61).join('x');
var CAPPED = LONG_OTHER.slice(0, 40);
var V3_OTHER = LONG_OTHER + ', =HYPERLINK("x"), Pool comp, Lawn bowls day';   // 126 characters: the 120 cuts the last entry
function world() {
  DB = {}; sent.length = 0; FAIL = {}; COLUMN_MISSING = false; vprForget();
  DB.venueplay_founding = [{ id: 'f1', contact_email: 'owner@royalhotel.com.au', contact_name: 'Sam Smith', plan: 'monthly', status: 'card_on_file' },
                           { id: 'f2', contact_email: 'boss@anchorpub.com.au', plan: 'monthly', status: 'card_on_file' },
                           { id: 'f3', contact_email: 'big@bigclub.com.au', plan: 'monthly', status: 'card_on_file' },
                           { id: 'f4', contact_email: 'dean@test.com.au', plan: 'monthly', status: 'card_on_file' },
                           { id: 'f5', contact_email: 'old@oldinn.com.au', plan: 'monthly', status: 'cancelled' },
                           { id: 'f6', contact_email: 'quiet@quietinn.com.au', plan: 'monthly', status: 'card_on_file' }];
  function V(id, name, f, slug, status, st) { return { id: id, name: name, founding_id: f, slug: slug, status: status, au_state: st, timezone: 'Australia/Brisbane', created_at: '2026-08-01T00:00:00Z' }; }
  DB.vp_venues = [V(V1, 'The Royal Hotel', 'f1', 'royal', 'active', 'QLD'), V(V2, 'The Anchor Pub', 'f2', 'anchor', 'active', ''),
                  V(V3, 'The Big Club', 'f3', 'big-club', 'active', ' act '), V(V4, 'Test Alpha', 'f4', 'test-alpha', 'active', 'NSW'),
                  V(V5, 'The Old Inn', 'f5', 'old-inn', 'cancelled', 'VIC'), V(V6, 'The Quiet Inn', 'f6', 'quiet-inn', 'active', 'Queensland')];
  DB.vp_venue_settings = [
    { venue_id: V1, setup_answers: { tvs: '2', nights: ['fri'], games: ['trivia', 'musical', 'raffles'], name_ok: true, games_at: '2026-10-05', setup: { trivia: 'done', musical: 'later' }, other: 'Karaoke, Meat raffle, Jag the Joker' } },
    { venue_id: V2, setup_answers: { tvs: '1', games: ['bingo', 'trivia'], games_at: '2026-09-20', setup: { bingo: 'done', trivia: 'shown' }, other: '  karaoke  ,POOL comp, karaoke' } },
    { venue_id: V3, setup_answers: { games: ['members', 'raffles', 'musical', 'musical'], games_at: '2026-10-30', setup: { members: 'done', raffles: 'done' }, other: V3_OTHER } },
    { venue_id: V4, setup_answers: { games: ['trivia', 'musical', 'bingo', 'raffles', 'members'], games_at: '2026-10-10', setup: { trivia: 'done', bingo: 'done' }, other: 'Test Karaoke' } },
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
  check('the totals in words, each labelled', /<b>Running total:<\/b> 3 of 4 active venues have told us which games they play\./.test(mail.html) && /<b>New in October:<\/b> 2 answered in October 2026\./.test(mail.html));
  check('the game table says Running total and New in October', />Running total<\/th>/.test(mail.html) && />New in October<\/th>/.test(mail.html) && />Set up \(running total\)<\/th>/.test(mail.html) && !/Venues that play it/.test(mail.html));
  check('no long dash, venueplay in lower case, never Gflam', !/[\u2014\u2013]|&mdash;|&ndash;/.test(mail.html + mail.subject) && !/VenuePlay|Venueplay|VENUEPLAY/.test(mail.html.replace(/alt="[^"]*"/g, '')) && !/gflam/i.test(mail.html));
  check('the new-look staff card (logo band and the for-your-info pill)', /venueplay-email-on-dark\.png/.test(mail.html) && /FOR YOUR INFO/.test(mail.html));

  print('state by state, and something else');
  var sn = t.states.map(function (x) { return x.name; }).join('|');
  check('the states with active venues, in order, unknown and empty under State not set (ACT, never "the ACT")', sn === 'QLD|ACT|State not set', sn);
  var S_ = {}; t.states.forEach(function (x) { S_[x.name] = x; });
  check('QLD: 1 of 1 answered, trivia 1, musical 1, bingo 0, raffles 1, members 0', S_.QLD.venues === 1 && S_.QLD.answered === 1 && S_.QLD.games.trivia === 1 && S_.QLD.games.musical === 1 && S_.QLD.games.bingo === 0 && S_.QLD.games.raffles === 1 && S_.QLD.games.members === 0, S_.QLD);
  check('ACT (typed " act "): 1 of 1, members 1, raffles 1, musical 1 once, trivia 0', S_.ACT.venues === 1 && S_.ACT.answered === 1 && S_.ACT.games.members === 1 && S_.ACT.games.raffles === 1 && S_.ACT.games.musical === 1 && S_.ACT.games.trivia === 0, S_.ACT);
  var NS = S_['State not set'];
  check('State not set: 1 of 2 answered, bingo 1, trivia 1, musical 0', NS.venues === 2 && NS.answered === 1 && NS.games.bingo === 1 && NS.games.trivia === 1 && NS.games.musical === 0, NS);
  check('Something else: Karaoke twice (case and spaces are one answer, first spelling kept), the long one once, the test venue\'s left out',
    t.other.map(function (o) { return o.text + '=' + o.count; }).join('|') === 'Karaoke=2|POOL comp=2|' + CAPPED + '=1|=HYPERLINK("x")=1|Jag the Joker=1|Lawn bow=1|Meat raffle=1', t.other);
  check('each entry is cut at 40 characters, and the whole answer at 120', CAPPED.length === 40 && t.other[2].text === CAPPED && V3_OTHER.length === 126 && t.other.some(function (o) { return o.text === 'Lawn bow'; }));
  check('the entries that are one of our games are marked ours (jag the joker, meat raffle), the rest are not',
    t.other.filter(function (o) { return o.ours; }).map(function (o) { return o.text; }).join('|') === 'Jag the Joker|Meat raffle', t.other);
  check('games we don\'t run yet: Karaoke 2, POOL comp 2, the markup, =HYPERLINK, Lawn bow',
    t.not_ours.map(function (o) { return o.text + '=' + o.count; }).join('|') === 'Karaoke=2|POOL comp=2|' + CAPPED + '=1|=HYPERLINK("x")=1|Lawn bow=1', t.not_ours);
  var ours = vprGamesTally([{ venue_id: V1, setup_answers: { games: [], other: 'Pub TRIVIA, Musical Bingo night, members draws, Raffles, meat raffles, Jag the joker, Lawn bowls' } }], venues, tests, '2026-10');
  check('our games are matched on the words, any case (trivia, musical bingo, members draws, raffles, meat raffles, jag the joker)',
    ours.not_ours.map(function (o) { return o.text; }).join('|') === 'Lawn bowls' && ours.other.length === 7, ours.other);
  check('the email lists games we don\'t run yet, escaped, with both figures', /Games we don't run yet/.test(mail.html) && /Lawn bow: running total 1, new in October 1/.test(mail.html) && mail.html.indexOf('=HYPERLINK(&quot;x&quot;): running total 1, new in October 1') !== -1 && /POOL comp: running total 2, new in October 1/.test(mail.html));
  check('this month by state: QLD 1 new (trivia, musical, raffles), ACT 1 new (musical, raffles, members), State not set 0 (the Anchor answered in September)',
    S_.QLD.answered_month === 1 && [S_.QLD.games_month.trivia, S_.QLD.games_month.musical, S_.QLD.games_month.bingo, S_.QLD.games_month.raffles, S_.QLD.games_month.members].join() === '1,1,0,1,0'
    && S_.ACT.answered_month === 1 && [S_.ACT.games_month.trivia, S_.ACT.games_month.musical, S_.ACT.games_month.bingo, S_.ACT.games_month.raffles, S_.ACT.games_month.members].join() === '0,1,0,1,1'
    && NS.answered_month === 0 && [NS.games_month.trivia, NS.games_month.bingo].join() === '0,0', [S_.QLD, S_.ACT, NS]);
  check('something else this month counts only venues that answered in October: Karaoke 1 of 2, POOL comp 1 of 2, the rest 1 of 1',
    t.other.map(function (o) { return o.count + '/' + o.count_month; }).join() === '2/1,2/1,1/1,1/1,1/1,1/1,1/1', t.other);
  var tSepO = vprGamesTally(DB.vp_venue_settings, venues, tests, '2026-09');
  check('and in September only the Anchor\'s entries are new (Karaoke 1, POOL comp 1)', tSepO.other.filter(function (o) { return o.count_month; }).map(function (o) { return o.text + '=' + o.count_month; }).join() === 'Karaoke=1,POOL comp=1', tSepO.other);

  print('the spreadsheet');
  var csv = vprGamesCsv('2026-10', t);
  var WANT = [
    '"What venues play: October 2026 (internal, venueplay)"', '',
    '"Running total means every venue that has ever told us, all time. New in October means it answered in October 2026."', '',
    'Game,Running total,New in October,Set up (running total)',
    'Trivia,2,1,1', 'Musical bingo,2,2,0', 'Bingo,1,0,1', 'Raffles,2,2,1', 'Members draws,1,1,1', '',
    'Active venues,4', '"Answered, running total",3', '"Answered, new in October",2', '',
    'State,Active venues,"Answered, running total","Answered, new in October","Trivia, running total","Trivia, new in October","Musical bingo, running total","Musical bingo, new in October",'
      + '"Bingo, running total","Bingo, new in October","Raffles, running total","Raffles, new in October","Members draws, running total","Members draws, new in October"',
    'QLD,1,1,1,1,1,1,1,0,0,1,1,0,0', 'ACT,1,1,1,0,0,1,1,0,0,1,1,1,1', 'State not set,2,1,0,1,0,0,0,1,0,0,0,0,0', '',
    'Something else they run,Running total,New in October,One of our games',
    'Karaoke,2,1,No', 'POOL comp,2,1,No', '"<i>Meat</i> & ""darts"" xxxxxxxxxxxxxxxxxx",1,1,No', '"\'=HYPERLINK(""x"")",1,1,No', 'Jag the Joker,1,1,Yes', 'Lawn bow,1,1,No', 'Meat raffle,1,1,Yes', '',
    "Games we don't run yet,Running total,New in October",
    'Karaoke,2,1', 'POOL comp,2,1', '"<i>Meat</i> & ""darts"" xxxxxxxxxxxxxxxxxx",1,1', '"\'=HYPERLINK(""x"")",1,1', 'Lawn bow,1,1'].join('\r\n') + '\r\n';
  check('the CSV is the hand count, line for line', csv === WANT, csv.split('\r\n').filter(function (l, i) { return l !== WANT.split('\r\n')[i]; }));
  check('a venue\'s words starting with = open as text, never a formula', csv.indexOf('\'=HYPERLINK') !== -1 && !/(^|,)=HYPERLINK/m.test(csv));
  check('the file is named for the month', vprGamesCsvName('2026-10') === 'what-venues-play-2026-10.csv');

  print('the email: state by state and something else');
  var stRow = /<td[^>]*>ACT<\/td><td[^>]*>1 of 1<br><span[^>]*>1 new<\/span><\/td>((?:<td[^>]*>\d+<br><span[^>]*>\d+ new<\/span><\/td>){5})/.exec(mail.html);
  check('the email has the state table, ACT\'s row in the house order of games, running total over new (0/0, 1/1, 0/0, 1/1, 1/1)', !!stRow && stRow[1].replace(/<[^>]+>/g, ' ').replace(/ new/g, '').trim().split(/\s+/).join(',') === '0,0,1,1,0,0,1,1,1,1', stRow && stRow[1]);
  var nsRow = /<td[^>]*>State not set<\/td><td[^>]*>1 of 2<br><span[^>]*>0 new<\/span><\/td>((?:<td[^>]*>\d+<br><span[^>]*>\d+ new<\/span><\/td>){5})/.exec(mail.html);
  check('State not set in the email: the Anchor\'s trivia and bingo are in the running total and not new (1/0, 0/0, 1/0, 0/0, 0/0)', !!nsRow && nsRow[1].replace(/<[^>]+>/g, ' ').replace(/ new/g, '').trim().split(/\s+/).join(',') === '1,0,0,0,1,0,0,0,0,0', nsRow && nsRow[1]);
  check('and says what the two numbers are', /Each number is the running total\. Underneath: new in October\./.test(mail.html));
  check('and State not set, never "the ACT"', /State not set<\/td><td[^>]*>1 of 2</.test(mail.html) && !/the ACT/i.test(mail.html));
  check('Something else they run, with a running total and new in October each', /Something else they run/.test(mail.html) && /Karaoke: running total 2, new in October 1/.test(mail.html) && /Jag the Joker: running total 1, new in October 1/.test(mail.html) && mail.html.indexOf('karaoke  ') === -1);
  check('the venue\'s words are escaped in the email', mail.html.indexOf('<i>Meat') === -1 && mail.html.indexOf('&lt;i&gt;Meat&lt;/i&gt; &amp; &quot;darts&quot;') !== -1);
  check('and never in the subject', mail.subject === 'What venues play: October 2026' && !/Karaoke|Meat/.test(mail.subject));

  print('the dry run sends nothing');
  world();
  var dry = await vprGamesDryRun(ENV, '2026-10');
  check('it returns exactly what would go: to, subject, html and the tally', dry.to === 'dean@venueplay.com.au' && dry.subject === 'What venues play: October 2026' && /Members draws/.test(dry.html) && dry.tally.answered === 3 && dry.tally.games.raffles.plays === 2, dry);
  check('and sends and records nothing', sent.length === 0 && DB.vp_admin_audit.length === 0, [sent.length, DB.vp_admin_audit.length]);
  check('the dry run carries the CSV and its name', dry.csv === vprGamesCsv('2026-10', dry.tally) && dry.csv_name === 'what-venues-play-2026-10.csv' && /^Trivia,2,1,1$/m.test(dry.csv));
  var pv = await call(vpaHandleMonthReport, ADMIN, { action: 'games-preview', month: '2026-10' });
  check('HQ preview (owner): the subject, html and tally, sent false', pv.status === 200 && pv.body.subject === 'What venues play: October 2026' && pv.body.sent === false && pv.body.tally.answered === 3 && /Trivia/.test(pv.body.html), pv);
  check('the HQ preview returns the CSV too', pv.body.csv === dry.csv && pv.body.csv_name === 'what-venues-play-2026-10.csv');
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
  var att = g.length === 1 ? g[0].attachments : null;
  var dec = att && att[0] ? atob(att[0].content) : '';
  check('the CSV goes with it as one attachment, what-venues-play-2026-10.csv', !!att && att.length === 1 && att[0].filename === 'what-venues-play-2026-10.csv', att);
  check('the attachment is the dry run\'s CSV, with a UTF-8 byte order mark for Excel', dec === '\xEF\xBB\xBF' + vprGamesCsv('2026-10', vprGamesTally(DB.vp_venue_settings, DB.vp_venues, tests, '2026-10')), dec.slice(0, 80));
  check('no venue email carries an attachment', sent.filter(function (m) { return m.to[0] !== 'dean@venueplay.com.au'; }).every(function (m) { return !m.attachments; }) && sent.some(function (m) { return m.to[0] !== 'dean@venueplay.com.au'; }));
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

  print('HQ > Reports: What venues play, any day (owner only, never sends)');
  world();
  var hr = await call(vpaHandleMonthReport, ADMIN, { action: 'games', month: '2026-11' });
  check('owner: the tally for the month so far, with states and something else', hr.status === 200 && hr.body.month === '2026-11' && hr.body.tally.answered === 3
    && hr.body.tally.answered_month === 0 && hr.body.tally.states.length === 3 && hr.body.tally.other[0].text === 'Karaoke' && !hr.body.html, hr.body);
  check('it sends nothing and writes nothing', sent.length === 0 && DB.vp_admin_audit.length === 0, [sent.length, DB.vp_admin_audit.length]);
  check('and carries November\'s CSV', hr.body.csv_name === 'what-venues-play-2026-11.csv' && hr.body.csv === vprGamesCsv('2026-11', hr.body.tally));
  var hs = await call(vpaHandleMonthReport, STAFF_ADMIN, { action: 'games', month: '2026-11' });
  check('a staff HQ login is refused and sees no numbers or CSV', hs.status === 403 && !hs.body.tally && !hs.body.csv, hs);
  COLUMN_MISSING = true;
  var hw = await call(vpaHandleMonthReport, ADMIN, { action: 'games', month: '2026-11' });
  check('before migration 163 it says so plainly', hw.status === 200 && hw.body.waiting === true && hw.body.note === 'Waiting for the setup answers to be switched on (migration 163).' && !hw.body.tally, hw.body);
  COLUMN_MISSING = false;
  FAIL['vp_venue_settings:GET'] = 1;
  var hf = await call(vpaHandleMonthReport, ADMIN, { action: 'games', month: '2026-11' });
  check('a read that fails is an error, never a confident 0', hf.status === 503 && !hf.body.tally, hf);

  /* The page itself: vp-reports-hq.js on a small fake document, posting to the real handler. */
  function hqPage(user) {
    var els = {}, pending = [];
    function el(id) { return els[id] || (els[id] = { id: id, innerHTML: '', value: id === 'rpMonth' ? '2026-11' : '', style: {}, checked: false, _a: {},
      setAttribute: function (k, v) { this._a[k] = v; }, getAttribute: function (k) { return this._a[k] || null; }, addEventListener: function () {} }); }
    var win = { document: { getElementById: el, querySelectorAll: function () { return []; } } };
    (new Function('window', readFile('venueplay/app/vp-reports-hq.js')))(win);
    win.VPReports.init({ isOwner: function () { return true; }, post: function (path, body) {
      var p = (path === '/admin/month-report' && body && body.action === 'games')
        ? call(vpaHandleMonthReport, user, body).then(function (r) { return r.body; })
        : Promise.resolve({ error: 'not in this test' });
      pending.push(p); return p; } });
    return { els: els, VP: win.VPReports, settle: async function () { for (var i = 0; i < 5; i++) { await Promise.all(pending); await null; } } };
  }
  world();
  var pg = hqPage(ADMIN); pg.VP.open(); await pg.settle();
  var gh = (pg.els.rpGames || {}).innerHTML || '';
  check('the section is #rpGames in HQ > Reports, and it asks for action games', !!pg.els.rpGames && /id="rpGames"/.test(pg.els.paneReports.innerHTML) && /What venues play/.test(pg.els.paneReports.innerHTML));
  check('it shows the hand count, labelled: running total 3 of 4, new in November 0', /id="rpGamesLine"><b>Running total:<\/b> 3 of 4 active venues have told us which games they play\./.test(gh) && /id="rpGamesNewLine"><b>New in November:<\/b> 0 answered in November 2026\./.test(gh), gh.slice(0, 300));
  var hqRow = function (name) { var m = new RegExp('<td>' + name + '</td>((?:<td class="mono">\\d+</td>){3})').exec(gh); return m ? m[1].replace(/<[^>]+>/g, ' ').trim().split(/\s+/).join(',') : null; };
  check('every game row in the house order with plays, new, set up', hqRow('Trivia') === '2,0,1' && hqRow('Musical bingo') === '2,0,0' && hqRow('Bingo') === '1,0,1' && hqRow('Raffles') === '2,0,1' && hqRow('Members draws') === '1,0,1'
    && gh.indexOf('<td>Trivia</td>') < gh.indexOf('<td>Musical bingo</td>') && gh.indexOf('<td>Musical bingo</td>') < gh.indexOf('<td>Bingo</td>'), [hqRow('Trivia'), hqRow('Musical bingo'), hqRow('Bingo')]);
  check('state by state: QLD, ACT and State not set with answered of venues', /<td>QLD<\/td><td class="mono">1 of 1<div class="vt">0 new<\/div><\/td>/.test(gh) && /<td>ACT<\/td><td class="mono">1 of 1<div class="vt">0 new<\/div><\/td>/.test(gh) && /<td>State not set<\/td><td class="mono">1 of 2<div class="vt">0 new<\/div><\/td>/.test(gh) && !/the ACT/i.test(gh));
  check('something else, counted and escaped', /Something else they run/.test(gh) && /<li>Karaoke: running total 2, new in November 0<\/li>/.test(gh) && gh.indexOf('<i>Meat') === -1 && gh.indexOf('&lt;i&gt;Meat&lt;/i&gt; &amp; &quot;darts&quot;') !== -1);
  var link = /<a id="rpGamesCsv" download="([^"]*)" href="data:text\/csv;charset=utf-8,([^"]*)">Download as a spreadsheet<\/a>/.exec(gh);
  check('Download as a spreadsheet: the Worker\'s CSV, named for the month, with the byte order mark', !!link && link[1] === 'what-venues-play-2026-11.csv'
    && decodeURIComponent(link[2].replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"')) === '\ufeff' + hr.body.csv, link && link[1]);
  check('games we don\'t run yet, escaped', /id="rpGamesNotOurs"><li>Karaoke: running total 2, new in November 0<\/li><li>POOL comp: running total 2, new in November 0<\/li><li>&lt;i&gt;Meat/.test(gh), gh.slice(gh.indexOf('rpGamesNotOurs'), gh.indexOf('rpGamesNotOurs') + 120));
  var octR = (await call(vpaHandleMonthReport, ADMIN, { action: 'games', month: '2026-10' })).body;
  var oh = pg.VP.gamesHtml(octR);
  check('HQ for October: new in October 2, QLD trivia 1 over 1 new, Karaoke 2 with 1 new', /<b>New in October:<\/b> 2 answered in October 2026\./.test(oh)
    && /<td>QLD<\/td><td class="mono">1 of 1<div class="vt">1 new<\/div><\/td><td class="mono">1<div class="vt">1 new<\/div><\/td>/.test(oh) && /<li>Karaoke: running total 2, new in October 1<\/li>/.test(oh)
    && /<td>State not set<\/td><td class="mono">1 of 2<div class="vt">0 new<\/div><\/td><td class="mono">1<div class="vt">0 new<\/div><\/td>/.test(oh)
    && />Running total<\/th><th>New in October<\/th><th>Set up \(running total\)<\/th>/.test(oh), oh.slice(0, 400));
  check('opening the page sends nothing', sent.length === 0 && DB.vp_admin_audit.length === 0);
  world(); COLUMN_MISSING = true;
  var pw = hqPage(ADMIN); pw.VP.open(); await pw.settle();
  check('before migration 163 the page says: Waiting for the setup answers to be switched on (migration 163).', (pw.els.rpGames.innerHTML || '').indexOf('Waiting for the setup answers to be switched on (migration 163).') !== -1 && !/of 4 active/.test(pw.els.rpGames.innerHTML), pw.els.rpGames.innerHTML);
  world();
  var ps = hqPage(STAFF_ADMIN); ps.VP.open(); await ps.settle();
  check('a staff login sees the refusal, not numbers', /Only an owner login can see what venues play/.test(ps.els.rpGames.innerHTML) && !/active venues/.test(ps.els.rpGames.innerHTML), ps.els.rpGames.innerHTML);

  print(fails ? fails + ' OF ' + ran + ' CHECKS FAILED' : 'ALL ' + ran + ' CHECKS PASSED');
})().catch(function (e) { print('  FAIL threw: ' + e + '\n' + (e && e.stack)); });
