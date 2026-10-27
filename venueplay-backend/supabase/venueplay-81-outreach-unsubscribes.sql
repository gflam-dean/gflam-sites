-- venueplay-81-outreach-unsubscribes.sql
--
-- THE OPT-OUT LIST FOR COLD OUTREACH.
--
-- The Spam Act requires a functional unsubscribe in every commercial message and
-- requires it to be honoured. Instantly provides {{unsubscribeLink}} for campaigns it
-- sends, but Dean is sending the NSW hot list BY HAND from getvenueplay.com.au while
-- the sending infrastructure is sorted out, and a hand-sent email has no merge tag.
-- Without this table the only opt-out record is whatever he remembers.
--
-- WHAT THIS IS NOT. It is not a marketing list and it is not a contact record. It holds
-- the smallest thing that discharges the obligation: an address that must never be
-- emailed again, and when it said so.
--
-- RLS: ANYONE MAY INSERT, NOBODY MAY READ.
-- The page is public and unauthenticated, because an opt-out that needs a login is not
-- a functional opt-out. So anon can insert. Anon cannot select, or the table becomes a
-- way to ask "is this venue on the list", which is a disclosure about a business we
-- have no right to make. Reading is service-role only, which is how the send tools and
-- the export read it.
--
-- The unique index is what makes a second click harmless: the page always says the same
-- thing whether this is the first time or the fifth, so nothing about the existing list
-- can be inferred by clicking.

create table if not exists public.vp_unsubscribes (
  id          uuid primary key default gen_random_uuid(),
  email       text not null,
  source      text,                      -- 'manual', 'instantly', 'reply-stop', 'phone'
  note        text,
  created_at  timestamptz not null default now()
);

-- One row per address, case-insensitively. A venue that clicks twice is still one opt-out.
create unique index if not exists vp_unsubscribes_email_uniq
  on public.vp_unsubscribes (lower(email));

alter table public.vp_unsubscribes enable row level security;

-- INSERT ONLY, and only a sane-looking address. No select policy exists on purpose.
drop policy if exists vp_unsub_insert_anon on public.vp_unsubscribes;
create policy vp_unsub_insert_anon
  on public.vp_unsubscribes
  for insert
  to anon, authenticated
  with check (
    email is not null
    and length(email) between 5 and 254
    and email like '%@%.%'
  );

comment on table public.vp_unsubscribes is
  'Cold-outreach opt-outs. Insert-only for anon; read with the service role. Check this before any send.';
