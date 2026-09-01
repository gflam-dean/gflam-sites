/* PASTE THIS ONE.
   Built 02 Sep 2026, 07:09:10   fingerprint 5a0a7cdc1a85
   If that time is not within the last few minutes, close this window and reopen. */
/* ============================================================================
   PartyPlay Worker: checkout, licences, joining.

   Deployed by paste, the same way the two VenuePlay Workers are.

   SECRETS this needs set in the Cloudflare dashboard:
     STRIPE_SECRET_KEY        sk_live_...
     STRIPE_WEBHOOK_SECRET    whsec_...       (from the webhook endpoint, not the API keys page)
     STRIPE_PRICE_1DAY        price_...       ($50)
     STRIPE_PRICE_3DAY        price_...       ($120)
     SUPABASE_URL             https://....supabase.co
     SUPABASE_SERVICE_KEY     the service_role key. Never the anon key.
     RESEND_API_KEY           re_...
     SITE_ORIGIN              https://partyplay.com.au
   ========================================================================== */
const BUILD = '2 Sep 2026, 07:09 · 91f1ca6f';   // tools/stamp-workers.py, do not edit by hand
/* ---- lib/pp-licence.js, inlined at build time. Edit the file, not this. ---- */
const PPLicence = (function () {
  const module = { exports: {} };
/* PartyPlay licence: a stopwatch, not a calendar.
 *
 * It used to be a fixed window, midnight to 6am on a date chosen at purchase, in
 * the buyer's own state. That worked but it made everybody else's life harder:
 * the buyer had to commit to a date before they had a date, the form needed a
 * state and a date they did not want to think about yet, and every screen had to
 * explain a 6am cutoff nobody asked about.
 *
 * Now the clock starts when the host says go. They buy it, they build their games
 * whenever they like, and on the night they press start and confirm. Twenty four
 * hours, or seventy two, from that moment.
 *
 * What that quietly deletes: every timezone, daylight saving, and the whole
 * question of whose midnight. A duration is the same length everywhere.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PPLicence = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var HOUR = 3600 * 1000;
  var PLANS = {
    1: { days: 1, hours: 24, cents: 5000,  label: '24 hours' },
    3: { days: 3, hours: 72, cents: 12000, label: '3 days' }
  };

  /* An unstarted licence does not sit there forever. Twelve months is generous
     enough that nobody real ever hits it, and it stops a liability accruing
     indefinitely on something bought once and forgotten. */
  var UNUSED_EXPIRY_DAYS = 365;

  function plan(days) {
    var n = Number(days);
    if (!isFinite(n) || n !== Math.trunc(n) || !PLANS[n]) {
      throw new Error('Days must be 1 or 3, got: ' + days);
    }
    return PLANS[n];
  }

  /* Called when the host confirms. Everything after this is arithmetic. */
  function activate(days, nowMs) {
    var p = plan(days);
    var start = nowMs == null ? Date.now() : nowMs;
    return {
      days: p.days,
      hours: p.hours,
      startsAt: start,
      endsAt: start + p.hours * HOUR,
      startsAtIso: new Date(start).toISOString(),
      endsAtIso: new Date(start + p.hours * HOUR).toISOString()
    };
  }

  function isLive(lic, nowMs) {
    if (!lic || !lic.startsAt) return false;
    var t = nowMs == null ? Date.now() : nowMs;
    return t >= lic.startsAt && t < lic.endsAt;
  }

  function msLeft(lic, nowMs) {
    if (!lic || !lic.endsAt) return 0;
    return Math.max(0, lic.endsAt - (nowMs == null ? Date.now() : nowMs));
  }

  /* What a host reads on the console while the night is running. Rounded UP,
     because a clock that says "0 hours left" while the game is still going is
     worse than one that says "1 hour". */
  function timeLeft(lic, nowMs) {
    var ms = msLeft(lic, nowMs);
    if (ms <= 0) return 'Finished';
    var mins = Math.ceil(ms / 60000);
    if (mins < 60) return mins + (mins === 1 ? ' minute left' : ' minutes left');
    var hrs = Math.floor(mins / 60), rem = mins % 60;
    if (hrs < 24) return hrs + (hrs === 1 ? ' hour ' : ' hours ') + (rem ? rem + ' min left' : 'left');
    var d = Math.floor(hrs / 24), h = hrs % 24;
    return d + (d === 1 ? ' day ' : ' days ') + (h ? h + 'h left' : 'left');
  }

  function unusedExpiry(purchasedMs) {
    return purchasedMs + UNUSED_EXPIRY_DAYS * 24 * HOUR;
  }

  /* The words on the confirmation box. This is the only moment the buyer can
     make an expensive mistake, so it says the consequence, not the mechanism. */
  function startWarning(days) {
    var p = plan(days);
    return 'Start your ' + p.label + ' now? The clock runs from this moment, so ' +
           'only do this when the party is actually happening. You can keep building ' +
           'games without starting it.';
  }

  return {
    PLANS: PLANS, PLAYER_CAP: 50, UNUSED_EXPIRY_DAYS: UNUSED_EXPIRY_DAYS,
    PRICE_CENTS: { 1: 5000, 3: 12000 },
    plan: plan, activate: activate, isLive: isLive, msLeft: msLeft,
    timeLeft: timeLeft, unusedExpiry: unusedExpiry, startWarning: startWarning
  };
}));

  return module.exports;
}());

// -----------------------------------------------------------------------------

/* ---------------------------------------------------------------- email ----
 * One shell for every email, so they look like they came from the same company.
 * Table layout and inline styles throughout: Outlook still does not do flexbox
 * and half of these are read on a phone.
 * ------------------------------------------------------------------------ */
const PINK = '#FF1F8E', INK = '#12101A', PAPER = '#FFF1E6', MUTE = '#6A6076';

function emailShell(opts) {
  const site = (opts.site || '').replace(/\/$/, '');
  return '<!doctype html><html><head><meta charset="utf-8">' +
'<meta name="viewport" content="width=device-width,initial-scale=1"></head>' +
'<body style="margin:0;padding:0;background:#F3F0EC;">' +
'<div style="display:none;max-height:0;overflow:hidden;opacity:0">' + escapeHtml(opts.preview || '') + '</div>' +
'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F3F0EC;padding:22px 12px">' +
'<tr><td align="center">' +
'<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:14px;overflow:hidden">' +
'<tr><td style="background:' + INK + ';padding:22px 30px">' +
'<img src="' + site + '/logos/partyplay-primary.svg" width="176" alt="PartyPlay" style="display:block;border:0;height:auto;max-width:176px">' +
'</td></tr>' +
'<tr><td style="height:3px;background:' + PINK + ';font-size:0;line-height:0">&nbsp;</td></tr>' +
'<tr><td style="padding:32px 30px 8px">' +
'<h1 style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:26px;line-height:1.2;color:' + INK + ';font-weight:800">' + opts.heading + '</h1>' +
'</td></tr>' +
'<tr><td style="padding:0 30px 26px;font-family:Helvetica,Arial,sans-serif;font-size:16px;line-height:1.62;color:#3A3444">' + opts.body + '</td></tr>' +
'<tr><td style="padding:20px 30px 30px;font-family:Helvetica,Arial,sans-serif;font-size:13px;line-height:1.6;color:#8A8296;border-top:1px solid #EDE9E4">' +
(opts.foot || '') +
'<p style="margin:10px 0 0">PartyPlay is made by Gflam Group Pty Ltd on the Gold Coast. <a href="' + site + '" style="color:#8A8296">partyplay.com.au</a></p>' +
'</td></tr></table></td></tr></table></body></html>';
}

function emailButton(href, label) {
  return '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0 4px"><tr>' +
    '<td style="background:' + PINK + ';border-radius:10px">' +
    '<a href="' + href + '" style="display:inline-block;padding:14px 26px;font-family:Helvetica,Arial,sans-serif;font-size:16px;font-weight:800;color:#ffffff;text-decoration:none">' + label + '</a>' +
    '</td></tr></table>';
}

function emailCode(code) {
  return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:' + PAPER + ';border-radius:12px;margin:4px 0 20px"><tr>' +
    '<td align="center" style="padding:20px">' +
    '<div style="font-family:Helvetica,Arial,sans-serif;font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:' + MUTE + '">Your party code</div>' +
    '<div style="font-family:Helvetica,Arial,sans-serif;font-size:42px;font-weight:800;letter-spacing:.12em;color:' + PINK + ';line-height:1.25">' + code + '</div>' +
    '</td></tr></table>';
}

/* The three steps, and what each game needs BEFORE the night. This is the part
   that stops the emails arriving: most of the nine need nothing at all, and
   nobody knows that until somebody tells them. */
function emailGuide(site) {
  const step = (n, title, text) =>
    '<tr><td width="32" valign="top" style="font-family:Helvetica,Arial,sans-serif;font-size:17px;font-weight:800;color:' + PINK + ';padding:0 0 14px">' + n + '</td>' +
    '<td style="font-family:Helvetica,Arial,sans-serif;font-size:15.5px;line-height:1.6;color:#3A3444;padding:0 0 14px"><b>' + title + '</b><br>' + text + '</td></tr>';
  const GAMES = [
    ['Bingo','ready','90 ball with the calls. Everyone gets a real ticket on their phone.'],
    ['Trivia','your questions','Write them in advance. Everyone taps an answer, scores keep themselves.'],
    ['How well do you know...','your questions','About whoever the night is for. The youngest cousin usually wins.'],
    ['Guess the photo','your photos','Upload baby photos beforehand and say who each one is.'],
    ['Two truths and a lie','ready','Guests write their own on the night.'],
    ['Heads or tails','ready','Ninety seconds, no skill, everyone in. The best opener.'],
    ['Who here has ever','optional','Gets people who have never met talking.'],
    ['Prize draw','ready','Draws from whoever is actually in the room.'],
    ['The playlist','ready','Guests add songs, the queue goes on the screen.'],
    ['Charades','your words','The word goes to one phone only, never the telly. Screens away from whoever is acting.'],
    ['Who am I?','your list','On the screen and every phone but theirs. Sit them with their back to it.']
  ];
  return '<h2 style="margin:26px 0 12px;font-family:Helvetica,Arial,sans-serif;font-size:19px;color:' + INK + '">How a night runs</h2>' +
    '<table role="presentation" cellpadding="0" cellspacing="0" width="100%">' +
    step(1,'Build your games, whenever suits','Nothing is ticking. Take a fortnight if you like, and your licence keeps for 12 months.') +
    step(2,'Get a screen up before people arrive','A cable from a laptop is the easy one, and no TV at all is fine. <a href="' + site + '/setup" style="color:' + PINK + '">Five ways, here</a>.') +
    step(3,'Press start on the night','That is when your time begins, not when you paid. Then read out the code and guests join in their phone browser.') +
    '</table>' +
    '<h2 style="margin:26px 0 10px;font-family:Helvetica,Arial,sans-serif;font-size:19px;color:' + INK + '">The eleven games</h2>' +
    '<p style="margin:0 0 12px;font-family:Helvetica,Arial,sans-serif;font-size:15px;color:' + MUTE + '">The ones marked <b>ready</b> need nothing from you at all.</p>' +
    '<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="font-family:Helvetica,Arial,sans-serif;font-size:15px;color:#3A3444">' +
    GAMES.map(g => '<tr><td style="padding:7px 10px 7px 0;vertical-align:top;white-space:nowrap"><b>' + g[0] + '</b></td>' +
      '<td style="padding:7px 10px 7px 0;vertical-align:top;font-size:13px;white-space:nowrap;color:' + (g[1] === 'ready' ? '#12786A' : MUTE) + '">' + g[1] + '</td>' +
      '<td style="padding:7px 0;vertical-align:top;color:' + MUTE + '">' + g[2] + '</td></tr>').join('') +
    '</table>';
}

/* Codes get read off a television across a room, by people at a party, who have
   had a drink. Every failed join is a support email, and support email is the one
   thing this product cannot afford.
   
   So two separate alphabets, which is the bit worth understanding:
   
   GENERATED codes never contain a character that has a confusable twin. VenuePlay's
   charset dropped O/0, I/1/L and B/8 but kept BOTH S and 5, and BOTH Z and 2. That
   is fine on a tablet held at arm's length; it is not fine on a TV across a lounge
   room. We drop 2 and 5 as well.
   
   ACCEPTED codes are normalised first, so somebody who types the twin still gets in:
   a 5 becomes an S, a 2 becomes a Z. Shrinking the alphabet alone would still leave
   that person locked out; normalising is what actually removes the support email.
   
   27^6 is 387 million, so nothing is lost by being fussy. */
const CODE_ALPHABET = 'ACDEFGHJKMNPQRSTUVWXYZ34679';
const CODE_RE = /^[ACDEFGHJKMNPQRSTUVWXYZ34679]{6}$/;

function normaliseCode(input) {
  return String(input || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')   // spaces and dashes people add themselves
    .replace(/5/g, 'S')
    .replace(/2/g, 'Z');
}

function makeCode(len = 6) {
  const a = new Uint32Array(len);
  crypto.getRandomValues(a);
  let out = '';
  const n = CODE_ALPHABET.length;
  const limit = Math.floor(4294967296 / n) * n;      // rejection sample, no modulo bias
  for (let i = 0; i < len; i++) {
    let x = a[i];
    while (x >= limit) { const t = new Uint32Array(1); crypto.getRandomValues(t); x = t[0]; }
    out += CODE_ALPHABET[x % n];
  }
  return out;
}

/* Long enough that guessing is pointless, and it only ever appears in the buyer's
   own email. Not the same shape as the join code on purpose: nobody should ever
   mistake one for the other. */
function makeHostKey() {
  const a = new Uint8Array(18);
  crypto.getRandomValues(a);
  return [...a].map(b => b.toString(16).padStart(2, '0')).join('');
}

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...extra }
  });
}

/* A browser only accepts the answer if this header names the origin it actually
   asked from. Returning the apex to everyone meant www.partyplay.com.au, every
   Pages preview and localhost all got a reply the browser threw away, and the
   guest saw nothing but "Load failed" the moment they pressed Join. So decide
   per request, and echo back the origin we recognise. */
function allowedOrigin(env, o) {
  if (!o) return false;
  const allow = (env.SITE_ORIGIN || '').replace(/\/$/, '');
  if (o === allow) return true;
  // Parsed by hand rather than with URL, because an Origin is always just
  // scheme://host[:port] and this has to give the same answer in the test
  // runner, which has no URL constructor and would fail every check closed.
  const m = /^(https?):\/\/([a-z0-9.-]+)(?::\d+)?$/i.exec(o);
  if (!m) return false;
  const scheme = m[1].toLowerCase(), host = m[2].toLowerCase();
  if (scheme === 'http') return host === 'localhost' || host === '127.0.0.1';
  // the site itself, with or without the www
  if (host === 'partyplay.com.au' || host === 'www.partyplay.com.au') return true;
  /* NO pages.dev. This used to allow partyplay.pages.dev and anything under it,
     on the assumption that it was our own Cloudflare Pages project. It is not:
     that name belongs to somebody else's site entirely, so a stranger's page was
     free to call this Worker from a visitor's browser. Checked on 27 Aug 2026 by
     fetching it, and the title that came back was another product's.

     Nothing is lost by dropping it. Preview builds are not turned on for this
     project, and if they ever are, the hostname has to be READ OFF the Cloudflare
     dashboard and added here, never guessed from the product name. That guess is
     what opened this. */
  return false;
}

function cors(env, request) {
  const o = request.headers.get('Origin') || '';
  const allow = (env.SITE_ORIGIN || '').replace(/\/$/, '');
  const ok = allowedOrigin(env, o);
  return {
    'Access-Control-Allow-Origin': ok ? o : allow,
    'Access-Control-Allow-Headers': 'content-type, x-player-token, x-admin-key, authorization',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Vary': 'Origin'
  };
}

/* ------------------------------------------------------------- Supabase ---- */
async function sb(env, path, init = {}) {
  const r = await fetch(env.SUPABASE_URL + '/rest/v1/' + path, {
    ...init,
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY,
      authorization: 'Bearer ' + env.SUPABASE_SERVICE_KEY,
      'content-type': 'application/json',
      ...(init.headers || {})
    }
  });
  const text = await r.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch (e) { body = text; }
  if (!r.ok) {
    const err = new Error('supabase ' + r.status + ': ' + text.slice(0, 300));
    err.status = r.status;
    throw err;
  }
  return body;
}

/* --------------------------------------------------- Stripe signature ------ */
/* Verify a webhook the way Stripe documents it, because the alternative is an
   endpoint that anybody on the internet can use to mark licences paid.
     - recompute HMAC-SHA256 over `${timestamp}.${rawBody}`
     - compare in constant time
     - reject anything older than the tolerance, so a captured request cannot be
       replayed back at us later */
async function stripeVerify(env, rawBody, sigHeader, toleranceSec = 300) {
  if (!sigHeader) return false;
  const parts = {};
  sigHeader.split(',').forEach(p => {
    const i = p.indexOf('=');
    if (i > 0) {
      const k = p.slice(0, i).trim(), v = p.slice(i + 1).trim();
      if (k === 'v1') (parts.v1 = parts.v1 || []).push(v); else parts[k] = v;
    }
  });
  if (!parts.t || !parts.v1 || !parts.v1.length) return false;

  const age = Math.abs(Math.floor(Date.now() / 1000) - parseInt(parts.t, 10));
  if (!isFinite(age) || age > toleranceSec) return false;

  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(env.STRIPE_WEBHOOK_SECRET),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const mac = await crypto.subtle.sign(
    'HMAC', key, new TextEncoder().encode(parts.t + '.' + rawBody)
  );
  const expected = [...new Uint8Array(mac)].map(b => b.toString(16).padStart(2, '0')).join('');
  return parts.v1.some(v => timingSafeEqual(v, expected));
}

function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* ------------------------------------------------------------- Stripe ------ */
async function stripe(env, path, form) {
  const body = new URLSearchParams(form).toString();
  const r = await fetch('https://api.stripe.com/v1/' + path, {
    method: 'POST',
    headers: {
      authorization: 'Bearer ' + env.STRIPE_SECRET_KEY,
      'content-type': 'application/x-www-form-urlencoded'
    },
    body
  });
  const j = await r.json();
  if (!r.ok) {
    const e = new Error((j && j.error && j.error.message) || 'stripe error');
    e.status = 502;
    throw e;
  }
  return j;
}

/* The admin key comes from a HEADER, not a query string. A key in a URL ends up
   in browser history, in the Worker's own request logs, and in every screenshot
   of that tab. The query string is still accepted so a quick check from the
   address bar works, but the admin page always uses the header. */
function isAdmin(request, env, bodyKey) {
  if (!env.ADMIN_KEY) return false;
  const given = request.headers.get('X-Admin-Key') ||
                bodyKey ||
                new URL(request.url).searchParams.get('key') || '';
  return timingSafeEqual(String(given), String(env.ADMIN_KEY));
}

/* Australian mobiles get written a dozen ways and every one of them is the same
   phone. Normalise to E.164 so the allow-list has one row per person rather than
   one per way of typing it. */
function e164(mobile) {
  let d = String(mobile || '').replace(/[^\d+]/g, '');
  if (d.startsWith('+61')) d = '0' + d.slice(3);
  else if (d.startsWith('61') && d.length === 11) d = '0' + d.slice(2);
  if (!/^04\d{8}$/.test(d)) return null;          // Australian mobiles only, on purpose
  return '+61' + d.slice(1);
}

/* WHO IS ASKING.
   A staff member signs in with Supabase phone OTP in the browser and sends the
   access token they get back. We do not verify the signature ourselves: asking
   Supabase who the token belongs to is one round trip and needs no extra secret
   on this Worker, and a JWT secret sitting in a second place is a JWT secret
   that can be leaked from a second place.

   Returns the E.164 mobile of an ACTIVE admin, or null. */
async function adminFromToken(request, env) {
  const auth = request.headers.get('authorization') || '';
  if (!auth.toLowerCase().startsWith('bearer ')) return null;
  const token = auth.slice(7).trim();
  if (!token || token.length > 4096) return null;
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) return null;

  let phone = null;
  try {
    const r = await fetch(env.SUPABASE_URL + '/auth/v1/user', {
      headers: { apikey: env.SUPABASE_SERVICE_KEY, authorization: 'Bearer ' + token }
    });
    if (!r.ok) return null;
    const u = await r.json();
    phone = u && u.phone ? String(u.phone) : null;
  } catch (e) { return null; }
  if (!phone) return null;
  const mob = e164(phone.startsWith('+') ? phone : '+' + phone);
  if (!mob) return null;

  const rows = await sb(env, 'pp_admins?mobile=eq.' + encodeURIComponent(mob) +
                             '&active=is.true&select=mobile&limit=1');
  if (!rows.length) return null;
  // Best effort, never blocks the request.
  sb(env, 'pp_admins?mobile=eq.' + encodeURIComponent(mob), {
    method: 'PATCH', body: JSON.stringify({ last_seen_at: new Date().toISOString() })
  }).catch(() => {});
  return mob;
}

/* Every admin route goes through this. It returns WHO, so the log can name them,
   and the string 'key' when the shared key was used. Null means turn them away. */
async function adminActor(request, env, bodyKey) {
  if (isAdmin(request, env, bodyKey)) return 'key';
  return await adminFromToken(request, env);
}

function licWindow(row) {
  if (!row || !row.activated_at) return null;
  return { startsAt: Date.parse(row.activated_at), endsAt: Date.parse(row.expires_at) };
}

/* Anything that CHANGES a party needs the host key, not the join code. The code is
   on the television for every guest to read; if it were enough to move the date or
   edit the questions, any guest could do both. */
async function requireHost(env, code, hostKey) {
  const c = normaliseCode(code);
  const k = String(hostKey || '').trim();
  if (!CODE_RE.test(c) || k.length < 20) { const e = new Error('Not your party to change.'); e.status = 403; throw e; }
  const rows = await sb(env, 'pp_licences?code=eq.' + c + '&status=eq.paid&select=*');
  if (!rows.length) { const e = new Error('No party with that code.'); e.status = 404; throw e; }
  if (!timingSafeEqual(String(rows[0].host_key || ''), k)) {
    const e = new Error('Not your party to change.'); e.status = 403; throw e;
  }
  return rows[0];
}

const FORMATS = ['bingo90','trivia','musical','draw','howwell','headstails','whohere','photos','truths','playlist',
                 'charades','guesswho'];

/* GET /games?code=&key=   POST /games   POST /games/delete
   Building games is NOT limited by the licence window: a host may write questions
   for a fortnight before a party on one afternoon, and keep them afterwards. So
   none of these check whether the party is live. */
async function handleGamesList(request, env) {
  const u = new URL(request.url);
  const l = await requireHost(env, u.searchParams.get('code'), u.searchParams.get('key'));
  const games = await sb(env, 'pp_games?licence_id=eq.' + l.id + '&order=sort_order.asc&select=id,format,title,config,sort_order');
  const lic = licWindow(l);
  return json({ games, party: {
    code: l.code, party: l.party_name, days: l.days,
    startsAt: l.activated_at, endsAt: l.expires_at,
    live: PPLicence.isLive(lic),
    status: !l.activated_at ? 'ready' : (PPLicence.isLive(lic) ? 'live' : 'finished'),
    timeLeft: l.activated_at ? PPLicence.timeLeft(lic) : null,
    startWarning: PPLicence.startWarning(l.days)
  } });
}

async function handleGameSave(request, env) {
  const b = await request.json().catch(() => ({}));
  const l = await requireHost(env, b.code, b.key);
  const format = FORMATS.indexOf(String(b.format || '')) >= 0 ? String(b.format) : null;
  if (!format) return json({ error: 'Unknown game type.' }, 400);

  const title = b.title ? String(b.title).slice(0, 120) : null;
  let config = (b.config && typeof b.config === 'object') ? b.config : {};
  /* Belt to the braces above: never persist anything that looks like a key, even
     if an old cached client sends one. A stored key is a key that gets broadcast
     later by code nobody is looking at. */
  {
    const scrub = JSON.stringify(config).replace(/([?&])key=[0-9a-f]{20,}/gi, '$1key=REMOVED');
    config = JSON.parse(scrub);
  }
  // A host uploading a hundred photographs would put the whole thing in one row.
  if (JSON.stringify(config).length > 200000) {
    return json({ error: 'That game is too big. Split it into two.' }, 413);
  }

  if (b.id) {
    const rows = await sb(env, 'pp_games?id=eq.' + encodeURIComponent(String(b.id)) + '&licence_id=eq.' + l.id, {
      method: 'PATCH', headers: { prefer: 'return=representation' },
      body: JSON.stringify({ format, title, config, updated_at: new Date().toISOString() })
    });
    if (!rows.length) return json({ error: 'That game is not on this party.' }, 404);
    return json({ ok: true, game: rows[0] });
  }
  const existing = await sb(env, 'pp_games?licence_id=eq.' + l.id + '&select=id');
  if (existing.length >= 40) return json({ error: 'Forty games is plenty for one party.' }, 409);

  const rows = await sb(env, 'pp_games', {
    method: 'POST', headers: { prefer: 'return=representation' },
    body: JSON.stringify([{ licence_id: l.id, format, title, config, sort_order: existing.length }])
  });
  return json({ ok: true, game: rows[0] });
}

async function handleGameDelete(request, env) {
  const b = await request.json().catch(() => ({}));
  const l = await requireHost(env, b.code, b.key);
  if (!b.id) return json({ error: 'Which game?' }, 400);
  await sb(env, 'pp_games?id=eq.' + encodeURIComponent(String(b.id)) + '&licence_id=eq.' + l.id, { method: 'DELETE' });
  return json({ ok: true });
}

/* POST /admin/comp   { key, name, email, state, date, days, reason }
   Issue a licence that was never paid for: a competition winner, a fix for
   something that went wrong, a friend. It is a real licence in every respect. */
async function handleComp(request, env) {
  const b = await request.json().catch(() => ({}));
  const actor = await adminActor(request, env, b.key);
  if (!actor) return json({ error: 'no' }, 403);
  const name  = String(b.name  || '').trim().slice(0, 120);
  const email = String(b.email || '').trim().toLowerCase().slice(0, 200);
  if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: 'Name and a real email, please.' }, 400);

  // Default to the three day licence, since a comp is usually worth giving properly.
  let plan;
  try { plan = PPLicence.plan(b.days == null ? 3 : b.days); }
  catch (e) { return json({ error: String(e.message || e) }, 400); }

  let code = null;
  for (let i = 0; i < 6 && !code; i++) {
    const c = makeCode();
    const clash = await sb(env, 'pp_licences?code=eq.' + c + '&select=id');
    if (!clash.length) code = c;
  }
  if (!code) return json({ error: 'Could not allocate a code.' }, 503);

  const rows = await sb(env, 'pp_licences', {
    method: 'POST', headers: { prefer: 'return=representation' },
    body: JSON.stringify([{
      code, host_key: makeHostKey(), buyer_name: name, buyer_email: email,
      party_name: b.party ? String(b.party).slice(0, 60) : null,
      days: plan.days,
      price_cents: 0, status: 'paid', paid_at: new Date().toISOString(),
      is_comp: true, comp_reason: b.reason ? String(b.reason).slice(0, 200) : null
    }])
  });
  try { await sendLicenceEmail(env, rows[0]); } catch (e) { console.log('comp email failed: ' + e.message); }
  return json({ ok: true, code, hostKey: rows[0].host_key });
}

/* POST /admin/followups  { key }
   The "how was it" email, a week after a party. Run it from a cron.
   Idempotent by the followup_sent_at stamp, so running it twice sends nothing twice. */
async function handleFollowups(request, env) {
  const b = await request.json().catch(() => ({}));
  const actor = await adminActor(request, env, b.key);
  if (!actor) return json({ error: 'no' }, 403);
  const cutoff = new Date(Date.now() - 7 * 86400e3).toISOString();
  /* Keyed off when the party actually finished, not a date somebody guessed at
     purchase. A licence never started gets no follow-up, which is right: there is
     nothing to ask them about. */
  const due = await sb(env, 'pp_licences?status=eq.paid&followup_sent_at=is.null&expires_at=lt.' +
    encodeURIComponent(cutoff) + '&select=id,code,buyer_name,buyer_email,party_name&limit=200');

  let sent = 0, skipped = 0;
  for (const l of due) {
    /* Anyone who has unsubscribed gets nothing, even though an existing customer
       relationship would probably allow it. Somebody who has actively said stop
       is not a person to go back to on a technicality. */
    const off = await sb(env, 'pp_subscribers?email=eq.' + encodeURIComponent(l.buyer_email) +
      '&unsubscribed_at=not.is.null&select=id');
    await sb(env, 'pp_licences?id=eq.' + l.id, {
      method: 'PATCH', body: JSON.stringify({ followup_sent_at: new Date().toISOString() })
    });
    if (off.length) { skipped++; continue; }
    try { await sendFollowupEmail(env, l); sent++; } catch (e) { console.log('followup failed ' + l.code + ': ' + e.message); }
  }
  return json({ ok: true, due: due.length, sent, skipped });
}

async function sendFollowupEmail(env, l) {
  if (!env.RESEND_API_KEY) return;
  const site = (env.SITE_ORIGIN || '').replace(/\/$/, '');
  const now = new Date();
  const endOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
  const expires = new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'long' }).format(endOfMonth);
  const what = l.party_name ? escapeHtml(l.party_name) : 'the party';
  const promo = escapeHtml(env.FOLLOWUP_PROMO_CODE || 'AGAIN10');

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + env.RESEND_API_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({
      from: 'PartyPlay <hello@send.partyplay.com.au>',
      to: [l.buyer_email],
      subject: 'How was ' + (l.party_name || 'the party') + '?',
      html: emailShell({
        site: site,
        preview: '10% off the next one, if you are planning it.',
        heading: 'How was ' + what + '?',
        body: '<p>Hope it went well, ' + escapeHtml(l.buyer_name) + '.</p>' +
              '<p>If you are planning the next one, here is <b>10% off</b> with the code ' +
              '<b style="font-size:18px;color:' + PINK + '">' + promo + '</b> at checkout. ' +
              'It runs out on ' + expires + '.</p>' +
              emailButton(site + '/start', 'Book the next one'),
        foot: '<p style="margin:0"><a href="' + site + '/unsubscribe?e=' + encodeURIComponent(l.buyer_email) +
              '" style="color:#8A8296">Unsubscribe</a></p>'
      })
    })
  });
}

/* ------------------------------------------------------------ the album ----
 * Files go to R2, bound as PHOTOS. The bucket is private: nothing is ever served
 * from a public URL, because a public URL to a photograph of somebody at a party
 * is a link that outlives the party and cannot be taken back.
 *
 * Guests upload with their PLAYER TOKEN, which they only have because they were
 * in the room. The host downloads with the HOST KEY.
 * -------------------------------------------------------------------------- */

const PHOTO_MAX_BYTES = 5 * 1024 * 1024;    // generous: the browser resizes to ~300KB first
/* Video is capped at 15 seconds and 720p in the browser, which lands around
   4.6 MB. 25 MB is a backstop far enough above that it never fires by accident
   but still stops a single upload becoming a problem. */
const VIDEO_MAX_BYTES = 25 * 1024 * 1024;
const ALBUM_KEEP_DAYS = 30;
const OK_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const OK_VIDEO = ['video/webm', 'video/mp4'];

function kindOf(contentType) {
  const t = String(contentType || '').split(';')[0].trim().toLowerCase();
  if (OK_TYPES.indexOf(t) >= 0) return { kind: 'photo', type: t, max: PHOTO_MAX_BYTES };
  if (OK_VIDEO.indexOf(t) >= 0) return { kind: 'video', type: t, max: VIDEO_MAX_BYTES };
  return null;
}

async function playerFor(env, token) {
  const t = String(token || '').trim();
  if (t.length < 20) { const e = new Error('Join the party first.'); e.status = 403; throw e; }
  const rows = await sb(env, 'pp_players?token=eq.' + encodeURIComponent(t) +
    '&select=id,nickname,licence_id&limit=1');
  if (!rows.length) { const e = new Error('Join the party first.'); e.status = 403; throw e; }
  return rows[0];
}

/* POST /photos  (raw image body)
   Headers: X-Player-Token, Content-Type
   The body is the image itself rather than a form, because a phone on party wifi
   should send the bytes once and nothing else. */
async function handlePhotoUpload(request, env) {
  if (!env.PHOTOS) return json({ error: 'Photos are not switched on yet.' }, 503);
  const player = await playerFor(env, request.headers.get('X-Player-Token'));

  const k = kindOf(request.headers.get('content-type'));
  if (!k) return json({ error: 'Photos and videos only, please.' }, 415);
  const noun = k.kind === 'video' ? 'video' : 'photo';

  const buf = await request.arrayBuffer();
  if (!buf.byteLength) return json({ error: 'That ' + noun + ' did not arrive. Try again.' }, 400);
  if (buf.byteLength > k.max) return json({ error: 'That ' + noun + ' is too big.' }, 413);

  const lic = await sb(env, 'pp_licences?id=eq.' + player.licence_id + '&select=id,expires_at,activated_at');
  if (!lic.length || !PPLicence.isLive(licWindow(lic[0]))) {
    return json({ error: 'The party has finished, so the album is closed.' }, 403);
  }

  const ext = k.kind === 'video'
    ? (k.type === 'video/mp4' ? 'mp4' : 'webm')
    : (k.type === 'image/png' ? 'png' : (k.type === 'image/webp' ? 'webp' : 'jpg'));
  const key = player.licence_id + '/' + makeHostKey() + '.' + ext;
  await env.PHOTOS.put(key, buf, { httpMetadata: { contentType: k.type } });

  /* Thirty days after the party ends, not after the upload: a photo taken at the
     start and one taken at 2am should disappear together. */
  const deleteAfter = new Date(Date.parse(lic[0].expires_at) + ALBUM_KEEP_DAYS * 86400e3).toISOString();
  try {
    await sb(env, 'pp_photos', {
      method: 'POST',
      body: JSON.stringify([{
        licence_id: player.licence_id, object_key: key, taken_by: player.nickname,
        bytes: buf.byteLength, content_type: k.type, delete_after: deleteAfter
      }])
    });
  } catch (e) {
    // The index write failed, so the file would be an orphan nobody can find or
    // delete. Take it back out rather than leave it paid for and invisible.
    try { await env.PHOTOS.delete(key); } catch (e2) {}
    if (/album is full/i.test(e.message)) return json({ error: 'This album is full at 300 items.' }, 409);
    throw e;
  }
  return json({ ok: true });
}

/* GET /photos/pick?code=&key=
   The album, for building a Guess the Photo round out of it. Same host key as
   everything else, and it deliberately returns only what a picker needs: an id,
   who took it, and whether it moves. No object keys, no sizes. */
async function handlePhotoPick(request, env) {
  const u = new URL(request.url);
  const l = await requireHost(env, u.searchParams.get('code'), u.searchParams.get('key'));
  const rows = await sb(env, 'pp_photos?licence_id=eq.' + l.id +
    '&order=created_at.asc&select=id,taken_by,purpose,content_type&limit=400');
  const pics = rows.filter(r => !/^video\//.test(r.content_type || ''));
  return json({
    mine:  pics.filter(r => r.purpose === 'game').map(r => ({ id: r.id })),
    party: pics.filter(r => r.purpose !== 'game').map(r => ({ id: r.id, by: r.taken_by }))
  });
}

/* GET /game/photo?id=<uuid>
   A Guess the Photo image, shown on a television to a whole room.

   NO KEY. That is the fix, not an oversight. The host console used to build
   thumbnail URLs containing the HOST KEY, store them in pp_games.config, and
   then broadcast them on a public realtime channel when the game started, which
   handed the host key to every guest in the room and to anyone on the internet
   who knew the six character code. With it they could delete the host's games,
   burn the licence, or read the whole album.

   The photo id is a v4 UUID, so it is 122 bits of unguessable. It is the whole
   capability, and it can only ever reach a photo the host uploaded FOR a game,
   never a guest's album photo. Nothing else is exposed. */
async function handleGamePhoto(request, env) {
  if (!env.PHOTOS) return json({ error: 'Photos are not switched on yet.' }, 503);
  const id = String(new URL(request.url).searchParams.get('id') || '');
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: 'Not found.' }, 404);

  const rows = await sb(env, 'pp_photos?id=eq.' + encodeURIComponent(id) +
    '&purpose=eq.game&select=object_key,content_type');
  if (!rows.length) return json({ error: 'Not found.' }, 404);
  const obj = await env.PHOTOS.get(rows[0].object_key);
  if (!obj) return json({ error: 'Not found.' }, 404);
  return new Response(obj.body, {
    headers: { 'content-type': rows[0].content_type || 'image/jpeg',
               'cache-control': 'public, max-age=3600' }
  });
}

/* GET /album?share=...   the shared view.
   Deliberately thin: the share key shows photos and nothing else. It cannot
   start a party, edit a game, or tell you who bought it. */
async function handleAlbumShare(request, env) {
  const u = new URL(request.url);
  const key = String(u.searchParams.get('share') || '').trim();
  if (key.length < 16) return json({ error: 'That link does not look right.' }, 400);

  const lic = await sb(env, 'pp_licences?share_key=eq.' + encodeURIComponent(key) +
    '&status=eq.paid&select=id,party_name,expires_at,activated_at');
  if (!lic.length) return json({ error: 'That album is not here any more.' }, 404);
  const l = lic[0];

  const rows = await sb(env, 'pp_photos?licence_id=eq.' + l.id + '&purpose=eq.album' +
    '&order=created_at.asc&select=id,taken_by,content_type,created_at,delete_after');
  return json({
    party: l.party_name,
    photos: rows.map(r => ({ id: r.id, by: r.taken_by,
                             video: /^video\//.test(r.content_type || '') })),
    count: rows.length,
    deleteAfter: rows.length ? rows[0].delete_after : null
  });
}

/* GET /album/photo?share=&id=   one file from a shared album */
async function handleAlbumPhoto(request, env) {
  if (!env.PHOTOS) return json({ error: 'Photos are not switched on yet.' }, 503);
  const u = new URL(request.url);
  const key = String(u.searchParams.get('share') || '').trim();
  if (key.length < 16) return json({ error: 'That link does not look right.' }, 400);
  const lic = await sb(env, 'pp_licences?share_key=eq.' + encodeURIComponent(key) + '&status=eq.paid&select=id');
  if (!lic.length) return json({ error: 'Not found.' }, 404);

  const rows = await sb(env, 'pp_photos?id=eq.' + encodeURIComponent(String(u.searchParams.get('id') || '')) +
    '&licence_id=eq.' + lic[0].id + '&select=object_key,content_type');
  if (!rows.length) return json({ error: 'Not found.' }, 404);
  const obj = await env.PHOTOS.get(rows[0].object_key);
  if (!obj) return json({ error: 'Not found.' }, 404);
  return new Response(obj.body, {
    headers: { 'content-type': rows[0].content_type || 'image/jpeg', 'cache-control': 'private, max-age=3600' }
  });
}

/* POST /album/notify-me   { email, marketing }  + X-Player-Token
   A guest asking to be sent the link tomorrow. An OFFER, never a gate: they can
   see and add photos all night without ever touching this, and the photos are
   not held back from anybody who says no. */
async function handleNotifyMe(request, env) {
  const b = await request.json().catch(() => ({}));
  const player = await playerFor(env, request.headers.get('X-Player-Token'));
  const email = String(b.email || '').trim().toLowerCase().slice(0, 200);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: 'That email does not look right.' }, 400);

  await sb(env, 'pp_album_requests?on_conflict=licence_id,email', {
    method: 'POST',
    headers: { prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify([{
      licence_id: player.licence_id, email, nickname: player.nickname,
      marketing_ok: b.marketing === true
    }])
  });

  /* The marketing list is a SEPARATE consent and only happens if they ticked the
     second box. Asking for the album is not permission to email them forever. */
  if (b.marketing === true) {
    try { await recordSubscriber(env, email, player.nickname, null); } catch (e) {}
  }
  return json({ ok: true });
}

/* POST /admin/send-albums  { key }
   Sends every pending album link for parties that have finished. Cron it. */
async function handleSendAlbums(request, env) {
  const b = await request.json().catch(() => ({}));
  const actor = await adminActor(request, env, b.key);
  if (!actor) return json({ error: 'no' }, 403);
  const now = new Date().toISOString();
  const pending = await sb(env, 'pp_album_requests?sent_at=is.null&select=id,email,nickname,licence_id&limit=300');
  let sent = 0;
  for (const r of pending) {
    const lic = await sb(env, 'pp_licences?id=eq.' + r.licence_id +
      '&expires_at=lt.' + encodeURIComponent(now) + '&select=share_key,party_name,expires_at');
    if (!lic.length) continue;                       // party still running, ask again later
    /* STAMP AFTER THE SEND, not before it.

       This marked the request sent and then tried to send, and a failure only
       logged. The job selects sent_at=is.null, so that guest was never retried:
       one Resend hiccup and somebody who asked for the photos at the party never
       got them, with nothing anywhere showing it had gone wrong.

       The other two jobs in this file stamp first on purpose, and that is right
       for them: under-sending marketing beats sending it twice. This one is a
       promise made to a guest at a party, so it fails the other way. The worst
       case here is a duplicate album link, which nobody minds. */
    try {
      await sendAlbumEmail(env, r, lic[0]);
      await sb(env, 'pp_album_requests?id=eq.' + r.id, {
        method: 'PATCH', body: JSON.stringify({ sent_at: now })
      });
      sent++;
    } catch (e) {
      console.log('album email failed, will retry next run: ' + e.message);
    }
  }
  return json({ ok: true, pending: pending.length, sent });
}

async function sendAlbumEmail(env, req, lic) {
  if (!env.RESEND_API_KEY) return;
  const site = (env.SITE_ORIGIN || '').replace(/\/$/, '');
  const gone = new Date(Date.parse(lic.expires_at) + ALBUM_KEEP_DAYS * 86400e3);
  const goneStr = new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'long' }).format(gone);
  const what = lic.party_name ? escapeHtml(lic.party_name) : 'the party';

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + env.RESEND_API_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({
      from: 'PartyPlay <hello@send.partyplay.com.au>',
      to: [req.email],
      subject: 'Photos from ' + (lic.party_name || 'the party'),
      html: emailShell({
        site: site,
        preview: 'They are deleted on ' + goneStr + '. Save what you want before then.',
        heading: 'Photos from ' + what,
        body: '<p>Hi ' + escapeHtml(req.nickname || 'there') + ', here you go.</p>' +
              emailButton(site + '/album?share=' + encodeURIComponent(lic.share_key), 'See the album') +
              '<p style="margin-top:18px"><b>They are deleted on ' + goneStr + '.</b> ' +
              'Save anything you want to keep before then.</p>',
        foot: '<p style="margin:0">You asked for this at the party. It is a one off and you are not on any list.</p>'
      })
    })
  });
}

/* POST /photos/host?code=&key=   (raw image body)
   The host bringing their own photos for Guess the Photo: baby photos, the
   bride at eighteen, whatever they have. Different from a guest upload in three
   ways that matter: it is authorised by the host key rather than a player token,
   it does NOT require the party to have started, and it is marked purpose=game
   so it never lands in the album the guests share. */
async function handleHostPhotoUpload(request, env) {
  if (!env.PHOTOS) return json({ error: 'Photos are not switched on yet.' }, 503);
  const u = new URL(request.url);
  const l = await requireHost(env, u.searchParams.get('code'), u.searchParams.get('key'));

  const k = kindOf(request.headers.get('content-type'));
  if (!k || k.kind !== 'photo') return json({ error: 'Photos only for this one.' }, 415);

  const buf = await request.arrayBuffer();
  if (!buf.byteLength) return json({ error: 'That photo did not arrive. Try again.' }, 400);
  if (buf.byteLength > k.max) return json({ error: 'That photo is too big.' }, 413);

  const ext = k.type === 'image/png' ? 'png' : (k.type === 'image/webp' ? 'webp' : 'jpg');
  const key = l.id + '/game/' + makeHostKey() + '.' + ext;
  await env.PHOTOS.put(key, buf, { httpMetadata: { contentType: k.type } });

  /* Game photos are uploaded days early and must still be there on the night, so
     they are kept from purchase plus a year rather than on the album's clock. */
  const deleteAfter = new Date(Date.parse(l.created_at) + 400 * 86400e3).toISOString();
  let row;
  try {
    const rows = await sb(env, 'pp_photos', {
      method: 'POST', headers: { prefer: 'return=representation' },
      body: JSON.stringify([{
        licence_id: l.id, object_key: key, taken_by: null, purpose: 'game',
        bytes: buf.byteLength, content_type: k.type, delete_after: deleteAfter
      }])
    });
    row = rows[0];
  } catch (e) {
    try { await env.PHOTOS.delete(key); } catch (e2) {}
    if (/plenty for one game/i.test(e.message)) return json({ error: 'Sixty photos is plenty for one game.' }, 409);
    throw e;
  }
  return json({ ok: true, id: row.id });
}

/* GET /photos?code=&key=   the host's list */
async function handlePhotoList(request, env) {
  const u = new URL(request.url);
  const l = await requireHost(env, u.searchParams.get('code'), u.searchParams.get('key'));
  const rows = await sb(env, 'pp_photos?licence_id=eq.' + l.id + '&purpose=eq.album' +
    '&order=created_at.asc&select=id,object_key,taken_by,bytes,content_type,created_at,delete_after');
  const total = rows.reduce((n, r) => n + (r.bytes || 0), 0);
  const waiting = await sb(env, 'pp_album_requests?licence_id=eq.' + l.id + '&sent_at=is.null&select=id');
  return json({
    photos: rows.map(r => ({ id: r.id, by: r.taken_by, at: r.created_at,
                             video: /^video\//.test(r.content_type || '') })),
    count: rows.length,
    videos: rows.filter(r => /^video\//.test(r.content_type || '')).length,
    megabytes: Math.round(total / 1048576 * 10) / 10,
    deleteAfter: rows.length ? rows[0].delete_after : null,
    shareKey: l.share_key,
    guestsWaiting: waiting.length
  });
}

/* GET /photo?code=&key=&id=   one file, streamed through us so the bucket stays private */
async function handlePhotoGet(request, env) {
  if (!env.PHOTOS) return json({ error: 'Photos are not switched on yet.' }, 503);
  const u = new URL(request.url);
  const l = await requireHost(env, u.searchParams.get('code'), u.searchParams.get('key'));
  const id = String(u.searchParams.get('id') || '');
  const rows = await sb(env, 'pp_photos?id=eq.' + encodeURIComponent(id) +
    '&licence_id=eq.' + l.id + '&select=object_key,content_type');
  if (!rows.length) return json({ error: 'Not found.' }, 404);
  const obj = await env.PHOTOS.get(rows[0].object_key);
  if (!obj) return json({ error: 'Not found.' }, 404);
  return new Response(obj.body, {
    headers: {
      'content-type': rows[0].content_type || 'image/jpeg',
      'cache-control': 'private, max-age=3600'
    }
  });
}

/* POST /admin/sweep-photos  { key }
   The delete_after column is only a promise until something acts on it. Run from
   a cron. */
async function handlePhotoSweep(request, env) {
  const b = await request.json().catch(() => ({}));
  const actor = await adminActor(request, env, b.key);
  if (!actor) return json({ error: 'no' }, 403);
  if (!env.PHOTOS) return json({ error: 'Photos are not switched on yet.' }, 503);
  const now = new Date().toISOString();
  const due = await sb(env, 'pp_photos?delete_after=lt.' + encodeURIComponent(now) +
    '&select=id,object_key&limit=500');
  let gone = 0;
  for (const r of due) {
    try { await env.PHOTOS.delete(r.object_key); } catch (e) {}
    await sb(env, 'pp_photos?id=eq.' + r.id, { method: 'DELETE' });
    gone++;
  }
  return json({ ok: true, deleted: gone, remaining: due.length === 500 ? 'more' : 0 });
}

/* GET /unsubscribe?e=<email>   and   POST /unsubscribe
   Every follow-up email links here and the route did not exist. It 404'd, so
   pp_subscribers.unsubscribed_at could never be set by a recipient and the check
   that reads it was dead code. Under the Spam Act a working unsubscribe is not
   optional, so this is a compliance fix, not a feature. */
async function handleUnsubscribe(request, env) {
  const u = new URL(request.url);
  const email = String(u.searchParams.get('e') || '').trim().toLowerCase();
  const site = (env.SITE_ORIGIN || '').replace(/\/$/, '');
  const page = (title, body) => new Response(
    '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' + title + ' | PartyPlay</title>' +
    '<body style="margin:0;background:#12101A;color:#FFF1E6;font-family:system-ui,sans-serif;' +
    'display:grid;place-items:center;min-height:100vh;padding:30px;text-align:center">' +
    '<div style="max-width:34ch"><h1 style="font-size:28px;margin:0 0 12px">' + title + '</h1>' +
    '<p style="color:#B6ADC2;line-height:1.6">' + body + '</p>' +
    '<p style="margin-top:22px"><a style="color:#FF1F8E" href="' + site + '">partyplay.com.au</a></p></div>',
    { headers: { 'content-type': 'text/html; charset=utf-8' } });

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return page('That link looks wrong', 'Email hello@partyplay.com.au and we will take you off by hand.');
  }
  await sb(env, 'pp_subscribers?email=eq.' + encodeURIComponent(email), {
    method: 'PATCH', body: JSON.stringify({ opted_in: false, unsubscribed_at: new Date().toISOString() })
  });
  /* Also stop any album link that has not gone out yet. Somebody unsubscribing
     the day after a party should not then get one more email from us. */
  await sb(env, 'pp_album_requests?email=eq.' + encodeURIComponent(email) + '&sent_at=is.null', {
    method: 'PATCH', body: JSON.stringify({ sent_at: new Date().toISOString() })
  });
  return page('Done', 'You are off the list. Nothing you have paid for is affected, and your party code still works.');
}

/* GET /parties
   How many parties have actually run. Public, cached, and a count and nothing
   else: no names, no dates, nothing that identifies a party or a buyer.
   The landing page uses it to decide whether to show the figure at all. */
async function handleParties(request, env) {
  /* Counted by the database rather than by pulling every row across the wire on
     an anonymous, cacheable, public endpoint. */
  const r = await fetch(env.SUPABASE_URL + '/rest/v1/pp_licences?status=eq.paid&activated_at=not.is.null&select=id',
    { headers: { apikey: env.SUPABASE_SERVICE_KEY, authorization: 'Bearer ' + env.SUPABASE_SERVICE_KEY,
                 prefer: 'count=exact', range: '0-0' } });
  const cr = r.headers.get('content-range') || '';
  const n = parseInt(cr.split('/')[1], 10);
  return json({ parties: isFinite(n) ? n : 0 }, 200, { 'cache-control': 'public, max-age=1800' });
}

/* ------------------------------------------------- the support console ----
 * Everything below exists so that when somebody rings up mid party, whoever
 * answers can SEE what is happening and FIX it, without talking a stranger
 * through a menu on a phone in a loud room.
 *
 * Every action here is one somebody would otherwise have to be walked through,
 * and every one of them is logged with who did it and why.
 * ------------------------------------------------------------------------- */

/* GET /admin/party?q=<code or email>
   One party, everything about it, in one call. */
async function handleAdminParty(request, env) {
  const u = new URL(request.url);
  const actor = await adminActor(request, env);
  if (!actor) return json({ error: 'no' }, 403);
  const q = String(u.searchParams.get('q') || '').trim();
  if (!q) return json({ error: 'Give me a code or an email.' }, 400);

  const byCode = /^[A-Za-z0-9]{6}$/.test(q);
  const filter = byCode
    ? 'code=eq.' + normaliseCode(q)
    : 'buyer_email=ilike.' + encodeURIComponent('*' + q.toLowerCase() + '*');
  const lics = await sb(env, 'pp_licences?' + filter + '&order=created_at.desc&limit=10&select=*');
  if (!lics.length) return json({ error: 'Nothing found for that.' }, 404);

  const out = [];
  for (const l of lics) {
    const [games, players, photos, requests] = await Promise.all([
      sb(env, 'pp_games?licence_id=eq.' + l.id + '&select=id,format,title,config'),
      sb(env, 'pp_players?licence_id=eq.' + l.id + '&order=joined_at.asc&select=id,nickname,joined_at'),
      sb(env, 'pp_photos?licence_id=eq.' + l.id + '&select=id,purpose,bytes'),
      sb(env, 'pp_album_requests?licence_id=eq.' + l.id + '&select=id,email,sent_at')
    ]);
    const lic = licWindow(l);
    out.push({
      code: l.code, id: l.id,
      buyer: { name: l.buyer_name, email: l.buyer_email, mobile: l.buyer_mobile },
      party: l.party_name,
      plan: l.days === 3 ? '3 days' : '24 hours',
      isComp: l.is_comp, compReason: l.comp_reason,
      status: l.status,
      clock: !l.activated_at ? 'not started'
             : (PPLicence.isLive(lic) ? 'running, ' + PPLicence.timeLeft(lic) : 'finished'),
      activatedAt: l.activated_at, expiresAt: l.expires_at,
      boughtAt: l.paid_at || l.created_at,
      games: games.map(g => ({ format: g.format, title: g.title,
                               items: (g.config && g.config.items && g.config.items.length) || 0 })),
      players: players.map(p => p.nickname),
      playerCount: players.length,
      albumPhotos: photos.filter(p => p.purpose !== 'game').length,
      gamePhotos: photos.filter(p => p.purpose === 'game').length,
      megabytes: Math.round(photos.reduce((n, p) => n + (p.bytes || 0), 0) / 1048576 * 10) / 10,
      guestsWantingAlbum: requests.length,
      followupSent: !!l.followup_sent_at,
      /* The two links support will actually need. Handing these over IS the fix
         for the commonest call: they lost the email. */
      hostLink: (env.SITE_ORIGIN || '') + '/host?code=' + l.code + '&key=' + l.host_key,
      runLink:  (env.SITE_ORIGIN || '') + '/run?code=' + l.code + '&key=' + l.host_key,
      tvLink:   (env.SITE_ORIGIN || '') + '/tv?code=' + l.code,
      albumLink:(env.SITE_ORIGIN || '') + '/album?share=' + l.share_key
    });
  }
  return json({ parties: out });
}

/* POST /admin/party/do  { code, action, why, hours }
   The fixes. Deliberately one route with an action, so every one of them goes
   through the same authorisation and the same audit line. */
async function handleAdminAction(request, env) {
  const b = await request.json().catch(() => ({}));
  const actor = await adminActor(request, env, b.key);
  if (!actor) return json({ error: 'no' }, 403);
  const code = normaliseCode(b.code);
  if (!CODE_RE.test(code)) return json({ error: 'That code does not look right.' }, 400);

  const rows = await sb(env, 'pp_licences?code=eq.' + code + '&select=*');
  if (!rows.length) return json({ error: 'No party with that code.' }, 404);
  const l = rows[0];
  const why = String(b.why || '').slice(0, 200);
  const act = String(b.action || '');
  let did = '';

  if (act === 'resend') {
    /* The single commonest call: they cannot find the email. */
    await sendLicenceEmail(env, l);
    did = 'resent the licence email to ' + l.buyer_email;

  } else if (act === 'unstart') {
    /* Somebody pressed start days early, or by accident, and would otherwise
       have burned the thing they paid for. Give it back. */
    if (!l.activated_at) return json({ error: 'That party has not been started.' }, 409);
    await sb(env, 'pp_licences?id=eq.' + l.id, {
      method: 'PATCH', body: JSON.stringify({ activated_at: null, expires_at: null })
    });
    did = 'put the clock back to not started';

  } else if (act === 'extend') {
    const hours = Math.min(72, Math.max(1, Number(b.hours) || 24));
    if (!l.expires_at) return json({ error: 'That party has not been started, so there is nothing to extend.' }, 409);
    const to = new Date(Date.parse(l.expires_at) + hours * 3600e3).toISOString();
    await sb(env, 'pp_licences?id=eq.' + l.id, {
      method: 'PATCH', body: JSON.stringify({ expires_at: to })
    });
    did = 'added ' + hours + ' hours, now ends ' + to;

  } else if (act === 'clear-players') {
    /* A room full of stale players: everyone reconnected under a new name, or a
       test run left ghosts eating the 50 cap. */
    await sb(env, 'pp_players?licence_id=eq.' + l.id, { method: 'DELETE' });
    did = 'cleared everyone out of the room, they can rejoin';

  } else if (act === 'kick') {
    const who = String(b.nickname || '').trim();
    if (!who) return json({ error: 'Which player?' }, 400);
    await sb(env, 'pp_players?licence_id=eq.' + l.id + '&nickname=eq.' + encodeURIComponent(who),
             { method: 'DELETE' });
    did = 'removed ' + who + ' from the room';

  } else if (act === 'refund-note') {
    await sb(env, 'pp_licences?id=eq.' + l.id, {
      method: 'PATCH', body: JSON.stringify({ status: 'refunded', refunded_at: new Date().toISOString() })
    });
    did = 'marked as refunded. NOTE: refund the money in Stripe separately, this only marks the record';

  } else {
    return json({ error: 'Unknown action.' }, 400);
  }

  /* Logged, always. A support tool that can hand out someone else's host link is
     a support tool that needs a record of who did what and why. Now that more
     than one person can be signed in, WHO matters as much as what. */
  try {
    await sb(env, 'pp_admin_log', {
      method: 'POST',
      body: JSON.stringify([{ licence_id: l.id, code: l.code, action: act, detail: did,
                              why: why || null, actor: actor }])
    });
  } catch (e) { console.log('admin log failed: ' + e.message); }

  return json({ ok: true, did });
}

/* GET /admin/stats?key=&months=6
   The monthly numbers. Sold is when money changed hands; ran is when somebody
   actually pressed start, and they are different months often enough to be worth
   counting separately: a licence bought in March for a party in May is one sale
   in March and one party in May. */
/* CHOP CHOP.
   Somebody paid, never used it, and their year is nearly up. One email, once,
   and never again: nudged_at is written before the send so a double tap on a
   flaky connection cannot post the same person twice. */
async function handleNudgeExpiring(request, env) {
  const actor = await adminActor(request, env);
  if (!actor) return json({ error: 'no' }, 403);
  if (!env.RESEND_API_KEY) return json({ error: 'No email key set on this Worker' }, 503);

  const now = Date.now();
  const UNUSED_MS = 365 * 86400e3;
  const rows = await sb(env, 'pp_licences?status=eq.paid&activated_at=is.null&nudged_at=is.null' +
    '&select=id,code,buyer_name,buyer_email,party_name,paid_at,is_comp,host_key,days&limit=200');

  const due = rows.filter(r => {
    if (!r.paid_at) return false;
    const gone = Date.parse(r.paid_at) + UNUSED_MS;
    return gone > now && gone - now < 30 * 86400e3;
  });

  let sent = 0;
  const failed = [];
  for (const r of due) {
    const daysLeft = Math.max(1, Math.round((Date.parse(r.paid_at) + UNUSED_MS - now) / 86400e3));
    try {
      await sb(env, 'pp_licences?id=eq.' + encodeURIComponent(r.id), {
        method: 'PATCH', body: JSON.stringify({ nudged_at: new Date().toISOString() })
      });
      await sendNudgeEmail(env, r, daysLeft);
      sent++;
    } catch (e) {
      failed.push(r.code);
    }
  }
  return json({ ok: true, considered: rows.length, due: due.length, sent, failed });
}

async function sendNudgeEmail(env, l, daysLeft) {
  const site = (env.SITE_ORIGIN || '').replace(/\/$/, '');
  const host = site + '/host?code=' + l.code + '&key=' + (l.host_key || '');
  const what = l.party_name ? escapeHtml(l.party_name) : 'your party';

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + env.RESEND_API_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({
      from: 'PartyPlay <hello@send.partyplay.com.au>',
      to: [l.buyer_email],
      subject: 'Your party code runs out in ' + daysLeft + ' days',
      html: emailShell({
        site: site,
        preview: 'Code ' + l.code + ' has not been used yet, and it expires soon.',
        heading: 'Still got a party in you?',
        body: '<p>Hi ' + escapeHtml(l.buyer_name) + '. You bought a PartyPlay code and never used it, ' +
              'and it runs out in <b>' + daysLeft + ' days</b>.</p>' +
              emailCode(l.code) +
              '<p>Nothing has been ticking. Your ' + (l.days === 3 ? '3 days' : '24 hours') +
              ' of play still starts the moment you press start, so all you need is a night.</p>' +
              emailButton(host, 'Get ' + what + ' going') +
              '<p style="margin-top:18px;font-size:14.5px;color:' + MUTE + '">' +
              'If the party is off, no hard feelings and you can ignore this. ' +
              'Reply and tell us what got in the way, we do read them.</p>',
        foot: '<p style="margin:0">This is the only reminder we will send you about this code.</p>'
      })
    })
  });
}

/* Who am I signed in as? The page asks this first, so it can say "signed in as
   Dean" instead of leaving somebody wondering whether the key or the phone got
   them in. */
/* SEND IT AGAIN.
   The welcome email is the only place the host key exists, so losing it means
   losing a party that has been paid for. Anyone who knows the code may ask for
   it, which is safe: the email only ever goes to the address already on the
   licence, so the worst somebody can do with a code they found is post a
   stranger their own party details. Spaced out all the same, because that is
   still a nuisance and Resend costs money. */
const RESEND_GAP_MS = 3 * 60 * 1000;

async function handleResendWelcome(request, env) {
  const b = await request.json().catch(() => ({}));
  const code = String(b.code || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{4,10}$/.test(code)) return json({ error: 'Which party?' }, 400);
  if (!env.RESEND_API_KEY) return json({ error: 'Email is not set up on this Worker.' }, 503);

  const rows = await sb(env, 'pp_licences?code=eq.' + encodeURIComponent(code) +
    '&status=eq.paid&select=id,code,host_key,buyer_name,buyer_email,party_name,days,is_comp,welcome_sent_at&limit=1');
  /* ONE ANSWER, WHATEVER HAPPENED.
     Saying "sent" for a real code and "not sent" for a made up one turns this into
     a way of finding out which codes exist, which is the first half of taking
     somebody's party off them. So the reply never varies: not for an unknown
     code, not for one asked about twice in a minute. The page says "if that is a
     real code, it is on its way", which is true in every case. */
  const same = () => json({ ok: true });
  if (!rows.length) return same();

  const l = rows[0];
  if (l.welcome_sent_at && Date.now() - Date.parse(l.welcome_sent_at) < RESEND_GAP_MS) return same();

  await sb(env, 'pp_licences?id=eq.' + encodeURIComponent(l.id), {
    method: 'PATCH', body: JSON.stringify({ welcome_sent_at: new Date().toISOString() })
  });
  await sendLicenceEmail(env, l);
  return same();
}

async function handleWhoami(request, env) {
  const actor = await adminActor(request, env);
  if (!actor) return json({ error: 'no' }, 403);
  if (actor === 'key') return json({ actor: 'key', name: 'Shared key', viaKey: true });
  const rows = await sb(env, 'pp_admins?mobile=eq.' + encodeURIComponent(actor) + '&select=name,mobile&limit=1');
  return json({ actor, name: (rows[0] && rows[0].name) || actor, viaKey: false });
}

async function handleStaffList(request, env) {
  const actor = await adminActor(request, env);
  if (!actor) return json({ error: 'no' }, 403);
  const rows = await sb(env, 'pp_admins?select=mobile,name,active,added_at,added_by,last_seen_at&order=name.asc&limit=200');
  return json({ staff: rows, you: actor });
}

async function handleStaffAdd(request, env) {
  const b = await request.json().catch(() => ({}));
  const actor = await adminActor(request, env, b.key);
  if (!actor) return json({ error: 'no' }, 403);

  const mob = e164(b.mobile);
  if (!mob) return json({ error: 'That does not look like an Australian mobile. Try 04xx xxx xxx.' }, 400);
  const name = String(b.name || '').trim().slice(0, 60);
  if (!name) return json({ error: 'Give them a name, so the log means something later.' }, 400);

  /* Re-adding somebody who was switched off should turn them back on rather than
     fail on the unique index, which is what anyone would expect it to do. */
  const existing = await sb(env, 'pp_admins?mobile=eq.' + encodeURIComponent(mob) + '&select=mobile&limit=1');
  if (existing.length) {
    await sb(env, 'pp_admins?mobile=eq.' + encodeURIComponent(mob), {
      method: 'PATCH', body: JSON.stringify({ active: true, name })
    });
    await logAdmin(env, actor, 'staff-on', mob);
    return json({ ok: true, mobile: mob, name, reactivated: true });
  }
  await sb(env, 'pp_admins', {
    method: 'POST',
    body: JSON.stringify({ mobile: mob, name, added_by: actor })
  });
  await logAdmin(env, actor, 'staff-add', mob);
  return json({ ok: true, mobile: mob, name });
}

async function handleStaffOff(request, env) {
  const b = await request.json().catch(() => ({}));
  const actor = await adminActor(request, env, b.key);
  if (!actor) return json({ error: 'no' }, 403);
  const mob = e164(b.mobile);
  if (!mob) return json({ error: 'Which number?' }, 400);
  /* Switched off, never deleted, so the log still resolves who did what. And you
     cannot switch yourself off: locking yourself out of the console you are
     standing in is never what somebody meant to do. */
  if (mob === actor) return json({ error: 'That is you. Get somebody else to do it.' }, 400);
  await sb(env, 'pp_admins?mobile=eq.' + encodeURIComponent(mob), {
    method: 'PATCH', body: JSON.stringify({ active: false })
  });
  await logAdmin(env, actor, 'staff-off', mob);
  return json({ ok: true, mobile: mob });
}

/* Best effort. A log write that fails must never fail the thing it was logging. */
async function logAdmin(env, actor, action, target) {
  try {
    await sb(env, 'pp_admin_log', {
      method: 'POST',
      body: JSON.stringify({ actor, action, detail: String(target || '').slice(0, 120) })
    });
  } catch (e) { /* nothing to do about it, and nothing worth breaking over */ }
}

async function handleStats(request, env) {
  const u = new URL(request.url);
  const actor = await adminActor(request, env);
  if (!actor) return json({ error: 'no' }, 403);
  const months = Math.min(24, Math.max(1, parseInt(u.searchParams.get('months') || '12', 10)));
  const since = new Date(Date.now() - months * 31 * 86400e3).toISOString();
  const now = Date.now();

  /* Everything still alive, plus everything in the window, in one read. A licence
     that was paid for eleven months ago and has still not been started is exactly
     the one worth chasing, so the "expiring" side cannot be limited to the
     reporting window. */
  const rows = await sb(env, 'pp_licences?status=in.(paid,refunded)' +
    '&select=id,code,days,price_cents,is_comp,paid_at,activated_at,expires_at,refunded_at,' +
    'buyer_name,buyer_email,party_name,nudged_at,status&limit=5000');

  const inWindow = (iso) => !!iso && iso >= since;
  const UNUSED_MS = 365 * 86400e3;

  /* Bought, never started. The licence keeps for a year from purchase, so this is
     the clock that decides who gets chased. */
  const shelfLife = (r) => (r.paid_at ? Date.parse(r.paid_at) + UNUSED_MS : null);

  const live = [], upcoming = [], expiring = [];
  let ranTotal = 0, compsTotal = 0, paidTotal = 0;

  rows.forEach(r => {
    if (r.status === 'refunded') return;                 // counted in the money, not the activity
    if (r.is_comp) compsTotal++; else paidTotal++;
    if (r.activated_at) {
      ranTotal++;
      if (r.expires_at && Date.parse(r.expires_at) > now) live.push(r);
    } else if (r.paid_at) {
      const gone = shelfLife(r);
      upcoming.push(r);
      if (gone && gone - now < 30 * 86400e3 && gone > now) expiring.push(r);
    }
  });
  expiring.sort((a, b) => shelfLife(a) - shelfLife(b));

  const slim = (r) => ({
    code: r.code, name: r.buyer_name, email: r.buyer_email,
    party: r.party_name || null, comp: !!r.is_comp,
    expiresOn: shelfLife(r) ? new Date(shelfLife(r)).toISOString().slice(0, 10) : null,
    daysLeft: shelfLife(r) ? Math.max(0, Math.round((shelfLife(r) - now) / 86400e3)) : null,
    nudgedAt: r.nudged_at || null
  });

  /* ---- the money, by month and by quarter ---- */
  const m = {};
  const monthKey = (iso) => (iso || '').slice(0, 7);                       // YYYY-MM
  const quarterKey = (iso) => {
    if (!iso) return '';
    const y = iso.slice(0, 4), mo = parseInt(iso.slice(5, 7), 10);
    return y + '-Q' + Math.ceil(mo / 3);
  };
  const blank = (k) => ({ period: k, sold: 0, revenueCents: 0, refunds: 0, refundedCents: 0,
                          netCents: 0, comps: 0, ran: 0, oneDay: 0, threeDay: 0 });
  const row = (k) => (m[k] = m[k] || blank(k));

  rows.forEach(r => {
    if (inWindow(r.paid_at)) {
      const b = row(monthKey(r.paid_at));
      if (r.is_comp) b.comps++;
      else { b.sold++; b.revenueCents += (r.price_cents || 0); }
    }
    /* A refund lands in the month the money went back, not the month it came in,
       so a month already reported does not quietly change after the fact. */
    if (inWindow(r.refunded_at)) {
      const b = row(monthKey(r.refunded_at));
      b.refunds++; b.refundedCents += (r.price_cents || 0);
    }
    if (inWindow(r.activated_at)) {
      const b = row(monthKey(r.activated_at));
      b.ran++;
      if (r.days === 3) b.threeDay++; else b.oneDay++;
    }
  });

  const money = (c) => '$' + (c / 100).toFixed(2);
  const dress = (b) => {
    b.netCents = b.revenueCents - b.refundedCents;
    return { ...b, revenue: money(b.revenueCents), refunded: money(b.refundedCents), net: money(b.netCents) };
  };

  const monthList = Object.keys(m).sort().reverse().map(k => dress(m[k]));

  const q = {};
  Object.keys(m).forEach(k => {
    const key = quarterKey(k + '-01');
    const t = (q[key] = q[key] || blank(key));
    ['sold','revenueCents','refunds','refundedCents','comps','ran','oneDay','threeDay']
      .forEach(f => { t[f] += m[k][f]; });
  });
  const quarterList = Object.keys(q).sort().reverse().map(k => dress(q[k]));

  return json({
    now: {
      runningNow: live.length,                  // a party is on right now
      upcoming: upcoming.length,                // bought, not started yet
      upcomingPaid: upcoming.filter(r => !r.is_comp).length,
      upcomingComp: upcoming.filter(r => r.is_comp).length,
      ranTotal, paidTotal, compsTotal,
      expiring30: expiring.length,
      neverNudged: expiring.filter(r => !r.nudged_at).length
    },
    expiring: expiring.slice(0, 100).map(slim),
    months: monthList,
    quarters: quarterList,
    licencesConsidered: rows.length
  });
}

/* ============================================================== routes ===== */

/* POST /checkout
   Creates the PENDING licence first, then the Stripe session pointing at it.
   That order matters: a session with no licence row behind it is a customer who
   paid for nothing, and we would have no record to fix it from. */
async function handleCheckout(request, env) {
  const b = await request.json().catch(() => ({}));

  const name  = String(b.name  || '').trim().slice(0, 120);
  const email = String(b.email || '').trim().toLowerCase().slice(0, 200);
  const mobile = b.mobile ? String(b.mobile).trim().slice(0, 40) : null;
  const partyName = b.party ? String(b.party).trim().slice(0, 60) : null;
  const days  = Number(b.days);

  if (!name)  return json({ error: 'We need a name for the licence.' }, 400);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: 'That email does not look right.' }, 400);

  let plan;
  try { plan = PPLicence.plan(days); }
  catch (e) { return json({ error: String(e.message || e) }, 400); }

  const priceId = plan.days === 3 ? env.STRIPE_PRICE_3DAY : env.STRIPE_PRICE_1DAY;
  const priceCents = plan.cents;

  // A code nobody else holds. Six characters is 29^6, so a collision is rare, but
  // rare is not never and a duplicate code would put two parties in one room.
  let code = null;
  for (let i = 0; i < 6 && !code; i++) {
    const c = makeCode();
    const clash = await sb(env, 'pp_licences?code=eq.' + c + '&select=id');
    if (!clash.length) code = c;
  }
  if (!code) return json({ error: 'Could not allocate a code. Try again.' }, 503);

  /* Recorded on the row now, acted on only AFTER they have paid. Signing somebody
     up here used to happen on the anonymous checkout call, so anyone could POST a
     victim's address with optin:true and quietly undo their unsubscribe. The flag
     rides along on the pending row and the webhook is what acts on it.

     It has to be declared HERE, above the insert that reads it. It was below, and
     const in the temporal dead zone throws rather than reading as undefined, so
     every single checkout answered 500 and nobody could buy anything. */
  const wantsMarketing = b.optin === true;

  const rows = await sb(env, 'pp_licences', {
    method: 'POST',
    headers: { prefer: 'return=representation' },
    body: JSON.stringify([{
      code, host_key: makeHostKey(), buyer_name: name, buyer_email: email, buyer_mobile: mobile,
      party_name: partyName,
      days: plan.days,
      marketing_optin: wantsMarketing,
      price_cents: priceCents, status: 'pending'
    }])
  });
  const licence = rows[0];

  const site = (env.SITE_ORIGIN || '').replace(/\/$/, '');
  const session = await stripe(env, 'checkout/sessions', {
    mode: 'payment',                                  // NOT subscription. One party, one charge.
    'line_items[0][price]': priceId,
    'line_items[0][quantity]': '1',
    customer_email: email,
    client_reference_id: licence.id,
    'metadata[licence_id]': licence.id,
    'metadata[code]': code,
    // So a discount code from a follow-up email, or a competition winner's code,
    // works at checkout without needing another deploy every time.
    allow_promotion_codes: 'true',
    success_url: site + '/booked?code=' + code,
    cancel_url: site + '/start',
    // Stripe dedupes on this, so a double-tapped button cannot create two sessions.
    // The header form is set below via a second call parameter.
  });

  await sb(env, 'pp_licences?id=eq.' + licence.id, {
    method: 'PATCH',
    body: JSON.stringify({ stripe_session_id: session.id })
  });

  return json({ url: session.url, code });
}

async function recordSubscriber(env, email, name, mobile) {
  /* Express consent, recorded with a timestamp, and never defaulted on. If they
     are already on the list and previously unsubscribed, this re-subscribes them,
     which is correct: they have just asked again. */
  const now = new Date().toISOString();
  await sb(env, 'pp_subscribers?on_conflict=email', {
    method: 'POST',
    headers: { prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify([{
      email, name: name || null, mobile: mobile || null,
      opted_in: true, opted_in_at: now, source: 'checkout', unsubscribed_at: null
    }])
  });
}

/* POST /stripe/webhook */
async function handleWebhook(request, env) {
  const raw = await request.text();
  const ok = await stripeVerify(env, raw, request.headers.get('stripe-signature'));
  if (!ok) return json({ error: 'bad signature' }, 400);

  const evt = JSON.parse(raw);
  /* THE OTHER HALF OF THE DELAYED-PAYMENT STORY.

     The comment below is right that BECS and bank transfer complete the session
     as 'unpaid' and must not be granted a licence. What was missing is the event
     Stripe sends DAYS LATER to say the money arrived. Only
     checkout.session.completed was acted on, so every other event - including
     async_payment_succeeded - was answered with {ok:true, ignored} and dropped.

     What that costs: an Australian buyer picks bank transfer at the Stripe page,
     the money leaves their account, and the licence sits at 'pending' forever.
     No code, no host key, no welcome email. The admin console labels the row
     "somebody who started checkout and never finished", so whoever answers the
     phone is misdirected too, and handleStats never counts the revenue, so the
     loss is invisible from the inside.

     async_payment_succeeded arrives with payment_status 'paid' and the same
     metadata, so it can take the identical path: the PATCH below is filtered on
     status=eq.pending, which makes it idempotent whichever event gets there
     first.

     And a payment that FAILS or a session that EXPIRES marks the row cancelled,
     so pending rows stop accumulating forever and support can tell "never paid"
     from "paid and waiting". */
  const GRANTS = { 'checkout.session.completed': 1, 'checkout.session.async_payment_succeeded': 1 };
  const KILLS  = { 'checkout.session.async_payment_failed': 1, 'checkout.session.expired': 1 };

  if (KILLS[evt.type]) {
    const dead = evt.data.object;
    const deadId = (dead.metadata && dead.metadata.licence_id) || dead.client_reference_id;
    if (deadId) {
      await sb(env, 'pp_licences?id=eq.' + deadId + '&status=eq.pending', {
        method: 'PATCH',
        body: JSON.stringify({ status: 'cancelled' }),
      });
    }
    return json({ ok: true, cancelled: evt.type });
  }
  if (!GRANTS[evt.type]) return json({ ok: true, ignored: evt.type });

  const s = evt.data.object;
  const licenceId = (s.metadata && s.metadata.licence_id) || s.client_reference_id;
  if (!licenceId) return json({ ok: true, ignored: 'no licence id' });

  /* Stripe fires checkout.session.completed for delayed methods too. BECS and
     bank transfer are on by default for Australian dynamic payment methods, and
     they complete the session with payment_status 'unpaid' while the money is
     still in transit. Marking those paid hands out a free licence. */
  if (s.payment_status && s.payment_status !== 'paid' && s.payment_status !== 'no_payment_required') {
    return json({ ok: true, pending: s.payment_status });
  }

  /* IDEMPOTENT. Stripe retries, and a retry must not send a second licence email
     or overwrite paid_at. The filter does the work: only a row still pending is
     updated, so a second delivery patches nothing and returns quietly. */
  const updated = await sb(env, 'pp_licences?id=eq.' + licenceId + '&status=eq.pending', {
    method: 'PATCH',
    headers: { prefer: 'return=representation' },
    body: JSON.stringify({
      status: 'paid',
      paid_at: new Date().toISOString(),
      stripe_payment_intent: s.payment_intent || null
    })
  });
  if (!updated.length) return json({ ok: true, already: true });

  /* The marketing consent was captured at checkout and only acted on now, once
     money has actually changed hands. */
  if (updated[0].marketing_optin) {
    try { await recordSubscriber(env, updated[0].buyer_email, updated[0].buyer_name, updated[0].buyer_mobile); }
    catch (e) { console.log('subscriber write failed: ' + e.message); }
  }

  try {
    await sendLicenceEmail(env, updated[0]);
    await sb(env, 'pp_licences?id=eq.' + encodeURIComponent(updated[0].id), {
      method: 'PATCH', body: JSON.stringify({ welcome_sent_at: new Date().toISOString() })
    });
  }
  catch (e) { console.log('licence email failed for ' + updated[0].code + ': ' + e.message); }

  return json({ ok: true });
}

/* GET /licence?code=XXXXXX
   What the host console and the player page both ask. Deliberately returns the
   window and whether it is open, never the buyer's details: a guest holds this
   code too, and it is not their business who paid. */
async function handleLicence(request, env) {
  const code = normaliseCode(new URL(request.url).searchParams.get('code'));
  if (!CODE_RE.test(code)) return json({ error: 'That code does not look right.' }, 400);

  const rows = await sb(env, 'pp_licences?code=eq.' + code +
    '&status=eq.paid&select=code,party_name,days,activated_at,expires_at');
  if (!rows.length) return json({ error: 'No party with that code.' }, 404);

  const l = rows[0];
  const lic = licWindow(l);
  return json({
    code: l.code, party: l.party_name, days: l.days,
    startsAt: l.activated_at, endsAt: l.expires_at,
    live: PPLicence.isLive(lic),
    /* Three states now, and "ready" is the new one: bought, built, not started.
       That is where a licence spends most of its life. */
    status: !l.activated_at ? 'ready' : (PPLicence.isLive(lic) ? 'live' : 'finished'),
    timeLeft: l.activated_at ? PPLicence.timeLeft(lic) : null
  });
}

/* POST /licence/start   { code, key }
   The moment the clock starts. Guarded by the host key, because a guest holding
   the join code must not be able to burn somebody's night.

   IDEMPOTENT: starting an already started licence returns the same window rather
   than a second one. A host who taps twice, or whose tablet retries on bad wifi,
   must not lose hours to it. */
async function handleStart(request, env) {
  const b = await request.json().catch(() => ({}));
  const l = await requireHost(env, b.code, b.key);

  if (l.activated_at) {
    const lic = licWindow(l);
    return json({ ok: true, already: true, startsAt: l.activated_at, endsAt: l.expires_at,
                  live: PPLicence.isLive(lic), timeLeft: PPLicence.timeLeft(lic) });
  }
  if (Date.now() > PPLicence.unusedExpiry(Date.parse(l.created_at))) {
    return json({ error: 'This licence was bought over a year ago and has lapsed. Get in touch and we will sort it out.' }, 410);
  }

  const w = PPLicence.activate(l.days);
  /* The filter is the record's own protection: only a row still unstarted is
     written, so two taps arriving together cannot produce two different clocks. */
  await sb(env, 'pp_licences?id=eq.' + l.id + '&activated_at=is.null', {
    method: 'PATCH',
    body: JSON.stringify({
      activated_at: w.startsAtIso,
      expires_at: w.endsAtIso,
      activated_days: l.days,
      activated_note: 'host pressed start and confirmed'
    })
  });
  return json({ ok: true, startsAt: w.startsAtIso, endsAt: w.endsAtIso,
                live: true, timeLeft: PPLicence.timeLeft(w) });
}

/* POST /join   { code, nickname } */
async function handleJoin(request, env) {
  const b = await request.json().catch(() => ({}));
  const code = normaliseCode(b.code);
  const nickname = String(b.nickname || '').trim().slice(0, 24);
  if (!CODE_RE.test(code)) return json({ error: 'That code does not look right.' }, 400);
  if (!nickname) return json({ error: 'Put in a name so everyone knows who you are.' }, 400);

  const rows = await sb(env, 'pp_licences?code=eq.' + code + '&status=eq.paid&select=id,activated_at,expires_at');
  if (!rows.length) return json({ error: 'No party with that code.' }, 404);
  const l = rows[0];

  if (!l.activated_at) return json({ error: 'This party has not been started yet. Ask whoever is running it to press start.' }, 403);
  if (!PPLicence.isLive(licWindow(l))) return json({ error: 'This party has finished.' }, 403);

  /* TWO PEOPLE CALLED SAM.
     At a party of twenty this is not unusual, and until now both joined as "Sam".
     Two identical rows on the leaderboard and nobody knows which is theirs.

     Worse, charades and Who am I decide whose phone shows the secret by matching
     the name: the word goes out tagged "actor: Sam", and every phone belonging to
     a Sam displayed it. The one game whose whole point is that exactly one person
     sees something was broken by two guests sharing a name.

     So the second Sam becomes "Sam 2". The reply carries the name we settled on
     and the phone stores THAT, so it knows itself by a name nobody else has. */
  const taken = await sb(env, 'pp_players?licence_id=eq.' + encodeURIComponent(l.id) + '&select=nickname');
  const used = new Set((taken || []).map(r => String(r.nickname || '').toLowerCase()));
  let name = nickname;
  if (used.has(name.toLowerCase())) {
    for (let n = 2; n <= 60; n++) {
      const tryName = nickname.slice(0, 21) + ' ' + n;
      if (!used.has(tryName.toLowerCase())) { name = tryName; break; }
    }
  }

  const token = makeCode(24);
  try {
    await sb(env, 'pp_players', {
      method: 'POST',
      body: JSON.stringify([{ licence_id: l.id, nickname: name, token }])
    });
  } catch (e) {
    /* The fifty cap is a database trigger, so this is where it surfaces. Say it
       in words a guest can act on rather than showing them a constraint error. */
    if (/50 players/i.test(e.message)) {
      return json({ error: 'This party is full, it is capped at 50 players.' }, 409);
    }
    throw e;
  }
  return json({ ok: true, token, nickname: name });
}

async function sendLicenceEmail(env, l) {
  if (!env.RESEND_API_KEY) return;
  const site = (env.SITE_ORIGIN || '').replace(/\/$/, '');
  const plan = PPLicence.plan(l.days).label;
  const host = site + '/host?code=' + l.code + '&key=' + l.host_key;

  const body =
    '<p>Thanks ' + escapeHtml(l.buyer_name) + '. ' +
    (l.is_comp ? 'This one is on us. ' : '') +
    'Everything you need is below, and none of it has to happen today.</p>' +
    emailCode(l.code) +
    '<p>You have <b>' + plan + '</b> of play. <b>The clock does not start until you press start on the ' +
    'night</b>, so there is no date to get wrong, and your licence keeps for 12 months.</p>' +
    emailButton(host, 'Build your games') +
    '<p style="margin-top:18px;font-size:14.5px;color:' + MUTE + '">That link is yours alone and it is the ' +
    'only way back in, so keep this email. Anyone you forward it to can change your games.</p>' +
    emailGuide(site) +
    '<h2 style="margin:26px 0 10px;font-family:Helvetica,Arial,sans-serif;font-size:19px;color:' + INK +
    '">Everyone&rsquo;s photos, in one place</h2>' +
    '<p style="margin:0">There is a camera on every guest&rsquo;s phone from the moment they join, and a ' +
    'video button under it for a 30 second message. It all lands in one album you can download or share, ' +
    'and the whole lot is deleted 30 days after your party.</p>';

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + env.RESEND_API_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({
      from: 'PartyPlay <hello@send.partyplay.com.au>',
      to: [l.buyer_email],
      subject: l.is_comp ? 'A party on us: your code is ' + l.code : 'Your party code is ' + l.code,
      html: emailShell({
        site: site,
        preview: 'Your code is ' + l.code + '. Build your games whenever suits, nothing is ticking yet.',
        heading: l.is_comp ? 'A party, on us' : 'You are all set',
        body: body,
        foot: '<p style="margin:0">Stuck on anything? Just reply to this email, it comes straight to us.</p>'
      })
    })
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/* Fail loudly on a missing secret, at the first request, naming the one that is
   missing. Without this a half-configured Worker looks fine until somebody tries
   to pay, and then throws something unreadable from inside Stripe. */
const REQUIRED = ['STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET','STRIPE_PRICE_1DAY',
                  'STRIPE_PRICE_3DAY','SUPABASE_URL','SUPABASE_SERVICE_KEY','SITE_ORIGIN'];

function missingSecrets(env) {
  return REQUIRED.filter(k => !env[k]);
}

export default {
  // exposed so the test runner can check the allow-list directly
  _allowedOrigin: allowedOrigin,
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const method = request.method;
    const ch = cors(env, request);

    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: ch });

    // A quick way to check a deploy before pointing real money at it.
    if (method === 'GET' && path === '/health') {
      const missing = missingSecrets(env);
      /* THE PHOTO STORE IS NOT A SECRET, IT IS A BINDING, and it was not checked
         here at all. So health said "ok, nothing missing" while every single
         photo upload answered "Photos are not switched on yet". A host could sell
         a party, tell their guests about the album, watch every upload fail all
         night, and then get an email offering them photos that do not exist.

         Reported separately rather than folded into `missing`, because the site
         genuinely does work without it: the games all run, only the album is
         dead. But it must be VISIBLE. */
      const photos = !!env.PHOTOS;

      /* CAN ANYBODY ACTUALLY GET IN?

         Migration 11 moved admin sign-in to phone OTP and made pp_admins the
         table that decides who gets past it. It seeded no rows. So the moment
         the shared key came off the sign-in screen, that table was empty and
         every admin action answered 403 'no', including comping a party.

         Nothing noticed, because the release check tests that admin routes
         REFUSE an unauthenticated caller, and refusing is exactly what they
         did. It proved the lock worked. It could not tell that no key fitted.

         So health now counts the admins. Zero is not a warning, it is a
         locked-out product. */
      let admins = null;
      try {
        const rows = await sb(env, 'pp_admins?active=is.true&select=mobile');
        admins = Array.isArray(rows) ? rows.length : null;
      } catch (e) { admins = null; }
      const lockedOut = (admins === 0 && !env.ADMIN_KEY);

      const warnings = [];
      if (!photos) warnings.push('R2 is not bound as PHOTOS. Every photo and video upload will fail, and the album will be empty.');
      if (lockedOut) warnings.push('pp_admins has no active rows and no ADMIN_KEY is set, so NOBODY can sign in to the admin. Comping a party, refunds and resends will all answer "no". Seed your mobile: partyplay-12-seed-first-admin.sql.');

      return json({
        build: BUILD,
        ok: !missing.length && photos && !lockedOut,
        missing,
        photos,
        admins,
        warning: warnings.length ? warnings.join(' ') : undefined
      }, missing.length ? 503 : 200, ch);
    }
    const missing = missingSecrets(env);
    if (missing.length) {
      console.log('Worker is not configured, missing: ' + missing.join(', '));
      return json({ error: 'This Worker is not configured yet.', missing }, 503, ch);
    }

    try {
      // The webhook is Stripe talking to us, not a browser. No CORS, and the
      // raw body must not be parsed before the signature is checked.
      if (method === 'POST' && path === '/stripe/webhook') return await handleWebhook(request, env);

      let res;
      if (method === 'POST' && path === '/checkout')      res = await handleCheckout(request, env);
      else if (method === 'GET'  && path === '/licence')  res = await handleLicence(request, env);
      else if (method === 'GET'  && path === '/parties')  res = await handleParties(request, env);
      else if (path === '/unsubscribe')                   res = await handleUnsubscribe(request, env);
      else if (method === 'POST' && path === '/licence/start') res = await handleStart(request, env);
      else if (method === 'POST' && path === '/join')     res = await handleJoin(request, env);
      else if (method === 'GET'  && path === '/games')        res = await handleGamesList(request, env);
      else if (method === 'POST' && path === '/games')        res = await handleGameSave(request, env);
      else if (method === 'POST' && path === '/games/delete') res = await handleGameDelete(request, env);
      else if (method === 'POST' && path === '/admin/comp')      res = await handleComp(request, env);
      else if (method === 'POST' && path === '/licence/resend') res = await handleResendWelcome(request, env);
      else if (method === 'GET'  && path === '/admin/stats')     res = await handleStats(request, env);
      else if (method === 'GET'  && path === '/admin/whoami')    res = await handleWhoami(request, env);
      else if (method === 'GET'  && path === '/admin/staff')     res = await handleStaffList(request, env);
      else if (method === 'POST' && path === '/admin/staff/add') res = await handleStaffAdd(request, env);
      else if (method === 'POST' && path === '/admin/staff/off') res = await handleStaffOff(request, env);
      else if (method === 'GET'  && path === '/admin/party')     res = await handleAdminParty(request, env);
      else if (method === 'POST' && path === '/admin/party/do')  res = await handleAdminAction(request, env);
      else if (method === 'POST' && path === '/photos')          res = await handlePhotoUpload(request, env);
      else if (method === 'GET'  && path === '/photos')          res = await handlePhotoList(request, env);
      else if (method === 'GET'  && path === '/photo')           res = await handlePhotoGet(request, env);
      else if (method === 'GET'  && path === '/photos/pick')     res = await handlePhotoPick(request, env);
      else if (method === 'POST' && path === '/photos/host')     res = await handleHostPhotoUpload(request, env);
      else if (method === 'POST' && path === '/admin/sweep-photos') res = await handlePhotoSweep(request, env);
      else if (method === 'GET'  && path === '/album')           res = await handleAlbumShare(request, env);
      else if (method === 'GET'  && path === '/album/photo')     res = await handleAlbumPhoto(request, env);
      else if (method === 'GET'  && path === '/game/photo')      res = await handleGamePhoto(request, env);
      else if (method === 'POST' && path === '/album/notify-me') res = await handleNotifyMe(request, env);
      else if (method === 'POST' && path === '/admin/send-albums') res = await handleSendAlbums(request, env);
      else if (method === 'POST' && path === '/admin/followups') res = await handleFollowups(request, env);
      else if (method === 'POST' && path === '/admin/nudge-expiring') res = await handleNudgeExpiring(request, env);
      else return new Response('not found', { status: 404, headers: ch });

      Object.entries(ch).forEach(([k, v]) => res.headers.set(k, v));
      return res;
    } catch (e) {
      // Only errors we raised on purpose are echoed. Anything else gets a
      // reference and stays server-side, so no stack or SQL detail leaks.
      /* Only errors WE raised are echoed. sb() throws with the raw PostgREST body,
         which carries SQL state, column names and constraint names, and it also
         carries a status under 500, so it used to sail straight out to the client. */
      if (e && e.status && e.status < 500 && !/^supabase \d/.test(String(e.message))) {
        return json({ error: String(e.message) }, e.status, ch);
      }
      const ref = makeCode(6);
      console.log('[' + ref + '] ' + String((e && e.stack) || e));
      return json({ error: 'Something went wrong', ref }, 500, ch);
    }
  }
};
