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
function Node(tag) { this.tagName = tag; this.children = []; this.className = ''; this._text = ''; this._html = ''; this.attrs = {}; this.style = { setProperty: function (k, v) { this[k] = v; } }; this.hidden = false; this.value = ''; this.parentNode = null; }
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
(function () { eval(readFile('venueplay/app/vp-whatson-css.js')); }).call(window);
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
ok('labels read as people say them', W.dayLabel(TODAY, TODAY) === 'Tonight' && W.dayLabel('2026-11-13', TODAY) === 'Tomorrow' && W.dayLabel('2026-11-14', TODAY) === 'Sat 14 Nov' && W.dayLabel('2026-11-14', TODAY, true) === 'Sat 14 Nov' && !/Saturday 14|Friday 1/.test(W.dayLabel('2026-11-14', TODAY, true)));
ok('a regular weekly night says its day in the plural, never one date; our game nights too; a one-off keeps its short date (Dean, 10 Nov 2026)', W.weeklyLabel('fri') === 'Fridays' && W.rowLabel('2026-11-13', { day: 'fri' }, TODAY) === 'Fridays' && W.rowLabel('2026-11-14', { date: '2026-11-14' }, TODAY) === 'Sat 14 Nov' && W.rowLabel('2026-11-14', { game: 'trivia' }, TODAY) === 'Saturdays');
ok('an apostrophe inside a word is the curly one everywhere (the TV too)', W.clean([{ title: "What's the story?", day: 'fri', line: "Don't miss it" }])[0].title === 'What\u2019s the story?' && W.clean([{ title: "x", day: 'fri', line: "Don't miss it" }])[0].line === 'Don\u2019t miss it');
ok('the account page\'s when: "Every Friday, 10pm" and "Sat 14 Nov, 8pm" and a last date', W.whenText(EV[0], TODAY) === 'Every Friday, 10pm' && W.whenText(EV[2], TODAY) === 'Sat 14 Nov, 8pm' && W.whenText({ title: 'x', day: 'fri', until: '2026-12-18' }, TODAY) === 'Every Friday, until 18 Dec', W.whenText(EV[0], TODAY) + ' / ' + W.whenText({ title: 'x', day: 'fri', until: '2026-12-18' }, TODAY));
ok('a bad entry is left out, never guessed: no title, no day, a made-up date, a bad time, a picture that is not a web address', W.clean([{ day: 'fri' }, { title: 'x' }, { title: 'y', date: '2026-02-30' }, { title: 'z', day: 'fri', start: '25:00', image_url: 'javascript:alert(1)' }]).length === 1 && !W.clean([{ title: 'z', day: 'fri', start: '25:00', image_url: 'javascript:alert(1)' }])[0].start && !W.clean([{ title: 'z', day: 'fri', image_url: 'ftp://x/y.jpg' }])[0].image_url);
ok('at most 30 (the cap)', W.clean(Array.apply(null, Array(40)).map(function (_, i) { return { title: 't' + i, day: 'fri' }; })).length === 30 && W.MAX === 30);
ok('the TV\'s date comes from the venue\'s own time zone', W.todayIn('Australia/Brisbane', new Date(Date.UTC(2026, 10, 12, 15, 0))) === '2026-11-13' && W.todayIn('Australia/Perth', new Date(Date.UTC(2026, 10, 12, 15, 0))) === '2026-11-12');

print('\nTHE TV (tv.html between games), round 4: feature and week, the plain list when there is no picture');
var sl = W.tvSlides(EV, TODAY);
var rowsOf = function (x) { return x.rows.map(function (r) { return r.label + ':' + (r.ev.id || r.ev.title); }).join(); };
ok('nights with pictures this week: "feature and week" views, the soonest picture first (Friday, then Mount Kujo)', sl.length === 2 && sl[0].type === 'feature' && sl[0].feature.ev.id === 'e1' && sl[0].feature.label === 'Fridays' && sl[1].feature.ev.id === 'e3', JSON.stringify(sl.map(function (x) { return x.type; })));
ok('its week in date order, Tonight first, the featured night still in the list; Saturday\'s weekly Rise & Shine and the one-off album launch are ONE card (Sat 14 Nov) with both, in time order', rowsOf(sl[0]) === 'Thursdays:e2,Fridays:e1,Sat 14 Nov:e4', rowsOf(sl[0]));
var many = []; for (var i = 0; i < 14; i++) many.push({ title: 'n' + i, day: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'][i % 7], start: '20:00' });
var busy = W.tvSlides(many.concat([EV[2]]), TODAY);
var shown = {}; busy.forEach(function (v) { v.rows.forEach(function (r) { r.items.forEach(function (it) { shown[r.date + (it.id || it.title)] = 1; }); }); });
ok('a busy week rotates: seven nights (a card each) are two views of 6 and 1, every thing shown in one of them (none left out)', busy.length === 2 && busy[0].rows.length === 6 && busy[1].rows.length === 1 && Object.keys(shown).length === 15 && busy.every(function (v) { return v.type === 'feature'; }), JSON.stringify(busy.map(function (v) { return v.rows.length; })));
var twoPics = W.tvSlides([EV[0], EV[2], EV[1]], TODAY);
ok('two nights with pictures and a short week: two views, each featuring one of them in turn', twoPics.length === 2 && twoPics[0].feature.ev.id === 'e1' && twoPics[1].feature.ev.id === 'e3', JSON.stringify(twoPics.map(function (v) { return v.feature.ev.id; })));
var ms = W.tvSlides(many, TODAY);
ok('no picture this week: the plain list, five a slide at most (here seven nights balanced to 4 and 3)', ms.every(function (x) { return x.type === 'list'; }) && ms.length === 2 && ms[0].rows.length === 4 && ms[1].rows.length === 3, JSON.stringify(ms.map(function (x) { return x.rows.length; })));
var seven = W.tvSlides(many.slice(0, 7), TODAY), two = W.tvSlides(many.slice(0, 2), TODAY)[0], three = W.tvSlides(many.slice(0, 3), TODAY)[0];
ok('the list: seven nights are two balanced slides (4 and 3), one size for the set; fewer rows, bigger words', seven.length === 2 && seven[0].rows.length === 4 && seven[1].rows.length === 3 && seven[0].size === 'm' && seven[1].size === 'm' && two.size === 'xl' && three.size === 'l' && /wo-wall wo-tiles wo-xl wo-n2/.test(W.tvHtml(two, 'Pub')), JSON.stringify(seven.map(function (x) { return x.rows.length + x.size; })));
var L = 'https://x.supabase.co/storage/v1/object/public/venue-logos/v/logo.png';
var fh = W.tvHtml(sl[0], 'Revolver Upstairs', L), lh = W.tvHtml(two, 'Revolver Upstairs', L), nh = W.tvHtml(two, 'Revolver Upstairs');
ok('the venue\'s own uploaded logo heads both layouts beside WHAT’S ON; with none, its name stands in; a bad address never', /<div class="wo-top"><img class="wo-logo" alt="" src="https:\/\/x\.supabase\.co[^"]*logo\.png"><div class="wo-head">What’s on</.test(lh) && /wb-side"><div class="wo-top"><img class="wo-logo"/.test(fh) && /wo-kick">Revolver Upstairs</.test(nh) && W.tvHtml(two, 'x', 'javascript:alert(1)').indexOf('wo-logo') === -1, lh.slice(0, 220));
ok('feature and week: the picture whole over a blurred copy of itself, only its day and time under it (no repeated title), the week beside it', /wb-art" style="background-image:url\(https:\/\/x\.supabase\.co\/storage\/v1\/object\/public\/venue-ads\/v\/fri\.jpg\)/.test(fh) && /wb-pic/.test(fh) && /wb-when">Fridays · 10pm</.test(fh) && !/adbig/.test(fh) && (fh.match(/class="wo-row/g) || []).length === 3, fh.slice(0, 300));
ok('round 5: the feature panel also names the night (for a poster with no words on it); three rows or fewer let titles take two lines (size l/xl)', /<div class="wb-title">Revolver Fridays<\/div>/.test(fh) && W.tvSlides([EV[0], EV[1], EV[2]], TODAY)[0].size === 'l' && W.tvSlides([EV[0], EV[1]], TODAY)[0].size === 'xl' && busy[0].size === 'm', fh.slice(fh.indexOf('wb-when'), fh.indexOf('wb-when') + 160));
ok('each row: the day and the time together on the left, then the title (round 4: no empty middle), every day label the same', /<span class="wo-when2"><span class="wo-day">Thursdays<\/span><span class="wo-time">9pm<\/span><\/span><span class="wo-what"><b>I ♥ 3181<\/b>/.test(fh) && !/again/.test(fh), fh.slice(fh.indexOf('wo-list'), fh.indexOf('wo-list') + 300));
var WK = [{ day: 'wed', games: [{ game: 'musical', start: '20:00' }] }, { day: 'thu', games: [{ game: 'trivia', start: '19:30' }] }, { day: 'fri', games: [{ game: 'bingo', start: '18:00', count: 2 }, { game: 'other', name: 'Karaoke', start: '21:00' }] }];
var flat = function (sls) { return sls.reduce(function (a, x) { return a.concat(x.rows || []); }, []); };
var off = W.tvSlides(EV, TODAY, WK)[0].rows;
ok('NO TICK, NO GAMES (13 Nov 2026, "OFF by default"): the venue\'s game week is never put on the card until it is ticked', off.every(function (r) { return r.items.every(function (it) { return !it.game; }); }) && off.length === 3, JSON.stringify(off.map(function (r) { return r.items.map(function (i) { return i.title; }); })));
var TK = [{ id: 'k1', link: 'night', day: 'thu', game: 'trivia' }, { id: 'k2', link: 'night', day: 'fri', game: 'bingo' }, { id: 'k3', link: 'night', day: 'fri', game: 'other' }];
var gw = W.tvSlides(EV.concat(TK), TODAY, WK), gwRows = flat(gw);
ok('a ticked game night joins THAT night\'s card: tonight\'s trivia at 7:30pm, then the venue\'s 9pm night, on the one Thursdays card', gwRows[0].label === 'Thursdays' && gwRows[0].items.length === 2 && gwRows[0].items[0].game === 'trivia' && gwRows[0].items[0].title === 'Trivia night' && gwRows[0].items[0].start === '19:30' && gwRows[0].items[1].id === 'e2', JSON.stringify(gwRows[0].items.map(function (i) { return i.title; })));
ok('the wizard\'s newer week ticked: "Bingo ×2" joins Friday with its real time; a Something-else night is not ours to tick (the Worker and the page refuse the link)', gwRows[1].items.some(function (it) { return it.title === 'Bingo ×2' && it.line === 'Play on your phone' && it.start === '18:00'; }) && W.clean([TK[2]]).length === 0, JSON.stringify(gwRows[1].items.map(function (i) { return i.title; })));
ok('a game night is never the feature', gw.every(function (x) { return x.type !== 'feature' || !x.feature.ev.game; }));
var DRAWS = { week: WK, draws: [{ name: 'Members draw', draw_day: 'Thursday', draw_time: '7pm', current_jackpot_cents: 123400 }, { name: 'Other draw', draw_day: 'Thursday', draw_time: 'late' }], raffles: [{ label: 'Meat raffle', day: 'Thursday', time: '6:30pm' }, { label: 'Friday raffle', day: 'Friday', time: '' }] };
var DL = [{ id: 'd1', link: 'draw', ref: 'Members draw' }, { id: 'd2', link: 'raffle', ref: 'Meat raffle' }];
var dr = flat(W.tvSlides(EV.concat(DL), TODAY, WK, DRAWS))[0];
ok('a ticked members draw and raffle are read from the real schedule: the day, the time and the jackpot are the schedule\'s, in time order on the same card', dr.items.map(function (i) { return i.title; }).join() === 'Meat raffle,Members draw,I ♥ 3181' && dr.items[0].start === '18:30' && dr.items[1].start === '19:00' && dr.items[1].line === 'Jackpot $1,234' && dr.items[0].line === 'Tickets at the bar', JSON.stringify(dr.items));
var dr2 = flat(W.tvSlides(EV.concat(DL), TODAY, WK, { week: WK, draws: [{ name: 'Members draw', draw_day: 'Friday', draw_time: '8pm', current_jackpot_cents: 0 }], raffles: [] }));
ok('when the venue moves its draw the card follows with nothing retyped; a draw taken off the schedule drops off by itself', dr2.every(function (r) { return r.items.every(function (i) { return i.title !== 'Meat raffle'; }); }) && dr2.some(function (r) { return r.label === 'Fridays' && r.items.some(function (i) { return i.title === 'Members draw' && i.line === '' && i.start === '20:00'; }); }), JSON.stringify(dr2.map(function (r) { return r.items.map(function (i) { return i.title; }); })));
ok('a ticked game alone makes a card (the venue chose it); no tick and no event makes no slide', W.tvSlides([TK[0]], TODAY, WK).length === 1 && W.tvSlides([], TODAY, WK).length === 0);
var T3 = [{ id: 'a', title: 'Roast Night', day: 'tue', line: '$10' }, { id: 'b', title: 'Meat raffle', day: 'tue', start: '18:30' }, { id: 'c', title: 'Members draw', day: 'tue', start: '19:00' }];
var t3 = flat(W.tvSlides(T3, '2026-11-10'));
ok('THREE ENTRIES ON ONE NIGHT are ONE card: "Tuesdays", the things in time order, the one with no time last (typed as 1 entry or 3)', t3.length === 1 && t3[0].label === 'Tuesdays' && t3[0].items.map(function (i) { return i.title; }).join() === 'Meat raffle,Members draw,Roast Night', JSON.stringify(t3));
var t3h = W.tvHtml(W.tvSlides(T3, '2026-11-10')[0], 'Pub');
ok('the card draws its day once and each thing with its own time column (wo-row multi, wo-its)', /class="wo-row multi tonight">/.test(t3h) && (t3h.match(/class="wo-it"/g) || []).length === 3 && (t3h.match(/wo-day/g) || []).length === 1 && /<span class="wo-itt">6:30pm<\/span><span class="wo-itw"><b>Meat raffle/.test(t3h), t3h.slice(0, 400));
var five = []; for (var q = 0; q < 9; q++) five.push({ id: 'z' + q, title: 'T' + q, day: 'tue', start: '1' + q + ':00' });
ok('more than 4 things on one night continue on a card of their own, none dropped: 9 things are cards of 4, 4 and 1', flat(W.tvSlides(five, '2026-11-10')).map(function (r) { return r.items.length; }).join() === '4,4,1');
ok('a one-off and a weekly on the same date are one card that names the date', (function () { var r = flat(W.tvSlides([{ id: 'a', title: 'Weekly', day: 'sat' }, { id: 'b', title: 'Once', date: '2026-11-14', start: '20:00' }], TODAY)); return r.length === 1 && r[0].label === 'Sat 14 Nov' && r[0].items.length === 2; })());
ok('nothing on: no What\'s on slide at all', W.tvSlides([], TODAY).length === 0 && W.tvSlides([EV[5]], TODAY).length === 0);
var h0 = W.tvHtml(two, 'Revolver Upstairs');
ok('times as people say them ("8pm", never "8PM")', />8pm</.test(h0) && !/PM</.test(h0) && />10pm</.test(fh));
var evil = W.tvHtml(W.tvSlides([{ title: '<img src=x onerror=alert(1)>', day: 'thu', line: '"><script>', image_url: 'https://a/b.jpg?x=1&#41;' }], TODAY)[0], '<b>pub</b>');
ok('every venue word is escaped on the wall', evil.indexOf('<img') === -1 && evil.indexOf('<script') === -1 && evil.indexOf('<b>pub') === -1 && /&lt;img/.test(evil));
ok('a picture address with an entity in it is refused (the night stays, in the plain list)', W.tvSlides([{ title: 'x', day: 'thu', image_url: 'https://a/b.jpg?x=1&#41;' }], TODAY)[0].type === 'list');

print('\nROUND 9 NOV (Dean, Lunatic Hotel): tiles across the wall, the time once, the logo cleaned, no spaced capitals, no dot');
var LUN = [{ id: 'l1', title: 'Pool comp', day: 'thu', start: '19:00', line: '$10 entry' },
           { id: 'l2', title: 'Meat raffles and members draw', day: 'fri', start: '19:30' },
           { id: 'l3', title: 'Jag the Joker', day: 'sun', start: '14:00', line: '2pm to 6pm' }];
var lun = W.tvSlides(LUN, '2026-11-09'), lunH = W.tvHtml(lun[0], 'Lunatic Hotel');
ok('Lunatic\'s three nights: one list slide, three tiles side by side across the wall (wo-tiles wo-n3)', lun.length === 1 && /class="wo-wall wo-tiles wo-l wo-n3"/.test(lunH) && (lunH.match(/class="wo-row /g) || []).length === 3, lunH.slice(0, 120));
ok('one to five nights: 1, 2, 3 across, 4 as two by two, 5 as three over two (a class each)', [1, 2, 3, 4, 5].every(function (n) { return new RegExp('wo-n' + n + '"').test(W.tvHtml(W.tvSlides(many.slice(0, n), TODAY)[0], 'x')); }));
ok('a long title is marked to start smaller ("Meat raffles and members draw" t3, "Pool comp" t1, 60 letters t4)', /class="wo-row t3"[^>]*><span class="wo-when2"><span class="wo-day">Fridays/.test(lunH) && /class="wo-row t1"[^>]*><span class="wo-when2"><span class="wo-day">Thursdays/.test(lunH) && /wo-row t4/.test(W.tvHtml(W.tvSlides([{ title: new Array(61).join('x'), day: 'thu' }], TODAY)[0], 'x')), lunH);
ok('the time once: start 2pm with the line "2pm to 6pm" shows "2pm to 6pm" and no line', /<span class="wo-time">2pm to 6pm<\/span><\/span><span class="wo-what"><b>Jag the Joker<\/b><\/span>/.test(lunH) && (lunH.match(/2pm/g) || []).length === 1, lunH.slice(lunH.indexOf('Sun 15')));
ok('a line that is not the hours stays as written ("$10 entry" under 7pm)', /<span class="wo-time">7pm<\/span><\/span><span class="wo-what"><b>Pool comp<\/b><i>\$10 entry<\/i>/.test(lunH));
var wp = function (st, ln) { var r = W.whenParts({ start: st, line: ln }); return r.time + '|' + r.line; };
ok('the hours, however the venue writes them: "2pm till late, free entry", "From 2PM - 6 pm", "7:30pm start"; another time is left alone', wp('14:00', '2pm till late, free entry') === '2pm to late|Free entry' && wp('14:00', 'From 2PM - 6 pm') === '2pm to 6pm|' && wp('19:30', '7:30pm start') === '7:30pm|' && wp('14:00', '3pm to 6pm') === '2pm|3pm to 6pm' && wp('', '2pm to 6pm') === '|2pm to 6pm', [wp('14:00', '2pm till late, free entry'), wp('14:00', 'From 2PM - 6 pm'), wp('19:30', '7:30pm start'), wp('14:00', '3pm to 6pm')].join(' / '));
var featH = W.tvHtml(W.tvSlides([{ title: 'Gig', day: 'thu', start: '14:00', line: '2pm to 6pm', image_url: 'https://x.supabase.co/storage/v1/object/public/venue-ads/v/g.jpg' }], TODAY)[0], 'x');
ok('the feature panel says the hours once too ("Tonight · 2pm to 6pm")', /wb-when tn">Thursdays · 2pm to 6pm</.test(featH), featH.slice(featH.indexOf('wb-when'), featH.indexOf('wb-when') + 60));
var BL = 'blob:https://venueplay.com.au/0b1c-22';
ok('the logo: the cleaned copy (a blob: address) is drawn; "wait" holds it back; "plate" sits it on a plate; a data: page or a script address never', /<img class="wo-logo" alt="" src="blob:https:\/\/venueplay\.com\.au\/0b1c-22">/.test(W.tvHtml(lun[0], 'x', BL, 'clear')) && /class="wo-logo wo-wait"/.test(W.tvHtml(lun[0], 'x', L, 'wait')) && /class="wo-logo wo-plate"/.test(W.tvHtml(lun[0], 'x', L, 'plate')) && W.tvHtml(lun[0], 'x', 'data:text/html;base64,PHNjcmlwdD4=').indexOf('wo-logo') === -1 && W.tvHtml(lun[0], 'x', 'blob:javascript:alert(1)').indexOf('wo-logo') === -1);
/* VPLogo.cleanDark on known pixels (the same flood fill as the account page's Remove background). */
function ImageData(data, w, h) { this.data = data; this.width = w; this.height = h; }
var LG = {}; (function () { var window = LG; eval(readFile('venueplay/app/vp-logo.js')); }).call(LG);
function px(w, h, f) { var d = new Uint8ClampedArray(w * h * 4); for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) { var c = f(x, y), i = (y * w + x) * 4; d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = c.length > 3 ? c[3] : 255; } return new ImageData(d, w, h); }
var badge = px(40, 40, function (x, y) { var dx = x - 20, dy = y - 22; return dx * dx + dy * dy <= 64 ? [230, 90, 20] : [255, 255, 255]; });
var cd = LG.VPLogo.cleanDark(badge);
ok('a logo on a white square: the white comes off, the badge stays whole, the empty margins are trimmed', cd.how === 'clear' && cd.image.data[3] === 0 && cd.image.data[(22 * 40 + 20) * 4 + 3] === 255 && cd.box.w <= 18 && cd.box.h <= 18 && cd.box.x >= 11, JSON.stringify({ how: cd.how, box: cd.box }));
ok('a logo already see-through is drawn as it is; one with no plain edge goes on the plate; the stored file is never touched (no upload here)', LG.VPLogo.cleanDark(px(10, 10, function () { return [0, 0, 0, 0]; })).how === 'asis' && LG.VPLogo.cleanDark(px(20, 20, function (x, y) { return [(x * 53 + y * 97) % 256, (x * 11) % 256, (y * 29) % 256]; })).how === 'plate' && !/api\(|fetch\(|XMLHttpRequest/.test(readFile('venueplay/app/vp-logo.js')));
var TVS = readFile('venueplay/tv.html'), CSSF = readFile('venueplay/app/vp-whatson-css.js');
ok('NO DAY GHOSTED BEHIND THE WORDS (Dean disliked it, 14 Nov, INBOX 431): no card carries data-wd and the look has no ::after that draws one', !/data-wd/.test(t3h) && !/data-wd/.test(W.tvHtml(W.tvSlides([{ id: 'q', title: 'Trivia', day: 'wed' }], '2026-11-10')[0], 'Pub')) && !/attr\(data-wd\)/.test(CSSF) && !/\.wo-row::after/.test(CSSF) && !/data-wd/.test(readFile('venueplay/app/vp-whatson.js')));
function rule(src, sel) { var i = src.indexOf(sel + '{'); return i < 0 ? '' : src.slice(i, src.indexOf('}', i)); }
ok('TV: the day labels and the venue\'s name are plain words: no monospace, no capitals, no letter spacing', ['.wo-day', '.wo-kick', '.wb-side .wo-top.k .wo-kick'].every(function (k) { var r = rule(CSSF, k); return r && !/JetBrains|uppercase|letter-spacing/.test(r); }), rule(CSSF, '.wo-day'));
ok('TV: the What\'s on slide asks for the cleaned logo (vp-logo.js loaded, VPLogo.forDark, tvHtml given its state)', /<script src="\/app\/vp-logo\.js"><\/script>/.test(TVS) && /VPLogo\.forDark\(u\)/.test(TVS) && /VPWhatsOn\.tvHtml\(e\.wo, holdVenueName\|\|"", wl\.src, wl\.how\)/.test(TVS) && /woFit\(\);/.test(fnSrc('venueplay/tv.html', 'buildAds')) && /\n        div\.setAttribute\("data-fit-self",""\);/.test(fnSrc('venueplay/tv.html', 'buildAds')));
var PC = readFile('venueplay/app/vp-tonight.css');
ok('phone: no dot on a day (no ::after on .d.ev), and the strip, day heading, badges and NEXT in plain words (no monospace, capitals or spacing)', !/\.d\.ev::after/.test(PC) && !/border-radius:50%;background:#FFC24B/.test(PC) && ['.vpt-week .k', '.vpt-night .nk', '.vpt-night .bd', '.vpt-next .k', '#vpAd .k'].every(function (k) { var r = rule(PC, k); return r && !/JetBrains|uppercase|letter-spacing/.test(r); }));
var boxJ = new Node('div'), lbJ = T.lobby(boxJ, { name: 'Sam', me: 'trivia', week: WEEK, events: [{ title: 'Sun session', day: 'thu', start: '14:00', line: '2pm to 6pm' }], now: THU });
lbJ.buttons[0].onclick();
var chipsJ = byClass(byClass(boxJ, 'vpt-night')[0], 'bd').map(function (c) { return c.textContent; });
ok('phone: a night\'s chip says its hours once ("2pm to 6pm")', chipsJ.indexOf('2pm to 6pm') !== -1 && chipsJ.indexOf('2pm') === -1, JSON.stringify(chipsJ));
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
ok('the days with one of the venue\'s nights are marked (lit, no dot) (Thu, Fri, Sat, Sun no)', /\bev\b/.test(days[0].className) && /\bev\b/.test(days[1].className) && /\bev\b/.test(days[2].className) && !/\bev\b/.test(days[3].className), days.map(function (d) { return d.className; }).join('|'));
ok('our game nights keep their own mark beside it', /\bon\b/.test(days[0].className) && /\bon\b/.test(days[6].className) && !/\bon\b/.test(days[1].className));
days[2].onclick();
ok('tap Saturday (no game): the card says Sat 14 Nov, then the venue\'s two nights, earliest first, and no "No games this night"', byClass(spot, 'nk').length === 1 && byClass(spot, 'nk')[0].textContent === 'Sat 14 Nov' && byClass(spot, 'row').length === 2 && /Rise & Shine/.test(byClass(spot, 'row')[0].textContent) && /7am/.test(byClass(spot, 'row')[0].textContent) && /Mount Kujo/.test(byClass(spot, 'row')[1].textContent) && !/No games this night/.test(spot.textContent), texts(spot, 'row'));
/* Dean, 10 Nov 2026 (INBOX 114): the day strip underlines every day in pink (the venue's colour replaces it), today is a light touch,
   a one-off date is "Fri 13 Nov" (never "Friday 13"), a regular weekly night says its day in the plural. */
var TJS = readFile('venueplay/app/vp-tonight.js');
ok('phone strip: ONLY a night with our games has the pink underline (Dean, 12 Nov 2026, INBOX 288.5), and a venue colour replaces it (--vpt-accent)', /box-shadow:inset 0 -3px 0 var\(--vpt-accent,#FF1F8E\)/.test(rule(PC, '.vpt-week .d.on')) && !/box-shadow/.test(rule(PC, '.vpt-week .d')));
ok('phone strip: today is a light touch (a thin outline), not a pink fill or a heavy highlight', /outline:1px solid rgba\(255,255,255,\.\d+\)/.test(rule(PC, '.vpt-week .d.now')) && !/background/.test(rule(PC, '.vpt-week .d.now')));
var lbA = T.lobby(new Node('div'), { name: 'Sam', me: 'trivia', week: WEEK, events: EV, now: THU, accent: '#00AAFF' }), lbB = T.lobby(new Node('div'), { name: 'Sam', me: 'trivia', week: WEEK, events: EV, now: THU, accent: 'red; x' });
ok('a venue colour (#rrggbb) goes on the strip; anything else is ignored and the pink stays', lbA.el.style['--vpt-accent'] === '#00AAFF' && lbB.el.style['--vpt-accent'] === undefined);
ok('phone: a one-off date is "Fri 13 Nov" everywhere, never "Friday 13" (heading and badge); no LONG[...] + date left in the code', !/LONG\[dd\.key\] \+ " " \+ dd\.date/.test(TJS) && /dateText\(dd\.date\)/.test(TJS) && /SHORT\[key\] \+ " " \+ dt\.getDate\(\) \+ " " \+ MON/.test(TJS));
var boxW = new Node('div'), lbW = T.lobby(boxW, { name: 'Sam', me: 'trivia', week: WEEK, events: [{ title: 'Pool comp', day: 'sat', start: '19:00' }, { title: 'Album launch', date: '2026-11-14', start: '20:00' }], now: THU });
lbW.buttons[2].onclick();
var spW = byClass(boxW, 'vpt-night')[0], rW = byClass(spW, 'row');
ok('phone: a regular weekly night says "Saturdays" under its title; a one-off says no day (the heading is its date)', rW.length === 2 && /Pool comp/.test(rW[0].textContent) && /Saturdays/.test(rW[0].textContent) && !/Saturdays|Sat /.test(rW[1].textContent) && byClass(spW, 'nk')[0].textContent === 'Sat 14 Nov', texts(spW, 'row'));
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
ok('tonight\'s reads "Tonight, 9pm (weekly)" in gold; the others their when', /Tonight, 9pm \(weekly\)/.test(byClass(list[0], 'woe-when')[0].textContent) && /\btn\b/.test(byClass(list[0], 'woe-when')[0].className) && byClass(list[1], 'woe-when')[0].textContent === 'Every Friday, 10pm');
ok('a picture shows as its thumbnail; with none, the tile quietly says its day (THU)', /fri\.jpg/.test(byClass(list[1], 'woe-thumb')[0].style.backgroundImage) && byClass(list[0], 'woe-thumb')[0].textContent === 'THU');
ok('"5 of 30" and "+ Add an event"', /5 of 30/.test(texts(page, 'woe-count')) && byClass(page, 'woe-add').length === 1 && !byClass(page, 'woe-add')[0].hidden);
byClass(page, 'woe-add')[0].onclick();
var form = byClass(page, 'woe-form')[0];
ok('Add opens the form (round 3, three short rows): Title, When, Starts; Date or Last date, One line about it (0 of 48); Poster, Save event. No poster-date reminder.', !form.hidden && /Add an event/.test(form.textContent) && /When/.test(form.textContent) && /One date/.test(form.textContent) && /Every Friday/.test(form.textContent) && /Starts/.test(form.textContent) && /One line about it/.test(form.textContent) && /0 of 48/.test(form.textContent) && !/Check the date on your poster/.test(form.textContent) && /Poster \(optional\)/.test(form.textContent) && /Save event/.test(form.textContent) && byClass(form, 'woe-r1').length === 1 && byClass(form, 'woe-r2').length === 1 && byClass(form, 'woe-r3').length === 1);
function inputs() { return all(form).filter(function (n) { return n.tagName === 'input'; }); }
function field(t) { var f = all(form).filter(function (n) { return n.tagName === 'label' && n._text === t; })[0]; return f ? all(f.parentNode).filter(function (n) { return n.tagName === 'input' || n.tagName === 'select'; })[0] : null; }
function btn(t) { return all(form).filter(function (n) { return n.tagName === 'button' && n.textContent === t; })[0]; }
btn('Save event').onclick(); drain();
ok('Save with nothing in: "Give it a title." and nothing sent', /Give it a title/.test(texts(form, 'woe-err')) && saved.length === 0);
field('Title').value = 'DJ Tilly';
btn('Save event').onclick(); drain();
ok('no date: "Pick the date."', /Pick the date/.test(texts(form, 'woe-err')) && saved.length === 0);
field('Date').value = '2026-11-01';
btn('Save event').onclick(); drain();
ok('a date that has been: refused in words', /That date has been/.test(texts(form, 'woe-err')) && saved.length === 0);
var when = field('When'); when.value = 'sat'; when.onchange();
ok('When "Every Saturday": the Date field goes, Last date (optional) comes with its short hint', byClass(form, 'woe-when-once')[0].hidden === true && byClass(form, 'woe-when-weekly')[0].hidden === false && /Leave blank if it runs every week until you remove it/.test(form.textContent));
field('Starts (optional)').value = '11pm'; field('One line about it (optional)').value = 'Free entry before 11';
var fileIn = all(form).filter(function (n) { return n.tagName === 'input' && n.attrs.type === 'file'; })[0]; fileIn.files = [{ name: 'p.jpg' }]; fileIn.onchange();
btn('Save event').onclick(); drain();
ok('a good weekly event is sent with only its fields (day, start, line, the uploaded picture)', saved.length === 1 && saved[0].title === 'DJ Tilly' && saved[0].day === 'sat' && saved[0].start === '23:00' && saved[0].line === 'Free entry before 11' && /new\.jpg/.test(saved[0].image_url) && saved[0].date === undefined && !saved[0].id, JSON.stringify(saved[0]));
ok('then the form shuts, the list repaints from the Worker\'s answer, and it says it is on the TV', form.hidden && byClass(page, 'woe').length === 6 && /shows on your TV/.test(said[said.length - 1]));
ed.open('e3', true);
form = byClass(page, 'woe-form')[0];
ok('Copy: a new event with the details, its date asked for again', /Copy of Mount Kujo/.test(form.textContent) && field('Title').value === 'Mount Kujo album launch' && field('Date').value === '');
field('Date').value = '2026-11-28';
btn('Save event').onclick(); drain();
ok('and saved as a new one (no id), on its new date', saved.length === 2 && !saved[1].id && saved[1].date === '2026-11-28' && /kujo\.jpg/.test(saved[1].image_url));
ed.open('e1', false);
form = byClass(page, 'woe-form')[0];
ok('Edit opens in place of its row (the row hides, the form sits where it was); Add and Copy open at the top', form.parentNode === byClass(page, 'woe-list')[0] && byClass(page, 'woe').filter(function (r) { return r.attrs['data-id'] === 'e1'; })[0].hidden === true && byClass(page, 'woe-add')[0].hidden === true);
ok('round 5: editing one that exists, the form also has Copy and Remove (a phone row carries Edit alone)', byClass(form, 'woe-fcopy').length === 1 && byClass(form, 'woe-frm').length === 1);
ok('Edit: the form holds it, When "Every Friday", keeping its id', /Edit event/.test(form.textContent) && field('Title').value === 'Revolver Fridays' && field('When').value === 'fri');
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
field('Title').value = 'x'; field('Date').value = '2026-11-20'; btn('Save event').onclick(); drain(); drain();
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
  eval('var VPB_MAX_EVENTS = 30; var VPB_EVENT_DAYS = [\'mon\', \'tue\', \'wed\', \'thu\', \'fri\', \'sat\', \'sun\']; var VPB_EVENT_GAMES = [\'trivia\', \'musical\', \'bingo\', \'raffles\', \'members\'];' +
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
ok('the TV loads vp-whatson.js and puts the nights in its loop', /<script src="\/app\/vp-whatson\.js"><\/script>/.test(TV) && /VPWhatsOn\.tvSlides\(woEv, VPWhatsOn\.todayIn\(VENUE_TZ\), ADS\.week, \{ week:ADS\.week, draws:ADS\.drawsRaw\|\|\[\], raffles:rafflesOnWall\(\) \}\)/.test(TV) && /ADS\.week = Array\.isArray\(d\.week\) \? d\.week : null;/.test(TV) && /ADS\.events = Array\.isArray\(d\.events\) \? d\.events : \[\];/.test(TV));
['venueplay/app/trivia/play.html', 'venueplay/app/musical/play.html', 'venueplay/play.html'].forEach(function (f) {
  var s = readFile(f);
  ok(f.replace('venueplay/', '') + ' loads vp-whatson.js before vp-tonight.js and passes the events on', s.indexOf('<script src="/app/vp-whatson.js"></script>') > 0 && s.indexOf('<script src="/app/vp-whatson.js"></script>') < s.indexOf('<script src="/app/vp-tonight.js"></script>') && /P\.events=\(r&&Array\.isArray\(r\.events\)\)\?r\.events:\[\];/.test(s) && /events:P\.events/.test(s));
});
ok('the account page has the What\'s on card under Screen and loads the editor', /<div class="scard" id="woCard">/.test(BILL) && BILL.indexOf('id="woCard"') > BILL.indexOf('id="tp-screen"') && BILL.indexOf('id="woCard"') < BILL.indexOf('</div><!-- /tp-screen -->') && /<script src="\/app\/vp-whatson-edit\.js"><\/script>/.test(BILL) && /VPWhatsOnEdit\.mount\(box,/.test(fnSrc('venueplay/app/billing.html', 'fillWhatsOn')) && /\bfillWhatsOn\(cfg\);/.test(fnSrc('venueplay/app/billing.html', 'fillScreen')));


print('\nROUND 13 NOV (INBOX 360): typed times, ticks, the TV fit, the preview');
var pt = function (x) { return JSON.stringify(W.parseTime(x)); };
ok('a typed start time is read however people write it: "2:00 PM", "2pm", "7.30pm", "19:30", "07:30", "1930" (Dean: 2:00 PM on a weekly event saved with no time)', [pt('2:00 PM'), pt('2pm'), pt('7.30pm'), pt('19:30'), pt('07:30'), pt('1930'), pt('12am'), pt('12pm'), pt('')].join() === '"14:00","14:00","19:30","19:30","07:30","19:30","00:00","12:00",""', [pt('2:00 PM'), pt('2pm'), pt('7.30pm'), pt('19:30'), pt('07:30'), pt('1930'), pt('12am'), pt('12pm')].join());
ok('what cannot be read is null and says why in words: "2:00" and "7" ask for am or pm; "banana" and "25:00" are not times', pt('2:00') === 'null' && pt('7') === 'null' && pt('banana') === 'null' && pt('25:00') === 'null' && /am or pm/.test(W.timeProblem('2:00')) && /am or pm/.test(W.timeProblem('7')) && /could not read/.test(W.timeProblem('banana')) && W.timeProblem('2pm') === '');
var tp = new Node('div'), tsaved = [];
E.mount(tp, { events: [], today: TODAY, save: function (ev) { tsaved.push(ev); return { then: function (f) { f({ ok: true, events: [] }); } }; }, remove: function () {} });
byClass(tp, 'woe-add')[0].onclick(); form = byClass(tp, 'woe-form')[0];
field('Title').value = 'Sunday session'; var tw = field('When'); tw.value = 'sun'; tw.onchange(); field('Starts (optional)').value = '2:00 PM';
btn('Save event').onclick(); drain();
ok('A WEEKLY EVENT\'S TYPED "2:00 PM" IS SENT AS 14:00', tsaved.length === 1 && tsaved[0].day === 'sun' && tsaved[0].start === '14:00', JSON.stringify(tsaved));
byClass(tp, 'woe-add')[0].onclick(); form = byClass(tp, 'woe-form')[0]; field('Title').value = 'Late'; var tw2 = field('When'); tw2.value = 'sun'; tw2.onchange();
field('Starts (optional)').value = '2:00'; btn('Save event').onclick(); drain();
ok('"2:00" is not sent: the form says "Add am or pm"', tsaved.length === 1 && /am or pm/.test(texts(form, 'woe-err')), texts(form, 'woe-err'));
field('Starts (optional)').value = 'soon'; btn('Save event').onclick(); drain();
ok('a start that is not a time is not sent either, and is said in words', tsaved.length === 1 && /could not read/.test(texts(form, 'woe-err')));
var kd = field('When'); kd.value = 'once'; kd.onchange(); field('Date').value = '2026-11-20'; kd.value = 'fri'; kd.onchange(); kd.value = 'once'; kd.onchange();
ok('WHEN KEEPS THE DATE: One date, Every Friday, One date: the date is still in its box', field('Date').value === '2026-11-20', field('Date').value);
ok('Starts reads back what it understood ("Starts at 2pm.")', (function () { field('Starts (optional)').value = '2pm'; field('Starts (optional)').oninput && field('Starts (optional)').oninput(); return /Starts at 2pm/.test(texts(form, 'woe-startnote')); })(), texts(form, 'woe-startnote'));
var lk = W.clean([{ id: 'k1', link: 'night', day: 'tue', game: 'trivia' }, { id: 'k2', link: 'draw', ref: 'Members draw' }, { id: 'k3', link: 'raffle', ref: 'Meat raffle' }, { link: 'night', day: 'xyz', game: 'trivia' }, { link: 'night', day: 'tue', game: 'other' }, { link: 'bogus' }, { link: 'draw' }]);
ok('a tick is a link with only its own fields; a bad link (unknown kind, day, game, or no name) is dropped; a link is never one of the venue\'s own nights (not in the account list, the phone or "on")', lk.length === 3 && W.sorted(lk, TODAY).length === 0 && W.on(lk, '2026-11-17').length === 0 && W.upcoming(lk, TODAY, 7).length === 0 && !lk[0].title, JSON.stringify(lk));
var cl = w.clean(ENV, { link: 'night', day: 'tue', game: 'trivia' }, VID), cd = w.clean(ENV, { link: 'draw', ref: 'Members draw', title: 'ignored', date: future }, VID);
ok('the billing Worker keeps a tick as just its link (no words, no date), and refuses an unknown game, day or an empty name', cl.ev && JSON.stringify(cl.ev) === '{"link":"night","day":"tue","game":"trivia"}' && cd.ev && JSON.stringify(cd.ev) === '{"link":"draw","ref":"Members draw"}' && w.clean(ENV, { link: 'night', day: 'tue', game: 'other' }, VID).error && w.clean(ENV, { link: 'night', day: 'xyz', game: 'trivia' }, VID).error && w.clean(ENV, { link: 'raffle', ref: '' }, VID).error && w.clean(ENV, { link: 'nope' }, VID).error);
ok('the stored list keeps a tick (it never goes past); the public read hands it over with only its link fields', w.keep([{ id: 'a', link: 'night', day: 'tue', game: 'trivia' }, { link: 'night', day: 'tue', game: 'trivia' }], '2099-01-01').length === 1 && JSON.stringify(w.pub([{ id: 'a', link: 'raffle', ref: 'Meat raffle', secret: 'x' }, { link: 'night', day: 'tue', game: 'musical' }, { link: 'night', day: 'tue', game: 'other' }])) === '[{"link":"raffle","ref":"Meat raffle"},{"link":"night","day":"tue","game":"musical"}]');
ok('/screen answers the venue\'s game week to the account page on ?sched=1 even before any event exists (for the ticks), and not otherwise', /\|\| wantSched\)\)/.test(fnSrc(GAME, 'handleScreen')));
var CSS = window.VPWhatsOnCSS || '';
ok('the TV never clamps or ellipsises a word: no line clamp and no text-overflow in the What\'s on look', CSS.length > 2000 && !/line-clamp/.test(CSS) && !/text-overflow/.test(CSS), CSS.length);
ok('the look is ONE copy: tv.html no longer carries the .wo- rules, loads vp-whatson-css.js in the head before vp-oldtv.js, and billing.html loads it for the preview', !/\.wo-tiles|\.wb-side|\.wo-row\{/.test(TVS) && TVS.indexOf('/app/vp-whatson-css.js') > 0 && TVS.indexOf('/app/vp-whatson-css.js') < TVS.indexOf('/app/vp-oldtv.js') && /vp-whatson-css\.js/.test(readFile('venueplay/app/billing.html')));

print('\n' + (bad ? bad + ' FAILED, ' + ran + ' run' : 'ALL ' + ran + ' CHECKS PASSED'));
if (bad) throw new Error(bad + ' failed');
