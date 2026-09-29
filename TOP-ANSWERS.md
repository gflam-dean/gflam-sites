# Top Answers: in progress, switched off

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

## Still to build, in order
1. Host console (`app/topanswers/host.html`): pick a board, open it, show typed answers, reveal
   the board, award points to teams, next board.
2. TV (`app/topanswers/screen.html`): the board of hidden answers flipping as they are found, team
   scores, the same lobby and join panel as trivia.
3. Phone: type an answer; teams chosen at join.
4. Game Worker + billing: players must count exactly as they do for trivia (join + played), so
   overage and the free month behave the same. This is the part to get right before any venue.
5. Later (Dean's option c): venues vote on poll questions and real answers replace ours.
