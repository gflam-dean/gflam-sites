#!/usr/bin/env python3
"""Build the question file for /live-here-now (the drink-coaster QR) from VenuePlay's own trivia bank.

WHAT THE PAGE IS. A punter scans the coaster ("VENUEPLAY IS LIVE HERE. Scan for 60 seconds of
trivia while you wait for your drink"), gets five questions, a score and "Beat the table?". No
name, no room code, no server. The page loads ONE static file, this script's output, so a scan
costs no database call and no Worker call, and the phone does the rest (which hour's set, which
questions it has already shown).

WHERE THE QUESTIONS COME FROM. venueplay-backend/data/trivia-library.json, the master copy of the
bank the trivia nights play from, which is fact-checked (see the memory file venueplay-trivia-bank).
Only questions marked "VenuePlay Original" are taken: the Creative Commons imports were removed from
the bank on 20 Aug 2026 and must never come back through a side door like this one. Nothing is
written here; every question is the bank's own words, options and answer.

WHAT IS LEFT OUT, AND WHY. Sixty seconds at the bar, read on a phone, by anybody:
  - easy only, so it is fun and fast, not a quiz night
  - nothing that needs a picture or a sound ("pictured", "this logo", "listen")
  - nothing that can date ("currently", "the latest", "this year", any year from 2015 on, "who is
    the captain of"), because a coaster sits on a table for a year
  - nothing crude or grim (the PartyPlay block list, plus war, death and gambling: this is a pub
    with a pokies room next door, not a history exam)
  - nothing seasonal (Christmas, Halloween, Movember and the like) that would read oddly in July
  - long questions and long options, so four answers fit as big buttons on a 320 px phone
  - a cap per bank category, so an hour is a mix and not twelve questions about owls

WHY THE OPTION ORDER IS SHUFFLED HERE. The bank's correct answers are spread evenly over A to D
already, but the house style writes one "ridiculous" option per question and writers tend to put it
last. A fixed seed keeps the build reproducible: the same bank gives the same file, byte for byte.

    python3 tools/live-here-now-bank.py            # report only, writes nothing
    python3 tools/live-here-now-bank.py --write    # write venueplay/data/live-here-now.json
"""
import hashlib, io, json, os, random, re, sys, collections

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BANK = os.path.join(ROOT, 'venueplay-backend', 'data', 'trivia-library.json')
OUT = os.path.join(ROOT, 'venueplay', 'data', 'live-here-now.json')

TARGET = 900          # about 180 scans' worth before one phone could see a question twice
PER_CATEGORY = 4      # no category may fill an hour on its own
MAX_Q = 110           # characters: two or three lines at 320 px
MAX_OPT = 30          # characters: one or two lines inside a thumb-sized button

NEEDS_A_PICTURE = re.compile(
    r'\b(pictur\w*|image|photo\w*|shown|show here|above|below|this (logo|flag|map|symbol|sign|painting)|'
    r'listen\w*|hear\w*|audio|sound(s)? like|clip|emoji)\b', re.I)
DATES = re.compile(
    r'\b(current\w*|now|today|latest|newest|recent\w*|this year|last year|next year|as of|reigning|'
    r'incumbent|so far|to date|still|most recent|nowadays|at present|present day|these days|'
    r'record[- ]?holder|holds the record|all[- ]time|ever)\b|\b20(1[5-9]|2\d)\b|'
    # league tables that move: "the world's largest producer of wine" was Italy one year, France the next
    r'\b(largest|biggest|top|leading) (producer|exporter|importer|consumer|economy|employer)|'
    r'\bmost (popular|populous|visited|followed|watched|streamed|subscribed|downloaded|valuable)\b|'
    r'\b(best|highest)[- ](selling|paid|grossing|rated)\b|\brichest\b', re.I)
ROLE_NOW = re.compile(
    r'\b(is|are)\s+(the\s+)?(ceo|president|prime minister|premier|captain|coach|leader|monarch|'
    r'host|presenter|mayor|chief|head|owner|manager|governor)\b', re.I)
GRIM = re.compile(
    r'\b(sex\w*|porn\w*|drug\w*|cocaine|heroin|suicide|rape|murder\w*|genocide|massacre\w*|brothel|'
    r'prostitut\w*|cannabis|marijuana|nazi\w*|hitler|holocaust|terror\w*|slave\w*|kill\w*|killed|'
    r'death|dead|die|died|dies|dying|war|wars|battle\w*|bomb\w*|weapon\w*|gun\w*|assassin\w*|'
    r'execut\w*|disaster\w*|crash\w*|sank|sinking|shipwreck\w*|crime\w*|criminal\w*|prison\w*|'
    r'jail\w*|robber\w*|heist\w*|theft|stole|stolen|gambl\w*|casino\w*|pokies|betting|bet|poker|blood\w*|corpse|coffin|funeral|disease\w*|'
    r'cancer|virus|plague|pandemic|toilet|vomit\w*|naked|nude|bum|breast\w*|penis|vagina|'
    r'religio\w*|god|gods|jesus|christ|allah|bible|quran|church|mosque|temple|politic\w*|'
    r'election\w*|party)\b', re.I)
SEASONAL = re.compile(r'christmas|halloween|movember|easter|diwali|remembrance|anzac|pride|'
                      r'valentine|new year|melbourne cup|eurovision|festival|holiday', re.I)
BAD_CATEGORY = re.compile(r'war|battle|siege|crime|trial|heist|robber|spy|spies|disaster|shipwreck|'
                          r'gambl|casino|religio|mytholog|politic|prime minister|leader|royal|'
                          r'king|queen|empire|dynast|pirate|outlaw|wild west|survival|'
                          r'medicine|doctor|human body|mind|news', re.I)


def short_id(bank_id):
    """Seven characters is plenty for 900 rows (and is checked unique below); the phone keeps a
       list of these, so short is the point."""
    return hashlib.sha1(bank_id.encode('utf-8')).hexdigest()[:7]


def why_not(q):
    if (q.get('source') or '').strip().lower() != 'venueplay original':
        return 'not marked VenuePlay Original'
    if not q.get('id'):
        return 'no bank id'
    if q.get('difficulty') != 'easy':
        return 'not easy'
    text = (q.get('question') or '').strip()
    opts = [str(o).strip() for o in (q.get('options') or [])]
    ci = q.get('correctIndex')
    if len(opts) != 4 or len(set(o.lower() for o in opts)) != 4 or any(not o for o in opts):
        return 'not four distinct options'
    if not isinstance(ci, int) or not 0 <= ci < 4:
        return 'bad correctIndex'
    if q.get('answer') is not None and str(q['answer']).strip() != opts[ci]:
        return 'answer does not match its option'
    if not text.endswith('?'):
        return 'not a question'
    if len(text) > MAX_Q or any(len(o) > MAX_OPT for o in opts):
        return 'too long for a phone'
    cat = q.get('category') or ''
    blob = text + ' ' + ' '.join(opts)
    if BAD_CATEGORY.search(cat) or SEASONAL.search(cat):
        return 'category not for the bar'
    if NEEDS_A_PICTURE.search(text):
        return 'needs a picture or a sound'
    if DATES.search(blob) or ROLE_NOW.search(text):
        return 'could date'
    if GRIM.search(blob) or SEASONAL.search(blob):
        return 'grim, crude or seasonal'
    if re.search(r'\b(not|never|except)\b', text, re.I) and re.search(r'\bwhich\b', text, re.I):
        return 'a "which is NOT" question (slow to read at a bar)'
    if re.search(r'\ball of the above|none of the above|both\b', ' '.join(opts), re.I):
        return '"all of the above" style option'
    return None


def build():
    bank = json.load(io.open(BANK, encoding='utf-8'))
    rows = bank['questions']
    dropped = collections.Counter()
    keep = []
    seen_text = set()
    for q in rows:
        r = why_not(q)
        if r:
            dropped[r] += 1
            continue
        k = re.sub(r'[^a-z0-9]', '', q['question'].lower())
        if k in seen_text:
            dropped['duplicate wording'] += 1
            continue
        seen_text.add(k)
        keep.append(q)
    # The cap per category, taken in a fixed shuffled order so no one writer's batch dominates.
    rnd = random.Random(20261031)
    rnd.shuffle(keep)
    per = collections.Counter()
    chosen = []
    # NEAR-DUPLICATES. The bank holds the same fact written twice by two batches ("one small step
    # for man, one giant leap for..." with and without "Neil Armstrong said"). Two of those in one
    # scan reads like a fault, so a question that shares its answer and most of its words with one
    # already chosen is skipped.
    taken = []
    def words(t):
        return set(w for w in re.findall(r'[a-z]+', t.lower()) if len(w) > 3)
    for q in keep:
        if per[q['category']] >= PER_CATEGORY:
            continue
        w, ans = words(q['question']), str(q['options'][q['correctIndex']]).strip().lower()
        if any((a == ans and len(w & w2) >= 2) or (w and len(w & w2) / float(len(w | w2)) > 0.5)
               for w2, a in taken):
            dropped['near-duplicate of one already chosen'] += 1
            continue
        taken.append((w, ans))
        per[q['category']] += 1
        chosen.append(q)
        if len(chosen) >= TARGET:
            break
    chosen.sort(key=lambda q: q['id'])
    out = []
    ids = set()
    for q in chosen:
        opts = [str(o).strip() for o in q['options']]
        right = opts[q['correctIndex']]
        order = list(range(4))
        random.Random(q['id']).shuffle(order)
        opts2 = [opts[i] for i in order]
        sid = short_id(q['id'])
        if sid in ids:
            raise SystemExit('STOP: two questions share the short id %s; lengthen short_id' % sid)
        ids.add(sid)
        out.append([sid, q['question'].strip(), opts2, opts2.index(right)])
    return out, dropped, len(keep), per


def main():
    out, dropped, eligible, per = build()
    print('bank: %s' % os.path.relpath(BANK, ROOT))
    print('eligible after the filters: %d; chosen: %d across %d categories (at most %d each)'
          % (eligible, len(out), len(per), PER_CATEGORY))
    print('dropped:')
    for k, v in dropped.most_common():
        print('  %-48s %d' % (k, v))
    doc = {
        'what': 'Questions for venueplay.com.au/live-here-now, the drink-coaster QR. Built by '
                'tools/live-here-now-bank.py from the VenuePlay trivia bank (VenuePlay Original, '
                'easy, fact-checked). Rebuild with that script; never edit by hand.',
        'count': len(out),
        'fields': ['id', 'question', 'options', 'answer index'],
        'q': out,
    }
    text = json.dumps(doc, ensure_ascii=False, separators=(',', ':')) + '\n'
    print('file: %d bytes' % len(text.encode('utf-8')))
    if '--write' not in sys.argv:
        print('Nothing written. Re-run with --write.')
        return
    with io.open(OUT, 'w', encoding='utf-8') as f:
        f.write(text)
    print('wrote %s' % os.path.relpath(OUT, ROOT))


if __name__ == '__main__':
    main()
