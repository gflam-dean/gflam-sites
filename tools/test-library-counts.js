/* The homepage bank counts come from the live library, never typed (Dean, 11 Nov 2026, INBOX 233.1).

   The homepage said "39,392 questions" while the database held 39,412 and "6,740 songs", typed into the page
   and into two data files nobody regenerated. Now:
     the Worker   GET /library-counts (vpbLibraryCountsRoute on tools/rig-billing-worker.js) answers
                  { questions, songs } and nothing else. questions = the rows of vp_questions in LIBRARY sets
                  (visibility library, no owner venue), counted by the database (Prefer: count=exact), so a
                  venue's own questions and its copies of library questions are never counted. songs = the
                  songs a host console can actually play: every distinct song in /data/musical-library.json
                  (the file every musical bingo console loads) that has an https preview clip. A failed half
                  answers null for that half only; public cache for ten minutes, like /trusted-logos.
     the page     the REAL /app/vp-counts.js against a small DOM: a good answer replaces the fallback words
                  once; a failed fetch, a 500, null, NaN, a string, zero, a negative, a fraction or a silly
                  number leaves the fallback ("Thousands"), never blank or NaN.
     the markup   index.html and nsw.html (every /offer-<month> page) carry no typed count: the spans say
                  "Thousands" and are filled by VPCounts; the old count-file readers are gone.

   Run from the repo root:  jsc tools/test-library-counts.js
*/
load('tools/rig-billing-worker.js');
var fails = 0, ran = 0, finished = false;
function check(name, ok, saw) { ran++; if (ok) print('  ok   ' + name); else { print('  FAIL ' + name + (saw === undefined ? '' : '   saw: ' + JSON.stringify(saw).slice(0, 400))); fails++; } }

/* The rig answers GET and writes; a count is a HEAD with Prefer: count=exact and the total in Content-Range,
   as PostgREST does it. And the song library is a file on our own site. Both added here. */
var rigFetch = globalThis.fetch, LIB = null, LIB_STATUS = 200, COUNT_FAIL = false, ASKED = [];
globalThis.fetch = function (url, opts) {
  var u = String(url); opts = opts || {};
  ASKED.push((opts.method || 'GET') + ' ' + u);
  if (/\/data\/musical-library\.json$/.test(u)) {
    return Promise.resolve({ ok: LIB_STATUS === 200, status: LIB_STATUS, json: function () { return Promise.resolve(LIB); } });
  }
  if (opts.method === 'HEAD' && u.indexOf('/rest/v1/vp_questions?') !== -1) {
    if (COUNT_FAIL) return Promise.resolve({ ok: false, status: 503, headers: { get: function () { return ''; } } });
    var prefer = (opts.headers && (opts.headers.Prefer || opts.headers.prefer)) || '';
    var q = parseQ(u.split('?')[1]);
    var rows = tbl('vp_questions').filter(function (r) { return match(r, q); });
    var range = /count=exact/.test(prefer) ? ('0-0/' + rows.length) : '0-0/*';
    return Promise.resolve({ ok: true, status: 200, headers: { get: function (k) { return /content-range/i.test(k) ? range : ''; } } });
  }
  return rigFetch(url, opts);
};

function S(n) { return '50000000-0000-4000-8000-' + ('000000000000' + n).slice(-12); }
function world() {
  DB = {}; FAIL = {}; ASKED = []; COUNT_FAIL = false; LIB_STATUS = 200;
  DB.vp_question_sets = [];
  DB.vp_questions = [];
  // 70 library sets (more than one chunk of ids), 3 questions each = 210 library questions.
  for (var i = 1; i <= 70; i++) {
    DB.vp_question_sets.push({ id: S(i), visibility: 'library', owner_venue_id: null, title: 'Lib ' + i });
    for (var k = 0; k < 3; k++) DB.vp_questions.push({ id: 'q' + i + '-' + k, set_id: S(i), question: 'L' + i + '.' + k });
  }
  // A venue's own set (its own questions and a copy of a library question): never counted.
  DB.vp_question_sets.push({ id: S(900), visibility: 'private', owner_venue_id: 'venue-1', title: 'Our night' });
  for (var j = 0; j < 25; j++) DB.vp_questions.push({ id: 'v' + j, set_id: S(900), question: j === 0 ? 'L1.0' : 'own ' + j, from_library: j === 0 });
  // A set marked library but owned by a venue (migration 169 forbids it; counted out anyway).
  DB.vp_question_sets.push({ id: S(901), visibility: 'library', owner_venue_id: 'venue-2', title: 'Sneaky' });
  DB.vp_questions.push({ id: 'x1', set_id: S(901), question: 'sneaky' });
  var songs = [];
  for (var s = 0; s < 40; s++) songs.push({ id: 'song-' + s, title: 'T' + s, artist: 'A', previewUrl: 'https://audio-ssl.itunes.apple.com/p/' + s + '.m4a' });
  songs.push({ id: 'song-0', title: 'T0', artist: 'A', previewUrl: 'https://audio-ssl.itunes.apple.com/p/0.m4a' });   // listed twice
  songs.push({ id: 'no-clip', title: 'N', artist: 'A' });                                                          // no clip
  songs.push({ id: 'plain-http', title: 'H', artist: 'A', previewUrl: 'http://example.com/h.m4a' });               // not https
  songs.push({ id: 'empty-clip', title: 'E', artist: 'A', previewUrl: '' });
  songs.push({ id: 'hidden-song', title: 'Rude Title', artist: 'A', previewUrl: 'https://audio-ssl.itunes.apple.com/p/h.m4a', hidden: true });   // hidden (vp-songsafe.js): no console plays it
  LIB = { version: 2, songs: songs, playlists: [{ id: 'p1', name: 'P', songIds: ['song-1'] }] };
}

(async function () {
  print('the Worker: GET /library-counts');
  world();
  var r = await vpbLibraryCountsRoute(ENV, J);
  check('200 with both counts', r.status === 200 && r.body && r.body.questions === 210 && r.body.songs === 40, r.body);
  check('it answers questions and songs and NOTHING else (no row data, no set names)', JSON.stringify(Object.keys(r.body).sort()) === '["questions","songs"]', r.body);
  check('a venue\'s own questions and its copies of library questions are not counted', r.body.questions === 210, r.body.questions);
  var heads = ASKED.filter(function (a) { return a.indexOf('HEAD ') === 0; });
  check('the questions are counted BY THE DATABASE (HEAD with count=exact), never by reading 39,000 rows',
        heads.length >= 2 && ASKED.filter(function (a) { return /^GET .*\/rest\/v1\/vp_questions/.test(a); }).length === 0, ASKED.slice(0, 6));
  check('the sets counted are library sets with no owner venue', ASKED.some(function (a) { return /^GET .*vp_question_sets\?visibility=eq\.library&owner_venue_id=is\.null/.test(a); }), ASKED.slice(0, 3));
  check('the songs are read from the library file every musical bingo console plays from', ASKED.some(function (a) { return a === 'GET https://www.venueplay.com.au/data/musical-library.json'; }), ASKED);
  check('a song listed twice counts once, a song with no clip or a non-https clip does not count', r.body.songs === 40, r.body.songs);
  check('a HIDDEN song (rude title, 16 Nov 2026) is not counted: no console can play it (Jobs 526)', r.body.songs === 40, r.body.songs);

  /* JOBS 526 (real night 20 Nov 2026): the homepage said 6,740 songs and the musical console's "All songs" said 6,738.
     ONE NUMBER: this count, run over the REAL /data/musical-library.json, against the musical console's REAL
     loadLibrary() (lifted out of venueplay/app/musical/host.html, with the real /app/vp-songsafe.js) over the same
     file. "All songs" on the console is LIB.songs.length (fillPlaylists). */
  print('the Worker: the homepage count is the console\'s "All songs" count, on the real library');
  var REAL = JSON.parse(readFile('venueplay/data/musical-library.json'));
  world(); LIB = REAL;
  r = await vpbLibraryCountsRoute(ENV, J);
  var MH = readFile('venueplay/app/musical/host.html');
  var mi = MH.indexOf('function loadLibrary(){'), md = 0, mk = MH.indexOf('{', mi);
  do { if (MH[mk] === '{') md++; else if (MH[mk] === '}') md--; mk++; } while (md > 0 && mk < MH.length);
  var consoleWin = {};
  (new Function('window', readFile('venueplay/app/vp-songsafe.js')))(consoleWin);
  var CL = (new Function('window', 'VPSongSafe', 'fetch',
    'var LIB={ songs:[], byId:{}, byTitle:{}, playlists:[], plById:{} }, libLoaded=false, LIB_URL="x";' +
    'function normTitle(t){ return (t==null?"":String(t)).trim().toLowerCase(); } function taKey(a,b){ return normTitle(a)+"|"+normTitle(b); }' +
    MH.slice(mi, mk) + '; return { load: loadLibrary, lib: function(){ return LIB; } };'))(consoleWin, consoleWin.VPSongSafe, function () {
      return Promise.resolve({ ok: true, json: function () { return Promise.resolve(REAL); } }); });
  check('the console\'s own loadLibrary() was found and lifted', mi > 0 && typeof CL.load === 'function');
  await CL.load();
  var consoleAll = CL.lib().songs.length;
  check('the homepage\'s song count is the musical console\'s "All songs" count, on the real library (Jobs 526: 6,740 vs 6,738)',
        typeof r.body.songs === 'number' && r.body.songs === consoleAll, { homepage: r.body.songs, console: consoleAll });
  check('and the real library has hidden songs, so this check can tell the two rules apart', REAL.songs.some(function (x) { return x && x.hidden === true; }));
  var src = readFile('venueplay-backend/worker/venueplay-api-FULL.js');
  check('the dispatcher answers GET /library-counts with no login',
        src.indexOf("if (request.method === 'GET' && path === '/library-counts') return await vpbLibraryCountsRoute(env, json);") !== -1);
  var routeSrc = src.slice(src.indexOf('async function vpbLibraryCountsRoute('), src.indexOf('async function vpbLibraryCountsRoute(') + 1600);
  check('a public cache of ten minutes, the same as /trusted-logos', routeSrc.indexOf("'public, max-age=600'") !== -1, routeSrc.slice(0, 200));

  print('the Worker: when a half fails');
  world(); COUNT_FAIL = true;
  r = await vpbLibraryCountsRoute(ENV, J);
  check('the question count fails: questions is null, songs still answered, still 200', r.status === 200 && r.body.questions === null && r.body.songs === 40, r.body);
  world(); LIB_STATUS = 404;
  r = await vpbLibraryCountsRoute(ENV, J);
  check('the song library cannot be read: songs is null, questions still answered', r.status === 200 && r.body.songs === null && r.body.questions === 210, r.body);
  world(); LIB = { songs: 'not a list' };
  r = await vpbLibraryCountsRoute(ENV, J);
  check('a song library that is not a list: songs is null, never 0', r.body.songs === null, r.body);
  world(); FAIL['vp_question_sets:GET'] = 1;
  r = await vpbLibraryCountsRoute(ENV, J);
  check('the library sets cannot be read: questions is null, never 0 or a partial count', r.body.questions === null, r.body);
  world(); DB.vp_question_sets = [];
  r = await vpbLibraryCountsRoute(ENV, J);
  check('no library sets at all: questions is null (the page keeps its words), never 0', r.body.questions === null, r.body);
  world(); DB.vp_questions = DB.vp_questions.filter(function (q) { return q.set_id === S(900); });
  r = await vpbLibraryCountsRoute(ENV, J);
  check('library sets with no questions in them: questions is null, never 0', r.body.questions === null, r.body);
  world(); LIB = { songs: [{ id: 'no-clip', title: 'N', artist: 'A' }] };
  r = await vpbLibraryCountsRoute(ENV, J);
  check('a song library where nothing has a clip: songs is null, never 0', r.body.songs === null, r.body);

  print('the page: /app/vp-counts.js');
  function node(key, text) { return { key: key, textContent: text, getAttribute: function (k) { return k === 'data-vp-count' ? this.key : null; } }; }
  var els;
  function fresh() { els = [node('questions', 'Thousands'), node('songs', 'Thousands'), node('questions', 'Thousands')]; }
  fresh();
  var window = { fetch: null };
  var document = { querySelectorAll: function (sel) { return sel === '[data-vp-count]' ? els : []; } };
  var helper = readFile('venueplay/app/vp-counts.js');
  (new Function('window', 'document', helper))(window, document);
  var C = window.VPCounts;
  check('it loads', !!C && typeof C.load === 'function');
  var asked = '';
  window.fetch = function (u) { asked = u; return Promise.resolve({ ok: true, json: function () { return Promise.resolve({ questions: 39412, songs: 6740 }); } }); };
  var shown = await C.load('https://venueplay-api.example/');
  check('load() asks the Worker\'s /library-counts', asked === 'https://venueplay-api.example/library-counts', asked);
  check('every questions element shows 39,412 and the songs one 6,740, in Australian format',
        shown === 3 && els[0].textContent === '39,412' && els[2].textContent === '39,412' && els[1].textContent === '6,740', els.map(function (e) { return e.textContent; }));
  var bads = [
    ['the fetch fails', function () { return Promise.reject(new Error('offline')); }],
    ['the Worker answers 500 (with a body that looks like counts)', function () { return Promise.resolve({ ok: false, status: 500, json: function () { return Promise.resolve({ questions: 39412, songs: 6740 }); } }); }],
    ['the answer is not JSON', function () { return Promise.resolve({ ok: true, json: function () { return Promise.reject(new Error('bad json')); } }); }],
    ['both counts are null', function () { return Promise.resolve({ ok: true, json: function () { return Promise.resolve({ questions: null, songs: null }); } }); }],
    ['the counts are NaN', function () { return Promise.resolve({ ok: true, json: function () { return Promise.resolve({ questions: NaN, songs: NaN }); } }); }],
    ['the counts are strings', function () { return Promise.resolve({ ok: true, json: function () { return Promise.resolve({ questions: '39412', songs: 'lots' }); } }); }],
    ['the counts are zero', function () { return Promise.resolve({ ok: true, json: function () { return Promise.resolve({ questions: 0, songs: 0 }); } }); }],
    ['the counts are negative or fractions', function () { return Promise.resolve({ ok: true, json: function () { return Promise.resolve({ questions: -4, songs: 12.5 }); } }); }],
    ['the counts are absurd', function () { return Promise.resolve({ ok: true, json: function () { return Promise.resolve({ questions: 1e12, songs: Infinity }); } }); }],
    ['the counts are under a thousand (the test database holds 10 questions; a library that lost its sets)', function () { return Promise.resolve({ ok: true, json: function () { return Promise.resolve({ questions: 10, songs: 999 }); } }); }],
    ['the answer is null', function () { return Promise.resolve({ ok: true, json: function () { return Promise.resolve(null); } }); }]
  ];
  for (var b = 0; b < bads.length; b++) {
    fresh(); window.fetch = bads[b][1];
    shown = await C.load('https://venueplay-api.example');
    check(bads[b][0] + ': the fallback words stay, never blank or NaN',
          shown === 0 && els.every(function (e) { return e.textContent === 'Thousands'; }), els.map(function (e) { return e.textContent; }));
  }
  fresh(); window.fetch = function () { return Promise.resolve({ ok: true, json: function () { return Promise.resolve({ questions: 1000, songs: 6740 }); } }); };
  shown = await C.load('https://venueplay-api.example');
  check('exactly 1,000 is a count and is shown', shown === 3 && els[0].textContent === '1,000' && els[1].textContent === '6,740', els.map(function (e) { return e.textContent; }));
  fresh(); window.fetch = function () { return Promise.resolve({ ok: true, json: function () { return Promise.resolve({ questions: 39412, songs: null }); } }); };
  shown = await C.load('https://venueplay-api.example');
  check('one half good, one half null: the good one is shown, the other keeps its words',
        shown === 2 && els[0].textContent === '39,412' && els[1].textContent === 'Thousands', els.map(function (e) { return e.textContent; }));
  check('nothing from the answer is written as HTML', helper.indexOf('innerHTML') === -1);

  print('both sales pages use it, and type no count');
  ['venueplay/index.html', 'venueplay/nsw.html'].forEach(function (p) {
    var h = readFile(p);
    check(p + ': the questions count is a "Thousands" fallback filled live', h.indexOf('<span id="vp-trivia-count" data-vp-count="questions">Thousands</span>') !== -1);
    check(p + ': the songs count is a "Thousands" fallback filled live', h.indexOf('<span id="vp-music-count" data-vp-count="songs">Thousands</span>') !== -1);
    check(p + ' loads /app/vp-counts.js and asks the Worker through it',
          h.indexOf('<script src="/app/vp-counts.js"></script>') !== -1 && h.indexOf('if (workerReady && window.VPCounts) VPCounts.load(VP_WORKER);') !== -1);
    check(p + ' no longer reads the typed count files', h.indexOf('/data/trivia-count.json') === -1 && h.indexOf('/data/music-count.json') === -1);
    var noScript = h.replace(/<script[\s\S]*?<\/script>/g, ' ');
    var typed = noScript.match(/\b\d{1,3},\d{3}\+?\s*(trivia\s+)?(questions|songs)\b|\bover \d{1,3},\d{3} questions/gi) || [];
    var ld = (h.match(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g) || []).join(' ');
    var ldTyped = ld.match(/\d{1,3},\d{3}\+? (trivia )?(questions|songs)/gi) || [];
    check(p + ': no question or song count is typed anywhere in the page, its structured data included', typed.length === 0 && ldTyped.length === 0, typed.concat(ldTyped));
  });
  finished = true;
})().catch(function (e) { fails++; print('  FAIL threw: ' + (e && e.stack || e)); });

drainMicrotasks();
if (!finished) { fails++; print('  FAIL the suite did not finish'); }
print('');
print(fails ? (fails + ' FAILED, ' + ran + ' run') : ('ALL ' + ran + ' CHECKS PASSED'));
if (fails) throw new Error(fails + ' failed');
