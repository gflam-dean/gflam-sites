/* THE "venueplay tv" CARD AND ITS INTRO, RUN (Dean, 3 Nov 2026): /app/vp-tvhold.js under jsc, with the clock,
   the timers and the page stood in. The card's words, that it never carries the venue's own logo, the intro's
   order and timing (the tube's two catches, "venueplay" and "tv" together, the line, then the venue's logo),
   the flash rule, reduced motion, the TV app's hand-over mid-intro, and the game screens' waiting card.
   What it looks like on a wall is tools/tv-logo-in-chrome.test.py.

     jsc tools/test-tv-hold.js */
var ran = 0, fails = 0;
function check(name, ok, saw) { ran++; if (ok) print('  ok   ' + name); else { fails++; print('  FAIL ' + name + (saw === undefined ? '' : '   saw: ' + JSON.stringify(saw).slice(0, 300))); } }
var SRC = readFile('venueplay/app/vp-tvhold.js'), TV = readFile('venueplay/tv.html');

var NOW = 1000000, timers = [], attrs = {}, log = [], styles = [], made = {}, bodyCls = {};
function setTimeout(f, ms) { timers.push({ at: NOW + (ms || 0), f: f }); return timers.length; }
function run(to) { for (;;) { timers.sort(function (a, b) { return a.at - b.at; }); var t = timers[0]; if (!t || t.at > to) break; timers.shift(); NOW = t.at; t.f(); } NOW = to; }
Date.now = function () { return NOW; };
var REDUCED = false;
var window = { matchMedia: function () { return { matches: REDUCED }; } };
function el() { var e = { id: '', className: '', hidden: false, innerHTML: '', attrs: {}, kids: [], setAttribute: function (k, v) { this.attrs[k] = v; }, appendChild: function (c) { this.kids.push(c); if (c.id) made[c.id] = c; } }; return e; }
var document = {
  documentElement: { setAttribute: function (k, v) { attrs[k] = v; log.push([NOW, k, v]); }, removeAttribute: function (k) { delete attrs[k]; log.push([NOW, k, '']); } },
  head: { appendChild: function (s) { styles.push(s); } },
  body: { classList: { toggle: function (c, on) { bodyCls[c] = !!on; } } },
  getElementById: function (id) { return made[id] || null; },
  createElement: function () { return el(); }
};
eval(SRC.replace('})(window, document);', '})(window, document);'));
var H = window.VPTvHold;

print('the card');
check('vp-tvhold.js defines VPTvHold with the card, the lines, the intro and the waiting card', !!(H && H.html && H.intro && H.lobby && H.LINES));
check('its styles go in once, as a <style> (so an older TV rewrites them like every other style)', styles.length === 1 && /\.tvlogo\{position:absolute;left:50%;top:49\.8%;width:66\.65cqw;/.test(styles[0].textContent));
check('the three lines are Dean\'s words', H.LINES.setup === 'Setting up this screen' && H.LINES.waiting === 'Waiting for the host' && H.LINES.scan === 'Scan to play');
var card = H.html(H.LINES.waiting, true, { kind: 'venue' });
check('the card: the big triangle and the wordmark with "tv", drawn from the brand file, and one line',
      /class="tvl-tri"[^>]*data-vp-mark="tv-tri"><path/.test(card) && /class="tvl-word"[^>]*aria-label="venueplay tv"[^>]*data-vp-mark="tv-word"><path/.test(card) && (card.match(/class="tvline/g) || []).length === 1 && />Waiting for the host</.test(card));
check('never the venue\'s own logo in the middle of it (that is top left, in the game screens\' box)', !/<img/.test(card));
check('"Scan to play" is the one line set to be acted on', /class="tvline scan"/.test(H.html(H.LINES.scan, true, { scan: true })));
check('tv.html builds its holding cards from it, and loads it in <head> before the old-TV rewrite',
      /window\.VPTvHold\.html\(line, breathe, o\)/.test(TV) && TV.indexOf('<script src="/app/vp-tvhold.js"></script>') > 0 && TV.indexOf('<script src="/app/vp-tvhold.js"></script>') < TV.indexOf('<script src="/app/vp-oldtv.js"></script>'));
['trivia', 'musical'].forEach(function (g) {
  var S = readFile('venueplay/app/' + g + '/screen.html');
  check(g + ': the lobby before the host is this card, "Waiting for the host", and the old line is gone',
        S.indexOf('<script src="/app/vp-tvhold.js"></script>') > 0 && /VPTvHold\.lobby\(\$\("tv"\), !!VENUE_SLUG && !state\.hostSeen && !joinCode && state\.phase==="lobby"\)/.test(S) && S.indexOf('Waiting for the host to connect') < 0);
});

print('the intro');
var T0 = NOW;
check('it runs', H.intro({ t0: T0 }) === true && attrs['data-tvi'] === 'on');
check('it starts dark: the tube unlit, the words and the line hidden, no breath, and the venue\'s logo held back',
      attrs['data-tvi-tri'] === '0' && attrs['data-tvi-word'] === 'hide' && attrs['data-tvi-line'] === 'hide' && attrs['data-tvi-breath'] === 'off' && H.logoReady() === false);
var logoAt = null; H.onLogoReady(function () { logoAt = NOW - T0; });
run(T0 + 5000);
var tri = log.filter(function (x) { return x[1] === 'data-tvi-tri'; }).map(function (x) { return [x[0] - T0, x[2]]; });
var seq = []; tri.forEach(function (x) { if (!seq.length || seq[seq.length - 1] !== x[1]) seq.push(x[1]); });
check('the triangle switches on with two catches: unlit, on, out, on, dim, then lit', seq.join(',') === '0,a,0,b,c,d,', seq);
var LUM = { '0': 0.13, a: 0.75, b: 1, c: 0.08, d: 0.7, '': 1 };
var steps = []; tri.forEach(function (x) { if (!steps.length || steps[steps.length - 1][1] !== x[1]) steps.push(x); });
var flashes = [];
for (var i = 1; i < steps.length - 1; i++) { var d1 = LUM[steps[i][1]] - LUM[steps[i - 1][1]], d2 = LUM[steps[i + 1][1]] - LUM[steps[i][1]]; if (d1 * d2 < 0 && Math.abs(d1) > 0.1) flashes.push(steps[i][0]); }
/* A flash is a PAIR of opposing changes (up then down): count the turns in any one second and halve them. */
var worst = 0; flashes.forEach(function (a) { worst = Math.max(worst, flashes.filter(function (f) { return f >= a && f < a + 1000; }).length / 2); });
check('never more than 3 flashes in any second (a flash is an up and a down)', worst <= 3, [worst, flashes]);
function when(k) { var x = log.filter(function (y) { return y[1] === k && y[2] === ''; })[0]; return x ? x[0] - T0 : null; }
var w = when('data-tvi-word'), l = when('data-tvi-line'), b = when('data-tvi-breath');
check('"venueplay" and "tv" come up together at 750 ms (one drawing, one switch)', w === 750, w);
check('the line at 1300 ms, after the words', l === 1300 && l > w, l);
check('the breath starts at 1000 ms, once the tube is lit', b === 1000, b);
check('a little after that, at 2300 ms, the venue\'s own logo may come in, top left', logoAt === 2300 && H.logoReady() === true, logoAt);
check('all over by 2.6 s (inside the 4 s rule), every step undone', attrs['data-tvi'] === 'done' && !attrs['data-tvi-tri'] && !attrs['data-tvi-word'] && !attrs['data-tvi-line'] && !attrs['data-tvi-breath']);

print('the hand-over and reduced motion');
log = []; attrs = {}; timers = [];
check('the TV app 1 s in (&vpi=): it picks up there', H.intro({ t0: NOW - 1000 }) === true && attrs['data-tvi-tri'] === undefined && attrs['data-tvi-word'] === undefined && attrs['data-tvi-line'] === 'hide', attrs);
run(NOW + 400);
check('and the line still comes in at 1300 ms of the app\'s clock', attrs['data-tvi-line'] === undefined);
run(NOW + 3000);
log = []; attrs = {};
check('handed over after the intro was already over: nothing replays', H.intro({ t0: NOW - 4000 }) === false && attrs['data-tvi'] === 'done' && !attrs['data-tvi-tri']);
REDUCED = true; attrs = {};
check('reduced motion: no intro at all, the still logo, and the venue\'s logo is not held', H.intro({ t0: NOW }) === false && attrs['data-tvi'] === 'done' && H.logoReady() === true);
REDUCED = false;
check('tv.html: once per tab, never in a demo, ?intro=0 off, armed in <head>',
      /if\(sessionStorage\.getItem\("vpTvIntro"\)\) return; sessionStorage\.setItem\("vpTvIntro","1"\);/.test(TV) && /demo=1\|intro=0/.test(TV) && TV.indexOf('VPTvHold.intro({ t0:t0 });') < TV.indexOf('</head>'));

print('the waiting card on a game screen');
var tv = el(); made = {};
H.lobby(tv, true);
var c = made.tvHoldCard;
check('no host yet: the card goes up over the wall, "Waiting for the host", and the venueplay corner mark steps aside',
      !!c && !c.hidden && /Waiting for the host/.test(c.innerHTML) && /data-vpb="lobby"/.test(c.innerHTML) && bodyCls['tvhold-on'] === true);
H.lobby(tv, true);
check('only ever one card', tv.kids.length === 1);
H.lobby(tv, false);
check('the host is there: the card comes down and the lobby is the wall again', c.hidden === true && bodyCls['tvhold-on'] === false);

print('');
if (fails) { print(fails + ' OF ' + ran + ' CHECKS FAILED'); throw new Error(fails + ' failed'); }
print('ALL ' + ran + ' CHECKS PASSED');
