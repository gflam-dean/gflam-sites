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

  /* ===================================================================================================================
     THE OTHER COLUMNS, A FULL NAME SPLIT, AND THE VENUE'S OWN MAPPING REMEMBERED (Dean, 16 Nov 2026, Jobs row 445).
     "When a venue uploads its members spreadsheet it maps first name, surname, email and phone; a single full-name
     column must be split into first name + surname." And: "we should import the same data as they are asking from our
     system", so a column is offered only for a field the venue's own game join collects (collect_* in Game settings):
     email, mobile, postcode, and the "Send me offers from {venue}" consent. Every other column (street address, date of
     birth, state) is shown as "not imported" and never leaves the venue's computer.
       guess      plan() plus email / mobile / postcode / offers / a one-column full name, by the heading, then the values
       splitName  "Daniel Lee" -> Daniel / Lee; "Lee, Daniel" and "LEE,Daniel" -> Daniel / Lee; three or more words, one
                  word, or two commas -> a best guess marked sure:false, for the venue to check on the same screen
       mobile     the purchase raffle's rule (praffleNormPhone in the game Worker): +614xxxxxxxx, or null
       members    the rows as {number, first_name, last_name, email, mobile, postcode, offers, sure, problems}
       mapOf / applyMap   the venue's choices by heading, saved with its members list and put back next time
   =================================================================================================================== */
  var EMAIL_H = /(^| )e ?mail( address)?( |$)|^email/;
  var MOBILE_H = /(^| )(mobile|mob|cell|cellphone|phone|ph|telephone|tel|contact number|sms)( (no|number|phone|#))?( |$)/;
  var LANDLINE_H = /(^| )(home|work|business|fax|landline)( |$)/;
  var POSTCODE_H = /(^| )(post ?code|postcode|pcode|p code|zip)( |$)/;
  var OFFERS_H = /subscri|opt ?in|optin|opted|marketing|newsletter|consent|offers|promotions|e ?news|mailing|contact ok|do not contact|unsubscri/;
  var ONE_NAME_H = /^(full )?names?$|^(member|customer|patron|members|person|contact) (full )?names?$|^fullname$|^display name$/;
  function isEmail(v) { return /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/.test(String(v || "").trim()); }
  /* ONE ANSWER IN ONE PLACE: the purchase raffle's own rule (venueplay-game.js praffleNormPhone), so the import and the
     member match store and compare the same thing. Excel drops the leading 0 ("412 345 678"), a club system writes
     "+61 (0)412 345 678" or "61412345678"; anything that is not an Australian mobile is null, never a guess. */
  function mobile(raw) {
    var d = String(raw == null ? "" : raw).replace(/\(0\)/g, "").replace(/[\s\-().]/g, "");
    if (/^\+614\d{8}$/.test(d)) return d;
    d = d.replace(/^\+/, "");
    if (!/^\d+$/.test(d)) return null;
    if (/^614\d{8}$/.test(d)) return "+" + d;
    if (/^04\d{8}$/.test(d)) return "+61" + d.slice(1);
    if (/^4\d{8}$/.test(d)) return "+61" + d;
    return null;
  }
  function showMobile(p) { var l = "0" + String(p || "").slice(3); return l.slice(0, 4) + " " + l.slice(4, 7) + " " + l.slice(7); }
  function postcode(raw) { var d = String(raw == null ? "" : raw).replace(/\s+/g, ""); if (/^\d{3}$/.test(d)) d = "0" + d; return /^\d{4}$/.test(d) ? d : null; }
  /* "Subscribed" / "Yes" / "Y" / "1" / "TRUE" / "Opted in" is yes; "Unsubscribed" / "No" / "Opted out" / "0" is no; a blank or
     anything else is "not said", which never becomes a yes. A "Do not contact" column turns the answer round. */
  function offers(raw, inverted) {
    var v = String(raw == null ? "" : raw).trim().toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
    if (!v) return null;
    var yes = /^(y|yes|true|t|1|x|subscribed|opted in|opt in|optin|in|ok|active|on|agreed|agree)$/.test(v);
    var no = /^(n|no|false|f|0|unsubscribed|not subscribed|opted out|opt out|optout|out|off|declined|none|bounced|do not contact|dnc)$/.test(v);
    if (!yes && !no) return null;
    return inverted ? !yes : yes;
  }
  var PARTICLES = /^(van|von|de|da|di|del|della|der|den|du|la|le|st|st\.|bin|al|el|mac|o|ten|ter|dos|das)$/i;
  /* AN ALL-CAPITALS NAME FROM A CLUB SYSTEM ("LEE", "O'BRIEN", "SMITH-JONES") is written the way it is said ("Lee",
     "O'Brien", "Smith-Jones"), so the TV does not shout it, word by word. A word with any small letter in it is left exactly
     as typed: "McDonald", "McDONALD", "de Silva", "DiMaggio". */
  function tidy(w) {
    return String(w || "").replace(/\s+/g, " ").trim().split(" ").map(function (t) {
      if (!/[A-Z]{2}/.test(t) || /[a-z]/.test(t)) return t;   // word by word: "O'BRIEN, Jr" is O'Brien, Jr
      return t.toLowerCase().replace(/(^|[\-'’])([a-zà-ÿ])/g, function (m, a, b) { return a + b.toUpperCase(); });
    }).join(" ");
  }
  function splitName(raw) {
    var s = String(raw == null ? "" : raw).replace(/[\u0000-\u001f<>]/g, " ").replace(/\s+/g, " ").trim();
    if (!s) return { first: "", last: "", sure: false, why: "no name" };
    var commas = s.split(",");
    if (commas.length === 2) {
      var l = commas[0].trim(), f = commas[1].trim();
      if (l && f) return { first: tidy(f), last: tidy(l), sure: true, why: "" };
    }
    if (commas.length > 2) {
      var w0 = s.replace(/,/g, " ").replace(/\s+/g, " ").trim().split(" ");
      return { first: tidy(w0.slice(0, -1).join(" ")), last: tidy(w0[w0.length - 1]), sure: false, why: "more than one comma" };
    }
    s = s.replace(/,/g, " ").replace(/\s+/g, " ").trim();
    var w = s.split(" ");
    if (w.length === 1) return { first: tidy(w[0]), last: "", sure: false, why: "only one name" };
    if (w.length === 2) return { first: tidy(w[0]), last: tidy(w[1]), sure: true, why: "" };
    /* three words or more: "Mary Anne Smith" or "Daniel van der Berg". A best guess, never stored without the venue
       seeing it: the surname is the last word, with a van / de / da / von in front of it kept with it. */
    var cut = w.length - 1;
    while (cut > 1 && PARTICLES.test(w[cut - 1])) cut--;
    return { first: tidy(w.slice(0, cut).join(" ")), last: tidy(w.slice(cut).join(" ")), sure: false, why: "more than two words" };
  }
  /* plan() plus the other columns. allow: which fields this venue collects ({email, mobile, postcode, offers}); a field
     it does not collect is never guessed, so it can never be imported by accident. */
  function guess(rows, allow) {
    allow = allow || {};
    var p = plan(rows), width = p.heads.length, k, used = {};
    var data = p.rows.slice(p.from, p.from + 300);
    var names = []; for (k = 0; k < width; k++) names.push(p.hasHead ? norm(p.rows[p.head][k]) : "");
    var ix = { number: p.ix.number, first: p.ix.first, last: p.ix.last, full: -1, email: -1, mobile: -1, postcode: -1, offers: -1, offersInverted: false };
    /* a single "Name" / "Member Name" column is a FULL name: both names are in it */
    if (ix.first >= 0 && ix.last < 0 && (ONE_NAME_H.test(names[ix.first]) || !names[ix.first])) {
      var vals = col(data, ix.first).filter(function (v) { return v; });
      var two = vals.filter(function (v) { return /\S[\s,]+\S/.test(v); }).length;
      if (ONE_NAME_H.test(names[ix.first]) || (vals.length && two / vals.length >= 0.6)) { ix.full = ix.first; ix.first = -1; }
    }
    [ix.number, ix.first, ix.last, ix.full].forEach(function (c) { if (c >= 0) used[c] = 1; });
    function pick(field, headRe, valueTest, bad) {
      var best = -1, bestScore = 0;
      for (var j = 0; j < width; j++) {
        if (used[j]) continue;
        var h = names[j], vals = col(data, j).filter(function (v) { return v; }), n = vals.length || 1;
        var vs = vals.filter(valueTest).length / n, score = 0;
        if (h && headRe.test(h) && !(bad && bad.test(h))) score = 2 + vs;
        else if (!h && vals.length && vs >= 0.8) score = 1 + vs;
        if (score > bestScore) { bestScore = score; best = j; }
      }
      if (best >= 0) { ix[field] = best; used[best] = 1; }
    }
    if (allow.email) pick("email", EMAIL_H, isEmail);
    if (allow.mobile) pick("mobile", MOBILE_H, function (v) { return !!mobile(v); }, LANDLINE_H);
    if (allow.postcode) pick("postcode", POSTCODE_H, function (v) { return !!postcode(v) && String(v).replace(/\s/g, "").length <= 4; });
    if (allow.offers) {
      pick("offers", OFFERS_H, function () { return false; });
      if (ix.offers >= 0) ix.offersInverted = /do not contact|unsubscri|opt ?out|optout/.test(names[ix.offers]);
    }
    p.ix = ix;
    p.notImported = notImported(p, ix);
    return p;
  }
  /* the headings of every column that is not going in, so the screen can say so ("Street address, DOB: not imported") */
  function notImported(p, ix) {
    var taken = {};
    ["number", "first", "last", "full", "email", "mobile", "postcode", "offers"].forEach(function (f) { if (ix[f] != null && ix[f] >= 0) taken[ix[f]] = 1; });
    var out = [];
    for (var k = 0; k < p.heads.length; k++) if (!taken[k]) out.push(p.heads[k]);
    return out;
  }
  function cell(r, i) { return i != null && i >= 0 && r[i] != null ? String(r[i]).trim() : ""; }
  function clip(v, n) { return String(v || "").replace(/[\u0000-\u001f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, n); }
  /* THE ROWS, READY TO CHECK. Every row with a member number, its name split, and what the rule could not be sure of:
       problems  words for the venue ("Check the name: more than two words", "Not a mobile: 1234")
       sure      false when the name needs a look; the screen lists those first and lets the venue fix them */
  function members(rows, ix, from) {
    var out = [], skipped = 0, seen = {};
    (rows || []).slice(from || 0).forEach(function (r) {
      var num = cell(r, ix.number).replace(/\s+/g, "").replace(/^#/, "");
      if (!(/^\d{1,12}$/).test(num)) { if (r.some(function (c) { return c; })) skipped++; return; }
      var m = { number: parseInt(num, 10), first_name: "", last_name: "", sure: true, problems: [] };
      if (ix.full != null && ix.full >= 0) {
        var sp = splitName(cell(r, ix.full));
        m.first_name = clip(sp.first, 80); m.last_name = clip(sp.last, 80);
        if (!sp.sure) { m.sure = false; m.problems.push("Check the name: " + sp.why); }
      } else {
        m.first_name = clip(tidy(cell(r, ix.first)), 80);
        m.last_name = ix.last >= 0 && ix.last !== ix.first ? clip(tidy(cell(r, ix.last)), 80) : "";
        if (!m.first_name && !m.last_name) { m.sure = false; m.problems.push("Check the name: no name"); }
      }
      if (ix.email != null && ix.email >= 0) {
        var e = cell(r, ix.email).toLowerCase();
        if (e && isEmail(e) && e.length <= 200) m.email = e; else if (e) m.problems.push("Not an email, left out: " + clip(e, 40));
      }
      if (ix.mobile != null && ix.mobile >= 0) {
        var raw = cell(r, ix.mobile), mob = mobile(raw);
        if (mob) m.mobile = mob; else if (raw) m.problems.push("Not an Australian mobile, left out: " + clip(raw, 24));
      }
      if (ix.postcode != null && ix.postcode >= 0) {
        var pc = cell(r, ix.postcode), pcn = postcode(pc);
        if (pcn) m.postcode = pcn; else if (pc) m.problems.push("Not a postcode, left out: " + clip(pc, 12));
      }
      if (ix.offers != null && ix.offers >= 0) { var o = offers(cell(r, ix.offers), ix.offersInverted); if (o !== null) m.offers = o; }
      if (seen[m.number]) { m.sure = false; m.problems.push("Member number " + m.number + " is in the file twice: only the first is added"); }
      seen[m.number] = 1;
      out.push(m);
    });
    return { members: out, skipped: skipped, unsure: out.filter(function (m) { return !m.sure; }).length };
  }
  /* THE MAPPING, REMEMBERED BY HEADING (Dean, 16 Nov 2026: "remember that setting from the first time they import members").
     Kept with the venue's members list (vp_member_rosters.import_map, migration 200) as { v:1, cols: { "<heading>": field } },
     headings only: never a value from the file. A file without headings remembers nothing (Column 3 means nothing next month). */
  var FIELDS = ["number", "first", "last", "full", "email", "mobile", "postcode", "offers"];
  function mapOf(p, ix) {
    if (!p || !p.hasHead) return null;
    var cols = {}, n = 0;
    FIELDS.forEach(function (f) { var i = ix[f]; if (i != null && i >= 0 && p.rows[p.head][i]) { cols[norm(p.rows[p.head][i]).slice(0, 60)] = f; n++; } });
    return n ? { v: 1, cols: cols } : null;
  }
  /* put a saved mapping back over the guess: a heading the venue mapped before wins; a field it said "None" to stays the
     guess; a field this venue no longer collects is dropped (allow) */
  function applyMap(p, saved, allow) {
    if (!p || !p.hasHead || !saved || !saved.cols) return { plan: p, used: false };
    allow = allow || {};
    var ix = JSON.parse(JSON.stringify(p.ix)), hit = 0;
    for (var k = 0; k < p.heads.length; k++) {
      var f = saved.cols[norm(p.rows[p.head][k]).slice(0, 60)];
      if (!f || FIELDS.indexOf(f) < 0) continue;
      if ((f === "email" || f === "mobile" || f === "postcode" || f === "offers") && !allow[f]) continue;
      FIELDS.forEach(function (g) { if (ix[g] === k) ix[g] = -1; });
      ix[f] = k; hit++;
      if (f === "full") { ix.first = -1; ix.last = -1; }
      if (f === "first" || f === "last") ix.full = -1;
      if (f === "offers") ix.offersInverted = /do not contact|unsubscri|opt ?out|optout/.test(norm(p.rows[p.head][k]));
    }
    if (ix.number < 0) ix.number = p.ix.number;
    p.ix = ix; p.notImported = notImported(p, ix);
    return { plan: p, used: hit > 0 };
  }
  root.VPMembersCsv = { decode: decode, delim: delim, parse: parse, plan: plan, build: build, read: read, headerRow: headerRow,
    guess: guess, splitName: splitName, mobile: mobile, showMobile: showMobile, postcode: postcode, offers: offers, isEmail: isEmail,
    tidy: tidy, members: members, notImported: notImported, mapOf: mapOf, applyMap: applyMap };
})(typeof window !== "undefined" ? window : this);
