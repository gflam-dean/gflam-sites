---
name: gflam-websites
description: Conventions and patterns for editing the Gflam group's static HTML websites (touring, vending, mini bar, drag bingo, group, party hire, venueplay). Use whenever editing, fixing, styling, adding tracking to, or modifying any Gflam HTML file — including small fixes like "fix this link", "add Google Analytics", "centre the shows", "fix this console error". Trigger even when the user just says "the website" or pastes an HTML file, if context suggests a Gflam site (look for _SBU/_SBK Supabase variables, gflam in URLs, "Join the Gflam family"). Required reading before editing any Gflam HTML.
---

# Gflam Websites — Edit Conventions

## Tech stack

- **Plain HTML files** — no React, no build step. Single-file pages: inline `<style>`, inline `<script>` at the end.
- **Hosting**: GitHub `gflam-dean/gflam-sites` → Cloudflare Pages (auto-deploys on push to main).
- **Backend**: one shared Supabase project (see `gflam-supabase` skill). VenuePlay additionally has its own Cloudflare Worker (see `venueplay` skill).
- **Source of truth**: Google Drive — one main "current sites" folder (all latest HTML together) + per-brand folders each holding the logo and a `brand-info.md` (GA4, Pixel, source value, notes). Read `brand-info.md` before editing; don't substitute IDs between brands.

## Workflow

1. Identify the brand from context.
2. Read its `brand-info.md` (or the ID table in `gflam-context`).
3. Find the HTML: user upload first, then Drive current-sites folder, then the repo.
4. Copy to a writable location before editing.
5. In chat: deliver via outputs + present_files. In Claude Code: edit in the repo working copy; commit/push only per the `ops-team` approval flow.

## Layout conventions

### Shows / events grid (touring + drag bingo)
Count-based centring: 1–2 centred single row; 3 across; 4 as 2×2; 5+ three per row. Add a `count-N` class to the grid container in JS from `shows.length`. Mobile ≤900px collapses to 2 columns.

### "How It Works" 5-step (drag bingo)
`grid-template-columns: repeat(5, 1fr)`, max-width 1100px, gap 32px. **Never `auto-fill`/`minmax`** — phantom-column zigzag bug, already burned once.

### Cross-links
Always `https://www.` prefix between Gflam domains.

### Logos & colours
Each brand its own logo. All brands share the default palette EXCEPT The Mini Bar (own palette) and VenuePlay (own brand system — see `venueplay` skill).

## Copy rules

- **No em dashes in site copy.** Dean has done full em-dash sweeps across all brands; use commas, colons, or restructure. Don't reintroduce them.
- VenuePlay copy: never "drag"; "who run bingo, live music and entertainment across Australia."

## Tracking snippets

GA4 gtag.js + Meta Pixel go in `<head>` right after the opening tag, per-brand IDs from `brand-info.md`. "Add to every page" means every HTML file in the bundle. Standard snippets:

```html
<script async src="https://www.googletagmanager.com/gtag/js?id=G-XXXXXXXXXX"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'G-XXXXXXXXXX');
</script>
```
Meta Pixel: standard fbevents.js snippet with the brand's pixel ID + noscript img.

## Contact forms

Most brands: **Web3Forms** (`https://api.web3forms.com/submit`, POST JSON with the brand's `access_key` — keys in `gflam-context`). VenuePlay: posts to its Worker `/contact` (Resend). Every form needs client-side validation and a success state; never leave a dead button.

## Common pitfalls (already burned)

1. `var _SBU= + SBU + ;` — stripped PHP template remnant; replace with real JS string literals.
2. "Loading shows..." stuck — always wire empty/error fallback to "No shows currently on sale".
3. auto-fill grid zigzag — explicit `repeat(N, 1fr)`.
4. Cloudflare 404 on a working domain — check nameservers at the registrar first.
5. SBU/SBK are identical across sites (one project); `source` differentiates.

## Domain redirects

`dragbingoatthebowlo.com.au` → `https://gflamtouring.com.au/drag-bingo-at-the-bowlo` (301) via Cloudflare Redirect Rules.

## VenuePlay pages (see `venueplay` skill for full detail)

`index.html` (founding landing: Stripe checkout, live 100-spot counter, venue wall, contact), `terms.html`, `privacy.html`. Its Worker base: `https://venueplay-api.dean-tindale.workers.dev`.
