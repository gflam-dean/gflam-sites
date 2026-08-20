# Audit-40 fix tracking (branch fix/audit-40, off origin/main 086e950)

Reconciled 2026-08-20 against CURRENT origin/main (audit was against old 42bfb56).

## Already fixed on main (verified in code, not comments) — do NOT re-fix
- #1 paid venue no login -> venue_no_login audit flag + self-heal provisioning (api-FULL 1901-1914). HQ *display* of the flag still to add.
- #2 half-built provisioning -> idempotent self-heal (api-FULL 1733-1900)
- #3 discount cap -> percent>100 rejected (api-FULL 1043). HQ confirm + remove button still to verify.
- #4 landline login -> mobile validated (api-FULL 976, 1773-1776)
- #6 host reload recovery trivia/musical/raffle -> /snapshot rebuild
- #12 lookalike token double-count -> device_id (mig 39)
- #15 grouped venue manager fields (hq 1630-1664)
- #21 raffle reload double-draw -> snapshot rebuilds drawn set
- #24 host error banner (gtoast)
- #27 trivia answer retry (verify)
- #30 members screen code persists (localStorage vpTvCodeMembers)
- #33 timezone from postcode (api-FULL 1827, 1963)

## STILL OPEN
### Batch A - safe screen/UI (low risk)
- [ ] #25 musical card font min + allow zoom (musical/play.html)
- [ ] #29 fullscreen button on trivia/musical/members/raffle screens
- [ ] #34 keep bingo fullscreen button visible during game (tv.html)
- [ ] #35 musical lobby QR label matches target
- [ ] #28 bingo win proof persists across reload (play.html)
- [ ] #37 offline win notify (play.html) - low
- [ ] #38 pairing mismatch on-screen message
- [ ] #26 screens offline/captive message
- [ ] #36 raffle results reload rebuild - low
- [ ] #5 (stop-gap) in-app links from picker to each format + note

### Batch B - game integrity (server + screen)
- [ ] #7 include pending claim in snapshot; host re-shows claim queue
- [ ] #8 bingo draw idempotency tag + resync button
- [ ] #9 screens rebuild GAME state on load/reconnect
- [ ] #22 members draw unresolved marker

### Batch C - SECURITY centerpiece (needs live test)
- [ ] #10/#18/#19 channel auth (ECDSA signing, mig 38) OR private channels

### Batch D - billing/ops
- [ ] #13 audit row on unmatched paid checkout
- [ ] #14 comp venue no-card status (don't eat founding slot)
- [ ] #16 suspend warns if game live now
- [ ] #20 rate-limit hard gate / louder
- [ ] #31 founding spot reservation (race)
- [ ] #32 staff invite email accurate/real
- [ ] #11 manager add-host / PIN flow (bigger)
- [ ] HQ: surface venue_no_login flag; discount remove button
- [ ] #39 overage peak calc (locate current view)
- [ ] #40 widen rejoin window - low

Notes: no game-flow live test possible without Dean's gear. Mark each fix with what he must click-test.
