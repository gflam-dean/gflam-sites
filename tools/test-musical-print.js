/* MUSICAL PAPER CARDS FOLLOW THE PLAYLIST THE HOST PICKED, UNTIL A GAME IS ON. RUN, not read.

   Audit, 27 Sep 2026: the FIRST musical print's playlist was kept for the whole night. A host who
   printed from Pub Classics, changed their mind to the 80s and printed again got Pub Classics
   cards, and every game that night played Pub Classics. Trivia's sheets had the same fault and
   were fixed the same day. The rule now: before a musical game has been played off the printed
   set, a print from a different playlist replaces it; once a game is running, or any game tonight
   was dealt from those cards, the set is kept, because the cards are on the tables.

   Drives the REAL shipped Worker (venueplay-game.js) through tools/rig-game-worker.js.

   Run: jsc tools/test-musical-print.js   (from the repo root) */
load('tools/rig-game-worker.js');

var SESSION = '33333333-3333-4333-8333-333333333333';
function songs(n, tag){ var a=[]; for(var i=1;i<=n;i++) a.push({ title:(tag||'Song')+' '+i, artist:'Band '+i }); return a; }
function reset(){
  DB = { vp_sessions:[{ id:SESSION, venue_id:VENUE, join_code:'ABCDEF', status:'lobby', plan_cap_at_start:0, paper:null }],
         vp_venues:[{ id:VENUE, name:'Test Venue', status:'active', created_at:'2026-01-01T00:00:00Z' }],
         vp_players:[], vp_games:[], vp_cards:[], vp_claims:[], vp_music_games:[], vp_music_plays:[],
         vp_playlists:[], vp_playlist_songs:[], vp_admin_audit:[], vp_venue_settings:[], vp_bingo_games:[] };
}
venueInFreeMonth = async function(){ return false; };
checkWeeklyFormatLimit = async function(){ return null; };
stampWeeklyFormat = async function(){};
async function call(fn, body){ BODY = body; try { return await fn({}, ENV, json); } catch(e){ return { status: e.status || 500, body: { error: String(e.message || e) } }; } }
function set(){ return DB.vp_sessions[0].paper && DB.vp_sessions[0].paper.musical; }
function firstTitle(){ return set().cards[0].cells[0].title; }
function print_(name, count, tag){ return call(handlePaperPrint, { session_id:SESSION, kind:'musical', count:count, playlist:{ name:name, songs:songs(60, tag) } }); }

(async function(){
  print('\nbefore any game: the latest playlist wins');
  reset();
  var r = await print_('Pub Classics', 3, 'Pub');
  show('three Pub Classics cards print', r.status === 200 && r.body.playlist_name === 'Pub Classics' && set().cards.length === 3, JSON.stringify(r.body).slice(0,100));
  show('...from Pub Classics songs', /^Pub /.test(firstTitle()) || set().cards[0].cells.some(function(c){ return c && /^Pub /.test(c.title||''); }));
  var pubId = set().playlist_id;
  r = await print_('80s Anthems', 2, 'Eighties');
  show('a print from a DIFFERENT playlist before any game replaces the set', r.status === 200 && set().playlist_name === '80s Anthems' && set().playlist_id !== pubId, JSON.stringify(set() && { n:set().playlist_name, id:set().playlist_id }));
  show('the console is told the cards come from 80s Anthems and that the set was replaced', r.body.playlist_name === '80s Anthems' && r.body.replaced === true && r.body.kept === false);
  show('the replaced set starts again at card 1: two new cards, not three old plus none', set().cards.length === 2 && r.body.cards.length === 2);
  show('every square on the new cards is an 80s song', set().cards.every(function(c){ return c.cells.every(function(x){ return !x || !x.title || /^Eighties /.test(x.title); }); }));
  r = await print_('80s Anthems', 4, 'Eighties');
  show('the SAME playlist again keeps the cards and adds two', r.body.cards.length === 4 && r.body.replaced === false && set().playlist_name === '80s Anthems');

  print('\nonce a musical game is running, the set is kept');
  var eightiesId = set().playlist_id;
  var cells1 = JSON.stringify(set().cards[0].cells);
  r = await call(handleHostGame, { session_id:SESSION, format:'musical', pattern:'one', prize:'Tab', paper_count:0, playlist:{ name:'80s Anthems', songs:songs(60, 'Eighties') } });
  show('the game starts off the printed 80s set', r.status === 200 && DB.vp_games.some(function(g){ return g.status === 'running' && g.config && g.config.playlist_id === eightiesId; }), JSON.stringify(r.body).slice(0,120));
  r = await print_('Pub Classics', 5, 'Pub');
  show('a different playlist mid-game does NOT replace the cards on the tables', set().playlist_id === eightiesId && set().playlist_name === '80s Anthems' && JSON.stringify(set().cards[0].cells) === cells1);
  show('the console is told the cards are still 80s Anthems (kept), and gets the extra card', r.body.playlist_name === '80s Anthems' && r.body.kept === true && r.body.cards.length === 5);

  print('\nafter that game ends, the cards on the tables still hold');
  DB.vp_games.forEach(function(g){ g.status = 'finished'; });
  r = await print_('Pub Classics', 5, 'Pub');
  show('a game was dealt from these cards tonight, so a new playlist still keeps them', set().playlist_id === eightiesId && r.body.kept === true);

  print('\na musical game played BEFORE anything was printed does not lock a later print');
  reset();
  DB.vp_games.push({ id:'55555555-5555-4555-8555-555555555501', session_id:SESSION, seq:1, format:'musical_bingo', status:'finished', config:{ playlist_id:'66666666-6666-4666-8666-666666666666' } });
  await print_('Pub Classics', 2, 'Pub');
  r = await print_('80s Anthems', 2, 'Eighties');
  show('an earlier phones-only game tonight did not play these cards: the new playlist wins', set().playlist_name === '80s Anthems' && r.body.replaced === true);

  print('\nprinted DURING a phones-only game: running is running');
  reset();
  DB.vp_games.push({ id:'55555555-5555-4555-8555-555555555502', session_id:SESSION, seq:1, format:'musical_bingo', status:'running', config:{ playlist_id:'66666666-6666-4666-8666-666666666666' } });
  await print_('Pub Classics', 2, 'Pub');
  r = await print_('80s Anthems', 2, 'Eighties');
  show('a musical game is on, so a new playlist keeps the printed set (cards may already be out)', set().playlist_name === 'Pub Classics' && r.body.kept === true);

  print('\n' + (ran - bad) + ' of ' + ran + ' checks passed');
  if (bad) throw new Error(bad + ' musical print checks failed');
})().catch(function(e){ print('CRASH ' + (e && e.stack || e)); throw e; });
