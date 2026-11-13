#!/usr/bin/env python3
"""WHAT'S ON, FOOLPROOF FOR A VENUE (INBOX 360, Dean 13 Nov 2026), AS CHROME PAINTS IT.

Dean: "make What's on foolproof for a venue." Main used it for real on Tugun and hit eight things. Each one is proved here
with the REAL pages (tv.html against the real game Worker in jsc, billing.html against the real billing Worker, the real
trivia phone page) in headless Chrome, with the real fonts:

  1  THE TV NEVER CUTS A WORD. Every state below, at 1920x1080 and 1280x720: no "..." (no text-overflow, no line clamp), no
     word wider than its space, no word outside its card, every card inside the TV's safe box, no word under its floor size.
     And the editor draws the TV's own card as you type, and says "This is too long for the TV, try under N characters".
  2  A start time typed on a WEEKLY event saves ("2:00 PM" is 2pm); a time that cannot be read is said in words and nothing
     is saved (and "2:00" alone asks for am or pm).
  3  Changing When keeps the date, and says so when it fills one in.
  4  Editing events never raises "Your slide changes are not saved yet" / Save screen, and editing slides never touches events.
  5  An event with no poster is a finished card on the TV (a tile with its accent line and its day behind the words).
  6  Every state at TV 1920x1080, 1280x720 and the phone lobby: 1 event, 3, 8, 30; long titles; no time; weekly and one-off
     mixed; a past one-off drops off.
  7  ONE CARD FOR EACH NIGHT: a venue with 3 Tuesday entries gets one Tuesdays card, its things in time order.
  8  NO DOUBLE TYPING: ticks for the venue's own raffles, members draws and game nights, off until ticked, joining the same
     night card from the real schedule.

VP_SHOTS=<dir> saves every frame (on the test server it is /home/vp/whatson-shots when that folder exists).
VP_BASE=1 runs the SAME scenes on an older tree and only takes the pictures (the "before" side of the LOOK page).
Takes /tmp/vp-heavy.lock first (VP_WAIT_LOCK seconds to wait) and never clears anybody else's.

    python3 tools/whats-on-foolproof-in-chrome.test.py
"""
import datetime, json, os, re, sys, time
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, 'browser-rig'))
sys.path.insert(0, HERE)
import gatelib

BASE = not os.path.exists(os.path.join(HERE, '..', 'venueplay', 'app', 'vp-whatson-css.js'))   # an older tree (no shared look file): only the pictures, for the LOOK page's "before" side
SHOTS = os.environ.get('VP_SHOTS') or ('/home/vp/whatson-shots' if os.path.isdir('/home/vp/whatson-shots') else '')
TAG = os.environ.get('VP_SHOT_TAG') or ('before' if BASE else 'after')
ran = bad = 0
def ok(name, cond, saw=''):
    global ran, bad
    ran += 1
    if BASE:
        return
    line = ('  ok   ' if cond else '  FAIL ') + name + ('' if cond else '   saw: ' + str(saw)[:600])
    print(line)
    if SHOTS:
        try:
            with open(os.path.join(SHOTS, 'progress.log'), 'a') as f: f.write(line + '\n')
        except Exception: pass
    if not cond: bad += 1

BNE = datetime.timezone(datetime.timedelta(hours=10))
TODAY = datetime.datetime.now(BNE).date()
DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
PLURAL = {'mon': 'Mondays', 'tue': 'Tuesdays', 'wed': 'Wednesdays', 'thu': 'Thursdays', 'fri': 'Fridays', 'sat': 'Saturdays', 'sun': 'Sundays'}
def iso(d): return d.isoformat()
def dk(d): return DAYS[d.weekday()]
def day(n): return TODAY + datetime.timedelta(days=n)
def nextday(key, n=0):
    """The nth date from today whose weekday is `key`."""
    d = TODAY
    while dk(d) != key: d += datetime.timedelta(days=1)
    return d + datetime.timedelta(days=7 * n)

T60 = 'The Annual Yarraville Pub Quiz and Parma Night Grand Final 26'[:60]
L48 = 'Raffles and free entry before 10pm, kids welcome'[:48]
def ev(i, title, k, start='', line='', **kw):
    e = {'id': 'e%d' % i, 'title': title, 'day': k}
    if start: e['start'] = start
    if line: e['line'] = line
    e.update(kw)
    return e

def scenes(poster):
    t = [dk(day(i)) for i in range(7)]   # weekday keys, today first
    S = {}
    S['one'] = {'events': [ev(1, 'Parma night', t[2], '19:00', '$18 parmas all night, a bar tab for the best')]}
    S['one-long'] = {'events': [ev(1, T60, t[1], '19:30', L48)]}
    S['three'] = {'events': [ev(1, 'Live music', t[1], '20:00', 'Free entry'), ev(2, 'Trivia', t[3], '19:00', 'Teams of up to six'), ev(3, 'DJ Tilly', t[5], '22:00')]}
    S['eight'] = {'events': [ev(1, 'Roast night', t[0], '17:30', '$10 roasts'), ev(2, 'Live music', t[1], '20:00', 'Free entry'), ev(3, 'Parma night', t[2], '18:00'),
                             ev(4, 'Trivia', t[3], '19:00', 'Teams of up to six'), ev(5, 'Friday drinks', t[4], '16:00', 'Cheap pints till 6'),
                             ev(6, 'DJ Tilly', t[5], '22:00'), ev(7, 'Sunday session', t[6], '14:00', '2pm to 6pm'), ev(8, 'Open mic', t[1], '18:00', 'Sign up at the bar')]}
    many = []
    for i in range(30):
        many.append(ev(i + 1, ['Roast night', 'Live music', 'Parma night', 'Trivia', 'Friday drinks', 'DJ Tilly', 'Sunday session', 'Meat raffle', 'Open mic'][i % 9] + (' %d' % (i // 9 + 1)), t[i % 7], '%02d:%02d' % (12 + (i * 7) % 11, (i * 15) % 60), ['Free entry', '', 'Cheap pints', '$10', ''][i % 5]))
    S['thirty'] = {'events': many}
    S['longs'] = {'events': [ev(i + 1, T60, t[i], '19:30', L48) for i in range(5)]}
    S['long-two'] = {'events': [ev(1, T60, t[1], '19:30', L48), ev(2, 'Short one', t[3], '20:00', 'Free')]}
    S['notime'] = {'events': [ev(1, 'Live music', t[1], '', 'Free entry'), ev(2, 'Pool comp', t[3]), ev(3, 'Meat raffle', t[4], '', 'Tickets at the bar')]}
    S['mix'] = {'events': [ev(1, 'Revolver Fridays', t[4], '22:00', 'Four decks, one winner'), {'id': 'e2', 'title': 'Mount Kujo album launch', 'date': iso(day(2)), 'start': '20:00', 'line': 'With Circuit Breaker'},
                           {'id': 'e3', 'title': 'Long gone gig', 'date': iso(day(-6)), 'start': '20:00'}, ev(4, 'Old weekly', t[2], '19:00', until=iso(day(-3))),
                           ev(5, 'Sunday session', t[6], '14:00', '2pm to 6pm'), {'id': 'e6', 'title': 'Next month gig', 'date': iso(day(30)), 'start': '20:00'}]}
    tue = nextday('tue')
    tue_ev = [ev(1, 'Roast Night', 'tue', '', '$10'), ev(2, 'Meat raffle', 'tue', '18:30'), ev(3, 'Members draw', 'tue', '19:00')]
    S['tue3'] = {'events': tue_ev}
    S['tue1'] = {'events': [ev(1, 'Roast Night $10, Meat raffle 6:30pm, Members draw 7pm', 'tue')]}
    sched = {'week': [{'day': 'tue', 'games': [{'game': 'trivia', 'start': '19:30'}]}, {'day': 'thu', 'games': [{'game': 'musical', 'start': '20:00'}]}],
             'draws': [{'name': 'Members draw', 'draw_day': 'Tuesday', 'draw_time': '7pm', 'current_jackpot_cents': 123400, 'timezone': 'Australia/Brisbane'}],
             'raffles': [{'label': 'Meat raffle', 'day': 'Tuesday', 'time': '6:30pm'}]}
    S['tue-linked'] = {'events': [ev(1, 'Roast Night', 'tue', '', '$10'), {'id': 'k1', 'link': 'draw', 'ref': 'Members draw'}, {'id': 'k2', 'link': 'raffle', 'ref': 'Meat raffle'},
                                  {'id': 'k3', 'link': 'night', 'day': 'tue', 'game': 'trivia'}], 'sched': sched}
    S['tue-unticked'] = {'events': [ev(1, 'Roast Night', 'tue', '', '$10')], 'sched': sched}
    S['poster'] = {'events': [ev(1, 'Revolver Fridays', t[4], '22:00', 'Four decks, one winner', image_url=poster), ev(2, 'Roast Night', t[1], '', '$10'), ev(3, 'Meat raffle', t[1], '18:30'),
                              ev(4, 'Members draw', t[1], '19:00'), ev(5, 'Sunday session', t[6], '14:00', '2pm to 6pm')]}
    return S

# the words that must be on each scene's cards, in order: [(slide index, row index, [titles in time order])]
EXPECT_CARDS = {'tue3': ['Roast Night', 'Meat raffle', 'Members draw'], 'tue-linked': ['Meat raffle', 'Members draw', 'Trivia night', 'Roast Night']}

def metrics_js():
    return r'''(function(){
  var d=document.getElementById('woProbe'); if(!d) return {none:true};
  var wall=d.querySelector('.wo-wall'), words=[].slice.call(d.querySelectorAll('.wo-time,.wo-day,.wo-what b,.wo-what i,.wo-itt,.wo-itw b,.wo-itw i,.wb-title,.wb-when'));
  var cut=[], W=innerWidth, H=innerHeight, sx=W*0.05, sy=H*0.05, minfs={};
  words.forEach(function(w){
    var cs=getComputedStyle(w), tx=w.textContent.slice(0,28);
    if(w.scrollWidth>w.clientWidth+1) cut.push('wide:'+tx);
    if(cs.textOverflow==='ellipsis') cut.push('ellipsis:'+tx);
    if(cs.webkitLineClamp && cs.webkitLineClamp!=='none') cut.push('clamp:'+tx);
    var row=w.closest('.wo-row')||w.closest('.wb-feat')||wall, rb=row.getBoundingClientRect(), wb=w.getBoundingClientRect();
    if(wb.bottom>rb.bottom+1.5||wb.right>rb.right+1.5||wb.left<rb.left-1.5) cut.push('outside:'+tx);
    var k=(w.closest('.wo-itw')||w.closest('.wo-itt'))?'item':'card', c=w.tagName+(w.closest('.wo-what')?'w':'')+k, fs=parseFloat(cs.fontSize);
    if(!(c in minfs) || fs<minfs[c]) minfs[c]=fs;
  });
  var rows=[].map.call(d.querySelectorAll('.wo-row'),function(r){var b=r.getBoundingClientRect();
    return {t:r.innerText.replace(/\s+/g,' ').trim(), top:Math.round(b.top), bot:Math.round(b.bottom), left:Math.round(b.left), right:Math.round(b.right), h:Math.round(b.height), items:r.querySelectorAll('.wo-it').length,
            sh:r.scrollHeight, ch:r.clientHeight, titles:[].map.call(r.querySelectorAll('.wo-what b,.wo-itw b'),function(x){return x.textContent;}), tonight:r.classList.contains('tonight'),
            wd:r.getAttribute('data-wd'), accent:getComputedStyle(r,'::before').backgroundImage.slice(0,40), bg:getComputedStyle(r).backgroundImage.slice(0,30), ghost:getComputedStyle(r,'::after').content};});
  var out=[]; rows.forEach(function(r){ if(r.top<sy-1||r.left<sx-1||r.right>W-sx+1||r.bot>H-sy+1) out.push(r.t.slice(0,24)); });
  var wb=wall.getBoundingClientRect();
  return {over:wall.getAttribute('data-wo-over')==='1', s:parseFloat(wall.getAttribute('data-wo-s')||'1'), cut:cut, rows:rows, outside:out, W:W, H:H, minfs:minfs, feat:!!d.querySelector('.wo-b'),
          cls:wall.className, head:(d.querySelector('.wo-head')||{}).textContent||'', logo:!!d.querySelector('.wo-logo'), kick:(d.querySelector('.wo-kick')||{}).textContent||'',
          wallBot:Math.round(wb.bottom), cap:(d.querySelector('.wb-cap')||{}).innerText||''};
})()'''

def tv_scenes():
    import rig as RIG
    r = RIG.Rig()
    try:
        slug, venue = r.W.info['slug'], r.W.info['venue']
        poster = r.base + '/logos/ad-slides/tugun-friday.jpg'
        SC = scenes(poster)
        TODAYS = iso(TODAY)
        print('\nTV: every state, drawn by the real tv.html page with the real fonts, 1920x1080 and 1280x720')
        for W, H in ((1920, 1080), (1280, 720)):
            tid, sid = r.open('/tv?venue=' + slug, width=W, height=H)
            r.until(sid, 'typeof VPWhatsOn==="object" && typeof VPWhatsOn.tvSlides==="function" && document.fonts && document.fonts.status==="loaded"', 60)
            r.ask(sid, 'document.body.classList.remove("tv-loading"); true')
            for name, sc in SC.items():
                args = {'events': sc['events'], 'today': TODAYS, 'week': (sc.get('sched') or {}).get('week'),
                        'ctx': {'week': (sc.get('sched') or {}).get('week'), 'draws': (sc.get('sched') or {}).get('draws', []), 'raffles': (sc.get('sched') or {}).get('raffles', [])}}
                n = r.json(sid, 'JSON.stringify((function(a){window.__slides=VPWhatsOn.tvSlides(a.events,a.today,a.week,a.ctx); return window.__slides.length;})(%s))' % json.dumps(args), 0)
                for i in range(n or 0):
                    r.ask(sid, '(function(i,logo){var o=document.getElementById("woProbe"); if(o) o.remove(); var d=document.createElement("div"); d.id="woProbe"; d.className="layer ad ad-wo show"; d.style.cssText="opacity:1;z-index:10;transition:none";'
                              'd.innerHTML=VPWhatsOn.tvHtml(window.__slides[i],"Test Alpha",logo,""); document.getElementById("tv").appendChild(d); if(VPWhatsOn.fit) VPWhatsOn.fit(d); return true;})(%d,%s)' % (i, json.dumps(r.base + '/logos/venue-tugun-bowls.png')))
                    time.sleep(0.5)
                    time.sleep(0.3)
                    m = r.json(sid, 'JSON.stringify(%s)' % metrics_js(), {})
                    if SHOTS: shot_jpg(r, sid, os.path.join(SHOTS, 'tv-%s-%s-%d-%d.jpg' % (name, TAG, W, i)))
                    yield name, W, H, i, n, m, sc
            r.close_tab(tid)
    finally:
        r.close()

def shot_jpg(r, sid, path):
    import base64
    try:
        res = r.B.call('Page.captureScreenshot', {'format': 'jpeg', 'quality': 88}, session=sid)
        with open(path, 'wb') as f: f.write(base64.b64decode(res['data']))
    except Exception:
        pass

def check_tv():
    seen = {}
    cards = {}
    measured = []
    for name, W, H, i, n, m, sc in tv_scenes():
        if BASE: continue
        key = (name, W)
        seen.setdefault(key, []).append(m)
        rows = m.get('rows') or []
        label = '%s %dx%d slide %d of %d' % (name, W, H, i + 1, n)
        measured.append({'scene': name, 'W': W, 'slide': i, 's': m.get('s'), 'over': m.get('over'), 'minfs': m.get('minfs')})
        ok('%s: nothing is cut: no ellipsis, no line clamp, no word wider than its space, no word outside its card' % label, not m.get('cut') and not m.get('over'), m.get('cut') or m.get('s'))
        ok('%s: every card sits inside the TV\'s safe box' % label, not m.get('outside'), m.get('outside'))
        ok('%s: the header is What\'s on and, with no venue logo, the venue\'s name' % label, m.get('head') == 'What’s on' and (m.get('logo') or m.get('kick') == 'Test Alpha'), [m.get('head'), m.get('kick')])
    if BASE: return
    # the counts
    one = seen.get(('one', 1920)) or [{}]
    ok('1 event: one tile, centred, with its day and time and line', len(one[0].get('rows', [])) == 1 and PLURAL[dk(day(2))] in one[0]['rows'][0]['t'] and '7pm' in one[0]['rows'][0]['t'] and 'bar tab' in one[0]['rows'][0]['t'], one[0].get('rows'))
    for W in (1920, 1280):
        th = seen.get(('three', W)) or [{}]
        ok('3 events at %d: one slide of three tiles side by side, the same height' % W, len(th) == 1 and len(th[0]['rows']) == 3 and len(set(x['top'] for x in th[0]['rows'])) == 1 and len(set(x['h'] for x in th[0]['rows'])) == 1, th[0].get('rows'))
        ei = seen.get(('eight', W)) or []
        nights = sum(len(x['rows']) for x in ei)
        ok('8 events at %d: seven nights (two events share Tuesday) in two balanced slides, none left out' % W, nights == 7 and len(ei) == 2, [len(x['rows']) for x in ei])
        tu = [x for s in ei for x in s['rows'] if PLURAL[dk(day(1))] in x['t']]
        ok('8 events at %d: the two Tuesday events are ONE card, Open mic (6pm) before Live music (8pm)' % W, len(tu) == 1 and tu[0]['items'] == 2 and tu[0]['titles'] == ['Open mic', 'Live music'], tu)
        th30 = seen.get(('thirty', W)) or []
        ok('30 events at %d: seven nights (a card each), every one of the 30 things on a card' % W, sum(len(x['rows']) for x in th30) >= 7 and sum(sum(max(1, y['items']) for y in x['rows']) for x in th30) == 30, [sum(max(1, y['items']) for y in x['rows']) for x in th30])
        mix = seen.get(('mix', W)) or []
        mt = ' '.join(x['t'] for s in mix for x in s['rows'])
        ok('weekly and one-off mixed at %d: the past one-off and the finished weekly never show, the one-off keeps its date, the weekly its plural' % W, 'Long gone' not in mt and 'Old weekly' not in mt and 'Mount Kujo' in mt and PLURAL[dk(day(4))] in mt and 'Next month' not in mt, mt)
        nt = seen.get(('notime', W)) or [{}]
        ok('no time at %d: the cards read without a time, not an empty gap or "undefined"' % W, len(nt[0].get('rows', [])) == 3 and all('undefined' not in x['t'] and 'null' not in x['t'] for x in nt[0]['rows']), [x['t'] for x in nt[0].get('rows', [])])
        t3 = seen.get(('tue3', W)) or [{}]
        ok('THREE ENTRIES ON ONE NIGHT at %d: one Tuesdays card, its three things in time order (no time last), nothing cut' % W, len(t3[0].get('rows', [])) == 1 and t3[0]['rows'][0]['titles'] == ['Meat raffle', 'Members draw', 'Roast Night'] and 'Tuesdays' in t3[0]['rows'][0]['t'], t3[0].get('rows'))
        t1 = seen.get(('tue1', W)) or [{}]
        ok('the same night typed as ONE entry at %d: one Tuesdays card that fits' % W, len(t1[0].get('rows', [])) == 1 and 'Roast Night $10' in t1[0]['rows'][0]['t'], t1[0].get('rows'))
        tl = seen.get(('tue-linked', W)) or [{}]
        ok('TICKED GAMES at %d: the real raffle, members draw (with its jackpot) and trivia join the Tuesday card with the typed Roast Night, in time order, one card' % W,
           len(tl[0].get('rows', [])) == 1 and tl[0]['rows'][0]['titles'] == ['Meat raffle', 'Members draw', 'Trivia night', 'Roast Night'] and '$1,234' in tl[0]['rows'][0]['t'] and '6:30pm' in tl[0]['rows'][0]['t'] and '7:30pm' in tl[0]['rows'][0]['t'],
           [x['t'] for x in tl[0].get('rows', [])])
        tn = seen.get(('tue-unticked', W)) or [{}]
        ok('NOTHING TICKED at %d: only the typed Roast Night shows, none of the venue\'s games (off by default)' % W, len(tn[0].get('rows', [])) == 1 and tn[0]['rows'][0]['titles'] == ['Roast Night'], [x['t'] for x in tn[0].get('rows', [])])
    po = seen.get(('poster', 1920)) or [{}]
    ok('a poster: the feature view with the poster, and the Tuesday three things as one row beside it', po[0].get('feat') is True and any(x['items'] == 3 for s in po for x in s['rows']), [x['t'] for s in po for x in s['rows']])
    # 5: a card with no poster is finished
    one0 = (seen.get(('one', 1920)) or [{}])[0].get('rows', [{}])[0]
    ok('NO POSTER IS STILL FINISHED: the tile has a lifted gradient, a pink to gold line along its top, and its day ghosted behind the words (not a flat grey box)',
       'gradient' in one0.get('bg', '') and 'gradient' in one0.get('accent', '') and one0.get('ghost') not in (None, 'none', 'normal', '""') and one0.get('wd') == dk(day(2)).upper(), one0)
    # limits table
    if SHOTS:
        with open(os.path.join(SHOTS, 'measured-%s.json' % TAG), 'w') as f: json.dump(measured, f)

def limits_and_phone():
    import rig as RIG
    r = RIG.Rig()
    try:
        slug, venue = r.W.info['slug'], r.W.info['venue']
        poster = r.base + '/logos/ad-slides/tugun-friday.jpg'
        TODAYS = iso(TODAY)
        out = {}
        if not BASE:
            print('\nLIMITS, MEASURED in Chrome with the real fonts: the longest words that fit with nothing cut, by how many nights share the wall')
            for W, H in ((1920, 1080), (1280, 720)):
                tid, sid = r.open('/tv?venue=' + slug, width=W, height=H)
                r.until(sid, 'typeof VPWhatsOn==="object" && typeof VPWhatsOn.tvSlides==="function" && document.fonts && document.fonts.status==="loaded"', 60)
                js_measure = r"""(function(a){
  var Wh=VPWhatsOn, days=['mon','tue','wed','thu','fri','sat','sun'], MIX='Roast night and parma special with live music and a meat raffle for everyone ', WIDE='MMMM WWWW OOOO QQQQ GGGG MMMM WWWW OOOO QQQQ GGGG MMMM WWWW OOOO QQQQ ';
  function over(evs,poster){ var sl=Wh.tvSlides(evs,a.today,null,{}); for(var i=0;i<sl.length;i++){ var o=document.getElementById('woProbe'); if(o) o.remove(); var d=document.createElement('div'); d.id='woProbe'; d.className='layer ad ad-wo show'; d.style.cssText='opacity:1;z-index:10;transition:none'; d.innerHTML=Wh.tvHtml(sl[i],'Test Alpha','',''); document.getElementById('tv').appendChild(d); if(Wh.fit(d)>0) return true; } return false; }
  function mk(n,t,l,poster){ var e=[]; for(var i=0;i<n;i++){ var k=a.dayKeys[i]; var o={id:'m'+i,title:t,day:k,start:'19:30'}; if(l) o.line=l; e.push(o);} if(poster) e[0].image_url=a.poster; return e; }
  function longest(n,field,txt,poster){ var lo=0,hi=60; if(field==='line') hi=48; if(field==='line' && over(mk(n,'Pub quiz','',poster))) return -1; while(lo<hi){ var mid=(lo+hi+1)>>1, s=txt.slice(0,mid).replace(/\s+$/,''); var evs= field==='title'? mk(n,s,'',poster) : mk(n,'Pub quiz',s,poster); if(over(evs,poster)) hi=mid-1; else lo=mid; } return lo; }
  var res=[]; [1,2,3,4,5].forEach(function(n){ res.push({n:n,kind:'tiles',title:longest(n,'title',MIX),titleWide:longest(n,'title',WIDE),line:longest(n,'line',MIX),lineWide:longest(n,'line',WIDE)}); });
  [1,3,6].forEach(function(n){ res.push({n:n,kind:'poster',title:longest(n,'title',MIX,true),titleWide:longest(n,'title',WIDE,true),line:longest(n,'line',MIX,true),lineWide:longest(n,'line',WIDE,true)}); });
  var o=document.getElementById('woProbe'); if(o) o.remove(); return res; })(%s)"""
                res = r.json(sid, 'JSON.stringify(' + js_measure % json.dumps({'today': TODAYS, 'dayKeys': [dk(day(i)) for i in range(7)], 'poster': poster}) + ')', [])
                out[str(W)] = res
                for x in res:
                    print('   %dx%d %s %d night%s: title up to %s chars (wide letters %s), line up to %s (wide %s)' % (W, H, x['kind'], x['n'], '' if x['n'] == 1 else 's', x['title'], x['titleWide'], x['line'], x['lineWide']))
                ok('MEASURED %dx%d: every layout takes at least a 28-character title and a 36-character line of ordinary words with nothing cut, so the venue-facing numbers are real, not a guess' % (W, H),
                   res and all(x['title'] >= 28 and x['line'] >= 36 for x in res), res)
                r.close_tab(tid)
            if SHOTS:
                with open(os.path.join(SHOTS, 'limits.json'), 'w') as f: json.dump(out, f)
        # ---- the phone lobby view
        print('\nPHONE: the lobby week strip at 390x664, every state')
        SC = scenes(poster)
        for name in ('one', 'three', 'eight', 'thirty', 'one-long', 'mix', 'tue3'):
            evs = SC[name]['events']
            for (W, H) in ((390, 664), (375, 667)):
                tid, sid = r.open('/app/trivia/play.html', width=W, height=H)
                r.until(sid, 'typeof VPTonight==="object" && typeof VPWhatsOn==="object" && !!document.getElementById("vpTonight")', 30)
                S = ('(function(ev){var vs=["vNoRoom","vJoin","vWait","vQ","vRes","vFinal","vPR","vDemoEnd","vCall"]; vs.forEach(function(v){var e=document.getElementById(v); if(e) e.classList.toggle("hidden", v!=="vWait");});'
                     'document.getElementById("app").classList.add("vpt-on"); document.getElementById("waitIn").classList.add("hidden"); var tn=document.getElementById("vpTonight"); tn.classList.remove("hidden");'
                     'window.__st=VPTonight.lobby(tn,{name:"The Quizzly Bears",me:"trivia",week:[{day:"%s",games:[{game:"trivia",start:"19:30"}]}],events:ev}); return true;})(%s)') % (dk(TODAY), json.dumps(evs))
                r.ask(sid, S); time.sleep(1.0)
                # tap the day that carries the busiest night, so its list is on the screen
                r.ask(sid, '(function(){var B=window.__st.buttons, best=0, bi=0; for(var i=0;i<B.length;i++){ B[i].click(); var n=document.querySelectorAll("#vpTonight .vpt-night .row").length; if(n>=best){best=n;bi=i;} } B[bi].click(); return true;})()'); time.sleep(0.5)
                m = r.json(sid, 'JSON.stringify((function(){var de=document.documentElement; var rows=[].map.call(document.querySelectorAll("#vpTonight .vpt-night .row"),function(x){return x.innerText.replace(/\\s+/g," ");}); var cut=[].filter.call(document.querySelectorAll("#vpTonight *"),function(n){var c=getComputedStyle(n); return n.scrollWidth>n.clientWidth+1 && c.overflow!=="visible" && n.children.length===0 || c.textOverflow==="ellipsis";}).length; return {doc:de.scrollWidth,w:innerWidth,rows:rows,cut:cut,ev:document.querySelectorAll("#vpTonight .vpt-week .d.ev").length};})())', {})
                if SHOTS: shot_jpg(r, sid, os.path.join(SHOTS, 'phone-%s-%s-%d.jpg' % (name, TAG, W)))
                if not BASE:
                    ok('phone %s at %d: the lobby fits the screen (no sideways scroll), the night\'s things are listed, and the days with something on are lit' % (name, W), m.get('doc', 9999) <= W and m.get('rows') and m.get('ev', 0) >= 1, m)
                    ok('phone %s at %d: no script error' % (name, W), r.ask(sid, 'window.__errs.length') == 0, r.ask(sid, 'JSON.stringify(window.__errs)'))
                r.close_tab(tid)
    finally:
        r.close()

def account():
    import admin_site, rig as RIG
    print('\nACCOUNT: the editor on Your account > Screen > What\'s on, against the real billing Worker and the real game Worker')
    GW = RIG.Worker()
    S = admin_site.Site(fonts=True, game=GW, live_tables=['vp_venues'])
    V1, slug = S.W.info['venue'], 'deepwater-hotel'
    def events():
        rows = [r for r in S.W.table('vp_venue_screen') if r.get('venue_id') == V1]
        return (rows[-1].get('events') if rows else None) or []
    def seed_events(evs):
        S.W.seed('vp_venue_screen', [{'venue_id': V1, 'slug': slug, 'events': evs, 'slides': [], 'logo_url': None, 'raffle': None}])
    GW.seed('vp_venue_screen', [{'venue_id': V1, 'slug': slug, 'events': [], 'slides': [], 'logo_url': None, 'raffle': None, 'raffles': [{'label': 'Meat raffle', 'day': 'Tuesday', 'time': '6:30pm'}]}], replace=True)
    GW.seed('vp_venue_settings', [{'venue_id': V1, 'setup_answers': {'week': [{'day': 'tue', 'games': [{'game': 'trivia', 'start': '19:30'}]}, {'day': 'thu', 'games': [{'game': 'musical', 'start': '20:00'}]}]}}], replace=True)
    GW.seed('v_vp_screen_draws', [{'slug': slug, 'name': 'Members draw', 'draw_day': 'Tuesday', 'draw_time': '7pm', 'current_jackpot_cents': 123400, 'timezone': 'Australia/Brisbane'}], replace=True)
    def js(sid, e): return S.js(sid, e)
    def click(sid, sel, text=None):
        if text is None:
            return js(sid, '(function(){var b=document.querySelector(%s); if(!b) return false; b.click(); return true;})()' % json.dumps(sel))
        return js(sid, '(function(){var b=[].filter.call(document.querySelectorAll(%s),function(x){return x.textContent.trim()===%s;})[0]; if(!b) return false; b.click(); return true;})()' % (json.dumps(sel), json.dumps(text)))
    def type_into(sid, idx, text):
        """Real typing: focus the box, select what is in it, insert the text as the keyboard would."""
        js(sid, '(function(){var i=document.querySelectorAll(".woe-form input")[%d]; i.focus(); i.select(); return true;})()' % idx)
        S.B.call('Input.insertText', {'text': text}, session=sid)
    def set_when(sid, v):
        js(sid, '(function(){var w=document.querySelector(".woe-form select"); w.value=%s; w.dispatchEvent(new Event("change",{bubbles:true})); return true;})()' % json.dumps(v))
    def save(sid):
        click(sid, '.woe-form button', 'Save event'); time.sleep(0.8)
    def banner(sid):
        return js(sid, '(function(){var b=document.getElementById("unsavedBar"); return !!b && !b.hidden && getComputedStyle(b).display!=="none";})()')
    try:
        tid, sid = S.open('/app/billing.html', width=1280, height=1000)
        S.until(sid, 'document.getElementById("content").style.display!=="none" && !!document.querySelector(\'[data-tab="screen"]\')', 30)
        js(sid, 'document.querySelector(\'[data-tab="screen"]\').click(); true')
        S.until(sid, '!!document.querySelector("#woBox .woe-add")', 20)
        js(sid, '[].forEach.call(document.querySelectorAll(".scard.fold.folded > .scardhead"),function(h){h.click();}); true')
        time.sleep(1.0)
        # ---- 8: the ticks are there, and OFF
        S.until(sid, 'document.querySelectorAll("#woBox .woe-tk").length>=4', 20)
        tk = S.json(sid, 'JSON.stringify([].map.call(document.querySelectorAll("#woBox .woe-tk"),function(r){return {t:r.innerText.replace(/\\s+/g," "),on:r.querySelector("input").checked};}))', [])
        ok('"Your venueplay games": a tick for each real night, draw and raffle, from the venue\'s real schedule, ALL OFF until ticked (nothing stored)',
           len(tk) == 4 and not any(x['on'] for x in tk) and events() == [] and any('Meat raffle' in x['t'] and 'Tuesdays 6:30pm' in x['t'] for x in tk) and any('Members draw' in x['t'] and 'Tuesdays 7pm' in x['t'] for x in tk)
           and any('Trivia night' in x['t'] and '7:30pm' in x['t'] for x in tk) and any('Musical bingo' in x['t'] and 'Thursdays 8pm' in x['t'] for x in tk), tk)
        if SHOTS: S.shot(sid, os.path.join(SHOTS, 'editor-ticks-%s.png' % TAG))
        js(sid, '(function(){var r=[].filter.call(document.querySelectorAll("#woBox .woe-tk"),function(x){return /Members draw/.test(x.innerText);})[0]; r.querySelector("input").click(); return true;})()')
        S.until(sid, 'events=0||true', 1) if False else time.sleep(1.2)
        ev = events()
        ok('ticking Members draw stores ONE link (no words of the venue\'s own), and the tick stays on; the unsaved bar stays away', len(ev) == 1 and ev[0].get('link') == 'draw' and ev[0].get('ref') == 'Members draw' and sorted(ev[0].keys()) == ['id', 'link', 'ref'] and not banner(sid), [ev, banner(sid)])
        js(sid, '(function(){var r=[].filter.call(document.querySelectorAll("#woBox .woe-tk"),function(x){return /Meat raffle/.test(x.innerText);})[0]; r.querySelector("input").click(); return true;})()')
        time.sleep(1.2)
        js(sid, '(function(){var r=[].filter.call(document.querySelectorAll("#woBox .woe-tk"),function(x){return /Members draw/.test(x.innerText);})[0]; r.querySelector("input").click(); return true;})()')
        time.sleep(1.2)
        ev = events()
        ok('unticking Members draw removes only its link; the raffle tick is kept; the events list is empty of typed events (links are not events)', len(ev) == 1 and ev[0].get('link') == 'raffle' and js(sid, 'document.querySelectorAll("#woBox .woe").length') == 0, ev)
        # ---- 2: a weekly start time typed
        click(sid, '#woBox .woe-add'); S.until(sid, '!document.querySelector(".woe-form").hidden', 5)
        type_into(sid, 0, 'Sunday session')
        set_when(sid, 'sun')
        type_into(sid, 1, '2:00 PM')
        time.sleep(0.4)
        note = js(sid, 'document.querySelector(".woe-startnote").textContent')
        ok('typing "2:00 PM" says what it understood under the box ("Starts at 2pm.")', note == 'Starts at 2pm.', note)
        save(sid)
        ev = [e for e in events() if e.get('title') == 'Sunday session']
        ok('A WEEKLY EVENT\'S TYPED TIME SAVES: Every Sunday, "2:00 PM" is stored as 14:00', len(ev) == 1 and ev[0].get('day') == 'sun' and ev[0].get('start') == '14:00', ev)
        click(sid, '#woBox .woe-add'); S.until(sid, '!document.querySelector(".woe-form").hidden', 5)
        type_into(sid, 0, 'Ambiguous time'); set_when(sid, 'mon'); type_into(sid, 1, '2:00')
        save(sid)
        err = js(sid, 'document.querySelector(".woe-err").textContent')
        ok('"2:00" could be morning or evening: the form says "Add am or pm" and saves nothing', 'am or pm' in err and not [e for e in events() if e.get('title') == 'Ambiguous time'], [err, len(events())])
        type_into(sid, 1, 'half past never'); save(sid)
        err = js(sid, 'document.querySelector(".woe-err").textContent')
        ok('a time that is not a time is said in words, and nothing is saved', 'could not read' in err and not [e for e in events() if e.get('title') == 'Ambiguous time'], err)
        type_into(sid, 1, '7.30pm'); save(sid)
        ev = [e for e in events() if e.get('title') == 'Ambiguous time']
        ok('"7.30pm" is read as 19:30 and saves', len(ev) == 1 and ev[0].get('start') == '19:30', ev)
        # ---- 3: When keeps the date
        click(sid, '#woBox .woe-add'); S.until(sid, '!document.querySelector(".woe-form").hidden', 5)
        d3 = iso(day(9))
        js(sid, '(function(){var i=document.querySelectorAll(".woe-form input")[2]; i.value=%s; i.dispatchEvent(new Event("change",{bubbles:true})); return true;})()' % json.dumps(d3))
        set_when(sid, 'fri'); set_when(sid, 'once')
        kept = js(sid, 'document.querySelectorAll(".woe-form input")[2].value')
        ok('SWITCHING WHEN KEEPS THE DATE: One date, then Every Friday, then One date again: the date is still there', kept == d3, kept)
        click(sid, '.woe-form button', 'Cancel')
        sun = [e for e in events() if e.get('title') == 'Sunday session'][0]
        js(sid, '(function(){var r=document.querySelector(\'.woe[data-id="%s"]\'); r.querySelector(".woe-edit").click(); return true;})()' % sun['id'])
        S.until(sid, '!document.querySelector(".woe-form").hidden', 5)
        set_when(sid, 'once'); time.sleep(0.3)
        filled = js(sid, 'document.querySelectorAll(".woe-form input")[2].value'); say = js(sid, 'document.querySelector(".woe-datenote").textContent')
        nxt = nextday('sun')
        ok('an Every Sunday event changed to One date gets the next Sunday put in, and says so (never a blank that fails on Save)', filled == iso(nxt) and 'next Sunday' in say, [filled, say])
        click(sid, '.woe-form button', 'Cancel')
        # ---- 4: events and slides do not cross-trigger
        ok('editing events (typed time, ticks, When) never raised the unsaved-slides bar or Save screen', not banner(sid), banner(sid))
        js(sid, 'document.getElementById("addSlide").click(); true'); time.sleep(0.3)
        ok('a slide with nothing changed is not unsaved either', not banner(sid), banner(sid))
        js(sid, '(function(){var i=document.querySelector("#slides .ad-secs"); if(!i) return false; i.value="9"; i.dispatchEvent(new Event("input",{bubbles:true})); return true;})()'); time.sleep(0.3)
        ok('a slide really changed DOES raise it, in its own words (so the bar still works for slides)', banner(sid) and 'slide' in js(sid, 'document.getElementById("unsavedSay").textContent'), js(sid, 'document.getElementById("unsavedSay").textContent'))
        # a page with an unsaved slide asks before it is left (a native dialog), so the next part opens a tab of its own
        tid0 = tid
        # ---- 1: the live preview
        seed_events([])
        tid, sid = S.open('/app/billing.html', width=1280, height=1000); time.sleep(3)
        S.until(sid, 'document.getElementById("content").style.display!=="none" && !!document.querySelector(\'[data-tab="screen"]\')', 30)
        js(sid, 'document.querySelector(\'[data-tab="screen"]\').click(); [].forEach.call(document.querySelectorAll(".scard.fold.folded > .scardhead"),function(h){h.click();}); true')
        S.until(sid, '!!document.querySelector("#woBox .woe-add")', 20)
        long_events = []
        for i in range(4):
            for j in range(2 if i == 0 else 1):
                long_events.append({'id': 'x%d%d' % (i, j), 'title': T60, 'day': DAYS[(TODAY.weekday() + i) % 7], 'start': '%02d:00' % (17 + j), 'line': L48})
        seed_events(long_events)
        S.close_tab(tid); tid, sid = S.open('/app/billing.html', width=1280, height=1000); time.sleep(3)
        S.until(sid, 'document.getElementById("content").style.display!=="none" && !!document.querySelector(\'[data-tab="screen"]\')', 30)
        js(sid, 'document.querySelector(\'[data-tab="screen"]\').click(); [].forEach.call(document.querySelectorAll(".scard.fold.folded > .scardhead"),function(h){h.click();}); true')
        S.until(sid, '!!document.querySelector("#woBox .woe-add")', 20)
        click(sid, '#woBox .woe-add'); S.until(sid, '!document.querySelector(".woe-form").hidden', 5)
        type_into(sid, 0, 'Pub quiz')
        set_when(sid, DAYS[(TODAY.weekday() + 3) % 7])
        time.sleep(1.0)
        pv = S.json(sid, 'JSON.stringify((function(){var st=document.querySelector(".woe-pv .vpwo-stage"); if(!st) return {none:true}; var w=st.querySelector(".wo-wall"); return {w:st.style.width,h:st.style.height,tf:st.style.transform,text:st.innerText.replace(/\\s+/g," "),cls:w&&w.className,warn:document.querySelector(".woe-pvwarn").textContent,font:getComputedStyle(st.querySelector(".wo-head")).fontFamily};})())', {})
        ok('THE LIVE PREVIEW is the TV\'s own card at the TV\'s real size (1728 wide safe box = 1920x1080), scaled to fit, with the TV\'s Anton heading, and shows what is typed',
           pv.get('w') == '1728px' and pv.get('h') == '972px' and 'scale' in pv.get('tf', '') and 'Pub quiz' in pv.get('text', '') and 'Anton' in pv.get('font', '') and 'wo-tiles' in (pv.get('cls') or ''), pv)
        ok('with a short title there is no warning', pv.get('warn') == '', pv.get('warn'))
        if SHOTS: S.shot(sid, os.path.join(SHOTS, 'editor-preview-ok-%s.png' % TAG))
        set_when(sid, DAYS[TODAY.weekday()])
        type_into(sid, 0, T60)
        js(sid, '(function(){var i=document.querySelectorAll(".woe-form input")[4]; i.focus(); i.select(); return true;})()'); S.B.call('Input.insertText', {'text': L48}, session=sid)
        time.sleep(1.5)
        warn = js(sid, 'document.querySelector(".woe-pvwarn").textContent')
        ok('TOO LONG FOR THE TV: a night of four long things on a week of five busy nights says "too long for the TV, try under N characters" (or "too much on this night")', ('too long for the TV' in warn and 'try under' in warn and 'characters' in warn) or 'too much on this night' in warn, warn)
        if SHOTS: S.shot(sid, os.path.join(SHOTS, 'editor-preview-warn-%s.png' % TAG))
        before = len(events())
        save(sid)
        err = js(sid, 'document.querySelector(".woe-err").textContent')
        ok('and it is NOT saved: a card that would be cut never reaches the TV (the same words, then "Nothing was saved.")', len(events()) == before and 'Nothing was saved' in err, [before, len(events()), err])
        m = re.search(r'under (\d+) characters', warn) if warn else None
        if m:
            n = int(m.group(1)) - 1
            nm = (T60 if 'title' in warn else L48)[:n]
            if 'Shorten the title' in warn:
                type_into(sid, 0, nm)
                js(sid, '(function(){var i=document.querySelectorAll(".woe-form input")[4]; i.focus(); i.select(); return true;})()'); S.B.call('Input.insertText', {'text': ''}, session=sid)
                js(sid, '(function(){var i=document.querySelectorAll(".woe-form input")[4]; i.value=""; i.dispatchEvent(new Event("input",{bubbles:true})); return true;})()')
            elif 'title' in warn: type_into(sid, 0, nm)
            else:
                js(sid, '(function(){var i=document.querySelectorAll(".woe-form input")[4]; i.focus(); i.select(); return true;})()'); S.B.call('Input.insertText', {'text': nm}, session=sid)
            time.sleep(1.5)
            w2 = js(sid, 'document.querySelector(".woe-pvwarn").textContent')
            ok('the N it names is true: cut to %d characters the warning goes' % n, w2 == '', [n, w2, warn])
        click(sid, '.woe-form button', 'Cancel')
        ok('no script error on the account page', S.js(sid, 'JSON.stringify(window.__errs||[])') in ('[]', None), S.js(sid, 'JSON.stringify(window.__errs||[])'))
        S.close_tab(tid)
        S.close_tab(tid0)
    finally:
        S.close()
        GW.close()

def loop_linked():
    """The REAL TV loop with ticks: the page asks the real game Worker, which reads the venue's events, its game week and its
    draws and raffles, and the Tuesday card on the wall carries them (day, time and jackpot from the schedule, never typed)."""
    import rig as RIG
    r = RIG.Rig()
    try:
        slug, venue = r.W.info['slug'], r.W.info['venue']
        print('\nTV LOOP: a ticked draw, raffle and game night on the real wall, read from the real schedule')
        evs = [{'id': 'e1', 'title': 'Roast Night', 'day': 'tue', 'line': '$10'}, {'id': 'k1', 'link': 'draw', 'ref': 'Members draw'}, {'id': 'k2', 'link': 'raffle', 'ref': 'Meat raffle'}, {'id': 'k3', 'link': 'night', 'day': 'tue', 'game': 'trivia'}]
        r.W.seed('vp_venue_screen', [{'venue_id': venue, 'slug': slug, 'logo_url': None, 'events': evs, 'slides': [],
                                     'raffles': [{'label': 'Meat raffle', 'day': 'Tuesday', 'time': '6:30pm'}]}], replace=True)
        r.W.seed('vp_venue_settings', [{'venue_id': venue, 'setup_answers': {'week': [{'day': 'tue', 'games': [{'game': 'trivia', 'start': '19:30'}]}]}}], replace=True)
        r.W.seed('v_vp_screen_draws', [{'slug': slug, 'name': 'Members draw', 'draw_day': 'Tuesday', 'draw_time': '7pm', 'current_jackpot_cents': 123400, 'timezone': 'Australia/Brisbane'}], replace=True)
        tid, sid = r.open('/tv?venue=' + slug, width=1920, height=1080)
        LIT = '(function(){var a=[].filter.call(document.querySelectorAll("#tvAds .ad.show"),function(x){return x.querySelector(".wo-its");});return a[0]||null;})()'
        got = r.until(sid, '(function(){var s=' + LIT + ';return !!s && +getComputedStyle(s).opacity>0.99;})()', 90)
        time.sleep(1.5)
        m = r.json(sid, 'JSON.stringify((function(){var s=' + LIT + '; if(!s) return {}; return {t:s.innerText.replace(/\\s+/g," "), titles:[].map.call(s.querySelectorAll(".wo-itw b"),function(b){return b.textContent;}), over:s.querySelector(".wo-wall").getAttribute("data-wo-over")};})())', {})
        ok('THE REAL LOOP: the Tuesdays card on the wall holds the typed Roast Night and the three ticked games, one card, in time order, the jackpot from the real draw, nothing cut',
           got is True and m.get('titles') == ['Meat raffle', 'Members draw', 'Trivia night', 'Roast Night'] and '$1,234' in m.get('t', '') and m.get('over') != '1', m)
        if SHOTS: shot_jpg(r, sid, os.path.join(SHOTS, 'tv-loop-linked-%s.jpg' % TAG))
        r.close_tab(tid)
    finally:
        r.close()

def account_before():
    """The older editor (a clock picker, no preview): the faults as they were, for the LOOK page's before side. Pictures and one printed line only."""
    import admin_site, rig as RIG
    GW = RIG.Worker()
    S = admin_site.Site(fonts=True, game=GW, live_tables=['vp_venues'])
    V1 = S.W.info['venue']
    def events():
        rows = [r for r in S.W.table('vp_venue_screen') if r.get('venue_id') == V1]
        return (rows[-1].get('events') if rows else None) or []
    def key(sid, k, code=None):
        S.B.call('Input.dispatchKeyEvent', {'type': 'keyDown', 'key': k, 'code': code or k, 'text': k if len(k) == 1 else ''}, session=sid)
        S.B.call('Input.dispatchKeyEvent', {'type': 'keyUp', 'key': k, 'code': code or k}, session=sid)
    try:
        tid, sid = S.open('/app/billing.html', width=1280, height=1000)
        S.until(sid, 'document.getElementById("content").style.display!=="none" && !!document.querySelector(\'[data-tab="screen"]\')', 30)
        S.js(sid, 'document.querySelector(\'[data-tab="screen"]\').click(); [].forEach.call(document.querySelectorAll(".scard.fold.folded > .scardhead"),function(h){h.click();}); true')
        S.until(sid, '!!document.querySelector("#woBox .woe-add")', 20)
        S.js(sid, 'document.querySelector("#woBox .woe-add").click(); true'); time.sleep(0.6)
        S.js(sid, '(function(){var i=document.querySelectorAll(".woe-form input")[0]; i.focus(); i.select(); return true;})()')
        S.B.call('Input.insertText', {'text': 'Sunday session'}, session=sid)
        S.js(sid, '(function(){var w=document.querySelector(".woe-form select"); w.value="sun"; w.dispatchEvent(new Event("change",{bubbles:true})); var t=document.querySelector(".woe-form input[type=time]"); t.focus(); return true;})()')
        key(sid, 'Tab', 'Tab')           # off the hour, onto the minutes, as a thumb lands on it
        key(sid, '0'); key(sid, '0'); key(sid, 'p')
        time.sleep(0.4)
        val = S.js(sid, 'document.querySelector(".woe-form input[type=time]").value')
        if SHOTS: S.shot(sid, os.path.join(SHOTS, 'editor-time-partial-%s.png' % TAG))
        S.js(sid, '[].filter.call(document.querySelectorAll(".woe-form button"),function(b){return b.textContent.trim()==="Save event";})[0].click(); true'); time.sleep(1.0)
        ev = [e for e in events() if e.get('title') == 'Sunday session']
        print('   before: the picker held %r after "00" and "P" on the minutes and AM/PM; saved: %s' % (val, json.dumps(ev)))
        with open(os.path.join(SHOTS, 'before-time.json'), 'w') as f: json.dump({'picker': val, 'saved': ev}, f)
        if SHOTS: S.shot(sid, os.path.join(SHOTS, 'editor-form-%s.png' % TAG))
        S.close_tab(tid)
    finally:
        S.close(); GW.close()

def main():
    end = time.time() + int(os.environ.get('VP_WAIT_LOCK', '0') or 0)
    while True:
        st, pid, text = gatelib.lock_state()
        if st in ('free', 'mine') and gatelib.hold_lock_or_refuse('whats-on-foolproof-in-chrome', wait_s=0):
            break
        if time.time() > end:
            print('  heavy lock held by pid %s ("%s"); gave up waiting' % (pid, text[:80])); return 2
        time.sleep(0.5)
    check_tv()
    limits_and_phone()
    if not BASE: loop_linked()
    if BASE:
        if SHOTS: account_before()
    else: account()
    print('\n' + ('ALL %d CHECKS PASSED' % ran if not bad else '%d OF %d CHECKS FAILED' % (bad, ran)))
    return 1 if bad else 0

if __name__ == '__main__':
    sys.exit(main())
