/* Venue settings asks a venue only the permit questions its state and kind of venue need: RUN, not read.

   Dean, 20 Oct 2026, after seeing The Jolly Jess (an NSW non-profit) full of permit questions:
   "if we dont need them to do it we dont need it to clog our system". The page now asks what
   VPGaming.permitsToAsk(venue) returns, which reads the SAME state table as the console's gate.
   Musical bingo is not bingo (Dean, 19 Oct 2026, every state, Queensland included).

   Runs the REAL /app/vp-gaming.js:
     permitsToAsk   an NSW club is asked nothing; an NSW pub only the charity's raffle authority;
                    VIC paid bingo for a non-profit is required; Queensland and the Northern
                    Territory nothing while paid games are blocked, and Queensland's own rules come
                    back by themselves (non-profits only) if the block is lifted; no state asks for
                    a members draw permit; every permit the gate REQUIRES anywhere is asked for, so
                    nothing the lawyer made required can drop off the page; a permit already on
                    record is still shown
     assess         the Queensland block never stops musical bingo, still stops paid bingo, and
                    its words no longer name musical bingo

   Run from the repo root:  jsc tools/test-settings-asks-only-what-applies.js
*/
var fails = 0, ran = 0;
function check(name, ok, saw) { ran++; if (ok) print('  ok   ' + name); else { print('  FAIL ' + name + (saw === undefined ? '' : '   saw: ' + JSON.stringify(saw).slice(0, 400))); fails++; } }
var window = {};
(new Function('window', readFile('venueplay/app/vp-gaming.js')))(window);
var G = window.VPGaming, S = G.states;
function ask(state, entity, permits) { return G.permitsToAsk({ au_state: state, entity_type: entity, permits: permits }); }
function kinds(list) { return list.map(function (x) { return x.kind + ':' + x.need + ':' + x.holder; }).join(' '); }

print('by state and by kind of venue');
check('an NSW non-profit (The Jolly Jess) is asked for no permit at all', kinds(ask('NSW', 'non_profit')) === '', ask('NSW', 'non_profit'));
check('an NSW pub is asked for nothing: a pub cannot charge in the product, so nothing reads its permits',
      kinds(ask('NSW', 'for_profit')) === '', ask('NSW', 'for_profit'));
check('a VIC non-profit: bingo permit required (the lawyer\'s warranty), raffle only above the limit',
      kinds(ask('VIC', 'non_profit')) === 'bingo:required:venue raffle:optional:venue', ask('VIC', 'non_profit'));
check('a VIC pub, an ACT pub and a TAS pub are asked for nothing (no bingo card for a VIC pub either)',
      kinds(ask('VIC', 'for_profit')) === '' && kinds(ask('ACT', 'for_profit')) === '' && kinds(ask('TAS', 'for_profit')) === '',
      [ask('VIC', 'for_profit'), ask('ACT', 'for_profit'), ask('TAS', 'for_profit')]);
check('a venue whose type HQ has not recorded is asked nothing (it cannot charge until it has)', kinds(ask('VIC', null)) === '', ask('VIC', null));
check('an ACT club: bingo and raffle, only above the exemption', kinds(ask('ACT', 'non_profit')) === 'bingo:optional:venue raffle:optional:venue', ask('ACT', 'non_profit'));
check('a TAS club: bingo and raffle, only above the exemption', kinds(ask('TAS', 'non_profit')) === 'bingo:optional:venue raffle:optional:venue', ask('TAS', 'non_profit'));
check('SA and WA clubs are asked nothing (no rule reads a permit there)', kinds(ask('SA', 'non_profit')) === '' && kinds(ask('WA', 'non_profit')) === '');
var asked = {};
Object.keys(S).forEach(function (st) { ['for_profit', 'non_profit', null].forEach(function (e) { ask(st, e).forEach(function (x) { asked[st + '/' + (e || '?')] = 1; }); }); });
check('after the audit only VIC, ACT and TAS clubs see a permit card at all', JSON.stringify(Object.keys(asked).sort()) === '["ACT/non_profit","TAS/non_profit","VIC/non_profit"]', Object.keys(asked));
check('a venue with no state is asked nothing', kinds(ask('', null)) === '');

print('Queensland and the Northern Territory, while paid games are blocked');
['for_profit', 'non_profit', null].forEach(function (e) {
  check('QLD ' + (e || 'type unknown') + ': nothing', kinds(ask('QLD', e)) === '', ask('QLD', e));
});
check('NT: nothing', kinds(ask('NT', null)) === '');
var was = S.QLD.blocked, wasRule = S.QLD.non_profit.bingo.permit;
S.QLD.non_profit.bingo.permit = 'required';
check('a permit rule added to Queensland stays off the page while the OLGR block is on', kinds(ask('QLD', 'non_profit')) === '');
delete S.QLD.blocked;
check('...and comes back by itself the day the block is lifted, for a non-profit', kinds(ask('QLD', 'non_profit')) === 'bingo:required:venue', ask('QLD', 'non_profit'));
check('...never for a for-profit, which cannot charge for bingo in Queensland', kinds(ask('QLD', 'for_profit')) === '', ask('QLD', 'for_profit'));
S.QLD.blocked = was; if (wasRule === undefined) delete S.QLD.non_profit.bingo.permit; else S.QLD.non_profit.bingo.permit = wasRule;

print('members draws, and nothing required ever dropped');
var memberAsked = [], missing = [];
Object.keys(S).forEach(function (st) {
  ['for_profit', 'non_profit', null].forEach(function (e) {
    ask(st, e).forEach(function (x) { if (x.kind === 'members') memberAsked.push(st + '/' + e); });
  });
  if (S[st].blocked) return;
  ['non_profit'].forEach(function (e) {   // a club is the only venue the Worker lets charge
    ['bingo', 'raffle', 'members'].forEach(function (k) {
      var r = (S[st][e] || {})[k];
      if (r && r.permit === 'required' && r.paid !== 'no') {
        if (!ask(st, e).some(function (x) { return x.kind === k && x.need === 'required'; })) missing.push(st + '/' + e + '/' + k);
      }
    });
  });
});
check('no state asks any venue for a members draw permit (they are free entry everywhere)', memberAsked.length === 0, memberAsked);
check('every permit the console\'s gate requires of a club, in every state, is asked for on the page (VIC bingo included)', missing.length === 0 && kinds(ask('VIC', 'non_profit')).indexOf('bingo:required') === 0, missing);
var mixed = ask('VIC', 'non_profit', { raffle: { holder: 'npo', npo_name: 'Lions', authorised_on: '2026-10-01' } });
check('a club with a raffle record held by a charity is asked who holds it', kinds(mixed).indexOf('raffle:optional:either') !== -1, mixed);
var rec = ask('NSW', 'non_profit', { members: { number: 'TP-123', holder: 'venue' } });
check('a permit already on record is still shown so it can be changed or cleared', kinds(rec) === 'members:recorded:venue', rec);

print('musical bingo is its own kind, with no state bingo rules (C1)');
check('kindOf: musical is "musical", never "bingo"', G.kindOf('musical') === 'musical' && G.kindOf('bingo90') === 'bingo', [G.kindOf('musical'), G.kindOf('bingo90')]);
var mv = G.assess({ state: 'VIC', entityType: 'non_profit', format: 'musical', paidEntry: true, paidEntryEnabled: true, permits: {} });
check('a paid VIC musical night: no permit gate, no paper rule, no hard block, only who conducts it',
      !mv.hardBlock && !mv.paper && mv.ok && mv.permit === null && mv.warnings.length === 0 && /conducts/.test(mv.points.join(' ')), mv);
var mp = G.assess({ state: 'NSW', entityType: 'for_profit', format: 'musical', paidEntry: true, paidEntryEnabled: true });
check('a paid NSW pub musical night is not given the bingo "cannot charge" block', !mp.hardBlock && mp.ok, mp);
check('the jackpot figure for musical bingo is no bingo figure', G.jackpotLimit({ state: 'QLD', format: 'musical', paidEntry: true }).cents === null);

print('why paid entry is off, by case (C7)');
function off(st, e) { return G.assess({ state: st, entityType: e, format: 'raffle', paidEntry: true, paidEntryEnabled: false }).warnings.join(' '); }
check('a pub is told paid entry is for clubs, not invited to email', /for clubs/.test(off('NSW', 'for_profit')) && !/hello@/.test(off('NSW', 'for_profit')), off('NSW', 'for_profit'));
check('a Queensland club is told it is not available in Queensland yet', /not available in Queensland yet/.test(off('QLD', 'non_profit')), off('QLD', 'non_profit'));
check('a venue with no type recorded is told that, without an email invitation', /have not recorded whether/.test(off('VIC', null)) && !/hello@/.test(off('VIC', null)), off('VIC', null));

print('the WA raffle warning is on raffles only (C10)');
function waw(f) { return G.assess({ state: 'WA', entityType: 'non_profit', format: f, paidEntry: false }).warnings.join(' '); }
check('a WA raffle carries the number generator certification warning', /certification/.test(waw('raffle')), waw('raffle'));
check('WA bingo and members draws do not', !/certification/.test(waw('bingo90')) && !/certification/.test(waw('members')), [waw('bingo90'), waw('members')]);

print('the Queensland block and musical bingo');
var a = G.assess({ state: 'QLD', entityType: 'non_profit', format: 'musical', paidEntry: true, paidEntryEnabled: true });
check('a paid musical bingo night in Queensland is not stopped by the OLGR block', !a.blocked, a.blocked);
a = G.assess({ state: 'QLD', entityType: 'non_profit', format: 'bingo90', paidEntry: true, paidEntryEnabled: true });
check('a paid bingo night in Queensland still is', !!a.blocked && a.ok === false, a);
check('the block\'s words no longer list musical bingo among what we cannot run', !/musical/i.test(S.QLD.blocked.replace('Trivia and musical bingo are unaffected.', '')) && /musical bingo are unaffected/.test(S.QLD.blocked), S.QLD.blocked);

print('');
if (fails) throw new Error(fails + ' of ' + ran + ' failed');
print('ALL ' + ran + ' CHECKS PASSED');
