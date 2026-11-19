/* THE DRAW LOOKS: THE RULES UNDER THEM (Dean, 10 Nov 2026; built 12 Nov 2026 on fix/games-look-12nov).

   RUNS the shipped schedule and helpers from /app/vp-drawstyle.js (loaded for real, with no page), and reads the two TV screens, the two
   consoles and the Worker:

     1. the draw time: short 6 s, normal 9 s, long 12 s; anything else is normal
     2. the build-up: the roll starts at the first item, passes the near misses one at a time, and ends exactly on the winner, never
        going backwards
     2d. a prize of any length keeps one line's box (review 1, S4): RUNS fitLine() on a model of the prize box
     2c. a late pick glides too (review 1, S1): RUNS lateClock() frame by frame with the pick at many moments
     2b. the ticket roll and race plate GLIDE (Jobs 515, 19 Nov 2026): run frame by frame at 60, 30 and 25 frames a second, the reel never
        stops on the way, never moves more than a third of a ticket a frame (so it is never seen running backwards), changes speed smoothly,
        lands exactly on the server's winner, and is calmer for a viewer who asked for less motion
     3. ONE winner line: "Bring ticket 0472 to the host." (the number once) and "Bring your member card to the host."
     4. SILENT: no sound of any kind in the draw looks
     5. the winner is only ever the server's: the stage holds until a pick arrives; the screens take it from t:"pick"
     6. every venue on the new looks (INBOX 284, 12 Nov): the consoles start on the ticket roll / flip board, no "As now", several winning
        tickets keep the classic multi-ticket draw, the Worker accepts only the known looks and times (tools/test-draw-looks-switch.js)
     7. older TVs: the file is ES5, and no em dash, "roster" or capital-V venueplay in it

   Run: jsc tools/test-drawstyle.js   (from the repo root) */
var ran = 0, bad = 0;
function show(name, cond, saw) { ran++; if (cond) print('  ok   ' + name); else { bad++; print('  FAIL ' + name + (saw !== undefined ? '   saw: ' + saw : '')); } }
var MOD = readFile('venueplay/app/vp-drawstyle.js');
var RS = readFile('venueplay/app/raffle/screen.html'), MS = readFile('venueplay/app/members/screen.html');
var RH = readFile('venueplay/app/raffle/host.html'), MH = readFile('venueplay/app/members/host.html');
var WK = readFile('venueplay-backend/worker/venueplay-game.js');
var DS = (new Function(MOD + '\nreturn VPDrawStyle;'))();

print('\n== 1. the draw time ==');
show('fast is 3 seconds', DS.secs('fast') === 3, DS.secs('fast'));
show('short is 6 seconds', DS.secs('short') === 6, DS.secs('short'));
show('normal is 9 seconds', DS.secs('normal') === 9, DS.secs('normal'));
show('long is 12 seconds', DS.secs('long') === 12, DS.secs('long'));
show('anything else is normal (9)', DS.secs('') === 9 && DS.secs('huge') === 9 && DS.secs(undefined) === 9);
show('the intro is 1.2 s and the win holds 7 s', DS.INTRO === 1.2 && DS.WIN === 7);

print('\n== 2. the build-up ==');
['short', 'normal', 'long'].forEach(function (k) {
  var D = DS.secs(k), N = Math.round(D * 5.2), S = DS.schedule(N, DS.K, D, 0.26), prev = -1, back = 0, i;
  for (i = 0; i <= 600; i++) { var p = S.pos(D * i / 600); if (p < prev - 1e-9) back++; prev = p; }
  show(k + ': starts on item 0, ends exactly on the winner (item ' + N + ')', S.pos(0) === 0 && Math.abs(S.pos(D) - N) < 1e-9, S.pos(D));
  show(k + ': never goes backwards', back === 0, back);
  var holds = 0; for (i = 0; i < DS.K; i++) { var s = S.steps[i]; if (Math.abs(S.pos((s.hold + s.move) / 2) - (N - DS.K + i)) < 1e-9) holds++; }
  show(k + ': stops on each of the ' + DS.K + ' near misses before the winner', holds === DS.K, holds);
  show(k + ': the last move onto the winner ends at the draw time', Math.abs(S.steps[DS.K - 1].end - D) < 1e-9, S.steps[DS.K - 1].end);
});

print('\n== 2b. the ticket roll and race plate GLIDE (Jobs 515, 19 Nov 2026: "back to front" and "jumps from ticket to ticket") ==');
/* The roll is run frame by frame at the rates a pub TV draws: 60, 30 and 25 frames a second. Tickets look alike, so a reel that moves
   more than half a ticket between two frames is SEEN running backwards; the old roll moved 0.73 of a ticket a frame at 30 frames a second.
   The old roll also stood still on each of the last four near misses and snapped on (37% of the draw stood still). */
(function () {
  function frames(S, D, fps) {
    var prev = 0, step = 0, maxStep = 0, maxChange = 0, stops = 0, back = 0, f, n = Math.round(D * fps);
    for (f = 1; f <= n; f++) {
      var p = S.pos(f / fps), d = p - prev;
      if (d > maxStep) maxStep = d;
      if (f > 1 && Math.abs(d - step) > maxChange) maxChange = Math.abs(d - step);
      if (d < -1e-12) back++;
      if (d < 1e-4 && f / fps > 0.1 && f / fps < D - 0.35) stops++;   // standing still between the soft start and the landing
      step = d; prev = p;
    }
    return { maxStep: maxStep, maxChange: maxChange, stops: stops, back: back };
  }
  [['fast', DS.VMAX], ['short', DS.VMAX], ['normal', DS.VMAX], ['long', DS.VMAX], ['normal', DS.VMAX_CALM]].forEach(function (c) {
    var k = c[0], vm = c[1], D = DS.secs(k), N = DS.glideN(D, vm), S = DS.glide(N, D, vm), name = k + (vm === DS.VMAX_CALM ? ' (less motion)' : '');
    var f60 = frames(S, D, 60), f30 = frames(S, D, 30), f25 = frames(S, D, 25);
    show(name + ': starts on item 0 and lands exactly on the winner (item ' + N + ') at the draw time', S.pos(0) === 0 && S.pos(D) === N && Math.abs(S.pos(D - 1e-9) - N) < 1e-6, [S.pos(0), S.pos(D), N]);
    show(name + ': never goes backwards, at any frame rate', f60.back === 0 && f30.back === 0 && f25.back === 0, [f60.back, f30.back, f25.back]);
    show(name + ': never stops on the way (no near-miss stop and snap)', f60.stops === 0 && f30.stops === 0, [f60.stops, f30.stops]);
    show(name + ': never more than a third of a ticket a frame at 25 frames a second (so never seen running backwards)', f25.maxStep < 0.34 && f30.maxStep < 0.3, [f25.maxStep, f30.maxStep]);
    show(name + ': the speed changes smoothly (at 60 frames a second no frame moves 0.01 of a ticket more or less than the one before; the old roll, 0.043)', f60.maxChange < 0.01, f60.maxChange);
    show(name + ': the last near miss is in the middle at the hold point, before the draw time', Math.abs(S.pos(S.freeze) - (N - 1)) < 1e-6 && S.freeze < D - 0.2 && S.freeze > D * 0.5, [S.pos(S.freeze), S.freeze, D]);
  });
  var mod = MOD.replace(/\/\*[\s\S]*?\*\//g, '');
  show('the ticket roll and the race plate run on the glide; the flip board keeps its flap steps', (mod.match(/N: glideN\(c\.DRAW, c\.vmax\), glide: c\.vmax/g) || []).length === 2 && /v = \{ N: Math\.round\(c\.DRAW \* 3\.6\), moveDur: 0\.13/.test(mod) && /st\.S = view\.glide \? glide\(N, DRAW, view\.glide\) : schedule\(N, K, DRAW, view\.moveDur\)/.test(mod));
  show('the stage with no pick yet holds where the glide puts the last near miss in the middle', /view\.freezeT = INTRO \+ \(view\.glide \? st\.S\.freeze : st\.S\.steps\[K - 1\]\.move - 0\.02\)/.test(mod));
  show('a viewer who asked for less motion gets the calm roll', /matchMedia\("\(prefers-reduced-motion: reduce\)"\)/.test(mod) && /vmax: calm \? VMAX_CALM : VMAX/.test(mod) && DS.VMAX_CALM < DS.VMAX / 2);
  show('the WINNER IS THE SERVER\'S, unchanged: setPick puts the server\'s number on item N, and every glide ends on item N', /st\.items\[st\.N\] = \{ no: st\.winNo, nm: st\.winName \}; st\.picked = true; clearWinFromReel\(\);/.test(mod) && ['fast', 'short', 'normal', 'long'].every(function (k) { var D = DS.secs(k), N = DS.glideN(D, DS.VMAX); return DS.glide(N, D, DS.VMAX).pos(D) === N && DS.glide(DS.glideN(D, DS.VMAX_CALM), D, DS.VMAX_CALM).pos(D) === DS.glideN(D, DS.VMAX_CALM); }));
  show('a card\'s shadow is written only when it changes (a slow TV lost frames repainting it every frame)', /if \(e\.sh !== sh\) \{ e\.sh = sh; e\.card\.style\.boxShadow/.test(mod));
})();

print('\n== 2c. a LATE pick glides too (review 1 of Jobs 515, S1: the reel stopped dead for 79 frames, then lurched back to speed) ==');
/* RUNS the shipped lateClock(), the clock the stage's tick() uses for the ticket roll and race plate, frame by frame, with the server's
   pick arriving at different moments: in time, just before, during and long after the point where the reel waits for it. */
(function () {
  function play(D, vm, fps, pickTd, extra) {
    var N = DS.glideN(D, vm), S = DS.glide(N, D, vm), lc = DS.lateClock(S, N, D), R = DS.INTRO + D, lost = 0, rows = [], f, n = Math.round((R + pickTd + (extra || 3)) * fps), own = 0;
    for (f = 0; f <= n; f++) {
      var raw = f / fps - lost, r = lc.step(raw, f / fps >= DS.INTRO + pickTd);
      lost += r.lost; if (r.p != null) own++;
      rows.push({ t: r.t, p: r.p != null ? r.p : S.pos(Math.min(Math.max(r.t - DS.INTRO, 0), D)) });
    }
    return { N: N, R: R, Tw: lc.Tw, rows: rows, own: own };
  }
  function judge(g, fps) {
    var back = 0, still = 0, maxChange = 0, prevD = null, landedAt = -1, maxStep = 0, i;
    for (i = 1; i < g.rows.length; i++) {
      var a = g.rows[i - 1], b = g.rows[i], d = b.p - a.p;
      if (d < -1e-12) back++;
      if (d > maxStep) maxStep = d;
      if (b.p < g.N - 0.02 && b.t > DS.INTRO + 0.1 && d < 1e-5) still++;   // standing still on the way to the winner
      if (prevD !== null && b.p < g.N - 1e-6 && Math.abs(d - prevD) > maxChange) maxChange = Math.abs(d - prevD);
      prevD = d; if (landedAt < 0 && b.t >= g.R) landedAt = i;
    }
    var last = g.rows[g.rows.length - 1];
    return { back: back, still: still, maxChange: maxChange, lands: landedAt > 0 && g.rows[landedAt].p === g.N && last.p === g.N && last.t > g.R && maxStep < 8 / fps };   // and no hop onto it: never more than the glide's cap in a frame
  }
  ['fast', 'short', 'normal', 'long'].forEach(function (k) {
    var D = DS.secs(k), N = DS.glideN(D, DS.VMAX), S = DS.glide(N, D, DS.VMAX), Tw = DS.INTRO + Math.max(0, S.freeze - DS.WAIT_LEAD) - DS.INTRO;
    var picks = [0.5, Tw - 0.05, Tw + 0.1, S.freeze, S.freeze + 0.3, D - 0.2, D + 0.5, D + 3, D + 10];
    var res = picks.map(function (pk) { var a = judge(play(D, DS.VMAX, 60, pk), 60), b = judge(play(D, DS.VMAX, 30, pk), 30); return [pk, a, b]; });
    show(k + ': the reel lands exactly on the server\'s winner and stays there, whenever the pick comes', res.every(function (x) { return x[1].lands && x[2].lands; }), JSON.stringify(res.filter(function (x) { return !(x[1].lands && x[2].lands); })));
    show(k + ': never backwards, whenever the pick comes (60 and 30 frames a second)', res.every(function (x) { return x[1].back === 0 && x[2].back === 0; }), JSON.stringify(res.map(function (x) { return [x[0], x[1].back, x[2].back]; })));
    show(k + ': never stands still on the way to the winner, even while it waits for a late pick', res.every(function (x) { return x[1].still === 0 && x[2].still === 0; }), JSON.stringify(res.map(function (x) { return [x[0], x[1].still, x[2].still]; })));
    show(k + ': no jump in speed when the reel starts waiting or when the late pick lands (under 0.01 of a ticket a frame at 60 frames a second)', res.every(function (x) { return x[1].maxChange < 0.01; }), JSON.stringify(res.map(function (x) { return [x[0], +x[1].maxChange.toFixed(4)]; })));
  });
  var g = play(9, DS.VMAX, 60, 0.3), W = play(9, DS.VMAX, 60, 1e6, 30 - 1e6), S9 = DS.glide(DS.glideN(9, DS.VMAX), 9, DS.VMAX);
  show('a pick in time leaves the glide exactly as it was (the clock never takes the reel over)', g.own === 0);
  var hold = W.rows.slice(-600), maxP = Math.max.apply(null, W.rows.map(function (r) { return r.p; }));
  show('no pick for 30 s: the draw clock holds before the win and the reel never reaches the last near miss (the winner is never invented)', hold.every(function (r) { return r.t === W.Tw && r.t < W.R; }) && maxP < W.N - 1, [hold[0].t, W.Tw, maxP, W.N]);
  var fast = DS.lateLand(0, 10, 1, 5), fastBack = 0, fp = 0, u;
  for (u = 1; u <= 400; u++) { var q = fast.pos(u / 400); if (q < fp - 1e-12 || q > 1 + 1e-9) fastBack++; fp = q; }
  show('a late pick that finds the reel still quick and close to the winner never runs past it (the landing is shortened instead)', fastBack === 0 && Math.abs(fast.pos(1) - 1) < 1e-12 && fast.T < 5, [fastBack, fast.T]);
  var mod2 = MOD.replace(/\/\*[\s\S]*?\*\//g, '');
  show('the stage\'s tick runs every gliding look on lateClock (and the reel paints its position)', /if \(view\.glide && st\.S\) \{ lateTick\(raw\); st\.raf = root\.requestAnimationFrame\(tick\); return; \}/.test(mod2) && /if \(!st\.lc\) st\.lc = lateClock\(st\.S, st\.N, DRAW\);/.test(mod2) && (mod2.match(/p = st\.pOv != null \? st\.pOv : S\.pos\(clamp\(td, 0, DRAW\)\)/g) || []).length === 2);
  show('the wait takes over at the glide\'s own position and speed', Math.abs(DS.lateWait(3, 2, 1.5).pos(0) - 3) < 1e-12 && Math.abs(DS.lateWait(3, 2, 1.5).vel(0) - 2) < 1e-12 && Math.abs(S9.freeze - DS.WAIT_LEAD - (W.Tw - DS.INTRO)) < 1e-9);
})();

print('\n== 2d. a prize of any length fits its one-line box (review 1, S4: a 73-letter prize ran off the bottom of a 1920 TV) ==');
/* RUNS the shipped fitLine() on a model of the prize box: Anton letters about 0.45 of the size wide, whole words wrapped into the box's
   width (1760 = 1920 less 80 each side), line height 1. The Worker keeps up to 120 letters of a prize. */
(function () {
  function model(text, width) {
    return function (e) {
      var f = parseFloat(e.style.fontSize), words = text.split(' '), lines = 1, cur = 0, widest = 0, i;
      for (i = 0; i < words.length; i++) {
        var w = words[i].length * 0.45 * f, sp = 0.25 * f;
        widest = Math.max(widest, w);
        if (cur && cur + sp + w > width) { lines++; cur = w; } else cur += (cur ? sp : 0) + w;
      }
      return { w: Math.max(width, widest), h: lines * f };
    };
  }
  function fitted(text, start, floor) { var e = { style: {} }, f = DS.fitLine(e, 1760, start, start, floor, model(text, 1760)); return { f: f, m: model(text, 1760)(e) }; }
  var short = fitted('Meat tray', 120, 36), two = fitted('Seafood platter for two from Tweed Heads Fish Co plus a bottle of red', 120, 36);
  var max = fitted('Seafood platter for two from the Tweed Heads Fish Co and a bottle of Hunter Valley red and a fifty dollar bar card for you xx'.slice(0, 120), 120, 36);
  show('a short prize keeps its full size (120 px, one line)', short.f === 120 && short.m.h === 120, short);
  show('a 70-letter prize steps down until it fits inside one line\'s height', two.f < 120 && two.f >= 36 && two.m.h <= 121, two);
  show('the longest prize the Worker keeps (120 letters) fits too, at a size still read across a room (36 px or more)', max.f >= 36 && max.m.h <= 121 && max.m.w <= 1761, max);
  var mod3 = MOD.replace(/\/\*[\s\S]*?\*\//g, '');
  show('every look fits its prize when the stage is made and again once the fonts are in; the race plate on its one line', /fit\(\);\s+function fitPrize\(\)/.test(mod3) && /fitPrize\(\);\s+if \(root\.document && root\.document\.fonts && root\.document\.fonts\.ready\) root\.document\.fonts\.ready\.then\(function \(\) \{ if \(!st\.dead\) fitPrize\(\); \}\);/.test(mod3) && /fitLine\(prizeEl, 1290, 1e9, s0, 30,/.test(mod3) && /fitLine\(prizeEl, prizeEl\.clientWidth, s0, s0, 36,/.test(mod3) && /\.vpds-prize\{position:absolute;left:0;right:0;padding:0 80px;/.test(mod3) && /display:inline;padding:0;font:400 76px/.test(mod3));
})();

print('\n== 3. one winner line ==');
show('raffle: Bring ticket 0472 to the host.', DS.claimLine('raffle', '0472') === 'Bring ticket 0472 to the host.', DS.claimLine('raffle', '0472'));
show('the word ticket is said once', DS.claimLine('raffle', '0472').split('icket').length === 2);
show('members: Bring your member card to the host.', DS.claimLine('members', '216') === 'Bring your member card to the host.');
show('a winner claims from the host, never the bar', !/bar/i.test(DS.claimLine('raffle', '7') + DS.claimLine('members', '7')));
show('numbers pad to the raffle width with zeros, members with blanks', DS.pad(47, 4) === '0047' && DS.pad(216, 4, ' ') === ' 216');

print('\n== 4. silent ==');
show('no Audio, AudioContext, oscillator or sound file in the draw looks', !/new Audio|AudioContext|createOscillator|\.m4a|\.mp3|\.wav|\.play\(/.test(MOD));
show('the draw looks never call the fanfare', !/fanfare/i.test(MOD));

print('\n== 5. the winner is the server\'s ==');
show('the stage holds on the last near miss until a pick arrives', /freezeT/.test(MOD) && /!st\.picked && raw > freeze/.test(MOD));
show('the winner item shows no number until picked', /var show = \(i === N && !st\.picked\) \? "" : items\[i\]\.no;/.test(MOD) && /if \(st\.blank \|\| \(i === N && !st\.picked\)\) return " ";/.test(MOD));
show('the raffle host sends t:"pick" with the server ticket as soon as the API answers', /function sendPick\(r\)/.test(RH) && (RH.match(/sendPick\(r\); return wait/g) || []).length === 2);
show('the members host sends t:"pick" the same way', /t:"pick", number:r\.member_number, name:r\.winner_name/.test(MH));
show('the raffle TV shows the look when the draw names one, and the members TV too', /if\(styleOn\(\)\)\{ stopSpin\(\); showLayer\("tvStyle"\); makeStage\(\)\.start\(\)/.test(RS) && /if\(styleOn\(\) && state\.kind!=="entries"\) showStyleDrawing\(\)/.test(MS));
show('the draw time and the pick reset sit on their own line after the end-show call (a comment once swallowed them)', /\n\s+S\.styleSecs=\(typeof m\.drawSecs/.test(RS) && /\n\s+state\.styleSecs=\(typeof m\.drawSecs/.test(MS));
show('the title line sits after the stage, so the stage never covers it', RS.indexOf('id="tvStyleHost"') < RS.indexOf('id="tvStyleTitle"') && MS.indexOf('id="tvStyleHost"') < MS.indexOf('id="styleTitle"'));
show('the raffle TV takes the pick from t:"pick" only', /m\.t==="pick"/.test(RS) && /setPick\(\{ number:S\.pick \}\)/.test(RS));
show('the members TV takes the pick from t:"pick" only', /m\.t==="pick"/.test(MS) && /styleStage\.setPick\(state\.pick\)/.test(MS));

print('\n== 6. every venue on the new looks (INBOX 284) ==');
show('the raffle console starts on the ticket roll', /drawStyle:"ticket", drawTime:"normal"/.test(RH));
show('the members console starts on the flip board', /drawStyle:"flip", drawTime:"normal"/.test(MH));
show('no "As now" chip on either console (INBOX 284)', !/>As now</.test(RH) && !/>As now</.test(MH));
show('raffle offers ticket roll and race plate; members flip board and race plate', /data-style="ticket">Ticket roll/.test(RH) && /data-style="race">Race plate/.test(RH) && /data-style="flip">Flip board/.test(MH) && /data-style="race">Race plate/.test(MH));
show('several winning tickets keep the old draw', /!\(G\.winnersCount>1\)/.test(RH));
show('a look is only sent with the draw when one is chosen', /if\(styleKey\(\)\)\{ m\.style=styleKey\(\)/.test(RH) && /if\(styled\)\{ dm\.style=look/.test(MH));
show('the TVs only take the known looks', /m\.style==="ticket"\|\|m\.style==="race"\) \? m\.style : ""/.test(RS) && /m\.style==="flip"\|\|m\.style==="race"\) \? m\.style : ""/.test(MS));
show('the draw time is 6 / 9 / 12 on the chips', /Short, 6 seconds/.test(RH) && /Normal, 9 seconds/.test(RH) && /Long, 12 seconds/.test(RH) && /Long, 12 seconds/.test(MH));
show('the Worker accepts only the known raffle looks and times', /draw_style:\s+\(v\) => \(\['', 'ticket', 'race'\]/.test(WK) && (WK.match(/draw_time:\s+\(v\) => \(\['fast', 'short', 'normal', 'long'\]\.indexOf\(v\) >= 0 \? v : undefined\)/g) || []).length === 2);
show('the Worker accepts only the known members looks', /draw_style:\s+\(v\) => \(\['', 'flip', 'race'\]/.test(WK));
show('the members console saves a look only once one has been chosen or loaded', /if\(G\.lookSet\)\{ p\.draw_style/.test(MH));
show('the win ends the stage on the claim clock, and a claim or idle takes it down', /destroyStyle\(\)/.test(RS) && /if\(which!=="tvStyle"\) destroyStyle\(\)/.test(RS) && /function hideAll\(\)\{ stopClaimCd\(\); destroyStyle\(\)/.test(MS));

print('\n== 6b. start and end show on a new-look draw ==');
show('a screen that hears a draw look switches its own end show on (?endshow=0 still wins)', /enable:function\(\)\{ if\(!\/\[\?&\]endshow=0[^}]*ON=true; window\.VPEndShow\.on=true;/.test(readFile('venueplay/app/vp-endshow.js')));
show('the raffle and members TVs call it only when a look was chosen', /if\(S\.styleKey && window\.VPEndShow && VPEndShow\.enable\) VPEndShow\.enable\(\)/.test(RS) && /if\(state\.styleKey && window\.VPEndShow && VPEndShow\.enable\) VPEndShow\.enable\(\)/.test(MS));
show('the start show stays on by default for every game (on unless ?sting=0)', /var ON = !\/\[\?&\]sting=0/.test(readFile('venueplay/app/vp-sting.js')));

print('\n== 6c. 11 Nov: names on the ticket, headings, prize counter, drawn row, one slant, fast, defaults ==');
show('the ticket prints the venue, "Raffle ticket" and the raffle\'s own name, and repeats venue and name on the stub', /class="vpds-vn"><\/div><div class="vpds-lb">Raffle ticket<\/div><div class="vpds-rn"><\/div>/.test(MOD) && /\.vpds-sl b"\)\.textContent = vname; d\.querySelector\("\.vpds-sl i"\)\.textContent = o\.name/.test(MOD));
show('the member card prints the venue, Members draw and the draw\'s own name', /class="vpds-vt"><\/div><div class="vpds-ml">Members draw<\/div><div class="vpds-dnm"><\/div>/.test(MOD) && /\.vpds-dnm"\)\.textContent = o\.name/.test(MOD));
show('the raffle wall\'s heading is the raffle\'s own name (Raffle only when it has none)', /\$\("tvStyleTitle"\)\.textContent=S\.styleName \|\| "Raffle"/.test(RS) && /m\.raffle==="string"/.test(RS));
show('the members wall\'s heading is the draw\'s own name', /\$\("styleTitle"\)\.textContent=state\.drawName \|\| "Members draw"/.test(MS));
show('the host sends the raffle name and Prize n of m with a new-look draw', /m\.raffle=rt/.test(RH) && /m\.prizeNo=G\.prizeIdx\+1; m\.prizeOf=G\.prizes\.length/.test(RH));
show('Prize 1 of 32 style counter in the stage', /"Prize " \+ \(o\.prizeNo \| 0\) \+ " of " \+ \(o\.prizeOf \| 0\)/.test(MOD) && /o\.prizeOf > 1/.test(MOD));
show('the drawn numbers stay along the bottom of the flip board: at most 10, this draw added when it lands', /\.slice\(-9\)/.test(MOD) && /list = list\.slice\(-10\)/.test(MOD) && /t >= R \+ 1\.0/.test(MOD) && /style === "flip" && !bigWin && !o\.noClock\) \? el\("div", "vpds-drawn"/.test(MOD));
show('the raffle TV passes tonight\'s drawn tickets, the members TV its drawn list', /drawn:drawn/.test(RS) && /drawn:\(state\.drawnList/.test(MS));
show('race plate: ONE slant for every tier (the same two lines cut all four)', /var GH = 646, SHIFT = \d+/.test(MOD) && /function lx\(y\)/.test(MOD) && /function rx\(y\)/.test(MOD) && (MOD.match(/clip\(/g) || []).length >= 3 && !/polygon\(28px/.test(MOD));
show('fast is a draw time chip on both consoles', /data-dt="fast">Fast, 3 seconds/.test(RH) && /data-dt="fast">Fast, 3 seconds/.test(MH) && !/Skip draw|skipBtn/.test(RH + MH));
show('a venue\'s usual look is set separately for raffles and members draws (own saved keys), changeable per draw', /p\.draw_style=G\.drawStyle/.test(RH) && /G\.lookSet/.test(MH) && /data-once="ticket">Ticket roll/.test(RH) && /data-once="flip">Flip board/.test(MH) && /styleOnce:null/.test(RH) && /styleOnce:null/.test(MH));
show('the usual look is the new look for every venue (ticket roll, flip board)', /drawStyle:"ticket", drawTime:"normal"/.test(RH) && /drawStyle:"flip", drawTime:"normal"/.test(MH));

print('\n== 6d. 11 Nov (INBOX 207): the look keeps to its own names, so a TV page\'s CSS cannot reach into it ==');
(function () {
  var code = MOD.replace(/\/\*[\s\S]*?\*\//g, ''), bare = [];
  (code.match(/class="[^"]*"/g) || []).forEach(function (m) { m.slice(7, -1).split(/\s+/).forEach(function (c) { if (c && !/^vpds-/.test(c)) bare.push(c); }); });
  (code.match(/\bel\("[a-z]+", "[^"]*"/g) || []).forEach(function (m) { var c = m.split('", "')[1].replace(/"$/, ''); c.split(/\s+/).forEach(function (x) { if (x && !/^vpds-/.test(x)) bare.push(x); }); });
  (code.match(/\bmk\("[^"]*"\)/g) || []).forEach(function (m) { var c = m.slice(4, -2); if (!/^vpds-/.test(c)) bare.push(c); });
  (code.match(/querySelector(All)?\("[^"]*"\)/g) || []).forEach(function (m) { (m.match(/\.[A-Za-z][\w-]*/g) || []).forEach(function (x) { if (!/^\.vpds-/.test(x)) bare.push(x); }); });
  var css = (code.split('var CSS = [')[1] || '').split('].join(')[0];
  (css.match(/\.[A-Za-z][\w-]*/g) || []).forEach(function (x) { if (!/^\.vpds(-|$)/.test(x) && !/^\.\d/.test(x)) bare.push(x); });
  show('every class the draw looks make, look up or style is vpds- (a screen\'s own .body once pulled the ticket\'s frame out)', bare.length === 0, bare.join(' '));
  show('the ticket\'s inner part is vpds-ticket-body, and nothing is called "body"', /class="vpds-ticket-body"/.test(code) && !/class="body"/.test(code) && !/ \.body[{:]/.test(code));
  show('the stage sets its own alignment and box sizing (a TV page\'s text-align and * rule cannot change it)', /\.vpds-stage\{[^"]*text-align:left/.test(code) && /"\.vpds \*,\.vpds \*:before,\.vpds \*:after\{box-sizing:border-box/.test(code));
})();

print('\n== 7. older TVs and the house words ==');
show('the draw looks file is ES5 (no arrow, const, let, template string)', !/=>|\bconst |\blet |`/.test(MOD.replace(/\/\*[\s\S]*?\*\//g, '')));
show('no em dash anywhere in the draw looks, the screens or the consoles', !/—/.test(MOD) && !/—/.test(RS.split('vpds-layer')[1] || '') );
show('venueplay is lower case in the draw looks', !/VenuePlay/.test(MOD.replace(/VPDrawStyle/g, '')));
show('nothing under 15px in the draw looks\' own labels (TV type, laid out at 1920)', !/font:[^;"]*\b(1[0-4]|[1-9])px\//.test(MOD));

print('\n' + (bad ? 'FAILED ' + bad + ' of ' + ran : 'ALL ' + ran + ' CHECKS PASSED'));
if (bad) throw new Error(bad + ' failed');
