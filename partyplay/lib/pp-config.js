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
    /* The Worker, on its own name on our domain: api.partyplay.com.au, a custom domain on the
       partyplay-api Worker (live 31 Oct 2026, /health answers there). ONE address everywhere.

       Dean, 31 Oct 2026: "Don't put any .dev links into anything marketing or website or email
       customer facing." The Worker's old Cloudflare address still answers, so a page cached
       before this change keeps working, but nothing served here names it.

       There used to be a split here (this address on partyplay.com.au, the Cloudflare one
       anywhere else) so a preview "never quietly talked to production". Both names are the
       SAME Worker, so the split never did that, and a preview origin is refused by the
       Worker's CORS anyway (allowedOrigin). One address is the honest version. */
    API: 'https://api.partyplay.com.au',

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
    channel: function (code) { return 'pp-' + this.code(code); },

    /* The party code the way the Worker files it (normaliseCode in the Worker, which
       must stay identical). The Worker let "abs 3km" and "AB53KM" join ABS3KM, and every
       page then built its channel from what the guest typed, so they were in the party
       and heard nothing of it. Audit, 27 Sep 2026. */
    code: function (input) {
      return String(input || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
        .replace(/5/g, 'S').replace(/2/g, 'Z');
    },

    /* Could this be a party code at all? Six characters from the Worker's alphabet (CODE_RE in the
       Worker, which a suite holds to this). The telly used to take anything: /tv?code=<b>x put
       "BX" up as the join code, because the Worker answered 400 and only a 404 took the lobby
       down (14 Oct 2026 audit). */
    valid: function (input) {
      return /^[ACDEFGHJKMNPQRSTUVWXYZ34679]{6}$/.test(this.code(input));
    }
  };
}(typeof globalThis !== 'undefined' ? globalThis : this));
