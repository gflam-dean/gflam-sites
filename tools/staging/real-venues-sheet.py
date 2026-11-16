#!/usr/bin/env python3
"""THE CONTACT SHEET: one page per staging run, for a person to LOOK at (Dean, 15 Nov 2026: test as a person looks).

    python3 tools/staging/real-venues-sheet.py <run dir>      writes <run dir>/index.html from results.json + the PNGs
    python3 tools/staging/real-venues-sheet.py --day <dir>    writes <dir>/index.html linking every run in it

Each game and mode is one band: the two TVs (1920x1080 and 1280x720) frame by frame, the host console at 390x844 and
375x667, the phones. A TV frame where the venue shows more than once (its logo and its name in words, or twice either
way), or with a Hosted by card beside them, has a red FLAG and the reason, so the doubled-branding fault of 15 Nov is
looked at, never passed by a word check. A console frame whose main button sits below the screen says so. The checks
that went red are listed at the top. Nothing here judges a frame for the person: it puts every frame in front of them.
"""
import html, json, os, sys

CSS = """
:root{--bg:#f6f6f8;--fg:#141416;--soft:#5b5b66;--line:#dedee6;--card:#fff;--bad:#b00040;--badbg:#fff0f4;--ok:#0a7a45}
@media (prefers-color-scheme: dark){:root{--bg:#121216;--fg:#ececf1;--soft:#a3a3b0;--line:#2c2c36;--card:#1b1b22;--bad:#ff6b93;--badbg:#2a1520;--ok:#4fd18b}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.45 -apple-system,system-ui,Segoe UI,Roboto,sans-serif}
main{max-width:1500px;margin:0 auto;padding:20px 16px 60px}h1{font-size:24px;margin:0 0 4px}h2{font-size:19px;margin:34px 0 8px}
h3{font-size:15px;margin:16px 0 6px;color:var(--soft);font-weight:600}.sub{color:var(--soft);margin:0 0 14px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 16px;margin:10px 0}
.bad{color:var(--bad)}.okc{color:var(--ok)}ul{margin:6px 0;padding-left:20px}li{margin:3px 0}
.row{display:flex;gap:10px;overflow-x:auto;padding-bottom:6px}.f{flex:0 0 auto;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:6px}
.f.flag{border:2px solid var(--bad);background:var(--badbg)}.f img{display:block;border-radius:6px;background:#000}
.tv img{width:340px;height:auto}.tv.s720 img{width:250px}.con img{width:170px;height:auto}.ph img{width:150px}
.cap{font-size:12px;color:var(--soft);max-width:340px;margin-top:4px;word-break:break-word}.cap b{color:var(--fg)}
.tag{display:inline-block;font-size:11px;font-weight:700;padding:1px 6px;border-radius:6px;background:var(--bad);color:#fff;margin-right:4px}
table{border-collapse:collapse;width:100%;font-size:13px}td,th{border-bottom:1px solid var(--line);padding:5px 6px;text-align:left;vertical-align:top}
a{color:inherit}nav a{margin-right:12px}
"""
ORDER = ['tv', 'trivia', 'musical', 'bingo', 'raffle', 'members', 'signup', 'first-game']
NAMES = {'tv': 'TV on its ads', 'trivia': 'Trivia', 'musical': 'Musical bingo', 'bingo': 'Bingo', 'raffle': 'Raffle',
         'members': 'Members draw', 'signup': 'Sign-up and setup', 'first-game': 'First game'}
MODES = {'-': '', 'nophone': 'host only, 0 phones', 'phones': '2 phones', 'phone': '1 phone'}


def e(s):
    return html.escape(str(s if s is not None else ''))


def brand_line(b):
    if not b:
        return ''
    bits = []
    if b.get('logos'): bits.append('logo x%d' % len(b['logos']))
    if b.get('names'): bits.append('name in words x%d' % len(b['names']))
    if b.get('hosted'): bits.append('hosted by')
    return ', '.join(bits) or 'no venue logo or name'


def frame(f):
    k = f.get('kind'); b = f.get('brand') or {}
    flag = (k == 'tv' and b.get('count', 0) > 1)
    main = f.get('main') or {}
    lowbtn = k == 'console' and main.get('main') and not main.get('onscreen')
    cls = 'f %s%s%s' % ({'tv': 'tv', 'console': 'con', 'phone': 'ph'}.get(k, 'con'), ' s720' if f.get('size') == '720' else '', ' flag' if (flag or lowbtn) else '')
    cap = '<b>%s</b> %s' % (e(f.get('step')), e(f.get('size')))
    if k == 'tv' and f.get('size') == '1080':
        cap += '<br>' + ('<span class="tag">FLAG</span>' if flag else '') + e(brand_line(b))
        if flag:
            cap += '<br>' + e('; '.join((b.get('logos') or []) + (b.get('names') or []) + (b.get('hosted') or []))[:300])
    if k == 'console':
        cap += '<br>' + (('<span class="tag">BELOW</span>' + e('"%s" at %s of %s px' % (main.get('main'), main.get('bottom'), main.get('vh')))) if lowbtn
                         else e('main: %s' % (main.get('main') or 'none seen')))
    if f.get('note'):
        cap += '<br>' + e(f['note'])
    src = e(f.get('png') or '')
    return '<div class="%s"><a href="%s" target="_blank"><img loading="lazy" src="%s" alt="%s"></a><div class="cap">%s</div></div>' % (cls, src, src, e(f.get('step')), cap)


def sheet(run):
    d = json.load(open(os.path.join(run, 'results.json')))
    v = d.get('venue', {}); res = d.get('results', []); fr = [f for f in d.get('frames', []) if f.get('png')]
    fails = [r for r in res if not r['ok']]
    flags = [f for f in fr if f.get('kind') == 'tv' and (f.get('brand') or {}).get('count', 0) > 1]
    title = '%s, staging run %s' % (v.get('name', d.get('plan_label', '')), d.get('started', ''))
    out = ['<!doctype html><html lang="en-AU"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
           '<title>Staging contact sheet</title><style>%s</style></head><body><main>' % CSS,
           '<p class="sub"><a href="../index.html">All runs today</a></p><h1>%s</h1>' % e(title),
           '<p class="sub">%s %s, %s. Staging build: %s. %d checks, <span class="%s">%d red</span>; %d TV frames where the venue shows more than once.</p>'
           % (e(v.get('slug')), e(v.get('state', '')), e(v.get('id')), e(d.get('build') or 'not recorded'), len(res), 'bad' if fails else 'okc', len(fails), len(flags))]
    if d.get('summary'):
        out.append('<div class="card">%s</div>' % d['summary'])
    nav = []
    games = [g for g in ORDER if any(f.get('game') == g for f in fr)] + sorted({f.get('game') for f in fr} - set(ORDER))
    for g in games:
        nav.append('<a href="#%s">%s</a>' % (e(g), e(NAMES.get(g, g))))
    subs = sorted(n for n in os.listdir(run) if os.path.exists(os.path.join(run, n, 'index.html')))
    for n in subs:   # a sign-up run's first games are their own sheets, one folder each
        nav.append('<a href="%s/index.html"><b>%s</b></a>' % (e(n), e(n.replace('-', ' '))))
    out.append('<nav class="card">%s</nav>' % ' '.join(nav))
    if fails:
        out.append('<div class="card"><b class="bad">Red checks (%d)</b><table><tr><th>Game</th><th>Mode</th><th>Check</th><th>What it saw</th></tr>' % len(fails))
        for r in fails:
            out.append('<tr><td>%s</td><td>%s</td><td>%s</td><td>%s</td></tr>' % (e(r['game']), e(MODES.get(r['mode'], r['mode'])), e(r['step']), e(r['note'][:400])))
        out.append('</table></div>')
    for g in games:
        out.append('<h2 id="%s">%s</h2>' % (e(g), e(NAMES.get(g, g))))
        modes = []
        for f in fr:
            if f.get('game') == g and f.get('mode') not in modes:
                modes.append(f.get('mode'))
        for m in modes:
            band = [f for f in fr if f.get('game') == g and f.get('mode') == m]
            if MODES.get(m, m):
                out.append('<h3>%s</h3>' % e(MODES.get(m, m)))
            for kind, lab in (('tv', 'TVs'), ('console', 'Host console'), ('phone', 'Phones'), ('page', 'Pages')):
                fs = [f for f in band if f.get('kind', 'page') == kind]
                if fs:
                    out.append('<div class="sub">%s</div><div class="row">%s</div>' % (lab, ''.join(frame(f) for f in fs)))
    out.append('</main></body></html>')
    open(os.path.join(run, 'index.html'), 'w').write('\n'.join(out))
    print('contact sheet', os.path.join(run, 'index.html'), '| red', len(fails), '| flagged TV frames', len(flags))


def day(root):
    rows = []
    for name in sorted(os.listdir(root)):
        p = os.path.join(root, name, 'results.json')
        if not os.path.exists(p):
            continue
        d = json.load(open(p)); res = d.get('results', [])
        flags = [f for f in d.get('frames', []) if f.get('kind') == 'tv' and (f.get('brand') or {}).get('count', 0) > 1]
        rows.append('<tr><td><a href="%s/index.html">%s</a></td><td>%s</td><td>%d</td><td class="%s">%d</td><td>%d</td></tr>' % (
            e(name), e(d.get('venue', {}).get('name', name)), e(d.get('started', '')), len(res),
            'bad' if any(not r['ok'] for r in res) else 'okc', sum(1 for r in res if not r['ok']), len(flags)))
    page = ('<!doctype html><html lang="en-AU"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
            '<title>Staging real venues</title><style>%s</style></head><body><main><h1>Staging: real-looking venues</h1>'
            '<p class="sub">Every game at each venue, host only and with 2 phones, every TV frame and console screen. Open a run to look.</p>'
            '<div class="card"><table><tr><th>Run</th><th>Started</th><th>Checks</th><th>Red</th><th>Flagged TV frames</th></tr>%s</table></div>'
            '</main></body></html>') % (CSS, ''.join(rows))
    open(os.path.join(root, 'index.html'), 'w').write(page)
    print('day index', os.path.join(root, 'index.html'))


if __name__ == '__main__':
    if sys.argv[1:2] == ['--day']:
        day(sys.argv[2])
    else:
        sheet(sys.argv[1])
