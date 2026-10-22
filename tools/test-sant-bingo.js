/* NUMBER BINGO FOR SA AND NT PUBS: the one rule, the HQ switch, the signup ask and the welcome email.
   RUN, not read.

   Dean, 22 Oct 2026 (memory cold-rollout-decisions-22-oct, state-rules/SA-NT-WA-FINDINGS-2026-10-22):
   in South Australia only a not-for-profit may run bingo, in the Northern Territory only an approved
   association, so an SA or NT pub never sees number bingo; HQ can switch it on for one venue whose bingo
   a not-for-profit runs (migration 116). Be honest from the start: a note at signup, a welcome email
   variant, a note in HQ, FAQ entries. MUSICAL BINGO IS NOT BINGO and nothing here touches it.

   1. THE SAME RULE IN FOUR PLACES gives the same answer for every venue in a table of states, types and
      switch positions: VPGaming.numberBingoHidden (app/vp-gaming.js, the console, settings and HQ),
      numberBingoHiddenFor (game Worker, lifted from the shipped file), vpaNoNumberBingo (billing Worker)
      and vpNoBingoAt (lifted from the signup page's own script). The postcode maps agree for every
      postcode from 0000 to 9999.
   2. THE HQ SWITCH runs the REAL vpaHandleVenueGaming on tools/rig-billing-worker.js: owner and accounts
      admins only, a real true or false only, its own audit row each way, "run migration 116 first" when
      the column is not there and nothing written.
   3. THE SIGNUP runs the REAL handleCheckout and vpaProvisionFromCheckout: the "our bingo is run by a
      not-for-profit" tick survives checkout and becomes ONE help desk ticket for that venue (not two on
      a Stripe retry); no tick, no ticket.
   4. THE WELCOME EMAIL, as a customer gets it (real templates off disk, fake Resend): an SA pub and an NT
      pub get the bingo note naming their state; an SA club, a QLD pub and an NT pub HQ has switched on
      do not; a group with both names both; HQ's own welcome follows the venue's own words (pub or club);
      no email ever carries a raw {{nobingo_places}} or an IF marker.
   5. THE STATE RULES that remain (VPGaming): SA pub raffles cannot be paid, SA and NT members draw
      notes, no present-to-win at an SA pub, 15 minutes for an SA club, NT alcohol-only prizes refused,
      NT no longer blocked; and musical bingo is never touched by any of it.

   Run from the repo root:  jsc tools/test-sant-bingo.js
*/
load('tools/rig-billing-worker.js');
var fails = 0, ran = 0, finished = false;
/* jsc has no WebCrypto; the help desk mints a reply token with getRandomValues (the Worker has it). */
if (typeof crypto === 'undefined') { crypto = {}; }
if (!crypto.getRandomValues) crypto.getRandomValues = function (a) { for (var i = 0; i < a.length; i++) a[i] = (i * 2654435761 + 7) & 255; return a; };
function check(name, ok, saw) { ran++; if (ok) print('  ok   ' + name); else { print('  FAIL ' + name + (saw === undefined ? '' : '   saw: ' + JSON.stringify(saw).slice(0, 500))); fails++; } }

/* ---- the browser-side rule, loaded as the pages load it ---- */
var window = globalThis;
load('venueplay/app/vp-gaming.js');
var G = window.VPGaming;

/* ---- the game Worker's copy, lifted from the shipped file (it cannot be loaded beside this rig) ---- */
function liftFrom(src, name, what) {
  var i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('cannot find ' + name + ' in ' + what + ': a test that cannot find its subject cannot fail');
  var d = 0, k = src.indexOf('{', i);
  do { if (src[k] === '{') d++; else if (src[k] === '}') d--; k++; } while (d > 0 && k < src.length);
  return src.slice(i, k);
}
var GAME = readFile('venueplay-backend/worker/venueplay-game.js');
var gameStates = /const NO_PUB_BINGO_STATES = (new Set\(\[[^\]]*\]\));/.exec(GAME);
if (!gameStates) throw new Error('cannot find NO_PUB_BINGO_STATES in the game Worker');
var gameRule = (0, eval)('(function(){ var NO_PUB_BINGO_STATES = ' + gameStates[1] + '; ' + liftFrom(GAME, 'numberBingoHiddenFor', 'the game Worker') + '; return numberBingoHiddenFor; })()');
var gameNoPresent = (0, eval)('(' + liftFrom(GAME, 'noPresentToWinFor', 'the game Worker') + ')');
var gameMinClaim = (0, eval)('(' + liftFrom(GAME, 'minClaimSecondsFor', 'the game Worker') + ')');

/* ---- the signup page's copy, lifted from its own inline script ---- */
var PAGE = readFile('venueplay/index.html');
var pageRule = (0, eval)('(' + liftFrom(PAGE, 'vpNoBingoAt', 'index.html') + ')');

var PC = { SA: '5000', NT: '0800', QLD: '4000', NSW: '2000', VIC: '3000', WA: '6000', TAS: '7000', ACT: '2600' };

(async function () {
  print('1. the same rule in four places, and the same postcode map');
  var disagree = [], hiddenCount = 0, cases = 0;
  Object.keys(PC).forEach(function (st) {
    [null, 'for_profit', 'non_profit'].forEach(function (ent) {
      [false, true, undefined].forEach(function (on) {
        var v = { au_state: st, entity_type: ent, number_bingo_on: on };
        var a = G.numberBingoHidden(v), b = gameRule(v), c = vpaNoNumberBingo(st, ent, on);
        // The signup page asks before any switch exists, so it is compared only with the switch off.
        var d = (on === true) ? a : (pageRule(PC[st], ent) !== '');
        cases++; if (a) hiddenCount++;
        if (a !== b || a !== c || a !== d) disagree.push([st, ent, on, a, b, c, d]);
      });
    });
  });
  check('every state, type and switch position: vp-gaming.js, the game Worker and the billing Worker agree', disagree.length === 0, disagree);
  check('...and the table is not trivial: hidden for exactly the SA and NT non-clubs with the switch off (8 of ' + cases + ')', hiddenCount === 8, hiddenCount);
  check('SA pub hidden; SA club shown; NT pub hidden; NT pub switched on by HQ shown; QLD pub shown',
    G.numberBingoHidden({ au_state: 'SA', entity_type: 'for_profit' }) === true && G.numberBingoHidden({ au_state: 'SA', entity_type: 'non_profit' }) === false &&
    G.numberBingoHidden({ au_state: 'NT', entity_type: 'for_profit' }) === true && G.numberBingoHidden({ au_state: 'NT', entity_type: 'for_profit', number_bingo_on: true }) === false &&
    G.numberBingoHidden({ au_state: 'QLD', entity_type: 'for_profit' }) === false);
  check('a venue whose type is not recorded yet counts as a pub (hidden until HQ records a club)', G.numberBingoHidden({ au_state: 'nt', entity_type: null }) === true && gameRule({ au_state: 'nt', entity_type: null }) === true);
  check('the signup page: SA 5000 and 5999, NT 0800 and 0999 for a pub; not for a club, not 4000, not 0200 (ACT), not a 3-digit postcode',
    pageRule('5000', 'for_profit') === 'SA' && pageRule('5999', 'for_profit') === 'SA' && pageRule('0800', 'for_profit') === 'NT' && pageRule('0999', 'for_profit') === 'NT' &&
    pageRule('5000', 'non_profit') === '' && pageRule('4000', 'for_profit') === '' && pageRule('0200', 'for_profit') === '' && pageRule('800', 'for_profit') === '');
  var mapDiff = [], pageDiff = [];
  for (var n = 0; n <= 9999; n++) {
    var pc = ('0000' + n).slice(-4), w = vpaStateFromPostcode(pc);
    if (G.stateFromPostcode(pc) !== w) mapDiff.push([pc, G.stateFromPostcode(pc), w]);
    var p = pageRule(pc, 'for_profit');
    if ((p !== '') !== (w === 'SA' || w === 'NT') || (p && p !== w)) pageDiff.push([pc, p, w]);
  }
  check('VPGaming.stateFromPostcode and the billing Worker\'s vpaStateFromPostcode agree on all 10,000 postcodes', mapDiff.length === 0, mapDiff.slice(0, 5));
  check('the signup page flags exactly the postcodes the billing Worker calls SA or NT', pageDiff.length === 0, pageDiff.slice(0, 5));
  check('SA 58xx and 59xx are South Australia now (the PO box ranges)', vpaStateFromPostcode('5800') === 'SA' && vpaStateFromPostcode('5999') === 'SA');

  print('2. the HQ switch (vpaHandleVenueGaming)');
  vpaVerifyJWT = async function (t) { return t ? { sub: t } : null; };
  var NO_COLUMN = false, rigFetch = globalThis.fetch;
  globalThis.fetch = function (url, opts) {
    var u = String(url), method = (opts && opts.method) || 'GET';
    if (NO_COLUMN && /\/rest\/v1\/vp_venues\?/.test(u) && (/number_bingo_on/.test(u) || (method === 'PATCH' && /number_bingo_on/.test(String(opts.body || ''))))) {
      return Promise.resolve({ ok: false, status: 400, json: function () { return Promise.resolve({}); },
        text: function () { return Promise.resolve('{"code":"PGRST204","message":"Could not find the \'number_bingo_on\' column of \'vp_venues\' in the schema cache"}'); } });
    }
    return rigFetch(url, opts);
  };
  var DEAN = 'a0000000-0000-4000-8000-000000000001', ACC = 'a0000000-0000-4000-8000-000000000002', STAFF = 'a0000000-0000-4000-8000-000000000003', OWNER = 'a0000000-0000-4000-8000-000000000004';
  var PUB = 'b0000000-0000-4000-8000-000000000001';
  function hqWorld() {
    DB = {}; FAIL = {}; NO_COLUMN = false; sent.length = 0;
    DB.vp_platform_admins = [{ auth_user_id: DEAN, label: 'Dean', role: 'owner' }, { auth_user_id: ACC, label: 'Accounts', role: 'accounts' }, { auth_user_id: STAFF, label: 'Staff', role: 'staff' }];
    DB.vp_venues = [{ id: PUB, name: 'Glenelg Tavern', slug: 'glenelg-tavern', status: 'active', postcode: '5045', au_state: 'SA', entity_type: 'for_profit', paid_entry_enabled: false, number_bingo_on: false }];
    DB.vp_venue_staff = [{ id: 's1', auth_user_id: OWNER, venue_id: PUB, role: 'owner', permissions: null }];
    DB.vp_admin_audit = [];
  }
  function as(user, body) {
    var txt = JSON.stringify(Object.assign({ venue_id: PUB }, body || {}));
    return { url: 'https://api/admin/venue-gaming', headers: { get: function (k) { return k === 'Authorization' && user ? 'Bearer ' + user : ''; } },
             text: function () { return Promise.resolve(txt); }, json: function () { return Promise.resolve(JSON.parse(txt)); } };
  }
  function pub() { return DB.vp_venues[0]; }
  function audits(a) { return DB.vp_admin_audit.filter(function (x) { return !a || x.action === a; }); }
  hqWorld();
  var r = await vpaHandleVenueGaming(as(DEAN, { number_bingo_on: true }), ENV, J);
  check('an owner admin switches number bingo ON for an SA pub', r.status === 200 && pub().number_bingo_on === true, r);
  var a = audits('venue_number_bingo_on');
  check('...one audit row: venue_number_bingo_on, by Dean, this venue, its state and type, from off to on',
    a.length === 1 && a[0].actor_label === 'Dean' && a[0].target === 'venue:' + PUB && a[0].detail.from === false && a[0].detail.to === true &&
    a[0].detail.state === 'SA' && a[0].detail.entity_type === 'for_profit', DB.vp_admin_audit);
  check('...and no venue_gaming_updated row for it', audits('venue_gaming_updated').length === 0, DB.vp_admin_audit);
  r = await vpaHandleVenueGaming(as(ACC, { number_bingo_on: false }), ENV, J);
  check('an accounts admin switches it OFF, recorded as venue_number_bingo_off from on to off',
    r.status === 200 && pub().number_bingo_on === false && audits('venue_number_bingo_off').length === 1 && audits('venue_number_bingo_off')[0].detail.from === true, DB.vp_admin_audit);
  hqWorld();
  r = await vpaHandleVenueGaming(as(STAFF, { number_bingo_on: true }), ENV, J);
  var r2 = await vpaHandleVenueGaming(as(OWNER, { number_bingo_on: true }), ENV, J);
  check('a staff admin and the venue\'s own owner are refused, and nothing moves', r.status === 403 && r2.status === 403 && pub().number_bingo_on === false && audits().length === 0, [r, r2]);
  r = await vpaHandleVenueGaming(as(DEAN, { number_bingo_on: 'yes' }), ENV, J);
  check('only a real true or false is taken', r.status === 400 && pub().number_bingo_on === false && audits().length === 0, r);
  hqWorld(); NO_COLUMN = true;
  r = await vpaHandleVenueGaming(as(DEAN, { number_bingo_on: true }), ENV, J);
  check('before migration 116 the answer says to run it, and no audit row is written', r.status === 409 && /migration 116/.test(r.body.error) && audits().length === 0, r);
  NO_COLUMN = false;

  print('3. the signup tick becomes one help desk ticket');
  function reset() { DB = {}; sent.length = 0; stripeCalls.length = 0; FAIL = {}; }
  async function signup(email, venues) {
    await handleCheckout(REQ({ name: 'Pat', email: email, mobile: '0412 345 678', postcode: (venues[0] && venues[0].postcode) || '2000', plan: 'monthly',
      founding_code: 'NSW-OCT-2026', venues: venues }), ENV, J);
    var rowId = DB.venueplay_founding[DB.venueplay_founding.length - 1].id;
    return { client_reference_id: rowId, metadata: { tier: 'founding', row_id: rowId }, customer: 'cus_1', subscription: 'sub_1', created: Math.floor(Date.now() / 1000) };
  }
  async function run(s) { try { await vpaProvisionFromCheckout(ENV, s); return 'ok'; } catch (e) { return 'threw: ' + e; } }
  function tickets() { return (DB.vp_help_tickets || []); }
  function toCustomer(addr) { return sent.filter(function (m) { return (m.to || [])[0] === addr; }); }
  reset();
  var s1 = await signup('pat@glenelgtavern.com.au', [{ name: 'Glenelg Tavern', seats: 80, postcode: '5045', entity_type: 'for_profit', bingo_review: true }]);
  var lead = DB.venueplay_founding[0];
  var vj = typeof lead.venues_json === 'string' ? JSON.parse(lead.venues_json) : lead.venues_json;
  check('checkout keeps the tick on the lead (it used to drop anything it did not name)', !!(vj && vj[0] && vj[0].bingo_review === true), vj);
  var res1 = await run(s1), res2 = await run(s1);
  var v1 = (DB.vp_venues || [])[0];
  check('provisioned as an SA pub', res1 === 'ok' && v1 && v1.au_state === 'SA' && v1.entity_type === 'for_profit', [res1, v1]);
  check('ONE help desk ticket for that venue, asking HQ to look, even after Stripe delivers the event twice',
    res2 === 'ok' && tickets().length === 1 && tickets()[0].venue_id === v1.id && /Number bingo review: Glenelg Tavern/.test(tickets()[0].subject) &&
    /South Australia/.test(tickets()[0].message) && tickets()[0].contact_email === 'pat@glenelgtavern.com.au' && tickets()[0].category === 'venue_support', tickets());
  reset();
  var s2 = await signup('sam@nightcliff.com.au', [{ name: 'Nightcliff Hotel', seats: 60, postcode: '0810', entity_type: 'for_profit' }]);
  await run(s2);
  check('no tick, no ticket', tickets().length === 0, tickets());
  reset();
  var s3 = await signup('kim@surfclub.org.au', [{ name: 'Henley Surf Club', seats: 60, postcode: '5022', entity_type: 'non_profit', bingo_review: true }]);
  await run(s3);
  check('a club cannot raise one (it has bingo already): the tick only counts for an SA or NT pub',
    tickets().length === 0 && ((typeof DB.venueplay_founding[0].venues_json === 'string' ? JSON.parse(DB.venueplay_founding[0].venues_json) : DB.venueplay_founding[0].venues_json)[0].bingo_review === true), tickets());

  print('4. the welcome email, as the customer gets it');
  function bingoNote(html) { var m = /A note on bingo in ([^<]+)</.exec(html || ''); return m ? m[1] : ''; }
  function clean(html) { return html.indexOf('{{nobingo_places}}') < 0 && html.indexOf('IF:nobingo') < 0 && html.indexOf('ENDIF:nobingo') < 0; }
  reset();
  await run(await signup('pat@glenelgtavern.com.au', [{ name: 'Glenelg Tavern', seats: 80, postcode: '5045', entity_type: 'for_profit' }]));
  var e1 = toCustomer('pat@glenelgtavern.com.au')[0];
  check('an SA pub is told, kindly, that number bingo is off in South Australia and why', e1 && bingoNote(e1.html) === 'South Australia' &&
    /only a not-for-profit organisation may run bingo/.test(e1.html) && /musical bingo, trivia and members draws/.test(e1.html) && /reply to this email/.test(e1.html), e1 && e1.html.slice(0, 200));
  check('...and the email has no raw token or marker left in it', !!e1 && clean(e1.html));
  check('...and no em dash anywhere in it', !!e1 && e1.html.indexOf('—') < 0);
  reset();
  await run(await signup('sam@nightcliff.com.au', [{ name: 'Nightcliff Hotel', seats: 60, postcode: '0810', entity_type: 'for_profit' }]));
  var e2 = toCustomer('sam@nightcliff.com.au')[0];
  check('an NT pub: the note names the Northern Territory', !!e2 && bingoNote(e2.html) === 'the Northern Territory' && clean(e2.html), e2 && bingoNote(e2.html));
  reset();
  await run(await signup('kim@surfclub.org.au', [{ name: 'Henley Surf Club', seats: 60, postcode: '5022', entity_type: 'non_profit' }]));
  var e3 = toCustomer('kim@surfclub.org.au')[0];
  check('an SA club: no bingo note at all, and nothing left of the section', !!e3 && bingoNote(e3.html) === '' && clean(e3.html) && e3.html.indexOf('not-for-profit organisation may run bingo') < 0);
  reset();
  await run(await signup('lee@royal.com.au', [{ name: 'Royal Hotel', seats: 60, postcode: '4000', entity_type: 'for_profit' }]));
  var e4 = toCustomer('lee@royal.com.au')[0];
  check('a Queensland pub: no bingo note', !!e4 && bingoNote(e4.html) === '' && clean(e4.html));
  reset();
  await run(await signup('grp@pubs.com.au', [{ name: 'Glenelg Tavern', seats: 60, postcode: '5045', entity_type: 'for_profit' },
                                              { name: 'Nightcliff Hotel', seats: 40, postcode: '0810', entity_type: 'for_profit' },
                                              { name: 'Royal Hotel', seats: 40, postcode: '4000', entity_type: 'for_profit' }]));
  var e5 = toCustomer('grp@pubs.com.au')[0];
  check('a group with an SA pub and an NT pub: one note naming both, South Australia first', !!e5 && bingoNote(e5.html) === 'South Australia and the Northern Territory' && clean(e5.html), e5 && bingoNote(e5.html));
  reset();
  await run(await signup('grp2@pubs.com.au', [{ name: 'Royal Hotel', seats: 60, postcode: '4000', entity_type: 'for_profit' }, { name: 'Crown Hotel', seats: 40, postcode: '2000', entity_type: 'for_profit' }]));
  var e6 = toCustomer('grp2@pubs.com.au')[0];
  check('a group with no SA or NT venue: no note', !!e6 && bingoNote(e6.html) === '' && clean(e6.html));

  sent.length = 0;
  async function hq(o) { sent.length = 0; await vpaFireHqWelcome(ENV, Object.assign({ foundingId: 'f9', email: 'hq@venue.com.au', venueName: 'X', slug: 'x', seats: 50, plan: 'monthly', comp: true }, o)); return sent[0]; }
  var h1 = await hq({ postcode: '0870', venueKind: 'hotel' });
  var h2 = await hq({ postcode: '0870', venueKind: 'rsl' });
  var h3 = await hq({ postcode: '5000', venueKind: 'pub', entityType: 'non_profit' });
  var h4 = await hq({ postcode: '5000', venueKind: 'pub', numberBingoOn: true });
  var h5 = await hq({ postcode: '2000', venueKind: 'pub' });
  check('HQ\'s welcome: an NT hotel gets the note; an NT RSL does not', !!h1 && bingoNote(h1.html) === 'the Northern Territory' && !!h2 && bingoNote(h2.html) === '' && clean(h1.html) && clean(h2.html), [h1 && bingoNote(h1.html), h2 && bingoNote(h2.html)]);
  check('...an SA pub HQ recorded as a club, or switched on, does not; nor does a NSW pub', bingoNote(h3.html) === '' && bingoNote(h4.html) === '' && bingoNote(h5.html) === '' && clean(h3.html) && clean(h5.html));
  check('...and the card and comp sections still work around it (comp kept, card stripped)', /on us|on the house/i.test(h1.html) && h1.html.indexOf('<!--IF:card-->') < 0 && h1.html.indexOf('{{card_url}}') < 0);

  print('5. the state rules that remain');
  var saRaffle = G.assess({ state: 'SA', entityType: 'for_profit', format: 'raffle', paidEntry: true, paidEntryEnabled: true });
  check('SA pub: a paid raffle is a hard block (start as free entry), with the reason', saRaffle.hardBlock === true && /not-for-profit organisation may run a raffle/.test(saRaffle.points.join(' ')), saRaffle);
  var saClubRaffle = G.assess({ state: 'SA', entityType: 'non_profit', format: 'raffle', paidEntry: true, paidEntryEnabled: true });
  check('SA club: a paid raffle is still open', saClubRaffle.ok === true && saClubRaffle.hardBlock === false, saClubRaffle);
  var saMem = G.assess({ state: 'SA', entityType: 'for_profit', format: 'members', paidEntry: false }).points.join(' ');
  var saClubMem = G.assess({ state: 'SA', entityType: 'non_profit', format: 'members', paidEntry: false }).points.join(' ');
  check('SA pub members draw: $5,000 including the jackpot, no present to win, winners published 7 days', /\$5,000/.test(saMem) && /cannot be required to be present/.test(saMem) && /7 days/.test(saMem), saMem);
  check('SA club members draw: may ask the winner to be present, with at least 15 minutes', /at least 15 minutes/.test(saClubMem) && !/cannot be required to be present/.test(saClubMem), saClubMem);
  check('noPresentToWin: SA pub yes; SA club, NT pub and QLD pub no; same in the game Worker',
    G.noPresentToWin({ au_state: 'SA', entity_type: 'for_profit' }) && !G.noPresentToWin({ au_state: 'SA', entity_type: 'non_profit' }) && !G.noPresentToWin({ au_state: 'NT' }) && !G.noPresentToWin({ au_state: 'QLD' }) &&
    gameNoPresent({ au_state: 'SA', entity_type: null }) && !gameNoPresent({ au_state: 'SA', entity_type: 'non_profit' }) && !gameNoPresent({ au_state: 'QLD' }));
  check('minClaimSeconds: 900 for an SA club, 30 elsewhere; same in the game Worker',
    G.minClaimSeconds({ au_state: 'SA', entity_type: 'non_profit' }) === 900 && G.minClaimSeconds({ au_state: 'SA', entity_type: 'for_profit' }) === 30 && G.minClaimSeconds({ au_state: 'VIC', entity_type: 'non_profit' }) === 30 &&
    gameMinClaim({ au_state: 'SA', entity_type: 'non_profit' }) === 900 && gameMinClaim({ au_state: 'NT', entity_type: 'non_profit' }) === 30);
  check('after a win: SA pub told to publish for 7 days, NT pub told newspaper; a club and a NSW pub told nothing',
    /7 days/.test(G.afterWinReminder({ au_state: 'SA', entity_type: 'for_profit' })) && /newspaper/.test(G.afterWinReminder({ au_state: 'NT', entity_type: 'for_profit' })) &&
    G.afterWinReminder({ au_state: 'SA', entity_type: 'non_profit' }) === '' && G.afterWinReminder({ au_state: 'NSW', entity_type: 'for_profit' }) === '');
  var ntMem = G.assess({ state: 'NT', entityType: 'for_profit', format: 'members', paidEntry: false }).points.join(' ');
  check('NT pub members draw: $5,000, no staff or families, winners in a newspaper, nobody under 18, not only alcohol',
    /\$5,000/.test(ntMem) && /staff and their families/i.test(ntMem) && /newspaper/.test(ntMem) && /under 18/.test(ntMem) && /only alcohol/.test(ntMem), ntMem);
  var ntPaid = G.assess({ state: 'NT', entityType: 'non_profit', format: 'raffle', paidEntry: true, paidEntryEnabled: true });
  check('NT is no longer blocked over payments to organisations (Dean: ignore it)', !ntPaid.blocked && ntPaid.ok === true && vpaPaidEntryDefault('non_profit', 'NT') === true && vpaPaidEntryDefault('non_profit', 'QLD') === false, ntPaid);
  var liquor = ['Slab of XXXX', '$50 and a bottle of wine', 'Carton of beer', 'Bottle of Jim Beam', '6 pack of Coopers'];
  var fine = ['Meat tray and a bottle of wine', 'Dinner voucher', 'Seafood hamper', '$100 cash', 'Wine and cheese hamper', 'Meat tray'];
  check('NT: an alcohol-only prize (or money and alcohol) is refused', liquor.every(function (p) { return G.liquorPrizeBlocked({ au_state: 'NT' }, p); }), liquor.map(function (p) { return [p, G.liquorPrizeBlocked({ au_state: 'NT' }, p)]; }));
  check('NT: a prize with something else in it is fine', fine.every(function (p) { return !G.liquorPrizeBlocked({ au_state: 'NT' }, p); }), fine.map(function (p) { return [p, G.liquorPrizeBlocked({ au_state: 'NT' }, p)]; }));
  check('...and the same alcohol prize anywhere but the NT is untouched', !G.liquorPrizeBlocked({ au_state: 'SA' }, 'Slab of XXXX') && !G.liquorPrizeBlocked({ au_state: 'QLD' }, 'Carton of beer') && !G.liquorPrizeBlocked(null, 'Carton of beer'));

  print('musical bingo is not bingo');
  var mus = ['SA', 'NT'].map(function (st) { return G.assess({ state: st, entityType: 'for_profit', format: 'musical', paidEntry: false }); });
  check('SA and NT pubs: musical bingo gets no paper warning and no bingo-only note', mus.every(function (x) { return x.paper === false && !/not-for-profit organisations only|approved associations only/.test(x.points.concat(x.warnings).join(' ')); }), mus);
  check('the game Worker never treats musical as number bingo (lobbyFormat)', /if \(lobbyFormat\(b\.format\) === 'bingo90' && numberBingoHiddenFor\(/.test(GAME) && (0, eval)('(' + liftFrom(GAME, 'lobbyFormat', 'the game Worker') + ')')('musical') !== 'bingo90');
  finished = true;
})().catch(function (e) { print('  FAIL the test itself threw: ' + e + '\n' + (e && e.stack)); fails++; });
drainMicrotasks();
if (!finished) { print('  FAIL the test did not run to the end'); fails++; }
if (fails) throw new Error('SA and NT number bingo: ' + fails + ' of ' + ran + ' failed');
print('PASS ' + ran + ' checks');
