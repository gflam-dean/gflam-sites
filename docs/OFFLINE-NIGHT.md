# A venue loses the internet, and the night carries on

On the list, not built. Dean asked for it on 10 Sep 2026 after working out that the
room server does not help here, which is correct.

## The thing people assume, and why it is wrong

The room server and Supabase Realtime are both on the internet. The host's tablet,
the TV and forty phones are all on the venue's wifi, but they never speak to each
other directly: every message goes out to a server and comes back. So when a venue
loses its connection, both roads are gone at once and it makes no difference which
one it was using.

    the room server has a bad night   -> every page quietly falls back to Supabase
    we break something with a deploy  -> ROOM_OFF=1 and the country is back in seconds
    THE VENUE LOSES THE INTERNET      -> nothing helps, the night stops

## What actually happens today

Bingo degrades best and still not well. The console gives up on the server draw and
calls the rest of the game from the tablet ("Calling from this tablet for the rest of
this game"), so a host with paper tickets can keep going by voice. But the TV stops
following and every phone goes quiet, because the ball still has to travel through a
server to reach them.

Trivia and musical bingo stop, because the questions, the answers and the scoring all
go through the Worker.

## What it would take

The host's tablet becomes the room. Phones and the TV connect to it directly over the
venue's own wifi instead of out to Cloudflare, and the night carries on with no
internet at all. When the connection comes back, the tablet sends up what happened so
the night is still counted and still billed.

The hard parts, honestly:

* **Phones have to find the tablet.** A browser cannot be handed a local address by
  magic. This probably means the tablet serving a page over the local network and the
  phones being sent to it, which is a QR code on the wall changing while the internet
  is down. Nobody has to type an address; they scan the same code they always do.
* **The ball order is a compliance question.** The RNG that decides bingo balls is
  server side ON PURPOSE, and the OLGR submission depends on it staying there
  (see the RNG standard note). A tablet drawing its own balls is a different machine
  drawing the numbers, and that needs to be asked about before it is built, not after.
  A safe answer may be to draw the whole night's order server-side in advance, sealed,
  and let the tablet reveal it: the order is still the approved generator's.
* **Billing has to survive it.** Players who joined offline still count. The tablet
  holds them and posts them when it can, and the join dedup has to not double count
  anyone who was already in before the connection dropped.
* **It must never make a good night worse.** Whatever this is, it cannot add a failure
  path to a venue whose internet is fine, which is the same rule the room server
  follows: no binding, no change.

## Why it is worth doing

For a pub in a country town on a bad NBN day it is the difference between losing a
night and losing ten minutes. It is also the kind of thing a venue tells other venues
about.

## Where it sits

Behind the room server going live for everyone, and behind Sydney. Nothing about it
is urgent, and it should not be started until a room has carried real nights and we
know what normal looks like.
