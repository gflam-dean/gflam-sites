-- ============================================================================
-- PartyPlay 03: the party's name, comps, and the follow-up email.
--
-- "Enjoyed Nicole's Birthday?" needs somebody to have told us it was Nicole's
-- birthday. Nothing did, so the follow-up email could only ever have said
-- "enjoyed your party", which is worth a fraction as much.
-- ============================================================================

alter table pp_licences
  add column if not exists party_name text,
  -- A comp is a real licence that was never paid for. Kept as a flag rather than
  -- a $0 price so the revenue reporting stays honest and comps can be counted.
  add column if not exists is_comp boolean not null default false,
  add column if not exists comp_reason text,
  -- Stamped when the "how was it" email goes out, so a re-run of the job cannot
  -- send it twice. This is the only thing stopping a duplicate.
  add column if not exists followup_sent_at timestamptz;

-- Finding who is due a follow-up is the one query this table does on a schedule.
create index if not exists pp_licences_followup_idx
  on pp_licences (ends_at)
  where followup_sent_at is null and status = 'paid';

-- A comp still has to be a valid licence in every other respect, so nothing
-- downstream needs to know the difference.
comment on column pp_licences.is_comp is
  'True when issued free from the back end. The licence behaves identically; this only keeps revenue reporting honest.';
