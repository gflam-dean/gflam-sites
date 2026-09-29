-- PARTYPLAY 14: THE FIFTY CAP HOLDS WHEN TWO GUESTS JOIN AT ONCE.
--
-- pp_enforce_player_cap (partyplay-01-core.sql) counts the party's players and refuses
-- the 51st. Two joins arriving together each counted 49 before either had inserted, so
-- both got in: the cap was 50 only for guests who joined one at a time. At a party a
-- room full of people scanning the same QR code is exactly when they do not.
--
-- A transaction advisory lock on the party makes the count-then-insert one at a time
-- PER PARTY (other parties are not held up), and it is released at commit. The cap
-- itself, the number and the message the Worker matches ("capped at") are unchanged:
-- this makes the existing rule true, it does not change the rule.
--
-- Audit, 27 Sep 2026. Run once on Sydney; safe to run again.
-- STATUS: RUN ON SYDNEY by Dean 28 Sep 2026; read back: the trigger takes the lock and the cap
-- is still 50. The race it closes was reproduced on live on 27 Sep: 49 players, two joins at once, 51.

create or replace function pp_enforce_player_cap() returns trigger
language plpgsql as $$
declare n integer;
begin
  perform pg_advisory_xact_lock(hashtext('pp_players_cap:' || new.licence_id::text));
  select count(*) into n from pp_players where licence_id = new.licence_id;
  if n >= 50 then
    raise exception 'PartyPlay is capped at 50 players' using errcode = 'check_violation';
  end if;
  return new;
end $$;
