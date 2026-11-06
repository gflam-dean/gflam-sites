/* THE SETUP WIZARD'S GAMES (Dean, 6 Nov 2026, INBOX 104, with his four clarifications the same day).

   After the try-it demo a new venue lands on its console and the setup wizard opens. This file is the games part:

     1. A heads-up: each game takes less than five minutes; have your members draw details handy (only while they
        may run members draws); have your advertising handy (promo images, logo) for the screen step; then you're
        ready for your week.
     2. "What games do you play at your venue?" Ticks: trivia, musical bingo, bingo, raffles, members draws (jag the
        joker joins when it is live). STORED for the venue in vp_venue_settings.setup_answers (migration 163, the same
        jsonb the wizard already uses: "games", plus "games_at", the Brisbane date it was first answered) for Dean's
        monthly email and planning. Before 163 is run it stays on this device and nothing breaks.
     3. "Would you like to set them all up today?" Yes: each ticked game, ONE AT A TIME (members draws included),
        every real setting of that game with today's default filled in, the advanced ones as short questions, and a
        "?" beside every setting (words from vp-setup-help.js, the ONE shared list). Not today: the defaults are kept.
     4. After each game, and ONLY inside this first run: "Do you want to set up your next game?" Yes: "What would you
        like to set up next?". No: "No worries. We'll remind you when you open each of those games. Your default
        settings have been saved for <games>."
     5. A game they skipped: the FIRST time an owner or manager opens that game's console, that game's own setup
        opens over it (firstOpen), once, and never again. Its defaults are already saved, so "Later" goes straight to
        the console and they can play.

   WHERE THINGS ARE SAVED. A game's settings: vp_venue_settings.game_prefs.<game> (migration 121, live) through the
   game Worker's /host/game-prefs, which keeps only its own list of keys; "defaults saved" writes today's defaults
   for any key not already saved, never over one the venue has. Members draws: /host/members/settings makes the draw
   (manager or owner; it has no defaults, so a skipped members draw is never called saved). Which games are done:
   setup_answers.setup = { <game>: "done" | "later" | "shown" }, and a copy on this device (localStorage
   "vpGameSetup:<venue id>"), so "never again" holds on this device even before 163 is run.

   Everything a person reads is set with textContent; nothing anyone typed is parsed as HTML. No em dashes. */
(function (root) {
  "use strict";
  var GAME_API = "https://game.venueplay.com.au";
  var LKEY = "vpGameSetup:";
  var ORDER = ["trivia", "musical", "bingo", "raffles", "members"];
  var SETUP_STATES = { done: 1, later: 1, shown: 1 };
  var C = { ink: "#0A0A0B", ink2: "#141418", pink: "#FF1F8E", pinkSoft: "#FF8CC6", text: "#E7E7EC", muted: "#C9C9D1", faint: "#8A8A94", line: "rgba(255,255,255,.12)", ok: "#2BD47D" };
  var HEAD = "'Hanken Grotesk',Manrope,sans-serif";
  var BTN = "display:inline-block;min-height:44px;padding:11px 20px;border-radius:10px;border:none;font:700 15px/1.4 " + HEAD + ";cursor:pointer;box-sizing:border-box";
  var BTN_PINK = BTN + ";background:" + C.pink + ";color:#FFFFFF";
  var BTN_GHOST = BTN + ";background:rgba(255,255,255,.08);color:" + C.text;
  var INPUT = "display:block;width:100%;box-sizing:border-box;min-height:44px;padding:11px 14px;border-radius:10px;border:1px solid rgba(255,255,255,.16);background:" + C.ink + ";color:#FFFFFF;font:inherit;font-size:16px;margin:0";
  var TEXT = "margin:0 0 14px;font-size:15px;line-height:1.55;color:" + C.muted;
  var CSS = "#vpGs .vpgs-row{position:relative;padding:12px 0;border-top:1px solid " + C.line + "}" +
    "#vpGs .vpgs-row:first-child{border-top:none}" +
    "#vpGs .vpgs-lab{position:relative;display:flex;align-items:center;gap:8px;font:700 15px " + HEAD + ";color:#FFFFFF;margin:0 0 8px}" +
    "#vpGs .vpgs-q{flex:none;width:28px;height:28px;border-radius:50%;border:1.5px solid " + C.pinkSoft + ";color:" + C.pinkSoft + ";background:transparent;font:800 14px " + HEAD + ";cursor:pointer;padding:0}" +
    "#vpGs .vpgs-q[aria-expanded=true]{background:" + C.pink + ";border-color:" + C.pink + ";color:#FFFFFF}" +
    "#vpGs .vpgs-pop{position:absolute;z-index:5;left:0;right:0;top:36px;background:#1E1E24;font-weight:500;font-family:Manrope,system-ui,sans-serif;border:1px solid " + C.pink + ";border-radius:12px;padding:14px 16px 12px;box-shadow:0 14px 40px rgba(0,0,0,.6);font-size:15px;line-height:1.5;color:#FFFFFF}" +
    "#vpGs .vpgs-seg{display:inline-flex;border:1px solid rgba(255,255,255,.16);border-radius:10px;overflow:hidden}" +
    "#vpGs .vpgs-seg button{min-width:84px;min-height:44px;padding:10px 14px;border:none;background:transparent;font:700 15px " + HEAD + ";color:" + C.muted + ";cursor:pointer}" +
    "#vpGs .vpgs-seg button[aria-pressed=true]{background:" + C.pink + ";color:#FFFFFF}" +
    "#vpGs .vpgs-prompt{font:700 15px Manrope,system-ui,sans-serif;color:" + C.pinkSoft + ";margin:0 0 6px}" +
    "#vpGs .vpgs-chip{display:flex;align-items:center;gap:12px;width:100%;min-height:52px;padding:12px 16px;margin:0 0 10px;border-radius:12px;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.04);font:700 16px " + HEAD + ";color:#FFFFFF;cursor:pointer;text-align:left}" +
    "#vpGs .vpgs-chip[aria-checked=true]{border-color:" + C.pink + ";background:rgba(255,31,142,.12)}" +
    "@media (min-width:760px){#vpGs .vpgs-box{max-width:620px!important;padding-top:44px!important}" +
      "#vpGs .vpgs-row.two{display:grid;grid-template-columns:1fr 250px;gap:6px 16px;align-items:center}#vpGs .vpgs-row.two .vpgs-lab{margin:0}" +
      "#vpGs .vpgs-row.two .vpgs-prompt{grid-column:1/-1;margin:0}#vpGs .vpgs-pop{right:auto;width:360px}}";

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

  /* The setup states kept: only known games with only known states, so nothing typed anywhere rides in. */
  function cleanSetup(s) {
    var out = {};
    if (!s || typeof s !== "object" || Array.isArray(s)) return out;
    ORDER.forEach(function (g) { if (SETUP_STATES[s[g]]) out[g] = s[g]; });
    return out;
  }
  /* The two keys this file adds to setup_answers, cleaned. vp-firstrun.js keeps them through its own cleanAnswers. */
  function cleanExtra(a, out) {
    out = out || {};
    if (a && typeof a.games_at === "string" && /^\d{4}-\d{2}-\d{2}$/.test(a.games_at)) out.games_at = a.games_at;
    var s = cleanSetup(a && a.setup);
    if (Object.keys(s).length) out.setup = s;
    return out;
  }
  function readLocal(storage, vid) { try { var s = JSON.parse(storage.getItem(LKEY + vid) || "{}"); return (s && typeof s === "object") ? s : {}; } catch (e) { return {}; } }
  function writeLocal(storage, vid, s) { try { storage.setItem(LKEY + vid, JSON.stringify(s)); } catch (e) {} }
  /* What this venue's games are at: the venue's saved states, then this device's (a "shown" here wins, so the
     first-open setup is never shown twice on one device even when the venue's save was refused). */
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
  /* SAVE A GAME'S SETTINGS. onlyMissing: today's defaults for the keys the venue has not saved yet ("Your default
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

  // ---------------------------------------------------------------- the frame (the wizard's own look)
  function frame(doc, deps) {
    var old = doc.getElementById("vpGs"); if (old && old.parentNode) old.parentNode.removeChild(old);
    function el(tag, css, text) { var e = doc.createElement(tag); if (css) e.setAttribute("style", css); if (text != null) e.textContent = text; return e; }
    var shell = el("div", "position:fixed;top:0;left:0;right:0;bottom:0;z-index:9100;overflow-y:auto;background:" + (deps.over ? "rgba(10,10,11,.82)" : C.ink) + ";font-family:Manrope,system-ui,sans-serif;color:" + C.text + ";padding:0 16px;box-sizing:border-box");
    shell.id = "vpGs"; shell.setAttribute("role", "dialog"); shell.setAttribute("aria-modal", "true"); shell.setAttribute("aria-label", "Set up your games");
    var st = el("style", null, CSS); shell.appendChild(st);
    var box = el("div", "max-width:480px;margin:0 auto;padding:28px 0 40px"); box.className = "vpgs-box"; shell.appendChild(box);
    var top = el("div", "display:flex;align-items:center;justify-content:space-between;gap:12px;margin:0 0 18px");
    var count = el("p", "margin:0;font-size:15px;letter-spacing:.1em;text-transform:uppercase;color:" + C.pink + ";font-weight:800"); count.id = "vpGsCount";
    var x = el("button", BTN_GHOST + ";min-height:40px;padding:8px 14px", "Close"); x.id = "vpGsClose"; x.setAttribute("type", "button"); x.setAttribute("aria-label", "Close the games setup");
    top.appendChild(count); top.appendChild(x); box.appendChild(top);
    var card = el("div", "background:" + C.ink2 + ";border:1px solid " + C.line + ";border-radius:16px;padding:22px 20px");
    var title = el("h2", "margin:0 0 12px;font-size:22px;font-weight:800;line-height:1.25;color:#FFFFFF;font-family:" + HEAD); title.id = "vpGsTitle";
    var body = el("div", ""); body.id = "vpGsBody";
    card.appendChild(title); card.appendChild(body); box.appendChild(card);
    var foot = el("div", "display:flex;gap:10px;justify-content:space-between;align-items:center;margin:16px 0 0"); foot.id = "vpGsFoot"; box.appendChild(foot);
    doc.body.appendChild(shell);
    function clear() { while (body.firstChild) body.removeChild(body.firstChild); while (foot.firstChild) foot.removeChild(foot.firstChild); }
    function btn(label, pink, id, onClick) { var b = el("button", pink ? BTN_PINK : BTN_GHOST, label); b.setAttribute("type", "button"); if (id) b.id = id; b.addEventListener("click", onClick); return b; }
    function close() { if (shell.parentNode) shell.parentNode.removeChild(shell); }
    return { el: el, shell: shell, count: count, title: title, body: body, foot: foot, x: x, clear: clear, btn: btn, close: close };
  }

  /* ONE SETTING: its label, its "?" (one open at a time), its control. Returns { row, get } where get() is the value
     to save (undefined: leave it to the console). */
  function settingRow(F, s, pops, venueId, deps) {
    var el = F.el, doc = F.shell.ownerDocument;
    var two = (s.kind === "seg" || s.kind === "number") ? " two" : "";
    var row = el("div", ""); row.className = "vpgs-row" + two; row.setAttribute("data-key", s.key);
    if (s.advanced && s.prompt) { var pr = el("p", null, s.prompt); pr.className = "vpgs-prompt"; row.appendChild(pr); }
    var lab = el("div", ""); lab.className = "vpgs-lab";
    var labText = el("span", null, s.label); lab.appendChild(labText);
    var q = el("button", null, "?"); q.className = "vpgs-q"; q.setAttribute("type", "button");
    q.setAttribute("aria-label", "What does " + s.label + " do?"); q.setAttribute("aria-expanded", "false");
    var popId = "vpGsHelp_" + s.key; q.setAttribute("aria-controls", popId); q.id = "vpGsQ_" + s.key;
    lab.appendChild(q); row.appendChild(lab);
    var pop = el("div", null); pop.className = "vpgs-pop"; pop.id = popId; pop.setAttribute("role", "note"); pop.style.display = "none";
    pop.appendChild(el("span", null, s.help));
    var got = el("button", "display:block;margin:8px 0 0;padding:0;border:none;background:none;font:700 15px Manrope,system-ui,sans-serif;color:" + C.pinkSoft + ";cursor:pointer", "Got it"); got.setAttribute("type", "button");
    pop.appendChild(got);
    function show(on) { pop.style.display = on ? "block" : "none"; q.setAttribute("aria-expanded", on ? "true" : "false"); }
    q.addEventListener("click", function () {
      var opening = pop.style.display === "none";
      pops.forEach(function (p) { p(false); });
      show(opening);
    });
    got.addEventListener("click", function () { show(false); q.focus && q.focus(); });
    pops.push(show);
    var wrap = el("div", ""), get = function () { return undefined; };
    if (s.kind === "seg") {
      var seg = el("div", ""); seg.className = "vpgs-seg"; seg.setAttribute("role", "group"); seg.setAttribute("aria-label", s.label);
      var cur = s.def;
      s.options.forEach(function (o) {
        var b = el("button", null, o[1]); b.setAttribute("type", "button"); b.setAttribute("aria-pressed", o[0] === cur ? "true" : "false");
        b.addEventListener("click", function () { cur = o[0]; Array.prototype.forEach.call(seg.children, function (c, i) { c.setAttribute("aria-pressed", s.options[i][0] === cur ? "true" : "false"); }); });
        seg.appendChild(b);
      });
      wrap.appendChild(seg); get = function () { return cur; };
    } else if (s.kind === "select" || s.kind === "sets" || s.kind === "playlists") {
      var sel = el("select", INPUT); sel.id = "vpGsIn_" + s.key; sel.setAttribute("aria-label", s.label);
      var opts = s.options || [["", s.kind === "sets" ? "Your last set (or the first one)" : "Pick on the night"]];
      opts.forEach(function (o) { var op = el("option", null, o[1]); op.value = String(o[0]); if (o[0] === s.def) op.selected = true; sel.appendChild(op); });
      wrap.appendChild(sel);
      if (s.kind === "sets" || s.kind === "playlists") loadChoices(s, sel, venueId, deps);
      get = function () {
        var v = sel.value;
        if (s.kind !== "select") return v ? v : undefined;
        var hit = (s.options || []).filter(function (o) { return String(o[0]) === v; })[0];
        return hit ? hit[0] : undefined;
      };
    } else if (s.kind === "range") {
      var pair = el("div", "display:flex;gap:10px;align-items:center");
      var a = el("input", INPUT), b2 = el("input", INPUT);
      [a, b2].forEach(function (i, k) { i.type = "number"; i.setAttribute("inputmode", "numeric"); i.value = String(s.def[k]); i.min = String(s.min); i.max = String(s.max); i.setAttribute("aria-label", s.label + (k ? " (last)" : " (first)")); i.id = "vpGsIn_" + s.keys[k]; });
      pair.appendChild(a); pair.appendChild(el("span", "color:" + C.faint, "to")); pair.appendChild(b2); wrap.appendChild(pair);
      get = function () { var x1 = parseInt(a.value, 10), x2 = parseInt(b2.value, 10); if (isNaN(x1) || isNaN(x2)) return undefined; return [Math.max(s.min, x1), Math.min(s.max, x2)]; };
    } else if (s.kind === "info") {
      wrap.appendChild(el("p", "margin:0;font-size:15px;line-height:1.5;color:" + C.muted, s.words || ""));
    } else {
      var inp = el("input", INPUT); inp.id = "vpGsIn_" + s.key; inp.setAttribute("aria-label", s.label);
      inp.type = s.kind === "number" || s.kind === "money" ? "number" : (s.kind === "date" ? "date" : "text");
      if (s.kind === "number") { inp.setAttribute("inputmode", "numeric"); if (s.min != null) inp.min = String(s.min); if (s.max != null) inp.max = String(s.max); }
      if (s.kind === "money") { inp.setAttribute("inputmode", "decimal"); inp.step = "0.01"; inp.min = "0"; }
      if (s.placeholder) inp.placeholder = s.placeholder;
      if (s.max && s.kind === "text") inp.maxLength = s.max;
      if (s.def !== "" && s.def != null) inp.value = s.kind === "money" ? String(s.def / 100) : String(s.def);
      wrap.appendChild(inp);
      get = function () {
        var v = String(inp.value || "").trim();
        if (s.kind === "number") { if (!v) return undefined; var n = parseInt(v, 10); if (isNaN(n)) return undefined; if (s.min != null && n < s.min) n = s.min; if (s.max != null && n > s.max) n = s.max; return n; }
        if (s.kind === "money") { if (!v) return undefined; var m = Math.round(parseFloat(v) * 100); return isNaN(m) || m < 0 ? undefined : m; }
        if (!v) return undefined;
        return s.list ? [v] : v;
      };
    }
    row.appendChild(wrap); lab.appendChild(pop);   // the "?" words hang just under their own label
    return { row: row, get: get, s: s };
  }
  /* Trivia categories (the venue's own sets and the venueplay library, never another venue's private one) and
     musical bingo playlists, read the way their consoles read them. Not readable: the console picks on the night. */
  function loadChoices(s, sel, venueId, deps) {
    function add(v, t) { var o = sel.ownerDocument.createElement("option"); o.value = v; o.textContent = t; sel.appendChild(o); }
    if (s.kind === "sets") {
      var c = deps.client || (deps.VP && deps.VP.getClient && deps.VP.getClient());
      if (!c || !c.from) return;
      try {
        Promise.resolve(c.from("vp_question_sets").select("id,title,question_count,owner_venue_id,status").eq("status", "active")).then(function (r) {
          ((r && r.data) || []).filter(function (x) { return x.owner_venue_id === venueId || !x.owner_venue_id; }).forEach(function (x) {
            add(x.id, (x.title || "Untitled set") + (x.question_count != null ? " (" + x.question_count + ")" : ""));
          });
        }, function () {});
      } catch (e) {}
      return;
    }
    var f = deps.fetch || (root.fetch && root.fetch.bind(root));
    if (!f) return;
    Promise.resolve(f(deps.libraryUrl || "/data/musical-library.json")).then(function (r) { return r.json(); }).then(function (d) {
      ((d && d.playlists) || []).forEach(function (p) { if (p && /^[A-Za-z0-9_-]{1,80}$/.test(p.id)) add(p.id, p.name || p.id); });
    }).catch(function () {});
  }

  /* ONE GAME'S SCREEN, used by the first run and by firstOpen. done(outcome): "saved" | "later". */
  function gameScreen(F, gkey, ctx, deps, opts, done) {
    var g = gameOf(gkey), vid = ctx.venue.id;
    F.clear(); F.title.textContent = "Set up " + g.name;
    F.count.textContent = opts.count || (g.title + " setup");
    var el = F.el, pops = [], rows = [];
    if (opts.first) { var tag = el("p", "display:inline-block;margin:0 0 10px;padding:3px 10px;border-radius:20px;background:" + C.ok + ";color:" + C.ink + ";font:800 12px " + HEAD + ";letter-spacing:.08em;text-transform:uppercase", "First time in " + g.name); tag.id = "vpGsFirstTag"; F.body.insertBefore(tag, F.body.firstChild); }
    F.body.appendChild(el("p", TEXT, g.needsDetails
      ? "Grab your members draw details. These go on the TV each draw night. Your members list is added on your Account page."
      : (opts.first ? "A quick setup before your first game, under five minutes. " : "") + "Today's settings are already filled in. Change anything you like, or tap the ? to see what it does."));
    var list = el("div", ""); F.body.appendChild(list);
    var adv = el("div", "margin:18px 0 0;padding:16px 0 0;border-top:1px solid rgba(255,255,255,.2)");
    adv.appendChild(el("h3", "margin:0 0 2px;font:800 17px " + HEAD + ";color:#FFFFFF", "A few quick questions"));
    adv.appendChild(el("p", "margin:0 0 6px;font-size:14px;color:" + C.faint, "Advanced settings. The defaults suit most venues."));
    g.settings.forEach(function (s) { var r = settingRow(F, s, pops, vid, deps); rows.push(r); (s.advanced ? adv : list).appendChild(r.row); });
    F.body.appendChild(adv);
    var msg = el("p", "margin:12px 0 0;font-size:15px;line-height:1.5;color:" + C.pinkSoft + ";min-height:1px"); msg.id = "vpGsMsg"; msg.setAttribute("role", "status"); F.body.appendChild(msg);
    if (!opts.first) {
      var later = el("button", "display:block;margin:14px 0 0;padding:0;border:none;background:none;font:700 15px Manrope,system-ui,sans-serif;color:" + C.pinkSoft + ";text-decoration:underline;text-underline-offset:3px;cursor:pointer", "Not ready yet? Use the defaults for now");
      later.id = "vpGsLater"; later.setAttribute("type", "button"); later.addEventListener("click", function () { done("later"); }); F.body.appendChild(later);
    }
    var save = F.btn("Save " + g.name, true, "vpGsSave", function () {
      save.disabled = true; msg.textContent = "";
      var vals = {};
      rows.forEach(function (r) {
        var v = r.get(); if (v === undefined) return;
        if (r.s.kind === "range") { vals[r.s.keys[0]] = v[0]; vals[r.s.keys[1]] = v[1]; } else if (r.s.kind !== "info") vals[r.s.key] = v;
      });
      var p = g.needsDetails ? saveMembers(deps, vid, vals) : savePrefs(deps, vid, gkey, vals, false).then(function (ok) { return { ok: ok }; });
      return p.then(function (r) {
        if (r.ok) return done("saved");
        save.disabled = false;
        msg.textContent = r.error || "We could not save that just now. Check your connection and try again.";
      });
    });
    var left = opts.first ? F.btn("Later", false, "vpGsFirstLater", function () { done("later"); })
      : (opts.back ? F.btn("Back", false, "vpGsBack", opts.back) : el("span"));
    F.foot.appendChild(left); F.foot.appendChild(save);
    return rows;
  }

  // ---------------------------------------------------------------- the first run
  /* run(ctx, deps): the heads-up, the games question, "set them all up today?", then the games. deps.answers is the
     wizard's own answers object (vp-firstrun.js) and deps.saveAnswers() saves it, so there is ONE saving path for
     setup_answers; on its own (deps.answers missing) it reads ctx.settings.setup_answers and saves with
     VP.saveSettings. Resolves with "done" or "closed". */
  function run(ctx, deps) {
    deps = deps || {};
    var doc = deps.doc || root.document, storage = deps.storage || root.localStorage, now = deps.now;
    var v = ctx.venue, vid = v.id;
    var answers = deps.answers || JSON.parse(JSON.stringify((ctx.settings && ctx.settings.setup_answers) || {}));
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
      /* Closing part way: whatever is not set up keeps today's defaults and opens its own setup the first time. */
      var rest = left(); rest.forEach(function (g) { mark(g, "later"); });
      Promise.all(rest.map(function (g) { return savePrefs(deps, vid, g, help().defaults(g), true); })).then(persist, persist);
      end("closed");
    });
    function headsUp() {
      F.clear(); F.count.textContent = "Let's get you set up";
      F.title.textContent = "Welcome to venueplay" + (v.name ? ", " + v.name : "");
      F.body.appendChild(F.el("p", TEXT, "A quick heads-up before we start:"));
      var ul = F.el("ul", "margin:0 0 14px;padding:0 0 0 20px;font-size:15px;line-height:1.55;color:" + C.muted); ul.id = "vpGsHeadsUp";
      var known = Array.isArray(answers.games) && answers.games.length;
      var lines = [["Each game takes less than five minutes to set up.", "time"]];
      if (!known || answers.games.indexOf("members") >= 0) lines.push(["Running members draws? Have your members draw details handy: the draw name, day, time and jackpot.", "members"]);
      lines.push(["For your screen, have your advertising handy: your promo images and your logo.", "screen"]);
      lines.forEach(function (t) { var li = F.el("li", "margin:0 0 8px", t[0]); li.setAttribute("data-line", t[1]); ul.appendChild(li); });
      F.body.appendChild(ul);
      F.body.appendChild(F.el("p", "margin:0;font-size:15px;line-height:1.55;color:#FFFFFF;font-weight:700", "Then you're ready for your week."));
      F.foot.appendChild(F.el("span")); F.foot.appendChild(F.btn("Let's go", true, "vpGsGo", pick));
    }
    function pick() {
      F.clear(); F.count.textContent = "Your games"; F.title.textContent = "What games do you play at your venue?";
      F.body.appendChild(F.el("p", TEXT, "Tick all you run, even the ones you only do now and then."));
      var box = F.el("div", ""); box.id = "vpGsGames"; box.setAttribute("role", "group"); box.setAttribute("aria-label", "Your games");
      var cur = (answers.games || []).slice();
      var next = F.btn("Next", true, "vpGsNext", function () {
        var had = Array.isArray(answers.games) && answers.games.length;
        answers.games = ORDER.filter(function (g) { return cur.indexOf(g) >= 0; });
        if (!had && answers.games.length && !answers.games_at) answers.games_at = brisbaneDate(now);
        persist();
        if (!answers.games.length) return end("done");
        allToday();
      });
      function paint() { next.disabled = !cur.length; next.style.opacity = cur.length ? "1" : ".45"; }
      GAMES.forEach(function (g) {
        var b = F.el("button", null, gameOf(g).title); b.className = "vpgs-chip"; b.setAttribute("type", "button"); b.setAttribute("role", "checkbox");
        b.setAttribute("data-game", g); b.setAttribute("aria-checked", cur.indexOf(g) >= 0 ? "true" : "false");
        b.addEventListener("click", function () { var i = cur.indexOf(g); if (i >= 0) cur.splice(i, 1); else cur.push(g); b.setAttribute("aria-checked", i >= 0 ? "false" : "true"); paint(); });
        box.appendChild(b);
      });
      F.body.appendChild(box); paint();
      F.foot.appendChild(F.btn("Back", false, "vpGsBack", headsUp)); F.foot.appendChild(next);
    }
    function allToday() {
      F.clear(); F.count.textContent = "Your games"; F.title.textContent = "Would you like to set them all up today?";
      F.body.appendChild(F.el("p", TEXT, "You picked " + listWords(ticked()) + ". We'll go through them one at a time, each in under five minutes."));
      var stack = F.el("div", "display:flex;flex-direction:column;gap:10px");
      var yes = F.btn("Yes, set them all up", true, "vpGsAllYes", function () { oneGame(left()[0]); });
      var no = F.btn("Not today", false, "vpGsAllNo", function () { noWorries(left()); });
      yes.style.width = no.style.width = "100%"; stack.appendChild(yes); stack.appendChild(no); F.body.appendChild(stack);
      F.body.appendChild(F.el("p", "margin:14px 0 0;font-size:14px;line-height:1.5;color:" + C.faint, "Not today: your games keep today's default settings, and each one walks you through its setup the first time you open it."));
      F.foot.appendChild(F.btn("Back", false, "vpGsBack", pick)); F.foot.appendChild(F.el("span"));
    }
    function oneGame(g) {
      var all = ticked(), i = all.indexOf(g);
      gameScreen(F, g, ctx, deps, { count: "Game " + (i + 1) + " of " + all.length, back: allToday }, function (outcome) {
        if (outcome === "saved") { mark(g, "done"); persist(); afterGame(g); return; }
        mark(g, "later");
        return savePrefs(deps, vid, g, help().defaults(g), true).then(function () { persist(); afterGame(g); });
      });
    }
    /* "Do you want to set up your next game?" ONLY here, between games of this first run (Dean, 6 Nov 2026). */
    function afterGame(g) {
      var rest = left().filter(function (x) { return cleanSetup(answers.setup)[x] !== "later"; });
      if (!rest.length) return allDone();
      F.clear(); F.count.textContent = "Game " + (ticked().indexOf(g) + 1) + " of " + ticked().length;
      F.title.textContent = "Do you want to set up your next game?";
      F.body.appendChild(F.el("p", TEXT, "You still have " + listWords(rest) + "."));
      var stack = F.el("div", "display:flex;flex-direction:column;gap:10px");
      var yes = F.btn("Yes", true, "vpGsNextYes", function () { whichNext(rest); });
      var no = F.btn("No, that's enough for today", false, "vpGsNextNo", function () { noWorries(rest); });
      yes.style.width = no.style.width = "100%"; stack.appendChild(yes); stack.appendChild(no); F.body.appendChild(stack);
    }
    function whichNext(rest) {
      F.clear(); F.title.textContent = "What would you like to set up next?";
      var stack = F.el("div", "display:flex;flex-direction:column;gap:10px"); stack.id = "vpGsWhich";
      rest.forEach(function (g) { var b = F.btn(gameOf(g).title, true, null, function () { oneGame(g); }); b.setAttribute("data-game", g); b.style.width = "100%"; b.style.textAlign = "left"; stack.appendChild(b); });
      F.body.appendChild(stack);
    }
    /* "No worries." Today's defaults are written for each game left (never over a saved value). Members draws have
       no defaults, so they are named apart rather than called saved. */
    function noWorries(rest) {
      rest.forEach(function (g) { mark(g, "later"); });
      var withDefaults = rest.filter(function (g) { return !gameOf(g).needsDetails; });
      Promise.all(withDefaults.map(function (g) { return savePrefs(deps, vid, g, help().defaults(g), true); })).then(persist, persist);
      F.clear(); F.count.textContent = "All done for today"; F.title.textContent = "No worries.";
      var line = "We'll remind you when you open each of those games.";
      if (withDefaults.length) line += " Your default settings have been saved for " + listWords(withDefaults) + ".";
      var p = F.el("p", TEXT, line); p.id = "vpGsNoWorries"; F.body.appendChild(p);
      if (rest.indexOf("members") >= 0) { var m = F.el("p", "margin:0 0 14px;font-size:14px;line-height:1.5;color:" + C.faint, "Members draws need your draw name, day and jackpot before the first draw, so we'll ask for those when you open it."); m.id = "vpGsMembersNote"; F.body.appendChild(m); }
      F.foot.appendChild(F.el("span")); F.foot.appendChild(F.btn("Go to my console", true, "vpGsDone", function () { end("done"); }));
    }
    function allDone() {
      F.clear(); F.count.textContent = "All set"; F.title.textContent = "You're ready for your week.";
      F.body.appendChild(F.el("p", TEXT, "Every game you play is set up. You can change any setting in that game's console."));
      F.foot.appendChild(F.el("span")); F.foot.appendChild(F.btn("Go to my console", true, "vpGsDone", function () { end("done"); }));
    }
    if (deps.start === "pick") pick(); else headsUp();
    return finished;
  }

  // ---------------------------------------------------------------- the first time a skipped game is opened
  /* firstOpen(game, deps): on a game's console, once that console has the venue. Opens that game's own setup if the
     venue left it "later" in the first run, ONCE (it is marked "shown" before it is drawn, here and for the venue),
     and only for an owner or manager: a host opening the console on a busy night is never stopped by it. Resolves
     with "saved", "later" or "none". deps.onSaved() lets the console take the new settings (a reload). */
  function firstOpen(gkey, deps) {
    deps = deps || {};
    var VP = deps.VP || root.VP, doc = deps.doc || root.document, storage = deps.storage || root.localStorage;
    var ctx = deps.ctx || (VP && VP.getContext && VP.getContext());
    if (!ctx || !ctx.venue || !ctx.venue.id || !gameOf(gkey)) return Promise.resolve("none");
    if (ctx.role !== "owner" && ctx.role !== "manager") return Promise.resolve("none");
    var vid = ctx.venue.id, setup = setupFor(ctx.settings, storage, vid);
    if (setup[gkey] !== "later") return Promise.resolve("none");
    var l = readLocal(storage, vid); l.setup = cleanSetup(l.setup); l.setup[gkey] = "shown"; writeLocal(storage, vid, l);
    var sa = JSON.parse(JSON.stringify((ctx.settings && ctx.settings.setup_answers) || {}));
    sa.setup = cleanSetup(sa.setup); sa.setup[gkey] = "shown";
    var f = deps.saveSettings || (VP && VP.saveSettings);
    if (typeof f === "function") { try { Promise.resolve(f(vid, { setup_answers: sa })).catch(function () {}); } catch (e) {} }
    var F = frame(doc, { over: true });
    return new Promise(function (ok) {
      function out(o) { F.close(); ok(o); }
      F.x.addEventListener("click", function () { out("later"); });
      gameScreen(F, gkey, ctx, deps, { first: true }, function (o) {
        if (o === "saved") {
          l = readLocal(storage, vid); l.setup = cleanSetup(l.setup); l.setup[gkey] = "done"; writeLocal(storage, vid, l);
          sa.setup[gkey] = "done"; if (typeof f === "function") { try { Promise.resolve(f(vid, { setup_answers: sa })).catch(function () {}); } catch (e) {} }
          out("saved"); if (typeof deps.onSaved === "function") deps.onSaved();
          return;
        }
        out("later");
      });
    });
  }

  root.VPGameSetup = { run: run, firstOpen: firstOpen, cleanExtra: cleanExtra, cleanSetup: cleanSetup, setupFor: setupFor,
    savePrefs: savePrefs, listWords: listWords, brisbaneDate: brisbaneDate, ORDER: ORDER, LKEY: LKEY, GAME_API: GAME_API };
})(typeof window !== "undefined" ? window : this);
