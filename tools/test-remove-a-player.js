/* Somebody asks to be removed from a venue's players list. What happens, and who is told?

   Dean, 21 Sep 2026: "if the venue has downloaded it ... it emails a marketing inbox or something
   of theirs. if it hasnt been downloaded we just remove it."

   Runs the REAL /admin/player-find and /admin/player-remove handlers on tools/rig-billing-worker.js.
   Only the admin check is stood in for. What is asserted is the database afterwards and the
   email that did or did not go out, not the calls that were made.

   Run from the repo root:  jsc tools/test-remove-a-player.js
*/
load('tools/rig-billing-worker.js');
var fails = 0, ran = 0, finished = false, isAdmin = true;
function check(name, ok, saw) { ran++; if (ok) print('  ok   ' + name); else { print('  FAIL ' + name + (saw === undefined ? '' : '   saw: ' + JSON.stringify(saw))); fails++; } }
vpaRequireAdmin = async function () { return isAdmin ? { id: 'admin-1', label: 'Dean', role: 'owner' } : { error: 'Admins only.', status: 403 }; };

var MARG = 'Margaret@Example.com.au';
function world() {
  DB = {}; sent.length = 0;
  DB.venueplay_founding = [{ id: 'f1', contact_email: 'owner@royal.com.au', contact_name: 'Sam Smith' }, { id: 'f2', contact_email: 'boss@anchor.com.au', contact_name: 'Kim' }, { id: 'f3', contact_email: 'me@crown.com.au', contact_name: 'Lee' }];
  DB.vp_venues = [{ id: 'vRoyal', name: 'The Royal', founding_id: 'f1' }, { id: 'vAnchor', name: 'The Anchor', founding_id: 'f2' }, { id: 'vCrown', name: 'The Crown', founding_id: 'f3' }];
  DB.vp_sessions = [{ id: 's1', venue_id: 'vRoyal' }, { id: 's2', venue_id: 'vAnchor' }, { id: 's3', venue_id: 'vCrown' }];
  DB.vp_players = [
    { id: 'p1', session_id: 's1', display_name: 'Marg', first_name: 'Margaret', last_name: 'Jones', email: MARG, mobile: '0412 345 678', postcode: '2000', marketing_optin: true, marketing_optin_at: '2026-08-10T10:00:00Z' },
    { id: 'p2', session_id: 's2', display_name: 'Marg', first_name: 'Margaret', last_name: 'Jones', email: 'margaret@example.com.au', mobile: null, postcode: '2000', marketing_optin: true, marketing_optin_at: '2026-08-10T10:00:00Z' },
    { id: 'p9', session_id: 's1', display_name: 'Meg', first_name: 'Meg', last_name: 'Other', email: 'margaretX@example.com.au', mobile: '0412 345 679', postcode: '2000', marketing_optin: true, marketing_optin_at: '2026-08-10T10:00:00Z' }];
  DB.vp_captures = [
    { id: 'c3', venue_id: 'vCrown', player_id: null, first_name: 'Margaret', last_name: 'Jones', email: 'MARGARET@EXAMPLE.COM.AU', mobile: '+61 412 345 678', postcode: '2000', marketing_optin: true, marketing_optin_at: '2026-08-10T10:00:00Z' }];
  DB.vp_admin_audit = [
    { id: 'a1', action: 'optin_exported', target: 'account:f1', created_at: '2026-09-01T09:00:00Z' },            // The Royal: downloaded AFTER she joined
    { id: 'a2', action: 'optin_exported', target: 'account:f2', created_at: '2026-08-01T09:00:00Z' }];           // The Anchor: downloaded BEFORE she joined. The Crown: never.
}
function row(t, id) { return DB[t].filter(function (r) { return r.id === id; })[0]; }
function named(r) { return !!(r.email || r.mobile || r.first_name || r.last_name); }
async function call(fn, body) { var r = await fn(REQ(body), ENV, J); return r; }

(async function () {
  print('finding her');
  world();
  var f = await call(vpaHandlePlayerFind, { q: 'margaret@example.com.au' });
  var byName = {}; (f.body.venues || []).forEach(function (v) { byName[v.venue_name] = v; });
  check('she is found at all three venues, however she capitalised it', Object.keys(byName).length === 3, f.body);
  check('The Royal is flagged as having downloaded since she joined', !!byName['The Royal'].downloaded_at, byName['The Royal']);
  check('The Anchor downloaded BEFORE she joined, so she is not in that file', byName['The Anchor'].downloaded_at === null, byName['The Anchor']);
  check('The Crown has never downloaded', byName['The Crown'].downloaded_at === null, byName['The Crown']);
  check('looking changes nothing and emails nobody', named(row('vp_players', 'p1')) && sent.length === 0);
  var fm = await call(vpaHandlePlayerFind, { q: '+61 412 345 678' });
  check('the same search by MOBILE, typed another way, finds the two venues that hold it', (fm.body.venues || []).map(function (v) { return v.venue_name; }).join() === 'The Crown,The Royal', fm.body.venues);

  print('removing her everywhere');
  var r = await call(vpaHandlePlayerRemove, { q: 'margaret@example.com.au' });
  check('every record of her is blanked', !named(row('vp_players', 'p1')) && !named(row('vp_players', 'p2')) && !named(row('vp_captures', 'c3')), [row('vp_players', 'p1'), row('vp_captures', 'c3')]);
  check('and she is no longer opted in to anything', row('vp_players', 'p1').marketing_optin === false && row('vp_captures', 'c3').marketing_optin === false);
  check('the rows themselves stay, because the head count is a billing record', DB.vp_players.length === 3 && row('vp_players', 'p1').display_name === 'Marg');
  check('MEG, one letter and one digit away, is untouched', row('vp_players', 'p9').email === 'margaretX@example.com.au' && row('vp_players', 'p9').mobile === '0412 345 679', row('vp_players', 'p9'));
  check('exactly ONE venue is emailed: the one that downloaded after she joined', sent.length === 1 && sent[0].to[0] === 'owner@royal.com.au', sent.map(function (m) { return m.to[0]; }));
  var mail = sent[0] ? String(sent[0].html).replace(/<[^>]*>/g, ' ') : '';
  check('the email says who, which venue, and to delete her from their own copy', /margaret@example\.com\.au/.test(mail) && /The Royal/.test(mail) && /delete them from that file/i.test(mail), mail.slice(0, 200));
  check('and names the day they downloaded it', /1 September 2026/.test(mail), mail);
  check('no em dash in it', mail.indexOf('—') === -1);
  var audits = DB.vp_admin_audit.filter(function (a) { return a.action === 'player_removed'; });
  check('each venue gets an audit row, and none of them holds her address in full', audits.length === 3 && JSON.stringify(audits).toLowerCase().indexOf('margaret@') === -1, audits.map(function (a) { return a.detail; }));
  check('the audit says which venue had downloaded and was emailed', audits.filter(function (a) { return a.detail.venue_had_downloaded && a.detail.venue_emailed === 'sent'; }).length === 1);
  var again = await call(vpaHandlePlayerRemove, { q: 'margaret@example.com.au' });
  check('asking again finds nothing and emails nobody twice', again.body.removed === 0 && sent.length === 1, [again.body, sent.length]);

  print('one venue only');
  world();
  await call(vpaHandlePlayerRemove, { q: MARG, venue_id: 'vCrown' });
  check('only that venue is cleared', !named(row('vp_captures', 'c3')) && named(row('vp_players', 'p1')) && named(row('vp_players', 'p2')));
  check('and no venue is emailed, because The Crown never downloaded', sent.length === 0, sent.length);

  print('the database is asked loosely, so every row is checked exactly');
  world();
  /* These two ARE returned by the loose search: a mobile with the same digits in order plus one
     more, and an address where her underscore is somebody else's letter. Neither is her. */
  DB.vp_captures.push({ id: 'cNear', venue_id: 'vCrown', first_name: 'Nora', last_name: 'Near', email: 'nora@x.com.au', mobile: '0412 345 6798', postcode: '2000', marketing_optin: true, marketing_optin_at: '2026-08-10T10:00:00Z' });
  DB.vp_players.push({ id: 'pNear', session_id: 's1', display_name: 'Nora', first_name: 'Nora', last_name: 'Near', email: 'nora@x.com.au', mobile: '0412 345 6798', postcode: '2000', marketing_optin: true, marketing_optin_at: '2026-08-10T10:00:00Z' });
  DB.vp_captures.push({ id: 'cUnder', venue_id: 'vCrown', first_name: 'Mo', last_name: 'Other', email: 'moXsmith@example.com.au', mobile: null, postcode: '2000', marketing_optin: true, marketing_optin_at: '2026-08-10T10:00:00Z' });
  await call(vpaHandlePlayerRemove, { q: '0412 345 678' });
  check('Margaret is removed by her mobile', !named(row('vp_players', 'p1')) && !named(row('vp_captures', 'c3')));
  check('NORA, whose number has the same digits and one more, is untouched in both tables', named(row('vp_captures', 'cNear')) && named(row('vp_players', 'pNear')), [row('vp_captures', 'cNear'), row('vp_players', 'pNear')]);
  await call(vpaHandlePlayerRemove, { q: 'mo_smith@example.com.au' });
  check('mo_smith is asked for, and moXsmith is NOT deleted in her place', named(row('vp_captures', 'cUnder')), row('vp_captures', 'cUnder'));

  print('who may do this, and with what');
  world(); isAdmin = false;
  var no = await call(vpaHandlePlayerRemove, { q: MARG });
  check('not an HQ admin: refused, and nothing changes', no.status === 403 && named(row('vp_players', 'p1')), no);
  isAdmin = true;
  var part = await call(vpaHandlePlayerRemove, { q: 'margaret' });
  check('half an address is refused rather than matched loosely', part.status === 400 && named(row('vp_players', 'p1')), part);
  var wild = await call(vpaHandlePlayerRemove, { q: '%@example.com.au' });
  check('a wildcard is a character, not a net: nobody is removed', (wild.body.removed || 0) === 0 && named(row('vp_players', 'p1')) && named(row('vp_players', 'p9')), wild.body);
  FAIL['vp_players:GET'] = 1;
  var down = await call(vpaHandlePlayerRemove, { q: MARG });
  check('if the search itself fails, it says so and removes nothing', down.status === 503 && named(row('vp_captures', 'c3')), down);
  finished = true;
})().catch(function (e) { print('  FAIL the test itself threw: ' + e + '\n' + e.stack); fails++; });
drainMicrotasks();
if (!finished) { print('  FAIL the test did not run to the end'); fails++; }
if (fails) throw new Error('remove a player: ' + fails + ' of ' + ran + ' failed');
print('PASS ' + ran + ' checks');
