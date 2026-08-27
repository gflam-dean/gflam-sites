-- ============================================================================
-- PartyPlay 10: hold the marketing consent until the money lands.
--
-- recordSubscriber used to run inside the anonymous /checkout call, so anybody
-- could POST somebody else's address with optin:true and silently undo their
-- unsubscribe. The flag now rides on the licence and the webhook acts on it
-- only once payment has actually cleared.
-- ============================================================================

alter table pp_licences
  add column if not exists marketing_optin boolean not null default false;

comment on column pp_licences.marketing_optin is
  'What they ticked at checkout. Acted on by the Stripe webhook AFTER payment, never before.';

-- The "chop chop" nudge: a licence bought and never started lapses 12 months
-- after purchase. Stamped so nobody gets pestered twice.
alter table pp_licences
  add column if not exists nudged_at timestamptz;

create index if not exists pp_licences_nudge_idx on pp_licences (created_at)
  where status = 'paid' and activated_at is null and nudged_at is null;
