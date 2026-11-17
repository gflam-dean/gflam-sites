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
-- OWN ROWS ONLY (18 Nov 2026, review rejoin-merge-review-18nov.md finding F1; fix/215-number-change-own-rows-18nov).
-- The first draft rewrote EVERY seat and capture at the shared venues that carried the old number. Typed numbers are
-- never verified, so anyone who typed a regular's number at a join and then ran "Not my number" to their own phone
-- moved that regular's seats and list rows to their own number. Now a row moves only when it carries THIS known row's
-- id (known_id, a new nullable column on vp_players and vp_captures, written by the Worker at the join or bingo capture
-- that made the row) AND still holds the old number. Rows from before this column (known_id null) are NEVER rewritten:
-- they keep the old number. That is the safe side: a missed update costs a venue one stale number, a wrong one hands a
-- stranger someone else's seat and contact. THIS EDIT (the two columns, two indexes and the narrower WHERE) HAS NOT BEEN
-- RUN ON TEST YET: run it there twice before live. It takes a short lock on vp_players and vp_captures (add column,
-- two small partial indexes): run it outside game hours, as every migration.
-- LOCKS (review F-B, 18 Nov 2026): the first statement after the guard is set lock_timeout = '3s'. If a long read or
-- an open transaction holds either table, the paste FAILS after 3 seconds with "canceling statement due to lock
-- timeout" instead of queueing every join behind it. Then simply paste again: every statement is safe to run twice, so
-- that holds whether the SQL editor ran the paste as one transaction (nothing kept) or statement by statement.
-- The two foreign keys are added NOT VALID (the column was just added, so every row is null and there is nothing to
-- check; new rows are checked from that moment) and then validated as their own statements: VALIDATE needs only a
-- SHARE UPDATE EXCLUSIVE lock, which does not stop a join (if the editor runs the paste as ONE transaction, the
-- add-column lock is held to the end anyway: then this saves nothing and costs nothing). Each foreign key is added only when pg_constraint does not
-- already have it, and VALIDATE on a valid key does nothing, so the file is still safe to run twice.
--
-- WHAT IT ADDS (additive only: one table, one function, and one nullable column + partial index on each of
-- vp_players and vp_captures; nothing existing is altered or removed)
--   vp_players.known_id,       the vp_known_players row whose phone made this seat or this list row (null: not known,
--   vp_captures.known_id       or made before migration 215). on delete set null. Service role writes it.
--   vp_number_changes          one row per "Not my number" request: the known row, the NEW number, the SHA-256 of the
--                              code (never the code), when it expires (10 minutes), how many wrong tries (5 at most),
--                              how many texts (3 at most), when it was done and how many venue list rows moved. The
--                              old number is kept only as its last three digits (old_last3), for the record.
--   vp_number_change_apply(id) the swap, in ONE transaction, only for a change that is not done and not expired:
--                              vp_known_players.mobile := the new number; then, ONLY at venues whose shared list says
--                              they had the mobile from this player, vp_players (through vp_sessions.venue_id) and
--                              vp_captures rows that THIS known row made (known_id = its id) and that still hold the
--                              OLD number get the new one. Never a row by number alone. Any other open change for
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
--   (known_id on vp_players / vp_captures may stay: nullable, read by nothing else. To remove it, AFTER the Worker that
--   writes it is rolled back: alter table public.vp_players drop column if exists known_id;
--   alter table public.vp_captures drop column if exists known_id;)
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
set lock_timeout = '3s';

/* WHICH KNOWN PLAYER MADE THIS ROW (F1, 18 Nov 2026). Nullable, no backfill (an old row cannot be proven to be
   anyone's, so it is never moved). Indexed only where set: the apply below and the on-delete-set-null read it.
   The foreign keys: NOT VALID first (no scan under the add-column lock), validated just below (F-B, 18 Nov 2026). */
alter table public.vp_players add column if not exists known_id uuid;
alter table public.vp_captures add column if not exists known_id uuid;
do $fk$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.vp_players'::regclass and conname = 'vp_players_known_id_fkey') then
    alter table public.vp_players add constraint vp_players_known_id_fkey
      foreign key (known_id) references public.vp_known_players(id) on delete set null not valid;
  end if;
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.vp_captures'::regclass and conname = 'vp_captures_known_id_fkey') then
    alter table public.vp_captures add constraint vp_captures_known_id_fkey
      foreign key (known_id) references public.vp_known_players(id) on delete set null not valid;
  end if;
end
$fk$;
alter table public.vp_players validate constraint vp_players_known_id_fkey;
alter table public.vp_captures validate constraint vp_captures_known_id_fkey;
create index if not exists vp_players_known_idx on public.vp_players (known_id) where known_id is not null;
create index if not exists vp_captures_known_idx on public.vp_captures (known_id) where known_id is not null;

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
  'A player''s "Not my number": the new number, the hash of the texted code, tries, texts, expiry, and when it was done. One number per player (Dean 17 Nov 2026). Service role only. Migration 215.';

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

  /* only the venues that already had THIS player's mobile (typed there, or Use this with its box ticked), and there
     only the rows THIS known row made (known_id) that still hold its old number. Never every row with that number:
     a typed number is not proof, so that would let anyone move a stranger's seats and list rows (F1, 18 Nov 2026). */
  select coalesce(array_agg(e.key::uuid), '{}') into venues
    from jsonb_each(coalesce(k.shared, '{}'::jsonb)) e
   where jsonb_typeof(e.value) = 'array' and e.value ? 'mobile'
     and e.key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

  if k.mobile is not null and k.mobile <> c.new_mobile and array_length(venues, 1) > 0 then
    update public.vp_players p set mobile = c.new_mobile
      from public.vp_sessions s
     where p.session_id = s.id and s.venue_id = any(venues) and p.known_id = k.id and p.mobile = k.mobile;
    get diagnostics n1 = row_count;
    update public.vp_captures set mobile = c.new_mobile
     where venue_id = any(venues) and known_id = k.id and mobile = k.mobile;
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
  'One number per player (Dean 17 Nov 2026): a verified number change, in one transaction. The known row, then only the venues whose shared list had this player''s mobile, and there only the rows this known row made (known_id). Service role only. Migration 215.';

reset lock_timeout;

-- Read back (read-only):
--   select relrowsecurity from pg_class where relname = 'vp_number_changes';                         expects true
--   select count(*) from information_schema.role_table_grants where table_name = 'vp_number_changes'
--      and grantee in ('anon', 'authenticated');                                                       expects 0
--   select has_function_privilege('anon', 'public.vp_number_change_apply(uuid)', 'execute');           expects false
--   select prosecdef from pg_proc where proname = 'vp_number_change_apply';                            expects true
--   select count(*) from information_schema.columns where table_schema = 'public' and column_name = 'known_id'
--      and table_name in ('vp_players', 'vp_captures');                                                expects 2
--   select count(*) from pg_constraint where conname in ('vp_players_known_id_fkey', 'vp_captures_known_id_fkey')
--      and contype = 'f' and convalidated;                                                             expects 2
