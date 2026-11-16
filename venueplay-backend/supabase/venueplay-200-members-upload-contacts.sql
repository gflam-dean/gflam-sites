-- =====================================================================
-- Migration 200: the members list upload keeps the details the venue's game join asks for (Jobs row 445)
-- ---------------------------------------------------------------------
-- Dean, 16 Nov 2026: "when a venue uploads its members spreadsheet it maps first name, surname, email and phone; a
-- single full-name column must be split into first name + surname." And: "remember that setting from the first time
-- they import members ... we should import the same data as they are asking from our system. So then if John signs up
-- and his phone number matches what he's put into the game, we know John's a member."
--
-- NOT RUN. Written for the Thursday 19 Nov admin release, branch fix/members-upload-thu19. Run it on TEST first
-- (tools/staging/run-on-test.py), then Dean pastes it on live EARLY, before the push. Safe to run twice.
-- NUMBER: 199 is the highest on any branch or worktree (fix/thu19-billing-credit, venueplay-199-billing-credits.sql),
-- and nothing at 200 or above in INBOX.md or NEEDS-DEAN.md, checked 16 Nov 2026 14:00 Brisbane. So 200.
--
-- WHAT IT ADDS
--   vp_members            email, mobile, postcode            every field venueplay can collect (the six collect_* of Game
--                                                             settings), kept from the venue's file whatever it has switched
--                                                             on today (Dean, 16 Nov 2026). Date of birth, suburb and state
--                                                             are not fields venueplay can ask, so none is added here.
--                                                             Mobile is the purchase raffle's form, +614xxxxxxxx.
--                         marketing_optin (+ _at, _source)   the VENUE's own "Send me offers from {venue}" consent for that
--                                                             member, from the club system's "Subscribed" column, with where
--                                                             it came from ("members list import, 2026-11-19"). Null = not
--                                                             said. An import never turns a false back into a true.
--   vp_member_rosters     import_map                         the venue's column choices by HEADING ONLY (never a value from
--                                                             the file), put back on the next upload
--   vp_players            member_id                          a player whose mobile matches a member of THAT venue's list
--   vp_captures           member_id                          a sign-up whose mobile matches a member of that venue's list
--   vp_members_fill()                                         fills an existing member's EMPTY details in one call (the
--                                                             Worker's re-upload), never overwriting
--   vp_member_name()                                          the SQL copy of the Worker's formatMemberName, now also splitting
--                                                             a one-box "Lee,Daniel" into Daniel / Lee (item 4 of the job)
--
-- PRIVACY (player and member data is tier one). No new policy and no new grant on any table: vp_members and
-- vp_member_rosters keep their policies exactly (the venue's own staff read their own list; vp_members_admin_all is
-- unchanged and no HQ page selects these columns: tools/test-members-upload.js checks every HQ file). The new columns go
-- with the rows in the 90-day purge after a venue leaves (the game Worker's purgeMembers blanks them and then counts
-- what is left). vp_members_fill is SECURITY INVOKER and executable by service_role only, so RLS-BASELINE.json's
-- security_definer_functions list does not change and nothing needs dumping for policies. COLUMNS-BASELINE.json
-- is dumped from live after it runs (dump-rls-baseline.py), as for every column migration.
--
-- ORDER: either order is safe. Before this runs the Worker reads none of these columns for a pasted list, links no
-- member (the lookup fails closed to "not a member"), refuses an upload that carries emails or mobiles with "Nothing
-- was added", and the purge falls back to the names; the Account page's download falls back to number and name.
-- =====================================================================

alter table public.vp_members
  add column if not exists email                  text,
  add column if not exists mobile                 text,
  add column if not exists postcode               text,
  add column if not exists marketing_optin        boolean,
  add column if not exists marketing_optin_at     timestamptz,
  add column if not exists marketing_optin_source text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'vp_members_email_chk') then
    alter table public.vp_members add constraint vp_members_email_chk
      check (email is null or (char_length(email) <= 200 and email ~ '^[^[:space:]@,;<>"]+@[^[:space:]@,;<>"]+\.[^[:space:]@,;<>"]+$'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'vp_members_mobile_chk') then
    alter table public.vp_members add constraint vp_members_mobile_chk
      check (mobile is null or mobile ~ '^\+614[0-9]{8}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'vp_members_postcode_chk') then
    alter table public.vp_members add constraint vp_members_postcode_chk
      check (postcode is null or postcode ~ '^[0-9]{4}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'vp_members_optin_source_chk') then
    alter table public.vp_members add constraint vp_members_optin_source_chk
      check (marketing_optin_source is null or char_length(marketing_optin_source) <= 120);
  end if;
end $$;

-- the member match: one venue's list by mobile
create index if not exists vp_members_roster_mobile_idx on public.vp_members (roster_id, mobile) where mobile is not null;

alter table public.vp_member_rosters add column if not exists import_map jsonb;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'vp_member_rosters_import_map_chk') then
    alter table public.vp_member_rosters add constraint vp_member_rosters_import_map_chk
      check (import_map is null or (jsonb_typeof(import_map) = 'object' and octet_length(import_map::text) <= 8000));
  end if;
end $$;

-- a member removed from the list (POST /host/members/remove deletes the row) leaves the player's row with no link
alter table public.vp_players  add column if not exists member_id uuid references public.vp_members(id) on delete set null;
alter table public.vp_captures add column if not exists member_id uuid references public.vp_members(id) on delete set null;
create index if not exists vp_players_member_idx  on public.vp_players  (member_id) where member_id is not null;
create index if not exists vp_captures_member_idx on public.vp_captures (member_id) where member_id is not null;

-- ---------------------------------------------------------------------
-- A re-upload fills what is EMPTY on a member already on the list. The Worker decides what to send (the same rules as
-- a new member: email, mobile and postcode only in their own form, consent only with a way to contact them); this applies it in one
-- statement with the guards again, so a member changed between the Worker's read and this write keeps what they have:
--   email / mobile / postcode   coalesce: an existing value is never overwritten
--   consent                     set only when the row sends it (set_offers), and a "yes" only over a "not said" (null):
--                               an unsubscribe is never turned back into a yes
-- p_rows: [{member_number, email, mobile, postcode, set_offers, offers}]. Returns how many members changed.
-- ---------------------------------------------------------------------
create or replace function public.vp_members_fill(p_roster_id uuid, p_rows jsonb, p_source text)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  n integer;
begin
  with r as (
    select * from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb))
      as x(member_number integer, email text, mobile text, postcode text, set_offers boolean, offers boolean)
  )
  update public.vp_members m set
    email    = coalesce(m.email, r.email),
    mobile   = coalesce(m.mobile, r.mobile),
    postcode = coalesce(m.postcode, r.postcode),
    marketing_optin = case
      when coalesce(r.set_offers, false) and r.offers is false then false
      when coalesce(r.set_offers, false) and r.offers is true and m.marketing_optin is null
           and coalesce(m.email, r.email, m.mobile, r.mobile) is not null then true
      else m.marketing_optin end,
    marketing_optin_at = case
      when coalesce(r.set_offers, false) and r.offers is false and m.marketing_optin is distinct from false then now()
      when coalesce(r.set_offers, false) and r.offers is true and m.marketing_optin is null
           and coalesce(m.email, r.email, m.mobile, r.mobile) is not null then now()
      else m.marketing_optin_at end,
    marketing_optin_source = case
      when coalesce(r.set_offers, false) and r.offers is false and m.marketing_optin is distinct from false then left(p_source, 120)
      when coalesce(r.set_offers, false) and r.offers is true and m.marketing_optin is null
           and coalesce(m.email, r.email, m.mobile, r.mobile) is not null then left(p_source, 120)
      else m.marketing_optin_source end,
    updated_at = now()
  from r
  where m.roster_id = p_roster_id
    and m.member_number = r.member_number;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.vp_members_fill(uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.vp_members_fill(uuid, jsonb, text) to service_role;

-- ---------------------------------------------------------------------
-- A member's name as the venue asks for it: the SQL copy of formatMemberName in the game Worker (migration 76), now
-- with the one-box "Last,First" split first. Exactly one comma with a name either side is surname, first name:
--   "Lee,Daniel" / "LEE, Daniel"  ->  Daniel / Lee   ("Daniel L", "D Lee", "Daniel Lee")
-- then, as before, a one-box "John Smith" splits off its last word. Checked case by case against the Worker by
-- venueplay-backend/worker/one-trip-draws.test.js.
-- ---------------------------------------------------------------------
create or replace function public.vp_member_name(p_first text, p_last text, p_mode text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  f     text := btrim(coalesce(p_first, ''));
  l     text := btrim(coalesce(p_last, ''));
  parts text[];
begin
  if l = '' and position(',' in f) > 0 then
    parts := string_to_array(f, ',');
    if array_length(parts, 1) = 2 and btrim(parts[1]) <> '' and btrim(parts[2]) <> '' then
      l := btrim(parts[1]);
      f := btrim(parts[2]);
    end if;
  end if;
  if l = '' and f ~ '\s' then
    parts := regexp_split_to_array(f, '\s+');
    l := parts[array_length(parts, 1)];
    f := array_to_string(parts[1:array_length(parts, 1) - 1], ' ');
  end if;
  if p_mode = 'full' then
    return btrim(f || ' ' || l);
  elsif p_mode = 'abbrev_first' then
    return btrim(case when f <> '' then left(f, 1) || ' ' else '' end || l);
  end if;
  return btrim(f || ' ' || case when l <> '' then left(l, 1) else '' end);
end;
$$;
revoke all on function public.vp_member_name(text, text, text) from public, anon, authenticated;
grant execute on function public.vp_member_name(text, text, text) to service_role;

notify pgrst, 'reload schema';

-- READ-BACK (read only, after it runs): 6 + 1 + 1 + 1 columns, 2 functions
--   select table_name, column_name from information_schema.columns
--    where table_schema = 'public' and ((table_name = 'vp_members' and column_name in ('email','mobile','postcode',
--          'marketing_optin','marketing_optin_at','marketing_optin_source')) or (table_name = 'vp_member_rosters' and
--          column_name = 'import_map') or (table_name in ('vp_players','vp_captures') and column_name = 'member_id'));
--   select proname, prosecdef from pg_proc where proname in ('vp_members_fill', 'vp_member_name');   -- both prosecdef false
--   select public.vp_member_name('Lee,Daniel', '', 'abbrev_last');   -- Daniel L
--
-- ROLLBACK (nothing reads these columns before the Thursday 19 Nov release):
--   drop function if exists public.vp_members_fill(uuid, jsonb, text);
--   alter table public.vp_captures drop column if exists member_id;
--   alter table public.vp_players drop column if exists member_id;
--   alter table public.vp_member_rosters drop column if exists import_map;
--   alter table public.vp_members drop column if exists email, drop column if exists mobile, drop column if exists postcode,
--     drop column if exists marketing_optin, drop column if exists marketing_optin_at, drop column if exists marketing_optin_source;
--   then re-run the vp_member_name body from migration 76.
