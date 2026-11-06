/* THE PHONE WHILE IT WAITS (Dean, 6 Nov 2026, round 4: option C "You're in" with Tonight, option B "No game on right now").

   RUNS the real /app/vp-tonight.js on a small fake document, and the real joinNights() out of the game Worker:
     - the lobby: "You're in, Sam", a TONIGHT card with this game badged NEXT (and its prize), every other game the venue plays
       on tonight's weekday badged LATER; one game tonight reads TONIGHT with no Later row
     - nothing on: "You're in, Sam", a NEXT GAME NIGHT card turning through the coming nights from today, then
       "Members draw / Scan the QR code again on the night."; the on-the-list line; no nights known says so plainly
     - every venue or player word is text, never HTML
     - the Worker passes only known nights and games, in week order, and nothing when the venue never answered
     - both phones load the module; the trivia phone uses it for the lobby and the no-game screen

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
var SAT = new Date(2026, 10, 7, 19, 0, 0);   // Saturday
print('\nOPTION C, the lobby');
var box = new Node('div');
T.lobby(box, { name: 'Sam', me: 'trivia', prize: 'Winners take a $50 bar tab', nights: ['wed', 'fri'], games: ['trivia', 'musical', 'members'], now: WED });
var head = byClass(box, 't')[0];
ok('"You\'re in, Sam" beside the ring tick', head && head.textContent === 'You’re in, Sam' && byClass(box, 'vpt-head')[0].innerHTML.indexOf('vp-tick') > 0, head && head.textContent);
var rows = byClass(box, 'row');
ok('a Tonight card, this game first and badged NEXT, with its prize', byClass(box, 'nk')[0].textContent === 'Tonight' && rows.length === 2 &&
   byClass(rows[0], 'bd')[0].textContent === 'Next' && rows[0].attrs['data-game'] === 'trivia' && /Trivia/.test(rows[0].textContent) && /\$50 bar tab/.test(rows[0].textContent), rows.map(function (r) { return r.textContent; }).join(' | '));
ok('then the other game played tonight, badged LATER (a members draw is not a game later)', byClass(rows[1], 'bd')[0].textContent === 'Later' && rows[1].attrs['data-game'] === 'musical' && /Musical bingo/.test(rows[1].textContent));
ok('then the lobby line', byClass(box, 'vpt-wait')[0].textContent === 'The game will start here when the host is ready.');
var one = new Node('div');
T.lobby(one, { name: 'Sam', me: 'trivia', nights: ['wed', 'fri'], games: ['trivia', 'musical'], now: SAT });
var r1 = byClass(one, 'row');
ok('not a game night for the others (Saturday): one row, badged TONIGHT, no Later row', r1.length === 1 && byClass(r1[0], 'bd')[0].textContent === 'Tonight', r1.map(function (r) { return r.textContent; }).join(' | '));
var none = new Node('div');
T.lobby(none, { name: 'Sam', me: 'musical', now: WED });
ok('no nights known: still the one game, TONIGHT', byClass(none, 'row').length === 1 && /Musical bingo/.test(byClass(none, 'row')[0].textContent));
var evil = new Node('div');
T.lobby(evil, { name: '<img src=x onerror=alert(1)>', me: 'trivia', prize: '<b>x</b>', now: WED });
ok('a name or prize is set as text, never as HTML', all(evil).every(function (n) { return n._html.indexOf('<img') < 0 && n._html.indexOf('<b>') < 0; }) && /<img src=x/.test(byClass(evil, 't')[0].textContent));

print('\nOPTION B, no game on right now');
intervals = [];
var ng = new Node('div');
T.noGame(ng, { name: 'Sam', nights: ['wed', 'fri'], games: ['trivia', 'musical', 'members'], venue: 'Tugun Bowls Club', onList: false, now: SAT });
ok('"You\'re in, Sam" at the top', byClass(ng, 't')[0].textContent === 'You’re in, Sam');
var hero = byClass(ng, 'vpt-hero')[0];
function shown() { return byClass(hero, 'd')[0].textContent + ': ' + byClass(hero, 'g')[0].textContent; }
ok('from a Saturday the next game night is Wednesday, with the venue\'s games', shown() === 'Wednesday: Trivia and Musical bingo', shown());
ok('it turns every 4 seconds', intervals.length === 1 && intervals[0].ms === 4000);
intervals[0].f();
ok('to Friday', shown() === 'Friday: Trivia and Musical bingo', shown());
intervals[0].f();
ok('then the members draw', shown() === 'Members draw: Scan the QR code again on the night.' && byClass(hero, 'k')[0].textContent === 'Also at this venue', shown());
intervals[0].f();
ok('and round again', shown() === 'Wednesday: Trivia and Musical bingo');
ok('three dots, one lit', byClass(hero, 'vpt-dots')[0].children.length === 3);
ok('not on the list: no list line (the sign-up has no route yet)', byClass(ng, 'vpt-onlist').length === 0);
var on = new Node('div');
T.noGame(on, { name: 'Sam', nights: ['wed'], games: ['trivia'], venue: 'Tugun Bowls Club', onList: true, now: WED });
ok('on the list: "You\'re on Tugun Bowls Club\'s list. Change this from any of their emails."', byClass(on, 'vpt-onlist')[0].textContent === 'You’re on Tugun Bowls Club’s list. Change this from any of their emails.');
var thu = new Node('div');
T.noGame(thu, { name: 'Sam', nights: ['wed', 'fri'], games: ['trivia'], now: new Date(2026, 10, 5, 19, 0, 0) });
ok('from a Thursday the next game night is Friday, not Wednesday', byClass(byClass(thu, 'vpt-hero')[0], 'd')[0].textContent === 'Friday');
ok('a game night today counts as the next one', byClass(byClass(on, 'vpt-hero')[0], 'd')[0].textContent === 'Wednesday');
intervals = [];
var blank = new Node('div');
T.noGame(blank, { name: 'Sam', now: WED });
ok('no nights known: one plain card, no turning, no invented night', intervals.length === 0 && byClass(byClass(blank, 'vpt-hero')[0], 'd')[0].textContent === 'Game nights');

print('\nTHE WORKER sends only what the venue gave the setup wizard');
var W = readFile('venueplay-backend/worker/venueplay-game.js');
var i = W.indexOf('function joinNights('), k = W.indexOf('{', i), depth = 0;
do { if (W[k] === '{') depth++; else if (W[k] === '}') depth--; k++; } while (depth > 0);
var joinNights = eval('(' + W.slice(i, k) + ')');
ok('known nights and games, in week order', JSON.stringify(joinNights({ nights: ['fri', 'wed', 'xmas'], games: ['members', 'trivia', 'poker'] })) === '{"nights":["wed","fri"],"games":["trivia","members"]}',
   JSON.stringify(joinNights({ nights: ['fri', 'wed', 'xmas'], games: ['members', 'trivia', 'poker'] })));
ok('nothing at all for a venue that never answered', JSON.stringify(joinNights({})) === '{}' && JSON.stringify(joinNights(null)) === '{}');
ok('/join/info carries them', /\}, \.\.\.joinNights\(cfg\.setup_answers\) \}, venueId: venueId \};/.test(W));
ok('and a database without migration 163 is asked again without the column', /try \{ rows = await sbGet\(env, 'vp_venue_settings', 'venue_id=eq\.' \+ enc\(venueId\) \+ '&select=' \+ cols \+ ',setup_answers&limit=1'\); \}\s*\n\s*catch \(e\) \{ rows = await sbGet\(env, 'vp_venue_settings', 'venue_id=eq\.' \+ enc\(venueId\) \+ '&select=' \+ cols \+ '&limit=1'\); \}/.test(W));

print('\nTHE TRIVIA PHONE uses it');
var PLAY = readFile('venueplay/app/trivia/play.html');
ok('loads the module', PLAY.indexOf('<script src="/app/vp-tonight.js"></script>') > 0);
ok('the plain lobby (no other heading, nothing scored) is option C', /var useT = !head && !\(P\.total>0\) && typeof VPTonight==="object";/.test(PLAY) && /VPTonight\.lobby\(tn, \{ name:P\.name, me:"trivia"/.test(PLAY));
ok('"No game on right now" is option B', /VPTonight\.noGame\(tn, \{ name:P\.name, nights:P\.nights, games:P\.games, venue:P\.venueName, onList:onList\(\) \}\);/.test(PLAY));
ok('the nights come from /join/info', /P\.nights=\(r&&Array\.isArray\(r\.nights\)\)\?r\.nights:\[\]; P\.games=\(r&&Array\.isArray\(r\.games\)\)\?r\.games:\[\];/.test(PLAY));

print('');
print(bad ? (bad + ' FAILED, ' + ran + ' run') : ('ALL ' + ran + ' CHECKS PASSED'));
