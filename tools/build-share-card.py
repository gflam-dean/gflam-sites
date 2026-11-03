#!/usr/bin/env python3
"""Build venueplay/logos/venueplay-share.png, the 1200x630 og:image / twitter:image.

Placed from the v3.2 logo kit files, never retyped (brand rule 10):
  png/venueplay-horizontal-on-dark.png              the wordmark, solid pink triangle
  games-line/games-2-lines-lowercase-white.png      games in order: trivia first (Dean, 2 Nov)
on near-black #0A0A0B. Run: python3 tools/build-share-card.py [kit dir]
"""
import os, sys
from PIL import Image

KIT = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser('~/venue-enrich/logo-kit-1nov')
OUT = os.path.join(os.path.dirname(__file__), '..', 'venueplay', 'logos', 'venueplay-share.png')
W, H, BG = 1200, 630, (10, 10, 11)

def fit(path, width):
    im = Image.open(path).convert('RGBA')
    im = im.crop(im.getbbox())
    return im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)

logo = fit(os.path.join(KIT, 'png', 'venueplay-horizontal-on-dark.png'), 860)
games = fit(os.path.join(KIT, 'games-line', 'games-2-lines-lowercase-white.png'), 760)
gap = 52
top = (H - (logo.height + gap + games.height)) // 2
card = Image.new('RGBA', (W, H), BG + (255,))
card.alpha_composite(logo, ((W - logo.width) // 2, top))
card.alpha_composite(games, ((W - games.width) // 2, top + logo.height + gap))
card.convert('RGB').save(OUT, optimize=True)
print('wrote', os.path.normpath(OUT), card.size)
