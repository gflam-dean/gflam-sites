-- VenuePlay migration 38: a signing key per venue, so a bingo ball can be proved to come from
-- the host.
--
-- THE PROBLEM. Broadcast bingo has no game server by design: the host console is authoritative
-- and everyone meets on a Supabase Realtime channel called vp-<CODE>. CODE is fnvVenueCode(slug),
-- a hash of the venue's PUBLIC slug, and the slug is on the table talkers, the TV and the join
-- link. So the channel name is not a secret and was never meant to be one: anyone who knows a
-- venue exists can work out its channel, subscribe, and broadcast whatever they like into a live
-- game. Balls that were never called, a game that never started, somebody else's win.
--
-- WHY NOT JUST RENAME THE CHANNEL. Because a secret channel name has to reach the room somehow,
-- and every route to the room is public: the printed sign, the join link, and a TV on a Fire
-- Stick booting to a fixed URL. Whatever the phones can discover, an attacker can discover.
--
-- WHAT THIS DOES INSTEAD. The venue gets an ECDSA P-256 keypair. The private half is handed only
-- to a signed-in host (the game Worker checks staff membership first), and the console signs every
-- message it broadcasts. The public half is served to anyone, because it is public: phones and the
-- TV verify each message and drop anything that does not carry a good signature. An attacker can
-- still shout into the channel; nothing in the room will render it.
--
-- Keys are per venue and long-lived. Rotating one is simply deleting the row: the host mints a
-- fresh pair on its next console load, and phones pick up the new public half when they join.
--
-- RLS is on with NO policy, which locks the table to the public and anon keys entirely. Only the
-- game Worker's service role touches it, and it never returns private_jwk to anyone who has not
-- passed the staff check.
--
-- Safe to run more than once.

CREATE TABLE IF NOT EXISTS public.vp_venue_signing_keys (
  venue_id    uuid PRIMARY KEY REFERENCES public.vp_venues(id) ON DELETE CASCADE,
  public_jwk  jsonb NOT NULL,
  private_jwk jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.vp_venue_signing_keys ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.vp_venue_signing_keys IS
  'ECDSA P-256 keypair per venue for signing broadcast-bingo messages. The bingo channel name is derived from the venue''s public slug and is therefore guessable, so authenticity comes from the signature rather than from the channel being secret. private_jwk is released only to a signed-in host who passes the staff check in the game Worker; public_jwk is served to anyone, because verifying is the whole point. Delete a row to rotate: the host mints a new pair on its next load.';

COMMENT ON COLUMN public.vp_venue_signing_keys.private_jwk IS
  'NEVER expose this through PostgREST or any anon-key read. Service role only, and only to a caller who is staff at this venue.';
