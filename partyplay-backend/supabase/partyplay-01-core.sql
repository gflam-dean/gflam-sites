-- ============================================================================
-- PartyPlay 01: the core tables.
--
-- Lives in the SAME Supabase project as VenuePlay, prefixed pp_ so the two can
-- never be confused at a glance in the table list.
--
-- Two rules run through all of this:
--   1. THE BUYER is a customer and we hold their details. THE GUESTS are not,
--      and we hold nothing about them but a nickname they typed. Those are
--      different people with different expectations, and the schema keeps them
--      in different tables so nobody can casually join one to the other.
--   2. PREP IS UNLIMITED. Games a host builds are NOT bound by the licence
--      window, only PLAY is. So pp_games has no date logic in it at all.
-- ============================================================================

-- ---------------------------------------------------------------- licences --
create table if not exists pp_licences (
  id                uuid primary key default gen_random_uuid(),
  code              text not null unique,          -- what the host and guests type

  -- the buyer. A customer, not a guest.
  buyer_name        text not null,
  buyer_email       text not null,
  buyer_mobile      text,                          -- optional, see pp_subscribers

  -- what they bought. The state is here because it IS the timezone: midnight in
  -- Perth is not midnight in Sydney and four states move for daylight saving.
  au_state          text not null check (au_state in ('NSW','VIC','QLD','SA','WA','TAS','NT','ACT')),
  start_date        date not null,                 -- the first nominated day, LOCAL to au_state
  days              smallint not null check (days between 1 and 3),

  -- The window, computed at purchase and FROZEN. Deliberately stored rather than
  -- derived on read: if a timezone rule ever changes, a licence somebody already
  -- paid for must not silently move. lib/pp-licence.js computes these.
  starts_at         timestamptz not null,
  ends_at           timestamptz not null,

  price_cents       integer not null,
  status            text not null default 'pending'
                    check (status in ('pending','paid','refunded','cancelled')),

  stripe_session_id        text unique,
  stripe_payment_intent    text,

  -- Date changes are free and unlimited-ish, but counted, because a licence that
  -- has been moved eleven times is worth a look.
  date_changes      smallint not null default 0,

  created_at        timestamptz not null default now(),
  paid_at           timestamptz,
  refunded_at       timestamptz,

  constraint pp_licences_window_sane check (ends_at > starts_at)
);
create index if not exists pp_licences_code_idx    on pp_licences (code);
create index if not exists pp_licences_email_idx   on pp_licences (lower(buyer_email));
create index if not exists pp_licences_window_idx  on pp_licences (starts_at, ends_at);

-- -------------------------------------------------------------- subscribers --
-- SEPARATE from pp_licences on purpose. A marketing list outlives any one
-- purchase, has its own consent, and has to support unsubscribe without touching
-- a paid licence record. Joining these two by hand is how people end up emailing
-- someone who opted out.
create table if not exists pp_subscribers (
  id                uuid primary key default gen_random_uuid(),
  email             text not null unique,
  name              text,
  mobile            text,
  -- Express consent only. Never default this to true and never tick it for them:
  -- the Spam Act wants consent, and a pre-ticked box is not consent.
  opted_in          boolean not null default false,
  opted_in_at       timestamptz,
  source            text not null default 'checkout',
  unsubscribed_at   timestamptz,
  created_at        timestamptz not null default now()
);
create index if not exists pp_subscribers_live_idx
  on pp_subscribers (lower(email)) where unsubscribed_at is null;

-- -------------------------------------------------------------------- games --
-- What the host built. NO window logic here: a host may spend a fortnight
-- writing questions for a party on one afternoon, and may keep them afterwards.
create table if not exists pp_games (
  id            uuid primary key default gen_random_uuid(),
  licence_id    uuid not null references pp_licences(id) on delete cascade,
  format        text not null check (format in
                  ('bingo90','trivia','musical','draw','howwell','headstails','whohere','photos','truths','playlist')),
  title         text,
  config        jsonb not null default '{}'::jsonb,   -- questions, photos, prompts
  sort_order    smallint not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists pp_games_licence_idx on pp_games (licence_id, sort_order);

-- ------------------------------------------------------------------ players --
-- A guest. We hold a nickname they typed and nothing else, on purpose: it is the
-- control that keeps this product out of trade-promotion territory, and it is
-- what we have told the lawyer. Do not add a contact field to this table.
create table if not exists pp_players (
  id            uuid primary key default gen_random_uuid(),
  licence_id    uuid not null references pp_licences(id) on delete cascade,
  nickname      text not null,
  token         text not null unique,
  joined_at     timestamptz not null default now(),
  last_seen_at  timestamptz not null default now()
);
create index if not exists pp_players_licence_idx on pp_players (licence_id);

-- THE FIFTY CAP, ENFORCED IN THE DATABASE.
-- This is the single control that makes venue use fail rather than merely be
-- forbidden, and it is one of the things the lawyer has been told about. A check
-- that lives only in the Worker is one deploy away from being gone, so it lives
-- here as well.
create or replace function pp_enforce_player_cap() returns trigger
language plpgsql as $$
declare n integer;
begin
  select count(*) into n from pp_players where licence_id = new.licence_id;
  if n >= 50 then
    raise exception 'PartyPlay is capped at 50 players' using errcode = 'check_violation';
  end if;
  return new;
end $$;
drop trigger if exists pp_players_cap on pp_players;
create trigger pp_players_cap before insert on pp_players
  for each row execute function pp_enforce_player_cap();

-- --------------------------------------------------------------------- RLS --
-- Same posture as VenuePlay: the Worker holds the service key and does every
-- read and write. Nothing is reachable with the anon key, so a leaked public key
-- exposes none of this. Enabling RLS with NO policies is what achieves that.
alter table pp_licences    enable row level security;
alter table pp_subscribers enable row level security;
alter table pp_games       enable row level security;
alter table pp_players     enable row level security;
