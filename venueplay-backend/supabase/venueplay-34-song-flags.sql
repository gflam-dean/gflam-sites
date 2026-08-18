-- VenuePlay migration 34: a host flags a song that did not work, and we review it.
--
-- Musical bingo only works if the room can sing along. The first live night turned up songs
-- nobody knew, and clips that were the wrong recording entirely (a title-matching bug, fixed
-- separately, which had 10.9% of the library playing another artist's song). The code fix stops
-- new mismatches; it cannot tell us which songs are simply duds in a real room.
--
-- Only the host can hear that, on the night. So they get one tap: "this song did not work".
--
-- Same shape as the trivia question flags in migration 32, and for the same reasons:
--   ONE HOST MEANS NOTHING. A wrong crowd, a bad night, a room that just did not bite. So a
--   single flag never removes anything. Three DIFFERENT venues means the song is the problem.
--   THE KEY IS THE SONG, NOT A ROW ID. Songs are copied into each game's playlist with fresh
--   ids, so flagging by id would only flag one venue's private copy while the library original
--   kept going out to everybody. The key is artist + title, normalised.
--
-- Unlike a trivia question, a song cannot be rewritten. At three flags it is RETIRED: pulled
-- from the library so it stops being dealt, and listed in the weekly review so a human can
-- confirm it should go for good or put it back.
--
-- RUN THIS IN TWO PARTS. The Supabase SQL editor splits on semicolons and mishandles dollar
-- quoting, so the function is tagged separately and is meant to be run on its own.
-- Safe to run more than once.

-- ============================ PART 1 ============================
CREATE TABLE IF NOT EXISTS vp_song_flags (
  skey       text NOT NULL,                        -- normalised "artist|title"
  venue_id   uuid NOT NULL,
  reason     text NOT NULL DEFAULT 'didnt_work',   -- didnt_work | wrong_track | unknown_song
  title      text,                                 -- kept so the review queue reads properly
  artist     text,
  note       text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (skey, venue_id)                     -- one vote per venue, so no venue acts alone
);

CREATE INDEX IF NOT EXISTS vp_song_flags_skey_idx ON vp_song_flags (skey);

ALTER TABLE vp_song_flags ENABLE ROW LEVEL SECURITY;

-- Only the Worker (service_role) touches this. No venue reads another venue's flags, and the
-- browser never reads the table at all: the host posts through the Worker, which is staff-gated.
DROP POLICY IF EXISTS vp_song_flags_no_public ON vp_song_flags;

-- How many separate venues have flagged a song, and which songs have reached the threshold.
CREATE OR REPLACE VIEW v_vp_song_flag_counts AS
  SELECT skey,
         min(title)  AS title,
         min(artist) AS artist,
         count(DISTINCT venue_id) AS venues,
         max(created_at) AS last_flagged
    FROM vp_song_flags
   GROUP BY skey;

-- ============================ PART 2 ============================
-- Run this block on its own.
CREATE OR REPLACE FUNCTION vp_songs_to_retire(min_venues integer DEFAULT 3)
RETURNS TABLE (skey text, title text, artist text, venues bigint, last_flagged timestamptz)
LANGUAGE sql
STABLE
AS $fn$
  SELECT skey, title, artist, venues, last_flagged
    FROM v_vp_song_flag_counts
   WHERE venues >= min_venues
   ORDER BY venues DESC, last_flagged DESC
$fn$
