/* JAG THE JOKER: THE JOKER IS RANDOM, SEALED, NEVER SHOWN EARLY, AND PROVABLY NEVER MOVED.

   Dean, 25 Sep 2026: "As long as we can prove the joker in a random spot where it stays."
   Runs the REAL Jag routes in venueplay-game.js on the rig, and the REAL fingerprint check
   in venueplay/jag-check.html, with a real SHA-256. The database functions from migration
   95 are modelled here in JavaScript, line for line in what they decide (who may, which
   status, the spot compare, the reveal). The SQL itself is proven when Dean runs 95: its
   read-back asks the three questions that matter.

   Run: jsc tools/test-jag-joker.js */
load('tools/rig-game-worker.js');

/* ---- a real SHA-256, so the commitment is the one a browser computes ---- */
function sha256(bytes){
  var K=[0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
  var H=[0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
  var l=bytes.length, m=[]; for(var i=0;i<l;i++) m.push(bytes[i]); m.push(0x80);
  while(m.length%64!==56) m.push(0);
  var bits=l*8; for(i=7;i>=0;i--) m.push(i>=4?0:(bits>>>(i*8))&255);
  function r(x,n){ return (x>>>n)|(x<<(32-n)); }
  for(var o=0;o<m.length;o+=64){
    var w=[]; for(i=0;i<16;i++) w[i]=(m[o+4*i]<<24)|(m[o+4*i+1]<<16)|(m[o+4*i+2]<<8)|m[o+4*i+3];
    for(i=16;i<64;i++){ var s0=r(w[i-15],7)^r(w[i-15],18)^(w[i-15]>>>3), s1=r(w[i-2],17)^r(w[i-2],19)^(w[i-2]>>>10); w[i]=(w[i-16]+s0+w[i-7]+s1)|0; }
    var a=H[0],b=H[1],c=H[2],d=H[3],e=H[4],f=H[5],g=H[6],h=H[7];
    for(i=0;i<64;i++){ var S1=r(e,6)^r(e,11)^r(e,25), ch=(e&f)^(~e&g), t1=(h+S1+ch+K[i]+w[i])|0, S0=r(a,2)^r(a,13)^r(a,22), mj=(a&b)^(a&c)^(b&c), t2=(S0+mj)|0;
      h=g; g=f; f=e; e=(d+t1)|0; d=c; c=b; b=a; a=(t1+t2)|0; }
    H[0]=(H[0]+a)|0;H[1]=(H[1]+b)|0;H[2]=(H[2]+c)|0;H[3]=(H[3]+d)|0;H[4]=(H[4]+e)|0;H[5]=(H[5]+f)|0;H[6]=(H[6]+g)|0;H[7]=(H[7]+h)|0;
  }
  return H.map(function(x){ return ('00000000'+(x>>>0).toString(16)).slice(-8); }).join('');
}
function utf8(s){ var out=[]; for(var i=0;i<s.length;i++){ var c=s.charCodeAt(i); if(c<128) out.push(c); else throw new Error('ascii only'); } return out; }
show('the test\'s SHA-256 is SHA-256', sha256(utf8('abc')) === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
sha256Hex = async function(s){ return sha256(utf8(String(s))); };
var _uuid = 0;
crypto.randomUUID = function(){ _uuid++; return 'aaaaaaaa-aaaa-4aaa-8aaa-' + ('000000000000' + _uuid).slice(-12); };

/* ---- migration 95's functions, modelled ----
   Line for line in what they DECIDE. The trading night is the Worker's own brisbaneNightKey, the
   clock vp_jag_night mirrors in SQL (its read-back asks the 2am question). */
var STAFF = {}, ADMIN = false;   // venue_id -> role of HOST there; ADMIN = an HQ admin using View as
function staff(venueId){ var v=(DB.vp_venues||[]).filter(function(x){ return x.id===venueId; })[0];
  if(!STAFF[venueId] && !ADMIN) return { status:'not_staff' }; if(!v) return { status:'venue_missing' };
  if(v.status!=='active') return { status:'venue_paused' };
  return ADMIN && !STAFF[venueId] ? { status:'ok', role:'owner', is_admin:true, actor:'vpadmin:'+HOST } : { status:'ok', role:STAFF[venueId], is_admin:false, actor:'host:staff-1' }; }
function gate(venueId){ var w=staff(venueId); if(w.status!=='ok') return w;
  var st=String((DB.vp_venues.filter(function(x){ return x.id===venueId; })[0]||{}).au_state||'').toUpperCase();
  if(!st) return { status:'no_state' }; if(st==='QLD') return { status:'state_refused' }; return w; }
function gameOf(id){ return DB.vp_jag_games.filter(function(x){ return x.id===id; })[0]; }
function board(id){ var g=gameOf(id); if(!g) return null;
  var into=DB.vp_jag_games.filter(function(x){ return x.carried_from===id; })[0];
  return { id:g.id, venue_id:g.venue_id, name:g.name, deck_size:g.deck_size, jackpot_cents:g.jackpot_cents, commitment:g.commitment,
    status:g.status, created_at:g.created_at, ended_at:g.ended_at,
    revealed_spot: g.status!=='active' ? g.revealed_spot : null, revealed_salt: g.status!=='active' ? g.revealed_salt : null,
    closed_reason:g.closed_reason||null, carried_from:g.carried_from||null, carried_into: into ? into.id : null,
    turns: DB.vp_jag_turns.filter(function(t){ return t.jag_id===id; }).map(function(t){ return { card:t.card, is_joker:t.is_joker, jackpot_cents:t.jackpot_cents, winner_name:t.winner_name, overridden:t.overridden, turned_at:t.turned_at }; }) }; }
function current(venueId){ var gs=DB.vp_jag_games.filter(function(x){ return x.venue_id===venueId; })
    .sort(function(x,y){ return (y.status==='active')-(x.status==='active') || (y.created_at>x.created_at?1:-1); });
  return gs.length ? board(gs[0].id) : null; }
function log(g, who, what, from, to, card, note){ DB.vp_jag_log.push({ jag_id:g.id, actor:who.actor, what:what, from_cents:from, to_cents:to, card:card, note:note }); }
var RPC_CALLS = [], RPC_ARGS = {};
sbRpc = async function(env, fn, a){
  RPC_CALLS.push(fn); RPC_ARGS[fn] = a;
  var g, w;
  if(fn==='vp_host_staff'){ return staff(a.p_venue_id); }
  if(fn==='vp_jag_current'){ return current(a.p_venue_id); }
  if(fn==='vp_jag_public'){ var v=DB.vp_venues.filter(function(x){ return x.slug===a.p_slug; })[0];
    if(!v || v.status!=='active') return { status:'no_venue' };
    var b;
    if(a.p_jag_id==null) b=current(v.id);
    else if(gameOf(a.p_jag_id) && gameOf(a.p_jag_id).venue_id===v.id) b=board(a.p_jag_id);
    else return { status:'no_game' };
    var hist=DB.vp_jag_games.filter(function(x){ return x.venue_id===v.id; }).sort(function(x,y){ return y.created_at>x.created_at?1:-1; }).slice(0,20)
      .map(function(x){ return { id:x.id, name:x.name, status:x.status, created_at:x.created_at, ended_at:x.ended_at, jackpot_cents:x.jackpot_cents, closed_reason:x.closed_reason||null }; });
    return { status:'ok', venue:v.name, board:b, history:hist }; }
  if(fn==='vp_jag_start'){ w=gate(a.p_venue_id); if(w.status!=='ok') return { status:w.status };
    if(a.p_spot<1||a.p_spot>a.p_deck_size) return { status:'bad_spot' };
    if(DB.vp_jag_games.some(function(x){ return x.venue_id===a.p_venue_id && x.status==='active'; })) return { status:'already_running' };
    var pot=Math.max(0,a.p_jackpot_cents), from=null, prev=DB.vp_jag_games.filter(function(x){ return x.venue_id===a.p_venue_id; }).sort(function(x,y){ return y.created_at>x.created_at?1:-1; })[0];
    if(prev && prev.status==='closed' && !DB.vp_jag_games.some(function(x){ return x.carried_from===prev.id; })){
      if(a.p_carry===false){ if(w.role!=='owner') return { status:'not_owner_carry' }; }
      else { from=prev.id; pot=Math.max(pot, prev.jackpot_cents); } }
    DB.vp_jag_games.push({ id:a.p_jag_id, venue_id:a.p_venue_id, name:a.p_name||'Jag the Joker', deck_size:a.p_deck_size, jackpot_cents:pot,
      commitment:a.p_commitment, status:'active', created_at:new Date(NOWMS + DB.vp_jag_games.length).toISOString(), carried_from:from });
    DB.vp_jag_secrets.push({ jag_id:a.p_jag_id, spot:a.p_spot, salt:a.p_salt });
    log(gameOf(a.p_jag_id), w, 'start', null, pot);
    if(from) log(gameOf(a.p_jag_id), w, 'carry', prev.jackpot_cents, pot);
    return { status:'ok', board:board(a.p_jag_id) }; }
  g = gameOf(a.p_jag_id);
  if(!g) return { status:'no_game' };
  w = fn==='vp_jag_close' ? staff(g.venue_id) : gate(g.venue_id); if(w.status!=='ok') return { status:w.status };
  if(fn==='vp_jag_close' && w.role!=='owner') return { status:'not_owner' };
  if(g.status!=='active') return { status:'finished' };
  var s=DB.vp_jag_secrets.filter(function(x){ return x.jag_id===g.id; })[0];
  if(fn==='vp_jag_turn'){
    if(a.p_card<1||a.p_card>g.deck_size) return { status:'bad_card' };
    if(!String(a.p_winner_name||'').trim()) return { status:'no_winner' };
    if(DB.vp_jag_turns.some(function(t){ return t.jag_id===g.id && t.card===a.p_card; })) return { status:'already_turned' };
    var night=brisbaneNightKey(Date.now()), over=false;
    if(DB.vp_jag_turns.some(function(t){ return t.jag_id===g.id && t.night===night; })){
      if(!a.p_override) return { status:'turned_tonight' };
      if(w.role!=='owner' && w.role!=='manager') return { status:'not_manager_override' };
      over=true; }
    var joker = a.p_card===s.spot;
    DB.vp_jag_turns.push({ jag_id:g.id, card:a.p_card, winner_name:a.p_winner_name, jackpot_cents:g.jackpot_cents, is_joker:joker, night:night, overridden:over, turned_at:new Date(NOWMS).toISOString() });
    log(g, w, over?'override':'turn', g.jackpot_cents, g.jackpot_cents, a.p_card);
    if(joker){ g.status='won'; g.revealed_spot=s.spot; g.revealed_salt=s.salt; }
    return { status:'ok', is_joker:joker, board:board(g.id) }; }
  if(fn==='vp_jag_jackpot'){ var nv=Math.max(0,a.p_jackpot_cents);
    if(nv<g.jackpot_cents && w.role!=='owner' && w.role!=='manager') return { status:'not_manager_lower' };
    if(nv!==g.jackpot_cents){ log(g, w, 'jackpot', g.jackpot_cents, nv); g.jackpot_cents=nv; }
    return { status:'ok', board:board(g.id) }; }
  if(fn==='vp_jag_close'){ var why=String(a.p_reason||'').trim(); if(why.length<5) return { status:'no_reason' };
    g.status='closed'; g.revealed_spot=s.spot; g.revealed_salt=s.salt; g.closed_reason=why; log(g, w, 'close', g.jackpot_cents, g.jackpot_cents, null, why);
    return { status:'ok', board:board(g.id) }; }
  throw new Error('unmodelled ' + fn);
};

var V2='33333333-3333-4333-8333-333333333333', VQ='44444444-4444-4444-8444-444444444444';
function reset(){ DB = { vp_venues:[ { id:VENUE, slug:'test-venue', name:'Test Venue', status:'active', au_state:'NSW' },
                                     { id:V2, slug:'other-venue', name:'Other', status:'active', au_state:'VIC' },
                                     { id:VQ, slug:'qld-venue', name:'QLD', status:'active', au_state:'QLD' } ],
                         vp_jag_games:[], vp_jag_secrets:[], vp_jag_turns:[], vp_jag_log:[] };
                 STAFF = {}; STAFF[VENUE]='host'; STAFF[VQ]='owner'; ADMIN=false; RPC_CALLS = []; LOG.length = 0;
                 NOWMS += 3600000; }   // an hour on, so the board cache and rate limit from the last block are gone
var ON = Object.assign({}, ENV, { JAG_ON: '1' });
var IP = '203.0.113.9';
function get(path, ip){ return { url:'https://w'+path, headers:{ get:function(h){ return h==='cf-connecting-ip' ? (ip||IP) : ''; } } }; }
var NOHDR = { headers:{ get:function(){ return ''; } } };
async function start(body, env){ BODY = body; return await handleJagStart(NOHDR, env || ON, json); }
async function turn(body){ BODY = body; return await handleJagTurn(NOHDR, ON, json); }
async function pot(body){ BODY = body; return await handleJagJackpot(NOHDR, ON, json); }
async function close(body){ BODY = body; return await handleJagClose(NOHDR, ON, json); }
async function pub(q, ip){ return await handleJagBoard(get('/jag/board?'+q, ip), ON, json); }
function logOf(what){ return DB.vp_jag_log.filter(function(l){ return l.what===what; }); }
var DAY = 24*3600000;

(async function(){
  reset();
  print('\n== it is OFF until the Worker is told otherwise ==');
  var r = await start({ venue_id:VENUE, deck_size:20, jackpot_cents:50000 }, ENV);
  show('no JAG_ON: start answers 404 and touches nothing', r.status===404 && DB.vp_jag_games.length===0);
  r = await handleJagBoard(get('/jag/board?venue=test-venue'), ENV, json);
  show('no JAG_ON: the public board answers 404', r.status===404);
  show('every Jag route checks the switch first', ['handleJagBoard','handleJagHost','handleJagStart','handleJagTurn','handleJagJackpot','handleJagClose']
    .every(function(n){ return /^\s*if \(!jagOn\(env\)\) return jagOff\(json\);/m.test(String(globalThis[n]).split('\n')[1]); }));

  print('\n== licensing: every play, and staff before state ==');
  r = await start({ venue_id:VQ, deck_size:20, jackpot_cents:50000 });
  show('a Queensland venue is refused, even its owner, before the database is asked to write anything', r.status===403 && /Queensland/.test(r.body.error) && DB.vp_jag_games.length===0 && RPC_CALLS.indexOf('vp_jag_start')<0, JSON.stringify(r.body));
  r = await start({ venue_id:V2, deck_size:20, jackpot_cents:50000 });
  show('somebody who is not staff at the venue cannot start one', r.status===403 && /not staff/.test(r.body.error) && DB.vp_jag_games.length===0);
  delete STAFF[VQ]; LOG.length = 0;
  r = await start({ venue_id:VQ, deck_size:20, jackpot_cents:50000 });
  show('NOT staff at a Queensland venue: told only "not staff", and the venue\'s state is never read',
       r.status===403 && /not staff/.test(r.body.error) && !/Queensland/.test(r.body.error) && !LOG.some(function(l){ return /vp_venues/.test(l); }), JSON.stringify(r.body)+' '+LOG.join(' | '));
  STAFF[VQ]='owner';
  DB.vp_venues[0].au_state = null;
  r = await start({ venue_id:VENUE, deck_size:20, jackpot_cents:50000 });
  show('a venue with NO state on file is refused too (a blanked postcode cannot clear the QLD refusal)', r.status===403 && /state on file/.test(r.body.error) && DB.vp_jag_games.length===0 && RPC_CALLS.indexOf('vp_jag_start')<0, JSON.stringify(r.body));
  DB.vp_venues[0].au_state = 'NSW';
  r = await start({ venue_id:VENUE, deck_size:5, jackpot_cents:50000 });
  show('a board under 10 cards is refused', r.status===400);

  print('\n== the start: random, sealed, and published as a fingerprint ==');
  r = await start({ venue_id:VENUE, name:'Friday Jag', deck_size:20, jackpot_cents:50000 });
  var g = DB.vp_jag_games[0], sec = DB.vp_jag_secrets[0];
  show('it starts', r.status===200 && !!g, JSON.stringify(r.body).slice(0,120));
  show('the spot is on the board', sec.spot>=1 && sec.spot<=20, sec.spot);
  show('the key is 128 bits of hex', /^[0-9a-f]{32}$/.test(sec.salt));
  show('the fingerprint is sha256("jag:<id>:<spot>:<key>")', g.commitment === sha256(utf8('jag:'+g.id+':'+sec.spot+':'+sec.salt)));
  show('the console is NOT told the spot or the key', !/"revealed_spot":\d/.test(JSON.stringify(r.body)) && JSON.stringify(r.body).indexOf(sec.salt)<0);
  show('the start is logged with its jackpot', logOf('start').length===1 && logOf('start')[0].to_cents===50000);
  r = await start({ venue_id:VENUE, deck_size:20, jackpot_cents:1 });
  show('a second jackpot cannot start while one is running', r.status===409);

  print('\n== the spot is uniform: every card equally likely ==');
  var counts = {}, N = 3000;
  for(var k=0;k<N;k++){ DB.vp_jag_games=[]; DB.vp_jag_secrets=[]; await start({ venue_id:VENUE, deck_size:10, jackpot_cents:0 }); counts[DB.vp_jag_secrets[0].spot]=(counts[DB.vp_jag_secrets[0].spot]||0)+1; }
  var cards = Object.keys(counts).map(Number), lo = Math.min.apply(null, cards.map(function(c){ return counts[c]; })), hi = Math.max.apply(null, cards.map(function(c){ return counts[c]; }));
  show('all 10 cards came up, and only those', cards.length===10 && cards.every(function(c){ return c>=1 && c<=10; }), JSON.stringify(counts));
  show('none badly over or under (3000 starts, each within 240 to 360)', lo>=240 && hi<=360, lo+' to '+hi);

  print('\n== turning cards ==');
  reset();
  NOWMS = Date.parse('2026-09-25T09:30:00.000Z');       // 7:30pm Brisbane: fixed, never derived from the clock
  await start({ venue_id:VENUE, deck_size:20, jackpot_cents:50000 });
  g = DB.vp_jag_games[0]; sec = DB.vp_jag_secrets[0];
  var miss = sec.spot===1 ? 2 : 1, miss2 = sec.spot===3 ? 4 : 3;
  RPC_CALLS = [];
  r = await turn({ jag_id:g.id, card:miss, winner_name:'' });
  show('a turn with no name or ticket number is refused, before the database is asked', r.status===400 && /name or ticket number/.test(r.body.error) && DB.vp_jag_turns.length===0 && RPC_CALLS.indexOf('vp_jag_turn')<0, JSON.stringify(r.body));
  r = await turn({ jag_id:g.id, card:miss, winner_name:'Sam B.', jackpot_cents:60000 });
  show('a card that is not the Joker says so', r.status===200 && r.body.is_joker===false);
  show('the turn is recorded at the SAVED jackpot, whatever the console sends with it', g.jackpot_cents===50000 && DB.vp_jag_turns[0].jackpot_cents===50000 && g.status==='active');
  show('and the Worker never passes a jackpot to the turn at all', !!RPC_ARGS.vp_jag_turn && !('p_jackpot_cents' in RPC_ARGS.vp_jag_turn), JSON.stringify(RPC_ARGS.vp_jag_turn));
  show('and still nothing reveals the spot', JSON.stringify(r.body).indexOf(sec.salt)<0 && r.body.board.revealed_spot==null);
  r = await turn({ jag_id:g.id, card:miss, winner_name:'Again' });
  show('the same card cannot be turned twice', r.status===409 && /already been turned/.test(r.body.error));
  r = await turn({ jag_id:g.id, card:21, winner_name:'X' });
  show('a card off the board is refused', r.status===400);

  print('\n== one card a trading night ==');
  r = await turn({ jag_id:g.id, card:miss2, winner_name:'Ticket 88' });
  show('a second card the same night is refused', r.status===409 && /tonight/.test(r.body.error) && DB.vp_jag_turns.length===1, JSON.stringify(r.body));
  r = await turn({ jag_id:g.id, card:miss2, winner_name:'Ticket 88', override:true });
  show('a host cannot override it', r.status===403 && DB.vp_jag_turns.length===1);
  STAFF[VENUE]='manager';
  r = await turn({ jag_id:g.id, card:miss2, winner_name:'Ticket 88', override:true });
  show('a manager can, and it is marked and logged as an override', r.status===200 && DB.vp_jag_turns[1].overridden===true && logOf('override').length===1);
  STAFF[VENUE]='host';
  var third = [5,6,7].filter(function(c){ return c!==sec.spot; })[0];
  NOWMS += 6*3600000;                                   // 19:30 + 6h = 1:30am Brisbane: still the same night
  r = await turn({ jag_id:g.id, card:third, winner_name:'Late' });
  show('1:30am is still the same trading night', r.status===409, brisbaneNightKey(Date.now()));
  NOWMS += 1*3600000;                                   // 2:30am: the next night
  r = await turn({ jag_id:g.id, card:third, winner_name:'Next night' });
  show('after 2am Brisbane it is the next night, and a card may be turned', r.status===200, JSON.stringify(r.body).slice(0,80));

  print('\n== the jackpot ==');
  NOWMS += DAY;
  r = await pot({ jag_id:g.id, jackpot_cents:70000 });
  show('a host can raise it, and the change is logged from and to', r.status===200 && g.jackpot_cents===70000 && logOf('jackpot').some(function(l){ return l.from_cents===50000 && l.to_cents===70000; }));
  r = await pot({ jag_id:g.id, jackpot_cents:100 });
  show('a host cannot lower it', r.status===403 && g.jackpot_cents===70000 && logOf('jackpot').length===1, JSON.stringify(r.body));
  STAFF[VENUE]='manager';
  r = await pot({ jag_id:g.id, jackpot_cents:65000 });
  show('a manager can, and that is logged too', r.status===200 && g.jackpot_cents===65000 && logOf('jackpot').length===2);
  STAFF[VENUE]='host';

  print('\n== the state is checked on every play, against the GAME\'s venue ==');
  DB.vp_venues[0].au_state = 'QLD';
  var nTurns = DB.vp_jag_turns.length;
  RPC_CALLS = [];
  r = await turn({ jag_id:g.id, card:9, winner_name:'Q' });
  show('a turn at a venue now in Queensland is refused by the Worker itself', r.status===403 && /Queensland/.test(r.body.error) && DB.vp_jag_turns.length===nTurns && RPC_CALLS.indexOf('vp_jag_turn')<0, JSON.stringify(r.body)+' '+RPC_CALLS.join());
  r = await pot({ jag_id:g.id, jackpot_cents:80000 });
  show('and so is a jackpot change', r.status===403 && g.jackpot_cents===65000 && RPC_CALLS.indexOf('vp_jag_jackpot')<0);
  DB.vp_venues[0].au_state = '';
  r = await turn({ jag_id:g.id, card:9, winner_name:'Q' });
  show('and a turn once the state has been blanked', r.status===403 && /state on file/.test(r.body.error));
  DB.vp_venues[0].au_state = 'NSW';
  delete STAFF[VENUE]; STAFF[V2]='owner';
  r = await turn({ jag_id:g.id, card:9, winner_name:'Q' });
  show('staff at ANOTHER venue cannot turn this venue\'s card', r.status===403 && /not staff/.test(r.body.error) && DB.vp_jag_turns.length===nTurns);
  STAFF[VENUE]='host'; delete STAFF[V2];

  print('\n== the public board (TV and check page) ==');
  NOWMS += DAY; LOG.length = 0; var rc0 = RPC_CALLS.length;
  r = await pub('venue=test-venue');
  var pb = JSON.stringify(r.body);
  show('it shows the board and the fingerprint', r.status===200 && r.body.board.commitment===g.commitment && r.body.board.turns.length===nTurns, pb.slice(0,120));
  show('never a name typed on the console', pb.indexOf('Sam B.')<0 && pb.indexOf('Ticket 88')<0);
  show('never the spot or key of a live game', pb.indexOf(sec.salt)<0 && r.body.board.revealed_spot==null);
  show('and not the venue id', pb.indexOf(VENUE)<0);
  show('each turned card carries the jackpot it was turned for, so the wall can say what was won', r.body.board.turns[0].jackpot_cents===50000);
  show('the board is ONE database trip, not two', RPC_CALLS.slice(rc0).join()==='vp_jag_public' && !LOG.some(function(l){ return /GET vp_venues/.test(l); }));

  print('\n== the public board is cached and limited ==');
  var before = RPC_CALLS.length;
  for(var q=0;q<10;q++) await pub('venue=test-venue', '198.51.100.'+q);
  show('ten more reads inside five seconds cost the database nothing', RPC_CALLS.length===before, (RPC_CALLS.length-before)+' calls');
  NOWMS += 6000;
  await pub('venue=test-venue');
  show('six seconds on, one read goes to the database again', RPC_CALLS.length===before+1);
  NOWMS += 60000;
  var codes = [];
  for(q=0;q<125;q++){ r = await pub('venue=test-venue', '192.0.2.77'); codes.push(r.status); }
  show('one network is limited to 120 reads a minute', codes.slice(0,120).every(function(c){ return c===200; }) && codes.slice(120).every(function(c){ return c===429; }), codes.slice(115).join(','));
  r = await pub('venue=test-venue', '192.0.2.78');
  show('and the next network is not held up by it', r.status===200);

  print('\n== the Joker ==');
  NOWMS += DAY;
  r = await turn({ jag_id:g.id, card:sec.spot, winner_name:'Jo' });
  show('the Joker\'s card wins', r.status===200 && r.body.is_joker===true && g.status==='won');
  show('and reveals the spot and key', r.body.board.revealed_spot===sec.spot && r.body.board.revealed_salt===sec.salt);
  NOWMS += DAY;
  r = await turn({ jag_id:g.id, card:10===sec.spot?11:10, winner_name:'After' });
  show('nothing more can be turned once it is won', r.status===409);

  print('\n== the check page proves it ==');
  var src = readFile('venueplay/jag-check.html');
  var m = /function fingerprint\(id, spot, salt\)\{[\s\S]*?\n  \}\n  function check\([^)]*\)\{[\s\S]*?\n  \}\n[\s\S]*?  function verifyTurns\(b\)\{[\s\S]*?\n  \}/.exec(src);
  show('fingerprint(), check() and verifyTurns() came out of jag-check.html', !!m);
  function TE(){} TE.prototype.encode = function(s){ return new Uint8Array(utf8(s)); };
  var crypt = { subtle:{ digest: async function(alg, data){ var h=sha256(Array.from(data)), out=new Uint8Array(32); for(var i=0;i<32;i++) out[i]=parseInt(h.substr(i*2,2),16); return out.buffer; } } };
  var page = (new Function('TextEncoder','crypto', m[0] + '\nreturn { check: check, verifyTurns: verifyTurns };'))(TE, crypt);
  var b = board(g.id);
  show('the revealed card and key reproduce the fingerprint shown on day one', await page.check(b.id, b.revealed_spot, b.revealed_salt, g.commitment));
  var other = b.revealed_spot===1 ? 2 : 1;
  show('control: any other card does not', !(await page.check(b.id, other, b.revealed_salt, g.commitment)));
  show('control: the right card with a changed key does not', !(await page.check(b.id, b.revealed_spot, b.revealed_salt.replace(/.$/, function(c){ return c==='0'?'1':'0'; }), g.commitment)));
  show('every turn agrees with the revealed card', page.verifyTurns(b).ok===true, JSON.stringify(page.verifyTurns(b)));
  var lie = JSON.parse(JSON.stringify(b)); lie.turns[0].card = b.revealed_spot; lie.turns[0].is_joker = false;
  show('control: a "No Joker" turn ON the Joker\'s card is caught', page.verifyTurns(lie).ok===false);
  var lie2 = JSON.parse(JSON.stringify(b)); lie2.turns[lie2.turns.length-1].card = other;
  show('control: a Joker turn on any other card is caught', page.verifyTurns(lie2).ok===false);
  var lie3 = JSON.parse(JSON.stringify(b)); lie3.turns = lie3.turns.filter(function(t){ return !t.is_joker; });
  show('control: a "won" game with no winning turn is caught', page.verifyTurns(lie3).ok===false);

  print('\n== ending a jackpot early ==');
  reset();
  await start({ venue_id:VENUE, deck_size:12, jackpot_cents:40000 });
  g = DB.vp_jag_games[0];
  r = await close({ jag_id:g.id, reason:'Renovating the lounge' });
  show('a host cannot end a jackpot with no winner', r.status===403 && g.status==='active');
  STAFF[VENUE]='manager';
  r = await close({ jag_id:g.id, reason:'Renovating the lounge' });
  show('nor can a manager: owner only', r.status===403 && /owner/.test(r.body.error) && g.status==='active', JSON.stringify(r.body));
  STAFF[VENUE]='owner';
  RPC_CALLS = [];
  r = await close({ jag_id:g.id, reason:'  ' });
  show('the owner must say why, and the Worker asks before the database does', r.status===400 && g.status==='active' && RPC_CALLS.indexOf('vp_jag_close')<0);
  r = await close({ jag_id:g.id, reason:'Renovating the lounge' });
  show('the owner can, with a reason, and the spot is revealed for checking', r.status===200 && g.status==='closed' && r.body.board.revealed_spot===DB.vp_jag_secrets[0].spot);
  show('the closure is logged with who and why', logOf('close').length===1 && logOf('close')[0].note==='Renovating the lounge' && /^host:/.test(logOf('close')[0].actor));
  r = await pub('venue=test-venue');
  show('and the reason is on the public board', r.body.board.closed_reason==='Renovating the lounge' && r.body.board.status==='closed');

  print('\n== the pot carries into the next game ==');
  STAFF[VENUE]='host';
  r = await handleJagHost(get('/host/jag?venue_id='+VENUE), ON, json);
  show('the console is told there is a $400 pot waiting to carry', r.body.carry && r.body.carry.jackpot_cents===40000 && r.body.carry.id===g.id, JSON.stringify(r.body.carry));
  r = await start({ venue_id:VENUE, deck_size:20, jackpot_cents:10000, carry:false });
  show('a host cannot start without carrying it', r.status===403 && DB.vp_jag_games.length===1);
  r = await start({ venue_id:VENUE, deck_size:20, jackpot_cents:10000 });
  var g2 = DB.vp_jag_games[1];
  show('by default the new jackpot starts at the carried $400, not the $100 typed', r.status===200 && g2.jackpot_cents===40000 && g2.carried_from===g.id, g2 && g2.jackpot_cents);
  show('and the carry is logged', logOf('carry').length===1 && logOf('carry')[0].from_cents===40000);
  STAFF[VENUE]='owner';
  await close({ jag_id:g2.id, reason:'Moving to Fridays' });
  r = await start({ venue_id:VENUE, deck_size:20, jackpot_cents:10000, carry:false });
  show('the owner can decline the carry, and it is on the record as a fresh start', r.status===200 && DB.vp_jag_games[2].jackpot_cents===10000 && !DB.vp_jag_games[2].carried_from);
  ADMIN=true; STAFF={};
  r = await close({ jag_id:DB.vp_jag_games[2].id, reason:'HQ wind down' });
  show('an HQ admin (View as) can end one too, logged as HQ', r.status===200 && /^vpadmin:/.test(logOf('close').slice(-1)[0].actor));
  ADMIN=false; STAFF[VENUE]='host';

  print('\n== last week\'s game is still checkable ==');
  NOWMS += 60000;
  r = await pub('venue=test-venue');
  show('the public board lists the past games, newest first', r.body.history.length===3 && r.body.history[0].id===DB.vp_jag_games[2].id && r.body.history[2].closed_reason==='Renovating the lounge', JSON.stringify(r.body.history.map(function(h){ return h.id.slice(-2); })));
  r = await pub('venue=test-venue&id='+g.id);
  show('?id= opens a past game with its card and key', r.status===200 && r.body.board.id===g.id && r.body.board.revealed_spot===DB.vp_jag_secrets[0].spot);
  r = await pub('venue=other-venue&id='+g.id);
  show('but not through another venue\'s address', r.status===404 && !r.body.board);
  r = await pub('venue=test-venue&id=not-a-uuid').catch(function(e){ return { status:e.status||400 }; });
  show('a malformed id is refused before it reaches the database', r.status===400);

  print('\n' + (ran - bad) + ' of ' + ran + ' checks passed');
  if (bad) throw new Error(bad + ' jag checks failed');
})().catch(function(e){ print('CRASH ' + (e && e.stack || e)); throw e; });
