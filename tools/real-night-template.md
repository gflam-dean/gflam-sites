# Real night: BUILD8

Copy this file to ~/venue-enrich/reports/real-night/<first 8 characters of the build>.md, fill in every
line, and put the shots next to it (or under a folder beside it). tools/real-night-check.py reads it;
tools/release.py (with VP_REAL_NIGHT=1) will not call the release done until that check passes.

The rules (Dean, 12 Nov 2026, INBOX 295): all five games back to back, in this order, on The Mini Bar,
with the venueplay TV app on the Kogan (192.168.68.58, shots by sdb), and the SAME two phones in every
game. Every game gets a TV shot, a phone shot and a PASS or FAIL line with the name of the person who
played it. One FAIL anywhere and the release is not done: the fault goes back to the build session, is
fixed, and the night is played again on the new build.

Every line below in <angle brackets> must be replaced. A line still in angle brackets, or saying TODO,
fails the check. A shot that is a file path must exist (paths are read from this file's folder).

Build: <the full commit id release.py printed, or at least its first 8 characters>
Date: <YYYY-MM-DD HH:MM Brisbane>
Venue: The Mini Bar
TV: Kogan TV app 192.168.68.58
Phone A: <which phone, e.g. Dean's iPhone 15>
Phone B: <which phone, e.g. the test Android>
Settings: <the venue's own saved settings, as they are live (never fresh defaults)>

## Trivia
TV shot: <shots/trivia-tv.png>
Phone shot: <shots/trivia-phone-a.png>
Phones: A, B
Result: <PASS or FAIL> by <name>
Notes: <what was seen, or "none">

## Musical bingo
TV shot: <shots/musical-tv.png>
Phone shot: <shots/musical-phone-a.png>
Phones: A, B
Result: <PASS or FAIL> by <name>
Notes: <what was seen, or "none">

## Bingo
TV shot: <shots/bingo-tv.png>
Phone shot: <shots/bingo-phone-a.png>
Phones: A, B
Result: <PASS or FAIL> by <name>
Notes: <what was seen, or "none">

## Raffle
TV shot: <shots/raffle-tv.png>
Phone shot: <shots/raffle-phone-a.png>
Phones: A, B
Result: <PASS or FAIL> by <name>
Notes: <what was seen, or "none">

## Members draw
TV shot: <shots/members-tv.png>
Phone shot: <shots/members-phone-a.png>
Phones: A, B
Result: <PASS or FAIL> by <name>
Notes: <what was seen, or "none">
