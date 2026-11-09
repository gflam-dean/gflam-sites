/* READING A MEMBERS LIST FILE (Dean, setup wizard round 12 note 10: "the column matching must REALLY match, test it with messy
   real-world CSVs: different column names, extra columns, blank rows").

   A club system or Excel makes the file; this works out, from the file itself and never from a fixed layout:
     decode   the bytes to text: UTF-8 (with or without a BOM), UTF-16 either way round (Excel "Unicode Text"), else Windows-1252
     parse    every line ending (CRLF, a bare CR from Excel on a Mac, LF), the separator (comma, semicolon, tab, pipe, or a
              "sep=;" first line), quoted fields (a comma, a separator or a new line inside quotes stays in the field), and
              blank rows or rows of nothing but separators are dropped
     plan     which row is the header (a title line above it is skipped; none at all is fine), and which column is the
              MEMBER NUMBER, the FIRST NAME and the LAST NAME. The header's words decide first ("Mem No", "Membership
              Number", "Card #", "Given names", "Surname", "Family name", a single "Name"); the values decide when the words
              do not (the member number is the column of short whole numbers that do not repeat; phone numbers, years and
              dates are never taken for it). The venue can still pick another column on the screen.
     build    "142, Jane Smith" one a line for the box on the Account page, and how many rows were left out (no member number)
   Used by venueplay/app/billing.html (the Members draws card) and checked by tools/test-wizard-r12.js with real-looking files in
   tools/fixtures/members-csv/. No em dashes. A member list is personal information: nothing here is sent anywhere. */
(function (root) {
  "use strict";
  function decode(buf) {
    var u = new Uint8Array(buf), enc = "utf-8", skip = 0;
    if (u.length >= 3 && u[0] === 0xEF && u[1] === 0xBB && u[2] === 0xBF) { skip = 3; }
    else if (u.length >= 2 && u[0] === 0xFF && u[1] === 0xFE) { enc = "utf-16le"; skip = 2; }
    else if (u.length >= 2 && u[0] === 0xFE && u[1] === 0xFF) { enc = "utf-16be"; skip = 2; }
    else if (u.length >= 4 && u[1] === 0 && u[3] === 0 && u[0] !== 0) { enc = "utf-16le"; }
    else if (u.length >= 4 && u[0] === 0 && u[2] === 0 && u[1] !== 0) { enc = "utf-16be"; }
    var body = skip ? u.subarray(skip) : u;
    try { return new TextDecoder(enc, { fatal: true }).decode(body); }
    catch (e) { try { return new TextDecoder("windows-1252").decode(body); } catch (e2) { var o = ""; for (var i = 0; i < body.length; i++) o += String.fromCharCode(body[i]); return o; } }
  }
  var SEPS = [",", ";", "\t", "|"];
  /* the separator that gives the same number of cells on the most lines (a title line with one stray comma loses to the real header and rows) */
  function delim(text) {
    var lines = String(text || "").replace(/^﻿/, "").split(/\r\n|\r|\n/).filter(function (l) { return l.trim(); }).slice(0, 12);
    if (!lines.length) return ",";
    var best = ",", bestScore = -1;
    SEPS.forEach(function (d) {
      var counts = lines.map(function (line) { var n = 0, q = false; for (var i = 0; i < line.length; i++) { var c = line.charAt(i); if (c === '"') q = !q; else if (!q && c === d) n++; } return n; });
      var tally = {}; counts.forEach(function (n) { if (n > 0) tally[n] = (tally[n] || 0) + 1; });
      var mode = 0, modeLines = 0; Object.keys(tally).forEach(function (k) { if (tally[k] > modeLines || (tally[k] === modeLines && +k > mode)) { mode = +k; modeLines = tally[k]; } });
      var score = modeLines * 100 + mode;
      if (score > bestScore) { bestScore = score; best = d; }
    });
    return bestScore > 0 ? best : ",";
  }
  function split(t, d, quotes) {
    var rows = [], row = [], cur = "", inQ = false, n = t.length, i, ch;
    for (i = 0; i < n; i++) {
      ch = t.charAt(i);
      if (inQ) { if (ch === '"') { if (t.charAt(i + 1) === '"') { cur += '"'; i++; } else inQ = false; } else cur += ch; continue; }
      if (quotes && ch === '"' && cur.trim() === "") { inQ = true; cur = ""; continue; }   // a quote opens a field only at the front of it
      if (ch === d) { row.push(cur); cur = ""; continue; }
      if (ch === "\r" || ch === "\n" || ch === " " || ch === " ") { if (ch === "\r" && t.charAt(i + 1) === "\n") i++; row.push(cur); cur = ""; rows.push(row); row = []; continue; }
      cur += ch;
    }
    row.push(cur); rows.push(row);
    return { rows: rows, open: inQ };
  }
  function clean(rows) {
    return rows.map(function (r) { return r.map(function (c) { return String(c == null ? "" : c).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim(); }); })
      .filter(function (r) { return r.some(function (c) { return c; }); });   // blank rows, and rows of nothing but separators
  }
  function parse(text) {
    var t = String(text || "").replace(/^﻿/, ""), d = null;
    var m = /^\s*sep=(.)[ \t]*(\r\n|\r|\n)/i.exec(t);   // Excel's own "which separator" line
    if (m) { d = m[1]; t = t.slice(m[0].length); }
    if (!d) d = delim(t);
    var r = split(t, d, true);
    if (r.open) r = split(t, d, false);   // a quote that never closes: read the file without quote rules rather than lose it all in one cell
    return clean(r.rows);
  }

  var DIGITS = /^#?\s*\d{1,12}$/;
  function numCell(c) { return DIGITS.test(String(c || "").replace(/\s+/g, "")); }
  function norm(h) { return String(h == null ? "" : h).toLowerCase().replace(/[^a-z0-9#]+/g, " ").trim(); }
  /* which row is the header: the last text-only row of two or more cells before the first row that has a member-number-looking cell */
  function headerRow(rows) {
    var head = -1;
    for (var i = 0; i < Math.min(rows.length, 15); i++) {
      var r = rows[i], filled = r.filter(function (c) { return c; }).length;
      if (r.some(numCell)) return head;
      if (filled >= 2) head = i;
    }
    return head;
  }
  var NUM_STRONG = /(^| )(member|membership|mem|card|badge|patron|account)( )?(no|num|number|nbr|nr|id|code|#)( |$)|^(member|membership|mem)(no|num|number|id)$|^#$/;
  var NUM_PLAIN = /^(no|num|number|nbr|nr|id|code|#)$/;
  var NUM_BAD = /phone|mobile|tel|postcode|post code|zip|dob|birth|date|age|year|amount|point|balance|status|type|class|categor|email|expir|since|joined|price|fee|name|suburb|state|street|address/;
  var FIRST = /(^| )(first|given|forename|fore|christian|preferred)( |$)/;
  var LAST = /(^| )(last|surname|sur|family|lastname)( |$)|^(lastname|surname|familyname)$/;
  var FULL = /^(full )?names?$|^(member|customer|patron|members) names?$|^fullname$/;
  function col(rows, i) { return rows.map(function (r) { return r[i] == null ? "" : r[i]; }); }
  function stats(vals) {
    var filled = vals.filter(function (v) { return v; }), n = filled.length || 1, seen = {}, uniq = 0, digit = 0, phone = 0, text = 0, at = 0, space = 0, long_ = 0;
    filled.forEach(function (v) {
      var d = v.replace(/\s+/g, "").replace(/^#/, "");
      if (!seen[v]) { seen[v] = 1; uniq++; }
      if (/^\d+$/.test(d)) { digit++; if (d.length >= 9 || /^04/.test(d)) phone++; }
      if (/[a-z]/i.test(v)) text++;
      if (/@/.test(v)) at++;
      if (/\s/.test(v)) space++;
      if (v.length > 24) long_++;
    });
    return { n: filled.length, digit: digit / n, uniq: uniq / n, phone: phone / n, text: text / n, at: at / n, space: space / n, long: long_ / n };
  }
  /* the plan for a parsed file: { rows, head, heads, ix: {number, first, last}, from, hasHead } */
  function plan(rows) {
    rows = rows || [];
    var head = headerRow(rows), from = head >= 0 ? head + 1 : 0;
    var data = rows.slice(from, from + 300), width = rows.reduce(function (m, r) { return Math.max(m, r.length); }, 0);
    var names = [], k;
    for (k = 0; k < width; k++) names.push(head >= 0 ? norm(rows[head][k]) : "");
    var st = []; for (k = 0; k < width; k++) st.push(stats(col(data, k)));
    /* THE MEMBER NUMBER: the header's words, checked against the values */
    var best = -1, bestScore = -1e9;
    for (k = 0; k < width; k++) {
      var h = names[k], s = st[k], hs = 0;
      if (h) { if (NUM_STRONG.test(h)) hs = 3; else if (NUM_PLAIN.test(h)) hs = 2; else if (/member|membership|card|badge|patron/.test(h) && !NUM_BAD.test(h)) hs = 1; else if (NUM_BAD.test(h)) hs = -4; }
      var cs = (s.digit >= 0.8 ? 2 : (s.digit >= 0.5 ? 1 : -3)) + (s.uniq >= 0.9 ? 1 : (s.uniq >= 0.6 ? 0 : -2)) - (s.phone >= 0.5 ? 5 : 0) - (s.at > 0 ? 3 : 0);
      var score = hs * 3 + cs - k * 0.01;   // the leftmost wins a tie
      if (s.n && score > bestScore) { bestScore = score; best = k; }
    }
    if (best < 0) best = 0;
    /* THE NAMES: by their words first */
    var first = -1, last = -1, full = -1;
    for (k = 0; k < width; k++) {
      if (k === best) continue;
      var nm = names[k]; if (!nm) continue;
      if (LAST.test(nm) && last < 0) last = k;
      else if (FIRST.test(nm) && first < 0) first = k;
      else if (FULL.test(nm) && full < 0) full = k;
    }
    if (first < 0 && full >= 0) first = full;
    else if (first < 0 && last >= 0 && full >= 0) first = full;
    /* the values decide when the words did not (no header, or headings nobody could read) */
    if (first < 0 && last < 0) {
      var textCols = [];
      for (k = 0; k < width; k++) { var q = st[k]; if (k !== best && q.n && q.text >= 0.7 && q.at === 0 && q.long < 0.3 && q.digit < 0.3) textCols.push(k); }
      if (textCols.length) {
        first = textCols[0];
        var second = textCols[1];
        if (second != null && st[first].space < 0.2 && st[second].space < 0.2 && st[second].long === 0) last = second;   // two single-word columns are a first name and a last name
      }
    }
    var heads = [];
    for (k = 0; k < width; k++) {
      if (head >= 0 && rows[head][k]) heads.push(rows[head][k]);
      else heads.push("Column " + (k + 1) + (data[0] && data[0][k] ? " (" + String(data[0][k]).slice(0, 24) + ")" : ""));
    }
    return { rows: rows, head: head, hasHead: head >= 0, heads: heads, from: from, ix: { number: best, first: first, last: last } };
  }
  /* "142, Jane Smith" one a line, and how many rows had no member number (blank rows are not counted) */
  function build(rows, ix, from) {
    var lines = [], skipped = 0;
    (rows || []).slice(from || 0).forEach(function (r) {
      var num = String(r[ix.number] == null ? "" : r[ix.number]).replace(/\s+/g, "").replace(/^#/, "");
      if (!/^\d{1,12}$/.test(num)) { if (r.some(function (c) { return c; })) skipped++; return; }
      var nm = [ix.first >= 0 ? r[ix.first] : "", ix.last >= 0 && ix.last !== ix.first ? r[ix.last] : ""].map(function (x) { return String(x || "").replace(/[\u0000-\u001f<>,]/g, " ").replace(/^["\s]+|["\s]+$/g, "").replace(/\s+/g, " ").trim(); }).filter(Boolean).join(" ");
      lines.push(num + ", " + nm);
    });
    return { lines: lines, skipped: skipped };
  }
  /* the whole thing for a piece of text: the lines the plan's own guess gives */
  function read(text) { var p = plan(parse(text)); var b = build(p.rows, p.ix, p.from); return { plan: p, lines: b.lines, skipped: b.skipped }; }
  root.VPMembersCsv = { decode: decode, delim: delim, parse: parse, plan: plan, build: build, read: read, headerRow: headerRow };
})(typeof window !== "undefined" ? window : this);
