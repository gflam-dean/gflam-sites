# Morning, 18 September

**The code fixes in section 2 are committed, deployed and live.** Both Workers were proved
by `/health` before you went to bed. Nothing in section 2 is waiting on anything.

**This FILE is not committed, and neither are the other documents I edited after you went to
bed.** Once you were asleep I stopped running anything that could put a prompt on your
screen, which meant no git either. So section 4 is written out ready and marked NOT RUN
rather than done.

**Documentation I edited after you went to bed, all uncommitted, all safe to commit as is.**
No gate check reads any of them, and the gate was 213 green before and after:

    CLAUDE.md                        five new "Never do these" from last night's bugs,
                                     and its check counts were wrong: it said 199 local
                                     and "305 with --live", when --live is a SEPARATE 126
    DEAN-MORNING-18-SEP.md           this file
    DEAN-OVERNIGHT-18-SEP.md         said "eleven things" above a list of eight
    DEAN-TODO-17-SEP.md              a line saying which list is which

Also outside the repo, so nothing to commit: the Supabase skill still described the signup
views as front-end readable after I locked them, which would have had a future session wire
a page to a view that refuses it. And the release-check memory still said Workers get
PASTED, which stopped being true on 10 September and is the exact stale line that already
cost a round trip once.

---

## 1. YOUR ONE JOB. Two minutes, and the live gate is red until it is done.

**www.partyplay.com.au answers 200 and redirects nowhere, so PartyPlay is two addresses.**
www.venueplay.com.au redirects. www.getpartyplay.com.au redirects. This one domain never
got the rule.

play.html keeps the guest's identity in `localStorage`, which is per address. A guest who
lands on www and later on the plain name is a new person to the browser: asked for a
nickname again, written to the database a second time, and that second row counts against
the **fifty player cap**, which the database enforces and will not argue about. Their bingo
marks go too. A thirty person party could be refused at fifty.

**Cloudflare -> the partyplay.com.au zone -> Rules -> Redirect Rules.** Hostname equals
`www.partyplay.com.au`, dynamic 301 to
`concat("https://partyplay.com.au", http.request.uri.path)`, preserve query string. Exactly
what you already did for the other two. The gate goes green by itself once it is in.

Your other jobs are unchanged and still in `DEAN-TODO-17-SEP.md`.

---

## 2. What shipped overnight, all deployed and proved

**Four real bugs, all the same cause: PostgREST returns at most 1000 rows, silently.**

  - **Trivia was drawing from the first 1,000 questions of a 4,076-question set.** Four
    library sets are past the ceiling. `qtotal` on the phones said 1000, three quarters of
    Australiana could never be asked at any venue, and the no-repeat memory was working
    over a quarter of the pool. **This one was live and affecting real games.**
  - **The members draw pool.** A club over 1,000 members drew from the first 1,000 only.
    Members 1001 and up could never win.
  - **The members import.** Past 1,000 members the whole import failed, including the one
    new member being added, with a message about something already starting.
  - **The opt-in export** returned a short file with no warning.

Nobody had hit the members ones: the biggest list today is 136. They were all waiting for
the first big RSL, which is exactly who this is for.

**And a test that went red for an hour every night.** `sweep-sessions` picked its control
timezone as (Brisbane's hour + 1), which IS 3am while Brisbane reads 2am, so both test
venues sat in the same zone. Every night, 2am to 3am, on the rule that stops a session
nobody closed from billing every player who ever joined it.

Everything else from the night is in `DEAN-OVERNIGHT-18-SEP.md`. Read its findings, but take
the NUMBERS from this file: it was written at about one in the morning and says 210 local and
126 live, which was true then. Two status files disagreeing is the fault I spent yesterday
evening removing, so: **this file is the current one.**

---

## 3. Run these when you are up. Nothing here is urgent.

    cd ~/gflam-ai-team/sites
    python3 tools/release-check.py --local     # expect 213, green
    python3 tools/release-check.py --live      # expect one red until the redirect is in

**The overnight sweep finished. You do not need to run it.**

    263 proven, 0 BLIND, 0 mutation(s) that no longer apply
    212 of the 212 checks the gate runs have a mutation (100%)

Every local gate check has now been broken on purpose and watched go red, across the whole
gate in one run rather than a stale number plus a pile of individual proofs. 212 in a scratch
copy, 213 in the real repo: the difference is the browser-stamp check, which works off git
history and cannot run in a copy without `.git`, and which was seen to fail for real on the
17th instead.

**ONE THING TO CONFIRM IN A SECOND.** The `git push` inside that same background job failed
with "failed to push some refs". The commit it was pushing (the two re-aimed mutations) went
in locally, and the later pushes that night reported ranges starting from the old remote head
(`9ef9e36..492529d`, then `..3f8d351`), so git will have carried it along with them. That
means nothing is lost. But I could not run git to check, so:

    git log origin/main --oneline -1
    git status --short

Expect the newest commit to be the trivia one and the only modified files to be the
documentation I edited after you went to bed.

---

## 4. Written out, NOT RUN, for when you are about

### FIRST: a defect in what I shipped last night. Mine, found by re-reading it.

`vpaSelectAll` in the billing Worker pages the opt-in export. It is built on `vpaSelect`,
**which returns an empty array on ANY non-2xx response.** So a page that FAILS reads as "no
more pages", the loop stops, and the venue gets a short file with no warning. That is the
exact fault I spent the night removing, reintroduced by building on something that fails
open.

The game Worker's `sbGetAll` does not have this: its `sbGet` throws on a bad response, so it
fails closed. Only billing is affected.

It only bites on a transient Supabase error mid-export, and before last night the same
failure gave an EMPTY file, which is at least noticeable. A short one is not. Worth fixing
first thing.

**The fix, not applied, because applying it means deploying and I was not going to do that
while you were asleep.** In `venueplay-backend/worker/venueplay-api-FULL.js`, replace the
body of `vpaSelectAll` so it does its own fetch and throws rather than calling `vpaSelect`:

    async function vpaSelectAll(env, table, query, pageSize) {
      const size = pageSize || 1000;
      let out = [], offset = 0;
      for (let page = 0; page < 40; page++) {
        const res = await fetch(env.SUPABASE_URL + '/rest/v1/' + table + '?' + query +
          '&limit=' + size + '&offset=' + offset, { headers: vpaHeaders(env) });
        // FAIL CLOSED. vpaSelect returns [] on any non-2xx, which a paging loop reads as
        // "no more pages", so a blip halfway through becomes a short file nobody questions.
        if (!res.ok) throw new Error('read ' + table + ' page ' + page + ': ' + res.status);
        const rows = await res.json();
        if (!Array.isArray(rows) || rows.length === 0) break;
        out = out.concat(rows);
        offset += rows.length;
      }
      return out;
    }

While you are in there, one small hardening in the same function's caller: the export pages
with `order=opted_in_at.desc`, and that is not unique. Offset paging over a non-unique order
can in principle skip a row at a page boundary when timestamps tie. Adding `,email.asc` to
the order makes ties stable. It needs a venue with over a thousand opt-ins to matter, and
there are none.

Then this order. I first wrote it short and left the **push** out, and a Worker deployed from
a file that is not on main is a build nobody can find again:

    python3 tools/stamp-workers.py            # FIRST, or the next step refuses the file
    python3 tools/release-check.py --local     # expect 213 green
    python3 tools/deploy-worker.py --live venueplay-api venueplay-backend/worker/venueplay-api-FULL.js
    git add -A && git commit && git push origin HEAD:main
    python3 tools/release-check.py --local     # again. This is the step that gets skipped

Stamp before the gate, not after: `deploy-worker.py` refuses a file whose stamp does not
match its own contents, and the gate's fingerprint check goes red the moment they disagree.
Doing it in this order means one commit that already carries the right stamp, which is how I
did the four deploys last night.

No migration is involved, so nothing has to run in Supabase first.

### SECOND, and smaller: I used the heavy tool where a better one already existed.

`retagSetCount` in the game Worker now pages every question in a set just to count them. On
Australiana that is five round trips to learn a number. **`sbCount` already exists** in the
same file: a HEAD with `Prefer: count=exact`, one round trip, no rows, and it cannot
truncate because it never reads any. The one-line version is:

    async function retagSetCount(env, setId) {
      const n = await sbCount(env, 'vp_questions', 'set_id=eq.' + enc(setId) + '&select=seq');
      await sbPatch(env, 'vp_question_sets', 'id=eq.' + enc(setId), { question_count: n });
    }

What I shipped is correct, just wasteful. Same mistake in kind as nearly writing a second
`sbGetAll` last night: reaching for a new tool without checking what the file already had.

**This one is the GAME Worker, not billing**, so the deploy line differs from the block
above:

    python3 tools/deploy-worker.py --live venueplay-game venueplay-backend/worker/venueplay-game.js

If you do both jobs, stamp once, gate once, deploy BOTH Workers, then commit and gate again.

### THIRD: worth one look, almost certainly nothing.

The trivia round's question count defaults to the WHOLE set when the host console does not
send a number. That is not new, but the pool fix makes it bigger: it would now be 4,076 on
Australiana where it used to be capped at 1,000, and every one of those gets written into
the twelve-month "already asked" memory for that venue.

It is almost certainly unreachable, because a round defaulting to a thousand questions would
have put "1 of 1000" on a venue's television the first night trivia ran, and nobody has ever
seen that. So the console clearly always sends a count. Worth confirming once, and if it is
ever not sent, a sane default in the Worker is a two-line change.

### THEN: the remaining unpaged reads. These are correct today and wrong later, purely a matter
of scale. None is urgent and none should be done while you are asleep, because both
Workers would need deploying.

  - both Workers list **every venue** unpaged. Fine at 25. Wrong past 1,000, which is the
    growth plan.
  - billing reads **vp_sessions** and **vp_game_reports** across all venues over a date
    window, unpaged. Fine at 40 rows. Wrong at a few hundred venues playing nightly.

The fix is the same each time and the helpers already exist: `sbGetAll` in the game Worker,
`vpaSelectAll` in billing. Both advance by what came back and stop only on an EMPTY page,
never a short one, because Supabase's own limit can sit below the page size you ask for.

**Do FIRST before leaning on `vpaSelectAll` for anything new.** As shipped it treats a
FAILED page as an empty one, so every new caller inherits the silent truncation until that
is fixed. `sbGetAll` is already safe and needs nothing.

**The members import sends every new member in ONE request.** The dedupe is correct now, so
the 409 storm is gone, but a first import of three thousand members is still a single POST
of three thousand rows. It will probably work. If it ever does not, the host sees a generic
error and has no way to tell which half landed. Chunking it in batches of five hundred is
the fix, and it wants testing against a real big list rather than a guess.

**Also still open, and deliberately not touched overnight:**

  - seventeen places in the billing Worker read the request body with no guard, so a
    malformed request answers "Something went wrong on our end" instead of saying it was
    malformed. Real browsers send valid JSON, so it is a confusing message for a broken
    client rather than a fault a venue would see.
  - the admin dashboard lists at most 100 expiring licences while the tile above shows the
    true count. Ten licences exist, so it is a long way off.
