-- =====================================================================
-- Migration 125: HQ > Prospects, the follow-up call and a phone number
-- ---------------------------------------------------------------------
--   NOT RUN. Safe to run any number of times. Run it BEFORE deploying the
--   billing Worker that carries /admin/prospects and /admin/prospect/called.
--   Either order is safe: without this table Set up a prospect still works
--   (the phone is kept on the audit row, and HQ is told), and the Prospects
--   tab says "Run migration 125" instead of listing anybody.
--   After running: python3 venueplay-backend/tools/dump-rls-baseline.py and
--   commit RLS-BASELINE.json (one new table, RLS on, no grants to anon or
--   authenticated).
--
-- WHY. Dean, 29 Oct 2026: "Can we please put the prospects into HQ as a tab
-- somewhere? ... if they haven't signed up they're not gonna sign up on the
-- active list are they? And maybe we should have something that is like a
-- follow-up ... if they haven't accessed it within ... three days it flags
-- the venue ... so then we can actually give the person a call ... if it
-- does have a phone number. We need to add that at the point of setup also."
--
-- ONE ROW PER PROSPECT VENUE, written by the billing Worker's one setup
-- (vpaProspectSetUp) for HQ's Set up a prospect and for the autopilot.
-- Whether they have SIGNED UP is never stored here: the Worker works it out
-- on every read from the account record (a card on file, comp, invoiced or
-- grouped), so a prospect who adds their card moves to the active venues
-- list by itself and nothing has to remember to move them.
--   phone         the number to ring them on, as typed (a mobile or the
--                 venue's landline). Not their login: that is the mobile
--                 on the auth user. Null = "no phone, email them".
--   website       their own site, from the setup (HQ's field or the autopilot's
--                 find), linked from the Prospects row.
--   call_requested  they ASKED for a call in their reply (the autopilot reads
--                 it): flagged "Call requested" above the 3-day flag, for sales.
--   called_*      HQ's "Called" mark and its note. Set = stop flagging.
--
-- THE BACKFILL. Prospects set up before this ran have an audit row
-- (vp_admin_audit, action prospect_set_up, target venue:<id>) and a manager
-- login. Each becomes a row here once, with no phone (nobody was asked).
--
-- LOCKED. Only the service role (the billing Worker) reaches a row: RLS on,
-- no policies, and anon/authenticated named in the revoke (Supabase grants
-- them explicitly, so a revoke from public alone does nothing; migration 32).
-- A venue never sees this table: it is HQ's sales list, not the venue's data.
-- =====================================================================

create table if not exists public.vp_prospects (
  venue_id        uuid primary key references public.vp_venues(id) on delete cascade,
  founding_id     uuid,
  source          text not null default 'hq' check (source in ('hq', 'autopilot')),
  contact_name    text,
  email           text,
  phone           text check (phone is null or phone ~ '^\+?[0-9 ()-]{8,20}$'),
  auth_user_id    uuid,
  website         text check (website is null or (length(website) <= 200 and website ~* '^https?://')),
  call_requested  boolean not null default false,
  created_at      timestamptz not null default now(),
  created_label   text,
  called_at       timestamptz,
  called_by       uuid,
  called_label    text,
  call_note       text check (call_note is null or length(call_note) <= 500)
);
create index if not exists vp_prospects_created_idx on public.vp_prospects (created_at desc);

alter table public.vp_prospects enable row level security;
revoke all on public.vp_prospects from public, anon, authenticated;
grant select, insert, update, delete on public.vp_prospects to service_role;

-- The backfill: every prospect already set up, once (on conflict leaves HQ's edits alone).
insert into public.vp_prospects (venue_id, founding_id, source, contact_name, email, auth_user_id, website, created_at, created_label)
select distinct on (v.id)
       v.id,
       v.founding_id,
       case when a.detail->>'via' = 'autopilot_prospect' then 'autopilot' else 'hq' end,
       nullif(a.detail->>'first_name', ''),
       a.detail->>'email',
       (select s.auth_user_id from public.vp_venue_staff s
         where s.venue_id = v.id and s.role = 'manager' order by s.id limit 1),
       case when a.detail->>'website' ~* '^https?://' and length(a.detail->>'website') <= 200 then a.detail->>'website' end,
       a.created_at,
       a.actor_label
  from public.vp_admin_audit a
  join public.vp_venues v on 'venue:' || v.id::text = a.target
 where a.action = 'prospect_set_up'
 order by v.id, a.created_at
on conflict (venue_id) do nothing;

-- Rollback:
--   drop table if exists public.vp_prospects;
