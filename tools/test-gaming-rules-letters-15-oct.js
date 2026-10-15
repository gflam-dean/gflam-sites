/* THE RULES FROM THE LETTERS, on the PAID path, and the popup that will not start a paid game.

   Two letters of advice from Anisimoff Legal (ref 9380, 1 Oct and 8 Oct 2026) rewrote the state
   table in vp-gaming.js. This RUNS assess() for a paid game in every state, for both kinds of
   venue and every gaming format, and asserts the specific facts the letters establish: ACT phones
   on, Victoria and Tasmania on paper (musical never: Dean, 15 Oct 2026), the NSW gaming-machines
   line gone, WA's certification text, the Queensland block intact, permitRecorded, the jackpot
   figures, and the hard block: where the state says this venue may not charge, the popup offers
   "Start as a free-entry game" and tells the console { free: true }, never a paid game.

   The popup is driven through a fake document, so the button text and the click are what a
   host would see and press. Run from the repo root:  jsc tools/test-gaming-rules-letters-15-oct.js
*/
var window = this;
function fakeEl() {
  var e = { className: '', attrs: {}, children: [], style: {}, listeners: {}, _html: '', _btns: {},
    setAttribute: function (k, v) { this.attrs[k] = v; },
    appendChild: function (c) { this.children.push(c); },
    remove: function () { this._removed = true; },
    addEventListener: function (t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); },
    querySelector: function (sel) { if (!this._btns[sel]) this._btns[sel] = fakeEl(); return this._btns[sel]; },
    focus: function () {} };
  Object.defineProperty(e, 'innerHTML', { get: function () { return this._html; }, set: function (v) { this._html = String(v); } });
  Object.defineProperty(e, 'textContent', { get: function () { return this._html; }, set: function (v) { this._html = String(v); } });
  return e;
}
var document = { head: fakeEl(), body: fakeEl(),
  getElementById: function () { return null; }, querySelector: function () { return null; },
  createElement: function () { return fakeEl(); }, addEventListener: function () {}, removeEventListener: function () {} };
window.document = document;
var setTimeout = function () { return 0; }, clearTimeout = function () {};
load('venueplay/app/vp-gaming.js');
var G = this.VPGaming;
var fails = 0, ran = 0;
function check(name, ok, saw) { ran++; if (ok) print('  ok   ' + name); else { print('  FAIL ' + name + (saw === undefined ? '' : '   saw: ' + JSON.stringify(saw))); fails++; } }
function text(a) { return [a.headline].concat(a.points, a.warnings, [a.blocked || '']).join(' | '); }
function paid(state, entity, format, permits) { return G.assess({ state: state, entityType: entity, format: format, paidEntry: true, paidEntryEnabled: true, permits: permits }); }

var STATES = ['NSW', 'QLD', 'VIC', 'WA', 'SA', 'ACT', 'TAS', 'NT'], ENT = ['for_profit', 'non_profit'], FMT = ['bingo90', 'musical', 'raffle', 'members'];
print('every state, every kind of venue, every gaming format, PAID entry (' + (STATES.length * ENT.length * FMT.length) + ' popups)');
var machines = [], emdash = [], theAct = [], softNo = [], blockOk = [], noRule = [];
var EMDASH = new RegExp(String.fromCharCode(8212));   // built from the code so this file holds no em dash itself
STATES.forEach(function (s) { ENT.forEach(function (e) { FMT.forEach(function (f) {
  var a = paid(s, e, f), t = text(a), tag = s + '/' + e + '/' + f;
  var rule = G.states[s][e][G.kindOf(f)];
  if (!rule) noRule.push(tag);
  if (/gaming machines/i.test(t)) machines.push(tag);
  if (EMDASH.test(t)) emdash.push(tag);
  if (/\bthe ACT\b/.test(t)) theAct.push(tag);
  if (rule && rule.paid === 'no' && !a.hardBlock) softNo.push(tag);
  if (a.hardBlock && a.ok !== false) blockOk.push(tag);
}); }); });
check('every state has a rule for every kind of venue and game', noRule.length === 0, noRule);
check('the "$1,000 if tied to the gaming machines" line is gone (Anisimoff, 1 Oct 2026: not relevant)', machines.length === 0, machines);
check('no em dash anywhere', emdash.length === 0, emdash.slice(0, 5));
check('never "the ACT"', theAct.length === 0, theAct.slice(0, 5));
check('wherever the rule says a venue may not charge, the popup hard-blocks the paid game', softNo.length === 0, softNo);
check('a hard block always comes with ok:false', blockOk.length === 0, blockOk);
var freeBlocked = [];
STATES.forEach(function (s) { ENT.forEach(function (e) { FMT.forEach(function (f) {
  var a = G.assess({ state: s, entityType: e, format: f, paidEntry: false, paidEntryEnabled: true });
  if (a.hardBlock || a.blocked || a.ok === false) freeBlocked.push(s + '/' + e + '/' + f);
}); }); });
check('CONTROL: the free path is never blocked anywhere, by anything', freeBlocked.length === 0, freeBlocked);

print('phones as tickets, per the tables (8 Oct 2026) and Dean on musical (15 Oct 2026)');
var actB = paid('ACT', 'for_profit', 'bingo90');
check('ACT: bingo is on the phone again ("not specifically prohibited")', actB.paper === false && G.states.ACT.phones.bingo === true && !G.states.ACT.paperBingo, actB.warnings);
var vicB = paid('VIC', 'non_profit', 'bingo90');
check('VIC: bingo is on paper, citing s8.4.7B', vicB.paper === true && /8\.4\.7B/.test(vicB.warnings.join(' ')), vicB.warnings);
check('VIC: the paper text says the calling and the screen still run (a device at the venue is allowed)', /screen/i.test(G.states.VIC.paperBingo) && /device at the venue/i.test(G.states.VIC.paperBingo), G.states.VIC.paperBingo);
var vicM = paid('VIC', 'non_profit', 'musical');
check('VIC: MUSICAL bingo keeps its phone cards (Dean, 15 Oct 2026: "cards stay in every state")', vicM.paper === false && !/paper tickets|on paper/i.test(vicM.warnings.join(' ')), vicM.warnings);
check('VIC: and the paper text does not say musical is included', !/musical.{0,40}includ|includ.{0,40}musical/i.test(G.states.VIC.paperBingo), G.states.VIC.paperBingo);
var tasB = paid('TAS', 'non_profit', 'bingo90');
check('TAS: bingo is on paper, and the exempt social exception ($30 entry, $300 prize) is explained', tasB.paper === true && /\$30\b/.test(tasB.warnings.join(' ')) && /\$300/.test(tasB.warnings.join(' ')) && /exempt/i.test(tasB.warnings.join(' ')), tasB.warnings);
check('SA: unchanged, on paper', paid('SA', 'non_profit', 'bingo90').paper === true);
check('NSW and QLD: on the phone (Regulation s23(a); Schedule 2 "allot electronically")', G.states.NSW.phones.bingo === true && G.states.QLD.phones.bingo === true && paid('NSW', 'non_profit', 'bingo90').paper === false);

print('the states, one fact each from the tables');
var nswR = paid('NSW', 'for_profit', 'raffle');
check('NSW pub raffle for a charity: hard-blocked until the charity\'s authority is recorded', nswR.hardBlock === true && /record/i.test(nswR.headline) && /authorisation|authority/i.test(nswR.warnings.join(' ')), nswR);
var nswR2 = paid('NSW', 'for_profit', 'raffle', { raffle: { holder: 'npo', npo_name: 'RSPCA NSW', authorised_on: '2026-10-01' } });
check('NSW pub raffle with the charity\'s written authorisation on record: may go ahead, for the cause', nswR2.hardBlock === false && nswR2.ok === true && /cause/i.test(nswR2.headline) && /RSPCA NSW/.test(nswR2.points.join(' ')), nswR2);
var nswB = paid('NSW', 'non_profit', 'bingo90');
check('NSW club bingo: $70 a game, no cash prizes; charity housie $10,000 and 48 tickets', /\$70/.test(text(nswB)) && /no cash/i.test(text(nswB)) && /\$10,000/.test(text(nswB)) && /48 tickets/.test(text(nswB)), text(nswB));
check('NSW for-profit bingo: cannot charge, and social housie is named as not for licensed premises', paid('NSW', 'for_profit', 'bingo90').hardBlock === true && /licensed premises/i.test(text(paid('NSW', 'for_profit', 'bingo90'))));
var qldN = paid('QLD', 'non_profit', 'bingo90'), qldF = paid('QLD', 'for_profit', 'bingo90');
check('QLD: the number-generator block stays on the paid path for both kinds of venue', !!qldN.blocked && qldN.ok === false && !!qldF.blocked && /OLGR/.test(qldN.blocked), qldN.blocked);
check('QLD non-profit bingo: not hard-blocked beyond that (existing behaviour kept)', qldN.hardBlock === false);
check('QLD bingo: first jackpot $1,000 (cat 1) or $5,000 (cat 2), paid from earlier and current sessions', /\$1,000/.test(text(qldN)) && /\$5,000/.test(text(qldN)) && /earlier and current sessions/.test(text(qldN)), text(qldN));
check('QLD for-profit: businesses cannot conduct bingo', /Businesses cannot conduct bingo/.test(text(qldF)), text(qldF));
var vicN = paid('VIC', 'non_profit', 'bingo90');
check('VIC non-profit paid bingo: hard-blocked with no permit on record, citing s8.4.4', vicN.hardBlock === true && /8\.4\.4/.test(text(vicN)) && /No permit or authority is recorded/.test(vicN.warnings.join(' ')), vicN);
var vicN2 = paid('VIC', 'non_profit', 'bingo90', { bingo: { number: 'MGP-12345', holder: 'venue', authorised_on: '2026-07-01', expires: '2027-07-01' } });
check('VIC non-profit paid bingo with a permit number: may go ahead, permit shown', vicN2.hardBlock === false && vicN2.ok === true && /MGP-12345/.test(vicN2.points.join(' ')), vicN2);
var vicN3 = paid('VIC', 'non_profit', 'bingo90', { bingo: { number: 'MGP-12345', holder: 'venue', expires: '2025-01-01' } });
check('an expired permit still counts as recorded (the shared rule) but is warned about', vicN3.hardBlock === false && /expired on 2025-01-01/.test(vicN3.warnings.join(' ')), vicN3.warnings);
check('VIC: 20% of fees, 50 to 90% over 7 days, $20,000 notification, $1,000 by cheque or EFT, no minors', /20%/.test(text(vicN)) && /50% and 90%/.test(text(vicN)) && /\$20,000/.test(text(vicN)) && /cheque or EFT/.test(text(vicN)) && /minors/i.test(text(vicN)), text(vicN));
var vicR = paid('VIC', 'for_profit', 'raffle');
check('VIC for-profit raffle: NPO permission, 2x to 6x, no cash, no reverse draws, $23,060', /written permission/.test(text(vicR)) && /two and six times/.test(text(vicR)) && /No cash prizes/.test(text(vicR)) && /reverse draws/.test(text(vicR)) && /\$23,060/.test(text(vicR)), text(vicR));
var actR = paid('ACT', 'for_profit', 'raffle');
check('ACT raffle: anyone, $2,500 exempt, 5x and 10x, serial raffles 12 months, warned not blocked without a permit', actR.hardBlock === false && /\$2,500/.test(text(actR)) && /five times/.test(text(actR)) && /12 months/.test(text(actR)) && /No permit is recorded/.test(actR.warnings.join(' ')), text(actR));
check('ACT housie: $1,000 a session, no minors or intoxicated people above it, winning ticket recorded', /\$1,000/.test(text(actB)) && /intoxicated/.test(text(actB)) && /winning ticket/i.test(text(actB)), text(actB));
var tasR = paid('TAS', 'for_profit', 'raffle');
check('TAS raffle: for a non-profit, $10,000 permit line, cash $5,000, no minors, no reverse draws', /non-profit/.test(text(tasR)) && /\$10,000/.test(text(tasR)) && /\$5,000/.test(text(tasR)) && /minors/i.test(text(tasR)) && /reverse draws/i.test(text(tasR)), text(tasR));
check('TAS bingo: two jackpot games, $300 first, $50 a session, paid out at $2,000, promo $1,000 and $2,000', /two jackpot games/i.test(text(tasB)) && /\$300/.test(text(tasB)) && /\$50 a session/.test(text(tasB)) && /\$2,000/.test(text(tasB)) && /\$1,000 a game/.test(text(tasB)), text(tasB));
var wa = paid('WA', 'for_profit', 'raffle');
check('WA: independent certification from a university or accounting firm, lodged with rgl@lgirs.wa.gov.au', /university/i.test(text(wa)) && /accounting firm/i.test(text(wa)) && /rgl@lgirs\.wa\.gov\.au/.test(text(wa)) && !/Queensland one/.test(text(wa)), text(wa));
check('NT: the paid block is unchanged', !!paid('NT', 'non_profit', 'raffle').blocked);
check('the ads line reaches NSW, VIC and ACT and not QLD or TAS', /Anisimoff, 1 Oct 2026, point 15/.test(text(nswB)) && /point 10/.test(text(vicN)) && /under 25/.test(text(actB)) && !/\bad\b/i.test(text(qldN)) && !/\bad\b/i.test(text(tasB)));

print('permitRecorded: the one shared rule');
check('a permit number counts', G.permitRecorded({ permits: { bingo: { number: 'B1' } } }, 'bingo') === true);
check('an NPO with a name and a date of written authorisation counts', G.permitRecorded({ permits: { raffle: { holder: 'npo', npo_name: 'Surf Club', authorised_on: '2026-09-30' } } }, 'raffle') === true);
check('an NPO with no date does not', G.permitRecorded({ permits: { raffle: { holder: 'npo', npo_name: 'Surf Club' } } }, 'raffle') === false);
check('a venue holder with no number does not', G.permitRecorded({ permits: { raffle: { holder: 'venue', npo_name: 'x', authorised_on: '2026-09-30' } } }, 'raffle') === false);
check('the wrong kind does not', G.permitRecorded({ permits: { bingo: { number: 'B1' } } }, 'raffle') === false);
check('a JSON string column is read', G.permitRecorded({ permits: '{"members":{"number":"M-9"}}' }, 'members') === true);
check('nothing, garbage and a blank number are all "not recorded", without throwing', G.permitRecorded(null, 'bingo') === false && G.permitRecorded({ permits: 'not json' }, 'bingo') === false && G.permitRecorded({ permits: { bingo: { number: '   ' } } }, 'bingo') === false && G.permitRecorded({ permits: { bingo: 'x' } }, 'bingo') === false);

print('jackpotLimit: the figures from the tables');
function lim(s, e, f, p) { return G.jackpotLimit({ state: s, entityType: e, format: f, paidEntry: p }); }
check('NSW members draw: $7,000 cash (a rolling jackpot is a progressive lottery)', lim('NSW', 'for_profit', 'members', false).cents === 700000 && /progressive lottery/.test(lim('NSW', 'for_profit', 'members', false).why), lim('NSW', 'for_profit', 'members', false));
check('NSW raffle: $30,000', lim('NSW', 'non_profit', 'raffle', true).cents === 3000000);
check('NSW charity housie: $10,000', lim('NSW', 'non_profit', 'bingo90', true).cents === 1000000);
check('QLD free draw: no figure, and the reason says Category 4', lim('QLD', 'for_profit', 'members', false).cents === null && /Category 4/.test(lim('QLD', 'for_profit', 'members', false).why));
check('QLD paid bingo: the $1,000 first jackpot', lim('QLD', 'non_profit', 'bingo90', true).cents === 100000);
check('VIC paid raffle: $23,060', lim('VIC', 'non_profit', 'raffle', true).cents === 2306000);
check('VIC paid bingo: $20,000 notification', lim('VIC', 'non_profit', 'bingo90', true).cents === 2000000);
check('ACT: $3,000 members, $2,500 raffle, $1,000 housie', lim('ACT', 'for_profit', 'members', false).cents === 300000 && lim('ACT', 'for_profit', 'raffle', true).cents === 250000 && lim('ACT', 'for_profit', 'bingo90', true).cents === 100000);
check('TAS: $5,000 cash for draws, $2,000 jackpot bingo', lim('TAS', 'non_profit', 'raffle', true).cents === 500000 && lim('TAS', 'non_profit', 'members', false).cents === 500000 && lim('TAS', 'non_profit', 'bingo90', true).cents === 200000);
check('NT: $2,000 members, $5,000 raffle; SA: $5,000', lim('NT', 'for_profit', 'members', false).cents === 200000 && lim('NT', 'non_profit', 'raffle', true).cents === 500000 && lim('SA', 'for_profit', 'members', false).cents === 500000);
check('WA: null, and says no figure yet', lim('WA', 'non_profit', 'raffle', true).cents === null && /no prize figure/i.test(lim('WA', 'non_profit', 'raffle', true).why));
check('an unknown state and trivia: null, with a reason, never a throw', lim('XX', 'non_profit', 'raffle', true).cents === null && lim('', 'non_profit', 'raffle', true).cents === null && lim('NSW', 'non_profit', 'trivia', true).cents === null && !!lim('XX', 'non_profit', 'raffle', true).why);
var allWhy = [];
STATES.forEach(function (s) { ENT.forEach(function (e) { FMT.forEach(function (f) { [true, false].forEach(function (p) { var r = lim(s, e, f, p); if (!r || typeof r.why !== 'string' || !r.why || (r.cents !== null && !(r.cents > 0))) allWhy.push(s + '/' + e + '/' + f + '/' + p); }); }); }); });
check('every combination answers { cents: number|null, why: text }', allWhy.length === 0, allWhy);

print('the declaration and the popup');
check('the declaration now covers every law that applies: permits, attendance and age', /every law that applies/.test(G.declaration('The Royal')) && /permits, attendance and age rules/.test(G.declaration('The Royal')));
var posted = [];
var VENUE = { id: 'v-nsw', name: 'The Royal', au_state: 'NSW', entity_type: 'for_profit', paid_entry_enabled: true, permits: null };
this.VP = { getContext: function () { return { venue: VENUE }; }, gameApiPost: function (path, body) { posted.push({ path: path, body: body }); return Promise.resolve({ ok: true }); } };
function lastWrap() { return document.body.children[document.body.children.length - 1]; }
function press(wrap) { return wrap.querySelector('.vpg-go').listeners.click[0](); }

var got = []; posted = [];
G.gateFor('bingo90', function (r) { got.push(r); }, { gameIsPaid: true });
var w = lastWrap();
check('a NSW pub selling bingo tickets: the popup does NOT offer to start the game', w && /Start as a free-entry game/.test(w.innerHTML) && !/I understand, start the game/.test(w.innerHTML), w && w.innerHTML.slice(0, 200));
check('it carries the declaration with the every-law line', /every law that applies/.test(w.innerHTML));
press(w);
check('pressing it tells the console { free: true }', got.length === 1 && got[0] && got[0].free === true, got);
check('and the record is of a FREE game the host saw, so a draw is not refused', posted.length === 1 && posted[0].body.paid_entry === false && /^Free entry/.test(posted[0].body.category_claimed) && posted[0].body.category_claimed.indexOf(G.NOT_SHOWN) !== 0, posted[0] && posted[0].body);

VENUE = { id: 'v-vic', name: 'The Lodge', au_state: 'VIC', entity_type: 'non_profit', paid_entry_enabled: true, permits: null };
got = []; posted = [];
G.gateFor('bingo90', function (r) { got.push(r); }, { gameIsPaid: true });
w = lastWrap();
check('a Victorian non-profit with no permit on record: free-entry only', /Start as a free-entry game/.test(w.innerHTML) && /record your permit/i.test(w.innerHTML), w.innerHTML.slice(0, 300));
VENUE = { id: 'v-vic2', name: 'The Lodge', au_state: 'VIC', entity_type: 'non_profit', paid_entry_enabled: true, permits: { bingo: { number: 'MGP-777', holder: 'venue' } } };
got = []; posted = [];
G.gateFor('bingo90', function (r) { got.push(r); }, { gameIsPaid: true });
w = lastWrap();
check('the same venue with its permit recorded: "I understand, start the game", permit named', /I understand, start the game/.test(w.innerHTML) && /MGP-777/.test(w.innerHTML), w.innerHTML.slice(0, 300));
press(w);
check('and the console is not told to go free', got.length === 1 && got[0] === undefined && posted[0].body.paid_entry === true, got);

VENUE = { id: 'v-mem', name: 'The Club', au_state: 'NSW', entity_type: 'for_profit', paid_entry_enabled: true, permits: null };
got = []; posted = [];
G.gateFor('members', function (r) { got.push(r); }, { waitRecord: true, freeEntry: true });
w = lastWrap();
check('a members draw at a paid-enabled venue is gated as FREE entry: shown, never blocked', /I understand, start the game/.test(w.innerHTML) && /Free entry\. Nobody pays/.test(w.innerHTML) && !/Start as a free-entry game/.test(w.innerHTML), w.innerHTML.slice(0, 300));
press(w);
check('its record is a seen declaration of a free game (the Worker refuses the silent kind)', posted.length === 1 && posted[0].body.paid_entry === false && posted[0].body.category_claimed.indexOf(G.NOT_SHOWN) !== 0, posted[0] && posted[0].body);

VENUE = { id: 'v-qld', name: 'Test Alpha', au_state: 'QLD', entity_type: 'non_profit', paid_entry_enabled: true, permits: null };
got = []; posted = [];
G.gateFor('raffle', function (r) { got.push(r); }, { gameIsPaid: true });
w = lastWrap();
check('Queensland non-profit paid raffle: the OLGR block is shown and the button is the old one (existing behaviour)', /OLGR approval/.test(w.innerHTML) && /I understand, start the game/.test(w.innerHTML), w.innerHTML.slice(0, 300));

if (fails) throw new Error('gaming rules (letters): ' + fails + ' of ' + ran + ' failed');
print('PASS ' + ran + ' checks');
