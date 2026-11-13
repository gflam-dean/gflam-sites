-- seed-test-data.sql
-- =====================================================================================
-- RUN ONLY ON THE OLD PROJECT gpoolavkghnxedzrmtmc (the venueplay TEST database), NEVER LIVE.
-- =====================================================================================
--
-- WHAT IT ADDS: made-up test venues and people only. Nothing here is a real person or a
-- real pub. Every email is on example.invalid (a name that can never receive mail); every
-- phone is 0491 57x xxx (stored as 6149157xxxx). Every venue slug starts "test-", so
-- anything that excludes test venues on live does the same here.
--
--   Venues   Test Alpha (QLD, one host, plain), Test Bravo (QLD, host + manager, in the group),
--            Test Charlie (NSW, 5-player plan for the over-plan and suspension paths),
--            Mini Bar (test) (QLD, the fake Mini Bar for the real-night test on the Kogan),
--            Test Echo (NSW) and Test Foxtrot (VIC), the other two venues in the group.
--   Group    "Test Pub Group": Bravo, Echo, Foxtrot, one bill (example.invalid billing email).
--   People   a test host (0491 570 001), a test manager (0491 570 002), both phone sign-in.
--            The HQ test admin is made by hand in the dashboard (README step 7) and linked here
--            if present: test-admin@example.invalid.
--   Players  40 fake players with opt-ins at Test Alpha and Mini Bar (test).
--   Members  a members list of 60 fake members at Mini Bar (test) and 25 at Test Bravo.
--
-- Sign-in without any text message: in the TEST project's dashboard, Authentication,
-- Providers, Phone, "Test phone numbers and OTPs", add 61491570001 and 61491570002 with a code
-- main chooses (not written in this repo). Supabase then never sends a text for them.
--
-- Safe to run twice: fixed ids, "on conflict do nothing". One transaction: all or nothing.
-- Written against COLUMNS-BASELINE.json names. The exact NOT NULL / CHECK rules are only known
-- once the schema is built; if one refuses a value, fix that value here and run again.
-- =====================================================================================

begin;

-- VP-STAGING-GUARD-BEGIN
do $guard$
declare n bigint;
begin
  if to_regclass('vp_staging.vp_staging_marker') is null then
    raise exception 'REFUSED: no TEST marker here. This is not the venueplay TEST project (gpoolavkghnxedzrmtmc), or 01-mark-this-as-test.sql was not run. Nothing was changed.';
  end if;
  execute 'select count(*) from vp_staging.vp_staging_marker where project_ref = ''gpoolavkghnxedzrmtmc''' into n;
  if n <> 1 then
    raise exception 'REFUSED: the TEST marker does not name gpoolavkghnxedzrmtmc. Nothing was changed.';
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

-- ---------- people (auth) ----------
-- Phone users the way Supabase Auth stores them: phone without "+", confirmed, empty token
-- strings (Auth refuses to sign in a user whose token columns are NULL).
insert into auth.users (instance_id, id, aud, role, email, phone, email_confirmed_at, phone_confirmed_at,
                        created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
                        confirmation_token, recovery_token, email_change_token_new, email_change,
                        phone_change, phone_change_token, email_change_token_current, reauthentication_token)
values
  ('00000000-0000-0000-0000-000000000000', '5eed0001-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
   'test-host@example.invalid', '61491570001', now(), now(), now(), now(),
   '{"provider":"phone","providers":["phone"]}', '{"name":"Test Host"}', '', '', '', '', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '5eed0001-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
   'test-manager@example.invalid', '61491570002', now(), now(), now(), now(),
   '{"provider":"phone","providers":["phone"]}', '{"name":"Test Manager"}', '', '', '', '', '', '', '', '')
on conflict (id) do nothing;

insert into auth.identities (id, user_id, provider_id, provider, identity_data, created_at, updated_at)
select gen_random_uuid(), u.id, u.phone, 'phone',
       jsonb_build_object('sub', u.id::text, 'phone', u.phone, 'email', u.email, 'phone_verified', true), now(), now()
from auth.users u
where u.id in ('5eed0001-0000-4000-8000-000000000001', '5eed0001-0000-4000-8000-000000000002')
  and not exists (select 1 from auth.identities i where i.user_id = u.id and i.provider = 'phone');

-- ---------- group ----------
insert into public.vp_venue_groups (id, name, billing_contact_name, billing_email, status, created_at)
values ('5eed0003-0000-4000-8000-000000000001', 'Test Pub Group', 'venueplay testing', 'test-group-billing@example.invalid', 'active', now())
on conflict (id) do nothing;

-- ---------- billing rows (one per venue; a venue insists on one) ----------
insert into public.venueplay_founding (id, created_at, venue_name, contact_name, contact_email, mobile, postcode,
                                       max_seats, status, marketing_opt_in, is_group)
values
  ('5eed0004-0000-4000-8000-000000000001', now(), 'Test Alpha',      'venueplay testing', 'test-host@example.invalid', '0491570001', '4220', 1, 'comp', false, false),
  ('5eed0004-0000-4000-8000-000000000002', now(), 'Test Bravo',      'venueplay testing', 'test-host@example.invalid', '0491570001', '4218', 1, 'comp', false, true),
  ('5eed0004-0000-4000-8000-000000000003', now(), 'Test Charlie',    'venueplay testing', 'test-host@example.invalid', '0491570001', '2026', 1, 'comp', false, false),
  ('5eed0004-0000-4000-8000-000000000004', now(), 'Mini Bar (test)', 'venueplay testing', 'test-host@example.invalid', '0491570001', '4227', 1, 'comp', false, false),
  ('5eed0004-0000-4000-8000-000000000005', now(), 'Test Echo',       'venueplay testing', 'test-host@example.invalid', '0491570001', '2000', 1, 'comp', false, true),
  ('5eed0004-0000-4000-8000-000000000006', now(), 'Test Foxtrot',    'venueplay testing', 'test-host@example.invalid', '0491570001', '3000', 1, 'comp', false, true)
on conflict (id) do nothing;

-- ---------- venues ----------
-- au_state is the column the gaming rules card reads (make-test-venues.py learnt that on 11 Sep).
insert into public.vp_venues (id, founding_id, group_id, slug, name, state, au_state, postcode, suburb, status,
                              timezone, included_players, hide_from_trusted, created_at)
values
  ('5eed0002-0000-4000-8000-000000000001', '5eed0004-0000-4000-8000-000000000001', null,
   'test-alpha',    'Test Alpha',      'QLD', 'QLD', '4220', 'Burleigh Heads', 'active', 'Australia/Brisbane', 40, true, now()),
  ('5eed0002-0000-4000-8000-000000000002', '5eed0004-0000-4000-8000-000000000002', '5eed0003-0000-4000-8000-000000000001',
   'test-bravo',    'Test Bravo',      'QLD', 'QLD', '4218', 'Broadbeach',     'active', 'Australia/Brisbane', 40, true, now()),
  ('5eed0002-0000-4000-8000-000000000003', '5eed0004-0000-4000-8000-000000000003', null,
   'test-charlie',  'Test Charlie',    'NSW', 'NSW', '2026', 'Bondi',          'active', 'Australia/Sydney',    5, true, now()),
  ('5eed0002-0000-4000-8000-000000000004', '5eed0004-0000-4000-8000-000000000004', null,
   'test-mini-bar', 'Mini Bar (test)', 'QLD', 'QLD', '4227', 'Varsity Lakes',  'active', 'Australia/Brisbane', 40, true, now()),
  ('5eed0002-0000-4000-8000-000000000005', '5eed0004-0000-4000-8000-000000000005', '5eed0003-0000-4000-8000-000000000001',
   'test-echo',     'Test Echo',       'NSW', 'NSW', '2000', 'Sydney',         'active', 'Australia/Sydney',   40, true, now()),
  ('5eed0002-0000-4000-8000-000000000006', '5eed0004-0000-4000-8000-000000000006', '5eed0003-0000-4000-8000-000000000001',
   'test-foxtrot',  'Test Foxtrot',    'VIC', 'VIC', '3000', 'Melbourne',      'active', 'Australia/Melbourne',40, true, now())
on conflict (id) do nothing;

insert into public.vp_venue_settings (venue_id)
select id from public.vp_venues where id::text like '5eed0002-%'
on conflict (venue_id) do nothing;

-- ---------- staff ----------
insert into public.vp_venue_staff (id, venue_id, auth_user_id, role, display_name, is_account_owner, created_at)
select ('5eed0005-0000-4000-8000-00000000000' || right(v.id::text, 1))::uuid, v.id,
       '5eed0001-0000-4000-8000-000000000001', 'owner', 'Test Host', true, now()
from public.vp_venues v where v.id::text like '5eed0002-%'
on conflict (id) do nothing;

insert into public.vp_venue_staff (id, venue_id, auth_user_id, role, display_name, is_account_owner, created_at)
values ('5eed0005-0000-4000-8000-000000000102', '5eed0002-0000-4000-8000-000000000002',
        '5eed0001-0000-4000-8000-000000000002', 'manager', 'Test Manager', false, now())
on conflict (id) do nothing;

-- HQ test admin: made by hand in the dashboard (email + password, never a real address).
insert into public.vp_platform_admins (auth_user_id, role, label)
select id, 'owner', 'Test admin (staging)' from auth.users where email = 'test-admin@example.invalid'
on conflict (auth_user_id) do nothing;

-- ---------- members lists ----------
insert into public.vp_member_rosters (id, venue_id, name, created_at)
values ('5eed0006-0000-4000-8000-000000000004', '5eed0002-0000-4000-8000-000000000004', 'Members (test)', now()),
       ('5eed0006-0000-4000-8000-000000000002', '5eed0002-0000-4000-8000-000000000002', 'Members (test)', now())
on conflict (id) do nothing;

insert into public.vp_members (id, roster_id, member_number, first_name, last_name, updated_at)
select ('5eed0007-0000-4000-8004-' || lpad(g::text, 12, '0'))::uuid, '5eed0006-0000-4000-8000-000000000004',
       lpad(g::text, 4, '0'), 'Member', 'Test ' || lpad(g::text, 3, '0'), now()
from generate_series(1, 60) g
on conflict (id) do nothing;

insert into public.vp_members (id, roster_id, member_number, first_name, last_name, updated_at)
select ('5eed0007-0000-4000-8002-' || lpad(g::text, 12, '0'))::uuid, '5eed0006-0000-4000-8000-000000000002',
       lpad(g::text, 4, '0'), 'Member', 'Bravo ' || lpad(g::text, 3, '0'), now()
from generate_series(1, 25) g
on conflict (id) do nothing;

-- ---------- fake players with opt-ins (the venue's player list) ----------
insert into public.vp_captures (id, venue_id, first_name, last_name, email, mobile, postcode,
                                marketing_optin, marketing_optin_at, source, created_at)
select ('5eed0008-0000-4000-800' || v.n || '-' || lpad(g::text, 12, '0'))::uuid, v.id,
       'Player', 'Test ' || lpad(g::text, 3, '0'),
       'player' || lpad(g::text, 3, '0') || '.' || v.slug || '@example.invalid',
       '0491571' || lpad((100 + g)::text, 3, '0'),
       v.postcode, (g % 3 <> 0), case when g % 3 <> 0 then now() end, 'test-seed', now()
from (values (1, '5eed0002-0000-4000-8000-000000000001'::uuid, 'test-alpha', '4220'),
             (4, '5eed0002-0000-4000-8000-000000000004'::uuid, 'test-mini-bar', '4227')) as v(n, id, slug, postcode),
     generate_series(1, 40) g
on conflict (id) do nothing;

-- ---------- prove it, inside the transaction ----------
do $check$
declare n bigint;
begin
  select count(*) into n from public.vp_venues where slug like 'test-%';
  if n < 6 then raise exception 'SEED SHORT: % test venue(s), expected 6. Rolled back.', n; end if;
  select count(*) into n from public.vp_venues where slug not like 'test-%';
  if n > 0 then raise exception 'SEED REFUSED: % venue(s) here that are not test- venues. Rolled back.', n; end if;
  select count(*) into n from auth.users where not (coalesce(email, '') like '%@example.invalid' or coalesce(phone, '') like '6149157%');
  if n > 0 then raise exception 'SEED REFUSED: % auth user(s) not on the fake addresses. Rolled back.', n; end if;
  select count(*) into n from public.vp_captures where email not like '%@example.invalid' or mobile not like '049157%';
  if n > 0 then raise exception 'SEED REFUSED: % player(s) with a real-looking email or phone. Rolled back.', n; end if;
  raise notice 'SEED DONE: 6 test venues, 1 group, 2 phone users, 85 members, 80 players. All fake.';
end
$check$;

commit;
