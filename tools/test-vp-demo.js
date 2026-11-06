/* THE TRY-IT DEMO'S RULES, RUN (Dean, 5 Nov 2026; INBOX 82, 84b, 92c, 93).

   Runs venueplay/app/vp-demo.js and venueplay/app/vp-try-slot.js in jsc:
     1. "How many players will join?": default 1, up to 10 whatever is typed (50 is 10).
     2. THE AUTO RULE: the answer goes up when the 30 s run out OR when that many players have all answered,
        whichever comes first; started with fewer, all of THEM.
     3. The device: a hint only; plan() for both choices and both device answers: two-screen, phone with a TV
        code, the host link; NO other device skips the demo into the account (Dean, 6 Nov); phone-only is off.
     4. Prefill: their own name, email and mobile round-trip through the #fragment, are wiped from the address
        once read, never overwrite what was typed, and never tick the offers box.
     5. The addresses: the page's own origin or venueplay.com.au, never a .dev host; the host link is the demo.
     6. After sign-in (/app/go): the demo only if it was chosen in the last 30 minutes, only the two fixed
        addresses, spent once read.

   Run from the repo root:  jsc tools/test-vp-demo.js */
var ran = 0, bad = 0;
function check(n, c, saw) { ran++; if (c) print('  ok   ' + n); else { bad++; print('  FAIL ' + n + (saw !== undefined ? '   saw: ' + JSON.stringify(saw) : '')); } }
var window = { location: { origin: 'https://venueplay.com.au', hash: '', pathname: '/app/trivia/play.html', search: '?room=RXYTKM' }, history: null };
load('venueplay/app/vp-demo.js');
var D = window.VPDemo;

print('1. How many players');
check('default 1 (nothing typed)', D.clampPlayers('') === 1 && D.clampPlayers(null) === 1);
check('0 and nonsense are 1', D.clampPlayers(0) === 1 && D.clampPlayers('abc') === 1 && D.clampPlayers(-4) === 1);
check('3 is 3, 10 is 10', D.clampPlayers('3') === 3 && D.clampPlayers(10) === 10);
check('50 typed is 10 (up to 10 for the demo)', D.clampPlayers(50) === 10 && D.clampPlayers('50') === 10 && D.clampPlayers('999') === 10);
check('the demo is 5 questions of 30 s, up to 10', D.QUESTIONS === 5 && D.SECONDS === 30 && D.MAX === 10);

print('');
print('2. 30 seconds or everyone answered, whichever comes first');
check('time left, nobody answered: wait', D.shouldReveal(20, 0, 3, 3) === false);
check('time left, 2 of 3 answered: wait', D.shouldReveal(12, 2, 3, 3) === false);
check('time left, all 3 answered: reveal now', D.shouldReveal(12, 3, 3, 3) === true);
check('time up, nobody answered: reveal', D.shouldReveal(0, 0, 3, 3) === true);
check('time up with 1 of 3: reveal', D.shouldReveal(0, 1, 3, 3) === true);
check('they said 3, only 2 joined, both answered: reveal (all of them)', D.shouldReveal(15, 2, 3, 2) === true);
check('they said 50 (10), 10 joined, 9 answered: wait', D.shouldReveal(15, 9, 50, 10) === false);
check('they said 50 (10), 10 answered: reveal', D.shouldReveal(15, 10, 50, 10) === true);
check('one player, answered: reveal straight away', D.shouldReveal(28, 1, 1, 1) === true);
check('a broken timer (NaN) reveals rather than hangs', D.shouldReveal(NaN, 0, 3, 3) === true);

print('');
print('3. The device and what each screen shows');
check('375 x 812 touch is a phone', D.deviceKind(375, 812, true) === 'phone');
check('1024 x 768 touch is a tablet', D.deviceKind(1024, 768, true) === 'tablet');
check('1366 x 768 no touch is a computer', D.deviceKind(1366, 768, false) === 'computer');
var p = D.plan({ mode: 'player', device: 'computer', other: true });
check('computer, as a player, another device: this screen is the TV with the QR, and it runs itself', p.tv && p.playerQr && p.driver && !p.player && !p.hostLink && !p.skip, p);
p = D.plan({ mode: 'host', device: 'computer', other: true });
check('computer, as the host too: the TV, the QR, the host link, and it does NOT run itself', p.tv && p.playerQr && p.hostLink && !p.driver, p);
p = D.plan({ mode: 'player', device: 'computer', other: false });
check('computer, NO other device: no demo, straight into their account (Dean, 6 Nov)', p.skip === true && !p.tv && !p.driver, p);
p = D.plan({ mode: 'player', device: 'phone', other: true });
check('phone, another device: this phone is the player, the TV code is shown, it runs itself', p.player && p.tvCode && p.driver && !p.tv && !p.skip, p);
p = D.plan({ mode: 'player', device: 'phone', other: false });
check('phone, NO other device: no demo, straight into their account', p.skip === true && !p.player && !p.driver, p);
check('the phone-only mini demo is switched OFF', D.PHONE_ONLY === false);
p = D.plan({ mode: 'player', device: 'phone', other: false, phoneOnly: true });
check('...and, switched on, it would be the player and the game on this phone', p.player && p.phoneOnly && p.driver && !p.tv && !p.tvCode && !p.skip, p);
p = D.plan({ mode: 'host', device: 'tablet', other: false });
check('tablet, as the host too, no other device: straight into their account', p.skip === true, p);
p = D.plan({ mode: 'host', device: 'phone', other: true });
check('phone, as the host too: player here, the TV code and the host link, the host device runs it', p.player && p.tvCode && p.hostLink && !p.driver, p);

print('');
print('4. Their own details, pre-filled');
var h = D.prefillHash({ name: 'Dean Smith', email: 'dean@royal.example', mobile: '0412 345 678' });
check('the details ride in the #fragment only', /^#vpdemo=[A-Za-z0-9_-]+$/.test(h), h);
check('nothing readable in the address (not even the email)', h.indexOf('dean') < 0 && h.indexOf('@') < 0, h);
var back = D.readPrefill(h);
check('they come back: first name, email, mobile', back && back.n === 'Dean' && back.e === 'dean@royal.example' && back.m === '0412 345 678', back);
check('a junk fragment reads as nothing', D.readPrefill('#vpdemo=!!!') === null && D.readPrefill('#nothing') === null && D.readPrefill('') === null);
check('a bad email is dropped, the rest kept', D.readPrefill(D.prefillHash({ name: 'Jo', email: 'not-an-email' })).e === '');
check('no details, no fragment', D.prefillHash({}) === '');
var replaced = null;
var loc = { hash: h, pathname: '/app/trivia/play.html', search: '?room=RXYTKM' };
var took = D.takePrefill(loc, { replaceState: function (a, b, u) { replaced = u; } });
check('read once, then wiped from the address (path and room kept)', took && took.n === 'Dean' && replaced === '/app/trivia/play.html?room=RXYTKM', replaced);
var E = {};
function box(id, v) { E[id] = { id: id, value: v || '', checked: false }; }
box('nameIn'); box('xEmail'); box('xMobile', '0499 999 999'); box('xOptin');
var doc = { getElementById: function (id) { return E[id] || null; } };
var n = D.applyPrefill(doc, took);
check('the team name, email are filled', E.nameIn.value === 'Dean' && E.xEmail.value === 'dean@royal.example', E);
check('a box they already typed in is left alone', E.xMobile.value === '0499 999 999');
check('the offers tick is NEVER ticked by the prefill', E.xOptin.checked === false && n === 2);

print('');
print('5. The addresses');
var u = D.playUrl('rxytkm', { name: 'Dean' });
check('the player link: our origin, the room code, the details in the fragment', /^https:\/\/venueplay\.com\.au\/app\/trivia\/play\.html\?room=RXYTKM#vpdemo=/.test(u), u);
check('without details, no fragment (the TV\'s own QR carries nobody\'s details)', D.playUrl('RXYTKM') === 'https://venueplay.com.au/app/trivia/play.html?room=RXYTKM');
check('the host link is the demo console, players clamped', D.hostUrl(50) === 'https://venueplay.com.au/app/trivia/host.html?demo=host&n=10');
window.location.origin = 'https://venueplay-site.pages.dev';
check('a .dev origin is never put in a link or QR', D.playUrl('RXYTKM').indexOf('.dev') < 0, D.playUrl('RXYTKM'));
window.location.origin = 'http://localhost:8788';
check('a local preview stays local', D.playUrl('RXYTKM').indexOf('http://localhost:8788/') === 0);
check('the TV is the venue\'s own screen, without the intro', D.tvUrl('royal') === '/tv?venue=royal&intro=0');

print('');
print('6. After the one-tap sign-in');
load('venueplay/app/vp-try-slot.js');
var T = window.VPTrySlot;
function LS(v) { var m = {}; if (v !== undefined) m.vpTryNext = v; return { getItem: function (k) { return k in m ? m[k] : null; }, removeItem: function (k) { delete m[k]; }, m: m }; }
var NOW = Date.parse('2026-11-08T09:00:00Z');
var ls = LS(JSON.stringify({ path: '/app/try.html?mode=player', at: NOW - 60000 }));
check('chosen a minute ago: the demo', T.nextAfterSignIn(ls, NOW) === '/app/try.html?mode=player');
check('...and spent: the next sign-in is the console', !('vpTryNext' in ls.m) && T.nextAfterSignIn(ls, NOW) === '/app/');
check('as the host too: the host demo', T.nextAfterSignIn(LS(JSON.stringify({ path: '/app/try.html?mode=host', at: NOW })), NOW) === '/app/try.html?mode=host');
check('chosen 31 minutes ago: the console', T.nextAfterSignIn(LS(JSON.stringify({ path: '/app/try.html?mode=player', at: NOW - 31 * 60000 })), NOW) === '/app/');
check('any other address is refused (no open redirect)', T.nextAfterSignIn(LS(JSON.stringify({ path: 'https://evil.example/', at: NOW })), NOW) === '/app/' &&
  T.nextAfterSignIn(LS(JSON.stringify({ path: '/app/try.html?mode=player&x=1', at: NOW })), NOW) === '/app/' &&
  T.nextAfterSignIn(LS('not json'), NOW) === '/app/');
check('nothing chosen: the console, as always', T.nextAfterSignIn(LS(), NOW) === '/app/');

print('');
print(bad ? ('FAILED ' + bad + ' of ' + ran) : ('All ' + ran + ' checks passed'));
