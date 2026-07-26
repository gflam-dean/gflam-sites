/**
 * VenuePlay API Worker
 * ----------------------------------------------------------------------------
 * Routes:
 *   POST /checkout  -> creates a Stripe Checkout session (card on file,
 *                      subscription with a free trial until launch), writes the
 *                      lead to Supabase, returns { url } for the page to redirect to.
 *   POST /webhook   -> Stripe webhook. On checkout.session.completed, marks the
 *                      venue's row as card_on_file (this is what the counter counts).
 *   POST /contact   -> sends the contact form to Dean via Resend.
 *
 * Set these in the Worker (Settings -> Variables). Use TEST keys first.
 *   STRIPE_SECRET_KEY            sk_test_...
 *   STRIPE_WEBHOOK_SECRET        whsec_...        (from the webhook endpoint you create)
 *   STRIPE_PRICE_MONTHLY         price_...        founding $2.40 / player / month
 *   STRIPE_PRICE_ANNUAL          price_...        founding $24 / player / year
 *   STRIPE_PRICE_STANDARD_MONTHLY price_...       standard $3 / player / month (venue 101+)
 *   STRIPE_PRICE_STANDARD_ANNUAL  price_...       standard $30 / player / year (venue 101+)
 *   RESEND_API_KEY              re_...
 *   SUPABASE_URL                https://gpoolavkghnxedzrmtmc.supabase.co
 *   SUPABASE_SERVICE_KEY        service_role key (NOT the anon key — keep secret)
 *   SITE_URL                    https://www.venueplay.com.au
 *   LAUNCH_TS                   unix seconds for first charge (24 Sep 2026 00:00 Brisbane = 1790172000)
 *   ALLOW_ORIGIN                (optional) e.g. https://www.venueplay.com.au; defaults to *
 * ----------------------------------------------------------------------------
 */

export default {
  async fetch(request, env) {
    const origin = env.ALLOW_ORIGIN || '*';
    const cors = {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Stripe-Signature',
    };
    const json = (obj, status = 200) =>
      new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...cors } });

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '');

    try {
      if (request.method === 'POST' && path === '/checkout') return await handleCheckout(request, env, json);
      if (request.method === 'POST' && path === '/contact')  return await handleContact(request, env, json);
      if (request.method === 'POST' && path === '/webhook')  return await handleWebhook(request, env, cors);
      return json({ error: 'not found' }, 404);
    } catch (err) {
      return json({ error: String(err && err.message || err) }, 500);
    }
  },
};

/* ------------------------------ /checkout ------------------------------ */
async function handleCheckout(request, env, json) {
  const b = await request.json();
  const venue = (b.venue || '').trim();
  const email = (b.email || '').trim();
  const seats = parseInt(b.seats, 10);
  const plan  = b.plan === 'annual' ? 'annual' : 'monthly';

  if (!venue || email.indexOf('@') === -1 || !seats || seats < 1) {
    return json({ error: 'Missing venue, email or seats.' }, 400);
  }

  // Founding closes after the first 100 committed venues. Venue 101+ automatically
  // pays the standard price. We read the live committed-venue count (the same count
  // the site's 100-spot counter uses) and pick founding vs standard accordingly.
  const spotsTaken = await sbSpotsTaken(env);
  const founding = spotsTaken < 100;
  const price = founding
    ? (plan === 'annual' ? env.STRIPE_PRICE_ANNUAL : env.STRIPE_PRICE_MONTHLY)
    : (plan === 'annual' ? env.STRIPE_PRICE_STANDARD_ANNUAL : env.STRIPE_PRICE_STANDARD_MONTHLY);
  if (!price) {
    return json({ error: 'Stripe price not configured for ' + plan + (founding ? ' (founding)' : ' (standard)') }, 500);
  }

  // 1) Save the lead (status 'pending' until the card is added) and get its id.
  const row = await sbInsert(env, {
    venue_name: venue,
    contact_email: email,
    mobile: (b.mobile || '').trim() || null,
    postcode: (b.postcode || '').trim() || null,
    max_seats: seats,
    plan: plan,
    marketing_opt_in: (b.marketing_opt_in === true || b.news === true),
    status: 'pending',
  });
  const rowId = row && row.id;

  // 2) First charge fires at the billing date. Founding venues get a free first month
  // from launch, so this defaults to 1 Oct 2026. The card is collected now via the trial.
  const launchTs = parseInt(env.LAUNCH_TS, 10) || 1790172000; // fallback: 24 Sep 2026 00:00 Brisbane
  const site = (env.SITE_URL || '').replace(/\/+$/, '');

  const form = new URLSearchParams();
  form.set('mode', 'subscription');
  form.set('line_items[0][price]', price);
  form.set('line_items[0][quantity]', String(seats));
  form.set('subscription_data[trial_end]', String(launchTs));
  form.set('subscription_data[metadata][venue]', venue);
  form.set('subscription_data[metadata][row_id]', rowId || '');
  form.set('subscription_data[metadata][tier]', founding ? 'founding' : 'standard');
  form.set('payment_method_collection', 'always'); // require a card even during the trial
  form.set('customer_email', email);
  form.set('client_reference_id', rowId || '');
  form.set('metadata[venue]', venue);
  form.set('metadata[row_id]', rowId || '');
  form.set('metadata[tier]', founding ? 'founding' : 'standard');
  form.set('allow_promotion_codes', 'false');
  form.set('success_url', site + '/?vp=success&session_id={CHECKOUT_SESSION_ID}');
  form.set('cancel_url', site + '/?vp=cancel');

  const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + env.STRIPE_SECRET_KEY,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form.toString(),
  });
  const session = await res.json();
  if (!res.ok) return json({ error: (session.error && session.error.message) || 'Stripe error' }, 502);

  return json({ url: session.url });
}

/* ------------------------------ /webhook ------------------------------ */
async function handleWebhook(request, env, cors) {
  const sig = request.headers.get('Stripe-Signature') || '';
  const raw = await request.text();

  const ok = await verifyStripeSig(raw, sig, env.STRIPE_WEBHOOK_SECRET);
  if (!ok) return new Response('bad signature', { status: 400, headers: cors });

  const event = JSON.parse(raw);
  if (event.type === 'checkout.session.completed') {
    const s = event.data.object;
    const rowId = s.client_reference_id || (s.metadata && s.metadata.row_id);
    if (rowId) {
      await sbUpdate(env, rowId, {
        status: 'card_on_file',
        stripe_customer_id: s.customer || null,
        stripe_subscription_id: s.subscription || null,
      });
    }
  }
  return new Response('ok', { status: 200, headers: cors });
}

/* ------------------------------ /contact ------------------------------ */
async function handleContact(request, env, json) {
  const b = await request.json();
  const name = (b.name || '').trim();
  const email = (b.email || '').trim();
  const message = (b.message || '').trim();
  if (!name || email.indexOf('@') === -1 || !message) return json({ error: 'Missing fields.' }, 400);

  const esc = (s) => String(s).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
  const html =
    '<h2>New VenuePlay enquiry</h2>' +
    '<p><b>Name:</b> ' + esc(name) + '</p>' +
    '<p><b>Email:</b> ' + esc(email) + '</p>' +
    '<p><b>Message:</b><br>' + esc(message).replace(/\n/g, '<br>') + '</p>';

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'VenuePlay <hello@venueplay.com.au>',   // sending domain must be verified in Resend
      to: ['dean@venueplay.com.au', 'hello@venueplay.com.au'],
      reply_to: email,
      subject: 'VenuePlay enquiry from ' + name,
      html: html,
    }),
  });
  if (!res.ok) return json({ error: 'Email send failed.' }, 502);
  return json({ ok: true });
}

/* ------------------------------ Supabase helpers ------------------------------ */
function sbHeaders(env) {
  return {
    'apikey': env.SUPABASE_SERVICE_KEY,
    'Authorization': 'Bearer ' + env.SUPABASE_SERVICE_KEY,
    'Content-Type': 'application/json',
  };
}
async function sbInsert(env, obj) {
  const res = await fetch(env.SUPABASE_URL + '/rest/v1/venueplay_founding', {
    method: 'POST',
    headers: { ...sbHeaders(env), 'Prefer': 'return=representation' },
    body: JSON.stringify(obj),
  });
  const data = await res.json();
  return Array.isArray(data) ? data[0] : data;
}
async function sbUpdate(env, id, obj) {
  await fetch(env.SUPABASE_URL + '/rest/v1/venueplay_founding?id=eq.' + encodeURIComponent(id), {
    method: 'PATCH',
    headers: sbHeaders(env),
    body: JSON.stringify(obj),
  });
}
// Count of committed venues (card_on_file / active), via the same RPC the site counter uses.
async function sbSpotsTaken(env) {
  try {
    const res = await fetch(env.SUPABASE_URL + '/rest/v1/rpc/venueplay_spots_taken', {
      method: 'POST',
      headers: sbHeaders(env),
      body: '{}',
    });
    if (!res.ok) return 0;
    const n = await res.json();
    return parseInt(n, 10) || 0;
  } catch (e) {
    return 0;
  }
}

/* ------------------------------ Stripe signature verify ------------------------------ */
async function verifyStripeSig(payload, header, secret) {
  if (!secret || !header) return false;
  const parts = Object.fromEntries(header.split(',').map((kv) => kv.split('=')));
  const t = parts.t, v1 = parts.v1;
  if (!t || !v1) return false;

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, enc.encode(t + '.' + payload));
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');

  // constant-time-ish compare
  if (hex.length !== v1.length) return false;
  let diff = 0;
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ v1.charCodeAt(i);
  return diff === 0;
}
