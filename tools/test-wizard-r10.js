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
var CALLS, PREFS, SAVED, STORE, RELOADS, UNHIDE = true;
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
    saveSettings: function (id, patch) { SAVED.push({ id: id, patch: JSON.parse(JSON.stringify(patch)) }); return over.saveFail ? Promise.reject(new Error('no column')) : Promise.resolve({}); },
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
  $(P, 'vpGsWeekNext').click(); await settle();
  sa = lastAnswers();
  check('saved: the week with each start time', sa && JSON.stringify(sa.week) === JSON.stringify([{ day: 'wed', games: [{ game: 'trivia', start: '19:00' }] }, { day: 'fri', games: [{ game: 'members', start: '20:30' }] }, { day: 'sat', games: [{ game: 'other', name: 'Karaoke', start: '21:00' }] }]), sa && sa.week);
  check('one Yes for each game they picked, in game order: trivia, musical bingo, bingo, raffles, members draws (Dean, round 11 note 2)', T(P, 'vpGsTitle') === 'Would you like to set up a game now?' && all($(P, 'vpGsGamePicks'), function (e) { return e.tagName === 'BUTTON' && e.getAttribute('data-game'); }).map(function (e) { return seen(e); }).join('|') === 'Yes, set up trivia|Yes, set up musical bingo|Yes, set up bingo|Yes, set up raffles|Yes, set up members draws');
  check('"Would you like to set up a game now?" with Yes naming it, and one line under Not today (Dean, round 9 point 9)', T(P, 'vpGsTitle') === 'Would you like to set up a game now?' && T(P, 'vpGsAllYes') === 'Yes, set up trivia' && T(P, 'vpGsAllNo') === 'Not today' && T(P, 'vpGsAllNote') === 'Each game walks you through its setup the first time you open it. Do it before your first night.');
  $(P, 'vpGsAllYes').click(); await settle();

  /* TRIVIA: every question */
  check('trivia: the step line names the game and the button says Next, like the top one (Dean, round 9 point 12)', T(P, 'vpGsCount') === 'Trivia, game 1 of 5' && T(P, 'vpGsSave') === 'Next');
  check('trivia: no "the usual settings are already filled in" (Dean, round 9 point 20)', !/usual settings are already filled in/.test(T(P, 'vpGsBody')));
  function pairOf(P, key) { var r = row(P, key); return r && r.parentNode; }
  function firstKey(P) { var r = walk($(P, 'vpGsBody'), function (e) { return e.getAttribute && e.getAttribute('data-key'); }); return r && r.getAttribute('data-key'); }
  check('trivia: Rounds a night and Questions a round on ONE line, and first (Dean, round 11 note 4)', pairOf(P, 'rounds') === pairOf(P, 'count') && /vpgs-pairs/.test(pairOf(P, 'rounds').className) && firstKey(P) === 'rounds' && /Questions a round/.test(seen(row(P, 'count'))));
  check('trivia: Round prizes (different or the same) and Same every week? on one line', pairOf(P, 'prize_same') === pairOf(P, 'prize_weekly') && /vpgs-pairs/.test(pairOf(P, 'prize_weekly').className) && /Same every week\?/.test(seen(row(P, 'prize_weekly'))));
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
  seg(P, 'prizes_weekly', 'false');
  check('raffles: not the same every week, so a week can be swapped, one box for each prize in order', shown(P, 'prize_swaps') && !!$(P, 'vpGsSwapAdd'));
  $(P, 'vpGsSwapAdd').click(); box(P, 'vpGsSwapWeek_0', '2026-12-09'); box(P, 'vpGsSwapP_0_0', 'Hamper'); box(P, 'vpGsSwapP_0_1', 'Voucher');
  check('raffles: draw style has a barrel and a wheel; the cash prize asks its amount', $(P, 'vpGsIn_draw_style').children.map(function (o) { return o.value; }).join() === 'numbers,barrel,wheel' && !shown(P, 'jackpot_amount_cents'));
  box(P, 'vpGsIn_draw_style', 'barrel'); seg(P, 'jackpot_on', 'true'); box(P, 'vpGsIn_jackpot_amount_cents', '250'); seg(P, 'allow_redraw', 'false'); box(P, 'vpGsIn_spin_seconds', 6);
  CALLS = []; $(P, 'vpGsSave').click(); await settle();
  var rp = lastPost('/host/game-prefs');
  var wantR = { raffles: 2, raffle_counts: [3, 1], raffle_names: ['Friday Meat Raffle', 'Hamper Draw'], raffle_prizes: [['Meat tray', 'Meat tray', 'Meat tray'], ["Winner's choice"]], prizes: ['Meat tray', "Winner's choice"], prize_count: 3, prizes_same: true, time_to_present: 300, prizes_weekly: false, prize_swaps: [{ week: '2026-12-07', prizes: ['Hamper', 'Voucher'] }], draw_style: 'barrel', jackpot_on: true, jackpot_amount_cents: 25000, allow_redraw: false, spin_seconds: 6 };
  var missR = Object.keys(wantR).filter(function (k) { return !rp || JSON.stringify(rp.prefs[k]) !== JSON.stringify(wantR[k]); });
  check('raffles: every answer saved to game_prefs.raffle (' + Object.keys(wantR).length + ' settings)', rp && rp.game === 'raffle' && missR.length === 0, { missing: missR, sent: rp && rp.prefs });
  check('raffles: the game Worker keeps every one', rp && keptByWorker('raffle', rp.prefs), rp && WK.clean('raffle', rp.prefs));

  /* MEMBERS DRAWS: every question */
  $(P, 'vpGsNextYes').click(); await settle();
  check('members draws last, the draw time from the nights step in the half-hour list', T(P, 'vpGsTitle') === 'Set up members draws' && $(P, 'vpGsIn_draw_time').tagName === 'SELECT' && $(P, 'vpGsIn_draw_time').value === '20:30', $(P, 'vpGsIn_draw_time').value);
  box(P, 'vpGsIn_name', 'Friday Jackpot'); box(P, 'vpGsIn_date_started', '2026-01-09'); box(P, 'vpGsIn_draw_time', '21:00');
  box(P, 'vpGsIn_current_jackpot_cents', '1250'); box(P, 'vpGsIn_starting_amount_cents', '250'); box(P, 'vpGsIn_increment_cents', '50'); box(P, 'vpGsIn_max_jackpot_cents', '5000');
  seg(P, 'over_max', 'second');
  check('members draws: compact, two to a line (start and time, jackpot now and back to, weekly and most)', pairOf(P, 'date_started') === pairOf(P, 'draw_time') && pairOf(P, 'current_jackpot_cents') === pairOf(P, 'starting_amount_cents') && pairOf(P, 'increment_cents') === pairOf(P, 'max_jackpot_cents'));
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
  check('then the members list reminder: how, the best day and the best time (Dean, round 11 note 7)', /Would you like a reminder to add your members list\?/.test(T(P, 'vpGsBody')) && ['email', 'calendar', 'none'].every(function (v) { return !!chip2(P, 'vpGsRemind', v); }) && $(P, 'vpGsRemindWhen').style.display === 'none');
  chip2(P, 'vpGsRemind', 'calendar').click(); box(P, 'vpGsRemindDay', 'thu'); box(P, 'vpGsRemindTime', '16:30');
  var ics = decodeURIComponent(($(P, 'vpGsRemindCal').attrs.href || '').replace(/^data:text\/calendar;charset=utf-8,/, ''));
  check('the weekly calendar entry is a real .ics: Thursdays at 4:30pm, repeating weekly', $(P, 'vpGsRemindWhen').style.display === '' && /RRULE:FREQ=WEEKLY;BYDAY=TH/.test(ics) && /DTSTART:20261112T163000/.test(ics) && /BEGIN:VEVENT/.test(ics) && $(P, 'vpGsRemindCal').attrs.download === 'venueplay-members-list-reminder.ics', ics);
  $(P, 'vpGsExtrasNo').click(); await settle();
  sa = lastAnswers();
  check('the reminder is kept in setup_answers.members_reminder', sa && JSON.stringify(sa.members_reminder) === JSON.stringify({ how: 'calendar', day: 'thu', time: '16:30' }), sa && sa.members_reminder);
  check('members draws: what happens over the most kept in setup_answers', sa && sa.members_over === 'second', sa && sa.members_over);
  check('the end: "You\'re ready for your week." and the advertising prompt, meal deals named, to the Screen tab (Dean, round 9 point 23)', T(P, 'vpGsTitle') === "You're ready for your week." && /Next, your TV advertising/.test(T(P, 'vpGsAdvert')) && /like your meal deals/.test(T(P, 'vpGsAdvert')) && $(P, 'vpGsAdvertGo').getAttribute('href') === '/app/billing.html#screen');
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
  check('it opens with one screen in the round 11 words, never already filled in, "Not ready yet? Remind me next time" under it', T(P, 'vpGsTitle') === 'Check your game setup' && T(P, 'vpGsBody').indexOf('We have changed some settings within games. Click through now to review these, and change anything you like as you go.') === 0 && !/filled in|already/i.test(T(P, 'vpGsBody')) && T(P, 'vpGsReviewLater') === 'Not ready yet? Remind me next time');
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
  $(P, 'vpGsNext').click(); await settle(); $(P, 'vpGsWeekSkip').click(); await settle();
  check('"Would you like to check a game now?" with a Yes for each game, Not today keeps everything', T(P, 'vpGsTitle') === 'Would you like to check a game now?' && all($(P, 'vpGsGamePicks'), function (e) { return e.tagName === 'BUTTON' && e.getAttribute('data-game'); }).length === 5 && T(P, 'vpGsAllNote') === 'Not today keeps every setting as it is.');
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
  $(P, 'vpGsGo').click(); await settle(); $(P, 'vpGsNext').click(); await settle(); $(P, 'vpGsWeekSkip').click(); await settle(); $(P, 'vpGsAllYes').click(); await settle();
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
  $(P, 'vpGsGo').click(); await settle(); $(P, 'vpGsNext').click(); await settle(); $(P, 'vpGsWeekSkip').click(); await settle(); $(P, 'vpGsAllYes').click(); await settle();
  CALLS = []; $(P, 'vpGsSave').click(); await settle();
  check('a setting the venue never had and did not touch (same prizes every week, double points) is never written: new settings stay off', posts('/host/game-prefs').length === 0 && JSON.stringify(PREFS.trivia) === '{"rounds":3}', PREFS.trivia);

  /* round 11 questions for an existing venue: pre-filled, only what changed is sent, a new one stays unsaved until touched */
  P = oldVenue(); P.GS.review(P.ctx, P.deps); await settle();
  $(P, 'vpGsGo').click(); await settle(); $(P, 'vpGsNext').click(); await settle(); $(P, 'vpGsWeekSkip').click(); await settle(); $(P, 'vpGsAllYes').click(); await settle();
  check('existing venue: picture questions open ON (the default, never saved by them) with the plain ON line', /Picture questions are ON/.test(T(P, 'vpGsState_picture_round')));
  seg(P, 'picture_round', 'false');
  CALLS = []; $(P, 'vpGsSave').click(); await settle();
  check('existing venue: switching picture questions off sends only that: { picture_round: false }', JSON.stringify(lastPost('/host/game-prefs').prefs) === '{"picture_round":false}', lastPost('/host/game-prefs'));
  check('and the Worker keeps it', keptByWorker('trivia', { picture_round: false }));
  P = oldVenue(); P.GS.review(P.ctx, P.deps); await settle();
  $(P, 'vpGsGo').click(); await settle(); $(P, 'vpGsNext').click(); await settle(); $(P, 'vpGsWeekSkip').click(); await settle(); $(P, 'vpGsAllYes').click(); await settle();
  seg(P, 'prize_weekly', 'false'); $(P, 'vpGsSwapAdd').click(); box(P, 'vpGsSwapWeek_0', '2026-11-25'); box(P, 'vpGsSwapP_0_0', 'Trip');
  CALLS = []; $(P, 'vpGsSave').click(); await settle();
  var swp = lastPost('/host/game-prefs').prefs;
  check('existing venue: not the same every week + a swapped week sends just those two', srtj(swp) === srtj({ prize_weekly: false, prize_swaps: [{ week: '2026-11-23', prizes: ['Trip', '', '', '', ''] }] }) && keptByWorker('trivia', swp), swp);
  P = oldVenue(); P.GS.review(P.ctx, P.deps); await settle();
  $(P, 'vpGsGo').click(); await settle(); $(P, 'vpGsNext').click(); await settle(); $(P, 'vpGsWeekSkip').click(); await settle();
  $(P, 'vpGsAllYes_raffles').click(); await settle();
  box(P, 'vpGsRafName_0', 'Meat Raffle'); box(P, 'vpGsIn_draw_style', 'wheel');
  CALLS = []; $(P, 'vpGsSave').click(); await settle();
  var rsp = lastPost('/host/game-prefs').prefs;
  check('existing venue: naming a raffle and picking the wheel sends just raffle_names and draw_style', srtj(rsp) === srtj({ raffle_names: ['Meat Raffle', ''], draw_style: 'wheel' }) && keptByWorker('raffle', rsp), rsp);
  P = oldVenue(); P.GS.review(P.ctx, P.deps); await settle();
  $(P, 'vpGsGo').click(); await settle(); $(P, 'vpGsNext').click(); await settle(); $(P, 'vpGsWeekSkip').click(); await settle();
  $(P, 'vpGsAllYes_members').click(); await settle();
  check('existing venue: their draw, with "Add another draw" offered', $(P, 'vpGsIn_name').value === 'Thursday Members Draw' && T(P, 'vpGsAddDraw') === 'Add another draw');
  CALLS = []; $(P, 'vpGsAddDraw').click(); await settle();
  check('Add another draw on an unchanged draw sends nothing for it and opens a blank draw', posts('/host/members/settings').length === 0 && $(P, 'vpGsIn_name').value === '' && /draw 2 of 2/.test(T(P, 'vpGsCount')));
  box(P, 'vpGsIn_name', 'Sunday Draw'); box(P, 'vpGsIn_draw_time', '17:00'); box(P, 'vpGsIn_current_jackpot_cents', '200');
  CALLS = []; $(P, 'vpGsSave').click(); await settle();
  check('the new draw is sent whole, with no draw_id, so it is a new draw and Thursday\'s is untouched', srtj(lastPost('/host/members/settings')) === srtj({ venue_id: 'V1', name: 'Sunday Draw', draw_time: '5pm', current_jackpot_cents: 20000, draw_day: 'Thursday' }) || (lastPost('/host/members/settings') && !('draw_id' in lastPost('/host/members/settings')) && lastPost('/host/members/settings').name === 'Sunday Draw'), lastPost('/host/members/settings'));
  /* the email reminder, and No thanks */
  P = page({ answers: { games: ['members'] } }); P.GS.run(P.ctx, Object.assign(P.deps, { start: 'pick' })); await settle();
  $(P, 'vpGsNext').click(); await settle(); $(P, 'vpGsWeekSkip').click(); await settle(); $(P, 'vpGsAllYes').click(); await settle();
  box(P, 'vpGsIn_name', 'Friday Draw'); $(P, 'vpGsSave').click(); await settle();
  chip2(P, 'vpGsRemind', 'email').click(); box(P, 'vpGsRemindDay', 'sat'); box(P, 'vpGsRemindTime', '10:30');
  check('email reminder: no calendar link, the day and time shown', $(P, 'vpGsRemindCal').style.display === 'none' && $(P, 'vpGsRemindWhen').style.display === '');
  $(P, 'vpGsExtrasNo').click(); await settle();
  check('email reminder saved: { how: email, day: sat, time: 10:30 }', JSON.stringify(lastAnswers().members_reminder) === JSON.stringify({ how: 'email', day: 'sat', time: '10:30' }), lastAnswers());
  check('and setup_answers keeps it after a clean (vp-firstrun cleans through cleanExtra)', JSON.stringify(P.GS.cleanExtra({ members_reminder: { how: 'email', day: 'sat', time: '10:30' } }, {}).members_reminder) === '{"how":"email","day":"sat","time":"10:30"}' && !P.GS.cleanExtra({ members_reminder: { how: 'sms', day: 'sat' } }, {}).members_reminder);
  P = page({ answers: { games: ['members'], members_reminder: { how: 'calendar', day: 'tue', time: '08:00' } } }); P.GS.run(P.ctx, Object.assign(P.deps, { start: 'pick' })); await settle();
  $(P, 'vpGsNext').click(); await settle(); $(P, 'vpGsWeekSkip').click(); await settle(); $(P, 'vpGsAllYes').click(); await settle();
  box(P, 'vpGsIn_name', 'Friday Draw'); $(P, 'vpGsSave').click(); await settle();
  check('a venue that already chose a reminder sees it again, ticked', chip2(P, 'vpGsRemind', 'calendar').getAttribute('aria-pressed') === 'true' && $(P, 'vpGsRemindDay').value === 'tue');
  chip2(P, 'vpGsRemind', 'none').click(); $(P, 'vpGsExtrasNo').click(); await settle();
  check('No thanks removes the reminder', !('members_reminder' in lastAnswers()), lastAnswers());

  /* Not today and Close write nothing for an existing venue */
  P = oldVenue(); done = P.GS.review(P.ctx, P.deps); await settle();
  $(P, 'vpGsGo').click(); await settle(); $(P, 'vpGsNext').click(); await settle(); $(P, 'vpGsWeekSkip').click(); await settle();
  CALLS = []; $(P, 'vpGsAllNo').click(); await settle();
  check('Not today: "Everything stays as it is", no defaults written, asked again next sign-in', /Everything stays as it is\. We'll ask you again next time you sign in\./.test(T(P, 'vpGsNoWorries')) && posts('/host/game-prefs').length === 0 && JSON.stringify(PREFS) === JSON.stringify(HAVE) && JSON.parse(STORE['vpGameSetup:V1']).reviewLater > NOW);
  P = oldVenue(); done = P.GS.review(P.ctx, P.deps); await settle();
  $(P, 'vpGsGo').click(); await settle();
  CALLS = []; $(P, 'vpGsClose').click(); await settle();
  check('Close part way: nothing written, no game marked for its own setup, asked again next sign-in', (await done) === 'closed' && posts('/host/game-prefs').length === 0 && !(lastAnswers() && lastAnswers().setup) && JSON.parse(STORE['vpGameSetup:V1']).reviewLater > NOW);

  section('3. DEAN\'S OTHER ROUND 9 NOTES');
  P = page({ answers: { games: ['members'] } }); P.GS.run(P.ctx, Object.assign(P.deps, { start: 'pick' })); await settle();
  $(P, 'vpGsNext').click(); await settle(); $(P, 'vpGsWeekSkip').click(); await settle(); $(P, 'vpGsAllNo').click(); await settle();
  check('members draws only, Not today: "We\'ll remind you when you\'re ready for members draws." (Dean, round 9 point 21)', T(P, 'vpGsNoWorries') === "We'll remind you when you're ready for members draws." && !$(P, 'vpGsMembersNote'), T(P, 'vpGsNoWorries'));
  check('and the advertising prompt there too (point 23)', !!$(P, 'vpGsAdvert'));
  P = page({ answers: { games: ['trivia'] } }); P.GS.run(P.ctx, Object.assign(P.deps, { start: 'pick' })); await settle();
  $(P, 'vpGsNext').click(); await settle(); $(P, 'vpGsWeekSkip').click(); await settle(); $(P, 'vpGsAllYes').click(); await settle();
  var adv = $(P, 'vpGsAdvanced'); walk(adv, function (e) { return e.className === 'vpgs-sech'; }).click();
  check('More settings opens from anywhere on its line, not only the small button (Dean, round 9 point 16)', !/folded/.test(adv.className) && $(P, 'vpGsAdvToggle').getAttribute('aria-expanded') === 'true');
  P = page({ venue: { entity_type: null, venue_type: 'Hotel' } }); P.GS.run(P.ctx, Object.assign(P.deps, { start: 'pick' })); await settle();
  check('the website scan\'s venue type, when it lands, answers pub or club and the question is left out (Dean, round 9 point 3)', !$(P, 'vpGsKind') && T(P, 'vpGsTitle') === 'What games do you play?');
  check('the speakers guide says first that the TV\'s own speakers already play it (Dean, round 9 point 18)', /Your TV's own speakers already play it through the HDMI cable\. This guide is for venues whose sound runs through a separate amp or PA\./.test(SOUND) && /separate amp or PA/.test(P.H.byKey('musical').settings.filter(function (s) { return s.key === 'sound'; })[0].help));
  check('the logo a touch bigger (Dean, round 9 point 2) and the step line in sentence case, no spaced capitals', /\.vpgs-logo\{display:block;height:26px/.test(GS) && !/vpgs-count\{[^}]*letter-spacing/.test(GS) && !/vpgs-count\{[^}]*uppercase/.test(GS));

  section('4. THE MEMBERS LIST: WHICH COLUMN IS WHICH (Dean, round 9 point 24)');
  var csvSrc = BILL.slice(BILL.indexOf('  var CSV_GUESS'), BILL.indexOf('  function csvMatch'));
  var uq = BILL.slice(BILL.indexOf('  function unquoteCols'), BILL.indexOf('  function importMembers'));
  var CSV = (new Function(csvSrc + uq + '; return { guess: csvGuess, rows: csvRows, lines: csvLines, decode: csvDecode, delim: csvDelim };'))();
  var file = 'Surname,Given name,Member No,Joined\nSmith,Jane,142,2020\n"Nguyen, Jr",Sam,143,2021\nBrown,Al,,2022\n';
  var rows = CSV.rows(file), heads = rows[0];
  var ix = { number: CSV.guess(heads, 'number'), first: CSV.guess(heads, 'first'), last: CSV.guess(heads, 'last') };
  check('a club system\'s columns guessed: member number, first name, last name', ix.number === 2 && ix.first === 1 && ix.last === 0, ix);
  var made = CSV.lines(rows, ix);
  check('the box filled as "number, first last", the header and a row with no number left out, a comma in a name never splits it', JSON.stringify(made) === JSON.stringify(['142, Jane Smith', '143, Sam Nguyen Jr']), made);
  check('a different pick is what is used (the venue decides)', JSON.stringify(CSV.lines(rows, { number: 2, first: 0, last: -1 })) === JSON.stringify(['142, Smith', '143, Nguyen Jr']));
  check('the billing page shows the column picker for an uploaded CSV', /csvMatch\(typeof buf === "string" \? buf : csvDecode\(buf\)\)/.test(BILL) && /id="md-match"/.test(BILL) && /\$\("md-csv"\)\.addEventListener\("change"[\s\S]{0,200}csvFile\(f\)/.test(BILL));
  function guessAll(file) { var r = CSV.rows(file), hasHead = !/^\s*\d/.test((r[0] || [''])[0] || ''); var ix = { number: CSV.guess(r[0], 'number'), first: CSV.guess(r[0], 'first'), last: CSV.guess(r[0], 'last') }; return CSV.lines(r, ix); }
  /* THE UPLOAD THAT WAS NOT WORKING (Dean, round 11 note 7): the cause, and each shape of file that failed */
  var good = ['142, Jane Smith', '143, Sam Taylor'];
  check('CAUSE 1: Excel on a Mac ends every line with a bare CR; the old reader saw one line and found no member numbers. Now read', JSON.stringify(guessAll('Member No,First Name,Surname\r142,Jane,Smith\r143,Sam,Taylor\r')) === JSON.stringify(good), guessAll('Member No,First Name,Surname\r142,Jane,Smith\r143,Sam,Taylor\r'));
  check('CAUSE 2: a semicolon separated file (club systems, European Excel) is read', JSON.stringify(guessAll('Member No;First Name;Surname\n142;Jane;Smith\n143;Sam;Taylor\n')) === JSON.stringify(good), guessAll('Member No;First Name;Surname\n142;Jane;Smith\n143;Sam;Taylor\n'));
  check('a tab separated file, a pipe separated file and a Windows (CRLF) file with a BOM are read', JSON.stringify(guessAll('Member No\tFirst Name\tSurname\n142\tJane\tSmith\n143\tSam\tTaylor')) === JSON.stringify(good) && JSON.stringify(guessAll('Member No|First Name|Surname\n142|Jane|Smith\n143|Sam|Taylor')) === JSON.stringify(good) && JSON.stringify(guessAll('﻿Member No,First Name,Surname\r\n142,Jane,Smith\r\n143,Sam,Taylor\r\n')) === JSON.stringify(good));
  check('a comma inside quotes still never splits (a semicolon file with "Smith, Jr")', JSON.stringify(guessAll('Member No;First Name;Surname\n142;Jane;"Smith, Jr"\n')) === JSON.stringify(['142, Jane Smith Jr']));
  /* jsc has no TextDecoder; a small stand-in with the browser's behaviour for the three encodings the reader uses (a real browser has its own) */
  if (typeof TextDecoder === 'undefined') this.TextDecoder = function (enc, o) { this.enc = String(enc).toLowerCase(); this.fatal = !!(o && o.fatal); };
  if (!this.TextDecoder.prototype.decode) this.TextDecoder.prototype.decode = function (u) {
    var out = '', i = 0, e = this.enc;
    if (e === 'utf-16le' || e === 'utf-16be') { for (; i + 1 < u.length; i += 2) out += String.fromCharCode(e === 'utf-16le' ? u[i] | (u[i + 1] << 8) : (u[i] << 8) | u[i + 1]); return out; }
    if (e === 'utf-8') { while (i < u.length) { var c = u[i++]; if (c < 128) out += String.fromCharCode(c); else if (c >= 194 && c < 224 && (u[i] & 192) === 128) out += String.fromCharCode(((c & 31) << 6) | (u[i++] & 63)); else if (this.fatal) throw new TypeError('invalid utf-8'); else out += '�'; } return out; }
    for (; i < u.length; i++) out += String.fromCharCode(u[i]); return out;
  };
  function bytes(arr) { var b = new Uint8Array(arr.length); for (var i = 0; i < arr.length; i++) b[i] = arr[i]; return b.buffer; }
  function utf16(str, be) { var a = be ? [0xFE, 0xFF] : [0xFF, 0xFE]; for (var i = 0; i < str.length; i++) { var c = str.charCodeAt(i); if (be) a.push(c >> 8, c & 255); else a.push(c & 255, c >> 8); } return bytes(a); }
  var txt = 'Member No\tFirst Name\tSurname\r\n142\tJane\tSmith\r\n143\tSam\tTaylor\r\n';
  check('CAUSE 3: Excel "Unicode Text" is UTF-16 (little or big endian); it is decoded and read', JSON.stringify(guessAll(CSV.decode(utf16(txt, false)))) === JSON.stringify(good) && JSON.stringify(guessAll(CSV.decode(utf16(txt, true)))) === JSON.stringify(good));
  var latin = bytes([77, 101, 109, 98, 101, 114, 44, 78, 97, 109, 101, 10, 49, 52, 50, 44, 74, 111, 115, 233, 10]);
  check('a Windows (Latin-1) file with a name like José is read, not dropped', JSON.stringify(guessAll(CSV.decode(latin))) === JSON.stringify(['142, José']), guessAll(CSV.decode(latin)));
  check('the delimiter is worked out from the header line', CSV.delim('a;b;c') === ';' && CSV.delim('a,b,c') === ',' && CSV.delim('a\tb') === '\t' && CSV.delim('"a;b",c,d') === ',');
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
  $(P, 'vpGsGo').click(); await settle(); $(P, 'vpGsNext').click(); await settle(); $(P, 'vpGsWeekSkip').click(); await settle(); $(P, 'vpGsAllYes').click(); await settle();
  check('hidden: trivia no longer asks picture questions', !row(P, 'picture_round') && !$(P, 'vpGsState_picture_round') && !!row(P, 'double_points'));
  seg(P, 'prize_weekly', 'false');
  check('hidden: trivia, not the same every week, offers no prize swap', !row(P, 'prize_swaps') && !$(P, 'vpGsSwapAdd'));
  P = oldVenue(); P.GS.review(P.ctx, P.deps); await settle();
  $(P, 'vpGsGo').click(); await settle(); $(P, 'vpGsNext').click(); await settle(); $(P, 'vpGsWeekSkip').click(); await settle();
  $(P, 'vpGsAllYes_raffles').click(); await settle();
  check('hidden: raffles ask no name and no draw style, and still ask the prizes', !$(P, 'vpGsRafName_0') && !row(P, 'draw_style') && !$(P, 'vpGsIn_draw_style') && !!$(P, 'vpGsRafP_0_0'));
  seg(P, 'prizes_weekly', 'false');
  check('hidden: raffles, not the same every week, offer no prize swap', !row(P, 'prize_swaps') && !$(P, 'vpGsSwapAdd'));
  P = page({ answers: { games: ['members'] } }); P.GS.run(P.ctx, Object.assign(P.deps, { start: 'pick' })); await settle();
  $(P, 'vpGsNext').click(); await settle(); $(P, 'vpGsWeekSkip').click(); await settle(); $(P, 'vpGsAllYes').click(); await settle();
  box(P, 'vpGsIn_name', 'Friday Draw'); $(P, 'vpGsSave').click(); await settle();
  check('hidden: the members list reminder offers the calendar and No thanks, no email', !chip2(P, 'vpGsRemind', 'email') && !!chip2(P, 'vpGsRemind', 'calendar') && !!chip2(P, 'vpGsRemind', 'none'));
  P = page({ answers: { games: ['members'], members_reminder: { how: 'email', day: 'sat', time: '10:30' } } }); P.GS.run(P.ctx, Object.assign(P.deps, { start: 'pick' })); await settle();
  $(P, 'vpGsNext').click(); await settle(); $(P, 'vpGsWeekSkip').click(); await settle(); $(P, 'vpGsAllYes').click(); await settle();
  box(P, 'vpGsIn_name', 'Friday Draw'); $(P, 'vpGsSave').click(); await settle();
  $(P, 'vpGsExtrasNo').click(); await settle();
  check('hidden: an old email-reminder choice is not carried on (no email job exists yet)', !('members_reminder' in lastAnswers()), lastAnswers());
  P = oldVenue(); 
  check('hidden: the keys and defaults are still there for later (picture_round on, draw_style numbers)', P.H.byKey('trivia').settings.some(function (x) { return x.key === 'picture_round' && x.def === true && x.notYet; }) && P.H.byKey('raffles').settings.some(function (x) { return x.key === 'draw_style' && x.def === 'numbers' && x.notYet; }) && WK.clean('trivia', { picture_round: false }).picture_round === false && WK.clean('raffle', { draw_style: 'wheel' }).draw_style === 'wheel');
  UNHIDE = true;

  section('6. WIRED IN');
  var boot = INDEX.slice(INDEX.indexOf('EXISTING VENUES GO THROUGH THE NEW GAMES SETUP TOO'), INDEX.indexOf('if(venue && venue.slug && pairToVenue(venue.slug))'));
  check('the console home asks an existing venue on sign-in, with this device\'s own night as busy, in place of the one later question', /VPGameSetup\.wantsReview\(__ctx\)/.test(boot) && /VPGameSetup\.review\(__ctx, \{ client:VP\.getClient\(\), VP:VP, busy:function\(\)\{ return !!liveNightElsewhere\(\); \} \}\)/.test(boot) && /else if\(window\.VPFirstRun && VPFirstRun\.ask/.test(boot));
  check('after the first-run guide decided not to open (it returns above when it does)', INDEX.indexOf('EXISTING VENUES GO THROUGH THE NEW GAMES SETUP TOO') > INDEX.indexOf('VPFirstRun.check(__ctx, VP.getClient()).then'));

  print('');
  if (bad) print('FAIL ' + bad + ' of ' + ran); else print('ALL ' + ran + ' CHECKS PASSED');
})().catch(function (e) { print('CRASH ' + e + '\n' + (e && e.stack)); bad++; });
