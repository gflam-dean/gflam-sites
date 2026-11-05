-- =====================================================================
-- Migration 152: HQ's sign-in texts, queued outside texting hours
-- ---------------------------------------------------------------------
-- Dean, 4 November 2026, HQ > Prospects: the one button "Send them a new
-- sign-in link" sends the link by email AND by text when we have their
-- mobile. Texts keep the follow-up text's hours, 9am to 8pm Brisbane and
-- never a Sunday. Outside those hours the text is QUEUED here for the next
-- allowed time, and the billing Worker's hourly trigger sends it
-- (vpaSigninTextSweep), making its one-use sign-in link at that moment
-- (only the hash of any link is ever kept, in vp_signin_links; never here).
--
-- Until this has run the Worker queues nothing: the email still goes, and
-- HQ is told that no text was queued and to press again after 9am.
--
-- NUMBER: 140 to 151 are taken (other branches and release/4nov), so 152.
-- Branch fix/hq-prospects-6nov. NOT RUN.
--
-- RLS-BASELINE.json: one new table, row security on, service role only
-- (no policy, no grant to anon or authenticated). After running, rerun
-- venueplay-backend/tools/dump-rls-baseline.py and commit the baseline
-- (it gains "vp_signin_texts": enabled), or the release check is red.
-- =====================================================================

create table if not exists public.vp_signin_texts (
  id             uuid primary key default gen_random_uuid(),
  venue_id       uuid not null references public.vp_venues(id) on delete cascade,
  auth_user_id   uuid not null references auth.users(id) on delete cascade,
  to_e164        text not null check (to_e164 ~ '^\+614[0-9]{8}$'),
  send_at        timestamptz not null,
  expires_at     timestamptz not null,
  status         text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'failed', 'dropped')),
  detail         jsonb not null default '{}'::jsonb,
  created_by     uuid,
  created_label  text,
  created_at     timestamptz not null default now(),
  sent_at        timestamptz
);
create index if not exists vp_signin_texts_due_idx on public.vp_signin_texts (status, send_at);

alter table public.vp_signin_texts enable row level security;
revoke all on public.vp_signin_texts from public, anon, authenticated;
grant select, insert, update, delete on public.vp_signin_texts to service_role;

-- Read back:
--   select relrowsecurity from pg_class where relname = 'vp_signin_texts';   -- true
--   select grantee, privilege_type from information_schema.role_table_grants where table_name = 'vp_signin_texts';
--   -- service_role only
-- Rollback:
--   drop table if exists public.vp_signin_texts;
