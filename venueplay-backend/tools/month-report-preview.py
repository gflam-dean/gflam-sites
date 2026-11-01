#!/usr/bin/env python3
"""THE MONTHLY REPORT FOR ONE VENUE, RENDERED FROM LIVE DATA TO A LOCAL FILE. Sends nothing.

    python3 venueplay-backend/tools/month-report-preview.py                 Test Alpha, last month
    python3 venueplay-backend/tools/month-report-preview.py --month 2026-10 --slug test-alpha
    python3 venueplay-backend/tools/month-report-preview.py --out ~/venue-enrich/reports
    python3 venueplay-backend/tools/month-report-preview.py --news draft.json   a draft "What's new"
                                     ([{"title": ..., "text": ..., "link": ...}]) instead of the saved one

WHAT IT DOES. Reads ONE venue's rows for the month and the year before it from the live database,
READ ONLY (GET requests and nothing else), asking only for the columns the report counts with: ids,
times, device ids, formats, scores and team names. Never a player's name, email, mobile or postcode,
and the opt-ins are read as a time and nothing else. Then it runs the REAL billing Worker
(venueplay-api-FULL.js, on tools/rig-billing-worker.js) over those rows with jsc, so the email and
the page numbers are what the Worker would produce, and writes:

    venue-report-<slug>-<month>-email.html     the email exactly as it would go (to nobody)
    venue-report-<slug>-<month>.json           what /account/month-report would answer

It prints counts only. The rows it read are kept in its own temp folder and deleted after.
Run from anywhere; it finds the repo from where it lives.
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)
from vp_live import live  # noqa: E402


def arg(flag, default):
    return sys.argv[sys.argv.index(flag) + 1] if flag in sys.argv else default


def get_all(L, table, query):
    """Every row, a page at a time, stopping only on an EMPTY page (PostgREST stops at 1000)."""
    out, offset = [], 0
    while True:
        url = '%s/rest/v1/%s?%s&limit=1000&offset=%d' % (L.rest_url, table, query, offset)
        req = urllib.request.Request(url, method='GET', headers={'apikey': L.service_key, 'Authorization': 'Bearer ' + L.service_key})
        with urllib.request.urlopen(req, timeout=30) as r:
            rows = json.loads(r.read().decode('utf-8'))
        if not isinstance(rows, list):
            raise SystemExit('%s did not answer with a list' % table)
        if not rows:
            return out
        out += rows
        offset += len(rows)


def window(month):
    import datetime as dt
    y, m = int(month[:4]), int(month[5:7])
    prev = dt.datetime(y - 1, 12, 1) if m == 1 else dt.datetime(y, m - 1, 1)
    nxt = dt.datetime(y + 1, 1, 1) if m == 12 else dt.datetime(y, m + 1, 1)
    f = lambda d: d.strftime('%Y-%m-%dT%H:%M:%SZ')
    return f(prev - dt.timedelta(days=2)), f(nxt + dt.timedelta(days=2)), f(prev - dt.timedelta(days=365))


def inl(ids):
    return '(' + ','.join(urllib.parse.quote(str(i)) for i in ids) + ')'


def chunks(ids, n=60):
    for i in range(0, len(ids), n):
        yield ids[i:i + n]


def main():
    import datetime as dt
    slug = arg('--slug', 'test-alpha')
    now = dt.datetime.utcnow() + dt.timedelta(hours=8)          # Brisbane, on the 2am clock
    last = (now.replace(day=1) - dt.timedelta(days=1)).strftime('%Y-%m')
    month = arg('--month', last)
    out_dir = os.path.expanduser(arg('--out', '~/venue-enrich/reports'))
    L = live()
    print(L.banner())
    venues = get_all(L, 'vp_venues', 'slug=eq.%s&select=id,name,slug,status,timezone,founding_id,created_at&order=id.asc' % urllib.parse.quote(slug))
    if len(venues) != 1:
        raise SystemExit('no single venue with the slug %s' % slug)
    v = venues[0]
    frm, to, look = window(month)
    sessions = get_all(L, 'vp_sessions', 'venue_id=eq.%s&and=(created_at.gte.%s,created_at.lt.%s)&select=id,venue_id,created_at,opened_at,started_at,ended_at&order=id.asc' % (v['id'], look, to))
    recent = [s['id'] for s in sessions if s['created_at'] >= frm]
    games, players, boards, cards = [], [], [], []
    for c in chunks(recent):
        games += get_all(L, 'vp_games', 'session_id=in.%s&select=id,session_id,format,started_at&order=id.asc' % inl(c))
    for c in chunks([s['id'] for s in sessions]):
        players += get_all(L, 'vp_players', 'session_id=in.%s&select=id,session_id,device_id,is_test,kicked,joined_at,played_at&order=id.asc' % inl(c))
    trivia = [g['id'] for g in games if str(g.get('format')) == 'trivia']
    musical = [g['id'] for g in games if str(g.get('format')) in ('musical', 'musical_bingo')]
    for c in chunks(trivia):
        boards += get_all(L, 'v_vp_trivia_leaderboard', 'game_id=in.%s&select=game_id,player_id,display_name,points&order=game_id.asc,player_id.asc' % inl(c))
    for c in chunks(musical):
        cards += get_all(L, 'vp_cards', 'game_id=in.%s&select=id,game_id,player_id&order=id.asc' % inl(c))
    reports = get_all(L, 'vp_game_reports', 'venue_id=eq.%s&and=(created_at.gte.%s,created_at.lt.%s)&select=id,venue_id,format,players,started_at,ended_at,created_at&order=id.asc' % (v['id'], frm, to))
    optins = get_all(L, 'v_vp_player_optins', 'venue_id=eq.%s&and=(opted_in_at.gte.%s,opted_in_at.lt.%s)&select=venue_id,opted_in_at&order=opted_in_at.asc' % (v['id'], frm, to))
    try:
        news = get_all(L, 'vp_monthly_news', 'month=eq.%s&select=month,items,ready&order=month.asc' % month)
    except Exception:
        news = []                                                 # migration 133 not run yet
    # the slide tally (migration 135) and the venue's own slide headings; before 135 there is no table
    try:
        shows = get_all(L, 'vp_screen_shows', 'venue_id=eq.%s&and=(night.gte.%s,night.lte.%s)&select=venue_id,night,screen_id,slide_key,shows,seconds&order=night.asc,screen_id.asc,slide_key.asc' % (v['id'], frm[:10], to[:10]))
    except Exception:
        shows = None
    screens = get_all(L, 'vp_venue_screen', 'venue_id=eq.%s&select=venue_id,slides&order=venue_id.asc' % v['id']) if shows else []
    if '--news' in sys.argv:
        with open(os.path.expanduser(arg('--news', ''))) as f:
            news = [{'month': month, 'items': json.load(f), 'ready': True}]
    print('read %s for %s: %d sessions, %d games, %d player rows, %d leaderboard rows, %d cards, %d end reports, %d opt-ins'
          % (v['name'], month, len(sessions), len(games), len(players), len(boards), len(cards), len(reports), len(optins)))

    tmp = tempfile.mkdtemp(prefix='month-report-')
    try:
        snap = os.path.join(tmp, 'rows.json')
        with open(snap, 'w') as f:
            json.dump({'month': month, 'venue': v, 'tables': {'vp_venues': [v], 'vp_sessions': sessions, 'vp_games': games, 'vp_players': players,
                       'v_vp_trivia_leaderboard': boards, 'vp_cards': cards, 'vp_game_reports': reports, 'v_vp_player_optins': optins,
                       'vp_monthly_news': news, 'vp_screen_shows': shows, 'vp_venue_screen': screens}}, f)
        driver = os.path.join(tmp, 'driver.js')
        with open(driver, 'w') as f:
            f.write(DRIVER)
        res = subprocess.run(['jsc', driver, '--', snap], cwd=ROOT, capture_output=True, text=True, timeout=300)
        if res.returncode != 0 or '<<<JSON' not in res.stdout:
            raise SystemExit('the Worker did not render: ' + (res.stdout + res.stderr)[-1500:])
        js = res.stdout.split('<<<JSON\n', 1)[1].split('\nJSON>>>', 1)[0]
        html = res.stdout.split('<<<HTML\n', 1)[1].split('\nHTML>>>', 1)[0]
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    os.makedirs(out_dir, exist_ok=True)
    base = os.path.join(out_dir, 'venue-report-%s-%s%s' % (slug, month, '-with-news' if '--news' in sys.argv else ''))
    with open(base + '-email.html', 'w') as f:
        f.write(html)
    with open(base + '.json', 'w') as f:
        f.write(js)
    a = json.loads(js)['report']['this_month']
    print('%s %s: %d nights, %d players, %d phones, %d came back, %d new, %d opt-ins'
          % (v['name'], month, a['nights'], a['player_visits'], a['unique_phones'], a['returning'], a['new_phones'], a['optins']))
    print('wrote ' + base + '-email.html')
    print('wrote ' + base + '.json')


DRIVER = r"""
load('tools/rig-billing-worker.js');
function fnv(bytes, seed) { var out = new Uint8Array(32), h = (2166136261 ^ seed) >>> 0; for (var r = 0; r < 32; r++) { for (var i = 0; i < bytes.length; i++) { h ^= bytes[i] + r; h = Math.imul(h, 16777619) >>> 0; } out[r] = h & 255; } return out; }
if (typeof TextEncoder === 'undefined') { TextEncoder = function () {}; TextEncoder.prototype.encode = function (s) { s = unescape(encodeURIComponent(String(s))); var a = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return a; }; }
if (typeof crypto === 'undefined') crypto = { subtle: { importKey: function (f, raw) { return Promise.resolve({ k: fnv(new Uint8Array(raw), 2)[0] }); },
  sign: function (a, key, data) { return Promise.resolve(fnv(new Uint8Array(data), 3 + key.k).buffer); } } };
var snap = JSON.parse(readFile(arguments[0]));
DB = snap.tables;
var SHOWS_MISSING = DB.vp_screen_shows === null;      // migration 135 not run: answer 404 as the live database does
if (SHOWS_MISSING) delete DB.vp_screen_shows;
var RIG_FETCH = globalThis.fetch;
globalThis.fetch = function (url, opts) {
  if (SHOWS_MISSING && String(url).indexOf('/rest/v1/vp_screen_shows') !== -1)
    return Promise.resolve({ ok: false, status: 404, json: function () { return Promise.resolve({}); }, text: function () { return Promise.resolve('missing'); } });
  return RIG_FETCH(url, opts);
};
(async function () {
  var v = snap.venue;
  var rep = (await vprMonth(ENV, [v], snap.month, Date.now()))[v.id];
  var news = (DB.vp_monthly_news[0] && DB.vp_monthly_news[0].items) || [];
  var mail = await vprEmailHtml(ENV, v, rep, { to: 'preview@venueplay.com.au', news: news });
  print('<<<JSON\n' + JSON.stringify({ ok: true, venue: { id: v.id, name: v.name }, venues: [{ id: v.id, name: v.name }], months: vprMonthsFor(v, Date.now()), report: rep, subject: mail.subject }) + '\nJSON>>>');
  print('<<<HTML\n' + mail.html + '\nHTML>>>');
})().catch(function (e) { print('FAILED ' + e + '\n' + (e && e.stack)); });
"""

if __name__ == '__main__':
    main()
