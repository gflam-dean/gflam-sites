# PartyPlay: what actually stops it launching today

12 September 2026. Read from the code in this repo, and checked against the live site
and the live Worker. Where I could not tell without running something, it says so.

Nothing in this file was changed. It is a list of findings.

**The short answer.** The money side is built and it works. The delivery side is built.
What is broken is the night itself: the button a customer presses to start their party
does nothing, and neither do the buttons inside six of the ten games. This is one fault,
in one line, and it is live right now.

---

## 1. "Start the party" does nothing. Nobody who buys can run their party.

**The blocker.** A customer pays $50, gets their code, builds their games, opens
`/run` on the night, and presses the big pink **Start the party** button. Nothing
happens. No error, no message, nothing at all. The clock never starts, so no guest can
join either: the Worker refuses every join with "This party has not been started yet."

**The evidence.**

`partyplay/run.html`, one delegated click handler at line 826. Its filter reads:

```js
var el = ev.target.closest("[data-run],#call,#back,#again,#reveal,#next,#shownight,#resetnight,#flip,#hstart");
if(!el) return;
```

That list of names is what the handler will react to. Four lines further down it tries to
act on `startnow`:

```js
if(el.id==="startnow"){ startClock(); return; }
```

`startnow` is not in the list, so the handler has already given up before it gets there.
`startClock()` in `run.html` (line 294) is the only thing anywhere that calls
`POST /licence/start`, and `handleStart` in the Worker is the only thing that sets
`activated_at`. So the chain from the button to the clock is cut at the first link.

I did not only read this. I pulled the real script out of `run.html`, captured its real
click handler, and clicked every one of its own buttons. Nine reacted. Seventeen did not,
and `startnow` was one of them.

Confirmed live: `https://partyplay.com.au/run` serves that exact line today, and the
working copy is clean and matches `origin/main`.

**Smallest fix.** Add the missing names to that one selector on line 827. Nothing else in
the file has to change, because every branch under it is already written and already
correct.

---

## 2. Six of the ten advertised games cannot be played. Same one line.

The other sixteen dead buttons are the controls of six games. Each game draws its screen
correctly and then ignores every press.

| # on the front page | Game | Works? | Why |
|---|---|---|---|
| 01 | Bingo | **yes** | uses `#call`, `#again`, `#back`, all in the list |
| 02 | Trivia | **yes** | uses `#reveal`, `#next` |
| 03 | How well do you know... | **yes** | shares the trivia runner |
| 04 | Guess the photo | **no** | `#photoreveal`, `#photonext` dead |
| 05 | Two truths and a lie | **no** | `#truthsgo`, `#truthreveal`, `#truthnext` dead |
| 06 | Heads or tails | **yes** | uses `#flip`, `#hstart` |
| 07 | Who here has ever | **no** | `#whonext` dead, and it is the only control |
| 08 | Prize draw | **no** | `#drawnow`, `#drawreset` dead |
| 09 | Charades | **no** | `#charstart`, `#charnext`, `#charskip` dead |
| 10 | Who am I? | **no** | `#gwstart`, `#gwnext`, `#gwpass` dead |

Also dead for the same reason: `#askphotos`, the "Ask the room" button that invites guests
to leave an email for the album, and `#showqueue` in the playlist.

To be clear about what is and is not broken: the game logic underneath is fine. I drove
`charadesGo()` and `guessWhoGo()` directly and they broadcast the right things to the right
screens. The word never reaches the television in charades, and the answer does reach it in
Who am I. It is only the press that is lost.

**Smallest fix.** The same one line as blocker 1.

---

## 3. If the welcome email fails, nothing anywhere finds out.

**The blocker.** The whole product is delivered by one email: the party code and the host
key. Four things stack up so that a failed send looks exactly like a successful one.

**The evidence.** All in `worker/SOURCE-do-not-paste-partyplay-api.js`.

1. `sendLicenceEmail` starts with `if (!env.RESEND_API_KEY) return;`. No key, no email, no
   complaint.
2. `RESEND_API_KEY` is not in the `REQUIRED` list (line 1836), so `/health` answers
   `ok: true` with no way to send anything. It says that today: the live Worker returns
   `{"ok":true,"missing":[],"photos":true,"admins":2}`, which proves the secrets that are
   checked are there. It does not prove email works.
3. None of the four calls to `api.resend.com` looks at what came back. Every one is a bare
   `await fetch(...)`. A rejection from Resend, an unverified sending domain, a rate limit,
   a bad address, all of them resolve normally and throw nothing.
4. So in `handleWebhook` the `try` around `sendLicenceEmail` succeeds, and the next line
   stamps `welcome_sent_at`. The row now says the email went. `handleResendWelcome` is
   worse: it stamps `welcome_sent_at` **before** it calls `sendLicenceEmail`, so even a
   real throw leaves a false stamp behind.

That stamp is the only thing `tools/check-paid-not-delivered.py` reads. Its own header says
it exists because "a failed send is a line in a log nobody reads". It cannot see any of the
four failures above. It is a check that cannot go red.

**Smallest fix.** In `sendLicenceEmail` (and the other three senders), capture the response
and throw when it is not ok:

```js
const r = await fetch('https://api.resend.com/emails', {...});
if (!r.ok) throw new Error('resend ' + r.status + ': ' + (await r.text()).slice(0,200));
```

Then add `RESEND_API_KEY` to `REQUIRED`, and move the `welcome_sent_at` stamp in
`handleResendWelcome` to after the send.

**On whether somebody can buy at all:** yes. `handleCheckout` builds the Stripe session
correctly, `handleWebhook` verifies the signature properly, refuses delayed bank payments
until the money lands, handles the later `async_payment_succeeded`, and is idempotent on
`status=eq.pending` so a Stripe retry cannot send two emails. `check-paid-not-delivered.py`
records two real paid licences from 26 and 29 August, so the path has run in production.
Whether it still works end to end today is unknown without a test purchase.

---

## 4. In the host console, "Download" and "Copy link" for the album do nothing.

Same class of bug, different file. `partyplay/host.html` line 633:

```js
var el = ev.target.closest("[data-add],[data-edit],[data-del],[data-rm],#addItem");
```

and then at lines 676 and 677 it tries to act on `el.id === "dlAll"` and
`el.id === "copyShare"`. Neither name is in the selector. Those are the two buttons drawn
at lines 235 and 241, the ones a host uses to get their party photos out.

**Smallest fix.** Add `#dlAll,#copyShare` to that selector.

---

## 5. "Put it up" tells the host it worked. The television does not change.

`run.html` line 915 sends `{t:"board", title:"Tonight", rows:...}` and then toasts
"On the screen". `partyplay/tv.html`'s `onMsg` (line 189) only understands five messages:
`players`, `lobby`, `big`, `photoscreen`, `queue`. There is no `board` branch, so the
message is dropped and the screen stays on whatever was up.

The same is true of `final` (sent at the end of every trivia round). The television shows
only the winner's name, through a separate `big` message. The leaderboard never appears on
the television at any point in the night.

This is the one a customer would notice and mention, because the host presses the button in
front of a room full of people and then has to explain it.

**Smallest fix.** Add a `board` branch to `tv.html`'s `onMsg` that draws the rows, and point
the `final` branch at it too.

---

## 6. The ABN is on the emails now. It is not on the terms or the privacy page.

**Verified fixed:** `emailShell` in the Worker carries
`PP_ABN = '35 679 383 049'` and prints "PartyPlay is made by Gflam Group Pty Ltd, ABN
35 679 383 049, on the Gold Coast" in the footer of every PartyPlay email. One shell, so it
covers the licence email, the album email, the follow-up and the expiry nudge.

**Still missing:** `partyplay/terms.html` and `partyplay/privacy.html` contain no ABN at
all. I grepped every HTML file under `partyplay/` and there is not one. VenuePlay's do
(`venueplay/terms.html` line 90, `venueplay/privacy.html` line 96). The Worker's own comment
claims the number is "the same one on terms.html and privacy.html for both products", which
is true of VenuePlay only.

Everything else on the legal list is there and reads well:

- **Terms:** `partyplay/terms.html`, dated 25 August 2026. Covers what is being bought, the
  50 player cap, private use only, prizes, music, the album and its 30 day deletion.
- **Refunds:** a proper section, with 7 days change of mind before start, and an explicit
  "None of this limits your rights under the Australian Consumer Law" box. `start.html`
  line 166 and `booked.html` line 81 repeat the ACL line at the point of payment.
- **Privacy:** `partyplay/privacy.html`, with a working access and deletion request route.
- **Contact a human:** `hello@partyplay.com.au` on the front page footer, the terms, the
  privacy page, the checkout error path and the booked page. One caveat below.
- **Unsubscribe:** `handleUnsubscribe` is a real route, and it deliberately only acts on a
  POST so that a mail scanner following the link cannot unsubscribe somebody by accident.

**Smallest fix.** Add "Gflam Group Pty Ltd, ABN 35 679 383 049" to the top of both pages,
the way VenuePlay's do.

**The caveat on contact.** All four emails go out as
`from: 'PartyPlay <hello@send.partyplay.com.au>'` and none of them sets a `reply_to`. The
licence email's footer says "Just reply to this email, it comes straight to us." A reply
will go to `hello@send.partyplay.com.au`, which is the Resend sending subdomain, not the
address printed on the website. Whether that inbox is real and monitored is **unknown
without testing**. The fix is one field: `reply_to: 'hello@partyplay.com.au'`.

---

## 7. The welcome email sells a game the host console will not let them build.

`emailGuide` in the Worker lists "The eleven games" and includes **The playlist**. In
`host.html`, the `playlist` entry in `TYPES` is marked `retired:true`, and the picker at
line 297 filters retired types out. So a buyer reads about it in the email they paid for
and then cannot find it.

The heading is wrong twice over: eleven in the email, ten on the front page, and the games
list in `emailGuide` runs to eleven entries but a host can only add ten of them.

The same function's comment still says "most of the nine need nothing at all".

**Smallest fix.** Drop the playlist row from the `GAMES` array in `emailGuide` and change
"The eleven games" to "The ten games".

---

## 8. The front page overstates how little preparation is needed.

Two claims on `partyplay/index.html` that the product does not keep.

**"Seven need nothing prepared at all"** (line 200). Checked against `TYPES` in
`host.html`, the games that genuinely need nothing are Bingo, Two truths and a lie, Heads
or tails and Prize draw. That is four, not seven. The other six all have a builder with a
question and answer field: Trivia, How well do you know, Guess the photo, Who here has
ever, Charades, Who am I. The welcome email is honest about this and marks only five as
"ready", so the two disagree with each other as well.

**"Guess the photo: Built from photos your guests took tonight. Nothing to prepare in
advance."** (line 210). `runPhotos` in `run.html` line 422 refuses to start with no items
and puts up "Nothing set up. Build this one from your album first: pick a few photos and
say who each is." The host has to go to `/host`, open the picker, choose photos and type a
name against every one. The email says the same thing: "Upload baby photos beforehand and
say who each one is." The front page is the odd one out.

**Smallest fix.** Change "Seven" to "Four", and change game 04's description to say the
host picks the photos and names them first.

---

## 9. Nothing runs on a schedule. Four jobs wait for you to remember.

The Worker exports `fetch` only. There is no `scheduled` handler anywhere in the file.
Three comments in it say "Run it from a cron" or "Cron it". No cron exists.

What that means in practice:

- **The album guests are promised.** `play.html` line 818 tells a guest "Pop your email in
  and we will send you the album tomorrow. One email, that is it." That email is
  `handleSendAlbums`, reachable only through `POST /admin/send-albums`, which is a button
  in `admin.html` line 284. If nobody presses it, the guest never gets the album.
- **The 30 day deletion in the terms.** `terms.html` promises "the whole album is deleted"
  30 days after the party, and the album page tells guests the same. That is
  `handlePhotoSweep`, again only a button (`admin.html` line 285). Photos stay until
  somebody presses it. That is a privacy promise with nothing behind it.
- The "how was it" follow-up and the expiring licence nudge are in the same position.

**Smallest fix.** Add a Cron Trigger on the Worker and a `scheduled()` export that calls
the same four functions once a day. The functions are already written and already work.

---

## 10. `musical` is a format the product has no idea what to do with.

`FORMATS` in the Worker (line 381) accepts twelve names. Of those:

- Ten match the front page.
- `playlist` is retired in the host console (blocker 7).
- `musical` appears nowhere else at all. Not in `TYPES` in `host.html`, so no host can add
  one. Not in the run dispatcher in `run.html`, so if one ever existed it would fall into
  the catch-all at line 841 and put "Off we go" on the television and then do nothing.

It is not reachable through the site, so it is not urgent. But `handleGameSave` will accept
it from a direct POST and store it, and then it is a row that cannot be played.

**Smallest fix.** Remove `'musical'` from `FORMATS`.

---

## 11. Every test passes. None of them presses a button.

Worth knowing, because it explains how blockers 1, 2 and 4 got this far.

I ran the suites. 694 checks pass across eleven files. `lib/pp-run-games.test.js` is the
one that covers the night, and it says so in its own header: it "loads the real runners out
of run.html, drives them, and reads what they actually broadcast". It does exactly that,
by calling `charadesGo()` and `guessWhoGo()` as functions. It never dispatches a click, so
the broken selector is invisible to it.

`tools/play-a-game.py` is the tool that pretends to be a host and a phone. Its formats are
bingo, trivia, musical, members and raffle, on a VenuePlay staging Worker. It does not
touch PartyPlay.

One suite is permanently red: `lib/pp-trivia-pack.test.js` cannot find
`data/trivia/index.json` from the directory `smoke-test.sh` runs it in, and errors out
every time.

**Smallest fix.** One test that builds a fake DOM element per button id, dispatches the
handler, and asserts something happened. That is roughly the harness I used to prove
blocker 1, and it is about forty lines.

---

## 12. Smaller things, for completeness

- `handleCheckout` carries a comment saying "Stripe dedupes on this, so a double-tapped
  button cannot create two sessions. The header form is set below via a second call
  parameter." There is no idempotency key. `stripe()` takes no headers. A double tap makes
  two pending rows with two codes. The button is disabled client side, so this is mess in
  the database rather than a charge, but the comment says something that is not true.
- `handleCheckout` writes the pending licence row, then calls Stripe, then patches the
  session id. If Stripe fails, the pending row is orphaned. `checkout.session.expired`
  cleans up sessions that were created, not this case.
- `api.partyplay.com.au` still has no DNS record. `lib/pp-config.js` points the site at
  `partyplay-api.dean-tindale.workers.dev` on purpose and the comment explains why. Nothing
  is broken, it is just not the address you would want on a live product.

---

## The order I would do them in

1. The one selector in `run.html` line 827. That is blockers 1 and 2, the whole of them.
2. The one selector in `host.html` line 633. Blocker 4.
3. The Resend response check plus `RESEND_API_KEY` in `REQUIRED` plus the `reply_to`.
   Blockers 3 and the contact half of 6.
4. A `board` branch in `tv.html`. Blocker 5.
5. The ABN on terms and privacy, the playlist row out of the email, "Seven" to "Four".
   Blockers 6, 7, 8. All copy.
6. The cron. Blocker 9.
7. Then a real test that presses a button, before anything else ships. Blocker 11.

Items 1 to 5 are small and specific. What I cannot tell you from the code is whether the
night holds together once the buttons work, because nothing in this repo has ever run one.
A real party, played start to finish on a real television with two real phones, is the
thing that has not happened yet.
