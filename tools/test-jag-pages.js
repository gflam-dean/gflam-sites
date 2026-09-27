/* JAG THE JOKER: THE HOST'S PATH AND THE WALL, RUN, NOT READ.

   27 Sep 2026 lesson: "test the host's path, not mine". This runs the WHOLE script of
   venueplay/app/jag/host.html and venueplay/app/jag/screen.html against a fake page and a
   fake game Worker, and does what a host does: sign in, start a jackpot, tap a card, tap
   Turn twice, read the answer. Then it looks at what the TV painted.

   Run: jsc tools/test-jag-pages.js */
var ran = 0, bad = 0;
function show(n, c, extra){ ran++; print((c?'  ok   ':'  FAIL ')+n+(extra?'   -> '+extra:'')); if(!c) bad++; }
function scriptOf(file){ var s = readFile(file), all = s.match(/<script>([\s\S]*?)<\/script>/g) || []; return all.map(function(x){ return x.replace(/^<script>|<\/script>$/g, ''); }).join('\n'); }
function flush(n){ var p = Promise.resolve(); for (var i = 0; i < (n||80); i++) p = p.then(function(){}); return p; }

/* ---- a fake page ---- */
function makeDoc(){
  var els = {};
  function el(id){ if(els[id]) return els[id];
    var cls = {}, h = {};
    var e = els[id] = { id:id, textContent:'', innerHTML:'', value:'', disabled:false, href:'', className:'', style:{}, focused:false,
      classList:{ add:function(c){ cls[c]=1; }, remove:function(c){ delete cls[c]; }, contains:function(c){ return !!cls[c]; },
                  toggle:function(c, on){ if(on===undefined) on=!cls[c]; if(on) cls[c]=1; else delete cls[c]; } },
      addEventListener:function(t, f){ h[t]=f; }, fire:function(t, ev){ if(h[t]) h[t](ev||{ target:e }); } };
    return e; }
  return { els:els, doc:{ getElementById:el, get activeElement(){ return null; } } };
}

/* ---- a fake game Worker, the same answers the real routes give ---- */
var SERVER = { board:null, calls:[] };
function fakeFetch(url, o){
  SERVER.calls.push({ url:url, body:o && o.body ? JSON.parse(o.body) : null });
  var path = url.replace(/^https:\/\/[^\/]+/, '').split('?')[0], b = o && o.body ? JSON.parse(o.body) : {};
  var reply = function(status, d){ return Promise.resolve({ ok:status<300, status:status, json:function(){ return Promise.resolve(d); } }); };
  if(path==='/host/jag') return reply(200, { board:SERVER.board, role:'host' });
  if(path==='/host/jag/start'){ SERVER.board = { id:'j1', name:b.name, deck_size:b.deck_size, jackpot_cents:b.jackpot_cents, commitment:'ab'.repeat(32), status:'active', turns:[], created_at:'2026-09-27T09:00:00Z' }; return reply(200, { board:SERVER.board }); }
  if(path==='/host/jag/turn'){ var joker = b.card===7; if(b.jackpot_cents!=null) SERVER.board.jackpot_cents=b.jackpot_cents;
    SERVER.board.turns.push({ card:b.card, is_joker:joker, jackpot_cents:b.jackpot_cents, winner_name:b.winner_name, turned_at:'2026-09-27T10:00:00Z' });
    if(joker){ SERVER.board.status='won'; SERVER.board.revealed_spot=7; SERVER.board.revealed_salt='f'.repeat(32); }
    return reply(200, { is_joker:joker, board:SERVER.board }); }
  if(path==='/jag/board'){ var pub = JSON.parse(JSON.stringify(SERVER.board)); if(pub) pub.turns = pub.turns.map(function(t){ return { card:t.card, is_joker:t.is_joker, jackpot_cents:t.jackpot_cents, turned_at:t.turned_at }; });
    return reply(200, { venue:'Test Venue', board:pub }); }
  return reply(404, { error:'no route '+path });
}

(async function(){
  print('== the host console ==');
  var P = makeDoc(), $ = P.doc.getElementById;
  var VP = { useClient:function(){}, getClient:function(){ return fakeClient; }, enforceShift:function(){ VP.shift=true; },
             ready:function(){ return Promise.resolve({ authed:true, currentVenueId:'v1', venue:{ slug:'test-venue' }, role:'host' }); } };
  var fakeClient = { auth:{ getSession:function(){ return Promise.resolve({ data:{ session:{ access_token:'tok' } } }); } } };
  var win = { VP:VP };
  (new Function('window','document','supabase','fetch','VP','setTimeout','clearTimeout','AbortController', scriptOf('venueplay/app/jag/host.html')))
    (win, P.doc, { createClient:function(){ return fakeClient; } }, fakeFetch, VP, function(){ return 0; }, function(){}, undefined);
  await flush();
  show('it signs in and applies the 4 hour shift sign-out', $('statusText').textContent==='Signed in' && VP.shift===true);
  show('no jackpot yet: the start form is up, the board is not', !$('startView').classList.contains('hidden') && $('gameView').classList.contains('hidden'));
  $('jName').value='Friday Jag'; $('jDeck').value='20'; $('jPot').value='500';
  $('startBtn').fire('click'); await flush();
  var st = SERVER.calls.filter(function(c){ return /\/host\/jag\/start/.test(c.url); })[0];
  show('Start sends the venue, 20 cards and $500 in cents', st && st.body.venue_id==='v1' && st.body.deck_size===20 && st.body.jackpot_cents===50000, st && JSON.stringify(st.body));
  show('the board is up with 20 face-down cards', !$('gameView').classList.contains('hidden') && ($('grid').innerHTML.match(/data-card=/g)||[]).length===20);
  show('the jackpot reads $500', $('gPot').textContent==='$500');
  show('the fingerprint and the check link are on the console', $('gCommit').textContent===SERVER.board.commitment && /jag-check\?venue=test-venue/.test($('checkLink').href));
  show('before a card is picked, Turn cannot be pressed', $('turnBtn').disabled===true);

  function tapCard(n){ var fake = { disabled:false, getAttribute:function(){ return String(n); } };
    $('grid').fire('click', { target:{ closest:function(){ return fake; } } }); }
  tapCard(3);
  show('tapping card 3 selects it', $('turnBtn').textContent==='Turn card 3' && $('turnBtn').disabled===false && /data-card="3"[^>]*>|class="card sel" data-card="3"/.test($('grid').innerHTML));
  $('whoIn').value='Sam B.'; $('potIn').value='600';
  $('turnBtn').fire('click'); await flush();
  show('ONE tap does not turn it: it asks again', $('turnBtn').textContent==='Tap again to turn card 3' && SERVER.board.turns.length===0);
  $('turnBtn').fire('click'); await flush();
  var tc = SERVER.calls.filter(function(c){ return /\/host\/jag\/turn/.test(c.url); })[0];
  show('the second tap turns card 3 with the name and $600', tc && tc.body.card===3 && tc.body.winner_name==='Sam B.' && tc.body.jackpot_cents===60000, tc && JSON.stringify(tc.body));
  show('the host is told it was not the Joker', /Card 3: not the Joker/.test($('result').textContent), $('result').textContent);
  show('card 3 is now turned and cannot be picked', /class="card gone" data-card="3" disabled/.test($('grid').innerHTML));
  show('the name is on the console history', /Sam B\./.test($('hist').innerHTML));
  tapCard(7); $('turnBtn').fire('click'); $('turnBtn').fire('click'); await flush();
  show('card 7 is the Joker and the console says so, with the jackpot won', /JOKER on card 7! They win \$600/.test($('result').textContent), $('result').textContent);
  show('once won, the turn panel goes and a new jackpot can be started', $('turnPanel').classList.contains('hidden') && !$('againPanel').classList.contains('hidden'));

  print('\n== the TV ==');
  SERVER.board.status='active'; SERVER.board.turns=[SERVER.board.turns[0]]; delete SERVER.board.revealed_spot;
  var T = makeDoc(), timers = [];
  var VVU = { slug:function(){ return 'test-venue'; } };
  T.doc.getElementById('flip').classList.add('hidden');   // as the markup has it
  (new Function('window','VPVenueURL','document','fetch','location','URLSearchParams','setTimeout','clearTimeout', scriptOf('venueplay/app/jag/screen.html')))
    ({ VPVenueURL:VVU }, VVU, T.doc, fakeFetch, { search:'?venue=test-venue' }, function(){ this.get=function(){ return 'test-venue'; }; },
     function(f){ timers.push(f); return timers.length; }, function(){});
  await flush();
  var tg = T.doc.getElementById('grid').innerHTML;
  show('the wall paints all 20 cards', (tg.match(/class="card/g)||[]).length===20);
  show('card 3 shows as turned', /class="card gone"[^>]*>3</.test(tg));
  show('the jackpot and the fingerprint are on the wall', T.doc.getElementById('potV').textContent==='$600' && T.doc.getElementById('fp').textContent===SERVER.board.commitment.slice(0,12));
  show('no name typed on the console reaches the wall', tg.indexOf('Sam')<0 && T.doc.getElementById('flipSub').textContent==='');
  show('the first look does not replay an old card full screen', T.doc.getElementById('flip').classList.contains('hidden'));
  SERVER.board.turns.push({ card:7, is_joker:true, jackpot_cents:60000, winner_name:'Jo', turned_at:'2026-09-27T11:00:00Z' });
  SERVER.board.status='won'; SERVER.board.revealed_spot=7;
  timers.shift()(); await flush();
  show('a newly turned Joker goes up full screen', !T.doc.getElementById('flip').classList.contains('hidden') && T.doc.getElementById('flipBig').textContent==='JOKER!');
  show('and says what was won, and to see the host', /Winner of \$600\. See the host to claim/.test(T.doc.getElementById('flipSub').textContent), T.doc.getElementById('flipSub').textContent);

  print('\n' + (ran - bad) + ' of ' + ran + ' checks passed');
  if (bad) throw new Error(bad + ' jag page checks failed');
})().catch(function(e){ print('CRASH ' + e + ' ' + (e && e.stack)); throw e; });
