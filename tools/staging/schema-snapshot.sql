-- schema-snapshot.sql
-- =====================================================================================
-- READ ONLY. Safe on LIVE and on TEST. It changes nothing: it opens a read-only
-- transaction, runs one SELECT, and rolls back.
--
-- What it prints: ONE line of JSON describing the SHAPE of the database (no rows of data):
-- row security on/off per table, every policy, every grant to anon/authenticated, views,
-- security definer functions (the same five parts as venueplay-backend/supabase/RLS-BASELINE.json),
-- every column with its type, nullability and default, every function's definition (as an
-- md5), triggers, indexes, constraints, enum types, extensions, the realtime publication,
-- storage buckets and storage policies, and whether this project carries the TEST marker.
--
-- How to run it (main), once against each project, into two files:
--
--   PGOPTIONS='-c default_transaction_read_only=on' \
--     psql "$LIVE_DB_URL" -X -q -A -t -v ON_ERROR_STOP=1 -f tools/staging/schema-snapshot.sql > /tmp/vp-live-snapshot.json
--   PGOPTIONS='-c default_transaction_read_only=on' \
--     psql "$TEST_DB_URL" -X -q -A -t -v ON_ERROR_STOP=1 -f tools/staging/schema-snapshot.sql > /tmp/vp-test-snapshot.json
--
-- then compare them with no connection at all:
--
--   python3 tools/staging/check-schema-matches-live.py --live /tmp/vp-live-snapshot.json --test /tmp/vp-test-snapshot.json
--
-- No personal data is in the output: only table, column, policy and function names and
-- definitions. The files still stay in /tmp (or ~/.gflam-migrate), never in the repo.
-- =====================================================================================

begin transaction read only;

select json_build_object(
  'kind', 'venueplay-schema-snapshot',
  'version', 1,
  'taken_at', now(),
  'server_version', current_setting('server_version'),

  -- The TEST marker lives in its own schema (vp_staging) so that wiping public never removes it.
  -- LIVE must never have it. Read without naming the table directly, so this works on both.
  'staging_marker', case when to_regclass('vp_staging.vp_staging_marker') is null then null
                         else (xpath('//project_ref/text()',
                                query_to_xml('select project_ref from vp_staging.vp_staging_marker limit 1', false, false, '')))[1]::text
                    end,

  'rls', coalesce((select json_object_agg(c.relname, json_build_object('enabled', c.relrowsecurity, 'forced', c.relforcerowsecurity))
                   from pg_class c join pg_namespace n on n.oid = c.relnamespace
                   where n.nspname = 'public' and c.relkind in ('r', 'p')), '{}'::json),

  'policies', coalesce((select json_object_agg(tablename || '.' || policyname,
                              json_build_object('cmd', cmd, 'permissive', permissive, 'roles', array_to_string(roles, ','),
                                                'using', coalesce(qual, ''), 'with_check', coalesce(with_check, '')))
                        from pg_policies where schemaname = 'public'), '{}'::json),

  'grants', coalesce((select json_agg(table_name || ' ' || grantee || ' ' || privilege_type order by table_name, grantee, privilege_type)
                      from information_schema.role_table_grants
                      where table_schema = 'public' and grantee in ('anon', 'authenticated')), '[]'::json),

  'views', coalesce((select json_agg(table_name order by table_name) from information_schema.views where table_schema = 'public'), '[]'::json),

  'security_definer_functions', coalesce((select json_object_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
                                                 json_build_object('anon', has_function_privilege('anon', p.oid, 'execute'),
                                                                   'authenticated', has_function_privilege('authenticated', p.oid, 'execute')))
                                          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                                          where n.nspname = 'public' and p.prosecdef), '{}'::json),

  'columns', coalesce((select json_object_agg(t.table_name, t.cols) from (
                         select table_name,
                                json_agg(json_build_array(column_name, data_type || ':' || udt_name, is_nullable, coalesce(column_default, ''))
                                         order by ordinal_position) as cols
                         from information_schema.columns where table_schema = 'public' group by table_name) t), '{}'::json),

  'functions', coalesce((select json_object_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', md5(pg_get_functiondef(p.oid)))
                         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                         where n.nspname = 'public' and p.prokind in ('f', 'p')), '{}'::json),

  'triggers', coalesce((select json_object_agg(c.relname || '.' || t.tgname, pg_get_triggerdef(t.oid))
                        from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
                        where n.nspname = 'public' and not t.tgisinternal), '{}'::json),

  'indexes', coalesce((select json_object_agg(indexname, indexdef) from pg_indexes where schemaname = 'public'), '{}'::json),

  'constraints', coalesce((select json_object_agg(c.relname || '.' || k.conname, pg_get_constraintdef(k.oid))
                           from pg_constraint k join pg_class c on c.oid = k.conrelid join pg_namespace n on n.oid = c.relnamespace
                           where n.nspname = 'public'), '{}'::json),

  'enums', coalesce((select json_object_agg(t.typname, (select json_agg(e.enumlabel order by e.enumsortorder) from pg_enum e where e.enumtypid = t.oid))
                     from pg_type t join pg_namespace n on n.oid = t.typnamespace
                     where n.nspname = 'public' and t.typtype = 'e'), '{}'::json),

  'sequences', coalesce((select json_agg(sequencename order by sequencename) from pg_sequences where schemaname = 'public'), '[]'::json),

  'extensions', coalesce((select json_object_agg(extname, extversion) from pg_extension), '{}'::json),

  'realtime_publication', coalesce((select json_agg(schemaname || '.' || tablename order by schemaname, tablename)
                                    from pg_publication_tables where pubname = 'supabase_realtime'), '[]'::json),

  'storage_buckets', case when to_regclass('storage.buckets') is null then null
                          else (xpath('/r/text()', query_to_xml(
                                 'select coalesce(json_object_agg(id, json_build_object(''public'', public, ''file_size_limit'', file_size_limit, ''allowed_mime_types'', allowed_mime_types)), ''{}''::json)::text as r from storage.buckets',
                                 false, true, '')))[1]::text::json
                     end,

  'storage_policies', coalesce((select json_object_agg(tablename || '.' || policyname,
                                      json_build_object('cmd', cmd, 'permissive', permissive, 'roles', array_to_string(roles, ','),
                                                        'using', coalesce(qual, ''), 'with_check', coalesce(with_check, '')))
                                from pg_policies where schemaname = 'storage'), '{}'::json)
);

rollback;
