/* PRODUCT UPDATES BY EMAIL, ASKED AT SIGN-IN, RUN AND NOT WORD-SEARCHED (Dean, 5 Nov 2026, INBOX item 21a; migration 164).

   "when a host signs in (by phone), also ask for their EMAIL address, optional, for product updates about
   once a month. It needs a clear opt-in tick, unticked by default (Spam Act ...), and an unsubscribe link in
   every update. Store the consent with a timestamp. Hosts who skip it are never asked again on every
   sign-in: at most once a month."

   Runs the REAL billing Worker (tools/rig-billing-worker.js) through its REAL router, and the REAL page script
   (venueplay/app/vp-updates-optin.js) in a small fake DOM whose fetch goes to that same Worker:
     1. POST /account/updates-ask: who is asked, and when (never twice in 30 days, never once opted in)
     2. POST /account/updates-optin: a skip keeps no email; a tick keeps the email, its moment and its words
     3. fails closed: the table missing or failing means nobody is asked
     4. vpaHostUpdatesRecipients: opted in, minus vp_unsubscribes, each with an unsubscribe link
     5. the card: unticked, its words the Worker's words, Save with the tick off is Not now
     6. the console: index.html loads it and asks only after name, mobile and the venue pick

   Run from the repo root:  jsc tools/test-host-updates-optin.js */
var ran = 0, bad = 0;
function check(n, c, saw) { ran++; if (c) print('  ok   ' + n); else { bad++; print('  FAIL ' + n + (saw !== undefined ? '   saw: ' + String(typeof saw === 'string' ? saw : JSON.stringify(saw)).slice(0, 400) : '')); } }
function section(t) { print(''); print(t); }
function settle() { for (var i = 0; i < 40; i++) drainMicrotasks(); }

URL = function (u) { u = String(u); var q = u.indexOf('?'), sp = {}; var base = q >= 0 ? u.slice(0, q) : u;
  this.pathname = base.replace(/^https?:\/\/[^/]+/, '') || '/';
  if (q >= 0) u.slice(q + 1).split('&').forEach(function (p) { var i = p.indexOf('='); sp[decodeURIComponent(p.slice(0, i))] = decodeURIComponent(p.slice(i + 1)); });
  this.searchParams = { get: function (k) { return k in sp ? sp[k] : null; } }; };
Response = function (body, init) { this.body = body; this.status = (init && init.status) || 200; this.headers = (init && init.headers) || {}; };
Response.redirect = function (u, s) { return { redirect: u, status: s }; };

load('tools/rig-billing-worker.js');
/* Everything the Worker logs, kept, so a check can say the email never reaches a log. */
var LOGS = [];
console.log = console.warn = console.error = function () { LOGS.push(Array.prototype.slice.call(arguments).map(function (a) { try { return typeof a === 'string' ? a : JSON.stringify(a); } catch (e) { return String(a); } }).join(' ')); };
vpaVerifyJWT = async function (tk) { return tk ? { sub: tk } : null; };
if (typeof TextEncoder === 'undefined') { TextEncoder = function () {}; TextEncoder.prototype.encode = function (s) { s = unescape(encodeURIComponent(String(s))); var a = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return a; }; }
function fnv(bytes, seed) { var out = new Uint8Array(32), h = (2166136261 ^ seed) >>> 0; for (var r = 0; r < 32; r++) { for (var i = 0; i < bytes.length; i++) { h ^= bytes[i] + r; h = Math.imul(h, 16777619) >>> 0; } out[r] = h & 255; } return out; }
crypto = { subtle: {
  digest: function (alg, b) { return Promise.resolve(fnv(new Uint8Array(b), 1).buffer); },
  importKey: function (fmt, raw) { return Promise.resolve({ k: fnv(new Uint8Array(raw), 2)[0] }); },
  sign: function (alg, key, data) { return Promise.resolve(fnv(new Uint8Array(data), 3 + key.k).buffer); } },
  getRandomValues: function (a) { for (var i = 0; i < a.length; i++) a[i] = (i * 37 + 11) & 255; return a; } };
ENV.VP_UNSUB_SECRET = 'host-updates-test-secret';

/* THE TABLE, AS POSTGREST KEEPS IT. A primary key on auth_user_id: a second POST for the same login is a
   409, unless it asks on_conflict=auth_user_id with Prefer resolution=merge-duplicates, when it merges.
   MISSING answers the way live PostgREST answers for a table that is not there yet (404, PGRST205). */
var T = 'vp_host_updates_optin', MISSING = false, PREFERS = [];
var rigFetch = globalThis.fetch;
function RS(status, body) { return Promise.resolve({ ok: status >= 200 && status < 300, status: status, json: function () { return Promise.resolve(body); }, text: function () { return Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)); } }); }
globalThis.fetch = function (url, opts) {
  var u = String(url), method = (opts && opts.method) || 'GET';
  if (u.indexOf('/rest/v1/' + T) !== -1) {
    if (MISSING) return RS(404, { code: 'PGRST205', message: "Could not find the table 'public." + T + "' in the schema cache" });
    if (method === 'POST' && !(FAIL[T + ':POST'] > 0)) {
      var prefer = String(((opts && opts.headers) || {}).Prefer || ''); PREFERS.push(prefer);
      var o = JSON.parse(opts.body), ex = tbl(T).filter(function (r) { return r.auth_user_id === o.auth_user_id; })[0];
      if (ex) {
        if (!/on_conflict=auth_user_id/.test(u) || !/resolution=merge-duplicates/.test(prefer)) return RS(409, { code: '23505', message: 'duplicate key value violates unique constraint' });
        for (var k in o) ex[k] = o[k]; return RS(201, '');
      }
      tbl(T).push(o); return RS(201, '');
    }
  }
  return rigFetch(url, opts);
};
function req(path, body, headers) {
  var h = {}; for (var k in (headers || {})) h[k.toLowerCase()] = headers[k];
  var txt = body === undefined ? '' : (typeof body === 'string' ? body : JSON.stringify(body));
  return { method: 'POST', url: 'https://api.venueplay.com.au' + path,
    headers: { get: function (k) { return h[String(k).toLowerCase()] || null; } },
    text: function () { return Promise.resolve(txt); }, json: function () { return Promise.resolve(JSON.parse(txt)); } };
}
async function call(path, body, headers) {
  var res = await _d.fetch(req(path, body, headers), ENV);
  var parsed = null; try { parsed = res.body ? JSON.parse(res.body) : null; } catch (e) { parsed = res.body; }
  return { status: res.status, body: parsed || {} };
}
function U(n) { return '61000000-0000-4000-8000-' + ('000000000000' + n).slice(-12); }
var HOST = U(1), HOST2 = U(2), HOST3 = U(3), ADMIN = U(9), VENUE = U(100);
var AS = function (who) { return { Authorization: 'Bearer ' + who }; };
function world() {
  DB = {}; FAIL = {}; MISSING = false; PREFERS = []; LOGS = [];
  DB.vp_platform_admins = [{ auth_user_id: ADMIN, label: 'Dean', role: 'owner' }];
  DB.vp_venues = [{ id: VENUE, name: 'Test Alpha Hotel', slug: 'test-alpha', status: 'active' }];
  DB.vp_venue_staff = [HOST, HOST2, HOST3, U(5)].map(function (h, i) { return { id: 's' + i, auth_user_id: h, venue_id: VENUE, role: i ? 'host' : 'owner' }; });
  DB[T] = []; DB.vp_unsubscribes = [];
}
function rowOf(who) { return tbl(T).filter(function (r) { return r.auth_user_id === who; })[0]; }
var DAY = 86400000;
function ago(ms) { return new Date(Date.now() - ms).toISOString(); }
function lift(src, name) {
  var i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('cannot find ' + name + ': a test that cannot find its subject cannot fail');
  var d = 0, k = src.indexOf('{', i);
  do { if (src[k] === '{') d++; else if (src[k] === '}') d--; k++; } while (d > 0 && k < src.length);
  return src.slice(i, k);
}

/* ---------------- a small DOM: enough for a card built with createElement and textContent ---------------- */
function Node(tag) { this.tagName = String(tag).toUpperCase(); this.children = []; this.parentNode = null; this.attrs = {}; this.id = ''; this._text = '';
  this.value = ''; this.checked = false; this.disabled = false; this.handlers = {}; this.style = { cssText: '', display: '' }; this.innerHTMLSet = false; }
Object.defineProperty(Node.prototype, 'textContent', { get: function () { return this.children.length ? this.children.map(function (c) { return c.textContent; }).join(' ') : this._text; },
  set: function (v) { this.children = []; this._text = String(v); } });
Object.defineProperty(Node.prototype, 'firstChild', { get: function () { return this.children[0] || null; } });
Object.defineProperty(Node.prototype, 'innerHTML', { set: function () { this.innerHTMLSet = true; }, get: function () { return ''; } });
Node.prototype.setAttribute = function (k, v) { this.attrs[k] = String(v); if (k === 'style') { this.style = { cssText: String(v), display: /display:\s*none/.test(v) ? 'none' : '' }; } if (k === 'id') this.id = String(v);
  if (k === 'checked') this.checked = true; };
Node.prototype.getAttribute = function (k) { return k in this.attrs ? this.attrs[k] : null; };
Node.prototype.appendChild = function (c) { if (c.parentNode) c.parentNode.removeChild(c); c.parentNode = this; this.children.push(c); return c; };
Node.prototype.removeChild = function (c) { var i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); c.parentNode = null; return c; };
Node.prototype.addEventListener = function (ev, fn) { (this.handlers[ev] = this.handlers[ev] || []).push(fn); };
Node.prototype.focus = function () {};
Node.prototype.fire = function (ev, extra) { var me = this, out = []; (this.handlers[ev] || []).forEach(function (f) { out.push(f.call(me, Object.assign({ preventDefault: function () {}, key: '' }, extra || {}))); }); return out[0]; };
Node.prototype.click = function () { if (this.disabled) return; return this.fire('click'); };
function newDoc() {
  var d = { body: new Node('body') };
  d.createElement = function (t) { return new Node(t); };
  d.getElementById = function (id) { function walk(n) { if (n.id === id) return n; for (var i = 0; i < n.children.length; i++) { var f = walk(n.children[i]); if (f) return f; } return null; } return walk(d.body); };
  return d;
}
function attached(n) { for (var x = n; x; x = x.parentNode) { if (x.tagName === 'BODY') return true; } return false; }
function anyHtml(n) { if (n.innerHTMLSet) return true; for (var i = 0; i < n.children.length; i++) if (anyHtml(n.children[i])) return true; return false; }

var SRC = readFile('venueplay/app/vp-updates-optin.js');
function freshPage() { var W = {}; (new Function('window', SRC))(W); return W.VPUpdatesOptin; }
/* The page's fetch goes to the REAL Worker above, and every body it sends is kept. */
var SENT = [];
function pageDeps(who, doc) {
  return { doc: doc, again: true,
    client: { auth: { getSession: function () { return Promise.resolve({ data: { session: { access_token: who } } }); } } },
    fetch: function (url, opts) {
      SENT.push({ path: String(url).replace(/^https:\/\/api\.venueplay\.com\.au/, ''), body: JSON.parse(opts.body || '{}'), url: String(url) });
      var hd = opts.headers || {};
      return _d.fetch(req(String(url).replace(/^https:\/\/api\.venueplay\.com\.au/, ''), opts.body, hd), ENV).then(function (res) {
        return { ok: res.status >= 200 && res.status < 300, status: res.status, json: function () { return Promise.resolve(JSON.parse(res.body || '{}')); } };
      });
    } };
}
function staffCtx(id) { return { authed: true, isAdmin: false, scope: 'staff', user: { id: id, phone: '61452510904' }, staff: [{ venue_id: VENUE, role: 'host' }] }; }

/* The Worker's const is lexical inside the rig's eval, so it is read off the Worker's own line; the stored
   consent_text (from the running Worker) is then held equal to it and to the page's CONSENT. */
var VPB_HOST_UPDATES_CONSENT = (/^const VPB_HOST_UPDATES_CONSENT = '([^'\n]+)';$/m.exec(readFile('venueplay-backend/worker/venueplay-api-FULL.js')) || [])[1];
if (!VPB_HOST_UPDATES_CONSENT) throw new Error('cannot find VPB_HOST_UPDATES_CONSENT in the Worker');
(async function () {
  section('1. POST /account/updates-ask: who is asked, and when');
  world();
  var a = await call('/account/updates-ask', {}, AS(HOST));
  check('a host never asked before is asked', a.status === 200 && a.body.ask === true, a);
  var n = await call('/account/updates-ask', {}, AS(ADMIN));
  check('an HQ admin with no venue staff row is refused, and not asked', n.status === 403 && n.body.ask === false, n);
  var n2 = await call('/account/updates-optin', { email: 'dean@example.com', opt_in: true }, AS(ADMIN));
  check('an HQ admin with no venue staff row cannot store an opt-in either', n2.status === 403 && tbl(T).length === 0, [n2, tbl(T)]);
  var n3 = await call('/account/updates-ask', {}, {});
  check('no sign-in is refused', n3.status === 401 && n3.body.ask === false, n3);

  section('2. POST /account/updates-optin: a skip keeps no email');
  world();
  var s = await call('/account/updates-optin', { email: 'Typed@Pub.Example', opt_in: false }, AS(HOST));
  var r = rowOf(HOST);
  check('a skip saves', s.status === 200 && s.body.ok === true, s);
  check('a skip (tick left off, an email typed) stores NO email', r && r.email === null && r.opted_in === false, r);
  check('a skip stores no consent: no consent_at, consent_text or source', r && r.consent_at === null && r.consent_text === null && r.source === null, r);
  check('a skip stores when we asked', r && isFinite(Date.parse(r.asked_at)) && Math.abs(Date.parse(r.asked_at) - Date.now()) < 60000, r);
  var s2 = await call('/account/updates-optin', {}, AS(HOST2));
  check('"Not now" with nothing in it is a skip too', s2.status === 200 && rowOf(HOST2) && rowOf(HOST2).email === null && !!rowOf(HOST2).asked_at, rowOf(HOST2));
  var s3 = await call('/account/updates-optin', { email: 'x@y.example', opt_in: 'true' }, AS(HOST3));
  check('only opt_in true itself is a tick (the string "true" is not)', s3.status === 200 && rowOf(HOST3).opted_in === false && rowOf(HOST3).email === null, rowOf(HOST3));
  var a2 = await call('/account/updates-ask', {}, AS(HOST));
  check('just after a skip: not asked again', a2.body.ask === false, a2);
  rowOf(HOST).asked_at = ago(29 * DAY);
  var a3 = await call('/account/updates-ask', {}, AS(HOST));
  check('29 days after a skip: still not asked', a3.body.ask === false, a3);
  rowOf(HOST).asked_at = ago(31 * DAY);
  var a4 = await call('/account/updates-ask', {}, AS(HOST));
  check('31 days after a skip: asked again (at most once a month)', a4.body.ask === true, a4);

  section('3. A tick keeps the email, its moment and its words');
  var o = await call('/account/updates-optin', { email: '  Sam.Host@Test-Alpha.Example  ', opt_in: true }, AS(HOST));
  r = rowOf(HOST);
  check('an opt-in saves', o.status === 200 && o.body.ok === true && o.body.opted_in === true, o);
  check('the email is stored trimmed and lower case', r && r.email === 'sam.host@test-alpha.example', r);
  check('opted_in true, consent_at now, source host-sign-in', r && r.opted_in === true && Math.abs(Date.parse(r.consent_at) - Date.now()) < 60000 && r.source === 'host-sign-in', r);
  check('consent_text is the exact tick wording', r && r.consent_text === VPB_HOST_UPDATES_CONSENT, r && r.consent_text);
  check('a skip then an opt-in is ONE row for the login, merged (on_conflict=auth_user_id, merge-duplicates)', tbl(T).filter(function (x) { return x.auth_user_id === HOST; }).length === 1 &&
    PREFERS.every(function (p) { return /resolution=merge-duplicates/.test(p); }), [tbl(T).length, PREFERS]);
  r.asked_at = ago(400 * DAY);
  var a5 = await call('/account/updates-ask', {}, AS(HOST));
  check('a host who opted in is never asked again, even a year on', a5.body.ask === false, a5);
  check('the email never reaches a log', LOGS.join('\n').toLowerCase().indexOf('sam.host') === -1, LOGS);
  var b1 = await call('/account/updates-optin', { email: 'not-an-email', opt_in: true }, AS(HOST2));
  check('a bad email is refused plainly, and nothing changes', b1.status === 400 && /does not look right/.test(b1.body.error || '') && rowOf(HOST2).email === null && rowOf(HOST2).opted_in === false, [b1, rowOf(HOST2)]);
  var b2 = await call('/account/updates-optin', { email: '', opt_in: true }, AS(HOST2));
  check('a tick with no email is refused', b2.status === 400 && rowOf(HOST2).opted_in === false, b2);
  var b3 = await call('/account/updates-optin', { email: 'a@b.example' + 'x'.repeat(260), opt_in: true }, AS(HOST2));
  check('an email over 254 characters is refused', b3.status === 400, b3);

  section('4. Fails closed: nobody is asked for what we cannot store');
  world(); MISSING = true;
  var m1 = await call('/account/updates-ask', {}, AS(HOST));
  check('the table missing (migration 164 not run): ask false', m1.status === 200 && m1.body.ask === false, m1);
  var m2 = await call('/account/updates-optin', { email: 'sam@test-alpha.example', opt_in: true }, AS(HOST));
  check('the table missing: an opt-in says it did not save, never ok', m2.status === 503 && !m2.body.ok, m2);
  world(); FAIL[T + ':GET'] = 1;
  var m3 = await call('/account/updates-ask', {}, AS(HOST));
  check('the table failing for a moment: ask false, not "no row yet"', m3.body.ask === false, m3);
  world();
  var lim = 0; for (var i = 0; i < 12; i++) { var q = await call('/account/updates-optin', { opt_in: false }, AS(U(5))); if (q.status === 429) lim++; }
  check('a login posting over and over is slowed down (a light rate limit: ten an hour)', lim === 2, lim);

  section('5. vpaHostUpdatesRecipients: who an update may go to');
  world();
  DB[T] = [
    { auth_user_id: HOST, email: 'sam@test-alpha.example', opted_in: true, consent_at: ago(DAY) },
    { auth_user_id: HOST2, email: 'stop@test-alpha.example', opted_in: true, consent_at: ago(DAY) },
    { auth_user_id: HOST3, email: null, opted_in: false, asked_at: ago(DAY) },
    { auth_user_id: U(4), email: 'jo@test-bravo.example', opted_in: true, consent_at: ago(DAY) }];
  DB.vp_unsubscribes = [{ email: 'STOP@Test-Alpha.Example', source: 'unsubscribe-link' }];
  var list = await vpaHostUpdatesRecipients(ENV);
  var emails = list.map(function (x) { return x.email; }).sort();
  check('only hosts who ticked, minus anyone on vp_unsubscribes (any case)', emails.join() === 'jo@test-bravo.example,sam@test-alpha.example', emails);
  var want = await vpUnsubLink(ENV, 'sam@test-alpha.example', 'host-updates');
  var sam = list.filter(function (x) { return x.email === 'sam@test-alpha.example'; })[0];
  check('each has their own unsubscribe link, tagged host-updates, on api.venueplay.com.au', sam && sam.unsubscribe_url === want && /^https:\/\/api\.venueplay\.com\.au\/unsubscribe\?e=sam%40test-alpha\.example&t=[0-9a-f]{32}&c=host-updates$/.test(want), sam);
  FAIL['vp_unsubscribes:GET'] = 1;
  var threw = false; try { await vpaHostUpdatesRecipients(ENV); } catch (e) { threw = true; }
  check('if the unsubscribe list cannot be read, there is no list at all (it throws)', threw);
  var W = readFile('venueplay-backend/worker/venueplay-api-FULL.js');
  check('nothing on this branch sends with the list (it is only defined)', W.split('vpaHostUpdatesRecipients(').length === 2);

  section('6. The card in the console');
  world();
  var P = freshPage();
  check('vp-updates-optin.js loads and offers maybe, open and wants', !!(P && typeof P.maybe === 'function' && typeof P.open === 'function' && typeof P.wants === 'function'));
  check('the tick wording on the page is the Worker\'s VPB_HOST_UPDATES_CONSENT, word for word', P.CONSENT === VPB_HOST_UPDATES_CONSENT, [P.CONSENT, VPB_HOST_UPDATES_CONSENT]);
  check('only a staff login is offered it: never HQ (admin or View as) or a login with no venue',
    P.wants(staffCtx(HOST)) === true && P.wants({ authed: true, isAdmin: true, scope: 'admin', user: { id: ADMIN }, staff: [] }) === false &&
    P.wants({ authed: true, isAdmin: true, scope: 'staff', user: { id: ADMIN }, staff: [{}] }) === false && P.wants({ authed: true, scope: 'none', user: { id: 'x' }, staff: [] }) === false);
  var doc = newDoc(); SENT = [];
  var h = null; P.maybe(staffCtx(HOST), pageDeps(HOST, doc)).then(function (x) { h = x; }); settle();
  var card = doc.getElementById('vpUpdatesOptin');
  check('asked (no row yet): the card shows', !!(h && card && attached(card)), SENT);
  check('it asked the Worker first', SENT.length === 1 && SENT[0].path === '/account/updates-ask', SENT);
  check('heading and line as Dean wrote them', doc.getElementById('vpUoTitle').textContent === 'Product updates from venueplay?' &&
    doc.getElementById('vpUoSub').textContent === 'About once a month: new games, new features and tips for your nights. Optional.');
  var tick = doc.getElementById('vpUoTick');
  check('the tick is a checkbox and starts UNTICKED', tick && tick.getAttribute('type') === 'checkbox' && tick.checked === false && tick.getAttribute('checked') === null, tick && tick.attrs);
  check('the words beside the tick are the consent words', doc.getElementById('vpUoTickText').textContent === VPB_HOST_UPDATES_CONSENT);
  check('two buttons, Save and Not now', doc.getElementById('vpUoSave').textContent === 'Save' && doc.getElementById('vpUoLater').textContent === 'Not now');
  check('nothing on it is parsed as HTML', !anyHtml(doc.body) && SRC.indexOf('innerHTML') === -1);
  doc.getElementById('vpUoEmail').value = 'Sam@Test-Alpha.Example';
  SENT = []; doc.getElementById('vpUoSave').click(); settle();
  check('Save with the tick off counts as Not now: the card goes', !attached(card));
  check('...and NO email is sent, even one typed into the box', SENT.length === 1 && SENT[0].path === '/account/updates-optin' && SENT[0].body.opt_in === false && !('email' in SENT[0].body), SENT);
  check('...and the Worker keeps no email, only when we asked', rowOf(HOST) && rowOf(HOST).email === null && !!rowOf(HOST).asked_at, rowOf(HOST));
  var doc2 = newDoc(); SENT = [];
  P.maybe(staffCtx(HOST), pageDeps(HOST, doc2)); settle();
  check('asked again in the same month: nothing shows', !doc2.getElementById('vpUpdatesOptin') && SENT.length === 1, SENT);

  var doc3 = newDoc(); SENT = [];
  P.maybe(staffCtx(HOST2), pageDeps(HOST2, doc3)); settle();
  doc3.getElementById('vpUoLater').click(); settle();
  check('"Not now" closes it and records the skip with no email', !doc3.getElementById('vpUpdatesOptin') && SENT[1] && SENT[1].body.opt_in === false && !('email' in SENT[1].body) && rowOf(HOST2).email === null, SENT);

  var doc4 = newDoc(); SENT = [];
  P.maybe(staffCtx(HOST3), pageDeps(HOST3, doc4)); settle();
  doc4.getElementById('vpUoTick').checked = true; doc4.getElementById('vpUoEmail').value = 'sam at the pub';
  doc4.getElementById('vpUoSave').click(); settle();
  check('tick on and a bad email: it says so plainly, sends nothing, and stays open', /doesn't look right/.test(doc4.getElementById('vpUoMsg').textContent) && SENT.length === 1 && !!doc4.getElementById('vpUpdatesOptin'), [doc4.getElementById('vpUoMsg').textContent, SENT]);
  doc4.getElementById('vpUoEmail').value = '  Kim@Test-Alpha.Example ';
  doc4.getElementById('vpUoSave').click(); settle();
  check('tick on and a good email: the Worker stores it lower case with the consent words', rowOf(HOST3) && rowOf(HOST3).email === 'kim@test-alpha.example' && rowOf(HOST3).opted_in === true && rowOf(HOST3).consent_text === P.CONSENT, rowOf(HOST3));
  check('...and the card thanks them and says every update has an unsubscribe link', doc4.getElementById('vpUoTitle').textContent === "You're on the list" && /unsubscribe link/.test(doc4.getElementById('vpUoSub').textContent));
  doc4.getElementById('vpUoDone').click();
  check('...and Done closes it', !doc4.getElementById('vpUpdatesOptin'));

  world(); MISSING = true;
  var doc5 = newDoc(); SENT = [];
  P.maybe(staffCtx(HOST), pageDeps(HOST, doc5)); settle();
  check('before migration 164 runs, the console shows nothing', !doc5.getElementById('vpUpdatesOptin') && SENT.length === 1, SENT);
  MISSING = false;
  var P2 = freshPage(), doc6 = newDoc(), d6 = pageDeps(HOST, doc6); delete d6.again; SENT = [];
  P2.maybe(staffCtx(HOST), d6); settle(); P2.maybe(staffCtx(HOST), d6); settle();
  check('the console asks the Worker once per page load, however often it comes back to the venue', SENT.length === 1, SENT);
  check('no em dash or en dash anywhere in it', !/[—–]/.test(SRC));

  section('7. The console asks only after their name, mobile and the venue pick');
  var INDEX = readFile('venueplay/app/index.html');
  check('index.html loads vp-updates-optin.js', /<script src="vp-updates-optin\.js"><\/script>/.test(INDEX));
  function runProceed(ctx, ayWants, picked) {
    var R = { order: [] };
    var fn = new Function('__ctx', 'window', 'VPAboutYou', 'VPFirstRun', 'VPUpdatesOptin', 'VP', 'go', 'enforceShift', 'updateAccountLink', 'venuePickFresh', 'showVenuePick', 'pairToVenue', '$',
      lift(INDEX, 'proceedVenue') + '\nreturn proceedVenue;');
    var AYs = { wants: function () { return ayWants; }, open: function () { R.order.push('aboutyou'); } };
    var FR = { wants: function () { return false; }, open: function () { R.order.push('firstrun'); } };
    var UO = { wants: P.wants, maybe: function (c) { R.order.push('updates'); return Promise.resolve(null); } };
    var VPs = { getClient: function () { return {}; }, holdGate: function () { return false; }, termsGate: function () { return false; } };
    var win = { VPAboutYou: AYs, VPFirstRun: FR, VPUpdatesOptin: UO, VP: VPs };
    fn(ctx, win, AYs, FR, UO, VPs, function (v) { R.order.push('go ' + v); }, function () {}, function () {}, function () { return picked; }, function () { R.order.push('venuepick'); },
      function () { R.order.push('pair'); return true; }, function () { return { value: '', focus: function () {} }; })();
    return R;
  }
  var one = staffCtx(HOST); one.venue = { slug: 'test-alpha' };
  var R1 = runProceed(one, false, true);
  check('a host with their mobile: asked, then the console pairs as before (never blocked)', R1.order.join() === 'updates,pair', R1.order);
  var R2 = runProceed(one, true, true);
  check('a login still giving its name and mobile is not asked yet', R2.order.indexOf('updates') === -1 && R2.order[0] === 'aboutyou', R2.order);
  var two = staffCtx(HOST); two.venue = { slug: 'test-alpha' }; two.staff = [{ venue_id: 'v-one', role: 'host' }, { venue_id: 'v-two', role: 'host' }];   // two DISTINCT venues (round 3 counts distinct ones)
  var R3 = runProceed(two, false, false);
  check('a host with two venues is asked after the venue pick, not before', R3.order.join() === 'venuepick', R3.order);
  var R4 = runProceed({ authed: true, isAdmin: true, scope: 'admin', user: { id: ADMIN }, staff: [], venue: { slug: 'test-alpha' } }, false, true);
  check('HQ View as is never asked', R4.order.indexOf('updates') === -1 && R4.order.indexOf('pair') !== -1, R4.order);

  if (bad) throw new Error('host updates opt-in: ' + bad + ' of ' + ran + ' failed');
  print(''); print('ALL ' + ran + ' CHECKS PASSED');
})().catch(function (e) { print('  FAIL ' + (e && e.message) + ' ' + (e && e.stack || e)); throw e; });
drainMicrotasks();
