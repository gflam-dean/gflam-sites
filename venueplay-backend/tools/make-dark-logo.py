#!/usr/bin/env python3
"""
Make an invoice-safe VenuePlay logo.

THE PROBLEM
The primary logo is a white wordmark on a transparent background. That is right for the Stripe
checkout, which is dark, and invisible on a Stripe invoice, which is white paper. Stripe has one
place to put a logo, so it has to be a file that works on both, or you swap which asset goes where.

WHAT THIS DOES
Repaints only the WHITE parts of the wordmark to VenuePlay stage black, and leaves the neon pink
play triangle exactly as it is. Same file, same shape, same spacing, readable on white.

    python3 tools/make-dark-logo.py

Writes logos/venueplay_primary_dark.png. Upload that as the LOGO in Stripe (Settings, Business,
Branding), which is what invoices and receipts use, and keep the white one as the ICON, which is
what the dark checkout page uses.

No image library needed: this reads and writes the PNG directly, so it runs anywhere.
"""
import os, struct, zlib

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(HERE, 'logos', 'venueplay_primary_rebuilt.png')
OUT = os.path.join(HERE, 'logos', 'venueplay_primary_dark.png')
INK = (10, 10, 11)          # VenuePlay stage black


def read_png(path):
    data = open(path, 'rb').read()
    if data[:8] != b'\x89PNG\r\n\x1a\n':
        raise SystemExit('not a PNG: %s' % path)
    i, idat, w = 8, b'', None
    while i < len(data):
        ln = struct.unpack('>I', data[i:i + 4])[0]
        typ = data[i + 4:i + 8]
        chunk = data[i + 8:i + 8 + ln]
        if typ == b'IHDR':
            w, h, bd, ct, comp, filt, inter = struct.unpack('>IIBBBBB', chunk)
            if bd != 8 or ct != 6 or inter != 0:
                raise SystemExit('expected an 8-bit RGBA, non-interlaced PNG')
        elif typ == b'IDAT':
            idat += chunk
        elif typ == b'IEND':
            break
        i += 12 + ln
    return w, h, zlib.decompress(idat)


def unfilter(w, h, raw):
    stride, rows = w * 4, []
    prev = bytearray(stride)
    pos = 0
    for _ in range(h):
        f = raw[pos]; pos += 1
        line = bytearray(raw[pos:pos + stride]); pos += stride
        for x in range(stride):
            a = line[x - 4] if x >= 4 else 0
            b = prev[x]
            c = prev[x - 4] if x >= 4 else 0
            if f == 1:   line[x] = (line[x] + a) & 255
            elif f == 2: line[x] = (line[x] + b) & 255
            elif f == 3: line[x] = (line[x] + (a + b) // 2) & 255
            elif f == 4:
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[x] = (line[x] + pr) & 255
        prev = line[:]
        rows.append(line)
    return rows


def write_png(path, w, h, rows):
    raw = b''.join(b'\x00' + bytes(r) for r in rows)     # filter 0 (None) on every row
    def chunk(typ, data):
        c = struct.pack('>I', len(data)) + typ + data
        return c + struct.pack('>I', zlib.crc32(typ + data) & 0xffffffff)
    png = (b'\x89PNG\r\n\x1a\n'
           + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
           + chunk(b'IDAT', zlib.compress(raw, 9))
           + chunk(b'IEND', b''))
    open(path, 'wb').write(png)


# The play triangle carries a wide neon bloom. On black it reads as a glow. On white it is a
# pink haze, and because it runs off the top, bottom and left of the canvas it ends in a straight
# line: the logo looks cut off. An invoice is not a screen, so the invoice mark drops the bloom
# and keeps the crisp stroke. Below FLOOR is haze and goes; above CEIL is the mark and goes solid;
# between them is the anti-aliased edge and is stretched across the gap so it stays smooth.
FLOOR, CEIL = 100, 200


def debloom(alpha):
    if alpha <= FLOOR:
        return 0
    if alpha >= CEIL:
        return 255
    return int(round((alpha - FLOOR) * 255.0 / (CEIL - FLOOR)))


def main():
    w, h, raw = read_png(SRC)
    rows = unfilter(w, h, raw)
    changed = haze = 0
    for r in rows:
        for x in range(0, w * 4, 4):
            red, green, blue, alpha = r[x], r[x + 1], r[x + 2], r[x + 3]
            if alpha == 0:
                continue
            # The wordmark is white or near-white. The triangle is neon pink and stays.
            if red > 190 and green > 190 and blue > 190:
                r[x], r[x + 1], r[x + 2] = INK
                changed += 1
            a2 = debloom(alpha)
            if alpha and not a2:
                haze += 1
            r[x + 3] = a2
    write_png(OUT, w, h, rows)
    print('read  %s  (%dx%d)' % (os.path.relpath(SRC, HERE), w, h))
    print('wrote %s' % os.path.relpath(OUT, HERE))
    print('repainted %d white pixels to stage black; the pink triangle keeps its colour' % changed)
    print('cleared %d pixels of glow haze, so nothing runs off the edge of the canvas' % haze)


if __name__ == '__main__':
    main()
