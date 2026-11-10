/* =====================================================================
 * VP-VENUE-MATCH: IS THIS THE SAME VENUE? ONE ANSWER, ONE PLACE.
 * =====================================================================
 * Dean, 5 Nov 2026 (INBOX 60, 61, 62, 81): "the first person puts the venue and the postcode in".
 * Four doors ask the same question, and the repo's rule is that the same answer lives in one place:
 *
 *   - self sign-up and Add a venue, across ALL accounts (item 60): the same pub in another account
 *     gets no second account and no second free month;
 *   - the no-card start (item 81): is the venue they typed on our licensed venues list?
 *   - /live-here-now v2 (item 62, the game Worker, later): one coaster lead per pub, not one per
 *     spelling, linked to the account when that pub signs up.
 *
 * HOW IT SHIPS. This file is the source. Each Worker deploys as one file, so it carries a copy of
 * these three functions, and tools/release-check.py (section A, "is the same in all N file(s)")
 * refuses any copy that differs from this one. Edit here, then paste the same text into
 * venueplay-api-FULL.js (and venueplay-game.js once item 62 uses it). No database reads in here:
 * each caller fetches its own candidates and asks these functions about them.
 *
 * THE NAME, the way the slug allocator (vpaSlugify) already shapes it, plus the four traps a typed
 * pub name falls into, each measured on our own lists:
 *   - case, spaces and punctuation: "ROYAL  HOTEL." = "Royal Hotel" (the slug rule);
 *   - an apostrophe is not a word break: "Olim's" = "Olims" (vpaSlugify makes "olim-s" of one and
 *     "olims" of the other, so this is the one place the key is kinder than the slug);
 *   - "&" and "+" are "and": "Bat & Ball" = "Bat and Ball" (the help desk's helpMatchKey rule);
 *   - a leading "The": "The Royal Hotel" = "Royal Hotel" (the prospect autopilot's _norm_venue rule);
 *   - accents: "Café" = "Cafe".
 * Nothing else is guessed. "Royal" is NOT "Royal Hotel", "St" is not "Saint" or "Street": there are
 * a hundred Royal Hotels, so a loose name match is how one pub gets another pub's account.
 *
 * THE POSTCODE decides it, as it does for the slug and the in-account "same venue" rule. Exactly four
 * digits after the spaces and letters are taken out, else none.
 *
 * vpVenueMatch(aName, aPostcode, bName, bPostcode) answers:
 *   'same'    the names agree and both postcodes are there and agree;
 *   'unsure'  the names agree and one postcode is missing, so it cannot tell two Royals apart;
 *   null      a different venue: the names differ, or the postcodes differ.
 * Each caller says what 'unsure' means for it, conservatively: Add a venue and self sign-up treat it
 * as the same venue (a ticket for HQ costs a day; a second free month on a live venue costs money),
 * and the licensed list treats it as no match (HQ approves by hand). */
function vpVenueKey(name) {
  let s = String(name == null ? '' : name);
  try { s = s.normalize('NFKD'); } catch (e) { /* an engine without normalize keeps its accents */ }
  s = s.replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/['`\u2018\u2019\u02bc\u00b4]/g, '')
    .replace(/[&+]/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/^the /, '');
  return s.replace(/ /g, '-');
}
function vpVenuePostcode(postcode) {
  const d = String(postcode == null ? '' : postcode).replace(/\D/g, '');
  return d.length === 4 ? d : '';
}
function vpVenueMatch(aName, aPostcode, bName, bPostcode) {
  const ka = vpVenueKey(aName);
  if (!ka || ka !== vpVenueKey(bName)) return null;
  const pa = vpVenuePostcode(aPostcode), pb = vpVenuePostcode(bPostcode);
  if (pa && pb) return pa === pb ? 'same' : null;
  return 'unsure';
}
