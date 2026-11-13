-- =====================================================================
-- Migration 146: the account owner is NAMED (vp_venue_staff.is_account_owner)
-- ---------------------------------------------------------------------
--   NOT RUN. Security audit 3 Nov 2026, findings H2 (and M1 / L6). Branch fix/security-3nov.
--   Number checked on every branch and every worktree on 3 Nov 2026 (144 = help alerts).
--
--   RUN FIRST: PRECHECK-account-owner-146-READ-ONLY.sql (read only). It lists, per account, who
--   becomes the owner, by which rule, and which logins lose owner rights. Read the GUESSED rows.
--
--   ORDER: run 146 BEFORE deploying the billing Worker from this branch (recommended), but either
--   order is safe and nobody who is an owner today is locked out:
--     - 146 first, old Worker: the old Worker never reads the new column. Nothing changes.
--     - new Worker first, no 146: PostgREST answers 42703 (no such column) and the new Worker
--       keeps the old rule until 146 is run (tools/test-account-owner-marker.js runs that gap).
--     - both: the hole is shut. The owner is a staff row on THIS account with
--       is_account_owner = true, or role 'owner'. "No permissions object" means nothing.
--   Safe to run more than once (it only ever sets the marker true, never takes it away).
--   After running: python3 venueplay-backend/tools/dump-rls-baseline.py (no new policy or grant
--   is added, so RLS-BASELINE.json should not change; run it to be sure).
--
-- THE HOLE. vpbIsOwner(o) was `!o.perms`. A manager added before vpbAddManager wrote a
-- permissions object, or a host the old Add host stored as role manager, had no permissions
-- object and so was the account owner: /account/players (charges the card), cancel-venue,
-- add-venue, manager-add, the Stripe portal, reminders. Migration 41 described this in August
-- and its fix was by hand. 17 Sep 2026: 21 of 22 staff rows had no permissions object.
--
-- HOW THE TRUE OWNER IS DECIDED (per account = venueplay_founding row; see the shared block):
--   1. any login holding a role 'owner' staff row on the account; then
--   2. a login with no permissions object on any of its rows on the account whose sign-in email
--      equals the account's contact_email (venueplay_founding.contact_email, the address that
--      signed up and pays), or whose mobile matches the account's mobile (last 9 digits); then
--   3. ONLY for an account where neither 1 nor 2 found anybody: its earliest-created full-access
--      login (auth.users.created_at). Provisioning makes the paying contact's login first, so
--      this is the person who set the account up. The pre-check marks these GUESSED.
--   An account whose logins all carry a permissions object gets no owner, exactly as today.
--
-- NEW ROWS. A BEFORE INSERT trigger marks the owner on accounts made after this runs, whichever
-- Worker version made them: a role 'owner' row; a login that is already the owner elsewhere on
-- the same account (a venue added later); or the FIRST full-access (no permissions) owner or
-- manager row on an account that has no owner yet (the signup's own login). Managers added by
-- vpbAddManager carry a permissions object and are never marked. It never raises.
--
-- WHO CAN WRITE IT. vp_venue_staff is written by the Workers (service role) and HQ admins only
-- (vp_venue_staff_admin_all; no venue policy allows insert or update), so a venue cannot mark
-- itself.
-- =====================================================================

begin;

alter table public.vp_venue_staff
  add column if not exists is_account_owner boolean not null default false;

comment on column public.vp_venue_staff.is_account_owner is
  'The account owner (migration 146, security audit 3 Nov 2026). The billing Worker treats a login as owner only if one of its owner/manager rows on the account being viewed has this true, or role owner. A null permissions object no longer means owner.';

-- Backfill from the account's real owner.
-- >>> WHO IS EACH ACCOUNT'S OWNER (the same block in venueplay-146 and PRECHECK-146; a test holds them together)
with staff_on_account as (
  select v.founding_id, s.auth_user_id, s.role, s.permissions, v.name as venue_name
    from public.vp_venue_staff s
    join public.vp_venues v on v.id = s.venue_id
   where s.role in ('owner', 'manager')
     and v.founding_id is not null
     and s.auth_user_id is not null
),
logins as (
  select a.founding_id, a.auth_user_id,
         bool_or(a.role = 'owner')                  as has_owner_role,
         bool_and(a.permissions is null)            as no_restrictions,
         string_agg(distinct a.venue_name, ', ')    as venues
    from staff_on_account a
   group by a.founding_id, a.auth_user_id
),
matched as (
  select l.founding_id, l.auth_user_id, l.has_owner_role, l.no_restrictions, l.venues,
         u.email as login_email, u.phone as login_phone, u.created_at as login_created,
         f.contact_email, f.mobile as account_mobile,
         (l.no_restrictions and (
             (u.email is not null and f.contact_email is not null
              and lower(trim(u.email)) = lower(trim(f.contact_email)))
          or (length(regexp_replace(coalesce(u.phone, ''), '[^0-9]', '', 'g')) >= 9
              and length(regexp_replace(coalesce(f.mobile, ''), '[^0-9]', '', 'g')) >= 9
              and right(regexp_replace(u.phone, '[^0-9]', '', 'g'), 9)
                = right(regexp_replace(f.mobile, '[^0-9]', '', 'g'), 9))
         )) as matches_account_contact
    from logins l
    join public.venueplay_founding f on f.id = l.founding_id
    left join auth.users u on u.id = l.auth_user_id
),
ranked as (
  select m.*,
         bool_or(m.has_owner_role or m.matches_account_contact)
           over (partition by m.founding_id) as account_has_clear_owner,
         row_number() over (partition by m.founding_id
                            order by (not m.no_restrictions), m.login_created nulls last, m.auth_user_id) as fallback_rank
    from matched m
),
decided as (
  select r.*,
         case when r.has_owner_role then 'role owner'
              when r.matches_account_contact then 'login matches the account contact email or mobile'
              when (not r.account_has_clear_owner) and r.no_restrictions and r.fallback_rank = 1
                then 'GUESSED: earliest full-access login on an account with no clear owner (check this one)'
              else null end as owner_rule
    from ranked r
)
-- <<< end of the shared block
update public.vp_venue_staff s
   set is_account_owner = true
  from public.vp_venues v, decided d
 where v.id = s.venue_id
   and d.founding_id = v.founding_id
   and d.auth_user_id = s.auth_user_id
   and s.role in ('owner', 'manager')
   and d.owner_rule is not null
   and s.is_account_owner is distinct from true;

-- New accounts and new venues: mark the owner on insert, whatever the Worker version.
create or replace function public.vp_staff_mark_account_owner()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_f uuid;
begin
  if new.is_account_owner is true then return new; end if;
  if new.role is null or new.role not in ('owner', 'manager') then return new; end if;
  select x.founding_id into v_f from public.vp_venues x where x.id = new.venue_id;
  if v_f is null then return new; end if;
  if new.role = 'owner' then
    new.is_account_owner := true;
    return new;
  end if;
  -- already this account's owner at another of its venues (a venue added later)
  if exists (select 1 from public.vp_venue_staff s join public.vp_venues x on x.id = s.venue_id
              where x.founding_id = v_f and s.auth_user_id = new.auth_user_id and s.is_account_owner) then
    new.is_account_owner := true;
    return new;
  end if;
  -- the account's first full-access login (signup and HQ onboarding write it with no permissions)
  if new.permissions is null
     and not exists (select 1 from public.vp_venue_staff s join public.vp_venues x on x.id = s.venue_id
                      where x.founding_id = v_f and s.is_account_owner) then
    new.is_account_owner := true;
  end if;
  return new;
exception when others then
  return new;   -- never cost a signup its login; the marker can be set by hand
end;
$$;

revoke all on function public.vp_staff_mark_account_owner() from public, anon, authenticated;

drop trigger if exists vp_staff_mark_account_owner on public.vp_venue_staff;
create trigger vp_staff_mark_account_owner
  before insert on public.vp_venue_staff
  for each row execute function public.vp_staff_mark_account_owner();

-- SELF-CHECK: every account with a full-access login has an owner, and nobody restricted was marked
-- except a role 'owner' row.
do $check$
declare
  n_orphan int;
  n_bad int;
begin
  -- per LOGIN first (a login with a permissions object on any of its rows was never an owner,
  -- the most restrictive row wins), then per account
  select count(*) into n_orphan from (
    select l.founding_id
      from (select v.founding_id, s.auth_user_id,
                   bool_and(s.permissions is null) as no_restrictions,
                   bool_or(s.is_account_owner)     as marked
              from public.vp_venue_staff s join public.vp_venues v on v.id = s.venue_id
             where s.role in ('owner', 'manager') and v.founding_id is not null and s.auth_user_id is not null
             group by v.founding_id, s.auth_user_id) l
     group by l.founding_id
    having bool_or(l.no_restrictions) and not bool_or(l.marked)) o;
  if n_orphan > 0 then
    raise exception 'Migration 146 self-check: % account(s) with a full-access login have no owner marked', n_orphan;
  end if;
  select count(*) into n_bad from public.vp_venue_staff s
   where s.is_account_owner and s.role not in ('owner', 'manager');
  if n_bad > 0 then
    raise exception 'Migration 146 self-check: % host or marketing row(s) marked as owner', n_bad;
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'vp_staff_mark_account_owner' and not tgisinternal) then
    raise exception 'Migration 146 self-check: the owner trigger is missing';
  end if;
end;
$check$;

commit;

-- ============ READ BACK (READ ONLY, after running) ===================
-- One line per account: its owner(s). Every paying account should name the person you expect.
--
-- select f.contact_email, v.name as venue, u.email as owner_login, s.role
--   from public.vp_venue_staff s
--   join public.vp_venues v on v.id = s.venue_id
--   join public.venueplay_founding f on f.id = v.founding_id
--   left join auth.users u on u.id = s.auth_user_id
--  where s.is_account_owner
--  order by f.contact_email, v.name;
--
-- To make someone the owner by hand (or take it away), on every row they hold on that account:
--   update public.vp_venue_staff set is_account_owner = true
--    where auth_user_id = '<their id>' and role in ('owner','manager')
--      and venue_id in (select id from public.vp_venues where founding_id = '<account id>');

-- Rollback (the new Worker then falls back to the old rule, so keep the old Worker in mind):
--   drop trigger if exists vp_staff_mark_account_owner on public.vp_venue_staff;
--   drop function if exists public.vp_staff_mark_account_owner();
--   alter table public.vp_venue_staff drop column if exists is_account_owner;
