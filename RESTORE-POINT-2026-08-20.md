# VenuePlay — restore point, end of 20 Aug 2026

Everything below is on GitHub: `gflam-dean/gflam-sites`, branches **`main`** (deployed site + migrations) and **`fix/audit-40`** (`6b3d146` — full working set incl. the two paste-deployed Workers).

## After a machine reset, to get back to work
```
git clone https://github.com/gflam-dean/gflam-sites.git
cd gflam-sites && git checkout fix/audit-40
```
The Workers live at `venueplay-backend/worker/venueplay-{api-FULL,game}.js`. Migrations at `venueplay-backend/supabase/venueplay-*.sql`. The site is `venueplay/`.

## What is LIVE (already deployed to main / auto-served)
All of today's SITE work is live: broadcast-signing on all game screens (enforce OFF), billing this-month/next-month + card-tile removed + edit host/manager venues + click-to-upload, club/pub segmented control, paid-bingo highlight (no auto-mark), big YOU WON + confetti/fanfare, bingo win survives reload (#28) + pending-claim recovery (#7), raffle weekly-template + bigger "Get your tickets" + prize list + results rebuild (#36), trivia settings memory + picture-round PHOTO UPLOAD, venue logo on player phones, TV shows venue NAME, HQ suspend-live warning + comp-venue checkbox + "Hide from homepage" button + discount group-confirm + workerPost full-error fix, bigger homepage logos. Plus all four audit fixes (Keep-this-venue rollback, signing enforce-safety x3, exit-send regression, raffle race, image-upload guards).

## OUTSTANDING ACTIONS (Dean)
1. **Re-paste BOTH Workers** at SHA `6b3d146` (worker content = same as 6e2a22b), raw URL pinned to the SHA (never /main/, it's CDN-cached):
   - `venueplay-backend/worker/venueplay-api-FULL.js` -> the **venueplay-api** worker
   - `venueplay-backend/worker/venueplay-game.js` -> the **venueplay-game** worker
2. **Run migration 54** (`venueplay-54-hide-from-trusted.sql`) — adds hide_from_trusted + updates the marquee view. (49–53 already run.)
3. **Bulk-hide the 12 test/friend venues from the homepage** (after 54):
   `update vp_venues set hide_from_trusted=true where slug in ('connie-is-a-cuntry-club','gflam-group-pty-ltd','hoads-haus-of-fun','karina-bay-surf-club','lizard-lounge-sports-bar','praze-the-roof-sports-bar','the-average-joe','the-gothic-arms-hotel','the-indypendent-hotel','the-jolly-jess','the-mini-bar','tugun-bowls');`
4. **Make friend venues free:** apply a **100% percent discount, forever** in HQ (Billing -> venue -> Details) to each multi-venue-on-your-card account. The group-confirm prompt now works after a HARD-REFRESH of HQ.
5. **Enforce flip (security, parked for the morning):** hard-refresh Karina Bay's screens, then
   `update vp_venue_settings set sign_enforce=true where venue_id='44860d98-abe9-4cdb-a9a8-e71c4926a28e';`
   run a test game, roll back with `=false` if anything drops. Rollback + reload if wrong. Signing is enforce-safe (audited): a screen can't blank, clock skew tolerated, key-fetch retries.
6. **Hard-refresh HQ** to pick up the discount-confirm fix + the Hide-from-homepage button.

## Notes
- Karina Bay signing key is minted; enforce is FALSE everywhere.
- The audit (4 agents) found 0 Critical, 2 High (both fixed), several mediums (fixed). Full detail in memory [[venueplay-audit-40-build]].
- Stale main working copy is 400+ behind origin — always work from origin/fix/audit-40, never that copy. See [[venueplay-stale-working-copy]].
