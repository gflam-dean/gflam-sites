-- =====================================================================
-- LET DEAN BACK INTO THE PARTYPLAY ADMIN
--
-- Migration 11 created pp_admins and moved admin sign-in to phone OTP.
-- It seeded NO rows. So the moment the shared key came off the sign-in
-- screen, the table that decides who gets in was empty, and every admin
-- action answered "no" -- including comping a party.
--
-- This adds the first admin. Replace the number with your real mobile in
-- E.164: +61 then the number without its leading zero.
--    0412 345 678  ->  +61412345678
--
-- Run it in the Supabase SQL editor on the PARTYPLAY project.
-- =====================================================================

insert into pp_admins (mobile, name, added_by)
values ('+61400000000', 'Dean Tindale', 'seed')
on conflict (mobile) do update
  set active = true,
      name   = excluded.name;

-- Check it took. This must return exactly your number, with active = true.
select mobile, name, active, added_at from pp_admins order by added_at;
