"""One-click unsubscribe for every Gflam Touring / Drag Bingo marketing email.

Dean, 26 Oct 2026: "why's it not a link that you click and it automates it".

Any Gflam send imports this and gets, for each recipient:
    link(email, campaign)      https://touring-api.../unsubscribe?e=..&t=..&c=..
    headers(email, campaign)   List-Unsubscribe (https + mailto) and List-Unsubscribe-Post
    footer_html / footer_text  the line for the bottom of the email
    unsubscribed_emails()      every address with gflam_customers.unsubscribed_at set
    preflight()                refuses to send unless the live Worker accepts our tokens

THE TOKEN is the one touring-api checks (touring-backend/worker/DEPLOY-touring-api.js,
gflamUnsubToken): HMAC-SHA256 of the trimmed, lower-cased address, keyed with
'gflam-unsub:' + GFLAM_UNSUB_SECRET, hex, first 32. Both suites check the same fixed
vector, so the two cannot drift. The secret lives in ~/.gflam-migrate.env and as a
Worker secret; it is never printed.

The mailto stays as a second option in the header: replies to hello@gflamtouring.com.au
forward to hello@gflam.com.au, and some mail apps only offer mailto.
"""
import hashlib, hmac, json, os, urllib.parse, urllib.request, urllib.error

WORKER = 'https://touring-api.dean-tindale.workers.dev'
MAILTO = 'mailto:hello@gflamtouring.com.au?subject=unsubscribe'
ENV_FILE = os.path.expanduser('~/.gflam-migrate.env')
PROBE = 'unsub-preflight@gflamtouring.com.au'   # the GET writes nothing, so probing is harmless


def _env(name):
    if os.environ.get(name):
        return os.environ[name]
    try:
        for line in open(ENV_FILE):
            if line.startswith(name + '='):
                return line.split('=', 1)[1].strip().strip('"\'')
    except FileNotFoundError:
        pass
    return ''


def secret():
    return _env('GFLAM_UNSUB_SECRET')


def norm(email):
    return str(email or '').strip().lower()


def token(email, key=None):
    key = secret() if key is None else key
    if not key:
        raise RuntimeError('GFLAM_UNSUB_SECRET is not set (in ~/.gflam-migrate.env and on touring-api)')
    return hmac.new(('gflam-unsub:' + key).encode(), norm(email).encode(), hashlib.sha256).hexdigest()[:32]


def _camp(campaign):
    return ''.join(c for c in str(campaign or '').lower() if c.isalnum() or c == '-')[:40]


def link(email, campaign='', key=None, base=WORKER):
    q = {'e': norm(email), 't': token(email, key)}
    if _camp(campaign):
        q['c'] = _camp(campaign)
    return base + '/unsubscribe?' + urllib.parse.urlencode(q)


def headers(email, campaign='', key=None, base=WORKER):
    """RFC 2369 + RFC 8058. https first: Gmail and Apple Mail use it for their button."""
    return {
        'List-Unsubscribe': '<%s>, <%s>' % (link(email, campaign, key, base), MAILTO),
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    }


def footer_text(email, campaign='', key=None):
    return 'Unsubscribe in one click: %s (or reply with the word unsubscribe).' % link(email, campaign, key)


def footer_html(email, campaign='', key=None, color='#777'):
    import html
    u = html.escape(link(email, campaign, key), quote=True)
    m = html.escape(MAILTO, quote=True)
    return ('<a href="%s" style="color:%s">Unsubscribe in one click</a>, or '
            '<a href="%s" style="color:%s">reply with the word unsubscribe</a>.' % (u, color, m, color))


def _sb_get(path):
    url, key = _env('NEW_SUPABASE_URL'), _env('NEW_SERVICE_KEY')
    if not url or not key:
        raise RuntimeError('NEW_SUPABASE_URL / NEW_SERVICE_KEY are not in ~/.gflam-migrate.env')
    req = urllib.request.Request(url.rstrip('/') + '/rest/v1/' + path,
                                 headers={'apikey': key, 'Authorization': 'Bearer ' + key})
    with urllib.request.urlopen(req, timeout=30) as r:   # raises on any non-2xx: fails CLOSED
        return json.loads(r.read() or b'[]')


def unsubscribed_emails(include_venueplay=False, get=None):
    """Every address that must not be mailed. Pages until an EMPTY page (PostgREST stops at
    1000 rows silently, and a short page is not the end). Any error raises, so a send can
    never run on a list it failed to read."""
    get = get or _sb_get
    out = set()
    sources = [('gflam_customers', 'email', 'unsubscribed_at=not.is.null&order=email.asc')]
    if include_venueplay:
        sources.append(('vp_unsubscribes', 'email', 'order=email.asc'))
    for table, col, filt in sources:
        offset = 0
        for _ in range(10000):
            rows = get('%s?select=%s&%s&limit=1000&offset=%d' % (table, col, filt, offset))
            if not rows:
                break
            # Advance by what CAME BACK, not by what was asked for: max-rows can sit below
            # 1000, and stepping by 1000 then skips the rows in between without a word.
            offset += len(rows)
            out.update(norm(r.get(col)) for r in rows if r.get(col))
        else:
            raise RuntimeError('paging %s never ended' % table)
    return out


def preflight(key=None, base=WORKER, opener=None):
    """Before a real send: the live Worker must have the secret AND accept a token we made.
    A GET of the unsubscribe page writes nothing, so this changes no data."""
    opener = opener or (lambda u: urllib.request.urlopen(urllib.request.Request(u, headers={'User-Agent': 'gflam-unsub-preflight'}), timeout=20))
    try:
        with opener(base + '/health') as r:
            h = json.loads(r.read())
    except Exception as e:
        return False, 'touring-api /health did not answer: %s' % e
    if 'GFLAM_UNSUB_SECRET' in (h.get('missing') or []):
        return False, 'touring-api has no GFLAM_UNSUB_SECRET set'
    try:
        with opener(link(PROBE, 'preflight', key, base)) as r:
            if r.status != 200:
                return False, 'the unsubscribe link answered %s' % r.status
    except urllib.error.HTTPError as e:
        return False, ('the live Worker REFUSED our token (HTTP %s): the secret in ~/.gflam-migrate.env '
                       'does not match the one on touring-api, or /unsubscribe is not deployed' % e.code)
    except Exception as e:
        return False, 'the unsubscribe link did not answer: %s' % e
    return True, 'touring-api accepts our unsubscribe links'
