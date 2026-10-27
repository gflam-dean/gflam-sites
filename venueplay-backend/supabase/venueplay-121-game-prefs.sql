-- VenuePlay migration 121: every game's setup saved for the VENUE, in one place.
--
-- Dean, 28 Oct 2026: a console's setup choices (musical bingo's theme, pattern, prize, reveal and
-- well-known songs only, to start with) lived in one browser, so a second tablet or next week
-- started from scratch. Trivia's typed columns (migrations 50 and 96) and raffle_template (51) are
-- each one game's shape; a column per setting per game would be a migration per setting.
--
-- 1. vp_venue_settings.game_prefs jsonb, one object keyed by game:
--      { "musical": { "playlist": "80s", "pattern": "corners", ... }, "bingo": {...}, "trivia": {...} }
--    Never paid-or-free for the night, unsold tickets or permits: those are decided each night or
--    live on vp_venues.permits. The game Worker only writes the keys it allows for each game.
-- 2. vp_set_game_prefs(venue, game, prefs): MERGES one game's keys into that game's object and
--    leaves every other game alone. A plain upsert replaces the whole jsonb, so two tablets saving
--    two different games would wipe each other.
-- 3. Service role only: the function is revoked from PUBLIC, anon and authenticated. Writes go
--    through the game Worker's /host/game-prefs (verifyHostJwt + requireStaff), so a Host-role login
--    can save its own setup (a direct vp_venue_settings write is owner or manager only, migration 77).
--
-- Reads: the Worker's GET /host/game-prefs. No new policy; the column sits on a table that already
-- has RLS on and its existing policies. After running, dump RLS-BASELINE.json (one new security
-- definer function). Either order with the Worker is safe: without this the route answers an error
-- and the console keeps using this browser's own choices.
-- Safe to run more than once. Rollback at the bottom.

ALTER TABLE public.vp_venue_settings
  ADD COLUMN IF NOT EXISTS game_prefs jsonb NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vp_venue_settings_game_prefs_shape') THEN
    ALTER TABLE public.vp_venue_settings
      ADD CONSTRAINT vp_venue_settings_game_prefs_shape
      CHECK (jsonb_typeof(game_prefs) = 'object' AND length(game_prefs::text) <= 20000);
  END IF;
END $$;

COMMENT ON COLUMN public.vp_venue_settings.game_prefs IS
  'Each game''s last setup for this venue, keyed by game ("musical", later "bingo", "trivia"). Written only through vp_set_game_prefs by the game Worker (/host/game-prefs), which allows a short list of keys per game. Never paid-or-free, unsold tickets or permits.';

CREATE OR REPLACE FUNCTION public.vp_set_game_prefs(p_venue_id uuid, p_game text, p_prefs jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_out jsonb;
begin
  if p_venue_id is null then raise exception 'venue required'; end if;
  if p_game is null or p_game !~ '^[a-z_]{1,20}$' then raise exception 'bad game'; end if;
  if p_prefs is null or jsonb_typeof(p_prefs) <> 'object' then raise exception 'prefs must be an object'; end if;
  if length(p_prefs::text) > 4000 then raise exception 'prefs too large'; end if;

  insert into public.vp_venue_settings as s (venue_id, game_prefs, updated_at)
  values (p_venue_id, jsonb_build_object(p_game, p_prefs), now())
  on conflict (venue_id) do update
    set game_prefs = jsonb_set(coalesce(s.game_prefs, '{}'::jsonb), array[p_game],
                               coalesce(s.game_prefs -> p_game, '{}'::jsonb) || p_prefs, true),
        updated_at = now()
  returning s.game_prefs into v_out;
  return v_out;
end
$function$;

REVOKE ALL ON FUNCTION public.vp_set_game_prefs(uuid, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.vp_set_game_prefs(uuid, text, jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.vp_set_game_prefs(uuid, text, jsonb) TO service_role;

-- Check after running (read-only):
--   select column_name, data_type, column_default from information_schema.columns
--    where table_name = 'vp_venue_settings' and column_name = 'game_prefs';
--   select has_function_privilege('anon', 'public.vp_set_game_prefs(uuid,text,jsonb)', 'execute');  -- false
--
-- Rollback:
--   DROP FUNCTION IF EXISTS public.vp_set_game_prefs(uuid, text, jsonb);
--   ALTER TABLE public.vp_venue_settings DROP CONSTRAINT IF EXISTS vp_venue_settings_game_prefs_shape;
--   ALTER TABLE public.vp_venue_settings DROP COLUMN IF EXISTS game_prefs;
