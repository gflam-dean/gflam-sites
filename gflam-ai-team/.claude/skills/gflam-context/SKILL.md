---
name: gflam-context
description: Core business and brand context for Dean's Gflam group of companies on the Gold Coast (Gflam Touring, Gflam Vending, The Mini Bar, Drag Bingo at the Bowlo, Gflam Party Hire, VenuePlay). Use this whenever the user mentions Gflam, any of their domains (gflamtouring.com.au, gflamvending.com.au, theminibar.com.au, dragbingoatthebowlo.com.au, gflampartyhire.com.au, venueplay.com.au), or any of their services (touring, event management, vending, party hire, drag bingo, venue entertainment software). Trigger even when the user just says "my website", "the touring site", or "the bingo page". Read this before answering anything Gflam-related.
---

# Gflam Group Context

Dean runs the Gflam group on the Gold Coast, Australia — an umbrella for several related businesses sharing infrastructure (GitHub repo `gflam-dean/gflam-sites`, Cloudflare account, one Supabase project `gpoolavkghnxedzrmtmc`).

## The brands

**Gflam Group** — gflam.com.au
Umbrella landing page. Hosts the "Join the Gflam family" group signup form (source: `gflam_group`).

**Gflam Touring** — gflamtouring.com.au
The flagship. Australia-wide event/touring company: promoter, production, tour management, event management, site management, event ops, contractor engagement, stakeholder liaison. Dean has a background touring large international acts and is building this toward national scale. Submitted for Local Buy Event Management Services LB292 (capability statement produced May 2026).

**Gflam Vending** — gflamvending.com.au
Vending machine business (including alcohol vending targeting hotels). Has its own logo — don't mix up with the touring logo. National hotel targeting database exists (~630 properties across all major hotel groups).

**Drag Bingo at the Bowlo** — dragbingoatthebowlo.com.au
Recurring drag bingo events with drag queen performers (Vollie Lavont, Mandy, ShuShu). Domain 301-redirects to `gflamtouring.com.au/drag-bingo-at-the-bowlo`. Has its own GA4 tag despite living on the touring site. Sold-out track record: Tugun Bowls Club campaign sold 245 tickets in ~4 weeks via Meta ads. Runs on a custom iPad DMX lighting app (see rig notes in memory — not a website concern).

**The Mini Bar** — theminibar.com.au
**Different colour palette to every other Gflam brand.** Don't apply the default Gflam colours to Mini Bar pages.

**Gflam Party Hire** — gflampartyhire.com.au (in development)
Party hire based in Oxenford: fairy floss, slushie, snowcone, popcorn machines. Currently on Booqable (~49 customers). Planned rebuild: Supabase + Stripe + Resend, $200 deposit, zoned delivery (Z1 $80 Oxenford/Coomera/Helensvale, Z2 $120 Surfers/Broadbeach/Robina, Z3 $150 Burleigh/Tweed), customer flavour login, reminder emails.

**VenuePlay** — venueplay.com.au (launches August 2026)
SaaS platform for pubs/clubs/bowls clubs to run live entertainment: bingo, trivia, musical bingo, raffles/members draws. Players join by phone (no app/login); game displays on any venue screen. Its own brand, its own Stripe account, its own skill — **read the `venueplay` skill for everything VenuePlay.** Public positioning: built by Gflam Touring, "who run bingo, live music and entertainment across Australia" — **never say "drag" in VenuePlay copy.**

## Group-wide conventions

- **Contact emails**: every brand uses `dean@[domain].com.au` + `hello@[domain].com.au`, both route to Dean.
- **Internal links between Gflam domains must use the `https://www.` prefix** (Cloudflare caching).
- **Web3Forms keys** (contact forms): Touring `37c805da`, Group `638ef064`, Vending `2dcf9c66`, Mini Bar `bf0c6bd0`, Drag Bingo `d8d3312d`, VenuePlay `1e59814a`. VenuePlay's contact form now routes via its Cloudflare Worker + Resend instead.
- **GA4 IDs**: Touring `G-V36EX4RX85`, Vending `G-9EJR7FC5NF`, Mini Bar `G-GJQ0JR0XF8`, Drag Bingo `G-F70HEE34EK`, Group `G-TV8NM65NYW`. VenuePlay: none yet.
- **Meta Pixels**: Touring `1597842404816132`, Vending `1484720969412139`.
- Verify IDs against the brand's `brand-info.md` in Drive when available; the values above are the last known-good set.

## Working with Dean — practical notes

- **Dean is non-technical** and works through chat (and now Claude Code, set up with these skills). Plain English. No jargon without explanation. One clear recommendation over a menu of options.
- **Always deliver files as downloadable/ready-to-commit files**, never pasted code in chat.
- He uploads to GitHub manually today; in Claude Code, commits/pushes are fine **once he's approved the work** (see the `ops-team` skill for the approval flow).
- **Don't promise memory you don't have.** If you don't know something, ask — don't pretend.
- **Skip excessive "are you sure?" check-ins** on clear requests.
- **The signup form on his sites is not optional** — never suggest removing it.
- When Dean states a technical fact about his own systems, treat it as ground truth.
- Dean expects accuracy over false confidence and will flag errors directly — do the same in return.
