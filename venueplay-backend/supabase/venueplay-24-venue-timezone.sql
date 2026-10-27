-- VenuePlay migration 24: give every venue its correct timezone (from its postcode) and expose it
-- to the venue TV. Safe to run more than once.
--
-- WHY: signup never collected a timezone, so vp_venues.timezone defaulted to 'Australia/Brisbane'
-- for everyone. That is correct for QLD but wrong for WA (-2h), SA (-30m) and the eastern
-- daylight-saving states (+1h in summer), which made the members-draw "Tonight" badge light up on
-- the wrong day for non-QLD venues. We derive the IANA timezone from the stored postcode.

-- 1) Backfill timezone from postcode (numeric ranges match the app's postcode->state mapping).
UPDATE vp_venues v
SET timezone = t.tz
FROM (
  SELECT id,
    CASE
      WHEN pc BETWEEN 800  AND 999  THEN 'Australia/Darwin'     -- NT
      WHEN pc BETWEEN 200  AND 2999 THEN 'Australia/Sydney'     -- ACT + NSW (Sydney tz)
      WHEN pc BETWEEN 3000 AND 3999 THEN 'Australia/Melbourne'  -- VIC
      WHEN pc BETWEEN 8000 AND 8999 THEN 'Australia/Melbourne'  -- VIC (PO boxes)
      WHEN pc BETWEEN 4000 AND 4999 THEN 'Australia/Brisbane'   -- QLD
      WHEN pc BETWEEN 9000 AND 9999 THEN 'Australia/Brisbane'   -- QLD (PO boxes)
      WHEN pc BETWEEN 5000 AND 5799 THEN 'Australia/Adelaide'   -- SA
      WHEN pc BETWEEN 6000 AND 6797 THEN 'Australia/Perth'      -- WA
      WHEN pc BETWEEN 7000 AND 7799 THEN 'Australia/Hobart'     -- TAS
      ELSE NULL
    END AS tz
  FROM (
    SELECT id, NULLIF(regexp_replace(COALESCE(postcode, ''), '\D', '', 'g'), '')::int AS pc
    FROM vp_venues
  ) q
) t
WHERE v.id = t.id AND t.tz IS NOT NULL;

-- 2) Republish the public members-draw board view WITH the venue timezone, so /tv (unauthenticated)
--    can decide "Tonight" in the venue's own time rather than the TV device's timezone.
CREATE OR REPLACE VIEW v_vp_screen_draws AS
SELECT
  v.slug                 AS slug,
  d.name                 AS name,
  d.current_jackpot_cents AS current_jackpot_cents,
  d.draw_day             AS draw_day,
  d.draw_time            AS draw_time,
  COALESCE(v.timezone, 'Australia/Brisbane') AS timezone
FROM vp_member_draws d
JOIN vp_venues v ON v.id = d.venue_id;

GRANT SELECT ON v_vp_screen_draws TO anon, authenticated;
