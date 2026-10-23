/* The compliance tick, the venue's own kind, and the permits it records: RUN, not word-searched.

   Anisimoff Legal 9380, 1 Oct 2026, point 3 (an active tick box putting compliance on the
   venue) and point 5 (a record of permits so a manual check is possible); 8 Oct 2026, point
   1(a) (Victoria's s8.4.4) and point 4. Built 15 Oct 2026, migration 100.

   Runs the REAL billing Worker on tools/rig-billing-worker.js:
     vpaHandleVenue            an onboarding without the tick, or without a name, or without
                               a venue kind, creates NOTHING; with them the row carries all three;
                               billing.founding_id links an existing record and sends no welcome
     vpbSetPermits             owner ok, manager with the draws right ok, manager without it
                               refused, a host refused, a stranger's venue refused, every bad
                               shape refused, the recorded rule, clearing a kind
     vpaHandleVenueCompliance  HQ gets the last THREE declarations newest first, the recorded
                               map and the entity suggestion; a non-admin is refused
     vpaHandleVenueGaming      venue_kind is correctable from HQ and nothing else moves

   Run from the repo root:  jsc tools/test-permits-and-compliance-tick.js
*/
load('tools/rig-billing-worker.js');
var fails = 0, ran = 0, finished = false;
function check(name, ok, saw) { ran++; if (ok) print('  ok   ' + name); else { print('  FAIL ' + name + (saw === undefined ? '' : '   saw: ' + JSON.stringify(saw).slice(0, 400))); fails++; } }
vpaVerifyJWT = async function (t) { return t ? { sub: t } : null; };
vpaFireHqWelcome = async function () { WELCOMES++; return true; };
var WELCOMES = 0;

/* The rig's fake PostgREST ignores order=. "The last three declarations" is meaningless without
   one, so for this suite a GET that names order=<col>.desc|asc sorts the table first. The rig
   itself is not changed: other suites rely on its shape. */
var rigFetch = globalThis.fetch;
var BLIP_PERMITS_READ = 0;   // make the next N reads of the permits column answer 503, and nothing else
globalThis.fetch = function (url, opts) {
  var u = String(url), method = (opts && opts.method) || 'GET';
  var m = /\/rest\/v1\/([a-zA-Z_]+)\?(.*)$/.exec(u);
  if (method === 'GET' && m && m[1] === 'vp_venues' && /select=id,permits(&|$)/.test(m[2]) && BLIP_PERMITS_READ > 0) {
    BLIP_PERMITS_READ--;
    return Promise.resolve({ ok: false, status: 503, json: function () { return Promise.resolve({}); }, text: function () { return Promise.resolve('upstream blip'); } });
  }
  if (method === 'GET' && m) {
    var om = /(?:^|&)order=([a-z_]+)\.(asc|desc)/.exec(m[2]);
    if (om && DB[m[1]]) {
      var col = om[1], dir = om[2] === 'desc' ? -1 : 1;
      DB[m[1]].sort(function (a, b) { return a[col] < b[col] ? -dir : (a[col] > b[col] ? dir : 0); });
    }
  }
  return rigFetch(url, opts);
};

function U(n) { return '50000000-0000-4000-8000-' + ('000000000000' + n).slice(-12); }
function V(n) { return '60000000-0000-4000-8000-' + ('000000000000' + n).slice(-12); }
var ADMIN = U(9), OWNER = U(1), MANAGER = U(2), NODRAWS = U(3), HOST = U(4), STRANGER = U(5);
var ROYAL = V(1), ELSEWHERE = V(2);
function as(user, body, extra) {
  var h = { Authorization: 'Bearer ' + user }; for (var k in (extra || {})) h[k] = extra[k];
  var txt = JSON.stringify(body || {});
  return { url: 'https://api/x', headers: { get: function (k) { return h[k] || ''; } }, text: function () { return Promise.resolve(txt); }, json: function () { return Promise.resolve(JSON.parse(txt)); } };
}
function get(user, url) { return { url: url, headers: { get: function (k) { return k === 'Authorization' ? 'Bearer ' + user : ''; } }, text: function () { return Promise.resolve(''); } }; }
function world() {
  DB = {}; sent.length = 0; FAIL = {}; WELCOMES = 0;
  DB.vp_platform_admins = [{ auth_user_id: ADMIN, label: 'Dean', role: 'owner' }];
  DB.venueplay_founding = [{ id: 'f1', contact_email: 'royal@example.com', plan: 'monthly', status: 'card_on_file', max_seats: 80 },
                           { id: 'f2', contact_email: 'else@example.com', plan: 'monthly', status: 'card_on_file', max_seats: 40 },
                           { id: 'f-orphan', contact_email: 'orphan@example.com', plan: 'annual', status: 'active', max_seats: 120 }];
  DB.vp_venues = [{ id: ROYAL, name: 'The Royal Hotel', founding_id: 'f1', slug: 'royal', status: 'active', max_players: 80, created_at: '2026-01-01T00:00:00Z', au_state: 'NSW', permits: {} },
                  { id: ELSEWHERE, name: 'Somebody Else Hotel', founding_id: 'f2', slug: 'else', status: 'active', max_players: 40, created_at: '2026-01-02T00:00:00Z', au_state: 'VIC', permits: {} }];
  DB.vp_venue_staff = [{ id: 's1', auth_user_id: OWNER, venue_id: ROYAL, role: 'owner', permissions: null },
                       { id: 's2', auth_user_id: MANAGER, venue_id: ROYAL, role: 'manager', permissions: { advertising: true, draws_raffles: true, players_optin: false, add_hosts: true } },
                       { id: 's3', auth_user_id: NODRAWS, venue_id: ROYAL, role: 'manager', permissions: { advertising: true, draws_raffles: false, players_optin: false, add_hosts: true } },
                       { id: 's4', auth_user_id: HOST, venue_id: ROYAL, role: 'host', permissions: null },
                       { id: 's5', auth_user_id: STRANGER, venue_id: ELSEWHERE, role: 'owner', permissions: null }];
  DB.vp_admin_audit = [];
  DB.vp_gaming_declarations = [];
  DB.vp_venue_settings = []; DB.vp_screens = [];
}
var TICK = { accepted: true, by: 'Jane Smith, licensee' };
function onboarding(extra) {
  var b = { name: 'The New Tavern', slug: 'new-tavern-2000', timezone: 'Australia/Sydney', postcode: '2000',
            billing: { type: 'group', group_id: 'g1', included_players: 60 }, venue_kind: 'hotel', compliance: TICK };
  for (var k in (extra || {})) b[k] = extra[k];
  return b;
}
function venuesCreated() { return DB.vp_venues.filter(function (v) { return v.slug === 'new-tavern-2000' || v.name === 'The New Tavern'; }).length; }
function permit(over) { var p = { number: '', holder: 'venue', npo_name: '', authorised_on: '', expires: null, note: '' }; for (var k in (over || {})) p[k] = over[k]; return p; }

(async function () {
  print('onboarding is refused without the tick, and nothing is created');
  world();
  var r = await vpaHandleVenue(as(ADMIN, onboarding({ compliance: undefined })), ENV, J);
  check('no compliance object: 400', r.status === 400 && /compliance/i.test(r.body.error), r);
  check('and no venue row was written', venuesCreated() === 0, DB.vp_venues.length);
  r = await vpaHandleVenue(as(ADMIN, onboarding({ compliance: { accepted: 'yes', by: 'Jane' } })), ENV, J);
  check('accepted must be exactly true, not a truthy string: 400', r.status === 400 && venuesCreated() === 0, r);
  r = await vpaHandleVenue(as(ADMIN, onboarding({ compliance: { accepted: true, by: '   ' } })), ENV, J);
  check('ticked with nobody named: 400', r.status === 400 && /name/i.test(r.body.error) && venuesCreated() === 0, r);
  r = await vpaHandleVenue(as(ADMIN, onboarding({ venue_kind: 'nightclub' })), ENV, J);
  check('a venue kind outside the seven: 400', r.status === 400 && /pub, hotel, club/.test(r.body.error) && venuesCreated() === 0, r);
  r = await vpaHandleVenue(as(ADMIN, onboarding({ venue_kind: '' })), ENV, J);
  check('no venue kind: 400', r.status === 400 && venuesCreated() === 0, r);
  check('the audit trail has nothing, because nothing happened', DB.vp_admin_audit.length === 0, DB.vp_admin_audit);

  print('with the tick and a kind, the venue carries the record');
  world();
  r = await vpaHandleVenue(as(ADMIN, onboarding()), ENV, J);
  check('created', r.status === 200 && r.body.ok === true && r.body.venue && r.body.venue.slug === 'new-tavern-2000', r.body);
  var row = DB.vp_venues.filter(function (v) { return v.slug === 'new-tavern-2000'; })[0] || {};
  check('venue_kind written', row.venue_kind === 'hotel', row);
  check('compliance_accepted_by is the name given', row.compliance_accepted_by === 'Jane Smith, licensee', row.compliance_accepted_by);
  check('compliance_accepted_at is a timestamp from now, not a flag', /^\d{4}-\d{2}-\d{2}T/.test(String(row.compliance_accepted_at)) && Math.abs(Date.parse(row.compliance_accepted_at) - Date.now()) < 60000, row.compliance_accepted_at);
  check('au_state still comes from the postcode (the Worker path onboard.html now uses)', row.au_state === 'NSW' && row.postcode === '2000', row);
  var audit = DB.vp_admin_audit.filter(function (a) { return a.action === 'venue_onboarded'; })[0] || {};
  check('the audit row says who accepted and what they are', audit.detail && audit.detail.compliance_accepted_by === 'Jane Smith, licensee' && audit.detail.venue_kind === 'hotel', audit.detail);
  r = await vpaHandleVenue(as(ADMIN, onboarding({ slug: 'another-2000', name: 'Another', venue_kind: 'rsl', compliance: { accepted: true, by: 'x'.repeat(300) } })), ENV, J);
  var row2 = DB.vp_venues.filter(function (v) { return v.slug === 'another-2000'; })[0] || {};
  check('a very long name is kept to 120 characters, not refused', r.status === 200 && row2.compliance_accepted_by.length === 120, row2.compliance_accepted_by && row2.compliance_accepted_by.length);
  r = await vpaHandleVenue(as(OWNER, onboarding({ slug: 'owner-try-2000' })), ENV, J);
  check('a venue owner (not a Gflam admin) cannot onboard a venue', r.status === 403 && DB.vp_venues.filter(function (v) { return v.slug === 'owner-try-2000'; }).length === 0, r);

  print('linking an existing founding record (onboard.html\'s independent path)');
  world();
  var before = DB.venueplay_founding.length;
  r = await vpaHandleVenue(as(ADMIN, onboarding({ billing: { type: 'founding', founding_id: 'f-orphan' }, send_welcome: true })), ENV, J);
  var linked = DB.vp_venues.filter(function (v) { return v.slug === 'new-tavern-2000'; })[0] || {};
  check('created against the existing record', r.status === 200 && r.body.founding_id === 'f-orphan' && linked.founding_id === 'f-orphan', r.body);
  check('no second founding row was made', DB.venueplay_founding.length === before, DB.venueplay_founding.length);
  check('the plan cap is read off the record', linked.max_players === 120, linked.max_players);
  check('no welcome email for a linked record (they were welcomed when they signed up)', WELCOMES === 0 && r.body.welcome_sent === false, [WELCOMES, r.body.welcome_sent]);
  r = await vpaHandleVenue(as(ADMIN, onboarding({ slug: 'ghost-2000', billing: { type: 'founding', founding_id: 'f-does-not-exist' } })), ENV, J);
  check('an id that is not there is refused, nothing created', r.status === 400 && /not found/i.test(r.body.error) && DB.vp_venues.filter(function (v) { return v.slug === 'ghost-2000'; }).length === 0, r);
  r = await vpaHandleVenue(as(ADMIN, onboarding({ slug: 'fresh-2000', billing: { type: 'founding', founding: { contact_email: 'fresh@example.com', max_seats: 50, plan: 'monthly' } } })), ENV, J);
  check('the create-a-founding-row path still welcomes', r.status === 200 && WELCOMES === 1 && r.body.welcome_sent === true, [r.status, WELCOMES]);

  print('recording a permit: who may');
  world();
  var body = { venue_id: ROYAL, kind: 'bingo', permit: permit({ number: 'CGA-12345', authorised_on: '2026-03-01', expires: '2027-03-01', note: 'club bingo' }) };
  r = await vpbSetPermits(as(OWNER, body, { 'X-VP-Venue': ROYAL }), ENV, J);
  check('the owner records it', r.status === 200 && r.body.ok === true, r.body);
  check('it is stored on the venue row under its kind', DB.vp_venues[0].permits && DB.vp_venues[0].permits.bingo && DB.vp_venues[0].permits.bingo.number === 'CGA-12345' && DB.vp_venues[0].permits.bingo.expires === '2027-03-01', DB.vp_venues[0].permits);
  check('and the answer says bingo is recorded, the others not', r.body.recorded.bingo === true && r.body.recorded.raffle === false && r.body.recorded.members === false, r.body.recorded);
  check('an audit row names the kind, never the number', DB.vp_admin_audit.some(function (a) { return a.action === 'permits_set' && a.detail.kind === 'bingo' && a.detail.recorded === true && JSON.stringify(a.detail).indexOf('CGA-12345') === -1; }), DB.vp_admin_audit);
  r = await vpbSetPermits(as(MANAGER, { venue_id: ROYAL, kind: 'raffle', permit: permit({ number: 'RAF-1' }) }, { 'X-VP-Venue': ROYAL }), ENV, J);
  check('a manager with the draws right records one', r.status === 200 && r.body.recorded.raffle === true, r.body);
  check('without losing the owner\'s bingo permit (the object is merged, not replaced)', DB.vp_venues[0].permits.bingo.number === 'CGA-12345' && DB.vp_venues[0].permits.raffle.number === 'RAF-1', DB.vp_venues[0].permits);
  r = await vpbSetPermits(as(NODRAWS, { venue_id: ROYAL, kind: 'members', permit: permit({ number: 'M-1' }) }, { 'X-VP-Venue': ROYAL }), ENV, J);
  check('a manager WITHOUT the draws right is refused', r.status === 403 && /permission/i.test(r.body.error) && !DB.vp_venues[0].permits.members, r);
  r = await vpbSetPermits(as(HOST, { venue_id: ROYAL, kind: 'members', permit: permit({ number: 'M-1' }) }, { 'X-VP-Venue': ROYAL }), ENV, J);
  check('a host is refused (no owner or manager row at all)', (r.status === 403 || r.status === 400) && !DB.vp_venues[0].permits.members, r);
  r = await vpbSetPermits(as(STRANGER, { venue_id: ROYAL, kind: 'members', permit: permit({ number: 'M-1' }) }, { 'X-VP-Venue': ROYAL }), ENV, J);
  check('the owner of a different venue is refused for this one', r.status === 400 && /your venues/i.test(r.body.error) && !DB.vp_venues[0].permits.members, r);
  r = await vpbSetPermits(as(ADMIN, { venue_id: ROYAL, kind: 'members', permit: permit({ number: 'M-9' }) }, { 'X-VP-Venue': ROYAL }), ENV, J);
  check('HQ View as can record one for the venue', r.status === 200 && DB.vp_venues[0].permits.members.number === 'M-9', r);
  r = await vpbSetPermits({ headers: { get: function () { return ''; } }, json: function () { return Promise.resolve({}); } }, ENV, J);
  check('nobody signed in: 401', r.status === 401, r);

  print('recording a permit: the shape');
  world();
  function bad(label, b, rx) {
    return vpbSetPermits(as(OWNER, b, { 'X-VP-Venue': ROYAL }), ENV, J).then(function (r) {
      check(label, r.status === 400 && (!rx || rx.test(r.body.error)) && JSON.stringify(DB.vp_venues[0].permits) === '{}', r);
    });
  }
  await bad('a kind that is not a game of chance: 400', { venue_id: ROYAL, kind: 'trivia', permit: permit({ number: '1' }) }, /kind/);
  await bad('a holder that is neither venue nor npo: 400', { venue_id: ROYAL, kind: 'bingo', permit: permit({ number: '1', holder: 'someone' }) }, /holder/);
  await bad('a date not written YYYY-MM-DD: 400', { venue_id: ROYAL, kind: 'bingo', permit: permit({ number: '1', authorised_on: '12/03/2026' }) }, /YYYY-MM-DD/);
  await bad('a date that does not exist: 400', { venue_id: ROYAL, kind: 'bingo', permit: permit({ number: '1', expires: '2026-02-30' }) }, /real date/);
  await bad('a number longer than 80 characters: 400', { venue_id: ROYAL, kind: 'bingo', permit: permit({ number: 'x'.repeat(81) }) }, /too long/);
  await bad('a number that is not text: 400', { venue_id: ROYAL, kind: 'bingo', permit: permit({ number: 12345 }) }, /text/);
  await bad('a permit that is not an object: 400', { venue_id: ROYAL, kind: 'bingo', permit: 'CGA-1' }, /object/);
  await bad('a permit that is an array: 400', { venue_id: ROYAL, kind: 'bingo', permit: ['CGA-1'] }, /object/);
  await bad('npo named as holder but no name given: 400', { venue_id: ROYAL, kind: 'raffle', permit: permit({ holder: 'npo', authorised_on: '2026-01-01' }) }, /charity/);
  await bad('no venue named: 400', { kind: 'bingo', permit: permit({ number: '1' }) }, /venues/);

  print('what counts as RECORDED (interface 1: a number, or an NPO with a date)');
  world();
  r = await vpbSetPermits(as(OWNER, { venue_id: ROYAL, kind: 'raffle', permit: permit({ holder: 'npo', npo_name: 'Surf Life Saving Club', authorised_on: '2026-02-14' }) }, { 'X-VP-Venue': ROYAL }), ENV, J);
  check('a charity named with its authorisation date, no number: recorded', r.status === 200 && r.body.recorded.raffle === true, r.body);
  r = await vpbSetPermits(as(OWNER, { venue_id: ROYAL, kind: 'raffle', permit: permit({ holder: 'npo', npo_name: 'Surf Life Saving Club' }) }, { 'X-VP-Venue': ROYAL }), ENV, J);
  check('a charity named with no date: saved but NOT recorded', r.status === 200 && r.body.recorded.raffle === false && DB.vp_venues[0].permits.raffle.npo_name === 'Surf Life Saving Club', r.body);
  r = await vpbSetPermits(as(OWNER, { venue_id: ROYAL, kind: 'raffle', permit: permit({ holder: 'venue', note: 'just a note' }) }, { 'X-VP-Venue': ROYAL }), ENV, J);
  check('a note alone: saved, not recorded', r.status === 200 && r.body.recorded.raffle === false, r.body);
  r = await vpbSetPermits(as(OWNER, { venue_id: ROYAL, kind: 'raffle', permit: permit() }, { 'X-VP-Venue': ROYAL }), ENV, J);
  check('all fields empty clears the kind', r.status === 200 && !('raffle' in DB.vp_venues[0].permits) && r.body.recorded.raffle === false, DB.vp_venues[0].permits);
  check('the Worker rule and a hand-written one agree on every shape',
    vpaPermitRecorded({ bingo: { number: '1' } }, 'bingo') === true &&
    vpaPermitRecorded({ bingo: { number: ' ' } }, 'bingo') === false &&
    vpaPermitRecorded({ raffle: { holder: 'npo', npo_name: 'X', authorised_on: '2026-01-01' } }, 'raffle') === true &&
    vpaPermitRecorded({ raffle: { holder: 'venue', npo_name: 'X', authorised_on: '2026-01-01' } }, 'raffle') === false &&
    vpaPermitRecorded({ raffle: { holder: 'npo', npo_name: '', authorised_on: '2026-01-01' } }, 'raffle') === false &&
    vpaPermitRecorded(null, 'bingo') === false && vpaPermitRecorded({}, 'members') === false && vpaPermitRecorded({ members: 'yes' }, 'members') === false);
  BLIP_PERMITS_READ = 1;
  r = await vpbSetPermits(as(OWNER, { venue_id: ROYAL, kind: 'bingo', permit: permit({ number: '1' }) }, { 'X-VP-Venue': ROYAL }), ENV, J);
  check('a database blip on the permits read is a retry-later, never a blank write', r.status === 503 && JSON.stringify(DB.vp_venues[0].permits) === '{}', r);
  check('the blip was spent on that read (the test aimed where it meant to)', BLIP_PERMITS_READ === 0, BLIP_PERMITS_READ);

  print('HQ reads the compliance card');
  world();
  DB.vp_venues[0].venue_kind = 'rsl'; DB.vp_venues[0].compliance_accepted_at = '2026-10-15T01:00:00Z'; DB.vp_venues[0].compliance_accepted_by = 'Jane';
  DB.vp_venues[0].permits = { bingo: { number: 'CGA-1', holder: 'venue', npo_name: '', authorised_on: '', expires: null, note: '' } };
  for (var i = 1; i <= 5; i++) {
    DB.vp_gaming_declarations.push({ id: 'd' + i, venue_id: ROYAL, format: i % 2 ? 'raffle' : 'members', entity_type: 'non_profit', state: 'NSW', paid_entry: i % 2 === 1,
      expected_sales_cents: i * 1000, total_prize_cents: i * 5000, category_claimed: 'NSW-' + i, declared_at: '2026-10-0' + i + 'T10:00:00Z' });
  }
  DB.vp_gaming_declarations.push({ id: 'dx', venue_id: ELSEWHERE, format: 'bingo90', state: 'VIC', paid_entry: true, declared_at: '2026-10-09T10:00:00Z' });
  r = await vpaHandleVenueCompliance(get(ADMIN, 'https://api/admin/venue-compliance?venue_id=' + ROYAL), ENV, J);
  check('an admin gets the card', r.status === 200 && r.body.ok === true, r.body);
  check('what the venue said it is, and the suggestion HQ sees (never applied)', r.body.venue.venue_kind === 'rsl' && r.body.suggested_entity_type === 'non_profit' && DB.vp_venues[0].entity_type === undefined, r.body);
  check('the tick, with who and when', r.body.venue.compliance_accepted_by === 'Jane' && r.body.venue.compliance_accepted_at === '2026-10-15T01:00:00Z', r.body.venue);
  check('the recorded map uses the same rule', r.body.recorded.bingo === true && r.body.recorded.raffle === false && r.body.recorded.members === false, r.body.recorded);
  check('exactly three declarations, newest first, this venue only', r.body.declarations.length === 3 && r.body.declarations.map(function (d) { return d.id; }).join(',') === 'd5,d4,d3', r.body.declarations.map(function (d) { return d.id; }));
  check('each carries what the venue declared', r.body.declarations[0].format === 'raffle' && r.body.declarations[0].paid_entry === true && r.body.declarations[0].category_claimed === 'NSW-5' && r.body.declarations[0].total_prize_cents === 25000, r.body.declarations[0]);
  r = await vpaHandleVenueCompliance(get(OWNER, 'https://api/admin/venue-compliance?venue_id=' + ROYAL), ENV, J);
  check('the venue owner is not a Gflam admin: 403', r.status === 403, r);
  r = await vpaHandleVenueCompliance(get(ADMIN, 'https://api/admin/venue-compliance'), ENV, J);
  check('no venue named: 400', r.status === 400, r);
  r = await vpaHandleVenueCompliance(get(ADMIN, 'https://api/admin/venue-compliance?venue_id=' + V(77)), ENV, J);
  check('a venue that does not exist: 404', r.status === 404, r);
  check('the entity suggestion covers every kind the column allows',
    ['club', 'rsl', 'charity', 'association'].every(function (k) { return vpaEntitySuggestion(k) === 'non_profit'; }) &&
    ['pub', 'hotel'].every(function (k) { return vpaEntitySuggestion(k) === 'for_profit'; }) &&
    vpaEntitySuggestion('other') === null && vpaEntitySuggestion(null) === null);

  print('HQ can correct what the venue said it is, and nothing else moves');
  world();
  DB.vp_venues[0].entity_type = 'non_profit'; DB.vp_venues[0].paid_entry_enabled = true;
  r = await vpaHandleVenueGaming(as(ADMIN, { venue_id: ROYAL, venue_kind: 'club' }), ENV, J);
  check('venue_kind set from HQ', r.status === 200 && DB.vp_venues[0].venue_kind === 'club', r);
  check('entity_type and paid entry untouched by it', DB.vp_venues[0].entity_type === 'non_profit' && DB.vp_venues[0].paid_entry_enabled === true, DB.vp_venues[0]);
  r = await vpaHandleVenueGaming(as(ADMIN, { venue_id: ROYAL, venue_kind: 'casino' }), ENV, J);
  check('a kind outside the seven is refused', r.status === 400 && DB.vp_venues[0].venue_kind === 'club', r);
  r = await vpaHandleVenueGaming(as(ADMIN, { venue_id: ROYAL, venue_kind: null }), ENV, J);
  check('and it can be cleared', r.status === 200 && DB.vp_venues[0].venue_kind === null, r);

  /* The self-serve path. A paid signup ticks the Terms box, which since 15 Oct 2026 carries the
     compliance sentence on index.html and nsw.html, and the webhook provisions the venue through
     vpaProvisionOneVenue with complianceBy = the founding contact. Run the real function on the rig
     and read the row it wrote. Without this every self-serve venue read "NOT accepted" in HQ. */
  print('a self-serve signup records the tick on the venue it provisions');
  world();
  r = await vpaProvisionOneVenue(ENV, { foundingId: 'f1', groupId: null, name: 'The Self Serve Arms', seats: 60, postcode: '2000', authUserId: 'u1', complianceBy: 'Sam Signup' });
  var made = (DB.vp_venues || []).filter(function (v) { return v.name === 'The Self Serve Arms'; })[0];
  check('provisioned with the contact as the acceptor', r && r.created && made && made.compliance_accepted_by === 'Sam Signup', made);
  check('and a time of acceptance', !!(made && made.compliance_accepted_at && !isNaN(Date.parse(made.compliance_accepted_at))), made);
  r = await vpaProvisionOneVenue(ENV, { foundingId: 'f1', groupId: null, name: 'The Untouched Arms', seats: 60, postcode: '2000', authUserId: 'u1' });
  var made2 = (DB.vp_venues || []).filter(function (v) { return v.name === 'The Untouched Arms'; })[0];
  check('no contact, nothing recorded: null is the truth, never a made-up name', !!made2 && made2.compliance_accepted_by === null && made2.compliance_accepted_at === null, made2);
  ['venueplay/index.html', 'venueplay/nsw.html'].forEach(function (f) {
    var page = readFile(f);
    var label = (page.match(/<label class="ck"><input type="checkbox" id="vp-consent">[\s\S]*?<\/label>/) || [''])[0];
    check(f + ': the consent tick carries the compliance sentence, verbatim', label.indexOf('We are responsible for complying with the gaming laws that apply to our venue, including any permit, licence or authority, age limits and attendance rules. VenuePlay supplies the software only.') !== -1, label.slice(0, 200));
    /* The refusal when the tick is off, scoped to the one statement that reads the tick (live audit,
       16 Oct 2026: it said "agree to the Terms" and nothing about what the tick also confirms). */
    var refusal = (page.match(/if \(consentEl && !consentEl\.checked\) \{ showErr\('([^']*)'\); return; \}/) || [])[1] || '';
    check(f + ': refusing an unticked box says what the tick confirms', refusal === 'Please tick the box to agree to the Terms and Privacy Policy and confirm your venue is responsible for its gaming compliance.', refusal);
  });
  /* The permits cards (24 Oct 2026): ONE copy, /app/vp-permits.js, painted by the Game settings page
     (bingo) and Your account > Draws (raffles, members draws). MUSICAL BINGO IS NOT BINGO (Dean, many
     times): the bingo kind is simply "Bingo" and nothing in the permits feature names musical bingo. */
  var PERMITS = readFile('venueplay/app/vp-permits.js');
  var kinds = (PERMITS.match(/var KINDS = (\{[^\n]*\});/) || [])[1] || '{}';
  var bingoLabel = ((0, eval)('(' + kinds + ')') || {}).bingo || '';
  check('vp-permits: the bingo permit kind is simply "Bingo"', bingoLabel === 'Bingo', bingoLabel);
  var PERMITS_CODE = PERMITS.replace(/\/\*[\s\S]*?\*\//g, '');   // the code and its words, not the note at the top that states the rule
  check('vp-permits: musical bingo is named nowhere in the permits feature (its words included)', !/musical/i.test(PERMITS_CODE), (PERMITS_CODE.match(/[^\n]*musical[^\n]*/gi) || []).join(' | '));
  var SETTINGS = readFile('venueplay/app/settings.html'), BILLING = readFile('venueplay/app/billing.html');
  check('settings: no copy of the permits code, and no musical bingo', SETTINGS.indexOf('PERMIT_KINDS') < 0 && SETTINGS.indexOf('function savePermit') < 0 && !/musical bingo counts/i.test(SETTINGS));
  check('settings: loads vp-permits.js and paints the BINGO permit through it', /<script src="vp-permits\.js"><\/script>/.test(SETTINGS) && /VPPermits\.paint\(\{ wrap:wrap, venue:ctx\.venue\|\|\{\}, kinds:\["bingo"\]/.test(SETTINGS));
  check('billing: loads vp-permits.js and paints the RAFFLE and MEMBERS DRAW permits through it, under Draws', /<script src="\/app\/vp-permits\.js"><\/script>/.test(BILLING) && /VPPermits\.paint\(\{ wrap: wrap, venue: rows\[0\], kinds: \["raffle", "members"\]/.test(BILLING) && BILLING.indexOf('function savePermit') < 0
        && BILLING.indexOf('id="drawPermits"') > BILLING.indexOf('id="tp-draws"') && BILLING.indexOf('id="drawPermits"') < BILLING.indexOf('<!-- /tp-draws -->'));
  check('the permits are saved by the shared code, to /account/permits, with the venue named', /fetch\(o\.worker \+ "\/account\/permits"/.test(PERMITS) && /"X-VP-Venue": o\.venueId/.test(PERMITS));
  finished = true;
})().catch(function (e) { print('  FAIL the test itself threw: ' + e + '\n' + e.stack); fails++; });
drainMicrotasks();
if (!finished) { print('  FAIL the test did not run to the end'); fails++; }
if (fails) throw new Error('permits and compliance tick: ' + fails + ' of ' + ran + ' failed');
print('PASS ' + ran + ' checks');
