# A false bug report about bingo, and what actually caused it

On 12 Sep 2026 I reported that bingo could not be ended after a winner was confirmed:
the wall frozen on "checking the card", the winner's phone stuck on "the host is
checking your ticket", and Finish game, Keep playing and End game all doing nothing. I
wrote it up in detail, committed it, and told Dean to hold off emailing venues over it.

**None of it was true.** The whole flow works, end to end, on the live site against
Sydney:

    host taps Finish game   ->  claim queue clears to "No claims yet"
    the TV                  ->  "WE HAVE A WINNER. BINGO! TEST PHONE WINS $50 bar tab.
                                 Card #332, show your phone to the host"
    the winner's phone      ->  "YOU WON! Show this screen to the host to claim
                                 $50 bar tab. Card #332" and a feedback prompt

## What actually happened

I was driving the console with browser automation, clicking by element reference. The
claim card RE-RENDERS on every state change, which replaces its buttons. A reference
captured before a render points at a node that is no longer in the page, so the click
lands on nothing. No error is raised, because clicking a detached node is legal.

Every symptom followed from that. The buttons "did nothing" because they were never
pressed. The console looked frozen because nothing had asked it to move. Reloading did
not help because reloading does not fix a click that never happened.

The moment the same button was clicked by querying for it fresh, at the instant of the
click, everything worked first time.

    const btn = document.getElementById("claimQueue")
                        .querySelector('button[data-act="finish"]');
    btn.click();     // worked immediately

## The rule this cost

**A click that produces no change is not evidence of a bug. It is evidence that
something did not happen, and the first candidate is the click.**

Before reporting any UI fault found by automation:

1. Re-query the element immediately before clicking it. Never reuse a reference across
   a render.
2. Assert the click landed: check the element is still in the document
   (`document.contains(el)`) and that something observable changed.
3. Watch for an error at the moment of the click. Silence from the page plus no change
   is the signature of a missed click, not of a broken handler.
4. Only then look at the code.

## What was genuinely learned, and is worth keeping

The parts of the flow this exercise DID verify, on the live site, against Sydney:

- lobby, join code on the wall, a phone joining by typed code
- ball calls arriving on host, TV and phone in sync, with no fallback to local drawing,
  so the server-side RNG works on Sydney
- the server REFUSING an incomplete claim: "Not yet, keep playing. That pattern is not
  complete on any of your tickets"
- the claim reaching the host with the ticket drawn and an honest verdict: "NOT A WIN
  YET, one line is not complete on card #332", so a host cannot be tricked into
  awarding a prize
- confirm, announce, finish, and the winner reaching both the wall and the phone with
  the prize and the card number

That is the whole bingo path and it works.

## And one real gap, unchanged by any of this

No test drives the console past Confirm winner. Every bingo suite stops at the claim.
The flow works today and nothing would notice if it stopped. That check is still worth
writing, and it was the one true sentence in the report I got wrong.
