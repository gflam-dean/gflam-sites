-- 119: where a Gflam Touring / Drag Bingo unsubscribe came from.
--
-- Dean, 26 Oct 2026: "why's it not a link that you click and it automates it". Every Gflam
-- marketing email now carries a signed one-click link to touring-api /unsubscribe, which
-- stamps gflam_customers.unsubscribed_at. That column already exists (RUN-ME-gflam-customers.sql,
-- 24 Oct 2026). This adds the one thing it lacks: HOW the person left, kept apart from
-- `source`, which says where their CONSENT came from (oztix, moshtix...) and must never be
-- overwritten by an opt-out.
--
-- Values the Worker writes: 'link' (the footer link, after the page posts back),
-- 'one-click' (the mail app's RFC 8058 button), each optionally ':<campaign>'.
-- By-hand opt-outs (a reply saying unsubscribe) should use 'reply'.
--
-- RUN THIS BEFORE deploying the touring-api build with /unsubscribe: the Worker writes
-- this column, and PostgREST refuses a write to a column it does not know, so the link
-- would answer "That did not go through" for everybody.
--
-- Same Sydney project as every other migration here. Safe to run twice. No grants change:
-- gflam_customers stays RLS on, no policies, service role only.

begin;

alter table public.gflam_customers
  add column if not exists unsubscribe_source text;

comment on column public.gflam_customers.unsubscribe_source is
  'How the person unsubscribed: link, one-click, reply, each optionally :campaign. Set with unsubscribed_at; never cleared.';

-- Every sender asks "who must I skip", so make that question cheap.
create index if not exists gflam_customers_unsubscribed_idx
  on public.gflam_customers (unsubscribed_at) where unsubscribed_at is not null;

commit;

-- PostgREST caches the schema; without this the new column 400s for a minute or more.
notify pgrst, 'reload schema';
