/* EVERY VENUE ON THE NEW DRAW LOOKS (Dean, 12 Nov 2026, INBOX 284; FINDINGS R4/R5/D5).

   The Mini Bar's "Usual" was the OLD draw (the stored '' that "As now" saved), so after the release Dean still saw the
   old raffle and members draw and heard the old draw sound. Dean's three agreed looks are TICKET ROLL, FLIP BOARD and
   RACE PLATE; this is his explicit exception to "defaults never move existing venues", for the draw look only.

   The rule, in ONE place (VPDrawStyle.usual / VPDrawStyle.lookFor in /app/vp-drawstyle.js), RUN here:
     1. a raffle's usual look is the ticket roll, a members draw's the flip board, unless the venue chose the race plate
     2. anything else stored ('' from "As now", 'now', 'as_is', 'classic', the other game's look, junk) is the default,
        never the old draw
     3. the look for one draw: a real look wins, anything else is the usual look
   and the consoles and the setup wizard use it: no "As now" choice left anywhere, they start on the new looks.

   Migration 191 writes the same rule into every venue's saved settings (tools/migration-191-sim.test.py).

   Run: jsc tools/test-draw-looks-switch.js   (from the repo root) */
var ran = 0, bad = 0;
function show(name, cond, saw) { ran++; if (cond) print('  ok   ' + name); else { bad++; print('  FAIL ' + name + (saw !== undefined ? '   saw: ' + saw : '')); } }
var MOD = readFile('venueplay/app/vp-drawstyle.js');
var RH = readFile('venueplay/app/raffle/host.html'), MH = readFile('venueplay/app/members/host.html');
var HELP = readFile('venueplay/app/vp-setup-help.js');
var DS = (new Function(MOD + '\nreturn VPDrawStyle;'))();
/* the body of one named function in a page (from "function NAME(" to the next line that starts a sibling function) */
function fnBody(src, name) {
  var i = src.indexOf('function ' + name + '(');
  if (i < 0) return '';
  var j = src.indexOf('\n  function ', i + 10), k = src.indexOf('\n  $(', i + 10);
  var e = [j, k].filter(function (x) { return x > 0; }); e = e.length ? Math.min.apply(null, e) : src.length;
  return src.slice(i, e);
}
var usual = typeof DS.usual === 'function' ? DS.usual : function () { return '(no VPDrawStyle.usual)'; };
var lookFor = typeof DS.lookFor === 'function' ? DS.lookFor : function () { return '(no VPDrawStyle.lookFor)'; };

print('\n== 1. the usual look: ticket roll for a raffle, flip board for a members draw ==');
show('a raffle venue with no stored look gets the ticket roll', usual('raffle', undefined) === 'ticket', usual('raffle', undefined));
show('a members venue with no stored look gets the flip board', usual('members', undefined) === 'flip', usual('members', undefined));
show('a raffle venue that chose the race plate keeps the race plate', usual('raffle', 'race') === 'race', usual('raffle', 'race'));
show('a members venue that chose the race plate keeps the race plate', usual('members', 'race') === 'race', usual('members', 'race'));
show('a raffle venue on the ticket roll stays on it; members on the flip board stays on it', usual('raffle', 'ticket') === 'ticket' && usual('members', 'flip') === 'flip');
show('the defaults are named once: raffle ticket, members flip', DS.DEFAULT_LOOK && DS.DEFAULT_LOOK.raffle === 'ticket' && DS.DEFAULT_LOOK.members === 'flip', JSON.stringify(DS.DEFAULT_LOOK));

print('\n== 2. an old stored look is the default, never the old draw ==');
['', 'now', 'as_is', 'classic', 'As now', null, 0, 'RACE', ' race'].forEach(function (v) {
  show('raffle stored ' + JSON.stringify(v) + ' is the ticket roll', usual('raffle', v) === 'ticket', usual('raffle', v));
  show('members stored ' + JSON.stringify(v) + ' is the flip board', usual('members', v) === 'flip', usual('members', v));
});
show('the other game\'s look is the default (a raffle cannot be a flip board, a members draw cannot be a ticket roll)', usual('raffle', 'flip') === 'ticket' && usual('members', 'ticket') === 'flip');
show('an unknown game is a raffle (the ticket roll), never empty', usual('', '') === 'ticket' && usual(undefined, 'race') === 'race');
(function () {
  var any = [undefined, null, '', 'now', 'as_is', 'classic', 'ticket', 'flip', 'race', 'x', 5, {}], empty = 0;
  ['raffle', 'members', ''].forEach(function (m) { any.forEach(function (s) { any.forEach(function (o) { if (!DS.STYLES[lookFor(m, s, o)]) empty++; }); }); });
  show('no stored value and no one-draw choice ever gives anything but one of the three looks (' + 3 * any.length * any.length + ' pairs)', empty === 0, empty);
})();

print('\n== 3. the look for one draw ==');
show('"Usual" (no one-draw choice) is the venue\'s usual look', lookFor('raffle', 'race', null) === 'race' && lookFor('members', '', null) === 'flip' && lookFor('raffle', '', null) === 'ticket');
show('a real look for one draw wins', lookFor('raffle', 'ticket', 'race') === 'race' && lookFor('members', 'race', 'flip') === 'flip');
show('an old "As now" for one draw ("classic") is the usual look, not the old draw', lookFor('raffle', 'race', 'classic') === 'race' && lookFor('members', '', 'classic') === 'flip');
show('the other game\'s look for one draw is the usual look', lookFor('raffle', 'ticket', 'flip') === 'ticket' && lookFor('members', 'flip', 'ticket') === 'flip');

print('\n== 4. the consoles: no "As now", they start on the new looks, they ask the one rule ==');
show('no "As now" chip on the raffle console (usual or one draw)', !/>As now</.test(RH) && !/data-style=""/.test(RH) && !/data-once="classic"/.test(RH));
show('no "As now" chip on the members console (usual or one draw)', !/>As now</.test(MH) && !/data-style=""/.test(MH) && !/data-once="classic"/.test(MH));
show('the usual chips are the three agreed looks per game: raffle ticket roll, race plate; members flip board, race plate', (RH.match(/data-style="(\w+)"/g) || []).join() === 'data-style="ticket",data-style="race"' && (MH.match(/data-style="(\w+)"/g) || []).join() === 'data-style="flip",data-style="race"', (RH.match(/data-style="(\w*)"/g) || []).join() + ' / ' + (MH.match(/data-style="(\w*)"/g) || []).join());
show('the one-draw chips are Usual, then the looks', /data-once="">Usual<\/button>\s*<button type="button" data-once="ticket">Ticket roll<\/button>\s*<button type="button" data-once="race">Race plate/.test(RH) && /data-once="">Usual<\/button>\s*<button type="button" data-once="flip">Flip board<\/button>\s*<button type="button" data-once="race">Race plate/.test(MH));
show('the help words no longer offer "the draw you have today"', !/the draw you have today/.test(RH) && !/the draw you have today/.test(MH));
show('the raffle console starts on the ticket roll', /drawStyle:"ticket", drawTime:"normal"/.test(RH));
show('the members console starts on the flip board', /drawStyle:"flip", drawTime:"normal"/.test(MH));
show('the raffle console reads a saved look through VPDrawStyle.usual("raffle", ...)', /G\.drawStyle=VPDrawStyle\.usual\("raffle", p\.draw_style\)/.test(fnBody(RH, 'applyRafflePrefs')), fnBody(RH, 'applyRafflePrefs').length);
show('the members console reads a saved look through VPDrawStyle.usual("members", ...)', /G\.drawStyle=VPDrawStyle\.usual\("members", p\.draw_style\)/.test(fnBody(MH, 'applyMembersPrefs')), fnBody(MH, 'applyMembersPrefs').length);
show('the raffle draw\'s look is VPDrawStyle.lookFor("raffle", usual, one draw)', /return VPDrawStyle\.lookFor\("raffle", G\.drawStyle, G\.styleOnce\)/.test(fnBody(RH, 'lookNow')), fnBody(RH, 'lookNow'));
show('the members draw\'s look is VPDrawStyle.lookFor("members", usual, one draw)', /var look=VPDrawStyle\.lookFor\("members", G\.drawStyle, G\.styleOnce\)/.test(MH));
show('neither console turns a one-draw choice into the old draw ("classic" ? "")', !/"classic" \? ""/.test(RH) && !/"classic" \? ""/.test(MH));
show('the draw time chips always show (every look has a draw time now)', !/show\("timeField", !!G\.drawStyle\)/.test(RH) && !/\$\("timeField"\)\.classList\.toggle\("hidden", !G\.drawStyle\)/.test(MH));
show('several winning tickets in one raffle draw still keep the classic multi-ticket draw (the looks draw one number)', /!\(G\.winnersCount>1\)/.test(RH));

print('\n== 5. the setup wizard (hidden for now) offers the same looks ==');
(function () {
  var line = (HELP.match(/\{ key: "draw_style"[^\n]*\n[^\n]*\n[^\n]*/) || [''])[0];
  show('draw_style: Ticket roll (the default) and Race plate, no "As now"', /def: "ticket"/.test(line) && /options: \[\["ticket", "Ticket roll"\], \["race", "Race plate"\]\]/.test(line) && !/As now/.test(line), line.slice(0, 200));
})();

print('\n== 6. older TVs and the house words ==');
show('vp-drawstyle.js is still ES5 (no arrow, const, let, template string)', !/=>|\bconst |\blet |`/.test(MOD.replace(/\/\*[\s\S]*?\*\//g, '')));

print('\n' + (bad ? 'FAILED ' + bad + ' of ' + ran : 'ALL ' + ran + ' CHECKS PASSED'));
if (bad) throw new Error(bad + ' failed');
