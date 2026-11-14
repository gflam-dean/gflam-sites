-- Migration 195: "Play a quick game" (INBOX 412, 14 Nov 2026). WRITTEN, NOT RUN. Safe to run any time (all additive, all nullable).
--
--   vp_quick_events  one row per step reached in the quick game: an anonymous session id, the step name, where it came from,
--                    how many taps so far, and (once signed in) the venue. NO name, mobile, venue name, address or IP.
--   vp_quick_leads   the per-lead links in cold emails: venueplay.com.au/quick?l=<code>. Only the SHA-256 of a random code
--                    (with a salt held in the Worker) is kept, never the code, never an email. Expires, can be revoked.
--   vp_signup_starts.lead_id / vp_prospects.lead_source   which lead a start came from, and "cold_email" on the prospect row
--                    (HQ > Prospects: "came from cold email").
--   venueplay_founding.unverified_email / unverified_email_at   the address Stripe's card page collected on a quick-game account.
--                    A NOTE ONLY: never the login, never confirmed, no account mail goes to it until its owner confirms by link
--                    (Tue 24). One account per address (partial unique index), so nobody can pre-claim a stranger's address twice.
-- The Worker answers every route here with "not switched on" / nothing recorded until this has run.

create table if not exists public.vp_quick_events (
  id         bigserial primary key,
  sid        text not null check (sid ~ '^[a-f0-9]{24}$'),
  step       text not null check (step in ('page_opened','button_tapped','form_started','form_sent','account_made','signed_in',
               'demo_q1','demo_q2','demo_q3','demo_q4','demo_q5','podium_seen','games_answered','card_screen_seen','card_added',
               'choice_another','choice_info','choice_setup','page_left')),
  src        text not null default 'website' check (src in ('website','cold_email','coaster')),
  taps       integer not null default 0 check (taps between 0 and 500),
  last_step  text,
  venue_id   uuid references public.vp_venues(id) on delete set null,
  at         timestamptz not null default now()
);
create index if not exists vp_quick_events_at  on public.vp_quick_events (at desc);
create index if not exists vp_quick_events_sid on public.vp_quick_events (sid, at);
alter table public.vp_quick_events enable row level security;
revoke all on public.vp_quick_events from public, anon, authenticated;
grant select, insert on public.vp_quick_events to service_role;
grant usage, select on sequence public.vp_quick_events_id_seq to service_role;

create table if not exists public.vp_quick_leads (
  id                bigserial primary key,
  code_hash         text not null unique check (code_hash ~ '^[a-f0-9]{64}$'),
  first_name        text check (first_name is null or char_length(first_name) <= 60),
  venue_name        text check (venue_name is null or char_length(venue_name) <= 120),
  postcode          text check (postcode is null or postcode ~ '^[0-9]{4}$'),
  suburb            text check (suburb is null or char_length(suburb) <= 80),
  source            text not null default 'cold_email',
  created_at        timestamptz not null default now(),
  expires_at        timestamptz not null default (now() + interval '60 days'),
  revoked_at        timestamptz,
  claimed_venue_id  uuid references public.vp_venues(id) on delete set null,
  claimed_at        timestamptz
);
alter table public.vp_quick_leads enable row level security;
revoke all on public.vp_quick_leads from public, anon, authenticated;
grant select, insert, update on public.vp_quick_leads to service_role;
grant usage, select on sequence public.vp_quick_leads_id_seq to service_role;

alter table public.vp_signup_starts add column if not exists lead_id bigint references public.vp_quick_leads(id) on delete set null;
alter table public.vp_prospects     add column if not exists lead_source text check (lead_source is null or lead_source in ('cold_email','coaster','website'));

alter table public.venueplay_founding add column if not exists unverified_email text check (unverified_email is null or char_length(unverified_email) <= 200);
alter table public.venueplay_founding add column if not exists unverified_email_at timestamptz;
create unique index if not exists venueplay_founding_unverified_email_uq on public.venueplay_founding (lower(unverified_email)) where unverified_email is not null;

-- Read back (read-only):
--   select count(*) from vp_quick_events;  select count(*) from vp_quick_leads;
--   select column_name from information_schema.columns where table_name in ('vp_signup_starts','vp_prospects') and column_name in ('lead_id','lead_source');
