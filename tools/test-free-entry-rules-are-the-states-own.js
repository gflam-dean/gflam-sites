/* What the rules popup tells a venue about a FREE game, in every state, for every kind of venue.

   Runs assess() out of the shipped vp-gaming.js. Free entry is the path every venue is on (paid
   entry ships switched off), so this is the popup they actually see and the headline that is
   recorded against the host's "I understand".

   Rewritten 15 Oct 2026 to the two Anisimoff Legal letters (1 Oct and 8 Oct 2026): the NSW
   "$1,000 if tied to the gaming machines" line is gone (the lawyer says it is not relevant),
   Tasmania now has free-entry text from the table, and ACT phones are back on.

   Run from the repo root:  jsc tools/test-free-entry-rules-are-the-states-own.js
*/
var window = this; window.document = undefined;
load('venueplay/app/vp-gaming.js');
var G = this.VPGaming;
var fails = 0, ran = 0;
function check(name, ok, saw) { ran++; if (ok) print('  ok   ' + name); else { print('  FAIL ' + name + (saw === undefined ? '' : '   saw: ' + JSON.stringify(saw))); fails++; } }
function text(a) { return [a.headline].concat(a.points, a.warnings).join(' | '); }
function free(state, entity, format) { return G.assess({ state: state, entityType: entity, format: format, paidEntry: false }); }

var STATES = ['NSW', 'QLD', 'VIC', 'WA', 'SA', 'ACT', 'TAS', 'NT'], ENT = ['for_profit', 'non_profit'], FMT = ['bingo', 'musical', 'raffle', 'members'];
var absolute = [], noLimit = [], silent = [], blocked = [], machines = [], emdash = [], theAct = [];
var EMDASH = new RegExp(String.fromCharCode(8212));   // built from the code so this file holds no em dash itself
STATES.forEach(function (s) { ENT.forEach(function (e) { FMT.forEach(function (f) {
  var a = free(s, e, f), t = text(a);
  if (/anywhere/i.test(t)) absolute.push(s + '/' + e + '/' + f);
  if (/no (prize )?limit/i.test(t) && s !== 'QLD') noLimit.push(s + '/' + e + '/' + f);   // Queensland Category 4 really has none
  if (a.points.length < 2 && f !== 'musical') silent.push(s + '/' + e + '/' + f);   // musical bingo has no state rules at all (Dean, 19 Oct 2026)
  if (a.hardBlock || a.blocked || a.ok === false) blocked.push(s + '/' + e + '/' + f);
  if (/gaming machines/i.test(t)) machines.push(s + '/' + e + '/' + f);
  if (EMDASH.test(t)) emdash.push(s + '/' + e + '/' + f);
  if (/\bthe ACT\b/.test(t)) theAct.push(s + '/' + e + '/' + f);
}); }); });
print('every state, every kind of venue, every gaming format, free entry (' + (STATES.length * ENT.length * FMT.length) + ' popups)');
check('none of them says a free game needs no licence "anywhere"', absolute.length === 0, absolute.slice(0, 5));
check('none outside Queensland promises there is no limit on the prize', noLimit.length === 0, noLimit.slice(0, 5));
check('every one says something about its OWN state, not just the universal line', silent.length === 0, silent.slice(0, 5));
check('the free path is never blocked, hard or soft, in any state (free entry is lawful everywhere)', blocked.length === 0, blocked.slice(0, 5));
check('the "$1,000 if tied to the gaming machines" line is gone everywhere (Anisimoff, 1 Oct 2026: not relevant)', machines.length === 0, machines.slice(0, 5));
check('no em dash in any popup', emdash.length === 0, emdash.slice(0, 5));
check('never "the ACT"', theAct.length === 0, theAct.slice(0, 5));

print('the thresholds from the letters, on the path venues are on');
var nsw = text(free('NSW', 'non_profit', 'members'));
check('NSW members draw: the $10,000 trade promotion authority', /\$10,000/.test(nsw) && /authority/i.test(nsw), nsw);
check('NSW members draw: a rolling jackpot is a progressive lottery with cash capped at $7,000', /progressive lottery/i.test(nsw) && /\$7,000/.test(nsw), nsw);
check('NSW free lottery: $30,000 and no cash prizes', /\$30,000/.test(nsw) && /no cash prizes/i.test(nsw), nsw);
check('SA raffle: $5,000', /\$5,000/.test(text(free('SA', 'for_profit', 'raffle'))));
check('ACT members draw: $3,000', /\$3,000/.test(text(free('ACT', 'for_profit', 'members'))));
check('ACT free housie: exempt to $1,000 a session, winning ticket recorded', /\$1,000/.test(text(free('ACT', 'for_profit', 'bingo'))) && /winning ticket/i.test(text(free('ACT', 'for_profit', 'bingo'))));
check('NT members draw: a pub\'s $5,000 trade lottery, no staff or families, winners in a newspaper (22 Oct 2026)', /\$5,000/.test(text(free('NT', 'for_profit', 'members'))) && /staff and their families/i.test(text(free('NT', 'for_profit', 'members'))) && /newspaper/i.test(text(free('NT', 'for_profit', 'members'))));
check('NT raffle is NOT shown the members-only cap', !/\$2,000/.test(text(free('NT', 'for_profit', 'raffle'))));
var tas = text(free('TAS', 'for_profit', 'members'));
check('Tasmania members draw: no minors, cash capped at $5,000, permit above $10,000 (table p.9)', /no minors/i.test(tas) && /\$5,000/.test(tas) && /\$10,000/.test(tas), tas);
var tasb = text(free('TAS', 'for_profit', 'bingo'));
check('Tasmania free bingo: the exempt social game ($30 entry, $300 prize)', /\$30\b/.test(tasb) && /\$300/.test(tasb), tasb);
var vicb = text(free('VIC', 'for_profit', 'bingo'));
/* Dean's ruling, 28 Oct 2026 (over the letter's table p.8): free number bingo may be run AND advertised;
   only paid bingo is restricted. So a free Victorian night is told s8.2.4A, no permit, printed tickets,
   no minors, and nothing about advertising or the general public. A pub and a club are told the same. */
['for_profit', 'non_profit'].forEach(function (e) {
  var t = text(free('VIC', e, 'bingo'));
  check('Victoria free bingo (' + e + '): s8.2.4A, no permit, printed tickets, no minors', /8\.2\.4A/.test(t) && /no permit/i.test(t) && /printed ticket/i.test(t) && /minors/i.test(t), t);
  check('Victoria free bingo (' + e + '): never told it cannot be advertised or opened to the public, or is entertainment only',
    !/cannot be advertised|not advertised|general public|entertainment only/i.test(t), t);
});
var vicPaidPub = text(G.assess({ state: 'VIC', entityType: 'for_profit', format: 'bingo', paidEntry: true, paidEntryEnabled: true }));
check('a Victorian pub asking to charge for bingo is offered free entry with the same true words, nothing about advertising',
  /no permit, entry free, all on printed tickets/.test(vicPaidPub) && !/advertised|general public|entertainment only/i.test(vicPaidPub), vicPaidPub);
check('a free game in Queensland is still not shown the paid-gaming block', !free('QLD', 'for_profit', 'bingo').blocked);
var off = text(G.assess({ state: 'NSW', entityType: 'for_profit', format: 'raffle', paidEntry: true, paidEntryEnabled: false }));
check('the paid-entry-is-off message makes no "anywhere" promise either', !/anywhere/i.test(off), off);

print('what an ad must not do, where a letter says (NSW, VIC, ACT) and nowhere it does not');
check('NSW: children, winning is certain, finances', /children/i.test(nsw) && /certain/i.test(nsw) && /finances/i.test(nsw), nsw);
check('VIC: adds drinking while gambling', /drinking/i.test(vicb), vicb);
var actb = text(free('ACT', 'for_profit', 'bingo'));
check('ACT: nobody under 25 shown gambling, no under-18 encouragement', /under 25/.test(actb) && /under-18/.test(actb), actb);
check('QLD and TAS: no advertising line (the letter gives none)', !/\bad\b|advertis/i.test(text(free('QLD', 'for_profit', 'raffle'))) && !/\bad\b/i.test(tas));

print('the record of a free game says nobody was shown anything');
var posted = [];
this.VP = { getContext: function () { return { venue: { id: 'v1', name: 'The Club', au_state: 'NSW', entity_type: 'non_profit', paid_entry_enabled: false } }; },
            gameApiPost: function (path, body) { posted.push({ path: path, body: body }); } };
var started = 0;
G.gateFor('bingo90', function () { started++; }, { gameIsPaid: false });
check('a free bingo game starts without a popup', started === 1, started);
check('a declaration IS still recorded for it', posted.length === 1 && posted[0].path === '/host/gaming/declare', posted);
var said = (posted[0] && posted[0].body.category_claimed) || '';
check('and the record says, up front, that it was NOT shown to the host', /^RECORDED AUTOMATICALLY, NOT SHOWN TO THE HOST/.test(said), said);
check('it still says what kind of game it was', /Free entry/.test(said) && posted[0].body.paid_entry === false, said);
check('and fits the 300 characters the Worker keeps', said.length <= 300, said.length);

print('musical bingo is not housie (Dean, 21 Sep 2026, and again 15 Oct 2026: "cards stay in every state")');
['SA', 'VIC', 'TAS'].forEach(function (st) {
  var mus = G.assess({ state: st, entityType: 'for_profit', format: 'musical', paidEntry: false });
  var bin = G.assess({ state: st, entityType: 'for_profit', format: 'bingo90', paidEntry: false });
  check(st + ': musical bingo is NOT told to play on paper', !mus.paper && !/phones cannot|paper tickets|on paper/i.test(mus.warnings.join(' ')), mus.warnings);
  check(st + ': ordinary bingo still is', bin.paper === true, bin.warnings);
});
var actBin = G.assess({ state: 'ACT', entityType: 'for_profit', format: 'bingo90', paidEntry: false });
check('ACT: ordinary bingo is back on the phone (Anisimoff, 8 Oct 2026: "not specifically prohibited")', actBin.paper === false && !/paper/i.test(actBin.warnings.join(' ')), actBin.warnings);

if (fails) throw new Error('free entry rules: ' + fails + ' of ' + ran + ' failed');
print('PASS ' + ran + ' checks');
