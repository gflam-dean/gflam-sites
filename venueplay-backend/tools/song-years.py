#!/usr/bin/env python3
"""Ask the AU iTunes store what year each song is, and whether it is even sold here.

Two questions, one lookup:

  WHAT YEAR. The library has no year field, so the decade playlists were built by
  hand and drifted: the 2000s pack carries songs from 2014, 2021 and 2024. Take the
  EARLIEST release date across every edition Apple returns for that title and
  artist, because the newest is usually a remaster or a compilation and would date
  a 1979 song to 2017.

  IS IT SOLD IN AUSTRALIA. The search runs against the AU store. A song with no AU
  match is one nobody here can have heard on the radio, bought, or streamed from an
  Australian account, which is the closest thing to a recognisability test that can
  be answered from data rather than taste.

Resumable: every answer is appended to a .jsonl as it arrives, and a re-run skips
what is already there. Politely paced, and it backs off rather than hammering when
Apple starts refusing.

  song-years.py [--limit N] [--threads N]
"""
import json, os, re, sys, time, threading, queue, urllib.request, urllib.parse, urllib.error

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
LIB  = os.path.join(ROOT, 'venueplay', 'data', 'musical-library.json')
OUT  = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'song-years.jsonl')
UA   = {'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
                      'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36'}

def norm(s):
    s = re.sub(r'\([^)]*\)|\[[^\]]*\]', ' ', str(s or '').lower())   # (Radio Edit), [feat. X]
    s = re.sub(r'\bfeat\.?\b.*$', ' ', s)
    return re.sub(r'[^a-z0-9]', '', s)

def lookup(title, artist, tries=3):
    q = urllib.parse.urlencode({'term': (artist + ' ' + title)[:180], 'country': 'AU',
                                'media': 'music', 'entity': 'song', 'limit': 12})
    for n in range(tries):
        try:
            req = urllib.request.Request('https://itunes.apple.com/search?' + q, headers=UA)
            with urllib.request.urlopen(req, timeout=20) as f:
                return json.loads(f.read().decode('utf-8', 'replace')).get('results', [])
        except urllib.error.HTTPError as e:
            if e.code in (403, 429, 503):
                time.sleep(4 * (n + 1))     # Apple is asking us to slow down. Do that.
                continue
            return None
        except Exception:
            time.sleep(1 + n)
    return None

def pick(results, title, artist):
    """The earliest edition whose title AND artist actually match."""
    t, a = norm(title), norm(artist)
    years, exact = [], False
    for r in results or []:
        rt, ra = norm(r.get('trackName')), norm(r.get('artistName'))
        if not rt or not ra:
            continue
        same_t = rt == t or rt.startswith(t) or t.startswith(rt)
        same_a = ra == a or a in ra or ra in a
        if same_t and same_a:
            exact = True
            d = str(r.get('releaseDate') or '')[:4]
            if re.fullmatch(r'(19|20)\d\d', d):
                years.append(int(d))
    return (min(years) if years else None), exact

def main():
    lib = json.load(open(LIB))
    songs = lib['songs']
    done = set()
    if os.path.exists(OUT):
        for line in open(OUT):
            try: done.add(json.loads(line)['id'])
            except Exception: pass
    todo = [s for s in songs if s['id'] not in done]
    if '--limit' in sys.argv:
        todo = todo[:int(sys.argv[sys.argv.index('--limit') + 1])]
    nthreads = int(sys.argv[sys.argv.index('--threads') + 1]) if '--threads' in sys.argv else 4
    print('  %d songs, %d already answered, %d to ask about' % (len(songs), len(done), len(todo)), flush=True)

    q = queue.Queue(); [q.put(s) for s in todo]
    lock = threading.Lock(); f = open(OUT, 'a'); n = [0]; hits = [0]
    def work():
        while True:
            try: s = q.get_nowait()
            except queue.Empty: return
            res = lookup(s['title'], s['artist'])
            year, in_au = pick(res, s['title'], s['artist'])
            rec = {'id': s['id'], 'title': s['title'], 'artist': s['artist'],
                   'year': year, 'in_au_store': bool(in_au)}
            with lock:
                f.write(json.dumps(rec) + '\n'); f.flush()
                n[0] += 1
                if year: hits[0] += 1
                if n[0] % 100 == 0:
                    print('     ... %d of %d, %d dated' % (n[0], len(todo), hits[0]), flush=True)
            time.sleep(0.35)
    ts = [threading.Thread(target=work, daemon=True) for _ in range(nthreads)]
    [t.start() for t in ts]; [t.join() for t in ts]
    f.close()
    print('\n  %d asked, %d came back with a year' % (n[0], hits[0]))

if __name__ == '__main__':
    main()
