-- venueplay-75-CHECK-settings-policies.sql
-- READ ONLY. This changes NOTHING. Run it and paste the output back before anyone
-- writes a policy, because a wrong policy on this table locks a venue out of its own
-- settings, and that is worse than the gap it would close.
--
-- WHY: settings.html hides the owner-only cards from a manager (name display, and what
-- players are asked for, which is the opt-in and privacy half). But the page does not
-- save through the Worker. VP.saveSettings in venueplay/app/vp-session.js upserts
-- vp_venue_settings straight from the browser with the signed-in user's own token, so
-- the only thing actually deciding whether a manager may write those columns is the
-- row-level policy on the table. Hiding a card is a door. The policy is the bolt.
--
-- ALREADY CHECKED, read only, 9 Sep 2026: a signed-out request to vp_venue_settings and
-- to vp_venue_staff both answer 200 with an empty list, so row level security IS on and it
-- IS filtering. A stranger sees nothing. What cannot be seen from outside the database is
-- the part that matters here: whether a signed-in MANAGER is allowed to write the
-- owner-only columns. That is what these four queries answer.
--
-- Paste the results back and the policy can be written against what is really
-- there rather than against a guess.

-- 1. Is row level security even on for this table?
select relname   as table_name,
       relrowsecurity  as rls_enabled,
       relforcerowsecurity as rls_forced
from pg_class
where oid = 'public.vp_venue_settings'::regclass;

-- 2. What policies exist on it today, and what do they actually say?
select polname                                   as policy_name,
       case polcmd when 'r' then 'select' when 'a' then 'insert'
                   when 'w' then 'update' when 'd' then 'delete'
                   else 'all' end                as applies_to,
       pg_get_expr(polqual, polrelid)            as using_clause,
       pg_get_expr(polwithcheck, polrelid)       as with_check_clause
from pg_policy
where polrelid = 'public.vp_venue_settings'::regclass
order by polname;

-- 3. Which roles hold table grants on it? (a grant to anon or authenticated with no
--    policy behind it is the whole problem in one line)
select grantee, string_agg(privilege_type, ', ' order by privilege_type) as privileges
from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'vp_venue_settings'
group by grantee
order by grantee;

-- 4. For context, the same three questions about the staff table the page trusts to
--    tell it who is a manager.
select polname as staff_policy,
       case polcmd when 'r' then 'select' when 'a' then 'insert'
                   when 'w' then 'update' when 'd' then 'delete'
                   else 'all' end as applies_to,
       pg_get_expr(polqual, polrelid) as using_clause
from pg_policy
where polrelid = 'public.vp_venue_staff'::regclass
order by polname;
