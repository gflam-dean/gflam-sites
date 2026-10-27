/* HOW WAS THAT? ------------------------------------------------------------

   Metering says how many people played. It has never said whether the night was
   any good, so nothing in the product can tell a venue why they should run
   another one, and nothing tells us which formats actually land.

   One tap, three options, from the two people who know: the room, and the host.

   DELIBERATELY HOLDS NO PERSONAL DATA. No name, no device id, no player id, no
   free text. A rating is not worth the consent conversation that any of those
   would start, and a free-text box on a channel anyone with the venue code can
   post to is a moderation problem waiting for a Saturday night. If this ever
   grows a comment field, it needs the same opt-in treatment as vp_captures.

   Run once. Idempotent.
   ------------------------------------------------------------------------- */

create table if not exists vp_game_feedback (
  id          uuid primary key default gen_random_uuid(),
  venue_id    uuid not null references vp_venues(id) on delete cascade,
  session_id  uuid references vp_sessions(id) on delete set null,
  game_id     uuid,
  format      text,
  -- who said it. The host's answer is worth keeping apart from the room's: the
  -- host knows whether the tech worked, the room knows whether it was fun.
  source      text not null check (source in ('player', 'host')),
  -- 3 loved it, 2 fine, 1 not for us. Three options because five is a survey.
  rating      smallint not null check (rating between 1 and 3),
  created_at  timestamptz not null default now()
);

create index if not exists vp_game_feedback_venue_idx   on vp_game_feedback (venue_id, created_at desc);
create index if not exists vp_game_feedback_session_idx on vp_game_feedback (session_id);

/* Same posture as every other table here: the public key can reach nothing.
   Everything goes through the Worker on the service role. */
alter table vp_game_feedback enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies
                 where tablename = 'vp_game_feedback' and policyname = 'vp_game_feedback_no_anon') then
    create policy vp_game_feedback_no_anon on vp_game_feedback
      for all to anon using (false) with check (false);
  end if;
end $$;

/* What a venue actually looks at: tonight in one line. */
create or replace view v_vp_feedback_by_session as
select
  f.session_id,
  f.venue_id,
  max(f.format)                                                       as format,
  count(*) filter (where f.source = 'player')                         as player_ratings,
  count(*) filter (where f.source = 'player' and f.rating = 3)        as player_loved,
  count(*) filter (where f.source = 'player' and f.rating = 1)        as player_disliked,
  round(100.0 * count(*) filter (where f.source = 'player' and f.rating >= 2)
        / nullif(count(*) filter (where f.source = 'player'), 0))     as player_positive_pct,
  max(f.rating) filter (where f.source = 'host')                      as host_rating,
  min(f.created_at)                                                   as first_at,
  max(f.created_at)                                                   as last_at
from vp_game_feedback f
group by f.session_id, f.venue_id;
