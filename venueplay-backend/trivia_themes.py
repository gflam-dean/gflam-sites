"""
THE TRIVIA THEME MAP: which library set (General Knowledge, Music, Sport ...) a question goes into, from its fine
category. ONE copy, used by seed-trivia.py (a from-scratch reseed) and add-trivia.py (the weekly top-up). They each
carried their own copy until 21 Nov 2026 ("keep in sync").

The ~570 fine categories roll up into 20 clean themes, which become the host's set list. Each question ALSO keeps its
own fine category (in the category column) as a search tag, so a host can search any topic (e.g. "Neighbours") to
build a themed night.

A SET SERVES ONLY ITS OWN QUESTIONS (Jobs 525, real night 20 Nov 2026): the "Music" set asked about Butch Cassidy, a
1903 silent film and rock climbing. The game Worker was right (a round draws only from the set picked:
hostStartTrivia, set_id=eq.<set>); the questions were in the wrong set, put there by this map, which matched a
keyword anywhere inside a category's words: "band" in "Famous train robberies and BANDits", "rock" in "Famous ROCK
climbers and cliffs" and "Famous canyons and ROCK formations". 145 questions. Two changes:
  1. Music's words count only as whole words (a plural is fine: bands, singers, lyrics); "music" still starts a word
     (musicals, musician). Over the whole library this moves exactly those three categories and nothing else.
  2. CATEGORY_THEME names the theme outright for a category whose words still say the wrong thing ("rock climbers"
     IS the word rock). Checked first.
Migration venueplay-227-music-set-own-questions.sql moves the 145 live rows the same way; tools/trivia-theme-map.test.py
runs this over every category in data/trivia-library.json and checks the migration moves what this map says.
"""
import re

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

# Checked before THEME_RULES (lower case, exact).
CATEGORY_THEME = {
    "famous train robberies and bandits": "History",
    "famous rock climbers and cliffs": "Sport",
    "famous canyons and rock formations": "Geography",
}

# Themes whose keywords count only as whole words (a trailing s/es is allowed), except the PREFIX ones.
WHOLE_WORD_THEMES = {"Music"}
PREFIX_WORDS = {"music"}


def _hits(theme_name, kw, padded):
    if theme_name in WHOLE_WORD_THEMES and kw.strip() not in PREFIX_WORDS:
        return re.search(r"(?<![a-z])" + re.escape(kw.strip()) + r"(?:s|es)?(?![a-z])", padded) is not None
    return kw in padded


def theme(cat):
    named = CATEGORY_THEME.get((cat or "").strip().lower())
    if named:
        return named
    c = " " + (cat or "").lower() + " "
    for t, kws in THEME_RULES:
        for k in kws:
            if _hits(t, k, c):
                return t
    return "General Knowledge"
