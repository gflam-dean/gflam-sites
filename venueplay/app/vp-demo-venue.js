/* THE HOME PAGE DEMO'S ADS LOOP: WHICH VENUE, AND WHAT IT PLAYS (Dean, 13 Nov 2026, INBOX 356).
   /tv?demo=1&ads=1 (the home page's "Advertising" view) plays one real account's own live slides, read the way
   that venue's own TV reads them (the public, read-only /screen?venue=<slug>), so what a prospect sees there is
   what we put up on that account and nothing is kept in two places.

   ONE SETTING PICKS THE VENUE: "slug" in /demo-venue.json (a file on the site, no code to edit). Tugun Bowls
   Club now, the-mini-bar when Dean says. Optional "name" and "logo" (a path on this site) are only what shows if
   the read fails; the live read's own name and logo win when it answers. An optional "events" list (What's on
   nights, the same shape the account page saves) is what that venue shows when the read fails or its account is
   empty; Tugun's own are built in below.

   WHEN THE READ FAILS, OR THE ACCOUNT HAS NOTHING TO SHOW, the loop is a "What's on" list in the current TV style,
   written below for Tugun. It is data for VPWhatsOn, not a picture or a typed card, so it takes the current look
   and a dated night drops off by itself (a night is gone the day after its date; a weekly one after its "until").

   WHAT IS NEVER PLAYED: the venue's members draws board and its raffle card. The old draws slides carried the old
   branding and numbers; the raffle card is the old typed look. Only slides and What's on nights are read.
   No Tugun Facebook artwork either (Dean, 13 Nov: only our designed slides go up). */
(function (root) {
  "use strict";
  var DEFAULT = { slug: "tugun-bowls", name: "Tugun Bowls Club", logo: "/logos/venue-tugun-bowls.png" };
  var SLUG_RE = /^[a-z0-9][a-z0-9-]{0,60}$/;
  var SAME_SITE_RE = /^\/[^\/\\][A-Za-z0-9._~\/%-]*$/;
  var TTL_MS = 10 * 60 * 1000;

  /* /demo-venue.json, parsed (or anything at all: a missing or broken file is the default venue, never an error). */
  function config(raw) {
    var c = { slug: DEFAULT.slug, name: DEFAULT.name, logo: DEFAULT.logo, events: [] };
    if (!raw || typeof raw !== "object") return c;
    var slug = String(raw.slug == null ? "" : raw.slug).trim().toLowerCase();
    if (!SLUG_RE.test(slug)) return c;
    c.slug = slug;
    var same = slug === DEFAULT.slug;
    var nm = typeof raw.name === "string" ? raw.name.replace(/[\x00-\x1f\x7f]+/g, " ").trim().slice(0, 60) : "";
    var lg = typeof raw.logo === "string" ? raw.logo.trim() : "";
    c.name = nm || (same ? DEFAULT.name : "");
    c.logo = SAME_SITE_RE.test(lg) ? lg : (same ? DEFAULT.logo : "");
    c.events = Array.isArray(raw.events) ? raw.events.filter(function (e) { return e && typeof e === "object"; }).slice(0, 30) : [];
    return c;
  }

  /* The What's on nights shown when the read fails or the account is empty. Tugun's, from its website and its
     bistro's page, as Dean settled them on 13 Nov: no bistro opening hours; the Greek Night is dated and drops
     itself; no surf and turf price other than the one Dean named; no photo (the poster layout is built for a portrait picture and a landscape photo left blurred bars, so the list tiles fill the frame instead). */
  function fallbackEvents(slug) {
    if (slug !== DEFAULT.slug) return [];
    return [
      { id: "dm-roast",   title: "Roast Night",      day: "tue", line: "$10" },
      { id: "dm-trivia",  title: "Trivia & Cocktails", day: "wed" },
      { id: "dm-half",    title: "50% off menu",     day: "thu", line: "With a drink" },
      { id: "dm-surf",    title: "Surf + Turf",      day: "fri", line: "$24.90" },
      { id: "dm-parmi",   title: "Parmi + Pint",     day: "sat", line: "$19.90" },
      { id: "dm-bare-sa", title: "Barefoot bowls",   day: "sat", start: "14:00", line: "Book online" },
      { id: "dm-bare-su", title: "Barefoot bowls",   day: "sun", start: "14:00", line: "Book online" },
      { id: "dm-dj",      title: "DJ + food trucks", day: "sun", line: "Sunday session" },
      { id: "dm-greek",   title: "Greek Night",      date: "2026-11-28", start: "18:00", line: "$69.90, book on TryBooking" }
    ];
  }

  /* One /screen answer boiled down to what the demo plays. null = no answer (or no such venue). */
  function fromScreen(d) {
    if (!d || typeof d !== "object" || d.exists === false) return null;
    var slides = Array.isArray(d.slides) ? d.slides.filter(function (s) { return s && typeof s === "object"; }) : [];
    var events = Array.isArray(d.events) ? d.events.filter(function (e) { return e && typeof e === "object"; }) : [];
    return {
      slides: slides, events: events,
      name: typeof d.name === "string" ? d.name : "",
      logo: typeof d.logo_url === "string" ? d.logo_url : ""
    };
  }

  /* What the loop plays: the venue's live slides and nights; the fallback only when there is no answer or the
     answer has nothing to play. Never draws, never a raffle. */
  function choose(cfg, read) {
    var live = !!(read && (read.slides.length || read.events.length));
    return {
      source: live ? "live" : "fallback",
      slides: live ? read.slides : [],
      events: live ? read.events : ((cfg.events && cfg.events.length) ? cfg.events : fallbackEvents(cfg.slug)),
      name: (read && read.name) || cfg.name || "",
      logo: (read && read.logo) || cfg.logo || ""
    };
  }

  /* A ten minute memory per venue in the tab (sessionStorage), so the home page, the see-a-night pop-up and a
     reload do not each ask the Worker. Anything wrong with storage is no cache. */
  function key(slug) { return "vpDemoVenue:" + slug; }
  function cacheGet(store, slug, now) {
    try {
      var o = JSON.parse(store.getItem(key(slug)) || "null");
      if (!o || typeof o.at !== "number" || !o.read || (now - o.at) > TTL_MS || o.at > now + 60000) return null;
      return o.read;
    } catch (e) { return null; }
  }
  function cachePut(store, slug, read, now) { try { store.setItem(key(slug), JSON.stringify({ at: now, read: read })); } catch (e) {} }

  var api = { DEFAULT: DEFAULT, TTL_MS: TTL_MS, config: config, fallbackEvents: fallbackEvents, fromScreen: fromScreen, choose: choose, cacheGet: cacheGet, cachePut: cachePut };
  if (typeof module === "object" && module.exports) module.exports = api;
  root.VPDemoVenue = api;
})(typeof window !== "undefined" ? window : this);
