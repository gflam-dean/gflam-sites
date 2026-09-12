"""Which database is the LIVE one? Ask here, never guess from a variable name.

    from vp_live import live
    L = live()          # L.db_url, L.rest_url, L.service_key, L.where

WHY THIS EXISTS. Every tool here reads OLD_DB_URL or OLD_SERVICE_KEY, and "old"
means Singapore. The moment the move to Sydney happens, "old" stops meaning live
and starts meaning the abandoned copy, and the tools do not notice.

The dangerous one is not the tool that breaks. It is check-stale-sessions.py,
which would keep asking SINGAPORE whether any session is unclosed, find nothing
because nothing writes there any more, and report "nothing unclosed can be
billed" every night for ever. That is the exact fault this repo spent 10 Sep 2026
fixing in the sweep: a check that cannot fail.

SO THE MOVE IS ONE LINE. Put this in ~/.gflam-migrate.env on the day:

    VP_LIVE=new

and every tool that asks here follows. Until then it defaults to old, which is
correct today.

AND EVERY TOOL SAYS WHICH PROJECT IT ASKED, out loud, every run. A wrong target
should be visible in the first line of output rather than inferred from a result
that looks fine.
"""
from pathlib import Path

ENV = Path.home() / '.gflam-migrate.env'
REFS = {'ijkzgmdtwtgfkedqspxm': 'Singapore', 'ijkzgmdtwtgfkedqspxm': 'Sydney'}


class Live:
    def __init__(self, which, env):
        p = 'NEW_' if which == 'new' else 'OLD_'
        self.which = which
        self.db_url = env.get(p + 'DB_URL') or ''
        self.service_key = env.get(p + 'SERVICE_KEY') or ''
        self.rest_url = env.get(p + 'SUPABASE_URL') or ''
        if not self.rest_url and self.db_url:
            # postgresql://...@db.<ref>.supabase.co:5432/... or a pooler host carrying the ref
            import re
            m = re.search(r'([a-z]{20})', self.db_url)
            if m: self.rest_url = 'https://%s.supabase.co' % m.group(1)
        import re
        m = re.search(r'([a-z]{20})', self.rest_url or self.db_url or '')
        self.ref = m.group(1) if m else '?'
        self.where = REFS.get(self.ref, 'unknown project')

    def banner(self):
        return 'asking the %s database (%s), because VP_LIVE=%s' % (self.where, self.ref, self.which)


def read_env():
    e = {}
    if ENV.exists():
        for line in ENV.read_text().splitlines():
            if '=' in line and not line.startswith('#'):
                k, v = line.split('=', 1); e[k.strip()] = v.strip()
    return e


def live():
    e = read_env()
    which = (e.get('VP_LIVE') or 'old').strip().lower()
    if which not in ('old', 'new'):
        raise SystemExit('VP_LIVE in %s must be "old" or "new", not %r' % (ENV, which))
    L = Live(which, e)
    if not L.db_url and not L.rest_url:
        raise SystemExit('no %s database in %s' % (which, ENV))
    return L
