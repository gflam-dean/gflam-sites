-- VenuePlay migration 16: a public, read-only view for the venue TV's members-draw board.
-- Safe to run more than once.
--
-- The venue TV (/tv?venue=<slug>) runs unauthenticated, so it cannot read vp_member_draws
-- directly (RLS grants host SELECT only). This view exposes ONLY the non-sensitive board fields
-- (draw name, current jackpot, day and time) keyed by the venue slug, so the idle screen can
-- show the live jackpot between games. No member PII is exposed.
--
-- A view created here is owned by postgres, so it reads past RLS on vp_member_draws; we then
-- grant SELECT on the VIEW to anon. Only these four columns are ever visible.

CREATE OR REPLACE VIEW v_vp_screen_draws AS
SELECT
  v.slug AS slug,
  d.name AS name,
  d.current_jackpot_cents AS current_jackpot_cents,
  d.draw_day AS draw_day,
  d.draw_time AS draw_time
FROM vp_member_draws d
JOIN vp_venues v ON v.id = d.venue_id;

GRANT SELECT ON v_vp_screen_draws TO anon, authenticated;
