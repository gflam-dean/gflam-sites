# Punters Reckon (working name; was "Top Answers"): in progress, switched off

A new team game (Family Feud style, under our own name, since "Survey Says" is a format someone
owns). Built on the branch `feature/top-answers`. Nothing here is live and no venue can reach it.

## Done (29 Sep 2026)
- `venueplay/app/topanswers/ta-match.js`: decides whether what a phone typed is an answer on the
  board. Forgives capitals, "a/the", plurals, and one slipped key on words of 5+ letters. Refuses short
  words ("car" is not "bar") and refuses to guess when two answers are equally close.
- `venueplay/app/topanswers/ta-boards.js`: 30 starter boards, Australian and pub-flavoured, each
  scored to 100. Written by us and shown as "top answers", never as a survey.
- `tools/test-ta-match.js`: 15 checks, incl. every alias on every board scoring its own answer and
  no two answers sharing a form. 2 break-tests proven.

- `venueplay/app/topanswers/screen.html`: the TV board. Flips answers as found, big red X for a strike,
  team scores, the team on turn in gold, greyed answers nobody got at the end. `?demo=1` plays a scripted
  round. Seen in a real browser at 1600x960. `tools/test-ta-screen.js` (10 checks, 2 mutations).
- RULE THE CONSOLE MUST KEEP: an answer's text is only broadcast when it is FOUND (ta_reveal carries it),
  and the unfound ones only at the end (ta_showall). Every phone hears the TV's channel.

## Decisions for Dean
- The name: Dean wants "a better ring to it". Offered 29 Sep: Punters Reckon (my pick), Mob Rules, Crowd Says, Great Minds.
- Pricing: DECIDED 29 Sep 2026 (Dean: "No it doesnt count"): a night of this game does NOT count as the
  venue's weekly trivia night. Players still count for billing like any game (join + played).
- Where it lives: my recommendation is a round type INSIDE the trivia console, so it inherits trivia's
  reconnect, signing, session and billing behaviour instead of becoming a fourth copy of all that.

## Built 29 Sep 2026 (afternoon), as a round type INSIDE trivia
Dean said keep going without questions, so I used my own recommendations: the name Punters Reckon
(lives only in PRGame.NAME), and room play: every phone gets 3 typed guesses a board, a match scores
that answer's points, the TV flips an answer the first time anyone finds it, scores go to the leaderboard.
- `pr-game.js`: the referee (console only). `pr-board.js`: the TV board, one copy, mounted by the trivia
  TV and the demo page. `pr-phone.js`: the phone's part, mounted by the trivia phone.
- Trivia console: a "Round type" choice that appears ONLY with ?pr=1 (switched off for venues). Start,
  put up a board (15 to 180 s), live guesses for the host (who alone sees the answers), end board (the
  rest turn over, the leaderboard follows 7 s later), Finish. Scores survive a console reload.
- Phones mark themselves played with /player/alive (billing like any game). Not the weekly trivia night.
- Seen in a real browser: TV board (1600x960) and the phone (typed guesses, Enter and Go both work).
- Tests: test-pr-game.js (16), test-pr-round.js (15: two phones + TV on one channel, nothing leaks),
  test-ta-screen.js (9), test-ta-match.js (15). Mutations proven for each.

## Still to do before a venue sees it
1. Play a whole night on the live console with ?pr=1 at a test venue (two phones + TV).
2. The unified /tv routing and the see-a-night demo, if Dean wants it on the sales page.
3. Real venue votes to replace our boards (option c).

## Original build list (kept for the record)
1. Host console (`app/topanswers/host.html`): pick a board, open it, show typed answers, reveal
   the board, award points to teams, next board.
2. TV (`app/topanswers/screen.html`): the board of hidden answers flipping as they are found, team
   scores, the same lobby and join panel as trivia.
3. Phone: type an answer; teams chosen at join.
4. Game Worker + billing: players must count exactly as they do for trivia (join + played), so
   overage and the free month behave the same. This is the part to get right before any venue.
5. Later (Dean's option c): venues vote on poll questions and real answers replace ours.
