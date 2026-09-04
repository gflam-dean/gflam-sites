#!/usr/bin/env python3
"""Can the PUBLIC key write to anything it should not?

WHY THIS EXISTS

On 5 Sep 2026 an audit proved that with nothing but the anon key printed in every
page, a POST to /rest/v1/reviews with an EMPTY BODY returned 201 Created and the
row persisted with stars = 5. Same for shows. PATCH and DELETE returned 204 on
reviews, shows and venues. Anyone could post a defamatory review, invent a show,
or delete the real ones, and it rendered immediately on the drag-bingo and touring
pages.

The gate had a check for whether the public key could READ these tables. It had
none for whether it could WRITE to them, so the worst hole found all day was
invisible to it. (And the read check had never authenticated, so it was not
working either -- see release-check.py.)

HOW IT ASKS WITHOUT WRITING ANYTHING

  INSERT   POST {"id": "not-a-uuid"}.  PostgREST checks its schema cache first, so
           a made-up column name tells us nothing: every table answers 400. A REAL
           column with a bad VALUE gets past that into Postgres, which checks
           privilege BEFORE it evaluates the cast:
             42501 permission denied  -> blocked. Good.
             22P02 invalid input       -> THE INSERT WOULD HAVE WORKED.
           Nothing is written either way.

  UPDATE   PATCH with a filter that matches no row.
  DELETE   DELETE with a filter that matches no row.
           204 means allowed; 401/403 means blocked. Nothing is touched.

WHAT IS ALLOWED ON PURPOSE

Public forms have to insert. signups, contacts and vp_captures are insert-only by
design, and vp_players is written by the join. Those are listed below, and the
list is the point: anything NOT on it that accepts a write is a finding.

  check-writes.py
"""
import io
import json
import os
import re
import sys
import urllib.error
import urllib.request
import concurrent.futures as cf

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SUPA = "https://gpoolavkghnxedzrmtmc.supabase.co"
GRN, RED, YEL, DIM, OFF = '\033[32m', '\033[31m', '\033[33m', '\033[2m', '\033[0m'

# WHAT THIS CHECKS, AND WHY IT IS A NAMED LIST RATHER THAN A SWEEP.
#
# The first version of this swept every table and reported 120 findings. That was
# measuring the wrong thing. Most vp_* and pp_* tables are written by
# onboard.html, hq.html and vp-session.js using the anon key PLUS a signed-in
# user's JWT, which is the intended Supabase shape: the GRANT has to exist and
# RLS does the protecting through auth.uid(). Reporting those as holes buries the
# ones that are real, exactly like the 288 false positives in check-columns.py.
#
# The hole that actually happened was narrower. These tables hold PUBLIC CONTENT
# that the live sites read and nobody signs in to edit, and their RLS was
# permissive, so the grant and the policy lined up and an empty POST to /reviews
# returned 201 Created with stars = 5. That is the class worth guarding: content a
# stranger can see should not be content a stranger can change.
READ_ONLY_PUBLIC = {
    'reviews':            'rendered on the drag-bingo and touring pages',
    'shows':              'the public show listings',
    'venues':             'the venue list those pages read',
    'experience':         'public site content',
    'tour_categories':    'public site content',
    'ticket_milestones':  'public site content',
}
# Forms have to insert. Nothing here may be updated or deleted.
INSERT_OK = {
    'signups':   'the newsletter and interest forms on the public sites',
    'contacts':  'the contact form',
}

BAD_UUID = json.dumps({'id': 'definitely-not-a-uuid'}).encode()
NOWHERE = '?id=eq.00000000-0000-0000-0000-000000000000'


def anon_key():
    for p in ('venueplay/play.html', 'partyplay/play.html'):
        try:
            m = re.search(r'eyJ[A-Za-z0-9_.-]{80,}',
                          io.open(os.path.join(ROOT, p), encoding='utf-8').read())
            if m:
                return m.group(0)
        except Exception:
            pass
    sys.exit('cannot find the anon key in any page')


def tables():
    """Only the public-content tables and the form tables. Deliberately not a sweep."""
    return sorted(set(READ_ONLY_PUBLIC) | set(INSERT_OK))


def _unused_all_tables():
    """Kept for reference: every table the code touches."""
    names = set()
    for base in ('venueplay', 'venueplay-backend', 'partyplay', 'partyplay-backend'):
        d = os.path.join(ROOT, base)
        if not os.path.isdir(d):
            continue
        for dirpath, _, fs in os.walk(d):
            if 'node_modules' in dirpath or 'emails' in dirpath:
                continue
            for n in fs:
                if not (n.endswith('.js') or n.endswith('.html')) or n.endswith('.test.js'):
                    continue
                src = io.open(os.path.join(dirpath, n), encoding='utf-8', errors='replace').read()
                src = re.sub(r'/\*.*?\*/', '', src, flags=re.S)
                for m in re.finditer(r"/rest/v1/([a-z_]+)", src):
                    names.add(m.group(1))
                for m in re.finditer(r"\.from\(\s*['\"]([a-z_]+)['\"]", src):
                    names.add(m.group(1))
                for m in re.finditer(r"\b(?:sbGet|sbInsert|sbPatch|sbUpsert|vpaSelect|vpaInsert|vpaPatch|sb)\s*\(\s*env\s*,\s*['\"]([a-z_]+)", src):
                    names.add(m.group(1))
    # views cannot be written to in a way that matters here
    return sorted(t for t in names if not t.startswith('v_'))


def call(method, url, key, body=None):
    req = urllib.request.Request(url, data=body, method=method,
                                 headers={'apikey': key, 'authorization': 'Bearer ' + key,
                                          'content-type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status, ''
    except urllib.error.HTTPError as e:
        try:
            d = json.loads(e.read().decode('utf-8', 'replace'))
            return e.code, str(d.get('code') or '')
        except Exception:
            return e.code, ''
    except Exception as e:
        return 0, str(e)[:40]


def probe(key, t):
    """(insert, update, delete) each 'allowed' | 'blocked' | 'unknown'."""
    out = {}
    st, code = call('POST', SUPA + '/rest/v1/' + t, key, BAD_UUID)
    out['insert'] = ('blocked' if code == '42501' else
                     'allowed' if code in ('22P02', '23502', '23503', '23505') else
                     'allowed' if st in (200, 201) else 'unknown')
    for m, name in (('PATCH', 'update'), ('DELETE', 'delete')):
        # THE BODY MUST NAME A REAL COLUMN. An empty {} makes PostgREST answer 204
        # without issuing an UPDATE at all -- nothing to set, so nothing to check --
        # and the first version of this read that as "allowed" on every table it
        # tried, including ones with no grant whatsoever. Same body as the insert
        # probe: a real column with a value that cannot cast, so the statement
        # reaches Postgres and the privilege check happens before the cast fails.
        st, code = call(m, SUPA + '/rest/v1/' + t + NOWHERE, key,
                        BAD_UUID if m == 'PATCH' else None)
        out[name] = ('blocked' if code == '42501' or st in (401, 403) else
                     'allowed' if st in (200, 204) else 'unknown')
    return out


def main():
    key = anon_key()
    ts = tables()

    # PROVE THE PROBE WORKS. A table we know is locked must read blocked, or a
    # clean run means nothing. vp_players has no grant at all to the public key.
    # A CONTROL FOR EVERY OPERATION, not just one. Checking insert alone is how the
    # broken UPDATE probe survived: its control passed while it reported "allowed"
    # on all eight tables. vp_players has no grant of any kind to the public key,
    # so all three must read blocked.
    control = probe(key, 'vp_players')
    wrong = [op for op in ('insert', 'update', 'delete') if control[op] != 'blocked']
    if wrong:
        print('  %sSTOP%s the probe is not working. vp_players has no grant at all, yet '
              '%s reads "%s". Every result below would be meaningless.'
              % (RED, OFF, ' and '.join(wrong), control[wrong[0]]))
        return 2
    print('\n%sCAN THE PUBLIC KEY CHANGE WHAT THE PUBLIC SITES SHOW?%s  %d table(s)'
          % (YEL, OFF, len(ts)))
    print('  %sprobe verified against vp_players, which is locked%s\n' % (DIM, OFF))

    res = {}
    with cf.ThreadPoolExecutor(max_workers=8) as ex:
        for t, r in zip(ts, ex.map(lambda x: probe(key, x), ts)):
            res[t] = r

    findings, unknown = [], []
    for t in ts:
        r = res[t]
        for op in ('insert', 'update', 'delete'):
            allowed_here = (op == 'insert' and t in INSERT_OK)
            if r[op] == 'allowed' and not allowed_here:
                findings.append((t, op))
            elif r[op] == 'unknown':
                unknown.append('%s %s' % (t, op))

    for t, op in findings:
        print('  %sTHE PUBLIC KEY CAN %s%s %s' % (RED, op.upper(), OFF, t))
    for t, why in sorted(INSERT_OK.items()):
        if t in res and res[t]['insert'] == 'allowed':
            print('  %sallowed on purpose%s %-14s %s' % (DIM, OFF, t, why))

    print('\n  %d table(s) checked, %s%d finding(s)%s, %d could not be determined'
          % (len(ts), RED if findings else DIM, len(findings), OFF, len(unknown)))
    if unknown:
        print('  %sundetermined is not a pass: %s%s' % (DIM, ', '.join(unknown[:6]), OFF))
    return 1 if findings else 0


sys.exit(main())
