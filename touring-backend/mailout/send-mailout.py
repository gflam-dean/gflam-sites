#!/usr/bin/env python3
"""Send the Drag Bingo at the Bowlo mail-out through Resend.

    python3 send-mailout.py tickets.csv [more.csv ...]            dry run: counts, dedupes, shows 3 samples
    python3 send-mailout.py tickets.csv --test you@example.com    sends ONE real email to that address
    python3 send-mailout.py tickets.csv --go                      sends to everyone
    --dir PATH    where suppress.txt and sent.csv live (default ~/Desktop/drag-bingo-mailout)

Needs RESEND_API_KEY in ~/.gflam-migrate.env (never in chat) and a VERIFIED sending domain in Resend.
Reads any Moshtix/Oztix export: it finds the email and first-name columns by name, whatever the
header says. Dedupes on email, skips rows in suppress.txt (one address per line: unsubscribes and
bounces), sends in batches of 100, and writes sent.csv so a re-run never sends twice.

ONE-CLICK UNSUBSCRIBE (26 Oct 2026, Dean: "why's it not a link that you click and it
automates it"). Every email carries a signed https link in the footer and the List-Unsubscribe
(https + mailto) and List-Unsubscribe-Post headers, all from touring-backend/lib/gflam_unsub.py.
Before ANY send it skips every address with gflam_customers.unsubscribed_at set, as well as
suppress.txt and sent.csv. It will not send at all if it cannot read that list, if
GFLAM_UNSUB_SECRET is not in ~/.gflam-migrate.env, or if the live touring-api does not accept
a link it made (the preflight). A dry run reads the list too and prints the headers.
"""
import csv, json, os, re, sys, time, urllib.request, html

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'lib'))
import gflam_unsub   # touring-backend/lib: the one place the link, headers and token are made

HERE = os.path.expanduser('~/Desktop/drag-bingo-mailout')   # data files; --dir overrides
CAMPAIGN = 'dragbingo-oct24'   # labels where an unsubscribe came from; letters, digits, dashes
FROM = 'Drag Bingo at the Bowlo <hello@send.gflamtouring.com.au>'   # send.* is the domain verified in Resend; replies go to hello@gflamtouring.com.au
REPLY_TO = 'hello@gflamtouring.com.au'
SUBJECT = 'Oi. We want you back at the Bowlo.'
TICKETS = 'https://moshtix.com.au/v2/event/drag-bingo-at-the-bowlo-tugun/192697?ref=gflamemail'
ABN = '35 679 383 049'

def body_text(first, unsub):
    return f"""Hi {first},

You came to the last Drag Bingo at the Bowlo, and the night was better for it. The girls have been asking after you, so we are doing it all again.

Saturday 24 October, Tugun Bowls Club. Vollie LaVont is hosting, with ShuShu Funtanna and Scarlett Fever. Bingo, dabbers, prizes, and more sequins than is strictly necessary.

Doors 5.30pm. Show 7pm. Tickets $30 plus booking fee.

It is general admission, so no reserved seats and no excuses. Get in early, grab a table with your mates, order a meal and a drink, and be sitting down before the first ball. The girls do not wait, and they will absolutely notice if you walk in late.

Get your tickets: {TICKETS}

Last time went off. This one is bigger. Bring the friend who swore they would come next time.

See you at the Bowlo.

The Drag Bingo at the Bowlo crew
Gflam Touring

Gflam Touring, ABN {ABN}, Gold Coast QLD. You are receiving this because you bought a ticket to a previous Drag Bingo at the Bowlo show. Not keen on these emails? Unsubscribe in one click: {unsub}
"""

def body_html(first, unsub_html):
    f = html.escape(first)
    p = lambda s: f'<p style="margin:0 0 16px;font:16px/1.5 -apple-system,Helvetica,Arial,sans-serif;color:#222">{s}</p>'
    return (
        '<div style="max-width:560px;margin:0 auto;padding:24px 20px;background:#fff">'
        + p(f'Hi {f},')
        + p('You came to the last Drag Bingo at the Bowlo, and the night was better for it. The girls have been asking after you, so we are doing it all again.')
        + p('<b>Saturday 24 October, Tugun Bowls Club.</b> Vollie LaVont is hosting, with ShuShu Funtanna and Scarlett Fever. Bingo, dabbers, prizes, and more sequins than is strictly necessary.')
        + p('<b>Doors 5.30pm. Show 7pm. Tickets $30 plus booking fee.</b>')
        + p('It is general admission, so no reserved seats and no excuses. Get in early, grab a table with your mates, order a meal and a drink, and be sitting down before the first ball. The girls do not wait, and they will absolutely notice if you walk in late.')
        + f'<p style="margin:24px 0"><a href="{TICKETS}" style="display:inline-block;background:#e91e8c;color:#fff;text-decoration:none;font:700 17px -apple-system,Helvetica,Arial,sans-serif;padding:14px 26px;border-radius:8px">Get your tickets</a></p>'
        + p('Last time went off. This one is bigger. Bring the friend who swore they would come next time.')
        + p('See you at the Bowlo.')
        + p('The Drag Bingo at the Bowlo crew<br>Gflam Touring')
        + f'<p style="margin:28px 0 0;font:12px/1.5 -apple-system,Helvetica,Arial,sans-serif;color:#777">Gflam Touring, ABN {ABN}, Gold Coast QLD. You are receiving this because you bought a ticket to a previous Drag Bingo at the Bowlo show. Not keen on these emails? {unsub_html}</p>'
        + '</div>'
    )

def rows_of(path):
    # Moshtix exports come as .xlsx; CSV works too. Yields (fieldnames, dict rows).
    if path.lower().endswith(('.xlsx', '.xlsm')):
        import openpyxl
        ws = openpyxl.load_workbook(path, read_only=True).worksheets[0]
        it = ws.iter_rows(values_only=True)
        heads = [str(h or '').strip() for h in next(it)]
        return heads, ({h: ('' if v is None else str(v)) for h, v in zip(heads, r)} for r in it)
    fh = open(path, newline='', encoding='utf-8-sig')
    rd = csv.DictReader(fh)
    return list(rd.fieldnames or []), rd

def load_rows(paths):
    people = {}
    for path in paths:
        if True:
            heads, rd = rows_of(path)
            cols = {c.lower().strip(): c for c in heads}
            # Moshtix marks marketing consent per buyer: only people who ticked it are emailed.
            subcol = next((cols[c] for c in cols if 'subscribed' in c), None)
            ecol = next((cols[c] for c in cols if 'email' in c), None)
            fcol = next((cols[c] for c in cols if 'first' in c), None) or next((cols[c] for c in cols if c in ('name', 'customer name', 'purchaser name')), None)
            if not ecol:
                sys.exit(f'{path}: no email column (headers: {heads})')
            for row in rd:
                if subcol and (row.get(subcol) or '').strip().lower() not in ('yes', 'true', '1', 'y'):
                    continue
                e = (row.get(ecol) or '').strip().lower()
                if not re.match(r'^[^@\s]+@[^@\s]+\.[a-z]{2,}$', e):
                    continue
                first = (row.get(fcol) or '').strip().split(' ')[0].title() if fcol else ''
                if e not in people:
                    people[e] = first or 'there'
    return people

def read_list(name):
    p = os.path.join(HERE, name)
    if not os.path.exists(p): return set()
    # The FIRST field only. sent.csv lines are "email,id,at", and until 26 Oct 2026 the whole
    # line was compared with the address, so it never matched and a re-run would have sent
    # everybody a second copy.
    return {l.split(',')[0].strip().lower() for l in open(p) if l.strip() and not l.startswith('#')}

def resend_key():
    for l in open(os.path.expanduser('~/.gflam-migrate.env')):
        if l.startswith('RESEND_API_KEY='):
            return l.split('=', 1)[1].strip().strip('"\'')
    sys.exit('RESEND_API_KEY is not in ~/.gflam-migrate.env')

def send_batch(key, msgs):
    req = urllib.request.Request('https://api.resend.com/emails/batch', data=json.dumps(msgs).encode(),
        headers={'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json', 'User-Agent': 'curl/8'}, method='POST')
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())

def message(e, n, key):
    """One email, built the same way for a dry run, a test and the real send."""
    return {'from': FROM, 'to': [e], 'reply_to': REPLY_TO, 'subject': SUBJECT,
            'text': body_text(n, gflam_unsub.link(e, CAMPAIGN, key)),
            'html': body_html(n, gflam_unsub.footer_html(e, CAMPAIGN, key)),
            'headers': gflam_unsub.headers(e, CAMPAIGN, key)}

def main(argv=None):
    global HERE
    argv = sys.argv[1:] if argv is None else argv
    go = '--go' in argv
    test = argv[argv.index('--test') + 1] if '--test' in argv else None
    d = argv[argv.index('--dir') + 1] if '--dir' in argv else None
    if d: HERE = os.path.abspath(os.path.expanduser(d))
    args = [a for a in argv if not a.startswith('--') and a not in (test, d)]
    if not args: sys.exit(__doc__)
    people = load_rows(args)
    # The unsubscribe list is read on EVERY run, dry runs included. If it cannot be read,
    # nothing is sent: a send on a list we failed to read could mail somebody who left.
    try:
        unsubscribed = gflam_unsub.unsubscribed_emails()
    except Exception as ex:
        sys.exit(f'Could not read who has unsubscribed (gflam_customers): {ex}. Nothing sent.')
    suppress = read_list('suppress.txt') | read_list('sent.csv')
    todo = {e: n for e, n in people.items() if e not in suppress and e not in unsubscribed}
    n_unsub = sum(1 for e in people if e in unsubscribed)
    print(f'{len(people)} unique addresses in the files, {n_unsub} unsubscribed (gflam_customers), '
          f'{len(people) - len(todo) - n_unsub} in suppress.txt or already sent, {len(todo)} to send')
    for e in sorted(e for e in people if e in unsubscribed): print('  skipped, unsubscribed:', e)
    for e, n in list(todo.items())[:3]: print('  sample:', n, e)
    ukey = gflam_unsub.secret()
    if not go and not test:
        if todo:
            e, n = next(iter(todo.items()))
            m = message(e, n, ukey or 'DRY-RUN-NOT-A-REAL-SECRET')
            print('\nHeaders on the first email' + ('' if ukey else ' (GFLAM_UNSUB_SECRET not set: this link is NOT valid)') + ':')
            for h, v in m['headers'].items(): print(f'  {h}: {v}')
            print('  footer link:', gflam_unsub.link(e, CAMPAIGN, ukey or 'DRY-RUN-NOT-A-REAL-SECRET'))
        print('\nDry run. Add --test you@example.com for one real email, or --go to send to everyone.'); return
    if not ukey:
        sys.exit('GFLAM_UNSUB_SECRET is not in ~/.gflam-migrate.env, so the unsubscribe link would not work. Nothing sent.')
    good, why = gflam_unsub.preflight(ukey)
    if not good:
        sys.exit(f'Unsubscribe preflight failed: {why}. Nothing sent.')
    print('preflight:', why)
    key = resend_key()
    targets = {test: 'Dean'} if test else todo
    sent_path = os.path.join(HERE, 'sent.csv'); first_write = not os.path.exists(sent_path)
    with open(sent_path, 'a', newline='') as out:
        w = csv.writer(out)
        if first_write: w.writerow(['email', 'id', 'at'])
        items = list(targets.items())
        for i in range(0, len(items), 100):
            chunk = items[i:i + 100]
            msgs = [message(e, n, ukey) for e, n in chunk]
            res = send_batch(key, msgs)
            ids = res.get('data', []) if isinstance(res, dict) else []
            for (e, n), r in zip(chunk, ids or [{}] * len(chunk)):
                w.writerow([e, r.get('id', ''), time.strftime('%Y-%m-%dT%H:%M:%S')])
            print(f'sent {min(i + 100, len(items))} of {len(items)}')
            time.sleep(1.2)   # Resend allows 2 requests a second; stay well under
    print('done. sent.csv holds every address, so a re-run cannot send twice.')

if __name__ == '__main__':
    main()
