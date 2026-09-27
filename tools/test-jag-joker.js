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

/* ---- migration 95's functions, modelled ---- */
var STAFF = {};   // venue_id -> role of HOST there
function staff(venueId){ var v=(DB.vp_venues||[]).filter(function(x){ return x.id===venueId; })[0];
  if(!STAFF[venueId]) return { status:'not_staff' }; if(!v) return { status:'venue_missing' };
  if(v.status!=='active') return { status:'venue_paused' }; return { status:'ok', role:STAFF[venueId] }; }
function board(id){ var g=DB.vp_jag_games.filter(function(x){ return x.id===id; })[0]; if(!g) return null;
  return { id:g.id, venue_id:g.venue_id, name:g.name, deck_size:g.deck_size, jackpot_cents:g.jackpot_cents, commitment:g.commitment,
    status:g.status, created_at:g.created_at, ended_at:g.ended_at,
    revealed_spot: g.status!=='active' ? g.revealed_spot : null, revealed_salt: g.status!=='active' ? g.revealed_salt : null,
    turns: DB.vp_jag_turns.filter(function(t){ return t.jag_id===id; }).map(function(t){ return { card:t.card, is_joker:t.is_joker, jackpot_cents:t.jackpot_cents, winner_name:t.winner_name, turned_at:t.turned_at }; }) }; }
var RPC_CALLS = [];
sbRpc = async function(env, fn, a){
  RPC_CALLS.push(fn);
  var g, w;
  if(fn==='vp_host_staff'){ w=staff(a.p_venue_id); return w; }
  if(fn==='vp_jag_current'){ var gs=DB.vp_jag_games.filter(function(x){ return x.venue_id===a.p_venue_id; })
      .sort(function(x,y){ return (y.status==='active')-(x.status==='active') || (y.created_at>x.created_at?1:-1); });
    return gs.length ? board(gs[0].id) : null; }
  if(fn==='vp_jag_start'){ w=staff(a.p_venue_id); if(w.status!=='ok') return { status:w.status };
    if(a.p_spot<1||a.p_spot>a.p_deck_size) return { status:'bad_spot' };
    if(DB.vp_jag_games.some(function(x){ return x.venue_id===a.p_venue_id && x.status==='active'; })) return { status:'already_running' };
    DB.vp_jag_games.push({ id:a.p_jag_id, venue_id:a.p_venue_id, name:a.p_name||'Jag the Joker', deck_size:a.p_deck_size, jackpot_cents:a.p_jackpot_cents,
      commitment:a.p_commitment, status:'active', created_at:new Date(NOWMS + DB.vp_jag_games.length).toISOString() });
    DB.vp_jag_secrets.push({ jag_id:a.p_jag_id, spot:a.p_spot, salt:a.p_salt });
    return { status:'ok', board:board(a.p_jag_id) }; }
  g = DB.vp_jag_games.filter(function(x){ return x.id===a.p_jag_id; })[0];
  if(!g) return { status:'no_game' };
  w=staff(g.venue_id); if(w.status!=='ok') return { status:w.status };
  if(fn==='vp_jag_close' && w.role!=='owner' && w.role!=='manager') return { status:'not_manager' };
  if(g.status!=='active') return { status:'finished' };
  var s=DB.vp_jag_secrets.filter(function(x){ return x.jag_id===g.id; })[0];
  if(fn==='vp_jag_turn'){
    if(a.p_card<1||a.p_card>g.deck_size) return { status:'bad_card' };
    if(DB.vp_jag_turns.some(function(t){ return t.jag_id===g.id && t.card===a.p_card; })) return { status:'already_turned' };
    var joker = a.p_card===s.spot;
    if(a.p_jackpot_cents!=null && a.p_jackpot_cents>=0) g.jackpot_cents=a.p_jackpot_cents;
    DB.vp_jag_turns.push({ jag_id:g.id, card:a.p_card, winner_name:a.p_winner_name||null, jackpot_cents:g.jackpot_cents, is_joker:joker, turned_at:new Date(NOWMS).toISOString() });
    if(joker){ g.status='won'; g.revealed_spot=s.spot; g.revealed_salt=s.salt; }
    return { status:'ok', is_joker:joker, board:board(g.id) }; }
  if(fn==='vp_jag_jackpot'){ g.jackpot_cents=Math.max(0,a.p_jackpot_cents); return { status:'ok', board:board(g.id) }; }
  if(fn==='vp_jag_close'){ g.status='closed'; g.revealed_spot=s.spot; g.revealed_salt=s.salt; return { status:'ok', board:board(g.id) }; }
  throw new Error('unmodelled ' + fn);
};

var V2='33333333-3333-4333-8333-333333333333', VQ='44444444-4444-4444-8444-444444444444';
function reset(){ DB = { vp_venues:[ { id:VENUE, slug:'test-venue', name:'Test Venue', status:'active', au_state:'NSW' },
                                     { id:V2, slug:'other-venue', name:'Other', status:'active', au_state:'VIC' },
                                     { id:VQ, slug:'qld-venue', name:'QLD', status:'active', au_state:'QLD' } ],
                         vp_jag_games:[], vp_jag_secrets:[], vp_jag_turns:[] };
                 STAFF = {}; STAFF[VENUE]='host'; STAFF[VQ]='owner'; RPC_CALLS = []; }
var ON = Object.assign({}, ENV, { JAG_ON: '1' });
function get(path){ return { url:'https://w'+path, headers:{ get:function(){ return ''; } } }; }
async function start(body, env){ BODY = body; return await handleJagStart({ headers:{ get:function(){ return ''; } } }, env || ON, json); }
async function turn(body){ BODY = body; return await handleJagTurn({}, ON, json); }

(async function(){
  reset();
  print('\n== it is OFF until the Worker is told otherwise ==');
  var r = await start({ venue_id:VENUE, deck_size:20, jackpot_cents:50000 }, ENV);
  show('no JAG_ON: start answers 404 and touches nothing', r.status===404 && DB.vp_jag_games.length===0);
  r = await handleJagBoard(get('/jag/board?venue=test-venue'), ENV, json);
  show('no JAG_ON: the public board answers 404', r.status===404);
  show('every Jag route checks the switch first', ['handleJagBoard','handleJagHost','handleJagStart','handleJagTurn','handleJagJackpot','handleJagClose']
    .every(function(n){ return /^\s*if \(!jagOn\(env\)\) return jagOff\(json\);/m.test(String(globalThis[n]).split('\n')[1]); }));

  print('\n== licensing ==');
  r = await start({ venue_id:VQ, deck_size:20, jackpot_cents:50000 });
  show('a Queensland venue is refused, even its owner', r.status===403 && /Queensland/.test(r.body.error) && DB.vp_jag_games.length===0, JSON.stringify(r.body));
  r = await start({ venue_id:V2, deck_size:20, jackpot_cents:50000 });
  show('somebody who is not staff at the venue cannot start one', r.status===403 && DB.vp_jag_games.length===0);
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
  await start({ venue_id:VENUE, deck_size:20, jackpot_cents:50000 });
  g = DB.vp_jag_games[0]; sec = DB.vp_jag_secrets[0];
  var miss = sec.spot===1 ? 2 : 1;
  r = await turn({ jag_id:g.id, card:miss, winner_name:'Sam B.', jackpot_cents:60000 });
  show('a card that is not the Joker says so', r.status===200 && r.body.is_joker===false);
  show('and the jackpot is carried at the new amount', g.jackpot_cents===60000 && g.status==='active');
  show('and still nothing reveals the spot', JSON.stringify(r.body).indexOf(sec.salt)<0 && r.body.board.revealed_spot==null);
  r = await turn({ jag_id:g.id, card:miss, winner_name:'Again' });
  show('the same card cannot be turned twice', r.status===409 && /already been turned/.test(r.body.error));
  r = await turn({ jag_id:g.id, card:21 });
  show('a card off the board is refused', r.status===400);

  print('\n== the public board (TV and check page) ==');
  r = await handleJagBoard(get('/jag/board?venue=test-venue'), ON, json);
  var pub = JSON.stringify(r.body);
  show('it shows the board and the fingerprint', r.status===200 && r.body.board.commitment===g.commitment && r.body.board.turns.length===1);
  show('never a name typed on the console', pub.indexOf('Sam B.')<0);
  show('never the spot or key of a live game', pub.indexOf(sec.salt)<0 && r.body.board.revealed_spot==null);
  show('and not the venue id', pub.indexOf(VENUE)<0);
  show('each turned card carries the jackpot it was turned for, so the wall can say what was won', r.body.board.turns[0].jackpot_cents===60000);

  print('\n== the Joker ==');
  r = await turn({ jag_id:g.id, card:sec.spot, winner_name:'Jo' });
  show('the Joker\'s card wins', r.status===200 && r.body.is_joker===true && g.status==='won');
  show('and reveals the spot and key', r.body.board.revealed_spot===sec.spot && r.body.board.revealed_salt===sec.salt);
  r = await turn({ jag_id:g.id, card: miss===2?3:2 });
  show('nothing more can be turned once it is won', r.status===409);

  print('\n== the check page proves it ==');
  var src = readFile('venueplay/jag-check.html');
  var m = /function fingerprint\(id, spot, salt\)\{[\s\S]*?\n  \}\n  function check\([^)]*\)\{[\s\S]*?\n  \}/.exec(src);
  show('fingerprint() and check() came out of jag-check.html', !!m);
  function TE(){} TE.prototype.encode = function(s){ return new Uint8Array(utf8(s)); };
  var crypt = { subtle:{ digest: async function(alg, data){ var h=sha256(Array.from(data)), out=new Uint8Array(32); for(var i=0;i<32;i++) out[i]=parseInt(h.substr(i*2,2),16); return out.buffer; } } };
  var page = (new Function('TextEncoder','crypto', m[0] + '\nreturn { check: check };'))(TE, crypt);
  var b = r.body && r.body.board || board(g.id);
  b = board(g.id);
  show('the revealed card and key reproduce the fingerprint shown on day one', await page.check(b.id, b.revealed_spot, b.revealed_salt, g.commitment));
  var other = b.revealed_spot===1 ? 2 : 1;
  show('control: any other card does not', !(await page.check(b.id, other, b.revealed_salt, g.commitment)));
  show('control: the right card with a changed key does not', !(await page.check(b.id, b.revealed_spot, b.revealed_salt.replace(/.$/, function(c){ return c==='0'?'1':'0'; }), g.commitment)));

  print('\n== closing ==');
  reset();
  await start({ venue_id:VENUE, deck_size:12, jackpot_cents:0 });
  g = DB.vp_jag_games[0];
  BODY = { jag_id:g.id }; r = await handleJagClose({}, ON, json);
  show('a host cannot end a jackpot with no winner', r.status===403 && g.status==='active');
  STAFF[VENUE]='manager';
  r = await handleJagClose({}, ON, json);
  show('a manager can, and the spot is revealed for checking', r.status===200 && g.status==='closed' && r.body.board.revealed_spot===DB.vp_jag_secrets[0].spot);

  print('\n' + (ran - bad) + ' of ' + ran + ' checks passed');
  if (bad) throw new Error(bad + ' jag checks failed');
})().catch(function(e){ print('CRASH ' + (e && e.stack || e)); throw e; });
