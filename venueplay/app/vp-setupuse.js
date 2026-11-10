/* WHAT THE CONSOLES DO WITH THE SETUP WIZARD'S ANSWERS (Dean, 6 Nov 2026, INBOX 104, follow-up for Tue 10 Nov).

   The setup wizard (vp-gamesetup.js) saves each game's choices in vp_venue_settings.game_prefs (migration 121, the
   game Worker's /host/game-prefs). The consoles read them through VP.gamePrefs as before; this file is the few
   shared pieces they use, so each answer lives in one place:

     weekPick(list)        this week's one of several (Brisbane weeks from Monday): musical bingo's popular lists take
                           turns, and trivia's picked categories take turns, so the same songs and questions are not
                           played every week
     prizeButtons(...)     the saved prizes as tap-and-go buttons under a console's prize box, like the raffle's
     round(...)            which prize round the night is up to (musical bingo: a prize per round, "no prize" rounds)

   Everything a person reads is set with textContent. No em dashes. */
(function (root) {
  "use strict";
  var NO_PRIZE = "No prize this round";
  function weekPick(list, now) {
    if (!Array.isArray(list) || !list.length) return "";
    var t = (now == null ? Date.now() : now) + 10 * 3600 * 1000;
    var wk = Math.floor((t - Date.UTC(2024, 0, 1)) / (7 * 86400000));   // 1 Jan 2024 was a Monday
    return list[((wk % list.length) + list.length) % list.length];
  }
  /* The night a moment belongs to, Brisbane time, rolling over at 6am (as the musical console's paid-entry night does). */
  function nightOf(now) { return new Date((now == null ? Date.now() : now) + 10 * 3600 * 1000 - 6 * 3600 * 1000).toISOString().slice(0, 10); }
  /* The saved prizes, each once, blanks left out. */
  function cleanList(list) {
    var out = [];
    (Array.isArray(list) ? list : []).forEach(function (x) { var t = typeof x === "string" ? x.trim() : ""; if (t && out.indexOf(t) < 0) out.push(t); });
    return out.slice(0, 12);
  }
  /* TAP AND GO (Dean, round 3): one button per saved prize under the prize box; a tap puts it in the box. */
  function prizeButtons(doc, after, list, onPick, id) {
    if (!doc || !after || !after.parentNode) return null;
    var old = id ? doc.getElementById(id) : null; if (old && old.parentNode) old.parentNode.removeChild(old);
    var items = cleanList(list);
    if (!items.length) return null;
    var row = doc.createElement("div"); if (id) row.id = id;
    row.className = "vpsu-prizes"; row.setAttribute("role", "group"); row.setAttribute("aria-label", "Your usual prizes");
    row.setAttribute("style", "display:flex;flex-wrap:wrap;gap:6px;margin:8px 0 0");
    items.forEach(function (p) {
      var b = doc.createElement("button"); b.type = "button"; b.textContent = p; b.setAttribute("data-prize", p);
      b.setAttribute("style", "min-height:40px;padding:8px 12px;border-radius:999px;border:1px solid rgba(255,31,142,.55);background:rgba(255,31,142,.10);color:#FFFFFF;font:700 14px 'Hanken Grotesk',Manrope,sans-serif;cursor:pointer");
      b.addEventListener("click", function () { if (typeof onPick === "function") onPick(p); });
      row.appendChild(b);
    });
    after.parentNode.insertBefore(row, after.nextSibling);
    return row;
  }
  /* MUSICAL BINGO'S PRIZE ROUNDS. prefs: { rounds, prize_same, prizes, prize_none, prize }. A round is each prize won in
     a night (a new pattern on the same cards, or a new game). Kept per venue per night on this device. */
  function roundKey(venueId, game, now) { return "vpRound:" + venueId + ":" + game + ":" + nightOf(now); }
  function round(storage, venueId, game, now) {
    var n = 0; try { n = parseInt(storage.getItem(roundKey(venueId, game, now)), 10) || 0; } catch (e) {}
    return {
      index: n,
      next: function () { try { storage.setItem(roundKey(venueId, game, now), String(n + 1)); } catch (e) {} n += 1; return n; }
    };
  }
  /* The prize for round i (0 first): { prize, none, number, of } or null when the venue saved no rounds. */
  function roundPrize(p, i) {
    if (!p || typeof p !== "object") return null;
    var rounds = parseInt(p.rounds, 10) || 0, list = Array.isArray(p.prizes) ? p.prizes : [];
    if (!rounds && !list.length) return null;
    var none = Array.isArray(p.prize_none) ? p.prize_none : [];
    var k = p.prize_same === true ? 0 : i;
    var text = typeof list[k] === "string" ? list[k].trim() : "";
    if (p.prize_same === true && !text && typeof p.prize === "string") text = p.prize.trim();
    var isNone = p.prize_same !== true && none.indexOf(i + 1) >= 0;
    if (i >= Math.max(rounds, 1) && p.prize_same !== true) return { prize: "", none: false, number: i + 1, of: rounds, past: true };
    return { prize: isNone ? NO_PRIZE : text, none: isNone, number: i + 1, of: rounds || list.length };
  }
  root.VPSetupUse = { weekPick: weekPick, nightOf: nightOf, cleanList: cleanList, prizeButtons: prizeButtons, round: round, roundPrize: roundPrize, NO_PRIZE: NO_PRIZE };
})(typeof window !== "undefined" ? window : this);
