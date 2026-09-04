# Working in this repo

Two products. **VenuePlay** (live pub games: bingo, musical bingo, trivia, raffle,
members draw) and **PartyPlay** (a $50 consumer party product). A real venue runs
on VenuePlay, so a bad push is a bad night in a room full of people.

## How anything gets deployed

    1. python3 tools/release-check.py      BEFORE the push
    2. push to main                        the site deploys itself; Workers do not
    3. run any new SQL migration FIRST, then paste the Worker that needs it
    4. paste each Worker into the Worker whose NAME matches the file
    5. python3 tools/release-check.py      AGAIN, after. This is the step that
                                           gets skipped and the one that catches
                                           a bad paste
    6. if it touched a game, do the live list the gate prints. No tool here can
       open a browser or hear a pub
    7. python3 tools/prove-checks.py       before a release that matters, and
                                           after adding a check

**"I pasted it" is not evidence.** /health answering with the right build is.

Workers are deployed by PASTING a file into the Cloudflare dashboard. There is no
CLI deploy. Paste `venueplay-api-FULL.js`, never a stub. Paste
`DEPLOY-partyplay-api.js`, never the SOURCE.

`git push origin HEAD:main`. This worktree is detached on purpose, because `main`
is checked out in another one, so plain `git push origin main` pushes a stale ref
and is rejected.

## The rule behind most of the faults in this codebase

**The same answer must exist in one place.** Nearly every real fault here was one
copy of something being fixed and the others left standing: `esc()` was eleven
different functions across 23 files, `drawQR` had two argument orders under one
name, `tvSend` had a try/catch in one of its four copies, and "see the host" was
corrected on the phone and left wrong on four other screens for a month.

`tools/release-check.py` now fails if `esc`, `cryptoInt` or `tvSend` differ
anywhere they appear. When you extract a shared function, the job is not done
until every caller loads it: the win fanfare was silent on all eight screens for
half a day because it moved into `/app/vp-celebrate.js` and not one page got the
script tag.

## Never do these

- **Never `ws.cell(row, col, value=None)` to clear a cell in openpyxl.** It cannot
  tell that from "no value argument passed" and returns the cell untouched. Use
  `ws.cell(row, col).value = None`. This silently did nothing to 69 rows while
  reporting success, because the note written beside them saved fine.
- **Never `pgrep -f "a\|b"`.** pgrep uses extended regex, so `\|` is a literal and
  matches nothing. A monitor built that way reported that every job had finished
  when none had.
- **Never trust a scan that returns zero** until you have run it against a case
  you KNOW is there. A detector for escaped values reaching HTML attributes
  reported none; there were four, and the pattern simply could not cross the
  JavaScript quote that always sits between them.
- **Never write a key-shaped literal** (`sk_live_...`) even as a decoy. GitHub push
  protection rejects the push, correctly. Assemble the shape at run time.
- **Never filter the venue list by the `Type` column.** It is a licence class, not
  a description: the Victorian register calls a gastropub a "Restaurant" and
  supplied 12,707 rows. Sort, never exclude.
- **Never match a word inside a domain with `word in domain`.** "pub" is inside
  publicsydney, "bar" inside barossa, "inn" inside innisfail. 21 correct addresses
  were flagged wrong that way.
- **Never assume a test tests anything.** Break the file it names and watch it
  fail. Ten PartyPlay suites read a copy of the project nobody ships and reported
  699 passing checks for weeks.

## When a check looks blind, suspect your test first

Measured over ~14 rounds of `prove-checks.py`: **10 times the mutation was wrong,
once the check was.** Wrong file, wrong string, a replacement that changed
nothing, a first-occurrence replace that landed nowhere near the call site.

## House rules for anything a person reads

No em dashes. Write **ACT**, never "the ACT". Never "roster" in copy; it is "your
members list" (table and route names keep it). A bingo or paid-ticket winner
claims from **the host**, never the bar. All four are enforced by the gate, in
`.js` as well as `.html`.

## Where things are

    tools/release-check.py            the gate, 52 local checks
    tools/prove-checks.py             breaks each check on purpose, 52 of 52
    tools/stamp-workers.py            BUILD stamps; run before build-worker.py
    venueplay/                        the site, auto-deploys from main
    venueplay-backend/worker/         game + billing Workers, paste-deployed
    venueplay-backend/supabase/       migrations, run by hand, numbered once each
    partyplay-backend/                same shape; build-worker.py writes DEPLOY-
    Dropbox/GFLAM/VenuePlay/Pubs list/enrichment/README.md
                                      the venue email pipeline, and its traps

Migrations: check every branch before claiming a number. `fix/audit-40` is
unmerged and its migrations ARE live.
