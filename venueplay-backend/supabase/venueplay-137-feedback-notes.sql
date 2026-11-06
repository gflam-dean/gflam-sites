-- =====================================================================
-- Migration 137: what a player said after "How was that?" (HQ only), and "Only bad player feedback" alerts
-- ---------------------------------------------------------------------
--   LIVE (6 Nov 2026 note): RLS-BASELINE.json, dumped read-only from live on 3 Nov 2026,
--   records vp_feedback_notes. DO NOT RUN AGAIN: migration 144 widens the push filter check
--   below, and running this after 144 would narrow it back. Kept as the record of what ran.
--   As written: safe to run any number of times, any order with the billing
--   Worker: until it is run, POST /help/feedback keeps the rating itself
--   (vp_game_feedback, migration 60) and answers { ok, missing: true } for
--   the words, and HQ > Feedback says the notes table is not there yet.
--   After running: python3 venueplay-backend/tools/dump-rls-baseline.py and
--   commit RLS-BASELINE.json (one new table).
--
-- WHY. Dean, 1 Nov 2026: every rating on a phone gets one short follow-up
-- (Loved it: what did you love; Good: what would make it better; Not for me:
-- what went wrong). The tags and the line typed land here, against the rating
-- they follow (one note per rating). An email is NEVER stored here: with its
-- consent ticked it goes into a help-desk ticket and nowhere else.
--
-- HQ'S ONLY (Dean, 2 Nov 2026). There are no ticks for the venue: a venue
-- sees only COUNTS of "Loved it" and "Good", read straight from
-- vp_game_feedback (migration 60). Nothing in this table ever reaches a venue,
-- and there is no column for a name or for sharing.
--
-- LOCKED. Service role only: RLS on, no policies, anon/authenticated revoked.
-- =====================================================================

create table if not exists public.vp_feedback_notes (
  id           uuid primary key default gen_random_uuid(),
  feedback_id  uuid not null unique references public.vp_game_feedback(id) on delete cascade,
  venue_id     uuid not null references public.vp_venues(id) on delete cascade,
  session_id   uuid,
  game_id      uuid,
  format       text check (format is null or char_length(format) <= 24),
  rating       smallint not null check (rating between 1 and 3),
  tags         text[] not null default '{}' check (cardinality(tags) <= 6),
  note         text check (note is null or char_length(note) <= 300),
  wants_reply  boolean not null default false,
  ticket_id    uuid references public.vp_help_tickets(id) on delete set null,
  created_at   timestamptz not null default now()
);

create index if not exists vp_feedback_notes_venue_idx on public.vp_feedback_notes (venue_id, created_at desc);
create index if not exists vp_feedback_notes_created_idx on public.vp_feedback_notes (created_at desc);

alter table public.vp_feedback_notes enable row level security;
revoke all on public.vp_feedback_notes from public, anon, authenticated;
grant select, insert, update, delete on public.vp_feedback_notes to service_role;

-- 2. "ONLY BAD PLAYER FEEDBACK" ALERTS (Dean, 2 Nov 2026): HQ > Help desk > Alerts on this device gets
--    a third choice, so a phone can buzz for just the "2 or more Not for me tonight" alert and a "Not for
--    me" follow-up that asked for a reply. The filter's check (migration 106) allows 'all' and
--    'urgent_sales'; this adds 'bad_feedback'. Until it runs, the Worker stores 'all' for that choice and
--    tells HQ why, so no device is ever left without alerts.
alter table public.vp_help_push_subs drop constraint if exists vp_help_push_subs_filter_check;
alter table public.vp_help_push_subs add constraint vp_help_push_subs_filter_check
  check (filter in ('all', 'urgent_sales', 'bad_feedback'));

-- Read back (service role): GET /rest/v1/vp_feedback_notes?select=id,tags,note,wants_reply&limit=1 answers 200.
-- Read back: insert-and-delete is not needed; check pg_constraint for vp_help_push_subs_filter_check
--   (select pg_get_constraintdef(oid) from pg_constraint where conname = 'vp_help_push_subs_filter_check').

-- Rollback:
--   drop table if exists public.vp_feedback_notes;
--   update public.vp_help_push_subs set filter = 'all' where filter = 'bad_feedback';
--   alter table public.vp_help_push_subs drop constraint if exists vp_help_push_subs_filter_check;
--   alter table public.vp_help_push_subs add constraint vp_help_push_subs_filter_check check (filter in ('all', 'urgent_sales'));
