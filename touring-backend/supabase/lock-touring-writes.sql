-- RUN-ME-GFLAM-LOCK.sql
-- =====================================================================================
-- PROJECT: Sydney, ref ijkzgmdtwtgfkedqspxm. Paste it into THAT project's SQL editor and nowhere else:
-- Supabase dashboard -> the Sydney project -> SQL Editor -> New query -> paste -> Run.
--
-- ORDER MATTERS. Run this LAST, after all three of these are true:
--   1. the new touring-api Worker is live (its /health shows the 19 Oct build),
--   2. the new touring/manage.html is live on gflamtouring.com.au,
--   3. tools/move-show-images-to-storage.py --write has moved the old pictures.
-- Run it before the new manager is live and the OLD manager cannot upload a tour card
-- picture (it uploads to the bucket with the public key, which this stops).
-- After it: python3 venueplay-backend/tools/dump-rls-baseline.py and commit the file,
-- or the release gate goes red on the policies this removes (the diff is the record).
--
-- WHAT IT DOES. Nobody but the touring-api Worker (which holds the service key) may write
-- the tour tables or put files in the tour-images bucket. Public READS are untouched: the
-- tour pages and the drag bingo page read shows, reviews, tour_categories, experience and
-- ticket_milestones with the public key and still will.
--
--   1. Drops every write policy that says "anyone, always" (true) on shows, reviews,
--      experience, ticket_milestones and tour_categories.
--   2. Takes INSERT, UPDATE, DELETE and TRUNCATE away from the public roles (anon and
--      authenticated) on those tables and on artists, venues and show_artists, so even a
--      policy added by mistake later cannot open them. "authenticated" counts as public
--      here: anyone with an email address can sign up on this project.
--   3. Drops "Anon upload tour-images", the storage rule that let anybody with the public
--      key upload any file of any size to the public tour-images bucket, and limits that
--      bucket to pictures of 2 MB or less.
--   4. Checks its own work and refuses to finish if any of it did not hold.
--
-- It does NOT touch contacts, signups, the cvs bucket, the ops_ tables or any vp_ table.
--
-- Safe to run twice. Nothing is deleted except rules; no row of data is touched.
-- Nothing public should break: no public page writes these tables (checked 19 Oct 2026;
-- the only other writer, an old admin block in touring/nextevent, has no way to open it).
-- If the Show Manager stops saving afterwards, the Worker is the thing to look at, not this.
-- =====================================================================================

begin;

drop policy if exists "Public write shows" on public.shows;
drop policy if exists "Public write reviews" on public.reviews;
drop policy if exists "Anon insert experience" on public.experience;
drop policy if exists "Anon delete experience" on public.experience;
drop policy if exists "Anon insert ticket_milestones" on public.ticket_milestones;
drop policy if exists "Anon delete ticket_milestones" on public.ticket_milestones;
drop policy if exists "Anon insert tour_categories" on public.tour_categories;
drop policy if exists "Anon delete tour_categories" on public.tour_categories;

revoke insert, update, delete, truncate on
  public.shows,
  public.reviews,
  public.experience,
  public.ticket_milestones,
  public.tour_categories,
  public.artists,
  public.venues,
  public.show_artists
from anon, authenticated;

-- Public reads are not touched: nothing above revokes SELECT.

do $$
declare bad text;
begin
  select string_agg(tablename || ': ' || policyname || ' (' || cmd || ')', '; ') into bad
    from pg_policies
   where schemaname = 'public'
     and tablename in ('shows', 'reviews', 'experience', 'ticket_milestones', 'tour_categories', 'artists', 'venues', 'show_artists')
     and cmd <> 'SELECT'
     and roles && array['public','anon','authenticated']::name[];
  if bad is not null then raise exception 'STILL WRITABLE BY THE PUBLIC: %', bad; end if;

  select string_agg(c.relname || ' ' || r.rolname || ' ' || p.priv, '; ') into bad
    from pg_class c
    cross join (values ('anon'), ('authenticated')) r(rolname)
    cross join (values ('INSERT'), ('UPDATE'), ('DELETE')) p(priv)
   where c.relnamespace = 'public'::regnamespace
     and c.relname in ('shows', 'reviews', 'experience', 'ticket_milestones', 'tour_categories', 'artists', 'venues', 'show_artists')
     and has_any_column_privilege(r.rolname, c.oid, p.priv);
  if bad is not null then raise exception 'A PUBLIC ROLE CAN STILL WRITE: %', bad; end if;

  if not has_table_privilege('anon', 'public.shows', 'SELECT') then
    raise exception 'the public pages could no longer read shows; nothing was changed';
  end if;
end $$;

commit;

-- ---- Storage, in its own transaction, so a refusal here cannot undo the tables above.
-- If this part stops with "must be owner of table objects", the tables ARE locked; delete
-- the rule by hand instead: Storage -> Policies -> tour-images -> "Anon upload tour-images".
begin;

drop policy if exists "Anon upload tour-images" on storage.objects;

update storage.buckets
   set file_size_limit = 2097152,
       allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
 where id = 'tour-images';

do $$
declare bad text;
begin
  select string_agg(policyname || ' (' || cmd || ')', '; ') into bad
    from pg_policies
   where schemaname = 'storage' and tablename = 'objects'
     and cmd <> 'SELECT'
     and roles && array['public','anon','authenticated']::name[]
     and (coalesce(with_check, '') || coalesce(qual, '')) like '%tour-images%';
  if bad is not null then raise exception 'tour-images IS STILL WRITABLE BY THE PUBLIC: %', bad; end if;
end $$;

commit;

-- Afterwards (read only): this should list NO policy for shows, reviews, experience,
-- ticket_milestones or tour_categories except the "Public read" ones.
select schemaname, tablename, policyname, cmd, roles
  from pg_policies
 where (schemaname = 'public' and tablename in ('shows', 'reviews', 'experience', 'ticket_milestones', 'tour_categories', 'artists', 'venues', 'show_artists'))
    or (schemaname = 'storage' and tablename = 'objects')
 order by 1, 2, 3;
