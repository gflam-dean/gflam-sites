/* THE CONSOLES USE THE SETUP WIZARD'S ANSWERS (Dean, 6 Nov 2026, INBOX 104 follow-up for Tue 10 Nov).

   venueplay/app/vp-setupuse.js RUN in jsc, and the four console pages read for the exact calls that use it:
     1. weekPick: several lists take turns, Brisbane weeks from Monday
     2. roundPrize: musical bingo's prize per round, "no prize" rounds, one prize for every round, past the last round
     3. round: the night's round counter, per venue, rolling over at 6am Brisbane
     4. prizeButtons: one button per saved prize (blanks and repeats left out), a tap hands the prize over, text only
     5. wired: musical bingo (this week's list, the round's prize, buttons, the round moving on a win), bingo (buttons
        under the prize box and the new game box), trivia (their categories first and taking turns, theme nights opening
        the builder, Tonight's prize with buttons), the builder (?topic= typed into the topic search, safely)
   tools/setup-use-in-chrome.test.py opens the real consoles. Run from the repo root:  jsc tools/test-setup-use.js */
var ran = 0, bad = 0;
function check(n, c, saw) { ran++; if (c) print('  ok   ' + n); else { bad++; print('  FAIL ' + n + (saw !== undefined ? '   saw: ' + String(typeof saw === 'string' ? saw : JSON.stringify(saw)).slice(0, 300) : '')); } }
function section(t) { print(''); print(t); }
function El(tag) { this.tagName = String(tag).toUpperCase(); this.children = []; this.parentNode = null; this.attrs = {}; this.textContent = ''; this.handlers = {}; this.id = ''; this.className = ''; this.type = ''; }
Object.defineProperty(El.prototype, 'nextSibling', { get: function () { var p = this.parentNode; if (!p) return null; var i = p.children.indexOf(this); return p.children[i + 1] || null; } });
El.prototype.appendChild = function (k) { k.parentNode = this; this.children.push(k); return k; };
El.prototype.insertBefore = function (k, ref) { k.parentNode = this; var i = ref ? this.children.indexOf(ref) : -1; if (i < 0) this.children.push(k); else this.children.splice(i, 0, k); return k; };
El.prototype.removeChild = function (k) { var i = this.children.indexOf(k); if (i >= 0) this.children.splice(i, 1); k.parentNode = null; return k; };
El.prototype.setAttribute = function (k, v) { this.attrs[k] = String(v); };
El.prototype.getAttribute = function (k) { return k in this.attrs ? this.attrs[k] : null; };
El.prototype.addEventListener = function (e, f) { (this.handlers[e] = this.handlers[e] || []).push(f); };
El.prototype.click = function () { (this.handlers.click || []).forEach(function (f) { f(); }); };
var body = new El('body');
function find(el, id) { if (el.id === id) return el; for (var i = 0; i < el.children.length; i++) { var r = find(el.children[i], id); if (r) return r; } return null; }
var document = { createElement: function (t) { return new El(t); }, getElementById: function (id) { return find(body, id); } };
var window = {};
(new Function('window', readFile('venueplay/app/vp-setupuse.js')))(window);
var U = window.VPSetupUse;

section('1. TAKING TURNS');
var mon = Date.parse('2026-11-08T14:00:00Z');   // Monday 9 Nov 2026, midnight in Brisbane
var L = ['pub-classics', '80s-pop', '90s', '2000s', 'aussie'], seen = [];
for (var w = 0; w < 6; w++) seen.push(U.weekPick(L, mon + w * 7 * 86400000));
check('five weeks, five different lists, then round again', seen.slice(0, 5).slice().sort().join() === L.slice().sort().join() && seen[5] === seen[0], seen);
check('the week turns at midnight Monday in Brisbane, not in UTC', U.weekPick(L, mon - 1000) !== U.weekPick(L, mon) && U.weekPick(L, mon + 6.9 * 86400000) === U.weekPick(L, mon));
check('nothing saved: nothing picked', U.weekPick([], mon) === '' && U.weekPick(null, mon) === '');

section('2. A PRIZE FOR EACH ROUND');
var P = { rounds: 3, prize_same: false, prizes: ['', '$20 bar tab', 'Meat tray'], prize_none: [1], prize: '$20 bar tab' };
var r0 = U.roundPrize(P, 0), r1 = U.roundPrize(P, 1), r2 = U.roundPrize(P, 2), r3 = U.roundPrize(P, 3);
check('round 1 played for no prize says so', r0.none === true && r0.prize === 'No prize this round' && r0.number === 1 && r0.of === 3, r0);
check('round 2 and 3 have their own prizes', r1.prize === '$20 bar tab' && !r1.none && r2.prize === 'Meat tray', [r1, r2]);
check('past the last round: no prize filled in, the host types one', r3.past === true && r3.prize === '', r3);
var S = U.roundPrize({ rounds: 3, prize_same: true, prizes: ['Bottle of wine'], prize_none: [1] }, 2);
check('one prize for every round: the same each round, never "no prize"', S.prize === 'Bottle of wine' && !S.none && !S.past, S);
check('nothing about rounds saved: nothing to fill', U.roundPrize({ prize: 'x' }, 0) === null && U.roundPrize(null, 0) === null);

section('3. THE NIGHT\'S ROUND COUNTER');
var store = {}, st = { getItem: function (k) { return k in store ? store[k] : null; }, setItem: function (k, v) { store[k] = String(v); } };
var nine = Date.parse('2026-11-07T09:00:00Z');   // 7pm Saturday in Brisbane
var rr = U.round(st, 'V1', 'musical', nine);
check('a new night starts at round 1 (index 0)', rr.index === 0);
rr.next(); rr.next();
check('two prizes won: round 3', U.round(st, 'V1', 'musical', nine).index === 2);
check('1:30am is still Saturday\'s night', U.round(st, 'V1', 'musical', nine + 6.5 * 3600000).index === 2);
check('6am Sunday is a new night', U.round(st, 'V1', 'musical', nine + 11 * 3600000).index === 0);
check('another venue counts its own', U.round(st, 'V2', 'musical', nine).index === 0);

section('4. TAP AND GO');
var box = new El('input'); box.id = 'prizeInput'; body.appendChild(box); var picked = null;
var row = U.prizeButtons(document, box, ['Meat tray', '', ' Meat tray ', '$50 bar tab', '<b>Wine</b>'], function (x) { picked = x; }, 'pb');
check('one button per prize, blanks and repeats left out, straight after the box', row && row.children.length === 3 && body.children[1] === row && row.children.map(function (b) { return b.textContent; }).join('|') === 'Meat tray|$50 bar tab|<b>Wine</b>', row && row.children.map(function (b) { return b.textContent; }));
row.children[1].click();
check('a tap hands that prize over', picked === '$50 bar tab');
check('drawn again, it replaces itself (never two rows)', (U.prizeButtons(document, box, ['A'], null, 'pb'), body.children.filter(function (c) { return c.id === 'pb'; }).length === 1));
check('no prizes saved: no row', U.prizeButtons(document, box, ['', ' '], null, 'pb2') === null);
var SRC = readFile('venueplay/app/vp-setupuse.js');
check('every prize is set as text, never markup', /b\.textContent = p;/.test(SRC) && !/innerHTML/.test(SRC));

section('5. WIRED INTO THE CONSOLES');
var MUS = readFile('venueplay/app/musical/host.html'), BIN = readFile('venueplay/app/index.html'), TRI = readFile('venueplay/app/trivia/host.html'), BLD = readFile('venueplay/app/trivia/builder.html');
function loads(src, path) { return src.indexOf('<script src="' + path + '"></script>') > 0; }
function between(src, a, b) { var i = src.indexOf(a); return i < 0 ? '' : src.slice(i, src.indexOf(b, i + a.length)); }
var amp = between(MUS, 'function applyMusicalPrefs', 'function musicalLocalPrefs');
check('musical bingo loads it, plays this week\'s list when there are several', loads(MUS, '../vp-setupuse.js') && /VPSetupUse\.weekPick\(p\.playlists\)/.test(amp) && /selectPlaylist\(plWant\)/.test(amp));
check('musical bingo fills this round\'s prize once the venue\'s setup is in', /G\.setupPrefs=p;/.test(amp) && /fillRoundPrize\(\);/.test(amp));
var frp = between(MUS, 'function fillRoundPrize', 'function startVenuePrefs');
check('the round\'s prize goes in the box only when the host has not typed one, with "Round N of R tonight" and the buttons', /!String\(pi\.value\|\|""\)\.trim\(\) \|\| pi\.value===pi\._round/.test(frp) && /"Round "\+rp\.number\+" of "\+rp\.of\+" tonight"/.test(frp) && /VPSetupUse\.prizeButtons\(document, note,/.test(frp));
var win = between(MUS, 'G.prizesWon.push(', 'function endGameNow');
check('a win moves the round on, and the next round\'s prize is in the "next round" box', /_rr\.next\(\);/.test(win) && /\$\("carryPrize"\)\.value=_nx\.prize/.test(win) && /VPSetupUse\.round\(localStorage, G\.venueId, "musical"\)\.next\(\);   \/\/ that round's prize is won/.test(win));
check('back to setup after a game: the next round\'s prize', /renderConsole\(\);   \/\/ back to setup for the next game\n    fillRoundPrize\(\);/.test(MUS));
var abp = between(BIN, 'function applyBingoPrefs', 'var _bingoPrefs=');
check('bingo loads it and puts the usual prizes as buttons under the prize box and the new game box', loads(BIN, 'vp-setupuse.js') && /G\.prizeList=p\.prize_list; paintBingoPrizeButtons\(\);/.test(abp) && /VPSetupUse\.prizeButtons\(document, \$\("prizeInput"\), G\.prizeList/.test(abp) && /VPSetupUse\.prizeButtons\(document, \$\("ngPrize"\), G\.prizeList/.test(abp));
var atp = between(TRI, 'function paintTriviaSetup', 'function triviaLocalPrefs') || between(TRI, 'function paintTriviaSetup', '// What a quiz start saved');
check('trivia loads it; their categories first ("Your categories") and a different one each week', loads(TRI, '../vp-setupuse.js') && /grp\.label="Your categories"/.test(atp) && /VPSetupUse\.weekPick\(p\.set_ids\)/.test(atp));
check('trivia theme nights open the builder on that topic, as text', /"\/app\/trivia\/builder\.html\?topic="\+encodeURIComponent\(/.test(atp) && /a\.textContent=String\(t\)/.test(atp));
check('trivia: "Tonight\'s prize" with the usual prizes as buttons', /id="triviaPrize"/.test(TRI) && /VPSetupUse\.prizeButtons\(document, ti, p\.prize_list/.test(atp));
var tp = between(BLD, 'function topicParam', 'function defaultName');
check('the builder takes ?topic= safely (a broken one ignored, no markup, 60 characters) and types it into the topic search', /try\{/.test(tp) && /replace\(\/\[<>\]\/g,""\)/.test(tp) && /slice\(0,60\)/.test(tp) && /\$\("searchQ"\)\.value=topic;/.test(BLD));

print(''); print(bad ? ('FAIL ' + bad + ' of ' + ran) : ('PASS ' + ran + ' checks'));
