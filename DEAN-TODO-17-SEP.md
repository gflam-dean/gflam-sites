# What is yours to do, 17 September

Ordered by value, with the time each takes. Everything here needs a login I do not have.
Copy the values exactly: the long DNS strings are the easy ones to mistype.

---

## 1. Read the two replies                                                  5 min

Rhys and Sarah have one reply each, from three emails sent between them. First real
responses to the cold campaign. Everything else on this page can wait behind that.

Instantly -> Inbox.

---

## 2. Tick one box in Resend                                                 2 min

Resend -> Webhooks -> your endpoint -> edit events. It should have THREE ticked:

    email.bounced
    email.complained
    email.delivered        <- the new one

The Worker is deployed and listening for the third. Without the tick it hears nothing,
and we stay unable to tell "arrived" from "never arrived", which is what caught us out
with the Praze The Roof email this morning.

Leave `email.sent`, `email.opened` and `email.clicked` UNticked. They fire on every email
we ever send and would bury the audit trail.

---

## 3. The junk email's headers                                              2 min

This is the one that unblocks me, and it decides which of two very different jobs is next.

Outlook, the junked "Saturday is your last day on VenuePlay":

  - **outlook.com in a browser:** open it, three dots at the top right OF THE MESSAGE,
    then View -> View message source
  - **New Outlook or the Mac app:** open it, three dots, View -> View message source
  - **Classic Outlook desktop:** double-click to open in its own window, then
    File -> Properties -> the Internet headers box at the bottom

Find the line starting `Authentication-Results:` and send me that one line.

  - all three pass (spf, dkim, dmarc) -> reputation problem, and the fix is slow and boring
  - any one fails -> the transactional setup is broken, and our own p=quarantine is what
    is putting it in junk. That would matter far more than a goodbye email: it is the same
    domain your venues get invoices from.

---

## 4. DMARC reporting on the three cold domains                            10 min

The domains the cold campaign sends from are set to `p=reject` with NO reporting at all.
So if Microsoft is rejecting Ellie's mail on authentication, nothing anywhere tells us.
That is the one set of domains where we KNOW deliverability is broken, and the one set we
are blind on.

**hpanel.hostinger.com -> Domains -> (the domain) -> DNS / Nameservers -> DNS records.**
Find the TXT record named `_dmarc` and replace its value.

**getvenueplay.com.au**

    v=DMARC1; p=reject; adkim=r; aspf=r; rua=mailto:dmarc@getvenueplay.com.au

**venueplay.online**

    v=DMARC1; p=reject; adkim=r; aspf=r; rua=mailto:dmarc@venueplay.online

**getpartyplay.com.au**

    v=DMARC1; p=reject; adkim=r; aspf=r; rua=mailto:dmarc@getpartyplay.com.au

Each points at ITS OWN domain on purpose. Point them all at venueplay.com.au instead and
every receiver silently bins the reports, unless you also add three authorisation records
in Cloudflare. Same-domain avoids the whole problem.

Then, same panel, **Emails -> (the domain)**: add `dmarc@` as a **forwarder or alias** to
whatever inbox you actually read. Do NOT create three real mailboxes, an alias is enough.
Without one the reports bounce and you have gained nothing.

---

## 5. Check one alias exists                                                1 min

You changed venueplay.com.au's DMARC to `rua=mailto:dmarc@venueplay.com.au` earlier. That
address has to exist or the reports you just redirected will bounce.

Migadu -> venueplay.com.au -> add `dmarc` as an alias to your real inbox, if it is not
already there.

---

## 6. Make the mailboxes. Today.                                          20 min

**You have had the domains since Monday, so the clock that matters has not started.**

Domain age was never the binding constraint: those are three days old already and will be
seventeen by 1 October. The MAILBOX is the thing that is useless for 14 to 21 days after it
is made, and not one of the eighteen exists yet.

    made today, 17 Sep   ->  usable 1 to 8 October    fits October
    made next Monday     ->  usable 8 to 15 October   eats half the month

**And the thing that was holding this up does not apply.** The reason to wait was
MailChannels blocking Hostinger's outbound relay. The plan in MICROSOFT-365-SETUP.md puts
these eighteen on **Exchange Online**, which has nothing to do with MailChannels, nothing to
do with Hostinger, and nothing to do with the blocks. I told you this morning to buy domains
and hold off on mailboxes. That was right for Hostinger mailboxes and wrong for these.

So: build them. `MICROSOFT-365-SETUP.md` has the steps. Three per domain, no more.

**Still worth asking Instantly**, but it no longer gates anything:

> Have the MailChannels relay blocks on our Hostinger sending cleared? And can you send us
> the raw block reason from the 8 of 10 warmup sends that were refused?

That answer decides what happens to the NINE EXISTING Hostinger mailboxes, not the new
eighteen. Warmup is currently off on all nine, which is what Instantly asked for, and the
campaigns are sending anyway.

---

## 7. The bounce test, if there is time                                     3 min

In YOUR Terminal, not through me, so the key stays out of the transcript. Replace the key:

    curl -X POST https://api.resend.com/emails \
      -H "Authorization: Bearer re_YOUR_KEY_HERE" \
      -H "Content-Type: application/json" \
      -d '{"from":"VenuePlay <hello@send.venueplay.com.au>","to":["bounced@resend.dev"],"subject":"Friday is your last day on VenuePlay","html":"<p>bounce test</p>"}'

`bounced@resend.dev` is Resend's own simulator. No real person is emailed. That subject is
deliberate: it exercises the LOUD path, the one that emails you "ACTION NEEDED". Tell me
when you have and I will check the audit trail from this end.

---

## Not today

**The 1024-bit DKIM keys.** Both transactional domains sign with 1024-bit keys while your
cold domains use 2048. It still passes, but RFC 8301 has said use 2048 since 2018 and both
Google and Microsoft treat 1024 as a weak signal. Fixing it means removing and re-adding
the domain in Resend to get a fresh key, then living through re-verification. Not a thing
to start on a selling day.

**partyplay.com.au and theminibar.com.au** still send their DMARC reports to a registrar
address you have never read. Same fix as item 4 but in Cloudflare. Low value next to the
cold domains.
