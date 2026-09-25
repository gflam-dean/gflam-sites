-- 92: EVERY VENUE SIGNS FROM THE DAY IT IS MADE. Dean, 25 Sep 2026: "make sure it works and make sure
-- that it doesn't happen again because we can't have this happening when we've got live venues".
--
-- Broadcast signing was switched on venue by venue on 10 Sep (enforce-signing.py ALL), for the 17
-- venues that existed. vp_venues.broadcast_enforce defaults to false and nothing in sign-up sets it,
-- so every venue made since (daddys-hotel, gen-hotel, hello-hotel, hello-me) ran UNPROTECTED: anyone
-- who worked out the channel could send a fake ball or winner to their TV. Found by audit 25 Sep.
--
-- Safe with no key yet: vp-sign.js gate() delivers when enforce is on and no public key is loaded
-- ("no key to verify with -> fail open"), and the venue's key is minted by its first host login,
-- from which moment the wall only accepts signed messages. So enforcing from creation costs nothing.
-- daddys-hotel and hello-hotel (keys held) were switched on by enforce-signing.py at 18:3x the same
-- day; this does the two without keys and the default. Live gate: tools/check-signing-enforced.py.

alter table public.vp_venues alter column broadcast_enforce set default true;
update public.vp_venues set broadcast_enforce = true where status = 'active' and broadcast_enforce is not true;

-- Rollback (the emergency one is unchanged): python3 venueplay-backend/tools/enforce-signing.py --off ALL
--   and, to undo the default: alter table public.vp_venues alter column broadcast_enforce set default false;
