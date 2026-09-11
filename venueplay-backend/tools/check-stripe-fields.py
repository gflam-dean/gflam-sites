#!/usr/bin/env python3
"""EVERY STRIPE FIELD THIS CODE READS, CHECKED AGAINST WHAT STRIPE ACTUALLY RETURNS.

    python3 venueplay-backend/tools/check-stripe-fields.py

WHY THIS EXISTS. Dean, 11 Sep 2026: "FML! Seriously you picked up old stripe code this
morning. I told you to audit the billing."

He is right. Stripe moved and removed fields in the 2025 API versions, and this repo has
now been bitten THREE separate times by the same thing, each found by accident:

  1. subscription.current_period_end  -> moved onto the subscription ITEM. The decline
     email went out with "next: null" and no renewal date.
  2. discount.coupon -> now under discount.source.coupon. Reading d.coupon returns
     nothing, which looks exactly like "this venue has no discount", and it reported the
     OPPOSITE of the truth twice in one night.
  3. invoice.paid -> no longer populated. It comes back None on every invoice, which
     broke live-overage-test.py in BOTH directions at once: the success check asked
     `paid is True` and so reported the first overage ever collected in production as a
     FAILURE, and the decline check asked `paid is not True` and so could never fail.

Each one was fixed on its own, which is not an audit. This is the audit: it reads REAL
objects from the live account and reports every field the code asks for that Stripe does
not actually send back.

HOW IT JUDGES. Not from a list somebody maintains, which would rot. It fetches one real
example of each object type, takes the keys Stripe really returns, and then reads our own
source for field accesses on variables holding that kind of object. A field the code reads
that is absent from every real example of that object is reported.

IT IS READ-ONLY and uses STRIPE_READ_KEY. It cannot charge, void or change anything.

WHAT IT CANNOT DO, said plainly because a check that overstates itself is worse than none:
  * It only sees objects that EXIST in this account. If we have never created a
    subscription schedule, it cannot check the fields we read off one.
  * It matches on variable naming (inv/invoice/sub/subscription/pi/charge/item/cust).
    A Stripe object held in a variable named something else is not checked.
  * A field that is legitimately absent on THIS example but present on others (an
    optional field) is reported as a warning, not a failure, when it is absent on some
    but present on at least one.
"""
import json, os, re, sys, urllib.error, urllib.parse, urllib.request
from pathlib import Path

ENV = Path.home() / '.gflam-migrate.env'
GRN, RED, YEL, DIM, OFF = '\033[32m', '\033[31m', '\033[33m', '\033[2m', '\033[0m'
TRIPLE_S = chr(39) * 3      # ''' without writing it inside this file's own strings
TRIPLE_D = chr(34) * 3
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Which Stripe object a variable of this name is holding. Only these are judged.
VAR_KINDS = {
    'inv': 'invoice', 'invoice': 'invoice', 'fresh': 'invoice', 'got': None,
    'sub': 'subscription', 'subscription': 'subscription',
    'cust': 'customer', 'customer': 'customer',
    'pi': 'payment_intent', 'intent': 'payment_intent',
    'charge': 'charge', 'ch': 'charge',
    # 'item' IS DELIBERATELY NOT HERE. It means two different Stripe objects in this
    # codebase: a SUBSCRIPTION item (sub.items.data[0], which has price and
    # current_period_end) and an INVOICE item (which has neither, they live under
    # pricing.price_details and parent.subscription_details). A name-based guess cannot
    # tell them apart, and every single finding it produced was the subscription kind
    # being judged against the invoice kind. A detector that cannot tell two things apart
    # must not pretend to.
    'ii': 'invoiceitem',
}

# The files that talk to Stripe.
SOURCES = [
    'venueplay-backend/worker/venueplay-game.js',
    'venueplay-backend/worker/venueplay-api-FULL.js',
    'venueplay-backend/tools/live-overage-test.py',
    'venueplay-backend/tools/check-billing-truth.py',
    'venueplay-backend/tools/stripe-snapshot.py',
    'partyplay-backend/worker/DEPLOY-partyplay-api.js',
]


def key():
    if not ENV.exists():
        print('no %s on this machine, so Stripe was never asked.' % ENV)
        sys.exit(2)
    m = re.search(r'STRIPE_READ_KEY\s*=\s*(\S+)', ENV.read_text())
    if not m:
        print('no STRIPE_READ_KEY in %s' % ENV)
        sys.exit(2)
    return m.group(1).strip().strip('"\'')


def get(k, path, **q):
    u = 'https://api.stripe.com/v1/' + path
    if q:
        u += '?' + urllib.parse.urlencode(q, doseq=True)
    try:
        return json.load(urllib.request.urlopen(
            urllib.request.Request(u, headers={'Authorization': 'Bearer ' + k}), timeout=30))
    except urllib.error.HTTPError as e:
        return {'__error': json.loads(e.read().decode()).get('error', {}).get('message', '?')}


def samples(k):
    """One or more REAL objects of each kind, straight from the account."""
    out, notes = {}, {}
    def coll(kind, path, **q):
        d = get(k, path, **q)
        if d.get('__error'):
            notes[kind] = d['__error']; return
        rows = d.get('data') or []
        if rows:
            out[kind] = rows
        else:
            notes[kind] = 'none exist in this account, so nothing could be checked'

    coll('invoice', 'invoices', limit=10)
    coll('subscription', 'subscriptions', limit=10, status='all')
    coll('customer', 'customers', limit=10)
    coll('invoiceitem', 'invoiceitems', limit=10)
    coll('payment_intent', 'payment_intents', limit=10)
    coll('charge', 'charges', limit=10)
    return out, notes


DOT_RE = re.compile(r"\b(%s)\b\.([A-Za-z_][A-Za-z0-9_]*)" % '|'.join(sorted(VAR_KINDS)))
KEY_RE = re.compile(r"\b(%s)\b(?:\.get\(['\"]([A-Za-z_][A-Za-z0-9_]*)['\"]|\[['\"]([A-Za-z_][A-Za-z0-9_]*)['\"]\])"
                    % '|'.join(sorted(VAR_KINDS)))
# Reading a field is not the same as asserting on it. These are method calls, not fields.
NOT_FIELDS = {'get', 'map', 'filter', 'length', 'forEach', 'some', 'every', 'push', 'slice',
              'join', 'split', 'indexOf', 'toFixed', 'replace', 'test', 'match', 'keys',
              'then', 'catch', 'error', 'items', 'data', 'body', 'row', 'detail'}


def strip_strings(src):
    """A WEBHOOK EVENT NAME IS NOT A FIELD READ.

    'invoice.paid', 'invoice.payment_failed', 'customer.subscription.deleted' are Stripe
    EVENT names and they live in string literals. The first version of this tool matched
    them as though the code were reading inv.paid, and reported twenty findings of which
    most were noise. A detector that matches too much is as useless as one that matches
    nothing, and handing over a list that is mostly wrong is worse than handing over none.

    COMMENTS ARE NOT FIELD READS EITHER, and that is how the SECOND version of this tool
    still reported eight findings of which all eight were noise: every one was an event
    name written in a /* */ block explaining the webhook. A comment is documentation, not
    behaviour.

    So blank every string literal AND every comment, keeping newlines so line numbers stay
    true. Python # comments too, since half these sources are Python.
    """
    out, i, n = [], 0, len(src)
    while i < n:
        c = src[i]
        # /* block */ and // line comments, and Python's #
        if c == '/' and i + 1 < n and src[i + 1] == '*':
            j = src.find('*/', i + 2)
            j = n if j < 0 else j + 2
            out.append(''.join('\n' if ch == '\n' else ' ' for ch in src[i:j])); i = j; continue
        if (c == '/' and i + 1 < n and src[i + 1] == '/') or c == '#':
            j = src.find('\n', i)
            j = n if j < 0 else j
            out.append(' ' * (j - i)); i = j; continue
        # Python triple-quoted docstrings. Seen as three separate quotes, the stripper
        # desynced and everything after a docstring was judged as live code: that is why
        # a tuple of EVENT NAMES in live-overage-test.py was reported as a field read.
        if src[i:i+3] in ('\'\'\'', '"""'):
            q3 = src[i:i+3]
            j = src.find(q3, i + 3)
            j = n if j < 0 else j + 3
            out.append(''.join('\n' if ch == '\n' else ' ' for ch in src[i:j])); i = j; continue
        if c in '"\'`':
            q = c; out.append(' '); i += 1
            while i < n:
                if src[i] == '\\' and i + 1 < n:
                    out.append('  '); i += 2; continue
                if src[i] == q:
                    out.append(' '); i += 1; break
                out.append('\n' if src[i] == '\n' else ' '); i += 1
            continue
        out.append(c); i += 1
    return ''.join(out)


def strip_comments(src):
    """Comments only, leaving string literals intact.

    NEEDED BECAUSE STRIPPING STRINGS DESTROYS THE FIELD NAME. Python reads a Stripe field
    as inv.get('paid'), where the quotes are the syntax, not a webhook event name. The
    first working version of this tool blanked every string literal and so could not see
    a single Python field read: it reported "every Stripe field this code reads exists"
    while the exact fault it was written for, inv.get('paid'), sat in the file untouched.
    It was caught by breaking it on purpose and watching it stay green.

    So: dot access is judged on the string-stripped source (where 'invoice.paid' is an
    event name), and .get('x') / ['x'] on the comment-stripped source (where 'paid' is
    the field). Two passes, because the two forms need opposite treatment.
    """
    out, i, n = [], 0, len(src)
    while i < n:
        c = src[i]
        if c == '/' and i + 1 < n and src[i + 1] == '*':
            j = src.find('*/', i + 2); j = n if j < 0 else j + 2
            out.append(''.join('\n' if ch == '\n' else ' ' for ch in src[i:j])); i = j; continue
        if (c == '/' and i + 1 < n and src[i + 1] == '/') or c == '#':
            j = src.find('\n', i); j = n if j < 0 else j
            out.append(' ' * (j - i)); i = j; continue
        if src[i:i+3] in (TRIPLE_S, TRIPLE_D):
            q3 = src[i:i+3]; j = src.find(q3, i + 3); j = n if j < 0 else j + 3
            out.append(''.join('\n' if ch == '\n' else ' ' for ch in src[i:j])); i = j; continue
        out.append(c); i += 1
    return ''.join(out)


def main():
    k = key()
    real, notes = samples(k)
    print()
    print('EVERY STRIPE FIELD THIS CODE READS, AGAINST REAL OBJECTS')
    for kind in sorted(set(list(real) + list(notes))):
        if kind in real:
            print('%s  %-16s %d real example(s), %d distinct key(s)%s'
                  % (DIM, kind, len(real[kind]), len(set().union(*[set(r) for r in real[kind]])), OFF))
        else:
            print('%s  %-16s NOT CHECKED: %s%s' % (YEL, kind, notes[kind], OFF))
    print()

    # THE PROBE. A field we KNOW Stripe no longer sends must be caught, or this tool is
    # reporting a clean bill of health it never earned.
    if 'invoice' in real:
        inv_keys = set().union(*[set(r) for r in real['invoice']])
        if 'paid' in inv_keys:
            print('%sPROBE FAILED%s: invoice.paid is present on this API version, so the known '
                  'case this tool was written for no longer applies. Re-aim it before trusting it.'
                  % (RED, OFF))
            return 2
        print('%s  probe verified%s  invoice.paid really is absent, so a missing field is detectable'
              % (DIM, OFF))
    print()

    findings, checked = [], 0
    for rel in SOURCES:
        full = os.path.join(ROOT, rel)
        if not os.path.isfile(full):
            continue
        raw = open(full, encoding='utf-8', errors='replace').read()
        # TWO PASSES, because the two ways of reading a field need OPPOSITE treatment.
        # inv.paid          -> judge on the string-stripped source ('invoice.paid' is an event)
        # inv.get('paid')   -> judge on the comment-stripped source ('paid' is the field)
        passes = [(strip_strings(raw), DOT_RE), (strip_comments(raw), KEY_RE)]
        seen = {}
        for src, rx in passes:
          for m in rx.finditer(src):
            var = m.group(1)
            field = m.group(2) or (m.group(3) if rx is KEY_RE and m.lastindex and m.lastindex >= 3 else None)
            kind = VAR_KINDS.get(var)
            if not kind or not field or field in NOT_FIELDS:
                continue
            if kind not in real:
                continue
            checked += 1
            keys_any = set().union(*[set(r) for r in real[kind]])
            if field not in keys_any:
                # A GUARDED READ IS NOT A FAULT, IT IS THE FIX.
                # Both Workers already handle every moved field: sub.current_period_end ||
                # item.current_period_end, sub.discounts || sub.discount, invoice.subscription
                # || invoice.parent.subscription_details.subscription. Reporting those as
                # faults buries the one bare read that actually matters. So only a read with
                # no fallback beside it counts, and an assignment is a WRITE, not a read.
                tail = src[m.end():m.end() + 90]
                head = src[max(0, m.start() - 60):m.start()]
                guarded = ('||' in tail[:40]) or tail.lstrip().startswith('&&') or ('&&' in head[-24:])
                # A ternary is a guard too: typeof invoice.payment_intent === 'string' ? x : y
                guarded = guarded or ('?' in tail[:50] and ':' in tail[:90]) or ('typeof' in head[-30:])
                # and the TRUE branch of a ternary, where the ? sits before the read:
                #   typeof invoice.payment_intent === 'string' ? invoice.payment_intent : <fallback>
                guarded = guarded or ('?' in head[-40:] and ':' in tail[:60])
                # A read whose result is then tested for falsiness and replaced is guarded too:
                #   let pi = invoice.payment_intent ... if (!pi) { pi = <the newer path> }
                # That is the Basil fallback written the long way, and it is correct code.
                lhs = re.search(r'(?:let|const|var)\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*$', head)
                if lhs and re.search(r'if\s*\(\s*!\s*' + re.escape(lhs.group(1)) + r'\b', tail + src[m.end():m.end() + 260]):
                    guarded = True
                assigned = tail.lstrip().startswith('=') and not tail.lstrip().startswith('==')
                if guarded or assigned:
                    continue
                line = src.count('\n', 0, m.start()) + 1
                seen.setdefault((kind, field), []).append(line)
        for (kind, field), lines in sorted(seen.items()):
            findings.append((rel, kind, field, lines))

    if not checked:
        print('%sNOTHING WAS CHECKED%s. Either the sources moved or the pattern matches nothing, '
              'and an empty sweep must never read as a pass.' % (RED, OFF))
        return 2

    print('  %d field read(s) checked across %d file(s)' % (checked, len(SOURCES)))
    print()
    if not findings:
        print('%sEvery Stripe field this code reads exists on a real object.%s' % (GRN, OFF))
        return 0
    for rel, kind, field, lines in findings:
        print('  %sFAIL%s %s.%s is read but Stripe never sends it' % (RED, OFF, kind, field))
        print('        %s line(s) %s' % (rel, ', '.join(str(x) for x in lines[:6])))
    print()
    print('%s%d field(s) the code reads and Stripe does not send.%s' % (RED, len(findings), OFF))
    print('Each one reads as null forever, which is how invoice.paid reported the first')
    print('overage ever collected as a failure and made the decline check unable to fail.')
    return 1


if __name__ == '__main__':
    sys.exit(main())
