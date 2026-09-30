/* JAG THE JOKER: THE HOST'S PATH, THE WALL AND THE WAY ONTO IT, RUN, NOT READ.

   27 Sep 2026 lesson: "test the host's path, not mine". This runs the WHOLE script of
   venueplay/app/jag/host.html and venueplay/app/jag/screen.html against a fake page, a fake
   Realtime client and a fake game Worker, and does what a host does: sign in, start a jackpot,
   tap a card, confirm, read the answer. Then it looks at what the TV painted and heard.

   Review, 30 Sep 2026: the TV never showed Jag at all (the console never broadcast and /tv did
   not know the game), a double tap beat the two-tap guard, and a turn saved whatever was typed
   in the jackpot box. So this also runs the real /tv game router, the real shared screen router
   and the real /app picker line that puts the Jag tile up.

   Run: jsc tools/test-jag-pages.js */
var ran = 0, bad = 0;
function show(n, c, extra){ ran++; print((c?'  ok   ':'  FAIL ')+n+(extra?'   -> '+extra:'')); if(!c) bad++; }
function scriptOf(file){ var s = readFile(file), all = s.match(/<script>([\s\S]*?)<\/script>/g) || []; return all.map(function(x){ return x.replace(/^<script>|<\/script>$/g, ''); }).join('\n'); }
function flush(n){ var p = Promise.resolve(); for (var i = 0; i < (n||80); i++) p = p.then(function(){}); return p; }
function lift(src, from, to){ var i = src.indexOf(from), j = src.indexOf(to, i); return (i >= 0 && j > i) ? src.slice(i, j) : ''; }

/* ---- a fake page ---- */
function makeDoc(){
  var els = {}, dh = {};
  function el(id){ if(els[id]) return els[id];
    var cls = {}, h = {};
    var e = els[id] = { id:id, textContent:'', innerHTML:'', value:'', disabled:false, checked:false, href:'', className:'', style:{}, hidden:false,
      classList:{ add:function(c){ cls[c]=1; }, remove:function(c){ delete cls[c]; }, contains:function(c){ return !!cls[c]; },
                  toggle:function(c, on){ if(on===undefined) on=!cls[c]; if(on) cls[c]=1; else delete cls[c]; } },
      addEventListener:function(t, f){ h[t]=f; }, fire:function(t, ev){ if(h[t]) h[t](ev||{ target:e }); } };
    return e; }
  return { els:els, dh:dh, doc:{ getElementById:el, querySelector:function(){ return el('__status'); }, visibilityState:'visible',
    addEventListener:function(t, f){ dh[t]=f; }, get activeElement(){ return null; }, body:{ appendChild:function(){} }, documentElement:{} } };
}
function isHidden(d, id){ return d.getElementById(id).classList.contains('hidden'); }

/* ---- a fake Realtime client: channels by name, what each one sent, and a way to talk back ---- */
function fakeClient(){
  var chans = {};
  return { chans:chans, auth:{ getSession:function(){ return Promise.resolve({ data:{ session:{ access_token:'tok' } } }); } },
    channel:function(name){ var c = chans[name] = { name:name, sent:[], h:null, cb:null,
        on:function(a, b, h){ this.h = h; return this; }, subscribe:function(cb){ this.cb = cb; return this; },
        send:function(m){ this.sent.push(m.payload); }, unsubscribe:function(){} };
      return c; },
    removeChannel:function(){} };
}
function payloads(c, t){ return c.sent.filter(function(p){ return p.t===t; }); }

/* ---- a fake clock: timers run when the test says so ---- */
function Clock(){ var T = this; T.list = []; T.id = 0;
  T.set = function(f, ms){ T.list.push({ id:++T.id, f:f, ms:ms||0 }); return T.id; };
  T.clear = function(id){ T.list = T.list.filter(function(t){ return t.id!==id; }); };
  T.run = function(pred){ var hit = T.list.filter(function(t){ return pred(t.ms); }); T.list = T.list.filter(function(t){ return !pred(t.ms); }); hit.forEach(function(t){ t.f(); }); return hit.length; }; }

/* ---- a fake game Worker, the same answers the real routes give ---- */
var SERVER;
function freshServer(role){ SERVER = { board:null, calls:[], role:role||'host', carry:null }; }
function fakeFetch(url, o){
  SERVER.calls.push({ url:url, body:o && o.body ? JSON.parse(o.body) : null });
  var path = url.replace(/^https:\/\/[^\/]+/, '').split('?')[0], b = o && o.body ? JSON.parse(o.body) : {};
  var reply = function(status, d){ return Promise.resolve({ ok:status<300, status:status, json:function(){ return Promise.resolve(JSON.parse(JSON.stringify(d))); } }); };
  if(path==='/host/jag') return reply(200, { board:SERVER.board, role:SERVER.role, is_admin:false, carry:SERVER.carry });
  if(path==='/host/jag/start'){ SERVER.board = { id:'j1', venue_id:'v1', name:b.name, deck_size:b.deck_size, jackpot_cents:b.carry && SERVER.carry ? Math.max(b.jackpot_cents, SERVER.carry.jackpot_cents) : b.jackpot_cents,
      commitment:'ab'.repeat(32), status:'active', turns:[], created_at:new Date().toISOString() }; SERVER.carry = null; return reply(200, { board:SERVER.board }); }
  if(path==='/host/jag/turn'){ var joker = b.card===7;
    SERVER.board.turns.push({ card:b.card, is_joker:joker, jackpot_cents:SERVER.board.jackpot_cents, winner_name:b.winner_name, turned_at:new Date().toISOString() });
    if(joker){ SERVER.board.status='won'; SERVER.board.revealed_spot=7; SERVER.board.revealed_salt='f'.repeat(32); }
    return reply(200, { is_joker:joker, board:SERVER.board }); }
  if(path==='/host/jag/jackpot'){ SERVER.board.jackpot_cents = b.jackpot_cents; return reply(200, { board:SERVER.board }); }
  if(path==='/host/jag/close'){ SERVER.board.status='closed'; SERVER.board.revealed_spot=7; SERVER.board.closed_reason=b.reason; return reply(200, { board:SERVER.board }); }
  if(path==='/jag/board'){ var pub = JSON.parse(JSON.stringify(SERVER.board)); if(pub){ delete pub.venue_id; pub.turns = pub.turns.map(function(t){ return { card:t.card, is_joker:t.is_joker, jackpot_cents:t.jackpot_cents, turned_at:t.turned_at }; }); }
    return reply(200, { venue:'Test Venue', board:pub, history:[] }); }
  return reply(404, { error:'no route '+path });
}

function VPcode(s){ return 'C:'+s; }
function bootConsole(role){
  var P = makeDoc(), C = new Clock(), client = fakeClient(), wh = {};
  var VP = { useClient:function(){}, getClient:function(){ return client; }, enforceShift:function(){ VP.shift=true; }, venueCode:VPcode,
             ready:function(){ return Promise.resolve({ authed:true, currentVenueId:'v1', venue:{ slug:'test-venue' }, role:role }); } };
  var win = { VP:VP, addEventListener:function(t, f){ wh[t]=f; } };
  P.doc.getElementById('confirm').classList.add('hidden');   // as the markup has it
  (new Function('window','document','supabase','fetch','VP','setTimeout','clearTimeout','setInterval','AbortController', scriptOf('venueplay/app/jag/host.html')))
    (win, P.doc, { createClient:function(){ return client; } }, fakeFetch, VP, C.set, C.clear, function(f, ms){ C.list.push({ id:++C.id, f:f, ms:'every'+ms }); }, undefined);
  var ch = function(){ return client.chans['vp-'+VPcode('jag-test-venue')]; };
  return { P:P, $:P.doc.getElementById, C:C, VP:VP, win:win, wh:wh, client:client, ch:ch };
}
function tapCard(K, n){ var fake = { disabled:false, getAttribute:function(){ return String(n); } };
  K.$('grid').fire('click', { target:{ closest:function(){ return fake; } } }); }

(async function(){
  print('== the host console ==');
  freshServer('host');
  var K = bootConsole('host'), $ = K.$;
  await flush();
  show('it signs in and applies the 4 hour shift sign-out', K.VP.shift===true);
  show('no jackpot yet: the start form is up, the board is not', !isHidden(K.P.doc,'startView') && isHidden(K.P.doc,'gameView'));
  show('it joins the venue\'s Jag channel (the "jag-" namespace, the raffle console\'s pattern)', !!K.ch());
  K.ch().cb('SUBSCRIBED'); await flush();
  show('subscribed: it says host_here and mode:"jag", which is what puts Jag on the venue TV', payloads(K.ch(),'host_here').length===1 && payloads(K.ch(),'mode').length===1 && payloads(K.ch(),'mode')[0].mode==='jag');

  print('\n== switched off, it leaves the TV alone ==');
  var _realFetch = fakeFetch, OFF = true;
  fakeFetch = function(url, o){ if(OFF && /\/host\/jag\?/.test(url)) return Promise.resolve({ ok:false, status:404, json:function(){ return Promise.resolve({ error:'Jag the Joker is not switched on yet' }); } }); return _realFetch(url, o); };
  var K0 = bootConsole('host'); await flush(); await flush();
  show('with /host/jag answering 404 (JAG_ON unset) it never joins the venue channel, so no mode moves the TV', !K0.ch());
  OFF = false; fakeFetch = _realFetch;

  print('\n== start, with a real confirm ==');
  $('jName').value='Friday Jag'; $('jDeck').value='20'; $('jPot').value='500';
  $('startBtn').fire('click'); await flush();
  show('Start asks first, naming the cards and the jackpot', !isHidden(K.P.doc,'confirm') && $('confirmText').textContent==='20 cards, $500 jackpot, start?', $('confirmText').textContent);
  show('and nothing has been sent yet', !SERVER.calls.some(function(c){ return /\/host\/jag\/start/.test(c.url); }));
  $('confirmYes').fire('click'); await flush();
  show('a tap straight away does nothing: Yes is locked for a moment', !SERVER.calls.some(function(c){ return /\/host\/jag\/start/.test(c.url); }) && $('confirmYes').disabled===true);
  K.C.run(function(ms){ return ms===1500; });
  $('confirmYes').fire('click'); await flush();
  var st = SERVER.calls.filter(function(c){ return /\/host\/jag\/start/.test(c.url); })[0];
  show('after it, Yes sends the venue, 20 cards and $500 in cents', st && st.body.venue_id==='v1' && st.body.deck_size===20 && st.body.jackpot_cents===50000, st && JSON.stringify(st.body));
  show('the board is up with 20 face-down cards', !isHidden(K.P.doc,'gameView') && ($('grid').innerHTML.match(/data-card=/g)||[]).length===20);
  show('the jackpot reads $500', $('gPot').textContent==='$500');
  show('the fingerprint and the check link are on the console', $('gCommit').textContent===SERVER.board.commitment && /jag-check\?venue=test-venue/.test($('checkLink').href));
  var sts = payloads(K.ch(),'state');
  show('the TV is sent the new board', sts.length>=1 && sts[sts.length-1].board.deck_size===20 && sts[sts.length-1].board.id==='j1');
  show('before a card is picked, Turn cannot be pressed', $('turnBtn').disabled===true);

  print('\n== turn a card ==');
  tapCard(K, 3);
  show('tapping card 3 selects it', $('turnBtn').textContent==='Turn card 3' && $('turnBtn').disabled===false && /class="card sel" data-card="3"/.test($('grid').innerHTML));
  $('turnBtn').fire('click'); await flush();
  show('no name or ticket number: it asks for one and does not turn', /name or ticket number/.test($('errBar').textContent) && isHidden(K.P.doc,'confirm'));
  $('whoIn').value='Sam B.'; $('potIn').value='600';
  $('turnBtn').fire('click'); $('turnBtn').fire('click'); $('confirmYes').fire('click'); $('confirmYes').fire('click'); await flush();
  show('a double tap on Turn and on Yes turns nothing', SERVER.board.turns.length===0);
  show('the confirm names the card and the SAVED jackpot, not the unsaved $600', $('confirmText').textContent==='Turn card 3 for $500?' && /\$600 in the jackpot box is not saved/.test($('confirmSub').textContent), $('confirmText').textContent+' / '+$('confirmSub').textContent);
  K.C.run(function(ms){ return ms===1500; });
  $('confirmYes').fire('click'); await flush();
  var tc = SERVER.calls.filter(function(c){ return /\/host\/jag\/turn/.test(c.url); })[0];
  show('Yes turns card 3 for Sam B., and sends NO jackpot with it', tc && tc.body.card===3 && tc.body.winner_name==='Sam B.' && !('jackpot_cents' in tc.body), tc && JSON.stringify(tc.body));
  show('the host is told it was not the Joker', /Card 3: not the Joker/.test($('result').textContent), $('result').textContent);
  show('card 3 is now turned and cannot be picked', /class="card gone" data-card="3" disabled/.test($('grid').innerHTML));
  show('the name is on the console history', /Sam B\./.test($('hist').innerHTML));
  var tm = payloads(K.ch(),'turn');
  show('the TV is sent the turn with the board', tm.length===1 && tm[0].card===3 && tm[0].is_joker===false && tm[0].board.turns.length===1);
  show('and no name typed on the console goes over the channel', JSON.stringify(K.ch().sent).indexOf('Sam')<0);
  show('one card a night: Turn is shut for a host for the rest of tonight', $('turnBtn').disabled===true && $('turnBtn').textContent==='One card a night' && !isHidden(K.P.doc,'tonightNote') && isHidden(K.P.doc,'overWrap'));
  show('a host sees no End jackpot panel (owners only)', isHidden(K.P.doc,'closePanel'));

  print('\n== the TV asks, the console answers; the console leaves, the TV goes back ==');
  var nState = payloads(K.ch(),'state').length;
  K.ch().h({ payload:{ t:'tv_here', hello:true } }); await flush();
  show('a TV that just loaded is sent the mode and the board again', payloads(K.ch(),'mode').length>=2 && payloads(K.ch(),'state').length===nState+1 && $('statusText').textContent==='Connected');
  K.wh.pagehide();
  show('closing the console gives the TV back to the venue\'s ads', payloads(K.ch(),'to_ads').length===1);
  $('toAdsBtn').fire('click'); await flush();
  show('and so does End game', payloads(K.ch(),'to_ads').length===2);

  print('\n== a second device, and a reload ==');
  SERVER.board.jackpot_cents = 90000;
  var nGets = SERVER.calls.filter(function(c){ return /\/host\/jag\?/.test(c.url); }).length;
  nState = payloads(K.ch(),'state').length;
  K.C.run(function(ms){ return ms==='every30000'; }); await flush();
  show('every 30 seconds the console reads the board again', SERVER.calls.filter(function(c){ return /\/host\/jag\?/.test(c.url); }).length===nGets+1);
  show('and a change made on another device reaches this console and the TV', $('gPot').textContent==='$900' && payloads(K.ch(),'state').length===nState+1);
  SERVER.role = 'manager';
  var K2 = bootConsole('manager'); await flush();
  show('a reloaded console rebuilds the last turn\'s result line', /Last card: 3/.test(K2.$('result').textContent), K2.$('result').textContent);
  show('a manager may turn a second card tonight, by ticking the override', !isHidden(K2.P.doc,'overWrap'));
  tapCard(K2, 7); K2.$('whoIn').value='Ticket 142';
  show('without the tick, Turn stays shut', K2.$('turnBtn').disabled===true);
  K2.$('overIn').checked=true; K2.$('overIn').fire('change');
  K2.$('turnBtn').fire('click'); K2.C.run(function(ms){ return ms===1500; }); K2.$('confirmYes').fire('click'); await flush();
  var tc2 = SERVER.calls.filter(function(c){ return /\/host\/jag\/turn/.test(c.url); })[1];
  show('with it, the turn goes with override:true', tc2 && tc2.body.override===true && tc2.body.card===7, tc2 && JSON.stringify(tc2.body));
  show('card 7 is the Joker and the console says so, with the jackpot won', /JOKER on card 7! They win \$900/.test(K2.$('result').textContent), K2.$('result').textContent);
  show('once won, the turn panel goes and a new jackpot can be started', isHidden(K2.P.doc,'turnPanel') && !isHidden(K2.P.doc,'againPanel'));

  print('\n== ending early: owner only, with a reason, and the pot carries ==');
  freshServer('owner');
  SERVER.board = { id:'j2', venue_id:'v1', name:'Jag', deck_size:12, jackpot_cents:40000, commitment:'cd'.repeat(32), status:'active', turns:[], created_at:new Date().toISOString() };
  var K3 = bootConsole('owner'); await flush();
  show('the owner sees the End jackpot panel', !isHidden(K3.P.doc,'closePanel'));
  K3.$('closeBtn').fire('click'); await flush();
  show('no reason: it asks for one and does not end it', /Say why/.test(K3.$('errBar').textContent) && isHidden(K3.P.doc,'confirm') && SERVER.board.status==='active');
  K3.$('closeWhy').value='Closing for renovations';
  K3.$('closeBtn').fire('click'); await flush();
  show('with one, it asks first and says the $400 carries', !isHidden(K3.P.doc,'confirm') && /\$400 carries into the next game/.test(K3.$('confirmSub').textContent), K3.$('confirmSub').textContent);
  K3.C.run(function(ms){ return ms===1500; }); SERVER.carry = { id:'j2', jackpot_cents:40000 }; K3.$('confirmYes').fire('click'); await flush();
  var cc = SERVER.calls.filter(function(c){ return /\/host\/jag\/close/.test(c.url); })[0];
  show('the reason goes to the server', cc && cc.body.reason==='Closing for renovations');
  K3.$('againBtn').fire('click'); await flush();
  show('starting again, the form shows the carried jackpot and says so', !isHidden(K3.P.doc,'startView') && K3.$('jPot').value==400 && /carries into this one/.test(K3.$('carryNote').textContent), K3.$('jPot').value+' '+K3.$('carryNote').textContent);
  K3.$('jPot').value='100'; K3.$('jDeck').value='52';
  K3.$('startBtn').fire('click'); await flush();
  show('and a lower figure typed still starts at the carried $400', K3.$('confirmText').textContent==='52 cards, $400 jackpot, start?', K3.$('confirmText').textContent);

  print('\n== the TV ==');
  freshServer('host');
  SERVER.board = { id:'j1', venue_id:'v1', name:'Friday Jag', deck_size:20, jackpot_cents:60000, commitment:'ab'.repeat(32), status:'active',
                   turns:[ { card:3, is_joker:false, jackpot_cents:60000, winner_name:'Sam B.', turned_at:'2026-09-20T10:00:00Z' } ], created_at:'2026-09-20T09:00:00Z' };
  function bootScreen(hop){
    var T = makeDoc(), C = new Clock(), client = fakeClient(), loc = { search:'?venue=test-venue', origin:'https://venueplay.com.au', href:'', replaced:null, replace:function(u){ this.replaced=u; } };
    var ss = { v:{ vpTvHop:hop||'' }, getItem:function(k){ return this.v[k]||null; }, setItem:function(k, x){ this.v[k]=x; }, removeItem:function(k){ delete this.v[k]; } };
    var ls = { getItem:function(){ return null; }, setItem:function(){} };
    var qr = { urls:[] }, VVU = { slug:function(){ return 'test-venue'; }, fellBack:function(){ return false; } };
    var win = { VPVenueURL:VVU, VPQR:{ draw:function(el, u){ qr.urls.push(u); } }, location:loc };
    T.doc.getElementById('flip').classList.add('hidden');   // as the markup has it
    (new Function('window','VPVenueURL','document','fetch','location','localStorage','sessionStorage','supabase','setTimeout','clearTimeout', scriptOf('venueplay/app/jag/screen.html')))
      (win, VVU, T.doc, fakeFetch, loc, ls, ss, { createClient:function(){ return client; } }, C.set, C.clear);
    return { T:T, $:T.doc.getElementById, C:C, client:client, loc:loc, qr:qr, ch:function(){ return client.chans['vp-'+venueCodeReal('jag-test-venue')]; } };
  }
  var venueCodeReal = (new Function(lift(readFile('venueplay/app/jag/screen.html'), '  function venueCode(slug){', '  /* The venue, the signing gate') + 'return venueCode;'))();
  var nb = SERVER.calls.length;
  var cold = bootScreen(''); await flush();
  show('opened cold (not through /tv), the screen bounces to /tv and reads nothing', cold.loc.replaced==='/tv?venue=test-venue' && SERVER.calls.length===nb, cold.loc.replaced);
  var S1 = bootScreen('test-venue'); await flush();
  var tg = S1.$('grid').innerHTML;
  show('through /tv, the wall paints all 20 cards', (tg.match(/class="card/g)||[]).length===20);
  show('card 3 shows as turned', /class="card gone"[^>]*>3</.test(tg));
  show('the jackpot is on the wall', S1.$('potV').textContent==='$600');
  show('32 characters of the fingerprint are on the wall, not 12', S1.$('fp').textContent===SERVER.board.commitment.slice(0,32));
  show('a QR on the wall goes to /jag-check for this venue', S1.qr.urls[0]==='https://venueplay.com.au/jag-check?venue=test-venue', S1.qr.urls[0]);
  show('no name typed on the console reaches the wall', tg.indexOf('Sam')<0 && S1.$('flipSub').textContent==='');
  show('the first look does not replay an old card full screen', isHidden(S1.T.doc,'flip'));
  show('it polls the Worker only every 30 seconds, as a fallback', S1.C.list.some(function(t){ return t.ms===30000; }) && !S1.C.list.some(function(t){ return t.ms===4000; }));
  show('it joins the console\'s channel', !!S1.ch());
  S1.ch().cb('SUBSCRIBED');
  show('subscribed, it says tv_here with hello so the console replays the board', S1.ch().sent.some(function(p){ return p.t==='tv_here' && p.hello===true; }));
  var pub2 = JSON.parse(JSON.stringify(SERVER.board)); delete pub2.venue_id; pub2.turns = pub2.turns.map(function(t){ return { card:t.card, is_joker:t.is_joker, jackpot_cents:t.jackpot_cents, turned_at:t.turned_at }; });
  pub2.jackpot_cents = 75000;
  S1.ch().h({ payload:{ t:'state', board:pub2 } }); await flush();
  show('a pushed state repaints the wall straight away', S1.$('potV').textContent==='$750');
  pub2.turns.push({ card:7, is_joker:true, jackpot_cents:75000, turned_at:new Date().toISOString() }); pub2.status='won'; pub2.revealed_spot=7;
  S1.ch().h({ payload:{ t:'turn', card:7, is_joker:true, jackpot_cents:75000, board:pub2 } }); await flush();
  show('a pushed turn goes up full screen at once', !isHidden(S1.T.doc,'flip') && S1.$('flipBig').textContent==='JOKER!');
  show('and says what was won, and to see the host', /Winner of \$750\. See the host to claim/.test(S1.$('flipSub').textContent), S1.$('flipSub').textContent);
  S1.$('flip').classList.add('hidden');
  SERVER.board = JSON.parse(JSON.stringify(pub2));
  S1.C.run(function(ms){ return ms===30000; }); await flush();
  show('the fallback poll bringing the same card does not show it twice', isHidden(S1.T.doc,'flip'));
  var S2 = bootScreen('test-venue'); await flush();
  show('a screen that arrives within a minute of a turn still shows it full screen', !isHidden(S2.T.doc,'flip') && S2.$('flipBig').textContent==='JOKER!');
  S2.ch().h({ payload:{ t:'to_ads' } });
  show('to_ads sends the wall back to /tv', S2.loc.href==='/tv?venue=test-venue');
  SERVER.board.turns[1].turned_at = '2026-09-20T11:00:00Z';   // last week's: nothing to show full screen
  var S3 = bootScreen('test-venue'); await flush();
  S3.C.run(function(ms){ return ms===10*60*1000; });
  show('ten minutes with no word from a console, the wall goes back to /tv on its own', S3.loc.href==='/tv?venue=test-venue');

  print('\n== the way onto the TV: /tv, the shared router and the /app picker ==');
  var tvSrc = readFile('venueplay/tv.html');
  var router = lift(tvSrc, '  (function unifiedRouter(){', '  // ---- per-venue screen content ----');
  show('tv.html\'s game router lifted', !!router);
  var tvClient = fakeClient(), embedded = [];
  (new Function('VENUE_SLUG','client','venueCode','vpGate','noteHostAlive','noteDeaf','enterEmbed','tvMode','lastBingoAt','BINGO_LIVE_MS','setTimeout', router))
    ('test-venue', tvClient, venueCodeReal, function(p, cb){ cb(p); }, function(){}, function(){}, function(g){ embedded.push(g); }, 'ads', 0, 120000, function(){});
  var tvJag = tvClient.chans['vp-'+venueCodeReal('jag-test-venue')];
  show('/tv listens on the venue\'s Jag channel', !!tvJag);
  tvJag.h({ payload:{ t:'mode', mode:'jag' } });
  show('and mode:"jag" puts /app/jag/screen in its frame', embedded.join()==='jag', embedded.join());
  var fr = {}; (new Function('globalThis', readFile('venueplay/app/vp-screen-router.js')))(fr);
  var rc = fakeClient();
  fr.VPScreenRouter.start({ client:rc, self:'raffle', slug:'test-venue', venueCode:venueCodeReal, busy:function(){ return false; } });
  var routerJag = rc.chans['vp-'+venueCodeReal('jag-test-venue')];
  show('every other game screen watches the Jag channel too', !!routerJag);
  var app = readFile('venueplay/app/index.html');
  var pick = lift(app, '  var GAME_PATHS=', '  function landAfterConnect(){');
  function picker(search){ var tile = makeDoc().doc.getElementById('jagTile'); tile.classList.add('hidden'); var went = { href:'' };
    var api = (new Function('document','location','window','__ctx','$', pick + '\nreturn { selectGame:selectGame };'))
      ({ getElementById:function(id){ return id==='jagTile' ? tile : null; }, querySelectorAll:function(){ return []; } }, { search:search }, { location:went }, { venue:{ slug:'test-venue' } }, function(){ return { classList:{ add:function(){}, remove:function(){} }, style:{} }; });
    return { tile:tile, api:api, went:went }; }
  var off = picker('');
  show('/app keeps the Jag tile hidden', off.tile.classList.contains('hidden'));
  var on = picker('?jag=1');
  show('/app?jag=1 shows it', !on.tile.classList.contains('hidden'));
  on.api.selectGame('jag');
  show('and it opens the Jag console for this venue', on.went.href==='/app/jag/host.html?venue=test-venue', on.went.href);

  print('\n' + (ran - bad) + ' of ' + ran + ' checks passed');
  if (bad) throw new Error(bad + ' jag page checks failed');
})().catch(function(e){ print('CRASH ' + e + ' ' + (e && e.stack)); throw e; });
