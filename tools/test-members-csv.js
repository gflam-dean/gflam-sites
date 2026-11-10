/* THE MEMBERS LIST FILE READER AGAINST MESSY REAL-WORLD FILES (Dean, setup wizard round 12 note 10: "the column matching must REALLY match
   (name, member number, etc.), test it with messy real-world CSVs: different column names, extra columns, blank rows").

   venueplay/app/vp-memberscsv.js (VPMembersCsv) is run for real on the files in tools/fixtures/members-csv/: a club system's export with a
   title line and a visitor row, Mac Excel (lines end in a bare CR), a semicolon file with Excel's "sep=;" line, UTF-16 (little and big
   endian), no header at all, Windows-1252 names, a quoted field holding a new line, pipes, leading zeros, a mobile number column BEFORE
   the member number, a "Joined 2020" column, a column of nothing but numbers, a BOM with trailing blank lines, a status column first,
   odd headings, and a quote that never closes. Each must give the same "number, first last" lines, with the right count of rows left out.

   Run from the repo root:  jsc tools/test-members-csv.js */
var ran = 0, bad = 0;
function check(n, c, saw) { ran++; if (c) print('  ok   ' + n); else { bad++; print('  FAIL ' + n + (saw !== undefined ? '   saw: ' + String(typeof saw === 'string' ? saw : JSON.stringify(saw)).slice(0, 500) : '')); } }
function section(t) { print(''); print(t); }
var window = this;
if (typeof TextDecoder === 'undefined') this.TextDecoder = function (enc, o) { this.enc = String(enc).toLowerCase(); this.fatal = !!(o && o.fatal); };
if (!this.TextDecoder.prototype.decode) this.TextDecoder.prototype.decode = function (u) {
  var out = '', i = 0, e = this.enc;
  if (e === 'utf-16le' || e === 'utf-16be') { for (; i + 1 < u.length; i += 2) out += String.fromCharCode(e === 'utf-16le' ? u[i] | (u[i + 1] << 8) : (u[i] << 8) | u[i + 1]); return out; }
  if (e === 'utf-8') { while (i < u.length) { var c = u[i++]; if (c < 128) out += String.fromCharCode(c); else if (c >= 194 && c < 224 && (u[i] & 192) === 128) out += String.fromCharCode(((c & 31) << 6) | (u[i++] & 63)); else if (c >= 224 && c < 240 && (u[i] & 192) === 128 && (u[i + 1] & 192) === 128) { out += String.fromCharCode(((c & 15) << 12) | ((u[i] & 63) << 6) | (u[i + 1] & 63)); i += 2; } else if (this.fatal) throw new TypeError('invalid utf-8'); else out += '\ufffd'; } return out; }
  for (; i < u.length; i++) out += String.fromCharCode(u[i]); return out;
};
load('venueplay/app/vp-memberscsv.js');
var M = this.VPMembersCsv;
function file(name) { return readFile('tools/fixtures/members-csv/' + name, 'binary'); }
function read(name) { var t = M.decode(file(name)); return M.read(t); }
var GOOD = ['142, Jane Smith', '143, Sam Taylor', '2087, Minh Nguyen'];
function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

section('1. EACH MESSY FILE GIVES THE RIGHT MEMBERS');
var r = read('01-club-system.csv');
check('01 a club system: a title line, blank rows, a visitor with no number, extra columns (status, phone, email, joined), "Mem No" / "Given Names" / "Surname", a comma inside quotes', same(r.lines, ['142, Jane Smith', '143, Sam Taylor', '2087, Minh Nguyen Jr']) && r.skipped === 1, r);
check('01 the plan: header is the fourth line, member number = Mem No, first = Given Names, last = Surname', r.plan.hasHead && r.plan.heads[r.plan.ix.number] === 'Mem No' && r.plan.heads[r.plan.ix.first] === 'Given Names' && r.plan.heads[r.plan.ix.last] === 'Surname', r.plan.heads);
r = read('02-mac-excel-cr.csv'); check('02 Mac Excel: lines end in a bare CR, a blank line in the middle', same(r.lines, GOOD) && r.skipped === 0, r);
r = read('03-semicolon-sep-line.csv'); check('03 a semicolon file with Excel\'s "sep=;" first line, "Card #" / "Forename" / "Family name", a postcode column', same(r.lines, GOOD), r);
r = read('04-tab-utf16.txt'); check('04 UTF-16 little endian with a BOM and a name beyond Latin-1 (Nguyễn), tab separated, a single "Name" column and a Mobile column (never taken for the member number)', same(r.lines, ['142, Jane Smith', '143, Sam Taylor', '2087, Minh Nguy\u1ec5n']) && r.plan.ix.first === 1 && r.plan.ix.last === -1, r);
r = read('05-no-header.csv'); check('05 no header at all: the number is the column of short whole numbers, two single-word text columns are the names, email and mobile are left alone', same(r.lines, GOOD) && !r.plan.hasHead, r);
r = read('06-latin1-name.csv'); check('06 a Windows (Latin-1) file with José García', same(r.lines, ['142, José García', '143, Sam Taylor']), r);
r = read('07-quoted-newline.csv'); check('07 a quoted field holding a new line, and "Smith, Jr" with its comma', same(r.lines, ['142, Jane Smith Jr', '143, Sam Taylor']) && r.skipped === 0, r);
r = read('08-pipe.txt'); check('08 pipe separated', same(r.lines, ['142, Jane Smith', '143, Sam Taylor']), r);
r = read('09-leading-zeros.csv'); check('09 leading zeros kept as typed (the import turns 0142 into 142)', same(r.lines, ['0142, Jane Smith', '0143, Sam Taylor']), r);
r = read('10-mobile-first.csv'); check('10 a Mobile column BEFORE Member No: the member number is still Member No', same(r.lines, GOOD) && r.plan.heads[r.plan.ix.number] === 'Member No', r);
r = read('11-year-column.csv'); check('11 a "Joined" column of 2020s and the names in the order Surname, First', same(r.lines, GOOD) && r.plan.heads[r.plan.ix.number] === 'Number', r);
r = read('12-numbers-only.csv'); check('12 a file of nothing but numbers: all three are read, with no name', same(r.lines, ['142, ', '143, ', '2087, ']), r);
r = read('13-crlf-bom-trailing.csv'); check('13 Windows CRLF, a BOM, spaces round names, trailing blank and space-only lines', same(r.lines, ['142, Jane Smith', '143, Sam Taylor']) && r.skipped === 0, r);
r = read('14-status-first.csv'); check('14 Status first, "Membership No." in the middle, one "Member Name" column, a date of birth', same(r.lines, GOOD) && r.plan.heads[r.plan.ix.number] === 'Membership No.' && r.plan.ix.last === -1, r);
r = read('15-utf16-be-comma.csv'); check('15 UTF-16 big endian with a BOM, headings "No", "First Name", "Surname"', same(r.lines, ['142, Jane Smith', '143, Sam Taylor']), r);
r = read('16-odd-headings.csv'); check('16 "ID" and "Customer Name" with suburb and points columns (points are whole numbers too, and are not the member number)', same(r.lines, GOOD) && r.plan.heads[r.plan.ix.number] === 'ID', r);
r = read('17-unclosed-quote.csv'); check('17 a quote that never closes does not swallow the file', same(r.lines, ['142, Jane Smith', '143, Sam Taylor']), r);

r = read('18-mobile-first-no-header.csv'); check('18 no header and a mobile number in the first column: the shorter, unrepeated number after it is the member number', same(r.lines, GOOD) && r.plan.ix.number === 1, r);

section('2. THE PARTS');
check('Excel\'s sep= line is obeyed, not guessed round (a comma inside a semicolon file)', same(M.parse('sep=;\r\na,b;c\r\n1,5;2\r\n'), [['a,b', 'c'], ['1,5', '2']]));
check('the separator is worked out from the lines that agree, not one stray comma in a title', M.delim('Members, as at, today, ok\nNo;Name;Phone\n1;A;2\n2;B;3\n') === ';' && M.delim('a;b;c') === ';' && M.delim('a,b,c') === ',' && M.delim('a\tb') === '\t' && M.delim('"a;b",c,d') === ',' && M.delim('a|b|c\n1|2|3') === '|' && M.delim('142\n143') === ',');
check('every line ending reads the same file: CRLF, bare CR, LF, a mix', ['\r\n', '\r', '\n'].every(function (nl) { return same(M.read('Member No,Name' + nl + '1,A B' + nl + '2,C D' + nl).lines, ['1, A B', '2, C D']); }) && same(M.read('Member No,Name\r\n1,A B\r2,C D\n').lines, ['1, A B', '2, C D']));
check('blank rows, rows of only separators and rows of spaces are dropped before anything else', same(M.parse('a,b\n\n,,\n  ,  \nc,d\n'), [['a', 'b'], ['c', 'd']]));
check('a doubled quote inside quotes is one quote', same(M.parse('a,"say ""hi"""\n'), [['a', 'say "hi"']]));
check('UTF-16 without a BOM is still found (a zero byte every other byte)', M.decode(new Uint8Array([77, 0, 78, 0, 10, 0]).buffer) === 'MN\n');
check('UTF-16 big endian without a BOM too', M.decode(new Uint8Array([0, 77, 0, 78, 0, 10]).buffer) === 'MN\n');
check('an empty file has no rows and a plan that does not crash', same(M.parse(''), []) && M.plan([]).ix.number === 0 && M.read('').lines.length === 0);
check('a header with no member number column and no numbers anywhere gives no members (the screen then says so)', M.read('Name,Suburb\nJane,Southport\n').lines.length === 0);
check('the venue\'s own pick is what build uses (the plan is only a guess)', same(M.build(M.parse('A,B,C\n1,2,Jane\n3,4,Sam\n'), { number: 1, first: 2, last: -1 }, 1).lines, ['2, Jane', '4, Sam']));
check('a stray # on a number is dropped, spaces inside it too, and a long phone-sized number is not a member', same(M.build([['#142', 'Jane'], ['1 4 3', 'Sam'], ['0412345678901234', 'Phone']], { number: 0, first: 1, last: -1 }, 0).lines, ['142, Jane', '143, Sam']));
check('markup in a name never survives into the box (angle brackets and commas become spaces)', same(M.build([['1', '<b>Evil</b>, Co']], { number: 0, first: 1, last: -1 }, 0).lines, ['1, b Evil /b Co']));

section('3. THE BILLING PAGE USES IT');
var BILL = readFile('venueplay/app/billing.html');
check('billing.html loads vp-memberscsv.js before the page script and reads the chosen file through it', /<script src="vp-memberscsv\.js"><\/script>/.test(BILL) && /VPMembersCsv\.plan\(VPMembersCsv\.parse\(text\)\)/.test(BILL) && /VPMembersCsv\.decode\(buf\)/.test(BILL) && /VPMembersCsv\.build\(rows, ix, plan\.from\)/.test(BILL));
check('the old in-page guess (CSV_GUESS, csvDelim, csvRows) is gone, so the page and the tests cannot read a file two ways', !/CSV_GUESS|function csvDelim|function csvRows|function csvLines|function csvGuess|function csvDecode/.test(BILL));
check('the screen says how many rows were left out', /had no member number and/.test(BILL));
print(''); if (bad) print('FAIL ' + bad + ' of ' + ran); else print('ALL ' + ran + ' CHECKS PASSED');
