/* EVERY EMAIL WEARS THE CURRENT BRAND (Dean, 5 Nov 2026: "emails need logo and rebrand too"; target release 8 Nov).

   The logo is the supplied kit file (logo-kit-1nov/png/venueplay-horizontal-on-dark.png and -on-light.png, trimmed,
   560 px wide), hosted at venueplay.com.au/logos/. Never the old rebuilt files (venueplay_primary_rebuilt.png,
   venueplay_primary_dark.png). The band is brand near-black #0A0A0B, not the old #12101a. Lowercase venueplay, no Gflam
   Group on paperwork, no em or en dashes. Runs the real card functions lifted out of the Worker and reads every
   template under venueplay/emails/. */
var bad = 0, ran = 0;
function pass(n, c, x) { if (typeof n !== "string") throw new Error("name first");
  if (typeof c !== "boolean") throw new Error("condition must be a boolean: " + n);
  ran++; print((c ? "  ok   " : "  FAIL ") + n + (x ? "   " + x : "")); if (!c) bad++; }
function find(rel) { var t = [rel, "../" + rel]; for (var i = 0; i < t.length; i++) { try { var s = readFile(t[i]); if (s && s.length > 200) return s; } catch (e) {} } throw new Error("cannot find " + rel); }
function bytes(rel) { var t = [rel, "../" + rel]; for (var i = 0; i < t.length; i++) { try { var b = readFile(t[i], "binary"); if (b && b.length > 100) return b; } catch (e) {} } throw new Error("cannot find " + rel); }
function lift(src, name) { var m = new RegExp("(?:async\\s+)?function\\s+" + name + "\\s*\\(").exec(src); if (!m) throw new Error("no " + name);
  var i = src.indexOf("{", m.index), d = 0; for (var j = i; j < src.length; j++) { if (src[j] === "{") d++; else if (src[j] === "}") { d--; if (!d) return src.slice(m.index, j + 1); } } throw new Error("unbalanced " + name); }

var W = find("venueplay-backend/worker/venueplay-api-FULL.js");
var VP_ABN = (/const VP_ABN = '([^']+)'/.exec(W) || [, ""])[1];
eval(lift(W, "vpaEsc")); eval(lift(W, "vpaEmailDocument")); eval(lift(W, "vpaVenueEmailCard")); eval(lift(W, "vpaStaffCard")); eval(lift(W, "helpEmailCard"));
var DARK = "https://venueplay.com.au/logos/venueplay-email-on-dark.png";
var RETIRED = /venueplay_primary_rebuilt|venueplay_primary_dark|#12101a/i;

/* 1. the hosted logo files are real PNGs, 560 wide, one per background */
["venueplay/logos/venueplay-email-on-dark.png", "venueplay/logos/venueplay-email-on-light.png"].forEach(function (f) {
  var b = bytes(f), w = (b[16] << 24) | (b[17] << 16) | (b[18] << 8) | b[19];
  pass(f + " is a PNG, 560 px wide (the kit file, trimmed)", b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47 && w === 560, "width " + w);
});

/* 2. the Worker: no retired logo file or old ink anywhere, and no Gflam Group on a paper email */
pass("the Worker names no retired logo file and not the old #12101a", !RETIRED.test(W), (RETIRED.exec(W) || [""])[0]);
pass("no email says \"Gflam Group, ABN\"", W.indexOf("Gflam Group, ABN") === -1);
pass("the logos the Worker uses are the on-dark and on-light kit files only", (W.match(/\/logos\/venueplay[-_a-z]*\.png/g) || []).every(function (m) { return /venueplay-email-on-(dark|light)\.png/.test(m); }), (W.match(/\/logos\/venueplay[-_a-z]*\.png/g) || []).join(" "));

/* 3. the cards, run */
var card = vpaVenueEmailCard("pre", "<p>Hello</p>", "Title");
pass("the venue card: kit logo on a near-black band, alt venueplay, a full document", card.indexOf(DARK) !== -1 && /background:#0A0A0B;[^>]*>\s*<img/.test(card) && card.indexOf('alt="venueplay"') !== -1 && /^<!doctype html>/i.test(card));
pass("the venue card: Manrope first in the font stack", card.indexOf("font-family:Manrope,") !== -1);
var staff = vpaStaffCard("<p>x</p>", "Alert");
pass("a staff alert wears the same card and logo", staff.indexOf(DARK) !== -1 && staff.indexOf("<p>x</p>") !== -1 && staff.indexOf("#0A0A0B") !== -1);
var help = helpEmailCard(false, "<p>Hi</p>", "foot", "T", "pre");
pass("the help desk reply card: kit logo on near-black, pink rule", help.indexOf(DARK) !== -1 && /background:#0A0A0B;/.test(help) && help.indexOf("background:#FF1F8E") !== -1 && !RETIRED.test(help));
pass("the PartyPlay help card is untouched (its own logo)", helpEmailCard(true, "<p>Hi</p>", "foot", "T", "p").indexOf("partyplay-email-logo.png") !== -1);

/* 4. every template on the site */
["welcome", "welcome-group", "welcome-hq", "welcome-prospect", "venue-onboarding", "prospect-reminder", "upcoming-payment", "upcoming-payment-group"].forEach(function (n) {
  var h = find("venueplay/emails/" + n + ".html");
  pass(n + ": kit logo on the near-black header, lowercase alt", h.indexOf('<img src="' + DARK + '"') !== -1 && /background:#0A0A0B/.test(h) && h.indexOf('alt="venueplay"') !== -1);
  pass(n + ": nothing retired, no Gflam, no dash, no capital VenuePlay in what is sent", !RETIRED.test(h) && !/gflam/i.test(h.replace(/<!--[\s\S]*?-->/g, "")) && !/[—–]|&mdash;|&ndash;/.test(h.replace(/<!--[\s\S]*?-->/g, "")) && !/VenuePlay/.test(h.replace(/<!--[\s\S]*?-->/g, "")));
  pass(n + ": Manrope first, and no .dev link", h.indexOf("Manrope,-apple-system") !== -1 && !/\.dev\b/.test(h));
});
print(bad ? "\n" + bad + " of " + ran + " FAILED" : "\nALL " + ran + " CHECKS PASSED");
if (bad) throw new Error("email rebrand checks failed");
