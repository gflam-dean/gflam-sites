/* PAPER MUSICAL CARDS V2, RUN, not read. Dean's GO, 12 Nov 2026 (INBOX 335, 340, 342, 345): a signed code on every printed card
   so the host's camera checks a win, squares worked out from the card set (a reprint is the same card), the bracket rule on
   paper, the printed date, never two same-looking titles on one card, and a set that is binned is remembered so an old card
   scanned later is told "bin it".

   Drives the REAL shipped Worker (venueplay-game.js) through tools/rig-game-worker.js: the hash and HMAC against published
   test vectors, the code (made, parsed, forged), the bracket rule, the deal, a print, a reprint, a replaced set, and every
   answer the scan gives: win, not yet, no game running, wrong playlist, replaced, another night, another venue, not a card,
   and the cross-check refusing a card whose stored squares differ from the worked-out ones.

   Run: jsc tools/test-paper-cards-v2.js   (from the repo root) */
load('tools/rig-game-worker.js');

var SESSION = '33333333-3333-4333-8333-333333333333';
var SESSION_OLD = '55555555-5555-4555-8555-555555555555';
var OTHER_VENUE = '66666666-6666-4666-8666-666666666666';
function hex(a){ return a.map(function(b){ return ('0' + b.toString(16)).slice(-2); }).join(''); }
function bytes(s){ return pvUtf8(s); }
function songs(n, tag){ var a=[]; for(var i=1;i<=n;i++) a.push({ title:(tag||'Song')+' '+i, artist:'Band '+i }); return a; }
function reset(){
  DB = { vp_sessions:[{ id:SESSION, venue_id:VENUE, join_code:'ABCDEF', status:'lobby', plan_cap_at_start:0, paper:null }],
         vp_venues:[{ id:VENUE, name:'The Mini Bar', slug:'the-mini-bar', timezone:'Australia/Brisbane', status:'active', created_at:'2026-01-01T00:00:00Z' }],
         vp_players:[], vp_games:[], vp_cards:[], vp_claims:[], vp_music_games:[], vp_music_plays:[],
         vp_playlists:[], vp_playlist_songs:[], vp_admin_audit:[], vp_venue_settings:[], vp_bingo_games:[] };
}
venueInFreeMonth = async function(){ return false; };
checkWeeklyFormatLimit = async function(){ return null; };
stampWeeklyFormat = async function(){};
async function call(fn, body){ BODY = body; try { return await fn({ url:'https://x.test/card/resolve?code=' + encodeURIComponent((body && body.code) || '') }, ENV, json); } catch(e){ return { status: e.status || 500, body: { error: String(e.message || e) } }; } }
function sess(){ return DB.vp_sessions[0]; }
/* The rig's fake PostgREST has no jsonb path filters. The one Worker query that needs one (find a card set across nights) is
   answered here, by scanning paper.sets the way Postgres would. */
var _rigFetch = fetch;
fetch = async function(url, opts){
  var m = /\/rest\/v1\/vp_sessions\?paper->sets->>([0-9A-Z]{6})=not\.is\.null/.exec(String(url));
  if (m) return resp(200, (DB.vp_sessions || []).filter(function(r){ return r.paper && r.paper.sets && r.paper.sets[m[1]]; }));
  return _rigFetch(url, opts);
};

(async function(){
  print('\nthe hash and the HMAC are the real ones (published test vectors)');
  show('SHA-256 of "abc"', hex(pvSha256(bytes('abc'))) === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  show('SHA-256 of nothing', hex(pvSha256([])) === 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  show('SHA-256 across a block boundary (56 bytes)', hex(pvSha256(bytes('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'))) === '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
  var k20 = []; for (var i = 0; i < 20; i++) k20.push(0x0b);
  show('HMAC-SHA256, RFC 4231 test case 1', hex(pvHmac(k20, bytes('Hi There'))) === 'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7');
  var k131 = []; for (i = 0; i < 131; i++) k131.push(0xaa);
  show('HMAC-SHA256 with a key longer than a block, RFC 4231 test case 6', hex(pvHmac(k131, bytes('Test Using Larger Than Block-Size Key - Hash Key First'))) === '60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54');

  print('\nthe code');
  var KEY = pvKey({ PAPER_CARD_KEY:'unit-test-key' }), KEY2 = pvKey({ PAPER_CARD_KEY:'another-key' });
  var code = pvMakeCode(KEY, 'K7Q2MX', 7, 'PC4F');
  show('21 characters: version, set, card number, playlist tag, seal', code.length === 21 && code.slice(0, 13) === '1K7Q2MX07PC4F', code);
  var p = pvParseCode(pvCodeUrl(code));
  show('the scanned address parses back to its parts', p && p.set === 'K7Q2MX' && p.no === 7 && p.tag === 'PC4F' && pvCodeOk(KEY, p));
  show('lower case, spaces and a trailing query still parse (a phone camera or a typed copy)', !!pvParseCode(' https://venueplay.com.au/c/' + code.toLowerCase() + '?utm=1 ') && pvCodeOk(KEY, pvParseCode(code.toLowerCase())));
  show('the code printed in the QR is capitals only, so it is the small QR mode', /^[0-9A-Z:\/.]+$/.test(pvCodeUrl(code)));
  var forged = code.slice(0, 7) + '03' + code.slice(9);   // card 07 edited to card 03
  show('an edited card number fails the seal', !pvCodeOk(KEY, pvParseCode(forged)));
  show('a different set fails the seal', !pvCodeOk(KEY, pvParseCode('1K7Q2MY' + code.slice(7))));
  show('a changed seal character fails', !pvCodeOk(KEY, pvParseCode(code.slice(0, 20) + (code[20] === '0' ? '1' : '0'))));
  show('the seal belongs to our key: another key does not accept it', !pvCodeOk(KEY2, pvParseCode(code)));
  show('with no key at all nothing is accepted', !pvCodeOk(null, pvParseCode(code)));
  show('a join link, a number and rubbish are not cards', pvParseCode('https://venueplay.com.au/play?venue=the-mini-bar') === null && pvParseCode('07') === null && pvParseCode('') === null && pvParseCode(null) === null);
  show('card 0 and a wrong version are not cards', pvParseCode('1K7Q2MX00PC4F' + code.slice(13)) === null && pvParseCode('2' + code.slice(1)) === null);

  print('\nthe bracket rule (Dean yes, 12 Nov, INBOX 342)');
  show('a trailing bracket is dropped', paperPrintTitle('Bad Case of Loving You (Doctor, Doctor)') === 'Bad Case of Loving You');
  show('a bracket mid-title is dropped and the gap closed', paperPrintTitle('Ever Fallen in Love (with Someone You Shouldn\'t\'ve) Live') === 'Ever Fallen in Love Live');
  show('square brackets go too', paperPrintTitle('Hurt [Remastered 2009]') === 'Hurt');
  show('a title with no brackets is untouched', paperPrintTitle('Wonderwall') === 'Wonderwall');
  show('a bracket at the front goes: (I Can\'t Get No) Satisfaction prints Satisfaction', paperPrintTitle('(I Can\'t Get No) Satisfaction') === 'Satisfaction');
  show('a title that is ONLY a bracket keeps its words (never a blank square)', paperPrintTitle('(Untitled)') === '(Untitled)');
  var withBr = [{ id:'zz', title:'Hurt (Live)', artist:'x' }].concat(songs(40).map(function(s2, n){ s2.id = 'id' + ('0' + n).slice(-2); return s2; }));
  show('the card keeps the FULL title for the phone and TV; only the printed text is shortened', pvDealCard(KEY, 'K7Q2MX', 1, withBr.slice(0, 24).concat([])).filter(function(c){ return c && c.title === 'Hurt (Live)'; }).length === 1);

  print('\nthe deal: same card every time, and nothing that prints the same twice');
  var pool = songs(60).map(function(s, i){ s.id = '00000000-0000-4000-8000-0000000000' + ('0' + i).slice(-2); return s; });
  var c1 = pvDealCard(KEY, 'K7Q2MX', 1, pool), c1b = pvDealCard(KEY, 'K7Q2MX', 1, pool.slice().reverse()), c2 = pvDealCard(KEY, 'K7Q2MX', 2, pool);
  show('25 squares, FREE in the middle, 24 different songs', c1.length === 25 && c1[12] === 0 && new Set(c1.filter(function(x){ return x; }).map(function(x){ return x.song_id; })).size === 24);
  show('the same set and number give the same card, whatever order the playlist came back in', pvSameCells(c1, c1b));
  show('card 2 is a different card', !pvSameCells(c1, c2));
  show('another set gives other cards for the same number', !pvSameCells(c1, pvDealCard(KEY, 'K7Q2MY', 1, pool)));
  show('another key gives other cards (the squares depend on the secret)', !pvSameCells(c1, pvDealCard(KEY2, 'K7Q2MX', 1, pool)));
  var clash = pool.slice(0, 40); clash[0] = { id:'00000000-0000-4000-8000-000000000A00', title:'Bad Company', artist:'Bad Company' };
  clash[1] = { id:'00000000-0000-4000-8000-000000000A01', title:'Bad Company (LMS Studio Reel 2-73 Session)', artist:'Bad Company' };
  var clashOk = true;
  for (var no = 1; no <= 30; no++) {
    var cc = pvDealCard(KEY, 'CLASH0', no, clash).filter(function(x){ return x; });
    var keys = cc.map(function(x){ return paperPrintTitle(x.title).toLowerCase(); });
    if (new Set(keys).size !== keys.length) clashOk = false;
  }
  show('"Bad Company" and its bracketed session version are never on the same card (30 cards tried)', clashOk);
  show('30 cards from a playlist whose same-looking titles leave fewer than 24 are refused, not dealt short', pvDealCard(KEY, 'K7Q2MX', 1, songs(30).map(function(s, i){ s.title = 'Same (v' + i + ')'; s.id = 'i' + i; return s; })) === null);

  print('\nprinting: a set, a code on every card, the date, the bracket rule');
  reset();
  var PL = songs(60); PL[0] = { title:'Bad Case of Loving You (Doctor, Doctor)', artist:'Robert Palmer' };
  var r = await call(handlePaperPrint, { session_id:SESSION, kind:'musical', count:4, playlist:{ name:'Pub Classics', songs:PL } });
  show('four cards print with a set code', r.status === 200 && r.body.cards.length === 4 && /^[0-9A-Z]{6}$/.test(r.body.set) && r.body.coded === true, JSON.stringify(r.body).slice(0, 140));
  var pk = pvKey(ENV);
  show('every card carries its own signed code, and the seal is ours', r.body.cards.every(function(c, i){ var q = pvParseCode(c.code); return q && q.no === i + 1 && q.set === r.body.set && pvCodeOk(pk, q); }));
  show('the code in the QR is the capitals address', /^HTTPS:\/\/VENUEPLAY\.COM\.AU\/C\/[0-9A-Z]{21}$/.test(r.body.cards[0].code), r.body.cards[0].code);
  show('every code is different', new Set(r.body.cards.map(function(c){ return c.code; })).size === 4);
  show('the printed date is the day the venue printed, "Mon 16 Nov" style', /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d{1,2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)$/.test(r.body.printed_label) && r.body.printed_on === paperToday('Australia/Brisbane'), r.body.printed_label);
  show('paperDateLabel is exact: 2026-11-16 is Mon 16 Nov, 2026-11-05 is Thu 5 Nov', paperDateLabel('2026-11-16') === 'Mon 16 Nov' && paperDateLabel('2026-11-05') === 'Thu 5 Nov');
  show('no title with a bracket is sent to the printer', r.body.cards.every(function(c){ return c.titles.every(function(t){ return !/[()\[\]]/.test(t); }); }));
  show('the stored squares keep the full title', JSON.stringify(sess().paper.musical.cards).indexOf('Doctor, Doctor') >= 0 || JSON.stringify(sess().paper.musical.cards).indexOf('Bad Case') < 0);
  show('the set is on the night with its playlist tag and frozen-list digest', sess().paper.musical.set === r.body.set && sess().paper.musical.tag === pvTag('Pub Classics') && !!sess().paper.musical.digest && !!sess().paper.sets[r.body.set]);
  show('a pattern is NOT in what comes back to print', JSON.stringify(r.body).toLowerCase().indexOf('pattern') < 0);
  var SET1 = r.body.set, firstCodes = r.body.cards.map(function(c){ return c.code; }), firstCells = JSON.stringify(sess().paper.musical.cards);
  r = await call(handlePaperPrint, { session_id:SESSION, kind:'musical', count:6, playlist:{ name:'Pub Classics', songs:songs(60, 'Other') } });
  show('printing again from the same playlist: same set, the first four cards identical, two added', r.body.set === SET1 && r.body.cards.length === 6 && r.body.cards.slice(0, 4).every(function(c, i){ return c.code === firstCodes[i]; }) && JSON.stringify(sess().paper.musical.cards.slice(0, 4)) === JSON.stringify(JSON.parse(firstCells)));
  show('the worked-out squares equal the stored squares for every card', sess().paper.musical.cards.every(function(c){ var songsRows = DB.vp_playlist_songs.filter(function(s){ return s.playlist_id === sess().paper.musical.playlist_id; }); return pvSameCells(pvDealCard(pk, SET1, c.no, songsRows), c.cells); }));

  print('\na different playlist before any game replaces the set, and the old cards are remembered as binned');
  r = await call(handlePaperPrint, { session_id:SESSION, kind:'musical', count:3, playlist:{ name:'80s Night', songs:songs(60, 'Eighties') } });
  var SET2 = r.body.set;
  show('a new set, flagged replaced', r.body.replaced === true && SET2 !== SET1 && r.body.playlist_name === '80s Night');
  show('the old set is kept on the night with a replaced time', !!sess().paper.sets[SET1] && !!sess().paper.sets[SET1].replaced_at && !sess().paper.sets[SET2].replaced_at);

  print('\nthe scan');
  var GAME;
  r = await call(handleHostGame, { session_id:SESSION, format:'musical', pattern:'one', prize:'Meat tray', paper_count:0, playlist:{ name:'80s Night', songs:songs(60, 'Eighties') } });
  GAME = r.body.game_id;
  show('CONTROL: a game starts and plays the printed playlist', r.status === 200 && r.body.from_paper === true, JSON.stringify(r.body).slice(0, 120));
  var cur = sess().paper.musical, pk2 = pvKey(ENV);
  function codeFor(set, no, tag){ return pvCodeUrl(pvMakeCode(pk2, set, no, tag)); }
  r = await call(handlePaperScan, { game_id:GAME, code: codeFor(SET2, 1, cur.tag) });
  show('a tonight card with no songs played is NOT yet, with the closest line', r.status === 200 && r.body.state === 'notyet' && r.body.card_no === 1 && r.body.to_go === 4 && /Row \d across/.test(r.body.closest) && r.body.still_to_play.length === 4, JSON.stringify(r.body).slice(0, 200));
  show('the not-yet answer names the playlist and the printed date, and adds no claim', r.body.playlist_name === '80s Night' && !!r.body.printed_label && DB.vp_claims.length === 0);
  show('scanning made the card a player (checked = played), once', DB.vp_players.filter(function(x){ return x.device_id === 'paper-m-1'; }).length === 1);
  await call(handlePaperScan, { game_id:GAME, code: codeFor(SET2, 1, cur.tag) });
  show('scanning the same card twice adds nobody', DB.vp_players.filter(function(x){ return x.device_id === 'paper-m-1'; }).length === 1);
  var cells1 = cur.cards[0].cells;
  for (var q = 0; q < 4; q++) DB.vp_music_plays.push({ game_id:GAME, song_id:cells1[q].song_id, played_at:'2026-11-16T09:3' + q + ':00Z', seq:q + 1 });
  r = await call(handlePaperScan, { game_id:GAME, code: codeFor(SET2, 1, cur.tag) });
  show('one song to go on row 1: not yet, "one song to go", the missing song named', r.body.state === 'notyet' && r.body.to_go === 1 && r.body.closest === 'Row 1 across' && r.body.still_to_play.length === 1 && r.body.still_to_play[0] === paperPrintTitle(cells1[4].title), JSON.stringify(r.body).slice(0, 200));
  DB.vp_music_plays.push({ game_id:GAME, song_id:cells1[4].song_id, played_at:'2026-11-16T09:40:00Z', seq:5 });
  r = await call(handlePaperScan, { game_id:GAME, code: codeFor(SET2, 1, cur.tag) });
  show('row 1 played: a WIN, the claim is in the list as on a phone', r.body.state === 'win' && !!r.body.claim_id && DB.vp_claims.length === 1 && DB.vp_claims[0].status === 'pending', JSON.stringify(r.body).slice(0, 200));
  show('the win shows the winning squares and the songs in the order they were played', r.body.winning_cells.join() === '0,1,2,3,4' && r.body.win_songs.map(function(s){ return s.n; }).join() === '1,2,3,4,5' && r.body.win_songs[0].title === paperPrintTitle(cells1[0].title));
  show('the win carries the map of played squares for the host screen', r.body.played_cells.length === 5 && r.body.cell_titles.length === 25 && r.body.cell_titles[12] === '');
  var claimId = r.body.claim_id;
  r = await call(handlePaperScan, { game_id:GAME, code: codeFor(SET2, 1, cur.tag) });
  show('scanning the winner twice is ONE claim', r.body.claim_id === claimId && DB.vp_claims.length === 1);

  r = await call(handlePaperScan, { game_id:GAME, code: codeFor(SET1, 2, pvTag('Pub Classics')) });
  show('a card from the REPLACED set: "bin them", with the playlist and when', r.body.state === 'replaced' && r.body.playlist_name === 'Pub Classics' && r.body.tonight_playlist === '80s Night' && !!r.body.replaced_at, JSON.stringify(r.body).slice(0, 220));
  show('a replaced card is never judged: no new player, no claim', DB.vp_claims.length === 1 && !DB.vp_players.some(function(x){ return x.device_id === 'paper-m-2'; }));

  // another night at this venue: an older session with its own set
  var OLDSET = 'ZZ9ABC';
  DB.vp_sessions.push({ id:SESSION_OLD, venue_id:VENUE, status:'finished', paper:{ sets:(function(){ var o = {}; o[OLDSET] = { name:'Pub Classics', tag:'PC4F', on:'2026-11-05', at:'2026-11-05T08:00:00Z' }; return o; })() } });
  r = await call(handlePaperScan, { game_id:GAME, code: codeFor(OLDSET, 7, 'PC4F') });
  show('a card from last week: another night, with its printed date and tonight\'s playlist', r.body.state === 'other_night' && r.body.printed_label === 'Thu 5 Nov' && r.body.playlist_name === 'Pub Classics' && r.body.tonight_playlist === '80s Night', JSON.stringify(r.body).slice(0, 220));
  var FARSET = 'FAR2ET';
  DB.vp_sessions.push({ id:'77777777-7777-4777-8777-777777777777', venue_id:OTHER_VENUE, status:'finished', paper:{ sets:(function(){ var o = {}; o[FARSET] = { name:'Pub Classics', tag:'PC4F', on:'2026-11-05', at:'x' }; return o; })() } });
  r = await call(handlePaperScan, { game_id:GAME, code: codeFor(FARSET, 3, 'PC4F') });
  show('a card from another venue is said to be from another venue', r.body.state === 'other_venue', JSON.stringify(r.body));
  r = await call(handlePaperScan, { game_id:GAME, code: codeFor('NOSUCH', 3, 'PC4F') });
  show('a genuine code for a set nobody printed is not a card', r.body.state === 'not_card');
  r = await call(handlePaperScan, { game_id:GAME, code: 'https://venueplay.com.au/play?venue=the-mini-bar' });
  show('a join QR scanned by mistake is not a card', r.body.state === 'not_card');
  r = await call(handlePaperScan, { game_id:GAME, code: pvCodeUrl(code) });
  show('a code signed with another key (a forgery) is not a card', r.body.state === 'not_card');
  r = await call(handlePaperScan, { game_id:GAME, code: codeFor(SET2, 9, cur.tag) });
  show('a real seal on a card number that was never printed is not a card', r.body.state === 'not_card');
  r = await call(handlePaperScan, { game_id:GAME, code: codeFor(SET2, 2, 'ZZZZ') });
  show('a card whose playlist tag is not the set\'s is not a card', r.body.state === 'not_card');

  // no game running
  r = await call(handlePaperScan, { session_id:SESSION, code: codeFor(SET2, 2, cur.tag) });
  show('no game running yet: tonight\'s card is recognised and told to start the game, nothing judged', r.body.state === 'no_game' && r.body.card_no === 2 && r.body.playlist_name === '80s Night', JSON.stringify(r.body).slice(0, 160));
  DB.vp_games.filter(function(g){ return g.id === GAME; })[0].status = 'finished';
  r = await call(handlePaperScan, { game_id:GAME, code: codeFor(SET2, 2, cur.tag) });
  show('a finished game is the same: nothing running to check against', r.body.state === 'no_game');
  DB.vp_games.filter(function(g){ return g.id === GAME; })[0].status = 'running';

  // the game on another playlist than the cards
  var g = DB.vp_games.filter(function(x){ return x.id === GAME; })[0], keepPl = g.config.playlist_id;
  g.config.playlist_id = '88888888-8888-4888-8888-888888888888';
  r = await call(handlePaperScan, { game_id:GAME, code: codeFor(SET2, 2, cur.tag) });
  show('a game playing other songs than the cards: WRONG PLAYLIST, never a yes', r.body.state === 'wrong_playlist' && DB.vp_claims.length === 1, JSON.stringify(r.body).slice(0, 160));
  r = await call(handlePaperCheck, { game_id:GAME, card_no:2 });
  show('the typed number is refused the same way', r.status === 409 && /not playing the songs on your printed cards/.test(r.body.error), JSON.stringify(r.body));
  g.config.playlist_id = keepPl;

  // the cross-check
  var saved = JSON.stringify(sess().paper.musical.cards[1].cells);
  sess().paper.musical.cards[1].cells[0] = sess().paper.musical.cards[1].cells[1];
  r = await call(handlePaperScan, { game_id:GAME, code: codeFor(SET2, 2, cur.tag) });
  show('stored squares that differ from the worked-out ones: refused, never judged', r.status === 409 && r.body.state === 'mismatch' && DB.vp_claims.length === 1, JSON.stringify(r.body));
  show('...and HQ is told', DB.vp_admin_audit.some(function(a){ return a.action === 'paper_card_mismatch' && a.detail.card_no === 2; }));
  sess().paper.musical.cards[1].cells = JSON.parse(saved);

  print('\nwho may scan');
  var realReq = requireStaff;
  requireStaff = async function(){ var e = new Error('You are not staff at this venue'); e.status = 403; throw e; };
  r = await call(handlePaperScan, { game_id:GAME, code: codeFor(SET2, 2, cur.tag) });
  show('someone who is not staff at the venue is refused', r.status === 403);
  requireStaff = realReq;
  var saveKey = { a: ENV.SUPABASE_SERVICE_KEY }; delete ENV.SUPABASE_SERVICE_KEY;
  r = await call(handlePaperScan, { game_id:GAME, code: codeFor(SET2, 2, cur.tag) });
  show('with no key on the Worker, the scan says so (503) instead of guessing', r.status === 503);
  ENV.SUPABASE_SERVICE_KEY = saveKey.a;

  print('\nthe lock: once a game has been played off the cards, the set cannot be swapped');
  r = await call(handlePaperPrint, { session_id:SESSION, kind:'musical', count:3, playlist:{ name:'Surprise Mix', songs:songs(60, 'Surprise') } });
  show('printing from another playlist after a game is KEPT as the printed set, never replaced', r.body.kept === true && r.body.playlist_name === '80s Night' && r.body.set === SET2 && r.body.locked === true, JSON.stringify(r.body).slice(0, 160));
  r = await call(handlePaperState, { session_id:SESSION });
  show('the state the console reads says: 3 printed, 80s Night, locked, coded, dated', r.body.printed === 3 && r.body.playlist_name === '80s Night' && r.body.locked === true && r.body.coded === true && !!r.body.printed_label, JSON.stringify(r.body));
  show('...and never carries a card\'s squares', JSON.stringify(r.body).indexOf('song_id') < 0);
  reset();
  r = await call(handlePaperState, { session_id:SESSION });
  show('a night with nothing printed: printed 0, nothing to lock', r.body.printed === 0 && !r.body.locked);

  print('\nthe public half: a player\'s own phone camera');
  reset();
  r = await call(handlePaperPrint, { session_id:SESSION, kind:'musical', count:2, playlist:{ name:'Pub Classics', songs:songs(60) } });
  var good = r.body.cards[0].code;
  r = await call(handleCardResolve, { code: good });
  show('a real card resolves to its venue\'s public join slug and nothing else', r.status === 200 && r.body.ok === true && r.body.slug === 'the-mini-bar' && Object.keys(r.body).sort().join() === 'name,ok,slug', JSON.stringify(r.body));
  r = await call(handleCardResolve, { code: good.slice(0, 20) + (good[20] === '0' ? '1' : '0') });
  show('a forged code resolves to nothing (404)', r.status === 404 && r.body.ok === false);
  r = await call(handleCardResolve, { code: '' });
  show('no code is a 404 too', r.status === 404);

  print('\nthe older cards (printed before codes) still work by number, and are binned when printing again before a game');
  reset();
  DB.vp_playlists.push({ id:'99999999-9999-4999-8999-000000000001', owner_venue_id:VENUE, title:'Pub Classics (paper 33333333)', song_count:60 });
  songs(60).forEach(function(s, i){ DB.vp_playlist_songs.push({ id:'aaaaaaaa-0000-4000-8000-0000000000' + ('0' + i).slice(-2), playlist_id:'99999999-9999-4999-8999-000000000001', seq:i + 1, title:s.title, artist:s.artist }); });
  sess().paper = { musical:{ playlist_id:'99999999-9999-4999-8999-000000000001', playlist_name:'Pub Classics', cards:[{ no:1, cells:generateMusicCard(DB.vp_playlist_songs) }] } };
  r = await call(handlePaperPrint, { session_id:SESSION, kind:'musical', count:2, playlist:{ name:'Pub Classics', songs:songs(60) } });
  show('before any game: an old uncoded set is replaced by a coded one (the old cards cannot be scanned)', r.status === 200 && r.body.replaced === true && r.body.coded === true && r.body.cards.every(function(c){ return !!c.code; }), JSON.stringify(r.body).slice(0, 120));

  print('\n' + ran + ' checks, ' + bad + ' failed');
  if (bad) { print('FAILED'); } else { print('ALL ' + ran + ' CHECKS PASSED'); }
})();
