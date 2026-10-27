-- ============================================================================
-- PartyPlay 09: a record of what support did.
--
-- The admin screen can hand out a host link, put somebody's clock back, add
-- hours, or empty a room. Those are the right powers for whoever answers the
-- phone at 9pm, and exactly the powers that need a name against them.
-- ============================================================================

create table if not exists pp_admin_log (
  id          uuid primary key default gen_random_uuid(),
  licence_id  uuid references pp_licences(id) on delete set null,
  code        text,
  action      text not null,
  detail      text,
  why         text,
  at          timestamptz not null default now()
);
create index if not exists pp_admin_log_at_idx   on pp_admin_log (at desc);
create index if not exists pp_admin_log_code_idx on pp_admin_log (code, at desc);

alter table pp_admin_log enable row level security;

comment on table pp_admin_log is
  'Every support action taken from /admin. Deliberately never deleted: it is the answer to "who gave them another day".';
