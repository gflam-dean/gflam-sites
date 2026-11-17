/* OUTBOX GUARD BEGIN (INBOX 357B / 326, 13 Nov 2026). One block, four copies: this file is the source; the same text sits
   between these two markers in venueplay-api-FULL.js, venueplay-game.js and venueplay-sms-hook.js (a Worker is one pasted
   file, so it cannot import). tools/test-outbox-guard.js fails if any copy differs. Edit HERE, then copy the block across.

   WHAT IT DOES
   STAGING (env.VP_ENV === 'staging'): nothing real ever leaves. Emails, texts, push messages, the SMS hook and any
   write to a LIVE venueplay address are caught and answered with a believable "sent", and written to an in-memory
   outbox (globalThis.__vpOutbox, last 50) and the log. Stripe is allowed ONLY with a test key. Before it serves a
   single request it checks its own settings and REFUSES (503) if: a live Stripe key is present; the database address
   is LIVE's; or a send key looks real (staging keys must begin with "staging-", a placeholder that lets the send code
   run so it can be exercised, never a working key).
   LIVE (VP_ENV unset): changes nothing, except one thing that can never hurt a real person: a message addressed ONLY to
   a fiction mobile (+61 491 57x xxx, the regulator's reserved range) or an @example.invalid address is answered as sent
   and not delivered, so test rows can never cost a text or bounce an email.
   BOTH (18 Nov 2026, fix/no-mail-to-placeholder): a quick sign-up's login is a placeholder address on
   VPG.placeholderEmailDomain (the billing Worker's VPQ_PLACEHOLDER_DOMAIN). It is never a mailbox, so NO email ever goes
   to it, whichever code path sends: every Resend POST has those addresses taken out of to / cc / bcc, with one log line
   ("[outbox-guard] placeholder ..."). Anyone real left on it still gets it; a message with nobody left in "to" is
   REFUSED (422, x-vp-outbox-guard: refused-placeholder), so the caller sees a failed send, never a false "sent".
   Every setting is in VPG below. Change them there. */
const VPG = {
  stagingValue: 'staging',                 // env.VP_ENV
  testMobilePrefix: '6149157',             // +61 491 57x xxx, fiction range reserved for drama (INBOX 357B Q7)
  testEmailDomain: 'example.invalid',
  placeholderEmailDomain: 'phone.venueplay.com.au', // a quick sign-up's login (VPQ_PLACEHOLDER_DOMAIN): NEVER mailed, live or staging
  liveSupabaseRef: 'ijkzgmdtwtgfkedqspxm', // LIVE. Never reachable from staging.
  dummyKeyPrefix: 'staging-',              // a send key on staging must start with this
  sendKeys: ['RESEND_API_KEY', 'MOBILEMESSAGE_USERNAME', 'MOBILEMESSAGE_PASSWORD', 'CLICKSEND_USERNAME', 'CLICKSEND_API_KEY', 'TWILIO_AUTH_TOKEN', 'SEND_SMS_HOOK_SECRET'],
  stripeKeys: ['STRIPE_SECRET_KEY'],
  sendHosts: /^(api\.resend\.com|api\.mobilemessage\.com\.au|rest\.clicksend\.com|api\.twilio\.com|api\.instantly\.ai|api\.sendgrid\.com|api\.mailgun\.net|fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9.-]*notify\.windows\.com)$/i,
  liveHosts: /^(www\.)?venueplay\.com\.au$|^(api|game)\.venueplay\.com\.au$/i,   // staging may READ these, never write
  stagingHosts: /^[a-z0-9-]+-staging\.venueplay\.com\.au$|^staging\.venueplay\.com\.au$/i
};
function vpgIsStaging(env) { return !!env && String(env.VP_ENV || '') === VPG.stagingValue; }
function vpgDigits(s) {
  let d = String(s == null ? '' : s).replace(/[^0-9]/g, '');
  if (d.indexOf('0') === 0) d = '61' + d.slice(1);
  return d;
}
function vpgIsTestMobile(s) { const d = vpgDigits(s); return d.length >= 8 && d.indexOf(VPG.testMobilePrefix) === 0; }
function vpgIsTestEmail(s) {
  const t = String(s == null ? '' : s).trim().toLowerCase().replace(/[>\s]+$/, '');
  return t.length > VPG.testEmailDomain.length && t.slice(-(VPG.testEmailDomain.length + 1)) === '@' + VPG.testEmailDomain;
}
/* Every recipient named in a send body (JSON): to, destination, recipient, phone, mobile, number. Strings or lists. */
function vpgRecipients(bodyText) {
  const out = [];
  let j = null;
  try { j = JSON.parse(String(bodyText)); } catch (e) { return out; }
  const keys = { to: 1, destination: 1, recipient: 1, phone: 1, mobile: 1, number: 1 };
  (function walk(v, depth) {
    if (depth > 6 || v == null) return;
    if (Array.isArray(v)) { v.forEach(function (x) { walk(x, depth + 1); }); return; }
    if (typeof v !== 'object') return;
    Object.keys(v).forEach(function (k) {
      const x = v[k];
      if (keys[k.toLowerCase()] === 1) { (Array.isArray(x) ? x : [x]).forEach(function (y) { if (typeof y === 'string' || typeof y === 'number') out.push(String(y)); }); }
      else walk(x, depth + 1);
    });
  })(j, 0);
  return out;
}
/* true for an address on the placeholder domain, in any case, bare or as "Name <addr>". Only that exact domain. */
function vpgIsPlaceholderEmail(s) {
  const t = String(s == null ? '' : s).trim().toLowerCase().replace(/^[^<]*</, '').replace(/[>\s]+$/, '');
  const at = t.lastIndexOf('@');
  return at > 0 && t.slice(at + 1) === VPG.placeholderEmailDomain;
}
/* A Resend body (one message or a batch list) with every placeholder taken out of to / cc / bcc. null when there was
   none (send it exactly as it was); else { body, dropped, empty }: empty = a message has nobody left in "to". */
function vpgStripPlaceholders(bodyText) {
  let j = null;
  try { j = JSON.parse(String(bodyText)); } catch (e) { return null; }
  const list = Array.isArray(j) ? j : [j];
  let dropped = 0, empty = false;
  list.forEach(function (m) {
    if (!m || typeof m !== 'object') return;
    let mine = 0;
    ['to', 'cc', 'bcc'].forEach(function (k) {
      if (m[k] == null) return;
      const was = Array.isArray(m[k]) ? m[k] : [m[k]];
      const keep = was.filter(function (a) { return !vpgIsPlaceholderEmail(a); });
      if (keep.length === was.length) return;
      mine += was.length - keep.length;
      if (keep.length) m[k] = keep; else delete m[k];
    });
    if (mine && (m.to == null || (Array.isArray(m.to) && !m.to.length))) empty = true;
    dropped += mine;
  });
  return dropped ? { body: JSON.stringify(j), dropped: dropped, empty: empty } : null;
}
function vpgIsTestRecipient(r) { return vpgIsTestMobile(r) || vpgIsTestEmail(r); }
/* '' when the settings are safe for this deployment, else why not (staging only). */
function vpgStagingProblem(env) {
  if (!vpgIsStaging(env)) return '';
  const bad = [];
  VPG.stripeKeys.forEach(function (k) { if (/^(sk|rk)_live_/.test(String(env[k] || ''))) bad.push(k + ' is a LIVE Stripe key'); });
  if (String(env.SUPABASE_URL || '').indexOf(VPG.liveSupabaseRef) >= 0) bad.push('SUPABASE_URL is the LIVE database');
  if (String(env.SUPABASE_SERVICE_KEY || '').indexOf(VPG.liveSupabaseRef) >= 0) bad.push('SUPABASE_SERVICE_KEY names the LIVE database');
  VPG.sendKeys.forEach(function (k) { const v = String(env[k] || ''); if (v && v.indexOf(VPG.dummyKeyPrefix) !== 0) bad.push(k + ' looks like a real key (staging keys start "' + VPG.dummyKeyPrefix + '")'); });
  return bad.join('; ');
}
/* A 503 for the whole Worker when staging is set up unsafely; null otherwise (and always null on live). */
function vpgRefuse(env) {
  const why = vpgStagingProblem(env);
  if (!why) return null;
  console.log('[outbox-guard] REFUSING to run: ' + why);
  return new Response(JSON.stringify({ error: 'outbox guard: this staging Worker is set up unsafely and will not run', why: why }), { status: 503, headers: { 'Content-Type': 'application/json', 'x-vp-outbox-guard': 'refused' } });
}
function vpgFake(host, recips, n) {
  const id = 'staging-blocked-' + n;
  let body;
  if (/resend/i.test(host)) body = { id: id, last_event: 'delivered' };
  else if (/mobilemessage/i.test(host)) body = { status: 'complete', results: recips.map(function (r) { return { to: r, status: 'success', message_id: id, cost: 0 }; }) };
  else if (/clicksend/i.test(host)) body = { response_code: 'SUCCESS', http_code: 200, data: { messages: recips.map(function (r) { return { to: r, status: 'SUCCESS', message_id: id }; }) } };
  else body = { ok: true, id: id };
  return new Response(JSON.stringify(Object.assign(body, { blocked_by: 'outbox guard' })), { status: 200, headers: { 'Content-Type': 'application/json', 'x-vp-outbox-guard': 'blocked' } });
}
function vpgRecord(kind, host, method, recips, why) {
  const box = globalThis.__vpOutbox || (globalThis.__vpOutbox = []);
  box.push({ at: new Date().toISOString(), kind: kind, host: host, method: method, to: recips.map(function (r) { return String(r).slice(-3); }), why: why });
  if (box.length > 50) box.shift();
  console.log('[outbox-guard] ' + kind + ' ' + method + ' ' + host + ' (' + why + ')');
  return box.length;
}
/* Wraps globalThis.fetch once per isolate. Call first thing in fetch() and scheduled(). */
function vpgInstall(env) {
  if (globalThis.__vpgInstalled === true) return;
  const staging = vpgIsStaging(env);
  const hookHost = (function () { try { return env && env.SEND_SMS_HOOK_URL ? new URL(String(env.SEND_SMS_HOOK_URL)).hostname : ''; } catch (e) { return ''; } })();
  const real = globalThis.fetch;
  if (typeof real !== 'function') return;
  globalThis.__vpgInstalled = true;
  globalThis.fetch = function (input, init) {
    let host = '', method = 'GET', body = '', auth = '';
    try {
      const u = new URL(typeof input === 'string' ? input : (input && input.url) || String(input));
      host = u.hostname;
      method = String((init && init.method) || (input && typeof input === 'object' && input.method) || 'GET').toUpperCase();
      body = init && init.body != null ? String(init.body) : '';
      const h = init && init.headers;
      auth = h ? String(typeof h.get === 'function' ? (h.get('Authorization') || '') : (h.Authorization || h.authorization || '')) : '';
    } catch (e) { return real.apply(this, arguments); }
    try {
      /* NEVER TO A PLACEHOLDER (live and staging alike): checked before anything else. */
      if (method === 'POST' && host.toLowerCase() === 'api.resend.com' && body) {
        const ph = vpgStripPlaceholders(body);
        if (ph) {
          vpgRecord('placeholder', host, method, [], ph.dropped + ' placeholder address' + (ph.dropped === 1 ? '' : 'es') + ' on ' + VPG.placeholderEmailDomain + (ph.empty ? ' and nobody else: NOT SENT' : ' taken off, sent to the rest'));
          if (ph.empty) return Promise.resolve(new Response(JSON.stringify({ statusCode: 422, name: 'validation_error', message: 'outbox guard: ' + VPG.placeholderEmailDomain + ' is a quick sign-up placeholder and is never mailed' }), { status: 422, headers: { 'Content-Type': 'application/json', 'x-vp-outbox-guard': 'refused-placeholder' } }));
          return globalThis.fetch(input, Object.assign({}, init, { body: ph.body }));
        }
      }
      if (staging) {
        if (VPG.stagingHosts.test(host)) return real.apply(this, arguments);
        if (host.indexOf(VPG.liveSupabaseRef) >= 0) return Promise.resolve(new Response(JSON.stringify({ message: 'outbox guard: the LIVE database is not reachable from staging' }), { status: 403, headers: { 'Content-Type': 'application/json', 'x-vp-outbox-guard': 'blocked' } }));
        if (host === 'api.stripe.com') {
          if (/(sk|rk)_live_/.test(auth) || /(sk|rk)_live_/.test(body)) return Promise.resolve(new Response(JSON.stringify({ error: { type: 'invalid_request_error', message: 'outbox guard: a LIVE Stripe key is refused on staging' } }), { status: 401, headers: { 'Content-Type': 'application/json', 'x-vp-outbox-guard': 'blocked' } }));
          return real.apply(this, arguments);
        }
        const isSend = VPG.sendHosts.test(host) || (hookHost && host === hookHost);
        const writesLive = VPG.liveHosts.test(host) && method !== 'GET' && method !== 'HEAD';
        if (isSend || writesLive) {
          const recips = vpgRecipients(body);
          const n = vpgRecord(isSend ? 'send' : 'live-write', host, method, recips, 'staging sends nothing');
          return Promise.resolve(vpgFake(host, recips, n));
        }
        return real.apply(this, arguments);
      }
      /* LIVE: only a message addressed purely to fiction numbers / example.invalid is caught. Anything unclear passes through. */
      if (method === 'POST' && /^(api\.resend\.com|api\.mobilemessage\.com\.au|rest\.clicksend\.com)$/i.test(host)) {
        const recips = vpgRecipients(body);
        if (recips.length > 0 && recips.every(vpgIsTestRecipient)) {
          const n = vpgRecord('test-recipient', host, method, recips, 'only fiction / example.invalid recipients');
          return Promise.resolve(vpgFake(host, recips, n));
        }
      }
    } catch (e) { /* the guard itself must never break a send: fall through */ }
    return real.apply(this, arguments);
  };
}
/* OUTBOX GUARD END */
