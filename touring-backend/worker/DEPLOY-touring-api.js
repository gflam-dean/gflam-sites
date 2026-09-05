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
//      SUPABASE_URL           https://gpoolavkghnxedzrmtmc.supabase.co
//      SUPABASE_SERVICE_KEY   the SERVICE key, NOT the anon one
//    and one as plain text:
//      SITE_ORIGIN            https://www.gflamtouring.com.au
// 4. Deploy again, then open /health in a browser: it should say ok:true with an
//    empty missing list, and it never echoes a secret's value.
//
// The service key is what makes this work: it is the only key that may write
// those tables now, and it never leaves Cloudflare.

// THE ORDER COLUMN HAS TO BE THE ONE THAT EXISTS. The first version of this file
// invented sort_order for three of these tables. shows read fine and the other
// three answered "read failed", because PostgREST rejects an order on a column
// that is not there. These are the orders manage.html has always used.
const TABLES = {
  shows:             { order: 'show_date.asc' },
  experience:        { order: 'created_at.asc' },
  ticket_milestones: { order: 'created_at.asc' },
  tour_categories:   { order: 'priority.asc' },
};

const BUILD = '5 Sep 2026 · touring-api 1';

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

    let payload = null;
    try { payload = await request.json(); } catch (_) { return json({ error: 'bad json' }, 400); }
    const rows = Array.isArray(payload && payload.rows) ? payload.rows : null;
    const deletes = Array.isArray(payload && payload.delete) ? payload.delete : [];
    if (!rows) return json({ error: 'rows must be an array' }, 400);
    if (rows.length > 500) return json({ error: 'too many rows' }, 413);

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

    // EVERY ROW MUST CARRY THE SAME KEYS. PostgREST rejects a bulk insert outright
    // when they differ, and the caller only sees "save failed". That is exactly
    // what happened on the first real save: two existing shows carried an id, the
    // new one did not, and the whole request was refused. The page now mints an id
    // for new rows, but normalising here means no future caller can reintroduce
    // it - a key missing from one row is sent as null rather than absent.
    if (rows.length > 1) {
      const keys = new Set();
      for (const r of rows) {
        if (!r || typeof r !== 'object' || Array.isArray(r)) {
          return json({ error: 'every row must be an object' }, 400);
        }
        for (const k of Object.keys(r)) keys.add(k);
      }
      for (const r of rows) {
        for (const k of keys) if (!(k in r)) r[k] = null;
      }
    }

    // return=representation, not minimal: a newly added show has no id until the
    // database makes one, and the page needs it back or the next Save inserts a
    // duplicate instead of editing the row it just created.
    let saved = [];
    if (rows.length) {
      const up = await sb(env, table, {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
        body: JSON.stringify(rows),
      });
      if (!up.ok) return json({ error: 'save failed', status: up.status, detail: up.body }, 502);
      saved = Array.isArray(up.body) ? up.body : [];
    }
    return json({ ok: true, table, written: rows.length, deleted: deleted, rows: saved });
  },
};
