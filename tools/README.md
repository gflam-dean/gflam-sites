# tools/

Repo tooling for tests, gates and releases. Plain Python 3.9 and jsc, no third party modules. Most tools here start Chrome or touch the live site: read a tool's docstring before running it, and do not run a tool with --help (several run the real thing).

## One queue, one order, a result cache (10 Nov 2026)

Test a release once, in order, and never re-run a suite on files it already passed on.

| file | what it does |
|---|---|
| `suite-queue.py` | picks the Chrome suites the changes reach (suite-impact.py logic, plus suites that read any changed file, plus the changes' own new suites), orders them by area, runs them one at a time under /tmp/vp-heavy.lock through gatelib.py, honours the HOLD file and `--stop-before HHMM` |
| `suite-cache.py` | result cache: after a clean pass records time + sha256 of every file the suite reads; `--list`, `--forget`, `--clear` |
| `suite-areas.json` | the area order (tv, console, phone, hq, emails, billing, other), the file-name words that place a suite, explicit suite overrides, and the shared files every suite counts as reading |
| `suite-queue.test.py` | 50 checks with fake suites: cache hit, invalidation, shared-file invalidation, failures never cached, area order, HOLD, stop-before, plan mode, lock use, suite-impact selection in a throwaway git repo. No Chrome, no real lock |

Usage (from the release tree; `<base>` is what it started from, e.g. release/10nov or main):

    python3 tools/suite-queue.py . <base> --plan            # print the queue, execute nothing
    python3 tools/suite-queue.py . <base>                   # run it
    python3 tools/suite-queue.py . <base> --stop-before 0430 --no-cache --all --stop-on-fail
    python3 tools/suite-queue.py . --list                   # the cache
    python3 tools/suite-cache.py --forget tools/x-in-chrome.test.py

Exit codes: 0 all green (run or cached), 1 a suite red, 3 stopped early by HOLD, the time cut-off or a refused lock, 2 usage.

The cache is keyed by suite path and holds a hash of file contents on disk, so uncommitted work counts and a result from one tree is reused on another only if every file the suite reads is byte-identical there. It lives in ~/venue-enrich/reports/suite-cache/cache.json (VP_SUITE_CACHE overrides; VP_HOLD overrides the HOLD path).

The whole-release order: quick checks per branch, merge, Chrome suites once on the merged tree (this queue), prove-checks for new or changed checks only, then the 05:00 gate runs release-check's standing live checks. See ~/venue-enrich/builds/ROUTINE.md.

## The pre-push Chrome half from vp-tests-1, under a signed record (12 Nov 2026, INBOX 265.4)

The pre-push hook ran 98 Chrome suites one at a time on the Mac: 2 h 12 min. The same suites run 4 at a time on the test server vp-tests-1 in about 31 min with the same results (~/venue-enrich/builds/TEST-SERVER.md). The hook now runs `release-check.py --local --chrome-record`, and the gate leaves a Chrome suite out on the Mac ONLY when a signed record from the server covers it.

| file | what it does |
|---|---|
| `gate-server.py run` | the ONE path that writes a record: on a clean checkout, sends every Chrome suite the gate runs (found the gate's way: tools/*.test.py + gatelib.uses_chrome), except signin-logo-in-chrome, to vp-tests-1 at -j 4 through ~/venue-enrich/builds/tools-remote/remote-run.sh; a suite red at -j 4 is re-run ALONE 3 times and counts only if all 3 are green; signs the result with HMAC-SHA256 and writes ~/venue-enrich/reports/gate-records/<tree>.json. Refuses to sign if the checkout is dirty, changes during the run, or anything stays red |
| `gate-server.py check` | read only: would the gate accept a record for this tree, and why |
| `gate-server.py init-key` | once per Mac: makes ~/.gflam-gate.env (mode 600) holding GATE_RECORD_KEY. The value is never printed, never sent to the server, never committed. Deleting the file stops every record being trusted |
| `gate-server.test.py` | 76 checks, no network, no Chrome, fake runner, throwaway keys: every bypass below is refused |

A record is accepted only when ALL of these hold, otherwise every Chrome suite runs on the Mac exactly as before (nothing is ever weaker than the old gate):
- the key file exists, is mode 600 and owned by you; the record is signed with THAT key and not edited since (a changed count, suite list, time or tree breaks the signature);
- it is for this exact tree (`git rev-parse HEAD^{tree}` of a clean checkout: any file change is another tree; a message-only amend is the same files and still matches);
- it is under 24 hours old and not dated in the future;
- it covers every Chrome suite the gate would run (a new suite the server never ran refuses the whole record), each green the gate's way (exit 0, last line `ALL n CHECKS PASSED` or `n of n checks passed`, no FAIL line) and at or over its count in suite-counts.json (lines where the ledger counts lines). No partial acceptance: one bad suite and the record covers none.

signin-logo-in-chrome.test.py (flaky on Linux only) is never sent to the server and always runs on the Mac under the usual one-retry rule. `--skip-chrome` is unchanged and never combines with `--chrome-record`. The suite ledger (D30) leaves out only the Chrome suites the record covers (`--judged-elsewhere`), because gate-server already held them to the same ledger.

Use: commit, `python3 tools/gate-server.py run` (about 35 min), then push (or push with `VP_GATE_SERVER=1` and the hook runs it first; a failed server run is never fatal, the Mac simply runs the Chrome suites). The key is the trust: anyone holding it can sign anything, so it stays on this Mac. No environment variable moves the key, the records or the runner.
