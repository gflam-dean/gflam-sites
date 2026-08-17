-- =====================================================================
-- Migration 39: count PEOPLE, not joins
-- ---------------------------------------------------------------------
-- Overage is billed on a count of vp_players rows for the session. Every join
-- inserts a row, so the number we charge a venue for was never a headcount:
--
--   * The join dedup keyed on b.pid, and no player page ever sent pid in the
--     /join body, so the dedup branch never ran once in production.
--   * Even when it did run it was a 120 second KV key, against a 3 hour night.
--   * The per-device id lived in sessionStorage and was namespaced per format
--     (vp-tpid-*, vp-mpid-*), so it died with the tab and never carried from
--     trivia to musical bingo.
--
-- So a venue capped at 100 running trivia and then musical bingo, with 60 real
-- patrons joining both, was billed for 120 players: $40 for a night that never
-- touched their cap. Phone locks, reloads and private browsing added more, and
-- three such nights permanently moved them up a plan through upliftPlan().
--
-- This stores the device id on the row so the count can be made per-device.
-- Deliberately NOT a unique constraint: a failed insert means a patron cannot
-- join, which is worse than a duplicate row. The Worker reuses the existing row
-- when it finds one, and chargeNightOverage counts DISTINCT devices, so a race
-- that slips a duplicate through still cannot overbill.
--
-- Rows written before this migration have device_id null and are counted
-- individually, exactly as they are today. Nothing is retrospectively rebilled.
-- =====================================================================

alter table vp_players
  add column if not exists device_id text;

comment on column vp_players.device_id is
  'Stable per-browser id supplied by the player page as pid on /join. Used to reuse a row on rejoin and to bill distinct devices rather than joins. Null for rows created before migration 39, and for any page that does not send one.';

-- Lookup path for the reuse-on-rejoin check in handlePlayerJoin.
create index if not exists vp_players_session_device_idx
  on vp_players (session_id, device_id)
  where device_id is not null;

-- ---------------------------------------------------------------------
-- Part 2: an approval is for a NUMBER, not a blank cheque
-- ---------------------------------------------------------------------
-- handleOverageAck stored only overage_approved = true. The amount was re-read
-- at close, with no ceiling, so the host's one tap on a genuine "5 extra
-- players, $10" prompt authorised whatever the count happened to be hours
-- later. /join needs no login and its per-device rate limit keys on a
-- client-supplied User-Agent, so a join flood against a venue whose host had
-- approved a small overage could reach a five-figure invoice on a real card.
-- The same gap covered an honest case: consent given for 5 extra players at
-- 7pm silently covered 200 at 11pm.
--
-- Recording the headcount at the moment of approval lets the Worker bill only
-- what was actually agreed, plus a small margin for stragglers, and ask again
-- above that.

alter table vp_sessions
  add column if not exists overage_approved_count integer;

comment on column vp_sessions.overage_approved_count is
  'Player count at the moment the host approved the overage. chargeNightOverage will not bill beyond this plus OVERAGE_ACK_MARGIN; going further needs a fresh approval. Null on sessions approved before migration 39, which fall back to the plan cap plus the margin.';
