/* The only file that changes between environments.
 *
 * Everything else reads from here, so switching the API address or dropping in
 * the Supabase key is one edit rather than six. Six copies of a URL is six
 * chances for one of them to be wrong, and the one that is wrong is always the
 * page you did not test.
 *
 * Nothing secret lives here. The Supabase anon key is public by design: it is in
 * every browser that loads the site, and the tables it can reach are locked by
 * row level security with no policies, so it can read nothing. The service key,
 * the Stripe keys and the admin key live in the Worker and never come near this.
 */
(function (root) {
  'use strict';

  var host = root.location ? root.location.hostname : '';
  var isProd = /(^|\.)partyplay\.com\.au$/.test(host);

  root.PPConfig = {
    /* The Worker. On the real domain it answers on its own subdomain; anywhere
       else (a pages.dev preview, or localhost) it is the workers.dev address, so
       a preview build is never quietly talking to production.

       The workers.dev subdomain is dean-tindale, NOT gflam. It is per Cloudflare
       ACCOUNT, not per project, which is why VenuePlay's two Workers use the same
       one. Check an existing Worker rather than guessing from the business name:
       guessing is how this was wrong the first time. */
    /* ONE address for now, on purpose.
       api.partyplay.com.au has no DNS record: the Worker custom domain has not
       been added yet, so a browser on partyplay.com.au had nowhere to send the
       request and checkout failed on the live site while working on previews.
       The workers.dev address is the Worker's own and always exists.

       TO SWITCH LATER: add api.partyplay.com.au under the Worker's Domains and
       Routes, confirm https://api.partyplay.com.au/health answers, then restore
       the split below. Not before: a split that points half the traffic at a
       name that does not resolve is worse than no split at all.

         API: isProd ? 'https://api.partyplay.com.au'
                     : 'https://partyplay-api.dean-tindale.workers.dev', */
    API: 'https://partyplay-api.dean-tindale.workers.dev',

    /* THE URL AND THE KEY HAVE TO BE FROM THE SAME PROJECT, and for a while they were not.

       The Sydney move on 12 Sep rewrote SUPA_URL here and updated VenuePlay's publishable
       key, and missed this one. So the URL said Sydney and the key still belonged to
       SINGAPORE, and Supabase answered every browser request with 401 "This API key might
       also be owned by another Supabase project".

       That is the WHOLE GAME on PartyPlay. The host console, the television and every
       guest's phone talk over one realtime channel and nothing else: a host pressing Call a
       number reached nobody, and no phone could join a room. The Worker was fine throughout,
       because it uses the SERVICE key from its own environment, so /health said ok and the
       licence emails went out. The gate was green. Nothing anywhere would have said a word.

       It stayed invisible because play.html printed "You are in. Watch the big screen."
       before it ever tried to connect, and swallowed the failure. Both are fixed; this is
       the cause and that was the reason nobody would have found it.

       Checked, not assumed: this key returns 200 on Sydney and the old one returns 200 on
       Singapore. release-check now asks Supabase directly, on every run. Found 12 Sep 2026. */
    SUPA_URL:  'https://ijkzgmdtwtgfkedqspxm.supabase.co',
    SUPA_ANON: 'sb_publishable_9v83FWCSt7Di-jkgTvsMJQ_f6lJPovb',

    /* Realtime channel name. One place, because the host console, the television
       and every phone have to agree on it exactly or the night silently does
       nothing at all. */
    channel: function (code) { return 'pp-' + String(code || '').toUpperCase(); }
  };
}(typeof globalThis !== 'undefined' ? globalThis : this));
