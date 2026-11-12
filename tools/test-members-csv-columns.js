/* THE LEFT VENUE'S "DOWNLOAD MEMBERS LIST" NAMES ONLY REAL COLUMNS (12 Nov 2026, INBOX 278).

   The release of 12 Nov shipped downloadMembers() (venueplay/app/billing.html, from dbfc21ef) asking vp_members for
   "number" and ordering by it. The column is member_number. PostgREST rejects the whole statement for an unknown
   column, so the button said "Could not download your members list" to every venue that had left. The gate's live
   half caught it after the push; nothing local did.

   This RUNS the page's own downloadMembers, lifted by name from billing.html, against a stand-in database that
   answers the way PostgREST does: a select, filter or order naming a column the table does not have is an error
   (42703), and the whole read fails. The table's columns come from venueplay-backend/supabase/COLUMNS-BASELINE.json,
   written from the live database by venueplay-backend/tools/dump-rls-baseline.py, never typed in here.
     1. the baseline itself: vp_members has member_number and no "number" (so the stand-in is the real shape)
     2. every column the download names is a real column of its table
     3. the file: the header "Member number,First name,Surname", one row per member of THIS venue only, in member
        number order, a comma or quote in a name kept intact
     4. a long list is paged to the end (2,050 members, three pages of 1,000)
     5. a venue with nobody on its list is told so, and no file is made

   Run from the repo root:  jsc tools/test-members-csv-columns.js */
var ran = 0, bad = 0;
function check(n, c, saw) { ran++; if (c) print('  ok   ' + n); else { bad++; print('  FAIL ' + n + (saw !== undefined ? '   saw: ' + JSON.stringify(saw).slice(0, 400) : '')); } }

var COLS = JSON.parse(readFile('venueplay-backend/supabase/COLUMNS-BASELINE.json'));

print('1. the baseline the stand-in is built from');
check('COLUMNS-BASELINE.json lists vp_members with member_number, first_name, last_name, roster_id',
      ['member_number', 'first_name', 'last_name', 'roster_id', 'id'].every(function (c) { return (COLS.vp_members || []).indexOf(c) >= 0; }), COLS.vp_members);
check('vp_members has no column called "number" (the name that shipped)', (COLS.vp_members || []).indexOf('number') < 0, COLS.vp_members);

/* A PostgREST stand-in: every column named must be in COLS[table], or the read is an error. */
var DB = {}, NAMED = [], ERRORS = [];
function colErr(t, c) { var e = { code: '42703', message: 'column ' + t + '.' + c + ' does not exist' }; ERRORS.push(e.message); return e; }
function Q(t) { this.t = t; this.sel = null; this.f = []; this.ord = []; this.r = null; }
Q.prototype.select = function (s) { this.sel = String(s); return this; };
Q.prototype.eq = function (k, v) { this.f.push([k, function (x) { return x === v; }]); return this; };
Q.prototype.in = function (k, vs) { this.f.push([k, function (x) { return vs.indexOf(x) >= 0; }]); return this; };
Q.prototype.order = function (k, o) { this.ord.push({ k: k, asc: !(o && o.ascending === false) }); return this; };
Q.prototype.range = function (a, b) { this.r = [a, b]; return this; };
Q.prototype.run = function () {
  var t = this.t, known = COLS[t];
  if (!known) return { data: null, error: { code: '42P01', message: 'relation ' + t + ' does not exist' } };
  var picks = (this.sel || '*').split(',').map(function (p) {
    p = p.trim(); var i = p.indexOf(':'); return i >= 0 ? { as: p.slice(0, i), col: p.slice(i + 1) } : { as: p, col: p };
  });
  var named = picks.map(function (p) { return p.col; }).concat(this.f.map(function (f) { return f[0]; }), this.ord.map(function (o) { return o.k; }));
  for (var i = 0; i < named.length; i++) {
    NAMED.push(t + '.' + named[i]);
    if (named[i] !== '*' && known.indexOf(named[i]) < 0) return { data: null, error: colErr(t, named[i]) };
  }
  var rows = (DB[t] || []).filter(function (x) { return this.f.every(function (f) { return f[1](x[f[0]]); }); }, this);
  var ord = this.ord;
  rows.sort(function (a, b) {
    for (var j = 0; j < ord.length; j++) { var x = a[ord[j].k], y = b[ord[j].k]; if (x < y) return ord[j].asc ? -1 : 1; if (x > y) return ord[j].asc ? 1 : -1; }
    return 0;
  });
  if (this.r) rows = rows.slice(this.r[0], this.r[1] + 1);
  return { data: rows.map(function (x) { var o = {}; picks.forEach(function (p) { if (p.col === '*') Object.assign(o, x); else o[p.as] = x[p.col]; }); return o; }), error: null };
};
Q.prototype.then = function (ok, no) { return Promise.resolve(this.run()).then(ok, no); };
var CLIENT = { from: function (t) { return new Q(t); } };

/* The page's own function, lifted by name from its last script, with the page's globals stood in. */
var HTML = readFile('venueplay/app/billing.html');
var SCRIPT = (function () { var all = HTML.split('<script>'), last = all[all.length - 1]; return last.slice(0, last.indexOf('</script>')); })();
function lift(name) { var at = SCRIPT.indexOf('\n  function ' + name + '('); if (at < 0) return null; var end = SCRIPT.indexOf('\n  }\n', at + 1); return SCRIPT.slice(at + 1, end + 4); }
var SRC = lift('downloadMembers');
check('billing.html still has downloadMembers() to test', !!SRC);

var MSGS = [], FILES = [], BTN = { disabled: false };
var PAGE_ENV = {
  VP: { getClient: function () { return CLIENT; } },
  $: function (id) { return id === 'leftMembersCsv' ? BTN : null; },
  showMsg: function (m) { MSGS.push(m); },
  Blob: function (parts, o) { this.text = parts.join(''); this.type = o && o.type; },
  URL: { createObjectURL: function (b) { FILES.push(b); return 'blob:' + FILES.length; } },
  document: { createElement: function () { return { click: function () { this.clicked = true; FILES[FILES.length - 1].name = this.download; } }; },
              body: { appendChild: function () {}, removeChild: function () {} } }
};
var downloadMembers = new Function('VP', '$', 'showMsg', 'Blob', 'URL', 'document', 'mdCurrent', 'pageVenueId',
  SRC + '\nreturn downloadMembers;')(PAGE_ENV.VP, PAGE_ENV.$, PAGE_ENV.showMsg, PAGE_ENV.Blob, PAGE_ENV.URL, PAGE_ENV.document, 'v1', 'v1');

function press() {
  MSGS = []; FILES = []; NAMED = []; ERRORS = [];
  downloadMembers();
  for (var i = 0; i < 400; i++) drainMicrotasks();
  return FILES.length ? FILES[0] : null;
}

var V1_ROSTERS = [{ id: 'r1', venue_id: 'v1', name: 'Members' }, { id: 'r2', venue_id: 'v1', name: 'Life members' }];
DB.vp_member_rosters = V1_ROSTERS.concat([{ id: 'r9', venue_id: 'v9', name: 'Another venue' }]);
DB.vp_members = [
  { id: 'm3', roster_id: 'r1', member_number: '1010', first_name: 'Ann', last_name: 'Lee', status: 'active' },
  { id: 'm1', roster_id: 'r2', member_number: '1001', first_name: 'Bob, Jr', last_name: 'O"Neil', status: 'active' },
  { id: 'm2', roster_id: 'r1', member_number: '1002', first_name: 'Cat', last_name: 'Ng', status: 'active' },
  { id: 'm9', roster_id: 'r9', member_number: '1000', first_name: 'Not', last_name: 'Ours', status: 'active' }
];

print('');
print('2 and 3. one press of Download members list');
var f = press();
var unknown = NAMED.filter(function (n) { var p = n.split('.'); return (COLS[p[0]] || []).indexOf(p[1]) < 0; });
check('every column the download names is a real column of its table (' + NAMED.filter(function (n, i) { return NAMED.indexOf(n) === i; }).join(', ') + ')',
      NAMED.length > 0 && unknown.length === 0 && ERRORS.length === 0, { unknown: unknown, errors: ERRORS });
check('no "could not download" message', MSGS.length === 0, MSGS);
check('a file is made, members-list.csv, text/csv', !!f && f.name === 'members-list.csv' && f.type === 'text/csv', f);
var lines = f ? f.text.split('\n') : [];
check('the header is "Member number,First name,Surname"', lines[0] === 'Member number,First name,Surname', lines[0]);
check('one row per member of this venue, from both its lists, in member number order, another venue\'s member left out',
      f && f.text === 'Member number,First name,Surname\n1001,"Bob, Jr","O""Neil"\n1002,Cat,Ng\n1010,Ann,Lee\n', f && f.text);
check('the button is usable again afterwards', BTN.disabled === false);

print('');
print('4. a long list is paged to the end');
DB.vp_members = [];
for (var n = 0; n < 2050; n++) DB.vp_members.push({ id: 'p' + n, roster_id: n % 2 ? 'r1' : 'r2', member_number: String(100000 + n), first_name: 'F' + n, last_name: 'L' + n });
var big = press(), bl = big ? big.text.trim().split('\n') : [];
check('2,050 members give 2,050 rows (three pages of 1,000)', bl.length === 2051, bl.length);
check('first and last rows are the lowest and highest member numbers', bl[1] === '100000,F0,L0' && bl[2050] === '102049,F2049,L2049', [bl[1], bl[2050]]);

print('');
print('5. nobody on the list');
DB.vp_members = [];
var none = press();
check('no file is made and the venue is told "There is nobody on your members list."', !none && MSGS[0] === 'There is nobody on your members list.', [none, MSGS]);

if (bad) throw new Error('members csv columns: ' + bad + ' of ' + ran + ' failed');
print('');
print('ALL ' + ran + ' CHECKS PASSED');
