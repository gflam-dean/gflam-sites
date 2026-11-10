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
