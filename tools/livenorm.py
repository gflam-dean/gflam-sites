"""ONE normaliser for "is the live page the file on disk", shared by verify-live.py and
release-check.py.

Cloudflare REWRITES HTML on the way out, so live is never byte-identical to the repo: it
obfuscates email addresses (hello@venueplay.com.au becomes a __cf_email__ link plus an
injected decode script) and injects a Web Analytics beacon whose build hash changes on
their schedule. Comparing raw bytes therefore reported EVERY html file as stale, for ever,
which is how release-check's own "this release is live" comparison could never pass, and
verify-live carried the only working version. The audit of 20 Sep 2026 asked for one
copy. This is it: flatten both sides to the same shape and hash them.
"""
import hashlib
import re


def normalise(b):
    t = b.decode('utf-8', 'replace') if isinstance(b, bytes) else str(b)
    # Match each injected tag through its CLOSING tag, not with [^>]*. The beacon carries
    # data-cf-beacon='{...json...}', so an attribute-by-attribute pattern is one stray > away
    # from not matching, and a normaliser that silently stops matching refuses every html
    # file with no explanation.
    t = re.sub(r'<script[^>]*email-decode[\s\S]*?</script>', '', t)
    # The obfuscated link is <a href="/cdn-cgi/l/email-protection#<hex>" ...><span
    # class="__cf_email__" ...>[email&#160;protected]</span></a>. The old pattern wanted the
    # quote straight after email-protection and never saw the #hex, so every page with a
    # mailto link compared stale for ever. Both sides flatten to the same mailto:EMAIL link.
    # A mailto link becomes the anchor with a __cf_email__ SPAN inside; a bare address in
    # running text becomes an ANCHOR with class __cf_email__ and no link of its own. The two
    # need opposite treatment: the first is still a link, the second is just text.
    t = re.sub(r'<a href="/cdn-cgi/l/email-protection[^"]*"([^>]*)><span class="__cf_email__"[^>]*>.*?</span></a>',
               r'<a href="mailto:EMAIL"\1>EMAIL</a>', t, flags=re.S)
    t = re.sub(r'<a href="/cdn-cgi/l/email-protection[^"]*" class="__cf_email__"[^>]*>.*?</a>', 'EMAIL', t, flags=re.S)
    t = re.sub(r'<a href="/cdn-cgi/l/email-protection[^"]*"([^>]*)>.*?</a>', r'<a href="mailto:EMAIL"\1>EMAIL</a>', t, flags=re.S)
    t = re.sub(r'/cdn-cgi/l/email-protection[^"\']*', 'mailto:EMAIL', t)
    t = re.sub(r'[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', 'EMAIL', t)
    t = re.sub(r'<script[^>]*cloudflareinsights[\s\S]*?</script>', '', t)
    # Deleting an injected tag leaves the blank line it sat on. Compare CONTENT, not layout.
    t = re.sub(r'\s+', ' ', t).strip()
    return hashlib.sha256(t.encode('utf-8')).hexdigest()


def served_path(rel):
    """The URL path Cloudflare Pages serves a repo file at: .html is extensionless and
    index.html is the directory; asking for the .html form gets a 308."""
    path = '/' + rel.split('/', 1)[1] if '/' in rel else '/' + rel
    if path.endswith('/index.html'):
        return path[:-len('index.html')]
    if path.endswith('.html'):
        return path[:-len('.html')]
    return path
