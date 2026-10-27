-- 98: the Gflam website signup lists are readable by HQ admins only.
--
-- Found 14 Oct 2026 by the platform break test. `signups` (name, email, phone, state) and
-- `contacts` (name, email, message) belong to the Gflam websites but live in the VenuePlay
-- database. Their read policy was auth.role() = 'authenticated', which means ANY signed-in
-- account: every pub host, every manager, and anyone who signs themselves up with the public
-- key. A test host read both tables. The anon key alone could not, so "empty to the public"
-- looked like "locked".
--
-- Nothing reads these tables with a login: the websites only INSERT (that policy is kept),
-- and Dean reads them as a Gflam admin. So reads go to vp_is_platform_admin() and nobody
-- else. Run in the Supabase SQL editor. Safe to run twice.

begin;

drop policy if exists "Auth read signups" on public.signups;
create policy "Auth read signups" on public.signups
  for select to authenticated
  using (public.vp_is_platform_admin());

drop policy if exists "Auth read contacts" on public.contacts;
create policy "Auth read contacts" on public.contacts
  for select to authenticated
  using (public.vp_is_platform_admin());

commit;

-- Read back: both rows should say vp_is_platform_admin()
select tablename, policyname, cmd, qual
  from pg_policies
 where schemaname = 'public' and tablename in ('signups', 'contacts')
 order by tablename, policyname;
