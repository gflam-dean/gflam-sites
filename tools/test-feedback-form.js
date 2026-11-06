/* THE PLAYER'S FEEDBACK FOLLOW-UP, RUN (Dean, 1 and 2 Nov 2026; brought back 6 Nov 2026).

   After "How was that?" on EVERY player phone (bingo /play, musical /app/musical/play, trivia
   /app/trivia/play, all through /app/vp-feedback.js) the player gets one short, optional follow-up:

     Loved it     "What did you love?"                     chips, an optional line
     Good         "What would make it better?"             chips, a line, the email-me tick
     Not for me   "Sorry to hear that. What went wrong?"   chips, a line, the email-me tick

   Dean, 2 Nov 2026: no ticks for the venue at all. The ONLY tick is the player's own "venueplay can
   email me about this feedback (only about this)", unticked, with an email box that appears only
   when it is ticked. "Only the venueplay team reads this." Dean, 6 Nov 2026: he gave a middle
   rating and got no follow-up; the middle and low ratings must ask it too (run below, 3 x).

   What runs here:
     1. what the form sends (payload): the email only with its tick and never after Loved it;
        nothing for the venue, nothing shared, no name, whatever a caller passes
     2. the phone's chips are the billing Worker's VPF_TAGS word for word (it drops unknown ones)
     4. the form itself, on a small stand-in DOM, for all three ratings: it opens once the rating
        is kept (the Worker hands back its id), the question, the chips, the line, the tick only on
        Good / Not for me, the email box hidden until ticked, the "Only the venueplay team" line;
        Send posts to /help/feedback against THAT rating; No thanks posts nothing; no id, no form;
        asked once per game
     3. the three player pages each load vp-feedback.js and ask (the one-line hooks)
     5. the REAL game Worker: POST /feedback hands back the rating's id

   The paint at 390 and 375 wide is run in Chrome by tools/feedback-followup-in-chrome.test.py; the
   billing Worker's side (the email, the HQ alert at 2, the venue counts) by test-feedback-consent.js.

   Run from the repo root:  jsc tools/test-feedback-form.js */
load('tools/rig-game-worker.js');

/* ---- a stand-in DOM, just enough for vp-feedback.js ---- */
function El(tag) {
  this.tagName = String(tag).toUpperCase(); this.children = []; this.attrs = {}; this._text = ''; this._html = null;
  this.className = ''; this.listeners = {}; this.parentNode = null; this.value = ''; this.checked = false; this.style = {};
  var self = this;
  this.classList = {
    add: function (c) { if (!this.contains(c)) self.className = (self.className + ' ' + c).trim(); },
    remove: function (c) { self.className = self.className.split(/\s+/).filter(function (x) { return x && x !== c; }).join(' '); },
    contains: function (c) { return self.className.split(/\s+/).indexOf(c) >= 0; },
    toggle: function (c, on) { if (on === undefined) on = !this.contains(c); if (on) this.add(c); else this.remove(c); return on; }
  };
}
El.prototype.appendChild = function (c) { c.parentNode = this; this.children.push(c); this._html = null; return c; };
El.prototype.setAttribute = function (k, v) { this.attrs[k] = String(v); };
El.prototype.getAttribute = function (k) { return k in this.attrs ? this.attrs[k] : null; };
El.prototype.addEventListener = function (t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); };
El.prototype.fire = function (t) { (this.listeners[t] || []).forEach(function (f) { f({ target: this }); }, this); };
El.prototype.click = function () { if (this.type === 'checkbox') this.checked = !this.checked; this.fire('click'); if (this.type === 'checkbox') this.fire('change'); };
Object.defineProperty(El.prototype, 'textContent', {
  get: function () { return this._html != null ? this._html.replace(/<[^>]*>/g, '') : this._text + this.children.map(function (c) { return c.textContent; }).join(''); },
  set: function (v) { this._text = String(v); this.children = []; this._html = null; }
});
Object.defineProperty(El.prototype, 'innerHTML', {
  get: function () { return this._html != null ? this._html : this.textContent; },
  set: function (v) { this._html = String(v); this._text = ''; this.children = []; }
});
El.prototype.all = function () { var out = []; this.children.forEach(function (c) { out.push(c); out = out.concat(c.all()); }); return out; };
El.prototype.matches = function (sel) {
  if (sel.charAt(0) === '.') return this.classList.contains(sel.slice(1));
  return this.tagName === sel.toUpperCase();
};
El.prototype.querySelector = function (sel) { return this.all().filter(function (e) { return e.matches(sel); })[0] || null; };
El.prototype.querySelectorAll = function (sel) { return this.all().filter(function (e) { return e.matches(sel); }); };
var BYID = {};
var document = { head: new El('head'), body: new El('body'),
  createElement: function (t) { return new El(t); },
  getElementById: function (id) { return BYID[id] || (id === 'vpFbCss' ? document.head.all().filter(function (e) { return e.id === 'vpFbCss'; })[0] || null : null); } };
var STORE = {};
var localStorage = { getItem: function (k) { return k in STORE ? STORE[k] : null; }, setItem: function (k, v) { STORE[k] = String(v); } };

/* fetch: the game Worker's /feedback answers what NEXT_ID says; /help/feedback is recorded. */
var POSTS = [], NEXT_ID = 'f0000000-0000-4000-8000-000000000001';
var gameFetch = globalThis.fetch;
var phoneFetch = function (url, opts) {
  POSTS.push({ url: String(url), body: JSON.parse((opts || {}).body || '{}') });
  var body = /\/feedback$/.test(String(url)) && !/\/help\/feedback$/.test(String(url)) ? (NEXT_ID ? { ok: true, id: NEXT_ID } : { ok: true }) : { ok: true };
  return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve(body); } });
};
var window = { localStorage: localStorage, crypto: globalThis.crypto, document: document, fetch: phoneFetch };
(function () {
  var src = readFile('venueplay/app/vp-feedback.js');
  /* vp-feedback.js runs with window as root; its bare document / fetch / localStorage are these. */
  (new Function('window', 'document', 'localStorage', 'fetch', src))(window, document, localStorage, function (u, o) { return window.fetch(u, o); });
})();
var F = window.VPFeedback;
function check(n, c, saw) { show(n, c, c ? '' : JSON.stringify(saw)); }
function flush() { if (typeof drainMicrotasks === 'function') drainMicrotasks(); }
async function settle() { for (var i = 0; i < 6; i++) { await Promise.resolve(); flush(); } }

print('1. WHAT THE FORM SENDS: NO TICKS FOR THE VENUE (Dean, 2 Nov 2026)');
[3, 2, 1].forEach(function (r) {
  var p = F.payload(r, { tags: ['other'], note: 'Great host', toVenue: true, share: true, firstName: 'Sam Kowalski' });
  check('rating ' + r + ': the chips and the words, and nothing for the venue, nothing shared, no name',
        p.note === 'Great host' && p.tags.join() === 'other' && !('to_venue' in p) && !('share' in p) && !('first_name' in p) && JSON.stringify(p).indexOf('Sam') < 0, p);
});
var p0 = F.payload(3, { consent: true, email: 'a@b.com' });
check('"Loved it" never sends an email, even with a tick', p0.consent === false && p0.email === undefined, p0);
p0 = F.payload(2, { consent: true, email: 'a@b.com' });
check('"Good" sends the email with its tick', p0.consent === true && p0.email === 'a@b.com', p0);
p0 = F.payload(1, { consent: true, email: ' a@b.com ' });
check('"Not for me" sends the email with its tick, trimmed', p0.consent === true && p0.email === 'a@b.com', p0);
p0 = F.payload(2, { consent: false, email: 'a@b.com' });
check('...and never without it', p0.consent === false && p0.email === undefined, p0);
p0 = F.payload(1, { note: new Array(400).join('x'), tags: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] });
check('the line is cut at 300 characters and the chips at six', p0.note.length === 300 && p0.tags.length === 6, [p0.note.length, p0.tags.length]);

print('\n2. THE PHONE\'S CHIPS ARE THE WORKER\'S');
var api = readFile('venueplay-backend/worker/venueplay-api-FULL.js');
var m = /const VPF_TAGS = (\{[\s\S]*?\n\});/.exec(api);
var WT = m ? (new Function('return ' + m[1]))() : null;
check('the billing Worker\'s list is found', !!WT);
[3, 2, 1].forEach(function (r) {
  var phone = F.TAGS[r].map(function (t) { return t[0] + '=' + t[1]; }).join('|');
  var work = WT ? Object.keys(WT[r]).map(function (k) { return k + '=' + WT[r][k]; }).join('|') : '';
  check('rating ' + r + ': the same keys and words, in the same order', phone === work, { phone: phone, worker: work });
});
check('the billing Worker answers POST /help/feedback', /path === '\/help\/feedback'/.test(api) && /async function vpfFeedbackMore\(/.test(api));

print('\n3. EVERY PLAYER PHONE LOADS IT AND ASKS');
[['venueplay/play.html', 'bingo'], ['venueplay/app/musical/play.html', 'musical'], ['venueplay/app/trivia/play.html', 'trivia']].forEach(function (pg) {
  var h = readFile(pg[0]);
  check(pg[1] + ' (' + pg[0] + '): loads /app/vp-feedback.js and calls VPFeedback.ask at the end of a game',
        h.indexOf('<script src="/app/vp-feedback.js"></script>') >= 0 && /VPFeedback\.ask\(\{ api:VP_GAME_API, code:P\.room, mount:/.test(h) && /askHowItWent\(/.test(h), pg[0]);
});

var WORDS = { 3: 'Loved it', 2: 'Good', 1: 'Not for me' };
var ASKS = { 3: 'What did you love?', 2: 'What would make it better?', 1: 'Sorry to hear that. What went wrong?' };
function freshScreen(id) { var host = new El('div'); host.id = id; BYID[id] = host; return host; }
function btn(host, word) { return host.querySelectorAll('button').filter(function (b) { return b.textContent.indexOf(word) >= 0 || b.getAttribute('aria-label') === word; })[0]; }

(async function () {
  try {
    print('\n4. THE FORM, FOR ALL THREE RATINGS (Dean, 6 Nov 2026: the middle and low ones too)');
    var n = 0;
    for (var r of [3, 2, 1]) {
      n++; POSTS = []; NEXT_ID = 'f0000000-0000-4000-8000-00000000000' + n;
      var host = freshScreen('vLost' + n);
      F.ask({ api: 'https://game.test', code: 'ROOM' + n, mount: host, gameId: 'g' + n, format: 'bingo' });
      check(WORDS[r] + ': "How was that?" with the three faces', host.textContent.indexOf('How was that?') >= 0 && ['Loved it', 'Good', 'Not for me'].every(function (w) { return !!btn(host, w); }), host.textContent);
      btn(host, WORDS[r]).click();
      await settle();
      var rate = POSTS.filter(function (p) { return p.url === 'https://game.test/feedback'; })[0];
      check(WORDS[r] + ': the rating goes to the game Worker as ' + r, rate && rate.body.rating === r && rate.body.code === 'ROOM' + n && rate.body.source === 'player', POSTS);
      var more = host.querySelector('.more');
      check(WORDS[r] + ': the follow-up opens once the rating is kept', !!more, host.textContent);
      if (!more) continue;
      check(WORDS[r] + ': it asks "' + ASKS[r] + '"', more.querySelector('.q') && more.querySelector('.q').textContent === ASKS[r], more.textContent);
      var chips = more.querySelector('.chips').querySelectorAll('button');
      check(WORDS[r] + ': its chips, unpressed', chips.length === F.TAGS[r].length && chips.every(function (c) { return c.getAttribute('aria-pressed') === 'false'; }), chips.map(function (c) { return c.textContent; }));
      var ta = more.querySelector('textarea');
      check(WORDS[r] + ': an optional comment box, 300 characters at most', ta && ta.placeholder === 'Anything else? (optional)' && ta.maxLength === 300, ta && ta.placeholder);
      var boxes = more.querySelectorAll('input').filter(function (i) { return i.type === 'checkbox'; });
      var email = more.querySelectorAll('input').filter(function (i) { return i.type === 'email'; })[0];
      if (r === 3) {
        check('Loved it: no tick and no email box at all', boxes.length === 0 && !email, boxes.length);
      } else {
        var lab = more.querySelector('label');
        check(WORDS[r] + ': exactly one tick, unticked: "venueplay can email me about this feedback (only about this)"',
              boxes.length === 1 && boxes[0].checked === false && lab && lab.textContent === 'venueplay can email me about this feedback (only about this)', lab && lab.textContent);
        check(WORDS[r] + ': the email box is hidden until the tick', email && email.classList.contains('hide'), email && email.className);
        boxes[0].click();
        check(WORDS[r] + ': ticked, the email box shows', !email.classList.contains('hide'), email.className);
      }
      check(WORDS[r] + ': "Only the venueplay team reads this."', more.querySelector('.who') && more.querySelector('.who').textContent === 'Only the venueplay team reads this.', more.textContent);
      check(WORDS[r] + ': nothing in the form offers the venue anything (no "Send this to", no "share", no name)', !/send this to|share|first name/i.test(more.textContent), more.textContent);
      chips[1].click();
      ta.value = '  Loud speakers  ';
      if (email) email.value = 'sam@example.com';
      btn(more, 'Send').click();
      await settle();
      var sent = POSTS.filter(function (p) { return /\/help\/feedback$/.test(p.url); });
      var b = sent[0] && sent[0].body;
      check(WORDS[r] + ': Send posts once to the billing Worker\'s /help/feedback', sent.length === 1 && sent[0].url === 'https://api.venueplay.com.au/help/feedback', sent.map(function (s) { return s.url; }));
      check(WORDS[r] + ': against THIS rating, with the chip and the trimmed line', b && b.feedback_id === NEXT_ID && b.tags.join() === F.TAGS[r][1][0] && b.note === 'Loud speakers' && b.website === '' && typeof b.device === 'string', b);
      if (r === 3) check('Loved it: no email travels', b && b.email === undefined && b.consent === false, b);
      else check(WORDS[r] + ': the email travels only because it was ticked', b && b.email === 'sam@example.com' && b.consent === true, b);
      check(WORDS[r] + ': then a thank you', host.querySelector('.thanks') && /^Thanks/.test(host.querySelector('.thanks').textContent), host.textContent);
    }

    // No thanks: nothing more is posted.
    POSTS = []; NEXT_ID = 'f0000000-0000-4000-8000-000000000009';
    var h2 = freshScreen('vFinalSkip');
    F.ask({ api: 'https://game.test', code: 'SKIP', mount: h2, gameId: 'gs', format: 'trivia' });
    btn(h2, 'Good').click(); await settle();
    btn(h2.querySelector('.more'), 'No thanks').click(); await settle();
    check('No thanks: the form closes with a thank you and posts nothing more', POSTS.length === 1 && !h2.querySelector('.more') && /^Thanks/.test(h2.textContent), POSTS);

    // An older game Worker that sends no id: the thanks stays, no form that could not be kept.
    POSTS = []; NEXT_ID = null;
    var h3 = freshScreen('vWonOld');
    F.ask({ api: 'https://game.test', code: 'OLD', mount: h3, gameId: 'go', format: 'musical' });
    btn(h3, 'Not for me').click(); await settle();
    check('a Worker that sends no id: no follow-up, just "Thanks for telling us"', !h3.querySelector('.more') && h3.textContent === 'Thanks for telling us', h3.textContent);

    // Asked once per game.
    var h4 = freshScreen('vWonAgain');
    F.ask({ api: 'https://game.test', code: 'OLD', mount: h4, gameId: 'go', format: 'musical' });
    check('the same game again: not asked twice', h4.children.length === 0, h4.textContent);

    print('\n5. THE REAL GAME WORKER: POST /feedback HANDS BACK THE RATING\'S ID');
    var VENUE = '22222222-2222-4222-8222-222222222222', SLUG = 'look-alpha', CODE = fnvVenueCode(SLUG);
    DB.vp_venues = [{ id: VENUE, name: 'Look Alpha', slug: SLUG, status: 'active', join_code: CODE, timezone: 'Australia/Sydney', au_state: 'NSW' }];
    DB.vp_sessions = [{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', venue_id: VENUE, join_code: 'QWERTY', status: 'running', created_at: '2026-09-19T08:00:00Z' }];
    DB.vp_game_feedback = [];
    function req(path) { return { url: 'https://game.venueplay.com.au' + path, headers: { get: function () { return ''; } }, json: function () { return Promise.resolve(BODY); } }; }
    var ids = [];
    for (var i = 0; i < 3; i++) {
      BODY = { code: 'QWERTY', rating: [3, 2, 1][i], source: 'player', session_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', format: 'trivia' };
      var f = await handleFeedback(req('/feedback'), ENV, json);
      ids.push(f.body && f.body.id);
    }
    check('POST /feedback answers the id of the rating it kept, for Loved it, Good and Not for me alike',
          ids.every(function (x, k) { return typeof x === 'string' && x.length >= 30 && DB.vp_game_feedback.some(function (row) { return row.id === x && row.rating === [3, 2, 1][k]; }); }), ids);
  } catch (e) { check('the scenes ran without throwing', false, String(e && e.stack || e)); }
  print('');
  print(bad ? (bad + ' FAILED, ' + ran + ' run') : ('ALL ' + ran + ' CHECKS PASSED'));
})();
if (typeof drainMicrotasks === 'function') drainMicrotasks();
