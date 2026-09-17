# PartyPlay, overnight 18 September

One job for you, below, and it is two minutes. The rest is a record of what was
found and what is now guarded. Your main job list is still `DEAN-TODO-17-SEP.md`.

## ONE THING FOR YOU, AND THE LIVE GATE IS RED UNTIL IT IS DONE. Two minutes.

**www.partyplay.com.au answers 200 and redirects nowhere, so PartyPlay is two
addresses.** www.venueplay.com.au redirects. www.getpartyplay.com.au redirects.
This one domain was simply never given the rule.

It matters more here than it did for VenuePlay. play.html keeps the guest's
identity in `localStorage["ppPlayer"]`, and localStorage is per ADDRESS. A guest
who lands on www and later on the plain name is a new person to the browser:
asked for a nickname again, written into the database a second time, and that
second row counts against the **fifty player cap**, which is enforced by the
database and cannot be argued with. Their bingo card marks go too. A thirty
person party could be refused at fifty.

**Cloudflare, the partyplay.com.au zone, Rules, Redirect Rules.** Hostname
equals `www.partyplay.com.au`, dynamic 301 to
`concat("https://partyplay.com.au", http.request.uri.path)`, preserve query
string. Exactly what you already did for the other two.

The live gate will go green again by itself once the rule is in. The local gate
is green now, so nothing is blocked from being pushed.

---

**Nothing else in PartyPlay was broken.** Everything I went looking for was either
already correct or a gap in the CHECKING rather than in the product. That is the
honest headline. What changed is that eleven things that were true by luck are
now true by construction.

---

## What I verified rather than assumed

  - **The deploy chain.** DEPLOY is what is live (`/health` says 168e4710),
    it is newer than its source, and the licence library inside it matches the
    library file character for character.
  - **Auth on every route.** Ten routes had no suite and no check naming them,
    four of them admin routes including `/admin/send-albums`, which emails
    guests. I read all ten before probing any. All four admin routes call
    adminActor, the host routes go through requireHost, which throws a real 403
    and compares keys with timingSafeEqual, and the album is reached by a share
    link at least 16 characters long scoped to a paid licence. Nothing was open.
  - **The privacy sweep is keeping up.** Nothing overdue, closest is 28 days.
  - **All three Workers have a Cron Trigger.** Game and billing hourly,
    PartyPlay every fifteen minutes.
  - **Unsubscribe works end to end**, and the link in the emails points at the
    right host, which is provable because the CORS allow-list is built from the
    same variable and the gate asserts it.
  - **All 14 PartyPlay suites run.** I checked rather than believed it.

---

## What is now guarded that was not

  1. **The privacy sweep is asked whether it WORKS**, not just whether it
     exists. `check-partyplay-retention.py` asks the database: photo rows past
     their own delete_after, and guest nicknames and email addresses from a
     party that finished more than the keep window ago. It reads the window out
     of the Worker so there is only one copy of the number.
  2. **A scheduled job with no cron behind it.** The album sweep once sat in the
     Worker unrun its whole life because nobody added a trigger. Now the gate
     asks Cloudflare.
  3. **Two suites that nothing ran at all.** One of them covered the deletion of
     a closed venue's player list, so tier one. Both passed. Nobody knew,
     because a suite nobody runs looks exactly like one that does not exist.
     The gate now requires every test file to be run or excused with a reason.
  4. **PartyPlay's seven shared scripts** were never checked for serving. If
     pp-games.js came back as the homepage, every game's database slug would go
     up on the television.
  5. **A page that calls a shared script must load it.** That is the fanfare
     fault, silent on eight screens for half a day.
  6. **The config a browser actually downloads** must match the repo. The gate
     checked the repo's key and never the deployed one, which is the Sydney
     fault one step along.
  7. **Nothing goes into the album without a date it leaves.** Three inserts,
     all correct. The point is the fourth one, written six months from now.
  8. **The size a browser sends and the size the Worker takes** must agree, for
     photos and video. They do. If the browser allowed more, a guest would
     record a clip at a party, wait through the whole upload on party wifi, and
     get a 413 at the end of it.

Every one of those was broken on purpose and watched go red before it was
trusted. Two of my own checks were wrong first and prove-checks caught both.

---

## Two things I found and deliberately did NOT change

**Seventeen places in the billing Worker read the request body without a
guard.** A malformed body there gives "Something went wrong on our end" instead
of "that request was malformed", which is the same shape as the token fault from
last week. Real browsers send valid JSON, so the impact is a confusing message
for a broken client, not a user-facing fault. Changing seventeen call sites in
the live billing Worker at three in the morning is not a trade I would make.
Worth doing in daylight.

**The admin dashboard lists at most 100 expiring licences** while the tile above
shows the true count. With ten licences in total that is a long way off, and the
number shown is honest. Noted, not fixed.

---

## Where the numbers landed

    local gate    210 checks, green
    live gate     126 checks, ONE RED: the www.partyplay.com.au redirect above
    mutations     every local check has one, each new one proved as it was added

A full sweep of every mutation is still running. Each check added tonight was
proved individually at the time.
