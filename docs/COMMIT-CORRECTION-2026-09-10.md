# Correction: what commit 3b4acb0 really contains

Written 10 Sep 2026, straight after noticing it, rather than left for somebody to
find in six months.

`3b4acb0` is titled *The five songs go back in. Dean: "these guys are 18+ anyway"*.
That is true and it is about a tenth of what is in it. The same commit also carries:

* **19 packs re-ordered.** The best 20 chart additions in each pack moved from the
  tail up to positions 50 to 69, which took them from being dealt 11.9% of the time
  to 28.4% (measured over 1,500 simulated games a pack, against 23.6% for a song that
  was already there).
* **7 recordings swapped to the version a room actually sings:**

      Sorrow                    Bad Religion                   -> David Bowie
      Rock Me                   Great White                    -> ABBA
      Hurts So Good             Astrid S                       -> John Cougar
      The Real Thing            Client Liaison                 -> Russell Morris
      Harper Valley P.T.A.      Loretta Lynn                   -> Jeannie C. Riley
      Angel of the Morning      Melinda Schneider & Beccy Cole -> Juice Newton
      I Finally Found Someone   Lorrie Morgan & Sammy Kershaw  -> Barbra Streisand

Every one of those is correct and intended. Dean had approved all of it. The fault is
only in the record: an agent was writing to `musical-library.json` while I was working
in the same repo, and I staged the file BY NAME and wrote a message describing what I
had changed rather than what the file contained.

**The rule that comes out of it: diff a file before staging it, not after.** Especially
while an agent is working, which in this repo is most of the time. `git add <path>` is
a statement about bytes, not about intent, and a commit message that describes intent
while the bytes say something else is how a history stops being worth reading.

History is not rewritten here. `main` is pushed and a live site deploys from it, and
rewriting a pushed branch to tidy a message is a worse trade than this note.
