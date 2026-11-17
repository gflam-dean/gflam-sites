-- =====================================================================
-- Migration 215: ONE phone number per venueplay player, changed only with a text code (Dean, 17 Nov 2026 ~23:15)
-- ---------------------------------------------------------------------
-- Dean decided each player has ONE mobile, the same at every venue. It replaces open question 28's "keep both numbers"
-- (branch feature/known-phone-keep-both-q28, migration 210 there: SHELVED, never run on live). The flow, as WhatsApp,
-- Uber and the banks do it: the join screen shows "Playing as Sarah, 04.. ... 123" with a small "Not my number"; the
-- player types the new number; a six-digit code is texted to the NEW number; typed back, the new number replaces the old
-- one on the known row AND on the contact lists of every venue that already had it from this player. Consent is kept
-- per player (vp_player_consents.known_id, which never named a number), so each venue's answer stays as given.
--
-- WRITTEN, RUN ON TEST ONLY (rkfaftxgzpsmmrzudlqy, twice). NOT RUN ON LIVE: ships on Dean's yes, early, before the Worker.
-- Branch feature/one-number-per-player, on release/sun-22nov-assembled-d (needs migration 202's two tables).
-- NUMBER: 210 is taken twice (prospect-no-contact, and the shelved q28), 211 is held for the loser of that clash
-- (sites-wt-q32 MIGRATIONS.md), 212 is venue-old-addresses; no 213 on any branch or worktree (checked 17 Nov 2026 23:20). RENUMBERED 214 then 215 (main claimed 214 for feature/hq-coaster-leads, 18 Nov): q9 (feature/members-upload-more-fields-q9) claimed 213 first. The TEST run was as 213; only comments changed, objects are identical.
-- The file as committed carries the VP-STAGING-GUARD block, which REFUSES on the live project: the live run is the
-- statements after the guard's END marker.
--
-- WHAT IT ADDS (additive only: one table and one function; nothing existing is altered or removed)
--   vp_number_changes          one row per "Not my number" request: the known row, the NEW number, the SHA-256 of the
--                              code (never the code), when it expires (10 minutes), how many wrong tries (5 at most),
--                              how many texts (3 at most), when it was done and how many venue list rows moved. The
--                              old number is kept only as its last three digits (old_last3), for the record.
--   vp_number_change_apply(id) the swap, in ONE transaction, only for a change that is not done and not expired:
--                              vp_known_players.mobile := the new number; then, ONLY at venues whose shared list says
--                              they had the mobile from this player, vp_players (through vp_sessions.venue_id) and
--                              vp_captures rows holding the OLD number get the new one. Any other open change for
--                              the same row is closed. Answers { ok, rows } or { ok:false, why }.
--
-- PRIVACY (player data is tier one). RLS on, no policies, everything revoked from public, anon and authenticated; the
-- function is security definer with a pinned search_path, EXECUTE revoked from public/anon/authenticated and granted to
-- service_role only. The game Worker is the only caller. RLS-BASELINE.json: one more table with RLS on and no grants,
-- and one definer function: dump the baseline after it runs on live.
--
-- ORDER: run BEFORE the game Worker that uses it. Before it runs the Worker's /join/number/* routes answer "not
-- available" and the phone never shows "Not my number" (the switch NUMBER_CHANGE_SMS_ON is also off by default).
-- Rollback (after the Worker is rolled back or the switch is off):
--   drop function if exists public.vp_number_change_apply(uuid); drop table if exists public.vp_number_changes;
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

create table if not exists public.vp_number_changes (
  id            uuid primary key default gen_random_uuid(),
  known_id      uuid not null references public.vp_known_players(id) on delete cascade,
  new_mobile    text not null check (new_mobile ~ '^\+614[0-9]{8}$'),
  old_last3     text check (old_last3 is null or old_last3 ~ '^[0-9]{3}$'),
  code_hash     text not null check (code_hash ~ '^[0-9a-f]{64}$'),
  attempts      int not null default 0 check (attempts between 0 and 5),
  sends         int not null default 1 check (sends between 0 and 3),
  ip_hash       text check (ip_hash is null or ip_hash ~ '^[0-9a-f]{64}$'),
  created_at    timestamptz not null default now(),
  last_sent_at  timestamptz not null default now(),
  expires_at    timestamptz not null,
  done_at       timestamptz,
  rows_changed  int,
  check (expires_at > created_at and expires_at <= created_at + interval '30 minutes')
);
create index if not exists vp_number_changes_known_idx on public.vp_number_changes (known_id, created_at desc);
create index if not exists vp_number_changes_mobile_idx on public.vp_number_changes (new_mobile, created_at desc);

alter table public.vp_number_changes enable row level security;
revoke all on public.vp_number_changes from public, anon, authenticated;

comment on table public.vp_number_changes is
  'A player''s "Not my number": the new number, the hash of the texted code, tries, texts, expiry, and when it was done. One number per player (Dean 17 Nov 2026). Service role only. Migration 214.';

create or replace function public.vp_number_change_apply(p_change uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  c        public.vp_number_changes%rowtype;
  k        public.vp_known_players%rowtype;
  venues   uuid[];
  n1       int := 0;
  n2       int := 0;
begin
  select * into c from public.vp_number_changes where id = p_change for update;
  if not found then return jsonb_build_object('ok', false, 'why', 'none'); end if;
  if c.done_at is not null then return jsonb_build_object('ok', true, 'rows', coalesce(c.rows_changed, 0), 'already', true); end if;
  if c.expires_at < now() then return jsonb_build_object('ok', false, 'why', 'expired'); end if;
  select * into k from public.vp_known_players where id = c.known_id for update;
  if not found then return jsonb_build_object('ok', false, 'why', 'none'); end if;

  /* only the venues that already had THIS player's mobile (typed there, or Use this with its box ticked) */
  select coalesce(array_agg(e.key::uuid), '{}') into venues
    from jsonb_each(coalesce(k.shared, '{}'::jsonb)) e
   where jsonb_typeof(e.value) = 'array' and e.value ? 'mobile'
     and e.key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

  if k.mobile is not null and k.mobile <> c.new_mobile and array_length(venues, 1) > 0 then
    update public.vp_players p set mobile = c.new_mobile
      from public.vp_sessions s
     where p.session_id = s.id and s.venue_id = any(venues) and p.mobile = k.mobile;
    get diagnostics n1 = row_count;
    update public.vp_captures set mobile = c.new_mobile
     where venue_id = any(venues) and mobile = k.mobile;
    get diagnostics n2 = row_count;
  end if;

  update public.vp_known_players set mobile = c.new_mobile, last_seen_at = now() where id = k.id;
  update public.vp_number_changes set done_at = now(), rows_changed = n1 + n2 where id = c.id;
  update public.vp_number_changes set attempts = 5   -- any other open change for this player can no longer be confirmed
   where known_id = k.id and id <> c.id and done_at is null;
  return jsonb_build_object('ok', true, 'rows', n1 + n2);
end
$fn$;

revoke all on function public.vp_number_change_apply(uuid) from public, anon, authenticated;
grant execute on function public.vp_number_change_apply(uuid) to service_role;

comment on function public.vp_number_change_apply(uuid) is
  'One number per player (Dean 17 Nov 2026): a verified number change, in one transaction. The known row, then only the venues whose shared list had this player''s mobile. Service role only. Migration 214.';

-- Read back (read-only):
--   select relrowsecurity from pg_class where relname = 'vp_number_changes';                         expects true
--   select count(*) from information_schema.role_table_grants where table_name = 'vp_number_changes'
--      and grantee in ('anon', 'authenticated');                                                       expects 0
--   select has_function_privilege('anon', 'public.vp_number_change_apply(uuid)', 'execute');           expects false
--   select prosecdef from pg_proc where proname = 'vp_number_change_apply';                            expects true
