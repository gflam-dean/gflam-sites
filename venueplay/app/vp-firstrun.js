/* THE FIRST RUN: a prospect's guided setup, one step per screen (Dean, 28 Oct 2026).

   "just a link: hey, I've set you up an account. Click here to access it, and then it actually asks
   them to add their mobile number and then to confirm the T&Cs and then it walks through everything."

   The prospect's welcome email (version 2) is one button. Everything it used to explain lives here,
   after the one-click sign-in, for a venue HQ set up as a prospect (vp_venues.terms_required, migration
   122) and for its owner or a manager only:

     1. Add your mobile   so they can also sign in by text (and get alerts). Skippable. The number goes
                          on their login ONLY after they type the code texted to it: Supabase Auth's own
                          phone change (updateUser, then verifyOtp type "phone_change"), which keeps the
                          new number pending until it is verified. Nothing here, and no Worker route,
                          ever writes an unverified number to a login.
     2. The Terms         the existing blocking Terms card (VP.termsCard), as this step. Next waits for
                          the tick; nobody can tick on their behalf.
     3. Your TV           their screen code, then the two ways in (Dean, 5 Nov 2026, INBOX 13): on a Google TV,
                          the venueplay TV app and the screen code; or any TV web browser at venueplay.com.au/tv,
                          the screen code, then full screen. No slug link ("Everywhere should say
                          venueplay.com.au/tv", Dean 5 Nov). Plus a live preview of their slides
                          (/account/screen-get, the same read Your account > Screen makes).
     4. Your hosts        name and mobile; the billing Worker's /account/host-add makes the login and texts
                          the host their own sign-in link (the same route as Account > People > Add a host).
     5. A first game      a test game, trivia first in three taps, or musical bingo, opening that console.
     3a. About your venue  the questions come FIRST (Dean, 5 Nov 2026, INBOX 44a): is this the right venue name,
                          how many TVs, which nights they run games. 3b. Which games do you play (trivia,
                          musical bingo, bingo, raffles, members draws). The answers are kept on this device
                          and on vp_venue_settings.setup_answers (migration 163, NOT RUN) through the page's
                          own VP.saveSettings; before 163 they stay on this device and nothing breaks. They
                          shape the TV step (several TVs), the test game step (the Account pages to set up for
                          their games) and the Account page's "About your venue" card. A wrong name goes to
                          HQ as a help desk ticket: there is no route that renames a venue.
     6. About you         two optional Account page questions a new venue usually leaves empty (Dean, 5 Nov 2026,
                          INBOX 24): their own name while it is still the "<venue> manager" the Worker gave
                          them (/account/my-name, what HQ and the Hosts list show), and the venue's logo while
                          it has none (/account/logo-upload, which puts it on the TV). Each only when empty;
                          the step is left out when both are done. No new route, no migration.
     7. Your card         the card link for their own account (/account/card-link) and the price line,
                          plus "Need a hand? Tap here and Dean will call": a help desk ticket, "Please
                          call me", with their mobile. No typing needed.

   Progress is kept per venue on this device (localStorage "vpFirstRun:<venue id>"); closing it keeps
   the step, and "Setup guide" in the console header opens it again. Steps 1 and 2 also read the real
   state (the login's phone, the venue's compliance record), so a step already done says so.

   EVERY NEW VENUE GETS IT, not only a prospect (Dean, 30 Oct 2026; UX audit 2.1). A self sign-up's owner
   or manager sees it too, from their first sign-in until the venue's first game (a venue under 45 days
   old with no session yet; a venue with one is never asked again on that device). Steps already done are
   left out, not shown ticked: a login that has its mobile skips step 1 (audit 2.3), a venue that has
   ticked the Terms skips step 2, and a venue whose card is on (every self sign-up that added one at
   Stripe) skips step 5. The card step always shows both Now and Later; Later works without the card
   link, and a link that will not load says so with a Retry button (audit 2.5).

   THE FIRST-SIGN-IN SETUP GUIDE (Dean, 5 Nov 2026, INBOX 13): the TV, then hosts, then a first test game,
   trivia first. Readable at 375px: nothing in the guide is under 15px, and the Terms card it borrows is
   lifted to 15px inside the guide on a phone.

   LATER SIGN-INS (Dean, 5 Nov 2026, INBOX 46): VPFirstRun.ask() puts ONE short optional question, as a bottom
   sheet over the console, on a sign-in after the guide is done or closed, from whatever the Account page still
   lacks: games, nights, TVs, then a logo, then their name. Never more than one a sign-in, always "Not now", and
   a question skipped twice is never asked again. Venues the guide is not for are never asked.

   The 4 hour sign-out still applies: this is a page of the signed-in console, nothing more.
   Everything a person reads is set with textContent; nothing they or HQ typed is ever parsed as HTML. */
(function (root) {
  "use strict";
  var BILLING_API = "https://api.venueplay.com.au";
  var KEY = "vpFirstRun:";
  var STEPS = ["mobile", "terms", "venue", "games", "tv", "hosts", "game", "account", "card"];
  var TITLES = { mobile: "Add your mobile", terms: "Tick the Terms", venue: "About your venue", games: "Which games do you play?", tv: "Your TV", hosts: "Add your hosts", game: "Run your first game", account: "About you and your venue", card: "Add your card when you're ready" };

  var C = { ink: "#0A0A0B", ink2: "#141418", pink: "#FF1F8E", pinkSoft: "#FF8CC6", text: "#E7E7EC", muted: "#C9C9D1", faint: "#8A8A94", line: "rgba(255,255,255,.12)", ok: "#2BD47D" };
  var FONT = "font-family:Manrope,system-ui,sans-serif";
  var HEAD = "'Hanken Grotesk',Manrope,sans-serif";
  var BTN = "display:inline-block;min-height:44px;padding:11px 20px;border-radius:10px;border:none;font:700 15px/1.4 " + HEAD + ";cursor:pointer;box-sizing:border-box";
  var BTN_PINK = BTN + ";background:" + C.pink + ";color:#FFFFFF";
  var BTN_GHOST = BTN + ";background:rgba(255,255,255,.08);color:" + C.text;
  var INPUT = "display:block;width:100%;box-sizing:border-box;min-height:44px;padding:11px 14px;border-radius:10px;border:1px solid rgba(255,255,255,.16);background:" + C.ink2 + ";color:#FFFFFF;font:inherit;font-size:16px;margin:0 0 10px";
  var TEXT = "margin:0 0 14px;font-size:15px;line-height:1.55;color:" + C.muted;

  function isProspect(ctx) {
    var v = ctx && ctx.venue;
    return !!(v && v.terms_required === true && v.status !== "suspended" && (ctx.role === "owner" || ctx.role === "manager"));
  }
  /* A NEW VENUE, however it signed up: its owner or a manager, not switched off, and the venue is under
     NEW_DAYS old. Whether it has run a game yet is asked by check() below, which needs the database. */
  var NEW_DAYS = 45;
  function isNew(ctx, now) {
    var v = ctx && ctx.venue;
    if (!v || v.status === "suspended" || !(ctx.role === "owner" || ctx.role === "manager")) return false;
    var t = Date.parse(v.created_at || "");
    if (!isFinite(t)) return false;
    return ((now || Date.now()) - t) < NEW_DAYS * 86400000;
  }
  function offered(ctx, now) { return isProspect(ctx) || isNew(ctx, now); }
  var _noGuide = {};   // venues this page has already found have played (or could not ask): never again here
  function readState(storage, venueId) {
    var s = null;
    try { s = JSON.parse(storage.getItem(KEY + venueId) || "null"); } catch (e) { s = null; }
    if (!s || typeof s !== "object") s = {};
    var i = STEPS.indexOf(s.step); if (i < 0) s.step = STEPS[0];
    return s;
  }
  function writeState(storage, venueId, s) { try { storage.setItem(KEY + venueId, JSON.stringify(s)); } catch (e) {} }
  function wants(ctx, storage, now) {
    if (!offered(ctx, now) || _noGuide[ctx.venue.id]) return false;
    var st = readState(storage || root.localStorage, ctx.venue.id);
    return !st.done && !st.dismissed;
  }
  /* "Open your setup guide" in a welcome email (?guide=1): a guide closed on this device opens again.
     A finished one stays finished, and a venue that is not new is left alone. */
  function reopen(ctx, storage) {
    storage = storage || root.localStorage;
    if (!offered(ctx)) return false;
    var st = readState(storage, ctx.venue.id);
    if (st.done || !st.dismissed) return false;
    st.dismissed = false; writeState(storage, ctx.venue.id, st); return true;
  }
  /* Should it open now? A prospect: yes (the card step is theirs). Any other new venue: only until its
     first game. Trivia and musical bingo stamp the venue row; bingo leaves a session. A venue that has
     played is marked done on this device. A read that fails opens nothing: a real venue's console must
     never be held up by a guide it may not need. Resolves true or false, never rejects. */
  function check(ctx, client, storage) {
    storage = storage || root.localStorage;
    if (!wants(ctx, storage)) return Promise.resolve(false);
    if (isProspect(ctx)) return Promise.resolve(true);
    var v = ctx.venue;
    function played() { var st = readState(storage, v.id); st.done = true; writeState(storage, v.id, st); _noGuide[v.id] = true; return false; }
    if (v.last_trivia_at || v.last_musical_at) return Promise.resolve(played());
    try {
      return Promise.resolve(client.from("vp_sessions").select("id").eq("venue_id", v.id).limit(1)).then(function (r) {
        if (!r || r.error || !Array.isArray(r.data)) { _noGuide[v.id] = true; return false; }
        return r.data.length ? played() : true;
      }, function () { _noGuide[v.id] = true; return false; });
    } catch (e) { _noGuide[v.id] = true; return Promise.resolve(false); }
  }
  /* An Australian mobile as Auth stores it: +614XXXXXXXX. Anything else is refused before a text is sent. */
  function mobileE164(raw) {
    var d = String(raw || "").replace(/[^0-9]/g, "");
    if (/^04\d{8}$/.test(d)) return "+61" + d.slice(1);
    if (/^614\d{8}$/.test(d)) return "+" + d;
    if (/^4\d{8}$/.test(d)) return "+61" + d;
    return "";
  }
  function mobileShow(e164) {
    var d = String(e164 || "").replace(/[^0-9]/g, "");
    if (/^614\d{8}$/.test(d)) d = "0" + d.slice(2);
    return /^04\d{8}$/.test(d) ? d.slice(0, 4) + " " + d.slice(4, 7) + " " + d.slice(7) : String(e164 || "");
  }
  function money(n) { return "$" + Number(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }

  /* THE QUESTIONS THE WIZARD ASKS (Dean, 5 Nov 2026, INBOX 44a). One list, used by the guide's steps and by the
     one-question-a-sign-in sheet (ask), so the words and the saved shape cannot drift apart. */
  var NIGHTS = [["mon", "Mon"], ["tue", "Tue"], ["wed", "Wed"], ["thu", "Thu"], ["fri", "Fri"], ["sat", "Sat"], ["sun", "Sun"]];
  var GAMES = [["trivia", "Trivia"], ["musical", "Musical bingo"], ["bingo", "Bingo"], ["raffles", "Raffles"], ["members", "Members draws"]];
  var TVS = [["1", "1 TV"], ["2", "2 TVs"], ["3", "3 TVs"], ["4", "4 or more"]];
  var QUESTIONS = {
    tvs: { title: "How many TVs will show venueplay?", options: TVS, multi: false },
    nights: { title: "Which nights do you run games?", options: NIGHTS, multi: true },
    games: { title: "Which games do you play?", options: GAMES, multi: true }
  };
  var ASK_ORDER = ["games", "nights", "tvs", "logo", "name"];
  function keysOf(list) { return list.map(function (o) { return o[0]; }); }
  /* What may be kept: only the known keys with only the known values, so nothing typed anywhere can ride in. */
  function cleanAnswers(a) {
    var out = {}; a = (a && typeof a === "object") ? a : {};
    if (keysOf(TVS).indexOf(String(a.tvs)) >= 0) out.tvs = String(a.tvs);
    ["nights", "games"].forEach(function (k) {
      var all = keysOf(k === "nights" ? NIGHTS : GAMES);
      if (Array.isArray(a[k])) out[k] = all.filter(function (x) { return a[k].indexOf(x) >= 0; });
    });
    if (a.name_ok === true) out.name_ok = true;
    return out;
  }
  /* The venue's saved answers (vp_venue_settings.setup_answers, once migration 163 is run) and this device's. */
  function answersFor(ctx, state) {
    var saved = (ctx && ctx.settings && ctx.settings.setup_answers) || {};
    var a = cleanAnswers(saved), l = cleanAnswers(state && state.answers);
    Object.keys(l).forEach(function (k) { if (a[k] === undefined || (Array.isArray(a[k]) && !a[k].length)) a[k] = l[k]; });
    return a;
  }
  function answered(key, a) {
    if (key === "tvs") return !!a.tvs;
    return Array.isArray(a[key]) && a[key].length > 0;
  }
  function persistAnswers(deps, VP, venueId, answers) {
    var f = deps.saveSettings || (VP && VP.saveSettings);
    if (typeof f !== "function") return Promise.resolve(false);
    try { return Promise.resolve(f(venueId, { setup_answers: answers })).then(function () { return true; }, function () { return false; }); }
    catch (e) { return Promise.resolve(false); }
  }
  /* Tap-to-choose buttons: one choice (multi false) or any number (multi true). Each tap calls onPick(key, value). */
  function chipRow(doc, key, options, multi, answers, onPick) {
    var row = doc.createElement("div"); row.setAttribute("style", "display:flex;flex-wrap:wrap;gap:8px;margin:0 0 6px"); row.id = "vpFrChips-" + key;
    function have(val) { var cur = answers[key]; return multi ? (Array.isArray(cur) && cur.indexOf(val) >= 0) : String(cur) === val; }
    function paint(b, val) {
      var on = have(val);
      b.setAttribute("aria-pressed", on ? "true" : "false");
      b.setAttribute("style", BTN + ";min-width:56px;text-align:center;border:2px solid " + (on ? C.pink : "rgba(255,255,255,.16)") + ";background:" + (on ? "rgba(255,31,142,.18)" : "rgba(255,255,255,.06)") + ";color:" + (on ? "#FFFFFF" : C.text));
    }
    options.forEach(function (o) {
      var b = doc.createElement("button"); b.setAttribute("type", "button"); b.id = "vpFrChip-" + key + "-" + o[0]; b.textContent = o[1];
      paint(b, o[0]);
      b.addEventListener("click", function () {
        if (multi) {
          var cur = Array.isArray(answers[key]) ? answers[key].slice() : [], i = cur.indexOf(o[0]);
          if (i >= 0) cur.splice(i, 1); else cur.push(o[0]);
          answers[key] = keysOf(options).filter(function (x) { return cur.indexOf(x) >= 0; });
        } else answers[key] = o[0];
        options.forEach(function (p, k) { paint(row.children[k], p[0]); });
        return onPick(key, answers[key]);
      });
      row.appendChild(b);
    });
    return row;
  }
  /* The saved answers in words, for the Account page's "About your venue" card: { tvs, nights, games }, each "" when
     not answered. One place for the wording, so the card and the guide agree. */
  function describeAnswers(a) {
    a = cleanAnswers(a);
    var games = GAMES.filter(function (g) { return (a.games || []).indexOf(g[0]) >= 0; }).map(function (g) { return g[1]; });
    return {
      tvs: a.tvs ? (a.tvs === "4" ? "4 or more TVs" : TVS.filter(function (t) { return t[0] === a.tvs; })[0][1]) : "",
      nights: (a.nights && a.nights.length) ? nightsWords(a.nights) : "",
      games: games.length < 2 ? games.join("") : games.slice(0, -1).join(", ") + " and " + games[games.length - 1]
    };
  }
  function nightsWords(list) {
    var names = NIGHTS.filter(function (n) { return list.indexOf(n[0]) >= 0; }).map(function (n) { return n[1]; });
    return names.length < 2 ? names.join("") : names.slice(0, -1).join(", ") + " and " + names[names.length - 1];
  }
  /* Their name is still the placeholder the Worker wrote at set up ("<venue> manager"), or missing. */
  function nameNeeded(ctx) {
    var v = ctx.venue;
    var row = (ctx.staff || []).filter(function (r) { return r && r.venue_id === v.id; })[0] || null;
    var nm = row ? String(row.display_name || "").trim() : "";
    return !nm || nm.toLowerCase() === (String(v.name || "") + " manager").toLowerCase();
  }

  function open(ctx, deps) {
    deps = deps || {};
    var doc = deps.doc || root.document, storage = deps.storage || root.localStorage;
    var fetchFn = deps.fetch || (root.fetch && root.fetch.bind(root));
    var client = deps.client, VP = deps.VP || root.VP;
    var every = deps.setInterval || (root.setInterval && root.setInterval.bind(root)), stop = deps.clearInterval || (root.clearInterval && root.clearInterval.bind(root));
    var go = deps.openUrl || function (u) { root.location.href = u; };
    var v = ctx.venue, state = readState(storage, v.id), prospect = isProspect(ctx);
    /* THE STEPS THIS VENUE STILL NEEDS. Their mobile is already on (the name-and-mobile screen,
       vp-about-you.js, asks for it first since 29 Oct 2026), the Terms are ticked, or the card is on:
       that step is left out, not shown as done. The login's phone and the card are confirmed below,
       before the first step is drawn. */
    var steps = STEPS.slice();
    function drop(name) { var i = steps.indexOf(name); if (i >= 0 && steps.length > 1) steps.splice(i, 1); }
    if (ctx.user && ctx.user.phone) { drop("mobile"); state.mobile = "done"; }
    if (v.compliance_accepted_at) drop("terms");
    var myRow = (ctx.staff || []).filter(function (r) { return r && r.venue_id === v.id; })[0] || null;
    var needName = nameNeeded(ctx);
    /* THE ANSWERS SO FAR (the venue's saved ones and this device's). A question already answered is left out. */
    var answers = answersFor(ctx, state);
    if (answers.tvs && answered("nights", answers) && answers.name_ok) drop("venue");
    if (answered("games", answers)) drop("games");
    function saveAnswer(key, value) {
      state.answers = cleanAnswers(answers); save();
      return persistAnswers(deps, VP, v.id, state.answers);
    }
    var needLogo = true;   // confirmed by /account/screen-get below, before the first step is drawn
    var cardInfo = null;   // the first /account/card-link answer, which the card step uses rather than asking twice
    var timers = [];
    var me = { phone: "", email: "", token: "" };
    var started = null;   // their free month starts the first time they sign in (/account/prospect-start, below)

    /* The code a person types on the TV: the venue's own join code, falling back to the derived one exactly as
       the console's "Screen code" chip does (VP.venueJoinCode in vp-session.js). One answer, one place. */
    function screenCode() {
      if (v.join_code) return String(v.join_code);
      return (VP && VP.venueCode && v.slug) ? String(VP.venueCode(v.slug)) : "";
    }
    /* A chosen logo as the data: URL /account/logo-upload takes. PNG and WebP go as they are; a JPEG is redrawn
       as a PNG (the Worker takes PNG or WebP only), no wider or taller than 1600px. deps.imageData stands in
       for this in the suite, which has no FileReader or canvas. */
    function imageData(file) {
      if (typeof deps.imageData === "function") return deps.imageData(file);
      return new Promise(function (ok, no) {
        var fr = new root.FileReader();
        fr.onerror = function () { no(new Error("read")); };
        fr.onload = function () {
          var url = String(fr.result || "");
          if (/^data:image\/(png|webp);/.test(url)) return ok(url);
          var im = new root.Image();
          im.onerror = function () { no(new Error("decode")); };
          im.onload = function () {
            var k = Math.min(1, 1600 / Math.max(im.width || 1, im.height || 1));
            var c = doc.createElement("canvas"); c.width = Math.max(1, Math.round(im.width * k)); c.height = Math.max(1, Math.round(im.height * k));
            c.getContext("2d").drawImage(im, 0, 0, c.width, c.height);
            ok(c.toDataURL("image/png"));
          };
          im.src = url;
        };
        fr.readAsDataURL(file);
      });
    }
    function el(tag, css, text) { var e = doc.createElement(tag); if (css) e.setAttribute("style", css); if (text != null) e.textContent = text; return e; }
    function clearTimers() { timers.forEach(function (t) { try { stop(t); } catch (e) {} }); timers = []; }
    function save() { writeState(storage, v.id, state); }
    function token() {
      if (!client || !client.auth) return Promise.resolve("");
      return client.auth.getSession().then(function (r) { return (r && r.data && r.data.session && r.data.session.access_token) || ""; }, function () { return ""; });
    }
    function billing(path, body) {
      return token().then(function (tok) {
        return fetchFn(BILLING_API + path, { method: "POST", headers: { "Content-Type": "application/json", "Authorization": "Bearer " + tok, "X-VP-Venue": String(v.id) }, body: JSON.stringify(body || {}) })
          .then(function (res) { return res.json().catch(function () { return { error: "Something went wrong at our end. Try again in a minute." }; }); });
      }).catch(function () { return { error: "Could not reach venueplay. Check your connection and try again." }; });
    }
    function loadMe() {
      if (!client || !client.auth || !client.auth.getUser) return Promise.resolve(me);
      return client.auth.getUser().then(function (r) {
        var u = r && r.data && r.data.user;
        me.phone = (u && u.phone) ? String(u.phone) : ""; me.email = (u && u.email) ? String(u.email) : "";
        return me;
      }, function () { return me; });
    }

    // ---------------------------------------------------------------- the frame
    var old = doc.getElementById("vpFirstRun"); if (old && old.parentNode) old.parentNode.removeChild(old);
    /* OPAQUE, AND THE PAGE'S HEADER STOOD DOWN WHILE IT IS OPEN (Dean, 29 Oct 2026, at 390px): the console's Help /
       Setup guide / Account / Sign out showed through behind "Step 2 of 5" and Close. The sticky header is its own
       layer on an iPhone and can paint through a fixed overlay, so it is hidden until the guide closes. */
    var pageHeader = doc.querySelector ? doc.querySelector("header") : null;
    if (pageHeader && pageHeader.style && pageHeader.setAttribute) {
      if (pageHeader.getAttribute("data-vpfr") === null) pageHeader.setAttribute("data-vpfr", pageHeader.style.visibility || "");   // its own, once, so a second open restores the right one
      pageHeader.style.visibility = "hidden";
    }
    var shell = el("div", "position:fixed;top:0;left:0;right:0;bottom:0;z-index:9000;overflow-y:auto;background:#0A0A0B;" + FONT + ";color:" + C.text + ";padding:0 16px;box-sizing:border-box");
    shell.id = "vpFirstRun"; shell.setAttribute("role", "dialog"); shell.setAttribute("aria-modal", "true"); shell.setAttribute("aria-label", "Getting started");
    /* THE TERMS CARD IT BORROWS (vp-session.js) sets 12 to 14.5px for its own page; inside the guide on a
       phone it is lifted to 15px, so nothing in the guide reads under 15px at 375px. */
    var lift = el("style", null, "@media (max-width:600px){#vpFirstRun #vpTermsCard p,#vpFirstRun #vpTermsCard label,#vpFirstRun #vpTermsCard span,#vpFirstRun #vpTermsCard button,#vpFirstRun #vpTermsCard a{font-size:15px!important}}");
    lift.id = "vpFrLift"; shell.appendChild(lift);
    var box = el("div", "max-width:480px;margin:0 auto;padding:28px 0 40px");
    shell.appendChild(box);
    var top = el("div", "display:flex;align-items:center;justify-content:space-between;gap:12px;margin:0 0 18px");
    var dots = el("div", "display:flex;gap:8px;align-items:center"); dots.id = "vpFrDots"; dots.setAttribute("aria-hidden", "true");
    var count = el("p", "margin:0;font-size:15px;letter-spacing:.1em;text-transform:uppercase;color:" + C.pink + ";font-weight:800"); count.id = "vpFrCount";
    var x = el("button", BTN_GHOST + ";min-height:40px;padding:8px 14px;font-size:15px", "Close"); x.id = "vpFrClose"; x.setAttribute("type", "button"); x.setAttribute("aria-label", "Close the setup guide");
    var left = el("div", "display:flex;flex-direction:column;gap:8px"); left.appendChild(count); left.appendChild(dots);
    top.appendChild(left); top.appendChild(x); box.appendChild(top);
    var card = el("div", "background:" + C.ink2 + ";border:1px solid " + C.line + ";border-radius:16px;padding:22px 20px");
    var title = el("h2", "margin:0 0 12px;font-size:22px;font-weight:800;line-height:1.25;color:#FFFFFF;font-family:" + HEAD); title.id = "vpFrTitle";
    var body = el("div", ""); body.id = "vpFrBody";
    card.appendChild(title); card.appendChild(body); box.appendChild(card);
    var foot = el("div", "display:flex;gap:10px;justify-content:space-between;align-items:center;margin:16px 0 0");
    var back = el("button", BTN_GHOST, "Back"); back.id = "vpFrBack"; back.setAttribute("type", "button");
    var next = el("button", BTN_PINK, "Next"); next.id = "vpFrNext"; next.setAttribute("type", "button");
    foot.appendChild(back); foot.appendChild(next); box.appendChild(foot);
    doc.body.appendChild(shell);

    function msgLine(id) { var m = el("p", "margin:8px 0 0;font-size:15px;line-height:1.5;color:" + C.pinkSoft + ";min-height:1px", ""); m.id = id; m.setAttribute("role", "status"); return m; }
    function setNext(label, enabled) {
      if (label === "Next" && steps.indexOf(state.step) === steps.length - 1) label = "Finish";   // the last step this venue has
      if (label === "Skip for now" && steps.indexOf(state.step) === steps.length - 1) label = "Finish";   // an optional last step (About you) closes the guide: say so
      next.textContent = label; next.disabled = !enabled;
      next.style.opacity = enabled ? "1" : ".45";
    }
    function close(finished) {
      clearTimers();
      if (finished) state.done = true; else state.dismissed = true;
      save();
      if (shell.parentNode) shell.parentNode.removeChild(shell);
      if (pageHeader && pageHeader.style && pageHeader.getAttribute) { pageHeader.style.visibility = pageHeader.getAttribute("data-vpfr") || ""; pageHeader.removeAttribute("data-vpfr"); }
      if (typeof deps.onClose === "function") deps.onClose(finished ? "done" : "closed");
    }

    // ---------------------------------------------------------------- the steps
    var STEP = {};
    STEP.mobile = function () {
      body.appendChild(el("p", TEXT, "Add your mobile so you can sign in with a text code, and so we can text you if something at " + (v.name || "your venue") + " needs you."));
      setNext("Skip for now", true);
      var holder = el("div", ""); body.appendChild(holder);
      return loadMe().then(function () {
        if (me.phone) {
          holder.appendChild(el("p", "margin:0;font-size:15px;line-height:1.55;color:" + C.ok + ";font-weight:700", "Done. " + mobileShow(me.phone) + " is on your login, so you can sign in by text."));
          state.mobile = "done"; save(); setNext("Next", true); return;
        }
        holder.appendChild(el("p", "margin:0 0 14px;font-size:15px;line-height:1.5;color:" + C.faint, "We text it a code first. It only goes on your login once you type that code in."));
        var lbl = el("label", "display:block;font-size:15px;font-weight:700;color:" + C.muted + ";margin:0 0 6px", "Your mobile"); lbl.setAttribute("for", "vpFrMobile");
        var inp = el("input", INPUT); inp.id = "vpFrMobile"; inp.setAttribute("type", "tel"); inp.setAttribute("inputmode", "tel"); inp.setAttribute("autocomplete", "tel"); inp.setAttribute("placeholder", "04xx xxx xxx");
        var send = el("button", BTN_PINK, "Text me a code"); send.id = "vpFrSend"; send.setAttribute("type", "button");
        var codeWrap = el("div", "display:none;margin-top:14px");
        var clbl = el("label", "display:block;font-size:15px;font-weight:700;color:" + C.muted + ";margin:0 0 6px", "The 6-digit code we texted you"); clbl.setAttribute("for", "vpFrCode");
        var code = el("input", INPUT + ";letter-spacing:.3em"); code.id = "vpFrCode"; code.setAttribute("inputmode", "numeric"); code.setAttribute("autocomplete", "one-time-code"); code.setAttribute("maxlength", "6");
        var verify = el("button", BTN_PINK, "Confirm"); verify.id = "vpFrVerify"; verify.setAttribute("type", "button");
        var msg = msgLine("vpFrMsg");
        codeWrap.appendChild(clbl); codeWrap.appendChild(code); codeWrap.appendChild(verify);
        holder.appendChild(lbl); holder.appendChild(inp); holder.appendChild(send); holder.appendChild(codeWrap); holder.appendChild(msg);
        var pending = "";
        send.addEventListener("click", function () {
          var ph = mobileE164(inp.value);
          if (!ph) { msg.textContent = "That is not an Australian mobile. It should start 04."; return Promise.resolve(false); }
          send.disabled = true; msg.textContent = "";
          return client.auth.updateUser({ phone: ph }).then(function (r) {
            send.disabled = false;
            if (r && r.error) { msg.textContent = /already|registered|exists/i.test(String(r.error.message || "")) ? "That mobile is already on another venueplay login. Use another, or skip this for now." : "We could not text that number just now. Check it and try again."; return false; }
            pending = ph; codeWrap.style.display = "block"; send.textContent = "Text me another code";
            msg.textContent = "Code sent to " + mobileShow(ph) + ". It can take a minute.";
            return true;
          }, function () { send.disabled = false; msg.textContent = "We could not text that number just now. Check it and try again."; return false; });
        });
        verify.addEventListener("click", function () {
          var c = String(code.value || "").replace(/[^0-9]/g, "");
          if (!pending) { msg.textContent = "Tap Text me a code first."; return Promise.resolve(false); }
          if (c.length !== 6) { msg.textContent = "Type the 6-digit code from the text."; return Promise.resolve(false); }
          verify.disabled = true;
          return client.auth.verifyOtp({ phone: pending, token: c, type: "phone_change" }).then(function (r) {
            verify.disabled = false;
            var u = r && r.data && r.data.user;
            if (!r || r.error || !u || !u.phone) { msg.textContent = "That code did not match. Check the text and try again."; return false; }
            me.phone = String(u.phone); state.mobile = "done"; save();
            while (holder.firstChild) holder.removeChild(holder.firstChild);
            holder.appendChild(el("p", "margin:0;font-size:15px;line-height:1.55;color:" + C.ok + ";font-weight:700", "Done. " + mobileShow(me.phone) + " is on your login, so you can sign in by text."));
            setNext("Next", true);
            return true;
          }, function () { verify.disabled = false; msg.textContent = "That code did not match. Check the text and try again."; return false; });
        });
      });
    };
    STEP.terms = function () {
      function accepted() { return !!v.compliance_accepted_at; }
      function done() {
        var d = doc.getElementById("vpTermsDone"); if (d) d.style.display = "none";
        setNext("Next", true);
      }
      if (accepted()) {
        body.appendChild(el("p", "margin:0;font-size:15px;line-height:1.55;color:" + C.ok + ";font-weight:700",
          "Done. Section 6 of the Terms is accepted for " + (v.name || "your venue") + (v.compliance_accepted_by ? " by " + v.compliance_accepted_by : "") + "."));
        done(); return;
      }
      body.appendChild(el("p", TEXT, "One tick, once. It confirms your venue runs its own games under the gaming laws that apply to it. venueplay supplies the software."));
      setNext("Next", false);
      if (VP && VP.termsCard) {
        VP.termsCard(ctx);
        var tc = doc.getElementById("vpTermsCard");
        if (tc) { tc.style.margin = "0"; tc.style.width = "100%"; body.appendChild(tc); }
      }
      var t = every(function () { if (accepted()) { clearTimers(); done(); } }, 400);
      timers.push(t);
    };
    /* ABOUT YOUR VENUE (Dean, 5 Nov 2026, INBOX 44a): the wizard asks first. All optional, each tap saved. */
    function heading(text) { return el("p", "margin:0 0 8px;font-size:15px;font-weight:700;color:" + C.muted, text); }
    function anyPick() { setNext("Next", true); }
    STEP.venue = function () {
      body.appendChild(el("p", TEXT, "A few quick questions so venueplay fits " + (v.name || "your venue") + ". Every one is optional, and you can change them later under Account."));
      setNext("Skip for now", true);
      /* 1. Is the name right? A wrong one goes to HQ as a ticket (no route renames a venue). */
      var nb = el("div", "margin:0 0 22px"); nb.id = "vpFrNameCheck";
      nb.appendChild(heading("Is this your venue's name?"));
      var nn = el("p", "margin:0 0 10px;font-size:20px;font-weight:800;line-height:1.3;color:#FFFFFF;font-family:" + HEAD + ";overflow-wrap:anywhere", v.name || ""); nn.id = "vpFrVenueName"; nb.appendChild(nn);
      var yes = el("button", BTN_GHOST + ";margin:0 8px 8px 0", "Yes, that's right"); yes.id = "vpFrNameYes"; yes.setAttribute("type", "button");
      var no = el("button", BTN_GHOST + ";margin:0 0 8px", "Not quite"); no.id = "vpFrNameNo"; no.setAttribute("type", "button");
      var fix = el("div", "display:none"); fix.id = "vpFrNameFix";
      var fl = el("label", "display:block;font-size:15px;font-weight:700;color:" + C.muted + ";margin:6px 0 6px", "What should it say?"); fl.setAttribute("for", "vpFrNameNew");
      var fi = el("input", INPUT); fi.id = "vpFrNameNew"; fi.setAttribute("type", "text"); fi.setAttribute("autocomplete", "off"); fi.setAttribute("maxlength", "80");
      var fs = el("button", BTN_PINK, "Send the right name"); fs.id = "vpFrNameSend"; fs.setAttribute("type", "button");
      fix.appendChild(fl); fix.appendChild(fi); fix.appendChild(fs);
      var nmsg = msgLine("vpFrNameCheckMsg");
      nb.appendChild(yes); nb.appendChild(no); nb.appendChild(fix); nb.appendChild(nmsg); body.appendChild(nb);
      if (answers.name_ok) { nmsg.style.color = C.ok; nmsg.textContent = "Thanks, that's confirmed."; }
      yes.addEventListener("click", function () {
        answers.name_ok = true; fix.style.display = "none"; nmsg.style.color = C.ok; nmsg.textContent = "Thanks, that's confirmed.";
        anyPick(); return saveAnswer("name_ok", true);
      });
      no.addEventListener("click", function () { fix.style.display = "block"; nmsg.textContent = ""; });
      fs.addEventListener("click", function () {
        var nm = String(fi.value || "").replace(/[\u0000-\u001f\u007f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 80);
        nmsg.style.color = C.pinkSoft;
        if (!nm) { nmsg.textContent = "Type what it should say first."; return Promise.resolve(false); }
        fs.disabled = true; nmsg.textContent = "";
        return billing("/help/venue/ticket", { venue_id: v.id, subject: "Please correct my venue name",
          message: "The venue is called " + (v.name || "(no name)") + " in venueplay. It should say " + nm + ". Sent from the setup guide.", category: "venue_support" }).then(function (j) {
          fs.disabled = false;
          if (!j || j.error || !j.ok) { nmsg.textContent = (j && j.error) || "That did not send. Try again in a minute."; return false; }
          fix.style.display = "none"; nmsg.style.color = C.ok; nmsg.textContent = "Thanks. We will change it to " + nm + " and tell you when it is done.";
          anyPick(); return true;
        });
      });
      /* 2 and 3. How many TVs, and which nights. */
      function pick(key) { return function () { anyPick(); return saveAnswer(key); }; }
      var tb = el("div", "margin:0 0 22px"); tb.id = "vpFrTvsBox";
      tb.appendChild(heading(QUESTIONS.tvs.title)); tb.appendChild(chipRow(doc, "tvs", TVS, false, answers, pick("tvs"))); body.appendChild(tb);
      var gb = el("div", ""); gb.id = "vpFrNightsBox";
      gb.appendChild(heading(QUESTIONS.nights.title)); gb.appendChild(chipRow(doc, "nights", NIGHTS, true, answers, pick("nights")));
      gb.appendChild(el("p", "margin:6px 0 0;font-size:15px;line-height:1.5;color:" + C.faint, "Tap every night you run games. Leave it blank if it changes week to week."));
      body.appendChild(gb);
      if (answers.tvs || answered("nights", answers) || answers.name_ok) setNext("Next", true);
    };
    STEP.games = function () {
      body.appendChild(el("p", TEXT, "Tap every game you play, or plan to. We use it to point you at the right pages. It is optional."));
      setNext(answered("games", answers) ? "Next" : "Skip for now", true);
      var gb = el("div", ""); gb.id = "vpFrGamesBox";
      gb.appendChild(chipRow(doc, "games", GAMES, true, answers, function () { anyPick(); return saveAnswer("games"); }));
      body.appendChild(gb);
    };
    STEP.tv = function () {
      /* THE TV, BY SCREEN CODE (Dean, 5 Nov 2026, INBOX 13). Two ways in, each a short numbered list:
         a Google TV gets the venueplay TV app; any other TV (or a laptop or stick plugged into it) opens
         venueplay.com.au/tv in its web browser. Both ask for the same six-character screen code, which
         is the venue's own join code, the one the console shows beside "Screen code". Never a slug link. */
      var code = screenCode();
      body.appendChild(el("p", TEXT, "Get " + (v.name || "your venue") + " on the TV in a couple of minutes. You will need this screen code:"));
      var codeBox = el("div", "margin:0 0 6px;padding:14px 16px;border-radius:12px;border:1px solid " + C.line + ";background:" + C.ink + ";text-align:center;color:#FFFFFF;font:800 30px/1.2 " + HEAD + ";letter-spacing:.22em", code || "------");
      codeBox.id = "vpFrTvCode"; codeBox.setAttribute("aria-label", "Your screen code " + String(code || "").split("").join(" "));
      body.appendChild(codeBox);
      var tvs = parseInt(answers.tvs, 10) || 0;
      if (tvs >= 2) {
        var many = el("p", TEXT, "You said " + (tvs >= 4 ? "four or more TVs" : tvs + " TVs") + ". Do the steps below on each TV, with the same screen code. Every screen shows the same thing."); many.id = "vpFrManyTvs";
        body.appendChild(many);
      }
      body.appendChild(el("p", "margin:0 0 18px;font-size:15px;line-height:1.5;color:" + C.faint + ";text-align:center", "It is also at the top of your host console, beside Screen code."));
      function way(id, head, items) {
        var w = el("div", "margin:0 0 14px;padding:16px;border-radius:12px;border:1px solid " + C.line + ";background:rgba(255,255,255,.03)"); w.id = id;
        w.appendChild(el("h3", "margin:0 0 10px;font-size:17px;font-weight:800;line-height:1.3;color:#FFFFFF;font-family:" + HEAD, head));
        var ol = el("ol", "margin:0;padding:0 0 0 22px;font-size:15px;line-height:1.55;color:" + C.muted);
        items.forEach(function (it) { var li = el("li", "margin:0 0 6px"); if (typeof it === "string") li.textContent = it; else li.appendChild(it); ol.appendChild(li); });
        w.appendChild(ol); body.appendChild(w); return w;
      }
      /* THE APP, FOR A GOOGLE TV (Dean, 31 Oct 2026, then 5 Nov). The store page is the link. */
      var playLi = el("span", ""); playLi.id = "vpFrPlay";
      playLi.appendChild(el("span", "", "On the TV, open Google Play and get the "));
      var playA = el("a", "color:#FF8AC4;font-weight:700;text-decoration:underline", "venueplay TV app");
      playA.setAttribute("href", "https://play.google.com/store/apps/details?id=au.com.venueplay.tv");
      playA.setAttribute("target", "_blank"); playA.setAttribute("rel", "noopener");
      playLi.appendChild(playA); playLi.appendChild(el("span", "", "."));
      way("vpFrTvApp", "On a Google TV", [playLi, "Open the app.", "Put in your screen code."]);
      way("vpFrTvWeb", "Or in the TV's web browser", ["Go to venueplay.com.au/tv on the TV (a laptop or streaming stick plugged into it works too).", "Put in your screen code.", "Go full screen and leave it running."]);
      body.appendChild(el("p", TEXT, "Keep the venueplay screen full screen, or at least never covered by another window. A covered browser window slows down and the TV can fall behind."));
      var frame = el("div", "position:relative;width:100%;padding-top:56.25%;border-radius:12px;overflow:hidden;background:#000;border:1px solid " + C.line);
      frame.id = "vpFrPreview";
      var img = el("img", "position:absolute;top:0;left:0;width:100%;height:100%;object-fit:contain;display:none"); img.id = "vpFrSlide"; img.setAttribute("alt", "Your TV slide");
      var empty = el("p", "position:absolute;top:50%;left:0;right:0;margin:0;transform:translateY(-50%);text-align:center;font-size:15px;color:" + C.faint, "Loading your TV...");
      frame.appendChild(img); frame.appendChild(empty); body.appendChild(frame);
      var cap = el("p", "margin:10px 0 0;font-size:15px;line-height:1.5;color:" + C.faint, ""); cap.id = "vpFrCaption"; body.appendChild(cap);
      setNext("Next", true);
      return billing("/account/screen-get", { venue_id: v.id }).then(function (d) {
        var slides = ((d && d.slides) || []).filter(function (s) { return s && /^https:\/\//.test(String(s.image_url || "")); });
        if (!slides.length) {
          empty.textContent = "Your TV shows the venueplay screen";
          cap.textContent = "No slides yet. Add your own ads any time under Account and they show on the TV straight away.";
          return 0;
        }
        var i = 0;
        img.setAttribute("src", slides[0].image_url); img.style.display = "block"; empty.textContent = "";
        cap.textContent = slides.length === 1 ? "Your slide, as your TV shows it between games." : "Your " + slides.length + " slides, as your TV shows them between games.";
        if (slides.length > 1) timers.push(every(function () { i = (i + 1) % slides.length; img.setAttribute("src", slides[i].image_url); }, 4000));
        return slides.length;
      });
    };
    /* ADD YOUR HOSTS (Dean, 5 Nov 2026, INBOX 13). Name and mobile, one at a time, through the same billing
       Worker route as Account > People > Add a host (/account/host-add, this venue only). The Worker makes
       the host's login and texts them their own sign-in link; nothing here sends a text itself. Hosts sign
       in by mobile, never email (Dean, 29 Oct). Optional: a venue whose owner hosts can skip it. */
    STEP.hosts = function () {
      body.appendChild(el("p", TEXT, "Hosts run the games on the night. Add each one with their name and mobile, and we text them their own sign-in link. Nothing to install and no password."));
      var list = el("div", "margin:0 0 14px"); list.id = "vpFrHostList"; body.appendChild(list);
      var added = 0;
      function row(name, sub) {
        var r = el("div", "display:flex;justify-content:space-between;gap:10px;align-items:baseline;padding:10px 12px;margin:0 0 8px;border-radius:10px;border:1px solid " + C.line + ";background:" + C.ink);
        r.setAttribute("data-host", "1");
        r.appendChild(el("b", "font-size:15px;color:#FFFFFF;font-weight:700;overflow-wrap:anywhere", name));
        r.appendChild(el("span", "font-size:15px;color:" + C.faint + ";white-space:nowrap", sub));
        list.appendChild(r);
      }
      var none = el("p", "margin:0;font-size:15px;line-height:1.5;color:" + C.faint, "No hosts yet. If you host every night yourself, skip this."); none.id = "vpFrHostNone";
      list.appendChild(none);
      var nl = el("label", "display:block;font-size:15px;font-weight:700;color:" + C.muted + ";margin:0 0 6px", "Host's name"); nl.setAttribute("for", "vpFrHostName");
      var name = el("input", INPUT); name.id = "vpFrHostName"; name.setAttribute("type", "text"); name.setAttribute("autocomplete", "off"); name.setAttribute("placeholder", "First and last name");
      var ml = el("label", "display:block;font-size:15px;font-weight:700;color:" + C.muted + ";margin:0 0 6px", "Their mobile"); ml.setAttribute("for", "vpFrHostMobile");
      var mob = el("input", INPUT); mob.id = "vpFrHostMobile"; mob.setAttribute("type", "tel"); mob.setAttribute("inputmode", "tel"); mob.setAttribute("autocomplete", "off"); mob.setAttribute("placeholder", "04xx xxx xxx");
      var add = el("button", BTN_PINK + ";width:100%", "Add host and text them"); add.id = "vpFrHostAdd"; add.setAttribute("type", "button");
      var msg = msgLine("vpFrHostMsg");
      body.appendChild(nl); body.appendChild(name); body.appendChild(ml); body.appendChild(mob); body.appendChild(add); body.appendChild(msg);
      body.appendChild(el("p", "margin:14px 0 0;font-size:15px;line-height:1.5;color:" + C.faint, "Add or remove hosts any time under Account, then People."));
      setNext("Skip for now", true);
      add.addEventListener("click", function () {
        var nm = String(name.value || "").trim(), ph = mobileE164(mob.value);
        msg.style.color = C.pinkSoft;
        if (!nm) { msg.textContent = "Type the host's name first."; return Promise.resolve(false); }
        if (!ph) { msg.textContent = "That is not an Australian mobile. It should start 04."; return Promise.resolve(false); }
        add.disabled = true; msg.textContent = "";
        return billing("/account/host-add", { label: nm.slice(0, 80), mobile: ph, venue_ids: [v.id], all_venues: false }).then(function (r) {
          add.disabled = false;
          if (!r || r.error || !r.ok) { msg.textContent = (r && r.error) || "That host could not be added just now. Try again in a minute."; return false; }
          added++; none.style.display = "none"; row(nm, mobileShow(ph));
          name.value = ""; mob.value = "";
          msg.style.color = C.ok; msg.textContent = "Done. We have texted " + nm + " their sign-in link. Add another, or tap Next.";
          state.hosts = added; save(); setNext("Next", true);
          return true;
        });
      });
      /* Who is already on (a host added from Account before the guide, or an earlier visit to this step). */
      return billing("/account/hosts", {}).then(function (d) {
        var hs = ((d && d.hosts) || []).filter(function (h) { return h && !h.is_owner && h.role === "host" && (h.venue_ids || []).indexOf(v.id) >= 0; });
        hs.forEach(function (h) { row(String(h.label || "Host"), h.mobile_last3 ? "mobile ending " + h.mobile_last3 : "Host"); });
        if (hs.length) { none.style.display = "none"; if (!added) setNext("Next", true); }
        return hs.length;
      });
    };
    STEP.game = function () {
      var q = "?venue=" + encodeURIComponent(v.slug || "");
      /* A TEST GAME, TRIVIA FIRST (Dean, 5 Nov 2026, INBOX 13): try it before the first real night, with the TV
         on and their own phone as the player. */
      body.appendChild(el("p", TEXT, "Run a quick test game now, before your first real night. With the TV on, join from your own phone using the QR code on the TV, so you see what your players see."));
      body.appendChild(el("p", TEXT, "Trivia takes three taps: pick a question set, tap Open lobby, then Start once people have joined on their phones from the QR code on the TV."));
      var tri = el("button", BTN_PINK + ";width:100%;margin:0 0 10px", "Open trivia"); tri.id = "vpFrTrivia"; tri.setAttribute("type", "button");
      var mus = el("button", BTN_GHOST + ";width:100%", "Or try musical bingo"); mus.id = "vpFrMusical"; mus.setAttribute("type", "button");
      body.appendChild(tri); body.appendChild(mus);
      /* WHAT THEIR ANSWERS POINT AT: the Account pages for the other games they play, and their game nights. */
      var gl = answers.games || [], notes = [];
      if (gl.indexOf("raffles") >= 0 || gl.indexOf("members") >= 0) notes.push("Raffles and members draws are set up under Account, then Draws.");
      if (gl.indexOf("bingo") >= 0) notes.push("For bingo, add your permit details under Account, then Game settings.");
      if (answered("nights", answers)) notes.push("Your game nights: " + nightsWords(answers.nights) + ". Run this test before the first one.");
      if (notes.length) {
        var nl2 = el("ul", "margin:14px 0 0;padding:0 0 0 20px;font-size:15px;line-height:1.55;color:" + C.muted); nl2.id = "vpFrGameNotes";
        notes.forEach(function (t) { nl2.appendChild(el("li", "margin:0 0 6px", t)); });
        body.appendChild(nl2);
      }
      body.appendChild(el("p", "margin:12px 0 0;font-size:15px;line-height:1.5;color:" + C.faint, "Musical bingo: pick a playlist, tap Open lobby, then Deal, then Play. Come back to this guide any time from Setup guide at the top."));
      // Leaving for a game moves the guide on, so it reopens on the last step.
      function leave(path) { var gi = steps.indexOf("game"); state.step = steps[gi + 1] || "game"; save(); clearTimers(); go(path + q); }
      tri.addEventListener("click", function () { leave("/app/trivia/host.html"); });
      mus.addEventListener("click", function () { leave("/app/musical/host.html"); });
      setNext("Next", true);
    };
    /* ABOUT YOU AND YOUR VENUE (Dean, 5 Nov 2026, INBOX 24). Two optional questions, each only while its
       answer is empty, each saved by the route the Account page already uses. Skippable as a whole. */
    STEP.account = function () {
      body.appendChild(el("p", TEXT, "Two quick ones for your Account page. Both are optional, and you can change them any time under Account."));
      var saved = 0;
      function savedOne() { saved++; setNext("Next", true); }
      setNext("Skip for now", true);
      if (needName) {
        var nb = el("div", "margin:0 0 20px"); nb.id = "vpFrNameBox";
        var nl = el("label", "display:block;font-size:15px;font-weight:700;color:" + C.muted + ";margin:0 0 6px", "Your name"); nl.setAttribute("for", "vpFrMyName");
        var ni = el("input", INPUT); ni.id = "vpFrMyName"; ni.setAttribute("type", "text"); ni.setAttribute("autocomplete", "name"); ni.setAttribute("placeholder", "First and last name");
        var nh = el("p", "margin:0 0 10px;font-size:15px;line-height:1.5;color:" + C.faint, "So your hosts and our team know who they are talking to.");
        var ns = el("button", BTN_PINK, "Save my name"); ns.id = "vpFrNameSave"; ns.setAttribute("type", "button");
        var nm = msgLine("vpFrNameMsg");
        nb.appendChild(nl); nb.appendChild(nh); nb.appendChild(ni); nb.appendChild(ns); nb.appendChild(nm); body.appendChild(nb);
        ns.addEventListener("click", function () {
          var name = String(ni.value || "").replace(/\s+/g, " ").trim().slice(0, 60);
          nm.style.color = C.pinkSoft;
          if (!name) { nm.textContent = "Type your name first."; return Promise.resolve(false); }
          ns.disabled = true; nm.textContent = "";
          return billing("/account/my-name", { name: name }).then(function (r) {
            ns.disabled = false;
            if (!r || r.error || !r.ok) { nm.textContent = (r && r.error) || "That did not save. Try again."; return false; }
            needName = false; if (myRow) myRow.display_name = r.name || name;
            nm.style.color = C.ok; nm.textContent = "Saved. You are " + (r.name || name) + ".";
            savedOne(); return true;
          });
        });
      }
      if (needLogo) {
        var lb = el("div", ""); lb.id = "vpFrLogoBox";
        var ll = el("label", "display:block;font-size:15px;font-weight:700;color:" + C.muted + ";margin:0 0 6px", "Your logo"); ll.setAttribute("for", "vpFrLogoFile");
        var lh = el("p", "margin:0 0 10px;font-size:15px;line-height:1.5;color:" + C.faint, "It shows on your TV between games. A PNG with a see-through background looks best.");
        /* The browser's own file button is unbranded and its "No file chosen" is small: the input stays (for the
           keyboard and screen readers, focusable) but out of sight, and a guide-styled label opens it. */
        var lf = el("input", "position:absolute;width:1px;height:1px;opacity:0;overflow:hidden;font-size:15px"); lf.id = "vpFrLogoFile"; lf.setAttribute("type", "file"); lf.setAttribute("accept", "image/png,image/webp,image/jpeg");
        var lp = el("label", BTN_GHOST + ";display:inline-block;text-align:center", "Choose a logo file"); lp.id = "vpFrLogoPick"; lp.setAttribute("for", "vpFrLogoFile");
        var lm = msgLine("vpFrLogoMsg");
        var lt = el("img", "display:none;max-width:200px;max-height:90px;margin:10px 0 0;background:#000;border-radius:8px;padding:6px"); lt.id = "vpFrLogoThumb"; lt.setAttribute("alt", "Your logo");
        lb.appendChild(ll); lb.appendChild(lh); lb.appendChild(lf); lb.appendChild(lp); lb.appendChild(lm); lb.appendChild(lt); body.appendChild(lb);
        lf.addEventListener("change", function () {
          var file = lf.files && lf.files[0];
          lm.style.color = C.pinkSoft;
          if (!file) return Promise.resolve(false);
          if (!/^image\/(png|webp|jpeg)$/.test(String(file.type || ""))) { lm.textContent = "Use a PNG, WebP or JPEG image."; return Promise.resolve(false); }
          lm.style.color = C.faint; lm.textContent = "Uploading your logo...";
          return Promise.resolve(imageData(file)).then(function (data) {
            if (!data || !/^data:image\/(png|webp);base64,/.test(data)) { lm.style.color = C.pinkSoft; lm.textContent = "That image could not be read. Try another file."; return false; }
            if (Math.floor((data.length - data.indexOf(",") - 1) * 3 / 4) > 1024 * 1024) { lm.style.color = C.pinkSoft; lm.textContent = "That logo is too big. Keep it to 1MB or less."; return false; }
            return billing("/account/logo-upload", { venue_id: v.id, data: data }).then(function (r) {
              if (!r || r.error || !r.ok) { lm.style.color = C.pinkSoft; lm.textContent = (r && r.error) || "Could not upload the logo. Try again."; return false; }
              needLogo = false;
              lm.style.color = C.ok; lm.textContent = "Saved. Your logo is on your TV now.";
              if (r.url) { lt.setAttribute("src", r.url); lt.style.display = "block"; }
              savedOne(); return true;
            });
          }, function () { lm.style.color = C.pinkSoft; lm.textContent = "That image could not be read. Try another file."; return false; });
        });
      }
    };
    STEP.card = function () {
      var price = el("p", TEXT, "Your price is set on your usual crowd, not counted each time you play."); price.id = "vpFrPrice";
      body.appendChild(price);
      /* TWO EQUAL CHOICES (Dean, 29 Oct 2026, phase 2): "Add your card now" (not charged until the free month
         ends) or "Later" (a reminder email comes before it ends). Same size, side by side, no pressure. */
      var choices = el("div", "display:flex;gap:10px;flex-wrap:wrap"); choices.id = "vpFrChoices";   // both, always (audit 2.5)
      choices.style.display = "flex";
      var cardBtn = el("a", BTN_PINK + ";text-decoration:none;text-align:center;flex:1 1 150px", "Add your card now"); cardBtn.id = "vpFrCard";
      /* SAME TAB (Dean, 29 Oct 2026): in a new tab, Stripe's back arrow landed on a fresh copy of the console
         that asked him to sign in all over again. Here Back (and Stripe's own back link, /app/) returns to
         this console, still signed in, and the guide reopens on this step. */
      cardBtn.setAttribute("rel", "noopener");
      var later = el("button", BTN_GHOST + ";flex:1 1 150px", "Later"); later.id = "vpFrLater"; later.setAttribute("type", "button");
      choices.appendChild(cardBtn); choices.appendChild(later);
      var cardMsg = msgLine("vpFrCardMsg");
      var retry = el("button", BTN_GHOST + ";display:none;margin:10px 0 0", "Retry"); retry.id = "vpFrRetry"; retry.setAttribute("type", "button");
      body.appendChild(choices); body.appendChild(cardMsg); body.appendChild(retry);
      /* Until the link is in, "Add your card now" is dimmed and a tap fetches it again rather than going nowhere. */
      function linkReady(on) { cardBtn.style.opacity = on ? "1" : ".45"; cardBtn.setAttribute("aria-disabled", on ? "false" : "true"); }
      linkReady(false);
      cardBtn.addEventListener("click", function (e) {
        if (!cardBtn.getAttribute("href")) { if (e && e.preventDefault) e.preventDefault(); return loadLink(true); }
        billing("/account/card-choice", { venue_id: v.id, choice: "now" });
      });
      later.addEventListener("click", function () {
        billing("/account/card-choice", { venue_id: v.id, choice: "later" });
        cardMsg.style.color = C.ok;
        cardMsg.textContent = "No problem. We'll send you a reminder email to add your card before your free month ends.";
        return true;
      });
      body.appendChild(el("p", "margin:12px 0 22px;font-size:15px;line-height:1.5;color:" + C.faint, "The link is secure and goes to our payment provider, Stripe. Nothing is charged when you add it, and nothing until your free month ends."));
      var help = el("div", "border-top:1px solid " + C.line + ";padding-top:18px");
      help.appendChild(el("p", "margin:0 0 10px;font-size:15px;font-weight:700;color:#FFFFFF", "Need a hand?"));
      var callWrap = el("div", "display:none"); callWrap.id = "vpFrCallWrap";
      var clbl = el("label", "display:block;font-size:15px;font-weight:700;color:" + C.muted + ";margin:0 0 6px", "Your mobile, for the call"); clbl.setAttribute("for", "vpFrCallMobile");
      var cin = el("input", INPUT); cin.id = "vpFrCallMobile"; cin.setAttribute("type", "tel"); cin.setAttribute("inputmode", "tel"); cin.setAttribute("placeholder", "04xx xxx xxx");
      callWrap.appendChild(clbl); callWrap.appendChild(cin);
      var call = el("button", BTN_GHOST + ";width:100%", "Tap here and Dean will call"); call.id = "vpFrCall"; call.setAttribute("type", "button");
      var callMsg = msgLine("vpFrCallMsg");
      help.appendChild(callWrap); help.appendChild(call); help.appendChild(callMsg); body.appendChild(help);
      setNext("Finish", true);
      call.addEventListener("click", function () {
        var ph = me.phone || mobileE164(cin.value);
        if (!ph) { callWrap.style.display = "block"; call.textContent = "Call me on this number"; callMsg.textContent = cin.value ? "That is not an Australian mobile. It should start 04." : "Pop your mobile in and tap again."; return Promise.resolve(false); }
        call.disabled = true; callMsg.textContent = "";
        return billing("/help/venue/ticket", { venue_id: v.id, subject: "Please call me",
          message: "Please call me on " + mobileShow(ph) + ". Sent from the setup guide at " + (v.name || "the venue") + (prospect ? ", which HQ set up as a prospect." : ", a new venue."),
          category: "venue_support" }).then(function (j) {
          if (!j || j.error || !j.ok) { call.disabled = false; callMsg.textContent = (j && j.error) || "That did not send. Try again in a minute."; return false; }
          callWrap.style.display = "none";
          call.textContent = "Dean will call you";
          callMsg.style.color = C.ok;
          callMsg.textContent = "Thanks. Dean will call you on " + mobileShow(ph) + (j.ticket_no ? " (ticket " + j.ticket_no + ")." : ".");
          return true;
        });
      });
      function applyLink(d) {
        if (d && d.ok && d.has_card) { cardMsg.style.color = C.ok; cardMsg.textContent = "Your card is on. Thank you."; choices.style.display = "none"; retry.style.display = "none"; return "has_card"; }
        if (!d || !d.ok || !d.card_url) {
          cardMsg.style.color = C.pinkSoft;
          cardMsg.textContent = ((d && d.error) || "The card link could not load just now.") + " Tap Retry, or choose Later.";
          retry.style.display = "inline-block"; linkReady(false);
          return "error";
        }
        retry.style.display = "none"; cardMsg.textContent = "";
        price.textContent = "It's " + money(d.rate) + " a player a month on your usual crowd: " + d.seats + " players is " + money(d.monthly) + " a month. " +
          (d.ends_words ? "Your free month runs until " + d.ends_words + ", and your card won't be charged before then." : "Your first month is free, and your card won't be charged before it ends.") + " No lock-in.";
        cardBtn.setAttribute("href", d.card_url); linkReady(true);
        return "link";
      }
      function loadLink(fresh) {
        var ask = (!fresh && cardInfo) ? Promise.resolve(cardInfo) : billing("/account/card-link", { venue_id: v.id });
        if (fresh) { retry.disabled = true; cardMsg.style.color = C.faint; cardMsg.textContent = "Getting your card link..."; }
        return ask.then(function (d) { retry.disabled = false; if (fresh) cardInfo = d; return applyLink(d); });
      }
      retry.addEventListener("click", function () { return loadLink(true); });
      return Promise.all([loadMe(), loadLink(false)]).then(function (a) { return a[1]; });
    };

    var api = {
      el: shell,
      step: function () { return state.step; },
      steps: function () { return steps.slice(); },
      go: function (name) {
        if (steps.indexOf(name) < 0) return null;
        clearTimers();
        state.step = name; save();
        var i = steps.indexOf(name);
        count.textContent = "Step " + (i + 1) + " of " + steps.length;
        while (dots.firstChild) dots.removeChild(dots.firstChild);
        steps.forEach(function (s, k) { var d = el("span", "display:inline-block;width:" + (k === i ? "22px" : "8px") + ";height:8px;border-radius:4px;background:" + (k <= i ? C.pink : "rgba(255,255,255,.18)")); d.setAttribute("data-step", s); dots.appendChild(d); });
        title.textContent = TITLES[name];
        while (body.firstChild) body.removeChild(body.firstChild);
        back.style.visibility = i === 0 ? "hidden" : "visible";
        return STEP[name]();
      },
      next: function () {
        if (next.disabled) return null;
        var i = steps.indexOf(state.step);
        if (state.step === "mobile" && state.mobile !== "done") state.mobile = "skipped";
        if (i >= steps.length - 1) { close(true); return "done"; }
        return api.go(steps[i + 1]);
      },
      back: function () { var i = steps.indexOf(state.step); if (i > 0) return api.go(steps[i - 1]); return null; },
      close: function () { close(false); }
    };
    next.addEventListener("click", function () { api.next(); });
    back.addEventListener("click", function () { api.back(); });
    x.addEventListener("click", function () { api.close(); });
    state.dismissed = false; save();
    /* THE FREE MONTH STARTS NOW, the first time they are in (Dean, 29 Oct 2026, phase 2; migration 127). The
       Worker sets it once and never moves it; a second sign-in changes nothing. */
    started = prospect ? billing("/account/prospect-start", { venue_id: v.id }).catch(function () { return null; }) : Promise.resolve(null);
    api.started = started;
    /* Where it opens: the step it was on, or the first one after it this venue still needs. */
    function resumeAt(name) {
      if (steps.indexOf(name) >= 0) return name;
      for (var k = STEPS.indexOf(name) + 1; k < STEPS.length; k++) if (steps.indexOf(STEPS[k]) >= 0) return STEPS[k];
      return steps[steps.length - 1];
    }
    count.textContent = ""; title.textContent = "Getting started";
    api.ready = Promise.all([loadMe(), billing("/account/card-link", { venue_id: v.id }), billing("/account/screen-get", { venue_id: v.id })]).then(function (a) {
      if (me.phone) { drop("mobile"); state.mobile = "done"; }
      cardInfo = a[1] || null;
      if (cardInfo && cardInfo.ok && cardInfo.has_card) drop("card");
      if (a[2] && a[2].ok && a[2].logo_url) needLogo = false;   // a read that fails still offers the logo: it is optional
      if (!needName && !needLogo) drop("account");
    }, function () {}).then(function () { return shell.parentNode ? api.go(resumeAt(state.step)) : null; });
    return api;
  }


  /* ONE SHORT QUESTION ON A LATER SIGN-IN (Dean, 5 Nov 2026, INBOX 46). Once the guide is done or closed, a new
     venue's owner or manager may be asked ONE more thing the Account page still lacks, as a bottom sheet over the
     console: never more than one a sign-in (kept per tab), always "Not now", and a question skipped twice is
     never asked again. A venue the guide is not for is never asked. A logo or a name is not asked inline: "Add it"
     opens the guide on that step. Resolves to the question key shown, or "" for none; never rejects. */
  var ASK_KEY = "vpAsk:";
  function readAsk(storage, venueId) {
    var s = null; try { s = JSON.parse(storage.getItem(ASK_KEY + venueId) || "null"); } catch (e) { s = null; }
    if (!s || typeof s !== "object" || !s.skips || typeof s.skips !== "object") s = { skips: {} };
    return s;
  }
  function nextQuestion(ctx, storage, now) {   // ask() has already checked the venue is one the guide is for
    var v = ctx.venue, st = readState(storage, v.id), a = answersFor(ctx, st), skips = readAsk(storage, v.id).skips;
    for (var i = 0; i < ASK_ORDER.length; i++) {
      var k = ASK_ORDER[i];
      if ((skips[k] || 0) >= 2) continue;
      if (k === "logo" ? !v.logo_url : (k === "name" ? nameNeeded(ctx) : !answered(k, a))) return k;
    }
    return "";
  }
  function ask(ctx, deps) {
    try { return askInner(ctx, deps || {}); } catch (e) { return Promise.resolve(""); }
  }
  function askInner(ctx, deps) {
      deps = deps || {};
      var doc = deps.doc || root.document, storage = deps.storage || root.localStorage, VP = deps.VP || root.VP;
      var sess = deps.session || root.sessionStorage;
      if (!offered(ctx, deps.now) || wants(ctx, storage, deps.now)) return Promise.resolve("");   // the guide itself is due, or not for them
      var v = ctx.venue, shownKey = "vpAskShown:" + v.id;
      var shown = false; try { shown = !!(sess && sess.getItem(shownKey)); } catch (e) { shown = false; }
      if (shown) return Promise.resolve("");
      var key = nextQuestion(ctx, storage, deps.now);
      if (!key) return Promise.resolve("");
      try { if (sess) sess.setItem(shownKey, "1"); } catch (e) {}
      var old = doc.getElementById("vpAsk"); if (old && old.parentNode) old.parentNode.removeChild(old);
      function el(tag, css, text) { var e = doc.createElement(tag); if (css) e.setAttribute("style", css); if (text != null) e.textContent = text; return e; }
      var st = readState(storage, v.id), answers = answersFor(ctx, st);
      var sheet = el("div", "position:fixed;left:0;right:0;bottom:0;z-index:8500;background:" + C.ink2 + ";border-top:1px solid " + C.line + ";box-shadow:0 -10px 30px rgba(0,0,0,.5);" + FONT + ";color:" + C.text + ";padding:16px 16px calc(16px + env(safe-area-inset-bottom,0px));box-sizing:border-box");
      sheet.id = "vpAsk"; sheet.setAttribute("role", "dialog"); sheet.setAttribute("aria-label", "One quick question");
      var box = el("div", "max-width:480px;margin:0 auto");
      box.appendChild(el("p", "margin:0 0 6px;font-size:15px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:" + C.pink, "One quick question"));
      var q = QUESTIONS[key];
      box.appendChild(el("h3", "margin:0 0 10px;font-size:19px;font-weight:800;line-height:1.3;color:#FFFFFF;font-family:" + HEAD,
        q ? q.title : (key === "logo" ? "Add your logo for your TV?" : "What should we call you?")));
      var picked = false;
      function save() { var c = cleanAnswers(answers); st.answers = c; writeState(storage, v.id, st); return persistAnswers(deps, VP, v.id, c); }
      var row = el("div", "display:flex;gap:10px;flex-wrap:wrap;margin:12px 0 0");
      var doneBtn = el("button", BTN_PINK, q ? "Done" : "Add it"); doneBtn.id = "vpAskDone"; doneBtn.setAttribute("type", "button");
      var later = el("button", BTN_GHOST, "Not now"); later.id = "vpAskLater"; later.setAttribute("type", "button");
      if (q) box.appendChild(chipRow(doc, key, q.options, q.multi, answers, function () { picked = true; return save(); }));
      else box.appendChild(el("p", "margin:0;font-size:15px;line-height:1.5;color:" + C.muted, key === "logo" ? "It shows on your TV between games." : "So your hosts and our team know who is who."));
      row.appendChild(doneBtn); row.appendChild(later); box.appendChild(row); sheet.appendChild(box); doc.body.appendChild(sheet);
      function closeSheet(outcome) { if (sheet.parentNode) sheet.parentNode.removeChild(sheet); if (typeof deps.onClose === "function") deps.onClose(outcome); }
      function skip() { var a = readAsk(storage, v.id); a.skips[key] = (a.skips[key] || 0) + 1; try { storage.setItem(ASK_KEY + v.id, JSON.stringify(a)); } catch (e) {} closeSheet("skipped"); }
      later.addEventListener("click", skip);
      doneBtn.addEventListener("click", function () {
        if (!q) {   // a logo or a name: the guide's own step does it
          var g = readState(storage, v.id); g.step = "account"; g.dismissed = false; g.done = false; writeState(storage, v.id, g);
          closeSheet("guide"); return open(ctx, deps);
        }
        if (picked && answered(key, answers)) { closeSheet("answered"); return true; }
        return skip();
      });
      return Promise.resolve(key);
  }

  root.VPFirstRun = { describe: describeAnswers, ask: ask, nextQuestion: nextQuestion, answersFor: answersFor, cleanAnswers: cleanAnswers, NIGHTS: NIGHTS, GAMES: GAMES, TVS: TVS, open: open, wants: wants, check: check, reopen: reopen, offered: offered, isNew: isNew, isProspect: isProspect, STEPS: STEPS, KEY: KEY, mobileE164: mobileE164, NEW_DAYS: NEW_DAYS };
})(typeof window !== "undefined" ? window : this);
