-- =====================================================================
-- Migration 49: the switch that makes broadcast signing mean something
-- ---------------------------------------------------------------------
--   ****  RUN THIS *AFTER* PASTING venueplay-game.js, NOT BEFORE.  ****
--
-- Migration 38 created the keypair table. vp-sign.js has been shipping on every
-- TV, phone and host console since, calling three Worker routes that were never
-- written, so every page fell back to "send unsigned / render everything" and
-- the signing was decorative. The routes land with this migration; this adds the
-- per-venue flag that decides whether a screen DROPS an unsigned message or just
-- logs it.
--
-- DEFAULT FALSE ON PURPOSE. Turning this on for a venue whose host console has
-- not yet minted a key would drop every real message and leave the TV on the ad
-- loop all night. The safe order for any venue is:
--
--   1. Paste the Worker, run this migration. Nothing changes for anyone.
--   2. Let a host sign in to that venue's console once. It mints the keypair on
--      first load, so vp_venue_signing_keys gets a row for the venue.
--   3. Watch the browser console on the TV for a night: with enforce off it logs
--      "[VPSign] bad signature, rendered (enforce off)" if anything is wrong.
--   4. Only then: update vp_venues set broadcast_enforce = true where slug = '...'
--
-- Check step 2 before step 4, per venue:
--   select v.slug, (k.venue_id is not null) as has_key, v.broadcast_enforce
--   from vp_venues v left join vp_venue_signing_keys k on k.venue_id = v.id
--   order by v.slug;
--
-- The screen ALSO fails open when it holds no public key, whatever this flag
-- says, so a venue that somehow loses its key degrades to today's behaviour
-- rather than to a black screen. That belt-and-braces is deliberate: a dark TV
-- in a full pub costs more than the spoofing this guards against.
--
-- Safe to run more than once.

ALTER TABLE public.vp_venues
  ADD COLUMN IF NOT EXISTS broadcast_enforce boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.vp_venues.broadcast_enforce IS
  'When true, this venue''s TVs and phones DROP any broadcast message that does not carry a good, fresh ECDSA signature from the venue key (vp_venue_signing_keys). False (the default) still verifies and logs, but renders everything, which is the behaviour from before signing existed. Only turn it on once the venue has a key row and a night has been watched with it off.';
