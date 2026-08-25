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
    API: isProd
      ? 'https://api.partyplay.com.au'
      : 'https://partyplay-api.dean-tindale.workers.dev',

    SUPA_URL:  'https://gpoolavkghnxedzrmtmc.supabase.co',
    SUPA_ANON: 'sb_publishable_DqFZOQsLYxrmlHDBLe1kfg_QdQ5DEV0',

    /* Realtime channel name. One place, because the host console, the television
       and every phone have to agree on it exactly or the night silently does
       nothing at all. */
    channel: function (code) { return 'pp-' + String(code || '').toUpperCase(); }
  };
}(typeof globalThis !== 'undefined' ? globalThis : this));
