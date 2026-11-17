-- =====================================================================
-- Migration 212: a venue's TV address can follow its new name, and every old address keeps working for ever
-- ---------------------------------------------------------------------
-- Dean's open question 32 (16 Nov 2026), answer "yes, step 2": HQ Rename venue (f8a3e566) changes the display name
-- only. Dean's job row says the TV address (the slug) should follow the new name with the old address still forwarding:
-- the Lunatic Hotel fix. This is step 2: HQ > Details > "Move TV address", Owner only.
--
-- WRITTEN, RUN ON TEST ONLY (rkfaftxgzpsmmrzudlqy, twice). NOT RUN ON LIVE. Ships only on Dean's yes.
-- Branch feature/hq-rename-slug-q32. Safe to run more than once.
-- NUMBER: 205 to 210 are taken on other branches or worktrees, and 210 is claimed TWICE (replay/sun29-no-contact and the
-- q28 known-phone worktree), so one of them will move to 211. Checked every branch and worktree 17 Nov 2026 23:05 Brisbane.
-- So 212.
-- The file as committed carries the VP-STAGING-GUARD block, which REFUSES on the live project: the live run is the
-- statements between the guard's END marker and the end of the file (as for 197 and 208).
--
-- WHAT USES THE SLUG (why an old one must keep working, and must never be handed to another pub):
--   * TV:      venueplay.com.au/tv?venue=<slug> (bookmarks, the TV apps' own memory, vpTvPaired on a paired browser TV).
--   * Signs:   printed table talkers carry the QR venueplay.com.au/play?venue=<slug> and print the code hash(slug).
--   * Channel: the realtime channel is vp-<hash(slug)>; TV, console and phones derive it from the slug they hold.
--   * Code:    join_code was set to hash(slug) for every venue by migration 91 and is NOT moved here, so the code on the
--              wall, the /play?room=<code> QR on the TV and every printed code stay exactly as they are.
--   * Screen:  vp_venue_screen.slug (the TV's slides are read by slug).
--
-- WHAT THIS ADDS (nothing existing is dropped or rewritten):
--   1. vp_venue_slug_aliases: one row per OLD address (slug primary key, venue_id, when, by whom). RLS on, no policies,
--      everything revoked from public / anon / authenticated: service role only (the Workers).
--   2. Triggers so that NO TWO VENUES CAN EVER HOLD THE SAME ADDRESS, current or old, whatever path writes:
--        - an old address can never be one that some venue has as its current slug;
--        - a venue can never take (insert or update) a slug that is another venue's old address;
--        - a venue taking back its OWN old address drops that alias row in the same statement.
--      Both take the same transaction-scoped advisory lock on the slug first, so two writers cannot race past each other.
--   3. vp_venue_move_address(venue, new slug, actor id, actor label): the ONE way an address moves. In one transaction:
--      locks the venue row; checks the new slug is well formed, free (current and old addresses), and that its channel
--      hash is not any other venue's code or channel (a shared channel would put two pubs' games on one wall); refuses
--      while a game is open at the venue (a console open on the old address would sit on the old channel); keeps the
--      venue's join code (fills it with hash(old slug) if it was ever null, so printed codes cannot change); records the
--      old address as an alias; moves vp_venues.slug and vp_venue_screen.slug; asks every TV at the venue to reload
--      (screen_reload_at), which sends it to the new address; writes the vp_admin_audit row (venue_address_moved, from,
--      to, join code). If any step fails nothing changes, so a move nobody can trace cannot happen.
--      Execute: service_role only.
--   4. vp_venue_current_slug(slug): the venue's current slug for a current or old address, else null. Slugs are public
--      (they are in TV and sign addresses), so anon and authenticated may call it: a console bookmarked on the old
--      address uses it to find its venue. It returns nothing else.
--
-- ORDER: run this BEFORE the billing Worker that offers "Move TV address" (the Worker answers "not set up yet" until it
-- runs, and changes nothing). The game Worker and the pages are safe either side: with no aliases nothing resolves
-- differently. Needs vp_venues, vp_venue_screen (15), screen_reload_at (63), vp_legacy_venue_code (68), join_code (68/91),
-- vp_sessions, vp_admin_audit.
-- After it runs on LIVE: python3 venueplay-backend/tools/dump-rls-baseline.py and commit RLS-BASELINE.json and
-- COLUMNS-BASELINE.json (one table, RLS on, no policies, no anon/authenticated grants; two definer functions:
-- vp_venue_move_address anon false / authenticated false, vp_venue_current_slug anon true / authenticated true). This
-- branch leaves both baselines as live is now, so the live gate stays green until the migration really runs.
-- Rollback (only while no address has moved; after a move the alias rows ARE the old addresses, keep them):
--   drop trigger vp_venues_slug_alias_guard on public.vp_venues; drop function public.vp_venues_slug_alias_guard();
--   drop function public.vp_venue_move_address(uuid, text, uuid, text); drop function public.vp_venue_current_slug(text);
--   drop table public.vp_venue_slug_aliases; drop function public.vp_slug_alias_guard();
-- =====================================================================
-- VP-STAGING-GUARD-BEGIN
do $guard$
declare n bigint;
begin
  if to_regclass('vp_staging.vp_staging_marker') is null then
    raise exception 'REFUSED: no TEST marker here. This is not the venueplay TEST project (rkfaftxgzpsmmrzudlqy), or 01-mark-this-as-test.sql was not run. Nothing was changed.';
  end if;
  execute 'select count(*) from vp_staging.vp_staging_marker where project_ref = ''rkfaftxgzpsmmrzudlqy''' into n;
  if n <> 1 then
    raise exception 'REFUSED: the TEST marker does not name rkfaftxgzpsmmrzudlqy. Nothing was changed.';
  end if;
  select count(*) into n from auth.users
   where greatest(coalesce(last_sign_in_at, 'epoch'::timestamptz), coalesce(created_at, 'epoch'::timestamptz)) >= '2026-10-01'
     and not (coalesce(email, '') like '%@example.invalid' or coalesce(phone, '') like '6149157%');
  if n > 0 then
    raise exception 'REFUSED: % real person(s) signed in here since 1 Oct 2026. The TEST project only ever has fake users. Is this LIVE? Nothing was changed.', n;
  end if;
end
$guard$;
-- VP-STAGING-GUARD-END

-- 1. THE OLD ADDRESSES ------------------------------------------------------------------------------------------------
create table if not exists public.vp_venue_slug_aliases (
  slug        text primary key check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) between 2 and 80),
  venue_id    uuid not null references public.vp_venues(id) on delete cascade,
  retired_at  timestamptz not null default now(),
  retired_by  text
);
create index if not exists vp_venue_slug_aliases_venue on public.vp_venue_slug_aliases (venue_id);
alter table public.vp_venue_slug_aliases enable row level security;
revoke all on public.vp_venue_slug_aliases from public, anon, authenticated;
grant select, insert, update, delete on public.vp_venue_slug_aliases to service_role;

-- 2. NO TWO VENUES EVER HOLD THE SAME ADDRESS ---------------------------------------------------------------------------
-- An old address is never some venue's current slug.
create or replace function public.vp_slug_alias_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  perform pg_advisory_xact_lock(hashtext('vp-venue-address:' || new.slug));
  if exists (select 1 from public.vp_venues v where v.slug = new.slug) then
    raise exception 'vp-address-taken: % is a venue''s current TV address, so it cannot be an old one', new.slug
      using errcode = '23505';
  end if;
  return new;
end $$;
revoke all on function public.vp_slug_alias_guard() from public, anon, authenticated;
drop trigger if exists vp_slug_alias_guard on public.vp_venue_slug_aliases;
create trigger vp_slug_alias_guard before insert or update of slug on public.vp_venue_slug_aliases
  for each row execute function public.vp_slug_alias_guard();

-- A venue never takes another venue's old address; taking back its own drops the alias.
create or replace function public.vp_venues_slug_alias_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.slug is null or (tg_op = 'UPDATE' and new.slug is not distinct from old.slug) then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtext('vp-venue-address:' || new.slug));
  if exists (select 1 from public.vp_venue_slug_aliases a where a.slug = new.slug and a.venue_id is distinct from new.id) then
    raise exception 'vp-address-taken: % is another venue''s old TV address and still forwards there', new.slug
      using errcode = '23505';
  end if;
  delete from public.vp_venue_slug_aliases a where a.slug = new.slug and a.venue_id = new.id;
  return new;
end $$;
revoke all on function public.vp_venues_slug_alias_guard() from public, anon, authenticated;
drop trigger if exists vp_venues_slug_alias_guard on public.vp_venues;
create trigger vp_venues_slug_alias_guard before insert or update of slug on public.vp_venues
  for each row execute function public.vp_venues_slug_alias_guard();

-- 3. THE ONE WAY AN ADDRESS MOVES ---------------------------------------------------------------------------------------
create or replace function public.vp_venue_move_address(p_venue_id uuid, p_new_slug text, p_actor_admin uuid, p_actor_label text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v        record;
  new_slug text := lower(btrim(coalesce(p_new_slug, '')));
  new_code text;
  old_code text;
  code     text;
  olds     jsonb;
begin
  if new_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or length(new_slug) < 2 or length(new_slug) > 80 then
    return jsonb_build_object('ok', false, 'reason', 'bad_slug');
  end if;
  -- Both addresses locked in a fixed order (the triggers take the same locks), then the venue row.
  perform pg_advisory_xact_lock(hashtext('vp-venue-address:' || new_slug));
  select id, name, slug, join_code into v from public.vp_venues where id = p_venue_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'no_venue'); end if;
  if v.slug is null then return jsonb_build_object('ok', false, 'reason', 'no_slug'); end if;
  perform pg_advisory_xact_lock(hashtext('vp-venue-address:' || v.slug));
  if v.slug = new_slug then return jsonb_build_object('ok', false, 'reason', 'same', 'slug', v.slug); end if;

  if exists (select 1 from public.vp_venues o where o.slug = new_slug and o.id <> v.id) then
    return jsonb_build_object('ok', false, 'reason', 'taken');
  end if;
  if exists (select 1 from public.vp_venue_slug_aliases a where a.slug = new_slug and a.venue_id <> v.id) then
    return jsonb_build_object('ok', false, 'reason', 'taken_old');
  end if;
  -- The new channel must be nobody else's: not another venue's code, its channel, or one of its old addresses' channels.
  new_code := public.vp_legacy_venue_code(new_slug);
  if exists (select 1 from public.vp_venues o where o.id <> v.id
               and (o.join_code = new_code or public.vp_legacy_venue_code(o.slug) = new_code))
     or exists (select 1 from public.vp_venue_slug_aliases a where a.venue_id <> v.id
               and public.vp_legacy_venue_code(a.slug) = new_code) then
    return jsonb_build_object('ok', false, 'reason', 'code_clash');
  end if;
  -- A game open at the venue: a console already open sits on the old channel. Refuse; move it once the night is over.
  if exists (select 1 from public.vp_sessions s where s.venue_id = v.id and s.ended_at is null
               and s.status in ('lobby', 'running', 'paused')
               and coalesce(s.started_at, s.opened_at, s.created_at) > now() - interval '12 hours') then
    return jsonb_build_object('ok', false, 'reason', 'game_on');
  end if;

  -- The code never moves. A venue whose code was ever left null (a hash clash at sign-up) gets its old derived code
  -- fixed now, so the code it has been showing and printing stays its code.
  old_code := public.vp_legacy_venue_code(v.slug);
  code := v.join_code;
  if code is null then
    if exists (select 1 from public.vp_venues o where o.join_code = old_code and o.id <> v.id) then
      return jsonb_build_object('ok', false, 'reason', 'no_code');
    end if;
    code := old_code;
  end if;

  -- The slug moves FIRST, then the old one becomes an alias: an alias may never be a current slug, even for a moment
  -- (vp_slug_alias_guard). vp_venues_slug_alias_guard drops the alias row if the new slug is this venue's own old one.
  update public.vp_venues set slug = new_slug, join_code = code, screen_reload_at = now() where id = v.id;
  update public.vp_venue_screen set slug = new_slug where venue_id = v.id;
  insert into public.vp_venue_slug_aliases (slug, venue_id, retired_by)
    values (v.slug, v.id, left(coalesce(p_actor_label, 'admin'), 120))
    on conflict (slug) do nothing;

  select coalesce(jsonb_agg(a.slug order by a.retired_at), '[]'::jsonb) into olds
    from public.vp_venue_slug_aliases a where a.venue_id = v.id;
  insert into public.vp_admin_audit (actor_admin, actor_label, action, target, detail)
    values (p_actor_admin, left(coalesce(p_actor_label, 'admin'), 120), 'venue_address_moved', 'venue:' || v.id,
            jsonb_build_object('name', v.name, 'from', v.slug, 'to', new_slug, 'join_code', code,
                               'join_code_was_null', v.join_code is null, 'old_addresses', olds));
  return jsonb_build_object('ok', true, 'from', v.slug, 'to', new_slug, 'join_code', code, 'old_addresses', olds);
end $$;
revoke all on function public.vp_venue_move_address(uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function public.vp_venue_move_address(uuid, text, uuid, text) to service_role;

-- 4. WHICH VENUE IS AT THIS ADDRESS (current or old) -------------------------------------------------------------------
create or replace function public.vp_venue_current_slug(p_slug text)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    (select v.slug from public.vp_venues v where v.slug = lower(btrim(p_slug))),
    (select v.slug from public.vp_venue_slug_aliases a join public.vp_venues v on v.id = a.venue_id
      where a.slug = lower(btrim(p_slug))))
$$;
revoke all on function public.vp_venue_current_slug(text) from public;
grant execute on function public.vp_venue_current_slug(text) to anon, authenticated, service_role;

-- READ BACK (run after, read only):
--   select count(*) from public.vp_venue_slug_aliases;                                     -- 0 on first run
--   select tgname from pg_trigger where tgname in ('vp_slug_alias_guard','vp_venues_slug_alias_guard');   -- 2 rows
--   select has_function_privilege('anon', 'public.vp_venue_move_address(uuid,text,uuid,text)', 'execute');   -- false
