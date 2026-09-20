/* Can a stranger on the bingo channel speak for somebody else's phone?

   Two halves, both run against the files that ship.
   1. vp-phonekey.js itself: what is signed, what is checked, what a replay looks like.
   2. The bingo console's REAL onMsg, lifted out of app/index.html, fed exactly what the audit of
      20 Sep 2026 fed it: a forged rename, a forged claim on her ticket, a forged leave.

   jsc has no WebCrypto, so tools/rig-fake-webcrypto.js stands in for it. That rig keeps the one
   property that matters (only the private key's holder can make a signature that verifies) and
   proves nothing about ECDSA. THE REAL CURVE IS CHECKED IN A REAL BROWSER: open
   https://venueplay.com.au/play on any room, and in the console run
       VPPhoneKey.ensure("SELFTEST").then(function(id){return id.sign({t:"join",name:"x",cards:1});}).then(VPPhoneKey.verify).then(console.log)
   which must print ok:true, and the same with .then(function(m){m.name="y";return m;}) before
   verify, which must print ok:false.

   Run from the repo root:  jsc tools/test-phones-cannot-be-impersonated.js
*/
load('tools/rig-fake-webcrypto.js');
var window = this;
load('venueplay/app/vp-phonekey.js');
var K = VPPhoneKey;
var fails = 0, ran = 0;
function check(name, ok, saw) { ran++; if (ok) print('  ok   ' + name); else { print('  FAIL ' + name + (saw === undefined ? '' : '   saw: ' + JSON.stringify(saw))); fails++; } }
function wait(p) { var out, err; p.then(function (v) { out = v; }, function (e) { err = e; }); drainMicrotasks(); if (err) throw err; return out; }
function copy(o) { return JSON.parse(JSON.stringify(o)); }

print('the key and the pid');
var marg = wait(K.ensure('ROOMAA')), dazza = wait(K.ensure('ROOMBB'));
check('a phone gets a pid that says it is keyed', K.isKeyed(marg.pid) && /^k1_[A-Za-z0-9_-]{32}$/.test(marg.pid), marg.pid);
check('the pid fits the shape the console already insists on', /^[A-Za-z0-9_-]{1,40}$/.test(marg.pid), marg.pid);
check('the same phone in the same room is the same player after a reload', wait(K.ensure('ROOMAA')).pid === marg.pid);
check('the same phone in ANOTHER room is somebody else, so venues cannot track a person between them', dazza.pid !== marg.pid);

print('what a signature covers');
var join = wait(marg.sign({ t: 'join', pid: 'anything-the-caller-typed', name: 'Margaret', cards: 2 }));
check('the pid that goes out is the key\'s own, whatever the page put in', join.pid === marg.pid, join.pid);
check('CONTROL: her own signed join verifies', wait(K.verify(join)).ok === true, wait(K.verify(join)));
function tampered(field, value) { var m = copy(join); m[field] = value; return wait(K.verify(m)).ok; }
check('change the NAME and it no longer verifies', tampered('name', 'Dazza') === false);
check('change the ticket count and it no longer verifies', tampered('cards', 6) === false);
check('turn the join into a LEAVE and it no longer verifies', tampered('t', 'leave') === false);
check('change the counter and it no longer verifies', tampered('n', join.n + 1) === false);
var claim = wait(marg.sign({ t: 'claim', name: 'Margaret', cardNo: 7 }));
var c2 = copy(claim); c2.cardNo = 8;
check('a claim cannot be moved to another ticket', wait(K.verify(c2)).ok === false);

print('what a stranger can send');
check('her pid with no signature at all: refused', wait(K.verify({ t: 'claim', pid: marg.pid, cardNo: 7 })).ok === false);
var his = wait(dazza.sign({ t: 'claim', name: 'Dazza', cardNo: 7 }));
var forged = copy(his); forged.pid = marg.pid;
check('his own valid signature with HER pid pasted on: refused, because his key is not her pid', wait(K.verify(forged)).ok === false, wait(K.verify(forged)));
/* THE REAL ATTACK, and the one the pid rule exists for. He does not borrow a signature: he makes
   his own key, writes HER pid into the message, signs THAT properly, and sends his own public
   key with it. Everything about the signature is genuine. The only thing wrong is that his key
   is not the key her pid is the fingerprint of. */
function b64u(buf) { var b = new Uint8Array(buf), t = ''; for (var i = 0; i < b.length; i++) t += String.fromCharCode(b[i]); return btoa(t).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
var kp = wait(crypto.subtle.generateKey()), hisRaw = wait(crypto.subtle.exportKey('raw', kp.publicKey));
var attack = { t: 'claim', pid: marg.pid, n: join.n + 5000, name: 'Dazza', cardNo: 7, pk: b64u(hisRaw) };
attack.sig = b64u(wait(crypto.subtle.sign({}, kp.privateKey, new TextEncoder().encode(K.canon(attack)))));
var attackSaw = wait(K.verify(attack));
check('a message he signed PROPERLY with his own key, naming her pid: refused', attackSaw.ok === false, attackSaw);
var swap = copy(join); swap.pk = his.pk;
check('her message with his public key swapped in: refused', wait(K.verify(swap)).ok === false);
check('garbage where the key or signature should be: refused, and verify never throws',
  wait(K.verify({ t: 'leave', pid: marg.pid, n: 5, pk: '!!!', sig: '???' })).ok === false && wait(K.verify({ t: 'leave', pid: marg.pid, n: 'soon', pk: join.pk, sig: join.sig })).ok === false);
var legacy = wait(K.verify({ t: 'join', pid: 'abc123def456', name: 'Old phone' }));
check('an old random pid is reported as LEGACY, for the console to decide', legacy.ok === true && legacy.legacy === true, legacy);

print('a real message, played back');
var seen = {}, NOW = join.n + 1000;
check('the first time is fresh', K.fresh(seen, join, NOW) === true);
check('the very same message again is not', K.fresh(seen, join, NOW) === false);
var leave = wait(marg.sign({ t: 'leave' }));
check('a later message from her is fresh', leave.n > join.n && K.fresh(seen, leave, NOW) === true, [join.n, leave.n]);
check('and her older join, replayed after it, is not', K.fresh(seen, join, NOW) === false);
check('a message more than a day old is refused even by a console that has never seen her', K.fresh({}, join, join.n + 25 * 3600 * 1000) === false);

print('the bingo console, with the forged messages the audit sent');
var html = readFile('venueplay/app/index.html');
function grab(name) { var i = html.indexOf('function ' + name + '('); if (i < 0) return null; var d = 0, st = false;
  for (var j = i; j < html.length; j++) { if (html[j] === '{') { d++; st = true; } else if (html[j] === '}') { d--; if (st && d === 0) return html.slice(i, j + 1); } } return null; }
var onMsgSrc = grab('onMsg'), onPhoneSrc = grab('onPhoneMsg');
check('the console has a gate in front of its phone handler', !!onMsgSrc && !!onPhoneSrc && /VPPhoneKey\.verify/.test(onMsgSrc), !!onPhoneSrc);
var sent = []; function send(o) { sent.push(o); }
var CARD = [[1, 0, 0, 0, 0, 0, 0, 0, 0]], MAX_TIE = 5, G;
function tvHere() {} function ticketsFor() { return 1; } function dealFor(p) { p.cards = [{ cardNo: 99, card: [[2]] }]; }
function sendCards(pid) { send({ t: 'cards', pid: pid }); } function sendPlayers() {} function sendState() {} function saveGame() {}
function renderJoinCounts() {} function renderConsole() {} function renderClaimQueue() {} function sendClaimPending() {} function claimChime() {} function checkPattern() { return true; }
var m1 = /var LEGACY_PHONES_OK\s*=\s*(true|false);/.exec(html);
var LEGACY_PHONES_OK = m1 ? (m1[1] === 'true') : true, _phoneChain = Promise.resolve();
if (onMsgSrc && onPhoneSrc) { eval(onMsgSrc); eval(onPhoneSrc); }
function room() { G = { status: 'running', won: false, idx: 10, claimIdx: -1, claims: [], lastWins: [], claimSeq: 0, allowEarly: false, peak: 1, players: {}, order: [], seenN: {} };
  G.players[marg.pid] = { name: 'Margaret', cards: [{ cardNo: 7, card: CARD }], paid: 0 }; G.order = [marg.pid]; }
function deliver(m) { onMsg(m); drainMicrotasks(); }

if (onMsgSrc && onPhoneSrc) {
  room();
  deliver({ t: 'join', pid: marg.pid, name: 'Dazza' });
  check('a forged join does NOT rename her', G.players[marg.pid].name === 'Margaret', G.players[marg.pid].name);
  deliver({ t: 'claim', pid: marg.pid, cardNo: 7 });
  check('a forged claim on her ticket does NOT reach the claim queue', G.claims.length === 0, G.claims);
  deliver({ t: 'leave', pid: marg.pid });
  check('a forged leave does NOT wipe her tickets', !!G.players[marg.pid] && G.players[marg.pid].cards[0].cardNo === 7);
  var f = copy(his); f.pid = marg.pid;
  deliver(f);
  deliver(attack);
  check('nor does a claim signed by HIS key with her pid on it, however it is put together', G.claims.length === 0, G.claims);

  var realClaim = wait(marg.sign({ t: 'claim', name: 'Margaret', cardNo: 7 }));
  deliver(realClaim);
  check('CONTROL: her own signed claim DOES reach the queue, under her name', G.claims.length === 1 && G.claims[0].name === 'Margaret' && G.claims[0].cardNo === 7, G.claims);
  G.claims = []; G.claimIdx = -1;
  deliver(realClaim);
  check('the same claim played back by somebody else is ignored', G.claims.length === 0, G.claims);
  var realLeave = wait(marg.sign({ t: 'leave' }));
  deliver(realLeave);
  check('CONTROL: her own signed leave does remove her', !G.players[marg.pid]);
  var rejoin = wait(marg.sign({ t: 'join', name: 'Margaret', cards: 1 }));
  deliver(rejoin);
  check('and she can come back', !!G.players[marg.pid]);
  deliver(realLeave);
  check('her earlier leave, played back to throw her out again, is ignored', !!G.players[marg.pid]);

  room();
  var a = wait(marg.sign({ t: 'leave' })), b = wait(marg.sign({ t: 'join', name: 'Margaret', cards: 1 }));
  onMsg(a); onMsg(b); drainMicrotasks();
  check('two messages are handled in the order they ARRIVED, though checking them is asynchronous', !!G.players[marg.pid] && G.players[marg.pid].cards[0].cardNo === 99, G.players[marg.pid]);

  room();
  deliver({ t: 'join', pid: 'oldphone0001', name: 'Old page' });
  check('a phone on the old page is ' + (LEGACY_PHONES_OK ? 'still heard while LEGACY_PHONES_OK is on' : 'refused now LEGACY_PHONES_OK is off'),
    LEGACY_PHONES_OK ? !!G.players.oldphone0001 : !G.players.oldphone0001);
}

if (fails) throw new Error('phone impersonation: ' + fails + ' of ' + ran + ' failed');
print('PASS ' + ran + ' checks');
