// touring-api  -  the only thing allowed to write the touring tables.
// =====================================================================
// WHY THIS EXISTS. manage.html used to write shows, experience,
// ticket_milestones and tour_categories straight from the browser with the
// PUBLIC Supabase key, behind a four digit "PIN" whose SHA-256 sat in the page
// source. That is ten thousand guesses, and it was decorative regardless: the
// writes went out under the public key with or without it, so anybody who
// opened dev tools could rewrite the tour listings. Those tables were later
// locked (writes now answer 42501) which was right, and which is why Save on
// manage.html has been dead.
//
// The password now lives in a Worker secret and is compared in constant time.
// The browser never holds anything that can write to the database.
//
// DEPLOY
// 1. Cloudflare -> Workers -> Create -> name it exactly:  touring-api
// 2. Paste this whole file over the default worker.js. Save and deploy.
// 3. Settings -> Variables and Secrets. Add three as SECRET (encrypted):
//      MANAGE_PASSWORD        a long password you choose; replaces the old PIN
//      SUPABASE_URL           https://ijkzgmdtwtgfkedqspxm.supabase.co  (Sydney, live since 12 Sep 2026)
//      SUPABASE_SERVICE_KEY   the SERVICE key, NOT the anon one
//    and one as plain text:
//      SITE_ORIGIN            https://www.gflamtouring.com.au
// 4. Deploy again, then open /health in a browser: it should say ok:true with an
//    empty missing list, and it never echoes a secret's value.
//
// The service key is what makes this work: it is the only key that may write
// those tables now, and it never leaves Cloudflare.
//
// SINCE 19 OCT 2026 IT GOES UP BY TOOL, like the other Workers:
//   python3 tools/stamp-workers.py
//   python3 tools/deploy-worker.py --live touring-api touring-backend/worker/DEPLOY-touring-api.js
// and /health must then answer with the new build.
//
// IMAGES. Dean, 19 Oct 2026: "Error saving: save failed: canceling statement due to
// statement timeout [57014] when I am trying to add a show". manage.html read each
// banner with readAsDataURL and kept the whole picture, base64, inside shows.img_src.
// The Tugun row alone was 2,003,102 characters. Every Save re-sent every row with its
// picture, so adding one more big PNG pushed a single upsert past the database's eight
// second limit. Pictures now go to Storage through POST /upload, the row keeps only
// the address, and a save that tries to put a picture (or anything megabyte sized)
// back into a row is refused here, whatever page sends it.

// Each table is ordered by a column it really has, and these are the orders
// manage.html has always used. An order on a column that does not exist makes
// PostgREST refuse the whole read, so the wrong one here takes three of the four
// tables offline while the fourth looks fine.
const TABLES = {
  shows:             { order: 'show_date.asc' },
  experience:        { order: 'created_at.asc' },
  ticket_milestones: { order: 'created_at.asc' },
  tour_categories:   { order: 'priority.asc' },
};

// Where pictures go, and how big anything may be. The page shrinks a banner to about
// 300 KB before it sends it, so 2 MB is generous headroom, not a target.
const BUCKET = 'tour-images';
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
// A whole save of rows. Ten shows with every field filled is a few kilobytes; the save
// that timed out was megabytes. Nothing a person types comes near this.
const MAX_SAVE_BYTES = 256 * 1024;
// An image column holds an address. A storage URL is about 150 characters.
const MAX_IMAGE_REF = 2048;
const IMAGE_COLUMN = { shows: 'img_src', tour_categories: 'image_url' };

const BUILD = '19 Oct 2026, 08:59 · c3d4d398';   // tools/stamp-workers.py, do not edit by hand

function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function cors(env, request) {
  const o = request.headers.get('Origin') || '';
  const allow = (env.SITE_ORIGIN || 'https://www.gflamtouring.com.au').replace(/\/$/, '');
  const ok = o && (o.replace(/\/$/, '') === allow ||
                   o === 'https://gflamtouring.com.au' ||
                   o === 'http://localhost:8000');
  return {
    'Access-Control-Allow-Origin': ok ? o : allow,
    'Access-Control-Allow-Headers': 'content-type, x-manage-key',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Vary': 'Origin',
  };
}

// The password comes from a HEADER, never a query string: a key in a URL ends up
// in browser history, in the Worker's request logs, and in every screenshot of
// that tab.
function authorised(request, env) {
  if (!env.MANAGE_PASSWORD) return false;               // unset secret must never mean "open"
  const given = request.headers.get('X-Manage-Key') || '';
  return timingSafeEqual(String(given), String(env.MANAGE_PASSWORD));
}

// Is this a picture, and which kind? Read from the bytes, never from what the browser
// says it is, because the browser's word is the one thing here anybody can set.
function sniffImage(b) {
  if (!b || b.length < 12) return null;
  if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return { type: 'image/jpeg', ext: 'jpg' };
  const PNG = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
  if (PNG.every(function (x, i) { return b[i] === x; })) return { type: 'image/png', ext: 'png' };
  const tag = function (i) { return String.fromCharCode(b[i], b[i + 1], b[i + 2], b[i + 3]); };
  if (tag(0) === 'RIFF' && tag(8) === 'WEBP') return { type: 'image/webp', ext: 'webp' };
  return null;
}

function toHex(buf) {
  const u = new Uint8Array(buf);
  let out = '';
  for (let i = 0; i < u.length; i++) out += (u[i] < 16 ? '0' : '') + u[i].toString(16);
  return out;
}

// POST /upload?kind=show|card, the body is the picture itself. The NAME is ours, made
// from the picture's own hash, so the same picture uploaded twice is one file and a
// caller can never choose a path in the bucket.
async function uploadImage(request, env, json, url) {
  const folder = url.searchParams.get('kind') === 'card' ? 'cards' : 'shows';
  const declared = Number(request.headers.get('Content-Length') || 0);
  if (declared > MAX_IMAGE_BYTES) return json({ error: 'that picture is too big; keep it under 2 MB' }, 413);
  let bytes;
  try { bytes = new Uint8Array(await request.arrayBuffer()); } catch (_) {
    return json({ error: 'could not read the upload' }, 400);
  }
  if (!bytes.length) return json({ error: 'no picture in the upload' }, 400);
  if (bytes.length > MAX_IMAGE_BYTES) return json({ error: 'that picture is too big; keep it under 2 MB' }, 413);
  const kind = sniffImage(bytes);
  if (!kind) return json({ error: 'that is not a JPG, PNG or WebP picture' }, 415);
  const digest = toHex(await crypto.subtle.digest('SHA-256', bytes)).slice(0, 32);
  const path = folder + '/' + digest + '.' + kind.ext;
  const up = await fetch(env.SUPABASE_URL + '/storage/v1/object/' + BUCKET + '/' + path, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + env.SUPABASE_SERVICE_KEY, 'apikey': env.SUPABASE_SERVICE_KEY,
               'Content-Type': kind.type, 'x-upsert': 'true', 'cache-control': 'max-age=31536000' },
    body: bytes,
  });
  if (!up.ok) {
    let t = '';
    try { t = await up.text(); } catch (_) {}
    return json({ error: 'storage refused the picture', status: up.status, detail: String(t).slice(0, 200) }, 502);
  }
  return json({ ok: true, url: env.SUPABASE_URL + '/storage/v1/object/public/' + BUCKET + '/' + path,
                bytes: bytes.length, type: kind.type });
}

// Every page of a small table. PostgREST stops at 1000 rows without saying so, and a
// loop must stop on an EMPTY page, never a short one (see the repo CLAUDE.md).
async function sbAll(env, path) {
  const out = [];
  for (let page = 0; page < 50; page++) {
    const r = await sb(env, path + '&limit=1000&offset=' + (page * 1000));
    if (!r.ok) throw new Error('read failed: ' + path.split('?')[0] + ' ' + r.status);
    const rows = Array.isArray(r.body) ? r.body : [];
    if (!rows.length) break;
    for (const x of rows) out.push(x);
  }
  return out;
}

// A name worth remembering: trimmed, one space between words, not a placeholder.
function cleanName(v) {
  const s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
  if (!s || s.length > 80 || /^(tba|tbc|tbd)$/i.test(s)) return '';
  return s;
}

// Dean, 19 Oct 2026: "should it not save the artists for next time?" After a shows
// save, any performer (queens and host) or venue the database has not seen is added to
// artists or venues, so the manager offers it next time. Matched without regard to
// case, so "Scarlett Fever" and "scarlett fever" are one person. Only the name (and a
// venue's suburb) is ever written: artists also holds email and phone, and nothing a
// page sends here may reach those.
async function rememberNames(env, rows) {
  const people = new Map();
  const places = new Map();
  for (const r of rows) {
    const list = Array.isArray(r.queens) ? r.queens.slice() : [];
    if (typeof r.host === 'string') list.push(r.host);
    for (const q of list) {
      const n = cleanName(q);
      if (n && !people.has(n.toLowerCase())) people.set(n.toLowerCase(), n);
    }
    const v = cleanName(r.venue);
    if (v && !places.has(v.toLowerCase())) places.set(v.toLowerCase(), { name: v, suburb: cleanName(r.suburb) || null });
  }
  const out = { artists: 0, venues: 0 };
  if (people.size) {
    const have = await sbAll(env, 'artists?select=name&order=id.asc');
    for (const a of have) people.delete(String(a.name || '').trim().toLowerCase());
    if (people.size) {
      const ins = await sb(env, 'artists', { method: 'POST', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify(Array.from(people.values()).map(function (n) { return { name: n }; })) });
      if (!ins.ok) throw new Error('could not add to artists: ' + ins.status);
      out.artists = people.size;
    }
  }
  if (places.size) {
    const have = await sbAll(env, 'venues?select=name&order=id.asc');
    for (const v of have) places.delete(String(v.name || '').trim().toLowerCase());
    if (places.size) {
      const ins = await sb(env, 'venues', { method: 'POST', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify(Array.from(places.values())) });
      if (!ins.ok) throw new Error('could not add to venues: ' + ins.status);
      out.venues = places.size;
    }
  }
  return out;
}

async function sb(env, path, init = {}) {
  const r = await fetch(env.SUPABASE_URL + '/rest/v1/' + path, {
    ...init,
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY,
      authorization: 'Bearer ' + env.SUPABASE_SERVICE_KEY,
      'content-type': 'application/json',
      ...(init.headers || {}),
    },
  });
  const text = await r.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch (_) { body = text; }
  return { ok: r.ok, status: r.status, body };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const H = cors(env, request);
    const json = (obj, status) => new Response(JSON.stringify(obj), {
      status: status || 200,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...H },
    });

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: H });

    // Health says whether the secrets are set, and NEVER what they are. Without
    // this a missing secret looks exactly like a wrong password.
    if (path === '/health') {
      const missing = ['MANAGE_PASSWORD', 'SUPABASE_URL', 'SUPABASE_SERVICE_KEY']
        .filter((k) => !env[k]);
      return json({ worker: 'touring-api', build: BUILD, ok: missing.length === 0, missing });
    }

    // Lets manage.html tell a wrong password from a broken deploy.
    if (path === '/check' && request.method === 'POST') {
      if (!env.MANAGE_PASSWORD) return json({ ok: false, reason: 'not_configured' }, 503);
      return authorised(request, env) ? json({ ok: true })
                                      : json({ ok: false, reason: 'bad_password' }, 401);
    }

    // Somebody typing the bare worker URL into a browser is a person, not a bug.
    // It answered {"error":"not found"} and read like a fault when it was working
    // perfectly, so say what this is and where to look instead.
    if (path === '/') {
      return json({
        worker: 'touring-api',
        what: 'Writes the gflamtouring.com.au tour tables. There is no page here.',
        try: '/health for status. The manager UI is https://www.gflamtouring.com.au/manage.html',
      });
    }

    if (path === '/upload') {
      if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405);
      if (!env.MANAGE_PASSWORD || !env.SUPABASE_SERVICE_KEY) return json({ error: 'worker not configured' }, 503);
      if (!authorised(request, env)) return json({ error: 'wrong password' }, 401);
      return uploadImage(request, env, json, url);
    }

    const m = path.match(/^\/(shows|experience|ticket_milestones|tour_categories)$/);
    if (!m) return json({ error: 'not found', path: path }, 404);
    const table = m[1];

    // Reading stays public: the tour pages already read these tables with the
    // public key, so requiring a password here would buy nothing and break them.
    if (request.method === 'GET') {
      const r = await sb(env, table + '?select=*&order=' + TABLES[table].order);
      // Pass the database's own complaint through. A bare "read failed" is what
      // made the bad order column take a round trip to diagnose.
      return json(r.ok ? r.body : { error: 'read failed', status: r.status, detail: r.body },
                  r.ok ? 200 : 502);
    }

    if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405);
    if (!env.MANAGE_PASSWORD || !env.SUPABASE_SERVICE_KEY) {
      return json({ error: 'worker not configured' }, 503);
    }
    if (!authorised(request, env)) return json({ error: 'wrong password' }, 401);

    // ONE SAVE CAN NEVER AGAIN CARRY MEGABYTES. Checked on the declared length first and
    // then on what actually arrived, before anything is parsed.
    const TOO_BIG = { error: 'that save is far too big. Pictures are uploaded on their own now: reload the manager and try again.' };
    if (Number(request.headers.get('Content-Length') || 0) > MAX_SAVE_BYTES) return json(TOO_BIG, 413);
    let raw = '';
    try { raw = await request.text(); } catch (_) { return json({ error: 'bad json' }, 400); }
    if (raw.length > MAX_SAVE_BYTES) return json(TOO_BIG, 413);
    let payload = null;
    try { payload = JSON.parse(raw); } catch (_) { return json({ error: 'bad json' }, 400); }
    const rows = Array.isArray(payload && payload.rows) ? payload.rows : null;
    const deletes = Array.isArray(payload && payload.delete) ? payload.delete : [];
    if (!rows) return json({ error: 'rows must be an array' }, 400);
    if (rows.length > 500) return json({ error: 'too many rows' }, 413);
    for (const r of rows) {
      if (!r || typeof r !== 'object' || Array.isArray(r)) {
        return json({ error: 'every row must be an object' }, 400);
      }
    }

    // A PICTURE NEVER GOES IN A ROW. The column holds the address /upload gave back.
    const imgCol = IMAGE_COLUMN[table];
    if (imgCol) {
      for (const r of rows) {
        const v = r[imgCol];
        if (typeof v === 'string' && (/^data:/i.test(v) || v.length > MAX_IMAGE_REF)) {
          return json({ error: 'pictures are uploaded on their own now, not saved inside the row. Reload the manager and choose the picture again.',
                        column: imgCol }, 413);
        }
      }
    }

    // TWO SAVE SHAPES, BECAUSE manage.html HAS ALWAYS HAD TWO.
    // shows edits rows in place and adds new ones, keeping ids. The other three
    // tables have always thrown the table away and rewritten it from what is on
    // screen, which is why they used ?id=not.is.null as a DELETE filter. Both
    // are kept exactly as they were: changing the semantics of a save is how you
    // lose somebody's tour listings.
    const replace = !!(payload && payload.replace);

    // An empty REPLACE would silently wipe a table. That is a real thing to want
    // (clearing the milestones) but never a thing to do by accident, so the
    // caller has to say so out loud.
    if (replace && rows.length === 0 && !(payload && payload.allow_empty)) {
      return json({ error: 'refusing to empty the table; pass allow_empty if you mean it' }, 400);
    }

    let deleted = 0;
    if (replace) {
      const d = await sb(env, table + '?id=not.is.null', { method: 'DELETE' });
      if (!d.ok) return json({ error: 'clear failed', status: d.status, detail: d.body }, 502);
      deleted = -1;                                  // whole table, count unknown
    } else {
      for (const id of deletes) {
        if (!/^[0-9a-fA-F-]{6,40}$/.test(String(id))) continue;   // ids only, never a filter
        const d = await sb(env, table + '?id=eq.' + encodeURIComponent(String(id)), { method: 'DELETE' });
        if (!d.ok) return json({ error: 'delete failed', status: d.status, detail: d.body }, 502);
        deleted++;
      }
    }

    // EVERY ROW IN ONE UPSERT MUST CARRY THE SAME KEYS, or PostgREST refuses the lot.
    // That broke the first real save (5 Sep). The fix then was to fill a missing key
    // with null, and that became a trap on 19 Oct: the page now leaves img_src out of a
    // row whose picture did not change, and filling it with null would have wiped the
    // picture. So rows are grouped by the keys they carry, and each group is its own
    // upsert. A key a row does not carry is never written.
    const groups = new Map();
    for (const r of rows) {
      const sig = Object.keys(r).sort().join(',');
      if (!groups.has(sig)) groups.set(sig, []);
      groups.get(sig).push(r);
    }

    // return=representation, not minimal: a newly added show has no id until the
    // database makes one, and the page needs it back or the next Save inserts a
    // duplicate instead of editing the row it just created.
    let saved = [];
    let written = 0;
    for (const group of groups.values()) {
      const up = await sb(env, table, {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
        body: JSON.stringify(group),
      });
      if (!up.ok) return json({ error: 'save failed', status: up.status, detail: up.body, written: written }, 502);
      written += group.length;
      if (Array.isArray(up.body)) for (const x of up.body) saved.push(x);
    }

    // Remember new performers and venues for next time. A failure here never fails the
    // save: the show is what matters, and the name can be remembered on the next one.
    let remembered = null;
    if (table === 'shows' && rows.length) {
      try { remembered = await rememberNames(env, rows); }
      catch (e) { remembered = { error: String(e && e.message || e).slice(0, 160) }; }
    }
    return json({ ok: true, table, written: written, deleted: deleted, rows: saved, remembered: remembered });
  },
};
