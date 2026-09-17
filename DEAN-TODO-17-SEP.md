# What is yours to do, 17 September (evening)

Rewritten tonight. Everything here needs a login I do not have. Ordered by value.

**Done since this morning, nothing for you here:** the four signup views that were
handing out email and mobile to the public key (both revokes run and verified), the
four VenuePlay views tightened, the whole Supabase exposure survey, the 20 image cap,
the printables back button, the prizes tally, the bucket noise.

---

## 1. Two replies are written and waiting on you                        10 min

**`~/venue-enrich/REPLY-lunatic-hotel.md`** — a real prospect, first reply, unanswered
since 17 Sep 10:51am. The price is checked and correct: NSW, $2.50, so 30 players is
$75. Send it from **Kayla's** mailbox, not a new thread.

**`~/venue-enrich/REPLY-TO-JOSEPH.md`** — I rewrote this one tonight. **Read the note at
the top before you send it.** The old version accused Instantly of rewriting your
campaign copy. It was wrong, and it was the one claim Joseph could have disproved in
thirty seconds, which would have cost you the two claims that are strong. Attachments
are both in `~/venue-enrich/`.

---

## 2. Tick one box in Resend                                             2 min

Resend -> Webhooks -> your endpoint -> edit events. THREE ticked:

    email.bounced
    email.complained
    email.delivered        <- the new one

The Worker is deployed and listening for the third. Without the tick it hears nothing
and we stay unable to tell "arrived" from "never arrived".

Leave `email.sent`, `email.opened` and `email.clicked` UNticked. They fire on every
email we ever send and would bury the audit trail.

---

## 3. The junk email's headers                                           2 min

Still the one that unblocks me. Outlook, the junked "Saturday is your last day on
VenuePlay":

  - **outlook.com in a browser:** open it, three dots at the top right OF THE MESSAGE,
    then View -> View message source
  - **New Outlook or the Mac app:** open it, three dots, View -> View message source
  - **Classic Outlook desktop:** double-click to open in its own window, then
    File -> Properties -> the Internet headers box at the bottom

Send me the one line starting `Authentication-Results:`.

  - all three pass -> reputation problem, slow and boring fix
  - any one fails -> the transactional setup is broken and our own p=quarantine is
    junking it, which matters far more, because it is the same domain your venues get
    invoices from

---

## 4. The mailboxes. Today.                                             20 min

**Full detail and the exact DNS records: `~/venue-enrich/HOSTINGER-MAIL-SETTINGS.md`.**

Short version, and read this before you start:

  - you already have **exactly three mailboxes per domain**, nine across three. Three
    per domain is the right number. Six more on those same three makes it five each,
    which is the shape that gets a domain flagged
  - **Hostinger's own relay is the thing that is currently broken.** Eight of ten warmup
    sends refused, 550 5.7.1, unresolved, and the whole reason for the Joseph letter.
    The Outlook ones go on Exchange Online and have nothing to do with it
  - so: **all twelve on Outlook**, or six Outlook now and hold the Hostinger six until
    Joseph answers. If you want them anyway, put them on **two new domains**, three each
  - **either way, make them today.** Made today, usable 1 to 8 October. Made Monday,
    usable 8 to 15, which eats half the month

---

## 5. DMARC reporting on the three cold domains                         10 min

I checked the live DNS tonight. MX, SPF and DKIM are all correct on all three and
should not be touched. The one thing missing is reporting.

**hpanel.hostinger.com -> Domains -> (the domain) -> DNS / Nameservers -> DNS records.**
Replace the value of the TXT record named `_dmarc`:

**getvenueplay.com.au**

    v=DMARC1; p=reject; adkim=r; aspf=r; rua=mailto:dmarc@getvenueplay.com.au

**venueplay.online**

    v=DMARC1; p=reject; adkim=r; aspf=r; rua=mailto:dmarc@venueplay.online

**getpartyplay.com.au**

    v=DMARC1; p=reject; adkim=r; aspf=r; rua=mailto:dmarc@getpartyplay.com.au

Each points at ITS OWN domain on purpose. Then **Emails -> (the domain)**: add `dmarc@`
as a **forwarder or alias** to an inbox you read. Not three real mailboxes. Without the
alias the reports bounce and you have gained nothing.

---

## 6. Two minutes in the Instantly campaign editor                       2 min

The campaigns use `{{company_name}}`. The field Instantly actually fills is
`companyName`, so it renders **blank** and the venue's name is missing from the email.
It is still `{{company_name}}` in `load-campaigns.py` and in the campaign backup.

If the live campaigns were never corrected, every cold email going out right now has a
hole where the venue's name should be. I cannot see them without your login.

---

## 7. Check one alias exists                                             1 min

You changed venueplay.com.au's DMARC to `rua=mailto:dmarc@venueplay.com.au`. That
address has to exist or the reports bounce. Migadu -> venueplay.com.au -> add `dmarc`
as an alias to your real inbox, if it is not there.

---

## 8. The bounce test, if there is time                                  3 min

In YOUR Terminal, not through me, so the key stays out of the transcript. Replace the
key:

    curl -X POST https://api.resend.com/emails \
      -H "Authorization: Bearer re_YOUR_KEY_HERE" \
      -H "Content-Type: application/json" \
      -d '{"from":"VenuePlay <hello@send.venueplay.com.au>","to":["bounced@resend.dev"],"subject":"Friday is your last day on VenuePlay","html":"<p>bounce test</p>"}'

`bounced@resend.dev` is Resend's own simulator. No real person is emailed. That subject
exercises the LOUD path, the one that emails you "ACTION NEEDED". Tell me when you have
and I will check the audit trail from this end.

---

## Not today

**The 1024-bit DKIM keys.** Both transactional domains sign with 1024-bit keys while the
cold domains use 2048. It still passes, but RFC 8301 has said use 2048 since 2018 and
both Google and Microsoft treat 1024 as a weak signal. Fixing it means removing and
re-adding the domain in Resend for a fresh key, then living through re-verification.
Not a thing to start on a selling day.

**partyplay.com.au and theminibar.com.au** still send DMARC reports to a registrar
address you have never read. Same fix as item 5 but in Cloudflare. Low value next to the
cold domains.

**The three shows views are still SECURITY DEFINER** and the advisor will keep flagging
them. They hold no personal data and they paint the public What's On pages. Switching
them to invoker without checking the policies on `shows` and `venues` first would take
the shows off the websites with no error anywhere. Leave the warnings standing.
