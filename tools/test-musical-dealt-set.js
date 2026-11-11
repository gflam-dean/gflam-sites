/* THE SONGS DEALT ARE THE PLAYLIST THE HOST STARTED WITH (Dean, live play on The Mini Bar, 12 Nov 2026, INBOX 282.3).
   RUN, not read.

   The console showed Pub Classics (well-known songs only) and the room was dealt Mafumafu "Onnanoko Ni Naritai",
   Stiff Little Fingers and the Clancy Brothers' "The Castle of Dromore": songs in NO playlist, from the 6,740 song
   full library. The Worker's ensureMusicPlaylist reused ANY playlist of the venue with the same title and the same
   song count. Every game draws a fresh 60 from its theme, so an older "Pub Classics" of 60 (or one stored under a
   stale name) came back in place of the 60 the host had just drawn, and Surprise Mix was the same 60 every night.

   Fixed: a reuse must hold exactly the same songs, and a guard at deal time checks that every song dealt is one
   the host started with (logged to vp_admin_audit as musical_playlist_mismatch, and the host's own set is dealt).

   Drives the REAL shipped Worker (venueplay-game.js) through tools/rig-game-worker.js.

   Run: jsc tools/test-musical-dealt-set.js   (from the repo root) */
load('tools/rig-game-worker.js');

var SESSION = '33333333-3333-4333-8333-333333333333';
var OLD_PL = '77777777-7777-4777-8777-777777777777';
function songs(n, tag, from){ var a=[]; for(var i=from||1;i<(from||1)+n;i++) a.push({ title:(tag||'Song')+' '+i, artist:(tag||'Song')+' Band '+i }); return a; }
var STRAYS = [{ title:'Onnanoko Ni Naritai', artist:'Mafumafu' }, { title:'Alternative Ulster', artist:'Stiff Little Fingers' },
              { title:'The Castle of Dromore', artist:'The Clancy Brothers & Tommy Makem' }];
function reset(){
  DB = { vp_sessions:[{ id:SESSION, venue_id:VENUE, join_code:'ABCDEF', status:'lobby', plan_cap_at_start:0, paper:null }],
         vp_venues:[{ id:VENUE, name:'The Mini Bar', status:'active', created_at:'2026-01-01T00:00:00Z' }],
         vp_players:[{ id:'88888888-8888-4888-8888-888888888801', session_id:SESSION, device_id:'phone-dean', kicked:false }],
         vp_games:[], vp_cards:[], vp_claims:[], vp_music_games:[], vp_music_plays:[],
         vp_playlists:[], vp_playlist_songs:[], vp_admin_audit:[], vp_venue_settings:[], vp_bingo_games:[] };
}
/* An older "Pub Classics" of 60 at this venue, stored on an earlier night: 57 full-library songs and the three Dean
   heard. Same title, same count: the old reuse rule took it. */
function seedOldPubClassics(){
  DB.vp_playlists.push({ id:OLD_PL, owner_venue_id:VENUE, title:'Pub Classics', song_count:60, created_at:'2026-11-11T08:00:00Z' });
  var rows = songs(57, 'Library').concat(STRAYS);
  rows.forEach(function(s, i){ DB.vp_playlist_songs.push({ id:'99999999-9999-4999-8999-1'+('0000000000'+i).slice(-11), playlist_id:OLD_PL, seq:i+1, title:s.title, artist:s.artist }); });
}
venueInFreeMonth = async function(){ return false; };
checkWeeklyFormatLimit = async function(){ return null; };
stampWeeklyFormat = async function(){};
async function call(fn, body){ BODY = body; try { return await fn({}, ENV, json); } catch(e){ return { status: e.status || 500, body: { error: String(e.message || e) } }; } }
function start(name, set){ return call(handleHostGame, { session_id:SESSION, format:'musical', pattern:'one', prize:'Meat tray', paper_count:0, playlist:{ name:name, songs:set } }); }
function key(s){ return String(s.title).toLowerCase() + '|' + String(s.artist).toLowerCase(); }
function inside(list, set){ var k={}; set.forEach(function(s){ k[key(s)]=true; }); return list.every(function(s){ return k[key(s)]; }); }
function cardTitles(){ var t=[]; DB.vp_cards.forEach(function(c){ (c.cells||[]).forEach(function(x){ if(x && x.title) t.push(x.title); }); }); return t; }

(async function(){
  print('\nthe venue already has an older "Pub Classics" of 60 with other songs in it');
  reset(); seedOldPubClassics();
  var pub = songs(60, 'Pub');
  var r = await start('Pub Classics', pub);
  show('CONTROL: the game starts', r.status === 200 && r.body && r.body.game_id, JSON.stringify(r.body).slice(0, 160));
  var dealt = (r.body.songs || []).map(function(s){ return { title:s.title, artist:s.artist }; });
  show('every song the console is handed back is one the host started with (Pub Classics)', dealt.length === 60 && inside(dealt, pub),
       dealt.filter(function(s){ return !inside([s], pub); }).slice(0, 3).map(function(s){ return s.title + ' / ' + s.artist; }).join(', '));
  var titles = cardTitles(), pubTitles = {}; pub.forEach(function(s){ pubTitles[s.title] = true; });
  show('every square on every dealt card is a Pub Classics song: no Mafumafu, no Stiff Little Fingers, no Clancy Brothers',
       titles.length > 0 && titles.every(function(t){ return pubTitles[t]; }), titles.filter(function(t){ return !pubTitles[t]; }).slice(0, 3).join(', '));
  show('the game is NOT played off the older playlist', !DB.vp_games.some(function(g){ return g.config && g.config.playlist_id === OLD_PL; }));
  show('from_paper is false (no printed cards): the console keeps the playlist it showed', r.body.from_paper === false, String(r.body.from_paper));

  print('\nSurprise Mix twice: two draws, two sets');
  reset();
  var s1 = songs(60, 'Mix', 1), s2 = songs(60, 'Mix', 200);
  await start('Surprise Mix', s1);
  r = await start('Surprise Mix', s2);
  dealt = (r.body.songs || []).map(function(s){ return { title:s.title, artist:s.artist }; });
  show('the second Surprise Mix plays its own 60, not the first game\'s', r.status === 200 && dealt.length === 60 && inside(dealt, s2), dealt.slice(0, 2).map(function(s){ return s.title; }).join(', '));

  print('\nthe SAME set again is reused, not stored twice');
  reset();
  var same = songs(60, 'Same');
  await start('80s Anthems', same);
  var n1 = DB.vp_playlists.length;
  r = await start('80s Anthems', same.slice().reverse());
  show('the same 60 (in any order) reuses the stored playlist', r.status === 200 && DB.vp_playlists.length === n1, n1 + ' -> ' + DB.vp_playlists.length);

  print('\nTHE GUARD: a stored playlist that is not the set the host sent is never dealt');
  reset(); seedOldPubClassics();
  var realEnsure = ensureMusicPlaylist;
  ensureMusicPlaylist = async function(env, venueId, name, list, opts){ if(opts && opts.fresh) return realEnsure(env, venueId, name, list, opts); return OLD_PL; };   // a reuse that went wrong
  pub = songs(60, 'Pub');
  r = await start('Pub Classics', pub);
  ensureMusicPlaylist = realEnsure;
  dealt = (r.body.songs || []).map(function(s){ return { title:s.title, artist:s.artist }; });
  show('the game still starts, dealt from the host\'s own songs', r.status === 200 && dealt.length === 60 && inside(dealt, pub), JSON.stringify(r.body).slice(0, 160));
  var audit = DB.vp_admin_audit.filter(function(a){ return a.action === 'musical_playlist_mismatch'; });
  show('and the mismatch is logged for HQ (musical_playlist_mismatch, naming the stray songs)', audit.length === 1 && audit[0].detail && Array.isArray(audit[0].detail.strays) && audit[0].detail.strays.length > 0 && audit[0].detail.asked === 60, JSON.stringify(audit).slice(0, 200));

  print('\nprinted cards: the game plays the printed set and SAYS so');
  reset();
  await call(handlePaperPrint, { session_id:SESSION, kind:'musical', count:2, playlist:{ name:'80s Anthems', songs:songs(60, 'Eighties') } });
  r = await start('Pub Classics', songs(60, 'Pub'));
  show('the response says the songs come from the printed cards (from_paper) and names that playlist', r.body.from_paper === true && r.body.playlist_name === '80s Anthems', JSON.stringify({ f:r.body.from_paper, n:r.body.playlist_name }));

  print('\n' + (ran - bad) + ' of ' + ran + ' checks passed');
  if (bad) throw new Error(bad + ' musical dealt-set checks failed');
})().catch(function(e){ print('CRASH ' + (e && e.stack || e)); throw e; });
