-- =====================================================================
-- Migration 108: help desk hardening (independent review, 19 Oct 2026)
-- ---------------------------------------------------------------------
-- 1. vp_help_limits + vp_help_hit(): rate limits that hold across every Worker instance. Until
--    now the help desk counted in each instance's memory, so a flood spread over instances (or
--    an instance restart) reset the count, and a flood of tickets is a flood of alert emails on
--    the same Resend account the invoices go out on. One row per (key, window); the function
--    adds one and says whether the limit still holds, in one statement, so two requests at once
--    cannot both slip under it. Keys hold a HASH of the network address, never the address.
-- 2. vp_help_tickets.reply_token: a secret per ticket that an emailed reply has to quote before it
--    is added to the ticket. The From and Reply-To headers can be forged; the token cannot be
--    guessed. Existing tickets get one now.
-- 3. vp_help_tickets.contact_email_pending: an email that asked for replies to go somewhere else
--    (a Reply-To unlike its From) is held here until HQ confirms it. HQ never replies to it before.
-- 4. vp_help_tickets.contact_typed: true when HQ typed the contact address in (a logged call, or a
--    change in HQ). A reply to such an address needs the owner role, or an explicit confirm.
-- 5. vp_help_push_subs.last_peek_at defaults to the database's clock, which is now the only clock
--    the phone-alert cursor uses.
--
-- Run BEFORE deploying the billing Worker from branch fix/help-desk-review: that Worker writes
-- reply_token and contact_typed on every new ticket. Safe to run twice. After running:
-- python3 venueplay-backend/tools/dump-rls-baseline.py and commit RLS-BASELINE.json (one new
-- locked table, one new definer function). Rollback at the bottom.
-- =====================================================================

begin;

create table if not exists public.vp_help_limits (
  key          text not null check (char_length(key) <= 200),
  window_start timestamptz not null,
  hits         int  not null default 0,
  primary key (key, window_start)
);
alter table public.vp_help_limits enable row level security;
revoke all on public.vp_help_limits from public, anon, authenticated;
grant select, insert, update, delete on public.vp_help_limits to service_role;

-- One hit on key in a window of p_window_secs. True while the count is within p_limit.
-- p_limit 0 or less only reads (does the key still have room) without adding.
create or replace function public.vp_help_hit(p_key text, p_window_secs int, p_limit int)
returns boolean
language plpgsql
security definer
set search_path = public
as $fn$
declare
  w timestamptz := to_timestamp(floor(extract(epoch from now()) / greatest(p_window_secs, 1)) * greatest(p_window_secs, 1));
  n int;
begin
  if p_limit <= 0 then
    select hits into n from public.vp_help_limits where key = p_key and window_start = w;
    return coalesce(n, 0) < abs(p_limit);
  end if;
  insert into public.vp_help_limits as l (key, window_start, hits) values (p_key, w, 1)
    on conflict (key, window_start) do update set hits = l.hits + 1
    returning hits into n;
  -- Old windows go, now and then, so the table stays small.
  if random() < 0.01 then
    delete from public.vp_help_limits where window_start < now() - interval '2 days';
  end if;
  return n <= p_limit;
end;
$fn$;
revoke all on function public.vp_help_hit(text, int, int) from public, anon, authenticated;
grant execute on function public.vp_help_hit(text, int, int) to service_role;

alter table public.vp_help_tickets add column if not exists reply_token text;
alter table public.vp_help_tickets add column if not exists contact_email_pending text;
alter table public.vp_help_tickets add column if not exists contact_typed boolean not null default false;
update public.vp_help_tickets set reply_token = substr(md5(random()::text || id::text || clock_timestamp()::text), 1, 12)
 where reply_token is null;
-- A logged call or a manual ticket that already carries an address: HQ typed it.
update public.vp_help_tickets set contact_typed = true
 where channel in ('phone', 'manual') and contact_email is not null and contact_typed = false;

alter table public.vp_help_push_subs alter column last_peek_at set default now();

commit;

-- Read back:
--   select count(*) filter (where reply_token is null) as missing_tokens from public.vp_help_tickets;   -- 0
--   select public.vp_help_hit('readback', 60, 2), public.vp_help_hit('readback', 60, 2), public.vp_help_hit('readback', 60, 2);  -- t, t, f
--   delete from public.vp_help_limits where key = 'readback';

-- ROLLBACK:
--   drop function if exists public.vp_help_hit(text, int, int);
--   drop table if exists public.vp_help_limits;
--   alter table public.vp_help_tickets drop column if exists reply_token;
--   alter table public.vp_help_tickets drop column if exists contact_email_pending;
--   alter table public.vp_help_tickets drop column if exists contact_typed;
--   alter table public.vp_help_push_subs alter column last_peek_at drop default;
