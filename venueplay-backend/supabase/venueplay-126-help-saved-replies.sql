-- =====================================================================
-- Migration 126: saved replies for the help desk
-- ---------------------------------------------------------------------
--   NOT RUN. Safe to run any number of times (the seed skips a row whose
--   seed_key is already there, so HQ's own edits are never overwritten).
--   Either order with the billing Worker is safe: without this table HQ
--   shows the same starter replies from vp-helpdesk-hq.js and says that
--   adding or changing them needs this migration; the old Worker simply
--   has no /admin/help/replies/* routes and HQ falls back the same way.
--   After running: python3 venueplay-backend/tools/dump-rls-baseline.py and
--   commit RLS-BASELINE.json (one new table, RLS on, no grants to anon or
--   authenticated).
--   125 is left for feature/prospect-autopilot, built on the same base the
--   same night (checked every branch and worktree: 124 was the highest).
--
-- WHY. Dean, 29 Oct 2026: "helpdesk needs to be easier to use with
-- templates we can use to reply". A saved reply is picked in a ticket,
-- its fill-ins ({first_name}, {venue}, {ticket_no}, {tv_link},
-- {party_code}) are filled from that ticket, HQ edits it if it likes,
-- then sends. HQ > Help desk > Saved replies adds, changes, deletes and
-- reorders them.
--
-- audience is which tickets a reply is offered on: venue (a VenuePlay
-- venue or one that might be), player (a VenuePlay player), partyplay (a
-- PartyPlay buyer or guest), any. The support line 07 5228 3667 is only
-- ever in a venue reply: the Worker refuses to save it in any other, and
-- refuses to SEND it on a player's or a PartyPlay ticket however it got
-- into the box.
--
-- LOCKED. Only the service role (the billing Worker) reaches a row: RLS on,
-- no policies, and anon/authenticated named in the revoke (Supabase grants
-- them explicitly, so a revoke from public alone does nothing; migration 32).
-- =====================================================================

create table if not exists public.vp_help_saved_replies (
  id          uuid primary key default gen_random_uuid(),
  audience    text not null check (audience in ('venue', 'player', 'partyplay', 'any')),
  title       text not null check (char_length(title) between 1 and 80),
  body        text not null check (char_length(body) between 1 and 4000),
  position    int  not null default 0,
  seed_key    text unique,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  text
);
create index if not exists vp_help_saved_replies_order_idx on public.vp_help_saved_replies (position, created_at);

alter table public.vp_help_saved_replies enable row level security;
revoke all on public.vp_help_saved_replies from public, anon, authenticated;
grant select, insert, update, delete on public.vp_help_saved_replies to service_role;

-- The starter set. The SAME rows as SEED in venueplay/app/vp-helpdesk-hq.js
-- (tools/test-help-saved-replies.js fails if the two ever differ).
insert into public.vp_help_saved_replies (seed_key, audience, position, title, body) values
  (E'venue-tv', E'venue', 10, E'TV not showing the game',
   E'Hi {first_name},\n\nThanks for letting us know. Here\'s how to get the TV at {venue} going again:\n\n1. On the TV, open {tv_link}.\n2. Reload the page.\n3. Make it full screen, with nothing covering the window. If the browser is hidden behind another window or tab, it slows right down and shows RECONNECTING.\n\nThen start your game from the console as normal and it should appear on the TV within a few seconds. If it still won\'t show, reply here or call us on 07 5228 3667 (press 2 if a game is on) and we\'ll sort it out with you.\n\nCheers,'),
  (E'venue-join', E'venue', 20, E'Players can\'t join',
   E'Hi {first_name},\n\nPlayers join on their own phones, with no app to download:\n\n1. Scan the QR code on the TV with the phone camera, or\n2. Go to venueplay.com.au/play and type the venue code shown on the TV.\n\nIf someone gets stuck, check the code on their phone matches the TV and ask them to reload the page. Once your host starts the game, everyone who has joined sees it straight away.\n\nIf it\'s still not working, reply and tell us what their phone says, and we\'ll take a look.\n\nCheers,'),
  (E'venue-billing', E'venue', 30, E'How billing works',
   E'Hi {first_name},\n\nHappy to explain. Your plan is priced per player, based on the max players per session you\'ve set for {venue}. It isn\'t based on how many people are in the room: only people who join a game, on their phone or on paper, count as players.\n\nYour plan never stops anyone joining. If a night runs bigger, each extra player is $2 for that night, and your host has to OK it on screen first, so there are no surprises.\n\nYour Account page shows your plan, your next payment and your invoices. For anything else about a bill, just reply here.\n\nCheers,'),
  (E'venue-signin', E'venue', 40, E'Signing in',
   E'Hi {first_name},\n\nThere\'s no password to remember. To sign in:\n\n1. Go to venueplay.com.au/app\n2. Put in your mobile number (or your email, if that\'s how your login was set up).\n3. We send you a code. Type it in and you\'re in.\n\nIf the code doesn\'t arrive within a minute, check it\'s the number on your account and ask for a new code. If your number has changed, reply with the new one and we\'ll update it for you.\n\nCheers,'),
  (E'venue-refund', E'venue', 50, E'Refund or cancel request',
   E'Hi {first_name},\n\nThanks for letting us know. Refunds and cancellations are looked after by our accounts team, so I\'ve passed this on and they\'ll come back to you within one business day.\n\nIf you\'d like to cancel, the account owner can also do it any time from the Account page. A monthly plan runs to the end of the current month, and an annual plan to the end of the period already paid for.\n\nCheers,'),
  (E'venue-call', E'venue', 60, E'We\'ll call you',
   E'Hi {first_name},\n\nThanks for getting in touch. This one is easier to sort over the phone, so we\'ll give you a call shortly. If there\'s a better time or number to reach you, just reply and let us know.\n\nIf you need us sooner, call 07 5228 3667 and mention ticket {ticket_no}.\n\nCheers,'),
  (E'player-join', E'player', 70, E'Player: can\'t join or game not showing',
   E'Hi {first_name},\n\nSorry you had trouble. Here\'s the quickest way in:\n\n1. Scan the QR code on the venue\'s big screen with your phone camera, or\n2. Go to venueplay.com.au/play and type the code shown on the screen.\n\nThere\'s no app to download. If your game isn\'t showing once the host has started, check the code matches the screen and reload the page. Keep your screen on during the game, as some phones pause the page when they lock.\n\nOn the night, the host in the room is always the quickest help.\n\nCheers,'),
  (E'player-prize', E'player', 80, E'Player: a prize question',
   E'Hi {first_name},\n\nThanks for your message. Prizes are offered and given out by the venue running the game, and they\'re always claimed from the host on the night. VenuePlay supplies the game software only, so the best people to help with a prize are the host or the manager at {venue}.\n\nCheers,'),
  (E'player-details', E'player', 90, E'Player: remove my details',
   E'Hi {first_name},\n\nHappy to help. Could you reply with the name of the venue you played at, and the email or mobile you gave them? Once we have those, we\'ll take you off that venue\'s list.\n\nCheers,'),
  (E'pp-lost', E'partyplay', 100, E'PartyPlay: lost party code or email',
   E'Hi {first_name},\n\nNo worries, we\'ll get you back in. Could you reply with the email address you used when you bought your party? We\'ll find it and send your party code and link again.\n\nIt\'s worth a quick look in your junk or promotions folder too, as it sometimes lands there.\n\nCheers,'),
  (E'pp-join', E'partyplay', 110, E'PartyPlay: guests can\'t join',
   E'Hi {first_name},\n\nLet\'s get your guests in. Put the party screen on your TV or laptop, then guests scan the code on it, or go to partyplay.com.au/play and type {party_code}. They just pick a nickname, with no app and no sign up.\n\nIf a guest sees "no party with that code", check it letter by letter against the TV and make sure the party screen is open. Up to 50 guests can play.\n\nCheers,'),
  (E'pp-refund', E'partyplay', 120, E'PartyPlay: refund request',
   E'Hi {first_name},\n\nThanks for getting in touch. Here\'s how refunds work: within 7 days of buying, before you press start, it\'s a full refund. After 7 days, before you press start, your licence stays ready for you for a year. Once a party has started, we can\'t refund it.\n\nI\'ve passed your request to our accounts team and they\'ll come back to you within one business day.\n\nCheers,'),
  (E'any-sorted', E'any', 130, E'All sorted, I\'ll close this',
   E'Hi {first_name},\n\nGreat to hear it\'s all sorted. I\'ll close this one off now. If anything else comes up, just reply to this email and it\'ll come straight back to us.\n\nCheers,')
on conflict (seed_key) do nothing;

-- Rollback:
--   drop table if exists public.vp_help_saved_replies;
