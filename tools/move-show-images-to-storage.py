#!/usr/bin/env python3
"""Move the pictures that are still INSIDE the show rows out into Storage. One-off.

Until 19 Oct 2026 touring/manage.html saved each banner as a base64 picture inside
shows.img_src (the Tugun row was 2,003,102 characters). That is what made adding a show
time out. The new manager uploads pictures to the tour-images bucket and keeps only the
address; this does the same for the pictures already saved the old way.

    python3 tools/move-show-images-to-storage.py            look only: says what it would do
    python3 tools/move-show-images-to-storage.py --write    do it

WHAT IT TOUCHES, and nothing else:
  - reads   public.shows (id, venue, show_date, img_src) and public.tour_categories
            (id, name, image_url), the rows whose picture starts with "data:"
  - writes  one file per picture into the tour-images bucket, under shows/ or cards/,
            named by the picture's own hash (the same scheme touring-api uses)
  - writes  that row's img_src (or image_url) to the file's public address, and only
            after the file has been read back and matches byte for byte
  - saves   the original picture to ~/gflam-show-image-backups/<id>.txt first, so the
            change can be undone by hand if anything about it is wrong

On a Mac it shrinks each picture to at most 1600 pixels wide, as JPEG, with the
built-in `sips` tool, which is what the manager now does in the browser. Without sips it
stores the picture as it is.

Credentials come from ~/.gflam-migrate.env (NEW_SUPABASE_URL, NEW_SERVICE_KEY). Nothing
secret is ever printed. It says which project it is talking to before anything else.
Safe to run twice: a row that already holds an address is left alone.
"""
import base64, hashlib, json, os, shutil, subprocess, sys, tempfile, urllib.error, urllib.parse, urllib.request

SYDNEY_REF = 'ijkzgmdtwtgfkedqspxm'
BUCKET = 'tour-images'
MAX_W = 1600


def load_env(path):
    env = {}
    with open(path) as f:
        for line in f:
            line = line.strip()
            if '=' in line and not line.startswith('#'):
                k, v = line.split('=', 1)
                env[k.strip()] = v.strip()
    return env


def req(method, url, key, body=None, headers=None):
    h = {'apikey': key, 'Authorization': 'Bearer ' + key}
    h.update(headers or {})
    r = urllib.request.Request(url, data=body, method=method, headers=h)
    try:
        with urllib.request.urlopen(r, timeout=60) as resp:
            return resp.status, resp.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def sniff(b):
    if b[:3] == b'\xff\xd8\xff':
        return 'image/jpeg', 'jpg'
    if b[:8] == b'\x89PNG\r\n\x1a\n':
        return 'image/png', 'png'
    if b[:4] == b'RIFF' and b[8:12] == b'WEBP':
        return 'image/webp', 'webp'
    return None, None


def shrink(data):
    """At most 1600 wide, JPEG at quality 82, via macOS sips. Returns the bytes to store."""
    sips = shutil.which('sips')
    if not sips:
        return data, 'stored as it was (no sips on this machine)'
    d = tempfile.mkdtemp(prefix='show-img-')
    try:
        src, out = os.path.join(d, 'in'), os.path.join(d, 'out.jpg')
        with open(src, 'wb') as f:
            f.write(data)
        w = subprocess.run([sips, '-g', 'pixelWidth', src], capture_output=True, text=True).stdout
        width = int(w.strip().split()[-1]) if w.strip() and w.strip().split()[-1].isdigit() else 0
        cmd = [sips, '-s', 'format', 'jpeg', '-s', 'formatOptions', '82']
        if width > MAX_W:
            cmd += ['--resampleWidth', str(MAX_W)]
        r = subprocess.run(cmd + [src, '--out', out], capture_output=True, text=True)
        if r.returncode != 0 or not os.path.exists(out):
            return data, 'stored as it was (sips could not convert it)'
        small = open(out, 'rb').read()
        if len(small) >= len(data):
            return data, 'stored as it was (already smaller than a JPEG of it)'
        return small, 'shrunk %d -> %d bytes%s' % (len(data), len(small), ', %d -> %d px wide' % (width, MAX_W) if width > MAX_W else '')
    finally:
        shutil.rmtree(d, ignore_errors=True)


def main():
    write = '--write' in sys.argv
    env_file = os.path.expanduser('~/.gflam-migrate.env')
    for a in sys.argv[1:]:
        if a.startswith('--env-file='):
            env_file = a.split('=', 1)[1]
    backups = os.path.expanduser('~/gflam-show-image-backups')
    for a in sys.argv[1:]:
        if a.startswith('--backup-dir='):
            backups = a.split('=', 1)[1]
    env = load_env(env_file)
    base, key = env.get('NEW_SUPABASE_URL', '').rstrip('/'), env.get('NEW_SERVICE_KEY', '')
    if not base or not key:
        print('STOP: NEW_SUPABASE_URL and NEW_SERVICE_KEY must both be in %s' % env_file)
        return 2
    host = urllib.parse.urlparse(base).hostname or ''
    print('Project: %s' % host)
    if SYDNEY_REF not in host and host != '127.0.0.1':
        print('STOP: that is not the live Sydney project (%s). Nothing was done.' % SYDNEY_REF)
        return 2
    print('Mode: %s' % ('WRITE' if write else 'look only (add --write to do it)'))

    jobs = []
    for table, col, folder, label in (('shows', 'img_src', 'shows', 'venue,show_date'),
                                      ('tour_categories', 'image_url', 'cards', 'name')):
        st, body = req('GET', '%s/rest/v1/%s?select=id,%s,%s&%s=like.data:*&order=id.asc' % (base, table, label, col, col), key)
        if st != 200:
            print('STOP: could not read %s (%s): %s' % (table, st, body[:200].decode('utf-8', 'replace')))
            return 1
        for row in json.loads(body):
            jobs.append((table, col, folder, row))
    if not jobs:
        print('Nothing to move: no picture is stored inside a row.')
        return 0

    moved = 0
    for table, col, folder, row in jobs:
        rid, value = row['id'], row[col]
        name = row.get('venue') or row.get('name') or rid
        when = row.get('show_date') or ''
        try:
            data = base64.b64decode(value.split(',', 1)[1], validate=False)
        except Exception:
            print('  SKIP %s %s %s: the picture in the row does not decode' % (table, name, when))
            continue
        ctype, _ = sniff(data)
        if not ctype:
            print('  SKIP %s %s %s: what is in the row is not a JPG, PNG or WebP' % (table, name, when))
            continue
        stored, how = shrink(data)
        ctype, ext = sniff(stored)
        path = '%s/%s.%s' % (folder, hashlib.sha256(stored).hexdigest()[:32], ext)
        url = '%s/storage/v1/object/public/%s/%s' % (base, BUCKET, path)
        print('  %s %s %s: %d characters in the row -> %s, %s' % (table, name, when, len(value), path, how))
        if not write:
            continue

        os.makedirs(backups, exist_ok=True)
        with open(os.path.join(backups, '%s-%s.txt' % (table, rid)), 'w') as f:
            f.write(value)

        st, body = req('POST', '%s/storage/v1/object/%s/%s' % (base, BUCKET, path), key, stored,
                       {'Content-Type': ctype, 'x-upsert': 'true', 'cache-control': 'max-age=31536000'})
        if st not in (200, 201):
            print('    STOP: storage refused it (%s): %s' % (st, body[:200].decode('utf-8', 'replace')))
            return 1
        st, back = req('GET', url, key)
        if st != 200 or back != stored:
            print('    STOP: the file did not read back the same (%s, %d bytes). The row was NOT changed.' % (st, len(back or b'')))
            return 1
        # Has anybody changed the picture since we read it? Then leave the row alone.
        st, body = req('GET', '%s/rest/v1/%s?select=%s&id=eq.%s' % (base, table, col, rid), key)
        now = json.loads(body)[0][col] if st == 200 and json.loads(body) else None
        if now != value:
            print('    SKIP: the picture in this row changed while this ran. The file is stored; the row was left as it is.')
            continue
        st, body = req('PATCH', '%s/rest/v1/%s?id=eq.%s' % (base, table, rid), key,
                       json.dumps({col: url}).encode(),
                       {'Content-Type': 'application/json', 'Prefer': 'return=representation'})
        saved = json.loads(body) if st == 200 else []
        if not saved or saved[0].get(col) != url:
            print('    STOP: the row was not updated (%s): %s' % (st, body[:200].decode('utf-8', 'replace')))
            return 1
        moved += 1
        print('    done: the row now holds %s' % url)

    if write:
        print('Moved %d of %d. Originals are in %s.' % (moved, len(jobs), backups))
    else:
        print('%d picture(s) would move. Run again with --write to do it.' % len(jobs))
    return 0


if __name__ == '__main__':
    sys.exit(main())
