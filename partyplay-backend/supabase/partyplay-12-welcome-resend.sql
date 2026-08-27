-- PartyPlay 12: let somebody ask for their welcome email again.
--
-- The host key is deliberately never in a URL: the success page would hand it to
-- Google Analytics, and it is the only thing protecting a party from being
-- rewritten by anyone who knows the code. So the key exists in exactly one place,
-- the welcome email.
--
-- Which means a spam filter, a typo in an email address, or an outage at Resend
-- leaves somebody who has PAID with no way into their own party at all. That is
-- the worst failure this product has, and until now the only fix was to email us.
--
-- This column is the rate limit for a "send it again" button. Nothing else.

alter table pp_licences
  add column if not exists welcome_sent_at timestamptz;

comment on column pp_licences.welcome_sent_at is
  'When the welcome email last went out. Used to space out "send it again" requests, since anyone who knows a party code can ask.';
