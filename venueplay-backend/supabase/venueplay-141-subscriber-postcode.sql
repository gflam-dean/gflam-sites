-- =====================================================================
-- Migration 141: the monthly email sign-up asks for the venue's postcode (vp_subscribers)
-- ---------------------------------------------------------------------
--   NOT RUN. Safe to run any number of times. Run AFTER migration 134 (it
--   adds to 134's table and view; if 134 is not there yet, this does nothing
--   and says so). Either order with the billing Worker: until this is run,
--   POST /subscribe keeps every sign-up WITHOUT the postcode (it tries again
--   without the two columns), and HQ > Subscribers shows "No postcode".
--   Number 141: 137 is feature/player-screens-2nov, 138 feature/tv-type-2nov
--   and feature/lowercase-legal-2nov, 139 release/mon-2nov, 140 earmarked for
--   the help saved-reply lowercase fix (checked every branch and worktree,
--   2 Nov 2026). Branch fix/signup-postcode-2nov.
--   After running: python3 venueplay-backend/tools/dump-rls-baseline.py and
--   commit RLS-BASELINE.json. The only change it should show is the view
--   v_vp_subscribers_monthly with two more columns, if the dump records view
--   columns; no table's RLS, no policy and no grant changes (columns inherit
--   the table's locks: RLS on, service role only).
--
-- WHY (Dean, 2 Nov 2026). Offers are sent by state: a Queensland offer must
-- never go to a NSW venue. The form now asks for the venue's name (needed)
-- and its 4-digit postcode (needed). The Worker works the state out from the
-- postcode with vpaStateFromPostcode, the same map that sets a venue's
-- gaming rules, and keeps both:
--   postcode   4 digits, as typed (spaces removed)
--   au_state   ACT | NSW | NT | QLD | SA | TAS | VIC | WA, from the postcode
-- Rows from before this have neither (null), and stay that way: nobody is
-- asked again. Cloudflare's region on the request (134's `region`) is where
-- the person was, not where the venue is, so it is never used for an offer.
-- =====================================================================

do $mig$
begin
  if to_regclass('public.vp_subscribers') is null then
    raise notice 'migration 141: vp_subscribers is not there yet. Run migration 134 first, then this.';
    return;
  end if;

  alter table public.vp_subscribers add column if not exists postcode text;
  alter table public.vp_subscribers add column if not exists au_state text;

  if not exists (select 1 from pg_constraint where conname = 'vp_subscribers_postcode_chk'
                   and conrelid = 'public.vp_subscribers'::regclass) then
    alter table public.vp_subscribers add constraint vp_subscribers_postcode_chk
      check (postcode is null or postcode ~ '^[0-9]{4}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'vp_subscribers_au_state_chk'
                   and conrelid = 'public.vp_subscribers'::regclass) then
    alter table public.vp_subscribers add constraint vp_subscribers_au_state_chk
      check (au_state is null or au_state in ('ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA'));
  end if;

  -- For "everyone on the list in this state".
  create index if not exists vp_subscribers_state_idx on public.vp_subscribers (au_state);

  -- 134's read-only monthly list, with the postcode and state added at the END (create or replace
  -- view may only add columns after the existing ones). Same rule, same locks.
  create or replace view public.v_vp_subscribers_monthly
    with (security_invoker = true) as
    select s.id, s.email, s.venue_name, s.source, s.created_at, s.postcode, s.au_state
      from public.vp_subscribers s
     where s.status = 'active'
       and s.consent_at > coalesce(s.unsubscribed_at, '-infinity'::timestamptz)
       and not exists (select 1 from public.vp_unsubscribes u
                        where lower(btrim(u.email)) = s.email
                          and greatest(u.created_at, coalesce(u.last_unsubscribed_at, u.created_at)) >= s.consent_at);

  revoke all on public.v_vp_subscribers_monthly from public, anon, authenticated;
  grant select on public.v_vp_subscribers_monthly to service_role;

  comment on column public.vp_subscribers.postcode is 'The venue''s 4-digit postcode as typed on the sign-up form (migration 141).';
  comment on column public.vp_subscribers.au_state is 'The state the postcode is in, worked out by the billing Worker (vpaStateFromPostcode). What an offer by state is sent on.';
end
$mig$;

-- Read back (as the service role it answers 200 with []; with the anon key it is refused):
--   GET /rest/v1/vp_subscribers?select=id,postcode,au_state&limit=1
--   GET /rest/v1/v_vp_subscribers_monthly?select=id,postcode,au_state&limit=1

-- Rollback (the Worker carries on without the columns, as it did before this was run):
--   create or replace view cannot drop columns, so drop and recreate 134's view first:
--   drop view if exists public.v_vp_subscribers_monthly;
--   (then re-run the view block of venueplay-134-subscribers.sql)
--   drop index if exists public.vp_subscribers_state_idx;
--   alter table public.vp_subscribers drop constraint if exists vp_subscribers_au_state_chk;
--   alter table public.vp_subscribers drop constraint if exists vp_subscribers_postcode_chk;
--   alter table public.vp_subscribers drop column if exists au_state;
--   alter table public.vp_subscribers drop column if exists postcode;
