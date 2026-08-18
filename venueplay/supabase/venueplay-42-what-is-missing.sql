-- =====================================================================
-- Migration 42 (DIAGNOSTIC, read only): what is missing from the live database
-- ---------------------------------------------------------------------
-- Running migration 41 turned up two columns the code depends on that do not
-- exist in the live database: vp_venue_staff.label (which was a code bug, now
-- fixed) and vp_venue_staff.permissions (which means migration 17 never ran).
--
-- That second one matters a great deal. vpbLoadOwner selects `permissions`;
-- when the column is absent PostgREST rejects the request, vpaSelect returns
-- an empty list, and `perms` stays null. vpbIsOwner(o) is `!o.perms`, so EVERY
-- manager and every host who can reach the billing page is treated as the
-- account owner: change the plan, charge the card, cancel the venue, export
-- the player list.
--
-- Rather than discovering these one error at a time, this lists every column
-- and table the migrations in this repo were supposed to create, and shows
-- which are actually missing. It changes NOTHING.
--
-- Note: migrations 01 to 12 are not in the repo, so their tables and columns
-- cannot be checked here. Anything they created is assumed present.
-- =====================================================================

with expected_columns(table_name, column_name, added_by) as (
  values
    ('venueplay_founding','optin_release_approved','venueplay-20-optin-approval.sql'),
    ('vp_discounts','stripe_coupon_id','venueplay-37-discount-stripe-link.sql'),
    ('vp_member_draws','last_resolved_at','venueplay-14-game-hardening.sql'),
    ('vp_players','device_id','venueplay-39-player-device-id.sql'),
    ('vp_players','email','venueplay-18-player-capture.sql'),
    ('vp_players','first_name','venueplay-18-player-capture.sql'),
    ('vp_players','last_name','venueplay-18-player-capture.sql'),
    ('vp_players','marketing_optin','venueplay-18-player-capture.sql'),
    ('vp_players','marketing_optin_at','venueplay-18-player-capture.sql'),
    ('vp_players','mobile','venueplay-18-player-capture.sql'),
    ('vp_players','postcode','venueplay-18-player-capture.sql'),
    ('vp_questions','category','venueplay-25-question-meta.sql'),
    ('vp_questions','difficulty','venueplay-25-question-meta.sql'),
    ('vp_questions','image_url','venueplay-25-question-meta.sql'),
    ('vp_questions','improved_at','venueplay-32-question-flags.sql'),
    ('vp_questions','parked_at','venueplay-32-question-flags.sql'),
    ('vp_sessions','overage_approved','venueplay-14-game-hardening.sql'),
    ('vp_sessions','overage_approved_at','venueplay-14-game-hardening.sql'),
    ('vp_sessions','overage_approved_count','venueplay-39-player-device-id.sql'),
    ('vp_venue_screen','logo_url','venueplay-29-venue-logo.sql'),
    ('vp_venue_staff','permissions','venueplay-17-manager-permissions.sql'),
    ('vp_venues','cancel_at_period_end','venueplay-15-cancel-and-screen.sql'),
    ('vp_venues','last_musical_at','venueplay-13-weekly-limits.sql'),
    ('vp_venues','last_musical_session_id','venueplay-13-weekly-limits.sql'),
    ('vp_venues','last_trivia_at','venueplay-13-weekly-limits.sql'),
    ('vp_venues','last_trivia_session_id','venueplay-13-weekly-limits.sql'),
    ('vp_venues','overage_streak','venueplay-33-overage-streak.sql'),
    ('vp_venues','overage_streak_peaks','venueplay-33-overage-streak.sql'),
    ('vp_venues','suspended_reason','venueplay-35-suspend-reason.sql')
),
expected_tables(table_name, added_by) as (
  values
    ('vp_asked_questions','venueplay-26-asked-questions.sql'),
    ('vp_captures','venueplay-22-broadcast-capture-report.sql'),
    ('vp_game_reports','venueplay-22-broadcast-capture-report.sql'),
    ('vp_question_flags','venueplay-32-question-flags.sql'),
    ('vp_question_submissions','venueplay-27-question-submissions.sql'),
    ('vp_song_flags','venueplay-34-song-flags.sql'),
    ('vp_venue_screen','venueplay-15-cancel-and-screen.sql'),
    ('vp_venue_signing_keys','venueplay-38-broadcast-signing-keys.sql')
)
select 'MISSING COLUMN' as problem, e.table_name, e.column_name, e.added_by
from expected_columns e
join information_schema.tables t
  on t.table_schema = 'public' and t.table_name = e.table_name
left join information_schema.columns c
  on c.table_schema = 'public' and c.table_name = e.table_name and c.column_name = e.column_name
where c.column_name is null

union all

select 'MISSING TABLE', e.table_name, null, e.added_by
from expected_tables e
left join information_schema.tables t
  on t.table_schema = 'public' and t.table_name = e.table_name
where t.table_name is null

order by 4, 2, 3;


-- =====================================================================
-- PART 2: functions, triggers and views
-- ---------------------------------------------------------------------
-- Part 1 only sees columns and tables, so it cannot tell whether a migration
-- that only defines a FUNCTION or a TRIGGER ever ran. That matters: the
-- marketing gate (21/28/43) is a trigger, and without it every account can
-- switch on player contact collection freely. Run this second.
-- =====================================================================

with expected_functions(name, added_by) as (
  values
    ('vp_gate_marketing_collect','venueplay-43-optin-gate-by-domain.sql'),
    ('vp_park_flagged','venueplay-32-question-flags.sql'),
    ('vp_qkey','venueplay-32-question-flags.sql'),
    ('vp_songs_to_retire','venueplay-34-song-flags.sql')
),
expected_triggers(name, added_by) as (
  values
    ('vp_venue_settings_gate','venueplay-43-optin-gate-by-domain.sql')
),
expected_views(name, added_by) as (
  values
    ('v_vp_player_optins','venueplay-19-optin-export-view.sql'),
    ('v_vp_question_review_queue','venueplay-32-question-flags.sql'),
    ('v_vp_screen_draws','venueplay-24-venue-timezone.sql'),
    ('v_vp_song_flag_counts','venueplay-34-song-flags.sql'),
    ('v_vp_trusted','venueplay-30-trusted-view.sql')
)
select 'MISSING FUNCTION' as problem, e.name, e.added_by
from expected_functions e
where not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = e.name
)
union all
select 'MISSING TRIGGER', e.name, e.added_by
from expected_triggers e
where not exists (
  select 1 from pg_trigger t where not t.tgisinternal and t.tgname = e.name
)
union all
select 'MISSING VIEW', e.name, e.added_by
from expected_views e
where not exists (
  select 1 from information_schema.views v
   where v.table_schema = 'public' and v.table_name = e.name
)
order by 3, 2;
