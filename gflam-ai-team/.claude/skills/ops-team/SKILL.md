---
name: ops-team
description: How Dean's AI team operates — the approval workflow, questions queue, daily priorities, and the Supabase ops tables behind the Gflam HQ dashboard. Use whenever running the daily standup, submitting work for approval, publishing approved work, asking Dean a question, or anything involving ops_priorities, ops_questions, ops_approvals, or the HQ dashboard. Every agent must follow this. Read at the start of any agent run.
---

# Gflam AI Team — Operating System

## The golden rules

1. **Nothing publishes without Dean's approval.** No post goes out, no page goes live, no email sends, no git push to main, until the item's row in `ops_approvals` has `status = 'approved'`. No exceptions while approval mode is on.
2. **Don't block on questions.** If something's unknown, log a question in `ops_questions`, mark the affected work `[PLACEHOLDER]`, and keep moving on other tasks.
3. **Don't spend money or commit Dean to anything** (ads, purchases, contracts, replies promising dates/prices) without an approved item covering it.
4. **Facts come from skills, Supabase, or Dean** — never invented. Prices, dates, keys, and IDs are in the brand skills.

## The ops tables (shared Supabase project)

Writes use env vars `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` (set in Claude Code's environment). Never hardcode the service key in any file.

### `ops_priorities`
One row per priority per day. `day (date), rank (1-3), business, title, why, status (open|done)`.
The chief-of-staff writes today's top 3 each morning; Dean sees them on the dashboard.

### `ops_questions`
`agent, business, question, context, status (open|answered), answer`.
Agents INSERT with status open. Dean answers in the dashboard (status flips to answered). At the start of every run, agents READ their answered questions and act on them, then set status to `closed`.

### `ops_approvals`
`agent, business, type (facebook_post|instagram_post|email|web_edit|document|ad_copy|other), title, content, notes, publish_target, suggested_date, status (pending|approved|rejected|published), decision_note`.
Agents INSERT finished work as pending with the FINAL ready-to-publish content in `content` (for web edits: the repo path + a summary + branch name in `notes`, full diff committed to a branch, never main). Dean approves/rejects in the dashboard, optionally with a decision_note. Rejected items: read the decision_note, revise, resubmit as a new pending row referencing the old one.

## Publishing approved work

On "publish approved work" (or during the standup), the main session:
1. Fetches `ops_approvals` where status = approved.
2. **web_edit** → merge the branch / apply the change to the repo, push, verify Cloudflare deploy, set status published.
3. **facebook_post / instagram_post** → no Meta API connected yet: present the final text + image notes to Dean as copy-paste-ready, set status published once he confirms it's posted. (If Meta Graph API creds are added later as env vars, post directly then mark published.)
4. **email** → if Resend creds exist and the item explicitly says send, send via Resend; otherwise present ready-to-send.
5. Anything unclear → question, not action.

## Daily standup ("start my day")

The chief-of-staff agent runs this. Output order:
1. **Top 3 priorities today** (written to ops_priorities): chosen across ALL businesses by revenue impact and deadline. VenuePlay launch-critical items outrank routine marketing until launch.
2. **Answers needed**: open ops_questions, grouped by agent, each with a one-line why-it-matters.
3. **Approval queue**: pending ops_approvals count + one-line summaries.
4. **Yesterday's published work** confirmation.
Keep the whole standup under 30 lines. Dean reads this in the dashboard or terminal.

## Approval mode

Currently **ON** (everything queues). When Dean says to relax it for a category (e.g. "drag bingo FB posts no longer need approval"), record that in this skill file by editing the list below, and only then may that category publish directly.

Categories exempt from approval: (none yet)

## Curl patterns (for agents)

```bash
# Insert an approval item
curl -s -X POST "$SUPABASE_URL/rest/v1/ops_approvals" \
  -H "apikey: $SUPABASE_SERVICE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"agent":"marketing","business":"drag_bingo","type":"facebook_post","title":"Oct 24 Southport announce","content":"<final text>","publish_target":"Drag Bingo at the Bowlo FB page","suggested_date":"2026-07-10","status":"pending"}'

# Read my answered questions
curl -s "$SUPABASE_URL/rest/v1/ops_questions?agent=eq.marketing&status=eq.answered" \
  -H "apikey: $SUPABASE_SERVICE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_KEY"
```
