-- =====================================================================
-- Migration 85: give a venue back its own prizes tally
-- ---------------------------------------------------------------------
-- The Raffles panel on the account page shows "$X given away in prizes so
-- far". It has been showing "No prizes recorded yet" to every venue since the
-- Sydney cut-over, while the data was sitting there the whole time: the view
-- holds real rows, one of them $2,900 of prizes.
--
-- Found 17 Sep 2026 in the Postgres logs, not by anyone looking at the page:
--
--   GET | 403 | /rest/v1/v_vp_prizes_given?select=*&venue_id=eq....
--   permission denied for view v_vp_prizes_given
--
-- from a real signed-in browser, repeatedly, on different venues.
--
-- HOW IT BROKE, and it is worth writing down because the two files disagree.
--
-- Migration 61 looked at this view on purpose and decided it must STAY readable
-- by a signed-in user. Its own comment says why:
--
--   "It has to stay readable by a signed-in user - but as the querying user, so
--    that RLS decides which venue's rows come back rather than the client's own
--    .eq(). security_invoker is exactly that."
--
-- So 61 set security_invoker on and revoked ANON only, deliberately leaving
-- authenticated in place.
--
-- SYDNEY-01-relock-before-cutover.sql then listed the same view in its `shut`
-- array, described as "tables and views that must be invisible to the key in the
-- page", and that loop revokes from `anon, authenticated`. The page does not use
-- the anon key for this: it uses the signed-in user's own token. So the relock
-- took away the exact grant 61 had reasoned its way to keeping, and nothing
-- failed loudly, because the page treats an error as an empty tally.
--
-- WHY GRANTING THIS IS SAFE. security_invoker is still on, so the view runs as
-- the CALLER and RLS on the base tables decides which rows come back. The
-- browser's own .eq(venue_id) is a convenience, not the gate. anon stays
-- revoked. A venue sees its own totals and nobody else's.
-- =====================================================================

grant select on public.v_vp_prizes_given to authenticated;

-- Belt and braces: 61 set this and nothing since should have changed it, but the
-- grant above is only safe WITH it, so assert it rather than assume it.
alter view public.v_vp_prizes_given set (security_invoker = on);

revoke all on public.v_vp_prizes_given from anon;

-- PostgREST caches what a role may see. Without this the grant is real in the
-- database and invisible over the API, which looks exactly like this file having
-- done nothing.
notify pgrst, 'reload schema';

-- =====================================================================
-- PROVE IT. First should return 'authenticated'. Second must return NO ROWS.
-- =====================================================================
--
-- select grantee from information_schema.role_table_grants
--  where table_name = 'v_vp_prizes_given' and privilege_type = 'SELECT';
--
-- select 'still readable by anon' as problem
--   from information_schema.role_table_grants
--  where table_name = 'v_vp_prizes_given' and grantee = 'anon';
--
-- And the thing a venue actually sees, which should be a number and not zero:
-- select venue_id, prizes_given_value_cents / 100.0 as dollars
--   from v_vp_prizes_given order by prizes_given_value_cents desc;
