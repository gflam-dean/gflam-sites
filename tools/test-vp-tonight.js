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
print('\n"YOU\'RE IN", Dean\'s round 7 notes: one layout for every lobby');
var box = new Node('div');
var lb = T.lobby(box, { name: 'Sam', me: 'trivia', prize: 'Winners take a $50 bar tab', nights: ['wed', 'fri'], games: ['trivia', 'musical'], now: FRI });
ok('"You\'re in, Sam" beside the ring tick', byClass(box, 't')[0].textContent === 'You’re in, Sam' && byClass(box, 'vpt-head')[0].innerHTML.indexOf('vp-tick') > 0);
var spot = byClass(box, 'vpt-night')[0], rows = byClass(spot, 'row');
ok('one game tonight (no game per night stored): NEXT, "Tonight", its real prize after it, no Later row', rows.length === 1 && byClass(rows[0], 'bd')[0].textContent === 'Next' && /Trivia/.test(rows[0].textContent) && /Tonight, Winners take a \$50 bar tab/.test(rows[0].textContent) && !/TONIGHT/.test(byClass(spot, 'nk').map(function (x) { return x.textContent; }).join()), texts(spot, 'row'));
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
ok('tap Wednesday: the spot shows that night (no game per night stored: "Game night", ask at the bar)', /Wed 11/.test(spot.textContent) && /Game night/.test(spot.textContent) && /Ask at the bar/.test(spot.textContent), spot.textContent);
ok('and Wednesday is marked as picked', /picked/.test(days[5].className) && !/picked/.test(days[0].className));
days[1].onclick();
ok('tap Saturday, not a game night: "No games this night"', /No games this night/.test(spot.textContent), spot.textContent);
days[0].onclick();
ok('tap Today: back to tonight', byClass(spot, 'row').length === 1 && /Next/.test(spot.textContent) && /Tonight/.test(spot.textContent) && /Trivia/.test(spot.textContent), spot.textContent);
var tm = new Node('div');
T.lobby(tm, { name: 'Sam', me: 'trivia', nights: ['wed'], week: [{ day: 'wed', games: [{ game: 'trivia' }, { game: 'members', start: '19:30' }] }], now: FRI });
byClass(byClass(tm, 'vpt-week')[0], 'd')[5].onclick();
var tms = byClass(tm, 'vpt-night')[0];
ok('with game per night stored: "Trivia night, Ask for start time" and "Members draw, 7:30pm"', /Trivia night/.test(tms.textContent) && /Ask for start time/.test(tms.textContent) && /Members draw/.test(tms.textContent) && /7:30pm/.test(tms.textContent), tms.textContent);
ok('and with a time stored the "Ask at the bar" line is not in the strip head', !/Ask at the bar for start times/.test(byClass(tm, 'vpt-week')[0].textContent));
ok('a stored night with no games is not marked', (function () { var z = new Node('div'); T.lobby(z, { me: 'trivia', nights: ['wed'], week: [{ day: 'mon', games: [{ game: 'trivia' }] }, { day: 'wed', games: [] }], now: FRI }); return !/\bon\b/.test(byClass(byClass(z, 'vpt-week')[0], 'd')[5].className); })());
var mu = new Node('div');
T.lobby(mu, { name: 'Sam', me: 'musical', week: [{ day: 'fri', games: [{ game: 'trivia', start: '19:00' }, { game: 'musical', start: '21:00' }] }], now: FRI });
var mr = byClass(byClass(mu, 'vpt-night')[0], 'row');
ok('a game that starts before this one tonight is EARLIER, not later (musical at 9pm, trivia at 7pm)', mr.length === 2 && byClass(mr[0], 'bd')[0].textContent === 'Next' && /Musical/.test(mr[0].textContent) && byClass(mr[1], 'bd')[0].textContent === 'Earlier' && /Trivia/.test(mr[1].textContent), texts(mu, 'row'));
ok('"Tonight 7pm" under this game, "Tonight 9pm" under the later one (Dean\'s round 7)', /Tonight 7pm/.test(byClass(byClass(two, 'vpt-night')[0], 'row')[0].textContent) && /Tonight 9pm/.test(byClass(byClass(two, 'vpt-night')[0], 'row')[1].textContent), texts(two, 'row'));
ok('then the lobby line', byClass(box, 'vpt-wait')[0].textContent === 'The game will start here when the host is ready.');
ok('times read as people say them, and a bad one is dropped', T.time12('19:30') === '7:30pm' && T.time12('19:00') === '7pm' && T.time12('9:05') === '9:05am' && T.time12('25:00') === '' && T.time12('<b>') === '');
var evil = new Node('div');
T.lobby(evil, { name: '<img src=x onerror=alert(1)>', me: 'trivia', prize: '<b>x</b>', now: WED });
ok('a name or prize is set as text, never as HTML', all(evil).every(function (n) { return n._html.indexOf('<img') < 0 && n._html.indexOf('<b>') < 0; }) && /<img src=x/.test(byClass(evil, 't')[0].textContent));

print('\n"NO GAME ON RIGHT NOW", Dean\'s round 7 notes');
var ng = new Node('div');
T.noGame(ng, { name: 'Sam', nights: ['wed', 'fri'], games: ['trivia'], venue: 'Tugun Bowls Club', now: new Date(2026, 10, 7, 12, 0, 0) });
ok('no "You\'re in" and no "No game here right now"', byClass(ng, 't').length === 0 && !/You.re in/.test(ng.textContent) && !/No game here right now/i.test(ng.textContent), ng.textContent);
ok('it leads with "Next game here" and the next game night (Wednesday, from a Saturday)', ng.children[0].className === 'vpt-next' && /Next game here/.test(ng.children[0].textContent) && /Wednesday, ask at the bar/.test(ng.children[0].textContent), ng.children[0].textContent);
var ngw = new Node('div');
T.noGame(ngw, { week: [{ day: 'wed', games: [{ game: 'trivia', start: '19:00' }] }, { day: 'fri', games: [{ game: 'musical', start: '19:30' }, { game: 'members' }] }], now: new Date(2026, 10, 7, 12, 0, 0) });
ok('with the week stored: "Next game here: Wednesday, Trivia 7pm"', /Next game here/.test(ngw.children[0].textContent) && /Wednesday, Trivia 7pm/.test(ngw.children[0].textContent), ngw.children[0].textContent);
byClass(ngw, 'd')[6].onclick();
ok('tap Friday: the lead line shows Friday\'s games', /Friday 13/.test(ngw.children[0].textContent) && /Musical bingo 7:30pm and Members draw/.test(ngw.children[0].textContent) && /picked/.test(byClass(ngw, 'd')[6].className), ngw.children[0].textContent);
byClass(ngw, 'd')[1].onclick();
ok('tap Saturday: no games', /no games/.test(ngw.children[0].textContent), ngw.children[0].textContent);
ok('no sign-up box when the page has no way to send one', byClass(ng, 'vpt-sign').length === 0);
ok('then the week strip, on the next game night (Wednesday)', byClass(ng, 'vpt-week').length === 1 && /picked/.test(byClass(ng, 'd')[4].className), texts(ng, 'd'));
ok('never "you\'re on the list"', !/on .*list/i.test(ng.textContent));
var sent = [], sg = new Node('div'), resolveIt;
T.noGame(sg, { name: 'Sam', venue: 'Tugun Bowls Club', signup: function (e, o) { sent.push([e, o]); return { then: function (ok_) { resolveIt = ok_; } }; }, now: WED });
var form = byClass(sg, 'vpt-sign')[0];
ok('with a way to send it: a small "Get a heads up by email" at the TOP (right under the next game), one field, the offers tick naming the venue', !!form && sg.children[1] === form && /Get a heads up by email/.test(form.textContent) && /Send me offers from Tugun Bowls Club\. I’m 18 or over\./.test(form.textContent) && all(form).filter(function (n) { return n.tagName === 'input'; }).length === 2);
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
ok('no nights known: no night marked, "ask at the bar", nothing invented', byClass(blank, 'd').every(function (x) { return !/\bon\b/.test(x.className); }) && /Ask at the bar for the next game night/.test(blank.children[0].textContent), blank.children[0].textContent);

print('\nTHE WIZARD\'S NEWER WEEK: Something-else nights, several sessions, and room for the venue\'s own events');
var kx = new Node('div');
T.noGame(kx, { week: [{ day: 'fri', games: [{ game: 'bingo', start: '18:00', count: 2 }] }, { day: 'sat', games: [{ game: 'other', name: 'Karaoke', start: '21:00' }] }], now: new Date(2026, 10, 6, 12, 0, 0) });
ok('"Bingo ×2 6pm" tonight (count 2 to 4 sessions)', /Tonight, Bingo ×2 6pm/.test(kx.children[0].textContent), kx.children[0].textContent);
byClass(kx, 'd')[1].onclick();
ok('a Something-else night by its own name: "Karaoke 9pm"', /Karaoke 9pm/.test(kx.children[0].textContent) && /\bon\b/.test(byClass(kx, 'd')[1].className), kx.children[0].textContent);
var ev = new Node('div');
T.lobby(ev, { name: 'Sam', me: 'trivia', events: { wed: [{ name: 'Live music', start: '20:00' }] }, now: FRI });
byClass(byClass(ev, 'vpt-week')[0], 'd')[5].onclick();
ok('a third kind of row is ready: the venue\'s own event on a night shows with its time, and marks the day', /Live music/.test(byClass(ev, 'vpt-night')[0].textContent) && /8pm/.test(byClass(ev, 'vpt-night')[0].textContent) && /\bon\b/.test(byClass(byClass(ev, 'vpt-week')[0], 'd')[5].className), byClass(ev, 'vpt-night')[0].textContent);
var ng2 = new Node('div');
T.noGame(ng2, { week: [{ day: 'fri', games: [{ game: 'other', name: '' }, { game: 'poker' }] }], now: FRI });
ok('a Something-else night with no name, or a game nobody knows, is left out', /Ask at the bar for the next game night/.test(ng2.children[0].textContent), ng2.children[0].textContent);

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
var J3 = JSON.stringify(joinNights({ week: [{ day: 'fri', games: [{ game: 'bingo', start: '18:00', count: 2 }, { game: 'trivia', count: 9 }, { game: 'other', name: '  Karaoke <b> night ', start: '21:00' }, { game: 'other', name: 'karaoke <b> night' }, { game: 'other', name: '' }] }] }));
ok('Something-else nights by name (cleaned, once per name), sessions 2 to 4 kept, anything else dropped', J3 === '{"week":[{"day":"fri","games":[{"game":"trivia"},{"game":"bingo","start":"18:00","count":2},{"game":"other","name":"Karaoke b night","start":"21:00"}]}]}', J3);
ok('/join/info carries them', /\}, \.\.\.joinNights\(cfg\.setup_answers\) \}, venueId: venueId \};/.test(W));
ok('and a database without migration 163 is asked again without the column', /try \{ rows = await sbGet\(env, 'vp_venue_settings', 'venue_id=eq\.' \+ enc\(venueId\) \+ '&select=' \+ cols \+ ',setup_answers&limit=1'\); \}\s*\n\s*catch \(e\) \{ rows = await sbGet\(env, 'vp_venue_settings', 'venue_id=eq\.' \+ enc\(venueId\) \+ '&select=' \+ cols \+ '&limit=1'\); \}/.test(W));
print('\nTHE TRIVIA PHONE uses it');
var PLAY = readFile('venueplay/app/trivia/play.html');
ok('loads the module and its shared look', PLAY.indexOf('<script src="/app/vp-tonight.js"></script>') > 0 && PLAY.indexOf('<link rel="stylesheet" href="/app/vp-tonight.css">') > 0);
var CSS = readFile('venueplay/app/vp-tonight.css');
ok('the shared look holds the ad and the waiting screens (one copy, moved out of vp-phone.css)', /#vpAd\{/.test(CSS) && /\.vpt-week \.days\{/.test(CSS) && !/#vpAd\{/.test(readFile('venueplay/app/vp-phone.css')));
ok('the ad under a waiting screen is shorter (5:2), so it and our logo fit 664px', /\.vpt-on #vpAd \.slide\{aspect-ratio:5\/2\}/.test(CSS) && /ap\.classList\.toggle\("vpt-on", which==="vWait"\)/.test(PLAY));
ok('the plain lobby (no other heading, nothing scored) is option C', /var useT = !head && !\(P\.total>0\) && typeof VPTonight==="object";/.test(PLAY) && /VPTonight\.lobby\(tn, \{ name:P\.name, me:"trivia"/.test(PLAY));
ok('"No game on right now" is the round 5 pick, with the week', /VPTonight\.noGame\(tn, \{ name:P\.name, nights:P\.nights, games:P\.games, week:P\.week, venue:P\.venueName,/.test(PLAY));
ok('the nights come from /join/info', /P\.nights=\(r&&Array\.isArray\(r\.nights\)\)\?r\.nights:\[\]; P\.games=\(r&&Array\.isArray\(r\.games\)\)\?r\.games:\[\]; P\.week=/.test(PLAY));

print('\n"JOIN {VENUE}\'S LIST" IN THE MENU (Dean, 6 Nov 2026)');
var mb = new Node('div'), sentL = [], resL;
var ml = T.menuList(mb, { venue: 'Tugun Bowls Club', collect: { email: true, mobile: true }, send: function (f) { sentL.push(f); return { then: function (ok_) { resL = ok_; } }; } });
ok('one menu row, "Join Tugun Bowls Club\'s list", its form closed', mb.children[0].textContent === 'Join Tugun Bowls Club’s list' && /hidden/.test(mb.children[1].className));
ml.row.onclick();
ok('tapped, it opens: the venue\'s fields (email and mobile), the approved tick, "Join the list"', !/hidden/.test(mb.children[1].className) && all(mb.children[1]).filter(function (n) { return n.tagName === 'input'; }).length === 3 && /Send me offers from Tugun Bowls Club\. I’m 18 or over\./.test(mb.children[1].textContent) && /Join the list/.test(mb.children[1].textContent));
var mi = all(mb.children[1]).filter(function (n) { return n.tagName === 'input'; });
mi[0].value = 'sam@example.com';
var realP = Promise; Promise = { resolve: function (x) { return x; } };
ml.form.onsubmit({ preventDefault: function () {} });
ok('not sent without the tick (the tick is what joining the list means)', sentL.length === 0 && /Tick the box/.test(byClass(mb.children[1], 'err')[0].textContent));
mi[2].checked = true; mi[1].value = '12';
ml.form.onsubmit({ preventDefault: function () {} });
ok('a junk mobile is not sent', sentL.length === 0 && /mobile/.test(byClass(mb.children[1], 'err')[0].textContent));
mi[1].value = '0412 345 678';
ml.form.onsubmit({ preventDefault: function () {} }); Promise = realP;
ok('ticked, with an email and a mobile: sent once, opted in', sentL.length === 1 && sentL[0].email === 'sam@example.com' && sentL[0].mobile === '0412 345 678' && sentL[0].optin === true, JSON.stringify(sentL));
resL();
ok('and once sent the row is gone', mb.children.length === 0);
var mn = new Node('div');
ok('a venue that collects no way to reach anyone: no row', T.menuList(mn, { venue: 'X', collect: {}, send: function () {} }) === null && mn.children.length === 0);
var me1 = new Node('div'); T.menuList(me1, { venue: 'X', collect: { email: true }, send: function () {} });
ok('only the fields the venue collects (email only: no mobile box)', all(me1.children[1]).filter(function (n) { return n.tagName === 'input'; }).length === 2);
ok('the trivia phone has the row in its menu, only where the venue collects the tick and a way to reach them, only once in, gone once on the list',
   /<div id="vpListItem"><\/div>/.test(PLAY) && /if\(typeof VPTonight!=="object" \|\| !P\.joined \|\| onList\(\) \|\| !\(c\.marketing_optin && \(c\.email \|\| c\.mobile\)\)\)\{ b\.innerHTML=""; return; \}/.test(PLAY));
ok('it sends through /join/list, and a ticked send puts the phone on the list', /send:function\(f\)\{ return listSend\(f\.email, f\.mobile, true\); \}/.test(PLAY) && /if\(optin===true && r && r\.stored\) setOnList\(\);/.test(PLAY));
ok('a player who ticked the offers when joining is on the list (no row)', /if\(P\.capture && P\.capture\.marketing_optin===true\) setOnList\(\); else paintListItem\(\);/.test(PLAY));

print('');
print(bad ? (bad + ' FAILED, ' + ran + ' run') : ('ALL ' + ran + ' CHECKS PASSED'));
