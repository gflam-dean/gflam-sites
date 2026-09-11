# $265 a month for Instantly, and whether you need it

Written overnight, 12 Sep. Nothing here was run or bought. The pricing figure is the one
you quoted; check it against their site before you act on any of this, because their
tiers move.

## The short version

**The cost is driven by how many venues you email, not by the platform tier.** You have
17,319 licensed venues, and emailing all of them is what forces a big plan. You do not
have to. 978 of them are already running trivia, and those are the ones who understand
what you are selling in the first line.

Going after 978 instead of 17,319 is **18 times less sending**, which is the difference
between needing a large plan with a wall of mailboxes and needing a small one.

## The maths, using your own numbers

A cold sequence is usually three emails per contact. Cold sending is capped at roughly
30 a day per mailbox before deliverability suffers, and that cap is the real constraint,
not the software.

| Who you email | Contacts | Sends (3 each) | At 10 mailboxes (300/day) | At 30 mailboxes (900/day) |
|---|---|---|---|---|
| Every licensed venue | 17,319 | 51,957 | 173 days | 58 days |
| **Already running trivia** | **978** | **2,934** | **10 days** | **3 days** |
| Trivia venues, 3 rounds a year | 978 | 8,802 | 29 days | 10 days |

The full list takes most of a year to work through on a modest setup. The trivia list is
done in a fortnight, and you can run it again next quarter.

## Why the 978 are worth more than the other 16,341

They have already decided that a trivia night is worth running. You are not selling them
the idea, you are selling them a better way to do the thing they already do: no printing,
no marking, scores on the TV, and the players' phones do the work.

Every other venue needs convincing that a quiz night is a good idea at all. That is a
different, slower, more expensive sale, and it is the one that needs 50,000 emails.

## What I would do

1. **Run the 978 first, on the smallest plan that covers it.** Ten days of sending. If
   that converts at even 2% that is 20 venues, which is more than your current 17.
2. **Judge the tier on the result, not before it.** You will know your reply rate and
   your cost per booked demo, and then $265 is either obviously worth it or obviously not.
3. **Mailboxes and domains are the line item to watch**, not the plan. Sending volume
   comes from how many mailboxes you warm up, and each one costs money every month
   whether you send or not.
4. **Keep it off the transactional domain.** Already in your notes, repeating it because
   it is the one mistake that cannot be undone: if cold email lands your sending domain
   in a blocklist, the venue welcome emails and the payment receipts go with it. Those
   now go through `send.venueplay.com.au`, and cold outreach must never touch it.

## What I cannot tell you

Whether $265 is the right price for what they are offering, because I have not seen the
quote and their tiers change. What I can say is that the 17,319 number is what makes a
big plan look necessary, and that number is a choice rather than a requirement.

## Before any of it goes out

Two things from your own notes that apply to every send:

* The ABN belongs in the footer of every commercial email, along with a working
  unsubscribe. That is the Spam Act, and it applies to cold outreach more than anything
  else you send. **See the open ABN question in MORNING-2026-09-12.md: I need the right
  number from you before anything goes to 978 venues with it in the footer.**
* `python3 tools/check-data.py` before quoting any count. The prospect number moved four
  times in one day the last time it was counted, and every figure in this document comes
  from your notes rather than from a fresh run.
