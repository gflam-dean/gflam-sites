-- =====================================================================
-- Migration 134: the monthly email sign-up on the sales pages (vp_subscribers)
-- ---------------------------------------------------------------------
--   NOT RUN. Safe to run any number of times. Either order with the billing
--   Worker: until this is run, POST /subscribe answers "not ready", keeps and
--   sends nothing, and the page asks the person to email hello@ instead;
--   HQ > Subscribers says "Run migration 134 first".
--   Number 134: 132 is fix/join-cache-31oct, 133 is feature/venue-reports-31oct
--   (checked every branch and worktree, 31 Oct 2026).
--   After running: python3 venueplay-backend/tools/dump-rls-baseline.py and
--   commit RLS-BASELINE.json (one new table, one view, one trigger function,
--   RLS on, no grants to anon or authenticated).
--
-- WHY. Venue owners and managers who like VenuePlay but are not ready to ring
-- us or open an account ("too scared to call us"). The home page, the offer
-- page and See a night carry a small form: their email, and their venue if
-- they like. They get the ONE monthly VenuePlay email (the "What's new at
-- VenuePlay" news from migration 133), never a second newsletter.
--
-- KEPT APART FROM GFLAM TOURING. The Touring and Drag Bingo sites use the
-- shared `signups` table; VenuePlay subscribers are a different business's
-- list and live here, written only by the billing Worker.
--
-- WHAT A ROW HOLDS. The address (lower case, once), the venue name as typed
-- (optional), which page and which utm tags, the exact consent words shown
-- under the button and their version, when, and the country and Australian
-- state Cloudflare puts on the request (never an IP address).
--   status 'active'  on the list (whether they get the email is the rule below)
--   status 'held'    kept but never emailed (held_reason says why); nothing
--                    holds a row today, it is there for HQ to use by hand
--   consent_at       when they last said yes: a new sign-up after an
--                    unsubscribe sets it again, and resubscribed_at with it
--   unsubscribed_at  their LATEST unsubscribe, set by the trigger below from
--                    whichever page or link wrote it
--
-- THE RULE (Dean, 31 Oct 2026: someone who unsubscribed and signs up again is
-- added automatically). A subscriber gets the monthly email only while
-- consent_at is LATER than their latest unsubscribe, from either record. The
-- old vp_unsubscribes row is never deleted: it stays the record of the first
-- request, and every other check that reads it (the win-back, the venue
-- marketing export, cold outreach) still leaves the address out. A later
-- unsubscribe wins again.
--
-- LOCKED. Only the service role (the billing Worker) reaches a row: RLS on,
-- no policies, and anon/authenticated named in the revoke (Supabase grants
-- them explicitly, so a revoke from public alone does nothing; migration 32).
-- =====================================================================

create table if not exists public.vp_subscribers (
  id               uuid primary key default gen_random_uuid(),
  email            text not null
                     check (char_length(email) between 6 and 254 and email = lower(btrim(email)) and email ~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$'),
  venue_name       text check (venue_name is null or char_length(venue_name) <= 120),
  source           text not null default 'site' check (source ~ '^[a-z0-9-]{1,40}$'),
  utm              jsonb not null default '{}'::jsonb
                     check (jsonb_typeof(utm) = 'object' and char_length(utm::text) <= 600),
  consent_text     text not null check (char_length(consent_text) between 20 and 600),
  consent_version  text not null check (char_length(consent_version) between 1 and 20),
  consent_at       timestamptz not null default now(),
  country          text check (country is null or country ~ '^[A-Z]{2}$'),
  region           text check (region is null or char_length(region) <= 40),
  status           text not null default 'active' check (status in ('active', 'held')),
  held_reason      text check (held_reason is null or char_length(held_reason) <= 60),
  confirm_sent_at  timestamptz,
  unsubscribed_at  timestamptz,
  resubscribed_at  timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- One row per address. The Worker stores it lower-cased (the check above), so a plain unique
-- index on the column is enough, and PostgREST can name it.
create unique index if not exists vp_subscribers_email_uniq on public.vp_subscribers (email);
create index if not exists vp_subscribers_created_idx on public.vp_subscribers (created_at desc);

alter table public.vp_subscribers enable row level security;
revoke all on public.vp_subscribers from public, anon, authenticated;
grant select, insert, update, delete on public.vp_subscribers to service_role;

-- ---------------------------------------------------------------------
-- A REPEAT UNSUBSCRIBE MUST COUNT. vp_unsubscribes has one row per address
-- (a unique index on lower(email), migration 81), so a second opt-out used to
-- bounce off it as a 409 and leave no date. Now that a sign-up can bring
-- someone back, the LATEST opt-out is what decides, so:
--   last_unsubscribed_at  on the first row, the date of the latest repeat
-- and a BEFORE INSERT trigger that, for an address already on the list, writes
-- that date on the first row and skips the duplicate (the first row is never
-- changed otherwise, and never deleted). For every opt-out it also stamps the
-- subscriber's own unsubscribed_at. It is written by the public
-- venueplay.com.au/unsubscribe page (anon insert) and by the Worker's one-click
-- link, so it lives in the database and covers both.
-- IT CAN NEVER STOP AN UNSUBSCRIBE BEING RECORDED: any error inside is
-- swallowed and the insert goes ahead exactly as it did before this ran.
-- ---------------------------------------------------------------------
alter table public.vp_unsubscribes add column if not exists last_unsubscribed_at timestamptz;

create or replace function public.vp_subscribers_mark_unsubscribed()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  e text := lower(btrim(new.email));
begin
  begin
    update public.vp_subscribers
       set unsubscribed_at = now(), updated_at = now()
     where email = e;
    if exists (select 1 from public.vp_unsubscribes u where lower(u.email) = e) then
      update public.vp_unsubscribes set last_unsubscribed_at = now() where lower(email) = e;
      return null;   -- already on the list: the first row stays the record, with this date on it
    end if;
  exception when others then
    null;
  end;
  return new;
end;
$fn$;

revoke all on function public.vp_subscribers_mark_unsubscribed() from public, anon, authenticated;

drop trigger if exists vp_subscribers_mark_unsubscribed on public.vp_unsubscribes;
create trigger vp_subscribers_mark_unsubscribed
  before insert on public.vp_unsubscribes
  for each row execute function public.vp_subscribers_mark_unsubscribed();

-- ---------------------------------------------------------------------
-- THE MONTHLY LIST IN SQL, for a read-only look (the Worker's
-- vpsMonthlyRecipients is what the monthly sender uses, and it also leaves out
-- anyone who is the contact on an active venue, who gets the news inside their
-- own report). security_invoker, so it is no wider than the table: only the
-- service role reads it.
-- ---------------------------------------------------------------------
create or replace view public.v_vp_subscribers_monthly
  with (security_invoker = true) as
  select s.id, s.email, s.venue_name, s.source, s.created_at
    from public.vp_subscribers s
   where s.status = 'active'
     and s.consent_at > coalesce(s.unsubscribed_at, '-infinity'::timestamptz)
     and not exists (select 1 from public.vp_unsubscribes u
                      where lower(btrim(u.email)) = s.email
                        and greatest(u.created_at, coalesce(u.last_unsubscribed_at, u.created_at)) >= s.consent_at);

revoke all on public.v_vp_subscribers_monthly from public, anon, authenticated;
grant select on public.v_vp_subscribers_monthly to service_role;

comment on table public.vp_subscribers is
  'VenuePlay monthly email sign-ups from the sales pages (migration 134). Written only by the billing Worker. Never a cold lead: never sent to Instantly.';

-- Read back (as the service role it answers 200 with []; with the anon key it is refused):
--   GET /rest/v1/vp_subscribers?select=id&limit=1
--   GET /rest/v1/v_vp_subscribers_monthly?select=id&limit=1

-- Rollback:
--   drop view if exists public.v_vp_subscribers_monthly;
--   drop trigger if exists vp_subscribers_mark_unsubscribed on public.vp_unsubscribes;
--   drop function if exists public.vp_subscribers_mark_unsubscribed();
--   drop table if exists public.vp_subscribers;
--   alter table public.vp_unsubscribes drop column if exists last_unsubscribed_at;
