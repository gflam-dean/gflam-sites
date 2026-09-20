/* What the rules popup tells a venue about a FREE game, in every state, for every kind of venue.

   Runs assess() out of the shipped vp-gaming.js. Free entry is the path every venue is on (paid
   entry ships switched off), so this is the popup they actually see and the headline that is
   recorded against the host's "I understand".

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
var absolute = [], noLimit = [], silent = [];
STATES.forEach(function (s) { ENT.forEach(function (e) { FMT.forEach(function (f) {
  var a = free(s, e, f), t = text(a);
  if (/anywhere/i.test(t)) absolute.push(s + '/' + e + '/' + f);
  if (/no (prize )?limit/i.test(t) && s !== 'QLD') noLimit.push(s + '/' + e + '/' + f);   // Queensland Category 4 really has none
  if (a.points.length < 2) silent.push(s + '/' + e + '/' + f);
}); }); });
print('every state, every kind of venue, every gaming format, free entry (' + (STATES.length * ENT.length * FMT.length) + ' popups)');
check('none of them says a free game needs no licence "anywhere"', absolute.length === 0, absolute.slice(0, 5));
check('none outside Queensland promises there is no limit on the prize', noLimit.length === 0, noLimit.slice(0, 5));
check('every one says something about its OWN state, not just the universal line', silent.length === 0, silent.slice(0, 5));

print('the thresholds this file already knew, now on the path venues are on');
var nsw = text(free('NSW', 'non_profit', 'members'));
check('NSW members draw: the $10,000 authority', /\$10,000/.test(nsw) && /authority/i.test(nsw), nsw);
check('NSW members draw: the $1,000 cap when tied to the gaming machines', /\$1,000/.test(nsw) && /gaming machines/i.test(nsw), nsw);
check('SA raffle: $5,000', /\$5,000/.test(text(free('SA', 'for_profit', 'raffle'))));
check('ACT members draw: $3,000', /\$3,000/.test(text(free('ACT', 'for_profit', 'members'))));
check('NT members draw: the $2,000 cap', /\$2,000/.test(text(free('NT', 'for_profit', 'members'))));
check('NT raffle is NOT shown the members-only cap', !/\$2,000/.test(text(free('NT', 'for_profit', 'raffle'))));
var tas = text(free('TAS', 'for_profit', 'members'));
check('Tasmania, where we hold no threshold: says so and names the regulator', /not confirmed/i.test(tas) && /Liquor and Gaming Tasmania/.test(tas), tas);
check('never "the ACT"', !/the ACT\b/.test(text(free('ACT', 'for_profit', 'members'))));
check('a free game in Queensland is still not shown the paid-gaming block', !free('QLD', 'for_profit', 'bingo').blocked);
var off = text(G.assess({ state: 'NSW', entityType: 'for_profit', format: 'raffle', paidEntry: true, paidEntryEnabled: false }));
check('the paid-entry-is-off message makes no "anywhere" promise either', !/anywhere/i.test(off), off);

if (fails) throw new Error('free entry rules: ' + fails + ' of ' + ran + ' failed');
print('PASS ' + ran + ' checks');
