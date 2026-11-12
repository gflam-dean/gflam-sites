# The musical bingo phone card: the decided layout

Decided: Dean via main INBOX 323, 12 Nov 2026 (~15:00), from reports/phone-screens-12nov/musical-card.html.

OPTION C: all five columns on one screen, NO sideways swipe, on every phone.

- The card is never wider than the screen (WIDEN_MAX 1 in venueplay/app/musical/play.html).
- FIT PER SQUARE (Dean via main INBOX 337, 12 Nov ~20:35: "yes C, but the text a bit BIGGER"): every square takes the
  biggest size that fits ITS OWN title (20px at most), broken only between words. Only a square that cannot fit (one long
  word such as Wonderwall or Thunderstruck, or a very long title) goes smaller, down to 10px (FIT_FLOOR 10); never the
  whole card. Free is drawn at the middle size of the card's titles. A square tries the 14px tick, then the 10px tick at
  the same size, before its title goes smaller. Never a hyphen, never a split word, nothing cut, titles centred.
  (Before 337 the whole card went down evenly, one size for every title; that is superseded.)
- This supersedes Dean's 10 Nov sign-off rules "never under 15px" and "one size for the whole card" (builds INBOX 140)
  for this card only. The 10 Nov rules that still hold: no hyphen ever, nothing cut, the note slot never moves a square.
- TEXT SIZE PLUS/MINUS: shown in the slot under the card for the FIRST 30 SECONDS of the game (the clock starts the
  first time this phone shows the card in that game), then it hides INTO THE MENU (Text size, still there). The chosen
  size is kept for the night (localStorage "vp-mzoom", wrapped in try/catch). Musical card only.
  A bigger size also lifts the smallest size (up to 15px), so "+" still does something on a card with a long word:
  that one word is narrowed whole, never split.
- The page itself never scrolls (tools/game-screens-fit-in-chrome.test.py, 375x667 and 390x844).

Suites pinned to this decision: tools/musical-card-spacing-in-chrome.test.py, tools/ux-fixes-in-chrome.test.py,
tools/musical-newlook-in-chrome.test.py, tools/test-musical-card-10nov.js, tools/game-screens-fit-in-chrome.test.py.
Every changed pin: ~/venue-enrich/reports/phone-screens-12nov/REPINS2.md and REPINS3.md (per square, INBOX 337) (PLEASE LOOK).
