-- =====================================================================
-- MIGRATION 162: the help FAQ's "Billing and players" answer says what happens when a free month ends with no card
-- (THE 5-DAY OFFER GRACE, Dean, 5 Nov 2026; builds INBOX 24, REWRITTEN 11 Nov 2026 for INBOX 246; branch
-- fix/migration-162-15nov).
--
-- *** NOT RUN. Written as a file only. Dean runs it, once, before the Thursday 12 Nov push. ***
--
-- WHY IT WAS REWRITTEN (11 Nov 2026). The first 162 guarded on migration 106's words, but migration 113 rewrote this
-- answer on 22 Oct 2026, so it would have changed nothing and said nothing. This one guards on 113's words, which are
-- the live words today (read back read-only 11 Nov 2026, updated_by 'migration 113'), and it RAISES if the live answer
-- is neither 113's words nor the finished words, so it can never again be a silent no-op.
--
-- WORDS ONLY. It APPENDS one sentence, Dean's words (approved 11 Nov 2026 ~17:48), to the end of the answer:
--   If your free month ends with no card on your account, your games pause. Your TV keeps showing your ads and
--   nothing is lost. Adding a card switches everything back on.
-- The 5-day grace is NOT announced (Dean, 5 Nov 2026, builds INBOX 55c): the billing Worker keeps it, quietly, from
-- vp_prospects.free_month_ends_at (migration 127). No column, table, policy or grant: RLS-BASELINE.json does not change.
--
-- Running it twice appends once: the update only matches 113's exact words, and the check after it accepts the
-- finished words. If HQ has edited the answer since, nothing is changed and the DO block raises: rewrite 162 against
-- the live text (tools/check-migrations-live.py says the same before the push).
-- =====================================================================

update public.vp_help_faq
   set answer = 'Your plan includes a number of players a night, and it never stops anyone joining. If a night runs bigger, the console shows the extra players when your host starts the game, and each extra player is $2 for that night once your host taps Start game to approve. Your Account page shows your plan, your next payment and your invoices. For anything about a bill, email accounts@venueplay.com.au. If your free month ends with no card on your account, your games pause. Your TV keeps showing your ads and nothing is lost. Adding a card switches everything back on.',
       updated_at = now(),
       updated_by = 'migration 162'
 where id = 'd3a64ff4-0b24-5073-be9a-32f85519ec1b'
   and answer = 'Your plan includes a number of players a night, and it never stops anyone joining. If a night runs bigger, the console shows the extra players when your host starts the game, and each extra player is $2 for that night once your host taps Start game to approve. Your Account page shows your plan, your next payment and your invoices. For anything about a bill, email accounts@venueplay.com.au.';

do $$
begin
  if not exists (
    select 1 from public.vp_help_faq
     where id = 'd3a64ff4-0b24-5073-be9a-32f85519ec1b'
       and answer = 'Your plan includes a number of players a night, and it never stops anyone joining. If a night runs bigger, the console shows the extra players when your host starts the game, and each extra player is $2 for that night once your host taps Start game to approve. Your Account page shows your plan, your next payment and your invoices. For anything about a bill, email accounts@venueplay.com.au. If your free month ends with no card on your account, your games pause. Your TV keeps showing your ads and nothing is lost. Adding a card switches everything back on.'
  ) then
    raise exception 'Migration 162 changed nothing: the live "Billing and players" answer (vp_help_faq d3a64ff4-0b24-5073-be9a-32f85519ec1b) is neither migration 113''s words nor the new words. Rewrite 162 against the live text.';
  end if;
end $$;

-- Read it back (read only):
--   select answer, updated_by from public.vp_help_faq where id = 'd3a64ff4-0b24-5073-be9a-32f85519ec1b';
--   (ends "Adding a card switches everything back on.", updated_by migration 162)

-- Rollback (puts 113's words back, only if the answer is still this one's):
--   update public.vp_help_faq set answer = 'Your plan includes a number of players a night, and it never stops anyone joining. If a night runs bigger, the console shows the extra players when your host starts the game, and each extra player is $2 for that night once your host taps Start game to approve. Your Account page shows your plan, your next payment and your invoices. For anything about a bill, email accounts@venueplay.com.au.',
--          updated_at = now(), updated_by = 'migration 162 rollback'
--    where id = 'd3a64ff4-0b24-5073-be9a-32f85519ec1b'
--      and answer like '%Adding a card switches everything back on.';
