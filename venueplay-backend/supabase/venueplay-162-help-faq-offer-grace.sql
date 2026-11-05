-- =====================================================================
-- MIGRATION 162: the help FAQ's "Billing and players" answer says what happens when a free month ends with no card
-- (THE 5-DAY OFFER GRACE, Dean, 5 Nov 2026; builds INBOX 24; branch fix/offer-grace-10nov).
--
-- *** NOT RUN. Written as a file only. Dean's main session runs it, once, when the grace goes live. ***
--
-- WORDS ONLY. The grace itself needs no column and no table: the billing Worker works the five days out from
-- vp_prospects.free_month_ends_at, which migration 127 already holds. This changes one answer in vp_help_faq (the
-- venue-side help FAQ every console shows), so the help FAQ says what the Terms and the pause screen say.
--
-- It is guarded: it changes the row only if its answer is still the one migration 106 wrote, so an answer HQ has
-- edited since is never overwritten. Running it twice changes nothing the second time. No Worker has to wait for
-- it, and it has no order against the Worker deploy.
-- =====================================================================

update public.vp_help_faq
   set answer = 'Your plan sets how many players can join a night. If a night runs bigger, each extra player is $2 for that night, and your host confirms it on screen before the game starts. Your Account page shows your plan, your next payment and your invoices. If your free month ends with no card on your account, your games pause (your TV keeps showing your ads and nothing is lost). If you were set up on an offer price, you have 5 days after your free month ends to add a card and keep it; after that the standard rate applies. Adding a card switches everything back on. For anything about a bill, email accounts@venueplay.com.au.',
       updated_at = now(),
       updated_by = 'migration 162'
 where id = 'd3a64ff4-0b24-5073-be9a-32f85519ec1b'
   and answer = 'Your plan sets how many players can join a night. If a night runs bigger, each extra player is $2 for that night, and your host confirms it on screen before the game starts. Your Account page shows your plan, your next payment and your invoices. For anything about a bill, email accounts@venueplay.com.au.';

-- Read it back (read only):
--   select answer, updated_by from public.vp_help_faq where id = 'd3a64ff4-0b24-5073-be9a-32f85519ec1b';
--   (mentions "5 days after your free month ends", updated_by migration 162; zero rows changed if HQ had edited the answer)

-- Rollback (puts the old words back, only if the answer is still this one's):
--   update public.vp_help_faq set answer = 'Your plan sets how many players can join a night. If a night runs bigger, each extra player is $2 for that night, and your host confirms it on screen before the game starts. Your Account page shows your plan, your next payment and your invoices. For anything about a bill, email accounts@venueplay.com.au.',
--          updated_at = now(), updated_by = 'migration 162 rollback'
--    where id = 'd3a64ff4-0b24-5073-be9a-32f85519ec1b' and answer like '%5 days after your free month ends%';
