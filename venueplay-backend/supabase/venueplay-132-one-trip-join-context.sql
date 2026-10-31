-- =====================================================================
-- Migration 132: a phone joining a game reads everything it needs in ONE trip
-- ---------------------------------------------------------------------
--   Safe in either order with the game Worker. The Worker calls this
--   function and, if it is not there (404), joins the old way and stops
--   asking for the rest of that isolate's life. Only the cost depends on it.
--
-- WHY (31 Oct 2026, step 4 of the 12 Sep 2026 plan for 1,000+ venues).
-- The database gateway is the wall: it bent at about 43 calls a second on
-- the 30 Oct live ramp. POST /join (a phone joining tonight's game) read,
-- one call each: the open session for the code, the venue's status, group
-- and slug (the kill-switch), the venue group's status, the venue's
-- collect settings (which details it has agreed to keep), the phone's own
-- earlier player row (so a re-join is one player, billed once), and the
-- session's running games (for the phone's snapshot). Six calls, before
-- the one write. This returns all six in one.
--
-- IT DECIDES NOTHING. It only reads. Every check stays in the Worker, in
-- the same words: no session is a 404, a paused venue or group is the same
-- 403, a kicked player is never returned as the phone's earlier row, and
-- the collect settings still gate what is stored. The Worker test
-- (tools/test-join-cost.js) runs the join both ways and demands the same
-- answer and the same rows.
--
-- Shapes, matching what PostgREST answered to the reads it replaces:
--   session       the vp_sessions row (select=*) of an open session
--                 (lobby, running, paused) with this join code, or null
--   venue         { status, group_id, slug } of that session's venue, or null
--   group         { status } of the venue's group, or null (no group, or
--                 none found: the Worker passes both, as before)
--   settings      the six collect_* switches, or null (none set yet)
--   prior_id      the phone's earliest NOT KICKED player row in that session
--                 for this device id, or null. p_device '' never matches.
--   running       the session's running games { id, seq, format, config,
--                 status }, newest first, or []
--
-- Service role only. The anon key is printed in every page and must not
-- be able to read a session or a venue's settings by guessing a code.
-- No new table and no policy. After it is run, re-dump the baseline:
--   python3 venueplay-backend/tools/dump-rls-baseline.py
-- and commit RLS-BASELINE.json (it adds this function, anon and
-- authenticated both false).
--
-- Rollback:
--   drop function if exists public.vp_join_context(text, text);
-- (the Worker then joins the old way again on its own).
-- =====================================================================

begin;

create or replace function public.vp_join_context(p_code text, p_device text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with s as (
    select * from public.vp_sessions
     where join_code = p_code and status in ('lobby', 'running', 'paused')
     limit 1
  ), v as (
    select vv.id, vv.status, vv.group_id, vv.slug
      from public.vp_venues vv join s on vv.id = s.venue_id
  )
  select case when not exists (select 1 from s) then jsonb_build_object('session', null)
  else jsonb_build_object(
    'session',  (select to_jsonb(s) from s),
    'venue',    (select jsonb_build_object('status', v.status, 'group_id', v.group_id, 'slug', v.slug) from v),
    'group',    (select jsonb_build_object('status', g.status)
                   from public.vp_venue_groups g join v on g.id = v.group_id limit 1),
    'settings', (select jsonb_build_object(
                   'collect_first_name', st.collect_first_name, 'collect_last_name', st.collect_last_name,
                   'collect_postcode', st.collect_postcode, 'collect_email', st.collect_email,
                   'collect_mobile', st.collect_mobile, 'collect_marketing_optin', st.collect_marketing_optin)
                   from public.vp_venue_settings st join s on st.venue_id = s.venue_id limit 1),
    'prior_id', (select p.id from public.vp_players p join s on p.session_id = s.id
                  where p_device <> '' and p.device_id = p_device and p.kicked = false
                  order by p.joined_at asc limit 1),
    'running',  coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'seq', g.seq, 'format', g.format,
                                                              'config', g.config, 'status', g.status)
                                           order by g.seq desc)
                            from public.vp_games g join s on g.session_id = s.id
                           where g.status = 'running'), '[]'::jsonb)
  ) end
$$;

revoke all on function public.vp_join_context(text, text) from public, anon, authenticated;
grant execute on function public.vp_join_context(text, text) to service_role;

comment on function public.vp_join_context(text, text) is
  'POST /join in one read: the open session for a join code, its venue and group status, the venue collect settings, the phone''s earlier not-kicked player row and the running games. Reads only; the Worker makes every decision.';

commit;
