# VenuePlay RNG: statistical test results

Prepared for the OLGR submission. Addresses clause 4.2.1 of *Random number generator
minimum technical requirements v1.5* ("statistically independent ... pass industry
standard statistical tests ... uniformly distributed ... unpredictable") and clause
9.29 of the Australian/New Zealand Gaming Machine National Standard Rev 12.1
("results for any empirical and/or theoretical tests conducted on the RNG").

Tests chosen from the list named at GMNS clause 8.7. Evaluated at 99% confidence,
per GLI-11/GLI-19 clause 3.2.2.

## What was tested

`randInt(max)` in `worker/venueplay-game.js`, which is the single scaling function
behind every draw in the product: the bingo ball, the raffle ticket, the members
draw and the musical bingo song order.

    function randInt(max) {
      const buf = new Uint32Array(1);
      const limit = Math.floor(0x100000000 / max) * max;
      let x;
      do { crypto.getRandomValues(buf); x = buf[0]; } while (x >= limit);
      return x % max;
    }

Underlying source: `crypto.getRandomValues`, the Web Crypto CSPRNG provided by the
platform. Per clause 4.9.1 this is an RNG forming part of a commercially available
product with a known randomness process and a demonstrated track record.

Tests were run against a faithful reimplementation of the identical algorithm over
the operating system CSPRNG, because the scaling logic is what is under evaluation.

## Results

| Test | Sample | Statistic | Threshold (99%) | Result |
|---|---|---|---|---|
| Equi-distribution (frequency), range 90 | 900,000 | chi-square 100.09 | 124.12 (df 89) | PASS |
| Serial correlation, range 90 | 200,000 | r = +0.00003 | \|r\| < 0.00447 | PASS |
| Runs (up/down), range 2^24 | 200,000 | z = +1.252 | \|z\| < 2.576 | PASS |
| Runs above/below median, range 90 | 197,750 | z = -0.413 | \|z\| < 2.576 | PASS |
| Gap test, value 7, range 90 | 2,244 gaps | chi-square 12.99 | 21.67 (df 9) | PASS |
| Poker test, 5-digit hands | 100,000 hands | chi-square 4.02 | 13.28 (df 4) | PASS |
| Coupon collector, 10 coupons | 20,000 sets | mean 29.490 draws | theoretical 29.290 | PASS |

Frequency detail, range 90 over 900,000 draws: minimum bucket 9,755, maximum 10,252,
expected 10,000.

### A note on the runs test

An initial run reported a failure (z = -4.211). That was a fault in the test, not the
algorithm: tied values were being discarded, and the up/down runs formula assumes
distinct values. Over 200,000 draws in a range of 90 roughly 2,200 ties were removed,
which invalidates the comparison. Re-run over a wide range where ties cannot occur,
and separately as a runs-above/below-median test on the bingo range itself, both pass
comfortably. Recorded here rather than omitted.

## Scaling: absence of bias (clauses 4.7.1, GMNS 8.14/8.15, GLI 3.2.3(a))

The rejection sampling in `randInt` is the mechanism the standards name as the remedy
for modulo bias. Its effect is invisible at small ranges and decisive at large ones.

For a range of 90, 2^32 mod 90 = 76, so a raw value is discarded roughly once in 56
million draws. Zero rejections across approximately 2 million test draws is therefore
the expected outcome and not evidence the guard is inert.

Demonstrated on a range where it does bite. Range 3,000,000,000, 300,000 draws:

- 129,395 raw values discarded, 30.1% of raw draws
- Split at the midpoint, expected 50.0% either side:
  - naive `x % max`: **65.00%** low — biased, and what GMNS 8.15 prohibits
  - VenuePlay `randInt`: **49.96%** low — unbiased

## Draw construction (clause 4.2.2, 4.2.7)

Bingo balls are drawn one at a time from a shrinking pool at the moment each ball is
called, rather than the sequence being generated in advance. No future outcome exists
before it is required, so there is no RNG state to expose and no interval in which
early access to a result could confer a benefit. A number removed from the pool cannot
be drawn twice within a game, satisfying the Victorian Rules of Bingo clause 9 as well.

Verified across 14 scenarios including a complete 90-ball game with every number
appearing exactly once, correct pool exhaustion, and an even first-ball distribution
across 9,000 simulated games.
