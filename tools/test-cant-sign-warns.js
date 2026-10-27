/* A CONSOLE THAT CANNOT SIGN AT A VENUE THAT CHECKS SAYS SO.
   Played at Test Charlie, 30 Sep 2026: the console (an HQ View as login) got no venue key, sent
   everything unsigned, the enforcing TV dropped it all, and the console looked perfectly normal.
   RUNS the real vp-sign.js against a fake Worker and a fake page, and reads the bar off the page.
   Run: jsc tools/test-cant-sign-warns.js */
var ran = 0, bad = 0;
function ok(n, c, extra){ ran++; print((c ? '  ok   ' : '  FAIL ') + n + (extra ? '   ' + extra : '')); if (!c) bad++; }
function flush(n){ var p = Promise.resolve(); for (var i = 0; i < (n || 40); i++) p = p.then(function(){}); return p; }

function load(world){
  var nodes = {}, first = null;
  var body = { insertBefore: function (el) { nodes[el.id] = el; el.parentNode = body; first = el; }, removeChild: function (el) { delete nodes[el.id]; } };
  var document = { body: body, getElementById: function (id) { return nodes[id] || null; },
    createElement: function () { return { id: '', textContent: '', setAttribute: function () {} }; } };
  var window = { crypto: { subtle: {
    importKey: function () { return Promise.resolve({ fake: true }); },
    sign: function () { return Promise.resolve(new ArrayBuffer(8)); },
    verify: function () { return Promise.resolve(true); },
    generateKey: function () { return Promise.reject(new Error('not here')); }
  } } };
  var fetch = function (url) {
    var d = /signing\/private/.test(url) ? world.priv : /signing\/public/.test(url) ? world.pub : null;
    return Promise.resolve({ ok: !!d, json: function () { return Promise.resolve(d); } });
  };
  (new Function('window', 'document', 'fetch', 'setInterval', 'TextEncoder', 'console', 'btoa', 'atob', readFile('venueplay/app/vp-sign.js')))
    (window, document, fetch, function () { return 1; }, function () { this.encode = function (s) { return { length: s.length }; }; },
     { warn: function () {}, log: function () {} }, function (s) { return s; }, function (s) { return s; });
  return { V: window.VPSign, bar: function () { return document.getElementById('vpCantSign'); } };
}

var A = load({ priv: null, pub: { exists: true, public_jwk: { k: 1 }, enforce: true } });   // refused a key, venue enforces
A.V.initHost('https://w', 'test-charlie', function () { return 'tok'; });
var B = load({ priv: null, pub: { exists: true, public_jwk: { k: 1 }, enforce: false } });  // refused a key, venue does not check
B.V.initHost('https://w', 'test-delta', function () { return 'tok'; });
var C = load({ priv: { has_key: true, private_jwk: { k: 1 }, public_jwk: { k: 1 }, kid: 'k1', enforce: true },
               pub: { exists: true, public_jwk: { k: 1 }, enforce: true } });                  // a real host with a key
C.V.initHost('https://w', 'test-alpha', function () { return 'tok'; });
flush().then(function () {
  var a = A.bar();
  ok('no key at a venue that checks: the console shows a red bar', !!a && /TV and phones will ignore this console/.test(a.textContent), a && a.textContent);
  ok('no key at a venue that does not check: no bar (unsigned still works there)', !B.bar());
  ok('a host who has the key: no bar', !C.bar());
  print('\n' + (ran - bad) + ' of ' + ran + ' checks passed');
  if (bad) throw new Error(bad + ' failed');
}).catch(function (e) { print('CRASH ' + e + ' ' + (e && e.stack)); throw e; });
