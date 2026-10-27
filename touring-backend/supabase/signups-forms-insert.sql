-- RUN-ME-GFLAM-SIGNUPS.sql
-- =====================================================================================
-- PROJECT: Sydney, ref ijkzgmdtwtgfkedqspxm. Paste it into THAT project's SQL editor:
-- Supabase dashboard -> the Sydney project -> SQL Editor -> New query -> paste -> Run.
--
-- WHY. Every "Join the Gflam family" and mailing-list form posts straight to
-- public.signups with the public key, and the public role has no INSERT on that table.
-- Checked 19 Oct 2026 with the exact request the forms send (and a body that could not
-- be stored even if it got through): "42501 permission denied for table signups".
-- So every signup since the tables were locked has been refused. Three of the five
-- forms then said "thanks" anyway; the new pages say it did not go through.
--
-- WHAT IT DOES
--   1. Lets the public key ADD a signup, and nothing else: no reading, changing or
--      deleting, and only the columns the forms fill in (first_name, mobile, email,
--      postcode, state, source, signup_type).
--   2. Replaces the old "anyone, anything" insert rule with one that checks the shape:
--      a real looking email, short fields, a source the website actually uses.
--   3. Takes away the public role's leftover READ grant on signups (it could not read
--      rows anyway, because no rule let it; this removes the grant too). Signed-in
--      HQ admins keep their read rule.
--   4. Checks its own work and refuses to finish if any of it did not hold.
--
-- ORDER. Run this FIRST, before the new pages go live, and it is safe to run now:
-- it only opens the one door the forms need. The new pages show an error when a signup
-- fails, so if they go live before this, people see "that didn't go through" instead of
-- a thank-you. It does not touch anything RUN-ME-GFLAM-LOCK.sql touches (that one is
-- about the tour tables and the picture bucket), so the two can run in either order.
-- Safe to run twice.
-- =====================================================================================

begin;

drop policy if exists "Public insert signups" on public.signups;
drop policy if exists "Website forms add a signup" on public.signups;

revoke all on public.signups from anon;
grant insert (first_name, mobile, email, postcode, state, source, signup_type) on public.signups to anon;

create policy "Website forms add a signup" on public.signups
  for insert to anon
  with check (
    email is not null and length(email) between 5 and 254 and email like '%_@_%._%'
    and coalesce(length(first_name), 0) <= 80
    and coalesce(length(mobile), 0) <= 30
    and coalesce(length(postcode), 0) <= 10
    and coalesce(length(state), 0) <= 200
    and source in ('gflam_touring', 'gflam_group', 'drag_bingo', 'nextevent_discount', 'website')
    and coalesce(signup_type, 'signup') = 'signup'
  );

do $$
begin
  if not has_table_privilege('anon', 'public.signups', 'INSERT') and
     not has_column_privilege('anon', 'public.signups', 'email', 'INSERT') then
    raise exception 'the forms still cannot add a signup';
  end if;
  if has_any_column_privilege('anon', 'public.signups', 'SELECT')
     or has_any_column_privilege('anon', 'public.signups', 'UPDATE')
     or has_table_privilege('anon', 'public.signups', 'DELETE') then
    raise exception 'the public key can still read, change or delete signups';
  end if;
  if has_column_privilege('anon', 'public.signups', 'brand', 'INSERT') then
    raise exception 'the public key can fill columns the forms never send';
  end if;
end $$;

commit;

-- Afterwards (read only): one INSERT rule for anon, and the HQ read rule.
select policyname, cmd, roles from pg_policies where schemaname = 'public' and tablename = 'signups';
