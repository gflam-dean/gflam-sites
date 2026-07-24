# Gflam AI Team — Setup (plain English)

You're setting up three things: a folder Claude Code works in, two Supabase bits, and your dashboard. Fifteen minutes, one time.

## 1. Install Claude Code
Follow the official steps at https://docs.claude.com/en/docs/claude-code/overview (they change occasionally, so use the live page rather than anything written here). Easiest path on Mac: install the Claude Desktop app and use the Code tab, or ask Claude Code's own installer page. Sign in with your Claude account.

## 2. Put this folder somewhere permanent
Unzip `gflam-ai-team` into your home folder (so it lives at `~/gflam-ai-team`). Don't rename the hidden `.claude` folder inside — that's where the skills and agents live, and Claude Code finds them automatically when you open this folder.

## 3. Run the ops SQL (once)
Supabase → SQL Editor → New query → paste everything from `supabase/ops-setup.sql` → Run. This creates the three tables the dashboard and agents share (priorities, questions, approvals).

## 4. Switch on the dashboard
Open `dashboard/gflam-hq.html` in a text editor (TextEdit is fine), find `ANON_KEY = 'PASTE_ANON_KEY_HERE'` near the bottom, paste your Supabase anon key (Supabase → Settings → API → "anon public"), save. Then double-click the file — it opens in your browser. Bookmark it. **Keep this file on your computer; don't upload it to GitHub or the web.**

## 5. Give Claude Code the two keys
In Claude Code, opened in the `gflam-ai-team` folder, say:

> "Set up my environment: SUPABASE_URL is https://gpoolavkghnxedzrmtmc.supabase.co and here is my SUPABASE_SERVICE_KEY: (paste the service_role key from Supabase → Settings → API)."

Claude Code will store them properly for this project and confirm. (The service key is the powerful one — it only ever lives here, never in a file that goes online.)

## 6. Optional but recommended
Ask Claude Code: "Clone gflam-dean/gflam-sites into the sites folder" so the team can work on your websites directly. It'll walk you through connecting GitHub the first time.

## Daily use
- Morning: open Claude Code in this folder, type **start my day**. Open the dashboard: your top 3, any questions to answer, anything waiting for approval.
- Approve/reject/answer in the dashboard whenever suits.
- Then type **publish approved work** in Claude Code — it pushes approved website changes and hands you approved posts ready to paste into Facebook.
- Anytime: "marketing, write me three posts for the Oct 24 Southport show" / "sales-research, find bowls clubs near Brisbane for VenuePlay" / "customer-service, reply to this email: ..."

## What the team can and can't do yet
- CAN: research the web, write everything, edit and (once approved) publish your websites, keep your pipeline and databases current.
- CAN'T yet: post directly to Facebook/Instagram (needs Meta API access — later job), send email (until Resend is set up), or run while your computer's off. "Background" work happens when you kick off a run; we can schedule automatic morning runs later if you want.
- Approval mode is ON for everything. When you trust a category, tell Claude Code to exempt it and it updates the ops-team skill.
