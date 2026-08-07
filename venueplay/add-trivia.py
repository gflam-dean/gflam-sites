#!/usr/bin/env python3
"""
Append NEW trivia questions straight into the live library - NO reset, NO full reseed.
Use this for the weekly batch, generated batches, or any top-up, so we never re-seed the whole bank.

SECURITY: needs your Supabase SERVICE key. Keep it SECRET. In your own Terminal:
    cd /Users/dean.tindale/gflam-ai-team/sites/venueplay
    export SUPABASE_SERVICE_KEY='paste-your-service-key-here'
    python3 add-trivia.py data/generated/*.json      # add specific batch files
    python3 add-trivia.py                              # default: everything in data/generated/

What it does:
  1. Loads the new questions from the files you pass (or data/generated/*.json).
  2. Skips any that duplicate a question already in data/trivia-library.json.
  3. Groups the rest by THEME (same 20-theme map as the seed) and APPENDS them to each theme's
     existing library set in Supabase (continuing the seq), updating the set's question_count.
  4. Also appends the accepted questions to data/trivia-library.json so the master file stays in
     sync (a future from-scratch reseed will include them).

Run the full seed-trivia.py ONCE for the 20-theme restructure; after that just use THIS to top up.
"""
import json, os, sys, glob, re, urllib.request, urllib.error

URL = os.environ.get("SUPABASE_URL", "https://gpoolavkghnxedzrmtmc.supabase.co").rstrip("/")
KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")
HERE = os.path.dirname(os.path.abspath(__file__))
LIB = os.path.join(HERE, "data", "trivia-library.json")

if not KEY or len(KEY) < 40:
    sys.exit("ERROR: set SUPABASE_SERVICE_KEY (the service_role key, kept secret) before running.")

# --- theme map: keep in sync with seed-trivia.py (seed-trivia.py is the canonical copy) ---
THEME_RULES = [
    ("Australiana", ["australia", "aussie", "aboriginal", "anzac", "outback"]),
    ("Space & Astronomy", ["space", "astronom", "meteor", "eclipse", " moon", "planet", "galaxy", "comet", "asteroid", "night sky", "solar system", "cosmos", "nebula", "orbit", "telescope", "constellation", "satellite", "rocket", "spacecraft"]),
    ("Music", ["music", "song", "band", "album", "singer", "rock", "pop ", "hip hop", "jazz", "opera", "mtv", "eurovision", "lyric", "musician", "instrument", "choir", "dj"]),
    ("Film & TV", ["film", "movie", "cinema", " tv", "television", "sitcom", "netflix", "disney", "oscar", "hollywood", "james bond", "star wars", "blockbuster", "franchise", "actor", "director", "screen", "soap opera", "documentar"]),
    ("Anime, Comics & Cartoons", ["anime", "manga", "cartoon", "animation", "comic", "superhero", "pixar", "pokemon", "marvel", "animated"]),
    ("Video Games", ["video game", "gaming", "game boy", "nintendo", "playstation", "xbox", "esports", "minecraft", "arcade", "console"]),
    ("Sport", ["sport", "football", "cricket", "rugby", "soccer", "tennis", "olympic", "afl", "nrl", "athlet", "basketball", "golf", "boxing", "racing", "cycling", "swimming", "formula 1", "marathon", "surfing", "skateboard"]),
    ("Food & Drink", ["food", "drink", "cuisine", "cocktail", "wine", "beer", "cooking", "chef", "restaurant", "dish", "culinary", "breakfast", "pastr", "pudding", "dessert", "cheese", "olive", "antipasto", "soup", "broth", "stew", "cake", "chocolate", "coffee", " tea ", "fruit", "vegetable", "spice", "snack", "candy", "sweet", "bread", "baking", "pizza", "meat", "seafood", "whisky", "bourbon", " rum", "spirit", "distiller", "rice", "noodle", "grain", " jam", "honey", "preserve", "pickle"]),
    ("Technology & Transport", ["computer", "technolog", "internet", "software", "aviation", "gadget", "engineering", "robot", "invention", "machine", "windmill", "waterwheel", "engine", "mechanical", "electric", "train", "railway", "tram", "truck", " bus ", "ship", "sailing", " car ", "motoring", "vehicle", "boat", "plane", "aircraft", "locomotive", "underground", "flight", "balloon", "canal", " lock", "bridge", "viaduct", "tunnel", "aqueduct"]),
    ("Science & Nature", ["science", "physic", "chemis", "biolog", "nature", "animal", "medicine", "human body", "plant", "dinosaur", "weather", "anatomy", "element", "insect", "creature", "wildlife", "pet", " dog", " cat ", "frog", "newt", " bat", "moth", " bee", "butterfly", "pollinator", "pond", "deep-sea", "abyss", "zoo", "aquarium", "bird", "fish", "reptile", "mammal", "marine", "tree", "flower", "chemical", "atom", "forest", "jungle", "coral", "spider", "scorpion", "snake", "viper", "venom", "creepy", "colour", "light and", "senses", "shark", "whale", "gemstone", " gem ", "metal", "mining", "mineral"]),
    ("History", ["history", " war", "ancient", "medieval", "empire", "century", "revolution", "dynasty", "historical", "wild west", "outlaw", "gold rush", "pirate", "age of sail", "colonial", "viking", "explorer", "exploration", "castle", "monarch", "battle", "roman", "egypt", "samurai", "feudal", "aztec", "maya", "inca", "civilis", "civiliz", "fort ", "city wall", "rampart", "renaissance"]),
    ("Geography", ["geograph", "countr", "capital", "flag", "cities", "river", "mountain", "island", "continent", " map", "landmark", "volcano", "harbour", "coast", "lighthouse", " sea", "desert", "border", "nation", "glacier", "iceberg", "ice cap", "cave", "grotto", "stalactite", "lake", "peak", "alps", "waterfall", "gorge", " bay ", "gulf", "strait", "waterway"]),
    ("Books & Literature", ["book", "literat", "author", "novel", "poet", "shakespeare", "writer", "fiction", "fairy tale", "story"]),
    ("Art & Culture", ["art", "photograph", "fashion", "clothing", "style", "design", "architect", "sculpture", "painting", "museum", "festival", "holiday", "tradition", "circus", "magic", "carnival", "brand", "logo", "slogan", "mascot", "advertis", "jingle", "cathedral", "mosque", "temple", "basilica"]),
    ("Mythology & Religion", ["myth", "religio", " god", "bible", "norse", "legend", "greek myth", "saint", "church"]),
    ("Maths & Puzzles", ["math", "brain teaser", "puzzle", "logic", "riddle", "statistic", "time, clocks", "calendar"]),
    ("Language & Words", ["language", "alphabet", "vocabular", " word", "grammar", "etymolog", "phrase", "idiom"]),
    ("People & Celebrities", ["celebrit", "famous", "royal", "president", "politic", "leader", "people", "biograph", "inventor", "nobel"]),
    ("Hobbies & Collectables", ["hobby", "hobbies", "board game", "card game", "chess", "craft", " toy", "collectable", "coin", "stamp", "garden", "knitting", "pastime", "cards and", "playing card", "dice ", "pub game"]),
]


def theme(cat):
    c = " " + (cat or "").lower() + " "
    for t, kws in THEME_RULES:
        for k in kws:
            if k in c:
                return t
    return "General Knowledge"


def req(method, path, body=None, prefer=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(URL + "/rest/v1/" + path, data=data, method=method)
    r.add_header("apikey", KEY); r.add_header("Authorization", "Bearer " + KEY)
    r.add_header("Content-Type", "application/json")
    if prefer:
        r.add_header("Prefer", prefer)
    try:
        with urllib.request.urlopen(r) as resp:
            t = resp.read().decode()
            return resp.status, (json.loads(t) if t else None)
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()


def norm(q):
    return re.sub(r"\s+", " ", (q or "").strip().lower())


def valid(q):
    o = q.get("options"); ci = q.get("correctIndex", q.get("correct_index"))
    return (isinstance(o, list) and len(o) == 4 and isinstance(ci, int) and 0 <= ci <= 3 and bool(q.get("question")))


# 1) load inputs
paths = sys.argv[1:] or glob.glob(os.path.join(HERE, "data", "generated", "*.json"))
if not paths:
    sys.exit("No input files. Pass files, or put batch JSON in data/generated/.")
incoming = []
for p in paths:
    try:
        d = json.load(open(p, encoding="utf-8"))
        incoming.extend(d if isinstance(d, list) else d.get("questions", []))
    except Exception as e:
        print("  skip %s (%s)" % (p, e))
print("Loaded %d incoming questions from %d file(s)." % (len(incoming), len(paths)))

# 2) load the master library + build a dedupe set
lib = json.load(open(LIB, encoding="utf-8"))
existing = lib.get("questions", [])
seen = set(norm(q.get("question")) for q in existing)

# 3) filter: valid + not a duplicate
fresh = []
dupes = 0
for q in incoming:
    if "correctIndex" not in q and "correct_index" in q:
        q["correctIndex"] = q["correct_index"]
    if not valid(q):
        continue
    n = norm(q["question"])
    if n in seen:
        dupes += 1
        continue
    seen.add(n)
    fresh.append(q)
print("After validate + dedupe: %d new, %d duplicates skipped." % (len(fresh), dupes))
if not fresh:
    sys.exit("Nothing new to add.")

# 4) group by theme + fetch each theme's library set id
by_theme = {}
for q in fresh:
    by_theme.setdefault(theme(q.get("category")), []).append(q)

st, sets = req("GET", "vp_question_sets?visibility=eq.library&select=id,title,question_count")
if st != 200 or not isinstance(sets, list):
    sys.exit("ERROR listing library sets: %s %s (have you run the full seed once?)" % (st, sets))
set_by_title = {s["title"]: s for s in sets}

# 5) append each theme's new questions to its set (continue the seq), update count
added = 0
for th, items in sorted(by_theme.items()):
    s = set_by_title.get(th)
    if not s:
        # theme set missing (never seeded) - create it
        st, res = req("POST", "vp_question_sets",
                      {"title": th, "visibility": "library", "owner_venue_id": None, "status": "active", "question_count": 0},
                      prefer="return=representation")
        if st not in (200, 201) or not res:
            print("  could not create set '%s': %s %s" % (th, st, res)); continue
        s = res[0]; s["question_count"] = 0; set_by_title[th] = s
    # next seq = current max in the set
    st, mx = req("GET", "vp_questions?set_id=eq.%s&select=seq&order=seq.desc&limit=1" % s["id"])
    seq = (mx[0]["seq"] if (st == 200 and mx) else 0)
    rows = [{"set_id": s["id"], "seq": seq + i + 1, "question": q["question"], "options": q["options"],
             "correct_index": q["correctIndex"], "category": q.get("category") or th,
             "difficulty": (q.get("difficulty") if q.get("difficulty") in ("easy", "medium", "hard") else "medium"),
             "image_url": q.get("image_url") or q.get("imageUrl")} for i, q in enumerate(items)]
    for b in range(0, len(rows), 500):
        st, r = req("POST", "vp_questions", rows[b:b + 500], prefer="return=minimal")
        if st not in (200, 201):
            print("  ERROR inserting into '%s': %s %s" % (th, st, r)); break
    else:
        req("PATCH", "vp_question_sets?id=eq.%s" % s["id"], {"question_count": (s.get("question_count") or 0) + len(rows)})
        added += len(rows)
        print("  %-26s +%d (now ~%d)" % (th, len(rows), (s.get("question_count") or 0) + len(rows)))

# 6) keep the master JSON in sync so a future from-scratch reseed includes them
existing.extend(fresh)
lib["questions"] = existing
json.dump(lib, open(LIB, "w", encoding="utf-8"), ensure_ascii=False)
print("\nAdded %d questions to the live library (no reseed needed). Master JSON now %d questions." % (added, len(existing)))
