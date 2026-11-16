/* THE MEMBERS LIST UPLOAD KEEPS WHAT THE VENUE'S GAMES ASK FOR, AND NOTHING ELSE (Dean, 16 Nov 2026, Jobs row 445).

   Dean: "when a venue uploads its members spreadsheet it maps first name, surname, email and phone; a single full-name
   column must be split into first name + surname." And: "remember that setting from the first time they import members
   ... we should import the same data as they are asking from our system. So then if John signs up and his phone number
   matches what he's put into the game, we know John's a member."

   This RUNS the shipped code, it does not word-search it:
     1. venueplay/app/vp-memberscsv.js on messy real-world files (tools/fixtures/members-csv/19 and 20): an Excel CSV with a
        BOM and Excel's sep=; line, semicolons, quoted commas, one "Full Name" column, an email column, mobiles in every
        format a club system writes, a Subscribed column, and street address / DOB / State columns that are NOT imported
     2. the full-name split: "Daniel Lee", "Lee, Daniel", "LEE,Daniel" are sure; "Mary Anne Smith", one word, two commas
        are flagged for the venue to check on the same screen
     3. only the fields the venue's game join collects are offered, and the venue's column choices are remembered by heading
     4. the page's mobile rule and the game Worker's (praffleNormPhone, the purchase raffle's) give the same answer
     5. the game Worker's POST /host/members/import, out of venueplay-game.js: new members, the venue's collect settings as
        the gate, an existing member's details filled and never overwritten, an unsubscribe never turned back to a yes,
        consent only with a way to contact them, its source recorded, the column choices saved, a pasted list unchanged,
        and nothing added before migration 200
     6. the member match: a player's mobile against THIS venue's list only, in /capture and /join/list, never shown back
     7. never in a log: Postgres's "Failing row contains (...)" and "Key (...)=(...)" are cut out of dbError's line
     8. never on a screen or in HQ: the members console reads named columns, no HQ page names the new columns

   Run from the repo root:  jsc tools/test-members-upload.js */
var ran = 0, bad = 0;
function check(n, c, saw) { ran++; if (c) print('  ok   ' + n); else { bad++; print('  FAIL ' + n + (saw !== undefined ? '   saw: ' + String(typeof saw === 'string' ? saw : JSON.stringify(saw)).slice(0, 600) : '')); } }
function section(t) { print(''); print(t); }
function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
var window = this;
if (typeof TextDecoder === 'undefined') this.TextDecoder = function (enc, o) { this.enc = String(enc).toLowerCase(); this.fatal = !!(o && o.fatal); };
if (!this.TextDecoder.prototype.decode) this.TextDecoder.prototype.decode = function (u) {
  var out = '', i = 0;
  while (i < u.length) { var c = u[i++]; if (c < 128) out += String.fromCharCode(c); else if (c >= 194 && c < 224 && (u[i] & 192) === 128) out += String.fromCharCode(((c & 31) << 6) | (u[i++] & 63)); else if (c >= 224 && c < 240) { out += String.fromCharCode(((c & 15) << 12) | ((u[i] & 63) << 6) | (u[i + 1] & 63)); i += 2; } else if (this.fatal) throw new TypeError('bad'); else out += '�'; }
  return out;
};
load('venueplay/app/vp-memberscsv.js');
var M = this.VPMembersCsv;
var ALL = { email: true, mobile: true, postcode: true, offers: true };
function fileText(name) { return M.decode(readFile('tools/fixtures/members-csv/' + name, 'binary')); }

section('1. A MESSY EXCEL FILE: BOM, sep=;, semicolons, quoted commas, one Full Name column, email, mobiles, Subscribed');
var p19 = M.guess(M.parse(fileText('19-excel-bom-semicolon-fullname.csv')), ALL);
var h = function (f) { return p19.ix[f] >= 0 ? p19.heads[p19.ix[f]] : null; };
check('19 the columns: Member No, Full Name (one column), E-mail Address, Mobile Phone, Subscribed; no postcode column',
      h('number') === 'Member No' && h('full') === 'Full Name' && p19.ix.first === -1 && p19.ix.last === -1 && h('email') === 'E-mail Address' &&
      h('mobile') === 'Mobile Phone' && h('offers') === 'Subscribed' && p19.ix.postcode === -1, p19.ix);
check('19 street address, DOB and State are named as NOT imported', same(p19.notImported, ['Street Address', 'DOB', 'State']), p19.notImported);
var m19 = M.members(p19.rows, p19.ix, p19.from), by = {};
m19.members.forEach(function (m) { by[m.number] = m; });
check('19 five members, the visitor with no number left out', m19.members.length === 5 && m19.skipped === 1, m19);
check('19 "Lee, Daniel" (a quoted comma) -> Daniel / Lee, sure, email lower-cased, 0412 345 678 -> +61412345678, Yes',
      by[142].first_name === 'Daniel' && by[142].last_name === 'Lee' && by[142].sure && by[142].email === 'daniel.lee@example.com' && by[142].mobile === '+61412345678' && by[142].offers === true, by[142]);
check('19 "LEE,Daniel" -> Daniel / Lee (capitals made readable), +61 412 000 111 kept, Unsubscribed is a no',
      by[143].first_name === 'Daniel' && by[143].last_name === 'Lee' && by[143].sure && by[143].mobile === '+61412000111' && by[143].offers === false, by[143]);
check('19 "Mary Anne Smith" -> Mary Anne / Smith, but FLAGGED for the venue to check; "mary@example" is not an email and is left out, said so; 61498765432 kept',
      by[144].first_name === 'Mary Anne' && by[144].last_name === 'Smith' && !by[144].sure && !('email' in by[144]) &&
      by[144].problems.join('|').indexOf('Not an email, left out') >= 0 && by[144].mobile === '+61498765432' && by[144].offers === true, by[144]);
check('19 "Daniel Lee" -> Daniel / Lee; 498765433 (Excel dropped the 0) -> +61498765433; a blank Subscribed is "not said", never a yes',
      by[145].first_name === 'Daniel' && by[145].last_name === 'Lee' && by[145].sure && by[145].mobile === '+61498765433' && !('offers' in by[145]), by[145]);
check('19 "Cher" (one word) is flagged; a landline is not a mobile, left out and said so',
      by[146].first_name === 'Cher' && by[146].last_name === '' && !by[146].sure && !('mobile' in by[146]) && /Not an Australian mobile, left out: \(07\) 5228 3667/.test(by[146].problems.join('|')), by[146]);
check('19 two of five need a look (Mary Anne Smith, Cher)', m19.unsure === 2, m19.unsure);

var p20 = M.guess(M.parse(fileText('20-club-email-mobile-postcode.csv')), ALL), m20 = M.members(p20.rows, p20.ix, p20.from).members;
check('20 a club file with Surname / Given Names in two columns: first and last, not a full name', p20.ix.full === -1 && p20.heads[p20.ix.first] === 'Given Names' && p20.heads[p20.ix.last] === 'Surname', p20.ix);
check('20 SMITH / JANE -> Jane Smith, JANE@EXAMPLE.COM -> jane@example.com, 0412-345-678 -> +61412345678, postcode 4220, TRUE -> yes',
      same([m20[0].first_name, m20[0].last_name, m20[0].email, m20[0].mobile, m20[0].postcode, m20[0].offers], ['Jane', 'Smith', 'jane@example.com', '+61412345678', '4220', true]), m20[0]);
check('20 "O\'BRIEN, Jr" in the Surname column stays one surname (capitals made readable), "+61 (0)498 765 432" -> +61498765432, postcode 800 -> 0800 (Excel dropped the 0), FALSE -> no',
      m20[1].last_name === "O'Brien, Jr" && m20[1].mobile === '+61498765432' && m20[1].postcode === '0800' && m20[1].offers === false, m20[1]);
check('20 "412 555 666" -> +61412555666, no email, a blank opt-in is not said', m20[2].mobile === '+61412555666' && !('email' in m20[2]) && !('offers' in m20[2]), m20[2]);

section('2. THE FULL NAME SPLIT');
[['Daniel Lee', 'Daniel', 'Lee', true], ['Lee, Daniel', 'Daniel', 'Lee', true], ['LEE,Daniel', 'Daniel', 'Lee', true], ['  lee ,  daniel ', 'daniel', 'lee', true],
 ['Smith, Mary Anne', 'Mary Anne', 'Smith', true], ['Mary Anne Smith', 'Mary Anne', 'Smith', false], ['Ludwig van Beethoven', 'Ludwig', 'van Beethoven', false],
 ['Cher', 'Cher', '', false], ['Lee, Daniel, Jr', 'Lee Daniel', 'Jr', false], ['McDONALD, Ross', 'Ross', 'McDONALD', true], ['', '', '', false]].forEach(function (c) {
  var r = M.splitName(c[0]);
  check('"' + c[0] + '" -> ' + JSON.stringify(c[1]) + ' / ' + JSON.stringify(c[2]) + (c[3] ? ', sure' : ', flagged for the venue'), r.first === c[1] && r.last === c[2] && r.sure === c[3], r);
});
check('markup never survives a split', M.splitName('<b>Evil</b> Person').first.indexOf('<') < 0);

section('3. ONLY WHAT THE VENUE\'S GAMES ASK FOR, AND THE COLUMNS REMEMBERED');
var none = M.guess(M.parse(fileText('19-excel-bom-semicolon-fullname.csv')), {});
check('a venue that collects no email, mobile, postcode or offers: none of those columns is even guessed, and each is listed as not imported',
      none.ix.email === -1 && none.ix.mobile === -1 && none.ix.offers === -1 && none.notImported.indexOf('E-mail Address') >= 0 && none.notImported.indexOf('Mobile Phone') >= 0 && none.notImported.indexOf('Subscribed') >= 0, none.ix);
var mNone = M.members(none.rows, none.ix, none.from).members;
check('and no member carries an email, a mobile or an offers answer', mNone.every(function (m) { return !('email' in m) && !('mobile' in m) && !('offers' in m); }), mNone[0]);
var map = M.mapOf(p19, p19.ix);
check('the remembered choices are HEADINGS only, never a value from the file', map && map.v === 1 && same(Object.keys(map.cols).sort(), ['e mail address', 'full name', 'member no', 'mobile phone', 'subscribed']) && JSON.stringify(map).indexOf('@') < 0 && JSON.stringify(map).indexOf('0412') < 0, map);
var swapped = M.parse('Mobile Phone;Full Name;Member No;E-mail Address;Subscribed\n0412345678;Jo Bloggs;7;jo@x.com;Yes\n');
var back = M.applyMap(M.guess(swapped, ALL), map, ALL);
check('next month\'s file with the columns in another order: the saved choices land on the same headings', back.used && back.plan.heads[back.plan.ix.number] === 'Member No' && back.plan.heads[back.plan.ix.full] === 'Full Name' && back.plan.heads[back.plan.ix.mobile] === 'Mobile Phone', back.plan.ix);
var off = M.applyMap(M.guess(swapped, { email: true }), map, { email: true });
check('a saved choice for a field the venue no longer collects is dropped (mobile, offers)', off.plan.ix.mobile === -1 && off.plan.ix.offers === -1 && off.plan.ix.email >= 0, off.plan.ix);
check('a file with no headings remembers nothing', M.mapOf(M.guess(M.parse('7,Jo Bloggs\n8,Al Smith\n'), ALL), { number: 0, full: 1 }) === null);
var dnc = M.guess(M.parse('Member No,Name,Email,Do Not Contact\n7,Jo Bloggs,jo@x.com,Y\n8,Al Smith,al@x.com,N\n'), ALL), mdnc = M.members(dnc.rows, dnc.ix, dnc.from).members;
check('a "Do Not Contact" column is read the right way round: Y is a no, N is a yes', mdnc[0].offers === false && mdnc[1].offers === true, mdnc);
var dup = M.members([['7', 'Jo Bloggs'], ['7', 'Jo Again']], { number: 0, full: 1 }, 0);
check('the same member number twice in one file is flagged on the second', dup.members[1].sure === false && /twice/.test(dup.members[1].problems.join('')), dup);

section('4. THE PAGE AND THE GAME WORKER READ A MOBILE THE SAME WAY (one answer: the purchase raffle\'s)');
var src = readFile('venueplay-backend/worker/venueplay-game.js')
  .replace(/^export default/m, 'var _d =')
  .replace(/^export\s+(?=(async\s+)?(class|function|const|let|var)\b)/mg, '')
  .replace(/^export\s*\{[^}]*\}\s*;?/mg, '');
var LOGS = [];
console = { log: function (s) { LOGS.push(String(s)); } };
(0, eval)(src);
var MOBS = ['0412 345 678', '0412345678', '+61412345678', '+61 412 345 678', '61412345678', '412345678', '412 345 678', '+61 (0)412 345 678', '(04) 1234 5678',
            '04-1234-5678', '0412.345.678', '0733334444', '02 9999 9999', '1300 123 456', '+44 7700 900123', '041234567', '04123456789', '', null, 'call me', '0412 345 67x'];
var drift = MOBS.filter(function (x) { return M.mobile(x) !== memberMobile(x); });
check('every one of ' + MOBS.length + ' ways of writing a number gives the same answer on the page and in the Worker', drift.length === 0, drift.map(function (x) { return x + ': ' + M.mobile(x) + ' vs ' + memberMobile(x); }));
check('and the Worker\'s is the purchase raffle\'s rule (praffleNormPhone) underneath', memberMobile('0412 345 678') === praffleNormPhone('0412345678') && /function memberMobile\(raw\) \{ return praffleNormPhone\(/.test(src));

section('5. POST /host/members/import, out of the shipped game Worker');
var DB, CALLS, CFG, NO_COLS, BODY, STAFF, V1 = '11111111-1111-4111-8111-111111111111', V9 = '99999999-9999-4999-8999-999999999999';
var NEWCOLS = ['email', 'mobile', 'postcode', 'marketing_optin', 'marketing_optin_at', 'marketing_optin_source'];
function arm(o) {
  o = o || {};
  DB = { vp_member_rosters: [{ id: 'r1', venue_id: V1 }, { id: 'r9', venue_id: V9 }], vp_members: (o.members || []).map(function (m) { return JSON.parse(JSON.stringify(m)); }) };
  CALLS = []; CFG = o.cfg || { collect_email: true, collect_mobile: true, collect_postcode: true, collect_marketing_optin: true };
  NO_COLS = !!o.noCols; STAFF = o.staff || { role: 'owner' };
}
verifyHostJwt = function () { return Promise.resolve('u1'); };
readJson = function () { return Promise.resolve(JSON.parse(JSON.stringify(BODY))); };
requireStaff = function () { return Promise.resolve(STAFF); };
staffCan = function () { return true; };
venueCollectCfg = function (env, vid) { CALLS.push('cfg ' + vid); return Promise.resolve(CFG); };
function colsOk(q) { return !NO_COLS || !NEWCOLS.some(function (c) { return new RegExp('[,=]' + c + '(,|&|$)').test(q); }); }
sbGet = function (env, t, q) {
  CALLS.push('GET ' + t + '?' + q);
  if (!colsOk(q)) return Promise.reject(new Error('502'));
  if (t === 'vp_member_rosters') { var vid = (/venue_id=eq\.([^&]+)/.exec(q) || [])[1]; return Promise.resolve(DB.vp_member_rosters.filter(function (r) { return r.venue_id === vid; })); }
  if (t === 'vp_members') {
    var ids = ((/roster_id=in\.\(([^)]*)\)/.exec(q) || [])[1] || '').split(','), mob = (/mobile=eq\.([^&]+)/.exec(q) || [])[1];
    return Promise.resolve(DB.vp_members.filter(function (m) { return ids.indexOf(m.roster_id) >= 0 && (!mob || m.mobile === decodeURIComponent(mob)); }).slice(0, 1));
  }
  return Promise.resolve([]);
};
sbGetAll = function (env, t, q) {
  CALLS.push('GETALL ' + t + '?' + q);
  if (!colsOk(q)) return Promise.reject(new Error('502'));
  var rid = (/roster_id=eq\.([^&]+)/.exec(q) || [])[1];
  return Promise.resolve(DB.vp_members.filter(function (m) { return m.roster_id === rid; }));
};
sbInsert = function (env, t, rows) {
  rows = Array.isArray(rows) ? rows : [rows];
  CALLS.push('INSERT ' + t + ' ' + rows.length);
  if (NO_COLS && rows.some(function (r) { return NEWCOLS.some(function (c) { return c in r; }); })) return Promise.reject(new Error('502'));
  rows.forEach(function (r) { DB[t] = (DB[t] || []).concat([JSON.parse(JSON.stringify(r))]); });
  return Promise.resolve(null);
};
sbPatch = function (env, t, q, body) {
  CALLS.push('PATCH ' + t + '?' + q + ' ' + JSON.stringify(body));
  if (NO_COLS && (t === 'vp_member_rosters' || NEWCOLS.some(function (c) { return c in body; }))) return Promise.reject(new Error('502'));
  if (t === 'vp_member_rosters') { var id = (/id=eq\.([^&]+)/.exec(q) || [])[1]; DB.vp_member_rosters.forEach(function (r) { if (r.id === id) Object.assign(r, body); }); }
  return Promise.resolve();
};
/* vp_members_fill, the same statement as migration 200 written in JS: coalesce for the details, a yes only over a "not said" */
sbRpc = function (env, fn, a) {
  CALLS.push('RPC ' + fn + ' ' + a.p_rows.length);
  if (fn !== 'vp_members_fill') return Promise.reject(new Error('unexpected rpc ' + fn));
  var n = 0;
  a.p_rows.forEach(function (r) {
    DB.vp_members.forEach(function (m) {
      if (m.roster_id !== a.p_roster_id || m.member_number !== r.member_number) return;
      m.email = m.email || r.email; m.mobile = m.mobile || r.mobile; m.postcode = m.postcode || r.postcode;
      if (r.set_offers && r.offers === false && m.marketing_optin !== false) { m.marketing_optin = false; m.marketing_optin_source = a.p_source; }
      else if (r.set_offers && r.offers === true && m.marketing_optin == null && (m.email || m.mobile)) { m.marketing_optin = true; m.marketing_optin_source = a.p_source; }
      n++;
    });
  });
  return Promise.resolve(n);
};
var json = function (b, s) { return { status: s || 200, body: b }; };
function call(body) { BODY = body; var out = null; handleMembersImport({}, {}, json).then(function (r) { out = r; }, function (e) { out = { threw: String(e && e.message || e) }; }); drainMicrotasks(); return out; }
function mem(n) { return DB.vp_members.filter(function (m) { return m.member_number === n; })[0]; }

arm();
var up = m19.members.map(function (m) { var o = { number: m.number, first_name: m.first_name, last_name: m.last_name }; ['email', 'mobile', 'postcode', 'offers'].forEach(function (k) { if (k in m) o[k] = m[k]; }); return o; });
var r = call({ venue_id: V1, members: up, map: map });
check('file 19 through the Worker: 5 added to this venue\'s list', r.status === 200 && r.body.added === 5 && DB.vp_members.filter(function (m) { return m.roster_id === 'r1'; }).length === 5, r);
check('142 Daniel Lee: daniel.lee@example.com, +61412345678, offers yes from "members list import, <date>"',
      mem(142).email === 'daniel.lee@example.com' && mem(142).mobile === '+61412345678' && mem(142).marketing_optin === true && /^members list import, \d{4}-\d{2}-\d{2}$/.test(mem(142).marketing_optin_source), mem(142));
check('143 unsubscribed is kept as a no, with its source', mem(143).marketing_optin === false && /^members list import/.test(mem(143).marketing_optin_source), mem(143));
check('146 Cher: "No" stays a no, no mobile (a landline was never sent)', mem(146).marketing_optin === false && mem(146).mobile === null, mem(146));
check('the response carries counts only: no email or mobile goes back', JSON.stringify(r.body).indexOf('@') < 0 && JSON.stringify(r.body).indexOf('+614') < 0, r.body);
check('the column choices are saved with the list: headings only', same(DB.vp_member_rosters[0].import_map, map), DB.vp_member_rosters[0]);
check('the venue\'s own collect settings were read (the screen is not the gate)', CALLS.indexOf('cfg ' + V1) >= 0, CALLS);

arm({ cfg: { collect_email: true } });
r = call({ venue_id: V1, members: [{ number: 1, first_name: 'A', last_name: 'B', email: 'a@b.co', mobile: '0412345678', postcode: '4220', offers: true }] });
check('a venue that collects email only: the mobile, postcode and offers sent anyway are NOT kept', mem(1).email === 'a@b.co' && mem(1).mobile === null && mem(1).postcode === null && mem(1).marketing_optin === null, mem(1));
arm();
r = call({ venue_id: V1, members: [{ number: 2, first_name: 'A', last_name: 'B', email: 'not-an-email', mobile: '0733334444', postcode: '42', offers: true }] });
check('a bad email, a landline and a 2-digit postcode sent straight to the Worker are not kept', mem(2).email === null && mem(2).mobile === null && mem(2).postcode === null, mem(2));
check('and a "yes" with no way to contact them is not kept as consent (the gatedCapture rule)', mem(2).marketing_optin === null, mem(2));

arm({ members: [{ id: 'x', roster_id: 'r1', member_number: 10, first_name: 'Old', last_name: 'Name', email: 'keep@me.com', mobile: null, postcode: null, marketing_optin: false, marketing_optin_source: 'unsubscribed at the bar' },
                { id: 'y', roster_id: 'r1', member_number: 11, first_name: 'Ann', last_name: 'Lee', email: null, mobile: '+61400000001', postcode: '4000', marketing_optin: null }] });
r = call({ venue_id: V1, members: [{ number: 10, first_name: 'New', last_name: 'Person', email: 'other@x.com', mobile: '0412345678', offers: true },
                                     { number: 11, first_name: 'Ann', last_name: 'Lee', email: 'ann@x.com', mobile: '0499999999', postcode: '4220', offers: true }] });
check('members already on the list are not added again', r.body.added === 0 && r.body.skipped_existing === 2 && DB.vp_members.length === 2, r.body);
check('10: the name is NOT changed by an upload, the email is NOT overwritten, the empty mobile is filled', mem(10).first_name === 'Old' && mem(10).email === 'keep@me.com' && mem(10).mobile === '+61412345678', mem(10));
check('10: an unsubscribe is NEVER turned back into a yes by an upload, and its source stays', mem(10).marketing_optin === false && mem(10).marketing_optin_source === 'unsubscribed at the bar', mem(10));
check('11: the empty email is filled, the mobile and postcode kept, offers "not said" becomes yes from the import', mem(11).email === 'ann@x.com' && mem(11).mobile === '+61400000001' && mem(11).postcode === '4000' && mem(11).marketing_optin === true, mem(11));
check('the fills go in ONE database call (vp_members_fill), not one per member', CALLS.filter(function (c) { return /^RPC vp_members_fill 2$/.test(c); }).length === 1 && r.body.filled === 2, CALLS.filter(function (c) { return /^RPC|^PATCH vp_members\?/.test(c); }));
arm({ members: [{ id: 'z', roster_id: 'r1', member_number: 12, first_name: 'Z', last_name: 'Z', email: 'z@z.com', marketing_optin: true }] });
r = call({ venue_id: V1, members: [{ number: 12, first_name: 'Z', last_name: 'Z', offers: false }] });
check('an "Unsubscribed" in this month\'s file wins over last month\'s yes', mem(12).marketing_optin === false, mem(12));

arm({ noCols: true });
r = call({ venue_id: V1, members: [{ number: 142, name: 'Jane Smith' }, { number: 143, name: 'Mary Anne Smith' }] });
check('a pasted list before migration 200: added exactly as before, the name split on the first space, no new column named anywhere',
      r.status === 200 && r.body.added === 2 && mem(142).first_name === 'Jane' && mem(143).last_name === 'Anne Smith' && !CALLS.some(function (c) { return /email|mobile/.test(c); }), [r, CALLS]);
arm({ noCols: true });
r = call({ venue_id: V1, members: [{ number: 1, first_name: 'A', last_name: 'B', email: 'a@b.co' }] });
check('an upload WITH emails before migration 200: refused with words, and NOTHING is added (never a half import)', r.status === 503 && /Nothing was added/.test(r.body.error) && DB.vp_members.length === 0, r);
arm({ staff: { role: 'host' } });
r = call({ venue_id: V1, members: [{ number: 1, name: 'A B' }] });
check('a host (not a manager or owner) is refused', r.status === 403 && DB.vp_members.length === 0, r);
arm();
r = call({ venue_id: V1, members: [{ number: 5, first_name: 'A', last_name: 'B' }, { number: 5, first_name: 'C', last_name: 'D' }] });
check('the same number twice in one upload: the first is added, once', DB.vp_members.length === 1 && mem(5).first_name === 'A', DB.vp_members);
arm();
r = call({ venue_id: V1, members: [{ number: 6, first_name: 'A', last_name: 'B' }], map: { cols: { 'Mobile Phone': 'mobile', '<script>': 'bogus', 'Member No': 'number' } } });
check('a saved mapping keeps known fields only, by tidied heading', same(DB.vp_member_rosters[0].import_map, { v: 1, cols: { 'mobile phone': 'mobile', 'member no': 'number' } }), DB.vp_member_rosters[0].import_map);

section('6. THE MEMBER MATCH: a player\'s mobile against THIS venue\'s list only, never shown back');
arm({ members: [{ id: 'mem-1', roster_id: 'r1', member_number: 7, mobile: '+61412345678' }, { id: 'mem-9', roster_id: 'r9', member_number: 7, mobile: '+61498765432' }] });
var got = null; memberIdByMobile({}, V1, '0412 345 678').then(function (x) { got = x; }); drainMicrotasks();
check('0412 345 678 at this venue is member mem-1', got === 'mem-1', got);
got = 'x'; memberIdByMobile({}, V1, '0498 765 432').then(function (x) { got = x; }); drainMicrotasks();
check('another venue\'s member with that mobile is NOT a match here', got === null, got);
arm({ noCols: true });
got = 'x'; memberIdByMobile({}, V1, '0412345678').then(function (x) { got = x; }); drainMicrotasks();
check('before migration 200 the lookup fails closed to "not a member" (a join is never held up)', got === null, got);
/* /capture and /join/list RUN with a member's mobile */
arm({ members: [{ id: 'mem-1', roster_id: 'r1', member_number: 7, mobile: '+61412345678' }] });
abuseIpHash = function () { return Promise.resolve(null); }; rateLimit = function () { return Promise.resolve({ ok: true }); };
verifyPlayerToken = function () { return Promise.resolve(null); }; venueByCode = function () { return Promise.resolve(V1); };
CFG = { collect_first_name: true, collect_mobile: true, collect_email: true, collect_marketing_optin: true };
BODY = { code: 'ABCD', first_name: 'Jo', mobile: '0412 345 678' };
var capOut = null; handleCapture({}, {}, json).then(function (x) { capOut = x; }); drainMicrotasks();
var capRow = (DB.vp_captures || [])[0] || {};
check('/capture: the sign-up row is linked to the member (member_id), and the reply says only stored', capRow.member_id === 'mem-1' && same(capOut.body, { ok: true, stored: true }), [capRow, capOut]);
arm({ members: [{ id: 'mem-1', roster_id: 'r1', member_number: 7, mobile: '+61412345678' }] });
CFG = { collect_first_name: true, collect_mobile: true, collect_email: true, collect_marketing_optin: true };
BODY = { code: 'ABCD', first_name: 'Jo', mobile: '0499 111 222' };
handleCapture({}, {}, json); drainMicrotasks();
check('/capture: a mobile that is on nobody\'s list is not linked, and member_id is not even named', !('member_id' in ((DB.vp_captures || [])[0] || {})), DB.vp_captures);
arm({ members: [{ id: 'mem-1', roster_id: 'r1', member_number: 7, mobile: '+61412345678' }] });
CFG = { collect_mobile: true, collect_email: true, collect_marketing_optin: true };
sbGet = (function (old) { return function (env, t, q) { if (t === 'vp_sessions') return Promise.resolve([{ venue_id: V1 }]); return old(env, t, q); }; })(sbGet);
BODY = { code: 'ABCD', mobile: '+61 412 345 678', marketing_optin: true };
var jl = null; handleJoinList({ headers: { get: function () { return null; } } }, { RL: null }, json).then(function (x) { jl = x; }, function (e) { jl = { threw: String(e) }; }); drainMicrotasks();
var jlRow = (DB.vp_captures || [])[0] || {};
check('/join/list: a sign-up with no game on, by a member\'s mobile, is linked to the member; the reply is only ok/stored', jlRow.member_id === 'mem-1' && jl && jl.body && jl.body.ok === true && !('member_id' in jl.body), [jlRow, jl]);
/* /join is the busiest path: the match is made before the insert, and only a found member names the column */
var joinSrc = (src.split('async function handleJoin(')[1] || '').split('\nasync function ')[0];
check('/join: the member match runs on the player\'s gated mobile at the session\'s venue, before the insert, never for the demo',
      /if \(cap\.mobile && !isDemoSession\(session\)\) \{ const memberId = await memberIdByMobile\(env, session\.venue_id, cap\.mobile\); if \(memberId\) playerRow\.member_id = memberId; \}\s*let inserted;/.test(joinSrc), joinSrc.slice(0, 80));

section('7. NEVER IN A LOG');
errRef = function () { return 'E1'; };   // jsc has no crypto; the reference itself does not matter here
LOGS = [];
dbError('insert', 'vp_members', '{"code":"23514","details":"Failing row contains (abc, r1, 7, Jo, Lee, valid, null, 2026-11-19, jo@x.com, +61412345678, 4220).","message":"new row violates check constraint"}');
dbError('insert', 'vp_members', '{"code":"23505","details":"Key (roster_id, mobile)=(r1, +61412345678) already exists."}');
check('a refused row\'s email and mobile never reach the log', LOGS.length === 2 && LOGS.join(' ').indexOf('jo@x.com') < 0 && LOGS.join(' ').indexOf('+61412345678') < 0 && /Failing row contains \(\.\.\.\)/.test(LOGS[0]) && /Key \(roster_id, mobile\)=\(\.\.\.\)/.test(LOGS[1]), LOGS);
check('the error code is still there to look up', /23514/.test(LOGS[0]) && /check constraint/.test(LOGS[0]), LOGS[0]);

section('8. NEVER ON A SCREEN, NEVER IN HQ');
var HOST = readFile('venueplay/app/members/host.html');
var hostSel = (/client\.from\("vp_members"\)\.select\("([^"]*)"\)/.exec(HOST) || [])[1] || '';
check('the members console (beside the TV) names its columns: no "*", no email, mobile, postcode or consent', hostSel && hostSel !== '*' && !/email|mobile|postcode|marketing/.test(hostSel), hostSel);
var hq = ['venueplay/app/hq.html', 'venueplay/app/vp-coaster-hq.js', 'venueplay/app/vp-helpdesk-hq.js', 'venueplay/app/vp-logins-hq.js', 'venueplay/app/vp-prospects-hq.js',
  'venueplay/app/vp-reports-hq.js', 'venueplay/app/vp-subscribers-hq.js', 'venueplay/tv.html', 'venueplay/play.html', 'venueplay/app/members/screen.html'];
var named = [];
hq.forEach(function (f) { var t; try { t = readFile(f); } catch (e) { return; } if (/marketing_optin_source|import_map/.test(t) || /vp_members[^_][^\n]{0,200}(email|mobile)/.test(t)) named.push(f); });
check('no HQ page, TV or phone screen reads a member\'s email, mobile, consent source or the saved columns (' + hq.length + ' files)', named.length === 0, named);
var API = readFile('venueplay-backend/worker/venueplay-api-FULL.js');
var apiMem = API.split("vpaSelectAll(env, 'vp_members',").slice(1).map(function (t) { return t.slice(0, 160); });
check('the billing Worker (HQ\'s reports) reads vp_members for a count only: select=id', apiMem.length > 0 && apiMem.every(function (q) { return /select=id&/.test(q); }), apiMem);
var worker = src.split('\n');
check('the game Worker never logs a member\'s details (no console.log naming email or mobile near a member)', !worker.some(function (l) { return /console\.log\([^)]*\b(m|member|w|mem|row)\.(email|mobile)\b/.test(l); }));

print(''); if (bad) { print('FAIL ' + bad + ' of ' + ran); throw new Error('members upload: ' + bad + ' failed'); } else print('ALL ' + ran + ' CHECKS PASSED');
