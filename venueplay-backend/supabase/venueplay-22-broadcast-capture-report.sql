-- Migration 22: homes for broadcast-game opt-in captures and game figures.
--
-- Bingo runs entirely on the live link (no worker session), so player opt-ins and
-- end-of-game figures have nowhere to land. These two tables give them a home. BOTH are
-- keyed strictly by venue_id (a unique UUID), never by venue name, so two venues that
-- happen to share a name (e.g. a Grand Hotel in Cairns and one in Rockhampton) can never
-- see each other's data. The worker writes here with the service key; RLS is on with no
-- policies, so nothing is readable by the public/anon key.

-- ---- opt-in captures (one row per player join that provided details) --------------------
CREATE TABLE IF NOT EXISTS vp_captures (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id            uuid NOT NULL REFERENCES vp_venues(id) ON DELETE CASCADE,
  first_name          text,
  last_name           text,
  email               text,
  mobile              text,
  postcode            text,
  marketing_optin     boolean NOT NULL DEFAULT false,
  marketing_optin_at  timestamptz,
  source              text DEFAULT 'bingo',
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS vp_captures_venue_idx ON vp_captures (venue_id, created_at DESC);

-- ---- game reports (one row per completed game) ------------------------------------------
CREATE TABLE IF NOT EXISTS vp_game_reports (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id    uuid NOT NULL REFERENCES vp_venues(id) ON DELETE CASCADE,
  format      text NOT NULL DEFAULT 'bingo',
  players     int  NOT NULL DEFAULT 0,
  tickets     int  NOT NULL DEFAULT 0,
  prizes      jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{pattern, prize, winner_name, card_no}]
  started_at  timestamptz,
  ended_at    timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS vp_game_reports_venue_idx ON vp_game_reports (venue_id, created_at DESC);

-- Lock both to the service role (worker) only. RLS on, no policies = no public/anon reads.
ALTER TABLE vp_captures      ENABLE ROW LEVEL SECURITY;
ALTER TABLE vp_game_reports  ENABLE ROW LEVEL SECURITY;
