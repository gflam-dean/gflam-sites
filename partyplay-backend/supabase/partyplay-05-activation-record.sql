-- ============================================================================
-- PartyPlay 05: keep a record of them pressing play.
--
-- activated_at already says WHEN. These say WHAT they were given at that moment,
-- so a licence changed or comped later still shows what was actually handed over
-- on the night, and the monthly numbers cannot drift.
-- ============================================================================

alter table pp_licences
  add column if not exists activated_days smallint,
  add column if not exists activated_note text;

-- Backfill anything already running.
update pp_licences
   set activated_days = days
 where activated_at is not null and activated_days is null;

-- The two questions the monthly report asks.
create index if not exists pp_licences_sold_idx on pp_licences (paid_at)
  where status = 'paid';
create index if not exists pp_licences_ran_idx  on pp_licences (activated_at)
  where activated_at is not null;

comment on column pp_licences.activated_days is
  'The plan length as it stood when the host pressed start. Frozen, so later changes cannot rewrite history.';
