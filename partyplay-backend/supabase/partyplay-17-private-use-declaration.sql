/* PARTYPLAY 17: the private-use declaration, kept with the order.

   Both Anisimoff Legal letters (ref 9380, 1 Oct 2026 point 11 and 8 Oct 2026 point 7) accepted
   PartyPlay "based on the current controls including ... declaration for private party use only".
   The terms said private use only, but the buy page never asked and nothing recorded an answer
   (legal compliance matrix, gap 6, 28 Oct 2026). The buy page (/start) now has a required tick
   and the Worker refuses a checkout without it.

     pp_licences.private_use_ack_at
         When the buyer ticked "This is for a private party. It is not for a pub, club, business,
         fundraiser or promotion, and nobody pays to play." Set by POST /checkout on the pending
         row; null on every licence bought before this, and on a comp licence made by hand.
         Service role only, like every other column here (RLS on pp_licences has no policies).

   NOT RUN on 28 Oct 2026 (written on branch fix/legal-gaps-28-oct). Run it BEFORE deploying the
   Worker that writes it. The Worker carries on without the column (the declaration then lives only
   on the Stripe session's metadata, private_use_ack_at), so the order is not dangerous either way.
   Safe to run twice.

   CHECK AFTERWARDS (read-only):
     select column_name, data_type from information_schema.columns
      where table_name = 'pp_licences' and column_name = 'private_use_ack_at';
     -> one row, timestamp with time zone */

alter table pp_licences add column if not exists private_use_ack_at timestamptz;

comment on column pp_licences.private_use_ack_at is
  'When the buyer declared the party private at checkout (not a pub, club, business, fundraiser or promotion; nobody pays to play). Anisimoff Legal 9380, 1 Oct 2026 point 11 and 8 Oct 2026 point 7.';
