/* THE PHONE WHILE IT WAITS (Dean, 6 Nov 2026, round 5 picks: "You're in" with Tonight and This week here, "No game here right now").

   RUNS the real /app/vp-tonight.js on a small fake document, and the real joinNights() out of the game Worker:
     - the lobby: "You're in, Sam", the Tonight spot (one game: TONIGHT, no Later row; games stored for tonight: NEXT and
       LATER), the "This week here" strip of seven tappable days that loads a night's games into the spot
     - nothing on: "You're in, Sam", "No game here right now", the optional heads-up sign-up only when the page can send
       it (it closes once sent, and nothing ever says "you're on the list"), the week strip
     - only stored data: no game is guessed for a night, no time invented; every venue or player word is text
     - the Worker passes only known nights, games, games per night and proper times
     - the trivia phone uses it for the lobby and the no-game screen

   Run from the repo root:  jsc tools/test-vp-tonight.js
*/
var ran = 0, bad = 0;
function ok(n, c, saw) { ran++; print((c ? '  ok   ' : '  FAIL ') + n + (c || saw === undefined ? '' : '   saw: ' + saw)); if (!c) bad++; }

/* A fake document: enough for createElement, textContent, innerHTML (kept as a string), appendChild and className. */
function Node(tag) { this.tagName = tag; this.children = []; this.className = ''; this._text = ''; this._html = ''; this.attrs = {}; }
Node.prototype.appendChild = function (c) { this.children.push(c); return c; };
Node.prototype.setAttribute = function (k, v) { this.attrs[k] = String(v); };
Object.defineProperty(Node.prototype, 'textContent', {
  get: function () { return this._text + this.children.map(function (c) { return c.textContent; }).join(' '); },
  set: function (v) { this._text = String(v); this.children = []; this._html = ''; } });
Object.defineProperty(Node.prototype, 'innerHTML', {
  get: function () { return this._html; }, set: function (v) { this._html = String(v); this.children = []; this._text = ''; } });
function all(n, out) { out = out || []; n.children.forEach(function (c) { out.push(c); all(c, out); }); return out; }
function byClass(n, cls) { return all(n).filter(function (c) { return (' ' + c.className + ' ').indexOf(' ' + cls + ' ') !== -1; }); }

var intervals = [];
var window = { document: { createElement: function (t) { return new Node(t); } } };
var setInterval = function (f, ms) { intervals.push({ f: f, ms: ms }); return intervals.length; };
var clearInterval = function () {};
var SRC = readFile('venueplay/app/vp-tonight.js');
(function () { eval(SRC); }).call(window);
var T = window.VPTonight;
ok('the module loads and offers lobby() and noGame()', !!T && typeof T.lobby === 'function' && typeof T.noGame === 'function');

var WED = new Date(2026, 10, 4, 19, 0, 0);   // Wednesday 4 Nov 2026, fixed: never the real clock
var FRI = new Date(2026, 10, 6, 19, 0, 0);   // Friday 6 Nov
function texts(n, cls) { return byClass(n, cls).map(function (r) { return r.textContent; }).join(' | '); }
print('\n"YOU\'RE IN", Dean\'s round 5 pick');
var box = new Node('div');
var lb = T.lobby(box, { name: 'Sam', me: 'trivia', prize: 'Winners take a $50 bar tab', nights: ['wed', 'fri'], games: ['trivia', 'musical'], now: FRI });
ok('"You\'re in, Sam" beside the ring tick', byClass(box, 't')[0].textContent === 'You’re in, Sam' && byClass(box, 'vpt-head')[0].innerHTML.indexOf('vp-tick') > 0);
var spot = byClass(box, 'vpt-night')[0], rows = byClass(spot, 'row');
ok('one game tonight (no game per night stored): badged TONIGHT, no Later row, its real prize', rows.length === 1 && byClass(rows[0], 'bd')[0].textContent === 'Tonight' && /Trivia/.test(rows[0].textContent) && /\$50 bar tab/.test(rows[0].textContent), texts(spot, 'row'));
ok('no game is guessed for tonight from the venue\'s list', !/Musical/.test(spot.textContent));
var two = new Node('div');
T.lobby(two, { name: 'Sam', me: 'trivia', nights: ['fri'], week: [{ day: 'fri', games: [{ game: 'trivia', start: '19:00' }, { game: 'musical', start: '21:00' }] }], now: FRI });
var tr = byClass(byClass(two, 'vpt-night')[0], 'row');
ok('two games stored for tonight: NEXT this game, LATER the other with its start time', tr.length === 2 && byClass(tr[0], 'bd')[0].textContent === 'Next' && byClass(tr[1], 'bd')[0].textContent === 'Later' && /Musical bingo/.test(tr[1].textContent) && /9pm/.test(tr[1].textContent), texts(two, 'row'));
var wk = byClass(box, 'vpt-week')[0], days = byClass(wk, 'd');
ok('THIS WEEK HERE: seven days from today, Today first with its date', days.length === 7 && /Today/.test(days[0].textContent) && /\b6\b/.test(days[0].textContent) && /Sat/.test(days[1].textContent) && /Thu/.test(days[6].textContent), texts(wk, 'd'));
ok('the venue\'s game nights are marked, the others are not', /\bon\b/.test(days[5].className) && days[5].attrs['data-day'] === 'wed' && !/\bon\b/.test(days[1].className) && /\bon\b/.test(days[0].className));
ok('no start times stored: "Ask at the bar for start times"', /Ask at the bar for start times/.test(wk.textContent));
days[5].onclick();
ok('tap Wednesday: the Tonight spot shows that night (no game per night stored: "Game night", ask at the bar)', /Wed 11/.test(spot.textContent) && /Game night/.test(spot.textContent) && /Ask at the bar/.test(spot.textContent), spot.textContent);
ok('and Wednesday is marked as picked', /picked/.test(days[5].className) && !/picked/.test(days[0].className));
days[1].onclick();
ok('tap Saturday, not a game night: "No games this night"', /No games this night/.test(spot.textContent), spot.textContent);
days[0].onclick();
ok('tap Today: back to tonight', byClass(spot, 'row').length === 1 && /Tonight/.test(spot.textContent) && /Trivia/.test(spot.textContent));
var tm = new Node('div');
T.lobby(tm, { name: 'Sam', me: 'trivia', nights: ['wed'], week: [{ day: 'wed', games: [{ game: 'trivia' }, { game: 'members', start: '19:30' }] }], now: FRI });
byClass(byClass(tm, 'vpt-week')[0], 'd')[5].onclick();
var tms = byClass(tm, 'vpt-night')[0];
ok('with game per night stored: "Trivia night, Ask for start time" and "Members draw, 7:30pm"', /Trivia night/.test(tms.textContent) && /Ask for start time/.test(tms.textContent) && /Members draw/.test(tms.textContent) && /7:30pm/.test(tms.textContent), tms.textContent);
ok('and with a time stored the "Ask at the bar" line is not in the strip head', !/Ask at the bar for start times/.test(byClass(tm, 'vpt-week')[0].textContent));
ok('a stored night with no games is not marked', (function () { var z = new Node('div'); T.lobby(z, { me: 'trivia', nights: ['wed'], week: [{ day: 'mon', games: [{ game: 'trivia' }] }, { day: 'wed', games: [] }], now: FRI }); return !/\bon\b/.test(byClass(byClass(z, 'vpt-week')[0], 'd')[5].className); })());
ok('this game\'s own start tonight shows when no prize is set', /7pm/.test(byClass(byClass(two, 'vpt-night')[0], 'row')[0].textContent));
ok('then the lobby line', byClass(box, 'vpt-wait')[0].textContent === 'The game will start here when the host is ready.');
ok('times read as people say them, and a bad one is dropped', T.time12('19:30') === '7:30pm' && T.time12('19:00') === '7pm' && T.time12('9:05') === '9:05am' && T.time12('25:00') === '' && T.time12('<b>') === '');
var evil = new Node('div');
T.lobby(evil, { name: '<img src=x onerror=alert(1)>', me: 'trivia', prize: '<b>x</b>', now: WED });
ok('a name or prize is set as text, never as HTML', all(evil).every(function (n) { return n._html.indexOf('<img') < 0 && n._html.indexOf('<b>') < 0; }) && /<img src=x/.test(byClass(evil, 't')[0].textContent));

print('\n"NO GAME ON RIGHT NOW", Dean\'s round 5 pick');
var ng = new Node('div');
T.noGame(ng, { name: 'Sam', nights: ['wed', 'fri'], games: ['trivia'], venue: 'Tugun Bowls Club', now: new Date(2026, 10, 7, 12, 0, 0) });
ok('"You\'re in, Sam" then "No game here right now"', byClass(ng, 't')[0].textContent === 'You’re in, Sam' && byClass(ng, 'vpt-none')[0].textContent === 'No game here right now');
ok('no sign-up box when the page has no way to send one', byClass(ng, 'vpt-sign').length === 0);
ok('the week strip, starting on the next game night (Wednesday, from a Saturday)', byClass(ng, 'vpt-week').length === 1 && /picked/.test(byClass(ng, 'd')[4].className) && /Wed 11/.test(byClass(ng, 'vpt-night')[0].textContent), texts(ng, 'd'));
ok('never "you\'re on the list"', !/on .*list/i.test(ng.textContent));
var sent = [], sg = new Node('div'), resolveIt;
T.noGame(sg, { name: 'Sam', venue: 'Tugun Bowls Club', signup: function (e, o) { sent.push([e, o]); return { then: function (ok_) { resolveIt = ok_; } }; }, now: WED });
var form = byClass(sg, 'vpt-sign')[0];
ok('with a way to send it: a small "Get a heads up by email", one field, the offers tick naming the venue', !!form && /Get a heads up by email/.test(form.textContent) && /Send me offers from Tugun Bowls Club\. I’m 18 or over\./.test(form.textContent) && all(form).filter(function (n) { return n.tagName === 'input'; }).length === 2);
var inputs = all(form).filter(function (n) { return n.tagName === 'input'; });
inputs[0].value = 'not-an-email'; form.onsubmit({ preventDefault: function () {} });
ok('a bad email is not sent', sent.length === 0 && /doesn/.test(byClass(form, 'err')[0].textContent));
inputs[0].value = 'sam@example.com'; inputs[1].checked = true;
var removed = false; form.parentNode = { removeChild: function () { removed = true; } };
var realPromise = Promise; Promise = { resolve: function (x) { return x; } };
form.onsubmit({ preventDefault: function () {} }); Promise = realPromise;
ok('a good one is sent once, with the tick', sent.length === 1 && sent[0][0] === 'sam@example.com' && sent[0][1] === true, JSON.stringify(sent));
resolveIt();
ok('and once sent the box closes, and nothing says "on the list"', removed === true);
var nooffer = new Node('div');
T.noGame(nooffer, { name: 'Sam', venue: 'Tugun Bowls Club', signup: function () {}, offers: false, now: WED });
ok('a venue that does not collect the offers tick: the email field, no tick', all(byClass(nooffer, 'vpt-sign')[0]).filter(function (n) { return n.tagName === 'input'; }).length === 1 && !/Send me offers/.test(nooffer.textContent));
var done = new Node('div');
T.noGame(done, { name: 'Sam', signup: function () {}, signedUp: true, now: WED });
ok('a phone that already signed up is not asked again', byClass(done, 'vpt-sign').length === 0);
var blank = new Node('div');
T.noGame(blank, { name: 'Sam', now: WED });
ok('no nights known: the week with no night marked and today in the spot, nothing invented', byClass(blank, 'd').every(function (x) { return !/\bon\b/.test(x.className); }) && /No games this night/.test(byClass(blank, 'vpt-night')[0].textContent));

print('\nTHE WORKER sends only what the venue gave the setup wizard');
var W = readFile('venueplay-backend/worker/venueplay-game.js');
var i = W.indexOf('function joinNights('), k = W.indexOf('{', i), depth = 0;
do { if (W[k] === '{') depth++; else if (W[k] === '}') depth--; k++; } while (depth > 0);
var joinNights = eval('(' + W.slice(i, k) + ')');   // the Worker's own function, lifted out and run
var J1 = JSON.stringify(joinNights({ nights: ['fri', 'wed', 'xmas'], games: ['members', 'trivia', 'poker'] }));
ok('known nights and games, in week order', J1 === '{"nights":["wed","fri"],"games":["trivia","members"]}', J1);
ok('nothing at all for a venue that never answered', JSON.stringify(joinNights({})) === '{}' && JSON.stringify(joinNights(null)) === '{}');
var J2 = JSON.stringify(joinNights({ week: [{ day: 'fri', games: [{ game: 'musical', start: '19:30' }, { game: 'members' }] }, { day: 'wed', games: [{ game: 'trivia', start: '19:00' }, { game: 'trivia' }, { game: 'poker' }, { game: 'bingo', start: '7.30pm' }] }, { day: 'xmas', games: [{ game: 'trivia' }] }, { day: 'sat', games: [] }], nights: ['wed'], secret: 'x' }));
ok('the game week, the wizard\'s shape: days in week order, known games once each, a proper start kept, a bad one dropped, empty and unknown days left out, no other answer', J2 === '{"week":[{"day":"wed","games":[{"game":"trivia","start":"19:00"},{"game":"bingo"}]},{"day":"fri","games":[{"game":"musical","start":"19:30"},{"game":"members"}]}],"nights":["wed"],"games":[]}', J2);
ok('/join/info carries them', /\}, \.\.\.joinNights\(cfg\.setup_answers\) \}, venueId: venueId \};/.test(W));
ok('and a database without migration 163 is asked again without the column', /try \{ rows = await sbGet\(env, 'vp_venue_settings', 'venue_id=eq\.' \+ enc\(venueId\) \+ '&select=' \+ cols \+ ',setup_answers&limit=1'\); \}\s*\n\s*catch \(e\) \{ rows = await sbGet\(env, 'vp_venue_settings', 'venue_id=eq\.' \+ enc\(venueId\) \+ '&select=' \+ cols \+ '&limit=1'\); \}/.test(W));
print('\nTHE TRIVIA PHONE uses it');
var PLAY = readFile('venueplay/app/trivia/play.html');
ok('loads the module', PLAY.indexOf('<script src="/app/vp-tonight.js"></script>') > 0);
ok('the plain lobby (no other heading, nothing scored) is option C', /var useT = !head && !\(P\.total>0\) && typeof VPTonight==="object";/.test(PLAY) && /VPTonight\.lobby\(tn, \{ name:P\.name, me:"trivia"/.test(PLAY));
ok('"No game on right now" is the round 5 pick, with the week', /VPTonight\.noGame\(tn, \{ name:P\.name, nights:P\.nights, games:P\.games, week:P\.week, venue:P\.venueName,/.test(PLAY));
ok('the nights come from /join/info', /P\.nights=\(r&&Array\.isArray\(r\.nights\)\)\?r\.nights:\[\]; P\.games=\(r&&Array\.isArray\(r\.games\)\)\?r\.games:\[\]; P\.week=/.test(PLAY));

print('');
print(bad ? (bad + ' FAILED, ' + ran + ' run') : ('ALL ' + ran + ' CHECKS PASSED'));
