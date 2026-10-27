/* PARTYPLAY 16: who is allowed to speak on the party channel, and a limit on checkouts.

   The 14 Oct 2026 audit found the realtime channel open to anybody who could read the code on the
   telly: they could speak as the host (a forged "You won", any caption or outside photo on the
   wall) or as any guest (answers, raised hands, a FULL HOUSE in somebody else's name). The fix is
   signatures, made in the browser, and this is where the Worker keeps what it needs to check them.

     pp_licences.sign_kid, sign_public_jwk, sign_private_jwk
         The party's ECDSA P-256 pair. The first host console mints it in the browser (a Worker
         cannot) and hands it over with the host key; the telly and phones fetch only the public
         half. Service role only, like every other column here: RLS on pp_licences has no
         policies, so the public key in the pages reads none of it.
     pp_players.pid
         The fingerprint of each guest phone's own key, given on /join. The console asks the
         Worker which guest a pid is, so a name typed into a message proves nothing.
     pp_licences.checkout_ip
         A keyed hash of the address a checkout came from (never the address), so /checkout can
         refuse a script making hundreds of pending licences and live Stripe sessions.

   RUN THIS BEFORE deploying the Worker that uses it, though the Worker carries on without these
   columns (it just cannot sign, and the checkout limit falls back to memory) so the order is not
   dangerous either way. Safe to run twice. Written 15 Oct 2026. */

alter table pp_licences add column if not exists sign_kid text;
alter table pp_licences add column if not exists sign_public_jwk jsonb;
alter table pp_licences add column if not exists sign_private_jwk jsonb;
alter table pp_licences add column if not exists checkout_ip text;
alter table pp_players  add column if not exists pid text;

-- The checkout limit asks "how many from this address in the last hour".
create index if not exists pp_licences_checkout_ip_idx on pp_licences (checkout_ip, created_at)
  where checkout_ip is not null;

-- One phone key, one guest, per party. The Worker already refuses a pid somebody else holds;
-- this is the same rule where two joins arriving together cannot both get past it.
create unique index if not exists pp_players_licence_pid_idx on pp_players (licence_id, pid)
  where pid is not null;

/* Check it took (five rows):
     select table_name, column_name from information_schema.columns
      where table_name in ('pp_licences','pp_players')
        and column_name in ('sign_kid','sign_public_jwk','sign_private_jwk','checkout_ip','pid');
*/
