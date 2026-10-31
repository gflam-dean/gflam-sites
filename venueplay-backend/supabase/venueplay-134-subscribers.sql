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
--   status 'active'  on the list
--   status 'held'    the address was on vp_unsubscribes when it signed up:
--                    kept so HQ can see it, never emailed (held_reason says why)
--   unsubscribed_at  set by the trigger below the moment the address lands on
--                    vp_unsubscribes, from whichever page or link wrote it
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
-- WHEN SOMEONE UNSUBSCRIBES, THEIR ROW SAYS SO. vp_unsubscribes is written by
-- the public venueplay.com.au/unsubscribe page (anon insert, migration 81) and
-- by the Worker's one-click link, so the stamp is a trigger on that table and
-- covers both. The monthly list does not depend on it: the view below and the
-- Worker both check vp_unsubscribes itself.
-- It can never stop an unsubscribe being recorded: any error inside is
-- swallowed and the opt-out row is written regardless.
-- ---------------------------------------------------------------------
create or replace function public.vp_subscribers_mark_unsubscribed()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  begin
    update public.vp_subscribers
       set unsubscribed_at = coalesce(unsubscribed_at, now()), updated_at = now()
     where email = lower(btrim(new.email))
       and unsubscribed_at is null;
  exception when others then
    null;
  end;
  return new;
end;
$fn$;

revoke all on function public.vp_subscribers_mark_unsubscribed() from public, anon, authenticated;

drop trigger if exists vp_subscribers_mark_unsubscribed on public.vp_unsubscribes;
create trigger vp_subscribers_mark_unsubscribed
  after insert on public.vp_unsubscribes
  for each row execute function public.vp_subscribers_mark_unsubscribed();

-- Anyone already on the unsubscribe list when this runs (there are no subscribers yet, so this
-- is for a re-run).
update public.vp_subscribers s
   set unsubscribed_at = coalesce(s.unsubscribed_at, now()), updated_at = now()
 where s.unsubscribed_at is null
   and exists (select 1 from public.vp_unsubscribes u where lower(btrim(u.email)) = s.email);

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
     and s.unsubscribed_at is null
     and not exists (select 1 from public.vp_unsubscribes u where lower(btrim(u.email)) = s.email);

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
