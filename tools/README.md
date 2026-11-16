# tools/

Repo tooling for tests, gates and releases. Plain Python 3.9 and jsc, no third party modules. Most tools here start Chrome or touch the live site: read a tool's docstring before running it, and do not run a tool with --help (several run the real thing).

## A test Chrome never reaches production (16 Nov 2026)

Every suite's Chrome is started by `verify-live.py` `Browser`, and that is where the block lives (`nolive.py`). Chrome is started with `--host-resolver-rules` sending venueplay.com.au, partyplay.com.au, getvenueplay/getpartyplay, the dean-tindale workers.dev account and the live database (and every subdomain of each) to a trap on 127.0.0.1. Nothing reaches the internet, from any tab, frame, worker, fetch, image or WebSocket. When the suite ends, each host that hit the trap is printed as `FAIL the test browser tried to reach production: <url> (<suite>)` and the exit code is 1. So a suite that leaned on live goes red: point it at its rig (`/__worker`, `/__game`, `/__api`), never at an allow.

| file | what it does |
|---|---|
| `nolive.py` | the host list, the trap, the URL record (Network events), the verdict at exit, `nolive.allow(url_prefix, reason)` for a suite that tries production ON PURPOSE (it is still stopped) |
| `nolive.test.py` | 22 checks, no Chrome: every host mapped and nothing else, the trap reads TLS and http, the FAIL line and exit 1, allow and its reason, Browser args, live=True, the refused bypasses (own resolver rules, a proxy) |
| `no-live-in-chrome.test.py` | a real Chrome tries production by fetch, WebSocket, image, script, beacon and a Worker: all fail, all reach the trap, a child run with no allow ends with the FAIL lines and exit 1 |

Only the deliberately live tools start `Browser(live=True)`: `verify-live.py` itself, `live-join-own-domain.py`, `measure-reconnect-in-chrome.py`. `nolive.test.py` fails if any other file does. A suite may not pass its own `--host-resolver-rules` or `--proxy-server`.

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

## The pre-push Chrome half from vp-tests-1, under a signed record (12 Nov 2026, INBOX 265.4; v2 the FAST GATE, 13 Nov 2026, INBOX 357A)

The pre-push hook runs about 118 Chrome suites one at a time on the Mac (2 h 12 min on 12 Nov, more since). The same suites run 4 at a time on the test server vp-tests-1 in about 50 min with the same results (~/venue-enrich/builds/TEST-SERVER.md). The hook runs `release-check.py --local --chrome-record`, and the gate leaves a Chrome suite out on the Mac ONLY when a record signed ON THIS MAC covers it. Design, threat model and proofs: ~/venue-enrich/reports/fast-gate-13nov/DESIGN.md.

| file | what it does |
|---|---|
| `gate-server.py run [-j N]` | the ONE path that writes a record: on a clean checkout, makes a fresh nonce and a manifest (git blob id of every file remote-run.sh sends), sends every Chrome suite the gate runs except signin-logo-in-chrome to vp-tests-1 (-j 4 by default; `-j 3` when the server is busy), no retries. The server hashes the files itself before and after and echoes the nonce. The Mac judges the server's RAW output with the tree's own passwording.verdict and check-suite-ledger.judge, and signs (HMAC-SHA256) only if the nonce, both server manifests and every suite (green, at or over its ledger count) check out and the checkout did not move. Writes ~/venue-enrich/reports/gate-records/<tree>.json |
| `gate-server.py check` | read only: would the gate accept a record for this tree, and why |
| `gate-server.py init-key` | once per Mac: makes ~/.gflam-gate.env (mode 600) holding GATE_RECORD_KEY. Never printed, never sent to the server, never committed. Deleting it stops every record being trusted |
| `gate-server.test.py` | no network, no Chrome, fake runner, throwaway keys: every bypass below is refused; runs the real hook |
| `hooks/pre-push` with `VP_HOOK_DRY_RUN=1` | prints what the gate would do with the Chrome half for this push (the record verdict), runs no gate, and ALWAYS refuses the push |

A record is accepted only when ALL of these hold, otherwise every Chrome suite runs on the Mac exactly as before:
- the key file exists, is mode 600 and yours; the record is signed with THAT key and not edited since;
- it is for this exact tree (`git rev-parse HEAD^{tree}` of a clean checkout), and the push sends this checkout's files (the hook compares each pushed sha's tree);
- it is under 2 hours old and not dated in the future;
- it covers every Chrome suite the gate would run (a new suite the server never ran refuses the whole record), each green on its ONE run the gate's way and at or over its count in suite-counts.json. No partial acceptance; a record carrying re-runs (v1) is refused.

signin-logo-in-chrome.test.py (flaky on Linux only) is never sent to the server and always runs on the Mac. `--skip-chrome` never combines with `--chrome-record`. Use: commit, `python3 tools/release.py` (step 0b makes the record; `VP_GATE_SERVER=0` turns it off), or by hand `python3 tools/gate-server.py run` then push. A failed or unreachable server run is never fatal: the Mac runs the Chrome suites.
