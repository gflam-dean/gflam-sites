-- VenuePlay migration 49: a per-venue switch to ENFORCE broadcast-message signatures.
--
-- Companion to migration 38 (vp_venue_signing_keys). Signing is rolled out in phases so a mistake
-- can never black out every TV at once:
--   Phase 2 (enforce = false, the default): the host SIGNS every broadcast and screens VERIFY, but
--            an unsigned or bad message is still rendered and only logged. Nothing changes for a
--            real venue; we confirm in the logs that good signatures are arriving.
--   Phase 3 (enforce = true): screens DROP anything without a good, fresh signature. This is the
--            moment the hijack hole closes. Flip ONE venue first, watch a real night, then the rest.
--
-- To enforce at one venue:   UPDATE vp_venue_settings SET sign_enforce = true WHERE venue_id = '...';
-- To roll back instantly:    UPDATE vp_venue_settings SET sign_enforce = false WHERE venue_id = '...';
-- A global override also exists in the game Worker (env SIGN_ENFORCE=1) if every venue should flip
-- at once, but the per-venue column is the safe path.
--
-- Safe to run more than once.

ALTER TABLE public.vp_venue_settings
  ADD COLUMN IF NOT EXISTS sign_enforce boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.vp_venue_settings.sign_enforce IS
  'When true, the venue''s TV and player screens drop any broadcast message that does not carry a good, fresh ECDSA signature (see migration 38). Default false = verify-but-log only, so signing can be deployed with no risk before it is enforced. Read by the game Worker at GET /venue/signing/public and returned to the screens.';
