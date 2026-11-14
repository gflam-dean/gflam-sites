-- venueplay-197-purchase-raffle-members.sql
-- NOT RUN ON LIVE. Safe to run more than once. Run BEFORE the Worker that writes these columns ships.
-- Dean, 14 Nov 2026: the purchase raffle's new-customer form asks only what the venue collects, a customer
-- can be a member of the venue's list, and one who ticks "Send me offers from {venue}" joins that list.
--   postcode           kept when the venue collects it
--   member_capture_id  the venue's list row (vp_captures) this entrant came from or was linked to
--   last_name          may be empty: a venue that collects no last name stores none
-- age_confirmed_at stays (not null) and now holds the entry time: there is no 18+ tick any more.
-- Number 197: 194 to 196 are taken on other branches (checked every branch, 14 Nov 2026).
-- TEST only, through tools/staging/run-on-test.py; the guard block below refuses anywhere else.
-- VP-STAGING-GUARD-BEGIN
do $guard$
declare n bigint;
begin
  if to_regclass('vp_staging.vp_staging_marker') is null then
    raise exception 'REFUSED: no TEST marker here. This is not the venueplay TEST project (rkfaftxgzpsmmrzudlqy), or 01-mark-this-as-test.sql was not run. Nothing was changed.';
  end if;
  execute 'select count(*) from vp_staging.vp_staging_marker where project_ref = ''rkfaftxgzpsmmrzudlqy''' into n;
  if n <> 1 then
    raise exception 'REFUSED: the TEST marker does not name rkfaftxgzpsmmrzudlqy. Nothing was changed.';
  end if;
  select count(*) into n from auth.users
   where greatest(coalesce(last_sign_in_at, 'epoch'::timestamptz), coalesce(created_at, 'epoch'::timestamptz)) >= '2026-10-01'
     and not (coalesce(email, '') like '%@example.invalid' or coalesce(phone, '') like '6149157%');
  if n > 0 then
    raise exception 'REFUSED: % real person(s) signed in here since 1 Oct 2026. The TEST project only ever has fake users. Is this LIVE? Nothing was changed.', n;
  end if;
end
$guard$;
-- VP-STAGING-GUARD-END

alter table public.vp_purchase_raffle_entrants add column if not exists postcode text
  check (postcode is null or char_length(postcode) <= 10);
alter table public.vp_purchase_raffle_entrants add column if not exists member_capture_id uuid
  references public.vp_captures(id) on delete set null;
create index if not exists vp_purchase_raffle_entrants_member on public.vp_purchase_raffle_entrants (member_capture_id)
  where member_capture_id is not null;
alter table public.vp_purchase_raffle_entrants alter column last_name drop not null;
alter table public.vp_purchase_raffle_entrants drop constraint if exists vp_purchase_raffle_entrants_last_name_check;
alter table public.vp_purchase_raffle_entrants add constraint vp_purchase_raffle_entrants_last_name_check
  check (last_name is null or char_length(last_name) <= 60);

-- Rollback (nothing else reads the two new columns):
--   alter table public.vp_purchase_raffle_entrants drop column if exists member_capture_id, drop column if exists postcode;
