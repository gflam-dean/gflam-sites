/* NO RUDE SONG REACHES A PUB, BY ANY PATH (Dean, 16 Nov 2026: "There should never be anything on our website that fucks with a game,
   billing or gives the customer less than what they've already seen. That's not a song.")

   The staging play of 16 Nov found five songs with rude titles in /data/musical-library.json, in eight of the built-in playlists (not
   none, as first thought). RUNS the shipped word list (/app/vp-songsafe.js), the console's own loadLibrary (musical/host.html, with a
   fake fetch) and the Worker's own cleanInlineSongs, and reads the library and the staging content copy:

     1. the word list: the five titles are rude; Joe Cocker, Russell Dickerson, Sex on Fire, Highway to Hell, Sneaker Pimps are not
     2. THE GATE ON THE LIBRARY: no song SHOWS a word on the list (its displayTitle, else its title, and its artist) unless it is
        "hidden": true. RED today for the five until Dean picks, per song, a display title ("We can change the name displayed if they
        are super popular", 16 Nov) or hidden; a future import is RED the same way until a person chooses
     3. the five are still in the file under their real titles (the clip matches); a hidden song is in no playlist; a display title is clean
     4. THE CONSOLE: its library shows only clean titles: rude and hidden songs are out, so no playlist, search, Surprise Mix, card, phone
        or TV can reach one; a displayTitle brings a song back under that title with its own clip, the real title still indexed
     5. THE WORKER: the same list, word for word; a rude song in an inline playlist is never materialised; a stored playlist deals none
     6. STAGING: the TEST content copy leaves rude songs out of the library playlists, with the same list
     7. older TVs and tablets: the list file is ES5

   Run: jsc tools/test-song-safe.js   (from the repo root) */
var ran = 0, bad = 0;
function show(name, cond, saw) { ran++; if (cond) print('  ok   ' + name); else { bad++; print('  FAIL ' + name + (saw !== undefined ? '   saw: ' + saw : '')); } }
var SRC = readFile('venueplay/app/vp-songsafe.js');
var SS = (new Function('var window = {};\n' + SRC + '\nreturn window.VPSongSafe;'))();
var LIB = JSON.parse(readFile('venueplay/data/musical-library.json'));
var HOST = readFile('venueplay/app/musical/host.html');
var WK = readFile('venueplay-backend/worker/venueplay-game.js');
var CT = readFile('tools/staging/content-tables.txt');
var FIVE = ['smack-my-bitch-up-radio-edit-the-prodigy', 'thot-shit-megan-thee-stallion', 'fuck-it-i-don-t-want-you-back-eamon',
            'sexy-bitch-feat-akon-extended-david-guetta', 'bitch-meredith-brooks'];

print('\n== 1. the word list ==');
var byId = {}; LIB.songs.forEach(function (s) { byId[s.id] = s; });
show('the five titles are rude (Smack My Bitch Up, Thot Shit, Fuck It, Sexy Bitch, Bitch)', FIVE.every(function (i) { return byId[i] && SS.isRude(byId[i].title, byId[i].artist); }),
     FIVE.filter(function (i) { return !(byId[i] && SS.isRude(byId[i].title, byId[i].artist)); }).join(', '));
show('any case, inside a longer title, and in the artist too', SS.isRude('FUCK', '') && SS.isRude('Bad (Shit Remix)', '') && SS.isRude('Song', 'Lil Bitchy') && SS.isRude('f**k you', '') && SS.isRude('Biatch', ''));
var CLEAN = [['Unchain My Heart', 'Joe Cocker'], ['Yours', 'Russell Dickerson'], ['Sex on Fire', 'Kings of Leon'], ['Highway to Hell', 'AC/DC'],
             ['6 Underground', 'Sneaker Pimps'], ['About Damn Time', 'Lizzo'], ['Shiny Happy People', 'R.E.M.'], ['Cocktails', 'x'], ['Scunthorpe', 'x']];
show('whole words only: Joe Cocker, Russell Dickerson, Sex on Fire, Highway to Hell, Sneaker Pimps, Shiny, Cocktails, Scunthorpe are fine',
     CLEAN.every(function (c) { return !SS.isRude(c[0], c[1]); }), CLEAN.filter(function (c) { return SS.isRude(c[0], c[1]); }).join(' / '));
show('nothing, null or a number is not rude and does not throw', !SS.isRude(null, undefined) && !SS.isRude('', '') && !SS.isRude(42, 7));
show('usable(): a hidden song is not usable even with a clean title; a rude one is not usable even unhidden; a normal one is',
     !SS.usable({ title: 'Clean', artist: 'X', hidden: true }) && !SS.usable({ title: 'Bitch', artist: 'Meredith Brooks' }) && SS.usable({ title: 'The Horses', artist: 'Daryl Braithwaite' }) && !SS.usable(null));

print('\n== 2. THE GATE ON THE LIBRARY: nothing rude is SHOWN ==');
var loose = LIB.songs.filter(function (s) { return s.hidden !== true && SS.isRude(SS.shown(s), s.artist); });
show('no song in /data/musical-library.json SHOWS a rude title or artist (' + LIB.songs.length + ' songs scanned). RED UNTIL A PERSON CHOOSES, PER SONG: a "displayTitle" (the title a pub sees) or "hidden": true',
     loose.length === 0, loose.slice(0, 10).map(function (s) { return s.id + ' "' + s.title + '" / ' + s.artist; }).join('; '));

print('\n== 3. the file keeps every song; a hidden one is in no playlist ==');
show('the five are still in the file with their real titles (nothing deleted, the clip still matches)', FIVE.every(function (i) { return byId[i] && SS.isRude(byId[i].title, byId[i].artist); }));
var inPl = []; LIB.playlists.forEach(function (p) { (p.songIds || []).forEach(function (i) { if (byId[i] && byId[i].hidden === true) inPl.push(p.id + ':' + i); }); });
show('a hidden song is in none of the ' + LIB.playlists.length + ' built-in playlists (a playlist never counts a song it cannot play)', inPl.length === 0, inPl.slice(0, 10).join(', '));
show('DEAN\'S CHOICE (16 Nov 2026): three shown under a clean name, two hidden, as he said',
     (byId['bitch-meredith-brooks'] || {}).displayTitle === 'B**** (Meredith Brooks)' && (byId['fuck-it-i-don-t-want-you-back-eamon'] || {}).displayTitle === "F*** It (I Don't Want You Back)" &&
     (byId['sexy-bitch-feat-akon-extended-david-guetta'] || {}).displayTitle === 'Sexy Chick (feat. Akon)' &&
     (byId['smack-my-bitch-up-radio-edit-the-prodigy'] || {}).hidden === true && (byId['thot-shit-megan-thee-stallion'] || {}).hidden === true);
var shownIn = 0; LIB.playlists.forEach(function (p) { (p.songIds || []).forEach(function (i) { if (i === 'bitch-meredith-brooks' || i === 'fuck-it-i-don-t-want-you-back-eamon' || i === 'sexy-bitch-feat-akon-extended-david-guetta') shownIn++; }); });
show('the three renamed songs stay in their playlists (nothing a venue had is taken away)', shownIn === 6, shownIn);
var dt = LIB.songs.filter(function (s) { return typeof s.displayTitle === 'string'; });
show('every displayTitle in the file is a real title (not blank, at most 200 letters) and is itself clean', dt.every(function (s) { return s.displayTitle.trim() && s.displayTitle.length <= 200 && !SS.isRude(s.displayTitle, s.artist); }),
     dt.filter(function (s) { return !(s.displayTitle.trim() && s.displayTitle.length <= 200 && !SS.isRude(s.displayTitle, s.artist)); }).map(function (s) { return s.id; }).join(','));
show('shown(): the displayTitle when set, else the title; a blank displayTitle is ignored', SS.shown({ title: 'Bitch', displayTitle: 'B*tch' }) === 'B*tch' && SS.shown({ title: 'The Horses' }) === 'The Horses' && SS.shown({ title: 'X', displayTitle: '  ' }) === 'X');
show('usable(): a display title clears a rude real title; a hidden song is never usable; a rude shown title is not', SS.usable({ title: 'Bitch', displayTitle: 'B*tch', artist: 'Meredith Brooks' }) && !SS.usable({ title: 'Clean', artist: 'X', hidden: true }) && !SS.usable({ title: 'Bitch', artist: 'Meredith Brooks' }));

print('\n== 4. THE CONSOLE: its library shows only clean titles ==');
function liftFn(src, name) { var at = src.indexOf('\n  function ' + name + '('); if (at < 0) return null; var end = src.indexOf('\n  }\n', at + 1); return src.slice(at + 1, end + 4); }
var LL = liftFn(HOST, 'loadLibrary');
show('the console loads the list file', /<script src="\/app\/vp-songsafe\.js"><\/script>/.test(HOST));
function runLoad(songs, withList) {
  var data = { songs: songs, playlists: LIB.playlists };
  var env = { LIB: {} };
  var fakeFetch = function () { return { then: function (f) { var r = f({ ok: true, json: function () { return data; } }); return { then: function (g) { g(r); return { catch: function () {} }; } }; } }; };
  var f = new Function('fetch', 'window', 'VPSongSafe', 'LIB_URL', 'taKey', 'normTitle', 'env',
    'var LIB = env.LIB, libLoaded = false;\n' + LL + '\nloadLibrary(); return LIB;');
  return f(fakeFetch, withList ? { VPSongSafe: SS } : {}, withList ? SS : undefined, 'x',
           function (t, a) { return String(t).toLowerCase() + '|' + String(a).toLowerCase(); }, function (t) { return String(t).toLowerCase(); }, env);
}
var extra = [{ id: 'new-import', title: 'Shitty Song', artist: 'New Act' }, { id: 'gone', title: 'Clean but hidden', artist: 'X', hidden: true }];
var got = LL ? runLoad(LIB.songs.concat(extra), true) : null;
var leak = got ? got.songs.filter(function (s) { return s.hidden === true || SS.isRude(s.title, s.artist); }) : ['no loadLibrary'];
show('loadLibrary RUN on today\'s library: no song SHOWS a rude title (cards, TV, phones, search, Surprise Mix, All songs read it); every song the list rules out (today the 5) and a hidden one are out',
     got && leak.length === 0 && got.songs.length === LIB.songs.filter(SS.usable).length && FIVE.every(function (i) { return SS.usable(byId[i]) === !!got.byId[i]; }) && !got.byId['gone'], got ? leak.map(function (s) { return s.title; }).join(', ') + ' / ' + got.songs.length : 'not lifted');
show('a new rude import that nobody chose for is left out too ("Shitty Song"), and not findable by title or id', got && !got.byId['new-import'] && !got.byTitle['shitty song'] && FIVE.every(function (i) { return SS.usable(byId[i]) || (!got.byId[i] && !got.byTitle[String(byId[i].title).toLowerCase()]); }));
var named = LIB.songs.map(function (s) { if (s.id !== 'bitch-meredith-brooks') return s; var c = JSON.parse(JSON.stringify(s)); c.displayTitle = 'B*tch'; return c; });
var got3 = LL ? runLoad(named, true) : null, mb = got3 && got3.byId['bitch-meredith-brooks'];
show('a song Dean gives a displayTitle comes back under that title, with its own clip, and the real title kept beside it',
     !!mb && mb.title === 'B*tch' && mb.realTitle === 'Bitch' && mb.previewUrl === byId['bitch-meredith-brooks'].previewUrl, mb ? [mb.title, mb.realTitle].join('/') : 'missing');
show('and the clip is found by the shown title AND by the real one (a game stored before the rename)', !!mb && got3.byTitleArtist['b*tch|meredith brooks'] === mb && got3.byTitleArtist['bitch|meredith brooks'] === mb, got3 ? Object.keys(got3.byTitleArtist).filter(function (k) { return /meredith/.test(k); }).join(',') : '');
show('the file\'s own song object is not changed by the console (the library stays as written)', named.filter(function (s) { return s.id === 'bitch-meredith-brooks'; })[0].title === 'Bitch');
var got2 = LL ? runLoad(LIB.songs.concat(extra), false) : null;
show('without the list file the hidden mark still holds', got2 && !got2.byId['gone']);

print('\n== 5. THE WORKER: same list, nothing rude materialised or dealt ==');
var wm = /const SONG_RUDE_WORDS = "([^"]*)";/.exec(WK);
show('the Worker\'s word list is the site\'s, word for word', !!wm && wm[1] === SS.WORDS, wm ? wm[1].slice(0, 80) : 'missing');
function liftTop(src, name) { var at = src.indexOf('\nfunction ' + name + '('); if (at < 0) return ''; var end = src.indexOf('\n}\n', at + 1); return src.slice(at + 1, end + 3); }
var wfn = (wm ? 'const SONG_RUDE_WORDS = "' + wm[1] + '";\n' : '') + ((/\nconst SONG_RUDE_RX = [^\n]*/.exec(WK) || [''])[0]) + '\n' + liftTop(WK, 'songIsRude') + '\n' + liftTop(WK, 'cleanInlineSongs');
var W = null; try { W = (new Function(wfn + '\nreturn { songIsRude: songIsRude, cleanInlineSongs: cleanInlineSongs };'))(); } catch (e) { W = null; print('  (lift failed: ' + e + ')'); }
var inl = W ? W.cleanInlineSongs([{ title: 'The Horses', artist: 'Daryl Braithwaite' }, { title: 'Smack My Bitch Up', artist: 'The Prodigy' }, { title: 'Fine', artist: 'Bastards United' }, { title: 'Sex on Fire', artist: 'Kings of Leon' }]) : [];
show('cleanInlineSongs RUN: a rude title or artist in an inline playlist is dropped; the clean songs stay, in order', W && inl.map(function (s) { return s.title; }).join('|') === 'The Horses|Sex on Fire', inl.map(function (s) { return s.title; }).join('|'));
show('the deal reads a stored playlist (library or the venue\'s own, not a printed set) through the same filter', /if \(!paperSet\) songs = songs\.filter\(\(r\) => !songIsRude\(r\.title, r\.artist\)\);[^\n]*\n  if \(songs\.length < 24\)/.test(WK));
show('songIsRude in the Worker agrees with the site on every song in the library', W && LIB.songs.every(function (s) { return W.songIsRude(s.title, s.artist) === SS.isRude(s.title, s.artist); }));

print('\n== 6. STAGING: the TEST copy leaves them out ==');
var pg = "'(^|[^a-z])(" + SS.WORDS + ")([^a-z]|$)'";
var line = (CT.split('\n').filter(function (l) { return /^vp_playlist_songs /.test(l); })[0]) || '';
show('the content copy of the library playlists filters title AND artist with the same list', line.indexOf("coalesce(title, '') ~* " + pg) > 0 && line.indexOf("coalesce(artist, '') ~* " + pg) > 0 && /\band not \(/.test(line), line.slice(0, 160));
show('and the list has no "#" (the copy script cuts a line at #)', SS.WORDS.indexOf('#') < 0 && line.indexOf('#') < 0);

print('\n== 7. older TVs and tablets ==');
show('the list file is ES5 (no let, const, arrow functions or template strings) and has no em dash', !/\b(let|const)\s|=>|`/.test(SRC.replace(/\/\*[\s\S]*?\*\//g, '')) && SRC.indexOf('—') < 0);

print('\n' + (bad ? ('FAILED ' + bad + ' of ' + ran) : ('ALL ' + ran + ' CHECKS PASSED')));
if (bad) throw new Error(bad + ' failed');
