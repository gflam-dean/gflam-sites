/* THE SETUP WIZARD'S GAMES, RUN AND NOT WORD-SEARCHED (Dean, 6 Nov 2026, INBOX 104 and his four clarifications).

   venueplay/app/vp-gamesetup.js and venueplay/app/vp-setup-help.js run here in a small fake page against a fake game
   Worker that keeps game_prefs the way /host/game-prefs does (GET answers what is saved, POST merges):

     1. THE SHARED SETTINGS LIST: five games in Dean's order; every saved key is one the game Worker keeps
        (GAME_PREFS_KEYS, run for real) or one /host/members/settings reads; today's defaults pass the Worker's own
        cleaning unchanged and match the consoles' own boxes; every "?" is one or two plain lines
     2. THE HEADS-UP: under five minutes a game, members draw details only while members draws may be ticked,
        advertising for the screen step, "Then you're ready for your week."
     3. "What games do you play at your venue?": the five ticks in order, kept in setup_answers.games with
        games_at (the Brisbane date, first time only)
     4. "Not today" / "No worries": Dean's words, today's defaults written ONLY for keys the venue has not saved,
        members draws never called saved
     5. ONE GAME AT A TIME: every setting with a "?" (one open at a time), Save sends this game's values to
        /host/game-prefs, "Do you want to set up your next game?", "What would you like to set up next?",
        members draws made through /host/members/settings, never without a name
     6. THE FIRST TIME A SKIPPED GAME IS OPENED: its own setup, once, owner or manager only, never again
     7. WIRED IN: the guide's games step runs it and keeps games_at and setup; each console loads it and calls
        firstOpen with its own game; index.html loads it before the guide

   Run from the repo root:  jsc tools/test-game-setup.js */
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
var CALLS, PREFS, SAVED, STORE, RELOADS, COLLECTED = [];
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
    else if (/\/host\/members\/settings$/.test(u)) { if (over.membersRefuse) { st = 403; ans = { error: 'Only a manager or owner can change the draw and jackpot settings' }; } }
    else if (/musical-library\.json$/.test(u)) ans = { playlists: [{ id: 'all-the-hits', name: 'All the hits' }, { id: 'pub-classics', name: 'Pub Classics' }, { id: '80s-pop', name: '80s' }, { id: '90s', name: '90s' }, { id: '2000s', name: '2000s' }, { id: 'aussie', name: 'Aussie' }, { id: 'country', name: 'Country' }, { id: 'bad id<script>', name: 'x' }] };
    return Promise.resolve({ ok: st < 400, status: st, json: function () { return Promise.resolve(ans); } });
  };
  var client = { auth: { getSession: function () { return Promise.resolve({ data: { session: { access_token: 'TOKEN-1' } } }); } },
    from: function (t) { var b = { select: function () { return b; }, eq: function () { return b; },
      then: function (r) { return Promise.resolve({ data: t === 'vp_question_sets' ? [{ id: 'S-OWN', title: 'Our quiz', question_count: 40, owner_venue_id: 'V1' }, { id: 'S-LIB', title: 'General Knowledge', question_count: 400, owner_venue_id: null }, { id: 'S-OTHER', title: 'Another pub', owner_venue_id: 'V2' }] : [] }).then(r); } }; return b; } };
  var window = { localStorage: storage, document: document, fetch: fetch, location: { reload: function () { RELOADS++; } } };
  (new Function('window', 'document', GAMING))(window, document);
  (new Function('window', SETUPUSE))(window);
  (new Function('window', HELP))(window);
  (new Function('window', GS))(window);
  var ctx = { role: over.role || 'owner', venue: Object.assign({ id: 'V1', name: 'The Test Arms', au_state: 'QLD', entity_type: 'for_profit' }, over.venue || {}), settings: { setup_answers: over.answers || {} } };
  var deps = { doc: document, storage: storage, fetch: fetch, client: client, now: NOW, ctx: ctx,
    saveSettings: function (id, patch) { if (!patch.setup_answers) { COLLECTED.push({ id: id, patch: JSON.parse(JSON.stringify(patch)) }); return over.collectFail ? Promise.reject(new Error('refused')) : Promise.resolve({}); } SAVED.push({ id: id, patch: JSON.parse(JSON.stringify(patch)) }); return over.saveFail ? Promise.reject(new Error('no column')) : Promise.resolve({}); },
    onSaved: function () { RELOADS++; } };
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

(async function () {
  section('1. THE SHARED SETTINGS LIST (vp-setup-help.js)');
  var P = page(), H = P.H;
  check('five games, in Dean\'s order: trivia, musical bingo, bingo, raffles, members draws', H.GAMES.map(function (g) { return g.key; }).join() === 'trivia,musical,bingo,raffles,members', H.GAMES.map(function (g) { return g.key; }));
  check('musical bingo is "musical bingo" and bingo is "bingo", never the same name', H.byKey('musical').name === 'musical bingo' && H.byKey('bingo').name === 'bingo');
  var notKept = [];
  H.GAMES.forEach(function (g) {
    g.settings.forEach(function (s) {
      if (s.kind === 'info' || s.setupOnly) return;   // setupOnly: kept in setup_answers, never sent
      if (s.kind === 'raffleplan') { ['raffle_counts', 'raffle_prizes', 'prizes', 'prize_count', 'prizes_same'].forEach(function (k) { if (!WK.KEYS[g.prefs][k]) notKept.push(g.key + '.' + k); }); return; }   // round 10: saved as these
      (s.keys || [s.key]).forEach(function (k) {
        if (g.needsDetails) { if (membersFn.indexOf("'" + k + "'") < 0 && membersFn.indexOf('b.' + k) < 0) notKept.push(g.key + '.' + k); }
        else if (!WK.KEYS[g.prefs] || !WK.KEYS[g.prefs][k]) notKept.push(g.key + '.' + k);
      });
    });
  });
  check('every setting is saved under a key the game Worker keeps (or that /host/members/settings reads)', notKept.length === 0, notKept);
  var drift = [];
  ['trivia', 'musical', 'bingo', 'raffles'].forEach(function (k) { var d = H.defaults(k), c = WK.clean(H.byKey(k).prefs, d); function srt(o) { var r = {}; Object.keys(o).sort().forEach(function (x) { r[x] = o[x]; }); return JSON.stringify(r); } if (srt(c) !== srt(d)) drift.push(k + ' ' + JSON.stringify(d) + ' -> ' + JSON.stringify(c)); });
  check('today\'s defaults pass the Worker\'s own cleaning unchanged, so "saved" is what is saved', drift.length === 0, drift);
  check('members draws have no defaults today, so none are written for them', JSON.stringify(H.defaults('members')) === '{}');
  var TRI = readFile('venueplay/app/trivia/host.html'), RAF = readFile('venueplay/app/raffle/host.html');
  function boxValue(html, id) { var m = new RegExp('id="' + id + '"[^>]*value="([^"]*)"').exec(html) || new RegExp('value="([^"]*)"[^>]*id="' + id + '"').exec(html); return m ? m[1] : null; }
  var td = H.defaults('trivia'), rd = H.defaults('raffles');
  check('the defaults are the consoles\' own: trivia 10 questions, 30 seconds, 100 points', String(td.count) === boxValue(TRI, 'cfgCount') && String(td.time_s) === boxValue(TRI, 'cfgTime') && String(td.base_points) === boxValue(TRI, 'cfgBase'), [td, boxValue(TRI, 'cfgCount'), boxValue(TRI, 'cfgTime'), boxValue(TRI, 'cfgBase')]);
  check('and raffles 180 seconds to claim; ticket numbers are not asked in setup (Dean, round 8b point 7: the console carries them on)', String(rd.time_to_present) === boxValue(RAF, 'rfTime') && !('range_min' in rd) && !('range_max' in rd), [rd]);
  var badWords = [];
  H.GAMES.forEach(function (g) { g.settings.forEach(function (s) {
    var w = s.help + ' ' + (s.prompt || '') + ' ' + s.label;
    var sentences = s.help.split(/[.!?](\s|$)/).filter(function (x) { return x && x.trim(); }).length;
    if (!s.help || s.help.length > 200 || sentences > 2) badWords.push(g.key + '.' + s.key + ' too long');
    if (/[—–]/.test(w) || /roster/i.test(w) || /VenuePlay|Venueplay/.test(w) || /\bthe ACT\b/.test(w)) badWords.push(g.key + '.' + s.key + ' house words');
    if (s.advanced && s.kind !== 'number' && !s.prompt && s.key !== 'jackpot_amount_cents') badWords.push(g.key + '.' + s.key + ' no prompt');
  }); });
  check('every "?" is one or two plain lines (under 200 characters), no dashes, never "roster", lowercase venueplay', badWords.length === 0, badWords);
  check('three "?" chosen for each game\'s mock-up are real settings of that game', H.GAMES.every(function (g) { return g.popovers.length === 3 && g.popovers.every(function (k) { return g.settings.some(function (s) { return s.key === k; }); }); }));

  section('2. THE HEADS-UP, FIRST');
  P = page(); var done = P.GS.run(P.ctx, P.deps); await settle();
  check('it opens on the heads-up, titled with the venue', T(P, 'vpGsTitle') === 'Welcome to venueplay, The Test Arms', T(P, 'vpGsTitle'));
  var hu = T(P, 'vpGsHeadsUp');
  check('each game takes less than five minutes', /Each game takes less than five minutes to set up\./.test(hu), hu);
  check('members draw details, while they may run members draws', /Running members draws\? Have your draw details handy/.test(hu), hu);
  check('you don\'t need to do it all now: each game can be set up the first time it is opened (Dean, round 2)', /You don't need to do it all now\. You can set up each game the first time you open it\./.test(hu), hu);
  check('advertising for the screen step: promo images and logo', /For your screen, have your advertising handy: your promo images and your logo\./.test(hu), hu);
  check('"Then you\'re ready for your week."', /Then you're ready for your week\./.test(T(P, 'vpGsBody')));
  var P2 = page({ answers: { games: ['trivia', 'bingo'] } }); P2.GS.run(P2.ctx, P2.deps); await settle();
  check('a venue already known not to run members draws is not told to find members draw details', !/members draws/.test(T(P2, 'vpGsHeadsUp')) && /less than five minutes/.test(T(P2, 'vpGsHeadsUp')), T(P2, 'vpGsHeadsUp'));

  section('3. "What games do you play at your venue?"');
  $(P, 'vpGsGo').click(); await settle();
  check('pub or club first, then the games (Dean, round 8b point 2), left out once the venue\'s record says (round 9 point 3)', (P.ctx.venue.entity_type ? T(P, 'vpGsTitle') === 'What games do you play?' && !$(P, 'vpGsKind') : T(P, 'vpGsTitle') === 'Are you a pub or a club?' && /What games do you play\?/.test(T(P, 'vpGsBody'))), T(P, 'vpGsTitle'));
  var ticks = all($(P, 'vpGsGames'), function (e) { return e.getAttribute && e.getAttribute('role') === 'checkbox'; }).map(function (e) { return seen(e); });
  check('ticks: Trivia, Musical bingo, Bingo, Raffles, Members draws (jag the joker only once it is live); other nights are their own question (Dean, round 8b point 3)', ticks.join() === 'Trivia,Musical bingo,Bingo,Raffles,Members draws', ticks);
  check('Next waits for a tick', $(P, 'vpGsNext').disabled === true);
  gameBtn(P, 'members').click(); gameBtn(P, 'trivia').click(); gameBtn(P, 'musical').click();
  check('a tick shows ticked', gameBtn(P, 'trivia').getAttribute('aria-checked') === 'true' && gameBtn(P, 'bingo').getAttribute('aria-checked') === 'false');
  $(P, 'vpGsNext').click(); if ($(P, 'vpGsWeekSkip')) passWeek(P, 'vpGsWeekSkip'); await settle();
  var sa = SAVED.length ? SAVED[SAVED.length - 1].patch.setup_answers : null;
  check('STORED for the venue: setup_answers.games in Dean\'s order, whatever order they were tapped', sa && sa.games.join() === 'trivia,musical,members', sa);
  check('with games_at, the Brisbane date (1:30am Saturday is the 7th)', sa && sa.games_at === '2026-11-07', sa && sa.games_at);
  check('saved for the venue it is for, only', SAVED.every(function (s) { return s.id === 'V1'; }));

  section('4. "Would you like to set them all up today?" Not today, then "No worries."');
  check('the second question, naming their games', T(P, 'vpGsTitle') === 'Now let\'s set up your games.' && /You picked trivia, musical bingo and members draws\./.test(T(P, 'vpGsBody')), T(P, 'vpGsBody'));
  PREFS.trivia = { count: 20 };   // a value the venue already chose
  $(P, 'vpGsAllNo').click(); await settle();
  check('"No worries." in Dean\'s words, naming the games with defaults', T(P, 'vpGsTitle') === 'No worries.' && T(P, 'vpGsNoWorries') === "We'll remind you when you open each of those games. Your default settings have been saved for trivia and musical bingo.", T(P, 'vpGsNoWorries'));
  check('members draws are never called saved: they have no defaults, and are named apart', /Members draws still need your draw details \(the draw name, time and jackpot\)/.test(T(P, 'vpGsMembersNote')), T(P, 'vpGsMembersNote'));
  var tp = posts('/host/game-prefs').filter(function (c) { return c.body.game === 'trivia'; })[0];
  check('today\'s trivia defaults written for the keys not saved yet', tp && tp.body.prefs.time_s === 30 && tp.body.prefs.speed_bonus === true && tp.body.venue_id === 'V1', tp && tp.body);
  check('and never over a value the venue chose (their 20 questions stay 20)', tp && !('count' in tp.body.prefs) && PREFS.trivia.count === 20, tp && tp.body.prefs);
  check('nothing written for members draws, and nothing to /host/members/settings', !posts('/host/game-prefs').some(function (c) { return c.body.game === 'members'; }) && posts('/host/members/settings').length === 0);
  check('each Worker call carries the signed-in token', CALLS.filter(function (c) { return /host\//.test(c.url); }).every(function (c) { return c.auth === 'Bearer TOKEN-1'; }));
  sa = SAVED[SAVED.length - 1].patch.setup_answers;
  check('all three kept as "later", so each opens its own setup the first time', sa.setup && sa.setup.trivia === 'later' && sa.setup.musical === 'later' && sa.setup.members === 'later', sa.setup);
  var P3 = page({ prefsReadFail: true, answers: { games: ['trivia'] } }); P3.GS.run(P3.ctx, P3.deps); await settle(); $(P3, 'vpGsGo').click(); $(P3, 'vpGsNext').click(); if ($(P3, 'vpGsWeekSkip')) passWeek(P3, 'vpGsWeekSkip'); $(P3, 'vpGsAllNo').click(); await settle();
  check('when what the venue has cannot be read, nothing is written over it', posts('/host/game-prefs').length === 0, posts('/host/game-prefs'));
  $(P, 'vpGsDone').click(); var outcome = await done;
  check('"Go to my console" closes it', outcome === 'done' && !$(P, 'vpGs'), outcome);

  section('5. ONE GAME AT A TIME, every setting with a "?"');
  P = page(); done = P.GS.run(P.ctx, P.deps); await settle();
  $(P, 'vpGsGo').click(); gameBtn(P, 'trivia').click(); gameBtn(P, 'musical').click(); gameBtn(P, 'members').click(); $(P, 'vpGsNext').click(); if ($(P, 'vpGsWeekSkip')) passWeek(P, 'vpGsWeekSkip'); await settle();
  $(P, 'vpGsAllYes').click(); await settle();
  check('trivia first, "Game 1 of 3"', T(P, 'vpGsTitle') === 'Set up trivia' && T(P, 'vpGsCount') === 'Trivia, game 1 of 3', [T(P, 'vpGsTitle'), T(P, 'vpGsCount')]);
  var qs = all($(P, 'vpGsBody'), function (e) { return e.className === 'vpgs-q'; });
  check('a "?" beside every trivia setting (' + P.H.byKey('trivia').settings.length + '), and no "Same prizes for other games?" (Dean, round 7b point 7)', qs.length === P.H.byKey('trivia').settings.filter(function (x) { return !x.perNight && !x.notYet && x.kind !== 'info'; }).length && !$(P, 'vpGsShared'), qs.length);
  check('the advanced ones as short questions', /Faster scores more/.test(T(P, 'vpGsBody')) && /More settings/.test(T(P, 'vpGsBody')));
  var qSpeed = $(P, 'vpGsQ_speed_bonus'), qBuzz = $(P, 'vpGsQ_buzzer');
  qSpeed.click();
  check('tapping "?" opens its plain words', $(P, 'vpGsHelp_speed_bonus').style.display === 'block' && qSpeed.getAttribute('aria-expanded') === 'true' && /A quick right answer scores up to half as much again\./.test(T(P, 'vpGsHelp_speed_bonus')), T(P, 'vpGsHelp_speed_bonus'));
  qBuzz.click();
  check('one open at a time', $(P, 'vpGsHelp_speed_bonus').style.display === 'none' && $(P, 'vpGsHelp_buzzer').style.display === 'block');
  qBuzz.click();
  check('tapping it again closes it', $(P, 'vpGsHelp_buzzer').style.display === 'none' && qBuzz.getAttribute('aria-expanded') === 'false');
  check('the mix or categories are NOT asked in setup: they are picked every night, on the night\'s start screen (Dean, round 11 note 4)', !$(P, 'vpGsIn_set_ids') && !$(P, 'vpGsHelp_set_mode'));
  $(P, 'vpGsIn_prizes_0').value = '$50 bar tab';
  $(P, 'vpGsIn_count').value = '15';
  walk($(P, 'vpGsBody'), function (e) { return e.textContent === 'On' && e.parentNode && e.parentNode.parentNode && e.parentNode.parentNode.parentNode && e.parentNode.parentNode.parentNode.getAttribute && e.parentNode.parentNode.parentNode.getAttribute('data-key') === 'buzzer'; }).click();
  CALLS = []; $(P, 'vpGsSave').click(); await settle();
  var sv = posts('/host/game-prefs')[0];
  check('Save sends trivia\'s values to /host/game-prefs for this venue', sv && sv.body.game === 'trivia' && sv.body.venue_id === 'V1' && sv.body.prefs.count === 15 && sv.body.prefs.buzzer === true && sv.body.prefs.time_s === 30, sv && sv.body);
  check('no category sent, so the console keeps choosing on the night', sv && !('set_id' in sv.body.prefs) && !('set_ids' in sv.body.prefs) && !('set_mode' in sv.body.prefs));
  check('no theme nights asked in setup (Dean, round 7b point 5: later, by email); the usual prizes kept as prize buttons', !$(P, 'vpGsIn_theme_nights') && sv && JSON.stringify(sv.body.prefs.prize_list) === '["$50 bar tab"]' && sv.body.prefs.rounds === 3, sv && sv.body.prefs);
  check('then "Do you want to set up your next game?", naming what is left', T(P, 'vpGsTitle') === 'Would you like to set up another game?' && /You still have musical bingo and members draws\./.test(T(P, 'vpGsBody')), T(P, 'vpGsBody'));
  check('the answers sit right under the question, the next game named: "Yes, set up musical bingo", "That\'s enough for today"; the bar keeps only Back (Dean, round 9b)', T(P, 'vpGsNextYes') === 'Yes, set up musical bingo' && /vpgs-answers/.test($(P, 'vpGsNextYes').parentNode.className) && $(P, 'vpGsNextNo').parentNode === $(P, 'vpGsNextYes').parentNode && !!$(P, 'vpGsBack') && /vpgs-foot/.test($(P, 'vpGsBack').parentNode.className), T(P, 'vpGsNextYes'));
  var which = all($(P, 'vpGsGamePicks'), function (e) { return e.getAttribute && e.getAttribute('data-game'); }).map(function (e) { return e.getAttribute('data-game'); });
  check('a Yes button for each game left, in game order (Dean, round 11 note 2)', T(P, 'vpGsTitle') === 'Would you like to set up another game?' && which.join() === 'musical,members' && T(P, 'vpGsNextYes') === 'Yes, set up musical bingo' && T(P, 'vpGsNextYes_members') === 'Yes, set up members draws', which);
  walk($(P, 'vpGsGamePicks'), function (e) { return e.getAttribute && e.getAttribute('data-game') === 'members'; }).click(); await settle();
  check('members draws, as game 3 of 3', T(P, 'vpGsTitle') === 'Set up members draws' && T(P, 'vpGsCount') === 'Members draws, game 3 of 3', [T(P, 'vpGsTitle'), T(P, 'vpGsCount')]);
  CALLS = []; $(P, 'vpGsSave').click(); await settle();
  check('a members draw with no name is refused on the page, nothing sent', posts('/host/members/settings').length === 0 && /name/.test(T(P, 'vpGsMsg')), T(P, 'vpGsMsg'));
  $(P, 'vpGsIn_name').value = 'Friday Members Draw'; $(P, 'vpGsIn_starting_amount_cents').value = '250';
  $(P, 'vpGsSave').click(); await settle();
  var ms = posts('/host/members/settings')[0];
  check('the draw is made through /host/members/settings: name, $250 as 25000 cents; the time to reach the host is left to the console (spacing review r8)', ms && ms.body.venue_id === 'V1' && ms.body.name === 'Friday Members Draw' && ms.body.starting_amount_cents === 25000 && !('time_to_claim_seconds' in ms.body) && !$(P, 'vpGsIn_time_to_claim_seconds') && !ms.body.draw_id, ms && ms.body);
  check('blank boxes are not sent (members draws have no defaults to invent)', ms && !('increment_cents' in ms.body) && !('max_jackpot_cents' in ms.body));
  check('after members draws: "Update your members list later", easiest on a computer, nothing pushed (Dean, round 8b point 14)', T(P, 'vpGsTitle') === 'Update your members list later' && /on a computer/.test(T(P, 'vpGsBody')) && /vpgs-wideonly/.test($(P, 'vpGsExtrasYes').className), T(P, 'vpGsTitle'));
  $(P, 'vpGsExtrasNo').click(); await settle();
  check('one game left: asked again, between games of this first run', T(P, 'vpGsTitle') === 'Would you like to set up another game?' && /musical bingo\./.test(T(P, 'vpGsBody')));
  $(P, 'vpGsNextNo').click(); await settle();
  check('No: "No worries." for musical bingo, its defaults saved', T(P, 'vpGsTitle') === 'No worries.' && /saved for musical bingo\./.test(T(P, 'vpGsNoWorries')) && !$(P, 'vpGsMembersNote'), T(P, 'vpGsNoWorries'));
  sa = SAVED[SAVED.length - 1].patch.setup_answers;
  check('trivia and members draws "done", musical bingo "later"', sa.setup.trivia === 'done' && sa.setup.members === 'done' && sa.setup.musical === 'later', sa.setup);
  var P4 = page({ membersRefuse: true }); P4.GS.run(P4.ctx, Object.assign(P4.deps, { start: 'pick' })); await settle();
  gameBtn(P4, 'members').click(); $(P4, 'vpGsNext').click(); if ($(P4, 'vpGsWeekSkip')) passWeek(P4, 'vpGsWeekSkip'); $(P4, 'vpGsAllYes').click(); await settle();
  $(P4, 'vpGsIn_name').value = 'Draw'; $(P4, 'vpGsSave').click(); await settle();
  check('the Worker\'s own refusal is shown, and it stays on the game', /Only a manager or owner/.test(T(P4, 'vpGsMsg')) && T(P4, 'vpGsTitle') === 'Set up members draws', T(P4, 'vpGsMsg'));
  var P5 = page(); P5.GS.run(P5.ctx, Object.assign(P5.deps, { start: 'pick' })); await settle();
  gameBtn(P5, 'bingo').click(); $(P5, 'vpGsNext').click(); if ($(P5, 'vpGsWeekSkip')) passWeek(P5, 'vpGsWeekSkip'); $(P5, 'vpGsAllYes').click(); await settle(); $(P5, 'vpGsSave').click(); await settle();
  check('the last game saved: "You\'re ready for your week." and no next-game question', T(P5, 'vpGsTitle') === "You're ready for your week.", T(P5, 'vpGsTitle'));

  section('6. THE FIRST TIME A SKIPPED GAME IS OPENED');
  P = page({ answers: { games: ['musical'], setup: { musical: 'later' } } });
  var fo = P.GS.firstOpen('musical', P.deps); await settle();
  check('musical bingo\'s own setup opens over its console', T(P, 'vpGsTitle') === 'Set up musical bingo' && !$(P, 'vpGsFirstTag'), T(P, 'vpGsTitle'));
  check('marked "shown" before anything else, for the venue and this device', SAVED.length && SAVED[0].patch.setup_answers.setup.musical === 'shown' && JSON.parse(STORE['vpGameSetup:V1']).setup.musical === 'shown', SAVED[0]);
  var asked = all($(P, 'vpGsBody'), function (e) { return e.getAttribute && e.getAttribute('data-key'); }).map(function (e) { return e.getAttribute('data-key'); });
  check('musical bingo asks its quick questions first: which music, how many rounds, the prizes, and the same prizes every week (Dean, round 8b point 8); the speakers guide lives in More settings', asked.join() === 'playlists,rounds,prize_same,prize_weekly,prizes' && !$(P, 'vpGsSoundHow'), asked);
  await settle();
  var music = all($(P, 'vpGsIn_playlists'), function (e) { return e.getAttribute && e.getAttribute('data-id'); }).map(function (e) { return e.getAttribute('data-id'); });
  await settle(); await settle();
  check('the first open: three choices across, "All the hits" first and ticked (Dean, round 3)', /q3/.test($(P, 'vpGsIn_playlists').className) && all($(P, 'vpGsIn_playlists'), function (e) { return e.getAttribute && e.getAttribute('data-id') && e.style.display !== 'none'; }).map(function (e) { return e.getAttribute('data-id'); }).join() === 'all-the-hits,pub-classics,80s-pop' && walk($(P, 'vpGsIn_playlists'), function (e) { return e.getAttribute && e.getAttribute('data-id') === 'all-the-hits'; }).getAttribute('aria-checked') === 'true');
  check('short: three popular lists first, the rest behind "Show all"', $(P, 'vpGsMoreMusic').textContent === '+ 4 more kinds of music' && walk($(P, 'vpGsIn_playlists'), function (e) { return e.getAttribute && e.getAttribute('data-id') === 'country'; }).style.display === 'none');
  $(P, 'vpGsMoreMusic').click();
  check('"Show all" shows every list', walk($(P, 'vpGsIn_playlists'), function (e) { return e.getAttribute && e.getAttribute('data-id') === 'country'; }).style.display === '' && $(P, 'vpGsMoreMusic').style.display === 'none');
  check('the music from the song library, a bad id never offered', music.join() === 'all-the-hits,pub-classics,80s-pop,90s,2000s,aussie,country', music);
  check('a BIG "Play now with the defaults" button, not a small link', /^Play now with the defaults/.test(T(P, 'vpGsPlayNow')) && / big/.test($(P, 'vpGsPlayNow').className), [T(P, 'vpGsPlayNow'), $(P, 'vpGsPlayNow').className]);
  CALLS = []; $(P, 'vpGsPlayNow').click(); await settle();
  var dp = posts('/host/game-prefs')[0];
  check('Play now: the defaults saved where nothing was, the popular songs (All the hits, Pub Classics, 80s, 90s, 2000s, a different one each week), then straight to the console', (await fo) === 'defaults' && !$(P, 'vpGs') && dp && dp.body.prefs.playlist === 'all-the-hits' && dp.body.prefs.playlists.join() === 'all-the-hits,pub-classics,80s-pop,90s,2000s' && dp.body.prefs.rounds === 3 && dp.body.prefs.prize_same === false, dp && dp.body);
  P.ctx.settings.setup_answers.setup.musical = 'later';   // even if the venue's save was refused (163 not run)
  check('never again on this device', (await P.GS.firstOpen('musical', P.deps)) === 'none' && !$(P, 'vpGs'));
  var P6 = page({ answers: { setup: { trivia: 'later' } }, role: 'host' });
  check('a host opening the console on a busy night is never stopped by it', (await P6.GS.firstOpen('trivia', P6.deps)) === 'none' && !$(P6, 'vpGs'));
  var P7 = page({ answers: { setup: { trivia: 'done', raffles: 'shown' } } });
  check('a game already set up, or already shown, opens nothing', (await P7.GS.firstOpen('trivia', P7.deps)) === 'none' && (await P7.GS.firstOpen('raffles', P7.deps)) === 'none' && (await P7.GS.firstOpen('bingo', P7.deps)) === 'none');
  var P8 = page({ answers: { setup: { raffles: 'later' } } }); var fo8 = P8.GS.firstOpen('raffles', P8.deps); await settle();
  $(P8, 'vpGsSave').click(); await settle();
  var rp = posts('/host/game-prefs')[0];
  check('Save: raffles settings sent, the console takes them (reload), and it is "done"', (await fo8) === 'saved' && RELOADS === 1 && rp.body.game === 'raffle' && !('range_max' in rp.body.prefs) && JSON.stringify(rp.body.prefs.raffle_counts) === '[1]' && !('prizes' in rp.body.prefs) && JSON.parse(STORE['vpGameSetup:V1']).setup.raffles === 'done', rp && rp.body);
  var P9 = page({ answers: { setup: { bingo: 'later' } } }); P9.GS.firstOpen('bingo', P9.deps); await settle();
  check('bingo\'s first open has the same state-aware setup (who draws the numbers, for paper)', !!$(P9, 'vpGsQ_caller') && T(P9, 'vpGsTitle') === 'Set up bingo', T(P9, 'vpGsBody').slice(0, 200));
  var P15 = page({ answers: { setup: { members: 'later' } } }); P15.GS.firstOpen('members', P15.deps); await settle();
  var mk = all($(P15, 'vpGsBody'), function (e) { return e.getAttribute && e.getAttribute('data-key'); }).map(function (e) { return e.getAttribute('data-key'); });
  check('members draws on their first open: the name, when it started, the jackpot now and how much it goes up each week (Dean, round 7b point 18)', mk.join() === 'name,date_started,current_jackpot_cents,increment_cents' && /A few quick questions before your first draw/.test(T(P15, 'vpGsLead')), mk);
  check('musical bingo prizes: "Different each round" or "Same every round" (short, one line each)', JSON.stringify(P.H.byKey('musical').settings.filter(function (x) { return x.key === 'prize_same'; })[0].options.map(function (o) { return o[1]; })) === '["Different","The same"]');
  check('setup states keep only known games and states', JSON.stringify(P.GS.cleanSetup({ trivia: 'done', musical: 'x', jag: 'done', bingo: 'later' })) === '{"trivia":"done","bingo":"later"}');

  section('6b. ROUND 2 (Dean, 6 Nov 2026): something else, prizes per round, raffle prizes, phone or paper bingo, the draw date');
  P = page(); P.GS.run(P.ctx, Object.assign(P.deps, { start: 'pick' })); await settle();
  check('"Do you run any other nights?" is always there, nothing needed to go on until something is ticked or typed', $(P, 'vpGsOther').parentNode.style.display === '' && $(P, 'vpGsNext').disabled === true);
  $(P, 'vpGsOther').value = '  Karaoke <b>and</b> poker nights, plus a footy tipping comp every week of the season  ';
  (($(P, 'vpGsOther').handlers.input) || []).forEach(function (f) { f(); });
  check('a "Something else" answer on its own is enough to go on', $(P, 'vpGsNext').disabled === false);
  gameBtn(P, 'musical').click(); gameBtn(P, 'raffles').click(); gameBtn(P, 'bingo').click(); gameBtn(P, 'members').click();
  $(P, 'vpGsNext').click(); if ($(P, 'vpGsWeekSkip')) passWeek(P, 'vpGsWeekSkip'); await settle();
  sa = SAVED[SAVED.length - 1].patch.setup_answers;
  check('kept as setup_answers.other: cleaned, no markup, at most 60 characters', sa.other && sa.other.length <= 60 && !/[<>]/.test(sa.other) && /^Karaoke b and \/b poker nights/.test(sa.other), sa.other);
  $(P, 'vpGsAllYes').click(); await settle();
  check('musical bingo first (game 1 of 4)', T(P, 'vpGsTitle') === 'Set up musical bingo' && T(P, 'vpGsCount') === 'Musical bingo, game 1 of 4', [T(P, 'vpGsTitle'), T(P, 'vpGsCount')]);
  check('no pattern asked: it is picked on the night with the crowd (Dean, round 3)', !$(P, 'vpGsQ_pattern'));
  check('three rounds to start, a prize for each, one under the other ("Same prize every round?" starts on No)', $(P, 'vpGsIn_prizes').children.length === 3 && $(P, 'vpGsIn_prizes_2').getAttribute('aria-label') === 'Round 3 prize', $(P, 'vpGsIn_prizes').children.length);
  $(P, 'vpGsNone_0').checked = true; $(P, 'vpGsNone_0').handlers.change.forEach(function (f) { f(); });
  check('"No prize" for a round greys its box', $(P, 'vpGsIn_prizes_0').disabled === true);
  $(P, 'vpGsIn_prizes_1').value = '$20 bar tab'; $(P, 'vpGsIn_prizes_2').value = 'Meat tray';
  ['all-the-hits', 'pub-classics', '80s-pop', '90s', '2000s'].forEach(function (id) { walk($(P, 'vpGsIn_playlists'), function (e) { return e.getAttribute && e.getAttribute('data-id') === id; }).click(); });   // untick the popular ones: nothing picked
  CALLS = []; $(P, 'vpGsSave').click(); await settle();
  var mp = posts('/host/game-prefs')[0];
  check('saved: rounds 3, round 1 no prize, then $20 bar tab and Meat tray; the first real prize as the console\'s prize', mp && mp.body.prefs.rounds === 3 && mp.body.prefs.prizes.join('|') === '|$20 bar tab|Meat tray' && JSON.stringify(mp.body.prefs.prize_none) === '[1]' && mp.body.prefs.prize === '$20 bar tab' && mp.body.prefs.prize_same === false, mp && mp.body);
  check('the musical bingo Worker keeps all of it, no-prize rounds included', mp && srtj(WK.clean('musical', mp.body.prefs)) === srtj(mp.body.prefs), mp && WK.clean('musical', mp.body.prefs));
  check('no music picked: nothing sent for it, the console keeps choosing', mp && !('playlists' in mp.body.prefs) && !('playlist' in mp.body.prefs), mp && mp.body);
  walk($(P, 'vpGsGamePicks'), function (e) { return e.getAttribute && e.getAttribute('data-game') === 'bingo'; }).click(); await settle();
  check('bingo with phone tickets: no question about who draws the numbers (it does not apply)', $(P, 'vpGsQ_caller').parentNode.style.display === 'none');
  check('phone tickets: tickets each player is asked, no paper words', $(P, 'vpGsIn_cards').parentNode.parentNode.style.display === '' && walk($(P, 'vpGsBody'), function (e) { return e.getAttribute && e.getAttribute('data-key') === 'paper_note'; }).style.display === 'none');
  walk($(P, 'vpGsBody'), function (e) { return e.getAttribute && e.getAttribute('data-value') === 'paper'; }).click();
  check('paper tickets (the venue\'s own books): one short line, "Your own books. Your caller checks a win; the numbers show on the TV.", and who draws them (spacing review r8)', /Your own books\. Your caller checks a win; the numbers show on the TV\./.test(T(P, 'vpGsBody')) && !!$(P, 'vpGsQ_caller'));
  check('no More settings on bingo at all: early BINGO calls are left to the console (spacing review r8)', !$(P, 'vpGsAdvanced') && !$(P, 'vpGsQ_allow_early'));
  CALLS = []; $(P, 'vpGsSave').click(); await settle();
  var bp = posts('/host/game-prefs')[0];
  check('saved as paper, venueplay drawing the numbers, no tickets-per-player for paper books (Dean, round 3)', bp && bp.body.prefs.ticket_kind === 'paper' && bp.body.prefs.caller === false && !('cards' in bp.body.prefs) && !('allow_early' in bp.body.prefs) && srtj(WK.clean('bingo', bp.body.prefs)) === srtj(bp.body.prefs), bp && bp.body);
  walk($(P, 'vpGsGamePicks'), function (e) { return e.getAttribute && e.getAttribute('data-game') === 'raffles'; }).click(); await settle();
  $(P, 'vpGsIn_raffles').value = '3'; $(P, 'vpGsIn_raffles').handlers.input.forEach(function (f) { f(); });
  check('three raffles a night: each asks how many prizes, nothing filled in (Dean, round 9 point 20)', $(P, 'vpGsIn_raffle_plan').children.length === 3 && !!$(P, 'vpGsRafN_2') && !$(P, 'vpGsRafSame_0') && $(P, 'vpGsRafP_0_0').value === '' && !$(P, 'vpGsIn_range_min'));
  function rafN(i, n) { var e = $(P, 'vpGsRafN_' + i); e.value = String(n); (e.handlers.change || []).forEach(function (f) { f(); }); }
  rafN(0, 2);
  check('two prizes in raffle 1: "Are all the prizes the same?", Yes to start, one box', !!$(P, 'vpGsRafSame_0') && /Are all the prizes the same\?/.test(T(P, 'vpGsIn_raffle_plan')) && !!$(P, 'vpGsRafP_0_0') && !$(P, 'vpGsRafP_0_1'));
  walk($(P, 'vpGsRafSame_0'), function (e) { return e.getAttribute && e.getAttribute('data-value') === 'false'; }).click();
  check('No: a box for each prize', !!$(P, 'vpGsRafP_0_1'));
  $(P, 'vpGsRafP_0_0').value = 'Meat tray'; $(P, 'vpGsRafP_0_1').value = 'Hamper';
  rafN(1, 5);
  check('raffle 2 asks the same questions (Dean, round 9 point 20: the second raffle of the night)', !!$(P, 'vpGsRafSame_1') && $(P, 'vpGsRafP_0_1').value === 'Hamper');
  $(P, 'vpGsRafP_1_0').value = 'Fuel voucher';
  walk($(P, 'vpGsUsual_raffle_plan'), function (e) { return e.getAttribute && e.getAttribute('data-item') === "Winner's choice"; }).click();
  check('"Winner\'s choice" is one tap and lands in the next empty prize box', $(P, 'vpGsRafP_2_0').value === "Winner's choice" && / vpgs-filled/.test($(P, 'vpGsRafP_2_0').className) && !/ vpgs-filled/.test($(P, 'vpGsRafP_1_0').className), $(P, 'vpGsRafP_2_0').value);
  CALLS = []; $(P, 'vpGsSave').click(); await settle();
  var rr = posts('/host/game-prefs')[0];
  check('raffle 1 has 2 prizes, raffle 2 has 5 the same, raffle 3 has 1, each raffle\'s prizes kept, and all of them the console\'s buttons', rr && rr.body.prefs.prizes.join('|') === "Meat tray|Hamper|Fuel voucher|Winner's choice" && JSON.stringify(rr.body.prefs.raffle_counts) === '[2,5,1]' && JSON.stringify(rr.body.prefs.raffle_prizes) === JSON.stringify([['Meat tray', 'Hamper'], ['Fuel voucher', 'Fuel voucher', 'Fuel voucher', 'Fuel voucher', 'Fuel voucher'], ["Winner's choice"]]) && rr.body.prefs.raffles === 3 && rr.body.prefs.prize_count === 5 && rr.body.prefs.prizes_same === false && rr.body.prefs.time_to_present === 180 && rr.body.prefs.prizes_weekly === true, rr && rr.body);
  check('the raffle Worker keeps all of it', rr && srtj(WK.clean('raffle', rr.body.prefs)) === srtj(rr.body.prefs), rr && WK.clean('raffle', rr.body.prefs));
  walk($(P, 'vpGsGamePicks'), function (e) { return e.getAttribute && e.getAttribute('data-game') === 'members'; }).click(); await settle();
  check('members draws: no draw-day question (the night comes from the nights step)', !$(P, 'vpGsIn_draw_day') && !$(P, 'vpGsQ_draw_day'));

  section('6c. WHICH GAME RUNS ON WHICH NIGHT (Dean, 6 Nov 2026), right after the games question, skippable');
  P = page(); P.GS.run(P.ctx, Object.assign(P.deps, { start: 'pick' })); await settle();
  gameBtn(P, 'trivia').click(); gameBtn(P, 'musical').click(); gameBtn(P, 'members').click();
  SAVED = []; P.doc.getElementById('vpGsNext').click(); await settle();
  check('asked right after the games question', T(P, 'vpGsTitle') === 'Which nights do you run them?', T(P, 'vpGsTitle'));
  var wk = all($(P, 'vpGsWeek'), function (e) { return e.getAttribute && e.getAttribute('data-game') && e.className === 'vpgs-row'; }).map(function (e) { return e.getAttribute('data-game'); });
  check('one row per game they ticked, in the house order', wk.join() === 'trivia,musical,members', wk);
  function day(g, d) { return walk($(P, 'vpGsWeek'), function (e) { return e.getAttribute && e.getAttribute('aria-label') && e.getAttribute('data-day') === d && e.parentNode.parentNode.getAttribute('data-game') === g; }); }
  day('trivia', 'wed').click(); day('musical', 'fri').click(); day('members', 'fri').click(); day('members', 'mon').click(); day('members', 'mon').click();
  check('a night tapped twice is off again, and each night on asks its start time', !$(P, 'vpGsTime_members_mon') && !!$(P, 'vpGsTime_trivia_wed') && !!$(P, 'vpGsTime_members_fri'));
  $(P, 'vpGsTime_trivia_wed').value = '19:00'; $(P, 'vpGsTime_trivia_wed').handlers.input.forEach(function (f) { f(); });
  $(P, 'vpGsTime_musical_fri').value = '19:30'; $(P, 'vpGsTime_musical_fri').handlers.change.forEach(function (f) { f(); });
  check('EVERY game night needs a start time, members draws too: Next waits, and says so (Dean, round 3)', $(P, 'vpGsWeekNext').disabled === true && /Add a start time for each night you ticked/.test(T(P, 'vpGsWeekMsg')), T(P, 'vpGsWeekMsg'));
  var tsel = $(P, 'vpGsTime_members_fri'), topts = tsel ? tsel.children.map(function (o) { return o.value; }) : [];
  check('a time box of the hour and half hour only, pm first, so typing 7 is 7:00 pm (Dean, round 9 point 5)', tsel && tsel.tagName === 'SELECT' && topts[0] === '' && topts[1] === '12:00' && topts[2] === '12:30' && topts.length === 49 && topts.every(function (t) { return t === '' || /:(00|30)$/.test(t); }) && tsel.children.filter(function (o) { return /^7/.test(o.textContent); })[0].textContent === '7:00 pm', topts.slice(0, 5));
  $(P, 'vpGsTime_members_fri').value = '20:00'; $(P, 'vpGsTime_members_fri').handlers.change.forEach(function (f) { f(); });
  check('all times in: Next is on', $(P, 'vpGsWeekNext').disabled === false && T(P, 'vpGsWeekMsg') === '');
  passWeek(P, 'vpGsWeekNext'); await settle();
  sa = SAVED[SAVED.length - 1].patch.setup_answers;
  check('stored as setup_answers.week: Wednesday trivia 7pm; Friday musical bingo 7:30pm, members draw 8pm', JSON.stringify(sa.week) === '[{"day":"wed","games":[{"game":"trivia","start":"19:00"}]},{"day":"fri","games":[{"game":"musical","start":"19:30"},{"game":"members","start":"20:00"}]}]', sa.week);
  check('and the nights, the shape the Account page card already reads', JSON.stringify(sa.nights) === '["wed","fri"]', sa.nights);
  check('then "Would you like to set them all up today?"', T(P, 'vpGsTitle') === 'Now let\'s set up your games.');
  $(P, 'vpGsBack').click(); await settle(); $(P, 'vpGsBack').click(); await settle();   // the games step goes back to the collect step, then the nights
  check('Back shows what they picked, with the times', day('trivia', 'wed').getAttribute('aria-pressed') === 'true' && $(P, 'vpGsTime_trivia_wed').value === '19:00');
  var P10 = page(); P10.GS.run(P10.ctx, Object.assign(P10.deps, { start: 'pick' })); await settle();
  gameBtn(P10, 'bingo').click(); SAVED = []; P10.doc.getElementById('vpGsNext').click(); await settle(); passWeek(P10, 'vpGsWeekSkip'); await settle();
  check('skippable: "Skip for now" goes on with nothing stored for the week', T(P10, 'vpGsTitle') === 'Now let\'s set up your games.' && !SAVED.some(function (x) { return x.patch.setup_answers.week; }));
  check('the week is cleaned: unknown days, games and times dropped, each game once a day, week order', JSON.stringify(P.GS.cleanWeek([{ day: 'fri', games: [{ game: 'members', start: '25:00' }, { game: 'trivia', start: '20:15' }, { game: 'trivia' }, { game: 'jag' }] }, { day: 'funday', games: [{ game: 'trivia' }] }, { day: 'mon', games: [{ game: 'bingo', start: '7pm' }] }])) === '[{"day":"mon","games":[{"game":"bingo"}]},{"day":"fri","games":[{"game":"trivia","start":"20:15"},{"game":"members"}]}]', P.GS.cleanWeek([{ day: 'fri', games: [{ game: 'members', start: '25:00' }, { game: 'trivia', start: '20:15' }, { game: 'trivia' }, { game: 'jag' }] }, { day: 'funday', games: [{ game: 'trivia' }] }, { day: 'mon', games: [{ game: 'bingo', start: '7pm' }] }]));
  check('cleanExtra keeps the week for the guide\'s own saves', JSON.stringify(P.GS.cleanExtra({ week: [{ day: 'wed', games: [{ game: 'trivia', start: '19:00' }] }] }).week) === '[{"day":"wed","games":[{"game":"trivia","start":"19:00"}]}]');
  check('times in plain words for the phones: 19:30 is 7:30pm, 19:00 is 7pm', P.GS.timeWords('19:30') === '7:30pm' && P.GS.timeWords('19:00') === '7pm' && P.GS.timeWords('00:15') === '12:15am');

  var P11 = page({ answers: { games: ['trivia', 'musical'], week: [{ day: 'wed', games: [{ game: 'trivia', start: '19:00' }] }] } });
  var wo = P11.GS.run(P11.ctx, Object.assign(P11.deps, { start: 'week', weekOnly: true })); await settle();
  check('the Account page opens just the week, with what is saved, and Save', T(P11, 'vpGsTitle') === 'Which nights do you run them?' && $(P11, 'vpGsTime_trivia_wed').value === '19:00' && T(P11, 'vpGsWeekNext') === 'Save', T(P11, 'vpGsWeekNext'));
  SAVED = []; CALLS = []; $(P11, 'vpGsClose').click(); await settle();
  check('closing it there changes nothing: no defaults written, nothing marked later', (await wo) === 'closed' && CALLS.length === 0 && SAVED.length === 0, [CALLS, SAVED]);
  wo = P11.GS.run(P11.ctx, Object.assign(P11.deps, { start: 'week', weekOnly: true })); await settle();
  walk($(P11, 'vpGsWeek'), function (e) { return e.getAttribute && e.getAttribute('data-day') === 'sat' && e.parentNode.parentNode.getAttribute('data-game') === 'musical'; }).click();
  $(P11, 'vpGsTime_musical_sat').value = '18:30'; $(P11, 'vpGsTime_musical_sat').handlers.change.forEach(function (f) { f(); });
  SAVED = []; passWeek(P11, 'vpGsWeekNext');
  check('Save keeps the week for the venue and closes', (await wo) === 'done' && !$(P11, 'vpGs') && JSON.stringify(SAVED[0].patch.setup_answers.week) === '[{"day":"wed","games":[{"game":"trivia","start":"19:00"}]},{"day":"sat","games":[{"game":"musical","start":"18:30"}]}]', SAVED[0] && SAVED[0].patch.setup_answers.week);
  check('the week in words for the Account page: "Wed: Trivia 7pm · Fri: Musical bingo 7:30pm, Members draws"', P.GS.weekWords([{ day: 'wed', games: [{ game: 'trivia', start: '19:00' }] }, { day: 'fri', games: [{ game: 'musical', start: '19:30' }, { game: 'members' }] }]) === 'Wed: Trivia 7pm · Fri: Musical bingo 7:30pm, Members draws');
  var BIL = readFile('venueplay/app/billing.html'), about = BIL.slice(BIL.indexOf('function renderAbout'), BIL.indexOf('function renderOtherAccounts'));
  check('the Account page shows the week and opens the week step for that venue (weekOnly), and loads the module', /VPGameSetup\.weekWords\(\(by\[v\.id\] \|\| \{\}\)\.week\)/.test(about) && /VPGameSetup\.run\(cx, \{ start: "week", weekOnly: true/.test(about) && BIL.indexOf('<script src="vp-gamesetup.js"></script>') > 0 && /esc\(wk\)/.test(about), about.slice(0, 300));

  section('6d. BINGO BY STATE AND PUB OR CLUB; THE MUSIC TAKES TURNS (Dean, 6 Nov 2026)');
  var R = page().GS;
  var vic = R.bingoRules({ au_state: 'VIC', entity_type: 'for_profit' }), sap = R.bingoRules({ au_state: 'SA', entity_type: 'for_profit' }), sac = R.bingoRules({ au_state: 'SA', entity_type: 'non_profit' }), qld = R.bingoRules({ au_state: 'QLD', entity_type: 'for_profit' });
  check('from vp-gaming.js: Victoria no phone tickets; SA and NT pubs no bingo; an SA club bingo on paper; Queensland phones', !vic.phones && !vic.hidden && sap.hidden && !sac.hidden && !sac.phones && qld.phones && !qld.hidden && !R.bingoRules({ au_state: 'TAS' }).phones && R.bingoRules({ au_state: 'NT' }).hidden, [vic, sap, sac, qld]);
  check('the one plain line for Victoria is the state\'s own first sentence, then what happens', vic.why === "Victoria does not allow a phone as a bingo ticket. So it's paper tickets, with our calling and our screen.", vic.why);
  check('a venue nobody has called a pub or a club is judged the stricter way, and its own answer counts', R.bingoRules({ au_state: 'SA' }).hidden && !R.bingoRules({ au_state: 'SA' }, { venue_kind: 'club' }).hidden);
  P = page({ venue: { au_state: 'VIC' } }); P.GS.run(P.ctx, Object.assign(P.deps, { start: 'pick' })); await settle();
  check('pub or club is left out when the venue\'s record says (Dean, round 9 point 3: ask only when unknown), kept as pub', !$(P, 'vpGsKind') && T(P, 'vpGsTitle') === 'What games do you play?');
  gameBtn(P, 'bingo').click(); $(P, 'vpGsNext').click(); if ($(P, 'vpGsWeekSkip')) passWeek(P, 'vpGsWeekSkip'); $(P, 'vpGsAllYes').click(); await settle();
  check('Victoria: phone tickets switched off and said straight away in one plain line, no phone choice', T(P, 'vpGsFixed_ticket_kind') === vic.why && !walk($(P, 'vpGsBody'), function (e) { return e.getAttribute && e.getAttribute('data-value') === 'phone'; }), T(P, 'vpGsFixed_ticket_kind'));
  check('Victoria: who draws the numbers is asked (venueplay can, or real balls)', $(P, 'vpGsQ_caller').parentNode.style.display === '');
  CALLS = []; $(P, 'vpGsSave').click(); await settle();
  var vb = posts('/host/game-prefs')[0];
  check('saved as paper for a Victorian venue, no tickets-per-player question', vb && vb.body.prefs.ticket_kind === 'paper' && vb.body.prefs.caller === false && !('cards' in vb.body.prefs), vb && vb.body);
  check('the defaults for a Victorian venue are paper too', JSON.stringify(P.H.defaults('bingo', { bingo: vic })).indexOf('"ticket_kind":"paper"') >= 0 && P.H.defaults('bingo', { bingo: qld }).ticket_kind === 'phone' && P.H.defaults('bingo', { bingo: qld }).caller === undefined);
  P = page({ venue: { au_state: 'SA', entity_type: null } }); P.GS.run(P.ctx, Object.assign(P.deps, { start: 'pick' })); await settle();
  check('pub or club unknown: asked first, its own question, with Other (Dean, round 8b point 2, the SA screen too)', !!$(P, 'vpGsKind') && T(P, 'vpGsTitle') === 'Are you a pub or a club?' && !!walk($(P, 'vpGsKind'), function (e) { return e.getAttribute && e.getAttribute('data-value') === 'other'; }));
  check('an SA venue that might be a pub sees no bingo tick, and one line why', !gameBtn(P, 'bingo') && /Bingo isn't open to a pub in South Australia/.test(T(P, 'vpGsBingoNote')), T(P, 'vpGsBingoNote'));
  walk($(P, 'vpGsKind'), function (e) { return e.getAttribute && e.getAttribute('data-value') === 'club'; }).click();
  check('they say club: bingo is offered', !!gameBtn(P, 'bingo') && $(P, 'vpGsBingoNote').style.display === 'none');
  gameBtn(P, 'bingo').click(); SAVED = []; $(P, 'vpGsNext').click(); await settle();
  check('kept as setup_answers.venue_kind for HQ to confirm', SAVED.length && SAVED[SAVED.length - 1].patch.setup_answers.venue_kind === 'club', SAVED.length && SAVED[SAVED.length - 1].patch.setup_answers);
  check('the music takes turns: five weeks, five different lists, then round again (Brisbane weeks from Monday)', (function () {
    var L = ['a', 'b', 'c', 'd', 'e'], mon = Date.parse('2026-11-08T14:00:00Z'), seen = [];   // Monday 9 Nov, midnight in Brisbane
    for (var w = 0; w < 6; w++) seen.push(R.weekPick(L, mon + w * 7 * 86400000));
    return seen.slice(0, 5).sort().join() === 'a,b,c,d,e' && seen[5] === seen[0] && R.weekPick(L, mon - 1000) !== R.weekPick(L, mon) && R.weekPick(L, mon + 6.9 * 86400000) === R.weekPick(L, mon);
  })());
  var MUS = readFile('venueplay/app/musical/host.html');
  check('the musical bingo console plays this week\'s list when the venue has more than one', /VPSetupUse\.weekPick\(p\.playlists\)/.test(MUS.slice(MUS.indexOf('function applyMusicalPrefs'), MUS.indexOf('function musicalLocalPrefs'))));

  section('6e. ROUND 3 (Dean, 6 Nov 2026): first name, shared prizes, the members draw name and layout');
  P = page(); P.ctx.staff = [{ venue_id: 'V1', role: 'owner', display_name: 'Sam Nguyen' }]; P.GS.run(P.ctx, P.deps); await settle();
  check('"Welcome to venueplay, Sam" when we know their first name', T(P, 'vpGsTitle') === 'Welcome to venueplay, Sam', T(P, 'vpGsTitle'));
  P = page(); P.ctx.staff = [{ venue_id: 'V1', role: 'owner', display_name: 'The Test Arms manager' }]; P.GS.run(P.ctx, P.deps); await settle();
  check('the placeholder "<venue> manager" is not a name: the venue name instead', T(P, 'vpGsTitle') === 'Welcome to venueplay, The Test Arms', T(P, 'vpGsTitle'));
  P = page(); P.ctx.venue.entity_type = null; P.GS.run(P.ctx, Object.assign(P.deps, { start: 'pick' })); await settle();
  check('three questions in order: pub or club (or Other), what games, any other nights (Dean, round 8b points 2 and 3)', T(P, 'vpGsTitle') === 'Are you a pub or a club?' && /What games do you play\?/.test(T(P, 'vpGsBody')) && /Do you run any other regular nights or meal deals\?/.test(T(P, 'vpGsBody')) && !!walk($(P, 'vpGsKind'), function (e) { return e.getAttribute && e.getAttribute('data-value') === 'other'; }));
  gameBtn(P, 'trivia').click(); gameBtn(P, 'bingo').click(); gameBtn(P, 'members').click();
  $(P, 'vpGsNext').click(); passWeek(P, 'vpGsWeekSkip'); $(P, 'vpGsAllYes').click(); await settle();
  check('no "Same prizes for other games?" any more (Dean, round 7b point 7); prizes typed one at a time, no "then Enter" (Dean, round 9 point 4: leaving the box keeps it)', !$(P, 'vpGsShared') && !/then Enter/.test($(P, 'vpGsIn_prizes_0').placeholder));
  $(P, 'vpGsIn_prizes_0').value = 'Meat tray'; $(P, 'vpGsIn_prizes_1').value = '$50 bar tab'; $(P, 'vpGsIn_prizes_2').value = 'meat TRAY';
  CALLS = []; SAVED = []; $(P, 'vpGsSave').click(); await settle();
  var tp3 = posts('/host/game-prefs')[0];
  check('the usual prizes become trivia\'s prize buttons (each once)', tp3 && JSON.stringify(tp3.body.prefs.prize_list) === '["Meat tray","$50 bar tab"]', tp3 && tp3.body.prefs);
  sa = SAVED[SAVED.length - 1].patch.setup_answers;
  check('kept as the usual prizes for the next games', JSON.stringify(sa.prize_bank) === '["Meat tray","$50 bar tab"]', sa.prize_bank);
  walk($(P, 'vpGsGamePicks'), function (e) { return e.getAttribute && e.getAttribute('data-game') === 'bingo'; }).click(); await settle();
  var uchips = all($(P, 'vpGsUsual_round_prizes'), function (e) { return e.className === 'vpgs-uchip'; });
  check('bingo: a prize for each game of the night (Dean, round 8b point 11), empty, the usual prizes one tap away', $(P, 'vpGsIn_round_prizes').children.length === 3 && $(P, 'vpGsIn_round_prizes_0').value === '' && uchips.map(function (e) { return e.getAttribute('data-item'); }).join('|') === 'Meat tray|$50 bar tab', uchips.length);
  uchips[1].click(); uchips[0].click();
  check('a tap fills the next game\'s box, in the order tapped', $(P, 'vpGsIn_round_prizes_0').value === '$50 bar tab' && $(P, 'vpGsIn_round_prizes_1').value === 'Meat tray');
  check('bingo\'s prizes say any prize: "a meat tray, a voucher, cash, anything"', /a meat tray, a voucher, cash, anything/.test(T(P, 'vpGsHelp_round_prizes')) && !$(P, 'vpGsQ_pattern'));
  CALLS = []; $(P, 'vpGsSave').click(); await settle();
  var bpz = posts('/host/game-prefs')[0].body.prefs;
  check('saved: each game\'s prize in order (no prize for game 3), the prize buttons, 6 tickets a player by default', JSON.stringify(bpz.round_prizes) === '["$50 bar tab","Meat tray",""]' && bpz.rounds === 3 && bpz.prize_list.join('|') === '$50 bar tab|Meat tray' && bpz.cards === 6 && srtj(WK.clean('bingo', bpz)) === srtj(bpz), bpz);
  walk($(P, 'vpGsGamePicks'), function (e) { return e.getAttribute && e.getAttribute('data-game') === 'members'; }).click(); await settle();
  function keysIn(id) { var g = $(P, id); return g ? all(g, function (e) { return e.getAttribute && e.getAttribute('data-key'); }).map(function (e) { return e.getAttribute('data-key'); }).join() : ''; }
  var mrows = all($(P, 'vpGsBody'), function (e) { return e.getAttribute && e.getAttribute('data-key'); }).filter(function (e) { return e.style.display !== 'none'; }).map(function (e) { return e.getAttribute('data-key'); });
  check('members draws: one row each, the name, when it started, the time (the time picker), the starting jackpot ($ before the box, empty), how much it goes up and the most it can reach (Dean, round 7b points 17 and 19)', mrows.slice(0, 7).join() === 'name,date_started,draw_time,starting_amount_cents,max_jackpot_cents,current_jackpot_cents,increment_cents' && $(P, 'vpGsIn_draw_time').tagName === 'SELECT' && $(P, 'vpGsIn_starting_amount_cents').value === '' && $(P, 'vpGsIn_starting_amount_cents').parentNode.children[0].textContent === '$' && /jackpot now/i.test(T(P, 'vpGsBody')) && mrows.indexOf('over_max') < 0, mrows);
  $(P, 'vpGsIn_max_jackpot_cents').value = '5000'; $(P, 'vpGsIn_max_jackpot_cents').handlers.input.forEach(function (f) { f(); });
  check('a most amount typed: "what happens to the weekly amount" is asked (kept, another draw, or not added)', walk($(P, 'vpGsBody'), function (e) { return e.getAttribute && e.getAttribute('data-key') === 'over_max'; }).style.display === '' && /Another draw/.test(T(P, 'vpGsBody')));
  walk($(P, 'vpGsBody'), function (e) { return e.getAttribute && e.getAttribute('data-value') === 'second'; }).click();
  $(P, 'vpGsIn_max_jackpot_cents').value = ''; $(P, 'vpGsIn_max_jackpot_cents').handlers.input.forEach(function (f) { f(); });
  $(P, 'vpGsIn_date_started').value = '2026-11-13';
  CALLS = []; $(P, 'vpGsSave').click(); await settle();
  check('not named: called "{Day} Members Draw" (the day from the first draw date when the nights step was skipped)', posts('/host/members/settings')[0] && posts('/host/members/settings')[0].body.name === 'Friday Members Draw' && posts('/host/members/settings')[0].body.draw_day === 'Friday', posts('/host/members/settings')[0] && posts('/host/members/settings')[0].body);

  var P13 = page({ answers: { games: ['trivia'], setup: { trivia: 'done' } } }); P13.GS.run(P13.ctx, Object.assign(P13.deps, { start: 'pick' })); await settle();
  $(P13, 'vpGsNext').click(); if ($(P13, 'vpGsWeekSkip')) passWeek(P13, 'vpGsWeekSkip'); $(P13, 'vpGsAllYes').click(); await settle();
  check('every game already set up: "Yes" goes to "You\'re ready for your week", never a broken screen', T(P13, 'vpGsTitle') === "You're ready for your week.", T(P13, 'vpGsTitle'));

  section('6f. ROUND 4 (Dean, 6 Nov 2026): several "something else", more than one of a game, raffles keep their own prizes');
  P = page(); P.GS.run(P.ctx, Object.assign(P.deps, { start: 'pick' })); await settle();
  check('the box no longer says "then Enter" (Dean, round 9 point 4: leaving it keeps what they typed)', !/then Enter/.test($(P, 'vpGsOther').placeholder) && /Karaoke/.test($(P, 'vpGsOther').placeholder));
  function typeOther(t) { $(P, 'vpGsOther').value = t; $(P, 'vpGsOther').handlers.keydown.forEach(function (f) { f({ key: 'Enter', preventDefault: function () {} }); }); }
  typeOther('Karaoke'); typeOther('karaoke'); typeOther('Poker <night>');
  check('each one becomes a tag, a repeat once, no markup', all($(P, 'vpGsOtherList'), function (e) { return e.getAttribute && e.getAttribute('data-other'); }).map(function (e) { return e.getAttribute('data-other'); }).join('|') === 'Karaoke|Poker night', all($(P, 'vpGsOtherList'), function (e) { return e.getAttribute && e.getAttribute('data-other'); }).map(function (e) { return e.getAttribute('data-other'); }));
  gameBtn(P, 'members').click(); gameBtn(P, 'bingo').click();
  check('no "+ Add another" on the games question: how many comes from the nights (Dean, round 4)', !walk($(P, 'vpGsGames'), function (e) { return e.getAttribute && e.getAttribute('data-add'); }));
  $(P, 'vpGsOther').value = 'Footy tipping'; SAVED = []; $(P, 'vpGsNext').click(); await settle();
  sa = SAVED[SAVED.length - 1].patch.setup_answers;
  check('saved: "Something else" as one list (the last one typed without Enter too)', /^Karaoke, Poker/.test(sa.other) && /Footy tipping$/.test(sa.other), sa.other);
  check('cleaned: entries at most 40 characters, the list at most 120', P.GS.cleanOther(new Array(10).join('a very long game name that goes on, ')).length <= 120 && P.GS.cleanOther('x'.repeat(80)).length === 40);
  var wrows = all($(P, 'vpGsWeek'), function (e) { return e.getAttribute && e.getAttribute('data-game') && e.className === 'vpgs-row'; }).map(function (e) { return e.getAttribute('data-game'); });
  check('"Something else" gets nights too: Karaoke, Poker night and Footy tipping after the games (Dean, round 4)', wrows.join() === 'bingo,members,other:karaoke,other:poker night,other:footy tipping', wrows);
  function wday(g, d) { return walk($(P, 'vpGsWeek'), function (e) { return e.getAttribute && e.getAttribute('data-day') === d && e.parentNode.parentNode.getAttribute('data-game') === g; }); }
  wday('bingo', 'fri').click(); wday('bingo', 'sun').click(); wday('members', 'fri').click(); wday('members', 'sun').click(); wday('other:karaoke', 'sat').click();
  function wtime(id, t) { $(P, id).value = t; $(P, id).handlers.change.forEach(function (f) { f(); }); }
  wtime('vpGsTime_bingo_fri', '18:00'); wtime('vpGsTime_bingo_sun', '14:00'); wtime('vpGsTime_members_fri', '20:00'); wtime('vpGsTime_members_sun', '17:00'); wtime('vpGsTime_other:karaoke_sat', '21:00');
  check('every game can add another session on a night, a small "+ another session" link on that night\'s own time row, members draws too (Dean, round 8b point 4)', !!$(P, 'vpGsAddSess_bingo_fri') && T(P, 'vpGsAddSess_bingo_fri') === '+ another session' && $(P, 'vpGsAddSess_bingo_fri').getAttribute('aria-label') === 'Add another session on Friday' && $(P, 'vpGsAddSess_bingo_fri').parentNode.className.indexOf('vpgs-times') === 0 && $(P, 'vpGsAddSess_bingo_fri').getAttribute('tabindex') === '-1' && !!$(P, 'vpGsAddSess_members_fri') && !!$(P, 'vpGsAddSess_other:karaoke_sat'));
  $(P, 'vpGsAddSess_bingo_fri').click();
  check('the new session asks its own start time (Dean, round 5), and Next waits for it', !!$(P, 'vpGsTime_bingo_fri_2') && $(P, 'vpGsWeekNext').disabled === true);
  wtime('vpGsTime_bingo_fri_2', '20:00');
  SAVED = []; passWeek(P, 'vpGsWeekNext'); await settle();
  sa = SAVED[SAVED.length - 1].patch.setup_answers;
  check('the week keeps the sessions and the Something else nights', JSON.stringify(sa.week) === '[{"day":"fri","games":[{"game":"bingo","start":"18:00","starts":["18:00","20:00"],"count":2},{"game":"members","start":"20:00"}]},{"day":"sat","games":[{"game":"other","name":"Karaoke","start":"21:00"}]},{"day":"sun","games":[{"game":"bingo","start":"14:00"},{"game":"members","start":"17:00"}]}]', sa.week);
  check('how many a week: bingo 3 sessions, 2 members draws', JSON.stringify(sa.counts) === '{"bingo":3,"members":2}', sa.counts);
  check('in words: "Fri: Bingo \u00d72 6pm, Members draws 8pm \u00b7 Sat: Karaoke 9pm \u00b7 ..."', /^Fri: Bingo \u00d72 6pm, Members draws 8pm \u00b7 Sat: Karaoke 9pm/.test(P.GS.weekWords(sa.week)), P.GS.weekWords(sa.week));
  $(P, 'vpGsAllYes').click(); await settle();
  walk($(P, 'vpGsBody'), function (e) { return e.getAttribute && e.getAttribute('data-key'); }); $(P, 'vpGsSave').click(); await settle();
  walk($(P, 'vpGsGamePicks'), function (e) { return e.getAttribute && e.getAttribute('data-game') === 'members'; }).click(); await settle();
  check('two members nights: members draw 1 of 2, called after its night', /draw 1 of 2/.test(T(P, 'vpGsCount')) && $(P, 'vpGsIn_name').placeholder === 'Friday Members Draw' && $(P, 'vpGsIn_draw_time').value === '20:00' && /Draw time/.test(T(P, 'vpGsBody')) && walk($(P, 'vpGsBody'), function (e) { return e.getAttribute && e.getAttribute('data-key') === 'draw_time'; }).getAttribute('data-from') === 'night', [T(P, 'vpGsCount'), $(P, 'vpGsIn_name').placeholder]);
  CALLS = []; $(P, 'vpGsSave').click(); await settle();
  check('then draw 2 of 2, Sunday 5pm', /draw 2 of 2/.test(T(P, 'vpGsCount')) && $(P, 'vpGsIn_name').placeholder === 'Sunday Members Draw' && $(P, 'vpGsIn_draw_time').value === '17:00', [T(P, 'vpGsCount'), $(P, 'vpGsIn_name').placeholder]);
  $(P, 'vpGsSave').click(); await settle();
  check('two draws made, one each night', posts('/host/members/settings').map(function (c) { return c.body.name; }).join('|') === 'Friday Members Draw|Sunday Members Draw', posts('/host/members/settings').map(function (c) { return c.body.name; }));
  check('a "Something else" night is cleaned like the rest (a name, at most 40 characters)', JSON.stringify(P.GS.cleanWeek([{ day: 'mon', games: [{ game: 'other', name: '<b>Poker</b>' + 'x'.repeat(60), start: '19:00' }, { game: 'other' }, { game: 'bingo', count: 9 }] }])) === '[{"day":"mon","games":[{"game":"bingo"},{"game":"other","name":"b Poker /b ' + 'x'.repeat(29) + '","start":"19:00"}]}]', P.GS.cleanWeek([{ day: 'mon', games: [{ game: 'other', name: '<b>Poker</b>' + 'x'.repeat(60), start: '19:00' }, { game: 'other' }, { game: 'bingo', count: 9 }] }]));
  P = page({ answers: { games: ['members'], week: [{ day: 'thu', games: [{ game: 'members', start: '19:30' }] }] } }); P.GS.run(P.ctx, Object.assign(P.deps, { start: 'pick' })); await settle();
  $(P, 'vpGsNext').click(); await settle(); passWeek(P, 'vpGsWeekNext'); await settle(); $(P, 'vpGsAllYes').click(); await settle();
  check('the members draw\'s night and time come from the nights step: "Thursday Members Draw", 7:30pm', $(P, 'vpGsIn_name').placeholder === 'Thursday Members Draw' && $(P, 'vpGsIn_draw_time').value === '19:30', [$(P, 'vpGsIn_name').placeholder, $(P, 'vpGsIn_draw_time').value]);
  CALLS = []; $(P, 'vpGsSave').click(); await settle();
  check('saved with that day, name and the time in words for the TV (7:30pm)', posts('/host/members/settings')[0].body.draw_day === 'Thursday' && posts('/host/members/settings')[0].body.name === 'Thursday Members Draw' && posts('/host/members/settings')[0].body.draw_time === '7:30pm', posts('/host/members/settings')[0].body);
  P = page({ answers: { games: ['trivia', 'raffles'], prizes_shared: true, prize_bank: ['Meat tray', '$50 bar tab'] } }); P.GS.run(P.ctx, Object.assign(P.deps, { start: 'pick' })); await settle();
  $(P, 'vpGsNext').click(); passWeek(P, 'vpGsWeekSkip'); $(P, 'vpGsAllYes').click(); await settle();
  check('trivia starts empty, the usual prizes one tap away, and no question about them', $(P, 'vpGsIn_prizes_0').value === '' && !!$(P, 'vpGsUsual_prizes') && !$(P, 'vpGsShared'));
  $(P, 'vpGsSave').click(); await settle(); walk($(P, 'vpGsGamePicks'), function (e) { return e.getAttribute && e.getAttribute('data-game') === 'raffles'; }).click(); await settle();
  check('raffles start with nothing filled in (no Meat tray before they type, Dean round 9 point 20), never the usual-prizes question', $(P, 'vpGsRafP_0_0').value === '' && !$(P, 'vpGsShared'), $(P, 'vpGsRafP_0_0').value);
  check('"Raffles a night" is one compact line with a small box, no unit word (Dean, round 8b point 5); a More settings section (the draw style is hidden until the TV draws it, Dean 10 Nov)', / cmp/.test(walk($(P, 'vpGsBody'), function (e) { return e.getAttribute && e.getAttribute('data-key') === 'raffles'; }).className) && !all($(P, 'vpGsBody'), function (e) { return e.className === 'vpgs-unit'; }).length && !!$(P, 'vpGsAdvanced') && !$(P, 'vpGsIn_draw_style'));
  walk($(P, 'vpGsUsual_raffle_plan'), function (e) { return e.getAttribute && e.getAttribute('data-item') === '$50 bar tab'; }).click();
  check('a usual prize is one tap: it goes into the raffle\'s prize box (Dean, round 9 point 20: "it didn\'t add any")', $(P, 'vpGsRafP_0_0').value === '$50 bar tab', $(P, 'vpGsRafP_0_0').value);
  var P14 = page({ answers: { games: ['raffles'] } }); P14.GS.run(P14.ctx, Object.assign(P14.deps, { start: 'pick' })); await settle();
  $(P14, 'vpGsNext').click(); passWeek(P14, 'vpGsWeekSkip'); $(P14, 'vpGsAllYes').click(); await settle();
  check('raffles first: still not asked about prizes across games (they keep their own list)', T(P14, 'vpGsTitle') === 'Set up raffles' && !$(P14, 'vpGsShared'));
  check('skipped games get the usual prizes as their buttons too', JSON.stringify(P.H.defaults('trivia', { bank: ['Meat tray'] }).prize_list) === '["Meat tray"]' && !('prize_list' in P.H.defaults('trivia', {})));
  check('an SA pub\'s bingo note is one short line', R.bingoRules({ au_state: 'SA', entity_type: 'for_profit' }).why === "Bingo isn't open to a pub in South Australia.");

  var LIBD = JSON.parse(readFile('venueplay/data/musical-library.json')), hits = LIBD.playlists[0], songIds = {};
  LIBD.songs.forEach(function (x) { songIds[x.id] = 1; });
  var uniq = {}; hits.songIds.forEach(function (x) { uniq[x] = 1; });
  check('"All the hits" is the first playlist: 1,000 songs, each once, every one in the library, rank 1 of every list in it (tools/make-hits-playlist.py)', hits.id === 'all-the-hits' && hits.name === 'All the hits' && hits.songIds.length === 1000 && Object.keys(uniq).length === 1000 && hits.songIds.every(function (x) { return songIds[x]; }) && LIBD.playlists.slice(1).filter(function (p) { return p.id !== 'pride'; }).every(function (p) { return uniq[p.songIds[0]]; }), [hits.id, hits.songIds.length]);

  section('6g. THE DESIGN REVIEW (6 Nov): asked once, help underneath, units, the console header, the reviewer\'s layout');
  P = page(); P.GS.run(P.ctx, Object.assign(P.deps, { start: 'pick' })); await settle();
  gameBtn(P, 'trivia').click(); gameBtn(P, 'bingo').click(); $(P, 'vpGsNext').click(); passWeek(P, 'vpGsWeekSkip'); $(P, 'vpGsAllYes').click(); await settle();
  check('trivia does not ask "Same prizes for other games?" (Dean, round 7b point 7)', !$(P, 'vpGsShared'));
  var pr = $(P, 'vpGsHelp_prizes'); var crow = walk($(P, 'vpGsBody'), function (e) { return e.getAttribute && e.getAttribute('data-key') === 'prizes'; });
  check('the "?" words sit under the whole setting (under the pair on a two-to-a-line setting), never over the question', pr && crow.children[crow.children.length - 1] === pr && pr.parentNode === crow, crow && crow.children.map(function (c) { return c.className; }));
  check('no unit words after the boxes, so every box lines up (Dean, round 8b points 5 and 16)', all($(P, 'vpGsBody'), function (e) { return e.className === 'vpgs-unit'; }).length === 0);
  $(P, 'vpGsSave').click(); await settle(); walk($(P, 'vpGsGamePicks'), function (e) { return e.getAttribute && e.getAttribute('data-game') === 'bingo'; }).click(); await settle();
  check('left unanswered on trivia, it is never asked again on bingo (asked once, design review)', !$(P, 'vpGsShared') && T(P, 'vpGsTitle') === 'Set up bingo');
  P = page(); P.GS.run(P.ctx, Object.assign(P.deps, { start: 'pick' })); await settle();
  gameBtn(P, 'trivia').click(); gameBtn(P, 'musical').click(); $(P, 'vpGsNext').click(); passWeek(P, 'vpGsWeekSkip'); $(P, 'vpGsAllYes').click(); await settle();
  $(P, 'vpGsSave').click(); await settle();
  check('each game left has its own Yes button under the question, the quiet one outlined', /vpgs-outline/.test($(P, 'vpGsNextNo').className) && !!walk($(P, 'vpGsGamePicks'), function (e) { return e.getAttribute && e.getAttribute('data-game') === 'musical'; }));
  var P16 = page(); var hdr = new El('header'); hdr.style.visibility = ''; P16.body.appendChild(hdr);
  P16.doc.querySelector = function (sel) { return sel === 'header' ? hdr : null; };
  var fo16 = P16.GS.firstOpen('trivia', Object.assign(P16.deps, { ctx: Object.assign(P16.ctx, { settings: { setup_answers: { setup: { trivia: 'later' } } } }) })); await settle();
  check('the console header stands down while a setup is open (no ghost header behind it)', hdr.style.visibility === 'hidden');
  $(P16, 'vpGsClose').click(); await fo16;
  check('and comes back when it closes', hdr.style.visibility === '');
  P = page(); P.GS.run(P.ctx, Object.assign(P.deps, { start: 'pick' })); await settle();
  gameBtn(P, 'trivia').click(); $(P, 'vpGsNext').click(); passWeek(P, 'vpGsWeekSkip'); $(P, 'vpGsAllYes').click(); await settle();
  check('More settings folded on every screen, saying what KINDS of settings are in there (Dean, round 8b point 6)', /folded/.test($(P, 'vpGsAdvanced').className) && T(P, 'vpGsAdvSummary') === 'Time to answer, points, and the buzzer.', T(P, 'vpGsAdvSummary'));
  check('no "tap ? to see what a setting means" line (Dean, round 7b point 9)', !/tap \?/.test(T(P, 'vpGsLead')), T(P, 'vpGsLead'));
  var qrows = all($(P, 'vpGsBody'), function (e) { return e.className === 'vpgs-q'; });
  check('every "?" is its row\'s own column, right after the label, never inside the label words (one column, Dean round 7b point 9)', qrows.every(function (q) { return /vpgs-row/.test(q.parentNode.className) && q.parentNode.children[1] === q; }), qrows.length);
  CALLS = []; $(P, 'vpGsSave').click(); await settle();
  check('it saves the same way, rounds a night included (Dean, round 7b point 6)', posts('/host/game-prefs')[0] && posts('/host/game-prefs')[0].body.prefs.count === 10 && posts('/host/game-prefs')[0].body.prefs.rounds === 3);

  section('6h. THE DESIGN REVIEW, ROUND 7: Back keeps what they did, the second session box, members pairs, phone folding');
  P = page(); P.GS.run(P.ctx, Object.assign(P.deps, { start: 'pick' })); await settle();
  gameBtn(P, 'musical').click(); gameBtn(P, 'bingo').click(); $(P, 'vpGsNext').click(); passWeek(P, 'vpGsWeekSkip'); $(P, 'vpGsAllYes').click(); await settle();
  var sh0 = !!$(P, 'vpGsShared');
  var nb0 = $(P, 'vpGsNone_0'); nb0.checked = true; nb0.handlers.change.forEach(function (f) { f(); });
  var p1 = $(P, 'vpGsIn_prizes_1'); if (p1) { p1.value = '$20 bar tab'; (p1.handlers.input || []).forEach(function (f) { f(); }); }
  $(P, 'vpGsBack').click(); await settle(); $(P, 'vpGsAllYes').click(); await settle();
  check('Back, then forward again: the ticked "No prize" and the typed prize are still there', !sh0 && $(P, 'vpGsNone_0').checked === true && $(P, 'vpGsIn_prizes_1').value === '$20 bar tab', [$(P, 'vpGsNone_0') && $(P, 'vpGsNone_0').checked, $(P, 'vpGsIn_prizes_1') && $(P, 'vpGsIn_prizes_1').value]);
  check('"More settings" folded, with a "Change" button', /folded/.test($(P, 'vpGsAdvanced').className) && T(P, 'vpGsAdvToggle') === 'Change');
  $(P, 'vpGsAdvToggle').click();
  check('tapping it opens them', !/folded/.test($(P, 'vpGsAdvanced').className) && T(P, 'vpGsAdvToggle') === 'Done');
  P = page(); P.GS.run(P.ctx, Object.assign(P.deps, { start: 'pick' })); await settle();
  gameBtn(P, 'bingo').click(); $(P, 'vpGsNext').click(); await settle();
  var fri = walk($(P, 'vpGsWeek'), function (e) { return e.getAttribute && e.getAttribute('data-day') === 'fri' && e.parentNode.parentNode.getAttribute('data-game') === 'bingo'; });
  if (fri) fri.click(); await settle(); if ($(P, 'vpGsAddSess_bingo_fri')) $(P, 'vpGsAddSess_bingo_fri').click(); await settle();
  var s2 = $(P, 'vpGsTime_bingo_fri_2');
  check('a second bingo session: the cross sits before its time box, so the box is as wide as the others', !!s2 && s2.parentNode.children[1] === s2 && s2.parentNode.children[0].className === 'vpgs-rm' && / sx/.test(s2.parentNode.parentNode.className), s2 && s2.parentNode.children.map(function (c) { return c.className; }));
  var P17 = page(); var fo17 = P17.GS.firstOpen('trivia', Object.assign(P17.deps, { ctx: Object.assign(P17.ctx, { settings: { setup_answers: { setup: { trivia: 'later' } } } }) })); await settle();
  var cnt17 = walk($(P17, 'vpGsBody'), function (e) { return e.getAttribute && e.getAttribute('data-key') === 'count'; });
  check('first open: "Questions in a round" alone is one compact line with a small box (not stretched across the laptop)', !!cnt17 && / cmp/.test(cnt17.className), cnt17 && cnt17.className);
  check('"Play now with the defaults" is an outlined pink button, not a grey one', /vpgs-outline/.test($(P17, 'vpGsPlayNow').className) && /vpgs-pk/.test($(P17, 'vpGsPlayNow').className));
  $(P17, 'vpGsClose').click(); await fo17;

  section('6i. ROUND 8 (Dean, round 7b): suggestions as they type, what happens over the most, the members list');
  P = page(); P.GS.run(P.ctx, Object.assign(P.deps, { start: 'pick' })); await settle();
  $(P, 'vpGsOther').value = 'kar'; $(P, 'vpGsOther').handlers.input.forEach(function (f) { f(); });
  var sg = all($(P, 'vpGsOtherSuggest'), function (e) { return e.getAttribute && e.getAttribute('data-other'); });
  check('typing "kar" suggests "Karaoke" from the known list (Dean, round 7b point 1)', sg.map(function (e) { return e.getAttribute('data-other'); }).join() === 'Karaoke', sg.length);
  sg[0].click();
  $(P, 'vpGsOther').value = 'darts'; $(P, 'vpGsOther').handlers.keydown.forEach(function (f) { f({ key: 'Enter', preventDefault: function () {} }); });
  $(P, 'vpGsOther').value = 'trivia for kids'; $(P, 'vpGsOther').handlers.keydown.forEach(function (f) { f({ key: 'Enter', preventDefault: function () {} }); });
  var ot = all($(P, 'vpGsOtherList'), function (e) { return e.getAttribute && e.getAttribute('data-other'); }).map(function (e) { return e.getAttribute('data-other'); });
  check('several, spelt properly: "Karaoke", "Darts", and their own words with a capital first letter', ot.join('|') === 'Karaoke|Darts|Trivia for kids', ot);
  P = page({ answers: { games: ['members', 'trivia'] } }); P.GS.run(P.ctx, Object.assign(P.deps, { start: 'pick' })); await settle();
  $(P, 'vpGsNext').click(); passWeek(P, 'vpGsWeekSkip'); $(P, 'vpGsAllYes').click(); await settle(); $(P, 'vpGsSave').click(); await settle();
  walk($(P, 'vpGsGamePicks'), function (e) { return e.getAttribute && e.getAttribute('data-game') === 'members'; }).click(); await settle();
  $(P, 'vpGsIn_name').value = 'Club Draw'; $(P, 'vpGsIn_max_jackpot_cents').value = '5000'; $(P, 'vpGsIn_max_jackpot_cents').handlers.input.forEach(function (f) { f(); });
  walk($(P, 'vpGsBody'), function (e) { return e.getAttribute && e.getAttribute('data-value') === 'second'; }).click();
  CALLS = []; SAVED = []; $(P, 'vpGsSave').click(); await settle();
  var mo = posts('/host/members/settings')[0]; sa = SAVED.length ? SAVED[SAVED.length - 1].patch.setup_answers : {};
  check('over the most: "another draw" is kept in setup_answers for later, never sent to the draw (the draw only knows "kept")', mo && mo.body.max_jackpot_cents === 500000 && !('over_max' in mo.body) && !('__setup' in mo.body) && sa.members_over === 'second', [mo && mo.body, sa.members_over]);
  check('then "Update your members list later"', T(P, 'vpGsTitle') === 'Update your members list later');
  var went = ''; P.deps.go = function (u) { went = u; };
  $(P, 'vpGsExtrasYes').click(); await settle();
  check('"Add my members list" goes to the Account page\'s members list', went === '/app/billing.html#draws', went);

  P = page({ answers: { games: ['musical'], prize_bank: ['Meat tray', '$50 bar tab'] } }); P.GS.run(P.ctx, Object.assign(P.deps, { start: 'pick' })); await settle();
  $(P, 'vpGsNext').click(); passWeek(P, 'vpGsWeekSkip'); $(P, 'vpGsAllYes').click(); await settle();
  var prow = walk($(P, 'vpGsBody'), function (e) { return e.getAttribute && e.getAttribute('data-key') === 'prizes'; });
  check('musical bingo: one "Prizes" heading and one "?", the rounds straight under it (spacing review r8)', / under/.test(prow.className) && !!$(P, 'vpGsQ_prize_same'));
  var b3 = $(P, 'vpGsIn_prizes_2'); ($(P, 'vpGsIn_prizes').handlers.focusin || []).forEach(function (f) { f({ target: b3 }); });
  walk($(P, 'vpGsUsual_prizes'), function (e) { return e.getAttribute && e.getAttribute('data-item') === '$50 bar tab'; }).click();
  check('tap a round\'s box, then a usual prize: it goes in that round (Dean, round 7b point 15)', b3.value === '$50 bar tab' && $(P, 'vpGsIn_prizes_0').value === '', [b3.value, $(P, 'vpGsIn_prizes_0').value]);
  check('the speakers guide is a single link inside More settings, to its own page with the usual setups (Dean, round 8b point 9)', !!walk($(P, 'vpGsAdvanced'), function (e) { return e.id === 'vpGsSoundHow'; }) && T(P, 'vpGsSoundHow') === 'How to get the sound through your speakers' && $(P, 'vpGsSoundHow').getAttribute('href') === '/app/sound-help.html' && $(P, 'vpGsSoundHow').getAttribute('target') === '_blank');
  var SH = readFile('venueplay/app/sound-help.html');
  check('the guide covers the usual setups, each with a drawing (the back of the TV, the socket to use circled, where the cable goes) and short steps, and never "we\'ll talk you through it"', ['HDMI ARC', 'Optical', 'headphone', 'Bluetooth', 'laptop'].every(function (w) { return SH.indexOf(w) >= 0; }) && (SH.match(/<svg/g) || []).length >= 5 && (SH.match(/Back of the TV/g) || []).length >= 3 && (SH.match(/stroke="#FF1F8E" stroke-width="3"/g) || []).length >= 6 && !/talk you through/i.test(SH) && !/[\u2014\u2013]/.test(SH));

  section('6j. ROUND 9 (Dean, round 8b)');
  P = page({ answers: { games: ['musical', 'bingo'], prize_bank: ['Meat tray'] } }); P.GS.run(P.ctx, Object.assign(P.deps, { start: 'pick' })); await settle();
  $(P, 'vpGsNext').click(); passWeek(P, 'vpGsWeekSkip'); $(P, 'vpGsAllYes').click(); await settle();
  var dch = walk($(P, 'vpGsUsual_prizes'), function (e) { return e.getAttribute && e.getAttribute('data-item') === 'Meat tray'; });
  var b2 = $(P, 'vpGsIn_prizes_1'), dt = { d: '', setData: function (k, v) { this.d = v; }, getData: function () { return this.d; } };
  check('on a computer a usual prize can be dragged', dch.getAttribute('draggable') === 'true');
  (dch.handlers.dragstart || []).forEach(function (f) { f({ dataTransfer: dt }); }); (b2.handlers.drop || []).forEach(function (f) { f({ dataTransfer: dt, preventDefault: function () {} }); });
  check('dropped on round 2, it goes in round 2 (Dean, round 8b point 8)', b2.value === 'Meat tray' && $(P, 'vpGsIn_prizes_0').value === '');
  check('"No prize" is there for every round', !!$(P, 'vpGsNone_0') && !!$(P, 'vpGsNone_1') && !!$(P, 'vpGsNone_2'));
  $(P, 'vpGsSave').click(); await settle();
  check('the next game question: "Would you like to set up another game?" "Yes, set up bingo" or "That\'s enough for today", right under it (Dean, rounds 8b and 9b)', T(P, 'vpGsTitle') === 'Would you like to set up another game?' && T(P, 'vpGsNextYes') === 'Yes, set up bingo' && T(P, 'vpGsNextNo') === "That's enough for today" && !$(P, 'vpGsNextPick'));
  $(P, 'vpGsNextYes').click(); await settle();
  check('Yes goes straight to the game it names', T(P, 'vpGsTitle') === 'Set up bingo', T(P, 'vpGsTitle'));

  P = page({ answers: { games: ['members'] } }); P.GS.run(P.ctx, Object.assign(P.deps, { start: 'pick' })); await settle();
  $(P, 'vpGsNext').click(); passWeek(P, 'vpGsWeekSkip'); $(P, 'vpGsAllYes').click(); await settle();
  var mk9 = all($(P, 'vpGsBody'), function (e) { return e.getAttribute && e.getAttribute('data-key'); }).map(function (e) { return e.getAttribute('data-key'); });
  check('members: "Starting jackpot" and "Maximum jackpot" side by side, then "Jackpot now" and the weekly rise (Dean, round 12 note 8), and the member numbers said once (design review r9)', mk9.indexOf('max_jackpot_cents') === mk9.indexOf('starting_amount_cents') + 1 && mk9.indexOf('current_jackpot_cents') === mk9.indexOf('max_jackpot_cents') + 1 && /Starting jackpot/.test(T(P, 'vpGsBody')) && /Maximum jackpot/.test(T(P, 'vpGsBody')) && !/member numbers/.test(T(P, 'vpGsLead')), mk9);
  check('every screen\'s buttons sit in one bar fixed to the bottom, the main one on the right', (function () { var st = walk($(P, 'vpGs'), function (e) { return e.tagName === 'STYLE'; }); var css = st ? st.textContent : ''; return /\.vpgs-foot\{position:fixed;left:0;right:0;bottom:0/.test(css) && /\.vpgs-foot \.vpgs-btn\.pink\{margin-left:auto\}/.test(css); })());

  P = page({ answers: { games: ['trivia', 'musical'] } }); P.GS.run(P.ctx, Object.assign(P.deps, { start: 'pick' })); await settle();
  check('a compact Next under the progress bar on every screen, the same as the bottom bar\'s main button (Dean, round 9b)', !!$(P, 'vpGsTopNext') && T(P, 'vpGsTopNext') === 'Next' && $(P, 'vpGsTopNext').style.visibility === '' && $(P, 'vpGsTopNext').getAttribute('aria-label') === 'Next');
  $(P, 'vpGsTopNext').click(); await settle();
  check('the top Next does what the bottom one does (games, then the nights)', /Which nights/.test(T(P, 'vpGsTitle')), T(P, 'vpGsTitle'));
  passWeek(P, 'vpGsWeekSkip'); await settle();
  check('"Set them all up today?": Next at the bottom is "Yes, set them all up", the answers under the question', !!$(P, 'vpGsAllNext') && /vpgs-answers/.test($(P, 'vpGsAllYes').parentNode.className));
  $(P, 'vpGsTopNext').click(); await settle(); $(P, 'vpGsSave').click(); await settle();
  check('next game: Next (top and bottom) is "Yes, set up musical bingo"', T(P, 'vpGsTitle') === 'Would you like to set up another game?' && !!$(P, 'vpGsNextGo') && $(P, 'vpGsTopNext').getAttribute('aria-label') === 'Next');
  $(P, 'vpGsTopNext').click(); await settle();
  check('and it opens musical bingo', T(P, 'vpGsTitle') === 'Set up musical bingo', T(P, 'vpGsTitle'));
  var P18 = page(); var fo18 = P18.GS.firstOpen('trivia', Object.assign(P18.deps, { ctx: Object.assign(P18.ctx, { settings: { setup_answers: { setup: { trivia: 'later' } } } }) })); await settle();
  check('first open: Save in the bottom bar\'s usual place, "Play now with the defaults" a big button in the card', /vpgs-foot/.test($(P18, 'vpGsSave').parentNode.className) && $(P18, 'vpGsPlayNow').parentNode.id === 'vpGsBody');
  $(P18, 'vpGsClose').click(); await fo18;

  check('white calendar and clock icons in the date and time boxes on the dark screens (Dean, round 9b)', (function () { var st = walk($(P18, 'vpGs') || $(P, 'vpGs'), function (e) { return e.tagName === 'STYLE'; }); var css = st ? st.textContent : ''; return /\.vpgs-in\{color-scheme:dark\}/.test(css) && /input\[type=date\]::-webkit-calendar-picker-indicator\{filter:invert\(1\);opacity:1/.test(css) && /input\[type=time\]::-webkit-calendar-picker-indicator,/.test(css); })());

  section('7. WIRED IN');
  var FR = readFile('venueplay/app/vp-firstrun.js'), IDX = readFile('venueplay/app/index.html');
  var gstep = FR.slice(FR.indexOf('STEP.pick = function'), FR.indexOf('STEP.tv = function'));
  check('the guide\'s opening step (wizard-v2\'s pick) runs the games setup with its own answers and saving path, then carries on to the TV step', /root\.VPGameSetup\.run\(ctx, \{[^}]*answers: answers,[^}]*saveAnswers:/.test(gstep), gstep.slice(0, 600));
  check('with the games setup loaded, the per-game steps are left out (it sets each game up itself), and the TV step stays', /if \(GAME_STEPS\.indexOf\(s\) >= 0\) \{ if \(!setupGames && p\.indexOf\(s\) >= 0\) out\.push\(s\); return; \}/.test(FR) && /if \(s === "tv" \|\| s === "hosts"\) \{ if \(p\.length && !state\.tvDone\) out\.push\(s\); return; \}/.test(FR) && /steps = build\(\); setNext\("Next", true\); return api\.next\(\);/.test(gstep));
  var clean = FR.slice(FR.indexOf('function cleanAnswers'), FR.indexOf('function answersFor'));
  check('the guide\'s own cleaning keeps games_at and setup', /VPGameSetup\.cleanExtra\(a, out\)/.test(clean));
  var x = P.GS.cleanExtra({ games_at: '2026-11-07', setup: { trivia: 'done', evil: '<b>' }, other: 1 });
  check('and only them, only well formed', JSON.stringify(x) === '{"games_at":"2026-11-07","setup":{"trivia":"done"}}' && JSON.stringify(P.GS.cleanExtra({ games_at: 'soon' })) === '{}', x);
  check('index.html loads the settings list and the games setup before the guide', IDX.indexOf('vp-setup-help.js') > 0 && IDX.indexOf('vp-setup-help.js') < IDX.indexOf('vp-gamesetup.js') && IDX.indexOf('vp-gamesetup.js') < IDX.indexOf('<script src="vp-firstrun.js">'));
  [['trivia/host.html', 'trivia'], ['musical/host.html', 'musical'], ['raffle/host.html', 'raffles'], ['members/host.html', 'members'], ['index.html', 'bingo']].forEach(function (p) {
    var src = readFile('venueplay/app/' + p[0]);
    var calls = src.match(/VPGameSetup\.firstOpen\("(\w+)"/g) || [];
    var loads = p[0] === 'index.html' || (src.indexOf('<script src="../vp-setup-help.js"></script>') > 0 && src.indexOf('<script src="../vp-gamesetup.js"></script>') > src.indexOf('<script src="../vp-setup-help.js"></script>'));
    check(p[0] + ' loads it and opens ' + p[1] + '\'s own setup, the first time only', loads && calls.length === 1 && calls[0] === 'VPGameSetup.firstOpen("' + p[1] + '"', calls);
  });

  print(''); print(bad ? ('FAIL ' + bad + ' of ' + ran) : ('ALL ' + ran + ' CHECKS PASSED'));
})().catch(function (e) { print('CRASH ' + e + '\n' + (e && e.stack)); bad++; });
