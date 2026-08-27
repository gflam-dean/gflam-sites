-- PartyPlay 11: who is allowed into the admin screens.
--
-- Until now there was one shared ADMIN_KEY. That is fine for one person and
-- wrong for a team: you cannot tell who did what, and when somebody leaves the
-- only remedy is changing the key on everyone.
--
-- So: an allow-list of mobile numbers. A staff member signs in with their own
-- phone, Supabase sends them a code, and the Worker checks the number against
-- this table. The shared key still works and is deliberately kept, because the
-- first admin has to be added somehow and because locking yourself out of your
-- own support console at 9pm on a Saturday is not a risk worth taking.

create table if not exists pp_admins (
  id            uuid primary key default gen_random_uuid(),
  mobile        text not null unique,      -- E.164, +614xxxxxxxx. Normalised by the Worker.
  name          text not null,
  active        boolean not null default true,
  added_at      timestamptz not null default now(),
  added_by      text,                      -- the mobile that added them, or 'key' for the shared key
  last_seen_at  timestamptz
);

comment on table pp_admins is
  'Mobile numbers allowed into the PartyPlay admin screens. Sign-in is Supabase phone OTP; this table decides who gets past it.';
comment on column pp_admins.active is
  'Set false rather than deleting, so the audit log still resolves who did what.';

create index if not exists pp_admins_active_idx on pp_admins (mobile) where active;

-- RLS on, no policies: the service key reaches it, the public key never does.
alter table pp_admins enable row level security;

-- The action log already exists (migration 09). Record WHICH admin, not just that
-- it was "an admin", now that there can be more than one.
alter table pp_admin_log
  add column if not exists actor text;      -- the mobile, or 'key' for the shared key

comment on column pp_admin_log.actor is
  'Who did it: an E.164 mobile from pp_admins, or the literal ''key'' when the shared ADMIN_KEY was used.';
