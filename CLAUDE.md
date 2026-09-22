# Working in this repo

Two products. **VenuePlay** (live pub games: bingo, musical bingo, trivia, raffle,
members draw) and **PartyPlay** (a $50 consumer party product). A real venue runs
on VenuePlay, so a bad push is a bad night in a room full of people.

## How anything gets deployed

Commit, then `python3 tools/release.py`. It walks the six steps below in order and
stops at the first that is not true: clean tree and stamped Workers, push (the hook
gates it), deploy any Worker in the push and prove it by /health, wait until Pages
serves every changed file, the full gate, then verify-live --stamp if a screen file
changed. `--plan` says what it would do. The steps, for when one has to be done by hand:

    1. python3 tools/release-check.py      BEFORE the push
    2. push to main                        the site deploys itself; Workers do not
    3. run any new SQL migration FIRST, then deploy the Worker that needs it
    4. python3 tools/stamp-workers.py      then
       python3 tools/deploy-worker.py --live <worker> <file>
    5. python3 tools/release-check.py      AGAIN, after. This is the step that
                                           gets skipped and the one that catches
                                           a bad deploy. Since 22 Sep 2026 its
                                           "this release is live" line compares
                                           every served file the last commit
                                           changed against what Cloudflare is
                                           serving; red means Pages has not
                                           landed it yet (3 to 25 minutes), so
                                           run it again, or --wait
    6. if it touched a game, do the live list the gate prints. No tool here can
       open a browser or hear a pub
    6b. if it touched a SCREEN file (tv.html, any app/*/screen.html, the shared
        vp-* scripts), run python3 tools/verify-live.py --stamp and commit
        .verify-live.json. Until you do, the LIVE gate is red and it is right to
        be: nothing but a publican would otherwise find out what the screen
        paints
    7. python3 tools/prove-checks.py       before a release that matters, and
                                           after adding a check. The full run is
                                           about two hours now. --list is two
                                           seconds and tells you whether any
                                           mutation has rotted, which is the
                                           check most worth doing often

**"I deployed it" is not evidence.** /health answering with the right build is.

**Three things added on 21 and 22 Sep 2026, after an audit showed a careless edit
could ship with a green gate. They are there for whoever works here next, whatever
model that is, so read them before "fixing" a red line:**

- `deploy-worker.py --live` now RUNS the local gate itself and will not upload over
  a red one. The only failure it forgives is "is running the current code", which
  cannot go green until the upload has happened. `--emergency="why, in words"`
  skips it, for rolling back a bad deploy. If you are reaching for it to get past a
  red check, the check is the thing to read.
- `tools/check-suite-ledger.py` runs every suite and counts the checks that
  actually passed, against `tools/suite-counts.json`. A suite that was gutted,
  shrunk, deleted, or added without being wired in turns the gate red. If you
  removed checks ON PURPOSE, run it with `--update` and commit the ledger: that
  diff is the record that it was a decision. Never edit the ledger to make a red
  line go away.
- The gate's OWN labels are pinned in `tools/gate-labels.json` (section Z of a
  `--local` run). A check that disappears is red. A new check is red until it has
  a row in `tools/prove-checks.py` (a mutation, or a reason in UNPROVABLE) AND
  the ledger is rewritten with `python3 tools/release-check.py --local
  --update-labels` and committed. So: write the check, write its mutation, prove
  it (`python3 tools/prove-checks.py "<label>"`), then update the ledger. A
  green line nobody has ever seen red is not a check.
- `tools/check-worker-guards.py`: every `/host/` route must reach `verifyHostJwt`
  and a venue staff check, `Math.random` is banned in both Workers, and a read of a
  table that outgrows 1,000 rows must be one row, limited, or `sbGetAll`.
- When a Worker and an email template or page change TOGETHER, deploy the Worker
  first. The site publishes minutes later, and a page asking an old Worker for
  something new (or an email token the old Worker does not fill) reaches a customer.

Workers go up with `tools/deploy-worker.py`, over the Cloudflare API. It refuses a
file whose BUILD stamp does not match its contents, refuses a LIVE Worker without
`--live`, refuses the wrong file for a slot by name, keeps every existing variable
and binding, and then waits for that Worker's own /health to answer with the new
stamp before it says DEPLOYED.

This paragraph used to say Workers were deployed by pasting into the dashboard and
that there was no CLI deploy. That stopped being true on 10 September and the line
was still here on 16 September, by which point it had cost a round trip of offering
Dean a paste he did not need. Deploy `venueplay-api-FULL.js`, never a stub. Deploy
`DEPLOY-partyplay-api.js`, never the SOURCE.

**Do not `open -t` a Worker for someone to copy out of.** On 16 September a stray
`Y` was typed into the first line of venueplay-game.js while it sat open in
TextEdit, and Cloudflare rejected the upload with "ReferenceError: Y is not defined
at worker.js:1:1". Nothing reached a venue, because the stamp check and then
Cloudflare both refused it, but a file opened for a human to read can come back
changed.

`git push origin HEAD:main`. Say HEAD:main every time: this checkout has been both
a detached worktree and a plain `main` checkout at different times, and HEAD:main
pushes what is here whichever it is.

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
- **Never check a whole file for a word.** "Does pp_players appear, and does
  DELETE appear" was three of the privacy checks, and both words appear in
  unrelated places: the admin clear-players button is the very delete the code
  beside it says does NOT keep the promise. All three were green before the sweep
  existed. Scope it to the function, and assert the two things are in the same
  statement.
- **Never read a growing table without paging it.** PostgREST stops at 1000 rows
  on this project, silently: `vp_questions` holds 37,665 and a plain select
  returns 1,000. That had trivia drawing from the first 1,000 questions of a
  4,076-question set, a club over 1,000 members drawing from the first 1,000 so
  members 1001 and up could never win, the opt-in export handing a venue a short
  copy of its own customer list, and the members import failing outright. Use
  `sbGetAll` (game) or `vpaSelectAll` (billing), and give the query an `order` or
  the pages are not stable.
- **Never stop paging on a SHORT page.** Only on an EMPTY one. Supabase's own
  max-rows can sit below the page size you asked for, so every page is short, the
  loop stops after one, and the truncation is silent all over again. This is
  written on `sbGetAll` and I nearly shipped a second copy that got it wrong.
- **Never build a paging loop on a read that fails OPEN.** `sbGet` throws on a
  non-2xx, so `sbGetAll` is safe. `vpaSelect` returns `[]`, so a loop over it
  reads a FAILED page as "no more pages" and returns a short list with no error.
  A paging helper must do its own fetch and throw.
- **Never let a fake database ignore `limit` and `offset`.** Two suites did. One
  returned the same rows for every call, so a paged export reported 120 people
  where there were three. A stub that cannot model paging cannot model the bug
  the paging exists to fix. Offset first, then limit, the way PostgREST does it.
- **Never derive a test fixture from the current clock.** `sweep-sessions` picked
  its control timezone as (Brisbane's hour + 1), which IS 3am while Brisbane
  reads 2am, so the suite went red for one hour every night on the rule that
  stops a session billing every player who ever joined it. Pick a fixed value and
  assert the two fixtures actually differ.

## When a check looks blind, suspect your test first

Measured over ~22 rounds of `prove-checks.py`: **17 times the mutation was wrong,
three times the check was.** Wrong file, wrong string, a replacement that changed
nothing, a first-occurrence replace that landed nowhere near the call site, an
anchor inside a comment the check strips before looking, a change too small to
cross the threshold, and a suite that injects its own copy of the thing you
broke.

The three where the check was wrong are worth knowing by shape: a whole-file word
search that could not fail, a check that read a COMMENT as proof a script was
loaded, and a report derived from a list it could never appear in, so it would
have printed nothing for ever while looking busy.

## House rules for anything a person reads

No em dashes. Write **ACT**, never "the ACT". Never "roster" in copy; it is "your
members list" (table and route names keep it). A bingo or paid-ticket winner
claims from **the host**, never the bar. All four are enforced by the gate, in
`.js` as well as `.html`.

## Where things are

    tools/release-check.py            the gate. Run it for the count; a number
                                      written here was wrong within a week. --live
                                      is a SEPARATE set, not a superset: no label
                                      appears in both; tools/gate-labels.json pins
                                      the local ones
    tools/prove-checks.py             breaks each one on purpose (--list for the
                                      count, and it must say all apply). --live proves the
                                      handful of live checks whose subject is a
                                      file in this repo; the rest are questions
                                      about production and cannot be proven
                                      without breaking it. --list says in two
                                      seconds whether any mutation has stopped
                                      applying OR matches twice, which is as bad
    tools/stamp-workers.py            BUILD stamps; run before build-worker.py
    venueplay/                        the site, auto-deploys from main
    venueplay-backend/worker/         game + billing Workers, deployed by tools/deploy-worker.py
    venueplay-backend/supabase/       migrations, run by hand, numbered once each
    partyplay-backend/                same shape; build-worker.py writes DEPLOY-
    Dropbox/GFLAM/VenuePlay/Pubs list/enrichment/README.md
                                      the venue email pipeline, and its traps

Migrations: check every branch before claiming a number. `fix/audit-40` is
unmerged and its migrations ARE live.
