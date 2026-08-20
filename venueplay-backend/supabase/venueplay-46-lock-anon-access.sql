-- =====================================================================
-- Migration 46: close four things the public key can reach that it should not
-- ---------------------------------------------------------------------
-- Found by a security break-test on 20 Aug 2026, all CONFIRMED against the
-- live database with nothing but the anon key that is printed in every page.
-- Run this one first: two of the four are one statement each and one of them
-- is a mass PII exposure the day a single player ticks the marketing box.
-- =====================================================================


-- 1. THE OPT-IN EXPORT VIEW IS READABLE BY ANYONE.  ** DO THIS ONE FIRST **
-- ---------------------------------------------------------------------
-- vp_players is correctly locked (anon gets 42501, permission denied). The VIEW
-- over it is not: it returns 200 and an empty array, and resolves column names,
-- which proves anon holds SELECT and the view reads past RLS as its definer.
--
-- It is empty ONLY because nobody has opted in yet. On the first opt-in it
-- becomes every opted-in player's first name, last name, email, mobile and
-- postcode, for every venue, downloadable by anyone. The migration that created
-- it says "NOT granted to anon/authenticated" -- that turned out not to be true
-- of the live database, which is the whole reason to check rather than assume.
--
-- Only the account Worker reads this, with the service key, which is unaffected
-- by revoking anon: service_role bypasses grants.
revoke all on v_vp_player_optins from anon, authenticated;

-- Same treatment for the members-draw board view, for a different reason: it is
-- unscoped, so it hands over every venue's draw names, nights and CURRENT
-- JACKPOT in one request. tv.html only ever needs one venue's row and always
-- filters by slug, so requiring the filter costs the product nothing.
-- Kept readable (the TV is anonymous by design) but no longer enumerable.
alter view v_vp_screen_draws set (security_invoker = on);


-- 2. A SECURITY DEFINER FUNCTION ANY STRANGER CAN CALL
-- ---------------------------------------------------------------------
-- vp_park_flagged is SECURITY DEFINER and writes vp_questions, the SHARED bank
-- every venue plays from. Called anonymously it returned 25006 (cannot execute
-- UPDATE in a read-only transaction) rather than 42501 -- the privilege check
-- PASSED and the body ran as far as its UPDATE. A POST runs read-write.
-- min_venues is the caller's own argument, so 0 parks every flagged question.
--
-- Migration 32 tried to prevent this with REVOKE ... FROM public, which does
-- not remove the explicit grants Supabase gives anon and authenticated. It has
-- to name them. This is a platform-wide pattern worth checking on every
-- function we own, not just this one.
revoke all on function vp_park_flagged(integer) from public, anon, authenticated;

-- The game-state functions, same problem. vp_emit_event writes the authoritative
-- session event log and bumps state_version; vp_draw_next_ball is the server-side
-- ball draw that the OLGR RNG submission rests on. Both answered 25006 / [] to an
-- anonymous caller rather than refusing. Both are only ever called by the game
-- Worker with the service key.
revoke all on function vp_emit_event(uuid, text, jsonb, text) from public, anon, authenticated;
revoke all on function vp_draw_next_ball(uuid) from public, anon, authenticated;


-- 3. THE VENUE LIST IS PUBLIC
-- ---------------------------------------------------------------------
-- vp_venue_screen has RLS "USING (true)" plus GRANT SELECT to anon and no
-- required filter, so one request returns every venue's slug, id and advertising
-- URLs. That is the platform's whole customer list, and it is the key that
-- unlocks the rest: slug -> channel code -> live join codes.
--
-- The TV always asks for exactly one slug, so require one. A query with no slug
-- filter now returns nothing instead of everything.
drop policy if exists vp_venue_screen_anon_read on vp_venue_screen;
create policy vp_venue_screen_anon_read on vp_venue_screen
  for select to anon, authenticated
  using (
    -- PostgREST puts the request's query string here; a read must name a slug.
    coalesce(current_setting('request.query', true), '') like '%slug=%'
  );


-- 4. WHAT THIS DOES NOT FIX
-- ---------------------------------------------------------------------
-- Two findings need code, not SQL, and are tracked separately:
--
--  * Realtime broadcast is unauthenticated. Channels are named from a hash of
--    the public slug and are created without private:true, so anyone can join
--    a venue's channel AND send on it: fake balls, a fake winner, on the venue
--    TV and every phone mid-game. Migration 38 designed the ECDSA fix and the
--    code was never written. Until it is, this is the biggest hole in the
--    product and it matters for the gaming submission, not just for security.
--
--  * POST /capture and POST /report authorise on the venue code alone, which is
--    derivable from the public slug. Anyone can write a forged marketing-consent
--    record into a venue's list, complete with a consent timestamp. That is a
--    Spam Act problem for the venue, not just spam.
--
-- Check afterwards. Each of these should now be a permission error, not a result:
--   select * from v_vp_player_optins limit 1;                 -- as anon: denied
--   select vp_park_flagged(0);                                -- as anon: denied
--   select * from vp_venue_screen limit 1;                    -- as anon: no rows
--   select * from vp_venue_screen where slug = 'the-mini-bar';-- as anon: one row
