/* MUSICAL BINGO TV: THE 10 NOV 2026 SIGN-OFF FAULTS (venueplay/app/musical/screen.html).

   1. the red "No sound" message is a bar on the bottom edge, never top centre (it sat on the title)
   2. the played strip never cuts a title: no ellipsis, no hyphen, wider chip, steps down in size; a trailing bracket is
      dropped in the strip only
   3. no spaced mono capitals on the wall (eyebrows are sentence case in the body font); the claim line says what the
      player has ("Someone has a line"), never "bingo"
   4. the lobby footer lines are at least 22px at 1920

   Run: jsc tools/test-musical-tv-10nov.js   (from the repo root) */
var ran = 0, bad = 0;
function show(name, cond, saw) { ran++; if (cond) print('  ok   ' + name); else { bad++; print('  FAIL ' + name + (saw !== undefined ? '   saw: ' + saw : '')); } }
function lift(text, name, label) {
  var i = text.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('cannot find ' + name + ' in ' + label);
  var d = 0, k = text.indexOf('{', i);
  do { if (text[k] === '{') d++; else if (text[k] === '}') d--; k++; } while (d > 0 && k < text.length);
  return text.slice(i, k) + '\n';
}
var SCREEN = readFile('venueplay/app/musical/screen.html');
var CSS = SCREEN.slice(SCREEN.indexOf('<style>'), SCREEN.indexOf('</style>'));

print('\n== 1. the no-sound message is a bottom bar ==');
var aw = SCREEN.slice(SCREEN.indexOf('w.id="audioWarn"'), SCREEN.indexOf('w.textContent=SOUND_BAR_TEXT'));
show('it is pinned to the bottom edge, full width', /bottom:0;left:0;right:0/.test(aw));
show('and never to the top, where the title is', !/top:/.test(aw));

print('\n== 2. the strip never cuts a title ==');
var st = new Function(lift(SCREEN, 'stripTitle', 'screen.html') + 'return stripTitle;')();
show('a trailing bracket is dropped: "(Hot Summer Night)"', st('Jump Around (Hot Summer Night)') === 'Jump Around', st('Jump Around (Hot Summer Night)'));
show('a trailing square bracket too: "[Radio Edit]"', st('Levitating [Radio Edit]') === 'Levitating');
show('the long one keeps its main title whole', st("I'd Do Anything for Love (But I Won't Do That)") === "I'd Do Anything for Love", st("I'd Do Anything for Love (But I Won't Do That)"));
show('a title with no bracket is untouched', st('Thunderstruck') === 'Thunderstruck');
show('a title that is only a bracket is kept as it is', st('(Sittin on) The Dock of the Bay') === '(Sittin on) The Dock of the Bay' && st('(Untitled)') === '(Untitled)');
var ptok = (CSS.match(/#tvRun \.ptok\{[^}]*\}/) || [''])[0];
show('the chip never ellipses or hyphenates', /text-overflow:clip/.test(ptok) && !/ellipsis/.test(ptok) && /hyphens:none/.test(ptok) && /white-space:normal/.test(ptok));
show('the chip is wider than the old 15.36cqw', /flex:0 0 16\.4cqw/.test(ptok));
var fit = lift(SCREEN, 'fitStrip', 'screen.html');
show('fitStrip steps the size down for a long word (width) as well as for height', /scrollWidth>t\.clientWidth/.test(fit) && /scrollHeight>t\.clientHeight/.test(fit) && /lines\(\)>2\.3/.test(fit));
show('five chips and the strip gaps fit the strip (87.5cqw)', 5 * (16.4 + 0.94) <= 87.5, 5 * (16.4 + 0.94));
show('one song count only: "N songs played" left, and no dashed slot at all (Dean, 11 Nov 2026; no "Song N" twice)', /nx\.classList\.toggle\("hidden", true\); nx\.textContent="";/.test(SCREEN) && /" song"\+\(all\.length===1\?"":"s"\)\+" played"/.test(SCREEN) && !/textContent\s*=\s*"Song /.test(SCREEN));

print('\n== 3. no spaced mono capitals; the claim line ==');
var rules = CSS.match(/[^{}]*\{[^}]*\}/g) || [];
var spaced = rules.filter(function (r) {
  var sel = r.slice(0, r.indexOf('{')); var body = r.slice(r.indexOf('{'));
  if (!/eyebrow|winslabel|codelbl|\.tjl|pblabel/.test(sel)) return false;
  if (/pblabel/.test(sel)) return false;   /* hidden on the new wall */
  return /text-transform:uppercase/.test(body) || /letter-spacing:\.[1-9]/.test(body) || /JetBrains/.test(body);
});
show('no eyebrow, "Wins", "Code" or "Join now" rule is uppercase, letter-spaced or mono', spaced.length === 0, spaced.join(' | ').slice(0, 300));
show('the playing wall eyebrow is the body font, sentence case, no spacing', /#tvRun \.eyebrow\{font-family:'Hanken Grotesk'[^}]*text-transform:none;letter-spacing:0/.test(CSS));
var ce = new Function(SCREEN.slice(SCREEN.indexOf('var CLAIM_EYE='), SCREEN.indexOf('function renderMeta')) + 'return claimEyeText;')();
show('one -> "Someone has a line"', ce('one') === 'Someone has a line', ce('one'));
show('two -> "Someone has two lines"', ce('two') === 'Someone has two lines');
show('full -> "Someone has a full house"', ce('full') === 'Someone has a full house');
show('corners -> "Someone has four corners"', ce('corners') === 'Someone has four corners');
show('an unknown pattern falls back to a line, never "bingo"', ce('odd') === 'Someone has a line' && !/bingo/i.test(['one', 'two', 'corners', 'full'].map(ce).join(' ')));
show('the claim screen has no "called Bingo" line', !/Someone called/i.test(SCREEN) && /id="tvClaimEye"/.test(SCREEN) && /tvClaimEye"\)\.textContent=claimEyeText\(state\.pattern\)/.test(SCREEN));
show('no all-caps eyebrow strings left in the page', !/WE HAVE A WINNER|GET READY|NOW PLAYING"|THIS GAME/.test(SCREEN.replace(/NOW PLAYING:|the NOW PLAYING label|a pink NOW PLAYING label/g, '')));

print('\n== 4. the lobby footer is readable ==');
var lf = (CSS.match(/#tvLobby \.jsub,#tvLobby \.hostline\{[^}]*\}/) || [''])[0];
var cq = parseFloat((lf.match(/font-size:max\(\d+px,([\d.]+)cqw\)/) || [0, 0])[1]);
show('the lobby footer is at least 22px at 1920 (' + (cq * 19.2).toFixed(1) + 'px)', cq * 19.2 >= 22, lf);
show('and in the body font with no letter-spacing', /Hanken Grotesk/.test(lf) && /letter-spacing:0/.test(lf) && !/JetBrains/.test(lf));

print('\n== 5. the lobby says ready once (Dean 16 Nov, job 448) ==');
var SR = (SCREEN.match(/function showReady\(\)\{[\s\S]*?renderRun\(\);\s*\}/) || [''])[0];
show('the ready state heading reads "Get ready to play" and the line under it "First song coming up"', /tvNowTitle"\)\.textContent="Get ready to play"; \$\("tvNowArtist"\)\.textContent="First song coming up"/.test(SR) && /id="tvNowTitle">Get ready to play</.test(SCREEN) && /id="tvNowArtist">First song coming up</.test(SCREEN));
show('the pink eyebrow is hidden in the ready state, so it never says ready twice', /\$\("tvNowEye"\)\.classList\.add\("hidden"\)/.test(SR) && /class="eyebrow hidden" id="tvNowEye"/.test(SCREEN) && !/"Get ready"|>Ready to play</.test(SCREEN));
show('every Now playing path shows the eyebrow again', (SCREEN.match(/textContent="Now playing"; \$\("tvNowEye"\)\.classList\.remove\("hidden"\)/g) || []).length >= 4);

print('');
print(bad ? (bad + ' FAILED, ' + ran + ' run') : ('ALL ' + ran + ' CHECKS PASSED'));
if (bad) throw new Error(bad + ' failed');
