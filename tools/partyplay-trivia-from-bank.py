#!/usr/bin/env python3
"""Build PartyPlay's static trivia packs from the VenuePlay question bank.

WHY A BUILD STEP AND NOT A SHARED TABLE.

PartyPlay reads these packs as static JSON straight off the CDN: no auth, no Worker
call, no database. That is why the build page is instant on a phone with two bars, and
it is the right trade for a product somebody bought an hour before their party. The
VenuePlay bank lives in Supabase behind RLS. Wiring the two together at runtime would
mean an endpoint, an auth path and a new way for a party to fail on the one night it
matters. So the bank is the SOURCE and these files are the OUTPUT, regenerated when you
want them and committed like any other asset.

WHY AN ALLOWLIST, AND WHY IT IS THE POINT.

12,744 easy questions sit across 699 categories. "Ancient Persia and its empire" is a
fine pub question and the wrong thing to put in front of a nine year old at a birthday.
Every PartyPlay pack carries the same promise on its face:

    a nine year old and a grandparent should both know it

So nothing is included unless a category is explicitly mapped below. An unmapped
category is DROPPED, not guessed at. Adding to this map is a judgement about a party,
not a technical change, and it should be made by a person.

LICENSING IS CARRIED THROUGH, NOT REWRITTEN. The bank mixes CC BY-SA 4.0 imports with
VenuePlay originals, so the compiled collection is CC BY-SA 4.0 and the attribution
strings must travel with it. This copies the licence block off the existing packs
rather than inventing one.

    python3 tools/partyplay-trivia-from-bank.py            # report only, writes nothing
    python3 tools/partyplay-trivia-from-bank.py --write    # write the packs
"""
import json, os, sys, urllib.request, collections, re, io, random
from pathlib import Path

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PACKS = os.path.join(ROOT, 'partyplay', 'data', 'trivia')
ENV = Path.home() / '.gflam-migrate.env'

# PartyPlay pack slug  ->  the bank categories that belong in it.
# Deliberately conservative. Anything not named here is dropped.
MAP = {
  'animals':            ['Nature & Animals', 'Animals'],
  'books':              ['Books & Literature', 'Literature'],
  'film':               ['Movies & TV', 'Film & TV', 'Blockbuster movies and franchises'],
  'food-drink':         ['Food & Drink'],
  'general-knowledge':  ['General Knowledge', 'General knowledge', 'Language & Words',
                         'Maths & Puzzles', 'Hobbies & Collectables'],
  'geography':          ['World Geography', 'Australian Geography', 'Geography'],
  'history':            ['Australian History', 'World History', 'Modern History', 'History'],
  'music':              ['Music', '1990s music', 'The 1980s', 'The 1990s'],
  'science-nature':     ['Space & Astronomy', 'Science & Nature', 'Science'],
  'television':         ['Cartoons and animation', 'Anime, Comics & Cartoons'],
  'video-games':        ['Video Games'],
  # New packs this bank can support that PartyPlay never had.
  'australiana':        ['Australiana', 'Pub Culture', 'Australian Sport'],
  'kids-and-family':    ['Kids & Family', 'Christmas'],
  'sport':              ['Sport', 'International Sport', 'AFL (Australian Football League)',
                         'AFL players, clubs and Grand Finals', 'AFL, NRL and Aussie sport'],
  'brands-and-ads':     ['Brands & Advertising', 'Advertising mascots, logos and jingles'],
  'cars':               ['Cars & Motoring'],
}
TITLES = {
  'animals':'Animals','books':'Books','film':'Film','food-drink':'Food and drink',
  'general-knowledge':'General knowledge','geography':'Geography','history':'History',
  'music':'Music','science-nature':'Science and nature','television':'Cartoons and TV',
  'video-games':'Video games','australiana':'Very Australian','kids-and-family':'Kids and family',
  'sport':'Sport','brands-and-ads':'Brands and ads','cars':'Cars',
}
# A question is dropped if it trips any of these, whatever its category says.
BLOCK = re.compile(r'\b(sex|sexual|porn|drug|cocaine|heroin|suicide|rape|murder|'
                   r'genocide|massacre|brothel|prostitut|cannabis|marijuana)\b', re.I)

# STRICTER FOR ONE PACK ONLY. PartyPlay is sold for parties and mostly to adults, so a
# bourbon question in food-drink or a Guinness question in australiana is where it
# belongs. "kids-and-family" is the one pack whose NAME is a promise to a parent, and
# the first pass put "which spice-heavy hot drink is popular at European Christmas
# markets" (mulled wine) in it. So that pack, and only that pack, drops drink questions.
STRICT = {'kids-and-family'}
DRINK = re.compile(r'\b(beer|wine|whisky|whiskey|vodka|gin|rum|bourbon|lager|ale|stout|'
                   r'pint|brewery|brewing|cocktail|champagne|spirits|liqueur|tequila|'
                   r'cider|schooner|middy|bartender|mulled|alcohol)\b', re.I)
MIN_OPTIONS = 3

def die(m): print('STOP: ' + m); sys.exit(1)

def creds():
    if not ENV.exists(): die('%s is missing' % ENV)
    if oct(ENV.stat().st_mode)[-3:] != '600': die('%s must be mode 600' % ENV)
    e = {}
    for line in ENV.read_text().splitlines():
        if '=' in line and not line.startswith('#'):
            k, v = line.split('=', 1); e[k.strip()] = v.strip()
    u, k = e.get('NEW_SUPABASE_URL',''), e.get('NEW_SERVICE_KEY','')
    if not u or not k: die('NEW_SUPABASE_URL and NEW_SERVICE_KEY must be in %s' % ENV)
    return u, k

def fetch(url, key):
    out, off = [], 0
    while True:
        req = urllib.request.Request(
            '%s/rest/v1/vp_questions?select=question,options,correct_index,category,difficulty'
            '&difficulty=eq.easy&limit=1000&offset=%d' % (url, off),
            headers={'apikey':key,'Authorization':'Bearer '+key,
                     'User-Agent':'curl/8.7.1','Accept':'*/*'})
        with urllib.request.urlopen(req, timeout=60) as r:
            rows = json.loads(r.read() or b'[]')
        if not rows: break
        out += rows; off += 1000
        if len(rows) < 1000: break
    return out

def licence_block():
    """Carried off an existing pack. The bank mixes CC BY-SA imports, so share-alike
       travels with anything compiled out of it."""
    src = os.path.join(PACKS, 'animals.json')
    if not os.path.exists(src): die('cannot find an existing pack to copy the licence from')
    d = json.load(open(src, encoding='utf-8'))
    return {k: d[k] for k in ('license','licenseUrl','sources','attributions','shareAlikeNote') if k in d}

def main():
    write = '--write' in sys.argv
    url, key = creds()
    rows = fetch(url, key)
    print('easy questions in the bank: %d\n' % len(rows))

    want = {}
    for slug, cats in MAP.items():
        for c in cats: want[c] = slug

    buckets = collections.defaultdict(list)
    seen = set()
    dropped = collections.Counter()
    for q in rows:
        cat = (q.get('category') or '').strip()
        slug = want.get(cat)
        if not slug: dropped['category not on the allowlist'] += 1; continue
        text = (q.get('question') or '').strip()
        opts = q.get('options') or []
        ci = q.get('correct_index')
        if not text or not isinstance(opts, list) or len(opts) < MIN_OPTIONS:
            dropped['too few options'] += 1; continue
        if ci is None or ci < 0 or ci >= len(opts):
            dropped['bad correct_index'] += 1; continue
        blob = text + ' ' + ' '.join(str(o) for o in opts)
        if BLOCK.search(blob): dropped['blocked wording'] += 1; continue
        if slug in STRICT and DRINK.search(blob):
            dropped['drink question kept out of a kids pack'] += 1; continue
        k = text.lower()
        if k in seen: dropped['duplicate'] += 1; continue
        seen.add(k)
        buckets[slug].append({'q': text, 'options': [str(o) for o in opts],
                              'answer': str(opts[ci]), 'd': 'easy'})

    # MERGE, NEVER REPLACE. The first run of this would have shrunk animals from 156 to
    # 68, food-drink from 134 to 99 and geography from 217 to 153, because the bank's
    # easy set is not a superset of what was hand-picked for these packs. Losing curated
    # questions to a regeneration is the kind of thing nobody notices for months.
    merged = {}
    for slug in sorted(set(list(buckets) + [f[:-5] for f in os.listdir(PACKS)
                                            if f.endswith('.json') and f != 'index.json'])):
        cur = os.path.join(PACKS, slug + '.json')
        existing = []
        if os.path.exists(cur):
            existing = json.load(open(cur, encoding='utf-8')).get('questions', [])
        have = set((q.get('q') or '').strip().lower() for q in existing)
        added = [q for q in buckets.get(slug, []) if q['q'].strip().lower() not in have]
        merged[slug] = existing + added
        print('%-22s %5d kept + %4d new = %5d' % (slug, len(existing), len(added), len(merged[slug])))
    print('-'*52)
    print('%-22s %26d\n' % ('TOTAL', sum(len(v) for v in merged.values())))
    print('dropped:')
    for k, v in dropped.most_common(): print('  %-34s %d' % (k, v))

    if not write:
        print('\nNothing written. Re-run with --write to build the packs.')
        return

    lic = licence_block()
    random.seed(11)
    index = dict(lic); index['categories'] = []
    for slug in sorted(merged):
        qs = merged[slug][:]; random.shuffle(qs)
        pack = dict(lic)
        pack.update({'category': TITLES.get(slug, slug), 'count': len(qs), 'questions': qs})
        with io.open(os.path.join(PACKS, slug + '.json'), 'w', encoding='utf-8') as f:
            f.write(json.dumps(pack, indent=1, ensure_ascii=False) + '\n')
        index['categories'].append({'category': TITLES.get(slug, slug), 'slug': slug,
                                    'count': len(qs), 'file': 'data/trivia/%s.json' % slug})
    with io.open(os.path.join(PACKS, 'index.json'), 'w', encoding='utf-8') as f:
        f.write(json.dumps(index, indent=1, ensure_ascii=False) + '\n')
    print('\nWrote %d packs and index.json' % len(merged))

main()
