/* PAPER PLAYERS, RUN, not read. Dean, 25 Sep 2026: printed musical bingo cards and trivia answer
   sheets for the regulars who will not use a phone, ten a night, a trivia sheet for every player on
   the plan in the free month, and "the Leader board is what charges the customer. If they check a
   musical bingo code thats when an extra player is charged".

   Drives the REAL shipped Worker (venueplay-game.js) through tools/rig-game-worker.js: printing,
   the caps, Start game with paper cards declared, a card checked by number (invalid then valid),
   billing counting each paper card ONCE, a phone that tries to pass itself off as a paper card,
   90-ball bingo refusing paper players, and a trivia paper round: answers held back on a reload,
   no scoring before the round's last question closes, a score, a corrected score.

   Run: jsc tools/test-paper-players.js   (from the repo root) */
load('tools/rig-game-worker.js');

var SESSION = '33333333-3333-4333-8333-333333333333';
var SET = '44444444-4444-4444-8444-444444444444';
function songs(n){ var a=[]; for(var i=1;i<=n;i++) a.push({ title:'Song '+i, artist:'Band '+i }); return a; }
function reset(planCap){
  DB = { vp_sessions:[{ id:SESSION, venue_id:VENUE, join_code:'ABCDEF', status:'lobby', plan_cap_at_start: planCap||0, paper:null }],
         vp_venues:[{ id:VENUE, name:'Test Venue', status:'active', created_at:'2026-01-01T00:00:00Z' }],
         vp_players:[], vp_games:[], vp_cards:[], vp_claims:[], vp_music_games:[], vp_music_plays:[],
         vp_playlists:[], vp_playlist_songs:[], vp_admin_audit:[], vp_trivia_games:[], vp_trivia_answers:[],
         vp_questions:[], vp_venue_settings:[], vp_asked_questions:[], vp_bingo_games:[] };
}
var FREE = false;
venueInFreeMonth = async function(){ return FREE; };
checkWeeklyFormatLimit = async function(){ return null; };
stampWeeklyFormat = async function(){};
async function call(fn, body){ BODY = body; try { return await fn({}, ENV, json); } catch(e){ return { status: e.status || 500, body: { error: String(e.message || e) } }; } }
function sess(){ return DB.vp_sessions[0]; }
function paperRows(){ return DB.vp_players.filter(function(p){ return /^paper-/.test(p.device_id||''); }); }

(async function(){
  print('\nprinting, and the limits');
  reset(0);
  var r = await call(handlePaperPrint, { session_id:SESSION, kind:'musical', count:11, playlist:{ name:'Pub Classics', songs:songs(60) } });
  show('eleven musical cards is refused: ten a night', r.status === 400 && r.body.cap === 10, JSON.stringify(r.body));
  r = await call(handlePaperPrint, { session_id:SESSION, kind:'musical', count:3, playlist:{ name:'Pub Classics', songs:songs(60) } });
  show('three musical cards print', r.status === 200 && r.body.cards.length === 3, JSON.stringify(r.body).slice(0,120));
  show('each printed card is 25 squares with a FREE centre', r.body.cards[0].titles.length === 25 && r.body.cards[0].titles[12] === '');
  show('the cards are kept on the night', sess().paper && sess().paper.musical.cards.length === 3);
  var firstCells = JSON.stringify(sess().paper.musical.cards[0].cells);
  r = await call(handlePaperPrint, { session_id:SESSION, kind:'musical', count:4, playlist:{ name:'Other', songs:songs(60) } });
  show('printing again keeps the first three exactly and adds one', r.body.cards.length === 4 && JSON.stringify(sess().paper.musical.cards[0].cells) === firstCells);
  show('printing again keeps the ORIGINAL set, not the newly chosen playlist', sess().paper.musical.playlist_name === 'Pub Classics');
  show('a printed card is not a player yet', paperRows().length === 0);
  show('printing is written down for HQ', DB.vp_admin_audit.some(function(a){ return a.action==='paper_printed' && a.detail.kind==='musical'; }));

  reset(40); FREE = true;
  r = await call(handlePaperPrint, { session_id:SESSION, kind:'trivia', count:40 });
  show('free month: a trivia sheet for every player on the plan (40)', r.status === 200 && r.body.teams === 40, JSON.stringify(r.body));
  r = await call(handlePaperPrint, { session_id:SESSION, kind:'musical', count:11, playlist:{ name:'P', songs:songs(60) } });
  show('free month: musical cards are still ten, never the plan', r.status === 400 && r.body.cap === 10);
  FREE = false; reset(40);
  r = await call(handlePaperPrint, { session_id:SESSION, kind:'trivia', count:11 });
  show('after the free month trivia is ten too', r.status === 400 && r.body.cap === 10);

  print('\nmusical: Start game with paper cards');
  reset(0);
  await call(handlePaperPrint, { session_id:SESSION, kind:'musical', count:5, playlist:{ name:'Pub Classics', songs:songs(60) } });
  DB.vp_players.push({ id:'p-phone-1', session_id:SESSION, kicked:false, device_id:'phoneAAAAAA', display_name:'Ann' });
  DB.vp_players.push({ id:'p-phone-2', session_id:SESSION, kicked:false, device_id:'phoneBBBBBB', display_name:'Bob' });
  r = await call(handleHostGame, { session_id:SESSION, format:'musical', pattern:'one', prize:'Tab', paper_count:2, playlist:{ name:'Surprise', songs:songs(60) } });
  show('the game starts', r.status === 200, JSON.stringify(r.body).slice(0,160));
  var GAME = r.body.game_id;
  var cards = DB.vp_cards.filter(function(c){ return c.game_id === GAME; });
  show('phones get cards 1 and 2', cards.filter(function(c){ return c.card_no < 900; }).map(function(c){ return c.card_no; }).sort().join() === '1,2');
  show('the two DECLARED paper cards are players with their printed cards on 901 and 902',
       paperRows().length === 2 && cards.filter(function(c){ return c.card_no > 900; }).map(function(c){ return c.card_no; }).sort().join() === '901,902');
  show('card 901 carries exactly what was printed as card 1', JSON.stringify(cards.filter(function(c){ return c.card_no===901; })[0].cells) === JSON.stringify(sess().paper.musical.cards[0].cells));
  var mg = DB.vp_games.filter(function(g){ return g.id === GAME; })[0];
  show('the game plays the PRINTED set, not the one the console drew', mg.config.playlist_id === sess().paper.musical.playlist_id);
  var dec = DB.vp_admin_audit.filter(function(a){ return a.action === 'paper_declared'; })[0];
  show('what was declared is written down against what was printed', dec && dec.detail.printed === 5 && dec.detail.declared === 2);
  show('billing sees four players: two phones, two paper', countPlayers(DB.vp_players.filter(function(p){ return !p.kicked; })) === 4);

  print('\nmusical: a paper card checked by its number');
  r = await call(handlePaperCheck, { game_id:GAME, card_no:4 });
  show('card 4 (printed, not declared) checks as not a winner, no songs played', r.status === 200 && r.body.auto_verdict === 'invalid' && !r.body.claim_id, JSON.stringify(r.body).slice(0,120));
  show('checking card 4 made it a player: checked = played', paperRows().length === 3);
  r = await call(handlePaperCheck, { game_id:GAME, card_no:4 });
  show('checking card 4 again adds nobody', paperRows().length === 3 && countPlayers(DB.vp_players) === 5);
  r = await call(handlePaperCheck, { game_id:GAME, card_no:9 });
  show('a card that was never printed is refused', r.status === 404);
  var c1 = sess().paper.musical.cards[0].cells;
  for (var q=0; q<5; q++){ var cell = c1[q]; if (cell && cell.song_id) DB.vp_music_plays.push({ game_id:GAME, song_id:cell.song_id, played_at:'2026-09-19T09:31:00Z', seq:q+1 }); }
  r = await call(handlePaperCheck, { game_id:GAME, card_no:1 });
  show('card 1 with its top row played is a valid claim', r.body.auto_verdict === 'valid' && !!r.body.claim_id && r.body.winning_cells.join() === '0,1,2,3,4', JSON.stringify(r.body).slice(0,140));
  var claimId = r.body.claim_id;
  r = await call(handlePaperCheck, { game_id:GAME, card_no:1 });
  show('checking the winning card twice is ONE claim', r.body.claim_id === claimId && DB.vp_claims.length === 1);
  show('the claim is on the paper player, so Confirm winner works unchanged', DB.vp_claims[0].player_id === paperRows().filter(function(p){ return p.device_id==='paper-m-1'; })[0].id);

  print('\nno phone may become a paper card, and late phones stay off the paper numbers');
  var before = DB.vp_players.length;
  show('a pid starting paper- is not a valid device id', !isPaperDevice('phoneAAAAAA') && isPaperDevice('paper-m-1'));
  DB.vp_players.push({ id:'p-phone-3', session_id:SESSION, kicked:false, device_id:'phoneCCCCCC', display_name:'Cat' });
  r = await playerMusicCard(ENV, json, GAME, { id:'p-phone-3', session_id:SESSION });
  show('a late phone is dealt card 3, not 903', r.body.card_no === 3, JSON.stringify(r.body).slice(0,80));

  print('\n90-ball bingo in the same night');
  r = await call(handleHostGame, { session_id:SESSION, format:'bingo90', pattern:'one_line' });
  var bg = r.body.game_id;
  var bcards = DB.vp_cards.filter(function(c){ return c.game_id === bg; });
  var paperIds = paperRows().map(function(p){ return p.id; });
  show('bingo deals the three phones and no paper player', r.status === 200 && bcards.length === 3 && !bcards.some(function(c){ return paperIds.indexOf(c.player_id) >= 0; }), r.status+' '+bcards.length);

  print('\ntrivia: a paper round');
  reset(0);
  var Q = []; for (var i=1;i<=6;i++){ Q.push({ id:'q-'+i, set_id:SET, seq:i, question:'Q'+i, options:['A','B','C','D'], correct_index: i % 4, points:100 }); }
  DB.vp_questions = Q;
  DB.vp_question_sets = [{ id:SET, title:'Set', owner_venue_id:null, visibility:'library', question_count:6 }];
  await call(handlePaperPrint, { session_id:SESSION, kind:'trivia', count:2, round_size:3, questions:6 });
  await call(handlePaperPrint, { session_id:SESSION, kind:'trivia', count:3, round_size:10, questions:6 });
  show('a reprint for more teams keeps the FIRST print\'s rounds of 3', sess().paper.trivia.round_size === 3 && sess().paper.trivia.teams === 3);
  r = await call(handleHostGame, { session_id:SESSION, format:'trivia', question_set_id:SET, question_count:6, round_size:10, base_points:100 });
  show('the trivia round starts', r.status === 200, JSON.stringify(r.body).slice(0,200));
  var TG = r.body.game_id;
  var tcfg = (DB.vp_games.filter(function(g){ return g.id === TG; })[0] || {}).config || {};
  show('printed sheets make it a paper night in the PRINTED rounds of 3, though the console asked for 10', tcfg.defer_reveal === true && tcfg.round_size === 3 && tcfg.paper_teams === 3, JSON.stringify(tcfg).slice(0,160));
  show('and the console is told so, whichever tablet it is', r.body.paper === true && r.body.round_size === 3);
  var tgRow = DB.vp_trivia_games.filter(function(t){ return t.game_id === TG; })[0];
  tgRow.current_seq = tcfg.question_seqs[1]; tgRow.phase = 'revealed';
  r = await call(handlePaperScore, { game_id:TG, round:1, teams:[{ no:1, name:'The Oldies', correct:2 }] });
  show('no paper score while round 1 still has a question to go', r.status === 409, JSON.stringify(r.body));
  tgRow.current_seq = tcfg.question_seqs[2]; tgRow.phase = 'asking';
  r = await call(handlePaperScore, { game_id:TG, round:1, teams:[{ no:1, name:'The Oldies', correct:2 }] });
  show('nor while the round\'s last question is still open', r.status === 409);
  tgRow.phase = 'revealed';
  DB.vp_venues[0].slug = 'test-venue';
  var sn = await getPublicSnapshot(ENV, SESSION);
  var sq = sn && sn.game && sn.game.question;
  show('a TV or phone reloading on a paper night does NOT get the answer, even after it closes', !!sq && sq.correct_index === undefined, JSON.stringify(sq).slice(0,120));
  var tgame = DB.vp_games.filter(function(g){ return g.id === TG; })[0];
  tgame.config.defer_reveal = false;
  sn = await getPublicSnapshot(ENV, SESSION);
  show('control: the same snapshot on a phones-only night DOES carry it', sn.game.question.correct_index != null);
  tgame.config.defer_reveal = true;
  var snap = null;
  try { var sg = DB.vp_games.filter(function(g){ return g.id === TG; })[0]; snap = sg.config.defer_reveal; } catch(e){}
  var board = function(){ var t={}; DB.vp_trivia_answers.filter(function(a){ return a.game_id===TG; }).forEach(function(a){ t[a.player_id]=(t[a.player_id]||0)+(a.points_awarded||0); }); return t; };
  DB.v_vp_trivia_leaderboard = [];
  r = await call(handlePaperScore, { game_id:TG, round:1, teams:[{ no:1, name:'The Oldies', correct:2 }, { no:2, name:'', correct:'' }] });
  var oldies = paperRows().filter(function(p){ return p.device_id==='paper-t-1'; })[0];
  show('round 1 scored: The Oldies are a player with 200 points (100 a correct, no speed bonus)', r.status === 200 && oldies && board()[oldies.id] === 200, JSON.stringify(r.body).slice(0,120));
  show('a team left blank is not scored and not billed', !paperRows().some(function(p){ return p.device_id==='paper-t-2'; }));
  r = await call(handlePaperScore, { game_id:TG, round:1, teams:[{ no:1, name:'The Oldies', correct:3 }] });
  show('a corrected score REPLACES the round (300), it does not add to it', board()[oldies.id] === 300);
  show('scoring twice is still one player', paperRows().filter(function(p){ return p.device_id==='paper-t-1'; }).length === 1);
  r = await call(handlePaperScore, { game_id:TG, round:1, teams:[{ no:4, name:'Ghost', correct:3 }] });
  show('a team number that was never printed is ignored', !paperRows().some(function(p){ return p.device_id==='paper-t-4'; }));
  r = await call(handlePaperScore, { game_id:TG, round:2, teams:[{ no:2, name:'Zero', correct:0 }] });
  show('round 2 cannot be scored before it is played', r.status === 409);

  print('\nHQ alert: a trivia night played on paper');
  reset(0);
  var seqs=[]; for (var z=1; z<=20; z++) seqs.push(z);
  DB.vp_games.push({ id:'55555555-5555-4555-8555-555555555551', session_id:SESSION, status:'running', format:'trivia', config:{ question_seqs:seqs } });
  DB.vp_trivia_games.push({ game_id:'55555555-5555-4555-8555-555555555551', current_seq:16, phase:'revealed' });
  DB.vp_players.push({ id:'ph1', session_id:SESSION, kicked:false, device_id:'phoneAAAAAA' });
  DB.vp_players.push({ id:'pp1', session_id:SESSION, kicked:false, device_id:'paper-t-1' });
  DB.vp_trivia_answers.push({ id:'a1', game_id:'55555555-5555-4555-8555-555555555551', player_id:'ph1', question_id:'q', answer_index:0 });
  DB.vp_trivia_answers.push({ id:'a2', game_id:'55555555-5555-4555-8555-555555555551', player_id:'pp1', question_id:'q', answer_index:0 });
  r = await call(handleGameEnd, { game_id:'55555555-5555-4555-8555-555555555551' });
  var sus = DB.vp_admin_audit.filter(function(a){ return a.action==='paper_suspect_trivia'; });
  show('16 questions, one phone (a paper team does not count as a phone): flagged for HQ', r.status === 200 && sus.length === 1 && sus[0].detail.phones === 1 && sus[0].detail.questions === 16, JSON.stringify(r) + ' ' + JSON.stringify(sus[0] && sus[0].detail));
  reset(0);
  DB.vp_games.push({ id:'55555555-5555-4555-8555-555555555552', session_id:SESSION, status:'running', format:'trivia', config:{ question_seqs:seqs } });
  DB.vp_trivia_games.push({ game_id:'55555555-5555-4555-8555-555555555552', current_seq:16, phase:'revealed' });
  ['p1','p2','p3'].forEach(function(id,ix){ DB.vp_players.push({ id:id, session_id:SESSION, kicked:false, device_id:'phone'+ix+'XXXXX' }); DB.vp_trivia_answers.push({ id:'b'+ix, game_id:'55555555-5555-4555-8555-555555555552', player_id:id, question_id:'q', answer_index:0 }); });
  await call(handleGameEnd, { game_id:'55555555-5555-4555-8555-555555555552' });
  show('control: the same night with three phones is not flagged', !DB.vp_admin_audit.some(function(a){ return a.action==='paper_suspect_trivia'; }));
  reset(0);
  DB.vp_games.push({ id:'55555555-5555-4555-8555-555555555553', session_id:SESSION, status:'running', format:'trivia', config:{ question_seqs:seqs } });
  DB.vp_trivia_games.push({ game_id:'55555555-5555-4555-8555-555555555553', current_seq:16, phase:'revealed' });
  await finishOtherRunningGames(ENV, SESSION, 'g-other');
  show('a trivia game ended by starting another game is checked too', DB.vp_admin_audit.some(function(a){ return a.action==='paper_suspect_trivia'; }));

  print('\n' + (ran - bad) + ' of ' + ran + ' checks passed');
  if (bad) throw new Error(bad + ' paper checks failed');
})().catch(function(e){ print('CRASH ' + (e && e.stack || e)); throw e; });
