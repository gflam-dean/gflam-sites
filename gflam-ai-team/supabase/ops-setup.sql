-- ============================================================================
-- Gflam HQ — ops tables (priorities, questions, approvals)
-- Run in Supabase -> SQL Editor (project gpoolavkghnxedzrmtmc).
-- Safe to run more than once.
--
-- SECURITY NOTE: these tables allow anon read/write so the local dashboard
-- works with the anon key. That's fine ONLY because the dashboard file is
-- kept LOCAL on Dean's machine and never published to a public URL, and the
-- data is internal work drafts, not customer PII. If the dashboard ever goes
-- online, add Supabase Auth first.
-- ============================================================================

create table if not exists public.ops_priorities (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  day         date not null default (now() at time zone 'Australia/Brisbane')::date,
  rank        integer not null check (rank between 1 and 3),
  business    text not null,
  title       text not null,
  why         text,
  status      text not null default 'open' check (status in ('open','done'))
);

create table if not exists public.ops_questions (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  agent       text not null,
  business    text,
  question    text not null,
  context     text,
  status      text not null default 'open' check (status in ('open','answered','closed')),
  answer      text,
  answered_at timestamptz
);

create table if not exists public.ops_approvals (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  agent          text not null,
  business       text not null,
  type           text not null check (type in ('facebook_post','instagram_post','email','web_edit','document','ad_copy','other')),
  title          text not null,
  content        text not null,
  notes          text,
  publish_target text,
  suggested_date date,
  status         text not null default 'pending' check (status in ('pending','approved','rejected','published')),
  decision_note  text,
  decided_at     timestamptz
);

alter table public.ops_priorities enable row level security;
alter table public.ops_questions  enable row level security;
alter table public.ops_approvals  enable row level security;

-- Anon policies for the local dashboard (see security note above).
drop policy if exists ops_priorities_anon on public.ops_priorities;
create policy ops_priorities_anon on public.ops_priorities
  for all to anon using (true) with check (true);

drop policy if exists ops_questions_anon on public.ops_questions;
create policy ops_questions_anon on public.ops_questions
  for all to anon using (true) with check (true);

drop policy if exists ops_approvals_anon on public.ops_approvals;
create policy ops_approvals_anon on public.ops_approvals
  for all to anon using (true) with check (true);
