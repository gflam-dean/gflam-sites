-- VenuePlay migration 177: the venue's own "What's on" guide (INBOX 110, Dean 6 Nov 2026, promised to Revolver Upstairs
-- for the Thu 12 Nov release).
--
-- NOT RUN. Safe to run more than once. Run it BEFORE the two Workers that use it go live, or after: either order works.
--   Before it runs, the account page's What's on card says it is not switched on yet and saves nothing; the TV and the
--   phones show no events (the Workers ask again without the column, exactly as before). After it runs, it all works.
--
-- WHY A COLUMN AND NOT A NEW TABLE. The brief said a new table vp_venue_events "unless an existing structure fits
-- better". vp_venue_screen fits better: it is already the venue's own screen content (logo, slides, raffle blurb), and
--   - GET /screen (every TV) and /join/info with ad:1 (every phone's lobby) ALREADY read this one row, so the events
--     ride the same read: no new request from any TV or phone, and nothing new on the busiest routes;
--   - every change to it is already recorded by migration 114 (vp_venue_screen_history, the trigger copies the whole
--     row), so an event added or removed has the same before-and-after record and HQ restore as a slide;
--   - it is already locked to the Workers: RLS on, no grant to anon or authenticated (migration 48), so nothing new
--     to lock and RLS-BASELINE.json does not change;
--   - a venue has at most 30 upcoming events, which is a small list, not a growing table.
--
-- One column, events: a JSON list, at most 60 entries (the Worker keeps 30 upcoming and drops past ones on every save;
-- 60 is the database's own backstop), and at most 40,000 characters in all. Each entry is what the Worker cleaned:
--   { id, title, date | day (+ until), start?, line?, image_url? }   (see /app/vp-whatson.js for the rules)

BEGIN;

ALTER TABLE public.vp_venue_screen ADD COLUMN IF NOT EXISTS events jsonb NOT NULL DEFAULT '[]'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vp_venue_screen_events_shape') THEN
    ALTER TABLE public.vp_venue_screen ADD CONSTRAINT vp_venue_screen_events_shape
      CHECK (jsonb_typeof(events) = 'array' AND jsonb_array_length(events) <= 60 AND char_length(events::text) <= 40000);
  END IF;
END $$;

-- THE SCREEN HISTORY SEES THE NEW COLUMN AS A CHANGE NOBODY MADE. Migration 114's nightly check compares each screen row
-- with its last recorded version, and every row now has an "events" key its last version lacks, so without this every
-- venue would be written up as 'drift' tonight. One 'baseline' row per venue, as 114 wrote, records the new shape here.
-- (Only for a venue whose latest record has no "events" key, so running this twice adds nothing.)
INSERT INTO public.vp_venue_screen_history (venue_id, slug, op, old_row, new_row, actor, via, db_session_user, db_role)
SELECT s.venue_id, s.slug, 'baseline', l.new_row, to_jsonb(s), jsonb_build_object('label', 'migration 177'), 'migration',
       session_user, nullif(current_setting('role', true), 'none')
  FROM public.vp_venue_screen s
  LEFT JOIN LATERAL (SELECT h.new_row FROM public.vp_venue_screen_history h WHERE h.venue_id = s.venue_id ORDER BY h.id DESC LIMIT 1) l ON true
 WHERE l.new_row IS NULL OR NOT (l.new_row ? 'events');

COMMENT ON COLUMN public.vp_venue_screen.events IS
  'The venue''s own What''s on nights (INBOX 110): [{id,title,date|day,until?,start?,line?,image_url?}]. Written only by the billing Worker (/account/whats-on-save, /account/whats-on-remove); read by GET /screen and /join/info.';

COMMIT;

-- Check after running (read-only):
--   select column_name, data_type, column_default from information_schema.columns
--    where table_name = 'vp_venue_screen' and column_name = 'events';
--   select conname from pg_constraint where conname = 'vp_venue_screen_events_shape';
--   select count(*) from public.vp_venue_screen where events <> '[]'::jsonb;   -- 0 straight after running
--   select count(*) from public.vp_venue_screen_history where actor->>'label' = 'migration 177';   -- one per screen row
--
-- Rollback (takes every venue's events with it; the history table keeps the old rows):
--   ALTER TABLE public.vp_venue_screen DROP CONSTRAINT IF EXISTS vp_venue_screen_events_shape;
--   ALTER TABLE public.vp_venue_screen DROP COLUMN IF EXISTS events;
