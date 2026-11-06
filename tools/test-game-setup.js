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

var HELP = readFile('venueplay/app/vp-setup-help.js'), GS = readFile('venueplay/app/vp-gamesetup.js'), GAMEW = readFile('venueplay-backend/worker/venueplay-game.js');
var NOW = Date.parse('2026-11-06T15:30:00Z');   // 1:30am on Sat 7 Nov in Brisbane: the Brisbane date is the 7th, not the 6th
var CALLS, PREFS, SAVED, STORE, RELOADS;
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
    else if (/musical-library\.json$/.test(u)) ans = { playlists: [{ id: 'pub-classics', name: 'Pub Classics' }, { id: 'bad id<script>', name: 'x' }] };
    return Promise.resolve({ ok: st < 400, status: st, json: function () { return Promise.resolve(ans); } });
  };
  var client = { auth: { getSession: function () { return Promise.resolve({ data: { session: { access_token: 'TOKEN-1' } } }); } },
    from: function (t) { var b = { select: function () { return b; }, eq: function () { return b; },
      then: function (r) { return Promise.resolve({ data: t === 'vp_question_sets' ? [{ id: 'S-OWN', title: 'Our quiz', question_count: 40, owner_venue_id: 'V1' }, { id: 'S-LIB', title: 'General knowledge', question_count: 400, owner_venue_id: null }, { id: 'S-OTHER', title: 'Another pub', owner_venue_id: 'V2' }] : [] }).then(r); } }; return b; } };
  var window = { localStorage: storage, document: document, fetch: fetch, location: { reload: function () { RELOADS++; } } };
  (new Function('window', HELP))(window);
  (new Function('window', GS))(window);
  var ctx = { role: over.role || 'owner', venue: { id: 'V1', name: 'The Test Arms' }, settings: { setup_answers: over.answers || {} } };
  var deps = { doc: document, storage: storage, fetch: fetch, client: client, now: NOW, ctx: ctx,
    saveSettings: function (id, patch) { SAVED.push({ id: id, patch: JSON.parse(JSON.stringify(patch)) }); return over.saveFail ? Promise.reject(new Error('no column')) : Promise.resolve({}); },
    onSaved: function () { RELOADS++; } };
  return { doc: document, body: body, W: window, GS: window.VPGameSetup, H: window.VPSetupHelp, ctx: ctx, deps: deps };
}
function $(P, id) { return P.doc.getElementById(id); }
function T(P, id) { var e = $(P, id); return e ? seen(e) : ''; }
function gameBtn(P, g) { return walk($(P, 'vpGsGames'), function (e) { return e.getAttribute && e.getAttribute('data-game') === g; }); }
function srtj(o) { var r = {}; Object.keys(o || {}).sort().forEach(function (x) { r[x] = o[x]; }); return JSON.stringify(r); }
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
      if (s.kind === 'info') return;
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
  check('and raffles tickets 1 to 150 with 180 seconds to claim', String(rd.range_min) === boxValue(RAF, 'rfStart') && String(rd.range_max) === boxValue(RAF, 'rfEnd') && String(rd.time_to_present) === boxValue(RAF, 'rfTime'), [rd]);
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
  check('the one question, in Dean\'s words', T(P, 'vpGsTitle') === 'What games do you play at your venue?', T(P, 'vpGsTitle'));
  var ticks = all($(P, 'vpGsGames'), function (e) { return e.getAttribute && e.getAttribute('role') === 'checkbox'; }).map(function (e) { return seen(e); });
  check('ticks: Trivia, Musical bingo, Bingo, Raffles, Members draws, then Something else (jag the joker only once it is live)', ticks.join() === 'Trivia,Musical bingo,Bingo,Raffles,Members draws,Something else', ticks);
  check('Next waits for a tick', $(P, 'vpGsNext').disabled === true);
  gameBtn(P, 'members').click(); gameBtn(P, 'trivia').click(); gameBtn(P, 'musical').click();
  check('a tick shows ticked', gameBtn(P, 'trivia').getAttribute('aria-checked') === 'true' && gameBtn(P, 'bingo').getAttribute('aria-checked') === 'false');
  $(P, 'vpGsNext').click(); if ($(P, 'vpGsWeekSkip')) $(P, 'vpGsWeekSkip').click(); await settle();
  var sa = SAVED.length ? SAVED[SAVED.length - 1].patch.setup_answers : null;
  check('STORED for the venue: setup_answers.games in Dean\'s order, whatever order they were tapped', sa && sa.games.join() === 'trivia,musical,members', sa);
  check('with games_at, the Brisbane date (1:30am Saturday is the 7th)', sa && sa.games_at === '2026-11-07', sa && sa.games_at);
  check('saved for the venue it is for, only', SAVED.every(function (s) { return s.id === 'V1'; }));

  section('4. "Would you like to set them all up today?" Not today, then "No worries."');
  check('the second question, naming their games', T(P, 'vpGsTitle') === 'Would you like to set them all up today?' && /You picked trivia, musical bingo and members draws\./.test(T(P, 'vpGsBody')), T(P, 'vpGsBody'));
  PREFS.trivia = { count: 20 };   // a value the venue already chose
  $(P, 'vpGsAllNo').click(); await settle();
  check('"No worries." in Dean\'s words, naming the games with defaults', T(P, 'vpGsTitle') === 'No worries.' && T(P, 'vpGsNoWorries') === "We'll remind you when you open each of those games. Your default settings have been saved for trivia and musical bingo.", T(P, 'vpGsNoWorries'));
  check('members draws are never called saved: they have no defaults, and are named apart', /Members draws still need your draw details \(the draw name, day and jackpot\)/.test(T(P, 'vpGsMembersNote')), T(P, 'vpGsMembersNote'));
  var tp = posts('/host/game-prefs').filter(function (c) { return c.body.game === 'trivia'; })[0];
  check('today\'s trivia defaults written for the keys not saved yet', tp && tp.body.prefs.time_s === 30 && tp.body.prefs.speed_bonus === true && tp.body.venue_id === 'V1', tp && tp.body);
  check('and never over a value the venue chose (their 20 questions stay 20)', tp && !('count' in tp.body.prefs) && PREFS.trivia.count === 20, tp && tp.body.prefs);
  check('nothing written for members draws, and nothing to /host/members/settings', !posts('/host/game-prefs').some(function (c) { return c.body.game === 'members'; }) && posts('/host/members/settings').length === 0);
  check('each Worker call carries the signed-in token', CALLS.filter(function (c) { return /host\//.test(c.url); }).every(function (c) { return c.auth === 'Bearer TOKEN-1'; }));
  sa = SAVED[SAVED.length - 1].patch.setup_answers;
  check('all three kept as "later", so each opens its own setup the first time', sa.setup && sa.setup.trivia === 'later' && sa.setup.musical === 'later' && sa.setup.members === 'later', sa.setup);
  var P3 = page({ prefsReadFail: true, answers: { games: ['trivia'] } }); P3.GS.run(P3.ctx, P3.deps); await settle(); $(P3, 'vpGsGo').click(); $(P3, 'vpGsNext').click(); if ($(P3, 'vpGsWeekSkip')) $(P3, 'vpGsWeekSkip').click(); $(P3, 'vpGsAllNo').click(); await settle();
  check('when what the venue has cannot be read, nothing is written over it', posts('/host/game-prefs').length === 0, posts('/host/game-prefs'));
  $(P, 'vpGsDone').click(); var outcome = await done;
  check('"Go to my console" closes it', outcome === 'done' && !$(P, 'vpGs'), outcome);

  section('5. ONE GAME AT A TIME, every setting with a "?"');
  P = page(); done = P.GS.run(P.ctx, P.deps); await settle();
  $(P, 'vpGsGo').click(); gameBtn(P, 'trivia').click(); gameBtn(P, 'musical').click(); gameBtn(P, 'members').click(); $(P, 'vpGsNext').click(); if ($(P, 'vpGsWeekSkip')) $(P, 'vpGsWeekSkip').click(); await settle();
  $(P, 'vpGsAllYes').click(); await settle();
  check('trivia first, "Game 1 of 3"', T(P, 'vpGsTitle') === 'Set up trivia' && T(P, 'vpGsCount') === 'Game 1 of 3', [T(P, 'vpGsTitle'), T(P, 'vpGsCount')]);
  var qs = all($(P, 'vpGsBody'), function (e) { return e.className === 'vpgs-q'; });
  check('a "?" beside every trivia setting (' + P.H.byKey('trivia').settings.length + ')', qs.length === P.H.byKey('trivia').settings.length, qs.length);
  check('the advanced ones as short questions', /Should faster answers score more\?/.test(T(P, 'vpGsBody')) && /A few quick questions/.test(T(P, 'vpGsBody')));
  var qSpeed = $(P, 'vpGsQ_speed_bonus'), qBuzz = $(P, 'vpGsQ_buzzer');
  qSpeed.click();
  check('tapping "?" opens its plain words', $(P, 'vpGsHelp_speed_bonus').style.display === 'block' && qSpeed.getAttribute('aria-expanded') === 'true' && /scores 150 instead of 100/.test(T(P, 'vpGsHelp_speed_bonus')), T(P, 'vpGsHelp_speed_bonus'));
  qBuzz.click();
  check('one open at a time', $(P, 'vpGsHelp_speed_bonus').style.display === 'none' && $(P, 'vpGsHelp_buzzer').style.display === 'block');
  qBuzz.click();
  check('tapping it again closes it', $(P, 'vpGsHelp_buzzer').style.display === 'none' && qBuzz.getAttribute('aria-expanded') === 'false');
  var setSel = $(P, 'vpGsIn_set_id');
  check('categories: their own sets and the venueplay library, never another venue\'s', setSel.children.map(function (o) { return o.value; }).join() === ',S-OWN,S-LIB', setSel.children.map(function (o) { return o.value; }));
  $(P, 'vpGsIn_count').value = '15';
  walk($(P, 'vpGsBody'), function (e) { return e.textContent === 'On' && e.parentNode && e.parentNode.parentNode && e.parentNode.parentNode.parentNode && e.parentNode.parentNode.parentNode.getAttribute && e.parentNode.parentNode.parentNode.getAttribute('data-key') === 'buzzer'; }).click();
  CALLS = []; $(P, 'vpGsSave').click(); await settle();
  var sv = posts('/host/game-prefs')[0];
  check('Save sends trivia\'s values to /host/game-prefs for this venue', sv && sv.body.game === 'trivia' && sv.body.venue_id === 'V1' && sv.body.prefs.count === 15 && sv.body.prefs.buzzer === true && sv.body.prefs.time_s === 30, sv && sv.body);
  check('a category left as "your last set" is not sent, so the console keeps choosing', sv && !('set_id' in sv.body.prefs));
  check('then "Do you want to set up your next game?", naming what is left', T(P, 'vpGsTitle') === 'Do you want to set up your next game?' && /You still have musical bingo and members draws\./.test(T(P, 'vpGsBody')), T(P, 'vpGsBody'));
  $(P, 'vpGsNextYes').click(); await settle();
  var which = all($(P, 'vpGsWhich'), function (e) { return e.getAttribute && e.getAttribute('data-game'); }).map(function (e) { return e.getAttribute('data-game'); });
  check('Yes: "What would you like to set up next?" with the games left', T(P, 'vpGsTitle') === 'What would you like to set up next?' && which.join() === 'musical,members', which);
  walk($(P, 'vpGsWhich'), function (e) { return e.getAttribute && e.getAttribute('data-game') === 'members'; }).click(); await settle();
  check('members draws, as game 3 of 3', T(P, 'vpGsTitle') === 'Set up members draws' && T(P, 'vpGsCount') === 'Game 3 of 3', [T(P, 'vpGsTitle'), T(P, 'vpGsCount')]);
  CALLS = []; $(P, 'vpGsSave').click(); await settle();
  check('a members draw with no name is refused on the page, nothing sent', posts('/host/members/settings').length === 0 && /name/.test(T(P, 'vpGsMsg')), T(P, 'vpGsMsg'));
  $(P, 'vpGsIn_name').value = 'Friday Members Draw'; $(P, 'vpGsIn_starting_amount_cents').value = '250'; $(P, 'vpGsIn_time_to_claim_seconds').value = '120';
  $(P, 'vpGsSave').click(); await settle();
  var ms = posts('/host/members/settings')[0];
  check('the draw is made through /host/members/settings: name, $250 as 25000 cents, 120 seconds', ms && ms.body.venue_id === 'V1' && ms.body.name === 'Friday Members Draw' && ms.body.starting_amount_cents === 25000 && ms.body.time_to_claim_seconds === 120 && !ms.body.draw_id, ms && ms.body);
  check('blank boxes are not sent (members draws have no defaults to invent)', ms && !('increment_cents' in ms.body) && !('max_jackpot_cents' in ms.body));
  check('one game left: asked again, between games of this first run', T(P, 'vpGsTitle') === 'Do you want to set up your next game?' && /musical bingo\./.test(T(P, 'vpGsBody')));
  $(P, 'vpGsNextNo').click(); await settle();
  check('No: "No worries." for musical bingo, its defaults saved', T(P, 'vpGsTitle') === 'No worries.' && /saved for musical bingo\./.test(T(P, 'vpGsNoWorries')) && !$(P, 'vpGsMembersNote'), T(P, 'vpGsNoWorries'));
  sa = SAVED[SAVED.length - 1].patch.setup_answers;
  check('trivia and members draws "done", musical bingo "later"', sa.setup.trivia === 'done' && sa.setup.members === 'done' && sa.setup.musical === 'later', sa.setup);
  var P4 = page({ membersRefuse: true }); P4.GS.run(P4.ctx, Object.assign(P4.deps, { start: 'pick' })); await settle();
  gameBtn(P4, 'members').click(); $(P4, 'vpGsNext').click(); if ($(P4, 'vpGsWeekSkip')) $(P4, 'vpGsWeekSkip').click(); $(P4, 'vpGsAllYes').click(); await settle();
  $(P4, 'vpGsIn_name').value = 'Draw'; $(P4, 'vpGsSave').click(); await settle();
  check('the Worker\'s own refusal is shown, and it stays on the game', /Only a manager or owner/.test(T(P4, 'vpGsMsg')) && T(P4, 'vpGsTitle') === 'Set up members draws', T(P4, 'vpGsMsg'));
  var P5 = page(); P5.GS.run(P5.ctx, Object.assign(P5.deps, { start: 'pick' })); await settle();
  gameBtn(P5, 'bingo').click(); $(P5, 'vpGsNext').click(); if ($(P5, 'vpGsWeekSkip')) $(P5, 'vpGsWeekSkip').click(); $(P5, 'vpGsAllYes').click(); await settle(); $(P5, 'vpGsSave').click(); await settle();
  check('the last game saved: "You\'re ready for your week." and no next-game question', T(P5, 'vpGsTitle') === "You're ready for your week.", T(P5, 'vpGsTitle'));

  section('6. THE FIRST TIME A SKIPPED GAME IS OPENED');
  P = page({ answers: { games: ['musical'], setup: { musical: 'later' } } });
  var fo = P.GS.firstOpen('musical', P.deps); await settle();
  check('musical bingo\'s own setup opens over its console', T(P, 'vpGsTitle') === 'Set up musical bingo' && T(P, 'vpGsFirstTag') === 'First time in musical bingo', T(P, 'vpGsTitle'));
  check('marked "shown" before anything else, for the venue and this device', SAVED.length && SAVED[0].patch.setup_answers.setup.musical === 'shown' && JSON.parse(STORE['vpGameSetup:V1']).setup.musical === 'shown', SAVED[0]);
  var asked = all($(P, 'vpGsBody'), function (e) { return e.getAttribute && e.getAttribute('data-key'); }).map(function (e) { return e.getAttribute('data-key'); });
  check('musical bingo asks its three quick questions first: which music, what prize, how many rounds (Dean, round 2)', asked.join() === 'playlists,rounds,prize_same,prizes', asked);
  await settle();
  var music = all($(P, 'vpGsIn_playlists'), function (e) { return e.getAttribute && e.getAttribute('data-id'); }).map(function (e) { return e.getAttribute('data-id'); });
  check('the music from the song library, a bad id never offered', music.join() === 'pub-classics', music);
  check('the popular songs (Pub Classics) ticked to start with', walk($(P, 'vpGsIn_playlists'), function (e) { return e.getAttribute && e.getAttribute('data-id') === 'pub-classics'; }).getAttribute('aria-checked') === 'true');
  check('a BIG "Play now with the defaults" button, not a small link', /^Play now with the defaults/.test(T(P, 'vpGsPlayNow')) && / big/.test($(P, 'vpGsPlayNow').className), [T(P, 'vpGsPlayNow'), $(P, 'vpGsPlayNow').className]);
  CALLS = []; $(P, 'vpGsPlayNow').click(); await settle();
  var dp = posts('/host/game-prefs')[0];
  check('Play now: the defaults saved where nothing was, the popular songs, then straight to the console', (await fo) === 'defaults' && !$(P, 'vpGs') && dp && dp.body.prefs.playlist === 'pub-classics' && dp.body.prefs.playlists.join() === 'pub-classics' && dp.body.prefs.rounds === 1, dp && dp.body);
  P.ctx.settings.setup_answers.setup.musical = 'later';   // even if the venue's save was refused (163 not run)
  check('never again on this device', (await P.GS.firstOpen('musical', P.deps)) === 'none' && !$(P, 'vpGs'));
  var P6 = page({ answers: { setup: { trivia: 'later' } }, role: 'host' });
  check('a host opening the console on a busy night is never stopped by it', (await P6.GS.firstOpen('trivia', P6.deps)) === 'none' && !$(P6, 'vpGs'));
  var P7 = page({ answers: { setup: { trivia: 'done', raffles: 'shown' } } });
  check('a game already set up, or already shown, opens nothing', (await P7.GS.firstOpen('trivia', P7.deps)) === 'none' && (await P7.GS.firstOpen('raffles', P7.deps)) === 'none' && (await P7.GS.firstOpen('bingo', P7.deps)) === 'none');
  var P8 = page({ answers: { setup: { raffles: 'later' } } }); var fo8 = P8.GS.firstOpen('raffles', P8.deps); await settle();
  $(P8, 'vpGsSave').click(); await settle();
  var rp = posts('/host/game-prefs')[0];
  check('Save: raffles settings sent, the console takes them (reload), and it is "done"', (await fo8) === 'saved' && RELOADS === 1 && rp.body.game === 'raffle' && rp.body.prefs.range_max === 150 && rp.body.prefs.prizes.join() === 'Meat Tray' && JSON.parse(STORE['vpGameSetup:V1']).setup.raffles === 'done', rp && rp.body);
  var P9 = page({ answers: { setup: { bingo: 'later' } } }); P9.GS.firstOpen('bingo', P9.deps); await settle();
  check('bingo asks who draws the balls when they first open it (not in the first run)', !!$(P9, 'vpGsQ_caller'), T(P9, 'vpGsBody').slice(0, 200));
  check('setup states keep only known games and states', JSON.stringify(P.GS.cleanSetup({ trivia: 'done', musical: 'x', jag: 'done', bingo: 'later' })) === '{"trivia":"done","bingo":"later"}');

  section('6b. ROUND 2 (Dean, 6 Nov 2026): something else, prizes per round, raffle prizes, phone or paper bingo, the draw date');
  P = page(); P.GS.run(P.ctx, Object.assign(P.deps, { start: 'pick' })); await settle();
  gameBtn(P, 'other').click();
  check('"Something else" opens a short box', $(P, 'vpGsOther').parentNode.style.display === '' && $(P, 'vpGsNext').disabled === true);
  $(P, 'vpGsOther').value = '  Karaoke <b>and</b> poker nights, plus a footy tipping comp every week of the season  ';
  (($(P, 'vpGsOther').handlers.input) || []).forEach(function (f) { f(); });
  check('a "Something else" answer on its own is enough to go on', $(P, 'vpGsNext').disabled === false);
  gameBtn(P, 'musical').click(); gameBtn(P, 'raffles').click(); gameBtn(P, 'bingo').click(); gameBtn(P, 'members').click();
  $(P, 'vpGsNext').click(); if ($(P, 'vpGsWeekSkip')) $(P, 'vpGsWeekSkip').click(); await settle();
  sa = SAVED[SAVED.length - 1].patch.setup_answers;
  check('kept as setup_answers.other: cleaned, no markup, at most 60 characters', sa.other && sa.other.length <= 60 && !/[<>]/.test(sa.other) && /^Karaoke b and \/b poker nights/.test(sa.other), sa.other);
  $(P, 'vpGsAllYes').click(); await settle();
  check('musical bingo first (game 1 of 4)', T(P, 'vpGsTitle') === 'Set up musical bingo' && T(P, 'vpGsCount') === 'Game 1 of 4', [T(P, 'vpGsTitle'), T(P, 'vpGsCount')]);
  check('one prize box while the prize is the same every round', $(P, 'vpGsIn_prizes').children.length === 1);
  $(P, 'vpGsIn_rounds').value = '3'; $(P, 'vpGsIn_rounds').handlers.input.forEach(function (f) { f(); });
  walk($(P, 'vpGsBody'), function (e) { return e.getAttribute && e.getAttribute('data-value') === 'false' && e.parentNode.parentNode.parentNode.getAttribute('data-key') === 'prize_same'; }).click();
  check('three rounds, not the same prize: a box for each round', $(P, 'vpGsIn_prizes').children.length === 3 && $(P, 'vpGsIn_prizes_2').getAttribute('aria-label') === 'Prize for round 3', $(P, 'vpGsIn_prizes').children.length);
  $(P, 'vpGsIn_prizes_0').value = '$20 bar tab'; $(P, 'vpGsIn_prizes_2').value = 'Meat tray';
  walk($(P, 'vpGsIn_playlists'), function (e) { return e.getAttribute && e.getAttribute('data-id') === 'pub-classics'; }).click();   // pick nothing: the first picked is the playlist
  CALLS = []; $(P, 'vpGsSave').click(); await settle();
  var mp = posts('/host/game-prefs')[0];
  check('saved: rounds 3, a prize for each round, the first round\'s as the console\'s prize', mp && mp.body.prefs.rounds === 3 && mp.body.prefs.prizes.join('|') === '$20 bar tab||Meat tray' && mp.body.prefs.prize === '$20 bar tab' && mp.body.prefs.prize_same === false, mp && mp.body);
  check('no music picked: nothing sent for it, the console keeps choosing', mp && !('playlists' in mp.body.prefs) && !('playlist' in mp.body.prefs), mp && mp.body);
  check('the musical bingo Worker keeps all of it', mp && srtj(WK.clean('musical', mp.body.prefs)) === srtj(mp.body.prefs), mp && WK.clean('musical', mp.body.prefs));
  $(P, 'vpGsNextYes').click(); await settle(); walk($(P, 'vpGsWhich'), function (e) { return e.getAttribute && e.getAttribute('data-game') === 'bingo'; }).click(); await settle();
  check('bingo: never asks about real balls in the first run (Dean: it becomes a prompt when they open the game)', !$(P, 'vpGsQ_caller'));
  check('phone tickets: tickets each player is asked, no paper words', $(P, 'vpGsIn_cards').parentNode.parentNode.style.display === '' && walk($(P, 'vpGsBody'), function (e) { return e.getAttribute && e.getAttribute('data-key') === 'paper_note'; }).style.display === 'none');
  walk($(P, 'vpGsBody'), function (e) { return e.getAttribute && e.getAttribute('data-value') === 'paper'; }).click();
  check('paper tickets: "We can\'t check paper tickets, but we can draw the balls for you, or you draw them and tap each number on the screen."', /We can't check paper tickets, but we can draw the balls for you, or you draw them and tap each number on the screen\./.test(T(P, 'vpGsBody')) && walk($(P, 'vpGsBody'), function (e) { return e.getAttribute && e.getAttribute('data-key') === 'paper_note'; }).style.display === '' && $(P, 'vpGsIn_cards').parentNode.parentNode.style.display === 'none');
  check('no empty "A few quick questions" heading when paper leaves nothing advanced to ask', $(P, 'vpGsAdvanced').style.display === 'none');
  CALLS = []; $(P, 'vpGsSave').click(); await settle();
  var bp = posts('/host/game-prefs')[0];
  check('saved as paper, with no tickets-each-player for paper', bp && bp.body.prefs.ticket_kind === 'paper' && !('cards' in bp.body.prefs) && !('allow_early' in bp.body.prefs) && srtj(WK.clean('bingo', bp.body.prefs)) === srtj(bp.body.prefs), bp && bp.body);
  $(P, 'vpGsNextYes').click(); await settle(); walk($(P, 'vpGsWhich'), function (e) { return e.getAttribute && e.getAttribute('data-game') === 'raffles'; }).click(); await settle();
  $(P, 'vpGsIn_prize_count').value = '2'; $(P, 'vpGsIn_prize_count').handlers.input.forEach(function (f) { f(); });
  check('two prizes, all the same: still one box', $(P, 'vpGsIn_prizes').children.length === 1);
  walk($(P, 'vpGsBody'), function (e) { return e.getAttribute && e.getAttribute('data-value') === 'false' && e.parentNode.parentNode.parentNode.getAttribute('data-key') === 'prizes_same'; }).click();
  $(P, 'vpGsIn_prizes_1').value = 'Fuel voucher';
  CALLS = []; $(P, 'vpGsSave').click(); await settle();
  var rr = posts('/host/game-prefs')[0];
  check('not the same: a box each, saved as the raffle console\'s prize buttons', rr && rr.body.prefs.prizes.join('|') === 'Meat Tray|Fuel voucher' && rr.body.prefs.prize_count === 2 && rr.body.prefs.prizes_same === false && rr.body.prefs.prizes_weekly === true, rr && rr.body);
  check('the raffle Worker keeps all of it', rr && srtj(WK.clean('raffle', rr.body.prefs)) === srtj(rr.body.prefs), rr && WK.clean('raffle', rr.body.prefs));
  $(P, 'vpGsNextYes').click(); await settle(); walk($(P, 'vpGsWhich'), function (e) { return e.getAttribute && e.getAttribute('data-game') === 'members'; }).click(); await settle();
  $(P, 'vpGsIn_date_started').value = '2026-11-13'; $(P, 'vpGsIn_date_started').handlers.change.forEach(function (f) { f(); });
  check('the first draw date fills in the draw day (13 Nov 2026 is a Friday)', $(P, 'vpGsIn_draw_day').value === 'Friday', $(P, 'vpGsIn_draw_day').value);
  $(P, 'vpGsIn_draw_day').value = 'Thursday'; $(P, 'vpGsIn_draw_day').handlers.input.forEach(function (f) { f(); });
  $(P, 'vpGsIn_date_started').value = '2026-11-14'; $(P, 'vpGsIn_date_started').handlers.change.forEach(function (f) { f(); });
  check('a day they typed themselves is kept', $(P, 'vpGsIn_draw_day').value === 'Thursday', $(P, 'vpGsIn_draw_day').value);

  section('6c. WHICH GAME RUNS ON WHICH NIGHT (Dean, 6 Nov 2026), right after the games question, skippable');
  P = page(); P.GS.run(P.ctx, Object.assign(P.deps, { start: 'pick' })); await settle();
  gameBtn(P, 'trivia').click(); gameBtn(P, 'musical').click(); gameBtn(P, 'members').click();
  SAVED = []; P.doc.getElementById('vpGsNext').click(); await settle();
  check('asked right after the games question', T(P, 'vpGsTitle') === 'Which nights do you run them?', T(P, 'vpGsTitle'));
  var wk = all($(P, 'vpGsWeek'), function (e) { return e.getAttribute && e.getAttribute('data-game') && e.className === 'vpgs-row'; }).map(function (e) { return e.getAttribute('data-game'); });
  check('one row per game they ticked, in the house order', wk.join() === 'trivia,musical,members', wk);
  function day(g, d) { return walk($(P, 'vpGsWeek'), function (e) { return e.getAttribute && e.getAttribute('aria-label') && e.getAttribute('data-day') === d && e.parentNode.parentNode.getAttribute('data-game') === g; }); }
  day('trivia', 'wed').click(); day('musical', 'fri').click(); day('members', 'fri').click(); day('members', 'mon').click(); day('members', 'mon').click();
  check('a night tapped twice is off again, and each night on asks an optional start time', !$(P, 'vpGsTime_members_mon') && !!$(P, 'vpGsTime_trivia_wed') && !!$(P, 'vpGsTime_members_fri'));
  $(P, 'vpGsTime_trivia_wed').value = '19:00'; $(P, 'vpGsTime_trivia_wed').handlers.input.forEach(function (f) { f(); });
  $(P, 'vpGsTime_musical_fri').value = '19:30'; $(P, 'vpGsTime_musical_fri').handlers.change.forEach(function (f) { f(); });
  $(P, 'vpGsWeekNext').click(); await settle();
  sa = SAVED[SAVED.length - 1].patch.setup_answers;
  check('stored as setup_answers.week: Wednesday trivia 7pm; Friday musical bingo 7:30pm and members draws with no time', JSON.stringify(sa.week) === '[{"day":"wed","games":[{"game":"trivia","start":"19:00"}]},{"day":"fri","games":[{"game":"musical","start":"19:30"},{"game":"members"}]}]', sa.week);
  check('and the nights, the shape the Account page card already reads', JSON.stringify(sa.nights) === '["wed","fri"]', sa.nights);
  check('then "Would you like to set them all up today?"', T(P, 'vpGsTitle') === 'Would you like to set them all up today?');
  $(P, 'vpGsBack').click(); await settle();
  check('Back shows what they picked, with the times', day('trivia', 'wed').getAttribute('aria-pressed') === 'true' && $(P, 'vpGsTime_trivia_wed').value === '19:00');
  var P10 = page(); P10.GS.run(P10.ctx, Object.assign(P10.deps, { start: 'pick' })); await settle();
  gameBtn(P10, 'bingo').click(); SAVED = []; P10.doc.getElementById('vpGsNext').click(); await settle(); $(P10, 'vpGsWeekSkip').click(); await settle();
  check('skippable: "Skip for now" goes on with nothing stored for the week', T(P10, 'vpGsTitle') === 'Would you like to set them all up today?' && !SAVED.some(function (x) { return x.patch.setup_answers.week; }));
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
  SAVED = []; $(P11, 'vpGsWeekNext').click();
  check('Save keeps the week for the venue and closes', (await wo) === 'done' && !$(P11, 'vpGs') && JSON.stringify(SAVED[0].patch.setup_answers.week) === '[{"day":"wed","games":[{"game":"trivia","start":"19:00"}]},{"day":"sat","games":[{"game":"musical"}]}]', SAVED[0] && SAVED[0].patch.setup_answers.week);
  check('the week in words for the Account page: "Wed: Trivia 7pm · Fri: Musical bingo 7:30pm, Members draws"', P.GS.weekWords([{ day: 'wed', games: [{ game: 'trivia', start: '19:00' }] }, { day: 'fri', games: [{ game: 'musical', start: '19:30' }, { game: 'members' }] }]) === 'Wed: Trivia 7pm · Fri: Musical bingo 7:30pm, Members draws');
  var BIL = readFile('venueplay/app/billing.html'), about = BIL.slice(BIL.indexOf('function renderAbout'), BIL.indexOf('function renderOtherAccounts'));
  check('the Account page shows the week and opens the week step for that venue (weekOnly), and loads the module', /VPGameSetup\.weekWords\(\(by\[v\.id\] \|\| \{\}\)\.week\)/.test(about) && /VPGameSetup\.run\(cx, \{ start: "week", weekOnly: true/.test(about) && BIL.indexOf('<script src="vp-gamesetup.js"></script>') > 0 && /esc\(wk\)/.test(about), about.slice(0, 300));

  section('7. WIRED IN');
  var FR = readFile('venueplay/app/vp-firstrun.js'), IDX = readFile('venueplay/app/index.html');
  var gstep = FR.slice(FR.indexOf('STEP.games = function'), FR.indexOf('STEP.tv = function'));
  check('the guide\'s games step runs the games setup with its own answers and saving path', /root\.VPGameSetup\.run\(ctx, \{[^}]*answers: answers,[^}]*saveAnswers:/.test(gstep), gstep.slice(0, 600));
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

  print(''); print(bad ? ('FAIL ' + bad + ' of ' + ran) : ('PASS ' + ran + ' checks'));
})().catch(function (e) { print('CRASH ' + e + '\n' + (e && e.stack)); bad++; });
