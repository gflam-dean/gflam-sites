/* MUSICAL BINGO, THE NEW LOOK: THE RULES UNDER IT (Dean, 3 Nov 2026; built 4 Nov 2026 for the 5 Nov gate).

   RUNS the shipped code, lifted out of the pages and the game Worker, with small stubs:

     1. the wall's one sentence for the pattern and the prize: "One line wins a meat tray" as the host typed it,
        "a" or "an" unless the prize already starts with one (or a number, or a dollar sign), the pattern alone
        while no prize is set; and the five patterns' short names
     2. the wall's played strip: the last five, the current one outlined, "+N" for the rest, a dashed "Song N" slot
        while a song is held back, the song number bottom left, and the held song never named
     3. the phone card never hyphenates (Dean, 10 Nov 2026; the 9 Nov one-hyphen rule is gone): see tools/test-musical-card-10nov.js
     4. the phone's pattern by its own marks (the faint claim) and the lines "Highlight my lines" outlines: the
        finished rows solid, the closest ones still needed dashed, as many as the pattern needs
     5. the venue's ad on the phone (/app/vp-phonead.js): only picture slides with a plain https address, in date,
        eight at most; nothing at all when there are none
     6. the game Worker's /join/info: the venue's slides ONLY for a phone that asks (ad:1), so bingo's and trivia's
        answers are exactly what they were; pictures only, https only; kept 30 s per venue and never re-read on
        fresh:1; a failed read is no slides, never a failed join; the cached answer gets them too

     7. MUSICAL BINGO IS NOT BINGO ON THE PLAYER'S CARD (Dean, 5 Nov 2026: "Musical bingo can't say bingo on the
        customers card"): no customer-visible words on app/musical/play.html (its markup, and every sentence its
        script can write: notes, toasts, the claim, the after screens, aria labels, titles) say "bingo", except the
        game's own name "musical bingo". tools/musical-newlook-in-chrome.test.py reads the painted phone too.

   Run: jsc tools/test-musical-newlook.js   (from the repo root) */
var ran = 0, bad = 0;
function show(name, cond, saw) { ran++; if (cond) print('  ok   ' + name); else { bad++; print('  FAIL ' + name + (saw !== undefined ? '   saw: ' + saw : '')); } }
function lift(text, name, label, isAsync) {
  var i = text.indexOf((isAsync ? 'async function ' : 'function ') + name + '(');
  if (i < 0) throw new Error('cannot find ' + name + ' in ' + label + ' - a test that cannot find its subject cannot fail');
  var d = 0, k = text.indexOf('{', i);
  do { if (text[k] === '{') d++; else if (text[k] === '}') d--; k++; } while (d > 0 && k < text.length);
  return text.slice(i, k) + '\n';
}
var SCREEN = readFile('venueplay/app/musical/screen.html');
var PLAY = readFile('venueplay/app/musical/play.html');
var AD = readFile('venueplay/app/vp-phonead.js');
var GAME = readFile('venueplay-backend/worker/venueplay-game.js');

(async function () {
/* ======================================================================================= 1 */
print('\n== 1. the wall\'s one sentence: "One line wins a meat tray" ==');
(function () {
  var PATTERN_NAMES = { one: 'One line across', two: 'Two lines across', corners: 'Four corners', full: 'Full house' };
  var src = SCREEN.slice(SCREEN.indexOf('var PATTERN_SHORT='), SCREEN.indexOf('var PATTERN_SHORT=') + 200).split('\n')[0];
  var wl = new Function('PATTERN_NAMES', src + '\n' + lift(SCREEN, 'winsLine', 'musical/screen.html') + 'return winsLine;')(PATTERN_NAMES);
  show('one line and a meat tray: "One line wins a meat tray"', wl('one', 'meat tray') === 'One line wins a meat tray', wl('one', 'meat tray'));
  show('the prize as the host typed it: "One line wins a Meat tray"', wl('one', 'Meat tray') === 'One line wins a Meat tray', wl('one', 'Meat tray'));
  show('"an" before a vowel: "Two lines wins an esky"', wl('two', 'esky') === 'Two lines wins an esky', wl('two', 'esky'));
  show('a prize that already has its word: "Full house wins the meat raffle"', wl('full', 'the meat raffle') === 'Full house wins the meat raffle', wl('full', 'the meat raffle'));
  show('a number or a dollar prize gets no "a": "Four corners wins $50 bar tab", "One line wins 2 schooners"', wl('corners', '$50 bar tab') === 'Four corners wins $50 bar tab' && wl('one', '2 schooners') === 'One line wins 2 schooners', [wl('corners', '$50 bar tab'), wl('one', '2 schooners')]);
  show('no prize set yet (or the console\'s "the prize"): the pattern alone, "One line wins"', wl('one', '') === 'One line wins' && wl('one', 'the prize') === 'One line wins', [wl('one', ''), wl('one', 'the prize')]);
  show('it never says BINGO', !/bingo/i.test(['one', 'two', 'corners', 'full', 'odd'].map(function (p) { return wl(p, 'x'); }).join(' ')));
  /* The demo's songs live in the shared demo clock since 7 Nov 2026 (the wall and the phone read one list). */
  var CLK = readFile('venueplay/app/vp-demo-clock.js');
  var demo = SCREEN.slice(SCREEN.indexOf('function demoNight'), SCREEN.indexOf('function hideChrome')) + CLK.slice(CLK.indexOf('var MUSICAL={'), CLK.indexOf('window.VPDemoClock='));
  show('the sales-page and store demo carries no album covers: no artwork address in its songs (Dean, 4 Nov 2026)', demo.indexOf('mzstatic') < 0 && !/artworkUrl"?\s*:\s*"http/.test(demo) && /var SONGS = C\.SONGS;/.test(demo) && /SONGS:\[\{ title:"Never Gonna Give You Up", artist:"Rick Astley" \}/.test(demo));
  show('and the wall draws our logo tile in the art spot on the demo, never an image', /if\(VP_DEMO\) url="";   \/\* the demo draws our logo tile/.test(SCREEN) && /else \{ img\.removeAttribute\("src"\); img\.classList\.add\("hidden"\); logoShow\(false\); \}/.test(SCREEN));
  /* INBOX 392 item 2: the logo in the art spot when there is no cover, spin in then pulse, to the beat where the clip can be heard, never a layout change */
  show('no cover: our logo spins in once, then pulses (steady breath), and goes back to a cover when there is one', /function logoShow\(restart\)/.test(SCREEN) && /function logoHide\(\)/.test(SCREEN) && /\.mart\.vplogo\.spin \.mlogo\{animation:mLogoSpin \.95s/.test(SCREEN) && /\.mart\.vplogo\.pulse \.mlw\{animation:mLogoPulse 1\.6s/.test(SCREEN));
  show('the beat comes from an analyser tapped off the clip BEFORE the boost, sending nothing on, and falls back to the steady pulse', /_srcNode\.connect\(an\); _beatAn=an;/.test(SCREEN) && !/an\.connect\(/.test(SCREEN) && /function beatFeed\(level\)/.test(SCREEN) && /window\.VP_TV_BEAT=\{ feed:beatFeed \}/.test(SCREEN));
  show('the logo animates transform and glow only (never width, height, top or left), so the layout cannot move', (function () { var css = SCREEN.slice(SCREEN.indexOf('.mart.vplogo.spin'), SCREEN.indexOf('.mcol{')); return css.indexOf('@keyframes mLogoSpin') > 0 && !/@keyframes mLogo(Spin|Pulse)\{[^}]*(width|height|top|left|margin)/.test(css.replace(/\}\}/g, '}}')); })());
  show('reduced motion: no spin, no pulse, no beat swell, and the beat loop checks it live', /prefers-reduced-motion:reduce\)\{\.mart\.vplogo\.spin \.mlogo,\.mart\.vplogo\.pulse \.mlw\{animation:none\}\.mart\.vplogo\.beaty \.mlw\{transform:none;filter:none\}\}/.test(SCREEN) && /if\(!_beatAn \|\| calm\(\) \|\| document\.hidden\) return;/.test(SCREEN));
  show('the phone has no now-playing view and no cover to replace (nothing there to change)', !/tvArtBox|nowart/.test(readFile('venueplay/app/musical/play.html')));
  show('the wall writes it into its sentence line every time the pattern or prize is drawn', /\$\("tvWins"\)\.textContent=winsLine\(state\.pattern, state\.prize\);/.test(SCREEN));
})();

/* ======================================================================================= 2 */
print('\n== 2. the played strip: the last five, "+N", and a dashed slot for the song still held back ==');
(function () {
  function el(id) { var c = {}; return { id: id, textContent: '', children: [], _imgs: 0, set innerHTML(v) { this.children = []; }, appendChild: function (k) { this.children.push(k); },
    insertBefore: function (k) { this._imgs++; }, classList: { toggle: function (x, on) { if (on) c[x] = 1; else delete c[x]; }, contains: function (x) { return !!c[x]; } } }; }
  var E = {}; function $(id) { return E[id] || (E[id] = el(id)); }
  var document = { createElement: function (t) { var e = el(t); e.className = ''; return e; } };
  var src = SCREEN.slice(SCREEN.indexOf('  var TV_BOARD_MAX=5;'), SCREEN.indexOf('  function renderRun(){'));
  var api = new Function('$', 'document', 'S', 'var state=S.state, _pendingSong=null;\n' + src + '\nreturn { draw: function(p){ _pendingSong=p; renderBoard(); }, art: noteArt };')($, document, { state: (state = { played: [] }) });
  var state;
  var songs = []; for (var i = 1; i <= 14; i++) songs.push('Song ' + i + ' title');
  api.art('Song 14 title', 'https://is1-ssl.mzstatic.com/a.jpg'); api.art('Song 13 title', 'javascript:alert(1)');
  state.played = songs.slice(); api.draw(null);
  var tiles = $('tvBoard').children;
  show('fourteen played: the last five on the strip, oldest first', tiles.length === 5 && tiles[0].textContent === 'Song 10 title' && tiles[4].textContent === 'Song 14 title', tiles.map(function (t) { return t.textContent; }).join('|'));
  show('the current song is the one outlined (class "new")', tiles[4].className === 'ptok new' && tiles[3].className === 'ptok');
  show('no "+9" chip: the only count on the wall is the one bottom left (Dean, 6 Nov 13:10)', $('tvBoardMore').classList.contains('hidden') && $('tvBoardMore').textContent === '');
  show('"14 songs played" bottom left (6 Nov: it said "Song 14", which read as the dashed "Song 15" twice)', $('tvSongNo').textContent === '14 songs played');
  show('artwork on a tile only from the library\'s https or this site, never another kind of address', tiles[4]._imgs === 1 && tiles[3]._imgs === 0);
  show('no dashed slot while nothing is held back', $('tvBoardNext').classList.contains('hidden'));
  state.played = songs.concat(['Mystery']); api.draw({ title: 'Mystery' });
  tiles = $('tvBoard').children;
  show('song 15 held back: the last five played and no dashed slot after them (Dean, 11 Nov 2026)', tiles.length === 5 && tiles[4].textContent === 'Song 14 title' && $('tvBoardNext').classList.contains('hidden'), [tiles.length, $('tvBoardNext').textContent]);
  show('while held, no tile is outlined as current, and the song is not named on the strip', tiles.every(function (t) { return t.className === 'ptok' && t.textContent !== 'Mystery'; }));
  show('and the left says 14 songs played (the held one is not counted yet), and no other number', $('tvSongNo').textContent === '14 songs played' && $('tvBoardMore').classList.contains('hidden'), [$('tvSongNo').textContent, $('tvBoardMore').textContent]);
  state.played = ['A']; api.draw(null);
  show('one song: no "+0" chip', $('tvBoardMore').classList.contains('hidden') && $('tvBoard').children.length === 1);
  state.played = []; api.draw(null);
  show('none yet: no song number', $('tvSongNo').textContent === '');
  state.played = ['A']; api.draw(null);
  show('one song: "1 song played", singular', $('tvSongNo').textContent === '1 song played');
})();

/* ======================================================================================= 3 */
print('\n== 3. the phone card: NO hyphen, ever (Dean, 10 Nov 2026 sign-off; supersedes the 9 Nov one-hyphen rule) ==');
(function () {
  var flat = PLAY.replace(/\s+/g, ' ').replace(/; /g, ';');
  show('no soft-hyphen helper is left in the phone (softBreak, withSoftBreak)', PLAY.indexOf('function softBreak(') < 0 && PLAY.indexOf('function withSoftBreak(') < 0);
  show('the tile says hyphens:none', /#vCard \.cc\{[^}]*hyphens:none;-webkit-hyphens:none\}/.test(flat));
  show('the card is built from the plain titles (cardTitle), never a hyphenated copy', PLAY.indexOf('ct.textContent=cardTitle(titles[i]);') > 0);
  // REPINNED 12 Nov 2026 (Dean via main INBOX 337, 12 Nov): the fitter is per square now; was "one size, 15px floor"
  show('the details (each square its own size, never wider than the screen, brackets dropped) are in tools/test-musical-card-10nov.js', readFile('tools/test-musical-card-10nov.js').indexOf('the fitter: per square (INBOX 337)') > 0);
})();

/* ======================================================================================= 4 */
print('\n== 4. the pattern by the player\'s marks: the faint claim, and the lines it outlines ==');
(function () {
  var mk = function (pattern, marks) {
    var P = { cells: new Array(25), pattern: pattern, daubs: {} }; marks.forEach(function (i) { P.daubs[i] = true; });
    return new Function('P', lift(PLAY, 'rowMarks', 'musical/play.html') + lift(PLAY, 'markedPattern', 'musical/play.html') + lift(PLAY, 'lineRows', 'musical/play.html') + 'return { done: markedPattern(), rows: lineRows() };')(P);
  };
  var row2 = [10, 11, 13, 14];
  show('one line: the middle row marked (with the free centre) makes the pattern', mk('one', row2).done === true);
  show('one line: one short of it does not', mk('one', [10, 11, 13]).done === false);
  show('one line, nothing marked: the claim is faint', mk('one', []).done === false);
  show('two lines: one row is not enough, two are', mk('two', row2).done === false && mk('two', row2.concat([0, 1, 2, 3, 4])).done === true);
  show('four corners: the four corners', mk('corners', [0, 4, 20]).done === false && mk('corners', [0, 4, 20, 24]).done === true);
  show('full house: every tile', mk('full', row2).done === false);
  var r = mk('one', row2).rows;
  show('outline, one line done: that row, solid', r.length === 1 && r[0].r === 2 && r[0].done === true, JSON.stringify(r));
  r = mk('one', [0, 1, 2, 5]).rows;
  show('outline, no line yet: the closest row, dashed', r.length === 1 && r[0].r === 0 && r[0].done === false, JSON.stringify(r));
  r = mk('two', row2.concat([20, 21, 22])).rows;
  show('outline, two lines with one done: the done row solid and the next closest dashed', r.length === 2 && r[0].r === 2 && r[0].done && r[1].r === 4 && !r[1].done, JSON.stringify(r));
  show('"Highlight my lines" starts off unless this phone turned it on, and is remembered', /function loadHl\(\)\{ try\{ return localStorage\.getItem\("vp-mhl"\)==="1"; \}/.test(PLAY) && /var _hl=false;/.test(PLAY));
})();

/* ======================================================================================= 5 */
print('\n== 5. the venue\'s ad on the phone: its own pictures, in date ==');
(function () {
  var w = { document: { getElementById: function () { return null; } } };
  new Function('window', AD)(w);
  var A = w.VPPhoneAd;
  var S = [{ image_url: 'https://x.supabase.co/a.jpg' }, { head: 'Text slide' }, { image_url: 'http://plain.example/b.jpg' },
           { image_url: 'https://x/c.jpg', starts: '2026-11-10' }, { image_url: 'https://x/d.jpg', ends: '2026-11-01' },
           { image_url: 'https://x/e.jpg', starts: '2026-11-01', ends: '2026-11-30' }, { image_url: 'https://x/f.jpg?a=&#41;' }, null, 'junk'];
  var got = A.pick(S, '2026-11-05');
  show('pictures with a plain https address only, in date on the phone\'s day', got.join(',') === 'https://x.supabase.co/a.jpg,https://x/e.jpg', got.join(','));
  var many = []; for (var i = 0; i < 20; i++) many.push({ image_url: 'https://x/' + i + '.jpg' });
  show('eight at most', A.pick(many, '2026-11-05').length === 8);
  show('none: nothing (never an empty box)', A.pick([], '2026-11-05').length === 0 && A.pick(null).length === 0);
  show('the phone shows the ad on the lobby and after the game only', /var AD_VIEWS=\{ vWait:1, vLost:1, vWon:1 \};/.test(PLAY) && /VPPhoneAd\.show\(!!AD_VIEWS\[which\]\)/.test(PLAY));
  show('in ONE place: a single #vpAd slot, after the screens and just before our logo at the foot', (PLAY.match(/id="vpAd"/g) || []).length === 1 && PLAY.indexOf('<div id="vpAd" hidden></div>') < PLAY.indexOf('<div class="pfoot">') && PLAY.indexOf('<div id="vpAd" hidden></div>') > PLAY.indexOf('id="vLost"'));
  show('the phone asks for the slides with its join lookup (ad:1), no extra request', PLAY.indexOf('playerPost("/join/info",{ code:P.room, ad:1 })') > 0);
})();

/* ======================================================================================= 6 */
print('\n== 6. the game Worker: slides only for the phone that asks ==');
await (async function () {
  var reads = 0, fail = false, ROWS = [{ slides: [{ image_url: 'https://x.supabase.co/s1.jpg', starts: '2026-11-01', ends: 'soon' }, { head: 'Trivia Thursdays' },
    { image_url: 'http://x/s2.jpg' }, { image_url: 'https://x/s3.jpg' }] }];
  var body = { format: 'musical_bingo', venue_name: 'Tugun Bowls Club', collect: { first_name: true } };
  var env = {};
  function sbGet(e, table, q) { reads++; if (fail) throw new Error('db down'); if (table !== 'vp_venue_screen' || q.indexOf('venue_id=eq.v1') !== 0 || q.indexOf('limit=1') < 0) throw new Error('wrong read ' + table + ' ' + q); return Promise.resolve(ROWS); }
  function enc(s) { return encodeURIComponent(s); }
  var lookups = 0;
  async function joinInfoLookup() { lookups++; return { keep: true, body: JSON.parse(JSON.stringify(body)), venueId: 'v1' }; }
  async function readJson(r) { return r.b; }
  var src = [/const JOIN_INFO_TTL_MS = \d+;/, /const JOIN_INFO_STATIC_TTL_MS = \d+;/, /const JOIN_INFO_CACHE_MAX = \d+;[^\n]*/, /const joinInfoCache = new Map\(\);[^\n]*/, /const joinInfoStatic = new Map\(\);[^\n]*/]
    .map(function (re) { var m = re.exec(GAME); if (!m) throw new Error('cannot find ' + re); return m[0].replace('const ', 'var '); }).join('\n');
  src += '\n' + lift(GAME, 'joinInfoKeep', 'game Worker') + lift(GAME, 'joinInfoStaticRead', 'game Worker', true) + lift(GAME, 'handleJoinInfo', 'game Worker', true) +
         lift(GAME, 'joinInfoWithSlides', 'game Worker', true) + lift(GAME, 'phoneSlides', 'game Worker') +
         lift(GAME, 'publicEvents', 'game Worker');   // the What's on nights ride the same read (INBOX 110)
  var W = new Function('sbGet', 'enc', 'joinInfoLookup', 'readJson', src + '\nreturn { h: handleJoinInfo, p: phoneSlides, cache: joinInfoCache, stat: joinInfoStatic };')(sbGet, enc, joinInfoLookup, readJson);
  function json(o) { return o; }
  var plain = await W.h({ b: { code: 'K7MQ2P' } }, env, json);
  show('a phone that does not ask (bingo, trivia): the answer is exactly what it was, no slides, no extra read', !('slides' in plain) && reads === 0 && JSON.stringify(plain) === JSON.stringify(body), JSON.stringify(plain));
  var ad = await W.h({ b: { code: 'K7MQ2P', ad: 1 } }, env, json);
  show('the musical phone (ad:1): the same answer plus the venue\'s slides', ad.venue_name === 'Tugun Bowls Club' && Array.isArray(ad.slides) && reads === 1, JSON.stringify(ad));
  show('pictures with a plain https address only; a text slide and an http one stay on the TV; a bad date is dropped, a good one kept',
       JSON.stringify(ad.slides) === JSON.stringify([{ image_url: 'https://x.supabase.co/s1.jpg', starts: '2026-11-01' }, { image_url: 'https://x/s3.jpg' }]), JSON.stringify(ad.slides));
  show('the answer it hands out is a copy: the kept body never gains the slides', !('slides' in W.cache.get('K7MQ2P').body));
  var ad2 = await W.h({ b: { code: 'K7MQ2P', ad: true } }, env, json);
  show('the next phone in the room is answered from the kept copies: no lookup, no read', lookups === 1 && reads === 1 && ad2.slides.length === 2, [lookups, reads]);
  await W.h({ b: { code: 'K7MQ2P', ad: 1, fresh: 1 } }, env, json);
  show('a fresh:1 lookup reads the venue again, but NOT the slides (a picture a few seconds old is harmless)', lookups === 2 && reads === 1, [lookups, reads]);
  W.stat.clear(); W.cache.clear(); fail = true;
  var down = await W.h({ b: { code: 'K7MQ2P', ad: 1 } }, env, json);
  show('a failed slides read is no slides, and the phone still gets its join answer', down.venue_name === 'Tugun Bowls Club' && down.slides.length === 0 && down.collect.first_name === true, JSON.stringify(down));
  show('eight slides at most', W.p(new Array(20).join('x').split('x').map(function (_, i) { return { image_url: 'https://x/' + i + '.jpg' }; })).length === 8);
  show('rubbish is no slides, never a throw', W.p(null).length === 0 && W.p('x').length === 0 && W.p([null, 3, { image_url: 5 }]).length === 0);
})();

/* ======================================================================================= 7 */
print('\n== 7. the player\'s card never says "bingo" (only the game\'s name "musical bingo") ==');
(function () {
  /* the page with its comments taken out: what is left is markup and code */
  var t = PLAY.replace(/<!--[\s\S]*?-->/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:"'\\])\/\/[^\n]*/g, '$1');
  var body = t.slice(t.indexOf('<body'));
  /* the words a player can see or hear: text between tags, attribute words (aria-label, title, placeholder, alt,
     value) and every quoted sentence in the script (a string with a space in it, which is how every note, toast and
     label on the page is written, and any string that is the word itself, like "BINGO!"; ids and class names like
     "bingoBtn" are neither) */
  var words = [];
  var html = body.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<style[\s\S]*?<\/style>/g, ' ');
  html.replace(/>([^<]+)</g, function (_, x) { if (x.trim()) words.push(x.trim()); return _; });
  html.replace(/\b(aria-label|title|placeholder|alt|value)="([^"]*)"/g, function (_, k, v) { words.push(v); return _; });
  var head = t.slice(0, t.indexOf('<body')); var tt = head.match(/<title>([^<]*)<\/title>/); if (tt) words.push(tt[1]);
  var js = (t.match(/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/g) || []).join('\n');
  js.replace(/"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'/g, function (_, a, b2) { var x = a !== undefined ? a : b2; if (/\s/.test(x) || /\bbingo\b/i.test(x)) words.push(x); return _; });
  var bad7 = words.filter(function (w) { return /bingo/i.test(w.replace(/musical[\s\u00a0]+bingo/ig, '')); });
  show('the phone page was read: its markup and its script\'s sentences (more than 150 found)', words.length > 150, words.length);
  show('no customer-visible "bingo" on the musical phone, other than the name "musical bingo"', bad7.length === 0, bad7.slice(0, 6).join(' | '));
  show('the claim says what the player has, never BINGO: "I\'ve got a line", "I\'ve got two lines", "Full house"',
       /one:"I've got a line"/.test(PLAY) && /two:"I've got two lines"/.test(PLAY) && /full:"Full house"/.test(PLAY) && /id="bingoBtn">I've got a line</.test(PLAY));
})();

print('');
print(bad ? (bad + ' FAILED, ' + ran + ' run') : ('ALL ' + ran + ' CHECKS PASSED'));
if (bad) throw new Error(bad + ' failed');
})().catch(function (e) { print('FAIL ' + e); throw e; });
