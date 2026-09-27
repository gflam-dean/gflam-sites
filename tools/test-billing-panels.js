/* THE ACCOUNT PAGE'S DRAW, RAFFLE, MEMBERS AND SCREEN PANELS (audit 27 Sep 2026).

   Three faults, each one a way for an owner to be shown something untrue and act on it:

   A. A FAILED READ SHOWED AS EMPTY. supabase-js does not throw on a failed query, it
      resolves { data:null, error }, and every read in these panels did `(r && r.data) || []`.
      A members list that could not be read said "No members yet." to a club with thousands,
      which is an invitation to import them all again. With the draws read failed, Save made a
      SECOND draw. A failed raffle read left the previous venue's routine in the boxes.

   B. THE CURRENT JACKPOT WAS RECALCULATED behind the owner's back (start + weekly increase x
      weeks since the start date) whenever a draw field changed. That is only true of a draw
      nobody has won: the game Worker RESETS it on a claim and GROWS it on a rollover. Editing
      the weekly increase on a draw won in August put 38 weeks' worth on the TV.

   C. THE venues[0] TRAP. Raffles and Members opened on the account's FIRST venue (and so did
      Screen, because screen-get with no venue answers for venues[0]). A group owner who came
      from venue B edited venue A, silently.

   This RUNS the functions lifted out of venueplay/app/billing.html under jsc, against a fake
   DOM, a fake supabase-js client that resolves { data, error, count } the way the real one
   does, and fake Worker calls. Nothing here is a copy of the page's logic.

   Run:  jsc tools/test-billing-panels.js
         jsc tools/test-billing-panels.js -- path/to/another/billing.html   (prove it red)
*/
var PAGE = (typeof arguments !== 'undefined' && arguments[0]) || 'venueplay/app/billing.html';
var HTML = readFile(PAGE);
if (!HTML || HTML.length < 10000) throw new Error('could not read ' + PAGE);
var SCRIPT = (function () {
  var all = HTML.split('<script>');
  var last = all[all.length - 1];
  return last.slice(0, last.indexOf('</script>'));
})();

var PASS = 0, FAIL = 0;
function check(name, cond, saw) {
  if (cond) { PASS++; print('  ok   ' + name); }
  else { FAIL++; print('  FAIL ' + name + (saw !== undefined ? '   saw: ' + JSON.stringify(saw) : '')); }
}

/* Lift a top-level function of the page script by name. They sit at two spaces of indent
   inside the page's IIFE: a one-liner ends on its own line, anything else at "\n  }\n". */
function lift(name) {
  var at = SCRIPT.indexOf('\n  function ' + name + '(');
  if (at < 0) return null;
  var start = at + 1;
  var eol = SCRIPT.indexOf('\n', start);
  var first = SCRIPT.slice(start, eol);
  var open = (first.match(/\{/g) || []).length, close = (first.match(/\}/g) || []).length;
  if (open && open === close) return first;
  var end = SCRIPT.indexOf('\n  }\n', start);
  return SCRIPT.slice(start, end + 4);
}
var NAMES = [
  'esc', 'preferredVenueIds', 'defaultVenue', 'venueNameIn', 'fillVenuePicker', 'showLoadFailed', 'readFailed',
  'loadScreenPanel', 'showScreenVenue', 'initScreen', 'loadScreenFor', 'fillScreen', 'renderLogo',
  'paintScreenVenue', 'screenNameNow', 'setTvLinks', 'tvHref', 'saveScreen', 'gatherScreen',
  'mdVenueName', 'paintMdVenue', 'toCents', 'toDollars', 'fillMembersDraw', 'renderDrawPicker', 'mdNotReady',
  'mdCountFailed', 'loadMembersDrawFor', 'saveMembersDraw', 'fixMemberName', 'removeMember', 'importMembers',
  'unquoteCols', 'removeDraw', 'membersDrawOffTv', 'mdWeekday', 'mdWeeksSince', 'mdRecalc', 'mdWorkOutJackpot',
  'initMembersDraws', 'loadMembersPanel',
  'rfVenueName', 'paintRfVenue', 'rfNotReady', 'loadRafflePrizes', 'loadRaffleRoutine', 'loadPrizeTally',
  'loadRafflesFor', 'saveRaffleRoutine', 'clearRaffleRoutine', 'addRafflePrize', 'removeRafflePrize',
  'initRaffles', 'loadRafflePanel', 'loadDrawLog', 'renderDrawLog', 'dlWhen', 'downloadDrawLog',
  'loadNightsFor', 'initNights'
];
var SRC = '', MISSING = [];
NAMES.forEach(function (n) { var s = lift(n); if (s) SRC += s + '\n'; else MISSING.push(n); });
/* The entry points must exist in ANY version of the page, or this suite tests nothing. */
['initScreen', 'initRaffles', 'initMembersDraws', 'initNights', 'loadMembersDrawFor', 'saveMembersDraw', 'fillMembersDraw', 'loadRafflesFor']
  .forEach(function (n) { if (MISSING.indexOf(n) >= 0) throw new Error(n + ' is not in ' + PAGE + ' any more'); });

/* ---------------- a fake DOM, just enough of one ---------------- */
function El(id, tag) {
  var self = this;
  this.id = id; this.tagName = String(tag || 'div').toUpperCase();
  this.children = []; this.options = []; this.selectedIndex = -1; this._text = ''; this._html = ''; this._loose = '';
  this.hidden = false; this.className = ''; this.style = {}; this.disabled = false; this.listeners = {}; this.attrs = {};
  this.href = ''; this.type = ''; this.selected = false; this._value = '';
  Object.defineProperty(this, 'textContent', {
    get: function () { return self._text + self._html.replace(/<[^>]*>/g, '') + self.children.map(function (c) { return c.textContent; }).join(' '); },
    set: function (v) { self._text = String(v == null ? '' : v); self._html = ''; self.children = []; if (self.tagName === 'SELECT') { self.options = []; self.selectedIndex = -1; } }
  });
  Object.defineProperty(this, 'innerHTML', {
    get: function () { return self._html + self.children.map(function (c) { return c.textContent; }).join(' '); },
    set: function (v) { self._html = String(v); self._text = ''; self.children = []; if (self.tagName === 'SELECT') { self.options = []; self.selectedIndex = -1; } }
  });
  Object.defineProperty(this, 'value', {
    get: function () {
      if (self.tagName !== 'SELECT') return self._value;
      return self.selectedIndex >= 0 && self.options[self.selectedIndex] ? self.options[self.selectedIndex].value : self._loose;
    },
    set: function (v) {
      v = String(v == null ? '' : v);
      if (self.tagName !== 'SELECT') { self._value = v; return; }
      for (var i = 0; i < self.options.length; i++) if (self.options[i].value === v) { self.selectedIndex = i; return; }
      self.selectedIndex = -1; self._loose = v;
    }
  });
}
El.prototype.appendChild = function (c) {
  this.children.push(c);
  if (this.tagName === 'SELECT' && c.tagName === 'OPTION') {
    this.options.push(c);
    if (c.selected || this.selectedIndex < 0) this.selectedIndex = this.options.length - 1;
  }
  return c;
};
El.prototype.addEventListener = function (ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); };
El.prototype.fire = function (ev) {
  var self = this;
  (this.listeners[ev] || []).forEach(function (fn) { fn.call(self, { target: self }); });
  if (ev === 'change' && this.onchange) this.onchange();
};
El.prototype.click = function () { this.fire('click'); };
El.prototype.focus = function () {};
El.prototype.remove = function () {};
El.prototype.closest = function () { return null; };
El.prototype.querySelector = function () { return null; };
El.prototype.querySelectorAll = function () { var a = []; a.forEach = Array.prototype.forEach; return a; };
El.prototype.setAttribute = function (k, v) { this.attrs[k] = String(v); };
El.prototype.getAttribute = function (k) { return this.attrs[k] == null ? null : this.attrs[k]; };
/* Find a button by its words anywhere under an element. */
function findButton(el, words) {
  if (!el) return null;
  if (el.tagName === 'BUTTON' && el.textContent.indexOf(words) >= 0) return el;
  for (var i = 0; i < el.children.length; i++) { var b = findButton(el.children[i], words); if (b) return b; }
  return null;
}

var SELECTS = { screenVenue: 1, rfVenue: 1, mdVenue: 1, mdPick: 1, 'rf-day': 1, dlMonths: 1, ntVenue: 1 };

/* ---------------- one page, fresh for every scenario ----------------
   opts.venues      the account's venues [{id,name,slug}]
   opts.current     VP context currentVenueId
   opts.storage     localStorage contents
   opts.tables      table -> function(filters) returning { data, error, count }
   opts.screenGet   function(body) returning the screen-get answer
   opts.confirm     what confirm() answers */
function makePage(opts) {
  opts = opts || {};
  var els = {};
  var $ = function (id) { return els[id] || (els[id] = new El(id, SELECTS[id] ? 'select' : 'div')); };
  var document = { createElement: function (t) { return new El(null, t); }, body: new El('body') };
  var store = opts.storage || {};
  var localStorage = { getItem: function (k) { return store[k] == null ? null : store[k]; }, setItem: function (k, v) { store[k] = String(v); }, removeItem: function (k) { delete store[k]; } };
  var window = { location: { origin: 'https://venueplay.com.au' } };
  var messages = [], apiCalls = [], gameCalls = [];
  var showMsg = function (t) { messages.push(String(t)); };
  var confirm = function () { return opts.confirm !== false; };
  var setTimeout = function () {};
  var venues = opts.venues || [];

  function screenGetDefault(body) {
    var id = body && body.venue_id;
    var v = id ? venues.filter(function (x) { return x.id === id; })[0] : venues[0];   // the Worker's own default
    if (!v) return { error: 'That venue is not on your account.' };
    return { ok: true, venue: v, venues: venues, slides: [], raffle: (opts.raffles || {})[v.id] || null, logo_url: null };
  }
  var api = function (path, body) {
    apiCalls.push({ path: path, body: body });
    var out;
    if (path === '/account/summary') out = opts.summary ? opts.summary() : { venues: venues };
    else if (path === '/account/screen-get') out = (opts.screenGet || screenGetDefault)(body || {});
    else if (path === '/account/draw-log') out = opts.drawLog ? opts.drawLog(body) : { rows: [], venue: {} };
    else if (path === '/account/nights') out = opts.nights ? opts.nights(body) : { nights: [] };
    else out = { ok: true };
    return Promise.resolve(out);
  };
  var gameApi = function (path, body) {
    gameCalls.push({ path: path, body: body });
    return Promise.resolve(opts.game ? opts.game(path, body) : { ok: true, draw: body.draw_id ? { id: body.draw_id } : { id: 'new' } });
  };
  var tables = opts.tables || {};
  var VP = {
    getClient: function () {
      return {
        from: function (table) {
          var f = { table: table };
          var q = {
            select: function (cols, o) { f.select = cols; f.head = o && o.head; return q; },
            eq: function (k, v) { f[k] = v; return q; }, in: function (k, v) { f[k] = v; return q; },
            order: function () { return q; }, is: function () { return q; },
            then: function (ok, bad) {
              var ans = tables[table] ? tables[table](f) : { data: [], error: null };
              return Promise.resolve(ans).then(ok, bad);
            }
          };
          return q;
        }
      };
    },
    venueCode: function (s) { return s; }
  };
  var pushToScreen = function () {};
  var VP_MAX_SLIDES = 20, VP_MAX_IMAGE_BYTES = 5 * 1024 * 1024;
  var slideRow = function () { return new El(null, 'div'); };

  /* The page's own module-level state. Defaults only: every value the tests look at is set by
     the lifted functions themselves. */
  var pageVenueId = opts.current || null;
  var screenVenues = [], screenCurrent = null, screenOrigin = '', screenLogoUrl = '', screenSeq = 0;
  var mdCurrent = null, mdDraw = null, mdDraws = [], mdCurTouched = false, mdReady = false, mdSeq = 0;
  var rfCurrent = null, rfReady = false, rfSeq = 0;
  var dlRows = [], dlVenueName = '';
  var ntVenues = [], ntCurrent = null;
  /* Not under test: how a night is drawn. Record what it was handed. */
  var renderNights = function (n) { $('nights').innerHTML = 'rendered ' + (n || []).length; };

  eval(SRC);

  return {
    $: $, messages: messages, apiCalls: apiCalls, gameCalls: gameCalls, store: store,
    peek: function (expr) { return eval(expr); },
    call: function (name) { var fn = eval('typeof ' + name + ' === "function" ? ' + name + ' : null'); if (!fn) return undefined; return fn.apply(null, Array.prototype.slice.call(arguments, 1)); }
  };
}
function settle() { var p = Promise.resolve(); for (var i = 0; i < 12; i++) p = p.then(function () {}); return p; }

var A = { id: 'v-A', name: 'Alpha Hotel', slug: 'alpha' };
var B = { id: 'v-B', name: 'Bravo Tavern', slug: 'bravo' };
var C = { id: 'v-C', name: 'Charlie Club', slug: 'charlie' };
var ERR = { message: 'JWT expired', code: 'PGRST301' };
var DRAW = { id: 'd1', venue_id: 'v-A', name: 'Friday Members Draw', date_started: '2025-12-05', draw_day: 'Friday',
             draw_time: '7:30pm', starting_amount_cents: 10000, increment_cents: 5000, current_jackpot_cents: 15000 };
var DRAW_B = { id: 'd-bravo', venue_id: 'v-B', name: 'Sunday Members Draw', date_started: '2026-01-04', draw_day: 'Sunday',
               draw_time: '5pm', starting_amount_cents: 20000, increment_cents: 2500, current_jackpot_cents: 32500 };
function okTables(extra) {
  var t = {
    vp_member_draws: function (f) { return { data: f.venue_id === 'v-B' ? [DRAW_B] : [DRAW], error: null }; },
    vp_member_rosters: function () { return { data: [{ id: 'r1' }], error: null }; },
    vp_members: function () { return { data: null, error: null, count: 3120 }; },
    vp_raffle_prizes: function () { return { data: [{ id: 'p1', label: 'Meat tray' }], error: null }; },
    v_vp_prizes_given: function () { return { data: [{ venue_id: 'v-A', total_cents: 4500 }], error: null }; }
  };
  for (var k in (extra || {})) t[k] = extra[k];
  return t;
}

print('Account page panels: ' + PAGE);
if (MISSING.length) print('  (not in this page: ' + MISSING.join(', ') + ')');
print('');

Promise.resolve()

/* ======================= A. a failed read is never an empty state ======================= */
.then(function () {
  print('A. A failed read says so, with a retry, and never "No members yet."');
  var fail = { on: true };
  var p = makePage({ venues: [A], tables: okTables({
    vp_members: function () { return fail.on ? { data: null, error: ERR, count: null } : { data: null, error: null, count: 3120 }; }
  }) });
  p.call('loadMembersDrawFor', 'v-A');
  return settle().then(function () {
    var t = p.$('mdCount').textContent;
    check('members count read FAILS: it does not say "No members yet."', t.indexOf('No members yet') < 0, t);
    check('members count read FAILS: it says it could not load the list', /Could not load/.test(t), t);
    var retry = findButton(p.$('mdCount'), 'Try again');
    check('members count read FAILS: there is a Try again button', !!retry);
    fail.on = false;
    if (retry) retry.click();
    return settle().then(function () {
      var t2 = p.$('mdCount').textContent;
      check('Try again, once the read works, shows the real count', /3120 members/.test(t2), t2);
    });
  });
})
.then(function () {
  var p = makePage({ venues: [A], tables: okTables({ vp_member_rosters: function () { return { data: null, error: ERR }; } }) });
  p.call('loadMembersDrawFor', 'v-A');
  return settle().then(function () {
    var t = p.$('mdCount').textContent;
    check('members LIST read fails: not "No members yet.", says could not load', t.indexOf('No members yet') < 0 && /Could not load/.test(t), t);
  });
})
.then(function () {
  /* The control: a venue that really has nobody must still be told so. */
  var p = makePage({ venues: [A], tables: okTables({ vp_member_rosters: function () { return { data: [], error: null }; } }) });
  p.call('loadMembersDrawFor', 'v-A');
  return settle().then(function () {
    check('a venue with truly no members list still says "No members yet."', p.$('mdCount').textContent === 'No members yet.', p.$('mdCount').textContent);
  });
})
.then(function () {
  var p = makePage({ venues: [A], tables: okTables({ vp_member_draws: function () { return { data: null, error: ERR }; } }) });
  p.call('loadMembersDrawFor', 'v-A');
  return settle().then(function () {
    var e = p.$('mdLoadErr').textContent;
    check('draws read fails: the panel says it could not load the members draw', /Could not load the members draw/.test(e) && !p.$('mdLoadErr').hidden, e);
    check('draws read fails: with a Try again button', !!findButton(p.$('mdLoadErr'), 'Try again'));
    p.$('md-name').value = 'Friday Members Draw';
    p.call('saveMembersDraw');
    check('draws read fails: Save does NOT create a second draw', p.gameCalls.length === 0, p.gameCalls);
    p.$('md-import').value = '142, Jane Smith';
    p.call('importMembers');
    check('draws read fails: an import is refused until it has loaded', p.gameCalls.length === 0, p.gameCalls);
  });
})
.then(function () {
  /* Raffle: venue A has a routine, B's read fails. The boxes must not keep A's routine under
     B's name, and Save must not write anything to B. */
  var down = { B: true };
  var p = makePage({ venues: [A, B], raffles: { 'v-A': { label: 'Alpha Meat Raffle', day: 'Friday', time: '6pm' } },
    screenGet: function (body) {
      if (body.venue_id === 'v-B' && down.B) return { error: 'Something went wrong. Please check your connection and try again.' };
      var v = body.venue_id === 'v-B' ? B : A;
      return { ok: true, venue: v, venues: [A, B], raffle: v === A ? { label: 'Alpha Meat Raffle', day: 'Friday', time: '6pm' } : { label: 'Bravo Chook Raffle', day: 'Sunday', time: '4pm' } };
    }, tables: okTables() });
  p.call('loadRafflesFor', 'v-A');
  return settle().then(function () {
    p.call('loadRafflesFor', 'v-B');
    return settle();
  }).then(function () {
    check('raffle read fails on switching venue: the old venue\'s routine is NOT left in the boxes',
          p.$('rf-label').value !== 'Alpha Meat Raffle', p.$('rf-label').value);
    check('raffle read fails: it says it could not load the raffle, with Try again',
          /Could not load the raffle/.test(p.$('rfLoadErr').textContent) && !!findButton(p.$('rfLoadErr'), 'Try again'), p.$('rfLoadErr').textContent);
    var before = p.apiCalls.length;
    p.$('rf-label').value = 'typed';
    p.call('saveRaffleRoutine');
    var saves = p.apiCalls.slice(before).filter(function (c) { return c.path === '/account/screen-save'; });
    check('raffle read fails: Save routine writes nothing', saves.length === 0, saves);
    down.B = false;
    var retry = findButton(p.$('rfLoadErr'), 'Try again'); if (retry) retry.click();
    return settle().then(function () {
      check('Try again loads the right venue\'s routine', p.$('rf-label').value === 'Bravo Chook Raffle', p.$('rf-label').value);
    });
  });
})
.then(function () {
  var p = makePage({ venues: [A], tables: okTables({
    vp_raffle_prizes: function () { return { data: null, error: ERR }; },
    v_vp_prizes_given: function () { return { data: null, error: ERR }; }
  }) });
  p.call('loadRafflesFor', 'v-A');
  return settle().then(function () {
    var pr = p.$('rfPrizes').textContent, ta = p.$('rfTally').textContent;
    check('prize list read fails: not "No prizes yet.", says could not load', pr.indexOf('No prizes yet') < 0 && /Could not load/.test(pr), pr);
    check('prize total read fails: not "No prizes recorded yet.", says could not load', ta.indexOf('No prizes recorded') < 0 && /Could not load/.test(ta), ta);
    check('both come with a Try again button', !!findButton(p.$('rfPrizes'), 'Try again') && !!findButton(p.$('rfTally'), 'Try again'));
  });
})
.then(function () {
  /* The draws log: venue A's results must not stay downloadable after venue B's read fails. */
  var p = makePage({ venues: [A, B], tables: okTables(), drawLog: function (b) {
    return b.venue_id === 'v-A' ? { rows: [{ at: '2026-08-12T09:00:00Z', name: 'Members draw', number: '142', winner: 'Jane Smith', prize: '$500', outcome: 'claimed' }], venue: { name: 'Alpha Hotel' } }
                                : { error: 'Could not read the log.' };
  } });
  p.call('loadRafflesFor', 'v-A');
  return settle().then(function () { p.call('loadRafflesFor', 'v-B'); return settle(); }).then(function () {
    check('draws log read fails: the last venue\'s winners are no longer the download', p.peek('dlRows.length') === 0, p.peek('dlRows'));
    check('draws log read fails: says could not load, with Try again',
          /Could not load/.test(p.$('drawLog').textContent) && !!findButton(p.$('drawLog'), 'Try again'), p.$('drawLog').textContent);
  });
})
.then(function () {
  /* Screen: switching to B fails. The picker must go back to A, since A is what the panel holds. */
  var p = makePage({ venues: [A, B], screenGet: function (body) {
    if (body.venue_id === 'v-B') return { error: 'Something went wrong.' };
    return { ok: true, venue: A, venues: [A, B], slides: [] };
  } });
  p.call('initScreen');
  return settle().then(function () {
    var sel = p.$('screenVenue');
    sel.value = 'v-B'; sel.fire('change');
    return settle();
  }).then(function () {
    check('screen read fails on switching: still editing the venue it has loaded', p.peek('screenCurrent && screenCurrent.id') === 'v-A', p.peek('screenCurrent'));
    check('screen read fails on switching: the picker goes back to that venue', p.$('screenVenue').value === 'v-A', p.$('screenVenue').value);
    check('screen read fails on switching: it says so, with Try again',
          /Could not load/.test(p.$('screenLoadErr').textContent) && !!findButton(p.$('screenLoadErr'), 'Try again'), p.$('screenLoadErr').textContent);
  });
})
.then(function () {
  var p = makePage({ venues: [A], screenGet: function () { return { error: 'Something went wrong.' }; } });
  p.call('initScreen');
  return settle().then(function () {
    check('screen panel read fails on opening: says could not load, with Try again',
          /Could not load/.test(p.$('screenLoadErr').textContent) && !!findButton(p.$('screenLoadErr'), 'Try again'), p.$('screenLoadErr').textContent);
  });
})

.then(function () {
  var p = makePage({ venues: [A, B], summary: function () { return { error: 'Something went wrong.' }; } });
  p.call('initNights');
  var q = makePage({ venues: [A], nights: function () { return { error: 'Something went wrong.' }; } });
  q.call('initNights');
  return settle().then(function () {
    var t = p.$('nights').textContent, u = q.$('nights').textContent;
    check('venue list read fails on Nights: not "No venues on this account yet.", says could not load',
          t.indexOf('No venues') < 0 && /Could not load/.test(t) && !!findButton(p.$('nights'), 'Try again'), t);
    check('nights read fails: says could not load, with Try again',
          /Could not load/.test(u) && !!findButton(q.$('nights'), 'Try again'), u);
  });
})

/* ======================= B. the current jackpot is the owner's, not a formula ======================= */
.then(function () {
  print('');
  print('B. The current jackpot only changes when the owner changes it');
  /* Started 5 Dec 2025 at $100, +$50 a week, won in August and reset: live jackpot $150.
     Any recalculation from the start date gives thousands. */
  var p = makePage({ venues: [A], current: 'v-A', tables: okTables() });
  p.call('initMembersDraws');
  return settle().then(function () {
    check('the loaded draw shows its real current jackpot', p.$('md-curjp').value === '150', p.$('md-curjp').value);
    p.$('md-inc').value = '60'; p.$('md-inc').fire('input'); p.$('md-inc').fire('change');
    check('editing the weekly increase does NOT rewrite the current jackpot', p.$('md-curjp').value === '150', p.$('md-curjp').value);
    p.$('md-startjp').value = '120'; p.$('md-startjp').fire('input');
    p.$('md-start').value = '2025-11-01'; p.$('md-start').fire('change');
    check('editing the starting jackpot or start date does NOT rewrite it either', p.$('md-curjp').value === '150', p.$('md-curjp').value);
    check('the start date still sets the draw day', p.$('md-day').value === 'Saturday', p.$('md-day').value);
    p.call('saveMembersDraw');
    return settle().then(function () {
      var body = (p.gameCalls[0] || {}).body || {};
      check('Save without touching the jackpot box does not send a jackpot at all', !('current_jackpot_cents' in body), body);
      check('but it does send the new weekly increase', body.increment_cents === 6000, body.increment_cents);
    });
  });
})
.then(function () {
  var p = makePage({ venues: [A], current: 'v-A', tables: okTables() });
  p.call('initMembersDraws');
  return settle().then(function () {
    p.$('md-curjp').value = '275'; p.$('md-curjp').fire('input');
    p.call('saveMembersDraw');
    return settle();
  }).then(function () {
    var body = (p.gameCalls[0] || {}).body || {};
    check('typing a new current jackpot DOES send it', body.current_jackpot_cents === 27500, body.current_jackpot_cents);
  });
})
.then(function () {
  var p = makePage({ venues: [A], current: 'v-A', tables: okTables() });
  p.call('initMembersDraws');
  return settle().then(function () {
    var btn = p.$('mdCalcJp');
    check('there is an explicit way to work the jackpot out', (btn.listeners.click || []).length > 0);
    btn.click();
    var v = parseInt(p.$('md-curjp').value, 10);
    check('pressing it (and confirming) works it out from the start date', v > 150, p.$('md-curjp').value);
    p.call('saveMembersDraw');
    return settle();
  }).then(function () {
    var body = (p.gameCalls[0] || {}).body || {};
    check('and the worked-out figure is what Save sends', body.current_jackpot_cents === parseInt(p.$('md-curjp').value, 10) * 100, body.current_jackpot_cents);
  });
})
.then(function () {
  /* Cents survive the round trip: $1,234.50 must not come back as $1,235.00. */
  var d = {}; for (var k in DRAW) d[k] = DRAW[k];
  d.starting_amount_cents = 123450; d.increment_cents = 2550;
  var p = makePage({ venues: [A], current: 'v-A', tables: okTables({ vp_member_draws: function () { return { data: [d], error: null }; } }) });
  p.call('loadMembersDrawFor', 'v-A');
  return settle().then(function () {
    p.call('saveMembersDraw');
    return settle();
  }).then(function () {
    var body = (p.gameCalls[0] || {}).body || {};
    check('an untouched $1,234.50 starting jackpot saves as $1,234.50', body.starting_amount_cents === 123450, body.starting_amount_cents);
    check('an untouched $25.50 weekly increase saves as $25.50', body.increment_cents === 2550, body.increment_cents);
  });
})

/* ======================= C. every panel opens on the venue being worked at ======================= */
.then(function () {
  print('');
  print('C. Raffles, Members draw and Screen open on the current venue, not the first');
  var p = makePage({ venues: [A, B, C], current: 'v-B', tables: okTables() });
  p.call('initRaffles'); p.call('initMembersDraws'); p.call('initScreen'); p.call('initNights');
  return settle().then(function () {
    check('Nights opens on the current venue (B)', p.peek('ntCurrent') === 'v-B', p.peek('ntCurrent'));
    check('Nights picker shows B', p.$('ntVenue').value === 'v-B', p.$('ntVenue').value);
    check('Raffles opens on the current venue (B), not venues[0]', p.peek('rfCurrent') === 'v-B', p.peek('rfCurrent'));
    check('Raffles picker shows B', p.$('rfVenue').value === 'v-B', p.$('rfVenue').value);
    check('Raffles says it is editing Bravo Tavern', /Bravo Tavern/.test(p.$('rfPickName').textContent), p.$('rfPickName').textContent);
    check('Members draw opens on the current venue (B)', p.peek('mdCurrent') === 'v-B', p.peek('mdCurrent'));
    check('Members picker shows B', p.$('mdVenue').value === 'v-B', p.$('mdVenue').value);
    check('Members says it is editing Bravo Tavern', /Bravo Tavern/.test(p.$('mdPickName').textContent), p.$('mdPickName').textContent);
    check('Screen opens on the current venue (B)', p.peek('screenCurrent && screenCurrent.id') === 'v-B', p.peek('screenCurrent'));
    check('Screen picker shows B', p.$('screenVenue').value === 'v-B', p.$('screenVenue').value);
    check('the Save button names the venue', /Bravo Tavern/.test(p.$('rfSave').textContent), p.$('rfSave').textContent);
    p.$('rf-label').value = 'Meat Raffle';
    p.call('saveRaffleRoutine');
    var save = p.apiCalls.filter(function (c) { return c.path === '/account/screen-save'; })[0];
    check('a raffle Save with no picking writes to B', save && save.body.venue_id === 'v-B', save && save.body);
    p.$('md-import').value = '142, Jane Smith';
    p.call('importMembers');
    var imp = p.gameCalls.filter(function (c) { return c.path === '/host/members/import'; })[0];
    check('a members import with no picking goes into B\'s draw, not A\'s', imp && imp.body.draw_id === 'd-bravo', imp && imp.body);
  });
})
.then(function () {
  /* Viewing as venue C from HQ beats the remembered venue. */
  var p = makePage({ venues: [A, B, C], current: 'v-B', storage: { vpImpersonate: JSON.stringify({ id: 'v-C', name: 'Charlie Club' }) }, tables: okTables() });
  p.call('initRaffles'); p.call('initMembersDraws');
  return settle().then(function () {
    check('viewing as C from HQ: Raffles opens on C', p.peek('rfCurrent') === 'v-C', p.peek('rfCurrent'));
    check('viewing as C from HQ: Members opens on C', p.peek('mdCurrent') === 'v-C', p.peek('mdCurrent'));
  });
})
.then(function () {
  /* A current venue that is not on this account (a login with two accounts) falls back to the
     venue picked for this account, then to the first. Never to a venue not in the list. */
  var p = makePage({ venues: [A, B], current: 'v-Z', storage: { vpVenuePick: JSON.stringify({ id: 'v-B', at: 1 }) }, tables: okTables() });
  p.call('initRaffles');
  var q = makePage({ venues: [A, B], current: 'v-Z', tables: okTables() });
  q.call('initRaffles');
  return settle().then(function () {
    check('current venue on another account: opens on the venue picked for this one', p.peek('rfCurrent') === 'v-B', p.peek('rfCurrent'));
    check('and with nothing else to go on, the first', q.peek('rfCurrent') === 'v-A', q.peek('rfCurrent'));
  });
})

.then(function () {
  print('');
  print(PASS + ' passed, ' + FAIL + ' failed');
  if (FAIL) { print('FAILED ' + FAIL); throw new Error(FAIL + ' check(s) failed'); }
  print('PASS');
})
.catch(function (e) { print('ERROR ' + e + (e && e.stack ? '\n' + e.stack : '')); throw e; });
