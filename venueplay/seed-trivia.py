#!/usr/bin/env python3
"""
Seed VenuePlay trivia questions into Supabase (vp_question_sets + vp_questions)
from data/trivia-library.json.

SECURITY: this needs your Supabase SERVICE key. Keep it SECRET - never paste it into
a chat, never commit it. Set it in your terminal just before running:

    cd sites/venueplay
    export SUPABASE_SERVICE_KEY='paste-your-service-key-here'

Then do a small TEST run first (30 questions per category, ~450 total):

    SEED_LIMIT=30 SEED_RESET=1 python3 seed-trivia.py

If that looks good in the trivia host's question-set dropdown, do the full run:

    SEED_RESET=1 python3 seed-trivia.py

Options (environment variables):
    SUPABASE_URL   defaults to the VenuePlay project
    SEED_RESET=1   delete existing LIBRARY sets first (safe: leaves venue-owned sets alone),
                   so you can re-run cleanly without duplicating.
    SEED_LIMIT=N   only seed N questions per category (for a quick test). 0 = all.
"""
import json, os, sys, urllib.request, urllib.error, random

URL = os.environ.get("SUPABASE_URL", "https://gpoolavkghnxedzrmtmc.supabase.co").rstrip("/")
KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")
LIB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "trivia-library.json")
RESET = os.environ.get("SEED_RESET") == "1"
PERCAT_LIMIT = int(os.environ.get("SEED_LIMIT", "0"))

if not KEY:
    sys.exit("ERROR: set SUPABASE_SERVICE_KEY in your environment first (keep it secret).")
if len(KEY) < 40:
    sys.exit("ERROR: that doesn't look like a service key. Use the service_role key, not the anon key.")


def req(method, path, body=None, prefer=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(URL + "/rest/v1/" + path, data=data, method=method)
    r.add_header("apikey", KEY)
    r.add_header("Authorization", "Bearer " + KEY)
    r.add_header("Content-Type", "application/json")
    if prefer:
        r.add_header("Prefer", prefer)
    try:
        with urllib.request.urlopen(r) as resp:
            t = resp.read().decode()
            return resp.status, (json.loads(t) if t else None)
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()


# 1. load the library
if not os.path.exists(LIB):
    sys.exit("ERROR: can't find " + LIB + " - run this from sites/venueplay.")
lib = json.load(open(LIB, encoding="utf-8"))
questions = lib.get("questions") or []
print("Loaded %d questions from the library." % len(questions))


# --- Broad-theme mapping: the ~570 fine categories roll up into 20 clean themes, which become the
#     host's set list. Each question ALSO keeps its own fine category (in the category column) as a
#     search tag, so a host can search any topic (e.g. "Neighbours") to build a themed night.
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


def valid(q):
    o = q.get("options")
    ci = q.get("correctIndex")
    return (isinstance(o, list) and len(o) == 4
            and isinstance(ci, int) and 0 <= ci <= 3
            and bool(q.get("question")))


# group by broad THEME (20 themes) so the host picks from a short list; each question keeps its
# own fine category as a searchable tag (written into the category column below).
by_theme = {}
for q in questions:
    if valid(q):
        by_theme.setdefault(theme(q.get("category")), []).append(q)
print("Grouped into %d themes." % len(by_theme))

# 2. optional clean reset of our library sets (never touches venue-owned sets)
if RESET:
    print("SEED_RESET: removing existing library sets...")
    st, sets = req("GET", "vp_question_sets?visibility=eq.library&select=id")
    if st == 200 and isinstance(sets, list):
        for s in sets:
            req("DELETE", "vp_questions?set_id=eq." + s["id"])
            req("DELETE", "vp_question_sets?id=eq." + s["id"])
        print("  removed %d old library set(s)." % len(sets))
    else:
        print("  (could not list existing sets: %s %s)" % (st, sets))

# 3. create one set per THEME and bulk-insert its questions (each row keeps its fine category tag)
total = 0
for th, items in sorted(by_theme.items()):
    random.shuffle(items)
    if PERCAT_LIMIT:
        items = items[:PERCAT_LIMIT]
    if not items:
        continue
    st, res = req("POST", "vp_question_sets",
                  {"title": th, "visibility": "library", "owner_venue_id": None,
                   "status": "active", "question_count": len(items)},
                  prefer="return=representation")
    if st not in (200, 201) or not isinstance(res, list) or not res:
        sys.exit("ERROR creating set '%s': %s %s\n(send me this exact message and I'll fix the mapping)" % (th, st, res))
    set_id = res[0]["id"]
    rows = [{"set_id": set_id, "seq": i + 1, "question": q["question"],
             "options": q["options"], "correct_index": q["correctIndex"],
             "category": q.get("category") or th,   # the FINE category, kept as a search tag
             "difficulty": (q.get("difficulty") if q.get("difficulty") in ("easy", "medium", "hard") else "medium"),
             "image_url": q.get("image_url") or q.get("imageUrl")}
            for i, q in enumerate(items)]
    for b in range(0, len(rows), 500):
        st, r = req("POST", "vp_questions", rows[b:b + 500], prefer="return=minimal")
        if st not in (200, 201):
            sys.exit("ERROR inserting '%s' (batch at %d): %s %s\n(send me this and I'll fix it)" % (th, b, st, r))
    total += len(rows)
    print("  %-26s %d questions" % (th, len(rows)))

print("\nDone. Inserted %d questions across %d theme sets." % (total, len(by_theme)))
print("Open the trivia host - the question-set dropdown should now be 20 clean themes.")
