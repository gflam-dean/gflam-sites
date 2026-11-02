"""THE STRIPE FIELD CHECK, FED THE SHAPES THAT FOOLED IT, WITH NO STRIPE CALL.

venueplay-backend/tools/check-stripe-fields.py reads our source for fields read off Stripe
objects and judges them against real objects from the account. The gate only runs it live,
so nothing proved its DETECTOR on its own. This does, both ways:

  * 3 Nov 2026 the gate went red on main with "charge.toUpperCase is read but Stripe never
    sends it": `(ch) => ch.toUpperCase()`, a .replace() callback in the monthly venue report,
    where ch is the matched text. That must stay quiet.
  * and a real missing field must still go red, including one read off a callback parameter
    that really is a charge (charges.data.map((ch) => ch.x)), so the fix cannot hide the
    reads the tool exists for.

Pure: no network, no git, no subprocess. Run: python3 tools/stripe-fields-detector.test.py
"""
import importlib.util
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_spec = importlib.util.spec_from_file_location(
    'check_stripe_fields', os.path.join(ROOT, 'venueplay-backend', 'tools', 'check-stripe-fields.py'))
csf = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(csf)

ran = bad = 0
def check(name, cond):
    global ran, bad
    ran += 1
    print(('  ok   ' if cond else '  FAIL ') + name)
    if not cond:
        bad += 1

# What Stripe really sends, cut down: invoice.paid is gone (the case the tool was written for).
REAL = {
    'charge': [{'id': 'ch_1', 'amount': 300, 'status': 'succeeded', 'refunded': False}],
    'invoice': [{'id': 'in_1', 'status': 'paid', 'amount_paid': 300}],
}

def found(src, name='x.js'):
    findings, checked = csf.scan([(name, src)], REAL)
    return {(k, f) for _, k, f, _ in findings}, checked

# 1. The exact line from the monthly venue report.
REPORT = ("      return row(vpaEsc(vpaFormatWord(f).replace(/^./, (ch) => ch.toUpperCase())) + "
          "(x.avg_players != null ? '<br><span>about ' : ''), what);\n")
got, n = found(REPORT)
check('a .replace() callback named ch is read as text, not a Stripe charge', ('charge', 'toUpperCase') not in got)

# 1b. The same line, read where it really sits, in the Worker.
worker = os.path.join(ROOT, 'venueplay-backend', 'worker', 'venueplay-api-FULL.js')
wsrc = open(worker, encoding='utf-8', errors='replace').read()
check('the venue report line is still in the Worker (else 1b proves nothing)', '(ch) => ch.toUpperCase()' in wsrc)
wf, _ = csf.scan([('venueplay-api-FULL.js', wsrc)], REAL)
check('the Worker itself raises no charge.toUpperCase', not any(k == 'charge' and f == 'toUpperCase' for _, k, f, _ in wf))

# 1c. The other spellings of a replace callback.
got, _ = found("s.replaceAll(/x/g, function (m, ch) { return ch.toLowerCase(); });\n")
check('a function(m, ch) .replaceAll callback is text too', ('charge', 'toLowerCase') not in got)
got, _ = found("s.replace(/x/, ch => ch.trimmed);\n")
check('a bare ch => .replace callback is text too', ('charge', 'trimmed') not in got)

# 2. A real missing field still goes red.
got, n = found("const was = inv.paid;\nsend(was);\n")
check('a bare invoice.paid read is still reported', ('invoice', 'paid') in got)
check('and was counted as checked', n >= 1)
got, _ = found("const r = charge.refundz;\nlog(r);\n")
check('a bare charge field Stripe never sends is still reported', ('charge', 'refundz') in got)
got, _ = found("const total = charge.amount;\n")
check('control: a field Stripe does send is not reported', ('charge', 'amount') not in got)

# 3. A callback parameter that really IS a charge is still judged.
got, _ = found("const ids = charges.data.map((ch) => ch.paid_out);\n")
check('a .map((ch) => ch.x) read off a real charge is still reported', ('charge', 'paid_out') in got)
got, _ = found("charges.data.forEach(function (ch) { use(ch.paid_out); });\n")
check('a forEach(function (ch)) read off a real charge is still reported', ('charge', 'paid_out') in got)

# 4. Once the .replace( call has closed, ch is the outer charge again.
got, _ = found("const t = s.replace(/^./, (ch) => ch.toUpperCase());\nconst bad = ch.paid_out;\n")
check('a charge read AFTER a .replace callback closes is still reported', ('charge', 'paid_out') in got)
check('while the callback read beside it stays quiet', ('charge', 'toUpperCase') not in got)
got, _ = found("note(s.replace(/x/, (m) => m + ch.paid_out));\n")
check('a charge read inside a replace callback whose parameter is NOT ch is still reported', ('charge', 'paid_out') in got)

print('\n%d of %d checks passed' % (ran - bad, ran))
if bad:
    raise SystemExit(1)
