-- =====================================================================
-- Migration 115: the purchase raffle (one entry per purchase, drawn months later)
-- ---------------------------------------------------------------------
--   NOT RUN. Safe to run any number of times. Run it BEFORE deploying the
--   Workers that use it, although either order is safe:
--     game Worker     every /host/praffle/* route answers "not switched on
--                     for this venue" until the column and tables exist
--     billing Worker  /admin/venue-gaming says "Run migration 115 first" if
--                     HQ flips the switch before this has run
--     pages           read the switch on its own, so a missing column leaves
--                     the feature hidden, never a broken page
--
-- WHY. Deepwater Hotel (NSW, deepwater-hotel) wants a six month promotion:
-- every purchase at the bar earns one entry, staff add it on the venue's
-- tablet by the customer's mobile number, and at the end one draw, weighted
-- by entries, picks the winner on the server. NSW liquor promotion rules:
-- an entry is earned per PURCHASE (transaction), never per drink or per
-- amount of alcohol, so the table stores one row per purchase and nothing
-- about what was bought.
--
-- WHAT CHANGES.
--   vp_venues.purchase_raffle_on   boolean, not null, default false. OFF for
--                                  every venue. HQ turns it on per venue
--                                  (billing Worker /admin/venue-gaming,
--                                  audited as venue_purchase_raffle_on/_off).
--                                  A venue's own login can not set it: the
--                                  guard trigger puts the old value back, the
--                                  same way migration 107 guards
--                                  weekly_limit_off.
--   vp_purchase_raffles            the promotion: name, dates, prizes, cap,
--                                  generated terms. One OPEN raffle per venue.
--   vp_purchase_raffle_entrants    a person in one raffle: mobile (+614xxxxxxxx
--                                  only), names, email, their own marketing
--                                  tick (false unless they ticked it) and when
--                                  they confirmed they are 18 or over.
--   vp_purchase_raffle_entries     ONE ROW PER PURCHASE. Who added it (staff
--                                  login), the venue's local day (for the
--                                  optional daily cap), and a void for a
--                                  mistaken entry. Rows are never deleted.
--   vp_purchase_raffle_draws       every draw: the prize, the winner, how many
--                                  entries and entrants were in it, the index
--                                  the server picked, who drew it, and a
--                                  redraw with its reason if the winner could
--                                  not be contacted.
--
-- LOCKED. RLS on, no policies, anon and authenticated revoked by name
-- (Supabase grants them explicitly, so a revoke must name them). Only the
-- service role (the Workers) reaches a row, and the Workers check staff at
-- THIS venue on every request. Customer mobiles never leave the Worker except
-- masked (04xx xxx 123) or in the opted-in export.
--
-- AFTER RUNNING: python3 venueplay-backend/tools/dump-rls-baseline.py and
-- commit RLS-BASELINE.json (five new locked tables, one new trigger function).
--
-- CHECK AFTERWARDS (read-only):
--   select count(*) filter (where purchase_raffle_on) as on, count(*) from public.vp_venues;   -- 0 of N
--   select relname, relrowsecurity from pg_class where relname like 'vp_purchase_raffle%';      -- all true
--
-- TURN IT ON FOR ONE VENUE. Prefer HQ > Venues > Details > "Purchase raffle",
-- which records who did it.
--
-- ROLLBACK (deletes every entry; export first):
--   drop table if exists public.vp_purchase_raffle_draws, public.vp_purchase_raffle_entries,
--     public.vp_purchase_raffle_entrants, public.vp_purchase_raffles;
--   drop trigger if exists vp_venues_purchase_raffle_guard on public.vp_venues;
--   drop function if exists public.vp_venues_purchase_raffle_guard();
--   alter table public.vp_venues drop column if exists purchase_raffle_on;
-- =====================================================================

begin;

alter table public.vp_venues
  add column if not exists purchase_raffle_on boolean not null default false;

comment on column public.vp_venues.purchase_raffle_on is
  'Migration 115. true = this venue may run a purchase raffle. Set only from HQ (billing Worker '
  '/admin/venue-gaming, audited as venue_purchase_raffle_on/off); vp_venues_purchase_raffle_guard '
  'keeps a venue login off it.';

create or replace function public.vp_venues_purchase_raffle_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') not in ('anon', 'authenticated') or public.vp_is_platform_admin() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.purchase_raffle_on := false;
  else
    new.purchase_raffle_on := old.purchase_raffle_on;
  end if;
  return new;
end;
$$;

revoke all on function public.vp_venues_purchase_raffle_guard() from public, anon, authenticated;

drop trigger if exists vp_venues_purchase_raffle_guard on public.vp_venues;
create trigger vp_venues_purchase_raffle_guard
  before insert or update of purchase_raffle_on on public.vp_venues
  for each row execute function public.vp_venues_purchase_raffle_guard();

create table if not exists public.vp_purchase_raffles (
  id            uuid primary key default gen_random_uuid(),
  venue_id      uuid not null references public.vp_venues(id) on delete cascade,
  name          text not null check (char_length(name) between 1 and 120),
  description   text check (description is null or char_length(description) <= 2000),
  prizes        jsonb not null default '[]'::jsonb check (jsonb_typeof(prizes) = 'array'),
  starts_at     timestamptz not null,
  closes_at     timestamptz not null,
  draw_at       timestamptz not null,
  draw_place    text check (draw_place is null or char_length(draw_place) <= 200),
  daily_cap     integer check (daily_cap is null or daily_cap between 1 and 100),
  terms_text    text,
  status        text not null default 'open' check (status in ('open', 'drawn', 'archived')),
  created_at    timestamptz not null default now(),
  created_by    text,
  updated_at    timestamptz not null default now(),
  constraint vp_purchase_raffles_dates check (closes_at > starts_at and draw_at >= closes_at)
);
create index if not exists vp_purchase_raffles_venue on public.vp_purchase_raffles (venue_id, created_at);
create unique index if not exists vp_purchase_raffles_one_open
  on public.vp_purchase_raffles (venue_id) where status = 'open';

create table if not exists public.vp_purchase_raffle_entrants (
  id                uuid primary key default gen_random_uuid(),
  raffle_id         uuid not null references public.vp_purchase_raffles(id) on delete cascade,
  venue_id          uuid not null references public.vp_venues(id) on delete cascade,
  phone             text not null check (phone ~ '^\+614[0-9]{8}$'),
  first_name        text not null check (char_length(first_name) between 1 and 60),
  last_name         text not null check (char_length(last_name) between 1 and 60),
  email             text check (email is null or char_length(email) <= 200),
  marketing_opt_in  boolean not null default false,
  opted_in_at       timestamptz,
  age_confirmed_at  timestamptz not null,
  created_at        timestamptz not null default now(),
  created_by        text,
  constraint vp_purchase_raffle_entrants_one_phone unique (raffle_id, phone)
);
create index if not exists vp_purchase_raffle_entrants_raffle on public.vp_purchase_raffle_entrants (raffle_id, id);

create table if not exists public.vp_purchase_raffle_entries (
  id            uuid primary key default gen_random_uuid(),
  raffle_id     uuid not null references public.vp_purchase_raffles(id) on delete cascade,
  entrant_id    uuid not null references public.vp_purchase_raffle_entrants(id) on delete cascade,
  venue_id      uuid not null references public.vp_venues(id) on delete cascade,
  venue_day     date not null,
  created_at    timestamptz not null default now(),
  created_by    text,
  voided_at     timestamptz,
  voided_by     text,
  void_reason   text check (void_reason is null or char_length(void_reason) <= 200)
);
create index if not exists vp_purchase_raffle_entries_raffle  on public.vp_purchase_raffle_entries (raffle_id, id);
create index if not exists vp_purchase_raffle_entries_entrant on public.vp_purchase_raffle_entries (entrant_id, created_at);

create table if not exists public.vp_purchase_raffle_draws (
  id              uuid primary key default gen_random_uuid(),
  raffle_id       uuid not null references public.vp_purchase_raffles(id) on delete cascade,
  venue_id        uuid not null references public.vp_venues(id) on delete cascade,
  prize_index     integer not null check (prize_index >= 0),
  prize_text      text,
  entrant_id      uuid references public.vp_purchase_raffle_entrants(id) on delete set null,
  entry_id        uuid,
  winner_name     text,
  phone_last3     text,
  winner_entries  integer,
  entries_total   integer not null,
  entrants_total  integer not null,
  pick_index      integer not null,
  outcome         text not null default 'drawn' check (outcome in ('drawn', 'redrawn')),
  redraw_reason   text check (redraw_reason is null or char_length(redraw_reason) <= 300),
  redrawn_at      timestamptz,
  redrawn_by      text,
  drawn_at        timestamptz not null default now(),
  drawn_by        text
);
create index if not exists vp_purchase_raffle_draws_raffle on public.vp_purchase_raffle_draws (raffle_id, drawn_at);

alter table public.vp_purchase_raffles         enable row level security;
alter table public.vp_purchase_raffle_entrants enable row level security;
alter table public.vp_purchase_raffle_entries  enable row level security;
alter table public.vp_purchase_raffle_draws    enable row level security;
revoke all on public.vp_purchase_raffles         from public, anon, authenticated;
revoke all on public.vp_purchase_raffle_entrants from public, anon, authenticated;
revoke all on public.vp_purchase_raffle_entries  from public, anon, authenticated;
revoke all on public.vp_purchase_raffle_draws    from public, anon, authenticated;
grant select, insert, update, delete on public.vp_purchase_raffles         to service_role;
grant select, insert, update, delete on public.vp_purchase_raffle_entrants to service_role;
grant select, insert, update, delete on public.vp_purchase_raffle_entries  to service_role;
grant select, insert, update, delete on public.vp_purchase_raffle_draws    to service_role;

commit;
