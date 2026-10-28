-- =====================================================================
-- Migration 122: a venue set up for a prospect accepts section 6 of the
-- Terms before its first game
-- ---------------------------------------------------------------------
--   NOT RUN. Safe to run any number of times. Run it BEFORE deploying the
--   billing Worker that carries POST /admin/prospect (that route writes the
--   column and refuses with "Run migration 122 first" without it). Either
--   order is safe for everything else:
--     game Worker     asks for the column on its own and, if PostgREST refuses
--                     it (not run yet), lets the game start: no venue has the
--                     flag until this has run, so nothing is skipped.
--     console         reads it off the venue row (select *), so a missing
--                     column reads as "not required" and nothing blocks.
--
-- WHY. Dean, 28 Oct 2026: when a venue replies "yes, tell me more" to a cold
-- email, ONE action in HQ (Set up a prospect) builds their working account and
-- sends ONE email that gets them running without ever having to talk to us.
-- Nobody reads the compliance line to them on a call, so HQ cannot tick it in
-- their name the way + Add venue does (Anisimoff Legal 9380, 1 Oct 2026,
-- point 3: the venue actively ticks). Instead the venue is created with
-- terms_required = true and NO compliance record, and:
--   - the console shows the one-time Terms card (vp-session.js termsGate) in
--     place of the game picker until the owner or a manager ticks it;
--   - the game Worker refuses to open a lobby or start trivia, musical bingo,
--     a raffle, number bingo or a members draw at that venue until
--     compliance_accepted_at is set (POST /account/compliance-accept writes it, once);
--   - the TV keeps showing the venue's ads the whole time (nothing on the
--     screen route reads this).
-- Every other venue keeps terms_required = false and is exactly as before.
--
-- WHAT CHANGES.
--   vp_venues.terms_required     boolean, not null, default false. True only
--                                for a venue made by /admin/prospect. Read
--                                together with compliance_accepted_at: the
--                                block lifts the moment that is set, so the
--                                flag never has to be cleared.
--   vp_venues_terms_required_guard  BEFORE INSERT OR UPDATE trigger, the same
--                                shape as migration 116: a venue's own login
--                                cannot change it (the old value is put back,
--                                silently). Only the service role (the
--                                Workers), a platform admin and the SQL editor
--                                may set it.
--
-- NOT security definer, on purpose (same as 107 and 116). No new policy, no
-- new grant, so RLS-BASELINE.json does not change.
--
-- CHECK AFTERWARDS (read-only):
--   select count(*) filter (where terms_required) as prospects,
--          count(*) filter (where terms_required and compliance_accepted_at is null) as waiting,
--          count(*) as venues from public.vp_venues;               -- 0, 0, N until HQ sets one up
--   select tgname from pg_trigger
--    where tgrelid = 'public.vp_venues'::regclass and tgname = 'vp_venues_terms_required_guard';
--
-- ROLLBACK:
--   drop trigger if exists vp_venues_terms_required_guard on public.vp_venues;
--   drop function if exists public.vp_venues_terms_required_guard();
--   alter table public.vp_venues drop column if exists terms_required;
--   (The game Worker and the console read the column fail-safe; /admin/prospect
--    then answers "Run migration 122 first" and creates nothing.)
-- =====================================================================

begin;

alter table public.vp_venues
  add column if not exists terms_required boolean not null default false;

comment on column public.vp_venues.terms_required is
  'Migration 122. True only for a venue set up from HQ > Set up a prospect (billing Worker /admin/prospect). '
  'While compliance_accepted_at is null, no game can start there (game Worker) and the console shows the Terms card '
  'in place of the game picker; the TV keeps its ads. Lifts by itself when the owner or a manager accepts '
  '(/account/compliance-accept). vp_venues_terms_required_guard keeps a venue login off it.';

create or replace function public.vp_venues_terms_required_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- The service role (the Workers) and the SQL editor carry no anon/authenticated role;
  -- a platform admin is HQ. All three may set it.
  if coalesce(auth.role(), '') not in ('anon', 'authenticated') or public.vp_is_platform_admin() then
    return new;
  end if;
  -- Anyone else (a venue's owner, manager or host login): the flag keeps its old value.
  if tg_op = 'INSERT' then
    new.terms_required := false;
  else
    new.terms_required := old.terms_required;
  end if;
  return new;
end;
$$;

revoke all on function public.vp_venues_terms_required_guard() from public, anon, authenticated;

drop trigger if exists vp_venues_terms_required_guard on public.vp_venues;
create trigger vp_venues_terms_required_guard
  before insert or update of terms_required on public.vp_venues
  for each row execute function public.vp_venues_terms_required_guard();

commit;
