/* THE DRAW MOMENTS: THE RULES UNDER THEM (13 Nov 2026, INBOX 285 option 2 "winner takes the screen" and 299b option 3 "countdown band and a final ten").

   RUNS the shipped helpers (/app/vp-drawstyle.js and /app/vp-drawcount.js loaded for real, no page, a fake clock and a fake timer) and reads the
   consoles, the screens and the Worker:

     1. names say First Last whatever the list holds ("Hollis,Kate"), and split over two rows only when long
     2. the countdown: 4:59 style clock, the band until 10 seconds, the final ten from 10 to 1, zero at 0
     3. the console's clock: starts, tells the TV the seconds left now and every 10 seconds, calls the draw at 0:00 once, cancels quietly or loudly
     4. BOTH ARE OFF: the Worker takes draw_winner_big and draw_countdown only as true/false, both consoles start them off, save them only once touched,
        send nothing extra with them off, and no migration or column is involved
     5. SILENT: the sound slots are named and empty ("splitflap-clean-closemic"), nothing plays
     6. older TVs: both files are ES5; no em dash, "roster" or capital-V venueplay

   Run: jsc tools/test-draw-moments.js   (from the repo root) */
var ran = 0, bad = 0;
function show(name, cond, saw) { ran++; if (cond) print('  ok   ' + name); else { bad++; print('  FAIL ' + name + (saw !== undefined ? '   saw: ' + saw : '')); } }
var DSsrc = readFile('venueplay/app/vp-drawstyle.js'), DCsrc = readFile('venueplay/app/vp-drawcount.js');
var RS = readFile('venueplay/app/raffle/screen.html'), MS = readFile('venueplay/app/members/screen.html');
var RH = readFile('venueplay/app/raffle/host.html'), MH = readFile('venueplay/app/members/host.html');
var WK = readFile('venueplay-backend/worker/venueplay-game.js');
/* a fake clock and a fake timer, so the console's clock can be played without waiting */
var T = 0, timers = [];
this.performance = { now: function () { return T; } };
this.setInterval = function (f, ms) { timers.push({ f: f, ms: ms, at: T + ms }); return timers.length; };
this.clearInterval = function (id) { if (timers[id - 1]) timers[id - 1].dead = true; };
function advance(ms) { var end = T + ms; for (;;) { var nxt = null, i; for (i = 0; i < timers.length; i++) if (!timers[i].dead && timers[i].at <= end && (!nxt || timers[i].at < nxt.at)) nxt = timers[i]; if (!nxt) break; T = nxt.at; nxt.at += nxt.ms; nxt.f(); } T = end; }
var DS = (new Function(DSsrc + '\nreturn VPDrawStyle;'))();
var DC = (new Function(DCsrc + '\nreturn VPDrawCount;'))();

print('\n== 1. names ==');
show('"Hollis,Kate" is Kate Hollis', DS.niceName('Hollis,Kate') === 'Kate Hollis', DS.niceName('Hollis,Kate'));
show('"Lucas,Lawson" and "Willow,Mitchell" are First Last (the two Dean saw on the Kogan)', DS.niceName('Lucas,Lawson') === 'Lawson Lucas' && DS.niceName('Willow,Mitchell') === 'Mitchell Willow');
show('"Hollis, Kate" with a space is the same, and "Kate Hollis" and "K. Whitely" are left alone', DS.niceName('Hollis, Kate') === 'Kate Hollis' && DS.niceName('Kate Hollis') === 'Kate Hollis' && DS.niceName('K. Whitely') === 'K. Whitely');
show('nothing or an odd value is an empty name, never "undefined"', DS.niceName(null) === '' && DS.niceName(undefined) === '' && DS.niceName('  ') === '');
show('a short name is one row of capitals', JSON.stringify(DS.nameLines('Hollis,Kate')) === '["KATE HOLLIS"]', JSON.stringify(DS.nameLines('Hollis,Kate')));
show('a long name is two rows split at the space nearest the middle', JSON.stringify(DS.nameLines('Whitfield,Alexandra')) === '["ALEXANDRA","WHITFIELD"]', JSON.stringify(DS.nameLines('Whitfield,Alexandra')));
show('a name with no spaces stays on one row, and no row is longer than 16 tiles', DS.nameLines('Bartholomewmcfarlandson')[0].length === 16 && DS.nameLines('Mary Jane Watson-Fitzgerald').every(function (l) { return l.length <= 16; }));

print('\n== 2. the countdown clock and phases ==');
show('clock: 4:59, 0:05, 10:00, 0:00', DC.fmt(299) === '4:59' && DC.fmt(5) === '0:05' && DC.fmt(600) === '10:00' && DC.fmt(0) === '0:00' && DC.fmt(-3) === '0:00');
show('a part second rounds up (the room sees 0:01, never 0:00, until it is zero)', DC.fmt(0.2) === '0:01' && DC.fmt(59.01) === '1:00');
show('band above 10 seconds, final from 10 down to 1, zero at 0', DC.phase(300) === 'band' && DC.phase(10.9) === 'band' && DC.phase(10) === 'final' && DC.phase(9.2) === 'final' && DC.phase(11) === 'band' && DC.phase(1) === 'final' && DC.phase(0) === 'zero');
show('the final ten says Get to the screen for members and Last tickets, now for the raffle', DC.finalLine('members') === 'Get to the screen' && DC.finalLine('raffle') === 'Last tickets, now');

print('\n== 3. the console\'s clock ==');
var sent = [], zero = 0, changes = 0;
var H = DC.host({ send: function (m) { sent.push(m); }, extra: function () { return { look: 'flip' }; }, onZero: function () { zero++; }, onChange: function () { changes++; } });
show('too short or too long is refused (nothing sent)', H.start(2) === false && H.start(99999) === false && sent.length === 0);
show('starts, and tells the TV the seconds left at once, with the total and the console\'s extras', H.start(60) === true && sent.length === 1 && sent[0].t === 'count' && sent[0].secs === 60 && sent[0].total === 60 && sent[0].look === 'flip', JSON.stringify(sent));
advance(9500); show('nothing is resent inside 10 seconds', sent.length === 1, sent.length);
advance(1000); show('it is resent every 10 seconds with the seconds that are left', sent.length === 2 && sent[1].secs === 50 && sent[1].total === 60, JSON.stringify(sent[1]));
show('the console reads the same clock', H.left() === 50 && H.running() === true, H.left());
H.resend(); show('a TV that says hello is sent the seconds left now', sent.length === 3 && sent[2].secs === 50);
advance(49000); show('before 0:00 the draw has not started', zero === 0 && H.running() === true, zero);
advance(1500); show('at 0:00 the console calls its own draw, once, and stops', zero === 1 && H.running() === false && H.left() === 0, zero);
advance(30000); show('and never again', zero === 1);
sent.length = 0; H.start(30); H.cancel();
show('a cancel tells the TV (count_off), and the draw is not called', sent.length === 2 && sent[1].t === 'count_off' && zero === 1 && H.running() === false, JSON.stringify(sent));
sent.length = 0; H.start(30); H.cancel(true); advance(40000);
show('a quiet cancel (the draw is starting and takes the TV) says nothing, and no draw is called', sent.length === 1 && zero === 1, JSON.stringify(sent));
sent.length = 0; H.cancel(); show('cancelling when nothing runs sends nothing', sent.length === 0);

print('\n== 4. both are OFF, and cost no migration ==');
show('the Worker takes draw_countdown in the raffle prefs and draw_winner_big + draw_countdown in the members prefs, as true/false only', /raffle: \{[\s\S]*?draw_countdown: gpBool[\s\S]*?\},\n  members: \{[\s\S]*?draw_winner_big: gpBool[\s\S]*?draw_countdown:\s+gpBool/.test(WK));
show('a text value is not a boolean: gpBool drops it', /const gpBool = \(v\) => \(typeof v === 'boolean'\) \? v : undefined;/.test(WK));
show('both consoles start with them off', /winBig:false, cdOn:false, momentsSet:false/.test(MH) && /cdOn:false, momentsSet:false/.test(RH));
show('both consoles save them only once the venue touched them (absent = off, no other venue moves)', /if\(G\.momentsSet\)\{ p\.draw_winner_big=!!G\.winBig; p\.draw_countdown=!!G\.cdOn; \}/.test(MH) && /if\(G\.momentsSet\) p\.draw_countdown=!!G\.cdOn;/.test(RH));
show('both consoles read them back as booleans only', /typeof p\.draw_winner_big==="boolean"/.test(MH) && /typeof p\.draw_countdown==="boolean"/.test(MH) && /typeof p\.draw_countdown==="boolean"/.test(RH));
show('with them off the draw, winner and result messages carry nothing extra', /if\(winBigOn\(\)\) obj\.wx=1;\s*if\(G\.cdOn\) obj\.cd=1;/.test(MH) && /function winBigOn\(\)\{ return !!G\.winBig && usualIsFlip\(\) && currentLook\(\)==="flip"; \}/.test(MH) && /if\(G\.cdOn && obj && \(obj\.t==="drawing"/.test(RH));
show('the countdown control is hidden unless the setting is on, in both consoles', /\$\("cdCtl"\)\.classList\.toggle\("hidden", !G\.cdOn\)/.test(MH) && /\$\("cdCtl"\)\.classList\.toggle\("hidden", !G\.cdOn\)/.test(RH));
show('the countdown starts only on a real tap, taking the TV first (never on page load)', /if\(typeof TVC!=="undefined"\) TVC\.whenShowing\(function\(\)\{ CD\.start\(secs\)/.test(MH) && /if\(typeof TVC!=="undefined"\) TVC\.whenShowing\(function\(\)\{ CD\.start\(secs\)/.test(RH));
show('the draw starting takes the countdown away quietly, in both consoles', /CD\.cancel\(true\);   \/\/ the draw has started/.test(MH) && /CD\.cancel\(true\);   \/\/ the draw has started/.test(RH));
show('the countdown calls the console\'s own draw button (so the rules gate, the TV claim and draw-again all still apply)', /function cdStartDraw\(\)\{[^}]*\$\("drawBtn"\)\.click\(\)/.test(MH) && /function cdStartDraw\(\)\{[^}]*\$\("drawBtn"\)\.click\(\)/.test(RH));
show('the settings are chips in the same field2 look as the draw look', /id="winBigChips"/.test(MH) && /<div class="chips" id="cdChips">/.test(MH) && /<div class="chips" id="cdChips">/.test(RH) && /class="field2" id="momentsField"/.test(MH));
show('the TV only draws what it is told: the overlay is made on the first t:count', /function cdc\(\)\{ if\(!cdCtl && window\.VPDrawCount\)/.test(MS) && /function cdc\(\)\{ if\(!cdCtl && window\.VPDrawCount\)/.test(RS));
show('both TV screens load the countdown file', /vp-drawcount\.js/.test(MS) && /vp-drawcount\.js/.test(RS));
show('a routine state or idle never drops a running countdown on the members wall', /state\.phase==="winner" \|\| state\.phase==="counting" \|\| holding\(\)/.test(MS) && /if\(state\.phase==="counting"\) return;/.test(MS));
show('no database change: nothing in this build names a migration, a column or vp_venue_settings.alter', !/ALTER TABLE|add column/i.test(DSsrc + DCsrc));

print('\n== 5. SILENT ==');
show('the flip board\'s clean close-mic split-flap slot is named and empty', DS.SOUND['splitflap-clean-closemic'] === '' && Object.keys(DS.SOUND).length === 1, JSON.stringify(DS.SOUND));
show('the countdown\'s tick and final slots are named and empty', DC.SOUND.tick === '' && DC.SOUND['final'] === '');
show('neither file makes audio of its own other than through an empty slot', !/new\s+(Audio|AudioContext)\(/.test(DSsrc) && (DCsrc.match(/new root\.Audio\(/g) || []).length === 1 && /if \(!u \|\| !root\.Audio\) return;/.test(DCsrc));

print('\n== 6. older TVs and house rules ==');
[['vp-drawstyle.js', DSsrc], ['vp-drawcount.js', DCsrc]].forEach(function (f) {
  var code = f[1].replace(/\/\*[\s\S]*?\*\//g, '');
  show(f[0] + ' is ES5 (no let/const/arrow/template strings/classes)', !/(^|[^\w.$])(let|const)\s|=>|`|\bclass\s+\w/.test(code));
  show(f[0] + ' has no em dash, roster, or capital-V VenuePlay', f[1].indexOf('—') < 0 && !/roster/i.test(f[1]) && !/VenuePlay/.test(f[1].replace(/VPDrawStyle|VPDrawCount/g, '')));
});
print('\n== 7. the draw holds ONE size (Jobs 516, 19 Nov 2026: "the draw jumps between sizes" on the sales pages\' demo TV) ==');
/* RUNS the real /app/vp-fit.js in a small pretend page: the draw layer as each TV screen marks it (its full-screen stage, the title line),
   the venue logo as the keep-out, at 1920 x 1080 with the 5% TV safe box. The title line is then moved the way the screen's alignTitle()
   moves it every second, and vp-fit runs again each time. Measured in Chrome before the fix (builds/draw-faults-515-516-19nov.md): the
   draw was shrunk to 0.82, then 0.828, 0.82, 0.823, 0.829 and moved down 0, 68, 5, 0 and 69px within one draw. */
(function () {
  var FIT = readFile('venueplay/app/vp-fit.js');
  function tagOf(src, id) { var i = src.indexOf('id="' + id + '"'); var a = src.lastIndexOf('<', i), b = src.indexOf('>', i); return src.slice(a, b + 1); }
  function fake(rect, attrs, cls) {
    return { r: rect, attrs: attrs || {}, cls: cls || [], style: {}, children: [], offsetParent: {}, offsetHeight: 0, id: (attrs || {}).id || '',
      classList: { contains: function (c) { return this.o.cls.indexOf(c) >= 0; } },
      hasAttribute: function (k) { return Object.prototype.hasOwnProperty.call(this.attrs, k); },
      getAttribute: function (k) { return this.hasAttribute(k) ? this.attrs[k] : null; },
      getBoundingClientRect: function () { var r = this.r; return { left: r[0], top: r[1], width: r[2], height: r[3], right: r[0] + r[2], bottom: r[1] + r[3] }; } };
  }
  /* one screen's draw layer through vp-fit, run after each of the title line's positions; returns every transform it wrote */
  function play(tag) {
    var attrs = { id: 'tvStyle' };
    if (/\sdata-fit-self[\s>=]/.test(tag)) attrs['data-fit-self'] = '';
    var layer = fake([96, 54, 1728, 972], attrs, ['layer']); layer.classList.o = layer;
    var host = fake([96, 54, 1728, 972]); host.classList.o = host;
    var title = fake([441.6, 109, 1036.8, 51.7]); title.classList.o = title;
    layer.children = [host, title];
    var logo = fake([116.7, 75, 121, 121], { 'data-fit-avoid': '' }); logo.classList.o = logo;
    var d = { readyState: 'complete', hidden: false, addEventListener: function () {}, querySelector: function () { return null; },
      querySelectorAll: function (s) { return s === '.layer' ? [layer] : (s === '[data-fit-avoid]' ? [logo] : []); } };
    var w = { location: { search: '' }, innerWidth: 1920, innerHeight: 1080, VPVenueLogo: { safeShare: function () { return 0.05; } },
      requestAnimationFrame: function (f) { f(0); return 1; }, setTimeout: function () { return 0; }, clearTimeout: function () {}, setInterval: function () {}, addEventListener: function () {} };
    new Function('window', 'document', 'getComputedStyle', 'MutationObserver', FIT)(w, d,
      function () { return { display: 'block', visibility: 'visible', position: 'absolute' }; }, function () { this.observe = function () {}; });
    var out = [];
    [109, 67.8, 179.1, 126.1, 116.1, 180.4].forEach(function (y) { title.r = [title.r[0], y, title.r[2], title.r[3]]; w.VP_FIT(); out.push(layer.style.transform || ''); });
    return out;
  }
  [['the raffle', RS], ['the members', MS]].forEach(function (s) {
    var tag = tagOf(s[1], 'tvStyle'), seen = play(tag);
    show(s[0] + ' draw layer is marked data-fit-self (the draw look fits itself to the screen)', /\sdata-fit-self[\s>]/.test(tag), tag);
    show(s[0] + ' draw is never shrunk or moved by vp-fit, however the title line moves (one size for the whole draw)', seen.every(function (t) { return t === ''; }), seen);
    var old = play(tag.replace(/\sdata-fit-self/, ''));
    show('this pretend page can see the fault: the same layer WITHOUT data-fit-self is shrunk to about 82% round the logo', old.length === 6 && old.every(function (t) { return /scale\(0\.8\d*\)/.test(t); }), old);
  });
})();

print('\n' + (bad ? bad + ' OF ' + ran + ' CHECKS FAILED' : 'ALL ' + ran + ' CHECKS PASSED'));
if (bad) throw new Error('draw moments rules failed');
