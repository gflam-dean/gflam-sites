# PartyPlay: an audit of the twelve game formats

12 September 2026. Read-only. Nothing in the repo was changed.

Everything below is grounded in code that was read. Where an answer needs a browser,
a television and real phones, it says **unknown without testing** rather than guessing.

**Deliberately not re-reported:** the delegated click-handler filter in `run.html` and
`host.html`. That was found and fixed on 12 Sep 2026 and is covered in
`LAUNCH-BLOCKERS.md`. The same *shape* was hunted for elsewhere and the result is in
section 3 below.

---

## 0. What the twelve actually are

`FORMATS` in `worker/SOURCE-do-not-paste-partyplay-api.js:381` (and the identical line at
`DEPLOY-partyplay-api.js:487`):

```
bingo90, trivia, musical, draw, howwell, headstails, whohere, photos, truths, playlist,
charades, guesswho
```

The same twelve are the CHECK constraint in `supabase/partyplay-01-core.sql:87` plus
`partyplay-13-charades-guesswho.sql:38`.

`TYPES` in `host.html:142` holds **eleven**. `musical` is not there. `playlist` is there
but carries `retired:true` and is filtered out of the "Add a game" grid at `host.html:297`.

So the counts that matter:

| Where | Count | Which |
|---|---|---|
| Worker will accept on POST /games | 12 | all |
| Database CHECK will store | 12 | all |
| A host can add from the console | 10 | all but `musical` and `playlist` |
| The front page advertises | 10 | same ten |
| The **welcome email** lists | 11 | the ten **plus `The playlist`**, marked "ready" |

That last row is a live contradiction: `emailGuide` in the Worker (line 83, the `GAMES`
array) sends every buyer a table headed "The eleven games" with **The playlist** marked
`ready`, and the host console will not let them add it.

---

## 1. The twelve, one at a time

Shared vocabulary used below:

* **build** = `host.html`, the `TYPES` table and `openBuilder` / `drawItems` / `drawPicker`
* **run** = `run.html`, a `runX()` function plus a `paintX()` and branches in the one
  delegated click handler at line 826
* **phone** = `play.html`, a branch in `onMsg` plus a `paintX()`
* **TV** = `tv.html`, a branch in `onMsg`. The TV only understands five message types:
  `players`, `lobby`, `big`, `photoscreen`, `queue`. Everything else it ignores in silence.

---

### 1. `bingo90`: Bingo

**Implemented?** Build: yes, trivially (`TYPES.bingo90`, no `q`, so `host.html:644` adds it
with one POST and no builder). Run: yes, `runBingo` / `paintBingo` / `nextBall` / `callName`.
Phone: yes, `bingoStart` / `paintBingo` / `bingoSave`, real tickets from `PPTicket.build`.
TV: only as `big`, i.e. one huge number and the call underneath.

**Preparation:** none. Add it and go.

**How it runs:** `runBingo` fills a pool of 1 to 90, broadcasts `{t:"bingo"}` so every phone
builds its ticket, then each press of `#call` runs `nextBall`, which draws with `pick(n)`
(rejection-sampled `crypto.getRandomValues`, `run.html:149`) and broadcasts
`{t:"big", text:n, sub:callName(n)}`. `callName` carries the traditional calls for 14
numbers and falls back to "four and five, 45".

**How it scores:** it does not. `nightAdd` is never called for bingo. Winning is a shout.

**Two at once / rejoin:**

* Two claims at the same moment: both land, `onClaim` toasts twice and broadcasts two
  `big` messages, so the television shows only the second name. The first winner vanishes
  off the screen. No queue, no "and also".
* **A guest who reloads mid-game loses their ticket for the rest of the game.** `B` is only
  ever set by the `{t:"bingo"}` message (`play.html:523`), which is sent once, at the start.
  On reload, `play.html:853` restores the saved player and calls `waiting()`; nothing asks
  for the ticket again. The marks are safely in `localStorage` under `ppBingo:<code>`
  (`bingoSave`), and there is no path that reads them back. From then on every ball falls
  through `onMsg`'s `big` branch (`B` is null) and renders as a full-screen number with no
  ticket under it. At a party, phones reload. This will happen.
* **A TV that reloads mid-game shows the join screen until the next ball.** `tv-here` makes
  the host call `G.repaint()` (`run.html:170`), and `paintBingo` writes to `$("app")`, which
  is the **host's own** screen. Nothing is re-sent to the television.

**What a bored guest can do:**

* **Mark any cell, called or not.** `play.html:679` toggles `B.marked[n]` with no check
  against `B.called`. `PPTicket.progress` is then fed `Object.keys(B.marked)`
  (`play.html:328`), so tapping your own 15 numbers on ball one produces
  "Full house! Shout out" immediately. Pressing it broadcasts a real `claim`, the host gets
  a toast, and the winner's name goes on the telly.
* Forge a claim for somebody else: `{t:"claim", name:"Nan", kind:"full"}` on the open
  channel (see section 2).
* The host cannot check the claim off the television. `practice.html:176` explicitly tells
  the host to "check their ticket against the called numbers on the telly", and **the telly
  never shows the called numbers**. Only `run.html`'s own 1-to-90 board does, on the host's
  phone.

**Weak as a game:** one ticket per person, forever. `PPTicket.build(token)` is seeded from
the player token, which is fixed for the whole party, so the second and third games of bingo
deal every guest **the identical card they already have**. VenuePlay has multi-ticket;
PartyPlay does not. There is no line/two-line/full-house structure on the host side either:
the host decides out loud.

**Tested?** `pp-ticket.test.js` genuinely exercises `PPTicket.build` and `progress` over 400
tokens (415 checks, real). That is the ticket library. **Nothing runs `runBingo`,
`nextBall`, `bingoStart` or `paintBingo`.** No test presses `#call`.

---

### 2. `trivia`: Trivia

**Implemented?** Build: yes, full builder plus ready-made packs. Run: yes, `runTrivia` /
`paintTrivia` / `board`. Phone: yes, `paintQuestion`. TV: `big` only, so the question text
and "Question 3 of 10". The four options are **never on the television**, only on phones.

**Preparation:** questions and answers, typed, or one click. `categoryStrip` (`host.html:424`)
offers eleven categories from `/data/trivia/index.json` and `fillFromCategory` drops ten in,
deduped against every other round in the same party. Attribution travels with them
(`creditLine`, CC BY-SA).

**How it runs:** one seed per round (`G.seed`), so host, TV and phones derive the same four
options without them being sent three times. `#next` broadcasts `{t:"ask", options:...}`,
`#reveal` broadcasts `{t:"result", correct, board}`. `PPQuiz.options` builds decoys from the
**other answers in the same round**, which is the good idea in this product.

**How it scores:** `PPQuiz.score`, 100 a correct answer, **no speed bonus**, documented at
`pp-quiz.js:78` as a deliberate choice. Banked into the night board once, guarded by
`G.banked` (`run.html:961`).

**Two at once / rejoin:**

* Two answers at the same instant: both are accepted. The dedupe at `run.html:211` is on
  name plus question index, so simultaneity is safe.
* **A late answer after the reveal still counts.** The handler checks `G && G.items && m.name`
  and nothing else: no check that `m.i === G.i`, and no check that the question has been
  revealed. Since the reveal broadcasts `correct` to the whole room, a guest can sit out,
  read the answer off the `result` message and then send `{t:"answer", i:N, answer:<correct>}`.
  `board()` recomputes over every stored answer, so it scores. That is a working cheat that
  needs the browser console and nothing else.
* Rejoin mid-question: the guest sees the waiting screen until the host presses Next.
  There is no `G.resend` for trivia (only charades and Who am I define one, `run.html:558`
  and `617`).
* Under a burst of answers `paintTrivia()` rebuilds `$("app").innerHTML` once per incoming
  message. Every rebuild destroys the host's buttons. Whether a host tap gets eaten between
  mousedown and mouseup at 40 guests is **unknown without testing**, but the structure is
  there in every `paintX` in the file.

**Weak as a game:** no timer and no speed points means a ten-question round routinely ends
in a flat tie at 1000 for everyone who knew them all, with no tiebreak anywhere in the code.
`board()` sorts ties by name. For a lounge room that is arguably right; as the thing the
front page calls "the scores keep themselves", it produces an anticlimax.

**Tested?** `pp-quiz.test.js` (38 checks) genuinely runs `PPQuiz.options`, `isRight` and
`score`, including the "the right answer is not always in the same slot" check.
`pp-trivia-pack.test.js` (34 checks) validates all eleven packs and pushes ten real music
questions through `PPQuiz.options`. **Nothing runs `runTrivia`, `paintTrivia` or the
`#reveal` / `#next` branches.**

---

### 3. `musical`: nothing

**Implemented?** No, in every sense. It is in `FORMATS`, in the SQL CHECK, and **nowhere
else in the product**. No `TYPES` entry, so it cannot be added. No `runMusical`. No
`onMsg` branch on the phone. No TV branch.

**Can a host reach it?** Not through any screen. The only way a `musical` row exists is a
hand-crafted `POST /games`. If one did exist, `run.html:857` catches it in the final `else`:
it broadcasts `{t:"big", text:<title>, sub:"Off we go"}`, toasts "Running ...", and that is
the entire game. A title on the television and nothing else, forever, with no way back
except "Back to games".

**Everything else:** not applicable.

**Tested?** No. `partyplay-api.test.js:314` proves an *unknown* format is rejected with 400;
`musical` is a **known** format, so it sails through `handleGameSave`.

---

### 4. `draw`: Prize draw

**Implemented?** Build: yes, instant add, no builder. Run: yes, `runDraw` / `paintDraw` /
`drawWinner`. Phone: `big` only. TV: `big` only.

**Preparation:** none.

**How it runs:** `drawWinner` picks from `players` minus `G.won` with the same rejection-sampled
`pick()`, broadcasts `{t:"big", text:winner, sub:"Come and get it"}`, and keeps a winners list.
"Draw another" runs until everybody has won something.

**How it scores:** no scoring.

**Two at once / rejoin:** no guest input at all, so nothing can collide. A guest joining
mid-draw is added to `players` by their `hello` and is immediately in the hat.

**What a bored guest can do:** **stuff the barrel.** `players` is built from one place only,
the `{t:"hello", name:...}` broadcast at `run.html:162`. It is never checked against
`pp_players` and never reconciled with the Worker. Sending fifty `hello` messages with fifty
names puts fifty entries in the hat, and the sender knows which one is theirs. Nothing in
the code can tell the difference.

**Weak as a game:** the comment at `run.html:470` says it "deliberately draws from people who
are actually IN the room, not a list typed up earlier". **That claim is not true of the
code.** There is no presence tracking, no leave event and no heartbeat; `players` only ever
grows. Somebody who joined at 8pm and went home at 10 is still in the hat at midnight, which
is precisely the failure the comment says it avoids. And on the television the draw is a name
appearing instantly. No shuffle, no countdown, no suspense. Against a free random-name-picker
website this is not obviously better.

**Tested?** No. Nothing runs `runDraw` or `drawWinner`.

---

### 5. `howwell`: How well do you know...

**Implemented?** Build: yes, its own labels ("Question about them" / "The real answer").
Run: **it is trivia**. `run.html:848` dispatches `trivia` and `howwell` to the same
`runTrivia`. Phone and TV: as trivia.

**Preparation:** typed, always. `categoryStrip` (`host.html:427`) returns `""` for anything
that is not `trivia` and not in `WORDY`. So `howwell` has **no ready-made pack and no
"Add ten" button**, by design (the questions are about a specific person).

**How it runs / scores / races / spoils:** identical to trivia, including the
answer-after-reveal cheat.

**Weak as a game:** it is the best idea in the product and it is the same runner as trivia
with a different label. The decoys being the other true facts about the same person is
genuinely funny and costs the host nothing. Nothing else distinguishes it.

**Tested?** No, beyond the `PPQuiz` library it shares with trivia.

---

### 6. `headstails`: Heads or tails

**Implemented?** Build: instant add. Run: `runHeads` / `paintHeads` / `flip`. Phone:
`paintHeads`, two buttons. TV: `big` only.

**Preparation:** none.

**How it runs:** `runHeads` snapshots `players.slice()` into `G.inPlay`, broadcasts
`{t:"heads", round:0}`, and each `#flip` calls `flip()`: `pick(2)` decides the side, anyone
whose pick disagrees is knocked out, the result and the new `inPlay` go out to every phone.

**How it scores:** the last one standing gets `PPQuiz.CORRECT_POINTS` (100) into the night
board (`run.html:777`).

**Two at once / rejoin:**

* Picks are `G.picks[name] = side`, a plain assignment. Simultaneous picks are safe.
* **A guest who joins after the game starts is told they are out of a game they never
  played.** `runHeads` snapshots `inPlay` at the start, and their `pick` is refused at
  `run.html:207` because their name is not in it. On the next flip their phone receives an
  `inPlay` that excludes them and `play.html:598` renders "Out. Bad luck."
* A guest who reloads is fine from the next flip onward.

**What a bored guest can do:** `{t:"pick", name:"Nan", side:"tails"}` knocks Nan out. There
is no check that the sender is who they say they are.

**Weak as a game, seriously:** `flip()` at `run.html:771` filters out only players who picked
**and picked wrong**. The comment above it explains why (do not knock out the guest who was
at the bar), and the consequence is that **the winning strategy is to never touch your
phone**. Someone who ignores the game entirely can never be eliminated and will win it. In a
room of twenty, the two or three people not paying attention are the finalists.

**Tested?** No. Nothing runs `runHeads` or `flip`.

---

### 7. `whohere`: Who here has ever

**Implemented?** Build: yes, "Find someone who..." prompts. Run: `runWhoHere` /
`paintWhoHere` plus the `#whonext` branch. Phone: `paintHands`, one button. TV: `big` only,
which is enough: the prompt goes up and the names of everyone who raised go in the subtitle.

**Preparation:** typed prompts, always. **No pack.** `WORDY` covers only `charades` and
`guesswho` (`host.html:357`), so `categoryStrip` gives this format nothing.

**How it runs:** `#whonext` advances and broadcasts `{t:"hands", i, q}`. Each `hand` message
appends to `G.hands` and re-broadcasts a `big` carrying the prompt plus the accumulated
names.

**How it scores:** it does not. No `nightAdd`, no board, no end state beyond "That is the lot".

**Two at once / rejoin:**

* Two hands at once: both are stored (dedupe on `i` plus `name`, `run.html:186`), and each
  one fires its own `big`. The two broadcasts race and the television shows whichever lands
  second, which will be the complete list either way. Harmless flicker.
* A guest who rejoins gets the next prompt and nothing for the current one.

**What a bored guest can do:** this is the worst one. `{t:"hand", name:"Nan", i:3}` puts
**Nan's name on the television** under whatever the current prompt is. The prompts in this
game are personal by design ("Find someone who has been arrested"). One line in a console
and somebody's name is on the telly next to it, and the host has no way to take it down or
to know it was forged.

**Weak as a game:** there is no ending, no points and no reason to move on other than the
host deciding to. It is a list of prompts with a name ticker. Against a printed
"Find someone who" sheet it adds the television and nothing else.

**Tested?** No.

---

### 8. `photos`: Guess the photo

**Implemented?** Build: yes, and it is the most-built screen in the product (`drawPicker`,
`host.html:493`: upload, shrink client-side, pick from a grid, name each one). Run: yes,
`runPhotos` / `paintPhotos` / `photoOptions`. Phone: yes, `paintPhoto`, buttons only, no
image (deliberate, `play.html:488`). TV: yes, a real branch, `photoscreen`.

**Preparation:** real preparation. `saveGame` (`host.html:590`) filters to items where the
"Who is it?" field is non-blank, so a photos game cannot be saved without the host uploading
photos **and** naming every one of them.

**How it runs:** `#photonext` broadcasts `{t:"photo", options}` to phones and
`{t:"photoscreen", url}` to the television. `#photoreveal` broadcasts `photoresult`.

**How it scores:** 100 a correct guess, tallied at the end of the round and banked once.

**The fault that will be seen in front of the room.** `handlePhotoPick`
(`SOURCE-...js:631`) returns two lists: `mine` (`purpose === 'game'`, what the host uploaded)
and `party` (`purpose !== 'game'`, what the guests photographed tonight). `host.html:503`
concatenates them, `pics = mine.concat(party)`, and lets the host pick from either. The
builder renders each thumbnail through `thumb(id)` = `/photo?code=&key=&id=`, and
`handlePhotoGet` (line 875) has **no purpose filter**, so both kinds look perfect in the
builder. What gets **saved and broadcast** is `shown(id)` = `/game/photo?id=`, and
`handleGamePhoto` (line 660) filters `&purpose=eq.game`.

So a guest-taken photo picked for this game returns 404 from `/game/photo` and renders as a
broken image on the television. `tv.html:202` only tests whether `m.url` is empty, so the
"The photo could not be loaded" fallback never fires: the room gets the broken-image icon.

That is exactly the use case the front page sells as game 04: *"Built from photos your guests
took tonight. Nothing to prepare in advance."*

**Two at once / rejoin:** simultaneous guesses are fine (dedupe on name plus index,
`run.html:176`). A guest who rejoins mid-photo misses that photo and picks up at the next one.

**What a bored guest can do:** `{t:"photoguess", name:<someone else>, i, answer:<wrong>}`
lands first and the real guess is discarded as a duplicate.

**Weak as a game:**

* The decoys are **player nicknames** (`photoOptions`, `run.html:439`), and the correct
  answer is whatever the host typed. Guests join as "Nic", "Dad", "Shazza". The host types
  "Nicole". The one option that is not a nickname is the answer, every time.
* `photoOptions` shuffles with `sort(function(){ return rnd()-0.5; })`, twice. A comparator
  that ignores its arguments is not a shuffle. The correct answer is placed at index 0 by
  `[correct].concat(picked)` and then weakly permuted, so it sits in the first slot more
  often than one time in four. Compare `PPQuiz.options`, which does this properly with a
  Fisher-Yates `shuffle`. **How visible the bias is at four options is unknown without
  testing**, but the code is the wrong algorithm.

**Tested?** `pp-photo.test.js` (28 checks) genuinely runs `PPPhoto.targetSize` and
`niceSize`, which is the shrink library. **Nothing runs `runPhotos`, `photoOptions` or
`paintPhoto`,** and nothing checks that a saved game URL resolves.

---

### 9. `truths`: Two truths and a lie

**Implemented?** Build: instant add, no builder (guests write their own). Run: yes,
`runTruths` / `paintTruths` / `truthsTally` plus three branches. Phone: yes, both halves,
`paintTruthsForm` and `paintVote`. TV: `big` only.

**Preparation:** none.

**How it runs:** two phases. `runTruths` broadcasts `{t:"ask-truths"}`, every phone shows a
three-line form with a "this one is the lie" radio, and the host waits. `#truthsgo` (enabled
at two submissions) moves to `phase:"play"` and walks person by person: `truthvote` out,
votes in, `#truthreveal`, `#truthnext`.

**How it scores:** `truthsTally` (`run.html:685`), 100 for each lie correctly spotted, banked
at the end. This function exists as a named function specifically because the inline version
used to throw its own answer away and hand everybody a flat 100.

**Two at once / rejoin:**

* Submissions dedupe on name (`run.html:194`), votes dedupe on turn plus name
  (`run.html:202`), and the author is correctly barred from voting on their own
  (`m.name !== t.name`). Simultaneity is handled.
* **A guest who reloads during the collect phase can never submit.** `ask-truths` is sent
  once, at `runTruths`. There is no `G.resend` for this format. Their phone sits on the
  waiting screen while everyone else types.

**What a bored guest can do:** submit three lines under somebody else's name, before that
person does. The dedupe is on name, so the forgery lands first and the real person's
submission is silently dropped. The host reads the forgery out loud with the victim's name
on it.

**Weak as a game:** **the three statements never reach the television.** `#truthsgo` and
`#truthnext` broadcast `{t:"big", text:<name>, sub:"Which one is the lie?"}` only
(`run.html:912`, `926`). The lines go to phones in the `truthvote` payload and to the host's
own console. So the big screen, the thing the customer bought this for, shows one name for
the whole game. It is also purely sequential: twenty guests means twenty rounds of the same
thing, and the host has no way to cut it short except pressing Next repeatedly.

**Tested?** `truthsTally` is genuinely driven by `pp-run-games.test.js` with six vote records
and correctly-differentiated scores (six checks, real, and it is the regression test for the
flat-hundred bug). **`runTruths`, `paintTruths` and the three click branches are not run.**

---

### 10. `playlist`: The playlist

**Implemented?** Build: **retired**. `TYPES.playlist` carries `retired:true` (`host.html:161`)
and `host.html:297` filters `ready && !retired` out of the Add grid. An existing playlist row
still renders in the games list (that is why the entry was kept). Run: yes, fully,
`runPlaylist` / `paintPlaylist` plus `#showqueue`. Phone: yes, `paintText` reused. TV: yes, a
real `queue` branch.

**Can a host reach it?** Not from the console. The Worker still accepts
`format: "playlist"` on `POST /games` (it is in `FORMATS`), so it is reachable by a crafted
request, and any party built before the retirement still has a working one.

**But a customer is still sold it.** `emailGuide` in the Worker sends every buyer "The
eleven games", with **The playlist** marked **ready** and described as "Guests add songs, the
queue goes on the screen". They will look for it and it will not be there.

**How it runs:** `ask-text` out, guests type song titles, each `song` message appends to
`G.songs` and re-broadcasts the last twelve. `#showqueue` puts the whole list on the
television.

**How it scores:** no scoring, and nothing plays. The comment at `run.html:503` is honest
about why (no music, no lyrics, no licensing), which is also why it was retired.

**Two at once / rejoin:** two songs at once both land. A guest who reloads cannot add
another: `ask-text` is sent once, at `runPlaylist`, and there is no resend.

**What a bored guest can do:** this is the largest unmoderated surface in the product.
`G.songs.push` at `run.html:181` has **no dedupe, no cap, no rate limit, no removal and no
host moderation**, and the text is capped only at 80 characters. Whatever is typed goes
straight onto the television via `showqueue`. `esc()` prevents markup, not content.

**Broken state:** `paintPlaylist` renders `s.played` with a strikethrough. **Nothing anywhere
sets `played` to true.** Dead code.

**Tested?** No.

---

### 11. `charades`: Charades

**Implemented?** Build: yes, with word packs (six categories, `/data/words/charades-*.json`,
`fillWords` / `wordIndexFor`). Run: yes, `runCharades` / `paintCharades` / `charadesGo` /
`resendCharades` / `nextActor` / `warnScreens`. Phone: yes, a full branch with two visually
distinct states (`.secret` vs `.watch`). TV: deliberately nothing but the actor's name.

**Preparation:** words, but one click. Pick a category, "Add ten", save.

**How it runs:** `charadesGo` advances, picks the actor round the room in join order, and
broadcasts `{t:"charades", word, actor}` to every phone. Each phone compares `m.actor` with
its own stored nickname and either shows the word or shows who to watch. The television gets
`{t:"big", text:"<name> is acting"}` and never the word. `warnScreens` forces a one-tap
acknowledgement before the first round.

**How it scores:** **it does not.** `#charnext` ("Got it") records nothing. No `nightAdd`, no
board, no winner. Nobody is keeping score in charades.

**Two at once / rejoin:**

* No guest input at all, so nothing collides. Guesses are shouted.
* Rejoin is handled properly, and this is one of only two formats where it is:
  `G.resend = resendCharades` and `run.html:168` fires it on `hello`. A phone that joins or
  reloads mid-round gets the current word or the current actor's name again.
* **A guest joining mid-game breaks the rotation.** `nextActor` is
  `players[G.got.length % players.length]`, and `players` grows as people arrive, so the
  modulus shifts underneath it: somebody gets a second turn before somebody else gets a
  first.

**What a bored guest can do:** the word is broadcast to the whole room on an open channel
and every phone filters it locally. Anyone who opens the browser console, or who is watching
the network tab, sees it. The comment at `run.html:550` acknowledges this and judges it
"honest enough for a lounge room". Fair for a family party; not fair if anybody in the room
is fifteen and bored.

**Weak as a game:** no score, no timer, no "they got it in 20 seconds". `#charskip` and
`#charnext` do exactly the same thing to the word list. A pack of words and a phone is
genuinely useful, but it is a word dispenser rather than a game.

**Tested?** **Yes, properly.** `pp-run-games.test.js` lifts the real script out of `run.html`,
runs it, and drives `runCharades` and `charadesGo`, asserting that the word is sent, the actor
rotates, the word **does not** reach the television, and that a late joiner is re-sent the
current round. This is the only game in the product with a test that actually plays it.

---

### 12. `guesswho`: Who am I?

**Implemented?** Build: yes, with six word packs. Run: yes, `runGuessWho` / `paintGuessWho` /
`guessWhoGo` / `resendGuessWho` / `warnScreens`. Phone: yes, the mirror-image branch
(`.blind` vs `.secret`). TV: yes, via `big`, which is the point: the answer is meant to be up.

**Preparation:** one click, same as charades.

**How it runs:** the answer goes on the television and to every phone **except** the
guesser's, which shows a "Do not look at the big screen" panel. `warnScreens` warns first.

**How it scores:** **it does not.**

**Two at once / rejoin:** no guest input. Rejoin is handled (`resendGuessWho`). Same
rotation drift as charades: `players[G.done.length % players.length]`.

**What a bored guest can do:** the guesser can look at the telly, which the product warns
about twice and cannot prevent. A guest can also broadcast a forged `{t:"guesswho",
guesser:"<the actual guesser's name>", answer:"..."}`, which would flip the guesser's phone
into the "everyone else" view and hand them the answer.

**Weak as a game:** no score, no timer, no question limit. `#gwpass` consumes the word.

**Tested?** **Yes**, same suite as charades: `runGuessWho` and `guessWhoGo` are driven for
real, including the check that with nobody joined it deals nothing and says why.

---

## 2. The thing that sits underneath all twelve

Every screen joins the Supabase realtime channel `pp-<CODE>` with the **public anon key**
(`pp-config.js:44`, `channel()` at line 49). There is no auth, no signing and no sender
identity on any message. The party code is on the television all night, in 14vh type.

VenuePlay solved this: broadcast signing has been enforced at all 17 venues since 10 Sep.
PartyPlay has none of it. Every message is trusted on the strength of the `name` field
inside it.

What one guest with the browser console can do, using only `window._ppSend`, which
`play.html:294` puts on the global object:

| Send | Effect |
|---|---|
| `{t:"lobby"}` | every phone and the television drop to the join screen. The round in progress is over. |
| `{t:"big", text:"...", sub:"..."}` | arbitrary text, full screen, on the television, at any moment. `esc()` stops markup, not words. |
| `{t:"hello", name:"..."}` x50 | fills the player list, stuffs the prize draw, shifts the charades rotation |
| `{t:"players", names:[...]}` | rewrites the "who is playing" strip on the television |
| `{t:"answer", name:<victim>, i, answer:<wrong>}` | scores a wrong answer for somebody else, and their real answer is then dropped as a duplicate |
| `{t:"pick", name:<victim>, side}` | eliminates somebody from heads or tails |
| `{t:"hand", name:<victim>, i}` | puts somebody's name on the telly under "has ever..." |
| `{t:"truths", name:<victim>, lines, lie}` | submits three statements as somebody else |
| `{t:"claim", name:<victim>, kind:"full"}` | fake bingo winner on the television |
| `{t:"queue", songs:[...]}` | replaces the television with an arbitrary list |

The one injection hole that *was* here is gone: `tv.html:194` records that a `t:"html"`
branch used to write a broadcast payload straight into `innerHTML` and was deleted. Every
remaining branch escapes. So this is disruption, not code execution. At a 21st with a
teenager in the room, disruption is enough.

---

## 3. The "selector names fewer things than the body" shape, elsewhere

Checked every delegated handler in the site. There are six:

| File:line | Selector | Does the body act on anything the selector misses? |
|---|---|---|
| `run.html:843` | `[data-run],button[id]` | No. Fixed 12 Sep. Every branch id is rendered as a `<button>` with that id. `#siResend` is an `<a>` but has its own direct listener; `#warnok` likewise. |
| `host.html:639` | `[data-add],[data-edit],[data-del],[data-rm],button[id]` | No. Fixed 12 Sep. `#catFill`, `#dCancel`, `#dSave`, `#gamePhotos` all have direct listeners. |
| `host.html:576` | `[data-pick],[data-unpick]` | No. Body handles exactly those two. |
| `play.html:643` | `[data-n],[data-claim],[data-opt],[data-side],[data-lie],[data-photo]` | **No.** All six are named and all six are handled. Clean. |
| `admin.html:478` | `[data-cp],[data-do]` | No. Both handled. |
| `admin.html:399` | `[data-off]` | No. One attribute, one branch. |

**The shape does not exist anywhere else today.** What is worth saying is that nothing
*prevents* it coming back in `run.html` or `host.html`: those two now rely on the convention
"every control is a `<button>` with an id". The day somebody writes `<a id="...">` or
`<div id="...">` for a control, it is dead again and silent again, exactly as before.

---

## 4. The questions asked

### Which of the ten advertised games would embarrass Dean in front of a paying customer

In the order they would hurt:

1. **Guess the photo (04).** The front page sells it as "Built from photos your guests took
   tonight. Nothing to prepare in advance." Do that and the photo is a broken image on the
   television, because `/game/photo` filters `purpose=eq.game` and guest photos are
   `purpose='album'`. It looks perfect in the builder and breaks only on the night, in front
   of the room. Section 1.8.

2. **Bingo (01).** Any guest can mark cells that have not been called and claim a full house
   on ball one, and the television shows no called-numbers board for the host to check
   against, even though the practice screen tells them to check against it. Add that a phone
   which reloads loses its ticket for the rest of the game, and this is the format most
   likely to produce a row at a party.

3. **Heads or tails (06).** Sold as "the best possible opener". The person who ignores their
   phone cannot be eliminated and will win. That will be noticed, out loud, the first time it
   happens.

4. **Who here has ever (07).** No score, no ending, and a forged `hand` puts a real person's
   name on the telly under a personal prompt. It is also the thinnest game in the set.

5. **Charades (09) and Who am I (10).** Not broken, and the best-tested code in the product.
   But neither keeps score at all, so they end without a winner. That is a let-down rather
   than an embarrassment.

6. **Two truths and a lie (05).** The three statements never reach the big screen. The
   customer bought a television game and this one uses the television for a name.

Bingo, trivia, How well do you know and the prize draw all *work*. Trivia and How well are
the strongest things here.

### Are musical and playlist finished?

**Neither is finished, and neither is free marketing.**

* **`musical`**: not started. It exists in `FORMATS` and in the SQL CHECK and nowhere else in
  the entire product. No host can reach it from any screen. If a row ever existed it would
  put a title on the television and do nothing. **The right move is to delete it from
  `FORMATS`**, because right now the Worker will happily store a format the product cannot
  play.
* **`playlist`**: built, working, and deliberately retired, because PartyPlay supplies no
  music and a queue nobody can play is a let-down. A host **cannot** add one. The damage is
  not in the game, it is in the **welcome email**: `emailGuide` still sells "The eleven
  games" with The playlist marked **ready**. Every buyer is told about a game that is not
  there. That row needs to come out of the Worker's `GAMES` array and the heading needs to
  say ten.

If the playlist ever comes back, it needs a cap, a dedupe and a host delete before it goes
anywhere near a television.

### The front page claims seven of the ten need no preparation. Count it.

`index.html:202`: *"Seven need nothing prepared at all, which matters when you bought this an
hour before people arrive."*

Counting from `TYPES` in `host.html`, where a format with a `q` field opens a builder and a
format without one is added with a single POST:

| Needs nothing at all | Needs the builder opened, one click of "Add ten" | Needs typing or uploading |
|---|---|---|
| Bingo | Trivia (11 packs) | How well do you know (**no pack**) |
| Two truths and a lie | Charades (6 packs) | Who here has ever (**no pack**) |
| Heads or tails | Who am I (6 packs) | Guess the photo (upload and name every one) |
| Prize draw | | |
| **4** | **3** | **3** |

**The honest number is four.** Seven is only reachable if "open the builder, choose a
category from a dropdown, press Add ten, press Save" counts as nothing prepared, which is
where the number came from and which is not what the sentence says.

The Worker's own welcome email already disagrees with the front page: `emailGuide` marks
**five** games `ready`, and one of those five is the retired playlist, so it is really four.
Two different numbers are going out from the same company today.

**Recommendation: change "Seven" to "Four".** It is still a strong claim, and Guess the
photo's "Nothing to prepare in advance" on line 211 needs to go with it.

---

## 5. Do the tests run anything?

All twelve suites pass: **728 checks**, run 12 Sep 2026.

```
pp-admin-auth 9   pp-checkout 17   pp-host-channel 17   pp-join-names 9
pp-licence 39     pp-photo 28      pp-quiz 38           pp-run-games 26
pp-ticket 415     pp-trivia-pack 34 pp-video 21         partyplay-api 75
```

What that number does and does not cover:

**Genuinely runs game code:**

* `pp-run-games.test.js` loads the real script out of `run.html`, injects an export inside
  the IIFE, and drives `runCharades`, `charadesGo`, `runGuessWho`, `guessWhoGo`, the late-joiner
  `resend` path, and `truthsTally`. This is the only suite that plays a game. It covers
  **two of twelve formats** plus one helper.
* `pp-host-channel.test.js` lifts `wireOut`, `send`, `flushQueue` and `onChannelStatus` out of
  `run.html` and tests the hold-and-flush behaviour on a dropped channel, in order, with the
  cap. Real, and important, but it is the transport, not a game.

**Runs libraries, not games:** `pp-ticket` (415 of the 728 checks are ticket shape over 400
tokens), `pp-quiz`, `pp-photo`, `pp-video`, `pp-trivia-pack`, `pp-licence`.

**Never run at all:**

* `runBingo`, `nextBall`, `paintBingo`, `callName`
* `runTrivia`, `paintTrivia`, `board`
* `runDraw`, `drawWinner`
* `runHeads`, `flip`
* `runWhoHere`
* `runPhotos`, `photoOptions`
* `runPlaylist`
* `runTruths`, `paintTruths`
* every branch of the delegated click handler

* **`play.html` is not read by any file in the repo.** Neither is `tv.html`. Confirmed by
  grep across `lib/`, `worker/` and `tools/`. There is **no test of the guest phone and no
  test of the television anywhere in this product.** Every claim in this document about what
  a phone or a TV does is read off the source, not observed.

`smoke-test.sh` curls `/play` and `/tv` for a 200 and runs `check-defs.py` over the pages for
called-but-undefined names. That catches the class of fault that once killed every join
(`showCamera` and `askForEmail` going missing), and it catches nothing about whether a game
plays.

---

## 6. The three to fix first

1. **Guess the photo shows a broken image for guest-taken photos.** Either give
   `handleGamePhoto` the same licence-scoped access as `handlePhotoGet` instead of
   `purpose=eq.game`, or stop `handlePhotoPick` offering `party` photos at all. Whichever
   way it goes, the front page copy and the code have to say the same thing. This is the one
   fault that is invisible until the room is watching.

2. **Nothing on the realtime channel is authenticated.** One guest and a browser console can
   end any round with `{t:"lobby"}`, put anything on the television with `{t:"big"}`, and
   score, eliminate or humiliate any other guest by putting their name in a message. The
   full list is in section 2. VenuePlay already has the answer built and live: broadcast
   signing.

3. **The one-shot setup messages are never re-sent, so a phone that reloads is out for the
   rest of the game.** `{t:"bingo"}`, `{t:"ask-truths"}` and `{t:"ask-text"}` are each sent
   once. Only charades and Who am I define `G.resend`. Bingo is the painful one: the ticket
   is gone and the saved marks in `ppBingo:<code>` are never read back. The `hello` hook at
   `run.html:168` already exists; every format needs a `resend`, and `tv-here` needs to
   broadcast rather than repaint the host's own screen.

Behind those three, and cheap: take **The playlist** out of the welcome email's `GAMES`
array and change "The eleven games" to ten; take `musical` out of `FORMATS`; change
"Seven" to "Four" on the front page along with Guess the photo's "Nothing to prepare in
advance".
