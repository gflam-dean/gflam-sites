-- venueplay-75-CHECK-settings-policies.sql   READ ONLY. Changes nothing.
--
-- ONE query on purpose. The Supabase SQL editor shows only the LAST result set, so
-- four separate statements looked like they had only answered the fourth. Everything
-- below comes back as one table with a "part" column saying which question each row
-- answers. Run it and paste the whole thing back.
--
-- WHY: settings.html hides the owner-only cards from a manager (name display, and what
-- players are asked for, which is the opt-in and privacy half). But that page does not
-- save through the Worker. VP.saveSettings in venueplay/app/vp-session.js upserts
-- vp_venue_settings straight from the browser with the signed-in person's own token, so
-- the only thing really deciding whether a manager may write those columns is the
-- row-level policy on the table. Hiding a card is a door. The policy is the bolt.
--
-- ALREADY CHECKED from outside, 9 Sep 2026: a signed-out request to vp_venue_settings
-- and to vp_venue_staff both answer 200 with an empty list, so row level security IS on
-- and IS filtering, and a stranger sees nothing. What cannot be seen from out there is
-- whether a signed-in MANAGER may write the owner-only columns. That is what this asks.

select '1. is RLS on'   as part,
       relname          as name,
       relrowsecurity::text  as detail_a,
       relforcerowsecurity::text as detail_b,
       null             as detail_c
from pg_class
where oid in ('public.vp_venue_settings'::regclass, 'public.vp_venue_staff'::regclass)

union all

select '2. policies on vp_venue_settings',
       polname,
       case polcmd when 'r' then 'select' when 'a' then 'insert'
                   when 'w' then 'update' when 'd' then 'delete' else 'all' end,
       coalesce(pg_get_expr(polqual, polrelid), '(no using clause)'),
       coalesce(pg_get_expr(polwithcheck, polrelid), '(no with check clause)')
from pg_policy
where polrelid = 'public.vp_venue_settings'::regclass

union all

select '3. who holds grants on vp_venue_settings',
       grantee,
       string_agg(privilege_type, ', ' order by privilege_type),
       null, null
from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'vp_venue_settings'
group by grantee

union all

select '4. policies on vp_venue_staff',
       polname,
       case polcmd when 'r' then 'select' when 'a' then 'insert'
                   when 'w' then 'update' when 'd' then 'delete' else 'all' end,
       coalesce(pg_get_expr(polqual, polrelid), '(no using clause)'),
       coalesce(pg_get_expr(polwithcheck, polrelid), '(no with check clause)')
from pg_policy
where polrelid = 'public.vp_venue_staff'::regclass

order by 1, 2;
