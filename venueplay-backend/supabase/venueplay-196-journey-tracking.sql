-- Migration 196: JOURNEY TRACKING (INBOX 413, 15 Nov 2026). WRITTEN, NOT RUN. Safe to run any time (new tables only, nothing existing is touched).
--
--   vp_track_links      one row per tracked link: (lead, campaign, email step, link label). venueplay.com.au/offer-nov/MPYXPG.
--                       Only a salted SHA-256 of the code is kept, never the code, never an email address. Expires, can be revoked.
--   vp_journey_events   one row per step a visitor reaches. An anonymous session id (random, per tab), the step name, which link
--                       (if any) they arrived by, where from (referrer family), the AU state / country Cloudflare reports, the
--                       device kind. NO IP, NO user agent, NO fingerprint, NO name / email / mobile / venue name in an event.
--                       The one free-text field is props.q on 'venue_search_none' (what they typed when our list had no match,
--                       digits and @ stripped, 60 chars): HQ only, so missing venues get added. PURGE: delete rows older than
--                       400 days; props.q is cleared after 90 days (select cron or the monthly job).
-- Both tables: RLS on, nothing for anon / authenticated, service_role only (the Worker). Same lock-down as vp_quick_*.
-- This SUPERSEDES the 412 agent's vp_quick_events (migration 195): same step names, one store. 195 may still be run; nothing here needs it.

create table if not exists public.vp_track_links (
  id           bigserial primary key,
  code_hash    text not null unique check (code_hash ~ '^[a-f0-9]{64}$'),
  lead_ref     text check (lead_ref is null or char_length(lead_ref) <= 80),   -- an opaque id from the lead list, NEVER the email
  venue_name   text check (venue_name is null or char_length(venue_name) <= 120),
  first_name   text check (first_name is null or char_length(first_name) <= 60),
  state        text check (state is null or state in ('NSW','VIC','QLD','SA','WA','TAS','NT','ACT','NZ')),
  postcode     text check (postcode is null or postcode ~ '^[0-9]{4}$'),
  suburb       text check (suburb is null or char_length(suburb) <= 80),
  likely_games text[] not null default '{}',
  campaign     text not null check (char_length(campaign) between 1 and 60),
  email_step   integer not null default 1 check (email_step between 0 and 20),
  link_label   text not null default 'link' check (link_label ~ '^[a-z0-9-]{1,40}$'),
  page         text not null default 'offer-nov' check (page ~ '^[a-z0-9-]{1,40}$'),
  sent_at      timestamptz,                                                     -- when the email went out (scanner timing)
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default (now() + interval '120 days'),
  revoked_at   timestamptz,
  venue_id     uuid references public.vp_venues(id) on delete set null          -- set when this lead makes an account
);
create index if not exists vp_track_links_campaign on public.vp_track_links (campaign, email_step);
create index if not exists vp_track_links_venue    on public.vp_track_links (venue_id) where venue_id is not null;
alter table public.vp_track_links enable row level security;
revoke all on public.vp_track_links from public, anon, authenticated;
grant select, insert, update on public.vp_track_links to service_role;
grant usage, select on sequence public.vp_track_links_id_seq to service_role;

create table if not exists public.vp_journey_events (
  id         bigserial primary key,
  sid        text not null check (sid ~ '^[a-f0-9]{24}$'),
  link_id    bigint references public.vp_track_links(id) on delete set null,
  event      text not null check (event ~ '^[a-z0-9_]{2,40}$'),
  props      jsonb not null default '{}'::jsonb check (pg_column_size(props) <= 600),
  src        text not null default 'website' check (src in ('website','cold_email','coaster')),
  path       text check (path is null or char_length(path) <= 80),
  ref_source text check (ref_source is null or ref_source in ('google','facebook','instagram','coaster','email','direct','other')),
  region     text check (region is null or char_length(region) <= 8),         -- AU state code, else the country code
  device     text check (device is null or device in ('mobile','tablet','desktop')),
  scanner    boolean not null default false,                                   -- true: a mail scanner, never a person
  venue_id   uuid references public.vp_venues(id) on delete set null,
  at         timestamptz not null default now()
);
create index if not exists vp_journey_events_at    on public.vp_journey_events (at desc);
create index if not exists vp_journey_events_sid   on public.vp_journey_events (sid, at);
create index if not exists vp_journey_events_link  on public.vp_journey_events (link_id) where link_id is not null;
create index if not exists vp_journey_events_venue on public.vp_journey_events (venue_id) where venue_id is not null;
alter table public.vp_journey_events enable row level security;
revoke all on public.vp_journey_events from public, anon, authenticated;
grant select, insert, update on public.vp_journey_events to service_role;
grant usage, select on sequence public.vp_journey_events_id_seq to service_role;

-- Read back (read-only):
--   select count(*) from vp_track_links;  select count(*) from vp_journey_events;
--   select tablename, rowsecurity from pg_tables where tablename in ('vp_track_links','vp_journey_events');
