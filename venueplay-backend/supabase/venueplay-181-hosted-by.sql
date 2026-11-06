-- VenuePlay migration 181: "Hosted by" on the TV, with the host's own logo.
--
-- Dean, 6 Nov 2026 (INBOX 120): a venue's trivia host, or their trivia company, can show "Hosted by <name>" and
-- their logo on the TV during the nights they run. Many pubs already have a host they love; the host runs the
-- night on venueplay and the room sees whose night it is.
--
-- TWO THINGS, one per question:
--
--   WHAT the card says belongs to the HOST'S LOGIN, so it follows them to every venue they run, on any account:
--     vp_host_brands (one row per login): name (1 to 40 characters) and logo_url (our own public storage, the
--     venue-logos bucket the venue logo already uses, under hosts/<login>/). Written only by the billing Worker
--     (/account/hosted-by-save and /account/hosted-by-logo, an owner or a manager allowed to add hosts, for a
--     host on one of their own venues). Row security on and NO policy, so the service role is the only reader
--     and writer: no anon or signed-in grant, nothing for a page to read or change directly.
--
--   WHETHER it shows is the VENUE'S choice, per venue and per game, on the host's own staff row there:
--     vp_venue_staff.hosted_by jsonb, e.g. {"trivia": true, "musical": false}. Null means off everywhere. Each
--     owner switches it for their own TV only; a host on two accounts' venues has one card and two switches.
--     The existing staff policies are unchanged: a signed-in host can already SELECT the staff rows of their
--     own venues (vp_venue_staff_host_select) and can update none, so the switch is the owner's to set.
--
-- The game Worker reads both at /host/hosted-by for the signed-in host at the venue they are running, and the
-- console carries the answer to the TV. RLS-BASELINE.json gains ONE table (vp_host_brands, RLS on, no policy,
-- grants revoked): after running, rerun venueplay-backend/tools/dump-rls-baseline.py and commit it.
--
-- Either order with the Workers and the site: before this runs, /host/hosted-by answers "nothing to show" (the
-- column and the table are missing and the read is caught), the TV shows no line, and the Account page says the
-- feature is not switched on yet if an owner tries to save. NUMBER: 177 to 180 are taken, so 181. Branch
-- fix/hosted-by-12nov. NOT RUN. Read-back and rollback at the bottom. Safe to run more than once.

CREATE TABLE IF NOT EXISTS public.vp_host_brands (
  auth_user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name         text NOT NULL,
  logo_url     text,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   uuid
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vp_host_brands_name_len') THEN
    ALTER TABLE public.vp_host_brands
      ADD CONSTRAINT vp_host_brands_name_len CHECK (char_length(btrim(name)) BETWEEN 1 AND 40);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vp_host_brands_logo_len') THEN
    ALTER TABLE public.vp_host_brands
      ADD CONSTRAINT vp_host_brands_logo_len CHECK (logo_url IS NULL OR char_length(logo_url) <= 500);
  END IF;
END $$;

ALTER TABLE public.vp_host_brands ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.vp_host_brands FROM anon, authenticated;

COMMENT ON TABLE public.vp_host_brands IS
  'Hosted by card per host login (INBOX 120): the name and logo the TV shows during their games. Service role only, written by the billing Worker.';

ALTER TABLE public.vp_venue_staff
  ADD COLUMN IF NOT EXISTS hosted_by jsonb;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vp_venue_staff_hosted_by_shape') THEN
    ALTER TABLE public.vp_venue_staff
      ADD CONSTRAINT vp_venue_staff_hosted_by_shape
      CHECK (hosted_by IS NULL OR (jsonb_typeof(hosted_by) = 'object' AND length(hosted_by::text) <= 200));
  END IF;
END $$;

COMMENT ON COLUMN public.vp_venue_staff.hosted_by IS
  'Show this host''s Hosted by card on this venue''s TV, per game: {"trivia": bool, "musical": bool}. Null is off. Set by the venue owner (billing Worker).';

-- Check after running (read-only):
--   select relname, relrowsecurity from pg_class where relname = 'vp_host_brands';
--   select grantee, privilege_type from information_schema.role_table_grants
--    where table_name = 'vp_host_brands' and grantee in ('anon', 'authenticated');   -- expect no rows
--   select column_name, data_type from information_schema.columns
--    where table_name = 'vp_venue_staff' and column_name = 'hosted_by';
--
-- Rollback:
--   ALTER TABLE public.vp_venue_staff DROP CONSTRAINT IF EXISTS vp_venue_staff_hosted_by_shape;
--   ALTER TABLE public.vp_venue_staff DROP COLUMN IF EXISTS hosted_by;
--   DROP TABLE IF EXISTS public.vp_host_brands;
