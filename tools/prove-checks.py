#!/usr/bin/env python3
"""Prove the checks can fail.

A check that cannot fail is worse than no check: the green line says the job was
done. This has been the single most common shape of my own mistakes, and it does
not show up in a normal run, because a normal run is all green either way.

  release-check.py asks "is the code right?"
  this asks         "would we know if it wasn't?"

HOW. The repo is copied to a scratch directory ONCE, and every mutation happens
there. The working tree is never written to.

The first version of this did mutate the real files and put them back in a
finally block, which is fine until the process is killed between the two: a
timeout did exactly that on the first run and left musical/host.html broken. A
tool built to stop me introducing bugs introduced one, in the ten minutes it
took to write. Restore-afterwards is not a safety property. Never-touch-it is.

For each entry: break the thing the check watches in the COPY, run the gate
there, and require that THAT check goes red.

WHAT IT DOES NOT DO. Only the checks listed here are proven, and it says so: it
asks the gate what checks it actually runs and names the ones with no mutation.
Without that the summary reads "0 without a mutation yet" while covering half of
them, which is the exact failure this tool exists to catch, committed by the tool
itself.

  prove-checks.py            prove them all
  prove-checks.py esc        just the ones whose label matches
"""
import io
import os
import re
import shutil
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GRN, RED, YEL, DIM, OFF = '\033[32m', '\033[31m', '\033[33m', '\033[2m', '\033[0m'

# (what we expect to go red, file, find, replace, why this mutation is the right one)
#
# A mutation has to actually change what the check reads. Three of the first
# batch did not, and were reported as blind checks when the fault was mine:
# 'function' -> 'function ' is a no-op, and replacing the FIRST '"year":' takes
# the year off one song out of 5,080 when the check allows 5% to be missing. So
# find may also be a directive:
#
#   <<ALL:text>>   replace every occurrence, not the first
#   <<TRUNCATE>>   cut the file in half
#   <<EMPTY>>      leave it zero bytes
#   <<ANY:text>>   the text appears many times ON PURPOSE and breaking any one of
#                  them proves the check. Say so out loud, because the default is
#                  now that a find-string matching twice is an ERROR.
#
# WHY THAT DEFAULT CHANGED, 12 Sep 2026. This file used to say "two matches is
# FINE, because the real run only ever touches the first". It is not fine. The
# fix that stopped endGame() losing a confirmed winner added
# "      announce(false);" to index.html, six spaces in. The finishGame mutation
# searches for "    announce(false);", four spaces in, and the six-space line
# CONTAINS the four-space string and sits earlier in the file. So the mutation
# quietly started breaking endGame instead of finishGame, the finishGame check
# stayed green, and prove-checks reported it BLIND. Nothing was wrong with the
# check. A product change two hundred lines away had silently re-aimed the
# mutation, and the only reason anybody noticed is that this tool was run.
#
# Half a Worker does not parse, so four other checks catch it before the
# wholeness check is reached. Zero bytes parses perfectly, which is the case
# that check was actually written for.
MUTATIONS = [
    # ---- 12 Sep 2026: the Sydney move, the demo, and the day Dean asked how many
    # ---- times my own checks had been wrong. Answer at the time: ten.
    #
    # Every mutation below was run by hand as the check was written, in a scratch copy,
    # and watched go red. That proved nothing durable: the runs were one-offs nobody
    # could repeat and they did not run the next day. prove-checks listed all six suites
    # as NOT YET PROVEN while I was describing them as proven, which is the same shape
    # as a green check that cannot fail. Written down so they run every time.

    ('metering.test.js',
     'venueplay-backend/worker/venueplay-game.js',
     "    const raw = countPlayersWhoPlayed(roster, played);",
     "    const raw = roster.length;",
     'billing the phones that opened the page rather than the people who played, which once invoiced a venue for a room bigger than the host was looking at'),

    ('metering.test.js',
     'venueplay-backend/worker/venueplay-game.js',
     "    const peak = cap ? Math.min(raw, overageCeiling(s, cap)) : raw;",
     "    const peak = raw;",
     'quoting a venue more than the host approved, so the billing screen and the invoice disagree'),

    ('demo-hermetic.test.js',
     'venueplay/tv.html',
     '    if(VP_DEMO) return "";                       // hermetic: never inherit a real venue',
     '    ',
     'the sales demo shows whichever pub this browser last opened, with that venue\'s real join code on the wall'),

    ('demo-hermetic.test.js',
     'venueplay/app/vp-celebrate.js',
     "    if (isDemoPage()) return;      // a demonstration is watched, not heard",
     "    ",
     'a pub PA fanfare out of a visitor\'s laptop, unasked, once a minute for as long as the tab is open'),

    ('hq-contact-rule.test.js',
     'venueplay/app/hq.html',
     "    if (cancelled) acts.push(on ? \"venue_cancel_contacted\" : \"venue_cancel_uncontacted\");",
     "    ",
     'ringing a venue that has cancelled ticks only one of the two lists, so whichever screen you did not have open is wrong'),

    ('hq-contact-rule.test.js',
     'venueplay/app/hq.html',
     "      var statusCell = stateBadgeFor(v);",
     "      var statusCell = '<span class=\"badge idle\">Active</span>';",
     'a venue that has told us it is leaving reads as Active on the list you scan to see who your customers are'),

    ('one-answer.test.js',
     'venueplay-backend/worker/venueplay-game.js',
     "  let s = String(slug || '').toLowerCase().replace(/[^a-z0-9]/g, ''), h = 2166136261 >>> 0;",
     "  let s = String(slug || '').toLowerCase().replace(/[^a-z0-9]/g, ''), h = 2166136262 >>> 0;",
     'the game Worker hashes a venue slug differently from the seven pages, so a phone and a TV join different channels and the room sees nothing'),

    ('signin-blame.test.js',
     'venueplay/app/index.html',
     "    if(ours || !theirs){",
     "    if(false){",
     'a host with a perfectly good number is told to check their number while our own SMS provider is down'),

    ('sms-hook-secrets.test.js',
     'venueplay-backend/worker/venueplay-sms-hook.js',
     '    .map(function (x) { return x.trim().replace(/^whsec_/i, ""); })',
     '    .map(function (x) { return x.trim(); })',
     'the hook refuses the exact secret string Supabase displays, so no host can be sent a sign-in code'),

    ('sms-hook-secrets.test.js',
     'venueplay-backend/worker/venueplay-sms-hook.js',
     "      if (constantTimeEqual(sigValue, expectedSignature)) {",
     "      if (true) {",
     'anyone who learns the Worker URL can send SMS on our Mobile Message account'),

    # ---- 12 Sep 2026: THE END OF A BINGO GAME.
    # Every bingo suite in the repo stopped at the claim. bingo-after-the-win.test.js drives
    # the real console from the claim through Confirm, Finish game and Keep playing, singly
    # and as a tie, and asserts the MESSAGES, because the wall and every phone in the room are
    # driven entirely by them. Each find-string below was taken out of index.html by machine,
    # not typed: a hand-typed one that matches nothing reports the check BLIND, which happened
    # twice on 12 Sep.
    ('bingo-after-the-win.test.js',
     'venueplay/app/index.html',
     # Anchored on the line AFTER it as well, so it can only be finishGame's call.
     # Bare "    announce(false);" also matches inside endGame's six-space line.
     '    announce(false);\n    G.won=true;',
     '    announce(true);\n    G.won=true;',
     'Finish game broadcasts cont:true, so the wall celebrates and goes straight back to the '
     'board on a game that is over'),

    ('bingo-after-the-win.test.js',
     'venueplay/app/index.html',
     '    else if(act==="keepplaying") keepPlaying();',
     '    else if(act==="keepplaying_disabled") keepPlaying();',
     'Keep playing is rendered on the win card and does nothing when the host taps it, which '
     'strands the room between prizes'),

    ('bingo-after-the-win.test.js',
     'venueplay/app/index.html',
     '    G.pattern=nxt; G.prize=nextPrize; G.won=false;',
     '    G.pattern=nxt; G.prize=nextPrize; G.won=false; G.draw=[]; G.called={}; G.idx=-1;',
     'playing on for the next prize wipes the called numbers, so every board in the room clears '
     'and the tickets people have been daubing for twenty minutes mean nothing'),

    ('bingo-after-the-win.test.js',
     'venueplay/app/index.html',
     '              shared:ws.length>1, cont:!!cont };',
     '              shared:false, cont:!!cont };',
     'a tie is announced as a single winner, so the wall and both phones say one person has '
     'won a prize that is being split'),

    ('bingo-after-the-win.test.js',
     'venueplay/app/index.html',
     '    var ws=G.lastWins.slice().sort(function(a,b){ return (a.seq||0)-(b.seq||0); });',
     '    var ws=G.lastWins.slice();',
     'a tie is announced in the order the host happened to tap Confirm, so any screen on the '
     'pre-tie shape names the wrong winner'),

    ('bingo-after-the-win.test.js',
     'venueplay/app/index.html',
     '    else if(G.status==="running" && G.lastWins.length){ b.disabled=true; b.classList.add("waiting"); b.textContent="Announce the win"; }',
     '    else if(G.status==="running" && G.lastWins.length){ b.disabled=false; b.textContent="Next number"; }',
     'the biggest button on the console reads Next number over an unannounced win, so the host '
     'taps it instead of announcing and is refused by a toast they are not looking at'),

    ('bingo-after-the-win.test.js',
     'venueplay/app/index.html',
     '    if(G.lastWins.length && !G.claims.length && !G.won){',
     '    if(G.lastWins.length && !G.won){',
     'Finish game appears while another player is still waiting to have their ticket checked, '
     'so the host can end the game over an unheard bingo'),

    ('bingo-after-the-win.test.js',
     'venueplay/app/index.html',
     '    if(G.lastWins.length){ showToast("Announce the win first: keep playing, or finish the game."); return; }',
     '    if(false){ showToast("Announce the win first: keep playing, or finish the game."); return; }',
     'the host calls the next number over a confirmed win, which closes the tie window on that '
     'ball and leaves the console deaf to the next genuine bingo'),

    ('bingo-after-the-win.test.js',
     'venueplay/app/index.html',
     '    if(G.claims.length>1){',
     '    if(false){',
     'two people calling on the same number are shown as two separate claims with no tie bar '
     'and no one-tap split, so the host confirms one and the other is served by luck'),

    # The fault this one names is the one the suite was WRITTEN to find, on 12 Sep 2026:
    # endGame() had no guard at all, where nextBall() and finishGame() both have one. The
    # find-string is the guard that was added, so taking it out restores the shipped console
    # exactly. Verified red before it was written down: 3 of 124.
    ('bingo-after-the-win.test.js',
     'venueplay/app/index.html',
     '''    if(G.lastWins.length && !G.won){
      announce(false);
      G.won = true;
    }
    clearCallGuards();''',
     '    clearCallGuards();',
     'the host taps End game over a confirmed winner, the wall goes back to the ads and the '
     "winner message is never sent, so the punter's phone never says YOU WON and they have "
     'nothing to show the host to claim the prize'),

    # ---- 10 Sep: money, the nightly sweep, and the road a game message takes ----
    # THE LABEL IS THE SUITE'S FILE NAME, not the check inside it. The gate prints a
    # failing suite as "FAIL stripe-idempotency.test.js ...", and gate() looks for the
    # label in that line, so an inner check name never matches and the mutation is
    # reported BLIND while the check it broke was working perfectly. Written the wrong
    # way round first, and caught only because the run listed these suites as NOT YET
    # PROVEN while their mutations were sitting right here.
    # Every one of these was broken by hand and watched go red as it was written.
    # Written down so nobody has to take that on trust, and so an edit that quietly
    # guts one is caught.
    ('stripe-idempotency.test.js',
     'venueplay-backend/worker/venueplay-api-FULL.js',
     "}, idemTag ? ('prel:' + idemTag) : null);",
     "});",
     'two tabs on the billing page both post the release credit and the venue is paid twice'),

    ('stripe-idempotency.test.js',
     'venueplay-backend/worker/venueplay-api-FULL.js',
     "'credend:' + (eventId || (customerId + ':' + (-bal)))",
     "'credend:' + Date.now()",
     'a key that is new on every attempt deduplicates nothing, so a retried webhook clears the credit twice'),

    ('webhook-ledger.test.js',
     'venueplay-backend/worker/venueplay-api-FULL.js',
     "    if (row.completed_at) return 'skip';             // a real duplicate",
     "    if (false) return 'skip';             // a real duplicate",
     'Stripe redelivers an event and every branch of the webhook runs a second time'),

    ('webhook-ledger.test.js',
     'venueplay-backend/worker/venueplay-api-FULL.js',
     "    if (!(age > VPA_EVENT_STALE_MS)) return 'skip';  // another delivery is mid-flight right now",
     "    return 'skip';  // another delivery is mid-flight right now",
     'a webhook whose first attempt was killed is never handled, so a venue pays and stays switched off'),

    ('sweep-sessions.test.js',
     'venueplay-backend/worker/venueplay-game.js',
     # Re-aimed 11 Sep 2026: the cutoff became optional, so the old find-string stopped
     # matching and prove-checks reported the mutation dead rather than the check blind.
     "      'ended_at=is.null' + (cutoff ? ('&opened_at=lt.' + enc(cutoff)) : '') +",
     "      'status=in.(lobby,running,paused)' + (cutoff ? ('&opened_at=lt.' + enc(cutoff)) : '') +",
     'the nightly sweep goes back to asking by status, and a cancelled session sits open for ever holding billable players'),

    ('sweep-sessions.test.js',
     'venueplay-backend/worker/venueplay-game.js',
     "      const ranANight = (session.status === 'lobby' || session.status === 'running' || session.status === 'paused');",
     "      const ranANight = true;",
     'the sweep bills a venue for a session whose status nothing in the product even writes'),

    ('room-fallback.test.js',
     'venueplay/app/vp-room.js',
     "      if (now - st.downSince >= budget) { unavailable(st.everOpen ? \"lost\" : \"no answer\"); return; }",
     "",
     'the room dies mid-question and the page says Reconnecting all night with the balls piling up in a queue'),

    ('room-fallback.test.js',
     'venueplay/app/vp-room.js',
     "      var handshake = setTimeout(function () {",
     "      var handshake = 0; var _unused = (function () {",
     'a socket that hangs on a captive portal arms no budget at all and the page waits for ever'),

    # NOT A MUTATION, ON PURPOSE. There was one here for the close-on-handover in
    # unavailable(), and prove-checks called it BLIND, correctly. Every path that
    # reaches unavailable() has ALREADY closed its socket: a lost socket arrives via
    # onclose, and a hung one is closed by the handshake timer before it retries. So
    # the close in unavailable() is defensive code that today is unreachable, and no
    # test can watch it work.
    #
    # The line stays, because it is cheap and it is right the day somebody adds a
    # fourth way to give up. The mutation goes, because a permanent BLIND entry
    # trains people to read BLIND as normal, and BLIND is the one word in this
    # tool's output that must always mean something is wrong.

    # ---- 5 Sep: the screen-reachability work ---------------------------------
    # Each of these was broken by hand and watched go red as it was written. Written
    # down here so the next person does not have to take that on trust, and so a
    # later edit that quietly guts one of them is caught.
    ('a dropped channel is never written into',
     'venueplay/app/index.html',
     '        subscribed=false;\n        $("statusDot").classList.remove("on");',
     '        $("statusDot").classList.remove("on");',
     'bingo says Reconnecting and keeps posting into a dead socket'),

    ('a console can put the game back on the wall',
     'venueplay/app/musical/host.html',
     # BOTH listeners. The check is satisfied by either, which is correct - one is
     # enough to recover a screen - so removing only pageshow left it green and read
     # as a blind check when the mutation was simply too weak.
     '  window.addEventListener("pageshow", reassertOnReturn);\n  document.addEventListener("visibilitychange", function(){',
     '  document.addEventListener("nothing", function(){',
     'a console sends the TV to the ads and can never bring it back'),

    ('a reloaded TV gets the lobby back',
     'venueplay/app/musical/host.html',
     'if(G.status==="lobby" || G.status==="running"){\n        send({ t:"mode", mode:"musical" });',
     'if(G.status==="running"){\n        send({ t:"mode", mode:"musical" });',
     'a TV reloading mid-lobby is stranded on the ads'),

    ('a join never rebuilds a host console',
     'venueplay/app/trivia/host.html',
     'renderJoinCounts();     // NOT renderConsole: see above',
     'renderConsole();',
     "a punter joining rebuilds the panel under the host's finger"),

    ('an unsigned admin broadcast is exempt from signing',
     'venueplay/app/vp-sign.js',
     # screen_refresh, NOT tv_reload. Deleting hq.html's broadcast machinery on 5 Sep
     # left nothing sending tv_reload, so taking it off the exempt list guards nothing
     # and the mutation was vacuous. billing.html still broadcasts screen_refresh
     # unsigned, which is the live subject this check exists for.
     'var EXEMPT = { screen_refresh: 1,',
     'var EXEMPT = {',
     "billing.html's screen refresh is dropped silently at any enforcing venue"),

    ('the public key cannot write the tour tables',
     'touring/manage.html',
     'const res = await apiSave("shows", { rows: rows, delete: pendingDeletes.slice() });',
     'const res = await fetch(`${SUPABASE_URL}/rest/v1/shows`, {method:"POST", headers:SB_HEADERS, body:JSON.stringify(rows)});',
     'the tour listings go back to being world-writable'),

    # ---- 5 Sep: the three new suites ----------------------------------------
    ('screen-reload.test.js',
     'venueplay/tv.html',
     # The reload_at block, which is what this suite reads. The first version mutated
     # the newer COMMAND block instead, so the suite never saw it and reported blind.
     'if(isFinite(asked) && asked > PAGE_LOADED_AT){',
     'if(isFinite(asked)){',
     'a reloaded screen obeys the same reload request again on every poll, for ever'),

    ('screen-health.test.js',
     'venueplay/tv.html',
     '      if(!idle()) return !gameLooksFrozen();',
     '      if(!idle()) return true;',
     'a board frozen since last night counts as a healthy screen'),

    ('group-billing.test.js',
     'venueplay-backend/worker/venueplay-game.js',
     'const peak = countPlayers(roster);',
     'const peak = (roster||[]).length;',
     'a group is quoted a different number from the one we would charge'),

    ('every playlist points at songs that exist',
     'venueplay/data/musical-library.json',
     '<<ANY:"songIds": [\n>>', '"songIds": [\n    "no-such-song",\n',
     'a playlist pointing at a song that is not there deals a blank cell'),

    ('esc() is the same in all',
     'venueplay/app/musical/host.html',
     'function esc(s){ return String(s==null?"":s).replace(/[&<>"\']/g,',
     'function esc(s){ return String(s==null?"":s).replace(/[&<>]/g,',
     'one copy of esc quietly stops escaping quotes'),

    ('tvSend() is the same in all',
     'venueplay/app/raffle/screen.html',
     'try{ ch.send({ type:"broadcast", event:"msg", payload:obj }); }catch(e){}',
     'ch.send({ type:"broadcast", event:"msg", payload:obj });',
     'one screen loses the guard and a dead socket blacks it out'),

    ('no em dashes in copy',
     'venueplay/app/vp-feedback.js',
     'Thanks, that helps the venue',
     'Thanks — that helps the venue',
     'an em dash reaches player-facing copy through a shared script'),

    ('never "the ACT"',
     'venueplay/app/vp-gaming.js',
     "name: 'ACT'", "name: 'the ACT'",
     'the house rule breaks in the one file that is not .html'),

    ('every test reads the code this repo ships',
     'venueplay-backend/app/vp-follow.test.js',
     '"vp-follow.js",', '"/Users/dean.tindale/an-old-copy/vp-follow.js",',
     'a suite starts testing a copy nobody ships'),

    # AIM AT THE THING THE CHECK WATCHES. The first version of this replaced the
    # first 'pid:' in the file, which is P.pid in the state object at line 390,
    # nowhere near a /join. The check stayed green, correctly, and was reported
    # BLIND. A mutation that misses is the same mistake one level up, so every
    # entry here targets a string that only exists at the call site.
    ('every page that joins a player sends its device id',
     'venueplay/play.html',
     'playerPost("/join", { code:d.join_code, name:P.name, pid:deviceId() })',
     'playerPost("/join", { code:d.join_code, name:P.name })',
     'a phone stops sending its id and every rejoin bills a new player'),

    ('a winner is sent to the host, never the bar',
     'venueplay/tv.html',
     'show your phone to the host',
     'show your phone to the bar',
     'the locked wording drifts on one of the screens'),

    ('every shared script loads before it is used',
     'venueplay/play.html',
     # vp-room.js was inserted BETWEEN these two when the room client was wired in, so
     # the old pair no longer sat next to each other and this mutation quietly stopped
     # applying. Same intent: drop vp-feedback.js while the page still calls it.
     '<script src="/app/vp-room.js"></script>\n<script src="/app/vp-feedback.js"></script>',
     '<script src="/app/vp-room.js"></script>',
     'a page uses a global and never loads the script that defines it'),

    # ---- the basics: does anything catch a broken file at all ----
    ('every script in',
     'venueplay/play.html',
     'function route(){', 'function route(){ this is not javascript',
     'a page ships with a syntax error'),

    ('every Worker actually loads',
     'venueplay-backend/worker/venueplay-game.js',
     'async function handleFeedback(', 'async function handleFeedback(((',
     'a Worker parses but cannot be loaded'),

    ('definition check across',
     'venueplay/tv.html',
     'function renderLobby(){', 'function renderLobby(){ aFunctionThatDoesNotExistAnywhere();',
     'a page calls something that does not exist'),

    # ---- the test suites: can each one still fail? ----
    ('pp-ticket.test.js',
     'partyplay-backend/lib/pp-ticket.js',
     '<<ALL:return>>', 'return null; //', 'the ticket library changes under its own suite'),

    ('pp-licence.test.js',
     'partyplay-backend/lib/pp-licence.js',
     '<<ALL:days>>', 'daze', 'the licence library changes under its own suite'),

    ('pp-quiz.test.js',
     'partyplay-backend/lib/pp-quiz.js',
     '<<ALL:return>>', 'return null; //', 'the quiz library changes under its own suite'),

    ('partyplay-api.test.js',
     'partyplay-backend/worker/SOURCE-do-not-paste-partyplay-api.js',
     "if (request.method !== 'POST') {", 'if (false) {',
     'unsubscribe goes back to firing on a GET'),

    ('manager-permissions.test.js',
     'venueplay-backend/worker/venueplay-game.js',
     "&select=id,role,venue_id,permissions", "&select=id,role,venue_id",
     'requireStaff stops fetching the column every permission check reads'),

    ('redraw-confirm.test.js',
     'venueplay/app/raffle/host.html',
     'if(_redrawArm){ disarmRedraw(); onRedraw(false); return; }', 'disarmRedraw(); onRedraw(false); return;',
     'Not here, redraw goes back to one tap and voids a genuine winner who is walking up'),

    # A reloading host loses its spin: the snapshot stops carrying it and the label goes back to 4.
    ('draw-hold.test.js', 'venueplay-backend/worker/venueplay-game.js',
     "        spin_seconds: cfg.spin_seconds != null ? cfg.spin_seconds : null,\n", "",
     'a host who reloads mid-raffle gets a 4 second spin whatever the venue chose'),
    ('draw-hold.test.js', 'venueplay/app/raffle/host.html',
     '        if([3,4,5,6,8].indexOf(g.spin_seconds)>=0){ G.drawLength=g.spin_seconds; $("drawLenLbl").textContent=g.spin_seconds; }\n', '',
     'the snapshot carries the spin and the console ignores it'),
    ('redraw-confirm.test.js', 'venueplay/app/raffle/host.html',
     '      drawBtnWaiting(nums);\n', '',
     'the Draw button reads Drawing… for the whole claim window and a host thinks it has hung'),

    # The bingo ball order lives on the server (migration 70). Four ways it can quietly stop.
    ('bingo-server-draw.test.js', 'venueplay-backend/worker/venueplay-game.js',
     "      if (since >= 0 && since < BINGO_SERVER_HOLD_MS) {", "      if (false) {",
     'the server hold goes; a retried request draws a second ball while the first is still going up'),
    ('bingo-server-draw.test.js', 'venueplay-backend/worker/venueplay-game.js',
     "  if (draw.mode === 'local') return json({ error: 'This game is being called from the tablet' }, 409);\n", "",
     'after the tablet takes over the server keeps handing out balls, and one repeats a number the room already daubed'),
    ('bingo-server-draw.test.js', 'venueplay-backend/worker/venueplay-game.js',
     "  return json({ draw_id: row.id });", "  return json({ draw_id: row.id, draw_order: row.draw_order });",
     'the whole future order is sent to the tablet, which is the one thing the licence forbids'),
    ('bingo-server-draw.test.js', 'venueplay/app/index.html',
     "      if(n==null) n=drawFromPool();\n", "",
     'the fallback goes: when the Worker is down the console stops calling and the room sits there'),
    ('bingo-server-draw.test.js', 'venueplay-backend/supabase/venueplay-70-bingo-server-draw.sql',
     "grant execute on function public.vp_bingo_next_ball(uuid) to service_role;", "grant execute on function public.vp_bingo_next_ball(uuid) to service_role, anon;",
     'the public key printed in every page can draw the next ball'),

    ('every decade pack holds only its decade',
     'venueplay/data/musical-library.json',
     '"name": "80s Rock",\n   "songIds": [\n',
     '"name": "80s Rock",\n   "songIds": [\n    "long-way-to-the-top-ac-dc",\n',
     'a 1975 AC/DC track is dealt in the 80s pack and the room calls it out'),

    ('sign-in.test.js',
     'venueplay/app/index.html',
     '$("otpIn").addEventListener("keydown"', '$("otpIn").addEventListener("keyDOWN"',
     'a host types the SMS code, presses Enter on a laptop, and nothing happens'),

    ('live-fixes.test.js',
     'venueplay/app/musical/screen.html',
     # The DECLARATION, not whichever use comes first. Renaming the declaration is what
     # leaves the reader pointing at a name that is gone, which is what the check catches.
     'var LOBBY_MAX_MS=60*60*1000', 'var LOBBY_MAX_MS_DISABLED=60*60*1000',
     'the 60 minute lobby cap disappears'),

    ('slug-ladder.test.js',
     'venueplay-backend/worker/venueplay-api-FULL.js',
     # The declaration, not one of the three call sites.
     'async function vpaUniqueSlug(', 'async function vpaUniqueSlugRenamed(',
     'the slug ladder that keeps 100 Royal Hotels apart is renamed away'),

    # NOT founding_id_removed: the check asks whether "founding_id" appears in the
    # picker, and founding_id_removed still CONTAINS it. A mutation has to remove
    # the thing, not decorate it.
    ('check-venue-scoping.py',
     'venueplay/app/index.html',
     '<<ALL:founding_id>>', 'acct_ref',
     'the venue switcher stops narrowing by account and shows one operator everybody else venues'),

    ('no song is held twice',
     'venueplay/data/musical-library.json',
     '"songs": [\n', '"songs": [\n  {"id": "the-horses-daryl-braithwaite", "title": "The Horses", '
                      '"artist": "Daryl Braithwaite", "previewUrl": "https://x", "artworkUrl": "https://x"},\n',
     'the same song is in the library twice and can be played twice in a night'),

    # ---- the data ----
    ('every song has audio',
     'venueplay/data/musical-library.json',
     '<<ANY:"previewUrl": "https>>', '"previewUrl": "", "x": "https',
     'a song loses its audio and the host plays silence'),

    ('songs know what year they are',
     'venueplay/data/musical-library.json',
     '<<ALL:"year":>>', '"yearWas":',
     'the years vanish and every decade pack empties'),

    # ---- the house rules and the locked wording ----
    ('never "roster" in copy',
     'venueplay/app/billing.html',
     '<h1>', '<h1>roster ',
     'the word Dean banned reaches the screen'),

    # The check reads the literal phrase "<name> is EXEMPT" out of comments and
    # compares it against the real EXEMPT list in vp-sign.js. So the mutation has
    # to write that claim, not edit a list somewhere.
    ('no file claims an exemption vp-sign does not grant',
     'venueplay/app/vp-screen-router.js',
     '"use strict";', '"use strict";  // winner is EXEMPT from signing',
     'a comment claims an exemption the signer does not actually grant'),

    # ---- the Workers you paste ----
    ('venueplay-game.js is whole',
     'venueplay-backend/worker/venueplay-game.js',
     '<<EMPTY>>', '',
     'the Worker file ends up empty, which is the case this check exists for: '
     'zero bytes parses perfectly and half a file does not, so the parser catches '
     'the truncation and only this catches the emptying'),

    # This check compares the BUILD STAMP the source carries against the one in
    # the built file, so the mutation has to move the stamp. Editing the source's
    # code does not: the stamp only changes when stamp-workers.py runs, which the
    # pre-push hook does before this ever runs. That is the real guard against an
    # edited-but-unbuilt source, and it is why editing code here proves nothing.
    ('the build is this source, not an older one',
     'partyplay-backend/worker/SOURCE-do-not-paste-partyplay-api.js',
     "const BUILD = '", "const BUILD = 'not the same stamp",
     'the source is rebuilt and the deployed copy is left behind'),

    # ---- the rest of the suites ----
    ('pp-photo.test.js', 'partyplay-backend/lib/pp-photo.js',
     '<<ALL:return>>', 'return null; //', 'the photo library changes under its own suite'),
    ('pp-video.test.js', 'partyplay-backend/lib/pp-video.js',
     '<<ALL:return>>', 'return null; //', 'the video library changes under its own suite'),
    ('pp-run-games.test.js', 'partyplay/run.html',
     'function runCharades', 'function runCharadesRenamed',
     'the charades runner is renamed out from under its suite'),
    # The suite runs admin.html's real script under stubs, so the mutation has to
    # break the SCRIPT. Changing the page's wording proved nothing.
    ('pp-admin-auth.test.js', 'partyplay/admin.html',
     'function askKey', 'function askKeyRenamed',
     'the admin sign-in is renamed out from under its suite'),
    # THESE TWO READ THE BUILT WORKER, not the source. Mutating the source proved
    # nothing about them, which is exactly the trap this tool exists to catch,
    # walked into by the tool's own author.
    ('pp-checkout.test.js', 'partyplay-backend/worker/DEPLOY-partyplay-api.js',
     'async function handleCheckout', 'async function handleCheckoutRenamed',
     'checkout is renamed out from under its suite'),
    ('pp-join-names.test.js', 'partyplay-backend/worker/DEPLOY-partyplay-api.js',
     "const taken = await sb(env, 'pp_players?licence_id=eq.'",
     "const taken = [] || await sb(env, 'pp_players?licence_id=eq.'",
     'two guests called Sam both join as Sam and charades shows the word to both'),
    # WAS partyplay/host.html, a file this suite never opens, so the mutation
    # could not fail it and the check read BLIND. The suite reads the pack
    # index, the packs and pp-quiz.js; the licence block is the thing it was
    # written to guard, and dropping one has happened on this bank before.
    ('pp-trivia-pack.test.js', 'partyplay/data/trivia/index.json',
     # The BANK's own licence line. Four blocks in this file carry the word, and the
     # per-pack ones are a different claim.
     '"license": "CC BY-SA 4.0 for imported questions',
     '"licence_dropped": "CC BY-SA 4.0 for imported questions',
     'the licence block is dropped from the question bank'),
    # A fresh random code per session is what made the wall change mid-night and
    # made a table talker impossible to print.
    ('venue-code.test.js', 'venueplay-backend/worker/venueplay-game.js',
     'const joinCode = (attempt === 0 && ownCode) ? ownCode : genCode(6);',
     'const joinCode = genCode(6);',
     'a session mints its own code again, so the venue has two'),
    # The ceiling Dean spotted: every venue ever created, cancelled ones
    # included, counted toward 5,000 - so live venues stop resolving silently.
    ('venue-scale.test.js', 'venueplay-backend/worker/venueplay-game.js',
     "const rows = await sbGetAll(env, 'vp_venues',\n    'slug=not.is.null&select=id,slug,join_code,status');",
     "const rows = await sbGet(env, 'vp_venues', 'slug=not.is.null&select=id,slug,join_code,status&limit=1000');",
     'the venue-code map reads one page again, so venues past it stop working'),
    # 8 Sep: the TV, the console and the table talkers all use a HASH of the slug
    # as the venue code; the owner can change the ISSUED code. Drop the fallback
    # that lets the hash resolve and Change code blanks the venue's television.
    ('venue-channel.test.js', 'venueplay-backend/worker/venueplay-game.js',
     'const derived = _vcHashMap[code];',
     'const derived = null;',
     'an owner presses Change code and the venue TV says "not linked to an account" and forgets its venue'),
    # The reveal's compare-and-set loses its condition: two reveals both win, and
    # a plain write is what let phones keep answering while the scoring ran.
    ('trivia-reveal.test.js', 'venueplay-backend/worker/venueplay-game.js',
     "'game_id=eq.' + enc(gameId) + '&phase=eq.asking', { phase: 'revealed' });",
     "'game_id=eq.' + enc(gameId), { phase: 'revealed' });",
     'a question is scored while phones can still answer it, and the last tap is never scored'),
    # The page-side hold stops holding: busy() says free, so a double tap draws two balls.
    ('draw-hold.test.js', 'venueplay/app/vp-hold.js',
     "    if (Date.now() >= holds[k].until) { release(btn); return false; }\n    return true;",
     "    if (Date.now() >= holds[k].until) { release(btn); return false; }\n    return false;",
     'a fumbled double tap on the bar tablet draws two bingo balls and the TV abandons the first mid-call'),
    # /health goes back to reading every venue into the Worker to count them.
    ('health.test.js', 'venueplay-backend/worker/venueplay-game.js',
     "sbCount(env, 'vp_venues', 'select=id'),",
     "sbGetAll(env, 'vp_venues', 'select=id').then((r) => r.length),",
     'a public route reads the whole venue table on every call again'),
    # The 11-second path: skip the indexed row and every lookup scans the table.
    ('venue-code-scan.test.js', 'venueplay-backend/worker/venueplay-game.js',
     'if (hit && hit.length === 1) return hit[0].id;',
     'if (false && hit && hit.length === 1) return hit[0].id;',
     'the hot path goes back to scanning every venue before it answers a television'),
    # Only a draw with a night set goes on the wall; that filter is also what
    # takes a retired or archived draw off the screen.
    ('screen-endpoint.test.js', 'venueplay-backend/worker/venueplay-game.js',
     "draws = (d || []).filter((x) => x && x.draw_day);",
     "draws = d || [];",
     'a retired members draw goes back up on the wall with its old jackpot'),
    # A byte changes after stamping: /health would report a build that is not
    # the one running, which is the blindness the stamp exists to cure.
    ('venueplay-game.js carries its own fingerprint', 'venueplay-backend/worker/venueplay-game.js',
     'function fnvVenueCode(slug) {',
     'function fnvVenueCode(slug) { /* edited after stamping */',
     'the Worker is edited after stamping, so /health reports a build that is not running'),
    ('venueplay-api-FULL.js carries its own fingerprint', 'venueplay-backend/worker/venueplay-api-FULL.js',
     "const BUILD = '",
     "const EDITED_AFTER_STAMPING = 1;\nconst BUILD = '",
     'the billing Worker is edited after stamping'),
    ('SOURCE-do-not-paste-partyplay-api.js carries its own fingerprint', 'partyplay-backend/worker/SOURCE-do-not-paste-partyplay-api.js',
     "const BUILD = '",
     "const EDITED_AFTER_STAMPING = 1;\nconst BUILD = '",
     'the PartyPlay Worker source is edited after stamping'),
    # The id fallback: an older host broadcasts titles alone, and without the
    # fallback every card in the room stays blank for the rest of that night.
    ('musical-win.test.js', 'venueplay/app/musical/play.html',
     'if(set.hasIds && id) return !!set.id[id];',
     'return !!set.id[id];',
     'a host on an older page leaves every musical card blank all night'),
    # The black screen, twice in a real pub: the ads never rebuild after a game
    # and the wall stays dark for the rest of the night.
    ('tv-states.test.js', 'venueplay/tv.html',
     'adBuilt=false;   // rebuild from the latest loaded slides so the ads always come back (never black)',
     '// adBuilt stays true',
     'the ads never rebuild, so the venue TV goes black after a game'),
    # A ticket that has already won being drawn again, in a room, for a prize.
    # rng-evidence proves the generator; this proves the code that USES it.
    ('draw-fairness.test.js', 'venueplay-backend/worker/venueplay-game.js',
     'if (drawn[n] || chosen[n] || inExcluded(n)) continue;',
     'if (chosen[n]) continue;',
     'a raffle ticket already drawn can win a second time'),
    # Trivia is the launch format in Queensland and the one with a leaderboard on
    # the wall, so wrong scoring puts the wrong team's name up in front of the room.
    ('trivia-score.test.js', 'venueplay-backend/worker/venueplay-game.js',
     'bonus = Math.round(base * 0.5 * (remaining / secs));',
     'bonus = Math.round(base * 1.0 * (remaining / secs));',
     'the speed bonus doubles: a fast answer scores 200 instead of 150'),
    # The expensive one: a two-line prize paid out on a single completed line.
    # play.html decides this on the player's phone before the host sees the
    # claim, so a wrong answer is a wrong payout in front of a room.
    ('bingo-win.test.js', 'venueplay/play.html',
     'if(P.pattern==="two") return rows>=2;', 'if(P.pattern==="two") return rows>=1;',
     'a two-line prize pays out on one line'),
    # ---- 9 Sep: the 72-finding build. Each of these was broken by hand and watched
    # go red before it was written down here.
    # A host locked out of their own members draw for the night: the button was
    # disabled before the confirm written for exactly that case could fire.
    ('draw-again.test.js', 'venueplay/app/members/host.html',
     'var b=$("drawBtn"); b.disabled=false;', 'var b=$("drawBtn"); b.disabled=alreadyDrawnTonight();',
     'the draw button disables itself again, so a lost reply locks the host out for the night'),
    # The raffle TV was told to go idle 21 seconds before its celebration ended.
    ('unsold-and-hold.test.js', 'venueplay/app/raffle/host.html',
     'var CLAIM_CELEBRATE_MS=30000', 'var CLAIM_CELEBRATE_MS=9000',
     'the console and the TV disagree again about how long a win stays up'),
    # A manager could open the owner Stripe portal: every invoice, and the card.
    ('owner-only-routes.test.js', 'venueplay-backend/worker/venueplay-api-FULL.js',
     "  { const g = vpbOwnerOnly(o, json); if (g) return g; }\n  const customer = o.account",
     "  const customer = o.account",
     'a manager can open the owner Stripe portal, which shows every invoice and changes the card'),
    # The picture round: the builder must post to the route the Worker actually has.
    ('trivia-night.test.js', 'venueplay/app/trivia/builder.html',
     '"/host/trivia/image-upload"', '"/host/trivia/picture"',
     'the picture upload posts to a route that does not exist, which is how it broke in August'),
    # The room server: its own test, against its own file.
    ('venueplay-room.test.js', 'venueplay-backend/worker/venueplay-room.js',
     'if (all[i] === except) continue;', 'if (false) continue;',
     'the room sends a message back to the screen that sent it, which is not what Supabase does'),
    # And the copy of it that actually runs, inside the game Worker.
    ('the room server in the game Worker matches venueplay-room.js',
     'venueplay-backend/worker/venueplay-room.js',
     'const ROOM_MAX_PER_SEC   = 20;', 'const ROOM_MAX_PER_SEC   = 21;',
     'the room server is fixed in one of its two copies and not the other'),
    # ---- 10 Sep: the room server, the one-trip draws, and the morning that
    # produced them. Every one of these was broken by hand and watched go red.
    ('tv-screen.test.js', 'venueplay/tv.html',
     'out.style.zIndex = "1";\n      into.style.zIndex = "2";',
     'into.style.zIndex = "2";',
     'the slide leaving paints over the slide arriving on the wrap, which is what Dean saw on the wall'),
    ('settings-owner-only.test.js', 'venueplay/app/settings.html',
     'card.style.display = "none";', 'card.style.opacity = ".62";',
     'a manager can see what the venue collects about its players again'),
    ('sign-race.test.js', 'venueplay/app/vp-sign.js',
     '        .then(function () { return S.keyTried || null; })\n', '',
     "a console's first messages go out before its key loads, and an enforcing venue's TV bins them"),
    # The flag reading moved OUT of the three pages and into vp-room.js on 10 Sep, so
    # this searched a file that no longer mentions it. Same fault, at its new address.
    ('room-optin.test.js', 'venueplay/app/vp-room.js',
     'roomserver=([01])', 'room=([01])',
     "the room flag collides with the player page's own game-code parameter and the phone shows No room"),
    ('tv-ads-rebuild.test.js', 'venueplay/tv.html',
     'if(!force && adsSig!==null && sig===adsSig && host.querySelector(".ad")){',
     'if(false){',
     'the ad loop rebuilds on identical content, which empties the wall for a frame and jumps back to slide one'),
    ('tv-logo.test.js', 'venueplay/tv.html',
     'if(el) el.style.display=(venueLogoUrl && tvMode!=="ads") ? "block" : "none";',
     'if(el) el.style.display=venueLogoUrl ? "block" : "none";',
     "our logo overlay sits on top of an advertiser's paid slide"),
    ('tv-stale-screen.test.js', 'venueplay/tv.html',
     'if(d.content_at){', 'if(false && d.content_at){',
     'a screen that missed the broadcast never learns a slide changed and shows yesterday all night'),
    ('billing-hosts.test.js', 'venueplay/app/billing.html',
     '(f.permKeys || []).forEach(function(k){ if (perms[k] === false) perms[k] = true; });',
     '',
     'a manager is added with every permission switched off, whatever was ticked'),
    ('bingo-console.test.js', 'venueplay/app/index.html',
     'function clearCallGuards(){', 'function clearCallGuardsRenamed(){',
     'the guards that stop a dead Next button are renamed away'),
    ('signage-logo.test.js', 'venueplay/signage.html',
     '.sign .vlogo{height:14cqh;', '.sign .vlogo{height:auto;',
     'the venue logo loses its fixed slot and lands on the writing when it prints'),
    ('one-trip-draws.test.js', 'venueplay-backend/supabase/venueplay-76-one-trip-host-draws.sql',
     # ANCHORED TO vp_bingo_ball. The identical line sits in vp_members_draw too, and the
     # bare string only ever broke whichever came first in the file. Two different
     # authorisation checks on two different games, so each now gets its own mutation.
     """  -- 2. may this person run games at THAT venue (the draw's venue, never one
  --    the caller named), and is the venue switched on
  v_who := public.vp_host_staff(p_auth_user_id, v_draw.venue_id);""",
     """  -- 2. may this person run games at THAT venue (the draw's venue, never one
  --    the caller named), and is the venue switched on
  v_who := null;""",
     'the staff check disappears from the one-trip BINGO BALL draw, which is an '
     'authorisation hole not a speed-up'),

    # ADDED 12 Sep 2026. The mutation above used to be the bare v_who line, which matched
    # twice and only ever broke the first. So the members draw half of this migration has
    # never once been proven. If this one comes back BLIND, that is a real gap in cover,
    # not a broken mutation.
    ('one-trip-draws.test.js',
     'venueplay-backend/supabase/venueplay-76-one-trip-host-draws.sql',
     """  -- 2. staff at the DRAW's venue, and the kill-switch
  v_who := public.vp_host_staff(p_auth_user_id, v_draw.venue_id);""",
     """  -- 2. staff at the DRAW's venue, and the kill-switch
  v_who := null;""",
     'the staff check disappears from the one-trip MEMBERS DRAW, so anyone who can reach the '
     'function can spin another venue draw'),
    ('vp-follow.test.js', 'venueplay/app/vp-follow.js',
     '<<ALL:root.VPFollow>>', 'root.VPFollowRenamed',
     'the follow-the-host library stops exporting itself'),
    ('musical-draw.test.js', 'venueplay/app/musical/host.html',
     'var HITS_ALPHA=45;', 'var HITS_ALPHA_REMOVED=45;',
     'the weighting that keeps a night singable is renamed away'),
    # The rejection sampler is what makes the draw unbiased. Take the loop away
    # and x % max favours the low numbers, which for bingo means some balls come
    # out first more often than others. That is the whole of clause 4.7.1.
    # The state map is HALF of the founding gate. Take QLD's alternate range away
    # and a Gold Coast venue reading the founding price on /qld is charged
    # standard, silently, which is exactly what happened before.
    ('no corner of a screen mixes cqw and px', 'venueplay/tv.html',
     # The venue name stopped being an inline style on 5 Sep - it is a wrapped second
     # line inside .tv-corner now - so the old mutation had nothing to match. Mix the
     # units on the corner rule itself, which is what the check actually reads.
     '.tv-corner{position:absolute;top:2cqw;right:2.4cqw;',
     '.tv-corner{position:absolute;top:2cqw;right:18px;',
     'a corner is pinned in two different units and only lines up at one screen width'),

    ('founding-gate.test.js', 'venueplay-backend/worker/venueplay-api-FULL.js',
     "  if ((n >= 4000 && n <= 4999) || (n >= 9000 && n <= 9999)) return 'QLD';",
     "  if (n >= 4000 && n <= 4999) return 'QLD';",
     'a Gold Coast 9xxx venue quietly loses the founding price it was shown'),

    ('rng-evidence.test.js', 'venueplay-backend/worker/venueplay-game.js',
     '  do { crypto.getRandomValues(buf); x = buf[0]; } while (x >= limit);',
     '  crypto.getRandomValues(buf); x = buf[0];',
     'the draw stops rejecting and quietly favours the low numbers'),

    ('shift-timer.test.js', 'venueplay/app/index.html',
     '  function enforceShift(){\n    if(window.VP && VP.setGameActive){',
     '  function enforceShift(){\n    setTimeout(function(){}, 4*3600*1000);\n    if(false){',
     'a console goes back to its own frozen shift timer, which signs out the next '
     'host mid-game and closes a live night'),

    ('money.test.js', 'venueplay-backend/worker/venueplay-game.js',
     "  if (annual) return tier === 'founding' ? 2.30 : 2.85;",
     "  if (annual) return tier === 'founding' ? 2.40 : 2.85;",
     'the two Workers stop agreeing on the price, so a venue is quoted one '
     'number and charged another'),

    ('one-game.test.js', 'venueplay-backend/worker/venueplay-game.js',
     # The declaration, not one of the two call sites.
     'async function endOtherRunningGames(', 'async function endOtherRunningGamesRenamed(',
     'the one-game-at-a-time rule is renamed away'),
    ('check-tv-watchdog.py', 'venueplay/tv.html',
     '<<ALL:tv_reload>>', 'tv_reload_disabled',
     'the screen loses the remote reload it repairs itself with'),

    # ---- the rest of the data and the rules ----
    ('cryptoInt() is the same in all', 'venueplay/training.html',
     'function cryptoInt', 'function cryptoInt(max){ return 0; } function cryptoIntOld',
     'one copy of the unbiased draw is quietly replaced, which is a licence matter'),
    ('no playlist is empty', 'venueplay/data/musical-library.json',
     '<<ANY:"songIds": [\n>>', '"songIds": [], "wasSongIds": [\n',
     'a pack empties and a host picks a night with nothing in it'),
    ('every founding page agrees with its own code', 'venueplay/qld.html',
     '<<ALL:30 September>>', '31 September',
     'a founding page carries a date that does not exist'),
    ('no screen leaves a second code up once the host is connected',
     'venueplay/app/musical/screen.html',
     '<<ALL:hostSeen>>', 'hostSighted',
     'a screen stops hiding its pairing code and two codes are on the wall'),
    ('every link on our own pages goes somewhere', 'venueplay/index.html',
     '</body>', '<a href="/a-page-that-does-not-exist">x</a></body>',
     'a link on our own site goes nowhere'),

    # ---- the pasted Workers ----
    ('venueplay-api-FULL.js is whole', 'venueplay-backend/worker/venueplay-api-FULL.js',
     '<<EMPTY>>', '', 'the billing Worker file ends up empty'),
    ('DEPLOY-partyplay-api.js is whole', 'partyplay-backend/worker/DEPLOY-partyplay-api.js',
     '<<EMPTY>>', '', 'the built PartyPlay Worker ends up empty'),
    ('SOURCE-do-not-paste-partyplay-api.js is whole',
     'partyplay-backend/worker/SOURCE-do-not-paste-partyplay-api.js',
     '<<EMPTY>>', '', 'the PartyPlay Worker source ends up empty'),
    ('deploy build parses', 'partyplay-backend/worker/DEPLOY-partyplay-api.js',
     'async function handleJoin', 'async function handleJoin(((',
     'the file about to be pasted does not parse'),
    ('the licence library is inlined, not a marker',
     'partyplay-backend/worker/DEPLOY-partyplay-api.js',
     'const PPLicence = (function', 'const PPLicence = /*INLINE-MARKER*/ (function_',
     'the build ships a marker instead of the licence library'),
    # ASSEMBLED, NOT WRITTEN DOWN. Spelling a Stripe-shaped key out in this file
    # got the push rejected by GitHub's secret scanning, which cannot tell a
    # decoy from the real thing and should not try. The mutation builds the
    # shape at run time so the repo never contains it.
    ('no secret got baked into it', 'partyplay-backend/worker/DEPLOY-partyplay-api.js',
     "const BUILD = '",
     "const NOT_A_REAL_KEY = '" + "sk_" + "live_" + ("0" * 24) + "';\nconst BUILD = '",
     'a key is pasted into the file by accident'),

    # ---- migration numbering: needs a second file, not an edit ----
    ('VenuePlay migrations are numbered once each',
     'venueplay-backend/supabase/venueplay-17-manager-permissions.sql',
     '<<COPYTO:venueplay-backend/supabase/venueplay-17-a-second-file.sql>>', '',
     'two migrations claim the same number and one gets skipped'),
    ('PartyPlay migrations are numbered once each',
     'partyplay-backend/supabase/partyplay-01-core.sql',
     '<<COPYTO:partyplay-backend/supabase/partyplay-01-a-second-file.sql>>', '',
     'two migrations claim the same number and one gets skipped'),

    # ---- 11 Sep: the receipt email threw on every payment and nobody could tell ----
    ('billing-emails.test.js',
     'venueplay-backend/worker/venueplay-api-FULL.js',
     '+ (await vpaUpliftWarningHtml(env, invoice.customer))',
     '+ (await vpaUpliftWarningHtml(env, customer))',
     'the receipt throws a ReferenceError on every payment and the catch swallows it'),
    ('billing-emails.test.js',
     'venueplay-backend/worker/venueplay-api-FULL.js',
     "await say(res && res.ok ? 'sent' : 'not sent: Resend refused it',",
     "await Promise.resolve(res && res.ok ? 'sent' : 'not sent',",
     'a receipt sends or fails and leaves no record either way'),

    # ---- 11 Sep: the plan upgrade, which nothing had ever run ----
    # overage-charge.test.js stubs upliftPlan and counts calls to the stub, and production
    # holds zero plan_uplift rows, so the function that raises a venue's plan and moves the
    # Stripe quantity had never been executed by anything at all.
    ('plan-uplift.test.js',
     'venueplay-backend/worker/venueplay-game.js',
     "    await sbPatch(env, 'vp_venues', 'id=eq.' + enc(venue.id), { max_players: current });",
     "    // rollback removed on purpose",
     'Stripe refuses the quantity and the venue keeps a bigger plan we never billed for, for ever'),
    ('plan-uplift.test.js',
     'venueplay-backend/worker/venueplay-game.js',
     '  if (venue.pending_players != null) {',
     '  if (false) {',
     "a venue that chose a SMALLER plan for next renewal is silently pushed back up"),

    # ---- 11 Sep: a monitoring tool must not be able to fake the thing it monitors ----
    # Caused by that morning's own fix: daily-venue-audit went from one hardcoded venue
    # to the whole fleet, and it polls the route that records the screen heartbeat, so
    # one run marked seventeen screens alive whether or not a TV was switched on.
    ('screen-probe.test.js',
     'venueplay-backend/worker/venueplay-game.js',
     "if ('screen_seen_at' in v && !isProbe) {",
     "if ('screen_seen_at' in v) {",
     'the daily audit marks every screen in the fleet alive, so a black TV reads as healthy in HQ'),
    # The path the first version of this suite MISSED. The fleet does not use the
    # fallback; every screen poll goes to vp_screen_poll, which writes the heartbeat
    # inside the database where no Worker guard can reach it. The suite passed in full
    # while a probe against the deployed Worker wrote to a real venue row on staging.
    ('screen-probe.test.js',
     'venueplay-backend/worker/venueplay-game.js',
     'if (!screenPollRpcMissing && !isProbe) {',
     'if (!screenPollRpcMissing) {',
     'a probe reaches the one-trip RPC and writes the heartbeat after all'),

    # ---- 11 Sep: a browser dialog on a host console freezes the console ----
    ('no host console calls alert()',
     'venueplay/app/members/host.html',
     'hostError("No active members to draw from. Enable at least one member.")',
     'alert("No active members to draw from. Enable at least one member.")',
     'a host taps Draw on an empty draw and the console freezes until somebody taps OK'),

    # ---- 12 Sep: the two checks prove-checks itself said were unproven ----
    # A data file in the deploy directory that nothing asks for is one Cloudflare serves
    # to anyone who guesses the name. 754 MB of trivia bank went that way on 11 Sep.
    ('every deployed data file is one something reads',
     'venueplay/data/trivia-count.json',
     '<<COPYTO:venueplay/data/_nothing-reads-this.json>>', '',
     'a data file nobody asks for is served to the public from the deploy directory'),

    # The sales pages draw the venue screen BY HAND. Nothing links the two, so a redesign
    # of the real screen leaves both pages selling last month's product with nothing red.
    ('no screen has changed since the sales pages were last checked',
     'venueplay/tv.html',
     '<style>', '<style>\n  .vp-probe-restyle{color:#123456}\n',
     'the venue screen is restyled and the sales pages still show the old one'),

    # ---- 11 Sep: the gate had never parsed its own tools ----
    # song-popularity.py sat broken in the repo for a day and nothing said so, because
    # the parse sweep only read the site and the Workers. The mutation is that exact
    # fault: an apostrophe inside a single-quoted Python string.
    ('every .py in the repo parses',
     'venueplay-backend/tools/check-data.py',
     'import ', "x = 'Dean's'\nimport ",
     'a tool in this repo cannot start, and reports nothing rather than red'),

    # ---- 11 Sep: the last three suites nobody had ever broken on purpose ----
    ('phone-reconnect.test.js',
     'venueplay/play.html',
     'if(status==="CHANNEL_ERROR"||status==="TIMED_OUT"||status==="CLOSED"){',
     'if(status==="CHANNEL_ERROR"||status==="TIMED_OUT"){',
     'a phone whose channel CLOSED keeps tapping answers into a dead socket, saying Connected'),
    ('pp-host-channel.test.js',
     'partyplay/run.html',
     'if(status==="CHANNEL_ERROR"||status==="TIMED_OUT"||status==="CLOSED"){ subscribed=false; }',
     'if(status==="CHANNEL_ERROR"||status==="TIMED_OUT"){ subscribed=false; }',
     'the party host keeps sending into a closed channel and the room sees nothing'),
    ('song-excluded-acts.test.js',
     'tools/pull-from-packs.py',
     'if any(a in who for a in PULL_ARTISTS) and sid not in targets:',
     'if sid in PULL_ARTISTS and sid not in targets:',
     'the next import matches by song id and walks a banned act back into a pack'),

    # ---- 11 Sep: nothing internal in a directory Cloudflare Pages uploads ----
    # This is the fault exactly as it happened: a suite written beside the page it
    # tests, inside venueplay/, and therefore downloadable from venueplay.com.au by
    # anyone who guesses the name. Twenty-four of them were, for days, along with a
    # PartyPlay suite that printed a local path to the world. COPYTO reproduces it
    # rather than an edit, because the fault is a file being in the wrong place and
    # no edit to an existing file can express that.
    ('venueplay/ holds nothing internal',
     'venueplay-backend/app/vp-follow.test.js',
     '<<COPYTO:venueplay/app/vp-follow.test.js>>', '',
     'a suite sits in the deploy directory and is served to the public'),
    ('partyplay/ holds nothing internal',
     'partyplay-backend/lib/pp-trivia-pack.test.js',
     '<<COPYTO:partyplay/lib/pp-trivia-pack.test.js>>', '',
     'a suite sits in the deploy directory and is served to the public'),

    # And the rule those two lean on. Widened until it matches nothing, both checks
    # above would walk every file, flag none and report a tick each: a green line
    # saying the job was done. The probe is what stops that, so the probe is proven too.
    # ---- 11 Sep: the money path itself. Eight live runs at The Jolly Jess found
    # eight faults that every green suite had missed, and the suites written after
    # them had still never been broken on purpose. These three are those faults.
    ('overage-charge.test.js',
     'venueplay-backend/worker/venueplay-game.js',
     'unit_amount_decimal: String(Math.round(rateDollars * 100)),',
     'unit_amount: Math.round(rateDollars * 100),',
     'Stripe is sent a parameter it does not have and the night is billed nothing'),
    ('overage-charge.test.js',
     'venueplay-backend/worker/venueplay-game.js',
     "pending_invoice_items_behavior: 'exclude',",
     "pending_invoice_items_behavior: 'include',",
     "the night's invoice sweeps back the extras a failed payment just moved to the monthly bill"),
    ('billing-emails.test.js',
     'venueplay-backend/worker/venueplay-api-FULL.js',
     'const VPA_EXTRAS_MOVE_MAX_CENTS = 3000;',
     'const VPA_EXTRAS_MOVE_MAX_CENTS = 1;',
     'a declined $2 extra is chased on the card instead of riding the next monthly bill'),

    # ---- 12 Sep 2026: the unsubscribe that answered Done and wrote nothing.
    # The link was dead, then the link worked and the BUTTON was dead: a PATCH by
    # email matches no row for the majority of buyers, who never ticked the
    # marketing box and so were never in pp_subscribers, yet are emailed anyway.
    ('partyplay-api.test.js',
     'partyplay-backend/worker/SOURCE-do-not-paste-partyplay-api.js',
     '  if (!patched || !patched.length) {',
     '  if (false) {',
     'somebody who was never on the marketing list presses Unsubscribe, is told Done, and '
     'nothing is recorded, so the follow-up and the expiry reminder keep arriving'),

    ('partyplay-api.test.js',
     'partyplay-backend/worker/SOURCE-do-not-paste-partyplay-api.js',
     # Anchored to the unsubscribe PATCH. The bare header line appears three times.
     # Anchored to the pp_subscribers PATCH. Both the bare header line and the
     # method+header pair appear elsewhere in this Worker.
     """pp_subscribers?email=eq.' + encodeURIComponent(email), {
    method: 'PATCH',
    headers: { prefer: 'return=representation' },""",
     """pp_subscribers?email=eq.' + encodeURIComponent(email), {
    method: 'PATCH',
    headers: {},""",
     'the PATCH stops asking for the row back, so the handler cannot tell whether it matched '
     'anything and silently stops recording opt-outs for everybody not already on the list'),

    # ---- 12 Sep 2026: how long an unstarted PartyPlay code keeps, written once.
    ('the Worker asks the library for it rather than writing it again',
     'partyplay-backend/worker/SOURCE-do-not-paste-partyplay-api.js',
     # Either copy tripping it is enough, and they are the same claim.
     '<<ANY:PPLicence.UNUSED_EXPIRY_DAYS * 86400e3>>',
     '365 * 86400e3',
     'the Worker goes back to writing the expiry by hand, so changing it in the licence '
     'library stops changing when people are warned their code is about to run out'),

    ('the unused-code expiry is declared in the licence library',
     'partyplay-backend/lib/pp-licence.js',
     'var UNUSED_EXPIRY_DAYS = 365;',
     'var UNUSED_EXPIRY_DAYS_RENAMED = 365;',
     'the one place that owns how long a code keeps is renamed away, so nothing owns it'),

    # ---- 12 Sep 2026: the once-a-week rule, and when the host finds out.
    # The Worker refuses on the START route, after the QR is up and the room has
    # scanned in. Trivia warned the host up front; musical bingo never did.
    ('weekly-before-the-room.test.js',
     'venueplay/app/musical/host.html',
     '<script src="/app/vp-weekly.js"></script>\n',
     '',
     'the musical console stops loading the shared rule, so a musical host is refused at Start '
     'with the room already seated, which is the fault this was written to end'),

    ('weekly-before-the-room.test.js',
     'venueplay/app/vp-weekly.js',
     '  var RESUME_GRACE = 8 * 60 * 60 * 1000;',
     '  var RESUME_GRACE = 4 * 60 * 60 * 1000;',
     'the mirror disagrees with the Worker about the resume grace, so a host picking a night '
     'back up after a handover is warned off their own game'),

    ('weekly-before-the-room.test.js',
     'venueplay/app/trivia/host.html',
     "      G.weekHold=false;\n      bn.innerHTML='Going ahead anyway.",
     "      G.weekHold=false; bn.style.display=\"none\";\n      bn.innerHTML='Going ahead anyway.",
     'the escape hatch hides the warning again, which reads as the console saying it is fine '
     'when the Worker still refuses at Start'),

    ('weekly-before-the-room.test.js',
     'venueplay/app/musical/host.html',
     '    if (typeof VPWeekly === "undefined" || !VPWeekly || !VPWeekly.check) return;\n',
     '',
     'the guard comes off, so a shared script that fails to load throws mid-boot and takes '
     'VP.setGameActive with it: a host loses their night to save them a warning banner'),

    # ---- 12 Sep 2026: a venue's account state read before the caller was known.
    ('suspend-not-before-auth.test.js',
     'venueplay-backend/worker/venueplay-game.js',
     "    ? 'Your tab has run a bit long. Settle up on your account page and we will get your games going again.'\n    : 'Games are paused here tonight. Have a word with the staff.';",
     "    ? 'Games are paused here tonight. Have a word with the staff.'\n    : 'Games are paused here tonight. Have a word with the staff.';",
     'a host is shown the message written for a punter, so the one person who can clear a '
     'suspension is never told what it is'),

    ('suspend-not-before-auth.test.js',
     'venueplay-backend/worker/venueplay-game.js',
     "  await assertVenueActive(env, venueId, audience);\n  return Object.assign(",
     "  await assertVenueActive(env, venueId, 'host');\n  return Object.assign(",
     'requireStaff hardcodes the host wording again, which silently rewords all 36 host routes '
     'including the bingo ball and members draw, whose replies must match migration 76 byte for byte'),

    ('suspend-not-before-auth.test.js',
     'venueplay-backend/worker/venueplay-game.js',
     "  const suspended = audience === 'host'",
     "  const suspended = audience !== 'player'",
     'the host wording becomes the DEFAULT, so every unauthenticated player route starts '
     "reading out the venue's billing state"),

    # ---- 12 Sep 2026: the four game walls stopped being drawings on the sales page.
    ('demo-hermetic.test.js',
     'venueplay/app/musical/screen.html',
     '  if(!VP_DEMO) ch.subscribe(function(status){',
     '  ch.subscribe(function(status){',
     'a wall embedded in the public sales page subscribes to a venue channel, where a real '
     "game can surface, and answers tv_here, which is what HQ reads to decide a screen is alive"),

    ('demo-hermetic.test.js',
     'venueplay/app/raffle/screen.html',
     '    if(VP_DEMO) return "";',
     '    if(false) return "";',
     'the sales page frame inherits whatever venue this browser last looked at, so a real '
     "pub's branding and code appear on a marketing page"),

    ('demo-hermetic.test.js',
     'venueplay/see-a-night.html',
     'var isWall = view === "tv" || /-tv$/.test(view);',
     'var isWall = view === "tv";',
     'the four game walls go back into a scaling box, where each renders at full size with '
     'only its top-left corner inside the bezel'),

    # ---- 12 Sep 2026: the fifty player cap, enforced once and promised once.
    ('the "party is full" message is not matched on the NUMBER',
     'partyplay-backend/worker/SOURCE-do-not-paste-partyplay-api.js',
     "    if (/capped at/i.test(e.message)) {",
     "    if (/50 players/i.test(e.message)) {",
     'the friendly "this party is full" is matched on the FIGURE again, so raising the cap '
     'hands a guest a raw database constraint error at the moment the party fills up'),

    ('and the Terms promise the same number',
     'partyplay/terms.html',
     'capped at <strong>50 players</strong>',
     'capped at <strong>80 players</strong>',
     'the Terms promise a cap that is not the cap enforced, which is a promise to a paying '
     'customer that the product does not keep'),

    # ---- 12 Sep 2026: the privacy page promised three deletions and one happened.
    ('partyplay-api.test.js',
     'partyplay-backend/worker/SOURCE-do-not-paste-partyplay-api.js',
     "      const p2 = await sb(env, 'pp_album_requests?licence_id=eq.' + encodeURIComponent(l.id),",
     "      const p2 = await sb(env, 'pp_photos?id=eq.nothing-at-all&licence_id=eq.' + encodeURIComponent(l.id),",
     "guest EMAIL ADDRESSES are left in the database after a party, while privacy.html says "
     'they are deleted with everything else 30 days after it'),

    ('partyplay-api.test.js',
     'partyplay-backend/worker/SOURCE-do-not-paste-partyplay-api.js',
     "    const cutoff = new Date(Date.now() - ALBUM_KEEP_DAYS * 86400e3).toISOString();",
     "    const cutoff = new Date(Date.now()).toISOString();",
     "a guest's details are deleted the morning after the party, while the album they were "
     'told they have thirty days to download is still up'),

    # ---- 12 Sep 2026: the host console and the TV showed the database's word for a game.
    ('run.html names a game rather than printing its format',
     'partyplay/run.html',
     "esc(PPGames.name(g.format,g.title))",
     "esc(g.title||g.format)",
     'the host reads "headstails" and "truths" off their own console part way through a party'),

    ('and the TELEVISION gets the name too, not the slug',
     'partyplay/run.html',
     '      else { var _n=PPGames.name(g.format,g.title);',
     '      else { var _n=(g.title||g.format);',
     'the raw format slug goes up on the big screen in front of the whole room when a game '
     'starts, which is the half everybody sees'),

    ('every format the product offers has a name',
     'partyplay/lib/pp-games.js',
     "    draw:       { name: 'Prize draw',",
     "    draw_gone:  { name: 'Prize draw',",
     'a format loses its entry, so the prize draw falls back to "draw" on the console and on '
     'the television'),

    ('pp-guest-connection.test.js',
     'partyplay/run.html',
     '      send({t:"rollcall"});\n',
     '',
     'the host console stops asking who is in the room, so a host who RELOADS part way '
     'through a party sees "0 playing" with a full house and cannot start charades at all'),

    ('pp-guest-connection.test.js',
     'partyplay/play.html',
     '    if(m.t === "rollcall"){',
     '    if(false){',
     'the phones stop answering the roll call, which is the same fault from the other end'),

    ('the rule can tell an internal file from a page',
     'tools/check-exposure.py',
     r"\.(test\.js|spec\.js|sql|py|sh|md|bak|backup|orig|rej|map|lock|env|ini|log)$",
     r"\.(nothing-this-will-never-match)$",
     'the rule for what must never ship is widened until it flags nothing'),

    # ---- 12 Sep: PartyPlay. The unsubscribe, the guest photo, the failed email,
    #      and the four jobs that called themselves crons. ----
    # Every one of these was broken by hand and watched go red as it was written.
    ('an email links to',
     'partyplay-backend/worker/SOURCE-do-not-paste-partyplay-api.js',
     # Two emails carry this link. The check reads the SET of distinct paths out of the
     # Worker, so introducing /unsubscribed in either one trips it. Interchangeable.
     "<<ANY:site + '/unsubscribe?e='>>",
     "site + '/unsubscribed?e='",
     'the Unsubscribe link in a follow-up points at a path Pages does not have, so it '
     'answers the homepage with a 200 and the recipient is sold PartyPlay instead'),

    ('the reminder about an unused code can be stopped',
     'partyplay-backend/worker/SOURCE-do-not-paste-partyplay-api.js',
     """            '<p style="margin:10px 0 0"><a href="' + site + '/unsubscribe?e=' + encodeURIComponent(l.buyer_email) +
            '" style="color:#8A8296">Unsubscribe</a></p>'""",
     "''",
     'the expiry reminder goes back to having no way to stop it, which is where it started'),

    ('the "how was the party" follow-up can be stopped',
     'partyplay-backend/worker/SOURCE-do-not-paste-partyplay-api.js',
     """      foot: '<p style="margin:0"><a href="' + site + '/unsubscribe?e=' + encodeURIComponent(l.buyer_email) +
            '" style="color:#8A8296">Unsubscribe</a></p>'""",
     "      foot: ''",
     'the follow-up email loses its unsubscribe link, which is the half of the Spam Act '
     'that was there before the link was found to be dead'),

    # The guard on the guard: if the pattern stops matching, every link becomes
    # invisible and "none of them is broken" is true and worthless. An empty
    # Worker is the honest way to ask, because zero found must never read as zero
    # wrong.
    ('the email links could be read at all',
     'partyplay-backend/worker/SOURCE-do-not-paste-partyplay-api.js',
     '<<EMPTY>>', '',
     'the email links are read from a Worker that says nothing, and a scan that '
     'finds nothing reports every link as fine'),

    ('every email sender has been judged marketing or not',
     'partyplay-backend/worker/SOURCE-do-not-paste-partyplay-api.js',
     'async function sendNudgeEmail(env, l, daysLeft) {',
     'async function sendChopChopEmail(env, l, daysLeft) {',
     'a new email sender appears and nobody has said whether it needs an unsubscribe link'),

    # The suite. THE LABEL IS THE FILE NAME, because that is what the gate prints.
    ('partyplay-api.test.js',
     'partyplay-backend/worker/SOURCE-do-not-paste-partyplay-api.js',
     "        licence_id: l.id, object_key: key, taken_by: src.taken_by, purpose: 'game',",
     "        licence_id: l.id, object_key: key, taken_by: src.taken_by, purpose: 'album',",
     'a guest photo picked for Guess the Photo is copied but not made a game photo, so '
     '/game/photo still 404s and the television paints a broken image'),

    ('partyplay-api.test.js',
     'partyplay-backend/worker/SOURCE-do-not-paste-partyplay-api.js',
     """  if (!r.ok) {
    const e = new Error('resend ' + r.status + ': ' + String(text).slice(0, 300));
    e.status = 502;
    throw e;
  }
""",
     "",
     'nothing reads what Resend answered, so a refused email is stamped as delivered and '
     'a $50 purchase that delivered nothing reads as delivered'),

    ('partyplay-api.test.js',
     'partyplay-backend/worker/SOURCE-do-not-paste-partyplay-api.js',
     '  async scheduled(event, env, ctx) {',
     '  async notASchedule(event, env, ctx) {',
     'the Worker exports fetch and nothing else again, so a Cron Trigger can run none of '
     'the four jobs and the 30 day album deletion promise goes back to being enforced by nobody'),

    ('partyplay-api.test.js',
     'partyplay-backend/worker/SOURCE-do-not-paste-partyplay-api.js',
     '      if (off.length) { skipped++; continue; }',
     '      if (false) { skipped++; continue; }',
     'the expiry reminder is sent to somebody who has already pressed unsubscribe'),

    ('partyplay-api.test.js',
     'partyplay-backend/worker/SOURCE-do-not-paste-partyplay-api.js',
     '      if (ids.filter(x => !have[x]).length) {',
     '      if (false) {',
     'a Guess the Photo game is stored naming a photo the television cannot fetch, and '
     'the host finds out in front of the room'),
]


def gate(only_label, root):
    # --local: no network. The checks proven here are all about the files, and a
    # dozen full runs with live fetches would take longer than anyone will wait.
    r = subprocess.run([sys.executable, os.path.join(root, 'tools', 'release-check.py'), '--local'],
                       capture_output=True, text=True, cwd=root)
    out = re.sub(r'\033\[[0-9;]*m', '', r.stdout + r.stderr)
    for line in out.splitlines():
        s = line.strip()
        if s.startswith('FAIL ') and only_label in s:
            return True
    return False


def scratch():
    """A copy of the repo to break. Skips .git and the workbook backups, which are
    the bulk of it and nothing here reads them."""
    d = tempfile.mkdtemp(prefix='prove-checks-')
    dst = os.path.join(d, 'repo')
    shutil.copytree(ROOT, dst, ignore=shutil.ignore_patterns(
        '.git', 'node_modules', '*.backup-*', '__pycache__', '*.pyc'))
    return d, dst


def main():
    want = sys.argv[1] if len(sys.argv) > 1 else ''
    proven = broken = skipped = 0
    tmp, repo = scratch()
    print('\n%sPROVING THE CHECKS CAN FAIL%s' % (YEL, OFF))
    print('%s  each one is broken on purpose, in a copy at %s%s\n' % (DIM, repo, OFF))

    for label, rel, find, repl, why in MUTATIONS:
        if want and want.lower() not in label.lower():
            continue
        path = os.path.join(repo, rel)
        if find is None or not os.path.exists(path):
            print('  %s----%s %s %s(no mutation written yet)%s' % (YEL, OFF, label.ljust(52), DIM, OFF))
            skipped += 1
            continue
        before = io.open(path, encoding='utf-8').read()
        if find.startswith('<<COPYTO:'):
            # Duplicating a migration NUMBER needs a second file, not an edit.
            dest = os.path.join(repo, find[len('<<COPYTO:'):].rstrip('>'))
            io.open(dest, 'w', encoding='utf-8').write(before)
            caught = gate(label, repo)
            os.remove(dest)
            (proven, broken) = (proven + 1, broken) if caught else (proven, broken + 1)
            print(('  %sok%s   %s %s%s%s' % (GRN, OFF, label.ljust(52), DIM, why, OFF)) if caught
                  else ('  %sBLIND%s %s stayed green while %s' % (RED, OFF, label.ljust(52), why)))
            continue
        if find == '<<EMPTY>>':
            after = ''
        elif find == '<<TRUNCATE>>':
            after = before[:len(before) // 2]
        elif find.startswith('<<ANY:'):
            # Many identical occurrences on purpose; breaking any one proves the check.
            target = find[len('<<ANY:'):-2] if find.endswith('>>') else find[len('<<ANY:'):]
            if target not in before:
                print('  %s----%s %s %sthe mutation no longer applies, rewrite it%s'
                      % (YEL, OFF, label.ljust(52), DIM, OFF))
                skipped += 1
                continue
            after = before.replace(target, repl, 1)
        elif find.startswith('<<ALL:'):
            target = find[len('<<ALL:'):-2] if find.endswith('>>') else find[len('<<ALL:'):]
            if target not in before:
                print('  %s----%s %s %sthe mutation no longer applies, rewrite it%s'
                      % (YEL, OFF, label.ljust(52), DIM, OFF))
                skipped += 1
                continue
            after = before.replace(target, repl)
        elif find not in before:
            print('  %s----%s %s %sthe mutation no longer applies, rewrite it%s'
                  % (YEL, OFF, label.ljust(52), DIM, OFF))
            skipped += 1
            continue
        else:
            after = before.replace(find, repl, 1)
        if after == before:
            print('  %s----%s %s %sthe mutation changes nothing, rewrite it%s'
                  % (YEL, OFF, label.ljust(52), DIM, OFF))
            skipped += 1
            continue
        io.open(path, 'w', encoding='utf-8').write(after)
        caught = gate(label, repo)
        io.open(path, 'w', encoding='utf-8').write(before)
        if caught:
            proven += 1
            print('  %sok%s   %s %s%s%s' % (GRN, OFF, label.ljust(52), DIM, why, OFF))
        else:
            broken += 1
            print('  %sBLIND%s %s stayed green while %s' % (RED, OFF, label.ljust(52), why))

    # WHAT THE GATE RUNS THAT NOBODY HAS BROKEN YET. Asked of the gate rather
    # than counted from the list above, because a list of the checks is a second
    # copy of the checks and goes stale the moment somebody adds one.
    r = subprocess.run([sys.executable, os.path.join(repo, 'tools', 'release-check.py'), '--local'],
                       capture_output=True, text=True, cwd=repo)
    clean = re.sub(r'\033\[[0-9;]*m', '', r.stdout + r.stderr)
    labels = []
    for line in clean.splitlines():
        m = re.match(r'\s+(?:ok|FAIL)\s+(.+?)(?:\s{2,}.*)?$', line)
        if m:
            labels.append(m.group(1).strip())
    covered = [m[0] for m in MUTATIONS]
    naked = [l for l in labels if not any(c in l for c in covered)]

    shutil.rmtree(tmp, ignore_errors=True)
    print('\n  %d proven, %d BLIND, %d mutation(s) that no longer apply' % (proven, broken, skipped))
    print('  %d of the %d checks the gate runs have a mutation (%d%%)'
          % (len(labels) - len(naked), len(labels),
             100 * (len(labels) - len(naked)) // max(1, len(labels))))
    if naked:
        print('\n  %sNOT YET PROVEN. Nobody has broken these on purpose:%s' % (YEL, OFF))
        for l in naked:
            print('     %s' % l[:70])
    if broken:
        print('  %sA check that stays green while its subject is broken is not a check.%s' % (RED, OFF))
    return 1 if broken else 0


def check_mutations_still_apply():
    """Does every mutation still find the code it is meant to break? Two seconds.

    A mutation whose search string has drifted is reported by the full run as "no
    longer applies", which is honest but easy to skim past, and the full run takes
    a quarter of an hour. So a mutation can rot for weeks while the headline number
    still says a high percentage of checks are proven, and the check it was meant
    to prove has not been tested since.

    IT FOLLOWS THE SAME RULES THE REAL RUN DOES, which the first version of this did
    not, and it reported 28 healthy mutations as broken. And the <<...>> directives do
    not search for anything at all. A checker that does not model the thing it checks
    produces confident nonsense.

    TWO MATCHES IS NOT FINE, which this docstring used to claim. The real run breaks
    only the FIRST, so a find-string that matches twice is a mutation whose target is
    decided by file order rather than by its author. On 12 Sep 2026 a product fix two
    hundred lines away added an earlier match and silently re-aimed the finishGame
    mutation at endGame; the check it was meant to prove stayed green and reported
    BLIND. So a mutation that matches more than once must now SAY so, with <<ANY:...>>,
    which is a promise that the occurrences are interchangeable.

        python3 tools/prove-checks.py --list
    """
    print('\n  Does every mutation still find what it breaks?\n')
    bad = 0
    for label, rel, find, repl, why in MUTATIONS:
        f = os.path.join(ROOT, rel)
        if not os.path.exists(f):
            print('  GONE    %-56s %s' % (label[:56], rel)); bad += 1; continue
        body = io.open(f, encoding='utf-8').read()
        # <<EMPTY>>, <<TRUNCATE>> and <<COPYTO:...>> do not search for anything.
        if find in ('<<EMPTY>>', '<<TRUNCATE>>') or find.startswith('<<COPYTO:'):
            continue
        target, declared_many = find, False
        for marker in ('<<ALL:', '<<ANY:'):
            if find.startswith(marker):
                target = find[len(marker):-2] if find.endswith('>>') else find[len(marker):]
                declared_many = True
        if target not in body:
            print('  NEVER   %-56s not found in %s' % (label[:56], rel)); bad += 1; continue
        n = body.count(target)
        if n > 1 and not declared_many:
            print('  AMBIG   %-56s matches %d times in %s, so which one it breaks is decided'
                  % (label[:56], n, rel))
            print('          by file order. Anchor it, or say <<ANY:...>> if they are interchangeable.')
            bad += 1
        if target == repl:
            print('  NO-OP   %-56s replaces itself, so it changes nothing' % label[:56]); bad += 1
    if bad:
        print('\n  %d mutation(s) would be SKIPPED, so the checks they prove are not tested.' % bad)
        print('  The full run calls these "no longer apply", which reads like tidiness.')
        return 1
    print('  All %d apply. The full run will actually test something.' % len(MUTATIONS))
    return 0


if '--list' in sys.argv:
    sys.exit(check_mutations_still_apply())

sys.exit(main())
