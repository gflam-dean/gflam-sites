#!/usr/bin/env python3
"""Watch a live Worker's console.log for N seconds, through Cloudflare's tail API (no wrangler, no node).

    python3 venueplay-backend/tools/worker-tail.py venueplay-game 60 [grep]

Prints every log line and exception the Worker emits while it runs. Secrets never appear:
this reads what the Worker chose to log, nothing else. The tail is deleted when it exits.
"""
import asyncio, json, sys, time, urllib.request, urllib.error
from vp_live import read_env
try: import websockets
except ImportError: sys.exit('pip3 install websockets')

E = read_env()
name = sys.argv[1] if len(sys.argv) > 1 else 'venueplay-game'
secs = int(sys.argv[2]) if len(sys.argv) > 2 else 60
want = sys.argv[3] if len(sys.argv) > 3 else ''
base = 'https://api.cloudflare.com/client/v4/accounts/%s/workers/scripts/%s/tails' % (E['CF_ACCOUNT_ID'], name)
H = {'Authorization': 'Bearer ' + E['CF_API_TOKEN'], 'Content-Type': 'application/json'}

def cf(method, url, body=None):
    r = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None, method=method, headers=H)
    try: return json.loads(urllib.request.urlopen(r, timeout=30).read())
    except urllib.error.HTTPError as x: return json.loads(x.read() or b'{}')

async def main():
    d = cf('POST', base, {})
    if not d.get('success'): sys.exit('could not open a tail: ' + json.dumps(d.get('errors'))[:300])
    tail = d['result']; tid = tail['id']
    print('tailing %s for %ds (tail %s)' % (name, secs, tid), flush=True)
    try:
        async with websockets.connect(tail['url'], subprotocols=['trace-v1'], max_size=2**22) as ws:
            end = time.time() + secs
            while time.time() < end:
                try: raw = await asyncio.wait_for(ws.recv(), timeout=max(0.5, end - time.time()))
                except asyncio.TimeoutError: break
                ev = json.loads(raw)
                url = (ev.get('event') or {}).get('request', {}).get('url', '') if isinstance(ev.get('event'), dict) else ''
                cron = (ev.get('event') or {}).get('cron') if isinstance(ev.get('event'), dict) else None
                head = url.replace('https://venueplay-game.dean-tindale.workers.dev', '') or (('cron ' + cron) if cron else str(ev.get('scriptName')))
                lines = [' '.join(str(m) for m in l.get('message', [])) for l in ev.get('logs', [])]
                excs = ['EXCEPTION %s: %s' % (x.get('name'), x.get('message')) for x in ev.get('exceptions', [])]
                if not lines and not excs and not want:
                    print('%s %-30s (%s, no log lines)' % (time.strftime('%H:%M:%S'), head[:30], ev.get('outcome')), flush=True)
                for l in lines + excs:
                    if not want or want in l or want in head:
                        print('%s %-30s %s' % (time.strftime('%H:%M:%S'), head[:30], l), flush=True)
                if excs and want and not any(want in l for l in lines + excs): print('%s %-30s %s' % (time.strftime('%H:%M:%S'), head[:30], ' | '.join(excs)), flush=True)
    finally:
        cf('DELETE', base + '/' + tid)
        print('tail closed', flush=True)

asyncio.run(main())
