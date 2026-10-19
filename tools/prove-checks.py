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
    # 19 Oct 2026: Open lobby froze the live console at a venue with an earlier game still open (a native confirm()).
    ('console-in-chrome.test.py', 'venueplay/app/vp-session.js', '          askOnPage("A " + what + " is already open at this venue on another device.",', '          resolve(root.confirm("A " + what)); return; askOnPage("A " + what + " is already open at this venue on another device.",', 'Open lobby at a venue with a game still open puts up a native dialog and the console stops answering'),
    # 20 Oct 2026: the suite now waits out a SLOW machine (an idle page that answers late is not hung), so prove that
    # a page that genuinely stops, for twelve seconds of its own CPU and then carries on, is still HUNG and still red.
    ('console-in-chrome.test.py', 'venueplay/app/index.html', '  function openLobbyNow(){\n    if(blockedByHold() || drawRulesMissing()) return;', '  function openLobbyNow(){\n    var __spin=Date.now()+12000; while(Date.now()<__spin){}\n    if(blockedByHold() || drawRulesMissing()) return;', 'Open lobby freezes the console for twelve seconds and then carries on: a slow-machine allowance must not pass it'),
    # 20 Oct 2026: HQ's Cancelled list drew itself from NO history while the history was reloading.
    ('hq-lists-in-chrome.test.py', 'venueplay/app/hq.html', '    if(!S.cancelAudit) return;\n', '', 'the Cancelled list is drawn before its history has loaded, offering Mark contacted on a venue already rung'),
    ('test-one-room-one-identity.js', 'venueplay/app/vp-session.js', '          askOnPage("A " + what + " is already open at this venue on another device.",', '          resolve(root.confirm("A " + what)); return; askOnPage("A " + what + " is already open at this venue on another device.",', 'the takeover question goes back to a native confirm()'),

    # THE MIGRATION PARSE CHECK, 19 Oct 2026: the exact fault that reached Dean, a stray half-line after an INSERT.
    ('every migration file has its quotes closed, brackets matched and statements ended', 'venueplay-backend/supabase/venueplay-98-gflam-signups-admin-only.sql',
     'begin;\n\ndrop policy if exists "Auth read signups" on public.signups;',
     'begin;\n\nand mark it off as the numbers are called.\') on conflict (id) do nothing;\ndrop policy if exists "Auth read signups" on public.signups;',
     'a stray line of text, spliced in from a seed, reaches the SQL editor and stops the migration'),
    ('every migration file has its quotes closed, brackets matched and statements ended', 'touring-backend/supabase/signups-forms-insert.sql',
     'drop policy if exists "Public insert signups" on public.signups;',
     'drop policy if exists "Public insert signups on public.signups;',
     'a touring migration with a name quote left open goes to the SQL editor unread'),
    ('every migration file has its quotes closed, brackets matched and statements ended', 'venueplay-backend/supabase/venueplay-34-song-flags.sql',
     '$fn$\n;\n',
     '$fn$\n',
     'a migration ends on a statement with no ; and the next thing appended to it breaks'),
    # HELP DESK REVIEW, 19 Oct 2026: durable limits, Turnstile, alert cap, triage proof, reply secrets, typed addresses, DB clock.
    ('tickets from every form, rate limits, HQ-only reads, the report, email in, phone alerts', 'venueplay-backend/worker/venueplay-api-FULL.js',
     '    if (res && res.ok) { const v = await res.json(); if (v === true || v === false) return v; }\n',
     '',
     "the limits go back to one Worker instance's memory, and a flood spread over instances walks through"),
    ('tickets from every form, rate limits, HQ-only reads, the report, email in, phone alerts', 'venueplay-backend/worker/venueplay-api-FULL.js',
     "  return 'ip:' + (await helpSha256Hex((env.HELP_LIMIT_SALT || env.SUPABASE_SERVICE_KEY || 'vp-help') + '|' + ip)).slice(0, 32);",
     "  return 'ip:' + ip;",
     "every visitor's network address is written into the database"),
    ('tickets from every form, rate limits, HQ-only reads, the report, email in, phone alerts', 'venueplay-backend/worker/venueplay-api-FULL.js',
     "  if (!ts.ok) return json({ error: 'Please complete the check above Send, then try again.', turnstile: true }, 403);\n",
     '',
     'Turnstile is switched on and checks nothing'),
    ('tickets from every form, rate limits, HQ-only reads, the report, email in, phone alerts', 'venueplay-backend/worker/venueplay-api-FULL.js',
     '    if (!(await helpAlertAllowed(env))) return false;\n',
     '',
     'a flood of tickets sends a flood of alert emails on the account the invoices use'),
    ('tickets from every form, rate limits, HQ-only reads, the report, email in, phone alerts', 'venueplay-backend/worker/venueplay-api-FULL.js',
     '  if (!pr || (pr !== await helpTriageProof(env, device, issue.id, day) && pr !== await helpTriageProof(env, device, issue.id, helpYesterday()))) {',
     '  if (false) {',
     "answers count from devices that never opened the issue, so a script can reorder everyone's steps"),
    ('tickets from every form, rate limits, HQ-only reads, the report, email in, phone alerts', 'venueplay-backend/worker/venueplay-api-FULL.js',
     "  if (!(await helpLimit(env, 'tri:ans:' + device + ':' + step.id + ':' + day, 1, 2 * 86400))) return json({ ok: true, counted: false });\n",
     '',
     'one phone tapping the same answer again and again counts every tap'),
    ('tickets from every form, rate limits, HQ-only reads, the report, email in, phone alerts', 'venueplay-backend/worker/venueplay-api-FULL.js',
     '    if (t && t.reply_token && t.reply_token === tag[2] && t.brand === brand) {',
     '    if (t && t.brand === brand) {',
     'anyone who knows a ticket number can write onto that ticket by email'),
    ('tickets from every form, rate limits, HQ-only reads, the report, email in, phone alerts', 'venueplay-backend/worker/venueplay-api-FULL.js',
     '  const contact = mail.from;',
     '  const contact = (mail.reply_to && mail.reply_to.email) ? mail.reply_to : mail.from;',
     "a forged Reply-To decides where HQ's replies go"),
    ('tickets from every form, rate limits, HQ-only reads, the report, email in, phone alerts', 'venueplay-backend/worker/venueplay-api-FULL.js',
     "  if (t.contact_typed && g.admin.role !== 'owner' && String(g.body.confirm_to || '').toLowerCase() !== to) {",
     '  if (false) {',
     'a staff login logs a call with any address and sends brand mail to it'),
    ('tickets from every form, rate limits, HQ-only reads, the report, email in, phone alerts', 'venueplay-backend/worker/venueplay-api-FULL.js',
     '  const seen = (rows || []).reduce((m, x) => (String(x.created_at) > m ? String(x.created_at) : m), String(since));',
     '  const seen = (rows || []).reduce((m, x) => (String(x.created_at) > m ? String(x.created_at) : m), helpNow());',
     "the phone alert cursor follows the Worker's clock, and a clock that is out loses or repeats alerts"),
    ('help-desk-pages.test.py', 'venueplay/app/vp-help.js',
     '      (issue._startP || Promise.resolve()).then(function () { send({ proof: issue._proof || "" }); });',
     '      send({});',
     "the Help panel's answers stop carrying the proof, so none of them count"),
    # The Turnstile test drives the PartyPlay guest page, which loads the PartyPlay copy of the widget.
    ('help-desk-pages.test.py', 'partyplay/lib/vp-help.js',
     '          body.turnstile = tok;\n',
     '',
     'the form passes Turnstile and then forgets to send its answer, so every message is refused'),
    ('help-desk-pages.test.py', 'venueplay/app/vp-helpdesk-hq.js',
     'var body = { id: t.id, body: $("hdtReply").value }; if (confirmTo) body.confirm_to = confirmTo;',
     'var body = { id: t.id, body: $("hdtReply").value };',
     "HQ's confirm button never says which address, so a typed-in address can never be replied to"),
    ('help-seed-matches-faq.test.py', 'venueplay/data/help-faq.json',
     'Any name you like, up to 20 letters.',
     'Any name you like, up to 30 letters.',
     'the page test checks words the live database was never given'),
    # THE HELP DESK, 19 Oct 2026 (migration 106). D53 runs the Worker; help-desk-pages.test.py runs the pages.
    ('tickets from every form, rate limits, HQ-only reads, the report, email in, phone alerts', 'venueplay-backend/worker/venueplay-api-FULL.js',
     '  const free = cur.filter((s) => !s.pinned);',
     '  const free = cur.filter((s) => true);',
     'a pinned step is reordered like any other: "Ask the host" jumps to the top'),
    ('tickets from every form, rate limits, HQ-only reads, the report, email in, phone alerts', 'venueplay-backend/worker/venueplay-api-FULL.js',
     'const HELP_REORDER_MIN_TRIES = 20;',
     'const HELP_REORDER_MIN_TRIES = 2;',
     'steps are reordered on a handful of answers, before any rate means anything'),
    ('tickets from every form, rate limits, HQ-only reads, the report, email in, phone alerts', 'venueplay-backend/worker/venueplay-api-FULL.js',
     'const HELP_REORDER_MARGIN = 0.05;',
     'const HELP_REORDER_MARGIN = 0;',
     'two steps a point apart swap back and forth all week'),
    ('tickets from every form, rate limits, HQ-only reads, the report, email in, phone alerts', 'venueplay-backend/worker/venueplay-api-FULL.js',
     'function helpFlagged(s) { return s.tries >= HELP_FLAG_TRIES && helpRate(s) < HELP_FLAG_RATE; }',
     'function helpFlagged(s) { return helpRate(s) < HELP_FLAG_RATE; }',
     'a brand-new step is flagged as useless before anyone has tried it'),
    ('tickets from every form, rate limits, HQ-only reads, the report, email in, phone alerts', 'venueplay-backend/worker/venueplay-api-FULL.js',
     "  await vpaPatch(env, 'vp_help_issues', 'id=eq.' + encodeURIComponent(log.issue_id), { auto_order: false, updated_at: helpNow(), updated_by: g.admin.label });\n",
     '',
     'Undo puts the steps back and the very next answer moves them again'),
    ('tickets from every form, rate limits, HQ-only reads, the report, email in, phone alerts', 'venueplay-backend/worker/venueplay-api-FULL.js',
     "  const set = 'brand=eq.' + brand + '&audience=eq.' + audience + '&hidden=eq.false';",
     "  const set = 'brand=eq.' + brand + '&audience=eq.' + audience;",
     'a question HQ hid still shows on every phone'),
    ('tickets from every form, rate limits, HQ-only reads, the report, email in, phone alerts', 'venueplay-backend/worker/venueplay-api-FULL.js',
     "    const sr = await vpaSelect(env, 'vp_help_steps', 'id=eq.' + encodeURIComponent(b.step_id) + '&issue_id=eq.' + encodeURIComponent(issue.id) + '&select=*&limit=1');",
     "    const sr = await vpaSelect(env, 'vp_help_steps', 'id=eq.' + encodeURIComponent(b.step_id) + '&select=*&limit=1');",
     "an answer counts against any step anywhere, so one page can push another brand's steps around"),
    ('tickets from every form, rate limits, HQ-only reads, the report, email in, phone alerts', 'venueplay-backend/worker/venueplay-api-FULL.js',
     "    else if (e.kind === 'fixed') { r.solved++;",
     "    else if (e.kind === 'fixed') { r.tickets++;",
     'the report counts problems the steps solved as tickets'),
    ('tickets from every form, rate limits, HQ-only reads, the report, email in, phone alerts', 'venueplay-backend/worker/venueplay-api-FULL.js',
     "  const category = issue ? issue.category : kind === 'sales'",
     "  const category = kind === 'sales'",
     'a billing question from the steps arrives as player support, in the wrong inbox'),
    ('help-desk-pages.test.py', 'venueplay/app/vp-help.js',
     '        if (i + 1 < n) showStep(issue, i + 1); else showForm(issue);',
     '        showForm(issue);',
     '"Still not working" skips every other step and goes straight to the form'),
    ('help-desk-pages.test.py', 'venueplay/app/vp-help.js',
     '        if (!issues.length) det.open = true;',
     '        det.open = true;',
     'the FAQ opens as a wall of text over the issue list'),
    ('help-desk-pages.test.py', 'venueplay/app/vp-helpdesk-hq.js',
     '    else if (act === "undo") req = post("/admin/help/reorder/undo", { id: id });\n',
     '',
     'the Undo button in HQ does nothing'),
    ('help-desk-pages.test.py', 'venueplay/app/vp-helpdesk-hq.js',
     "'@media (max-width:700px){.hwrow{grid-template-columns:1fr}",
     "'@media (max-width:1px){.hwrow{grid-template-columns:1fr}",
     'the HQ editor on a phone cuts its own buttons off the screen'),
    ('tickets from every form, rate limits, HQ-only reads, the report, email in, phone alerts', 'venueplay-backend/worker/venueplay-api-FULL.js',
     '  const a = await vpaRequireAdmin(request, env, HELP_ADMIN_ROLES);\n  if (a.error) return { res: json({ error: a.error }, a.status) };',
     "  const a = { actorId: null, label: 'anyone', role: 'owner' };",
     'every HQ help desk route answers anyone: every ticket, every customer email, to a venue or a stranger'),
    ('tickets from every form, rate limits, HQ-only reads, the report, email in, phone alerts', 'venueplay-backend/worker/venueplay-api-FULL.js',
     "    '&venue_id=eq.' + encodeURIComponent(venueId) + '&role=in.(' + HELP_STAFF_ROLES.join(',') + ')&select=venue_id,role,display_name&limit=1');",
     "    '&role=in.(' + HELP_STAFF_ROLES.join(',') + ')&select=venue_id,role,display_name&limit=1');",
     "staff at one venue can raise tickets in any other venue's name"),
    ('tickets from every form, rate limits, HQ-only reads, the report, email in, phone alerts', 'venueplay-backend/worker/venueplay-api-FULL.js',
     'const HELP_MAX_PER_DEVICE = 3;     // ten minutes',
     'const HELP_MAX_PER_DEVICE = 30;    // ten minutes',
     'one phone can fill the desk and the staff inbox'),
    ('tickets from every form, rate limits, HQ-only reads, the report, email in, phone alerts', 'venueplay-backend/worker/venueplay-api-FULL.js',
     "  if (String(b.website || '').trim()) return json({ ok: true, ticket_no: null });\n  const brand",
     '  const brand',
     'the honeypot catches nothing, and every bot that finds the form makes tickets and emails'),
    ('tickets from every form, rate limits, HQ-only reads, the report, email in, phone alerts', 'venueplay-backend/worker/venueplay-api-FULL.js',
     'Math.round(10 * hours.reduce((s, x) => s + x.h, 0) / hours.length) / 10',
     'Math.round(10 * hours.reduce((s, x) => s + x.h, 0) / rows.length) / 10',
     "the report's average time to close is wrong, and nobody would know from looking at it"),
    ('tickets from every form, rate limits, HQ-only reads, the report, email in, phone alerts', 'venueplay-backend/worker/venueplay-api-FULL.js',
     "      const res = await fetch(s.endpoint, { method: 'POST', body: '', headers: {",
     "      const res = await fetch(s.endpoint, { method: 'POST', body: JSON.stringify(ticket), headers: {",
     "a customer's name, email and message go through Google's or Apple's push servers"),
    ('tickets from every form, rate limits, HQ-only reads, the report, email in, phone alerts', 'venueplay-backend/worker/venueplay-api-FULL.js',
     "  if (!sub || sub.token_hash !== await helpSha256Hex(token)) return json({ error: 'not allowed' }, 403);",
     "  if (!sub) return json({ error: 'not allowed' }, 403);",
     "anyone who knows a staff phone's push address can ask what tickets came in"),
    ('tickets from every form, rate limits, HQ-only reads, the report, email in, phone alerts', 'venueplay-backend/worker/venueplay-api-FULL.js',
     "  if (h['x-vp-help']) return 'one of our help desk emails';\n",
     '',
     'every staff alert copied from hello@ comes back in as a new ticket, which alerts again'),
    ('tickets from every form, rate limits, HQ-only reads, the report, email in, phone alerts', 'venueplay-backend/worker/venueplay-api-FULL.js',
     "    if ((a && a.length) || (b && b.length)) return { action: 'duplicate' };",
     '',
     'the same email delivered twice is two tickets'),
    ('tickets from every form, rate limits, HQ-only reads, the report, email in, phone alerts', 'venueplay-backend/worker/venueplay-api-FULL.js',
     '    const ppOk = helpPath && /^https:',
     '    const ppOk = /^https:',
     "PartyPlay's site can call every route on the billing Worker, not just the help desk"),
    ('tickets from every form, rate limits, HQ-only reads, the report, email in, phone alerts', 'venueplay-backend/worker/venueplay-api-FULL.js',
     "              : category === 'accounts' ? 'accounts' : 'hello';",
     "              : 'hello';",
     'an accounts reply goes from hello@, so the answer about a bill lands in the wrong inbox'),
    ('tickets from every form, rate limits, HQ-only reads, the report, email in, phone alerts', 'partyplay/lib/vp-help.js',
     '  var SUPPORT = "support@" + BRAND + ".com.au";',
     '  var SUPPORT = "support@venueplay.com.au";',
     'the two copies of the Help widget drift apart, and PartyPlay guests are sent to VenuePlay'),
    ('tickets from every form, rate limits, HQ-only reads, the report, email in, phone alerts', 'venueplay/data/help-faq.json',
     'Prizes are always claimed from the host, never the bar.',
     'Prizes are claimed from the bar — ask staff.',
     'the FAQ tells a bingo winner to claim from the bar, with a long dash'),
    ('tickets from every form, rate limits, HQ-only reads, the report, email in, phone alerts', 'venueplay/app/vp-help-sw.js',
     '  }).catch(function () { return null; });\n}',
     '  });\n}',
     'when the Worker cannot be asked, the phone shows nothing, and an iPhone switches alerts off for good'),
    ('help-desk-pages.test.py', 'venueplay/app/vp-help.js',
     '".vph-foot{text-align:center;',
     '".vph-foot{position:fixed;left:0;right:0;bottom:0;text-align:center;',
     'the Help link is pinned over the bottom of the game, on top of the BINGO button'),
    ('help-desk-pages.test.py', 'venueplay/app/vp-help.js',
     '                 phone: phone ? phone.value : "", message: m, code: roomCode(),',
     '                 phone: phone ? phone.value : "", message: m, code: "",',
     'a patron ticket arrives with no room code, so nobody knows which venue it is about'),
    ('help-desk-pages.test.py', 'venueplay/app/vp-help.js',
     '      authHeader(venueMode).then(function (h) {',
     '      authHeader(false).then(function (h) {',
     'the venue form is sent without the login, so every venue request is refused'),
    ('help-desk-pages.test.py', 'venueplay/app/vp-helpdesk-hq.js',
     "'#paneHelpdesk input[type=date]{background:var(--ink-3);",
     "'#paneHelpdesk input[type=date]{background:#ffffff;",
     'the help desk date filters are browser white in a dark HQ, the look the first version shipped with'),
    ('help-desk-pages.test.py', 'venueplay/app/vp-helpdesk-hq.js',
     '      b.hidden = !j.new;',
     '      b.hidden = true;',
     'HQ never shows how many new tickets are waiting'),
    ('help-desk-pages.test.py', 'venueplay-backend/worker/venueplay-api-FULL.js',
     "  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, helpUtf8Bytes(unsigned)));",
     "  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, helpUtf8Bytes(unsigned + '.')));",
     'the push services refuse every alert, because the VAPID signature is over the wrong bytes'),
    ('the image size limit is a named number in the Worker',
     'venueplay-backend/worker/venueplay-api-FULL.js',
     'const VPB_MAX_IMAGE_BYTES = 5 * 1024 * 1024;',
     'const VPB_MAX_IMAGE_BYTES_WAS = 5 * 1024 * 1024;',
     'the cap goes back to being a bare number written three times, and nothing can '
     'compare it to the page'),

    ('and the billing page knows the same limit', 'venueplay/app/billing.html',
     'var VP_MAX_IMAGE_BYTES = 5 * 1024 * 1024;', 'var VP_MAX_IMAGE_BYTES = 8 * 1024 * 1024;',
     'the page lets through an image the Worker will refuse, so a venue waits out the '
     'whole upload on pub wifi and is then quoted a smaller number'),

    ('and the page checks what it is about to SEND, not what was picked',
     'venueplay/app/billing.html',
     'if (dataUrlBytes(data) > VP_MAX_IMAGE_BYTES){',
     'if (file.size > VP_MAX_IMAGE_BYTES){',
     'the page goes back to judging the file that was picked, so an animated GIF, which is '
     'never shrunk, sails past and is refused at the far end'),

    ('the photo size limit is the same in the browser and the Worker',
     'partyplay-backend/lib/pp-photo.js',
     'var HARD_LIMIT = 5 * 1024 * 1024;', 'var HARD_LIMIT = 8 * 1024 * 1024;',
     'the browser sends more than the Worker will take, so a guest waits through the whole '
     'upload and gets a 413 at the end of it'),

    ('the video size limit is the same in the browser and the Worker',
     'partyplay-backend/lib/pp-video.js',
     'var HARD_LIMIT = 25 * 1024 * 1024;', 'var HARD_LIMIT = 40 * 1024 * 1024;',
     'a guest records a clip at a party, waits through the upload on party wifi, and the '
     'Worker refuses it at the end'),

    ('nothing is written to the album without a date it goes',
     'partyplay-backend/worker/SOURCE-do-not-paste-partyplay-api.js',
     # Two inserts share this line, so name the one with player.nickname on it.
     '        licence_id: player.licence_id, object_key: key, taken_by: player.nickname,\n'
     '        bytes: buf.byteLength, content_type: k.type, delete_after: deleteAfter',
     '        licence_id: player.licence_id, object_key: key, taken_by: player.nickname,\n'
     '        bytes: buf.byteLength, content_type: k.type',
     'a guest photo is written with no date it goes, so the sweep never finds it and it '
     'lives for ever while privacy.html says it went thirty days after the party'),

    # The win fanfare was silent on all eight screens for half a day because it moved into
    # vp-celebrate.js and not one page got the script tag. Nothing threw until the first
    # call, and the first call was in front of a room.
    ('every page loads the shared script it calls', 'venueplay/play.html',
     '<script src="/app/vp-celebrate.js"></script>', '',
     'a page calls VPCelebrate and never loads it, so nothing throws until the first win '
     'and the first win is in front of a room'),

    ('and it is the library as it stands now, character for character',
     'partyplay-backend/lib/pp-licence.js',
     'PLAYER_CAP', 'PLAYER_CAP_V2',
     'the licence library is edited and the Worker never rebuilt, so the deployed build '
     'runs the old copy while pp-licence.test.js tests the new one and passes'),

    # ---- 18 Sep 2026. A suite nobody runs proves nothing, and this repo had two.
    # COPYTO puts a .test.js where nothing sweeps it. tools/ is swept for .test.py only,
    # so a .test.js there is exactly the orphan this check exists to find.
    ('no suite in this repo is left unrun', 'venueplay/tv.html',
     '<<COPYTO:tools/orphan.test.js>>', '',
     'a suite is added where nothing sweeps it, so it sits in the repo proving nothing, '
     'which is how ten PartyPlay suites reported 699 passing checks for weeks'),

    # The excuse list is half the check. A name left behind after a rename excuses a suite
    # that no longer exists and hides the one that replaced it.
    ('every run-by-hand excuse still names a real suite', 'tools/release-check.py',
     "    'purge-closed-player-data.test.py':",
     "    'purge-closed-player-data-renamed.test.py':",
     'the run-by-hand list names a file that is not there any more, so a real suite could '
     'go unrun behind a stale excuse'),

    # ---- 19 Oct 2026: the Show Manager timed out adding a show, because every banner
    # ---- lived base64 inside its row and every Save re-sent them all.
    ('touring-api.test.js', 'touring-backend/worker/DEPLOY-touring-api.js',
     "        if (typeof v === 'string' && (/^data:/i.test(v) || v.length > MAX_IMAGE_REF)) {",
     "        if (false) {",
     'a picture can be saved inside a show row again, which is what timed the save out'),
    ('touring-api.test.js', 'touring-backend/worker/DEPLOY-touring-api.js',
     "    if (raw.length > MAX_SAVE_BYTES) return json(TOO_BIG, 413);",
     "    if (false) return json(TOO_BIG, 413);",
     'a save of megabytes reaches the database again'),
    ('touring-api.test.js', 'touring-backend/worker/DEPLOY-touring-api.js',
     "      const sig = Object.keys(r).sort().join(',');",
     "      const sig = 'all';",
     'rows of different shapes go up in one upsert, which PostgREST refuses outright'),
    ('touring-api.test.js', 'touring-backend/worker/DEPLOY-touring-api.js',
     "  const kind = sniffImage(bytes);",
     "  const kind = sniffImage(bytes) || { type: 'image/jpeg', ext: 'jpg' };",
     'anything at all, a web page included, can be stored in the public picture bucket'),
    ('touring-api.test.js', 'touring-backend/worker/DEPLOY-touring-api.js',
     "  const folder = url.searchParams.get('kind') === 'card' ? 'cards' : 'shows';",
     "  const folder = url.searchParams.get('kind') || 'shows';",
     'the caller chooses where in the bucket a file lands'),
    ('touring-api.test.js', 'touring-backend/worker/DEPLOY-touring-api.js',
     "    for (const a of have) people.delete(String(a.name || '').trim().toLowerCase());",
     "    for (const a of have) {}",
     'every save adds the same performers to artists again'),
    ('DEPLOY-touring-api.js carries its own fingerprint',
     'touring-backend/worker/DEPLOY-touring-api.js',
     'const MAX_IMAGE_REF = 2048;', 'const MAX_IMAGE_REF = 4096;',
     'the touring Worker was edited and never re-stamped, so /health reports a build '
     'nobody is running'),

    ('touring-manage.test.py', 'touring/manage.html',
     '    show.imgSrc = await uploadImage(f, "show");',
     '    show.imgSrc = await new Promise((res) => { const fr = new FileReader(); fr.onload = (e) => res(e.target.result); fr.readAsDataURL(f); });',
     'banners go back inside the show rows, base64, which is what timed the save out'),
    ('touring-manage.test.py', 'touring/manage.html',
     '      if (before && JSON.stringify(before) === JSON.stringify(showRow(show))) return;',
     '',
     'every Save re-sends every show, pictures and all'),
    ('touring-manage.test.py', 'touring/manage.html',
     '      if (before && before.img_src === row.img_src) delete row.img_src;',
     '',
     'changing a price re-sends a picture that did not change'),
    ('touring-manage.test.py', 'touring/manage.html',
     '  const scale = Math.min(1, IMG_MAX_W / w0, IMG_MAX_H / h0);',
     '  const scale = 1;',
     'a phone photo goes up at full size'),
    ('touring-manage.test.py', 'touring/manage.html',
     '    shows[i].suburb = p.suburb;',
     '',
     'picking a saved venue leaves the suburb blank'),
    ('touring-manage.test.py', 'touring/manage.html',
     "    tcs[i].image_url=await uploadImage(file,'card');",
     "    tcs[i].image_url=await uploadImage(file,'show');",
     'tour card pictures land among the show banners'),
    ('touring-manage.test.py', 'touring/manage.html',
     '  shows.forEach((s) => { (s.queens || []).forEach((q) => addKnown(people, q)); addKnown(people, s.host); });',
     '',
     'queens already on past shows are not offered'),
    ('the public key cannot write the tour tables', 'touring/manage.html',
     "    tcs[i].image_url=await uploadImage(file,'card');",
     "    await fetch(`${SUPABASE_URL}/storage/v1/object/tour-images/x`,{method:'POST',headers:SB_HEADERS,body:file});tcs[i].image_url='x';",
     'tour card pictures go back into the bucket under the public key'),

    ('touring-lock.test.py', 'touring-backend/supabase/lock-touring-writes.sql',
     'drop policy if exists "Public write shows" on public.shows;', '',
     'the lock leaves "Public write shows" in place, one GRANT away from anybody rewriting the listings'),
    ('touring-lock.test.py', 'touring-backend/supabase/lock-touring-writes.sql',
     'drop policy if exists "Anon upload tour-images" on storage.objects;', '',
     'anybody can still upload any file to the public tour-images bucket'),
    ('touring-lock.test.py', 'touring-backend/supabase/lock-touring-writes.sql',
     '  public.artists,\n', '',
     'the public roles keep their write grants on artists'),
    ('touring-lock.test.py', 'touring-backend/supabase/lock-touring-writes-SINGAPORE.sql',
     'drop policy if exists "Public write reviews" on public.reviews;', '',
     'the Singapore lock leaves reviews open'),

    ('touring-cards.test.py', 'touring/index.html',
     '.tc-img img{width:100%;height:auto;display:block}',
     '.tc-img img{width:100%;height:100%;object-fit:cover;display:block}',
     'the homepage tour picture is cropped top and bottom again'),
    ('touring-cards.test.py', 'touring/index.html',
     '.tc-left{padding:40px 44px;display:flex;flex-direction:column;justify-content:center;min-width:0}',
     '.tc-left{padding:40px 44px;display:flex;flex-direction:column;justify-content:flex-start;min-width:0}',
     'the tour card writing sits at the top of its half again'),
    ('touring-cards.test.py', 'touring/index.html',
     '      if(now < gl) return false;\n', '',
     'a show is listed on the homepage before its go-live time'),
    ('touring-cards.test.py', 'touring/index.html',
     '    return now <= new Date(s.show_date+"T23:59:59+10:00");',
     '    return true;',
     'a show that is over is still listed on the homepage'),
    ('touring-cards.test.py', 'touring/index.html',
     '  const TC_MAX_SHOWS = 4;', '  const TC_MAX_SHOWS = 6;',
     'the card lists every show instead of four and a link'),
    ('touring-cards.test.py', 'touring/index.html',
     '      if(!url.searchParams.has("ref")) url.searchParams.set("ref","gflamweb");',
     '      url.searchParams.set("ref","gflamweb");',
     'a ticket link that already carries a ref (an email campaign) has it overwritten'),
    ('touring-cards.test.py', 'touring/index.html',
     '  .tc-card{grid-template-columns:1fr}', '  .tc-card{grid-template-columns:1fr 1fr}',
     'on a phone the card stays two squashed columns'),

    # ---- 19 Oct 2026: every signup form was refused (42501) and three said thanks anyway.
    ('touring-signups.test.py', 'group/index.html',
     "    if(r.ok){document.getElementById('gsf')", "    if(true){document.getElementById('gsf')",
     'the group signup form says thanks when nothing was stored'),
    ('touring-signups.test.py', 'drag-bingo/drag-bingo-at-the-bowlo.html',
     ".then(function(r){if(r.ok){document.getElementById('dbsf')", ".then(function(r){if(true){document.getElementById('dbsf')",
     'the drag bingo signup form says thanks when nothing was stored'),
    ('touring-signups.test.py', 'touring/nextevent/index.html',
     'method: "POST", headers: { ...SB_HEADERS, "Prefer": "return=minimal" },',
     'method: "POST", headers: SB_HEADERS,',
     'the discount signup asks to read the row back, which the public key may not do'),
    ('touring-signups.test.py', 'touring/index.html',
     '"Prefer":"return=minimal"},body:JSON.stringify({first_name:f', '"Prefer":"return=representation"},body:JSON.stringify({first_name:f',
     'the homepage signup asks to read the row back, which the public key may not do'),
    ('touring-signups.test.py', 'touring-backend/supabase/signups-forms-insert.sql',
     'grant insert (first_name, mobile, email, postcode, state, source, signup_type)',
     'grant insert (first_name, mobile, email, postcode, source, signup_type)',
     'the discount page sends a column the public key may not fill, so its signups are refused'),
    ('touring-signups.test.py', 'touring-backend/supabase/signups-forms-insert.sql',
     "'gflam_touring', 'gflam_group', 'drag_bingo'", "'gflam_touring', 'drag_bingo'",
     'the group page signups are refused by the rule'),
    ('touring-signups.test.py', 'touring-backend/supabase/signups-forms-insert.sql',
     'revoke all on public.signups from anon;\n', '',
     'the public key keeps its leftover read grant on the signup list'),

    ('move-show-images.test.py', 'tools/move-show-images-to-storage.py',
     "    if SYDNEY_REF not in host and host != '127.0.0.1':", '    if False:',
     'the one-off picture move would run against any project it was pointed at'),
    ('move-show-images.test.py', 'tools/move-show-images-to-storage.py',
     '        if not write:\n            continue\n', '',
     'look-only mode writes to the live database'),
    ('move-show-images.test.py', 'tools/move-show-images-to-storage.py',
     "                       json.dumps({col: url}).encode(),",
     "                       json.dumps({col: url, 'venue': None}).encode(),",
     'the picture move writes columns other than the picture'),

    ('touring-api.test.js', 'touring-backend/worker/DEPLOY-touring-api.js',
     "    if (!m) return json({ error: 'not found', path: path }, 404);",
     "    if (!m) return json({ error: 'not found', path: path }, 200);",
     'an unknown path answers 200 with an error body, so anything reading the status '
     'thinks it worked'),

    # ---- 17 Sep 2026, the advertising image cap. One number, two files, which is the shape
    # ---- behind most of the faults in this repo.
    ('the advertising image cap is a named number in the Worker',
     'venueplay-backend/worker/venueplay-api-FULL.js',
     'const VPB_MAX_SLIDES = 20;', 'const VPB_MAX_SLIDES_WAS = 20;',
     'the cap goes back to being a bare number in a slice() that nobody can find when it '
     'needs changing, and nothing can compare it to the page'),


    # ---- 17 Sep 2026, eleventh pass: the copy checks, and the clock.
    ('nothing claims the bingo cards mark themselves', 'venueplay/index.html',
     'Digital cards on every phone, and a claim is checked the moment it is called.',
     'Digital cards on every phone, auto-marked as the caller goes, and a claim is checked the moment it is called.',
     'the site sells a feature the product refuses to have on purpose, so a venue buys '
     'auto-marking and gets a room full of people dabbing'),

    # welcome.html documents its own tokens in a comment at the top, so {{monthly_total}}
    # appears there first and the check strips comments before looking. The mutation landed
    # in the note and the email was untouched. That is the very trap this check's own comment
    # warns about, walked into from the other side.
    ('every merge tag in a live email gets filled in', 'venueplay/emails/welcome.html',
     '{{player_count}} players at {{player_rate}} each, {{payment_total}}.',
     '{{player_count}} players at {{player_rate}} each, {{monthly_total_inc_gst}} a month.',
     'a live email goes out with {{monthly_total_inc_gst}} printed in it where the price '
     'should be, because nothing in the Worker fills that name'),

    ('no founding page has outlived its own deadline', 'venueplay/nsw.html',
     '<<ANY:OFFER-OCT-2026>>', 'OFFER-JAN-2026',
     'the page promises a founding code that expired months ago, so either the discount '
     'runs past the date we published or a venue reads $2.50 and is charged $3'),

    ('no printed handout carries a date that can go stale', 'venueplay/leave-behind-club.html',
     'Go live the day you sign up, first payment a month later.',
     'Go live 24 October 2026, first payment 24 November 2026.',
     'a handout on a bar carries a date nobody can edit once it is printed, which is how '
     'all four of them came to promise a go-live three weeks in the past'),

    # ---- 17 Sep 2026, tenth pass: a pane that never stops loading, and a black-on-black panel.
    ('every loading line has something that will finish it', 'venueplay/app/hq.html',
     'if(pane==="billing" || pane==="usage") needMeter();',
     'if(pane==="billing") needMeter();',
     'the Usage tab sits on "Reading the meter..." for ever if it is opened first, which is '
     'the exact 12 Sep fault and is indistinguishable on screen from a slow request'),

    # "    color: var(--white);" appears four times in this file and the first is 150 lines
    # above .vp-modal, so a first-occurrence replace broke an unrelated rule and the check
    # stayed green. Anchored on the line above it instead. Eleventh time out of sixteen that
    # the mutation was wrong rather than the check.
    ('the demo panel sets its own text colour', 'venueplay/see-a-night.html',
     '    color: var(--white);\n    position: relative;\n    width: 100%;\n    max-width: 380px;',
     '    position: relative;\n    width: 100%;\n    max-width: 380px;',
     'the panel on the page every cold email points at goes back to inheriting black text on '
     'a black console, so the wordmark and four game headings are invisible while every tool '
     'that reads the DOM says they are there'),

    # ---- 17 Sep 2026, ninth pass: the buzz, which is one call site and one guard.
    ('nothing buzzes a phone except', 'venueplay/play.html',
     'function buzz(pattern){ try{ if(window.VPCelebrate) VPCelebrate.buzz(pattern); }catch(e){} }',
     'function buzz(pattern){ try{ navigator.vibrate(pattern); }catch(e){} }',
     'the phone goes back to buzzing on its own, so the demo guard in vp-celebrate.js is '
     'bypassed and a sales page vibrates in somebody\'s hand'),

    ('and it asks whether the page is a demo BEFORE it does', 'venueplay/app/vp-celebrate.js',
     '      if (isDemoPage()) return;                 // a demonstration is watched, not felt\n'
     '      var nav = root.navigator;\n'
     '      if (nav && nav.vibrate) nav.vibrate(pattern);',
     '      var nav = root.navigator;\n'
     '      if (nav && nav.vibrate) nav.vibrate(pattern);\n'
     '      if (isDemoPage()) return;                 // a demonstration is watched, not felt',
     'the guard runs after the buzz instead of before it, so the one allowed call site '
     'buzzes unconditionally and every demo page vibrates'),

    # ---- 17 Sep 2026, eighth pass: the screens.
    ('tvStatus() is the same in all', 'venueplay/app/musical/screen.html',
     'if(box) box.hidden = !!connected;', 'if(box) box.hidden = false;',
     'the musical screen keeps the Reconnecting pill up for the whole night while the other '
     'four hide it, which is five screens deciding this for themselves again'),

    ('a markup-hidden element is not made visible by its own stylesheet', 'venueplay/tv.html',
     '.tv-status[hidden]{display:none}', '.tv-status-old[hidden]{display:none}',
     'the guard goes and .tv-status sets display:flex, so the Reconnecting pill sits on the '
     'venue television all night with nothing able to hide it'),

    ('no page uses a CSS variable it never defines', 'venueplay/tv.html',
     'font-size:clamp(8px,1.1cqw,22px);color:var(--muted)}',
     'font-size:clamp(8px,1.1cqw,22px);color:var(--muted-2)}',
     'one renamed token leaves a var() with nothing behind it, and a CSS variable that is '
     'not defined kills the whole declaration silently'),

    # ---- 17 Sep 2026, seventh pass: the stamps, and a constant the Worker has to reach.
    # ---- A stamp check fails on ANY edit that is not followed by tools/stamp-workers.py,
    # ---- which is the whole point of it: an unstamped edit ships a Worker whose /health
    # ---- reports a build that is not the one running.
    ('venueplay-sms-hook.js carries its own fingerprint',
     'venueplay-backend/worker/venueplay-sms-hook.js',
     'const FIVE_MINUTES_SECONDS = 60 * 5;', 'const FIVE_MINUTES_SECONDS = 60 * 10;',
     'the Worker was edited and never re-stamped, so /health reports a build nobody is '
     'running and there is no way to tell what is deployed'),

    ('DEPLOY-partyplay-api.js carries its own fingerprint',
     'partyplay-backend/worker/DEPLOY-partyplay-api.js',
     "<<ANY:reply_to: 'hello@partyplay.com.au',>>", "reply_to: 'hello@getpartyplay.com.au',",
     'the built file was edited by hand instead of being rebuilt and re-stamped, which is '
     'exactly what made deploy-worker.py refuse PartyPlay every time until 17 Sep'),

    # Two call sites, so this has to break both: leaving one keeps the whole-file search
    # green and the mutation proves nothing.
    ('and the Worker can actually reach the constant',
     'partyplay-backend/worker/SOURCE-do-not-paste-partyplay-api.js',
     '<<ALL:PPLicence.UNUSED_EXPIRY_DAYS>>', 'UNUSED_EXPIRY_DAYS',
     'the Worker no longer asks the licence library for the expiry and refers to a name that '
     'does not exist, so unused codes are never chased at all'),

    # ---- 17 Sep 2026, sixth pass: the last three suites nobody had broken.
    ('redirect-verdict.test.py', 'tools/release-check.py',
     # Re-aimed 18 Sep: redirect_verdict takes the apex as a parameter now, so both
     # products can use it, and the literal this anchored on is gone.
     "    if loc.startswith(apex + '.'):",
     "    if loc.startswith(apex + '.evil.invalid/'):",
     'the lookalike-host rule stops firing, so a redirect to venueplay.com.au.somebody-else '
     'reads as our own site and every television follows it'),

    ('cancel-emails.test.js', 'venueplay-backend/worker/venueplay-game.js',
     'status=eq.active&suspended_reason=eq.ending', 'status=eq.active&suspended_reason=eq.ended',
     'the nightly sweep finds nobody, so a venue that cancelled is never ended and never gets '
     'its last email, and keeps being billed'),

    # ---- 17 Sep 2026, fifth pass: the PartyPlay game names, which a host reads off their
    # ---- own console mid-party and which run.html sends up on the television.
    ('the game names live in lib/pp-games.js', 'partyplay/lib/pp-games.js',
     "    charades:   { name: 'Charades',               icon: '\U0001f3ad' },\n"
     "    guesswho:   { name: 'Who am I?',              icon: '\U0001f914' }",
     "    charades:   { icon: '\U0001f3ad' },\n"
     "    guesswho:   { icon: '\U0001f914' }",
     'two games have an icon and no name, so both fall back to their slug and the room '
     'reads "charades" and "guesswho" off the telly'),

    ('host.html loads the shared names', 'partyplay/host.html',
     '/lib/pp-games.js', '/lib/pp-games-old.js',
     'PPGames is undefined on the build page, so every tile falls back to its slug'),

    ('run.html loads the shared names', 'partyplay/run.html',
     '/lib/pp-games.js', '/lib/pp-games-old.js',
     'PPGames is undefined on the screen the host actually runs the night from, which is '
     'the exact 12 Sep fault'),

    # The first half of this check ("name:PPGames.name(" is present) matches eleven times,
    # so breaking one leaves ten and the check stays green. The half that can fail is the
    # one that forbids a second hardcoded list, which is the drift it was written for.
    ('host.html takes its names from the same place, so they cannot drift', 'partyplay/host.html',
     'charades:   { icon:PPGames.icon("charades"), name:PPGames.name("charades")',
     'charades:   { icon:"\U0001f3ad", name:"Charades"',
     'a second list of the same names starts up in host.html, which is how the first one '
     'drifted away from run.html and put a slug on the television'),

    # ---- 17 Sep 2026, fourth pass: PartyPlay's three privacy promises.
    # ---- All three checks were whole-file word searches, so they could not fail. The gate
    # ---- was tightened first (scoped to runPhotoSweep, and a DELETE aimed at that table in
    # ---- the same statement), and only then could these be written.
    ('the album keep window is written once, in the Worker', 'partyplay-backend/worker/SOURCE-do-not-paste-partyplay-api.js',
     'const ALBUM_KEEP_DAYS = 30;', 'const ALBUM_KEEP_DAYS_WAS = 30;',
     'the one place the keep window is written has gone, so the code and the privacy page '
     'can drift apart with nothing tying them together'),

    ('and the privacy page promises the same number of days', 'partyplay-backend/worker/SOURCE-do-not-paste-partyplay-api.js',
     'const ALBUM_KEEP_DAYS = 30;', 'const ALBUM_KEEP_DAYS = 45;',
     'the page promises 30 days and the sweep keeps 45, so we hold guest photos and email '
     'addresses for a fortnight longer than we told them'),

    ('the retention sweep is still in the Worker', 'partyplay-backend/worker/SOURCE-do-not-paste-partyplay-api.js',
     'async function runPhotoSweep(env) {', 'async function runPhotoSweepOld(env) {',
     'the job that keeps all three privacy promises is no longer the one the cron calls'),

    ('the album are actually deleted, not just promised', 'partyplay-backend/worker/SOURCE-do-not-paste-partyplay-api.js',
     "await sb(env, 'pp_photos?id=eq.' + r.id, { method: 'DELETE' });",
     "await sb(env, 'pp_photos?id=eq.' + r.id, { method: 'PATCH' });",
     'the photo rows are read and left where they are, so an album the page said was gone '
     'thirty days ago is still there'),

    ("the guests' nicknames are actually deleted, not just promised", 'partyplay-backend/worker/SOURCE-do-not-paste-partyplay-api.js',
     "'pp_players?licence_id=eq.' + encodeURIComponent(id),\n"
     "        { method: 'DELETE', headers: { prefer: 'return=representation' } });",
     "'pp_players?licence_id=eq.' + encodeURIComponent(id),\n"
     "        { headers: { prefer: 'return=representation' } });",
     'guest nicknames are never deleted, which is the exact fault found on 12 Sep and the '
     'one the old whole-file check could not have caught'),

    ("the guests' email addresses are actually deleted, not just promised", 'partyplay-backend/worker/SOURCE-do-not-paste-partyplay-api.js',
     "'pp_album_requests?licence_id=eq.' + encodeURIComponent(id),\n"
     "        { method: 'DELETE', headers: { prefer: 'return=representation' } });",
     "'pp_album_requests?licence_id=eq.' + encodeURIComponent(id),\n"
     "        { headers: { prefer: 'return=representation' } });",
     "a finished party's guest email addresses stay in the database for ever while "
     'privacy.html says they went thirty days after the night'),

    ('the sweep removes guest rows, not only picture rows', 'partyplay-backend/worker/SOURCE-do-not-paste-partyplay-api.js',
     "'pp_players?licence_id=eq.' + encodeURIComponent(id),",
     "'pp_players?id=eq.' + encodeURIComponent(id),",
     'the sweep clears one row keyed by the wrong column instead of the whole party, so '
     'almost every guest is left behind and the run still reports success'),

    # ---- 17 Sep 2026, third pass: the test suites nobody had ever broken.
    # ---- Each mutates the file the suite actually reads, so a green suite over a broken
    # ---- subject is impossible. That exact shape has bitten this repo twice.
    # This suite injects its OWN httpError, so breaking the Worker's copy proves nothing.
    # What it really drives is verifyJwtHS256 up to the crypto check. Break the catch that
    # turns a rubbish token into a sign-in problem and it is the 12 Sep fault again, exactly.
    ('token-refusal.test.js', 'venueplay-backend/worker/venueplay-game.js',
     "  } catch (e) {\n    throw httpError(401, 'Malformed token');\n  }",
     "  } catch (e) {\n    throw httpError(500, 'Something went wrong');\n  }",
     'a corrupted session is answered with "something went wrong" instead of "sign in again", '
     'so a host is told the product is broken when they just need to sign in'),

    ('venue-timezone.test.js', 'venueplay-backend/worker/venueplay-api-FULL.js',
     "case 'NSW': case 'ACT': return 'Australia/Sydney';", "case 'NSW': case 'ACT': return 'Australia/Darwin';",
     'a NSW venue is put on the wrong clock, so its last night ends at the wrong hour'),

    ('pp-tv-layout.test.js', 'partyplay/tv.html',
     'max-width:24ch;margin-inline:auto', 'max-width:24ch',
     'a capped block on the telly stops centring itself, which is the off-centre subtitle this '
     'suite was written for'),

    # The suite drives the REAL replayState out of the host page, so break that, not a string.
    # My first attempt mutated a sentence on the phone page that the suite quotes in a comment
    # and does not assert on, and the text was not even there any more. A mutation aimed at the
    # wrong thing is a check nobody is proving.
    ('trivia-catchup.test.js', 'venueplay/app/trivia/host.html',
     'var to = pid ? function(o){ o.to = pid; gsend(o); } : send;',
     'var to = send;',
     'a phone that joins mid-question is caught up by broadcasting to the whole room instead of '
     'answering the one phone, so every other player sees somebody else\'s catch-up'),

    # ---- 17 Sep 2026, second pass: checks that had never been broken on purpose.
    # ---- Each one guards a fault that has actually happened in this repo, which is exactly
    # ---- why leaving them unproven was the wrong gap to have.
    # BALANCED ON PURPOSE, and it must stay that way. The first version of this mutation put
    # everything on one line and left an unbalanced brace: the check went red, but so would the
    # parse check, so it proved nothing about THIS check. The replacement below keeps the file
    # parsing, so the only thing that can turn red is the detector itself. It also plants the
    # declaration as the SECOND statement in the block rather than the first, which is the shape
    # the detector was blind to until it was widened on 17 Sep 2026.
    ('every function is declared where it will actually be bound',
     'venueplay/app/vp-screen-router.js',
     '      var tries = 0, retry = null, c = null;',
     '      var tries = 0, retry = null, c = null;\n      if (tries === 0) {\n        var noise = 1;\n'
     '        function _mutStray() { return 1; }\n      }\n      _mutStray();',
     'a function is declared inside a block and called outside it, which is the Annex B fault '
     'that blinded a live venue TV for a whole day while every other check stayed green'),

    ('no consent box is ticked from a script',
     'venueplay/play.html',
     '''        l.innerHTML='<input type="checkbox" id="xOptin"> <span>I am 18 or over. Keep me posted on what is on at the venue</span>';''',
     '''        l.innerHTML='<input type="checkbox" id="xOptin"> <span>I am 18 or over. Keep me posted on what is on at the venue</span>'; l.querySelector("input").checked = true;''',
     'the join screen opt-in arrives ticked by a line of script, the markup reads unticked, '
     'and the Worker faithfully records consent nobody gave (the audit of 20 Sep 2026 did '
     'exactly this and the gate stayed green)'),

    ('no consent box is pre-ticked',
     'venueplay/nsw.html',
     '<input type="checkbox" id="vp-marketing">',
     '<input type="checkbox" id="vp-marketing" checked>',
     'a marketing consent box is ticked for the venue before they have agreed to anything'),

    ('the player cap is enforced by a database trigger',
     'partyplay-backend/supabase/partyplay-01-core.sql',
     'capped at ', 'capped to ',
     'nothing in the database stops a 200 person party on a 50 player licence'),

    ('and the licence library states the same number',
     'partyplay-backend/lib/pp-licence.js',
     'PLAYER_CAP:', 'PLAYER_CAP_WAS:',
     'the library and the database disagree about how many players a licence allows'),

    ('every console says it is there, and only a lobby times out fast',
     'venueplay/tv.html',
     'var idleLobby = (tvMode==="bingo" && state && state.phase==="lobby");',
     'var idleLobby = (tvMode!=="ads");',
     'a bingo game being played is pulled off the wall after six minutes of quiet'),

    # ---- 17 Sep 2026: the nine checks added the day the billing, player-data and isolation
    # ---- audit was worked through. Every one of these was broken by hand and watched go red
    # ---- as it was written, and the commit for each says so. They are written down here so
    # ---- that stays true tomorrow, when nobody remembers doing it.
    ('adding a venue charges a month and credits it straight back',
     'venueplay-backend/worker/venueplay-api-FULL.js', 'if (!reviving && aAdj && aAdj.kind', 'if (aAdj && aAdj.kind',
     'a venue that comes back gets a SECOND free month, so the month is farmable by cancelling and re-adding'),
    ('one email, one bill, and the promised free month',
     'venueplay-backend/worker/venueplay-api-FULL.js', 'const live = sameEmail.filter(function (a) { return !!a.stripe_subscription_id; })[0];',
     'const live = null;',
     'one email opens a second Stripe subscription, billed in full, that the venue cannot see to cancel'),
    ('an unsubscribe keeps them off the marketing list',
     'venueplay-backend/worker/venueplay-api-FULL.js', 'if (unsub[key]) { heldBack++; continue; }', '',
     'somebody who asked us to stop is handed straight back on the next marketing list'),
    ('no join can write player data the venue never switched on',
     'venueplay-backend/worker/venueplay-game.js', 'if (cfg.collect_email && b.email != null)', 'if (b.email != null)',
     'a join writes a player email for a venue that collects none of it'),
    ('player-data permission needs an explicit tick, in every copy',
     'venueplay-backend/worker/venueplay-api-FULL.js', '<<ALL:players_optin: p.players_optin === true,>>', 'players_optin: p.players_optin !== false,',
     'every manager is handed the venue customer list by default again'),
    ('anything a venue may collect, it may also download',
     'venueplay-backend/worker/venueplay-api-FULL.js', "VENUE_RE.test(v.name || '')) || domainLooksLikeVenue;", "VENUE_RE.test(v.name || ''));",
     'a venue allowed to collect its customers is refused its own list back'),
    ('held-back opt-ins are counted and reported, never silent',
     'venueplay-backend/worker/venueplay-api-FULL.js', 'count: out.length, held_unverified: held };', 'count: out.length };',
     'a venue sees an empty file and never learns rows are being held back'),
    ('closed venues lose their player details, and nobody else does',
     'venueplay-backend/worker/venueplay-game.js', 'const RETENTION_DAYS = 90;', 'const RETENTION_DAYS = 9;',
     'player details are deleted 81 days before the privacy page says they will be'),
    ('permissions are read per account, most restrictive wins',
     'venueplay-backend/worker/venueplay-api-FULL.js', "'&venue_id=in.(' + scopeIds.map(encodeURIComponent).join(',') + ')' +", "'' +",
     'one account restrictions bleed onto another account the same person works at'),

    # ---- 15 Sep 2026: four faults found by playing PartyPlay on all three surfaces,
    # ---- and one check that was green while the fault it named sat underneath it.
    # ---- Each of these was broken by hand and watched go red as it was written.
    # ---- Written down here so that stays true tomorrow.

    ('pp-guest-connection.test.js',
     'partyplay/play.html',
     "      CH = null; GW = null; GM = null;\n",
     "",
     'a phone that had played charades or who am I swallowing every television caption for the rest of the night'),

    ('pp-run-games.test.js',
     'partyplay/run.html',
     "    if(players.length < 2){ paintHeads(); return; }\n",
     "",
     'heads or tails opening on "Winner: Sam" with one phone in the room, before a coin has been flipped'),

    ('pp-run-games.test.js',
     'partyplay/run.html',
     '    send({t:"board", title:"Who spotted the lies", rows:tb.slice(0,10)});',
     '    send({t:"lobby"});',
     'two truths ending with the join code back on the television and nobody told who spotted the lies'),

    ('pp-run-games.test.js',
     'partyplay/run.html',
     '      try { send({t:"lobby"});\n            send({t:"big", text:"That is a wrap", sub:"Thanks for coming"}); } catch(e){}\n',
     '',
     'the party running out of time and the host tablet being the only thing that knows, while the wall and every phone hold their last screen for ever'),

    ('pp-album-page.test.js',
     'partyplay/album.html',
     "    return Math.round((b - a) / 86400000);",
     "    return Math.ceil((Date.parse(iso)-(nowMs==null?Date.now():nowMs))/86400000);",
     'the album promising 30 days on the privacy page and printing "31 days away" next to the date it prints itself'),

    ('no ternary picks between two identical strings',
     'partyplay/run.html',
     '            sub: right.length ? right.length + " got it" : "Nobody got that one"});',
     '            sub: right.length+(right.length===1?" got it":" got it")});',
     'a ternary choosing between two identical strings, which reads as a decision and is not one, and which printed "0 got it" on the wall'),

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
     '    else if(G.status==="running" && G.lastWins.length){ b.disabled=true; b.textContent="Winner confirmed: keep playing or finish, below"; }',
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
    /* AND SOMEBODY''',
     '    /* AND SOMEBODY',
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
     "    if (!(age > VPA_EVENT_STALE_MS)) return 'busy';",
     "    return 'busy';",
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

    ('no em dashes in copy',
     'venueplay/emails/welcome.html',
     'Welcome to VenuePlay.</h1>',
     'Welcome to VenuePlay — your first night is close.</h1>',
     'an em dash in the first email a paying customer reads, which no rule used to read at all'),

    ('never "roster" in copy',
     'venueplay/emails/welcome.html',
     'Welcome to VenuePlay.</h1>',
     'Welcome to VenuePlay. Upload your roster to get started.</h1>',
     'the word Dean banned from every screen ships in the welcome email'),

    ('a winner is sent to the host, never the bar',
     'venueplay/app/vp-feedback.js',
     "Thanks, that helps the venue",
     "Thanks, collect your prize from the bar",
     'a shared script sends a winner to the bar and the .html-only rule cannot see it'),

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
     "  return json({ draw_id: row.id, tablet_fallback:", "  return json({ draw_id: row.id, draw_order: row.draw_order, tablet_fallback:",
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
    # NAMED AS THE GATE NAMES IT TODAY. This entry said 'the build is this source, not an older
    # one', which is what the check was called before it was relaxed to let the build carry its
    # own fingerprint. prove-checks matches on the NAME, found nothing, and reported the check as
    # BLIND. It is not: applying this exact mutation by hand turns it red with a full
    # explanation. So the meta-check was crying wolf about a healthy check, which is the same
    # disease it exists to cure, and a meta-check people learn to ignore is worse than none.
    # Caught 17 Sep 2026. If you rename a check, rename it here in the same commit.
    ('the build is at least as new as this source',
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
     "const rows = await sbGetAll(env, 'vp_venues',\n    'slug=not.is.null&select=id,slug,join_code,status&order=id.asc');",
     "const rows = await sbGet(env, 'vp_venues', 'slug=not.is.null&select=id,slug,join_code,status&limit=1000');",
     'the venue-code map reads one page again, so venues past it stop working'),
    # 8 Sep: the TV, the console and the table talkers all use a HASH of the slug
    # as the venue code; the owner can change the ISSUED code. Drop the fallback
    # that lets the hash resolve and Change code blanks the venue's television.
    ('venue-channel.test.js', 'venueplay-backend/worker/venueplay-game.js',
     'const derived = _vcHashMap[code];',
     'const derived = null;',
     'an owner presses Change code and the venue TV says "not linked to an account" and forgets its venue'),
    # The Mini Bar, 10 Oct 2026: a session opens on the venue's own code, so the phone's
    # "same code means bingo" stop kept every phone off the TV's QR on the bingo page.
    ('venue-channel.test.js', 'venueplay/play.html',
     'if(!d.live || !d.join_code) return;',
     'if(!d.live || !d.join_code || d.join_code===code) return;',
     'phones off the TV QR sit on the bingo page all through a trivia or musical night'),
    # 14 Oct 2026 break test. The 4h sign-out on the pages that hold opt-in data.
    ('shift-timer.test.js', 'venueplay/app/billing.html',
     '<script>if(window.VP && VP.guardShift) VP.guardShift();',
     '<script>if(false) VP.guardShift();',
     'a login on the billing page (which downloads the opt-in list) never expires'),
    ('shift-timer.test.js', 'venueplay/app/vp-session.js',
     '    if (_shiftSignOutOnly) { finish(); return; }\n',
     '',
     'a billing tab timing out on the bar tablet closes the night the console is running'),
    # A body of `null` reached every game handler and answered 500.
    ('test-body-reader.js', 'venueplay-backend/worker/venueplay-game.js',
     "if (!b || typeof b !== 'object' || Array.isArray(b)) throw httpError(400, 'Invalid or missing JSON body');",
     "",
     'a null or array body crashes /join, /session and nine more with a 500'),
    # One night listed four or five times on the Account page and HQ.
    ('nights-dedup.test.js', 'venueplay-backend/worker/venueplay-api-FULL.js',
     "    return !windows.some((w) => t >= w[0] && t <= w[1]);",
     "    return true;",
     'every game report is listed again beside its own session, one night as five cards'),
    # The short console link ran a console at another venue.
    ('test-console-venue-from-link.js', 'venueplay/app/vp-session.js',
     '          if (p && p.indexOf("=") < 0 && !SETTINGS[p.toLowerCase()]) m = [p, p];',
     '',
     '/app/musical/host?test-charlie quietly runs the night at a different venue'),
    # 14 Oct 2026: TV and musical faults found by playing.
    ('test-screens-14-oct.js', 'venueplay/tv.html',
     "                       volume:1 };",
     "                       };",
     'after End game the TV bounces back to a dead musical join screen for an hour'),
    ('test-screens-14-oct.js', 'venueplay/app/vp-screen-router.js',
     '          if (m.fmt && m.fmt !== game) return;',
     '',
     'a musical game starting drops the TV to the ads for twenty seconds'),
    ('test-screens-14-oct.js', 'venueplay/app/musical/host.html',
     'o.fmt="musical"; obj=o;',
     'obj=o;',
     'musical traffic on the shared channel reads as bingo to the TV and the phones'),
    ('test-screens-14-oct.js', 'venueplay/app/musical/screen.html',
     '    if(_pendingSong && all.length && all[all.length-1]===_pendingSong.title) all=all.slice(0, -1);',
     '',
     'the TV prints the hidden song under the question mark, on every song'),
    ('test-screens-14-oct.js', 'venueplay/app/musical/host.html',
     "    var no=/^\\d{1,5}$/.test(_raw) ? parseInt(_raw,10) : NaN;",
     "    var no=parseInt(_raw.replace(/\\D/g,''),10);",
     'a typo in Check card checks card 1 and adds a billable player'),
    ('test-screens-14-oct.js', 'venueplay/tv.html',
     '        BAD_IMG[u]=1;',
     '',
     'a slide with a missing picture paints a black wall for its whole turn'),
    # 14 Oct 2026: room chatter and PartyPlay holds.
    ('test-room-chatter-14-oct.js', 'venueplay/play.html',
     '    if(m.t==="rollcall"){',
     '    if(m.t==="rollcall" || m.t==="host_here"){',
     'every phone re-joins on every 30s heartbeat: 74 broadcasts a minute on an idle game'),
    ('test-room-chatter-14-oct.js', 'venueplay/app/index.html',
     '    if(m && m.hello && Date.now()-_lastHelloReplay>3000){',
     '    if(m && m.hello){',
     'one forged TV hello makes the bar tablet sign and broadcast the whole game on demand'),
    ('test-room-chatter-14-oct.js', 'venueplay/tv.html',
     'if(m.t==="host_here" || Date.now()-lastTvHereAt>10000){',
     'if(true){',
     'the TV answers every host message, to every phone in the room'),
    ('test-room-chatter-14-oct.js', 'venueplay/app/index.html',
     '      if(gameOpenHere()) sendState();',
     '      sendState();',
     'a second tablet merely open on bingo puts "Playing for the prize" on the wall mid-game'),
    ('test-room-chatter-14-oct.js', 'partyplay/play.html',
     '_ppSend({ t:"truthpick", name:sv.nickname',
     '_ppSend({ t:"truthvote", name:sv.nickname',
     'in two truths and a lie only the first guest to vote gets to vote'),
    ('test-one-room-one-identity.js', 'venueplay/app/trivia/host.html',
     '      apiPost("/session",{ venue_id:G.venueId, format:"trivia" }).catch(function(){});\n',
     '',
     'a trivia lobby re-opened after a bingo takeover leaves phones on the bingo page until round one'),
    ('test-screens-14-oct.js', 'venueplay/tv.html',
     '        else if(idleBingo && onAir(m) && m.t!=="state") onGameMode(game, true);',
     '',
     'a TV reloaded beside an open bingo lobby shows the bingo join screen through a whole trivia round'),
    # 14 Oct fix round: platform.
    ('test-platform-15-oct.js', 'venueplay/tv.html', 'setVenueName("Tugun Bowls Club");', 'setVenueName("The Local");', 'the demo TV names a different venue from the other demo screens'),
    ('test-platform-15-oct.js', 'venueplay/app/musical/screen.html', 'var demoLogo="/logos/venue-tugun-bowls.png";', 'var demoLogo="/logos/venue-the-local.png";', 'the musical bingo demo wall shows a logo file that is not on the site'),
    ('test-platform-15-oct.js', 'venueplay/see-a-night.html', '/logos/ad-slides/tugun-tuesday.jpg', '/logos/ad-slides/demo-tuesday.jpg', 'the sales page shows a broken picture where a demo slide should be'),
    ('test-platform-15-oct.js', 'venueplay/app/vp-pixel.js', "  if (typeof window.vpWhenHuman !== 'function') return;\n  window.vpWhenHuman(function () {", "  (function (f) { f(); })(function () {", 'the Meta pixel fires on page load again, so every mail scanner and crawler is a Meta visitor'),
    ('test-platform-15-oct.js', 'venueplay/app/vp-analytics.js', '    waiting.push(fn);\n  }', '    try { fn(); } catch (e) {}\n  }', 'the shared gate stops waiting for a person, so both tags count every scanner that opens a link'),
    ('test-platform-15-oct.js', 'venueplay/404.html', '<meta name="robots" content="noindex,nofollow">', '', 'the not-found page can be indexed by search engines'),
    ('test-platform-15-oct.js', 'venueplay/_redirects', '/offer-oct  /nsw  200', '/offer-oct  /nsw-retired  200', 'a link already in inboxes now lands on the not-found page'),
    ('test-platform-15-oct.js', 'venueplay/sitemap.xml', '<loc>https://venueplay.com.au/</loc>', '<loc>https://www.venueplay.com.au/</loc>', 'the sitemap sends search engines to an address that only redirects'),
    ('test-platform-15-oct.js', 'venueplay/llms.txt', 'https://venueplay.com.au/#offer', 'https://venueplay.com.au/pricing', 'llms.txt points assistants at a pricing page that does not exist'),
    ('test-platform-15-oct.js', 'venueplay/training.html', '<meta name="robots" content="noindex,nofollow">', '', 'the training simulator can turn up in search results (was the Jag check page, gone 19 Oct 2026)'),
    ('test-platform-15-oct.js', 'venueplay/leave-behind.html', '.sheet{width:auto;min-height:0;margin:0;padding:18px 16px 20px;box-shadow:none}', '.sheet{min-height:0;margin:0;padding:18px 16px 20px;box-shadow:none}', 'the bowls club flyer scrolls sideways on a phone again'),
    ('test-platform-15-oct.js', 'venueplay/unsubscribe.html', '    $("em").value = linkAddr;\n', '    $("em").value = linkAddr; record(linkAddr, "link");\n', 'opening an unsubscribe link unsubscribes the person, so a mail scanner does it for them'),
    ('test-platform-worker-15-oct.js', 'venueplay-backend/worker/venueplay-game.js', '    if (!got || !env.SUPABASE_SERVICE_KEY) return false;', '    if (!got || !env.SUPABASE_SERVICE_KEY) return true;', '/health hands any stranger the venue count and the signing figures again'),
    ('test-platform-worker-15-oct.js', 'venueplay-backend/worker/venueplay-game.js', '    if (got.length !== want.length) return false;', '    if (got.length < want.length) return false;', 'any string that merely STARTS with the health key unlocks the private half'),
    ('test-platform-worker-15-oct.js', 'venueplay-backend/worker/venueplay-game.js', '  const detail = await healthDetailAllowed(request, env);', '  const detail = true;', '/health shows its counts to everybody'),
    ('test-platform-worker-15-oct.js', 'venueplay-backend/worker/venueplay-game.js', "  if (!reporter) return json({ error: 'Sign in to report a game.' }, 401);\n  const venueId = await venueByCode(env, b.code);\n  if (!venueId) return json({ error: 'That venue is not yours to report on.' }, 403);", "  const venueId = await venueByCode(env, b.code);\n  if (!venueId) return json({ ok: false });\n  if (!reporter) return json({ error: 'Sign in to report a game.' }, 401);", '/report answers a stranger differently for a real venue code and a made-up one, so codes can be tested'),
    ('pp-health-private.test.js', 'partyplay-backend/worker/SOURCE-do-not-paste-partyplay-api.js', '        admins_ok: admins === null ? null : admins > 0,', '        admins_ok: admins === null ? null : admins > 0,\n        admins,', 'PartyPlay /health tells anybody how many admins there are again'),
    # 14 Oct fix round: trivia.
    ('test-trivia-15-oct.js', 'venueplay/app/vp-fit.js', 'if (R[j].l < A.r + gap && R[j].r > A.l - gap) {', 'if (false) {', 'the wall is fitted to the screen only and runs under the JOIN NOW card again'),
    ('test-trivia-15-oct.js', 'venueplay/app/vp-fit.js', 'var avoids = layer.hasAttribute("data-fit-self") ? [] : avoidRects();', 'var avoids = avoidRects();', 'the Punters Reckon board is shrunk on top of stopping above the card'),
    ('test-trivia-15-oct.js', 'venueplay/app/trivia/screen.html', 'id="tvJoinCorner" data-fit-avoid>', 'id="tvJoinCorner">', 'the JOIN NOW card covers the 4th and 5th leaderboard rows'),
    ('test-trivia-15-oct.js', 'venueplay/app/trivia/screen.html', 'el.id="venueLogo"; el.setAttribute("data-fit-avoid","");', 'el.id="venueLogo";', 'a two-line question runs under the venue logo'),
    ('test-trivia-15-oct.js', 'venueplay/app/trivia/host.html', 'apiPost("/host/trivia/board",{ game_id:gid })', 'apiPost("/host/reveal",{ game_id:gid })', 'a console reloaded mid-question reveals the open question to refill its board'),
    ('test-trivia-15-oct.js', 'venueplay/app/trivia/host.html', 'readBoard();   // the scores so far, WITHOUT', 'void 0;   // the scores so far, WITHOUT', 'a console reloaded mid-question has an empty Leaderboard panel until the next reveal'),
    ('test-trivia-15-oct.js', 'venueplay/app/trivia/play.html', 'if(e && e.status===401 && !healed){', 'if(false){', 'a healed phone shows CORRECT! 0 and its old total and place'),
    ('test-trivia-15-oct.js', 'venueplay/app/trivia/play.html', 'if(!answered && last.answered===true && last.qseq!=null', 'if(false && last.answered===true && last.qseq!=null', 'a re-joined phone says NO ANSWER for a question it answered'),
    ('test-trivia-15-oct.js', 'venueplay/app/trivia/play.html', 'var _unsure = !answered && (!P.q || P.q.restored===true || !!m.to);', 'var _unsure = false;', 'a phone that came back into the question never asks the server whether it answered'),
    ('test-trivia-15-oct.js', 'venueplay/app/trivia/play.html', 'paint(true, null); };', 'paint(true, 0); };', 'a phone that cannot reach the server shows +0 for a right answer'),
    ('test-trivia-15-oct.js', 'venueplay/app/trivia/play.html', 'restored:(typeof m.endsAt!=="number" || !!m.to)', 'restored:false', 'a phone restored into a question is treated as if it watched it live'),
    ('test-trivia-15-oct.js', 'venueplay/app/trivia/host.html', 'if(m.fmt!=="trivia") return;', 'if(false) return;', 'a bingo phone answering the rollcall is counted as a trivia team (Bingo Betty)'),
    ('test-trivia-15-oct.js', 'venueplay/app/trivia/host.html', 'var nm=uniqueTeamName(m.pid, String(m.name||"Player"));', 'var nm=String(m.name||"Player");', 'two teams with one name are two identical chips and rows'),
    ('test-trivia-15-oct.js', 'venueplay/app/trivia/play.html', 'send({ t:"join", pid:P.pid, name:P.name, fmt:"trivia" })', 'send({ t:"join", pid:P.pid, name:P.name })', 'trivia phones stop counting on the console'),
    ('test-trivia-15-oct.js', 'venueplay/app/trivia/play.html', 'playerPost("/join",{ code:P.room, name:nm, pid:deviceId() })', 'Promise.resolve({})', 'a renamed phone keeps its old name on the leaderboard'),
    ('test-trivia-15-oct.js', 'venueplay/app/trivia/host.html', '(ph+" scanned in. "+(n===1 ? "Its team name is"', '(ph+" scanned in. They pick a team name when you start the round. "+(n===1 ? "Its team name is"', 'the lobby says teams pick names later while the names are listed'),
    ('test-trivia-15-oct.js', 'venueplay/app/trivia/play.html', 'pullScore(fresh===true ?', 'pullScore(false ?', "a brand-new joiner is told You're back in"),
    ('test-trivia-15-oct.js', 'venueplay/app/trivia/play.html', 'if(P.total>0){\n      $("waitScore")', 'if(P.total>0 || P.rank>0){\n      $("waitScore")', 'a brand-new joiner is told 1st of 1'),
    ('test-trivia-15-oct.js', 'venueplay/app/trivia/builder.html', 'typeof q.own==="boolean" ? q.own :', 'false ? q.own :', "YOUR OWN counts library questions as the host's"),
    ('test-trivia-15-oct.js', 'venueplay/app/trivia/builder.html', 'if(at[k]!=null){', 'if(false){', 'two identical General Knowledge Night chips'),
    ('test-trivia-15-oct.js', 'venueplay/app/trivia/host.html', 'if(t.correct>outOf) return', 'if(false) return', 'the console sends 9 right out of 5 without a word'),
    ('test-trivia-15-oct.js', 'venueplay-backend/worker/venueplay-game.js', 'if (c > roundIds.length) return json(', 'if (false) return json(', 'the Worker quietly cuts 9 right out of 3 to 3 and puts it on the wall'),
    ('test-trivia-15-oct.js', 'venueplay/app/trivia/host.html', '} else if(afterPodium){', '} else if(false){', 'Start a new round drops the winners to the venue ads at once'),
    ('test-trivia-15-oct.js', 'venueplay/app/trivia/host.html', 'return !info.usedBy && !(info.questions', 'return !(info.questions', 'sheets played in round one make every later round a paper round'),
    ('test-trivia-15-oct.js', 'venueplay-backend/worker/venueplay-game.js', 'const paperAsked = b.paper === false ? false : true;', 'const paperAsked = true;', 'a round the host says is not on paper still holds its answers back'),
    ('test-trivia-15-oct.js', 'venueplay-backend/worker/venueplay-game.js', '// Membership FIRST: "Not a trivia game" told a phone from another venue what this game was (14 Oct 2026).\n  if (game.session_id !== player.session_id)', '// Membership FIRST: "Not a trivia game" told a phone from another venue what this game was (14 Oct 2026).\n  if (false && game.session_id !== player.session_id)', "/player/score tells another venue's phone what kind of game this is"),
    ('test-trivia-15-oct.js', 'venueplay-backend/worker/venueplay-game.js', ',vp_questions(seq)&order=answered_at.desc&limit=1', '&order=answered_at.desc&limit=1', 'the phone cannot tell which question its last answer was'),
    ('test-trivia-15-oct.js', 'venueplay-backend/worker/venueplay-game.js', "if (status === 'not_trivia') {", 'if (false) {', 'the one-trip answer tells a stranger Not a trivia game until migration 99 runs'),
    ('test-trivia-15-oct.js', 'venueplay-backend/worker/venueplay-game.js', "// Membership FIRST, as in the one-trip path (migration 99): the format is not another venue's business.\n  if (game.session_id !== player.session_id)", "// Membership FIRST, as in the one-trip path (migration 99): the format is not another venue's business.\n  if (false && game.session_id !== player.session_id)", 'the slow answer path tells a stranger Not a trivia game'),
    ('test-trivia-15-oct.js', 'venueplay-backend/supabase/venueplay-99-answer-membership-first.sql', "  if v_game.session_id <> v_player.session_id then status := 'wrong_game'; return next; return; end if;\n  if v_game.format <> 'trivia' then status := 'not_trivia'; return next; return; end if;", "  if v_game.format <> 'trivia' then status := 'not_trivia'; return next; return; end if;\n  if v_game.session_id <> v_player.session_id then status := 'wrong_game'; return next; return; end if;", 'migration 99 still checks the format before membership'),
    ('test-trivia-15-oct.js', 'venueplay-backend/worker/venueplay-game.js', "if (method === 'POST' && path === '/host/trivia/board')  return await handleHostTriviaBoard", "if (false)  return await handleHostTriviaBoard", 'the board route is never reached'),
    ('test-trivia-15-oct.js', 'venueplay-backend/worker/venueplay-game.js', 'own: !libTexts.has(r.question)', 'own: true', "every question in a night is counted as the host's own"),
    # 14 Oct fix round: signing.
    ('test-signing-15-oct.js', 'venueplay/app/vp-sign.js', '      if (senderBehind(payload)) return Promise.resolve("replay");', '', 'a signed winner or to_ads recorded earlier in the night is accepted again by a game frame that never heard it'),
    ('test-signing-15-oct.js', 'venueplay/app/vp-sign.js', '      loadSeen();                                                           // what this tab already heard, once per page\n', '', 'a fresh game frame after a hop forgets what the tab heard and takes last game\'s winner again'),
    ('test-signing-15-oct.js', 'venueplay/app/vp-sign.js', '      st.setItem(pathKey(), JSON.stringify(S.seenNonces.slice(-PATH_NONCES_KEEP)));', '', 'the last idle of a console that has since closed can be played to the next game frame'),
    ('test-signing-15-oct.js', 'venueplay/app/vp-sign.js', '      if (sid) { msg._sid = sid; msg._seq = ++S.seq; }', '', 'consoles stop saying who sent a message and in what order, so no screen can tell a recording from the real thing'),
    ('test-signing-15-oct.js', 'venueplay/app/vp-sign.js', '(h.t - p._ts) > SENDER_LAG_MS', '(h.t - p._ts) >= 0', 'a real message overtaken on a slower path is thrown away'),
    ('test-signing-15-oct.js', 'venueplay/app/vp-sign.js', 'return !!h && q < h.q && (h.t', 'return !!h && (h.t', 'a console whose clock is corrected backwards goes deaf to every screen'),
    ('test-signing-15-oct.js', 'venueplay/app/vp-sign.js', '        .then(function () { return hostWait(); })\n', '', "a console's first sends before its key (musical volume) go out unsigned and an enforcing TV drops them"),
    ('test-signing-15-oct.js', 'venueplay/app/vp-sign.js', '    if (left <= 0 || typeof setTimeout !== "function") return null;', '    if (typeof setTimeout !== "function") return null;', 'a page that never signs in holds its sends for ever'),
    ('test-signing-15-oct.js', 'venueplay/app/vp-sign.js', '      for (var i = 0; i < ids.length && i < SENDERS_KEEP; i++)', '      for (var i = 0; i < ids.length; i++)', 'the sender table grows without bound on a TV left on for weeks'),
    ('test-signing-15-oct.js', 'venueplay/app/vp-sign.js', '    return "vpSign.n:" + (p.replace(/\\.html$/, "").replace(/\\/+$/, "") || "/");', '    return "vpSign.n:";', '/tv and the game frame share one nonce list although they hear the same messages'),
    ('test-pr-guesses-15-oct.js', 'venueplay/app/trivia/host.html', '      if(!v || !v.ok || v.legacy) return;\n      if(!VPPhoneKey.fresh(prSeen(), m, Date.now())) return;', '      if(!v) return;\n      if(!VPPhoneKey.fresh(prSeen(), m, Date.now())) return;', 'a stranger scores Punters Reckon guesses to a real team under its pid'),
    ('test-pr-guesses-15-oct.js', 'venueplay/app/trivia/host.html', '      if(!VPPhoneKey.fresh(prSeen(), m, Date.now())) return;     // a real guess, played back', '      if(false) return;', "a team's real guess played back burns the rest of its guesses"),
    ('test-pr-guesses-15-oct.js', 'venueplay/app/trivia/host.html', '      savePRSeen();\n      prGuess(m);', '      prGuess(m);', 'after a console reload, recorded guesses can be played back again'),
    ('test-pr-guesses-15-oct.js', 'venueplay/app/vp-phonekey.js', 'Number(m.round) || 0, m.text == null ? "" : String(m.text)]);', 'Number(m.round) || 0, ""]);', "a real guess's text can be changed in flight"),
    ('test-pr-guesses-15-oct.js', 'venueplay/app/vp-phonekey.js', '  var SIGNED_TYPES = { join: 1, claim: 1, leave: 1, pr_guess: 1 };', '  var SIGNED_TYPES = { join: 1, claim: 1, leave: 1 };', 'verify waves any pr_guess through unchecked'),
    ('test-pr-guesses-15-oct.js', 'venueplay/app/trivia/play.html', '      return id.sign(o);\n', '      return o;\n', 'the trivia phone sends its guesses unsigned and none is scored'),
    ('test-pr-guesses-15-oct.js', 'venueplay/app/trivia/play.html', '(!!P.prPid && m.to===P.prPid)', 'false', 'a phone never shows the result of its own guess'),
    ('test-pr-guesses-15-oct.js', 'venueplay/app/trivia/play.html', '    if(obj && obj.t==="join" && P.prPid) obj.prk=P.prPid;', '', 'a reloaded phone is told it has three guesses when it has used them'),
    # 14 Oct fix round: musical.
    ('test-musical-15-oct.js', 'venueplay/app/vp-onetab.js', 'if (h) { state = "blocked"; if (!quiet) showNotice(lastFlagged); return; }', 'if (false) { state = "blocked"; if (!quiet) showNotice(lastFlagged); return; }', 'a second tab restores the game as a second live console'),
    ('test-musical-15-oct.js', 'venueplay/app/vp-onetab.js', 'if (m.t === "take")  { if (state === "live") standDown(); return; }', 'if (m.t === "take")  { return; }', '"Use this tab instead" leaves the old tab live beside the new one'),
    ('test-musical-15-oct.js', 'venueplay/app/vp-onetab.js', 'if (state === "live") { if (otherIsNewer(m)) standDown(); else sayLive(); }', 'if (state === "live") { sayLive(); }', 'an iPad tab that slept through the question never stands down'),
    ('test-musical-15-oct.js', 'venueplay/app/musical/host.html', 'function rawSend(p){ if(standingDown()) return; if(subscribed && ch){', 'function rawSend(p){ if(subscribed && ch){', 'a stood-down musical console keeps heartbeating its stale song at the TV'),
    ('test-musical-15-oct.js', 'venueplay/app/trivia/host.html', 'function rawGsend(p){ if(standingDown()) return; if(gsub && gch){', 'function rawGsend(p){ if(gsub && gch){', 'a stood-down trivia console keeps talking to the phones'),
    ('test-musical-15-oct.js', 'venueplay/app/musical/screen.html', 'if(state.phase!=="lobby"){ _lobbySince=null; checkRunningGame(); return; }', 'if(state.phase!=="lobby"){ _lobbySince=null; return; }', 'the TV sits on NOW PLAYING over a finished night for 90 minutes'),
    ('test-musical-15-oct.js', 'venueplay/app/musical/screen.html', 'return !!(open && g && g.format==="musical_bingo" && (!_gameId || !g.game_id || g.game_id===_gameId));', 'return !!open;', 'a finished game in a still-open night keeps the TV on NOW PLAYING'),
    ('test-musical-15-oct.js', 'venueplay/app/musical/screen.html', 'if(on){ _nextRunAsk=Date.now()+RUN_RECHECK_MS; return; }', 'if(on){ return; }', 'a locked iPad mid-game costs a server read every thirty seconds'),
    ('test-musical-15-oct.js', 'venueplay/app/musical/play.html', '      loadMarks();   // this card', '      //loadMarks();   // this card', 'a phone reload wipes every mark but FREE'),
    ('test-musical-15-oct.js', 'venueplay/app/musical/play.html', 'if(!s || s.game!==P.gameId || s.card!==String(P.cardNo)', 'if(!s', "last game's marks land on a new card"),
    ('test-musical-15-oct.js', 'venueplay/app/vp-hold.js', 'b.disabled = !(h.softAt != null && Date.now() >= h.softAt);', 'b.disabled = true;', 'a deliberate Play next tap four seconds in hits a dead button and vanishes'),
    ('test-musical-15-oct.js', 'venueplay/app/musical/host.html', 'if(!VP_HOLD.soft(b)) return;', 'if(false) return;', 'a fumbled double tap is offered a skip instead of being refused'),
    ('test-musical-15-oct.js', 'venueplay/app/musical/screen.html', '<div class="tv-join hidden" id="tvJoinCorner" data-fit-avoid>', '<div class="tv-join hidden" id="tvJoinCorner">', 'the played strip runs under the JOIN NOW card'),
    ('test-musical-15-oct.js', 'venueplay/app/musical/screen.html', '<div class="tv-corner" data-fit-avoid="kids">', '<div class="tv-corner">', 'a long song title runs under the VenuePlay corner'),
    ('test-musical-15-oct.js', 'venueplay/app/musical/screen.html', 'el.id="venueLogo"; el.setAttribute("data-fit-avoid","");', 'el.id="venueLogo";', 'the wall paints under the venue logo'),
    ('test-musical-15-oct.js', 'venueplay/app/musical/screen.html', '#tvRun .pboard{flex-shrink:0}', '#tvRun .pboard{}', 'at 1280x720 the strip squashes to one row and hides the rest'),
    # 14 Oct fix round: bingo.
    ('test-bingo-seat-15-oct.js', 'venueplay/play.html', '    if(!now && _joinedFor===(sessionId||joinCode) && P.token) return;', '    if(!now && _joinedFor && P.token) return;', 'a phone that stays on the page never joins game two or three'),
    ('test-bingo-seat-15-oct.js', 'venueplay/app/index.html', '      if(typeof m.did==="string" && /^[A-Za-z0-9_-]{6,64}$/.test(m.did) && _p.did!==m.did){', '      if(false){', 'no phone is ever seated or stamped as dealt'),
    ('test-bingo-seat-15-oct.js', 'venueplay/app/index.html', '  function isSeated(p){ return !!p && (seatOpen() || p.seatSid===G.sessionId); }', '  function isSeated(p){ return !!p; }', 'a channel stranger is dealt and counted again'),
    ('test-bingo-seat-15-oct.js', 'venueplay/app/index.html', '    if(_seatT){ if(_seatAt<=at) return; clearTimeout(_seatT); }', '    if(_seatT){ return; }', 'a stranger backoff holds up seating the next lobby'),
    ('test-bingo-seat-15-oct.js', 'venueplay/app/index.html', '    return k>1 ? base+" ("+k+")" : base;', '    return base;', 'two Margarets look identical on the console'),
    ('test-bingo-seat-15-oct.js', 'venueplay/app/index.html', '        if(_ra[m.pid] && _rn-_ra[m.pid]<2000) return;', '        if(false) return;', 'every refused claim signs and broadcasts another refusal'),
    ('test-bingo-seat-15-oct.js', 'venueplay/app/index.html', '    else if(G.status==="running") txt="<b>"+called+" of 90</b> called.', '    else if(false) txt="<b>"+called+" of 90</b> called.', 'coach says Tickets are out all game'),
    ('test-bingo-seat-15-oct.js', 'venueplay/app/index.html', '      ovgNames();', '      "";', 'consent screen stops naming who is counted'),
    ('test-bingo-seat-15-oct.js', 'venueplay/app/index.html', '      if(!isSeated(p)){ waiting++; continue; }', '      if(false){ waiting++; continue; }', 'a stranger appears on the console by name'),
    ('test-bingo-seat-15-oct.js', 'venueplay/play.html', '    $("roomErr").textContent="There is no game with the code "+c+" right now. Check the code on the TV and try again.";', '    $("roomErr").textContent="";', 'a mistyped code is not told'),
    ('test-bingo-seat-15-oct.js', 'venueplay/play.html', '    loadJoinInfo();                 // extra fields', '    if(!P.joined) loadJoinInfo();                 // extra fields', 'returning SA/ACT/TAS phones get phone tickets'),
    ('test-bingo-seat-15-oct.js', 'venueplay/play.html', 'P.ended=true; P.lostBy="That game is over. Nobody called a winning ticket this time."; route();', 'P.ended=false; route();', 'no-winner end leaves phones on waiting'),
    ('test-bingo-seat-15-oct.js', 'venueplay/play.html', '          wa.innerHTML="You also won "+sw2.map(', '          wa.innerHTML=""+[].map(', 'YOU WON shows only the last prize'),
    # 19 Oct 2026, Dean: "Lets go the server". The Worker deals the bingo phone tickets and decides every BINGO
    # (migration 104); the tablet only deals or judges in an outage, labelled, and fills in the record after.
    ('test-bingo-server-tickets.js', 'venueplay-backend/worker/venueplay-game.js', '        const chunk = pool.slice(at, at + m[t][c]).sort((a, b) => a - b);', '        const chunk = pool.slice(0, m[t][c]).sort((a, b) => a - b);', 'the server deals tickets that are not a strip: a number twice in one book'),
    ('test-bingo-server-tickets.js', 'venueplay-backend/worker/venueplay-game.js', '        cs.push(idx[0]); if (idx[idx.length - 1] !== idx[0]) cs.push(idx[idx.length - 1]);', '        cs.push(idx[0]);', 'the server and the console disagree on four corners'),
    ('test-bingo-server-tickets.js', 'venueplay-backend/worker/venueplay-game.js', '    hands = hands.filter(function (h) { if (h.did && known.has(h.did)) return true; refused.push(h.pid); return false; });', '    hands = hands.filter(function (h) { return true; });', 'the server deals to a phone that is not in the session'),
    ('test-bingo-server-tickets.js', 'venueplay-backend/worker/venueplay-game.js', '    if (h.want > live.length) {', '    if (h.want > 0) {', 'asking for the same hand again deals it again'),
    ('test-bingo-server-tickets.js', 'venueplay-backend/worker/venueplay-game.js', '      live.slice(h.want).forEach((t) => voids.push(t.id));', '      live.slice(h.want).forEach((t) => t);', 'a sale taken back leaves the tickets in play'),
    ('test-bingo-server-tickets.js', 'venueplay-backend/worker/venueplay-game.js', "      mine.filter((t) => !t.dealt_at && !t.voided_at && t.source === 'server').forEach(function (t) {", '      [].forEach(function (t) {', 'a ticket bought later comes from a new book, not the same one continued'),
    ('test-bingo-server-tickets.js', 'venueplay-backend/worker/venueplay-game.js', '  for (let tries = 0; tries < 400; tries++) { const n = 100 + randInt(900); if (!used.has(n)) { used.add(n); return n; } }', '  for (let tries = 0; tries < 400; tries++) { const n = 100 + randInt(3); { used.add(n); return n; } }', 'two tickets in one game carry the same number'),
    ('test-bingo-server-tickets.js', 'venueplay-backend/worker/venueplay-game.js', "    '&dealt_at=not.is.null&voided_at=is.null&select=pid,book,page,cells,card_no,source&order=pid.asc,book.asc,page.asc');", "    '&voided_at=is.null&select=pid,book,page,cells,card_no,source&order=pid.asc,book.asc,page.asc');", 'pages nobody was dealt are sent to the phones'),
    ('test-bingo-server-tickets.js', 'venueplay-backend/worker/venueplay-game.js', "(draw.mode === 'local' || serverFailedBall(draw, standing.length + 1));", '(true);', 'on a server draw the tablet can add balls to make a claim win'),
    ('test-bingo-server-tickets.js', 'venueplay-backend/worker/venueplay-game.js', '  if (prior.length) return await bingoClaimAnswer(env, json, draw, prior[0], authUserId, decision);', '', 'a claim retried after a timeout is a second claim on the record'),
    ('test-bingo-server-tickets.js', 'venueplay-backend/worker/venueplay-game.js', '    if (tk) swapped = true;', '', 'a claim on a ticket they no longer hold is not marked swapped'),
    ('test-bingo-server-tickets.js', 'venueplay-backend/worker/venueplay-game.js', "            await sbInsert(env, 'vp_bingo_draw_balls', { draw_id: drawId, ordinal: i + 1, number: called[i], source: 'local' }, false);", "            await sbInsert(env, 'vp_bingo_draw_balls', { draw_id: drawId, ordinal: i + 2, number: called[i], source: 'local' }, false);", 'tablet balls go on the record out of order'),
    ('test-bingo-server-tickets.js', 'venueplay-backend/worker/venueplay-game.js', '  const won = tk ? bingoTicketWins(tk.cells, set, pattern) : { win: false, cells: [] };', '  const won = tk ? bingoTicketWins(tk.cells, new Set(called || []), pattern) : { win: false, cells: [] };', 'the server judges a claim on the numbers the tablet says, not its own record'),
    ('test-bingo-server-tickets.js', 'venueplay/app/index.html', '      out.push({ pid:pid, did:p.did||null, want:want });', '      out.push({ pid:pid, did:p.did||null, want:1 });', 'the console asks the server for the wrong number of tickets'),
    ('test-bingo-server-tickets.js', 'venueplay/app/index.html', '      var next=list.map(function(t){ return { card:t.cells, cardNo:t.card_no, src:', '      var next=list.map(function(t){ return { card:t.cells, cardNo:t.card_no+1, src:', 'the phone is shown a ticket number the server never dealt'),
    ('test-bingo-server-tickets.js', 'venueplay/app/index.html', '    G.dealMode="server"; G.dealWhy=""; G.dealSince=0; G.dealFails=0; G._checking={};', '    G.dealMode="tablet"; G.dealWhy=""; G.dealSince=0; G.dealFails=0; G._checking={};', 'the tablet deals the tickets with the server up'),
    ('test-bingo-server-tickets.js', 'venueplay/app/index.html', '      if((res.hard || Date.now()-G.dealSince>=DEAL_BUDGET_MS) && tabletMayStandIn()){ goTabletDeal(res.fail); return; }', '      if(res.hard && tabletMayStandIn()){ goTabletDeal(res.fail); return; }', 'a dead server leaves the room with no tickets, for ever'),
    ('test-bingo-server-tickets.js', 'venueplay/app/index.html', '    if(G.idx<0 && dealPending()){ showToast("Tickets are still being dealt. One moment."); return; }', '    if(false){ showToast("Tickets are still being dealt. One moment."); return; }', 'the first ball is called before anybody has a ticket'),
    ('test-bingo-server-tickets.js', 'venueplay/app/index.html', 'data-i="\'+ci+\'"\'+(_hold||((checking || !valid || c.by==="refused")?" disabled":""))+\'>Confirm winner', 'data-i="\'+ci+\'"\'+(_hold||((!valid || c.by==="refused")?" disabled":""))+\'>Confirm winner', 'the host can confirm a win before the server has checked it'),
    ('test-bingo-server-tickets.js', 'venueplay/app/index.html', '      }, function(err){ if(gen===G.gen) claimOnTablet(c, "claim check failed: "+(err&&err.message||err)); });', '      }, function(err){ });', 'a claim the server never answers sits on Checking for ever'),
    ('test-bingo-server-tickets.js', 'venueplay/app/index.html', 'VP.gameApiCall("/host/bingo/deal", { draw_id:G.drawId, hands:hands }, DEAL_CALL_MS)', 'VP.gameApiCall("/host/bingo/deal", { draw_id:G.drawId, hands:[] }, DEAL_CALL_MS)', 'tablet tickets from an outage never reach the record'),
    ('test-bingo-server-tickets.js', 'venueplay/app/index.html', '    c.valid=(j.verdict==="win");', '    c.valid=c.valid||(j.verdict==="win");', "a rigged ticket on the tablet beats the server's verdict"),
    ('test-bingo-server-tickets.js', 'venueplay/app/index.html', '      if(tk && (valid || G.allowEarly)) claimShow(c);', '      if(tk) claimShow(c);', 'a false BINGO goes up on the TV before the server has said no'),
    ('test-bingo-server-tickets.js', 'venueplay/app/index.html', '    if(!e.claim_id && !e.draw_id) return;              // no record for this game exists to add it to', '    return;', "the host's decision never reaches the server's record"),
    ('test-bingo-server-tickets.js', 'venueplay/app/index.html', '    if(G.caller) return 0;', '', 'a real-balls night deals phone tickets'),
    ('test-bingo-server-tickets.js', 'venueplay/app/index.html', '    if(claimsChecking()){ showToast("Checking a BINGO call with the server. One moment."); return; }', '', 'a ball is called past a BINGO the server is still checking'),
    ('test-bingo-server-tickets.js', 'venueplay/play.html', '      if(m.dealing){ P.cards=[]; P.dealSeq++; }', '      if(false){ P.cards=[]; P.dealSeq++; }', "a phone keeps last game's tickets into the next game"),
    ('test-bingo-server-tickets.js', 'venueplay/app/index.html', '    c.by="tablet"; c.why=String(why||"").slice(0,200);', '    c.by="server"; c.why=String(why||"").slice(0,200);', 'the tablet check is passed off as the server'),
    ('test-bingo-server-tickets.js', 'venueplay-backend/worker/venueplay-game.js', '  if (paperNight) hands = hands.filter(function (h) { refused.push(h.pid); return false; });', '', 'a phone in Victoria is dealt a bingo ticket by the server'),
    ('test-bingo-server-tickets.js', 'venueplay-backend/worker/venueplay-game.js', '  let paperNight = draw.fallback_why === CALLER_REASON;', '  let paperNight = false;', 'a real-balls night deals phone tickets from the server'),
    # 19 Oct 2026: the regulated bingo code (VP-DRAW) cannot change silently, and nothing outside it can steer it.
    ('regulated.test.py', 'tools/regulated.py', "    if old and old.get('files') != files and old.get('version') == wv:", '    if False:', '--update blesses a regulated change without a new version'),
    ('regulated.test.py', 'tools/regulated.py', "        if changed and base.get('version') == wv:", '        if False:', 'a change re-blessed at the same version passes against what is live'),
    ('regulated.test.py', 'tools/regulated.py', "    elif copy != wm and copy != wm + ('' if wm.endswith('\\n') else '\\n'):", '    elif False:', 'an edit to the copy inside the Worker passes'),
    ('regulated.test.py', 'tools/regulated.py', '    if ws is None or cs is None or ws != cs:', '    if ws is None or cs is None:', 'the two halves may carry different fallback switches'),
    ('regulated.test.py', 'tools/regulated.py', "    if not m or m.group(1) != man.get('manifest_hash'):", '    if not m:', '/health may report a manifest hash that is not the manifest'),
    ('regulated.test.py', 'tools/release.py', "    r = sh([PY, 'tools/regulated.py', '--check'])", "    r = sh([PY, '-c', 'pass'])", 'release.py stops checking the regulated code'),
    ('regulated.test.py', 'venueplay-backend/worker/vp-draw.js', 'async function venueState(env, venueId) {', 'async function venueState(env, venueId) {\n  if (env.FALLBACK_OFF) return String(env.FALLBACK_OFF);', 'an environment variable can steer the regulated rules'),
    ('regulated.test.py', 'venueplay/app/vp-draw.js', '  function standInAllowed(state){', "  function standInAllowed(state){ try{ if(localStorage.getItem('x')) return true; }catch(e){}", 'something on the page can steer the tablet switch'),
    ('the regulated bingo code matches its manifest and its version', 'venueplay-backend/worker/vp-draw.js', '  return x % max;', '  return x % max;   // edited', 'a regulated file changes and the gate does not notice'),
    ('the regulated bingo code matches its manifest and its version', 'venueplay-backend/worker/venueplay-game.js', 'function generateStrip() {', 'function generateStrip() {\n  // edited in the copy', 'the copy inside the Worker is edited and the gate does not notice'),
    ('test-bingo-server-tickets.js', 'venueplay/app/vp-draw.js', '        if(first) out.push(first); if(last && last!==first) out.push(last); });', '        if(first) out.push(first); });', "the tablet's claim rule disagrees with the server's on four corners"),
    # 19 Oct 2026, the audit of a16446c: every tablet fallback needs an outage the SERVER recorded; a refusal is not an outage; one switch per state.
    ('test-olgr-audit-19-oct.js', 'venueplay-backend/worker/venueplay-game.js', 'const okHere = tabletFallbackOk(await venueState(env, draw.venue_id)) && !!draw.deal_failed_at && standingNow === 0;', 'const okHere = true;', 'tablet tickets are taken with no outage the server recorded'),
    ('test-olgr-audit-19-oct.js', 'venueplay-backend/worker/venueplay-game.js', '&& !!draw.deal_failed_at && standingNow === 0;', '&& !!draw.deal_failed_at;', 'tablet tickets are taken after the first ball is out'),
    ('test-olgr-audit-19-oct.js', 'venueplay-backend/worker/venueplay-game.js', '    hands = hands.filter(function (h) { if (h.did && known.has(h.did)) return true; refused.push(h.pid); return false; });', '    hands = hands.filter(function (h) { if (h.tablet || (h.did && known.has(h.did))) return true; refused.push(h.pid); return false; });', 'a tablet ticket skips the seat rule'),
    ('test-olgr-audit-19-oct.js', 'venueplay-backend/worker/venueplay-game.js', 'if (!h.tablet || (okHere && !serverHeld.has(h.pid))) return true;', 'if (!h.tablet || okHere) return true;', 'a tablet ticket is taken for a phone the server already dealt'),
    ('test-olgr-audit-19-oct.js', 'venueplay-backend/worker/venueplay-game.js', '  if (paperNight) hands = hands.filter(function (h) { refused.push(h.pid); return false; });', '  if (paperNight) hands = hands.filter(function (h) { if (h.tablet) return true; refused.push(h.pid); return false; });', 'a tablet ticket is taken in a paper-bingo state'),
    ('test-olgr-audit-19-oct.js', 'venueplay-backend/worker/venueplay-game.js', "    .filter((t) => t.source !== 'tablet' || t.balls_at_deal === 0);", '    .filter((t) => true);', 'a claim is judged on a tablet ticket recorded after the balls'),
    ('test-olgr-audit-19-oct.js', 'venueplay-backend/worker/venueplay-game.js', "      if (!serverFailedBall(draw, ordinal)) return json({ error: 'The server has not failed to call this ball, so it does not take one from the tablet' }, 409);\n", '', 'a host switches a healthy server draw to the tablet'),
    ('test-olgr-audit-19-oct.js', 'venueplay-backend/worker/venueplay-game.js', "(draw.mode === 'local' || serverFailedBall(draw, standing.length + 1));", "(draw.mode === 'local' || b.tablet_draw === true);", "a claim switches a healthy server draw to the tablet on the console's word"),
    ('test-olgr-audit-19-oct.js', 'venueplay-backend/worker/venueplay-game.js', '  if (callerBall !== isCallerDraw(draw)) {', '  if (false) {', 'a server night is posted to as real balls'),
    ('test-olgr-audit-19-oct.js', 'venueplay-backend/worker/venueplay-game.js', '  if (ordinal !== standing + 1) return json(', '  if (ordinal < standing + 1) return json(', 'a tablet ball skips a place on the record'),
    ('test-olgr-audit-19-oct.js', 'venueplay-backend/worker/venueplay-game.js', "  if (draw.finished_at) return json({ error: 'This game is finished' }, 409);\n\n  const number = parseInt(b.number, 10);", '\n  const number = parseInt(b.number, 10);', 'a ball is posted to a finished draw'),
    ('test-olgr-audit-19-oct.js', 'venueplay-backend/worker/venueplay-game.js', '        { ball_asked_ordinal: o, ball_asked_at: new Date().toISOString() });', '        { ball_asked_at: new Date().toISOString() });', 'the server never records which ball it was asked for'),
    ('test-olgr-audit-19-oct.js', 'venueplay-backend/worker/venueplay-game.js', "async function bingoMayConfirm(env, draw, c) {\n  if (c.verdict === 'win') return true;", 'async function bingoMayConfirm(env, draw, c) {\n  return true;', 'the server records a confirm of a claim it judged not a win'),
    ('test-olgr-audit-19-oct.js', 'venueplay-backend/worker/venueplay-game.js', "  if (decision === 'confirmed' && !(await bingoMayConfirm(env, draw, claims[0]))) {", '  if (false) {', 'the resolve route confirms anything'),
    ('test-olgr-audit-19-oct.js', 'venueplay-backend/worker/venueplay-game.js', "  if (c.decided_on !== 'tablet' || !drawHadOutage(draw)) return false;", "  if (c.decided_on !== 'tablet') return false;", 'a tablet-judged confirm is recorded with no outage on the draw'),
    ('test-olgr-audit-19-oct.js', 'venueplay-backend/worker/venueplay-game.js', "game: 'bingo claim'", "game: 'bingo claimx'", 'the draw record export leaves out the claims'),
    ('test-olgr-audit-19-oct.js', 'venueplay/app/vp-draw.js', '  function isRefusal(r){ return !!r && r.status>=400 && r.status<500 && r.status!==429; }', '  function isRefusal(r){ return false; }', 'a signed-out, paused or finished game carries on on the tablet'),
    ('test-olgr-audit-19-oct.js', 'venueplay/app/index.html', '    if(c.valid===false) return false;   // the check says not a win (an early call): it can be waved off, never confirmed\n', '', 'the host confirms an early call the server says is not a win'),
    ('test-olgr-audit-19-oct.js', 'venueplay/app/index.html', '((checking || !valid || c.by==="refused")?" disabled":"")', '((checking || c.by==="refused")?" disabled":"")', 'Confirm is live on a claim that is not a win'),
    ('test-fallback-switch.js', 'venueplay/app/index.html', '    if(!tabletMayStandIn()) return { wait:NO_STAND_IN };\n', '', 'the tablet calls balls where the switch is off'),
    ('test-fallback-switch.js', 'venueplay/app/index.html', '&& tabletMayStandIn()){ goTabletDeal(res.fail); return; }', '){ goTabletDeal(res.fail); return; }', 'the tablet deals where the switch is off'),
    ('test-fallback-switch.js', 'venueplay/app/index.html', '    if(!tabletMayStandIn()){\n      claimDone(c); c.by="waiting";', '    if(false){\n      claimDone(c); c.by="waiting";', 'the tablet decides claims where the switch is off'),
    ('test-fallback-switch.js', 'venueplay/app/vp-draw.js', '    TABLET_FALLBACK_OFF_STATES: Object.freeze(TABLET_FALLBACK_OFF_STATES.slice()),', '    TABLET_FALLBACK_OFF_STATES: TABLET_FALLBACK_OFF_STATES,', 'a page can change the tablet fallback switch'),
    ('test-fallback-switch.js', 'venueplay/app/vp-draw.js', '  function standInAllowed(state){ return TABLET_FALLBACK_OFF_STATES.indexOf(String(state||"").toUpperCase())<0; }', '  function standInAllowed(state){ return true; }', 'the console ignores the switch'),
    ('test-fallback-switch.js', 'venueplay-backend/worker/venueplay-game.js', "function tabletFallbackOk(state) { return !TABLET_FALLBACK_OFF_STATES.has(String(state || '').toUpperCase()); }", 'function tabletFallbackOk(state) { return true; }', 'the server ignores the switch'),
    ('test-fallback-switch.js', 'venueplay-backend/worker/venueplay-game.js', 'tablet_fallback: tabletFallbackOk(state), fallback_off_states: fallbackOffList() });', 'tablet_fallback: true, fallback_off_states: [] });', 'the draw answer stops telling the console the switch'),
    ('test-fallback-switch.js', 'venueplay-backend/worker/venueplay-game.js', '  const out = { ok: true, seated: seated, fallback_off_states: fallbackOffList() };', '  const out = { ok: true, seated: seated, fallback_off_states: [] };', 'the seat answer stops telling the console the switch'),
    ('test-fallback-switch.js', 'venueplay-backend/worker/venueplay-game.js', 'const TABLET_FALLBACK_OFF_STATES = new Set([]);', 'const TABLET_FALLBACK_OFF_STATES = new Set([ ]);', 'the switch line changes shape and the one-line change no longer works'),
    ('test-bingo-server-tickets.js', 'venueplay-backend/worker/venueplay-game.js', '{ deal_failed_at: new Date().toISOString(), deal_fail_why:', '{ deal_failed_x: new Date().toISOString(), deal_fail_why:', 'the server never records its own failed deal'),
    ('test-bingo-server-tickets.js', 'venueplay/app/index.html', 'c.rec = no.indexOf(pid)>=0 ? "refused" : true;', 'c.rec = true;', 'the tablet thinks the server took tickets it refused'),
    ('test-bingo-server-tickets.js', 'venueplay/app/index.html', 'return { hard:!(r && r.status===429), fail:"deal answered "', 'return { hard:false, fail:"deal answered "', 'a failed deal makes the room wait out the budget'),
    ('test-olgr-audit-19-oct.js', 'venueplay/app/index.html', '          if(j.record_short && j.verdict!=="win"){ c.claimId=j.claim_id; claimOnTablet(', '          if(false){ c.claimId=j.claim_id; claimOnTablet(', 'a claim the server cannot judge is refused as not a win'),
    ('test-bingo-server-tickets.js', 'venueplay-backend/worker/venueplay-game.js', "source: 'tablet', dealt_at: now, tablet_dealt_at: t.at, balls_at_deal: standingNow });", "source: 'tablet', dealt_at: now, tablet_dealt_at: t.at });", 'a tablet ticket is recorded without the balls at deal'),
    # 19 Oct 2026: ONE bingo draw, one ticket maker, one claim path. Each row puts a removed path back.
    ('test-one-bingo-path.js', 'venueplay-backend/worker/venueplay-game.js', "      if (method === 'POST' && path === '/host/bingo/ball')      return await handleBingoBall(request, env, json);\n", "      if (method === 'POST' && path === '/host/bingo/ball')      return await handleBingoBall(request, env, json);\n      if (method === 'POST' && path === '/host/ball')          return await handleBingoBall(request, env, json);\n", '/host/ball comes back as a second way to draw a ball'),
    ('test-one-bingo-path.js', 'venueplay-backend/worker/venueplay-game.js', "      if (method === 'POST' && path === '/host/bingo/ball')      return await handleBingoBall(request, env, json);\n", "      if (method === 'POST' && path === '/host/bingo/ball')      return await handleBingoBall(request, env, json);\n      if (method === 'GET'  && path === '/jag/board')           return json({ board: null });\n", 'a Jag the Joker route comes back into the live Worker'),
    ('test-one-bingo-path.js', 'venueplay-backend/worker/venueplay-game.js', "  const format = String(b.format || '');", "  const format = String(b.format || 'trivia');", '/host/game quietly picks a game when none is named'),
    ('test-one-bingo-path.js', 'venueplay-backend/worker/venueplay-game.js', "<<ALL:return json({ error: 'Not a musical game' }, 404);>>", 'void 0;', 'the player and host claim routes judge a 90-ball claim again'),
    ('test-one-bingo-path.js', 'venueplay-backend/worker/venueplay-game.js', "  if (fmt === 'musical_bingo') return await playerMusicCard(env, json, gameId, player);\n  return json({ game: null });", '  return await playerMusicCard(env, json, gameId, player);', '/player/card serves a 90-ball game again'),
    ('test-one-bingo-path.js', 'venueplay-backend/worker/venueplay-game.js', "  if (games[0].format !== 'musical_bingo') return json({ error: 'Not a musical game' }, 404);\n", '', '/host/claim/resolve confirms a 90-ball claim and finishes the game'),
    ('test-one-bingo-path.js', 'venueplay-backend/worker/venueplay-game.js', 'function shuffleArray(a) {', 'function generateTicket() { return new Array(27).fill(0); }\nfunction shuffleArray(a) {', 'a second ticket maker is back in the Worker'),
    ('test-one-bingo-path.js', 'venueplay-backend/worker/venueplay-game.js', '    draw_order: shuffle1to90(),   // never leaves this function', '    draw_order: shuffle1to90(),   // never leaves this function\n    draw_seed2: String(shuffle1to90()),', 'the 1 to 90 shuffle is called from a second place'),
    ('test-one-bingo-path.js', 'venueplay-backend/worker/venueplay-game.js', '    draw_order: shuffle1to90(),   // never leaves this function', "    draw_order: shuffle1to90(),   // never leaves this function\n    old: 'vp_bingo_games',", 'the Worker names the retired vp_bingo_games table again'),
    ('test-one-bingo-path.js', 'venueplay/app/index.html', '  function checkPattern(card){ return window.VPDraw.cardWins(card, G.called, G.pattern); }', '  function makeStrip(){ return null; }\n  function checkPattern(card){ return window.VPDraw.cardWins(card, G.called, G.pattern); }', 'the console page grows its own ticket maker beside the regulated one'),
    ('test-one-bingo-path.js', 'venueplay/app/index.html', '  var GAME_PATHS={ "trivia":"/app/trivia/host.html",', '  var GAME_PATHS={ "jag":"/app/jag/host.html", "trivia":"/app/trivia/host.html",', 'the console links to a Jag page again'),
    ('test-one-bingo-path.js', 'venueplay/training.html', '<<COPYTO:venueplay/jag-check.html>>', '', 'a Jag page is back on the site'),
    ('test-one-bingo-path.js', 'venueplay/app/vp-screen-router.js', '  var GAMES = ["bingo", "trivia", "musical", "raffle", "members"];', '  var GAMES = ["bingo", "trivia", "musical", "raffle", "members", "jag"];', 'the screens watch a Jag channel again'),
    ('test-router-heals-after-a-blip.js', 'venueplay/app/vp-screen-router.js', '  var GAMES = ["bingo", "trivia", "musical", "raffle", "members"];', '  var GAMES = ["bingo", "trivia", "musical", "raffle", "members", "jag"];', 'the wall watches a fifth, retired game channel'),
    ('test-paper-players.js', 'venueplay-backend/worker/venueplay-game.js', "  if (!isTrivia && !isMusical && !isRaffle) return json({ error: 'Unsupported format' }, 400);\n", "  if (format === 'bingo90') { await sbInsert(env, 'vp_cards', [{ game_id: 'x', player_id: 'paper' }], false); return json({ ok: true }); }\n  if (!isTrivia && !isMusical && !isRaffle) return json({ error: 'Unsupported format' }, 400);\n", '/host/game deals a 90-ball card again'),
    ('a forged join, claim or leave for another player is dropped', 'venueplay/app/index.html', '        if(v.legacy) return;   // an old unsigned phone: never heard', '        if(v.legacy){ }', 'an old unsigned phone page is heard again'),
    ('test-bingo-seat-15-oct.js', 'venueplay/app/index.html', '    else if(G.status==="running" && G.idx<0 && dealPending()){ b.disabled=true; b.classList.add("waiting"); b.textContent="Dealing tickets..."; }', '', 'Start calling does not say it is waiting for the tickets'),
    ('test-bingo-worker-15-oct.js', 'venueplay-backend/worker/venueplay-game.js', "    if (sess.length && sess[0].lobby_format === 'bingo90') return json({ ok: true, recorded: false, by: 'host' });", '', 'a /join ghost stamps itself billed'),
    ('test-bingo-worker-15-oct.js', 'venueplay-backend/worker/venueplay-game.js', '    const ids = rows.filter(function (r) { return !r.played_at; }).map(function (r) { return r.id; });', '    const ids = [];', 'dealt phones never stamped, bills fall back to every row'),
    ('test-bingo-worker-15-oct.js', 'venueplay-backend/worker/venueplay-game.js', "      await markBroadcastGameLive(env, session.venue_id, 'bingo');", '', 'lost start report bills ghosts'),
    ('test-bingo-worker-15-oct.js', 'venueplay-backend/worker/venueplay-game.js', '  if (b.deal === true && live) {', '  if (b.deal === true) {', 'a closed session can be stamped'),
    ('test-bingo-worker-15-oct.js', 'venueplay-backend/worker/venueplay-game.js', '  const recorded = (shown > 0 && shown < approvedCount) ? shown : approvedCount;', '  const recorded = approvedCount;', 'host OK covers ghosts'),
    ('test-bingo-worker-15-oct.js', 'venueplay-backend/worker/venueplay-game.js', "    return json({ collect: null, format: '', exists: !!held });", "    return json({ collect: null, format: '' });", '/join/info never says a code is unknown'),
    ('test-bingo-worker-15-oct.js', 'venueplay-backend/worker/venueplay-game.js', "  if (!(await rulesAccepted(env, session.venue_id, 'raffle'))) return rulesRefusal(json, 'raffle');   // ENFORCED: tonight's rules, seen and accepted", '', 'raffle draws with no rules accepted'),
    ('test-bingo-worker-15-oct.js', 'venueplay-backend/worker/venueplay-game.js', '  }, membersRulesGate);', '  });', 'members draw draws with no rules accepted'),
    ('test-bingo-worker-15-oct.js', 'venueplay-backend/worker/venueplay-game.js', "  return rows.some(function (r) { return String(r.category_claimed || '').indexOf(RULES_NOT_SHOWN) !== 0; });", '  return rows.length > 0;', 'an unseen auto-record counts as acceptance'),
    ('test-bingo-worker-15-oct.js', 'venueplay/app/vp-gaming.js', '      if (!opts.waitRecord || !rec || !rec.then) { proceed(arg); return; }', '      proceed(arg); return;', 'draw goes before the acceptance lands'),
    ('test-bingo-worker-15-oct.js', 'venueplay/app/vp-gaming.js', '      if (!opts.force && alreadyAcked(venue.id, format)) { proceed(); return; }', '      if (alreadyAcked(venue.id, format)) { proceed(); return; }', 'after a 428 the rules never come back'),
    ('test-bingo-worker-15-oct.js', 'venueplay/tv.html', '.curball{width:min(26cqw,27vh);', '.curball{width:min(26cqw,38vh);', 'NUMBER CALLED pushed into overscan at 720p'),
    # 15 Oct compliance build, agent C: the maximum jackpot, the reserve, the draw record (Anisimoff
    # Legal, 1 Oct 2026 point 10 and points 8 and 14; 8 Oct 2026 point 6).
    ('test-jackpot-cap-15-oct.js', 'venueplay-backend/worker/venueplay-game.js', '  if (max != null && raw > max) {', '  if (false) {', 'the maximum jackpot is never enforced: the wall shows a figure the venue said it would never reach'),
    ('test-jackpot-cap-15-oct.js', 'venueplay-backend/worker/venueplay-game.js', "  if (outcome === 'claimed') reserve = 0;", '', 'the reserve seeds every claim for ever instead of once'),
    ('test-jackpot-cap-15-oct.js', 'venueplay-backend/worker/venueplay-game.js', '    reserve += held;', '', 'increments above the maximum are lost, not banked'),
    ('test-jackpot-cap-15-oct.js', 'venueplay-backend/worker/venueplay-game.js', '  if (cap.present) patch.reserve_cents = next.reserve;', '  patch.reserve_cents = next.reserve;', 'a database without migration 101 is asked to write reserve_cents and the rollover fails'),
    ('test-jackpot-cap-15-oct.js', 'venueplay-backend/worker/venueplay-game.js', '  if (effCap != null && effCur != null && effCur > effCap) {', '  if (false) {', 'a jackpot above the maximum saves, and the wall and the record disagree'),
    ('test-jackpot-cap-15-oct.js', 'venueplay-backend/worker/venueplay-game.js', "  await requireStaff(env, authUserId, venueId);                   // ENFORCED: staff at THIS venue (also kill-switch)\n  const rows = await drawsRecordRows(env, venueId);", '  const rows = await drawsRecordRows(env, venueId);', "any signed-in host downloads any venue's draw record"),
    ('test-jackpot-cap-15-oct.js', 'venueplay-backend/worker/venueplay-game.js', "    const res = await sbGetAll(env, 'vp_member_draw_results',\n      'draw_id=in.(", "    const res = await sbGet(env, 'vp_member_draw_results',\n      'draw_id=in.(", 'the draw record stops at 1,000 rows in silence'),
    ('test-jackpot-cap-15-oct.js', 'venueplay-backend/worker/venueplay-game.js', "const DRAWS_EXPORT_RETENTION_NOTE = '# VenuePlay draw record. Keep this file for at least 7 years:", "const DRAWS_EXPORT_RETENTION_NOTE = '# VenuePlay draw record. Keep this file:", 'the venue is not told how long to keep its record'),
    ('test-jackpot-cap-15-oct.js', 'venueplay/app/members/screen.html', '      ? "<b>Jackpot at its maximum</b> &middot; be here next week"', '      ? "Up <b>"+money(incrementCents||0)+"</b> &middot; be here next week"', 'the wall says "Up $100" over a jackpot that did not move'),
    ('test-jackpot-cap-15-oct.js', 'venueplay/app/members/host.html', '      if(over.length) out.warn="Above your state\'s figure of "', '      if(false) out.warn="Above your state\'s figure of "', "a maximum above the state's figure draws no warning"),
    ('test-jackpot-cap-15-oct.js', 'venueplay/app/raffle/host.html', '    if(Math.round(jackDollars*100) <= limit.cents) return "";', '    return "";', 'a cash jackpot above the state figure is never warned about'),
    ('test-jackpot-cap-15-oct.js', 'venueplay/app/vp-drawrecord.js', "        { method: 'GET', headers: { 'Authorization': 'Bearer ' + (t || '') } });", "        { method: 'GET' });", 'the download asks without the host token and every venue is refused'),
    # 16 Oct live-audit fixes: the two warnings read as plain sentences, and a nil figure is said as nil.
    ('test-jackpot-cap-15-oct.js', 'venueplay/app/raffle/host.html', '    var first = limit.cents===0\n      ? "This jackpot (', '    var first = false\n      ? "This jackpot (', 'a Victorian cash jackpot is warned as "above the Victorian figure of $0"'),
    ('test-jackpot-cap-15-oct.js', 'venueplay/app/raffle/host.html', '    return first+(why ? " "+why+"." : "")+" You can still draw:', '    return first+" You can still draw:', "the state's reason is dropped from the raffle warning"),
    ('test-jackpot-cap-15-oct.js', 'venueplay/app/raffle/host.html', '    var figure=limit.where||"your state\'s figure";   // "the Victorian figure", from jackpotLimit', '    var figure=limit.why||"your state\'s figure";', 'the raffle warning splices the reason into "is above <why> of $23,060" again'),
    ('test-jackpot-cap-15-oct.js', 'venueplay/app/members/host.html', '      out.hint=figure.charAt(0).toUpperCase()+figure.slice(1)+" is "+money(limit.cents)+"."+(why ? " "+why+"." : "")+" "+base;', '      out.hint=(limit.why||"Your state\'s figure")+": "+money(limit.cents)+". "+base;', 'the members hint runs the reason\'s own colon and figures into ours again'),
    # 18 Oct: bingo in the draw record (every ball, its source, withdrawn balls, with or without migration 103).
    ('test-bingo-draw-record-18-oct.js', 'venueplay-backend/worker/venueplay-game.js', "  (await bingoRecordRows(env, venueId)).forEach(function (r) { rows.push(r); });", '', 'the draw record has no bingo in it at all'),
    ('test-bingo-draw-record-18-oct.js', 'venueplay-backend/worker/venueplay-game.js', "    const balls = await sbGetAll(env, 'vp_bingo_draw_balls',", "    const balls = await sbGet(env, 'vp_bingo_draw_balls',", "a club's bingo record stops at 1,000 balls in silence"),
    ('test-bingo-draw-record-18-oct.js', 'venueplay-backend/worker/venueplay-game.js', "  const draws = await sbGetAll(env, 'vp_bingo_draws', 'venue_id=eq.' + enc(venueId) + '&select=id,mode", "  const draws = await sbGetAll(env, 'vp_bingo_draws', 'select=id,mode", "every venue's bingo balls land in one venue's file"),
    ('test-bingo-draw-record-18-oct.js', 'venueplay-backend/worker/venueplay-game.js', "'&select=id,mode,fallback_at,fallback_why,created_at&order=created_at.asc,id.asc');\n  if (!draws.length) return out;", "'&select=*&order=created_at.asc,id.asc');\n  if (!draws.length) return out;", "the export reads the server's secret ball order and seed"),
    ('test-bingo-draw-record-18-oct.js', 'venueplay-backend/worker/venueplay-game.js', "  if (withdrawnColumnMissing(res.status, text)) return false;", '', 'before migration 103 the draw record fails outright'),
    ('test-bingo-draw-record-18-oct.js', 'venueplay-backend/worker/venueplay-game.js', "  if (res.ok) return true;\n  const text = await res.text();\n  if (withdrawnColumnMissing(res.status, text)) return false;", "  if (res.ok) return true;\n  const text = await res.text();\n  return false;", 'a database failure is read as migration 103 not run'),
    ('test-bingo-draw-record-18-oct.js', 'venueplay-backend/worker/venueplay-game.js', "        outcome: b.withdrawn_at ? 'WITHDRAWN at '", "        outcome: false ? 'WITHDRAWN at '", 'a ball taken back reads as called on the record'),
    ('test-bingo-draw-record-18-oct.js', 'venueplay-backend/worker/venueplay-game.js', "  const cols = 'draw_id,ordinal,number,source,drawn_at' + (withdrawnCol ? ',withdrawn_at' : '');", "  const cols = 'draw_id,ordinal,number,source,drawn_at';", 'the withdrawn column is never asked for, so no ball is ever marked withdrawn'),
    ('test-bingo-draw-record-18-oct.js', 'venueplay-backend/worker/venueplay-game.js', "    if (draw && draw.fallback_why === CALLER_REASON) return 'real ball caller';", '', 'real balls are recorded as a tablet fallback'),
    ('test-bingo-draw-record-18-oct.js', 'venueplay-backend/worker/venueplay-game.js', "  if (source === 'server') return 'server draw';", '', 'a server ball is not called a server draw'),
    ('test-bingo-draw-record-18-oct.js', 'venueplay-backend/worker/venueplay-game.js', "    return 'tablet fallback' + (draw && draw.fallback_why ? ': ' + draw.fallback_why : '');", "    return 'tablet fallback';", 'the fallback reason is dropped from the record'),
    ('test-bingo-draw-record-18-oct.js', 'venueplay-backend/worker/venueplay-game.js', "        drawId: b.draw_id || '', order: b.ordinal != null ? b.ordinal : '', source: bingoSourceWord(b.source, d) });", "        drawId: '', order: '', source: bingoSourceWord(b.source, d) });", 'a bingo row does not say which game or which call'),
    ('test-bingo-draw-record-18-oct.js', 'venueplay-backend/worker/venueplay-game.js', "  await requireStaff(env, authUserId, venueId);                   // ENFORCED: staff at THIS venue (also kill-switch)\n  const rows = await drawsRecordRows(env, venueId);", "  const rows = await drawsRecordRows(env, venueId);", "a host at another venue downloads this venue's bingo record"),
    ('test-bingo-draw-record-18-oct.js', 'venueplay/app/index.html', "<script src=\"/app/vp-drawrecord.js\"></script>\n<!-- VP-DRAW", "<!-- VP-DRAW", 'the bingo console button cannot download: the helper is not loaded'),
    ('test-bingo-draw-record-18-oct.js', 'venueplay/app/index.html', "    VPDrawRecord.download({ api:VP_GAME_API, venueId:(v && v.id) || \"\", getToken:vpHostToken,", "    VPDrawRecord.download({ api:VP_GAME_API, venueId:\"\", getToken:vpHostToken,", "the bingo console asks for no venue's record"),
    ('test-bingo-draw-record-18-oct.js', 'venueplay/app/index.html', "          <button type=\"button\" class=\"btn ghost\" id=\"downloadRecordBtn\" style=\"margin-top:12px;width:100%\">Download draw record</button>\n          <div class=\"note\" id=\"downloadRecordMsg\" style=\"margin-top:4px\"></div>\n        </div>", "        </div>", 'the bingo console has no Download draw record button'),
    # 15 Oct compliance build (Anisimoff letters): the rules, the hard block, phones, the age tick.
    ('assess() on the paid path matches the Anisimoff tables; the gate offers free entry, never a paid game, where the state says no', 'venueplay/app/vp-gaming.js', "      out.ok = false; out.hardBlock = true;\n      out.headline = 'In ' + st.name", "      out.ok = false;\n      out.headline = 'In ' + st.name", 'a venue that may not charge is still offered a paid game'),
    ('test-gaming-rules-letters-15-oct.js', 'venueplay/app/vp-gaming.js', "    if (rule.permit === 'required' && !out.permitRecorded) {", '    if (false) {', 'paid bingo in Victoria starts with no permit on record (s8.4.4)'),
    ('test-gaming-rules-letters-15-oct.js', 'venueplay/app/vp-gaming.js', "      if (String(k.number || '').trim()) return true;", "      if (String(k.number || '').trim()) return false;", 'a recorded permit number does not count'),
    ('test-gaming-rules-letters-15-oct.js', 'venueplay/app/vp-gaming.js', "        members: [700000, 'NSW progressive lottery", "        members: [3000000, 'NSW progressive lottery", 'the NSW members jackpot figure is wrong'),
    ('test-gaming-rules-letters-15-oct.js', 'venueplay/app/vp-gaming.js', "(a.hardBlock ? 'Start as a free-entry game' : 'I understand, start the game')", "'I understand, start the game'", 'the blocked popup still says start the game'),
    ('test-gaming-rules-letters-15-oct.js', 'venueplay/app/vp-gaming.js', '        arg = { free: true };', '        arg = undefined;', 'the console is never told to switch the game to free'),
    ('test-gaming-rules-letters-15-oct.js', 'venueplay/app/vp-gaming.js', "      phones: { bingo: true },\n      ads: 'A housie ad in ACT", "      phones: { bingo: false },\n      ads: 'A housie ad in ACT", 'ACT phones go back off'),
    ('test-gaming-rules-letters-15-oct.js', 'venueplay/app/vp-gaming.js', "           'game, including permits, attendance and age rules.';", "           'game.';", 'the declaration loses the every-law line'),
    ('test-gaming-rules-letters-15-oct.js', 'venueplay/app/vp-gaming.js', '      var thisGameIsPaid = opts.freeEntry ? false', '      var thisGameIsPaid = opts.freeEntry ? true', 'a members draw is gated as a paid game and blocked'),
    ('test-gaming-rules-letters-15-oct.js', 'venueplay/app/vp-gaming.js', "    if (st.ads) out.warnings.push(st.ads);", '', 'nobody is told what an ad must not do'),
    # 16 Oct live-audit fixes: switched-off paid entry is a hard block; Victorian raffles have no cash prizes.
    ('test-gaming-rules-letters-15-oct.js', 'venueplay/app/vp-gaming.js', "      out.ok = false; out.hardBlock = true;\n      out.headline = 'Paid entry is switched off for this venue.';", "      out.ok = false;\n      out.headline = 'Paid entry is switched off for this venue.';", '"Paid entry is switched off" still offers "I understand, start the game" and the console keeps its paid mode'),
    ('test-gaming-rules-letters-15-oct.js', 'venueplay/app/vp-gaming.js', "        raffle: paid ? [0, 'Victoria raffle: no cash prizes at all", "        raffle: paid ? [2306000, 'Victoria raffle: no cash prizes at all", 'a Victorian raffle warns only above $23,060 in cash, where the letter says no cash at all'),
    ('test-gaming-rules-letters-15-oct.js', 'venueplay/app/vp-gaming.js', "    return { cents: row[0], why: row[1], where: FIGURE_PHRASE[state] || ('the ' + st.name + ' figure') };", "    return { cents: row[0], why: row[1] };", 'the consoles lose the state name and every warning falls back to "your state\'s figure"'),
    ('test-gaming-rules-letters-15-oct.js', 'venueplay/app/vp-gaming.js', "                        ACT: 'the figure for ACT',", "                        ACT: 'the ACT figure',", 'a Canberra raffle console reads "above the ACT figure"'),
    ('age_gate and paper_bingo follow the letters on /play/live and /join/info, and the phone holds its ticket until the tick', 'venueplay-backend/worker/venueplay-game.js', "const PAPER_BINGO_STATES = new Set(['SA', 'VIC', 'TAS']);", "const PAPER_BINGO_STATES = new Set(['SA', 'ACT', 'TAS']);", 'ACT phones blanked and Victoria dealt phone tickets'),
    ('test-play-live-age-gate-15-oct.js', 'venueplay-backend/worker/venueplay-game.js', "  if (st === 'ACT') return kind === 'bingo';", "  if (st === 'ACT') return false;", 'ACT housie never asks the age'),
    ('test-play-live-age-gate-15-oct.js', 'venueplay-backend/worker/venueplay-game.js', "             : null;                                   // trivia, musical, musical_bingo: never", "             : 'bingo';                                // trivia, musical, musical_bingo: never", 'a trivia or musical phone is asked its age'),
    ('test-play-live-age-gate-15-oct.js', 'venueplay-backend/worker/venueplay-game.js', '    if (liveNow && vrows && vrows[0]) ageGate = ageGateFor(vrows[0].au_state, format);', '', '/join/info never asks: the phone page reads nothing'),
    ('test-play-live-age-gate-15-oct.js', 'venueplay-backend/worker/venueplay-game.js', '  }, phoneRules(format, sessions[0])));', '  }));', '/play/live for a live night carries no age_gate'),
    ('test-play-live-age-gate-15-oct.js', 'venueplay/play.html', '    if(_ageHold){ _agePendingJoin=true; return; }', '', 'the phone asks for a ticket before the tick'),
    ('test-play-live-age-gate-15-oct.js', 'venueplay/play.html', '    if(saved==="need"){ _ageHold=true; requireAge18(); }     // asked earlier this session, not yet ticked', '', 'a reload before the tick deals the ticket with no tick'),
    ('test-play-live-age-gate-15-oct.js', 'venueplay/play.html', '    try{ sessionStorage.setItem(ageKey(),"ok"); }catch(e){}', '', 'every reload asks the age again'),
    ('test-play-live-age-gate-15-oct.js', 'venueplay/play.html', '    if(!(r && r.age_gate===true)) return;                   // this venue\'s state does not ask: nothing held', '    if(!r) return;', 'every phone everywhere is asked its age, and held on a missing answer'),
    # 16 Oct live-audit fixes: a quiet night asks nothing; the notice and the tick come down again.
    ('test-play-live-age-gate-15-oct.js', 'venueplay-backend/worker/venueplay-game.js', "  if (!sessions.length) return json({ exists: true, name, live: false, paper_bingo: false, age_gate: false });", "  if (!sessions.length) return json(Object.assign({ exists: true, name, live: false }, phoneRules('')));", 'an idle Victorian phone is told it plays on paper, and an idle ACT phone is asked its age, before anything is on'),
    ('test-play-live-age-gate-15-oct.js', 'venueplay-backend/worker/venueplay-game.js', '  let liveNow = false;', '  let liveNow = true;', '/join/info blanks an idle Victorian phone on a quiet night'),
    ('test-play-live-age-gate-15-oct.js', 'venueplay-backend/worker/venueplay-game.js', "    const paperFormat = liveNow && (!format || format.indexOf('bingo') === 0);", "    const paperFormat = liveNow && (!format || format.indexOf('bingo') === 0) && false;", 'a Victorian bingo lobby no longer puts the phone on paper'),
    ('test-play-live-age-gate-15-oct.js', 'venueplay/play.html', '  function hidePaperBingo(){\n    if(!_paper) return;\n    _paper=false;', '  function hidePaperBingo(){\n    return;\n    _paper=false;', 'the paper notice never comes down once shown'),
    ('test-play-live-age-gate-15-oct.js', 'venueplay/play.html', '    try{ document.body.appendChild(d); _paperBox=d; }catch(e){ _paperBox=null; }', '    try{ document.body.innerHTML=""; document.body.appendChild(d); }catch(e){}', 'the paper notice wipes the page again, so nothing can bring it back'),
    ('test-play-live-age-gate-15-oct.js', 'venueplay/play.html', '  function ageClear(){\n    if(!_ageHold && !_ageBox) return;', '  function ageClear(){\n    return;', 'a tick stays up, holding the join, after the lobby that asked has closed'),
    ('test-play-live-age-gate-15-oct.js', 'venueplay/play.html', '            if(d.paper_bingo===true) showPaperBingo(d.paper_reason); else hidePaperBingo();\n            if(d.age_gate===true) ageAnswer(d); else if(d.age_gate===false) ageClear();\n            if(P.active) return;', '            if(P.active) return;', 'a phone off a table talker never acts on a paper or age flag that arrives once the lobby opens'),
    ('test-play-live-age-gate-15-oct.js', 'venueplay/play.html', '          if(r && r.paper_bingo){ showPaperBingo(r.paper_reason); if(++tries<225) setTimeout(look, 8000); return; }\n          hidePaperBingo();\n          if(r && r.age_gate===true) ageAnswer(r); else if(r && r.age_gate===false) ageClear();', '          if(r && r.paper_bingo){ showPaperBingo(); return; }', 'a phone that typed the code stops asking once told paper, and never follows the room to trivia'),
    ('test-play-live-age-gate-15-oct.js', 'venueplay/play.html', '        "background:rgba(8,6,12,.97);display:flex;align-items:center;overflow-y:auto;"+', '        "background:rgba(8,6,12,.92);display:flex;align-items:center;overflow-y:auto;"+', 'the JOIN button reads through the age backdrop at desktop width'),
    # 17 Oct 2026: caller mode, a bingo night called with real balls (tools/test-caller-mode.js).
    ('test-caller-mode.js', 'venueplay/play.html', '    reason=(reason==="caller") ? "caller" : "state";', '    reason="state";', 'the paper notice drops the real-balls reason it was given'),
    ('test-caller-mode.js', 'venueplay/app/index.html', '    if(G.caller) return 0;\n', '', 'a seated phone is dealt a ticket on a real-balls night'),
    ('test-caller-mode.js', 'venueplay/app/index.html', 'if(!p||!p.cards||G.caller) return;', 'if(!p||!p.cards) return;', 'the console sends phones a tickets message on a paper-book night'),
    ('test-caller-mode.js', 'venueplay/app/index.html', '    if(G.caller) return;   // real balls: the numbers come off the grid', '    // real balls: the numbers come off the grid', 'Next number draws a ball from the console on a real-balls night'),
    ('test-caller-mode.js', 'venueplay/app/index.html', '    var k=G.pool.indexOf(n);\n    if(k<0){ showToast(n+" has already been called."); return false; }', '    var k=G.pool.indexOf(n);\n    if(false){ showToast(n+" has already been called."); return false; }', 'a number already called can be tapped and called again'),
    ('test-caller-mode.js', 'venueplay/app/index.html', '    if(n===last) return callerUndo();', '    if(false) return callerUndo();', 'a long press on the last number takes nothing back'),
    ('test-caller-mode.js', 'venueplay/app/index.html', 'grid.addEventListener("click", function(e){ if(swallow){ swallow=false; return; }', 'grid.addEventListener("click", function(e){ if(false){ swallow=false; return; }', 'the click after a long press calls the withdrawn number straight back'),
    ('test-caller-mode.js', 'venueplay/app/index.html', '    sendState();\n    var since=Date.now()-(G._callerAt||0), gen=G.gen, len=G.draw.length;', '    var since=Date.now()-(G._callerAt||0), gen=G.gen, len=G.draw.length;', 'an undo is not sent to the TV, so the wall keeps the withdrawn number'),
    ('test-caller-mode.js', 'venueplay/app/index.html', '    if(since<CALLER_REVEAL_MS) setTimeout(', '    if(false) setTimeout(', 'an undo inside the big-number reveal leaves the withdrawn ball on the wall'),
    ('test-caller-mode.js', 'venueplay/app/index.html', '          caller:!!G.caller,   // real balls tonight', '          // real balls tonight', 'a tablet reload loses caller mode and goes back to the draw'),
    ('test-caller-mode.js', 'venueplay/app/index.html', '    if(typeof s.caller==="boolean"){ G.caller=s.caller;', '    if(false){ G.caller=s.caller;', 'a tablet reload ignores the saved caller mode'),
    ('test-caller-mode.js', 'venueplay/app/index.html', '      var b={ draw_id:G.drawId, number:body.number, ordinal:body.ordinal, reason:"caller" };', '      var b={ draw_id:G.drawId, number:body.number, ordinal:body.ordinal, reason:"worker unreachable" };', 'the record says the balls came from a dead server, not a real draw'),
    ('test-caller-mode.js', 'venueplay/app/index.html', 'VP.gameApiPost("/session", { venue_id: v.id, format: "bingo", caller: !!G.caller })', 'VP.gameApiPost("/session", { venue_id: v.id, format: "bingo" })', 'the server never hears it is a real-balls night, so phones are not told'),
    ('test-caller-mode.js', 'venueplay/app/index.html', 'G.caller ? { venue_id:v.id, session_id:G.sessionId||null, caller:true } : ', '', 'the draw opens as a server draw on a real-balls night'),
    ('test-caller-mode.js', 'venueplay/app/index.html', '      el.className="cg"+(G.called[n]?" on":"")+(n===cur?" cur":"");', '      el.className="cg"+(n===cur?" cur":"");', 'the grid stops marking the numbers already called'),
    ('test-caller-mode.js', 'venueplay/app/index.html', '    var tf=$("ticketsField"); if(tf) tf.style.display = on ? "none" : "";', '    var tf=$("ticketsField");', 'the paid ticket settings stay on the form for a paper-book night'),
    ('test-caller-mode.js', 'venueplay/app/index.html', '    var cc=$("callerChk"); if(cc) cc.disabled = (G.status!=="setup");', '    var cc=$("callerChk");', 'the option can be flipped in the middle of an open night'),
    ('test-caller-mode.js', 'venueplay-backend/worker/venueplay-game.js', "    mode: 'local', fallback_at: 1, fallback_why: CALLER_REASON,\n", '', 'a real-balls draw opens as a server draw and the server will hand out balls on it'),
    # 17 Oct 2026, certification review: an undo KEEPS the ball's row, marked withdrawn (migration 103),
    # and a caller night makes no shuffle at all.
    ('test-caller-mode.js', 'venueplay-backend/worker/venueplay-game.js', "    draw_seed: CALLER_NO_SEED,\n    draw_order: [],", "    draw_seed: randomTokenHex(16),\n    draw_order: shuffle1to90(),", 'a real-balls night shuffles and stores an order nobody uses'),
    ('test-caller-mode.js', 'venueplay-backend/worker/venueplay-game.js', '    const marked = await markBallWithdrawn(env, which);', '    const marked = null;', 'an undo deletes the ball off the record instead of marking it withdrawn'),
    ('test-caller-mode.js', 'venueplay-backend/worker/venueplay-game.js', "  const res = await fetch(env.SUPABASE_URL + '/rest/v1/vp_bingo_draw_balls?' + query + '&withdrawn_at=is.null', { headers: sbHeaders(env) });", "  const res = await fetch(env.SUPABASE_URL + '/rest/v1/vp_bingo_draw_balls?' + query, { headers: sbHeaders(env) });", 'the last-call check counts a withdrawn ball as the last call'),
    ('test-caller-mode.js', 'venueplay-backend/worker/venueplay-game.js', "      await sbDelete(env, 'vp_bingo_draw_balls', which);", '', 'before migration 103 an undo leaves the withdrawn ball standing on the record'),
    ('test-caller-mode.js', 'venueplay-backend/worker/venueplay-game.js', '  return status === 400 && /withdrawn_at/.test(String(text || \'\')) &&', '  return false && /withdrawn_at/.test(String(text || \'\')) &&', 'before migration 103 an undo fails with a database error instead of falling back'),
    ('test-caller-mode.js', 'venueplay-backend/worker/venueplay-game.js', "    if (!marked.length) return json({ error: 'That is not the last call' }, 409);", '', 'an undo that marked nothing still says it was kept'),
    ('test-caller-mode.js', 'venueplay-backend/worker/venueplay-game.js', "    if (!last.length || last[0].ordinal !== ordinal || last[0].number !== number || last[0].source !== 'local') {", '    if (!last.length) {', 'any ball on the record can be withdrawn, not only the last call'),
    ('test-caller-mode.js', 'venueplay-backend/worker/venueplay-game.js', "    if (!callerBall || draw.mode !== 'local' || draw.fallback_why !== 'caller') {", '    if (!callerBall) {', 'a ball on a night that is not real balls can be withdrawn'),
    ('test-caller-mode.js', 'venueplay-backend/worker/venueplay-game.js', '    paperBingo = true; paperReason = CALLER_REASON;', '    paperReason = CALLER_REASON;', '/join/info hands a phone a ticket on a real-balls night'),
    ('test-caller-mode.js', 'venueplay-backend/worker/venueplay-game.js', '      paper_bingo: caller || state,', '      paper_bingo: state,', '/play/live hands a table-talker phone a ticket on a real-balls night'),
    ('test-caller-mode.js', 'venueplay-backend/worker/venueplay-game.js', '  if (callerAsked !== null) await noteCallerBingo(env, session, callerAsked);', '', 'a new real-balls session is never marked, so no phone is told'),
    ('test-caller-mode.js', 'venueplay-backend/worker/venueplay-game.js', '    if (callerAsked !== null) await noteCallerBingo(env, liveNow[0], callerAsked);', '', "a reused session keeps last lobby's real-balls mark"),
    ('test-caller-mode.js', 'venueplay-backend/worker/venueplay-game.js', "  if (liveNow && (!format || format.indexOf('bingo') === 0) && callerBingoNight(liveSession)) {", '  if (liveNow && callerBingoNight(liveSession)) {', 'a trivia lobby on a real-balls session blanks every phone'),
    ('test-caller-mode.js', 'venueplay-backend/worker/venueplay-game.js', "  const callerAsked = (lobbyFormat(b.format) === 'bingo90' && typeof b.caller === 'boolean') ? b.caller : null;", "  const callerAsked = (lobbyFormat(b.format) === 'bingo90') ? !!b.caller : null;", 'an older console that sends no caller field wipes the mark'),
    ('test-caller-mode.js', 'venueplay/play.html', '    return reason==="caller"', '    return reason==="never"', "a real-balls night tells the phone it is the state's rules"),
    ('test-caller-mode.js', 'venueplay/play.html', '            if(d.paper_bingo===true) showPaperBingo(d.paper_reason); else hidePaperBingo();', '            if(d.paper_bingo===true) showPaperBingo(); else hidePaperBingo();', 'a table-talker phone is told the wrong reason for paper'),
    # 17 Oct 2026, for Drag Bingo on 24 Oct: no join furniture on a real-balls TV, and the WINNER button.
    ('test-caller-mode.js', 'venueplay/tv.html', '    if(_real) $("tvJoinCorner").classList.add("hidden");   // no join badge', '', 'the Join now corner (QR and code) is back beside the board on a real-balls night'),
    ('test-caller-mode.js', 'venueplay/tv.html', '    if(state.phase==="lobby" && state.caller){ showBingoLayer("tvRun"); renderRun(); }', '    if(false){ showBingoLayer("tvRun"); renderRun(); }', 'a real-balls lobby puts the QR join screen on the TV'),
    ('test-caller-mode.js', 'venueplay/tv.html', '      if(m.mode==="bingo"){ if(typeof m.caller==="boolean") state.caller=m.caller; enterBingo(); }', '      if(m.mode==="bingo"){ enterBingo(); }', 'the join screen flashes up before the first state message says real balls'),
    ('test-caller-mode.js', 'venueplay/tv.html', '    if(_t) _t.style.display = _real ? "" : "none";', '    if(_t) _t.style.display = "none";', 'the game title never stands where the join code was on a real-balls night'),
    ('test-caller-mode.js', 'venueplay/tv.html', '{ state.caller=false; enterAds(); return; }', '{ enterAds(); return; }', 'the ads do not forget a real-balls night'),
    ('test-caller-mode.js', 'venueplay/tv.html', '      if(tvMode==="bingo" && typeof m.caller==="boolean") state.caller=m.caller;', '      if(typeof m.caller==="boolean") state.caller=m.caller;', 'the last state message of End game carries real balls into the ads'),
    ('test-caller-mode.js', 'venueplay/tv.html', '    var paper=!!m.caller;', '    var paper=false;', 'a real-balls win names a phone player and card instead of the stage and prize'),
    ('test-caller-mode.js', 'venueplay/tv.html', '    $("winSubPaper").style.display = paper ? "" : "none";', '    $("winSubPaper").style.display = "none";', 'the splash never says Show your book to the host'),
    ('test-caller-mode.js', 'venueplay/tv.html', '      if(again){ applyBingo(); return; }', '', 'every wall fanfares again when one TV reloads mid-win'),
    ('test-caller-mode.js', 'venueplay/app/index.html', '    if(G.callerWin){ showToast("The win is still on the TV. Tap Back to the game first."); return false; }\n    if(G.won){', '    if(G.won){', 'a number tapped while the win is up is called over the splash'),
    ('test-caller-mode.js', 'venueplay/app/index.html', '    send({ t:"resume" });   // every TV back to the board', '', 'Back to the game leaves every TV on the splash'),
    ('test-caller-mode.js', 'venueplay/app/index.html', '    if(nxt){ G.pattern=nxt; var ps=$("patternSel"); if(ps) ps.value=nxt; }', '    if(nxt){ }', 'after a line the room is not moved on to two lines'),
    ('test-caller-mode.js', 'venueplay/app/index.html', '    if(stands) callerWinRecord(w);', '    callerWinRecord(w);', 'Not a win after all still records a win and moves the game on'),
    ('test-caller-mode.js', 'venueplay/app/index.html', 'name:"", winners:[], shared:false, cont:false };', 'name:"", winners:[], shared:false, cont:true };', 'the splash times itself out instead of waiting for Back to the game'),
    ('test-caller-mode.js', 'venueplay/app/index.html', '        if(G.caller && G.callerWin) send(callerWinMsg());', '', 'a TV that reloads mid-win is never shown the win again'),
    ('test-caller-mode.js', 'venueplay/app/index.html', '    var pz=$("cwPrize"); if(pz) pz.value=(G.prize && G.prize!=="the prize") ? G.prize : "";', '    var pz=$("cwPrize"); if(pz) pz.value="";', 'the winner sheet forgets the prize set up at the start'),
    ('test-caller-mode.js', 'venueplay/app/index.html', '    send({ t:"mode", mode:"bingo", caller:!!G.caller });   // TV switches from ads to the join screen', '    send({ t:"mode", mode:"bingo" });   // TV switches from ads to the join screen', 'the mode message does not say real balls, so the join screen flashes up'),
    ('test-caller-mode.js', 'venueplay/app/index.html', '      G.callerWin=(s.callerWin && typeof s.callerWin==="object" && s.callerWin.pattern) ? s.callerWin : null;', '      G.callerWin=null;', 'a console reload loses the win on the TV and its Back to the game'),
    ('test-caller-mode.js', 'venueplay/app/index.html', "    if(G.callerWin) callerWinSettle();   // a real-balls win still on the TV counts: the room saw it\n    postReport();   // send this game's figures", "    postReport();   // send this game's figures", 'End game drops a win still on the TV from the report of the night'),
    ('test-caller-mode.js', 'venueplay/app/index.html', '(_real ? "Put bingo on the TV" : "Open lobby")', '"Open lobby"', 'the setup button talks about a lobby on a real-balls night'),
    ('test-caller-mode.js', 'venueplay/app/index.html', '    $("ngGo").textContent = G.caller ? "Start next game" : "Deal tickets";', '', 'New game offers to deal tickets on a paper-book night'),
    ('test-caller-mode.js', 'venueplay/app/index.html', '    while(p && out.indexOf(p)<0 && out.length<4){ out.push(p); p=nextPattern(p); }', '    if(p) out.push(p);', 'WINNER offers only the current stage, not the stages after it'),
    ('test-caller-mode.js', 'venueplay/app/index.html', '    #bingoView.callermode .callergrid{gap:2px;margin:0 -10px}', '    #bingoView.callermode .callergrid{gap:4px;margin:0 -10px}', 'the numbers shrink under 34px on a 375px phone'),
    ('test-caller-mode.js', 'venueplay/app/index.html', '    var pp=$("playersPanel"); if(pp) pp.style.display = on ? "none" : "";', '    var pp=$("playersPanel");', 'the players panel tells a paper-book room to scan the QR'),
    ('test-caller-mode.js', 'venueplay/app/index.html', '    #bingoView.callermode .callergrid .cg{min-height:34px;', '    #bingoView.callermode .callergrid .cg{min-height:30px;', 'a number on a phone can be shorter than a thumb'),
    # 14 Oct fix round: PartyPlay.
    ('pp-realtime-auth.test.js', 'partyplay/lib/pp-sign.js', '          if (v === "ok") { deliver(cb, payload); return; }', '          deliver(cb, payload); return;', "a stranger's forged caption goes on the PartyPlay telly even once the party has a key"),
    ('pp-realtime-auth.test.js', 'partyplay/lib/pp-sign.js', '      }).then(function (d2) { if (d2 && d2.exists) return useKey(d2, code); });   // only a key the Worker holds is used', '      }).then(function () {});', 'the PartyPlay console never signs anything, so the telly and phones can be spoken for by anyone'),
    ('pp-realtime-auth.test.js', 'partyplay/lib/pp-sign.js', '    if (!p._n || S.seen[p._n]) return Promise.resolve("replay");', '    if (!p._n) return Promise.resolve("replay");', "the host's own earlier caption, recorded and played back, goes up on the telly again"),
    ('pp-realtime-auth.test.js', 'partyplay/lib/pp-phonekey.js', '            if (pid !== m.pid) return null;', '', "a stranger signs with his own key, pastes Alice's pid on it, and answers trivia as Alice"),
    ('pp-realtime-auth.test.js', 'partyplay/run.html', "    if(L.byPid[pid]){ bound[L.byPid[pid].name.toLowerCase()] = pid; return { name:L.byPid[pid].name }; }   // the Worker's word wins", '    if(L.byPid[pid]){ bound[L.byPid[pid].name.toLowerCase()] = pid; return { name:nm || L.byPid[pid].name }; }', "a guest types somebody else's name into their own phone's message and is scored as them"),
    ('pp-realtime-auth.test.js', 'partyplay/run.html', '      if(r.pid) return { refuse:"that guest\'s phone has a key" };', '', "an unsigned answer in a keyed guest's name is counted, so anybody can answer as Alice"),
    ('pp-realtime-auth.test.js', 'partyplay/run.html', '      if(!r) return final ? { refuse:"not on the party\'s guest list" } : { unknown:true };', '      if(!r) return { name:nm };', 'a made-up name saying hello on the channel is let into the party past the guest list and the fifty cap'),
    ('pp-realtime-auth.test.js', 'partyplay/play.html', '        if(PPS) PPS.gate(e.payload, function(m){ if(_ppChannel === ch) onMsg(m); });', '        if(false) PPS.gate(e.payload, function(m){ if(_ppChannel === ch) onMsg(m); });', 'a forged prize draw tells a guest "You won" on their own phone'),
    ('pp-realtime-auth.test.js', 'partyplay/tv.html', '      ch.on("broadcast", { event:"msg" }, function(e){ if(PPS) PPS.gate(e.payload, onMsg); else onMsg(e.payload); });', '      ch.on("broadcast", { event:"msg" }, function(e){ onMsg(e.payload); });', 'anybody who can read the code puts their own caption on the PartyPlay telly'),
    ('pp-realtime-auth.test.js', 'partyplay/tv.html', '      if(m.url && String(m.url).indexOf(PPConfig.API + "/game/photo?") !== 0) m.url = "";', '', 'a photo from anywhere on the internet goes up on the PartyPlay telly'),
    ('pp-realtime-auth.test.js', 'partyplay/play.html', '      return api("/join", { method:"POST", body: JSON.stringify({ code:code, nickname:nickname, prev: had.token || had.prev || "", pid: pid || "" }) });', '      return api("/join", { method:"POST", body: JSON.stringify({ code:code, nickname:nickname, prev: had.token || had.prev || "" }) });', "a guest's phone never tells the Worker its key, so the console cannot tell it from a stranger"),
    ('pp-realtime-auth.test.js', 'partyplay-backend/worker/SOURCE-do-not-paste-partyplay-api.js', '  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }', '  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777613); }', "the console builds a different bingo ticket from the guest's, and refuses every real claim"),
    ('pp-realtime-auth.test.js', 'partyplay/lib/pp-config.js', '      return /^[ACDEFGHJKMNPQRSTUVWXYZ34679]{6}$/.test(this.code(input));', '      return /^[A-Z0-9]{2,9}$/.test(this.code(input));', 'the telly and the Worker disagree about what a party code is'),
    ('pp-fixes-15-oct.test.js', 'partyplay/run.html', '    if(lastWall){ var w=JSON.parse(JSON.stringify(lastWall)); w.tvOnly=true; send(w); }', '', 'a PartyPlay telly that wakes up mid-game shows "Join the party" until the host presses something'),
    ('pp-fixes-15-oct.test.js', 'partyplay/play.html', '    if(m.tvOnly) return;', '', "the telly's picture, sent again for a telly that woke up, wipes a guest's phone"),
    ('pp-fixes-15-oct.test.js', 'partyplay/play.html', '    if(m && m.last != null && +m.last >= 1 && +m.last <= 90){ B.last = +m.last; B.lastSaid = m.said || ""; }\n    else if(B.last == null && m && Array.isArray(m.called) && m.called.length){ B.last = +m.called[m.called.length - 1]; }', '', 'a guest who walks in mid-bingo, or a console that reloads, leaves every phone on "--"'),
    ('pp-fixes-15-oct.test.js', 'partyplay/run.html', '      if(full ? !p.fullHouse : !p.hasLine){', '      if(false){', "a bingo line made of called numbers that are not on the guest's ticket is announced"),
    ('pp-fixes-15-oct.test.js', 'partyplay/run.html', '    if((full ? G.won.full : G.won.line).indexOf(name) >= 0) return "already";      // announced once is enough', '', 'the same guest is announced for the same line twice'),
    ('pp-fixes-15-oct.test.js', 'partyplay/run.html', '    if(!full && G.won.line.length && G.won.lineAt !== G.called.length){', '    if(false){', 'a second line is announced a ball after the line was won'),
    ('pp-fixes-15-oct.test.js', 'partyplay/run.html', '    if(!G.pool.length || G.won.full.length) return;     // nothing is called after a full house', '    if(!G.pool.length) return;', 'the host keeps calling numbers after a full house'),
    ('pp-fixes-15-oct.test.js', 'partyplay/play.html', '    } else if(p.hasLine && !lineGone && !claimed.line){', '    } else if(p.hasLine){', 'a guest is offered "Line! Shout out" for a line that has gone, or that they already shouted'),
    ('pp-fixes-15-oct.test.js', 'partyplay/play.html', '      if(m.to && m.to !== ((load()||{}).nickname || "")) return;\n      if(T && T.kind === "truths") return;', '', 'a late guest walking into two truths wipes what everybody else is half way through typing'),
    ('pp-fixes-15-oct.test.js', 'partyplay/play.html', '      if(DRW !== null && String(m.text == null ? "" : m.text) !== DRW) DRW = null;', '', 'after a prize draw every phone stays on the result when the next game starts with only a caption'),
    ('pp-fixes-15-oct.test.js', 'partyplay/run.html', '  .ask{position:fixed;inset:0;background:rgba(6,4,10,.8);display:grid;place-items:center;z-index:60;padding:16px}', '', 'the charades "Before you start" warning renders as loose text under a Start button already pressed'),
    ('pp-fixes-15-oct.test.js', 'partyplay/run.html', '    if(G.i < 0) warnScreens("charades");   // before the first actor; a console picking a round back up has had it', '', 'charades starts with no warning to keep the actor away from every screen'),
    ('pp-fixes-15-oct.test.js', 'partyplay/lib/pp-quiz.js', '    var names = top > 0 ? (rows || [])', '    var names = top >= 0 ? (rows || [])', 'a round where nobody scored ends with somebody "winning" on 0'),
    ('pp-fixes-15-oct.test.js', 'partyplay/run.html', '        if(e && (e.status===403 || e.status===404)){', '        if(false){', 'a mistyped host key is a dead end with nothing to press'),
    ('pp-fixes-15-oct.test.js', 'partyplay/tv.html', '    if(PPConfig.valid && !PPConfig.valid(CODE)){', '    if(false){', 'the PartyPlay telly puts any two characters up as the join code'),
    ('pp-fixes-15-oct.test.js', 'partyplay/booked.html', '  if(!PPConfig.valid(code)){', '  if(false){', '/booked tells anybody with no code that they are booked'),
    ('pp-fixes-15-oct.test.js', 'partyplay/unsubscribe.html', '      body: JSON.stringify({ email: email, t: tok })', '      body: JSON.stringify({ email: email })', "the unsubscribe page drops the email's proof token, so a signed link is treated like a forged one"),
    ('pp-fixes-15-oct.test.js', 'partyplay/lib/pr-phone.js', '(t.why === "no_guesses" ? "no guesses left" : "not on the board")', '"not on the board"', 'a Great Minds guess past the third says "not on the board" instead of "no guesses left"'),
    ('pp-fixes-15-oct.test.js', 'partyplay/index.html', '  nav .go,.navr .signin{white-space:nowrap}', '', '"Book a party" wraps onto three lines in the header of a phone'),
    ('pp-worker-15-oct.test.js', 'partyplay-backend/worker/SOURCE-do-not-paste-partyplay-api.js', "    await sb(env, 'pp_licences?id=eq.' + encodeURIComponent(l.id) + '&sign_kid=is.null', {", "    await sb(env, 'pp_licences?id=eq.' + encodeURIComponent(l.id), {", "a second host console overwrites the party's key and every screen stops trusting the first"),
    ('pp-worker-15-oct.test.js', 'partyplay-backend/worker/SOURCE-do-not-paste-partyplay-api.js', 'async function handleSigningPrivate(request, env) {\n  const b = await request.json().catch(() => ({}));\n  const l = await requireHost(env, b.code, b.key);', "async function handleSigningPrivate(request, env) {\n  const b = await request.json().catch(() => ({}));\n  const l = (await sb(env, 'pp_licences?code=eq.' + normaliseCode(b.code) + '&select=*'))[0];", "anybody with the code on the telly can fetch the party's private signing key"),
    ('pp-worker-15-oct.test.js', 'partyplay-backend/worker/SOURCE-do-not-paste-partyplay-api.js', 'tseed: ticketSeed(r.token) })) });', 'tseed: ticketSeed(r.token), token: r.token })) });', "the guest list hands every guest's album token to the console"),
    ('pp-worker-15-oct.test.js', 'partyplay-backend/worker/SOURCE-do-not-paste-partyplay-api.js', '  const pidFree = pid && !(taken || []).some(r => r.pid === pid && (!me || r.id !== me.id));', '  const pidFree = !!pid;', 'a second guest can register a phone key somebody else already holds'),
    ('pp-worker-15-oct.test.js', 'partyplay-backend/worker/SOURCE-do-not-paste-partyplay-api.js', "  if (b.rejoin === true && !me) return json({ error: 'That phone is not a guest at this party.' }, 404);", '', 'a phone re-registering its key after a reload is added as a second guest and uses up one of the fifty'),
    ('pp-worker-15-oct.test.js', 'partyplay-backend/worker/SOURCE-do-not-paste-partyplay-api.js', '      if (!row.pid || !missingColumn(e)) throw e;', '      throw e;', 'until migration 16 is run nobody can join a party'),
    ('pp-worker-15-oct.test.js', 'partyplay-backend/worker/SOURCE-do-not-paste-partyplay-api.js', '  if (ipTag && (await checkoutsFrom(env, ipTag)) >= CHECKOUT_PER_HOUR) {', '  if (false) {', 'a script can open unlimited pending licences and live Stripe sessions from one address'),
    ('pp-worker-15-oct.test.js', 'partyplay-backend/worker/SOURCE-do-not-paste-partyplay-api.js', '  if (tok && !timingSafeEqual(tok, await unsubToken(env, email))) {', '  if (false) {', 'a forged unsubscribe link takes somebody else off the list and stops their reminder emails'),
    ('pp-worker-15-oct.test.js', 'partyplay-backend/worker/SOURCE-do-not-paste-partyplay-api.js', '      foot: \'<p style="margin:0"><a href="\' + site + \'/unsubscribe?e=\' + encodeURIComponent(l.buyer_email) +\n            \'&t=\' + (await unsubToken(env, l.buyer_email)) +', '      foot: \'<p style="margin:0"><a href="\' + site + \'/unsubscribe?e=\' + encodeURIComponent(l.buyer_email) +\n            \'\' +', "the follow-up email's unsubscribe link carries no proof it came from us"),
    # 14 Oct fix round: PartyPlay (three rows replace earlier ones whose text moved).
    ('test-room-chatter-14-oct.js', 'partyplay/play.html', '        H=null; DRW = m.winner ? String(m.winner) : "All out";', '        H=null;', 'the heads-or-tails winner is never told they won'),
    ('the reminder about an unused code can be stopped', 'partyplay-backend/worker/SOURCE-do-not-paste-partyplay-api.js', '            \'<p style="margin:10px 0 0"><a href="\' + site + \'/unsubscribe?e=\' + encodeURIComponent(l.buyer_email) +\n            \'&t=\' + (await unsubToken(env, l.buyer_email)) + \'" style="color:#8A8296">Unsubscribe</a></p>\'', "''", None),
    ('the "how was the party" follow-up can be stopped', 'partyplay-backend/worker/SOURCE-do-not-paste-partyplay-api.js', '      foot: \'<p style="margin:0"><a href="\' + site + \'/unsubscribe?e=\' + encodeURIComponent(l.buyer_email) +\n            \'&t=\' + (await unsubToken(env, l.buyer_email)) + \'" style="color:#8A8296">Unsubscribe</a></p>\'', "      foot: ''", None),
    ('test-musical-15-oct.js', 'venueplay/app/vp-onetab.js', 'var wait = flagged ? FLAG_WAIT_MS : ASK_MS;', 'var wait = ASK_MS;', 'Use this tab instead hands the game straight back to the old tab, which reloads first'),
    ('test-bingo-seat-15-oct.js', 'venueplay/app/index.html', '    setCoach();   // the setup line counts players too', '    void 0;   // the setup line counts players too', 'the setup line says 4 players are in beside a count of 3'),
    # 15 Oct: Punters Reckon and Great Minds answers moved behind the host login (boards now in the Workers).
    ('test-ta-match.js', 'venueplay-backend/worker/venueplay-game.js', 'also: ["nrl", "league", "rugby", "state of origin", "origin"]', 'also: ["nrl", "league", "footy", "rugby", "state of origin", "origin"]', 'Punters Reckon scores "footy" as rugby league, telling every AFL state they are wrong'),
    ('pp-great-minds.test.js', 'partyplay-backend/worker/SOURCE-do-not-paste-partyplay-api.js', 'also: ["nrl", "league", "rugby", "state of origin", "origin"]', 'also: ["nrl", "league", "footy", "rugby", "state of origin", "origin"]', 'Great Minds scores "footy" as rugby league, telling every AFL state they are wrong'),
    ('pp-great-minds.test.js', 'partyplay-backend/worker/SOURCE-do-not-paste-partyplay-api.js', '"Name a fast food chain"', '"Name a pub you would have a beer at"', 'a pub or beer board ends up in the PartyPlay game played at kids parties'),
    ('test-pr-boards-15-oct.js', 'venueplay-backend/worker/venueplay-game.js', "  await requireStaff(env, authUserId, venueId, 'host');\n  return json({ boards: PR_BOARDS });", "  return json({ boards: PR_BOARDS });", 'any signed-in host, at any venue, can read every Punters Reckon answer'),
    ('test-pr-boards-15-oct.js', 'venueplay-backend/worker/venueplay-game.js', "async function handlePRBoards(request, env, json) {\n  const authUserId = await verifyHostJwt(request, env);", "async function handlePRBoards(request, env, json) {\n  const authUserId = await verifyHostJwt(request, env).catch(function () { return null; });", 'the Punters Reckon boards route stops answering 401 to somebody with no login'),
    ('test-pr-boards-15-oct.js', 'venueplay-backend/worker/venueplay-game.js', "if (method === 'GET'  && path === '/host/pr/boards')", "if (path === '/host/pr/boards')", 'the Punters Reckon boards route answers any method, not just GET'),
    ('test-pr-boards-15-oct.js', 'venueplay-backend/worker/venueplay-game.js', "if (method === 'GET'  && path === '/host/pr/boards')", "if (method === 'GET'  && path === '/host/pr/boards-x')", 'the console asks for its Punters Reckon boards and the Worker says not found'),
    ('test-pr-boards-15-oct.js', 'venueplay-backend/worker/venueplay-game.js', "  return json({ boards: PR_BOARDS });\n}", "  await sbGet(env, 'vp_venues', 'select=id&limit=1');\n  return json({ boards: PR_BOARDS });\n}", 'fetching the Punters Reckon boards costs an extra database read every night'),
    ('test-pr-boards-15-oct.js', 'venueplay-backend/worker/venueplay-game.js', '{ a: "Beer", pts: 34,', '{ a: "Beer", pts: 35,', 'a Punters Reckon board in the Worker adds up to more than 100'),
    ('test-pr-boards-15-oct.js', 'venueplay/app/trivia/host.html', 'var o={ headers:{ "Authorization":"Bearer "+t } };', 'var o={ headers:{} };', "the console asks for its Punters Reckon boards without the host's login and is refused"),
    ('test-pr-boards-15-oct.js', 'venueplay/app/trivia/host.html', 'prLoadBoards().then(function(boards){ return openSession().then(function(){ return boards; }); })', 'openSession().then(function(){ return prLoadBoards(); })', 'a Punters Reckon night whose boards cannot load still opens a session for the room'),
    ('test-pr-boards-15-oct.js', 'venueplay/app/trivia/host.html', 'return boards; }); }).then(function(boards){\n      G.pr=new window.PRGame.Game({ boards:boards });', 'return boards; }); }).then(function(boards){\n      G.pr=new window.PRGame.Game({});', 'the console starts Punters Reckon with no boards and cannot put one up'),
    ('test-pr-boards-15-oct.js', 'venueplay/app/trivia/host.html', '    if(G.prBoards) return Promise.resolve(G.prBoards);\n', '', 'the console asks the Worker for the Punters Reckon boards over and over'),
    ('test-pr-boards-15-oct.js', 'venueplay/app/trivia/host.html', ' night is still open but its boards did not load ("+e.message+"). Reload the console."); return null; }', ' night is still open but its boards did not load ("+e.message+"). Reload the console."); clearPRNight(); return null; }', 'a reload that cannot fetch the boards forgets the open Punters Reckon night for good'),
    ('test-pr-boards-15-oct.js', 'venueplay/app/trivia/host.html', '        G.pr=new window.PRGame.Game({ boards:boards });', '        G.pr=new window.PRGame.Game({});', 'a console reloaded mid-night gets its Punters Reckon night back with no boards'),
    ('test-pr-boards-15-oct.js', 'venueplay/app/trivia/host.html', "<!-- Punters Reckon's boards are NOT a script: the console asks the game Worker for them (prLoadBoards). -->", '<script src="/app/topanswers/ta-boards.js"></script>', 'the console loads a public script of Punters Reckon boards again'),
    ('test-pr-boards-15-oct.js', 'venueplay/app/trivia/host.html', '      bcast({ t:"mode", mode:"trivia", title:window.PRGame.NAME });', '      bcast({ t:"mode", mode:"trivia", title:window.PRGame.NAME, boards:boards });', 'starting Punters Reckon sends every board, answers and all, to every phone and the TV'),
    ('test-pr-boards-15-oct.js', 'venueplay/app/topanswers/screen.html', 'q: "Name something on a meat tray"', 'q: "Name a classic pub meal"', 'the public demo page shows a real Punters Reckon board, answers and all'),
    ('test-pr-boards-15-oct.js', 'venueplay/app/topanswers/screen.html', '<script src="/app/topanswers/ta-match.js"></script>\n', '<script src="/app/topanswers/ta-match.js"></script>\n<script src="/app/topanswers/ta-boards.js"></script>\n', 'the public demo page loads a script of real Punters Reckon boards'),
    ('test-pr-boards-15-oct.js', 'venueplay/app/topanswers/screen.html', '  setTimeout(function(){ board.onMsg(g.endBoard().showall); }, 13000);\n', '', 'the public demo page never turns the rest of its board over'),
    ('pp-great-minds.test.js', 'partyplay/run.html', '"/party/gm/boards?code="+encodeURIComponent(CODE)+"&key="+encodeURIComponent(KEY)', '"/party/gm/boards?code="+encodeURIComponent(CODE)', "the host's tablet asks for the Great Minds boards without the host key and is refused"),
    ('pp-great-minds.test.js', 'partyplay/run.html', 'name:PPGames.name(g.format, g.title), boards:boards }), pub:null', 'name:PPGames.name(g.format, g.title) }), pub:null', 'Great Minds starts with no boards and cannot put one up'),
    ('pp-great-minds.test.js', 'partyplay/run.html', '      _gmBoards.catch(function(){ _gmBoards=null; });', '      _gmBoards.then(function(){ _gmBoards=null; }, function(){ _gmBoards=null; });', "the host's tablet asks the Worker for the Great Minds boards every time the game is run"),
    ('pp-gm-boards.test.js', 'partyplay-backend/worker/SOURCE-do-not-paste-partyplay-api.js', "  await requireHost(env, u.searchParams.get('code'), u.searchParams.get('key'));\n  return json({ boards: PP_GM_BOARDS });", "  return json({ boards: PP_GM_BOARDS });", 'anybody with no host key can read every Great Minds answer'),
    ('pp-gm-boards.test.js', 'partyplay-backend/worker/SOURCE-do-not-paste-partyplay-api.js', "else if (method === 'GET'  && path === '/party/gm/boards')", "else if (path === '/party/gm/boards')", 'the Great Minds boards route answers any method, not just GET'),
    ('pp-gm-boards.test.js', 'partyplay-backend/worker/SOURCE-do-not-paste-partyplay-api.js', "else if (method === 'GET'  && path === '/party/gm/boards')", "else if (method === 'GET'  && path === '/party/gm/boards-x')", "the host's tablet asks for the Great Minds boards and the Worker says not found"),
    ('pp-gm-boards.test.js', 'partyplay-backend/worker/SOURCE-do-not-paste-partyplay-api.js', "  return json({ boards: PP_GM_BOARDS });\n}", "  await sb(env, 'pp_licences?select=id&limit=1');\n  return json({ boards: PP_GM_BOARDS });\n}", 'fetching the Great Minds boards costs an extra database read'),
    ('pp-gm-boards.test.js', 'partyplay-backend/worker/SOURCE-do-not-paste-partyplay-api.js', '{ a: "Sausages", pts: 36, also: ["sausage", "snags", "snag", "sausies"] },', '{ a: "Sausages", pts: 37, also: ["sausage", "snags", "snag", "sausies"] },', 'a Great Minds board in the Worker adds up to more than 100'),
    ('pp-gm-boards.test.js', 'partyplay-backend/worker/SOURCE-do-not-paste-partyplay-api.js', "      Object.entries(ch).forEach(([k, v]) => res.headers.set(k, v));", "", "the host's tablet cannot read the Great Minds boards (no CORS header on the reply)"),
    ('pp-gm-boards.test.js', 'partyplay-backend/worker/SOURCE-do-not-paste-partyplay-api.js', "'&status=eq.paid&select=*');", "'&select=*');", "an unpaid PartyPlay party's host key reads the Great Minds boards"),
    ('pp-gm-boards.test.js', 'partyplay/run.html', "<!-- Great Minds' boards are NOT a script: this page asks the Worker for them with the host key (gmBoards). -->", '<script src="/lib/pp-great-minds-boards.js"></script>', 'run.html loads a public script of Great Minds boards again'),
    ('pp-gm-boards.test.js', 'partyplay/run.html', "<!-- Great Minds' boards are NOT a script: this page asks the Worker for them with the host key (gmBoards). -->", "<!-- Name something you put on a barbie -->", 'a page anybody can load carries a real Great Minds board'),
    # 15 Oct: one bingo console tab per tablet, once a night is open.
    ('test-bingo-tab-15-oct.js', 'venueplay/app/index.html', '    return !VP_ONETAB.live() || (oneTabOn() && VP_ONETAB.state()==="asking");', '    return !VP_ONETAB.live();', 'a second bingo tab says host_here and a roll call to the room before it knows another tab runs the night'),
    ('test-bingo-tab-15-oct.js', 'venueplay/app/index.html', '  function rawSend(p){\n    if(standingDown()) return;', '  function rawSend(p){', 'a bingo tab behind the live one heartbeats, puts the ads up and sends idle over the live game'),
    ('test-bingo-tab-15-oct.js', 'venueplay/app/index.html', "DELETE the live tab's.\n    if(standingDown()) return;", "DELETE the live tab's.", 'a bingo tab behind the live one deletes the running night from the tablet when it saves'),
    ('test-bingo-tab-15-oct.js', 'venueplay/app/index.html', 'function onRoomMsg(m){ if(standingDown()) return; onMsg(m); }', 'function onRoomMsg(m){ onMsg(m); }', 'a bingo tab behind the live one seats and deals the phones joining the live game'),
    ('test-bingo-tab-15-oct.js', 'venueplay/app/index.html', 'VP_ONETAB.claim(oneTabKey(), { quiet:true }).then(function(){ if(G.code===code){ restoreGame(code); resumeAfterClaim(); } });', 'restoreGame(code); resumeAfterClaim();', 'a second tab opening /app restores the running bingo night as a second live console'),
    ('test-bingo-tab-15-oct.js', 'venueplay/app/index.html', '    if(oneTabOn() && VP_ONETAB.state()!=="live"){', '    if(false){', 'Open lobby in a second tab opens a second bingo lobby over the live game'),
    ('test-bingo-tab-15-oct.js', 'venueplay/app/index.html', '    if(window.VP_ONETAB) VP_ONETAB.release(oneTabKey());   // after the last send: any tab may open the next night', '', 'after End game no other tab can open the next bingo night until it is reloaded'),
    ('test-bingo-tab-15-oct.js', 'venueplay/app/index.html', '    if(window.VP_ONETAB) VP_ONETAB.release(oneTabKey());   // the night is closed: any tab may open the next', '', 'after Close lobby no other tab can open a bingo lobby until it is reloaded'),
    ('test-bingo-tab-15-oct.js', 'venueplay/app/index.html', 'VP_ONETAB.watch(oneTabKey()).then(function(held){ if(held && currentGame==="bingo") VP_ONETAB.notice(oneTabNoticeOpts()); });', '', 'tapping Bingo in a second tab shows a normal setup screen with no word that the game is in another tab'),
    ('test-bingo-tab-15-oct.js', 'venueplay/app/index.html', '      send({ t:"host_here" });\n      reassertToTv();\n', '', 'a bingo console that reloads mid-game never puts the game back on the TV'),
    ('test-bingo-tab-15-oct.js', 'venueplay/app/index.html', 'return !!(s && (s.status==="running" || s.status==="lobby") && s.ts', 'return !!(s && false && s.ts', 'a bingo console that reloads mid-game never restores it'),
    ('test-bingo-tab-15-oct.js', 'venueplay/app/index.html', '    if(G.status!=="lobby" && oneTabOn() && VP_ONETAB.state()!=="live"){', '    if(false){', 'a tab behind the live one puts up the gaming rules and declares a night it may not open'),
    ('test-bingo-tab-15-oct.js', 'venueplay/app/vp-onetab.js', '      if (state === "idle") { state = "blocked"; }', '', 'a menu tab keeps talking to the room after another tab opens the bingo night'),
    ('test-bingo-tab-15-oct.js', 'venueplay/app/vp-onetab.js', '      if (state === "blocked") { state = "idle"; hideNotice(); }', '', 'End game in one tab never frees the tab waiting behind it'),
    ('test-bingo-tab-15-oct.js', 'venueplay/app/vp-onetab.js', 'if (h) { state = "blocked"; if (!quiet) showNotice(lastFlagged); return; }', 'if (h) { state = "blocked"; showNotice(lastFlagged); return; }', "the second tab's games menu is covered by the notice the moment /app opens"),
    ('test-bingo-tab-15-oct.js', 'venueplay/app/vp-onetab.js', '      if (h) { state = "blocked"; return true; }', '      if (h) { return true; }', 'a second tab that only watches keeps talking to the room over the live bingo night'),
    ('test-bingo-tab-15-oct.js', 'venueplay/app/vp-onetab.js', '      if (askedOnce) wait = ASK_MS;', '', 'every bingo tap in a tab that was stood down waits four seconds'),
    ('test-bingo-tab-15-oct.js', 'venueplay/app/vp-onetab.js', '    post({ t: "free" });', '', 'End game frees nobody: the other tab stays locked out of the next night'),
    ('test-bingo-tab-15-oct.js', 'venueplay/app/vp-onetab.js', '    available: function(){ return !!bc; },', '    available: function(){ return true; },', 'with no BroadcastChannel the bingo console no longer restores its game the way it always did'),
    ('test-bingo-tab-15-oct.js', 'venueplay/app/vp-onetab.js', '    if (o.back) {', '    if (false) {', 'the notice in the menu tab has no way back to the games menu'),
    ('test-pr-boards-15-oct.js', 'venueplay/app/topanswers/ta-boards.js', 'This file stays only so caches', 'q: "Name something", pts: 30, This file stays only so caches', 'the old public boards file comes back with answers in it'),
    ('pp-gm-boards.test.js', 'partyplay/lib/pp-great-minds-boards.js', 'This file stays only so caches', 'q: "Name something", pts: 30, This file stays only so caches', 'the old public Great Minds file comes back with answers in it'),
    # The trivia night lost to a bounce through the bingo page.
    ('test-one-room-one-identity.js', 'venueplay/play.html',
     'if(k===OWN_TOKEN_KEY || localStorage.getItem(k+room)!==null) localStorage.setItem(k+room, tok);',
     'if(k===OWN_TOKEN_KEY) localStorage.setItem(k+room, tok);',
     'a phone bounced through the bingo page answers trivia into nothing all night'),
    ('test-one-room-one-identity.js', 'venueplay/app/trivia/play.html',
     'if(e && e.status===401 && P.token && path!=="/join"){',
     'if(false){',
     'a phone with a dead token never re-joins and scores 0 for the rest of the night'),
    ('test-one-room-one-identity.js', 'venueplay/app/trivia/play.html',
     'P.token=""; P.sessionId=""; AR.hash="";',
     'P.token=""; P.sessionId="";',
     'after a re-join the answers room still hears the old fingerprint and drops every answer'),
    ('test-one-room-one-identity.js', 'venueplay/play.html',
     'if(m && m.t==="started" && m.question_count!=null){',
     'if(false){',
     'trivia starting makes the bingo page think bingo is on, and phones never follow the room'),
    ('test-one-room-one-identity.js', 'venueplay/app/vp-session.js',
     '          if (!d || !d.live) { finish(true); return; }',
     '          finish(true); return;',
     'a second console opens a lobby over a live game with no warning'),
    ('test-one-room-one-identity.js', 'venueplay/app/trivia/play.html',
     '\n      send({ t:"answer", pid:P.pid, qseq:qseq });',
     '\n      send({ t:"answer", pid:P.pid, qseq:qseq, choice:i });',
     'every team\'s pick is broadcast to anyone listening before the clock runs out'),
    # /play/live forgets the lobby's format, so phones in a lobby join bingo and are counted twice.
    ('venue-channel.test.js', 'venueplay-backend/worker/venueplay-game.js',
     "|| ((lf === 'trivia' || lf === 'musical_bingo') ? lf : '');",
     "|| '';",
     'a phone that scans in the trivia lobby joins bingo, then is asked its name again and billed twice'),
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
    ('test-screen-check-probe.js', 'venueplay/screen-check.html',
     "encodeURIComponent(VENUE) + '&probe=1';", "encodeURIComponent(VENUE);",
     'the release check loads a real venue TV as if it were the venue and HQ reports a screen that is not there'),
    ('test-email-outcomes-recorded.js', 'venueplay-backend/worker/venueplay-api-FULL.js',
     "action: r.sent ? 'welcome_email_sent' : 'welcome_email_not_sent', target: target,", "action: 'welcome_email_sent', target: target,",
     'a welcome Resend refused is recorded as sent, and the retry is blocked'),
    ('test-demo-returns-to-offer.js', 'venueplay/see-a-night.html',
     'var m=/^\\/offer-([a-z]{3})\\/?$/.exec(a.pathname) ||', 'var m=/^\\/offerX-([a-z]{3})\\/?$/.exec(a.pathname) ||',
     'a venue that watched the demo from the October offer is sent to the $3 homepage'),
    ('test-tv-reads-its-venue.js', 'venueplay/app/vp-venueurl.js',
     'if (eq === 0) p = p.slice(1); else if (eq > 0) continue;', 'if (eq >= 0) continue;',
     'a TV opened at /tv?=venue shows whatever venue the browser last remembered'),
    ('test-console-venue-from-link.js', 'venueplay/app/vp-session.js',
     '        var asked = urlVenueParam();', '        var asked = "";',
     'a console at ?venue=test-alpha opens a live lobby at whatever venue another tab switched to'),
    ('test-venue-url.js', 'venueplay/app/vp-venueurl.js',
     'if (eq === 0) p = p.slice(1); else if (eq > 0) continue;', 'if (eq >= 0) continue;',
     'every screen and the phone read /tv?=venue as no venue and show the remembered one'),
    ('test-musical-host.js', 'venueplay/app/musical/host.html',
     '    if(gch){ var old=gch; gch=null; gsub=false; try{ client.removeChannel(old); }catch(e){} }',
     '    if(gch){ try{ client.removeChannel(gch); }catch(e){} gch=null; gsub=false; }',
     'the musical console says "Lost the connection" every time a lobby opens'),
    # 16 Oct live-audit fix: musical tells the gate whether TONIGHT is ticketed.
    ('test-musical-host.js', 'venueplay/app/musical/host.html',
     '    var paid=!G.freeEntry && paidTonight();',
     '    var paid=true;',
     'a free musical night at an unlocked venue is gated as ticketed and hard blocked'),
    ('test-musical-host.js', 'venueplay/app/musical/host.html',
     '    function go(r){ if(r && r.free){ G.freeEntry=true; setPaidTonight(false); syncPaidSel(); }',
     '    function go(r){ if(r && r.free){ G.freeEntry=true; }',
     '"Start as a free-entry game" leaves Tickets sold selected for the night'),
    ('test-musical-host.js', 'venueplay/app/musical/host.html',
     '  function paidNightKey(){ var d=new Date(Date.now()-6*3600*1000);',
     '  function paidNightKey(){ var d=new Date(Date.now());',
     'a choice made at 1am is forgotten as the night rolls past midnight'),
    ('test-musical-host.js', 'venueplay/app/musical/host.html',
     '  function showPaidField(venue){ var f=$("paidField"); if(f) f.style.display=(venue && venue.paid_entry_enabled===true)?"":"none"; }',
     '  function showPaidField(venue){ var f=$("paidField"); if(f) f.style.display=""; }',
     'a venue that may not charge is shown a Tickets sold choice that can do nothing'),
    ('test-musical-phone.js', 'venueplay/app/musical/play.html',
     'function saveName(room,nm){ try{ localStorage.setItem("vp-mname-"+room, nm); }catch(e){} }',
     'function saveName(room,nm){ try{ sessionStorage.setItem("vp-mname-"+room, nm); }catch(e){} }',
     'a musical player whose tab iOS discarded is asked for their name mid-song'),
    ('test-musical-print.js', 'venueplay-backend/worker/venueplay-game.js',
     '    if (played) kept = true; else { set = null; replaced = true; }',
     '    kept = true;',
     'a host who printed musical cards from the wrong playlist gets the same wrong cards all night'),
    ('test-raffle-console.js', 'venueplay/app/raffle/host.html',
     '    clearHostErrorIf("range");',
     '    ;',
     '"Enter a valid ticket range" stays on the raffle console after the range is fixed'),
    ('test-members-console.js', 'venueplay/app/members/host.html',
     '      .then(function(r){ if(!r || r.error || !Array.isArray(r.data)) throw loadFail("your draws", r);\n'
     '        G.draws=r.data.filter(',
     '      .then(function(r){\n'
     '        G.draws=((r && r.data) || []).filter(',
     'a failed load looks like a brand-new venue and a duplicate members draw can be created'),
    # 16 Oct live-audit fix: "Drawn tonight, draw again?" is asked on the page, never window.confirm().
    ('test-members-console.js', 'venueplay/app/members/host.html',
     '    if(alreadyDrawnTonight() && !_drawAgainOk){ askDrawAgain(); return; }',
     '    if(false){ askDrawAgain(); return; }',
     'a second Draw tonight draws again with no question asked'),
    ('test-members-console.js', 'venueplay/app/members/host.html',
     '    if(alreadyDrawnTonight() && !_drawAgainOk){ askDrawAgain(); return; }\n    _drawAgainOk=false;',
     '    if(alreadyDrawnTonight() && !_drawAgainOk && !confirm("Draw again?")){ askDrawAgain(); return; }\n    _drawAgainOk=false;',
     'the console reaches for window.confirm() again, which blocks a kiosk tablet'),
    ('test-members-console.js', 'venueplay/app/members/host.html',
     '  function drawAgainYes(){ closeDrawAgain(); _drawAgainOk=true; startDraw(); }',
     '  function drawAgainYes(){ closeDrawAgain(); }',
     '"Draw again" closes the question and draws nothing'),
    ('test-overage-ack-covers-room.js', 'venueplay-backend/worker/venueplay-game.js',
     '  const approvedCount = Math.max(joined, played);', '  const approvedCount = played;',
     'a host approves the extra players and is asked again, for ever, on the next round'),
    ('trivia-night.test.js', 'venueplay/app/trivia/host.html',
     '    return total>0 ? Math.min(want, total) : want;', '    return want;',
     'a host types 30 on a 12-question night and 30 rows print while 12 play'),
    ('test-bingo-end-report.js', 'venueplay-backend/worker/venueplay-game.js',
     '    if (row.ended_at) await markBroadcastGameEnded(env, venueId, row.format);\n', '',
     'a bingo game that ended stays running and phones are sent to it'),
    ('bingo-console.test.js', 'venueplay/app/index.html',
     '  function lobbyEdited(){\n    if(G.status!=="lobby") return;', '  function lobbyEdited(){\n    return;',
     'a prize fixed while the lobby is open never reaches the TV or the phones'),
    ('test-billing-panels.js', 'venueplay/app/billing.html',
     '      var want = defaultVenue(venues);\n      var pick = $("rfPickWrap")', '      var want = (venues[0] && venues[0].id);\n      var pick = $("rfPickWrap")',
     'a two-venue owner opens Raffles and edits the first venue, not the one they are working at'),
    ('test-channel-recovery-tv.js', 'venueplay/tv.html',
     'VPChannel.keep(client, "vp-"+CODE, { config:{ broadcast:{ self:false } } })',
     'client.channel("vp-"+CODE, { config:{ broadcast:{ self:false } } })',
     'tv: bingo channel is a plain channel again'),
    ('test-channel-recovery-tv.js', 'venueplay/tv.html',
     '        if(oneChannelDeafTooLong()){ reload("channel-deaf"); return; }   // idle only; see above\n',
     '',
     'tv: watchdog ignores one deaf channel'),
    ('test-channel-recovery-tv.js', 'venueplay/tv.html',
     '    else channelDeafSince[name]=0;',
     '    else channelDeafSince={};',
     'tv: one channel healing clears every clock (the old shared timer)'),
    ('test-channel-recovery-tv.js', 'venueplay/tv.html',
     'if(!idle() || !anyChannelDeafSince',
     'if(!anyChannelDeafSince',
     'tv: one deaf channel reloads over a game'),
    ('test-channel-recovery-tv.js', 'venueplay/tv.html',
     'return !(why === "channel-deaf" && (Date.now() - at) < ONE_DEAF_GAP);',
     'return true;',
     'tv: no half-hour floor'),
    ('test-channel-recovery-tv.js', 'venueplay/tv.html',
     'tvStatus(false); noteDeaf("main", true); }',
     'tvStatus(false); }',
     'tv: bingo channel not counted when it drops'),
    ('test-channel-recovery-screens.js', 'venueplay/app/musical/screen.html',
     'VPChannel.keep(client, "vp-"+CODE, { config:{ broadcast:{ self:false } } })',
     'client.channel("vp-"+CODE, { config:{ broadcast:{ self:false } } })',
     'musical screen: plain channel again'),
    ('test-channel-recovery-screens.js', 'venueplay/app/members/screen.html',
     '<script src="/app/vp-channel.js"></script>\n',
     '',
     'members screen: script tag gone'),
    ('test-channel-recovery-phones.js', 'venueplay/play.html',
     'VPChannel.keep(client, "vp-"+room, { config:{ broadcast:{ self:false } } })',
     'client.channel("vp-"+room, { config:{ broadcast:{ self:false } } })',
     'bingo phone: plain channel again'),
    ('test-channel-recovery-phones.js', 'venueplay/play.html',
     'if(m){ try{ room=decodeURIComponent(m[1]); }catch(e){ room=m[1]; } room=room.toUpperCase().trim(); }\n    var slug',
     'if(m){ room=decodeURIComponent(m[1]).toUpperCase().trim(); }\n    var slug',
     'bingo phone: unguarded decode'),
    ('test-channel-recovery-phones.js', 'venueplay/app/trivia/play.html',
     '} else if(status==="CHANNEL_ERROR"||status==="TIMED_OUT"||status==="CLOSED"){\n      subscribed=false;\n',
     '} else if(status==="CHANNEL_ERROR"||status==="TIMED_OUT"){\n',
     'trivia phone: CLOSED ignored again'),
    ('test-channel-recovery-phones.js', 'venueplay/app/trivia/play.html',
     '    if(ch){ try{ ch.unsubscribe(); }catch(e){} ch=null; subscribed=false; }\n',
     '',
     'trivia phone: old channel not hung up on a new code'),
    ('test-channel-recovery-screens.js', 'venueplay/app/vp-channel.js',
     '      cur = null;                                  // rule 2: let go BEFORE removing\n',
     '',
     'vp-channel: removes the old channel while it is still current'),
    ('test-channel-recovery-screens.js', 'venueplay/app/vp-channel.js',
     '          if (retryT) { clearTimeout(retryT); retryT = null; }   // rule 5\n',
     '',
     'vp-channel: a healed channel is torn down anyway'),
    ('test-channel-recovery-phones.js', 'venueplay/app/vp-channel.js',
     '        var old = cur; cur = null;                 // rule 2 again: its CLOSED is not news\n',
     '        var old = cur; stopped = false;\n',
     'vp-channel: hanging up reports the CLOSED'),
    ('test-channel-recovery-screens.js', 'venueplay/app/vp-channel.js',
     'if (stopped || mine !== cur) return;',
     'if (stopped) return;',
     'vp-channel: status of a replaced channel believed'),
    ('test-raffle-unsold-server.js', 'venueplay-backend/worker/venueplay-game.js',
     '    for (const r of b.excluded_ranges.slice(0, 200)) {', '    for (const r of b.excluded_ranges.slice(0, 20)) {',
     'the 21st stretch of unsold raffle tickets can be drawn'),
    ('test-print-problem.js', 'venueplay/app/trivia/host.html',
     '      ? "The print window was closed before the sheets were ready. Tap Print again."',
     '      ? "Your browser blocked the print window. Allow pop-ups for venueplay.com.au, then tap Print again."',
     'a host who closed the print tab is told their browser blocked it'),
    ('test-paper-players.js', 'venueplay-backend/worker/venueplay-game.js',
     '    if (!locked && running.length === 0) teams = want;', '    ;',
     'a host who mistyped 8 paper teams is stuck with 8 sheets all night'),
    ('partyplay-api.test.js', 'partyplay-backend/worker/SOURCE-do-not-paste-partyplay-api.js',
     "remaining: (due.length === 500 || peopleLeft) ? 'more' : 0 };", "remaining: due.length === 500 ? 'more' : 0 };",
     'the guest-data sweep stops with parties still holding emails and reports nothing left'),
    ('partyplay-api.test.js', 'partyplay-backend/worker/SOURCE-do-not-paste-partyplay-api.js',
     "'?select=licence_id,pp_licences!inner(id)&pp_licences.expires_at=lt.'", "'?select=licence_id,pp_licences(id)&pp_licences.expires_at=lt.'",
     'the guest-data sweep matches parties that never started or have not ended'),
    ('partyplay-api.test.js', 'partyplay-backend/worker/SOURCE-do-not-paste-partyplay-api.js',
     "  if (me) {\n    if (name !== me.nickname) {", "  if (false) {\n    if (name !== me.nickname) {",
     'a guest who comes back to the same party takes a second place out of the fifty'),
    ('pp-code-and-channel.test.js', 'partyplay/play.html',
     'try{ if(was.token) was.prev = was.token; delete was.token;', 'try{ delete was.token;',
     'a guest who presses Not this party and types the same code again takes a second place'),
    ('partyplay-api.test.js', 'partyplay-backend/worker/SOURCE-do-not-paste-partyplay-api.js',
     "    emailed = true;\n  } catch (e) { console.log('comp email failed: ' + e.message); }",
     "  } catch (e) { console.log('comp email failed: ' + e.message); }\n  emailed = true;",
     'a comp whose email bounced is reported to the admin as emailed'),
    ('partyplay-api.test.js', 'partyplay-backend/worker/SOURCE-do-not-paste-partyplay-api.js',
     "    const to = new Date(Math.max(Date.parse(l.expires_at), Date.now()) + hours * 3600e3).toISOString();",
     "    const to = new Date(Date.parse(l.expires_at) + hours * 3600e3).toISOString();",
     'the admin adds a day to a finished party and it stays finished'),
    ('partyplay-api.test.js', 'partyplay-backend/worker/SOURCE-do-not-paste-partyplay-api.js',
     "    expired: !rows.length && !!l.expires_at &&", "    expired: false && !!l.expires_at &&",
     'a guest opens an album we deleted on schedule and is told nobody took any photos'),
    ('pp-photo-downloads.test.js', 'partyplay/host.html',
     '              document.body.appendChild(a); a.click(); a.remove();',
     '              window.open(u, "_blank");',
     'the host presses Download and the pop-up blocker eats every photo'),
    ('pp-photo-downloads.test.js', 'partyplay/album.html',
     '        (d.expired ? ', '        (false ? ',
     'the album page says nobody took any photos when we deleted them'),
    ('partyplay-api.test.js', 'partyplay-backend/worker/SOURCE-do-not-paste-partyplay-api.js',
     "    'payment_method_types[0]': 'card',", "",
     'checkout offers bank payments again and a buyer is told their code was emailed days before it clears'),
    ('partyplay-api.test.js', 'partyplay-backend/worker/SOURCE-do-not-paste-partyplay-api.js',
     '>The ten games</h2>', '>The eleven games</h2>',
     'the welcome email promises eleven games over a list of ten'),
    ('partyplay-api.test.js', 'partyplay-backend/worker/SOURCE-do-not-paste-partyplay-api.js',
     '/logos/partyplay-email-logo.png" width="176"', '/logos/partyplay-primary.svg" width="176"',
     'the welcome email logo is an SVG that Gmail and Outlook show as a broken image'),
    ('livenorm.test.py', 'tools/livenorm.py',
     "r'<a href=\"mailto:EMAIL\"\\1>\\2</a>'", "r'<a href=\"mailto:EMAIL\"\\1>EMAIL</a>'",
     'a live page whose mailto link says Tell us compares stale for ever and the release never finishes'),
    ('pp-bingo-called.test.js', 'partyplay/play.html',
     '    var p = PPTicket.progress(B.grid, bingoCounted());', '    var p = PPTicket.progress(B.grid, Object.keys(B.marked).map(Number));',
     'a PartyPlay guest wins bingo on numbers nobody called'),
    ('pp-bingo-called.test.js', 'partyplay/play.html',
     'keep.token === s.token && (keep.gid || null) === gid)', 'keep.token === s.token)',
     'the second bingo game of the night opens with the first game\'s card already marked'),
    ('pp-bingo-called.test.js', 'partyplay/run.html',
     '      if(!nums.length || notCalled.length){', '      if(false){',
     'the host console puts a claim with uncalled numbers on the telly as the winner'),
    ('pp-code-and-channel.test.js', 'partyplay/lib/pp-config.js',
     "return 'pp-' + this.code(code);", "return 'pp-' + String(code || '').toUpperCase();",
     'a guest who types the party code with a space or a 5 for an S joins and hears nothing all night'),
    ('pp-code-and-channel.test.js', 'partyplay/play.html',
     '        if(_ppChannel !== ch) return;      // a channel we hung up on: its news is not news\n', '',
     '"Not this party?" paints Lost the connection over the join form the guest asked for'),
    ('pp-code-and-channel.test.js', 'partyplay/run.html',
     'ch.subscribe(function(st){ if(ch===mine) onChannelStatus(st); });', 'ch.subscribe(onChannelStatus);',
     'the host presses Try again and the not-connected bar comes straight back'),
('bingo-after-the-win.test.js', 'venueplay/app/index.html',
     '    G.draw=[]; G.idx=-1; G.called={};\n    send({ t:"idle" });   // TV returns to the advertising loop', '    send({ t:"idle" });   // TV returns to the advertising loop',
     "the bingo console opens the next lobby with the last game's balls still lit as called"),
    ('pp-great-minds.test.js', 'partyplay/run.html',
     '      G.game.load(was.game);', '      G.game.load("{}");',
     'a PartyPlay host who reloads mid Great Minds board loses the board, the scores and what was found'),
    ('pp-great-minds.test.js', 'partyplay/run.html',
     '    if(was && was.game && !was.added){', '    if(was && was.game){',
     'a finished Great Minds game run again carries the old scores and never adds the new ones to the night'),
    ('pp-run-games.test.js', 'partyplay/run.html',
     '    if(!G.items.length){\n      $("app").innerHTML=\'<div class="gate"><div class="big">No questions yet</div>\'+', '    if(false){\n      $("app").innerHTML=\'<div class="gate"><div class="big">No questions yet</div>\'+',
     'a PartyPlay trivia game with no questions opens on "That is the lot, all 0 done"'),
    ('test-router-heals-after-a-blip.js', 'venueplay/app/vp-screen-router.js',
     '    join: 1, claim: 1, leave: 1, answer: 1, pr_guess: 1\n', '    x_unused: 1\n',
     "a punter's phone waking up pulls a game screen onto bingo (the shared router never got tv.html's 5 Sep fix)"),
    ('bingo-after-the-win.test.js', 'venueplay/app/index.html',
     '    if(_wait>0){ _hold=" disabled";', '    if(false){ _hold=" disabled";',
     "in a bingo tie, the second half of a double-tap confirms the OTHER claimant"),
    ('pp-great-minds.test.js', 'partyplay/run.html',
     '    if(G.game.board) return;   // a double-tap', '    if(false) return;   // a double-tap',
     'a double-tap on Great Minds Next board skips the board the room is playing'),
    ('test-cant-sign-warns.js', 'venueplay/app/vp-sign.js',
     '        .then(function (d) { if (S.slug === slug && !S.privKey) VPSign._cantSignBar(!!(d && d.enforce)); })', '        .then(function (d) {})',
     'a console that cannot sign at an enforcing venue looks normal while the TV and phones drop everything it sends'),
    ('test-cant-sign-warns.js', 'venueplay/app/vp-sign.js',
     'VPSign._cantSignBar(!!(d && d.enforce))', 'VPSign._cantSignBar(true)',
     'a console at a venue that does not check signatures is told it will be ignored when it will not'),
    ('tv-states.test.js', 'venueplay/tv.html',
     '      else if(tvMode!=="embed") enterHolding(m.mode);', '      else enterHolding(m.mode);',
     'a musical or trivia lobby leaves the venue TV stuck on "Starting Musical..." when its mode arrives twice'),
    ('pp-suggested-night.test.js', 'partyplay/host.html',
     '        .then(function(){ return post("truths"); })\n', '',
     'the suggested night leaves out Two truths and a lie, so the running order is not the one promised'),
    ('pp-suggested-night.test.js', 'partyplay/host.html',
     'return { q:x.q, a:x.answer, options:x.options.slice(), src:q.category };', 'return { q:x.q, a:"", options:x.options.slice(), src:q.category };',
     'the suggested family quiz is saved without its answers, so every guess is marked wrong'),
    ('pp-tv-reconnect.test.js', 'partyplay/tv.html',
     '          if(!lostT) lostT = setTimeout(function(){ lostNote(true); }, LOST_MS);', '',
     'a PartyPlay telly that has lost the party looks exactly like one waiting for the host'),
    ('pp-tv-reconnect.test.js', 'partyplay/tv.html',
     '          clearTimeout(lostT); lostT = null; lostNote(false);', '          lostT = null;',
     'the reconnecting note stays on the telly after the party is back'),
    ('pp-run-games.test.js', 'partyplay/run.html',
     '      G.i=was.i; G.shown=!!was.shown; G.answers=was.answers||[]; G.seed=was.seed;', '',
     'a PartyPlay host whose tablet reloads mid-quiz is back on question one with every answer lost'),
    ('pp-run-games.test.js', 'partyplay/run.html',
     '    if(was && !was.banked && was.n===G.items.length', '    if(was && was.n===G.items.length',
     'a PartyPlay quiz already counted into the night comes back and can be counted again'),
    ('pp-run-games.test.js', 'partyplay/run.html',
     '      G.gid=String(was.gid); G.called=was.called.map(Number);', '',
     'a PartyPlay host whose tablet reloads mid-bingo deals the whole room new tickets and loses every call'),
    ('pp-run-games.test.js', 'partyplay/run.html',
     '    var was=null; if(G.bkey && !fresh){', '    var was=null; if(G.bkey){',
     'PartyPlay bingo cannot be started over: a fresh game reloads the saved one'),
    ('pp-run-games.test.js', 'partyplay/run.html',
     '    if(el.id==="again"){ runBingo(G && G.gref, true); return; }', '    if(el.id==="again"){ runBingo(G && G.gref); return; }',
     'PartyPlay bingo Start over brings back the old game instead of dealing new tickets'),
    ('pp-run-games.test.js', 'partyplay/run.html',
     '    RUN_KEEP[G.mode].forEach(function(k){ if(was[k]!==undefined) G[k]=was[k]; });', '',
     'a PartyPlay host whose tablet reloads mid who-here or charades is back at the start'),
    ('pp-run-games.test.js', 'partyplay/run.html',
     '    if(typeof was.i!=="number" || was.i < 0 || was.i >= G.items.length) return;', '    if(typeof was.i!=="number") return;',
     'a finished who-here or charades game opens on "that is the lot" for ever instead of starting fresh'),
    ('test-shared-links-absolute.js', 'venueplay/app/vp-session.js',
     '  var SIGNIN    = "/app/";            // the sign-in shell', '  var SIGNIN    = "index.html";       // the sign-in shell',
     'a game console whose login runs out sends the host to the marketing homepage'),
    ('test-shared-links-absolute.js', 'venueplay/app/vp-session.js',
     '    if (ctx.isAdmin) return "/app/hq.html";', '    if (ctx.isAdmin) return "hq.html";',
     'HQ home is a relative link that breaks from any page one folder down'),
    ('test-router-heals-after-a-blip.js', 'venueplay/app/vp-screen-router.js',
     '          if (m.t === "mode") { goTo(m.mode && URLS[m.mode] ? m.mode : game); return; }', '          if (m.t === "mode") { goTo(game); return; }',
     'a musical console announcing itself on the venue channel pulls the musical screen off to bingo and the TV sticks on "Starting Musical"'),
    ('test-router-heals-after-a-blip.js', 'venueplay/app/vp-screen-router.js',
     '          if (game === "bingo" ? BINGO_ON_AIR[m.t] : onAir(m)) goTo(game);', '          if (onAir(m)) goTo(game);',
     'a musical console\'s own volume on the venue channel reads as bingo on air'),
    ('livenorm.test.py', 'tools/livenorm.py',
     "    t = re.sub(r'mailto:EMAIL\\?[^\"\\']*', 'mailto:EMAIL', t)\n", '',
     'a page with a mailto subject compares stale for ever and stops every release for 30 minutes'),
    ('tv-screen.test.js', 'venueplay/tv.html',
     '    el.classList.remove("live"); void el.offsetWidth; el.classList.add("live");   // restart the dim, rings and call\n', '',
     'the bigger reveal never dims the room or shows the call, so the ball goes up like before'),
    ('tv-screen.test.js', 'venueplay/tv.html',
     '      el.classList.remove("live");                     // the room comes back up as the ball glides home\n', '',
     'the room stays dimmed after the ball has landed'),
    ('tv-screen.test.js', 'venueplay/tv.html',
     '      66:"Clickety click",77:"Sunset strip",88:"Two fat ladies",90:"Top of the shop"})[n] || "";', '      66:"Clickety click",77:"Sunset strip",88:"Two fat ladies",90:"Top of the shop"})[n+1] || "";',
     'the call under the ball is for the wrong number'),
    ('test-double-points.js', 'venueplay-backend/worker/venueplay-game.js',
     '      pts = mult * (base + bonus);', '      pts = base + bonus;',
     'the double points questions score single while the TV tells the room they are double'),
    ('test-double-points.js', 'venueplay-backend/worker/venueplay-game.js',
     '    const from = Math.max(0, chosenSeqs.length - doubleLast);', '    const from = 0;',
     'double points covers the whole night, not the final round'),
    ('test-double-points.js', 'venueplay-backend/worker/venueplay-game.js',
     '        points_awarded: right ? (isDbl ? 2 * base : base) : 0 });', '        points_awarded: right ? base : 0 });',
     'paper teams never get double points while phone teams do'),
    ('test-double-points.js', 'venueplay-backend/worker/venueplay-game.js',
     "    if (typeof b.double_points === 'boolean') {", '    if (false) {',
     'double points has to be turned on again every week'),
    ('test-musical-phone.js', 'venueplay/app/musical/play.html',
     "        if(!live){ dropStaleJoin(); return rejoinNow(); }", "        if(false){ dropStaleJoin(); return rejoinNow(); }",
     "a phone that played musical bingo last week keeps last week's token and never gets a card tonight"),
    ('test-musical-phone.js', 'venueplay/app/musical/play.html',
     "P.name=savedName; P.joined=true; checkStaleJoin(); }", "P.name=savedName; P.joined=true; }",
     'the musical phone never checks whether its saved night has ended'),
    ('test-channel-recovery-consoles.js', 'venueplay/app/raffle/host.html',
     '    ch=window.VPChannel ? VPChannel.keep(client, "vp-"+code, { config:{ broadcast:{ self:false } } }) : client.channel("vp-"+code, { config:{ broadcast:{ self:false } } });', '    ch=client.channel("vp-"+code, { config:{ broadcast:{ self:false } } });',
     'the raffle console never gets its channel back after a drop until the host switches tabs'),
    ('test-channel-recovery-consoles.js', 'venueplay/app/members/host.html',
     '    ch=window.VPChannel ? VPChannel.keep(client, "vp-"+code, { config:{ broadcast:{ self:false } } }) : client.channel("vp-"+code, { config:{ broadcast:{ self:false } } });', '    ch=client.channel("vp-"+code, { config:{ broadcast:{ self:false } } });',
     'the members console never gets its channel back after a drop'),
    ('test-channel-recovery-consoles.js', 'venueplay/app/index.html',
     '        ch=window.VPChannel ? VPChannel.keep(client, "vp-"+code, { config:{ broadcast:{ self:false } } }) : client.channel("vp-"+code, { config:{ broadcast:{ self:false } } });', '        ch=client.channel("vp-"+code, { config:{ broadcast:{ self:false } } });',
     'the bingo console on the Supabase fallback never gets its channel back after a drop'),
    ('pp-tv-code-check.test.js', 'partyplay/tv.html',
     '        if(x.status === 404){', '        if(false){',
     'the PartyPlay telly puts a QR code on the wall for a party that does not exist'),
    ('pp-tv-code-check.test.js', 'partyplay/tv.html',
     '    drawJoin();\n    checkCode(CODE);', '    drawJoin();',
     'the PartyPlay telly never asks whether its code is a party'),
    ('test-double-points.js', 'venueplay/app/trivia/play.html',
     '        if(Array.isArray(g.double_seqs) && g.double_seqs.indexOf(P.pendingQ.qseq)>=0) P.pendingQ.double=true; }', '        }',
     'a phone reloaded mid-question loses the Double points badge'),
    ('test-paper-night-event-private.js', 'venueplay-backend/worker/venueplay-game.js',
     "    ? { qseq: t.current_seq, options, deferred: true }", "    ? { qseq: t.current_seq, options, leaderboard, deferred: true }",
     'a paper night broadcasts every team\'s total after each question, which is the answer by another name'),
    ('test-sign-venue-switch.js', 'venueplay/app/vp-sign.js',
     "        if (!d || S.slug !== slug) return;", "        if (!d) return;",
     "a host who switches venue seconds after loading signs the new venue's broadcasts with the old venue's key"),
    ('partyplay-api.test.js', 'partyplay-backend/worker/SOURCE-do-not-paste-partyplay-api.js',
     "  if (recent.length && recent[0].buyer_name === name) {", "  if (false) {",
     'a PartyPlay buyer who taps Pay twice gets two orders and two Stripe checkouts'),
    ('pp-start-back.test.js', 'partyplay/start.html',
     '    if(ev && ev.persisted){ go.disabled = false; refresh(); clearErr(); }', '    if(ev && ev.persisted){ }',
     'a PartyPlay buyer who presses Back from Stripe is left with a dead Pay button'),
    ('partyplay-api.test.js', 'partyplay-backend/worker/SOURCE-do-not-paste-partyplay-api.js',
     "      if (was.indexOf(r.id) < 0 || stillUsed[r.id]) continue;", "      if (was.indexOf(r.id) < 0) continue;",
     'deleting one PartyPlay game deletes a photo another game still shows'),
    ('partyplay-api.test.js', 'partyplay-backend/worker/SOURCE-do-not-paste-partyplay-api.js',
     "  if (was.length && env.PHOTOS) {", "  if (false) {",
     "a host deletes a Guess the photo game and its baby photos stay stored for a year"),
    ('livenorm.test.py', 'tools/livenorm.py',
     "    t = re.sub(r'>\\s+<', '><', t)", "",
     'a live page whose Cloudflare beacon lands on its own line compares stale for ever and the release never finishes'),
    ('test-ta-match.js', 'venueplay/app/topanswers/ta-match.js',
     # BOTH guards, in one edit. The matcher refuses a short word twice over (the typed word, and the
     # answer form), so removing either one alone changes nothing and this row sat blind (30 Sep 2026).
     '    if (t.length < 5) return -1;\n    var hit = -1;\n    for (i = 0; i < answers.length; i++) {\n      forms = formsOf(answers[i]);\n      for (k = 0; k < forms.length; k++) {\n        if (forms[k].length >= 5 && slips(forms[k], t) === 1) {',
     '    var hit = -1;\n    for (i = 0; i < answers.length; i++) {\n      forms = formsOf(answers[i]);\n      for (k = 0; k < forms.length; k++) {\n        if (slips(forms[k], t) === 1) {',
     'Top Answers scores "car" as "bar": a one-letter slip on a short word lands on the wrong answer'),
    ('test-ta-match.js', 'venueplay/app/topanswers/ta-match.js',
     '          if (hit !== -1 && hit !== i) return -1;   // two answers that close: refuse, never guess\n', '',
     'Top Answers guesses between two answers equally close to what was typed'),
    ('test-ta-screen.js', 'venueplay/app/topanswers/pr-board.js',
     '        fill(i, m.a, m.pts, m.by); S.open[i] = true; S.found += 1;', '        fill(i, m.a, m.pts, m.by); S.open[i] = false; S.found += 1;',
     'Punters Reckon counts the same found answer twice on the TV'),
    ('test-ta-screen.js', 'venueplay/app/topanswers/pr-board.js',
     '      if (b) b.innerHTML = \'<span class="a">\' + esc(a) + (by ? \'<span class="by">\' + esc(by) + \'</span>\' : \'\')', '      if (b) b.innerHTML = \'<span class="a">\' + a + (by ? \'<span class="by">\' + by + \'</span>\' : \'\')',
     "a player's name or answer text is put on the pub TV as markup instead of text"),
    ('test-pr-game.js', 'venueplay/app/topanswers/pr-game.js',
     '    if (this.now() > this.endsAt) { out.result.why = "time"; return out; }\n', '',
     'Punters Reckon takes a guess after the clock has run out'),
    ('test-pr-game.js', 'venueplay/app/topanswers/pr-game.js',
     '    if (g.left <= 0) { out.result.why = "no_guesses"; out.result.left = 0; return out; }\n', '',
     'a Punters Reckon player gets more than three guesses a board'),
    ('test-pr-game.js', 'venueplay/app/topanswers/pr-game.js',
     '    return { t: "ta_board", round: this.round, q: b.q, n: b.answers.length,', '    return { t: "ta_board", round: this.round, q: b.q, n: b.answers.length, answers: b.answers,',
     'the Punters Reckon board goes out to every phone with its answers on it'),
    ('test-pr-round.js', 'venueplay/app/topanswers/pr-phone.js',
     "        if (m.to !== me.pid || (m.round|0) !== S.round) return true;   // someone else's, or an old board\n", '',
     "a Punters Reckon phone shows another player's guess result as its own"),
    ('test-pr-game.js', 'venueplay/app/topanswers/pr-game.js',
     '      this.board = b; this.found = b ? (o.found || {}) : {};', '      this.board = null; this.found = b ? (o.found || {}) : {};',
     'a console reload mid-board loses the Punters Reckon board the room is playing'),
    ('test-pr-game.js', 'venueplay/app/topanswers/pr-game.js',
     '      if (this.found[i] !== undefined) out.push({ t: "ta_reveal"', '      out.push({ t: "ta_reveal"',
     'a reloaded Punters Reckon board sends every answer, found or not, to every phone'),
    ('test-pr-round.js', 'venueplay/app/trivia/host.html',
     'restoreTrivia().then(function(ok){ return ok || restorePR(); })', 'restoreTrivia().then(function(ok){ return ok; })',
     'a console reload drops a Punters Reckon night back to setup with the room mid-board'),
    ('test-pr-round.js', 'venueplay/app/trivia/host.html',
     '(_mid ? 7000 : 0) + 15000);', '0);',
     'Punters Reckon final scores flash on the TV for no time before the lobby comes back'),
    ('test-pr-round.js', 'venueplay/app/topanswers/pr-phone.js',
     'left: same ? S.left : 3, tries: same ? S.tries : []', 'left: 3, tries: []',
     'a phone sent the same Punters Reckon board again forgets what it typed and shows 3 guesses'),
    ('pp-great-minds.test.js', 'partyplay/lib/pr-game.js',
     '    this.name = opts.name || NAME;', '    this.name = NAME;',
     "PartyPlay's copy of the Punters Reckon engine drifts from VenuePlay's (and calls itself Punters Reckon at a party)"),
    ('pp-great-minds.test.js', 'partyplay/run.html',
     '    if(r.reveal) send(r.reveal);       // an answer', '    send({t:"ta_showall", rest:G.game.board.answers.map(function(a,i){ return {i:i,a:a.a,pts:a.pts}; })}); if(r.reveal) send(r.reveal);       // an answer',
     'Great Minds sends every answer down the party channel while the board is still being played'),
    ('pp-great-minds.test.js', 'partyplay/run.html',
     "    send(r.result);                    // addressed (pr_result.to)", "    r.result.to=''; send(r.result);                    // addressed (pr_result.to)",
     "a Great Minds result reaches every guest's phone instead of the one who guessed"),
    ('pp-great-minds.test.js', 'partyplay/run.html',
     '    if(!G.added){ nightAdd(rows); G.added=true; gmSave(); }', '    nightAdd(rows);',
     'pressing Finish twice counts a Great Minds game into the night twice'),
    ('pp-great-minds.test.js', 'partyplay/run.html',
     '(G.game.replay() || []).forEach(function(m){ send(m); });', 'send(G.pub); b=G.game.board; if(b) send({t:"ta_showall", rest:b.answers.map(function(a,i){ return {i:i,a:a.a,pts:a.pts}; })});',
     'a guest who walks in mid-board is sent every answer'),
    ('pp-great-minds.test.js', 'partyplay/play.html',
     'if(B || Q || H || T || W || V || PH || CH || GW || GM || DRW) return;', 'if(B || Q || H || T || W || V || PH || CH || GW || DRW) return;',
     "the telly's caption wipes a guest's phone in the middle of a Great Minds board"),
    ('pp-great-minds.test.js', 'partyplay/host.html',
     'return TYPES[k].ready && !TYPES[k].retired && !TYPES[k].hidden; })', 'return TYPES[k].ready && !TYPES[k].retired; })',
     'the Great Minds tile shows to every host before the database will accept the game'),
    ('test-paper-score-held.js', 'venueplay-backend/worker/venueplay-game.js',
     "  if (pcfg.defer_reveal === true && game.status === 'running') {", '  if (false) {',
     'a phone on a paper night learns if it was right after every question and tells the paper table'),
    ('test-trivia-nobody-answered.js', 'venueplay-backend/worker/venueplay-game.js',
     '  if (Number.isFinite(room) && room > count) count = room;', '  if (false) count = room;',
     'nobody answers a question and every phone in a room of three reads "1st of 1"'),
    ('test-trivia-nobody-answered.js', 'venueplay-backend/worker/venueplay-game.js',
     "&played_at=not.is.null&kicked=eq.false&select=id');", "&select=id');",
     'a removed team and a phone that never held a question are counted in the field'),
    ('test-trivia-nobody-answered.js', 'venueplay-backend/worker/venueplay-game.js',
     "      if (qKey) cache.set('n:' + gameId", "      if (false) cache.set('n:' + gameId",
     'every phone in the room counts the room again, one database trip each per reveal'),
    ('test-trivia-nobody-answered.js', 'venueplay-backend/worker/venueplay-game.js',
     '    } catch (e) { room = 0; }', '    } catch (e) { throw e; }',
     'a failed count read leaves every phone with no place at all'),
    ('test-venue-search-au-state.js', 'venueplay-backend/worker/venueplay-game.js',
     "state: r.au_state || '',", "state: r.state || '',",
     "a new screen's venue tiles print the old empty state column, so the Mini Bar shows no state"),
    ('test-venue-search-au-state.js', 'venueplay-backend/worker/venueplay-game.js',
     "'&au_state=eq.' + enc(state)", "'&state=eq.' + enc(state)",
     'a venue search narrowed to NSW cannot find the Mini Bar'),
    ('test-venue-search-au-state.js', 'venueplay-backend/worker/venueplay-game.js',
     '&order=au_state.asc,postcode.asc', '&order=state.asc,postcode.asc',
     'the venue tiles are sorted by the old empty state column'),
    ('hop-name.test.js', 'venueplay/app/trivia/play.html',
     'if(hn && ni && !ni.value) ni.value=', 'if(hn && ni) ni.value=',
     'a name typed on /play overwrites the team name a player already put in on the trivia phone'),
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

    ('adding a venue charges a month and credits it straight back', 'venueplay-backend/worker/venueplay-api-FULL.js',
     "  const chargePlayers = Math.max(0, players - alreadyPaid);",
     "  const chargePlayers = players;",
     'a venue flagged to cancel and added back is charged again for players it already paid for this month'),

    ('founding-month-expiry.test.js', 'venueplay-backend/worker/venueplay-api-FULL.js',
     "  return (nowMs == null ? Date.now() : nowMs) < endMs;",
     "  return true;",
     'an October code keeps selling $2.50 in November because nobody took it out of Cloudflare'),

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

    ('shift-timer.test.js', 'venueplay/app/vp-session.js',
     '  var SHIFT_MAX  = 4 * 3600 * 1000;',
     '  var SHIFT_MAX  = 400 * 3600 * 1000;',
     'the forced sign-out that keeps opt-in player details behind a login on a shared bar '
     'tablet is quietly stretched to 400 hours (the audit of 20 Sep 2026 did exactly this '
     'and every gate stayed green)'),

    ('shift-timer.test.js', 'venueplay/app/vp-session.js',
     '    if ((Date.now() - start) <= SHIFT_MAX) return;',
     '    if ((Date.now() - start) <= SHIFT_MAX * 100) return;',
     'the limit reads four hours but the check itself lets a shift run for weeks'),

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
    # THE DATE MOVED AND THIS DID NOT. It looked for "30 September", which every founding page
    # carried when the deal ran to the end of September. They all say 31 October now, so the
    # find string matched nothing and prove-checks reported "the mutation no longer applies".
    # That is a check nobody is proving, dressed up as a tidy line of output. Caught 17 Sep 2026.
    # If a date in the copy moves, move it here too.
    ('every founding page agrees with its own code', 'venueplay/nsw.html',
     '<<ALL:31 October 2026>>', '31 November 2026',
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
     # Anchored on the RECEIPT's subject: since 25 Sep the upcoming-payment email records its outcome with
     # the identical say(...) line, and a bare match broke whichever came first in the file.
     "subject: 'Your VenuePlay invoice' + (number ? ' ' + number : '') + ' - ' + amount,\n        html: html,\n      }),\n    });\n    let resendId = null;\n    try { const j = await res.json(); resendId = (j && j.id) || null; } catch (_) {}\n    await say(res && res.ok ? 'sent' : 'not sent: Resend refused it',",
     "subject: 'Your VenuePlay invoice' + (number ? ' ' + number : '') + ' - ' + amount,\n        html: html,\n      }),\n    });\n    let resendId = null;\n    try { const j = await res.json(); resendId = (j && j.id) || null; } catch (_) {}\n    await Promise.resolve(res && res.ok ? 'sent' : 'not sent',",
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
     'if(status==="CHANNEL_ERROR"||status==="TIMED_OUT"||status==="CLOSED"){ subscribed=false; wireBar(true); }',
     'if(status==="CHANNEL_ERROR"||status==="TIMED_OUT"){ subscribed=false; wireBar(true); }',
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
     "      const p2 = await sb(env, 'pp_album_requests?licence_id=eq.' + encodeURIComponent(id),",
     "      const p2 = await sb(env, 'pp_photos?id=eq.nothing-at-all&licence_id=eq.' + encodeURIComponent(id),",
     "guest EMAIL ADDRESSES are left in the database after a party, while privacy.html says "
     'they are deleted with everything else 30 days after it'),

    ('partyplay-api.test.js',
     'partyplay-backend/worker/SOURCE-do-not-paste-partyplay-api.js',
     "    const cutoff = encodeURIComponent(new Date(Date.now() - ALBUM_KEEP_DAYS * 86400e3).toISOString());",
     "    const cutoff = encodeURIComponent(new Date(Date.now()).toISOString());",
     "a guest's details are deleted the morning after the party, while the album they were "
     'told they have thirty days to download is still up'),

    # ---- 12 Sep 2026: the host console and the TV showed the database's word for a game.
    ('run.html names a game rather than printing its format',
     'partyplay/run.html',
     "      var kind = PPGames.name(g.format);",
     "      var kind = g.format;",
     'the host reads "headstails" and "truths" off their own console part way through a party'),

    ('and the TELEVISION gets the name too, not the slug',
     'partyplay/run.html',
     '    else { var _n=PPGames.name(g.format,g.title);',
     '    else { var _n=(g.title||g.format);',
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

    # ---- 12 Sep 2026: the television's caption wiped every phone. Nine games.
    ('pp-guest-connection.test.js',
     'partyplay/play.html',
     '      if(B || Q || H || T || W || V || PH || CH || GW || GM || DRW) return;\n',
     '',
     "the wall's caption replaces the whole phone again a millisecond after the game "
     'arrives: nothing to tap in trivia, no Heads or Tails buttons, the charades actor '
     'never gets the word, and every ending is erased as it renders'),

    ('pp-guest-connection.test.js',
     'partyplay/play.html',
     '      if(B || Q || H || T || W || V || PH || CH || GW || GM || DRW) return;',
     '      if(B || Q || H || T || W) return;',
     'two of the seven game states drop out of the guard, so Guess the photo and the video '
     'prompt go back to being wiped while the other five are fine, which is the hardest '
     'kind of this bug to find'),

    ('pp-guest-connection.test.js',
     'partyplay/play.html',
     'waiting(s.nickname||"", _ppLive ? "live" : undefined)',
     'waiting(s.nickname||"")',
     'between every game a perfectly connected phone says "Getting you in..." with the '
     'waiting dot, so guests reload in the gap'),

    # ---- 13 Sep 2026: a phone found out a game had started by polling for it.
    ('vp-follow.test.js',
     'venueplay/play.html',
     '    if(m.t==="mode" && typeof VP_LOOK_NOW === "function"){ VP_LOOK_NOW(); }\n',
     '',
     'the phone goes back to ignoring the announcement it is already subscribed to, so the '
     'room watches the television change to trivia while their phones do nothing for up to '
     'thirty seconds'),

    ('vp-follow.test.js',
     'venueplay/play.html',
     '    look(); setInterval(look, 30000);',
     '    look(); setInterval(look, 8000);',
     'the backstop poll goes back to every eight seconds, which is four database reads per '
     'waiting phone and the single biggest load the product generates'),

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

    # ---- 19 Sep: four silent faults, and the checks that now watch them ----
    # These four checks do NOT print a suite file name, they print their own prose, so
    # the label here is a stable substring of that prose. The trailing "(N checks)" is
    # deliberately left out: N changes when the suite fails, which is exactly when the
    # label has to still match.
    # Every one was broken by hand and watched go red before being written down.

    ('a club past 1,000 members sees all of them',
     'venueplay/app/members/host.html',
     '          if(!rows.length) return out;            // empty page: that is the end',
     '          if(rows.length < PAGE) return out.concat(rows);',
     'the member list stops on a SHORT page, so a club over 1,000 members sees the first '
     'page only and a member past it cannot be found or drawn'),

    # NOT 'all 14 paged reads': that number is the count of sbGetAll call sites and it
    # moved from 14 to 13 within the hour, when retagSetCount stopped fetching rows.
    # A label carrying a count goes blind the moment the count changes, silently.
    ('paged reads in venueplay-game.js are ordered',
     'venueplay-backend/worker/venueplay-game.js',
     "')&kicked=eq.false&select=id,session_id,device_id&order=id.asc');",
     "')&kicked=eq.false&select=id,session_id,device_id');",
     'the player read pages with no stable order, so a row can repeat and another be '
     'skipped, and that read is what counts who played and BILLS the venue'),

    ('a malformed body is refused with a reason',
     'venueplay-backend/worker/venueplay-api-FULL.js',
     """  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, res: json({ error: 'That request body was not a JSON object.' }, 400) };
  }""",
     '  // guard removed',
     'a body of null or 42 or [1,2] is handed to a handler that reads properties off it, '
     'so null.foo crashes into a 500 instead of a 400 that says what was wrong'),

    ('parked questions are not advertised',
     'venueplay-backend/worker/venueplay-game.js',
     "'set_id=eq.' + enc(setId) + '&parked_at=is.null&select=id'",
     "'set_id=eq.' + enc(setId) + '&select=id'",
     'the set count includes questions the draw filters out, so a host is told there are '
     'more questions than can ever come up and runs short on the night'),

    # D7 is two checks: the suite, and a grep that stops a handler quietly going back to
    # reading the body raw. The grep needs its own mutation or only half of D7 is proven.
    ('no handler reads the body without a guard',
     'venueplay-backend/worker/venueplay-api-FULL.js',
     '''  const _b = await vpaBody(request, json);
  if (!_b.ok) return _b.res;
  const b = _b.body;
  /* Lower case from the door,''',
     '''  const b = await request.json();
  /* Lower case from the door,''',
     'a handler goes back to reading the body raw, so a malformed body is a 500 that says '
     'nothing instead of a 400 that says what was wrong'),

    # ---- 18-19 Sep: four checks that were added and never broken on purpose ----
    # Found by the run itself listing them as NOT YET PROVEN. A check nobody has seen
    # fail is a green line, not evidence.

    ('a real visitor is counted, an automated browser is not',
     'venueplay/app/vp-analytics.js',
     '      if (navigator.webdriver === true) return true;',
     '      if (false) return true;',
     'our own verify-live browser counts as a visitor again: it walks three live pages '
     'and waits forty seconds on each, so to Google it is the most engaged visitor of '
     'the day and every marketing decision taken off these numbers is wrong'),

    ('an archived venue is not restored',
     'venueplay/app/vp-session.js',
     '''    for (var i = 0; i < mine.length; i++) {
      if (!archivedId(role, mine[i])) return mine[i];
    }''',
     '''    for (var i = 0; i < mine.length; i++) {
      return mine[i];
    }''',
     'the console picks the first venue in an unordered staff list even when it is '
     'archived, so a host is put back into a venue that has been shut and cannot get out'),

    ('the nightly archive sweep fails closed',
     'venueplay-backend/worker/venueplay-api-FULL.js',
     "  const sess = await vpaSelectAll(env, 'vp_sessions',",
     "  const sess = await vpaSelect(env, 'vp_sessions',",
     'the 3:30am sweep reads sessions through a call that returns [] on failure, so one '
     'transient error reads as "this venue has run nothing" and a trading venue is '
     'archived overnight: a dark room on a Friday'),

    ('a failed page throws instead of truncating the export',
     'venueplay-backend/worker/venueplay-api-FULL.js',
     '''  if (!sawTheEnd) {
    throw new Error('read ' + table + ': more than ' + out.length +
                    ' rows, page cap of ' + CAP + ' reached before the end of the list');
  }''',
     '  // cap reached: return what we have',
     'the opt-in export hands a venue a SHORT copy of its own customer list and reports '
     'success, which is the fault this function exists to prevent arriving by another route'),

    ('the venue list is complete and still one call for a host',
     'venueplay/app/vp-session.js',
     '      if (total == null || out.length >= total) return out;',
     '      if (out.length < PAGE) return out;',
     'the venue list reads a SHORT page as the end, so a server whose own max-rows sits '
     'below the page size truncates HQ to one page and says nothing: venues past it '
     'cannot be seen or fixed by anybody'),

    # D6 covers BOTH Workers, so it needs a mutation in each. The billing one pages over
    # sessions, game reports and the opt-in export: money and player data.
    ('paged reads in venueplay-api-FULL.js are ordered',
     'venueplay-backend/worker/venueplay-api-FULL.js',
     # Anchored on the ORDER line, which is unique. The select line above it appears
     # twice in this file, and a find-string that matches twice is aimed by file order:
     # as bad as one that matches nothing, and quieter about it.
     "    '&order=venue_id.asc,opened_at.asc,id.asc');",
     "    '');",
     'the nightly sweep pages sessions with a broken order clause, so rows repeat and '
     'others are skipped, and the sweep decides which venues get archived'),

    # D6 ALSO CHECKS ITS OWN COVERAGE, and this proves that half. Give one call a
    # variable table name and the ordering line above happily reports "12 reads, ok"
    # while a thirteenth goes unwatched. Seen doing exactly that before it was written
    # down: the ordering check stayed green at 12 and only the coverage line went red.
    ('the check can see every sbGetAll call',
     'venueplay-backend/worker/venueplay-game.js',
     "  const rows = await sbGetAll(env, 'vp_venues',",
     "  const _t = 'vp_venues';\n  const rows = await sbGetAll(env, _t,",
     'a paged read written with a variable table name is invisible to the order check, '
     'so it is skipped in silence and the gate still says every read is ordered'),

    # ---- 20 Sep: the purge with no undo ----
    ('archiving starts the purge clock and reactivating clears it',
     'venueplay-backend/worker/venueplay-api-FULL.js',
     "  if (status === 'active') statusPatch.closed_at = null;",
     "  // forgot to clear the clock",
     'a venue un-archived from HQ keeps its old closed date, so months later one failed card '
     'puts a LIVE customer in front of the 3am purge and their players are wiped, no undo'),

    ('the real templates render with every venue',
     'venueplay-backend/worker/venueplay-api-FULL.js',
     "    const tvFor = (v) => site + '/tv' + (v && v.slug ? ('?' + encodeURIComponent(v.slug)) : '');",
     "    const tvFor = (v) => site + '/tv';",
     'every welcome email hands the venue a TV link that names no venue, so the screen sits in '
     'its setup state on day one and the customer thinks the product is broken'),

    ('a manager whose permissions cannot be read is refused',
     'venueplay-backend/worker/venueplay-api-FULL.js',
     "      return { error: 'We could not check your access just now. Please try again in a moment.', status: 503 };",
     "      /* swallowed */",
     'one 429 on the permissions read turns a manager with billing:false into somebody who '
     'can change billing and add hosts, because null permissions read as the owner'),

    ('a manager whose permissions cannot be read is refused',
     'venueplay/app/hq.html',
     '''  function csvCell(v){ v=(v==null?"":String(v)); if(/^[=+\\-@\\t\\r]/.test(v)) v="'"+v; if(/[",\\n\\r]/.test(v)){''',
     '''  function csvCell(v){ v=(v==null?"":String(v)); if(/[",\\n\\r]/.test(v)){''',
     'a venue name typed as =HYPERLINK on the signup form runs as a formula the moment HQ opens '
     'its venue export in Excel'),

    ('a manager whose permissions cannot be read is refused',
     'venueplay/app/billing.html',
     '''    function cell(s){ s = String(s == null ? "" : s); if (/^[=+\\-@\\t\\r]/.test(s)) s = "'" + s; return''',
     '''    function cell(s){ s = String(s == null ? "" : s); return''',
     'a raffle winner who typed -1 or @SUM as a name runs it in the venue\'s draws spreadsheet'),

    ('a win survives heartbeats and reconnects',
     'venueplay/play.html',
     '      if(_same) return;\n',
     '',
     'the phone reads a RESEND of tickets it already holds as a new round, so a winner is put '
     'back on her ordinary ticket inside thirty seconds with the BINGO button live again, on '
     'her way to the host to be paid'),

    ('a dropped game channel is rebuilt',
     'venueplay/app/vp-screen-router.js',
     '            try { client.removeChannel(mine); } catch (e) {}\n            try { watch(); } catch (e) {',
     '            try { mine.subscribe(function () {}); } catch (e) {',
     'the retry subscribes the same channel object again, supabase-js refuses, and after one '
     'wifi blip the wall stays on the finished quiz while the host runs a raffle'),

    # THE MONEY BATCH, audit of 20 Sep 2026. Each one puts the original fault back.
    ('adding a venue charges a month and credits it straight back',
     'venueplay-backend/worker/venueplay-api-FULL.js',
     "  return 'newvenue:' + String(venueId || '') + ':' + players",
     "  return 'newvenue:' + 'The Royal Hotel' + ':' + players",
     'two venues share one Stripe idempotency key, so the second setup charge is replayed from '
     'the first and never exists, while its free month is credited anyway'),

    ('one email, one bill, and the promised free month',
     'venueplay-backend/worker/venueplay-api-FULL.js',
     "    const ors = ['contact_email.' + vpaEmailIs(email)];",
     "    const ors = ['contact_email.eq.' + encodeURIComponent(email)];",
     'Bob@ and bob@ are two people again, and the second one is billed in full on a '
     'subscription the owner cannot see or cancel'),

    ('one email, one bill, and the promised free month',
     'venueplay-backend/worker/venueplay-api-FULL.js',
     "  const foundingCode = (b.founding_code || '').trim().toUpperCase();",
     "  const foundingCode = (b.founding_code || '').trim();",
     'the page says the deal is open (GET /founding upper-cases) and the checkout charges '
     'standard for the same code in lower case, with nothing on screen to say so'),

    ('a refused undo puts back every field it wrote',
     'venueplay-backend/worker/venueplay-api-FULL.js',
     "encodeURIComponent(venueId), before);",
     "encodeURIComponent(venueId), { cancel_at_period_end: undo });",
     'Stripe says no, the page says nothing changed, and the venue is left active with no '
     'subscription behind it'),

    ('only a FINISHED Stripe event is answered 200',
     'venueplay-backend/worker/venueplay-api-FULL.js',
     "    if (!(age > VPA_EVENT_STALE_MS)) return 'busy';",
     "    if (!(age > VPA_EVENT_STALE_MS)) return 'skip';",
     'a retry of a delivery that threw is told already handled; paid, no venue, no login'),

    ('the real templates render with every venue, its own TV link and no raw tags',
     'venueplay-backend/worker/venueplay-api-FULL.js',
     "    const firstChargeTs = metaTrial > nowSecs ? metaTrial : nowSecs + 30 * 24 * 60 * 60;",
     "    const firstChargeTs = nowSecs + 30 * 24 * 60 * 60;",
     'a returning venue is promised thirty free days and charged after three'),

    ('a draw record cannot be rewritten', 'venueplay-backend/worker/venueplay-game.js',
     "    if (wrongId || wrongNo) {",
     "    if (false) {",
     'a stale tablet presses Claim and the jackpot is recorded against a member the draw never picked'),

    ('a draw record cannot be rewritten', 'venueplay-backend/worker/venueplay-game.js',
     "  if (lastResolved && !openRow && nothingSince) {",
     "  if (lastResolved && (Date.now() - lastResolved) < 300000) {",
     'the stopwatch is back: a genuine second claim is ignored and a late repeat rolls the jackpot twice'),

    ('a draw record cannot be rewritten', 'venueplay-backend/worker/venueplay-game.js',
     "    if (was === 'claimed') {",
     "    if (was === 'never') {",
     'a claimed raffle prize is rewritten to no-show and a second ticket is drawn for it'),

    ('a draw record cannot be rewritten', 'venueplay-backend/worker/venueplay-game.js',
     "          seq: r.seq,\n          ticket: r.ticket_number,",
     "          ticket: r.ticket_number,",
     'every console reload re-arms Claim and redraw on a prize already handed over'),

    ('the free-entry popup shows each state its own prize thresholds', 'venueplay/app/vp-gaming.js',
     "      if (free.length) {",
     "      if (false) {",
     'the thresholds go back to being unreachable on the only path venues are on'),

    ('the free-entry popup shows each state its own prize thresholds', 'venueplay/app/vp-gaming.js',
     "so this is a promotional game, not a paid one.';",
     "so this is a promotional game and needs no licence anywhere.';",
     'every venue in every state is told a free game needs no licence anywhere'),

    # The five careless edits from the audit of 20 Sep 2026, which all passed the gate that day.
    ('an old or altered Stripe signature is refused', 'venueplay-backend/worker/venueplay-api-FULL.js',
     "  if (!isFinite(ts) || Math.abs(Math.floor(Date.now() / 1000) - ts) > 300) return false;",
     "  if (!isFinite(ts)) return false;",
     'a captured invoice.paid can be replayed for ever'),

    ('every host route checks the login and the venue, draws use crypto', 'venueplay-backend/worker/venueplay-game.js',
     "min + randInt(span)",
     "min + Math.floor(Math.random() * span)",
     'the raffle draws on Math.random: still uniform, so the fairness test stays green, and a licence matter'),

    ('every host route checks the login and the venue, draws use crypto', 'venueplay-backend/worker/venueplay-game.js',
     "const OVERAGE_ABSOLUTE_MAX = 500",
     "const OVERAGE_ABSOLUTE_MAX = 5000",
     'one night can bill ten times the extras anybody agreed to'),

    ('every host route checks the login and the venue, draws use crypto', 'venueplay-backend/worker/venueplay-game.js',
     "  const staff = await requireStaff(env, authUserId, session.venue_id);   // ENFORCED: staff at the claim's venue",
     "  const staff = { role: 'owner' };   // staff at the claim's venue",
     'any signed-in host can rule on any venue\'s bingo claim'),

    ('a room shares one leaderboard read', 'venueplay-backend/worker/venueplay-game.js',
     "  let board = qKey ? cached('b:' + gameId + ':' + qKey) : null;",
     "  let board = null;",
     'every phone reads the whole leaderboard for itself again: 160 calls a reveal'),

    ('a room shares one leaderboard read', 'venueplay-backend/worker/venueplay-game.js',
     "    if (qKey) cache.set('b:' + gameId + ':' + qKey, { data: board, until: nowMs + 8000 });",
     "    cache.set('b:' + gameId, { data: board, until: nowMs + 8000 });",
     'the kept leaderboard forgets which question it was for, and question 8 is answered with question 7'),

    ('the phones that stamped played_at are the players', 'venueplay-backend/worker/venueplay-game.js',
     "      for (const p of alive) if (p && p.id) played.add(p.id);",
     "",
     'the stamp is read and thrown away: broadcast bingo bills every phone that opened the join page again'),

    ('a manager whose permissions cannot be read is refused', 'venueplay-backend/worker/venueplay-api-FULL.js',
     "  if (ip && !(await helpIpLimit(env, 'contact', ip, CONTACT_MAX_PER_IP, 3600))) {",
     "  if (false) {",
     '/contact sends an email per request again with no limit at all, on the same Resend key '
     'as every invoice and welcome email'),

    ('the phones that stamped played_at are the players', 'venueplay-backend/worker/venueplay-game.js',
     "    await sbPatch(env, 'vp_players', 'id=eq.' + enc(player.id) + '&played_at=is.null',",
     "    await sbPatch(env, 'vp_players', 'session_id=eq.' + enc(player.session_id) + '&played_at=is.null',",
     'one phone saying it is in the game stamps every phone in the session, phantoms included'),

    ('the phones that stamped played_at are the players', 'venueplay/play.html',
     "  function renderCards(){\n    sayAlive();",
     "  function renderCards(){",
     'the bingo phone never says it is in the game, so a bingo night falls back to billing '
     'every phone that opened the page, which is the fault this closes'),

    ('a screen refetches the key on an unknown kid', 'venueplay/app/vp-sign.js',
     "        if (!S._keyRefresh) S._keyRefresh = setInterval(function () { attempt(); }, KEY_REFRESH_MS);",
     "",
     'a screen fetches the key once and never again: after a rotation the wall is deaf to the '
     'new console until somebody reloads it'),

    ('a screen refetches the key on an unknown kid', 'venueplay/app/vp-sign.js',
     "          pre = Promise.resolve(S._refetch()).catch(function () {});",
     "          pre = Promise.resolve();",
     'the first messages from a freshly minted console are thrown away on the old key'),

    ('a screen refetches the key on an unknown kid', 'venueplay/app/vp-sign.js',
     "      if (!S._hostRefresh) S._hostRefresh = setInterval(function () { VPSign._initHost(S.apiBase, S.slug, S.hostGetToken).then(function () { VPSign._cantSignCheck(S.slug); }); }, KEY_REFRESH_MS);",
     "",
     'a console never asks for the key again, so after a rotation nobody mints the new one and '
     'the venue has no key until the next sign-in'),

    ('the venue key is deleted with the login', 'venueplay-backend/worker/venueplay-api-FULL.js',
     "  await vpbRotateScreenKeys(env, venueIds);\n  return json({ ok: true, screens_resecured: venueIds.length });",
     "  return json({ ok: true, screens_resecured: venueIds.length });",
     'a removed host keeps a key that signs balls and winners for ever'),

    ('staff of the Royal are offered the Royal and nothing else', 'venueplay/app/index.html',
     "        mine = (vs||[]).filter(function(v){ return ids[v.id]; });",
     "        mine = (vs||[]).filter(function(v){ return ids[v.id] || true; });",
     'a host at one pub is offered every venue on the platform (the audit of 20 Sep 2026 made '
     'exactly this change and the gate stayed green)'),

    ('staff of the Royal are offered the Royal and nothing else', 'venueplay/app/index.html',
     "                        if(cur.founding_id && v.founding_id===cur.founding_id) return true;",
     "                        return true;",
     'an admin viewing as one venue is offered the whole customer list on the host console'),

    ('no gate check has disappeared', 'tools/release-check.py',
     "    ok('no ternary picks between two identical strings', not tern_hits,",
     "    (lambda *a, **k: None)('no ternary picks between two identical strings', not tern_hits,",
     'a check is deleted from the gate and nothing says so (the audit of 20 Sep 2026: '
     'nothing stops the gate itself being edited green)'),

    ('no gate check was added unseen', 'tools/release-check.py',
     "    ok('no ternary picks between two identical strings', not tern_hits,",
     "    ok('no ternary picks between two identical strings, and never will', not tern_hits,",
     'a check appears under a new name with no mutation behind it and reads as covered'),

    ('and the check can see every sbGetAll call in venueplay-game.js', 'venueplay-backend/worker/venueplay-game.js',
     "  const qs = await sbGetAll(env, 'vp_questions',",
     "  const qs = await sbGetAll(env, ('vp_questions'),",
     'a paged read written with a computed table name is invisible to the order check and '
     'still passes; this is the line that has to notice the count no longer agrees'),

    ('and the check can see every vpaSelectAll call in venueplay-api-FULL.js', 'venueplay-backend/worker/venueplay-api-FULL.js',
     "  const players = await vpaSelectAll(env, 'vp_players',",
     "  const players = await vpaSelectAll(env, ('vp_players'),",
     'same as above, on the billing Worker'),

    ('it discloses members lists, the browser identifier and the hashed address', 'venueplay/privacy.html',
     '<p><strong>Members lists.</strong>',
     '<p><strong>Club lists.</strong>',
     'the privacy policy stops naming the members list, which holds the names of people '
     'who never opened VenuePlay'),

    ('it does not promise that a venue can remove a player itself', 'venueplay/privacy.html',
     'or contact us at the address in section 14.</p>',
     'or contact us at the address in section 14. For players, the venue can remove them from its list.</p>',
     'the policy promises a button no screen has'),

    ('a console can put the game back on the wall', 'venueplay/app/musical/host.html',
     '    _lastReassert = now;\n    reassertToTv();\n  }',
     '    _lastReassert = now;\n  }',
     'the console listens for its return and replays nothing: the wall stays on ads after '
     'the tablet sleeps (the audit of 20 Sep 2026 made exactly this change with the gate green)'),

    ('a black wall is rebuilt once then reloaded', 'venueplay/tv.html',
     '        reload("black-screen");                 // the repair did not take, so start clean',
     '        strikes = 0;',
     'a black screen is never reloaded (the audit of 20 Sep 2026 made exactly this change and '
     'every gate stayed green)'),

    ('a black wall is rebuilt once then reloaded', 'venueplay/tv.html',
     '      try{ if(navigator.onLine === false) return; }catch(e){}\n      try{\n        var last = parseInt(sessionStorage.getItem("vpTvReloadAt")',
     '      try{\n        var last = parseInt(sessionStorage.getItem("vpTvReloadAt")',
     'an offline screen reloads into a browser error page in front of the room'),

    ('a black wall is rebuilt once then reloaded', 'venueplay/tv.html',
     '        if(Date.now() - last < MIN_GAP) return;',
     '',
     'a broken page thrashes reloads every twenty seconds'),

    ('a black wall is rebuilt once then reloaded', 'venueplay/tv.html',
     '      if(!idle()) return !gameLooksFrozen();',
     '      if(!idle()) return true;',
     'a game on the wall is proof of life again, so a board frozen since last night sits '
     'there for ever (the 5 Sep 2026 Mini Bar fault)'),

    ('naming a venue you hold picks its account', 'venueplay-backend/worker/venueplay-api-FULL.js',
     "  const totalPlayers = (stripeQty != null && stripeQty > 0 && !pendingReduction) ? stripeQty : localPlayers;",
     "  const totalPlayers = (stripeQty != null && stripeQty > 0) ? stripeQty : localPlayers;",
     'after a monthly reduction the page says "this month: 60 players" to a venue that paid '
     'for 80 and still has 80'),

    ('a stranger in the answers room reaches no other phone', 'venueplay-backend/worker/venueplay-game.js',
     "    if (a.ao) return;\n    this.relay(JSON.stringify(obj), ws);",
     "    this.relay(JSON.stringify(obj), ws);",
     'the answers room relays again: one stranger can acknowledge, or refuse, every answer in '
     'the room'),

    ('a stranger in the answers room reaches no other phone', 'venueplay-backend/worker/venueplay-game.js',
     "    const answersOnly = /^vpa-/.test(String(url.searchParams.get('room') || ''));",
     "    const answersOnly = false;",
     'no socket is ever marked as an answers-room socket, so the guard never fires'),

    ('musical-draw.test.js', 'venueplay/app/musical/host.html',
     "      var pool=LIB.songs.slice(), n=Math.min(GAME_SONGS,pool.length);",
     "      var pool=LIB.songs.slice(), n=Math.min(50,pool.length);",
     'Surprise Mix is a 50 song night again while every other playlist is 60, and nothing says so'),

    ('bingo-after-the-win.test.js', 'venueplay/app/index.html',
     "    if(p._books[bi]===undefined) p._books[bi]=window.VPDraw.makeStrip();",
     "    p._books[bi]=window.VPDraw.makeStrip();",
     'every top-up is a fresh book again: six tickets sold one at a time carry 24 numbers twice '
     'and 35 not at all'),

    ('an answer at second ten scores 125 whether or not the host adds time afterwards', 'venueplay-backend/worker/venueplay-game.js',
     "  if (endsAtMs && cfg.time_added && cfg.time_added.seq === t.current_seq && cfg.time_added.ms > 0) endsAtMs -= cfg.time_added.ms;",
     "",
     'the reveal scores against the moved deadline again: add ten seconds and every answer '
     'already in gets the full bonus'),

    ('a screen finding itself is answered, the thirty-first ask a minute is refused', 'venueplay-backend/worker/venueplay-game.js',
     "    const rl = await rateLimit(env, 'like:ip:' + ipHash, LIKE_MAX_PER_IP, 60);\n    if (!rl.ok)",
     "    const rl = { ok: true };\n    if (!rl.ok)",
     'the venue-name search answers without limit again, and the customer list is one '
     'dictionary of common pub words away'),

    ('ten weeks of "add 20" reach past the first hundred rows', 'venueplay-backend/worker/venueplay-game.js',
     "    image_url: (q.image_url && /^https:\\/\\//i.test(String(q.image_url))) ? String(q.image_url).slice(0, 600) : null,",
     "    image_url: q.image_url ? String(q.image_url).slice(0, 600) : null,",
     'a question ADDED with a javascript: picture link goes into the set and onto every phone'),

    ('the within-night memory is by question id', 'venueplay-backend/worker/venueplay-game.js',
     "    if (Array.isArray(c.question_ids)) c.question_ids.forEach((id) => { usedIds[id] = true; });\n    else if (Array.isArray(c.question_seqs))",
     "    if (Array.isArray(c.question_seqs))",
     'the memory is positions again: a removal between rounds renumbers the set and round two '
     'repeats five of round one\'s questions'),

    ('the within-night memory is by question id', 'venueplay-backend/worker/venueplay-game.js',
     "    if (running.length) return json({ error: 'A trivia round is running on this set. Finish the round, then remove the question.' }, 409);",
     "    if (running.length) { /* allowed */ }",
     'a question removed mid-round shifts every later question under the room, and the reveal '
     'scores answers against the wrong one'),

    ('a draw record cannot be rewritten by a stale tablet', 'venueplay-backend/worker/venueplay-game.js',
     "  if (!isRedraw && raffle.allow_redraw && prior.length && maxSeq > 0) {",
     "  if (false) {",
     'a raffle draw whose reply was lost is retried and mints a SECOND round: two winners for '
     'one prize, the first ticket stuck at drawn for ever'),

    ('naming a venue you hold picks its account', 'venueplay-backend/worker/venueplay-api-FULL.js',
     "    if (held) chosen = held;",
     "    if (held) chosen = venues[0];",
     'the header is read and ignored: Sam is back on the older account for ever'),

    ('naming a venue you hold picks its account', 'venueplay-backend/worker/venueplay-api-FULL.js',
     "    const held = venues.find((v) => v.id === target);",
     "    const held = (await vpaSelect(env, 'vp_venues', 'id=eq.' + encodeURIComponent(target) + '&select=id,founding_id'))[0];",
     'any venue id in the header picks its account, held or not: every account on the platform '
     'is one guessed uuid away'),

    ('ten weeks of "add 20" reach past the first hundred rows', 'venueplay-backend/worker/venueplay-game.js',
     "  const start = total > size ? randInt(total - size + 1) : 0;",
     "  const start = 0;",
     'every pull is the first hundred rows again; a venue never sees the rest of the bank'),

    ('ten weeks of "add 20" reach past the first hundred rows', 'venueplay-backend/worker/venueplay-game.js',
     "        + '&parked_at=is.null'   // pulled for a fact-check: not on offer, the same rule as the search below\n",
     "",
     'a question parked for a fact-check is dealt to a pub on Tuesday'),

    ('the phones do not all ask in the same instant', 'venueplay/app/trivia/play.html',
     "      var _wait = gotIt ? Math.random()*800 : 500+Math.random()*2000;",
     "      var _wait = 0;",
     'every phone in the room asks in the same millisecond again'),

    ('a forged join, claim or leave for another player is dropped', 'venueplay/app/index.html',
     "        if(!v || !v.ok) return;\n",
     "",
     'the console checks the signature and then believes the message anyway'),

    ('a forged join, claim or leave for another player is dropped', 'venueplay/app/index.html',
     "        else if(!VPPhoneKey.fresh((G.seenN||(G.seenN={})), m, Date.now())) return;",
     "        else if(false) return;",
     'a real signed leave can be played back all night to throw her out of the game'),

    ('a forged join, claim or leave for another player is dropped', 'venueplay/app/vp-phonekey.js',
     "        if (pid !== m.pid) return { ok: false, legacy: false, why: \"that key is not this pid\" };",
     "",
     'anybody can sign with their OWN key and put her pid on it'),

    ('a forged join, claim or leave for another player is dropped', 'venueplay/app/vp-phonekey.js',
     "      m.name == null ? \"\" : String(m.name), m.cards == null",
     "      \"\", m.cards == null",
     'the name is not part of what is signed, so a captured join can be re-sent under another name'),


    ('after a blip the TV settles on four channels and stops', 'venueplay/tv.html',
     "              var old = c; c = null;\n              try{ client.removeChannel(old); }catch(e){}",
     "              try{ client.removeChannel(c); }catch(e){}",
     'the old channel reports CLOSED while it is still the current one, and the flap is back'),

    ('after a blip the TV settles on four channels and stops', 'venueplay/tv.html',
     "          if(mine !== c) return;\n",
     "",
     'a replaced channel is believed again'),

    ('a dropped game channel is rebuilt', 'venueplay/app/vp-screen-router.js',
     "            if (c === mine) c = null;\n",
     "",
     'every blip leaves a second live channel beside the healthy one, and every message is handled twice'),

    ('the screen badges are re-read every minute', 'venueplay/app/hq.html',
     "  setInterval(refreshScreens, 60000);\n",
     "",
     'HQ goes back to showing a health reading from whenever the page was opened'),

    ('no page says extra players join', 'venueplay/nsw.html',
     "Extra players are $2 each for that night, and your host OKs it on screen first.",
     "The extra players just join at the same per-player rate.",
     'a sales page promises extras at the monthly rate and we charge $2 a head'),

    ('no heading or paragraph of the Terms starts with a lower-case word', 'venueplay/terms.html',
     "<h2>2. State offer</h2>", "<h2>2. offer</h2>",
     'the contract loses the subject of a clause again'),

    ('the real templates render with every venue, its own TV link and no raw tags', 'venueplay-backend/worker/venueplay-api-FULL.js',
     "    ? fmt(monthlyTotal * 12) + ' a year, billed yearly (' + fmt(monthlyTotal) + ' a month)'",
     "    ? fmt(monthlyTotal) + ' a month'",
     'an annual venue is told a monthly figure and charged twelve times it'),

    ('bingo-after-the-win.test.js', 'venueplay/app/index.html',
     "    if(G.claims.length && !G.won){\n      var _now=Date.now();",
     "    if(false){\n      var _now=Date.now();",
     'a player who shouted BINGO is dropped without a word when the host taps End game'),

    ('every "address in section N" points at the section that is really Contact us', 'venueplay/privacy.html',
     "contact us at the address in section 14. We will remove", "contact us at the address in section 10. We will remove",
     'the privacy policy sends people to the Cookies section to find our address'),

    ('bingo-after-the-win.test.js', 'venueplay/app/index.html',
     "        if(_back){ G.players[m.pid].paid=_back.paid;",
     "        if(false){ G.players[m.pid].paid=_back.paid;",
     'a player who paid for six tickets, left by mistake and rejoined is told to buy tickets at the bar'),

    ('the free-entry popup shows each state its own prize thresholds', 'venueplay/app/vp-gaming.js',
     "}) || {}, false, false);",
     "}) || {}, false);",
     'a declaration nobody saw is recorded as if the host had pressed OK'),

    ('the free-entry popup shows each state its own prize thresholds', 'venueplay/app/vp-gaming.js',
     "    if (kind === 'bingo' && opts.format !== 'musical' && st.phones",
     "    if (kind === 'bingo' && st.phones",
     'musical bingo hosts in SA, VIC and TAS are told paper only, against the owner\'s ruling (21 Sep and 15 Oct 2026)'),

    ('the welcome email goes out on whichever run finishes provisioning', 'venueplay-backend/worker/venueplay-api-FULL.js',
     # 25 Sep: send() is now awaited for its outcome, so the anchor is the early return itself.
     "    if (prior && prior.length) return false;\n    /* ONLY A WELCOME THAT WENT",
     "    /* ONLY A WELCOME THAT WENT",
     'every Stripe redelivery welcomes the customer again'),

    ('a new lobby in a multi-game night sends phones to that game', 'venueplay-backend/worker/venueplay-game.js',
     "    else if (sessions[0].lobby_format) format = String(sessions[0].lobby_format);",
     "    else if (false) format = String(sessions[0].lobby_format);",
     'the bingo lobby after trivia sends the whole room to the finished trivia page'),

    # D56, D57 and the three in-browser suites: unlimited nights (migration 107), the logo editor,
    # on-brand dropdowns and the account wording. Dean, 19 Oct 2026.
    ('the game Worker and the console mirror skip the once-a-week rule only for weekly_limit_off true, and keep it before 107', 'venueplay-backend/worker/venueplay-game.js',
     '  if (v.weekly_limit_off === true) return null;   // HQ lifted the once-a-week rule for this venue\n',
     '',
     'HQ switches a venue to unlimited nights and the Worker still refuses its second trivia night'),
    ('the game Worker and the console mirror skip the once-a-week rule only for weekly_limit_off true, and keep it before 107', 'venueplay-backend/worker/venueplay-game.js',
     '  if (v.weekly_limit_off === true) return null;',
     '  if (v.weekly_limit_off) return null;',
     'any truthy value, a stray string included, lifts the once-a-week rule'),
    ('the game Worker and the console mirror skip the once-a-week rule only for weekly_limit_off true, and keep it before 107', 'venueplay-backend/worker/venueplay-game.js',
     "  } catch (_) {\n    venues = await sbGet(env, 'vp_venues', base);\n  }",
     '  } catch (_) {\n    throw _;\n  }',
     'before migration 107 is run every trivia and musical night fails to start'),
    ('the game Worker and the console mirror skip the once-a-week rule only for weekly_limit_off true, and keep it before 107', 'venueplay/app/vp-weekly.js',
     '    if (venue.weekly_limit_off === true) return null;\n',
     '',
     'the console warns "already ran this week" at a venue HQ gave unlimited nights'),
    ('owner/accounts admins set it with an audit row; staff admins, venue logins and strangers are refused; only true/false', 'venueplay-backend/worker/venueplay-api-FULL.js',
     "async function vpaHandleVenueGaming(request, env, json) {\n  const actor = await vpaRequireAdmin(request, env, ['owner', 'accounts']);",
     'async function vpaHandleVenueGaming(request, env, json) {\n  const actor = await vpaRequireAdmin(request, env, null);',
     'any HQ login, staff included, can give a venue unlimited nights'),
    ('owner/accounts admins set it with an audit row; staff admins, venue logins and strangers are refused; only true/false', 'venueplay-backend/worker/venueplay-api-FULL.js',
     '    if (b.weekly_limit_off !== true && b.weekly_limit_off !== false) {',
     '    if (false) {',
     'the string "true" or a 1 is written into the switch'),
    ('owner/accounts admins set it with an audit row; staff admins, venue logins and strangers are refused; only true/false', 'venueplay-backend/worker/venueplay-api-FULL.js',
     "      action: patch.weekly_limit_off ? 'venue_unlimited_nights_on' : 'venue_unlimited_nights_off',",
     "      action: 'venue_gaming_updated',",
     'nobody can find who gave a venue unlimited nights in the audit log'),
    ('owner/accounts admins set it with an audit row; staff admins, venue logins and strangers are refused; only true/false', 'venueplay-backend/worker/venueplay-api-FULL.js',
     '    if (patch.weekly_limit_off !== undefined && /weekly_limit_off/.test(t)) {',
     '    if (false) {',
     'before migration 107 HQ is told "Could not save" with a database error instead of what to do'),
    ('migrations-parse.test.py', 'venueplay-backend/supabase/venueplay-107-unlimited-nights-switch.sql',
     'commit;\n',
     'commit;\nUnlimited nights for Deepwater Hotel\n',
     'a stray line in a migration is found by Dean in the Supabase editor, as 106 was'),
    ('migrations-parse.test.py', 'venueplay-backend/supabase/venueplay-107-unlimited-nights-switch.sql',
     'before insert or update of weekly_limit_off on public.vp_venues',
     'before update of weekly_limit_off on public.vp_venues',
     'a venue login inserting a row could set the switch itself'),
    ('migrations-parse.test.py', 'venueplay-backend/supabase/venueplay-107-unlimited-nights-switch.sql',
     '    new.weekly_limit_off := old.weekly_limit_off;\n',
     '    null;\n',
     'an owner or manager login turns its own once-a-week limit off'),
    ('migrations-parse.test.py', 'venueplay-backend/supabase/venueplay-107-unlimited-nights-switch.sql',
     'language plpgsql\nset search_path = public',
     'language plpgsql\nsecurity definer\nset search_path = public',
     'a new definer function the RLS baseline does not list'),
    ('dropdowns-in-chrome.test.py', 'venueplay/app/vp-select.css',
     '  -webkit-appearance: none !important;\n  -moz-appearance: none !important;\n  appearance: none !important;\n',
     '',
     "every admin dropdown goes back to the browser's own control"),
    ('dropdowns-in-chrome.test.py', 'venueplay/app/vp-select.css',
     '  color-scheme: dark;\n',
     '  color-scheme: normal;\n',
     'the open list is white on an iPhone and a Mac'),
    ('dropdowns-in-chrome.test.py', 'venueplay/app/vp-select.css',
     '@media (max-width: 640px) {\n  select { font-size: 16px !important; }\n}\n',
     '',
     'iOS Safari zooms the whole page into a dropdown when it is tapped'),
    ('dropdowns-in-chrome.test.py', 'venueplay/app/vp-select.css',
     '  box-shadow: 0 0 0 3px rgba(255, 31, 142, 0.22);',
     '  box-shadow: none;',
     'a focused dropdown on Your account shows no focus ring'),
    ('dropdowns-in-chrome.test.py', 'venueplay/app/billing.html',
     '<link rel="stylesheet" href="/app/vp-select.css">',
     '',
     'a page that forgets the shared stylesheet goes back to grey native dropdowns'),
    ('dropdowns-in-chrome.test.py', 'touring/manage.html',
     '.afield select{-webkit-appearance:none;-moz-appearance:none;appearance:none;color-scheme:dark;cursor:pointer;',
     '.afield select{cursor:pointer;',
     "the show manager's tour picker is the browser's grey control again"),
    ('dropdowns-in-chrome.test.py', 'venueplay/app/billing.html',
     "that change applies from your next renewal, so you're never left short.",
     'Reductions apply from your next renewal, so you are never left short.',
     'the account page says "Reductions" again, which reads as "deductions"'),
    ('dropdowns-in-chrome.test.py', 'venueplay/app/hq.html',
     '        weeklyOffHtml(v)+\n',
     '',
     'HQ has no switch for unlimited nights'),
    ('dropdowns-in-chrome.test.py', 'venueplay/app/hq.html',
     '    if(wo) setWeeklyOff(wo.getAttribute("data-vid"), wo.checked, wo);\n',
     '',
     'the HQ switch ticks and nothing is saved or audited'),
    ('logo-tools-in-chrome.test.py', 'venueplay/app/vp-logo.js',
     '    var k = Math.min(1, m / Math.max(s.w, s.h));',
     '    var k = 1;',
     'a 4000 pixel phone photo is kept full size'),
    ('logo-tools-in-chrome.test.py', 'venueplay/app/vp-logo.js',
     '    for (var x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }\n    for (var y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }\n    while (sp) {',
     '    for (var x = 0; x < w * h; x++) { push(x); }\n    while (sp) {',
     'Remove background eats the white inside the letters, not only the box around them'),
    ('logo-tools-in-chrome.test.py', 'venueplay/app/vp-logo.js',
     '  var MAX_BYTES = 950 * 1024;',
     '  var MAX_BYTES = 4 * 1024 * 1024;',
     'a picture the Worker will refuse as over 1 MB is sent anyway'),
    ('logo-tools-in-chrome.test.py', 'venueplay/app/vp-logo.js',
     "            if (dataUrlBytes(u) <= MAX_BYTES) { url = u; type = 'image/webp'; break; }",
     "            if (false) { url = u; type = 'image/webp'; break; }",
     'a photo goes up as a PNG several times the size of the WebP'),
    ('logo-tools-in-chrome.test.py', 'venueplay/app/billing.html',
     '<script src="/app/vp-logo.js"></script>\n',
     '',
     'choosing a logo does nothing at all'),
    ('logo-tools-in-chrome.test.py', 'venueplay/app/billing.html',
     '    if(tl) tl.addEventListener("input", function(){ if(logoEd.mode==="cut") logoCut(); });\n',
     '',
     'the slider moves and the preview does not change'),
    ('logo-tools-in-chrome.test.py', 'venueplay/app/billing.html',
     '    if(mo) mo.addEventListener("change", function(){ if(this.checked){ logoEd.mode="orig"; logoPaint(); } });\n',
     '',
     'once the background is removed the original cannot be had back'),
    ('logo-tools-in-chrome.test.py', 'venueplay/app/settings.html',
     '    <!-- The logo is set in ONE place:',
     '    <div class="card" id="logoSignpost"><div class="lbl">Your logo</div><a class="link" href="billing.html#screen">Set your logo</a></div>\n    <!-- The logo is set in ONE place:',
     'the second logo option comes back on Venue settings'),

    ('logo-tools-in-chrome.test.py', 'venueplay/app/billing.html',
     '  .logomodes:not([hidden]){display:grid;',
     '  .logomodes{display:grid;',
     'the Original / Background removed choice shows before anything has been removed'),
    # HQ lists (Dean, 19 Oct 2026): venues that have left hidden but searchable; Quiet and Cancelled tab badges.
    ('hq-lists-in-chrome.test.py', 'venueplay/app/hq.html',
     '       hasLeft(v) && !S.showLeft && !searching) return false;',
     '       hasLeft(v) && !S.showLeft) return false;',
     'a venue that has left cannot be found by searching for it'),
    ('hq-lists-in-chrome.test.py', 'venueplay/app/hq.html',
     '    return v.status==="suspended" && LEFT_REASONS.indexOf(v.suspended_reason)>=0;',
     '    return v.status==="suspended";',
     'unpaid venues vanish from the Venues list, the ones that need chasing'),
    ('hq-lists-in-chrome.test.py', 'venueplay/app/hq.html',
     '    if(since && Date.parse(a.created_at) < since) return null;\n',
     '',
     'a venue rung months ago that went quiet again never reaches the badge'),
    ('hq-lists-in-chrome.test.py', 'venueplay/app/hq.html',
     '      if(st.contacted && st.when && Date.parse(st.contacted.created_at) < Date.parse(st.when)) st.contacted=null;\n',
     '',
     'a venue that cancels a second time is shown as already rung'),
    ('hq-lists-in-chrome.test.py', 'venueplay/app/hq.html',
     '    loadTabBadges();\n',
     '',
     'the badges only appear once somebody opens the tab'),
    ('hq-lists-in-chrome.test.py', 'venueplay/app/hq.html',
     '      setTabBadge("quiet", todo);\n',
     '',
     'marking a quiet venue contacted leaves the badge counting it'),
    ('hq-lists-in-chrome.test.py', 'venueplay/app/hq.html',
     '      if(hasLeft(mine || v)) return false;\n',
     '',
     'venues that have ended sit on the quiet chase list and in its count'),
    ('hq-lists-in-chrome.test.py', 'venueplay/app/hq.html',
     "            + (con.actor_label ? ' by '+esc(con.actor_label) : '')+'</span>'",
     "+'</span>'",
     'the quiet list says a venue was rung but not by whom'),

    # D50 to D52: the venue logo, 16 Oct 2026 (migration 102). Each row is one way the logo or the
    # Trusted by strip could reach a TV or the homepage that it should not.
    ('owner or advertising manager only', 'venueplay-backend/worker/venueplay-api-FULL.js',
     "  if (!vpbCan(o, 'advertising')) return { res: json({ error: 'You do not have permission to change the logo.' }, 403) };\n",
     '',
     'a manager whose owner switched advertising off can still put any logo on every TV'),
    ('owner or advertising manager only', 'venueplay-backend/worker/venueplay-api-FULL.js',
     'const VPB_MAX_LOGO_BYTES = 1024 * 1024;', 'const VPB_MAX_LOGO_BYTES = 8 * 1024 * 1024;',
     'a multi-megabyte logo is stored and pulled by every TV and every homepage visit'),
    ('owner or advertising manager only', 'venueplay-backend/worker/venueplay-api-FULL.js',
     '  const kind = vpbLogoSniff(bytes);\n',
     "  const kind = vpbLogoSniff(bytes) || { type: 'image/png', ext: 'png', w: 600, h: 200, alpha: true };\n",
     'the label decides again: a JPEG, a GIF or an SVG with script in it goes up as a logo'),
    ('owner or advertising manager only', 'venueplay-backend/worker/venueplay-api-FULL.js',
     '  if (kind.w < VPB_LOGO_MIN_PX || kind.h < VPB_LOGO_MIN_PX) {', '  if (false) {',
     'an 8 pixel logo is accepted and is an unreadable smudge on the TV'),
    ('owner or advertising manager only', 'venueplay-backend/worker/venueplay-api-FULL.js',
     '    else if (vpbOurLogoUrl(env, b.logo_url, venueId)) row.logo_url = b.logo_url;',
     '    else if (true) row.logo_url = b.logo_url;',
     'screen-save stores any pasted address again, which every TV and the homepage then load'),
    ('owner or advertising manager only', 'venueplay-backend/worker/venueplay-api-FULL.js',
     "{ show_logo_on_site: g.b.show }", "{ show_logo_on_site: true }",
     'unticking "Show our logo on the VenuePlay website" says saved and changes nothing'),
    ('owner or advertising manager only', 'venueplay-backend/worker/venueplay-api-FULL.js',
     '  if (!(await vpbWriteLogo(env, g.venue, null))) return', '  if (false) return',
     'Remove says removed and the logo stays on the TV'),
    ('test venues, 1-player plans, comp, unpaid', 'venueplay-backend/worker/venueplay-api-FULL.js',
     '  if (Number(v.max_players) <= 1) return false;\n', '',
     "Dean's twelve 1-player overage-test and friends venues appear on the homepage as customers"),
    ('test venues, 1-player plans, comp, unpaid', 'venueplay-backend/worker/venueplay-api-FULL.js',
     "  if (VPB_TEST_SLUG_RE.test(String(v.slug || '')) || /^\\s*test\\b/i.test(String(v.name || ''))) return false;\n", '',
     'Test Alpha, Bravo and Charlie appear on the homepage as customers'),
    ('test venues, 1-player plans, comp, unpaid', 'venueplay-backend/worker/venueplay-api-FULL.js',
     "  if (a.status === 'comp' || a.status === 'pending') return false;\n", '',
     'a comp demo account that once had a card shows as a paying customer'),
    ('test venues, 1-player plans, comp, unpaid', 'venueplay-backend/worker/venueplay-api-FULL.js',
     '  return !!a.stripe_subscription_id || a.bill_by_invoice === true;', '  return true;',
     'a venue that never paid a cent is on the strip'),
    ('test venues, 1-player plans, comp, unpaid', 'venueplay-backend/worker/venueplay-api-FULL.js',
     "'status=eq.active&hide_from_trusted=eq.false&show_logo_on_site=eq.true'", "'status=eq.active&hide_from_trusted=eq.false'",
     'a venue that unticked "Show our logo" is on the homepage anyway'),
    ('test venues, 1-player plans, comp, unpaid', 'venueplay-backend/worker/venueplay-api-FULL.js',
     '  return venueId ? m[2] === venueId : true;', '  return true;',
     "a venue's strip entry or saved logo can point at another venue's logo"),
    ('test venues, 1-player plans, comp, unpaid', 'venueplay/app/vp-trusted.js',
     '  var MIN = 6;', '  var MIN = 1;',
     'the strip goes up with one lonely logo on it'),
    ('test venues, 1-player plans, comp, unpaid', 'venueplay/nsw.html',
     '<script src="/app/vp-trusted.js"></script>\n', '',
     'the NSW landing page calls VPTrusted and never loads it, so it has no strip'),
    ('test venues, 1-player plans, comp, unpaid', 'venueplay/index.html',
     '  if (workerReady && window.VPTrusted) VPTrusted.load(VP_WORKER);\n', '',
     'the homepage never asks for the strip'),
    ('tv.html and the four game screens paint one 120x56 mark', 'venueplay/tv.html',
     'el.style.cssText="position:fixed;top:14px;left:14px;max-width:120px;', 'el.style.cssText="position:fixed;top:20px;left:22px;max-width:220px;',
     'the TV mark goes back to its old size and is no longer the same box as the game screens'),
    ('tv.html and the four game screens paint one 120x56 mark', 'venueplay/tv.html',
     '      if(venueLogoUrl){\n        if(!el){', '      if(true){\n        if(!el){',
     'a venue with no logo gets an empty broken image in the corner of its TV'),
    ('tv.html and the four game screens paint one 120x56 mark', 'venueplay/app/raffle/screen.html',
     'el.id="venueLogo"; el.setAttribute("data-fit-avoid","");', 'el.id="venueLogo";',
     'the raffle wall paints under the venue logo'),
    ('tv.html and the four game screens paint one 120x56 mark', 'venueplay/app/members/screen.html',
     'max-width:120px;max-height:56px;width:auto', 'max-width:220px;max-height:64px;width:auto',
     'the members draw screen paints a bigger logo than every other screen'),
    # The compliance build, 15 Oct 2026 (Anisimoff Legal 9380). Three ways D46 can go blind:
    # the onboarding stops needing the tick, a host can write a permit, a bad shape is stored.
    # 16 Oct live-audit fixes under D46: the refusal when the tick is off says what the tick confirms,
    # and the permits card says musical counts for permits AND keeps its phone cards.
    ('an onboarding without the tick creates nothing', 'venueplay/index.html',
     "showErr('Please tick the box to agree to the Terms and Privacy Policy and confirm your venue is responsible for its gaming compliance.')",
     "showErr('Please agree to the Terms and Privacy Policy to continue.')",
     'the QLD checkout refusal says nothing about what the tick confirms'),
    ('an onboarding without the tick creates nothing', 'venueplay/nsw.html',
     "showErr('Please tick the box to agree to the Terms and Privacy Policy and confirm your venue is responsible for its gaming compliance.')",
     "showErr('Please agree to the Terms and Privacy Policy to continue.')",
     'the NSW checkout refusal says nothing about what the tick confirms'),
    ('an onboarding without the tick creates nothing', 'venueplay/app/settings.html',
     '["bingo","Bingo (musical bingo counts as bingo for permits; phone cards stay on for musical bingo)"]',
     '["bingo","Bingo (including musical bingo)"]',
     'the permits card and the rules popup disagree about musical bingo on the same screen'),
    ('an onboarding without the tick creates nothing', 'venueplay-backend/worker/venueplay-api-FULL.js',
     "  if (comp.accepted !== true) {\n    return json(",
     "  if (comp.accepted === 'never') {\n    return json(",
     'a venue is onboarded with no record that it accepted the gaming laws as its own'),
    ('an onboarding without the tick creates nothing', 'venueplay-backend/worker/venueplay-api-FULL.js',
     "  if (!vpbCan(o, 'draws_raffles')) return json({ error: 'You do not have permission to record permits.",
     "  if (false) return json({ error: 'You do not have permission to record permits.",
     'a manager whose owner took the draws right away records a permit anyway'),
    ('an onboarding without the tick creates nothing', 'venueplay-backend/worker/venueplay-api-FULL.js',
     "    if (holder !== 'venue' && holder !== 'npo') return { ok: false,",
     "    if (false) return { ok: false,",
     'a permit with a holder nobody defined is stored, and the recorded rule reads it as nothing'),
    ('an onboarding without the tick creates nothing', 'venueplay-backend/worker/venueplay-api-FULL.js',
     "    + '&order=declared_at.desc&limit=3') || [];",
     "    + '&limit=3') || [];",
     'HQ is shown three arbitrary declarations and calls them the last three'),
    # And D47: the clauses the lawyer asked for, and the tick sentence staying one sentence.
    ('section 6 carries every clause the lawyer asked for', 'venueplay/terms.html',
     '<strong>VenuePlay is not responsible for or in any way involved with the conduct or organisation of the gaming activity.</strong>',
     '<strong>VenuePlay supplies the software.</strong>',
     'the one sentence the lawyer asked to be added (1 Oct 2026, point 9) is gone from the Terms'),
    ('section 6 carries every clause the lawyer asked for', 'venueplay/terms.html',
     '<li><strong>6.14 Indemnity.</strong> You indemnify VenuePlay and Gflam Group Pty Ltd, and hold us harmless, against any loss, cost, fine, penalty, claim or regulatory action',
     '<li><strong>6.14 Liability.</strong> We accept liability for any loss, cost, fine, penalty, claim or regulatory action',
     'the indemnity for regulatory action is deleted and the gate stays green'),
    ('section 6 carries every clause the lawyer asked for', 'venueplay/app/onboard.html',
     'including any permit, licence or authority, age limits and attendance rules. VenuePlay supplies the software only.</span>',
     'including any permit, licence or authority. VenuePlay supplies the software only.</span>',
     'the sentence a venue ticks on one page drifts from the one the Worker records'),
    ('section 6 carries every clause the lawyer asked for', 'partyplay/terms.html',
     'it is not for use at a pub, club or other licensed venue, and it must not',
     'and it must not',
     'PartyPlay stops saying it is not for licensed premises (NSW social housie, 1 Oct 2026, point 11)'),

    ('paper cards and sheets bill once, stop at ten', 'venueplay-backend/worker/venueplay-game.js',
     "            if (t.phase === 'revealed' && !(g.config || {}).defer_reveal) pub.correct_index = q.correct_index;",
     "            if (t.phase === 'revealed') pub.correct_index = q.correct_index;",
     'a TV reloaded on a paper night shows the answer before the paper teams hand in their sheets'),

    ('the paper flag is set for bingo in SA, VIC and TAS and for nothing else', 'venueplay-backend/worker/venueplay-game.js',
     "    const paperFormat = liveNow && (!format || format.indexOf('bingo') === 0);",
     "    const paperFormat = true;",
     'a trivia player in Adelaide has their phone blanked and told to play on paper'),

    ('removal blanks exactly that person', 'venueplay-backend/worker/venueplay-api-FULL.js',
     "&select=id,venue_id,email,mobile,marketing_optin,marketing_optin_at&order=id.asc')).filter(pq.same);",
     "&select=id,venue_id,email,mobile,marketing_optin,marketing_optin_at&order=id.asc'));",
     'the loose database match is trusted, so somebody one character away can be deleted'),

    ('removal blanks exactly that person', 'venueplay-backend/worker/venueplay-api-FULL.js',
     "    if (v.downloaded_at && v.founding_id) {",
     "    if (false) {",
     'a venue with the person in a file it downloaded is never told to delete them from it'),

    ('removal blanks exactly that person', 'venueplay-backend/worker/venueplay-api-FULL.js',
     "      who: pq.masked, records:",
     "      who: pq.value, records:",
     'the audit trail keeps in full the address we were asked to delete'),

    ('removal blanks exactly that person', 'venueplay-backend/worker/venueplay-api-FULL.js',
     "        '&created_at=gt.' + encodeURIComponent(v.opted_in_at) +",
     "        '&created_at=gt.' + encodeURIComponent('1970-01-01') +",
     'a download from BEFORE they joined counts, and venues are told to delete somebody who is not in their file'),

    ('removal blanks exactly that person', 'venueplay-backend/worker/venueplay-api-FULL.js',
     "  const mine = players.filter(pq.same);",
     "  const mine = players;",
     'a PLAYER row one digit away from the person asking is wiped with them'),

    # Same as a suite losing one check: the ledger is one ahead of what the suite runs.
    ('every suite still runs at least the checks the ledger recorded', 'tools/suite-counts.json',
     ' "venueplay-backend/worker/money.test.js": {\n  "checks": 44,',
     ' "venueplay-backend/worker/money.test.js": {\n  "checks": 45,',
     'a check is deleted from the only suite on the rates and nothing notices'),

    # THE MARKETING LOGIN, 22 Sep 2026.
    ('a marketing login is refused by every owner route', 'venueplay-backend/worker/venueplay-api-FULL.js',
     "           perms: Object.assign({}, VPM_NO_RIGHTS, { players_optin: optin }),",
     "           perms: null,",
     'a marketing access object with no permissions reads as the OWNER, and the opt-in list opens'),

    ('a marketing login is refused by every owner route', 'venueplay-backend/worker/venueplay-api-FULL.js',
     "  const optin = scoped.length > 0 && scoped.every((r) =>",
     "  const optin = scoped.length > 0 && scoped.some((r) =>",
     'ticked at one venue unlocks the player details of every venue'),

    ('a marketing login is refused by every owner route', 'venueplay-backend/worker/venueplay-api-FULL.js',
     "  const perms = { players_optin: b.optin === true };       // the owner's tick. Off unless ticked.",
     "  const perms = { players_optin: b.optin !== false };",
     'a marketing login is given player details by default, without the owner ticking anything'),

    ('a marketing login is refused by every owner route', 'venueplay-backend/worker/venueplay-api-FULL.js',
     "')&role=eq.marketing');\n  await vpaInsert(env, 'vp_admin_audit', { ...vpbActorFields(o), action: 'marketing_login_removed'",
     "')&role=neq.owner');\n  await vpaInsert(env, 'vp_admin_audit', { ...vpbActorFields(o), action: 'marketing_login_removed'",
     'the remove-a-marketing-login route deletes hosts and managers too'),

    ('a marketing login is refused by every owner route', 'venueplay-backend/worker/venueplay-api-FULL.js',
     "&role=in.(owner,manager,host)&select=auth_user_id,role');\n    for (const s of (staff || [])) {",
     "&select=auth_user_id,role');\n    for (const s of (staff || [])) {",
     'billing and cancellation emails start going to the outside marketing person'),

    ('the staff check names its roles, in the Worker and in the database alike', 'venueplay-backend/worker/venueplay-game.js',
     "'&venue_id=eq.' + enc(venueId) + '&role=in.(owner,manager,host)&select=id,role,venue_id,permissions');",
     "'&venue_id=eq.' + enc(venueId) + '&select=id,role,venue_id,permissions');",
     'any staff row is staff again, and a marketing login can run games'),

    ('the staff check names its roles, in the Worker and in the database alike', 'venueplay-backend/supabase/venueplay-86-marketing-role.sql',
     "     and s.role in ('owner', 'manager', 'host')\n   limit 1;",
     "   limit 1;",
     'the database twin of the staff check accepts a marketing login'),

    # The design review of 16 Oct 2026: seven type tokens on the sales pages, and one block
    # of console classes on the five host consoles.
    ('the sales pages size their type from the seven-step scale', 'venueplay/index.html',
     ".hero-note{font-family:'Manrope',sans-serif;font-size:var(--fs-sm);",
     ".hero-note{font-family:'Manrope',sans-serif;font-size:14.5px;",
     'a half-pixel size typed by hand is back on the homepage and the scale starts to come apart'),

    ('the sales pages size their type from the seven-step scale', 'partyplay/index.html',
     "--fs-xs:12px;", "--fs-xs:11px;",
     'the label floor drops under 12px on partyplay.com.au and the small print is small again'),

    ('the host consoles share one set of console classes', 'venueplay/app/raffle/host.html',
     ".vp-copy{font-size:14.5px;", ".vp-copy{font-size:15px;",
     'one console is edited and the other four are not, which is how every size here drifted in the first place'),

    ('the host consoles share one set of console classes', 'venueplay/app/trivia/host.html',
     '<div id="ovgModal" class="hidden vp-modal">',
     '<div id="ovgModal" class="hidden" style="position:fixed;inset:0;z-index:60;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.6);padding:20px">',
     'the modal style is pasted back inline on one console, so a change to the class no longer reaches it'),

    # 17 Oct 2026: the PartyPlay telly's lobby under the names strip, and the host reload that
    # left the telly on the join code. Both suites RUN the page code (tv.html's fit, run.html twice).
    ('pp-tv-layout.test.js', 'partyplay/tv.html',
     '    var s = Math.min(1, availW / w, availH / h);', '    var s = Math.min(1, availW / w);',
     'a PartyPlay lobby taller than the room the names strip leaves is not shrunk, and runs under the names'),
    ('pp-tv-layout.test.js', 'partyplay/tv.html',
     '    el.style.transformOrigin = "center top";\n', '',
     'the lobby is shrunk about its middle while it sits from the top, so it still ends under the names strip'),
    ('pp-tv-layout.test.js', 'partyplay/tv.html',
     '    var dy = Math.round((availH - h * s) / 2 - off);', '    var dy = 0;',
     'a shrunk lobby is left wherever the browser put it, half off the top of the telly'),
    ('pp-tv-layout.test.js', 'partyplay/tv.html',
     '  .who{flex:0 0 auto;padding', '  .who{position:fixed;left:0;right:0;bottom:0;padding',
     'the names strip sits over the bottom of the QR card and the "Wrong party?" link again'),
    ('pp-tv-layout.test.js', 'partyplay/tv.html',
     '.qr canvas{display:block;width:34vh !important;height:34vh !important}', '.qr canvas{display:block;width:34vh;height:34vh}',
     'the QR card is 420px on every telly, half the height of a 720 screen, because the library wins'),
    ('pp-tv-layout.test.js', 'partyplay/tv.html',
     '    fitScreen();    // a new row of names', '    // a new row of names',
     'a new row of guest names takes height off the lobby and nothing shrinks it to make room'),
    ('pp-host-reload.test.js', 'partyplay/run.html',
     '        if(!resumeOpenGame()) render();', '        render();',
     'reloading the PartyPlay host console mid-game puts the join code on the telly and sends every phone back to the lobby'),
    ('pp-host-reload.test.js', 'partyplay/run.html',
     '    if(G.wall) try{ var w=G.wall(); if(w) send(w); }catch(e){}\n', '',
     'Who am I, charades or who here picked back up after a reload leaves the telly on the join code until the next round'),
    ('pp-host-reload.test.js', 'partyplay/run.html',
     '  var OPEN_RESUME = { bingo90:1,', '  var OPEN_RESUME = { headstails:1, bingo90:1,',
     'a reload restarts heads or tails by itself and knocks the whole room back to round one'),
    ('pp-host-reload.test.js', 'partyplay/run.html',
     '    if(!(now - (saved.at || 0) < 12*3600*1000)) return null;\n', '',
     'a console opened the next day drops straight into last night\'s game'),
    ('pp-host-reload.test.js', 'partyplay/run.html',
     '  function render(){\n    openClear();', '  function render(){',
     'a host who went back to the games list is thrown back into the old game by the next reload'),
    ('pp-host-reload.test.js', 'partyplay/tv.html',
     '    helloT = setTimeout(helloSend, helloWait);\n', '',
     'a PartyPlay telly whose one hello was lost (it reloaded while the host was reconnecting) sits on the join screen mid-game'),
    ('pp-host-reload.test.js', 'partyplay/tv.html',
     '    else if(m.t === "rollcall"){ helloStart(); return; }\n', '',
     'the host reloads under a telly that is up, what it sends on reconnecting is lost, and the telly keeps the old game'),
    ('pp-host-reload.test.js', 'partyplay/tv.html',
     '    if(PICTURE_T[m.t]) helloStop();', '',
     'a telly that has its picture keeps saying hello every fifteen seconds all night'),
    ('pp-host-reload.test.js', 'partyplay/tv.html',
     'helloWait = Math.min(helloWait * 2, HELLO_MAX_MS);', 'helloWait = helloWait * 2;',
     'a telly with no host listening backs off without a ceiling and is minutes from asking again when the host arrives'),
    ('pp-host-reload.test.js', 'partyplay/tv.html',
     '    helloT = setTimeout(helloSend, helloWait);\n    helloWait = Math.min(helloWait * 2, HELLO_MAX_MS);\n    try{ helloCh.send({ type:"broadcast", event:"msg", payload:{ t:"tv-here" } }); }catch(e){}',
     '    try{ helloCh.send({ type:"broadcast", event:"msg", payload:{ t:"tv-here" } }); }catch(e){}\n    helloT = setTimeout(helloSend, helloWait);\n    helloWait = Math.min(helloWait * 2, HELLO_MAX_MS);',
     'an answer that comes straight back is missed by the retry armed after it, so the telly keeps asking'),
    ('pp-host-reload.test.js', 'partyplay/run.html',
     'w.tvOnly=true; send(w);', 'send(w);',
     'every hello the host answers replays the round on every guest\'s phone'),
]


# ---------------------------------------------------------------------------
# THE LIVE CHECKS HAD NEVER BEEN BROKEN EITHER, and nobody had noticed because
# prove-checks only ever ran the gate with --local. The two sets are disjoint:
# 199 local checks and 108 live ones, no label in both. So the headline "every
# check is proven" was true of a bit under two thirds of the gate.
#
# MOST OF THE LIVE ONES CANNOT BE PROVEN AND SHOULD NOT BE. "/play serves" is a
# question about production, and the only way to make it fail is to break
# production. Those stay unproven on purpose.
#
# What IS provable is the subset whose subject is a file in this repo compared
# against live state: a Worker's build stamp against its own /health, a founding
# code against env.FOUNDING_CODES, a page hash against the browser stamp. Break
# the repo copy and the two must disagree. Production is never touched: the
# mutation happens in the scratch copy and only the reading end moves.
#
# Run with:  python3 tools/prove-checks.py --live
# It is slow, because each one is a full live sweep. Do not run it in parallel
# with itself.
# CHECKS THAT CANNOT BE PROVEN IN A SCRATCH COPY, AND THE REASON. Named out loud so
# they read as "cannot be done, here is why" rather than "nobody got round to it",
# which is what an unexplained gap in the list looks like.
UNPROVABLE = {
    'every prove-checks mutation still finds the line it breaks':
        'it runs this very file with --list, and scratch() copies the repo WITHOUT .git and breaks '
        'one line in the copy, so here it is a note (SKIPPED), never a pass: run inside a copy it '
        'would go red on every mutation and make blind checks look proven. In a real checkout it was '
        'seen to go red on 30 Sep 2026: a find-string edited to text that is nowhere in the file was '
        'reported as NEVER and the gate failed, then went green when it was put back.',
    'a real browser has checked the venue screens on this build':
        'it works off git history (rev-parse HEAD, then diff since the commit in '
        '.verify-live.json) and scratch() copies the repo WITHOUT .git, so the check '
        'returns early and never runs here at all. It was seen to fail for real on '
        '17 Sep 2026, red after the abandoned-lobby change to tv.html, green again '
        'after verify-live.py --stamp. That is the proof it can fail. Two more failure modes '
        'were proven by hand on 22 Sep 2026: a stamp for HEAD naming only partyplay went red, '
        'and a stamp naming a commit this clone does not have went red instead of silent.',
    'every file checked is one git tracks':
        'it asks git which files are untracked, and scratch() copies the repo WITHOUT .git, '
        'so here it is a note (SKIPPED), never a pass. In a real checkout it was seen to '
        'work on 22 Sep 2026: a scratch _phone-preview.html left in venueplay/ was named '
        'as untracked and excluded from the scan.',
    'this release is live':
        'it compares the files the LAST COMMIT changed (git diff HEAD~1) against what is '
        'served, and scratch() has no .git, so here it always finds nothing to compare. The '
        'comparison itself was checked by hand on 22 Sep 2026: nine live pages compared equal '
        'to the repo through livenorm, and a page with a local edit compared unequal. Not yet '
        'seen red on a real push; when it is, record the date here.',
}

MUTATIONS_LIVE = [
    # A policy vanishes from the BASELINE (the reading end), so live no longer matches it.
    ('row security, policies, grants and definer functions match RLS-BASELINE.json',
     'venueplay-backend/supabase/RLS-BASELINE.json',
     '<<ANY:"vp_members.>>',
     '"vp_members_gone.',
     'a policy on the members list can be dropped in the dashboard and no file in the repo, '
     'and no check, would know'),

    # MOVED FROM THE LOCAL TABLE 22 Sep 2026: these two checks read production and now run
    # only in the full gate (audit, 20 Sep 2026).
    ('a venue over the cap is told, not quietly trimmed',
     'venueplay-backend/worker/venueplay-api-FULL.js',
     'if (Array.isArray(b.slides) && b.slides.length > VPB_MAX_SLIDES) {',
     'if (Array.isArray(b.slides) && b.slides.length > 9999) {',
     'over the cap is sliced off in silence again, so a venue loses images and is told the '
     'save worked'),

    # ---- 17 Sep 2026, twelfth pass: the two retention nags. Both run a real tool against the
    # ---- live database, so the thing worth proving is that the gate reads what the tool says
    # ---- rather than merely managing to start it. Shortening the promised window is also the
    # ---- realistic fault: the privacy page gets edited and the sweep does not follow.
    ("a closed venue's player data is deleted within 90 days",
     'venueplay-backend/tools/purge-closed-player-data.py',
     # 30 was not enough: the closest closed venue is five days old, so a thirty day
     # window still left it waiting and the gate stayed green. The mutation has to be
     # shorter than the youngest closed venue or it proves nothing.
     "ap.add_argument('--days', type=int, default=90)",
     "ap.add_argument('--days', type=int, default=1)",
     'a venue closed inside the promised window is already overdue, and the gate has to say '
     'so rather than quietly reporting that the tool ran'),
    ('and the billing page offers exactly that many', 'venueplay/app/billing.html',
     'var VP_MAX_SLIDES = 20;', 'var VP_MAX_SLIDES = 25;',
     'the page lets a venue add five slides the Worker throws away, and the page says Saved, '
     'and they are gone on the next reload with nothing to say which'),


    ('no closed venue is still holding its players',
     'venueplay-backend/tools/check-player-retention.py',
     'PROMISE_DAYS = 90', 'PROMISE_DAYS = 3',
     'the page promises a shorter window than anything deletes, so we are holding player '
     'data past what we told the venue, and the gate must go red on the tool exit code'),
    ('a forged join, claim or leave for another player is dropped', 'venueplay/app/vp-phonekey.js',
     "        return Promise.resolve({ ok: false, legacy: false, why: \"unsigned message for a keyed pid\" });",
     "        return Promise.resolve({ ok: true, legacy: true, why: \"\" });",
     'an unsigned message about a keyed pid is waved through as legacy: the original hole'),

    ("a closed venue's player data is deleted within 90 days", 'venueplay-backend/tools/purge-closed-player-data.py',
     "    ap = argparse.ArgumentParser()\n",
     "    print('STOP: cannot reach the database'); sys.exit(1)\n    ap = argparse.ArgumentParser()\n",
     'the purge tool dies before it looks at anything, and the gate calls that a pass'),

    # The public-key probe used to cover seven tables picked by hand; the audit of 20 Sep 2026
    # found the members list, the staff table and the signing keys unprobed. It now reads every
    # relation the code names. Narrow the name scan back to one table and the coverage line
    # has to go red, or the probe can quietly shrink again.
    ('the probe covered every relation the code names',
     'tools/release-check.py',
     "    name_re = re.compile(r'\\b(vp_[a-z0-9_]+|pp_[a-z0-9_]+|v_vp_[a-z0-9_]+|venueplay_[a-z0-9_]+)\\b')",
     "    name_re = re.compile(r'\\b(vp_venues)\\b')",
     'the probe is back to a handful of tables and a new table with an open grant is never asked'),

    # Shrink the keep window and parties that finished days ago are suddenly overdue, with
    # their guests' nicknames and email addresses still sitting there. The tool reads the
    # number out of the Worker on purpose, so this proves that too.
    ('a finished party is not still holding its guests',
     'partyplay-backend/worker/SOURCE-do-not-paste-partyplay-api.js',
     'const ALBUM_KEEP_DAYS = 30;', 'const ALBUM_KEEP_DAYS = 1;',
     'a finished party is still holding its guests past what privacy.html promises, which '
     'is what a sweep that has quietly stopped working looks like'),

    # A Worker that exports scheduled with no Cron Trigger behind it. venueplay-sms has no
    # trigger, correctly, because it has no scheduled job; give it one and the checker has
    # to notice. This is the fault that left the PartyPlay album sweep unrun for its whole
    # life while every test passed.
    ('every scheduled job has a cron that calls it',
     'venueplay-backend/worker/venueplay-sms-hook.js',
     'const FIVE_MINUTES_SECONDS = 60 * 5;',
     'const FIVE_MINUTES_SECONDS = 60 * 5;\nexport default { async scheduled(e, env, ctx) { } };',
     'a Worker ships a scheduled job and nobody wires a cron to it, so it never runs once '
     'and nothing anywhere says so'),

    # check-columns.py asks the LIVE database whether every column the code names is really
    # there. Name one that is not and it has to say so: this is the check that catches code
    # written against a migration nobody has run yet.
    ('every column the code names exists in the live database',
     'venueplay-backend/worker/venueplay-api-FULL.js',
     "&select=slides,draws,raffle,logo_url')",
     "&select=slides,draws,raffle,logo_url,banner_url')",
     'the Worker reads a column that does not exist on the live database, which is what '
     'happens when code lands ahead of its migration, and PostgREST answers [] rather than '
     'an error so the venue just sees an empty screen'),

    # File-based, but it lives in the live branch, so prove-checks never reached it either.
    ('every page sending X-VP-Venue shows whose venue it is',
     'venueplay/app/billing.html',
     "bar.innerHTML = '<span>Billing for <b>' + esc(imp.name || \"this venue\") +",
     "bar.innerHTML = '<span>Billing for <b>' + esc(imp.venue || \"this venue\") +",
     'the View-as banner stops naming the venue, so an HQ admin can change a price or close '
     'an account with nothing on screen saying whose it is'),

    # A Worker's /health answers with the stamp that is actually deployed. Move the repo's
    # copy and the two must disagree. This is the check that says "I pasted it" is not
    # evidence, and until 17 Sep 2026 nobody had ever seen it say no.
    ('VenuePlay game is running the current code',
     'venueplay-backend/worker/venueplay-game.js',
     # ANCHORED ON THE COMMENT, NOT THE STAMP. The stamp changes every time the Worker is
     # deployed, so a mutation naming it stops applying the same afternoon it is written.
     # This corrupts the stamp without needing to know what it says.
     "';   // tools/stamp-workers.py, do not edit by hand",
     "-not-the-deployed-one';   // tools/stamp-workers.py, do not edit by hand",
     'the deployed game Worker is not the code in this repo, and the only thing that was '
     'ever going to say so is this line'),

    ('VenuePlay billing is running the current code',
     'venueplay-backend/worker/venueplay-api-FULL.js',
     # ANCHORED ON THE COMMENT, NOT THE STAMP. The stamp changes every time the Worker is
     # deployed, so a mutation naming it stops applying the same afternoon it is written.
     # This corrupts the stamp without needing to know what it says.
     "';   // tools/stamp-workers.py, do not edit by hand",
     "-not-the-deployed-one';   // tools/stamp-workers.py, do not edit by hand",
     'the deployed billing Worker is not the code in this repo, so a billing fix that was '
     'written and never landed reads exactly like one that did'),

    # The page carries the code, the Worker carries the list. A code on a page that the
    # Worker will not honour is a venue reading $2.50 and being charged $3.
    ('all 1 founding page(s) have a live code',
     'venueplay/nsw.html',
     "oct: { code: 'OFFER-OCT-2026',", "oct: { code: 'OFFER-OCT-2027',",
     'a founding page offers a code env.FOUNDING_CODES has never heard of, so the venue is '
     'quoted one price and charged another with no error and no explanation'),
]


def gate(only_label, root, live=False):
    # --local by default: no network. The checks proven that way are all about the
    # files, and a dozen full runs with live fetches would take longer than anyone
    # will wait. --live is for the handful whose subject is a repo file measured
    # against production; see MUTATIONS_LIVE.
    r = subprocess.run([sys.executable, os.path.join(root, 'tools', 'release-check.py'),
                        '--live' if live else '--local'],
                       capture_output=True, text=True, cwd=root)
    out = re.sub(r'\033\[[0-9;]*m', '', r.stdout + r.stderr)
    for line in out.splitlines():
        s = line.strip()
        if s.startswith('FAIL ') and only_label in s:
            return True
    # A GATE THAT CRASHED DID NOT STAY GREEN. A mutation that breaks the gate's own syntax
    # (found 22 Sep 2026) used to print "stayed green while ...", which is the one thing
    # it did not do. Say what happened, so the mutation gets fixed rather than the check.
    if 'checks in total' not in out and 'checks passed' not in out:
        gate.crashed = (out.strip().splitlines() or ['no output'])[-1][:120]
    return False


gate.crashed = ''


def scratch():
    """A copy of the repo to break. Skips .git and the workbook backups, which are
    the bulk of it and nothing here reads them."""
    d = tempfile.mkdtemp(prefix='prove-checks-')
    dst = os.path.join(d, 'repo')
    shutil.copytree(ROOT, dst, ignore=shutil.ignore_patterns(
        '.git', 'node_modules', '*.backup-*', '__pycache__', '*.pyc',
        '.claude'))   # 796 MB of session files that nothing here reads (audit, 20 Sep 2026)
    return d, dst


def main():
    LIVE = '--live' in sys.argv
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    want = args[0] if args else ''
    TABLE = MUTATIONS_LIVE if LIVE else MUTATIONS
    proven = broken = skipped = 0
    tmp, repo = scratch()
    print('\n%sPROVING THE %s CHECKS CAN FAIL%s' % (YEL, 'LIVE' if LIVE else 'LOCAL', OFF))
    print('%s  each one is broken on purpose, in a copy at %s%s' % (DIM, repo, OFF))
    if LIVE:
        print('%s  the break is in the copy, never in production: only the reading end moves%s'
              % (DIM, OFF))
    print('')

    for label, rel, find, repl, why in TABLE:
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
            caught = gate(label, repo, LIVE)
            os.remove(dest)
            (proven, broken) = (proven + 1, broken) if caught else (proven, broken + 1)
            print(('  %sok%s   %s %s%s%s' % (GRN, OFF, label.ljust(52), DIM, why, OFF)) if caught
                  else ('  %sBLIND%s %s %s' % (RED, OFF, label.ljust(52),
                        ('the GATE CRASHED under this mutation, fix the mutation: ' + gate.crashed) if gate.crashed else ('stayed green while ' + why))))
            gate.crashed = ''
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
        caught = gate(label, repo, LIVE)
        io.open(path, 'w', encoding='utf-8').write(before)
        if caught:
            proven += 1
            print('  %sok%s   %s %s%s%s' % (GRN, OFF, label.ljust(52), DIM, why, OFF))
        else:
            broken += 1
            print('  %sBLIND%s %s %s' % (RED, OFF, label.ljust(52),
                  ('the GATE CRASHED under this mutation, fix the mutation: ' + gate.crashed) if gate.crashed else ('stayed green while ' + why)))
        gate.crashed = ''

    # WHAT THE GATE RUNS THAT NOBODY HAS BROKEN YET. Asked of the gate rather
    # than counted from the list above, because a list of the checks is a second
    # copy of the checks and goes stale the moment somebody adds one.
    r = subprocess.run([sys.executable, os.path.join(repo, 'tools', 'release-check.py'),
                        '--live' if LIVE else '--local'],
                       capture_output=True, text=True, cwd=repo)
    clean = re.sub(r'\033\[[0-9;]*m', '', r.stdout + r.stderr)
    labels = []
    for line in clean.splitlines():
        m = re.match(r'\s+(?:ok|FAIL)\s+(.+?)(?:\s{2,}.*)?$', line)
        if m:
            labels.append(m.group(1).strip())
    covered = [m[0] for m in TABLE]
    naked = [l for l in labels if not any(c in l for c in covered)]

    shutil.rmtree(tmp, ignore_errors=True)
    print('\n  %d proven, %d BLIND, %d mutation(s) that no longer apply' % (proven, broken, skipped))
    print('  %d of the %d checks the gate runs have a mutation (%d%%)'
          % (len(labels) - len(naked), len(labels),
             100 * (len(labels) - len(naked)) // max(1, len(labels))))
    # PRINTED UNCONDITIONALLY, not filtered out of `naked`. The first version of this
    # derived the list from naked, which could never fire: the one check in it does not
    # run in a scratch copy at all, so its label is not in the gate's output, so it was
    # never in naked to be taken out of. A report that can only ever print nothing is the
    # same fault as a check that can only ever pass.
    naked = [l for l in naked if not any(k in l for k in UNPROVABLE)]
    if UNPROVABLE:
        print('\n  %sCANNOT BE PROVEN HERE, and why:%s' % (DIM, OFF))
        for k, why_not in sorted(UNPROVABLE.items()):
            print('     %s' % k[:70])
            print('       %s' % why_not)
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
    for label, rel, find, repl, why in MUTATIONS + MUTATIONS_LIVE:
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
    print('  All %d apply (%d local, %d live). The full run will actually test something.'
          % (len(MUTATIONS) + len(MUTATIONS_LIVE), len(MUTATIONS), len(MUTATIONS_LIVE)))
    return 0


if '--list' in sys.argv:
    sys.exit(check_mutations_still_apply())

sys.exit(main())
