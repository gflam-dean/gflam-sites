/* THE DRAW LOOKS: THE RULES UNDER THEM (Dean, 10 Nov 2026; built 12 Nov 2026 on fix/games-look-12nov).

   RUNS the shipped schedule and helpers from /app/vp-drawstyle.js (loaded for real, with no page), and reads the two TV screens, the two
   consoles and the Worker:

     1. the draw time: short 6 s, normal 9 s, long 12 s; anything else is normal
     2. the build-up: the roll starts at the first item, passes the near misses one at a time, and ends exactly on the winner, never
        going backwards
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
show('the winner item shows no number until picked', /var show = \(i === N && !st\.picked\) \? "" : items\[i\]\.no;/.test(MOD) && /if \(i === N && !st\.picked\) return " ";/.test(MOD));
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
show('the drawn numbers stay along the bottom of the flip board: at most 10, this draw added when it lands', /\.slice\(-9\)/.test(MOD) && /list = list\.slice\(-10\)/.test(MOD) && /t >= R \+ 1\.0/.test(MOD) && /style === "flip"\) \? el\("div", "vpds-drawn"/.test(MOD));
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
