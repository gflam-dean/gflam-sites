-- =====================================================================
-- Migration 228: the ONBOARDING STOP LIST (Dean, 23 Nov 2026)
-- ---------------------------------------------------------------------
-- WHAT. A person who taps "Stop these reminders" (or replies STOP to one) on an onboarding reminder, the day-3
-- "you have not signed in" one or the free-month-ending one, by email or by text, goes on THIS list. Nothing else.
--
-- WHY A SEPARATE LIST. vp_unsubscribes is the cold-email / marketing opt-out list. Somebody who asked us for an
-- account and says "no more reminders" has NOT said "no more marketing", and a cold-email STOP is not a refusal of an
-- account they asked for. So the two never mix: this list is read only by the reminder routes (and the Mac's reminder
-- tool), it never writes to vp_unsubscribes, and it never touches account, billing or sign-in emails.
--
-- ONE ROW PER VENUE (unique venue_id). email and mobile are the venue's login email and mobile at the time, lower-cased /
-- +61 form, so a reminder to either is refused even if the venue row is later renamed. venue_id is null only for a
-- reply STOP from an address we could not match to a venue (matched by email then).
--
-- RLS: on, NO policies. Only the service role (the billing Worker) reads or writes it. The public page posts to the
-- Worker, never to this table, so an outsider cannot ask "is this venue on the list".
--
-- WRITTEN, NOT RUN. Not run on TEST, not run on LIVE. The Worker refuses every reminder until it exists (fail closed).
-- NUMBER: 228 (check no other branch took it before pasting). Safe to run twice.
-- =====================================================================
create table if not exists public.vp_onboarding_stops (
  id          uuid primary key default gen_random_uuid(),
  venue_id    uuid,
  email       text,
  mobile      text,
  source      text,                        -- 'link', 'one-click', 'email-reply', 'sms-reply', 'mac-cold-stop'
  stop_at     timestamptz,                 -- for 'mac-cold-stop': the date of the cold-list STOP that put the venue here
  created_at  timestamptz not null default now()
);

create unique index if not exists vp_onboarding_stops_venue_uniq on public.vp_onboarding_stops (venue_id);
-- A 228 pasted earlier (before stop_at existed) is brought up to date by this, so a re-run is always safe.
alter table public.vp_onboarding_stops add column if not exists stop_at timestamptz;

create index if not exists vp_onboarding_stops_email_idx on public.vp_onboarding_stops (lower(email));
create index if not exists vp_onboarding_stops_mobile_idx on public.vp_onboarding_stops (mobile);

alter table public.vp_onboarding_stops enable row level security;

-- THE SYNC HEARTBEAT (23 Nov 2026): the Mac posts here every sync run, even with nothing to change. The Worker's reminders (card reminders, nudge,
-- nudge text) send only while it is under 26 hours old, and otherwise hold (not drop) until the Mac has checked its cold lists again.
create table if not exists public.vp_onboarding_sync (
  id           int primary key default 1 check (id = 1),
  last_sync_at timestamptz not null default now()
);
alter table public.vp_onboarding_sync enable row level security;

comment on table public.vp_onboarding_stops is
  'Onboarding reminder opt-outs (day-3 and free-month-ending, email and text). Separate from vp_unsubscribes (cold/marketing). Service role only.';
