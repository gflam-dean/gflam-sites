/* THE SETUP WIZARD'S GAMES (Dean, 6 Nov 2026, INBOX 104, his four clarifications, and his round 2 notes the same day).

   After the try-it demo a new venue lands on its console and the setup wizard opens. This file is the games part:

     1. A heads-up: each game takes less than five minutes; you don't need to do it all now (each game can be set up
        the first time you open it); members draw details handy (only while they may run members draws); advertising
        handy (promo images, logo) for the screen step; then you're ready for your week.
     2. "What games do you play at your venue?" Ticks: trivia, musical bingo, bingo, raffles, members draws (jag the
        joker joins when it is live), and "Something else" with a short box. STORED for the venue in
        vp_venue_settings.setup_answers (migration 163, NOT RUN: "games", "games_at" the Brisbane date it was first
        answered, "other" at most 60 characters) for Dean's monthly email and HQ. Before 163 it stays on this device.
     3. "Would you like to set them all up today?" Yes: each ticked game, ONE AT A TIME (members draws included),
        its settings with the defaults filled in, the advanced ones as short questions, and a "?" beside every setting
        (words from vp-setup-help.js, the ONE shared list). On a phone the "?" opens underneath the setting; on a
        tablet or laptop it opens as a bubble under its label (Dean, round 2).
     4. After each game, ONLY inside this first run: "Do you want to set up your next game?" Yes: "What would you like
        to set up next?". No: "No worries. We'll remind you when you open each of those games. Your default settings
        have been saved for <games>." Members draws have no defaults, so they get their own honest line instead.
     5. A game they skipped: the FIRST time an owner or manager opens that game's console, that game's own setup
        opens over it (firstOpen), once, never again, with a BIG "Play now with the defaults" button so a host at
        7pm with a full room is never stuck behind a form. Musical bingo asks its three quick questions first (which
        music, what prize, how many rounds); its default music is the popular songs (Pub Classics).

   WHERE THINGS ARE SAVED. A game's settings: vp_venue_settings.game_prefs.<game> (migration 121, live) through the
   game Worker's /host/game-prefs, which keeps only its own list of keys; "defaults saved" writes the defaults for
   any key not already saved, never over one the venue has. Members draws: /host/members/settings makes the draw
   (manager or owner). Which games are done: setup_answers.setup = { <game>: "done" | "later" | "shown" }, and a copy
   on this device (localStorage "vpGameSetup:<venue id>"), so "never again" holds on this device even before 163.

   Everything a person reads is set with textContent; nothing anyone typed is parsed as HTML. No em dashes. */
(function (root) {
  "use strict";
  var GAME_API = "https://game.venueplay.com.au";
  var LOGO = "/logos/venueplay-primary.svg";
  var LKEY = "vpGameSetup:";
  var ORDER = ["trivia", "musical", "bingo", "raffles", "members"];
  var SETUP_STATES = { done: 1, later: 1, shown: 1 };
  var OTHER_MAX = 60;
  /* THE GAME WEEK (Dean, 6 Nov 2026): which game runs on which night, with an optional start time. Kept in
     setup_answers.week, read by the phone screens' "This week here" strip:
       "week": [ { "day": "wed", "games": [ { "game": "trivia", "start": "19:00" } ] },
                 { "day": "fri", "games": [ { "game": "musical", "start": "19:30" }, { "game": "members" } ] } ]
     day: mon..sun, in week order, each day once; game: trivia | musical | bingo | raffles | members, each once a day,
     in the house order; start: "HH:MM" 24 hour, left out when not given. At most 5 games a day. */
  var WEEK = [["mon", "Mon", "Monday"], ["tue", "Tue", "Tuesday"], ["wed", "Wed", "Wednesday"], ["thu", "Thu", "Thursday"], ["fri", "Fri", "Friday"], ["sat", "Sat", "Saturday"], ["sun", "Sun", "Sunday"]];
  var DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  var C = { ink: "#0A0A0B", ink2: "#141418", ink3: "#1C1C22", pink: "#FF1F8E", pinkSoft: "#FF8CC6", text: "#E7E7EC", muted: "#C9C9D1", faint: "#9A9AA4", line: "rgba(255,255,255,.10)", ok: "#2BD47D" };
  var HEAD = "'Hanken Grotesk',Manrope,sans-serif";
  var P = "#vpGs ";
  var CSS = [
    P + "*{box-sizing:border-box}",
    P + ".vpgs-box{max-width:560px;margin:0 auto;padding:18px 0 40px}",
    P + ".vpgs-head{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:44px;margin:0 0 18px}",
    P + ".vpgs-logo{display:block;height:24px;width:auto}",
    P + ".vpgs-step{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:0 0 10px}",
    P + ".vpgs-count{margin:0;font:800 14px " + HEAD + ";letter-spacing:.1em;text-transform:uppercase;color:" + C.pink + "}",
    P + ".vpgs-bar{display:flex;gap:6px;margin:0 0 16px}" + P + ".vpgs-bar i{flex:1;height:4px;border-radius:2px;background:rgba(255,255,255,.14)}" + P + ".vpgs-bar i.on{background:" + C.pink + "}",
    P + ".vpgs-card{background:" + C.ink2 + ";border:1px solid " + C.line + ";border-radius:18px;padding:24px 20px}",
    P + "h2.vpgs-title{margin:0 0 10px;font:800 24px/1.25 " + HEAD + ";color:#FFFFFF}",
    P + ".vpgs-lead{margin:0 0 18px;font-size:16px;line-height:1.55;color:" + C.muted + "}",
    P + ".vpgs-foot{display:flex;gap:12px;justify-content:space-between;align-items:center;margin:18px 0 0}",
    P + ".vpgs-btn{display:inline-flex;align-items:center;justify-content:center;min-height:48px;padding:12px 22px;border-radius:12px;border:none;font:700 16px/1.3 " + HEAD + ";cursor:pointer;text-align:center}",
    P + ".vpgs-btn.pink{background:" + C.pink + ";color:#FFFFFF}" + P + ".vpgs-btn.ghost{background:rgba(255,255,255,.08);color:" + C.text + "}",
    P + ".vpgs-btn.big{width:100%;min-height:56px;font-size:17px}" + P + ".vpgs-btn[disabled]{opacity:.45;cursor:default}",
    P + ".vpgs-stack{display:flex;flex-direction:column;gap:12px}",
    P + ".vpgs-close{min-height:44px;padding:10px 16px}",
    P + ".vpgs-list{list-style:none;margin:0 0 18px;padding:0}",
    P + ".vpgs-list li{display:flex;gap:14px;align-items:flex-start;padding:12px 0;border-top:1px solid " + C.line + ";font-size:16px;line-height:1.5;color:" + C.muted + "}",
    P + ".vpgs-list li:first-child{border-top:none;padding-top:0}" + P + ".vpgs-list b{color:#FFFFFF}",
    P + ".vpgs-n{flex:none;width:28px;height:28px;border-radius:50%;background:rgba(255,31,142,.16);color:" + C.pink + ";display:flex;align-items:center;justify-content:center;font:800 14px " + HEAD + "}",
    P + ".vpgs-ready{margin:0;font:800 17px " + HEAD + ";color:#FFFFFF}",
    P + ".vpgs-chips{display:grid;grid-template-columns:1fr;gap:10px}",
    P + ".vpgs-chip{display:flex;align-items:center;gap:12px;width:100%;min-height:54px;padding:12px 16px;border-radius:12px;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.04);font:700 16px " + HEAD + ";color:#FFFFFF;cursor:pointer;text-align:left}",
    P + ".vpgs-chip .bx{flex:none;width:22px;height:22px;border-radius:6px;border:2px solid rgba(255,255,255,.35);display:flex;align-items:center;justify-content:center;font-size:14px;color:#FFFFFF}",
    P + ".vpgs-chip[aria-checked=true]{border-color:" + C.pink + ";background:rgba(255,31,142,.12)}" + P + ".vpgs-chip[aria-checked=true] .bx{background:" + C.pink + ";border-color:" + C.pink + "}",
    P + ".vpgs-music{display:grid;grid-template-columns:1fr 1fr;gap:8px}" + P + ".vpgs-music .vpgs-chip{min-height:46px;padding:10px 12px;font-size:15px}",
    P + ".vpgs-in{display:block;width:100%;min-height:48px;padding:12px 14px;border-radius:10px;border:1px solid rgba(255,255,255,.18);background:" + C.ink + ";color:#FFFFFF;font:16px Manrope,system-ui,sans-serif;margin:0}",
    P + ".vpgs-in:focus{outline:2px solid " + C.pink + ";outline-offset:1px}",
    P + ".vpgs-pair{display:flex;gap:10px;align-items:center}" + P + ".vpgs-pair .vpgs-in{flex:1;min-width:0}" + P + ".vpgs-pair span{color:" + C.faint + "}",
    P + ".vpgs-plist{display:flex;flex-direction:column;gap:8px}",
    P + ".vpgs-sec{margin:22px 0 0;padding:18px 0 0;border-top:1px solid rgba(255,255,255,.18)}",
    P + ".vpgs-sec h3{margin:0 0 2px;font:800 17px " + HEAD + ";color:#FFFFFF}" + P + ".vpgs-sec .sub{margin:0 0 4px;font-size:14px;color:" + C.faint + "}",
    P + ".vpgs-row{position:relative;padding:14px 0;border-top:1px solid " + C.line + "}" + P + ".vpgs-rows>.vpgs-row:first-child{border-top:none;padding-top:0}",
    P + ".vpgs-prompt{margin:0 0 6px;font:700 15px Manrope,system-ui,sans-serif;color:" + C.pinkSoft + "}",
    P + ".vpgs-lab{position:relative;display:flex;align-items:center;gap:10px;margin:0 0 10px;font:700 16px " + HEAD + ";color:#FFFFFF}",
    P + ".vpgs-q{flex:none;width:30px;height:30px;border-radius:50%;border:1.5px solid " + C.pinkSoft + ";color:" + C.pinkSoft + ";background:transparent;font:800 15px " + HEAD + ";cursor:pointer;padding:0}",
    P + ".vpgs-q[aria-expanded=true]{background:" + C.pink + ";border-color:" + C.pink + ";color:#FFFFFF}",
    /* the "?" words: UNDER the setting on a phone (Dean, round 2), a bubble under the label on a wider screen */
    P + ".vpgs-pop{position:static;margin:0 0 12px;padding:12px 14px;border-left:3px solid " + C.pink + ";border-radius:0 10px 10px 0;background:rgba(255,31,142,.09);font:500 15px/1.5 Manrope,system-ui,sans-serif;color:#FFFFFF}",
    P + ".vpgs-pop .got{display:block;margin:6px 0 0;padding:0;border:none;background:none;font:700 15px Manrope,system-ui,sans-serif;color:" + C.pinkSoft + ";cursor:pointer;min-height:32px;text-align:left}",
    P + ".vpgs-seg{display:flex;width:100%;border:1px solid rgba(255,255,255,.18);border-radius:10px;overflow:hidden}",
    P + ".vpgs-seg button{flex:1;min-height:48px;padding:10px 12px;border:none;background:transparent;font:700 15px " + HEAD + ";color:" + C.muted + ";cursor:pointer}",
    P + ".vpgs-seg button+button{border-left:1px solid rgba(255,255,255,.18)}" + P + ".vpgs-seg button[aria-pressed=true]{background:" + C.pink + ";color:#FFFFFF}",
    P + ".vpgs-info{margin:0;padding:12px 14px;border-radius:10px;background:rgba(255,255,255,.05);font-size:15px;line-height:1.5;color:" + C.muted + "}",
    P + ".vpgs-days{display:grid;grid-template-columns:repeat(7,1fr);gap:6px}",
    P + ".vpgs-day{min-height:46px;padding:0;border-radius:10px;border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.04);font:700 15px " + HEAD + ";color:" + C.muted + ";cursor:pointer}",
    P + ".vpgs-day[aria-pressed=true]{background:" + C.pink + ";border-color:" + C.pink + ";color:#FFFFFF}",
    P + ".vpgs-times{display:grid;grid-template-columns:1fr;gap:8px;margin:10px 0 0}" + P + ".vpgs-time{display:grid;grid-template-columns:1fr 150px;gap:10px;align-items:center;font-size:15px;color:" + C.muted + "}",
    P + ".vpgs-msg{margin:12px 0 0;font-size:15px;line-height:1.5;color:" + C.pinkSoft + "}",
    P + ".vpgs-link{display:block;margin:18px 0 0;padding:0;min-height:44px;border:none;background:none;font:700 15px Manrope,system-ui,sans-serif;color:" + C.pinkSoft + ";text-decoration:underline;text-underline-offset:3px;cursor:pointer;text-align:left}",
    P + ".vpgs-tag{display:inline-block;margin:0 0 12px;padding:4px 12px;border-radius:20px;background:" + C.ok + ";color:" + C.ink + ";font:800 14px " + HEAD + ";letter-spacing:.06em;text-transform:uppercase}",
    P + ".vpgs-note{margin:0 0 16px;font-size:15px;line-height:1.5;color:" + C.faint + "}",
    "@media (min-width:600px){" + P + ".vpgs-chips{grid-template-columns:1fr 1fr}" + P + ".vpgs-music{grid-template-columns:1fr 1fr 1fr}" +
      P + ".vpgs-pop{position:absolute;z-index:5;left:0;top:40px;width:380px;margin:0;padding:14px 16px 10px;border:1px solid " + C.pink + ";border-radius:12px;background:#1E1E24;box-shadow:0 14px 40px rgba(0,0,0,.6)}}",
    "@media (min-width:760px){" + P + ".vpgs-box{max-width:700px;padding-top:28px}" + P + ".vpgs-card{padding:32px 36px}" + P + "h2.vpgs-title{font-size:28px}" +
      P + ".vpgs-row.two{display:grid;grid-template-columns:minmax(0,1fr) 300px;column-gap:24px;align-items:center}" +
      P + ".vpgs-row.two .vpgs-prompt{grid-column:1/-1}" + P + ".vpgs-row.two .vpgs-lab{margin:0}}"
  ].join("");

  function help() { return root.VPSetupHelp || null; }
  function gameOf(k) { var h = help(); return h ? h.byKey(k) : null; }
  function nameOf(k) { var g = gameOf(k); return g ? g.name : k; }
  /* "trivia, musical bingo and members draws" */
  function listWords(keys) {
    var n = keys.map(nameOf);
    if (n.length < 2) return n.join("");
    return n.slice(0, -1).join(", ") + " and " + n[n.length - 1];
  }
  function brisbaneDate(now) { return new Date((now == null ? Date.now() : now) + 10 * 3600 * 1000).toISOString().slice(0, 10); }
  /* "2026-11-13" -> "Friday" (the date's own weekday, wherever the browser is) */
  function dayOf(ymd) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || "")); if (!m) return ""; return DAYS[new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay()]; }

  /* The setup states kept: only known games with only known states, so nothing typed anywhere rides in. */
  function cleanSetup(s) {
    var out = {};
    if (!s || typeof s !== "object" || Array.isArray(s)) return out;
    ORDER.forEach(function (g) { if (SETUP_STATES[s[g]]) out[g] = s[g]; });
    return out;
  }
  function cleanWeek(w) {
    if (!Array.isArray(w)) return null;
    var byDay = {};
    w.forEach(function (d) {
      if (!d || typeof d !== "object" || !WEEK.some(function (x) { return x[0] === d.day; }) || !Array.isArray(d.games)) return;
      var have = byDay[d.day] = byDay[d.day] || {};
      d.games.forEach(function (gm) {
        if (!gm || ORDER.indexOf(gm.game) < 0 || have[gm.game]) return;
        var t = (typeof gm.start === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(gm.start)) ? gm.start : "";
        have[gm.game] = t ? { game: gm.game, start: t } : { game: gm.game };
      });
    });
    var out = [];
    WEEK.forEach(function (x) {
      var h = byDay[x[0]]; if (!h) return;
      var gs = ORDER.filter(function (g) { return h[g]; }).map(function (g) { return h[g]; }).slice(0, 5);
      if (gs.length) out.push({ day: x[0], games: gs });
    });
    return out;
  }
  /* PUB OR CLUB: the venue's own record (vp_venues.entity_type, set at sign-up or by HQ), else what they told this
     wizard once (setup_answers.venue_kind). null when nobody knows yet. */
  function kindOf(venue, answers) {
    var e = venue && venue.entity_type;
    if (e === "non_profit") return "club";
    if (e === "for_profit") return "pub";
    var k = answers && answers.venue_kind;
    return (k === "pub" || k === "club") ? k : null;
  }
  /* WHAT BINGO THIS VENUE MAY RUN (Dean, 6 Nov 2026), from the rules in vp-gaming.js, never a copy of them:
       hidden    bingo is not open to it at all (SA and NT pubs: VPGaming.numberBingoHidden)
       phones    phones may be bingo tickets in its state (VPGaming.states[state].phones.bingo)
       autoDraw  venueplay may draw the numbers (no state in the rules bars it today; a state given
                 autoDraw: false in vp-gaming.js gets caller mode only, real balls)
       why       one plain line when phone tickets are switched off (the first sentence of the state's own words)
     A venue whose pub-or-club is unknown is judged as a pub, the stricter way, as the console does. */
  function bingoRules(venue, answers) {
    var G = root.VPGaming, st = String((venue && venue.au_state) || "").toUpperCase();
    var kind = kindOf(venue, answers);
    var v2 = { au_state: st, entity_type: kind === "club" ? "non_profit" : "for_profit", number_bingo_on: venue && venue.number_bingo_on };
    var S = (G && G.states && G.states[st]) || {};
    var out = { state: st, kind: kind, hidden: !!(G && G.numberBingoHidden && G.numberBingoHidden(v2)),
      phones: !(S.phones && S.phones.bingo === false), autoDraw: S.autoDraw !== false, why: "" };
    if (!out.phones) {
      var para = String(S.paperBingo || ""), cut = para.indexOf(". ");   // no look-behind: older iPad Safari cannot parse it
      var first = cut > 0 ? para.slice(0, cut + 1) : (para || "Phones can't be bingo tickets here.");
      out.why = first + " So it's paper tickets, with our calling and our screen.";
    }
    if (out.hidden) out.why = "Bingo isn't open to a pub in " + ((G && G.NO_PUB_BINGO_STATES && G.NO_PUB_BINGO_STATES[st]) || "your state") + ", so it's switched off. Your other games are fine.";
    return out;
  }
  /* THIS WEEK'S MUSIC (Dean, 6 Nov 2026): with more than one list, a different one each week, Brisbane weeks from
     Monday, so the same songs are not played every week. */
  function weekPick(list, now) {
    if (!Array.isArray(list) || !list.length) return "";
    var t = (now == null ? Date.now() : now) + 10 * 3600 * 1000;
    var wk = Math.floor((t - Date.UTC(2024, 0, 1)) / (7 * 86400000));   // 1 Jan 2024 was a Monday
    return list[((wk % list.length) + list.length) % list.length];
  }
  /* "Wed: Trivia 7pm · Fri: Musical bingo 7:30pm, Members draws" */
  function weekWords(w) {
    return (cleanWeek(w) || []).map(function (d) {
      var day = WEEK.filter(function (x) { return x[0] === d.day; })[0][1];
      return day + ": " + d.games.map(function (gm) { var g = gameOf(gm.game); return (g ? g.title : gm.game) + (gm.start ? " " + timeWords(gm.start) : ""); }).join(", ");
    }).join(" \u00b7 ");
  }
  /* "19:30" -> "7:30pm" */
  function timeWords(t) { var m = /^(\d\d):(\d\d)$/.exec(t || ""); if (!m) return ""; var h = +m[1], ap = h >= 12 ? "pm" : "am"; h = h % 12 || 12; return h + (m[2] === "00" ? "" : ":" + m[2]) + ap; }
  function cleanOther(t) { return typeof t === "string" ? t.replace(/[\u0000-\u001f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, OTHER_MAX) : ""; }
  /* The keys this file adds to setup_answers, cleaned. vp-firstrun.js keeps them through its own cleanAnswers. */
  function cleanExtra(a, out) {
    out = out || {};
    if (a && typeof a.games_at === "string" && /^\d{4}-\d{2}-\d{2}$/.test(a.games_at)) out.games_at = a.games_at;
    var s = cleanSetup(a && a.setup);
    if (Object.keys(s).length) out.setup = s;
    var o = cleanOther(a && a.other);
    if (o) out.other = o;
    if (a && (a.venue_kind === "pub" || a.venue_kind === "club")) out.venue_kind = a.venue_kind;
    var w = cleanWeek(a && a.week);
    if (w && w.length) out.week = w;
    return out;
  }
  function readLocal(storage, vid) { try { var s = JSON.parse(storage.getItem(LKEY + vid) || "{}"); return (s && typeof s === "object") ? s : {}; } catch (e) { return {}; } }
  function writeLocal(storage, vid, s) { try { storage.setItem(LKEY + vid, JSON.stringify(s)); } catch (e) {} }
  /* What this venue's games are at: the venue's saved states, then this device's (a "shown" or "done" here wins, so
     the first-open setup is never shown twice on one device even when the venue's save was refused). */
  function setupFor(settings, storage, vid) {
    var saved = cleanSetup(settings && settings.setup_answers && settings.setup_answers.setup);
    var local = cleanSetup(readLocal(storage, vid).setup);
    Object.keys(local).forEach(function (g) {
      if (!saved[g] || local[g] === "shown" || local[g] === "done") saved[g] = local[g];
    });
    return saved;
  }

  // ---------------------------------------------------------------- talking to the game Worker
  function tokenOf(deps) {
    if (typeof deps.token === "function") return Promise.resolve(deps.token());
    var c = deps.client || (deps.VP && deps.VP.getClient && deps.VP.getClient());
    if (!c || !c.auth) return Promise.resolve("");
    return Promise.resolve(c.auth.getSession()).then(function (r) { return (r && r.data && r.data.session && r.data.session.access_token) || ""; }, function () { return ""; });
  }
  function gameApi(deps, method, path, body) {
    var f = deps.fetch || (root.fetch && root.fetch.bind(root));
    var base = deps.gameApi || GAME_API;
    return tokenOf(deps).then(function (tok) {
      var o = { method: method, headers: { "Authorization": "Bearer " + tok } };
      if (body) { o.headers["Content-Type"] = "application/json"; o.body = JSON.stringify(body); }
      return f(base + path, o).then(function (res) {
        return Promise.resolve(res.json ? res.json() : null).catch(function () { return null; }).then(function (j) { return { ok: !!res.ok, status: res.status, json: j }; });
      });
    }).catch(function () { return { ok: false, status: 0, json: null }; });
  }
  /* SAVE A GAME'S SETTINGS. onlyMissing: the defaults for the keys the venue has not saved yet ("Your default
     settings have been saved"), never over a value the venue chose. */
  function savePrefs(deps, vid, gkey, prefs, onlyMissing) {
    var g = gameOf(gkey);
    if (!g || g.needsDetails) return Promise.resolve(false);
    var send = function (p) {
      if (!Object.keys(p).length) return Promise.resolve(true);
      return gameApi(deps, "POST", "/host/game-prefs", { venue_id: vid, game: g.prefs, prefs: p }).then(function (r) { return r.ok; });
    };
    if (!onlyMissing) return send(prefs);
    return gameApi(deps, "GET", "/host/game-prefs?venue_id=" + encodeURIComponent(vid) + "&game=" + encodeURIComponent(g.prefs)).then(function (r) {
      if (!r.ok) return false;   // could not read what the venue has: write nothing rather than risk writing over it
      var have = (r.json && r.json.prefs) || {}, out = {};
      Object.keys(prefs).forEach(function (k) { if (!Object.prototype.hasOwnProperty.call(have, k)) out[k] = prefs[k]; });
      return send(out);
    });
  }
  function saveMembers(deps, vid, vals) {
    var body = { venue_id: vid };
    Object.keys(vals).forEach(function (k) { if (vals[k] !== "" && vals[k] != null) body[k] = vals[k]; });
    if (!body.name) return Promise.resolve({ ok: false, error: "Give the draw a name first." });
    return gameApi(deps, "POST", "/host/members/settings", body).then(function (r) {
      if (r.ok) return { ok: true };
      return { ok: false, error: (r.json && r.json.error) || "We could not save the draw just now. Try again, or set it up in the members draw console." };
    });
  }

  // ---------------------------------------------------------------- the frame: the venueplay logo, the step, one card
  function frame(doc, deps) {
    var old = doc.getElementById("vpGs"); if (old && old.parentNode) old.parentNode.removeChild(old);
    function el(tag, cls, text) { var e = doc.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
    var shell = el("div"); shell.id = "vpGs";
    shell.setAttribute("style", "position:fixed;top:0;left:0;right:0;bottom:0;z-index:9100;overflow-y:auto;background:" + (deps.over ? "rgba(10,10,11,.95)" : C.ink) + ";font-family:Manrope,system-ui,sans-serif;color:" + C.text + ";padding:0 16px");
    shell.setAttribute("role", "dialog"); shell.setAttribute("aria-modal", "true"); shell.setAttribute("aria-label", "Set up your games");
    var st = el("style", null, CSS); shell.appendChild(st);
    var box = el("div", "vpgs-box"); shell.appendChild(box);
    var head = el("div", "vpgs-head");
    var logo = el("img", "vpgs-logo"); logo.id = "vpGsLogo"; logo.setAttribute("src", deps.logo || LOGO); logo.setAttribute("alt", "venueplay");
    var x = el("button", "vpgs-btn ghost vpgs-close", "Close"); x.id = "vpGsClose"; x.setAttribute("type", "button"); x.setAttribute("aria-label", "Close the games setup");
    head.appendChild(logo); head.appendChild(x); box.appendChild(head);
    var stepRow = el("div", "vpgs-step"); var count = el("p", "vpgs-count"); count.id = "vpGsCount"; stepRow.appendChild(count); box.appendChild(stepRow);
    var bar = el("div", "vpgs-bar"); bar.id = "vpGsBar"; bar.setAttribute("aria-hidden", "true"); box.appendChild(bar);
    var card = el("div", "vpgs-card");
    var title = el("h2", "vpgs-title"); title.id = "vpGsTitle";
    var body = el("div"); body.id = "vpGsBody";
    card.appendChild(title); card.appendChild(body); box.appendChild(card);
    var foot = el("div", "vpgs-foot"); foot.id = "vpGsFoot"; box.appendChild(foot);
    doc.body.appendChild(shell);
    function clear() { while (body.firstChild) body.removeChild(body.firstChild); while (foot.firstChild) foot.removeChild(foot.firstChild); if (shell.scrollTop) shell.scrollTop = 0; }
    function btn(label, kind, id, onClick) { var b = el("button", "vpgs-btn " + kind, label); b.setAttribute("type", "button"); if (id) b.id = id; b.addEventListener("click", onClick); return b; }
    function close() { if (shell.parentNode) shell.parentNode.removeChild(shell); }
    /* the step line: words, and a bar of n parts with the first `on` lit */
    function step(words, n, on) {
      count.textContent = words || "";
      while (bar.firstChild) bar.removeChild(bar.firstChild);
      for (var i = 0; i < (n || 0); i++) { var s = el("i", i < on ? "on" : ""); bar.appendChild(s); }
    }
    return { el: el, shell: shell, count: count, title: title, body: body, foot: foot, x: x, clear: clear, btn: btn, close: close, step: step };
  }

  /* ONE SETTING: its short question (advanced), its label and "?", its control. Returns { row, get, s, set, value }. */
  function settingRow(F, s, ctx, all) {
    var el = F.el;
    var wide = s.kind === "seg" || s.kind === "number" || s.kind === "select" || s.kind === "money" || s.kind === "sets";
    var row = el("div", "vpgs-row" + (wide ? " two" : "")); row.setAttribute("data-key", s.key);
    if (s.advanced && s.prompt) row.appendChild(el("p", "vpgs-prompt", s.prompt));
    var lab = el("div", "vpgs-lab");
    lab.appendChild(el("span", null, s.label));
    var q = el("button", "vpgs-q", "?"); q.setAttribute("type", "button");
    q.setAttribute("aria-label", "What does " + s.label + " mean?"); q.setAttribute("aria-expanded", "false");
    var popId = "vpGsHelp_" + s.key; q.setAttribute("aria-controls", popId); q.id = "vpGsQ_" + s.key;
    lab.appendChild(q);
    var pop = el("div", "vpgs-pop"); pop.id = popId; pop.setAttribute("role", "note"); pop.style.display = "none";
    pop.appendChild(el("span", null, s.help));
    var got = el("button", "got", "Got it"); got.setAttribute("type", "button"); pop.appendChild(got);
    function show(on) { pop.style.display = on ? "block" : "none"; q.setAttribute("aria-expanded", on ? "true" : "false"); }
    q.addEventListener("click", function () { var opening = pop.style.display === "none"; ctx.pops.forEach(function (p) { p(false); }); show(opening); });
    got.addEventListener("click", function () { show(false); if (q.focus) q.focus(); });
    ctx.pops.push(show);
    var left = el("div"); left.appendChild(lab); left.appendChild(pop); row.appendChild(left);
    var wrap = el("div"), get = function () { return undefined; }, cur = s.def, onChange = [];
    function changed() { onChange.forEach(function (f) { f(); }); if (ctx.refresh) ctx.refresh(); }
    if (s.kind === "seg") {
      var seg = el("div", "vpgs-seg"); seg.setAttribute("role", "group"); seg.setAttribute("aria-label", s.label);
      s.options.forEach(function (o) {
        var b = el("button", null, o[1]); b.setAttribute("type", "button"); b.setAttribute("aria-pressed", o[0] === cur ? "true" : "false");
        b.setAttribute("data-value", String(o[0]));
        b.addEventListener("click", function () { cur = o[0]; Array.prototype.forEach.call(seg.children, function (c, i) { c.setAttribute("aria-pressed", s.options[i][0] === cur ? "true" : "false"); }); changed(); });
        seg.appendChild(b);
      });
      wrap.appendChild(seg); get = function () { return cur; };
    } else if (s.kind === "select" || s.kind === "sets") {
      var sel = el("select", "vpgs-in"); sel.id = "vpGsIn_" + s.key; sel.setAttribute("aria-label", s.label);
      var opts = s.options || [["", "The set you played last"]];
      opts.forEach(function (o) { var op = el("option", null, o[1]); op.value = String(o[0]); if (o[0] === s.def) op.selected = true; sel.appendChild(op); });
      if (s.kind === "sets") loadSets(sel, ctx);
      sel.addEventListener("change", changed);
      wrap.appendChild(sel);
      get = function () {
        var v = sel.value;
        if (s.kind === "sets") return v ? v : undefined;
        var hit = (s.options || []).filter(function (o) { return String(o[0]) === v; })[0];
        return hit ? hit[0] : undefined;
      };
    } else if (s.kind === "playlists") {
      /* Pick one or many kinds of music (Dean, round 2). The first picked is the console's playlist. */
      var grid = el("div", "vpgs-music"); grid.id = "vpGsIn_playlists"; grid.setAttribute("role", "group"); grid.setAttribute("aria-label", s.label);
      var picked = (s.def || []).slice();
      wrap.appendChild(grid);
      loadPlaylists(ctx, function (list) {
        while (grid.firstChild) grid.removeChild(grid.firstChild);
        list.forEach(function (p) {
          var b = el("button", "vpgs-chip"); b.setAttribute("type", "button"); b.setAttribute("role", "checkbox"); b.setAttribute("data-id", p.id);
          b.appendChild(el("span", "bx", picked.indexOf(p.id) >= 0 ? "✓" : "")); b.appendChild(el("span", null, p.name));
          b.setAttribute("aria-checked", picked.indexOf(p.id) >= 0 ? "true" : "false");
          b.addEventListener("click", function () {
            var i = picked.indexOf(p.id); if (i >= 0) picked.splice(i, 1); else picked.push(p.id);
            b.setAttribute("aria-checked", i >= 0 ? "false" : "true"); b.firstChild.textContent = i >= 0 ? "" : "✓"; changed();
          });
          grid.appendChild(b);
        });
      });
      get = function () { return picked.length ? picked.slice() : undefined; };
    } else if (s.kind === "prizelist") {
      /* One prize box, or one per round or prize, from the two settings that decide (countFrom, sameFrom). */
      var plist = el("div", "vpgs-plist"); plist.id = "vpGsIn_" + s.key; wrap.appendChild(plist);
      var vals = s.def ? [s.def] : [];
      var draw = function () {
        var n = parseInt(all.value(s.countFrom), 10) || 1, same = all.value(s.sameFrom) !== false;
        var want = same ? 1 : Math.max(1, Math.min(n, 12));
        Array.prototype.forEach.call(plist.children, function (inp, i) { vals[i] = inp.value; });
        while (plist.firstChild) plist.removeChild(plist.firstChild);
        for (var i = 0; i < want; i++) {
          var inp = el("input", "vpgs-in"); inp.type = "text"; inp.maxLength = s.max || 120; inp.placeholder = s.placeholder || "";
          inp.setAttribute("aria-label", want > 1 ? s.each + " " + (i + 1) : s.label); inp.id = "vpGsIn_" + s.key + "_" + i;
          inp.value = vals[i] != null ? vals[i] : (i === 0 ? (s.def || "") : "");
          plist.appendChild(inp);
        }
        lab.firstChild.textContent = want > 1 ? s.each + "s" : s.label;
      };
      ctx.redraw.push(draw);
      get = function () { var out = []; Array.prototype.forEach.call(plist.children, function (inp) { out.push(String(inp.value || "").trim()); }); return out.some(function (x) { return x; }) ? out : undefined; };
    } else if (s.kind === "range") {
      var pair = el("div", "vpgs-pair");
      var a = el("input", "vpgs-in"), b2 = el("input", "vpgs-in");
      [a, b2].forEach(function (i, k) { i.type = "number"; i.setAttribute("inputmode", "numeric"); i.value = String(s.def[k]); i.min = String(s.min); i.max = String(s.max); i.setAttribute("aria-label", s.label + (k ? " (last)" : " (first)")); i.id = "vpGsIn_" + s.keys[k]; });
      pair.appendChild(a); pair.appendChild(el("span", null, "to")); pair.appendChild(b2); wrap.appendChild(pair);
      get = function () { var x1 = parseInt(a.value, 10), x2 = parseInt(b2.value, 10); if (isNaN(x1) || isNaN(x2)) return undefined; return [Math.max(s.min, x1), Math.min(s.max, x2)]; };
    } else if (s.kind === "fixed") {
      /* a choice the venue's rules make for them, said in one plain line (bingo's paper tickets) */
      var fx = el("p", "vpgs-info", s.words || ""); fx.id = "vpGsFixed_" + s.key; wrap.appendChild(fx);
      get = function () { return s.value; };
    } else if (s.kind === "info") {
      wrap.appendChild(el("p", "vpgs-info", s.words || ""));
    } else {
      var inp1 = el("input", "vpgs-in"); inp1.id = "vpGsIn_" + s.key; inp1.setAttribute("aria-label", s.label);
      inp1.type = s.kind === "number" || s.kind === "money" ? "number" : (s.kind === "date" ? "date" : "text");
      if (s.kind === "number") { inp1.setAttribute("inputmode", "numeric"); if (s.min != null) inp1.min = String(s.min); if (s.max != null) inp1.max = String(s.max); }
      if (s.kind === "money") { inp1.setAttribute("inputmode", "decimal"); inp1.step = "0.01"; inp1.min = "0"; }
      if (s.placeholder) inp1.placeholder = s.placeholder;
      if (s.max && s.kind === "text") inp1.maxLength = s.max;
      if (s.def !== "" && s.def != null) inp1.value = s.kind === "money" ? String(s.def / 100) : String(s.def);
      inp1.addEventListener("input", changed); inp1.addEventListener("change", changed);
      /* THE FIRST DRAW DATE FILLS IN THE DRAW DAY (Dean, round 2), unless they typed a day of their own. */
      if (s.fills) onChange.push(function () { var t = all.input(s.fills), d = dayOf(inp1.value); if (t && d && (!t.value || t._auto)) { t.value = d; t._auto = true; } });
      if (s.key === "draw_day") inp1.addEventListener("input", function () { inp1._auto = false; });
      wrap.appendChild(inp1);
      get = function () {
        var v = String(inp1.value || "").trim();
        if (s.kind === "number") { if (!v) return undefined; var n = parseInt(v, 10); if (isNaN(n)) return undefined; if (s.min != null && n < s.min) n = s.min; if (s.max != null && n > s.max) n = s.max; return n; }
        if (s.kind === "money") { if (!v) return undefined; var m = Math.round(parseFloat(v) * 100); return isNaN(m) || m < 0 ? undefined : m; }
        return v ? v : undefined;
      };
    }
    row.appendChild(wrap);
    return { row: row, get: get, s: s, input: function () { return wrap.querySelector ? wrap.querySelector("input") : (wrap.children[0] && wrap.children[0].tagName === "INPUT" ? wrap.children[0] : null); } };
  }
  /* Trivia question sets: the venue's own and the venueplay library, never another venue's private night. */
  function loadSets(sel, ctx) {
    var c = ctx.deps.client || (ctx.deps.VP && ctx.deps.VP.getClient && ctx.deps.VP.getClient());
    if (!c || !c.from) return;
    try {
      Promise.resolve(c.from("vp_question_sets").select("id,title,question_count,owner_venue_id,status").eq("status", "active")).then(function (r) {
        ((r && r.data) || []).filter(function (x) { return x.owner_venue_id === ctx.venueId || !x.owner_venue_id; }).forEach(function (x) {
          var o = sel.ownerDocument.createElement("option"); o.value = x.id; o.textContent = (x.title || "Untitled set") + (x.question_count != null ? " (" + x.question_count + ")" : ""); sel.appendChild(o);
        });
      }, function () {});
    } catch (e) {}
  }
  /* Musical bingo's music, read the way its console reads it (the song library). Not readable: the popular songs. */
  function loadPlaylists(ctx, paint) {
    var fallback = [{ id: (help() && help().DEFAULT_PLAYLIST) || "pub-classics", name: "Pub Classics" }];
    paint(fallback);
    var f = ctx.deps.fetch || (root.fetch && root.fetch.bind(root));
    if (!f) return;
    Promise.resolve(f(ctx.deps.libraryUrl || "/data/musical-library.json")).then(function (r) { return r.json(); }).then(function (d) {
      var list = ((d && d.playlists) || []).filter(function (p) { return p && /^[A-Za-z0-9_-]{1,80}$/.test(p.id); }).map(function (p) { return { id: p.id, name: String(p.name || p.id) }; });
      if (list.length) paint(list);
    }).catch(function () {});
  }

  /* ONE GAME'S SCREEN, used by the first run and by firstOpen. opts: { count, n, on, back, first, quickOnly }.
     done(outcome, vals): "saved" | "later" | "defaults". */
  function gameScreen(F, gkey, cx, deps, opts, done) {
    var g = gameOf(gkey), vid = cx.venue.id, el = F.el;
    F.clear(); F.title.textContent = "Set up " + g.name;
    F.step(opts.count || (g.title + " setup"), opts.n || 1, opts.on || 1);
    var ctx = { deps: deps, venueId: vid, pops: [], redraw: [], refresh: null };
    var rows = [], byKey = {};
    var all = {
      value: function (k) { var r = byKey[k]; return r ? r.get() : undefined; },
      input: function (k) { var r = byKey[k]; return r ? r.input() : null; }
    };
    if (opts.first) { var tag = el("p", "vpgs-tag", "First time in " + g.name); tag.id = "vpGsFirstTag"; F.body.appendChild(tag); }
    var lead = g.needsDetails
      ? "Grab your members draw details. These go on the TV each draw night. Your members list is added on your Account page."
      : (opts.quickOnly ? "Three quick questions before your first game." : (opts.first ? "A quick setup before your first game, under five minutes. " : "") + "The usual settings are already filled in. Change anything you like, or tap ? to see what a setting means.");
    var lp = el("p", "vpgs-lead", lead); lp.id = "vpGsLead"; F.body.appendChild(lp);
    var list = el("div", "vpgs-rows"); F.body.appendChild(list);
    var sec = el("div", "vpgs-sec"); sec.id = "vpGsAdvanced";
    sec.appendChild(el("h3", null, "A few quick questions"));
    sec.appendChild(el("p", "sub", "Advanced settings. The usual answers suit most venues."));
    var advRows = el("div", "vpgs-rows"); sec.appendChild(advRows);
    var hasAdv = false;
    var settings = g.settings;
    /* BINGO BY STATE AND PUB OR CLUB: only the choices this venue is allowed, nothing that does not apply. */
    if (gkey === "bingo") {
      var br = bingoRules(cx.venue, opts.answers || (cx.settings && cx.settings.setup_answers));
      if (!br.phones || !br.autoDraw) settings = settings.map(function (s) {
        if (s.key === "ticket_kind" && !br.phones) return { key: "ticket_kind", label: "Paper tickets", kind: "fixed", value: "paper", words: br.why, help: s.help };
        if (s.key === "caller" && !br.autoDraw) return Object.assign({}, s, { options: [[true, "You draw real balls"]], def: true });
        return s;
      });
    }
    settings.forEach(function (s) {
      if (opts.quickOnly && !s.quick) return;
      var r = settingRow(F, s, ctx, all); rows.push(r); byKey[s.key] = r;
      if (s.advanced) { advRows.appendChild(r.row); hasAdv = true; } else list.appendChild(r.row);
    });
    if (hasAdv) F.body.appendChild(sec);
    /* SHOWN ONLY WHEN IT APPLIES (showIf), and the prize boxes follow the counts. */
    ctx.refresh = function () {
      rows.forEach(function (r) {
        var on = true, w = r.s.showIf;
        if (w) Object.keys(w).forEach(function (k) { if (all.value(k) !== w[k]) on = false; });
        r.row.style.display = on ? "" : "none"; r.hidden = !on;
      });
      /* no advanced question left to ask (bingo with paper tickets): no empty heading either */
      sec.style.display = rows.some(function (r) { return r.s.advanced && !r.hidden; }) ? "" : "none";
      ctx.redraw.forEach(function (f) { f(); });
    };
    ctx.refresh();
    var msg = el("p", "vpgs-msg"); msg.id = "vpGsMsg"; msg.setAttribute("role", "status"); F.body.appendChild(msg);
    function collect() {
      var vals = {};
      rows.forEach(function (r) {
        if (r.hidden || r.s.kind === "info") return;   // a "fixed" choice is saved, an "info" line is not
        var v = r.get(); if (v === undefined) return;
        if (r.s.kind === "range") { vals[r.s.keys[0]] = v[0]; vals[r.s.keys[1]] = v[1]; return; }
        if (r.s.kind === "playlists") { vals.playlists = v; vals.playlist = v[0]; return; }
        if (r.s.kind === "prizelist") { vals[r.s.key] = v; if (gkey === "musical") vals.prize = v[0]; return; }
        vals[r.s.key] = v;
      });
      return vals;
    }
    if (!opts.first && !g.needsDetails) {
      var later = el("button", "vpgs-link", "Not ready yet? Use the usual settings for now"); later.id = "vpGsLater"; later.setAttribute("type", "button");
      later.addEventListener("click", function () { done("later"); }); F.body.appendChild(later);
    }
    if (!opts.first && g.needsDetails) {
      var mlater = el("button", "vpgs-link", "Not ready yet? Set it up when you first open members draws"); mlater.id = "vpGsLater"; mlater.setAttribute("type", "button");
      mlater.addEventListener("click", function () { done("later"); }); F.body.appendChild(mlater);
    }
    var saveWords = opts.first ? (g.needsDetails ? "Save the draw" : "Save and play") : "Save " + g.name;
    var save = F.btn(saveWords, "pink" + (opts.first ? " big" : ""), "vpGsSave", function () {
      save.disabled = true; msg.textContent = "";
      var vals = collect();
      var p = g.needsDetails ? saveMembers(deps, vid, vals) : savePrefs(deps, vid, gkey, vals, false).then(function (ok) { return { ok: ok }; });
      return p.then(function (r) {
        if (r.ok) return done("saved", vals);
        save.disabled = false;
        msg.textContent = r.error || "We could not save that just now. Check your connection and try again.";
      });
    });
    if (opts.first) {
      /* THE BIG WAY OUT (Dean, round 2): a host at 7pm with a full room is never stuck behind a form. */
      var stack = el("div", "vpgs-stack"); stack.style.width = "100%";
      stack.appendChild(save);
      if (!g.needsDetails) {
        var play = F.btn(gkey === "musical" ? "Play now with the defaults (popular songs)" : "Play now with the defaults", "ghost big", "vpGsPlayNow", function () { done("defaults"); });
        stack.appendChild(play);
      } else {
        stack.appendChild(F.btn("Not now, take me to the console", "ghost big", "vpGsPlayNow", function () { done("later"); }));
      }
      F.foot.appendChild(stack);
    } else {
      F.foot.appendChild(opts.back ? F.btn("Back", "ghost", "vpGsBack", opts.back) : el("span"));
      F.foot.appendChild(save);
    }
    return rows;
  }

  // ---------------------------------------------------------------- the first run
  /* run(ctx, deps): the heads-up, the games question, "set them all up today?", then the games. deps.answers is the
     wizard's own answers object (vp-firstrun.js) and deps.saveAnswers() saves it, so there is ONE saving path for
     setup_answers; on its own (deps.answers missing) it reads ctx.settings.setup_answers and saves with
     VP.saveSettings. Resolves with "done" or "closed". */
  function run(cx, deps) {
    deps = deps || {};
    var doc = deps.doc || root.document, storage = deps.storage || root.localStorage, now = deps.now;
    var v = cx.venue, vid = v.id;
    var answers = deps.answers || JSON.parse(JSON.stringify((cx.settings && cx.settings.setup_answers) || {}));
    var GAMES = (deps.games || ORDER).slice();
    var F = frame(doc, deps);
    var finish, finished = new Promise(function (ok) { finish = ok; });
    function persist() {
      answers.setup = setupFor({ setup_answers: answers }, storage, vid);
      var l = readLocal(storage, vid); l.setup = answers.setup; writeLocal(storage, vid, l);
      if (typeof deps.saveAnswers === "function") return Promise.resolve(deps.saveAnswers()).catch(function () { return false; });
      var VP = deps.VP || root.VP, f = deps.saveSettings || (VP && VP.saveSettings);
      if (typeof f !== "function") return Promise.resolve(false);
      try { return Promise.resolve(f(vid, { setup_answers: answers })).then(function () { return true; }, function () { return false; }); } catch (e) { return Promise.resolve(false); }
    }
    function mark(g, state) { answers.setup = cleanSetup(answers.setup); answers.setup[g] = state; var l = readLocal(storage, vid); l.setup = cleanSetup(l.setup); l.setup[g] = state; writeLocal(storage, vid, l); }
    function ticked() { return ORDER.filter(function (g) { return (answers.games || []).indexOf(g) >= 0 && GAMES.indexOf(g) >= 0; }); }
    function left() { var s = cleanSetup(answers.setup); return ticked().filter(function (g) { return s[g] !== "done"; }); }
    function end(outcome) { F.close(); finish(outcome); }
    F.x.addEventListener("click", function () {
      if (deps.weekOnly) return end("closed");   // the Account page's game nights: closing changes nothing
      /* Closing part way: whatever is not set up keeps its defaults and opens its own setup the first time. */
      var rest = left(); rest.forEach(function (g) { mark(g, "later"); });
      Promise.all(rest.map(function (g) { return savePrefs(deps, vid, g, help().defaults(g, { bingo: bingoRules(v, answers) }), true); })).then(persist, persist);
      end("closed");
    });
    function headsUp() {
      F.clear(); F.step("Let's get you set up", 3, 1);
      F.title.textContent = "Welcome to venueplay" + (v.name ? ", " + v.name : "");
      F.body.appendChild(F.el("p", "vpgs-lead", "A quick heads-up before we start."));
      var ul = F.el("ul", "vpgs-list"); ul.id = "vpGsHeadsUp";
      var known = Array.isArray(answers.games) && answers.games.length;
      var lines = [["Each game takes less than five minutes to set up.", "time"],
        ["You don't need to do it all now. You can set up each game the first time you open it.", "later"]];
      if (!known || answers.games.indexOf("members") >= 0) lines.push(["Running members draws? Have your draw details handy: the draw name, day, time and jackpot.", "members"]);
      lines.push(["For your screen, have your advertising handy: your promo images and your logo.", "screen"]);
      lines.forEach(function (t, i) {
        var li = F.el("li"); li.setAttribute("data-line", t[1]);
        li.appendChild(F.el("span", "vpgs-n", String(i + 1))); li.appendChild(F.el("span", null, t[0])); ul.appendChild(li);
      });
      F.body.appendChild(ul);
      F.body.appendChild(F.el("p", "vpgs-ready", "Then you're ready for your week."));
      F.foot.appendChild(F.el("span")); F.foot.appendChild(F.btn("Let's go", "pink", "vpGsGo", pick));
    }
    function pick() {
      F.clear(); F.step("Your games", 3, 2); F.title.textContent = "What games do you play at your venue?";
      F.body.appendChild(F.el("p", "vpgs-lead", "Tick all you run, even the ones you only do now and then."));
      var box = F.el("div", "vpgs-chips"); box.id = "vpGsGames"; box.setAttribute("role", "group"); box.setAttribute("aria-label", "Your games");
      var cur = (answers.games || []).slice(), other = cleanOther(answers.other), otherOn = !!other;
      /* PUB OR CLUB, asked once and only when the venue's own record does not say (Dean, 6 Nov 2026). It decides which
         bingo this venue may run. Kept as setup_answers.venue_kind for HQ to confirm on the venue. */
      var kindWrap = null;
      if (!(v.entity_type === "for_profit" || v.entity_type === "non_profit")) {
        kindWrap = F.el("div", "vpgs-row two"); kindWrap.id = "vpGsKind"; kindWrap.setAttribute("style", "margin:0 0 14px;padding-top:0;border-top:none");
        kindWrap.appendChild(F.el("div", "vpgs-lab", "Are you a pub or a club?"));
        var kseg = F.el("div", "vpgs-seg"); kseg.setAttribute("role", "group"); kseg.setAttribute("aria-label", "Pub or club");
        [["pub", "A pub or hotel"], ["club", "A club"]].forEach(function (o) {
          var b = F.el("button", null, o[1]); b.setAttribute("type", "button"); b.setAttribute("data-value", o[0]); b.setAttribute("aria-pressed", answers.venue_kind === o[0] ? "true" : "false");
          b.addEventListener("click", function () { answers.venue_kind = o[0]; Array.prototype.forEach.call(kseg.children, function (c) { c.setAttribute("aria-pressed", c.getAttribute("data-value") === o[0] ? "true" : "false"); }); drawChips(); });
          kseg.appendChild(b);
        });
        kindWrap.appendChild(kseg);
      }
      var otherIn = F.el("input", "vpgs-in"); otherIn.id = "vpGsOther"; otherIn.type = "text"; otherIn.maxLength = OTHER_MAX;
      otherIn.placeholder = "e.g. karaoke, poker, a footy tipping comp"; otherIn.setAttribute("aria-label", "What else do you run?"); otherIn.value = other;
      var otherWrap = F.el("div"); otherWrap.setAttribute("style", "margin:10px 0 0"); otherWrap.appendChild(otherIn);
      var next = F.btn("Next", "pink", "vpGsNext", function () {
        var had = Array.isArray(answers.games) && answers.games.length;
        answers.games = ORDER.filter(function (g) { return cur.indexOf(g) >= 0; });
        var o = otherOn ? cleanOther(otherIn.value) : "";
        if (o) answers.other = o; else delete answers.other;
        if (!had && answers.games.length && !answers.games_at) answers.games_at = brisbaneDate(now);
        persist();
        if (!answers.games.length) return end("done");
        weekStep();
      });
      function paint() { var any = cur.length || (otherOn && cleanOther(otherIn.value)); next.disabled = !any; otherWrap.style.display = otherOn ? "" : "none"; }
      function chip(id, words, on, click) {
        var b = F.el("button", "vpgs-chip"); b.setAttribute("type", "button"); b.setAttribute("role", "checkbox"); b.setAttribute("data-game", id);
        b.appendChild(F.el("span", "bx", on ? "✓" : "")); b.appendChild(F.el("span", null, words)); b.setAttribute("aria-checked", on ? "true" : "false");
        b.addEventListener("click", function () { var now2 = click(); b.setAttribute("aria-checked", now2 ? "true" : "false"); b.firstChild.textContent = now2 ? "✓" : ""; paint(); });
        box.appendChild(b); return b;
      }
      /* Bingo where it is not open to this venue (an SA or NT pub) is not offered, the way its console hides the tile. */
      var bnote = F.el("p", "vpgs-note"); bnote.id = "vpGsBingoNote";
      function drawChips() {
        while (box.firstChild) box.removeChild(box.firstChild);
        var br = bingoRules(v, answers);
        if (br.hidden) { var bi = cur.indexOf("bingo"); if (bi >= 0) cur.splice(bi, 1); }
        GAMES.forEach(function (g) {
          if (g === "bingo" && br.hidden) return;
          chip(g, gameOf(g).title, cur.indexOf(g) >= 0, function () { var i = cur.indexOf(g); if (i >= 0) cur.splice(i, 1); else cur.push(g); return i < 0; });
        });
        chip("other", "Something else", otherOn, function () { otherOn = !otherOn; return otherOn; });
        bnote.textContent = br.hidden ? br.why : ""; bnote.style.display = br.hidden ? "" : "none";
        paint();
      }
      otherIn.addEventListener("input", paint);
      if (kindWrap) F.body.appendChild(kindWrap);
      F.body.appendChild(box); F.body.appendChild(otherWrap); F.body.appendChild(bnote); drawChips();
      F.foot.appendChild(F.btn("Back", "ghost", "vpGsBack", headsUp)); F.foot.appendChild(next);
    }
    /* WHICH GAME RUNS ON WHICH NIGHT (Dean, 6 Nov 2026), right after the games question, skippable: for each game they
       ticked, the nights it runs, and an optional start time for each. Saved as setup_answers.week (see WEEK above),
       and the nights as setup_answers.nights, the shape the Account page card already reads. */
    function weekStep() {
      F.clear(); F.step("Your games", 3, 2); F.title.textContent = "Which nights do you run them?";
      F.body.appendChild(F.el("p", "vpgs-lead", "Tap the nights for each game. A start time is optional. Players see this on their phones, so they know when to come in."));
      var cur = {};   // game -> { day: "HH:MM" or "" }
      (cleanWeek(answers.week) || []).forEach(function (d) { d.games.forEach(function (gm) { (cur[gm.game] = cur[gm.game] || {})[d.day] = gm.start || ""; }); });
      var wrap = F.el("div"); wrap.id = "vpGsWeek";
      ticked().forEach(function (g) {
        var blk = F.el("div", "vpgs-row"); blk.setAttribute("data-game", g);
        blk.appendChild(F.el("div", "vpgs-lab", gameOf(g).title));
        var days = F.el("div", "vpgs-days"); days.setAttribute("role", "group"); days.setAttribute("aria-label", gameOf(g).title + " nights");
        var times = F.el("div", "vpgs-times");
        function paint() {
          while (times.firstChild) times.removeChild(times.firstChild);
          WEEK.forEach(function (x) {
            if (!cur[g] || cur[g][x[0]] === undefined) return;
            var r = F.el("label", "vpgs-time");
            r.appendChild(F.el("span", null, x[2] + " start time (optional)"));
            var t = F.el("input", "vpgs-in"); t.type = "time"; t.id = "vpGsTime_" + g + "_" + x[0]; t.value = cur[g][x[0]] || "";
            t.addEventListener("input", function () { cur[g][x[0]] = /^\d\d:\d\d$/.test(t.value) ? t.value : ""; });
            t.addEventListener("change", function () { cur[g][x[0]] = /^\d\d:\d\d$/.test(t.value) ? t.value : ""; });
            r.appendChild(t); times.appendChild(r);
          });
        }
        WEEK.forEach(function (x) {
          var on = !!(cur[g] && cur[g][x[0]] !== undefined);
          var b = F.el("button", "vpgs-day", x[1]); b.setAttribute("type", "button"); b.setAttribute("aria-pressed", on ? "true" : "false");
          b.setAttribute("data-day", x[0]); b.setAttribute("aria-label", gameOf(g).title + " on " + x[2]);
          b.addEventListener("click", function () {
            cur[g] = cur[g] || {};
            if (cur[g][x[0]] !== undefined) delete cur[g][x[0]]; else cur[g][x[0]] = "";
            b.setAttribute("aria-pressed", cur[g][x[0]] !== undefined ? "true" : "false"); paint();
          });
          days.appendChild(b);
        });
        blk.appendChild(days); blk.appendChild(times); wrap.appendChild(blk); paint();
      });
      F.body.appendChild(wrap);
      var skip = F.el("button", "vpgs-link", "Skip for now, I'll add these later"); skip.id = "vpGsWeekSkip"; skip.setAttribute("type", "button");
      skip.addEventListener("click", function () { if (deps.weekOnly) return end("closed"); allToday(); }); F.body.appendChild(skip);
      if (deps.weekOnly) { skip.textContent = "Cancel"; F.step("Your game nights", 0, 0); F.foot.appendChild(F.el("span")); }
      else F.foot.appendChild(F.btn("Back", "ghost", "vpGsBack", pick));
      F.foot.appendChild(F.btn(deps.weekOnly ? "Save" : "Next", "pink", "vpGsWeekNext", function () {
        var w = [];
        WEEK.forEach(function (x) {
          var gs = [];
          ORDER.forEach(function (g) { if (cur[g] && cur[g][x[0]] !== undefined) gs.push(cur[g][x[0]] ? { game: g, start: cur[g][x[0]] } : { game: g }); });
          if (gs.length) w.push({ day: x[0], games: gs });
        });
        w = cleanWeek(w);
        if (w.length) { answers.week = w; answers.nights = w.map(function (d) { return d.day; }); } else delete answers.week;
        if (deps.weekOnly) return Promise.resolve(persist()).then(function () { end("done"); });
        persist(); allToday();
      }));
    }
    function allToday() {
      F.clear(); F.step("Your games", 3, 3); F.title.textContent = "Would you like to set them all up today?";
      if (!ticked().length) return end("done");
      F.body.appendChild(F.el("p", "vpgs-lead", "You picked " + listWords(ticked()) + ". We'll go through them one at a time, each in under five minutes."));
      var stack = F.el("div", "vpgs-stack");
      stack.appendChild(F.btn("Yes, set them all up", "pink big", "vpGsAllYes", function () { oneGame(left()[0]); }));
      stack.appendChild(F.btn("Not today", "ghost big", "vpGsAllNo", function () { noWorries(left()); }));
      F.body.appendChild(stack);
      var nt = F.el("p", "vpgs-note", "Not today is fine: each game keeps the usual settings, and walks you through its setup the first time you open it.");
      nt.setAttribute("style", "margin:16px 0 0"); F.body.appendChild(nt);
      F.foot.appendChild(F.btn("Back", "ghost", "vpGsBack", weekStep)); F.foot.appendChild(F.el("span"));
    }
    function oneGame(g) {
      var all = ticked(), i = all.indexOf(g);
      gameScreen(F, g, cx, deps, { count: "Game " + (i + 1) + " of " + all.length, n: all.length, on: i + 1, back: allToday }, function (outcome) {
        if (outcome === "saved") { mark(g, "done"); persist(); afterGame(g); return; }
        mark(g, "later");
        return savePrefs(deps, vid, g, help().defaults(g, { bingo: bingoRules(v, answers) }), true).then(function () { persist(); afterGame(g); });
      });
    }
    /* "Do you want to set up your next game?" ONLY here, between games of this first run (Dean, 6 Nov 2026). */
    function afterGame(g) {
      var rest = left().filter(function (x) { return cleanSetup(answers.setup)[x] !== "later"; });
      if (!rest.length) return allDone();
      var all = ticked();
      F.clear(); F.step("Game " + (all.indexOf(g) + 1) + " of " + all.length, all.length, all.indexOf(g) + 1);
      F.title.textContent = "Do you want to set up your next game?";
      F.body.appendChild(F.el("p", "vpgs-lead", "You still have " + listWords(rest) + "."));
      var stack = F.el("div", "vpgs-stack");
      stack.appendChild(F.btn("Yes", "pink big", "vpGsNextYes", function () { whichNext(rest); }));
      stack.appendChild(F.btn("No, that's enough for today", "ghost big", "vpGsNextNo", function () { noWorries(rest); }));
      F.body.appendChild(stack);
    }
    function whichNext(rest) {
      F.clear(); F.title.textContent = "What would you like to set up next?";
      var stack = F.el("div", "vpgs-stack"); stack.id = "vpGsWhich";
      rest.forEach(function (g) { var b = F.btn(gameOf(g).title, "pink big", null, function () { oneGame(g); }); b.setAttribute("data-game", g); stack.appendChild(b); });
      F.body.appendChild(stack);
    }
    /* "No worries." The defaults are written for each game left (never over a saved value). Members draws have no
       defaults, so they get their own line rather than being called saved (Dean, round 2). */
    function noWorries(rest) {
      rest.forEach(function (g) { mark(g, "later"); });
      var withDefaults = rest.filter(function (g) { return !gameOf(g).needsDetails; });
      Promise.all(withDefaults.map(function (g) { return savePrefs(deps, vid, g, help().defaults(g, { bingo: bingoRules(v, answers) }), true); })).then(persist, persist);
      F.clear(); F.step("All done for today", 0, 0); F.title.textContent = "No worries.";
      var line = "We'll remind you when you open each of those games.";
      if (withDefaults.length) line += " Your default settings have been saved for " + listWords(withDefaults) + ".";
      var p = F.el("p", "vpgs-lead", line); p.id = "vpGsNoWorries"; F.body.appendChild(p);
      if (rest.indexOf("members") >= 0) { var m = F.el("p", "vpgs-note", "Members draws still need your draw details (the draw name, day and jackpot), so we'll ask for those when you open it."); m.id = "vpGsMembersNote"; F.body.appendChild(m); }
      F.foot.appendChild(F.el("span")); F.foot.appendChild(F.btn("Go to my console", "pink", "vpGsDone", function () { end("done"); }));
    }
    function allDone() {
      F.clear(); F.step("All set", 0, 0); F.title.textContent = "You're ready for your week.";
      F.body.appendChild(F.el("p", "vpgs-lead", "Every game you play is set up. You can change any setting in that game's console."));
      F.foot.appendChild(F.el("span")); F.foot.appendChild(F.btn("Go to my console", "pink", "vpGsDone", function () { end("done"); }));
    }
    /* The Account page's "Set your game nights" opens just the week (deps.weekOnly, start "week"). */
    if (deps.start === "week") weekStep(); else if (deps.start === "pick") pick(); else headsUp();
    return finished;
  }

  // ---------------------------------------------------------------- the first time a skipped game is opened
  /* firstOpen(game, deps): on a game's console, once that console has the venue. Opens that game's own setup if the
     venue left it "later" in the first run, ONCE (marked "shown" before it is drawn, here and for the venue), and
     only for an owner or manager: a host is never stopped by it. Musical bingo asks only its three quick questions.
     Resolves with "saved", "defaults", "later" or "none". deps.onSaved() lets the console take the new settings. */
  function firstOpen(gkey, deps) {
    deps = deps || {};
    var VP = deps.VP || root.VP, doc = deps.doc || root.document, storage = deps.storage || root.localStorage;
    var cx = deps.ctx || (VP && VP.getContext && VP.getContext());
    if (!cx || !cx.venue || !cx.venue.id || !gameOf(gkey)) return Promise.resolve("none");
    if (cx.role !== "owner" && cx.role !== "manager") return Promise.resolve("none");
    var vid = cx.venue.id, setup = setupFor(cx.settings, storage, vid);
    if (setup[gkey] !== "later") return Promise.resolve("none");
    var l = readLocal(storage, vid); l.setup = cleanSetup(l.setup); l.setup[gkey] = "shown"; writeLocal(storage, vid, l);
    var sa = JSON.parse(JSON.stringify((cx.settings && cx.settings.setup_answers) || {}));
    sa.setup = cleanSetup(sa.setup); sa.setup[gkey] = "shown";
    var f = deps.saveSettings || (VP && VP.saveSettings);
    function saveSa() { if (typeof f === "function") { try { Promise.resolve(f(vid, { setup_answers: sa })).catch(function () {}); } catch (e) {} } }
    saveSa();
    var F = frame(doc, Object.assign({}, deps, { over: true }));
    return new Promise(function (ok) {
      function out(o) { F.close(); ok(o); }
      F.x.addEventListener("click", function () { out("later"); });
      gameScreen(F, gkey, cx, deps, { first: true, quickOnly: gkey === "musical" }, function (o) {
        if (o === "saved") {
          l = readLocal(storage, vid); l.setup = cleanSetup(l.setup); l.setup[gkey] = "done"; writeLocal(storage, vid, l);
          sa.setup[gkey] = "done"; saveSa();
          out("saved"); if (typeof deps.onSaved === "function") deps.onSaved();
          return;
        }
        if (o === "defaults") {
          /* PLAY NOW: the defaults for anything not saved yet (musical bingo: the popular songs), then the console. */
          return savePrefs(deps, vid, gkey, help().defaults(gkey, { bingo: bingoRules(cx.venue, cx.settings && cx.settings.setup_answers) }), true).then(function (saved) {
            out("defaults"); if (saved && typeof deps.onSaved === "function") deps.onSaved();
          });
        }
        out("later");
      });
    });
  }

  root.VPGameSetup = { bingoRules: bingoRules, kindOf: kindOf, weekPick: weekPick, cleanWeek: cleanWeek, timeWords: timeWords, weekWords: weekWords, WEEK: WEEK, run: run, firstOpen: firstOpen, cleanExtra: cleanExtra, cleanSetup: cleanSetup, cleanOther: cleanOther, setupFor: setupFor,
    savePrefs: savePrefs, listWords: listWords, brisbaneDate: brisbaneDate, dayOf: dayOf, ORDER: ORDER, LKEY: LKEY, GAME_API: GAME_API, OTHER_MAX: OTHER_MAX };
})(typeof window !== "undefined" ? window : this);
