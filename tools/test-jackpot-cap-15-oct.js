/* THE MAXIMUM JACKPOT, THE RESERVE, AND THE DRAW RECORD: the compliance build of 15 Oct 2026,
   agent C. Anisimoff Legal (ref 9380), 1 Oct 2026 point 10 and 8 Oct 2026 point 6: a customer-set
   maximum jackpot, enforced before the draws, "once a jackpot is reached, the draws could continue
   until a winner is finally selected". Points 8 and 14: the venue keeps the winner and draw
   records, so the product has to hand them over.

   Runs the REAL handlers out of the shipped venueplay-game.js on the rig (tools/rig-game-worker.js):
   handleMembersDraw, handleMembersResolve, handleMembersSettings and handleDrawsExport, against a
   fake PostgREST that pages at 1,000 like the real one. Then the pure helpers lifted by name out of
   the shipped members/host.html, raffle/host.html and members/screen.html, and the shared
   /app/vp-drawrecord.js, run with stubs. Nothing is restated: if a marker moves, this fails loudly.

   Run from the repo root:  jsc tools/test-jackpot-cap-15-oct.js */
load('tools/rig-game-worker.js');
var finished = false;
var DRAW = '55555555-5555-4555-8555-555555555555', ROSTER = '66666666-6666-4666-8666-666666666666';
var S1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', GAME = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
function uuid(n) { return '77777777-7777-4777-8777-' + ('000000000000' + n).slice(-12); }
function req(url) { return { url: url || 'https://w/x', headers: { get: function () { return ''; } } }; }
async function call(fn, body, url) {
  BODY = body || {};
  try { return await fn(req(url), ENV, json); }
  catch (e) { return { status: (e && e.status) || 500, body: { error: String(e && e.message) } }; }
}
function world(o) {
  o = o || {};
  DB = { vp_venues: [{ id: VENUE, name: 'Test Club', slug: 'test-club', status: 'active', au_state: 'NSW' }],
         vp_venue_groups: [], vp_venue_settings: [{ venue_id: VENUE, name_display: 'abbrev_last' }],
         vp_member_draws: [{ id: DRAW, venue_id: VENUE, roster_id: ROSTER, name: 'Friday Badge Draw',
           current_jackpot_cents: o.jackpot != null ? o.jackpot : 50000, starting_amount_cents: 50000, increment_cents: 10000,
           draw_length_seconds: 4, time_to_claim_seconds: 60, last_resolved_at: null, last_drawn_at: null, last_drawn_date: null,
           max_jackpot_cents: o.max != null ? o.max : null, reserve_cents: o.reserve || 0 }],
         vp_member_rosters: [{ id: ROSTER, venue_id: VENUE }], vp_members: [], vp_member_draw_results: [],
         vp_gaming_declarations: [{ id: 'decl-m', venue_id: VENUE, format: 'members', category_claimed: 'Free entry.', declared_at: new Date(NOWMS - 3600000).toISOString() }],
         vp_sessions: [], vp_games: [], vp_raffle_results: [] };
  for (var i = 1; i <= 10; i++) DB.vp_members.push({ id: uuid(i), roster_id: ROSTER, member_number: 100 + i, first_name: 'Member', last_name: 'N' + i, status: 'valid' });
}
function row() { return DB.vp_member_draws[0]; }
async function resolve(outcome) {
  var d = await call(handleMembersDraw, { draw_id: DRAW });
  if (d.status !== 200) return d;
  NOWMS += 30000;
  var r = await call(handleMembersResolve, { draw_id: DRAW, member_id: d.body.member_id, outcome: outcome });
  NOWMS += 30000;
  return r;
}
function lift(file, marker) {   // the function whose text starts at marker, out of the file that ships
  var src = readFile(file), a = src.indexOf(marker);
  if (a < 0) throw new Error('cannot find ' + marker + ' in ' + file);
  var b = src.indexOf('\n  }\n', a);
  if (b < 0) throw new Error('cannot find the end of ' + marker + ' in ' + file);
  return src.slice(a, b + 4);
}
function moneyStub(cents) { return '$' + ((cents || 0) / 100).toLocaleString('en-AU', { minimumFractionDigits: 0, maximumFractionDigits: 0 }); }

(async function () {
  print('no maximum: the jackpot rolls over and resets exactly as it always did');
  world();
  var r = await resolve('rollover');
  show('rollover grows by the increment', r.status === 200 && r.body.new_jackpot_cents === 60000 && row().current_jackpot_cents === 60000, JSON.stringify(r.body));
  show('and says it is not capped, with no reserve', r.body.capped === false && r.body.reserve_cents === 0 && r.body.max_jackpot_cents === null, JSON.stringify(r.body));
  r = await resolve('claim');
  show('a claim pays what was on offer and resets to the starting amount', r.status === 200 && r.body.amount_cents === 60000 && r.body.new_jackpot_cents === 50000 && row().reserve_cents === 0, JSON.stringify(r.body));

  print('a maximum of $650: the jackpot stops there and the increments bank up');
  world({ max: 65000 });
  r = await resolve('rollover');
  show('$500 + $100 = $600, under the maximum: nothing held', r.body.new_jackpot_cents === 60000 && r.body.capped === false && r.body.reserve_cents === 0, JSON.stringify(r.body));
  r = await resolve('rollover');
  show('$600 + $100 stops at $650, and the $50 over goes to the reserve', r.body.new_jackpot_cents === 65000 && r.body.capped === true && r.body.held_cents === 5000 && r.body.reserve_cents === 5000, JSON.stringify(r.body));
  show('the reserve is written to the draw row', row().reserve_cents === 5000 && row().current_jackpot_cents === 65000, JSON.stringify(row()));
  r = await resolve('rollover');
  show('at the maximum the draw keeps going: still $650, the whole $100 banked, reserve $150', r.status === 200 && r.body.new_jackpot_cents === 65000 && r.body.capped === true && r.body.reserve_cents === 15000, JSON.stringify(r.body));
  show('the record says each of those draws was for the jackpot on offer', DB.vp_member_draw_results.length === 3 && DB.vp_member_draw_results.every(function (x) { return x.outcome === 'jackpot_rolled'; }) && DB.vp_member_draw_results[2].amount_cents === 65000, JSON.stringify(DB.vp_member_draw_results.map(function (x) { return x.amount_cents; })));
  r = await resolve('claim');
  show('the winner takes the $650 on offer', r.body.amount_cents === 65000 && DB.vp_member_draw_results[3].outcome === 'claimed' && DB.vp_member_draw_results[3].amount_cents === 65000, JSON.stringify(r.body));
  show('the next jackpot is seeded from the reserve: $500 + $150 = $650, reserve back to 0', r.body.new_jackpot_cents === 65000 && r.body.reserve_cents === 0 && row().reserve_cents === 0, JSON.stringify(r.body));

  print('a reserve bigger than the room under the maximum: what fits seeds, the rest stays');
  world({ max: 65000, jackpot: 65000, reserve: 30000 });
  r = await resolve('claim');
  show('$500 + $300 reserve stops at $650; $150 stays in reserve', r.body.new_jackpot_cents === 65000 && r.body.reserve_cents === 15000 && r.body.held_cents === 15000 && r.body.capped === true, JSON.stringify(r.body));

  print('a duplicate resolve reports the cap too, and advances nothing');
  world({ max: 65000, jackpot: 65000, reserve: 5000 });
  var d1 = await call(handleMembersDraw, { draw_id: DRAW }); NOWMS += 30000;
  await call(handleMembersResolve, { draw_id: DRAW, member_id: d1.body.member_id, outcome: 'rollover' });
  var dup = await call(handleMembersResolve, { draw_id: DRAW, member_id: d1.body.member_id, outcome: 'rollover' });
  show('the repeat is a duplicate: reserve $150 once, not twice', dup.body.duplicate === true && dup.body.capped === true && row().reserve_cents === 15000, JSON.stringify(dup.body) + ' reserve ' + row().reserve_cents);

  print('a database that has not had migration 101 yet rolls over as before and is never asked to write reserve_cents');
  world({ max: 65000, jackpot: 65000 });
  var realFetch = fetch, patches = [];
  fetch = async function (u, o) {
    var s = String(u);
    if (/vp_member_draws/.test(s) && /select=max_jackpot_cents/.test(s)) return { ok: false, status: 400, json: async function () { return {}; }, text: async function () { return 'column vp_member_draws.max_jackpot_cents does not exist'; } };
    if (o && o.method === 'PATCH' && /vp_member_draws/.test(s)) patches.push(JSON.parse(o.body));
    return realFetch(u, o);
  };
  r = await resolve('rollover');
  fetch = realFetch;
  show('the jackpot grows past the figure the old database cannot see: $650 + $100 = $750', r.status === 200 && r.body.new_jackpot_cents === 75000 && r.body.capped === false, JSON.stringify(r.body));
  show('and no patch names reserve_cents', patches.length > 0 && patches.every(function (p) { return !('reserve_cents' in p); }), JSON.stringify(patches));

  print('settings: the maximum is accepted, cleared, and refused when the jackpot is already above it');
  world();
  r = await call(handleMembersSettings, { draw_id: DRAW, max_jackpot_cents: 80000 });
  show('a manager sets a maximum of $800', r.status === 200 && row().max_jackpot_cents === 80000, JSON.stringify(r.body));
  r = await call(handleMembersSettings, { draw_id: DRAW, current_jackpot_cents: 90000 });
  show('a current jackpot above the maximum is refused, not trimmed', r.status === 400 && r.body.over_cap === 'current' && row().current_jackpot_cents === 50000, JSON.stringify(r.body));
  r = await call(handleMembersSettings, { draw_id: DRAW, starting_amount_cents: 90000 });
  show('a starting jackpot above the maximum is refused', r.status === 400 && r.body.over_cap === 'starting' && row().starting_amount_cents === 50000, JSON.stringify(r.body));
  r = await call(handleMembersSettings, { draw_id: DRAW, max_jackpot_cents: 40000 });
  show('a maximum under the current jackpot is refused the same way', r.status === 400 && r.body.over_cap === 'current' && row().max_jackpot_cents === 80000, JSON.stringify(r.body));
  r = await call(handleMembersSettings, { draw_id: DRAW, max_jackpot_cents: 60000, current_jackpot_cents: 60000 });
  show('both moved together, consistent: saved', r.status === 200 && row().max_jackpot_cents === 60000 && row().current_jackpot_cents === 60000, JSON.stringify(r.body));
  r = await call(handleMembersSettings, { draw_id: DRAW, max_jackpot_cents: null });
  show('null clears the maximum', r.status === 200 && row().max_jackpot_cents === null, JSON.stringify(row()));
  r = await call(handleMembersSettings, { draw_id: DRAW, max_jackpot_cents: -5 });
  show('a negative maximum is refused', r.status === 400, JSON.stringify(r.body));
  r = await call(handleMembersSettings, { draw_id: DRAW, name: 'Friday Badge Draw' });
  show('CONTROL: a save that leaves the field out leaves the maximum alone', r.status === 200 && row().max_jackpot_cents === null, JSON.stringify(row()));
  var keepStaff = requireStaff;
  requireStaff = async function (env, uid, venueId) { return { id: 'staff-2', role: 'host', venue_id: venueId, auth_user_id: uid, permissions: null }; };
  r = await call(handleMembersSettings, { draw_id: DRAW, max_jackpot_cents: 80000 });
  requireStaff = keepStaff;
  show('a host cannot set it: manager or owner only, as every other jackpot number', r.status === 403 && row().max_jackpot_cents === null, JSON.stringify(r.body));
  r = await call(handleMembersSettings, { venue_id: VENUE, name: 'Sunday Draw', starting_amount_cents: 20000, max_jackpot_cents: 100000 });
  show('a new draw can be created with a maximum', r.status === 200 && r.body.draw && r.body.draw.max_jackpot_cents === 100000, JSON.stringify(r.body));

  print('the draw record: GET /host/draws/export, guarded, paged, CSV');
  // The rig's Response keeps no headers; this one does, so the content type can be checked.
  Response = function (body, init) { this._b = body; this.status = (init && init.status) || 200; this.ok = this.status < 300; this.headers = (init && init.headers) || {}; };
  var CORS = { 'Access-Control-Allow-Origin': 'https://www.venueplay.com.au' };
  async function exportCsv(url, cors) {
    try { return await handleDrawsExport(req(url), ENV, json, cors === undefined ? CORS : cors); }
    catch (e) { return { status: (e && e.status) || 500, body: { error: String(e && e.message) } }; }
  }
  var EXPORT = 'https://w/host/draws/export?venue_id=' + VENUE + '&format=csv';
  world({ max: 65000 });
  await resolve('rollover');
  var c1 = await resolve('claim');
  DB.vp_sessions = [{ id: S1, venue_id: VENUE, status: 'finished' }];
  DB.vp_games = [{ id: GAME, session_id: S1, seq: 1, format: 'raffle', status: 'finished', config: { name: 'Meat tray raffle' } }];
  DB.vp_raffle_results = [
    { game_id: GAME, seq: 1, ticket_number: 42, status: 'winner', outcome: 'claimed', prize_text: 'Meat tray, "the big one"', prize_type: 'other', drawn_at: '2026-10-09T09:00:00.000Z' },
    { game_id: GAME, seq: 2, ticket_number: 7, status: 'no_show', outcome: 'no_show', prize_text: 'Cash jackpot', prize_type: 'cash', prize_value_cents: 50050, drawn_at: '2026-10-09T09:05:00.000Z' }];
  var stranger = DB.vp_member_draws[0];
  requireStaff = async function () { var e = new Error('Not authorised: you are not staff at this venue'); e.status = 403; throw e; };
  r = await exportCsv(EXPORT);
  requireStaff = keepStaff;
  show('a host with no staff row at this venue is refused 403 and gets no file', r.status === 403 && !r._b, JSON.stringify(r));
  r = await exportCsv('https://w/host/draws/export?format=csv');
  show('no venue_id: 400', r.status === 400, JSON.stringify(r));
  r = await exportCsv('https://w/host/draws/export?venue_id=' + VENUE + '&format=json');
  show('only csv is offered', r.status === 400, JSON.stringify(r));
  r = await exportCsv(EXPORT);
  var lines = (r._b || '').split('\r\n').filter(function (l) { return l !== ''; });
  show('CONTROL: staff get a 200 and a text/csv attachment with CORS', r.status === 200 && /^text\/csv/.test(r.headers['Content-Type'] || '') && /attachment/.test(r.headers['Content-Disposition'] || '') && r.headers['Access-Control-Allow-Origin'] === CORS['Access-Control-Allow-Origin'], JSON.stringify(r.headers));
  show('the first line is the retention note: keep it 7 years, the venue is the conductor', lines[0].charAt(0) === '#' && /7 years/.test(lines[0]) && /conductor/.test(lines[0]), lines[0]);
  show('the second line is the header: when, game, draw name, number, winner, prize, outcome', lines[1] === 'when_utc,game,draw_name,number,winner,prize,outcome', lines[1]);
  var data = lines.slice(2);
  show('two members results and two raffle results: four rows', data.length === 4, data.length + ' rows: ' + JSON.stringify(data));
  // The rig's clock is 19 Sep 2026, so the two members rows (drawn "now") come before the 9 Oct raffle rows.
  show('oldest first', data[0].indexOf('2026-09-19') === 0 && data[1].indexOf('2026-09-19') === 0 && data[2].indexOf('2026-10-09T09:00') === 0 && data[3].indexOf('2026-10-09T09:05') === 0, JSON.stringify(data));
  show('a members row names the draw, the member number, the winner (as the venue shows names) and the jackpot', /,members draw,Friday Badge Draw,1\d\d,Member N,\$500\.00,"not claimed, jackpot rolled over"$/.test(data[0]), data[0]);
  show('and the claim: who was paid, and how much', /,members draw,Friday Badge Draw,1\d\d,Member N,\$600\.00,claimed$/.test(data[1]), data[1]);
  show('a raffle row carries the ticket, the prize (quoted, with its quotes doubled) and the outcome in words', /,raffle,Meat tray raffle,42,,"Meat tray, ""the big one""",claimed$/.test(data[2]), data[2]);
  show('a redrawn ticket says so, and a cash prize carries its value', /,raffle,Meat tray raffle,7,,Cash jackpot \$500\.50,"not claimed, redrawn"$/.test(data[3]), data[3]);
  DB.vp_member_draw_results[0].winner_name = '=HYPERLINK("x")';
  r = await exportCsv(EXPORT);
  show('a name that starts like a spreadsheet formula is neutralised', /,"'=HYPERLINK\(""x""\)",/.test(r._b), r._b.split('\r\n')[4]);
  DB.vp_member_draw_results = [];
  for (var k = 0; k < 1200; k++) DB.vp_member_draw_results.push({ id: uuid(5000 + k), draw_id: DRAW, outcome: 'jackpot_rolled', amount_cents: 1000 + k, member_number: 101, winner_name: 'M N1', drawn_at: new Date(Date.UTC(2024, 0, 1) + k * 86400000).toISOString() });
  r = await exportCsv(EXPORT);
  var n = r._b.split('\r\n').filter(function (l) { return l !== ''; }).length - 2 - 2;   // minus the note, the header and the two raffle rows
  show('1,200 members results come out as 1,200 rows (PostgREST stops at 1,000 a page)', n === 1200, n + ' rows');
  r = await exportCsv(EXPORT, undefined);
  show('CONTROL: called without CORS headers it still answers', r.status === 200, r.status);
  DB.vp_member_draws = [];
  r = await exportCsv(EXPORT);
  show('a venue with no draws at all still gets the note and the header', r.status === 200 && r._b.split('\r\n').filter(Boolean).length === 4, JSON.stringify(r._b));

  print('the members console: the hint beside the field and the warning above the state figure');
  var capAdvice = new Function('money', lift('venueplay/app/members/host.html', 'function capAdvice(') + '\nreturn capAdvice;')(moneyStub);
  var a = capAdvice(null, 400, 200, 100);
  show('no state figure: the plain hint and no warning', /Leave blank for no maximum/.test(a.hint) && a.warn === '', JSON.stringify(a));
  a = capAdvice({ cents: 3000000, why: 'NSW free lottery: $30,000, and no cash prizes', where: 'the New South Wales figure' }, 400, 200, 100);
  show('the state figure is a sentence of its own, then the reason as its own sentence, then the generic line (16 Oct 2026)', a.hint.indexOf('The New South Wales figure is $30,000. NSW free lottery: $30,000, and no cash prizes. Leave blank for no maximum.') === 0, a.hint);
  show('and under it, no warning', a.warn === '', a.warn);
  a = capAdvice({ cents: 700000, why: 'NSW progressive lottery (a jackpot that rolls over week to week): cash prizes up to $7,000, no authority up to $30,000 in total' }, null, null, null);
  show('with no state adjective it still reads as sentences, and the reason is never spliced into ours', a.hint.indexOf('Your state\'s figure is $7,000. NSW progressive lottery (') === 0 && !/figure is \$7,000\. [^.]*: \$7,000\. Leave/.test(a.hint) && !/: \$7,000\. Leave blank/.test(a.hint), a.hint);
  a = capAdvice({ cents: 250000, why: 'ACT exempt lottery' }, 4000, 200, 100);
  show('a maximum typed above the state figure warns, and says whose call it is', /Above your state's figure of \$2,500/.test(a.warn) && /maximum you typed \(\$4,000\)/.test(a.warn) && /your call/.test(a.warn), a.warn);
  a = capAdvice({ cents: 250000, why: 'ACT exempt lottery' }, 2000, 3000, 100);
  show('the current jackpot above the state figure warns too', /current jackpot \(\$3,000\)/.test(a.warn), a.warn);
  a = capAdvice(null, 500, 600, 100);
  show('a current jackpot above the maximum says it will not save', /will not save/.test(a.warn), a.warn);
  var capLineText = new Function('money', lift('venueplay/app/members/host.html', 'function capLineText(') + '\nreturn capLineText;')(moneyStub);
  show('the console line says the jackpot is at its maximum, and whose the reserve is', /at its maximum of \$650/.test(capLineText({ max_jackpot_cents: 65000, current_jackpot_cents: 65000, reserve_cents: 15000 })) && /Reserve \$150/.test(capLineText({ max_jackpot_cents: 65000, current_jackpot_cents: 65000, reserve_cents: 15000 })) && /you decide/.test(capLineText({ max_jackpot_cents: 65000, current_jackpot_cents: 65000, reserve_cents: 15000 })), capLineText({ max_jackpot_cents: 65000, current_jackpot_cents: 65000, reserve_cents: 15000 }));
  show('and nothing at all for a draw with no maximum', capLineText({ current_jackpot_cents: 65000 }) === '', capLineText({ current_jackpot_cents: 65000 }));

  print('the raffle console: a cash jackpot above the state figure warns and does not block');
  var rfMoney = function (d) { var n = Number(d || 0); return '$' + (n % 1 ? n.toFixed(2) : n.toLocaleString('en-AU')); };
  var jackpotWarning = new Function('money', lift('venueplay/app/raffle/host.html', 'function jackpotWarning(') + '\nreturn jackpotWarning;')(rfMoney);
  var w = jackpotWarning({ cents: 500000, why: 'NSW promotional raffle: $5,000 in total prizes', where: 'the New South Wales figure' }, true, 6000);
  show('$6,000 against a $5,000 figure: warned as plain sentences, and told the draw still goes (16 Oct 2026)', w.indexOf('This jackpot ($6,000) is above the New South Wales figure of $5,000. NSW promotional raffle: $5,000 in total prizes. You can still draw') === 0, w);
  w = jackpotWarning({ cents: 2306000, why: 'Victoria raffle: above $23,060 in prizes needs a VGCCC permit and printed tickets; no cash prizes', where: 'the Victorian figure' }, true, 30000);
  show('the audit\'s own example reads "is above the Victorian figure of $23,060." with the reason after it, never "is above Victoria raffle: ... of $23,060"', /^This jackpot \(\$30,000\) is above the Victorian figure of \$23,060\. Victoria raffle: /.test(w) && !/is above Victoria raffle/.test(w) && !/tickets; no cash prizes of \$23,060/.test(w), w);
  w = jackpotWarning({ cents: 0, why: 'Victoria raffle: no cash prizes at all (the one exception is travel, up to 10% of the prize value); a prize pool above $23,060 needs a VGCCC permit and printed tickets', where: 'the Victorian figure' }, true, 500);
  show('a figure of $0 (Victorian raffles have no cash prizes): ANY cash jackpot warns, and it is said as nil, not "above $0"', /^This jackpot \(\$500\) is a cash prize, and the Victorian figure for cash prizes in a raffle is nil\. Victoria raffle: no cash prizes/.test(w) && !/above \$0/.test(w) && /You can still draw/.test(w), w);
  w = jackpotWarning({ cents: 250000, why: 'ACT raffle: $2,500 without a permit', where: 'the figure for ACT' }, true, 4000);
  show('a Canberra venue reads "above the figure for ACT", never "the ACT"', /is above the figure for ACT of \$2,500\./.test(w) && !/\bthe ACT\b/.test(w), w);
  w = jackpotWarning({ cents: 500000, why: 'x' }, true, 6000);
  show('with no state adjective: "your state\'s figure"', /above your state's figure of \$5,000\. x\. You can still draw/.test(w), w);
  show('under the figure: nothing', jackpotWarning({ cents: 500000, why: 'x' }, true, 4000) === '', jackpotWarning({ cents: 500000, why: 'x' }, true, 4000));
  show('no cash jackpot: nothing', jackpotWarning({ cents: 500000, why: 'x' }, false, 6000) === '');
  show('no figure confirmed for the state: nothing', jackpotWarning({ cents: null, why: 'x' }, true, 6000) === '' && jackpotWarning(null, true, 6000) === '');
  var HOST = readFile('venueplay/app/raffle/host.html');
  var sd = HOST.indexOf('function startDraw(){'), sdEnd = HOST.indexOf('\n  }\n', sd);
  var startDraw = HOST.slice(sd, sdEnd);
  show('startDraw warns and carries on: renderJackWarn is called and never returns', /renderJackWarn\(\);/.test(startDraw) && !/renderJackWarn\(\)\)\s*return|if\(renderJackWarn/.test(startDraw), startDraw.slice(startDraw.indexOf('renderJackWarn') - 40, startDraw.indexOf('renderJackWarn') + 60).replace(/\s+/g, ' '));

  print('the members TV: "Jackpot at its maximum" when the host says capped');
  var SCREEN = readFile('venueplay/app/members/screen.html');
  var els = {};
  function el(id) { if (!els[id]) els[id] = { id: id, innerHTML: '', textContent: '', classList: { add: function () {}, remove: function () {} } }; return els[id]; }
  var noop = function () {};
  var showRollover = new Function('$', 'money', 'esc', 'stopAds', 'stopSpin', 'stopCelebrate', 'hideAll', 'holdResult', 'state', 'ROLLOVER_HOLD_MS',
    lift('venueplay/app/members/screen.html', 'function showRollover(') + '\nreturn showRollover;')(el, moneyStub, String, noop, noop, noop, noop, noop, { drawName: 'Friday' }, 30000);
  showRollover(65000, 10000, 104, 'Member N4', true);
  show('capped: the wall says the jackpot is at its maximum, not "Up $100"', /Jackpot at its maximum/.test(el('resSub').innerHTML) && !/Up <b>/.test(el('resSub').innerHTML), el('resSub').innerHTML);
  showRollover(60000, 10000, 104, 'Member N4', false);
  show('CONTROL: not capped, the wall says Up $100 as before', /Up <b>\$100<\/b>/.test(el('resSub').innerHTML), el('resSub').innerHTML);
  show('the TV is told capped by the rollover message', /showRollover\(m\.nextJackpotCents, m\.incrementCents, m\.missedNumber, m\.missedName, !!m\.capped\)/.test(SCREEN));
  var fillBoard = new Function('$', 'esc', 'money', 'state', lift('venueplay/app/members/screen.html', 'function fillBoard(') + '\nreturn fillBoard;');
  var boardEl = { innerHTML: '' };
  fillBoard(function () { return boardEl; }, String, moneyStub, { draws: [{ name: 'Friday', jackpotCents: 65000, atMax: true }, { name: 'Sunday', jackpotCents: 20000 }] })();
  show('the draws board marks the draw that sits at its maximum, and only that one', (boardEl.innerHTML.match(/Jackpot at its maximum/g) || []).length === 1 && boardEl.innerHTML.indexOf('Jackpot at its maximum') < boardEl.innerHTML.indexOf('Sunday'), boardEl.innerHTML);
  var MHOST = readFile('venueplay/app/members/host.html');
  var dfs = MHOST.indexOf('function drawsForScreen(){'), dfsEnd = MHOST.indexOf('\n  }\n', dfs);
  show('the console sends atMax with each draw on the board', /atMax: d\.max_jackpot_cents!=null && \(d\.current_jackpot_cents\|\|0\)>=d\.max_jackpot_cents/.test(MHOST.slice(dfs, dfsEnd)));
  var onRoll = MHOST.slice(MHOST.indexOf('function onRollover(){'), MHOST.indexOf('\n  }\n', MHOST.indexOf('function onRollover(){')));
  show('and capped with the rollover message', /t:"rollover"[^}]*capped:!!r\.capped/.test(onRoll), onRoll.slice(onRoll.indexOf('t:"rollover"'), onRoll.indexOf('t:"rollover"') + 160));

  print('the shared download helper, and that both consoles load it');
  var fetched = [], clicked = [], msgs = { textContent: '' }, btn = { disabled: false };
  var DR = {};
  new Function('window', readFile('venueplay/app/vp-drawrecord.js'))(DR);
  var fakeDoc = { createElement: function () { return { click: function () { clicked.push(this.download); } }; }, body: { appendChild: noop, removeChild: noop } };
  DR.URL = { createObjectURL: function () { return 'blob:x'; }, revokeObjectURL: noop }; DR.setTimeout = noop;
  var ok1 = await DR.VPDrawRecord.download({ api: 'https://api', venueId: VENUE, getToken: function () { return Promise.resolve('tok-1'); }, button: btn, message: msgs, document: fakeDoc,
    fetch: function (u, o) { fetched.push([u, o]); return Promise.resolve({ ok: true, status: 200, blob: function () { return Promise.resolve({}); } }); } });
  show('it asks the Worker for this venue\'s CSV with the host\'s token', ok1 === true && fetched.length === 1 && fetched[0][0] === 'https://api/host/draws/export?venue_id=' + VENUE + '&format=csv' && fetched[0][1].headers.Authorization === 'Bearer tok-1', JSON.stringify(fetched));
  show('and saves it as a dated .csv', clicked.length === 1 && /^venueplay-draw-record-\d{4}-\d{2}-\d{2}\.csv$/.test(clicked[0]) && /7 years/.test(msgs.textContent) && btn.disabled === false, clicked[0] + ' | ' + msgs.textContent);
  var ok2 = await DR.VPDrawRecord.download({ api: 'https://api', venueId: VENUE, getToken: function () { return Promise.resolve('tok-1'); }, button: btn, message: msgs, document: fakeDoc,
    fetch: function () { return Promise.resolve({ ok: false, status: 403, json: function () { return Promise.resolve({ error: 'Not authorised: you are not staff at this venue' }); } }); } });
  show('a refusal is shown in the Worker\'s words and the button comes back', ok2 === false && /not staff/.test(msgs.textContent) && btn.disabled === false, msgs.textContent);
  show('both host consoles load /app/vp-drawrecord.js and have the button', [MHOST, HOST].every(function (p) { return p.indexOf('<script src="/app/vp-drawrecord.js"></script>') >= 0 && p.indexOf('id="downloadRecordBtn"') >= 0 && p.indexOf('VPDrawRecord.download({') >= 0; }));
  finished = true;
})().catch(function (e) { print('  FAIL the test itself threw: ' + e + '\n' + e.stack); bad++; });
drainMicrotasks();
if (!finished) { print('  FAIL the test did not run to the end'); bad++; }
if (bad) throw new Error('jackpot cap 15 Oct: ' + bad + ' of ' + ran + ' failed');
print('PASS ' + ran + ' checks');
