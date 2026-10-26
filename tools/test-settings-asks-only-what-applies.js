/* Venue settings asks a venue only what applies to it: RUN, not read.

   Dean, 20 Oct 2026, after seeing The Jolly Jess (an NSW non-profit) full of permit questions:
   "if we dont need them to do it we dont need it to clog our system". Since 24 Oct 2026 the
   permit cards come from ONE table, VPPermits.NEEDS in /app/vp-permits.js (Game settings asks
   for the bingo permit, Your account > Draws for raffles and members draws); its own rows are
   run in tools/test-permits-and-compliance-tick.js. This suite runs what the settings page does
   with it (its section is gone when the venue's state needs no bingo permit), and the rest of
   the 20 Oct state audit in the REAL /app/vp-gaming.js:
     C1   musical bingo is its own kind with no state bingo rules (Dean, 19 Oct 2026, every
          state, Queensland included)
     C7   why paid entry is off, in words true for this venue
     C10  the WA number generator warning on raffles only
     the Queensland block never stops musical bingo, still stops paid bingo, and its words no
     longer name musical bingo

   Run from the repo root:  jsc tools/test-settings-asks-only-what-applies.js
*/
var fails = 0, ran = 0;
function check(name, ok, saw) { ran++; if (ok) print('  ok   ' + name); else { print('  FAIL ' + name + (saw === undefined ? '' : '   saw: ' + JSON.stringify(saw).slice(0, 400))); fails++; } }
var window = {};
(new Function('window', readFile('venueplay/app/vp-gaming.js')))(window);
var VPGaming = window.VPGaming;   // vp-permits.js names it as a page global
(new Function('window', readFile('venueplay/app/vp-permits.js')))(window);
var G = window.VPGaming, S = G.states, P = window.VPPermits;

print('the Game settings page: a bingo permit card only where the state needs one');
var SETTINGS = readFile('venueplay/app/settings.html');
check('settings paints the bingo kind only, through VPPermits, and hides its Gaming details section when there is none',
      /kinds:\["bingo"\]/.test(SETTINGS) && /var sec=\$\("permitsCard"\); if\(sec\) sec\.classList\.toggle\("hidden", !kinds\.length\);/.test(SETTINGS));
check('settings carries no permit table of its own (no permitsToAsk, no PERMIT_KINDS)', SETTINGS.indexOf('permitsToAsk') < 0 && SETTINGS.indexOf('PERMIT_KINDS') < 0);
function bingoCard(state, entity, extra) { var v = { au_state: state, entity_type: entity, permits: {} }; for (var k in (extra || {})) v[k] = extra[k]; return P.kindsFor(v, ['bingo']).join(','); }
check('an NSW club (The Jolly Jess) gets no bingo card, so the section is gone', bingoCard('NSW', 'non_profit') === '', bingoCard('NSW', 'non_profit'));
check('an NSW pub gets no bingo card either', bingoCard('NSW', 'for_profit') === '');
check('a VIC venue gets the bingo card (the lawyer\'s permit warranty)', bingoCard('VIC', 'non_profit') === 'bingo');
check('an SA pub, where number bingo is hidden, gets no bingo card', bingoCard('SA', 'for_profit') === '', bingoCard('SA', 'for_profit'));
check('a saved bingo permit is still shown where the state does not need one, so it can be cleared',
      P.kindsFor({ au_state: 'NSW', permits: { bingo: { number: 'B1' } } }, ['bingo']).join(',') === 'bingo');

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
