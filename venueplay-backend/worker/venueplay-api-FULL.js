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
 *   API_ORIGIN                  (optional) this Worker's address in emails; https://api.venueplay.com.au
 *                               when unset, and only ever a venueplay.com.au API host (vpUnsubApi)
 * ----------------------------------------------------------------------------
 */
const BUILD = '31 Oct 2026, 12:20 · 0656dfc7';   // tools/stamp-workers.py, do not edit by hand
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
    /* PARTYPLAY'S HELP FORMS post here too (one help desk for both brands, 19 Oct 2026). Its
       origins are reflected for /help/ routes ONLY: nothing else in this Worker is PartyPlay's. */
    const helpPath = /^\/help\//.test(new URL(request.url).pathname);
    const ppOk = helpPath && /^https:\/\/([a-z0-9-]+\.)?partyplay\.com\.au$/.test(reqOrigin);
    const origin = (originOk || ppOk) ? reqOrigin : (allowList[0] || CANONICAL);
    const cors = {
      'Access-Control-Allow-Origin': origin,
      'Vary': 'Origin',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Stripe-Signature, Authorization, X-VP-Venue',
    };
    const json = (obj, status = 200) =>
      new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...cors } });

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '');

    try {
      /* HEALTH. Same reasoning as the game Worker: this one had none either, and
         a missing secret here is silent until somebody tries to pay or a Stripe
         webhook arrives and cannot be verified. Names and booleans only, never a
         value, because this endpoint is public. */
      if (request.method === 'GET' && path === '/health') {
        // Without these nothing works at all.
        const need = ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET',
                      'SUPABASE_URL', 'SUPABASE_SERVICE_KEY',
                      'STRIPE_PRICE_MONTHLY', 'STRIPE_PRICE_ANNUAL'];
        const missing = need.filter((k) => !env[k]);
        /* And these fail QUIETLY, which is worse. No SMS credentials and venue
           staff simply never receive their sign-in code, with nothing on screen
           to say why. No email key and welcome and invoice emails stop going out.
           Reported separately because the Worker does still run without them. */
        const can = {
          sms:   !!(env.MOBILEMESSAGE_USERNAME && env.MOBILEMESSAGE_PASSWORD),
          email: !!env.RESEND_API_KEY,
          cardLinks: !!env.CARD_LINK_SECRET,
          /* 26 Oct 2026: without VP_UNSUB_SECRET every marketing email's unsubscribe link is
             refused and the HQ win-back will not send at all (it checks before it sends). */
          unsubscribe: !!env.VP_UNSUB_SECRET
        };
        const quiet = Object.keys(can).filter((k) => !can[k]);
        return json({
          worker: 'venueplay-api',
          build: BUILD,
          ok: !missing.length && !quiet.length,
          missing,
          can,
          warning: quiet.length
            ? 'These are not set and fail silently: ' + quiet.join(', ') +
              '. No sms means staff never get their sign-in code.'
            : undefined
        }, missing.length ? 503 : 200);
      }

      /* Linked from every VenuePlay MARKETING email (the HQ win-back today). Public on purpose:
         the signed token in the link is the only thing that proves it is that person. */
      if (path === '/unsubscribe' && (request.method === 'GET' || request.method === 'POST')) {
        return await vpHandleUnsubscribe(request, env, url);
      }

      /* IS THIS FOUNDING WINDOW STILL OPEN?
         Public, and it answers with a yes or a no and nothing else.

         The state pages are static HTML with a code baked into them, and the
         Worker decides the price from FOUNDING_CODES. Those two can disagree, and
         when they do the page keeps promising $2.50 while the venue is charged
         $3.00, with nothing on screen to explain it. That has happened before:
         this Worker's own comments describe a venue seeing the founding price on
         /qld or /vic and being charged standard "with no error and no
         explanation".

         So the page asks, on load, and tells the truth either way. Closing a
         window becomes one edit to an environment variable, and every page that
         depends on it corrects itself. */
      if (request.method === 'GET' && path === '/founding') {
        const want = (url.searchParams.get('code') || '').trim().toUpperCase();
        const live = vpaLiveCodes(env);   // listed AND inside its month
        return json({ code: want, open: want !== '' && live.indexOf(want) !== -1 },
                    200, { 'cache-control': 'public, max-age=300' });
      }

      /* THE HOMEPAGE "TRUSTED BY" STRIP. Public, read-only, names and logo addresses of live,
         paying, willing venues and nothing else. See vpbTrustedLogos. */
      if (request.method === 'GET' && path === '/trusted-logos') return await vpbTrustedLogosRoute(env, json);

      if (request.method === 'POST' && path === '/checkout') return await handleCheckout(request, env, json);
      // Followed from an HQ-onboarded venue's welcome email, in a browser, so it answers with a
      // redirect rather than JSON. Signed, and it mints a fresh Checkout each time it is clicked.
      if (request.method === 'GET'  && path === '/add-card' && typeof vpaAddCardRedirect === 'function') return await vpaAddCardRedirect(request, env);
      if (request.method === 'POST' && path === '/contact')  return await handleContact(request, env, json);
      // "Open your VenuePlay" in the prospect welcome (Dean, 28 Oct 2026; migration 123). Public, rate-limited, one use.
      if (request.method === 'POST' && path === '/auth/one-click' && typeof vpaHandleOneClick === 'function') return await vpaHandleOneClick(request, env, json);
      // A used or expired link asks for a new one (Dean, 29 Oct 2026). Public, rate-limited, says the same thing whoever asks.
      if (request.method === 'POST' && path === '/auth/one-click/resend' && typeof vpaHandleOneClickResend === 'function') return await vpaHandleOneClickResend(request, env, json);
      // The help desk (migration 106). Submit-only routes for the public and venue staff; every
      // route that READS a ticket is /admin/help/ and HQ only. See helpAdmin.
      if (request.method === 'POST' && path === '/help/ticket')            return await helpPublicTicket(request, env, json);
      if (request.method === 'POST' && path === '/help/venue/ticket')      return await helpVenueTicket(request, env, json);
      // "Got it: <venue>" on the public forms (29 Oct 2026). Public, rate-limited, answers a venue NAME or nothing.
      if (request.method === 'POST' && path === '/help/venue-match')       return await helpVenueMatchRoute(request, env, json);
      if (request.method === 'POST' && path === '/help/push/peek')         return await helpPushPeek(request, env, json);
      if (request.method === 'GET'  && path === '/help/content')           return await helpPublicContent(request, env, json);
      if (request.method === 'GET'  && path === '/help/config')            return json({ turnstile: env.TURNSTILE_SITEKEY || null });
      if (request.method === 'POST' && path === '/admin/help/contact')      return await helpAdminContactConfirm(request, env, json);
      if (request.method === 'POST' && path === '/help/triage')            return await helpTriageEvent(request, env, json);
      if (request.method === 'POST' && path === '/admin/help/content/get')  return await helpAdminContentGet(request, env, json);
      if (request.method === 'POST' && path === '/admin/help/content/save') return await helpAdminContentSave(request, env, json);
      if (request.method === 'POST' && path === '/admin/help/content/move') return await helpAdminContentMove(request, env, json);
      if (request.method === 'POST' && path === '/admin/help/reorder/undo') return await helpAdminReorderUndo(request, env, json);
      if (request.method === 'POST' && path === '/admin/help/list')        return await helpAdminList(request, env, json);
      if (request.method === 'POST' && path === '/admin/help/count')       return await helpAdminCount(request, env, json);
      if (request.method === 'POST' && path === '/admin/help/get')         return await helpAdminGet(request, env, json);
      if (request.method === 'POST' && path === '/admin/help/update')      return await helpAdminUpdate(request, env, json);
      if (request.method === 'POST' && path === '/admin/help/note')        return await helpAdminNote(request, env, json);
      if (request.method === 'POST' && path === '/admin/help/reply')       return await helpAdminReply(request, env, json);
      if (request.method === 'POST' && path === '/admin/help/log-call')    return await helpAdminLogCall(request, env, json);
      // Saved replies (Dean, 29 Oct 2026; migration 126). HQ only, like every /admin/help/ route.
      if (request.method === 'POST' && path === '/admin/help/replies/list')   return await helpAdminRepliesList(request, env, json);
      if (request.method === 'POST' && path === '/admin/help/replies/save')   return await helpAdminRepliesSave(request, env, json);
      if (request.method === 'POST' && path === '/admin/help/replies/delete') return await helpAdminRepliesDelete(request, env, json);
      if (request.method === 'POST' && path === '/admin/help/replies/move')   return await helpAdminRepliesMove(request, env, json);
      if (request.method === 'POST' && path === '/admin/help/report')      return await helpAdminReport(request, env, json);
      if (request.method === 'POST' && path === '/admin/help/push/key')    return await helpAdminPushKey(request, env, json);
      if (request.method === 'POST' && path === '/admin/help/push/subscribe')   return await helpAdminPushSubscribe(request, env, json);
      if (request.method === 'POST' && path === '/admin/help/push/unsubscribe') return await helpAdminPushUnsubscribe(request, env, json);
      if (request.method === 'POST' && path === '/webhook')  return await handleWebhook(request, env, cors);
      // Owner self-serve billing (vpb* functions pasted in from venueplay-api-account.js).
      if (request.method === 'POST' && path === '/account/summary'   && typeof vpbAccountSummary === 'function') return await vpbAccountSummary(request, env, json);
      if (request.method === 'POST' && path === '/account/players'   && typeof vpbSetPlayers === 'function')     return await vpbSetPlayers(request, env, json);
      if (request.method === 'POST' && path === '/account/add-venue' && typeof vpbAddVenue === 'function')       return await vpbAddVenue(request, env, json);
      if (request.method === 'POST' && path === '/account/reminders' && typeof vpbSetReminders === 'function')   return await vpbSetReminders(request, env, json);
      if (request.method === 'POST' && path === '/account/portal'    && typeof vpbBillingPortal === 'function')  return await vpbBillingPortal(request, env, json);
      if (request.method === 'POST' && path === '/webhooks/resend' && typeof vpaHandleResendWebhook === 'function') return await vpaHandleResendWebhook(request, env, json);
      if (request.method === 'POST' && path === '/account/cancel-venue' && typeof vpbCancelVenue === 'function')  return await vpbCancelVenue(request, env, json);
      if (request.method === 'POST' && path === '/account/screen-get'  && typeof vpbScreenGet === 'function')    return await vpbScreenGet(request, env, json);
      if (request.method === 'POST' && path === '/account/screen-save' && typeof vpbScreenSave === 'function')   return await vpbScreenSave(request, env, json);
      if (request.method === 'POST' && path === '/account/screen-upload' && typeof vpbScreenUpload === 'function') return await vpbScreenUpload(request, env, json);
      if (request.method === 'POST' && path === '/account/logo-upload' && typeof vpbLogoUpload === 'function') return await vpbLogoUpload(request, env, json);
      if (request.method === 'POST' && path === '/account/logo-remove' && typeof vpbLogoRemove === 'function') return await vpbLogoRemove(request, env, json);
      if (request.method === 'POST' && path === '/account/logo-site'   && typeof vpbLogoSite === 'function')   return await vpbLogoSite(request, env, json);
      if (request.method === 'POST' && path === '/account/marketing-add'    && typeof vpbMarketingAdd === 'function')    return await vpbMarketingAdd(request, env, json);
      if (request.method === 'POST' && path === '/account/marketing-list'   && typeof vpbMarketingList === 'function')   return await vpbMarketingList(request, env, json);
      if (request.method === 'POST' && path === '/account/marketing-remove' && typeof vpbMarketingRemove === 'function') return await vpbMarketingRemove(request, env, json);
      if (request.method === 'POST' && path === '/marketing/summary'        && typeof vpmSummary === 'function')         return await vpmSummary(request, env, json);
      if (request.method === 'POST' && path === '/account/hosts'       && typeof vpbListHosts === 'function')    return await vpbListHosts(request, env, json);
      if (request.method === 'POST' && path === '/account/staff-set-venues' && typeof vpbSetStaffVenues === 'function') return await vpbSetStaffVenues(request, env, json);
      if (request.method === 'POST' && path === '/account/host-add'    && typeof vpbAddHost === 'function')      return await vpbAddHost(request, env, json);
      if (request.method === 'POST' && path === '/account/manager-add'  && typeof vpbAddManager === 'function')   return await vpbAddManager(request, env, json);
      if (request.method === 'POST' && path === '/account/managers'     && typeof vpbListManagers === 'function') return await vpbListManagers(request, env, json);
      if (request.method === 'POST' && path === '/account/optin-export'  && typeof vpbOptinExport === 'function')  return await vpbOptinExport(request, env, json);
      if (request.method === 'POST' && path === '/account/purchase-raffle-export' && typeof vpbPurchaseRaffleExport === 'function') return await vpbPurchaseRaffleExport(request, env, json);
      if (request.method === 'POST' && path === '/account/host-remove' && typeof vpbRemoveHost === 'function')   return await vpbRemoveHost(request, env, json);
      if (request.method === 'POST' && path === '/account/screens-resecure' && typeof vpbResecureScreens === 'function') return await vpbResecureScreens(request, env, json);
      if (request.method === 'POST' && path === '/account/my-venues'   && typeof vpbMyVenues === 'function')     return await vpbMyVenues(request, env, json);
      if (request.method === 'POST' && path === '/account/manager-perms' && typeof vpbSetManagerPerms === 'function') return await vpbSetManagerPerms(request, env, json);
      if (request.method === 'POST' && path === '/account/draw-log'    && typeof vpbDrawLog === 'function')      return await vpbDrawLog(request, env, json);
      if (request.method === 'POST' && path === '/account/nights'      && typeof vpbNights === 'function')       return await vpbNights(request, env, json);
      // The permits, licences and authorities a venue records about itself (Anisimoff, 1 Oct 2026, point 5).
      if (request.method === 'POST' && path === '/account/permits'     && typeof vpbSetPermits === 'function')   return await vpbSetPermits(request, env, json);
      // Section 6 of the Terms, accepted once by a venue with no recorded tick (legal compliance matrix G4, 28 Oct 2026).
      if (request.method === 'POST' && path === '/account/compliance-accept' && typeof vpbAcceptCompliance === 'function') return await vpbAcceptCompliance(request, env, json);
      // The first-run setup's last step, "Add your card when you're ready" (Dean, 28 Oct 2026).
      if (request.method === 'POST' && path === '/account/card-link' && typeof vpbCardLink === 'function') return await vpbCardLink(request, env, json);
      // The first screen after the one-off link: their name on their venue staff rows (Dean, 29 Oct 2026).
      if (request.method === 'POST' && path === '/account/my-name' && typeof vpbMyName === 'function') return await vpbMyName(request, env, json);
      // Gflam HQ admin (vpa* functions below). JWT-verified + role-gated inside each handler.
      if (request.method === 'POST' && path === '/admin/venue'           && typeof vpaHandleVenue === 'function')          return await vpaHandleVenue(request, env, json);
      // HQ > Venues > Set up a prospect (Dean, 28 Oct 2026): venue, login, slides and ONE welcome, in one go.
      if (request.method === 'POST' && path === '/admin/prospect'        && typeof vpaHandleProspect === 'function')       return await vpaHandleProspect(request, env, json);
      // The same setup for the prospect autopilot Mac job, on Dean's yes; a secret header, this route only (29 Oct 2026).
      if (request.method === 'POST' && path === '/autopilot/prospect'    && typeof vpaAutopilotProspect === 'function')    return await vpaAutopilotProspect(request, env, json);
      // Dean's Yes / No / Edit buttons on the review email (Dean, 29 Oct 2026; migration 128). The page never writes on a GET.
      if (request.method === 'POST' && path === '/autopilot/review/register' && typeof vpaAutopilotReviewRegister === 'function') return await vpaAutopilotReviewRegister(request, env, json);
      if ((request.method === 'GET' || request.method === 'POST') && path === '/autopilot/review' && typeof vpaAutopilotReviewPage === 'function') return await vpaAutopilotReviewPage(request, env);
      if (request.method === 'GET'  && path === '/autopilot/decisions'      && typeof vpaAutopilotDecisions === 'function')    return await vpaAutopilotDecisions(request, env, json);
      if (request.method === 'POST' && path === '/autopilot/decisions/done' && typeof vpaAutopilotDecisionDone === 'function') return await vpaAutopilotDecisionDone(request, env, json);
      // The welcome goes on a delay (Dean, 28 Oct 2026; migration 124): HQ sees when, and can cancel it or send it now.
      // HQ > Prospects (Dean, 29 Oct 2026; migration 125): who has not signed up, who to ring, and the Called mark.
      if (request.method === 'POST' && path === '/admin/prospects'              && typeof vpaProspectsList === 'function')      return await vpaProspectsList(request, env, json);
      if (request.method === 'POST' && path === '/admin/prospect/called'        && typeof vpaProspectCalled === 'function')     return await vpaProspectCalled(request, env, json);
      // A prospect's free month (migration 127): it starts at their first sign-in; Now or Later on the card; cancel.
      if (request.method === 'POST' && path === '/account/prospect-start'       && typeof vpbProspectStart === 'function')      return await vpbProspectStart(request, env, json);
      if (request.method === 'POST' && path === '/account/card-choice'          && typeof vpbCardChoice === 'function')         return await vpbCardChoice(request, env, json);
      if ((request.method === 'GET' || request.method === 'POST') && path === '/prospect/cancel' && typeof vpaProspectCancel === 'function') return await vpaProspectCancel(request, env, json);
      if (request.method === 'POST' && path === '/admin/prospect/welcomes'      && typeof vpaProspectWelcomes === 'function')   return await vpaProspectWelcomes(request, env, json);
      if (request.method === 'POST' && path === '/admin/prospect/welcome-cancel' && typeof vpaProspectWelcomeCancel === 'function') return await vpaProspectWelcomeCancel(request, env, json);
      if (request.method === 'POST' && path === '/admin/prospect/welcome-now'   && typeof vpaProspectWelcomeNow === 'function') return await vpaProspectWelcomeNow(request, env, json);
      if (request.method === 'POST' && path === '/admin/resend-welcome'  && typeof vpaResendWelcome === 'function')        return await vpaResendWelcome(request, env, json);
      if (request.method === 'POST' && path === '/admin/signin-link'     && typeof vpaAdminSigninLink === 'function')      return await vpaAdminSigninLink(request, env, json);
      if (request.method === 'POST' && path === '/admin/discount'        && typeof vpaHandleDiscount === 'function')       return await vpaHandleDiscount(request, env, json);
      if (request.method === 'POST' && path === '/admin/discount-remove' && typeof vpaHandleDiscountRemove === 'function') return await vpaHandleDiscountRemove(request, env, json);
      if (request.method === 'POST' && path === '/admin/quiet-venues'    && typeof vpaHandleQuietVenues === 'function')    return await vpaHandleQuietVenues(request, env, json);
      if (request.method === 'POST' && path === '/admin/venue-history'   && typeof vpaHandleVenueHistory === 'function')   return await vpaHandleVenueHistory(request, env, json);
      if (request.method === 'POST' && path === '/admin/auto-archive'   && typeof vpaHandleAutoArchive === 'function')   return await vpaHandleAutoArchive(request, env, json);
      if (request.method === 'POST' && path === '/admin/venue-status'    && typeof vpaHandleVenueStatus === 'function')    return await vpaHandleVenueStatus(request, env, json);
      if (request.method === 'POST' && path === '/admin/venue-gaming'    && typeof vpaHandleVenueGaming === 'function')    return await vpaHandleVenueGaming(request, env, json);
      if (request.method === 'POST' && path === '/admin/permit-register-check' && typeof vpaHandlePermitRegisterCheck === 'function') return await vpaHandlePermitRegisterCheck(request, env, json);
      if (request.method === 'POST' && path === '/admin/night-pass'      && typeof vpaHandleNightPass === 'function')      return await vpaHandleNightPass(request, env, json);
      if (request.method === 'GET'  && path === '/admin/screen-history'  && typeof vpaHandleScreenHistory === 'function')  return await vpaHandleScreenHistory(request, env, json);
      if (request.method === 'POST' && path === '/admin/screen-restore'  && typeof vpaHandleScreenRestore === 'function')  return await vpaHandleScreenRestore(request, env, json);
      if (request.method === 'GET'  && path === '/admin/audit-search'    && typeof vpaHandleAuditSearch === 'function')    return await vpaHandleAuditSearch(request, env, json);
      if (request.method === 'GET'  && path === '/admin/billing-health'  && typeof vpaHandleBillingHealth === 'function')  return await vpaHandleBillingHealth(request, env, json);
      if (request.method === 'POST' && path === '/admin/invite-back'     && typeof vpaHandleInviteBack === 'function')     return await vpaHandleInviteBack(request, env, json);
      if (request.method === 'POST' && path === '/admin/gst'             && typeof vpaHandleGst === 'function')            return await vpaHandleGst(request, env, json);
      if (request.method === 'GET'  && path === '/admin/venue-detail'    && typeof vpaHandleVenueDetail === 'function')    return await vpaHandleVenueDetail(request, env, json);
      if (request.method === 'GET'  && path === '/admin/venue-compliance' && typeof vpaHandleVenueCompliance === 'function') return await vpaHandleVenueCompliance(request, env, json);
      if (request.method === 'POST' && path === '/admin/player-find'     && typeof vpaHandlePlayerFind === 'function')   return await vpaHandlePlayerFind(request, env, json);
      if (request.method === 'POST' && path === '/admin/player-remove'   && typeof vpaHandlePlayerRemove === 'function') return await vpaHandlePlayerRemove(request, env, json);
      if (request.method === 'GET'  && path === '/admin/optin-export'    && typeof vpaHandleAdminOptinExport === 'function') return await vpaHandleAdminOptinExport(request, env, json);
      if (request.method === 'GET'  && path === '/admin/venue-marketing-export' && typeof vpaHandleVenueMarketingExport === 'function') return await vpaHandleVenueMarketingExport(request, env, json);
      if (request.method === 'POST' && path === '/admin/optin-approve'   && typeof vpaHandleOptinApprove === 'function')   return await vpaHandleOptinApprove(request, env, json);
      if (request.method === 'POST' && path === '/admin/staff'           && typeof vpaHandleStaff === 'function')          return await vpaHandleStaff(request, env, json);
      // Remove a login that belongs to no other venue (Dean, 30 Oct 2026). HQ only; the delete is owner only, on his own tap.
      if (request.method === 'POST' && path === '/admin/logins'          && typeof vpaHandleLogins === 'function')         return await vpaHandleLogins(request, env, json);
      if (request.method === 'POST' && path === '/admin/login-find'      && typeof vpaHandleLoginFind === 'function')      return await vpaHandleLoginFind(request, env, json);
      if (request.method === 'POST' && path === '/admin/login-remove'    && typeof vpaHandleLoginRemove === 'function')    return await vpaHandleLoginRemove(request, env, json);
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

  /* INBOUND EMAIL TO THE HELP DESK. Cloudflare Email Routing on the help subdomains delivers here
     (see ~/venue-enrich/HELP-DESK-EMAIL-SETUP.md). Never rejects: Migadu keeps its own copy. */
  async email(message, env, ctx) {
    await helpInboundEmail(message, env);
  },

  /* THE 30-DAY ARCHIVE, unattended.

     Needs a Cron Trigger on this Worker. Without one this never runs and the
     archive stays a button somebody has to press, which is exactly where it
     was before. Suggested schedule: "30 17 * * *", once a day, well away from
     any venue's trading hours.

     It shares vpaAutoArchiveSweep with the button, so the dry run in HQ shows
     precisely what the nightly job will do. No separate code path to drift. */
  async scheduled(event, env, ctx) {
    const actor = { actorId: null, label: 'automatic (30-day archive)' };
    try {
      const res = await vpaAutoArchiveSweep(env, actor, 30, false);
      if (res && res.archived && res.archived.length) {
        await vpaAudit(env, actor, 'auto_archive_run', null,
          { archived: res.archived.length, checked: res.checked });
      }
      /* The day-before warning rides the same trigger. Kept separate from the archive
         sweep and in its own try, because a venue must still be told its last day is
         tomorrow on a night when the archive sweep has thrown. */
      try {
        const last = await vpaLastDaySweep(env);
        await vpaAudit(env, actor, 'last_day_sweep_ran', null,
          { sent: last.sent, checked: last.checked, why: (last.why || []).slice(0, 12) });
      } catch (e2) {
        await vpaAudit(env, actor, 'last_day_sweep_failed', null,
          { error: String((e2 && e2.message) || e2).slice(0, 300) }).catch(() => {});
      }
    } catch (e) {
      // A failed sweep must never take the Worker down. Nothing here is urgent:
      // a venue that should have been archived tonight can be archived tomorrow.
      try { await vpaAudit(env, actor, 'auto_archive_failed', null,
                           { error: String((e && e.message) || e).slice(0, 300) }); } catch (e2) {}
    }
    /* The screen history check (migration 114) rides the same trigger, OUTSIDE the archive's try,
       so a venue's screen is still checked on a night when either sweep above has thrown. */
    try { await vpaScreenHistoryNightly(env); } catch (e3) { /* tomorrow night will look again */ }
    /* A prospect's card reminders and the pause at the end of their free month (migration 127). Its own try:
       the sweep keeps its own hours (8am to 5pm Mon to Fri for emails) and remembers what it sent. */
    try { await vpaProspectReminderSweep(env, Date.now()); } catch (e4) { /* the next hour looks again */ }
  },
};


/* ONE WAY TO READ A REQUEST BODY.

   Sixteen handlers did a bare `await request.json()`. That REJECTS on a malformed
   body, and there are three different spellings of the guard in this file already
   (two flavours of `.catch(() => ({}))` plus one try/catch), which is the same
   one-answer-in-many-places shape that this repo keeps paying for.

   Nothing crashed, because the fetch handler has a top-level catch. What happened
   instead is worse to debug: the caller got a 500 "Something went wrong", which reads
   as our fault and says nothing about the actual problem. It is almost always OUR
   front end sending something wrong, and a 500 is the least useful way to find out.

   NO BODY AT ALL IS FINE and returns {}. That is deliberate and matches what the
   twelve already-guarded call sites did: several endpoints are a bare POST with
   nothing in them. Only a body that is present and unparseable is an error.

   Returns { ok: true, body } or { ok: false, res }. NOT a bare Response, and the
   caller must NOT test `instanceof Response`: that relies on Response being an ambient
   global, which Cloudflare has and jsc does not, so every money test that drives these
   handlers threw a ReferenceError instead of running. Control flow should not depend on
   a global that may or may not be there.

       const _b = await vpaBody(request, json);
       if (!_b.ok) return _b.res;
       const b = _b.body;
*/
async function vpaBody(request, json) {
  let raw;
  try {
    raw = await request.text();
  } catch (e) {
    return { ok: false,
             res: json({ error: 'We could not read that request. Please try again.' }, 400) };
  }
  if (!raw || !raw.trim()) return { ok: true, body: {} };
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return { ok: false, res: json({ error: 'That request body was not valid JSON.' }, 400) };
  }
  // JSON.parse happily returns a string, a number or null. Every caller here expects to
  // read properties off an object, and `null.foo` is a crash rather than a 400.
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, res: json({ error: 'That request body was not a JSON object.' }, 400) };
  }
  return { ok: true, body: parsed };
}

/* ------------------------------ /checkout ------------------------------ */
async function handleCheckout(request, env, json) {
  const _b = await vpaBody(request, json);
  if (!_b.ok) return _b.res;
  const b = _b.body;
  /* Lower case from the door, so the account is stored one way however the phone typed it.
     It is the login, and Supabase lowercases logins already. */
  const email = (b.email || '').trim().toLowerCase();
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
                   entity_type: (v && (v.entity_type === 'non_profit' || v.entity_type === 'for_profit')) ? v.entity_type : null,
                   /* An SA or NT pub that ticked "our bingo is run by a not-for-profit" at signup
                      (migration 116). Only ever a request for HQ to look: provisioning opens a help
                      desk ticket, and number bingo stays hidden until HQ switches it on. */
                   bingo_review: !!(v && v.bingo_review === true) }))
    .filter((v) => v.name && v.seats > 0);

  if (email.indexOf('@') === -1 || !venues.length) {
    return json({ error: 'Missing contact email or venue details.' }, 400);
  }
  /* THE SIGNUP TICK, AS A FACT (audit 20 Oct 2026, C5). The tick (the Terms and Privacy Policy,
     and "our venue is responsible for its gaming compliance") was checked only in the browser,
     and provisioning then recorded it as accepted by the contact: an inference. The page now
     sends it, and nothing is saved and Stripe is never asked without it. The time it was given
     rides on each venue to provisioning, which records it on the venue. */
  if (b.compliance_accepted !== true) {
    return json({ error: 'Please tick the box to agree to the Terms and Privacy Policy and confirm your venue is responsible for its gaming compliance.' }, 400);
  }
  const acceptedAt = new Date().toISOString();

  // Make venue names unique within a group, so two identically-named rows can't be
  // billed as two venues but provision as one (provisioning matches by name).
  const seenNames = {};
  venues = venues.map((v) => {
    let nm = v.name, k = 2;
    while (seenNames[nm.toLowerCase()]) { nm = v.name + ' (' + k + ')'; k++; }
    seenNames[nm.toLowerCase()] = true;
    return { name: nm, seats: v.seats, postcode: v.postcode, entity_type: v.entity_type, bingo_review: v.bingo_review, compliance_accepted_at: acceptedAt };
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
  /* Upper case on both sides, the same as GET /founding above. That preview told a page
     'qld-oct-2026' was open while this match, case sensitive, priced the same code at
     standard. Nothing sends a lower case code today; nothing should ever be able to. */
  const activeCodes = vpaLiveCodes(env);   // listed AND inside its month: a code ends with its month by itself
  const foundingCode = (b.founding_code || '').trim().toUpperCase();
  const codeActive = foundingCode !== '' && activeCodes.indexOf(foundingCode) !== -1;
  const codeState = foundingCode.split('-')[0].toUpperCase();
  const foundingPostcode = ((b.postcode || (venues[0] && venues[0].postcode) || '') + '').trim();
  // The leading-digit test alone was WRONG for four states, and it failed SILENTLY: the venue saw
  // the founding price on /qld or /vic, then got charged standard with no error and no explanation.
  // This Worker's own vpaStateFromPostcode() already knows QLD is 4xxx AND 9xxx, VIC 3xxx AND 8xxx,
  // NSW 1xxx-2xxx and ACT 02xx, so ask it. Kept as a UNION with the old digit test so this can only
  // ever accept MORE venues than before, never newly reject one.
  const stateOk = vpaFoundingStateOk(foundingPostcode, codeState);
  /* THE POSTCODE NO LONGER DECIDES THE PRICE, and it never should have decided it this way.
     Dean, 17 Sep 2026: "I dont want them knowing that the postcode is how we are measuring
     it, but if its more than one venue and they have one in NSW and one in QLD I am happy
     for the same price between the 2."

     IT WAS ORDER-DEPENDENT. foundingPostcode reads venues[0] and nothing else, and that one
     answer set the price for the WHOLE account. So a group with a Sydney pub and a Brisbane
     pub paid $2.50 a player if they happened to type the Sydney one first and $3 if they
     typed Brisbane first, across every venue either way. Same group, same night, same form,
     two different bills depending on typing order.

     An active code is an invite, and an invite is the whole test. One price across a group,
     which is what Dean asked for and is the only answer that does not depend on the order
     somebody filled in a form.

     THE STATE IS STILL RECORDED. au_state decides which gaming rules apply and has nothing
     to do with billing, and the mismatch now rides along in the Stripe metadata so a
     cross-state signup is visible rather than silent. That matters while Queensland and WA
     are waiting on OLGR: the price is not the thing we needed the postcode for. */
  const founding = codeActive;
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

  /* WHO IS THIS, BEFORE ANYTHING IS WRITTEN DOWN. This lookup and the guard under it used to
     sit below the insert, so every refused duplicate still left a pending row behind. Harmless
     on its own, since pending rows are excluded from this very query and from the account
     lists, but it is litter that accumulates fastest on exactly the venue who is confused
     enough to be signing up twice, and HQ would be reading it. Ask first, write second. */
  const prior = await sbPriorAccounts(env, email, (b.mobile || '').trim(), null);

  /* ONE ACCOUNT PER PERSON. Nothing used to stop a second ACCOUNT being created, only a second
     free month, and there is no unique index on contact_email. So a venue that signed up twice,
     because the first attempt looked like it failed or because they were sent a second link, got
     a second founding row and a SECOND STRIPE SUBSCRIPTION billed in full alongside the first.

     Worse, they could not see it to stop it: vpbRequireOwner resolves one account from
     venues[0].founding_id, so the duplicate never appeared on their billing page and there was no
     button anywhere that would cancel it. The add-card path has guarded exactly this since it was
     written. Checkout never did. Found by audit, 17 Sep 2026.

     A LIVE SUBSCRIPTION IS THE TEST, not merely having a row. An abandoned pending signup is
     already excluded by the query, and a venue that genuinely cancelled and is coming back must
     not be turned away at the door. */
  /* A PHONE NUMBER MUST NEVER BLOCK A SIGNUP. Dean, 17 Sep 2026: "if I move pubs and my phone
     number is still linked to an old pub you need to work that one out."

     The lookup asks about the email OR the mobile, and the guard treated both the same, so a
     publican who moved from one pub to the next was refused at the door because their own mobile
     was still on the account of the pub they had left. A brand new venue, a different owner, a
     different bill, and the answer was no. The message even said "that email", which was not the
     field that matched, and it named a venue they may have nothing to do with any more.

     So identity for BILLING is the EMAIL, and only the email. It is the login, it is what
     vpbRequireOwner resolves an account from, and a second account on one login is the whole
     fault this guard exists for. A mobile is a contact detail: people move pubs, numbers get
     recycled, and a venue manager's mobile can sit on three venues quite legitimately.

     A mobile seen elsewhere is still worth knowing, so it rides along in the Stripe metadata and
     an HQ audit row rather than stopping anybody. Nobody is refused a product over it. */
  const sameEmail = prior.filter(function (a) {
    return String(a.contact_email || '').trim().toLowerCase() === email.toLowerCase();
  });
  const mobileOnly = prior.filter(function (a) {
    return String(a.contact_email || '').trim().toLowerCase() !== email.toLowerCase();
  });

  const live = sameEmail.filter(function (a) { return !!a.stripe_subscription_id; })[0];
  if (live) {
    /* THREE THINGS THEY MIGHT ACTUALLY BE DOING, and the message has to cover all three or it
       reads as a wall. They are adding a second venue to a group; they are signing up twice by
       mistake; or they have moved pubs and are using the same address for the new one, which is
       the one case where "add a venue" is the WRONG advice, because they do not want their old
       pub on their new bill. */
    return json({ error: 'That email already has a VenuePlay account with billing set up'
      + (live.venue_name ? ' (' + live.venue_name + ')' : '') + '. '
      + 'If this is another venue for the same group, sign in and use Add a venue, so it all '
      + 'stays on one bill. If you have moved to a new venue and that account belongs to the old '
      + 'one, email hello@venueplay.com.au and we will move things across for you.',
      existing_account: true }, 409);
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
            subject: vpaAlertSubject('check', venues[0].name + ' (' + email + ')'),
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
  /* THE FREE MONTH FOR A VENUE COMING BACK. Every page on the site promises a free month with no
     conditions on it, and this quietly gave three days to anyone who had ever held an account.
     A pub that was with us for two years, left, and came back eighteen months later was treated
     as a chancer, and the first thing that happened was a charge they had been told would not
     come. That is a bad way to win somebody back.

     So the month is given unless they held an account within the last twelve months, which is the
     only case the short trial was ever really for: leaving and re-signing to stay free. created_at
     is the START of the previous account rather than when it ended, which is the generous way
     round and deliberately so. A venue on its second year is not the venue this guards against.

     Dean, 17 Sep 2026, set the same intent on venues added to a paying account. This is the same
     answer at the other door. */
  const TWELVE_MONTHS = 365 * 24 * 60 * 60 * 1000;
  /* sameEmail, NOT prior. Same reason as the guard above: a publican who moves pubs would
     otherwise have their NEW venue's free month taken off them because their mobile is still on
     the account of the pub they left. Different venue, different owner paying, and the month is
     the thing that gets them to try it. */
  const recent = sameEmail.filter(function (a) {
    const t = Date.parse(a.created_at || '');
    return isFinite(t) && (Date.now() - t) < TWELVE_MONTHS;
  })[0];
  const returning = !!recent;
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
  // Not a block and not a price change. Just a thing worth being able to see later: the same
  // mobile on more than one account is usually somebody moving pubs, and occasionally it is not.
  form.set('subscription_data[metadata][mobile_on_other_accounts]', mobileOnly.length ? String(mobileOnly.length) : '0');
  /* Visible, not enforced: which state's link they used, and whether the first venue's
     postcode agrees with it. Priced the same either way. */
  form.set('subscription_data[metadata][signup_state_link]', codeState || '');
  form.set('subscription_data[metadata][state_matches_postcode]', stateOk ? '1' : '0');
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
  /* THE DATE STRIPE WAS ACTUALLY GIVEN, carried to the welcome email. The email used to work out
     its own "free until" as today plus 30 days, knowing nothing about this. A venue coming back
     inside twelve months gets a three day trial (above), so their email promised a first payment
     27 days later than the one Stripe then took. A surprise charge on exactly the customer we
     are trying to win back gently. Found by audit, 20 Sep 2026. */
  form.set('metadata[trial_end]', String(trialTs));
  form.set('metadata[returning]', returning ? '1' : '0');
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

/* ---- Has this Stripe event already been handled? (migration 79) ----

   Stripe RETRIES a webhook it does not get a 2xx for, and can deliver the same
   event more than once even when it did. Until this, every retry ran every
   branch again. Today the damage is duplicate emails and duplicate audit rows
   rather than duplicate money, because no money-moving Stripe call sits on this
   path and each branch happens to be individually guarded. That is luck. The
   next branch somebody writes inherits none of it.

   FAILS OPEN, ALWAYS. Every error path here returns 'go'. If the table is not
   there yet, if Supabase is having a moment, if the reply is not what we expect:
   handle the event, exactly as this Worker did before the ledger existed. A
   webhook that is dropped because the bookkeeping broke is far worse than one
   handled twice, which is the thing we were already living with.
*/
const VPA_EVENT_STALE_MS = 5 * 60 * 1000;   // longer than any branch here takes

async function vpaClaimStripeEvent(env, event) {
  const id = event && event.id;
  if (!id || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) return 'go';
  try {
    /* ONE ATOMIC CLAIM. resolution=ignore-duplicates makes this an insert that
       does nothing on a primary key clash, so the row comes back to exactly ONE
       of two deliveries that arrive together. Reading first and then inserting
       would be the same race this whole function exists to close. */
    const res = await fetch(env.SUPABASE_URL + '/rest/v1/vp_stripe_events', {
      method: 'POST',
      headers: { ...vpaHeaders(env), 'Prefer': 'resolution=ignore-duplicates,return=representation' },
      body: JSON.stringify({ event_id: String(id), event_type: (event.type || null) }),
    });
    if (!res.ok) return 'go';                        // includes "no such table": no ledger, old behaviour
    const rows = await res.json().catch(() => []);
    if (Array.isArray(rows) && rows.length) return 'go';   // we got it

    // Somebody already holds it. Finished, running now, or died halfway?
    const prev = await vpaSelect(env, 'vp_stripe_events',
      'event_id=eq.' + encodeURIComponent(String(id)) + '&select=claimed_at,completed_at,attempts&limit=1');
    const row = prev && prev[0];
    if (!row) return 'go';
    if (row.completed_at) return 'skip';             // a real duplicate
    const age = Date.now() - Date.parse(row.claimed_at || '');
    /* CLAIMED, NOT FINISHED, AND RECENT. This used to answer 'skip', which the handler turns
       into a 200, and a 200 tells Stripe never to send the event again. But "unfinished" is also
       what a delivery that THREW looks like. A signup paid, Supabase hiccupped, the handler threw
       and answered 500 (correct), Stripe retried one minute later (or Dean pressed Resend, which
       is what anybody does on seeing a failed webhook) and was told "already handled". Paid, no
       venue, no login, and nothing anywhere said so. Found by audit, 20 Sep 2026.
       Only completed_at is proof that it was handled, so only that earns a 200. */
    if (!(age > VPA_EVENT_STALE_MS)) return 'busy';
    /* Past the window with no completion: the attempt that claimed it died. Take
       it over rather than strand it, because an event nobody will ever finish is
       the one failure a ledger must not introduce. */
    await fetch(env.SUPABASE_URL + '/rest/v1/vp_stripe_events?event_id=eq.' + encodeURIComponent(String(id)), {
      method: 'PATCH',
      headers: { ...vpaHeaders(env), 'Prefer': 'return=minimal' },
      body: JSON.stringify({ claimed_at: new Date().toISOString(), attempts: (Number(row.attempts) || 1) + 1 }),
    }).catch(() => {});
    return 'go';
  } catch (_) { return 'go'; }
}

/* The handler threw. Hand the claim back, so the very next delivery runs it instead of waiting
   out the stale window. claimed_at goes to the epoch rather than the row being deleted, because
   the attempts count on it is the only record that this event has already failed once. Only an
   UNFINISHED row is touched: a finished event must stay finished whatever happens afterwards. */
async function vpaReleaseStripeEvent(env, event) {
  const id = event && event.id;
  if (!id || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) return;
  try {
    await fetch(env.SUPABASE_URL + '/rest/v1/vp_stripe_events?event_id=eq.' + encodeURIComponent(String(id)) + '&completed_at=is.null', {
      method: 'PATCH',
      headers: { ...vpaHeaders(env), 'Prefer': 'return=minimal' },
      body: JSON.stringify({ claimed_at: '1970-01-01T00:00:00Z' }),
    });
  } catch (_) { /* then it ages out in five minutes, which is what happened before this existed */ }
}

async function vpaFinishStripeEvent(env, event) {
  const id = event && event.id;
  if (!id || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) return;
  try {
    await fetch(env.SUPABASE_URL + '/rest/v1/vp_stripe_events?event_id=eq.' + encodeURIComponent(String(id)), {
      method: 'PATCH',
      headers: { ...vpaHeaders(env), 'Prefer': 'return=minimal' },
      body: JSON.stringify({ completed_at: new Date().toISOString() }),
    });
  } catch (_) { /* the next delivery ages it out; never throw out of a webhook */ }
}

/* ------------------------------ /webhook ------------------------------ */
async function handleWebhook(request, env, cors) {
  const sig = request.headers.get('Stripe-Signature') || '';
  const raw = await request.text();

  const ok = await verifyStripeSig(raw, sig, env.STRIPE_WEBHOOK_SECRET);
  if (!ok) return new Response('bad signature', { status: 400, headers: cors });

  const event = JSON.parse(raw);

  /* AFTER the signature, BEFORE any handling. Signature first because an unsigned
     event must never be allowed to write a row at all, let alone claim an id that
     would then make us ignore the real one. */
  const claim = await vpaClaimStripeEvent(env, event);
  if (claim === 'skip') {
    // 200 is the whole point: it is what tells Stripe to stop retrying.
    return new Response('already handled', { status: 200, headers: cors });
  }
  if (claim === 'busy') {
    /* NOT a 200. Another delivery holds this event and has not finished it. If it finishes,
       Stripe's retry of this one finds completed_at and gets its 200 then. If it died, the retry
       takes it over. Either way Stripe keeps asking until somebody has actually done the work. */
    return new Response('still being handled, send it again shortly', { status: 409, headers: cors });
  }

  try {
    await vpaHandleStripeEvent(env, event);
  } catch (e) {
    await vpaReleaseStripeEvent(env, event);
    throw e;   // the router answers 5xx, which is what makes Stripe retry
  }
  /* Marked finished only HERE, after everything. Anything that throws leaves completed_at
     null and hands the claim back, so Stripe's retry runs it properly. */
  await vpaFinishStripeEvent(env, event);
  return new Response('ok', { status: 200, headers: cors });
}

/* Everything a Stripe event makes us do. Its own function so that handleWebhook can wrap ALL of
   it in one try: a branch added here later is covered without anybody remembering to. There is
   deliberately no return out of any branch, because several branches act on the same event. */
async function vpaHandleStripeEvent(env, event) {
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
    // A prospect the free month had paused comes straight back on with their card (migration 127).
    if (rowId && typeof vpaProspectCardAdded === 'function') await vpaProspectCardAdded(env, rowId);
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
    /* AN EXTRAS INVOICE IS NOT THE SUBSCRIPTION. The game Worker raises a standalone invoice on
       the night for extra players ($2 a head). If that card try fails, a small one moves onto the
       next subscription invoice and a big one stays open for Stripe to chase; either way it never
       counts toward pausing the venue's games. Only the subscription itself does that. Before
       11 Sep 2026 two declined $2.00 test invoices would have paused a paid-up venue. */
    /* NO `return` OUT OF THIS BRANCH. vpaFinishStripeEvent sits at the bottom of the handler,
       and the first version returned here, so both live extras events on 11 Sep 2026 were left
       with completed_at null: Stripe's retry would have re-run the mover and sent the email a
       second time once the claim went stale. if/else, so the event falls through and finishes. */
    if (vpaIsExtrasInvoice(inv)) {
      /* The bank's answer is read BEFORE the mover voids the invoice: voiding cancels the
         PaymentIntent and Stripe clears its error. The charge keeps it either way (see
         vpaLookupDecline), but this is the answer as Stripe reported it at the time. */
      const decline = await vpaLookupDecline(env, inv);
      const moved = await vpaMoveExtrasToMonthly(env, inv);
      if (!moved.already) await vpaFirePaymentFailedEmail(env, inv, moved, decline);
    } else {
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
    /* THE PLAN MOVED. Told at the moment it moves, not buried in a receipt that may
       never arrive. Returns immediately unless a plan_uplift row was written in the last
       half hour, so the other quantity writes named below are silent. */
    if (st === 'active') {
      await vpaFirePlanUpliftEmail(env, event.data.object && event.data.object.customer);
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
    /* THEY KEEP THE LAST NIGHT. Stripe ends the subscription on the ANNIVERSARY OF THE
       SIGNUP, so a venue that joined at 10:19 on a Wednesday morning goes dark at 10:19
       on a Friday morning, halfway through the last day they have paid for. Wellshot
       would have lost its Friday night at twenty past ten in the morning.

       Dean, 16 Sep 2026, asked for the last night to run properly, and then asked the
       better question: midnight, or the 3am sweep? 3am. This product already decided
       when a night ends. venueplay-game closes every unended session at 3am IN THE
       VENUE'S OWN TIMEZONE, set on 11 Sep after Dean asked for the close to go state by
       state. Ending the subscription at calendar midnight would kill a running game on
       the one night people most remember, and ending it at 3am Brisbane would shut a
       Sydney room at 2am through daylight saving. So the marker goes on here and
       venueplay-game flips it at 3am local, using the same clock as everything else.

       ONLY FOR A DELIBERATE CANCELLATION. A chargeback also arrives as
       subscription.deleted, and a venue disputing its bill does not get a free night.
       cancel_at_period_end is the test: we set it when the owner cancels, and nothing
       sets it on a dispute. */
    await vpaEndAfterLastNight(env, cust);
    await vpaClearCreditOnEnd(env, cust, event.id);   // the subscription is over, so the credit is too
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
}

/* ------------------------------ /contact ------------------------------ */
/* IN-MEMORY RATE LIMIT, one Worker isolate's worth. /contact sends an email per request on
   the SAME Resend key as invoices and welcome emails, with no limit of any kind, so a
   scripted flood could burn that sending reputation (audit, 20 Sep 2026). The key is the
   raw connecting IP: never written to a database, a log, or returned to the caller, so it
   does not need hashing the way a stored ip_hash does. Cleared on isolate restart, which is
   fine -- the thing being protected is sustained sending rate, not a permanent ban list. */
const rlMem = new Map();   // ip -> { n, until }
let rlSweptAt = 0;
function rateLimit(key, limit, windowSecs) {
  const now = Date.now();
  if (now - rlSweptAt > 30000) {
    rlSweptAt = now;
    for (const [k, v] of rlMem) if (v.until <= now) rlMem.delete(k);
  }
  let m = rlMem.get(key);
  if (!m || m.until <= now) { m = { n: 0, until: now + windowSecs * 1000 }; rlMem.set(key, m); }
  if (m.n >= limit) return false;
  m.n += 1;
  return true;
}
const CONTACT_MAX_PER_IP = 6;   // a real enquiry is a one-off; six in an hour is generous for a shared office IP

async function handleContact(request, env, json) {
  const ip = request.headers.get('cf-connecting-ip') || '';   // Cloudflare-set; x-real-ip is client-suppliable
  // Durable across Worker instances (help desk, migration 108); this instance's memory if the database cannot be asked.
  if (ip && !(await helpIpLimit(env, 'contact', ip, CONTACT_MAX_PER_IP, 3600))) {
    return json({ error: 'Too many messages from this network. Please try again in a while, or call us.' }, 429);
  }
  const _b = await vpaBody(request, json);
  if (!_b.ok) return _b.res;
  const b = _b.body;
  const name = (b.name || '').trim();
  const email = (b.email || '').trim();
  // Optional. Capped and stripped of control characters like every other field that reaches an
  // email body; the enquiry is worth more than a perfectly formatted number.
  const phone = String(b.phone == null ? '' : b.phone).replace(/[\x00-\x1f]+/g, ' ').trim().slice(0, 30);
  const message = (b.message || '').trim();
  if (!name || email.indexOf('@') === -1 || !message) return json({ error: 'Missing fields.' }, 400);
  /* CAPS, AND A HONEYPOT. This sends an email per request on the SAME Resend key that sends
     invoices and welcome emails, with the caller choosing the reply-to, and it had no limits
     at all: a script could burn the sending reputation the billing emails depend on, or post
     a megabyte into two inboxes. A real enquiry fits in these with room to spare. `website` is
     a field no person ever sees or fills; anything that fills it is told it worked and
     nothing is sent. */
  if (String(b.website || '').trim()) return json({ ok: true });
  if (name.length > 120 || email.length > 200 || message.length > 4000
      || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) {
    return json({ error: 'That message is too long or the email address does not look right.' }, 400);
  }

  /* A SALES TICKET TOO (help desk, migration 106), so the enquiry is on the record and in the
     report. Best effort: before the migration is run, or on any database blip, the enquiry still
     goes out by email exactly as it always did. The email below is the staff alert, so the help
     desk sends no second one; it only pushes to the staff phones that asked. */
  let ticketNo = null, ticket = null;
  try {
    const t = await helpInsertTicket(env, { brand: 'venueplay', category: 'sales', channel: 'web_form',
      title: 'Website enquiry: ' + helpLine(message, 80), message: message, contact_name: name,
      contact_email: email, contact_phone: phone || null });
    ticketNo = t && t.ticket_no;
    ticket = t || null;
    if (t) await helpPushNew(env, t).catch(() => null);
  } catch (e) { ticketNo = null; }
  /* THE VISITOR HEARS BACK STRAIGHT AWAY (Dean, 23 Oct 2026), ticket or no ticket: with the number
     when there is one, without it when the desk could not take the row. Never the message body. */
  await helpAcknowledge(env, Object.assign({ brand: 'venueplay', category: 'sales', channel: 'web_form', contact_name: name, contact_email: email }, ticket || {}));

  // This email is the enquiry's staff alert, so it shares the help desk's daily cap. Once the
  // enquiry is safely a ticket, a capped day skips the email; without a ticket it always goes.
  if (ticketNo && !(await helpAlertAllowed(env))) return json({ ok: true, ticket_no: ticketNo });

  const esc = (s) => String(s).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
  const html =
    '<h2>New VenuePlay enquiry' + (ticketNo ? ' (ticket #' + ticketNo + ')' : '') + '</h2>' +
    '<p><b>Name:</b> ' + esc(name) + '</p>' +
    '<p><b>Email:</b> ' + esc(email) + '</p>' +
    (phone ? '<p><b>Phone:</b> ' + esc(phone) + '</p>' : '') +
    '<p><b>Message:</b><br>' + esc(message).replace(/\n/g, '<br>') + '</p>';

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'VenuePlay <hello@send.venueplay.com.au>',   // sending domain must be verified in Resend
      to: ['sales@venueplay.com.au'],   // ONE copy, the sales mailbox (Dean, 30 Oct 2026: it came twice when it went to dean@ AND sales@)
      reply_to: email,
      subject: vpaAlertSubject('enquiry', name + (ticketNo ? ' ' + helpTag(ticketNo) : '')),
      html: html,
      text: helpPlainFromHtml(html),       // every help desk email carries a text part (28 Oct 2026)
      headers: { 'X-VP-Help': 'alert' },   // so the hello@ copy to the help subdomain is not a second ticket
    }),
  });
  /* The enquiry is safe once it is a ticket, so a failed email is not the visitor's problem then. */
  if (!res.ok && !ticketNo) return json({ error: 'Email send failed.' }, 502);
  return json({ ok: true, ticket_no: ticketNo });
}

/* ------------------------------ Supabase helpers ------------------------------ */
function sbHeaders(env) {
  return {
    'apikey': env.SUPABASE_SERVICE_KEY,
    'Authorization': 'Bearer ' + env.SUPABASE_SERVICE_KEY,
    'Content-Type': 'application/json',
  };
}
/* EVERY REAL ACCOUNT THIS EMAIL OR MOBILE ALREADY HAS, newest first.

   This used to return a bare true/false and was used for one thing: withholding the second free
   month. Two separate faults came out of that on 17 Sep 2026, and both needed the ROWS rather
   than the boolean, so it returns them:

     - nothing stopped a second ACCOUNT being created, only a second free month, and a duplicate
       account is a duplicate Stripe subscription the venue cannot even see to cancel
     - "returning" was treated as "has ever had an account", so a venue that left two years ago
       and came back was given three days while every page promised them a month

   Best effort on purpose. Any lookup failure returns [] so a signup is never blocked by our own
   database being slow, which is the right way round: a missed duplicate is a phone call, a
   refused signup is a lost venue. */
/* AN EMAIL ADDRESS IS ONE ADDRESS HOWEVER IT IS TYPED. Postgrest's eq. is letter for letter,
   and a phone keyboard capitalises the first letter of an email about half the time. So the
   one-account-per-person guard asked for 'bob@royalhotel.com.au', never saw the row stored as
   'Bob@RoyalHotel.com.au', and let a second full-price subscription through that the owner's
   billing page could not show or cancel. The guard compared in lower case, but only over rows
   the database had already narrowed letter for letter, so that comparison could never fire.
   Found by audit, 20 Sep 2026.

   ilike matches without case. Its wildcards are * % and _, none of which may act as one here,
   so the first two become _ (which matches any ONE character, the real one included) and every
   caller still compares the rows it gets back exactly, in lower case. Over-asking by a
   character is harmless. Under-asking is a second bill. */
function vpaEmailIs(email) {
  return 'ilike.' + encodeURIComponent(String(email || '').trim().replace(/[*%\\]/g, '_'));
}

async function sbPriorAccounts(env, email, mobile, excludeId) {
  try {
    const ors = ['contact_email.' + vpaEmailIs(email)];
    if (mobile) ors.push('mobile.eq.' + encodeURIComponent(mobile));
    /* excludeId is optional. This runs BEFORE the lead row is written now, so there is usually
       nothing to exclude, and sending id=neq.undefined asks Postgrest to compare a uuid column
       against the string "undefined", which errors, returns [], and silently reports that a
       venue with three accounts has none. */
    const q = 'venueplay_founding?or=(' + ors.join(',') + ')&status=neq.pending' +
              (excludeId ? ('&id=neq.' + encodeURIComponent(excludeId)) : '') +
              '&select=id,venue_name,contact_email,mobile,created_at,status,stripe_subscription_id' +
              '&order=created_at.desc&limit=5';
    const res = await fetch(env.SUPABASE_URL + '/rest/v1/' + q, { headers: sbHeaders(env) });
    if (!res.ok) return [];
    const rows = await res.json();
    return Array.isArray(rows) ? rows : [];
  } catch (e) { return []; }
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


/* ------------------------------ Resend webhook (bounces) ---------------------------------
 *
 * THE OTHER HALF OF THE BOUNCE FLAG. vpaFireDeliveryFailure catches a message Resend
 * REFUSES at the door. This catches the one it accepts and the far end rejects a minute
 * later, which is the common case: a mailbox that is full, a staff address that was deleted
 * when somebody left, a domain that has stopped existing. Until this endpoint, an accepted
 * message was recorded as delivered and nobody ever found out.
 *
 * Resend signs with Svix. Three headers, and the signed content is
 *   `${svix-id}.${svix-timestamp}.${raw body}`
 * HMAC-SHA256 with the secret, which arrives base64 after a `whsec_` prefix. The signature
 * header can hold SEVERAL space-separated versioned signatures during a secret rotation, so
 * every v1 entry is checked and any one matching is enough.
 *
 * Verified, not trusted: this endpoint is public, and without the signature check anybody
 * could post a bounce for a venue and have us ring a customer who is perfectly fine.
 */
async function vpaVerifyResendSig(rawBody, headers, secret) {
  if (!secret) return false;
  const id = headers.get('svix-id'), ts = headers.get('svix-timestamp'), sigHeader = headers.get('svix-signature');
  if (!id || !ts || !sigHeader) return false;
  /* Same five minute tolerance as the Stripe check above, and for the same reason: without
     it a captured (body, signature) pair is valid for ever and can be replayed. */
  const t = parseInt(ts, 10);
  if (!isFinite(t) || Math.abs(Math.floor(Date.now() / 1000) - t) > 300) return false;

  const b64 = String(secret).replace(/^whsec_/, '');
  let keyBytes;
  try {
    const bin = atob(b64);
    keyBytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) keyBytes[i] = bin.charCodeAt(i);
  } catch (e) { return false; }

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, enc.encode(id + '.' + ts + '.' + rawBody));
  let mine = '';
  const bytes = new Uint8Array(mac);
  for (let i = 0; i < bytes.length; i++) mine += String.fromCharCode(bytes[i]);
  mine = btoa(mine);

  for (const part of String(sigHeader).split(' ')) {
    const bits = part.split(',');
    if (bits.length !== 2 || bits[0] !== 'v1') continue;
    const theirs = bits[1];
    if (theirs.length !== mine.length) continue;
    let diff = 0;
    for (let i = 0; i < mine.length; i++) diff |= mine.charCodeAt(i) ^ theirs.charCodeAt(i);
    if (diff === 0) return true;
  }
  return false;
}

/* Which venue does this address belong to? Best effort, and it says so: an address we
   cannot place still raises the alarm, just without a name attached. Never guessing is the
   point, because the alert tells somebody to pick up the phone. */
async function vpaVenuesForEmail(env, addr) {
  const out = [];
  const e = String(addr || '').trim().toLowerCase();
  if (!e) return out;
  try {
    const accts = await vpaSelect(env, 'venueplay_founding',
      'contact_email=' + vpaEmailIs(e) + '&select=id,contact_email') || [];
    for (const a of accts) {
      if (String(a.contact_email || '').trim().toLowerCase() !== e) continue;
      const vs = await vpaSelect(env, 'vp_venues',
        'founding_id=eq.' + encodeURIComponent(a.id) + '&select=id,name,slug,status') || [];
      for (const v of vs) out.push(v);
    }
  } catch (_) {}
  return out;
}

/* The two subjects that mean a venue is being told its games are stopping. One pattern, used
   by the bounce alert and the delivery record, so they cannot end up disagreeing about which
   emails are the important ones. Kept beside the webhook rather than next to the senders,
   because it matches what Resend reports back, not what we typed. */
const VPA_LEAVING_SUBJECT = /last day on VenuePlay|cancellation is confirmed/i;

async function vpaHandleResendWebhook(request, env, json) {
  const raw = await request.text();
  const ok = await vpaVerifyResendSig(raw, request.headers, env.RESEND_WEBHOOK_SECRET);
  /* 401, not 400: an unsigned post is somebody else's, and Resend retries on 5xx only. */
  if (!ok) return json({ error: 'bad signature' }, 401);

  let ev = null;
  try { ev = JSON.parse(raw); } catch (e) { return json({ error: 'bad json' }, 400); }
  const type = String((ev && ev.type) || '');
  /* bounced and complained always matter. delivered matters for ONE thing: the two emails
     that decide whether a venue knows its games are stopping.

     Dean, 17 Sep 2026, after a last-day email was recorded as delivered, reported to him as
     delivered, and found in his Outlook junk folder: we could not tell "arrived" from "never
     arrived" at all. This closes half that gap. It cannot see a junk folder, and nothing can,
     but it can say whether Microsoft took it.

     Everything else is still dropped. opened and clicked would fill this table at the rate we
     send, and delivered on every welcome and receipt would do the same. */
  if (type === 'email.delivered') {
    const dd = (ev && ev.data) || {};
    const subj = String(dd.subject || '');
    if (!VPA_LEAVING_SUBJECT.test(subj)) return json({ ok: true, ignored: 'delivered, not a leaving email' });
    for (const addr of (Array.isArray(dd.to) ? dd.to : (dd.to ? [dd.to] : []))) {
      const vs = await vpaVenuesForEmail(env, addr);
      await vpaInsert(env, 'vp_admin_audit', {
        actor_admin: null, actor_label: 'system',
        action: 'venue_leaving_email_delivered',
        target: vs.length ? ('venue:' + vs[0].id) : ('email:' + addr),
        /* No alert email. A leaving email arriving is the expected case and mailing ourselves
           about it would train us to ignore the ones that matter. */
        detail: { address: addr, subject: subj, venues: vs.map(function (v) { return v.name; }) },
      }, false).catch(() => {});
    }
    return json({ ok: true });
  }
  if (type !== 'email.bounced' && type !== 'email.complained') return json({ ok: true, ignored: type });

  const d = (ev && ev.data) || {};
  const to = Array.isArray(d.to) ? d.to : (d.to ? [d.to] : []);
  const subject = String(d.subject || '');
  const bounce = d.bounce || {};
  const reason = String(bounce.message || bounce.subType || bounce.type || d.reason || '').slice(0, 300);
  const complained = type === 'email.complained';

  for (const addr of to) {
    const venues = await vpaVenuesForEmail(env, addr);
    const named = venues.map((v) => v.name).filter(Boolean).join(', ');
    /* A LEAVING EMAIL BOUNCING IS THE EMERGENCY. Any bounce is worth recording, but the two
       that decide whether a venue knows its games are about to stop get the loud subject and
       a line telling somebody to ring them. */
    const leaving = VPA_LEAVING_SUBJECT.test(subject);
    const head = complained ? 'marked us as spam' : 'bounced';
    const html = '<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif">'
      + '<p style="font-size:18px;font-weight:800;color:' + (leaving ? '#b3261e' : '#8a6d00') + ';margin:0 0 10px">'
      +   (leaving ? 'A leaving email ' + head + '. Ring them.' : 'An email ' + head + '.') + '</p>'
      + '<p style="margin:0 0 6px;font-size:14px"><b>Address:</b> ' + vpaEsc(addr) + '</p>'
      + '<p style="margin:0 0 6px;font-size:14px"><b>Venue:</b> ' + vpaEsc(named || 'could not match this address to an account') + '</p>'
      + '<p style="margin:0 0 6px;font-size:14px"><b>Subject:</b> ' + vpaEsc(subject || '(none)') + '</p>'
      + (reason ? '<p style="margin:0 0 6px;font-size:14px"><b>Reason:</b> ' + vpaEsc(reason) + '</p>' : '')
      + (leaving
          ? '<p style="margin:14px 0 0;font-size:14px">They do not know their games are stopping. '
            + 'Get a working address onto the account and resend from HQ, and if the last day is '
            + 'close, ring them today.</p>'
          : '<p style="margin:14px 0 0;font-size:14px">Worth getting a working address on the account '
            + 'before the next one matters.</p>')
      + '</div>';
    for (const who of VPA_CANCEL_ALERTS) {
      await vpaSendEmail(env, who,
        (leaving ? 'ACTION NEEDED: leaving email ' + head + ' - ' : 'Email ' + head + ' - ')
        + (named || addr), html).catch(() => false);
    }
    await vpaInsert(env, 'vp_admin_audit', {
      actor_admin: null, actor_label: 'system',
      action: complained ? 'email_marked_spam' : 'email_bounced',
      target: venues.length ? ('venue:' + venues[0].id) : ('email:' + addr),
      detail: { address: addr, subject: subject, reason: reason, leaving: leaving,
                venues: venues.map((v) => v.name) },
    }, false).catch(() => {});
  }
  return json({ ok: true });
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
      let keys = env ? await vpaFetchJwks(env) : [];
      let jwk = keys.find(function (k) { return k.kid === header.kid; });
      if (!jwk && env) { _vpaJwks = null; keys = await vpaFetchJwks(env); jwk = keys.find(function (k) { return k.kid === header.kid; }); }   // a key rotated since we cached
      if (!jwk) jwk = keys[0];
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

/* EVERY ROW, NOT THE FIRST THOUSAND.

   PostgREST stops at 1000 rows on this project, with no error and nothing in the response
   to say so: vp_questions holds 37,665 and a plain select returns 1,000. Measured 18 Sep
   2026. Any read that can legitimately run past a thousand has to page.

   ADVANCE BY WHAT CAME BACK, and stop only on an EMPTY page, the same as sbGetAll in the
   game Worker. Stopping on a short page is wrong for exactly the reason this exists:
   Supabase's own max-rows may be lower than the page size asked for, so every page is
   short, the loop stops after one, and the truncation is silent all over again. */
/* PAGES, AND FAILS CLOSED.

   This was built on vpaSelect, which returns [] on ANY non-2xx. A paging loop reads that as
   "no more pages", so one transient Supabase error halfway through an opt-in export handed the
   venue a SHORT copy of its own customer list, with nothing anywhere saying so. That is the
   exact fault the paging was added to remove, reintroduced by building it on something that
   fails open. So it does its own fetch and it THROWS. The game Worker's sbGetAll was always
   safe this way, because sbGet throws; only billing had the hole. Player data is tier one.

   Stops only on an EMPTY page, never a short one. Supabase's own max-rows can sit below the
   page size asked for, so every page can come back short, and breaking on a short page would
   truncate after the first one. */
async function vpaSelectAll(env, table, query, pageSize) {
  const size = pageSize || 1000;
  /* 200 pages, not 40. At 40 an export of EXACTLY 40,000 rows threw on a complete list,
     because the loop used its last iteration on real data and never got to see the empty
     page that proves the end. The cap is a runaway guard, not a size limit, so it should
     sit far above any real list. */
  const CAP = 200;
  let out = [], offset = 0, sawTheEnd = false;
  for (let page = 0; page < CAP; page++) {
    const res = await fetch(env.SUPABASE_URL + '/rest/v1/' + table + '?' + query +
      '&limit=' + size + '&offset=' + offset, { headers: vpaHeaders(env) });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error('read ' + table + ' page ' + page + ' at offset ' + offset +
                      ': ' + res.status + ' ' + body.slice(0, 200));
    }
    const rows = await res.json();
    /* NOT A LIST IS NOT THE END OF THE LIST. These two were one test, so a 200 carrying
       anything but an array (an error object, a proxy's HTML page parsed as nothing useful)
       read as "no more rows" and the caller got a short or empty list with no error. For the
       unsubscribe list that means "nobody has opted out". Only an EMPTY ARRAY ends the read. */
    if (!Array.isArray(rows)) {
      throw new Error('read ' + table + ' page ' + page + ': the database answered with something that is not a list');
    }
    if (rows.length === 0) { sawTheEnd = true; break; }
    out = out.concat(rows);
    offset += rows.length;
  }
  /* Do not truncate quietly at the page cap either. The ONLY proof that a list is complete
     is an EMPTY page. This used to ask "was the last page full?", which is a different
     question and a wrong one: when Supabase's own max-rows sits BELOW the page size we
     asked for, every page is short by construction, the flag is never set, and the cap
     truncates in silence. That is the exact fault this function exists to prevent, arriving
     by another route. Ask whether we actually saw the end. */
  if (!sawTheEnd) {
    throw new Error('read ' + table + ': more than ' + out.length +
                    ' rows, page cap of ' + CAP + ' reached before the end of the list');
  }
  return out;
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

/* One login by id, best-effort. Used to put the last digits of a mobile beside a name on the
   Hosts list so two Sams can be told apart. Returns null on any failure: the list must still
   render when Auth is slow, it just shows the name alone. */
async function vpaAuthGetUser(env, id) {
  if (!id) return null;
  try {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 4000);
    const res = await fetch(env.SUPABASE_URL + '/auth/v1/admin/users/' + encodeURIComponent(id),
      { headers: vpaHeaders(env), signal: abort.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    return await res.json().catch(() => null);
  } catch (e) { return null; }
}
/* "ending 123": enough to tell staff apart, never enough to dial. */
function vpaMaskMobile(phone) {
  const d = String(phone || '').replace(/[^\d]/g, '');
  return d.length >= 3 ? d.slice(-3) : null;
}

// --- misc helpers ---
function vpaSlugify(s) {
  return String(s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/* THE SLUG IS THE VENUE'S IDENTITY, AND AUSTRALIA REUSES PUB NAMES CONSTANTLY.

   Measured against the 18,567 licensed venues in the prospect database: 376 names
   are shared by more than one venue, covering 1,376 venues, about seven per cent.
   There are 100 Royal Hotels, 68 Commercials, 37 Railways, 24 Imperials. That
   list is comprehensive for NSW and partial elsewhere, so the real figure is
   higher than seven per cent, not lower.

   This matters more than a tidy URL. The venue's join code is a hash of its slug,
   so two venues sharing a slug share a code, and the game Worker refuses a code it
   cannot attribute: BOTH venues lose the ability to be joined. The slug also goes
   on printed table talkers, so it can never be corrected after the fact.

   The old fallback appended six characters of a UUID, which gave the second Royal
   Hotel royal-hotel-a1b2c3 on its signage, and checked only once: if that name was
   somehow taken too, it was returned anyway.

   So the postcode separates them, which is Dean's suggestion and the right one.
   Every venue has one (it is what sets the state for gaming rules and founding
   pricing), it is meaningful to the venue itself, and it reads on a sign:

       royal-hotel                first one in
       royal-hotel-2026           the Bondi one
       royal-hotel-2026-2         two Royals in the same postcode, which happens
       royal-hotel-2026-a1b2c3    nine of them, which does not

   Existing venues are untouched. This only decides the name a NEW venue gets. */
async function vpaSlugTaken(env, slug) {
  const rows = await vpaSelect(env, 'vp_venues', 'slug=eq.' + encodeURIComponent(slug) + '&select=id&limit=1');
  return !!(rows && rows.length);
}

async function vpaUniqueSlug(env, base, seed, postcode) {
  const pc = String(postcode || '').replace(/\D/g, '').slice(0, 4);
  const stem = base || ('venue-' + String(seed || '').replace(/[^a-z0-9]/gi, '').slice(0, 8));

  if (!(await vpaSlugTaken(env, stem))) return stem;

  if (pc) {
    const withPc = stem + '-' + pc;
    if (!(await vpaSlugTaken(env, withPc))) return withPc;
  }

  // Two venues of the same name in the same postcode. Rare, and it does happen.
  const root = pc ? stem + '-' + pc : stem;
  for (let n = 2; n <= 9; n++) {
    const cand = root + '-' + n;
    if (!(await vpaSlugTaken(env, cand))) return cand;
  }

  /* Nine of them. Something is wrong, but a signup must not fail over a name, so
     fall back to what cannot collide and let it be ugly. */
  return root + '-' + String(seed || Date.now()).replace(/[^a-z0-9]/gi, '').slice(0, 6);
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


/* WHAT THE VENUE SAYS IT IS, THE COMPLIANCE TICK, AND THE PERMITS IT HOLDS.

   Anisimoff Legal, ref 9380. 1 Oct 2026, point 3: compliance is the venue's, and "it would
   also be prudent to ensure Customers actively tick a check box ... confirming that they will
   be responsible for compliance". Point 5: keeping a record of the permits/licences/authorities
   a venue holds, so a manual check is possible, is prudent. 8 Oct 2026, point 1(a): Victoria's
   s8.4.4 bans supplying bingo tickets or a generator to anyone without a minor gaming permit,
   and point 4 says recording VIC permit numbers is prudent. Dean, 15 Oct 2026: build all of it.

   One shape, in one place. Onboarding (/admin/venue), HQ (/admin/venue-gaming and
   /admin/venue-compliance) and the venue's settings page (/account/permits) all come through
   here, and vp-gaming.js permitRecorded applies the SAME recorded rule on the console, so a
   change to either is a change to both. Migration 100 holds the columns. */
const VPA_VENUE_KINDS = ['pub', 'hotel', 'club', 'rsl', 'charity', 'association', 'other'];
const VPA_PERMIT_KINDS = ['bingo', 'raffle', 'members'];
/* The tick, word for word. The two onboarding pages show this sentence and a suite checks they
   show THIS one, because a tick that reads differently from the record of it is not a record. */
const VPA_COMPLIANCE_TICK = 'We are responsible for complying with the gaming laws that apply to our venue, including any permit, licence or authority, age limits and attendance rules. VenuePlay supplies the software only.';
/* The Terms a console acceptance is of: the effective date on venueplay/terms.html. A suite holds
   the two equal, so the record never names a version the page is not showing. */
const VPA_TERMS_EFFECTIVE = '28 October 2026';
/* What a venue_kind suggests for entity_type. A SUGGESTION HQ sees beside its own dropdown,
   never written to entity_type by anything: migration 44's rule that HQ sets what a venue is,
   by hand, stands. A charity or association is a non-profit; a pub or hotel is a business;
   "other" says nothing. */
function vpaEntitySuggestion(kind) {
  if (kind === 'club' || kind === 'rsl' || kind === 'charity' || kind === 'association') return 'non_profit';
  if (kind === 'pub' || kind === 'hotel') return 'for_profit';
  return null;
}
/* RECORDED means: a permit number, OR an NPO named with the date it authorised the venue. The
   second form is the NSW letter's point 7 (a pub runs a paid raffle under the charity's
   authority, with the charity's written authorisation), where the pub has no number of its
   own to write down. Interface 1 of the 15 Oct 2026 build; vp-gaming.js says the same. */
function vpaPermitRecorded(permits, kind) {
  const p = permits && typeof permits === 'object' ? permits[kind] : null;
  if (!p || typeof p !== 'object') return false;
  if (String(p.number || '').trim()) return true;
  return p.holder === 'npo' && !!String(p.npo_name || '').trim() && /^\d{4}-\d{2}-\d{2}$/.test(String(p.authorised_on || ''));
}
/* One permit, cleaned, or a reason it was refused. Strings are capped because this lands in a
   jsonb column a browser form writes; a date must be a real YYYY-MM-DD so "12/03/2026" cannot
   be stored as something the recorded rule then reads as no date at all. */
function vpaCleanPermit(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'A permit must be an object with number, holder, npo_name, authorised_on, expires and note.' };
  const str = (v, max, what) => {
    if (v == null) return '';
    if (typeof v !== 'string') throw new Error(what + ' must be text.');
    const s = v.trim();
    if (s.length > max) throw new Error(what + ' is too long (' + max + ' characters at most).');
    return s;
  };
  const date = (v, what) => {
    if (v == null || v === '') return '';
    if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error(what + ' must be a date written YYYY-MM-DD.');
    const d = new Date(v + 'T00:00:00Z');
    if (isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) throw new Error(what + ' is not a real date.');
    return v;
  };
  try {
    const holder = raw.holder == null || raw.holder === '' ? 'venue' : raw.holder;
    if (holder !== 'venue' && holder !== 'npo') return { ok: false, error: "holder must be 'venue' (we hold it) or 'npo' (a charity or non-profit holds it and we run the game for them)." };
    const permit = {
      number: str(raw.number, 80, 'The permit number'),
      holder: holder,
      npo_name: str(raw.npo_name, 120, 'The charity or non-profit name'),
      authorised_on: date(raw.authorised_on, 'The authorised-on date'),
      expires: date(raw.expires, 'The expiry date') || null,
      note: str(raw.note, 500, 'The note'),
    };
    if (holder === 'npo' && !permit.npo_name && !permit.number) return { ok: false, error: 'Name the charity or non-profit whose authority you run the game under.' };
    const empty = !permit.number && !permit.npo_name && !permit.authorised_on && !permit.expires && !permit.note;
    return { ok: true, permit: permit, empty: empty };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}
/* A query-string value without new URL(), which the jsc test shell does not have. */
function vpaQueryParam(request, name) {
  const m = new RegExp('[?&]' + name + '=([^&#]*)').exec(String(request.url || ''));
  return m ? decodeURIComponent(m[1].replace(/\+/g, ' ')) : '';
}

/* ===========================================================================
 * 1) POST /admin/venue   (owner | accounts)
 *    Onboard a venue: founding record (independent) OR link to a group, plus
 *    vp_venues (+ slug), default vp_venue_settings, a vp_screens row, and an
 *    optional first-manager Auth user + vp_venue_staff row. Then an audit row.
 *    Body (from hq.html and onboard.html):
 *      { name, slug, timezone, postcode,
 *        entity_type: 'non_profit'|'for_profit'   (club or pub, the signup question; required)
 *        venue_kind?: 'pub'|'hotel'|'club'|'rsl'|'charity'|'association'|'other' (optional; derived
 *                     from entity_type when absent, for the HQ compliance card)
 *        compliance: { accepted: true, by: 'name of who agreed' },
 *        billing:{ type:'founding'|'group', group_id?, included_players?,
 *                  founding?:{ contact_email, mobile, postcode, max_seats, plan },
 *                  founding_id? (link an EXISTING venueplay_founding row instead) },
 *        manager?:{ mobile?, email?, display_name } }
 *    -> { ok:true, venue:{id,name,slug}, founding_id?, manager?:{auth_user_id} }
 *    Refused without the compliance tick and a club-or-pub answer: a venue we cannot say accepted
 *    the gaming laws as its own is not one we onboard (Anisimoff, 1 Oct 2026, point 3).
 * ======================================================================== */
async function vpaHandleVenue(request, env, json) {
  const actor = await vpaRequireAdmin(request, env, ['owner', 'accounts']);
  if (actor.error) return json({ error: actor.error }, actor.status);

  const _b = await vpaBody(request, json);
  if (!_b.ok) return _b.res;
  const b = _b.body;
  const name = (b.name || '').trim();
  const slugIn = vpaSlugify(b.slug || b.name);
  /* Only what HQ actually sent. The fallback is decided below, once the postcode has
     been read, because "no timezone was supplied" is not a reason to assume Queensland. */
  const timezoneIn = String(b.timezone || '').trim();
  const billing = b.billing || {};

  if (!name) return json({ error: 'Venue name is required.' }, 400);
  if (!slugIn) return json({ error: 'A screen slug is required.' }, 400);
  if (billing.type !== 'founding' && billing.type !== 'group') {
    return json({ error: "billing.type must be 'founding' or 'group'." }, 400);
  }
  /* THE ACTIVE TICK, before anything is created. HQ reads the sentence to the venue on the
     onboarding call and ticks it in their name; onboard.html does the same. An onboarding
     that skipped it used to leave a venue with no record that it ever accepted the gaming
     laws as its own, which is the one record the lawyer asked for. Nothing is written
     before this line passes, so a refusal here leaves no half-made venue. */
  const comp = (b.compliance && typeof b.compliance === 'object') ? b.compliance : {};
  if (comp.accepted !== true) {
    return json({ error: 'Tick the compliance line first. The venue must accept that it is responsible for the gaming laws that apply to it; VenuePlay supplies the software only. Nothing was created.' }, 400);
  }
  const acceptedBy = String(comp.by || '').trim().slice(0, 120);
  if (!acceptedBy) return json({ error: 'Enter the name of the person at the venue who accepted the compliance line, so the record says who said it.' }, 400);
  /* CLUB OR PUB, the same two-option question signup asks (audit 20 Oct 2026, C4). HQ's form used
     to ask a seven-option "what the venue is, in their words" that never set entity_type, so every
     hand-onboarded venue arrived with no club-or-pub answer and HQ had to remember to set it. The
     answer now IS entity_type, and paid entry defaults from it exactly as at signup. venue_kind
     stays for the HQ compliance card: what was sent, else what the answer implies. */
  const entityType = b.entity_type;
  if (entityType !== 'non_profit' && entityType !== 'for_profit') {
    return json({ error: 'Ask them: is the venue a club (RSL, bowls, leagues, non-profit) or a pub (hotel or tavern)? Nothing was created.' }, 400);
  }
  const kindIn = String(b.venue_kind || '').trim();
  if (kindIn && VPA_VENUE_KINDS.indexOf(kindIn) === -1) {
    return json({ error: 'venue_kind must be one of ' + VPA_VENUE_KINDS.join(', ') + '.' }, 400);
  }
  const venueKind = kindIn || (entityType === 'non_profit' ? 'club' : 'pub');

  const slug = await vpaUniqueSlug(env, slugIn, name, String((b.postcode || '')).replace(/\D/g, '').slice(0, 4));
  let foundingId = null;
  let foundingRow = null;
  // HQ's Add venue form has always offered a comp/demo tick and this Worker has always ignored
  // it: every hand-onboarded venue was written 'active' and quietly counted as a signed-up venue.
  // It also decides which welcome email goes out, so it has to be read before either.
  const isComp = billing.comp === true;
  let compFellBack = false;
  /* The postcode is what sets au_state, and au_state is what decides which state's gaming rules
     a venue is shown and whether the paper-ticket rule applies to it. HQ's Add venue form now
     REQUIRES a postcode and sends it, but this row never read it, so every hand-onboarded venue
     had a null state and the whole compliance feature was inert for exactly those venues. The
     self-serve path (vpaProvisionOneVenue) has always done this correctly; this is it catching up. */
  const venuePostcode = String((b.postcode || '')).replace(/\D/g, '').slice(0, 4);
  /* HQ's Add venue form does not ask for a timezone, so this used to write Brisbane for
     every hand-onboarded venue in the country. The postcode it DOES require is enough to
     work it out, and it is the same helper the self-serve path uses, so the two cannot
     disagree about what time it is at the same venue. */
  const timezone = timezoneIn || vpaTimezoneFromPostcode(venuePostcode);
  const venueRow = { name: name, slug: slug, timezone: timezone,
    /* Migration 100. What they said they are, and the tick with a name and a time on it. */
    venue_kind: venueKind,
    entity_type: entityType,
    compliance_accepted_at: new Date().toISOString(),
    compliance_accepted_by: acceptedBy };
  let linkedFounding = false;   // true when billing.founding_id named an existing record
  // entity_type is the venue's own answer, asked on the call (above). A guess must never occupy
  // this column: see vpaProvisionOneVenue.
  if (venuePostcode) {
    venueRow.postcode = venuePostcode;
    const st = (typeof vpaStateFromPostcode === 'function') ? vpaStateFromPostcode(venuePostcode) : null;
    if (st) venueRow.au_state = st;
  }
  // Paid entry defaults from what the venue is and where, the same rule as self-serve signup.
  venueRow.paid_entry_enabled = vpaPaidEntryDefault(entityType, venueRow.au_state || null);

  if (billing.type === 'group') {
    const groupId = billing.group_id;
    if (!groupId) return json({ error: 'A group_id is required for a grouped venue.' }, 400);
    venueRow.group_id = groupId;
    if (billing.included_players != null && billing.included_players !== '') {
      venueRow.included_players = parseInt(billing.included_players, 10) || null;
      // Everything that DISPLAYS a plan reads vp_venues.max_players (see below).
      venueRow.max_players = venueRow.included_players;
    }
  } else if (billing.founding_id) {
    /* LINK, DO NOT CREATE. onboard.html's independent path names a venueplay_founding row that
       already exists (a venue that signed up on the page and whose venue row never got made).
       Until 15 Oct 2026 that page inserted vp_venues straight through the browser client, so
       those venues got no au_state from their postcode, no audit row and no compliance record.
       Now it comes through here like every other onboarding. The welcome email is NOT sent for
       a linked record: that venue was welcomed when it signed up, and HQ has Resend welcome. */
    const fid = String(billing.founding_id).trim();
    const have = await vpaSelect(env, 'venueplay_founding',
      'id=eq.' + encodeURIComponent(fid) + '&select=id,max_seats,contact_email,status');
    const row = have && have[0];
    if (!row) return json({ error: 'That founding record id was not found. Check the uuid in venueplay_founding.' }, 400);
    foundingId = row.id;
    venueRow.founding_id = foundingId;
    venueRow.max_players = row.max_seats || null;
    linkedFounding = true;
  } else {
    // Independent: create the founding/subscription record first.
    const f = billing.founding || {};
    if (!f.contact_email || String(f.contact_email).indexOf('@') === -1) {
      return json({ error: 'A contact email is required for an independent venue.' }, 400);
    }
    foundingRow = {
      venue_name: name,
      contact_email: (f.contact_email || '').trim(),
      mobile: (f.mobile || '').trim() || null,
      postcode: (f.postcode || '').trim() || null,
      max_seats: (f.max_seats != null && f.max_seats !== '') ? (parseInt(f.max_seats, 10) || null) : null,
      plan: (f.plan === 'annual' ? 'annual' : 'monthly'),
      marketing_opt_in: false,
      // Admin-onboarded venues have no Stripe card in this flow. 'active' makes the venue live
      // and counts it in venueplay_spots_taken; the welcome email below is what then asks for
      // the card. A comp/demo venue is live too, but must NOT be counted as a signed-up venue,
      // which is exactly what the tick in HQ promises.
      status: isComp ? 'comp' : 'active',
    };
    let created = null;
    try {
      created = await vpaInsert(env, 'venueplay_founding', foundingRow);
    } catch (e) {
      // venueplay_founding predates this Worker and may still carry a CHECK on status that has
      // never seen 'comp'. Losing the whole onboarding over one label is worse than the label:
      // fall back to 'active' and say so loudly, in the response and in the audit, so nobody
      // believes a spot was saved when it was not.
      if (!isComp) throw e;
      compFellBack = true;
      foundingRow.status = 'active';
      created = await vpaInsert(env, 'venueplay_founding', foundingRow);
    }
    foundingId = created && created.id;
    venueRow.founding_id = foundingId;
    /* The cap has to live on the VENUE, not just the founding row. Every self-serve path writes
       vp_venues.max_players (vpaProvisionOneVenue does it); vpaHandleVenue never has, so a venue
       onboarded by hand opened its own billing page and was told it had 0 players and a $0 plan.
       Metering was never wrong (the game Worker falls back to founding.max_seats when this is
       null) but the venue was being shown a plan it does not have. */
    venueRow.max_players = foundingRow.max_seats || null;
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

  // Welcome email. NOT the self-serve one: nobody went through Checkout here, so a paying venue
  // gets the flavour that asks for the card (with a signed link back to a Checkout for this exact
  // founding row) and a comp venue gets the same email with the billing talk stripped out. Only
  // for independent venues: a grouped venue bills through its operator, who onboards it themselves.
  // Best-effort, and after the audit, so a Resend outage can never cost us the venue record.
  let welcomeSent = false;
  if (foundingId && !linkedFounding && b.send_welcome !== false) {
    welcomeSent = await vpaFireHqWelcome(env, {
      foundingId: foundingId,
      email: foundingRow && foundingRow.contact_email,
      venueName: name,
      slug: slug,
      seats: foundingRow && foundingRow.max_seats,
      plan: foundingRow && foundingRow.plan,
      postcode: venuePostcode || (foundingRow && foundingRow.postcode) || '',
      venueKind: venueKind,
      comp: isComp,
    });
  }

  await vpaAudit(env, actor, 'venue_onboarded', 'venue:' + venue.id, {
    name: name, slug: slug, billing: billing.type,
    founding_id: foundingId || undefined, founding_linked: linkedFounding || undefined,
    manager_created: !!managerOut,
    comp: isComp || undefined, comp_status_fallback: compFellBack || undefined,
    welcome_sent: welcomeSent,
    /* The record of the tick lives on the venue row; the audit says it was taken, by whom. */
    venue_kind: venueKind, entity_type: entityType, compliance_accepted_by: acceptedBy,
  });

  const out = { ok: true, venue: { id: venue.id, name: venue.name, slug: venue.slug } };
  if (foundingId) out.founding_id = foundingId;
  if (managerOut) out.manager = managerOut;
  out.welcome_sent = welcomeSent;
  if (compFellBack) {
    out.warning = 'The venue is set up, but the database would not accept a comp status, so it is marked active and IS counted as a signed-up venue. Fix the status by hand.';
  }
  return json(out);
}

/* ===========================================================================
 * POST /admin/prospect   (owner | accounts)        HQ > Venues > Set up a prospect
 *
 * Dean, 28 Oct 2026: "I want it so easy that they will never want to speak to me... when we set
 * up the account that is all that we need to do." A venue replies "yes, tell me more" to a cold
 * email; ONE action here builds everything a paying venue onboarded from HQ has, and sends ONE
 * email that gets them running on their own:
 *   - the account record (venueplay_founding, 'active', monthly, max_seats = their usual crowd,
 *     no card: the welcome's secure card link starts the free month, exactly as /admin/venue does)
 *   - the venue (state, timezone and paid-entry default from the postcode, club or pub, plan cap)
 *   - an EMAIL login for the contact (and their mobile on the same login, if given), linked as the
 *     venue's manager, so index.html's email code (shouldCreateUser:false) finds them
 *   - their screen ads, if HQ attached any (PNG or JPEG, up to VPB_MAX_SLIDES, at the slide spec)
 *   - compliance PENDING. Nobody read the compliance line to them on a call, so it is NOT ticked in
 *     their name (Anisimoff Legal 9380, 1 Oct 2026, point 3: the venue actively ticks). The venue
 *     gets terms_required = true (migration 122) and no compliance_accepted_at: the console shows
 *     the Terms card in place of the game picker and the game Worker refuses to start a game until
 *     the owner or a manager ticks it. The TV keeps showing their ads.
 *   - one vp_admin_audit row saying who set it up and what was made.
 * Everything is checked BEFORE anything is written, so a refusal leaves nothing half-made.
 * Body: { name, first_name?, email, mobile?, phone?, postcode, entity_type: 'non_profit'|'for_profit',
 *         players? (default 10), website?, call_requested?, slides?: ['data:image/png;base64,...', ...], send_welcome? }
 *   phone (29 Oct 2026, migration 125): the number to RING them on, a mobile or a landline. Not a
 *   login. Optional; empty falls back to the mobile. It goes on their vp_prospects row for HQ > Prospects.
 * -> { ok, venue:{id,name,slug}, founding_id, tv_url, login:{email, mobile?}, slides, welcome_sent, warnings? }
 * ======================================================================== */
/* TEN, NOT A GUESS (Dean, 29 Oct 2026): "Never guess a crowd size: a bigger number overcharges them."
   The plan is priced on this number, so a prospect starts small and the venue raises it themselves. */
const VPA_PROSPECT_DEFAULT_PLAYERS = 10;
const VPA_PROSPECT_MAX_PLAYERS = 2000;
const VPA_PROSPECT_SLIDE_SECONDS = 8;
const VPA_PROSPECT_DEFAULT_DELAY_MIN = 90;
/* THE AUTOPILOT'S FLOOR (Dean, 29 Oct 2026): its welcome goes 30 minutes after the reply it follows, so HQ
   still has half an hour to cancel it; the Mac job's queue books the minute (send_in_minutes). */
const VPA_PROSPECT_AUTOPILOT_DELAY_MIN = 30;
const VPA_PROSPECT_MAX_DELAY_MIN = 1440;
/* A slide's bytes, judged by the header and never by its label: PNG or JPEG only (Dean's spec for
   this form). Returns 'png' | 'jpg' | null. */
function vpaProspectSlideKind(bytes) {
  if (!bytes || bytes.length < 8) return null;
  const PNG = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
  if (PNG.every(function (x, i) { return bytes[i] === x; })) return 'png';
  if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) return 'jpg';
  return null;
}
function vpaProspectWebsite(raw) {
  let w = String(raw || '').trim().replace(/[\x00-\x1f\s]+/g, '');
  if (!w) return '';
  if (!/^https?:\/\//i.test(w)) w = 'https://' + w;
  if (!/^https?:\/\/[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?(\/[^\s]*)?$/i.test(w) || w.length > 200) return null;
  return w;
}
/* The login: ONE NEW auth user carrying the contact's email (and their mobile, if it is not already
   somebody's login). An EXISTING login is never changed and never linked from here (security review,
   28 Oct 2026): the email and mobile are typed by HQ and unverified, so attaching either to a login
   that already exists, or giving that login this venue, would hand whoever owns the typed address
   somebody else's account. vpaHandleProspect refuses an email that already signs in before anything
   is created; a mobile that already signs in is simply left off. Returns { id, mobile }. */
async function vpaProspectLogin(env, email, phone, venueName) {
  const meta = { venue: venueName };
  const u = await vpaAuthCreateUser(env, phone
    ? { email: email, email_confirm: true, phone: phone, phone_confirm: true, user_metadata: meta }
    : { email: email, email_confirm: true, user_metadata: meta });
  return { id: u.id, mobile: !!phone };
}

async function vpaHandleProspect(request, env, json) {
  const actor = await vpaRequireAdmin(request, env, ['owner', 'accounts']);
  if (actor.error) return json({ error: actor.error }, actor.status);
  const _b = await vpaBody(request, json);
  if (!_b.ok) return _b.res;
  return await vpaProspectSetUp(env, actor, _b.body, json, null);
}

/* ===========================================================================
 * POST /autopilot/prospect   header X-Autopilot-Key   (Dean, 29 Oct 2026)
 *
 * "something that auto does instantly and sets the customers up". The Mac job
 * ~/venue-enrich/prospect-autopilot.py prepares each interested Instantly reply (slides from the
 * venue's site, the reply, the setup) and sends NOTHING until Dean says yes; on his yes it calls this
 * route. It is the SAME setup as HQ's Set up a prospect (vpaProspectSetUp, one copy), with two
 * differences and no others:
 *   - the caller is the Mac job, proved by a secret (PROSPECT_AUTOPILOT_KEY, set with
 *     tools/set-worker-secret.py), not an HQ login. Unset = the route is off (503). A wrong or missing
 *     key = 401 and nothing is read or made. The key can do THIS and nothing else.
 *   - their welcome always waits at least VPA_PROSPECT_AUTOPILOT_DELAY_MIN (30) minutes, so it sits in
 *     HQ > Venues > prospect welcomes, where it can be cancelled or sent now, whatever the body says.
 * Every refusal stays: an email that already signs in is refused, a mobile already in use is left off,
 * the same venue twice is refused, and { dry_run: true } runs every one of those checks and makes nothing.
 * ======================================================================== */
const VPA_AUTOPILOT_ACTOR = { actorId: null, role: 'autopilot', label: 'Prospect autopilot (on Dean\'s yes)' };
function vpaSameSecret(a, b) {
  a = String(a || ''); b = String(b || '');
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}
async function vpaAutopilotProspect(request, env, json) {
  const no = vpaAutopilotKeyRefusal(request, env, json);   // one door check for every /autopilot/ route
  if (no) return no;
  const _b = await vpaBody(request, json);
  if (!_b.ok) return _b.res;
  return await vpaProspectSetUp(env, VPA_AUTOPILOT_ACTOR, _b.body, json, { minDelayMin: VPA_PROSPECT_AUTOPILOT_DELAY_MIN, via: 'autopilot_prospect' });
}

/* ===========================================================================
 * DEAN'S YES / NO / EDIT BUTTONS ON THE PROSPECT REVIEW EMAIL   (Dean, 29 Oct 2026; migration 128)
 *
 * "can they just have a button to say yes no or edit maybe? I can't copy and paste a command every
 * time I get this. It's too much." Dean reads the review on his phone. Until now saying yes meant
 * pasting `prospect-autopilot.py --approve <folder>` into a terminal.
 *
 * The Worker only RECORDS what Dean chose. It sends nothing to a venue and makes no account: the Mac
 * job (~/venue-enrich/prospect-autopilot.py) fetches each decision on its 5-minute run and calls its
 * own approve() or reject(), the same code as the command line, with every check that code makes
 * (reply edited for a question, the thread re-read, the blocklist, the Worker dry run). One copy.
 *
 *   POST /autopilot/review/register   X-Autopilot-Key  the Mac registers a review (venue, their words,
 *                                                      the reply) and gets back the three signed links
 *   GET  /autopilot/review?f&a&r&x&t  the page behind a button. NEVER WRITES: Outlook SafeLinks, Gmail
 *                                      and corporate scanners fetch every link before a human sees it
 *   POST /autopilot/review?f&a&r&x&t  the button on that page: records the decision, once
 *   GET  /autopilot/decisions         X-Autopilot-Key  decisions the Mac has not applied yet
 *   POST /autopilot/decisions/done    X-Autopilot-Key  { folder, round, result, note }: applied, once
 *
 * THE LINK is signed: HMAC-SHA256 keyed 'vp-review:' + PROSPECT_AUTOPILOT_KEY over
 * folder|action|expiry|round, hex, first 32. Seven days. A link for Yes cannot be edited into a link
 * for anything else without the key. No key on the Worker = every link is refused (never "any token
 * will do"). The key itself never leaves the Worker and the Mac.
 *
 * ONCE. The first decision for a round wins: a conditional update (decision is null) so two taps, or
 * two phones, record one. The Mac marks a decision applied with a conditional update too, and keeps
 * its own record, so a decision is applied once, ever. When the Mac HOLDS a yes (a check failed) it
 * opens a new round and emails fresh buttons; links from the old round then say so and do nothing.
 * ======================================================================== */
const VPA_REVIEW_DAYS = 7;
const VPA_REVIEW_ACTIONS = { yes: 'yes', no: 'no', edit: 'edit' };
const VPA_REVIEW_FOLDER_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
const VPA_REVIEW_MAX = 20000;

async function vpaReviewToken(env, folder, action, exp, round) {
  const key = await crypto.subtle.importKey('raw',
    new TextEncoder().encode('vp-review:' + String(env.PROSPECT_AUTOPILOT_KEY || '')),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key,
    new TextEncoder().encode(String(folder) + '|' + String(action) + '|' + String(exp) + '|' + String(round)));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

async function vpaReviewLinks(env, folder, exp, round) {
  const base = vpUnsubApi(env) + '/autopilot/review?f=' + encodeURIComponent(folder);
  const out = {};
  for (const a of Object.keys(VPA_REVIEW_ACTIONS)) {
    out[a] = base + '&a=' + a + '&r=' + round + '&x=' + exp + '&t=' + (await vpaReviewToken(env, folder, a, exp, round));
  }
  return out;
}

/* The Mac's door: the same key as /autopilot/prospect, checked the same way. */
function vpaAutopilotKeyRefusal(request, env, json) {
  const want = String(env.PROSPECT_AUTOPILOT_KEY || '');
  if (want.length < 32) return json({ error: 'The prospect autopilot is not switched on (PROSPECT_AUTOPILOT_KEY is not set).' }, 503);
  if (!vpaSameSecret(request.headers.get('X-Autopilot-Key'), want)) return json({ error: 'Not allowed.' }, 401);
  return null;
}

async function vpaReviewRow(env, folder) {
  const rows = await vpaReadPage(env, 'vp_autopilot_reviews', 'folder=eq.' + encodeURIComponent(folder) + '&limit=1');
  return rows[0] || null;
}

/* PATCH with a filter, returning the rows it changed: [] means the filter matched nothing (someone
   got there first). Throws on a database fault so a caller never reads a failure as "already done". */
async function vpaReviewPatch(env, filter, patch) {
  const res = await fetch(env.SUPABASE_URL + '/rest/v1/vp_autopilot_reviews?' + filter, {
    method: 'PATCH', headers: { ...vpaHeaders(env), 'Prefer': 'return=representation' }, body: JSON.stringify(patch) });
  if (!res.ok) {
    const t = (await res.text().catch(function () { return ''; })).slice(0, 200);
    throw new Error('update vp_autopilot_reviews: ' + res.status + ' ' + t);
  }
  const rows = await res.json().catch(function () { return null; });
  if (!Array.isArray(rows)) throw new Error('update vp_autopilot_reviews: no rows came back');
  return rows;
}

function vpaReviewText(v, max) {
  return String(v == null ? '' : v).replace(/\r\n?/g, '\n').slice(0, max || VPA_REVIEW_MAX);
}

/* THE EDIT PAGE'S BOXES AND THE RECOMMENDATION (Dean, 30 Oct 2026; migration 130). The Mac sends what it found
   (postcode, pub or club, login email), its recommendation ("Send the standard reply" or "Edit first") and its
   warnings, each a plain sentence saying what to tap. They are kept in `details`; Dean's Postcode box, Pub / Club
   choice and Login email box go in edited_postcode, edited_entity_type and edited_login_email with his Edit.
   BEFORE MIGRATION 130 those columns do not exist, and PostgREST refuses any write or read naming them. Every
   write and read here then falls back to exactly what it did before (no boxes, no recommendation on the page),
   so the Worker can go up before the migration is run and nothing breaks. */
const VPA_REVIEW_V2_COLS = ['details', 'edited_postcode', 'edited_entity_type', 'edited_login_email'];
function vpaReviewNoV2(e) {
  return /PGRST204|42703|Could not find the '?(details|edited_\w+)'? column|column [\w.]*(details|edited_\w+) does not exist/.test(String((e && (e.message || e.body)) || e || ''));
}
function vpaReviewStrip(o) {
  const c = Object.assign({}, o);
  VPA_REVIEW_V2_COLS.forEach(function (k) { delete c[k]; });
  return c;
}
async function vpaReviewPatchV2(env, filter, patch) {
  try { return await vpaReviewPatch(env, filter, patch); }
  catch (e) {
    if (!vpaReviewNoV2(e) || !VPA_REVIEW_V2_COLS.some(function (k) { return k in patch; })) throw e;
    return await vpaReviewPatch(env, filter, vpaReviewStrip(patch));
  }
}
const VPA_REVIEW_EMAIL_RE = /^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$/;
/* What the Mac found, checked and capped. null when the Mac sent none of it (a Mac from before 30 Oct). */
function vpaReviewDetails(b) {
  const keys = ['postcode', 'entity_type', 'login_email', 'state', 'recommend', 'recommend_why', 'warnings'];
  if (!keys.some(function (k) { return b[k] !== undefined; })) return null;
  const pc = String(b.postcode == null ? '' : b.postcode).trim();
  const em = vpaReviewText(b.login_email, 200).trim().toLowerCase();
  return {
    postcode: /^\d{4}$/.test(pc) ? pc : '',
    state: vpaReviewText(b.state, 3).replace(/[^A-Za-z]/g, '').toUpperCase(),
    entity_type: (b.entity_type === 'for_profit' || b.entity_type === 'non_profit') ? b.entity_type : '',
    login_email: VPA_REVIEW_EMAIL_RE.test(em) ? em : '',
    recommend: (b.recommend === 'yes' || b.recommend === 'edit') ? b.recommend : '',
    recommend_why: vpaReviewText(b.recommend_why, 600).trim(),
    warnings: (Array.isArray(b.warnings) ? b.warnings : []).slice(0, 12).map(function (w) { return vpaReviewText(w, 600).trim(); }).filter(Boolean),
  };
}

/* POST /autopilot/review/register { folder, company, class, their_words, reply, mailbox, reply_to, reopen } */
async function vpaAutopilotReviewRegister(request, env, json) {
  const no = vpaAutopilotKeyRefusal(request, env, json);
  if (no) return no;
  const _b = await vpaBody(request, json);
  if (!_b.ok) return _b.res;
  const b = _b.body || {};
  const folder = String(b.folder || '').trim();
  if (!VPA_REVIEW_FOLDER_RE.test(folder)) return json({ error: 'folder must be the prospect folder name (letters, numbers, dot, dash, underscore).' }, 400);
  const reply = vpaReviewText(b.reply);
  if (reply.trim().length < 20) return json({ error: 'reply is required.' }, 400);
  const content = {
    company: vpaReviewText(b.company, 200) || folder, class: vpaReviewText(b.class, 40),
    their_words: vpaReviewText(b.their_words), reply: reply,
    mailbox: vpaReviewText(b.mailbox, 200), reply_to: vpaReviewText(b.reply_to, 200),
  };
  const details = vpaReviewDetails(b);
  if (details) content.details = details;
  const exp = Math.floor(Date.now() / 1000) + VPA_REVIEW_DAYS * 86400;
  const expIso = new Date(exp * 1000).toISOString();
  let row;
  try { row = await vpaReviewRow(env, folder); }
  catch (e) { return json({ error: 'Could not read the reviews table: ' + String(e.message || e) + '. Run migration 128 first.' }, 503); }
  let round;
  if (!row) {
    round = 1;
    const insert = function (c) {
      return fetch(env.SUPABASE_URL + '/rest/v1/vp_autopilot_reviews', {
        method: 'POST', headers: { ...vpaHeaders(env), 'Prefer': 'return=minimal' },
        body: JSON.stringify(Object.assign({ folder: folder, round: round, expires_at: expIso }, c)) });
    };
    let res = await insert(content);
    if (!res.ok && content.details) {
      const t = await res.text().catch(function () { return ''; });
      if (vpaReviewNoV2(t)) res = await insert(vpaReviewStrip(content));   // before migration 130
    }
    if (!res.ok) return json({ error: 'Could not save the review (' + res.status + '). Run migration 128 first.' }, 503);
  } else if (!row.decision) {
    // Not decided yet: the content and the links are refreshed, the round stays.
    round = row.round;
    const got = await vpaReviewPatchV2(env, 'folder=eq.' + encodeURIComponent(folder) + '&round=eq.' + round + '&decision=is.null',
      Object.assign({ expires_at: expIso, updated_at: new Date().toISOString() }, content)).catch(function () { return null; });
    if (!got) return json({ error: 'Could not save the review.' }, 503);
    if (!got.length) return json({ error: 'Dean decided while this was being saved. Fetch the decisions first.', decided: true }, 409);
  } else if (b.reopen === true && row.applied_at) {
    // A held decision: a NEW round, so the old links stop working and fresh buttons go to Dean.
    round = (parseInt(row.round, 10) || 1) + 1;
    const got = await vpaReviewPatchV2(env, 'folder=eq.' + encodeURIComponent(folder) + '&round=eq.' + row.round,
      Object.assign({ round: round, expires_at: expIso, updated_at: new Date().toISOString(), decision: null, decided_at: null,
        reason: null, edited_reply: null, decided_agent: null, applied_at: null, applied_result: null, applied_note: null },
        ('edited_postcode' in row) ? { edited_postcode: null, edited_entity_type: null, edited_login_email: null } : {}, content)).catch(function () { return null; });
    if (!got) return json({ error: 'Could not save the review.' }, 503);
    if (!got.length) return json({ error: 'The review changed while this was being saved. Try again.' }, 409);
  } else {
    return json({ error: 'Dean has already decided this one (' + row.decision + ')' + (row.applied_at ? '' : ' and the Mac has not applied it yet') + '.',
      decided: true, decision: row.decision }, 409);
  }
  return json({ ok: true, folder: folder, round: round, expires_at: expIso, links: await vpaReviewLinks(env, folder, exp, round) });
}

/* GET /autopilot/decisions: what Dean chose that the Mac has not applied. Oldest first. */
async function vpaAutopilotDecisions(request, env, json) {
  const no = vpaAutopilotKeyRefusal(request, env, json);
  if (no) return no;
  let rows;
  const q = function (extra) {
    return vpaReadPage(env, 'vp_autopilot_reviews', 'decision=in.(yes,no,edit)&applied_at=is.null'
      + '&select=folder,round,company,decision,decided_at,reason,edited_reply' + extra + '&order=decided_at.asc&limit=50');
  };
  try {
    try { rows = await q(',edited_postcode,edited_entity_type,edited_login_email'); }
    catch (e) { if (!vpaReviewNoV2(e)) throw e; rows = await q(''); }   // before migration 130: the decisions as before
  } catch (e) { return json({ error: 'Could not read the decisions: ' + String(e.message || e) }, 503); }
  return json({ ok: true, decisions: rows });
}

/* POST /autopilot/decisions/done { folder, round, result, note } */
async function vpaAutopilotDecisionDone(request, env, json) {
  const no = vpaAutopilotKeyRefusal(request, env, json);
  if (no) return no;
  const _b = await vpaBody(request, json);
  if (!_b.ok) return _b.res;
  const b = _b.body || {};
  const folder = String(b.folder || '').trim(), round = parseInt(b.round, 10);
  const result = String(b.result || '');
  if (!VPA_REVIEW_FOLDER_RE.test(folder) || !(round >= 1)) return json({ error: 'folder and round are required.' }, 400);
  if (['queued', 'held', 'rejected', 'already', 'failed'].indexOf(result) === -1) return json({ error: 'result must be queued, held, rejected, already or failed.' }, 400);
  let got;
  try {
    got = await vpaReviewPatch(env, 'folder=eq.' + encodeURIComponent(folder) + '&round=eq.' + round + '&decision=in.(yes,no,edit)&applied_at=is.null',
      { applied_at: new Date().toISOString(), applied_result: result, applied_note: vpaReviewText(b.note, 2000) });
  } catch (e) { return json({ error: 'Could not mark it done: ' + String(e.message || e) }, 503); }
  return json({ ok: true, marked: got.length === 1, already: got.length === 0 });
}

/* ---- the page ------------------------------------------------------------- */
function vpaReviewPage(title, inner, status) {
  const html = '<!doctype html><html lang="en-AU"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer">'
    + '<title>' + vpaEsc(title) + ' | VenuePlay</title>'
    + '<style>'
    + ':root{--bg:#0B0A0F;--card:#15131C;--card2:#1C1925;--line:rgba(255,255,255,.10);--text:#FFF1E6;--muted:#A79FB0;--pink:#FF1F8E;--green:#1DB97A;--warn:#FFCF8A;--warnbg:#3A2A12}'
    + '*{box-sizing:border-box}html,body{margin:0}'
    + 'body{background:var(--bg);color:var(--text);font:16px/1.55 Manrope,system-ui,-apple-system,"Segoe UI",sans-serif;padding:20px 16px 40px}'
    + 'main{max-width:560px;margin:0 auto}'
    + '.brand{display:flex;align-items:center;gap:9px;margin-bottom:18px;font-weight:700;font-size:15px}'
    + 'h1{font-size:24px;line-height:1.25;margin:0 0 6px}h2{font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin:22px 0 8px}'
    + 'p{margin:0 0 12px}.muted{color:var(--muted)}a{color:var(--pink)}'
    + '.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px 16px}'
    + '.words{white-space:pre-wrap;word-wrap:break-word;font-size:15px}'
    + '.what{background:var(--card2);border:1px solid var(--line);border-radius:14px;padding:14px 16px;margin-top:18px}'
    + '.what ol{margin:6px 0 0;padding-left:20px}.what li{margin:4px 0}'
    + '.warn{background:var(--warnbg);color:var(--warn);border-radius:12px;padding:12px 14px;margin:14px 0}'
    + '.err{background:#3A1420;color:#FFB3C8;border-radius:12px;padding:12px 14px;margin:14px 0}'
    + 'textarea{width:100%;min-height:340px;background:#0F0D14;color:var(--text);border:1px solid var(--line);border-radius:12px;padding:12px;font-size:15px;line-height:1.5;font-family:inherit}'
    + 'textarea.short{min-height:110px}'
    + '.rec{border-radius:12px;padding:12px 14px;margin:14px 0;border:2px solid var(--green);background:rgba(29,185,122,.10)}.rec.edit{border-color:var(--pink);background:rgba(255,31,142,.10)}'
    + '.fields{display:grid;gap:12px}.fields label{display:block;font-size:14px;color:var(--muted)}'
    + '.fields input[type=text],.fields input[type=email]{display:block;width:100%;margin-top:4px;background:#0F0D14;color:var(--text);border:1px solid var(--line);border-radius:12px;padding:12px;font:inherit;font-size:16px}'
    + '.radios{display:flex;gap:10px;margin-top:4px}.radios label{flex:1;display:flex;align-items:center;gap:8px;background:#0F0D14;border:1px solid var(--line);border-radius:12px;padding:12px;color:var(--text);font-size:16px}'
    + '.btn{display:block;width:100%;margin-top:12px;padding:16px;border:0;border-radius:12px;font:inherit;font-size:18px;font-weight:800;text-align:center;text-decoration:none;cursor:pointer}'
    + '.yes{background:var(--green);color:#06140E}.edit{background:var(--pink);color:#fff}.no{background:transparent;color:var(--text);border:2px solid rgba(255,255,255,.35)}'
    + '.btn.small{font-size:16px;font-weight:700;padding:12px}'
    + '.tag{display:block;font-size:11px;line-height:1.2;font-weight:800;letter-spacing:.1em;text-transform:uppercase;opacity:.85;margin:0 0 5px}'
    + '.top{margin:14px 0 4px}.top .btn{margin-top:0}.top p{margin:8px 0 0;font-size:14px}.choices{margin-top:4px}'
    + '.done{font-size:46px;line-height:1;margin:6px 0 10px}'
    + '.foot{margin-top:26px;padding-top:14px;border-top:1px solid var(--line);font-size:12.5px;color:var(--muted)}'
    + '</style></head><body><main>'
    + '<div class="brand"><svg width="18" height="21" viewBox="0 0 26 30" fill="none" aria-hidden="true">'
    + '<path d="M2 3 L24 15 L2 27 Z" fill="none" stroke="#FF1F8E" stroke-width="2.6" stroke-linejoin="round"/></svg>VenuePlay prospect review</div>'
    + inner
    + '<p class="foot">Only you get these links. Nothing is sent to a venue from this page: your Mac does that, '
    + 'after every check, and emails you what it did.</p>'
    + '</main></body></html>';
  return new Response(html, { status: status || 200,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store',
               'x-robots-tag': 'noindex', 'referrer-policy': 'no-referrer' } });
}

/* Exactly what happens, and when (Dean: confirm pages say exactly what will happen and when). */
function vpaReviewWhatHappens(row, edited) {
  return '<div class="what"><b>What happens when you tap it</b><ol>'
    + '<li>Within 5 minutes your Mac picks this up (if it is asleep, as soon as it wakes).</li>'
    + '<li>It checks again that nobody has replied to them since, that they have not asked us to stop, and that their account can be made.</li>'
    + '<li>If all is well, the reply' + (edited ? ', with your changes,' : '') + ' goes from ' + vpaEsc(row.mailbox || 'the mailbox that emailed them')
    + ' in their own email thread, 30 minutes after their email arrived, between 8am and 5pm Monday to Friday. '
    + 'Their account email follows 30 minutes after the reply, and you can still cancel it in HQ until it goes.</li>'
    + '<li>You get an email straight away saying the time it will go, or, if something is not right, why it was held. Nothing goes to them if it is held.</li>'
    + '</ol></div>';
}

function vpaReviewTitle(row) {
  return '<h1>' + vpaEsc(row.company || row.folder) + '</h1>'
    + '<p class="muted">Replied to ' + vpaEsc(row.mailbox || 'us') + (row.reply_to ? ' from ' + vpaEsc(row.reply_to) : '') + '.</p>';
}
function vpaReviewWords(row) {
  return '<h2>What they wrote</h2><div class="card words">' + vpaEsc(row.their_words || '(nothing above the quoted email)') + '</div>';
}

/* THE RECOMMENDED BUTTON AT THE TOP, ALL THREE AT THE BOTTOM (Dean, 31 Oct 2026). "what you recommend up the top
   just the button so if you recommend the normal email that just that one if you recommend edit email, just the
   edit button at the top." The email has the three buttons at the top and the bottom, the recommended one first;
   the page it opens now has ONLY the recommended one at the top, labelled Recommended, and all three at the bottom
   in the email's order (the Mac's button_order: the recommended one first, No always last). No recommendation (a
   review from before migration 130) means Edit, the safe one.
   Nothing about recording changes: on its own page a choice is that page's confirm, a submit in the page's one
   POST form back to the same signed link; anywhere else it is the signed link to its own page, a GET that only
   shows. So a tap at the top does exactly what the same tap at the bottom does. */
const VPA_REVIEW_BUTTON_WORDS = { yes: 'Yes, send the standard reply', edit: 'Edit the reply first', no: 'No, do not send' };
const VPA_REVIEW_CONFIRM_WORDS = { yes: 'Yes, send the standard reply', edit: 'Save and send', no: 'No, do not send' };
function vpaReviewRecommended(row) {
  const d = (row.details && typeof row.details === 'object') ? row.details : null;
  return d && d.recommend === 'yes' ? 'yes' : 'edit';
}
function vpaReviewOrder(rec) {
  return rec === 'yes' ? ['yes', 'edit', 'no'] : ['edit', 'yes', 'no'];
}
function vpaReviewChoice(a, action, links, big, tag) {
  const cls = 'btn ' + a + (big ? '' : ' small');
  const words = (tag ? '<span class="tag">' + tag + '</span>' : '') + (a === action ? VPA_REVIEW_CONFIRM_WORDS[a] : VPA_REVIEW_BUTTON_WORDS[a]);
  return a === action
    ? '<button class="' + cls + '" name="b" type="submit" data-a="' + a + '">' + words + '</button>'
    : '<a class="' + cls + '" href="' + vpaEsc(links[a]) + '" data-a="' + a + '">' + words + '</a>';
}
function vpaReviewTop(rec, action, links) {
  return '<div class="top" data-vpa="top">' + vpaReviewChoice(rec, action, links, true, 'Recommended')
    + (rec === 'edit' && action === 'edit' ? '<p class="muted">Change the reply below first: this saves what is in the box.</p>' : '')
    + '</div>';
}
function vpaReviewBottom(rec, action, links) {
  return '<h2>Your choice</h2><div class="choices" data-vpa="bottom">'
    + vpaReviewOrder(rec).map(function (a, i) { return vpaReviewChoice(a, action, links, i === 0, i === 0 ? 'Recommended' : ''); }).join('')
    + '</div>';
}
/* Every submit on the page goes quiet on the first tap (there are two when the page is the recommended one). */
const VPA_REVIEW_ONSUBMIT = "var s=this.querySelectorAll('button[type=submit]');for(var i=0;i<s.length;i++){s[i].disabled=true;s[i].textContent='Saving...'}";

function vpaParseForm(text) {
  const out = {};
  String(text || '').split('&').forEach(function (p) {
    if (!p) return;
    const i = p.indexOf('=');
    const k = i < 0 ? p : p.slice(0, i), v = i < 0 ? '' : p.slice(i + 1);
    try { out[decodeURIComponent(k.replace(/\+/g, ' '))] = decodeURIComponent(v.replace(/\+/g, ' ')); } catch (e) { /* a broken escape is ignored */ }
  });
  return out;
}

const VPA_REVIEW_DECIDED_WORDS = { yes: 'Yes, send the standard reply', no: 'No, do not send', edit: 'Edited and send' };

/* The Mac's recommendation and its warnings (migration 130), each a plain sentence with what to tap. A review from
   before then has neither: a question then gets one neutral line, true whatever the Mac does with a Yes. */
function vpaReviewAdvice(row) {
  const d = (row.details && typeof row.details === 'object') ? row.details : null;
  let out = '';
  if (d && (d.recommend === 'yes' || d.recommend === 'edit')) {
    out += '<div class="rec' + (d.recommend === 'edit' ? ' edit' : '') + '"><b>' + (d.recommend === 'yes' ? 'I recommend: Send the standard reply.' : 'I recommend: Edit first.')
      + '</b>' + (d.recommend_why ? '<br>' + vpaEsc(d.recommend_why) : '') + '</div>';
  } else if (row.class === 'question') {
    out += '<div class="warn">They asked a question. Check the reply below answers it. If it does not, tap <b>Edit</b>.</div>';
  }
  (d && Array.isArray(d.warnings) ? d.warnings : []).slice(0, 12).forEach(function (w) { out += '<div class="warn">' + vpaEsc(w) + '</div>'; });
  return out;
}

/* The Edit page's account boxes, only when the table can hold them (migration 130: the row carries the column). */
function vpaReviewBoxes(row, form) {
  if (!('edited_postcode' in row)) return '';
  const d = (row.details && typeof row.details === 'object') ? row.details : {};
  const pc = form ? form.postcode : (d.postcode || '');
  const ent = form ? form.entity : (d.entity_type === 'non_profit' ? 'club' : (d.entity_type === 'for_profit' ? 'pub' : ''));
  const em = form ? form.email : (d.login_email || '');
  return '<h2>Their account</h2><div class="fields">'
    + '<label>Postcode<input type="text" name="postcode" inputmode="numeric" maxlength="4" autocomplete="off" value="' + vpaEsc(pc) + '" aria-label="Postcode"></label>'
    + '<div><span class="muted" style="font-size:14px">Pub or club</span><div class="radios">'
    + '<label><input type="radio" name="entity" value="pub"' + (ent === 'pub' ? ' checked' : '') + '> Pub</label>'
    + '<label><input type="radio" name="entity" value="club"' + (ent === 'club' ? ' checked' : '') + '> Club</label></div></div>'
    + '<label>Login email<input type="email" name="login_email" autocomplete="off" autocapitalize="off" value="' + vpaEsc(em) + '" aria-label="Login email"></label>'
    + '</div><p class="muted" style="margin-top:8px">Filled in from what we found. Change anything that is wrong.</p>';
}
function vpaReviewDecidedPage(row, sameAsAsked) {
  const when = row.decided_at ? new Date(Date.parse(row.decided_at) + 36000000).toISOString().slice(0, 16).replace('T', ' ') + ' Brisbane' : '';
  const applied = row.applied_at
    ? '<p>Your Mac has dealt with it: <b>' + vpaEsc(row.applied_result || 'done') + '</b>' + (row.applied_note ? '. ' + vpaEsc(row.applied_note) : '') + '</p>'
    : '<p>Your Mac picks it up within 5 minutes and emails you what it did.</p>';
  return vpaReviewPage(sameAsAsked ? 'Got it' : 'Already decided',
    '<div class="done" aria-hidden="true">' + (row.decision === 'no' ? '&#10005;' : '&#10003;') + '</div>'
    + '<h1>' + (sameAsAsked ? 'Got it: ' : 'You already chose: ') + vpaEsc(VPA_REVIEW_DECIDED_WORDS[row.decision] || row.decision) + '</h1>'
    + '<p class="muted">' + vpaEsc(row.company || row.folder) + (when ? ', ' + vpaEsc(when) : '') + '.</p>'
    + applied
    + (sameAsAsked ? '' : '<p class="muted">Only the first choice counts, so nothing changed. To change your mind, tell Claude.</p>'), 200);
}

/* GET and POST /autopilot/review?f=&a=&r=&x=&t= */
async function vpaAutopilotReviewPage(request, env) {
  const isPost = request.method === 'POST';
  const folder = vpaQueryParam(request, 'f'), action = vpaQueryParam(request, 'a');
  const round = parseInt(vpaQueryParam(request, 'r'), 10), exp = parseInt(vpaQueryParam(request, 'x'), 10);
  const tok = String(vpaQueryParam(request, 't') || '').toLowerCase();
  const BAD = vpaReviewPage('That link does not work',
    '<h1>That link does not work</h1><p>It may have been cut short. Use the buttons in the newest review email, '
    + 'or tell Claude "send" or "reject" with the venue name.</p>', 403);
  // An unset key must never mean "any token will do".
  if (String(env.PROSPECT_AUTOPILOT_KEY || '').length < 32 || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
    return vpaReviewPage('Not switched on', '<h1>The review buttons are not switched on</h1><p>Tell Claude "send" or "reject" with the venue name instead.</p>', 503);
  }
  if (!VPA_REVIEW_FOLDER_RE.test(folder) || !VPA_REVIEW_ACTIONS[action] || !(round >= 1) || !(exp > 0)
      || !/^[0-9a-f]{32}$/.test(tok) || !vpaSameSecret(tok, await vpaReviewToken(env, folder, action, exp, round))) return BAD;
  if (Math.floor(Date.now() / 1000) > exp) {
    return vpaReviewPage('This link has run out', '<h1>This link has run out</h1><p>Review buttons last 7 days. '
      + 'Tell Claude "send" or "reject" with the venue name, and it will run the same checks.</p>', 410);
  }
  let row;
  try { row = await vpaReviewRow(env, folder); }
  catch (e) { return vpaReviewPage('Try again', '<h1>That did not load</h1><p>Please try the button again in a minute.</p>', 503); }
  if (!row) return BAD;
  if (parseInt(row.round, 10) !== round) {
    return vpaReviewPage('A newer email has the buttons', '<h1>This link is from an older email</h1><p>'
      + vpaEsc(row.company || folder) + ' has a newer review email. Use the buttons in that one.</p>', 409);
  }
  if (row.decision) return vpaReviewDecidedPage(row, isPost && row.decision === action);

  const self = '/autopilot/review?f=' + encodeURIComponent(folder) + '&a=' + action + '&r=' + round + '&x=' + exp + '&t=' + tok;
  const links = await vpaReviewLinks(env, folder, exp, round);
  const qWarn = vpaReviewAdvice(row);
  const boxes = ('edited_postcode' in row);
  let form = null, boxForm = null, err = '';

  if (isPost) {
    let body = '';
    try { body = await request.text(); } catch (e) { /* read as empty */ }
    const f = vpaParseForm(body);
    const patch = { decision: action, decided_at: new Date().toISOString(),
                    decided_agent: String(request.headers.get('User-Agent') || '').slice(0, 200) };
    if (action === 'no') patch.reason = vpaReviewText(f.reason, 2000).trim() || null;
    if (action === 'edit') {
      const text = vpaReviewText(f.reply, VPA_REVIEW_MAX + 1);
      const pc = String(f.postcode || '').trim(), entity = String(f.entity || ''), em = String(f.login_email || '').trim().toLowerCase();
      if (boxes) {
        boxForm = { postcode: pc.slice(0, 12), entity: entity === 'club' || entity === 'pub' ? entity : '', email: em.slice(0, 200) };
        if (pc && !/^\d{4}$/.test(pc)) err = 'The postcode must be 4 numbers. Nothing was saved.';
        else if (em && (em.length > 200 || !VPA_REVIEW_EMAIL_RE.test(em))) err = 'That login email does not look like an email. Fix it or clear the box. Nothing was saved.';
        else {
          patch.edited_postcode = pc || null;
          patch.edited_entity_type = entity === 'club' ? 'non_profit' : (entity === 'pub' ? 'for_profit' : null);
          patch.edited_login_email = em || null;
        }
      }
      /* Only what a phone keyboard does on its own is checked here, so Dean finds out now and not in five
         minutes: iPhones turn "--" into a long dash. Every other rule is the Mac's lint_reply, one copy. */
      if (err) { /* a box was wrong: said above */ }
      else if (text.length > VPA_REVIEW_MAX) err = 'That is too long to send (over 20,000 characters).';
      else if (text.trim().length < 80) err = 'That is too short to be the reply. Nothing was saved.';
      else if (/[\u2014\u2013]/.test(text)) err = 'Your reply has a long dash in it (your phone may have made one from two hyphens). Change it to a comma or a full stop, then tap Save and send again. Nothing was saved.';
      if (err) form = text;
      else patch.edited_reply = text.trim() + '\n';
      if (err && boxes && !boxForm) boxForm = { postcode: pc.slice(0, 12), entity: entity, email: em.slice(0, 200) };
    }
    if (!err) {
      let got;
      try {
        got = await vpaReviewPatch(env, 'folder=eq.' + encodeURIComponent(folder) + '&round=eq.' + round + '&decision=is.null', patch);
      } catch (e) {
        return vpaReviewPage('Try again', '<h1>That did not save</h1><p>Nothing was recorded. Please tap the button again in a minute.</p>', 503);
      }
      if (!got.length) {
        let now = null;
        try { now = await vpaReviewRow(env, folder); } catch (e) { /* fall through */ }
        return now && now.decision ? vpaReviewDecidedPage(now, now.decision === action) : BAD;
      }
      return vpaReviewDecidedPage(got[0], true);
    }
  }

  // GET (or an edit sent back to fix): the page. NOTHING is written here.
  // ONE form, from the top button to the bottom ones: the page's own choice is a submit wherever it is shown.
  const rec = vpaReviewRecommended(row);
  let inner = vpaReviewTitle(row) + (err ? '<div class="err">' + vpaEsc(err) + '</div>' : '') + qWarn
    + '<form method="POST" action="' + vpaEsc(self) + '" onsubmit="' + vpaEsc(VPA_REVIEW_ONSUBMIT) + '">'
    + vpaReviewTop(rec, action, links)
    + vpaReviewWords(row);
  if (action === 'yes') {
    inner += '<h2>The reply they will get</h2><div class="card words">' + vpaEsc(row.reply) + '</div>'
      + '<p class="muted" style="margin-top:8px">The line saying when their account email comes is matched to when it really goes.</p>'
      + vpaReviewWhatHappens(row, false);
  } else if (action === 'edit') {
    inner += '<h2>The reply: change anything, then tap Save and send</h2>'
      + '<textarea name="reply" aria-label="The reply" autocapitalize="sentences" spellcheck="true">' + vpaEsc(form != null ? form : row.reply) + '</textarea>'
      + '<p class="muted" style="margin-top:8px">Your signature is at the bottom: leave it there. Plain text; a blank line starts a new paragraph.</p>'
      + vpaReviewBoxes(row, boxForm)
      + vpaReviewWhatHappens(row, true);
  } else {
    inner += '<h2>The reply that will NOT go</h2><div class="card words">' + vpaEsc(row.reply) + '</div>'
      + '<div class="what"><b>What happens when you tap it</b><ol>'
      + '<li>Nothing is sent to them and no account is made, now or later.</li>'
      + '<li>Within 5 minutes your Mac marks it rejected and emails you to say so.</li>'
      + '<li>Their email stays in Instantly, so you can still answer it there by hand.</li></ol></div>'
      + '<h2>Why not? (optional, just for the record)</h2>'
      + '<textarea class="short" name="reason" aria-label="Why not"></textarea>';
  }
  inner += vpaReviewBottom(rec, action, links) + '</form>';
  const titles = { yes: 'Send this reply?', edit: 'Edit the reply', no: 'Do not send?' };
  return vpaReviewPage(titles[action], inner, err ? 400 : 200);
}

/* THE ONE SETUP, for HQ (vpaHandleProspect) and the autopilot (vpaAutopilotProspect). actor is who it
   is recorded as; opts.minDelayMin floors the welcome's delay; opts.via names the caller on the
   screen record. b.dry_run: every check below runs, nothing is created, and it says what it would do. */
async function vpaProspectSetUp(env, actor, b, json, opts) {
  opts = opts || {};
  const NONE = ' Nothing was created.';

  const name = String(b.name || '').replace(/[\x00-\x1f]+/g, ' ').trim().slice(0, 120);
  if (!name) return json({ error: 'Enter the venue name.' + NONE }, 400);
  const email = String(b.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) {
    return json({ error: 'Enter the contact\'s email. It is their login and where the welcome goes.' + NONE }, 400);
  }
  const postcode = String(b.postcode || '').replace(/\D/g, '').slice(0, 4);
  const state = postcode.length === 4 ? vpaStateFromPostcode(postcode) : null;
  if (!state) return json({ error: 'Enter the venue\'s 4-digit postcode. It sets which state\'s gaming rules apply.' + NONE }, 400);
  const entityType = b.entity_type;
  if (['non_profit', 'for_profit'].indexOf(entityType) === -1) {
    return json({ error: 'Choose club or pub.' + NONE }, 400);
  }
  const mobileRaw = String(b.mobile || '').trim();
  const phone = mobileRaw ? vpaNormaliseMobileAU(mobileRaw) : null;
  if (mobileRaw && !vpaIsAuMobileE164(phone)) {
    return json({ error: 'That mobile is not an Australian mobile (04...). Leave it empty, or fix it: a landline can never receive a sign-in code.' + NONE }, 400);
  }
  /* THE NUMBER TO RING (Dean, 29 Oct 2026: "if it does have a phone number. We need to add that at the
     point of setup also"). A mobile or a landline; empty falls back to their mobile; neither is fine. */
  const phoneRaw = String(b.phone || '').trim();
  const callPhone = vpaProspectPhone(phoneRaw || mobileRaw);
  if (phoneRaw && !callPhone) {
    return json({ error: 'That phone does not look like an Australian number (a mobile 04..., or a landline with its area code, 02 / 03 / 07 / 08). Leave it empty, or fix it.' + NONE }, 400);
  }
  let players = VPA_PROSPECT_DEFAULT_PLAYERS;
  if (b.players != null && b.players !== '') {
    players = parseInt(b.players, 10);
    if (!(players >= 1 && players <= VPA_PROSPECT_MAX_PLAYERS)) {
      return json({ error: 'Their usual crowd should be between 1 and ' + VPA_PROSPECT_MAX_PLAYERS + ' players.' + NONE }, 400);
    }
  }
  const website = vpaProspectWebsite(b.website);
  if (website === null) return json({ error: 'That website does not look like a web address. Leave it empty or fix it.' + NONE }, 400);
  const firstName = String(b.first_name || '').replace(/[\x00-\x1f]+/g, ' ').trim().slice(0, 60);
  /* WHO SIGNS IT (Dean, 29 Oct 2026): the person whose mailbox the venue wrote to (Harry, Dean...), as the
     autopilot sends sender_name and sender_email. The email is still FROM and replied to at hello@ ("it all
     should come from hello, not Dean"): the name is only the sign-off, the address only HQ's record.
     Both or neither; a bad one refuses the setup, so a typo never reaches a venue. */
  const sender = vpaProspectSender(b.sender_name, b.sender_email);
  if (sender.error) return json({ error: sender.error + NONE }, 400);
  /* THE OFFER THEY REPLIED TO (Dean, 29 Oct 2026): offer_code is the code of the campaign's /offer-<mon>
     link. It names the offer in their email; none given is this month's. See vpaProspectOffer. */
  const offer = vpaProspectOffer(env, b.offer_code);
  if (offer.error) return json({ error: offer.error + NONE }, 400);
  /* THE EMAIL GOES ON A DELAY (Dean, 28 Oct 2026: "on a delay, so they don't get it straight away").
     HQ's "Send their email in [90] minutes", 0 to 1440 (a day). 0 sends it now. */
  let delayMin = VPA_PROSPECT_DEFAULT_DELAY_MIN;
  if (b.send_in_minutes != null && b.send_in_minutes !== '') {
    delayMin = Number(b.send_in_minutes);
    if (!(Number.isInteger(delayMin) && delayMin >= 0 && delayMin <= VPA_PROSPECT_MAX_DELAY_MIN)) {
      return json({ error: 'Send their email in 0 to ' + VPA_PROSPECT_MAX_DELAY_MIN + ' minutes (0 sends it now).' + NONE }, 400);
    }
  }
  if (opts.minDelayMin && delayMin < opts.minDelayMin) delayMin = opts.minDelayMin;

  // The slides are read and checked in full before anything is created.
  const slidesIn = Array.isArray(b.slides) ? b.slides : [];
  if (slidesIn.length > VPB_MAX_SLIDES) {
    return json({ error: 'That is ' + slidesIn.length + ' slides. A venue can have up to ' + VPB_MAX_SLIDES + '.' + NONE }, 400);
  }
  const slideFiles = [];
  for (let i = 0; i < slidesIn.length; i++) {
    const m = /^data:image\/(png|jpe?g);base64,([A-Za-z0-9+/=\s]+)$/.exec(String(slidesIn[i] || ''));
    if (!m) return json({ error: 'Slide ' + (i + 1) + ' is not a PNG or JPEG.' + NONE }, 400);
    let bytes;
    try { bytes = vpaB64ToBytes(m[2].replace(/\s+/g, '')); } catch (_) { bytes = null; }
    const kind = vpaProspectSlideKind(bytes);
    if (!kind) return json({ error: 'Slide ' + (i + 1) + ' is not a PNG or JPEG.' + NONE }, 400);
    if (bytes.length > VPB_MAX_IMAGE_BYTES) {
      return json({ error: 'Slide ' + (i + 1) + ' is over ' + Math.round(VPB_MAX_IMAGE_BYTES / (1024 * 1024)) + 'MB.' + NONE }, 400);
    }
    slideFiles.push({ bytes: bytes, kind: kind });
  }

  /* MIGRATION 122 FIRST. Without terms_required the venue would be created with no compliance
     record AND nothing holding its games, which is the one combination this route exists to avoid. */
  const probe = await fetch(env.SUPABASE_URL + '/rest/v1/vp_venues?select=terms_required&limit=1', { headers: vpaHeaders(env) });
  if (!probe.ok) return json({ error: 'Run migration 122 first (vp_venues.terms_required).' + NONE }, 503);

  // A double click, or the same reply handled twice, must not build the venue twice.
  const twin = await vpaSelect(env, 'vp_venues', 'name=eq.' + encodeURIComponent(name) + '&postcode=eq.' + postcode + '&select=id,slug&limit=1');
  if (twin && twin.length) {
    return json({ error: name + ' (' + postcode + ') is already set up, at /tv?' + twin[0].slug + '. To send their email again, use Resend welcome on the venue.' + NONE }, 409);
  }

  /* AN EMAIL THAT ALREADY SIGNS IN IS REFUSED, not linked (security review, 28 Oct 2026). Giving an
     existing login a new venue on the strength of an address typed in HQ is how a typo hands one
     venue's manager another venue. A mobile that already signs in is left off the new login. */
  /* THE ONE EXCEPTION (29 Oct 2026, a prospect who already runs another VenuePlay venue): the email AND the
     mobile typed are BOTH on the same existing login. Two facts that agree on one person are not a typo, so
     that login is reused and given this venue too ("Choose another venue" then shows both). This venue still
     gets its own account record, billing and everything else: nothing is shared but the sign-in. One fact
     alone (the email, or the mobile) is still refused or left off, exactly as before. */
  const byEmail = await vpaFindAuthUser(env, { email: email });
  const sameLogin = !!(byEmail && phone && String(byEmail.phone || '').replace(/[^\d]/g, '') === String(phone).replace(/[^\d]/g, ''));
  if (byEmail && !sameLogin) {
    return json({ error: 'That email already has a VenuePlay login, so it cannot be set up as a new prospect from here. Check it is theirs, then add this venue from their own account (or + Add venue).' + NONE }, 409);
  }
  const phoneTaken = !sameLogin && !!(phone && await vpaFindAuthUser(env, { phone: phone }));

  // Every check has passed. A dry run stops here, having made nothing, and says what it would make.
  if (b.dry_run === true) {
    return json({ ok: true, dry_run: true, name: name, postcode: postcode, state: state, entity_type: entityType,
      players: players, offer_code: offer.code, slides: slideFiles.length, mobile: phone ? (sameLogin ? 'their existing login' : phoneTaken ? 'taken' : 'free') : 'none', phone: callPhone || null,
      welcome_in_minutes: b.send_welcome === false ? null : delayMin });
  }

  const site = (env.SITE_URL || 'https://venueplay.com.au').replace(/\/+$/, '');
  const warnings = [];
  if (offer.warning) warnings.push(offer.warning);
  // 1. The account record: a paying founding row with no card, as /admin/venue makes one.
  const founding = await vpaInsert(env, 'venueplay_founding', {
    venue_name: name, contact_email: email, mobile: mobileRaw || null, postcode: postcode,
    max_seats: players, plan: 'monthly', marketing_opt_in: false, status: 'active',
  });
  const foundingId = founding && founding.id;
  // 2. The venue. terms_required with NO compliance record: the console and the game Worker hold
  //    every game until the owner or a manager ticks section 6 themselves.
  const slug = await vpaUniqueSlug(env, vpaSlugify(name), name, postcode);
  const venue = await vpaInsert(env, 'vp_venues', {
    name: name, slug: slug, timezone: vpaTimezoneFromPostcode(postcode), postcode: postcode, au_state: state,
    venue_kind: entityType === 'non_profit' ? 'club' : 'pub', entity_type: entityType,
    paid_entry_enabled: vpaPaidEntryDefault(entityType, state),
    founding_id: foundingId, max_players: players,
    terms_required: true, compliance_accepted_at: null, compliance_accepted_by: null,
  });
  await vpaInsert(env, 'vp_venue_settings', { venue_id: venue.id }, false);
  await vpaInsert(env, 'vp_screens', { venue_id: venue.id, name: 'Main screen' }, false);

  // 3. The login, as the venue's manager (every self-serve and HQ venue's first login is one).
  let login = null;
  try {
    login = sameLogin ? { id: byEmail.id, mobile: true, existing: true } : await vpaProspectLogin(env, email, phoneTaken ? null : phone, name);
    if (phoneTaken) warnings.push('This mobile already has a VenuePlay login; the prospect was set up with an email login only. Add their mobile after they confirm it is theirs.');
    await vpaInsert(env, 'vp_venue_staff', { venue_id: venue.id, auth_user_id: login.id, role: 'manager',
      display_name: firstName || 'Manager' }, false);
  } catch (e) {
    login = null;
    warnings.push('NOBODY CAN SIGN IN YET: the login was not made (' + String((e && e.message) || e).slice(0, 120) + '). Add them under the venue\'s Hosts, then Resend welcome.');
  }

  /* 3b. HQ > Prospects (migration 125): their row, so they are listed apart from the active venues and
     flagged for a call if they never sign in. Best-effort: the account stands without it. */
  try {
    await vpaInsert(env, 'vp_prospects', { venue_id: venue.id, founding_id: foundingId || null,
      source: opts.via === 'autopilot_prospect' ? 'autopilot' : 'hq', contact_name: firstName || null, email: email,
      phone: callPhone || null, auth_user_id: login ? login.id : null, website: website || null,
      call_requested: b.call_requested === true, created_label: actor.label || null }, false);
    /* THE OFFER THEY WERE SET UP ON (migration 127), kept through their free month even if that month's offer
       closes; a pause takes it away (vpaProspectPrice). Its own write, so a database without 127 still lists them. */
    if (vpaFoundingOpenNow(env)) await vpaProspectPatch(env, venue.id, { offer_rate: VPA_OFFER_RATE }).catch(() => false);
  } catch (e) {
    warnings.push('HQ > Prospects cannot list them until migration 125 is run' + (callPhone ? ' (their phone, ' + callPhone + ', is kept on the audit row).' : '.'));
  }

  // 4. Their screen ads, through the one recorded write (vpbWriteScreen, migration 114).
  let slideCount = 0;
  if (slideFiles.length) {
    try {
      await vpbEnsureBucket(env, 'venue-ads');
      const slides = [];
      for (let i = 0; i < slideFiles.length; i++) {
        const f = slideFiles[i];
        const path = venue.id + '/' + (await vpbSha256Hex(f.bytes)).slice(0, 40) + '.' + f.kind;
        const up = await fetch(env.SUPABASE_URL + '/storage/v1/object/venue-ads/' + path, {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + env.SUPABASE_SERVICE_KEY, 'apikey': env.SUPABASE_SERVICE_KEY,
                     'Content-Type': f.kind === 'png' ? 'image/png' : 'image/jpeg', 'x-upsert': 'true' },
          body: f.bytes,
        });
        if (!up.ok) throw new Error('slide ' + (i + 1) + ' did not upload');
        slides.push({ image_url: env.SUPABASE_URL + '/storage/v1/object/public/venue-ads/' + path, seconds: VPA_PROSPECT_SLIDE_SECONDS });
      }
      const row = { venue_id: venue.id, slug: slug, slides: vpbCleanSlides(slides), updated_at: new Date().toISOString() };
      const w = await vpbWriteScreen(env, row, { via: opts.via || 'hq_prospect', route: opts.via ? 'autopilot/prospect' : 'admin/prospect', user: actor.actorId || null,
        admin: actor.actorId || null, label: actor.label || 'admin', role: actor.role || null });
      if (!w.ok) throw new Error('the screen did not save');
      slideCount = row.slides.length;
    } catch (e) {
      warnings.push('Their slides did not go on: ' + String((e && e.message) || e).slice(0, 120) + '. Add them from View as > Your account.');
    }
  }

  // 5. The ONE email, on a delay. Best-effort: the account stands whether or not Resend answers.
  let welcomeSent = false, welcome = null;
  if (b.send_welcome !== false) {
    /* WHEN IT GOES. Resend holds it (scheduled_at) until then, so nothing here has to wake up to send
       it, and HQ can cancel it or send it now until that minute (vp_prospect_welcomes, migration 124). */
    const sendAtMs = Date.now() + delayMin * 60000;
    /* ITS BUTTON SIGNS THEM STRAIGHT IN, ONCE (migration 123). Only the hash is kept. Its 14 days start
       when the email goes, not when HQ pressed the button. No table yet, or no login: the button opens
       the email sign-in instead, and HQ is told. */
    let signinToken = null;
    // A mobile login signs in by text code, so it needs no one-click link (and has none to leak).
    if (login && !login.mobile) {
      try { signinToken = await vpaMintSigninLink(env, login.id, venue.id, sendAtMs); }
      catch (e) { warnings.push('The one-click sign-in button was not made (run migration 123), so their email button opens the email-code sign-in instead.'); }
    }
    const render = { foundingId: foundingId, email: email, firstName: firstName, venueName: name, slug: slug,
      seats: players, state: state, entityType: entityType, slides: slideCount, authUserId: login ? login.id : null,
      mobileLogin: !!(login && login.mobile), mobile: login && login.mobile ? vpaProspectPhone(mobileRaw) : null, sameLogin: !!(login && login.existing),
      senderName: sender.name || null, senderEmail: sender.email || null, offerCode: offer.code };
    const r = await vpaFireProspectWelcome(env, Object.assign({ signinToken: signinToken, sendAtMs: delayMin > 0 ? sendAtMs : null }, render));
    welcomeSent = !!r.ok;
    if (!welcomeSent) warnings.push('THE WELCOME EMAIL DID NOT SEND. Use Resend welcome on the venue, or send it by hand.');
    else {
      welcome = { send_at: new Date(sendAtMs).toISOString(), status: delayMin > 0 ? 'scheduled' : 'sent', id: null };
      const rec = await vpaProspectWelcomeRecord(env, actor, venue.id, r.id, sendAtMs, welcome.status,
        signinToken ? await vpaSigninTokenHash(signinToken) : null, render);
      if (rec) welcome.id = rec.id;
      else if (delayMin > 0) warnings.push('Their email is booked for ' + vpaBrisbaneTime(sendAtMs) + ', but HQ cannot cancel it or send it early until migration 124 is run.');
    }
  }

  // 6. Who set it up, and what was made.
  await vpaAudit(env, actor, 'prospect_set_up', 'venue:' + venue.id, {
    via: opts.via || 'hq', name: name, slug: slug, founding_id: foundingId, email: email, first_name: firstName || undefined,
    mobile_login: !!(login && login.mobile), login_made: !!login, login_reused: !!(login && login.existing), phone: callPhone || undefined, players: players, offer_code: offer.code || undefined, state: state, entity_type: entityType,
    website: website || undefined, slides: slideCount, compliance: 'pending', terms_required: true,
    sender_name: sender.name || undefined, sender_email: sender.email || undefined,
    welcome_sent: welcomeSent, welcome_send_at: welcome ? welcome.send_at : undefined, welcome_delay_min: welcome ? delayMin : undefined,
  });

  const out = { ok: true, venue: { id: venue.id, name: name, slug: slug }, founding_id: foundingId,
    tv_url: site + '/tv?' + encodeURIComponent(slug),
    login: login ? Object.assign(login.mobile ? { email: email, mobile: mobileRaw } : { email: email }, login.existing ? { existing: true } : {}) : null,
    slides: slideCount, welcome_sent: welcomeSent, phone: callPhone || null, offer_code: offer.code || null };
  if (welcome) out.welcome = welcome;
  if (warnings.length) out.warnings = warnings;
  return json(out);
}

/* ===========================================================================
 * HQ > PROSPECTS (Dean, 29 Oct 2026; migration 125, vp_prospects; service role only)
 *
 * "Can we please put the prospects into HQ as a tab somewhere? ... if they haven't signed up they're
 * not gonna sign up on the active list are they? And maybe we should have something that is like a
 * follow-up ... if they haven't accessed it within ... three days it flags the venue ... so then we can
 * actually give the person a call ... if it does have a phone number."
 *
 *   POST /admin/prospects         (owner | accounts) every prospect venue that has NOT signed up, with
 *                                 its phone, welcome, last sign-in and whether to ring them
 *   POST /admin/prospect/called   (owner | accounts) { venue_id, note?, undo? } the Called mark
 *
 * SIGNED UP is worked out on every read, never stored: a card on file (a subscription), comp, billed
 * by invoice, or in an operator group. The moment one of those is true the venue drops off this list
 * and HQ shows it with the active venues, without anything having to move it.
 * THE FLAGS, until somebody marks it Called: "Call requested" (they asked for a call in their reply;
 * sales rings them, shown first), then "Call them" (nobody at the venue has signed in
 * VPA_PROSPECT_FOLLOWUP_DAYS after setup). A sign-in that could not be read is never "never".
 * ======================================================================== */
const VPA_PROSPECT_FOLLOWUP_DAYS = 3;
const VPA_PROSPECT_NOTE_MAX = 500;
/* An Australian number to ring: a mobile (04) or a landline with its area code (02, 03, 07, 08), in
   any spacing, +61 or not. Returns it spaced the way it is said ('0432 071 622', '(02) 9876 5432'),
   or null. A 13/1300/1800 line is a business switchboard, not a person, so it is not taken. */
function vpaProspectPhone(raw) {
  let d = String(raw || '').replace(/[^\d+]/g, '');
  if (!d) return null;
  if (d.indexOf('+61') === 0) d = '0' + d.slice(3);
  else if (/^61\d{9}$/.test(d)) d = '0' + d.slice(2);
  if (!/^0[23478]\d{8}$/.test(d)) return null;
  if (d[1] === '4') return d.slice(0, 4) + ' ' + d.slice(4, 7) + ' ' + d.slice(7);
  return '(' + d.slice(0, 2) + ') ' + d.slice(2, 6) + ' ' + d.slice(6);
}
/* Has this prospect become a customer? One answer, used by the list and by nothing else. */
function vpaProspectSignedUp(venue, founding) {
  if (venue && venue.group_id) return true;
  if (!founding) return false;
  if (founding.stripe_subscription_id) return true;
  if (founding.bill_by_invoice === true) return true;
  return ['card_on_file', 'comp'].indexOf(founding.status) !== -1;
}
/* A venue that has left (archived) is not somebody to ring: it is off this list and off the active one. */
function vpaProspectGone(venue) {
  return !venue || venue.suspended_reason === 'archived' || venue.suspended_reason === 'archived_cancelling';
}
/* The latest sign-in by ANY login on the venue, so a manager they added counts. known=false when Auth
   would not answer for one of them: the list then says it could not check, never "never". */
async function vpaProspectLastSignIn(env, userIds) {
  let last = null, known = true;
  for (let i = 0; i < userIds.length; i++) {
    const u = await vpaAuthGetUser(env, userIds[i]);
    if (!u) { known = false; continue; }
    const t = Date.parse(u.last_sign_in_at || '');
    if (isFinite(t) && (last == null || t > last)) last = t;
  }
  return { at: last, known: last != null ? true : known };
}
async function vpaProspectsList(request, env, json) {
  const actor = await vpaRequireAdmin(request, env, ['owner', 'accounts']);
  if (actor.error) return json({ error: actor.error }, actor.status);
  let rows;
  try { rows = await vpaSelectAll(env, 'vp_prospects', 'select=*&order=created_at.desc,venue_id.asc'); }
  catch (e) { return json({ error: 'Run migration 125 first (vp_prospects): HQ cannot list prospects without it.', need_migration: 125 }, 503); }
  const now = Date.now(), DAY = 86400000;
  const ids = rows.map((r) => r.venue_id);
  const venues = {}, accounts = {}, staff = {}, welcomes = {};
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100).map(encodeURIComponent).join(',');
    (await vpaSelectAll(env, 'vp_venues', 'id=in.(' + chunk + ')&select=id,name,slug,postcode,au_state,founding_id,group_id,status,suspended_reason&order=id.asc'))
      .forEach((v) => { venues[v.id] = v; });
    (await vpaSelectAll(env, 'vp_venue_staff', 'venue_id=in.(' + chunk + ')&select=venue_id,auth_user_id&order=venue_id.asc,auth_user_id.asc'))
      .forEach((s) => { (staff[s.venue_id] = staff[s.venue_id] || []).push(s.auth_user_id); });
    try {
      (await vpaSelectAll(env, 'vp_prospect_welcomes', 'venue_id=in.(' + chunk + ')&select=venue_id,send_at,status&order=send_at.desc'))
        .forEach((w) => { if (!welcomes[w.venue_id]) welcomes[w.venue_id] = w; });
    } catch (_) { /* migration 124 not run: the column says "not recorded" */ }
  }
  const fids = Object.keys(venues).map((k) => venues[k].founding_id).filter(Boolean);
  for (let i = 0; i < fids.length; i += 100) {
    (await vpaSelectAll(env, 'venueplay_founding', 'id=in.(' + fids.slice(i, i + 100).map(encodeURIComponent).join(',') +
      ')&select=id,status,stripe_subscription_id,bill_by_invoice&order=id.asc')).forEach((f) => { accounts[f.id] = f; });
  }
  const out = [], cardAdded = [];
  let signedUp = 0;
  const freeMonthReady = rows.length === 0 || rows.some((r) => 'first_signin_at' in r);
  for (const r of rows) {
    const v = venues[r.venue_id];
    if (vpaProspectGone(v)) continue;
    const acct = accounts[v.founding_id || r.founding_id];
    if (vpaProspectSignedUp(v, acct)) {
      signedUp++;
      /* A card came in: off the prospects list (hq.html shows them with Venues) but HQ still sees them
         here as Card added, so the free month can be followed through. Comp, invoice and grouped are
         not a card and are only counted. No Auth reads for these: the row has what HQ shows. */
      if (vpaProspectCardOn(acct)) {
        const st = vpaProspectStatus(r, true, null, now);
        cardAdded.push(Object.assign({ venue_id: r.venue_id, name: v.name, slug: v.slug, postcode: v.postcode || '', state: v.au_state || '',
          source: r.source === 'autopilot' ? 'autopilot' : 'hq', contact_name: r.contact_name || '', email: r.email || '',
          phone: r.phone || null, tel: r.phone ? 'tel:' + String(r.phone).replace(/[^\d+]/g, '') : null,
          website: /^https?:\/\//i.test(String(r.website || '')) ? r.website : null,
          created_at: r.created_at, days_since_setup: Math.floor((now - Date.parse(r.created_at)) / DAY) || 0,
          flag: null, called: null }, st));
      }
      continue;
    }
    const users = (staff[r.venue_id] || []).slice();
    if (r.auth_user_id && users.indexOf(r.auth_user_id) === -1) users.push(r.auth_user_id);
    const seen = await vpaProspectLastSignIn(env, users);
    const created = Date.parse(r.created_at);
    const days = isFinite(created) ? Math.floor((now - created) / DAY) : 0;
    const w = welcomes[r.venue_id];
    const welcome = !w ? null : { status: w.status === 'scheduled' && Date.parse(w.send_at) <= now ? 'sent' : w.status,
      send_at: w.send_at, when: vpaBrisbaneTime(Date.parse(w.send_at)) };
    const due = isFinite(created) && (now - created) >= VPA_PROSPECT_FOLLOWUP_DAYS * DAY;
    out.push({ venue_id: r.venue_id, name: v.name, slug: v.slug, postcode: v.postcode || '', state: v.au_state || '',
      source: r.source === 'autopilot' ? 'autopilot' : 'hq', contact_name: r.contact_name || '', email: r.email || '',
      phone: r.phone || null, tel: r.phone ? 'tel:' + String(r.phone).replace(/[^\d+]/g, '') : null,
      website: /^https?:\/\//i.test(String(r.website || '')) ? r.website : null,
      created_at: r.created_at, days_since_setup: days, welcome: welcome,
      last_sign_in_at: seen.at != null ? new Date(seen.at).toISOString() : null, sign_in_known: seen.known,
      called: r.called_at ? { at: r.called_at, by: r.called_label || '', note: r.call_note || '' } : null,
      call_requested: r.call_requested === true,
      follow_up: due && seen.known && seen.at == null && !r.called_at });
    /* THE ONE FLAG A ROW SHOWS. They asked for a call: that comes first, whatever else is true, until
       somebody marks it Called. Otherwise the 3-day no-sign-in flag. */
    const last = out[out.length - 1];
    last.flag = (last.call_requested && !r.called_at) ? 'call_requested' : (last.follow_up ? 'no_sign_in' : null);
    Object.assign(last, vpaProspectStatus(r, false, seen.at, now));
  }
  const RANK = { call_requested: 0, no_sign_in: 1 };
  out.sort((a, b) => ((a.flag ? RANK[a.flag] : 2) - (b.flag ? RANK[b.flag] : 2)) || (Date.parse(b.created_at) - Date.parse(a.created_at)));
  cardAdded.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  return json({ ok: true, follow_up_days: VPA_PROSPECT_FOLLOWUP_DAYS, prospects: out,
    follow_up_count: out.filter((p) => p.flag).length, signed_up: signedUp,
    card_added: cardAdded, free_month_ready: freeMonthReady, last_days: VPA_PROSPECT_LAST_DAYS });
}
/* A card on file, as opposed to comp, invoice or a group: those are signed up but are not "Card added". */
function vpaProspectCardOn(founding) {
  return !!(founding && (founding.stripe_subscription_id || founding.status === 'card_on_file'));
}
/* WHERE A PROSPECT IS (Dean, 29 Oct 2026, HQ > Prospects), one answer for the list, worked out on every read:
     card_added     a card is on file (wins over everything: a paused venue that adds one comes back on)
     cancelled      they pressed "Cancel, it's not for us" (migration 127 cancelled_at)
     paused         the free month ran out with no card (paused_at)
     free_month     somebody has signed in; days_left counts Brisbane days the way the reminder email does
                    (the last day is 1, so the last three days are 3, 2, 1) and last_days is true on them
     not_signed_in  nobody at the venue has signed in yet
   Before migration 127 there is no first_signin_at: a prospect who has signed in is still free_month, with
   no end date, and the list says the free month is not recorded yet. */
const VPA_PROSPECT_LAST_DAYS = 3;
function vpaProspectStatus(r, cardOn, lastSignInMs, nowMs) {
  const base = { first_signin_at: r.first_signin_at || null, free_month_ends_at: r.free_month_ends_at || null,
    paused_at: r.paused_at || null, cancelled_at: r.cancelled_at || null, card_choice: r.card_choice || null,
    offer_rate: Number(r.offer_rate) > 0 ? Number(r.offer_rate) : null,
    reminders_sent: Array.isArray(r.reminders_sent) ? r.reminders_sent : [], days_left: null, last_days: false };
  if (cardOn) return Object.assign(base, { status: 'card_added' });
  if (r.cancelled_at) return Object.assign(base, { status: 'cancelled' });
  if (r.paused_at) return Object.assign(base, { status: 'paused' });
  if (!r.first_signin_at && lastSignInMs == null) return Object.assign(base, { status: 'not_signed_in' });
  const endMs = Date.parse(r.free_month_ends_at || '') || (r.first_signin_at ? vpaFreeMonthEnd(Date.parse(r.first_signin_at)) : NaN);
  if (!isFinite(endMs)) return Object.assign(base, { status: 'free_month' });
  if (!base.free_month_ends_at) base.free_month_ends_at = new Date(endMs).toISOString();
  const left = nowMs > endMs ? 0 : Math.round((vpaBneDayStartMs(vpaBneDay(endMs)) - vpaBneDayStartMs(vpaBneDay(nowMs))) / 86400000) + 1;
  return Object.assign(base, { status: 'free_month', days_left: left, last_days: left <= VPA_PROSPECT_LAST_DAYS });
}
async function vpaProspectCalled(request, env, json) {
  const actor = await vpaRequireAdmin(request, env, ['owner', 'accounts']);
  if (actor.error) return json({ error: actor.error }, actor.status);
  const _b = await vpaBody(request, json);
  if (!_b.ok) return _b.res;
  const b = _b.body || {};
  const id = String(b.venue_id || '');
  if (!/^[0-9a-fA-F-]{36}$/.test(id)) return json({ error: 'Which prospect?' }, 400);
  const note = String(b.note || '').replace(/[\x00-\x09\x0b-\x1f]+/g, ' ').trim();
  if (note.length > VPA_PROSPECT_NOTE_MAX) return json({ error: 'Keep the note under ' + VPA_PROSPECT_NOTE_MAX + ' characters.' }, 400);
  const res = await fetch(env.SUPABASE_URL + '/rest/v1/vp_prospects?venue_id=eq.' + encodeURIComponent(id) + '&select=venue_id,called_at', { headers: vpaHeaders(env) });
  if (!res.ok) return json({ error: 'Run migration 125 first (vp_prospects).', need_migration: 125 }, 503);
  const have = await res.json();
  if (!have || !have.length) return json({ error: 'That venue is not on the prospects list.' }, 404);
  const undo = b.undo === true;
  const patch = undo ? { called_at: null, called_by: null, called_label: null, call_note: null }
    : { called_at: new Date().toISOString(), called_by: actor.actorId || null, called_label: actor.label || null, call_note: note || null };
  const up = await fetch(env.SUPABASE_URL + '/rest/v1/vp_prospects?venue_id=eq.' + encodeURIComponent(id), {
    method: 'PATCH', headers: vpaHeaders(env), body: JSON.stringify(patch) });
  if (!up.ok) return json({ error: 'That did not save. Try again.' }, 502);
  await vpaAudit(env, actor, undo ? 'prospect_call_undone' : 'prospect_called', 'venue:' + id, undo ? {} : { note: note || undefined });
  return json({ ok: true, called: undo ? null : { at: patch.called_at, by: patch.called_label || '', note: note } });
}

/* ===========================================================================
 * A PROSPECT'S FREE MONTH, ITS CARD REMINDERS AND THE PAUSE (Dean, 29 Oct 2026; migration 127)
 *
 *   - the free month starts the FIRST TIME anyone at the venue signs in (POST /account/prospect-start
 *     from the app's setup guide; the hourly sweep also notices a sign-in from Auth), and ends at
 *     11:59:59pm Brisbane on the 30th day after that (VPA_FREE_MONTH_DAYS)
 *   - with no card: three reminders, no more (Dean, 30 Oct 2026; it was seven): day 3, day 23, and the
 *     day before the month ends (day 29), only 8am to 5pm Monday to Friday Brisbane. An early one (3, 23)
 *     that lands on a weekend goes the next Monday; the day-29 one goes the Friday before, so the last one
 *     always beats the pause.
 *     A run that finds several due sends only the newest. Each has "Add my card" and "Cancel, it's
 *     not for us". What has gone is kept in vp_prospects.reminders_sent, so a missed run or a restart
 *     neither loses one nor sends one twice.
 *   - a card (or comp, invoice, group) or a cancel stops them all
 *   - the free month over with no card: the venue PAUSES (status suspended, reason free_month_ended):
 *     games off, the TV keeps its ads (venueLookupReply keeps a suspended venue's screen). The offer
 *     price they were set up on (offer_rate) goes with it: a card added after that is at the price of
 *     that day. A card added after the pause switches the venue straight back on.
 * ======================================================================== */
const VPA_FREE_MONTH_DAYS = 30;
const VPA_REMINDER_DAYS = [3, 23, 29];
const VPA_LAST_REMINDER_FROM = 29;          // 29, the day before the free month ends, is "the last one"
const VPA_STANDARD_RATE = 3.00, VPA_OFFER_RATE = 2.50;
const VPA_BNE_MS = 10 * 3600000;            // Brisbane, UTC+10, no daylight saving
function vpaBneDay(ms) { return new Date(ms + VPA_BNE_MS).toISOString().slice(0, 10); }
function vpaBneDayStartMs(day) { return Date.parse(day + 'T00:00:00Z') - VPA_BNE_MS; }
function vpaAddDays(day, n) { return new Date(Date.parse(day + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10); }
function vpaWeekday(day) { return new Date(Date.parse(day + 'T00:00:00Z')).getUTCDay(); }   // 0 Sunday .. 6 Saturday
/* The free month's last moment: 11:59:59pm Brisbane on the 30th day after the first sign-in. */
function vpaFreeMonthEnd(firstMs) { return vpaBneDayStartMs(vpaAddDays(vpaBneDay(firstMs), VPA_FREE_MONTH_DAYS + 1)) - 1000; }
/* Which reminder goes on which Brisbane day, from the first sign-in: [{ day: 3, date: '2026-11-02' }, ...]. */
function vpaReminderPlan(firstMs) {
  const start = vpaBneDay(firstMs), out = [];
  VPA_REMINDER_DAYS.forEach(function (n) {
    let d = vpaAddDays(start, n), wd = vpaWeekday(d);
    if (n < VPA_LAST_REMINDER_FROM) { while (wd === 0 || wd === 6) { d = vpaAddDays(d, 1); wd = vpaWeekday(d); } }
    else { while (wd === 0 || wd === 6) { d = vpaAddDays(d, -1); wd = vpaWeekday(d); } }
    const same = out.filter(function (x) { return x.date === d; })[0];
    if (same) same.day = Math.max(same.day, n); else out.push({ day: n, date: d });
  });
  return out;
}
function vpaInSendWindow(ms) {
  const d = new Date(ms + VPA_BNE_MS), wd = d.getUTCDay(), m = d.getUTCHours() * 60 + d.getUTCMinutes();
  return wd >= 1 && wd <= 5 && m >= 8 * 60 && m < 17 * 60;
}
/* THE PRICE A PROSPECT'S CARD IS ADDED AT. The offer they were set up on (offer_rate) holds through
   their free month even if that month's offer has since closed; a pause takes it away, and then it is
   whatever is open the day they add the card. Not a prospect: as before, whatever is open now. */
function vpaProspectPrice(env, prow) {
  if (prow && prow.paused_at) { const open = vpaFoundingOpenNow(env); return { founding: open, rate: open ? VPA_OFFER_RATE : VPA_STANDARD_RATE }; }
  if (prow && Number(prow.offer_rate) > 0 && Number(prow.offer_rate) < VPA_STANDARD_RATE) return { founding: true, rate: Number(prow.offer_rate) };
  const open = vpaFoundingOpenNow(env);
  return { founding: open, rate: open ? VPA_OFFER_RATE : VPA_STANDARD_RATE };
}
async function vpaProspectRowFor(env, field, id) {
  if (!id) return null;
  try {
    const res = await fetch(env.SUPABASE_URL + '/rest/v1/vp_prospects?' + field + '=eq.' + encodeURIComponent(id) + '&select=*&limit=1', { headers: vpaHeaders(env) });
    if (!res.ok) return null;
    const rows = await res.json();
    return (rows && rows[0]) || null;
  } catch (_) { return null; }
}
async function vpaProspectPatch(env, venueId, patch) {
  const res = await fetch(env.SUPABASE_URL + '/rest/v1/vp_prospects?venue_id=eq.' + encodeURIComponent(venueId), {
    method: 'PATCH', headers: vpaHeaders(env), body: JSON.stringify(patch) });
  return !!(res && res.ok);
}
/* Start the free month, once. A second call (another sign-in, another device) changes nothing. */
async function vpaProspectStartMonth(env, prow, atMs) {
  if (!prow || prow.first_signin_at) return prow;
  const first = new Date(atMs).toISOString(), ends = new Date(vpaFreeMonthEnd(atMs)).toISOString();
  const res = await fetch(env.SUPABASE_URL + '/rest/v1/vp_prospects?venue_id=eq.' + encodeURIComponent(prow.venue_id) + '&first_signin_at=is.null', {
    method: 'PATCH', headers: vpaHeaders(env), body: JSON.stringify({ first_signin_at: first, free_month_ends_at: ends }) });
  if (res && res.ok) { prow.first_signin_at = first; prow.free_month_ends_at = ends; }
  return prow;
}
/* POST /account/prospect-start { venue_id }   (the venue's owner or a manager; never HQ View as) */
async function vpbProspectStart(request, env, json) {
  const o = await vpbRequireOwner(request, env);
  if (o.error) return json({ error: o.error }, o.status);
  if (o.actingAsAdmin) return json({ ok: true, prospect: false, view_as: true });   // HQ looking never starts anybody's month
  const _b = await vpaBody(request, json);
  if (!_b.ok) return _b.res;
  const venueId = String((_b.body && _b.body.venue_id) || '').trim();
  if (!(o.venues || []).some((v) => v.id === venueId)) return json({ error: 'Pick one of your venues.' }, 400);
  let prow = await vpaProspectRowFor(env, 'venue_id', venueId);
  if (!prow || !('first_signin_at' in prow)) return json({ ok: true, prospect: false });
  prow = await vpaProspectStartMonth(env, prow, Date.now());
  const price = vpaProspectPrice(env, prow);
  return json({ ok: true, prospect: true, first_signin_at: prow.first_signin_at, free_month_ends_at: prow.free_month_ends_at,
    ends_words: vpaBneDateWords(Date.parse(prow.free_month_ends_at)), rate: price.rate, card_choice: prow.card_choice || null,
    paused: !!prow.paused_at });
}
/* POST /account/card-choice { venue_id, choice: 'now' | 'later' }   (owner or manager) */
async function vpbCardChoice(request, env, json) {
  const o = await vpbRequireOwner(request, env);
  if (o.error) return json({ error: o.error }, o.status);
  if (o.actingAsAdmin) return json({ error: 'That is the venue\'s choice. HQ View as cannot make it.' }, 403);
  const _b = await vpaBody(request, json);
  if (!_b.ok) return _b.res;
  const venueId = String((_b.body && _b.body.venue_id) || '').trim();
  const choice = _b.body && _b.body.choice;
  if (!(o.venues || []).some((v) => v.id === venueId)) return json({ error: 'Pick one of your venues.' }, 400);
  if (choice !== 'now' && choice !== 'later') return json({ error: 'Now or later?' }, 400);
  const prow = await vpaProspectRowFor(env, 'venue_id', venueId);
  if (!prow) return json({ ok: true, prospect: false });
  await vpaProspectPatch(env, venueId, { card_choice: choice, card_choice_at: new Date().toISOString() });
  return json({ ok: true, choice: choice, free_month_ends_at: prow.free_month_ends_at || null });
}
/* "Thu 26 Nov", Brisbane. */
function vpaBneDateWords(ms) {
  const d = new Date(ms + VPA_BNE_MS);
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()] + ' ' + d.getUTCDate() + ' ' + VPA_MONTH_NAMES[d.getUTCMonth()];
}
/* The cancel link: signed like the card link, for this account only. */
async function vpaProspectCancelToken(env, foundingId) {
  const secret = vpaCardSecret(env);
  if (!secret || !foundingId) return '';
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, enc.encode('vp-prospect-cancel:' + foundingId));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}
/* NO EMAIL A VENUE OR A PLAYER GETS CARRIES A workers.dev ADDRESS (31 Oct 2026). The prospect welcome to
   laketavern@ozemail.com.au bounced "550 5.7.1 Policy-DT510: Rejected content policy violation" (Ozemail /
   Vocus). Its one link on another domain was this cancel link, on workers.dev, a host spam filters see
   abused every day; a plain reply to the same address with only venueplay.com.au links was delivered. So a
   link in an email is always on our own site: SITE_URL when it is venueplay.com.au, else the apex. */
function vpaCustomerSite(env) {
  const s = String(env.SITE_URL || '').replace(/\/+$/, '');
  return /^https:\/\/(www\.)?venueplay\.com\.au$/.test(s) ? s : 'https://venueplay.com.au';
}
/* The cancel link goes to venueplay/prospect/cancel/ on our site, which asks the same question and only on
   its button POSTs to /prospect/cancel here. Links already sent (to this Worker) keep working. */
async function vpaProspectCancelLink(env, foundingId) {
  const t = await vpaProspectCancelToken(env, foundingId);
  if (!t) return '';
  return vpaCustomerSite(env) + '/prospect/cancel/?f=' + encodeURIComponent(foundingId) + '&t=' + t;
}
/* GET /prospect/cancel?f=&t=  asks; POST (the page's own button) does it. A mail scanner opening the
   link only ever sees the question, so nobody is cancelled by their spam filter.
   reply=json (in the query, or in the POSTed form) is the venueplay.com.au page asking: the same
   answers as JSON, with the CORS headers, so the page can show them. Same token check, same rule:
   only a POST cancels. */
async function vpaProspectCancel(request, env, json) {
  const FOOT = 'Questions? Call 07 5228 3667, between 9am and 5pm Queensland time.';
  let asJson = false;
  const plain = (s) => String(s).replace(/&(amp|lt|gt|quot|#39);/g, (m, k) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" }[k]));
  const page = (title, body, form) => (asJson && json) ? json({ ok: true, state: form ? 'ask' : (title === 'All done' ? 'done' : 'bad'), title: title, text: plain(body), foot: FOOT }) : new Response('<!doctype html><html lang="en-AU"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">' +
    '<title>' + vpaEsc(title) + '</title></head><body style="margin:0;background:#f4f4f7;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#12101a">' +
    '<div style="max-width:520px;margin:0 auto;padding:24px 16px"><div style="background:#fff;border-radius:14px;overflow:hidden">' +
    '<div style="background:#12101a;padding:18px 24px"><img src="https://venueplay.com.au/logos/venueplay_primary_rebuilt.png" width="150" alt="VenuePlay" style="display:block;border:0;height:auto"></div>' +
    '<div style="padding:26px 24px"><h1 style="margin:0 0 12px;font-size:23px;line-height:1.3">' + vpaEsc(title) + '</h1><p style="margin:0 0 18px;font-size:16px;line-height:1.6;color:#3a3a44">' + body + '</p>' + (form || '') +
    '<p style="margin:18px 0 0;font-size:13px;line-height:1.6;color:#6a6a75">' + FOOT + '</p></div></div></div></body></html>',
    { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
  const url = new URL(request.url);
  let f = url.searchParams.get('f') || '', t = url.searchParams.get('t') || '';
  asJson = url.searchParams.get('reply') === 'json';
  if (request.method === 'POST') {
    const form = {};
    String(await request.text().catch(() => '')).split('&').forEach((kv) => {
      const i = kv.indexOf('='); if (i < 0) return;
      try { form[decodeURIComponent(kv.slice(0, i))] = decodeURIComponent(kv.slice(i + 1).replace(/\+/g, ' ')); } catch (_) {}
    });
    f = form.f || f; t = form.t || t;
    if (form.reply === 'json') asJson = true;
  }
  const want = await vpaProspectCancelToken(env, f);
  if (!f || !want || !vpaSameSecret(t, want)) return page('That link has not worked', 'Call us on 07 5228 3667 and we will sort it out for you.');
  const prow = await vpaProspectRowFor(env, 'founding_id', f);
  const vr = prow ? await vpaSelect(env, 'vp_venues', 'id=eq.' + encodeURIComponent(prow.venue_id) + '&select=id,name,status,suspended_reason&limit=1') : [];
  const v = vr && vr[0];
  if (!prow || !v) return page('That link has not worked', 'Call us on 07 5228 3667 and we will sort it out for you.');
  const name = vpaEsc(v.name || 'your venue');
  if (prow.cancelled_at) return page('All done', 'VenuePlay for ' + name + ' is cancelled. Nothing was ever charged, and you will not hear from us about it again.');
  if (request.method !== 'POST') {
    return page('Cancel VenuePlay for ' + (v.name || 'your venue') + '?', 'No problem at all, and thanks for having a look. There is no card on your account, so nothing has been charged and nothing will be. We will switch the account off and stop the reminders.',
      '<form method="post" action=""><input type="hidden" name="f" value="' + vpaEsc(f) + '"><input type="hidden" name="t" value="' + vpaEsc(t) + '">' +
      '<button type="submit" style="display:inline-block;background:#12101a;color:#fff;border:0;font-size:16px;font-weight:700;padding:14px 26px;border-radius:10px;cursor:pointer">Yes, cancel it</button></form>');
  }
  const at = new Date().toISOString();
  await vpaProspectPatch(env, prow.venue_id, { cancelled_at: at });
  if (v.status === 'active') {
    await fetch(env.SUPABASE_URL + '/rest/v1/vp_venues?id=eq.' + encodeURIComponent(v.id), { method: 'PATCH', headers: vpaHeaders(env),
      body: JSON.stringify({ status: 'suspended', suspended_reason: 'cancelled' }) });
  }
  await vpaAudit(env, { actorId: null, label: 'the venue (cancel link)' }, 'prospect_cancelled', 'venue:' + v.id, { name: v.name });
  return page('All done', 'VenuePlay for ' + name + ' is cancelled. Nothing was ever charged, and you will not hear from us about it again. If you change your mind, just call us.');
}
/* A card has come in (the Checkout webhook, or the sweep noticing): reminders stop by themselves (the
   sweep reads the card), and a venue the free month had paused comes straight back on. */
async function vpaProspectCardAdded(env, foundingId) {
  const prow = await vpaProspectRowFor(env, 'founding_id', foundingId);
  if (!prow || !prow.paused_at) return false;
  await fetch(env.SUPABASE_URL + '/rest/v1/vp_venues?id=eq.' + encodeURIComponent(prow.venue_id) + '&status=eq.suspended&suspended_reason=eq.free_month_ended', {
    method: 'PATCH', headers: vpaHeaders(env), body: JSON.stringify({ status: 'active', suspended_reason: null }) });
  await vpaAudit(env, { actorId: null, label: 'stripe' }, 'prospect_unpaused', 'venue:' + prow.venue_id, { founding_id: foundingId });
  return true;
}
/* ONE REMINDER EMAIL, emails/prospect-reminder.html. kind: 'early' (3, 23), 'last' (29, the day before it ends).
   'final' (the last day itself) is no longer on the schedule (Dean, 30 Oct 2026) and is kept only as a template. */
async function vpaRenderProspectReminder(env, o) {
  const site = (env.SITE_URL || 'https://venueplay.com.au').replace(/\/+$/, '');
  const res = await fetch(site + '/emails/prospect-reminder.html');
  if (!res.ok) return null;
  const tpl = String(await res.text());
  let html = tpl.replace(/^\s*<!--[\s\S]*?-->\s*/, '');   // its notes are for us, not the inbox
  html = vpaTplSections(html, { early: o.kind === 'early', last: o.kind === 'last', final: o.kind === 'final', offer: o.offerRate < VPA_STANDARD_RATE, nooffer: !(o.offerRate < VPA_STANDARD_RATE) });
  html = html
    .replace(/{{greeting}}/g, o.firstName ? 'Hi ' + vpaEsc(o.firstName) + ',' : 'Hi there,')
    .replace(/{{venue_name}}/g, vpaEsc(o.venueName || 'your venue'))
    .replace(/{{ends_on}}/g, vpaEsc(o.endsWords))
    .replace(/{{days_left}}/g, String(o.daysLeft))
    .replace(/{{offer_rate}}/g, '$' + Number(o.offerRate).toFixed(2))
    .replace(/{{standard_rate}}/g, '$' + VPA_STANDARD_RATE.toFixed(2))
    .replace(/{{card_url}}/g, o.cardUrl)
    .replace(/{{cancel_url}}/g, o.cancelUrl)
    .replace(/{{terms_url}}/g, site + '/terms')
    .replace(/{{privacy_url}}/g, site + '/privacy')
    .replace(/\{\{unsubscribe_url\}\}/g, site + '/unsubscribe?e=' + encodeURIComponent(o.email))
    .replace(/{{support_email}}/g, 'support@venueplay.com.au')
    .replace(/{{signoff}}/g, vpaProspectSignoff(''));   // a card reminder: from hello@, signed by the team (Dean, 29 Oct 2026)
  const subject = o.kind === 'final' ? 'Last day of your free month at ' + (o.venueName || 'your venue')
    : o.kind === 'last' ? 'Your free month at ' + (o.venueName || 'your venue') + ' ends ' + o.endsWords
    : 'How is VenuePlay going at ' + (o.venueName || 'your venue') + '?';
  return { html: vpaEmailDocument(vpaFillSupport(html), subject), subject: subject };
}
/* THE HOURLY SWEEP (scheduled). nowMs is passed in so the suite can walk a whole month. */
async function vpaProspectReminderSweep(env, nowMs) {
  const out = { started: 0, sent: [], paused: [], stopped: 0 };
  let rows;
  try { rows = await vpaSelectAll(env, 'vp_prospects', 'cancelled_at=is.null&paused_at=is.null&select=*&order=venue_id.asc'); }
  catch (e) { return Object.assign(out, { why: 'migration 127 not run' }); }
  for (const p of rows) {
    if (!('first_signin_at' in p)) return Object.assign(out, { why: 'migration 127 not run' });
    const vr = await vpaSelect(env, 'vp_venues', 'id=eq.' + encodeURIComponent(p.venue_id) + '&select=id,name,status,suspended_reason,group_id,founding_id&limit=1');
    const v = vr && vr[0];
    if (!v || vpaProspectGone(v)) continue;
    const fr = v.founding_id ? await vpaSelect(env, 'venueplay_founding', 'id=eq.' + encodeURIComponent(v.founding_id) + '&select=id,status,stripe_subscription_id,bill_by_invoice&limit=1') : [];
    if (vpaProspectSignedUp(v, fr && fr[0])) { out.stopped++; continue; }   // a card, comp, invoice or group: no reminders, no pause
    if (!p.first_signin_at) {
      // Signed in without the setup guide telling us (another device, an old page): Auth knows.
      let seen = null;
      const staff = await vpaSelect(env, 'vp_venue_staff', 'venue_id=eq.' + encodeURIComponent(p.venue_id) + '&select=auth_user_id');
      const ids = (staff || []).map((s) => s.auth_user_id); if (p.auth_user_id && ids.indexOf(p.auth_user_id) === -1) ids.push(p.auth_user_id);
      for (const id of ids) { const u = await vpaAuthGetUser(env, id); const t = u && Date.parse(u.last_sign_in_at || ''); if (isFinite(t) && t && (seen == null || t < seen)) seen = t; }
      if (seen == null) continue;
      await vpaProspectStartMonth(env, p, Math.min(seen, nowMs));
      out.started++;
    }
    const firstMs = Date.parse(p.first_signin_at), endMs = Date.parse(p.free_month_ends_at) || vpaFreeMonthEnd(firstMs);
    if (nowMs > endMs) {
      if (v.status === 'active') {
        await fetch(env.SUPABASE_URL + '/rest/v1/vp_venues?id=eq.' + encodeURIComponent(v.id) + '&status=eq.active', {
          method: 'PATCH', headers: vpaHeaders(env), body: JSON.stringify({ status: 'suspended', suspended_reason: 'free_month_ended' }) });
      }
      await vpaProspectPatch(env, p.venue_id, { paused_at: new Date(nowMs).toISOString() });
      await vpaAudit(env, { actorId: null, label: 'automatic (free month ended)' }, 'prospect_paused', 'venue:' + v.id, { name: v.name, offer_rate: p.offer_rate || null });
      out.paused.push(v.id);
      continue;
    }
    if (!vpaInSendWindow(nowMs)) continue;
    const sent = Array.isArray(p.reminders_sent) ? p.reminders_sent.slice() : [];
    const today = vpaBneDay(nowMs);
    const due = vpaReminderPlan(firstMs).filter((r) => r.date <= today && sent.indexOf(r.day) === -1);
    if (!due.length) continue;
    const r = due[due.length - 1];
    const email = p.email;
    if (!email || !env.RESEND_API_KEY) continue;
    const kind = r.day >= VPA_FREE_MONTH_DAYS ? 'final' : r.day >= VPA_LAST_REMINDER_FROM ? 'last' : 'early';
    const msg = await vpaRenderProspectReminder(env, { kind: kind, email: email, firstName: p.contact_name || '', venueName: v.name,
      endsWords: vpaBneDateWords(endMs), daysLeft: Math.max(1, Math.round((vpaBneDayStartMs(vpaBneDay(endMs)) - vpaBneDayStartMs(today)) / 86400000) + 1),
      offerRate: Number(p.offer_rate) > 0 ? Number(p.offer_rate) : VPA_STANDARD_RATE,
      cardUrl: await vpaCardLink(env, v.founding_id), cancelUrl: await vpaProspectCancelLink(env, v.founding_id) });
    if (!msg) continue;
    const res = await fetch('https://api.resend.com/emails', { method: 'POST',
      headers: { 'Authorization': 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: VPA_PROSPECT_FROM, reply_to: VPA_PROSPECT_REPLY_TO, to: [email], subject: msg.subject, html: msg.html, text: helpPlainFromHtml(msg.html) }) });
    if (!res || !res.ok) continue;
    due.forEach((d) => { if (sent.indexOf(d.day) === -1) sent.push(d.day); });
    await vpaProspectPatch(env, p.venue_id, { reminders_sent: sent });
    await vpaAudit(env, { actorId: null, label: 'automatic (card reminder)' }, 'prospect_reminder_sent', 'venue:' + v.id, { day: r.day, kind: kind, skipped: due.length - 1 });
    out.sent.push({ venue: v.id, day: r.day, kind: kind });
  }
  // A paused venue whose card has since come in, if the webhook's own switch-on did not land.
  try {
    const paused = await vpaSelectAll(env, 'vp_prospects', 'paused_at=not.is.null&cancelled_at=is.null&select=venue_id,founding_id&order=venue_id.asc');
    for (const p of paused) {
      const fr = p.founding_id ? await vpaSelect(env, 'venueplay_founding', 'id=eq.' + encodeURIComponent(p.founding_id) + '&select=id,status,stripe_subscription_id,bill_by_invoice&limit=1') : [];
      if (vpaProspectSignedUp(null, fr && fr[0]) && await vpaProspectCardAdded(env, p.founding_id)) out.unpaused = (out.unpaused || 0) + 1;
    }
  } catch (_) {}
  return out;
}

/* ===========================================================================
 * ONE-CLICK SIGN-IN: "Open your VenuePlay" in the prospect welcome (migration 123)
 *
 * Dean, 28 Oct 2026: "Can we do a link to click that automatically goes to that page so there's no
 * signing in with an email to confuse them why they then get a text?"
 *
 *   mint     vpaMintSigninLink: 32 bytes from crypto.getRandomValues, base64url. ONLY its SHA-256 is
 *            stored (vp_signin_links, service role only), with the login, the venue and a 14 day life.
 *   link     https://venueplay.com.au/app/go#t=<token>&e=<their email>. The token is in the FRAGMENT, which a browser
 *            never sends to any server: not to Pages, not in a Referer, and not to this Worker in a
 *            request line. The page posts it in a body, and nothing here logs a body.
 *   use      POST /auth/one-click { t }. ONE conditional UPDATE marks the row used: token_hash matches,
 *            used_at is null, expires_at is in the future. Postgres re-checks "used_at is null" under
 *            the row lock, so two clicks at the same instant get exactly one row back between them.
 *            Only the caller that got the row goes on: the login must still be staff at that venue
 *            and still have its email, then Auth's admin generate_link (magiclink, sends nothing)
 *            gives a hashed token that the page exchanges with verifyOtp, exactly as the email-code
 *            sign-in does. The 4 hour sign-out applies: the page starts the shift clock like a code.
 *   refuse   Unknown, used, expired, removed from the venue, malformed: ONE answer, 410 { ok:false },
 *            identical in every case, so nothing says whether a token or an email exists. The page
 *            shows "That link has been used or has expired" with the email sign-in opened.
 *   limit    per network, like /contact and the help desk (helpIpLimit: durable, hashed address).
 * ======================================================================== */
const VPA_SIGNIN_LINK_DAYS = 14;
const VPA_ONECLICK_PER_IP = 20;          // per 10 minutes: a person clicks once or twice; a guesser is stopped
function vpaB64Url(bytes) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] || 0) << 8) | (bytes[i + 2] || 0);
    out += A[(n >> 18) & 63] + A[(n >> 12) & 63];
    if (i + 1 < bytes.length) out += A[(n >> 6) & 63];
    if (i + 2 < bytes.length) out += A[n & 63];
  }
  return out;
}
async function vpaSigninTokenHash(token) { return vpbSha256Hex(new TextEncoder().encode(String(token))); }
/* startsAtMs: when the email carrying it goes (a delayed welcome, up to a day ahead). The 14 days run
   from then, and migration 123's own check (expires within 15 days of created) still holds. */
async function vpaMintSigninLink(env, authUserId, venueId, startsAtMs) {
  const raw = new Uint8Array(32);
  crypto.getRandomValues(raw);
  const token = vpaB64Url(raw);
  const now = Date.now();
  const from = Math.max(now, Math.min(Number(startsAtMs) || now, now + VPA_PROSPECT_MAX_DELAY_MIN * 60000));
  await vpaInsert(env, 'vp_signin_links', {
    token_hash: await vpaSigninTokenHash(token), auth_user_id: authUserId, venue_id: venueId, purpose: 'prospect_welcome',
    created_at: new Date(now).toISOString(), expires_at: new Date(from + VPA_SIGNIN_LINK_DAYS * 86400000).toISOString(), used_at: null,
  }, false);
  return token;
}
/* The email's main button. With a token it signs them in. Without one (migration 123 missing) it opens the
   same page with no token, which offers to email them a link (POST /auth/one-click/resend). NEVER the
   email-code sign-in (Dean, 29 Oct 2026: "it's got to be phone number"). Their own address rides in the
   fragment so that page knows where to send a new link. Fragment only: it is never sent to a server. */
function vpaOneClickUrl(site, token, email) {
  const e = email ? 'e=' + encodeURIComponent(email) : '';
  return token ? site + '/app/go#t=' + token + (e ? '&' + e : '') : site + '/app/go' + (e ? '#' + e : '');
}
async function vpaHandleOneClick(request, env, json) {
  const GONE = { ok: false };
  const ip = request.headers.get('cf-connecting-ip') || '';
  if (ip && !(await helpIpLimit(env, 'oneclick', ip, VPA_ONECLICK_PER_IP, 600))) return json({ ok: false, busy: true }, 429);
  const _b = await vpaBody(request, json);
  if (!_b.ok) return json(GONE, 410);
  const token = String((_b.body && _b.body.t) || '');
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return json(GONE, 410);
  const hash = await vpaSigninTokenHash(token);
  const nowIso = new Date().toISOString();
  let rows = null;
  try {
    const res = await fetch(env.SUPABASE_URL + '/rest/v1/vp_signin_links?token_hash=eq.' + hash + '&used_at=is.null&expires_at=gt.' + encodeURIComponent(nowIso) + '&select=auth_user_id,venue_id', {
      method: 'PATCH',
      headers: { ...vpaHeaders(env), 'Prefer': 'return=representation' },
      body: JSON.stringify({ used_at: nowIso }),
    });
    if (res.ok) rows = await res.json().catch(() => null);
  } catch (_) { rows = null; }
  if (!Array.isArray(rows) || rows.length !== 1) return json(GONE, 410);
  const link = rows[0];
  // Still on that venue's staff: HQ removing them since the email went out ends the link too.
  const staff = await vpaSelect(env, 'vp_venue_staff', 'auth_user_id=eq.' + encodeURIComponent(link.auth_user_id) +
    '&venue_id=eq.' + encodeURIComponent(link.venue_id) + '&select=role&limit=1');
  if (!staff || staff.length !== 1) return json(GONE, 410);
  const user = await vpaAuthGetUser(env, link.auth_user_id);
  const email = user && user.email ? String(user.email).trim().toLowerCase() : '';
  if (!email || (user.banned_until && Date.parse(user.banned_until) > Date.now())) return json(GONE, 410);
  let d = null;
  try {
    const gl = await fetch(env.SUPABASE_URL + '/auth/v1/admin/generate_link', {
      method: 'POST', headers: vpaHeaders(env), body: JSON.stringify({ type: 'magiclink', email: email }),
    });
    if (gl.ok) d = await gl.json().catch(() => null);
  } catch (_) { d = null; }
  const p = (d && (d.properties || d)) || {};
  if (!p.hashed_token || typeof p.hashed_token !== 'string') return json(GONE, 410);
  return json({ ok: true, token_hash: p.hashed_token, type: p.verification_type === 'email' ? 'email' : 'magiclink', venue_id: link.venue_id });
}

/* ===========================================================================
 * A NEW LINK WHEN THE OLD ONE IS USED OR EXPIRED (Dean, 29 Oct 2026: "otherwise we can resend it or maybe
 * they could resend it")
 *
 *   self     POST /auth/one-click/resend { t?, e? }   from /app/go when the link is spent. The OLD token
 *            (used or expired, it does not matter) finds the login it was made for; without one, the
 *            address from the link's fragment. The new link goes to THAT LOGIN'S OWN EMAIL, never to an
 *            address the caller chose, so a forwarded or guessed request can only ever reach the owner.
 *            ONE answer whatever happens ({ ok:true }): no login, no venue, over the limit and sent all
 *            look the same, so nothing says whether an address or a token exists. Only the per-network
 *            limit answers differently (429), and that is about the caller, not about any address.
 *   HQ       POST /admin/signin-link { venue_id }  (owner | accounts): "Resend sign-in link" on the venue
 *            and on the prospect. Says who it went to, because HQ asked.
 *   both     vpaSendSigninLink: still staff somewhere, an email on the login, not banned, at most
 *            VPA_SIGNIN_LINKS_PER_DAY links in 24 hours (the welcome's own link counts); every older
 *            unused link for that login is retired first, so only the newest works; then a fresh
 *            14 day, one-use link (vpaMintSigninLink, hash only) and a short email from Dean.
 * ======================================================================== */
const VPA_RESEND_PER_IP = 6;             // per hour, per network
const VPA_SIGNIN_LINKS_PER_DAY = 4;      // per login, self-serve (the welcome's link counts as one)
const VPA_SIGNIN_LINKS_PER_DAY_HQ = 10;  // per login, when HQ presses the button
async function vpaSendSigninLink(env, authUserId, venueId, opts) {
  opts = opts || {};
  if (!authUserId) return { ok: false, reason: 'no_login' };
  const user = await vpaAuthGetUser(env, authUserId);
  const email = user && user.email ? String(user.email).trim().toLowerCase() : '';
  if (!user || !email) return { ok: false, reason: 'no_email' };
  if (user.banned_until && Date.parse(user.banned_until) > Date.now()) return { ok: false, reason: 'no_login' };
  const staff = await vpaSelect(env, 'vp_venue_staff', 'auth_user_id=eq.' + encodeURIComponent(authUserId) + '&select=venue_id,role&order=venue_id.asc&limit=50');
  if (!staff || !staff.length) return { ok: false, reason: 'no_venue' };
  const RANK = { owner: 0, manager: 1, host: 2 };
  const pick = staff.find((s) => s.venue_id === venueId) || staff.slice().sort((a, b) => (RANK[a.role] || 9) - (RANK[b.role] || 9))[0];
  const since = new Date(Date.now() - 86400000).toISOString();
  const recent = await vpaSelect(env, 'vp_signin_links', 'auth_user_id=eq.' + encodeURIComponent(authUserId) + '&created_at=gt.' + encodeURIComponent(since) + '&select=id&limit=50');
  if (recent === null || recent === undefined) return { ok: false, reason: 'no_table' };
  const cap = opts.hq ? VPA_SIGNIN_LINKS_PER_DAY_HQ : VPA_SIGNIN_LINKS_PER_DAY;
  if (recent.length >= cap) return { ok: false, reason: 'limit', to: email, count: recent.length };
  // Only the newest link works: every unused one for this login is retired before the new one is made.
  try {
    await fetch(env.SUPABASE_URL + '/rest/v1/vp_signin_links?auth_user_id=eq.' + encodeURIComponent(authUserId) + '&used_at=is.null', {
      method: 'PATCH', headers: vpaHeaders(env), body: JSON.stringify({ used_at: new Date().toISOString() }) });
  } catch (_) {}
  let token;
  try { token = await vpaMintSigninLink(env, authUserId, pick.venue_id, Date.now()); }
  catch (e) { return { ok: false, reason: 'no_table' }; }
  const vs = await vpaSelect(env, 'vp_venues', 'id=eq.' + encodeURIComponent(pick.venue_id) + '&select=name&limit=1');
  const venueName = (vs && vs[0] && vs[0].name) || '';
  const site = (env.SITE_URL || 'https://venueplay.com.au').replace(/\/+$/, '');
  const url = vpaOneClickUrl(site, token, email);
  const first = String((user.user_metadata && (user.user_metadata.full_name || user.user_metadata.name)) || '').trim().split(/\s+/)[0];
  const P = 'margin:0 0 14px;font-size:16px;line-height:1.6;color:#3a3a44';
  const inner = '<h1 style="margin:0 0 16px;font-size:24px;line-height:1.25;color:#12101a;font-weight:800">Your sign-in link</h1>'
    + '<p style="' + P + '">' + (first ? 'Hi ' + vpaEsc(first) + ',' : 'Hi there,') + '</p>'
    + '<p style="' + P + '">Here is a fresh link to open your VenuePlay' + (venueName ? ' for ' + vpaEsc(venueName) : '') + '. Tap the button and you are in.</p>'
    + '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0 18px"><tr><td><a href="' + vpaEsc(url) + '" style="display:inline-block;background:#FF1F8E;color:#ffffff;text-decoration:none;font-size:16px;font-weight:700;padding:14px 30px;border-radius:10px">Open your VenuePlay</a></td></tr></table>'
    + '<p style="' + P + '">' + (user.phone ? 'You can also sign in any time with your mobile, and we will text you a code.' : 'Once you are in, pop in your mobile and from then on you sign in with a text code.') + '</p>'
    + '<p style="margin:0 0 14px;font-size:14px;line-height:1.6;color:#6a6a74">Did not ask for this? You can ignore it. The link only opens your own account, and nothing changes unless you tap it.</p>'
    + '<p style="margin:0;font-size:16px;line-height:1.6;color:#3a3a44">' + vpaProspectSignoff(null) + '</p>';
  let sent = false;
  try {
    sent = await vpaSendEmail(env, email, 'Your VenuePlay sign-in link',
      vpaVenueEmailCard('A fresh link to open your VenuePlay' + (venueName ? ' for ' + venueName : '') + '.', inner, 'Your VenuePlay sign-in link'), VPA_PROSPECT_REPLY_TO);
  } catch (_) { sent = false; }
  if (!sent) { await vpaProspectRetireLink(env, await vpaSigninTokenHash(token)); return { ok: false, reason: 'email_failed', to: email }; }
  return { ok: true, to: email, venue_id: pick.venue_id, venue_name: venueName, has_mobile: !!user.phone };
}
async function vpaHandleOneClickResend(request, env, json) {
  const SAME = { ok: true };
  const ip = request.headers.get('cf-connecting-ip') || '';
  if (ip && !(await helpIpLimit(env, 'oneclick-resend', ip, VPA_RESEND_PER_IP, 3600))) return json({ ok: false, busy: true }, 429);
  const _b = await vpaBody(request, json);
  if (!_b.ok) return json(SAME);
  const t = String((_b.body && _b.body.t) || '');
  const e = String((_b.body && _b.body.e) || '').trim().toLowerCase();
  try {
    let who = null;
    if (/^[A-Za-z0-9_-]{43}$/.test(t)) {
      const rows = await vpaSelect(env, 'vp_signin_links', 'token_hash=eq.' + (await vpaSigninTokenHash(t)) + '&select=auth_user_id,venue_id&limit=1');
      if (rows && rows[0]) who = { id: rows[0].auth_user_id, venue: rows[0].venue_id };
    }
    if (!who && e && e.length <= 200 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) {
      const u = await vpaFindAuthUser(env, { email: e });
      if (u && u.id) who = { id: u.id, venue: null };
    }
    if (who) {
      const r = await vpaSendSigninLink(env, who.id, who.venue, {});
      await vpaAudit(env, { actorId: null, label: 'self (sign-in page)', role: null }, r.ok ? 'signin_link_resent' : 'signin_link_resend_refused',
        'auth_user:' + who.id, { reason: r.ok ? undefined : r.reason, venue_id: r.venue_id || who.venue || undefined, by_token: !!(t && who.venue) });
    }
  } catch (_) {}
  return json(SAME);
}
async function vpaAdminSigninLink(request, env, json) {
  const actor = await vpaRequireAdmin(request, env, ['owner', 'accounts']);
  if (actor.error) return json({ error: actor.error }, actor.status);
  const _b = await vpaBody(request, json);
  if (!_b.ok) return _b.res;
  const venueId = String((_b.body && _b.body.venue_id) || '').trim();
  if (!/^[0-9a-fA-F-]{36}$/.test(venueId)) return json({ error: 'Which venue?' }, 400);
  const vs = await vpaSelect(env, 'vp_venues', 'id=eq.' + encodeURIComponent(venueId) + '&select=id,name&limit=1');
  const venue = vs && vs[0];
  if (!venue) return json({ error: 'That venue no longer exists.' }, 404);
  // Whose link: the prospect's own login first (HQ > Prospects), then the venue's owner, then a manager.
  const ids = [];
  try {
    const pr = await vpaSelect(env, 'vp_prospects', 'venue_id=eq.' + encodeURIComponent(venueId) + '&select=auth_user_id&limit=1');
    if (pr && pr[0] && pr[0].auth_user_id) ids.push(pr[0].auth_user_id);
  } catch (_) {}
  const staff = await vpaSelect(env, 'vp_venue_staff', 'venue_id=eq.' + encodeURIComponent(venueId) + '&role=in.(owner,manager)&select=auth_user_id,role&limit=20');
  (staff || []).sort((a, b) => (a.role === 'owner' ? 0 : 1) - (b.role === 'owner' ? 0 : 1)).forEach((s) => { if (ids.indexOf(s.auth_user_id) < 0) ids.push(s.auth_user_id); });
  let r = { ok: false, reason: 'no_login' };
  for (let i = 0; i < ids.length && i < 6; i++) {
    r = await vpaSendSigninLink(env, ids[i], venueId, { hq: true });
    if (r.ok || (r.reason !== 'no_email' && r.reason !== 'no_venue' && r.reason !== 'no_login')) break;
  }
  await vpaAudit(env, actor, r.ok ? 'signin_link_sent' : 'signin_link_refused', 'venue:' + venueId, { name: venue.name, to: r.to || undefined, reason: r.ok ? undefined : r.reason });
  if (r.ok) return json({ ok: true, to: r.to, has_mobile: r.has_mobile });
  const name = venue.name || 'That venue';
  if (r.reason === 'limit') return json({ error: r.count + ' sign-in links have gone to ' + r.to + ' in the last day. Check with them before sending another.' }, 429);
  if (r.reason === 'email_failed') return json({ error: 'The email to ' + r.to + ' did not send, so nothing reached them. Try again in a minute.' }, 502);
  if (r.reason === 'no_table') return json({ error: 'Sign-in links need migration 123, which is not on this database.' }, 503);
  return json({ error: 'Nobody at ' + name + ' has an email on their login, so there is nowhere to send a link. They sign in with their mobile.' }, 400);
}

/* ===========================================================================
 * POST /account/my-name { name }   (any venue login, for ITSELF)
 *
 * The first screen after the one-off link asks their name and mobile (venueplay/app/vp-about-you.js). The
 * mobile goes on through Auth's own verified phone change; the name rides with it onto the login
 * (user_metadata.full_name) and comes here for their venue staff rows, which is what HQ and the Hosts list
 * show. Only the caller's own rows, by the token's own id: X-VP-Venue and View as change nothing.
 * ======================================================================== */
async function vpbMyName(request, env, json) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (!token) return json({ error: 'Not signed in.' }, 401);
  const payload = await vpaVerifyJWT(token, env.SUPABASE_JWT_SECRET, env);
  if (!payload || !payload.sub) return json({ error: 'Invalid or expired session. Please sign in again.' }, 401);
  const _b = await vpaBody(request, json);
  if (!_b.ok) return _b.res;
  const name = String((_b.body && _b.body.name) || '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60);
  if (!name) return json({ error: 'Pop your name in first.' }, 400);
  const mine = await vpaSelect(env, 'vp_venue_staff', 'auth_user_id=eq.' + encodeURIComponent(payload.sub) + '&select=venue_id&limit=50');
  if (!mine || !mine.length) return json({ error: 'This login has no venues.' }, 403);
  const up = await fetch(env.SUPABASE_URL + '/rest/v1/vp_venue_staff?auth_user_id=eq.' + encodeURIComponent(payload.sub), {
    method: 'PATCH', headers: vpaHeaders(env), body: JSON.stringify({ display_name: name }) });
  if (!up.ok) return json({ error: 'That did not save. Try again.' }, 502);
  return json({ ok: true, name: name });
}

/* NUMBER BINGO, ONE LINE FOR THE WELCOME, BY STATE AND BY CLUB OR PUB. The words are vp-gaming.js's
   (VPGaming.states[st].phones.bingo, .paperBingo and numberBingoHidden), which a Worker cannot load,
   so tools/test-prospect-setup.js runs both and holds every state's kind equal. Musical bingo is
   NOT bingo and is never in here. kind: 'phones' | 'paper' | 'off'. */
const VPA_PROSPECT_STATE_NAME = { NSW: 'New South Wales', QLD: 'Queensland', VIC: 'Victoria', WA: 'Western Australia',
  SA: 'South Australia', ACT: 'ACT', TAS: 'Tasmania', NT: 'the Northern Territory' };
const VPA_PROSPECT_PAPER_BINGO = { VIC: true, SA: true, TAS: true };
function vpaProspectBingo(state, entityType) {
  const st = String(state || '').toUpperCase();
  const place = VPA_PROSPECT_STATE_NAME[st] || 'your state';
  if (vpaNoNumberBingo(st, entityType, false)) {
    return { kind: 'off', text: 'In ' + place + ', only a not-for-profit organisation may run number bingo, so it is switched off for pubs and you will not see it. If a club or charity runs number bingo at your venue, reply and tell us who, and we will switch it on once we have seen their approval.' };
  }
  if (st === 'VIC') {
    return { kind: 'paper', text: 'In Victoria a phone cannot be used as a ticket, so number bingo is played on printed tickets: hand them out and run the calling and the big screen from VenuePlay. Free entry needs no permit; ' +
      (entityType === 'non_profit' ? 'charging for entry needs a minor gaming permit, recorded on your account page first.' : 'charging for entry is for non-profits with a permit.') };
  }
  if (st === 'SA') {
    return { kind: 'paper', text: 'In South Australia number bingo is played on paper sheets from a licensed supplier (phones cannot be tickets there): run the calling and the big screen from VenuePlay.' };
  }
  if (st === 'TAS') {
    return { kind: 'paper', text: 'In Tasmania number bingo is played on printed tickets: hand them out and run the calling and the big screen from VenuePlay.' };
  }
  return { kind: 'phones', text: 'Open lobby, players join on their phones from the QR on the TV, and you call the numbers. Your console shows ' + place + '\'s rules before every game.' };
}

/* WHICH OFFER A PROSPECT'S EMAIL NAMES (Dean, 29 Oct 2026). It used to be the LATEST month among the
   live codes, and FOUNDING_CODES lists every month to March 2027 in advance (a code is honoured from the
   day it is listed to the end of its month), so a prospect set up on 29 October was told "while the
   March offer runs". The offer is the one THE CAMPAIGN THEY REPLIED TO carried: the autopilot sends
   that campaign's code as offer_code (OFFER-NOV-2026 for the /offer-nov link), and it must be a code
   that is listed and live. Nothing sent (HQ's form): the code for THIS month in Brisbane, never a later
   one. vpaProspectOffer is the one place that choice is made; the phrase only words it. */
const VPA_MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function vpaCodeMonth(code) {
  const m = /-([A-Z]{3})-(20\d\d)$/.exec(String(code || '').trim().toUpperCase());
  return (m && (m[1] in VPA_CODE_MONTHS)) ? { y: Number(m[2]), m: VPA_CODE_MONTHS[m[1]] } : null;
}
/* { code } (null when no dated offer is running this month), or { error } for a code that was never
   listed. A listed code whose month has ended falls back to this month's, with a warning, so a reply
   handled on the 1st still gets its account. */
function vpaProspectOffer(env, raw, nowMs) {
  const now = nowMs == null ? Date.now() : nowMs;
  const live = vpaLiveCodes(env, now);
  const want = String(raw == null ? '' : raw).trim().toUpperCase();
  let warning = null;
  if (want) {
    if (!/^[A-Z]{2,8}-[A-Z]{3}-20\d\d$/.test(want) || !vpaCodeMonth(want)) return { error: 'offer_code ' + want.slice(0, 40) + ' is not an offer code (like OFFER-NOV-2026).' };
    if (live.indexOf(want) !== -1) return { code: want };
    const listed = (env.FOUNDING_CODES || '').split(',').map(function (c) { return c.trim().toUpperCase(); }).indexOf(want) !== -1;
    if (!listed) return { error: 'offer_code ' + want + ' is not one of our offers. Leave it out to use this month\'s.' };
    warning = 'Their campaign\'s offer (' + want + ') has ended, so their email names this month\'s offer instead.';
  }
  const b = new Date(now + 10 * 3600 * 1000);   // Brisbane, UTC+10 all year
  const here = live.filter(function (c) { const cm = vpaCodeMonth(c); return cm && cm.y === b.getUTCFullYear() && cm.m === b.getUTCMonth(); });
  here.sort(function (a, c) { return (c.indexOf('OFFER-') === 0) - (a.indexOf('OFFER-') === 0); });   // the monthly OFFER- code before a state one
  return { code: here[0] || null, warning: warning };
}
function vpaOfferMonthPhrase(code) {
  const cm = vpaCodeMonth(code);
  return cm ? 'while the ' + VPA_MONTH_NAMES[cm.m] + ' offer runs' : 'while our offer runs';
}

/* THE PROSPECT'S ONE EMAIL, emails/welcome-prospect.html (version 2, Dean, 28 Oct 2026). Short and
   personal, from Dean: as promised, here is your account, ONE button, about 5 minutes, the price in one
   line, the Spam Act footer. Everything else lives in the app's first-run setup. Sent from "Dean at
   VenuePlay" on the transactional domain with a text part, and, when o.sendAtMs is given, held by
   Resend until then (scheduled_at). Returns { ok, id }: id is Resend's, for cancelling it. */
/* FROM hello@, REPLIES TO hello@ (Dean, 29 Oct 2026: "it all should come from hello, not Dean"). The address is
   hello@ on send.venueplay.com.au, the only domain Resend is verified to send from (every VenuePlay email
   goes from it); replies land in hello@venueplay.com.au. Never a person's or a cold mailbox. */
const VPA_PROSPECT_FROM = 'VenuePlay <hello@send.venueplay.com.au>';
const VPA_PROSPECT_REPLY_TO = 'hello@venueplay.com.au';
/* The domains our own mailboxes live on: venueplay.com.au and the cold-email ones (Instantly). */
const VPA_OUR_MAIL_DOMAINS = ['venueplay.com.au', 'getvenueplay.com.au', 'getvenueplay.com', 'venueplay.online', 'venueplayhq.com.au',
  'venueplayhq.com', 'venueplaylive.com.au', 'venueplaygames.com.au', 'venueplaygames.com'];
function vpaProspectSender(rawName, rawEmail) {
  const name = String(rawName == null ? '' : rawName).replace(/\s+/g, ' ').trim();
  const email = String(rawEmail == null ? '' : rawEmail).trim().toLowerCase();
  if (!name && !email) return {};
  if (!name || !email) return { error: 'Give both sender_name and sender_email, or neither.' };
  if (name.length > 40 || !/^[A-Za-z][A-Za-z' .-]*$/.test(name)) return { error: 'sender_name must be a plain name (letters, spaces, apostrophes, hyphens), up to 40 characters.' };
  const m = /^[a-z0-9._%+-]+@([a-z0-9.-]+)$/.exec(email);
  if (!m || email.length > 120 || VPA_OUR_MAIL_DOMAINS.indexOf(m[1]) === -1) return { error: 'sender_email must be one of our own mailboxes (' + VPA_OUR_MAIL_DOMAINS.join(', ') + ').' };
  return { name: name, email: email };
}
/* The sign-off: their name, VenuePlay, the website. No phone but the support line, which the footer carries. */
function vpaProspectSignoff(senderName) {
  const who = senderName ? vpaEsc(senderName) : 'The VenuePlay team';
  return 'Cheers,<br>' + who + '<br>' + (senderName ? 'VenuePlay<br>' : '') + '<a href="https://venueplay.com.au" style="color:#FF1F8E;text-decoration:none">venueplay.com.au</a>';
}
function vpaProspectSubject(venueName) { return 'Your VenuePlay account for ' + (venueName || 'your venue'); }
async function vpaRenderProspectWelcome(env, o) {
  const site = (env.SITE_URL || 'https://venueplay.com.au').replace(/\/+$/, '');
  const email = String(o.email || '').trim();
  const res = await fetch(site + '/emails/welcome-prospect.html');
  if (!res.ok) return null;
  let html = String(await res.text()).replace(/^\s*<!--[\s\S]*?-->\s*/, '');   // the template's notes are for us, not the inbox
  const founding = vpaFoundingOpenNow(env);
  const rate = founding ? 2.50 : 3.00;
  /* HOW THEY SIGN IN (Dean, 29 Oct 2026: "everyone has their phone in their hand"). A login with their
     mobile on it signs in by a texted code (the MobileMessage hook, as every venue login does), and the
     button opens that sign-in with their number filled in. Otherwise the one-click link, else email. */
  const mobile = vpaProspectPhone(o.mobile);
  const sms = !!(o.mobileLogin && mobile && mobile.indexOf('04') === 0);
  html = vpaTplSections(html, { slides: o.slides > 0, noslides: !(o.slides > 0), sms: sms, samelogin: sms && !!o.sameLogin, oneclick: !sms && !!o.signinToken,
    nooneclick: !sms && !o.signinToken, founding: founding, standard: !founding });
  html = html
    .replace(/{{greeting}}/g, o.firstName ? 'Hi ' + vpaEsc(o.firstName) + ',' : 'Hi there,')
    .replace(/{{venue_name}}/g, vpaEsc(o.venueName || 'your venue'))
    .replace(/{{signin_url}}/g, sms ? site + '/app/?signin=sms#m=' + mobile.replace(/\D/g, '') : vpaOneClickUrl(site, o.signinToken, email))
    .replace(/{{login_mobile}}/g, sms ? vpaEsc(mobile) : '')
    .replace(/{{player_count}}/g, String(parseInt(o.seats, 10) > 0 ? parseInt(o.seats, 10) : VPA_PROSPECT_DEFAULT_PLAYERS))
    .replace(/{{cancel_url}}/g, (o.foundingId && await vpaProspectCancelLink(env, o.foundingId)) || 'mailto:support@venueplay.com.au?subject=Cancel%20VenuePlay')
    .replace(/{{login_email}}/g, vpaEsc(email))
    .replace(/{{player_rate}}/g, '$' + rate.toFixed(2))
    .replace(/{{offer_phrase}}/g, vpaOfferMonthPhrase(o.offerCode !== undefined ? o.offerCode : vpaProspectOffer(env).code))   // a welcome booked before offer_code existed: this month's
    .replace(/{{terms_url}}/g, site + '/terms')
    .replace(/{{privacy_url}}/g, site + '/privacy')
    .replace(/\{\{unsubscribe_url\}\}/g, site + '/unsubscribe?e=' + encodeURIComponent(email))
    .replace(/{{support_email}}/g, 'support@venueplay.com.au')
    // The sign-off (and, until the new template is on Pages, the old fixed one in its place).
    .replace(/{{signoff}}|Cheers,<br>Dean<br>VenuePlay/g, vpaProspectSignoff(vpaProspectSender(o.senderName, o.senderEmail).name));
  return vpaEmailDocument(vpaFillSupport(html), vpaProspectSubject(o.venueName));
}
async function vpaFireProspectWelcome(env, o) {
  try {
    if (!env.RESEND_API_KEY) return { ok: false };
    const email = String(o.email || '').trim();
    if (!email) return { ok: false };
    const html = await vpaRenderProspectWelcome(env, o);
    if (!html) return { ok: false };
    const msg = { from: VPA_PROSPECT_FROM, reply_to: VPA_PROSPECT_REPLY_TO, to: [email],
      subject: vpaProspectSubject(o.venueName),
      html: html, text: helpPlainFromHtml(html) };
    if (o.sendAtMs && o.sendAtMs > Date.now()) msg.scheduled_at = new Date(o.sendAtMs).toISOString();
    const res = await fetch('https://api.resend.com/emails', { method: 'POST',
      headers: { 'Authorization': 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(msg) });
    if (!res || !res.ok) return { ok: false };
    const j = await res.json().catch(() => ({}));
    return { ok: true, id: (j && typeof j.id === 'string') ? j.id : null };
  } catch (_) { return { ok: false }; }
}
/* "4:35pm Wed 28 Oct", Brisbane time (no daylight saving: UTC+10 all year), for HQ's words. */
function vpaBrisbaneTime(ms) {
  const d = new Date(Number(ms) + 10 * 3600000);
  const h = d.getUTCHours(), m = d.getUTCMinutes();
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return ((h % 12) || 12) + ':' + ('0' + m).slice(-2) + (h < 12 ? 'am' : 'pm') + ' ' + DAYS[d.getUTCDay()] + ' ' + d.getUTCDate() + ' ' + VPA_MONTH_NAMES[d.getUTCMonth()].slice(0, 3);
}

/* ===========================================================================
 * THE DELAYED WELCOME, HQ's SIDE (migration 124, vp_prospect_welcomes; service role only)
 *
 *   one row per welcome: the venue, who it goes to, Resend's id, when it goes, its status, the hash
 *   of the sign-in link it carries, and what it was made from (detail), so Send now can make it again.
 *   POST /admin/prospect/welcomes        the ones still to go, and the last two days' (owner | accounts)
 *   POST /admin/prospect/welcome-cancel  { id }: Resend cancels it, its sign-in link is retired
 *   POST /admin/prospect/welcome-now     { id }: Resend cancels the booked one, a NEW one goes now with
 *                                        a NEW link whose 14 days start now, and the old link is retired
 * Both refuse once the minute has passed: by then it has gone and there is nothing to cancel.
 * ======================================================================== */
async function vpaProspectWelcomeRecord(env, actor, venueId, resendId, sendAtMs, status, linkHash, render) {
  try {
    return await vpaInsert(env, 'vp_prospect_welcomes', {
      venue_id: venueId, email: render.email, resend_id: resendId || null, send_at: new Date(sendAtMs).toISOString(),
      status: status, signin_token_hash: linkHash || null, detail: render,
      created_by: actor.actorId || null, created_label: actor.label || null,
    });
  } catch (e) { return null; }
}
async function vpaProspectRetireLink(env, hash) {
  if (!hash) return;
  try {
    await fetch(env.SUPABASE_URL + '/rest/v1/vp_signin_links?token_hash=eq.' + encodeURIComponent(hash) + '&used_at=is.null', {
      method: 'PATCH', headers: vpaHeaders(env), body: JSON.stringify({ used_at: new Date().toISOString() }) });
  } catch (_) {}
}
async function vpaResendCancel(env, id) {
  if (!id || !env.RESEND_API_KEY) return false;
  try {
    const res = await fetch('https://api.resend.com/emails/' + encodeURIComponent(id) + '/cancel', { method: 'POST',
      headers: { 'Authorization': 'Bearer ' + env.RESEND_API_KEY } });
    return !!(res && res.ok);
  } catch (_) { return false; }
}
async function vpaProspectWelcomeRow(request, env, json) {
  const actor = await vpaRequireAdmin(request, env, ['owner', 'accounts']);
  if (actor.error) return { res: json({ error: actor.error }, actor.status) };
  const _b = await vpaBody(request, json);
  if (!_b.ok) return { res: _b.res };
  const id = String((_b.body && _b.body.id) || '');
  if (!/^[0-9a-fA-F-]{36}$/.test(id)) return { res: json({ error: 'Which email?' }, 400) };
  const rows = await vpaSelect(env, 'vp_prospect_welcomes', 'id=eq.' + encodeURIComponent(id) + '&select=*&limit=1');
  const row = rows && rows[0];
  if (!row) return { res: json({ error: 'That email is not there any more.' }, 404) };
  if (row.status !== 'scheduled') return { res: json({ error: 'That email is already ' + (row.status === 'cancelled' ? 'cancelled' : 'sent') + '.' }, 409) };
  if (Date.parse(row.send_at) <= Date.now()) return { res: json({ error: 'That email has already gone (it was booked for ' + vpaBrisbaneTime(Date.parse(row.send_at)) + ').' }, 409) };
  return { actor: actor, row: row };
}
async function vpaProspectWelcomeMark(env, row, patch) {
  await fetch(env.SUPABASE_URL + '/rest/v1/vp_prospect_welcomes?id=eq.' + encodeURIComponent(row.id) + '&status=eq.scheduled', {
    method: 'PATCH', headers: vpaHeaders(env), body: JSON.stringify(patch) });
}
async function vpaProspectWelcomes(request, env, json) {
  const actor = await vpaRequireAdmin(request, env, ['owner', 'accounts']);
  if (actor.error) return json({ error: actor.error }, actor.status);
  const since = new Date(Date.now() - 2 * 86400000).toISOString();
  const rows = await vpaSelect(env, 'vp_prospect_welcomes', 'send_at=gte.' + encodeURIComponent(since) +
    '&select=id,venue_id,email,send_at,status,detail&order=send_at.desc&limit=50');
  const now = Date.now();
  return json({ ok: true, welcomes: (rows || []).map((r) => ({ id: r.id, venue_id: r.venue_id, email: r.email,
    venue_name: (r.detail && r.detail.venueName) || '', send_at: r.send_at, when: vpaBrisbaneTime(Date.parse(r.send_at)),
    status: r.status === 'scheduled' && Date.parse(r.send_at) <= now ? 'sent' : r.status,
    can_change: r.status === 'scheduled' && Date.parse(r.send_at) > now })) });
}
async function vpaProspectWelcomeCancel(request, env, json) {
  const g = await vpaProspectWelcomeRow(request, env, json); if (g.res) return g.res;
  if (!(await vpaResendCancel(env, g.row.resend_id))) return json({ error: 'Resend would not cancel it, so it may still go. Try again in a minute.' }, 502);
  await vpaProspectWelcomeMark(env, g.row, { status: 'cancelled', changed_at: new Date().toISOString(), changed_by: g.actor.actorId || null, changed_label: g.actor.label || null });
  await vpaProspectRetireLink(env, g.row.signin_token_hash);
  await vpaAudit(env, g.actor, 'prospect_welcome_cancelled', 'venue:' + g.row.venue_id, { email: g.row.email, was_due: g.row.send_at });
  return json({ ok: true, status: 'cancelled' });
}
async function vpaProspectWelcomeNow(request, env, json) {
  const g = await vpaProspectWelcomeRow(request, env, json); if (g.res) return g.res;
  if (!(await vpaResendCancel(env, g.row.resend_id))) return json({ error: 'Resend would not take back the booked one, so nothing was sent twice. Try again in a minute.' }, 502);
  const render = Object.assign({}, g.row.detail || {});
  let token = null;
  if (render.authUserId && !render.mobileLogin) { try { token = await vpaMintSigninLink(env, render.authUserId, g.row.venue_id, Date.now()); } catch (_) { token = null; } }
  await vpaProspectRetireLink(env, g.row.signin_token_hash);
  const r = await vpaFireProspectWelcome(env, Object.assign({}, render, { signinToken: token, sendAtMs: null }));
  const at = new Date().toISOString();
  if (!r.ok) {
    await vpaProspectWelcomeMark(env, g.row, { status: 'failed', changed_at: at, changed_by: g.actor.actorId || null, changed_label: g.actor.label || null });
    return json({ error: 'The booked email was cancelled but the new one did not send. Use Resend welcome on the venue.' }, 502);
  }
  await vpaProspectWelcomeMark(env, g.row, { status: 'sent_now', send_at: at, resend_id: r.id || null,
    signin_token_hash: token ? await vpaSigninTokenHash(token) : null, changed_at: at, changed_by: g.actor.actorId || null, changed_label: g.actor.label || null });
  await vpaAudit(env, g.actor, 'prospect_welcome_sent_now', 'venue:' + g.row.venue_id, { email: g.row.email, was_due: g.row.send_at });
  return json({ ok: true, status: 'sent_now', send_at: at });
}

/* ===========================================================================
 * POST /account/card-link { venue_id }   (the venue's owner or manager)
 *
 * The first-run setup's last step, "Add your card when you're ready" (Dean, 28 Oct 2026). The card
 * link used to ride in the prospect's email; it now comes from here, for THIS venue's account record
 * only, and only while that record has no card. HQ View as is refused: a card is the venue's to add.
 * -> { ok, has_card, card_url?, rate, seats, monthly }
 * ======================================================================== */
async function vpbCardLink(request, env, json) {
  const o = await vpbRequireOwner(request, env);
  if (o.error) return json({ error: o.error }, o.status);
  if (o.actingAsAdmin) return json({ error: 'A card is the venue\'s to add. HQ View as cannot add one.' }, 403);
  const _b = await vpaBody(request, json);
  if (!_b.ok) return _b.res;
  const venueId = String((_b.body && _b.body.venue_id) || '').trim();
  const venue = (o.venues || []).find((v) => v.id === venueId);
  if (!venue) return json({ error: 'Pick one of your venues.' }, 400);
  const vr = await vpaSelect(env, 'vp_venues', 'id=eq.' + encodeURIComponent(venueId) + '&select=founding_id,max_players&limit=1');
  const fid = vr && vr[0] && vr[0].founding_id;
  if (!fid) return json({ error: 'This venue has no account record yet. Reply to Dean\'s email and he will sort it.' }, 409);
  const fr = await vpaSelect(env, 'venueplay_founding', 'id=eq.' + encodeURIComponent(fid) + '&select=id,max_seats,stripe_subscription_id&limit=1');
  const f = fr && fr[0];
  if (!f) return json({ error: 'This venue has no account record yet. Reply to Dean\'s email and he will sort it.' }, 409);
  const prow = await vpaProspectRowFor(env, 'venue_id', venueId);
  const rate = vpaProspectPrice(env, prow).rate;   // a prospect keeps the offer they were set up on until a pause
  const seats = parseInt(f.max_seats, 10) || parseInt(vr[0].max_players, 10) || VPA_PROSPECT_DEFAULT_PLAYERS;
  const out = { ok: true, has_card: !!f.stripe_subscription_id, rate: rate, seats: seats, monthly: Math.round(seats * rate * 100) / 100 };
  if (prow && prow.free_month_ends_at) { out.free_month_ends_at = prow.free_month_ends_at; out.ends_words = vpaBneDateWords(Date.parse(prow.free_month_ends_at)); }
  if (prow && prow.paused_at) out.paused = true;
  if (!out.has_card) {
    out.card_url = await vpaCardLink(env, fid);
    if (!out.card_url) return json({ error: 'The card link could not be made just now. Try again in a minute.' }, 503);
  }
  return json(out);
}

/* ===========================================================================
 * GET /admin/venue-compliance?venue_id=   (owner | accounts)
 *   -> { ok, venue:{id,name,au_state,entity_type,paid_entry_enabled,venue_kind,
 *                   compliance_accepted_at,compliance_accepted_by},
 *        suggested_entity_type, permits, recorded:{bingo,raffle,members},
 *        declarations:[ the last three vp_gaming_declarations ] }
 *
 * What HQ shows on a venue's card so a person can do the manual check the lawyer called
 * prudent (Anisimoff, 1 Oct 2026, point 5): what the venue said it is, whether and when it
 * accepted the compliance line, which permits it has recorded, and the last three nights it
 * declared itself the conductor of a paid game. vp_gaming_declarations has no policies
 * (migration 44: service key only), which is why this is a Worker route and not a select
 * from the page. Read-only.
 * ======================================================================== */
/* ===========================================================================
 * POST /admin/permit-register-check   (owner | accounts)
 *   body { venue_id, kind: 'bingo'|'raffle'|'members' }
 *   -> { ok, check: { kind, at, by, number } }
 *
 * A person at HQ looked the venue's recorded Victorian permit up on the VGCCC's register and it
 * checked out. Anisimoff, 8 Oct 2026, point 1(a) and point 4: "prudent to verify VIC permit numbers
 * before providing the platform", the warranty and indemnity suffice where that is impractical.
 * Legal compliance matrix gap 8, 28 Oct 2026. NO AUTOMATION: nothing here looks anything up.
 *
 * The record is the audit row, on purpose. vp_venues is writable by a venue's own owner and
 * managers (vp_venues_manager_update), so a "checked by VenuePlay" flag on the venue row could be
 * written by the venue itself. vp_admin_audit cannot. The number checked goes in the row, so a
 * permit changed afterwards reads as NOT checked (vpaRegisterChecks). Victoria only, and only a
 * permit that counts as recorded: there is nothing to check otherwise.
 * ======================================================================== */
async function vpaHandlePermitRegisterCheck(request, env, json) {
  const actor = await vpaRequireAdmin(request, env, ['owner', 'accounts']);
  if (actor.error) return json({ error: actor.error }, actor.status);
  const _b = await vpaBody(request, json);
  if (!_b.ok) return _b.res;
  const b = _b.body;
  const venueId = String(b.venue_id || '').trim();
  if (!venueId) return json({ error: 'venue_id is required.' }, 400);
  const kind = String(b.kind || '').trim();
  if (VPA_PERMIT_KINDS.indexOf(kind) === -1) return json({ error: "kind must be 'bingo', 'raffle' or 'members'." }, 400);
  const v = (await vpaSelect(env, 'vp_venues', 'id=eq.' + encodeURIComponent(venueId) + '&select=id,name,au_state,permits') || [])[0];
  if (!v) return json({ error: 'No such venue.' }, 404);
  if (String(v.au_state || '').toUpperCase() !== 'VIC') return json({ error: 'Only a Victorian permit is checked against the VGCCC register.' }, 409);
  const permits = (v.permits && typeof v.permits === 'object' && !Array.isArray(v.permits)) ? v.permits : {};
  if (!vpaPermitRecorded(permits, kind)) return json({ error: 'No ' + (kind === 'members' ? 'members draw' : kind) + ' permit is recorded for this venue, so there is nothing to check.' }, 409);
  const p = permits[kind];
  const detail = { kind: kind, register: 'VGCCC', number: String(p.number || ''), holder: p.holder || 'venue', npo_name: String(p.npo_name || '') };
  const row = await vpaInsert(env, 'vp_admin_audit', { actor_admin: actor.actorId || null, actor_label: actor.label || 'admin',
    action: 'permit_register_checked', target: 'venue:' + venueId, detail: detail });
  return json({ ok: true, check: { kind: kind, at: (row && row.created_at) || new Date().toISOString(), by: actor.label || 'admin', number: detail.number, current: true } });
}
/* The newest register check per kind, and whether it is still the permit on record. A check of
   number A says nothing about number B, so a changed number, holder or charity reads current:false. */
async function vpaRegisterChecks(env, venueId, permits) {
  const rows = await vpaSelect(env, 'vp_admin_audit', 'target=eq.' + encodeURIComponent('venue:' + venueId)
    + '&action=eq.permit_register_checked&select=created_at,actor_label,detail&order=created_at.desc&limit=30') || [];
  const out = {};
  for (const r of rows) {
    const d = r.detail || {};
    if (VPA_PERMIT_KINDS.indexOf(d.kind) === -1 || out[d.kind]) continue;
    const p = (permits || {})[d.kind] || {};
    out[d.kind] = { at: r.created_at, by: r.actor_label || 'admin', number: d.number || '',
                    current: vpaPermitRecorded(permits, d.kind) && String(p.number || '') === String(d.number || '')
                             && (p.holder || 'venue') === (d.holder || 'venue') && String(p.npo_name || '') === String(d.npo_name || '') };
  }
  return out;
}

async function vpaHandleVenueCompliance(request, env, json) {
  const actor = await vpaRequireAdmin(request, env, ['owner', 'accounts']);
  if (actor.error) return json({ error: actor.error }, actor.status);
  const venueId = vpaQueryParam(request, 'venue_id').trim();
  if (!venueId) return json({ error: 'venue_id is required.' }, 400);

  const vs = await vpaSelect(env, 'vp_venues', 'id=eq.' + encodeURIComponent(venueId)
    + '&select=id,name,au_state,entity_type,paid_entry_enabled,venue_kind,permits,compliance_accepted_at,compliance_accepted_by');
  const v = vs && vs[0];
  if (!v) return json({ error: 'No such venue.' }, 404);

  /* Three, newest first. An order AND a limit: the table grows by one row per paid night per
     venue for ever, and "the last three" without an order is three arbitrary rows. */
  const declarations = await vpaSelect(env, 'vp_gaming_declarations',
    'venue_id=eq.' + encodeURIComponent(venueId)
    + '&select=id,format,entity_type,state,paid_entry,expected_sales_cents,total_prize_cents,category_claimed,declared_at'
    + '&order=declared_at.desc&limit=3') || [];

  const permits = (v.permits && typeof v.permits === 'object' && !Array.isArray(v.permits)) ? v.permits : {};
  const recorded = {};
  VPA_PERMIT_KINDS.forEach((k) => { recorded[k] = vpaPermitRecorded(permits, k); });
  return json({
    ok: true,
    venue: { id: v.id, name: v.name, au_state: v.au_state || null, entity_type: v.entity_type || null,
             paid_entry_enabled: v.paid_entry_enabled === true, venue_kind: v.venue_kind || null,
             compliance_accepted_at: v.compliance_accepted_at || null, compliance_accepted_by: v.compliance_accepted_by || null },
    suggested_entity_type: vpaEntitySuggestion(v.venue_kind),
    permits: permits,
    recorded: recorded,
    declarations: declarations,
    // Victoria only: who checked each recorded permit against the VGCCC register, and when.
    register_checks: String(v.au_state || '').toUpperCase() === 'VIC' ? await vpaRegisterChecks(env, venueId, permits) : {},
  });
}



/* ===========================================================================
 * POST /admin/resend-welcome   (owner | accounts)
 *   body: { venue_id }
 *   -> { ok:true, sent:bool, card_url, comp:bool, has_card:bool }
 *
 * A venue onboarded from HQ that never added a card has, until now, been
 * unreachable: the welcome email carrying the card link fires exactly once, at
 * creation, and there was no way to send another. check-data.py finds these
 * (active account, no Stripe subscription, holding a place and never billed) and
 * the only fix on offer was to delete the venue and build it again.
 *
 * Returns the card link as well as sending it, because half the time the useful
 * thing is to paste it into a text message to the publican rather than trust an
 * email they have already ignored once.
 * ======================================================================== */
async function vpaResendWelcome(request, env, json) {
  const actor = await vpaRequireAdmin(request, env, ['owner', 'accounts']);
  if (actor.error) return json({ error: actor.error }, actor.status);

  const _b = await vpaBody(request, json);
  if (!_b.ok) return _b.res;
  const b = _b.body;
  const venueId = (b.venue_id || '').trim();
  if (!venueId) return json({ error: 'Which venue?' }, 400);

  const vs = await vpaSelect(env, 'vp_venues',
    'id=eq.' + encodeURIComponent(venueId) + '&select=id,name,slug,postcode,founding_id,group_id,entity_type,venue_kind&limit=1');
  const venue = vs && vs[0];
  if (!venue) return json({ error: 'That venue no longer exists.' }, 404);
  // The HQ number bingo switch, read on its own so a database before migration 116 still resends.
  let resendBingoOn = false;
  try { const nb = await vpaSelect(env, 'vp_venues', 'id=eq.' + encodeURIComponent(venueId) + '&select=number_bingo_on&limit=1'); resendBingoOn = !!(nb && nb[0] && nb[0].number_bingo_on === true); } catch (e) {}
  if (!venue.founding_id) {
    return json({ error: 'This venue bills through an operator group, so there is no card for it to add. The group is invoiced by hand.' }, 400);
  }

  const fs = await vpaSelect(env, 'venueplay_founding',
    'id=eq.' + encodeURIComponent(venue.founding_id) +
    '&select=id,contact_email,max_seats,plan,status,stripe_subscription_id&limit=1');
  const f = fs && fs[0];
  if (!f) return json({ error: 'No billing account behind that venue.' }, 404);
  if (!f.contact_email) return json({ error: 'That account has no contact email, so there is nowhere to send it. Add one first.' }, 400);

  const comp = f.status === 'comp';
  const hasCard = !!f.stripe_subscription_id;
  // Sending "add your card" to somebody already paying is the kind of email that gets you a
  // worried phone call. Say so rather than sending it.
  if (hasCard && !comp) {
    return json({ error: (venue.name || 'That venue') + ' already has a card on file, so there is nothing to chase. Their billing page is where changes belong.' }, 400);
  }

  const sent = await vpaFireHqWelcome(env, {
    foundingId: f.id,
    email: f.contact_email,
    venueName: venue.name,
    slug: venue.slug,
    seats: f.max_seats,
    plan: f.plan,
    postcode: venue.postcode || '',
    venueKind: venue.venue_kind || null,
    entityType: venue.entity_type || null,
    numberBingoOn: resendBingoOn,
    comp: comp,
  });

  const cardUrl = comp ? '' : await vpaCardLink(env, f.id);
  await vpaAudit(env, actor, 'welcome_resent', 'venue:' + venue.id, {
    name: venue.name, to: f.contact_email, comp: comp, sent: sent,
  });
  return json({ ok: true, sent: sent, comp: comp, has_card: hasCard, card_url: cardUrl,
                to: f.contact_email });
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

  const _b = await vpaBody(request, json);
  if (!_b.ok) return _b.res;
  const b = _b.body;
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
      /* THIS WAS A DEAD END. The console has a confirm-and-apply path built for
         exactly this case: it looks for needs_confirm, asks "apply across the
         whole account?", and re-sends with apply_to_account. This Worker never
         sent needs_confirm and never read apply_to_account, so a percentage on
         any venue in a group could not be applied at all, by any route. The
         warning was correct and the way past it was missing.

         So: send the flag the console is waiting for, and honour the answer. The
         refusal still happens first, every time, because a 20% meant for one
         venue coming off the whole account is exactly the mistake worth stopping.
         It is now a question rather than a wall. */
      return json({
        error: 'This account has ' + sibs.length + ' venues on one subscription, so a ' +
               'percentage comes off ALL of them, not just this venue. Use a dollar credit ' +
               'for a single venue, or confirm to apply it across the account.',
        needs_confirm: true,
        venue_count: sibs.length
      }, 409);
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
        /* KEYED. Two racing requests, or a client retry, each created their OWN coupon and
           each attached it in turn. The subscription holds one discount slot, so the second
           attach replaces the first and the venue's bill is right, which is exactly why this
           never surfaced: what is left behind is an ORPHANED coupon in Stripe and, if both
           requests get that far, two discount rows in HQ for one discount. The 'already has a
           discount' guard above cannot catch it either, because both requests read the
           subscription BEFORE either has attached anything.
           The key is what the discount IS, plus the day, so a genuine second identical
           discount granted next month still goes through. */
        const coupDay = new Date().toISOString().slice(0, 10);
        const coupon = await vpbStripePost(env, 'coupons', Object.assign({
          percent_off: value,
          duration: months ? 'repeating' : 'forever',
          name: 'VenuePlay: ' + (target.name || 'venue') + ' ' + value + '% off',
        }, months ? { duration_in_months: months } : {}),
        'coup:' + targetType + ':' + targetId + ':' + value + ':' + (months || 0) + ':' + coupDay);
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
        /* KEYED, because the percent branch above is guarded and this one was not.

           That branch refuses outright when a discount already sits on the
           subscription. The dollar branch had neither a guard nor an
           idempotency key, so two HQ tabs, or an operator pressing Apply again
           after a slow response, banked the credit twice and wrote two
           vp_discounts rows. Removing it only reverses one, and the reversal is
           capped at the outstanding balance, so once an invoice has eaten the
           first credit the second cannot be recovered from HQ at all.

           Scoped to the day on purpose. Stripe's own idempotency window is 24
           hours, so this matches it: the same dollar amount to the same
           customer twice today is the double-click we are stopping, while the
           same amount next week is a deliberate second discount and goes
           through. */
        const discDay = new Date().toISOString().slice(0, 10);
        const txn = await vpbStripePost(env, 'customers/' + encodeURIComponent(target.customer) + '/balance_transactions', {
          amount: -cents, currency: 'aud',
          description: 'VenuePlay discount' + (note ? ': ' + note : ''),
        }, 'disc:' + target.customer + ':' + cents + ':' + discDay);
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
      /* KEYED ON THE CREDIT IT IS UNDOING. The credit above is keyed, so a retried request
         does NOT create a second credit: Stripe hands back the first one. But this rollback
         had no key, so the retry would reverse the SAME single credit a second time, and
         each reversal is a POSITIVE balance, which Stripe reads as money owed. Two
         reversals of one $200 credit leaves the venue $200 in the hole on their next
         invoice, for a discount they were promised. One reversal per credit, ever. */
      await vpbStripePost(env, 'customers/' + encodeURIComponent(target.customer) + '/balance_transactions',
        { amount: back, currency: 'aud', description: 'VenuePlay discount reversed (could not be recorded)' },
        'discrb:' + stripeTxnId).catch(() => {});
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

  const _b = await vpaBody(request, json);
  if (!_b.ok) return _b.res;
  const b = _b.body;
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
          /* KEYED ON THE ROW'S OWN CREDIT. The clamp above ("only take back what is still
             sitting there") protects a SECOND removal made later, because by then the
             balance has moved. It does nothing about two happening at once: an owner and an
             HQ admin on View as, or one impatient double click, both read the same balance
             before either has posted, both compute the full amount, and both post it. The
             venue is billed twice for one reversal. A key on the credit being reversed makes
             the second one a no-op that returns the first one's result.
             A different prefix from the rollback above on purpose: the two can never run for
             the same credit (a rolled-back discount was never recorded, so there is no row to
             remove), and sharing a key with different amounts would make Stripe refuse a
             legitimate reversal outright. */
          const back = await vpbStripePost(env, 'customers/' + encodeURIComponent(target.customer) + '/balance_transactions', {
            amount: cents, currency: 'aud', description: 'VenuePlay discount reversed',
          }, 'discrev:' + row.stripe_txn_id);
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

  /* PAGED, and ordered by name AND id. vpaSelect reads ONE page and PostgREST stops at
     1000 rows in silence, so past a thousand venues a quiet venue simply would not appear
     on the call list: the exact venue somebody needs to ring, invisible, with no error.
     name.asc alone is not a stable order either. Seven percent of venue names are shared
     and there are a hundred Royal Hotels, so ties can repeat one row and skip another
     across a page boundary. */
  const venues = await vpaSelectAll(env, 'vp_venues',
    'select=id,name,slug,status,suspended_reason,created_at&order=name.asc,id.asc');
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
      // When this quiet spell began (their last night, or set-up if none). HQ counts a
      // "Contacted" mark only if it was made after this, so a venue that played again and then
      // went quiet again is a new name on the chase list (Dean, 19 Oct 2026).
      quiet_since: new Date(since).toISOString(),
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

/* ONE MORE NIGHT, ONCE (migration 110, Dean 20 Oct 2026: "it would be shit to not be able to fix
   something to let a venue play a night on a night").

   Trivia and musical bingo run once a week per venue. 107's switch lifts that for good; this lets
   a venue run ONE more night inside the next 24 hours and then it is gone on its own. The game
   Worker enforces it (checkWeeklyFormatLimit / stampWeeklyFormat) and marks it used; this only
   grants and cancels. Owner and accounts HQ admins only, the same people as the 107 switch.

   Body { venue_id, action: 'grant' | 'cancel', format: 'trivia' | 'musical_bingo' | 'either' }.
   A grant replaces any earlier pass (a fresh 24 hours, nothing used). Every grant and cancel is an
   audit row (venue_night_pass_granted / _cancelled) with who, and the game Worker writes
   venue_night_pass_used when a night spends it. */
const VPA_NIGHT_PASS_HOURS = 24;
const VPA_NIGHT_PASS_FORMATS = ['trivia', 'musical_bingo', 'either'];
const VPA_NIGHT_PASS_SELECT = 'id,name,night_pass_format,night_pass_until,night_pass_granted_at,night_pass_granted_by,' +
  'night_pass_used_at,night_pass_used_format,night_pass_used_session';
async function vpaHandleNightPass(request, env, json) {
  const actor = await vpaRequireAdmin(request, env, ['owner', 'accounts']);
  if (actor.error) return json({ error: actor.error }, actor.status);
  const _b = await vpaBody(request, json);
  if (!_b.ok) return _b.res;
  const b = _b.body;
  const venueId = b.venue_id;
  if (!venueId) return json({ error: 'venue_id is required.' }, 400);
  const action = b.action;
  if (action !== 'grant' && action !== 'cancel') return json({ error: "action must be 'grant' or 'cancel'." }, 400);
  if (action === 'grant' && VPA_NIGHT_PASS_FORMATS.indexOf(b.format) === -1) {
    return json({ error: 'format must be one of ' + VPA_NIGHT_PASS_FORMATS.join(', ') + '.' }, 400);
  }
  // Read on its own and fail-safe: before migration 110 the pass columns are refused.
  const res0 = await fetch(env.SUPABASE_URL + '/rest/v1/vp_venues?id=eq.' + encodeURIComponent(venueId) + '&select=' + VPA_NIGHT_PASS_SELECT, {
    method: 'GET', headers: vpaHeaders(env),
  });
  if (!res0.ok) {
    const t0 = (await res0.text()).slice(0, 180);
    if (/night_pass/.test(t0)) return json({ error: 'Run migration 110 first: the one-night pass is not in the database yet. Nothing was changed.' }, 409);
    return json({ error: 'Could not read that venue. ' + t0 }, 500);
  }
  const prior = (await res0.json())[0];
  if (!prior) return json({ error: 'That venue no longer exists.' }, 404);

  const now = new Date();
  let patch;
  if (action === 'grant') {
    patch = {
      night_pass_format: b.format,
      night_pass_until: new Date(now.getTime() + VPA_NIGHT_PASS_HOURS * 3600 * 1000).toISOString(),
      night_pass_granted_at: now.toISOString(),
      night_pass_granted_by: actor.label || 'admin',
      night_pass_used_at: null, night_pass_used_format: null, night_pass_used_session: null,
    };
  } else {
    // Cancel a pass that is still waiting. One already used is history and stays as it is.
    if (!prior.night_pass_until || prior.night_pass_used_at || !(Date.parse(prior.night_pass_until) > now.getTime())) {
      return json({ error: 'There is no waiting pass to cancel.' }, 409);
    }
    patch = { night_pass_until: now.toISOString() };
  }
  const res = await fetch(env.SUPABASE_URL + '/rest/v1/vp_venues?id=eq.' + encodeURIComponent(venueId), {
    method: 'PATCH',
    headers: { ...vpaHeaders(env), 'Prefer': 'return=representation' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const t = (await res.text()).slice(0, 180);
    if (/night_pass/.test(t)) return json({ error: 'Run migration 110 first: the one-night pass is not in the database yet. Nothing was changed.' }, 409);
    return json({ error: 'Could not save. ' + t }, 500);
  }
  await vpaInsert(env, 'vp_admin_audit', {
    actor_admin: actor.actorId || null, actor_label: actor.label || 'admin',
    action: action === 'grant' ? 'venue_night_pass_granted' : 'venue_night_pass_cancelled',
    target: 'venue:' + venueId,
    detail: action === 'grant'
      ? { name: prior.name, format: b.format, hours: VPA_NIGHT_PASS_HOURS, until: patch.night_pass_until }
      : { name: prior.name, format: prior.night_pass_format, was_until: prior.night_pass_until },
  }, false).catch(function () {});
  const pass = {};
  VPA_NIGHT_PASS_SELECT.split(',').forEach(function (k) { if (k.indexOf('night_pass_') === 0) pass[k] = (k in patch) ? patch[k] : prior[k]; });
  return json({ ok: true, pass: pass });
}

async function vpaHandleVenueGaming(request, env, json) {
  const actor = await vpaRequireAdmin(request, env, ['owner', 'accounts']);
  if (actor.error) return json({ error: actor.error }, actor.status);

  const _b = await vpaBody(request, json);
  if (!_b.ok) return _b.res;
  const b = _b.body;
  const venueId = b.venue_id;
  if (!venueId) return json({ error: 'venue_id is required.' }, 400);

  const rows = await vpaSelect(env, 'vp_venues',
    'id=eq.' + encodeURIComponent(venueId) + '&select=id,name,entity_type,paid_entry_enabled,au_state,postcode,venue_kind');
  const prior = rows && rows[0];
  if (!prior) return json({ error: 'That venue no longer exists.' }, 404);

  const patch = {};
  /* What the venue said it is, correctable from HQ when the onboarding call got it wrong. It
     only ever SUGGESTS entity_type on the HQ card; entity_type itself is still the dropdown
     below, set by a person. */
  if (b.venue_kind !== undefined) {
    if (b.venue_kind !== null && VPA_VENUE_KINDS.indexOf(b.venue_kind) === -1) {
      return json({ error: 'venue_kind must be one of ' + VPA_VENUE_KINDS.join(', ') + ', or null.' }, 400);
    }
    patch.venue_kind = b.venue_kind || null;
  }
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
    /* Moving a venue into a state where we cannot run paid games has to switch paid entry off,
       or a NSW club relocated to Queensland keeps a capability its new state does not allow. */
    const entAfter = (b.entity_type !== undefined) ? b.entity_type : prior.entity_type;
    /* CLEARING the postcode takes paid entry with it too (legal compliance matrix G19, 28 Oct 2026).
       This used to need a NEW state to act, so a postcode cleared to blank left a venue with no state
       and paid entry ON, where no state's rules can be shown: two venues were found that way. */
    if (!vpaPaidEntryDefault(entAfter, patch.au_state) && prior.paid_entry_enabled) {
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
        ? ('We do not unlock paid games in ' + st + ' yet. Queensland is waiting on OLGR approval of our generator.')
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
  /* UNLIMITED TRIVIA AND MUSICAL BINGO NIGHTS (migration 107, Dean 19 Oct 2026, for Deepwater
     Hotel). The game Worker skips its once-a-week check for a venue with this set. HQ only: this
     route is owner/accounts admins, and a trigger in 107 puts the old value back when a venue's
     own login tries to write it. A real true or false only, so a stray string cannot switch it on.
     Its own audit row, so "who gave this venue unlimited nights, and when" is one search. */
  let weeklyBefore;
  if (b.weekly_limit_off !== undefined) {
    if (b.weekly_limit_off !== true && b.weekly_limit_off !== false) {
      return json({ error: 'weekly_limit_off must be true or false.' }, 400);
    }
    patch.weekly_limit_off = b.weekly_limit_off;
    // Read on its own: naming the column in the select above would 404 every gaming edit
    // until migration 107 is run.
    const wl = await vpaSelect(env, 'vp_venues', 'id=eq.' + encodeURIComponent(venueId) + '&select=id,weekly_limit_off');
    weeklyBefore = (wl && wl[0] && wl[0].weekly_limit_off === true);
  }
  /* THE PURCHASE RAFFLE SWITCH (migration 115, Dean 22 Oct 2026, for Deepwater Hotel). Off for
     every venue until HQ turns it on here. Same shape as the unlimited nights switch: a real true
     or false only, its own audit row, and a trigger in 115 that puts the old value back when a
     venue's own login tries to write it. */
  let praffleBefore;
  if (b.purchase_raffle_on !== undefined) {
    if (b.purchase_raffle_on !== true && b.purchase_raffle_on !== false) {
      return json({ error: 'purchase_raffle_on must be true or false.' }, 400);
    }
    patch.purchase_raffle_on = b.purchase_raffle_on;
    const pr = await vpaSelect(env, 'vp_venues', 'id=eq.' + encodeURIComponent(venueId) + '&select=id,purchase_raffle_on');
    praffleBefore = (pr && pr[0] && pr[0].purchase_raffle_on === true);
  }
  /* NUMBER BINGO FOR AN SA OR NT PUB (migration 116, Dean 22 Oct 2026). Hidden for those venues
     by law; this shows it again for ONE venue whose bingo is run by a not-for-profit, once HQ has
     seen that. HQ only (owner and accounts admins: this route), a trigger in 116 keeps a venue
     login off it, a real true or false only, and its own audit row. */
  let bingoBefore;
  if (b.number_bingo_on !== undefined) {
    if (b.number_bingo_on !== true && b.number_bingo_on !== false) {
      return json({ error: 'number_bingo_on must be true or false.' }, 400);
    }
    patch.number_bingo_on = b.number_bingo_on;
    const nb = await vpaSelect(env, 'vp_venues', 'id=eq.' + encodeURIComponent(venueId) + '&select=id,number_bingo_on');
    bingoBefore = (nb && nb[0] && nb[0].number_bingo_on === true);
  }
  /* "SHOW LOGO ON OUR WEBSITE" (migration 111, Dean 20 Oct 2026: "I dont want a venue to be able
     to put it on our website we should choose"). HQ picks which venues appear in the Trusted by
     strip; the venue's own tick on Your account is gone and its old route answers 410. Same door
     as unlimited nights: owner and accounts admins only (vpaRequireAdmin above), a real true or
     false only, its own audit row, and a trigger in 111 puts the old value back when a venue's own
     login writes vp_venues directly. */
  let logoBefore;
  if (b.show_logo_on_site !== undefined) {
    if (b.show_logo_on_site !== true && b.show_logo_on_site !== false) {
      return json({ error: 'show_logo_on_site must be true or false.' }, 400);
    }
    patch.show_logo_on_site = b.show_logo_on_site;
    const ls = await vpaSelect(env, 'vp_venues', 'id=eq.' + encodeURIComponent(venueId) + '&select=id,show_logo_on_site');
    logoBefore = (ls && ls[0] && ls[0].show_logo_on_site === true);
  }
  if (!Object.keys(patch).length) return json({ error: 'Nothing to change.' }, 400);

  const res = await fetch(env.SUPABASE_URL + '/rest/v1/vp_venues?id=eq.' + encodeURIComponent(venueId), {
    method: 'PATCH',
    headers: { ...vpaHeaders(env), 'Prefer': 'return=representation' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const t = (await res.text()).slice(0, 180);
    if (patch.weekly_limit_off !== undefined && /weekly_limit_off/.test(t)) {
      return json({ error: 'Run migration 107 first: the unlimited nights switch is not in the database yet. Nothing was changed.' }, 409);
    }
    if (patch.purchase_raffle_on !== undefined && /purchase_raffle_on/.test(t)) {
      return json({ error: 'Run migration 115 first: the purchase raffle switch is not in the database yet. Nothing was changed.' }, 409);
    }
    if (patch.number_bingo_on !== undefined && /number_bingo_on/.test(t)) {
      return json({ error: 'Run migration 116 first: the number bingo switch is not in the database yet. Nothing was changed.' }, 409);
    }
    return json({ error: 'Could not save. ' + t }, 500);
  }
  const saved = (await res.json())[0] || {};

  const gamingKeys = Object.keys(patch).filter(function (k) { return k !== 'weekly_limit_off' && k !== 'purchase_raffle_on' && k !== 'number_bingo_on' && k !== 'show_logo_on_site'; });
  if (gamingKeys.length) {
    const gp = {};
    gamingKeys.forEach(function (k) { gp[k] = patch[k]; });
    await vpaInsert(env, 'vp_admin_audit', {
      actor_admin: actor.actorId || null, actor_label: actor.label || 'admin',
      action: 'venue_gaming_updated', target: 'venue:' + venueId,
      detail: { name: prior.name, from: { entity_type: prior.entity_type, paid_entry_enabled: prior.paid_entry_enabled }, to: gp },
    }, false).catch(function () {});
  }
  if (patch.weekly_limit_off !== undefined) {
    await vpaInsert(env, 'vp_admin_audit', {
      actor_admin: actor.actorId || null, actor_label: actor.label || 'admin',
      action: patch.weekly_limit_off ? 'venue_unlimited_nights_on' : 'venue_unlimited_nights_off',
      target: 'venue:' + venueId,
      detail: { name: prior.name, from: weeklyBefore, to: patch.weekly_limit_off },
    }, false).catch(function () {});
  }
  if (patch.purchase_raffle_on !== undefined) {
    await vpaInsert(env, 'vp_admin_audit', {
      actor_admin: actor.actorId || null, actor_label: actor.label || 'admin',
      action: patch.purchase_raffle_on ? 'venue_purchase_raffle_on' : 'venue_purchase_raffle_off',
      target: 'venue:' + venueId,
      detail: { name: prior.name, from: praffleBefore, to: patch.purchase_raffle_on },
    }, false).catch(function () {});
  }

  if (patch.number_bingo_on !== undefined) {
    await vpaInsert(env, 'vp_admin_audit', {
      actor_admin: actor.actorId || null, actor_label: actor.label || 'admin',
      action: patch.number_bingo_on ? 'venue_number_bingo_on' : 'venue_number_bingo_off',
      target: 'venue:' + venueId,
      detail: { name: prior.name, state: prior.au_state || null, entity_type: prior.entity_type || null,
                from: bingoBefore, to: patch.number_bingo_on },
    }, false).catch(function () {});
  }
  if (patch.show_logo_on_site !== undefined) {
    await vpaInsert(env, 'vp_admin_audit', {
      actor_admin: actor.actorId || null, actor_label: actor.label || 'admin',
      action: patch.show_logo_on_site ? 'venue_logo_on_site_on' : 'venue_logo_on_site_off',
      target: 'venue:' + venueId,
      detail: { name: prior.name, from: logoBefore, to: patch.show_logo_on_site },
    }, false).catch(function () {});
  }

  return json({ ok: true, venue: saved });
}


/* ------------------------- POST /admin/venue-history -------------------------
   ONE venue, everything it has actually done, and whether it is still paying.

   HQ could already say "Wellshot Hotel, quiet 9 days". It could not say what
   they tried, and it could not say whether their card is still good. Those two
   look identical from the outside and they need completely different phone
   calls, which is the whole reason this exists.

   Read-only. It writes nothing and changes nothing. */
async function vpaHandleVenueHistory(request, env, json) {
  const actor = await vpaRequireAdmin(request, env, ['owner', 'accounts']);
  if (actor.error) return json({ error: actor.error }, actor.status);

  const b = await request.json().catch(() => ({}));
  const venueId = (b.venue_id || '').trim();
  if (!venueId) return json({ error: 'venue_id is required.' }, 400);
  const vid = encodeURIComponent(venueId);

  const vrows = await vpaSelect(env, 'vp_venues',
    'id=eq.' + vid + '&select=id,name,slug,status,suspended_reason,cancel_at_period_end,' +
    'founding_id,group_id,max_players,created_at,au_state,postcode');
  const venue = vrows && vrows[0];
  if (!venue) return json({ error: 'That venue no longer exists.' }, 404);

  /* Bounded, for the same reason vpaHandleQuietVenues is bounded: this is a
     retention screen, not an archive. The most recent 60 nights answers every
     question anybody opens this panel to ask. */
  const sessions = await vpaSelect(env, 'vp_sessions',
    'venue_id=eq.' + vid + '&select=id,join_code,status,opened_at,started_at,ended_at,created_at' +
    '&order=created_at.desc&limit=60') || [];

  /* What was actually PLAYED in each of those nights. A session on its own only
     says somebody opened the console; the game rows say whether a trivia round
     or a musical set ever started, which is exactly the difference between
     "they tried and it did not land" and "they never got going". */
  let games = [];
  if (sessions.length) {
    // Same shape the rest of this Worker uses for an in() list: encode each id,
    // join with raw commas. Encoding the whole joined string turns the commas
    // into %2C, which works but is a second pattern for no reason.
    const ids = sessions.map(function (x) { return encodeURIComponent(x.id); }).join(',');
    games = await vpaSelect(env, 'vp_games',
      'session_id=in.(' + ids + ')' +
      // started_at, NOT created_at: vp_games has no created_at, so this select was
      // rejected and vpaSelect turned the error into []. Every night in the
      // retention panel read "games: 0, formats: [], abandoned: true". Same shape
      // as the 19 Aug empty-HQ incident: correct-looking code, a database that
      // quietly disagrees, an error flattened into an empty list.
      '&select=id,session_id,seq,format,status,ended_at,started_at&order=seq.asc') || [];
  }

  /* How many people were in the room. Counted, not stored: there is no player
     total on a session row. */
  let players = [];
  if (sessions.length) {
    const pids = sessions.map(function (x) { return encodeURIComponent(x.id); }).join(',');
    players = await vpaSelect(env, 'vp_players',
      'session_id=in.(' + pids + ')&select=id,session_id') || [];
  }
  const headcount = {};
  for (const p of players) { headcount[p.session_id] = (headcount[p.session_id] || 0) + 1; }

  const byId = {};
  for (const g of games) { (byId[g.session_id] = byId[g.session_id] || []).push(g); }

  const nights = sessions.map(function (s) {
    const gs = byId[s.id] || [];
    return {
      kind: 'session',
      at: s.started_at || s.opened_at || s.created_at,
      ended_at: s.ended_at || null,
      status: s.status,
      join_code: s.join_code,
      players: headcount[s.id] || 0,
      formats: gs.map(function (g) { return g.format; }).filter(Boolean),
      games: gs.length,
      /* The tell-tale we are looking for. A session opened, nobody joined, no
         game ever started: that is a venue that tried and gave up, and it is
         invisible on every other screen we have. */
      abandoned: gs.length === 0 && (headcount[s.id] || 0) === 0,
    };
  });

  /* Broadcast bingo opens no session at all, so it exists ONLY here. Leaving it
     out would make a bingo-only venue look like it had never run a night. */
  const reports = await vpaSelect(env, 'vp_game_reports',
    'venue_id=eq.' + vid + '&select=id,format,players,tickets,started_at,ended_at,created_at' +
    '&order=created_at.desc&limit=60') || [];
  for (const r of reportsOutsideSessions(sessions, reports)) {
    nights.push({
      kind: 'report',
      at: r.started_at || r.created_at,
      ended_at: r.ended_at || null,
      status: r.ended_at ? 'finished' : 'unfinished',
      players: r.players || 0,
      tickets: r.tickets || 0,
      formats: r.format ? [r.format] : [],
      games: 1,
      abandoned: false,
    });
  }
  nights.sort(function (a, c) { return Date.parse(c.at || 0) - Date.parse(a.at || 0); });

  /* ARE THEY STILL PAYING? HQ's billing panel has always said out loud that it
     cannot answer this, and pointed at a Worker feed that was never written.
     This is that feed, for one venue at a time. Stripe is the only source of
     truth here; our own row only records what we last asked for. */
  let subscription = { known: false, why: 'This venue has no founding record, so there is no subscription to look up.' };
  if (venue.founding_id) {
    try {
      const accts = await vpaSelect(env, 'venueplay_founding',
        'id=eq.' + encodeURIComponent(venue.founding_id) +
        '&select=id,stripe_subscription_id,plan,contact_email,status');
      const acct = accts && accts[0];
      if (!acct || !acct.stripe_subscription_id) {
        subscription = { known: false, why: 'No Stripe subscription is recorded against this account yet.' };
      } else {
        const info = await vpbSubItem(env, acct.stripe_subscription_id);
        const sub = info && info.sub;
        subscription = {
          known: !!sub,
          state: sub ? sub.status : null,                 // active, past_due, canceled, unpaid...
          cancel_at_period_end: sub ? !!sub.cancel_at_period_end : !!venue.cancel_at_period_end,
          period_end: (info && info.periodEnd) ? vpaFmtDate(info.periodEnd) : null,
          period_end_ts: (info && info.periodEnd) || null,
          card: (info && info.brand) ? (info.brand + ' ending ' + info.last4) : null,
          plan: acct.plan || null,
          contact_email: acct.contact_email || null,
        };
      }
    } catch (e) {
      // Never fail the whole panel because Stripe had a bad minute: the history
      // above is the half somebody opened this to read.
      subscription = { known: false, why: 'Could not reach Stripe just now: ' + String((e && e.message) || e).slice(0, 160) };
    }
  }

  const last = nights.length ? nights[0].at : null;
  return json({
    ok: true,
    venue: {
      id: venue.id, name: venue.name, slug: venue.slug, status: venue.status,
      suspended_reason: venue.suspended_reason || null,
      archived: venue.suspended_reason === 'archived' || venue.suspended_reason === 'archived_cancelling',
      cancelling: !!venue.cancel_at_period_end,
      max_players: venue.max_players, created_at: venue.created_at,
      au_state: venue.au_state || null,
    },
    last_activity: last,
    days_quiet: last ? Math.floor((Date.now() - Date.parse(last)) / 86400000) : null,
    nights: nights.slice(0, 60),
    subscription: subscription,
  });
}


/* ------------------------- POST /admin/auto-archive -------------------------
   Archive a venue 30 days after the owner told us they were leaving.

   The rule Dean asked for: they say leave, we give them a month, then the venue
   moves off the active lists by itself. Today that is a manual job somebody has
   to remember, and a forgotten one leaves a departed venue sitting on every
   screen with a discount form under it.

   WHY THIS TOUCHES NO MONEY. The trigger for auto-archiving IS the owner having
   cancelled, so cancel_at_period_end is already true and Stripe has already
   been told. vpaHandleVenueStatus only reaches Stripe to SET that flag for a
   venue we archived out of the blue; here there is nothing left to set. So this
   writes two columns and an audit line, and no invoice moves. That is deliberate:
   an automatic job that can move money is an automatic job that can bill somebody
   wrongly at 3am with nobody watching.

   The reason written is 'archived_cancelling', the same value the manual path
   uses when the OWNER cancelled first. That matters later: un-archiving reads it
   and refuses to silently restart billing the owner had stopped.

   FOUR THINGS MUST ALL BE TRUE, and any one of them failing means we leave it:
     1. the owner is cancelling (we never auto-archive a paying venue)
     2. their paid period ended, and 30+ days have passed since
     3. they have not played since (a venue that came back is not gone)
     4. it is not already archived or suspended

   Defaults to a DRY RUN. You have to ask for it to act. */
async function vpaHandleAutoArchive(request, env, json) {
  const actor = await vpaRequireAdmin(request, env, ['owner', 'accounts']);
  if (actor.error) return json({ error: actor.error }, actor.status);
  const b = await request.json().catch(() => ({}));
  // Absent means dry run. Only an explicit false actually archives anything.
  const dryRun = b.dry_run !== false;
  let days = parseInt(b.days, 10);
  if (!(days >= 1)) days = 30;
  return json(await vpaAutoArchiveSweep(env, actor, days, dryRun));
}

async function vpaAutoArchiveSweep(env, actor, days, dryRun) {
  const now = Date.now();
  const graceMs = days * 86400000;

  const venues = await vpaSelect(env, 'vp_venues',
    'status=eq.active&cancel_at_period_end=is.true' +
    '&select=id,name,slug,status,suspended_reason,founding_id,cancel_at_period_end') || [];
  if (!venues.length) {
    return { ok: true, days: days, dry_run: dryRun, checked: 0, archived: [], skipped: [],
             note: 'No active venue is currently set to cancel, so there is nothing to archive.' };
  }

  /* When did they last play? Same two sources as the Quiet tab, because a venue
     that ran a night after cancelling has changed its mind in the only way that
     counts, and must not be archived out from under itself. */
  const lookback = new Date(now - Math.max(graceMs, 90 * 86400000)).toISOString();
  const lastPlayed = {};
  const note = function (id, ts) {
    if (!id || !ts) return;
    const t = Date.parse(ts);
    if (isFinite(t) && (!lastPlayed[id] || t > lastPlayed[id])) lastPlayed[id] = t;
  };
  /* THESE TWO READS DECIDE WHETHER A VENUE GOES DARK, SO THEY MUST FAIL CLOSED.
     They used vpaSelect, which returns [] on ANY non-2xx. One 503 here and lastPlayed
     is empty, every cancelling venue reads as "never played again", and the sweep
     switches them all off at 3:30am with nobody watching. They were also UNPAGED
     against a 90-day window across every venue, so past 1000 rows the same thing
     happened without any error at all: the venues whose sessions fell outside the
     first page looked quiet.

     vpaSelectAll throws instead, and scheduled() already wraps this whole sweep in a
     try, so a failed read now means NOTHING is archived tonight. A venue archived by
     mistake is a dark room on a Friday; a sweep that skips a night costs nothing. */
  const sess = await vpaSelectAll(env, 'vp_sessions',
    'select=venue_id,opened_at,started_at,ended_at' +
    '&or=(started_at.gte.' + lookback + ',opened_at.gte.' + lookback + ',ended_at.gte.' + lookback + ')' +
    '&order=venue_id.asc,opened_at.asc,id.asc');
  for (const r of sess) note(r.venue_id, r.started_at || r.opened_at || r.ended_at);
  const reps = await vpaSelectAll(env, 'vp_game_reports',
    'select=venue_id,ended_at,created_at' +
    '&or=(ended_at.gte.' + lookback + ',created_at.gte.' + lookback + ')' +
    '&order=venue_id.asc,created_at.asc,id.asc');
  for (const r of reps) note(r.venue_id, r.ended_at || r.created_at);

  const archived = [];
  const skipped = [];
  for (const v of venues) {
    if (v.suspended_reason === 'archived' || v.suspended_reason === 'archived_cancelling') {
      skipped.push({ venue: v.name, why: 'already archived' }); continue;
    }
    if (!v.founding_id) {
      skipped.push({ venue: v.name, why: 'no founding record, so no period end to measure from' }); continue;
    }

    /* WHEN did their paid period end? Stripe, not us. If we cannot find out we
       do NOT archive: a missing date must never be read as an expired one. */
    let periodEnd = null, subState = null;
    try {
      const accts = await vpaSelect(env, 'venueplay_founding',
        'id=eq.' + encodeURIComponent(v.founding_id) + '&select=id,stripe_subscription_id');
      const acct = accts && accts[0];
      if (acct && acct.stripe_subscription_id) {
        const info = await vpbSubItem(env, acct.stripe_subscription_id);
        periodEnd = (info && info.periodEnd) ? (info.periodEnd * 1000) : null;
        subState = (info && info.sub) ? info.sub.status : null;
      }
    } catch (e) {
      skipped.push({ venue: v.name, why: 'could not read Stripe: ' + String((e && e.message) || e).slice(0, 90) });
      continue;
    }
    if (!periodEnd) {
      skipped.push({ venue: v.name, why: 'no period end on the subscription, so the 30 days cannot be counted' });
      continue;
    }
    if (now < periodEnd) {
      skipped.push({ venue: v.name, why: 'still inside their paid period' }); continue;
    }
    const over = now - periodEnd;
    if (over < graceMs) {
      const left = Math.floor((graceMs - over) / 86400000);
      skipped.push({ venue: v.name, why: left + (left === 1 ? ' more day of grace' : ' more days of grace') });
      continue;
    }
    const played = lastPlayed[v.id] || 0;
    if (played && played > periodEnd) {
      skipped.push({ venue: v.name, why: 'played again after their period ended, so they are not gone' });
      continue;
    }

    const row = { venue: v.name, id: v.id,
                  days_since_period_end: Math.floor(over / 86400000),
                  sub_state: subState };
    if (!dryRun) {
      await vpaPatch(env, 'vp_venues', 'id=eq.' + encodeURIComponent(v.id), {
        status: 'suspended',
        // The OWNER cancelled first, so this is the reason the manual path would
        // also write. Un-archiving reads it and will not restart their billing.
        suspended_reason: 'archived_cancelling',
        // And the 90-day clock starts here. It never used to: see vpaHandleVenueStatus.
        closed_at: new Date().toISOString(),
      });
      await vpaAudit(env, actor, 'venue_archived', 'venue:' + v.id,
        { status: 'archived', name: v.name, automatic: true,
          reason: 'cancelled and quiet for ' + days + '+ days',
          days_since_period_end: row.days_since_period_end });
    }
    archived.push(row);
  }

  return { ok: true, days: days, dry_run: dryRun, checked: venues.length,
           archived: archived, skipped: skipped };
}

async function vpaHandleVenueStatus(request, env, json) {
  const actor = await vpaRequireAdmin(request, env, ['owner', 'accounts']);
  if (actor.error) return json({ error: actor.error }, actor.status);

  const _b = await vpaBody(request, json);
  if (!_b.ok) return _b.res;
  const b = _b.body;
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
    'id=eq.' + encodeURIComponent(venueId) + '&select=id,name,founding_id,status,suspended_reason,cancel_at_period_end,closed_at');
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
  /* THE 90-DAY CLOCK MOVES WITH THE STATUS, IN BOTH DIRECTIONS.
     This patch used to write status and reason only. Two faults, found by audit 20 Sep 2026:
       - an archive never stamped closed_at, so a venue archived from HQ was invisible to the
         retention sweep and its players were kept for ever, which is the exact case the
         privacy page's 90-day promise is about
       - a REACTIVATION never cleared it. An un-archived venue kept its old closed date, so
         months later one failed card (status suspended, closed_at ancient) put a LIVE
         customer's players in front of the 3am purge. That one has no undo.
     Archive starts the clock, only if one is not already running. Active always clears it.
     A plain manual suspension is short and reversible and leaves it alone. */
  const statusPatch = {
    status: archiving ? 'suspended' : status,
    suspended_reason: archiving ? archiveReason : (status === 'suspended' ? 'manual' : null),
  };
  if (archiving && !prior.closed_at) statusPatch.closed_at = new Date().toISOString();
  if (status === 'active') statusPatch.closed_at = null;
  await vpaPatch(env, 'vp_venues', 'id=eq.' + encodeURIComponent(venueId), statusPatch);

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

/* GET /admin/venue-detail?venue_id=...
 *
 * Everything you want in front of you before you ring a venue that has gone quiet or asked
 * to leave. Dean, 17 Sep 2026: how long they have been with us, when they hit cancel, what
 * day their last day is, how many of each game they played, the average room, what they have
 * spent and what the overages came to.
 *
 * READS vpaVenueStats, the same function that builds the wrap at the bottom of the goodbye
 * email. One answer to "how many trivia nights", not two that drift.
 *
 * Money is an ESTIMATE and says so in the field name. There is no invoices table in this
 * database: spend is their current rate times the players they pay for times the months they
 * have been here. A venue that changed plan mid-way will not match Stripe exactly, and a
 * number on a screen that disagrees with a bank statement is worse than no number, so the UI
 * labels it as about.
 */
async function vpaHandleVenueDetail(request, env, json) {
  /* owner and accounts, the same pair every other admin route here uses. 'support' was in
     the first draft of this line and is not a role anybody holds, so it would have read as
     a wider permission than it granted. */
  const actor = await vpaRequireAdmin(request, env, ['owner', 'accounts']);
  if (actor.error) return json({ error: actor.error }, actor.status);
  const url = new URL(request.url);
  const venueId = (url.searchParams.get('venue_id') || '').trim();
  if (!venueId) return json({ error: 'venue_id is required.' }, 400);

  const vs = await vpaSelect(env, 'vp_venues', 'id=eq.' + encodeURIComponent(venueId)
    + '&select=id,name,slug,status,suspended_reason,cancel_at_period_end,created_at,'
    + 'max_players,founding_id,timezone,postcode');
  const v = vs && vs[0];
  if (!v) return json({ error: 'No such venue.' }, 404);
  const tz = v.timezone || vpaTimezoneFromPostcode(v.postcode);

  /* When they hit cancel, what they said, and anything we have written down since. Read from
     the audit because that is where it is: there is no cancel_reason column on the venue. */
  const trail = await vpaSelect(env, 'vp_admin_audit',
    'target=eq.' + encodeURIComponent('venue:' + venueId)
    + '&action=in.(venue_cancel_scheduled,venue_cancel_undone,venue_cancel_note,venue_quiet_contacted)'
    + '&select=created_at,action,detail&order=created_at.desc&limit=40').catch(() => []) || [];
  const lastCancel = trail.filter((r) => r.action === 'venue_cancel_scheduled')[0] || null;
  const lastUndo   = trail.filter((r) => r.action === 'venue_cancel_undone')[0] || null;
  const notes = trail.filter((r) => r.action === 'venue_cancel_note' || r.action === 'venue_quiet_contacted')
    .map((r) => ({ at: r.created_at, what: r.action, note: (r.detail && (r.detail.note || r.detail.by)) || null }));

  /* Their last day, and the weekday a publican actually thinks in. */
  let endTs = 0, rateCents = 0, founding = false;
  try {
    const accts = await vpaSelect(env, 'venueplay_founding', 'id=eq.'
      + encodeURIComponent(v.founding_id || '') + '&select=id,stripe_subscription_id,contact_email,contact_name');
    const acct = accts && accts[0];
    if (acct && acct.stripe_subscription_id) {
      const sub = await vpbStripeGet(env, 'subscriptions/' + encodeURIComponent(acct.stripe_subscription_id));
      const item = (sub && sub.items && sub.items.data && sub.items.data[0]) || {};
      endTs = parseInt(sub.cancel_at || sub.current_period_end || item.current_period_end || 0, 10) || 0;
      rateCents = (item.price && parseInt(item.price.unit_amount, 10)) || 0;
      const pid = (item.price && item.price.id) || '';
      founding = !!pid && (pid === env.STRIPE_PRICE_MONTHLY || pid === env.STRIPE_PRICE_ANNUAL);
    }
  } catch (e) { /* Stripe down: everything else is still worth showing */ }

  const stats = await vpaVenueStats(env, venueId, tz).catch(() => null);
  const months = vpaTenureMonths(v.created_at, endTs ? endTs * 1000 : null);

  return json({
    ok: true,
    venue: { id: v.id, name: v.name, slug: v.slug, status: v.status,
             cancelling: !!v.cancel_at_period_end, players: v.max_players },
    with_us: { since: v.created_at, months: months, words: vpaTenureWords(v.created_at, endTs ? endTs * 1000 : null) },
    cancel: {
      requested_at: lastCancel ? lastCancel.created_at : null,
      undone_at: lastUndo ? lastUndo.created_at : null,
      reason: lastCancel && lastCancel.detail ? lastCancel.detail.reason_label || lastCancel.detail.reason : null,
      reason_detail: lastCancel && lastCancel.detail ? lastCancel.detail.reason_detail : null,
      notes: notes,
    },
    last_day: endTs ? { at: endTs, date: vpaFmtDate(endTs), day: vpaLocalWeekday(endTs, tz) } : null,
    rate: { cents: rateCents, founding: founding },
    /* about_spend_cents, not spend_cents. See the note above the function. */
    about_spend_cents: rateCents * (v.max_players || 0) * months,
    overage_cents: stats ? stats.overageSpendCents : 0,
    stats: stats,
  });
}

/* ------------------------------------------------------------------------------------------
   A PLAYER ASKS TO BE REMOVED.   POST /admin/player-find   POST /admin/player-remove

   The privacy policy says: ask the venue or ask us, and "we will remove their details from that
   venue's list and tell the venue we have done so". Until 21 Sep 2026 nothing could do it.

   Dean's design, that night: "if the venue has downloaded it ... it emails a marketing inbox or
   something of theirs. if it hasnt been downloaded we just remove it." Removing somebody from
   OUR database does nothing about the spreadsheet a venue exported last month, and the person
   asking does not know or care which copy is which. Every download is already in the audit
   trail with a date, and every opt-in has its own date, so "has this venue downloaded a list
   with this person in it" is a comparison, not a guess.

   FIND shows, per venue, what is held and whether it has left the building. REMOVE blanks the
   same fields the 90 day purge blanks (the row stays: the head count is a billing record), and
   when the venue has downloaded since the opt-in, emails the account address asking them to
   delete the person from their own copy. HQ admins only. The person's address is never written
   to the audit trail in full: an audit row that stores what was just deleted has deleted nothing.
   ------------------------------------------------------------------------------------------ */
function vpaPersonQuery(raw) {
  const q = String(raw || '').trim();
  if (q.indexOf('@') !== -1) {
    const e = q.toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) || e.length > 200) return null;
    return { kind: 'email', value: e, filter: 'email=' + vpaEmailIs(e), masked: e.replace(/^(.).*(@.*)$/, '$1***$2'),
             same: (row) => String(row.email || '').trim().toLowerCase() === e };
  }
  const digits = q.replace(/\D/g, '');
  if (digits.length < 9 || digits.length > 13) return null;
  const tail = digits.slice(-9);                       // 0412 345 678, +61 412 345 678 and 61412345678 all end the same
  // Mobiles are stored as typed, spaces and all, so ask loosely and then compare digits exactly.
  return { kind: 'mobile', value: tail, filter: 'mobile=ilike.' + encodeURIComponent('*' + tail.split('').join('*')),
           masked: '*** *** ' + tail.slice(-3),
           same: (row) => String(row.mobile || '').replace(/\D/g, '').slice(-9) === tail };
}

async function vpaFindPerson(env, pq) {
  /* The database is asked loosely (no case, and for a mobile, anything between the digits) and
     every row that comes back is then compared EXACTLY. A near miss must never be deleted. */
  const caps = (await vpaSelectAll(env, 'vp_captures',
    pq.filter + '&select=id,venue_id,email,mobile,marketing_optin,marketing_optin_at&order=id.asc')).filter(pq.same);
  const players = await vpaSelectAll(env, 'vp_players',
    pq.filter + '&select=id,session_id,email,mobile,marketing_optin,marketing_optin_at,joined_at&order=id.asc');
  const mine = players.filter(pq.same);
  const sessionIds = Array.from(new Set(mine.map((r) => r.session_id).filter(Boolean)));
  const venueOfSession = {};
  for (let i = 0; i < sessionIds.length; i += 80) {
    const part = await vpaSelectAll(env, 'vp_sessions',
      'id=in.(' + sessionIds.slice(i, i + 80).map(encodeURIComponent).join(',') + ')&select=id,venue_id&order=id.asc');
    part.forEach((x) => { venueOfSession[x.id] = x.venue_id; });
  }
  const by = {};
  const slot = (vid) => by[vid] || (by[vid] = { venue_id: vid, player_ids: [], capture_ids: [], opted_in_at: null });
  const note = (v, row) => { if (row.marketing_optin && row.marketing_optin_at && (!v.opted_in_at || row.marketing_optin_at < v.opted_in_at)) v.opted_in_at = row.marketing_optin_at; };
  caps.forEach((r) => { if (r.venue_id) { const v = slot(r.venue_id); v.capture_ids.push(r.id); note(v, r); } });
  mine.forEach((r) => { const vid = venueOfSession[r.session_id]; if (vid) { const v = slot(vid); v.player_ids.push(r.id); note(v, r); } });
  const out = Object.keys(by).map((k) => by[k]);
  for (const v of out) {
    const vr = await vpaSelect(env, 'vp_venues', 'id=eq.' + encodeURIComponent(v.venue_id) + '&select=id,name,founding_id&limit=1');
    v.venue_name = (vr && vr[0] && vr[0].name) || 'Unknown venue';
    v.founding_id = (vr && vr[0] && vr[0].founding_id) || null;
    v.downloaded_at = null;
    if (v.opted_in_at) {
      /* Either kind of download counts: the owner's own, or one we ran for them from HQ. Only
         one AFTER the opt-in can have this person in it. */
      const targets = ['venue:' + v.venue_id].concat(v.founding_id ? ['account:' + v.founding_id] : []);
      const dl = await vpaSelect(env, 'vp_admin_audit',
        'action=in.(optin_exported,optin_exported_by_admin)&target=in.(' + targets.map((t) => '"' + t + '"').map(encodeURIComponent).join(',') + ')' +
        '&created_at=gt.' + encodeURIComponent(v.opted_in_at) + '&select=created_at&order=created_at.desc&limit=1');
      v.downloaded_at = (dl && dl[0] && dl[0].created_at) || null;
    }
  }
  return out.sort((a, b) => String(a.venue_name).localeCompare(String(b.venue_name)));
}

async function vpaHandlePlayerFind(request, env, json) {
  const actor = await vpaRequireAdmin(request, env, ['owner', 'accounts']);
  if (actor.error) return json({ error: actor.error }, actor.status);
  const _b = await vpaBody(request, json);
  if (!_b.ok) return _b.res;
  const pq = vpaPersonQuery(_b.body.q);
  if (!pq) return json({ error: 'Type the whole email address or the whole mobile number they gave the venue.' }, 400);
  let found;
  try { found = await vpaFindPerson(env, pq); }
  catch (e) { return json({ error: 'Could not search just now, so nothing has been changed. Try again in a moment.' }, 503); }
  return json({ ok: true, kind: pq.kind, venues: found.map((v) => ({
    venue_id: v.venue_id, venue_name: v.venue_name, records: v.player_ids.length + v.capture_ids.length,
    opted_in_at: v.opted_in_at, downloaded_at: v.downloaded_at })) });
}

async function vpaHandlePlayerRemove(request, env, json) {
  const actor = await vpaRequireAdmin(request, env, ['owner', 'accounts']);
  if (actor.error) return json({ error: actor.error }, actor.status);
  const _b = await vpaBody(request, json);
  if (!_b.ok) return _b.res;
  const b = _b.body;
  const pq = vpaPersonQuery(b.q);
  if (!pq) return json({ error: 'Type the whole email address or the whole mobile number they gave the venue.' }, 400);
  const only = b.venue_id ? String(b.venue_id) : null;       // one venue, or everywhere when absent
  let found;
  try { found = await vpaFindPerson(env, pq); }
  catch (e) { return json({ error: 'Could not search just now, so nothing has been changed. Try again in a moment.' }, 503); }
  const todo = found.filter((v) => !only || v.venue_id === only);
  if (!todo.length) return json({ ok: true, removed: 0, venues: [] });

  // The same fields the 90 day purge blanks, and marketing_optin false rather than null: NOT NULL.
  const BLANK = { first_name: null, last_name: null, email: null, mobile: null, postcode: null,
                  marketing_optin: false, marketing_optin_at: null };
  const done = [];
  for (const v of todo) {
    for (let i = 0; i < v.player_ids.length; i += 80) {
      await vpaPatch(env, 'vp_players', 'id=in.(' + v.player_ids.slice(i, i + 80).map(encodeURIComponent).join(',') + ')', BLANK);
    }
    for (let i = 0; i < v.capture_ids.length; i += 80) {
      await vpaPatch(env, 'vp_captures', 'id=in.(' + v.capture_ids.slice(i, i + 80).map(encodeURIComponent).join(',') + ')', BLANK);
    }
    let emailed = null;
    if (v.downloaded_at && v.founding_id) {
      const acct = await vpaSelect(env, 'venueplay_founding', 'id=eq.' + encodeURIComponent(v.founding_id) + '&select=contact_email,contact_name&limit=1');
      /* Dean: "it emails a marketing inbox or something of theirs". If the venue has a marketing
         login, that is who handles its lists, so that is who is told. With none, the account
         address. Both are tried in that order and one email goes to each marketing address. */
      let mk = [];
      try {
        mk = (await vpaSelect(env, 'vp_venue_staff', 'venue_id=eq.' + encodeURIComponent(v.venue_id) + '&role=eq.marketing&select=notify_email') || [])
          .map((r) => String(r.notify_email || '').trim().toLowerCase()).filter((e, i, a) => e && e.indexOf('@') > 0 && a.indexOf(e) === i);
      } catch (e) { mk = []; }
      const recipients = mk.length ? mk : [acct && acct[0] && acct[0].contact_email].filter(Boolean);
      const to = recipients[0];
      if (to) {
        const who = pq.kind === 'email' ? pq.value : ('the mobile number ending ' + pq.value.slice(-3));
        const html = '<div style="font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.6;color:#12101a;max-width:560px">'
          + '<p>Hi' + ((!mk.length && acct[0] && acct[0].contact_name) ? ' ' + vpaEsc(String(acct[0].contact_name).split(' ')[0]) : '') + ',</p>'
          + '<p>Somebody who played at <strong>' + vpaEsc(v.venue_name) + '</strong> has asked to be removed from your players list: <strong>' + vpaEsc(who) + '</strong>.</p>'
          + '<p>We have removed them from VenuePlay, so they will not be in any list you download from now on.</p>'
          + '<p>You downloaded your list on ' + vpaFmtDate(Math.floor(Date.parse(v.downloaded_at) / 1000)) + ', after they joined, so they are probably in that copy. '
          + '<strong>Please delete them from that file and from anything you loaded it into</strong> (your email or SMS tool, a spreadsheet, a CRM), and do not contact them again. '
          + 'The Spam Act gives a business five working days to act on a request like this.</p>'
          + '<p>Nothing else is needed, and you do not need to reply. If you have a question, just answer this email.</p>'
          + '<p>VenuePlay<br>hello@venueplay.com.au</p>' + vpaSupportPhoneHtml() + '</div>';
        emailed = 'sent';
        for (const addr of recipients) {
          try { if (!(await vpaSendEmail(env, addr, 'Please remove one person from your ' + v.venue_name + ' players list',
                        vpaVenueEmailCard('Somebody has asked to come off your ' + v.venue_name + ' players list. One thing to do.', html, 'Please remove one person from your players list')))) emailed = 'failed'; }
          catch (e) { emailed = 'failed'; }
        }
      } else { emailed = 'no address'; }
    }
    await vpaAudit(env, actor, 'player_removed', 'venue:' + v.venue_id, {
      who: pq.masked, records: v.player_ids.length + v.capture_ids.length,
      venue_had_downloaded: !!v.downloaded_at, venue_emailed: emailed }).catch(() => {});
    done.push({ venue_id: v.venue_id, venue_name: v.venue_name, records: v.player_ids.length + v.capture_ids.length,
                venue_had_downloaded: !!v.downloaded_at, venue_emailed: emailed });
  }
  return json({ ok: true, removed: done.reduce((n, d) => n + d.records, 0), venues: done });
}

async function vpaHandleOptinApprove(request, env, json) {
  const actor = await vpaRequireAdmin(request, env, ['owner', 'accounts']);
  if (actor.error) return json({ error: actor.error }, actor.status);
  const _b = await vpaBody(request, json);
  if (!_b.ok) return _b.res;
  const b = _b.body;
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

  const _b = await vpaBody(request, json);
  if (!_b.ok) return _b.res;
  const b = _b.body;
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
 * REMOVE A LOGIN, FROM HQ   (Dean, 30 Oct 2026)
 *
 * Sarah's end-to-end test was held because her email "already has a VenuePlay login" from an earlier test,
 * and the only way to clear it was the Supabase dashboard. HQ can now remove a login that belongs to no other
 * venue: from a venue's Details (its Logins), from "Remove a login" (find one by email), and HQ offers it
 * after a venue is archived.
 *
 *   POST /admin/logins        { venue_id }        owner or accounts: the venue's logins, each saying whether
 *                                                 it can be removed and, if not, why
 *   POST /admin/login-find    { email }           owner or accounts: one login and every venue it is staff at
 *   POST /admin/login-remove  { auth_user_id, venue_id?, confirm }   OWNER ONLY. A PERMANENT DELETE.
 *
 * REFUSED, and nothing changes, when the login is staff at any venue other than venue_id (with no venue_id:
 * at any venue at all), when it is a VenuePlay staff (HQ) login, when it cannot be looked up, or when confirm
 * is not that login's own email ("ending" and the last three digits of its mobile, for a mobile-only login). confirm is what the HQ confirm step
 * names: a stale page, or a tap on the wrong row, can never remove the login next to it.
 *
 * NEVER AUTOMATIC. Nothing in this Worker calls vpaRemoveLogin but the one route below, on an owner's own tap.
 * It reads the facts with vpaReadPage, which THROWS on a database fault: a failed read must never look like
 * "staff at no other venue" (vpaSelect would return [] and say exactly that).
 *
 * The venue's staff rows for it go first, then Supabase's admin delete-user. If the delete fails, the rows
 * are put back, so a venue is never left with a login it cannot see. Every removal is in the audit log.
 * ======================================================================== */
const VPA_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function vpaLoginFacts(env, authUserId, user) {
  const staff = await vpaReadPage(env, 'vp_venue_staff', 'auth_user_id=eq.' + encodeURIComponent(authUserId) + '&select=venue_id,role&order=venue_id.asc&limit=200');
  const admins = await vpaReadPage(env, 'vp_platform_admins', 'auth_user_id=eq.' + encodeURIComponent(authUserId) + '&select=auth_user_id,role&limit=1');
  const ids = staff.map(function (r) { return r.venue_id; }).filter(Boolean);
  const venues = ids.length ? await vpaReadPage(env, 'vp_venues', 'id=in.(' + ids.map(encodeURIComponent).join(',') + ')&select=id,name,status,suspended_reason&limit=200') : [];
  const byId = {};
  venues.forEach(function (v) { byId[v.id] = v; });
  return {
    auth_user_id: authUserId, email: (user && user.email) || '', phone_end: vpaMaskMobile(user && user.phone),
    has_phone: !!(user && user.phone), is_admin: admins.length > 0,
    venues: staff.map(function (r) { const v = byId[r.venue_id] || {}; return { id: r.venue_id, name: v.name || '(a venue that is gone)', role: r.role, status: v.status || null }; }),
  };
}

/* Can this login go, seen from venue_id (or from nowhere)? '' = yes, else why not, in words for HQ. */
function vpaLoginWhyNot(f, venueId) {
  if (f.is_admin) return 'This is a VenuePlay staff login (HQ). Remove it under VenuePlay staff logins, not here.';
  const others = f.venues.filter(function (v) { return v.id !== venueId; });
  if (others.length) return 'It is staff at ' + others.map(function (v) { return v.name; }).slice(0, 3).join(', ')
    + (others.length > 3 ? ' and ' + (others.length - 3) + ' more' : '') + ', so it cannot be removed. Take it off ' + (others.length === 1 ? 'that venue' : 'those venues') + ' first.';
  return '';
}

/* POST /admin/logins { venue_id } */
async function vpaHandleLogins(request, env, json) {
  const actor = await vpaRequireAdmin(request, env, ['owner', 'accounts']);
  if (actor.error) return json({ error: actor.error }, actor.status);
  const _b = await vpaBody(request, json);
  if (!_b.ok) return _b.res;
  const venueId = String((_b.body || {}).venue_id || '');
  if (!VPA_UUID_RE.test(venueId)) return json({ error: 'venue_id is required.' }, 400);
  let out = [];
  try {
    const rows = await vpaReadPage(env, 'vp_venue_staff', 'venue_id=eq.' + encodeURIComponent(venueId) + '&select=auth_user_id,role&order=auth_user_id.asc&limit=100');
    for (const r of rows) {
      if (!r.auth_user_id) continue;
      const u = await vpaAuthGetUser(env, r.auth_user_id);
      const f = await vpaLoginFacts(env, r.auth_user_id, u);
      const why = u ? vpaLoginWhyNot(f, venueId) : 'Its details could not be looked up just now, so it cannot be removed. Try again in a minute.';
      out.push(Object.assign(f, { role: r.role, can_remove: !why && actor.role === 'owner', why_not: why || (actor.role === 'owner' ? '' : 'Only an Owner can remove a login.') }));
    }
  } catch (e) { return json({ error: 'Could not read the logins just now. Nothing was changed.' }, 503); }
  return json({ ok: true, venue_id: venueId, logins: out });
}

/* POST /admin/login-find { email } */
async function vpaHandleLoginFind(request, env, json) {
  const actor = await vpaRequireAdmin(request, env, ['owner', 'accounts']);
  if (actor.error) return json({ error: actor.error }, actor.status);
  const _b = await vpaBody(request, json);
  if (!_b.ok) return _b.res;
  const email = String((_b.body || {}).email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(email)) return json({ error: 'Type the whole email address of the login.' }, 400);
  let u;
  try { u = await vpaFindAuthUser(env, { email: email }); } catch (e) { u = null; }
  if (!u || !u.id) return json({ ok: true, login: null });
  let f;
  try { f = await vpaLoginFacts(env, u.id, u); } catch (e) { return json({ error: 'Could not read that login just now. Nothing was changed.' }, 503); }
  // From here the only venue it can be removed WITH is the one venue it belongs to (or none).
  const ctx = f.venues.length === 1 ? f.venues[0].id : null;
  const why = vpaLoginWhyNot(f, ctx);
  return json({ ok: true, login: Object.assign(f, { venue_id: ctx, can_remove: !why && actor.role === 'owner', why_not: why || (actor.role === 'owner' ? '' : 'Only an Owner can remove a login.') }) });
}

/* POST /admin/login-remove { auth_user_id, venue_id?, confirm } */
async function vpaHandleLoginRemove(request, env, json) {
  const actor = await vpaRequireAdmin(request, env, ['owner']);
  if (actor.error) return json({ error: actor.error }, actor.status);
  const _b = await vpaBody(request, json);
  if (!_b.ok) return _b.res;
  const b = _b.body || {};
  const id = String(b.auth_user_id || ''), venueId = b.venue_id ? String(b.venue_id) : null;
  if (!VPA_UUID_RE.test(id)) return json({ error: 'auth_user_id is required.' }, 400);
  if (venueId && !VPA_UUID_RE.test(venueId)) return json({ error: 'That venue_id is not a venue.' }, 400);
  const u = await vpaAuthGetUser(env, id);
  if (!u || !u.id) return json({ error: 'That login could not be found (it may already be gone). Nothing was changed.' }, 404);
  let f;
  try { f = await vpaLoginFacts(env, id, u); } catch (e) { return json({ error: 'Could not check that login just now. Nothing was changed.' }, 503); }
  const name = String(u.email || '').toLowerCase();
  const said = String(b.confirm || '').trim().toLowerCase();
  // The confirm names the email; a mobile-only login is named by its last three digits ("ending 123"), all HQ ever sees.
  if (!said || !(name ? said === name : (f.phone_end && said === 'ending ' + f.phone_end))) {
    return json({ error: 'The confirm did not name this login (' + (name || ('the mobile ending ' + (f.phone_end || '?'))) + '). Nothing was changed.' }, 400);
  }
  const why = vpaLoginWhyNot(f, venueId);
  if (why) return json({ error: why + ' Nothing was changed.' }, 409);
  const removed = venueId ? await vpaDelete(env, 'vp_venue_staff', 'auth_user_id=eq.' + encodeURIComponent(id) + '&venue_id=eq.' + encodeURIComponent(venueId)) : [];
  const res = await fetch(env.SUPABASE_URL + '/auth/v1/admin/users/' + encodeURIComponent(id), { method: 'DELETE', headers: vpaHeaders(env) });
  if (!res.ok) {
    for (const r of removed) { try { await vpaInsert(env, 'vp_venue_staff', r, false); } catch (e) { /* recorded below */ } }
    await vpaAudit(env, actor, 'login_remove_failed', 'login:' + id, { email: name || null, venue_id: venueId, status: res.status });
    return json({ error: 'Supabase did not remove the login (' + res.status + '). Nothing was changed; its venue still has it.' }, 502);
  }
  const venueName = venueId ? ((f.venues.filter(function (v) { return v.id === venueId; })[0] || {}).name || null) : null;
  await vpaAudit(env, actor, 'login_removed', 'login:' + id, { email: name || null, phone_end: f.phone_end, venue_id: venueId, venue_name: venueName, staff_rows: removed.length });
  return json({ ok: true, removed: name || ('the mobile ending ' + (f.phone_end || '?')), venue_id: venueId });
}


/* ===========================================================================
 * 5) POST /admin/audit   (any admin)  — view-as / read logging
 *    body: { action, target?, detail? }  -> { ok:true }
 * ======================================================================== */
async function vpaHandleAudit(request, env, json) {
  const actor = await vpaRequireAdmin(request, env, null);
  if (actor.error) return json({ error: actor.error }, actor.status);

  const _b = await vpaBody(request, json);
  if (!_b.ok) return _b.res;
  const b = _b.body;
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
  if (!foundingId) return; // nothing we can link to; leave as-is

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
    let tickedAt1 = null;   // when the signup tick was given, as /checkout recorded it (C5, 20 Oct 2026)
    try {
      const vlist = f.venues_json ? (typeof f.venues_json === 'string' ? JSON.parse(f.venues_json) : f.venues_json) : null;
      const e = vlist && vlist[0] && vlist[0].entity_type;
      if (e === 'non_profit' || e === 'for_profit') declaredEntity1 = e;
      const t = vlist && vlist[0] && vlist[0].compliance_accepted_at;
      if (typeof t === 'string' && !isNaN(Date.parse(t))) tickedAt1 = t;
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
        /* The signup tick, recorded from the fact /checkout saved (it refuses without the tick).
           Before 20 Oct 2026 this path recorded nothing at all, so a single-venue signup read
           "NOT accepted" in HQ. A lead with no record of the tick stays null: never assumed. */
        compliance_accepted_at: tickedAt1,
        compliance_accepted_by: tickedAt1 ? (String(f.contact_name || cd.name || '').trim().slice(0, 200) || 'the signup contact') : null,
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

    // Welcome email once the account is whole, on whichever run got it there (see vpaWelcomeOnce).
    await vpaWelcomeOnce(env, session, foundingId, async function () {
      const r = await vpaFireWelcome(env, session, f, [{ name: venueName, seats: f.max_seats, slug: venue && venue.slug }], false);
      await vpaNotifyNewSignup(env, session, f, [{ name: venueName, seats: f.max_seats }], false);
      return r;   // the welcome's own outcome, so vpaWelcomeOnce records what really happened
    });
    // An SA or NT pub that asked for its bingo to be reviewed (signup tick, migration 116).
    try {
      const vl = f.venues_json ? (typeof f.venues_json === 'string' ? JSON.parse(f.venues_json) : f.venues_json) : null;
      await vpaBingoReviewTicket(env, f, Object.assign({ name: venueName }, venue), vl && vl[0]);
    } catch (e) { /* best-effort */ }
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
  if (n >= 5000 && n <= 5999) return 'SA';   // 58xx and 59xx are SA's PO box ranges (22 Oct 2026)
  if (n >= 6000 && n <= 6797) return 'WA';
  if (n >= 7000 && n <= 7799) return 'TAS';
  if (n >= 800 && n <= 999) return 'NT';
  return null;
}

// AU postcode -> IANA timezone (best-effort; QLD fallback). Same postcode->state map as above, so a
// venue's members-draw "Tonight" shows on the right day in the venue's own time.
/* DOES THIS POSTCODE QUALIFY FOR THIS STATE'S FOUNDING WINDOW? One answer.

   There were two. The self-serve gate inside handleCheckout was a UNION of the
   postcode->state map and the old leading-digit test, because each covers the
   other's gaps: the map knows QLD is 4xxx AND 9xxx, and the digit knows SA 58xx,
   WA 68xx and TAS 78xx, which the map returns null for. vpaFoundingForPostcode,
   used by HQ onboarding at /add-card and by the welcome email, had only the map
   and returned false when it came back null.

   So the same venue in the same live window got a different price purely by which
   link they signed up through. THIS HAPPENED AGAIN, and the same way: on 17 Sep 2026
   checkout stopped pricing off the postcode entirely and those same two paths were
   left behind, so a Queensland venue we onboarded by hand paid $3.00 while the one
   that signed itself up paid $2.50. Both now ask vpaFoundingOpenNow, which takes no
   postcode at all, because the only reliable fix for one answer in three places is
   to delete the other two. What is below stays because checkout still records
   whether the state matched, as metadata and not as money. A 200-player venue in SA 5800 onboarded by HQ pays
   $3.00 instead of $2.50 a head, for life, silently: the welcome email is built
   from the same broken gate, so the quoted rate matches the wrong charge and
   nothing looks inconsistent. About $1,200 a year, or $1,320 on annual.

   Found by audit 5 Sep 2026. Both callers now use this. */
const VPA_STATE_DIGIT = { QLD: '4', NSW: '2', ACT: '2', VIC: '3', SA: '5', WA: '6', TAS: '7', NT: '0' };

function vpaFoundingStateOk(postcode, codeState) {
  const pc = String(postcode || '').trim();
  const want = String(codeState || '').toUpperCase();
  const digit = VPA_STATE_DIGIT[want] || '';
  const pcState = vpaStateFromPostcode(pc);
  if (digit !== '' && pc.charAt(0) === digit) return true;
  if (pcState !== null && pcState === want) return true;
  // ACT and NSW are one market for founding.
  if (pcState === 'ACT' && want === 'NSW') return true;
  if (pcState === 'NSW' && want === 'ACT') return true;
  return false;
}

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
 * One state stays off even for a confirmed club:
 *   QLD  our number generator is still going through OLGR approval, so we cannot run the draw
 *        at all yet, whatever the venue is allowed to do
 * (NT used to be here too, over a permit condition that may bar an association paying anyone for
 * conducting a game. Dean, 22 Oct 2026: ignore it; that part can be offered free.)
 * Everywhere else a club may charge, subject to caps and permits that vp-gaming.js shows them
 * before each night and that remain the venue's own responsibility.
 */
const VPA_PAID_ENTRY_BLOCKED_STATES = new Set(['QLD']);
function vpaPaidEntryDefault(entityType, auState) {
  if (entityType !== 'non_profit') return false;
  if (!auState) return false;                       // no postcode, no state, no assumptions
  return !VPA_PAID_ENTRY_BLOCKED_STATES.has(String(auState).toUpperCase());
}

/* NUMBER BINGO FOR SA AND NT PUBS (Dean, 22 Oct 2026; migration 116). The billing side of
   numberBingoHidden() in app/vp-gaming.js, numberBingoHiddenFor() in the game Worker and
   vpNoBingoAt() on the signup page (tools/test-sant-bingo.js runs all four on one table). Here it
   only picks words: which welcome email variant a venue gets. Musical bingo is not bingo. */
const VPA_NO_PUB_BINGO = { SA: 'South Australia', NT: 'the Northern Territory' };
function vpaNoNumberBingo(auState, entityType, switchedOn) {
  const st = String(auState || '').toUpperCase();
  if (!VPA_NO_PUB_BINGO[st]) return false;
  if (entityType === 'non_profit') return false;
  return switchedOn !== true;
}
/* "South Australia", "the Northern Territory", or both, for the states in a list where number
   bingo is off. '' when none. */
function vpaNoBingoPlaces(states) {
  const seen = [];
  (states || []).forEach(function (s) { s = String(s || '').toUpperCase(); if (VPA_NO_PUB_BINGO[s] && seen.indexOf(s) === -1) seen.push(s); });
  seen.sort();   // NT before SA, then reversed below so it reads South Australia first
  seen.reverse();
  return seen.map(function (s) { return VPA_NO_PUB_BINGO[s]; }).join(' and ');
}
/* Fill the no-bingo section of a welcome template: kept with the place named when `places` is
   not empty, stripped otherwise. Every other IF section in the file is left for its own caller. */
function vpaNoBingoSection(html, places) {
  return String(html).replace(/<!--IF:nobingo-->([\s\S]*?)<!--ENDIF:nobingo-->/g,
    function (m, body) { return places ? body : ''; })
    .replace(/{{nobingo_places}}/g, places || '');
}
/* For a self-serve signup: which of its venues are SA or NT pubs, from what the form sent. */
function vpaSignupNoBingoStates(f, venues) {
  let list = null;
  try { list = f && f.venues_json ? (typeof f.venues_json === 'string' ? JSON.parse(f.venues_json) : f.venues_json) : null; } catch (e) { list = null; }
  if (!Array.isArray(list) || !list.length) list = (venues || []).map(function (v) { return { postcode: (v && v.postcode) || (f && f.postcode), entity_type: v && v.entity_type }; });
  const out = [];
  list.forEach(function (v) {
    const st = vpaStateFromPostcode((v && v.postcode) || (f && f.postcode));
    if (vpaNoNumberBingo(st, v && v.entity_type, false)) out.push(st);
  });
  return out;
}
/* The signup tick: open ONE help desk ticket per venue that asked, so HQ sees the request where it
   works. Best-effort: a failure here must never fail provisioning (Stripe would retry the whole
   webhook over a note). Idempotent on a retry: the ticket subject names the venue id. */
async function vpaBingoReviewTicket(env, f, venue, entry) {
  try {
    if (!entry || entry.bingo_review !== true || !venue || !venue.id) return;
    if (typeof helpInsertTicket !== 'function') return;
    // Only an SA or NT pub has anything to review: a club, or a pub anywhere else, already has bingo.
    const st = vpaStateFromPostcode(entry.postcode || (f && f.postcode)) || '';
    if (!vpaNoNumberBingo(st, entry.entity_type, false)) return;
    const subject = 'Number bingo review: ' + (venue.name || 'a venue') + ' [' + venue.id + ']';
    const have = await vpaSelect(env, 'vp_help_tickets', 'venue_id=eq.' + encodeURIComponent(venue.id) + '&subject=eq.' + encodeURIComponent(subject) + '&select=id&limit=1');
    if (have && have.length) return;
    await helpInsertTicket(env, {
      brand: 'venueplay', category: 'venue_support', channel: 'web_form', status: 'new',
      title: subject,
      message: (venue.name || 'This venue') + ' signed up as a pub in ' + (VPA_NO_PUB_BINGO[st] || st || 'SA or NT') +
        ' and ticked "Our bingo is run by a not-for-profit organisation". Number bingo is hidden for them until HQ switches it on ' +
        '(HQ > Venues > Details > Number bingo). Ask who conducts the bingo and for their licence or approval, then switch it on if it checks out.',
      contact_name: (f && f.contact_name) || null,
      contact_email: (f && f.contact_email) || null,
      contact_phone: (f && f.mobile) || null,
      venue_id: venue.id,
    });
  } catch (e) { /* the venue is provisioned either way; HQ can still see the state on the venue card */ }
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

  /* opts.forceNew: the caller has ALREADY looked and decided this is a genuinely different
     venue that happens to share a name, so do not collapse it onto the old one. Only
     vpbAddVenue passes it, and only after comparing postcodes. The signup path is untouched:
     it still matches on name alone, which is what makes provisioning safe to retry. */
  let venue = opts.forceNew ? null : (await vpaSelect(env, 'vp_venues',
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
      /* THE SAME ROW DERIVED au_state FROM THE POSTCODE AND THEN HARDCODED THE CLOCK.
         Every self-serve venue outside Queensland was written Australia/Brisbane. Today
         that is invisible for NSW, VIC, TAS and ACT because the clocks agree; from
         5 October it is an hour wrong, and it is an hour wrong in three places at once:
         sessions close at 4am instead of 3am, a members draw shows "Tonight" on the wrong
         day for an hour, and the last-day email lands at 9am instead of 8. vpaTimezoneFromPostcode
         has existed all along and one of the three creation paths was already using it. */
      timezone: vpaTimezoneFromPostcode(opts.postcode),
      /* The self-serve checkout tick carries the VPA_COMPLIANCE_TICK sentence under "I agree to
         the Terms" (index.html and nsw.html, 15 Oct 2026), and /checkout refuses a signup without
         the tick, so a venue provisioned from a paid signup HAS accepted it. Record who, from the
         founding contact, the way /admin/venue records the name typed in HQ. Without this every
         self-serve venue read "NOT accepted" on the HQ compliance card. */
      compliance_accepted_at: opts.complianceBy ? (opts.complianceAt || new Date().toISOString()) : null,
      compliance_accepted_by: opts.complianceBy || null,
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
    // Who ticked the compliance sentence at checkout: the founding contact, or the card holder.
    // Recorded only for a venue the checkout says WAS ticked (compliance_accepted_at on its
    // venues_json row, set by /checkout since 20 Oct 2026). A lead saved before then has no such
    // fact, so the venue shows "NOT accepted" in HQ and is asked, rather than assumed.
    const complianceBy = String(f.contact_name || cd.name || '').trim().slice(0, 200) || 'the signup contact';
    for (let i = 0; i < venues.length; i++) {
      const v = venues[i] || {};
      const name = String(v.name || '').trim() || ('Venue ' + (i + 1));
      const seats = parseInt(v.seats, 10) || null;
      const postcode = String(v.postcode || '').replace(/\D/g, '').slice(0, 4);
      const ticked = typeof v.compliance_accepted_at === 'string' && !isNaN(Date.parse(v.compliance_accepted_at));
      const r = await vpaProvisionOneVenue(env, { foundingId: foundingId, groupId: null, name: name, seats: seats, postcode: postcode, entityType: v.entity_type || null, authUserId: authUserId,
                                                  complianceBy: ticked ? complianceBy : null, complianceAt: ticked ? v.compliance_accepted_at : null });
      if (r.created) anyCreated = true;
      // The welcome email needs each venue's OWN screen link, and the slug only exists
      // once the venue does. Without this every card in the email pointed at a bare /tv.
      if (r.venue && r.venue.slug && venues[i]) venues[i].slug = r.venue.slug;
      // An SA or NT pub that asked for its bingo to be reviewed (signup tick, migration 116).
      if (r.venue) await vpaBingoReviewTicket(env, f, Object.assign({ name: name }, r.venue), v);
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
    }
    // Outside the anyCreated test on purpose: a retry that only FINISHES a group created nothing.
    await vpaWelcomeOnce(env, session, foundingId, async function () {
      const r = await vpaFireWelcome(env, session, f, venues, true);
      await vpaNotifyNewSignup(env, session, f, venues, true);
      return r;
    });
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
/* THE WELCOME EMAIL, ONCE, WHICHEVER RUN FINISHES THE JOB. It used to be sent only on the run
   that INSERTED the venue row. Provisioning is built to be resumed: the first run creates the
   venue, something after it throws, Stripe retries, the retry finds the venue and finishes the
   rest. That second run did not create the venue, so nobody was ever welcomed and we were never
   told about the signup: a paying customer with a working account and silence. Since 20 Sep
   2026 a failed webhook really is retried straight away, so this path is the ordinary one now.
   Found by audit the same day.

   The audit trail is the ledger: one welcome_email_sent row per account. Only for a checkout
   made in the last three days, so Stripe re-delivering an OLD event for an account that was
   welcomed before this ledger existed cannot welcome it twice. */
async function vpaWelcomeOnce(env, session, foundingId, send) {
  try {
    const made = parseInt(session && session.created, 10) || 0;
    if (made && (Date.now() / 1000 - made) > 3 * 24 * 60 * 60) return false;
    const target = 'account:' + foundingId;
    const prior = await vpaSelect(env, 'vp_admin_audit',
      'target=eq.' + encodeURIComponent(target) + '&action=eq.welcome_email_sent&select=id&limit=1');
    if (prior && prior.length) return false;
    /* ONLY A WELCOME THAT WENT IS RECORDED AS SENT (audit 25 Sep 2026). This wrote
       welcome_email_sent whatever send() did, and vpaFireWelcome returned quietly on no key, no
       address or a Resend refusal, so the row could claim a welcome nobody got AND block the
       retry. A failure is now its own row, which does not block the next attempt. */
    const r = (await send()) || { sent: false, why: 'no answer from the sender' };
    await vpaInsert(env, 'vp_admin_audit', { actor_admin: null, actor_label: 'stripe',
      action: r.sent ? 'welcome_email_sent' : 'welcome_email_not_sent', target: target,
      detail: { outcome: r.why || (r.sent ? 'sent' : ''), to: r.to || null, resend_id: r.id || null,
                status: r.status || null } }, false);
    return !!r.sent;
  } catch (e) { return false; }
}

/* WHAT THEY WILL ACTUALLY BE CHARGED, IN WORDS. Every welcome email said "{{monthly_total}} a
   month" whatever the plan, so an annual venue with 80 players was told "$184.00 a month" and
   then charged $2,208.00 in one go, which is what the Terms and the pricing page both say annual
   means. Found by audit, 20 Sep 2026. One function, so the three welcome emails cannot disagree. */
function vpaPaymentPhrase(monthlyTotal, plan) {
  const fmt = (n) => '$' + Number(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return plan === 'annual'
    ? fmt(monthlyTotal * 12) + ' a year, billed yearly (' + fmt(monthlyTotal) + ' a month)'
    : fmt(monthlyTotal) + ' a month';
}

async function vpaFireWelcome(env, session, f, venues, isGroup) {
  try {
    if (!env.RESEND_API_KEY) return { sent: false, why: 'not sent: no Resend key on this Worker' };
    const site = (env.SITE_URL || 'https://venueplay.com.au').replace(/\/+$/, '');
    const email = f.contact_email;
    if (!email) return { sent: false, why: 'not sent: the account has no contact email' };

    const plan = f.plan === 'annual' ? 'annual' : 'monthly';
    const tier = (session.metadata && session.metadata.tier) || 'founding';
    const rate = tier === 'standard' ? (plan === 'annual' ? 2.85 : 3.00)
                                     : (plan === 'annual' ? 2.30 : 2.50);
    const money = (n) => '$' + Number(n).toFixed(2);
    const nowSecs = Math.floor(Date.now() / 1000);
    /* The first payment is WHEN STRIPE WILL TAKE IT, read off the checkout that set it. Thirty
       days from now is only the fallback for a checkout made before the date was carried, and a
       date already in the past is ignored rather than printed. */
    const metaTrial = parseInt(session && session.metadata && session.metadata.trial_end, 10) || 0;
    const firstChargeTs = metaTrial > nowSecs ? metaTrial : nowSecs + 30 * 24 * 60 * 60;
    const firstCharge = vpaFmtDate(firstChargeTs);
    const launchPhrase = '';
    /* A returning venue did not get a free month, so the email must not say it did. */
    const returning = !!(session && session.metadata && session.metadata.returning === '1');
    const freeIntro = returning
      ? 'Your free month was used on your earlier account, and this time you have a few days to get set up'
      : 'Your first month is free';
    const consoleUrl = site + '/app';
    /* THE TV LINK CARRIES THE VENUE, ALWAYS. This was `site + '/tv'` for every venue, so the
       email said "open this link on your screen" and handed over an address that names no
       venue at all: the screen sits in its setup state and the venue thinks the product is
       broken. It only ever worked on a browser that still remembered a slug from before.
       Found by audit 20 Sep 2026, the day after the copy beside it was changed to say
       "always use this full link". A venue with no slug yet falls back to the bare link,
       which is no worse than before. */
    const tvFor = (v) => site + '/tv' + (v && v.slug ? ('?' + encodeURIComponent(v.slug)) : '');
    const tvUrl = tvFor(venues && venues[0]);
    /* HELP IS support@ (Dean, 23 Oct 2026: the support, accounts and sales mailboxes exist). The
       welcome's one ask is "if you need any help, let us know", so its address and its reply-to are
       the help desk's, not the general inbox. Money emails name accounts@; the enquiry form, sales@. */
    const support = 'support@venueplay.com.au';

    const res = await fetch(site + '/emails/' + (isGroup ? 'welcome-group.html' : 'welcome.html'));
    if (!res.ok) return { sent: false, why: 'not sent: the email template did not load (' + res.status + ')', to: email };
    let html = await res.text();
    /* THE SA AND NT PUB VARIANT (Dean, 22 Oct 2026: "better to be honest from the beginning").
       Number bingo is hidden for a pub there, so the email says so kindly, says what they CAN run
       and how to ask if their bingo is run by a not-for-profit. Every other venue gets the
       template with that section stripped. */
    html = vpaNoBingoSection(html, vpaNoBingoPlaces(vpaSignupNoBingoStates(f, venues)));

    if (isGroup) {
      const total = venues.reduce((n, v) => n + (parseInt(v.seats, 10) || 0), 0);
      let blocks = '';
      for (let i = 0; i < venues.length; i++) {
        const v = venues[i]; const seats = parseInt(v.seats, 10) || 0;
        blocks += '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #eee;border-radius:12px;margin-bottom:12px"><tr><td style="padding:16px 20px">'
          + '<p style="margin:0;font-size:17px;font-weight:700;color:#12101a">' + vpaEsc(v.name) + '</p>'
          + '<p style="margin:4px 0 12px;font-size:14px;color:#6a6a75">' + seats + ' players &middot; ' + vpaPaymentPhrase(seats * rate, plan) + '</p>'
          + '<a href="' + consoleUrl + '" style="display:inline-block;background:#FF1F8E;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;padding:10px 20px;border-radius:8px;margin-right:8px">Host console</a>'
          + '<a href="' + tvFor(v) + '" style="display:inline-block;color:#12101a;text-decoration:none;font-size:14px;font-weight:700;border:1.5px solid #12101a;padding:8.5px 20px;border-radius:8px">TV screen</a>'
          + '</td></tr></table>';
      }
      /* EVERY occurrence, not the first. A string replace swaps only the FIRST match, and the
         first {{VENUE_BLOCKS}} in the template was inside its documentation comment. So the
         blocks were injected into a comment nobody sees and the real placeholder went out to
         a paying group as a raw tag with no venues under it. */
      html = html.split('{{VENUE_BLOCKS}}').join(blocks)
        .replace(/{{venue_count}}/g, String(venues.length))
        .replace(/{{total_players}}/g, String(total))
        .replace(/{{payment_total}}/g, vpaPaymentPhrase(total * rate, plan))
        .replace(/{{monthly_total}}/g, money(total * rate));
    } else {
      const seats = parseInt((venues[0] && venues[0].seats) || f.max_seats, 10) || 0;
      html = html.replace(/{{player_count}}/g, String(seats))
        .replace(/{{payment_total}}/g, vpaPaymentPhrase(seats * rate, plan))
        .replace(/{{monthly_total}}/g, money(seats * rate));
    }
    html = html.replace(/{{first_charge_date}}/g, firstCharge)
      .replace(/{{free_intro}}/g, freeIntro)
      .replace(/{{launch_phrase}}/g, launchPhrase)
      .replace(/{{player_rate}}/g, money(rate))
      .replace(/{{host_console_url}}/g, consoleUrl)
      .replace(/{{tv_url}}/g, tvUrl)
      // The welcome email now carries a plain-English summary of the plan and links the real
      // agreement. Unfilled, these would go out to a paying customer as the literal text
      // {{terms_url}}, which is worse than not linking them at all.
      .replace(/{{terms_url}}/g, site + '/terms')
      .replace(/{{privacy_url}}/g, site + '/privacy')
      /* THE UNSUBSCRIBE LINK IN EVERY WELCOME EMAIL WAS DEAD. The template footers carry
         {{unsubscribe_url}} and nothing anywhere replaced it, so the href a venue clicked
         was the literal text. Found 15 Sep 2026 by listing every merge tag in the four
         templates the Worker loads and asking which ones anything fills in.

         It points at /unsubscribe, which writes to vp_unsubscribes.

         THIS COMMENT USED TO SAY that list was "read ONLY by the outreach send tools". It was
         not read by them either. On 17 Sep 2026 nothing anywhere read it: unsubscribing wrote a
         row and changed nothing. The venue marketing export now consults it and fails closed if
         it cannot. Opting out stops MARKETING and deliberately cannot stop a billing notice or
         a cancellation email; getting that the wrong way round would be far worse. */
      .replace(/\{\{unsubscribe_url\}\}/g, site + '/unsubscribe?e=' + encodeURIComponent(email || ''))
      .replace(/{{support_email}}/g, support);
    html = vpaFillSupport(html);

    const sentRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'VenuePlay <hello@send.venueplay.com.au>',
        reply_to: support, // a reply to the welcome is a setup question: the help desk's inbox
        to: [email],
        subject: isGroup ? 'Your venues are set up. Welcome to VenuePlay' : 'You are in. Welcome to VenuePlay',
        html: vpaEmailDocument(html, 'Welcome to VenuePlay'),
      }),
    });
    let id = null;
    try { const j = await sentRes.json(); id = (j && j.id) || null; } catch (_) {}
    return { sent: !!(sentRes && sentRes.ok), why: sentRes && sentRes.ok ? 'sent' : 'not sent: Resend refused it',
             to: email, id: id, status: (sentRes && sentRes.status) || null };
  } catch (e) {
    /* welcome email is best-effort; never fail provisioning, but say what happened */
    return { sent: false, why: 'not sent: ' + String((e && e.message) || e).slice(0, 120) };
  }
}


/* ===========================================================================
 * HQ-ONBOARDED VENUES: the card link, and the emails that are not the
 * self-serve welcome.
 *
 * A venue we build by hand in HQ has a founding row, a venue, a login and no
 * card: nobody went through Checkout. The self-serve welcome email is wrong for
 * it twice over (it thanks them for signing up and quotes a first charge date
 * that no subscription will honour), so HQ sends welcome-hq.html instead, in
 * one of two flavours: "add your card" for a paying venue, "on the house" for a
 * comp/demo one.
 * ======================================================================== */

/* Keep or strip <!--IF:name--> ... <!--ENDIF:name--> sections in a template.
   Lets one file carry both flavours instead of two files drifting apart. A
   section whose name is not in `on` is removed, so a typo fails quiet-and-empty
   rather than mailing raw HTML comments to a customer. */
function vpaTplSections(html, on) {
  return String(html).replace(
    /<!--IF:([a-zA-Z0-9_-]+)-->([\s\S]*?)<!--ENDIF:\1-->/g,
    (m, key, body) => (on && on[key] ? body : '')
  );
}

/* The secret behind the add-card link. CARD_LINK_SECRET if you set one, else we
   piggyback on a secret the Worker already holds. Either way it never leaves
   here: only the HMAC of it does. */
function vpaCardSecret(env) {
  return env.CARD_LINK_SECRET || env.STRIPE_WEBHOOK_SECRET || env.SUPABASE_SERVICE_KEY || '';
}

async function vpaCardToken(env, foundingId) {
  const secret = vpaCardSecret(env);
  if (!secret || !foundingId) return '';
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, enc.encode('vp-add-card:' + foundingId));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

/* The link that goes in the email. Stable and reusable: it points at our own
   page, and the Checkout session is created on the click. A Stripe session URL
   pasted into an email would be dead within 24 hours, which is exactly the
   window a venue owner spends ignoring their inbox. */
async function vpaCardLink(env, foundingId) {
  const site = (env.SITE_URL || 'https://venueplay.com.au').replace(/\/+$/, '');
  const t = await vpaCardToken(env, foundingId);
  if (!t) return '';
  return site + '/add-card?f=' + encodeURIComponent(foundingId) + '&t=' + t;
}


/* Is a venue in THIS postcode's state currently inside a founding window?
 *
 * Founding stopped being "the first 100 venues" a while back: it is a state-by-state rollout,
 * invite-only through a state link that carries a code like QLD-AUG-2026, and it runs until the
 * end of that month. handleCheckout has read it that way for some time. The HQ onboarding path
 * and its welcome email did not, because they were written against the old cap, so a venue we
 * hand-onboarded was quoted and sold on a rule that no longer exists.
 *
 * env FOUNDING_CODES is the list of codes that are live right now, so retiring a state's window
 * is deleting its code from that variable. There is deliberately no count anywhere.
 */
/* IS THE DEAL OPEN AT ALL RIGHT NOW. Not "is this venue's state open", which is what the
   function this replaces asked.

   Checkout stopped pricing off the postcode on 17 Sep 2026, at Dean's instruction: "if it's more
   than one venue and they have one in NSW and one in QLD I am happy for the same price between
   the 2." It became `const founding = codeActive` and the postcode now only rides along in the
   Stripe metadata so a cross-state signup is visible.

   Two other paths never got that change and were still asking vpaFoundingForPostcode, which is
   true only when the postcode's state matches a live code:

     - /add-card, the card link HQ sends when we set a venue up for someone
     - the HQ welcome email, which quotes the rate IN WRITING

   So a Queensland venue we set up by hand was charged $3.00 and told $3.00, while the identical
   venue signing itself up through the NSW page paid $2.50. Same product, same week, two prices,
   and the expensive one went to the venues Dean was personally selling to.

   A venue HQ sets up by hand carries no founding code, so there is nothing to match. The honest
   equivalent of `codeActive` here is simply whether the deal is running. When it ends, every code
   comes out of FOUNDING_CODES and all three paths go to standard together. */
/* A MONTH'S CODE ENDS WITH ITS MONTH, BY ITSELF. Dean, 25 Sep 2026: each campaign's offer runs to
   the end of a month and then "that code is done, dusted and gone". Until now a code only stopped
   when somebody took it out of FOUNDING_CODES, so a forgotten one kept selling $2.50 for ever.
   A code ending -OCT-2026 is honoured until midnight at the end of 31 October, Brisbane time
   (UTC+10 all year, no daylight saving). A code with no month in it keeps the old rule: live while
   it is listed. The list still switches a code OFF early; the date only ever ends one. */
const VPA_CODE_MONTHS = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };
function vpaCodeInDate(code, nowMs) {
  const m = /-([A-Z]{3})-(20\d\d)$/.exec(String(code || '').trim().toUpperCase());
  if (!m || !(m[1] in VPA_CODE_MONTHS)) return true;
  const endMs = Date.UTC(Number(m[2]), VPA_CODE_MONTHS[m[1]] + 1, 1) - 10 * 3600 * 1000;   // 00:00 on the 1st of the next month, Brisbane
  return (nowMs == null ? Date.now() : nowMs) < endMs;
}
// The codes that are live RIGHT NOW: listed, and not past the end of their month.
function vpaLiveCodes(env, nowMs) {
  return (env.FOUNDING_CODES || '').split(',').map(function (c) { return c.trim().toUpperCase(); })
    .filter(Boolean).filter(function (c) { return vpaCodeInDate(c, nowMs); });
}
function vpaFoundingOpenNow(env) {
  return vpaLiveCodes(env).length > 0;
}

/* GET /add-card?f=<founding id>&t=<token>
   Verifies the signature, builds a Checkout session for THAT EXISTING founding
   row and redirects to Stripe. client_reference_id is the row id, so the
   webhook we already have marks the row card_on_file and the provisioning it
   already runs finds the venue HQ built (it matches on founding_id) instead of
   creating a second one. Nothing new has to know about this path. */
async function vpaAddCardRedirect(request, env) {
  const site = (env.SITE_URL || 'https://venueplay.com.au').replace(/\/+$/, '');
  const page = (title, body) => new Response(
    '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<title>' + title + '</title>'
    + '<body style="margin:0;background:#12101a;color:#fff;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px">'
    + '<div style="max-width:460px;text-align:center">'
    + '<h1 style="font-size:22px;margin:0 0 12px">' + title + '</h1>'
    + '<p style="font-size:16px;line-height:1.6;color:#c9c7d4;margin:0">' + body + '</p>'
    + '<p style="margin:22px 0 0"><a href="mailto:hello@venueplay.com.au" style="color:#FF1F8E;font-weight:700">hello@venueplay.com.au</a></p>'
    + '<p style="margin:10px 0 0;font-size:15px;color:#c9c7d4">or call <a href="tel:' + VP_SUPPORT_TEL + '" style="color:#FF1F8E;font-weight:700">' + VP_SUPPORT_PHONE + '</a></p>'
    + '</div></body>',
    { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } }
  );

  try {
    const url = new URL(request.url);
    const foundingId = (url.searchParams.get('f') || '').trim();
    const token = (url.searchParams.get('t') || '').trim();
    const expect = await vpaCardToken(env, foundingId);
    // Constant-time-ish compare, same as the Stripe signature check above.
    let ok = !!(expect && token && expect.length === token.length);
    if (ok) {
      let diff = 0;
      for (let i = 0; i < expect.length; i++) diff |= expect.charCodeAt(i) ^ token.charCodeAt(i);
      ok = diff === 0;
    }
    if (!ok) return page('That link is not valid', 'Check you copied the whole link from the email, or reply to it and we will send you a fresh one.');

    const rows = await vpaSelect(env, 'venueplay_founding',
      'id=eq.' + encodeURIComponent(foundingId)
      /* postcode is still selected, but it NO LONGER DECIDES THE PRICE. It used to: a missing
         postcode here made founding come back false and every venue onboarded from HQ was
         quietly put on the STANDARD price. That was fixed by selecting the column; on 17 Sep
         2026 the price stopped asking the postcode at all, on any path. Left in the select
         because the Checkout session still carries it and because deleting a column from a
         select to "tidy up" is how that fault happened the first time. */
      + '&select=id,venue_name,contact_email,mobile,max_seats,plan,status,stripe_subscription_id,postcode');
    const f = rows && rows[0];
    if (!f) return page('We could not find that account', 'Reply to your welcome email and we will sort it out.');
    // Already paying: sending them through Checkout again would open a SECOND subscription on the
    // same venue and bill them twice. Their billing page is where changes belong.
    if (f.stripe_subscription_id) return Response.redirect(site + '/app/billing.html', 302);
    if (f.status === 'comp') return page('This account is on us', 'There is nothing to pay on ' + vpaEsc(f.venue_name || 'this venue') + ', so there is no card to add.');

    const plan = f.plan === 'annual' ? 'annual' : 'monthly';
    const seats = Math.max(parseInt(f.max_seats, 10) || 0, 1);
    // Founding vs standard is decided at the moment they add the card, on the SAME rule as a
    // self-serve signup: is the deal open. Not the postcode, which stopped deciding the price at
    // checkout on 17 Sep and left this path quietly charging $3.00 for the same thing.
    /* A PROSPECT (migration 127): the offer they were set up on holds through their free month, and a pause
       takes it away (vpaProspectPrice). Anyone else: is the deal open today, as before. */
    const prow = await vpaProspectRowFor(env, 'founding_id', foundingId);
    const founding = prow ? vpaProspectPrice(env, prow).founding : vpaFoundingOpenNow(env);
    const price = founding
      ? (plan === 'annual' ? env.STRIPE_PRICE_ANNUAL : env.STRIPE_PRICE_MONTHLY)
      : (plan === 'annual' ? env.STRIPE_PRICE_STANDARD_ANNUAL : env.STRIPE_PRICE_STANDARD_MONTHLY);
    if (!price) return page('We could not open the payment page', 'Reply to your welcome email and we will send you another way to pay.');

    const nowTs = Math.floor(Date.now() / 1000);
    // Their free month starts when they add the card, not when HQ built the venue: they have not
    // had the product until now. Stripe rejects a trial_end under ~2 days out.
    /* A WHOLE 30 DAYS, TO THE END OF THE 30TH DAY IN BRISBANE (Dean, 29 Oct 2026). Exactly now + 30 days was
       shown by Stripe Checkout as "29 days free" seconds later, beside an app that says the first month is free.
       Ending at 11:59:59pm Brisbane on the 30th day after today reads "30 days free" and is the same end of
       day the prospect free month (migration 127) uses. */
    const bneToday = Math.floor((nowTs + 10 * 3600) / 86400) * 86400 - 10 * 3600;   // 00:00 today, Brisbane
    let trialTs = Math.max(bneToday + 31 * 24 * 60 * 60 - 1, nowTs + 3 * 24 * 60 * 60);
    /* A prospect's free month started at their first sign-in (migration 127): a card added on day 10 is first
       charged when that month ends, not 30 days later. After a pause the month is used: no trial at all. */
    if (prow && prow.paused_at) trialTs = 0;
    else if (prow && prow.free_month_ends_at) trialTs = Math.max(Math.floor(Date.parse(prow.free_month_ends_at) / 1000), nowTs + 3 * 24 * 60 * 60);

    const form = new URLSearchParams();
    form.set('mode', 'subscription');
    form.set('line_items[0][price]', price);
    form.set('line_items[0][quantity]', String(seats));
    if (trialTs) form.set('subscription_data[trial_end]', String(trialTs));
    form.set('subscription_data[metadata][venue]', f.venue_name || '');
    form.set('subscription_data[metadata][row_id]', foundingId);
    form.set('subscription_data[metadata][tier]', founding ? 'founding' : 'standard');
    form.set('subscription_data[metadata][is_group]', '0');
    form.set('subscription_data[metadata][venue_count]', '1');
    form.set('subscription_data[metadata][hq_onboarded]', '1');
    form.set('payment_method_collection', 'always');
    form.set('allow_promotion_codes', 'false');
    if (f.contact_email) form.set('customer_email', f.contact_email);
    form.set('client_reference_id', foundingId);   // <- what links the card back to the venue HQ built
    form.set('metadata[venue]', f.venue_name || '');
    form.set('metadata[row_id]', foundingId);
    form.set('metadata[tier]', founding ? 'founding' : 'standard');
    form.set('metadata[is_group]', '0');
    form.set('metadata[venue_count]', '1');
    form.set('metadata[hq_onboarded]', '1');
    if (trialTs) form.set('metadata[trial_end]', String(trialTs));
    /* BACK TO THE CONSOLE, SIGNED IN (Dean, 29 Oct 2026). Their card link is opened from the signed-in app, so
       Stripe's back arrow (cancel) and Done (success) both return to /app/, where the sign-in is still held
       (Supabase keeps it in the browser's local storage). success_url used to be the public homepage. */
    form.set('success_url', site + '/app/?card=added');
    form.set('cancel_url', site + '/app/');

    const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + env.STRIPE_SECRET_KEY,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
    });
    const session = await res.json();
    if (!res.ok || !session.url) {
      await vpaInsert(env, 'vp_admin_audit', {
        actor_admin: null, actor_label: 'system', action: 'add_card_link_failed',
        target: 'founding:' + foundingId,
        detail: { error: (session.error && session.error.message) || 'stripe error' },
      }, false).catch(() => {});
      return page('We could not open the payment page', 'Nothing has been charged. Reply to your welcome email and we will get you sorted.');
    }
    return Response.redirect(session.url, 302);
  } catch (e) {
    return page('Something went wrong', 'Nothing has been charged. Reply to your welcome email and we will get you sorted.');
  }
}

/* THE SUBJECT LINE OF EVERY EMAIL THAT COMES TO US, not to a venue.

   Dean, 12 Sep 2026: "Maybe with the emails to venueplay we start the subject off with
   what it is CANCELLED VENUE: Praze the Roof Sports Bar NEW VENUE: etc". The inbox is the
   queue, and four alerts that each phrase themselves differently cannot be scanned, sorted
   or filtered. So the kind comes first, in capitals, always, and the name follows it.

   ONLY OUR OWN ALERTS. A venue's receipt, their payment reminder and their welcome email
   are not on this list and must never be: shouting a category at a customer is not what
   this is for. */
const VPA_ALERT_KINDS = {
  new_venue:   'NEW VENUE',
  new_group:   'NEW GROUP',
  cancelled:   'CANCELLED VENUE',
  uncancelled: 'UNCANCELLED VENUE',
  check:       'CHECK SIGNUP',
  enquiry:     'ENQUIRY',
};
function vpaAlertSubject(kind, rest) {
  const tag = VPA_ALERT_KINDS[kind] || 'VENUEPLAY';
  const tail = String(rest == null ? '' : rest).trim();
  return tail ? tag + ': ' + tail : tag;
}

/* One place that actually posts to Resend, so the three emails below cannot
   drift on the from address or the reply-to. Returns true if it went. */
/* replyTo: where a reply lands. hello@ unless the sender says otherwise; the HQ welcome and the
   onboarding guide say support@, because a reply to either is a setup question.
   headers: extra message headers, only ever vpUnsubHeaders() for a MARKETING email (26 Oct 2026).
   A transactional email passes nothing and goes out exactly as before. */
async function vpaSendEmail(env, to, subject, html, replyTo, headers) {
  if (!env.RESEND_API_KEY || !to) return false;
  const msg = {
    from: 'VenuePlay <hello@send.venueplay.com.au>',
    reply_to: replyTo || 'hello@venueplay.com.au',
    to: [to],
    subject: subject,
    html: html,
    /* A text/plain part made from the same HTML (helpPlainFromHtml, 28 Oct 2026): an HTML-only
       email is one of the things Outlook's filter scores towards junk. */
    text: helpPlainFromHtml(html),
  };
  if (headers && typeof headers === 'object' && Object.keys(headers).length) msg.headers = headers;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(msg),
  });
  /* ACCEPTED, NOT DELIVERED, and the difference has already cost us. res.ok is Resend saying
     it has taken the message: the far end has not been near it yet. The audit rows written
     from this used to call that "delivered", and on 17 Sep 2026 a last-day email to
     dean.tindale@outlook.com was recorded as delivered, reported to Dean as delivered, and
     never arrived. Nothing was lying except the word.
     The audit key is `accepted` now. Real delivery only ever arrives on the Resend webhook,
     which is what /webhooks/resend is for. */
  return res.ok;
}

/* Welcome email for a venue onboarded from HQ. `comp` picks the flavour.
   Best-effort like every other email here: onboarding has already succeeded by
   the time this runs and must never be undone by Resend having a bad day. */
async function vpaFireHqWelcome(env, o) {
  try {
    if (!env.RESEND_API_KEY) return false;
    const site = (env.SITE_URL || 'https://venueplay.com.au').replace(/\/+$/, '');
    const email = (o.email || '').trim();
    if (!email) return false;

    const res = await fetch(site + '/emails/welcome-hq.html');
    if (!res.ok) return false;
    let html = await res.text();
    const comp = !!o.comp;
    /* The SA and NT pub variant, as for a self-serve signup. HQ's Add venue form records what the
       venue IS as venue_kind, not entity_type, so a pub or hotel there gets the no-bingo note
       unless HQ has already recorded it as a club or switched number bingo on. */
    const hqState = vpaStateFromPostcode(o.postcode);
    const hqEntity = o.entityType || vpaEntitySuggestion(o.venueKind);
    html = vpaNoBingoSection(html, vpaNoNumberBingo(hqState, hqEntity, o.numberBingoOn === true) ? vpaNoBingoPlaces([hqState]) : '');
    html = vpaTplSections(html, { card: !comp, comp: comp });

    const plan = o.plan === 'annual' ? 'annual' : 'monthly';
    // Same rule as checkout and as the card link: is the deal open, not where they are. This
    // email quotes the rate in writing, so pricing it differently to checkout puts a number in
    // front of a venue that we then do not charge them.
    const founding = !comp && vpaFoundingOpenNow(env);
    const rate = founding ? (plan === 'annual' ? 2.30 : 2.50)
                          : (plan === 'annual' ? 2.85 : 3.00);
    const seats = parseInt(o.seats, 10) || 0;
    const money = (n) => '$' + Number(n).toFixed(2);
    const cardUrl = comp ? '' : await vpaCardLink(env, o.foundingId);
    // No card link means no working "Add my card" button, and an email whose one job is that
    // button is worse than no email. Say nothing rather than send a dead end.
    if (!comp && !cardUrl) return false;

    html = html
      .replace(/{{venue_name}}/g, vpaEsc(o.venueName || 'Your venue'))
      .replace(/{{player_count}}/g, String(seats))
      .replace(/{{player_rate}}/g, money(rate))
      .replace(/{{payment_total}}/g, vpaPaymentPhrase(seats * rate, plan))
      .replace(/{{monthly_total}}/g, money(seats * rate))
      .replace(/{{card_url}}/g, cardUrl)
      .replace(/{{host_console_url}}/g, site + '/app')
      .replace(/{{tv_url}}/g, site + '/tv?' + encodeURIComponent(o.slug || ''))
      .replace(/{{terms_url}}/g, site + '/terms')
      .replace(/{{privacy_url}}/g, site + '/privacy')
      .replace(/\{\{unsubscribe_url\}\}/g, site + '/unsubscribe?e=' + encodeURIComponent(email || ''))
      .replace(/{{support_email}}/g, 'support@venueplay.com.au');
    html = vpaFillSupport(html);

    return await vpaSendEmail(env, email,
      comp ? 'Your VenuePlay account is ready, and it is on us'
           : 'Your VenuePlay account is ready. One thing left.',
      vpaEmailDocument(html, 'Your VenuePlay account is ready'), 'support@venueplay.com.au');
  } catch (_) { return false; }
}

/* Onboarding email for a venue an OWNER adds from their own account. It goes to
   the account's contact email, written to be forwarded straight to the venue,
   and carries no billing at all: the owner is the one paying, and the venue
   only needs to know how to get a game on the screen. */
async function vpbFireVenueOnboarding(env, o) {
  try {
    if (!env.RESEND_API_KEY) return false;
    const site = (env.SITE_URL || 'https://venueplay.com.au').replace(/\/+$/, '');
    const email = (o.email || '').trim();
    if (!email) return false;

    const res = await fetch(site + '/emails/venue-onboarding.html');
    if (!res.ok) return false;
    let html = await res.text();
    html = html
      .replace(/{{venue_name}}/g, vpaEsc(o.venueName || 'Your new venue'))
      .replace(/{{host_console_url}}/g, site + '/app')
      .replace(/{{tv_url}}/g, site + '/tv?' + encodeURIComponent(o.slug || ''))
      .replace(/\{\{unsubscribe_url\}\}/g, site + '/unsubscribe?e=' + encodeURIComponent(email || ''))
      .replace(/{{support_email}}/g, 'support@venueplay.com.au');
    html = vpaFillSupport(html);

    return await vpaSendEmail(env, email,
      'Setup guide for ' + (o.venueName || 'your new venue') + ' (forward this on)',
      vpaEmailDocument(html, 'Setup guide for ' + (o.venueName || 'your new venue')), 'support@venueplay.com.au');
  } catch (_) { return false; }
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
        subject: vpaAlertSubject(isGroup ? 'new_group' : 'new_venue',
                 (isGroup ? list.length + ' venues, ' : '')
                 + (list.length ? list[0].name : 'venue') + (state ? ' (' + state + ')' : '')
                 + (guessed ? '' : ' [club or pub?]')),
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
/* EVERY LINE ON THE BILL, NOT JUST THE BIG NIGHTS.

   The reminder showed a bare "Amount due $10.00" and nothing else, because the only
   breakdown it could build was vpaOverageFromInvoice(), which matches lines beginning
   "Big night extra players" and nothing else. Jess's $10 was three PLAN CHANGES
   ("1 extra player, full month") plus the subscription, so none of it matched and she
   was told a total with no explanation. Her accounts person has no way to check it.

   Stripe already itemises the invoice. This just shows what is on it, in the order
   Stripe has it, with the venue name Stripe already puts in each description, which is
   what makes it read correctly for a group account billed for several venues.

   Dean, 11 Sep 2026: "just says you are being billed for $10. No breakdown and as part
   of a group we said we would do that right?" */
/* WHAT AN AUSTRALIAN ACCOUNTS TEAM ACTUALLY NEEDS ON A RECEIPT.

   The paid-invoice email said "Payment received" and an amount. That is a nice note,
   not something a bookkeeper can file. A tax invoice needs the SUPPLIER'S ABN and the
   GST, and ours carried neither: ABN appeared in exactly zero emails, and GST in none
   of them, while terms.html has said "GST inclusive" since launch.

   VenuePlay prices INCLUDE GST, so the GST component is the total divided by eleven,
   not added on top. Getting that backwards would overstate every venue's claimable
   credit, so it is written out here rather than left to a reader.

   The ABN is the one on terms.html. If it ever changes it has to change in both, which
   is why it says so here. */
const VP_ABN = '35 679 383 049';   // also on venueplay/terms.html; keep them the same

/* THE SUPPORT PHONE. Dean, 20 Oct 2026: VenuePlay has a phone number now, a Crazytel line with a
   menu (1 sales, 2 a venue running a game, 3 players, 4 accounts). It goes wherever a VENUE looks
   for help, and never on a player's phone screen: players use Help on the phone, and key 3 only
   reaches voicemail.

   THIS IS THE ONE PLACE IN THIS WORKER IT IS WRITTEN. Every email below takes it from here, the
   site templates get it through {{support_phone}} and {{support_tel}} (vpaFillSupport), and the
   footer of every venue email is vpaVenueEmailFoot. The site's own copies (vp-help.js, the sales
   pages, terms, privacy, the venue FAQ) are held to these two strings by
   tools/test-support-phone.py, which fails on any other number or tel: link anywhere served. */
const VP_SUPPORT_PHONE = '07 5228 3667';
const VP_SUPPORT_TEL = '+61752283667';

/* One line, the same in every venue email: the number, tappable, and which key a game night
   wants. */
function vpaSupportPhoneHtml() {
  return '<p style="font-size:12.5px;color:#9a9aa4;margin:14px 0 0">Need us? Call '
    + '<a href="tel:' + VP_SUPPORT_TEL + '" style="color:#9a9aa4;font-weight:700">' + VP_SUPPORT_PHONE + '</a>'
    + '. If a game is on right now, press 2.</p>';
}
/* THE FOOTER OF EVERY EMAIL A VENUE GETS FROM THIS WORKER. The support line, then the small
   print. withAbn: a receipt, a reminder or a plan change carries the ABN; the leaving emails do
   not (Dean's call, see vpaLeavingHtml). */
function vpaVenueEmailFoot(withAbn) {
  return vpaSupportPhoneHtml()
    + '<p style="font-size:12px;color:#c2c2cc;margin:14px 0 0">venueplay.com.au'
    + (withAbn ? ' &middot; VenuePlay, ABN ' + VP_ABN : '') + '</p>';
}

/* EVERY EMAIL IS A DOCUMENT, NOT A FRAGMENT. Email audit, 23 Oct 2026: the receipt, the
   reminder, the failed-payment notice, the plan-uplift notice and both leaving emails went out
   as a bare <div>, with no <html>, no charset and no viewport, and with a dark logo on white
   while the welcome emails carry the pink logo on a dark header. On a phone a client with no
   viewport hint lays the email out at desktop width and shrinks it, and the two families of
   email did not look like they came from the same company. The templates under /emails/ are
   table fragments for the same reason.
   Two helpers. vpaEmailDocument wraps anything that is not already a document, and changes
   nothing a venue can read. vpaVenueEmailCard is for the emails built inline here: the same
   600px white card and dark header the templates use, a hidden preheader for the inbox
   preview, then the content untouched. Neither adds a footer, an ABN or an unsubscribe: the
   leaving emails must carry none of those and the tests hold them to it. */
function vpaEmailDocument(html, title) {
  const s = String(html || '');
  if (/^\s*(<!doctype|<html)/i.test(s)) return s;
  return '<!doctype html><html lang="en-AU"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<meta name="x-apple-disable-message-reformatting">'
    + '<title>' + vpaEsc(title || 'VenuePlay') + '</title></head>'
    + '<body style="margin:0;padding:0;background:#f4f4f7;-webkit-text-size-adjust:100%">' + s + '</body></html>';
}
/* brand: 'partyplay' puts the PartyPlay logo on the dark band (the help desk acknowledges both
   brands from here); anything else is VenuePlay. */
function vpaVenueEmailCard(preheader, inner, title, brand) {
  const pp = brand === 'partyplay';
  const site = pp ? 'https://partyplay.com.au' : 'https://venueplay.com.au';
  const logo = pp ? site + '/logos/partyplay-email-logo.png' : site + '/logos/venueplay_primary_rebuilt.png';
  return vpaEmailDocument(
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f7;margin:0;padding:0;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">'
    + '<tr><td align="center" style="padding:24px 12px">'
    + (preheader ? '<div style="display:none;max-height:0;overflow:hidden;opacity:0">' + vpaEsc(preheader) + '</div>' : '')
    + '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:14px;overflow:hidden">'
    + '<tr><td style="background:#12101a;padding:20px 32px">'
    + '<img src="' + logo + '" width="168" alt="' + (pp ? 'PartyPlay' : 'VenuePlay') + '" style="display:block;border:0;height:auto"></td></tr>'
    + '<tr><td style="padding:28px 28px 30px">' + String(inner || '') + '</td></tr>'
    + '</table></td></tr></table>', title);
}
/* The site's email templates ask for the number with two tags; every template the Worker sends
   goes through here, so none of them can be filled one way and another a different way. */
function vpaFillSupport(html) {
  return String(html).replace(/\{\{support_phone\}\}/g, VP_SUPPORT_PHONE).replace(/\{\{support_tel\}\}/g, VP_SUPPORT_TEL);
}

/* TELL THEM BEFORE IT HAPPENS, AND TELL THEM WHEN IT HAS.

   A venue's plan moves up automatically on the third big night in a row, and until now
   the only place that was ever said was the console, on the night, in a modal somebody
   taps through. The bill that follows never mentioned it, and neither did the reminder.
   A venue could find out its monthly cost had permanently changed by comparing two
   invoices.

   Dean, 11 Sep 2026: "In these emails it should also warn of a upgrade and if we have
   upgraded. I guess all I want is transparency."

   Two notices, and they are deliberately different. The WARNING is a heads-up that one
   more big night moves the plan, which is the moment a venue can still choose to raise
   its own cap instead. The NOTICE is after the fact and explains what changed and why
   the third night was half price. */
function vpaUpliftNoticeHtml(invoice) {
  const lines = (invoice && invoice.lines && invoice.lines.data) || [];
  const hit = lines.filter(function (l) {
    return /plan move[sd] up/i.test(String((l && l.description) || ''));   // moves/moved, so a reworded marker still matches
  })[0];
  if (!hit) return '';
  return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
       + 'style="background:#fff6fb;border:1px solid #ffd0e6;border-radius:12px;margin-bottom:22px">'
       + '<tr><td style="padding:16px 18px">'
       + '<p style="margin:0 0 6px;font-size:14px;font-weight:700;color:#12101a">Your plan has moved up</p>'
       + '<p style="margin:0;font-size:13px;color:#6a6a75">That was your third big night in a row, so those '
       + 'extra players were charged at half price and your plan has moved up to cover the crowd you are '
       + 'actually getting. It takes effect from your next invoice, and your rate per player has not changed. '
       + 'You can adjust it any time on your billing page.</p>'
       + '</td></tr></table>';
}

/* Venues on this account that are two big nights into a run. One more and the plan
   moves. Never throws: a reminder that cannot read the streak is still worth sending. */
async function vpaUpliftWarningHtml(env, customerId) {
  try {
    if (!customerId) return '';
    const accts = await vpaSelect(env, 'venueplay_founding',
      'stripe_customer_id=eq.' + encodeURIComponent(customerId) + '&select=id&limit=1');
    const fid = accts && accts[0] && accts[0].id;
    if (!fid) return '';
    const vs = await vpaSelect(env, 'vp_venues',
      'founding_id=eq.' + encodeURIComponent(fid) + '&select=name,overage_streak&status=eq.active');
    const close = (vs || []).filter(function (v) { return Number(v.overage_streak || 0) >= 2; });
    if (!close.length) return '';
    const names = close.map(function (v) { return vpaEsc(v.name || 'your venue'); }).join(', ');
    return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
         + 'style="background:#fffaf0;border:1px solid #f3e2bd;border-radius:12px;margin-bottom:22px">'
         + '<tr><td style="padding:16px 18px">'
         + '<p style="margin:0 0 6px;font-size:14px;font-weight:700;color:#12101a">Heads-up: one more big night and the plan moves up</p>'
         + '<p style="margin:0;font-size:13px;color:#6a6a75">' + names + ' has gone over the plan two nights running. '
         + 'A third in a row is charged at half price and then the plan moves up permanently to cover that crowd. '
         + 'If you would rather set the number yourself, raise it on your billing page before the next night. '
         + 'A night back inside the plan clears the run.</p>'
         + '</td></tr></table>';
  } catch (e) { return ''; }
}

function vpaTaxSummaryHtml(invoice) {
  const total = Number((invoice && (invoice.amount_paid || invoice.amount_due)) || 0);
  if (!(total > 0)) return '';
  const gst = Math.round(total / 11);          // GST-inclusive pricing: the component, not an addition
  const ex = total - gst;
  const row = function (label, cents, strong) {
    return '<tr><td style="padding:5px 0;font-size:13px;color:' + (strong ? '#12101a' : '#6a6a75') + '">' + label + '</td>'
         + '<td style="padding:5px 0;font-size:13px;text-align:right;white-space:nowrap;color:#12101a'
         + (strong ? ';font-weight:700' : '') + '">$' + (cents / 100).toFixed(2) + '</td></tr>';
  };
  return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
       + 'style="border:1px solid #eee;border-radius:12px;margin-bottom:22px"><tr><td style="padding:16px 18px">'
       + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">'
       + row('Subtotal (excluding GST)', ex, false)
       + row('GST', gst, false)
       + row('Total paid', total, true)
       + '</table>'
       + '<p style="margin:12px 0 0;font-size:12px;color:#9a9aa4">Tax invoice. VenuePlay, '
       + 'ABN ' + VP_ABN + '. Prices include GST.</p>'
       + '</td></tr></table>';
}

function vpaInvoiceLinesHtml(invoice) {
  const lines = (invoice && invoice.lines && invoice.lines.data) || [];
  if (!Array.isArray(lines) || lines.length < 1) return '';
  const rows = lines.map(function (l) {
    const amt = Number(l.amount || 0);
    const desc = String((l && l.description) || 'VenuePlay');
    return '<tr>'
      + '<td style="padding:7px 0;font-size:13.5px;color:#12101a;border-bottom:1px solid #f0f0f3">' + vpaEsc(desc) + '</td>'
      + '<td style="padding:7px 0;font-size:13.5px;color:#12101a;text-align:right;white-space:nowrap;border-bottom:1px solid #f0f0f3">$'
      + (amt / 100).toFixed(2) + '</td></tr>';
  }).join('');
  return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
       + 'style="border:1px solid #eee;border-radius:12px;margin-bottom:22px"><tr><td style="padding:16px 18px">'
       + '<p style="margin:0 0 8px;font-size:13px;color:#6a6a75">What this is for</p>'
       + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">' + rows + '</table>'
       + '</td></tr></table>';
}

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

/* "I SAID YOU NEEDED A NOTIFICATION THIS MORNING THAT THEIR PLAN WAS GOING UP."
   Dean, 11 Sep 2026, after The Jolly Jess was moved from 1 player to 2 by the three
   big nights rule and nothing whatsoever told her. Her monthly goes $2.50 -> $5.00.

   There was no such email. The only mention of an uplift anywhere was a BLOCK inside
   the receipt for that night's invoice, so a venue learned their bill had gone up only
   if that receipt arrived. That night it did not: the receipt threw a ReferenceError on
   every send. So the plan moved in silence, which is not something you do to somebody's
   recurring bill.

   This is its own email, fired the moment the plan moves, and it does not care whether
   any invoice or receipt works.

   WHY IT LIVES IN THE BILLING WORKER. upliftPlan runs in the GAME Worker, which has no
   Resend key. It does write plan_uplift_after_three_big_nights the moment it succeeds,
   and every quantity change it makes raises customer.subscription.updated here, where
   the key is. So the audit row is the trigger and the event is the doorbell.

   IDEMPOTENT ON THE ROW, not on the event. setPlayers, addVenue and applyPendingOnInvoice
   all raise the same event, and Stripe redelivers. An uplift is emailed once because the
   row it came from is recorded in plan_uplift_email and checked before sending. */
async function vpaFirePlanUpliftEmail(env, customerId) {
  const say = (why, extra) => vpaInsert(env, 'vp_admin_audit', {
    actor_admin: null, actor_label: 'stripe',
    action: 'plan_uplift_email',
    target: 'customer:' + String(customerId || ''),
    detail: Object.assign({ outcome: why }, extra || {}),
  }, false).catch(() => {});
  try {
    if (!customerId) return;
    const accts = await vpaSelect(env, 'venueplay_founding',
      'stripe_customer_id=eq.' + encodeURIComponent(customerId) + '&select=id,contact_email&limit=1');
    const acct = accts && accts[0];
    if (!acct) return;                       // not one of ours: nothing to say
    const venues = await vpaSelect(env, 'vp_venues',
      'founding_id=eq.' + encodeURIComponent(acct.id) + '&select=id,name&limit=50');
    if (!venues || !venues.length) return;
    const targets = venues.map((v) => 'venue:' + v.id);
    const since = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const rows = await vpaSelect(env, 'vp_admin_audit',
      'action=eq.plan_uplift_after_three_big_nights&created_at=gte.' + encodeURIComponent(since) +
      '&target=in.(' + targets.map(encodeURIComponent).join(',') + ')' +
      '&select=id,target,created_at,detail&order=created_at.desc&limit=1');
    const up = rows && rows[0];
    if (!up) return;                          // this event was some other quantity change
    // Already told them about THIS uplift? Then say nothing, however many times Stripe knocks.
    const done = await vpaSelect(env, 'vp_admin_audit',
      'action=eq.plan_uplift_email&select=id,detail&order=created_at.desc&limit=20');
    if ((done || []).some((d) => d && d.detail && d.detail.uplift_row === up.id)) return;

    const venue = venues.filter((v) => ('venue:' + v.id) === up.target)[0] || venues[0];
    const email = acct.contact_email;
    if (!email) { await say('not sent: the account has no contact email', { uplift_row: up.id }); return; }
    const d = up.detail || {};
    const nights = Array.isArray(d.nights) ? d.nights : [];
    const site = (env.SITE_URL || 'https://venueplay.com.au').replace(/\/+$/, '');
    const when = d.effective === 'pro_rata_now'
      ? 'It is charged pro rata to your renewal, on a separate invoice.'
      : 'It starts from your next invoice. Nothing extra is charged today.';
    const html =
        '<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;margin:0 auto;padding:28px 22px;color:#1a1a22">'
      + '<h1 style="font-size:20px;margin:0 0 14px">Your plan has moved up</h1>'
      + '<p style="font-size:15px;line-height:1.55;margin:0 0 16px">'
      + vpaEsc(venue.name || 'Your venue') + ' has been over its player limit on three nights in a row, '
      + 'so the plan has moved from <b>' + vpaEsc(String(d.from)) + '</b> to <b>' + vpaEsc(String(d.to)) + '</b> players'
      + (nights.length ? ' (' + vpaEsc(nights.join(', ')) + ' players on those nights)' : '') + '.</p>'
      + '<p style="font-size:15px;line-height:1.55;margin:0 0 16px">' + when + ' '
      + 'Tonight\'s extra players were charged at half the usual rate, because the plan moving up is what pays for it.</p>'
      + '<p style="font-size:15px;line-height:1.55;margin:0 0 16px">'
      + 'If that is not what you want, you can set your player limit back on your account page and the change '
      + 'takes effect at your next renewal.</p>'
      + '<p style="margin:22px 0"><a href="' + site + '/app/billing.html" '
      + 'style="background:#e6007e;color:#fff;text-decoration:none;padding:11px 18px;border-radius:9px;font-weight:600">'
      + 'See your plan</a></p>'
      + vpaVenueEmailFoot(true)
      + '</div>';
    const ok = await vpaSendEmail(env, email, 'Your VenuePlay plan has moved up',
      vpaVenueEmailCard((venue.name || 'Your venue') + ' moved from ' + d.from + ' to ' + d.to + ' players. Nothing extra is charged today.', html, 'Your VenuePlay plan has moved up'));
    await say(ok ? 'sent' : 'not sent: Resend refused it',
              { uplift_row: up.id, to: email, venue: venue.name || null,
                from_players: d.from, to_players: d.to, nights: nights, sent: !!ok });
  } catch (e) {
    await say('not sent: ' + String((e && e.message) || e).slice(0, 120));
  }
}

async function vpaFireInvoiceEmail(env, invoice) {
  /* THE RECEIPT WROTE NOTHING DOWN, SO NOBODY COULD SAY WHETHER IT WENT.
     Dean, 11 Sep 2026, after three real charges collected on a live card: "so the
     reciept was never sent to jess we just charged it? I thought you said everything
     worked". The honest answer was that I could not tell him. The failure path writes a
     payment_failed_email row with the recipient, the amount and Resend's id; the receipt
     path sent the mail and swallowed everything, including its own errors. Three payments
     took money and left no evidence a receipt existed either way.
     Every exit from here is now recorded, including the quiet ones: no Resend key, no
     email address on the customer, a zero-amount invoice. "It returned early" and "it
     sent" must never look the same from the outside. */
  const say = (why, extra) => vpaInsert(env, 'vp_admin_audit', {
    actor_admin: null, actor_label: 'stripe',
    action: 'invoice_receipt_email',
    target: 'customer:' + String((invoice && invoice.customer) || ''),
    detail: Object.assign({ invoice: (invoice && invoice.id) || null,
                            number: (invoice && invoice.number) || null,
                            outcome: why }, extra || {}),
  }, false).catch(() => {});
  try {
    if (!env.RESEND_API_KEY) { await say('not sent: no Resend key on this Worker'); return; }
    if (!invoice || Number(invoice.amount_paid || 0) <= 0) return;    // $0 trial invoice: no receipt is correct
    const email = invoice.customer_email;
    if (!email) { await say('not sent: the customer has no email address'); return; }
    const site = (env.SITE_URL || 'https://venueplay.com.au').replace(/\/+$/, '');
    const logo = site + '/logos/venueplay_primary_dark.png';
    const amount = '$' + (Number(invoice.amount_paid) / 100).toFixed(2);
    const ov = vpaOverageFromInvoice(invoice);
    const number = invoice.number ? String(invoice.number) : '';
    const view = invoice.hosted_invoice_url || '';
    const pdf = invoice.invoice_pdf || '';
    const btn = view || pdf;
    const html =
      '<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;padding:8px 0;color:#12101a">'
      + '<p style="font-size:17px;font-weight:700;margin:0 0 6px">Thanks for running your nights with VenuePlay.</p>'
      + '<p style="font-size:14px;color:#6a6a75;margin:0 0 20px">Your payment has gone through. Here is your invoice'
      + (number ? ' ' + vpaEsc(number) : '') + ', and exactly what it is for.</p>'
      + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #eee;border-radius:12px;margin-bottom:22px"><tr><td style="padding:18px 20px">'
      +   '<p style="margin:0;font-size:13px;color:#6a6a75">Amount paid</p>'
      +   '<p style="margin:2px 0 0;font-size:26px;font-weight:800;color:#12101a">' + amount + '</p>'
      +   (ov.nights > 0
            ? '<p style="margin:10px 0 0;padding-top:10px;border-top:1px solid #eee;font-size:13px;color:#6a6a75">Includes <b style="color:#12101a">' + ov.players + ' extra player' + (ov.players === 1 ? '' : 's') + '</b> over <b style="color:#12101a">' + ov.nights + ' big night' + (ov.nights === 1 ? '' : 's') + '</b> &middot; $' + (ov.cents / 100).toFixed(2) + ' at $2/head.</p>'
            : '')
      + '</td></tr></table>'
      + vpaInvoiceLinesHtml(invoice)
      /* `customer` did not exist here. It was written on 11 Sep 2026 at 05:34 (0d1f1fd),
         the only `customer` in the file is a const inside the UPCOMING-reminder function,
         and vpaUpliftWarningHtml's own parameter is called customerId. So this line threw
         a ReferenceError on every single receipt, the catch at the bottom swallowed it,
         and no receipt was sent at all while it was live.
         THE WINDOW IS THE DEPLOY, NOT THE COMMIT, and I got that wrong first time: the
         line was written at 05:34 but only reached the fleet with build 3e2fb4f7 at 10:21,
         and was fixed by build 61320367 at 22:47. Dean said "they sent this morning
         remember", and he was right: everything before 10:21 was fine. Three payments
         collected inside that window, all of tonight's overage runs, $5.00, no receipts.
         Nothing reported it because the receipt path wrote nothing down, which is the
         other half of this fix. The duplicate vpaUpliftNoticeHtml line arrived in the
         same commit and is gone too. */
      + vpaUpliftNoticeHtml(invoice)
      + (await vpaUpliftWarningHtml(env, invoice.customer))
      + vpaTaxSummaryHtml(invoice)
      + (ov.nights > 0 ? '<p style="font-size:13px;color:#6a6a75;margin:0 0 18px">Running over most weeks? A bigger plan usually works out cheaper than the per-night rate - adjust it anytime on your billing page.</p>' : '')
      + (btn ? '<a href="' + btn + '" style="display:inline-block;background:#FF1F8E;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;padding:11px 22px;border-radius:8px">View invoice</a>' : '')
      + (pdf ? ' <a href="' + pdf + '" style="display:inline-block;color:#12101a;text-decoration:none;font-size:14px;font-weight:700;border:1.5px solid #12101a;padding:9.5px 22px;border-radius:8px">Download PDF</a>' : '')
      + '<p style="font-size:13.5px;color:#12101a;margin:26px 0 0">We know a quiet Tuesday is worth as much as a packed Saturday, '
      + 'so thank you for backing us early. If there is anything you want the games to do that they do not, tell us.</p>'
      + '<p style="font-size:12.5px;color:#9a9aa4;margin:14px 0 0">Questions about your bill? Reply to this email or contact accounts@venueplay.com.au</p>'
      + vpaVenueEmailFoot(true)
      + '</div>';
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'VenuePlay <hello@send.venueplay.com.au>',
        reply_to: 'accounts@venueplay.com.au', // replies reach the real monitored inbox
        to: [email],
        subject: 'Your VenuePlay invoice' + (number ? ' ' + number : '') + ' - ' + amount,
        html: vpaVenueEmailCard('Paid ' + amount + '. Your tax invoice' + (number ? ' ' + number : '') + ' and what it covers are inside.', html, 'Your VenuePlay invoice'),
      }),
    });
    let resendId = null;
    try { const j = await res.json(); resendId = (j && j.id) || null; } catch (_) {}
    await say(res && res.ok ? 'sent' : 'not sent: Resend refused it',
              { to: email, amount: amount, sent: !!(res && res.ok), resend_id: resendId,
                status: (res && res.status) || null });
  } catch (e) {
    // Best effort still, but no longer silent: a receipt that threw is a receipt nobody got.
    await say('not sent: ' + String((e && e.message) || e).slice(0, 120));
  }
}

/* 5-day payment reminder, sent on Stripe's invoice.upcoming event (set the lead time to 5 days in
   Stripe billing settings). Respects the venue's payment_reminders opt-out. Best-effort. */
async function vpaFireUpcomingEmail(env, invoice) {
  /* WRITTEN DOWN, LIKE THE RECEIPT (audit 25 Sep 2026). This sent and swallowed everything, the
     same fault fixed on the receipt on 11 Sep: six invoice.upcoming events were handled and
     nothing shows whether one reminder went. Every exit is now a vp_admin_audit row, so "it
     returned early" and "it sent" never look the same from the outside. */
  const say = (why, extra) => vpaInsert(env, 'vp_admin_audit', {
    actor_admin: null, actor_label: 'stripe',
    action: 'invoice_upcoming_email',
    target: 'customer:' + String((invoice && invoice.customer) || ''),
    detail: Object.assign({ invoice: (invoice && invoice.id) || null, outcome: why }, extra || {}),
  }, false).catch(() => {});
  try {
    if (!env.RESEND_API_KEY) { await say('not sent: no Resend key on this Worker'); return; }
    if (!invoice) return;
    const email = invoice.customer_email;
    if (!email) { await say('not sent: the customer has no email address'); return; }
    const amountDue = Number(invoice.amount_due || 0);
    if (amountDue <= 0) { await say('not sent: $0 due (free month or credit)'); return; }
    const customer = invoice.customer;
    if (customer) {
      try {
        const accts = await vpaSelect(env, 'venueplay_founding',
          'stripe_customer_id=eq.' + encodeURIComponent(customer) + '&select=payment_reminders&limit=1');
        if (accts && accts[0] && accts[0].payment_reminders === false) { await say('not sent: the venue turned reminders off'); return; }
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
    const logo = site + '/logos/venueplay_primary_dark.png';
    const billing = site + '/app/billing.html';
    const html =
      '<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;padding:8px 0;color:#12101a">'
      + '<p style="font-size:17px;font-weight:700;margin:0 0 6px">A heads-up: your next payment is coming up.</p>'
      + '<p style="font-size:14px;color:#6a6a75;margin:0 0 20px">' + (when ? 'On ' + vpaEsc(when) + ' we\'ll charge' : 'Shortly we\'ll charge') + ' the card on file for your VenuePlay subscription.</p>'
      + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #eee;border-radius:12px;margin-bottom:22px"><tr><td style="padding:18px 20px">'
      +   '<p style="margin:0;font-size:13px;color:#6a6a75">Amount due</p>'
      +   '<p style="margin:2px 0 0;font-size:26px;font-weight:800;color:#12101a">' + amount + '</p>'
      +   (when ? '<p style="margin:6px 0 0;font-size:13px;color:#6a6a75">On ' + vpaEsc(when) + '</p>' : '')
      + '</td></tr></table>'
      + vpaInvoiceLinesHtml(invoice)
      + (ov.nights > 0
          ? '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fff6fb;border:1px solid #ffd0e6;border-radius:12px;margin-bottom:22px"><tr><td style="padding:16px 18px">'
            + '<p style="margin:0;font-size:14px;font-weight:700;color:#12101a">A busy month: this bill includes extra players.</p>'
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
      + '<p style="font-size:12.5px;color:#9a9aa4;margin:22px 0 0">Prefer not to get these? Turn payment reminders off on your billing page. Questions? Reply to this email or contact accounts@venueplay.com.au</p>'
      + vpaVenueEmailFoot(true)
      + '</div>';
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'VenuePlay <hello@send.venueplay.com.au>',
        reply_to: 'accounts@venueplay.com.au',
        to: [email],
        subject: 'Your VenuePlay payment is coming up' + (when ? ' - ' + when : '') + ' (' + amount + ')',
        html: vpaVenueEmailCard(amount + (when ? ' on ' + when : ' shortly') + '. Nothing to do unless you want to change your plan.', html, 'Your VenuePlay payment is coming up'),
      }),
    });
    let resendId = null;
    try { const j = await res.json(); resendId = (j && j.id) || null; } catch (_) {}
    await say(res && res.ok ? 'sent' : 'not sent: Resend refused it',
              { to: email, amount: amount, sent: !!(res && res.ok), resend_id: resendId,
                status: (res && res.status) || null });
  } catch (e) {
    await say('not sent: ' + String((e && e.message) || e).slice(0, 120));
  }
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
  /* cancel_at_period_end is selected because vpaEndAfterLastNight decides on it: a venue
     the owner cancelled keeps its last night, a venue whose subscription ended any other
     way does not. Without the column every venue reads as undefined, every one is treated
     as a chargeback, and the last night is taken off all of them. */
  const venues = await vpaSelect(env, 'vp_venues',
    'founding_id=eq.' + encodeURIComponent(acct.id)
    + '&select=id,name,status,suspended_reason,cancel_at_period_end,timezone');
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

/* A subscription has ended. Venues the owner deliberately cancelled are MARKED rather
   than switched off, and keep playing until 3am their own time; anything else is switched
   off now, exactly as before.

   The mark is status 'active' with suspended_reason 'ending'. Nothing else in either
   Worker reads suspended_reason without first checking status, and the only thing that
   stops a game is status === 'suspended', so a marked venue plays normally.

   IF venueplay-game IS NEVER PASTED, THESE VENUES PLAY ON. That is the risk this design
   carries and it is why the sweep at the other end closes anything marked whose local
   clock reads 3, 4 or 5, rather than 3 exactly: two missed cron runs still end the night
   on the right morning. */
async function vpaEndAfterLastNight(env, customerId) {
  try {
    const [venues, acct] = await vpaVenuesForCustomer(env, customerId);
    if (!venues || !venues.length) return;
    let marked = 0, off = 0;
    for (const v of venues) {
      if (v.status === 'suspended') continue;
      if (v.cancel_at_period_end) {
        await vpaPatch(env, 'vp_venues', 'id=eq.' + encodeURIComponent(v.id),
          { suspended_reason: 'ending' });
        marked++;
      } else {
        await vpaPatch(env, 'vp_venues', 'id=eq.' + encodeURIComponent(v.id),
          { status: 'suspended', suspended_reason: 'ended', closed_at: new Date().toISOString() });
        off++;
      }
    }
    if (marked || off) {
      await vpaInsert(env, 'vp_admin_audit', {
        action: 'venue_subscription_ended',
        target: 'account:' + (acct && acct.id),
        detail: { keeping_last_night: marked, switched_off_now: off, customer: customerId },
      }, false).catch(() => {});
    }
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
        { status: 'active', suspended_reason: null, closed_at: null });
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
async function vpaClearCreditOnEnd(env, customerId, eventId) {
  try {
    if (!customerId || !env.STRIPE_SECRET_KEY) return;
    const cust = await vpbStripeGet(env, 'customers/' + encodeURIComponent(customerId));
    const bal = cust && typeof cust.balance === 'number' ? cust.balance : 0;
    if (bal >= 0) return;                       // nothing owing to them
    /* KEYED ON THE STRIPE EVENT. Stripe RETRIES a webhook it does not get a clean answer
       to, and can deliver the same event more than once. A retry that arrives after the
       first one finished is already harmless, because the read above finds a zero balance
       and returns. A retry that arrives WHILE the first is still running is not: both read
       -$400, both post +$400, and the customer ends up $400 in the hole rather than at
       zero, so their next invoice is $400 over their normal rate. The event id is the same
       on every delivery of the same event, which is exactly the guarantee needed here. */
    await vpbStripePost(env, 'customers/' + encodeURIComponent(customerId) + '/balance_transactions', {
      amount: -bal, currency: 'aud',
      description: 'Credit closed with the subscription (VenuePlay terms: credit does not carry beyond the subscription)',
    }, 'credend:' + (eventId || (customerId + ':' + (-bal))));
    await vpaInsert(env, 'vp_admin_audit', {
      action: 'credit_cleared_on_subscription_end',
      target: 'customer:' + customerId,
      detail: { cleared_cents: -bal },
    }, false).catch(() => {});
  } catch (_) { /* never throw out of a webhook */ }
}

/* THE BANK'S ACTUAL ANSWER, in plain words. The email used to say "Nine times out of ten it
   is an expired card" whatever had happened; on 11 Sep 2026 a venue read that twice when the
   bank had said insufficient funds, and once when the fault was ours (no card on the invoice).
   Stripe's decline_code is the truth, so it is looked up and said. Anything unrecognised, or no
   code at all, says exactly that: this email goes to a paying venue and Dean's rule is that a
   guess is not acceptable in it ("it cant be wrong"). Returns { line, ours } where ours=true
   means the venue's card was never the problem and the email must not blame it. */
function vpaDeclineReason(code, message) {
  const c = String(code || '').toLowerCase();
  const m = String(message || '');
  const say = (line) => ({ line: line, ours: false });
  if (/insufficient_funds/.test(c)) return say('The bank said there were not enough funds available on the card.');
  if (/expired_card/.test(c)) return say('The card has expired.');
  if (/incorrect_cvc|invalid_cvc|incorrect_number|invalid_number|invalid_expiry/.test(c)) return say('The card details on file did not match what the bank has.');
  if (/lost_card|stolen_card|pickup_card|restricted_card|card_not_supported|currency_not_supported/.test(c)) return say('The bank would not accept this card. It may need a different one.');
  if (/authentication_required/.test(c)) return say('Your bank wants you to confirm this payment yourself.');
  if (/processing_error|try_again_later|issuer_not_available|reenter_transaction/.test(c)) return say('The bank had a processing problem. It may simply work next time.');
  if (/do_not_honor|generic_decline|call_issuer|card_declined|transaction_not_allowed|not_permitted|security_violation|service_not_allowed|revocation/.test(c)) return say('The bank declined it without giving a reason. Your bank can tell you why.');
  if (/default_payment_method|no payment method|payment method/i.test(m) || /resource_missing|missing/.test(c)) {
    return { line: 'We could not find a card to charge on your account. That is on our side to sort out, not yours.', ours: true };
  }
  return say('The bank did not say why. Your bank can tell you.');
}

/* The decline behind a failed invoice. An older API shape carries payment_intent on the
   invoice; the current one lists its payments, but ONLY when asked: the invoice.payment_failed
   webhook payload carries neither (checked live 11 Sep 2026, both Jess events), which is why the
   first two decline emails fell back to a guess. So when the payload has nothing, the invoice's
   payments are fetched from Stripe. The PaymentIntent's last_payment_error has the bank's code.
   Never throws; null when there is nothing to read. */
function vpaPaymentIntentOf(invoice) {
  if (!invoice) return null;
  let pi = typeof invoice.payment_intent === 'string' ? invoice.payment_intent : (invoice.payment_intent && invoice.payment_intent.id);
  const list = invoice.payments && invoice.payments.data;
  if (!pi && list && list.length) {
    const last = list[list.length - 1];
    const pay = last && last.payment;
    pi = pay && (typeof pay.payment_intent === 'string' ? pay.payment_intent : (pay.payment_intent && pay.payment_intent.id));
  }
  return pi || null;
}
async function vpaLookupDecline(env, invoice) {
  try {
    let pi = vpaPaymentIntentOf(invoice);
    if (!pi && invoice && invoice.id) {
      const full = await vpbStripeGet(env, 'invoices/' + encodeURIComponent(invoice.id) + '?expand[]=payments');
      if (full && !full.error) pi = vpaPaymentIntentOf(full);
    }
    if (!pi && invoice && invoice.id) {
      const pays = await vpbStripeGet(env, 'invoice_payments?invoice=' + encodeURIComponent(invoice.id) + '&limit=10');
      if (pays && !pays.error && pays.data && pays.data.length) pi = vpaPaymentIntentOf({ payments: pays });
    }
    if (!pi) return null;
    const intent = await vpbStripeGet(env, 'payment_intents/' + encodeURIComponent(pi) + '?expand[]=latest_charge');
    if (!intent || intent.error) return null;
    const err = intent.last_payment_error;
    if (err) return { code: err.decline_code || err.code || null, message: err.message || null };
    /* Voiding the invoice CANCELS its PaymentIntent, and Stripe clears last_payment_error on a
       cancelled intent (third live Jess run, 11 Sep 2026: status canceled, reason void_invoice,
       error null). The charge keeps the bank's answer for good: outcome.reason is the specific
       one (partner_insufficient_funds), failure_code the broad one. */
    const ch = intent.latest_charge && typeof intent.latest_charge === 'object' ? intent.latest_charge : null;
    if (ch && (ch.status === 'failed' || ch.failure_code || ch.failure_message)) {
      const outcome = ch.outcome || {};
      return { code: outcome.reason || ch.failure_code || outcome.type || null, message: ch.failure_message || outcome.seller_message || null };
    }
    return null;
  } catch (_) { return null; }
}

/* A subscription invoice says so in billing_reason (subscription_create, subscription_cycle,
   subscription_update...). Anything else is one of ours raised by hand: extra players. */
function vpaIsExtrasInvoice(invoice) {
  return !!invoice && !/^subscription/.test(String(invoice.billing_reason || ''));
}

/* Dean, 11 Sep 2026: "try once at least and notify them... it will come out on your next
   subscription invoice", then "let's just make the limit thirty dollars before we keep trying, and
   then that way we only try once, and then we just pick it up on the next invoice."
   So: the card has had its one try (that is the failed attempt that brought us here). Up to $30
   owed, the invoice is voided and its lines are re-added as pending items on the subscription, so
   they ride the next subscription invoice and the venue hears about it once. Over $30 the invoice
   stays OPEN for Stripe's retries and the pay-now button, because that money should not wait a
   month. Returns { moved, next, already, why }. Never throws. */
const VPA_EXTRAS_MOVE_MAX_CENTS = 3000;
async function vpaMoveExtrasToMonthly(env, inv) {
  const no = (why) => ({ moved: false, why: why });
  try {
    const owed = Number(inv && inv.amount_due) || 0;
    if (!inv || !inv.id || !inv.customer || owed <= 0) return no('nothing owed');
    // The same event delivered twice, or a retry on an invoice we already moved: read Stripe's
    // current status, not the copy in the event, and do nothing the second time.
    const fresh = await vpbStripeGet(env, 'invoices/' + encodeURIComponent(inv.id));
    if (fresh && !fresh.error && fresh.status !== 'open') return { moved: false, already: true, why: 'invoice is ' + fresh.status };
    const accts = await vpaSelect(env, 'venueplay_founding',
      'stripe_customer_id=eq.' + encodeURIComponent(inv.customer) + '&select=id,stripe_subscription_id&limit=1');
    const acct = accts && accts[0];
    if (!acct || !acct.stripe_subscription_id) return no('no subscription');
    const sub = await vpbStripeGet(env, 'subscriptions/' + encodeURIComponent(acct.stripe_subscription_id));
    if (!sub || sub.error || !/^(active|trialing|past_due)$/.test(String(sub.status))) return no('subscription not running');
    if (owed > VPA_EXTRAS_MOVE_MAX_CENTS) return no('over the $' + (VPA_EXTRAS_MOVE_MAX_CENTS / 100) + ' line (' + owed + ' cents), stays open to be chased now');
    // Re-add the lines as pending items ON THE SUBSCRIPTION, so they can only land on its next
    // invoice. Keyed on the failed invoice so a repeat cannot double them.
    let lines = ((inv.lines && inv.lines.data) || []).filter((l) => Number(l.amount) > 0);
    if (!lines.length) lines = [{ amount: owed, quantity: 1, description: 'Extra players' }];
    const made = [];
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      const qty = Math.max(1, Number(l.quantity) || 1);
      const item = await vpbStripePost(env, 'invoiceitems', {
        customer: inv.customer,
        subscription: acct.stripe_subscription_id,
        currency: inv.currency || 'aud',
        quantity: qty,
        unit_amount_decimal: String(Math.round(Number(l.amount) / qty)),
        description: String(l.description || 'Extra players').replace(/[<>&]/g, '').slice(0, 200),
      }, 'roll_' + inv.id + '_' + i);
      if (!item || item.error || !item.id) {
        for (const id of made) await vpbStripeDelete(env, 'invoiceitems/' + encodeURIComponent(id)).catch(() => {});
        return no('could not re-add line ' + i + ': ' + ((item && item.error && item.error.message) || 'no reply'));
      }
      made.push(item.id);
    }
    // Only now is the failed invoice voided. If the void fails the items come straight back off,
    // so the venue is never holding both the open invoice and the pending items.
    const gone = await vpbStripePost(env, 'invoices/' + encodeURIComponent(inv.id) + '/void', {}, 'void_' + inv.id);
    if (!gone || gone.error || gone.status !== 'void') {
      const msg = (gone && gone.error && gone.error.message) || 'no reply';
      if (!/already void/i.test(msg)) {
        for (const id of made) await vpbStripeDelete(env, 'invoiceitems/' + encodeURIComponent(id)).catch(() => {});
        return no('could not void: ' + msg);
      }
    }
    // Stripe moved the renewal date off the subscription and onto its items in the 2025 API
    // versions. Live proof on 11 Sep 2026 wrote next: null and the email went out with no date.
    const firstItem = sub.items && sub.items.data && sub.items.data[0];
    const periodEnd = sub.current_period_end || (firstItem && firstItem.current_period_end) || null;
    const next = periodEnd ? vpaFmtDate(periodEnd) : null;
    await vpaInsert(env, 'vp_admin_audit', {
      actor_admin: null, actor_label: 'stripe',
      action: 'extras_moved_to_monthly',
      target: 'account:' + acct.id,
      detail: { invoice: inv.id, amount_cents: owed, limit_cents: VPA_EXTRAS_MOVE_MAX_CENTS, items: made, next: next, customer: inv.customer },
    }, false).catch(() => {});
    return { moved: true, next: next, amount_cents: owed, items: made };
  } catch (e) {
    return no('crashed: ' + String((e && e.message) || e));
  }
}

/* A failed attempt is not an overdue invoice. Tell them and change nothing.
   moved: the answer from vpaMoveExtrasToMonthly when this is an extras invoice; absent for a
   subscription invoice. It changes what the venue is told to do, and whether there is a button. */
async function vpaFirePaymentFailedEmail(env, invoice, moved, declineKnown) {
  try {
    if (!env.RESEND_API_KEY || !invoice) return;
    const email = invoice.customer_email;
    if (!email) return;
    const decline = declineKnown || await vpaLookupDecline(env, invoice);
    const why = vpaDeclineReason(decline && decline.code, decline && decline.message);
    const amount = '$' + (Number(invoice.amount_due || 0) / 100).toFixed(2);
    /* SAY WHAT THE CHARGE WAS FOR. This read "for your VenuePlay subscription" on every failed
       invoice, and on 11 Sep 2026 a venue got it twice for $2.00 extra-player invoices while its
       subscription was paid up and fine. A subscription invoice says subscription; anything else
       names its line ("The Jolly Jess - Extra Player - 11/09/2026"). */
    const reason = String(invoice.billing_reason || '');
    const firstLine = invoice.lines && invoice.lines.data && invoice.lines.data[0];
    const what = /^subscription/.test(reason) || !firstLine || !firstLine.description
      ? 'your VenuePlay subscription'
      : String(firstLine.description).replace(/[<>&]/g, '').slice(0, 80);
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
      + '<p style="font-size:17px;font-weight:700;margin:0 0 6px">' + (why.ours ? 'A payment did not go through.' : 'Your card did not go through.') + '</p>'
      + '<p style="font-size:14px;color:#6a6a75;margin:0 0 20px">We tried to charge ' + amount + ' for ' + what + (why.ours ? '. ' : ' and it was declined. ') + why.line + '</p>'
      + vpaPaymentFailedNextStep(moved, payNow, billing)
      + '<p style="font-size:12.5px;color:#9a9aa4;margin:22px 0 0">Questions? Reply to this email or contact accounts@venueplay.com.au</p>'
      + vpaVenueEmailFoot(false)
      + '</div>';
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'VenuePlay <hello@send.venueplay.com.au>',
        reply_to: 'accounts@venueplay.com.au',
        to: [email],
        subject: 'Your VenuePlay payment did not go through',
        html: vpaVenueEmailCard('We could not charge ' + amount + '. Your games are running as normal. Here is what happens next.', html, 'Your VenuePlay payment did not go through'),
      }),
    });
    /* RECORD WHAT WAS SAID. Nobody here can read Resend's outbox, and on 11 Sep 2026 this email
       went out to a venue with its date placeholder empty and nothing but the venue's inbox knew.
       Every value that was filled into the email is written down, so a live run can check the
       placeholders against the row instead of asking the customer what they received. */
    let resendId = null;
    try { const j = await res.json(); resendId = (j && j.id) || null; } catch (_) {}
    await vpaInsert(env, 'vp_admin_audit', {
      actor_admin: null, actor_label: 'stripe',
      action: 'payment_failed_email',
      target: 'customer:' + String(invoice.customer || ''),
      detail: {
        to: email, invoice: invoice.id || null, amount: amount, what: what,
        reason_code: (decline && decline.code) || null, reason_line: why.line, ours: !!why.ours,
        outcome: moved ? (moved.moved ? 'moved to next invoice' : 'stays open') : 'subscription',
        next: (moved && moved.next) || null, sent: res.ok, resend_id: resendId,
      },
    }, false).catch(() => {});
  } catch (_) { /* best-effort */ }
}

/* The middle of the declined-card email: what happens next, and whether there is anything to do.
   Three cases. A subscription invoice: Stripe retries and the games pause if it keeps failing, so
   there is a pay-now button. Extras that MOVED onto the monthly bill: nothing to do, no button (the
   invoice is void, its pay link is dead). Extras that stayed open: Stripe retries, pay-now button,
   and no talk of games pausing because extras never pause anything. */
function vpaPaymentFailedNextStep(moved, payNow, billing) {
  const p = (t) => '<p style="font-size:14px;color:#3a3a44;margin:0 0 20px">' + t + '</p>';
  const btn = '<a href="' + payNow + '" style="display:inline-block;background:#FF1F8E;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;padding:11px 22px;border-radius:8px">Pay now with a new card</a>'
    + '<p style="font-size:12.5px;color:#9a9aa4;margin:14px 0 0">No sign in needed, it takes a minute. You can also do it from <a href="' + billing + '" style="color:#FF1F8E">your account page</a>.</p>';
  if (moved && moved.moved) {
    return p('Nothing to do. It will come out with your next subscription payment' + (moved.next ? ' on ' + vpaEsc(moved.next) : '') + ' instead, and your games are running as normal.')
      + '<p style="font-size:12.5px;color:#9a9aa4;margin:14px 0 0">If the card itself needs updating you can do that any time from <a href="' + billing + '" style="color:#FF1F8E">your account page</a>.</p>';
  }
  if (moved) {
    return p('Nothing has changed at your venue and your games are running as normal. We will try the card again over the next few days, or you can settle it now.') + btn;
  }
  return p('Nothing has changed at your venue and your games are running as normal. We will try again over the next few days. If it keeps failing your games will pause until it is sorted, so it is worth a minute now.') + btn;
}

/* THE SAME esc AS EVERYWHERE ELSE, including the single quote.

   This one was missing `'` from its character class while the other twenty-three copies in
   the repo have it, and the rename from esc to vpaEsc is what let it drift: the gate holds
   every function CALLED esc identical and this one is not called esc, so nothing compared it.
   Found 12 Sep 2026 by mapping where each shared answer lives.

   Not exploitable today, and I looked: nothing here builds a single-quoted HTML attribute.
   That is a weak reason to leave it, and this repo has the scar to prove it. The next admin
   page or email that writes id='...' makes it one, and whoever writes that line will read the
   name, see "esc", and reasonably assume it escapes quotes. */
function vpaEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
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
    '&select=id,name,founding_id,group_id,max_players,pending_players,status,slug,cancel_at_period_end,suspended_reason,timezone,created_at,postcode');
  if (!venues || !venues.length) return { error: 'No venues found.', status: 403 };

  /* WHICH ACCOUNT. A login with venues on two accounts (a publican who signed up two pubs
     separately, or our own test logins) used to be handed the account with the lowest
     founding id on every call, silently, with the other account unreachable from the page.
     Found by the audit of 20 Sep 2026. A staff member may now name a venue THEY HOLD in
     X-VP-Venue and get that venue's account; a venue they do not hold changes nothing, so
     this is no wider than their own staff rows. With no header the old order stands, and
     the other accounts are listed so the page can offer the switch. */
  let chosen = venues[0];
  if (!viewingAs && isUuid.test(target)) {
    const held = venues.find((v) => v.id === target);
    if (held) chosen = held;
  }
  const foundingId = chosen.founding_id;
  const otherAccounts = [];
  venues.forEach((v) => {
    if (v.founding_id === foundingId) return;
    let a = otherAccounts.find((x) => x.founding_id === v.founding_id);
    if (!a) { a = { founding_id: v.founding_id, venue_id: v.id, venues: [] }; otherAccounts.push(a); }
    a.venues.push(v.name);
  });
  const accounts = await vpaSelect(env, 'venueplay_founding',
    'id=eq.' + encodeURIComponent(foundingId) +
    '&select=id,plan,is_group,payment_reminders,stripe_subscription_id,stripe_customer_id,contact_email,status');
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
      '&select=id,name,founding_id,group_id,max_players,pending_players,status,slug,cancel_at_period_end,suspended_reason,timezone,created_at,postcode');
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
      /* SCOPED TO THIS ACCOUNT'S VENUES, which it never was. This query had NO venue filter at
         all: it read every staff row the person holds anywhere and took the first one that
         happened to carry a permissions object. A travelling host or a duty manager who works
         at venues on two DIFFERENT accounts got one account's restrictions applied to the
         other, in whichever order Postgres returned the rows. That is the venue-isolation rule
         broken from the inside, and it could fall either way: silently losing buttons on an
         account where they were trusted, or keeping access on one where somebody had
         deliberately taken it away.

         THE MOST RESTRICTIVE ROW WINS, not the first one found. Within one account a person can
         be a manager at two venues with different ticks, and a single perms object has to stand
         for the whole call. Refusing wherever any row refuses is the only safe way to collapse
         that: the worst case is a manager who has to ask, rather than one who quietly has a
         venue's customer list because of how a query sorted. */
      const scopeIds = accountVenues.map((v) => v.id);
      /* vpaSelectAll, because it THROWS. vpaSelect answers [] on any non-2xx, an empty result
         left perms null, and null perms read as the account owner everywhere. So a single 429
         on this one read turned a manager with billing:false into somebody who could change
         billing and add hosts. CLAUDE.md already names the trap: never build on a read that
         fails open. */
      const pr = scopeIds.length ? await vpaSelectAll(env, 'vp_venue_staff',
        'auth_user_id=eq.' + encodeURIComponent(authUserId) +
        '&venue_id=in.(' + scopeIds.map(encodeURIComponent).join(',') + ')' +
        '&role=in.(manager,owner)&select=permissions&order=venue_id.asc') : [];
      for (const row of (pr || [])) {
        if (!row || !row.permissions) continue;
        if (!perms) { perms = Object.assign({}, row.permissions); continue; }
        // false wins, on every key either row mentions.
        for (const k in row.permissions) {
          if (row.permissions[k] === false) perms[k] = false;
          else if (!(k in perms)) perms[k] = row.permissions[k];
        }
      }
    } catch (_) {
      /* FAIL CLOSED. This used to swallow the error with the note "permissions column not
         present yet". The column has been live for weeks, and what the swallow actually did
         was hand full owner access to anyone whose permissions could not be read. Not knowing
         what somebody may do is a reason to ask them to try again, never a reason to let
         them do everything. */
      return { error: 'We could not check your access just now. Please try again in a moment.', status: 503 };
    }
  }

  /* WHICH ROLE THEY ACTUALLY HOLD, not merely that they hold one. vpbRequireOwner accepts a
     staff row of manager OR owner, and vpbCan treats a null permissions object as full access.
     21 of the 22 staff rows have no permissions object, so every one of the 17 managers was
     passing every owner-level check, including the player contact export. Callers that mean
     "the person who set this venue up" need to be able to say so.
     Found 17 Sep 2026 when Dean asked for the export to be owner-only and I checked who that
     currently meant. */
  const myRole = (staff || []).some((x) => x.role === 'owner') ? 'owner'
               : ((staff || []).length ? 'manager' : null);
  return { authUserId: authUserId, account: account, venues: accountVenues, adminActor: adminActor,
           perms: perms, role: myRole, actingAsAdmin: actingAsAdmin, otherAccounts: otherAccounts };
}

// Full-access (account owner or legacy staff) vs a restricted manager, and per-toggle checks.
function vpbIsOwner(o) { return !o.perms; }
function vpbCan(o, key) { return !o.perms || o.perms[key] !== false; }
function vpbOwnerOnly(o, json) { return o.perms ? json({ error: 'Only the account owner can do that.' }, 403) : null; }

// Audit fields for an owner-side action: the acting admin if one is behind it, else the owner.
function vpbActorFields(o) {
  return o.adminActor
    ? { actor_admin: o.adminActor.id, actor_label: o.adminActor.label }
    : { actor_admin: null, actor_label: (o.role === 'marketing' ? 'marketing' : 'owner') };
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
  // The Stripe portal shows every invoice and changes the card: owner-only, like every other money route.
  { const g = vpbOwnerOnly(o, json); if (g) return g; }
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
  /* THE DISCOUNT WAS ON THE SUBSCRIPTION ALL ALONG AND THIS NEVER READ IT.

     A venue with a coupon was shown players x rate, the full price, on the one screen it
     trusts. Stripe charged the discounted amount correctly, because the coupon lives on the
     subscription; the page simply did not know. Wellshot Hotel has 33.3% off as the first
     venue to sign up and its billing page read $50.00 against a real charge nearer $33.35,
     and five venues on 100% discounts were shown a full price bill they will never pay.

     Nothing extra is fetched: vpbSubItem already expands discounts, because the REMOVAL
     path needs the coupon id. The number was sitting there.

     Found by Dean looking at a venue's screen, not by any check in this repo. */
  const disc = (info && info.sub && ((info.sub.discounts && info.sub.discounts.length && info.sub.discounts[0])
                                     || info.sub.discount)) || null;
  const coupon = (disc && disc.coupon) || null;
  const pctOff = coupon && typeof coupon.percent_off === 'number' ? coupon.percent_off : null;
  const amtOff = coupon && typeof coupon.amount_off === 'number' ? coupon.amount_off : null;   // cents
  function afterDiscount(dollars) {
    if (pctOff != null) return Math.max(0, dollars * (1 - pctOff / 100));
    if (amtOff != null) return Math.max(0, dollars - amtOff / 100);
    return dollars;
  }

  /* WHAT THEY ARE ACTUALLY BEING CHARGED, ASKED OF STRIPE.
     Dean, 11 Sep 2026: "Jess says shes got 3 players this month, 2 next month so the
     numbers havent rolled over in their account."

     Her account held two venues: the-jolly-jess on 2 players, and not-jess, SUSPENDED and
     already set to cancel at period end, on 1. This line summed both and told her 3 players
     and $7.50 a month. Stripe's subscription quantity was 2, so she was being charged $5.00.
     The page was the only number in the whole product that counted a cancelling venue:
     accountBilledTotal in the game Worker skips them, and so does billedPlayers three lines
     below. Two definitions of "how many players are you paying for", and the customer-facing
     one was the odd one out, by $2.50 a month.

     So stop deriving this month's bill from our own table when Stripe holds the answer. The
     subscription's quantity IS the number being charged, and using it makes the page agree
     with the invoice by construction rather than by us keeping two sums in step.
     The local sum stays as the fallback for an account with no subscription item yet (a
     trialing or comped venue), and it is now computed the same way as everything else:
     cancelling venues do not count. */
  const localPlayers = venues.reduce((n, v) => v.cancelling ? n : n + v.players, 0);
  const stripeQty = info && Number.isFinite(Number(info.quantity)) ? Number(info.quantity) : null;
  /* EXCEPT AFTER A MONTHLY REDUCTION. The decrease path lowers the Stripe quantity at once
     (so the NEXT invoice is right) while capacity holds until renewal, so for the rest of
     this cycle Stripe's quantity is next month's number, not this month's. The page said
     "this month: 60 players, $150" to a venue that had paid for 80 and still had 80 (audit,
     20 Sep 2026). While a monthly reduction is pending, this month is what they hold. */
  const pendingReduction = o.account.plan !== 'annual'
    && venues.some((v) => !v.cancelling && v.pending != null && v.pending < v.players);
  const totalPlayers = (stripeQty != null && stripeQty > 0 && !pendingReduction) ? stripeQty : localPlayers;
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

  /* Is the card still good? Stripe emails the owner on a failed payment and the venue is
     suspended after repeat failures, but this page kept showing a normal "Next payment" tile
     the whole time. The subscription status is the one honest answer, and when it says the
     last payment failed we also fetch that invoice so the page can name the date and amount. */
  const sub = info && info.sub;
  const subStatus = (sub && !sub.error && sub.status) || null;
  const pastDue = subStatus === 'past_due' || subStatus === 'unpaid';
  let failed = null;
  if (pastDue) {
    try {
      const invId = sub.latest_invoice && (typeof sub.latest_invoice === 'string' ? sub.latest_invoice : sub.latest_invoice.id);
      const inv = invId ? await vpbStripeGet(env, 'invoices/' + encodeURIComponent(invId)) : null;
      if (inv && !inv.error) {
        failed = {
          date: inv.created ? vpaFmtDate(inv.created) : null,
          amount: typeof inv.amount_due === 'number' ? '$' + (inv.amount_due / 100).toFixed(2) : null,
          pay_url: inv.hosted_invoice_url || null,
        };
      }
    } catch (e) { failed = null; }   // the notice still shows without the detail
  }

  return json({
    ok: true,
    plan: o.account.plan,
    /* founding or standard: which price the account is locked to. Shown as a Plan tile so the
       owner can see their rate and why it is what it is in one glance. Unknown price (no
       subscription yet) reads as founding, the same way the rate above does. */
    tier: (!priceId || vpbIsFoundingPrice(env, priceId)) ? 'founding' : 'standard',
    sub_status: subStatus,
    past_due: pastDue,
    failed_payment: failed,
    is_group: o.account.is_group,
    rate: rate,
    venues: venues,
    /* The login's venues on OTHER accounts, if any: one venue id per account is enough for
       the page to switch by naming it in X-VP-Venue. Empty for nearly everyone. */
    other_accounts: (o.otherAccounts || []).map((a) => ({ venue_id: a.venue_id, venues: a.venues })),
    total_players: totalPlayers,
    /* BOTH figures are what the venue will actually pay. The full price is sent alongside so
       the page can show the saving rather than silently quoting a smaller number. */
    monthly_total: '$' + afterDiscount(totalPlayers * rate).toFixed(2),
    monthly_total_before_discount: '$' + (totalPlayers * rate).toFixed(2),
    discount: coupon ? {
      percent_off: pctOff,
      amount_off_cents: amtOff,
      name: coupon.name || null,
      label: pctOff != null ? (String(pctOff).replace(/\.0$/, '') + '% off')
                            : ('$' + ((amtOff || 0) / 100).toFixed(2) + ' off'),
    } : null,
    billing_period: annual ? 'year' : 'month',
    next_charge: info && info.periodEnd ? vpaFmtDate(info.periodEnd) : null,
    next_charge_amount: '$' + afterDiscount(chargeAmount).toFixed(2),
    next_charge_before_discount: '$' + chargeAmount.toFixed(2),
    card_last4: (info && info.last4) || null,
    card_brand: (info && info.brand) || null,
    credit_cents: creditCents,
    credit: '$' + (creditCents / 100).toFixed(2),
    payment_reminders: o.account.payment_reminders !== false,
    /* A comp account has no subscription and never will, and an HQ-onboarded venue has not added
       a card yet. Both were being shown a monthly total and a next payment date as if they were
       ordinary paying venues, which is the one thing a billing page must never get wrong. */
    comp: o.account.status === 'comp',
    has_subscription: !!o.account.stripe_subscription_id,
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
/* dryRun QUOTES the charge and posts nothing.

   The billing page needs the real figure BEFORE it charges. Its only price
   sentence read "Extra players are charged a full month at $2.30 per player",
   which is right for monthly and wrong by a factor of twelve for annual, where the
   charge is delta x rate x 12 x the fraction of the year left. Adding 50 players
   to an annual account with ten months to run is $1,149.95 against the $115 the
   page implied, taken on one click with no confirmation and no amount anywhere.
   The DECREASE path already returns credit_cents and billing.html prints the
   dollars; the charge named nothing. Found by audit 5 Sep 2026. */
async function vpbAdjustPlayerBilling(env, info, delta, planName, label, idemTag, dryRun) {
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
      if (dryRun) return { kind: 'quote', cents: cents };
      /* QUANTITY x UNIT PRICE, AND THE DATE. Same reason as the big-night line in the
         game Worker: a bookkeeper should see 3 x $2.50 against a named venue and a date,
         not one lump with the count buried in a sentence. `cents` was already
         round(rate x 100) x n, so the unit divides evenly and the total is unchanged.
         unit_amount_decimal, NOT unit_amount: an invoice item has no top-level unit_amount and
         Stripe refuses the whole item ("Received unknown parameter"). Found live on 11 Sep 2026
         in the game Worker's twin of this line; the first real overage night was not billed. */
      const mRes = await vpbStripePost(env, 'invoiceitems', {
        customer: customer, currency: 'aud',
        quantity: n, unit_amount_decimal: String(Math.round(rate * 100)),
        /* Australian order, and Brisbane rather than UTC: a change made after 10pm here
           is already tomorrow in UTC, and the venue would be looking at a date it did
           nothing on. Same +10h shift vpaFmtDate uses. */
        description: (label || 'Venue') + ' - Extra Player - ' +
                     new Date(Date.now() + 36000000).toISOString().slice(0, 10).split('-').reverse().join('/'),
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
      if (dryRun) return { kind: 'quote', cents: cents };
      const aRes = await vpbStripePost(env, 'invoiceitems', {
        customer: customer, amount: cents, currency: 'aud',
        description: who + players + ' added, pro rata to renewal (' + months + ' months)',
      }, idemTag ? ('padd:' + idemTag) : null);
      if (aRes && aRes.error) { console.log('[billing] annual pro rata FAILED: ' + (aRes.error.message || '')); return { kind: 'failed', cents: cents }; }
      return { kind: 'charge', cents: cents, months: months };
    }
    // Negative balance on a Stripe customer IS a credit; it is consumed by the next invoice.
    /* KEYED, like the two charges above it. This call had three arguments and
       no key, while both charge paths in this same function pass one, and this
       function's own header says to key anything that MOVES MONEY.

       Two tabs on the billing page - or an owner and an HQ admin on View as -
       pressing Save on the same reduction inside the second it takes to read
       the account both see the same current count, both compute the same delta,
       and both bank the credit. The later restore is keyed, so it charges once
       and the second credit is kept. On an annual account releasing 50 players
       that is four figures given away, silently. */
    const cRes = await vpbStripePost(env, 'customers/' + encodeURIComponent(customer) + '/balance_transactions', {
      amount: -cents, currency: 'aud',
      description: who + players + ' released, credit carried to your next renewal (' + months + ' months)',
    }, idemTag ? ('prel:' + idemTag) : null);
    if (cRes && cRes.error) { console.log('[billing] credit FAILED: ' + (cRes.error.message || '')); return { kind: 'failed', cents: cents }; }
    return { kind: 'credit', cents: cents, months: months };
  } catch (_) { return null; /* the quantity change still governs ongoing billing */ }
}

async function vpbSetPlayers(request, env, json) {
  const o = await vpbRequireOwner(request, env);
  if (o.error) return json({ error: o.error }, o.status);
  { const g = vpbOwnerOnly(o, json); if (g) return g; }   // billing is owner-only

  const _b = await vpaBody(request, json);
  if (!_b.ok) return _b.res;
  const b = _b.body;
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
  /* PREVIEW: what would this cost? Quotes and writes nothing.
     The page cannot state the figure otherwise, and it must, because for an annual
     account the charge is twelve times the only price sentence on screen. Putting
     the arithmetic in the page instead would be a second copy of the pricing, which
     is how the two founding gates came to disagree. */
  const previewOnly = b.preview === true;

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
      venueId + ':restore' + (current - basis) + ':' + current + ':' + (rinfo.periodEnd || '0')) : null;
    await vpaInsert(env, 'vp_admin_audit', {
      ...vpbActorFields(o), action: 'players_reduction_cancelled',
      target: 'venue:' + venueId, detail: { players: current, from_billed: billedNow, billing: rAdj, actor_user: o.authUserId },
    }, false).catch(() => {});
    return json({ ok: true, applied: 'cancelled_reduction', players: current });
  }

  if (players > current) {
    /* A PREVIEW MUST NOT CHANGE ANYTHING, AND THIS ONE CHANGED TWO THINGS.
       The preview branch used to sit AFTER the capacity patch and after the Stripe quantity
       was raised, and billing.html calls this with preview:true purely to fill in the numbers
       on a confirm() dialog. So merely opening that dialog permanently raised the venue's
       capacity and their recurring Stripe quantity, and wiped any scheduled reduction.
         - press Cancel, and they are billed for players they just declined
         - press OK, and the real call now sees players === current, returns unchanged, and the
           one-off top-up invoice item is never raised: free capacity, and on annual a skipped
           pro-rata for the rest of the year
       Quote first, write second. vpbSubItem only reads. Found by audit, 17 Sep 2026. */
    const pinfo = await vpbSubItem(env, o.account.stripe_subscription_id);
    if (!pinfo || !pinfo.itemId) {
      return json({ error: 'Could not reach billing just now. Please try again.' }, 502);
    }
    if (previewOnly) {
      const q = await vpbAdjustPlayerBilling(env, pinfo, players - basis, o.account.plan, venue.name,
        null, true);
      return json({ ok: true, preview: true, players: players, from: current,
                    charge_cents: (q && q.cents) || 0, plan: o.account.plan });
    }
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

    /* THE KEY DESCRIBES THE MOVE, NOT THE DESTINATION. It used to be
       venueId:players:periodEnd, which omits direction and size, so 100 -> 50 ->
       100 -> 50 inside Stripe's 24 hour idempotency window reused the first
       decrease's key and the second credit never happened: the venue ended on 50
       players having paid a full year for capacity it gave back. Reverse it and
       the venue ends on 150 having paid nothing. Including the delta and the
       direction makes each move its own event. Found by audit 5 Sep 2026. */
    const iAdj = await vpbAdjustPlayerBilling(env, info, players - basis, o.account.plan, venue.name,
      venueId + ':up' + (players - basis) + ':' + players + ':' + (info.periodEnd || '0'));
    await vpaInsert(env, 'vp_admin_audit', {
      ...vpbActorFields(o), action: 'players_increased',
      target: 'venue:' + venueId, detail: { from: current, to: players, from_billed: billedNow, new_total: newTotal, billing: iAdj, actor_user: o.authUserId },
    }, false).catch(() => {});
    return json({ ok: true, applied: 'now', players: players,
                  // Name the money. The page could not tell the venue what it had
                  // just been charged, only that something would appear later.
                  charge_cents: (iAdj && iAdj.cents) || 0,
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
    venueId + ':down' + (basis - players) + ':' + players + ':' + (dinfo.periodEnd || '0')) : null;
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

/* The Stripe idempotency tag for a new venue's setup charge. Its own function so the gate can
   run it: two different venues must never share a tag, and one venue retried must keep its own. */
function vpbNewVenueTag(venueId, players, periodEnd) {
  return 'newvenue:' + String(venueId || '') + ':' + players + ':' + (periodEnd || '0');
}

/* --- POST /account/add-venue : add a whole new venue to the account. --- */
async function vpbAddVenue(request, env, json) {
  const o = await vpbRequireOwner(request, env);
  if (o.error) return json({ error: o.error }, o.status);
  { const g = vpbOwnerOnly(o, json); if (g) return g; }   // adding venues is owner-only

  const _b = await vpaBody(request, json);
  if (!_b.ok) return _b.res;
  const b = _b.body;
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

  const postcode = (b.postcode || '').replace(/\D/g, '').slice(0, 4);

  /* SAME NAME IS NOT THE SAME VENUE, AND A CANCELLED VENUE HAS TO BE ABLE TO COME BACK.
     Dean, 17 Sep 2026, on the free month: "then they arent cancelling a venue and readding it
     right."

     Both halves of that were broken, and the second one badly. vpaProvisionOneVenue matches on
     founding_id + name with NO status filter, and this route turned any non-creation into a flat
     409, so:

       - a group with The Royal Hotel in two towns could not add the second one and was told to
         invent a name for their own pub. Seven percent of Australian venue names are shared and
         there are about a hundred Royal Hotels, so this is not exotic, and the slug allocator has
         separated same-named venues by postcode since August.
       - a group that CANCELLED one venue could never add it back. The row is not deleted, it is
         left status 'suspended', so the name still matched and they got the same "use a different
         name". The only way back was to make one up, which is how "Royal Hotel 2" ends up on a
         telly in a pub. A customer trying to give us money again is the last person to refuse.

     So the POSTCODE decides whether it is the same venue, exactly as the slug already does, and a
     venue that is merely switched off gets switched back on rather than refused.

     WHAT IS STILL REFUSED, and why. 'nonpayment' is the one suspension that money reverses and
     nothing else may: the subscription.updated handler says plainly that no quantity write is
     allowed to turn games back on, because a venue could otherwise be switched back on by nudging
     its player count without a cent being paid, and this route would be exactly that nudge.
     'manual' is HQ switching a venue off on purpose, so it is not the venue's to undo either. */
  const sameName = await vpaSelect(env, 'vp_venues',
    'founding_id=eq.' + encodeURIComponent(foundingId) + '&name=eq.' + encodeURIComponent(name)
    + '&select=id,name,slug,status,suspended_reason,cancel_at_period_end,postcode,max_players');
  /* A blank postcode on either side cannot tell two venues apart, so it counts as the same venue.
     That is the conservative way round: refusing an add they can retry with a postcode is a
     nuisance, while creating a second copy of a LIVE venue splits its players and its bill. */
  const twin = (sameName || []).filter(function (v) {
    return !v.postcode || !postcode || String(v.postcode) === postcode;
  })[0] || null;

  const LOCKED_OFF = {
    nonpayment: 'That venue is switched off because a payment did not go through. Sort the payment out on this page and it comes back on by itself.',
    manual: 'That venue was switched off by us. Email hello@venueplay.com.au and we will get it back on for you.',
  };
  if (twin && twin.status === 'suspended' && LOCKED_OFF[twin.suspended_reason || '']) {
    return json({ error: LOCKED_OFF[twin.suspended_reason] }, 409);
  }
  // Switched off, or on its way off at the end of the paid period. Either way it can come back.
  const reviving = !!twin && (twin.status === 'suspended' || !!twin.cancel_at_period_end);
  if (twin && !reviving) {
    return json({ error: 'You already have a venue called ' + name + ' at that postcode. If this is a different pub, put its own postcode in. If it is the same one, change its max players on the list above instead.' }, 409);
  }

  let r;
  if (reviving) {
    await vpaPatch(env, 'vp_venues', 'id=eq.' + encodeURIComponent(twin.id), {
      status: 'active',
      suspended_reason: null,
      // Back on, so the 90-day retention clock stops. A venue that returns must not have its
      // player list deleted out from under it because of a closure it has since undone.
      closed_at: null,
      // They are asking for it back, so the cancellation is off. vpbAccountTotal excludes a venue
      // flagged cancel_at_period_end, so leaving it set would bill for a venue nobody counted.
      cancel_at_period_end: false,
      max_players: players,
      // A pending reduction belongs to a subscription they have now un-cancelled, and applying it
      // later would silently drop the number they just typed in.
      pending_players: null,
      postcode: postcode || twin.postcode || null,
    });
    r = { created: false, revived: true, venue: { id: twin.id, name: name, slug: twin.slug } };
  } else {
    // Provision the new venue under the same account + owner login. forceNew only when a
    // same-named venue exists at a DIFFERENT postcode, which the block above has just established.
    r = await vpaProvisionOneVenue(env, {
      foundingId: foundingId, groupId: null, name: name, seats: players, postcode: postcode,
      authUserId: o.authUserId, forceNew: !!(sameName && sameName.length),
    });
    if (!r || !r.created) {
      // Nothing was added, and there is no name clash left to explain it, so do not invent one.
      return json({ error: 'Could not add that venue just now. Nothing was charged. Please try again, and if it keeps happening email hello@venueplay.com.au.' }, 500);
    }
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
  /* THE KEY NAMES THE VENUE, NOT WHAT IT IS CALLED. It used to be built from the name, the
     player count and the renewal date, and there are a hundred Royal Hotels. A group adding two
     of them on one day, same size, made the same key twice, so Stripe replayed the first
     venue's charge from its cache and the second venue's charge never existed, while its free
     month credit (keyed on the venue id all along) was banked anyway. $250 out the door with no
     error anywhere. Found by audit, 20 Sep 2026. The id is what makes a venue itself. */
  /* A VENUE ONLY FLAGGED TO CANCEL IS STILL PAID FOR. It stays active to the end of the period its
     players were billed for, so bringing it back through Add a venue charges only the players ABOVE
     what it already paid for this period. It used to charge them all again, pro rata, while "Keep
     this venue" charged nothing for the identical outcome (audit 20 Sep, confirmed again 25 Sep
     2026). A venue that was switched OFF (suspended) was not paid for this period and is charged in
     full, as before. The subscription quantity above still counts every player, so the renewal is
     right either way. */
  const alreadyPaid = (reviving && twin.status !== 'suspended' && twin.cancel_at_period_end)
    ? Math.max(0, parseInt(twin.max_players, 10) || 0) : 0;
  const chargePlayers = Math.max(0, players - alreadyPaid);
  const aAdj = (billingOk && chargePlayers > 0) ? await vpbAdjustPlayerBilling(env, info, chargePlayers, o.account.plan, name,
    vpbNewVenueTag(r.venue && r.venue.id, chargePlayers, info.periodEnd)) : null;

  /* THE NEW VENUE GETS ITS FIRST MONTH FREE, the same month a venue that signs up on its own
     gets. Dean, 17 Sep 2026: "if I sign up as a group and then I add another venue but I'm now
     paying because my trial was over that venue should still get a month free right?"

     Until now it did not. A venue added while the account was inside its OWN free month rode
     that month for nothing, because vpbAdjustPlayerBilling returns null while the subscription
     is 'trialing'. A venue added by a PAYING account was charged a full month the instant the
     owner clicked Add. So the one thing we most want a group to do, put us in the rest of their
     pubs, cost them money on the day they decided to do it, and the new room's staff never got
     the trial the first room got. The owner has proven the product. That pub has not: different
     staff, different telly, different Wi-Fi, different crowd.

     WHY A CREDIT AND NOT A TRIAL. trial_end is a property of the SUBSCRIPTION, and one
     subscription covers every venue on the account. Trialling the new venue would stop billing
     the venues already being paid for. A customer balance credit is per-account money the next
     invoice consumes, and it prints on their invoice with the reason on it.

     ONE MONTH AT THEIR RATE, and it works out the same on both plans. Monthly: the charge above
     billed exactly one month, this hands it back, and their next renewal bills the venue
     normally. Annual: the charge above was pro rata to renewal, and this takes one month off it.
     Either way the value given is players x rate, which is the month a new signup gets.

     ONLY WHERE THEY WERE ACTUALLY CHARGED. Inside the free month aAdj is null and there is
     nothing to hand back; crediting then would give away a month they never paid for. kind
     'failed' is a Stripe refusal, and crediting that would turn a failed charge into free money.
     So the test is kind === 'charge', not merely "aAdj exists". */
  let freeMonth = null;
  /* NOT FOR A VENUE COMING BACK. It had its free month the first time, and without this the
     free month is farmable: cancel a venue, add it again, get another month. That is the exact
     loop Dean named when he asked for the same-name rule. `reviving` is the whole test, because
     a returning venue is now the SAME ROW rather than a new one. */
  if (!reviving && aAdj && aAdj.kind === 'charge' && aAdj.cents > 0 && info && info.sub && info.sub.customer) {
    const fRate = vpbRateStrict(env, info.priceId, o.account.plan);   // per player, per month
    const freeCents = (fRate == null) ? 0 : Math.round(fRate * 100) * players;
    if (freeCents > 0) {
      /* KEYED ON THE VENUE ID, which is unique and permanent, so a double click or a client
         retry banks the credit once. vpaProvisionOneVenue is idempotent by name and answers 409
         above on a second add, so nothing can reach here twice for one venue after Stripe's 24h
         key window has passed either. */
      const fRes = await vpbStripePost(env, 'customers/' + encodeURIComponent(info.sub.customer) + '/balance_transactions', {
        amount: -freeCents, currency: 'aud',
        description: name + ' - first month free, comes off your next invoice',
      }, 'vfree:' + String(r.venue && r.venue.id));
      if (fRes && !fRes.error && fRes.id) {
        freeMonth = { cents: freeCents, txn: fRes.id };
        /* Best effort, and deliberately AFTER the money. The credit is the thing that matters,
           and these columns arrive with migration 83: on a database that has not run it yet the
           venue is still credited and the patch simply does nothing. */
        await vpaPatch(env, 'vp_venues', 'id=eq.' + encodeURIComponent(r.venue && r.venue.id),
          { free_month_at: new Date().toISOString(), free_month_cents: freeCents }).catch(() => {});
      } else {
        // Charged and not credited is the one bad outcome here, so it is logged loudly and
        // reported in the audit row rather than swallowed. The venue is live either way.
        console.log('[billing] FREE MONTH CREDIT FAILED for ' + name + ': ' + ((fRes && fRes.error && fRes.error.message) || 'unknown'));
        freeMonth = { cents: 0, failed: true, owed_cents: freeCents };
      }
    }
  }

  await vpaInsert(env, 'vp_admin_audit', {
    ...vpbActorFields(o),
    action: (reviving ? 'venue_readded' : 'venue_added') + (billingOk ? '' : '_billing_pending'),
    target: 'venue:' + (r.venue && r.venue.id),
    detail: { name: name, players: players, new_total: newTotal, billing: aAdj, free_month: freeMonth, actor_user: o.authUserId },
  }, false).catch(() => {});

  // A venue added from the account is a venue nobody has told yet. Send the owner one tidy
  // setup email they can forward straight on to the people who will run the night there.
  // Best-effort: the venue is already live and billed, so this must not be able to fail the call.
  const onboardingSent = await vpbFireVenueOnboarding(env, {
    email: o.account && o.account.contact_email,
    venueName: name,
    slug: r.venue && r.venue.slug,
  });

  return json({ ok: true, billing_synced: billingOk, onboarding_sent: onboardingSent,
    readded: !!reviving,
    free_month_cents: (freeMonth && freeMonth.cents) || 0,
    venue: { id: r.venue && r.venue.id, name: name, slug: r.venue && r.venue.slug, players: players } });
}

/* --- POST /account/cancel-venue : schedule (or undo) a venue's cancellation. ---
   The venue keeps full access until the end of the paid period. We flag the venue,
   drop the subscription quantity to the remaining venues (proration 'none' => the
   credit lands at renewal), and if EVERY venue is now cancelling we end the whole
   subscription at period end. The webhook suspends flagged venues when the period
   actually rolls over. Sending { undo: true } reverses it while still in the period. */
/* A VENUE CANCELLING IS THE ONE EVENT NOBODY WAS TOLD ABOUT.
   Dean, 12 Sep 2026: "Can you email Dean@venueplay.com.au and hello@venueplay.com.au
   everytime a venue cancels?"

   Wellshot Hotel is why. They signed up on 19 Aug at 10:19, cancelled the same day at
   19:01, eight hours and forty-two minutes later, and stayed on the books looking like
   the biggest account on the platform: twenty players, $40.02 a month in the billing
   table. Nobody knew for twenty-four days, and it was found by a check written for
   something else entirely.

   A cancellation is the most time-sensitive thing that happens on this platform. They
   keep working until the end of the period, so there is a real window to ring them, and
   that window is only useful if somebody knows it has opened.

   Sent to both addresses, best effort, and never allowed to fail the cancellation
   itself: a venue must always be able to leave, even if our own mail is down. */
const VPA_CANCEL_ALERTS = ['dean@venueplay.com.au', 'hello@venueplay.com.au'];

/* WHY THEY LEFT, IN THEIR WORDS. Dean, 12 Sep 2026: a dropdown, a follow up question
   where the answer is something we can act on, and a box for everything else.

   The list is here and the page renders from the same wording, so the reason stored is
   the reason they were shown. Anything not on this list is recorded as 'other' rather
   than rejected: a venue must ALWAYS be able to leave, and a cancellation is never
   refused because a form field did not validate. */
const VPA_CANCEL_REASONS = {
  expensive: 'VenuePlay is too expensive',
  trial: 'We just wanted to trial it',
  dislike: 'We do not like it',
  other: 'Something else',
};

async function vpaFireCancelAlert(env, opts) {
  const say = (why, extra) => vpaInsert(env, 'vp_admin_audit', {
    actor_admin: null, actor_label: 'system',
    action: 'venue_cancel_alert',
    target: 'venue:' + String((opts && opts.venueId) || ''),
    detail: Object.assign({ outcome: why, venue: (opts && opts.name) || null }, extra || {}),
  }, false).catch(() => {});
  try {
    if (!env.RESEND_API_KEY) { await say('not sent: no Resend key on this Worker'); return; }
    const undo = !!(opts && opts.undo);
    const name = (opts && opts.name) || 'A venue';
    const site = (env.SITE_URL || 'https://venueplay.com.au').replace(/\/+$/, '');
    const when = (opts && opts.ends) ? opts.ends : 'the end of their current period';
    const heading = undo ? (name + ' has UN-cancelled') : (name + ' has cancelled');
    /* The subject says the kind first so the inbox reads as a queue; the heading inside stays
       a sentence, because that is what a person reads once the email is open. */
    const subject = vpaAlertSubject(undo ? 'uncancelled' : 'cancelled', name);
    const lead = undo
      ? (vpaEsc(name) + ' was scheduled to end and the owner has just reversed it. Nothing further to do.')
      : (vpaEsc(name) + ' has scheduled their cancellation. They keep playing until <b>'
         + vpaEsc(when) + '</b>, so there is a window to call them before it takes effect.');
    const reasonLabel = (opts && opts.reason && VPA_CANCEL_REASONS[opts.reason]) || '';
    const rows = [
      ['Venue', vpaEsc(name)],
      ['Slug', vpaEsc((opts && opts.slug) || '')],
      ['Stops', undo ? 'no longer stopping' : vpaEsc(when)],
      ['Players on the plan', String((opts && opts.players) != null ? opts.players : '')],
      ['Worth', (opts && opts.monthly) ? vpaEsc(opts.monthly) + ' a month' : ''],
      ['Reason', undo ? '' : vpaEsc(reasonLabel)],
    ].filter((r) => r[1] !== '');
    /* THEIR OWN WORDS GET THEIR OWN BLOCK, not a table cell. This is the only part of
       the email worth reading twice, and a paragraph of feedback squeezed into a
       right-hand column is a paragraph nobody reads. */
    const said = (!undo && opts && opts.reasonDetail)
      ? '<div style="background:#fdf3f8;border-left:3px solid #e6007e;padding:12px 16px;margin:0 0 18px">'
        + '<div style="font-size:12px;color:#6b6b78;margin-bottom:4px">What they said</div>'
        + '<div style="font-size:15px;line-height:1.5">' + vpaEsc(opts.reasonDetail) + '</div></div>'
      : '';
    const html =
        '<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;margin:0 auto;padding:28px 22px;color:#1a1a22">'
      + '<h1 style="font-size:20px;margin:0 0 14px">' + vpaEsc(heading) + '</h1>'
      + '<p style="font-size:15px;line-height:1.55;margin:0 0 16px">' + lead + '</p>'
      + '<table role="presentation" cellpadding="0" cellspacing="0" style="font-size:14px;border-collapse:collapse;margin:0 0 18px">'
      + rows.map((r) => '<tr><td style="padding:4px 14px 4px 0;color:#6b6b78">' + r[0]
                      + '</td><td style="padding:4px 0"><b>' + r[1] + '</b></td></tr>').join('')
      + '</table>'
      + said
      + '<p style="margin:20px 0"><a href="' + site + '/app/hq" '
      + 'style="background:#e6007e;color:#fff;text-decoration:none;padding:11px 18px;border-radius:9px;font-weight:600">'
      + 'Open HQ</a></p>'
      + '<p style="font-size:12px;color:#c2c2cc;margin:14px 0 0">venueplay.com.au &middot; Gflam Group, ABN ' + VP_ABN + '</p>'
      + '</div>';
    let sent = 0;
    for (const to of VPA_CANCEL_ALERTS) {
      const ok = await vpaSendEmail(env, to, subject, html).catch(() => false);
      if (ok) sent++;
    }
    await say(sent === VPA_CANCEL_ALERTS.length ? 'sent'
              : (sent ? 'sent to ' + sent + ' of ' + VPA_CANCEL_ALERTS.length : 'not sent: Resend refused it'),
              { to: VPA_CANCEL_ALERTS, undo: undo, ends: (opts && opts.ends) || null,
                sent: sent, subject: subject });
  } catch (e) {
    await say('not sent: ' + String((e && e.message) || e).slice(0, 120));
  }
}


/* ===========================================================================
   TELLING THE VENUE THEY ARE LEAVING.

   Until 16 Sep 2026 a venue that cancelled was told nothing at all. vpaFireCancelAlert
   emails dean@ and hello@, and that was the whole of it: the owner clicked cancel, the
   screen said ok, and the next thing that happened was the games stopping.

   Two messages now. One the moment they cancel, one the day before it takes effect.

   THEY ARE NOT MARKETING AND THEY DO NOT CARRY AN UNSUBSCRIBE. A message about the
   service someone is paying for, sent to the people who pay for it, is not a commercial
   electronic message in the sense the Spam Act means. The unsubscribe list is read only
   by the outreach tools, exactly as the welcome email's comment says, so opting out of
   marketing cannot silence a notice that your service is about to stop. Getting that the
   wrong way round would be the worse fault by far.

   EVERYONE ON THE ACCOUNT GETS THEM. The billing contact plus every manager login. The
   person who clicks cancel at head office is often not the person standing behind the bar
   on the last night wondering why the telly has gone off.
   ======================================================================== */

/* Every address that should hear about this account. The billing contact, plus each
   manager's login email, deduplicated and lower-cased. Best-effort per lookup: one slow
   Auth call must not cost the other recipients their email. */
async function vpaAccountContacts(env, acct, venueId) {
  const out = [];
  const seen = {};
  const add = (e) => {
    const k = String(e || '').trim().toLowerCase();
    if (k && k.indexOf('@') > 0 && !seen[k]) { seen[k] = 1; out.push(k); }
  };
  add(acct && acct.contact_email);
  try {
    const staff = await vpaSelect(env, 'vp_venue_staff',
      'venue_id=eq.' + encodeURIComponent(venueId) + '&role=in.(owner,manager,host)&select=auth_user_id,role');
    for (const s of (staff || [])) {
      const u = await vpaAuthGetUser(env, s.auth_user_id);
      if (u && u.email) add(u.email);
    }
  } catch (_) { /* the billing contact alone is still worth sending to */ }
  return out;
}

/* The shared shell, so the two emails cannot drift apart in tone or in what they promise.
   `lead` is the one-line summary, `rows` the facts table, `extra` anything after it. */
/* WHAT THIS VENUE ACTUALLY DID WITH US.
 *
 * One function, three readers: the goodbye email's "that's a wrap", the cancellation
 * confirmation, and HQ's details panel on the quiet and cancelled screens. Dean asked for
 * the same numbers in both places on 17 Sep 2026, and two functions computing "how many
 * trivia nights" separately is precisely how this codebase ends up with two answers to one
 * question. Everything here is counted from what happened, never estimated.
 *
 * WHAT IS AND IS NOT COUNTED, because a goodbye email that flatters is worse than none:
 *   - test players (vp_players.is_test) are excluded. A venue's biggest night must not be
 *     a night we were testing on their account.
 *   - a session with no games is not a night. Opening the console and closing it again is
 *     not something to thank somebody for.
 *   - formats are read from vp_games, which does record bingo: it is broadcast-only and
 *     opens no game Worker session, but the host's end-of-game report writes the row.
 *     Checked against live data, 17 Sep 2026: bingo90 24, trivia 21, musical_bingo 13,
 *     raffle 11. If that ever comes back empty for a venue that plainly played, suspect
 *     this join before you suspect the venue.
 *
 * Money is NOT here. There is no invoices table in this database; spend lives in Stripe
 * and needs a live call, so it is fetched separately and is allowed to fail without
 * taking the rest of the numbers with it.
 */
async function vpaVenueStats(env, venueId, tz) {
  const out = { nights: 0, totalGames: 0, games: {}, avgPlayers: {}, totalPlayers: 0,
                biggest: null, overagePlayers: 0, overageSpendCents: 0,
                playerGames: 0, regulars: 0, bestNight: null, ok: false };
  const _devices = {};      // device -> how many different nights it turned up on
  const _weekday = {};      // which night of the week they actually run
  try {
    const sessions = await vpaSelect(env, 'vp_sessions',
      'venue_id=eq.' + encodeURIComponent(venueId)
      + '&select=id,started_at,opened_at,overage_approved_count&limit=2000') || [];
    if (!sessions.length) { out.ok = true; return out; }
    const ids = sessions.map((s) => s.id);
    const byId = {};
    for (const s of sessions) {
      byId[s.id] = s;
      out.overagePlayers += parseInt(s.overage_approved_count, 10) || 0;
    }
    /* Chunked, because `id=in.(...)` goes in the URL and a venue with a few hundred nights
       would build a request long enough for Cloudflare to refuse it. */
    const chunk = (arr, n) => { const o = []; for (let i = 0; i < arr.length; i += n) o.push(arr.slice(i, i + n)); return o; };
    const perSession = {};
    for (const part of chunk(ids, 40)) {
      const inList = '(' + part.map((x) => encodeURIComponent(x)).join(',') + ')';
      const games = await vpaSelect(env, 'vp_games',
        'session_id=in.' + inList + '&select=session_id,format&limit=4000') || [];
      for (const g of games) {
        if (!g.format) continue;
        out.games[g.format] = (out.games[g.format] || 0) + 1;
        out.totalGames++;
        (perSession[g.session_id] = perSession[g.session_id] || { formats: [], players: 0 }).formats.push(g.format);
      }
      const players = await vpaSelect(env, 'vp_players',
        'session_id=in.' + inList + '&is_test=not.is.true&select=session_id,device_id&limit=20000') || [];
      for (const p of players) {
        if (!perSession[p.session_id]) continue;      // a session with no games is not a night
        perSession[p.session_id].players++;
        /* REGULARS. The same phone turning up on a different night is the strongest thing a
           venue has built with us and the hardest to replace, so it is worth telling them.
           Counted on device_id, not on name: two different Sams are two people, and one Sam
           who types "sam" then "Sam" is one. device_id is null on some rows (an older join,
           a browser that would not give one), and those simply do not count rather than
           being guessed at. Sets are used because a phone that joins twice in ONE night is
           still one person on one night. */
        if (p.device_id) {
          (_devices[p.device_id] = _devices[p.device_id] || {})[p.session_id] = 1;
        }
      }
    }
    const perFormat = {};
    for (const sid of Object.keys(perSession)) {
      const row = perSession[sid];
      out.nights++;
      /* Which night of the week they run, in THEIR timezone. A venue in Perth whose Thursday
         night starts at 7pm is Thursday at 11am UTC, so counting on the raw timestamp would
         tell a publican their big night was a Wednesday. */
      const wts = byId[sid] && (byId[sid].started_at || byId[sid].opened_at);
      if (wts && tz) {
        const d = vpaLocalWeekday(Math.floor(Date.parse(wts) / 1000), tz);
        if (d) {
          const w = _weekday[d] = _weekday[d] || { nights: 0, formats: {} };
          w.nights++;
          /* WHICH GAME OWNS THAT NIGHT. Dean, 17 Sep 2026: "say Thursday night trivia". A
             publican does not think "we run 17 Thursdays", they think "Thursday is trivia",
             and that is the thing they would be giving up. Counted per night, not per game,
             so three bingo games on one Thursday is one Thursday of bingo. */
          for (const f of row.formats) w.formats[f] = (w.formats[f] || 0) + 1;
        }
      }
      out.totalPlayers += row.players;
      const when = byId[sid] && (byId[sid].started_at || byId[sid].opened_at);
      if (!out.biggest || row.players > out.biggest.players) {
        out.biggest = { players: row.players, at: when || null };
      }
      for (const f of row.formats) {
        const a = perFormat[f] = perFormat[f] || { games: 0, players: 0, best: 0, bestAt: null };
        a.games++; a.players += row.players;
        /* The best night EACH game ever had, so the wrap can say which game pulled their
           biggest room. "Your biggest night was 41" is a number; "your biggest trivia night
           was 41" is the one that tells a publican which night to protect. */
        if (row.players > a.best) { a.best = row.players; a.bestAt = when || null; }
        /* PLAYER-GAMES, the denominator for what a player cost. Dean, 17 Sep 2026: price it
           "per player per game, not including raffles and members draws". Those two are drawn
           FOR the room rather than played BY it: nobody joins a members draw on their phone,
           so counting them would divide the bill by rounds that had no players in them and
           flatter the figure. One player in one game is one unit. */
        if (!VPA_NOT_PLAYED.has(f)) out.playerGames += row.players;
      }
    }
    out.bestByFormat = {};
    for (const f of Object.keys(perFormat)) {
      out.avgPlayers[f] = perFormat[f].games ? Math.round(perFormat[f].players / perFormat[f].games) : 0;
      out.bestByFormat[f] = { players: perFormat[f].best, at: perFormat[f].bestAt };
      /* Which single game pulled the biggest room of the lot. Ties go to the first seen,
         which is the most played format, because the list is walked in that order. */
      if (!out.bestGame || perFormat[f].best > out.bestGame.players) {
        out.bestGame = { format: f, players: perFormat[f].best, at: perFormat[f].bestAt };
      }
    }
    if (out.bestGame && !out.bestGame.players) out.bestGame = null;
    if (out.biggest && !out.biggest.players) out.biggest = null;   // nobody ever joined
    for (const dev of Object.keys(_devices)) {
      if (Object.keys(_devices[dev]).length > 1) out.regulars++;
    }
    /* Only worth saying when it is actually a pattern. Three nights on a Thursday out of four
       is a venue's trivia night; two out of eleven spread across the week is not, and calling
       it their big night would be us telling them something untrue about their own pub. */
    let topDay = null, topN = 0, total = 0;
    for (const d of Object.keys(_weekday)) {
      total += _weekday[d].nights;
      if (_weekday[d].nights > topN) { topN = _weekday[d].nights; topDay = d; }
    }
    if (topDay && total >= 4 && topN / total >= 0.4) {
      out.bestNight = { day: topDay, nights: topN, format: null };
      /* Only name the game when it really is THAT night's game. Half of the nights on that
         day, or it is just the game they happened to play most, and telling a venue Thursday
         was its trivia night when Thursday was mostly bingo is worse than saying neither. */
      const fs = _weekday[topDay].formats; let bf = null, bn = 0;
      for (const f of Object.keys(fs)) if (fs[f] > bn) { bn = fs[f]; bf = f; }
      if (bf && bn / topN >= 0.5) out.bestNight.format = bf;
    }
    out.overageSpendCents = out.overagePlayers * VPA_OVERAGE_CENTS;
    out.ok = true;
  } catch (e) {
    /* A goodbye email must still go out if the numbers cannot be gathered. ok stays false
       and every caller leaves the wrap section out rather than printing zeroes, because
       "you played 0 games" to a venue that played forty is the worst version of this. */
    out.ok = false;
  }
  return out;
}

/* $2 a head, the locked overage price. Named here so the email, HQ and the biller cannot
   drift apart on what an extra player costs. */
const VPA_OVERAGE_CENTS = 200;

/* Drawn FOR the room, not played BY it: nobody joins a raffle or a members draw on their
   phone, so neither counts toward "per player, per game". Including them would divide the
   bill by rounds that had no players in them. */
const VPA_NOT_PLAYED = new Set(['raffle', 'members_draw']);

/* Above this, the per-player figure has stopped being a reason to stay, so it is left out
   rather than made into an argument for leaving. A dollar a head a game is already well
   past the point where it is worth saying. */
const VPA_WRAP_MAX_PER_PLAYER = 1.00;

/* How long they have been with us, in the words a person would use. Years once it earns
   them, because "it has been a pleasure for the last 14 months" reads worse than
   "the last year and a bit". */
/* Written to follow "for the last ___", so no leading article: "for the last a month" is
   what the first version produced and it is the sort of thing that makes a goodbye email
   read as though nobody looked at it. Found by rendering it, 17 Sep 2026. */
/* "Good morning, Dean." Dean, 17 Sep 2026.
 *
 * The hour is the VENUE's, not ours and not the server's: the last-day email goes out from
 * 8am wherever the pub is, so a Perth venue must not be wished good afternoon at breakfast.
 * Same helper the rest of this file uses for the weekday, so the two cannot disagree.
 *
 * FIRST NAME ONLY, and only when it plainly is one. contact_name holds whatever was typed at
 * signup, which is sometimes "Dean Tindale", sometimes "The Mini Bar", sometimes "manager".
 * Greeting a pub by its trading name reads worse than not greeting it at all, so anything
 * with no letters, anything longer than a name, and anything that matches the venue's own
 * name is dropped and the greeting goes out bare: "Good morning." still works.
 */
function vpaGreeting(tz) {
  let h = 9;
  try { h = vpaLocalHour(tz); } catch (e) {}
  if (!(h >= 0 && h < 24)) h = 9;
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}
function vpaFirstName(contactName, venueName) {
  const raw = String(contactName == null ? '' : contactName).trim();
  if (!raw) return '';
  const first = raw.split(/\s+/)[0].replace(/[^A-Za-z'\-]/g, '');
  if (first.length < 2 || first.length > 20) return '';
  const low = first.toLowerCase();
  // not a name: a role, or the venue talking about itself
  if (['the','manager','admin','info','office','reception','owner','host','staff','accounts',
       'bar','club','hotel','venue','team'].indexOf(low) !== -1) return '';
  if (venueName && String(venueName).toLowerCase().indexOf(low) === 0) return '';
  return first.charAt(0).toUpperCase() + first.slice(1);
}
function vpaHello(tz, contactName, venueName) {
  const n = vpaFirstName(contactName, venueName);
  return vpaGreeting(tz) + (n ? ', ' + vpaEsc(n) : '') + '.';
}

function vpaTenureWords(createdAt, asAtMs) {
  const t = Date.parse(createdAt || '');
  if (!t) return null;
  /* MEASURED TO THEIR LAST DAY, not to today. Dean, 17 Sep 2026: "we should bump them up to
     the next month because the venue actually will complete 7 months so we are not lying."
     He is right, and the honest way to get there is to count the relationship to the day it
     actually ends rather than to the morning we happen to be writing. A venue that signed up
     on the 3rd of February and plays its last night in September HAS given us seven months
     by the time they read this. Floor still applies, so it can never overstate. */
  const end = asAtMs || Date.now();
  const months = Math.max(0, Math.floor((end - t) / (30.44 * 86400000)));
  if (months < 1) return 'few weeks';
  if (months === 1) return 'month';
  if (months < 12) return months + ' months';
  const years = Math.floor(months / 12), rem = months % 12;
  const y = years === 1 ? 'year' : years + ' years';
  if (rem === 0) return y;
  if (rem === 1) return y + ' and a month';
  return y + ' and ' + rem + ' months';
}
/* Months with us, for the per-night figure below. Same clock as vpaTenureWords so the two
   cannot disagree about how long somebody has been here. */
function vpaTenureMonths(createdAt, asAtMs) {
  const t = Date.parse(createdAt || '');
  if (!t) return 0;
  return Math.max(1, Math.floor(((asAtMs || Date.now()) - t) / (30.44 * 86400000)));
}

/* THAT'S A WRAP. The block at the bottom of the goodbye email.
 *
 * Dean, 17 Sep 2026: "You played x amount of each game and your average cost was x per
 * trivia etc, your biggest night was x amount of players which was x date."
 *
 * Every line here is a count of something that happened, except the per-night cost, which
 * is derived from the rate their subscription actually carries and is labelled "about"
 * because it is. There is no invoices table, so a precise lifetime spend would be a live
 * Stripe call per venue and a figure we could get wrong; a venue that reads a wrong number
 * about its own money stops believing the rest of the email.
 *
 * Returns '' when there is nothing worth showing. A venue that never ran a night gets no
 * wrap rather than a column of zeroes on the way out the door.
 */
function vpaWrapHtml(stats, opts) {
  if (!stats || !stats.ok || !stats.nights || !stats.totalGames) return '';
  const o = opts || {};
  /* BLACK, AND CENTRED. Dean, 17 Sep 2026: "lets make it prettier, its our last chance to
     convince them to uncancel." The rest of the email is dark text on white, so a black panel
     is the one thing on the page that cannot be skimmed past. Colours are inverted for it:
     paper on ink, with the pink kept for the bars so it still reads as VenuePlay.
     Every email client renders a background colour on a table cell; half of them block
     images, so none of this is a picture. */
  const PINK = '#FF1F8E', INK = '#12101a', PAPER = '#FFF1E6', DIM = '#9b90ab', TILE = '#1e1a2b';
  /* Thousands separators, because these have to hold a real club. A 900 seat venue on a
     grand final night is four figures of phones, and "10000 phones in the room" reads like
     a serial number. Dean, 17 Sep 2026: room for 10,000 phones and 1,000 games. */
  const n = (x) => String(Math.round(x || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

  /* THE TILES. Three numbers, big, side by side. A table and not a grid: Outlook has no
     flexbox and this is the one part of the email that has to survive it. Widths are
     percentages so four figures fit without pushing anything off the edge. */
  const tile = (big, small) =>
    '<td width="33.33%" align="center" style="padding:16px 6px;background:' + TILE + ';border-radius:12px">'
    + '<div style="font-size:30px;line-height:1.05;font-weight:800;color:' + PAPER + '">' + big + '</div>'
    + '<div style="font-size:11.5px;letter-spacing:.06em;text-transform:uppercase;color:' + DIM + ';padding-top:5px">' + small + '</div>'
    + '</td>';
  const tiles = '<table role="presentation" width="100%" cellpadding="0" cellspacing="6" style="margin:0 0 16px"><tr>'
    + tile(n(stats.nights), stats.nights === 1 ? 'night' : 'nights')
    + tile(n(stats.totalGames), stats.totalGames === 1 ? 'game' : 'games')
    + tile(n(stats.totalPlayers), 'phones')
    + '</tr></table>';

  /* A BAR PER GAME, drawn as a table cell with a background colour. No images: half the
     email clients in a pub office block them by default, and a wrap that arrives as three
     grey boxes is worse than no wrap. Widths are whole percents of the most played game. */
  const fmts = Object.keys(stats.games).sort((a, b) => stats.games[b] - stats.games[a]);
  const top = fmts.length ? stats.games[fmts[0]] : 0;
  const rows = fmts.map((f) => {
    const c = stats.games[f];
    const pct = top ? Math.max(6, Math.round((c / top) * 100)) : 0;
    const avg = stats.avgPlayers[f];
    return '<tr>'
      + '<td style="padding:5px 10px 5px 0;font-size:14px;color:' + PAPER + ';white-space:nowrap">'
      +   vpaEsc(vpaFormatWord(f)) + '</td>'
      + '<td width="52%" style="padding:5px 0">'
      +   '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>'
      +   '<td width="' + pct + '%" style="background:' + PINK + ';border-radius:5px;font-size:0;line-height:9px;height:9px">&nbsp;</td>'
      +   '<td style="font-size:0;line-height:9px">&nbsp;</td></tr></table></td>'
      + '<td align="right" style="padding:5px 0 5px 10px;font-size:14px;font-weight:700;color:' + PAPER + ';white-space:nowrap">'
      +   n(c) + '</td>'
      + '<td align="right" style="padding:5px 0 5px 12px;font-size:12.5px;color:' + DIM + ';white-space:nowrap">'
      +   (avg ? n(avg) + (avg === 1 ? ' player' : ' players') : '') + '</td>'
      + '</tr>';
  }).join('');

  const when = (at) => at ? vpaFmtDate(Math.floor(Date.parse(at) / 1000)) : null;

  let best = '';
  if (stats.bestGame && stats.bestGame.players > 0) {
    const d = when(stats.bestGame.at);
    best = '<p style="margin:0 0 6px;font-size:14.5px;color:' + PAPER + '">'
      + 'Your biggest room was <b>' + n(stats.bestGame.players) + ' players</b>, on a '
      + vpaEsc(vpaFormatWord(stats.bestGame.format)) + ' night'
      + (d ? ' on ' + vpaEsc(d) : '') + '.</p>';
  } else if (stats.biggest && stats.biggest.players > 0) {
    const d = when(stats.biggest.at);
    best = '<p style="margin:0 0 6px;font-size:14.5px;color:' + PAPER + '">'
      + 'Your biggest room was <b>' + n(stats.biggest.players) + ' players</b>'
      + (d ? ', on ' + vpaEsc(d) : '') + '.</p>';
  }

  /* THE ONE THAT IS HARDEST TO REPLACE. A venue can buy games anywhere; people coming back
     is the thing they built. Only said when there are enough of them to be a pattern rather
     than a coincidence. */
  let regulars = '';
  if (stats.regulars >= 3) {
    regulars = '<p style="margin:0 0 6px;font-size:14.5px;color:' + PAPER + '">'
      + '<b>' + n(stats.regulars) + ' people</b> came back for another night.</p>';
  }
  let bestNight = '';
  if (stats.bestNight && stats.bestNight.day) {
    bestNight = '<p style="margin:0 0 6px;font-size:14.5px;color:' + PAPER + '">'
      + (stats.bestNight.format
          ? '<b>' + vpaEsc(stats.bestNight.day) + ' night '
            + vpaEsc(vpaFormatWord(stats.bestNight.format)) + '</b>, '
            + n(stats.bestNight.nights) + ' of them.'
          : '<b>' + vpaEsc(stats.bestNight.day) + '</b> was your night, '
            + n(stats.bestNight.nights) + ' of them.')
      + '</p>';
  }

  /* Reworded, 17 Sep 2026. "Counting every game a player actually played, that worked out
     at about $0.32 per player, per game" made the reader do the arithmetic to see the
     point. Say the number first and let it land. */
  let cost = '';
  if (o.rateCents > 0 && o.players > 0 && o.months > 0 && stats.playerGames > 0) {
    const per = ((o.rateCents * o.players * o.months) / 100) / stats.playerGames;
    if (per >= 0.005 && isFinite(per) && per <= VPA_WRAP_MAX_PER_PLAYER) {
      const cents = Math.round(per * 100);
      cost = '<p style="margin:0 0 6px;font-size:14.5px;color:' + PAPER + '">'
        + 'All of it came to about <b>' + (per < 1 ? cents + 'c' : '$' + per.toFixed(2))
        + ' a player, a game</b>.</p>';
    }
  }

  /* Reworded. "You waved 18 extra players in over the cap on busy nights, rather than turn
     them away" was three clauses to say one thing. */
  let over = '';
  if (stats.overagePlayers > 0) {
    over = '<p style="margin:0 0 6px;font-size:14.5px;color:' + PAPER + '">'
      + '<b>' + n(stats.overagePlayers) + ' extra players</b> got in on nights you went over '
      + 'the cap. You never turned anyone away.</p>';
  }

  return ''
    + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
    +   'style="background:' + INK + ';border-radius:14px;margin:0 0 22px"><tr>'
    +   '<td align="center" style="padding:24px 20px 22px;text-align:center">'
    + '<p style="margin:0 0 4px;font-size:11.5px;letter-spacing:.09em;text-transform:uppercase;color:' + PINK + ';font-weight:700">And that is a wrap</p>'
    + '<p style="margin:0 0 18px;font-size:15px;color:' + DIM + '">Everything you ran with us.</p>'
    + tiles
    + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 14px">' + rows + '</table>'
    + best + regulars + bestNight + cost + over
    + '</td></tr></table>';
}

const VPA_FORMAT_WORDS = {
  bingo90: 'bingo', musical_bingo: 'musical bingo', trivia: 'trivia',
  raffle: 'raffle', members_draw: 'members draw',
};
function vpaFormatWord(f) { return VPA_FORMAT_WORDS[f] || String(f || '').replace(/_/g, ' '); }

function vpaLeavingHtml(env, opts) {
  const site = (env.SITE_URL || 'https://venueplay.com.au').replace(/\/+$/, '');
  const logo = site + '/logos/venueplay_primary_dark.png';
  const billing = site + '/app/billing.html';
  return vpaVenueEmailCard(opts.preheader || opts.heading, ''
    + '<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;padding:8px 0;color:#12101a">'
    + '<p style="font-size:17px;font-weight:700;margin:0 0 6px">' + vpaEsc(opts.heading) + '</p>'
    + '<p style="font-size:14px;color:#6a6a75;margin:0 0 20px">' + opts.lead + '</p>'
    + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #eee;border-radius:12px;margin-bottom:22px"><tr><td style="padding:18px 20px">'
    +   (opts.rows || []).map((r) =>
          '<p style="margin:0 0 10px;font-size:13px;color:#6a6a75">' + vpaEsc(r[0])
          + '<br><span style="font-size:15px;font-weight:700;color:#12101a">' + vpaEsc(r[1]) + '</span></p>').join('')
    + '</td></tr></table>'
    /* THE THREE MONTHS IS A PROMISE, not a nicety. venueplay.com.au/privacy already says a
       closed venue's player list is deleted within 90 days, so this matches what is
       published rather than inventing a second number. Change one and you must change both. */
    + '<p style="font-size:13.5px;color:#3a3a44;margin:0 0 18px">'
    + 'Nothing is thrown away on the day. Your members list, your advertising slides, your '
    + 'raffle and members draw history all stay on the account for <b>90 days</b>, so if '
    + 'you come back in that time everything is where you left it. After that, in line with '
    + 'our <a href="' + site + '/privacy" style="color:#3a3a44">privacy policy</a>, the player '
    + 'data is deleted.</p>'
    /* THE RATE IS HELD BY STAYING, NOT BY HAVING BEEN. Dean asked for a warning about the
       price, 16 Sep 2026, and it is the truest reason to think twice: the founding rate is
       locked for as long as a venue is with us and the standard rate is the one that moves.
       Said plainly and once. It is a fact they need before Friday, not a threat, and a
       leaving email that nags is one nobody finishes reading. */
    + (opts.priceHold
        ? '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fff8e6;border:1px solid #e8d9a8;border-radius:12px;margin:0 0 22px"><tr><td style="padding:16px 18px">'
          + '<p style="margin:0;font-size:14px;font-weight:700;color:#12101a">'
          + (opts.founding ? 'Worth knowing before then: the rate does not come back.'
                           : 'Worth knowing before then: the price will not wait for you.') + '</p>'
          + '<p style="margin:6px 0 0;font-size:13.5px;color:#3a3a44">'
          /* ONLY THE FOUNDING RATE IS HELD. Dean, 16 Sep: "Wellshot didnt get founding
             though", and he was right: Stripe has them on STRIPE_PRICE_STANDARD_MONTHLY at
             $3. Telling a standard venue its rate is locked for as long as it stays is a
             promise nobody made, and it would have gone to the only customer this product
             has ever had. Which of the two they get is decided by the price id on their own
             subscription, not by guesswork. */
          + (opts.founding
              ? 'You are on <b>' + vpaEsc(opts.priceHold) + ' a player a month</b>, and that '
                + 'is held for as long as you stay with us. It is not held once you have gone. '
                + 'Come back later and it is at the price of the day, and that price has only '
                + 'ever moved one way.'
              : 'You are on <b>' + vpaEsc(opts.priceHold) + ' a player a month</b>. That is the '
                + 'rate that moves over time, and nothing about today\'s price is kept for you '
                + 'once the account closes. Come back later and it is at the price of the day, '
                + 'and that price has only ever moved one way.')
          + '</p></td></tr></table>'
        : '')
    + (opts.extra || '')
    /* FULL WIDTH. Dean, 17 Sep 2026. On a phone a 22px-padded link floats in a wall of
       text and reads as a footnote, and on the goodbye this is the last chance to keep
       them. A table with align rather than display:block, because Outlook ignores that. */
    + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 4px"><tr>'
    + '<td align="center" style="background:#FF1F8E;border-radius:10px">'
    + '<a href="' + billing + '" style="display:block;padding:15px 18px;color:#ffffff;'
    + 'text-decoration:none;font-size:15.5px;font-weight:700">'
    + vpaEsc(opts.cta || 'Open your billing page') + '</a></td></tr></table>'
    + '<p style="font-size:13px;color:#6a6a75;margin:22px 0 0">If this was not meant to happen, or you want to talk it through, just reply to this email. It reaches a person.</p>'
    /* No Gflam Group and no ABN here. Dean's call, and it is a correct one: neither is a
       requirement on a service notice, and a holding company's name at the bottom of
       "your last night is Friday" reads like a letter from a solicitor. The ABN stays
       where it is actually required, on the receipt, which also carries "Prices include
       GST" and is a tax invoice. */
    + vpaVenueEmailFoot(false)
    + '</div>', opts.heading);
}

/* Sent the moment they click cancel. Confirms what they just did, in plain words, with the
   date. An owner who cancels and hears nothing has no way to tell whether it worked, and
   the support email that follows is always "did that go through?". */

/* A LEAVING EMAIL THAT DID NOT LAND IS AN EMERGENCY, NOT A LOG LINE.
 *
 * Dean, 17 Sep 2026: "if this goes to a bounced email we need a massive flag to alert us so
 * we can remind the venue."
 *
 * Both leaving emails are the only warning a venue gets. If every address on the account
 * refuses, the venue finds out its games have stopped when the telly does not come on, and
 * the first we hear is an angry phone call. Until now that produced one audit row under a
 * slightly different action name, which is a thing nobody is watching at 8am.
 *
 * WHAT THIS CAN AND CANNOT SEE, honestly. It fires when Resend REFUSES the message: a bad
 * address, an unverified domain, a rate limit. It cannot see a message Resend accepted and
 * the far end bounced an hour later; that arrives on a Resend webhook we do not yet handle,
 * and it is written up in the release notes as the other half of this job.
 */
async function vpaFireDeliveryFailure(env, opts) {
  try {
    if (!env.RESEND_API_KEY) return;
    const what = opts.kind === 'last_day'
      ? 'their LAST DAY warning' : 'their cancellation confirmation';
    const html = '<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif">'
      + '<p style="font-size:18px;font-weight:800;color:#b3261e;margin:0 0 10px">'
      +   'A venue was NOT told. Ring them.</p>'
      + '<p style="margin:0 0 14px;font-size:15px">We could not deliver ' + what + ' to '
      +   '<b>' + vpaEsc(opts.name || 'a venue') + '</b>. Every address on the account refused it, '
      +   'so as far as they know nothing is happening.</p>'
      + '<p style="margin:0 0 6px;font-size:14px"><b>Venue:</b> ' + vpaEsc(opts.name || '') + '</p>'
      + (opts.ends ? '<p style="margin:0 0 6px;font-size:14px"><b>Last day:</b> ' + vpaEsc(opts.ends) + '</p>' : '')
      + '<p style="margin:0 0 6px;font-size:14px"><b>Addresses that refused:</b> '
      +   vpaEsc((opts.refused || []).join(', ') || 'none on file') + '</p>'
      + '<p style="margin:14px 0 0;font-size:14px">Get a working address on the account, then '
      +   'resend from HQ. If the last day is close, ring them today.</p></div>';
    for (const addr of VPA_CANCEL_ALERTS) {
      await vpaSendEmail(env, addr,
        'ACTION NEEDED: ' + (opts.name || 'a venue') + ' was NOT told about '
        + (opts.kind === 'last_day' ? 'its last day' : 'its cancellation'),
        html).catch(() => false);
    }
    await vpaInsert(env, 'vp_admin_audit', {
      actor_admin: null, actor_label: 'system',
      action: 'venue_leaving_email_UNDELIVERED',
      target: 'venue:' + opts.venueId,
      detail: { kind: opts.kind, name: opts.name || null, refused: opts.refused || [],
                ends: opts.ends || null },
    }, false).catch(() => {});
  } catch (_) { /* an alert must never stop the sweep */ }
}


/* THE GOODBYE, BUILT IN ONE PLACE.
 *
 * Two things send it now, so it cannot live inside either of them. The 48 hour sweep sends it
 * to a venue that cancelled a while back, and the cancel endpoint sends it instead of the
 * ordinary confirmation when there are two days or fewer left.
 *
 * WHY THAT SECOND PATH EXISTS. The sweep only fires at exactly two days out. A venue that
 * cancels ONE day before its period ends, or on the last day itself, matched nothing and got
 * the plain confirmation: no wrap, no price warning, not even "we are sorry to see you go".
 * Those are the most impulsive cancellations there are and the likeliest to be reversed, and
 * they were the only ones we never made the case to. Dean spotted it, 17 Sep 2026, by asking
 * what happens if somebody clicks cancel the morning after.
 */
function vpaGoodbyeHtml(env, o) {
  const day = o.day, dated = o.dated;
  const when = day ? (day + ', ' + dated) : dated;
  return vpaLeavingHtml(env, {
    heading: day ? (day + ' is your last day on VenuePlay.') : 'Your last day on VenuePlay.',
    preheader: 'Everything you ran with us, and one tap to keep ' + (o.name || 'the venue') + ' going.',
    /* SORRY TO SEE THEM GO, AND SAY HOW LONG IT HAS BEEN. A venue that has been with us a
       year should not get the same opening line as one that lasted a fortnight, and "the last
       14 months" is the sentence that makes somebody pause. Only said when we know it. */
    lead: '<b>' + o.hello + '</b> We are sorry to see you go.'
        + (o.tenure ? ' It has been a pleasure having ' + vpaEsc(o.name || 'you')
                    + ' with us for the last <b>' + vpaEsc(o.tenure) + '</b>.' : '')
        + ' You are set to cancel after <b>' + vpaEsc(when)
        + '</b>. You keep that night in full, right through to close, and your screens '
        + 'keep playing your advertising until you shut.',
    priceHold: o.rate,
    founding: o.founding,
    rows: [['Venue', o.name || 'your venue'],
           ['Last day', when],
           ['Until close that day', 'Every game runs as normal, and the TVs keep showing your advertising.'],
           ['Undo it any time up to', 'close on ' + (day || 'your last day')],
           ['After that', 'Games stop. Nothing is deleted for 90 days.']],
    extra: (o.wrap || '')
         + '<p style="font-size:13.5px;color:#3a3a44;margin:0 0 18px">'
         + 'All of that stays yours if you change your mind. One click, any time up to close on '
         + vpaEsc(day || 'your last day') + ', and nothing will have been interrupted.</p>'
         /* THE SIGN OFF. Dean, 17 Sep 2026: "we should also wish them the very best and in the
            most friendly sign off." A venue leaving is a publican we may well see again, and
            the last paragraph they read should sound like it came from a person who meant it.
            No pitch in it, and nothing asked for except the one thing worth asking. */
         + '<p style="font-size:13.5px;color:#6a6a75;margin:0 0 18px">'
         + 'And if you are going, thank you for the run. We wish you and '
         + vpaEsc(o.name || 'your venue') + ' all the very best, and if you ever want us back, '
         + 'you know where we are. If something did not work, we would genuinely like to hear '
         + 'it. Just reply, it reaches a person.</p>',
    cta: 'Keep the venue running',
  });
}

async function vpaFireCancelConfirm(env, opts) {
  try {
    if (!env.RESEND_API_KEY) return;
    const to = await vpaAccountContacts(env, opts.account, opts.venueId);
    if (!to.length) return;
    const ends = opts.ends || null;
    /* NAME THE DAY, not just the date. Dean, 17 Sep 2026: a publican works in days of the
       week, and "Friday" is the word that tells them whether it lands on their big night.
       The weekday is computed in the VENUE's timezone, same as the last-day email, so the
       two can never name different days for the same date. */
    const day = (opts.endTs && opts.timezone) ? vpaLocalWeekday(opts.endTs, opts.timezone) : null;
    const whenPhrase = ends ? (day ? day + ', ' + ends : ends) : null;

    /* TWO DAYS OR FEWER AND THIS IS THE ONLY EMAIL THEY GET, so it has to be the good one.
       The 48 hour sweep fires at EXACTLY two days out, so a venue cancelling one day before
       its period ends, or on the last day, never matched it and got the plain confirmation.
       Dean, 17 Sep 2026: "within 2 days trigger the final email not the confirmation." */
    let away = null;
    if (opts.endTs && opts.timezone) {
      try {
        away = vpaDaysBetween(vpaLocalDate(Math.floor(Date.now() / 1000), opts.timezone),
                              vpaLocalDate(opts.endTs, opts.timezone));
      } catch (e) { away = null; }
    }
    if (away !== null && away <= 2) {
      const stats = await vpaVenueStats(env, opts.venueId, opts.timezone).catch(() => null);
      const months = vpaTenureMonths(opts.createdAt, opts.endTs * 1000);
      const html2 = vpaGoodbyeHtml(env, {
        day: day, dated: ends, name: opts.name, wrap: vpaWrapHtml(stats, {
          rateCents: opts.rateCents, players: opts.players, months: months }),
        tenure: vpaTenureWords(opts.createdAt, opts.endTs * 1000),
        rate: opts.rate, founding: opts.founding,
        hello: vpaHello(opts.timezone, opts.contactName, opts.name),
      });
      const del = [], ref = [];
      for (const addr of to) {
        const sent = await vpaSendEmail(env, addr,
          (day ? day + ' is your last day on VenuePlay' : 'Your last day on VenuePlay'),
          html2).catch(() => false);
        (sent ? del : ref).push(addr);
      }
      if (ref.length && !del.length) {
        await vpaFireDeliveryFailure(env, { kind: 'last_day', venueId: opts.venueId,
          name: opts.name, ends: whenPhrase, refused: ref });
      }
      /* Written under the SWEEP's action on purpose: that row is what stops the hourly sweep
         sending a second one a few minutes later to a venue cancelling at exactly two days. */
      await vpaInsert(env, 'vp_admin_audit', {
        actor_admin: null, actor_label: 'system',
        action: (ref.length && !del.length) ? 'venue_last_day_NOT_emailed' : 'venue_last_day_emailed',
        target: 'venue:' + opts.venueId,
        detail: { accepted: del, refused: ref, ends: ends, day: day, name: opts.name || null,
                  why: 'cancelled with ' + away + ' day(s) left, so the goodbye went instead of the confirmation' },
      }, false).catch(() => {});
      return;
    }
    const rows = [['Venue', opts.name || 'your venue']];
    if (whenPhrase) rows.push(['Last day', whenPhrase]);
    rows.push(['Until close that day', 'Every game runs as normal, and the TVs keep showing your advertising.']);
    const html = vpaLeavingHtml(env, {
      heading: 'Your cancellation is confirmed.',
      preheader: (whenPhrase ? 'Last day ' + whenPhrase + '. ' : '') + 'Undo it any time up to close on your last day.',
      lead: whenPhrase
        ? 'You have cancelled ' + vpaEsc(opts.name || 'your venue') + '. You keep playing right '
          + 'through <b>' + vpaEsc(whenPhrase) + '</b>, to close, which is the end of the period '
          + 'you have already paid for. There is no further charge after that.'
        : 'You have cancelled ' + vpaEsc(opts.name || 'your venue') + '. It stays live until the end of '
          + 'the period you have already paid for, and there is no further charge after that.',
      rows: rows,
      /* WHAT THEY KEEP UNTIL THE LAST BELL. "It stays live" did not say that the screens go
         on earning: a venue reading this wants to know whether the advertising they sold to
         the bottle shop still runs on Friday night. It does. And the undo window closes at
         the same moment the games do, which was never stated: "any time before the last day"
         reads as though it shuts the night before. */
      /* The "Until close that day" row above already says the games run and the screens keep
         playing their advertising. A paragraph repeating it an inch below, in nearly the same
         words, read as though nobody had looked at the email whole. Seen by rendering it,
         17 Sep 2026. The undo is the only thing left to say here. */
      extra: '<p style="font-size:13.5px;color:#3a3a44;margin:0 0 18px">'
           + 'Changed your mind? You can undo this yourself on your billing page any time up to '
           + 'close on ' + (whenPhrase ? vpaEsc(whenPhrase) : 'your last day')
           + ', and nothing will have been interrupted.</p>',
      cta: 'Undo this cancellation',
    });
    /* "EMAILED" HAS TO MEAN EMAILED. vpaSendEmail returns whether Resend accepted the
       message and both call sites used to throw that away, so the audit row said the venue
       had been told even if every address was refused. Delivered and refused are recorded
       separately now, because an audit trail that cannot be wrong is not a record of
       anything. */
    const delivered = [], refused = [];
    for (const addr of to) {
      const ok = await vpaSendEmail(env, addr, 'Your VenuePlay cancellation is confirmed'
        + (ends ? ' - last day ' + ends : ''), html).catch(() => false);
      (ok ? delivered : refused).push(addr);
    }
    if (refused.length && !delivered.length) {
      await vpaFireDeliveryFailure(env, { kind: 'confirm', venueId: opts.venueId,
        name: opts.name, ends: ends, refused: refused });
    }
    await vpaInsert(env, 'vp_admin_audit', {
      action: refused.length && !delivered.length
        ? 'venue_cancel_confirm_NOT_emailed' : 'venue_cancel_confirm_emailed',
      target: 'venue:' + opts.venueId,
      detail: { accepted: delivered, refused: refused, ends: ends, name: opts.name || null },
    }, false).catch(() => {});
  } catch (_) { /* never let an email stop a cancellation */ }
}

/* WHAT TIME AND WHAT DAY IS IT WHERE THE VENUE IS?

   Intl is in the Workers runtime, so daylight saving comes from the tz database for free.
   An unknown timezone falls back to Brisbane, which is where this product started and the
   safest guess for an Australian venue. Same fallback as venueplay-game's session sweep,
   deliberately, so the two cannot disagree about what day it is somewhere. */
function vpaLocalHour(tz) {
  try {
    return parseInt(new Intl.DateTimeFormat('en-AU',
      { timeZone: tz || 'Australia/Brisbane', hour: 'numeric', hour12: false })
      .format(new Date()), 10);
  } catch (e) { return -1; }
}
function vpaLocalDate(ts, tz) {          // YYYY-MM-DD where the venue is
  try {
    return new Intl.DateTimeFormat('en-CA',
      { timeZone: tz || 'Australia/Brisbane', year: 'numeric', month: '2-digit', day: '2-digit' })
      .format(new Date(ts * 1000));
  } catch (e) { return ''; }
}
function vpaLocalWeekday(ts, tz) {       // "Friday"
  try {
    return new Intl.DateTimeFormat('en-AU',
      { timeZone: tz || 'Australia/Brisbane', weekday: 'long' }).format(new Date(ts * 1000));
  } catch (e) { return ''; }
}
function vpaDaysBetween(aYmd, bYmd) {    // whole days from a to b, both YYYY-MM-DD
  if (!aYmd || !bYmd) return null;
  const a = Date.UTC(+aYmd.slice(0, 4), +aYmd.slice(5, 7) - 1, +aYmd.slice(8, 10));
  const b = Date.UTC(+bYmd.slice(0, 4), +bYmd.slice(5, 7) - 1, +bYmd.slice(8, 10));
  return Math.round((b - a) / 86400000);
}

/* TWO DAYS OUT, AT 8AM WHERE THEY ARE.

   Dean, 16 Sep 2026: "lets tell them that <<DAY>> is their last day on VenuePlay and lets
   do that 48 hours prior i think at like 8am that day so they have 2 full days to think of
   it." So a venue whose last day is Friday hears on Wednesday morning and has Wednesday
   and Thursday to change its mind, rather than being told the night before when there is
   nothing left to decide.

   THE DAY IS NAMED, not just dated. "Friday is your last day" is what a publican actually
   plans around; "18 September 2026" is what a reader has to go and look up.

   REQUIRES AN HOURLY CRON TRIGGER ON THIS WORKER: "0 * * * *". On 16 Sep 2026 there was
   none at all, checked through the Cloudflare API: venueplay-api had no schedules and
   venueplay-game had "0 * * * *". Hourly rather than daily because 8am local is three
   different UTC hours across this country once Western Australia and daylight saving are
   both in play, so a once-a-day trigger can only ever be 8am for one of them. The 30-day
   archive sweep in this same handler has never run once for want of that trigger.

   Reads the end date from STRIPE, because nothing here stores it: vp_venues carries
   cancel_at_period_end as a flag and the date lives only on the subscription. Asking the
   source is also the only way to notice a date changed by hand in the Stripe dashboard.

   Sends once. An audit row per venue is the lock, so an hourly trigger cannot send the
   same venue the same warning twice. */
async function vpaLastDaySweep(env) {
  /* A SWEEP THAT RUNS AND SENDS NOTHING MUST NOT LOOK LIKE A CRON THAT NEVER FIRED.
     On 16 Sep the first hour of this was spent unable to tell those two apart, which is
     the same fault the session sweep already carried: "a sweep whose query failed used to
     print exactly what a quiet night prints. Say which." So every venue considered leaves
     a reason, and the caller records them whether or not anything was sent. */
  const why = [];
  if (!env.RESEND_API_KEY || !env.STRIPE_SECRET_KEY) {
    return { checked: 0, sent: 0, why: ['no RESEND_API_KEY or STRIPE_SECRET_KEY on this Worker'] };
  }
  const venues = await vpaSelect(env, 'vp_venues',
    /* created_at and max_players are read for the wrap at the bottom of the email: how long
       they have been with us, and what a night worked out at. Selected here rather than
       fetched per venue, because this runs hourly over every cancelling venue. */
    'status=eq.active&cancel_at_period_end=is.true'
    + '&select=id,name,founding_id,timezone,created_at,max_players') || [];
  let sent = 0;
  const byAccount = {};
  for (const v of venues) (byAccount[v.founding_id] = byAccount[v.founding_id] || []).push(v);

  for (const fid in byAccount) {
    let acct = null;
    try {
      const rows = await vpaSelect(env, 'venueplay_founding',
        'id=eq.' + encodeURIComponent(fid)
        + '&select=id,contact_email,stripe_subscription_id,contact_name&limit=1');
      acct = rows && rows[0];
    } catch (e) { why.push('account ' + fid + ': could not be read'); continue; }
    if (!acct || !acct.stripe_subscription_id) {
      why.push('account ' + fid + ': no Stripe subscription on file'); continue;
    }
    let endTs = 0, rate = '', founding = false, rateCents = 0;
    try {
      const sub = await vpbStripeGet(env, 'subscriptions/'
        + encodeURIComponent(acct.stripe_subscription_id));
      const item = (sub && sub.items && sub.items.data && sub.items.data[0]) || {};
      endTs = parseInt(sub.cancel_at || sub.current_period_end || item.current_period_end || 0, 10);
      /* THEIR rate, not a number typed into the copy. A founding venue is on $2.50 and a
         standard one on $3, and telling a venue it is about to lose a price it never had
         is worse than saying nothing. If Stripe does not give it, the paragraph says the
         same thing without a figure. */
      const cents = item && item.price && parseInt(item.price.unit_amount, 10);
      rate = (cents > 0) ? '$' + (cents / 100).toFixed(2) : '';
      rateCents = (cents > 0) ? cents : 0;      // the wrap works out a per-night figure from this
      /* Founding or standard, decided by the price the subscription actually carries and
         the Worker's own STRIPE_PRICE_* variables. No second list to drift. */
      const pid = (item && item.price && item.price.id) || '';
      founding = !!pid && (pid === env.STRIPE_PRICE_MONTHLY || pid === env.STRIPE_PRICE_ANNUAL);
    } catch (e) { why.push('account ' + fid + ': Stripe would not answer'); continue; }
    if (!endTs) { why.push('account ' + fid + ': no end date on the subscription'); continue; }

    for (const v of byAccount[fid]) {
      const tz = v.timezone;
      /* Two whole days, counted in DATES rather than in hours. A venue is not "48 hours
         out" at a fixed number of seconds: it is two sleeps away, and a date subtraction
         says that correctly through a daylight saving change where an hour count does not. */
      const today = vpaLocalDate(Math.floor(Date.now() / 1000), tz);
      const lastDay = vpaLocalDate(endTs, tz);
      const away = vpaDaysBetween(today, lastDay);
      if (away !== 2) {
        why.push(v.name + ': ' + away + ' day(s) out, not 2 (today ' + today + ', last day ' + lastDay + ')');
        continue;
      }
      /* FROM 8am, not AT 8am. An exact hour means one missed run loses the message
         entirely, because tomorrow the venue is one day out and no longer matches. That
         is not hypothetical: this shipped at 10:13 on the morning Wellshot was 47.9 hours
         from cancelling, so an exact-8 test would have skipped it at 11:00 and every hour
         after, and the only venue ever to cancel would have gone dark with no warning.
         The audit row below is what stops the hourly cron then sending it sixteen times. */
      const hr = vpaLocalHour(tz);
      if (hr < 8) { why.push(v.name + ': local time is ' + hr + ':00, waiting for 8am'); continue; }

      /* Either action counts as "already tried". A venue Resend refused is not re-sent
         every hour for the rest of the day; it is left in the log under its own action so
         somebody can see it and act. */
      const already = await vpaSelect(env, 'vp_admin_audit',
        'action=in.(venue_last_day_emailed,venue_last_day_NOT_emailed)&target=eq.'
        + encodeURIComponent('venue:' + v.id) + '&select=id&limit=1').catch(() => []);
      if (already && already.length) { why.push(v.name + ': already told'); continue; }
      const to = await vpaAccountContacts(env, acct, v.id);
      if (!to.length) { why.push(v.name + ': no email address on the account'); continue; }

      const day = vpaLocalWeekday(endTs, tz);
      const dated = vpaFmtDate(endTs);
      /* What they actually did with us, for the wrap at the bottom. Never allowed to stop
         the email: a venue must be told its last day even if not one number can be counted. */
      const stats = await vpaVenueStats(env, v.id, tz).catch(() => null);
      const tenure = vpaTenureWords(v.created_at, endTs * 1000);
      const wrap = vpaWrapHtml(stats, { rateCents: rateCents, players: v.max_players,
                                        months: vpaTenureMonths(v.created_at, endTs * 1000) });
      const html = vpaGoodbyeHtml(env, {
        day: day, dated: dated, name: v.name, tenure: tenure, wrap: wrap,
        rate: rate, founding: founding,
        hello: vpaHello(tz, acct && acct.contact_name, v.name),
      });
      const delivered = [], refused = [];
      for (const addr of to) {
        const ok = await vpaSendEmail(env, addr, day + ' is your last day on VenuePlay', html)
          .catch(() => false);
        (ok ? delivered : refused).push(addr);
      }
      /* The audit row is also the lock that stops this being sent twice, so it is written
         either way. But if NOT ONE address was accepted, it is written under a different
         action: a venue that was never told must not be filed alongside the ones that were,
         and it must be findable. */
      if (refused.length && !delivered.length) {
        await vpaFireDeliveryFailure(env, { kind: 'last_day', venueId: v.id,
          name: v.name, ends: day + ', ' + dated, refused: refused });
      }
      await vpaInsert(env, 'vp_admin_audit', {
        action: (refused.length && !delivered.length)
          ? 'venue_last_day_NOT_emailed' : 'venue_last_day_emailed',
        target: 'venue:' + v.id,
        detail: { accepted: delivered, refused: refused, ends: dated, day: day,
                  name: v.name || null, end_ts: endTs },
      }, false).catch(() => {});
      if (refused.length) why.push(v.name + ': Resend refused ' + refused.length + ' address(es)');
      if (delivered.length) sent++;
    }
  }
  return { checked: venues.length, sent: sent, why: why };
}

async function vpbCancelVenue(request, env, json) {
  const o = await vpbRequireOwner(request, env);
  if (o.error) return json({ error: o.error }, o.status);
  { const g = vpbOwnerOnly(o, json); if (g) return g; }   // cancelling a venue is owner-only

  const _b = await vpaBody(request, json);
  if (!_b.ok) return _b.res;
  const b = _b.body;
  const venueId = (b.venue_id || '').trim();
  const undo = b.undo === true;
  /* Never reject a cancellation over a form field. An unknown reason becomes 'other'
     and a missing one becomes null; neither stops them leaving. */
  const reason = (!undo && VPA_CANCEL_REASONS[String(b.reason || '')]) ? String(b.reason)
               : (!undo && b.reason ? 'other' : null);
  const reasonDetail = (!undo && b.reason_detail)
    ? String(b.reason_detail).replace(/[\x00-\x1f]+/g, ' ').trim().slice(0, 2000) : null;
  const venue = o.venues.filter((v) => v.id === venueId)[0];
  if (!venue) return json({ error: 'That venue is not on your account.' }, 403);

  const foundingId = o.account.id;
  /* AN UNDO HAS TO PUT THEM BACK ON.
     This only ever cleared the flag. If the paid period had already renewed, the invoice
     webhook had switched the venue off, so clearing the flag left an owner who had changed
     their mind with a suspended venue and nothing in the product to undo it. Found 16 Sep
     2026 on GFLAM GROUP PTY LTD: last action in the audit was an uncancel, and the venue
     was still suspended.

     Only reverses OUR OWN suspension. A venue switched off for not paying, or suspended by
     hand from HQ, is left exactly as it is: changing your mind about leaving does not settle
     an unpaid bill, and an undo must never be a way to turn your games back on. */
  const patch = { cancel_at_period_end: !undo };
  /* WHAT IT WAS, so a refusal from Stripe can put back EVERYTHING this writes and not just the
     flag. The write has to come before Stripe, because the new billed total is counted off
     these rows. But the rollback below used to restore cancel_at_period_end alone, so a venue
     whose subscription had genuinely ended pressed "Keep this venue", Stripe said no, the page
     said "nothing has changed", and the row was left active with nothing behind it collecting
     money. A second press then saw an active venue and skipped this branch for good.
     Found by audit, 20 Sep 2026. closed_at is read fresh because the owner lookup does not
     carry it, and a cleared retention clock that is not put back is a purge that never runs. */
  const before = { cancel_at_period_end: !!venue.cancel_at_period_end };
  if (undo && venue.status === 'suspended'
      && (venue.suspended_reason === 'cancelled' || venue.suspended_reason === 'ended')) {
    const rows = await vpaSelect(env, 'vp_venues', 'id=eq.' + encodeURIComponent(venueId) + '&select=closed_at&limit=1');
    before.status = venue.status;
    before.suspended_reason = venue.suspended_reason;
    before.closed_at = (rows && rows[0] && rows[0].closed_at) || null;
    patch.status = 'active';
    patch.suspended_reason = null;
    // Back on, so the 90-day retention clock stops, the same as every other way back on.
    patch.closed_at = null;
  }
  await vpaPatch(env, 'vp_venues', 'id=eq.' + encodeURIComponent(venueId), patch);

  // Remaining billed total now EXCLUDES venues flagged to cancel (vpbAccountTotal skips them).
  // The credit for the removed players applies at renewal.
  const info = await vpaSyncAccountQuantity(env, foundingId, o.account.stripe_subscription_id);
  // Telling an owner "it stays live until 14 September and then stops billing" when Stripe refused
  // the change is a promise about their money that we have not kept.
  if (info && info.syncFailed) {
    await vpaPatch(env, 'vp_venues', 'id=eq.' + encodeURIComponent(venueId), before);
    return json({ error: 'We could not update your billing just now, so nothing has changed. Please try again in a minute, or email accounts@venueplay.com.au.' }, 502);
  }
  const endsDate = info && info.periodEnd ? vpaFmtDate(info.periodEnd) : null;
  await vpaInsert(env, 'vp_admin_audit', {
    ...vpbActorFields(o),
    action: undo ? 'venue_cancel_undone' : 'venue_cancel_scheduled',
    target: 'venue:' + venueId,
    detail: { name: venue.name, ends: endsDate, actor_user: o.authUserId,
              reason: reason, reason_label: reason ? VPA_CANCEL_REASONS[reason] : null,
              reason_detail: reasonDetail },
  }, false).catch(() => {});

  /* Tell us, now, while there is still a window to ring them. Awaited so the write
     cannot be cancelled when the response returns, and caught so a mail failure can
     never stop a venue leaving. */
  await vpaFireCancelAlert(env, {
    venueId: venueId, name: venue.name, slug: venue.slug || '', undo: undo,
    ends: endsDate, players: venue.max_players,
    monthly: (info && info.monthly) || null,
    reason: reason, reasonDetail: reasonDetail,
  }).catch(() => {});

  /* AND TELL THE VENUE. Until 16 Sep 2026 the only email a cancellation produced went to
     dean@ and hello@: the owner clicked cancel and heard nothing back. Awaited so the
     write cannot be dropped when the response returns, caught so a mail failure can never
     stop somebody leaving. Not sent on an undo, which has its own confirmation on screen. */
  /* Their rate, read off the subscription itself, in case this cancellation turns out to be
     inside the last two days and the goodbye goes instead of the confirmation. vpbSubItem
     returns priceId and quantity and has never returned a rate, so reading info.rateCents
     gave undefined and the price warning would have been silently missing. */
  const _item = info && info.sub && info.sub.items && info.sub.items.data && info.sub.items.data[0];
  const _rateCents = (_item && _item.price && parseInt(_item.price.unit_amount, 10)) || 0;
  const _pid = (info && info.priceId) || '';
  const _founding = !!_pid && (_pid === env.STRIPE_PRICE_MONTHLY || _pid === env.STRIPE_PRICE_ANNUAL);

  if (!undo) {
    await vpaFireCancelConfirm(env, {
      venueId: venueId, name: venue.name, ends: endsDate, account: o.account,
      /* The raw timestamp and the venue's own timezone, so the email can say "Friday" and
         mean Friday where the pub is. Derived from the postcode when the row has no
         timezone, the same fallback the session sweep uses. */
      endTs: (info && info.periodEnd) || null,
      timezone: venue.timezone || vpaTimezoneFromPostcode(venue.postcode),
      /* Everything the goodbye needs, in case this turns out to be one. */
      createdAt: venue.created_at || null,
      players: venue.max_players || 0,
      /* READ OFF THE SUBSCRIPTION, because vpbSubItem returns priceId and quantity and has
         never returned a rate. info.rateCents was undefined, so the price warning would have
         been silently missing from this email and nothing would have said so. */
      rateCents: _rateCents,
      rate: _rateCents ? '$' + (_rateCents / 100).toFixed(2) : '',
      founding: _founding,
      contactName: o.account && o.account.contact_name,
    }).catch(() => {});
  }

  return json({ ok: true, cancelling: !undo, ends: endsDate });
}

/* --- Venue screen (what shows on /tv?<slug>): custom promo slides, the weekly
   members-draw schedule and the meat-raffle blurb. Editable from the Account page. --- */
function vpbScreenStr(s, n) { return String(s == null ? '' : s).replace(/[\x00-\x1f]+/g, ' ').slice(0, n).trim(); }
// Advertising slides are now uploaded IMAGES: {image_url, seconds, starts?, ends?}. The url
// must be one of our own storage URLs (set by /account/screen-upload) so nothing arbitrary can
// be pointed at the venue TV. seconds is clamped to 3..60; starts/ends are optional YYYY-MM-DD.
/* HOW MANY ADVERTISING IMAGES A VENUE MAY HAVE. Raised from 12 to 20 on Dean's word,
   17 Sep 2026. The number is written HERE and nowhere else in this Worker, and the gate
   makes billing.html agree with it, because it used to be a 12 in this line and a
   separate 12 in the page, which is two copies of one answer waiting to disagree. */
const VPB_MAX_SLIDES = 20;

/* THE BIGGEST IMAGE A VENUE MAY SEND. Written three times before: this check, the bucket's
   own file_size_limit, and an 8MB gate on billing.html that let a bigger one through. An
   animated GIF is never shrunk by the page, so a 7MB one arrived here and was refused after
   the whole upload, quoting a different number from the one the page had just quoted. The
   gate makes billing.html agree with this. Named 18 Sep 2026. */
const VPB_MAX_IMAGE_BYTES = 5 * 1024 * 1024;

function vpbCleanSlides(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.slice(0, VPB_MAX_SLIDES).map(function (s) {
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
/* ASK BEFORE CREATING, so a normal upload stops writing an error to the database log.

   This blind-POSTed the bucket on every single image upload. The bucket has existed since the
   first one, so every upload after that raised
     duplicate key value violates unique constraint "buckets_pkey"
   as a Postgres ERROR, plus a 400 in the edge log. Nothing broke, the upload carried on, and the
   comment below even said so. But it means the one place we look when something IS wrong is
   filled with entries from the thing working perfectly, and on 17 Sep it took a while to tell
   the real faults out of 2,234 lines. A log you have learned to ignore is not a log.

   HEAD is cheap and says the same thing. The create is still attempted when it is genuinely
   missing, and still swallowed if that races with another upload doing the same. */
async function vpbEnsureBucket(env, id, opts) {
  // opts { limit, types }: the logo bucket is 1 MB and PNG or WebP; the ad bucket keeps its own.
  opts = opts || {};
  const auth = { 'Authorization': 'Bearer ' + env.SUPABASE_SERVICE_KEY, 'apikey': env.SUPABASE_SERVICE_KEY };
  try {
    const look = await fetch(env.SUPABASE_URL + '/storage/v1/bucket/' + encodeURIComponent(id), { headers: auth });
    if (look.ok) return;                      // already there, which is the normal case
  } catch (_) { /* could not ask: fall through and try to create it */ }
  try {
    await fetch(env.SUPABASE_URL + '/storage/v1/bucket', {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, auth),
      body: JSON.stringify({ id: id, name: id, public: true, file_size_limit: opts.limit || VPB_MAX_IMAGE_BYTES, allowed_mime_types: opts.types || ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] }),
    });
  } catch (_) { /* two uploads racing to create it: the second 400s and the upload still works */ }
}

/* --- POST /account/screen-upload : upload one advertising image to storage, return its URL. --- */
async function vpbScreenUpload(request, env, json) {
  const o = await vpbRequireOwner(request, env);
  if (o.error) return json({ error: o.error }, o.status);
  if (!vpbCan(o, 'advertising')) return json({ error: 'You do not have permission to change advertising.' }, 403);
  const _b = await vpaBody(request, json);
  if (!_b.ok) return _b.res;
  const b = _b.body;
  const venueId = (b.venue_id || '').trim();
  const venue = o.venues.filter(function (v) { return v.id === venueId; })[0];
  if (!venue) return json({ error: 'That venue is not on your account.' }, 403);

  const m = String(b.data || '').match(/^data:([^;]+);base64,(.+)$/);
  if (!m) return json({ error: 'That did not look like an image.' }, 400);
  const contentType = m[1].toLowerCase();
  if (!/^image\/(png|jpe?g|webp|gif)$/.test(contentType)) return json({ error: 'Use a PNG, JPG, WEBP or GIF.' }, 400);
  const bytes = vpaB64ToBytes(m[2]);
  if (bytes.length > VPB_MAX_IMAGE_BYTES) return json({ error: 'That image is too big. Keep it under '
    + Math.round(VPB_MAX_IMAGE_BYTES / (1024 * 1024)) + 'MB.' }, 400);

  await vpbEnsureBucket(env, 'venue-ads');
  const ext = contentType.split('/')[1].replace('jpeg', 'jpg');
  const path = venueId + '/' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.' + ext;
  const up = await fetch(env.SUPABASE_URL + '/storage/v1/object/venue-ads/' + path, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + env.SUPABASE_SERVICE_KEY, 'apikey': env.SUPABASE_SERVICE_KEY, 'Content-Type': contentType, 'x-upsert': 'true' },
    body: bytes,
  });
  if (!up.ok) { const t = await up.text(); return json({ error: 'Upload failed. ' + t.slice(0, 160) }, 500); }
  const adUrl = env.SUPABASE_URL + '/storage/v1/object/public/venue-ads/' + path;
  /* The file is stored, not yet on the screen (the page's save puts it there, and that save is
     recorded with the row before and after). This row is the proof the file was uploaded, by
     whom, and where it lives, even if the save never happens. */
  try {
    await vpaInsert(env, 'vp_admin_audit', {
      ...vpbActorFields(o), action: 'slide_uploaded', target: 'venue:' + venueId,
      detail: { via: o.actingAsAdmin ? 'hq_view_as' : 'venue', user: o.authUserId || null,
                url: adUrl, bytes: bytes.length, type: contentType },
    }, false);
  } catch (e) { console.error('slide upload audit failed', venueId, String((e && e.message) || e).slice(0, 200)); }
  return json({ ok: true, url: adUrl });
}

/* ---------------------------------------------------------------------------------------
   THE VENUE'S LOGO. Dean, 7 Aug 2026; built properly 16 Oct 2026 (migration 102).

   The logo used to go up through /account/screen-upload, the ADVERTISING route: any image
   type up to 5 MB, the type taken from what the browser SAID it was, into the ad bucket,
   and then /account/screen-save stored whatever http address it was handed. That address
   is painted on every TV the venue has AND on the public homepage strip, so a logo was the
   one venue-supplied URL that reaches strangers, and it was the least checked.

   Now a logo has its own route. It is a PNG or a WebP, judged by its first bytes and not by
   its label; it is 1 MB or less; its width and height are read from the file header (never
   decoded) and must be sensible; it goes to the public "venue-logos" bucket under
   <venue_id>/<sha256>.<ext>, so the same file uploaded twice is one object and a changed
   file is a new address no screen can have cached; and only the Worker writes the URL.
   --------------------------------------------------------------------------------------- */
const VPB_MAX_LOGO_BYTES = 1024 * 1024;   // 1 MB. billing.html quotes this same number.
const VPB_LOGO_MIN_PX = 16, VPB_LOGO_MAX_PX = 4096;

/* What the bytes ARE, from the header alone. { type, ext, w, h, alpha } or null.
   PNG: the 8-byte signature, then IHDR's width and height (big-endian) at 16 and 20, and its
        colour type at 25 (4 and 6 carry alpha; a tRNS chunk gives the others transparency).
   WebP: RIFF....WEBP, then one of three chunks: 'VP8 ' (lossy, 14-bit sizes at 26), 'VP8L'
        (lossless, 14-bit sizes packed from byte 21, alpha bit after them) or 'VP8X'
        (extended: flags at 20 with alpha 0x10, 24-bit sizes minus one at 24 and 27). */
function vpbLogoSniff(b) {
  if (!b || b.length < 30) return null;
  const u32be = function (i) { return ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3]; };
  const PNG = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
  if (PNG.every(function (x, i) { return b[i] === x; })) {
    if (String.fromCharCode(b[12], b[13], b[14], b[15]) !== 'IHDR') return null;
    const ct = b[25];
    let alpha = ct === 4 || ct === 6;
    if (!alpha) {
      // Walk the chunks to the first IDAT looking for tRNS. Header only: stop at the pixels.
      let at = 8;
      while (at + 8 <= b.length) {
        const len = u32be(at), name = String.fromCharCode(b[at + 4], b[at + 5], b[at + 6], b[at + 7]);
        if (name === 'tRNS') { alpha = true; break; }
        if (name === 'IDAT' || name === 'IEND') break;
        at += 12 + len;
      }
    }
    return { type: 'image/png', ext: 'png', w: u32be(16), h: u32be(20), alpha: alpha };
  }
  const tag = function (i) { return String.fromCharCode(b[i], b[i + 1], b[i + 2], b[i + 3]); };
  if (tag(0) === 'RIFF' && tag(8) === 'WEBP') {
    const chunk = tag(12);
    if (chunk === 'VP8 ') {
      return { type: 'image/webp', ext: 'webp', w: (b[26] | (b[27] << 8)) & 0x3fff, h: (b[28] | (b[29] << 8)) & 0x3fff, alpha: false };
    }
    if (chunk === 'VP8L' && b[20] === 0x2f) {
      const bits = (b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24)) >>> 0;
      return { type: 'image/webp', ext: 'webp', w: (bits & 0x3fff) + 1, h: ((bits >>> 14) & 0x3fff) + 1, alpha: !!((bits >>> 28) & 1) };
    }
    if (chunk === 'VP8X') {
      return { type: 'image/webp', ext: 'webp', w: (b[24] | (b[25] << 8) | (b[26] << 16)) + 1, h: (b[27] | (b[28] << 8) | (b[29] << 16)) + 1, alpha: !!(b[20] & 0x10) };
    }
  }
  return null;
}

/* Is this a logo address this Worker could have written for this venue? Our public storage,
   the venue's own folder, in the logo bucket (or the ad bucket, where every logo uploaded
   before 16 Oct 2026 lives). Anything else is refused on save and left off the homepage. */
function vpbOurLogoUrl(env, url, venueId) {
  if (typeof url !== 'string' || !url || !env.SUPABASE_URL) return false;
  const base = env.SUPABASE_URL + '/storage/v1/object/public/';
  if (url.indexOf(base) !== 0) return false;
  const rest = url.slice(base.length);
  const m = /^(venue-logos|venue-ads)\/([0-9a-fA-F-]{36})\/[A-Za-z0-9._-]{1,120}$/.exec(rest);
  if (!m) return false;
  return venueId ? m[2] === venueId : true;
}

async function vpbSha256Hex(bytes) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  let s = '';
  for (let i = 0; i < d.length; i++) s += (d[i] < 16 ? '0' : '') + d[i].toString(16);
  return s;
}

/* ---------------------------------------------------------------------------------------
   A VENUE'S SCREEN NEVER CHANGES WITHOUT A RECORD (migration 114, 21 Oct 2026).

   Dean uploaded Tugun Bowls Club's logo and its ad slides; weeks later there was no screen row,
   no stored file and no audit entry, and nobody could say what happened. So every write to
   vp_venue_screen goes through vpbWriteScreen, which:
     - names who is writing in an X-VP-Actor header. Migration 114's trigger reads it inside the
       same transaction and writes it into vp_venue_screen_history with the row before and after,
       so the record cannot be lost the way a separate audit insert can. A change made anywhere
       else (the dashboard, the SQL editor, a cascade) is recorded by the same trigger as 'direct'.
     - is preceded by a read of the row as it was, so the vp_admin_audit row carries a before and
       after summary (addresses, counts and the raffle label: never image data).
   The header is ASCII only: a fetch header cannot carry other characters, and a venue name with
   an accent in it must not be what stops a logo saving.
   --------------------------------------------------------------------------------------- */
function vpbAsciiHeader(s, n) {
  return String(s == null ? '' : s).replace(/[^\x20-\x7e]/g, '?').slice(0, n || 1800);
}
/* Who is writing, from a vpbRequireOwner result. via says which door: the venue's own login,
   or a Gflam admin using View as from HQ. */
function vpbScreenActor(o, route) {
  return {
    via: o.actingAsAdmin ? 'hq_view_as' : 'venue',
    route: route,
    user: o.authUserId || null,
    admin: o.adminActor ? o.adminActor.id : null,
    label: o.adminActor ? o.adminActor.label : (o.role || 'owner'),
    role: o.role || null,
  };
}
/* The row as it stands. ok:false when it could not be read (never "there is no row"). */
async function vpbReadScreen(env, venueId) {
  try {
    const res = await fetch(env.SUPABASE_URL + '/rest/v1/vp_venue_screen?venue_id=eq.' + encodeURIComponent(venueId)
      + '&select=venue_id,slug,slides,draws,raffle,logo_url,updated_at&limit=1', { headers: vpaHeaders(env) });
    if (!res.ok) return { ok: false, row: null };
    const rows = await res.json();
    return { ok: Array.isArray(rows), row: (Array.isArray(rows) && rows[0]) || null };
  } catch (_) { return { ok: false, row: null }; }
}
/* What a person needs to know about a screen, small enough for an audit row. */
function vpbScreenSummary(row) {
  if (!row) return null;
  const slides = Array.isArray(row.slides) ? row.slides : [];
  return {
    logo_url: row.logo_url || null,
    slides: slides.length,
    slide_urls: slides.slice(0, VPB_MAX_SLIDES).map(function (s) { return (s && s.image_url) || null; }),
    raffle: row.raffle && row.raffle.label ? String(row.raffle.label).slice(0, 60) : (row.raffle ? '(set)' : null),
    draws: Array.isArray(row.draws) ? row.draws.length : 0,
  };
}
/* THE one write to vp_venue_screen. An upsert on venue_id: only the columns in row change. */
async function vpbWriteScreen(env, row, actor) {
  return await fetch(env.SUPABASE_URL + '/rest/v1/vp_venue_screen', {
    method: 'POST',
    headers: { ...vpaHeaders(env), 'Prefer': 'resolution=merge-duplicates,return=minimal',
               'X-VP-Actor': vpbAsciiHeader(JSON.stringify(actor || { via: 'unknown' })) },
    body: JSON.stringify(row),
  });
}
/* The audit row for a screen change, with before and after. Awaited, and a failure is logged:
   it used to vanish inside .catch(function () {}), which is one way a change leaves no trace. */
async function vpbScreenAudit(env, o, action, venueId, before, after, extra) {
  try {
    await vpaInsert(env, 'vp_admin_audit', {
      ...vpbActorFields(o), action: action, target: 'venue:' + venueId,
      detail: Object.assign({
        via: o.actingAsAdmin ? 'hq_view_as' : 'venue', user: o.authUserId || null,
        before: before === undefined ? 'unread' : vpbScreenSummary(before), after: vpbScreenSummary(after),
      }, extra || {}),
    }, false);
  } catch (e) {
    console.error('screen audit failed', action, venueId, String((e && e.message) || e).slice(0, 200));
  }
}

/* Write vp_venue_screen.logo_url for one venue, the same upsert /account/screen-save uses, so
   saving the logo never touches the slides and saving the slides never touches the logo. */
async function vpbWriteLogo(env, venue, url, actor) {
  const row = { venue_id: venue.id, slug: venue.slug, logo_url: url, updated_at: new Date().toISOString() };
  const res = await vpbWriteScreen(env, row, actor);
  return res.ok;
}

/* The three logo routes share one door: signed in, owner or a manager with the advertising
   right, and the venue named must be one this login holds. A host has no owner/manager row
   and is refused by vpbRequireOwner before any of this. */
async function vpbLogoDoor(request, env, json) {
  const o = await vpbRequireOwner(request, env);
  if (o.error) return { res: json({ error: o.error }, o.status) };
  if (!vpbCan(o, 'advertising')) return { res: json({ error: 'You do not have permission to change the logo.' }, 403) };
  const _b = await vpaBody(request, json);
  if (!_b.ok) return { res: _b.res };
  const b = _b.body;
  const venueId = String(b.venue_id || '').trim();
  const venue = o.venues.filter(function (v) { return v.id === venueId; })[0];
  if (!venue) return { res: json({ error: 'That venue is not on your account.' }, 403) };
  return { o: o, b: b, venue: venue };
}

/* --- POST /account/logo-upload { venue_id, data } : data is a data: URL or bare base64. --- */
async function vpbLogoUpload(request, env, json) {
  const g = await vpbLogoDoor(request, env, json);
  if (g.res) return g.res;
  const raw = String(g.b.data || '');
  const m = raw.match(/^data:[^;,]*;base64,(.+)$/);
  const b64 = (m ? m[1] : raw).replace(/\s+/g, '');
  if (!b64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return json({ error: 'That did not look like an image.' }, 400);
  // Refuse on the encoded length first: four characters carry three bytes, so nothing this
  // long can decode to 1 MB or less, and a 40 MB string is never decoded at all.
  if (Math.floor(b64.length * 3 / 4) > VPB_MAX_LOGO_BYTES + 2) {
    return json({ error: 'That logo is too big. Keep it to 1MB or less.' }, 413);
  }
  let bytes;
  try { bytes = vpaB64ToBytes(b64); } catch (_) { return json({ error: 'That did not look like an image.' }, 400); }
  if (bytes.length > VPB_MAX_LOGO_BYTES) return json({ error: 'That logo is too big. Keep it to 1MB or less.' }, 413);
  const kind = vpbLogoSniff(bytes);
  if (!kind) return json({ error: 'Use a PNG (or a WebP). A PNG with a transparent background sits best on the screen.' }, 415);
  if (kind.w < VPB_LOGO_MIN_PX || kind.h < VPB_LOGO_MIN_PX) {
    return json({ error: 'That logo is only ' + kind.w + ' by ' + kind.h + ' pixels, too small to read on a TV. Use one at least 200 pixels wide.' }, 400);
  }
  if (kind.w > VPB_LOGO_MAX_PX || kind.h > VPB_LOGO_MAX_PX) {
    return json({ error: 'That logo is ' + kind.w + ' by ' + kind.h + ' pixels. Keep it under ' + VPB_LOGO_MAX_PX + ' pixels each way.' }, 400);
  }

  await vpbEnsureBucket(env, 'venue-logos', { limit: VPB_MAX_LOGO_BYTES, types: ['image/png', 'image/webp'] });
  const path = g.venue.id + '/' + (await vpbSha256Hex(bytes)) + '.' + kind.ext;
  const up = await fetch(env.SUPABASE_URL + '/storage/v1/object/venue-logos/' + path, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + env.SUPABASE_SERVICE_KEY, 'apikey': env.SUPABASE_SERVICE_KEY,
               'Content-Type': kind.type, 'x-upsert': 'true', 'cache-control': 'max-age=31536000' },
    body: bytes,
  });
  if (!up.ok) { const t = await up.text(); return json({ error: 'Upload failed. ' + t.slice(0, 160) }, 500); }
  const url = env.SUPABASE_URL + '/storage/v1/object/public/venue-logos/' + path;
  const was = await vpbReadScreen(env, g.venue.id);
  if (!(await vpbWriteLogo(env, g.venue, url, vpbScreenActor(g.o, 'logo-upload')))) return json({ error: 'The logo uploaded but could not be saved. Try again.' }, 500);
  await vpbScreenAudit(env, g.o, 'logo_set', g.venue.id, was.ok ? was.row : undefined,
    Object.assign({}, was.row || {}, { logo_url: url }),
    { bytes: bytes.length, type: kind.type, w: kind.w, h: kind.h, alpha: kind.alpha });
  return json({ ok: true, url: url, width: kind.w, height: kind.h, transparent: kind.alpha });
}

/* --- POST /account/logo-remove { venue_id } : the TV and the website stop showing it. --- */
async function vpbLogoRemove(request, env, json) {
  const g = await vpbLogoDoor(request, env, json);
  if (g.res) return g.res;
  const was = await vpbReadScreen(env, g.venue.id);
  if (!(await vpbWriteLogo(env, g.venue, null, vpbScreenActor(g.o, 'logo-remove')))) return json({ error: 'Could not remove the logo. Try again.' }, 500);
  await vpbScreenAudit(env, g.o, 'logo_removed', g.venue.id, was.ok ? was.row : undefined,
    Object.assign({}, was.row || {}, { logo_url: null }));
  return json({ ok: true });
}

/* --- POST /account/logo-site : RETIRED 20 Oct 2026 (migration 111). ---
   Dean: "I dont want a venue to be able to put it on our website we should choose". Whether a
   venue's logo is on venueplay.com.au is now HQ's switch (/admin/venue-gaming show_logo_on_site,
   owner and accounts admins only). This answers 410 for any page still open from before the
   release, and writes nothing. */
async function vpbLogoSite(request, env, json) {
  return json({ error: 'VenuePlay now chooses which venue logos appear on its website. Nothing was changed.' }, 410);
}

/* ---------------------------------------------------------------------------------------
   GET /trusted-logos : the homepage "Trusted by" strip. PUBLIC, no login.

   Answers ONLY { name, logo_url } per venue, and only for a venue that is all of:
     chosen       show_logo_on_site true. Since migration 111 (20 Oct 2026) that is HQ's switch
                  (HQ > Venues > Details > "Show logo on our website"), never the venue's: Dean,
                  "I dont want a venue to be able to put it on our website we should choose".
                  Asked of the DATABASE, so if the column is missing the read is refused and the
                  strip shows nobody: it fails closed.
     live         vp_venues.status 'active'
     real         not one of Dean's test venues: no test-alpha/bravo/charlie or other "test"
                  slug or name, even if somebody switches one on
     ours         a logo URL this Worker wrote, in our own public storage for that venue
   Because a person at HQ now chooses each venue, the old "paying" and "not a 1-player plan"
   rules are gone: Dean wants The Mini Bar (his own real business, on a 1-player plan) shown.
   hide_from_trusted (migration 54, HQ's old "Hide from homepage") is no longer read: one HQ
   switch says yes or no, so there are not two flags to disagree.
   Fewer than six and the PAGE hides the whole strip (VPTrusted.MIN in /app/vp-trusted.js),
   so it never reads as one lonely logo. Cached for ten minutes.
   --------------------------------------------------------------------------------------- */
const VPB_TEST_SLUG_RE = /(^|-)test(-|$)/i;
function vpbTrustedVenueIsReal(v) {
  if (!v) return false;
  if (VPB_TEST_SLUG_RE.test(String(v.slug || '')) || /^\s*test\b/i.test(String(v.name || ''))) return false;
  return true;
}
async function vpbTrustedLogos(env) {
  const venues = await vpaSelectAll(env, 'vp_venues',
    'status=eq.active&show_logo_on_site=eq.true'
    + '&select=id,name,slug&order=id.asc');
  const real = venues.filter(vpbTrustedVenueIsReal);
  if (!real.length) return [];
  const inList = function (ids) { return '(' + ids.map(encodeURIComponent).join(',') + ')'; };
  const screens = await vpaSelectAll(env, 'vp_venue_screen',
    'venue_id=in.' + inList(real.map(function (v) { return v.id; })) + '&select=venue_id,logo_url&order=venue_id.asc');
  const logoOf = {};
  screens.forEach(function (s) { if (vpbOurLogoUrl(env, s.logo_url, s.venue_id)) logoOf[s.venue_id] = s.logo_url; });
  return real.filter(function (v) { return logoOf[v.id]; })
    .map(function (v) { return { name: String(v.name || '').slice(0, 120), logo_url: logoOf[v.id] }; })
    .sort(function (a, b) { return a.name < b.name ? -1 : (a.name > b.name ? 1 : 0); });
}
async function vpbTrustedLogosRoute(env, json) {
  let logos = [];
  try { logos = await vpbTrustedLogos(env); } catch (_) { logos = []; }   // closed, never a partial list
  const res = json({ logos: logos }, 200);
  // json() takes no headers, so the cache line goes on afterwards. Ten minutes at the edge and
  // in the browser: the homepage is the busiest page there is, and this list barely moves.
  try { res.headers.set('cache-control', 'public, max-age=600'); } catch (_) {}
  return res;
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
  /* No show_logo_on_site here any more: whether the logo is on our website is HQ's choice since
     migration 111, and the Screen tab no longer has the tick. */
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
  const _b = await vpaBody(request, json);
  if (!_b.ok) return _b.res;
  const b = _b.body;
  const venueId = (b.venue_id || '').trim();
  const venue = o.venues.filter(function (v) { return v.id === venueId; })[0];
  if (!venue) return json({ error: 'That venue is not on your account.' }, 403);

  if (b.slides !== undefined && !vpbCan(o, 'advertising')) return json({ error: 'You do not have permission to change advertising.' }, 403);
  /* SAY NO OUT LOUD. vpbCleanSlides slices to the cap, so a venue that sent 25 used to get
     "Saved" and quietly lose five of them, with nothing on screen to say which. */
  if (Array.isArray(b.slides) && b.slides.length > VPB_MAX_SLIDES) {
    return json({ error: 'That is ' + b.slides.length + ' images. A venue can have up to '
                         + VPB_MAX_SLIDES + '. Remove ' + (b.slides.length - VPB_MAX_SLIDES)
                         + ' and save again.' }, 400);
  }
  if (b.raffle !== undefined && !vpbCan(o, 'draws_raffles')) return json({ error: 'You do not have permission to change raffles.' }, 403);

  // Partial update: only the parts sent are changed. The advertising section sends slides;
  // the raffle section sends raffle. That way saving one never wipes the other.
  const row = { venue_id: venueId, slug: venue.slug, updated_at: new Date().toISOString() };
  if (b.slides !== undefined) row.slides = vpbCleanSlides(b.slides);
  if (b.draws !== undefined) row.draws = vpbCleanDraws(b.draws);
  if (b.raffle !== undefined) row.raffle = vpbCleanRaffle(b.raffle);
  /* THE LOGO IS NOT A FREE-TEXT ADDRESS. This stored any string starting "http", and the logo is
     painted on every TV the venue has and on the public homepage strip. A logo now goes up
     through /account/logo-upload, which writes the address itself; here it can only be cleared,
     or set to an address in our own storage for THIS venue (what that route, or the old ad
     upload, produced). Same right as the slides: it is the venue's branding on its screens. */
  if (b.logo_url !== undefined) {
    if (!vpbCan(o, 'advertising')) return json({ error: 'You do not have permission to change the logo.' }, 403);
    if (b.logo_url === null || b.logo_url === '') row.logo_url = null;
    else if (vpbOurLogoUrl(env, b.logo_url, venueId)) row.logo_url = b.logo_url;
    else return json({ error: 'Upload the logo on this page rather than pasting an address.' }, 400);
  }
  const was = await vpbReadScreen(env, venueId);
  const res = await vpbWriteScreen(env, row, vpbScreenActor(o, 'screen-save'));
  if (!res.ok) {
    const t = await res.text();
    return json({ error: 'Could not save your screen. ' + t.slice(0, 180) }, 500);
  }
  /* "after" is the row as it now stands: the parts sent laid over the parts that were there. */
  await vpbScreenAudit(env, o, 'screen_updated', venueId, was.ok ? was.row : undefined,
    Object.assign({}, was.row || {}, row),
    { changed: Object.keys(row).filter(function (k) { return k !== 'venue_id' && k !== 'slug' && k !== 'updated_at'; }) });
  return json({ ok: true, slug: venue.slug });
}

/* ---------------------------------------------------------------------------------------
   HQ > Venues > Details > Screen history.   GET /admin/screen-history?venue_id=
                                             POST /admin/screen-restore { venue_id, history_id }

   Reads vp_venue_screen_history (migration 114): every version of a venue's logo, slides and
   raffle, who changed it and through which door, newest first. Any Gflam admin may look; only
   owner and accounts admins may put a version back, and the restore is itself a recorded change
   (via 'hq_restore', naming the version it came from) plus an audit row. A venue login reaches
   neither route (vpaRequireAdmin) and cannot read the table (no grant).

   The history is still shown when the venue row has gone, because that is exactly when it is
   needed; it just cannot be restored onto a venue that does not exist.
   --------------------------------------------------------------------------------------- */
const VPA_SCREEN_HISTORY_LIMIT = 100;

function vpaScreenSlidesOf(row) { return row && Array.isArray(row.slides) ? row.slides : []; }
function vpaScreenRaffleLabel(row) {
  const r = row && row.raffle;
  if (!r) return null;
  return [r.label, r.day, r.time].filter(Boolean).join(', ') || '(set)';
}
/* What changed, in words. One answer, used by the HQ list and by the test. */
function vpaScreenChanges(op, o, n) {
  const slidesSaid = function (row) { const k = vpaScreenSlidesOf(row).length; return k + ' slide' + (k === 1 ? '' : 's'); };
  const what = function (row) {
    const bits = [slidesSaid(row)];
    if (row && row.logo_url) bits.unshift('a logo');
    if (vpaScreenRaffleLabel(row)) bits.push('raffle "' + vpaScreenRaffleLabel(row) + '"');
    return bits.join(', ');
  };
  if (op === 'baseline') return ['How the screen stood when this record began: ' + what(n) + '.'];
  if (op === 'insert') return ['Screen settings created: ' + what(n) + '.'];
  if (op === 'delete') return ['The whole screen row was DELETED. It held ' + what(o) + '.'];
  if (op === 'vanished') return ['The screen row DISAPPEARED with no record of a delete (found by the nightly check). It last held ' + what(o) + '.'];
  const out = [];
  if (op === 'drift') out.push('Changed outside VenuePlay with no record (found by the nightly check).');
  const ol = (o && o.logo_url) || null, nl = (n && n.logo_url) || null;
  if (!ol && nl) out.push('Logo added.');
  else if (ol && !nl) out.push('Logo removed.');
  else if (ol && nl && ol !== nl) out.push('Logo replaced.');
  const os = vpaScreenSlidesOf(o).map(function (s) { return (s && s.image_url) || ''; });
  const ns = vpaScreenSlidesOf(n).map(function (s) { return (s && s.image_url) || ''; });
  const added = ns.filter(function (u) { return os.indexOf(u) === -1; }).length;
  const removed = os.filter(function (u) { return ns.indexOf(u) === -1; }).length;
  if (added || removed) {
    out.push('Slides ' + os.length + ' to ' + ns.length + ' (' + [added ? added + ' added' : '', removed ? removed + ' removed' : '']
      .filter(Boolean).join(', ') + ').');
  } else if (JSON.stringify(vpaScreenSlidesOf(o)) !== JSON.stringify(vpaScreenSlidesOf(n))) {
    out.push('Slide order, timing or dates changed.');
  }
  const or = vpaScreenRaffleLabel(o), nr = vpaScreenRaffleLabel(n);
  if (or !== nr) out.push(nr ? 'Raffle set to "' + nr + '".' : 'Raffle cleared.');
  if (JSON.stringify((o && o.draws) || []) !== JSON.stringify((n && n.draws) || [])) out.push('Draws changed.');
  if (!out.length) out.push('Saved with no visible change.');
  return out;
}
/* Who, in words, from what the trigger recorded. */
function vpaScreenWho(h) {
  const a = (h && h.actor && typeof h.actor === 'object') ? h.actor : {};
  const label = String(a.label || '').slice(0, 80);
  switch (h && h.via) {
    case 'venue':         return (label || 'venue login') + ' (the venue\'s own login)';
    case 'hq_view_as':    return (label || 'Gflam admin') + ' (HQ, View as)';
    case 'hq_restore':    return (label || 'Gflam admin') + ' (HQ, Restore this version)';
    case 'migration':     return 'Migration 114, when this record began';
    case 'nightly-check': return 'The nightly check';
    case 'direct':        return 'NOT through VenuePlay: a direct database change (' + vpaDirectDoor(h) + ')';
    default:              return label || String((h && h.via) || 'unknown');
  }
}
/* Which door a direct change came through, in words (HQ shows this line; the raw database user is
   still in the entry's Details). 'postgres' is the Supabase dashboard or SQL editor; the service key
   is a script or another Worker; anything else is named as it is. */
function vpaDirectDoor(h) {
  var u = (h && h.db_session_user) || '', r = (h && (h.jwt_role || h.db_role)) || '';
  if (r === 'service_role') return 'a script or tool using the service key';
  if (u === 'postgres' || u === 'supabase_admin') return 'the Supabase dashboard or SQL editor';
  return [u, r].filter(Boolean).join(', ') || 'unknown';
}
/* The version an entry stands for: the row after the change, or for a delete, the row that was lost. */
function vpaScreenVersionRow(h) { return (h && (h.new_row || h.old_row)) || null; }
function vpaScreenVersion(row) {
  if (!row) return null;
  return {
    logo_url: row.logo_url || null,
    slides: vpaScreenSlidesOf(row).map(function (s) {
      s = s || {};
      const o = { image_url: s.image_url || null, seconds: s.seconds || null };
      if (s.starts) o.starts = s.starts;
      if (s.ends) o.ends = s.ends;
      return o;
    }),
    raffle: vpaScreenRaffleLabel(row),
    draws: Array.isArray(row.draws) ? row.draws.length : 0,
  };
}
async function vpaReadScreenHistory(env, query) {
  const res = await fetch(env.SUPABASE_URL + '/rest/v1/vp_venue_screen_history?' + query, { headers: vpaHeaders(env) });
  if (!res.ok) {
    const t = (await res.text().catch(function () { return ''; })).slice(0, 200);
    return { ok: false, missing: res.status === 404 || /vp_venue_screen_history|PGRST205|42P01/.test(t), error: t };
  }
  const rows = await res.json();
  return { ok: Array.isArray(rows), rows: Array.isArray(rows) ? rows : [] };
}

async function vpaHandleScreenHistory(request, env, json) {
  const actor = await vpaRequireAdmin(request, env, null);
  if (actor.error) return json({ error: actor.error }, actor.status);
  const url = new URL(request.url);
  const venueId = (url.searchParams.get('venue_id') || '').trim();
  if (!/^[0-9a-fA-F-]{36}$/.test(venueId)) return json({ error: 'venue_id is required.' }, 400);
  const vid = encodeURIComponent(venueId);
  const vrows = await vpaSelect(env, 'vp_venues', 'id=eq.' + vid + '&select=id,name,slug&limit=1');
  const venue = (vrows && vrows[0]) || null;
  const h = await vpaReadScreenHistory(env, 'venue_id=eq.' + vid
    + '&select=id,op,old_row,new_row,changed_at,actor,via,db_session_user,db_role,jwt_role'
    + '&order=id.desc&limit=' + VPA_SCREEN_HISTORY_LIMIT);
  if (!h.ok) {
    if (h.missing) return json({ ok: true, known: false, venue: venue, entries: [],
      note: 'Screen history starts when migration 114 is run. Nothing is recorded before that.' });
    return json({ error: 'Could not read the screen history. ' + (h.error || '') }, 500);
  }
  const now = await vpbReadScreen(env, venueId);
  /* Files uploaded through the Worker, from the audit, so a file that went up but was never
     saved onto the screen (or whose row later vanished) can still be found. */
  const ups = await vpaSelect(env, 'vp_admin_audit', 'target=eq.' + encodeURIComponent('venue:' + venueId)
    + '&action=in.(slide_uploaded,logo_set)&select=created_at,action,actor_label,detail&order=created_at.desc&limit=60') || [];
  const can = actor.role === 'owner' || actor.role === 'accounts';
  return json({
    ok: true, known: true, can_restore: can,
    venue: venue,
    current: now.ok ? vpaScreenVersion(now.row) : null,
    entries: h.rows.map(function (e) {
      const row = vpaScreenVersionRow(e);
      return {
        id: e.id, at: e.changed_at, op: e.op, via: e.via, who: vpaScreenWho(e),
        changes: vpaScreenChanges(e.op, e.old_row, e.new_row),
        version: vpaScreenVersion(row),
        restorable: !!row && !!venue,
      };
    }),
    uploads: ups.map(function (a) {
      const d = a.detail || {};
      return { at: a.created_at, what: a.action === 'logo_set' ? 'logo' : 'slide', by: a.actor_label || null,
               url: d.url || (d.after && d.after.logo_url) || null };
    }).filter(function (u) { return !!u.url; }),
  });
}

async function vpaHandleScreenRestore(request, env, json) {
  const actor = await vpaRequireAdmin(request, env, ['owner', 'accounts']);
  if (actor.error) return json({ error: actor.error }, actor.status);
  const _b = await vpaBody(request, json);
  if (!_b.ok) return _b.res;
  const b = _b.body;
  const venueId = String(b.venue_id || '').trim();
  const hid = parseInt(b.history_id, 10);
  if (!/^[0-9a-fA-F-]{36}$/.test(venueId) || !(hid > 0)) return json({ error: 'venue_id and history_id are required.' }, 400);
  const h = await vpaReadScreenHistory(env, 'id=eq.' + hid + '&venue_id=eq.' + encodeURIComponent(venueId)
    + '&select=id,op,old_row,new_row,changed_at&limit=1');
  if (!h.ok) {
    if (h.missing) return json({ error: 'Run migration 114 first: there is no screen history yet. Nothing was changed.' }, 409);
    return json({ error: 'Could not read that version. Nothing was changed.' }, 500);
  }
  const entry = h.rows[0];
  if (!entry) return json({ error: 'That version is not in this venue\'s history. Nothing was changed.' }, 404);
  const src = vpaScreenVersionRow(entry);
  if (!src) return json({ error: 'That entry holds no version to put back. Nothing was changed.' }, 409);
  const vrows = await vpaSelect(env, 'vp_venues', 'id=eq.' + encodeURIComponent(venueId) + '&select=id,name,slug&limit=1');
  const venue = vrows && vrows[0];
  if (!venue) return json({ error: 'That venue no longer exists, so there is no screen to put this back on. Nothing was changed.' }, 404);

  const was = await vpbReadScreen(env, venueId);
  /* EXACTLY the old row: logo, slides, draws and raffle as they were stored. The slug is the
     venue's current one (the screen address follows the venue), and the clock is now. */
  const row = {
    venue_id: venueId, slug: venue.slug,
    slides: Array.isArray(src.slides) ? src.slides : [],
    draws: Array.isArray(src.draws) ? src.draws : [],
    raffle: src.raffle === undefined ? null : src.raffle,
    logo_url: src.logo_url === undefined ? null : src.logo_url,
    updated_at: new Date().toISOString(),
  };
  const res = await vpbWriteScreen(env, row, { via: 'hq_restore', route: 'screen-restore', admin: actor.actorId || null,
                                               label: actor.label || 'admin', role: actor.role || null, restored_from: hid });
  if (!res.ok) {
    const t = (await res.text().catch(function () { return ''; })).slice(0, 180);
    return json({ error: 'Could not put that version back. Nothing was changed. ' + t }, 500);
  }
  /* Are the files it points at still there? A version is only as good as its images. */
  const urls = [row.logo_url].concat(row.slides.map(function (s) { return s && s.image_url; }))
    .filter(function (u) { return typeof u === 'string' && u.indexOf(env.SUPABASE_URL + '/storage/v1/object/public/') === 0; })
    .slice(0, 25);
  const missing = [];
  for (const u of urls) {
    try { const r = await fetch(u, { method: 'HEAD' }); if (!r.ok) missing.push(u); } catch (_) { /* unknown is not missing */ }
  }
  await vpaAudit(env, actor, 'screen_restored', 'venue:' + venueId, {
    history_id: hid, from_op: entry.op, from_at: entry.changed_at, name: venue.name,
    before: was.ok ? vpbScreenSummary(was.row) : 'unread', after: vpbScreenSummary(row), missing_files: missing.length,
  });
  return json({ ok: true, restored: vpaScreenVersion(row), missing_files: missing });
}

/* The nightly check (scheduled). Migration 114's function writes 'drift' and 'vanished' rows for
   anything the trigger did not see; the counts go in the audit when they are not zero. Before
   migration 114 the function does not exist and this is quiet. */
async function vpaScreenHistoryNightly(env) {
  const res = await fetch(env.SUPABASE_URL + '/rest/v1/rpc/vp_screen_history_check', {
    method: 'POST', headers: vpaHeaders(env), body: '{}',
  });
  if (!res.ok) return { ran: false, status: res.status };
  const out = await res.json().catch(function () { return null; });
  const r = (out && typeof out === 'object') ? out : {};
  if ((r.drift || 0) > 0 || (r.vanished || 0) > 0) {
    await vpaAudit(env, { actorId: null, label: 'automatic (screen history check)' }, 'screen_history_drift', null,
      { checked: r.checked || 0, drift: r.drift || 0, vanished: r.vanished || 0 });
  }
  return { ran: true, result: r };
}

/* ---------------------------------------------------------------------------------------
   HQ > AUDIT, AS A SEARCH.   GET /admin/audit-search   (Dean, 21 Oct 2026)

   The Audit tab used to read the newest 250 rows of vp_admin_audit straight into the page, as
   raw action names and JSON, with "older entries are not on this screen" underneath. It grows
   by hundreds a week. Now the page asks this route for ONE PAGE at a time, newest first, and the
   database does the filtering:
     venue      target = venue:<id>
     from, to   a date range (the page sends the edges of Brisbane days)
     kind       what changed, as plain categories (VPA_AUDIT_KINDS), each a set of action prefixes
     who        hq (Dean and the Gflam admins), venue (the venue's own logins), system (automatic:
                Stripe, the nightly jobs, the game Worker), migration, outside (a change made
                straight in the database, which only the screen history can see)
   Screen settings changed OUTSIDE the Worker (migration 114's 'direct' and nightly-check rows in
   vp_venue_screen_history) are merged in, because they have no audit row of their own; changes
   made through the Worker are already audit rows (logo_set, screen_updated...), so they are not
   repeated. Paging is by a cursor on time (keyset), never by offset over the whole table, so a
   page costs the same on the ten-thousandth row as on the first. Each entry comes back as a
   sentence, with the raw row alongside for the page's "details". Owner and accounts admins only.
   --------------------------------------------------------------------------------------- */
const VPA_AUDIT_KINDS = [
  { key: 'screen',  label: 'Logo, slides and screens', prefixes: ['logo_', 'slide_', 'screen_', 'screens_'] },
  { key: 'billing', label: 'Billing and payments', prefixes: ['payment_', 'overage_', 'invoice_', 'discount_', 'plan_uplift', 'credit_',
                                                               'extras_', 'quantity_', 'add_card_', 'gst_'] },
  { key: 'players', label: 'Players and player data', prefixes: ['players_', 'player_', 'optin_', 'venue_marketing_'] },
  { key: 'gaming',  label: 'Games and gaming rules', prefixes: ['venue_gaming_', 'permits_', 'venue_night_pass_', 'venue_unlimited_nights_',
                                                              'paper_', 'venue_code_'] },
  { key: 'venues',  label: 'Venues joining, leaving and status', prefixes: ['venue_onboarded', 'venue_provision', 'venue_suspended',
                     'venue_reactivated', 'venue_archived', 'venue_cancel_', 'venue_quiet_', 'venue_last_day', 'venue_leaving_',
                     'venue_marked_test', 'venue_unmarked_test', 'venue_no_login', 'venue_subscription_', 'venue_added', 'venue_readded',
                     'venue_invited_back', 'group_', 'auto_archive_', 'last_day_sweep_', 'welcome_'] },
  { key: 'logins',  label: 'Logins and staff', prefixes: ['staff_', 'manager_', 'marketing_login_', 'view_as', 'host_'] },
  { key: 'signups', label: 'Signups and flags', prefixes: ['signup_'] },
  { key: 'emails',  label: 'Emails that bounced or were reported', prefixes: ['email_'] },
  { key: 'help',    label: 'Help desk', prefixes: ['help_', 'ticket_'] },
  { key: 'other',   label: 'Everything else', prefixes: [] },
];
function vpaAuditKinds() { return VPA_AUDIT_KINDS; }   // one list, for the tests and the route alike
const VPA_AUDIT_WHO = [
  { key: 'hq', label: 'Dean and the HQ team' },
  { key: 'venue', label: 'A venue (owner, manager, host)' },
  { key: 'system', label: 'Automatic (Stripe, nightly jobs)' },
  { key: 'migration', label: 'A database migration' },
  { key: 'outside', label: 'Outside VenuePlay (straight in the database)' },
];
const VPA_VENUE_LOGIN_LABELS = ['owner', 'manager', 'marketing', 'host'];
const VPA_SYSTEM_LABELS = ['system', 'stripe', 'game Worker'];

function vpaAuditKindOf(action) {
  const a = String(action || '');
  for (const k of VPA_AUDIT_KINDS) {
    if (k.prefixes.some(function (p) { return a.indexOf(p) === 0; })) return k;
  }
  return VPA_AUDIT_KINDS[VPA_AUDIT_KINDS.length - 1];
}
/* A PostgREST logic value: quoted, so a label with a comma or a bracket in it cannot break the list. */
function vpaPgq(s) { return '"' + String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'; }
function vpaAuditKindCond(key) {
  const k = VPA_AUDIT_KINDS.filter(function (x) { return x.key === key; })[0];
  if (!k) return null;
  if (k.key === 'other') {
    const all = [];
    VPA_AUDIT_KINDS.forEach(function (x) { x.prefixes.forEach(function (p) { all.push('action.not.like.' + p + '*'); }); });
    return 'and(' + all.join(',') + ')';
  }
  return 'or(' + k.prefixes.map(function (p) { return 'action.like.' + p + '*'; }).join(',') + ')';
}
function vpaAuditWhoOf(row, adminIds, adminLabels) {
  const l = row.actor_label == null ? null : String(row.actor_label);
  if (row.actor_admin || (l && adminLabels.indexOf(l) !== -1)) return 'hq';
  if (l && VPA_VENUE_LOGIN_LABELS.indexOf(l) !== -1) return 'venue';
  if (l && /^migration/i.test(l)) return 'migration';
  return 'system';
}
function vpaAuditWhoCond(key, adminLabels) {
  const labels = adminLabels.length ? ',actor_label.in.(' + adminLabels.map(vpaPgq).join(',') + ')' : '';
  if (key === 'hq') return 'or(actor_admin.not.is.null' + labels + ')';
  if (key === 'venue') return 'and(actor_admin.is.null,actor_label.in.(' + VPA_VENUE_LOGIN_LABELS.map(vpaPgq).join(',') + '))';
  if (key === 'migration') return 'and(actor_admin.is.null,actor_label.like.migration*)';
  if (key === 'system') {
    return 'and(actor_admin.is.null,or(actor_label.is.null,actor_label.in.(' + VPA_SYSTEM_LABELS.map(vpaPgq).join(',') + '),actor_label.like.automatic*))';
  }
  return null;
}
/* A read that THROWS on any non-2xx, for a page. vpaSelect answers [] on a refusal, and an empty
   page reads as "nothing happened", which on an audit screen is a lie. */
async function vpaReadPage(env, table, query) {
  const res = await fetch(env.SUPABASE_URL + '/rest/v1/' + table + '?' + query, { headers: vpaHeaders(env) });
  if (!res.ok) {
    const t = (await res.text().catch(function () { return ''; })).slice(0, 200);
    const e = new Error('read ' + table + ': ' + res.status + ' ' + t);
    e.status = res.status; e.body = t;
    throw e;
  }
  const rows = await res.json();
  if (!Array.isArray(rows)) throw new Error('read ' + table + ': not a list');
  return rows;
}
function vpaB64urlJson(o) { return btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function vpaUnB64urlJson(s) {
  try { const p = String(s || '').replace(/-/g, '+').replace(/_/g, '/'); return JSON.parse(atob(p + '==='.slice((p.length + 3) % 4))); }
  catch (_) { return null; }
}

/* WHO A TARGET IS, by name. venue:<id>, account:<founding id>, customer:<Stripe id> and group:<id>
   all resolve; a raw id is only ever shown when nothing else exists. One answer, used by the audit
   search and by billing health. */
async function vpaNameBook(env) {
  const venues = await vpaSelectAll(env, 'vp_venues', 'select=id,name,founding_id,group_id&order=id.asc');
  const accts = await vpaSelectAll(env, 'venueplay_founding', 'select=id,venue_name,stripe_customer_id,contact_email&order=id.asc');
  let groups = [];
  try { groups = await vpaSelectAll(env, 'vp_venue_groups', 'select=id,name&order=id.asc'); } catch (_) { groups = []; }
  const book = { venue: {}, account: {}, customer: {}, group: {}, venuesOfAccount: {}, accountOf: {} };
  venues.forEach(function (v) {
    book.venue[v.id] = v;
    if (v.founding_id) (book.venuesOfAccount[v.founding_id] = book.venuesOfAccount[v.founding_id] || []).push(v);
  });
  accts.forEach(function (a) { book.account[a.id] = a; if (a.stripe_customer_id) book.customer[a.stripe_customer_id] = a; });
  groups.forEach(function (g) { book.group[g.id] = g; });
  return book;
}
function vpaListNames(names) {
  names = names.filter(Boolean);
  if (!names.length) return null;
  if (names.length <= 2) return names.join(' and ');
  return names[0] + ' and ' + (names.length - 1) + ' more';
}
/* { venue_id, venue, account_id, account, group } for one target, as far as it resolves. */
function vpaResolveTarget(book, target, detail) {
  const t = String(target || ''), d = detail || {};
  const out = { venue_id: null, venue: null, account_id: null, account: null, group: null };
  const acctNames = function (fid) {
    const vs = (book.venuesOfAccount[fid] || []).map(function (v) { return v.name; });
    const a = book.account[fid];
    return vpaListNames(vs) || (a && a.venue_name) || null;
  };
  let m;
  if ((m = /^venue:(.+)$/.exec(t))) {
    const v = book.venue[m[1]];
    out.venue_id = m[1];
    out.venue = v ? v.name : (d.name || d.venue_name || null);
    if (v && v.founding_id) { out.account_id = v.founding_id; }
    if (v && v.group_id && book.group[v.group_id]) out.group = book.group[v.group_id].name;
  } else if ((m = /^account:(.+)$/.exec(t))) {
    out.account_id = m[1];
    out.venue = acctNames(m[1]);
  } else if ((m = /^customer:(.+)$/.exec(t))) {
    const a = book.customer[m[1]];
    if (a) { out.account_id = a.id; out.venue = acctNames(a.id); }
    else if (d.what && !/^your VenuePlay/i.test(String(d.what))) out.venue = String(d.what).split(' - ')[0];
    else if (d.to) out.venue = String(d.to);
  } else if ((m = /^group:(.+)$/.exec(t))) {
    out.group = book.group[m[1]] ? book.group[m[1]].name : null;
  }
  if (out.account_id && book.account[out.account_id]) {
    const n = (book.venuesOfAccount[out.account_id] || []).length;
    out.account = n > 1 ? 'account of ' + n + ' venues' : null;
  }
  if (!out.venue) out.venue = d.venue_name || d.venue || null;
  return out;
}

/* WHAT HAPPENED, IN A SENTENCE. One template per action people actually look for; anything else
   reads as its own name in words, never as JSON. who is the person, at is the venue (or account). */
function vpaMoneyOf(d) {
  if (!d) return '';
  if (d.amount_cents != null && isFinite(Number(d.amount_cents))) return '$' + (Number(d.amount_cents) / 100).toFixed(2);
  if (d.amount) return String(d.amount);
  return '';
}
function vpaSummaryWords(s) {
  if (!s || typeof s !== 'object') return '';
  const bits = [];
  bits.push(s.logo_url ? 'a logo' : 'no logo');
  if (s.slides != null) bits.push(s.slides + ' slide' + (s.slides === 1 ? '' : 's'));
  return bits.join(', ');
}
const VPA_AUDIT_SAY = {
  logo_set: function (d, at) { return 'Put up a new logo for ' + at + '.'; },
  logo_removed: function (d, at) { return 'Took the logo off ' + at + '\'s screens.'; },
  logo_on_site: function (d, at) { return (d.show ? 'Agreed to show ' : 'Stopped showing ') + at + '\'s logo on the VenuePlay website.'; },
  slide_uploaded: function (d, at) { return 'Uploaded an advertising slide for ' + at + '.'; },
  screen_updated: function (d, at) {
    const b = vpaSummaryWords(d.before), a = vpaSummaryWords(d.after);
    return 'Changed ' + at + '\'s screen' + (b && a && b !== a ? ' (' + b + ' before, ' + a + ' after)' : '') + '.';
  },
  screen_restored: function (d, at) { return 'Put back an earlier version of ' + at + '\'s screen settings.'; },
  screen_history_drift: function (d) { return 'The nightly check found screen settings changed outside VenuePlay (' + (d.drift || 0) + ' changed, ' + (d.vanished || 0) + ' gone).'; },
  screen_command: function (d, at) { return 'Sent a command to ' + at + '\'s screens.'; },
  screen_reload_requested: function (d, at) { return 'Asked ' + at + '\'s screens to reload.'; },
  payment_failed_email: function (d, at) {
    const what = d.what && !/^your VenuePlay/i.test(String(d.what)) ? 'an extras invoice' : 'the subscription';
    return 'A card payment for ' + at + ' was declined (' + [vpaMoneyOf(d), what].filter(Boolean).join(', ') + '). '
      + (d.reason_line ? 'The bank said: ' + d.reason_line + ' ' : '') + 'We emailed them.';
  },
  invoice_receipt_email: function (d, at) {
    const o = String(d.outcome || '');
    return o === 'sent' ? 'Emailed ' + at + ' a receipt.' : 'A receipt for ' + at + ' was NOT sent (' + o.replace(/^not sent: /, '') + ').';
  },
  overage_charged: function (d, at) { return 'Charged ' + at + ' ' + (vpaMoneyOf(d) || '') + ' for extra players, and it was paid.'; },
  overage_charge_failed: function (d, at) { return 'An extra-player charge to ' + at + ' failed.'; },
  overage_invoice_unpaid: function (d, at) { return 'An extras invoice for ' + at + ' is unpaid' + (vpaMoneyOf(d) ? ' (' + vpaMoneyOf(d) + ')' : '') + '.'; },
  extras_moved_to_monthly: function (d, at) { return 'Moved ' + at + '\'s unpaid extras onto their next monthly bill.'; },
  discount_applied: function (d, at) { return 'Gave ' + at + ' a discount' + (d.value != null ? ' (' + d.value + (d.kind === 'percent' ? '%' : '') + (d.months ? ' for ' + d.months + ' months' : '') + ')' : '') + '.'; },
  discount_removed: function (d, at) { return 'Took a discount off ' + at + '.'; },
  players_increased: function (d, at) { return 'Raised ' + at + '\'s players' + (d.from != null ? ' from ' + d.from + ' to ' + d.to : '') + '.'; },
  players_reduction_scheduled: function (d, at) { return 'Lowered ' + at + '\'s players from their next bill' + (d.to != null ? ' (to ' + d.to + ')' : '') + '.'; },
  players_reduction_cancelled: function (d, at) { return 'Cancelled a planned drop in ' + at + '\'s players.'; },
  player_removed: function (d, at) { return 'Removed a player\'s details from ' + at + '\'s list, at their request.'; },
  optin_exported: function (d, at) { return 'Downloaded ' + at + '\'s player list' + (d.rows != null ? ' (' + d.rows + ' people)' : '') + '.'; },
  optin_approved: function (d, at) { return 'Approved ' + at + ' to collect player details.'; },
  venue_onboarded: function (d, at) { return 'Set up ' + at + '.'; },
  venue_provisioned: function (d, at) { return at + ' signed up and was set up.'; },
  venue_suspended: function (d, at) { return 'Paused ' + at + '.'; },
  venue_reactivated: function (d, at) { return 'Switched ' + at + ' back on.'; },
  venue_reactivated_on_payment: function (d, at) { return at + ' paid and was switched back on.'; },
  venue_archived: function (d, at) { return 'Archived ' + at + '.'; },
  venue_cancel_scheduled: function (d, at) { return at + ' cancelled' + (d.reason_label ? ' ("' + d.reason_label + '")' : '') + (d.ends ? '. Last day ' + d.ends : '') + '.'; },
  venue_cancel_undone: function (d, at) { return at + ' changed their mind and kept their venue.'; },
  venue_cancel_contacted: function (d, at) { return 'Contacted ' + at + ' about their cancellation.'; },
  venue_cancel_uncontacted: function (d, at) { return 'Took back "contacted" on ' + at + '.'; },
  venue_cancel_note: function (d, at) { return 'Wrote a note on ' + at + ': "' + String(d.note || '').slice(0, 160) + '"'; },
  venue_quiet_contacted: function (d, at) { return 'Contacted ' + at + ' because they had gone quiet.'; },
  venue_subscription_ended: function (d, at) { return at + '\'s subscription ended.'; },
  venue_invited_back: function (d, at) {
    if (d.held === 'unsubscribed') return 'Did not email ' + at + (d.to ? ' (' + d.to + ')' : '') + ': that address has unsubscribed from VenuePlay marketing email.';
    return 'Emailed ' + at + ' an invitation to keep or come back to VenuePlay' + (d.to ? ' (' + d.to + ')' : '') + '.';
  },
  venue_marked_test: function (d, at) { return 'Marked ' + at + ' as a test venue.'; },
  venue_unmarked_test: function (d, at) { return 'Marked ' + at + ' as a real venue again.'; },
  auto_archive_run: function (d) { return 'The nightly job archived ' + (d.archived || 0) + ' venue' + (d.archived === 1 ? '' : 's') + ' that had left.'; },
  venue_gaming_updated: function (d, at) { return 'Changed ' + at + '\'s gaming settings.'; },
  venue_night_pass_granted: function (d, at) { return 'Let ' + at + ' run one more ' + (d.format === 'musical_bingo' ? 'musical bingo' : (d.format === 'either' ? 'trivia or musical bingo' : 'trivia')) + ' night.'; },
  venue_night_pass_cancelled: function (d, at) { return 'Cancelled ' + at + '\'s extra-night pass.'; },
  venue_night_pass_used: function (d, at) { return at + ' used their extra-night pass.'; },
  venue_unlimited_nights_on: function (d, at) { return 'Gave ' + at + ' unlimited trivia and musical bingo nights.'; },
  venue_unlimited_nights_off: function (d, at) { return 'Put ' + at + ' back on one trivia and one musical bingo night a week.'; },
  permits_set: function (d, at) { return 'Recorded ' + at + '\'s gaming permits.'; },
  paper_suspect_trivia: function (d, at) { return at + ' ran a trivia night with almost no phones answering' + (d.questions ? ' (' + d.questions + ' questions)' : '') + '.'; },
  paper_declared: function (d, at) { return at + ' printed paper cards and said none were played.'; },
  venue_code_refreshed: function (d, at) { return at + '\'s join code was changed.'; },
  staff_added: function (d) { return 'Added ' + (d.name || 'a') + ' to the HQ team' + (d.role ? ' (' + d.role + ')' : '') + '.'; },
  manager_added: function (d, at) { return 'Added a manager at ' + at + (d.name ? ' (' + d.name + ')' : '') + '.'; },
  manager_perms_set: function (d, at) { return 'Changed what a manager at ' + at + ' may do.'; },
  view_as: function (d, at) { return 'Opened ' + at + '\'s pages with View as.'; },
  signup_flagged: function (d, at) { return 'A signup was held for review: ' + at + (d.email ? ' (' + d.email + ')' : '') + '.'; },
  email_bounced: function (d, at) { return 'An email to ' + at + ' bounced' + (d.to ? ' (' + d.to + ')' : '') + '.'; },
  email_marked_spam: function (d, at) { return at + ' marked one of our emails as spam.'; },
  welcome_resent: function (d, at) { return 'Sent ' + at + ' their welcome email again.'; },
};
function vpaAuditSentence(row, at) {
  const d = (row.detail && typeof row.detail === 'object') ? row.detail : {};
  const name = at || 'a venue';
  const f = VPA_AUDIT_SAY[row.action];
  if (f) { try { return f(d, name); } catch (_) { /* fall through to the words */ } }
  const words = String(row.action || 'something').replace(/_+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1) + (at ? ': ' + at : '') + '.';
}
function vpaWhoWords(kind, label) {
  if (kind === 'hq') return String(label || 'HQ');
  if (kind === 'venue') return 'The venue (' + String(label || 'login') + ')';
  if (kind === 'migration') return 'A database migration';
  if (kind === 'outside') return 'Outside VenuePlay';
  const l = String(label || '');
  if (l === 'stripe') return 'Automatic (Stripe)';
  if (/^automatic/i.test(l)) return 'Automatic (' + l.replace(/^automatic\s*\(?|\)$/gi, '') + ')';
  return 'Automatic';
}

const VPA_AUDIT_PAGE_MAX = 100;
async function vpaHandleAuditSearch(request, env, json) {
  const actor = await vpaRequireAdmin(request, env, ['owner', 'accounts']);
  if (actor.error) return json({ error: actor.error }, actor.status);
  const u = new URL(request.url), q = function (k) { return String(u.searchParams.get(k) || '').trim(); };
  const isoOk = function (s) { return !s || !isNaN(Date.parse(s)); };
  const venueId = q('venue'), kind = q('kind'), who = q('who'), from = q('from'), to = q('to');
  const size = Math.max(5, Math.min(VPA_AUDIT_PAGE_MAX, parseInt(q('size'), 10) || 50));
  if (venueId && !/^[0-9a-fA-F-]{36}$/.test(venueId)) return json({ error: 'That venue is not one we know.' }, 400);
  if (kind && !VPA_AUDIT_KINDS.some(function (k) { return k.key === kind; })) return json({ error: 'Unknown kind of change.' }, 400);
  if (who && !VPA_AUDIT_WHO.some(function (k) { return k.key === who; })) return json({ error: 'Unknown kind of person.' }, 400);
  if (!isoOk(from) || !isoOk(to)) return json({ error: 'Those dates are not dates.' }, 400);
  const cur = q('before') ? vpaUnB64urlJson(q('before')) : null;
  if (q('before') && (!cur || isNaN(Date.parse(cur.t)))) return json({ error: 'That page link has expired. Start the search again.' }, 400);

  const admins = await vpaReadPage(env, 'vp_platform_admins', 'select=auth_user_id,label&limit=500');
  const adminLabels = admins.map(function (a) { return a.label; }).filter(Boolean);
  const adminIds = admins.map(function (a) { return a.auth_user_id; });

  /* The audit table, unless the search can only be about the database-side screen history. */
  const iso = function (s) { return new Date(s).toISOString(); };
  const skipA = (cur && cur.a) || [], skipH = (cur && cur.h) || [];
  let auditRows = [];
  if (who !== 'outside') {
    const c = [];
    if (from) c.push('created_at.gte.' + iso(from));
    if (to) c.push('created_at.lt.' + iso(to));
    if (cur) c.push('created_at.lte.' + iso(cur.t));
    if (venueId) c.push('target.eq.' + vpaPgq('venue:' + venueId));
    if (kind) c.push(vpaAuditKindCond(kind));
    if (who) c.push(vpaAuditWhoCond(who, adminLabels));
    auditRows = await vpaReadPage(env, 'vp_admin_audit',
      'select=id,created_at,actor_admin,actor_label,action,target,detail'
      + (c.length ? '&and=' + encodeURIComponent('(' + c.join(',') + ')') : '')
      + '&order=created_at.desc,id.desc&limit=' + (size + skipA.length + 1));
    auditRows = auditRows.filter(function (r) { return skipA.indexOf(String(r.id)) === -1; });
  }
  /* The screen history's database-side rows (migration 114). Before 114 the table is not there,
     and the search carries on without it. */
  let histRows = [];
  if ((!kind || kind === 'screen') && (!who || who === 'outside' || who === 'system')) {
    const c = ['via.in.(' + (who === 'outside' ? '"direct"' : (who === 'system' ? '"nightly-check"' : '"direct","nightly-check"')) + ')'];
    if (from) c.push('changed_at.gte.' + iso(from));
    if (to) c.push('changed_at.lt.' + iso(to));
    if (cur) c.push('changed_at.lte.' + iso(cur.t));
    if (venueId) c.push('venue_id.eq.' + venueId);
    try {
      histRows = await vpaReadPage(env, 'vp_venue_screen_history',
        'select=id,venue_id,slug,op,old_row,new_row,changed_at,actor,via,db_session_user,jwt_role,db_role'
        + '&and=' + encodeURIComponent('(' + c.join(',') + ')')
        + '&order=changed_at.desc,id.desc&limit=' + (size + skipH.length + 1));
      histRows = histRows.filter(function (r) { return skipH.indexOf(String(r.id)) === -1; });
    } catch (e) {
      if (!(e.status === 404 || /vp_venue_screen_history|PGRST205|42P01/.test(String(e.body || '')))) throw e;
      histRows = [];
    }
  }

  const merged = auditRows.map(function (r) { return { t: r.created_at, src: 'a', r: r }; })
    .concat(histRows.map(function (r) { return { t: r.changed_at, src: 'h', r: r }; }))
    .sort(function (x, y) { const a = Date.parse(x.t), b = Date.parse(y.t); return b - a || (x.src < y.src ? -1 : 1); });
  const page = merged.slice(0, size);
  const more = merged.length > size;
  const book = await vpaNameBook(env);

  const rows = page.map(function (e) {
    if (e.src === 'h') {
      const h = e.r, v = book.venue[h.venue_id];
      const name = v ? v.name : (h.slug || 'a venue');
      const changes = vpaScreenChanges(h.op, h.old_row, h.new_row);
      return { key: 'h' + h.id, at: h.changed_at, kind: 'screen', kind_label: VPA_AUDIT_KINDS[0].label,
               who_kind: h.via === 'direct' ? 'outside' : 'system', who: vpaScreenWho(h),
               venue_id: h.venue_id, venue: name, group: null,
               sentence: name + ': ' + changes.join(' '), screen_history: true, raw: h };
    }
    const r = e.r, k = vpaAuditKindOf(r.action), w = vpaAuditWhoOf(r, adminIds, adminLabels);
    const res = vpaResolveTarget(book, r.target, r.detail);
    const at = [res.venue, res.group ? '(' + res.group + ')' : null].filter(Boolean).join(' ') || null;
    return { key: 'a' + r.id, at: r.created_at, kind: k.key, kind_label: k.label, who_kind: w, who: vpaWhoWords(w, r.actor_label),
             venue_id: res.venue_id, venue: res.venue, group: res.group, account: res.account,
             sentence: vpaAuditSentence(r, at), raw: r };
  });
  let next = null;
  if (more && page.length) {
    const lastT = page[page.length - 1].t, same = page.filter(function (e) { return Date.parse(e.t) === Date.parse(lastT); });
    const carryA = (cur && Date.parse(cur.t) === Date.parse(lastT)) ? skipA : [];
    const carryH = (cur && Date.parse(cur.t) === Date.parse(lastT)) ? skipH : [];
    next = vpaB64urlJson({ t: lastT,
      a: carryA.concat(same.filter(function (e) { return e.src === 'a'; }).map(function (e) { return String(e.r.id); })),
      h: carryH.concat(same.filter(function (e) { return e.src === 'h'; }).map(function (e) { return String(e.r.id); })) });
  }
  return json({ ok: true, rows: rows, next: next, size: size,
                kinds: VPA_AUDIT_KINDS.map(function (k) { return { key: k.key, label: k.label }; }), who: VPA_AUDIT_WHO });
}

/* ---------------------------------------------------------------------------------------
   HQ > BILLING > "Payments that need a look".   GET /admin/billing-health   (Dean, 21 Oct 2026)

   The panel listed every money email on its own line, and a declined subscription read "your
   VenuePlay subscription" with no venue anywhere, because the row's target is a Stripe customer
   id. Now the Worker names every line (customer -> account -> its venues, and their group) and
   folds repeats: one line per account, with the latest state, how many times, the last attempt,
   and the history underneath. A line that has been paid since its last failure says so. Lines
   with nothing wrong are sent too, marked ok, for the page's "show all". Owner and accounts only.
   --------------------------------------------------------------------------------------- */
const VPA_MONEY_ACTIONS = ['payment_failed_email', 'overage_invoice_unpaid', 'overage_charge_failed', 'overage_charged',
                           'extras_moved_to_monthly', 'invoice_receipt_email', 'plan_uplift_after_three_big_nights'];
const VPA_MONEY_LABEL = {
  payment_failed_email: 'Card declined, we emailed them', overage_invoice_unpaid: 'Extras invoice not paid',
  overage_charge_failed: 'Extra-player charge failed', overage_charged: 'Extra players charged and paid',
  extras_moved_to_monthly: 'Extras moved onto their next monthly bill', invoice_receipt_email: 'Receipt',
  plan_uplift_after_three_big_nights: 'Plan moved up after three big nights',
};
function vpaMoneyIsBad(r) {
  const d = r.detail || {};
  if (r.action === 'invoice_receipt_email') return String(d.outcome || '') !== 'sent';
  return r.action === 'payment_failed_email' || r.action === 'overage_invoice_unpaid' || r.action === 'overage_charge_failed';
}
function vpaMoneyIsPaid(r) {
  const d = r.detail || {};
  return r.action === 'overage_charged' || (r.action === 'invoice_receipt_email' && String(d.outcome || '') === 'sent');
}
async function vpaHandleBillingHealth(request, env, json) {
  const actor = await vpaRequireAdmin(request, env, ['owner', 'accounts']);
  if (actor.error) return json({ error: actor.error }, actor.status);
  const rows = await vpaReadPage(env, 'vp_admin_audit',
    'action=in.(' + VPA_MONEY_ACTIONS.join(',') + ')&select=id,created_at,action,target,detail&order=created_at.desc,id.desc&limit=1000');
  const book = await vpaNameBook(env);
  const lines = {};
  rows.forEach(function (r) {
    const res = vpaResolveTarget(book, r.target, r.detail);
    const key = res.account_id ? 'account:' + res.account_id : (res.venue_id ? 'venue:' + res.venue_id : String(r.target || 'unknown'));
    const L = lines[key] = lines[key] || { key: key, venue: res.venue, group: res.group, account: res.account,
      venue_id: res.venue_id || ((res.account_id && (book.venuesOfAccount[res.account_id] || [])[0]) || {}).id || null,
      events: [], failures: 0 };
    const d = r.detail || {};
    const bad = vpaMoneyIsBad(r);
    L.events.push({ at: r.created_at, what: (r.action === 'invoice_receipt_email' && bad) ? 'Receipt NOT sent' : (VPA_MONEY_LABEL[r.action] || r.action), bad: bad, paid: vpaMoneyIsPaid(r),
                    decline: r.action === 'payment_failed_email',
                    amount: vpaMoneyOf(d) || null, said: d.reason_line || null,
                    note: d.outcome && r.action !== 'payment_failed_email' && String(d.outcome) !== 'sent' ? String(d.outcome) : null,
                    for_what: d.what ? (/^your VenuePlay/i.test(String(d.what)) ? 'the subscription' : 'an extras invoice') : null });
    if (vpaMoneyIsBad(r)) L.failures++;
  });
  const out = Object.keys(lines).map(function (k) {
    const L = lines[k], e = L.events;                     // newest first already
    const lastBad = e.filter(function (x) { return x.bad; })[0] || null;
    const paidAfter = lastBad ? e.filter(function (x) { return x.paid && Date.parse(x.at) > Date.parse(lastBad.at); })[0] : null;
    let state = 'ok', status = 'All paid';
    if (lastBad && !paidAfter) { state = 'bad'; status = lastBad.what + (lastBad.said ? ': ' + lastBad.said : (lastBad.note ? ': ' + lastBad.note.replace(/^not sent: /, '') : '')); }
    else if (lastBad && paidAfter) { state = 'recovered'; status = 'Paid since (' + paidAfter.what.toLowerCase() + ')'; }
    return { key: L.key, venue: L.venue || 'Unknown customer', group: L.group, account: L.account, venue_id: L.venue_id,
             state: state, status: status, failures: L.failures,
             failures_are: e.filter(function (x) { return x.bad; }).every(function (x) { return x.decline; }) ? 'declines' : 'problems',
             last_attempt: (lastBad || e[0]).at,
             last_amount: lastBad ? lastBad.amount : null, history: e.slice(0, 30), events: e.length };
  }).sort(function (a, b) {
    const rank = { bad: 0, recovered: 1, ok: 2 };
    return (rank[a.state] - rank[b.state]) || (Date.parse(b.last_attempt) - Date.parse(a.last_attempt));
  });
  return json({ ok: true, lines: out, events: rows.length });
}

/* =======================================================================================
   ONE-CLICK UNSUBSCRIBE FOR VENUEPLAY MARKETING EMAIL (Dean, 26 Oct 2026: "I need
   unsubscribe links on ALL marketing emails we send").

   GET  /unsubscribe?e=<email>&t=<token>[&c=<campaign>]   the link in the footer
   POST /unsubscribe?e=<email>&t=<token>[&c=<campaign>]   RFC 8058 one-click, no page

   WHICH EMAILS. Only MARKETING goes through vpUnsubHeaders / vpUnsubFooterHtml and only
   marketing checks the list first. Today that is one email: the HQ win-back ("Keep <venue> on
   VenuePlay?", vpaHandleInviteBack). Receipts, payment reminders, failed payments, plan moves,
   the two leaving emails, welcome and setup, sign-in codes and help desk replies are about the
   service someone pays for: not commercial electronic messages under the Spam Act, and opting
   out of marketing must never silence them (vpaFireCancelConfirm says why).

   THE TOKEN is the same scheme as touring-api and partyplay-api: an HMAC-SHA256 of the
   trimmed, lower-cased address, keyed with 'vp-unsub:' + VP_UNSUB_SECRET, hex, first 32
   characters. A link with NO token is refused: no VenuePlay email ever linked this route
   before it had tokens. The campaign tag c is not signed and only labels the source.

   THE GET DOES NOT WRITE. Outlook SafeLinks, Gmail and corporate scanners fetch every link in
   a message before a human sees it (Microsoft's run the page's JavaScript too, which is why
   venueplay.com.au/unsubscribe stopped writing on load, 14 Oct 2026). The page posts back to
   itself as soon as it loads, so a person sees "You're off the list" from one click, while a
   scanner that only fetches writes nothing. With scripts off, one button does the same.

   THE WRITE goes to vp_unsubscribes (migration 81; email, source, note, created_at; a unique
   index on lower(email)). The first row is the proof we honoured the first request, so a
   repeat is a 409 from that index and is treated as done: nothing changes. The same table the
   venueplay.com.au page writes to and the HQ marketing export reads, so there is one list.
   ======================================================================================= */
const VP_UNSUB_EMAIL_RE = /^[^@\s"<>,;()\\]+@[^@\s"<>,;()\\]+\.[^@\s"<>,;()\\]+$/;
const VP_UNSUB_MAILTO = 'mailto:hello@venueplay.com.au?subject=unsubscribe';

/* The https address in List-Unsubscribe must be THIS Worker, not the Pages site: a mail app's
   Unsubscribe button POSTs straight to it, and Pages answers a POST with the homepage.
   OUR OWN NAME FOR IT, api.venueplay.com.au (Dean, 31 Oct 2026: "Don't put any .dev links into
   anything marketing or website or email customer facing"). The Worker answers there as a custom
   domain, and on its old Cloudflare address too, so links already sent keep working. API_ORIGIN is
   used only when it is a venueplay.com.au API host: a variable still holding the old Cloudflare
   address, or the site itself, never reaches an email. The review links Dean gets use this too. */
const VPA_API_ORIGIN = 'https://api.venueplay.com.au';
function vpUnsubApi(env) {
  const s = String(env.API_ORIGIN || '').replace(/\/+$/, '');
  return /^https:\/\/(?!www\.)[a-z0-9-]+\.venueplay\.com\.au$/.test(s) ? s : VPA_API_ORIGIN;
}

async function vpUnsubToken(env, email) {
  const key = await crypto.subtle.importKey('raw',
    new TextEncoder().encode('vp-unsub:' + String(env.VP_UNSUB_SECRET || '')),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key,
    new TextEncoder().encode(String(email || '').trim().toLowerCase()));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

function vpUnsubSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

function vpUnsubCampaign(c) {
  return String(c || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40);
}

async function vpUnsubLink(env, email, campaign) {
  const e = String(email || '').trim().toLowerCase();
  const c = vpUnsubCampaign(campaign);
  return vpUnsubApi(env) + '/unsubscribe?e=' + encodeURIComponent(e) + '&t=' + (await vpUnsubToken(env, e))
    + (c ? '&c=' + c : '');
}

/* Both headers, for Resend's `headers`. List-Unsubscribe carries the https one-click address
   and the mailto fallback; List-Unsubscribe-Post is what makes Gmail, Yahoo and Apple Mail show
   their own Unsubscribe button and POST to us when it is pressed. */
async function vpUnsubHeaders(env, email, campaign) {
  return {
    'List-Unsubscribe': '<' + (await vpUnsubLink(env, email, campaign)) + '>, <' + VP_UNSUB_MAILTO + '>',
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };
}

/* The footer of a marketing email: who is sending (name, ABN, site) and the link. The link in the BODY is
   venueplay.com.au/unsubscribe (31 Oct 2026), the page the welcome emails already link, which writes to the
   same vp_unsubscribes list on its button: a workers.dev address in an email body is what Ozemail's content
   filter bounced. Only the List-Unsubscribe header names this Worker, because a mail app POSTs to it and
   Pages cannot answer a POST, and since 31 Oct 2026 it names it as api.venueplay.com.au (vpUnsubApi). */
async function vpUnsubFooterHtml(env, email, campaign) {
  const e = String(email || '').trim().toLowerCase();
  const link = vpaCustomerSite(env) + '/unsubscribe?e=' + encodeURIComponent(e);
  return '<p style="font-size:12px;color:#9a9aa4;margin:22px 0 0">You are getting this because ' + vpaEsc(e)
    + ' is the contact on a VenuePlay account. '
    + '<a href="' + vpaEsc(link) + '" style="color:#9a9aa4;text-decoration:underline">Unsubscribe</a>'
    + ' from emails like this one. Invoices and account notices are not marketing and still come.</p>'
    + '<p style="font-size:12px;color:#c2c2cc;margin:8px 0 0">VenuePlay, ABN ' + VP_ABN
    + ' &middot; venueplay.com.au</p>';
}

/* Has this address asked us to stop? Reads the whole list through vpaUnsubscribedSet, which
   pages and THROWS on any failure, so a caller that cannot get an answer must not send. */
async function vpUnsubBlocks(env, email) {
  const set = await vpaUnsubscribedSet(env);
  return !!set[String(email || '').trim().toLowerCase()];
}

function vpUnsubPage(title, bodyHtml, status, extra) {
  const html = '<!doctype html><html lang="en-AU"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<meta name="robots" content="noindex,nofollow">'
    + '<title>' + vpaEsc(title) + ' | VenuePlay</title>'
    + '<style>'
    + ':root{--bg:#0B0A0F;--card:#15131C;--line:rgba(255,255,255,.10);--text:#FFF1E6;--muted:#A79FB0;--pink:#FF1F8E}'
    + '*{box-sizing:border-box}html,body{margin:0}'
    + 'body{background:var(--bg);color:var(--text);font:16px/1.6 Manrope,system-ui,-apple-system,"Segoe UI",sans-serif;'
    + 'min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px 16px}'
    + '.card{background:var(--card);border:1px solid var(--line);border-radius:16px;max-width:520px;width:100%;padding:32px 28px}'
    + '.brand{display:flex;align-items:center;gap:9px;margin-bottom:22px;font-weight:700;font-size:15px}'
    + 'h1{font-size:23px;line-height:1.25;margin:0 0 10px}p{margin:0 0 14px;color:var(--muted)}a{color:var(--pink)}'
    + 'button{margin-top:8px;width:100%;padding:13px;border:0;border-radius:9px;background:var(--pink);color:#fff;font:inherit;font-weight:700;cursor:pointer}'
    + '.foot{margin-top:24px;padding-top:16px;border-top:1px solid var(--line);font-size:12.5px;color:var(--muted)}'
    + '</style></head><body><main class="card">'
    + '<div class="brand"><svg width="18" height="21" viewBox="0 0 26 30" fill="none" aria-hidden="true">'
    + '<path d="M2 3 L24 15 L2 27 Z" fill="none" stroke="#FF1F8E" stroke-width="2.6" stroke-linejoin="round"/></svg>VenuePlay</div>'
    + '<div id="msg"><h1>' + vpaEsc(title) + '</h1>' + bodyHtml + '</div>'
    + (extra || '')
    + '<p class="foot">VenuePlay, ABN ' + VP_ABN + '. Gold Coast, Queensland.<br>'
    + 'This only stops marketing email. It does not affect a VenuePlay account, if you have one.</p>'
    + '</main></body></html>';
  return new Response(html, { status: status || 200,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store',
               'x-robots-tag': 'noindex', 'referrer-policy': 'no-referrer' } });
}

/* Writes the opt-out. Returns true only when the table has it. The unique index is on
   lower(email), an expression, so PostgREST's on_conflict cannot name it: a repeat comes back
   409 and that IS "already on the list", first row untouched. */
async function vpRecordUnsub(env, email, source) {
  const res = await fetch(env.SUPABASE_URL + '/rest/v1/vp_unsubscribes', {
    method: 'POST',
    headers: { ...vpaHeaders(env), 'Prefer': 'return=minimal' },
    body: JSON.stringify({ email: email, source: source, note: 'venueplay-api /unsubscribe' }),
  });
  return res.ok || res.status === 409;
}

async function vpHandleUnsubscribe(request, env, url) {
  const email = String(url.searchParams.get('e') || '').trim().toLowerCase();
  const tok = String(url.searchParams.get('t') || '').trim().toLowerCase();
  const camp = vpUnsubCampaign(url.searchParams.get('c'));
  const isPost = request.method === 'POST';
  const BY_HAND = 'Reply to the email with the word unsubscribe, or write to '
    + '<a href="' + VP_UNSUB_MAILTO + '">hello@venueplay.com.au</a>, and we will take you off by hand.';
  const plain = (text, status) => new Response(text, { status: status,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });

  // An unset secret must never mean "any token will do".
  if (!env.VP_UNSUB_SECRET || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
    return isPost ? plain('not configured', 503)
                  : vpUnsubPage('Something went wrong', '<p>Our unsubscribe is having a moment. ' + BY_HAND + '</p>', 503);
  }
  if (!VP_UNSUB_EMAIL_RE.test(email) || email.length > 254
      || !/^[0-9a-f]{32}$/.test(tok) || !vpUnsubSafeEqual(tok, await vpUnsubToken(env, email))) {
    return isPost ? plain('that link is not valid', 403)
                  : vpUnsubPage('That link looks wrong', '<p>It may have been cut short when it was copied. '
                      + 'Use the unsubscribe link in the email itself. ' + BY_HAND + '</p>', 403);
  }

  if (isPost) {
    // A mail app's one-click button sends List-Unsubscribe=One-Click (RFC 8058); our own page
    // sends via=page. Either way this is the person asking.
    let body = '';
    try { body = await request.text(); } catch (_) {}
    const via = /List-Unsubscribe=One-Click/i.test(body) ? 'one-click' : 'link';
    const ok = await vpRecordUnsub(env, email, (via + (camp ? ':' + camp : '')).slice(0, 60)).catch(() => false);
    return ok ? plain('unsubscribed', 200) : plain('could not save, try again', 502);
  }

  // GET: the page. Nothing is written until it posts back.
  const action = '/unsubscribe?e=' + encodeURIComponent(email) + '&t=' + tok + (camp ? '&c=' + camp : '');
  const DONE_H = "You're off the list";
  const DONE_P = 'We will not send ' + vpaEsc(email) + ' any more marketing email from VenuePlay. '
    + 'If you have a VenuePlay account, its invoices and account notices still come.';
  const form = '<form id="f" method="POST" action="' + vpaEsc(action) + '">'
    + '<input type="hidden" name="via" value="page"><noscript><button type="submit">Yes, take me off the list</button></noscript></form>'
    + '<script>(function(){var m=document.getElementById("msg");'
    + 'fetch(' + JSON.stringify(action) + ',{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:"via=page"})'
    + '.then(function(r){if(!r.ok)throw 0;m.innerHTML=' + JSON.stringify('<h1>' + DONE_H.replace(/'/g, '&#39;') + '</h1><p>' + DONE_P + '</p>') + ';})'
    + '.catch(function(){m.innerHTML=' + JSON.stringify('<h1>That did not go through</h1><p>Please try the link again in a minute. ' + BY_HAND + '</p>') + ';});})();</script>';
  return vpUnsubPage('Taking you off the list', '<p>One moment&hellip;</p>', 200, form);
}

/* ---------------------------------------------------------------------------------------
   HQ > CANCELLED > "Invite them back".   POST /admin/invite-back { venue_id }   (Dean, 21 Oct 2026)

   Dean asked for a Reactivate button on a cancelled venue once it has been contacted. Turning a
   cancelled venue back on from HQ would restart billing on a card the venue has asked us to stop
   charging, and every HQ path that does that (un-archiving, Keep this venue through View as)
   charges on the venue's card at renewal with nothing from the venue itself. So the button does
   the one thing that is safe: it emails the account's contact a link to their own account page,
   where "Keep this venue" is one tap by THEM, and that tap is the consent. Nothing is charged,
   nothing is switched on, and the email and its outcome are audited. Owner and accounts admins.
   --------------------------------------------------------------------------------------- */
async function vpaHandleInviteBack(request, env, json) {
  const actor = await vpaRequireAdmin(request, env, ['owner', 'accounts']);
  if (actor.error) return json({ error: actor.error }, actor.status);
  const _b = await vpaBody(request, json);
  if (!_b.ok) return _b.res;
  const venueId = String(_b.body.venue_id || '').trim();
  if (!/^[0-9a-fA-F-]{36}$/.test(venueId)) return json({ error: 'venue_id is required.' }, 400);
  const vs = await vpaReadPage(env, 'vp_venues', 'id=eq.' + encodeURIComponent(venueId)
    + '&select=id,name,founding_id,group_id,status,suspended_reason,cancel_at_period_end&limit=1');
  const v = vs[0];
  if (!v) return json({ error: 'That venue no longer exists.' }, 404);
  if (v.group_id && !v.founding_id) return json({ error: 'This venue is billed through its group. Talk to the group; there is no card of theirs to invite back.' }, 409);
  if (v.status === 'active' && !v.cancel_at_period_end) return json({ error: v.name + ' is not cancelling, so there is nothing to invite them back to.' }, 409);
  const as = await vpaReadPage(env, 'venueplay_founding', 'id=eq.' + encodeURIComponent(v.founding_id || '') + '&select=id,contact_email,contact_name&limit=1');
  const acct = as[0];
  const to = String((acct && acct.contact_email) || '').trim().toLowerCase();
  if (!to) return json({ error: 'There is no contact email on ' + v.name + '\'s account. Ring them instead.' }, 409);
  const archived = v.suspended_reason === 'archived';

  /* THIS ONE IS MARKETING (the 26 Oct 2026 unsubscribe audit found it was the only VenuePlay
     email without an unsubscribe). It is a commercial message to a venue that has told us it
     is leaving, so under the Spam Act it carries a working unsubscribe and it is never sent to
     an address on vp_unsubscribes. Both are checked BEFORE anything goes out, and a check that
     cannot be made is a reason not to send, not a reason to send anyway. */
  if (!env.VP_UNSUB_SECRET) {
    return json({ error: 'VP_UNSUB_SECRET is not set on this Worker, so the unsubscribe link this '
      + 'email has to carry could not be made. Nothing was sent.' }, 503);
  }
  let optedOut;
  try {
    optedOut = await vpUnsubBlocks(env, to);
  } catch (e) {
    return json({ error: 'Could not check the unsubscribe list just now, so nothing was sent. '
      + 'Sending without that check could email someone who has asked us to stop. Please try again in a moment.' }, 503);
  }
  if (optedOut) {
    await vpaAudit(env, actor, 'venue_invited_back', 'venue:' + venueId,
      { name: v.name, to: to, accepted: false, held: 'unsubscribed', archived: archived });
    return json({ error: to + ' has unsubscribed from VenuePlay marketing email, so this cannot be sent. Ring them instead.' }, 409);
  }

  const site = (env.SITE_URL || 'https://venueplay.com.au').replace(/\/+$/, '');
  const link = site + '/app/billing.html';
  const subject = 'Keep ' + v.name + ' on VenuePlay?';
  const html = '<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;padding:8px 0;color:#12101a">'
    + '<img src="' + site + '/logos/venueplay_primary_dark.png" alt="VenuePlay" width="150" style="display:block;margin:0 0 24px">'
    + '<p style="font-size:17px;font-weight:700;margin:0 0 6px">Keep ' + vpaEsc(v.name) + ' on VenuePlay?</p>'
    + '<p style="font-size:14px;color:#3a3a44;margin:0 0 20px">' + (acct.contact_name ? 'Hi ' + vpaEsc(String(acct.contact_name).split(' ')[0]) + ', thanks' : 'Thanks')
    + ' for talking with us. If you would like to keep your games running, sign in to your account page and tap <b>Keep this venue</b>. '
    + 'Nothing changes and nothing is charged unless you do.</p>'
    + '<a href="' + link + '" style="display:inline-block;background:#FF1F8E;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;padding:11px 22px;border-radius:8px">Open my account page</a>'
    + '<p style="font-size:12.5px;color:#9a9aa4;margin:22px 0 0">Questions? Reply to this email.</p>'
    + (await vpUnsubFooterHtml(env, to, 'winback')) + '</div>';
  const sent = await vpaSendEmail(env, to, subject, vpaEmailDocument(html, subject), undefined,
    await vpUnsubHeaders(env, to, 'winback')).catch(function () { return false; });
  await vpaAudit(env, actor, 'venue_invited_back', 'venue:' + venueId, { name: v.name, to: to, accepted: !!sent, archived: archived, unsubscribe_link: true });
  if (!sent) return json({ error: 'The email did not go. Nothing else was changed.' }, 502);
  return json({ ok: true, to: to, note: archived
    ? 'Sent. This venue was archived by us, so their account page may not offer Keep this venue: if they want to come back, set them up again from Venues.'
    : 'Sent. Nothing changes until they tap Keep this venue on their account page.' });
}

/* --- POST /account/reminders : payment-reminder email opt-out. --- */
async function vpbSetReminders(request, env, json) {
  const o = await vpbRequireOwner(request, env);
  if (o.error) return json({ error: o.error }, o.status);
  { const g = vpbOwnerOnly(o, json); if (g) return g; }   // payment reminders are owner-only

  const _b = await vpaBody(request, json);
  if (!_b.ok) return _b.res;
  const b = _b.body;
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
        /* SAY WHY, AND WRITE IT DOWN. This turned a venue's games off and left
           suspended_reason null, so nothing afterwards could tell a venue stopped by its own
           cancellation from one stopped for not paying. That matters because the undo below
           has to know whether it is safe to switch them back on, and with no reason recorded
           it could not, so an owner who cancelled and changed their mind was suspended for
           ever with no way back through the product.

           It also wrote no audit row at all. Turning a venue's games off is the most
           consequential thing this Worker does and it was the one state change with no
           trace: GFLAM GROUP PTY LTD was found suspended on 16 Sep 2026 with nothing
           anywhere to say what had done it. */
        await vpaPatch(env, 'vp_venues', 'id=eq.' + encodeURIComponent(v.id),
          { status: 'suspended', suspended_reason: 'cancelled', closed_at: new Date().toISOString() });
        await vpaInsert(env, 'vp_admin_audit', {
          actor_admin: null, actor_label: 'system',
          action: 'venue_suspended_at_period_end',
          target: 'venue:' + v.id,
          detail: { why: 'cancel_at_period_end was set and the paid period has renewed',
                    invoice: (invoice && invoice.id) || null },
        }, false).catch(() => {});
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
  /* PLAYER DATA IS THE ONE THAT MUST BE ASKED FOR, NOT ASSUMED.

     Every permission here read "true unless explicitly false", so a permissions object that
     simply did not mention players_optin granted it. That is the right way round for
     advertising, raffles and adding hosts: generous, reversible, and the worst case is a
     manager changes a promo slide. It is the wrong way round for a venue's customer list,
     where the worst case is a duty manager or a travelling host walks off with a room full of
     people's contact details and nobody ever notices, because nothing breaks.

     Dean, 17 Sep 2026: player contact data ranks with money, billing and the games working.
     So this one is === true. A manager gets it when the owner ticks the box, and not before.
     The export route has required === true since this morning; this stops the stored record
     disagreeing with it, which is how a box could look ticked while the download refused. */
  const permissions = {
    advertising: p.advertising !== false,
    draws_raffles: p.draws_raffles !== false,
    players_optin: p.players_optin === true,
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

/* ==========================================================================================
   THE MARKETING LOGIN.   Dean, 22 Sep 2026.

   An optional extra login on an account, for whoever does the venue's marketing: often somebody
   outside the venue's staff. They see the numbers, the brand kit, the signs and the advertising
   screens. They see the opt-in list ONLY if the owner ticked the box when adding them. They are
   where a "please remove this person" request is sent. They can never run a game, see billing,
   or change what player data is collected.

   It is its own ROLE in vp_venue_staff ('marketing', migration 86), not a manager with things
   switched off, because this database's row level security grants by role and cannot see a flag
   inside a permissions object. Every guard that existed before this was written asks for
   role in (owner, manager) or (owner, manager, host), so a marketing login is refused by all of
   them without anybody remembering to add it.

   THE TRAP IN THIS FILE: vpbIsOwner(o) is `!o.perms`. An `o` with no perms object IS the owner,
   everywhere. So a marketing `o` ALWAYS carries a perms object, with every owner-side right
   spelt out as false, and it is only ever handed to the routes written for it.
   ========================================================================================== */
const VPM_NO_RIGHTS = { marketing: true, billing: false, add_hosts: false, draws_raffles: false,
                        advertising: true, players_optin: false };

async function vpmRequire(request, env) {
  const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return { error: 'Not signed in.', status: 401 };
  const payload = await vpaVerifyJWT(token, env.SUPABASE_JWT_SECRET, env);
  if (!payload || !payload.sub) return { error: 'Invalid or expired session. Please sign in again.', status: 401 };
  const authUserId = payload.sub;
  let rows;
  try {
    rows = await vpaSelectAll(env, 'vp_venue_staff',
      'auth_user_id=eq.' + encodeURIComponent(authUserId) + '&role=eq.marketing&select=venue_id,permissions,notify_email&order=venue_id.asc');
  } catch (e) { return { error: 'We could not check your access just now. Please try again in a moment.', status: 503 }; }
  if (!rows.length) return { error: 'This login is not a marketing login.', status: 403 };
  const venues = await vpaSelect(env, 'vp_venues',
    'id=in.(' + rows.map((r) => encodeURIComponent(r.venue_id)).join(',') + ')&order=founding_id.asc,created_at.asc' +
    '&select=id,name,founding_id,slug,status,timezone,postcode,created_at');
  if (!venues || !venues.length) return { error: 'No venues found.', status: 403 };
  const foundingId = venues[0].founding_id;
  const mine = venues.filter((v) => v.founding_id === foundingId);
  const accounts = await vpaSelect(env, 'venueplay_founding',
    'id=eq.' + encodeURIComponent(foundingId) + '&select=id,contact_email,status');
  if (!accounts || !accounts[0]) return { error: 'No account found for this login.', status: 404 };
  /* The opt-in tick, MOST RESTRICTIVE WINS, the same rule vpbRequireOwner uses: they may see
     player details only if EVERY one of their rows on this account says so. */
  const mineIds = {}; mine.forEach((v) => { mineIds[v.id] = true; });
  const scoped = rows.filter((r) => mineIds[r.venue_id]);
  const optin = scoped.length > 0 && scoped.every((r) => r.permissions && r.permissions.players_optin === true);
  return { authUserId: authUserId, account: accounts[0], venues: mine, adminActor: null,
           perms: Object.assign({}, VPM_NO_RIGHTS, { players_optin: optin }),
           role: 'marketing', actingAsAdmin: false };
}

/* The Marketing page is for the marketing login, and for the owner and managers too: it is
   their venue's numbers. Owner first, because a login can be both and the owner's view is wider. */
async function vpmRequireAny(request, env) {
  const o = await vpbRequireOwner(request, env);
  if (!o.error) return o;
  if (o.status !== 403) return o;
  return vpmRequire(request, env);
}

async function vpbMarketingAdd(request, env, json) {
  const o = await vpbRequireOwner(request, env);
  if (o.error) return json({ error: o.error }, o.status);
  { const g = vpbOwnerOnly(o, json); if (g) return g; }
  const _b = await vpaBody(request, json);
  if (!_b.ok) return _b.res;
  const b = _b.body;
  const label = String(b.label || '').trim().slice(0, 80);
  if (!label) return json({ error: 'Put in their name, so you can tell who this login is later.' }, 400);
  const mobile = vpaNormaliseMobileAU(b.mobile);
  if (!vpaIsAuMobileE164(mobile)) return json({ error: 'Enter a valid Australian mobile (04...). They sign in by text code.' }, 400);
  const email = String(b.email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 200) {
    return json({ error: 'Put in their email address. It is where we send a request when a player asks to be taken off your list.' }, 400);
  }
  const accountVenueIds = new Set(o.venues.map((v) => v.id));
  const wanted = b.all_venues ? o.venues.map((v) => v.id)
               : (Array.isArray(b.venue_ids) ? b.venue_ids.filter((id) => accountVenueIds.has(id)) : []);
  if (!wanted.length) return json({ error: 'Pick at least one venue for this login.' }, 400);

  let authUserId = null;
  try {
    const u = await vpaAuthCreateUser(env, { phone: mobile, phone_confirm: true, user_metadata: { label: label } });
    authUserId = u && u.id;
  } catch (e) {
    if (e && e.alreadyExists) { const found = await vpaFindAuthUser(env, { phone: mobile }); authUserId = found && found.id; }
    else return json({ error: 'Could not set up that login. Check the mobile and try again.' }, 502);
  }
  if (!authUserId) return json({ error: 'Could not set up that login.' }, 502);

  /* ONE KIND OF LOGIN PER PERSON PER VENUE. A mobile that already signs in here as a host or a
     manager keeps doing exactly that. Making the same person marketing as well would leave two
     rows for one login at one venue, and every guard in both Workers would have to decide
     which one it meant. */
  const existing = await vpaSelect(env, 'vp_venue_staff',
    'auth_user_id=eq.' + encodeURIComponent(authUserId) + '&venue_id=in.(' + wanted.map(encodeURIComponent).join(',') + ')&select=venue_id,role');
  const clash = (existing || []).filter((r) => r.role !== 'marketing');
  if (clash.length) {
    return json({ error: 'That mobile already signs in at your venue as a ' + clash[0].role + '. Use a different mobile for the marketing login, or remove the other login first.' }, 409);
  }
  const have = new Set((existing || []).map((r) => r.venue_id));
  const perms = { players_optin: b.optin === true };       // the owner's tick. Off unless ticked.
  try {
    for (const vid of wanted) {
      if (have.has(vid)) {
        await vpaPatch(env, 'vp_venue_staff', 'auth_user_id=eq.' + encodeURIComponent(authUserId) + '&venue_id=eq.' + encodeURIComponent(vid) + '&role=eq.marketing',
          { display_name: label, notify_email: email, permissions: perms });
      } else {
        await vpaInsert(env, 'vp_venue_staff', { venue_id: vid, auth_user_id: authUserId, role: 'marketing',
          display_name: label, notify_email: email, permissions: perms }, false);
      }
    }
  } catch (e) {
    return json({ error: 'Marketing logins are not switched on for this database yet (migration 86). Email hello@venueplay.com.au and we will sort it.' }, 409);
  }
  await vpaInsert(env, 'vp_admin_audit', { ...vpbActorFields(o), action: 'marketing_login_added', target: 'account:' + o.account.id,
    detail: { label: label, venues: wanted.length, may_see_optins: perms.players_optin } }, false).catch(() => {});
  return json({ ok: true, auth_user_id: authUserId, venue_ids: wanted, may_see_optins: perms.players_optin });
}

async function vpbMarketingList(request, env, json) {
  const o = await vpbRequireOwner(request, env);
  if (o.error) return json({ error: o.error }, o.status);
  { const g = vpbOwnerOnly(o, json); if (g) return g; }
  const rows = await vpaSelectAll(env, 'vp_venue_staff',
    'venue_id=in.(' + o.venues.map((v) => encodeURIComponent(v.id)).join(',') + ')&role=eq.marketing' +
    '&select=auth_user_id,venue_id,display_name,notify_email,permissions&order=venue_id.asc');
  const by = {};
  rows.forEach((r) => {
    const u = by[r.auth_user_id] || (by[r.auth_user_id] = { auth_user_id: r.auth_user_id, label: r.display_name || '', email: r.notify_email || '', venue_ids: [], may_see_optins: true });
    u.venue_ids.push(r.venue_id);
    if (!(r.permissions && r.permissions.players_optin === true)) u.may_see_optins = false;
  });
  return json({ ok: true, users: Object.keys(by).map((k) => by[k]) });
}

async function vpbMarketingRemove(request, env, json) {
  const o = await vpbRequireOwner(request, env);
  if (o.error) return json({ error: o.error }, o.status);
  { const g = vpbOwnerOnly(o, json); if (g) return g; }
  const _b = await vpaBody(request, json);
  if (!_b.ok) return _b.res;
  const target = String(_b.body.auth_user_id || '').trim();
  if (!/^[0-9a-fA-F-]{36}$/.test(target)) return json({ error: 'Missing login.' }, 400);
  // role=eq.marketing on the delete itself: this route can never remove a host, a manager or an owner.
  await vpaDelete(env, 'vp_venue_staff', 'auth_user_id=eq.' + encodeURIComponent(target) +
    '&venue_id=in.(' + o.venues.map((v) => encodeURIComponent(v.id)).join(',') + ')&role=eq.marketing');
  await vpaInsert(env, 'vp_admin_audit', { ...vpbActorFields(o), action: 'marketing_login_removed', target: 'account:' + o.account.id, detail: {} }, false).catch(() => {});
  return json({ ok: true });
}

/* THE NUMBERS. Counts only: nothing here can name a player, so it is safe for a marketing login
   whether or not the owner ticked the opt-in box. Every read is paged, in a stable order, and
   scoped to the caller's own venues by id. */
function vpmLocalDay(iso, tz) {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'Australia/Brisbane', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso)); }
  catch (e) { return String(iso || '').slice(0, 10); }
}
function vpmWeekday(day) { return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date(day + 'T12:00:00Z').getUTCDay()]; }
/* Sixty ids to a request, so a long list never makes a URL the gateway refuses. The READ is
   passed in rather than built here, on purpose: the gate checks that every paged read names its
   table and carries an order, and it can only do that where the call is written out. A helper
   that took the table as a variable hid nine reads from it on the day this was written. */
async function vpmInChunks(ids, read) {
  const out = [];
  for (let i = 0; i < ids.length; i += 60) {
    const part = await read(ids.slice(i, i + 60).map(encodeURIComponent).join(','));
    for (const r of part) out.push(r);
  }
  return out;
}

async function vpmStats(env, venues) {
  const blank = () => ({ games: 0, games_by_type: {}, nights: 0, players: 0, phones: 0, regulars: 0, questions_asked: 0,
                         answers_given: 0, raffle_draws: 0, member_draws: 0, prizes_given: 0, prizes_value_cents: 0,
                         opt_ins: 0, biggest_night: null, busiest_day: null, players_this_month: 0, players_last_month: 0,
                         games_this_month: 0, games_last_month: 0 });
  const per = {}; venues.forEach((v) => { per[v.id] = Object.assign({ venue_id: v.id, venue_name: v.name }, blank()); });
  const tzOf = {}; venues.forEach((v) => { tzOf[v.id] = v.timezone || 'Australia/Brisbane'; });
  const vids = venues.map((v) => v.id);
  if (!vids.length) return { venues: [], total: blank() };
  const nowDay = vpmLocalDay(new Date().toISOString(), 'Australia/Brisbane');
  const thisMonth = nowDay.slice(0, 7);
  const lm = new Date(Date.UTC(+nowDay.slice(0, 4), +nowDay.slice(5, 7) - 2, 1));
  const lastMonth = lm.getUTCFullYear() + '-' + ('0' + (lm.getUTCMonth() + 1)).slice(-2);

  const sessions = await vpmInChunks(vids, (inl) => vpaSelectAll(env, 'vp_sessions',
    'venue_id=in.(' + inl + ')&select=id,venue_id,opened_at,created_at&order=id.asc'));
  const venueOf = {}, dayOf = {};
  sessions.forEach((x) => { venueOf[x.id] = x.venue_id; dayOf[x.id] = vpmLocalDay(x.opened_at || x.created_at, tzOf[x.venue_id]); });
  const sids = sessions.map((x) => x.id);

  const games = sids.length ? await vpmInChunks(sids, (inl) => vpaSelectAll(env, 'vp_games',
    'session_id=in.(' + inl + ')&select=id,session_id,format&order=id.asc')) : [];
  const venueOfGame = {};
  games.forEach((g) => {
    const vid = venueOf[g.session_id]; if (!vid) return; venueOfGame[g.id] = vid;
    const p = per[vid], f = String(g.format || 'game').replace(/^bingo90$/, 'bingo').replace(/^musical_bingo$/, 'musical bingo');
    p.games++; p.games_by_type[f] = (p.games_by_type[f] || 0) + 1;
    const m = (dayOf[g.session_id] || '').slice(0, 7);
    if (m === thisMonth) p.games_this_month++; else if (m === lastMonth) p.games_last_month++;
  });

  const players = sids.length ? await vpmInChunks(sids, (inl) => vpaSelectAll(env, 'vp_players',
    'session_id=in.(' + inl + ')&select=id,session_id,device_id,is_test&order=id.asc')) : [];
  const nightCount = {}, phoneNights = {};
  players.forEach((pl) => {
    if (pl.is_test) return;
    const vid = venueOf[pl.session_id]; if (!vid) return;
    const day = dayOf[pl.session_id], p = per[vid];
    p.players++;
    const m = (day || '').slice(0, 7);
    if (m === thisMonth) p.players_this_month++; else if (m === lastMonth) p.players_last_month++;
    (nightCount[vid] || (nightCount[vid] = {}))[day] = ((nightCount[vid] || {})[day] || 0) + 1;
    if (pl.device_id) { const k = vid + '|' + pl.device_id; (phoneNights[k] || (phoneNights[k] = {}))[day] = true; }
  });
  Object.keys(phoneNights).forEach((k) => { const vid = k.split('|')[0]; per[vid].phones++; if (Object.keys(phoneNights[k]).length >= 3) per[vid].regulars++; });
  Object.keys(nightCount).forEach((vid) => {
    const days = nightCount[vid], wk = {};
    per[vid].nights = Object.keys(days).length;
    Object.keys(days).forEach((d) => {
      if (!per[vid].biggest_night || days[d] > per[vid].biggest_night.players) per[vid].biggest_night = { day: d, players: days[d] };
      const w = vpmWeekday(d); wk[w] = (wk[w] || 0) + days[d];
    });
    per[vid].busiest_day = Object.keys(wk).sort((a, b) => wk[b] - wk[a])[0] || null;
  });

  const triviaIds = games.filter((g) => g.format === 'trivia').map((g) => g.id);
  if (triviaIds.length) {
    const ans = await vpmInChunks(triviaIds, (inl) => vpaSelectAll(env, 'vp_trivia_answers',
    'game_id=in.(' + inl + ')&select=id,game_id,question_id&order=id.asc'));
    const asked = {};
    ans.forEach((a) => { const vid = venueOfGame[a.game_id]; if (!vid) return; per[vid].answers_given++; asked[a.game_id + '|' + a.question_id] = vid; });
    Object.keys(asked).forEach((k) => { per[asked[k]].questions_asked++; });
  }
  const raffleIds = games.filter((g) => g.format === 'raffle').map((g) => g.id);
  if (raffleIds.length) {
    const rr = await vpmInChunks(raffleIds, (inl) => vpaSelectAll(env, 'vp_raffle_results',
    'game_id=in.(' + inl + ')&select=id,game_id&order=id.asc'));
    rr.forEach((r) => { const vid = venueOfGame[r.game_id]; if (vid) per[vid].raffle_draws++; });
  }
  const draws = await vpmInChunks(vids, (inl) => vpaSelectAll(env, 'vp_member_draws',
    'venue_id=in.(' + inl + ')&select=id,venue_id&order=id.asc'));
  if (draws.length) {
    const vOfDraw = {}; draws.forEach((d) => { vOfDraw[d.id] = d.venue_id; });
    const dr = await vpmInChunks(draws.map((d) => d.id), (inl) => vpaSelectAll(env, 'vp_member_draw_results',
    'draw_id=in.(' + inl + ')&select=id,draw_id&order=id.asc'));
    dr.forEach((r) => { const vid = vOfDraw[r.draw_id]; if (vid) per[vid].member_draws++; });
  }
  const prizes = await vpmInChunks(vids, (inl) => vpaSelectAll(env, 'v_vp_prizes_given',
    'venue_id=in.(' + inl + ')&select=venue_id,prizes_given_count,prizes_given_value_cents,cash_given_count,cash_given_value_cents&order=venue_id.asc'));
  prizes.forEach((r) => { const p = per[r.venue_id]; if (!p) return;
    p.prizes_given += (r.prizes_given_count || 0) + (r.cash_given_count || 0);
    p.prizes_value_cents += (r.prizes_given_value_cents || 0) + (r.cash_given_value_cents || 0); });
  // opted_in_at only: a COUNT of people who said yes. Never a name, an address or a number.
  const optins = await vpmInChunks(vids, (inl) => vpaSelectAll(env, 'v_vp_player_optins',
    'venue_id=in.(' + inl + ')&select=venue_id,opted_in_at&order=opted_in_at.asc'));
  optins.forEach((r) => { if (per[r.venue_id]) per[r.venue_id].opt_ins++; });

  const total = blank();
  const list = venues.map((v) => per[v.id]);
  list.forEach((p) => {
    ['games', 'nights', 'players', 'phones', 'regulars', 'questions_asked', 'answers_given', 'raffle_draws', 'member_draws',
     'prizes_given', 'prizes_value_cents', 'opt_ins', 'players_this_month', 'players_last_month', 'games_this_month', 'games_last_month']
      .forEach((k) => { total[k] += p[k]; });
    Object.keys(p.games_by_type).forEach((f) => { total.games_by_type[f] = (total.games_by_type[f] || 0) + p.games_by_type[f]; });
    if (p.biggest_night && (!total.biggest_night || p.biggest_night.players > total.biggest_night.players)) {
      total.biggest_night = Object.assign({ venue_name: p.venue_name }, p.biggest_night);
    }
  });
  return { venues: list, total: total };
}

async function vpmSummary(request, env, json) {
  const o = await vpmRequireAny(request, env);
  if (o.error) return json({ error: o.error }, o.status);
  let stats;
  try { stats = await vpmStats(env, o.venues); }
  catch (e) { return json({ error: 'We could not add up your numbers just now. Please try again in a moment.' }, 503); }
  return json({ ok: true, role: o.role || 'owner',
    may_see_optins: o.role === 'marketing' ? !!(o.perms && o.perms.players_optin === true) : vpbCan(o, 'players_optin'),
    venues: o.venues.map((v) => ({ id: v.id, name: v.name, slug: v.slug })), stats: stats });
}

/* --- POST /account/optin-export : CSV of marketing opt-ins, STRICTLY the caller's own venues.
   Returns { csv }. The page turns it into a download. Scoping is server-side: venue_id is
   filtered to o.venues only (resolved from the login), never from anything the browser sends,
   so an owner can never pull another venue's or account's contacts. --- */

/* The opt-in CSV for a set of venues. One builder, two callers: the owner's own download and
   HQ's download of anybody's. A second copy would have drifted the moment the header changed,
   and the header is the bit a venue pastes into a mail tool. */
async function vpaOptinCsv(env, venues) {
  const ids = venues.map((v) => v.id);
  const vname = {}; venues.forEach((v) => { vname[v.id] = v.name; });
  const header = ['Venue', 'First name', 'Last name', 'Email', 'Mobile', 'Postcode', 'Opted in'];
  const out = [];
  if (ids.length) {
    /* PAGED. Unpaged, a venue with more than a thousand opt-ins downloaded the first
       thousand and was told nothing. Their own customer list, silently short. */
    const rows = await vpaSelectAll(env, 'v_vp_player_optins',
      'venue_id=in.(' + ids.map(encodeURIComponent).join(',') +
      ')&select=venue_id,first_name,last_name,email,mobile,postcode,opted_in_at'
      /* opted_in_at is NOT unique, and offset paging over a non-unique order can skip a
         row at a page boundary when two timestamps tie. The tiebreakers make it total. */
      + '&order=opted_in_at.desc,email.asc,mobile.asc');
    /* One person once. The same punter joins a dozen nights, and a venue pasting this into a
       mail tool must not email them a dozen times. Keyed on email, then mobile, then the name,
       which is the same order of trust the rest of this file uses. */
    const seen = {};
    for (const r of (rows || [])) {
      const key = String(r.email || r.mobile || ((r.first_name || '') + '|' + (r.last_name || ''))).toLowerCase();
      if (seen[key]) continue; seen[key] = true;
      out.push([vname[r.venue_id] || '', r.first_name, r.last_name, r.email, r.mobile, r.postcode, r.opted_in_at]);
    }
  }
  /* AND SAY WHAT IS BEING HELD BACK, rather than letting it vanish.

     A capture that arrives without a player token cannot be vouched for: broadcast bingo has no
     session, so anyone who knows a venue exists could post a forged opt-in with a consent
     timestamp, which is a Spam Act problem for the VENUE. Those rows are stored, marked
     during_game false, and excluded from this file by v_vp_player_optins. That exclusion is the
     right call and it stays.

     What was wrong is that nobody was ever told. The venue collected details, a real person
     consented, and the list simply did not contain them, with nothing anywhere saying so. Silence
     is the worst of the three possible behaviours: worse than handing over an unverifiable row,
     and worse than refusing loudly. As at 17 Sep 2026, 9 of 30 captures arrive with no token, so
     this is roughly a third of them the day a venue switches collection on.

     Best effort on purpose. A venue's real list must never fail to download because the count of
     what is missing could not be worked out. */
  let held = 0;
  if (ids.length) {
    try {
      const h = await vpaSelectAll(env, 'vp_captures',
        'venue_id=in.(' + ids.map(encodeURIComponent).join(',') + ')'
        + '&marketing_optin=is.true&during_game=is.false&select=id&order=id.asc');
      held = (h || []).length;
    } catch (_) { held = 0; }
  }
  return { csv: [header].concat(out).map((cols) => cols.map(vpbCsvCell).join(',')).join('\n') + '\n',
           count: out.length, held_unverified: held };
}

/* GET /admin/optin-export?venue_id=...   or ?founding_id=...
 *
 * Dean, 17 Sep 2026: "I should be able to export any venues as well as ours."
 *
 * There was no way to. The only export was /account/optin-export, which is scoped to the
 * signed-in owner's own venues, so HQ could see that opt-ins existed and never get them out.
 * A venue ringing up asking for their list could not be helped without asking them to log in.
 *
 * No looksLikeVenue test and no optin_release_approved test here, deliberately: both of those
 * exist to stop a THIRD PARTY walking off with a venue's customers, and this route is us.
 * It is admin-only and writes an audit row naming who exported what.
 */
async function vpaHandleAdminOptinExport(request, env, json) {
  const actor = await vpaRequireAdmin(request, env, ['owner', 'accounts']);
  if (actor.error) return json({ error: actor.error }, actor.status);
  const url = new URL(request.url);
  const venueId = (url.searchParams.get('venue_id') || '').trim();
  const foundingId = (url.searchParams.get('founding_id') || '').trim();
  /* Said the way a person reads it: this is surfaced on a button in HQ, not in a console. */
  if (!venueId && !foundingId) return json({ error: 'No venue was named, so there was nothing to export. Reload HQ and try again.' }, 400);
  const filter = venueId
    ? 'id=eq.' + encodeURIComponent(venueId)
    : 'founding_id=eq.' + encodeURIComponent(foundingId);
  const venues = await vpaSelect(env, 'vp_venues', filter + '&select=id,name');
  if (!venues || !venues.length) return json({ error: 'That venue is not on the account any more, so there is nothing to export.' }, 404);
  const res = await vpaOptinCsv(env, venues);
  await vpaAudit(env, actor, 'optin_exported_by_admin',
    venueId ? ('venue:' + venueId) : ('account:' + foundingId),
    { rows: res.count, held_unverified: res.held_unverified, venues: venues.map((v) => v.name) }).catch(() => {});
  return json({ ok: true, csv: res.csv, count: res.count,
                held_unverified: res.held_unverified,
                venues: venues.map((v) => v.name) });
}


/* GET /admin/venue-marketing-export
 *
 * OUR OWN marketing list, which is a different thing from the player opt-ins above and must
 * never be confused with them. These are VENUES who ticked "send me the occasional update"
 * when they signed up. The players belong to the venue; these people said yes to us.
 *
 * venueplay_founding.marketing_opt_in has been written since August and read by NOTHING:
 * two writes, zero reads, the same shape as the bingo opt-ins that never reached a venue.
 * Eleven venues have ticked it and there has never been a way to find out who.
 *
 * Only the ones who said YES. Under the Spam Act the tick is the consent, so a list that
 * quietly included the eleven who did not tick would be the whole problem, not a convenience.
 */
/* EVERYONE WHO HAS ASKED US TO STOP, read straight from the table.

   THROWS rather than returning [] on failure, and that is the whole point. vpaSelect answers []
   for ANY non-2xx, and an empty unsubscribe list is indistinguishable from "nobody has ever
   unsubscribed". One transient database error while HQ downloaded this list would have exported
   every person who had opted out, with no sign anything had gone wrong, and the next campaign
   would have gone to all of them. A list of people we must not contact is only safe if we know
   the query succeeded, so this fails closed. */
async function vpaUnsubscribedSet(env) {
  /* PAGED. This was one bare fetch with no limit, offset or order, and PostgREST stops at
     1000 rows in silence. So the 1,001st person to unsubscribe went straight back onto the
     marketing export, and nothing anywhere said so. The table takes anonymous inserts from a
     public page and is the opt-out list behind a 15,582-contact campaign, so a thousand rows
     is a near-term number, and anyone can push it past a thousand on purpose. A Spam Act
     promise that quietly stops being kept at row 1,001 is the worst kind: it looks kept.
     vpaSelectAll throws on a failed page rather than returning short, which matters here
     more than anywhere: a SHORT opt-out list means emailing people who said stop. */
  const rows = await vpaSelectAll(env, 'vp_unsubscribes', 'select=email&order=email.asc');
  if (!Array.isArray(rows)) throw new Error('the unsubscribe list did not come back as a list');
  const set = Object.create(null);
  for (const r of rows) {
    const e = String((r && r.email) || '').trim().toLowerCase();
    if (e) set[e] = true;
  }
  return set;
}

async function vpaHandleVenueMarketingExport(request, env, json) {
  const actor = await vpaRequireAdmin(request, env, ['owner', 'accounts']);
  if (actor.error) return json({ error: actor.error }, actor.status);

  /* NOBODY WHO HAS ASKED US TO STOP. Found 17 Sep 2026: unsubscribing WORKED, the page wrote to
     vp_unsubscribes and a live test landed a row, and then NOTHING anywhere read it. Not this
     export, not the outreach tools, despite a comment in this file saying the outreach tools
     did. So a venue could click unsubscribe in one of our emails, be recorded as having opted
     out, and appear on the very next list we used to market to them. That is the Spam Act, and
     it is the one fault on this platform that carries a fine rather than an apology.

     Held-back rows are COUNTED and reported, never silently dropped. A filter that matches
     nothing looks exactly like a filter that works, and this one will legitimately match nothing
     for a while yet, so the number is the only way to tell the difference. */
  let unsub;
  try {
    unsub = await vpaUnsubscribedSet(env);
  } catch (e) {
    return json({ error: 'Could not check the unsubscribe list just now, so nothing was '
      + 'exported. Exporting without that check could send marketing to people who have asked '
      + 'us to stop. Please try again in a moment.' }, 503);
  }

  const rows = await vpaSelect(env, 'venueplay_founding',
    'marketing_opt_in=is.true&select=venue_name,contact_name,contact_email,mobile,postcode,created_at,status'
    + '&order=created_at.desc') || [];
  /* A venue that has since been archived is still a person who consented, so they stay on the
     list with their status alongside. Deciding whether to write to a venue that left is a
     judgement for whoever reads this, not something to make for them by hiding the row. */
  const header = ['Venue', 'Contact', 'Email', 'Mobile', 'Postcode', 'Signed up', 'Account status'];
  const seen = {}, out = [];
  let heldBack = 0;
  for (const r of rows) {
    const key = String(r.contact_email || '').trim().toLowerCase();
    if (!key) continue;                       // no address, nothing to send to
    if (seen[key]) continue; seen[key] = true; // one person once, however many venues they run
    // Opted in once, asked us to stop since. The later answer is the one that counts.
    if (unsub[key]) { heldBack++; continue; }
    out.push([r.venue_name, r.contact_name, r.contact_email, r.mobile, r.postcode,
              String(r.created_at || '').slice(0, 10), r.status]);
  }
  const csv = [header].concat(out).map((c) => c.map(vpbCsvCell).join(',')).join('\n') + '\n';
  await vpaAudit(env, actor, 'venue_marketing_exported', 'accounts',
    { rows: out.length, held_back_unsubscribed: heldBack }).catch(() => {});
  return json({ ok: true, csv: csv, count: out.length, considered: rows.length,
                held_back_unsubscribed: heldBack });
}

/* A CELL A SPREADSHEET WILL NOT RUN. first_name, last_name, email and mobile are typed by
   anybody at all on an unauthenticated join screen, and this file is opened in Excel by a
   publican. A value starting = + - @ (or a tab or carriage return) is a FORMULA to a
   spreadsheet, so a "name" of =HYPERLINK(...) became a live link in the venue's own customer
   list. A leading apostrophe makes it text. \r is quoted too: it was passed through bare and
   splits a row in two. */
function vpbCsvCell(v) {
  let s = String(v == null ? '' : v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
async function vpbOptinExport(request, env, json) {
  const g = await vpbOptinGate(request, env, json);
  if (g.reply) return g.reply;
  const o = g.o;
  /* o.venues is resolved from THEIR OWN staff rows, never from client input, so this stays
     scoped to their venues exactly as before. Same builder as the HQ route now. */
  const res = await vpaOptinCsv(env, o.venues);
  await vpaInsert(env, 'vp_admin_audit', { ...vpbActorFields(o), action: 'optin_exported', target: 'account:' + o.account.id,
    detail: { rows: res.count, held_unverified: res.held_unverified } }, false).catch(() => {});
  return json({ ok: true, csv: res.csv, count: res.count, held_unverified: res.held_unverified });
}

/* WHO MAY TAKE A VENUE'S CUSTOMER LIST AWAY, asked once for every list (22 Oct 2026). The player
   opt-ins and the purchase raffle opt-ins are the same kind of thing, so they share this answer
   rather than each keeping a copy that could drift. { o } when allowed, { reply } when not. */
async function vpbOptinGate(request, env, json) {
  /* An owner, a manager, or a marketing login. The marketing login arrives with perms spelt
     out (vpmRequire), so the two rules below apply to it exactly as they do to a manager:
     players_optin must be TRUE, not merely absent, and the account must be approved. */
  let o = await vpbRequireOwner(request, env);
  if (o.error && o.status === 403) { const m = await vpmRequire(request, env); if (!m.error) o = m; }
  if (o.error) return { reply: json({ error: o.error }, o.status) };
  if (!vpbCan(o, 'players_optin')) return { reply: json({ error: 'You do not have permission to export opt-in data.' }, 403) };
  /* A MANAGER MAY, BUT ONLY IF THEY HAVE BEEN TICKED. Dean, 17 Sep 2026: "a manager can do
     the opt in data however they need to be ticked to be able to do that."

     vpbCan is not enough on its own here, because it reads an ABSENT permission as granted:
     `!o.perms || o.perms[key] !== false`. 21 of the 22 staff rows carry no permissions object
     at all, so every one of the 17 managers could download a venue's whole player contact
     list without anybody having decided they should. For advertising or a raffle that default
     is generous and harmless. For a customer list it is the wrong way round.

     So: the account owner always may. A manager needs players_optin ticked, explicitly true,
     not merely un-refused. An HQ admin using View as may, because that is us on the phone to
     the venue and it is audited.

     This TIGHTENS things for existing managers, on purpose: none of them has a permissions
     object, so none of them was ever granted this. They are told who to ask, not just no. */
  const mayExport = o.actingAsAdmin || o.role === 'owner'
                 || !!(o.perms && o.perms.players_optin === true);
  if (!mayExport) {
    return { reply: json({ error: 'Your manager access does not include player details. The venue owner '
      + 'can tick "Players and opt-in export" for you on the Account page, or export it themselves.' }, 403) };
  }
  /* NEVER COLLECT WHAT YOU WILL NOT HAND BACK. Customer data belongs to the venue, and this gate
     exists so a third party cannot quietly take one. But it was asking a DIFFERENT question to
     the gate that decides whether an account may collect at all, with a different word list:

       collecting  is gated on the contact EMAIL DOMAIN  (migration 43, widened by 82)
       exporting   was gated on the VENUE NAME           (a shorter list, right here)

     Eleven words were on one list and not the other: bar, lounge, bistro, cellars, winery,
     taphouse, alehouse, brewery, brewhouse, hospitality, sportsclub. So The Mini Bar, on its own
     domain, was allowed to collect its customers' details and then refused its own list back. We
     hold their data and will not give it to them, which is the worst outcome available here and
     reads as us keeping it deliberately.

     So the two questions are now the SAME question, asked of both things we know: the venue's
     name OR the contact email domain. Anything allowed to collect can always export. The export
     side stays deliberately the more generous of the two, because being wrong here means a real
     venue waits a day for a human, while being wrong on the collection side means a stranger
     starts harvesting a room.

     The word list below MUST match migration 82's. release-check.py compares them and fails if
     they drift, because a list in two places is how this happened. */
  /* TWO GROUPS, EXACTLY AS MIGRATION 82 HAS THEM, and they are not interchangeable.

     The original words are matched anywhere in a domain. That is loose (it matches publicsydney
     on "pub" and innisfailrealestate on "inn") and migration 82 deliberately did NOT tighten it,
     because tightening would revoke accounts that are auto-approved today and collecting legally.

     The words added later are ANCHORED: the word has to end a label or be followed by a
     non-letter. That is what keeps barossavalleywines and barbershopquartet out on "bar", the
     trap CLAUDE.md records under "Never do these".

     MIRRORING THAT SPLIT IS THE WHOLE POINT. My first version anchored all of them, which was
     tidier and wrong: publicsydney.com.au could COLLECT under the loose SQL rule and then could
     not EXPORT under the strict one here, which is the very fault this change exists to remove,
     reintroduced one line lower down. Export must never be stricter than collection. */
  const VPA_VENUE_WORDS_LOOSE = 'hotel|tavern|rsl|club|pub|bowls|bowlo|bowling|leagues'
    + '|surf|golf|hospitality|inn|arms|brewery|brewhouse|sportsclub|sports|services';
  const VPA_VENUE_WORDS_ANCHORED = 'bar|lounge|bistro|cellars?|winery|taphouse|alehouse';
  const VPA_VENUE_WORDS = VPA_VENUE_WORDS_LOOSE + '|' + VPA_VENUE_WORDS_ANCHORED;
  /* A venue NAME is spaced words, so whole-word matching is right throughout: "The Mini Bar"
     matches and "Barossa Valley Wines" does not, without needing the split. */
  const VENUE_RE = new RegExp('\\b(' + VPA_VENUE_WORDS + ')\\b', 'i');
  const DOMAIN_RE = new RegExp('(' + VPA_VENUE_WORDS_LOOSE + ')|(' + VPA_VENUE_WORDS_ANCHORED + ')([^a-z]|$)', 'i');
  const FREE_MAILBOX_RE = /^(gmail|googlemail|outlook|hotmail|live|msn|yahoo|ymail|icloud|me|mac|aol|proton|protonmail|gmx|bigpond|optusnet|tpg|iinet|internode|westnet|dodo|exemail)\./i;

  let approved = false, acctEmail = '';
  try {
    const ar = await vpaSelect(env, 'venueplay_founding',
      'id=eq.' + encodeURIComponent(o.account.id) + '&select=optin_release_approved,contact_email');
    approved = !!(ar && ar[0] && ar[0].optin_release_approved);
    acctEmail = String((ar && ar[0] && ar[0].contact_email) || '');
  } catch (_) { /* column may not exist yet (migration 20) */ }

  const domain = acctEmail.split('@').slice(1).join('@').toLowerCase();
  // A free mailbox says nothing about who owns the customers, so it never qualifies on its own.
  const domainLooksLikeVenue = !!domain && !FREE_MAILBOX_RE.test(domain) && DOMAIN_RE.test(domain);
  const looksLikeVenue = o.venues.some((v) => VENUE_RE.test(v.name || '')) || domainLooksLikeVenue;
  if (!looksLikeVenue && !approved) {
    return { reply: json({ error: 'Opt-in downloads for this account are pending a quick review, this protects venue customer data. We approve within a business day, or email hello@venueplay.com.au.', pending: true }, 403) };
  }
  return { o: o };
}

/* POST /account/purchase-raffle-export { venue_id }
   The people in a venue's purchase raffle who ticked the marketing box THEMSELVES, as CSV.
   Only them: an entrant who did not tick is never in this file, whatever else they gave. The
   same gate as the player opt-in export (owner; a manager only with players_optin ticked; HQ
   View as; an approved account), the venue must be one of the caller's own, paged past 1,000
   rows, and audited. Customer details never leave by any other door. */
async function vpbPurchaseRaffleExport(request, env, json) {
  const g = await vpbOptinGate(request, env, json);
  if (g.reply) return g.reply;
  const o = g.o;
  const _b = await vpaBody(request, json);
  if (!_b.ok) return _b.res;
  const venueId = String(_b.body.venue_id || '').trim();
  const venue = o.venues.find(function (v) { return v.id === venueId; });
  if (!venue) return json({ error: 'That venue is not on your account.' }, 403);
  let rows;
  try {
    rows = await vpaSelectAll(env, 'vp_purchase_raffle_entrants',
      'venue_id=eq.' + encodeURIComponent(venueId) + '&marketing_opt_in=is.true'
      + '&select=raffle_id,first_name,last_name,email,phone,opted_in_at&order=opted_in_at.asc,id.asc');
  } catch (e) {
    return json({ error: 'Could not read the raffle entrants just now, so nothing was exported. Please try again in a moment.' }, 503);
  }
  const names = {};
  (await vpaSelect(env, 'vp_purchase_raffles', 'venue_id=eq.' + encodeURIComponent(venueId) + '&select=id,name') || [])
    .forEach(function (r) { names[r.id] = r.name; });
  const header = ['Venue', 'Raffle', 'First name', 'Last name', 'Email', 'Mobile', 'Opted in'];
  const seen = {}, out = [];
  for (const r of (rows || [])) {
    const key = String(r.email || r.phone || '').toLowerCase();
    if (key && seen[key]) continue; if (key) seen[key] = true;   // one person once, across raffles
    const mobile = /^\+614\d{8}$/.test(r.phone || '') ? '0' + r.phone.slice(3) : (r.phone || '');
    out.push([venue.name, names[r.raffle_id] || '', r.first_name, r.last_name, r.email, mobile, r.opted_in_at]);
  }
  const csv = [header].concat(out).map((c) => c.map(vpbCsvCell).join(',')).join('\n') + '\n';
  await vpaInsert(env, 'vp_admin_audit', { ...vpbActorFields(o), action: 'purchase_raffle_optins_exported', target: 'venue:' + venueId,
    detail: { rows: out.length } }, false).catch(() => {});
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

/* --- POST /account/manager-perms : change an existing manager's four toggles. ---
   body { auth_user_id, permissions: { advertising, draws_raffles, players_optin, add_hosts } }
   Until now the toggles could only be set when the manager was added; changing one meant removing
   them and adding them again, which also re-sent the welcome text. Owner-only. Only rows that
   ALREADY carry a permissions object are touched: a manager row with none is a full-access login
   (the venue's own), and writing toggles onto it would lock that person out of billing. */
async function vpbSetManagerPerms(request, env, json) {
  const o = await vpbRequireOwner(request, env);
  if (o.error) return json({ error: o.error }, o.status);
  { const g = vpbOwnerOnly(o, json); if (g) return g; }   // only the owner sets what a manager may do
  const b = await request.json().catch(() => ({}));
  const target = String(b.auth_user_id || '').trim();
  if (!target) return json({ error: 'Missing manager.' }, 400);
  if (target === o.authUserId) return json({ error: 'You cannot change your own permissions.' }, 400);
  const p = b.permissions || {};
  /* PLAYER DATA IS THE ONE THAT MUST BE ASKED FOR, NOT ASSUMED.

     Every permission here read "true unless explicitly false", so a permissions object that
     simply did not mention players_optin granted it. That is the right way round for
     advertising, raffles and adding hosts: generous, reversible, and the worst case is a
     manager changes a promo slide. It is the wrong way round for a venue's customer list,
     where the worst case is a duty manager or a travelling host walks off with a room full of
     people's contact details and nobody ever notices, because nothing breaks.

     Dean, 17 Sep 2026: player contact data ranks with money, billing and the games working.
     So this one is === true. A manager gets it when the owner ticks the box, and not before.
     The export route has required === true since this morning; this stops the stored record
     disagreeing with it, which is how a box could look ticked while the download refused. */
  const permissions = {
    advertising: p.advertising !== false,
    draws_raffles: p.draws_raffles !== false,
    players_optin: p.players_optin === true,
    add_hosts: p.add_hosts !== false,
  };
  const venueIds = o.venues.map((v) => v.id);
  if (!venueIds.length) return json({ error: 'No venues on this account.' }, 404);
  const rows = await vpaSelect(env, 'vp_venue_staff',
    'auth_user_id=eq.' + encodeURIComponent(target) +
    '&venue_id=in.(' + venueIds.map(encodeURIComponent).join(',') + ')&role=eq.manager&select=venue_id,permissions');
  if (!rows || !rows.length) return json({ error: 'That manager is not on this account.' }, 404);
  if (rows.some((r) => !r.permissions)) {
    return json({ error: 'That login has full access to this account, so its permissions cannot be changed here.' }, 403);
  }
  for (const r of rows) {
    await vpaPatch(env, 'vp_venue_staff',
      'auth_user_id=eq.' + encodeURIComponent(target) + '&venue_id=eq.' + encodeURIComponent(r.venue_id) + '&role=eq.manager',
      { permissions: permissions });
  }
  await vpaInsert(env, 'vp_admin_audit', { ...vpbActorFields(o), action: 'manager_perms_set', target: 'user:' + target, detail: { permissions: permissions, venues: rows.length } }, false).catch(() => {});
  return json({ ok: true, permissions: permissions });
}

/* --- POST /account/permits : record a permit, licence or authority the venue holds. ---
   body { venue_id, kind: 'bingo'|'raffle'|'members',
          permit: { number, holder:'venue'|'npo', npo_name, authorised_on, expires, note } }
   -> { ok, permits, recorded:{bingo,raffle,members} }

   The venue's own record of what it holds, written to vp_venues.permits (migration 100) and
   read back by the console before a paid game (vp-gaming.js permitRecorded). Recording it is
   the venue's choice and nothing here verifies it: Anisimoff, 1 Oct 2026, point 5 ("you may
   wish to keep records ... so you can conduct manual checks"), and 8 Oct 2026, point 4, where
   the warranty and indemnity in the terms suffice when verifying is impractical.

   Guarded like every other settings write: an owner, or a manager with the draws_raffles
   right (the same toggle that lets them set up a raffle), scoped to the caller's own venues.
   A host has no row vpbRequireOwner accepts, so a host is refused before the body is read.
   An all-empty permit clears that kind. The whole object is rewritten from what is stored
   plus this one kind, so two managers saving different kinds cannot blank each other's. */
async function vpbSetPermits(request, env, json) {
  const o = await vpbRequireOwner(request, env);
  if (o.error) return json({ error: o.error }, o.status);
  if (!vpbCan(o, 'draws_raffles')) return json({ error: 'You do not have permission to record permits. Ask your account owner.' }, 403);
  const b = await request.json().catch(() => ({}));
  const venueId = String(b.venue_id || '').trim();
  const venue = o.venues.find((v) => v.id === venueId);
  if (!venue) return json({ error: 'Pick one of your venues.' }, 400);
  const kind = String(b.kind || '').trim();
  if (VPA_PERMIT_KINDS.indexOf(kind) === -1) return json({ error: "kind must be 'bingo', 'raffle' or 'members'." }, 400);
  const cleaned = vpaCleanPermit(b.permit);
  if (!cleaned.ok) return json({ error: cleaned.error }, 400);

  const rows = await vpaSelect(env, 'vp_venues', 'id=eq.' + encodeURIComponent(venueId) + '&select=id,permits');
  const prior = rows && rows[0];
  if (!prior) return json({ error: 'That venue could not be read just now. Please try again.' }, 503);
  const permits = (prior.permits && typeof prior.permits === 'object' && !Array.isArray(prior.permits))
    ? Object.assign({}, prior.permits) : {};
  if (cleaned.empty) delete permits[kind]; else permits[kind] = cleaned.permit;

  const res = await fetch(env.SUPABASE_URL + '/rest/v1/vp_venues?id=eq.' + encodeURIComponent(venueId), {
    method: 'PATCH',
    headers: { ...vpaHeaders(env), 'Prefer': 'return=representation' },
    body: JSON.stringify({ permits: permits }),
  });
  if (!res.ok) return json({ error: 'Could not save. ' + (await res.text()).slice(0, 180) }, 500);
  const saved = (await res.json())[0] || {};
  const stored = (saved.permits && typeof saved.permits === 'object') ? saved.permits : permits;
  const recorded = {};
  VPA_PERMIT_KINDS.forEach((k) => { recorded[k] = vpaPermitRecorded(stored, k); });

  await vpaInsert(env, 'vp_admin_audit', { ...vpbActorFields(o), action: 'permits_set', target: 'venue:' + venueId,
    detail: { kind: kind, cleared: cleaned.empty || undefined, holder: cleaned.empty ? undefined : cleaned.permit.holder,
              recorded: recorded[kind] } }, false).catch(() => {});
  return json({ ok: true, permits: stored, recorded: recorded });
}

/* --- POST /account/compliance-accept : section 6 of the Terms, accepted once. ---
   body { venue_id, accepted: true, by: '<name>' }
   -> { ok, compliance_accepted_at, compliance_accepted_by, already? }

   Anisimoff Legal 9380, 1 Oct 2026, point 3: "prudent to ensure Customers actively tick a check
   box". Onboarding has recorded that tick since 15 Oct 2026 (migration 100), but every venue set up
   before then, Tugun Bowls Club included, has none, and nothing ever asked them: 1 of 27 venues had
   a record on 28 Oct 2026 (legal compliance matrix, gap 1). The console now asks once (vp-session.js
   termsCard) and this records it in the SAME two columns, the SAME way: a name typed by the person
   ticking, and the time. The sentence they tick is VPA_COMPLIANCE_TICK, word for word.

   An owner or a manager of the venue, nobody else: vpbRequireOwner admits only those staff rows,
   so a host is refused before the body is read. HQ "View as" is refused too: the venue accepts
   its own Terms, and an acceptance HQ typed would not be the venue's.
   ONE TIME. A venue that already has a record keeps it: the write is conditional on the column
   being empty, so two managers ticking at once leave the first record, never the last. */
async function vpbAcceptCompliance(request, env, json) {
  const o = await vpbRequireOwner(request, env);
  if (o.error) return json({ error: o.error }, o.status);
  if (o.actingAsAdmin) return json({ error: 'Only the venue\'s owner or a manager can accept the Terms for it. HQ View as cannot accept them on the venue\'s behalf.' }, 403);
  const b = await request.json().catch(() => ({}));
  const venueId = String(b.venue_id || '').trim();
  const venue = o.venues.find((v) => v.id === venueId);
  if (!venue) return json({ error: 'Pick one of your venues.' }, 400);
  if (b.accepted !== true) return json({ error: 'Tick the box to accept section 6 of the Terms.' }, 400);
  const by = String(b.by || '').trim().slice(0, 120);
  if (!by) return json({ error: 'Enter your name, so the record says who accepted it.' }, 400);

  const vid = encodeURIComponent(venueId);
  const prior = (await vpaSelect(env, 'vp_venues', 'id=eq.' + vid + '&select=id,compliance_accepted_at,compliance_accepted_by') || [])[0];
  if (!prior) return json({ error: 'That venue could not be read just now. Please try again.' }, 503);
  if (prior.compliance_accepted_at) {
    return json({ ok: true, already: true, compliance_accepted_at: prior.compliance_accepted_at, compliance_accepted_by: prior.compliance_accepted_by || null });
  }
  const at = new Date().toISOString();
  const res = await fetch(env.SUPABASE_URL + '/rest/v1/vp_venues?id=eq.' + vid + '&compliance_accepted_at=is.null', {
    method: 'PATCH',
    headers: { ...vpaHeaders(env), 'Prefer': 'return=representation' },
    body: JSON.stringify({ compliance_accepted_at: at, compliance_accepted_by: by }),
  });
  if (!res.ok) return json({ error: 'Could not save. ' + (await res.text()).slice(0, 180) }, 500);
  /* Read it back rather than trust the PATCH's answer: the write is conditional, so a row that is
     not ours now means somebody else at the venue accepted it in the same moment. Theirs stands. */
  const now = (await vpaSelect(env, 'vp_venues', 'id=eq.' + vid + '&select=compliance_accepted_at,compliance_accepted_by') || [])[0];
  if (!now || !now.compliance_accepted_at) return json({ error: 'That did not save. Please try again in a minute.' }, 503);
  // Compared as instants: Postgres answers "+00:00" where we sent "Z".
  if (Date.parse(now.compliance_accepted_at) !== Date.parse(at) || now.compliance_accepted_by !== by) {
    return json({ ok: true, already: true, compliance_accepted_at: now.compliance_accepted_at, compliance_accepted_by: now.compliance_accepted_by || null });
  }
  await vpaInsert(env, 'vp_admin_audit', { ...vpbActorFields(o), action: 'compliance_accepted', target: 'venue:' + venueId,
    detail: { compliance_accepted_by: by, role: o.role || null, terms_effective: VPA_TERMS_EFFECTIVE, tick: VPA_COMPLIANCE_TICK } }, false).catch(() => {});
  return json({ ok: true, compliance_accepted_at: at, compliance_accepted_by: by });
}

/* --- POST /account/draw-log : every raffle winner and members draw result for one venue. ---
   body { venue_id, months?: 1..12 }
   Draws and raffles are recorded in two tables the game Worker writes on the night, and until
   now nothing on the venue side read them back: the host saw a winner on the TV and the owner
   had only a single prizes total. This is the log the owner asked for ("who won what, when"),
   gated by the same "Members draws & raffles" toggle that gates setting them up, and scoped to
   the caller's venues (a manager's o.venues is already theirs alone). Read-only. Raffle rows
   join to the venue through vp_games.session_id -> vp_sessions.venue_id, so both hops are
   bounded: the most recent 300 sessions and 400 rows per table is a year of ordinary nights. */
async function vpbDrawLog(request, env, json) {
  const o = await vpbRequireOwner(request, env);
  if (o.error) return json({ error: o.error }, o.status);
  if (!vpbCan(o, 'draws_raffles')) return json({ error: 'You do not have permission to see draws and raffles. Ask your account owner.' }, 403);
  const b = await request.json().catch(() => ({}));
  const venueId = String(b.venue_id || '').trim();
  const venue = o.venues.find((v) => v.id === venueId);
  if (!venue) return json({ error: 'Pick one of your venues.' }, 400);
  let months = parseInt(b.months, 10); if (!(months >= 1 && months <= 12)) months = 3;
  const since = new Date(Date.now() - months * 31 * 86400000).toISOString();
  const vid = encodeURIComponent(venueId);
  const rows = [];

  // Members draws: draw rows carry the venue, result rows carry the draw.
  const draws = await vpaSelect(env, 'vp_member_draws', 'venue_id=eq.' + vid + '&select=id,name') || [];
  if (draws.length) {
    const nameById = {}; draws.forEach((d) => { nameById[d.id] = d.name || 'Members draw'; });
    const res = await vpaSelect(env, 'vp_member_draw_results',
      'draw_id=in.(' + draws.map((d) => encodeURIComponent(d.id)).join(',') + ')' +
      '&drawn_at=gte.' + encodeURIComponent(since) +
      '&select=draw_id,outcome,amount_cents,member_number,winner_name,drawn_at&order=drawn_at.desc&limit=400') || [];
    for (const r of res) {
      rows.push({
        at: r.drawn_at, kind: 'members_draw', name: nameById[r.draw_id] || 'Members draw',
        outcome: r.outcome === 'claimed' ? 'Claimed' : (r.outcome === 'jackpot_rolled' ? 'Not claimed, jackpot rolled over' : String(r.outcome || '')),
        number: r.member_number != null ? String(r.member_number) : '',
        winner: r.winner_name || '',
        prize: r.amount_cents != null ? ('$' + (r.amount_cents / 100).toFixed(2)) : '',
        cents: (r.outcome === 'claimed' && r.amount_cents) ? r.amount_cents : 0,
      });
    }
  }

  // Raffles: sessions -> raffle games -> results.
  const sessions = await vpaSelect(env, 'vp_sessions',
    'venue_id=eq.' + vid + '&created_at=gte.' + encodeURIComponent(since) + '&select=id&order=created_at.desc&limit=300') || [];
  if (sessions.length) {
    const games = await vpaSelect(env, 'vp_games',
      'session_id=in.(' + sessions.map((x) => encodeURIComponent(x.id)).join(',') + ')&format=eq.raffle&select=id,started_at&order=started_at.desc&limit=300') || [];
    if (games.length) {
      const res = await vpaSelect(env, 'vp_raffle_results',
        'game_id=in.(' + games.map((g) => encodeURIComponent(g.id)).join(',') + ')' +
        '&select=game_id,seq,ticket_number,status,outcome,drawn_at,prize_text,prize_type,prize_value_cents&order=drawn_at.desc&limit=400') || [];
      for (const r of res) {
        /* A ticket that was drawn and never presented keeps its row with status 'no_show', which
           is also what a redraw stamps on the ticket it replaced. Both mean the same thing to the
           venue (nobody claimed that number), so say that rather than invent a distinction the
           data cannot support. 'drawn' is a number called but not yet resolved. */
        const noShow = r.status === 'no_show' || r.outcome === 'no_show';
        rows.push({
          at: r.drawn_at, kind: 'raffle', name: 'Raffle' + (r.seq ? ', draw ' + r.seq : ''),
          outcome: noShow ? 'Not claimed' : (r.outcome === 'claimed' ? 'Claimed' : 'Drawn'),
          number: r.ticket_number != null ? String(r.ticket_number) : '',
          winner: '',
          prize: r.prize_text || (r.prize_value_cents != null ? '$' + (r.prize_value_cents / 100).toFixed(2) : ''),
          cents: (!noShow && r.prize_type === 'cash' && r.prize_value_cents) ? r.prize_value_cents : 0,
        });
      }
    }
  }
  rows.sort((a, c) => Date.parse(c.at || 0) - Date.parse(a.at || 0));
  const cashCents = rows.reduce((n, r) => n + (r.cents || 0), 0);
  return json({ ok: true, venue: { id: venue.id, name: venue.name }, months: months, rows: rows.slice(0, 500), cash_cents: cashCents, cash: '$' + (cashCents / 100).toFixed(2) });
}

/* A game report inside a session's window is that session's game, already on the session's card.
   Bingo and musical bingo both open a session now, so merging every report listed one night four
   or five times (break test, 14 Oct 2026). Only a report with no session around it, a
   broadcast-only game, still needs a card of its own. One copy, used by HQ and the Account page. */
function reportsOutsideSessions(sessions, reports) {
  const windows = (sessions || []).map((s) => {
    const from = Date.parse(s.opened_at || s.created_at || 0);
    const to = s.ended_at ? Date.parse(s.ended_at) : Infinity;   // still open: everything after it is inside
    return [from - 60000, to + 60000];
  });
  return (reports || []).filter((r) => {
    const t = Date.parse(r.started_at || r.created_at || 0);
    return !windows.some((w) => t >= w[0] && t <= w[1]);
  });
}

/* --- POST /account/nights : how did the last few nights go, for one venue. ---
   body { venue_id, limit?: 1..30 }
   The morning after, an owner or manager opened the app and found the game menu and nothing
   about last night. The only nights report was HQ's. This is the same assembly, scoped to the
   caller's venues and stripped of the billing half: date, what was played, how many people
   joined, how many of them had been on an earlier night (device_id, migration 39), and what
   was given away. Broadcast bingo opens no session, so its end-of-game reports are merged in
   the same way HQ does it. Read-only. */
async function vpbNights(request, env, json) {
  const o = await vpbRequireOwner(request, env);
  if (o.error) return json({ error: o.error }, o.status);
  const b = await request.json().catch(() => ({}));
  const venueId = String(b.venue_id || '').trim();
  const venue = o.venues.find((v) => v.id === venueId);
  if (!venue) return json({ error: 'Pick one of your venues.' }, 400);
  let limit = parseInt(b.limit, 10); if (!(limit >= 1 && limit <= 30)) limit = 12;
  const vid = encodeURIComponent(venueId);

  const sessions = await vpaSelect(env, 'vp_sessions',
    'venue_id=eq.' + vid + '&select=id,status,opened_at,started_at,ended_at,created_at&order=created_at.desc&limit=' + (limit + 10)) || [];
  let games = [], players = [], seenDevices = [];
  if (sessions.length) {
    const ids = sessions.map((x) => encodeURIComponent(x.id)).join(',');
    games = await vpaSelect(env, 'vp_games', 'session_id=in.(' + ids + ')&select=id,session_id,format,status,started_at&order=seq.asc') || [];
    /* PAGED. Up to 22 nights of players in one read stops at a thousand rows without a word, and
       the headcounts on the Account page are what an owner checks the bill against. */
    players = await vpaSelectAll(env, 'vp_players', 'session_id=in.(' + ids + ')&select=id,session_id&order=id.asc') || [];
    /* device_id is asked for SEPARATELY, and on purpose. vpaSelect turns any PostgREST refusal
       into an empty list, so naming a column the live database has not been given yet (migration
       39) would have returned no players at all and every night would have read "0 players".
       Split in two, a missing column costs the "came back" figure and nothing else. */
    try {
      seenDevices = await vpaSelectAll(env, 'vp_players', 'session_id=in.(' + ids + ')&select=session_id,device_id&order=id.asc') || [];
    } catch (e) { seenDevices = []; }   // a missing column costs the "came back" figure and nothing else, as before
  }
  const headcount = {}, devices = {};
  for (const p of players) headcount[p.session_id] = (headcount[p.session_id] || 0) + 1;
  for (const p of seenDevices) {
    if (p.device_id) (devices[p.session_id] = devices[p.session_id] || new Set()).add(p.device_id);
  }
  const byId = {};
  for (const g of games) { (byId[g.session_id] = byId[g.session_id] || []).push(g); }

  // Prizes on the night: raffle cash and claimed members draws, by day, so a night can show
  // "given away" without another join per row.
  const prizesByDay = {};
  try {
    const raffleGames = games.filter((g) => g.format === 'raffle');
    if (raffleGames.length) {
      const rr = await vpaSelect(env, 'vp_raffle_results',
        'game_id=in.(' + raffleGames.map((g) => encodeURIComponent(g.id)).join(',') + ')&status=eq.winner&select=drawn_at,prize_type,prize_value_cents&limit=400') || [];
      for (const r of rr) { const d = String(r.drawn_at || '').slice(0, 10); prizesByDay[d] = (prizesByDay[d] || 0) + ((r.prize_type === 'cash' && r.prize_value_cents) || 0); }
    }
    const draws = await vpaSelect(env, 'vp_member_draws', 'venue_id=eq.' + vid + '&select=id') || [];
    if (draws.length) {
      const mr = await vpaSelect(env, 'vp_member_draw_results',
        'draw_id=in.(' + draws.map((d) => encodeURIComponent(d.id)).join(',') + ')&outcome=eq.claimed&select=drawn_at,amount_cents&order=drawn_at.desc&limit=200') || [];
      for (const r of mr) { const d = String(r.drawn_at || '').slice(0, 10); prizesByDay[d] = (prizesByDay[d] || 0) + (r.amount_cents || 0); }
    }
  } catch (e) { /* the nights still list without prize figures */ }

  // Oldest first so "came back" only counts devices seen on an EARLIER night.
  const ordered = sessions.slice().sort((a, c) => Date.parse(a.created_at || 0) - Date.parse(c.created_at || 0));
  const seen = new Set();
  const nights = [];
  for (const s of ordered) {
    const gs = byId[s.id] || [];
    const devs = devices[s.id] || new Set();
    let back = 0;
    devs.forEach((d) => { if (seen.has(d)) back++; });
    devs.forEach((d) => seen.add(d));
    const at = s.started_at || s.opened_at || s.created_at;
    const formats = [];
    gs.forEach((g) => { if (g.format && formats.indexOf(g.format) === -1) formats.push(g.format); });
    nights.push({
      kind: 'session', at: at, ended_at: s.ended_at || null, status: s.status,
      players: headcount[s.id] || 0, games: gs.length, formats: formats,
      came_back: back, came_back_known: devs.size > 0,
      prize_cents: prizesByDay[String(at || '').slice(0, 10)] || 0,
      abandoned: gs.length === 0 && (headcount[s.id] || 0) === 0,
    });
  }
  const reports = await vpaSelect(env, 'vp_game_reports',
    'venue_id=eq.' + vid + '&select=id,format,players,tickets,started_at,ended_at,created_at&order=created_at.desc&limit=' + limit) || [];
  for (const r of reportsOutsideSessions(sessions, reports)) {
    nights.push({
      kind: 'report', at: r.started_at || r.created_at, ended_at: r.ended_at || null,
      status: r.ended_at ? 'finished' : 'unfinished',
      players: r.players || 0, tickets: r.tickets || 0, games: 1, formats: r.format ? [r.format] : [],
      came_back: 0, came_back_known: false, prize_cents: 0, abandoned: false,
    });
  }
  nights.sort((a, c) => Date.parse(c.at || 0) - Date.parse(a.at || 0));
  return json({ ok: true, venue: { id: venue.id, name: venue.name }, nights: nights.slice(0, limit) });
}

/* Each login comes back with a role (owner, manager or host), whether it holds full access, and
   the last three digits of its mobile. Without those an owner with two "Sam"s could not tell
   them apart, and could remove a manager thinking they were a host. A manager sees only the
   logins at their own venues (o.venues is already scoped for them). */
async function vpbListHosts(request, env, json) {
  const o = await vpbRequireOwner(request, env);
  if (o.error) return json({ error: o.error }, o.status);
  const venueIds = o.venues.map((v) => v.id);
  if (!venueIds.length) return json({ hosts: [], venues: [] });
  const staff = await vpaSelect(env, 'vp_venue_staff',
    'venue_id=in.(' + venueIds.map(encodeURIComponent).join(',') + ')&role=in.(owner,manager,host)&select=auth_user_id,venue_id,role,display_name,permissions');
  const byUser = {};
  for (const s of (staff || [])) {
    if (!byUser[s.auth_user_id]) byUser[s.auth_user_id] = { auth_user_id: s.auth_user_id, label: s.display_name || '', venue_ids: [], role: 'host', is_owner: false, full_access: false, mobile_last3: null };
    const u = byUser[s.auth_user_id];
    u.venue_ids.push(s.venue_id);
    if (s.role === 'owner') { u.is_owner = true; u.role = 'owner'; }
    else if (s.role === 'manager' && u.role !== 'owner') u.role = 'manager';
    // A manager row with no permissions object is a full-access login (the venue's own login,
    // as HQ onboarding creates it). Only the owner may remove or re-scope those.
    if (s.role !== 'host' && !s.permissions) u.full_access = true;
    if (s.display_name && !u.label) u.label = s.display_name;
  }
  if (byUser[o.authUserId]) { byUser[o.authUserId].is_owner = true; byUser[o.authUserId].role = 'owner'; byUser[o.authUserId].full_access = true; }
  // Mobile digits, in parallel and bounded: a slow Auth API costs the digits, never the list.
  const ids = Object.keys(byUser).slice(0, 60);
  const users = await Promise.all(ids.map((id) => vpaAuthGetUser(env, id)));
  users.forEach((u, i) => { if (u && u.phone) byUser[ids[i]].mobile_last3 = vpaMaskMobile(u.phone); });
  return json({
    hosts: Object.keys(byUser).map((k) => byUser[k]),
    venues: o.venues.map((v) => ({ id: v.id, name: v.name })),
    can_manage_hosts: vpbIsOwner(o) || vpbCan(o, 'add_hosts'),
    is_owner: vpbIsOwner(o),
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
    // vpaCustomerSite: only ever venueplay.com.au, so a SITE_URL left on a preview or .dev address
    // never goes out in a text (Dean, 31 Oct 2026: no .dev links in anything a customer sees).
    const site = vpaCustomerSite(env)
      .replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '');
    const venue = String((opts && opts.venueName) || 'Your venue').slice(0, 24);
    const slug = (opts && opts.slug) || '';
    // The TV link only makes sense for ONE venue. Someone added across several gets the sign-in
    // link and finds their screens from the console rather than a wrong guess.
    const tv = slug ? (' TV URL: ' + site + '/tv?' + slug) : '';
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
    '&venue_id=in.(' + wanted.map(encodeURIComponent).join(',') + ')&select=venue_id,role');
  /* One kind of login per person per venue (see vpbMarketingAdd). This used to read "already
     has a row here" as "already a host" and skip the venue without a word, which for a
     marketing login would have reported success and added nobody. */
  if ((existing || []).some((r) => r.role === 'marketing')) {
    return json({ error: 'That mobile is already the marketing login at your venue. Use a different mobile for a host, or remove the marketing login first.' }, 409);
  }
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
/* Who may touch a staff login. The owner: anyone but a full-access login. A manager with the
   "Add hosts" toggle: HOST-role logins at their own venues only (o.venues is already scoped to
   theirs, so the rows we see are the rows they may touch). Anything else is refused with the
   same words the page shows, so the buttons and the Worker agree for once. */
function vpbStaffGuard(o, targetRows, json) {
  const rows = targetRows || [];
  if (vpbIsOwner(o)) return null;
  if (!vpbCan(o, 'add_hosts')) return json({ error: 'You do not have permission to change hosts. Ask your account owner.' }, 403);
  if (!rows.length || rows.some((r) => r.role !== 'host')) {
    return json({ error: 'Only the account owner can change a manager or full-access login.' }, 403);
  }
  return null;
}

async function vpbRemoveHost(request, env, json) {
  const o = await vpbRequireOwner(request, env);
  if (o.error) return json({ error: o.error }, o.status);
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
  // A manager with "Add hosts" may remove host-role logins at their venues; everything else is owner-only.
  { const g = vpbStaffGuard(o, targetRows, json); if (g) return g; }
  const targetIsFullAccess = (targetRows || []).some((r) => (r.role === 'owner') || (r.role !== 'host' && !r.permissions));
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
  /* THE KEY THEY HELD GOES WITH THEM. Every host at a venue signs with the venue's one private
     key, handed to their browser. Revoking the login left that key working for ever (audit,
     20 Sep 2026). Deleting the row rotates it: the next console at the venue mints a fresh
     pair on its five-minute refresh, and every screen picks the new key up on its own. */
  await vpbRotateScreenKeys(env, venueIds);
  return json({ ok: true, screens_resecured: venueIds.length });
}

/* Rotate the signing key of each venue named: delete the row, and the next legitimate console
   mints a new pair (a Worker cannot generate an ECDSA key; the browser does). Best effort per
   venue, so one refusal does not leave the others holding a key a removed host still has. */
async function vpbRotateScreenKeys(env, venueIds) {
  let n = 0;
  for (const vid of venueIds || []) {
    try { await vpaDelete(env, 'vp_venue_signing_keys', 'venue_id=eq.' + encodeURIComponent(vid)); n++; } catch (e) {}
  }
  return n;
}

/* "Someone has left": the owner's one plain button. Rotates every venue on the account. */
async function vpbResecureScreens(request, env, json) {
  const o = await vpbRequireOwner(request, env);
  if (o.error) return json({ error: o.error }, o.status);
  if (!vpbCan(o, 'add_hosts')) return json({ error: 'Only the account owner, or a manager allowed to manage hosts, can do this.' }, 403);
  const ids = o.venues.map((v) => v.id);
  const n = await vpbRotateScreenKeys(env, ids);
  try {
    await vpaAudit(env, { actorId: o.adminActor ? o.adminActor.id : null, label: (o.adminActor && o.adminActor.label) || 'owner' },
      'screens_resecured', o.account.id, { venues: n });
  } catch (e) {}
  return json({ ok: true, venues: n });
}

/* PORTED VERBATIM FROM fix/audit-40, not rewritten.
   billing.html has been calling this route since it was written, and it exists in
   NEITHER Worker on main, so the Edit venues button on the Hosts and Managers lists
   has never once worked: it POSTs, the router falls through, and the page shows the
   word "not found" in red. The implementation was finished on an unmerged branch.
   Writing a second one from scratch is how two versions of a permissions check end
   up in a codebase, so this is that code, moved. */
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
  if (currentRows.some((r) => r.role === 'marketing')) {
    return json({ error: 'To change which venues a marketing login covers, remove it and add it again.' }, 400);
  }
  // A manager with "Add hosts" may re-scope host-role logins at their venues; everything else is owner-only.
  { const g = vpbStaffGuard(o, currentRows, json); if (g) return g; }
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
  // Remove rows for venues they were de-selected from (never an owner row), and rotate those
  // venues' screen keys: the login still holds them (see vpbRemoveHost).
  const lost = [];
  for (const r of currentRows) {
    if (wantSet.has(r.venue_id)) continue;
    await vpaDelete(env, 'vp_venue_staff',
      'auth_user_id=eq.' + encodeURIComponent(target) + '&venue_id=eq.' + encodeURIComponent(r.venue_id) + '&role=neq.owner');
    if (lost.indexOf(r.venue_id) < 0) lost.push(r.venue_id);
  }
  await vpbRotateScreenKeys(env, lost);
  return json({ ok: true, auth_user_id: target, venue_ids: wanted });
}

// The signed-in host's venues, for the sign-in venue picker (any staff role).
async function vpbMyVenues(request, env, json) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  const payload = token ? await vpaVerifyJWT(token, env.SUPABASE_JWT_SECRET, env) : null;
  if (!payload || !payload.sub) return json({ error: 'Not signed in.' }, 401);
  const staff = await vpaSelect(env, 'vp_venue_staff',
    'auth_user_id=eq.' + encodeURIComponent(payload.sub) + '&select=venue_id,role');
  if (!staff || !staff.length) {
    // A Gflam HQ admin is staff nowhere, but must be able to pick any venue to view as.
    const admins = await vpaSelect(env, 'vp_platform_admins',
      'auth_user_id=eq.' + encodeURIComponent(payload.sub) + '&select=auth_user_id');
    if (admins && admins.length) {
      /* Paged, and ordered by name AND id: this is the HQ admin's "view as" picker, so a
         truncated read is an admin who cannot reach a venue at all. See the note in
         vpaHandleQuietVenues about shared venue names making name.asc unstable. */
      const all = await vpaSelectAll(env, 'vp_venues', 'select=id,name,slug&order=name.asc,id.asc');
      return json({ venues: all || [] });
    }
    return json({ venues: [] });
  }
  const ids = staff.map((s) => s.venue_id);
  const venues = await vpaSelect(env, 'vp_venues',
    'id=in.(' + ids.map(encodeURIComponent).join(',') + ')&select=id,name,slug&order=name.asc');
  /* marketing_only: every row this login holds is a marketing one. The console sends such a
     login to its own page instead of showing it game buttons it could only be refused by. */
  return json({ venues: venues || [], marketing_only: staff.every((x) => x.role === 'marketing') });
}

/* ==========================================================================================
   THE HELP DESK (migration 106, 19 Oct 2026), for VenuePlay AND PartyPlay

   Dean, 19 Oct 2026: "add a small 'Help' link to a short FAQ, plus a 'Contact support' form that
   creates a ticket ... That gives you a record without phone calls ... sales, support (venue and
   customer) and also we could categorise calls as well? Nothing super fancy, just a bit of a
   report after." Then: "We need to know if it is sales, support, accounts etc enquiry." Then:
   "can we dual brand this helpdesk with partyplay as well?" Then: tickets are for STAFF only.

   THE ONE RULE: TICKETS ARE READ BY HQ AND NOBODY ELSE. A patron, a guest, a venue owner, a host
   and a PartyPlay host can SUBMIT. None of them can read a ticket, a list of tickets or a count,
   for either brand, not even their own. Every route here that returns ticket data starts with
   helpAdmin(), which is vpaRequireAdmin with HELP_ADMIN_ROLES. The one exception is
   /help/push/peek, which answers a staff device's own push secret with brand, category and
   ticket number only (see there). The tables are service role only, so this file is the only
   door.

   HELP_ADMIN_ROLES is owner, accounts AND staff. 'staff' is the existing Gflam staff role in
   vp_platform_admins (HQ already hides Audit and Flagged from it, and the game Worker refuses it
   any venue action), which makes it the support role Dean asked for without a new role: adding
   one would have needed every vp_is_platform_admin() policy in the database reviewed.

   WAYS IN, all making the same kind of row:
     POST /help/ticket           public: a VenuePlay patron, a PartyPlay guest, a PartyPlay host
                                 (by party code; PartyPlay hosts have no login this Worker can
                                 check, so it is recorded as what they typed), a PartyPlay sales
                                 enquiry. Rate limited by network, device and email; honeypot.
     POST /contact               the VenuePlay website's "Talk to us" form, now also a sales ticket.
     POST /help/venue/ticket     a signed-in VenuePlay venue login (any staff role at that venue).
     email()                     Cloudflare Email Routing (see ~/venue-enrich/HELP-DESK-EMAIL-SETUP.md).
     POST /admin/help/*          HQ only.

   NOTHING IS AUTO-REPLIED TO WHOEVER FILLED IN A FORM. An acknowledgement to any typed address
   would make a public form a way to send our mail to strangers. The page shows the number.
   ========================================================================================== */
const HELP_BRANDS     = ['venueplay', 'partyplay'];
const HELP_CATEGORIES = ['sales', 'venue_support', 'patron_support', 'accounts', 'general'];
const HELP_CHANNELS   = ['patron_form', 'venue_form', 'web_form', 'email', 'phone', 'manual'];
const HELP_STATUSES   = ['new', 'open', 'waiting', 'closed'];
const HELP_PRIORITIES = ['normal', 'urgent'];
const HELP_ADMIN_ROLES = ['owner', 'accounts', 'staff'];
const HELP_STAFF_ROLES = ['owner', 'manager', 'host', 'marketing'];
const HELP_BRAND_LABEL = { venueplay: 'VenuePlay', partyplay: 'PartyPlay' };
function helpCategoryLabel(category, brand) {
  // PartyPlay has hosts and guests, not venues and patrons.
  if (brand === 'partyplay') return ({ sales: 'Sales', venue_support: 'Host support', patron_support: 'Guest support', accounts: 'Accounts', general: 'General' })[category] || 'General';
  return ({ sales: 'Sales', venue_support: 'Venue support', patron_support: 'Player support', accounts: 'Accounts', general: 'General' })[category] || 'General';
}
const HELP_MAX_PER_IP = 20;        // an hour. A pub's wifi is ONE address for the whole room
const HELP_MAX_PER_DEVICE = 3;     // ten minutes
const HELP_MAX_PER_EMAIL = 5;      // an hour
const HELP_MAX_PER_STAFF = 10;     // an hour, a signed-in venue login
const HELP_MESSAGE_MAX = 4000;
const HELP_UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const HELP_EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

/* WHICH ADDRESS ANSWERS WHICH TICKET. The From must be on the brand's send. subdomain, the only
   domains Resend sends for; venueplay.com.au and partyplay.com.au are at DMARC quarantine with
   Migadu as their only sender, so a From of support@venueplay.com.au sent through Resend would
   land in junk. The Reply-To is the real Migadu mailbox, and from there the help subdomain copy
   threads the answer back onto the ticket. */
function helpFromFor(category, brand) {
  const b = brand === 'partyplay' ? 'partyplay' : 'venueplay';
  const local = (category === 'venue_support' || category === 'patron_support') ? 'support'
              : category === 'accounts' ? 'accounts' : 'hello';
  const who = HELP_BRAND_LABEL[b] + (local === 'support' ? ' Support' : local === 'accounts' ? ' Accounts' : '');
  return { from: who + ' <' + local + '@send.' + b + '.com.au>', reply_to: local + '@' + b + '.com.au' };
}
/* The address a message was sent TO decides its category and brand. Migadu copies support@,
   accounts@, sales@ and hello@ to the same name on each brand's help subdomain. */
function helpCategoryForAddress(addr) {
  const local = String(addr || '').toLowerCase().trim().split('@')[0].replace(/\+.*$/, '');
  if (local === 'support') return 'venue_support';
  if (local === 'accounts') return 'accounts';
  if (local === 'sales') return 'sales';
  return 'general';
}
function helpBrandForAddress(addr) {
  return /@([a-z0-9-]+\.)*partyplay\.com\.au$/i.test(String(addr || '').trim()) ? 'partyplay' : 'venueplay';
}

function helpLine(v, max) { return String(v == null ? '' : v).replace(/[\x00-\x1f\x7f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max); }
function helpText(v) { return String(v == null ? '' : v).replace(/\r\n?/g, '\n').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]+/g, ' ').trim(); }
function helpHtml(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function helpTag(no) { return '[#' + no + ']'; }
/* What a customer's email subject carries: the number AND a reference made from the ticket's secret.
   A reply has to quote both before it is added to the ticket (migration 108). Staff alerts carry the
   number only.

   THE SUBJECT LOOKS LIKE A PERSON WROTE IT (Dean, 28 Oct 2026). His reply to a test ticket landed in
   Outlook junk (SCL 6) with SPF, DKIM and DMARC all passing; the subject ended "[#1003-sc_s3W4TIcTU]",
   a random mixed-case string of the kind spam filters score. Now it ends "(ticket 1003, ref K7QP-2XMA)".
   Why the secret is still in the subject, as a booking-style reference, and not only in a header or
   the Reply-To: a reply never carries our custom headers back, and a reply to support+1003-...@ reaches
   this Worker only if Migadu's alias copy to the help subdomain keeps the +part, which nothing here can
   prove. The subject is the one thing every mail client keeps on a reply. The reference is the first 40
   bits of the 72-bit secret in an alphabet with no 0/O or 1/I to misread: guessing one takes about a
   trillion emails, and the old "[#1003-secret]" form still threads for tickets already open. */
const HELP_REF_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const HELP_REF_RE = /\(ticket (\d{3,9}), ref ([A-Za-z2-9]{4})-?([A-Za-z2-9]{4})\)/;
function helpRef(token) {
  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let bits = '';
  for (const c of String(token || '')) { const i = B64.indexOf(c); if (i < 0) return ''; bits += ('00000' + i.toString(2)).slice(-6); }
  if (bits.length < 40) return '';
  let out = '';
  for (let i = 0; i < 40; i += 5) out += HELP_REF_ALPHABET[parseInt(bits.slice(i, i + 5), 2)];
  return out.slice(0, 4) + '-' + out.slice(4);
}
function helpReplyTag(t) { const ref = helpRef(t.reply_token); return '(ticket ' + t.ticket_no + (ref ? ', ref ' + ref : '') + ')'; }
/* A subject with every ticket tag taken off, old ("[#1003-...]") and new ("(ticket 1003, ref ...)"),
   so "Re: Re:" replies never stack them up. */
function helpBareSubject(s) {
  return String(s || '').replace(/\s*\[#[^\]]*\]\s*/g, ' ').replace(/\s*\(ticket \d{3,9}(, ref [A-Za-z2-9-]{8,9})?\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
}
/* WHO SIGNS. A person, never a department: "Dean" over "VenuePlay support". An HQ reply is signed by
   the admin who sent it when their HQ label is a name; the acknowledgement by HELP_SIGNER, else Dean. */
function helpSigner(env, label) {
  const l = helpLine(label, 40);
  if (/^[A-Za-z][A-Za-z' -]{1,39}$/.test(l)) return l;
  return helpLine((env && env.HELP_SIGNER) || 'Dean', 40) || 'Dean';
}
/* THE SIGNATURE (Dean, 29 Oct 2026): a copy of his own Outlook signature, so a help desk email signs
   off the way his support@ and hello@ mail does. ONE function, so it can be swapped whole. In order:
     the sign-off "Kind Regards", unless the reply already ends on one of its own ("Cheers,");
     the brand's square logo (VenuePlay's glows: a looping GIF whose FIRST frame is the whole logo,
     because Outlook on a desktop shows only that frame), a pink rule, then the person's name, the
     brand in pink, and P, E and W: the phone, the mailbox the email came from, the website;
     the confidentiality note and the Acknowledgement of Country, small and grey. The Acknowledgement
     names "The Gflam Group of Companies": Dean's choice, and the ONE place Gflam may appear in these
     emails (release-check's "never Gflam" line allows exactly that sentence).
   The phone line (P) goes to a venue or a prospective venue only: a VenuePlay ticket about a venue, a
   bill or a sale. Never a player's (the menu sends players to voicemail) and never PartyPlay, which
   has no line. Links are pink and underlined, so they look like links (Dean, 29 Oct 2026). */
const HELP_LINK = 'class="hd-a" style="color:#C70F69;text-decoration:underline"';
function helpCountry(pp) {
  return (pp ? 'PartyPlay' : 'VenuePlay') + ' and The Gflam Group of Companies acknowledge the Traditional Owners of the land on which we work and create. We pay our respects to Elders past and present.';
}
function helpSignatureHtml(ticket, signer, replyTo, signedOff) {
  const pp = ticket.brand === 'partyplay';
  const brand = pp ? 'PartyPlay' : 'VenuePlay';
  const site = pp ? 'partyplay.com.au' : 'venueplay.com.au';
  const icon = pp ? 'https://partyplay.com.au/logos/email-signature-partyplay.png' : 'https://venueplay.com.au/logos/email-signature-venueplay.gif';
  const phone = !pp && ['venue_support', 'accounts', 'sales'].indexOf(ticket.category) !== -1;
  const L = (k, v) => '<strong style="color:#FF1F8E">' + k + '</strong>&nbsp;&nbsp;' + v;
  return (signedOff ? '' : '<p style="margin:22px 0 0">Kind Regards</p>')
    + '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px 0 0;border-collapse:collapse"><tr>'
    + '<td class="hd-sig-icon" valign="top" style="width:120px;padding:0 16px 0 0">'
    + '<img class="hd-sig-img" src="' + icon + '" width="120" height="120" alt="' + brand + '" style="display:block;border:0;width:120px;height:120px;border-radius:12px"></td>'
    + '<td style="width:3px;background:#FF1F8E;font-size:0;line-height:0">&nbsp;</td>'
    + '<td class="hd-sig-text" valign="middle" style="padding:0 0 0 16px;font-size:14px;line-height:1.55">'
    + '<p style="margin:0"><strong class="hd-ink" style="color:#12101a;font-size:18px;line-height:1.3">' + helpHtml(signer || ('The ' + brand + ' team')) + '</strong><br>'
    + '<span style="color:#FF1F8E;font-weight:600">' + brand + '</span></p>'
    + '<p style="margin:10px 0 0">'
    + (phone ? L('P', '<a href="tel:' + VP_SUPPORT_TEL + '" ' + HELP_LINK + '>' + VP_SUPPORT_PHONE + '</a>') + '<br>' : '')
    + L('E', '<a href="mailto:' + replyTo + '" ' + HELP_LINK + '>' + replyTo + '</a>') + '<br>'
    + L('W', '<a href="https://' + site + '" ' + HELP_LINK + '>' + site + '</a>') + '</p>'
    + '</td></tr></table>'
    + '<p class="hd-mute" style="margin:22px 0 0;font-size:11px;line-height:1.55;color:#8a8a95"><strong>CONFIDENTIAL EMAIL:</strong> The contents of this email and any attachments are private and confidential. Any unauthorised use of all or any part of this email and any attachments is prohibited.</p>'
    + '<p class="hd-mute" style="margin:8px 0 0;font-size:11px;line-height:1.55;color:#8a8a95">' + helpCountry(pp) + '</p>';
}
/* A reply that already signs off ("Cheers,", "Thanks,", "Kind regards,") gets no second sign-off. */
function helpSignsOff(body) {
  const lines = String(body || '').trim().split('\n');
  const last = (lines[lines.length - 1] || '').trim();
  return last.length <= 30 && /,$/.test(last) && /^(cheers|thanks|thank you|regards|kind regards|best regards|best|warm regards|many thanks|talk soon)\b/i.test(last);
}
/* LINKS IN WHAT STAFF TYPED (Dean, 29 Oct 2026: "the link doesn't actually look like it links"). A
   web address or an email address in a reply (a saved reply's {tv_link} is "venueplay.com.au/tv?...")
   becomes a pink underlined link. Runs on the ESCAPED text, so nothing typed can become markup; the
   link's words are what was typed, so the text part reads the same. */
function helpLinkify(escaped) {
  return String(escaped).replace(/\b((?:https?:\/\/|www\.)[^\s<]+|(?:venueplay|partyplay)\.com\.au(?:\/[^\s<]*)?|[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)/g, (m) => {
    let tail = '';
    while (/[.,;:!?)\]'"]$/.test(m) || /&#39;$|&quot;$/.test(m)) {
      const t = /&#39;$|&quot;$/.exec(m); const n = t ? t[0].length : 1;
      tail = m.slice(-n) + tail; m = m.slice(0, -n);
    }
    if (!m) return tail;
    const href = /@/.test(m) && !/^(https?:|www\.)/i.test(m) ? 'mailto:' + m : (/^https?:/i.test(m) ? m : 'https://' + m);
    return '<a href="' + href + '" ' + HELP_LINK + '>' + m + '</a>' + tail;
  });
}
/* THE TEXT PART. Every help desk email carries text/plain beside the HTML, made from the same HTML
   so the two can never say different things. An HTML-only email is one of the things Outlook's
   filter scores towards junk (Dean's reply on 28 Oct 2026 went to junk with every check passing). */
function helpPlainFromHtml(html) {
  let s = String(html || '');
  s = s.replace(/<(head|style|script|title)\b[\s\S]*?<\/\1>/gi, '');
  s = s.replace(/<div style="display:none[^"]*"[^>]*>[\s\S]*?<\/div>/gi, '');   // a hidden preheader
  s = s.replace(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (m, href, inner) => {
    const words = inner.replace(/<[^>]+>/g, '').trim();
    const to = href.replace(/^(mailto|tel):/i, '');
    if (!words) return to;
    if (/^(mailto|tel):/i.test(href) || words === to || words.replace(/^https?:\/\//, '') === to.replace(/^https?:\/\//, '')) return words;
    return words + ' (' + href + ')';
  });
  s = s.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|h[1-6]|tr|li|table)>/gi, '\n\n').replace(/<[^>]+>/g, '');
  s = s.replace(/&nbsp;/g, ' ').replace(/&middot;/g, '-').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
       .replace(/&#39;/g, "'").replace(/&#(\d+);/g, (m, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, '&');
  return s.split('\n').map((l) => l.replace(/[ \t]+/g, ' ').trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}
function helpNow() { return new Date().toISOString(); }
function helpDayKey() { return new Date(Date.now()).toISOString().slice(0, 10); }   // same clock as helpYesterday

/* DURABLE LIMITS (migration 108). One count per key per window, kept in the database by one atomic
   function, so it holds across every Worker instance; the in-memory rateLimit only ever saw one
   instance's share, and an instance restart forgot it. If the database cannot be asked (the
   migration not run yet, or a blip), this instance's memory counts instead, which is what the
   help desk did before: a limit that degrades, never one that vanishes. */
async function helpLimit(env, key, limit, windowSecs) {
  try {
    const res = await fetch(env.SUPABASE_URL + '/rest/v1/rpc/vp_help_hit', { method: 'POST', headers: vpaHeaders(env),
      body: JSON.stringify({ p_key: String(key).slice(0, 200), p_window_secs: windowSecs, p_limit: limit }) });
    if (res && res.ok) { const v = await res.json(); if (v === true || v === false) return v; }
  } catch (e) { /* fall through */ }
  return rateLimit('mem:' + key, limit, windowSecs);
}
/* A network address as a limit key: hashed with a secret, so the table never holds an address. */
async function helpIpKey(env, ip) {
  return 'ip:' + (await helpSha256Hex((env.HELP_LIMIT_SALT || env.SUPABASE_SERVICE_KEY || 'vp-help') + '|' + ip)).slice(0, 32);
}
/* The per-network limit, never able to take a form down: if the address cannot be hashed, this
   instance's memory counts it (memory is never written anywhere, so the raw address is fine there). */
async function helpIpLimit(env, prefix, ip, limit, windowSecs) {
  if (!ip) return true;
  let key;
  try { key = await helpIpKey(env, ip); } catch (e) { return rateLimit('mem:' + prefix + ':' + ip, limit, windowSecs); }
  return helpLimit(env, prefix + ':' + key, limit, windowSecs);
}

/* CLOUDFLARE TURNSTILE on the public forms. Switched on by two Worker settings Dean adds:
   TURNSTILE_SITEKEY (plain; the pages are handed it by /help/content and /help/config, so no page
   edit is needed) and TURNSTILE_SECRET (secret). Without the secret nothing is asked of the page
   and the durable limits are the guard, exactly as before. A NO from Cloudflare refuses the form; a
   Cloudflare outage lets it through to the limits, because a punter who cannot ask for help is
   worse than one more ticket the limits would catch anyway. */
async function helpTurnstile(env, token, ip) {
  if (!env.TURNSTILE_SECRET) return { ok: true, skipped: true };
  if (!token) return { ok: false };
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: env.TURNSTILE_SECRET, response: String(token).slice(0, 2048), remoteip: ip || undefined }) });
    if (!res || !res.ok) return { ok: true, unchecked: true };
    const j = await res.json();
    return { ok: !!(j && j.success) };
  } catch (e) { return { ok: true, unchecked: true }; }
}
function helpRandomToken(bytes) { const a = new Uint8Array(bytes || 9); crypto.getRandomValues(a); return helpB64url(a); }

async function helpInsertTicket(env, t) {
  const row = {
    brand: t.brand === 'partyplay' ? 'partyplay' : 'venueplay',
    category: HELP_CATEGORIES.indexOf(t.category) >= 0 ? t.category : 'general',
    channel: t.channel,
    status: HELP_STATUSES.indexOf(t.status) >= 0 ? t.status : 'new',
    priority: t.priority === 'urgent' ? 'urgent' : 'normal',
    message: String(t.message || '').slice(0, 20000),
    contact_name: t.contact_name ? helpLine(t.contact_name, 120) : null,
    contact_email: t.contact_email ? helpLine(t.contact_email, 200).toLowerCase() : null,
    contact_phone: t.contact_phone ? helpLine(t.contact_phone, 40) : null,
    venue_id: t.venue_id || null,
    room_code: t.room_code || null,
    session_id: t.session_id || null,
    raised_by: t.raised_by || null,
    source_address: t.source_address || null,
    email_message_id: t.email_message_id || null,
  };
  // The ticket's subject COLUMN, not an email subject: written by assignment so the email-subject
  // scan in billing-emails.test.js sees only real email subjects.
  row['subject'] = helpLine(t.title, 200) || '(no subject)';
  row.reply_token = helpRandomToken(9);
  row.contact_typed = !!t.contact_typed;
  if (t.contact_email_pending) row.contact_email_pending = helpLine(t.contact_email_pending, 200).toLowerCase();
  if (row.status === 'closed') row.closed_at = helpNow();
  /* MIGRATION 129 (29 Oct 2026): a sales enquiry's venue, suburb or postcode and website as their own
     columns, and how a public ticket's venue was matched. Until the migration has run the database
     refuses a row that names them, so the row goes again without them: the same words are in the
     message, and an enquiry is never lost to a column that does not exist yet. */
  const extra = {};
  if (t.lead_venue_name) extra.lead_venue_name = helpLine(t.lead_venue_name, 120);
  if (t.lead_locality) extra.lead_locality = helpLine(t.lead_locality, 80);
  if (t.lead_website) extra.lead_website = helpLine(t.lead_website, 200);
  if (row.venue_id && ['room', 'code', 'name'].indexOf(t.venue_matched_by) >= 0) extra.venue_matched_by = t.venue_matched_by;
  if (!Object.keys(extra).length) return await vpaInsert(env, 'vp_help_tickets', row);
  try {
    return await vpaInsert(env, 'vp_help_tickets', Object.assign({}, row, extra));
  } catch (e) {
    if (!/lead_venue_name|lead_locality|lead_website|venue_matched_by/.test(String(e && e.message || e))) throw e;
    return await vpaInsert(env, 'vp_help_tickets', row);
  }
}

async function helpVenueName(env, venueId) {
  if (!venueId) return '';
  const r = await vpaSelect(env, 'vp_venues', 'id=eq.' + encodeURIComponent(venueId) + '&select=name&limit=1');
  return (r && r[0] && r[0].name) || '';
}

/* One place that posts a help desk email to Resend. Not vpaSendEmail, because that one fixes the
   From to VenuePlay hello@, and a reply on a PartyPlay accounts ticket must come from PartyPlay
   accounts. Returns true when Resend took it (accepted, not delivered: see vpaSendEmail). */
async function helpSendEmail(env, m) {
  if (!env.RESEND_API_KEY || !m.to) return false;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: m.from, reply_to: m.reply_to, to: [m.to], subject: m.subject, html: m.html,
                           text: m.text || helpPlainFromHtml(m.html), headers: m.headers || undefined }),
  });
  return !!(res && res.ok);
}

/* THE STAFF ALERT, on every ticket that did not start in HQ. Subject: [VenuePlay] or [PartyPlay],
   URGENT when it is, the kind, the number. To VP_HELP_ALERT_EMAIL, else VP_INTERNAL_EMAIL, else
   hello@venueplay.com.au, where every other staff alert in this Worker goes. The X-VP-Help header
   and the send. domain stop this alert, copied from hello@ to the help subdomain, coming straight
   back in as a ticket of its own. */
function helpAlertSubject(ticket, lead) {
  return '[' + (HELP_BRAND_LABEL[ticket.brand] || 'VenuePlay') + '] ' + (ticket.priority === 'urgent' ? 'URGENT ' : '') +
         helpCategoryLabel(ticket.category, ticket.brand) + ' ' + helpTag(ticket.ticket_no) + ': ' + helpLine(lead || ticket.subject, 90);
}
/* A DAILY CAP ON ALERT EMAILS. The alerts go out on the same Resend account as every invoice and
   receipt, so a flood of tickets must never become a flood of email. Past the cap the tickets are
   still made, counted on the HQ badge and pushed to phones; one email says the alerts have paused. */
async function helpAlertAllowed(env) {
  const cap = Math.max(1, parseInt(env.HELP_ALERT_DAILY_CAP || '150', 10) || 150);
  if (await helpLimit(env, 'alert:' + helpDayKey(), cap, 86400)) return true;
  if (await helpLimit(env, 'alert-paused:' + helpDayKey(), 1, 86400)) {
    try {
      await helpSendEmail(env, { to: env.VP_HELP_ALERT_EMAIL || env.VP_INTERNAL_EMAIL || 'hello@venueplay.com.au',
        from: 'Help Desk <hello@send.venueplay.com.au>', reply_to: 'hello@venueplay.com.au',
        subject: '[Help desk] Alerts paused for today: ' + cap + ' reached',
        html: '<p>The help desk has sent ' + cap + ' alert emails today, its daily limit, so it has stopped emailing until tomorrow. ' +
              'Tickets are still being made: open HQ to see them. If this is a flood, the rate limits are holding it.</p>',
        headers: { 'X-VP-Help': 'alert' } });
    } catch (e) {}
  }
  return false;
}
async function helpNotifyStaff(env, ticket, venueName, lead) {
  try {
    if (!(await helpAlertAllowed(env))) return false;
    const to = env.VP_HELP_ALERT_EMAIL || env.VP_INTERNAL_EMAIL || 'hello@venueplay.com.au';
    const row = (k, v) => v ? '<p style="margin:4px 0"><b>' + k + ':</b> ' + helpHtml(v) + '</p>' : '';
    const html = '<div style="font-family:Arial,sans-serif;font-size:14px;color:#111">' +
      '<h2 style="margin:0 0 10px">' + helpHtml(helpAlertSubject(ticket, lead)) + '</h2>' +
      row('Brand', HELP_BRAND_LABEL[ticket.brand]) + row('Kind', helpCategoryLabel(ticket.category, ticket.brand)) +
      row('Came in by', ticket.channel) + row('Venue', venueName) +
      row(ticket.brand === 'partyplay' ? 'Party code' : 'Room code', ticket.room_code) +
      row('Name', ticket.contact_name) + row('Email', ticket.contact_email) + row('Phone', ticket.contact_phone) +
      row('Subject', ticket.subject) +
      '<p style="margin:12px 0 4px"><b>Message:</b></p><div style="white-space:pre-wrap;border-left:3px solid #FF1F8E;padding-left:10px">' +
      helpHtml(lead && lead !== ticket.subject ? lead : ticket.message) + '</div>' +
      '<p style="margin-top:16px"><a href="https://www.venueplay.com.au/app/hq.html#help-' + ticket.ticket_no + '">Open it in HQ</a>. ' +
      'Reply from HQ so the answer is kept on the ticket.</p></div>';
    return await helpSendEmail(env, { to: to, from: 'Help Desk <hello@send.venueplay.com.au>',
      reply_to: ticket.contact_email || 'hello@venueplay.com.au',
      subject: helpAlertSubject(ticket, lead),
      html: html, headers: { 'X-VP-Help': 'alert' } });
  } catch (e) { return false; }
}

/* Everything a new ticket sets off. Email to staff and a push to every staff device that asked,
   each on its own so one failing never stops the other. */
async function helpAnnounce(env, ticket, venueName) {
  const mailed = await helpNotifyStaff(env, ticket, venueName);
  let pushed = { sent: 0 };
  try { pushed = await helpPushNew(env, ticket); } catch (e) { pushed = { sent: 0, error: String(e && e.message || e).slice(0, 200) }; }
  return { mailed: mailed, pushed: pushed };
}

/* WHICH VENUE A PHONE WAS IN. The room code on the phone is the venue's join code, or a live
   session's code; a phone that arrived off a table talker also has the venue's slug. Any of them
   failing is fine: the ticket is still made, with the code the patron saw. */
async function helpVenueFromRoom(env, code, slug) {
  const out = { venue_id: null, session_id: null, room_code: null };
  const c = String(code || '').trim().toUpperCase();
  if (/^[A-Z0-9]{6}$/.test(c)) {
    out.room_code = c;
    const v = await vpaSelect(env, 'vp_venues', 'join_code=eq.' + encodeURIComponent(c) + '&select=id&limit=2');
    if (v && v.length === 1) out.venue_id = v[0].id;
    else {
      const s = await vpaSelect(env, 'vp_sessions', 'join_code=eq.' + encodeURIComponent(c) +
        '&status=in.(lobby,running,paused)&select=id,venue_id&limit=1');
      if (s && s[0]) { out.venue_id = s[0].venue_id; out.session_id = s[0].id; }
    }
  }
  const sl = String(slug || '').trim().toLowerCase();
  if (!out.venue_id && /^[a-z0-9-]{1,80}$/.test(sl)) {
    const v = await vpaSelect(env, 'vp_venues', 'slug=eq.' + encodeURIComponent(sl) + '&select=id&limit=1');
    if (v && v[0]) out.venue_id = v[0].id;
  }
  if (out.venue_id && !out.session_id) {
    const s = await vpaSelect(env, 'vp_sessions', 'venue_id=eq.' + encodeURIComponent(out.venue_id) +
      '&status=in.(lobby,running,paused)&select=id&limit=1');
    if (s && s[0]) out.session_id = s[0].id;
  }
  return out;
}

/* WHICH VENUE DID THEY TYPE? (Dean's phone test, 29 Oct 2026.) The public forms' venue was free text
   that nothing ever looked at. This is a SOFT match, and only a confident one counts:
     - a six-character code is a venue's join code (one venue), else a live session's code (one session);
     - anything else is a venue NAME, matched whole and case-insensitively (no partial matches: "Royal"
       finds nothing), and when several venues share the name, the suburb or postcode picks one or none.
       "The Royal Hotel, Tugun" in one box is read as a name and a suburb.
   One venue: { venue_id, name, by }. None, or more than one: null, and the ticket is made unmatched.
   It never blocks a ticket and never says anything about a venue but its name. */
const HELP_MATCH_MAX_ROWS = 6;
function helpMatchKey(s) { return String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim(); }
async function helpMatchVenue(env, typed, place) {
  let t = helpLine(typed, 120), p = helpLine(place, 80);
  if (!t) return null;
  const code = t.toUpperCase().replace(/\s+/g, '');
  if (/^[A-Z0-9]{6}$/.test(code)) {
    const v = await vpaSelect(env, 'vp_venues', 'join_code=eq.' + encodeURIComponent(code) + '&select=id,name&limit=2');
    if (v && v.length === 1) return { venue_id: v[0].id, name: v[0].name || '', by: 'code' };
    if (!v || !v.length) {
      const s = await vpaSelect(env, 'vp_sessions', 'join_code=eq.' + encodeURIComponent(code) +
        '&status=in.(lobby,running,paused)&select=venue_id&limit=2');
      if (s && s.length === 1 && s[0].venue_id) return { venue_id: s[0].venue_id, name: await helpVenueName(env, s[0].venue_id), by: 'code' };
    }
  }
  const tries = [[t, p]];
  const comma = t.lastIndexOf(',');
  if (comma > 0) tries.push([t.slice(0, comma).trim(), p || t.slice(comma + 1).trim()]);
  for (const [name, where] of tries) {
    const want = helpMatchKey(name);
    if (want.length < 3) continue;
    /* ilike with every wildcard character turned into a one-character wildcard, then compared whole
       below, so the database can only ever hand back candidates and never decides the match. */
    const pat = name.replace(/[*%_\\,()"]/g, '_');
    const rows = await vpaSelect(env, 'vp_venues', 'name=ilike.' + encodeURIComponent(pat) +
      '&select=id,name,postcode,slug&order=id.asc&limit=' + HELP_MATCH_MAX_ROWS);
    const same = (rows || []).filter((r) => helpMatchKey(r.name) === want);
    if (!same.length) continue;
    const pc = /^\d{4}$/.test(where) ? where : '';
    const sub = pc ? '' : helpMatchKey(where);
    const placeOk = (r) => pc ? String(r.postcode || '') === pc
      : (helpMatchKey(r.name).indexOf(sub) >= 0 || String(r.slug || '').replace(/-/g, ' ').indexOf(sub) >= 0);
    let pick = null;
    if (same.length === 1) {
      // One venue by that name. A postcode that says otherwise makes it a different venue.
      if (!(pc && same[0].postcode && String(same[0].postcode) !== pc)) pick = same[0];
    } else if (where && (pc || sub.length >= 3)) {
      const narrowed = same.filter(placeOk);
      if (narrowed.length === 1) pick = narrowed[0];
    }
    if (pick) return { venue_id: pick.id, name: pick.name || '', by: 'name' };
    return null;    // the name matched, but not one venue: never guess
  }
  return null;
}

/* POST /help/venue-match {brand, venue, place}. The form asks while the person is typing, so it can say
   "Got it: The Royal Hotel" before they press Send. Public, so it says as little as it can: the matched
   venue's NAME or nothing, never an id, a code, a postcode, or how many venues nearly matched. Limited
   per network and per device, and the ticket route does the match again for itself: nothing the page
   sends back can attach a ticket to a venue. */
const HELP_MATCH_PER_IP = 40;     // in ten minutes. A pub's wifi is one address for the whole room.
async function helpVenueMatchRoute(request, env, json) {
  const ip = request.headers.get('cf-connecting-ip') || '';
  if (!(await helpIpLimit(env, 'vm', ip, HELP_MATCH_PER_IP, 600))) return json({ match: null, slow: true }, 429);
  const _b = await vpaBody(request, json);
  if (!_b.ok) return _b.res;
  const b = _b.body;
  if (b.brand === 'partyplay') return json({ match: null });
  const device = helpLine(b.device, 64);
  if (device && !(await helpLimit(env, 'vm:dev:' + device, 30, 600))) return json({ match: null, slow: true }, 429);
  const m = await helpMatchVenue(env, b.venue, b.place);
  return json({ match: m ? (m.name || 'your venue') : null });
}

/* ------------------------------ POST /help/ticket (public) ------------------------------
   brand venueplay: kind patron (a phone), venue (the public /help page: someone at a venue who is
   not signed in, so the venue is what they TYPED, never a venue id; category venue_support or
   accounts) or sales.
   brand partyplay: kind patron (a guest), host (by party code) or sales.
   A VenuePlay HOST is refused here: they are signed in, and go through /help/venue/ticket so the
   venue is the one their login holds, not one they typed. */
async function helpPublicTicket(request, env, json) {
  const ip = request.headers.get('cf-connecting-ip') || '';   // Cloudflare-set; kept only as a salted hash
  if (!(await helpIpLimit(env, 'tk', ip, HELP_MAX_PER_IP, 3600))) {
    return json({ error: 'Too many messages from this network. Please try again later.' }, 429);
  }
  const _b = await vpaBody(request, json);
  if (!_b.ok) return _b.res;
  const b = _b.body;
  // The honeypot: a field no person sees. Told it worked, and nothing is made.
  if (String(b.website || '').trim()) return json({ ok: true, ticket_no: null });
  const brand = b.brand === 'partyplay' ? 'partyplay' : 'venueplay';
  const kind = ['patron', 'host', 'sales', 'venue'].indexOf(b.kind) >= 0 ? b.kind : 'patron';
  if (brand === 'venueplay' && kind === 'host') return json({ error: 'Sign in to the console and use Help there.' }, 400);
  if (brand === 'partyplay' && kind === 'venue') return json({ error: 'Which help is this?' }, 400);
  // The venue as typed on the help page. Kept as typed for a person to read; since 29 Oct 2026 it is
  // also SOFT-matched to a venue (helpMatchVenue), which only ever attaches one confident match.
  const typedVenue = brand === 'venueplay' ? helpLine(b.venue, 120) : '';
  /* A VenuePlay sales enquiry names its venue (Dean, 29 Oct 2026): the venue name and its suburb or
     postcode are required, its website optional, and they are kept as fields (migration 129) so a
     later job can set the venue up as a prospect. */
  let lead = null;
  if (brand === 'venueplay' && kind === 'sales') {
    lead = { name: helpLine(b.venue_name, 200), place: helpLine(b.locality, 200), site: helpLine(b.venue_site, 300) };
    // The enquiry form sends both fields and both are required. The /help venue form's "Bringing
    // VenuePlay to my venue" has one "Your venue" box ("The Royal Hotel, Tugun"): read it as the two.
    const asked = b.venue_name !== undefined || b.locality !== undefined;
    if (!lead.name && typedVenue) {
      const c = typedVenue.lastIndexOf(',');
      lead.name = c > 0 ? typedVenue.slice(0, c).trim() : typedVenue;
      if (!lead.place && c > 0) lead.place = typedVenue.slice(c + 1).trim();
    }
    if (asked && (!lead.name || !lead.place)) return json({ error: 'Tell us the venue and its suburb or postcode.' }, 400);
    if (lead.name.length > 120 || lead.place.length > 80 || lead.site.length > 200) return json({ error: 'The venue details are too long.' }, 400);
    if (lead.site && !/^(https?:\/\/)?[a-z0-9-]+(\.[a-z0-9-]+)+([\/?#][^\s<>"]*)?$/i.test(lead.site)) return json({ error: 'That website does not look right. Leave it blank if you are not sure.' }, 400);
  }
  const support = 'support@' + brand + '.com.au';
  const name = helpLine(b.name, 200);
  const email = helpLine(b.email, 300).toLowerCase();
  const phone = helpLine(b.phone, 60);
  const message = helpText(b.message);
  if (!message) return json({ error: 'Type your message first.' }, 400);
  if (!email) return json({ error: 'Put in your email so we can reply.' }, 400);
  if (name.length > 120 || email.length > 200 || phone.length > 40 || message.length > HELP_MESSAGE_MAX || !HELP_EMAIL_RE.test(email)) {
    return json({ error: 'That message is too long or the email address does not look right.' }, 400);
  }
  const ts = await helpTurnstile(env, b.turnstile, ip);
  if (!ts.ok) return json({ error: 'Please complete the check above Send, then try again.', turnstile: true }, 403);
  const device = helpLine(b.device, 64);
  if (device && !(await helpLimit(env, 'tk:dev:' + device, HELP_MAX_PER_DEVICE, 600))) {
    return json({ error: 'You have sent a few already. Give us a little while to reply.' }, 429);
  }
  if (!(await helpLimit(env, 'tk:em:' + email, HELP_MAX_PER_EMAIL, 3600))) {
    return json({ error: 'You have sent a few already. Give us a little while to reply.' }, 429);
  }
  let where = { venue_id: null, session_id: null, room_code: null };
  let matchedBy = null;
  if (brand === 'venueplay' && kind === 'patron') { where = await helpVenueFromRoom(env, b.code, b.slug); if (where.venue_id) matchedBy = 'room'; }
  else {
    const c = String(b.code || '').trim().toUpperCase();
    if (/^[A-Z0-9]{4,8}$/.test(c)) where.room_code = c;    // a PartyPlay party code, as typed
  }
  // Nothing from the room: try what they typed. A confident single venue, or none.
  if (brand === 'venueplay' && !where.venue_id && (typedVenue || (lead && lead.name))) {
    const m = await helpMatchVenue(env, lead && lead.name ? lead.name : typedVenue, lead && lead.name ? lead.place : b.place);
    if (m) { where.venue_id = m.venue_id; matchedBy = m.by; }
  }
  const game = helpLine(b.game, 24).toLowerCase().replace(/[^a-z ]/g, '');
  // From the guided triage: the issue, as the database has it, names the ticket and picks its kind.
  const issue = kind === 'sales' ? null : await helpIssueFor(env, b.issue_id, brand);
  const category = issue ? issue.category : kind === 'sales' ? 'sales' : kind === 'host' ? 'venue_support'
                 : kind === 'venue' ? helpPublicVenueCategory(b.category) : 'patron_support';
  const who = kind === 'sales' ? 'Enquiry' : kind === 'host' ? 'Host help' : kind === 'venue' ? 'Venue help' : (brand === 'partyplay' ? 'Guest help' : 'Player help');
  const at = typedVenue ? ' at ' + typedVenue : lead && lead.name ? ' from ' + lead.name + (lead.place ? ', ' + lead.place : '') : '';
  let t;
  try {
    t = await helpInsertTicket(env, {
      brand: brand, category: category, channel: kind === 'sales' || kind === 'venue' ? 'web_form' : 'patron_form',
      title: issue ? issue.title + at + (game ? ' (' + game + ')' : '') : who + at + (game ? ' (' + game + ')' : '') + ': ' + helpLine(message, 80),
      message: (typedVenue ? 'Venue (as typed): ' + typedVenue + '\n\n' : '') +
               (lead && lead.name && !typedVenue ? 'Venue: ' + lead.name + '\nSuburb or postcode: ' + lead.place + (lead.site ? '\nWebsite: ' + lead.site : '') + '\n\n' : '') +
               message, contact_name: name || null, contact_email: email, contact_phone: phone || null,
      venue_id: where.venue_id, room_code: where.room_code, session_id: where.session_id, venue_matched_by: matchedBy,
      lead_venue_name: lead ? lead.name || null : null, lead_locality: lead ? lead.place || null : null, lead_website: lead ? lead.site || null : null,
    });
  } catch (e) {
    return json({ error: 'We could not send that just now. Please email ' + support + '.' }, 503);
  }
  await helpNoteTicketFromIssue(env, issue);
  await helpAnnounce(env, t, await helpVenueName(env, t.venue_id));
  await helpAcknowledge(env, t);
  return json({ ok: true, ticket_no: t.ticket_no });
}

/* The public venue form picks help or billing. Anything else, or nothing, is venue support: a bill
   question filed as support still reaches a person, a support question filed as accounts may not. */
function helpPublicVenueCategory(c) { return c === 'accounts' ? 'accounts' : 'venue_support'; }

/* A signed-in VenuePlay login at THIS venue (any staff role), or an HQ admin viewing as it. */
async function helpRequireVenueStaff(request, env, venueId) {
  const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return { error: 'Not signed in.', status: 401 };
  const payload = await vpaVerifyJWT(token, env.SUPABASE_JWT_SECRET, env);
  if (!payload || !payload.sub) return { error: 'Invalid or expired session. Please sign in again.', status: 401 };
  if (!HELP_UUID.test(String(venueId || ''))) return { error: 'Which venue is this about?', status: 400 };
  const staff = await vpaSelect(env, 'vp_venue_staff', 'auth_user_id=eq.' + encodeURIComponent(payload.sub) +
    '&venue_id=eq.' + encodeURIComponent(venueId) + '&role=in.(' + HELP_STAFF_ROLES.join(',') + ')&select=venue_id,role,display_name&limit=1');
  let admin = null;
  if (!staff || !staff.length) {
    const a = await vpaSelect(env, 'vp_platform_admins', 'auth_user_id=eq.' + encodeURIComponent(payload.sub) +
      '&role=in.(owner,accounts)&select=auth_user_id,label,role&limit=1');
    if (!a || !a.length) return { error: 'This login is not staff at that venue.', status: 403 };
    admin = a[0];
  }
  const v = await vpaSelect(env, 'vp_venues', 'id=eq.' + encodeURIComponent(venueId) + '&select=id,name,founding_id&limit=1');
  if (!v || !v.length) return { error: 'No such venue.', status: 404 };
  return { authUserId: payload.sub, staff: (staff && staff[0]) || null, admin: admin, venue: v[0] };
}

/* ------------------------------ POST /help/venue/ticket ------------------------------
   Submit only. It answers with the ticket number and nothing else: not the account's email it
   will reply to, and there is no route that lists a venue's tickets back. */
async function helpVenueTicket(request, env, json) {
  const _b = await vpaBody(request, json);
  if (!_b.ok) return _b.res;
  const b = _b.body;
  const who = await helpRequireVenueStaff(request, env, b.venue_id);
  if (who.error) return json({ error: who.error }, who.status);
  if (!(await helpLimit(env, 'tk:staff:' + who.authUserId, HELP_MAX_PER_STAFF, 3600))) {
    return json({ error: 'That is a lot of requests in an hour. Email support@venueplay.com.au if it is urgent.' }, 429);
  }
  const subject = helpLine(b.subject, 300);
  const message = helpText(b.message);
  const replyEmail = helpLine(b.reply_email, 300).toLowerCase();
  if (!subject) return json({ error: 'Give it a short subject.' }, 400);
  if (!message) return json({ error: 'Tell us what is happening.' }, 400);
  if (subject.length > 200 || message.length > HELP_MESSAGE_MAX) return json({ error: 'That is too long. Keep it under 4,000 characters.' }, 400);
  if (replyEmail && !HELP_EMAIL_RE.test(replyEmail)) return json({ error: 'That email address does not look right.' }, 400);
  /* WHERE THE ANSWER GOES (Dean, 21 Oct 2026). HQ answers by email and only by email (helpAdminReply
     has no text-message path), and hosts sign in by phone, so a host's login usually has no email at
     all. The address they typed wins; then the login's own email; then, for the venue's OWNER only,
     the account's contact email, which is theirs. Anyone else with none of those is asked for one:
     before this, a host's request was answered to the owner's inbox. */
  let contactEmail = replyEmail, contactPhone = null, loginEmail = '';
  const u = await vpaAuthGetUser(env, who.authUserId);
  if (u && u.email && HELP_EMAIL_RE.test(String(u.email))) loginEmail = String(u.email).toLowerCase();
  if (!who.admin) contactPhone = (u && u.phone) ? ('+' + String(u.phone).replace(/^\+/, '')) : null;
  if (!contactEmail) contactEmail = loginEmail || null;
  if (!contactEmail && who.venue.founding_id && who.staff && who.staff.role === 'owner') {
    const acc = await vpaSelect(env, 'venueplay_founding', 'id=eq.' + encodeURIComponent(who.venue.founding_id) + '&select=contact_email&limit=1');
    contactEmail = (acc && acc[0] && acc[0].contact_email) || null;
  }
  if (!contactEmail) return json({ error: 'Put in an email so we can reply. We answer help requests by email.', need_email: true }, 400);
  /* URGENT IS WORKED OUT, NOT TICKED (Dean, 21 Oct 2026: "if they are contacting us during a game,
     that is why they are contacting us"). A lobby or a game open at this venue right now makes the
     ticket urgent; anything else is normal. The page has no say: b.urgent is ignored. */
  const liveNow = await vpaSelect(env, 'vp_sessions', 'venue_id=eq.' + encodeURIComponent(who.venue.id) +
    '&status=in.(lobby,running,paused)&select=id,status&limit=1');
  const gameOn = !!(liveNow && liveNow.length);
  const issue = await helpIssueFor(env, b.issue_id, 'venueplay');
  let t;
  try {
    t = await helpInsertTicket(env, {
      brand: 'venueplay', category: issue ? issue.category : b.category === 'accounts' ? 'accounts' : 'venue_support', channel: 'venue_form',
      priority: gameOn ? 'urgent' : 'normal', title: subject, message: message,
      contact_name: helpLine(b.name, 120) || (who.staff && who.staff.display_name) || (who.admin ? 'HQ: ' + (who.admin.label || 'admin') : null),
      contact_email: contactEmail, contact_phone: contactPhone, venue_id: who.venue.id, raised_by: who.authUserId,
    });
  } catch (e) {
    return json({ error: 'We could not send that just now. Please email support@venueplay.com.au.' }, 503);
  }
  await helpNoteTicketFromIssue(env, issue);
  if (gameOn) {
    try { await vpaInsert(env, 'vp_help_ticket_notes', { ticket_id: t.id, kind: 'change', author: 'Help desk',
      body: 'Urgent because a ' + (liveNow[0].status === 'lobby' ? 'lobby' : 'game') + ' was open at ' + who.venue.name + ' when this was sent.' }, false); } catch (e) {}
  }
  await helpAnnounce(env, t, who.venue.name);
  await helpAcknowledge(env, t);
  return json({ ok: true, ticket_no: t.ticket_no });
}

/* ------------------------------ HQ ------------------------------ */
function helpDay(s, end) {
  // A date in Brisbane (no daylight saving), so "19 Oct" means the day Dean lived through.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s || ''))) return null;
  return s + (end ? 'T23:59:59.999+10:00' : 'T00:00:00+10:00');
}
/* EVERY route that returns ticket data starts here. */
async function helpAdmin(request, env, json) {
  const a = await vpaRequireAdmin(request, env, HELP_ADMIN_ROLES);
  if (a.error) return { res: json({ error: a.error }, a.status) };
  const _b = await vpaBody(request, json);
  if (!_b.ok) return { res: _b.res };
  return { admin: a, body: _b.body };
}
async function helpVenueNames(env, ids) {
  const out = {};
  const uniq = ids.filter((x, i) => x && ids.indexOf(x) === i && HELP_UUID.test(x));
  for (let i = 0; i < uniq.length; i += 100) {
    const part = uniq.slice(i, i + 100);
    const rows = await vpaSelect(env, 'vp_venues', 'id=in.(' + part.map(encodeURIComponent).join(',') + ')&select=id,name');
    (rows || []).forEach((r) => { out[r.id] = r.name; });
  }
  return out;
}
async function helpFindTicket(env, id) {
  if (!HELP_UUID.test(String(id || ''))) return null;
  const r = await vpaSelect(env, 'vp_help_tickets', 'id=eq.' + encodeURIComponent(id) + '&select=*&limit=1');
  return (r && r[0]) || null;
}
function helpFilters(b) {
  const q = [];
  if (b.status === 'not_closed') q.push('status=neq.closed');
  else if (HELP_STATUSES.indexOf(b.status) >= 0) q.push('status=eq.' + b.status);
  if (HELP_BRANDS.indexOf(b.brand) >= 0) q.push('brand=eq.' + b.brand);
  if (HELP_CATEGORIES.indexOf(b.category) >= 0) q.push('category=eq.' + b.category);
  if (HELP_CHANNELS.indexOf(b.channel) >= 0) q.push('channel=eq.' + b.channel);
  if (HELP_UUID.test(String(b.venue_id || ''))) q.push('venue_id=eq.' + b.venue_id);
  const from = helpDay(b.from), to = helpDay(b.to, true);
  if (from) q.push('created_at=gte.' + encodeURIComponent(from));
  if (to) q.push('created_at=lte.' + encodeURIComponent(to));
  return q;
}

async function helpAdminList(request, env, json) {
  const g = await helpAdmin(request, env, json); if (g.res) return g.res;
  const q = ['select=*'].concat(helpFilters(g.body));
  // created_at=gte and created_at=lte cannot share a key in a query string PostgREST reads as one
  // filter each, so a range goes in as and=(...). Rebuilt here from the two halves.
  const range = q.filter((x) => /^created_at=/.test(x));
  const rest = q.filter((x) => !/^created_at=/.test(x));
  if (range.length === 2) rest.push('and=(' + range.map((x) => x.replace('=', '.')).join(',') + ')');
  else rest.push.apply(rest, range);
  const rows = await vpaSelectAll(env, 'vp_help_tickets', rest.join('&') + '&order=created_at.desc,id.desc');
  const venues = await helpVenueNames(env, rows.map((r) => r.venue_id));
  const admins = await vpaSelect(env, 'vp_platform_admins', 'select=label&order=label.asc');
  // The venue picker for "Log a call". HQ only, like everything else here; paged and ordered.
  // slug too (29 Oct 2026): a saved reply's {tv_link} is the venue's own TV address.
  const all = g.body.with_venues ? await vpaSelectAll(env, 'vp_venues', 'select=id,name,slug&order=name.asc,id.asc') : undefined;
  return json({ tickets: rows, venues: venues, assignees: (admins || []).map((x) => x.label).filter(Boolean), all_venues: all });
}

/* The HQ badge: how many are new (nobody has opened them), and how many of those are urgent. */
async function helpAdminCount(request, env, json) {
  const g = await helpAdmin(request, env, json); if (g.res) return g.res;
  const rows = await vpaSelectAll(env, 'vp_help_tickets', 'status=eq.new&select=id,priority,brand&order=id.asc');
  return json({ new: rows.length, urgent: rows.filter((r) => r.priority === 'urgent').length });
}

async function helpAdminGet(request, env, json) {
  const g = await helpAdmin(request, env, json); if (g.res) return g.res;
  let t = await helpFindTicket(env, g.body.id);
  if (!t && /^\d{1,9}$/.test(String(g.body.ticket_no || ''))) {
    const r = await vpaSelect(env, 'vp_help_tickets', 'ticket_no=eq.' + g.body.ticket_no + '&select=*&limit=1');
    t = (r && r[0]) || null;
  }
  if (!t) return json({ error: 'That ticket is not there any more.' }, 404);
  // Opening a new ticket is reading it: it stops counting on the badge.
  if (t.status === 'new') {
    const patch = { status: 'open', updated_at: helpNow() };
    await vpaPatch(env, 'vp_help_tickets', 'id=eq.' + encodeURIComponent(t.id), patch);
    await vpaInsert(env, 'vp_help_ticket_notes', { ticket_id: t.id, kind: 'change', body: 'Opened by ' + g.admin.label,
      author: g.admin.label, author_id: g.admin.actorId }, false);
    t = Object.assign({}, t, patch);
  }
  const notes = await vpaSelectAll(env, 'vp_help_ticket_notes', 'ticket_id=eq.' + encodeURIComponent(t.id) + '&select=*&order=created_at.asc,id.asc');
  // The venue's slug as well as its name (29 Oct 2026): a saved reply's {tv_link} is that venue's TV address.
  const v = t.venue_id && HELP_UUID.test(String(t.venue_id)) ? await vpaSelect(env, 'vp_venues', 'id=eq.' + encodeURIComponent(t.venue_id) + '&select=name,slug&limit=1') : [];
  return json({ ticket: t, notes: notes, venue_name: (v && v[0] && v[0].name) || '', venue_slug: (v && v[0] && v[0].slug) || '' });
}

async function helpAdminUpdate(request, env, json) {
  const g = await helpAdmin(request, env, json); if (g.res) return g.res;
  const b = g.body;
  const t = await helpFindTicket(env, b.id);
  if (!t) return json({ error: 'That ticket is not there any more.' }, 404);
  const patch = {}, said = [];
  function field(k, list, label) {
    if (b[k] === undefined || b[k] === t[k]) return true;
    if (list.indexOf(b[k]) < 0) return false;
    said.push(label + ': ' + t[k] + ' to ' + b[k]); patch[k] = b[k]; return true;
  }
  if (!field('status', HELP_STATUSES, 'Status') || !field('category', HELP_CATEGORIES, 'Kind') ||
      !field('priority', HELP_PRIORITIES, 'Priority') || !field('brand', HELP_BRANDS, 'Brand')) {
    return json({ error: 'That is not one of the choices.' }, 400);
  }
  if (b.assigned_to !== undefined) {
    const who = helpLine(b.assigned_to, 120) || null;
    if (who !== (t.assigned_to || null)) { patch.assigned_to = who; said.push('Assigned to ' + (who || 'nobody')); }
  }
  if (!said.length) return json({ ok: true, ticket: t, unchanged: true });
  if (patch.status === 'closed') patch.closed_at = helpNow();
  else if (patch.status) patch.closed_at = null;
  patch.updated_at = helpNow();
  await vpaPatch(env, 'vp_help_tickets', 'id=eq.' + encodeURIComponent(t.id), patch);
  await vpaInsert(env, 'vp_help_ticket_notes', { ticket_id: t.id, kind: 'change', body: said.join('. '),
    author: g.admin.label, author_id: g.admin.actorId }, false);
  return json({ ok: true, ticket: Object.assign({}, t, patch) });
}

async function helpAdminNote(request, env, json) {
  const g = await helpAdmin(request, env, json); if (g.res) return g.res;
  const t = await helpFindTicket(env, g.body.id);
  if (!t) return json({ error: 'That ticket is not there any more.' }, 404);
  const body = helpText(g.body.body);
  if (!body) return json({ error: 'Type the note first.' }, 400);
  if (body.length > 8000) return json({ error: 'That note is too long.' }, 400);
  await vpaInsert(env, 'vp_help_ticket_notes', { ticket_id: t.id, kind: 'note', body: body, author: g.admin.label, author_id: g.admin.actorId }, false);
  const patch = { updated_at: helpNow() };
  if (t.status === 'new') patch.status = 'open';
  await vpaPatch(env, 'vp_help_tickets', 'id=eq.' + encodeURIComponent(t.id), patch);
  return json({ ok: true });
}

/* THE HELP DESK'S EMAIL CARD (Dean, 29 Oct 2026: "Help emails still come out and say that it's
   provided by Gflam. Can we make them a little prettier and branded?"). This replaces the 28 Oct
   "plain, no logo" look; the words stay short, warm and signed by a person. Each brand is its own
   business: VenuePlay mail says VenuePlay and PartyPlay mail says PartyPlay, never Gflam. The ABN in
   the footer is the sender identification the Spam Act asks for, beside a way to reach us (the
   signature) and, on a reply, the ticket line.
   The same frame as venueplay/emails/welcome-prospect.html: the logo on the dark band, a pink rule
   under it, the white card. PartyPlay in its own: the warm page and colours of the PartyPlay
   Worker's emailShell, its logo on a white band over the same pink rule. Email-safe: tables and inline styles; the one <style> block only darkens the
   card for a mail app that honours prefers-color-scheme, and each logo sits on the band it was drawn
   for, so a forced dark mode cannot lose it. The text part is still made from this HTML (helpPlainFromHtml
   drops the style and title), so it says the same words. */
function helpBrandFooter(pp) {
  return (pp ? 'PartyPlay' : 'VenuePlay') + ' &middot; ABN ' + VP_ABN;
}
function helpEmailCard(pp, inner, foot, title, preheader) {
  const brand = pp ? 'PartyPlay' : 'VenuePlay';
  const site = pp ? 'https://partyplay.com.au' : 'https://venueplay.com.au';
  const logo = pp ? site + '/logos/partyplay-email-logo.png' : site + '/logos/venueplay_primary_rebuilt.png';
  /* PartyPlay's email logo is drawn on white, so its band is white; on the dark band it would sit
     in a white box. VenuePlay's logo is drawn for the dark band. */
  const band = pp ? '#ffffff' : '#12101a';
  const page = pp ? '#F3F0EC' : '#f4f4f7', text = pp ? '#3A3444' : '#3a3a44', mute = pp ? '#8A8296' : '#8a8a95', rule = pp ? '#EDE9E4' : '#eeeeee';
  return '<!doctype html><html lang="en-AU"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<meta name="x-apple-disable-message-reformatting">'
    + '<meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark">'
    + '<title>' + vpaEsc(title || brand) + '</title>'
    + '<style>@media (prefers-color-scheme: dark){.hd-page{background:#0b0a10 !important}.hd-card{background:#1c1a24 !important}'
    + '.hd-text{color:#e6e4ec !important}.hd-ink{color:#ffffff !important}.hd-mute{color:#a9a6b4 !important;border-color:#34313f !important}.hd-a{color:#ff6fb5 !important}}'
    + '@media (max-width:480px){.hd-sig-icon{width:84px !important;padding-right:12px !important}.hd-sig-img{width:84px !important;height:84px !important;border-radius:10px !important}.hd-sig-text{padding-left:12px !important;font-size:13px !important}}</style>'
    + '</head><body class="hd-page" style="margin:0;padding:0;background:' + page + ';-webkit-text-size-adjust:100%">'
    + (preheader ? '<div style="display:none;max-height:0;overflow:hidden;opacity:0">' + vpaEsc(preheader) + '</div>' : '')
    + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="hd-page" style="background:' + page + ';margin:0;padding:0;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">'
    + '<tr><td align="center" style="padding:24px 12px">'
    + '<table role="presentation" width="600" cellpadding="0" cellspacing="0" class="hd-card" style="max-width:600px;width:100%;background:#ffffff;border-radius:14px;overflow:hidden">'
    + '<tr><td style="background:' + band + ';padding:20px 28px"><img src="' + logo + '" width="168" alt="' + brand + '" style="display:block;border:0;height:auto;max-width:168px"></td></tr>'
    + '<tr><td style="height:3px;background:#FF1F8E;font-size:0;line-height:0">&nbsp;</td></tr>'
    + '<tr><td class="hd-text" style="padding:28px 28px 8px;font-size:16px;line-height:1.6;color:' + text + '">' + inner + '</td></tr>'
    + '<tr><td style="padding:14px 28px 26px"><p class="hd-mute" style="margin:0;padding-top:16px;border-top:1px solid ' + rule + ';font-size:12px;line-height:1.6;color:' + mute + '">' + foot + '</p></td></tr>'
    + '</table></td></tr></table></body></html>';
}
/* The email the contact gets, in the ticket's own brand and card (helpEmailCard). Transactional, so
   it carries the ABN and a way to reach us (as venueplay/emails/*.html do); the reference is in the
   subject so their reply threads back. */
function helpReplyHtml(ticket, body, replyTo, signer) {
  const pp = ticket.brand === 'partyplay';
  const ref = helpRef(ticket.reply_token);
  return helpEmailCard(pp,
    '<div style="white-space:pre-wrap">' + helpLinkify(helpHtml(body)) + '</div>' + helpSignatureHtml(ticket, signer || 'Dean', replyTo, helpSignsOff(body)),
    'Ticket ' + ticket.ticket_no + (ref ? ' (ref ' + ref + ')' : '') + '. To add anything, just reply to this email.<br>' + helpBrandFooter(pp) + '.',
    'Ticket ' + ticket.ticket_no);
}
/* THE ACKNOWLEDGEMENT (Dean, 23 Oct 2026: "auto-acknowledgement for every enquiry and ticket from
   support@"). Until now nobody who wrote in heard anything until a person replied: the form said
   "sent" and the inbox stayed empty. One short note, once per ticket, the moment the ticket exists,
   from the brand's support address: thanks, we have it, here is the number, a person will reply,
   reply to this email to add anything. Rewritten 28 Oct 2026 (Dean: the old one read "clunky"): a
   few warm, plain sentences signed by a person and no "What happens next" list. In the brand's own
   card from 29 Oct 2026 (helpEmailCard): logo, pink rule, "VenuePlay · ABN" footer, never Gflam.

   What it never does:
     - send twice. A note on the ticket records it, and the note is checked before sending.
     - carry the message back. Anyone can type any address into a public form, so an email that
       quoted the message would be a free way to send words of your choosing to anyone. The number
       and the next step: nothing the sender wrote, except the first name they gave.
     - go to a phone call or a ticket HQ typed in. The person is on the phone; and an address HQ
       typed was never given to us in writing (helpAdminReply has the same rule).
     - reply to an automatic sender. Email-in tickets have already been through helpIgnoreEmail,
       and ours carries Auto-Submitted and X-VP-Help so neither side loops.
     - come from support@venueplay.com.au itself. Resend sends only for the send. subdomains (see
       helpFromFor), so the From is support@send.<brand>.com.au and the Reply-To is the real
       support@ mailbox. The subject carries the ticket's reference, so the reply threads back on.
     - become a flood. Its own daily cap, beside the staff alerts' one, on the same Resend account
       as every invoice; past it the ticket still exists and HQ still sees it. */
function helpAckHtml(t, signer) {
  const pp = t.brand === 'partyplay';
  const site = pp ? 'partyplay.com.au' : 'venueplay.com.au';
  const support = 'support@' + site;
  const first = helpLine(t.contact_name, 60).split(' ')[0];
  const P = '<p style="margin:0 0 14px">';
  const inner =
      P + 'Hi ' + (first ? helpHtml(first) : 'there') + ',</p>'
    + P + 'Thanks, we\'ve got your message' + (t.ticket_no ? ' (ticket ' + t.ticket_no + ')' : '') + '. Someone from our team will read it and reply by email, usually the same business day.</p>'
    /* The phone line goes to a venue or a prospective venue only, never a player and never
       PartyPlay: the same rule as helpSignatureHtml. */
    + (!pp && ['venue_support', 'accounts', 'sales'].indexOf(t.category) !== -1
        ? P + 'If a game is on right now and something has gone wrong, call <a href="tel:' + VP_SUPPORT_TEL + '" ' + HELP_LINK + '>' + VP_SUPPORT_PHONE + '</a> and press 2.</p>' : '')
    + P + 'To add anything, just reply to this email.</p>'
    + helpSignatureHtml(t, signer || 'Dean', support, false);
  return helpEmailCard(pp, inner, helpBrandFooter(pp) + '.', 'Thanks, we\'ve got your message');
}
/* The number, then the ticket's reference so a reply threads back onto it (helpTicketFromEmail). */
function helpAckSubject(t) {
  return 'Thanks, we\'ve got your message' + (t.ticket_no ? ' ' + helpReplyTag(t) : '');
}
async function helpAcknowledge(env, t) {
  try {
    if (!t || !env.RESEND_API_KEY) return false;
    const to = String(t.contact_email || '').trim().toLowerCase();
    if (!to || !HELP_EMAIL_RE.test(to)) return false;
    if (t.channel === 'phone' || t.channel === 'manual' || t.contact_typed) return false;
    if (t.id) {
      const had = await vpaSelect(env, 'vp_help_ticket_notes', 'ticket_id=eq.' + encodeURIComponent(t.id) +
        '&kind=eq.change&body=like.' + encodeURIComponent('Acknowledgement sent*') + '&select=id&limit=1');
      if (had && had.length) return false;
    }
    const cap = Math.max(1, parseInt(env.HELP_ACK_DAILY_CAP || env.HELP_ALERT_DAILY_CAP || '150', 10) || 150);
    if (!(await helpLimit(env, 'ack:' + helpDayKey(), cap, 86400))) return false;
    const b = t.brand === 'partyplay' ? 'partyplay' : 'venueplay';
    const ok = await helpSendEmail(env, {
      to: to, from: HELP_BRAND_LABEL[b] + ' Support <support@send.' + b + '.com.au>', reply_to: 'support@' + b + '.com.au',
      subject: helpAckSubject(t),
      html: helpAckHtml(t, helpSigner(env, '')),
      headers: { 'X-VP-Help': 'ack', 'Auto-Submitted': 'auto-replied', 'X-Auto-Response-Suppress': 'All' } });
    if (ok && t.id) {
      await vpaInsert(env, 'vp_help_ticket_notes', { ticket_id: t.id, kind: 'change', body: 'Acknowledgement sent to ' + to, author: 'Help desk' }, false).catch(() => null);
    }
    return ok;
  } catch (e) { return false; }
}
async function helpAdminReply(request, env, json) {
  const g = await helpAdmin(request, env, json); if (g.res) return g.res;
  const t = await helpFindTicket(env, g.body.id);
  if (!t) return json({ error: 'That ticket is not there any more.' }, 404);
  if (!t.contact_email) return json({ error: 'This ticket has no email address to reply to. Add a note instead.' }, 400);
  const body = helpText(g.body.body);
  if (!body) return json({ error: 'Type the reply first.' }, 400);
  if (body.length > 8000) return json({ error: 'That reply is too long.' }, 400);
  /* A FILL-IN LEFT IN (29 Oct 2026). A saved reply's {first_name} or {tv_link} that the page could not
     fill must never reach a customer as the braces themselves. */
  const left = HELP_FILLIN_RE.exec(body);
  if (left) return json({ error: 'Fill in ' + left[0] + ' before sending.' }, 400);
  /* THE SUPPORT LINE IS FOR VENUES (Dean, 20 and 23 Oct 2026). The signature already follows it; a
     reply typed or picked from the saved replies must too: never to a player and never PartyPlay. */
  if (!helpPhoneAllowed(t) && helpHasSupportPhone(body)) {
    return json({ error: 'The support line is for venues only. Take the phone number out of this reply before sending.' }, 400);
  }
  /* AN ADDRESS HQ TYPED IN (a logged call, a manual ticket) was never given to us by that person in
     writing. Brand mail to it needs the owner, or whoever is sending to confirm that exact address,
     so a staff login cannot log a "call" and then send VenuePlay mail to anyone it likes. */
  const to = String(t.contact_email).toLowerCase();
  if (t.contact_typed && g.admin.role !== 'owner' && String(g.body.confirm_to || '').toLowerCase() !== to) {
    return json({ error: 'This address was typed in by HQ, not given to us by the customer. Check it is right, then confirm to send.',
                  confirm_needed: true, address: to }, 409);
  }
  const f = helpFromFor(t.category, t.brand);
  const subj = helpBareSubject(t.subject).replace(/^(re|fw|fwd):\s*/i, '') || 'Your request';
  const ok = await helpSendEmail(env, { to: to, from: f.from, reply_to: f.reply_to,
    subject: 'Re: ' + helpLine(subj, 150) + ' ' + helpReplyTag(t),
    html: helpReplyHtml(t, body, f.reply_to, helpSigner(env, g.admin.label)) });
  if (!ok) return json({ error: 'The email did not send, so nothing was recorded. Try again in a minute.' }, 502);
  await vpaInsert(env, 'vp_help_ticket_notes', { ticket_id: t.id, kind: 'reply', body: body,
    author: g.admin.label + ' (from ' + f.reply_to + ' to ' + to + (t.contact_typed && g.admin.role !== 'owner' ? ', typed address confirmed' : '') + ')', author_id: g.admin.actorId }, false);
  const patch = { updated_at: helpNow() }, was = t.status;
  /* "Send and close" (29 Oct 2026): one tap answers and closes, with the close written down as any
     other status change is. Otherwise a reply leaves the ticket waiting on them, as before. */
  if (g.body.close === true && t.status !== 'closed') { patch.status = 'closed'; patch.closed_at = helpNow(); }
  else if (t.status === 'new' || t.status === 'open') patch.status = 'waiting';
  await vpaPatch(env, 'vp_help_tickets', 'id=eq.' + encodeURIComponent(t.id), patch);
  if (patch.status === 'closed') {
    await vpaInsert(env, 'vp_help_ticket_notes', { ticket_id: t.id, kind: 'change', body: 'Status: ' + was + ' to closed (sent and closed)',
      author: g.admin.label, author_id: g.admin.actorId }, false);
  }
  return json({ ok: true, sent_from: f.reply_to, status: patch.status || t.status });
}

/* HQ CONFIRMS A NEW REPLY ADDRESS. An email asked for replies to go somewhere else (a Reply-To unlike
   its From, or a reply from another address quoting the ticket's secret); nothing was sent there.
   This is the one way that address becomes the ticket's, and it says who decided. */
async function helpAdminContactConfirm(request, env, json) {
  const g = await helpAdmin(request, env, json); if (g.res) return g.res;
  const t = await helpFindTicket(env, g.body.id);
  if (!t) return json({ error: 'That ticket is not there any more.' }, 404);
  if (!t.contact_email_pending) return json({ error: 'There is no other address waiting on this ticket.' }, 400);
  const was = t.contact_email || '(none)', now = t.contact_email_pending;
  if (g.body.use !== true) {
    await vpaPatch(env, 'vp_help_tickets', 'id=eq.' + encodeURIComponent(t.id), { contact_email_pending: null, updated_at: helpNow() });
    await vpaInsert(env, 'vp_help_ticket_notes', { ticket_id: t.id, kind: 'change', body: 'Kept replies going to ' + was + ', not ' + now, author: g.admin.label, author_id: g.admin.actorId }, false);
    return json({ ok: true, contact_email: was });
  }
  await vpaPatch(env, 'vp_help_tickets', 'id=eq.' + encodeURIComponent(t.id), { contact_email: now, contact_email_pending: null, contact_typed: false, updated_at: helpNow() });
  await vpaInsert(env, 'vp_help_ticket_notes', { ticket_id: t.id, kind: 'change', body: 'Replies now go to ' + now + ' (was ' + was + ')', author: g.admin.label, author_id: g.admin.actorId }, false);
  return json({ ok: true, contact_email: now });
}

/* LOG A CALL. This is how a phone call gets a category: HQ picks one while the call is fresh.
   No alert: the person logging it is the alert. */
async function helpAdminLogCall(request, env, json) {
  const g = await helpAdmin(request, env, json); if (g.res) return g.res;
  const b = g.body;
  if (HELP_CATEGORIES.indexOf(b.category) < 0) return json({ error: 'Pick what kind of call it was.' }, 400);
  if (HELP_BRANDS.indexOf(b.brand) < 0) return json({ error: 'Pick VenuePlay or PartyPlay.' }, 400);
  const subject = helpLine(b.subject, 300), message = helpText(b.message);
  if (!subject) return json({ error: 'Give the call a short subject.' }, 400);
  if (subject.length > 200 || message.length > 8000) return json({ error: 'That is too long.' }, 400);
  const email = helpLine(b.contact_email, 300).toLowerCase();
  if (email && !HELP_EMAIL_RE.test(email)) return json({ error: 'That email address does not look right.' }, 400);
  const venueId = b.brand === 'venueplay' && HELP_UUID.test(String(b.venue_id || '')) ? b.venue_id : null;
  const t = await helpInsertTicket(env, {
    brand: b.brand, category: b.category, channel: b.channel === 'manual' ? 'manual' : 'phone',
    status: b.status === 'closed' ? 'closed' : 'open', priority: b.priority === 'urgent' ? 'urgent' : 'normal',
    title: subject, message: message, contact_name: b.contact_name, contact_email: email || null, contact_typed: !!email,
    contact_phone: b.contact_phone, venue_id: venueId, room_code: /^[A-Z0-9]{4,8}$/.test(String(b.room_code || '').toUpperCase()) ? String(b.room_code).toUpperCase() : null,
    raised_by: g.admin.actorId,
  });
  await vpaInsert(env, 'vp_help_ticket_notes', { ticket_id: t.id, kind: 'change',
    body: 'Logged by ' + g.admin.label + (t.status === 'closed' ? ', sorted on the call' : ''), author: g.admin.label, author_id: g.admin.actorId }, false);
  return json({ ok: true, ticket: t });
}

/* SAVED REPLIES (Dean, 29 Oct 2026: "helpdesk needs to be easier to use with templates we can use to
   reply"). Ready-made answers HQ drops into the reply box, edits if it likes, then sends; HQ adds,
   changes, deletes and reorders them. Table vp_help_saved_replies, migration 126, service role only.

   audience says which tickets a reply is offered on: 'venue' (a VenuePlay venue, or one that might
   be), 'player' (a VenuePlay player), 'partyplay' (a PartyPlay buyer or guest), 'any'. The support
   line may only be in a 'venue' reply (the same rule as helpSignatureHtml), and helpAdminReply checks
   it again on every send, so a reply edited in the box cannot carry it to a player either.

   BEFORE MIGRATION 126 the list answers {missing: true} and HQ shows the starter set built into
   vp-helpdesk-hq.js (the same rows the migration seeds; tools/test-help-saved-replies.js holds the two
   to one answer). Saving says the migration has to run first; nothing is lost or half-written. */
const HELP_REPLY_AUDIENCES = ['venue', 'player', 'partyplay', 'any'];
const HELP_FILLIN_RE = /\{[a-z][a-z_]{1,24}\}/;
function helpPhoneAllowed(t) {
  return !!t && t.brand !== 'partyplay' && ['venue_support', 'accounts', 'sales'].indexOf(t.category) !== -1;
}
function helpHasSupportPhone(text) {
  const digits = String(text || '').replace(/\D/g, '');
  return digits.indexOf(VP_SUPPORT_PHONE.replace(/\D/g, '').slice(1)) !== -1 || /\btel:/i.test(String(text || ''));
}
function helpTableMissing(status, text) {
  return status === 404 || /PGRST205|42P01|does not exist|schema cache/i.test(String(text || ''));
}
async function helpRepliesRead(env) {
  const res = await fetch(env.SUPABASE_URL + '/rest/v1/vp_help_saved_replies?select=*&order=position.asc,created_at.asc,id.asc&limit=500',
    { headers: vpaHeaders(env) });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    if (helpTableMissing(res.status, txt)) return { missing: true, rows: [] };
    throw new Error('read vp_help_saved_replies: ' + res.status + ' ' + txt.slice(0, 200));
  }
  const rows = await res.json();
  if (!Array.isArray(rows)) throw new Error('read vp_help_saved_replies: not a list');
  return { missing: false, rows: rows };
}
const HELP_REPLIES_NOT_YET = 'Saved replies cannot be changed until migration 126 is run. The starter replies still work in every ticket.';
async function helpAdminRepliesList(request, env, json) {
  const g = await helpAdmin(request, env, json); if (g.res) return g.res;
  const r = await helpRepliesRead(env);
  return json({ replies: r.rows, missing: r.missing });
}
async function helpAdminRepliesSave(request, env, json) {
  const g = await helpAdmin(request, env, json); if (g.res) return g.res;
  const b = g.body;
  const title = helpLine(b.title, 200), body = helpText(b.body);
  if (!title) return json({ error: 'Give the saved reply a short name.' }, 400);
  if (title.length > 80) return json({ error: 'Keep the name under 80 letters.' }, 400);
  if (!body) return json({ error: 'Type the words of the reply.' }, 400);
  if (body.length > 4000) return json({ error: 'That reply is too long.' }, 400);
  if (HELP_REPLY_AUDIENCES.indexOf(b.audience) < 0) return json({ error: 'Pick who the reply is for.' }, 400);
  if (b.audience !== 'venue' && helpHasSupportPhone(body)) {
    return json({ error: 'The support line is for venues only. Take the phone number out, or make this a reply for venues.' }, 400);
  }
  const r = await helpRepliesRead(env);
  if (r.missing) return json({ error: HELP_REPLIES_NOT_YET, missing: true }, 409);
  const row = { title: title, body: body, audience: b.audience, updated_at: helpNow(), updated_by: g.admin.label };
  if (b.id) {
    if (!HELP_UUID.test(String(b.id))) return json({ error: 'Which reply?' }, 400);
    if (!r.rows.some((x) => x.id === b.id)) return json({ error: 'That saved reply is not there any more.' }, 404);
    await vpaPatch(env, 'vp_help_saved_replies', 'id=eq.' + encodeURIComponent(b.id), row);
    return json({ ok: true, id: b.id });
  }
  row.position = r.rows.reduce((m, x) => Math.max(m, x.position || 0), 0) + 10;
  const made = await vpaInsert(env, 'vp_help_saved_replies', row);
  return json({ ok: true, id: made && made.id });
}
async function helpAdminRepliesDelete(request, env, json) {
  const g = await helpAdmin(request, env, json); if (g.res) return g.res;
  if (!HELP_UUID.test(String(g.body.id || ''))) return json({ error: 'Which reply?' }, 400);
  const r = await helpRepliesRead(env);
  if (r.missing) return json({ error: HELP_REPLIES_NOT_YET, missing: true }, 409);
  const gone = await vpaDelete(env, 'vp_help_saved_replies', 'id=eq.' + encodeURIComponent(g.body.id));
  if (!gone.length) return json({ error: 'That saved reply is not there any more.' }, 404);
  return json({ ok: true });
}
/* Up or down one place in the list HQ sees (every reply, in order). The whole list is renumbered
   10, 20, 30 so two replies can never share a place and the order is exactly what HQ last saw. */
async function helpAdminRepliesMove(request, env, json) {
  const g = await helpAdmin(request, env, json); if (g.res) return g.res;
  const b = g.body;
  if (!HELP_UUID.test(String(b.id || '')) || (b.dir !== 'up' && b.dir !== 'down')) return json({ error: 'Move which reply, which way?' }, 400);
  const r = await helpRepliesRead(env);
  if (r.missing) return json({ error: HELP_REPLIES_NOT_YET, missing: true }, 409);
  const list = r.rows.slice(), i = list.findIndex((x) => x.id === b.id);
  if (i < 0) return json({ error: 'That saved reply is not there any more.' }, 404);
  const j = b.dir === 'up' ? i - 1 : i + 1;
  if (j < 0 || j >= list.length) return json({ ok: true, unchanged: true });
  const tmp = list[i]; list[i] = list[j]; list[j] = tmp;
  for (let k = 0; k < list.length; k++) {
    const want = (k + 1) * 10;
    if (list[k].position !== want) await vpaPatch(env, 'vp_help_saved_replies', 'id=eq.' + encodeURIComponent(list[k].id), { position: want });
  }
  return json({ ok: true, order: list.map((x) => x.id) });
}

/* THE REPORT. Pure, so a test can hand it rows and check every number against them. Tickets
   CREATED in the range; time to close is over the ones of those that are closed. */
function helpReport(rows, venueNames) {
  const count = (k) => { const o = {}; rows.forEach((r) => { o[r[k]] = (o[r[k]] || 0) + 1; }); return o; };
  const closed = rows.filter((r) => r.status === 'closed' && r.closed_at);
  const hours = closed.map((r) => ({ no: r.ticket_no, h: (Date.parse(r.closed_at) - Date.parse(r.created_at)) / 3600000 }))
                      .filter((x) => isFinite(x.h) && x.h >= 0);
  const longest = hours.reduce((m, x) => (!m || x.h > m.h ? x : m), null);
  const byVenue = {};
  rows.forEach((r) => { if (r.venue_id) byVenue[r.venue_id] = (byVenue[r.venue_id] || 0) + 1; });
  const top = Object.keys(byVenue).map((id) => ({ venue_id: id, name: (venueNames && venueNames[id]) || '(unknown venue)', count: byVenue[id] }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).slice(0, 10);
  const byBrandCategory = {};
  rows.forEach((r) => { const k = r.brand + ':' + r.category; byBrandCategory[k] = (byBrandCategory[k] || 0) + 1; });
  return {
    total: rows.length,
    by_brand: count('brand'), by_category: count('category'), by_channel: count('channel'), by_status: count('status'),
    by_brand_category: byBrandCategory,
    closed: hours.length,
    avg_hours_to_close: hours.length ? Math.round(10 * hours.reduce((s, x) => s + x.h, 0) / hours.length) / 10 : null,
    longest_hours_to_close: longest ? Math.round(10 * longest.h) / 10 : null,
    longest_ticket_no: longest ? longest.no : null,
    top_venues: top,
  };
}
async function helpAdminReport(request, env, json) {
  const g = await helpAdmin(request, env, json); if (g.res) return g.res;
  const from = helpDay(g.body.from), to = helpDay(g.body.to, true);
  if (!from || !to) return json({ error: 'Pick a from and a to date.' }, 400);
  const q = ['and=(created_at.gte.' + encodeURIComponent(from) + ',created_at.lte.' + encodeURIComponent(to) + ')'];
  if (HELP_BRANDS.indexOf(g.body.brand) >= 0) q.push('brand=eq.' + g.body.brand);
  q.push('select=id,ticket_no,brand,created_at,closed_at,category,channel,status,priority,venue_id,room_code,subject');
  const rows = await vpaSelectAll(env, 'vp_help_tickets', q.join('&') + '&order=created_at.asc,id.asc');
  const names = await helpVenueNames(env, rows.map((r) => r.venue_id));
  // The guided triage over the same dates: solved without a ticket, per issue, and by which step.
  const triage = await helpTriageForRange(env, from, to, g.body.brand);
  return json({ from: g.body.from, to: g.body.to, report: helpReport(rows, names), rows: rows, venues: names, triage: triage });
}

/* ------------------------------ PHONE ALERTS (Web Push) ------------------------------
   Dean: "can we somehow get an alert on it?" Standard Web Push, no paid service. A staff member
   taps "Alert me on this device" in HQ once; the Worker then pushes to that device on every new
   ticket (or only urgent and sales, their choice).

   THE PUSH CARRIES NOTHING. A Web Push payload has to be encrypted with a fresh ECDH key per
   message, and this runtime will not generate EC key pairs (see the signing keys note in
   memory, "Workers cannot mint ECDSA"). So the push is EMPTY: it only wakes the phone. The phone's
   service worker then asks /help/push/peek, with that device's own secret, what arrived, and is
   told brand, category, ticket number and whether it is urgent. Nothing else, and nothing of a
   customer's ever passes through Apple's or Google's push servers.

   Secrets (Dean sets them; see ~/venue-enrich/HELP-DESK-ALERTS.md): VAPID_PUBLIC_KEY (base64url,
   65 bytes), VAPID_PRIVATE_JWK (the private key as a JWK), optional VAPID_SUBJECT. Without them
   every push quietly reports "not set up" and the email alert still goes. */
const HELP_PUSH_HOSTS = /^https:\/\/([a-z0-9-]+\.)*(fcm\.googleapis\.com|push\.services\.mozilla\.com|push\.apple\.com|notify\.windows\.com|windows\.com)(:\d+)?\//i;
function helpB64url(bytes) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let out = '', i = 0;
  for (; i + 2 < bytes.length; i += 3) { const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += A[(n >> 18) & 63] + A[(n >> 12) & 63] + A[(n >> 6) & 63] + A[n & 63]; }
  if (i < bytes.length) { const n = (bytes[i] << 16) | ((bytes[i + 1] || 0) << 8);
    out += A[(n >> 18) & 63] + A[(n >> 12) & 63] + (i + 1 < bytes.length ? A[(n >> 6) & 63] : ''); }
  return out;
}
function helpUtf8Bytes(s) {
  const bin = unescape(encodeURIComponent(String(s))), out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
async function helpSha256Hex(s) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', helpUtf8Bytes(s)));
  let h = ''; for (let i = 0; i < d.length; i++) h += ('0' + d[i].toString(16)).slice(-2);
  return h;
}
/* The VAPID Authorization header (RFC 8292): an ES256 JWT for the push service's origin, signed
   with the IMPORTED private key. Workers can import and sign with ECDSA; only generating is out. */
async function helpVapidAuth(env, endpoint) {
  const jwk = JSON.parse(env.VAPID_PRIVATE_JWK);
  const aud = (/^(https:\/\/[^/]+)/.exec(endpoint) || [])[1];
  const enc = (o) => helpB64url(helpUtf8Bytes(JSON.stringify(o)));
  const unsigned = enc({ typ: 'JWT', alg: 'ES256' }) + '.' +
    enc({ aud: aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: env.VAPID_SUBJECT || 'mailto:hello@venueplay.com.au' });
  const key = await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', d: jwk.d, x: jwk.x, y: jwk.y, ext: true },
    { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, helpUtf8Bytes(unsigned)));
  return 'vapid t=' + unsigned + '.' + helpB64url(sig) + ', k=' + env.VAPID_PUBLIC_KEY;
}
function helpPushWants(sub, ticket) {
  if (sub.filter === 'urgent_sales') return ticket.priority === 'urgent' || ticket.category === 'sales';
  return true;
}
async function helpPushNew(env, ticket) {
  if (!env.VAPID_PRIVATE_JWK || !env.VAPID_PUBLIC_KEY) return { sent: 0, why: 'phone alerts are not set up' };
  let subs;
  try { subs = await vpaSelectAll(env, 'vp_help_push_subs', 'select=id,endpoint,filter&order=id.asc'); }
  catch (e) { return { sent: 0, why: 'could not read the alert list' }; }
  let sent = 0, gone = 0, failed = 0;
  for (const s of subs) {
    if (!helpPushWants(s, ticket) || !HELP_PUSH_HOSTS.test(s.endpoint)) continue;
    try {
      const res = await fetch(s.endpoint, { method: 'POST', body: '', headers: {
        'TTL': '86400', 'Urgency': ticket.priority === 'urgent' ? 'high' : 'normal',
        'Authorization': await helpVapidAuth(env, s.endpoint), 'Content-Length': '0' } });
      if (res.status === 404 || res.status === 410) {
        // The device unsubscribed itself or the browser was reset: forget it, or it is tried for ever.
        await vpaDelete(env, 'vp_help_push_subs', 'id=eq.' + encodeURIComponent(s.id)); gone++;
      } else if (res.ok) sent++; else failed++;
    } catch (e) { failed++; }
  }
  return { sent: sent, gone: gone, failed: failed };
}
async function helpAdminPushKey(request, env, json) {
  const g = await helpAdmin(request, env, json); if (g.res) return g.res;
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_JWK) return json({ error: 'Phone alerts are not switched on yet. See HELP-DESK-ALERTS.md.' }, 503);
  return json({ key: env.VAPID_PUBLIC_KEY });
}
async function helpAdminPushSubscribe(request, env, json) {
  const g = await helpAdmin(request, env, json); if (g.res) return g.res;
  const endpoint = String(g.body.endpoint || '').trim();
  if (!HELP_PUSH_HOSTS.test(endpoint) || endpoint.length > 1000) return json({ error: 'That is not a push address this desk knows.' }, 400);
  const filter = g.body.filter === 'urgent_sales' ? 'urgent_sales' : 'all';
  const raw = new Uint8Array(32); crypto.getRandomValues(raw);
  const token = helpB64url(raw);
  await vpaDelete(env, 'vp_help_push_subs', 'endpoint=eq.' + encodeURIComponent(endpoint));
  await vpaInsert(env, 'vp_help_push_subs', { endpoint: endpoint, filter: filter, auth_user_id: g.admin.actorId,
    admin_label: g.admin.label, token_hash: await helpSha256Hex(token),   // last_peek_at: the database's now() (migration 108)
    device_label: helpLine(g.body.device_label, 80) || null }, false);
  return json({ ok: true, token: token, filter: filter });
}
async function helpAdminPushUnsubscribe(request, env, json) {
  const g = await helpAdmin(request, env, json); if (g.res) return g.res;
  const endpoint = String(g.body.endpoint || '').trim();
  if (!endpoint) return json({ error: 'Which device?' }, 400);
  const gone = await vpaDelete(env, 'vp_help_push_subs', 'endpoint=eq.' + encodeURIComponent(endpoint));
  return json({ ok: true, removed: gone.length });
}
/* What woke this phone up. Answers ONLY a device holding its own secret, and only with brand,
   category, number and urgency: never a name, an email, a subject or a message. */
async function helpPushPeek(request, env, json) {
  const ip = request.headers.get('cf-connecting-ip') || '';
  if (!(await helpIpLimit(env, 'peek', ip, 120, 3600))) return json({ error: 'slow down' }, 429);
  const _b = await vpaBody(request, json);
  if (!_b.ok) return _b.res;
  const endpoint = String(_b.body.endpoint || '').trim(), token = String(_b.body.token || '');
  if (!endpoint || token.length < 20) return json({ error: 'not allowed' }, 403);
  const r = await vpaSelect(env, 'vp_help_push_subs', 'endpoint=eq.' + encodeURIComponent(endpoint) + '&select=id,filter,token_hash,last_peek_at&limit=1');
  const sub = r && r[0];
  if (!sub || sub.token_hash !== await helpSha256Hex(token)) return json({ error: 'not allowed' }, 403);
  /* THE CURSOR IS THE DATABASE'S CLOCK, never this Worker's: it starts at the database's now() when
     the device signed up (migration 108) and only ever moves to the created_at of a ticket the
     database returned. Two clocks a second apart is how a phone gets told about a ticket twice,
     or never. A device with no cursor yet starts from the newest ticket there is. */
  let since = sub.last_peek_at;
  if (!since) {
    const newest = await vpaSelect(env, 'vp_help_tickets', 'select=created_at&order=created_at.desc&limit=1');
    since = (newest && newest[0] && newest[0].created_at) || '1970-01-01T00:00:00Z';
    await vpaPatch(env, 'vp_help_push_subs', 'id=eq.' + encodeURIComponent(sub.id), { last_peek_at: since });
    return json({ count: 0 });
  }
  const rows = await vpaSelect(env, 'vp_help_tickets', 'created_at=gt.' + encodeURIComponent(since) +
    '&channel=in.(patron_form,venue_form,web_form,email)&select=ticket_no,brand,category,priority,created_at&order=created_at.desc&limit=50');
  const mine = (rows || []).filter((t) => helpPushWants(sub, t))
    .sort((x, y) => String(y.created_at).localeCompare(String(x.created_at)));
  const seen = (rows || []).reduce((m, x) => (String(x.created_at) > m ? String(x.created_at) : m), String(since));
  if (seen !== String(since)) await vpaPatch(env, 'vp_help_push_subs', 'id=eq.' + encodeURIComponent(sub.id), { last_peek_at: seen });
  const t = mine[0];
  if (!t) return json({ count: 0 });
  return json({ count: mine.length, ticket_no: t.ticket_no, brand: t.brand, category: t.category,
                urgent: t.priority === 'urgent', label: helpCategoryLabel(t.category, t.brand) });
}

/* ------------------------------ INBOUND EMAIL ------------------------------
   A small MIME reader: headers, encoded words, multipart, quoted-printable, base64, UTF-8. Enough
   for what people send to a support address. Anything it cannot read becomes "(could not read the
   message body)" and the ticket is still made: the email is also in the Migadu inbox. */
function helpB64(s) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  s = String(s || '').replace(/[^A-Za-z0-9+/]/g, '');
  let out = '', bits = 0, acc = 0;
  for (let i = 0; i < s.length; i++) { acc = ((acc << 6) | A.indexOf(s[i])) & 0xffffff; bits += 6;
    if (bits >= 8) { bits -= 8; out += String.fromCharCode((acc >> bits) & 255); } }
  return out;
}
function helpQP(s, header) {
  if (header) s = String(s || '').replace(/_/g, ' ');
  return String(s || '').replace(/=\r?\n/g, '').replace(/=([0-9A-Fa-f]{2})/g, (m, h) => String.fromCharCode(parseInt(h, 16)));
}
function helpUtf8(bin, charset) {
  if (charset && !/utf-?8/i.test(charset)) return bin;            // latin1 and friends read as-is
  try { return decodeURIComponent(bin.replace(/[%\x80-\xff]/g, (c) => '%' + ('0' + c.charCodeAt(0).toString(16)).slice(-2))); }
  catch (e) { return bin; }
}
function helpWords(s) {
  return String(s || '').replace(/\?=\s+=\?/g, '?==?').replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (m, cs, enc, txt) =>
    helpUtf8(/b/i.test(enc) ? helpB64(txt) : helpQP(txt, true), cs));
}
function helpHeaders(block) {
  const h = {};
  String(block || '').replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/).forEach((line) => {
    const i = line.indexOf(':'); if (i <= 0) return;
    const k = line.slice(0, i).trim().toLowerCase(), v = line.slice(i + 1).trim();
    if (!(k in h)) h[k] = v;
  });
  return h;
}
function helpParam(v, name) {
  const m = new RegExp(name + '\\s*=\\s*(?:"([^"]*)"|([^;\\s]+))', 'i').exec(String(v || ''));
  return m ? (m[1] !== undefined ? m[1] : m[2]) : '';
}
function helpSplit(raw) {
  const m = /\r?\n\r?\n/.exec(raw);
  return m ? { head: raw.slice(0, m.index), body: raw.slice(m.index + m[0].length) } : { head: raw, body: '' };
}
function helpStripHtml(s) {
  return String(s || '').replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, '').replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n').replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
}
function helpPartText(headers, body, depth) {
  const ct = headers['content-type'] || 'text/plain';
  if (/^multipart\//i.test(ct) && depth < 6) {
    const boundary = helpParam(ct, 'boundary');
    if (!boundary) return { plain: '', html: '' };
    const parts = body.split('--' + boundary);
    let plain = '', html = '';
    for (let i = 1; i < parts.length; i++) {
      const p = parts[i];
      if (/^--/.test(p)) break;
      const s = helpSplit(p.replace(/^\r?\n/, ''));
      const got = helpPartText(helpHeaders(s.head), s.body, depth + 1);
      if (!plain && got.plain) plain = got.plain;
      if (!html && got.html) html = got.html;
    }
    return { plain: plain, html: html };
  }
  if (/attachment/i.test(headers['content-disposition'] || '')) return { plain: '', html: '' };
  const te = (headers['content-transfer-encoding'] || '').toLowerCase();
  const bin = te === 'base64' ? helpB64(body) : te === 'quoted-printable' ? helpQP(body) : body;
  const text = helpUtf8(bin, helpParam(ct, 'charset'));
  if (/^text\/plain/i.test(ct)) return { plain: text, html: '' };
  if (/^text\/html/i.test(ct)) return { plain: '', html: text };
  return { plain: '', html: '' };
}
function helpAddress(v) {
  const s = helpWords(v || '');
  const m = /^(.*?)<([^>]+)>/.exec(s);
  const email = (m ? m[2] : s).trim().toLowerCase();
  const name = m ? m[1].replace(/^\s*"|"\s*$/g, '').trim() : '';
  return { name: name, email: HELP_EMAIL_RE.test(email) ? email : '' };
}
function helpParseEmail(raw) {
  const s = helpSplit(String(raw || ''));
  const h = helpHeaders(s.head);
  const parts = helpPartText(h, s.body, 0);
  const text = helpText(parts.plain || helpStripHtml(parts.html));
  return {
    headers: h,
    title: helpLine(helpWords(h.subject || ''), 300),
    from: helpAddress(h.from),
    reply_to: h['reply-to'] ? helpAddress(h['reply-to']) : null,
    message_id: helpLine(h['message-id'] || '', 300),
    text: text || '(could not read the message body)',
  };
}
/* The new part of a reply, without the quoted history every mail program appends. */
function helpStripQuoted(text) {
  const lines = String(text || '').split('\n');
  for (let i = 1; i < lines.length; i++) {
    const l = lines[i];
    if (/^\s*>/.test(l) || /^On .+wrote:\s*$/.test(l) || /^-{2,}\s*Original Message/i.test(l) ||
        /^_{5,}\s*$/.test(l) || (/^From:\s.+/.test(l) && /^\s*$/.test(lines[i - 1] || ''))) {
      // "On Mon, 19 Oct 2026 at 10:02, VenuePlay <...> wrote:" can wrap onto two lines.
      let cut = i;
      if (/^On .+/.test(lines[i - 1] || '') && /wrote:\s*$/.test(l) && !/^On .+wrote:\s*$/.test(l)) cut = i - 1;
      const kept = lines.slice(0, cut).join('\n').trim();
      return kept || String(text).trim();
    }
  }
  return String(text || '').trim();
}
/* Mail that must never become a ticket: our own alerts and replies coming back round through the
   hello@ copy, bounces, out-of-office, newsletters. A loop here would be a ticket per alert per
   alert, so this errs on the side of ignoring. It is all in the Migadu inbox regardless. */
function helpIgnoreEmail(mail) {
  const h = mail.headers || {}, from = mail.from.email;
  if (!from) return 'no sender';
  if (/@send\.(venueplay|partyplay)\.com\.au$/.test(from)) return 'our own sending domain';
  if (h['x-vp-help']) return 'one of our help desk emails';
  if (h['auto-submitted'] && !/^no$/i.test(h['auto-submitted'])) return 'automatic reply';
  if (/^(bulk|junk|list|auto_reply)$/i.test(h.precedence || '')) return 'bulk mail';
  if (h['list-unsubscribe'] || h['list-id']) return 'a mailing list';
  if (/^(mailer-daemon|postmaster|no-?reply|do-?not-?reply)@/i.test(from)) return 'an automatic sender';
  return '';
}
async function helpReadRaw(message) {
  if (typeof message.raw === 'string') return message.raw.slice(0, 2000000);
  const text = await new Response(message.raw).text();
  return text.slice(0, 2000000);
}
async function helpTicketFromEmail(env, to, mail) {
  const why = helpIgnoreEmail(mail);
  if (why) return { action: 'ignored', why: why };
  const mid = mail.message_id || null;
  if (mid) {
    const a = await vpaSelect(env, 'vp_help_tickets', 'email_message_id=eq.' + encodeURIComponent(mid) + '&select=ticket_no&limit=1');
    const b = await vpaSelect(env, 'vp_help_ticket_notes', 'email_message_id=eq.' + encodeURIComponent(mid) + '&select=id&limit=1');
    if ((a && a.length) || (b && b.length)) return { action: 'duplicate' };
  }
  /* WHO WROTE IT: the From address. A Reply-To that differs is only a request, held on the ticket
     until HQ confirms it, because headers are the sender's to write and a reply sent to a Reply-To
     nobody checked is our brand's mail going wherever a stranger pointed it. */
  const contact = mail.from;
  const askedElsewhere = (mail.reply_to && mail.reply_to.email && mail.reply_to.email !== mail.from.email) ? mail.reply_to.email : null;
  const brand = helpBrandForAddress(to);
  /* A reply to one of ours has to quote the ticket's number AND its secret. Since 28 Oct 2026 every
     email we send ends its subject "(ticket 1042, ref K7QP-2XMA)", the reference being made from the
     secret (helpRef); the subject is looked at first, then the body, where a reply quotes ours. The
     forms sent before then still work: "[#1042-k7Qp2x...]" in the subject, or support+1042-k7Qp2x...@
     as the address. From and Reply-To can be forged; the secret cannot be guessed. Anything without
     it, including a bare "[#1042]" or "(ticket 1042)", starts a new ticket instead of writing on
     somebody else's. */
  const plus = /\+(\d{3,9})-([A-Za-z0-9_-]{8,40})@/.exec(String(to || ''));
  const oldTag = /\[#(\d{3,9})-([A-Za-z0-9_-]{8,40})\]/.exec(mail.title) || plus;
  const newTag = oldTag ? null : (HELP_REF_RE.exec(mail.title) || HELP_REF_RE.exec(String(mail.text || '').slice(0, 50000)));
  const tagNo = oldTag ? oldTag[1] : newTag ? newTag[1] : null;
  const tagOk = (t) => !!(t && t.reply_token) && (oldTag ? t.reply_token === oldTag[2]
    : helpRef(t.reply_token) === (newTag[2] + '-' + newTag[3]).toUpperCase());
  if (tagNo) {
    const r = await vpaSelect(env, 'vp_help_tickets', 'ticket_no=eq.' + tagNo + '&select=*&limit=1');
    const t = r && r[0];
    if (t && tagOk(t) && t.brand === brand) {
      const body = helpStripQuoted(mail.text).slice(0, 20000);
      const known = String(t.contact_email || '').toLowerCase() === contact.email;
      await vpaInsert(env, 'vp_help_ticket_notes', { ticket_id: t.id, kind: 'email_in', body: body,
        author: (contact.name ? contact.name + ' ' : '') + '<' + contact.email + '>' + (known ? '' : ' (not the address on this ticket)'), email_message_id: mid }, false);
      const patch = { updated_at: helpNow() };
      if (t.status === 'waiting' || t.status === 'closed') { patch.status = 'open'; patch.closed_at = null; }
      const wants = askedElsewhere || (known ? null : contact.email);
      if (wants && wants !== String(t.contact_email || '').toLowerCase()) patch.contact_email_pending = wants;
      await vpaPatch(env, 'vp_help_tickets', 'id=eq.' + encodeURIComponent(t.id), patch);
      await helpNotifyStaff(env, Object.assign({}, t, patch), await helpVenueName(env, t.venue_id), 'Reply on #' + t.ticket_no + ': ' + body.slice(0, 400));
      return { action: 'note', ticket_no: t.ticket_no };
    }
  }
  const local = String(to || '').toLowerCase().split('@')[0].replace(/\+.*$/, '');
  // A VenuePlay sender whose address is an account's contact email is matched to that account's first venue.
  let venueId = null;
  if (brand === 'venueplay') {
    const acc = await vpaSelect(env, 'venueplay_founding', 'contact_email=' + vpaEmailIs(contact.email) + '&select=id,contact_email&limit=5');
    const mine = (acc || []).filter((x) => String(x.contact_email || '').toLowerCase() === contact.email)[0];
    if (mine) {
      const v = await vpaSelect(env, 'vp_venues', 'founding_id=eq.' + encodeURIComponent(mine.id) + '&select=id&order=created_at.asc&limit=1');
      if (v && v[0]) venueId = v[0].id;
    }
  }
  let t;
  try {
    t = await helpInsertTicket(env, {
      brand: brand, category: helpCategoryForAddress(to), channel: 'email', title: mail.title || '(no subject)',
      message: mail.text.slice(0, 20000), contact_name: contact.name || null, contact_email: contact.email,
      contact_email_pending: askedElsewhere, venue_id: venueId, source_address: local ? local + '@' + brand + '.com.au' : null, email_message_id: mid,
    });
  } catch (e) {
    // Two deliveries of one message racing each other: the unique Message-ID let only one in.
    if (mid && /duplicate|unique|23505/i.test(String(e && e.message))) return { action: 'duplicate' };
    throw e;
  }
  await helpAnnounce(env, t, await helpVenueName(env, venueId));
  await helpAcknowledge(env, t);   // a new ticket by email is acknowledged too; a reply on one is not
  return { action: 'ticket', ticket_no: t.ticket_no };
}
async function helpInboundEmail(message, env) {
  try {
    const raw = await helpReadRaw(message);
    return await helpTicketFromEmail(env, message.to, helpParseEmail(raw));
  } catch (e) {
    /* Never reject the message: Migadu already has its own copy, and a bounce would tell the
       sender their email failed when it did not. Log it and carry on. */
    console.log('[help] inbound email not ticketed: ' + String((e && e.message) || e).slice(0, 300));
    return { action: 'failed' };
  }
}

/* ==========================================================================================
   HELP CONTENT AND GUIDED TRIAGE (migration 106, 19 Oct 2026)

   Dean: an HQ editor for the FAQ per brand ("add, edit, reorder, hide questions with no code"),
   and on every Help panel a guided "What's your issue?" that shows ONE step at a time, the next
   only after "Still not working", three or four at most, then the contact form already filled in.
   Steps that fix more get moved up on their own once they have enough answers; a pinned step
   stays put; every automatic move is logged in HQ with Undo; a step that almost never helps is
   flagged.

   PUBLIC: GET /help/content (the words, never the counts) and POST /help/triage (one answer).
   HQ ONLY: /admin/help/content/*, /admin/help/reorder/undo, and the triage half of the report.
   ========================================================================================== */
const HELP_AUDIENCES = { venueplay: ['patron', 'venue'], partyplay: ['guest', 'host'] };
const HELP_REORDER_MIN_TRIES = 20;   // every unpinned step needs this many answers before any move
const HELP_REORDER_MARGIN = 0.05;    // a step passes the one above only when it fixes 5 points more
const HELP_FLAG_TRIES = 30;          // after this many answers...
const HELP_FLAG_RATE = 0.05;         // ...a step fixing under 5% is flagged in HQ
const HELP_TRIAGE_MAX_PER_IP = 300;  // an hour: a pub's wifi is one address
const HELP_TRIAGE_MAX_PER_DEVICE = 40;   // ten minutes

function helpAudienceOk(brand, audience) {
  return !!(HELP_AUDIENCES[brand] && HELP_AUDIENCES[brand].indexOf(audience) >= 0);
}
function helpRate(s) { return s.tries > 0 ? s.fixes / s.tries : 0; }
function helpFlagged(s) { return s.tries >= HELP_FLAG_TRIES && helpRate(s) < HELP_FLAG_RATE; }

/* THE ORDER, decided in one pure function so a test can hand it any steps. Steps come in their
   current order. Pinned steps keep their slots. Nothing moves until EVERY unpinned step has
   HELP_REORDER_MIN_TRIES answers (a step that has only been seen five times has no rate worth
   trusting, and moving the others around it would starve it of answers). Then the unpinned steps
   are re-sorted by fix rate, but a step only passes the one above it by beating it by
   HELP_REORDER_MARGIN, so two steps a point apart do not swap back and forth all week.
   Returns the ids in the new order. */
function helpOrder(steps) {
  const cur = steps.slice();
  const free = cur.filter((s) => !s.pinned);
  if (free.length < 2 || free.some((s) => (s.tries || 0) < HELP_REORDER_MIN_TRIES)) return cur.map((s) => s.id);
  const sorted = [];
  free.forEach((s) => {
    let i = sorted.length;
    while (i > 0 && helpRate(s) > helpRate(sorted[i - 1]) + HELP_REORDER_MARGIN) i--;
    sorted.splice(i, 0, s);
  });
  let k = 0;
  return cur.map((s) => (s.pinned ? s.id : sorted[k++].id));
}

async function helpIssueSteps(env, issueId, withHidden) {
  return await vpaSelect(env, 'vp_help_steps', 'issue_id=eq.' + encodeURIComponent(issueId) +
    (withHidden ? '' : '&hidden=eq.false') + '&select=*&order=position.asc,id.asc&limit=50');
}

/* Look at one issue after an answer and move its steps if helpOrder says so. Only visible steps
   take part; they swap among the positions they already hold. Logged, with what it was before,
   so HQ can put it back. */
async function helpMaybeReorder(env, issue) {
  if (!issue || issue.auto_order === false) return null;
  const steps = await helpIssueSteps(env, issue.id, false);
  const before = steps.map((s) => s.id);
  const after = helpOrder(steps);
  if (after.join() === before.join()) return null;
  const slots = steps.map((s) => s.position);
  const byId = {}; steps.forEach((s) => { byId[s.id] = s; });
  for (let i = 0; i < after.length; i++) {
    if (byId[after[i]].position !== slots[i]) await vpaPatch(env, 'vp_help_steps', 'id=eq.' + encodeURIComponent(after[i]), { position: slots[i] });
  }
  const why = after.map((id, i) => (i + 1) + '. ' + Math.round(100 * helpRate(byId[id])) + '% of ' + byId[id].tries).join(', ');
  const log = await vpaInsert(env, 'vp_help_reorders', { issue_id: issue.id, before_ids: before, after_ids: after,
    reason: 'By how often each step fixed it: ' + why });
  return log;
}

/* GET /help/content?brand=venueplay&audience=patron : the words for one Help panel. Never the
   counts, never a hidden item, never anything else's. */
async function helpPublicContent(request, env, json) {
  const url = new URL(request.url);
  const brand = url.searchParams.get('brand') || '', audience = url.searchParams.get('audience') || '';
  if (!helpAudienceOk(brand, audience)) return json({ error: 'Which help is this?' }, 400);
  const set = 'brand=eq.' + brand + '&audience=eq.' + audience + '&hidden=eq.false';
  const faq = await vpaSelect(env, 'vp_help_faq', set + '&select=question,answer&order=position.asc,id.asc&limit=200');
  const issues = await vpaSelect(env, 'vp_help_issues', set + '&select=id,title&order=position.asc,id.asc&limit=50');
  let steps = [];
  if (issues && issues.length) {
    steps = await vpaSelect(env, 'vp_help_steps', 'issue_id=in.(' + issues.map((i) => i.id).join(',') +
      ')&hidden=eq.false&select=id,issue_id,body&order=position.asc,id.asc&limit=500');
  }
  return json({
    turnstile: env.TURNSTILE_SITEKEY || null,
    faq: (faq || []).map((f) => ({ q: f.question, a: f.answer })),
    issues: (issues || []).map((i) => ({ id: i.id, title: i.title,
      steps: (steps || []).filter((s) => s.issue_id === i.id).map((s) => ({ id: s.id, body: s.body })) })),
  });
}

/* POST /help/triage {brand, issue_id, step_id?, kind, device} : one answer on a Help panel.
   Stores what happened and nothing about who. The counts it moves decide the order, so it is
   limited per network and per device, and it only counts a step that belongs to that issue. */
/* The proof a device opened an issue: handed out by its "start", needed by every answer after it.
   Keyed to device, issue and day with a server secret, so it cannot be made up, cannot be moved to
   another issue, and lapses overnight (yesterday's still counts, for a night that crosses midnight). */
async function helpTriageProof(env, device, issueId, day) {
  return (await helpSha256Hex((env.HELP_TRIAGE_SECRET || env.SUPABASE_SERVICE_KEY || 'vp-help') + '|tri|' + device + '|' + issueId + '|' + day)).slice(0, 32);
}
function helpYesterday() { return new Date(Date.now() - 86400000).toISOString().slice(0, 10); }
async function helpTriageEvent(request, env, json) {
  const ip = request.headers.get('cf-connecting-ip') || '';
  if (!(await helpIpLimit(env, 'tri', ip, HELP_TRIAGE_MAX_PER_IP, 3600))) return json({ ok: true, throttled: true });
  const _b = await vpaBody(request, json);
  if (!_b.ok) return _b.res;
  const b = _b.body;
  const device = helpLine(b.device, 64);
  // A device id is what makes "once per device" mean anything, so an answer without one is not counted.
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(device)) return json({ error: 'device?' }, 400);
  if (!(await helpLimit(env, 'tri:dev:' + device, HELP_TRIAGE_MAX_PER_DEVICE, 600))) return json({ ok: true, throttled: true });
  if (['start', 'fixed', 'not_fixed'].indexOf(b.kind) < 0) return json({ error: 'kind?' }, 400);
  if (!HELP_UUID.test(String(b.issue_id || ''))) return json({ error: 'issue?' }, 400);
  const ir = await vpaSelect(env, 'vp_help_issues', 'id=eq.' + encodeURIComponent(b.issue_id) + '&select=*&limit=1');
  const issue = ir && ir[0];
  if (!issue || issue.brand !== b.brand) return json({ error: 'issue?' }, 404);
  const day = helpDayKey();
  if (b.kind === 'start') {
    const proof = await helpTriageProof(env, device, issue.id, day);
    // Counted once per device per issue per day; the proof comes back every time.
    if (await helpLimit(env, 'tri:start:' + device + ':' + issue.id + ':' + day, 1, 2 * 86400)) {
      await vpaInsert(env, 'vp_help_triage_events', { brand: issue.brand, issue_id: issue.id, step_id: null, kind: 'start' }, false);
    }
    return json({ ok: true, proof: proof });
  }
  // An answer only counts from a device that opened this issue, today (or last night).
  const pr = String(b.proof || '');
  if (!pr || (pr !== await helpTriageProof(env, device, issue.id, day) && pr !== await helpTriageProof(env, device, issue.id, helpYesterday()))) {
    return json({ ok: true, counted: false, why: 'not opened' }, 403);
  }
  let step = null;
  {
    if (!HELP_UUID.test(String(b.step_id || ''))) return json({ error: 'step?' }, 400);
    const sr = await vpaSelect(env, 'vp_help_steps', 'id=eq.' + encodeURIComponent(b.step_id) + '&issue_id=eq.' + encodeURIComponent(issue.id) + '&select=*&limit=1');
    step = sr && sr[0];
    if (!step) return json({ error: 'step?' }, 404);
  }
  // Each step's answer counts once per device per day: tapping "Still not working" twenty times is one answer.
  if (!(await helpLimit(env, 'tri:ans:' + device + ':' + step.id + ':' + day, 1, 2 * 86400))) return json({ ok: true, counted: false });
  await vpaInsert(env, 'vp_help_triage_events', { brand: issue.brand, issue_id: issue.id, step_id: step.id, kind: b.kind }, false);
  if (step) {
    /* Read, add, write. Two answers to the same step in the same instant can lose one count; for
       a number that only has to be roughly right to order three steps, that is fine. */
    await vpaPatch(env, 'vp_help_steps', 'id=eq.' + encodeURIComponent(step.id),
      { tries: (step.tries || 0) + 1, fixes: (step.fixes || 0) + (b.kind === 'fixed' ? 1 : 0) });
    try { await helpMaybeReorder(env, issue); } catch (e) { /* the answer is kept either way */ }
  }
  return json({ ok: true });
}

/* The issue a form was sent from, checked against the database: its title becomes the subject
   and its category the ticket's, so a page cannot pick a category the issue does not have. */
async function helpIssueFor(env, issueId, brand) {
  if (!HELP_UUID.test(String(issueId || ''))) return null;
  const r = await vpaSelect(env, 'vp_help_issues', 'id=eq.' + encodeURIComponent(issueId) + '&select=id,brand,audience,title,category&limit=1');
  const i = r && r[0];
  return i && i.brand === brand ? i : null;
}
async function helpNoteTicketFromIssue(env, issue) {
  if (!issue) return;
  try { await vpaInsert(env, 'vp_help_triage_events', { brand: issue.brand, issue_id: issue.id, step_id: null, kind: 'ticket' }, false); } catch (e) {}
}

/* ------------------------------ HQ: the editor ------------------------------ */
async function helpAdminContentGet(request, env, json) {
  const g = await helpAdmin(request, env, json); if (g.res) return g.res;
  const brand = g.body.brand, audience = g.body.audience;
  if (!helpAudienceOk(brand, audience)) return json({ error: 'Pick a brand and who it is for.' }, 400);
  const set = 'brand=eq.' + brand + '&audience=eq.' + audience;
  const faq = await vpaSelect(env, 'vp_help_faq', set + '&select=*&order=position.asc,id.asc&limit=500');
  const issues = await vpaSelect(env, 'vp_help_issues', set + '&select=*&order=position.asc,id.asc&limit=200');
  const ids = (issues || []).map((i) => i.id);
  let steps = [], log = [];
  if (ids.length) {
    steps = await vpaSelect(env, 'vp_help_steps', 'issue_id=in.(' + ids.join(',') + ')&select=*&order=position.asc,id.asc&limit=2000');
    log = await vpaSelect(env, 'vp_help_reorders', 'issue_id=in.(' + ids.join(',') + ')&select=*&order=created_at.desc,id.desc&limit=40');
  }
  return json({
    faq: faq || [],
    issues: (issues || []).map((i) => Object.assign({}, i, { steps: (steps || []).filter((s) => s.issue_id === i.id)
      .map((s) => Object.assign({}, s, { rate: s.tries ? Math.round(1000 * helpRate(s)) / 10 : null, flagged: helpFlagged(s) })) })),
    reorders: log || [],
    rules: { min_tries: HELP_REORDER_MIN_TRIES, flag_tries: HELP_FLAG_TRIES, flag_rate: HELP_FLAG_RATE },
  });
}

/* Add or change one FAQ item, issue or step. A new one goes to the end of its list. */
async function helpAdminContentSave(request, env, json) {
  const g = await helpAdmin(request, env, json); if (g.res) return g.res;
  const b = g.body, who = g.admin.label, now = helpNow();
  const T = { faq: 'vp_help_faq', issue: 'vp_help_issues', step: 'vp_help_steps' }[b.kind];
  if (!T) return json({ error: 'What are you saving?' }, 400);
  const row = { updated_at: now, updated_by: who };
  if (b.hidden !== undefined) row.hidden = !!b.hidden;
  if (b.kind === 'faq') {
    if (b.question !== undefined) row.question = helpLine(b.question, 300);
    if (b.answer !== undefined) row.answer = helpText(b.answer).slice(0, 3000);
    if (row.question === '' || row.answer === '') return json({ error: 'A question needs words and an answer.' }, 400);
  } else if (b.kind === 'issue') {
    if (b.title !== undefined) row.title = helpLine(b.title, 120);
    if (row.title === '') return json({ error: 'Give the issue a name.' }, 400);
    if (b.category !== undefined) { if (HELP_CATEGORIES.indexOf(b.category) < 0) return json({ error: 'That is not one of the kinds.' }, 400); row.category = b.category; }
    if (b.auto_order !== undefined) row.auto_order = !!b.auto_order;
  } else {
    if (b.body !== undefined) row.body = helpLine(b.body, 300);
    if (row.body === '') return json({ error: 'A step needs words.' }, 400);
    if (b.pinned !== undefined) row.pinned = !!b.pinned;
  }
  if (b.id) {
    if (!HELP_UUID.test(String(b.id))) return json({ error: 'Which one?' }, 400);
    const ex = await vpaSelect(env, T, 'id=eq.' + encodeURIComponent(b.id) + '&select=id&limit=1');
    if (!ex || !ex.length) return json({ error: 'That is not there any more.' }, 404);
    await vpaPatch(env, T, 'id=eq.' + encodeURIComponent(b.id), row);
    return json({ ok: true, id: b.id });
  }
  // New: everything it needs, at the end of its list.
  let siblings;
  if (b.kind === 'step') {
    if (!HELP_UUID.test(String(b.issue_id || ''))) return json({ error: 'Which issue is the step for?' }, 400);
    const ir = await vpaSelect(env, 'vp_help_issues', 'id=eq.' + encodeURIComponent(b.issue_id) + '&select=id&limit=1');
    if (!ir || !ir.length) return json({ error: 'That issue is not there any more.' }, 404);
    if (!row.body) return json({ error: 'A step needs words.' }, 400);
    row.issue_id = b.issue_id;
    siblings = await vpaSelect(env, T, 'issue_id=eq.' + encodeURIComponent(b.issue_id) + '&select=position&order=position.desc&limit=1');
  } else {
    if (!helpAudienceOk(b.brand, b.audience)) return json({ error: 'Pick a brand and who it is for.' }, 400);
    if (b.kind === 'faq' && (!row.question || !row.answer)) return json({ error: 'A question needs words and an answer.' }, 400);
    if (b.kind === 'issue' && !row.title) return json({ error: 'Give the issue a name.' }, 400);
    row.brand = b.brand; row.audience = b.audience;
    siblings = await vpaSelect(env, T, 'brand=eq.' + b.brand + '&audience=eq.' + b.audience + '&select=position&order=position.desc&limit=1');
  }
  row.position = ((siblings && siblings[0] && siblings[0].position) || 0) + 10;
  if (row.hidden === undefined) row.hidden = false;
  if (b.kind === 'step') { if (row.pinned === undefined) row.pinned = false; row.tries = 0; row.fixes = 0; }
  if (b.kind === 'issue') { if (row.auto_order === undefined) row.auto_order = true; if (!row.category) row.category = 'general'; }
  const made = await vpaInsert(env, T, row);
  return json({ ok: true, id: made && made.id });
}

/* Move one item up or down its list: swaps places with its neighbour. */
async function helpAdminContentMove(request, env, json) {
  const g = await helpAdmin(request, env, json); if (g.res) return g.res;
  const b = g.body;
  const T = { faq: 'vp_help_faq', issue: 'vp_help_issues', step: 'vp_help_steps' }[b.kind];
  if (!T || !HELP_UUID.test(String(b.id || '')) || (b.dir !== 'up' && b.dir !== 'down')) return json({ error: 'Move what, which way?' }, 400);
  const r = await vpaSelect(env, T, 'id=eq.' + encodeURIComponent(b.id) + '&select=*&limit=1');
  const me = r && r[0];
  if (!me) return json({ error: 'That is not there any more.' }, 404);
  const set = b.kind === 'step' ? 'issue_id=eq.' + encodeURIComponent(me.issue_id) : 'brand=eq.' + me.brand + '&audience=eq.' + me.audience;
  const all = await vpaSelect(env, T, set + '&select=id,position&order=position.asc,id.asc&limit=2000');
  const i = all.findIndex((x) => x.id === me.id), j = b.dir === 'up' ? i - 1 : i + 1;
  if (j < 0 || j >= all.length) return json({ ok: true, unchanged: true });
  // Renumber the whole list first, so two items that share a position still swap cleanly.
  const order = all.map((x) => x.id); const t = order[i]; order[i] = order[j]; order[j] = t;
  for (let k = 0; k < order.length; k++) {
    const want = (k + 1) * 10, was = all.find((x) => x.id === order[k]).position;
    if (want !== was) await vpaPatch(env, T, 'id=eq.' + encodeURIComponent(order[k]), { position: want, updated_at: helpNow(), updated_by: g.admin.label });
  }
  return json({ ok: true });
}

/* UNDO an automatic reorder: the steps go back where they were, and the issue stops reordering on
   its own until HQ switches it back on, or the next answer would just do it again. */
async function helpAdminReorderUndo(request, env, json) {
  const g = await helpAdmin(request, env, json); if (g.res) return g.res;
  if (!HELP_UUID.test(String(g.body.id || ''))) return json({ error: 'Which change?' }, 400);
  const r = await vpaSelect(env, 'vp_help_reorders', 'id=eq.' + encodeURIComponent(g.body.id) + '&select=*&limit=1');
  const log = r && r[0];
  if (!log) return json({ error: 'That change is not there any more.' }, 404);
  if (log.undone_at) return json({ error: 'That change was already undone.' }, 409);
  const steps = await helpIssueSteps(env, log.issue_id, true);
  const byId = {}; steps.forEach((s) => { byId[s.id] = s; });
  const ids = (log.before_ids || []).filter((id) => byId[id]);
  const slots = ids.map((id) => byId[id].position).sort((a, b) => a - b);
  for (let k = 0; k < ids.length; k++) {
    if (byId[ids[k]].position !== slots[k]) await vpaPatch(env, 'vp_help_steps', 'id=eq.' + encodeURIComponent(ids[k]), { position: slots[k] });
  }
  await vpaPatch(env, 'vp_help_reorders', 'id=eq.' + encodeURIComponent(log.id), { undone_at: helpNow(), undone_by: g.admin.label });
  await vpaPatch(env, 'vp_help_issues', 'id=eq.' + encodeURIComponent(log.issue_id), { auto_order: false, updated_at: helpNow(), updated_by: g.admin.label });
  return json({ ok: true, auto_order: false });
}

/* THE TRIAGE REPORT, pure like helpReport. Per issue: how many picked it, how many were sorted
   without a ticket and by which step, how many went on to send one, and how many just left. */
function helpTriageReport(events, issues, steps) {
  const byIssue = {};
  issues.forEach((i) => { byIssue[i.id] = { issue_id: i.id, title: i.title, brand: i.brand, audience: i.audience, started: 0, solved: 0, tickets: 0, left: 0, by_step: {} }; });
  const stepBody = {}; steps.forEach((s) => { stepBody[s.id] = s.body; });
  events.forEach((e) => {
    const r = byIssue[e.issue_id]; if (!r) return;
    if (e.kind === 'start') r.started++;
    else if (e.kind === 'ticket') r.tickets++;
    else if (e.kind === 'fixed') { r.solved++; const k = stepBody[e.step_id] || '(a step since removed)'; r.by_step[k] = (r.by_step[k] || 0) + 1; }
  });
  return Object.keys(byIssue).map((k) => byIssue[k]).filter((r) => r.started || r.solved || r.tickets)
    .map((r) => Object.assign(r, { left: Math.max(0, r.started - r.solved - r.tickets) }))
    .sort((a, b) => b.started - a.started || a.title.localeCompare(b.title));
}
async function helpTriageForRange(env, from, to, brand) {
  const q = 'and=(created_at.gte.' + encodeURIComponent(from) + ',created_at.lte.' + encodeURIComponent(to) + ')' +
    (HELP_BRANDS.indexOf(brand) >= 0 ? '&brand=eq.' + brand : '') + '&select=issue_id,step_id,kind';
  const events = await vpaSelectAll(env, 'vp_help_triage_events', q + '&order=created_at.asc,id.asc');
  const ids = events.map((e) => e.issue_id).filter((x, i, a) => a.indexOf(x) === i);
  if (!ids.length) return [];
  const issues = await vpaSelect(env, 'vp_help_issues', 'id=in.(' + ids.join(',') + ')&select=id,title,brand,audience');
  const steps = await vpaSelect(env, 'vp_help_steps', 'issue_id=in.(' + ids.join(',') + ')&select=id,body&limit=2000');
  return helpTriageReport(events, issues || [], steps || []);
}
