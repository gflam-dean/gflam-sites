"""A LOCAL CLOUDFLARE PAGES, for the Chrome suites that need to see what Pages would answer (1 Nov 2026).

Three rules of the real host, which a plain http.server gets wrong and a test then cannot see:

  - clean addresses: /live-here-now is live-here-now.html (and /help is help.html)
  - _redirects: a line "/from  /to  301" answers 301 with Location /to. Only the redirect statuses
    (301/302/303/307/308) and 200 (a rewrite: the file at /to, under the old address). Pages ignores
    a bare 404 in _redirects, so this does too (see the top of venueplay/_redirects)
  - a miss: 404.html at the root, served with a real HTTP 404 status, at any depth

It reads THE REAL venueplay/_redirects and THE REAL 404.html from the folder it serves, so a rule or
a page that is wrong in the repo is wrong here too. Used by tools/not-found-in-chrome.test.py and
tools/live-here-now-in-chrome.test.py.
"""
import functools, http.server, io, os, socketserver, threading


def read_redirects(folder):
    rules = {}
    p = os.path.join(folder, '_redirects')
    if not os.path.isfile(p):
        return rules
    for line in io.open(p, encoding='utf-8').read().splitlines():
        line = line.split('#', 1)[0].strip()
        parts = line.split()
        if len(parts) >= 2:
            code = int(parts[2]) if len(parts) > 2 and parts[2].isdigit() else 301
            if code in (200, 301, 302, 303, 307, 308):
                rules.setdefault(parts[0], (parts[1], code))
    return rules


def serve(folder):
    """(server, base url). The caller shuts it down."""
    rules = read_redirects(folder)

    class H(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def end_headers(self):
            self.send_header('Cache-Control', 'no-store')
            super().end_headers()

        def _file_for(self, p):
            full = os.path.join(folder, p.lstrip('/'))
            if p.endswith('/') and os.path.isfile(os.path.join(full, 'index.html')):
                return p + 'index.html'
            if os.path.isfile(full):
                return p
            if not os.path.splitext(p)[1] and os.path.isfile(full + '.html'):
                return p + '.html'
            return None

        def do_GET(self):
            p, _, q = self.path.partition('?')
            if p in rules:
                to, code = rules[p]
                if code != 200:
                    self.send_response(code)
                    self.send_header('Location', to + ('?' + q if q and '?' not in to else ''))
                    self.send_header('Content-Length', '0')
                    self.end_headers()
                    return
                p = to
            f = self._file_for(p)
            if f is None:
                body = io.open(os.path.join(folder, '404.html'), 'rb').read()
                self.send_response(404)
                self.send_header('Content-Type', 'text/html; charset=utf-8')
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            self.path = f + ('?' + q if q else '')
            return super().do_GET()

    srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(H, directory=folder))
    srv.socket.listen(128)
    srv.daemon_threads = True
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, 'http://127.0.0.1:%d' % srv.server_address[1]
