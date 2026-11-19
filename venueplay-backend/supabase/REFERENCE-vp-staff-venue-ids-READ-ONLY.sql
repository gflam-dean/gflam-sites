-- =====================================================================
-- REFERENCE, READ ONLY. NEVER PASTE THE COMMENTED DEFINITION BELOW. (Migration 226, INBOX 707, 19 Nov 2026)
-- ---------------------------------------------------------------------
-- public.vp_staff_venue_ids() is the staff helper behind about 40 row policies (every *_host_select, the members names
-- view v_vp_members_list, vp_venue_staff's own read). Its CREATE FUNCTION is in NO file and no commit of this repo
-- (git log --all -S, 19 Nov 2026): it was made in the Supabase dashboard before the migrations were kept here.
-- RLS-BASELINE.json records only that it is SECURITY DEFINER and that anon and authenticated may execute it.
--
-- THE LIVE BODY IS NOT KNOWN. What follows is the definition the policies NEED (and what everything in the repo implies:
-- it must be SECURITY DEFINER, because vp_venue_staff_host_select calls it on vp_venue_staff itself; it takes no
-- argument and returns venue ids; migration 86 says the database "grants by role" and that vp_host_staff() "accepted ANY
-- row in vp_venue_staff", and nothing ever added a role test here).
--
-- MUST MATCH LIVE: main checks with pg_get_functiondef, read only (query at the bottom). If live differs, live wins:
-- replace the commented body here with the live text, word for word, and say so in the commit. Do NOT run a
-- create or replace of this function to "make it match": it changes every policy listed above at once.
--
-- Expected (any staff row at the venue, any role: owner, manager, host, marketing):
--
--   create or replace function public.vp_staff_venue_ids()
--   returns setof uuid
--   language sql
--   stable
--   security definer
--   set search_path = public
--   as $fn$
--     select s.venue_id
--       from public.vp_venue_staff s
--      where s.auth_user_id = auth.uid()
--   $fn$;
--   grant execute on function public.vp_staff_venue_ids() to anon, authenticated;
--
-- Its role-aware sibling, public.vp_owner_manager_venue_ids() (owner and manager only), IS in the repo: migration 226.
-- =====================================================================

-- READ ONLY. Paste into the LIVE SQL editor; nothing here changes anything.
select pg_get_functiondef('public.vp_staff_venue_ids()'::regprocedure) as live_definition;
select p.prosecdef as security_definer, p.provolatile as volatility, p.proconfig as settings
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'vp_staff_venue_ids';
select role, count(*) as logins from public.vp_venue_staff group by role order by role;
