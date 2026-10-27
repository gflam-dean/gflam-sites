-- ============================================================================
-- Paste this whole thing into the Supabase SQL Editor and press Run.
-- It changes nothing. It only reports back.
--
-- Read the "verdict" column. Every row should say OK.
-- ============================================================================

select 'WHICH PROJECT'  as check,
       case when exists (select 1 from information_schema.tables
                          where table_schema='public' and table_name like 'vp\_%')
            then 'OK   this is the VenuePlay project, which is the right one'
            else 'WRONG  no vp_ tables here, so this is a NEW project. Use the VenuePlay one instead.'
       end as verdict

union all
select '01 tables',
       case when (select count(*) from information_schema.tables
                   where table_schema='public'
                     and table_name in ('pp_licences','pp_subscribers','pp_games','pp_players')) = 4
            then 'OK   all four pp_ tables exist'
            else 'MISSING  only ' || (select count(*) from information_schema.tables
                   where table_schema='public'
                     and table_name in ('pp_licences','pp_subscribers','pp_games','pp_players'))
                 || ' of 4. Run partyplay-01-core.sql'
       end

union all
select '01 player cap',
       case when exists (select 1 from information_schema.triggers
                          where trigger_name='pp_players_cap')
            then 'OK   the 50 player limit is enforced by the database'
            else 'MISSING  no cap trigger. Run partyplay-01-core.sql'
       end

union all
select '01 RLS locked',
       case when (select count(*) from pg_tables
                   where schemaname='public'
                     and tablename in ('pp_licences','pp_subscribers','pp_games','pp_players')
                     and rowsecurity) = 4
            then 'OK   all four locked, nothing readable with the public key'
            else 'PROBLEM  a pp_ table has RLS off. Re-run partyplay-01-core.sql'
       end

union all
select '02 host key',
       case when exists (select 1 from information_schema.columns
                          where table_name='pp_licences' and column_name='host_key')
            then 'OK   guests cannot edit a host''s games'
            else 'MISSING  run partyplay-02-host-key.sql'
       end

union all
select '03 party name',
       case when exists (select 1 from information_schema.columns
                          where table_name='pp_licences' and column_name='party_name')
             and exists (select 1 from information_schema.columns
                          where table_name='pp_licences' and column_name='is_comp')
             and exists (select 1 from information_schema.columns
                          where table_name='pp_licences' and column_name='followup_sent_at')
            then 'OK   party name, comps and follow-up emails ready'
            else 'MISSING  run partyplay-03-party-name-and-comps.sql'
       end

union all
select 'rows so far',
       'licences ' || (select count(*) from pp_licences) ||
       ', games ' || (select count(*) from pp_games) ||
       ', players ' || (select count(*) from pp_players) ||
       ', subscribers ' || (select count(*) from pp_subscribers)
;
