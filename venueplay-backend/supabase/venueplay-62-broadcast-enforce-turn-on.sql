-- =====================================================================
-- Migration 62: actually turn broadcast signing on, one venue at a time
-- ---------------------------------------------------------------------
-- Nothing here changes any schema. It is the switch-flipping session that
-- migrations 55 and 56 set up and nobody has run yet.
--
-- WHERE THINGS STAND. /health on venueplay-game answers:
--
--     "broadcast_signing": { "venues": 19, "with_a_key": 9, "enforcing": 0 }
--
-- So the feature is fully built, nine venues have minted a keypair, and not one
-- of them drops a forged message. Every screen still renders anything that
-- arrives on the channel, which is the behaviour from before signing existed.
--
-- WHY IT IS NOT JUST "UPDATE EVERYTHING". Turning this on for a venue whose host
-- console has never minted a key would drop every real message and leave the TV
-- on the ad loop all night, in front of a full pub. That is why the default is
-- false and why this is a per-venue decision rather than one statement.
--
-- =====================================================================
-- STEP 1. Look before touching anything. Run this on its own.
-- =====================================================================
-- has_key      -- the console has minted a keypair for this venue
-- enforcing    -- this venue already drops unsigned messages
-- last_session -- when the venue last actually ran a game

select v.slug,
       v.name,
       (k.venue_id is not null)              as has_key,
       v.broadcast_enforce                   as enforcing,
       (select max(s.opened_at)
          from vp_sessions s
         where s.venue_id = v.id)            as last_session
  from vp_venues v
  left join vp_venue_signing_keys k on k.venue_id = v.id
 order by has_key desc, last_session desc nulls last;

-- =====================================================================
-- STEP 2. Pick a venue that is NOT the live one.
-- =====================================================================
-- The Mini Bar is a paying venue with real punters in the room. It is the LAST
-- venue to switch on, not the first. Choose a venue from step 1 that has a key
-- and that you can watch, and run a whole game on it with enforce still off.
--
-- While that game runs, open the browser console on the TV. With enforce off a
-- bad signature logs and still renders:
--
--     [VPSign] bad signature, rendered (enforce off)
--
-- A clean night with no such line is what earns the flip. If the line appears,
-- do NOT switch that venue on: the signing is wrong somewhere and enforcing it
-- would black out the screen.
--
-- =====================================================================
-- STEP 3. Flip that ONE venue. Edit the slug; do not run it as it stands.
-- =====================================================================

-- update vp_venues set broadcast_enforce = true where slug = 'PUT-THE-SLUG-HERE';

-- =====================================================================
-- STEP 4. The rollback, ready to paste if a screen goes dark.
-- =====================================================================
-- This takes effect on the venue's next message. Nobody has to redeploy
-- anything, and the screens fail open the moment the flag is off.

-- update vp_venues set broadcast_enforce = false where slug = 'PUT-THE-SLUG-HERE';

-- To drop enforcement everywhere at once, in a hurry:
-- update vp_venues set broadcast_enforce = false where broadcast_enforce;

-- =====================================================================
-- STEP 5. Confirm the Worker agrees with the database.
-- =====================================================================
--   curl -s https://venueplay-game.dean-tindale.workers.dev/health
-- "enforcing" should have gone up by exactly one.
--
-- Safe to run more than once. Nothing here is destructive: every statement that
-- writes is commented out on purpose so that pasting the whole file only reads.
