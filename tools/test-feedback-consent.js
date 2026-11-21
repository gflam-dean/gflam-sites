/* WHAT A PLAYER'S RATING TELLS WHOM, ON THE REAL BILLING WORKER (Dean, 1 and 2 Nov 2026).

   A player taps "Loved it", "Good" or "Not for me" at the end of a game, and may add tags, a line and
   (Good / Not for me only) an email with its own consent tick. Dean's rules, all run here:

     THE VENUE sees COUNTS of the ratings in VPR_VENUE_RATINGS ("Loved it" and "Good"), labelled as
       the phone labels them, by game and night: the account's feedback panel (/account/feedback) and
       the monthly report (vprRead -> vprFigures -> the email). Never a comment, a tag, a name or a
       "Not for me": those are not even READ for a venue. There are no ticks: a request that sends
       to_venue, share or first_name has them ignored, and nothing stores them.
     ADDING "Not for me" LATER is one line (push 1 onto VPR_VENUE_RATINGS): proven below by doing it.
     HQ sees everything (/admin/feedback): tags, words, wants_reply, never an email.
     THE EMAIL only on Good / Not for me, only with its tick, only into a help-desk ticket, never in
       vp_feedback_notes; the subject is neutral and lowercase, the HQ label an internal note.
     THE ALERT: TWO or more "Not for me" at one venue on one night (Dean, 2 Nov 2026; was three), one
       internal ticket, at most once per venue per night.

   Runs on tools/rig-billing-worker.js (fake PostgREST, fake Resend).
   Run from the repo root:  jsc tools/test-feedback-consent.js */
load('tools/rig-billing-worker.js');
var ran = 0, fails = 0;
function check(name, ok, saw) { ran++; if (ok) print('  ok   ' + name); else { print('  FAIL ' + name + (saw === undefined ? '' : '   saw: ' + JSON.stringify(saw).slice(0, 400))); fails++; } }
var crypto = { getRandomValues: function (a) { for (var i = 0; i < a.length; i++) a[i] = (i * 37 + 11) & 255; return a; },
  subtle: { digest: function () { return Promise.resolve(new Uint8Array(32).buffer); }, importKey: function () { return Promise.resolve({}); }, sign: function () { return Promise.resolve(new Uint8Array(64).buffer); } } };
var VENUE = '00000000-0000-4000-8000-0000000000a1', OTHER = '00000000-0000-4000-8000-0000000000b2';
var READS = [];   // every vp_game_feedback read, so a venue-facing read can be shown to ask for nothing else
var _f = globalThis.fetch;
/* The database's CHECK on vp_help_push_subs.filter: migration 106 allows all and urgent_sales; 137 adds bad_feedback. */
var PUSH_FILTERS = ['all', 'urgent_sales'];
globalThis.fetch = function (url, opts) {
  if (String(url).indexOf('/rest/v1/vp_game_feedback') >= 0 && !((opts || {}).method > '')) READS.push(String(url));
  if (String(url).indexOf('/rest/v1/vp_help_push_subs') >= 0 && (opts || {}).method === 'POST' && PUSH_FILTERS.indexOf(JSON.parse(opts.body).filter) < 0)
    return Promise.resolve(resp(400, { code: '23514', message: 'violates check constraint "vp_help_push_subs_filter_check"' }));
  return _f(url, opts); };
var seq = 0;
function rating(r, venue, at) {
  seq++;
  var id = '00000000-0000-4000-8000-' + ('000000000000' + (5000 + seq)).slice(-12);
  tbl('vp_game_feedback').push({ id: id, venue_id: venue || VENUE, session_id: null, game_id: null, format: 'bingo', source: 'player', rating: r, created_at: at || new Date().toISOString() });
  return id;
}
function noteFor(fid) { return tbl('vp_feedback_notes').filter(function (n) { return n.feedback_id === fid; })[0]; }
var dev = 0;
async function send(body) { dev++; body.device = body.device || ('dev' + dev); return vpfFeedbackMore(REQ(body), ENV, J); }

(async function () {
  try {
    tbl('vp_venues').push({ id: VENUE, name: 'Test Alpha', timezone: 'Australia/Brisbane', join_code: 'ACDEFG', au_state: 'QLD' },
                          { id: OTHER, name: 'Test Bravo', timezone: 'Australia/Brisbane', join_code: 'HJKMNP', au_state: 'QLD' });
    tbl('vp_feedback_notes');

    print('NO TICKS: WHATEVER A PHONE SENDS, NOTHING FOR THE VENUE IS STORED');
    var words = { 3: 'Loved it', 2: 'Good', 1: 'Not for me' };
    var combos = [[false, false], [true, false], [false, true], [true, true]];
    for (var r = 3; r >= 1; r--) {
      for (var c = 0; c < combos.length; c++) {
        var fid = rating(r);
        var res = await send({ feedback_id: fid, tags: ['other'], note: 'Great night, loved the host', to_venue: combos[c][0], share: combos[c][1], first_name: 'Sam Kowalski' });
        var n = noteFor(fid) || {};
        check(words[r] + ' with to_venue ' + combos[c][0] + ' and share ' + combos[c][1] + ' sent: the words are kept for HQ, with no venue, share or name field',
              res.body && res.body.ok && n.note === 'Great night, loved the host' && !('to_venue' in n) && !('share_ok' in n) && !('first_name' in n) && JSON.stringify(n).indexOf('Sam') < 0,
              { res: res.body, note: n });
      }
    }

    print('\nTHE EMAIL: ONLY WITH ITS TICK, ONLY INTO A TICKET, NEVER IN THE NOTES');
    var before = tbl('vp_help_tickets').length;
    var f6 = rating(3);
    await send({ feedback_id: f6, note: 'Loved it', consent: true, email: 'loved@example.com' });
    check('"Loved it" with an email and its tick: no ticket', tbl('vp_help_tickets').length === before, tbl('vp_help_tickets').length - before);
    var f7 = rating(2);
    await send({ feedback_id: f7, tags: ['faster'], note: 'Bit slow', consent: false, email: 'nope@example.com' });
    check('"Good" with an email and NO tick: no ticket', tbl('vp_help_tickets').length === before && noteFor(f7).wants_reply === false, noteFor(f7));
    var f8 = rating(2);
    await send({ feedback_id: f8, tags: ['faster'], note: 'Could be quicker', consent: true, email: 'Upset@Example.com' });
    var tk = tbl('vp_help_tickets').filter(function (t) { return t.contact_email === 'upset@example.com'; })[0];
    check('"Good" with the tick: one ticket, to that address', tbl('vp_help_tickets').length === before + 1 && !!tk, tbl('vp_help_tickets').slice(before));
    check('its subject is neutral, in lowercase: "Your feedback about venueplay at Test Alpha"', tk && tk.subject === 'Your feedback about venueplay at Test Alpha', tk && tk.subject);
    var lab = tbl('vp_help_ticket_notes').filter(function (x) { return tk && x.ticket_id === tk.id; })[0];
    check('the label HQ works from is an internal note: "Feedback: could be better"', lab && lab.kind === 'note' && /^Feedback: could be better\./.test(lab.body), lab);
    check('the note row says a reply was wanted and links the ticket', noteFor(f8).wants_reply === true && noteFor(f8).ticket_id === tk.id, noteFor(f8));
    check('NO row in vp_feedback_notes holds an email address', tbl('vp_feedback_notes').every(function (n) { return JSON.stringify(n).indexOf('@') < 0; }));

    print('\nTHE ALERT: TWO "Not for me" AT ONE VENUE ON ONE NIGHT, ONCE');
    DB.vp_game_feedback = []; DB.vp_admin_audit = [];
    var t0 = tbl('vp_help_tickets').length;
    rating(1, OTHER);
    var a1 = await vpfAlertSweep(ENV, Date.now());
    check('one "Not for me": no alert', a1.alerts === 0 && tbl('vp_help_tickets').length === t0, a1);
    rating(1, OTHER);
    var a2 = await vpfAlertSweep(ENV, Date.now());
    var al = tbl('vp_help_tickets').slice(t0);
    check('the second at the same venue that night: one alert ticket', a2.alerts === 1 && al.length === 1 && /2 players said Not for me at Test Bravo/.test(al[0].subject), { a2: a2, t: al.map(function (t) { return t.subject; }) });
    rating(1, OTHER);
    var a3 = await vpfAlertSweep(ENV, Date.now());
    check('a third that night: still just the one (once per venue per night)', a3.alerts === 0 && tbl('vp_help_tickets').length === t0 + 1, a3);
    rating(1, VENUE);
    var a4 = await vpfAlertSweep(ENV, Date.now());
    check('one at another venue: no alert for it', a4.alerts === 0 && tbl('vp_help_tickets').length === t0 + 1, a4);

    print('\nWHAT A VENUE SEES: COUNTS OF "Loved it" AND "Good", AND NOTHING ELSE');
    DB.vp_game_feedback = [];
    // two nights at Test Alpha (Brisbane): Fri 30 Oct 7pm and Sat 31 Oct 8pm, plus 1am Sunday (still Saturday's night)
    [[3, 'bingo', '2026-10-30T09:00:00Z'], [3, 'bingo', '2026-10-30T09:05:00Z'], [2, 'bingo', '2026-10-30T09:06:00Z'], [1, 'bingo', '2026-10-30T09:07:00Z'],
     [3, 'trivia', '2026-10-31T10:00:00Z'], [2, 'trivia', '2026-10-31T15:00:00Z'], [1, 'trivia', '2026-10-31T10:01:00Z'], [1, 'trivia', '2026-10-31T10:02:00Z'],
     [3, 'bingo', '2026-10-30T09:00:00Z', OTHER]].forEach(function (x) {
      var id = rating(x[0], x[3] || VENUE, x[2]); tbl('vp_game_feedback').filter(function (g) { return g.id === id; })[0].format = x[1];
    });
    var l = vprLiked(tbl('vp_game_feedback').filter(function (g) { return g.venue_id === VENUE; }), 'Australia/Brisbane', '2026-10');
    check('vprLiked, even handed every rating: Loved it 3, Good 2, and no "Not for me" key at all',
          l.counts.loved === 3 && l.counts.good === 2 && l.total === 5 && !('not_for_me' in l.counts), l.counts);
    check('labelled as on the phone, in the phone\'s order', JSON.stringify(l.shown) === JSON.stringify([{ key: 'loved', label: 'Loved it' }, { key: 'good', label: 'Good' }]), l.shown);
    check('by game and night: Saturday trivia (1am counts on Saturday) and Friday bingo, newest first',
          l.nights.length === 2 && l.nights[0].night === '2026-10-31' && l.nights[0].format === 'trivia' && l.nights[0].counts.loved === 1 && l.nights[0].counts.good === 1
          && l.nights[1].night === '2026-10-30' && l.nights[1].format === 'bingo90' && l.nights[1].counts.loved === 2 && l.nights[1].counts.good === 1, l.nights);

    // the account panel, as the venue's owner (the monthly report's login rule)
    vpmRequireAny = async function () { return { venues: [{ id: VENUE, name: 'Test Alpha', timezone: 'Australia/Brisbane' }] }; };
    var nowWas = Date.now; Date.now = function () { return Date.parse('2026-11-01T02:00:00Z'); };
    READS.length = 0;
    var pnl = (await vpbFeedbackCounts(REQ({ venue_id: VENUE }), ENV, J)).body;
    Date.now = nowWas;
    check('/account/feedback: the venue\'s own counts, Loved it 3, Good 2', pnl.ok && pnl.counts.loved === 3 && pnl.counts.good === 2 && pnl.total === 5, pnl);
    check('and only its own venue (Test Bravo\'s rating is not in it)', pnl.nights.every(function (n) { return n.counts.loved <= 2; }) && pnl.total === 5);
    check('its answer carries no "Not for me", no comment, no tag, no name', !/not_for_me|Not for me|note|tags|first_name/.test(JSON.stringify(pnl)), pnl);
    check('and the database was only ever ASKED for ratings 3 and 2', READS.length >= 1 && READS.every(function (u) { return /rating=in\.\(3,2\)&/.test(u) && /source=eq\.player/.test(u); }), READS);
    vpmRequireAny = async function () { return { venues: [{ id: VENUE, name: 'Test Alpha', timezone: 'Australia/Brisbane' }] }; };
    var other = (await vpbFeedbackCounts(REQ({ venue_id: OTHER }), ENV, J));
    check('another venue\'s id is refused, not answered', other.status === 400 && !other.body.counts, other);

    // the monthly report
    READS.length = 0;
    var rows = (await vprRead(ENV, [{ id: VENUE, name: 'Test Alpha', timezone: 'Australia/Brisbane' }], '2026-10'))[VENUE];
    check('the monthly report reads ratings 3 and 2 only', READS.length >= 1 && READS.every(function (u) { return /rating=in\.\(3,2\)/.test(u); }), READS);
    var fig = vprFigures({ id: VENUE, name: 'Test Alpha', timezone: 'Australia/Brisbane' }, rows, '2026-10');
    check('its figures: Loved it 3, Good 2', fig.liked && fig.liked.counts.loved === 3 && fig.liked.counts.good === 2, fig.liked);
    check('the email line: "Loved it: 3 · Good: 2", the phone\'s words', vprLikedWords(fig.liked) === 'Loved it: <b>3</b> &middot; Good: <b>2</b>', vprLikedWords(fig.liked));

    print('\nADDING "Not for me" FOR VENUES LATER IS ONE LINE');
    VPR_VENUE_RATINGS.push(1);
    var l2 = vprLiked(tbl('vp_game_feedback').filter(function (g) { return g.venue_id === VENUE; }), 'Australia/Brisbane', '2026-10');
    check('with 1 added to VPR_VENUE_RATINGS, the counts carry "Not for me" (3 of them), labelled as on the phone',
          l2.counts.not_for_me === 3 && l2.shown[2].label === 'Not for me' && vprLikedWords(l2).indexOf('Not for me: <b>3</b>') >= 0, l2);
    check('and the venue reads ask for it too', /rating=in\.\(3,2,1\)/.test(vprRatingFilter()), vprRatingFilter());
    VPR_VENUE_RATINGS.pop();

    print('\nALERTS ON THIS DEVICE: "Only bad player feedback" (Dean, 2 Nov 2026)');
    var T = { urgent: { priority: 'urgent', category: 'general' }, sales: { priority: 'normal', category: 'sales' }, plain: { priority: 'normal', category: 'general' },
              alert: { priority: 'normal', category: 'general', raised_by: 'automatic (player feedback)' },
              badReply: { priority: 'normal', category: 'patron_support', bad_feedback: true }, goodReply: { priority: 'normal', category: 'patron_support', bad_feedback: false } };
    var WANT = { all: ['urgent', 'sales', 'plain', 'alert', 'badReply', 'goodReply'], urgent_sales: ['urgent', 'sales', 'alert', 'badReply'], bad_feedback: ['alert', 'badReply'] };
    Object.keys(WANT).forEach(function (f) {
      var got = Object.keys(T).filter(function (k) { return helpPushWants({ filter: f }, T[k]); });
      check('"' + f + '" buzzes for ' + WANT[f].join(', '), got.join() === WANT[f].join(), got);
    });
    // the tickets really carry the mark: the alert sweep's, and a "Not for me" follow-up that wants a reply
    var announced = [], realPush = helpPushNew;
    helpPushNew = async function (env, t) { announced.push(Object.assign({}, t)); return { sent: 0 }; };
    DB.vp_game_feedback = []; DB.vp_admin_audit = [];
    rating(1, OTHER); rating(1, OTHER);
    await vpfAlertSweep(ENV, Date.now());
    var fb1 = rating(1); await send({ feedback_id: fb1, note: 'Could not hear', consent: true, email: 'bad@example.com' });
    var fb2 = rating(2); await send({ feedback_id: fb2, note: 'Bit slow', consent: true, email: 'meh@example.com' });
    helpPushNew = realPush;
    var marks = announced.map(function (t) { return [/Not for me at|Your feedback/.test(t.subject) ? t.subject.slice(0, 30) : t.subject, helpPushWants({ filter: 'bad_feedback' }, t)]; });
    check('the "2 Not for me tonight" alert and the "Not for me" reply buzz a bad-feedback phone; the "Good" reply does not',
          announced.length === 3 && marks[0][1] === true && marks[1][1] === true && marks[2][1] === false, marks);
    check('the mark is never stored on a ticket', tbl('vp_help_tickets').every(function (t) { return !('bad_feedback' in t); }));

    print('\nJOBS 532: A NEW COASTER LEAD BUZZES HQ\'S PHONES, ONCE; A PROSPECT\'S PLAY DOES NOT');
    var pushed = [], realPush2 = helpPushNew;
    helpPushNew = async function (env, t) { pushed.push(t.email_message_id); return { sent: 1 }; };
    DB.vp_admin_audit = []; DB.vp_help_tickets = [];
    var nowIso = new Date().toISOString();
    tbl('vp_help_tickets').push(
      { id: 'c1', ticket_no: 5001, priority: 'urgent', category: 'sales', email_message_id: 'coaster-play:l:201:2026-11-21', created_at: nowIso },
      { id: 'c2', ticket_no: 5002, priority: 'normal', category: 'sales', email_message_id: 'coaster-play:l:202:2026-11-21', created_at: nowIso },
      { id: 'c3', ticket_no: 5003, priority: 'urgent', category: 'sales', email_message_id: null, created_at: nowIso },
      { id: 'c4', ticket_no: 5004, priority: 'urgent', category: 'sales', email_message_id: 'coaster-play:l:203:2026-11-01', created_at: '2026-11-01T00:00:00Z' });
    var cp1 = await vpaCoasterPlayPushSweep(ENV, Date.now());
    check('a new coaster lead (urgent coaster-play ticket) is pushed to the phones', pushed.length === 1 && pushed[0] === 'coaster-play:l:201:2026-11-21', pushed);
    check('...a normal (prospect) coaster ticket, a plain urgent ticket and an old one are not', cp1.pushed === 1, cp1);
    var cp2 = await vpaCoasterPlayPushSweep(ENV, Date.now());
    check('the next tick pushes it no second time (once each)', pushed.length === 1 && cp2.pushed === 0, pushed);
    check('the audit row marks it, and nothing else is written or sent', tbl('vp_admin_audit').length === 1 && tbl('vp_admin_audit')[0].target === 'coaster-play:l:201:2026-11-21' && tbl('vp_help_tickets').length === 4);
    helpPushNew = realPush2;
    check('the sweep rides the Worker\'s scheduled trigger', /try \{ await vpaCoasterPlayPushSweep\(env, Date\.now\(\)\); \}/.test(readFile('venueplay-backend/worker/venueplay-api-FULL.js')));
    vpaRequireAdmin = async function () { return { id: 'hq-1', actorId: 'u-hq', label: 'Dean' }; };
    var EP = 'https://fcm.googleapis.com/fcm/send/abc123';
    var r1 = await helpAdminPushSubscribe(REQ({ endpoint: EP, filter: 'bad_feedback' }), ENV, J);
    var sub = tbl('vp_help_push_subs').filter(function (x) { return x.endpoint === EP; });
    check('before migration 137: the device is kept on "every ticket", and HQ is told why',
          r1.body.ok && r1.body.filter === 'all' && sub.length === 1 && sub[0].filter === 'all' && /needs migration 137/.test(r1.body.note || ''), [r1.body, sub]);
    PUSH_FILTERS.push('bad_feedback');
    var r2 = await helpAdminPushSubscribe(REQ({ endpoint: EP, filter: 'bad_feedback' }), ENV, J);
    sub = tbl('vp_help_push_subs').filter(function (x) { return x.endpoint === EP; });
    check('after migration 137: stored as "bad_feedback", one row for the device, no note', r2.body.filter === 'bad_feedback' && sub.length === 1 && sub[0].filter === 'bad_feedback' && !r2.body.note, [r2.body, sub]);
    var r3 = await helpAdminPushSubscribe(REQ({ endpoint: EP, filter: 'everything-please' }), ENV, J);
    check('a filter nobody offers is stored as "every ticket"', r3.body.filter === 'all', r3.body);
    var sql = readFile('venueplay-backend/supabase/venueplay-137-feedback-notes.sql');
    check('migration 137 widens the check to exactly all, urgent_sales and bad_feedback', /check \(filter in \('all', 'urgent_sales', 'bad_feedback'\)\)/.test(sql));
    var hqjs = readFile('venueplay/app/vp-helpdesk-hq.js');
    check('HQ offers the three choices', /value="all"[^<]*Every ticket/.test(hqjs) && /value="urgent_sales"/.test(hqjs) && /value="bad_feedback"> Only bad player feedback/.test(hqjs));

    print('\nHQ SEES EVERYTHING, NEVER AN EMAIL');
    vpaRequireAdmin = async function () { return { id: 'hq-1' }; };
    var hq = await vpaHandleFeedbackHq(REQ({ month: new Date().toISOString().slice(0, 7) }), ENV, J);
    var ns = (hq.body && hq.body.notes) || [];
    check('HQ\'s list has the notes with their words and tags', ns.length >= 12 && ns.some(function (n) { return n.note === 'Great night, loved the host' && n.rating === 1; }), ns.slice(0, 2));
    check('and never an email or a name', JSON.stringify(ns).indexOf('@') < 0 && JSON.stringify(ns).indexOf('Sam') < 0);
  } catch (e) { check('the scenes ran without throwing', false, String(e && e.stack || e)); }
  print('');
  print(fails ? (fails + ' FAILED, ' + ran + ' run') : ('ALL ' + ran + ' CHECKS PASSED'));
})();
drainMicrotasks();
