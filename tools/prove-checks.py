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
#
# Half a Worker does not parse, so four other checks catch it before the
# wholeness check is reached. Zero bytes parses perfectly, which is the case
# that check was actually written for.
MUTATIONS = [
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
     '"songIds": [\n', '"songIds": [\n    "no-such-song",\n',
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
     'LOBBY_MAX_MS', 'LOBBY_MAX_MS_DISABLED',
     'the 60 minute lobby cap disappears'),

    ('slug-ladder.test.js',
     'venueplay-backend/worker/venueplay-api-FULL.js',
     'vpaUniqueSlug', 'vpaUniqueSlugRenamed',
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
     '"previewUrl": "https', '"previewUrl": "", "x": "https',
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
     '"license"', '"licence_dropped"',
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
     '  v_who := public.vp_host_staff(p_auth_user_id, v_draw.venue_id);',
     '  v_who := null;',
     'the staff check disappears from the one-trip draw, which is an authorisation hole not a speed-up'),
    ('vp-follow.test.js', 'venueplay/app/vp-follow.js',
     '<<ALL:root.VPFollow>>', 'root.VPFollowRenamed',
     'the follow-the-host library stops exporting itself'),
    ('musical-draw.test.js', 'venueplay/app/musical/host.html',
     'HITS_ALPHA', 'HITS_ALPHA_REMOVED',
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
     'endOtherRunningGames', 'endOtherRunningGamesRenamed',
     'the one-game-at-a-time rule is renamed away'),
    ('check-tv-watchdog.py', 'venueplay/tv.html',
     '<<ALL:tv_reload>>', 'tv_reload_disabled',
     'the screen loses the remote reload it repairs itself with'),

    # ---- the rest of the data and the rules ----
    ('cryptoInt() is the same in all', 'venueplay/training.html',
     'function cryptoInt', 'function cryptoInt(max){ return 0; } function cryptoIntOld',
     'one copy of the unbiased draw is quietly replaced, which is a licence matter'),
    ('no playlist is empty', 'venueplay/data/musical-library.json',
     '"songIds": [\n', '"songIds": [], "wasSongIds": [\n',
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

    # ---- 11 Sep: a browser dialog on a host console freezes the console ----
    ('no host console calls alert()',
     'venueplay/app/members/host.html',
     'hostError("No active members to draw from. Enable at least one member.")',
     'alert("No active members to draw from. Enable at least one member.")',
     'a host taps Draw on an empty draw and the console freezes until somebody taps OK'),

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

    ('the rule can tell an internal file from a page',
     'tools/check-exposure.py',
     r"\.(test\.js|spec\.js|sql|py|sh|md|bak|backup|orig|rej|map|lock|env|ini|log)$",
     r"\.(nothing-this-will-never-match)$",
     'the rule for what must never ship is widened until it flags nothing'),
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
    not, and it reported 28 healthy mutations as broken. Two matches is FINE, because
    the real run uses replace(find, repl, 1) and only ever touches the first. And the
    <<...>> directives do not search for anything at all. A checker that does not
    model the thing it checks produces confident nonsense.

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
        target = find
        if find.startswith('<<ALL:'):
            target = find[len('<<ALL:'):-2] if find.endswith('>>') else find[len('<<ALL:'):]
        if target not in body:
            print('  NEVER   %-56s not found in %s' % (label[:56], rel)); bad += 1; continue
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
