# PartyPlay backend

Everything PartyPlay is made of except the pages themselves. The site lives in
`../partyplay/` and is what Cloudflare Pages publishes; **this folder is not
served**, which is why the Worker source can safely live here.

Until 28 August 2026 none of this was in version control at all. It existed on
one laptop, in `~/partyplay`, with no history and no backup. A file was corrupted
once during a bad edit and the only reason it was recoverable was that a built
copy happened to be sitting next to it. That is not a system, so it is here now.

## What is what

| | |
|---|---|
| `worker/SOURCE-do-not-paste-partyplay-api.js` | The Worker. Edit THIS one. |
| `worker/DEPLOY-partyplay-api.js` | Built from the source with the licence library inlined, stamped with a time and a fingerprint. This is the file that gets pasted into Cloudflare. Never edit it. |
| `worker/*.test.js` | Runs under JavaScriptCore, no node needed. |
| `lib/` | Shared between the Worker and the browser: licence windows, bingo tickets, quiz scoring, photo and video handling. Plus their tests. |
| `supabase/` | Migrations, numbered. Run them in order. |
| `tools/build-worker.py` | Makes the DEPLOY file. Refuses to write anything that does not parse or where the licence library did not inline. |
| `check-defs.py` | Fails on a call to a function that does not exist. |
| `_edit.py` | Guarded string edits. A raw slice with the markers the wrong way round once returned "" and `s.replace("", new)` inserted a block between every character of the file. |
| `smoke-test.sh` | Unit tests, then probes the live site and Worker. |

## Before you change anything

    ./smoke-test.sh

## After a deploy

    python3 ../tools/release-check.py --wait

That one covers both products and says plainly what it cannot check, which is
anything that only happens when a game is actually running.

## Deploying the Worker

1. `python3 tools/build-worker.py`
2. Paste `worker/DEPLOY-partyplay-api.js` into Cloudflare, the whole file.
3. Check the time at the top of the pasted file matches what the build printed.
   If it does not, the editor had an old copy open.

Secrets never go in any file here. See `worker/SECRETS.md` for the list and where
each one comes from.
