/* WHAT'S ON, THE VENUE'S OWN NIGHTS (INBOX 110, Dean 6 Nov 2026; promised to Revolver Upstairs for the Thu 12 Nov release).

   RUNS the real code, never greps it:
     - /app/vp-whatson.js: one date, or every week (with an optional last date); past nights drop off by themselves;
       "Tonight", "Tomorrow", "Fri 13 Nov"; the TV's list slides (five a slide, two at most) and poster slides (the
       soonest three with a picture, a weekly one once); every venue word is escaped on the TV
     - /app/vp-tonight.js with events: a gold dot on a day with one, its rows badged with the start time beside our
       games, "+N more tonight" past three in the lobby, the no-game screen's list for the picked day; no events: as before
     - /app/vp-whatson-edit.js (the account page): the list in date order, the form's checks in words, a save and a
       remove that repaint from the Worker's answer, Copy asking for a new date, the 30 cap
     - the billing Worker's vpbCleanEvent / vpbKeepEvents / vpbOurAdUrl and the game Worker's publicEvents: only the
       cleaned public fields, past ones dropped, a picture only from this venue's own folder; the caps agree
     - the pages load the shared file and pass the events on

   Run from the repo root:  jsc tools/test-whats-on.js
*/
var ran = 0, bad = 0;
function ok(n, c, saw) { ran++; print((c ? '  ok   ' : '  FAIL ') + n + (c || saw === undefined ? '' : '   saw: ' + saw)); if (!c) bad++; }

/* A fake document: createElement, appendChild, textContent, innerHTML (kept as a string), attributes, hidden, style. */
function Node(tag) { this.tagName = tag; this.children = []; this.className = ''; this._text = ''; this._html = ''; this.attrs = {}; this.style = {}; this.hidden = false; this.value = ''; this.parentNode = null; }
function detach(c) { if (c.parentNode) { var k = c.parentNode.children.indexOf(c); if (k >= 0) c.parentNode.children.splice(k, 1); } }
Node.prototype.appendChild = function (c) { detach(c); this.children.push(c); c.parentNode = this; return c; };
Node.prototype.insertBefore = function (c, ref) { detach(c); var k = this.children.indexOf(ref); if (k < 0) this.children.push(c); else this.children.splice(k, 0, c); c.parentNode = this; return c; };
Node.prototype.setAttribute = function (k, v) { this.attrs[k] = String(v); };
Node.prototype.getAttribute = function (k) { return this.attrs[k] === undefined ? null : this.attrs[k]; };
Node.prototype.focus = function () {}; Node.prototype.scrollIntoView = function () {}; Node.prototype.click = function () { if (this.onclick) this.onclick(); };
Node.prototype.querySelectorAll = function (sel) { return byClass(this, sel.replace(/^\./, '')); };
Object.defineProperty(Node.prototype, 'textContent', {
  get: function () { return this._text + this.children.map(function (c) { return c.textContent; }).join(' '); },
  set: function (v) { this._text = String(v); this.children = []; this._html = ''; } });
Object.defineProperty(Node.prototype, 'innerHTML', {
  get: function () { return this._html; }, set: function (v) { this._html = String(v); this.children = []; this._text = ''; } });
function all(n, out) { out = out || []; n.children.forEach(function (c) { out.push(c); all(c, out); }); return out; }
function byClass(n, cls) { return all(n).filter(function (c) { return (' ' + c.className + ' ').indexOf(' ' + cls + ' ') !== -1; }); }
function texts(n, cls) { return byClass(n, cls).map(function (r) { return r.textContent; }).join(' | '); }
function drain() { if (typeof drainMicrotasks === 'function') drainMicrotasks(); }
function visible(n) { while (n) { if (n.hidden) return false; n = n.parentNode; } return true; }

var window = { document: { createElement: function (t) { return new Node(t); } } };
(function () { eval(readFile('venueplay/app/vp-whatson.js')); }).call(window);
(function () { eval(readFile('venueplay/app/vp-tonight.js')); }).call(window);
(function () { eval(readFile('venueplay/app/vp-whatson-edit.js')); }).call(window);
var W = window.VPWhatsOn, T = window.VPTonight, E = window.VPWhatsOnEdit;
ok('the three files load', !!W && !!T && !!E && typeof W.tvSlides === 'function' && typeof E.mount === 'function');

/* Thursday 12 Nov 2026 (the release day), fixed: never the real clock. Revolver's own nights. */
var TODAY = '2026-11-12', THU = new Date(2026, 10, 12, 18, 40);
var EV = [
  { id: 'e1', title: 'Revolver Fridays', day: 'fri', start: '22:00', line: '4 deck dancefloor battle', image_url: 'https://x.supabase.co/storage/v1/object/public/venue-ads/v/fri.jpg' },
  { id: 'e2', title: 'I ♥ 3181', day: 'thu', start: '21:00', line: 'Back bar' },
  { id: 'e3', title: 'Mount Kujo album launch', date: '2026-11-14', start: '20:00', image_url: 'https://x.supabase.co/storage/v1/object/public/venue-ads/v/kujo.jpg' },
  { id: 'e4', title: 'Rise & Shine', day: 'sat', start: '07:00' },
  { id: 'e5', title: 'Love, Jess', date: '2026-11-20', start: '21:00', image_url: 'https://x.supabase.co/storage/v1/object/public/venue-ads/v/jess.jpg' },
  { id: 'e6', title: 'Last week\'s gig', date: '2026-11-05', start: '20:00' },
  { id: 'e7', title: 'Old weekly', day: 'mon', until: '2026-11-09' }
];

print('\nTHE DATE RULES (vp-whatson.js), one set for the TV, the phones and the account page');
ok('a one-off is on its date only', W.isOn(EV[2], '2026-11-14') && !W.isOn(EV[2], '2026-11-21'));
ok('a weekly night is on every one of its weekday', W.isOn(EV[0], '2026-11-13') && W.isOn(EV[0], '2026-11-20') && !W.isOn(EV[0], '2026-11-14'));
ok('a weekly night stops after its last date', !W.isOn({ title: 'x', day: 'fri', until: '2026-11-13' }, '2026-11-20') && W.isOn({ title: 'x', day: 'fri', until: '2026-11-13' }, '2026-11-13'));
ok('past nights drop off by themselves (a finished one-off, a weekly past its last date)', W.sorted(EV, TODAY).map(function (e) { return e.id; }).join() === 'e2,e1,e4,e3,e5', W.sorted(EV, TODAY).map(function (e) { return e.id; }).join());
ok('today\'s one-off is still on today', W.current({ title: 'x', date: TODAY }, TODAY) && !W.current({ title: 'x', date: '2026-11-11' }, TODAY));
ok('the nights on a date, earliest first', W.on(EV, '2026-11-14').map(function (e) { return e.id; }).join() === 'e4,e3');
ok('the next seven days in date and time order', W.upcoming(EV, TODAY, 7).map(function (x) { return x.date.slice(8) + x.ev.id; }).join() === '12e2,13e1,14e4,14e3', W.upcoming(EV, TODAY, 7).map(function (x) { return x.date.slice(8) + x.ev.id; }).join());
ok('labels read as people say them', W.dayLabel(TODAY, TODAY) === 'Tonight' && W.dayLabel('2026-11-13', TODAY) === 'Tomorrow' && W.dayLabel('2026-11-14', TODAY) === 'Sat 14 Nov' && W.dayLabel('2026-11-14', TODAY, true) === 'Saturday 14 Nov');
ok('an apostrophe inside a word is the curly one everywhere (the TV too)', W.clean([{ title: "What's the story?", day: 'fri', line: "Don't miss it" }])[0].title === 'What\u2019s the story?' && W.clean([{ title: "x", day: 'fri', line: "Don't miss it" }])[0].line === 'Don\u2019t miss it');
ok('the account page\'s when: "Every Friday, 10pm" and "Sat 14 Nov, 8pm" and a last date', W.whenText(EV[0], TODAY) === 'Every Friday, 10pm' && W.whenText(EV[2], TODAY) === 'Sat 14 Nov, 8pm' && W.whenText({ title: 'x', day: 'fri', until: '2026-12-18' }, TODAY) === 'Every Friday, until 18 Dec', W.whenText(EV[0], TODAY) + ' / ' + W.whenText({ title: 'x', day: 'fri', until: '2026-12-18' }, TODAY));
ok('a bad entry is left out, never guessed: no title, no day, a made-up date, a bad time, a picture that is not a web address', W.clean([{ day: 'fri' }, { title: 'x' }, { title: 'y', date: '2026-02-30' }, { title: 'z', day: 'fri', start: '25:00', image_url: 'javascript:alert(1)' }]).length === 1 && !W.clean([{ title: 'z', day: 'fri', start: '25:00', image_url: 'javascript:alert(1)' }])[0].start && !W.clean([{ title: 'z', day: 'fri', image_url: 'ftp://x/y.jpg' }])[0].image_url);
ok('at most 30 (the cap)', W.clean(Array.apply(null, Array(40)).map(function (_, i) { return { title: 't' + i, day: 'fri' }; })).length === 30 && W.MAX === 30);
ok('the TV\'s date comes from the venue\'s own time zone', W.todayIn('Australia/Brisbane', new Date(Date.UTC(2026, 10, 12, 15, 0))) === '2026-11-13' && W.todayIn('Australia/Perth', new Date(Date.UTC(2026, 10, 12, 15, 0))) === '2026-11-12');

print('\nTHE TV (tv.html between games)');
var sl = W.tvSlides(EV, TODAY);
ok('one list slide for the week, then a poster for each night with a picture', sl.length === 3 && sl[0].type === 'list' && sl[1].type === 'poster' && sl[2].type === 'poster', sl.map(function (x) { return x.type; }).join());
ok('the list in date order, Tonight first', sl[0].rows.map(function (r) { return r.label + ':' + r.ev.id; }).join() === 'Tonight:e2,Tomorrow:e1,Sat 14 Nov:e4,Sat 14 Nov:e3', sl[0].rows.map(function (r) { return r.label + ':' + r.ev.id; }).join());
ok('a poster for the soonest nights with a picture: Friday, then Mount Kujo (Love, Jess is next week, off the list)', sl[1].ev.id === 'e1' && sl[1].label === 'Tomorrow' && sl[2].ev.id === 'e3');
var many = []; for (var i = 0; i < 14; i++) many.push({ title: 'n' + i, day: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'][i % 7], start: '20:00' });
var ms = W.tvSlides(many, TODAY);
ok('five a list slide, two list slides at most (ten nights)', ms.length === 2 && ms[0].rows.length === 5 && ms[1].rows.length === 5);
ok('a weekly night with a picture is one poster, not one a week; three posters at most', W.tvSlides([EV[0]], '2026-11-06').filter(function (x) { return x.type === 'poster'; }).length === 1 && W.tvSlides([1, 2, 3, 4, 5].map(function (n) { return { title: 'p' + n, date: '2026-11-1' + (n + 2), image_url: 'https://a/p' + n + '.jpg' }; }), TODAY).filter(function (x) { return x.type === 'poster'; }).length === 3);
var gw = W.tvSlides(EV, TODAY, [{ day: 'wed', games: [{ game: 'musical', start: '20:00' }] }, { day: 'thu', games: [{ game: 'trivia', start: '19:30' }] }]);
var gwRows = gw.reduce(function (a, x) { return a.concat(x.rows || []); }, []);
ok('our game nights join the list (Dean, 6 Nov): tonight\'s trivia at 7:30pm before the venue\'s 9pm night', gw[0].rows[0].ev.game === 'trivia' && gw[0].rows[0].ev.title === 'Trivia night' && gw[0].rows[1].ev.id === 'e2', JSON.stringify(gw[0].rows.map(function (r) { return r.ev.title; })));
var ko = W.tvSlides(EV, TODAY, [{ day: 'fri', games: [{ game: 'bingo', start: '18:00', count: 2 }, { game: 'other', name: 'Karaoke', start: '21:00' }] }]).reduce(function (a, x) { return a.concat(x.rows || []); }, []);
ok('the wizard\'s newer week on the TV: "Bingo \u00d72" and a Something-else night by its own name (no phone line)', ko.some(function (r) { return r.ev.title === 'Bingo \u00d72' && r.ev.line === 'Play on your phone'; }) && ko.some(function (r) { return r.ev.title === 'Karaoke' && !r.ev.line; }), JSON.stringify(ko.map(function (r) { return r.ev.title; })));
ok('a game night never gets a poster, and our games alone make no What\'s on slide', gw.filter(function (x) { return x.type === 'poster'; }).every(function (x) { return !x.ev.game; }) && W.tvSlides([], TODAY, [{ day: 'thu', games: [{ game: 'trivia' }] }]).length === 0);
ok('nothing on: no What\'s on slide at all', W.tvSlides([], TODAY).length === 0 && W.tvSlides([EV[5]], TODAY).length === 0);
var h0 = W.tvHtml(sl[0], 'Revolver Upstairs'), h1 = W.tvHtml(sl[1], 'Revolver Upstairs');
ok('the list slide: the venue as a kicker over WHAT\u2019S ON, a Tonight row, the times as people say them', /wo-kick">Revolver Upstairs</.test(h0) && /wo-head">What\u2019s on</.test(h0) && /wo-row tonight/.test(h0) && />9pm</.test(h0) && />10pm</.test(h0) && !/PM</.test(h0), h0.slice(0, 300));
ok('the poster slide: the picture whole, "Tomorrow, 10pm" big beside the title, the title and line', /wo-pic/.test(h1) && /fri\.jpg/.test(h1) && /wo-when">Tomorrow \u00b7 10pm</.test(h1) && /Revolver Fridays/.test(h1) && /4 deck dancefloor battle/.test(h1));
var evil = W.tvHtml(W.tvSlides([{ title: '<img src=x onerror=alert(1)>', day: 'thu', line: '"><script>', image_url: 'https://a/b.jpg?x=1&#41;' }], TODAY)[0], '<b>pub</b>');
ok('every venue word is escaped on the wall', evil.indexOf('<img') === -1 && evil.indexOf('<script') === -1 && evil.indexOf('<b>pub') === -1 && /&lt;img/.test(evil));
ok('a picture address with an entity in it is refused', W.tvSlides([{ title: 'x', day: 'thu', image_url: 'https://a/b.jpg?x=1&#41;' }], TODAY).length === 1);

print('\nTHE PHONE\'S WEEK STRIP (vp-tonight.js with the venue\'s events)');
var WEEK = [{ day: 'wed', games: [{ game: 'musical', start: '20:00' }] }, { day: 'thu', games: [{ game: 'trivia', start: '19:30' }] }];
var box = new Node('div');
var lb = T.lobby(box, { name: 'Sam', me: 'trivia', week: WEEK, events: EV, now: THU });
var spot = byClass(box, 'vpt-night')[0], rows = byClass(spot, 'row');
ok('the lobby opens exactly as Dean\'s round 7 lobby (our game alone), so the ad and our logo still fit 664px', rows.length === 1 && byClass(rows[0], 'bd')[0].textContent === 'Next' && /Trivia/.test(rows[0].textContent) && !byClass(spot, 'nk').length, texts(spot, 'row'));
ok('the strip says "Tap a day" when the venue has nights this week', /Tap a day/.test(byClass(box, 'vpt-week')[0].textContent));
lb.buttons[0].onclick();
rows = byClass(spot, 'row');
ok('tap Today: TONIGHT once (our game\'s line says 7:30pm, not Tonight 7:30pm), our game first (NEXT), then the venue\'s night badged with its time, its title alone (design review)', byClass(spot, 'nk').length === 1 && byClass(spot, 'nk')[0].textContent === 'Tonight' && rows.length === 2 && byClass(rows[0], 'bd')[0].textContent === 'Next' && !/Tonight/.test(rows[0].textContent) && /7:30pm/.test(rows[0].textContent) && byClass(rows[1], 'bd')[0].textContent === '9pm' && /I \u2665 3181/.test(rows[1].textContent) && !/Back bar/.test(rows[1].textContent) && /\bev\b/.test(rows[1].className), texts(spot, 'row'));
var days = lb.buttons;
ok('a gold dot on the days with one of the venue\'s nights (Thu, Fri, Sat, Sun no)', /\bev\b/.test(days[0].className) && /\bev\b/.test(days[1].className) && /\bev\b/.test(days[2].className) && !/\bev\b/.test(days[3].className), days.map(function (d) { return d.className; }).join('|'));
ok('our game nights keep their own mark beside it', /\bon\b/.test(days[0].className) && /\bon\b/.test(days[6].className) && !/\bon\b/.test(days[1].className));
days[2].onclick();
ok('tap Saturday (no game): the card says SATURDAY 14, then the venue\'s two nights, earliest first, and no "No games this night"', byClass(spot, 'nk').length === 1 && byClass(spot, 'nk')[0].textContent === 'Saturday 14' && byClass(spot, 'row').length === 2 && /Rise & Shine/.test(byClass(spot, 'row')[0].textContent) && /7am/.test(byClass(spot, 'row')[0].textContent) && /Mount Kujo/.test(byClass(spot, 'row')[1].textContent) && !/No games this night/.test(spot.textContent), texts(spot, 'row'));
days[6].onclick();
ok('tap Wednesday (a game night, no events): our game alone, as before, no day heading', !byClass(spot, 'nk').length && byClass(spot, 'row').length === 1 && /Musical bingo/.test(spot.textContent) && /8pm/.test(spot.textContent));
days[3].onclick();
ok('tap Sunday (nothing): "No games this night"', /No games this night/.test(spot.textContent));
var lots = EV.concat([{ id: 'x1', title: 'Two', day: 'thu', start: '22:00' }, { id: 'x2', title: 'Three', day: 'thu', start: '23:00' }, { id: 'x3', title: 'Four', day: 'thu' }]);
var lb2 = new Node('div'), st2 = T.lobby(lb2, { name: 'Sam', me: 'trivia', week: WEEK, events: lots, now: THU }); st2.buttons[0].onclick();
var r2 = byClass(byClass(lb2, 'vpt-night')[0], 'row');
ok('four nights tonight, Today tapped: our game, two of theirs, then "+2 more", so a busy night stays short', r2.length === 4 && /I \u2665 3181/.test(r2[1].textContent) && /\+2 more/.test(r2[3].textContent), texts(lb2, 'row'));
var lb3 = new Node('div'), st3 = T.lobby(lb3, { name: 'Sam', me: 'trivia', week: WEEK, events: lots.concat([{ id: 'x4', title: 'Five', day: 'fri' }, { id: 'x5', title: 'Six', day: 'fri' }, { id: 'x6', title: 'Seven', day: 'fri' }]), now: THU });
st3.buttons[1].onclick();
var r3 = byClass(byClass(lb3, 'vpt-night')[0], 'row');
ok('a tapped day with four nights: two, then "+2 more"', r3.length === 3 && /\+2 more/.test(r3[2].textContent) && /\bmore\b/.test(r3[2].className), texts(lb3, 'row'));
var none = new Node('div'); T.lobby(none, { name: 'Sam', me: 'trivia', week: WEEK, now: THU });
ok('no events: the lobby is exactly as before (one row, no dots)', byClass(byClass(none, 'vpt-night')[0], 'row').length === 1 && !byClass(none, 'ev').length);
var ng = new Node('div'), ngs = T.noGame(ng, { name: 'Sam', venue: 'Revolver Upstairs', week: WEEK, events: EV, now: THU });
var evb = byClass(ng, 'vpt-evs')[0];
ok('no game on: the venue\'s nights for the first game day (today), with no label of their own (the ad below says What\u2019s on)', evb && !evb.hidden && !byClass(evb, 'nk').length && /I \u2665 3181/.test(evb.textContent), evb && evb.textContent);
ngs.buttons[1].onclick();
ok('tap Friday: Friday\'s nights, and the lead line says "No games on Friday" on one line', /Revolver Fridays/.test(evb.textContent) && /10pm/.test(evb.textContent) && byClass(ng, 'vpt-next')[0].textContent.indexOf('No games on Friday') >= 0, [evb.textContent, byClass(ng, 'vpt-next')[0].textContent]);
ngs.buttons[3].onclick();
ok('tap a day with none: the list goes away', evb.hidden === true);
var ng0 = new Node('div'); T.noGame(ng0, { name: 'Sam', week: WEEK, now: THU });
ok('no events: no list on the no-game screen', byClass(ng0, 'vpt-evs')[0].hidden === true);
var ev2 = new Node('div'); T.lobby(ev2, { name: 'Sam', me: 'trivia', week: WEEK, events: [{ title: '<img src=x onerror=alert(1)>', day: 'thu', line: '<b>x</b>' }], now: THU }).buttons[0].onclick();
ok('an event\'s words are set as text on the phone', all(ev2).every(function (n) { return n._html.indexOf('<img') < 0 && n._html.indexOf('<b>') < 0; }) && /<img src=x/.test(ev2.textContent));

print('\nTHE ACCOUNT PAGE EDITOR (vp-whatson-edit.js)');
var said = [], saved = [], removed = [], serverList = EV.slice(0, 5);
var page = new Node('div');
var ed = E.mount(page, { events: EV, today: TODAY, venue: 'Revolver Upstairs',
  save: function (ev) { saved.push(ev); var l = serverList.filter(function (x) { return x.id !== ev.id; }); l.push(Object.assign({ id: ev.id || 'enew' }, ev)); serverList = l; return { then: function (f) { f({ ok: true, events: l }); } }; },
  remove: function (id) { removed.push(id); serverList = serverList.filter(function (x) { return x.id !== id; }); return { then: function (f) { f({ ok: true, events: serverList }); } }; },
  upload: function (f, done) { done('https://x.supabase.co/storage/v1/object/public/venue-ads/v/new.jpg'); },
  say: function (s, good) { said.push(s); } });
var list = byClass(page, 'woe');
ok('the list: five upcoming in date order, past ones gone', list.length === 5 && list.map(function (r) { return r.attrs['data-id']; }).join() === 'e2,e1,e4,e3,e5', list.map(function (r) { return r.attrs['data-id']; }).join());
ok('tonight\'s reads "Tonight, 9pm (every Thursday)" in gold; the others their when', /Tonight, 9pm \(every Thursday\)/.test(byClass(list[0], 'woe-when')[0].textContent) && /\btn\b/.test(byClass(list[0], 'woe-when')[0].className) && byClass(list[1], 'woe-when')[0].textContent === 'Every Friday, 10pm');
ok('a picture shows as its thumbnail; with none, the tile quietly says its day (THU)', /fri\.jpg/.test(byClass(list[1], 'woe-thumb')[0].style.backgroundImage) && byClass(list[0], 'woe-thumb')[0].textContent === 'THU');
ok('"5 of 30" and "+ Add an event"', /5 of 30/.test(texts(page, 'woe-count')) && byClass(page, 'woe-add').length === 1 && !byClass(page, 'woe-add')[0].hidden);
byClass(page, 'woe-add')[0].onclick();
var form = byClass(page, 'woe-form')[0];
ok('Add opens the form: Title, One date / Every week, Starts, One line about it (0 of 48), Picture with the poster date check, Save event', !form.hidden && /Add an event/.test(form.textContent) && /One date/.test(form.textContent) && /Every week/.test(form.textContent) && /Starts/.test(form.textContent) && /One line about it/.test(form.textContent) && /0 of 48/.test(form.textContent) && /Check the date on your poster/.test(form.textContent) && /Picture/.test(form.textContent) && /Save event/.test(form.textContent));
function inputs() { return all(form).filter(function (n) { return n.tagName === 'input'; }); }
function btn(t) { return all(form).filter(function (n) { return n.tagName === 'button' && n.textContent === t; })[0]; }
btn('Save event').onclick(); drain();
ok('Save with nothing in: "Give it a title." and nothing sent', /Give it a title/.test(texts(form, 'woe-err')) && saved.length === 0);
inputs()[0].value = 'DJ Tilly';
btn('Save event').onclick(); drain();
ok('no date: "Pick the date."', /Pick the date/.test(texts(form, 'woe-err')) && saved.length === 0);
inputs()[1].value = '2026-11-01';
btn('Save event').onclick(); drain();
ok('a date that has been: refused in words', /That date has been/.test(texts(form, 'woe-err')) && saved.length === 0);
btn('Every week').onclick();
btn('Save event').onclick(); drain();
ok('Every week with no day: "Pick the day it runs each week."', /Pick the day it runs each week/.test(texts(form, 'woe-err')) && saved.length === 0);
all(form).filter(function (n) { return n.attrs['data-day'] === 'sat'; })[0].onclick();
var ins = inputs(); ins[3].value = '23:00'; ins[4].value = 'Free entry before 11';
all(form).filter(function (n) { return n.tagName === 'button' && /Choose a picture/.test(n.textContent); })[0];
var fileIn = ins[5]; fileIn.files = [{ name: 'p.jpg' }]; fileIn.onchange();
btn('Save event').onclick(); drain();
ok('a good weekly event is sent with only its fields (day, start, line, the uploaded picture)', saved.length === 1 && saved[0].title === 'DJ Tilly' && saved[0].day === 'sat' && saved[0].start === '23:00' && saved[0].line === 'Free entry before 11' && /new\.jpg/.test(saved[0].image_url) && saved[0].date === undefined && !saved[0].id, JSON.stringify(saved[0]));
ok('then the form shuts, the list repaints from the Worker\'s answer, and it says it is on the TV', form.hidden && byClass(page, 'woe').length === 6 && /shows on your TV/.test(said[said.length - 1]));
ed.open('e3', true);
form = byClass(page, 'woe-form')[0];
ok('Copy: a new event with the details, its date asked for again', /Copy of Mount Kujo/.test(form.textContent) && inputs()[0].value === 'Mount Kujo album launch' && inputs()[1].value === '');
inputs()[1].value = '2026-11-28';
btn('Save event').onclick(); drain();
ok('and saved as a new one (no id), on its new date', saved.length === 2 && !saved[1].id && saved[1].date === '2026-11-28' && /kujo\.jpg/.test(saved[1].image_url));
ed.open('e1', false);
form = byClass(page, 'woe-form')[0];
ok('Edit opens in place of its row (the row hides, the form sits where it was); Add and Copy open at the top', form.parentNode === byClass(page, 'woe-list')[0] && byClass(page, 'woe').filter(function (r) { return r.attrs['data-id'] === 'e1'; })[0].hidden === true && byClass(page, 'woe-add')[0].hidden === true);
ok('Edit: the form holds it, Every week on Friday, keeping its id', /Edit event/.test(form.textContent) && inputs()[0].value === 'Revolver Fridays' && /\bon\b/.test(all(form).filter(function (n) { return n.attrs['data-day'] === 'fri'; })[0].className));
btn('Save event').onclick(); drain();
ok('saved under its own id', saved.length === 3 && saved[2].id === 'e1' && saved[2].day === 'fri');
var rm = byClass(page, 'woe').filter(function (r) { return r.attrs['data-id'] === 'e4'; })[0];
byClass(rm, 'woe-rm')[0].onclick(); drain();
ok('Remove takes it off at once, from the Worker\'s answer', removed.join() === 'e4' && !byClass(page, 'woe').some(function (r) { return r.attrs['data-id'] === 'e4'; }) && /comes off your TV/.test(said[said.length - 1]));
var full = new Node('div'); E.mount(full, { events: Array.apply(null, Array(30)).map(function (_, i) { return { id: 'f' + i, title: 't' + i, day: 'fri' }; }), today: TODAY, save: function () {}, remove: function () {} });
ok('at 30 the Add button goes ("30 of 30")', byClass(full, 'woe-add')[0].hidden === true && /30 of 30/.test(texts(full, 'woe-count')));
var empty = new Node('div'); E.mount(empty, { events: [], today: TODAY, save: function () {}, remove: function () {} });
ok('nothing yet: a line saying what to add', /Nothing on yet/.test(empty.textContent));
var fail = new Node('div'); E.mount(fail, { events: [], today: TODAY, save: function () { return { then: function (f) { f({ error: 'What’s on is not switched on yet.' }); } }; }, remove: function () {} });
byClass(fail, 'woe-add')[0].onclick(); form = byClass(fail, 'woe-form')[0];
inputs()[0].value = 'x'; inputs()[1].value = '2026-11-20'; btn('Save event').onclick(); drain(); drain();
ok('a refusal from the Worker is shown in the form, which stays open', /not switched on yet/.test(texts(form, 'woe-err')) && !form.hidden);

print('\nTHE WORKERS: only cleaned fields, past ones dropped, pictures from the venue\'s own folder');
function fnSrc(file, name) {
  var src = readFile(file), at = src.search(new RegExp('\\n\\s*(async )?function ' + name + '\\(')); if (at < 0) return '';
  var i = src.indexOf('{', at), dd = 0;
  for (var j = i; j < src.length; j++) { if (src[j] === '{') dd++; else if (src[j] === '}') { dd--; if (!dd) return src.slice(at, j + 1); } }
  return '';
}
var API = 'venueplay-backend/worker/venueplay-api-FULL.js', GAME = 'venueplay-backend/worker/venueplay-game.js';
var apiSrc = readFile(API), gameSrc = readFile(GAME);
var w = {};
(function () {
  eval('var VPB_MAX_EVENTS = 30; var VPB_EVENT_DAYS = [\'mon\', \'tue\', \'wed\', \'thu\', \'fri\', \'sat\', \'sun\'];' +
       ['vpbScreenStr', 'vpbEventsCutoff', 'vpbEventDate', 'vpbOurAdUrl', 'vpbCleanEvent', 'vpbKeepEvents'].map(function (n) { return fnSrc(API, n); }).join('\n') +
       fnSrc(GAME, 'publicEvents') +
       '\nw.clean = vpbCleanEvent; w.keep = vpbKeepEvents; w.ours = vpbOurAdUrl; w.cut = vpbEventsCutoff; w.pub = publicEvents;');
})();
var ENV = { SUPABASE_URL: 'https://x.supabase.co' }, VID = '11111111-2222-3333-4444-555555555555';
var OURS = 'https://x.supabase.co/storage/v1/object/public/venue-ads/' + VID + '/1700-ab.jpg';
var future = new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10), past = new Date(Date.now() - 5 * 864e5).toISOString().slice(0, 10);
ok('the Worker caps agree with the page (30)', /const VPB_MAX_EVENTS = 30;/.test(apiSrc) && W.MAX === 30 && /out\.length >= 30/.test(fnSrc(GAME, 'publicEvents')));
var c1 = w.clean(ENV, { title: '  DJ   Tilly ', date: future, start: '22:00', line: 'Free', image_url: OURS, extra: 'nope', id: '' }, VID);
ok('a good one-off is kept with only its fields', c1.ev && c1.ev.title === 'DJ Tilly' && c1.ev.date === future && c1.ev.start === '22:00' && c1.ev.image_url === OURS && c1.ev.extra === undefined && c1.ev.id === undefined, JSON.stringify(c1));
ok('refused in words: no title, a past date, no day, a bad time, a long title or line', /title/.test(w.clean(ENV, { date: future }, VID).error) && /has been/.test(w.clean(ENV, { title: 'x', date: past }, VID).error) && /Pick a date/.test(w.clean(ENV, { title: 'x' }, VID).error) && /start time/.test(w.clean(ENV, { title: 'x', day: 'fri', start: '7pm' }, VID).error) && /60/.test(w.clean(ENV, { title: new Array(70).join('x'), day: 'fri' }, VID).error) && /48/.test(w.clean(ENV, { title: 'x', day: 'fri', line: new Array(60).join('x') }, VID).error));
ok('a picture from anywhere but this venue\'s own folder is refused', /Upload the picture/.test(w.clean(ENV, { title: 'x', day: 'fri', image_url: 'https://evil.example/a.jpg' }, VID).error) && /Upload the picture/.test(w.clean(ENV, { title: 'x', day: 'fri', image_url: OURS.replace(VID, '99999999-2222-3333-4444-555555555555') }, VID).error) && /Upload the picture/.test(w.clean(ENV, { title: 'x', day: 'fri', image_url: 'https://x.supabase.co/storage/v1/object/public/venue-logos/' + VID + '/a.png' }, VID).error));
ok('a made-up date (30 Feb) is refused', /Pick the date/.test(w.clean(ENV, { title: 'x', date: '2027-02-30' }, VID).error));
ok('the stored list drops past ones and anything without an id', w.keep([{ id: 'a', title: 'x', date: past }, { id: 'b', title: 'y', date: future }, { title: 'z', day: 'fri' }, { id: 'c', title: 'w', day: 'fri', until: past }, { id: 'd', title: 'v', day: 'sun' }], w.cut()).map(function (e) { return e.id; }).join() === 'b,d');
var pub = w.pub([{ id: 'a', title: 'x', date: future, start: '20:00', line: 'l', image_url: OURS, secret: 's', made_by: 'u' }, { id: 'b', title: 'old', date: past }, { title: 'bad', day: 'xyz' }, { title: 'p', day: 'fri', image_url: 'javascript:alert(1)' }]);
ok('anyone sees only title, date or day, start, line, picture: no id, nothing else', pub.length === 2 && JSON.stringify(Object.keys(pub[0]).sort()) === '["date","image_url","line","start","title"]' && !pub[1].image_url, JSON.stringify(pub));
ok('/screen and /join/info hand them over, and still answer before migration 177 (asked again without the column)', /events: publicEvents\(cfg && cfg\.events\)/.test(fnSrc(GAME, 'handleScreen')) && /select=slides,raffle,logo_url,venue_id,events&limit=1'\); \}\s*catch \(e\) \{ rows = await sbGet\(env, 'vp_venue_screen', 'slug=eq\.' \+ enc\(slug\) \+ '&select=slides,raffle,logo_url,venue_id&limit=1'\)/.test(fnSrc(GAME, 'handleScreen')) && /events = publicEvents\(/.test(fnSrc(GAME, 'joinInfoWithSlides')));
ok('only the venue\'s staff with the advertising right may change them', /vpbRequireOwner\(request, env\)/.test(fnSrc(API, 'vpbWhatsOnStart')) && /vpbCan\(o, 'advertising'\)/.test(fnSrc(API, 'vpbWhatsOnStart')) && /o\.venues\.filter\(function \(v\) \{ return v\.id === venueId; \}\)/.test(fnSrc(API, 'vpbWhatsOnStart')));
ok('a new event gets its id from crypto, never Math.random', /crypto\.randomUUID\(\)/.test(fnSrc(API, 'vpbWhatsOnSave')) && !/Math\.random/.test(fnSrc(API, 'vpbWhatsOnSave')));

print('\nTHE PAGES');
var TV = readFile('venueplay/tv.html'), BILL = readFile('venueplay/app/billing.html');
ok('the TV loads vp-whatson.js and puts the nights in its loop', /<script src="\/app\/vp-whatson\.js"><\/script>/.test(TV) && /VPWhatsOn\.tvSlides\(ADS\.events, VPWhatsOn\.todayIn\(VENUE_TZ\), ADS\.week\)/.test(TV) && /ADS\.week = Array\.isArray\(d\.week\) \? d\.week : null;/.test(TV) && /ADS\.events = Array\.isArray\(d\.events\) \? d\.events : \[\];/.test(TV));
['venueplay/app/trivia/play.html', 'venueplay/app/musical/play.html', 'venueplay/play.html'].forEach(function (f) {
  var s = readFile(f);
  ok(f.replace('venueplay/', '') + ' loads vp-whatson.js before vp-tonight.js and passes the events on', s.indexOf('<script src="/app/vp-whatson.js"></script>') > 0 && s.indexOf('<script src="/app/vp-whatson.js"></script>') < s.indexOf('<script src="/app/vp-tonight.js"></script>') && /P\.events=\(r&&Array\.isArray\(r\.events\)\)\?r\.events:\[\];/.test(s) && /events:P\.events/.test(s));
});
ok('the account page has the What\'s on card under Screen and loads the editor', /<div class="scard" id="woCard">/.test(BILL) && BILL.indexOf('id="woCard"') > BILL.indexOf('id="tp-screen"') && BILL.indexOf('id="woCard"') < BILL.indexOf('</div><!-- /tp-screen -->') && /<script src="\/app\/vp-whatson-edit\.js"><\/script>/.test(BILL) && /VPWhatsOnEdit\.mount\(box,/.test(fnSrc('venueplay/app/billing.html', 'fillWhatsOn')) && /\bfillWhatsOn\(cfg\);/.test(fnSrc('venueplay/app/billing.html', 'fillScreen')));

print('\n' + (bad ? bad + ' FAILED, ' + ran + ' run' : 'ALL ' + ran + ' CHECKS PASSED'));
if (bad) throw new Error(bad + ' failed');
