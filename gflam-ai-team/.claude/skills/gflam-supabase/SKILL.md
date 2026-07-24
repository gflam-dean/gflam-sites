---
name: gflam-supabase
description: Supabase backend patterns shared across all Gflam group websites and the ops system. Use whenever the user mentions Supabase, signups, signup forms, the shows table, reviews, founding venues, the venue counter, ops/approvals/dashboard tables, or "Gflam Show Manager". Trigger for indirect mentions too ("the form isn't working", "where do I see the signups", "the counter's wrong"). Read before writing any code that touches Supabase for Dean's sites.
---

# Gflam Supabase Integration

One shared Supabase project for everything. `source` differentiates sites.

## Project

- **Ref**: `gpoolavkghnxedzrmtmc` · **URL**: `https://gpoolavkghnxedzrmtmc.supabase.co`
- **Anon key**: public client-side JWT; copy from any live page source (`var _SBK = '...'`). Security is RLS, not key secrecy.
- **service_role key**: server-side only (Workers, agents, Claude Code env). NEVER in page source.

## Tables

### `signups` (shared, all brands)
`first_name, mobile, email, postcode, source, signup_type` + id/created_at.
Source values: `gflam_group`, `touring`, `vending`, `drag_bingo`, `party_hire` (verify in view WHERE clauses). Mini Bar: no view yet — confirm before wiring.

### `shows`, `artists`, `show_artists`, `venues`, `reviews`
Touring/drag-bingo event data. Front-ends query the views, not raw tables:
`v_shows_full`, `v_touring_shows`, `v_drag_bingo_shows`; signups via `v_signups_all` / `v_signups_touring` / `v_signups_vending` / `v_signups_drag_bingo` / `v_signups_party_hire`.

### `contacts`
Possible contact-form destination; most brands use Web3Forms instead. Confirm columns before use.

### `venueplay_founding` (VenuePlay — RLS locked, no anon policies)
`venue_name, contact_email, mobile, postcode, max_seats, plan (monthly|annual), marketing_opt_in, status (pending|card_on_file|active|cancelled), stripe_customer_id, stripe_subscription_id, logo_url, show_on_wall`.
Written ONLY by the VenuePlay Worker with service_role. Browsers read via two RPCs:
- `venueplay_spots_taken()` → integer count where status in (card_on_file, active). Powers the 100-spot counter. Counts committed cards, not leads.
- `venueplay_wall()` → (venue_name, logo_url) where show_on_wall AND logo_url set. Powers the launch logo wall.

### Ops tables (`ops_priorities`, `ops_questions`, `ops_approvals`)
Power the Gflam HQ dashboard + agent workflow. Schema and rules in the `ops-team` skill; SQL in `supabase/ops-setup.sql`.

## Client snippet pattern

```html
<script>
var _SBU = 'https://gpoolavkghnxedzrmtmc.supabase.co';
var _SBK = '<anon-jwt>';
var _SBH = { 'apikey': _SBK, 'Authorization': 'Bearer ' + _SBK, 'Content-Type': 'application/json' };
</script>
```
Signup form IDs: `gsfa` first name, `gsfb` mobile, `gsfc` email, `gsfd` postcode, `gsf` wrapper, `gsfz` success. POST to `/rest/v1/signups` with the brand's `source`.

## Fetch rules

- Shows: use the per-site view, `?order=date.asc`. **Always** wire the empty/error fallback ("No shows currently on sale") — never leave "Loading...".
- Exact counts: RPC preferred (like `venueplay_spots_taken`) over exposing row reads.
- Server-side writes (Workers/agents): service_role key + `Prefer: return=representation` when you need the row back.

## Gflam Show Manager

`manage.html` on the touring site, branded "Gflam Show Manager". Add/edit/archive shows, edit reviews, manage status. Supabase email/password auth; anon reads allowed on shows/reviews, writes need an authed session.

## Where Dean views data

Supabase → Table Editor → the relevant view/table → "..." → Download CSV.
