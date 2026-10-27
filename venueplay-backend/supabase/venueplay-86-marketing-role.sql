-- =====================================================================
-- 86. A MARKETING LOGIN: a staff role that can never run a game.
--
-- Dean, 22 Sep 2026: an optional marketing person per venue, who sees the numbers, the brand
-- kit, the signs, the advertising screens and (only if the owner ticks the box) the opt-in
-- list, and who receives "please remove this person" requests. They must not be able to run
-- games, see billing or change what player data is collected.
--
-- WHY A NEW ROLE AND NOT A MANAGER WITH THINGS SWITCHED OFF. The row level security in this
-- database grants by role: role in ('owner','manager'). A flag inside a manager's permissions
-- is invisible to it. A role it has never heard of is refused by default, which is the right
-- way round for a login that belongs to somebody outside the venue's staff.
--
-- THE PART THAT MATTERS: vp_host_staff() is the staff check behind every one-trip game
-- function (vp_host_question, vp_host_reveal, vp_bingo_ball, vp_members_draw). It accepted ANY
-- row in vp_venue_staff. Part 3 replaces it with the same function, word for word, plus one
-- line. The Worker refuses the role as well (requireStaff), so this is the second lock, not
-- the only one.
--
-- SAFE TO RUN TWICE. Run it at a quiet time: part 3 replaces the function every live game
-- calls. It is one statement and takes effect instantly. The previous version is at the very
-- bottom, commented out, ready to paste back.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Let vp_venue_staff.role hold 'marketing', however role is constrained today.
--    The base table is not in this repo, so this looks rather than assumes: an enum type gets
--    a new value, a CHECK constraint is replaced by one that also allows 'marketing', and a
--    plain text column with no constraint needs nothing.
-- ---------------------------------------------------------------------
do $mig$
declare
  v_type  text;
  v_udt   text;
  c       record;
begin
  select data_type, udt_name into v_type, v_udt
    from information_schema.columns
   where table_schema = 'public' and table_name = 'vp_venue_staff' and column_name = 'role';
  if v_type is null then
    raise exception 'vp_venue_staff.role does not exist. Stop: this is not the database this migration was written for.';
  end if;

  if v_type = 'USER-DEFINED' then
    execute format('alter type public.%I add value if not exists %L', v_udt, 'marketing');
    raise notice 'role is the enum %, and it now includes marketing', v_udt;
  else
    for c in
      select con.conname, pg_get_constraintdef(con.oid) as def
        from pg_constraint con
       where con.conrelid = 'public.vp_venue_staff'::regclass
         and con.contype = 'c'
         and pg_get_constraintdef(con.oid) ilike '%role%'
         and pg_get_constraintdef(con.oid) not ilike '%marketing%'
    loop
      execute format('alter table public.vp_venue_staff drop constraint %I', c.conname);
      raise notice 'dropped the constraint % (it was: %)', c.conname, c.def;
    end loop;
    -- Put one back, once, whether or not there was one before: a role column that will take
    -- any text at all is how a typo becomes a login nobody can explain.
    if not exists (select 1 from pg_constraint con
                    where con.conrelid = 'public.vp_venue_staff'::regclass and con.contype = 'c'
                      and pg_get_constraintdef(con.oid) ilike '%marketing%') then
      execute 'alter table public.vp_venue_staff add constraint vp_venue_staff_role_check '
           || 'check (role in (''owner'', ''manager'', ''host'', ''marketing''))';
    end if;
  end if;
end
$mig$;

-- ---------------------------------------------------------------------
-- 2. Where a removal request is emailed. Logins here are by mobile, so until now a staff row
--    had no email address at all. Optional, and only ever filled in for a marketing login.
-- ---------------------------------------------------------------------
alter table public.vp_venue_staff add column if not exists notify_email text;

-- ---------------------------------------------------------------------
-- 3. The staff check behind every one-trip game function. IDENTICAL to migration 73 except
--    for the one marked line.
-- ---------------------------------------------------------------------
create or replace function public.vp_host_staff(p_auth_user_id uuid, p_venue_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_staff  record;
  v_admin  record;
  v_venue  record;
  v_group  record;
  v_actor  text;
  v_out    jsonb;
begin
  select s.id, s.role into v_staff
    from public.vp_venue_staff s
   where s.auth_user_id = p_auth_user_id and s.venue_id = p_venue_id
     -- THE ONE LINE THIS MIGRATION IS FOR. Named roles only. A marketing login has a staff row
     -- at the venue, and without this it could call a bingo ball or draw a raffle.
     and s.role in ('owner', 'manager', 'host')
   limit 1;
  if found then
    v_actor := 'host:' || v_staff.id::text;
    v_out := jsonb_build_object('actor', v_actor, 'staff_id', v_staff.id, 'role', v_staff.role, 'is_admin', false);
  else
    select a.role into v_admin
      from public.vp_platform_admins a
     where a.auth_user_id = p_auth_user_id and a.role in ('owner', 'accounts')
     limit 1;
    if not found then return jsonb_build_object('status', 'not_staff'); end if;
    v_actor := 'vpadmin:' || p_auth_user_id::text;
    v_out := jsonb_build_object('actor', v_actor, 'staff_id', null, 'role', 'owner', 'is_admin', true);
  end if;

  select v.status, v.group_id into v_venue from public.vp_venues v where v.id = p_venue_id;
  if not found then return jsonb_build_object('status', 'venue_missing'); end if;
  if v_venue.status <> 'active' then return jsonb_build_object('status', 'venue_paused'); end if;
  if v_venue.group_id is not null then
    select g.status into v_group from public.vp_venue_groups g where g.id = v_venue.group_id;
    if found and v_group.status <> 'active' then return jsonb_build_object('status', 'venue_paused'); end if;
  end if;
  return v_out || jsonb_build_object('status', 'ok');
end;
$$;

revoke all on function public.vp_host_staff(uuid, uuid) from public, anon, authenticated;
grant execute on function public.vp_host_staff(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------
-- 4. READ THIS BACK. Three lines, and all three should say yes. Paste the result to Claude.
-- ---------------------------------------------------------------------
select '1. notify_email column exists' as check,
       case when exists (select 1 from information_schema.columns
                          where table_schema = 'public' and table_name = 'vp_venue_staff' and column_name = 'notify_email')
            then 'yes' else 'NO' end as answer
union all
select '2. the staff check names its roles',
       case when pg_get_functiondef('public.vp_host_staff(uuid,uuid)'::regprocedure) like '%s.role in (''owner'', ''manager'', ''host'')%'
            then 'yes' else 'NO' end
union all
select '3. a marketing role can be stored',
       case when (select data_type from information_schema.columns
                   where table_schema = 'public' and table_name = 'vp_venue_staff' and column_name = 'role') = 'USER-DEFINED'
              then case when exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
                                      where t.typname = (select udt_name from information_schema.columns
                                                          where table_schema = 'public' and table_name = 'vp_venue_staff' and column_name = 'role')
                                        and e.enumlabel = 'marketing') then 'yes' else 'NO' end
            when exists (select 1 from pg_constraint con
                          where con.conrelid = 'public.vp_venue_staff'::regclass and con.contype = 'c'
                            and pg_get_constraintdef(con.oid) ilike '%role%'
                            and pg_get_constraintdef(con.oid) not ilike '%marketing%') then 'NO'
            else 'yes' end;

-- =====================================================================
-- TO UNDO PART 3 ONLY (the function), paste this back, without the leading "-- ":
--
-- create or replace function public.vp_host_staff(p_auth_user_id uuid, p_venue_id uuid)
-- returns jsonb
-- language plpgsql
-- security definer
-- set search_path = public
-- as $$
-- declare
--   v_staff  record;
--   v_admin  record;
--   v_venue  record;
--   v_group  record;
--   v_actor  text;
--   v_out    jsonb;
-- begin
--   select s.id, s.role into v_staff
--     from public.vp_venue_staff s
--    where s.auth_user_id = p_auth_user_id and s.venue_id = p_venue_id
--    limit 1;
--   if found then
--     v_actor := 'host:' || v_staff.id::text;
--     v_out := jsonb_build_object('actor', v_actor, 'staff_id', v_staff.id, 'role', v_staff.role, 'is_admin', false);
--   else
--     select a.role into v_admin
--       from public.vp_platform_admins a
--      where a.auth_user_id = p_auth_user_id and a.role in ('owner', 'accounts')
--      limit 1;
--     if not found then return jsonb_build_object('status', 'not_staff'); end if;
--     v_actor := 'vpadmin:' || p_auth_user_id::text;
--     v_out := jsonb_build_object('actor', v_actor, 'staff_id', null, 'role', 'owner', 'is_admin', true);
--   end if;
-- 
--   select v.status, v.group_id into v_venue from public.vp_venues v where v.id = p_venue_id;
--   if not found then return jsonb_build_object('status', 'venue_missing'); end if;
--   if v_venue.status <> 'active' then return jsonb_build_object('status', 'venue_paused'); end if;
--   if v_venue.group_id is not null then
--     select g.status into v_group from public.vp_venue_groups g where g.id = v_venue.group_id;
--     if found and v_group.status <> 'active' then return jsonb_build_object('status', 'venue_paused'); end if;
--   end if;
--   return v_out || jsonb_build_object('status', 'ok');
-- end;
-- $$;
-- =====================================================================
