-- =====================================================================
-- Migration 48: stop the public key listing every venue
-- ---------------------------------------------------------------------
--   ****  RUN THIS *AFTER* PASTING venueplay-game.js, NOT BEFORE.  ****
--
-- The TV and the four game screens read vp_venue_screen with the public key.
-- This migration takes that away, and the Worker's new GET /screen?venue=<slug>
-- replaces it. Run this first and every venue TV loses its slides and its logo
-- until the Worker lands. Run it after and nothing changes for anybody.
--
-- WHY
--
-- Confirmed live on 20 Aug 2026 with nothing but the anon key printed in every
-- page: one request with NO slug filter returned every venue's slug, id and
-- advertising URLs. That is the platform's entire customer list, and it is the
-- first step in a chain, because the slug is what the realtime channel name is
-- hashed from and what resolves to a live game's join code.
--
-- Migration 46 tried to fix this with an RLS policy requiring a slug filter,
-- using current_setting('request.query'). That does not work: PostgREST does
-- not expose the query string that way, so the policy passed everything. It was
-- verified afterwards and found still open, which is the whole argument for
-- checking rather than assuming.
--
-- WHAT CHANGES FOR A VENUE: nothing. Same /tv?venue=slug link, still public,
-- still no login, still nothing to touch on the Fire Stick. A stranger who
-- already knows a slug can still fetch that one venue's screen through the
-- Worker, which is no more than they would see by walking into the bar. What
-- they can no longer do is ask for the list of all of them.
-- =====================================================================

-- The failed policy from 46 goes; nothing anonymous reads this table now.
drop policy if exists vp_venue_screen_anon_read on vp_venue_screen;
revoke all on vp_venue_screen from anon, authenticated;

-- Same for the members-draw board view, which was also unscoped and disclosed
-- every venue's draw nights and CURRENT JACKPOT. The TV gets it from /screen.
revoke all on v_vp_screen_draws from anon, authenticated;

-- The Worker reads both with the service key, which is unaffected by grants.

-- Check afterwards, as anon. The first two should return nothing or an error,
-- and the third should still work, because that is how the TV now asks:
--   select * from vp_venue_screen;                  -- denied
--   select * from v_vp_screen_draws;                -- denied
--   curl '.../screen?venue=the-mini-bar'            -- one venue, as before
--
-- Still open after this, and tracked separately: realtime broadcast is
-- unauthenticated, so anyone who knows a slug can still join that venue's
-- channel and send on it. Closing enumeration raises the effort; it does not
-- close that hole. Migration 38 designed the fix and it has never been built.
