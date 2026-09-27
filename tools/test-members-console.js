/* THE MEMBERS DRAW CONSOLE TELLS THE HOST THE TRUTH.

   Four faults from the 27 Sep 2026 audit of venueplay/app/members/host.html. Every check here
   RUNS the shipped functions, lifted out of the page by name, against a fake page and a fake
   supabase-js client. None of it reads the source for a word.

   1. Error bars that stay up after they stop being true: "Time is up on #1204" after the
      member claimed or the jackpot rolled over.
   2. A failed load read as an empty venue. supabase-js resolves {data:null, error} rather than
      throwing, and every read took (r.data||[]), so a network blip landed a manager on the
      Create draw form (a duplicate draw could be created), showed 0 members, and the real
      "Could not load" message could never fire.
   5. A channel blip blocked the draw with "No TV connected yet" while the TV was on the wall.
      The raffle queues and lets the TV catch up; so does this now.
   6. The channel callback: a replaced channel reporting CLOSED, or the page being left, marked
      the console disconnected, and a channel closed while the tablet slept never came back.

   Run:  jsc tools/test-members-console.js
         jsc tools/test-members-console.js -- /path/to/other/host.html   (to prove it goes red)
*/
var PAGE = (typeof arguments !== 'undefined' && arguments.length) ? arguments[0] : 'venueplay/app/members/host.html';
var H = readFile(PAGE);
if (!H || H.length < 5000) throw new Error('could not read ' + PAGE);

var PASS = 0, FAIL = 0;
function check(name, cond, saw) {
  if (cond) { PASS++; print('  ok   ' + name); }
  else { FAIL++; print('  FAIL ' + name + (saw !== undefined ? '   saw: ' + JSON.stringify(saw) : '')); }
}
function lift(name) {
  var i = H.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('cannot find ' + name + ' in ' + PAGE + ': a test that cannot find its subject cannot fail');
  var d = 0, k = H.indexOf('{', i);
  do { if (H[k] === '{') d++; else if (H[k] === '}') d--; k++; } while (d > 0 && k < H.length);
  return H.slice(i, k) + '\n';
}
function tryLift(name) { try { return lift(name); } catch (e) { print('  (no ' + name + ' in this page)'); return ''; } }
function liftVar(re) { var m = re.exec(H); return m ? m[0] + '\n' : ''; }
function section(t) { print(''); print(t); }

/* ---------------- a fake page ---------------- */
function Cls() { this.s = {}; }
Cls.prototype.add = function (c) { this.s[c] = 1; };
Cls.prototype.remove = function (c) { delete this.s[c]; };
Cls.prototype.contains = function (c) { return !!this.s[c]; };
Cls.prototype.toggle = function (c, on) { if (on === undefined) on = !this.s[c]; if (on) this.s[c] = 1; else delete this.s[c]; };
function El(id) { this.id = id; this.value = ''; this.disabled = false; this.textContent = ''; this.innerHTML = ''; this.kids = []; this.classList = new Cls(); this.selected = false; this.title = ''; }
El.prototype.appendChild = function (k) { this.kids.push(k); };
El.prototype.focus = function () {};
El.prototype.setAttribute = function (k, v) { this[k] = v; };
var els = {};
function $(id) { if (!els[id]) els[id] = new El(id); return els[id]; }
var document = { createElement: function () { return new El(''); }, querySelector: function () { return null; }, querySelectorAll: function () { return []; } };
var window = { scrollTo: function () {} };
var console = { error: function () {} };
var intervals = [];
function setTimeout(fn) { return 0; }
function clearTimeout() {}
function setInterval(fn) { intervals.push(fn); return intervals.length; }
function clearInterval(id) { if (intervals[id - 1]) intervals[id - 1] = null; }
function tick(n) { for (var j = 0; j < n; j++) intervals.forEach(function (f) { if (f) f(); }); }
function confirm() { return true; }
function errorShown() { return $('hostErrBar').classList.contains('show') ? $('hostErrText').textContent : ''; }

var sent = [], apiCalls = [], apiReply = null;
function send(o) { sent.push(o); }
function sendState() {} function sendIdle() {}
function show(id, on) { $(id).classList.toggle('hidden', !on); }
function esc(s) { return String(s); }
function fmtDate() { return ''; }
function clearTimers() { intervals = []; }
function hideWinnerCard() {}
function saveRound() {} function clearRound() {} function restoreRound() {}
function scheduleIdle() {}
function renderNameSeg() {}
function apiPost(path, body) {
  apiCalls.push(path);
  return apiReply ? Promise.resolve(apiReply) : new Promise(function () {});
}
var CLAIM_HOLD_MS = 60000, ROLLOVER_HOLD_MS = 30000;

/* A fake supabase-js: a failed read RESOLVES {data:null, error}, exactly as the real one does.
   It honours range() so the members pages behave like PostgREST. */
var FAILS = {};   // table -> true to fail every read, or a number: fail from that offset on
var DB = {
  vp_member_draws: [{ id: 'd1', name: 'Friday Members Draw', current_jackpot_cents: 50000, draw_day: 'Friday', roster_id: 'r1', time_to_claim_seconds: 30 }],
  vp_member_rosters: [{ id: 'r1' }],
  vp_members: []
};
for (var n = 1; n <= 1400; n++) DB.vp_members.push({ id: 'm' + n, member_number: 1000 + n, status: 'valid', roster_id: 'r1', first_name: 'A', last_name: 'B' });
var client = {
  from: function (table) {
    var lo = 0, hi = 1e9;
    var q = {
      select: function () { return q; }, eq: function () { return q; }, in: function () { return q; },
      order: function () { return q; }, range: function (a, b) { lo = a; hi = b; return q; },
      then: function (ok, bad) {
        var f = FAILS[table];
        if (f === true || (typeof f === 'number' && lo >= f)) return Promise.resolve({ data: null, error: { message: 'Failed to fetch' } }).then(ok, bad);
        var rows = DB[table].slice(lo, Math.min(hi + 1, lo + 1000));
        return Promise.resolve({ data: rows, error: null }).then(ok, bad);
      }
    };
    return q;
  },
  channel: null, removeChannel: null
};

var G = { venueId: 'v1', role: 'manager', canManage: true, code: '', nameDisplay: 'abbrev_last',
          draws: [], members: [], currentDrawId: '', round: null, busy: false, drawTimer: null, idleTimer: null, claimTimer: null,
          venue: { timezone: 'Australia/Brisbane' } };
var subscribed = true, ch = null, sendQueue = [];

eval(liftVar(/var _errKey="";/));
eval(lift('hostError')); eval(lift('clearHostError'));
eval(tryLift('clearHostErrorIf'));
eval(liftVar(/var LOAD_FAIL_MSG="[^"]*";/));
var OPTIONAL = ['loadFail', 'loadFailed', 'retryLoad'];
for (var oi = 0; oi < OPTIONAL.length; oi++) eval(tryLift(OPTIONAL[oi]));
var LIFTED = ['money', 'todayWeekday', 'mmss', 'stopClaimTimer', 'updateClaimCd', 'curDraw', 'drawMembers', 'activeMembers',
 'renderStats', 'renderDrawSelect', 'renderMembers', 'renderSettings', 'applyRoleGates', 'alreadyDrawnTonight',
 'drawBtnIdle', 'loadAll', 'loadDraws', 'loadAllMembers', 'loadRoster', 'saveSettings', 'startDraw',
 'revealWinner', 'onClaim', 'onRollover'];
for (var li = 0; li < LIFTED.length; li++) eval(lift(LIFTED[li]));

/* The page's own boot handler for a failed load, lifted from the page, not written here. */
var bootCatchSrc = /loadAll\(\)\.catch\((function\(e\)\{[\s\S]*?\n      \})\)\.then\(/.exec(H);
if (!bootCatchSrc) throw new Error('cannot find the boot loadAll().catch handler in ' + PAGE);
var bootCatch = eval('(' + bootCatchSrc[1] + ')');
function boot() {
  var rejected = null;
  loadAll().catch(function (e) { rejected = e; bootCatch(e); });
  drainMicrotasks();
  applyRoleGates();
  return rejected;
}
function freshG() { G.draws = []; G.members = []; G.currentDrawId = ''; G.round = null; G.busy = false; G.loadFailed = false; clearHostError(); apiCalls = []; sent = []; }

/* ================= 2. a failed load is not an empty venue ================= */
section('2. A failed load says so, and never looks like a new venue');

freshG(); FAILS = { vp_member_draws: true };
var why = boot();
check('a failed draws read REJECTS the load (supabase-js does not throw by itself)', !!why, why && String(why));
check('the host is told it could not load, in the bar', /Could not load/.test(errorShown()), errorShown());
check('with a Try again button', !$('hostErrRetry').classList.contains('hidden') && H.indexOf('id="hostErrRetry"') > 0);
check('the save button does NOT offer to create a draw', $('saveSettingsBtn').textContent !== 'Create draw', $('saveSettingsBtn').textContent);
check('and is not usable while the draws are unknown', $('saveSettingsBtn').disabled === true);
var selTexts = $('drawSel').kids.map(function (o) { return o.textContent; });
check('the draw picker says it could not load, not "Set up your first draw"', !selTexts.some(function (t) { return /Set up your first draw/.test(t); }), selTexts);
check('the member count is not 0', String($('memberCount').textContent) !== '0' && String($('runValid').textContent) !== '0', $('memberCount').textContent);

$('setName').value = 'Friday Members Draw';
apiCalls = [];
saveSettings();
check('a manager tapping Save cannot create a duplicate draw', apiCalls.indexOf('/host/members/settings') < 0, apiCalls);
startDraw();
check('Draw is refused while nothing loaded', apiCalls.indexOf('/host/members/draw') < 0 && !G.busy, apiCalls);

freshG(); FAILS = { vp_members: 1000 };   // the second page of members fails
why = boot();
check('a failed SECOND page of members rejects too, never a short list', !!why && G.members.length !== 1000, { rejected: !!why, members: G.members.length });
check('and the count does not claim 1,000 members', String($('memberCount').textContent) !== '1000', $('memberCount').textContent);

freshG(); FAILS = { vp_member_rosters: true };
why = boot();
check('a failed members-list read is not "no members saved"', !!why && !/No members saved/.test($('memberList').innerHTML), $('memberList').innerHTML);

/* Try again, with the network back. */
FAILS = {};
if (typeof retryLoad === 'function') { retryLoad(); drainMicrotasks(); }
check('Try again loads the draws and all 1,400 members', G.draws.length === 1 && G.members.length === 1400, { draws: G.draws.length, members: G.members.length });
check('and takes the "Could not load" message down', errorShown() === '', errorShown());
check('and the count is right', String($('memberCount').textContent) === '1400', $('memberCount').textContent);

freshG(); FAILS = {};
why = boot();
check('a healthy load is not treated as a failure', !why && errorShown() === '' && G.draws.length === 1, { why: why && String(why), err: errorShown() });

/* ================= 5. a channel blip does not block the draw ================= */
section('5. A channel blip does not stop the draw; the TV catches up');

freshG(); FAILS = {}; boot();
subscribed = false;
startDraw();
check('with the channel between subscriptions the draw still goes to the server', apiCalls.indexOf('/host/members/draw') >= 0, apiCalls);
check('and "No TV connected yet" is not raised', !/No TV connected/.test(errorShown()), errorShown());
check('the spin is queued for the TV, not dropped', sent.some(function (m) { return m.t === 'drawing'; }), sent.map(function (m) { return m.t; }));
check('the host is told the TV is catching up', /reconnecting/i.test($('drawNote').textContent), $('drawNote').textContent);
subscribed = true;

freshG(); FAILS = {}; boot(); G.members.forEach(function (m) { m.status = 'excluded'; });
startDraw();
check('the safety the draw needs stays: no active members still refuses', apiCalls.length === 0 && /No active members/.test(errorShown()), errorShown());
G.members.forEach(function (m) { m.status = 'valid'; });

/* ================= 1. an error comes down when it stops being true ================= */
section('1. "Time is up" comes down once the host has made the call');

function drawAndRunOut() {
  freshG(); FAILS = {}; boot();
  G.busy = true;
  revealWinner({ draw_id: 'd1', member_id: 'm204', member_number: 1204, winner_name: 'Sam T', jackpot_cents: 50000 });
  tick(31);
}
drawAndRunOut();
check('the claim clock runs out and says so', /Time is up on #1204/.test(errorShown()), errorShown());
apiReply = { new_jackpot_cents: 10000, amount_cents: 50000 };
onClaim(); drainMicrotasks();
check('Claim takes "Time is up on #1204" down', errorShown() === '', errorShown());

drawAndRunOut();
onRollover(); drainMicrotasks();
check('Jackpot to next week takes it down too', errorShown() === '', errorShown());

drawAndRunOut();
hostError('Could not save that setting.');
onClaim(); drainMicrotasks();
check('but a claim does NOT take down an unrelated error', /Could not save/.test(errorShown()), errorShown());
apiReply = null;

/* ================= 6. the channel: its own, and not while leaving ================= */
section('6. Only this page\'s own channel can say the TV link is down');

var chans = [];
client.channel = function (name) {
  var c = { name: name, cb: null, on: function () { return c; }, subscribe: function (cb) { c.cb = cb; return c; }, send: function () {} };
  chans.push(c); return c;
};
client.removeChannel = function (c) { if (c.cb) c.cb('CLOSED'); };   // what supabase-js does, inside the call
function flushQueue() {} function onPair() {} function reassertToTv() {} function rawSend() {}
var hasOpen = H.indexOf('function openChannel(') >= 0;
if (hasOpen) eval(lift('openChannel'));
eval(liftVar(/var _leaving=false, _closed=false;/));
eval(lift('connect')); eval(lift('reassertOnReturn'));
var _lastReassert = 0;
var pagehideSrc = /window\.addEventListener\("pagehide", function\(\)\{[\s\S]*?\n  \}\);/.exec(H);
var pagehide = eval('(' + pagehideSrc[0].replace(/^window\.addEventListener\("pagehide", /, '').replace(/\);$/, '') + ')');

G.round = null;
connect('ABCDEF');
chans[chans.length - 1].cb('SUBSCRIBED');
check('a subscribed channel is marked up', subscribed === true);
$('statusText').textContent = 'Connected';
if (hasOpen) {
  openChannel('ABCDEF');
  check('replacing the channel does not report the link as down', $('statusText').textContent !== 'Reconnecting', $('statusText').textContent);
  chans[chans.length - 1].cb('SUBSCRIBED');
  chans[chans.length - 2].cb('CLOSED');
  check('a late CLOSED from the replaced channel does not unmark the new one', subscribed === true, subscribed);
} else {
  check('a replaced channel is let go of before it is removed (openChannel)', false, 'no openChannel in this page');
  check('a late CLOSED from the replaced channel does not unmark the new one', false, 'no openChannel in this page');
}
$('statusText').textContent = 'Connected';
pagehide();
chans[chans.length - 1].cb('CLOSED');
check('the socket closing as the page is left is not shown as "Reconnecting"', $('statusText').textContent !== 'Reconnecting', $('statusText').textContent);
check('but sends queue while it is closed, rather than going into a dead socket', subscribed === false, subscribed);
var before = chans.length;
reassertOnReturn();
check('coming back opens a fresh channel, because a CLOSED one never rejoins by itself', chans.length === before + 1, chans.length - before);
chans[chans.length - 1].cb('TIMED_OUT');
check('a real drop on a live page still says Reconnecting', $('statusText').textContent === 'Reconnecting', $('statusText').textContent);

drainMicrotasks();
print('');
print(PASS + ' passed, ' + FAIL + ' failed');
if (FAIL) { print('FAILED ' + FAIL); throw new Error(FAIL + ' check(s) failed'); }
print('PASS');
