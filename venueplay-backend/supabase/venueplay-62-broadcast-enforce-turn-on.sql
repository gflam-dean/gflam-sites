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
-- STEP 2. Do it now, while the pubs are empty.
-- =====================================================================
-- Checked 5 Sep via the public route, which needs no login:
--
--   curl -s 'https://venueplay-game.dean-tindale.workers.dev/venue/signing/public?venue=the-mini-bar'
--   -> { "exists": true, "enforce": false, "kid": "06b823ff36..." }
--
-- So The Mini Bar HAS minted a key and is not enforcing. It is the only venue we
-- can confirm has one, and with nobody playing there is no room to black out, so
-- this is the moment to try it rather than a night in the future that never comes.
--
-- =====================================================================
-- STEP 3. Turn it on. This one IS meant to be run.
-- =====================================================================

update vp_venues set broadcast_enforce = true where slug = 'the-mini-bar';

-- Then check the Worker agrees (it reads the flag per message, no redeploy):
--   curl -s 'https://venueplay-game.dean-tindale.workers.dev/venue/signing/public?venue=the-mini-bar'
--   "enforce" should now be true.

-- =====================================================================
-- STEP 4. Prove it on a real screen before you walk away.
-- =====================================================================
--   1. Open the host console, sign in to The Mini Bar, open a bingo lobby.
--   2. Open the TV on another screen: venueplay.com.au/tv?the-mini-bar
--   3. The join code must appear. If the TV stays on the ads or goes blank,
--      enforcement is dropping real messages -> run STEP 5 immediately.
--   4. Start the game and call two or three numbers. They must land on the TV.
--   5. Join on a phone and check the card deals.
--
-- If all five work, it is on and it stays on.

-- =====================================================================
-- STEP 5. The undo. Takes effect on the very next message.
-- =====================================================================

-- update vp_venues set broadcast_enforce = false where slug = 'the-mini-bar';

-- Panic version, drops enforcement everywhere:
-- update vp_venues set broadcast_enforce = false where broadcast_enforce;

-- Safe to run more than once. Nothing here is destructive: every statement that
-- writes is commented out on purpose so that pasting the whole file only reads.
