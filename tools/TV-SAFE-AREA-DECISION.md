# TV safe area: the rule (12 Nov 2026, Dean via main INBOX 321.2)

Dean's Kogan TV crops the edges of the picture (overscan): on 12 Nov the venue logo was cut off top left and the
bingo board cut off on the right (FINDINGS S1 and S15, live-play-12nov). Dean's decision, through main (INBOX 321.2):
a 5% safe default on every TV screen, from tonight.

## The rule

- On a TV, the venue logo or name, the boards, every word, the QR and the venueplay mark sit inside a **5% safe box**:
  54px top and bottom, 96px left and right at 1920x1080, scaling with the window (5vh and 5vw).
- **Sizes of content are measured against the safe box, not the window.** A size that was "X% of the width" is now
  X% of the safe box's width (the .tv wall), and a place that was "N px in from the corner" is N px in from the safe
  box's corner.
- **Photo slides and full-screen backgrounds stay full-bleed** (Dean, 9 Nov 2026: "Why would I want slides with a
  black border?"). A venue slide with a picture (.ad-photo on tv.html) reaches the window's edges.
- The logo and mark alignment rule still holds inside the safe box: the venue logo's left inset equals the venueplay
  mark's right inset (tools/tv-logo-align-in-chrome.test.py).

## Where it lives

- venueplay/app/vp-tvsafe.css: the wall (.tv) 5% in on tv.html and the trivia, musical bingo, raffle, members draw and
  Top Answers screens; the photo slide exception; the bingo reveal ball capped to the safe box's height share.
- venueplay/app/vp-venuelogo.js: VPVenueLogo.safeShare() is 0.05 on a page that loads the sheet, and the TV logo is
  sized (7% of the safe width) and placed (the safe box's corner plus the mark's 1.2%) against the safe box.
- tools/tv-safe-area-in-chrome.test.py: nothing painted in the 5% border for a whole demo night on every screen.

## Suites re-pinned to it

Suites that held older pinned layout decisions (logo in the window's corner, sizes as a share of the whole window)
were re-pinned to the safe box the same day. Every changed pin, old value, new value and why:
~/venue-enrich/reports/tv-safe-area-12nov/REPINS.md (PLEASE LOOK, for main). Each changed suite says so in its
header comment. No check that was not a layout pin was changed.
