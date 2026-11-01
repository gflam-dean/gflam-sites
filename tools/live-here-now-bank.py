#!/usr/bin/env python3
"""Build the question file for /live-here-now (the drink-coaster QR) from VenuePlay's own trivia bank.

WHAT THE PAGE IS. A punter scans the coaster ("Scan for 60 seconds of trivia while you wait for
your drink"), gets five questions, a score and "Beat the table?". No
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
  - near-duplicates: the same right answer twice, or one question's answer named in another's
  - and, after all that, the ones a person read and took out (LEFT_OUT, NOT_ON_A_COASTER below).
    All 900 were read on 1 Nov 2026. The order is a hash of each bank id, so taking one out or the
    bank growing changes only that one; a new question that comes in should be read too (the
    builder prints how many changed when you --write)

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


# READ BY A PERSON, 1 NOV 2026. Every one of the 900 was read before the coaster went to print. These
# passed every filter above and still should not be on a coaster: wrong or arguable, could date, or
# not for a night out. Keyed by the short id the page uses (the bank id's sha1, first 7). A question
# taken out here is replaced by the next eligible one, so the file stays full.
LEFT_OUT = {
    '3b12d97': "Hey Dad..! (its star's convictions: not for a night out)",
    'b13ece2': 'Guantanamo Bay (the detention camp is what people think of)',
    'a209b96': 'the Iranian Revolution (politics)',
    '0872ab3': 'Saddam Hussein and the 2003 invasion (war)',
    '46889e7': "Australia's largest city: Melbourne passed Sydney on one ABS measure in 2023, so it is arguable",
    'db29961': 'The Wiggles\' "most famous song about a dinosaur": a character, not a song title',
    '736f8ad': '"Working Class Man celebrates which worker? The working class man" (the question answers itself)',
    '9c3527f': '"What colour is a green olive? Green" (the question answers itself)',
    'f77cac8': '"Which cobra spreads a hood? Cobra" (the question answers itself)',
    'b9feb69': '"calculate" from a pebble: the Latin is calculus, the word is a stretch',
    '21922e5': 'the Great Victoria Desert does not cover much of central and western Australia',
    '98409f5': 'the Bermuda Triangle is not the Sargasso Sea',
    'c1f2973': 'Billy Joel is called a band',
    'd9ba5e2': 'Millionaire Hot Seat "hosts": the show ended in 2023',
    'd509a80': 'Uluru "more commonly" Ayers Rock: Uluru is the name',
    '2f5f846': 'Aunty Donna created by Aunty Donna (the question answers itself)',
    'b4b31f3': 'the Los Angeles Lakers play in Los Angeles (the question answers itself)',
    'd2937f3': "Garth Brooks' real name is Garth Brooks (the question answers itself)",
    '2211b7e': 'Jaguar uses a jaguar (the question answers itself)',
    '6542012': 'Peppa Pig is a pig (the question answers itself)',
    '860160f': 'Yoshi the dinosaur is a dinosaur (the question answers itself)',
    '2e82c0d': 'have a break, have a Kit Kat (the question answers itself)',
    '1bba5d6': 'Scotch comes from Scotland (the question answers itself)',
    '961c637': 'the Monaco Grand Prix is in Monaco (the question answers itself)',
    '8a0c3dc': 'a bus driver drives a bus (the question answers itself)',
    '3edef20': 'pearl divers are pearl divers (the question answers itself)',
    '98549a8': 'Roman roads are Roman roads (the question answers itself)',
    '3b2325c': 'tea leaves are tea leaves (the question answers itself)',
    '9010c7b': 'Eagle Rock is a dance, not a bird',
    '85affab': 'the Holden Torana question does not make sense as written',
    '4258aac': 'the Alamo (a battle)',
    '399b8c5': 'Pearl Harbor (the attack), and it is not in the city of Honolulu',
    '2acac86': '"the desert that covers much of central Australia" is arguable',
    '690a961': 'Kevin Rudd and the apology (politics)',
    '1083e5f': 'the Belt and Road Initiative (politics)',
    'fb168a9': 'Nauset Light: not an easy question for a bar in Australia',
    'a8ab86b': 'the AFL premiership cup is not called the Provan-Barassi Cup',
    '8672098': "goat's cheese is from goats (the question answers itself)",
    '59bd837': 'the Panama Canal is in Panama (the question answers itself)',
    '3650c1a': 'Canterbury Cathedral is in Canterbury (the question answers itself)',
    'e42a6bc': 'red velvet cake is red (the question answers itself)',
    'e5729a8': 'the Isle of Man TT is on the Isle of Man, "most dangerous" race',
    'fa8a5aa': "the cat o' nine tails (a punishment)",
    '4af006c': 'Cortes and the conquest of the Aztecs (a conquest)',
    '4923739': 'onna-bugeisha: not an easy question for a bar',
    '4fd5d0f': 'the Torres Strait is a strait, not "a large body of salt water"',
    'a57bfd7': "Western Star's slogan: the question is too vague to answer",
    'fcd2c20': 'the Yellow Tail logo is a wallaby, not a kangaroo',
    '9d4c8a9': 'The Black Sorrows question: the two songs are not one release of the early 1990s',
    '20eebc8': 'a batsman hits with a bat (the question answers itself)',
    'a9d4fb9': 'Shell uses a shell (the question answers itself)',
    'a269286': 'the Adelaide Oval is in Adelaide (the question answers itself)',
    '43a9ba4': 'the kimono question names no era',
}


# The same subjects come back under other ids (two batches wrote "Hey Dad..!"), so these are
# left out by their words as well.
NOT_ON_A_COASTER = re.compile(r"hey dad|guantanamo|saddam|ayatollah|white australia|\balamo\b|pearl harbo|"
                              r"belt and road|doggystyle|blurred lines|cat o' nine", re.I)


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
    if NOT_ON_A_COASTER.search(blob):
        return 'a subject not for a coaster (NOT_ON_A_COASTER)'
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
    # A fixed order by hash of each bank id, NOT a shuffle of the list: a shuffle reorders all of it
    # when one row comes in or out, and every question here has been read by a person. With a hash
    # order, taking one out (LEFT_OUT) or a new bank row arriving moves only that one.
    keep.sort(key=lambda q: hashlib.sha1(('live-here-now:' + q['id']).encode('utf-8')).hexdigest())
    per = collections.Counter()
    chosen = []
    # NEAR-DUPLICATES. The bank holds the same fact written twice by two batches ("one small step
    # for man, one giant leap for..." with and without "Neil Armstrong said"). Two of those in one
    # scan reads like a fault, so a question that shares its answer and most of its words with one
    # already chosen is skipped.
    taken = []
    def plain(t):
        t = re.sub(r'\([^)]*\)', ' ', str(t).lower())
        t = re.sub(r'[^a-z0-9 ]', ' ', t)
        return ' '.join(x for x in t.split() if x not in ('a', 'an', 'the'))
    def words(t):
        return set(w for w in re.findall(r'[a-z]+', t.lower()) if len(w) > 3)
    for q in keep:
        # After the shuffle, not before it: taking one out must not reshuffle the other 899 (every
        # one of which a person has read), so it only brings the next eligible question in at the end.
        if short_id(q['id']) in LEFT_OUT:
            dropped['read and left out by hand (LEFT_OUT)'] += 1
            continue
        if per[q['category']] >= PER_CATEGORY:
            continue
        w, ans = words(q['question']), str(q['options'][q['correctIndex']]).strip().lower()
        # Also the same right answer as one already chosen (three oasis questions, two "snag is a
        # sausage", two Antarctic deserts), and a right answer named in another question's text
        # (Gotye "featuring Kimbra" and Kimbra "with Gotye"): read side by side they are one fact.
        a0 = plain(ans)
        qtext = ' ' + plain(q['question']) + ' '
        if any((a == ans and len(w & w2) >= 2) or (w and len(w & w2) / float(len(w | w2)) > 0.5)
               or (a0 and a0 == pa) or (len(pa) > 3 and ' ' + pa + ' ' in qtext) or (len(a0) > 3 and ' ' + a0 + ' ' in qt2)
               for w2, a, pa, qt2 in taken):
            dropped['near-duplicate of one already chosen'] += 1
            continue
        taken.append((w, ans, a0, qtext))
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
    if os.path.isfile(OUT):
        try:
            was = set(q[0] for q in json.load(io.open(OUT, encoding='utf-8'))['q'])
            fresh = [q for q in out if q[0] not in was]
            print('%d question(s) not in the current file: read them before this goes out' % len(fresh))
            for q in fresh[:40]:
                print('  %s  %s => %s' % (q[0], q[1], q[2][q[3]]))
        except Exception as e:
            print('(could not compare with the current file: %s)' % e)
    if '--write' not in sys.argv:
        print('Nothing written. Re-run with --write.')
        return
    with io.open(OUT, 'w', encoding='utf-8') as f:
        f.write(text)
    print('wrote %s' % os.path.relpath(OUT, ROOT))


if __name__ == '__main__':
    main()
