-- live-extras.sql
-- =====================================================================================
-- READ ONLY. Run it against LIVE. It changes nothing: a read-only transaction, SELECTs,
-- rollback. It PRINTS SQL (as text) for the parts of live's set-up that a
-- "pg_dump --schema=public" does not carry, so build-test-schema.sh can add them to TEST:
--
--   * extensions (with the schema each lives in),
--   * which public tables are in the realtime publication (supabase_realtime),
--   * storage buckets (name, public or not, size limit, allowed types; NO files),
--   * storage policies (the rules on storage.objects and storage.buckets).
--
-- How (main):
--   PGOPTIONS='-c default_transaction_read_only=on' \
--     psql "$LIVE_DB_URL" -X -q -A -t -v ON_ERROR_STOP=1 -f tools/staging/live-extras.sql > ~/.gflam-migrate/live-extras-out.sql
--
-- The output holds names and rules only, no rows of customer data.
-- =====================================================================================

begin transaction read only;

select '-- live extras, read from live at ' || now()::text;

select format('create extension if not exists %I with schema %I;', e.extname, n.nspname)
from pg_extension e join pg_namespace n on n.oid = e.extnamespace
where e.extname not in ('plpgsql')
order by e.extname;

select format('alter publication supabase_realtime add table %I.%I;', schemaname, tablename)
from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public'
order by schemaname, tablename;

select format('insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values (%L, %L, %L, %s, %s) '
              'on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;',
              id, name, public, coalesce(file_size_limit::text, 'null'),
              case when allowed_mime_types is null then 'null' else quote_literal(allowed_mime_types::text) || '::text[]' end)
from storage.buckets order by id;

select format('drop policy if exists %I on storage.%I;', policyname, tablename)
from pg_policies where schemaname = 'storage' order by tablename, policyname;

select format('create policy %I on storage.%I as %s for %s to %s%s%s;',
              policyname, tablename, lower(permissive), lower(cmd),
              array_to_string(array(select quote_ident(r) from unnest(roles) r), ', '),
              case when qual is not null then ' using (' || qual || ')' else '' end,
              case when with_check is not null then ' with check (' || with_check || ')' else '' end)
from pg_policies where schemaname = 'storage' order by tablename, policyname;

rollback;
