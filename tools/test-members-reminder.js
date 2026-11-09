/* THE WEEKLY MEMBERS LIST REMINDER EMAIL (Dean, 10 Nov 2026, setup wizard round 12 note 9).

   "Would you like a weekly reminder to update your members list? We can email you." Runs the REAL billing Worker's
   vpaMembersReminderSweep (tools/rig-billing-worker.js: a fake PostgREST and a fake Resend that records what went) over whole
   weeks on a fixed clock:
     1. one email a week on the chosen day, in Dean's send window (Mon to Fri, 9 to 12 and 2 to 5, the venue's own time)
     2. a day or time outside the window is HELD to the next opening, not dropped, and not sent early
     3. the venue's own clock: Melbourne (daylight saving), Perth
     4. never the day it was chosen, never twice in a week, never twice in one hour
     5. NEVER to a Do not contact venue, a venue that is not active, a calendar or no reminder, or without a Resend key
     6. a failed read or a failed audit write sends nothing (never a second email)
     7. the email's words

   Run from the repo root:  jsc tools/test-members-reminder.js */
var ran = 0, bad = 0;
function check(n, c, saw) { ran++; if (c) print('  ok   ' + n); else { bad++; print('  FAIL ' + n + (saw !== undefined ? '   saw: ' + String(typeof saw === 'string' ? saw : JSON.stringify(saw)).slice(0, 400) : '')); } }
function section(t) { print(''); print(t); }
URL = function (u) { u = String(u); this.pathname = u.replace(/^https?:\/\/[^/]+/, '') || '/'; this.searchParams = { get: function () { return null; } }; };
Response = function (body, init) { this.body = body; this.status = (init && init.status) || 200; this.headers = (init && init.headers) || {}; };
load('tools/rig-billing-worker.js');
if (typeof AbortController === 'undefined') { AbortController = function () { this.signal = {}; this.abort = function () {}; }; }
function U(nn) { return '54000000-0000-4000-8000-' + ('000000000000' + nn).slice(-12); }
function bne(y, mo, d, h, mi) { return Date.UTC(y, mo - 1, d, h - 10, mi || 0); }   // a Brisbane wall-clock time as epoch ms
var HOUR = 3600000, N = 0;
function world() { DB = {}; sent.length = 0; FAIL = {}; ENV.RESEND_API_KEY = 'k'; DB.vp_venues = []; DB.venueplay_founding = []; DB.vp_venue_settings = []; DB.vp_admin_audit = []; DB.vp_prospects = []; }
function venue(o) {
  o = o || {}; N++;
  var id = U(N), fid = U(500 + N);
  DB.vp_venues.push({ id: id, name: o.name || 'Reminder Hotel ' + N, status: o.status || 'active', au_state: o.state || 'QLD', founding_id: fid });
  DB.venueplay_founding.push({ id: fid, contact_email: o.email === undefined ? 'owner' + N + '@reminder.example' : o.email, contact_name: 'Sam Owner' });
  var mr = o.reminder === undefined ? { how: 'email', day: 'mon', time: '09:00', since: '2026-11-10' } : o.reminder;
  DB.vp_venue_settings.push({ venue_id: id, setup_answers: mr ? { games: ['members'], members_reminder: mr } : { games: ['members'] } });
  return { id: id, row: DB.vp_venues[DB.vp_venues.length - 1], fid: fid };
}
/* the fake database stamps new rows with the real clock; the sweep reads "since this week's moment", so a row gets the sweep's own clock */
async function sweep(t) { var n = DB.vp_admin_audit.length; var r = await vpaMembersReminderSweep(ENV, t); for (var i = n; i < DB.vp_admin_audit.length; i++) DB.vp_admin_audit[i].created_at = new Date(t).toISOString(); return r; }
async function walk(from, to) { var out = []; for (var t = from; t <= to; t += HOUR) { var b = sent.length; await sweep(t); for (var i = b; i < sent.length; i++) out.push({ at: t, msg: sent[i] }); } return out; }
function local(tz, ms) { return vpaSendLocal(tz, ms); }
function atWords(list, tz) { return list.map(function (x) { var p = local(tz, x.at); return p.wd + ' ' + p.h + ':' + (p.m < 10 ? '0' : '') + p.m; }).join(', '); }

(async function () {
  var FROM = bne(2026, 11, 10, 0, 0), WEEK3 = bne(2026, 11, 23, 23, 0);

  section('1. ONE EMAIL A WEEK, ON THE CHOSEN DAY, INSIDE THE WINDOW');
  world(); var A = venue({});   // Monday 9am, chosen on Tue 10 Nov
  var got = await walk(FROM, WEEK3);
  check('Monday 9:00 each week: two emails in the two weeks (16 and 23 Nov), nothing else', got.length === 2 && atWords(got, 'Australia/Brisbane') === 'Mon 9:00, Mon 9:00' && got[0].at === bne(2026, 11, 16, 9) && got[1].at === bne(2026, 11, 23, 9), atWords(got, 'Australia/Brisbane'));
  check('each goes to the account contact, from the venueplay address', got.every(function (g) { return g.msg.to[0] === 'owner1@reminder.example' && /venueplay <hello@send\.venueplay\.com\.au>/.test(g.msg.from); }), got[0] && got[0].msg);
  check('and one audit row each (members_reminder_sent), the record that stops a second', DB.vp_admin_audit.filter(function (a) { return a.action === 'members_reminder_sent' && a.target === 'venue:' + A.id; }).length === 2);

  section('2. OUTSIDE THE WINDOW IS HELD, NOT DROPPED');
  world(); venue({ reminder: { how: 'email', day: 'mon', time: '06:00', since: '2026-11-10' } });
  got = await walk(FROM, bne(2026, 11, 17, 23, 0));
  check('6am Monday: held to Monday 9:00', got.length === 1 && got[0].at === bne(2026, 11, 16, 9), atWords(got, 'Australia/Brisbane'));
  world(); venue({ reminder: { how: 'email', day: 'sat', time: '10:00', since: '2026-11-10' } });
  got = await walk(FROM, bne(2026, 11, 22, 23, 0));
  check('Saturday 10am: held to the Monday 9:00 after it (16 Nov), not sent on the weekend', got.length === 1 && got[0].at === bne(2026, 11, 16, 9), atWords(got, 'Australia/Brisbane'));
  world(); venue({ reminder: { how: 'email', day: 'fri', time: '12:00', since: '2026-11-10' } });
  got = await walk(FROM, bne(2026, 11, 14, 23, 0));
  check('Friday 12 noon: held to 2pm', got.length === 1 && got[0].at === bne(2026, 11, 13, 14), atWords(got, 'Australia/Brisbane'));
  world(); venue({ reminder: { how: 'email', day: 'wed', time: '17:30', since: '2026-11-10' } });
  got = await walk(FROM, bne(2026, 11, 19, 23, 0));
  check('Wednesday 5:30pm: held to Thursday 9:00 (12 and 19 Nov, one each)', got.length === 2 && got[0].at === bne(2026, 11, 12, 9) && got[1].at === bne(2026, 11, 19, 9), atWords(got, 'Australia/Brisbane'));
  world(); venue({ reminder: { how: 'email', day: 'tue', time: '14:30', since: '2026-11-10' } });
  got = await walk(FROM, bne(2026, 11, 18, 23, 0));
  check('an in-window time on the half hour (Tuesday 2:30pm) goes at 2pm\'s sweep or later, the same day', got.length === 1 && got[0].at >= bne(2026, 11, 17, 14) && got[0].at < bne(2026, 11, 17, 17), atWords(got, 'Australia/Brisbane'));
  var inW = true; world(); venue({ reminder: { how: 'email', day: 'sun', time: '03:00', since: '2026-11-01' } });
  got = await walk(bne(2026, 11, 10, 0), bne(2026, 12, 8, 23)); got.forEach(function (g) { var p = local('Australia/Brisbane', g.at); if (p.wd === 'Sat' || p.wd === 'Sun' || [9, 10, 11, 14, 15, 16].indexOf(p.h) < 0) inW = false; });
  check('Sunday 3am, chosen 1 Nov, over four weeks: one a week, and an email is never outside Monday to Friday, 9 to 12 and 2 to 5', got.length === 5 && inW, atWords(got, 'Australia/Brisbane'));

  section('3. THE VENUE\'S OWN CLOCK');
  world(); venue({ state: 'VIC', reminder: { how: 'email', day: 'mon', time: '09:00', since: '2026-11-10' } });
  got = await walk(FROM, bne(2026, 11, 17, 23, 0));
  check('a Victorian venue: Monday 9:00 Melbourne (daylight saving, 8:00 Brisbane time)', got.length === 1 && got[0].at === bne(2026, 11, 16, 8) && atWords(got, 'Australia/Melbourne') === 'Mon 9:00', atWords(got, 'Australia/Melbourne'));
  world(); venue({ state: 'WA', reminder: { how: 'email', day: 'mon', time: '09:00', since: '2026-11-10' } });
  got = await walk(FROM, bne(2026, 11, 17, 23, 0));
  check('a Perth venue: Monday 9:00 Perth (11:00 Brisbane time)', got.length === 1 && got[0].at === bne(2026, 11, 16, 11) && atWords(got, 'Australia/Perth') === 'Mon 9:00', atWords(got, 'Australia/Perth'));

  section('4. NEVER THE DAY IT WAS CHOSEN, NEVER TWICE');
  world(); venue({ reminder: { how: 'email', day: 'mon', time: '09:00', since: '2026-11-16' } });   // chosen on the Monday itself, after 9
  got = await walk(bne(2026, 11, 16, 0), bne(2026, 11, 22, 23));
  check('chosen on Monday 16 Nov for Mondays: nothing that day or that week', got.length === 0, atWords(got, 'Australia/Brisbane'));
  got = await walk(bne(2026, 11, 23, 0), bne(2026, 11, 23, 23));
  check('the first one is the next Monday, 23 Nov', got.length === 1 && got[0].at === bne(2026, 11, 23, 9), atWords(got, 'Australia/Brisbane'));
  world(); venue({});
  await sweep(bne(2026, 11, 16, 9)); await sweep(bne(2026, 11, 16, 9, 20)); await sweep(bne(2026, 11, 16, 10)); await sweep(bne(2026, 11, 16, 15)); await sweep(bne(2026, 11, 17, 9));
  check('swept five times across Monday and Tuesday: still one email', sent.length === 1, sent.length);
  world(); venue({}); var t0 = sent.length;
  await sweep(bne(2026, 11, 14, 9)); await sweep(bne(2026, 11, 15, 12));
  check('swept the week BEFORE the first Monday: nothing yet', sent.length === t0);
  world(); venue({ reminder: { how: 'email', day: 'mon', time: '09:00' } });
  got = await walk(FROM, WEEK3);
  check('an old choice with no day recorded (no since) sends nothing: never guess', got.length === 0);

  section('5. WHO NEVER GETS ONE');
  world(); var B = venue({}); DB.vp_prospects.push({ venue_id: B.id, email: 'b@x.example', no_contact: true });
  got = await walk(FROM, WEEK3);
  check('a Do not contact venue: nothing, ever', got.length === 0);
  world(); B = venue({}); DB.vp_prospects.push({ venue_id: B.id, email: 'b@x.example', no_contact: false });
  got = await walk(FROM, WEEK3);
  check('and a prospect row that is not flagged is a normal venue', got.length === 2);
  world(); venue({ status: 'suspended' }); got = await walk(FROM, WEEK3);
  check('a suspended (paused) venue: nothing', got.length === 0);
  world(); venue({ reminder: { how: 'calendar', day: 'mon', time: '09:00', since: '2026-11-10' } }); venue({ reminder: null });
  got = await walk(FROM, WEEK3);
  check('a venue that chose the calendar, or no reminder: nothing', got.length === 0);
  world(); venue({ email: '' }); got = await walk(FROM, WEEK3);
  check('no email address on file: nothing', got.length === 0);
  world(); venue({}); ENV.RESEND_API_KEY = ''; got = await walk(FROM, WEEK3); ENV.RESEND_API_KEY = 'k';
  check('no Resend key: nothing sent and no record written either', got.length === 0 && DB.vp_admin_audit.length === 0);
  world(); B = venue({ email: '' }); DB.venueplay_founding[0].contact_name = ''; DB.vp_prospects.push({ venue_id: B.id, email: 'prospect@x.example', contact_name: 'Pat Prospect' });
  got = await walk(FROM, WEEK3);
  check('a prospect with no account contact: the prospect\'s own email', got.length === 2 && got[0].msg.to[0] === 'prospect@x.example' && /Hi Pat,/.test(got[0].msg.html));

  section('6. A FAILED READ OR A FAILED AUDIT WRITE SENDS NOTHING TWICE');
  world(); venue({});
  FAIL['vp_admin_audit:GET'] = 50; await sweep(bne(2026, 11, 16, 9)); await sweep(bne(2026, 11, 16, 10));
  check('the once-a-week check cannot be read: nothing sent', sent.length === 0, sent.length); FAIL = {};
  FAIL['vp_admin_audit:POST'] = 1; await sweep(bne(2026, 11, 16, 9));
  check('the record cannot be written: nothing sent', sent.length === 0, sent.length);
  await sweep(bne(2026, 11, 16, 10)); await sweep(bne(2026, 11, 16, 11));
  check('the next hour writes it and sends the one email', sent.length === 1, sent.length);
  world(); venue({}); FAIL['vp_prospects:GET'] = 50; await sweep(bne(2026, 11, 16, 9)); FAIL = {};
  check('the Do not contact check cannot be read: nothing sent', sent.length === 0, sent.length);

  section('7. THE EMAIL\'S WORDS');
  world(); venue({ name: 'The Albion Hotel' }); await sweep(bne(2026, 11, 16, 9));
  var m = sent[0] || { subject: '', html: '' };
  check('the subject says update your members list, with the venue', m.subject === 'Time to update your members list at The Albion Hotel', m.subject);
  check('the body says update your members list, links the members list page, says which day and how to stop', /Update my members list/.test(m.html) && /\/app\/billing\.html#draws/.test(m.html) && /every Monday/.test(m.html) && /choose No thanks under the weekly reminder/.test(m.html));
  check('no em dash, no "add your members list", no workers.dev, lowercase venueplay, the 07 landline only', !/—|–/.test(m.html + m.subject) && !/add your members list/i.test(m.html) && !/workers\.dev/.test(m.html) && !/VenuePlay/.test(m.html) && /07 5228 3667/.test(m.html) && !/04\d\d ?\d{3} ?\d{3}/.test(m.html));
  check('and a plain text part, so it is not scored as junk', typeof m.text === 'string' && /update the members list/.test(m.text), m.text);
  world(); venue({ name: '<b>Evil</b> & Co' }); await sweep(bne(2026, 11, 16, 9));
  check('a venue name typed with markup is escaped, never run', sent[0] && !/<b>Evil/.test(sent[0].html) && /&lt;b&gt;Evil/.test(sent[0].html));

  section('8. WIRED IN');
  var API = readFile('venueplay-backend/worker/venueplay-api-FULL.js');
  check('the hourly scheduled() trigger runs it, in its own try, so another sweep throwing cannot stop it', /try \{ await vpaMembersReminderSweep\(env, Date\.now\(\)\); \} catch \(e5b\)/.test(API));
  print(''); if (bad) print('FAIL ' + bad + ' of ' + ran); else print('ALL ' + ran + ' CHECKS PASSED');
})().catch(function (e) { print('CRASH ' + e + '\n' + (e && e.stack)); bad++; });
