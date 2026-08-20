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
 *   STRIPE_PRICE_MONTHLY          price_...   founding $2.50 / player / month
 *   STRIPE_PRICE_ANNUAL           price_...   founding $2.30 / player / month, billed yearly
 *   STRIPE_PRICE_STANDARD_MONTHLY price_...   standard $3.00 / player / month (venue 101+)
 *   STRIPE_PRICE_STANDARD_ANNUAL  price_...   standard $2.85 / player / month, billed yearly (venue 101+)
 *   RESEND_API_KEY              re_...
 *   VP_INTERNAL_EMAIL           optional. Where the "new signup" heads-up goes.
 *                               Defaults to hello@venueplay.com.au, so it needs setting
 *                               only to send it somewhere else.
 *   SUPABASE_URL                https://gpoolavkghnxedzrmtmc.supabase.co
 *   SUPABASE_SERVICE_KEY        service_role key (NOT the anon key — keep secret)
 *   SITE_URL                    https://www.venueplay.com.au
 *   LAUNCH_TS                   unix seconds for first charge (24 Sep 2026 00:00 Brisbane = 1790172000)
 *   ALLOW_ORIGIN                (optional) e.g. https://www.venueplay.com.au; defaults to *
 * ----------------------------------------------------------------------------
 */

export default {
  async fetch(request, env) {
    // Allow BOTH the apex (https://venueplay.com.au) and the www host (and any venueplay.com.au
    // subdomain) by reflecting the caller's Origin when it is a venueplay.com.au site. This stops
    // the "www vs no-www" mismatch that silently blocks the browser. Falls back to ALLOW_ORIGIN
    // (comma-separated list allowed) or * for anything else.
    const reqOrigin = request.headers.get('Origin') || '';
    const allowList = (env.ALLOW_ORIGIN || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    const originOk = /^https:\/\/([a-z0-9-]+\.)?venueplay\.com\.au$/.test(reqOrigin) || allowList.indexOf(reqOrigin) !== -1;
    const CANONICAL = 'https://www.venueplay.com.au';
    // Safe with no env var set: venueplay.com.au origins are reflected, anything else gets the
    // canonical site (which the browser will refuse), never a wildcard. ALLOW_ORIGIN is now
    // purely additive, for a staging or preview host.
    const origin = originOk ? reqOrigin : (allowList[0] || CANONICAL);
    const cors = {
      'Access-Control-Allow-Origin': origin,
      'Vary': 'Origin',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Stripe-Signature, Authorization, X-VP-Venue',
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
      // Owner self-serve billing (vpb* functions pasted in from venueplay-api-account.js).
      if (request.method === 'POST' && path === '/account/summary'   && typeof vpbAccountSummary === 'function') return await vpbAccountSummary(request, env, json);
      if (request.method === 'POST' && path === '/account/players'   && typeof vpbSetPlayers === 'function')     return await vpbSetPlayers(request, env, json);
      if (request.method === 'POST' && path === '/account/add-venue' && typeof vpbAddVenue === 'function')       return await vpbAddVenue(request, env, json);
      if (request.method === 'POST' && path === '/account/reminders' && typeof vpbSetReminders === 'function')   return await vpbSetReminders(request, env, json);
      if (request.method === 'POST' && path === '/account/portal'    && typeof vpbBillingPortal === 'function')  return await vpbBillingPortal(request, env, json);
      if (request.method === 'POST' && path === '/account/cancel-venue' && typeof vpbCancelVenue === 'function')  return await vpbCancelVenue(request, env, json);
      if (request.method === 'POST' && path === '/account/screen-get'  && typeof vpbScreenGet === 'function')    return await vpbScreenGet(request, env, json);
      if (request.method === 'POST' && path === '/account/screen-save' && typeof vpbScreenSave === 'function')   return await vpbScreenSave(request, env, json);
      if (request.method === 'POST' && path === '/account/screen-upload' && typeof vpbScreenUpload === 'function') return await vpbScreenUpload(request, env, json);
      if (request.method === 'POST' && path === '/account/hosts'       && typeof vpbListHosts === 'function')    return await vpbListHosts(request, env, json);
      if (request.method === 'POST' && path === '/account/host-add'    && typeof vpbAddHost === 'function')      return await vpbAddHost(request, env, json);
      if (request.method === 'POST' && path === '/account/manager-add'  && typeof vpbAddManager === 'function')   return await vpbAddManager(request, env, json);
      if (request.method === 'POST' && path === '/account/managers'     && typeof vpbListManagers === 'function') return await vpbListManagers(request, env, json);
      if (request.method === 'POST' && path === '/account/optin-export'  && typeof vpbOptinExport === 'function')  return await vpbOptinExport(request, env, json);
      if (request.method === 'POST' && path === '/account/host-remove' && typeof vpbRemoveHost === 'function')   return await vpbRemoveHost(request, env, json);
      if (request.method === 'POST' && path === '/account/staff-set-venues' && typeof vpbSetStaffVenues === 'function') return await vpbSetStaffVenues(request, env, json);
      if (request.method === 'POST' && path === '/account/my-venues'   && typeof vpbMyVenues === 'function')     return await vpbMyVenues(request, env, json);
      // Gflam HQ admin (vpa* functions below). JWT-verified + role-gated inside each handler.
      if (request.method === 'POST' && path === '/admin/venue'           && typeof vpaHandleVenue === 'function')          return await vpaHandleVenue(request, env, json);
      if (request.method === 'POST' && path === '/admin/discount'        && typeof vpaHandleDiscount === 'function')       return await vpaHandleDiscount(request, env, json);
      if (request.method === 'POST' && path === '/admin/discount-remove' && typeof vpaHandleDiscountRemove === 'function') return await vpaHandleDiscountRemove(request, env, json);
      if (request.method === 'POST' && path === '/admin/quiet-venues'    && typeof vpaHandleQuietVenues === 'function')    return await vpaHandleQuietVenues(request, env, json);
      if (request.method === 'POST' && path === '/admin/venue-status'    && typeof vpaHandleVenueStatus === 'function')    return await vpaHandleVenueStatus(request, env, json);
      if (request.method === 'POST' && path === '/admin/venue-gaming'    && typeof vpaHandleVenueGaming === 'function')    return await vpaHandleVenueGaming(request, env, json);
      if (request.method === 'POST' && path === '/admin/gst'             && typeof vpaHandleGst === 'function')            return await vpaHandleGst(request, env, json);
      if (request.method === 'POST' && path === '/admin/optin-approve'   && typeof vpaHandleOptinApprove === 'function')   return await vpaHandleOptinApprove(request, env, json);
      if (request.method === 'POST' && path === '/admin/staff'           && typeof vpaHandleStaff === 'function')          return await vpaHandleStaff(request, env, json);
      if (request.method === 'POST' && path === '/admin/audit'           && typeof vpaHandleAudit === 'function')          return await vpaHandleAudit(request, env, json);
      return json({ error: 'not found' }, 404);
    } catch (err) {
      // Do not leak internal error text publicly. On authenticated owner/admin endpoints only,
      // include a short detail so the account holder can see WHY (temporary diagnostic aid).
      const dbg = (path.indexOf('/account') === 0 || path.indexOf('/admin') === 0);
      const body = { error: 'Something went wrong on our end. Please try again.' };
      if (dbg) {
        const raw = String((err && err.message) || err);
        const m = raw.match(/constraint "([^"]+)"/);
        const col = raw.match(/column "([^"]+)"/);
        body._detail = (m ? ('CONSTRAINT: ' + m[1] + '. ') : '') + (col ? ('COLUMN: ' + col[1] + '. ') : '') + raw.slice(0, 500);
      }
      return json(body, 500);
    }
  },
};

/* ------------------------------ /checkout ------------------------------ */
async function handleCheckout(request, env, json) {
  const b = await request.json();
  const email = (b.email || '').trim();
  const contactName = (b.name || '').trim().slice(0, 200); // cap length (Stripe metadata max 500)
  const plan  = b.plan === 'annual' ? 'annual' : 'monthly';

  // The form sends venues:[{name,seats}] (one row, or many for a group).
  // Fall back to the single venue/seats fields for older callers.
  let venues = Array.isArray(b.venues) ? b.venues : null;
  if (!venues || !venues.length) {
    const vn = (b.venue || '').trim();
    const vs = parseInt(b.seats, 10);
    venues = (vn && vs) ? [{ name: vn, seats: vs }] : [];
  }
  venues = venues
    /* entity_type is the venue's own answer to "are you a club or a pub", and it has to survive
       this mapping. It did not, so every declaration was silently dropped here and provisioning
       fell back to guessing from the trading name: a venue that answered "pub" and happens to be
       called Southport RSL was recorded as a non-profit. That is the wrong way round for the one
       field the OLGR position rests on. */
    .map((v) => ({ name: String((v && v.name) || '').trim(), seats: parseInt(v && v.seats, 10),
                   postcode: String((v && v.postcode) || '').replace(/\D/g, '').slice(0, 4),
                   entity_type: (v && (v.entity_type === 'non_profit' || v.entity_type === 'for_profit')) ? v.entity_type : null }))
    .filter((v) => v.name && v.seats > 0);

  if (email.indexOf('@') === -1 || !venues.length) {
    return json({ error: 'Missing contact email or venue details.' }, 400);
  }

  // Make venue names unique within a group, so two identically-named rows can't be
  // billed as two venues but provision as one (provisioning matches by name).
  const seenNames = {};
  venues = venues.map((v) => {
    let nm = v.name, k = 2;
    while (seenNames[nm.toLowerCase()]) { nm = v.name + ' (' + k + ')'; k++; }
    seenNames[nm.toLowerCase()] = true;
    return { name: nm, seats: v.seats, postcode: v.postcode, entity_type: v.entity_type };
  });

  const venueCount = venues.length;
  const totalSeats = venues.reduce((n, v) => n + v.seats, 0);
  const isGroup = venueCount > 1;
  // Up to 20 venues at signup; a group adds the rest from their account once signed in.
  if (venueCount > 20) {
    return json({ error: 'You can add up to 20 venues at signup. Sign up with these, then add the rest from your account once you are signed in.' }, 400);
  }
  // Groups can add as many venues as they like. The only ceiling is Stripe's own hard
  // limit on a subscription quantity (999,999 players in total); beyond that we set it up
  // by hand. This is effectively unlimited for any real group.
  if (totalSeats > 999000) {
    return json({ error: 'That is a huge group. Email us at hello@venueplay.com.au and we will set it up for you.' }, 400);
  }

  // Founding is INVITE-ONLY via a state founding link (e.g. /qld), which sends a founding_code,
  // AND state-gated by postcode: the venue's postcode must be in the code's state or they pay
  // full price. Codes look like "QLD-AUG-2026"; the state prefix maps to the leading postcode
  // digit (QLD=4, NSW/ACT=2, VIC=3, SA=5, WA=6, TAS=7, NT=0). env FOUNDING_CODES = the active
  // codes (comma-separated). Cold visitors send no code and pay standard.
  const STATE_DIGIT = { QLD: '4', NSW: '2', ACT: '2', VIC: '3', SA: '5', WA: '6', TAS: '7', NT: '0' };
  const activeCodes = (env.FOUNDING_CODES || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  const foundingCode = (b.founding_code || '').trim();
  const codeActive = foundingCode !== '' && activeCodes.indexOf(foundingCode) !== -1;
  const codeState = foundingCode.split('-')[0].toUpperCase();
  const reqDigit = STATE_DIGIT[codeState] || '';
  const foundingPostcode = ((b.postcode || (venues[0] && venues[0].postcode) || '') + '').trim();
  // The leading-digit test alone was WRONG for four states, and it failed SILENTLY: the venue saw
  // the founding price on /qld or /vic, then got charged standard with no error and no explanation.
  // This Worker's own vpaStateFromPostcode() already knows QLD is 4xxx AND 9xxx, VIC 3xxx AND 8xxx,
  // NSW 1xxx-2xxx and ACT 02xx, so ask it. Kept as a UNION with the old digit test so this can only
  // ever accept MORE venues than before, never newly reject one.
  const pcState = vpaStateFromPostcode(foundingPostcode);
  const stateOk = (reqDigit !== '' && foundingPostcode.charAt(0) === reqDigit) ||
                  (pcState !== null && pcState === codeState) ||
                  // ACT and NSW are one market for founding: an ACT venue on an NSW code qualifies.
                  (pcState === 'ACT' && codeState === 'NSW') ||
                  (pcState === 'NSW' && codeState === 'ACT');
  const founding = codeActive && stateOk;
  const price = founding
    ? (plan === 'annual' ? env.STRIPE_PRICE_ANNUAL : env.STRIPE_PRICE_MONTHLY)
    : (plan === 'annual' ? env.STRIPE_PRICE_STANDARD_ANNUAL : env.STRIPE_PRICE_STANDARD_MONTHLY);
  if (!price) {
    return json({ error: 'Stripe price not configured for ' + plan + (founding ? ' (founding)' : ' (standard)') }, 500);
  }

  // Post-founding VOLUME discount: a group past the founding cap gets a Stripe coupon based
  // on total players. A founding venue is already on the founding rate, so no tier coupon then.
  // The coupon's NAME (set in Stripe) is what shows the reason at checkout AND on the invoice.
  // Two tiers only (post-founding): Large 4,000+ players = 5% off, Major 10,000+ = 10% off.
  // Annual gets a further 5% via the annual price; rollover credits apply to annual.
  let tierCoupon = null, tierPct = 0, tierLabel = '';
  if (!founding) {
    if (totalSeats >= 10000)     { tierCoupon = env.STRIPE_COUPON_10; tierPct = 10; tierLabel = 'Major group'; }
    else if (totalSeats >= 4000) { tierCoupon = env.STRIPE_COUPON_5;  tierPct = 5;  tierLabel = 'Large group'; }
  }

  // 1) Save the lead (status 'pending' until the card is added). For a group we
  //    store the full venue list so provisioning can create each one.
  const row = await sbInsert(env, {
    venue_name: venues[0].name,
    contact_name: contactName || null,
    contact_email: email,
    mobile: (b.mobile || '').trim() || null,
    postcode: (b.postcode || '').trim() || null,
    max_seats: totalSeats,
    plan: plan,
    is_group: isGroup,
    venues_json: venues,
    marketing_opt_in: (b.marketing_opt_in === true || b.news === true),
    status: 'pending',
  });
  const rowId = row && row.id;
  if (!rowId) {
    // The lead did not save (e.g. a Supabase blip). Do NOT create a Stripe subscription
    // we cannot link back to a venue, or we get a paying customer with no account. Fail
    // cleanly so they can retry.
    return json({ error: 'Sorry, we could not save your details just then. Please try again.' }, 502);
  }

  // OPT-IN GATE (see memory venueplay-optin-gate): if the signup EMAIL does not look like a real
  // venue, it is likely a third-party trivia host, not the venue that owns the players' data. Flag
  // it: email Dean + drop a flag in HQ. Opt-in collection then stays LOCKED (cannot be switched on
  // in settings) until Dean approves this account (optin_release_approved). A flagged venue still
  // runs games fully - players join with just a team name - so nothing breaks; there is simply no
  // opt-in data collected until it is unlocked. Substring test because email domains concatenate
  // (e.g. "sandsrsl.com" should pass).
  const VENUE_EMAIL_RE = /hotel|tavern|rsl|club|pub|bowls|bowlo|bowling|leagues|surf|golf|hospitality/i;
  if (!VENUE_EMAIL_RE.test(String(email).toLowerCase())) {
    try {
      await vpaInsert(env, 'vp_admin_audit', {
        action: 'signup_flagged',
        target: 'account:' + rowId,
        detail: { reason: 'email_not_venue', email: email, venue: venues[0].name, is_group: isGroup, seats: totalSeats },
      }, false);
    } catch (e) { /* audit is best-effort, never block signup */ }
    if (env.RESEND_API_KEY) {
      try {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: 'VenuePlay <hello@send.venueplay.com.au>',
            to: ['dean@venueplay.com.au'],
            reply_to: email,
            subject: 'Review needed: signup ' + venues[0].name + ' (' + email + ')',
            html: '<h2>Signup flagged for review</h2>'
              + '<p>This signup email does not look like a venue, so opt-in collection is <b>LOCKED</b> until you approve it. They can still run games (team names only), but collect no player data.</p>'
              + '<p><b>Venue:</b> ' + vpaEsc(venues[0].name) + '</p>'
              + '<p><b>Email:</b> ' + vpaEsc(email) + '</p>'
              + '<p><b>Players / plan:</b> ' + totalSeats + ' players, ' + plan + '</p>'
              + '<p>Approve them, or lock them out, in HQ under Flagged signups.</p>',
          }),
        });
      } catch (e) { /* email is best-effort, never block signup */ }
    }
  }

  // 2) First charge fires after a rolling ONE-MONTH free trial that starts the day they sign
  // up. Every new venue gets a full free month from signup. Stripe needs a future trial_end.
  const nowTs = Math.floor(Date.now() / 1000);
  const ONE_MONTH = 30 * 24 * 60 * 60;
  const MIN_TRIAL = nowTs + 3 * 24 * 60 * 60; // Stripe rejects any trial_end under ~2 days out
  const launchTs = Math.max(nowTs + ONE_MONTH, MIN_TRIAL);
  // Returning-venue guard: an email/mobile that already had a (non-pending) account does
  // NOT get another free month (the free month is for NEW venues) - they are billed from
  // signup on whatever price is current, and flagged for HQ via subscription metadata.
  // Stripe still needs trial_end >= ~2 days, so returning venues use the minimum floor.
  const returning = await sbReturningAccount(env, email, (b.mobile || '').trim(), rowId);
  const trialTs = returning ? MIN_TRIAL : launchTs;
  const site = (env.SITE_URL || '').replace(/\/+$/, '');
  const label = isGroup ? (venueCount + ' venues') : venues[0].name;

  const form = new URLSearchParams();
  form.set('mode', 'subscription');
  form.set('line_items[0][price]', price);
  form.set('line_items[0][quantity]', String(totalSeats));
  form.set('subscription_data[trial_end]', String(trialTs));
  form.set('subscription_data[metadata][venue]', label);
  form.set('subscription_data[metadata][row_id]', rowId || '');
  form.set('subscription_data[metadata][tier]', founding ? 'founding' : 'standard');
  form.set('subscription_data[metadata][founding_code]', founding ? foundingCode : '');
  form.set('subscription_data[metadata][is_group]', isGroup ? '1' : '0');
  form.set('subscription_data[metadata][venue_count]', String(venueCount));
  form.set('subscription_data[metadata][returning]', returning ? '1' : '0');
  form.set('payment_method_collection', 'always'); // require a card even during the trial
  form.set('customer_email', email);
  form.set('client_reference_id', rowId || '');
  form.set('metadata[venue]', label);
  form.set('metadata[contact_name]', contactName);
  form.set('subscription_data[metadata][contact_name]', contactName);
  form.set('metadata[row_id]', rowId || '');
  form.set('metadata[tier]', founding ? 'founding' : 'standard');
  form.set('metadata[is_group]', isGroup ? '1' : '0');
  form.set('metadata[venue_count]', String(venueCount));
  // Apply the volume coupon (its Stripe name shows the reason on checkout + the invoice),
  // or disallow promo codes when there is no tier discount (Stripe forbids setting both).
  if (tierCoupon) {
    form.set('discounts[0][coupon]', tierCoupon);
    form.set('metadata[tier_pct]', String(tierPct));
    form.set('metadata[tier_label]', tierLabel);
    form.set('subscription_data[metadata][tier_pct]', String(tierPct));
  } else {
    form.set('allow_promotion_codes', 'false');
  }
  // Embedded checkout (card form hosted on our own page) when the signup asks for it; else the
  // classic redirect to a Stripe-hosted page. Embedded uses ui_mode + return_url (Stripe forbids
  // success_url/cancel_url in that mode); the redirect path is unchanged and stays the default.
  const embedded = b.embedded === true;
  if (embedded) {
    form.set('ui_mode', 'embedded_page'); // Stripe renamed 'embedded' → 'embedded_page' on this API version
    form.set('return_url', site + '/?vp=return&session_id={CHECKOUT_SESSION_ID}');
  } else {
    form.set('success_url', site + '/?vp=success&session_id={CHECKOUT_SESSION_ID}');
    form.set('cancel_url', site + '/?vp=cancel');
  }

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

  return json(embedded ? { client_secret: session.client_secret } : { url: session.url });
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
    // Provision the venue(s) + login now (single or group). This is what makes a
    // paid signup actually "pull through" into a usable account. vpaProvisionFromCheckout
    // lives in the admin functions pasted into this Worker; it is idempotent and
    // self-healing, so if it throws we return non-2xx and Stripe retries.
    if (typeof vpaProvisionFromCheckout === 'function') {
      await vpaProvisionFromCheckout(env, s);
    }
  }
  // On each renewal, apply any scheduled player reductions (see the billing screen).
  if (event.type === 'invoice.paid' && typeof vpbApplyPendingOnInvoice === 'function') {
    await vpbApplyPendingOnInvoice(env, event.data.object);
  }
  // On every real payment, email the venue a branded invoice.
  if (event.type === 'invoice.paid' && typeof vpaFireInvoiceEmail === 'function') {
    await vpaFireInvoiceEmail(env, event.data.object);
  }
  // Ahead of each renewal (Stripe invoice.upcoming), email the venue a heads-up. STRIPE owns the
  // lead time, not us, and it offers 7 days. The email therefore names the DATE and never a number
  // of days: restating a figure we do not control is how copy ends up lying after a settings change.
  if (event.type === 'invoice.upcoming' && typeof vpaFireUpcomingEmail === 'function') {
    await vpaFireUpcomingEmail(env, event.data.object);
  }
  // A declined card: tell them, suspend nothing. Stripe keeps retrying for about a fortnight.
  if (event.type === 'invoice.payment_failed') {
    const inv = event.data.object || {};
    await vpaFirePaymentFailedEmail(env, inv);
    // Stop the games only once the grace window is used up. attempt_count is Stripe's own count
    // of tries on THIS invoice, so this tracks the retry schedule instead of guessing at dates.
    const cust = inv.customer;
    if (cust) {
      const accts = await vpaSelect(env, 'venueplay_founding',
        'stripe_customer_id=eq.' + encodeURIComponent(cust) + '&select=plan&limit=1');
      const plan = (accts && accts[0] && accts[0].plan) || 'monthly';
      const tries = parseInt(inv.attempt_count, 10) || 0;
      if (tries >= vpaFailuresBeforeSuspend(plan)) await vpaSuspendForNonpayment(env, cust);
    }
  }
  // The invoice is now OVERDUE, or Stripe has given up entirely. Games stop until it is paid.
  // Nothing is deleted: the venue, its logins, its members list and its history all stay put.
  if (event.type === 'customer.subscription.updated') {
    const st = event.data.object && event.data.object.status;
    // 'unpaid' ONLY. past_due fires on the very first failed attempt, which is what used to switch
    // a venue off the same day its card expired; the grace window is counted on
    // invoice.payment_failed above. 'unpaid' means Stripe has finished retrying, so by then the
    // window is long gone either way and this is the backstop.
    if (st === 'unpaid') {
      await vpaSuspendForNonpayment(env, event.data.object.customer);
    }
    // NO reactivation here. Every subscription_items quantity write WE make raises this event
    // with status 'active': setPlayers, addVenue, applyPendingOnInvoice, the plan uplift. So a
    // venue suspended for non-payment could be switched back on simply by nudging its player
    // count, without a cent being paid. Money coming in is the only thing that turns games back
    // on, and invoice.paid below is the only place that says so.
  }
  if (event.type === 'customer.subscription.deleted') {
    const cust = event.data.object && event.data.object.customer;
    // 'ended', NOT 'nonpayment'. This fires when an owner cancels as well as when Stripe gives
    // up, and only 'nonpayment' is ever undone by a payment. Stamping a deliberate ending as
    // non-payment meant one late invoice landing on that customer switched the whole account
    // back on with no subscription behind it, playing free, with their credit already wiped.
    await vpaSuspendForNonpayment(env, cust, 'ended');
    await vpaClearCreditOnEnd(env, cust);   // the subscription is over, so the credit is too
  }
  /* A CHARGEBACK. Stripe's dispute setting is what stops the games (cancel immediately, which
     arrives here as customer.subscription.deleted). This handler does not touch money or status:
     it exists so there is a RECORD next to the venue saying why they went dark. Without it a
     dispute is invisible in HQ and the first anyone knows is a venue that has mysteriously
     stopped, or a Stripe email nobody links to it. */
  if (event.type === 'charge.dispute.created' || event.type === 'charge.dispute.closed') {
    await vpaRecordDispute(env, event.data.object, event.type);
  }
  // Paid. Anything switched off for non-payment comes straight back on.
  if (event.type === 'invoice.paid') {
    await vpaReactivateOnPayment(env, event.data.object && event.data.object.customer);
  }
  return new Response('ok', { status: 200, headers: cors });
}

/* ------------------------------ /contact ------------------------------ */
async function handleContact(request, env, json) {
  const b = await request.json();
  const name = (b.name || '').trim();
  const email = (b.email || '').trim();
  // Optional. Capped and stripped of control characters like every other field that reaches an
  // email body; the enquiry is worth more than a perfectly formatted number.
  const phone = String(b.phone == null ? '' : b.phone).replace(/[\x00-\x1f]+/g, ' ').trim().slice(0, 30);
  const message = (b.message || '').trim();
  if (!name || email.indexOf('@') === -1 || !message) return json({ error: 'Missing fields.' }, 400);

  const esc = (s) => String(s).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
  const html =
    '<h2>New VenuePlay enquiry</h2>' +
    '<p><b>Name:</b> ' + esc(name) + '</p>' +
    '<p><b>Email:</b> ' + esc(email) + '</p>' +
    (phone ? '<p><b>Phone:</b> ' + esc(phone) + '</p>' : '') +
    '<p><b>Message:</b><br>' + esc(message).replace(/\n/g, '<br>') + '</p>';

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'VenuePlay <hello@send.venueplay.com.au>',   // sending domain must be verified in Resend
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
// Has this email or mobile already had a real (non-pending) account? Used to deny a
// second free month to a venue that left and came back. Best-effort: any lookup failure
// returns false so a signup is never blocked by it.
async function sbReturningAccount(env, email, mobile, excludeId) {
  try {
    const ors = ['contact_email.eq.' + encodeURIComponent(email)];
    if (mobile) ors.push('mobile.eq.' + encodeURIComponent(mobile));
    // Exclude 'pending' (an abandoned signup) AND 'comp' (a demo venue on a test contact): neither is
    // a real prior account, so neither should deny a genuine later signup its first-month-free.
    const q = 'venueplay_founding?or=(' + ors.join(',') + ')&status=not.in.(pending,comp)&id=neq.' +
              encodeURIComponent(excludeId) + '&select=id&limit=1';
    const res = await fetch(env.SUPABASE_URL + '/rest/v1/' + q, { headers: sbHeaders(env) });
    if (!res.ok) return false;
    const rows = await res.json();
    return Array.isArray(rows) && rows.length > 0;
  } catch (e) { return false; }
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
  /* THROW, do not swallow. This is the only writer of venueplay_founding.stripe_customer_id and
     stripe_subscription_id, and it was fire-and-forget: a failed PATCH let the webhook carry on
     and return 200, so Stripe never retried and that account had no Stripe ids for good. The
     consequences are all silent and permanent: chargeNightOverage reads missing ids as "comp
     venue, never charge" and skips their overage forever, the account page shows no card and no
     renewal date, and the venue is never counted in the founding spots. Throwing makes the
     webhook fail, which makes Stripe retry, which is exactly what should happen. */
  const res = await fetch(env.SUPABASE_URL + '/rest/v1/venueplay_founding?id=eq.' + encodeURIComponent(id), {
    method: 'PATCH',
    headers: sbHeaders(env),
    body: JSON.stringify(obj),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error('venueplay_founding update failed (' + res.status + '): ' + t.slice(0, 200));
  }
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
  /* The timestamp was parsed and then never used, so a captured (payload, signature) pair stayed
     valid forever: anyone who had once seen a webhook body could replay it indefinitely, for
     example replaying an invoice.paid to keep a suspended venue switched back on. Stripe's own
     tolerance is five minutes. */
  const ts = parseInt(t, 10);
  if (!isFinite(ts) || Math.abs(Math.floor(Date.now() / 1000) - ts) > 300) return false;

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


/* ================================================================
 * ADMIN / HQ (vpa*)
 * ============================================================= */

/**
 * VenuePlay API Worker — ADMIN + PROVISIONING ADD-ON
 * ============================================================================
 * This file is a CLEAN, SELF-CONTAINED set of additions for the existing
 * `venueplay-api` Cloudflare Worker (the one that already handles /checkout,
 * /webhook and /contact). The LIVE Worker is edited in the Cloudflare
 * dashboard, so the local `venueplay-api.js` copy may be behind production.
 * Nothing here overwrites the existing Stripe or founding-counter logic. To
 * install, do the THREE small paste steps below, then paste every function in
 * this file at the bottom of the deployed Worker.
 *
 * ----------------------------------------------------------------------------
 * PASTE STEP 1 — allow the admin token through CORS.
 *   In the existing `cors` object, add Authorization to Allow-Headers:
 *     'Access-Control-Allow-Headers': 'Content-Type, Stripe-Signature, Authorization, X-VP-Venue',
 *   (Without this the browser preflight blocks every /admin/* call.)
 *
 * PASTE STEP 2 — add the five admin routes.
 *   Inside `fetch`, in the `try { ... }` block, next to the existing
 *   `if (request.method === 'POST' && path === '/checkout') ...` lines, add:
 *
 *     if (request.method === 'POST' && path === '/admin/venue')           return await vpaHandleVenue(request, env, json);
 *     if (request.method === 'POST' && path === '/admin/discount')        return await vpaHandleDiscount(request, env, json);
 *     if (request.method === 'POST' && path === '/admin/discount-remove') return await vpaHandleDiscountRemove(request, env, json);
 *     if (request.method === 'POST' && path === '/admin/venue-status')    return await vpaHandleVenueStatus(request, env, json);
 *     if (request.method === 'POST' && path === '/admin/staff')           return await vpaHandleStaff(request, env, json);
 *     if (request.method === 'POST' && path === '/admin/audit')           return await vpaHandleAudit(request, env, json);
 *
 * PASTE STEP 3 — auto-provision on the Stripe webhook.
 *   In the existing `handleWebhook`, inside
 *     if (event.type === 'checkout.session.completed') { ... }
 *   AFTER the existing `sbUpdate(...)` that marks the row card_on_file, add:
 *
 *     await vpaProvisionFromCheckout(env, s);
 *
 *   Letting this run (and throw on failure) means a failed provision returns a
 *   non-2xx and Stripe retries until it succeeds. Every step below is
 *   idempotent, so retries are safe (see vpaProvisionFromCheckout).
 *
 * ----------------------------------------------------------------------------
 * EXTRA ENV VAR NEEDED (set as a Worker secret, never in a file):
 *   SUPABASE_JWT_SECRET   Supabase -> Settings -> API -> JWT Settings -> JWT Secret.
 *                         Used to verify the signed-in admin's access token.
 *                         `wrangler secret put SUPABASE_JWT_SECRET`
 * Reuses existing env: SUPABASE_URL, SUPABASE_SERVICE_KEY.
 * ============================================================================
 */

/* ===========================================================================
 * SHARED HELPERS (all prefixed vpa* so they never clash with existing code)
 * ======================================================================== */

function vpaHeaders(env) {
  return {
    'apikey': env.SUPABASE_SERVICE_KEY,
    'Authorization': 'Bearer ' + env.SUPABASE_SERVICE_KEY,
    'Content-Type': 'application/json',
  };
}

// --- base64url decode -> Uint8Array ---
function vpaB64UrlToBytes(str) {
  str = String(str || '').replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  const bin = atob(str);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/**
 * Verify a Supabase access token (JWT) against SUPABASE_JWT_SECRET (HS256).
 * Returns the decoded payload on success, or null if anything fails. We never
 * trust a client-sent role; we only trust `sub` (the auth user id) after the
 * signature verifies, then look the role up in vp_platform_admins.
 *
 * NOTE: this validates the LEGACY shared-secret (HS256) signing used by this
 * project. If the project is ever migrated to asymmetric JWT signing keys
 * (ES256/RS256), swap this for JWKS verification, or verify by calling
 * GET {SUPABASE_URL}/auth/v1/user with the token as Bearer + service apikey.
 */
// Cached JWKS: Supabase's asymmetric (ES256) signing keys. They rotate rarely, so cache per isolate.
let _vpaJwks = null;
async function vpaFetchJwks(env) {
  if (_vpaJwks && (Date.now() - _vpaJwks.at) < 3600000) return _vpaJwks.keys;
  try {
    const url = (env.SUPABASE_URL || '').replace(/\/+$/, '') + '/auth/v1/.well-known/jwks.json';
    const res = await fetch(url);
    if (!res.ok) return _vpaJwks ? _vpaJwks.keys : [];
    const data = await res.json();
    const keys = (data && data.keys) || [];
    _vpaJwks = { keys: keys, at: Date.now() };
    return keys;
  } catch (e) {
    return _vpaJwks ? _vpaJwks.keys : [];
  }
}
async function vpaVerifyJWT(token, secret, env) {
  try {
    if (!token) return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [h, p, s] = parts;

    const header = JSON.parse(new TextDecoder().decode(vpaB64UrlToBytes(h)));
    const signed = new TextEncoder().encode(h + '.' + p);
    const sig = vpaB64UrlToBytes(s);

    let ok = false;
    if (header.alg === 'HS256') {
      // Legacy shared-secret tokens.
      if (!secret) return null;
      const key = await crypto.subtle.importKey(
        'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
      );
      ok = await crypto.subtle.verify('HMAC', key, sig, signed);
    } else if (header.alg === 'ES256') {
      // New Supabase asymmetric signing keys: verify against the published JWKS public key.
      const keys = env ? await vpaFetchJwks(env) : [];
      const jwk = keys.find(function (k) { return k.kid === header.kid; }) || keys[0];
      if (!jwk) return null;
      const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
      ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, sig, signed);
    } else {
      return null; // block alg:none / unsupported algorithms
    }
    if (!ok) return null;

    const payload = JSON.parse(new TextDecoder().decode(vpaB64UrlToBytes(p)));
    const now = Math.floor(Date.now() / 1000);
    if (!payload.exp || now > payload.exp) return null;     // require + enforce expiry
    if (payload.nbf && now < payload.nbf) return null;      // not yet valid
    return payload;
  } catch (e) {
    return null;
  }
}

/**
 * Verify the caller's token AND confirm they are a platform admin with an
 * allowed role. Returns { actorId, role, label, email } or { error, status }.
 * allowedRoles = null means "any admin".
 */
async function vpaRequireAdmin(request, env, allowedRoles) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (!token) return { error: 'Not signed in.', status: 401 };

  const payload = await vpaVerifyJWT(token, env.SUPABASE_JWT_SECRET, env);
  if (!payload || !payload.sub) return { error: 'Invalid or expired session. Please sign in again.', status: 401 };

  const admins = await vpaSelect(
    env, 'vp_platform_admins',
    'auth_user_id=eq.' + encodeURIComponent(payload.sub) + '&select=auth_user_id,role,label'
  );
  const admin = admins && admins[0];
  if (!admin) return { error: 'This login is not a Gflam admin.', status: 403 };
  if (allowedRoles && allowedRoles.indexOf(admin.role) === -1) {
    return { error: 'Your role (' + admin.role + ') is not permitted to do this.', status: 403 };
  }
  return {
    actorId: admin.auth_user_id,
    role: admin.role,
    label: admin.label || payload.email || 'admin',
    email: payload.email || null,
  };
}

// --- Supabase REST: insert / patch / select via service_role ---
async function vpaInsert(env, table, obj, wantRow) {
  const res = await fetch(env.SUPABASE_URL + '/rest/v1/' + table, {
    method: 'POST',
    headers: { ...vpaHeaders(env), 'Prefer': wantRow === false ? 'return=minimal' : 'return=representation' },
    body: JSON.stringify(obj),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(table + ' insert failed: ' + t);
  }
  if (wantRow === false) return null;
  const data = await res.json();
  return Array.isArray(data) ? data[0] : data;
}

async function vpaPatch(env, table, filter, obj) {
  const res = await fetch(env.SUPABASE_URL + '/rest/v1/' + table + '?' + filter, {
    method: 'PATCH',
    headers: vpaHeaders(env),
    body: JSON.stringify(obj),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(table + ' update failed: ' + t);
  }
}

async function vpaSelect(env, table, query) {
  const res = await fetch(env.SUPABASE_URL + '/rest/v1/' + table + '?' + query, {
    method: 'GET',
    headers: vpaHeaders(env),
  });
  if (!res.ok) return [];
  return await res.json();
}

// Delete rows and return them (so a hard delete can be recorded in the audit).
async function vpaDelete(env, table, filter) {
  const res = await fetch(env.SUPABASE_URL + '/rest/v1/' + table + '?' + filter, {
    method: 'DELETE',
    headers: { ...vpaHeaders(env), 'Prefer': 'return=representation' },
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(table + ' delete failed: ' + t);
  }
  const data = await res.json().catch(() => []);
  return Array.isArray(data) ? data : [];
}

// --- Supabase Auth admin API: create / find a user (service_role) ---
async function vpaAuthCreateUser(env, body) {
  const res = await fetch(env.SUPABASE_URL + '/auth/v1/admin/users', {
    method: 'POST',
    headers: vpaHeaders(env),
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data && (data.msg || data.message || data.error_description || data.error))
      || ('auth user create failed (' + res.status + ')');
    const codeStr = String((data && (data.error_code || data.code)) || '');
    const err = Object.assign(new Error(msg), {
      status: res.status,
      // Only "already exists" when the message/code actually says so. A bare 422 can also be a
      // plain validation error (bad phone, etc.), which must NOT be mistaken for a duplicate.
      alreadyExists: /already|registered|exists|taken/i.test(String(msg)) || /exists|registered|taken/i.test(codeStr),
    });
    throw err;
  }
  return data; // { id, email, phone, ... }
}

// Best-effort lookup used when a phone/email already has an auth user.
// Launch-scale: one page of up to 200 users. Widen to real paging past ~200 users.
async function vpaFindAuthUser(env, sel) {
  // PAGE PROPERLY. This read one page of 200 users and stopped. It is used when a phone or email
  // already has a login, which is exactly what happens when a venue signs up again or adds a
  // second host, and past 200 logins it would simply fail to find people who were plainly there.
  // At 100 venues with a few hosts each that is not a distant problem. Bounded so a bad response
  // can never spin forever.
  const wantPhone = sel.phone ? String(sel.phone).replace(/[^\d]/g, '') : null;
  const wantEmail = sel.email ? String(sel.email).toLowerCase() : null;
  if (!wantPhone && !wantEmail) return null;
  const PER = 200, MAX_PAGES = 50;   // 10,000 logins
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await fetch(env.SUPABASE_URL + '/auth/v1/admin/users?per_page=' + PER + '&page=' + page,
      { headers: vpaHeaders(env) });
    if (!res.ok) return null;
    const data = await res.json().catch(() => ({}));
    const users = (data && data.users) || [];
    for (const u of users) {
      if (wantPhone && u.phone && String(u.phone).replace(/[^\d]/g, '') === wantPhone) return u;
      if (wantEmail && u.email && String(u.email).toLowerCase() === wantEmail) return u;
    }
    if (users.length < PER) return null;   // last page
  }
  return null;
}

// --- misc helpers ---
function vpaSlugify(s) {
  return String(s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

async function vpaUniqueSlug(env, base, seed, postcode) {
  const isFree = async (s) => {
    const t = await vpaSelect(env, 'vp_venues', 'slug=eq.' + encodeURIComponent(s) + '&select=id');
    return !(t && t.length);
  };
  let slug = base || ('venue-' + String(seed || '').replace(/[^a-z0-9]/gi, '').slice(0, 8));
  if (await isFree(slug)) return slug;
  /* Two venues with the same name (The Grand Hotel is everywhere). Append the POSTCODE, not a random
     tail, so the TV link tells them apart by where they are: the-grand-hotel-4217. That is meaningful
     to read out and to type on a remote, unlike the-grand-hotel-abc123. */
  const pc = String(postcode || '').replace(/\D/g, '').slice(0, 4);
  if (pc) {
    const withPc = slug + '-' + pc;
    if (await isFree(withPc)) return withPc;
    slug = withPc;   // same name AND same postcode (rare): keep the postcode and add a short tail below
  }
  return slug + '-' + String(seed || Date.now()).replace(/[^a-z0-9]/gi, '').slice(0, 6);
}

// Australian mobile -> E.164 (+61...). Falls back to a bare +digits form.
function vpaNormaliseMobileAU(raw) {
  let m = String(raw || '').replace(/[^\d+]/g, '');
  if (!m) return null;
  if (m[0] === '+') return m;
  if (m.slice(0, 2) === '61') return '+' + m;
  if (m[0] === '0') return '+61' + m.slice(1);
  if (m.length === 9) return '+61' + m; // e.g. 412345678
  return '+' + m;
}

// Is this normalised number a real AU MOBILE (+614 then 8 digits)? A landline
// normalises to +61x too, so we must check the mobile shape before ever
// creating a phone login. A phone login on a landline can never receive an
// SMS sign-in code, so it must be skipped (see vpaProvisionFromCheckout).
function vpaIsAuMobileE164(e164) {
  return /^\+614\d{8}$/.test(String(e164 || ''));
}

/**
 * Write a vp_admin_audit row paired with an admin action. Best-effort: if it
 * fails it will not roll back the main write (PostgREST has no cross-table
 * transaction over separate calls). Returns true/false. For strict atomicity
 * the whole action would need a single Postgres SECURITY DEFINER function; see
 * the report note.
 */
async function vpaAudit(env, actor, action, target, detail) {
  try {
    await vpaInsert(env, 'vp_admin_audit', {
      actor_admin: actor.actorId || null,
      actor_label: actor.label || 'admin',
      action: action,
      target: target || null,
      detail: detail || {},
    }, false);
    return true;
  } catch (e) {
    return false;
  }
}


/* ===========================================================================
 * 1) POST /admin/venue   (owner | accounts)
 *    Onboard a venue: founding record (independent) OR link to a group, plus
 *    vp_venues (+ slug), default vp_venue_settings, a vp_screens row, and an
 *    optional first-manager Auth user + vp_venue_staff row. Then an audit row.
 *    Body (from hq.html):
 *      { name, slug, timezone,
 *        billing:{ type:'founding'|'group', group_id?, included_players?,
 *                  founding?:{ contact_email, mobile, postcode, max_seats, plan } },
 *        manager?:{ mobile?, email?, display_name } }
 *    -> { ok:true, venue:{id,name,slug}, founding_id?, manager?:{auth_user_id} }
 * ======================================================================== */
async function vpaHandleVenue(request, env, json) {
  const actor = await vpaRequireAdmin(request, env, ['owner', 'accounts']);
  if (actor.error) return json({ error: actor.error }, actor.status);

  const b = await request.json();
  const name = (b.name || '').trim();
  const slugIn = vpaSlugify(b.slug || b.name);
  const timezone = (b.timezone || 'Australia/Brisbane').trim();
  const billing = b.billing || {};

  if (!name) return json({ error: 'Venue name is required.' }, 400);
  if (!slugIn) return json({ error: 'A screen slug is required.' }, 400);
  if (billing.type !== 'founding' && billing.type !== 'group') {
    return json({ error: "billing.type must be 'founding' or 'group'." }, 400);
  }

  /* The postcode is what sets au_state, and au_state is what decides which state's gaming rules
     a venue is shown and whether the paper-ticket rule applies to it. HQ's Add venue form now
     REQUIRES a postcode and sends it, but this row never read it, so every hand-onboarded venue
     had a null state and the whole compliance feature was inert for exactly those venues. The
     self-serve path (vpaProvisionOneVenue) has always done this correctly; this is it catching up.
     Declared before the slug so a name clash can be disambiguated by postcode (the-grand-hotel-4217). */
  const venuePostcode = String((b.postcode || '')).replace(/\D/g, '').slice(0, 4);
  const slug = await vpaUniqueSlug(env, slugIn, name, venuePostcode);
  let foundingId = null;
  const venueRow = { name: name, slug: slug, timezone: timezone };
  // HQ's Add venue form does not ask the question, so this stays null and HQ prompts for it.
  // A guess must never occupy this column: see vpaProvisionOneVenue.
  if (venuePostcode) {
    venueRow.postcode = venuePostcode;
    const st = (typeof vpaStateFromPostcode === 'function') ? vpaStateFromPostcode(venuePostcode) : null;
    if (st) venueRow.au_state = st;
  }

  if (billing.type === 'group') {
    const groupId = billing.group_id;
    if (!groupId) return json({ error: 'A group_id is required for a grouped venue.' }, 400);
    venueRow.group_id = groupId;
    if (billing.included_players != null && billing.included_players !== '') {
      venueRow.included_players = parseInt(billing.included_players, 10) || null;
    }
  } else {
    // Independent: create the founding/subscription record first.
    const f = billing.founding || {};
    if (!f.contact_email || String(f.contact_email).indexOf('@') === -1) {
      return json({ error: 'A contact email is required for an independent venue.' }, 400);
    }
    const foundingRow = {
      venue_name: name,
      contact_email: (f.contact_email || '').trim(),
      mobile: (f.mobile || '').trim() || null,
      postcode: (f.postcode || '').trim() || null,
      max_seats: (f.max_seats != null && f.max_seats !== '') ? (parseInt(f.max_seats, 10) || null) : null,
      plan: (f.plan === 'annual' ? 'annual' : 'monthly'),
      marketing_opt_in: false,
      // Admin-onboarded venues have no Stripe card in this flow. 'active' makes the venue live AND
      // counts it in venueplay_spots_taken (which counts founding rows in ('card_on_file','active')).
      // A COMP/DEMO venue is set to 'comp', which is outside that set, so it runs games (the kill-
      // switch reads vp_venues.status, not this) without eating one of the 100 founding spots (#14).
      status: (billing.comp === true ? 'comp' : 'active'),
    };
    const created = await vpaInsert(env, 'venueplay_founding', foundingRow);
    foundingId = created && created.id;
    venueRow.founding_id = foundingId;
  }

  // Create the venue, its default settings and a screen.
  const venue = await vpaInsert(env, 'vp_venues', venueRow);
  await vpaInsert(env, 'vp_venue_settings', { venue_id: venue.id }, false);
  await vpaInsert(env, 'vp_screens', { venue_id: venue.id, name: 'Main screen' }, false);

  // Optional first manager: create their Auth user + link as manager.
  let managerOut = null;
  const mgr = b.manager || {};
  const mgrMobile = vpaNormaliseMobileAU(mgr.mobile);
  const mgrEmail = (mgr.email || '').trim();
  // Only ever use the mobile for a login if it is a real AU mobile. A landline
  // would create a phone login that can never receive an SMS code, so we fall
  // back to email (if given) or skip the login entirely.
  const mgrMobileValid = !!(mgrMobile && vpaIsAuMobileE164(mgrMobile));
  if (mgrMobileValid || mgrEmail) {
    let authUserId = null;
    try {
      const createBody = mgrMobileValid
        ? { phone: mgrMobile, phone_confirm: true, user_metadata: { venue: name } }
        : { email: mgrEmail, email_confirm: true, user_metadata: { venue: name } };
      const u = await vpaAuthCreateUser(env, createBody);
      authUserId = u.id;
    } catch (e) {
      if (e.alreadyExists) {
        const found = await vpaFindAuthUser(env, { phone: mgrMobileValid ? mgrMobile : null, email: mgrEmail });
        authUserId = found && found.id;
      } else {
        throw e;
      }
    }
    if (authUserId) {
      await vpaInsert(env, 'vp_venue_staff', {
        venue_id: venue.id,
        auth_user_id: authUserId,
        role: 'manager',
        display_name: (mgr.display_name || '').trim() || 'Manager',
      }, false);
      managerOut = { auth_user_id: authUserId };
    }
  }

  await vpaAudit(env, actor, 'venue_onboarded', 'venue:' + venue.id, {
    name: name, slug: slug, billing: billing.type,
    founding_id: foundingId || undefined, manager_created: !!managerOut,
  });

  const out = { ok: true, venue: { id: venue.id, name: venue.name, slug: venue.slug } };
  if (foundingId) out.founding_id = foundingId;
  if (managerOut) out.manager = managerOut;
  return json(out);
}


/* ===========================================================================
 * 2) POST /admin/discount   (owner | accounts)
 *    body: { target_type:'venue'|'group', target_id, kind:'percent'|'dollar',
 *            value_numeric, months|null, note }
 *    -> { ok:true, discount:{id} }
 * ======================================================================== */
async function vpaHandleDiscount(request, env, json) {
  const actor = await vpaRequireAdmin(request, env, ['owner', 'accounts']);
  if (actor.error) return json({ error: actor.error }, actor.status);

  const b = await request.json();
  const targetType = b.target_type;
  const targetId = b.target_id;
  const kind = b.kind;
  const value = Number(b.value_numeric);
  const months = (b.months === null || b.months === undefined || b.months === '') ? null : (parseInt(b.months, 10) || null);
  const note = (b.note || '').trim() || null;

  if (targetType !== 'venue' && targetType !== 'group') return json({ error: "target_type must be 'venue' or 'group'." }, 400);
  if (!targetId) return json({ error: 'target_id is required.' }, 400);
  if (kind !== 'percent' && kind !== 'dollar') return json({ error: "kind must be 'percent' or 'dollar'." }, 400);
  if (!(value > 0)) return json({ error: 'value_numeric must be greater than zero.' }, 400);
  // Hard cap: a percentage discount can never exceed 100 (a fat-fingered 100+
  // would zero out or invert the bill). The dashboard also confirms above 50.
  if (kind === 'percent' && value > 100) return json({ error: 'A percentage discount cannot be over 100.' }, 400);

  /* THIS IS WHERE THE DISCOUNT REACHES STRIPE, AND IT NEVER USED TO.
     vp_discounts was written here, read back by HQ, and read by nothing else in the product. A
     discount agreed with a venue was recorded, displayed on the billing tab as though it were
     live, and then every invoice went out at the full rate. Nobody would notice from this screen:
     the discount is right there on it. */
  const target = await vpaBillingTargetFor(env, targetType, targetId);
  if (target.error) return json({ error: target.error }, 400);
  /* A Stripe coupon applies to the SUBSCRIPTION, and one subscription covers every venue on the
     account. So a percentage picked from one venue's row silently discounts all of them: 20%
     meant for one venue's $250 comes off the account's $1,250. Refuse and say so, rather than
     give away four times what was intended and report it against the one venue. */
  if (kind === 'percent' && !target.manual && target.account && b.apply_to_account !== true) {
    const sibs = await vpaSelect(env, 'vp_venues',
      'founding_id=eq.' + encodeURIComponent(target.account.id) + '&select=id');
    if (sibs && sibs.length > 1) {
      // Not a hard block: a warning the caller can confirm past. HQ re-sends with apply_to_account:true
      // after the operator OKs "this covers all N venues". needs_confirm lets HQ show the right prompt.
      return json({ error: 'This account has ' + sibs.length + ' venues on one subscription, so a percentage would come off ALL of them, not just this venue. Use a dollar credit for a single venue, or apply it knowing it covers the whole account.', needs_confirm: true, venue_count: sibs.length }, 409);
    }
  }

  let stripeCouponId = null;
  let stripeTxnId = null;
  let applied = null;

  if (!target.manual) {
    try {
      if (kind === 'percent') {
        // Percent off is an ongoing rate change, so it has to be a coupon on the subscription.
        // duration 'forever' when no month count is given, which is what "ongoing" means here.
        if (!target.subId) return json({ error: 'That account has no subscription to discount yet.' }, 400);
        /* A subscription carries ONE discount slot in the shape we write, and checkout already
           uses it: a post-founding group past 4,000 or 10,000 players gets STRIPE_COUPON_5 or
           STRIPE_COUPON_10 there. Writing discounts[0] again REPLACES that, so granting a 5% HQ
           discount to a group on a contracted 10% volume rate would have quietly raised their
           bill, while HQ reported the discount as applied. Refuse instead, and say what is in the
           way: an HQ discount is a rare deliberate act and a wrong one here is a contract breach.
           The launch cohort is all founding, which carries no tier coupon, so this refuses
           nothing we currently do. */
        const existing = (target.info && target.info.sub) || {};
        const already = (existing.discounts && existing.discounts.length && existing.discounts[0])
                     || existing.discount || null;
        if (already) {
          const nm = (already.coupon && (already.coupon.name || already.coupon.id)) || 'an existing discount';
          return json({ error: 'This account already has a discount on its subscription (' + nm + '). Applying another would replace it and change what they are contracted to pay. Remove the existing one first, or use a dollar credit instead.' }, 409);
        }
        // Stripe caps a coupon NAME at 40 chars. A group or long venue name blew past it ("Invalid
        // string ... must be at most 40 characters"), so reserve room for the " N% off" suffix and
        // truncate the name to fit, then hard-cap at 40 as a belt.
        const _suf = ' ' + value + '% off';
        const _room = Math.max(1, 40 - 'VenuePlay: '.length - _suf.length);
        let _cname = ('VenuePlay: ' + String(target.name || 'venue').slice(0, _room) + _suf).slice(0, 40);
        const coupon = await vpbStripePost(env, 'coupons', Object.assign({
          percent_off: value,
          duration: months ? 'repeating' : 'forever',
          name: _cname,
        }, months ? { duration_in_months: months } : {}));
        if (!coupon || coupon.error || !coupon.id) {
          return json({ error: 'Stripe would not create that discount: ' + ((coupon && coupon.error && coupon.error.message) || 'unknown error') }, 502);
        }
        stripeCouponId = coupon.id;
        // Newer Stripe API versions take discounts[]; older ones take a bare coupon. Which one
        // this account is on is not knowable from here, so try the current shape and fall back
        // rather than have the coupon exist while attached to nothing.
        let att = await vpbStripePost(env, 'subscriptions/' + encodeURIComponent(target.subId), { 'discounts[0][coupon]': stripeCouponId });
        if (att && att.error) att = await vpbStripePost(env, 'subscriptions/' + encodeURIComponent(target.subId), { coupon: stripeCouponId });
        if (att && att.error) {
          await vpbStripeDelete(env, 'coupons/' + encodeURIComponent(stripeCouponId)).catch(() => {});
          return json({ error: 'Stripe would not apply that discount: ' + (att.error.message || 'unknown error') }, 502);
        }
        applied = months ? (value + '% off for ' + months + ' month' + (months === 1 ? '' : 's')) : (value + '% off, ongoing');
      } else {
        // A dollar discount is a one-off. Negative balance on the customer IS a credit, and
        // Stripe consumes it on the next invoice by itself. Same mechanism the annual release
        // credit already uses, so a venue sees one consistent "credit held" figure.
        const cents = Math.round(value * 100);
        const txn = await vpbStripePost(env, 'customers/' + encodeURIComponent(target.customer) + '/balance_transactions', {
          amount: -cents, currency: 'aud',
          description: 'VenuePlay discount' + (note ? ': ' + note : ''),
        });
        if (!txn || txn.error || !txn.id) {
          return json({ error: 'Stripe would not add that credit: ' + ((txn && txn.error && txn.error.message) || 'unknown error') }, 502);
        }
        stripeTxnId = txn.id;
        applied = '$' + value.toFixed(2) + ' credit, comes off their next invoice';
      }
    } catch (e) {
      return json({ error: 'Could not reach Stripe just now. Nothing was changed, please try again.' }, 502);
    }
  }

  /* The money has already moved. If the row cannot be written, PUT IT BACK, because a coupon or
     a credit with no row pointing at it can never be removed from HQ again: /admin/discount-remove
     works off the row. This is not hypothetical, it is what a not-yet-run migration 37 looks like
     from here, and the natural response to the error is to press Apply a second time. */
  let discount;
  try {
    discount = await vpaInsert(env, 'vp_discounts', {
      target_type: targetType,
      target_id: targetId,
      kind: kind,
      value_numeric: value,
      months: kind === 'percent' ? months : null,   // dollar credits are one-off, no months
      note: note,
      created_by: actor.actorId,
      stripe_coupon_id: stripeCouponId,
      stripe_txn_id: stripeTxnId,
    });
  } catch (e) {
    if (stripeCouponId) {
      try {
        const t2 = await vpaBillingTargetFor(env, targetType, targetId);
        if (t2 && !t2.manual && t2.subId) await vpbStripeDelete(env, 'subscriptions/' + encodeURIComponent(t2.subId) + '/discount').catch(() => {});
      } catch (_) { /* best effort */ }
      await vpbStripeDelete(env, 'coupons/' + encodeURIComponent(stripeCouponId)).catch(() => {});
    }
    if (stripeTxnId && target.customer) {
      const back = Math.round(value * 100);
      await vpbStripePost(env, 'customers/' + encodeURIComponent(target.customer) + '/balance_transactions',
        { amount: back, currency: 'aud', description: 'VenuePlay discount reversed (could not be recorded)' }).catch(() => {});
    }
    return json({ error: 'Could not record that discount, so it has been undone in Stripe and nothing was charged. Please try again. (' + String((e && e.message) || e).slice(0, 160) + ')' }, 500);
  }

  await vpaAudit(env, actor, 'discount_applied', targetType + ':' + targetId, {
    kind: kind, value_numeric: value, months: months, note: note,
    stripe_coupon_id: stripeCouponId, stripe_txn_id: stripeTxnId, manual: !!target.manual,
  });

  return json({ ok: true, discount: { id: discount.id },
                manual: !!target.manual, applied: applied, why: target.why || null });
}


/* ===========================================================================
 * 2b) POST /admin/discount-remove   (owner | accounts)
 *    body: { discount_id }   -> { ok:true, removed:{id} }
 *    Undoes a mistaken discount from the dashboard.
 *
 *    SCHEMA FLAG: vp_discounts has NO soft-delete / expires / removed column
 *    (only `months`, where null = ongoing). There is no column to mark a row
 *    inactive without inventing one, so the closest existing mechanism is a
 *    hard DELETE. To keep the removal fully traceable we read the whole row
 *    first and preserve it in the audit detail, so nothing is lost.
 * ======================================================================== */
async function vpaHandleDiscountRemove(request, env, json) {
  const actor = await vpaRequireAdmin(request, env, ['owner', 'accounts']);
  if (actor.error) return json({ error: actor.error }, actor.status);

  const b = await request.json();
  const id = b.discount_id || b.id;
  if (!id) return json({ error: 'discount_id is required.' }, 400);

  // Capture the row first so the removal is fully recorded in the audit log.
  const rows = await vpaSelect(env, 'vp_discounts', 'id=eq.' + encodeURIComponent(id) + '&select=*');
  const row = rows && rows[0];
  if (!row) return json({ error: 'That discount no longer exists.' }, 404);

  /* Undo the Stripe side FIRST. Deleting only the row would put HQ back to the state that made
     this worth fixing, except inverted and worse: the screen would show no discount while Stripe
     quietly kept taking it off every invoice, forever, with nothing left pointing at it. */
  let reversed = null;
  try {
    if (row.stripe_coupon_id) {
      const target = await vpaBillingTargetFor(env, row.target_type, row.target_id);
      /* DELETE .../discount strips whatever discount is on the subscription, not necessarily
         ours. If the coupon there is not the one this row created, it is somebody else's, most
         likely the contracted volume rate from checkout, and removing it would raise the venue's
         bill on our way out. Only clear the slot when it holds OUR coupon. */
      if (target && !target.manual && target.subId) {
        const cur = (target.info && target.info.sub) || {};
        const held = (cur.discounts && cur.discounts.length && cur.discounts[0]) || cur.discount || null;
        // Cope with both shapes Stripe returns: an expanded discount object, or a bare id string
        // on an older API version. If we cannot positively identify it as ours, leave it alone and
        // say so rather than strip a coupon that might be their contracted volume rate.
        const heldId = (held && held.coupon && held.coupon.id) || (typeof held === 'string' ? held : null);
        const heldCoupon = (held && held.coupon && held.coupon.id) || null;
        if (heldCoupon && heldCoupon === row.stripe_coupon_id) {
          await vpbStripeDelete(env, 'subscriptions/' + encodeURIComponent(target.subId) + '/discount').catch(() => {});
        } else if (heldId) {
          return json({ error: 'We could not confirm the discount on their Stripe subscription is the one recorded here, so nothing was changed. Remove it in Stripe directly, then remove this record.' }, 409);
        }
      }
      await vpbStripeDelete(env, 'coupons/' + encodeURIComponent(row.stripe_coupon_id));
      reversed = 'coupon removed from their subscription';
    } else if (row.stripe_txn_id) {
      // A balance credit cannot be deleted, so take it back with an equal and opposite entry.
      const target = await vpaBillingTargetFor(env, row.target_type, row.target_id);
      if (target && !target.manual && target.customer) {
        let cents = Math.round(Number(row.value_numeric || 0) * 100);
        /* Only take back what is still sitting there. A credit granted in September is consumed
           by the October invoice; tidying the stale row off the list in November would otherwise
           post a POSITIVE balance, which Stripe reads as money owed, and the venue's December
           invoice would come in higher than their normal rate for a discount they were given. */
        try {
          const cust = await vpbStripeGet(env, 'customers/' + encodeURIComponent(target.customer));
          const bal = (cust && typeof cust.balance === 'number') ? cust.balance : 0;
          const outstanding = bal < 0 ? -bal : 0;
          if (cents > outstanding) cents = outstanding;
        } catch (e) { cents = 0; }   // cannot read the balance: take nothing rather than overcharge
        if (cents > 0) {
          const back = await vpbStripePost(env, 'customers/' + encodeURIComponent(target.customer) + '/balance_transactions', {
            amount: cents, currency: 'aud', description: 'VenuePlay discount reversed',
          });
          if (back && back.error) {
            return json({ error: 'Could not take that credit back off their account: ' + (back.error.message || 'unknown error') + '. The discount has been left in place.' }, 502);
          }
          reversed = '$' + (cents / 100).toFixed(2) + ' credit taken back';
        } else {
          reversed = 'nothing to take back, that credit has already been used';
        }
      }
    }
  } catch (e) {
    return json({ error: 'Could not reach Stripe just now. The discount has been left in place, please try again.' }, 502);
  }

  await vpaDelete(env, 'vp_discounts', 'id=eq.' + encodeURIComponent(id));

  await vpaAudit(env, actor, 'discount_removed', row.target_type + ':' + row.target_id, {
    discount_id: id, removed: row, reversed: reversed,
  });

  return json({ ok: true, removed: { id: id }, reversed: reversed });
}


/* ===========================================================================
 * 3) POST /admin/venue-status   (owner | accounts)
 *    body: { venue_id, status:'active'|'suspended', reason? }
 *    -> { ok:true }
 * ======================================================================== */
/* POST /admin/quiet-venues  {days?}  (owner | accounts)
   A retention call list: who has not run a game lately, soonest first, so the venue that went
   quiet last week is rung before the one that has been gone three months. Quiet at a week is a
   check-in; quiet at ninety is a different conversation.

   THE TRAP THIS AVOIDS. "Live now" reads vp_sessions, and broadcast bingo opens NO session row.
   A list built only from sessions would show every bingo-only venue as permanently quiet, which
   is the exact opposite of a useful call list. Last activity is therefore the LATEST of three
   places a game leaves a trace: vp_sessions (trivia, musical, raffle), vp_games, and
   vp_game_reports (which is where broadcast bingo posts its figures).

   Served from the Worker rather than read in the browser because vp_game_reports is service-role
   only, and it stays that way. */
async function vpaHandleQuietVenues(request, env, json) {
  const actor = await vpaRequireAdmin(request, env, ['owner', 'accounts']);
  if (actor.error) return json({ error: actor.error }, actor.status);

  const b = await request.json().catch(() => ({}));
  let days = parseInt(b.days, 10);
  if (!(days >= 1)) days = 7;

  const venues = await vpaSelect(env, 'vp_venues',
    'select=id,name,slug,status,suspended_reason,created_at&order=name.asc');
  if (!venues || !venues.length) return json({ ok: true, days: days, venues: [] });

  const latest = {};
  const note = (id, ts) => {
    if (!id || !ts) return;
    const t = Date.parse(ts);
    if (!isFinite(t)) return;
    if (!latest[id] || t > latest[id]) latest[id] = t;
  };

  /* Bounded on purpose. This used to read EVERY session and EVERY game report ever written, on
     every click of the tab, which grows without limit and is the sort of query that is fine all
     through a launch and then is not. A year is far past any retention conversation, so nothing
     useful is lost by not reading further back. */
  const nowMs = Date.now();
  const lookbackDays = Math.max(days, 365);
  const cutoffMs = nowMs - lookbackDays * 86400000;
  const cutoff = new Date(cutoffMs).toISOString();

  // Sessions carry the venue directly.
  const sessions = await vpaSelect(env, 'vp_sessions',
    'select=venue_id,opened_at,started_at,ended_at' +
    '&or=(started_at.gte.' + cutoff + ',opened_at.gte.' + cutoff + ',ended_at.gte.' + cutoff + ')');
  for (const r of (sessions || [])) { note(r.venue_id, r.started_at || r.opened_at || r.ended_at); }
  // Broadcast bingo only ever appears here.
  const reports = await vpaSelect(env, 'vp_game_reports',
    'select=venue_id,ended_at,created_at' +
    '&or=(ended_at.gte.' + cutoff + ',created_at.gte.' + cutoff + ')');
  for (const r of (reports || [])) { note(r.venue_id, r.ended_at || r.created_at); }

  const now = nowMs;
  const out = [];
  for (const v of venues) {
    const last = latest[v.id] || null;
    const madeMs = Date.parse(v.created_at || '') || now;
    // "Never played" is only sayable about a venue we hold the FULL history for, which means one
    // set up inside the lookback window. An older venue with nothing recent has simply not played
    // in a long time, and saying "never" about a venue that ran nights two years ago would be a
    // lie on the one screen where somebody decides whether to keep them.
    const neverPlayed = !last && madeMs >= cutoffMs;
    // Nothing at all to go on: measure from when they were set up, so a venue that signed up and
    // never ran a night is on the list rather than missing from it.
    const since = last || madeMs;
    const quiet = Math.floor((now - since) / 86400000);
    if (quiet < days) continue;
    out.push({
      id: v.id, name: v.name, slug: v.slug,
      status: v.status, suspended_reason: v.suspended_reason || null,
      days_quiet: quiet,
      last_game: last ? new Date(last).toISOString().slice(0, 10) : null,
      never_played: neverPlayed,
      // No trace in the window, but they are older than it: we genuinely do not know.
      long_gone: !last && !neverPlayed,
    });
  }
  out.sort((a, z) => a.days_quiet - z.days_quiet);   // soonest quiet first: the winnable ones
  return json({ ok: true, days: days, count: out.length, venues: out });
}

/* Record what a venue IS, and whether paid-entry games are unlocked for it.
 *
 * Every gaming category in the country turns on one question we have never asked at signup:
 * is this a non-profit (a club, an RSL, a bowls club) or a for-profit (a pub, a hotel)? Until
 * somebody finds out and sets it here, paid entry stays off and the venue is free-entry only,
 * which is a promotional game and lawful everywhere.
 *
 * Deliberately HQ-only, and deliberately not self-serve: a venue answering this about itself
 * is exactly the wrong person to ask, because the answer decides what they are allowed to do.
 */
/* POST /admin/gst  (Gflam owner/accounts) : what came in this quarter, and the GST in it.
 *
 * Read only, and taken from STRIPE rather than from our own usage estimates, because the BAS
 * figure is money actually received, not money we think we invoiced. Sums amount_paid on paid
 * invoices in the period and subtracts anything refunded in it.
 *
 * VenuePlay prices are GST INCLUSIVE (the terms say so, $2.50 a player GST inclusive), so the GST
 * is one eleventh of the total, not ten percent of it. Getting that backwards overstates it by
 * about 10%, which is the classic way to under-provision.
 *
 * This is a guide for setting money aside and a sanity check against the BAS. It is not the BAS:
 * it does not know about GST-free items, input tax credits on what Gflam spends, or anything
 * invoiced outside Stripe. Dean's accountant lodges from the books, not from this.
 */
async function vpaHandleGst(request, env, json) {
  const actor = await vpaRequireAdmin(request, env, ['owner', 'accounts']);
  if (actor.error) return json({ error: actor.error }, actor.status);
  if (!env.STRIPE_SECRET_KEY) return json({ error: 'Stripe is not configured on this Worker.' }, 500);

  const b = await request.json().catch(function () { return {}; });

  /* Australian BAS quarters, in Brisbane time. Working in UTC would put a payment taken late on
     30 September into the December quarter, which is exactly the kind of quiet error nobody finds
     until the ATO does. Queensland has no daylight saving, so a fixed +10 is correct year round. */
  const AEST = 10 * 3600 * 1000;
  const nowB = new Date(Date.now() + AEST);
  const qIndex = Math.floor(nowB.getUTCMonth() / 3);          // 0 = Jan-Mar
  const back = Math.max(0, Math.min(8, parseInt(b.back, 10) || 0));   // 0 = this quarter, 1 = last
  let y = nowB.getUTCFullYear(), qi = qIndex - back;
  while (qi < 0) { qi += 4; y -= 1; }
  const startB = Date.UTC(y, qi * 3, 1, 0, 0, 0);
  const endB   = Date.UTC(qi === 3 ? y + 1 : y, ((qi + 1) % 4) * 3, 1, 0, 0, 0);
  const from = Math.floor((startB - AEST) / 1000);            // back to real UTC seconds
  const to   = Math.floor((endB - AEST) / 1000);

  let grossCents = 0, invoices = 0, refundCents = 0, truncated = false;
  try {
    let starting_after = null;
    for (let page = 0; page < 20; page++) {                   // 20 x 100 = 2,000 invoices
      let q = 'invoices?status=paid&limit=100&created[gte]=' + from + '&created[lt]=' + to;
      if (starting_after) q += '&starting_after=' + encodeURIComponent(starting_after);
      const r = await vpbStripeGet(env, q);
      if (!r || r.error) return json({ error: 'Stripe would not answer: ' + ((r && r.error && r.error.message) || 'unknown') }, 502);
      const rows = r.data || [];
      for (const inv of rows) { grossCents += (inv.amount_paid || 0); invoices++; }
      if (!r.has_more || !rows.length) { starting_after = null; break; }
      starting_after = rows[rows.length - 1].id;
      if (page === 19) truncated = true;
    }
    // Refunds reduce what was actually received, so they reduce the GST owed on it.
    let ra = null;
    for (let page = 0; page < 20; page++) {
      let q = 'refunds?limit=100&created[gte]=' + from + '&created[lt]=' + to;
      if (ra) q += '&starting_after=' + encodeURIComponent(ra);
      const r = await vpbStripeGet(env, q);
      if (!r || r.error) break;                               // refunds are a refinement, not a blocker
      const rows = r.data || [];
      for (const rf of rows) refundCents += (rf.amount || 0);
      if (!r.has_more || !rows.length) break;
      ra = rows[rows.length - 1].id;
    }
  } catch (e) {
    return json({ error: 'Could not reach Stripe just now.' }, 502);
  }

  const netCents = Math.max(0, grossCents - refundCents);
  // GST INCLUSIVE pricing: the GST is 1/11th of the total, not 10% of it.
  const gstCents = Math.round(netCents / 11);
  const label = ['Jan to Mar', 'Apr to Jun', 'Jul to Sep', 'Oct to Dec'][qi] + ' ' + y;

  return json({
    ok: true, quarter: label, back: back,
    from: new Date(from * 1000).toISOString().slice(0, 10),
    to: new Date((to - 1) * 1000).toISOString().slice(0, 10),
    invoices: invoices,
    gross_cents: grossCents, refunds_cents: refundCents,
    total_cents: netCents, gst_cents: gstCents,
    truncated: truncated,
  });
}

async function vpaHandleVenueGaming(request, env, json) {
  const actor = await vpaRequireAdmin(request, env, ['owner', 'accounts']);
  if (actor.error) return json({ error: actor.error }, actor.status);

  const b = await request.json();
  const venueId = b.venue_id;
  if (!venueId) return json({ error: 'venue_id is required.' }, 400);

  const rows = await vpaSelect(env, 'vp_venues',
    'id=eq.' + encodeURIComponent(venueId) + '&select=id,name,entity_type,paid_entry_enabled,au_state,postcode');
  const prior = rows && rows[0];
  if (!prior) return json({ error: 'That venue no longer exists.' }, 404);

  const patch = {};
  /* The venue's postcode, and therefore its state. Set at creation and never editable until now,
     so a typo at signup permanently gave a venue the wrong state and the wrong gaming rules, and
     a venue that moved could not be corrected at all. Same class of fault as the ones the
     pre-launch audit turned up: easy to set, impossible to unset. */
  if (b.postcode !== undefined) {
    const pc = String(b.postcode || '').replace(/\D/g, '').slice(0, 4);
    if (pc && pc.length !== 4) return json({ error: 'A postcode is 4 digits.' }, 400);
    patch.postcode = pc || null;
    patch.au_state = pc ? vpaStateFromPostcode(pc) : null;
    if (pc && !patch.au_state) return json({ error: 'That postcode is not one we can map to a state.' }, 400);
    // The postcode also sets the TIMEZONE (which decides which calendar night a game falls on for
    // billing, and is shown in HQ as the venue's location). This used to be left untouched, so a
    // corrected postcode kept the old city/timezone. Recompute it alongside the state.
    if (pc) patch.timezone = vpaTimezoneFromPostcode(pc);
    /* Moving a venue into a state where we cannot run paid games has to switch paid entry off,
       or a NSW club relocated to Queensland keeps a capability its new state does not allow. */
    const entAfter = (b.entity_type !== undefined) ? b.entity_type : prior.entity_type;
    if (patch.au_state && !vpaPaidEntryDefault(entAfter, patch.au_state) && prior.paid_entry_enabled) {
      patch.paid_entry_enabled = false;
    }
  }
  if (b.entity_type !== undefined) {
    if (b.entity_type !== null && b.entity_type !== 'for_profit' && b.entity_type !== 'non_profit') {
      return json({ error: "entity_type must be 'for_profit', 'non_profit' or null." }, 400);
    }
    patch.entity_type = b.entity_type || null;
  }
  if (b.paid_entry_enabled !== undefined) {
    const on = !!b.paid_entry_enabled;
    // Turning paid entry ON without knowing what the venue is would defeat the whole point.
    const entity = patch.entity_type !== undefined ? patch.entity_type : prior.entity_type;
    const st = patch.au_state !== undefined ? patch.au_state : prior.au_state;
    if (on && !entity) {
      return json({ error: 'Record whether this venue is a club or a pub before turning paid entry on.' }, 400);
    }
    /* The same two rules the automatic path applies. This had neither, so one click could tell a
       for-profit pub in Queensland it may charge for entry to a raffle, which is the precise
       exposure OLGR's letter creates. A deliberate override is still possible: change what the
       venue IS, or wait for the approval. It just cannot happen by accident. */
    if (on && entity !== 'non_profit') {
      return json({ error: 'Paid entry is for non-profits. A for-profit venue can only run a paid game for a nominated cause, which is a conversation, not a switch.' }, 409);
    }
    if (on && !vpaPaidEntryDefault(entity, st)) {
      return json({ error: st
        ? ('We do not unlock paid games in ' + st + ' yet. Queensland is waiting on OLGR approval of our generator, and the Northern Territory is unresolved.')
        : 'Set this venue\'s postcode first, so we know which state\'s rules apply.' }, 409);
    }
    patch.paid_entry_enabled = on;
  }
  /* Clearing the entity type has to take paid entry with it. Otherwise: set Club, switch paid
     entry ON, set back to "Not asked yet", and the venue is left paid-entry-enabled with an
     unknown type while HQ's button is disabled, so nothing can turn it off again. */
  if (patch.entity_type === null) {
    patch.paid_entry_enabled = false;   // unconditional: clearing what a venue IS always locks it
  }
  if (!Object.keys(patch).length) return json({ error: 'Nothing to change.' }, 400);

  const res = await fetch(env.SUPABASE_URL + '/rest/v1/vp_venues?id=eq.' + encodeURIComponent(venueId), {
    method: 'PATCH',
    headers: { ...vpaHeaders(env), 'Prefer': 'return=representation' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) return json({ error: 'Could not save. ' + (await res.text()).slice(0, 180) }, 500);
  const saved = (await res.json())[0] || {};

  await vpaInsert(env, 'vp_admin_audit', {
    actor_admin: actor.actorId || null, actor_label: actor.label || 'admin',
    action: 'venue_gaming_updated', target: 'venue:' + venueId,
    detail: { name: prior.name, from: { entity_type: prior.entity_type, paid_entry_enabled: prior.paid_entry_enabled }, to: patch },
  }, false).catch(function () {});

  return json({ ok: true, venue: saved });
}

async function vpaHandleVenueStatus(request, env, json) {
  const actor = await vpaRequireAdmin(request, env, ['owner', 'accounts']);
  if (actor.error) return json({ error: actor.error }, actor.status);

  const b = await request.json();
  const venueId = b.venue_id;
  const status = b.status;
  const reason = (b.reason || '').trim() || null;

  if (!venueId) return json({ error: 'venue_id is required.' }, 400);
  // 'archived' is a suspension with a reason, not a new status: the kill-switch, HQ's filters and
  // every RLS policy already understand 'suspended', and nothing here is ever deleted. It is the
  // resting place for a venue that has gone quiet, AFTER somebody has tried to win them back.
  if (status !== 'active' && status !== 'suspended' && status !== 'archived') {
    return json({ error: "status must be 'active', 'suspended' or 'archived'." }, 400);
  }

  // What it was before, so reactivating an ARCHIVED venue can put its billing back and
  // reactivating a merely suspended one leaves billing alone.
  const priorRows = await vpaSelect(env, 'vp_venues',
    'id=eq.' + encodeURIComponent(venueId) + '&select=id,name,founding_id,status,suspended_reason,cancel_at_period_end');
  const prior = priorRows && priorRows[0];
  if (!prior) return json({ error: 'That venue no longer exists.' }, 404);

  // Stamp WHY. A venue switched off from HQ is 'manual' and a later payment must never bring it
  // back on by itself; only a non-payment suspension is reversible automatically.
  const archiving = status === 'archived';
  const wasArchived = prior.suspended_reason === 'archived' || prior.suspended_reason === 'archived_cancelling';
  const unarchiving = status === 'active' && wasArchived;
  /* Which of us set cancel_at_period_end has to survive the archive, or un-archiving cannot tell
     "cancelling because WE archived it" from "cancelling because the OWNER asked". Reading the
     flag on the way back out is useless: archiving sets it either way. So the reason carries it.
     Free text, no migration, and it reads plainly in HQ. */
  const archiveReason = prior.cancel_at_period_end ? 'archived_cancelling' : 'archived';
  await vpaPatch(env, 'vp_venues', 'id=eq.' + encodeURIComponent(venueId), {
    status: archiving ? 'suspended' : status,
    suspended_reason: archiving ? archiveReason : (status === 'suspended' ? 'manual' : null),
  });

  /* Archiving has to reach Stripe, which it never used to. A venue is archived once retention has
     given up on it: the games stop and it drops off the active list. Leaving the subscription
     untouched meant the account kept being invoiced every month for capacity that was switched
     off at our end, which is the worst possible way to lose a customer twice.
     Only ARCHIVE moves money. A plain suspension is short and reversible, and a non-payment
     suspension must keep the debt exactly where it is, so neither touches the invoice. */
  let billing = null;
  if ((archiving || unarchiving) && prior.founding_id) {
    try {
      /* Only OUR archive flag comes back off. Writing false unconditionally reversed a
         cancellation the OWNER had made themselves: they cancel a venue, we archive it, we
         un-archive it, and they are silently billed again at renewal for a venue they cancelled,
         with nothing telling them. If it was already cancelling before we archived it, leave it. */
      if (archiving) {
        await vpaPatch(env, 'vp_venues', 'id=eq.' + encodeURIComponent(venueId), { cancel_at_period_end: true });
      } else if (prior.suspended_reason === 'archived') {
        // We set it when we archived, so we take it back off.
        await vpaPatch(env, 'vp_venues', 'id=eq.' + encodeURIComponent(venueId), { cancel_at_period_end: false });
      }
      // 'archived_cancelling' keeps the flag, because the OWNER set it. But then this venue is not
      // billable, and switching its games back on would be giving the service away: HQ's own
      // confirm text promises "billing included". Say so instead of quietly doing neither.
      if (unarchiving && prior.suspended_reason === 'archived_cancelling') {
        billing = { changed: false, error: 'This venue was cancelled by the owner before it was archived, so it is still set to stop at the end of their paid period. Turning it back on does not restart their billing. Ask them to undo the cancellation on their account page first.' };
      }
      const accts = await vpaSelect(env, 'venueplay_founding',
        'id=eq.' + encodeURIComponent(prior.founding_id) + '&select=id,stripe_subscription_id');
      const acct = accts && accts[0];
      // Do NOT overwrite the warning set just above. It used to be replaced unconditionally by
      // { changed:true }, so un-archiving an owner-cancelled venue switched its games back on and
      // told HQ "billing restored", while cancel_at_period_end stayed true and vpbAccountTotal
      // kept excluding it. The venue ran free until the next invoice suspended it again.
      if (acct && acct.stripe_subscription_id && !billing) {
        const info = await vpaSyncAccountQuantity(env, prior.founding_id, acct.stripe_subscription_id);
        billing = (info && info.syncFailed)
          ? { changed: false, error: info.syncFailed }
          : { changed: true, ends: (info && info.periodEnd) ? vpaFmtDate(info.periodEnd) : null };
      }
    } catch (e) {
      // The status change already landed and is what stops the games. Never fail the whole call
      // on Stripe: report it instead, so HQ can say the billing side still needs a look.
      billing = { changed: false, error: String((e && e.message) || e) };
    }
  }

  await vpaAudit(env, actor,
    archiving ? 'venue_archived' : (status === 'suspended' ? 'venue_suspended' : 'venue_reactivated'),
    'venue:' + venueId, { status: status, reason: reason, name: prior.name, billing: billing });

  return json({ ok: true, billing: billing });
}

/* POST /admin/optin-approve  (owner/accounts)
 *   body: { founding_id, approved? }  -> { ok:true, approved }
 *   Approves (or revokes) a founding account to collect/export player marketing data. Non-venue
 *   sign-ups stay name-only until this is set; approving flips venueplay_founding.optin_release_approved. */
async function vpaHandleOptinApprove(request, env, json) {
  const actor = await vpaRequireAdmin(request, env, ['owner', 'accounts']);
  if (actor.error) return json({ error: actor.error }, actor.status);
  const b = await request.json();
  const foundingId = b.founding_id;
  if (!foundingId) return json({ error: 'founding_id is required.' }, 400);
  const approved = b.approved !== false;   // default true; pass approved:false to revoke
  await vpaPatch(env, 'venueplay_founding', 'id=eq.' + encodeURIComponent(foundingId), { optin_release_approved: approved });
  await vpaAudit(env, actor, approved ? 'optin_approved' : 'optin_revoked', 'account:' + foundingId, {});
  return json({ ok: true, approved: approved });
}


/* ===========================================================================
 * 4) POST /admin/staff   (owner only)
 *    body: { name, email, role:'owner'|'accounts'|'staff' }
 *    -> { ok:true, auth_user_id }
 *    Creates the Supabase Auth user + a vp_platform_admins row (+ audit).
 * ======================================================================== */
async function vpaHandleStaff(request, env, json) {
  const actor = await vpaRequireAdmin(request, env, ['owner']);
  if (actor.error) return json({ error: actor.error }, actor.status);

  const b = await request.json();
  const name = (b.name || '').trim();
  const email = (b.email || '').trim();
  const role = b.role;

  // Staff sign in at /app with a text code, so a real AU mobile is what actually lets them
  // in. Email is optional (kept for our records only). An email-only login could never be
  // used, so we require the mobile and refuse anything that is not a mobile shape.
  const mobile = vpaNormaliseMobileAU(b.mobile || '');
  if (!name) return json({ error: 'A name is required.' }, 400);
  if (!vpaIsAuMobileE164(mobile)) return json({ error: 'Enter a valid Australian mobile so they can receive a sign-in code.' }, 400);
  if (email && email.indexOf('@') === -1) return json({ error: 'That email does not look valid. Leave it blank if you are not sure.' }, 400);
  if (['owner', 'accounts', 'staff'].indexOf(role) === -1) return json({ error: "role must be 'owner', 'accounts' or 'staff'." }, 400);

  let authUserId = null;
  try {
    const u = await vpaAuthCreateUser(env, {
      phone: mobile, phone_confirm: true,
      user_metadata: email ? { name: name, email: email } : { name: name },
    });
    authUserId = u.id;
  } catch (e) {
    if (e.alreadyExists) {
      const found = await vpaFindAuthUser(env, { phone: mobile });
      authUserId = found && found.id;
      if (!authUserId) return json({ error: 'That mobile already has a login but it could not be looked up.' }, 409);
    } else {
      throw e;
    }
  }

  // Idempotent-ish: upsert the admin row on its primary key (auth_user_id).
  const res = await fetch(env.SUPABASE_URL + '/rest/v1/vp_platform_admins', {
    method: 'POST',
    headers: { ...vpaHeaders(env), 'Prefer': 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify({ auth_user_id: authUserId, role: role, label: name }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error('vp_platform_admins insert failed: ' + t);
  }

  await vpaAudit(env, actor, 'staff_added', 'admin:' + authUserId, { name: name, mobile: mobile, email: email || null, role: role });

  return json({ ok: true, auth_user_id: authUserId });
}


/* ===========================================================================
 * 5) POST /admin/audit   (any admin)  — view-as / read logging
 *    body: { action, target?, detail? }  -> { ok:true }
 * ======================================================================== */
async function vpaHandleAudit(request, env, json) {
  const actor = await vpaRequireAdmin(request, env, null);
  if (actor.error) return json({ error: actor.error }, actor.status);

  const b = await request.json();
  const action = (b.action || '').trim();
  if (!action) return json({ error: 'action is required.' }, 400);

  await vpaInsert(env, 'vp_admin_audit', {
    actor_admin: actor.actorId,
    actor_label: actor.label,
    action: action,
    target: (b.target || '').trim() || null,
    detail: b.detail || {},
  }, false);

  return json({ ok: true });
}


/* ===========================================================================
 * STRIPE PROVISIONING — the fix for "signups do not pull through".
 * Call from handleWebhook on checkout.session.completed AFTER the existing
 * sbUpdate that marks the founding row card_on_file (see PASTE STEP 3).
 *
 * Auto-creates, for a paying signup:
 *   - a phone-OTP Auth user (from the mobile),
 *   - vp_venues (+ slug from the venue name) linked to the founding record,
 *   - default vp_venue_settings,
 *   - a vp_screens row,
 *   - a vp_venue_staff manager row linking the new user,
 * leaving them ready to sign in at /app with their mobile.
 *
 * The founding-vs-standard PRICE was already chosen at /checkout from the live
 * venueplay_spots_taken count (the automatic rollover) and is carried on the
 * subscription; the tier is recorded from session.metadata.tier for the audit.
 *
 * IDEMPOTENT + SELF-HEALING (safe on Stripe webhook retries): rather than
 * stopping at "a vp_venues row exists", this FINDS the venue and then finishes
 * every missing piece (settings, screen, manager staff). So if a first attempt
 * throws part-way (e.g. a Supabase blip after the venue is created but before
 * the screen + staff rows), the Stripe retry completes the half-built venue
 * instead of leaving the host locked out. Each step checks-then-writes, so a
 * fully provisioned venue is a no-op. If a step throws, we log which step
 * failed to vp_admin_audit (so a stuck venue is visible in HQ) and rethrow so
 * Stripe keeps retrying.
 *
 * NO SILENT BROKEN LOGIN: a phone login is only created for a real AU mobile.
 * If the mobile is missing or is a landline (never able to receive an SMS
 * code), we skip the login, still provision the venue, and record a clear
 * "no login linked" audit entry so the venue is flaggable in HQ before launch.
 * ======================================================================== */
async function vpaProvisionFromCheckout(env, session) {
  const foundingId = (session && session.client_reference_id)
    || (session && session.metadata && session.metadata.row_id);
  if (!foundingId) {
    // A paid checkout we cannot link back to a signup (a bare payment link, a test charge, or a soft
    // failure upstream). Never silently do nothing on money in: record it so an unmatched payment is
    // visible in HQ the same night instead of vanishing with no trace (audit #13).
    try {
      await vpaInsert(env, 'vp_admin_audit', {
        actor_admin: null, actor_label: 'stripe', action: 'checkout_unmatched',
        target: 'session:' + ((session && session.id) || 'unknown'),
        detail: {
          stripe_session_id: (session && session.id) || null,
          customer: (session && session.customer) || null,
          subscription: (session && session.subscription) || null,
          amount_total: (session && session.amount_total) || null,
          email: (session && session.customer_details && session.customer_details.email) || null,
        },
      }, false);
    } catch (e) { /* audit is best-effort; never throw out of the webhook over it */ }
    return;
  }

  // Load the founding/lead row for the venue name + mobile fallback.
  const rows = await vpaSelect(env, 'venueplay_founding',
    'id=eq.' + encodeURIComponent(foundingId) + '&select=*');
  const f = rows && rows[0];
  // Throw (not silent return) so a transient read failure lets Stripe retry the webhook
  // instead of leaving a paid customer with no venue and no flag.
  if (!f) throw new Error('founding row not found for ' + foundingId + ' (retryable)');

  // GROUP self-serve signup: the lead carries a list of venues. Provision each
  // one under a single owner login and a shared group, then stop. Single-venue
  // signups fall through to the original path below.
  if (f.is_group && Array.isArray(f.venues_json) && f.venues_json.length > 1) {
    return await vpaProvisionGroup(env, session, f);
  }

  const venueName = f.venue_name || (session.metadata && session.metadata.venue) || 'New venue';
  const cd = session.customer_details || {};
  // Prefer the phone Stripe collected; fall back to the mobile captured at signup.
  const rawMobile = cd.phone || f.mobile;
  const mobile = vpaNormaliseMobileAU(rawMobile);
  // Only a real AU mobile can receive the SMS sign-in code. A landline typed
  // into the mobile field must NOT become a login that can never get a code.
  const validMobile = !!(mobile && vpaIsAuMobileE164(mobile));
  const loginSkippedReason = validMobile ? null : (rawMobile ? 'not_au_mobile' : 'no_mobile');

  // Which step are we on? Recorded to the audit if anything throws.
  let step = 'start';
  const stepsDone = [];
  try {
    // Create (or find) the phone-OTP Auth user so they can sign in at /app.
    // Skipped entirely for a missing mobile or a landline.
    let authUserId = null;
    if (validMobile) {
      step = 'create_login';
      try {
        const u = await vpaAuthCreateUser(env, {
          phone: mobile, phone_confirm: true, user_metadata: { venue: venueName },
        });
        authUserId = u.id;
      } catch (e) {
        if (e.alreadyExists) {
          const found = await vpaFindAuthUser(env, { phone: mobile });
          authUserId = found && found.id;
        } else {
          throw e; // real failure -> non-2xx -> Stripe retries
        }
      }
    }

    // ---- Venue: find the existing one for this founding_id, or create it. ----
    step = 'venue';
    let declaredEntity1 = null;
    try {
      const vlist = f.venues_json ? (typeof f.venues_json === 'string' ? JSON.parse(f.venues_json) : f.venues_json) : null;
      const e = vlist && vlist[0] && vlist[0].entity_type;
      if (e === 'non_profit' || e === 'for_profit') declaredEntity1 = e;
    } catch (e) { /* older signup with no answer: falls back to the name guess */ }
    let venue = (await vpaSelect(env, 'vp_venues',
      'founding_id=eq.' + encodeURIComponent(foundingId) + '&select=id,name,slug'))[0];
    if (!venue) {
      const slug = await vpaUniqueSlug(env, vpaSlugify(venueName), foundingId, f.postcode);
      venue = await vpaInsert(env, 'vp_venues', {
        founding_id: foundingId,
        name: venueName,
        slug: slug,
        max_players: f.max_seats || null,
        postcode: f.postcode || null,
        au_state: vpaStateFromPostcode(f.postcode),
        /* What the venue said about itself on the signup form, out of venues_json. The name guess
           is only a fallback for accounts created before the question existed, and it never
           unlocks paid entry: only a declaration does that. */
        entity_type: declaredEntity1,   // declared only, never a guess: see vpaProvisionOneVenue
        paid_entry_enabled: vpaPaidEntryDefault(declaredEntity1, vpaStateFromPostcode(f.postcode)),
        status: 'active',
        timezone: vpaTimezoneFromPostcode(f.postcode),
      });
      stepsDone.push('venue');
    }

    // ---- Default settings (create only if missing). ----
    step = 'settings';
    const haveSettings = await vpaSelect(env, 'vp_venue_settings',
      'venue_id=eq.' + encodeURIComponent(venue.id) + '&select=venue_id');
    if (!(haveSettings && haveSettings.length)) {
      await vpaInsert(env, 'vp_venue_settings', { venue_id: venue.id }, false);
      stepsDone.push('settings');
    }

    // ---- Screen (create only if missing). ----
    step = 'screen';
    const haveScreen = await vpaSelect(env, 'vp_screens',
      'venue_id=eq.' + encodeURIComponent(venue.id) + '&select=id');
    if (!(haveScreen && haveScreen.length)) {
      await vpaInsert(env, 'vp_screens', { venue_id: venue.id, name: 'Main screen' }, false);
      stepsDone.push('screen');
    }

    // ---- Manager staff row (only when we have a valid login, create if missing). ----
    if (authUserId) {
      step = 'staff';
      const haveStaff = await vpaSelect(env, 'vp_venue_staff',
        'venue_id=eq.' + encodeURIComponent(venue.id) +
        '&auth_user_id=eq.' + encodeURIComponent(authUserId) + '&select=id');
      if (!(haveStaff && haveStaff.length)) {
        await vpaInsert(env, 'vp_venue_staff', {
          venue_id: venue.id,
          auth_user_id: authUserId,
          role: 'manager',
          display_name: venueName + ' manager',
        }, false);
        stepsDone.push('staff');
      }
    }

    // ---- Audit. ----
    step = 'audit';
    // Login state from ACTUAL data (not just this run), so a failed auth lookup or a
    // mid-provision retry never leaves a loginless venue unflagged.
    const mgrRows = await vpaSelect(env, 'vp_venue_staff',
      'venue_id=eq.' + encodeURIComponent(venue.id) + '&role=eq.manager&select=id');
    const hasLogin = !!(mgrRows && mgrRows.length);
    if (stepsDone.indexOf('venue') !== -1) {
      // Fresh provision.
      await vpaInsert(env, 'vp_admin_audit', {
        actor_admin: null,
        actor_label: 'stripe',
        action: 'venue_provisioned',
        target: 'venue:' + venue.id,
        detail: {
          founding_id: foundingId,
          slug: venue.slug,
          tier: (session.metadata && session.metadata.tier) || null,
          manager_created: !!authUserId,
          login_skipped_reason: loginSkippedReason,
          mobile_last4: (validMobile && mobile) ? mobile.slice(-4) : null,
          stripe_subscription_id: session.subscription || null,
        },
      }, false);
    } else if (stepsDone.length) {
      // A retry that finished a previously half-built venue.
      await vpaInsert(env, 'vp_admin_audit', {
        actor_admin: null,
        actor_label: 'stripe',
        action: 'venue_provision_resumed',
        target: 'venue:' + venue.id,
        detail: { founding_id: foundingId, completed: stepsDone },
      }, false);
    }
    // Flag any venue that ended up with no manager login, whatever the reason (missing/
    // landline mobile, a failed auth lookup, or a mid-provision retry) and on ANY run
    // (even a no-op retry), so HQ always catches it. Write it once per venue.
    if (!hasLogin) {
      const existingFlag = await vpaSelect(env, 'vp_admin_audit',
        'target=eq.' + encodeURIComponent('venue:' + venue.id) + '&action=eq.venue_no_login&select=id&limit=1');
      if (!(existingFlag && existingFlag.length)) {
        await vpaInsert(env, 'vp_admin_audit', {
          actor_admin: null, actor_label: 'stripe', action: 'venue_no_login',
          target: 'venue:' + venue.id,
          detail: { founding_id: foundingId, reason: loginSkippedReason || 'login_lookup_failed', mobile_provided: !!rawMobile },
        }, false);
      }
    }
    // else: fully provisioned already -> nothing to do, no audit noise.

    // Welcome email on a fresh provision (best-effort; skips if Resend unset).
    if (stepsDone.indexOf('venue') !== -1) {
      await vpaFireWelcome(env, session, f, [{ name: venueName, seats: f.max_seats }], false);
      await vpaNotifyNewSignup(env, session, f, [{ name: venueName, seats: f.max_seats }], false);
    }
  } catch (e) {
    // Log which step failed so a stuck venue is visible in HQ, then rethrow so
    // Stripe retries and the self-healing path above finishes it next time.
    try {
      await vpaInsert(env, 'vp_admin_audit', {
        actor_admin: null,
        actor_label: 'stripe',
        action: 'venue_provision_failed',
        target: 'founding:' + foundingId,
        detail: { step: step, completed: stepsDone, error: String((e && e.message) || e) },
      }, false);
    } catch (_) { /* best-effort; never mask the original error */ }
    throw e;
  }
}

/* ========================================================================
 * GROUP provisioning (self-serve group signup). The checkout sends
 * venues:[{name,seats}] and the lead stores venues_json; here we create every
 * venue under ONE owner login and a shared group_id. Idempotent + self-healing
 * (a Stripe retry finishes anything missing), same as the single-venue path.
 * ===================================================================== */

// Find-or-create ONE venue (idempotent by founding_id + name) with its
// settings, screen, group link, per-venue player count and (if we have a
// login) a manager staff row. Returns { venue, created }.
// AU postcode -> state (best-effort, for admin/reporting). null if unknown.
function vpaStateFromPostcode(pc) {
  const n = parseInt(String(pc || '').replace(/\D/g, ''), 10);
  if (!(n >= 0)) return null;
  if ((n >= 200 && n <= 299) || (n >= 2600 && n <= 2618) || (n >= 2900 && n <= 2920)) return 'ACT';
  if ((n >= 1000 && n <= 2599) || (n >= 2619 && n <= 2899) || (n >= 2921 && n <= 2999)) return 'NSW';
  if ((n >= 3000 && n <= 3999) || (n >= 8000 && n <= 8999)) return 'VIC';
  if ((n >= 4000 && n <= 4999) || (n >= 9000 && n <= 9999)) return 'QLD';
  if (n >= 5000 && n <= 5799) return 'SA';
  if (n >= 6000 && n <= 6797) return 'WA';
  if (n >= 7000 && n <= 7799) return 'TAS';
  if (n >= 800 && n <= 999) return 'NT';
  return null;
}

// AU postcode -> IANA timezone (best-effort; QLD fallback). Same postcode->state map as above, so a
// venue's members-draw "Tonight" shows on the right day in the venue's own time.
function vpaTimezoneFromPostcode(pc) {
  switch (vpaStateFromPostcode(pc)) {
    case 'NSW': case 'ACT': return 'Australia/Sydney';
    case 'VIC': return 'Australia/Melbourne';
    case 'SA':  return 'Australia/Adelaide';
    case 'WA':  return 'Australia/Perth';
    case 'TAS': return 'Australia/Hobart';
    case 'NT':  return 'Australia/Darwin';
    default:    return 'Australia/Brisbane';
  }
}

/* Club or pub, guessed from the venue's name. The postcode gives us the state; nothing about a
 * postcode says whether a venue is a non-profit, and that is the half every gaming category turns
 * on. An RSL, a bowls club or a leagues club is a non-profit by construction; a Hotel or Tavern is
 * not. Where the name carries both signals or neither we return null and ASK, because a confident
 * wrong answer here is worse than no answer.
 *
 * Setting this is safe on its own: it decides which rules a venue is SHOWN, not what it may do.
 * Paid entry stays switched off until a human turns it on in HQ, which is a separate action and
 * one this never takes. Kept in step with guessEntity() in app/hq.html.
 */
const VPA_CLUBWORDS = /\b(rsl|bowls|bowling|leagues|workers|workmen|club|golf|surf|sailing|yacht|memorial|services|citizens|cwa|legion|guild|association|society|assn|inc)\b/i;
const VPA_PUBWORDS  = /\b(hotel|tavern|pub|inn|arms|brewery|brewhouse|bar|motel|resort|lodge)\b/i;
/* Should paid entry be ON for this venue from day one?
 *
 * Only ever when the VENUE told us what it is at signup. A guess from the trading name is fine
 * for choosing which rules to show, and nowhere near good enough to unlock a legal capability:
 * a privately owned golf club reads as a non-profit and is not one, and unlocking that venue
 * would have us enabling paid games for someone who cannot lawfully run them. OLGR's letter of
 * 18 Aug 2026 puts that expectation on us directly as a third party operator.
 *
 * A for-profit venue is never unlocked: in every state it can run a paid raffle only for a
 * nominated cause, which is a conversation, not a switch.
 *
 * Two states stay off even for a confirmed club:
 *   QLD  our number generator is still going through OLGR approval, so we cannot run the draw
 *        at all yet, whatever the venue is allowed to do
 *   NT   a published permit condition may bar an association paying us any fee, unresolved
 * Everywhere else a club may charge, subject to caps and permits that vp-gaming.js shows them
 * before each night and that remain the venue's own responsibility.
 */
const VPA_PAID_ENTRY_BLOCKED_STATES = new Set(['QLD', 'NT']);
function vpaPaidEntryDefault(entityType, auState) {
  if (entityType !== 'non_profit') return false;
  if (!auState) return false;                       // no postcode, no state, no assumptions
  return !VPA_PAID_ENTRY_BLOCKED_STATES.has(String(auState).toUpperCase());
}

function vpaGuessEntity(name) {
  const n = String(name || '');
  const club = VPA_CLUBWORDS.test(n), pub = VPA_PUBWORDS.test(n);
  if (club && !pub) return 'non_profit';
  if (pub && !club) return 'for_profit';
  return null;
}

async function vpaProvisionOneVenue(env, opts) {
  const foundingId = opts.foundingId, groupId = opts.groupId,
        name = opts.name, seats = opts.seats, authUserId = opts.authUserId;
  // Only 'non_profit' or 'for_profit' from the signup form is trusted; anything else is "not asked".
  const declaredEntity = (opts.entityType === 'non_profit' || opts.entityType === 'for_profit')
    ? opts.entityType : null;
  let created = false;

  let venue = (await vpaSelect(env, 'vp_venues',
    'founding_id=eq.' + encodeURIComponent(foundingId) +
    '&name=eq.' + encodeURIComponent(name) + '&select=id,name,slug'))[0];
  if (!venue) {
    const slug = await vpaUniqueSlug(env, vpaSlugify(name), foundingId + ':' + name, opts.postcode);
    venue = await vpaInsert(env, 'vp_venues', {
      founding_id: foundingId,
      group_id: groupId || undefined,
      name: name,
      slug: slug,
      max_players: seats || null,
      postcode: opts.postcode || null,
      au_state: vpaStateFromPostcode(opts.postcode),
      /* DECLARED ONLY. Never a guess. Writing vpaGuessEntity() here meant the column that looks
         like a legal declaration held an inference from a trading name, and HQ could no longer
         tell the two apart: its "Set as club" prompt and its "confirm before switching paid entry
         on" warning both only render when entity_type is EMPTY, so filling it with a guess hid
         the very check that was supposed to catch a wrong guess. Null means nobody has asked yet,
         which is the truth, keeps paid entry locked, and makes HQ ask. */
      entity_type: declaredEntity,
      paid_entry_enabled: vpaPaidEntryDefault(declaredEntity, vpaStateFromPostcode(opts.postcode)),
      status: 'active',
      timezone: 'Australia/Brisbane',
    });
    created = true;
  }

  const haveSettings = await vpaSelect(env, 'vp_venue_settings',
    'venue_id=eq.' + encodeURIComponent(venue.id) + '&select=venue_id');
  if (!(haveSettings && haveSettings.length)) {
    await vpaInsert(env, 'vp_venue_settings', { venue_id: venue.id }, false);
  }

  const haveScreen = await vpaSelect(env, 'vp_screens',
    'venue_id=eq.' + encodeURIComponent(venue.id) + '&select=id');
  if (!(haveScreen && haveScreen.length)) {
    await vpaInsert(env, 'vp_screens', { venue_id: venue.id, name: 'Main screen' }, false);
  }

  if (authUserId) {
    const haveStaff = await vpaSelect(env, 'vp_venue_staff',
      'venue_id=eq.' + encodeURIComponent(venue.id) +
      '&auth_user_id=eq.' + encodeURIComponent(authUserId) + '&select=id');
    if (!(haveStaff && haveStaff.length)) {
      await vpaInsert(env, 'vp_venue_staff', {
        venue_id: venue.id,
        auth_user_id: authUserId,
        role: 'manager',
        display_name: name + ' manager',
      }, false);
    }
  }
  return { venue: venue, created: created };
}

// Provision a whole group: one owner login (manager of every venue), then each
// venue, then an audit + welcome. A missing/landline mobile skips the login and
// flags the group (venue_no_login), exactly like the single-venue path.
async function vpaProvisionGroup(env, session, f) {
  const foundingId = f.id;
  const groupId = foundingId; // all venues in the group share this
  const venues = f.venues_json || [];

  const cd = session.customer_details || {};
  const rawMobile = cd.phone || f.mobile;
  const mobile = vpaNormaliseMobileAU(rawMobile);
  const validMobile = !!(mobile && vpaIsAuMobileE164(mobile));
  const loginSkippedReason = validMobile ? null : (rawMobile ? 'not_au_mobile' : 'no_mobile');

  let step = 'start';
  try {
    let authUserId = null;
    if (validMobile) {
      step = 'create_login';
      try {
        const u = await vpaAuthCreateUser(env, {
          phone: mobile, phone_confirm: true, user_metadata: { group: true, venues: venues.length },
        });
        authUserId = u.id;
      } catch (e) {
        if (e.alreadyExists) {
          const found = await vpaFindAuthUser(env, { phone: mobile });
          authUserId = found && found.id;
        } else { throw e; }
      }
    }

    // Self-serve group = ONE founding account owning several venues on one card /
    // subscription. Each venue uses founding_id (group_id stays null), which needs
    // migration 12 (it drops the founding_id UNIQUE so an account can own more than one
    // venue). The separate admin-invoiced vp_venue_groups model is not used here.
    step = 'venues';
    let anyCreated = false;
    for (let i = 0; i < venues.length; i++) {
      const v = venues[i] || {};
      const name = String(v.name || '').trim() || ('Venue ' + (i + 1));
      const seats = parseInt(v.seats, 10) || null;
      const postcode = String(v.postcode || '').replace(/\D/g, '').slice(0, 4);
      const r = await vpaProvisionOneVenue(env, { foundingId: foundingId, groupId: null, name: name, seats: seats, postcode: postcode, entityType: v.entity_type || null, authUserId: authUserId });
      if (r.created) anyCreated = true;
    }

    step = 'audit';
    if (anyCreated) {
      await vpaInsert(env, 'vp_admin_audit', {
        actor_admin: null, actor_label: 'stripe', action: 'group_provisioned',
        target: 'group:' + groupId,
        detail: {
          founding_id: foundingId, venue_count: venues.length,
          tier: (session.metadata && session.metadata.tier) || null,
          manager_created: !!authUserId, login_skipped_reason: loginSkippedReason,
          stripe_subscription_id: session.subscription || null,
        },
      }, false);
      await vpaFireWelcome(env, session, f, venues, true);
      await vpaNotifyNewSignup(env, session, f, venues, true);
    }
    // Flag a loginless group on ANY run (even a no-op retry), written once, so HQ always catches it.
    if (!authUserId) {
      const existingFlag = await vpaSelect(env, 'vp_admin_audit',
        'target=eq.' + encodeURIComponent('group:' + groupId) + '&action=eq.venue_no_login&select=id&limit=1');
      if (!(existingFlag && existingFlag.length)) {
        await vpaInsert(env, 'vp_admin_audit', {
          actor_admin: null, actor_label: 'stripe', action: 'venue_no_login',
          target: 'group:' + groupId,
          detail: { founding_id: foundingId, reason: loginSkippedReason || 'login_lookup_failed', mobile_provided: !!rawMobile },
        }, false);
      }
    }
  } catch (e) {
    try {
      await vpaInsert(env, 'vp_admin_audit', {
        actor_admin: null, actor_label: 'stripe', action: 'venue_provision_failed',
        target: 'group:' + groupId,
        detail: { step: step, error: String((e && e.message) || e) },
      }, false);
    } catch (_) { /* best-effort */ }
    throw e;
  }
}

// Best-effort WELCOME email via Resend. Skips silently if Resend is not set up
// yet (provisioning already succeeded, so this must NEVER throw). Reuses the
// real templates hosted on the site (/emails/welcome*.html).
async function vpaFireWelcome(env, session, f, venues, isGroup) {
  try {
    if (!env.RESEND_API_KEY) return; // Resend not configured yet -> skip
    const site = (env.SITE_URL || 'https://venueplay.com.au').replace(/\/+$/, '');
    const email = f.contact_email;
    if (!email) return;

    const plan = f.plan === 'annual' ? 'annual' : 'monthly';
    const tier = (session.metadata && session.metadata.tier) || 'founding';
    const rate = tier === 'standard' ? (plan === 'annual' ? 2.85 : 3.00)
                                     : (plan === 'annual' ? 2.30 : 2.50);
    const money = (n) => '$' + Number(n).toFixed(2);
    const nowSecs = Math.floor(Date.now() / 1000);
    const firstChargeTs = nowSecs + 30 * 24 * 60 * 60;
    const firstCharge = vpaFmtDate(firstChargeTs);
    const launchPhrase = '';
    const consoleUrl = site + '/app';
    const tvUrl = site + '/tv';
    const calendly = env.CALENDLY_URL || (site + '/#contact');
    const support = 'hello@venueplay.com.au';

    const res = await fetch(site + '/emails/' + (isGroup ? 'welcome-group.html' : 'welcome.html'));
    if (!res.ok) return;
    let html = await res.text();

    if (isGroup) {
      const total = venues.reduce((n, v) => n + (parseInt(v.seats, 10) || 0), 0);
      let blocks = '';
      for (let i = 0; i < venues.length; i++) {
        const v = venues[i]; const seats = parseInt(v.seats, 10) || 0;
        blocks += '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #eee;border-radius:12px;margin-bottom:12px"><tr><td style="padding:16px 20px">'
          + '<p style="margin:0;font-size:17px;font-weight:700;color:#12101a">' + vpaEsc(v.name) + '</p>'
          + '<p style="margin:4px 0 12px;font-size:14px;color:#6a6a75">' + seats + ' players &middot; ' + money(seats * rate) + ' a month</p>'
          + '<a href="' + consoleUrl + '" style="display:inline-block;background:#FF1F8E;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;padding:10px 20px;border-radius:8px;margin-right:8px">Host console</a>'
          + '<a href="' + tvUrl + '" style="display:inline-block;color:#12101a;text-decoration:none;font-size:14px;font-weight:700;border:1.5px solid #12101a;padding:8.5px 20px;border-radius:8px">TV screen</a>'
          + '</td></tr></table>';
      }
      html = html.replace('{{VENUE_BLOCKS}}', blocks)
        .replace(/{{venue_count}}/g, String(venues.length))
        .replace(/{{total_players}}/g, String(total))
        .replace(/{{monthly_total}}/g, money(total * rate));
    } else {
      const seats = parseInt((venues[0] && venues[0].seats) || f.max_seats, 10) || 0;
      html = html.replace(/{{player_count}}/g, String(seats))
        .replace(/{{monthly_total}}/g, money(seats * rate));
    }
    html = html.replace(/{{first_charge_date}}/g, firstCharge)
      .replace(/{{launch_phrase}}/g, launchPhrase)
      .replace(/{{player_rate}}/g, money(rate))
      .replace(/{{host_console_url}}/g, consoleUrl)
      .replace(/{{tv_url}}/g, tvUrl)
      .replace(/{{calendly_url}}/g, calendly)
      // The welcome email now carries a plain-English summary of the plan and links the real
      // agreement. Unfilled, these would go out to a paying customer as the literal text
      // {{terms_url}}, which is worse than not linking them at all.
      .replace(/{{terms_url}}/g, site + '/terms')
      .replace(/{{privacy_url}}/g, site + '/privacy')
      .replace(/{{support_email}}/g, support);

    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'VenuePlay <hello@send.venueplay.com.au>',
        reply_to: 'hello@venueplay.com.au', // replies reach the real monitored inbox
        to: [email],
        subject: isGroup ? 'Your venues are set up. Welcome to VenuePlay' : 'You are in. Welcome to VenuePlay',
        html: html,
      }),
    });
  } catch (_) { /* welcome email is best-effort; never fail provisioning */ }
}

/* Internal heads-up to the VenuePlay inbox the moment a venue signs up.
 *
 * Separate from the customer's welcome email on purpose: this one is for us, so it carries the
 * facts needed to act rather than anything reassuring. It fires from the same place the welcome
 * does, which is the only point where a signup is known to have provisioned successfully.
 *
 * Best-effort in the strongest sense: it is wrapped, it never throws, and it is deliberately
 * NOT awaited by anything that could fail a Stripe webhook. A missed notification costs an
 * email; a thrown one would cost a retry storm on a customer's provisioning.
 */
async function vpaNotifyNewSignup(env, session, f, venues, isGroup) {
  try {
    if (!env.RESEND_API_KEY) return;
    const to = env.VP_INTERNAL_EMAIL || 'hello@venueplay.com.au';
    const site = (env.SITE_URL || 'https://venueplay.com.au').replace(/\/+$/, '');
    const cd = session.customer_details || {};
    const meta = session.metadata || {};

    const contactName = meta.contact_name || cd.name || '';
    const contactEmail = f.contact_email || cd.email || '';
    const mobile = f.mobile || cd.phone || '';
    const postcode = f.postcode || '';
    const state = vpaStateFromPostcode(postcode) || '';

    const plan = f.plan === 'annual' ? 'annual' : 'monthly';
    const tier = meta.tier === 'standard' ? 'standard' : 'founding';
    const rate = tier === 'standard' ? (plan === 'annual' ? 2.85 : 3.00)
                                     : (plan === 'annual' ? 2.30 : 2.50);
    const list = Array.isArray(venues) ? venues : [];
    const seatsTotal = list.reduce((n, v) => n + (parseInt(v.seats, 10) || 0), 0);
    const money = (n) => '$' + Number(n).toFixed(2);

    const rows = [];
    const row = (k, v) => { if (v) rows.push([k, v]); };
    row('Venue' + (list.length > 1 ? 's' : ''), list.map((v) => vpaEsc(v.name)).join('<br>'));
    row('Players', String(seatsTotal) + (list.length > 1 ? ' across ' + list.length + ' venues' : ''));
    row('State', state ? (state + ' &middot; ' + vpaEsc(postcode)) : (postcode ? vpaEsc(postcode) : ''));
    row('Contact', vpaEsc(contactName));
    row('Email', contactEmail ? '<a href="mailto:' + vpaEsc(contactEmail) + '">' + vpaEsc(contactEmail) + '</a>' : '');
    row('Mobile', mobile ? '<a href="tel:' + vpaEsc(mobile) + '">' + vpaEsc(mobile) + '</a>' : '');
    row('Plan', tier + ' ' + plan + ', ' + money(rate) + ' a player');
    row('Monthly', money(seatsTotal * rate));

    let table = '';
    for (let i = 0; i < rows.length; i++) {
      table += '<tr>'
        + '<td style="padding:7px 14px 7px 0;color:#6a6a75;font-size:14px;white-space:nowrap;vertical-align:top">' + rows[i][0] + '</td>'
        + '<td style="padding:7px 0;color:#12101a;font-size:14px;font-weight:600">' + rows[i][1] + '</td>'
        + '</tr>';
    }

    /* The gaming rules turn on whether the venue is a club or a pub, and signup never asks.
       We guess it from the name, which is right for an RSL or a Hotel and silent for anything
       ambiguous. When it IS silent, this email is the thing that gets it fixed: nobody is going
       to notice a null column, but somebody reads this. */
    const guessed = vpaGuessEntity(list.length ? list[0].name : '');
    const stateLine = state ? (' Their state is ' + state + ', so check the grid before promising paid games.') : '';

    /* Two very different messages. One is a note; the other is a job for a person. */
    const gamingBlock = guessed
      ? ('<p style="margin:0 0 18px;padding:12px 14px;background:#F4F0F2;border-left:3px solid #9b93a5;font-size:13.5px;color:#12101a;line-height:1.5">'
         + 'The name reads as <b>' + (guessed === 'non_profit' ? 'a club (non-profit)' : 'a pub (for-profit)') + '</b>, so that is what we have recorded. '
         + 'Paid entry is still switched off until someone turns it on in HQ.' + stateLine + '</p>')
      : ('<p style="margin:0 0 18px;padding:12px 14px;background:#FBF2E0;border-left:3px solid #8A5A0B;font-size:13.5px;color:#12101a;line-height:1.5">'
         + '<b>Needs a person: we cannot tell if this is a club or a pub.</b> The name does not say, and it decides which gaming rules they get shown '
         + 'and whether they can ever charge for entry. Ask them on the onboarding call, then set it on their row in HQ. '
         + 'Until then they are free-entry only, which is safe everywhere but is not the whole product.' + stateLine + '</p>');

    const html = '<div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:560px;margin:0 auto;padding:24px">'
      + '<p style="margin:0 0 4px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#FF1F8E;font-weight:700">New signup</p>'
      + '<h1 style="margin:0 0 18px;font-size:24px;color:#12101a">' + vpaEsc(list.length ? list[0].name : 'A new venue') + (list.length > 1 ? ' and ' + (list.length - 1) + ' more' : '') + '</h1>'
      + '<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin-bottom:20px">' + table + '</table>'
      + gamingBlock
      + '<a href="' + site + '/app/hq.html" style="display:inline-block;background:#FF1F8E;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;padding:11px 22px;border-radius:8px">Open HQ</a>'
      + '</div>';

    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'VenuePlay <hello@send.venueplay.com.au>',
        reply_to: contactEmail || 'hello@venueplay.com.au',  // reply goes straight to the venue
        to: [to],
        // Flag the ones needing a decision in the subject, so it is actionable from the inbox list.
        subject: (isGroup ? 'New group signup: ' + list.length + ' venues, ' : 'New signup: ')
                 + (list.length ? list[0].name : 'venue') + (state ? ' (' + state + ')' : '')
                 + (guessed ? '' : ' [club or pub?]'),
        html: html,
      }),
    });
  } catch (_) { /* internal notification only; never affect provisioning */ }
}

/* Branded VenuePlay invoice email, sent on every real payment (invoice.paid).
   Links to the Stripe-hosted invoice + PDF (which carry your Stripe branding).
   Skips $0 trial invoices and is best-effort so it never affects the webhook. */
// Read the busy-night overage off an invoice's own line items. chargeNightOverage (game worker)
// adds one Stripe invoiceitem per over-cap night, described "Big night extra players ...", at the
// flat $2/head rate. So the invoice itself is the source of truth - no re-aggregation, no double
// count. Returns { nights, players (total extra player-nights), cents }.
/* Which invoice lines are BIG-NIGHT OVERAGE, for the "busy month" line in the customer's email.

   This used to match /extra players/i, which also matches the description vpbAdjustPlayerBilling
   writes for a permanent plan increase ("<venue>: N extra players, full month"). So a venue that
   simply added 5 players on the billing page was emailed "you went over your plan on 1 night this
   cycle" for something that never happened. It then divided by $2 regardless of the rate actually
   charged ($2.50 or $3.00 for a plan increase, and $1.00 on a third consecutive big night), so the
   headcount in that sentence was wrong too.

   chargeNightOverage in the game Worker writes exactly one shape: "Big night extra players - ...".
   Anchor on that and nothing else can be mistaken for it. The per-night rate is read back out of
   the description rather than assumed. */
function vpaOverageFromInvoice(invoice) {
  const out = { nights: 0, players: 0, cents: 0 };
  const lines = invoice && invoice.lines && invoice.lines.data;
  if (!Array.isArray(lines)) return out;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const desc = String((l && l.description) || '');
    if (!/^Big night extra players/i.test(desc) || !(Number(l.amount) > 0)) continue;
    out.nights += 1;
    out.cents += Number(l.amount);
    // "... - 12 over 100 at $2.00" : take the count from the line itself.
    const m = desc.match(/-\s*(\d+)\s+over\s+\d+\s+at\s+\$/i);
    if (m) out.players += parseInt(m[1], 10) || 0;
    else out.players += Math.round(Number(l.amount) / 200);   // older line format: assume $2
  }
  return out;
}

async function vpaFireInvoiceEmail(env, invoice) {
  try {
    if (!env.RESEND_API_KEY) return;                                  // Resend not configured yet
    if (!invoice || Number(invoice.amount_paid || 0) <= 0) return;    // only real payments, not $0 trial invoices
    const email = invoice.customer_email;
    if (!email) return;
    const site = (env.SITE_URL || 'https://venueplay.com.au').replace(/\/+$/, '');
    const logo = site + '/logos/venueplay_primary_rebuilt.png';
    const amount = '$' + (Number(invoice.amount_paid) / 100).toFixed(2);
    const ov = vpaOverageFromInvoice(invoice);
    const number = invoice.number ? String(invoice.number) : '';
    const view = invoice.hosted_invoice_url || '';
    const pdf = invoice.invoice_pdf || '';
    const btn = view || pdf;
    const html =
      '<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;padding:8px 0;color:#12101a">'
      + '<img src="' + logo + '" alt="VenuePlay" width="150" style="display:block;margin:0 0 24px">'
      + '<p style="font-size:17px;font-weight:700;margin:0 0 6px">Payment received. Thank you.</p>'
      + '<p style="font-size:14px;color:#6a6a75;margin:0 0 20px">Here is your VenuePlay invoice' + (number ? ' ' + vpaEsc(number) : '') + '.</p>'
      + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #eee;border-radius:12px;margin-bottom:22px"><tr><td style="padding:18px 20px">'
      +   '<p style="margin:0;font-size:13px;color:#6a6a75">Amount paid</p>'
      +   '<p style="margin:2px 0 0;font-size:26px;font-weight:800;color:#12101a">' + amount + '</p>'
      +   (ov.nights > 0
            ? '<p style="margin:10px 0 0;padding-top:10px;border-top:1px solid #eee;font-size:13px;color:#6a6a75">Includes <b style="color:#12101a">' + ov.players + ' extra player' + (ov.players === 1 ? '' : 's') + '</b> over <b style="color:#12101a">' + ov.nights + ' big night' + (ov.nights === 1 ? '' : 's') + '</b> &middot; $' + (ov.cents / 100).toFixed(2) + ' at $2/head.</p>'
            : '')
      + '</td></tr></table>'
      + (ov.nights > 0 ? '<p style="font-size:13px;color:#6a6a75;margin:0 0 18px">Running over most weeks? A bigger plan usually works out cheaper than the per-night rate - adjust it anytime on your billing page.</p>' : '')
      + (btn ? '<a href="' + btn + '" style="display:inline-block;background:#FF1F8E;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;padding:11px 22px;border-radius:8px">View invoice</a>' : '')
      + (pdf ? ' <a href="' + pdf + '" style="display:inline-block;color:#12101a;text-decoration:none;font-size:14px;font-weight:700;border:1.5px solid #12101a;padding:9.5px 22px;border-radius:8px">Download PDF</a>' : '')
      + '<p style="font-size:12.5px;color:#9a9aa4;margin:26px 0 0">Questions about your bill? Reply to this email or contact hello@venueplay.com.au</p>'
      + '<p style="font-size:12px;color:#c2c2cc;margin:14px 0 0">venueplay.com.au</p>'
      + '</div>';
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'VenuePlay <hello@send.venueplay.com.au>',
        reply_to: 'hello@venueplay.com.au', // replies reach the real monitored inbox
        to: [email],
        subject: 'Your VenuePlay invoice' + (number ? ' ' + number : '') + ' - ' + amount,
        html: html,
      }),
    });
  } catch (_) { /* invoice email is best-effort */ }
}

/* 5-day payment reminder, sent on Stripe's invoice.upcoming event (set the lead time to 5 days in
   Stripe billing settings). Respects the venue's payment_reminders opt-out. Best-effort. */
async function vpaFireUpcomingEmail(env, invoice) {
  try {
    if (!env.RESEND_API_KEY) return;
    if (!invoice) return;
    const email = invoice.customer_email;
    if (!email) return;
    const amountDue = Number(invoice.amount_due || 0);
    if (amountDue <= 0) return;   // $0 upcoming (still in the free month) -> no reminder
    const customer = invoice.customer;
    if (customer) {
      try {
        const accts = await vpaSelect(env, 'venueplay_founding',
          'stripe_customer_id=eq.' + encodeURIComponent(customer) + '&select=payment_reminders&limit=1');
        if (accts && accts[0] && accts[0].payment_reminders === false) return;   // opted out
      } catch (_) { /* can't check -> still send; a reminder is safer than silence */ }
    }
    const amount = '$' + (amountDue / 100).toFixed(2);
    // Credit being applied to THIS invoice. Stripe carries it as a negative starting_balance, so
    // a venue that reduced its plan mid-year can see the money coming back rather than wondering
    // where it went.
    const creditApplied = Math.max(0, -Number(invoice.starting_balance || 0));
    const creditLeft = Math.max(0, -Number(invoice.ending_balance || 0));
    const ov = vpaOverageFromInvoice(invoice);
    const whenTs = invoice.next_payment_attempt || invoice.period_end || 0;
    const when = whenTs ? vpaFmtDate(whenTs) : '';
    const site = (env.SITE_URL || 'https://venueplay.com.au').replace(/\/+$/, '');
    const logo = site + '/logos/venueplay_primary_rebuilt.png';
    const billing = site + '/app/billing.html';
    const html =
      '<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;padding:8px 0;color:#12101a">'
      + '<img src="' + logo + '" alt="VenuePlay" width="150" style="display:block;margin:0 0 24px">'
      + '<p style="font-size:17px;font-weight:700;margin:0 0 6px">A heads-up: your next payment is coming up.</p>'
      + '<p style="font-size:14px;color:#6a6a75;margin:0 0 20px">' + (when ? 'On ' + vpaEsc(when) + ' we\'ll charge' : 'Shortly we\'ll charge') + ' the card on file for your VenuePlay subscription.</p>'
      + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #eee;border-radius:12px;margin-bottom:22px"><tr><td style="padding:18px 20px">'
      +   '<p style="margin:0;font-size:13px;color:#6a6a75">Amount due</p>'
      +   '<p style="margin:2px 0 0;font-size:26px;font-weight:800;color:#12101a">' + amount + '</p>'
      +   (when ? '<p style="margin:6px 0 0;font-size:13px;color:#6a6a75">On ' + vpaEsc(when) + '</p>' : '')
      + '</td></tr></table>'
      + (ov.nights > 0
          ? '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fff6fb;border:1px solid #ffd0e6;border-radius:12px;margin-bottom:22px"><tr><td style="padding:16px 18px">'
            + '<p style="margin:0;font-size:14px;font-weight:700;color:#12101a">Busy month! This bill includes extra players.</p>'
            + '<p style="margin:6px 0 0;font-size:13.5px;color:#3a3a44">You went over your plan on <b>' + ov.nights + ' night' + (ov.nights === 1 ? '' : 's') + '</b> this cycle (<b>' + ov.players + ' extra player' + (ov.players === 1 ? '' : 's') + '</b>), adding <b>$' + (ov.cents / 100).toFixed(2) + '</b> at $2/head. If that\'s your normal, a bigger plan usually works out cheaper - you can bump it on your billing page before this charge.</p>'
            + '</td></tr></table>'
          : '')
      + (creditApplied > 0
          ? '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2fbf6;border:1px solid #c9ecd8;border-radius:12px;margin-bottom:22px"><tr><td style="padding:16px 18px">'
            + '<p style="margin:0;font-size:14px;font-weight:700;color:#12101a">Your credit is coming off this bill.</p>'
            + '<p style="margin:6px 0 0;font-size:13.5px;color:#3a3a44">We have applied <b>$' + (creditApplied / 100).toFixed(2) + '</b> from players you released earlier'
            + (creditLeft > 0 ? ', and <b>$' + (creditLeft / 100).toFixed(2) + '</b> stays on your account for next time' : '')
            + '. Nothing to claim, it happens on its own.</p>'
            + '</td></tr></table>'
          : '')
      + '<a href="' + billing + '" style="display:inline-block;background:#FF1F8E;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;padding:11px 22px;border-radius:8px">Manage your plan</a>'
      + '<p style="font-size:13px;color:#6a6a75;margin:22px 0 0">You can add or reduce players anytime from your billing page. On monthly, added players are a full month and reductions start at your next renewal. On annual, added players are pro rata to your renewal, and if you reduce, the unused value is held as credit against next year rather than lost.</p>'
      + '<p style="font-size:12.5px;color:#9a9aa4;margin:22px 0 0">Prefer not to get these? Turn payment reminders off on your billing page. Questions? Reply to this email or contact hello@venueplay.com.au</p>'
      + '<p style="font-size:12px;color:#c2c2cc;margin:14px 0 0">venueplay.com.au</p>'
      + '</div>';
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'VenuePlay <hello@send.venueplay.com.au>',
        reply_to: 'hello@venueplay.com.au',
        to: [email],
        subject: 'Your VenuePlay payment is coming up' + (when ? ' - ' + when : '') + ' (' + amount + ')',
        html: html,
      }),
    });
  } catch (_) { /* reminder email is best-effort */ }
}

/* ---------------------------------------------------------------------------
   NON-PAYMENT: switching a venue off, and back on again.

   Until now the webhook listened for three events, all of them happy ones, so a venue whose card
   failed was never heard about again. Their status stayed active and they kept running bingo every
   week for nothing, because the only thing that ever suspended a venue ran on a SUCCESSFUL payment.

   Three things happen now:
     invoice.payment_failed        -> tell them, change nothing. Stripe retries for a fortnight and
                                      most of these are an expired card that fixes itself.
     subscription past_due/unpaid  -> Stripe says the invoice is overdue. Suspend, reason
     or subscription.deleted          'nonpayment'. Games stop; NOTHING is deleted.
     invoice.paid                  -> anything suspended for nonpayment comes straight back on,
                                      without anyone at VenuePlay having to notice.

   The reason is the important part. A venue switched off by hand in HQ is never turned back on by
   a passing payment; only 'nonpayment' is reversible automatically.
   ------------------------------------------------------------------------- */
async function vpaVenuesForCustomer(env, customerId) {
  if (!customerId) return [];
  const accts = await vpaSelect(env, 'venueplay_founding',
    'stripe_customer_id=eq.' + encodeURIComponent(customerId) + '&select=id,contact_email,plan&limit=1');
  const acct = accts && accts[0];
  if (!acct) return [];
  const venues = await vpaSelect(env, 'vp_venues',
    'founding_id=eq.' + encodeURIComponent(acct.id) + '&select=id,name,status,suspended_reason');
  return [(venues || []), acct];
}

/* HOW MANY FAILED ATTEMPTS BEFORE THE GAMES STOP.
 *
 * We used to stop them on the first one, because Stripe flips a subscription to past_due the
 * moment an attempt fails. That is a venue going dark on a Tuesday over an expired card, possibly
 * mid-night with a room full of people, and for an annual venue it is a customer who has just paid
 * for a whole year being switched off on day one of a card problem.
 *
 * So they get a grace window, and it is longer for a bigger commitment: a monthly venue is one
 * month behind, an annual venue has a year of paid history behind them.
 *
 * This counts STRIPE'S attempts, not days, so it moves with whatever retry schedule is configured
 * rather than assuming one. The failure email goes out on every attempt regardless: they should
 * hear from us the first time, they just should not be switched off the first time.
 */
function vpaFailuresBeforeSuspend(plan) { return plan === 'annual' ? 4 : 2; }

/* Write a chargeback into the admin audit trail, against the account it belongs to.
   Deliberately does nothing else: cancelling is Stripe's setting, and a dispute that we
   auto-actioned as well would be two systems fighting over the same venue. */
async function vpaRecordDispute(env, dispute, eventType) {
  try {
    if (!dispute) return;
    // A Dispute carries the charge, not always the customer, so resolve through the charge.
    let customerId = dispute.customer || null;
    if (!customerId && dispute.charge) {
      const ch = await vpbStripeGet(env, 'charges/' + encodeURIComponent(String(dispute.charge)));
      customerId = (ch && !ch.error && ch.customer) || null;
    }
    if (!customerId) return;
    const [venues, acct] = await vpaVenuesForCustomer(env, customerId);
    if (!acct) return;
    const opened = eventType === 'charge.dispute.created';
    await vpaInsert(env, 'vp_admin_audit', {
      actor_admin: null, actor_label: 'stripe',
      action: opened ? 'payment_disputed' : 'payment_dispute_closed',
      target: 'account:' + acct.id,
      detail: {
        amount: '$' + (Number(dispute.amount || 0) / 100).toFixed(2),
        reason: String(dispute.reason || 'unknown'),
        status: String(dispute.status || ''),        // on close: won, lost, warning_closed...
        customer: customerId,
        dispute: String(dispute.id || ''),
        venues: (venues || []).length,
        respond_by: dispute.evidence_details && dispute.evidence_details.due_by
          ? vpaFmtDate(dispute.evidence_details.due_by) : null,
      },
    }, false).catch(() => {});
  } catch (_) { /* never throw out of a webhook */ }
}

async function vpaSuspendForNonpayment(env, customerId, reason) {
  try {
    const [venues, acct] = await vpaVenuesForCustomer(env, customerId);
    if (!venues || !venues.length) return;
    let n = 0;
    for (const v of venues) {
      if (v.status === 'suspended') continue;              // already off, leave the reason alone
      await vpaPatch(env, 'vp_venues', 'id=eq.' + encodeURIComponent(v.id),
        { status: 'suspended', suspended_reason: reason || 'nonpayment' });
      n++;
    }
    if (n) {
      await vpaInsert(env, 'vp_admin_audit', {
        action: 'venue_suspended_' + (reason || 'nonpayment'),
        target: 'account:' + acct.id,
        detail: { venues: n, customer: customerId, reason: reason || 'nonpayment' },
      }, false).catch(() => {});
    }
  } catch (_) { /* never throw out of a webhook */ }
}

/* Throws on a lookup failure ON PURPOSE, so the webhook 500s and Stripe redelivers.

   This is the ONLY automatic route back from a non-payment suspension. vpaSelect returns [] on any
   non-OK response, so a transient Supabase 5xx made venues come back empty, this returned quietly,
   the webhook answered 200, and Stripe never tried again. A venue that had fixed their card stayed
   dark indefinitely, until somebody noticed and turned them on by hand. A retried webhook is
   harmless here: every write below is idempotent. */
async function vpaReactivateOnPayment(env, customerId) {
  try {
    const [venues, acct] = await vpaVenuesForCustomer(env, customerId);
    if (!venues) throw new Error('could not read venues for customer ' + customerId);
    if (!venues.length) return;
    let n = 0;
    for (const v of venues) {
      // ONLY the ones we switched off for non-payment. A venue VenuePlay turned off on purpose
      // (suspended_reason null or 'manual') stays off until a person turns it back on.
      if (v.status !== 'suspended' || v.suspended_reason !== 'nonpayment') continue;
      await vpaPatch(env, 'vp_venues', 'id=eq.' + encodeURIComponent(v.id),
        { status: 'active', suspended_reason: null });
      n++;
    }
    if (n) {
      await vpaInsert(env, 'vp_admin_audit', {
        action: 'venue_reactivated_on_payment',
        target: 'account:' + acct.id,
        detail: { venues: n, customer: customerId },
      }, false).catch(() => {});
    }
  } catch (e) {
    // Let this one out. A silent failure here leaves a paid-up venue switched off, which is worse
    // than a 500 that makes Stripe try again.
    console.log('[reactivate] FAILED for customer ' + customerId + ': ' + (e && e.message));
    throw e;
  }
}

/* When a subscription actually ENDS, clear any credit left on the account.
   The Terms say credit carries from one invoice to the next while the subscription runs and does
   not carry beyond it. Stripe does not know that: a customer balance sits there forever, so a
   venue that lapsed holding $400 and came back a year later would have found it waiting, which is
   not what they agreed to and not what the Account page told them.
   Zeroing it here makes the system match the words. Deliberately NOT done on past_due: they have
   not ended anything yet, they have a card that needs updating, and their credit must survive
   that. Only a genuinely finished subscription clears it. */
async function vpaClearCreditOnEnd(env, customerId) {
  try {
    if (!customerId || !env.STRIPE_SECRET_KEY) return;
    const cust = await vpbStripeGet(env, 'customers/' + encodeURIComponent(customerId));
    const bal = cust && typeof cust.balance === 'number' ? cust.balance : 0;
    if (bal >= 0) return;                       // nothing owing to them
    await vpbStripePost(env, 'customers/' + encodeURIComponent(customerId) + '/balance_transactions', {
      amount: -bal, currency: 'aud',
      description: 'Credit closed with the subscription (VenuePlay terms: credit does not carry beyond the subscription)',
    });
    await vpaInsert(env, 'vp_admin_audit', {
      action: 'credit_cleared_on_subscription_end',
      target: 'customer:' + customerId,
      detail: { cleared_cents: -bal },
    }, false).catch(() => {});
  } catch (_) { /* never throw out of a webhook */ }
}

/* A failed attempt is not an overdue invoice. Tell them and change nothing. */
async function vpaFirePaymentFailedEmail(env, invoice) {
  try {
    if (!env.RESEND_API_KEY || !invoice) return;
    const email = invoice.customer_email;
    if (!email) return;
    const amount = '$' + (Number(invoice.amount_due || 0) / 100).toFixed(2);
    const site = (env.SITE_URL || 'https://venueplay.com.au').replace(/\/+$/, '');
    const billing = site + '/app/billing.html';
    /* Send them to STRIPE'S invoice page, not ours. Our Account page needs them to sign in with a
       texted code first, which is friction at the exact moment they are already annoyed about a
       declined card. The hosted invoice page needs no login, takes a new card, and settles the
       failed invoice on the spot, which is the one thing we actually want to happen. Our own page
       stays as the second link for anyone who would rather go the long way. */
    const payNow = invoice.hosted_invoice_url || billing;
    const html =
      '<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;padding:8px 0;color:#12101a">'
      + '<img src="' + site + '/logos/venueplay_primary_rebuilt.png" alt="VenuePlay" width="150" style="display:block;margin:0 0 24px">'
      + '<p style="font-size:17px;font-weight:700;margin:0 0 6px">Your card did not go through.</p>'
      + '<p style="font-size:14px;color:#6a6a75;margin:0 0 20px">We tried to charge ' + amount + ' for your VenuePlay subscription and it was declined. Nine times out of ten it is an expired card.</p>'
      + '<p style="font-size:14px;color:#3a3a44;margin:0 0 20px">Nothing has changed at your venue and your games are running as normal. We will try again over the next few days. If it keeps failing your games will pause until it is sorted, so it is worth a minute now.</p>'
      + '<a href="' + payNow + '" style="display:inline-block;background:#FF1F8E;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;padding:11px 22px;border-radius:8px">Pay now with a new card</a>'
      + '<p style="font-size:12.5px;color:#9a9aa4;margin:14px 0 0">No sign in needed, it takes a minute. You can also do it from <a href="' + billing + '" style="color:#FF1F8E">your account page</a>.</p>'
      + '<p style="font-size:12.5px;color:#9a9aa4;margin:22px 0 0">Questions? Reply to this email or contact hello@venueplay.com.au</p>'
      + '</div>';
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'VenuePlay <hello@send.venueplay.com.au>',
        reply_to: 'hello@venueplay.com.au',
        to: [email],
        subject: 'Your VenuePlay payment did not go through',
        html: html,
      }),
    });
  } catch (_) { /* best-effort */ }
}

function vpaEsc(s) {
  return String(s == null ? '' : s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
}
// Format a unix-seconds timestamp as a Brisbane calendar date, e.g. "24 September 2026".
function vpaFmtDate(ts) {
  const n = parseInt(ts, 10);
  if (!n) return 'your launch date';
  const d = new Date((n + 36000) * 1000); // +10h so Brisbane midnight lands on the right day
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  return d.getUTCDate() + ' ' + months[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
}


/* ================================================================
 * OWNER BILLING (vpb*)
 * ============================================================= */

/**
 * VenuePlay ACCOUNT / BILLING endpoints (self-serve, for the venue owner).
 * ----------------------------------------------------------------------------
 * Paste these vpb* functions into the live `venueplay-api` Worker alongside the
 * vpa* admin functions (they reuse vpaVerifyJWT / vpaSelect / vpaPatch /
 * vpaInsert / vpaProvisionOneVenue / vpaFmtDate / vpaEsc from that file).
 *
 * INSTALL (in venueplay-api.js fetch router, before the 404), all POST:
 *   /account/summary    -> vpbAccountSummary   (read the whole account)
 *   /account/players    -> vpbSetPlayers       (change one venue's players)
 *   /account/add-venue  -> vpbAddVenue         (add a whole new venue)
 *   /account/reminders  -> vpbSetReminders     (payment-reminder opt-out)
 * Add 'Authorization' to the CORS allow-headers.
 * In the /webhook handler, also handle 'invoice.paid' -> vpbApplyPendingOnInvoice.
 *
 * MODEL: one Stripe subscription per account, quantity = total players across
 * all the account's venues. Increases apply now (pro rata). Reductions are
 * stored as pending_players and applied at the next renewal (invoice.paid), so
 * a venue is never left short mid month and there is no mid-term refund.
 * ----------------------------------------------------------------------------
 */

/* --- Owner auth: verify the login and load the account it manages/owns. --- */
async function vpbRequireOwner(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (!token) return { error: 'Not signed in.', status: 401 };

  const payload = await vpaVerifyJWT(token, env.SUPABASE_JWT_SECRET, env);
  if (!payload || !payload.sub) return { error: 'Invalid or expired session. Please sign in again.', status: 401 };
  const authUserId = payload.sub;

  // Is this a Gflam HQ admin? Resolved ONCE, before anything else, because it decides both whose
  // account this call is about and who the audit entry names.
  let adminRow = null;
  try {
    // owner/accounts ONLY, matching requireStaff in the game Worker. Accepting any row let a
    // Gflam 'staff' admin View-as into any venue and then charge their card through
    // /account/players, cancel their venues, and export their entire marketing list.
    const admins = await vpaSelect(env, 'vp_platform_admins',
      'auth_user_id=eq.' + encodeURIComponent(authUserId) + '&role=in.(owner,accounts)&select=auth_user_id,label,role');
    adminRow = (admins && admins[0]) || null;
  } catch (_) { adminRow = null; }

  // Select only columns that always exist here. permissions is fetched separately below so a
  // not-yet-run migration 17 can never make a real owner read as "no venues".
  const staff = await vpaSelect(env, 'vp_venue_staff',
    'auth_user_id=eq.' + encodeURIComponent(authUserId) + '&role=in.(manager,owner)&select=venue_id,role');

  // "View as" from HQ: the console names the venue it is acting on in X-VP-Venue. Honoured for
  // platform admins ONLY, so a staff member naming someone else's venue changes nothing.
  const target = (request.headers.get('X-VP-Venue') || '').trim();
  // Local on purpose: this Worker has no shared UUID_RE (that one lives in the game Worker).
  const isUuid = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
  const viewingAs = !!(adminRow && isUuid.test(target));

  let ids;
  let actingAsAdmin = false;
  if (viewingAs) {
    // The named venue WINS over the admin's own staff rows, and that ordering is the whole point.
    // This used to run only when the admin was staff nowhere, which was true right up until the
    // day a Gflam admin created a venue of their own. From then on their single staff row was
    // preferred over the venue they had just clicked View as on, so HQ opened The Indypendent and
    // the Account page showed a test venue instead, with no error to explain it. An admin's
    // personal venue must never decide which account they are looking at.
    ids = [target];
    actingAsAdmin = true;
  } else if (staff && staff.length) {
    ids = staff.map((s) => s.venue_id);
  } else if (adminRow) {
    return { error: 'Open this from VenuePlay HQ using View as, so we know which venue you mean.', status: 400 };
  } else {
    return { error: 'This login has no venues.', status: 403 };
  }
  const venues = await vpaSelect(env, 'vp_venues',
    'id=in.(' + ids.map(encodeURIComponent).join(',') + ')' +
    '&order=founding_id.asc,created_at.asc' +
    '&select=id,name,founding_id,group_id,max_players,pending_players,status,slug,cancel_at_period_end');
  if (!venues || !venues.length) return { error: 'No venues found.', status: 403 };

  const foundingId = venues[0].founding_id;
  const accounts = await vpaSelect(env, 'venueplay_founding',
    'id=eq.' + encodeURIComponent(foundingId) +
    '&select=id,plan,is_group,payment_reminders,stripe_subscription_id,stripe_customer_id,contact_email');
  const account = accounts && accounts[0];
  if (!account) return { error: 'No billing account found for this login.', status: 404 };

  // An HQ admin arrives with ONE venue (the one named in X-VP-Venue), so filtering that single
  // row leaves a one-venue account and the other venues, and their TV links, disappear from the
  // Account page. Re-read the whole account so they see exactly what the real owner would.
  let accountVenues = venues.filter((v) => v.founding_id === foundingId);
  if (actingAsAdmin) {
    const all = await vpaSelect(env, 'vp_venues',
      'founding_id=eq.' + encodeURIComponent(foundingId) +
      '&order=created_at.asc' +
      '&select=id,name,founding_id,group_id,max_players,pending_players,status,slug,cancel_at_period_end');
    if (all && all.length) accountVenues = all;
  }
  // Audit attribution: if the person making this owner-level change is actually a VenuePlay
  // platform admin (e.g. our staff helping an account), record THEM, not a generic "owner".
  // Reuses the lookup done at the top, which is also one less Supabase round trip per call.
  const adminActor = adminRow
    ? { id: adminRow.auth_user_id, label: adminRow.label || ('staff:' + (adminRow.role || 'admin')) }
    : null;
  // A restricted MANAGER carries a permissions object on their staff rows; the account owner
  // (and legacy full-access staff) carry none. perms === null therefore means full access.
  // Best-effort: if migration 17 has not run, this select yields nothing and everyone is treated
  // as full-access (safe) until it does.
  let perms = null;
  // An admin viewing as a venue is not a manager OF it, so their own staff row's restrictions must
  // not follow them in. Without this guard, a Gflam admin who happened to be a restricted manager
  // somewhere would silently lose buttons on every OTHER venue they opened.
  if (!actingAsAdmin) {
    try {
      const pr = await vpaSelect(env, 'vp_venue_staff',
        'auth_user_id=eq.' + encodeURIComponent(authUserId) + '&role=in.(manager,owner)&select=permissions');
      for (const s of (pr || [])) { if (s && s.permissions) { perms = s.permissions; break; } }
    } catch (_) { /* permissions column not present yet */ }
  }

  return { authUserId: authUserId, account: account, venues: accountVenues, adminActor: adminActor, perms: perms };
}

// Full-access (account owner or legacy staff) vs a restricted manager, and per-toggle checks.
function vpbIsOwner(o) { return !o.perms; }
function vpbCan(o, key) { return !o.perms || o.perms[key] !== false; }
function vpbOwnerOnly(o, json) { return o.perms ? json({ error: 'Only the account owner can do that.' }, 403) : null; }

// Audit fields for an owner-side action: the acting admin if one is behind it, else the owner.
function vpbActorFields(o) {
  return o.adminActor
    ? { actor_admin: o.adminActor.id, actor_label: o.adminActor.label }
    : { actor_admin: null, actor_label: 'owner' };
}

/* --- Stripe REST helpers. --- */
async function vpbStripeGet(env, path) {
  const res = await fetch('https://api.stripe.com/v1/' + path, {
    headers: { 'Authorization': 'Bearer ' + env.STRIPE_SECRET_KEY },
  });
  return await res.json();
}
/* idemKey: pass one on anything that MOVES MONEY. Without it, two requests that race (two tabs on
   the billing page, or a client retry that overtakes the first attempt) both read the same current
   player count, both compute the same delta, and both create an invoiceitem: the venue is charged
   twice for the same players. The Stripe subscription quantity converges either way, so nothing
   downstream ever revealed it. The game Worker has always keyed its overage charge this way; the
   billing Worker never did. */
async function vpbStripePost(env, path, params, idemKey) {
  const form = new URLSearchParams();
  for (const k in params) form.set(k, String(params[k]));
  const headers = {
    'Authorization': 'Bearer ' + env.STRIPE_SECRET_KEY,
    'Content-Type': 'application/x-www-form-urlencoded',
  };
  if (idemKey) headers['Idempotency-Key'] = String(idemKey).slice(0, 255);
  const res = await fetch('https://api.stripe.com/v1/' + path, {
    method: 'POST', headers, body: form.toString(),
  });
  return await res.json();
}

async function vpbStripeDelete(env, path) {
  const res = await fetch('https://api.stripe.com/v1/' + path, {
    method: 'DELETE',
    headers: { 'Authorization': 'Bearer ' + env.STRIPE_SECRET_KEY },
  });
  return await res.json();
}

/* Where does a discount on this target actually land?
 *
 * A venue billed through a founding account is on Stripe and can carry a real coupon or credit.
 * A venue in a vp_venue_groups group is admin-invoiced through Xero instead (the two are mutually
 * exclusive: vp_venues_one_billing_parent allows founding_id OR group_id, never both), so there is
 * no subscription to discount and the negotiated rate is what the invoice is built from. Saying so
 * plainly is the point: a discount that cannot be applied must not report success. */
async function vpaBillingTargetFor(env, targetType, targetId) {
  if (targetType === 'group') {
    return { manual: true, why: 'Groups are invoiced by hand through Xero, so this is recorded against the group and applied when you raise the invoice.' };
  }
  const vs = await vpaSelect(env, 'vp_venues',
    'id=eq.' + encodeURIComponent(targetId) + '&select=id,name,founding_id,group_id');
  const venue = vs && vs[0];
  if (!venue) return { error: 'That venue no longer exists.' };
  if (!venue.founding_id) {
    return { manual: true, name: venue.name, why: 'This venue is invoiced by hand (it bills through a group, not Stripe), so this is recorded and applied when you raise the invoice.' };
  }
  const accts = await vpaSelect(env, 'venueplay_founding',
    'id=eq.' + encodeURIComponent(venue.founding_id) + '&select=id,plan,stripe_subscription_id,stripe_customer_id');
  const acct = accts && accts[0];
  if (!acct) return { error: 'That venue has no billing account.' };
  const info = await vpbSubItem(env, acct.stripe_subscription_id);
  const customer = (info && info.sub && info.sub.customer) || acct.stripe_customer_id || null;
  if (!customer) return { error: 'That account has no Stripe customer yet, so there is nothing to discount.' };
  return { manual: false, name: venue.name, account: acct, info: info, customer: customer, subId: acct.stripe_subscription_id };
}

/* POST /account/portal : open the Stripe Customer Portal so a venue can see + download every past
   invoice (Stripe-hosted PDFs) and update their card. Requires the Customer Portal to be enabled
   once in the Stripe dashboard (Settings -> Billing -> Customer portal). */
async function vpbBillingPortal(request, env, json) {
  const o = await vpbRequireOwner(request, env);
  if (o.error) return json({ error: o.error }, o.status || 403);
  const customer = o.account && o.account.stripe_customer_id;
  if (!customer) return json({ error: 'Your billing account links up once your first payment goes through. Invoices will appear here after that.' }, 400);
  const origin = request.headers.get('Origin') || 'https://venueplay.com.au';
  const sess = await vpbStripePost(env, 'billing_portal/sessions', {
    customer: customer,
    return_url: origin + '/app/billing.html',
  });
  if (!sess || !sess.url) return json({ error: (sess && sess.error && sess.error.message) || 'Could not open the billing portal. Please try again.' }, 502);
  return json({ url: sess.url });
}

// Per-player monthly rate from the subscription's price + the plan.
/* Falling back to the founding rate when the price id is unknown is fine for a NUMBER ON A
   SCREEN and wrong for a CHARGE. Stripe being briefly unreachable was silently deciding that a
   standard venue pays $2.50 instead of $3.00. The game Worker already refuses to guess a rate on
   real money ("do NOT guess a rate on real money: log and skip"); this now does the same.

   vpbRate keeps the old display behaviour. vpbRateStrict returns null when the tier cannot be
   established, and the billing path refuses rather than inventing a price. */
function vpbIsFoundingPrice(env, priceId) {
  return priceId === env.STRIPE_PRICE_MONTHLY || priceId === env.STRIPE_PRICE_ANNUAL;
}
function vpbRate(env, priceId, plan) {
  // Display only. Unknown price shows the founding figure, as it always has.
  const founding = !priceId || vpbIsFoundingPrice(env, priceId);
  if (plan === 'annual') return founding ? 2.30 : 2.85;
  return founding ? 2.50 : 3.00;
}
function vpbRateStrict(env, priceId, plan) {
  if (!priceId) return null;                     // tier unknown: the caller must not charge
  const founding = vpbIsFoundingPrice(env, priceId);
  if (plan === 'annual') return founding ? 2.30 : 2.85;
  return founding ? 2.50 : 3.00;
}

// Total players BILLED across an account. The billed quantity for a venue is its scheduled
// reduction if one is pending, else its current max_players. Summing the effective value
// keeps the Stripe quantity correct even when some venues have a pending reduction (so a
// later increase/add-venue can't silently re-inflate an already-reduced venue).
async function vpbAccountTotal(env, foundingId) {
  /* READ IT DIRECTLY, NOT THROUGH vpaSelect. vpaSelect returns [] on ANY non-2xx, which reduces
     to a total of 0, which vpaSyncAccountQuantity reads as "nothing left to bill" and answers by
     setting cancel_at_period_end on the WHOLE subscription. So one transient database error while
     a venue cancelled one of its five could quietly end the entire account, report success, and
     surface only when every venue went dark at period end. A total is only trustworthy if the
     query is known to have succeeded, so this throws instead of guessing. */
  const res = await fetch(env.SUPABASE_URL + '/rest/v1/vp_venues?founding_id=eq.'
    + encodeURIComponent(foundingId) + '&select=max_players,pending_players,cancel_at_period_end',
    { headers: vpaHeaders(env) });
  if (!res.ok) throw new Error('vpbAccountTotal: could not read venues (' + res.status + ')');
  const vs = await res.json();
  if (!Array.isArray(vs)) throw new Error('vpbAccountTotal: unexpected response');
  return vs.reduce((n, v) => {
    if (v.cancel_at_period_end) return n; // venues cancelling at period end are no longer billed
    const billed = (v.pending_players != null) ? parseInt(v.pending_players, 10) : parseInt(v.max_players, 10);
    return n + (billed || 0);
  }, 0);
}

/* Point the Stripe subscription at what this account should actually be paying for.
 *
 * Shared by the owner cancelling their own venue and by HQ archiving one, because that is the
 * same money question asked by two different people and the two answers must not drift apart.
 * Archiving used to skip it entirely: the venue went dark, every game stopped, and the invoice
 * kept arriving every month for capacity nobody could use.
 *
 * Returns the subscription info so callers can still quote the period end date. */
async function vpaSyncAccountQuantity(env, foundingId, subId) {
  if (!subId) return null;
  const total = await vpbAccountTotal(env, foundingId);
  const info = await vpbSubItem(env, subId);
  // vpbSubItem returns {sub} with no itemId whenever the Stripe GET itself failed. Returning here
  // meant a Stripe outage during an archive reported clean: games stopped, nothing reached Stripe,
  // and the account kept paying for a dark venue for the rest of the period.
  if (!info) return { syncFailed: 'Could not reach Stripe' };
  if (!info.itemId) return Object.assign({}, info, { syncFailed: 'Stripe did not return the subscription' });
  /* vpbStripePost NEVER THROWS: it returns Stripe's error body. Leaving these unchecked meant a
     refusal was reported to HQ as done. The case that bites is a subscription Stripe has already
     cancelled (an archived venue whose period rolled over): every call 400s, and without this the
     venue came back live, running games, and never invoiced again. */
  let failed = null;
  /* Zero here now means zero, because vpbAccountTotal throws rather than returning 0 on a
     failed read. Cancelling a whole subscription is the most destructive thing this file does,
     so it must only ever follow a total we are certain of. */
  if (total <= 0) {
    // Nothing left to bill: end the whole subscription when the period rolls over.
    const r = await vpbStripePost(env, 'subscriptions/' + encodeURIComponent(subId), { cancel_at_period_end: 'true' });
    if (r && r.error) failed = r.error.message || 'Stripe refused the cancellation';
  } else {
    // Keep it live, clear any full-cancel flag, and bill for the venues that remain.
    const r1 = await vpbStripePost(env, 'subscriptions/' + encodeURIComponent(subId), { cancel_at_period_end: 'false' });
    if (r1 && r1.error) failed = r1.error.message || 'Stripe refused to reopen the subscription';
    const r2 = await vpbStripePost(env, 'subscription_items/' + encodeURIComponent(info.itemId),
      { quantity: Math.max(total, 1), proration_behavior: 'none' });
    if (r2 && r2.error) failed = r2.error.message || 'Stripe refused the quantity change';
  }
  // Return a NEW object rather than reassigning the const, and rather than mutating what
  // vpbSubItem handed us: callers read periodEnd off it and none of them expect it to change
  // shape underneath them.
  return failed ? Object.assign({}, info, { syncFailed: failed }) : info;
}

// Fetch the subscription's item id + price id (needed to change quantity).
async function vpbSubItem(env, subId) {
  if (!subId) return null;
  // discounts must be EXPANDED or Stripe returns bare id strings, and the removal path compares
  // held.coupon.id against ours: undefined every time, so the coupon was never taken off and the
  // venue kept the discount forever with the only row pointing at it deleted.
  const sub = await vpbStripeGet(env, 'subscriptions/' + encodeURIComponent(subId) + '?expand[]=default_payment_method&expand[]=discounts');
  if (!sub || sub.error || !sub.items || !sub.items.data || !sub.items.data[0]) return { sub: sub };
  const item = sub.items.data[0];
  const pm = sub.default_payment_method;
  return {
    sub: sub,
    itemId: item.id,
    priceId: item.price && item.price.id,
    quantity: item.quantity,
    periodEnd: sub.current_period_end || item.current_period_end, // moved under items in newer Stripe API
    last4: (pm && pm.card && pm.card.last4) || null,
    brand: (pm && pm.card && pm.card.brand) || null,
  };
}

/* --- POST /account/summary : the whole billing picture for the owner. --- */
async function vpbAccountSummary(request, env, json) {
  const o = await vpbRequireOwner(request, env);
  if (o.error) return json({ error: o.error }, o.status);

  const info = await vpbSubItem(env, o.account.stripe_subscription_id);
  const priceId = info && info.priceId;
  const rate = vpbRate(env, priceId, o.account.plan);

  const venues = o.venues.map((v) => {
    const players = parseInt(v.max_players, 10) || 0;
    const pending = (v.pending_players == null) ? null : (parseInt(v.pending_players, 10) || 0);
    return {
      id: v.id, name: v.name, players: players,
      pending: pending, monthly: '$' + (players * rate).toFixed(2),
      cancelling: !!v.cancel_at_period_end,
    };
  });
  const totalPlayers = venues.reduce((n, v) => n + v.players, 0);
  // What Stripe will actually bill next: the scheduled reduction where one is pending, else
  // capacity. On annual plans the renewal charge is the yearly figure, not the monthly one.
  const billedPlayers = venues.reduce((n, v) => v.cancelling ? n : n + ((v.pending != null) ? v.pending : v.players), 0);
  const annual = o.account.plan === 'annual';
  const chargeAmount = annual ? (billedPlayers * rate * 12) : (billedPlayers * rate);

  /* Credit held. Reducing a maximum on an annual plan does not refund; the unused value is banked
     as a NEGATIVE balance on the Stripe customer, which Stripe subtracts from the next invoice on
     its own. A venue had no way to see that it existed, so it looked like the money had simply
     gone. Stripe holds it in the smallest currency unit and negative means credit, so flip it. */
  let creditCents = 0;
  try {
    const custId = info && info.sub && info.sub.customer;
    if (custId) {
      const cust = await vpbStripeGet(env, 'customers/' + encodeURIComponent(custId));
      const bal = cust && typeof cust.balance === 'number' ? cust.balance : 0;
      if (bal < 0) creditCents = -bal;
    }
  } catch (e) { creditCents = 0; }   // never fail the whole page over a balance read

  return json({
    ok: true,
    plan: o.account.plan,
    is_group: o.account.is_group,
    rate: rate,
    venues: venues,
    total_players: totalPlayers,
    monthly_total: '$' + (totalPlayers * rate).toFixed(2),
    billing_period: annual ? 'year' : 'month',
    next_charge: info && info.periodEnd ? vpaFmtDate(info.periodEnd) : null,
    next_charge_amount: '$' + chargeAmount.toFixed(2),
    card_last4: (info && info.last4) || null,
    card_brand: (info && info.brand) || null,
    credit_cents: creditCents,
    credit: '$' + (creditCents / 100).toFixed(2),
    payment_reminders: o.account.payment_reminders !== false,
    is_owner: vpbIsOwner(o),
    perms: o.perms || null,
  });
}

/* --- POST /account/players : change ONE venue's max players. --- */

/* How much of an ANNUAL term is still ahead of us, 0..1. An annual venue has already paid for
   the whole year, so both the charge for adding players and the credit for giving them up are
   worth exactly the unused remainder. Derived from the renewal date alone (a 365 day term), so
   it does not depend on Stripe returning a period start. */
function vpbYearFractionLeft(info) {
  const end = info && info.periodEnd;
  if (!end) return null;
  const left = (end * 1000 - Date.now()) / (365 * 24 * 3600 * 1000);
  return Math.max(0, Math.min(1, left));
}

/* The single money move for a player-count change. `delta` is measured against what the account
   is CURRENTLY BILLED, not against max_players, which is what makes repeated changes compose:
   reduce then restore charges back exactly what it credited, so it cannot mint free credit.

   MONTHLY (unchanged): added players are charged one full month up front and the raised quantity
   carries them from the next invoice. A reduction needs no money move; the lowered quantity lands
   on the next invoice, which is the whole adjustment.

   ANNUAL: the year is already paid, so
     adding    -> charge the annual rate PRO RATA to the renewal date (what terms.html promises).
                  This used to charge a single month, so a venue that doubled in February ran the
                  extra players for the rest of the year almost free.
     reducing  -> no refund, but the unused value is BANKED as a credit on the Stripe customer,
                  which Stripe applies automatically to the next invoice. That is the annual perk:
                  players you stop using carry over to the following year instead of being lost. */
/* idemTag identifies the LOGICAL change (which venue, to what number, in which billing period),
   so a racing duplicate of the same change collapses into one charge while a genuine second
   change later in the period still goes through. */
async function vpbAdjustPlayerBilling(env, info, delta, planName, label, idemTag) {
  try {
    if (!delta || !info) return null;
    const customer = info.sub && info.sub.customer;
    if (!customer) return null;
    /* STILL IN THE FREE MONTH: charge nothing extra. The quantity change carries no proration, so
       the FIRST invoice already bills the raised number for that whole period. Adding an item on
       top billed the same players twice, and the Terms say plainly that nothing is charged before
       the first payment. A reduction during the trial has nothing to credit either. */
    const status = info.sub && info.sub.status;
    if (status === 'trialing') return null;
    // Strict here: this figure becomes an invoiceitem. If we cannot tell founding from standard,
    // refuse and let it be handled by hand rather than charge a rate we guessed.
    const rate = vpbRateStrict(env, info.priceId, planName);       // per player, per month
    if (rate == null) {
      console.log('[billing] rate unknown (no price id) for account ' + (info.sub && info.sub.id) + ': not charging');
      return { kind: 'failed', cents: 0, reason: 'rate_unknown' };
    }
    const annual = (planName === 'annual');
    const n = Math.abs(delta);
    const who = (label ? label + ': ' : '');
    const players = n + ' player' + (n === 1 ? '' : 's');

    if (!annual) {
      if (delta < 0) return null;                            // monthly reductions need no money move
      const cents = Math.round(rate * 100) * n;
      if (!(cents > 0)) return null;
      const mRes = await vpbStripePost(env, 'invoiceitems', {
        customer: customer, amount: cents, currency: 'aud',
        description: who + n + ' extra ' + (n === 1 ? 'player' : 'players') + ', full month',
      }, idemTag ? ('padd:' + idemTag) : null);
      // vpbStripePost never throws, so an unchecked call reported a Stripe refusal to the venue,
      // and to the audit trail, as money successfully charged.
      if (mRes && mRes.error) { console.log('[billing] monthly add FAILED: ' + (mRes.error.message || '')); return { kind: 'failed', cents: cents }; }
      return { kind: 'charge', cents: cents };
    }

    const frac = vpbYearFractionLeft(info);
    if (frac === null) return null;                          // no renewal date: do nothing rather than guess
    const cents = Math.round(n * rate * 12 * frac * 100);
    if (!(cents > 0)) return null;
    const months = Math.round(frac * 12 * 10) / 10;

    if (delta > 0) {
      const aRes = await vpbStripePost(env, 'invoiceitems', {
        customer: customer, amount: cents, currency: 'aud',
        description: who + players + ' added, pro rata to renewal (' + months + ' months)',
      }, idemTag ? ('padd:' + idemTag) : null);
      if (aRes && aRes.error) { console.log('[billing] annual pro rata FAILED: ' + (aRes.error.message || '')); return { kind: 'failed', cents: cents }; }
      return { kind: 'charge', cents: cents, months: months };
    }
    // Negative balance on a Stripe customer IS a credit; it is consumed by the next invoice.
    const cRes = await vpbStripePost(env, 'customers/' + encodeURIComponent(customer) + '/balance_transactions', {
      amount: -cents, currency: 'aud',
      description: who + players + ' released, credit carried to your next renewal (' + months + ' months)',
    });
    if (cRes && cRes.error) { console.log('[billing] credit FAILED: ' + (cRes.error.message || '')); return { kind: 'failed', cents: cents }; }
    return { kind: 'credit', cents: cents, months: months };
  } catch (_) { return null; /* the quantity change still governs ongoing billing */ }
}

async function vpbSetPlayers(request, env, json) {
  const o = await vpbRequireOwner(request, env);
  if (o.error) return json({ error: o.error }, o.status);
  { const g = vpbOwnerOnly(o, json); if (g) return g; }   // billing is owner-only

  const b = await request.json();
  const venueId = (b.venue_id || '').trim();
  const players = parseInt(b.players, 10);
  if (!players || players < 1) return json({ error: 'Enter a valid number of players.' }, 400);

  const venue = o.venues.filter((v) => v.id === venueId)[0];
  if (!venue) return json({ error: 'That venue is not on your account.' }, 403);

  const current = parseInt(venue.max_players, 10) || 0;
  const priorPending = (venue.pending_players == null) ? null : (parseInt(venue.pending_players, 10) || null);
  const foundingId = o.account.id;
  // What this account is billed for TODAY.
  const billedNow = (priorPending != null) ? priorPending : current;
  // THE BASIS a money move is measured from, and it is NOT the same on both plans.
  //   ANNUAL: measure from what they are billed, because a reduction BANKED A CREDIT. Restoring
  //           charges back exactly what was credited and the two net to zero.
  //   MONTHLY: measure from what they have PAID FOR this period (max_players), because a monthly
  //           reduction banks nothing at all: it just lowers the quantity for the next invoice.
  // Using the billed figure on monthly invented charges out of nothing. A venue that dropped
  // 100 to 50 and changed its mind was billed a full month for 50 players it had never lost,
  // and 100 to 50 to 120 charged a full month for 70 when only 20 were genuinely new.
  const annualPlan = o.account.plan === 'annual';
  const basis = annualPlan ? billedNow : current;

  if (players === current) {
    if (venue.pending_players == null) return json({ ok: true, unchanged: true });
    // Setting it back to current capacity cancels a scheduled reduction and restores billing.
    await vpaPatch(env, 'vp_venues', 'id=eq.' + encodeURIComponent(venueId), { pending_players: null });
    const restoredTotal = await vpbAccountTotal(env, foundingId);
    const rinfo = await vpbSubItem(env, o.account.stripe_subscription_id);
    if (rinfo && rinfo.itemId) {
      await vpbStripePost(env, 'subscription_items/' + encodeURIComponent(rinfo.itemId),
        { quantity: restoredTotal, proration_behavior: 'none' });
    }
    // Take back the credit the scheduled reduction banked. Without this, an annual venue could
    // reduce, pocket the credit, restore, and repeat.
    const rAdj = rinfo ? await vpbAdjustPlayerBilling(env, rinfo, current - basis, o.account.plan, venue.name,
      venueId + ':' + current + ':' + ((rinfo.sub && rinfo.sub.current_period_end) || '0')) : null;
    await vpaInsert(env, 'vp_admin_audit', {
      ...vpbActorFields(o), action: 'players_reduction_cancelled',
      target: 'venue:' + venueId, detail: { players: current, from_billed: billedNow, billing: rAdj, actor_user: o.authUserId },
    }, false).catch(() => {});
    return json({ ok: true, applied: 'cancelled_reduction', players: current });
  }

  if (players > current) {
    // INCREASE: grant capacity, then raise the Stripe quantity now (pro rata). If billing
    // cannot be updated, roll the capacity back so we never silently under-charge.
    await vpaPatch(env, 'vp_venues', 'id=eq.' + encodeURIComponent(venueId),
      { max_players: players, pending_players: null });
    const newTotal = await vpbAccountTotal(env, foundingId);
    const info = await vpbSubItem(env, o.account.stripe_subscription_id);
    if (!info || !info.itemId) {
      await vpaPatch(env, 'vp_venues', 'id=eq.' + encodeURIComponent(venueId), { max_players: current, pending_players: priorPending });
      return json({ error: 'Could not reach billing just now. Please try again.' }, 502);
    }
    const upd = await vpbStripePost(env, 'subscription_items/' + encodeURIComponent(info.itemId),
      { quantity: newTotal, proration_behavior: 'none' });
    if (upd && upd.error) {
      await vpaPatch(env, 'vp_venues', 'id=eq.' + encodeURIComponent(venueId), { max_players: current, pending_players: priorPending });
      return json({ error: 'Could not update billing just now. Please try again.' }, 502);
    }
    // Charge for the players they are actually gaining over what they are billed today. Using
    // players-current understated it whenever a reduction was already scheduled.
    const iAdj = await vpbAdjustPlayerBilling(env, info, players - basis, o.account.plan, venue.name,
      venueId + ':' + players + ':' + ((info.sub && info.sub.current_period_end) || '0'));
    await vpaInsert(env, 'vp_admin_audit', {
      ...vpbActorFields(o), action: 'players_increased',
      target: 'venue:' + venueId, detail: { from: current, to: players, from_billed: billedNow, new_total: newTotal, billing: iAdj, actor_user: o.authUserId },
    }, false).catch(() => {});
    return json({ ok: true, applied: 'now', players: players,
                  charge_failed: (iAdj && iAdj.kind === 'failed') ? true : false });
  }

  /* DECREASE. The two plans genuinely differ here, and conflating them was minting credit.
     MONTHLY: keep capacity (max_players) until renewal so they are never left short, and no
     mid-term refund. Lower the Stripe quantity NOW with proration_behavior 'none' so the
     reduction lands on the NEXT invoice. (Stripe bills in advance, so applying it only at
     invoice.paid would be one full cycle too late and overcharge them.)

     ANNUAL: the capacity has to go NOW, because the credit is paid out now. Keeping capacity
     until renewal while banking a pro-rata credit for "unused" players handed back money for
     players the venue carried on using all year. Worse, the payout shrank as the year ran down
     while the capacity never moved, so dropping 50 players in January and restoring them in
     November banked ten months of credit and gave up nothing: the restore only charged the two
     months left. That was free money on a timer, and it did not even need a loop.
     Releasing the capacity for real makes the credit honest. Give up 50 players in January, buy
     them back in November, and you keep the value of the ten months you actually did without. */
  await vpaPatch(env, 'vp_venues', 'id=eq.' + encodeURIComponent(venueId),
    annualPlan ? { max_players: players, pending_players: null } : { pending_players: players });
  const reducedTotal = await vpbAccountTotal(env, foundingId); // effective total (already reflects this pending)
  const dinfo = await vpbSubItem(env, o.account.stripe_subscription_id);
  if (dinfo && dinfo.itemId) {
    await vpbStripePost(env, 'subscription_items/' + encodeURIComponent(dinfo.itemId),
      { quantity: Math.max(reducedTotal, 1), proration_behavior: 'none' });
  }
  // Annual only: the year is already paid, so bank the unused value as a credit for next renewal
  // instead of letting it evaporate. Monthly returns null here (the lower quantity is the fix).
  const dAdj = dinfo ? await vpbAdjustPlayerBilling(env, dinfo, players - basis, o.account.plan, venue.name,
    venueId + ':' + players + ':' + ((dinfo.sub && dinfo.sub.current_period_end) || '0')) : null;
  await vpaInsert(env, 'vp_admin_audit', {
    ...vpbActorFields(o), action: 'players_reduction_scheduled',
    target: 'venue:' + venueId, detail: { from: current, to: players, from_billed: billedNow, billing: dAdj, actor_user: o.authUserId },
  }, false).catch(() => {});
  return json({ ok: true,
                credit_failed: (dAdj && dAdj.kind === 'failed') ? true : false,
                applied: annualPlan ? 'now' : 'next_renewal',
                players: annualPlan ? players : undefined,
                pending: annualPlan ? null : players,
                credit_cents: (dAdj && dAdj.kind === 'credit') ? dAdj.cents : 0 });
}

/* --- POST /account/add-venue : add a whole new venue to the account. --- */
async function vpbAddVenue(request, env, json) {
  const o = await vpbRequireOwner(request, env);
  if (o.error) return json({ error: o.error }, o.status);
  { const g = vpbOwnerOnly(o, json); if (g) return g; }   // adding venues is owner-only

  const b = await request.json();
  const name = (b.name || '').trim();
  const players = parseInt(b.players, 10);
  if (!name) return json({ error: 'Enter a venue name.' }, 400);
  if (!players || players < 1) return json({ error: 'Enter the max players for the new venue.' }, 400);
  // In-app venues are effectively unlimited for any real operator (larger than the biggest
  // Australian pub group). A high ceiling still guards against runaway/abuse.
  if (o.venues.length >= 500) {
    return json({ error: 'You have reached the online limit of 500 venues on one account. Email hello@venueplay.com.au and we will add more.' }, 400);
  }

  const foundingId = o.account.id;
  // This account bills through the founding record: venues link via founding_id, which is their
  // SINGLE billing parent. group_id stays null - setting BOTH founding_id and group_id violates
  // the vp_venues_one_billing_parent check. is_group on the founding row marks it as a group.
  if (!o.account.is_group) {
    await vpaPatch(env, 'venueplay_founding', 'id=eq.' + encodeURIComponent(foundingId), { is_group: true }).catch(() => {});
  }

  // Provision the new venue under the same account + owner login (idempotent by name).
  const r = await vpaProvisionOneVenue(env, {
    foundingId: foundingId, groupId: null, name: name, seats: players, postcode: (b.postcode || '').replace(/\D/g, '').slice(0, 4), authUserId: o.authUserId,
  });
  if (!r || !r.created) {
    // Idempotent-by-name matched an existing venue: nothing was added. Do not report success.
    return json({ error: 'You already have a venue with that name. Use a different name.' }, 409);
  }

  // Bump the subscription to the new total, pro rata.
  const newTotal = await vpbAccountTotal(env, foundingId);
  const info = await vpbSubItem(env, o.account.stripe_subscription_id);
  const upd = (info && info.itemId)
    ? await vpbStripePost(env, 'subscription_items/' + encodeURIComponent(info.itemId),
        { quantity: newTotal, proration_behavior: 'none' })
    : null;
  const billingOk = !!(info && info.itemId) && !(upd && upd.error);
  // A whole new venue is an increase like any other: one month on monthly, pro rata to the
  // renewal date on annual (it used to be charged a single month even on an annual account).
  const aAdj = billingOk ? await vpbAdjustPlayerBilling(env, info, players, o.account.plan, name,
    'newvenue:' + String(name || '').slice(0,40) + ':' + players + ':' + ((info.sub && info.sub.current_period_end) || '0')) : null;
  await vpaInsert(env, 'vp_admin_audit', {
    ...vpbActorFields(o),
    action: billingOk ? 'venue_added' : 'venue_added_billing_pending',
    target: 'venue:' + (r.venue && r.venue.id),
    detail: { name: name, players: players, new_total: newTotal, billing: aAdj, actor_user: o.authUserId },
  }, false).catch(() => {});

  return json({ ok: true, billing_synced: billingOk, venue: { id: r.venue && r.venue.id, name: name, slug: r.venue && r.venue.slug, players: players } });
}

/* --- POST /account/cancel-venue : schedule (or undo) a venue's cancellation. ---
   The venue keeps full access until the end of the paid period. We flag the venue,
   drop the subscription quantity to the remaining venues (proration 'none' => the
   credit lands at renewal), and if EVERY venue is now cancelling we end the whole
   subscription at period end. The webhook suspends flagged venues when the period
   actually rolls over. Sending { undo: true } reverses it while still in the period. */
async function vpbCancelVenue(request, env, json) {
  const o = await vpbRequireOwner(request, env);
  if (o.error) return json({ error: o.error }, o.status);
  { const g = vpbOwnerOnly(o, json); if (g) return g; }   // cancelling a venue is owner-only

  const b = await request.json();
  const venueId = (b.venue_id || '').trim();
  const undo = b.undo === true;
  const venue = o.venues.filter((v) => v.id === venueId)[0];
  if (!venue) return json({ error: 'That venue is not on your account.' }, 403);

  const foundingId = o.account.id;
  const venuePatch = { cancel_at_period_end: !undo };
  /* KEEP THIS VENUE must fully reinstate a venue that already tipped into suspended. The undo used to
     only clear cancel_at_period_end, so a venue whose paid period had already rolled over (status
     'suspended', because the webhook suspends a flagged venue at renewal) was un-cancelled on the
     billing side but left switched OFF, with no screen to turn it back on. That is exactly how a
     venue got stuck. Only ever reverses a CANCELLATION suspension, never a non-payment one: an unpaid
     venue must stay off until it is paid. */
  // Remember the exact prior state so a Stripe failure can be rolled back COMPLETELY, not partially.
  const priorRows = await vpaSelect(env, 'vp_venues',
    'id=eq.' + encodeURIComponent(venueId) + '&select=status,suspended_reason,cancel_at_period_end');
  const priorState = (priorRows && priorRows[0]) || null;
  if (undo && priorState && priorState.status === 'suspended' && priorState.suspended_reason !== 'nonpayment') {
    venuePatch.status = 'active';
    venuePatch.suspended_reason = null;
  }
  await vpaPatch(env, 'vp_venues', 'id=eq.' + encodeURIComponent(venueId), venuePatch);

  // Remaining billed total now EXCLUDES venues flagged to cancel (vpbAccountTotal skips them).
  // The credit for the removed players applies at renewal.
  const info = await vpaSyncAccountQuantity(env, foundingId, o.account.stripe_subscription_id);
  // Telling an owner "it stays live until 14 September and then stops billing" when Stripe refused
  // the change is a promise about their money that we have not kept.
  if (info && info.syncFailed) {
    // FULL rollback of everything we changed, not just cancel_at_period_end. Restoring only the flag
    // (as this used to) left an un-cancelled-then-reactivated venue at status='active' with
    // cancel_at_period_end=true: it ran games but was excluded from the billed quantity, i.e. free
    // games until the next renewal. Put every column back exactly as it was.
    const rollback = { cancel_at_period_end: priorState ? !!priorState.cancel_at_period_end : undo };
    if (venuePatch.status !== undefined && priorState) {
      rollback.status = priorState.status;
      rollback.suspended_reason = priorState.suspended_reason;
    }
    await vpaPatch(env, 'vp_venues', 'id=eq.' + encodeURIComponent(venueId), rollback);
    return json({ error: 'We could not update your billing just now, so nothing has changed. Please try again in a minute, or email hello@venueplay.com.au.' }, 502);
  }
  const endsDate = info && info.periodEnd ? vpaFmtDate(info.periodEnd) : null;
  await vpaInsert(env, 'vp_admin_audit', {
    ...vpbActorFields(o),
    action: undo ? 'venue_cancel_undone' : 'venue_cancel_scheduled',
    target: 'venue:' + venueId,
    detail: { name: venue.name, ends: endsDate, actor_user: o.authUserId },
  }, false).catch(() => {});

  return json({ ok: true, cancelling: !undo, ends: endsDate });
}

/* --- Venue screen (what shows on /tv?venue=<slug>): custom promo slides, the weekly
   members-draw schedule and the meat-raffle blurb. Editable from the Account page. --- */
function vpbScreenStr(s, n) { return String(s == null ? '' : s).replace(/[\x00-\x1f]+/g, ' ').slice(0, n).trim(); }
// Advertising slides are now uploaded IMAGES: {image_url, seconds, starts?, ends?}. The url
// must be one of our own storage URLs (set by /account/screen-upload) so nothing arbitrary can
// be pointed at the venue TV. seconds is clamped to 3..60; starts/ends are optional YYYY-MM-DD.
function vpbCleanSlides(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.slice(0, 12).map(function (s) {
    s = s || {};
    let secs = parseInt(s.seconds, 10); if (isNaN(secs) || secs < 3) secs = 7; if (secs > 60) secs = 60;
    const out = { image_url: vpbScreenStr(s.image_url, 500), seconds: secs };
    const ds = /^\d{4}-\d{2}-\d{2}$/;
    if (ds.test(String(s.starts || ''))) out.starts = String(s.starts);
    if (ds.test(String(s.ends || ''))) out.ends = String(s.ends);
    return out;
  }).filter(function (s) { return /^https:\/\//.test(s.image_url); });
}
// Decode standard base64 (data URL payload) to bytes. atob is available in the Workers runtime.
function vpaB64ToBytes(b64) {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}
// Create the public ad-image bucket if it does not exist yet (idempotent; ignores "already exists").
async function vpbEnsureBucket(env, id) {
  try {
    await fetch(env.SUPABASE_URL + '/storage/v1/bucket', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + env.SUPABASE_SERVICE_KEY, 'apikey': env.SUPABASE_SERVICE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: id, name: id, public: true, file_size_limit: 5242880, allowed_mime_types: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] }),
    });
  } catch (_) { /* if it already exists the POST 400s; the upload below still works */ }
}

/* --- POST /account/screen-upload : upload one advertising image to storage, return its URL. --- */
async function vpbScreenUpload(request, env, json) {
  const o = await vpbRequireOwner(request, env);
  if (o.error) return json({ error: o.error }, o.status);
  if (!vpbCan(o, 'advertising')) return json({ error: 'You do not have permission to change advertising.' }, 403);
  const b = await request.json();
  const venueId = (b.venue_id || '').trim();
  const venue = o.venues.filter(function (v) { return v.id === venueId; })[0];
  if (!venue) return json({ error: 'That venue is not on your account.' }, 403);

  const m = String(b.data || '').match(/^data:([^;]+);base64,(.+)$/);
  if (!m) return json({ error: 'That did not look like an image.' }, 400);
  const contentType = m[1].toLowerCase();
  if (!/^image\/(png|jpe?g|webp|gif)$/.test(contentType)) return json({ error: 'Use a PNG, JPG, WEBP or GIF.' }, 400);
  const bytes = vpaB64ToBytes(m[2]);
  if (bytes.length > 5 * 1024 * 1024) return json({ error: 'That image is too big. Keep it under 5MB.' }, 400);

  await vpbEnsureBucket(env, 'venue-ads');
  const ext = contentType.split('/')[1].replace('jpeg', 'jpg');
  const path = venueId + '/' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.' + ext;
  const up = await fetch(env.SUPABASE_URL + '/storage/v1/object/venue-ads/' + path, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + env.SUPABASE_SERVICE_KEY, 'apikey': env.SUPABASE_SERVICE_KEY, 'Content-Type': contentType, 'x-upsert': 'true' },
    body: bytes,
  });
  if (!up.ok) { const t = await up.text(); return json({ error: 'Upload failed. ' + t.slice(0, 160) }, 500); }
  return json({ ok: true, url: env.SUPABASE_URL + '/storage/v1/object/public/venue-ads/' + path });
}
function vpbCleanDraws(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.slice(0, 7).map(function (d) {
    d = d || {};
    return { day: vpbScreenStr(d.day, 20), jackpot: vpbScreenStr(d.jackpot, 20), time: vpbScreenStr(d.time, 20), tonight: !!d.tonight };
  }).filter(function (d) { return d.day; });
}
function vpbCleanRaffle(r) {
  // The raffle "routine" shown on the TV: what it's called, and the night/time it runs.
  if (!r || (!r.label && !r.day && !r.time)) return null;
  return { label: vpbScreenStr(r.label, 60), day: vpbScreenStr(r.day, 20), time: vpbScreenStr(r.time, 20) };
}

async function vpbScreenGet(request, env, json) {
  const o = await vpbRequireOwner(request, env);
  if (o.error) return json({ error: o.error }, o.status);
  const b = await request.json().catch(function () { return {}; });
  const venueId = (b.venue_id || '').trim() || (o.venues[0] && o.venues[0].id);
  const venue = o.venues.filter(function (v) { return v.id === venueId; })[0];
  if (!venue) return json({ error: 'That venue is not on your account.' }, 403);
  const rows = await vpaSelect(env, 'vp_venue_screen',
    'venue_id=eq.' + encodeURIComponent(venueId) + '&select=slides,draws,raffle,logo_url');
  const cfg = (rows && rows[0]) || {};
  return json({
    ok: true,
    venue: { id: venue.id, name: venue.name, slug: venue.slug },
    venues: o.venues.map(function (v) { return { id: v.id, name: v.name, slug: v.slug }; }),
    slides: cfg.slides || [], draws: cfg.draws || [], raffle: cfg.raffle || null, logo_url: cfg.logo_url || null,
  });
}

async function vpbScreenSave(request, env, json) {
  const o = await vpbRequireOwner(request, env);
  if (o.error) return json({ error: o.error }, o.status);
  const b = await request.json();
  const venueId = (b.venue_id || '').trim();
  const venue = o.venues.filter(function (v) { return v.id === venueId; })[0];
  if (!venue) return json({ error: 'That venue is not on your account.' }, 403);

  if (b.slides !== undefined && !vpbCan(o, 'advertising')) return json({ error: 'You do not have permission to change advertising.' }, 403);
  if (b.raffle !== undefined && !vpbCan(o, 'draws_raffles')) return json({ error: 'You do not have permission to change raffles.' }, 403);

  // Partial update: only the parts sent are changed. The advertising section sends slides;
  // the raffle section sends raffle. That way saving one never wipes the other.
  const row = { venue_id: venueId, slug: venue.slug, updated_at: new Date().toISOString() };
  if (b.slides !== undefined) row.slides = vpbCleanSlides(b.slides);
  if (b.draws !== undefined) row.draws = vpbCleanDraws(b.draws);
  if (b.raffle !== undefined) row.raffle = vpbCleanRaffle(b.raffle);
  if (b.logo_url !== undefined) row.logo_url = (typeof b.logo_url === 'string' && b.logo_url.slice(0, 4) === 'http') ? b.logo_url.slice(0, 500) : null;
  const res = await fetch(env.SUPABASE_URL + '/rest/v1/vp_venue_screen', {
    method: 'POST',
    headers: { ...vpaHeaders(env), 'Prefer': 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(row),
  });
  if (!res.ok) {
    const t = await res.text();
    return json({ error: 'Could not save your screen. ' + t.slice(0, 180) }, 500);
  }
  await vpaInsert(env, 'vp_admin_audit', {
    ...vpbActorFields(o), action: 'screen_updated', target: 'venue:' + venueId,
    detail: { slides: (row.slides || []).length, draws: (row.draws || []).length, raffle: !!row.raffle },
  }, false).catch(function () {});
  return json({ ok: true, slug: venue.slug });
}

/* --- POST /account/reminders : payment-reminder email opt-out. --- */
async function vpbSetReminders(request, env, json) {
  const o = await vpbRequireOwner(request, env);
  if (o.error) return json({ error: o.error }, o.status);
  { const g = vpbOwnerOnly(o, json); if (g) return g; }   // payment reminders are owner-only

  const b = await request.json();
  const enabled = !(b.enabled === false || b.enabled === 'false' || b.enabled === 0);
  await vpaPatch(env, 'venueplay_founding', 'id=eq.' + encodeURIComponent(o.account.id),
    { payment_reminders: enabled });
  return json({ ok: true, payment_reminders: enabled });
}

/* --- Webhook helper: apply scheduled reductions when an invoice is paid. --- */
async function vpbApplyPendingOnInvoice(env, invoice) {
  try {
    // Stripe's newer (Basil) API versions removed the top-level invoice.subscription field,
    // so resolve it defensively or scheduled reductions would silently never apply.
    const subId = invoice && (invoice.subscription
      || (invoice.parent && invoice.parent.subscription_details && invoice.parent.subscription_details.subscription)
      || (invoice.lines && invoice.lines.data && invoice.lines.data[0] && invoice.lines.data[0].subscription));
    if (!subId) return;
    const accts = await vpaSelect(env, 'venueplay_founding',
      'stripe_subscription_id=eq.' + encodeURIComponent(subId) + '&select=id');
    const acct = accts && accts[0];
    if (!acct) return;
    const venues = await vpaSelect(env, 'vp_venues',
      'founding_id=eq.' + encodeURIComponent(acct.id) + '&select=id,max_players,pending_players,cancel_at_period_end,status');
    let changed = false;
    for (const v of (venues || [])) {
      // A venue flagged to cancel has now reached the end of its paid period: suspend it
      // (the kill-switch stops games) but keep the row so it can be reactivated later.
      if (v.cancel_at_period_end && v.status !== 'suspended') {
        await vpaPatch(env, 'vp_venues', 'id=eq.' + encodeURIComponent(v.id), { status: 'suspended' });
        changed = true;
        continue;
      }
      if (v.pending_players != null) {
        await vpaPatch(env, 'vp_venues', 'id=eq.' + encodeURIComponent(v.id),
          { max_players: parseInt(v.pending_players, 10) || 0, pending_players: null });
        changed = true;
      }
    }
    // Always reconcile the Stripe quantity to the true billed total at each renewal. This
    // applies any scheduled reductions AND self-heals drift (e.g. an add-venue whose Stripe
    // sync failed), so no venue is ever left unbilled.
    const newTotal = await vpbAccountTotal(env, acct.id);
    const info = await vpbSubItem(env, subId);
    if (info && info.itemId && info.quantity !== newTotal) {
      await vpbStripePost(env, 'subscription_items/' + encodeURIComponent(info.itemId),
        { quantity: newTotal, proration_behavior: 'none' });
      await vpaInsert(env, 'vp_admin_audit', {
        actor_admin: null, actor_label: 'stripe', action: 'quantity_reconciled',
        target: 'account:' + acct.id, detail: { from: info.quantity, to: newTotal, had_reductions: changed },
      }, false).catch(() => {});
    }
  } catch (_) { /* best-effort; never fail the webhook */ }
}

/* ============================================================
   Group hosts. A "host" is a mobile granted access to one or more of the
   account's venues via vp_venue_staff rows (auth_user_id, venue_id). The owner
   manages them from the back end after signup; requireStaff already enforces
   per-venue access at game time, and /account/my-venues drives the sign-in
   venue picker. The owner is host of everything by default from provisioning.
   ============================================================ */

// List the hosts across this account's venues, grouped by login, plus the venue list.
/* --- POST /account/manager-add : add a manager (role manager + toggles) to venues. ---
   Managers are the layer above hosts, for group/multi-venue accounts: they run games and set
   up their venues (advertising, draws, raffles, players) per the owner's toggles, but never
   touch billing or the group-level settings. Toggles default ON. --- */
async function vpbAddManager(request, env, json) {
  const o = await vpbRequireOwner(request, env);
  if (o.error) return json({ error: o.error }, o.status);
  { const g = vpbOwnerOnly(o, json); if (g) return g; }   // only the owner manages managers
  const b = await request.json().catch(() => ({}));
  const label = String(b.label || '').trim().slice(0, 80);
  const mobile = vpaNormaliseMobileAU(b.mobile);
  if (!label) return json({ error: "Enter the manager's name." }, 400);
  if (!vpaIsAuMobileE164(mobile)) return json({ error: 'Enter a valid Australian mobile (04...). A manager signs in by text code.' }, 400);

  const accountVenueIds = new Set(o.venues.map((v) => v.id));
  const wanted = b.all_venues ? o.venues.map((v) => v.id)
               : (Array.isArray(b.venue_ids) ? b.venue_ids.filter((id) => accountVenueIds.has(id)) : []);
  if (!wanted.length) return json({ error: 'Pick at least one venue for this manager.' }, 400);

  const p = b.permissions || {};
  const permissions = {
    advertising: p.advertising !== false,
    draws_raffles: p.draws_raffles !== false,
    players_optin: p.players_optin !== false,
    add_hosts: p.add_hosts !== false,
  };

  let authUserId = null;
  try {
    const u = await vpaAuthCreateUser(env, { phone: mobile, phone_confirm: true, user_metadata: { label: label } });
    authUserId = u && u.id;
  } catch (e) {
    if (e && e.alreadyExists) { const found = await vpaFindAuthUser(env, { phone: mobile }); authUserId = found && found.id; }
    else return json({ error: 'Could not set up that manager login. Check the mobile and try again.' }, 502);
  }
  if (!authUserId) return json({ error: 'Could not resolve the manager login.' }, 502);

  const existing = await vpaSelect(env, 'vp_venue_staff',
    'auth_user_id=eq.' + encodeURIComponent(authUserId) + '&venue_id=in.(' + wanted.map(encodeURIComponent).join(',') + ')&select=venue_id');
  const have = new Set((existing || []).map((r) => r.venue_id));
  for (const vid of wanted) {
    if (have.has(vid)) {
      // display_name, NOT label: vp_venue_staff has no label column, so both of these calls
      // threw and "Add manager" failed outright. Everything else in the codebase
      // (vp-session.js, the venue-creation inserts) already uses display_name.
      await vpaPatch(env, 'vp_venue_staff', 'auth_user_id=eq.' + encodeURIComponent(authUserId) + '&venue_id=eq.' + encodeURIComponent(vid), { role: 'manager', permissions: permissions, display_name: label || 'Manager' });
    } else {
      await vpaInsert(env, 'vp_venue_staff', { venue_id: vid, auth_user_id: authUserId, role: 'manager', display_name: label || 'Manager', permissions: permissions }, false);
    }
  }
  await vpaInsert(env, 'vp_admin_audit', { ...vpbActorFields(o), action: 'manager_added', target: 'manager:' + authUserId, detail: { label: label, venues: wanted.length } }, false).catch(() => {});
  await vpaStaffWelcome(env, o, wanted, mobile, true);   // manager
  return json({ ok: true, auth_user_id: authUserId, venue_ids: wanted });
}

/* One venue, one TV link. Across several, the console is the right starting point. */
async function vpaStaffWelcome(env, o, venueIds, mobile, isManager) {
  const only = (venueIds && venueIds.length === 1)
    ? o.venues.filter((v) => v.id === venueIds[0])[0] : null;
  await vpaSendStaffWelcomeSms(env, mobile, {
    venueName: only ? only.name : ((o.venues[0] && o.venues[0].name) || 'Your venue'),
    slug: only ? only.slug : '',
    isManager: isManager,
  });
}

/* --- POST /account/optin-export : CSV of marketing opt-ins, STRICTLY the caller's own venues.
   Returns { csv }. The page turns it into a download. Scoping is server-side: venue_id is
   filtered to o.venues only (resolved from the login), never from anything the browser sends,
   so an owner can never pull another venue's or account's contacts. --- */
function vpbCsvCell(v) { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
async function vpbOptinExport(request, env, json) {
  const o = await vpbRequireOwner(request, env);
  if (o.error) return json({ error: o.error }, o.status);
  if (!vpbCan(o, 'players_optin')) return json({ error: 'You do not have permission to export opt-in data.' }, 403);
  // Customer data belongs to the venue. An account whose venue names read like a real venue can
  // export freely; anything else is held until an admin approves (optin_release_approved), so a
  // third party can't quietly take a venue's customer list.
  const VENUE_RE = /\b(hotel|tavern|rsl|club|pub|bowls|bowlo|bowling|leagues|sports|surf|golf|services|inn|arms)\b/i;
  const looksLikeVenue = o.venues.some((v) => VENUE_RE.test(v.name || ''));
  let approved = false;
  try {
    const ar = await vpaSelect(env, 'venueplay_founding', 'id=eq.' + encodeURIComponent(o.account.id) + '&select=optin_release_approved');
    approved = !!(ar && ar[0] && ar[0].optin_release_approved);
  } catch (_) { /* column may not exist yet (migration 20) */ }
  if (!looksLikeVenue && !approved) {
    return json({ error: 'Opt-in downloads for this account are pending a quick review, this protects venue customer data. We approve within a business day, or email hello@venueplay.com.au.', pending: true }, 403);
  }
  const venueIds = o.venues.map((v) => v.id);
  const vname = {}; o.venues.forEach((v) => { vname[v.id] = v.name; });
  const header = ['Venue', 'First name', 'Last name', 'Email', 'Mobile', 'Postcode', 'Opted in'];
  let out = [];
  if (venueIds.length) {
    // v_vp_player_optins is worker-only (service key); filter to OWN venues, never client input.
    const rows = await vpaSelect(env, 'v_vp_player_optins',
      'venue_id=in.(' + venueIds.map(encodeURIComponent).join(',') +
      ')&select=venue_id,first_name,last_name,email,mobile,postcode,opted_in_at&order=opted_in_at.desc');
    const seen = {};
    for (const r of (rows || [])) {
      const key = String(r.email || r.mobile || ((r.first_name || '') + '|' + (r.last_name || ''))).toLowerCase();
      if (seen[key]) continue; seen[key] = true;
      out.push([vname[r.venue_id] || '', r.first_name, r.last_name, r.email, r.mobile, r.postcode, r.opted_in_at]);
    }
  }
  const csv = [header].concat(out).map((cols) => cols.map(vpbCsvCell).join(',')).join('\n') + '\n';
  await vpaInsert(env, 'vp_admin_audit', { ...vpbActorFields(o), action: 'optin_exported', target: 'account:' + o.account.id, detail: { rows: out.length } }, false).catch(() => {});
  return json({ ok: true, csv: csv, count: out.length });
}

/* --- POST /account/managers : list the account's managers (role manager) with their toggles. --- */
async function vpbListManagers(request, env, json) {
  const o = await vpbRequireOwner(request, env);
  if (o.error) return json({ error: o.error }, o.status);
  { const g = vpbOwnerOnly(o, json); if (g) return g; }
  const venueIds = o.venues.map((v) => v.id);
  if (!venueIds.length) return json({ managers: [], venues: [] });
  const staff = await vpaSelect(env, 'vp_venue_staff',
    'venue_id=in.(' + venueIds.map(encodeURIComponent).join(',') + ')&role=eq.manager&select=auth_user_id,venue_id,display_name,permissions');
  const byUser = {};
  for (const s of (staff || [])) {
    if (s.auth_user_id === o.authUserId) continue; // never list the owner as a manager
    if (!byUser[s.auth_user_id]) byUser[s.auth_user_id] = { auth_user_id: s.auth_user_id, label: s.display_name || '', venue_ids: [], permissions: s.permissions || null };
    byUser[s.auth_user_id].venue_ids.push(s.venue_id);
    if (s.permissions && !byUser[s.auth_user_id].permissions) byUser[s.auth_user_id].permissions = s.permissions;
  }
  return json({ managers: Object.keys(byUser).map((k) => byUser[k]), venues: o.venues.map((v) => ({ id: v.id, name: v.name })) });
}

async function vpbListHosts(request, env, json) {
  const o = await vpbRequireOwner(request, env);
  if (o.error) return json({ error: o.error }, o.status);
  const venueIds = o.venues.map((v) => v.id);
  if (!venueIds.length) return json({ hosts: [], venues: [] });
  const staff = await vpaSelect(env, 'vp_venue_staff',
    'venue_id=in.(' + venueIds.map(encodeURIComponent).join(',') + ')&select=auth_user_id,venue_id,role,display_name');
  const byUser = {};
  for (const s of (staff || [])) {
    if (!byUser[s.auth_user_id]) byUser[s.auth_user_id] = { auth_user_id: s.auth_user_id, label: s.display_name || '', venue_ids: [], is_owner: false };
    byUser[s.auth_user_id].venue_ids.push(s.venue_id);
    if (s.role === 'owner') byUser[s.auth_user_id].is_owner = true;
    if (s.display_name && !byUser[s.auth_user_id].label) byUser[s.auth_user_id].label = s.display_name;
  }
  if (byUser[o.authUserId]) byUser[o.authUserId].is_owner = true;
  return json({
    hosts: Object.keys(byUser).map((k) => byUser[k]),
    venues: o.venues.map((v) => ({ id: v.id, name: v.name })),
  });
}

// Add (or extend) a host: { mobile, label?, venue_ids?[], all_venues? }.
/* Text a new host or manager so they know they have been set up.
   Nothing was sent to them at all: their login and access were created and the owner was left to
   explain the app over the phone. They sign in with a code to this number and have no email on
   file, so a text is the only channel that reaches them.

   Kept SHORT on purpose. Mobile Message bills per segment at 160 characters, so a chatty message
   costs double for no benefit. Same provider and the same credentials as the sign-in codes.

   Best-effort in every direction: the staff row is already written by the time this runs, so a
   texting failure must never fail the request or lose someone their access. */
async function vpaSendStaffWelcomeSms(env, mobile, opts) {   // opts.isManager is accepted but not used in the wording
  try {
    if (!env.MOBILEMESSAGE_USERNAME || !env.MOBILEMESSAGE_PASSWORD || !mobile) return;
    // Drop the www as well as the scheme. SITE_URL carries it, that is 8 characters twice, and
    // it was enough on its own to push a normal venue over 160 and into a second segment. The
    // TV lobby already shows players the apex, so this is the address the room sees anyway.
    const site = (env.SITE_URL || 'https://venueplay.com.au')
      .replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '');
    const venue = String((opts && opts.venueName) || 'Your venue').slice(0, 24);
    const slug = (opts && opts.slug) || '';
    // The TV link only makes sense for ONE venue. Someone added across several gets the sign-in
    // link and finds their screens from the console rather than a wrong guess.
    const tv = slug ? (' TV URL: ' + site + '/tv?venue=' + slug) : '';
    // Nothing about manager vs host here: they will see what they can do the moment they sign in,
    // and the words would mean nothing to them before then.
    const message =
      venue + ' has set you up on VenuePlay. To sign in visit ' + site + '/app.' + tv;
    const basicAuth = 'Basic ' + btoa(env.MOBILEMESSAGE_USERNAME + ':' + env.MOBILEMESSAGE_PASSWORD);
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 10000);
    try {
      await fetch('https://api.mobilemessage.com.au/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: basicAuth },
        body: JSON.stringify({
          messages: [{
            to: mobile,
            message: message,
            sender: env.SMS_SENDER || 'VenuePlay',
            custom_ref: 'staff-welcome',
          }],
        }),
        signal: abort.signal,
      });
    } finally { clearTimeout(timer); }
  } catch (_) { /* never fail adding someone because a text did not go out */ }
}

async function vpbAddHost(request, env, json) {
  const o = await vpbRequireOwner(request, env);
  if (o.error) return json({ error: o.error }, o.status);
  if (!vpbCan(o, 'add_hosts')) return json({ error: 'You do not have permission to add hosts.' }, 403);
  const b = await request.json().catch(() => ({}));
  const label = String(b.label || '').trim().slice(0, 80);
  const mobile = vpaNormaliseMobileAU(b.mobile);
  if (!vpaIsAuMobileE164(mobile)) return json({ error: 'Enter a valid Australian mobile (04...). A host signs in by text code.' }, 400);

  const accountVenueIds = new Set(o.venues.map((v) => v.id));
  let wanted = b.all_venues ? o.venues.map((v) => v.id)
             : (Array.isArray(b.venue_ids) ? b.venue_ids.filter((id) => accountVenueIds.has(id)) : []);
  if (!wanted.length) return json({ error: 'Pick at least one venue for this host.' }, 400);

  let authUserId = null;
  try {
    const u = await vpaAuthCreateUser(env, { phone: mobile, phone_confirm: true, user_metadata: { label: label } });
    authUserId = u && u.id;
  } catch (e) {
    if (e && e.alreadyExists) {
      const found = await vpaFindAuthUser(env, { phone: mobile });
      authUserId = found && found.id;
    } else {
      return json({ error: 'Could not set up that host login. Check the mobile and try again.' }, 502);
    }
  }
  if (!authUserId) return json({ error: 'Could not resolve the host login.' }, 502);

  const existing = await vpaSelect(env, 'vp_venue_staff',
    'auth_user_id=eq.' + encodeURIComponent(authUserId) +
    '&venue_id=in.(' + wanted.map(encodeURIComponent).join(',') + ')&select=venue_id');
  const have = new Set((existing || []).map((r) => r.venue_id));
  for (const vid of wanted) {
    if (have.has(vid)) continue;
    // ROLE 'host', not 'manager'. This inserted a manager row, and a manager row with no
    // permissions object means FULL ACCESS everywhere: vpbCan returns true for every key when
    // perms is null, and vpbOwnerOnly only blocks when perms is SET. So every person added with
    // the Add host button could open the billing page, change the player count the venue pays
    // for, add and remove other hosts, and edit settings, the members list and draw jackpots.
    // A host runs the games. That is the whole job.
    await vpaInsert(env, 'vp_venue_staff', { venue_id: vid, auth_user_id: authUserId, role: 'host', display_name: label || 'Host' }, false);
  }
  await vpaStaffWelcome(env, o, wanted, mobile, false);   // host
  return json({ ok: true, auth_user_id: authUserId, venue_ids: wanted });
}

// Remove a host's access: { auth_user_id, venue_ids?[], all_venues? }. Never the owner.
/* The owner's own staff row is written as role 'manager' by provisioning, so a `role=neq.owner`
   filter does not protect them. A manager could open the Account page and remove the row labelled
   "<venue> manager", which is the OWNER, at every venue on the account. The owner then fails
   vpbRequireOwner entirely: no billing page, no account page, locked out of their own product with
   no audit row to explain it and no self-serve way back. Removing people is owner-only now, and
   nobody can remove the login that pays the bill. */
async function vpbRemoveHost(request, env, json) {
  const o = await vpbRequireOwner(request, env);
  if (o.error) return json({ error: o.error }, o.status);
  { const g = vpbOwnerOnly(o, json); if (g) return g; }   // a restricted manager cannot remove anyone
  const b = await request.json().catch(() => ({}));
  const target = String(b.auth_user_id || '').trim();
  if (!target) return json({ error: 'Missing host.' }, 400);
  if (target === o.authUserId) return json({ error: 'You cannot remove your own access.' }, 400);

  /* And never remove another FULL-ACCESS login. perms === null is what makes somebody an owner
     here, and the account owner's own staff row is stored with role 'manager', so a role filter
     reads them as ordinary staff. Without this, the person who pays the bill can be deleted from
     their own account. */
  const targetRows = await vpaSelect(env, 'vp_venue_staff',
    'auth_user_id=eq.' + encodeURIComponent(target) +
    '&venue_id=in.(' + o.venues.map((v) => encodeURIComponent(v.id)).join(',') + ')' +
    '&select=role,permissions');
  const targetIsFullAccess = (targetRows || []).some((r) => (r.role === 'owner') || !r.permissions);
  if (targetIsFullAccess) {
    return json({ error: 'That login has full access to this account, so it cannot be removed here. Email hello@venueplay.com.au if you need it changed.' }, 403);
  }

  const accountVenueIds = o.venues.map((v) => v.id);
  let venueIds = (!b.all_venues && Array.isArray(b.venue_ids))
    ? b.venue_ids.filter((id) => accountVenueIds.indexOf(id) !== -1)
    : accountVenueIds;
  if (!venueIds.length) venueIds = accountVenueIds;
  for (const vid of venueIds) {
    await vpaDelete(env, 'vp_venue_staff',
      'auth_user_id=eq.' + encodeURIComponent(target) + '&venue_id=eq.' + encodeURIComponent(vid) + '&role=neq.owner');
  }
  return json({ ok: true });
}

/* --- POST /account/staff-set-venues : change which venues an EXISTING host/manager can access. ---
 * body { auth_user_id, venue_ids?[], all_venues? }
 * Makes the person's venue set exactly match the request: adds a staff row for each newly chosen
 * venue (carrying their existing role + permissions + name) and deletes the row for each venue they
 * were de-selected from. Owner-only; never edits the owner or another full-access login; only ever
 * touches venues on this account. This is what makes a host/manager's venues editable after they are
 * added, instead of remove-and-re-add. */
async function vpbSetStaffVenues(request, env, json) {
  const o = await vpbRequireOwner(request, env);
  if (o.error) return json({ error: o.error }, o.status);
  { const g = vpbOwnerOnly(o, json); if (g) return g; }   // a restricted manager cannot reassign anyone
  const b = await request.json().catch(() => ({}));
  const target = String(b.auth_user_id || '').trim();
  if (!target) return json({ error: 'Missing host.' }, 400);
  if (target === o.authUserId) return json({ error: 'You cannot change your own venues here.' }, 400);

  const accountVenueIds = o.venues.map((v) => v.id);
  const accountSet = new Set(accountVenueIds);

  // Their current rows across the account: role, permissions and name are carried onto any new row.
  const currentRows = await vpaSelect(env, 'vp_venue_staff',
    'auth_user_id=eq.' + encodeURIComponent(target) +
    '&venue_id=in.(' + accountVenueIds.map(encodeURIComponent).join(',') + ')' +
    '&select=venue_id,role,permissions,display_name');
  if (!currentRows || !currentRows.length) {
    return json({ error: 'That person is not set up on this account yet. Add them first.' }, 404);
  }
  // Never reassign the owner's own login (stored as role 'owner' on at least one venue).
  const ownerLike = currentRows.some((r) => r.role === 'owner');
  if (ownerLike) return json({ error: 'That login has full access and cannot be reassigned here.' }, 403);

  const role = currentRows[0].role || 'host';
  const perms = currentRows[0].permissions || null;
  const name = currentRows[0].display_name || (role === 'manager' ? 'Manager' : 'Host');

  let wanted = b.all_venues ? accountVenueIds.slice()
             : (Array.isArray(b.venue_ids) ? b.venue_ids.filter((id) => accountSet.has(id)) : []);
  wanted = Array.from(new Set(wanted));
  if (!wanted.length) return json({ error: 'Pick at least one venue, or use Remove to take away all access.' }, 400);

  const haveSet = new Set(currentRows.map((r) => r.venue_id));
  const wantSet = new Set(wanted);

  // Add rows for newly chosen venues, carrying the same role/permissions/name.
  for (const vid of wanted) {
    if (haveSet.has(vid)) continue;
    const row = { venue_id: vid, auth_user_id: target, role: role, display_name: name };
    if (role === 'manager') row.permissions = perms;
    await vpaInsert(env, 'vp_venue_staff', row, false);
  }
  // Remove rows for venues they were de-selected from (never an owner row).
  for (const r of currentRows) {
    if (wantSet.has(r.venue_id)) continue;
    await vpaDelete(env, 'vp_venue_staff',
      'auth_user_id=eq.' + encodeURIComponent(target) + '&venue_id=eq.' + encodeURIComponent(r.venue_id) + '&role=neq.owner');
  }
  return json({ ok: true, auth_user_id: target, venue_ids: wanted });
}

// The signed-in host's venues, for the sign-in venue picker (any staff role).
async function vpbMyVenues(request, env, json) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  const payload = token ? await vpaVerifyJWT(token, env.SUPABASE_JWT_SECRET, env) : null;
  if (!payload || !payload.sub) return json({ error: 'Not signed in.' }, 401);
  const staff = await vpaSelect(env, 'vp_venue_staff',
    'auth_user_id=eq.' + encodeURIComponent(payload.sub) + '&select=venue_id');
  if (!staff || !staff.length) {
    // A Gflam HQ admin is staff nowhere, but must be able to pick any venue to view as.
    const admins = await vpaSelect(env, 'vp_platform_admins',
      'auth_user_id=eq.' + encodeURIComponent(payload.sub) + '&select=auth_user_id');
    if (admins && admins.length) {
      const all = await vpaSelect(env, 'vp_venues', 'select=id,name,slug&order=name.asc');
      return json({ venues: all || [] });
    }
    return json({ venues: [] });
  }
  const ids = staff.map((s) => s.venue_id);
  const venues = await vpaSelect(env, 'vp_venues',
    'id=in.(' + ids.map(encodeURIComponent).join(',') + ')&select=id,name,slug&order=name.asc');
  return json({ venues: venues || [] });
}
