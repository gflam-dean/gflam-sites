# The musical bingo phone card: the decided layout

Decided: Dean via main INBOX 323, 12 Nov 2026 (~15:00), from reports/phone-screens-12nov/musical-card.html.

OPTION C: all five columns on one screen, NO sideways swipe, on every phone.

- The card is never wider than the screen (WIDEN_MAX 1 in venueplay/app/musical/play.html).
- A card with one long word (Wonderwall, September, Thunderstruck) brings the WHOLE card down evenly, one size for every
  title and Free, down to 10px at the smallest (FIT_FLOOR 10: at 11px the test cards could not fit a 360 phone or a short
  phone with every title clear of its tick). Never a hyphen, never a split word, nothing cut.
- This supersedes Dean's 10 Nov sign-off rule "never under 15px" (builds INBOX 140) for this card only. The 10 Nov rules
  that still hold: one size for the whole card, no hyphen ever, nothing cut, the note slot never moves a square.
- TEXT SIZE PLUS/MINUS: shown in the slot under the card for the FIRST 30 SECONDS of the game (the clock starts the
  first time this phone shows the card in that game), then it hides INTO THE MENU (Text size, still there). The chosen
  size is kept for the night (localStorage "vp-mzoom", wrapped in try/catch). Musical card only.
  A bigger size also lifts the smallest size (up to 15px), so "+" still does something on a card with a long word:
  that one word is narrowed whole, never split.
- The page itself never scrolls (tools/game-screens-fit-in-chrome.test.py, 375x667 and 390x844).

Suites pinned to this decision: tools/musical-card-spacing-in-chrome.test.py, tools/ux-fixes-in-chrome.test.py,
tools/musical-newlook-in-chrome.test.py, tools/test-musical-card-10nov.js, tools/game-screens-fit-in-chrome.test.py.
Every changed pin: ~/venue-enrich/reports/phone-screens-12nov/REPINS2.md (PLEASE LOOK).
