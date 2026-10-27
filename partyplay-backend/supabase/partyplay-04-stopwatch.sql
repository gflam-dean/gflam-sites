-- ============================================================================
-- PartyPlay 04: the licence becomes a stopwatch instead of a calendar.
--
-- Was: buy it, name a state and a date, and it runs midnight to 6am on that date.
-- Now: buy it, build whenever, and the clock starts when the host presses start
-- and confirms. 24 hours, or 72.
--
-- Why it is better, beyond being easier to sell: a duration is the same length
-- everywhere, so the state, the timezone, daylight saving and the argument about
-- whose midnight it is all stop existing.
--
-- Safe to run whether or not anything has been sold: existing rows keep their
-- old window as their activation.
-- ============================================================================

alter table pp_licences
  add column if not exists activated_at timestamptz,
  add column if not exists expires_at   timestamptz;

-- Anything sold under the old model keeps exactly the window it was sold with.
update pp_licences
   set activated_at = starts_at,
       expires_at   = ends_at
 where activated_at is null
   and starts_at is not null;

-- The date and state were only ever there to compute a window. They stay, but
-- nullable and optional: a buyer may still tell us roughly when the party is,
-- and it is useful for the follow-up email, but nothing depends on it now.
alter table pp_licences alter column au_state   drop not null;
alter table pp_licences alter column start_date drop not null;
alter table pp_licences alter column starts_at  drop not null;
alter table pp_licences alter column ends_at    drop not null;

-- That constraint only made sense for the old fixed window.
alter table pp_licences drop constraint if exists pp_licences_window_sane;
alter table pp_licences add constraint pp_licences_stopwatch_sane
  check (expires_at is null or activated_at is null or expires_at > activated_at);

-- Finding what is running right now, and what is due a follow-up.
create index if not exists pp_licences_live_idx on pp_licences (expires_at)
  where activated_at is not null;

comment on column pp_licences.activated_at is
  'When the host confirmed the start. Null means bought but never started, which is a normal state.';
comment on column pp_licences.expires_at is
  'activated_at plus 24 or 72 hours. Written once at activation and never recalculated.';
