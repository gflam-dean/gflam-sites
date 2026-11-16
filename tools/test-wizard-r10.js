/* THE SETUP WIZARD, ROUND 10: EVERY QUESTION ASKED, EVERY ANSWER SAVED, FOR NEW AND EXISTING VENUES (Dean, 9 Nov 2026).

   venueplay/app/vp-gamesetup.js and vp-setup-help.js run here in the same small fake page as tools/test-game-setup.js,
   against a fake game Worker that keeps game_prefs the way /host/game-prefs does, with the Worker's own key list
   (GAME_PREFS_KEYS and cleanGamePrefs lifted out of venueplay-game.js and RUN):

     1. A NEW VENUE answers every question of every game with a value that is not the default, and each answer is
        checked in what is sent, in what the Worker keeps, and in the venue's saved settings
     2. AN EXISTING VENUE: asked on its next sign-in (owner or manager, never mid-game, never a host), each screen opens
        with its own settings, clicking straight through sends NOTHING, one change sends one key, a members draw is
        updated by its id, settings it never had stay unsaved (new settings off), Not today / Close / Remind me write
        nothing and ask again on the next sign-in
     3. Dean's other round 9 notes (DEAN-FEEDBACK-9.md)
     4. The members list CSV: which column is which (billing.html, lifted and run)
     5. The musical bingo TV with the song name only in the played list
     6. Wired into the console home

   Run from the repo root:  jsc tools/test-wizard-r10.js */
var ran = 0, bad = 0;
function check(n, c, saw) { ran++; if (c) print('  ok   ' + n); else { bad++; print('  FAIL ' + n + (saw !== undefined ? '   saw: ' + String(typeof saw === 'string' ? saw : JSON.stringify(saw)).slice(0, 400) : '')); } }
function section(t) { print(''); print(t); }

/* ---------------- a small DOM (the same shape as test-first-run-guide.js) ---------------- */
function El(tag) {
  this.tagName = (tag || 'div').toUpperCase(); this.id = ''; this.className = ''; this.children = [];
  this.parentNode = null; this.style = {}; this.attrs = {}; this.textContent = ''; this.handlers = {};
  this.value = ''; this.checked = false; this.disabled = false; this.ownerDocument = null;
}
Object.defineProperty(El.prototype, 'firstChild', { get: function () { return this.children[0] || null; } });
El.prototype.appendChild = function (k) { if (k.parentNode) k.parentNode.removeChild(k); this.children.push(k); k.parentNode = this; if (k.tagName === 'OPTION' && k.selected) this.value = k.value; else if (this.tagName === 'SELECT' && this.children.length === 1) this.value = k.value; return k; };
El.prototype.insertBefore = function (k, ref) { if (k.parentNode) k.parentNode.removeChild(k); var i = ref ? this.children.indexOf(ref) : -1; if (i < 0) this.children.push(k); else this.children.splice(i, 0, k); k.parentNode = this; return k; };
El.prototype.removeChild = function (k) { var i = this.children.indexOf(k); if (i >= 0) this.children.splice(i, 1); k.parentNode = null; return k; };
El.prototype.setAttribute = function (k, v) { this.attrs[k] = String(v); if (k === 'style') this.style.cssText = String(v); };
El.prototype.getAttribute = function (k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; };
El.prototype.addEventListener = function (ev, fn) { (this.handlers[ev] = this.handlers[ev] || []).push(fn); };
El.prototype.focus = function () {};
El.prototype.click = function () { if (this.disabled) return null; var out = null; (this.handlers.click || []).forEach(function (f) { out = f({ preventDefault: function () {} }); }); return out; };
function walk(el, fn) { if (fn(el)) return el; for (var i = 0; i < el.children.length; i++) { var r = walk(el.children[i], fn); if (r) return r; } return null; }
function each(el, fn) { fn(el); el.children.forEach(function (c) { each(c, fn); }); }
function all(el, fn) { var out = []; each(el, function (e) { if (fn(e)) out.push(e); }); return out; }
function raw(el) { var t = el.textContent || ''; el.children.forEach(function (c) { t += (/^(P|DIV|LI|H2|H3|UL|BUTTON|INPUT|SELECT|SPAN)$/.test(c.tagName) ? ' ' : '') + raw(c); }); return t; }
function seen(el) { return raw(el).replace(/\s+/g, ' ').trim(); }
async function settle() { for (var i = 0; i < 30; i++) await Promise.resolve(); }

var GAMING = readFile('venueplay/app/vp-gaming.js'), SETUPUSE = readFile('venueplay/app/vp-setupuse.js'), HELP = readFile('venueplay/app/vp-setup-help.js'), GS = readFile('venueplay/app/vp-gamesetup.js'), GAMEW = readFile('venueplay-backend/worker/venueplay-game.js');
var NOW = Date.parse('2026-11-06T15:30:00Z');   // 1:30am on Sat 7 Nov in Brisbane: the Brisbane date is the 7th, not the 6th
var CALLS, PREFS, SAVED, STORE, RELOADS, UNHIDE = true, COLLECTED = [];
function page(over) {
  over = over || {};
  CALLS = []; SAVED = []; RELOADS = 0; STORE = over.store || {}; PREFS = over.prefs || {};
  var body = new El('body');
  var document = { body: body, createElement: function (t) { var e = new El(t); e.ownerDocument = document; return e; },
    getElementById: function (id) { return walk(body, function (e) { return e.id === id; }); } };
  body.ownerDocument = document;
  var storage = { getItem: function (k) { return k in STORE ? STORE[k] : null; }, setItem: function (k, v) { STORE[k] = String(v); } };
  /* The game Worker as far as this uses it: /host/game-prefs GET (what is saved) and POST (merged), and
     /host/members/settings (a draw needs a name; a host is refused, as handleMembersSettings does). */
  var fetch = function (url, opts) {
    var u = String(url), c = { url: u, method: (opts && opts.method) || 'GET', auth: opts && opts.headers && opts.headers.Authorization, body: opts && opts.body ? JSON.parse(opts.body) : null };
    CALLS.push(c);
    var st = 200, ans = { ok: true };
    var m = /\/host\/game-prefs\?venue_id=([^&]+)&game=(\w+)/.exec(u);
    if (m) ans = over.prefsReadFail ? (st = 503, { error: 'busy' }) : { game: m[2], prefs: PREFS[m[2]] || {} };
    else if (/\/host\/game-prefs$/.test(u)) { var g = c.body.game; PREFS[g] = Object.assign({}, PREFS[g] || {}, c.body.prefs); ans = { ok: true, game: g, prefs: PREFS[g] }; }
    else if (/\/host\/running$/.test(u)) { if (over.runningFail) { st = 500; ans = { error: 'x' }; } else ans = { running: (over.running || []).indexOf(c.body.format) >= 0 ? { game_id: 'G9', format: c.body.format } : null }; }
    else if (/\/host\/members\/settings$/.test(u)) { if (over.membersRefuse) { st = 403; ans = { error: 'Only a manager or owner can change the draw and jackpot settings' }; } }
    else if (/musical-library\.json$/.test(u)) ans = { playlists: [{ id: 'all-the-hits', name: 'All the hits' }, { id: 'pub-classics', name: 'Pub Classics' }, { id: '80s-pop', name: '80s' }, { id: '90s', name: '90s' }, { id: '2000s', name: '2000s' }, { id: 'aussie', name: 'Aussie' }, { id: 'country', name: 'Country' }, { id: 'bad id<script>', name: 'x' }] };
    return Promise.resolve({ ok: st < 400, status: st, json: function () { return Promise.resolve(ans); } });
  };
  var client = { auth: { getSession: function () { return Promise.resolve({ data: { session: { access_token: 'TOKEN-1' } } }); } },
    from: function (t) { var b = { select: function () { return b; }, eq: function () { return b; }, order: function () { if (t === 'vp_member_draws' && over.drawsFail) throw new Error('no read'); return b; },
      then: function (r) { return Promise.resolve({ data: t === 'vp_question_sets' ? [{ id: 'S-OWN', title: 'Our quiz', question_count: 40, owner_venue_id: 'V1' }, { id: '5b0e2a7c-1d3f-4a6b-9c8d-0e1f2a3b4c5d', title: 'General Knowledge', question_count: 400, owner_venue_id: null }, { id: 'S-OTHER', title: 'Another pub', owner_venue_id: 'V2' }] : t === 'vp_member_draws' ? (over.draws || []) : [] }).then(r); } }; return b; } };
  var window = { localStorage: storage, document: document, fetch: fetch, location: { reload: function () { RELOADS++; } } };
  (new Function('window', 'document', GAMING))(window, document);
  (new Function('window', SETUPUSE))(window);
  (new Function('window', HELP))(window);
  (new Function('window', GS))(window);
  var ctx = { role: over.role || 'owner', venue: Object.assign({ id: 'V1', name: 'The Test Arms', au_state: 'QLD', entity_type: 'for_profit' }, over.venue || {}), settings: { setup_answers: over.answers || {} } };
  var deps = { doc: document, storage: storage, fetch: fetch, client: client, now: NOW, ctx: ctx,
    saveSettings: function (id, patch) { if (!patch.setup_answers) { COLLECTED.push({ id: id, patch: JSON.parse(JSON.stringify(patch)) }); return over.collectFail ? Promise.reject(new Error('refused')) : Promise.resolve({}); } SAVED.push({ id: id, patch: JSON.parse(JSON.stringify(patch)) }); return over.saveFail ? Promise.reject(new Error('no column')) : Promise.resolve({}); },
    onSaved: function () { RELOADS++; } };
  /* Dean 10 Nov: picture questions, prize swaps, the draw style, raffle names and the email reminder are HIDDEN until the games use them.
     The older checks below still run with them shown (UNHIDE true, the default); the "hidden" block turns it off and checks nothing is asked. */
  if (UNHIDE) {
    window.VPSetupHelp.GAMES.forEach(function (g) { g.settings.forEach(function (x) { if (x.notYet) x.notYet = false; }); });
    window.VPGameSetup.HIDDEN_FOR_NOW.raffleNames = true; window.VPGameSetup.HIDDEN_FOR_NOW.emailReminder = true;
  }
  return { doc: document, body: body, W: window, GS: window.VPGameSetup, H: window.VPSetupHelp, ctx: ctx, deps: deps };
}
function $(P, id) { return P.doc.getElementById(id); }
/* the wizard's first run now has a collect step after the nights (job 416): the older flows pass straight through it */
function passWeek(P, id) { $(P, id).click(); if ($(P, 'vpGsCollectNext')) $(P, 'vpGsCollectNext').click(); }
function T(P, id) { var e = $(P, id); return e ? seen(e) : ''; }
function gameBtn(P, g) { return walk($(P, 'vpGsGames'), function (e) { return e.getAttribute && e.getAttribute('data-game') === g; }); }
function srtj(o) { var r = {}; Object.keys(o || {}).sort().forEach(function (x) { r[x] = o[x]; }); return JSON.stringify(r); }
function addTag(P, key, t) { var i = P.doc.getElementById('vpGsIn_' + key + '_new'); i.value = t; i.handlers.keydown.forEach(function (f) { f({ key: 'Enter', preventDefault: function () {} }); }); }
function tagsOf(P, key) { var b = P.doc.getElementById('vpGsIn_' + key); return b ? b.children.map(function (c) { return c.getAttribute('data-item'); }) : []; }
function posts(path) { return CALLS.filter(function (c) { return c.method === 'POST' && c.url.indexOf(path) >= 0; }); }

/* The Worker's own key list, run for real: GAME_PREFS_KEYS and cleanGamePrefs lifted out of venueplay-game.js. */
var lift = GAMEW.slice(GAMEW.indexOf('const GAME_PREFS_MAX_CHARS'), GAMEW.indexOf('async function handleGamePrefs'));
var WK = (new Function(lift + '; return { KEYS: GAME_PREFS_KEYS, clean: cleanGamePrefs };'))();
var membersFn = GAMEW.slice(GAMEW.indexOf('async function handleMembersSettings'), GAMEW.indexOf('async function handleMembersSettings') + 9000);


/* helpers for answering a game screen the way a person does */
function row(P, key) { return walk($(P, 'vpGsBody'), function (e) { return e.getAttribute && e.getAttribute('data-key') === key; }); }
function seg(P, key, val) { var r = row(P, key); var b = r && walk(r, function (e) { return e.tagName === 'BUTTON' && e.getAttribute('data-value') === String(val); }); if (!b) throw new Error('no ' + key + '=' + val); b.click(); }
function box(P, id, v) { var e = $(P, id); if (!e) throw new Error('no box ' + id); e.value = String(v); (e.handlers.input || []).forEach(function (f) { f(); }); (e.handlers.change || []).forEach(function (f) { f(); }); }
function chip(P, groupId, attr, val) { var b = walk($(P, groupId), function (e) { return e.getAttribute && e.getAttribute(attr) === val; }); if (!b) throw new Error('no chip ' + val); b.click(); }
function chip2(P, groupId, val) { return walk($(P, groupId), function (e) { return e.getAttribute && e.getAttribute('data-value') === val; }); }
function lastPost(path) { var p = posts(path); return p.length ? p[p.length - 1].body : null; }
function lastAnswers() { return SAVED.length ? SAVED[SAVED.length - 1].patch.setup_answers : null; }
function rafWeekly(P, i, v) { var b = walk($(P, 'vpGsRafWeekly_' + i), function (e) { return e.tagName === 'BUTTON' && e.getAttribute('data-value') === String(v); }); if (!b) throw new Error('no weekly ' + i); b.click(); }
function shown(P, key) { var r = row(P, key); return !!r && r.style.display !== 'none'; }
function keptByWorker(game, prefs) { return srtj(WK.clean(game, prefs)) === srtj(prefs); }
var BILL = readFile('venueplay/app/billing.html'), INDEX = readFile('venueplay/app/index.html'), MSCREEN = readFile('venueplay/app/musical/screen.html'), SOUND = readFile('venueplay/app/sound-help.html');

(async function () {
  var P, done;

  section('1. A NEW VENUE: EVERY QUESTION ASKED, EVERY ANSWER SAVED (coordinator, 9 Nov: "ask every question and save every setting")');
  P = page({ venue: { entity_type: null } }); done = P.GS.run(P.ctx, P.deps); await settle();
  check('first screen: one button, one label, no Close and no top Next (Dean, round 9 point 1)', T(P, 'vpGsGo') === "Let's go" && $(P, 'vpGsClose').style.visibility === 'hidden' && $(P, 'vpGsTopNext').style.visibility === 'hidden', [$(P, 'vpGsClose').style.visibility, $(P, 'vpGsTopNext').style.visibility]);
  $(P, 'vpGsGo').click(); await settle();
  check('Close comes back from the second screen', $(P, 'vpGsClose').style.visibility === '');
  check('pub or club asked when nobody knows (Dean, round 9 point 3)', T(P, 'vpGsTitle') === 'Are you a pub or a club?' && !!$(P, 'vpGsKind'));
  chip(P, 'vpGsKind', 'data-value', 'other');
  ['trivia', 'musical', 'bingo', 'raffles', 'members'].forEach(function (g) { gameBtn(P, g).click(); });
  var oi = $(P, 'vpGsOther'); oi.value = 'Karaoke'; (oi.handlers.input || []).forEach(function (f) { f(); }); (oi.handlers.blur || []).forEach(function (f) { f(); });
  await settle(); for (var w8 = 0; w8 < 4; w8++) await new Promise(function (ok) { setTimeout(ok, 60); });
  check('a night typed without Enter is kept when they leave the box (Dean, round 9 point 4)', all($(P, 'vpGsOtherList'), function (e) { return e.getAttribute && e.getAttribute('data-other') === 'Karaoke'; }).length === 1 && $(P, 'vpGsOther').value === '', [$(P, 'vpGsOther').value]);
  check('ONE question for other nights and meal deals, no time asked, no separate meal deals question (Dean, round 11 note 1)', /Do you run any other regular nights or meal deals\?/.test(T(P, 'vpGsBody')) && !$(P, 'vpGsMeal') && !/advertise your meal deals/.test(T(P, 'vpGsBody')));
  oi = $(P, 'vpGsOther'); oi.value = 'Parma night'; (oi.handlers.input || []).forEach(function (f) { f(); }); (oi.handlers.blur || []).forEach(function (f) { f(); });
  for (var w9 = 0; w9 < 4; w9++) await new Promise(function (ok) { setTimeout(ok, 60); });
  $(P, 'vpGsNext').click(); await settle();
  var sa = lastAnswers();
  check('saved: venue_kind other, the five games, both the other night and the meal deal in the one answer, meal deals noted', sa && sa.venue_kind === 'other' && sa.games.join() === 'trivia,musical,bingo,raffles,members' && sa.other === 'Karaoke, Parma night' && sa.meal_deals === true, sa);
  check('the nights step says it in one line (Dean, round 9 point 8)', T(P, 'vpGsWeek') !== '' && /^Tap every night you run each game, and give it a start time\.$/.test(seen(walk($(P, 'vpGsBody'), function (e) { return e.className === 'vpgs-lead'; }))));
  chip(P, 'vpGsWeek', 'aria-label', 'Trivia on Wednesday'); chip(P, 'vpGsWeek', 'aria-label', 'Members draws on Friday'); chip(P, 'vpGsWeek', 'aria-label', 'Karaoke on Saturday');
  check('Next waits for every start time', $(P, 'vpGsWeekNext').disabled === true);
  box(P, 'vpGsTime_trivia_wed', '19:00'); box(P, 'vpGsTime_members_fri', '20:30'); box(P, 'vpGsTime_other:karaoke_sat', '21:00');
  check('the start times are picked from the half-hour list', $(P, 'vpGsWeekNext').disabled === false && $(P, 'vpGsTime_trivia_wed').tagName === 'SELECT');
  passWeek(P, 'vpGsWeekNext'); await settle();
  sa = lastAnswers();
  check('saved: the week with each start time', sa && JSON.stringify(sa.week) === JSON.stringify([{ day: 'wed', games: [{ game: 'trivia', start: '19:00' }] }, { day: 'fri', games: [{ game: 'members', start: '20:30' }] }, { day: 'sat', games: [{ game: 'other', name: 'Karaoke', start: '21:00' }] }]), sa && sa.week);
  check('one Yes for each game they picked, in game order: trivia, musical bingo, bingo, raffles, members draws (Dean, round 11 note 2)', T(P, 'vpGsTitle') === 'Now let\'s set up your games.' && all($(P, 'vpGsGamePicks'), function (e) { return e.tagName === 'BUTTON' && e.getAttribute('data-game'); }).map(function (e) { return seen(e); }).join('|') === 'Yes, set up trivia|Yes, set up musical bingo|Yes, set up bingo|Yes, set up raffles|Yes, set up members draws');
  check('"Now let\'s set up your games." with Yes naming it, and one line under Not today (Dean, round 9 point 9)', T(P, 'vpGsTitle') === 'Now let\'s set up your games.' && T(P, 'vpGsAllYes') === 'Yes, set up trivia' && T(P, 'vpGsAllNo') === 'Not today' && T(P, 'vpGsAllNote') === 'Each game walks you through its setup the first time you open it. Do it before your first night.');
  $(P, 'vpGsAllYes').click(); await settle();

  /* TRIVIA: every question */
  check('trivia: the step line names the game and the button says Next, like the top one (Dean, round 9 point 12)', T(P, 'vpGsCount') === 'Trivia, game 1 of 5' && T(P, 'vpGsSave') === 'Next');
  check('trivia: no "the usual settings are already filled in" (Dean, round 9 point 20)', !/usual settings are already filled in/.test(T(P, 'vpGsBody')));
  function pairOf(P, key) { var r = row(P, key); return r && r.parentNode; }
  function firstKey(P) { var r = walk($(P, 'vpGsBody'), function (e) { return e.getAttribute && e.getAttribute('data-key'); }); return r && r.getAttribute('data-key'); }
  check('trivia: Rounds a night and Questions a round on ONE line, and first (Dean, round 11 note 4)', pairOf(P, 'rounds') === pairOf(P, 'count') && /vpgs-pairs/.test(pairOf(P, 'rounds').className) && firstKey(P) === 'rounds' && /Questions a round/.test(seen(row(P, 'count'))));
  check('trivia: Round prizes (different or the same) and Same every week? on one line', pairOf(P, 'prize_same') === pairOf(P, 'prize_weekly') && /vpgs-pairs/.test(pairOf(P, 'prize_weekly').className) && /Same prizes every week\?/.test(seen(row(P, 'prize_weekly'))));
  check('trivia: Double points and Picture questions are On/Off toggles side by side, Double points Off to start (Dean, round 11 note 4)', pairOf(P, 'double_points') === pairOf(P, 'picture_round') && row(P, 'double_points').children[2].children[0].children.map(function (b) { return seen(b); }).join('|') === 'On|Off' && !shown(P, 'double_last'));
  check('trivia: picture questions say plainly they are ON, for the TV and phones, so paper teams can play (Dean, round 11 note 4)', /Picture questions are ON\. A question with a picture shows it on the TV and on phones, so paper teams can play too\./.test(T(P, 'vpGsState_picture_round')));
  check('trivia: Seconds to answer + Faster answers score more on one line, Points + the buzz on the next, in More settings', pairOf(P, 'time_s') === pairOf(P, 'speed_bonus') && pairOf(P, 'base_points') === pairOf(P, 'buzzer') && pairOf(P, 'time_s') !== pairOf(P, 'base_points') && pairOf(P, 'time_s').parentNode.parentNode.id === 'vpGsAdvanced');
  check('trivia: the mix or categories are NOT asked here, they are picked every night (Dean, round 11 note 4)', !row(P, 'set_mode') && !$(P, 'vpGsIn_set_ids'));
  check('trivia: the speed bonus help says paper teams don\'t get it (Dean, round 9 point 29)', /Paper teams don't get the speed bonus\./.test(T(P, 'vpGsHelp_speed_bonus')));
  check('trivia: no prize swap offered while the prizes are the same every week', !shown(P, 'prize_swaps'));
  box(P, 'vpGsIn_rounds', 4); box(P, 'vpGsIn_count', 12);
  seg(P, 'prize_same', 'true');
  check('trivia: the same prize every round is ONE box', !!$(P, 'vpGsIn_prizes_0') && !$(P, 'vpGsIn_prizes_1'));
  box(P, 'vpGsIn_prizes_0', '$50 bar tab');
  seg(P, 'prize_weekly', 'false');
  check('trivia: not the same every week, so a week can be swapped (Dean, round 11 note 3)', shown(P, 'prize_swaps') && !!$(P, 'vpGsSwapAdd'));
  $(P, 'vpGsSwapAdd').click();
  box(P, 'vpGsSwapWeek_0', '2026-11-18'); box(P, 'vpGsSwapP_0_0', 'Big hamper');
  seg(P, 'double_points', 'true');
  check('On: "How many questions in each round are worth double?", 2 to start', shown(P, 'double_last') && $(P, 'vpGsIn_double_last').value === '2');
  box(P, 'vpGsIn_double_last', 3);
  seg(P, 'picture_round', 'false');
  check('trivia: switched off, it says OFF', /Picture questions are OFF/.test(T(P, 'vpGsState_picture_round')));
  $(P, 'vpGsAdvToggle').click();
  box(P, 'vpGsIn_time_s', 20); box(P, 'vpGsIn_base_points', 50); seg(P, 'speed_bonus', 'false'); seg(P, 'buzzer', 'true'); seg(P, 'buzzer_where', 'device');
  CALLS = []; $(P, 'vpGsSave').click(); await settle();
  var tp = lastPost('/host/game-prefs');
  var wantT = { rounds: 4, count: 12, prize_same: true, prizes: ['$50 bar tab'], prize_none: [], prize_list: ['$50 bar tab'], prize_weekly: false, prize_swaps: [{ week: '2026-11-16', prizes: ['Big hamper'] }], double_points: true, double_last: 3, picture_round: false, time_s: 20, base_points: 50, speed_bonus: false, buzzer: true, buzzer_where: 'device' };
  var missT = Object.keys(wantT).filter(function (k) { return !tp || JSON.stringify(tp.prefs[k]) !== JSON.stringify(wantT[k]); });
  check('trivia: every answer saved to game_prefs.trivia (' + Object.keys(wantT).length + ' settings)', tp && tp.game === 'trivia' && missT.length === 0, { missing: missT, sent: tp && tp.prefs });
  check('trivia: the game Worker keeps every one (GAME_PREFS_KEYS, run for real)', tp && keptByWorker('trivia', tp.prefs), tp && WK.clean('trivia', tp.prefs));
  check('trivia: the venue\'s saved settings now hold them', PREFS.trivia && PREFS.trivia.double_last === 3 && PREFS.trivia.prize_weekly === false && PREFS.trivia.rounds === 4 && PREFS.trivia.picture_round === false && PREFS.trivia.prize_swaps[0].week === '2026-11-16');

  /* MUSICAL BINGO: every question */
  $(P, 'vpGsNextYes').click(); await settle();
  check('musical bingo next, "Musical bingo, game 2 of 5"', T(P, 'vpGsCount') === 'Musical bingo, game 2 of 5');
  ['pub-classics', '80s-pop', '90s', '2000s'].forEach(function (id) { chip(P, 'vpGsIn_playlists', 'data-id', id); });   // leaves All the hits
  chip(P, 'vpGsIn_playlists', 'data-id', '90s');
  box(P, 'vpGsIn_rounds', 3);
  seg(P, 'prize_same', 'false');
  var n0 = $(P, 'vpGsNone_0'); n0.checked = true; n0.handlers.change.forEach(function (f) { f(); });
  check('"No prize" says No prize in the box (Dean, round 9 point 15)', $(P, 'vpGsIn_prizes_0').value === 'No prize' && $(P, 'vpGsIn_prizes_0').disabled === true);
  box(P, 'vpGsIn_prizes_1', '$20 bar tab');
  chip(P, 'vpGsUsual_prizes', 'data-item', '$50 bar tab');
  check('a usual prize drops onto the next empty round and shows it (Dean, round 9 point 14)', $(P, 'vpGsIn_prizes_2').value === '$50 bar tab' && / vpgs-filled/.test($(P, 'vpGsIn_prizes_2').className));
  check('musical bingo: Round prizes and Same every week? on one line (Dean, round 11 note 5)', pairOf(P, 'prize_same') === pairOf(P, 'prize_weekly') && !shown(P, 'prize_swaps'));
  seg(P, 'prize_weekly', 'false');
  check('musical bingo: not the same every week, a week can be swapped', shown(P, 'prize_swaps'));
  $(P, 'vpGsSwapAdd').click(); box(P, 'vpGsSwapWeek_0', '2026-12-02'); box(P, 'vpGsSwapP_0_1', 'Jug');
  check('musical bingo: "Same as above" copies the prize above into a round, one tap (Dean, round 11 note 5)', !!$(P, 'vpGsSame_prizes_1') && !$(P, 'vpGsSame_prizes_0'));
  $(P, 'vpGsAdvToggle').click();
  check('musical bingo: the sound row says where the music plays and how it works (Dean, round 11 notes 5 and 9)', /Default place to play the music/.test(T(P, 'vpGsBody')) && /comes through your TV's HDMI cable automatically/.test(T(P, 'vpGsBody')) && !/Which songs play in your speakers/i.test(T(P, 'vpGsBody')));
  check('musical bingo: lists have the white arrow look', /vpgs-tsel/.test($(P, 'vpGsIn_reveal').className));
  var rv = $(P, 'vpGsIn_reveal');
  check('"Only in the played-songs list" in place of "Never, I call it" (Dean, round 9 points 17 and 25)', rv.children.map(function (o) { return o.textContent; }).join('|') === 'Straight away|After 15 seconds|When the clip ends|Only in the played-songs list');
  box(P, 'vpGsIn_reveal', 'never'); seg(P, 'hits_only', 'false');
  CALLS = []; $(P, 'vpGsSave').click(); await settle();
  var mp = lastPost('/host/game-prefs');
  var wantM = { playlists: ['all-the-hits', '90s'], playlist: 'all-the-hits', rounds: 3, prize_same: false, prizes: ['', '$20 bar tab', '$50 bar tab'], prize: '$20 bar tab', prize_none: [1], prize_weekly: false, prize_swaps: [{ week: '2026-11-30', prizes: ['', 'Jug', ''] }], reveal: 'never', hits_only: false };
  var missM = Object.keys(wantM).filter(function (k) { return !mp || JSON.stringify(mp.prefs[k]) !== JSON.stringify(wantM[k]); });
  check('musical bingo: every answer saved to game_prefs.musical (' + Object.keys(wantM).length + ' settings)', mp && mp.game === 'musical' && missM.length === 0, { missing: missM, sent: mp && mp.prefs });
  check('musical bingo: the game Worker keeps every one', mp && keptByWorker('musical', mp.prefs), mp && WK.clean('musical', mp.prefs));

  /* BINGO: every question (phone tickets), then paper with real balls */
  $(P, 'vpGsNextYes').click(); await settle();
  check('bingo next', T(P, 'vpGsTitle') === 'Set up bingo');
  var bkeys = all($(P, 'vpGsBody'), function (e) { return e.getAttribute && e.getAttribute('data-key'); }).map(function (e) { return e.getAttribute('data-key'); });
  check('bingo: Games a night moved up one, above Tickets per player (Dean, round 11 note 5)', bkeys.indexOf('rounds') < bkeys.indexOf('cards') && /Tickets per player/.test(seen(row(P, 'cards'))) && !/6 tickets a book|Phone tickets for each player/.test(T(P, 'vpGsBody')));
  check('bingo: Tickets per player sits on its label line (a compact list)', / cmp/.test(row(P, 'cards').className) && row(P, 'cards').children[2].children[0].tagName === 'SELECT');
  box(P, 'vpGsIn_rounds', 2); box(P, 'vpGsIn_cards', 3); box(P, 'vpGsIn_round_prizes_0', 'Meat tray'); $(P, 'vpGsSame_round_prizes_1').click();
  check('bingo: Same as above filled game 2 with game 1\'s prize', $(P, 'vpGsIn_round_prizes_1').value === 'Meat tray');
  CALLS = []; $(P, 'vpGsSave').click(); await settle();
  var bp = lastPost('/host/game-prefs');
  var wantB = { ticket_kind: 'phone', cards: 3, rounds: 2, round_prizes: ['Meat tray', 'Meat tray'], prize_list: ['Meat tray'], allow_early: false };
  var missB = Object.keys(wantB).filter(function (k) { return !bp || JSON.stringify(bp.prefs[k]) !== JSON.stringify(wantB[k]); });
  check('bingo: every answer saved to game_prefs.bingo (' + Object.keys(wantB).length + ' settings, early BINGO at the console\'s usual Off)', bp && bp.game === 'bingo' && missB.length === 0, { missing: missB, sent: bp && bp.prefs });
  check('bingo: the game Worker keeps every one', bp && keptByWorker('bingo', bp.prefs));

  /* RAFFLES: every question */
  $(P, 'vpGsNextYes').click(); await settle();
  check('raffles next, nothing filled in, "How long do winners have to claim?" asked (Dean, round 9 point 20)', T(P, 'vpGsTitle') === 'Set up raffles' && $(P, 'vpGsRafP_0_0').value === '' && shown(P, 'time_to_present') && /How long do winners have to claim\?/.test(seen(row(P, 'time_to_present'))));
  check('raffles: a More settings section (Dean, round 11 note 6)', !!$(P, 'vpGsAdvanced') && /How the draw looks/.test(T(P, 'vpGsAdvanced')));
  box(P, 'vpGsIn_raffles', 2); box(P, 'vpGsRafN_0', 3);
  check('raffles: each raffle can be named', !!$(P, 'vpGsRafName_0') && !!$(P, 'vpGsRafName_1'));
  box(P, 'vpGsRafName_0', 'Friday Meat Raffle'); box(P, 'vpGsRafName_1', 'Hamper Draw');
  chip(P, 'vpGsRafSame_0', 'data-value', 'true');
  box(P, 'vpGsRafP_0_0', 'Meat tray');
  box(P, 'vpGsRafP_1_0', "Winner's choice");
  box(P, 'vpGsIn_time_to_present', 300);
  rafWeekly(P, 0, 'false');
  check('raffles: not the same every week, so a week can be swapped, one box for each prize in order', shown(P, 'prize_swaps') && !!$(P, 'vpGsSwapAdd'));
  $(P, 'vpGsSwapAdd').click(); box(P, 'vpGsSwapWeek_0', '2026-12-09'); box(P, 'vpGsSwapP_0_0', 'Hamper'); box(P, 'vpGsSwapP_0_1', 'Voucher');
  check('raffles: draw style offers the ticket roll and the race plate (the console\'s looks, no As now); the cash prize asks its amount', $(P, 'vpGsIn_draw_style').children.map(function (o) { return o.value; }).join() === 'ticket,race' && !shown(P, 'jackpot_amount_cents'));
  box(P, 'vpGsIn_draw_style', 'ticket'); seg(P, 'jackpot_on', 'true'); box(P, 'vpGsIn_jackpot_amount_cents', '250'); seg(P, 'allow_redraw', 'false'); box(P, 'vpGsIn_spin_seconds', 6);
  CALLS = []; $(P, 'vpGsSave').click(); await settle();
  var rp = lastPost('/host/game-prefs');
  var wantR = { raffles: 2, raffle_counts: [3, 1], raffle_names: ['Friday Meat Raffle', 'Hamper Draw'], raffle_prizes: [['Meat tray', 'Meat tray', 'Meat tray'], ["Winner's choice"]], prizes: ['Meat tray', "Winner's choice"], prize_count: 3, prizes_same: true, time_to_present: 300, prizes_weekly: false, raffle_weekly: [false, true], prize_swaps: [{ week: '2026-12-07', prizes: ['Hamper', 'Voucher'] }], draw_style: 'ticket', jackpot_on: true, jackpot_amount_cents: 25000, allow_redraw: false, spin_seconds: 6 };
  var missR = Object.keys(wantR).filter(function (k) { return !rp || JSON.stringify(rp.prefs[k]) !== JSON.stringify(wantR[k]); });
  check('raffles: every answer saved to game_prefs.raffle (' + Object.keys(wantR).length + ' settings)', rp && rp.game === 'raffle' && missR.length === 0, { missing: missR, sent: rp && rp.prefs });
  check('raffles: the game Worker keeps every one', rp && keptByWorker('raffle', rp.prefs), rp && WK.clean('raffle', rp.prefs));

  /* MEMBERS DRAWS: every question */
  $(P, 'vpGsNextYes').click(); await settle();
  check('members draws last, the draw time from the nights step in the half-hour list', T(P, 'vpGsTitle') === 'Set up members draws' && $(P, 'vpGsIn_draw_time').tagName === 'SELECT' && $(P, 'vpGsIn_draw_time').value === '20:30', $(P, 'vpGsIn_draw_time').value);
  box(P, 'vpGsIn_name', 'Friday Jackpot'); box(P, 'vpGsIn_date_started', '2026-01-09'); box(P, 'vpGsIn_draw_time', '21:00');
  box(P, 'vpGsIn_current_jackpot_cents', '1250'); box(P, 'vpGsIn_starting_amount_cents', '250'); box(P, 'vpGsIn_increment_cents', '50'); box(P, 'vpGsIn_max_jackpot_cents', '5000');
  seg(P, 'over_max', 'second');
  check('members draws: compact, two to a line (start and time, starting and maximum jackpot, jackpot now and weekly)', pairOf(P, 'date_started') === pairOf(P, 'draw_time') && pairOf(P, 'starting_amount_cents') === pairOf(P, 'max_jackpot_cents') && pairOf(P, 'current_jackpot_cents') === pairOf(P, 'increment_cents'));
  check('members draws: "Add another draw" is offered', T(P, 'vpGsAddDraw') === 'Add another draw');
  CALLS = []; $(P, 'vpGsAddDraw').click(); await settle();
  var ms = lastPost('/host/members/settings');
  var wantMe = { name: 'Friday Jackpot', date_started: '2026-01-09', draw_time: '9pm', current_jackpot_cents: 125000, starting_amount_cents: 25000, increment_cents: 5000, max_jackpot_cents: 500000, draw_day: 'Friday' };
  var missMe = Object.keys(wantMe).filter(function (k) { return !ms || JSON.stringify(ms[k]) !== JSON.stringify(wantMe[k]); });
  check('members draws: every answer sent to /host/members/settings (' + Object.keys(wantMe).length + ' fields)', ms && missMe.length === 0 && !('over_max' in ms), { missing: missMe, sent: ms });
  var memKeys = Object.keys(ms || {}).filter(function (k) { return k !== 'venue_id'; }).filter(function (k) { return membersFn.indexOf("'" + k + "'") < 0 && membersFn.indexOf('b.' + k) < 0; });
  check('members draws: the game Worker reads every field it is sent', memKeys.length === 0, memKeys);
  check('"Add another draw" saved the first and opened a second, blank one', T(P, 'vpGsCount') === 'Members draws, game 5 of 5, draw 2 of 2' && $(P, 'vpGsIn_name').value === '' && $(P, 'vpGsIn_current_jackpot_cents').value === '' && posts('/host/members/settings').length === 1);
  box(P, 'vpGsIn_name', 'Sunday Jackpot'); box(P, 'vpGsIn_date_started', '2026-02-01'); box(P, 'vpGsIn_draw_time', '17:00'); box(P, 'vpGsIn_current_jackpot_cents', '500');
  $(P, 'vpGsSave').click(); await settle();
  var ms2 = lastPost('/host/members/settings');
  check('the second draw is saved as its own draw', posts('/host/members/settings').length === 2 && ms2.name === 'Sunday Jackpot' && ms2.draw_time === '5pm' && ms2.current_jackpot_cents === 50000 && ms2.date_started === '2026-02-01' && !('draw_id' in ms2), ms2);
  check('then the members list reminder: how, the best day and the best time (Dean, round 11 note 7)', /Would you like a weekly reminder to update your members list\?/.test(T(P, 'vpGsBody')) && /We can email you/.test(T(P, 'vpGsBody')) && !/add your members list/i.test(T(P, 'vpGsBody')) && T(P, 'vpGsTitle') === 'Update your members list later' && ['email', 'calendar', 'none'].every(function (v) { return !!chip2(P, 'vpGsRemind', v); }) && $(P, 'vpGsRemindWhen').style.display === 'none');
  chip2(P, 'vpGsRemind', 'calendar').click(); box(P, 'vpGsRemindDay', 'thu'); box(P, 'vpGsRemindTime', '16:30');
  var ics = decodeURIComponent(($(P, 'vpGsRemindCal').attrs.href || '').replace(/^data:text\/calendar;charset=utf-8,/, ''));
  check('the weekly calendar entry is a real .ics: Thursdays at 4:30pm, repeating weekly', $(P, 'vpGsRemindWhen').style.display === '' && /RRULE:FREQ=WEEKLY;BYDAY=TH/.test(ics) && /DTSTART:20261112T163000/.test(ics) && /BEGIN:VEVENT/.test(ics) && $(P, 'vpGsRemindCal').attrs.download === 'venueplay-members-list-reminder.ics', ics);
  $(P, 'vpGsExtrasNo').click(); await settle();
  sa = lastAnswers();
  check('the reminder is kept in setup_answers.members_reminder', sa && JSON.stringify(sa.members_reminder) === JSON.stringify({ how: 'calendar', day: 'thu', time: '16:30', since: P.GS.brisbaneDate(NOW) }), sa && sa.members_reminder);
  check('members draws: what happens over the most kept in setup_answers', sa && sa.members_over === 'second', sa && sa.members_over);
  check('the end: "You\'re ready for your week." and the advertising prompt, meal deals named, to the Screen tab (Dean, round 9 point 23)', T(P, 'vpGsTitle') === "You're ready for your week." && T(P, 'vpGsAdvert') === 'Add TV promos on your Account page' && T(P, 'vpGsDone') === 'Go to my console' && $(P, 'vpGsAdvertGo').getAttribute('href') === '/app/billing.html#screen');
  check('a venue that has gone through it is not asked again as an existing venue (setup_answers.review)', sa && sa.review === 'done' && P.GS.wantsReview(Object.assign({}, P.ctx, { settings: { setup_answers: sa } }), P.deps.storage, NOW) === false);
  check('every game marked done', sa && JSON.stringify(sa.setup) === JSON.stringify({ trivia: 'done', musical: 'done', bingo: 'done', raffles: 'done', members: 'done' }), sa && sa.setup);
  $(P, 'vpGsDone').click(); await settle();
  check('"Go to my console" closes the setup and finishes it (Dean, round 9 point 22)', !$(P, 'vpGs') && (await done) === 'done');

  section('2. AN EXISTING VENUE (Dean, 9 Nov 2026): asked on its next sign-in, already filled in, clicking through changes nothing');
  var HAVE = {
    trivia: { set_mode: 'mix', rounds: 5, count: 15, double_points: true, double_last: 5, time_s: 45, base_points: 200, speed_bonus: true, buzzer: false, prize_list: ['Bar tab'] },
    musical: { playlists: ['90s', 'aussie'], playlist: '90s', rounds: 4, prize_same: false, prizes: ['', 'Voucher', 'Jug', 'Tab'], prize: 'Voucher', prize_none: [1], reveal: 'never', hits_only: false },
    bingo: { ticket_kind: 'phone', cards: 4, rounds: 3, round_prizes: ['A', '', 'C'] },
    raffle: { raffles: 2, raffle_counts: [2, 1], raffle_prizes: [['Meat tray', 'Fuel'], ['Hamper']], prizes: ['Meat tray', 'Fuel', 'Hamper'], time_to_present: 240 }
  };
  var DRAW = { id: 'D1', venue_id: 'V1', name: 'Thursday Members Draw', draw_time: '7:30pm', date_started: '2025-03-06', current_jackpot_cents: 99000, starting_amount_cents: 10000, increment_cents: 2500, max_jackpot_cents: null, archived_at: null };
  function oldVenue(over) {
    over = over || {};
    var o = Object.assign({ prefs: JSON.parse(JSON.stringify(HAVE)), draws: [DRAW], venue: { created_at: '2025-01-01T00:00:00Z', last_trivia_at: '2026-11-04T09:00:00Z' } }, over);
    var Q = page(o); Q.deps.busy = function () { return false; }; return Q;
  }
  P = oldVenue();
  check('asked: the owner of an existing venue that has not been through it', P.GS.wantsReview(P.ctx, P.deps.storage, NOW) === true);
  var Ph = oldVenue({ role: 'host' });
  check('never a host', Ph.GS.wantsReview(Ph.ctx, Ph.deps.storage, NOW) === false);
  var Pm = oldVenue({ role: 'manager' });
  check('a manager, yes', Pm.GS.wantsReview(Pm.ctx, Pm.deps.storage, NOW) === true);
  check('never a switched-off venue, never a prospect on its own guide', oldVenue({ venue: { status: 'suspended' } }).GS.wantsReview(oldVenue({ venue: { status: 'suspended' } }).ctx, {getItem: function(){ return null; }}, NOW) === false && (function () { var Q = oldVenue({ venue: { terms_required: true } }); return Q.GS.wantsReview(Q.ctx, Q.deps.storage, NOW) === false; })());
  var Pb = oldVenue({ running: ['musical_bingo'] });
  check('never while a game is running at the venue (the game Worker\'s /host/running)', (await Pb.GS.review(Pb.ctx, Pb.deps)) === 'busy' && !$(Pb, 'vpGs'));
  var Pb2 = oldVenue(); Pb2.deps.busy = function () { return 'trivia night'; };
  check('never while this device has a night going', (await Pb2.GS.review(Pb2.ctx, Pb2.deps)) === 'busy' && !$(Pb2, 'vpGs'));
  var Pb3 = oldVenue({ runningFail: true });
  check('a failed check counts as busy: a busy room is never interrupted', (await Pb3.GS.review(Pb3.ctx, Pb3.deps)) === 'busy' && !$(Pb3, 'vpGs'));
  var Pf = oldVenue({ prefsReadFail: true });
  check('settings that cannot be read: nothing opens (it would show the wrong values)', (await Pf.GS.review(Pf.ctx, Pf.deps)) === 'none' && !$(Pf, 'vpGs'));
  var Pd = oldVenue({ drawsFail: true });
  check('members draws that cannot be read: nothing opens', (await Pd.GS.review(Pd.ctx, Pd.deps)) === 'none' && !$(Pd, 'vpGs'));

  /* remind me */
  P = oldVenue(); done = P.GS.review(P.ctx, P.deps); await settle();
  check('it opens with one screen in the round 11 words, never already filled in, "Not ready yet, remind me next time" and "Let\'s go" (Dean 10 Nov)', T(P, 'vpGsTitle') === 'Check your game set-up' && T(P, 'vpGsBody').indexOf('We have changed some settings within games. Click through now to review these, and change anything you like as you go.') === 0 && !/filled in|already/i.test(T(P, 'vpGsBody')) && T(P, 'vpGsReviewLater') === 'Not ready yet, remind me next time' && T(P, 'vpGsGo') === "Let's go" && /vpgs-outline/.test($(P, 'vpGsReviewLater').className));
  CALLS = []; $(P, 'vpGsReviewLater').click(); await settle();
  var loc = JSON.parse(STORE['vpGameSetup:V1'] || '{}');
  check('remind me: closed, nothing saved anywhere', (await done) === 'later' && !$(P, 'vpGs') && !posts('/host/').length && !SAVED.length);
  check('not asked again on this sign-in (4 hours)', loc.reviewLater === NOW + 4 * 3600 * 1000 && P.GS.wantsReview(P.ctx, P.deps.storage, NOW + 3600 * 1000) === false);
  check('asked again on the next sign-in', P.GS.wantsReview(P.ctx, P.deps.storage, NOW + 4 * 3600 * 1000 + 1) === true);

  /* click straight through: nothing changes */
  P = oldVenue(); done = P.GS.review(P.ctx, P.deps); await settle();
  $(P, 'vpGsGo').click(); await settle();
  check('their games already ticked from what they play (settings, nights played, a members draw)', ['trivia', 'musical', 'bingo', 'raffles', 'members'].every(function (g) { return gameBtn(P, g).getAttribute('aria-checked') === 'true'; }));
  check('pub or club left out, already known from their record (Dean, round 9 point 3)', !$(P, 'vpGsKind') && T(P, 'vpGsTitle') === 'What games do you play?');
  $(P, 'vpGsNext').click(); await settle(); passWeek(P, 'vpGsWeekSkip'); await settle();
  check('"Now let\'s check your games." with a Yes for each game, Not today keeps everything', T(P, 'vpGsTitle') === 'Now let\'s check your games.' && all($(P, 'vpGsGamePicks'), function (e) { return e.tagName === 'BUTTON' && e.getAttribute('data-game'); }).length === 5 && T(P, 'vpGsAllNote') === 'Not today keeps every setting as it is.');
  CALLS = []; $(P, 'vpGsAllYes').click(); await settle();
  check('trivia opens with THEIR settings: rounds 5, 15 a round, double points Yes with 5, 45 seconds, 200 points, their prize', $(P, 'vpGsIn_rounds').value === '5' && $(P, 'vpGsIn_count').value === '15' && row(P, 'double_points').children[2].children[0].children[0].getAttribute('aria-pressed') === 'true' && $(P, 'vpGsIn_double_last').value === '5' && $(P, 'vpGsIn_time_s').value === '45' && $(P, 'vpGsIn_base_points').value === '200' && $(P, 'vpGsIn_prizes_0').value === 'Bar tab', [$(P, 'vpGsIn_rounds').value, $(P, 'vpGsIn_double_last').value, $(P, 'vpGsIn_time_s').value]);
  check('it asks them to have a look through, and never says anything is already filled in (Dean, round 11 note 8)', T(P, 'vpGsLead') === 'Have a look through, and change anything you like.' && !/filled in|already/i.test(T(P, 'vpGsBody')));
  $(P, 'vpGsSave').click(); await settle();
  check('trivia, clicked through: nothing sent', posts('/host/game-prefs').length === 0, posts('/host/game-prefs').map(function (x) { return x.body; }));
  $(P, 'vpGsNextYes').click(); await settle();
  var mpick = all($(P, 'vpGsIn_playlists'), function (e) { return e.getAttribute && e.getAttribute('aria-checked') === 'true'; }).map(function (e) { return e.getAttribute('data-id'); });
  check('musical bingo opens with THEIR music, rounds, prizes, no-prize round and reveal', mpick.join() === '90s,aussie' && $(P, 'vpGsIn_rounds').value === '4' && $(P, 'vpGsNone_0').checked === true && $(P, 'vpGsIn_prizes_3').value === 'Tab' && $(P, 'vpGsIn_reveal').value === 'never', [mpick, $(P, 'vpGsIn_reveal').value]);
  $(P, 'vpGsSave').click(); await settle();
  check('musical bingo, clicked through: nothing sent', posts('/host/game-prefs').length === 0, posts('/host/game-prefs').map(function (x) { return x.body; }));
  $(P, 'vpGsNextYes').click(); await settle();
  check('bingo opens with THEIR tickets, games and prizes', $(P, 'vpGsIn_cards').value === '4' && $(P, 'vpGsIn_rounds').value === '3' && $(P, 'vpGsIn_round_prizes_2').value === 'C');
  $(P, 'vpGsSave').click(); await settle();
  check('bingo, clicked through: nothing sent', posts('/host/game-prefs').length === 0, posts('/host/game-prefs').map(function (x) { return x.body; }));
  $(P, 'vpGsNextYes').click(); await settle();
  check('raffles open with THEIR raffles, prizes and their own 240 seconds kept as a choice', $(P, 'vpGsIn_raffles').value === '2' && $(P, 'vpGsRafN_0').value === '2' && $(P, 'vpGsRafP_0_1').value === 'Fuel' && $(P, 'vpGsRafP_1_0').value === 'Hamper' && $(P, 'vpGsIn_time_to_present').value === '240');
  $(P, 'vpGsSave').click(); await settle();
  check('raffles, clicked through: nothing sent', posts('/host/game-prefs').length === 0, posts('/host/game-prefs').map(function (x) { return x.body; }));
  $(P, 'vpGsNextYes').click(); await settle();
  check('members draws open with THEIR draw: name, start date, 7:30pm, jackpot, growth', $(P, 'vpGsIn_name').value === 'Thursday Members Draw' && $(P, 'vpGsIn_date_started').value === '2025-03-06' && $(P, 'vpGsIn_draw_time').value === '19:30' && $(P, 'vpGsIn_current_jackpot_cents').value === '990' && $(P, 'vpGsIn_increment_cents').value === '25' && T(P, 'vpGsLead') === 'Your draw as it is today. Change anything you like.', [$(P, 'vpGsIn_draw_time').value, $(P, 'vpGsIn_current_jackpot_cents').value]);
  $(P, 'vpGsSave').click(); await settle();
  check('members draws, clicked through: nothing sent', posts('/host/members/settings').length === 0, posts('/host/members/settings').map(function (x) { return x.body; }));
  if ($(P, 'vpGsExtrasNo')) { $(P, 'vpGsExtrasNo').click(); await settle(); }
  check('the end: every game checked', T(P, 'vpGsTitle') === "You're ready for your week." && /Every game you play is checked/.test(T(P, 'vpGsBody')));
  check('their saved settings are exactly as they were', JSON.stringify(PREFS) === JSON.stringify(HAVE), PREFS);
  sa = lastAnswers();
  check('not asked again (setup_answers.review), and no game left to open its own setup', sa && sa.review === 'done' && JSON.stringify(sa.setup) === JSON.stringify({ trivia: 'done', musical: 'done', bingo: 'done', raffles: 'done', members: 'done' }), sa);
  $(P, 'vpGsDone').click(); await settle();
  check('Go to my console closes it', !$(P, 'vpGs') && (await done) === 'done');

  /* change one thing: only that is saved */
  P = oldVenue(); P.GS.review(P.ctx, P.deps); await settle();
  $(P, 'vpGsGo').click(); await settle(); $(P, 'vpGsNext').click(); await settle(); passWeek(P, 'vpGsWeekSkip'); await settle(); $(P, 'vpGsAllYes').click(); await settle();
  box(P, 'vpGsIn_rounds', 6);
  CALLS = []; $(P, 'vpGsSave').click(); await settle();
  check('one change, one key saved: { rounds: 6 }', JSON.stringify(lastPost('/host/game-prefs') && lastPost('/host/game-prefs').prefs) === '{"rounds":6}', lastPost('/host/game-prefs'));
  check('and the rest of their trivia settings untouched', PREFS.trivia.double_last === 5 && PREFS.trivia.time_s === 45 && PREFS.trivia.rounds === 6);
  walk($(P, 'vpGsGamePicks'), function (e) { return e.getAttribute && e.getAttribute('data-game') === 'members'; }).click(); await settle();
  box(P, 'vpGsIn_current_jackpot_cents', '1000');
  CALLS = []; $(P, 'vpGsSave').click(); await settle();
  check('members draw: only the jackpot sent, to THEIR draw by its id (never a second draw)', srtj(lastPost('/host/members/settings')) === srtj({ draw_id: 'D1', current_jackpot_cents: 100000 }), lastPost('/host/members/settings'));

  /* new settings stay off */
  P = oldVenue({ prefs: { trivia: { rounds: 3 } }, draws: [] }); P.GS.review(P.ctx, P.deps); await settle();
  $(P, 'vpGsGo').click(); await settle(); $(P, 'vpGsNext').click(); await settle(); passWeek(P, 'vpGsWeekSkip'); await settle(); $(P, 'vpGsAllYes').click(); await settle();
  CALLS = []; $(P, 'vpGsSave').click(); await settle();
  check('a setting the venue never had and did not touch (same prizes every week, double points) is never written: new settings stay off', posts('/host/game-prefs').length === 0 && JSON.stringify(PREFS.trivia) === '{"rounds":3}', PREFS.trivia);

  /* round 11 questions for an existing venue: pre-filled, only what changed is sent, a new one stays unsaved until touched */
  P = oldVenue(); P.GS.review(P.ctx, P.deps); await settle();
  $(P, 'vpGsGo').click(); await settle(); $(P, 'vpGsNext').click(); await settle(); passWeek(P, 'vpGsWeekSkip'); await settle(); $(P, 'vpGsAllYes').click(); await settle();
  check('existing venue: picture questions open ON (the default, never saved by them) with the plain ON line', /Picture questions are ON/.test(T(P, 'vpGsState_picture_round')));
  seg(P, 'picture_round', 'false');
  CALLS = []; $(P, 'vpGsSave').click(); await settle();
  check('existing venue: switching picture questions off sends only that: { picture_round: false }', JSON.stringify(lastPost('/host/game-prefs').prefs) === '{"picture_round":false}', lastPost('/host/game-prefs'));
  check('and the Worker keeps it', keptByWorker('trivia', { picture_round: false }));
  P = oldVenue(); P.GS.review(P.ctx, P.deps); await settle();
  $(P, 'vpGsGo').click(); await settle(); $(P, 'vpGsNext').click(); await settle(); passWeek(P, 'vpGsWeekSkip'); await settle(); $(P, 'vpGsAllYes').click(); await settle();
  seg(P, 'prize_weekly', 'false'); $(P, 'vpGsSwapAdd').click(); box(P, 'vpGsSwapWeek_0', '2026-11-25'); box(P, 'vpGsSwapP_0_0', 'Trip');
  CALLS = []; $(P, 'vpGsSave').click(); await settle();
  var swp = lastPost('/host/game-prefs').prefs;
  check('existing venue: not the same every week + a swapped week sends just those two', srtj(swp) === srtj({ prize_weekly: false, prize_swaps: [{ week: '2026-11-23', prizes: ['Trip', '', '', '', ''] }] }) && keptByWorker('trivia', swp), swp);
  P = oldVenue(); P.GS.review(P.ctx, P.deps); await settle();
  $(P, 'vpGsGo').click(); await settle(); $(P, 'vpGsNext').click(); await settle(); passWeek(P, 'vpGsWeekSkip'); await settle();
  $(P, 'vpGsAllYes_raffles').click(); await settle();
  box(P, 'vpGsRafName_0', 'Meat Raffle'); box(P, 'vpGsIn_draw_style', 'race');
  CALLS = []; $(P, 'vpGsSave').click(); await settle();
  var rsp = lastPost('/host/game-prefs').prefs;
  check('existing venue: naming a raffle and picking the race plate sends just raffle_names and draw_style', srtj(rsp) === srtj({ raffle_names: ['Meat Raffle', ''], draw_style: 'race' }) && keptByWorker('raffle', rsp), rsp);
  P = oldVenue(); P.GS.review(P.ctx, P.deps); await settle();
  $(P, 'vpGsGo').click(); await settle(); $(P, 'vpGsNext').click(); await settle(); passWeek(P, 'vpGsWeekSkip'); await settle();
  $(P, 'vpGsAllYes_members').click(); await settle();
  check('existing venue: their draw, with "Add another draw" offered', $(P, 'vpGsIn_name').value === 'Thursday Members Draw' && T(P, 'vpGsAddDraw') === 'Add another draw');
  CALLS = []; $(P, 'vpGsAddDraw').click(); await settle();
  check('Add another draw on an unchanged draw sends nothing for it and opens a blank draw', posts('/host/members/settings').length === 0 && $(P, 'vpGsIn_name').value === '' && /draw 2 of 2/.test(T(P, 'vpGsCount')));
  box(P, 'vpGsIn_name', 'Sunday Draw'); box(P, 'vpGsIn_draw_time', '17:00'); box(P, 'vpGsIn_current_jackpot_cents', '200');
  CALLS = []; $(P, 'vpGsSave').click(); await settle();
  check('the new draw is sent whole, with no draw_id, so it is a new draw and Thursday\'s is untouched', srtj(lastPost('/host/members/settings')) === srtj({ venue_id: 'V1', name: 'Sunday Draw', draw_time: '5pm', current_jackpot_cents: 20000, draw_day: 'Thursday' }) || (lastPost('/host/members/settings') && !('draw_id' in lastPost('/host/members/settings')) && lastPost('/host/members/settings').name === 'Sunday Draw'), lastPost('/host/members/settings'));
  /* the email reminder, and No thanks */
  P = page({ answers: { games: ['members'] } }); P.GS.run(P.ctx, Object.assign(P.deps, { start: 'pick' })); await settle();
  $(P, 'vpGsNext').click(); await settle(); passWeek(P, 'vpGsWeekSkip'); await settle(); $(P, 'vpGsAllYes').click(); await settle();
  box(P, 'vpGsIn_name', 'Friday Draw'); $(P, 'vpGsSave').click(); await settle();
  chip2(P, 'vpGsRemind', 'email').click(); box(P, 'vpGsRemindDay', 'sat'); box(P, 'vpGsRemindTime', '10:30');
  check('email reminder: no calendar link, the day and time shown', $(P, 'vpGsRemindCal').style.display === 'none' && $(P, 'vpGsRemindWhen').style.display === '');
  $(P, 'vpGsExtrasNo').click(); await settle();
  check('email reminder saved: { how: email, day: sat, time: 10:30 }', JSON.stringify(lastAnswers().members_reminder) === JSON.stringify({ how: 'email', day: 'sat', time: '10:30', since: P.GS.brisbaneDate(NOW) }), lastAnswers());
  check('and setup_answers keeps it after a clean (vp-firstrun cleans through cleanExtra)', JSON.stringify(P.GS.cleanExtra({ members_reminder: { how: 'email', day: 'sat', time: '10:30' } }, {}).members_reminder) === '{"how":"email","day":"sat","time":"10:30"}' && P.GS.cleanExtra({ members_reminder: { how: 'email', day: 'sat', time: '10:30', since: '2026-11-10' } }, {}).members_reminder.since === '2026-11-10' && !P.GS.cleanExtra({ members_reminder: { how: 'email', day: 'sat', time: '10:30', since: 'x' } }, {}).members_reminder.since && !P.GS.cleanExtra({ members_reminder: { how: 'sms', day: 'sat' } }, {}).members_reminder);
  P = page({ answers: { games: ['members'], members_reminder: { how: 'calendar', day: 'tue', time: '08:00' } } }); P.GS.run(P.ctx, Object.assign(P.deps, { start: 'pick' })); await settle();
  $(P, 'vpGsNext').click(); await settle(); passWeek(P, 'vpGsWeekSkip'); await settle(); $(P, 'vpGsAllYes').click(); await settle();
  box(P, 'vpGsIn_name', 'Friday Draw'); $(P, 'vpGsSave').click(); await settle();
  check('a venue that already chose a reminder sees it again, ticked', chip2(P, 'vpGsRemind', 'calendar').getAttribute('aria-pressed') === 'true' && $(P, 'vpGsRemindDay').value === 'tue');
  chip2(P, 'vpGsRemind', 'none').click(); $(P, 'vpGsExtrasNo').click(); await settle();
  check('No thanks removes the reminder', !('members_reminder' in lastAnswers()), lastAnswers());

  /* Not today and Close write nothing for an existing venue */
  P = oldVenue(); done = P.GS.review(P.ctx, P.deps); await settle();
  $(P, 'vpGsGo').click(); await settle(); $(P, 'vpGsNext').click(); await settle(); passWeek(P, 'vpGsWeekSkip'); await settle();
  CALLS = []; $(P, 'vpGsAllNo').click(); await settle();
  check('Not today (a dismiss): "Everything stays as it is", no defaults written, and it is NOT asked again (setup_reviewed = dismissed, Dean 10 Nov)', /Everything stays as it is\. We won't ask again/.test(T(P, 'vpGsNoWorries')) && posts('/host/game-prefs').length === 0 && JSON.stringify(PREFS) === JSON.stringify(HAVE) && lastAnswers().setup_reviewed.how === 'dismissed' && lastAnswers().setup_reviewed.at === P.GS.brisbaneDate(NOW) && !JSON.parse(STORE['vpGameSetup:V1']).reviewLater);
  P = oldVenue(); done = P.GS.review(P.ctx, P.deps); await settle();
  $(P, 'vpGsGo').click(); await settle();
  CALLS = []; $(P, 'vpGsClose').click(); await settle();
  check('Close part way: nothing written, no game marked for its own setup, asked again next sign-in', (await done) === 'closed' && posts('/host/game-prefs').length === 0 && !(lastAnswers() && lastAnswers().setup) && JSON.parse(STORE['vpGameSetup:V1']).reviewLater > NOW);

  section('3. DEAN\'S OTHER ROUND 9 NOTES');
  P = page({ answers: { games: ['members'] } }); P.GS.run(P.ctx, Object.assign(P.deps, { start: 'pick' })); await settle();
  $(P, 'vpGsNext').click(); await settle(); passWeek(P, 'vpGsWeekSkip'); await settle(); $(P, 'vpGsAllNo').click(); await settle();
  check('members draws only, Not today: "We\'ll remind you when you\'re ready for members draws." (Dean, round 9 point 21)', T(P, 'vpGsNoWorries') === "We'll remind you when you're ready for members draws." && !$(P, 'vpGsMembersNote'), T(P, 'vpGsNoWorries'));
  check('and the advertising prompt there too (point 23)', !!$(P, 'vpGsAdvert'));
  P = page({ answers: { games: ['trivia'] } }); P.GS.run(P.ctx, Object.assign(P.deps, { start: 'pick' })); await settle();
  $(P, 'vpGsNext').click(); await settle(); passWeek(P, 'vpGsWeekSkip'); await settle(); $(P, 'vpGsAllYes').click(); await settle();
  var adv = $(P, 'vpGsAdvanced'); walk(adv, function (e) { return e.className === 'vpgs-sech'; }).click();
  check('More settings opens from anywhere on its line, not only the small button (Dean, round 9 point 16)', !/folded/.test(adv.className) && $(P, 'vpGsAdvToggle').getAttribute('aria-expanded') === 'true');
  P = page({ venue: { entity_type: null, venue_type: 'Hotel' } }); P.GS.run(P.ctx, Object.assign(P.deps, { start: 'pick' })); await settle();
  check('the website scan\'s venue type, when it lands, answers pub or club and the question is left out (Dean, round 9 point 3)', !$(P, 'vpGsKind') && T(P, 'vpGsTitle') === 'What games do you play?');
  check('the speakers guide says first that the TV\'s own speakers already play it (Dean, round 9 point 18)', /Your TV's own speakers already play it through the HDMI cable\. This guide is for venues whose sound runs through a separate amp or PA\./.test(SOUND) && /separate amp or PA/.test(P.H.byKey('musical').settings.filter(function (s) { return s.key === 'sound'; })[0].help));
  check('the logo a touch bigger (Dean, round 9 point 2) and the step line in sentence case, no spaced capitals', /\.vpgs-logo\{display:block;height:26px/.test(GS) && !/vpgs-count\{[^}]*letter-spacing/.test(GS) && !/vpgs-count\{[^}]*uppercase/.test(GS));

  section('4. THE MEMBERS LIST: WHICH COLUMN IS WHICH (Dean, round 9 point 24)');
  /* the file reading moved to venueplay/app/vp-memberscsv.js in round 12; tools/test-members-csv.js runs it on real messy files. Here: the old shapes still read, through the same module. */
  var TDsrc = typeof TextDecoder;
  if (typeof TextDecoder === 'undefined') this.TextDecoder = function (enc, o) { this.enc = String(enc).toLowerCase(); this.fatal = !!(o && o.fatal); };
  if (!this.TextDecoder.prototype.decode) this.TextDecoder.prototype.decode = function (u) {
    var out = '', i = 0, e = this.enc;
    if (e === 'utf-16le' || e === 'utf-16be') { for (; i + 1 < u.length; i += 2) out += String.fromCharCode(e === 'utf-16le' ? u[i] | (u[i + 1] << 8) : (u[i] << 8) | u[i + 1]); return out; }
    if (e === 'utf-8') { while (i < u.length) { var c = u[i++]; if (c < 128) out += String.fromCharCode(c); else if (c >= 194 && c < 224 && (u[i] & 192) === 128) out += String.fromCharCode(((c & 31) << 6) | (u[i++] & 63)); else if (this.fatal) throw new TypeError('invalid utf-8'); else out += '\ufffd'; } return out; }
    for (; i < u.length; i++) out += String.fromCharCode(u[i]); return out;
  };
  var CSVW = {}; (new Function('window', readFile('venueplay/app/vp-memberscsv.js')))(CSVW);
  var CSV = CSVW.VPMembersCsv;
  function guessAll(file) { return CSV.read(file).lines; }
  var file = 'Surname,Given name,Member No,Joined\nSmith,Jane,142,2020\n"Nguyen, Jr",Sam,143,2021\nBrown,Al,,2022\n';
  var pl = CSV.read(file).plan;
  check('a club system\'s columns guessed: member number, first name, last name', pl.ix.number === 2 && pl.ix.first === 1 && pl.ix.last === 0, pl.ix);
  check('the box filled as "number, first last", the header and a row with no number left out, a comma in a name never splits it', JSON.stringify(guessAll(file)) === JSON.stringify(['142, Jane Smith', '143, Sam Nguyen Jr']), guessAll(file));
  var rowsX = CSV.parse(file);
  check('a different pick is what is used (the venue decides)', JSON.stringify(CSV.build(rowsX, { number: 2, first: 0, last: -1 }, 1).lines) === JSON.stringify(['142, Smith', '143, Nguyen Jr']));
  check('the billing page shows the column picker for an uploaded CSV', /csvMatch\(typeof buf === "string" \? buf : VPMembersCsv\.decode\(buf\)\)/.test(BILL) && /id="md-match"/.test(BILL) && /\$\("md-csv"\)\.addEventListener\("change"[\s\S]{0,200}csvFile\(f\)/.test(BILL));
  var good = ['142, Jane Smith', '143, Sam Taylor'];
  check('CAUSE 1: Excel on a Mac ends every line with a bare CR. Now read', JSON.stringify(guessAll('Member No,First Name,Surname\r142,Jane,Smith\r143,Sam,Taylor\r')) === JSON.stringify(good));
  check('CAUSE 2: a semicolon separated file is read', JSON.stringify(guessAll('Member No;First Name;Surname\n142;Jane;Smith\n143;Sam;Taylor\n')) === JSON.stringify(good));
  check('a tab, a pipe and a CRLF file with a BOM are read', JSON.stringify(guessAll('Member No\tFirst Name\tSurname\n142\tJane\tSmith\n143\tSam\tTaylor')) === JSON.stringify(good) && JSON.stringify(guessAll('Member No|First Name|Surname\n142|Jane|Smith\n143|Sam|Taylor')) === JSON.stringify(good) && JSON.stringify(guessAll('\ufeffMember No,First Name,Surname\r\n142,Jane,Smith\r\n143,Sam,Taylor\r\n')) === JSON.stringify(good));
  check('a comma inside quotes still never splits (a semicolon file with "Smith, Jr")', JSON.stringify(guessAll('Member No;First Name;Surname\n142;Jane;"Smith, Jr"\n')) === JSON.stringify(['142, Jane Smith Jr']));
  function bytes(arr) { var b = new Uint8Array(arr.length); for (var i = 0; i < arr.length; i++) b[i] = arr[i]; return b.buffer; }
  function utf16(str, be) { var a = be ? [0xFE, 0xFF] : [0xFF, 0xFE]; for (var i = 0; i < str.length; i++) { var c = str.charCodeAt(i); if (be) a.push(c >> 8, c & 255); else a.push(c & 255, c >> 8); } return bytes(a); }
  var txt = 'Member No\tFirst Name\tSurname\r\n142\tJane\tSmith\r\n143\tSam\tTaylor\r\n';
  check('CAUSE 3: Excel "Unicode Text" is UTF-16 (little or big endian); it is decoded and read', JSON.stringify(guessAll(CSV.decode(utf16(txt, false)))) === JSON.stringify(good) && JSON.stringify(guessAll(CSV.decode(utf16(txt, true)))) === JSON.stringify(good));
  var latin = bytes([77, 101, 109, 98, 101, 114, 44, 78, 97, 109, 101, 10, 49, 52, 50, 44, 74, 111, 115, 233, 10]);
  check('a Windows (Latin-1) file with a name like José is read, not dropped', JSON.stringify(guessAll(CSV.decode(latin))) === JSON.stringify(['142, José']), guessAll(CSV.decode(latin)));
  check('the delimiter is worked out from the lines', CSV.delim('a;b;c') === ';' && CSV.delim('a,b,c') === ',' && CSV.delim('a\tb') === '\t' && CSV.delim('"a;b",c,d') === ',');
  var upAt = BILL.indexOf('id="md-csvbtn"'), pasteAt = BILL.indexOf('id="md-import"'), matchAt = BILL.indexOf('id="md-match"');
  check('UPLOAD FIRST: the Choose a CSV file button comes before the paste box, and the column question comes after the choice (Dean, round 11 note 7)', upAt > 0 && upAt < matchAt && matchAt < pasteAt && /Choose a CSV file<\/button>/.test(BILL) && /Which column is which\?/.test(BILL));
  check('an Excel .xlsx file gets a plain "Save As CSV" message, and a file that cannot be read says so, next to the button', /That is an Excel file\. In Excel choose File, Save As, then CSV/.test(BILL) && /reader\.onerror = function\(\)\{ csvSay\(/.test(BILL) && /id="md-csvmsg"/.test(BILL));

  section('5. MUSICAL BINGO TV: "ONLY IN THE PLAYED-SONGS LIST" (Dean, round 9 point 25)');
  var stSrc = MSCREEN.slice(MSCREEN.indexOf('  function lastRevealMode'), MSCREEN.indexOf('\n', MSCREEN.indexOf('  function lastRevealMode')));
  var mem = {};
  var LR = (new Function('localStorage', 'var _revealMode="legacy";' + stSrc + '; return { get: lastRevealMode, set: function (m) { _revealMode = m; } };'))({ getItem: function (k) { return mem[k] || null; }, setItem: function (k, v) { mem[k] = v; } });
  mem.vpMusRevealMode = 'never';
  check('a TV that reloads mid-song still knows the venue reveals only in the played list', LR.get() === 'never');
  var stateBranch = MSCREEN.slice(MSCREEN.indexOf('if(_pendingSong){\n            $("tvNowEye")'), MSCREEN.indexOf('renderRun();', MSCREEN.indexOf('if(_pendingSong){\n            $("tvNowEye")')));
  check('so its state refresh never prints the title in the now-playing panel then', /lastRevealMode\(\)==="never"\)\{[\s\S]*tvListen"\)\.classList\.remove\("hidden"\)/.test(stateBranch) && stateBranch.indexOf('lastRevealMode()==="never"') < stateBranch.indexOf('$("tvNowTitle").textContent=t'));

  /* 5b. HIDDEN FOR NOW (Dean, 10 Nov): nothing a venue answers does nothing. Picture questions, prize swaps, raffle names, the draw style and the
     email reminder are not asked until the games use them; the keys, the saving and the checks above stay for later. */
  section('5b. HIDDEN UNTIL THE GAMES USE THEM');
  UNHIDE = false;
  P = oldVenue(); P.GS.review(P.ctx, P.deps); await settle();
  $(P, 'vpGsGo').click(); await settle(); $(P, 'vpGsNext').click(); await settle(); passWeek(P, 'vpGsWeekSkip'); await settle(); $(P, 'vpGsAllYes').click(); await settle();
  check('hidden: trivia no longer asks picture questions', !row(P, 'picture_round') && !$(P, 'vpGsState_picture_round') && !!row(P, 'double_points'));
  seg(P, 'prize_weekly', 'false');
  check('hidden: trivia, not the same every week, offers no prize swap', !row(P, 'prize_swaps') && !$(P, 'vpGsSwapAdd'));
  P = oldVenue(); P.GS.review(P.ctx, P.deps); await settle();
  $(P, 'vpGsGo').click(); await settle(); $(P, 'vpGsNext').click(); await settle(); passWeek(P, 'vpGsWeekSkip'); await settle();
  $(P, 'vpGsAllYes_raffles').click(); await settle();
  check('hidden: raffles ask no draw style, still ask the prizes, and DO ask each raffle\'s name now (Dean, round 12 note 7)', !!$(P, 'vpGsRafName_0') && !row(P, 'draw_style') && !$(P, 'vpGsIn_draw_style') && !!$(P, 'vpGsRafP_0_0'));
  rafWeekly(P, 0, 'false');
  check('hidden: raffles, not the same every week, offer no prize swap', !row(P, 'prize_swaps') && !$(P, 'vpGsSwapAdd'));
  P = page({ answers: { games: ['members'] } }); P.GS.run(P.ctx, Object.assign(P.deps, { start: 'pick' })); await settle();
  $(P, 'vpGsNext').click(); await settle(); passWeek(P, 'vpGsWeekSkip'); await settle(); $(P, 'vpGsAllYes').click(); await settle();
  box(P, 'vpGsIn_name', 'Friday Draw'); $(P, 'vpGsSave').click(); await settle();
  check('the members list reminder offers Email me, the calendar and No thanks (Dean, round 12 note 9: a real sender exists now)', !!chip2(P, 'vpGsRemind', 'email') && !!chip2(P, 'vpGsRemind', 'calendar') && !!chip2(P, 'vpGsRemind', 'none'));
  P = page({ answers: { games: ['members'], members_reminder: { how: 'email', day: 'sat', time: '10:30' } } }); P.GS.run(P.ctx, Object.assign(P.deps, { start: 'pick' })); await settle();
  $(P, 'vpGsNext').click(); await settle(); passWeek(P, 'vpGsWeekSkip'); await settle(); $(P, 'vpGsAllYes').click(); await settle();
  box(P, 'vpGsIn_name', 'Friday Draw'); $(P, 'vpGsSave').click(); await settle();
  $(P, 'vpGsExtrasNo').click(); await settle();
  check('an earlier email choice is kept, and gets today as its "since" so the sender\'s first email is after today', JSON.stringify(lastAnswers().members_reminder) === JSON.stringify({ how: 'email', day: 'sat', time: '10:30', since: P.GS.brisbaneDate(NOW) }), lastAnswers());
  P = oldVenue(); 
  check('hidden: the keys and defaults are still there for later (picture_round on, draw_style the ticket roll)', P.H.byKey('trivia').settings.some(function (x) { return x.key === 'picture_round' && x.def === true && x.notYet; }) && P.H.byKey('raffles').settings.some(function (x) { return x.key === 'draw_style' && x.def === 'ticket' && x.notYet; }) && WK.clean('trivia', { picture_round: false }).picture_round === false && WK.clean('raffle', { draw_style: 'race' }).draw_style === 'race' && WK.clean('raffle', { draw_style: 'wheel' }).draw_style === undefined);
  UNHIDE = true;

  section('7. ROUND 12 (Dean, 10 Nov 2026, INBOX 118): THE TEN NOTES');
  function typeOther(P, text) { var i = $(P, 'vpGsOther'); i.value = text; (i.handlers.input || []).forEach(function (f) { f(); }); i.handlers.keydown.forEach(function (f) { f({ key: 'Enter', preventDefault: function () {} }); }); }
  function dayBtn(P, key, d) { return walk(walk($(P, 'vpGsWeek'), function (e) { return e.getAttribute && e.getAttribute('data-game') === key; }), function (e) { return e.getAttribute && e.getAttribute('data-day') === d; }); }
  /* NOTE 1: "Wednesday steak night" is a name and a day */
  P = page({ answers: { games: ['trivia'] } }); P.GS.run(P.ctx, Object.assign(P.deps, { start: 'pick' })); await settle();
  typeOther(P, 'Wednesday steak night');
  check('note 1: the name is "Steak night" (the day words are taken out) and the tag shows its day', tagsOf(P, 'x').length === 0 && walk($(P, 'vpGsOtherList'), function (e) { return e.getAttribute && e.getAttribute('data-other') === 'Steak night'; }) && /Wed/.test(seen($(P, 'vpGsOtherList'))), seen($(P, 'vpGsOtherList')));
  $(P, 'vpGsNext').click(); await settle();
  check('note 1: the next step asks the day, already ticked from what they typed (Wednesday), the time still to give', dayBtn(P, 'other:steak night', 'wed').getAttribute('aria-pressed') === 'true' && dayBtn(P, 'other:steak night', 'thu').getAttribute('aria-pressed') === 'false' && !!$(P, 'vpGsWeekNext') && $(P, 'vpGsWeekNext').disabled === true);
  check('note 1: and it is already kept in the venue\'s answers (the day they typed is an answer)', JSON.stringify(lastAnswers().week) === JSON.stringify([{ day: 'wed', games: [{ game: 'other', name: 'Steak night' }] }]) && lastAnswers().other === 'Steak night', lastAnswers());
  check('note 1: the name is a box they can edit on this step', !!$(P, 'vpGsRename_1') && $(P, 'vpGsRename_1').value === 'Steak night');
  box(P, 'vpGsRename_1', 'Parma night'); box(P, 'vpGsTime_other:parma night_wed', '18:00'); dayBtn(P, 'other:parma night', 'fri').click(); box(P, 'vpGsTime_other:parma night_fri', '18:30');
  passWeek(P, 'vpGsWeekNext'); await settle();
  check('note 1: renamed and given another day: saved as Parma night on Wednesday and Friday with their times, and the other-nights answer follows the new name', JSON.stringify(lastAnswers().week) === JSON.stringify([{ day: 'wed', games: [{ game: 'other', name: 'Parma night', start: '18:00' }] }, { day: 'fri', games: [{ game: 'other', name: 'Parma night', start: '18:30' }] }]) && lastAnswers().other === 'Parma night', lastAnswers());
  P = page({ answers: { games: ['trivia'] } }); P.GS.run(P.ctx, Object.assign(P.deps, { start: 'pick' })); await settle();
  typeOther(P, 'Karaoke Fri and Sat'); typeOther(P, 'Steak night every Wednesday'); typeOther(P, 'Wednesday');
  check('note 1: "Karaoke Fri and Sat" is Karaoke on Friday and Saturday, "Steak night every Wednesday" is Steak night, and a lone "Wednesday" is just kept as typed', JSON.stringify(P.GS.cleanOther('x')) !== '' && walk($(P, 'vpGsOtherList'), function (e) { return e.getAttribute && e.getAttribute('data-other') === 'Karaoke'; }) && /Fri Sat/.test(seen($(P, 'vpGsOtherList'))) && !!walk($(P, 'vpGsOtherList'), function (e) { return e.getAttribute && e.getAttribute('data-other') === 'Steak night'; }) && !!walk($(P, 'vpGsOtherList'), function (e) { return e.getAttribute && e.getAttribute('data-other') === 'Wednesday'; }), seen($(P, 'vpGsOtherList')));
  $(P, 'vpGsNext').click(); await settle();
  check('note 1: Karaoke is ticked on Friday and Saturday, Steak night on Wednesday', dayBtn(P, 'other:karaoke', 'fri').getAttribute('aria-pressed') === 'true' && dayBtn(P, 'other:karaoke', 'sat').getAttribute('aria-pressed') === 'true' && dayBtn(P, 'other:steak night', 'wed').getAttribute('aria-pressed') === 'true' && dayBtn(P, 'other:wednesday', 'wed').getAttribute('aria-pressed') === 'false');
  P = page({ answers: { games: ['trivia'] } }); P.GS.run(P.ctx, Object.assign(P.deps, { start: 'pick' })); await settle();
  var oi0 = $(P, 'vpGsOther'); oi0.value = 'wednesday steak'; oi0.handlers.input.forEach(function (f) { f(); }); var sg = walk($(P, 'vpGsOtherSuggest'), function (e) { return e.getAttribute && e.getAttribute('data-other') === 'Steak night'; });
  check('note 1: typing "wednesday steak" still suggests Steak night (the day is left out of the match)', !!sg);
  P = page({ answers: { games: ['trivia'] } }); P.GS.run(P.ctx, Object.assign(P.deps, { start: 'pick' })); await settle();
  var oi = $(P, 'vpGsOther'); oi.value = 'Wed steak'; oi.handlers.input.forEach(function (f) { f(); });
  var sg2 = walk($(P, 'vpGsOtherSuggest'), function (e) { return e.getAttribute && e.getAttribute('data-other') === 'Steak night'; }); sg2.click();
  check('note 1: tapping that suggestion keeps the day they typed', /Wed/.test(seen($(P, 'vpGsOtherList'))) && !!walk($(P, 'vpGsOtherList'), function (e) { return e.getAttribute && e.getAttribute('data-other') === 'Steak night'; }));
  /* NOTE 2: the games question */
  P = page({ answers: { games: ['trivia', 'musical'] } }); P.GS.run(P.ctx, Object.assign(P.deps, { start: 'pick' })); await settle();
  $(P, 'vpGsNext').click(); await settle(); passWeek(P, 'vpGsWeekSkip'); await settle();
  check('note 2: the games question says "Now let\'s set up your games." (not a game; the nights and What\'s on were the step before)', T(P, 'vpGsTitle') === 'Now let\'s set up your games.');
  /* NOTES 3, 4, 5: trivia, then musical bingo */
  $(P, 'vpGsAllYes').click(); await settle();
  check('note 3: trivia asks "Same prizes every week?"', /Same prizes every week\?/.test(seen(row(P, 'prize_weekly'))) && !/Same every week\?/.test(seen($(P, 'vpGsBody'))));
  check('note 3: under More settings, one line: "We\'ll use our defaults for now. You can change these any time in each game."', T(P, 'vpGsAdvDefaults') === 'We\'ll use our defaults for now. You can change these any time in each game.');
  box(P, 'vpGsIn_rounds', 2); box(P, 'vpGsIn_prizes_0', 'Meat tray'); box(P, 'vpGsIn_prizes_1', '$50 bar tab');
  CALLS = []; $(P, 'vpGsSave').click(); await settle();
  $(P, 'vpGsNextYes').click(); await settle();
  var mi = $(P, 'vpGsIn_prizes_0'); mi.value = 'me'; (mi.handlers.input || []).forEach(function (f) { f(); });
  var sug = all($(P, 'vpGsBody'), function (e) { return e.getAttribute && e.getAttribute('data-suggest') != null; });
  check('note 4: typing "me" in musical bingo\'s prize box suggests "Meat tray" from the trivia prizes (one shared list)', sug.length === 1 && sug[0].getAttribute('data-suggest') === 'Meat tray', sug.map(function (x) { return x.getAttribute('data-suggest'); }));
  sug[0].click();
  check('note 4: a tap fills the box and clears the suggestion', $(P, 'vpGsIn_prizes_0').value === 'Meat tray' && all($(P, 'vpGsBody'), function (e) { return e.getAttribute && e.getAttribute('data-suggest') != null; }).length === 0);
  var mi2 = $(P, 'vpGsIn_prizes_1'); mi2.value = 'bar'; (mi2.handlers.input || []).forEach(function (f) { f(); });
  check('note 4: and "bar" finds "$50 bar tab"; a word that matches nothing suggests nothing', all($(P, 'vpGsBody'), function (e) { return e.getAttribute && e.getAttribute('data-suggest') === '$50 bar tab'; }).length === 1);
  mi2.value = 'zzz'; (mi2.handlers.input || []).forEach(function (f) { f(); });
  check('note 4: nothing for "zzz"', all($(P, 'vpGsBody'), function (e) { return e.getAttribute && e.getAttribute('data-suggest') != null; }).length === 0);
  check('note 5: musical bingo\'s "Rounds a night" sits in the LEFT half of its own line (a half-width line, so another field can sit beside it)', /vpgs-pairs/.test(pairOf(P, 'rounds').className) && /half/.test(pairOf(P, 'rounds').className) && pairOf(P, 'rounds').getAttribute('data-half') === '1');
  /* the venue's own list in the prize bank is kept to 24 and searched */
  check('note 4: the shared list is the venue\'s own (setup_answers.prize_bank, up to 24)', lastAnswers() && lastAnswers().prize_bank.join() === 'Meat tray,$50 bar tab', lastAnswers() && lastAnswers().prize_bank);
  /* an existing venue: what its games already hold feeds the suggestions */
  P = oldVenue(); P.GS.review(P.ctx, P.deps); await settle();
  $(P, 'vpGsGo').click(); await settle(); $(P, 'vpGsNext').click(); await settle(); passWeek(P, 'vpGsWeekSkip'); await settle(); $(P, 'vpGsAllYes_musical').click(); await settle();
  var held = (HAVE.trivia && (HAVE.trivia.prizes || HAVE.trivia.prize_list) || []).filter(function (x) { return x; })[0];
  check('note 4: an existing venue is offered the prizes its trivia already holds, as one tap', !held || !!walk($(P, 'vpGsBody'), function (e) { return e.getAttribute && e.getAttribute('data-item') === held; }), held);
  /* NOTE 6: bingo games and tickets */
  P = page({ answers: { games: ['bingo'] } }); P.GS.run(P.ctx, Object.assign(P.deps, { start: 'pick' })); await settle();
  $(P, 'vpGsNext').click(); await settle(); passWeek(P, 'vpGsWeekSkip'); await settle(); $(P, 'vpGsAllYes').click(); await settle();
  check('note 6: bingo\'s "Games a night" and "Tickets per player" are on the SAME line', pairOf(P, 'rounds') === pairOf(P, 'cards') && /vpgs-pairs/.test(pairOf(P, 'cards').className));
  /* NOTE 7: raffles */
  P = page({ answers: { games: ['raffles'] } }); P.GS.run(P.ctx, Object.assign(P.deps, { start: 'pick' })); await settle();
  $(P, 'vpGsNext').click(); await settle(); passWeek(P, 'vpGsWeekSkip'); await settle(); $(P, 'vpGsAllYes').click(); await settle();
  check('note 7: "How many raffles do you run?" (not "raffles a night"), in the left half', /How many raffles do you run\?/.test(seen(row(P, 'raffles'))) && !/Raffles a night/i.test(seen($(P, 'vpGsBody'))) && /half/.test(pairOf(P, 'raffles').className));
  box(P, 'vpGsIn_raffles', 2);
  check('note 7: each raffle has a name or night box ("Friday raffle"), then ONE line: how many prizes + same prizes every week or draw', !!$(P, 'vpGsRafName_0') && $(P, 'vpGsRafName_0').placeholder === 'e.g. Friday raffle' && !!$(P, 'vpGsRafName_1') && /vpgs-pairs/.test($(P, 'vpGsRafN_0').parentNode.parentNode.parentNode.className) && $(P, 'vpGsRafN_0').parentNode.parentNode.parentNode === $(P, 'vpGsRafWeekly_0').parentNode.parentNode.parentNode && /Same prizes every week or draw\?/.test(seen($(P, 'vpGsRafWeekly_0').parentNode.parentNode)));
  check('note 7: the old global "Same prizes every week?" row is gone (it is asked inside each raffle)', !row(P, 'prizes_weekly'));
  var tp = row(P, 'time_to_present');
  check('note 7: "How long do winners have to claim?" has a "No time limit" option (saved as 0)', /How long do winners have to claim\?/.test(seen(tp)) && $(P, 'vpGsIn_time_to_present').children.some(function (o) { return o.textContent === 'No time limit' && o.value === '0'; }));
  box(P, 'vpGsRafName_0', 'Friday raffle'); box(P, 'vpGsRafName_1', 'Sunday raffle'); box(P, 'vpGsRafN_1', 3); chip(P, 'vpGsRafSame_1', 'data-value', 'false');
  box(P, 'vpGsRafP_1_0', 'Meat tray'); box(P, 'vpGsRafP_1_1', 'Hamper'); box(P, 'vpGsRafP_1_2', "Winner's choice");
  check('note 7: "Winner\'s choice" typed as one prize makes EVERY prize slot of that raffle winner\'s choice', $(P, 'vpGsRafP_1_0').value === "Winner's choice" && !$(P, 'vpGsRafP_1_1'), $(P, 'vpGsRafP_1_0') && $(P, 'vpGsRafP_1_0').value);
  rafWeekly(P, 0, 'false'); box(P, 'vpGsRafP_0_0', 'Voucher'); box(P, 'vpGsIn_time_to_present', 0);
  CALLS = []; $(P, 'vpGsSave').click(); await settle();
  var rp2 = lastPost('/host/game-prefs');
  check('note 7: saved: raffle names, raffle_weekly per raffle, prizes_weekly false while any is not weekly, claim time 0, and the Worker keeps every key', rp2 && JSON.stringify(rp2.prefs.raffle_names) === '["Friday raffle","Sunday raffle"]' && JSON.stringify(rp2.prefs.raffle_weekly) === '[false,true]' && rp2.prefs.prizes_weekly === false && rp2.prefs.time_to_present === 0 && JSON.stringify(rp2.prefs.raffle_prizes) === '[["Voucher"],["Winner\'s choice","Winner\'s choice","Winner\'s choice"]]' && keptByWorker('raffle', rp2.prefs), rp2 && rp2.prefs);
  check('note 7: the Worker keeps raffle_weekly as true/false only', JSON.stringify(WK.clean('raffle', { raffle_weekly: [true, 'x', false] }).raffle_weekly) === '[true,false]' && WK.clean('raffle', { raffle_weekly: 'no' }).raffle_weekly === undefined);
  /* an existing venue's raffle: weekly comes from prizes_weekly when raffle_weekly was never saved, and clicking through sends nothing */
  P = oldVenue({ prefs: Object.assign(JSON.parse(JSON.stringify(HAVE)), { raffle: Object.assign({}, HAVE.raffle, { prizes_weekly: false }) }) }); P.GS.review(P.ctx, P.deps); await settle();
  $(P, 'vpGsGo').click(); await settle(); $(P, 'vpGsNext').click(); await settle(); passWeek(P, 'vpGsWeekSkip'); await settle(); $(P, 'vpGsAllYes_raffles').click(); await settle();
  check('note 7: an existing venue that said "not the same every week" sees No on each raffle', $(P, 'vpGsRafWeekly_0').children.filter(function (b) { return b.getAttribute('aria-pressed') === 'true'; })[0].getAttribute('data-value') === 'false');
  CALLS = []; $(P, 'vpGsSave').click(); await settle();
  check('note 7: and clicking straight through sends nothing at all', posts('/host/game-prefs').length === 0, posts('/host/game-prefs').map(function (c) { return c.body; }));
  /* NOTE 8: members draw */
  P = page({ answers: { games: ['members'] }, venue: { au_state: 'NSW' } }); P.GS.run(P.ctx, Object.assign(P.deps, { start: 'pick' })); await settle();
  $(P, 'vpGsNext').click(); await settle(); passWeek(P, 'vpGsWeekSkip'); await settle(); $(P, 'vpGsAllYes').click(); await settle();
  check('note 8: "Starting jackpot" and "Maximum jackpot" on one line', pairOf(P, 'starting_amount_cents') === pairOf(P, 'max_jackpot_cents') && /Starting jackpot/.test(seen(row(P, 'starting_amount_cents'))) && /Maximum jackpot/.test(seen(row(P, 'max_jackpot_cents'))));
  check('note 8: in NSW the maximum\'s box shows the state\'s own limit from VPGaming (7,000), and its ? says why', $(P, 'vpGsIn_max_jackpot_cents').placeholder === 'Limit 7,000' && /NSW progressive lottery/.test(seen($(P, 'vpGsHelp_max_jackpot_cents'))), $(P, 'vpGsIn_max_jackpot_cents').placeholder);
  var lim = {}; ['QLD', 'VIC', 'WA', 'ACT', 'TAS', 'SA', 'NT'].forEach(function (st) { var Q = page({ answers: { games: ['members'] }, venue: { au_state: st } }); lim[st] = Q.W.VPGaming.jackpotLimit({ state: st, entityType: 'for_profit', format: 'members' }).cents; });
  P = page({ answers: { games: ['members'] }, venue: { au_state: 'QLD' } }); P.GS.run(P.ctx, Object.assign(P.deps, { start: 'pick' })); await settle();
  $(P, 'vpGsNext').click(); await settle(); passWeek(P, 'vpGsWeekSkip'); await settle(); $(P, 'vpGsAllYes').click(); await settle();
  check('note 8: where our table has no figure (QLD: no prize limit) the box says Unlimited; no limit is invented', lim.QLD === null && lim.VIC === null && lim.WA === null && lim.ACT === 300000 && lim.TAS === 500000 && lim.SA === 500000 && lim.NT === 500000 && $(P, 'vpGsIn_max_jackpot_cents').placeholder === 'Unlimited', lim);
  /* NOTE 9: the reminder */
  P = page({ answers: { games: ['members'] } }); P.GS.run(P.ctx, Object.assign(P.deps, { start: 'pick' })); await settle();
  $(P, 'vpGsNext').click(); await settle(); passWeek(P, 'vpGsWeekSkip'); await settle(); $(P, 'vpGsAllYes').click(); await settle();
  box(P, 'vpGsIn_name', 'Friday Draw'); $(P, 'vpGsSave').click(); await settle();
  check('note 9: "Would you like a weekly reminder to update your members list? We can email you." with Email me first, and the words update, never add', /Would you like a weekly reminder to update your members list\?/.test(T(P, 'vpGsRemind')) && /We can email you/.test(T(P, 'vpGsRemind')) && T(P, 'vpGsRemind').indexOf('Email me') < T(P, 'vpGsRemind').indexOf('My calendar') && !/\badd\b/i.test(T(P, 'vpGsBody')), T(P, 'vpGsBody'));
  check('note 9: the computer link says update, and is shown from laptop width up only', /Update your members list on your Account page/.test(T(P, 'vpGsExtrasYes')) && /vpgs-wideonly/.test($(P, 'vpGsExtrasYes').className));
  chip2(P, 'vpGsRemind', 'email').click(); box(P, 'vpGsRemindDay', 'tue'); box(P, 'vpGsRemindTime', '09:30'); $(P, 'vpGsExtrasNo').click(); await settle();
  check('note 9: Email me saves { how: email, day, time, since: today (Brisbane) }, the shape the billing Worker\'s sender reads', JSON.stringify(lastAnswers().members_reminder) === JSON.stringify({ how: 'email', day: 'tue', time: '09:30', since: P.GS.brisbaneDate(NOW) }), lastAnswers());
  /* the Account page, on its own: start reminder */
  P = page({ answers: { games: ['members'], members_reminder: { how: 'email', day: 'tue', time: '09:30', since: '2026-11-01' } } }); var doneR = P.GS.run(P.ctx, Object.assign(P.deps, { start: 'reminder' })); await settle();
  check('note 9: from the Account page it opens on just the reminder (no draws link), the saved choice ticked', T(P, 'vpGsTitle') === 'Your members list reminder' && chip2(P, 'vpGsRemind', 'email').getAttribute('aria-pressed') === 'true' && $(P, 'vpGsExtrasYes').style.display === 'none' && !!$(P, 'vpGsRemindSave') && !!$(P, 'vpGsRemindCancel'));
  SAVED.length = 0; $(P, 'vpGsRemindSave').click(); await settle();
  check('note 9: saving the same choice again keeps its original "since" (the weekly emails do not restart)', (await doneR) === 'done' && lastAnswers().members_reminder.since === '2026-11-01', lastAnswers());
  P = page({ answers: { games: ['members'], members_reminder: { how: 'email', day: 'tue', time: '09:30', since: '2026-11-01' } } }); doneR = P.GS.run(P.ctx, Object.assign(P.deps, { start: 'reminder' })); await settle();
  chip2(P, 'vpGsRemind', 'none').click(); SAVED.length = 0; $(P, 'vpGsRemindSave').click(); await settle();
  check('note 9: No thanks stops it (the key is removed)', !('members_reminder' in lastAnswers()), lastAnswers());
  P = page({ answers: { games: ['members'], members_reminder: { how: 'email', day: 'tue', time: '09:30', since: '2026-11-01' } } }); doneR = P.GS.run(P.ctx, Object.assign(P.deps, { start: 'reminder' })); await settle(); SAVED.length = 0; $(P, 'vpGsRemindCancel').click(); await settle();
  check('note 9: Cancel writes nothing', (await doneR) === 'closed' && SAVED.length === 0);
  var iph = BILL.indexOf('id="md-remind"'), up = BILL.indexOf('id="md-upload"'), phoneRule = /@media \(max-width:700px\)\{#md-upload\.md-nophone\{display:none\}\}/.test(BILL);
  check('note 9: on the Account page the CSV upload is hidden on a phone (max 700px) and the weekly reminder stands in its place; on a computer both show', phoneRule && up > 0 && iph > up && /class="md-nophone"/.test(BILL) && /Would you like a weekly reminder to update your members list\? We can email you\./.test(BILL) && /VPGameSetup\.run\(cx, \{ start: "reminder", VP: VP \}\)/.test(BILL));
  check('note 9: no copy anywhere on that card says "add your members list"', !/add your members list/i.test(BILL.slice(BILL.indexOf('id="md-remind"') - 200, BILL.indexOf('id="md-remind"') + 800)));
  check('note 9: the Worker sends it: vpaMembersReminderSweep is on the hourly trigger (tools/test-members-reminder.js runs it)', /vpaMembersReminderSweep/.test(readFile('venueplay-backend/worker/venueplay-api-FULL.js')));

  check('"Not today" and "That\'s enough for today" stay on screen on a phone: sticky above the footer (Dean 10 Nov, item 119b)', /\.vpgs-answers \.vpgs-outline\{position:sticky;bottom:calc\(84px/.test(GS));
  section('7b. ASKED ONCE, NEVER AGAIN (Dean, 10 Nov, INBOX 121)');
  P = oldVenue({ answers: { games: ['trivia'], setup_reviewed: { at: '2026-11-10', how: 'finished' } } });
  check('a venue with setup_answers.setup_reviewed is never asked, on any device (nothing stored locally), and a malformed flag does not count', P.GS.wantsReview(P.ctx, P.deps.storage, NOW) === false && oldVenue({ answers: { setup_reviewed: { at: 'x', how: 'finished' } } }).GS.wantsReview(P.ctx, { getItem: function () { return null; } }, NOW) === false && (function () { var Q = oldVenue({ answers: { setup_reviewed: { at: 'x', how: 'finished' } } }); return Q.GS.wantsReview(Q.ctx, { getItem: function () { return null; } }, NOW); })() === true);
  check('and a new venue with no flag is asked as before', (function () { var Q = oldVenue(); return Q.GS.wantsReview(Q.ctx, Q.deps.storage, NOW); })() === true);
  check('the flag survives the answers clean (it is saved with the venue), and only finished or dismissed with a date', JSON.stringify(P.GS.cleanExtra({ setup_reviewed: { at: '2026-11-10', how: 'dismissed' } }, {}).setup_reviewed) === '{"at":"2026-11-10","how":"dismissed"}' && !P.GS.cleanExtra({ setup_reviewed: { at: '2026-11-10', how: 'later' } }, {}).setup_reviewed);
  P = oldVenue(); P.GS.review(P.ctx, P.deps); await settle();
  $(P, 'vpGsGo').click(); await settle(); $(P, 'vpGsNext').click(); await settle(); passWeek(P, 'vpGsWeekSkip'); await settle(); $(P, 'vpGsAllNo').click(); await settle();
  check('Not today sets it (dismissed) and saves it with the venue\'s answers', lastAnswers().setup_reviewed && lastAnswers().setup_reviewed.how === 'dismissed' && lastAnswers().review === 'done');
  check('so the next sign-in, on this device or another, does not ask', (function () { var sa = lastAnswers(); var Q = oldVenue({ answers: sa }); return Q.GS.wantsReview(Q.ctx, { getItem: function () { return null; }, setItem: function () {} }, NOW + 86400000 * 30); })() === false);
  P = oldVenue(); P.GS.review(P.ctx, P.deps); await settle();
  $(P, 'vpGsReviewLater').click(); await settle();
  check('"Not ready yet, remind me next time" does NOT set it (the venue is asked again next sign-in, that venue only)', !(lastAnswers() && lastAnswers().setup_reviewed) && JSON.parse(STORE['vpGameSetup:V1']).reviewLater > NOW && (function () { var Q = oldVenue({ store: JSON.parse(JSON.stringify(STORE)) }); return Q.GS.wantsReview(Q.ctx, { getItem: function () { return null; } }, NOW + 5 * 3600000); })() === true);
  P = oldVenue(); P.GS.review(P.ctx, P.deps); await settle();
  $(P, 'vpGsGo').click(); await settle(); $(P, 'vpGsClose').click(); await settle();
  check('Close part way does not set it either', !(lastAnswers() && lastAnswers().setup_reviewed));
  P = oldVenue(); P.GS.review(P.ctx, P.deps); await settle();
  $(P, 'vpGsGo').click(); await settle(); $(P, 'vpGsNext').click(); await settle(); passWeek(P, 'vpGsWeekSkip'); await settle();
  var gl = all($(P, 'vpGsGamePicks'), function (e) { return e.tagName === 'BUTTON' && e.getAttribute('data-game'); }).map(function (e) { return e.getAttribute('data-game'); });
  for (var gi = 0; gi < gl.length; gi++) { if (gi === 0) $(P, 'vpGsAllYes').click(); else if ($(P, 'vpGsNextYes')) $(P, 'vpGsNextYes').click(); await settle(); $(P, 'vpGsSave').click(); await settle(); }
  if ($(P, 'vpGsExtrasNo')) { $(P, 'vpGsExtrasNo').click(); await settle(); }
  check('finishing every game sets it (finished) and saves it', lastAnswers().setup_reviewed && lastAnswers().setup_reviewed.how === 'finished' && lastAnswers().setup_reviewed.at === P.GS.brisbaneDate(NOW), lastAnswers());

  section('5c. WHAT DO YOU WANT TO COLLECT (Dean, 14 Nov 2026, job 416): first run only, between the nights and the games');
  function colBtn(P, k) { return $(P, 'vpGsCol_' + k); }
  function colOn(P, k) { return colBtn(P, k).getAttribute('aria-checked') === 'true'; }
  async function toCollect(P) { P.GS.run(P.ctx, Object.assign(P.deps, { start: 'pick' })); await settle(); gameBtn(P, 'trivia').click(); $(P, 'vpGsNext').click(); await settle(); $(P, 'vpGsWeekSkip').click(); await settle(); }
  COLLECTED = [];
  P = page(); await toCollect(P);
  check('first run: after the nights step comes "What do you want to collect from your customers?"', T(P, 'vpGsTitle') === 'What do you want to collect from your customers?', T(P, 'vpGsTitle'));
  check('one short line says every game asks first name and mobile, so winners can be contacted', /Every game asks for first name and mobile, so winners can be contacted\./.test(T(P, 'vpGsBody')) && !/[—–]|roster|VenuePlay/.test(T(P, 'vpGsBody')), T(P, 'vpGsBody'));
  check('First name and Mobile are ticked and locked (aria-disabled)', colOn(P, 'collect_first_name') && colOn(P, 'collect_mobile') && colBtn(P, 'collect_first_name').getAttribute('aria-disabled') === 'true' && colBtn(P, 'collect_mobile').getAttribute('aria-disabled') === 'true');
  colBtn(P, 'collect_first_name').click(); colBtn(P, 'collect_mobile').click();
  check('clicking a locked tick does nothing: still ticked', colOn(P, 'collect_first_name') && colOn(P, 'collect_mobile'));
  check('Email, Last name and Postcode start unticked, and are roles of checkbox', ['collect_email', 'collect_last_name', 'collect_postcode'].every(function (k) { return !colOn(P, k) && colBtn(P, k).getAttribute('role') === 'checkbox' && colBtn(P, k).getAttribute('aria-disabled') !== 'true'; }));
  colBtn(P, 'collect_email').click(); colBtn(P, 'collect_postcode').click(); colBtn(P, 'collect_last_name').click(); colBtn(P, 'collect_last_name').click();
  check('they toggle: Email and Postcode on, Last name on then off again', colOn(P, 'collect_email') && colOn(P, 'collect_postcode') && !colOn(P, 'collect_last_name'));
  $(P, 'vpGsBack').click(); await settle();
  check('Back returns to the nights step', T(P, 'vpGsTitle') === 'Which nights do you run them?' && COLLECTED.length === 0, T(P, 'vpGsTitle'));
  $(P, 'vpGsWeekSkip').click(); await settle(); colBtn(P, 'collect_postcode').click();
  COLLECTED = []; $(P, 'vpGsCollectNext').click(); await settle();
  check('Next saves exactly the patch with the ticks chosen (first name and mobile always true)', COLLECTED.length === 1 && COLLECTED[0].id === 'V1' && JSON.stringify(COLLECTED[0].patch) === '{"collect_first_name":true,"collect_mobile":true,"collect_email":false,"collect_last_name":false,"collect_postcode":true}', COLLECTED);
  check('and goes on to "Now let\'s set up your games."', T(P, 'vpGsTitle') === 'Now let\'s set up your games.', T(P, 'vpGsTitle'));
  $(P, 'vpGsBack').click(); await settle();
  check('Back from the games step returns to the collect step', T(P, 'vpGsTitle') === 'What do you want to collect from your customers?');
  P = page({ collectFail: true }); await toCollect(P); COLLECTED = []; $(P, 'vpGsCollectNext').click(); await settle();
  check('a refused save says nothing and still goes on to the games', COLLECTED.length === 1 && T(P, 'vpGsTitle') === 'Now let\'s set up your games.' && !/refus|approv|could not|error/i.test(T(P, 'vpGsBody')), T(P, 'vpGsBody'));
  P = page({ saveFail: true }); await toCollect(P); COLLECTED = []; $(P, 'vpGsCollectNext').click(); await settle();
  check('a saving that throws or rejects never blocks the wizard', T(P, 'vpGsTitle') === 'Now let\'s set up your games.');
  P = page(); await toCollect(P); P.deps.saveSettings = function () { throw new Error('boom'); }; $(P, 'vpGsCollectNext').click(); await settle();
  check('a save that throws at once still goes on', T(P, 'vpGsTitle') === 'Now let\'s set up your games.');
  /* an existing venue's review, and the Account page's nights, never show it and never write collect_* */
  COLLECTED = []; P = oldVenue(); P.GS.review(P.ctx, P.deps); await settle(); $(P, 'vpGsGo').click(); await settle(); $(P, 'vpGsNext').click(); await settle();
  var sawCollect = !!$(P, 'vpGsCollectNext') || /collect from your customers/.test(T(P, 'vpGsTitle')); $(P, 'vpGsWeekSkip').click(); await settle();
  sawCollect = sawCollect || !!$(P, 'vpGsCollectNext') || /collect from your customers/.test(T(P, 'vpGsTitle'));
  check('an existing venue\'s review goes nights then "check your games", never the collect screen', !sawCollect && T(P, 'vpGsTitle') === 'Now let\'s check your games.', T(P, 'vpGsTitle'));
  $(P, 'vpGsBack').click(); await settle();
  check('and Back there still goes to the nights step', T(P, 'vpGsTitle') === 'Which nights do you run them?');
  check('the review wrote no collect_* at all', COLLECTED.length === 0 && !SAVED.some(function (x) { return Object.keys(x.patch).some(function (k) { return /^collect_/.test(k); }); }), COLLECTED);
  COLLECTED = []; var P12 = page({ answers: { games: ['trivia'], week: [{ day: 'wed', games: [{ game: 'trivia', start: '19:00' }] }] } });
  P12.GS.run(P12.ctx, Object.assign(P12.deps, { start: 'week', weekOnly: true })); await settle(); $(P12, 'vpGsWeekNext').click(); await settle();
  check('the Account page\'s nights (weekOnly) never show it and never save collect_*', !$(P12, 'vpGsCollectNext') && COLLECTED.length === 0 && !SAVED.some(function (x) { return Object.keys(x.patch).some(function (k) { return /^collect_/.test(k); }); }));

  section('6. WIRED IN');
  var boot = INDEX.slice(INDEX.indexOf('EXISTING VENUES GO THROUGH THE NEW GAMES SETUP TOO'), INDEX.indexOf('if(venue && venue.slug && pairToVenue(venue.slug))'));
  check('the console home asks an existing venue on sign-in, with this device\'s own night as busy, in place of the one later question', /VPGameSetup\.wantsReview\(__ctx\)/.test(boot) && /VPGameSetup\.review\(__ctx, \{ client:VP\.getClient\(\), VP:VP, busy:function\(\)\{ return !!liveNightElsewhere\(\); \} \}\)/.test(boot) && /else if\(window\.VPFirstRun && VPFirstRun\.ask/.test(boot));
  check('after the first-run guide decided not to open (it returns above when it does)', INDEX.indexOf('EXISTING VENUES GO THROUGH THE NEW GAMES SETUP TOO') > INDEX.indexOf('VPFirstRun.check(__ctx, VP.getClient()).then'));

  print('');
  if (bad) print('FAIL ' + bad + ' of ' + ran); else print('ALL ' + ran + ' CHECKS PASSED');
})().catch(function (e) { print('CRASH ' + e + '\n' + (e && e.stack)); bad++; });
