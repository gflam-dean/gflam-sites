/* vp-env.js, THE STAGING TRIPWIRE (INBOX 357B / 326, 13 Nov 2026). This RUNS the real venueplay/app/vp-env.js with a stand-in
   window on a LIVE host and on staging hosts, and asks: does live stay untouched, and on staging is every request that
   names a live address (database, api, game Worker; fetch, XHR, WebSocket, beacon) refused while staging's own are not?
   The window, the network and the clock are stood in for.

   Run from the repo root:  jsc tools/test-vp-env.js
*/
var fails = 0, ran = 0;
function check(name, ok, saw) { ran++; if (ok) print('  ok   ' + name); else { fails++; print('  FAIL ' + name + (saw === undefined ? '' : '   saw: ' + JSON.stringify(saw).slice(0, 300))); } }
var SRC = readFile('venueplay/app/vp-env.js');
check('vp-env.js is ES5 (no arrow, let, const, template string, class)', !/=>|\blet\b|\bconst\b|`|\bclass\b/.test(SRC.replace(/\/\*[\s\S]*?\*\//g, '')));

function makeWindow(hostname) {
  var calls = { fetch: [], xhr: [], ws: [], beacon: [] };
  var w = { location: { hostname: hostname }, console: { error: function (s) { calls.err = (calls.err || []).concat(s); } } };
  w.fetch = function (u, init) { calls.fetch.push(typeof u === 'string' ? u : u.url); return Promise.resolve('real'); };
  w.XMLHttpRequest = function () {};
  w.XMLHttpRequest.prototype.open = function (m, u) { calls.xhr.push(u); };
  w.WebSocket = function (u, p) { calls.ws.push(u); };
  w.WebSocket.prototype = { marker: 1 }; w.WebSocket.OPEN = 1; w.WebSocket.CLOSED = 3; w.WebSocket.CONNECTING = 0; w.WebSocket.CLOSING = 2;
  w.navigator = { sendBeacon: function (u) { calls.beacon.push(u); return true; } };
  w.document = { title: 'Trivia', addEventListener: function () {} };
  (new Function('window', SRC.replace(/\}\)\(typeof window !== "undefined" \? window : this\);\s*$/, '})(window);')))(w);
  return { w: w, calls: calls };
}
function blocked(fn) { try { fn(); return false; } catch (e) { return /live address/.test(String(e)); } }

print('on the LIVE host nothing changes');
(function () {
  var r = makeWindow('www.venueplay.com.au'), w = r.w;
  check('VPEnv says live, with the live addresses', w.VPEnv.name === 'live' && w.VPEnv.api === 'https://api.venueplay.com.au' && w.VPEnv.game === 'https://game.venueplay.com.au' && /^https:\/\/ijkzgmdtwtgfkedqspxm\./.test(w.VPEnv.supabaseUrl) && /^sb_publishable_/.test(w.VPEnv.supabaseAnon));
  w.fetch('https://api.venueplay.com.au/x', { method: 'POST' });
  new w.XMLHttpRequest().open('POST', 'https://game.venueplay.com.au/x');
  new w.WebSocket('wss://ijkzgmdtwtgfkedqspxm.supabase.co/realtime/v1/websocket');
  check('fetch, XHR and WebSocket reach live untouched', r.calls.fetch.length === 1 && r.calls.xhr.length === 1 && r.calls.ws.length === 1);
  check('the title is not touched', w.document.title === 'Trivia');
  check('nothing is wrapped', w.fetch.toString().indexOf('realFetch') < 0);
  var a = makeWindow('venueplay.com.au'); check('the apex is live too', a.w.VPEnv.name === 'live');
  var l = makeWindow('localhost'); check('localhost is live (a developer\'s machine is never staging)', l.w.VPEnv.name === 'live');
  var p = makeWindow('venueplay-xyz.pages.dev'); check('a Pages preview address is live behaviour, not staging', p.w.VPEnv.name === 'live');
})();

print('on STAGING hosts the live addresses are refused');
['staging.venueplay.com.au', 'api-staging.venueplay.com.au', 'game-staging.venueplay.com.au'].forEach(function (h) {
  var r = makeWindow(h), w = r.w;
  check(h + ' is staging, with the staging addresses', w.VPEnv.name === 'staging' && w.VPEnv.isStaging === true && w.VPEnv.api === 'https://api-staging.venueplay.com.au' && w.VPEnv.game === 'https://game-staging.venueplay.com.au' && /gpoolavkghnxedzrmtmc/.test(w.VPEnv.supabaseUrl));
});
(function () {
  var r = makeWindow('staging.venueplay.com.au'), w = r.w, n = 0, rejected = 0;
  function rej(p) { p.then(function () {}, function (e) { if (/live address/.test(String(e))) rejected++; }); }
  rej(w.fetch('https://ijkzgmdtwtgfkedqspxm.supabase.co/rest/v1/vp_venues'));
  rej(w.fetch('https://api.venueplay.com.au/health'));
  rej(w.fetch('https://game.venueplay.com.au/venue?code=ABC', { method: 'POST' }));
  rej(w.fetch({ url: 'https://game.venueplay.com.au/venue', method: 'GET' }));
  check('fetch to the live database, api and game Worker is refused, even a read', r.calls.fetch.length === 0);
  check('XHR to a live address throws', blocked(function () { new w.XMLHttpRequest().open('GET', 'https://api.venueplay.com.au/x'); }) && r.calls.xhr.length === 0);
  check('a WebSocket to the live database throws', blocked(function () { new w.WebSocket('wss://ijkzgmdtwtgfkedqspxm.supabase.co/realtime/v1/websocket?apikey=x'); }) && r.calls.ws.length === 0);
  check('a beacon to the live api is refused', w.navigator.sendBeacon('https://api.venueplay.com.au/b', 'x') === false && r.calls.beacon.length === 0);
  w.fetch('https://api-staging.venueplay.com.au/health', { method: 'POST' });
  w.fetch('https://gpoolavkghnxedzrmtmc.supabase.co/rest/v1/vp_venues');
  w.fetch('https://game-staging.venueplay.com.au/venue');
  new w.XMLHttpRequest().open('POST', 'https://api-staging.venueplay.com.au/x');
  var sock = new w.WebSocket('wss://gpoolavkghnxedzrmtmc.supabase.co/realtime/v1/websocket', 'p');
  check('the staging addresses all go through', r.calls.fetch.length === 3 && r.calls.xhr.length === 1 && r.calls.ws.length === 1);
  w.fetch('https://www.venueplay.com.au/logos/a.png');
  check('a live SITE address may be read (a picture)', r.calls.fetch.length === 4);
  w.fetch('https://www.venueplay.com.au/x', { method: 'POST' });
  w.fetch('https://venueplay.com.au/x', { method: 'DELETE' });
  check('...but never written to', r.calls.fetch.length === 4);
  w.fetch('https://api.venueplay.com.au.evil.example/x');
  check('a lookalike host is not mistaken for a live one (and not blocked)', r.calls.fetch.length === 5);
  check('every refusal is kept in VPEnv.blocked and the console', w.VPEnv.blocked.length >= 8 && (r.calls.err || []).length >= 8, w.VPEnv.blocked.length);
  check('the tab title says [staging]', w.document.title === '[staging] Trivia');
  check('WebSocket constants and prototype survive the wrap', w.WebSocket.OPEN === 1 && w.WebSocket.prototype.marker === 1 && w.WebSocket.CLOSED === 3);
  check('shouldBlock is false on a staging host for staging, true for live', w.VPEnv.shouldBlock('https://api-staging.venueplay.com.au/x') === false && w.VPEnv.shouldBlock('wss://x.venueplay.com.au') === false && w.VPEnv.shouldBlock('https://game.venueplay.com.au/') === true);
})();
print(ran + ' checks, ' + fails + ' failed');
if (fails) exit(1);
