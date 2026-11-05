/* vp-venuepick.js: ONE VENUE, AND ONE VENUE DROP-DOWN, ON EVERY SCREEN (Dean, 3 Nov 2026).

   Dean signed in, chose The Mini Bar, and Your account opened on Gflam Group. Then he edited a raffle
   at The Mini Bar and Members showed Gflam Group. Two causes, both fixed here:
     1. Each screen remembered "the venue" in its own way: the console in vpCurrentVenue and
        vpVenuePick, Your account in vpVenuePick and vpImpersonate (HQ View as), the monthly report in
        its address only. Viewing an account from HQ, vpImpersonate named the venue View as was pressed
        on, and it beat the venue picked afterwards on every screen.
     2. Your account had a venue drop-down in every panel (Nights, Marketing, Raffles, Members, Screen),
        each opening on its own guess, so changing one left the others where they were.

   So there is one answer to "which venue am I looking at", written by one function:

     VPVenuePick.current()          the venue id every screen opens on, or null
     VPVenuePick.set(id, name)      the person chose a venue: every screen follows from now on.
                                    Writes vpCurrentVenue (vp-session.js, the console's venue),
                                    vpVenuePick (the console's per-shift pick and Your account's
                                    X-VP-Venue) and, ONLY while HQ is viewing an account, the
                                    venue in vpImpersonate, so View as follows the pick too.
                                    Fires "vp-venue" on window.
     VPVenuePick.choose(venues)     the venue a page should open on from a list: the current one if
                                    it is on the list, else the first
     VPVenuePick.mount(box, o)      THE drop-down, the same on every page:
                                      o.venues   [{ id, name }]
                                      o.value    the id to show (default: choose(o.venues).id)
                                      o.label    the words above it (default "Venue")
                                      o.note     an optional line under it
                                      o.onChange(id, name) may return false, or a promise of false,
                                                 to refuse the change (unsaved work); the drop-down
                                                 then goes back
                                    A list of one venue shows nothing: there is nothing to choose.
                                    Returns { select, set(id), value() }.

   The look is the shared on-brand drop-down (/app/vp-select.css) with the label style every admin
   page uses. No em dashes; lowercase venueplay in anything a person reads. */
(function (root) {
  "use strict";
  if (root.VPVenuePick) return;
  var CURRENT = "vpCurrentVenue", PICK = "vpVenuePick", IMP = "vpImpersonate";

  function store() { try { return root.localStorage || null; } catch (e) { return null; } }
  function readJson(k) {
    var s = store(); if (!s) return null;
    try { return JSON.parse(s.getItem(k) || "null"); } catch (e) { return null; }
  }
  function write(k, v) { var s = store(); if (!s) return; try { s.setItem(k, v); } catch (e) {} }

  function current() {
    var imp = readJson(IMP);
    if (imp && imp.id) return String(imp.id);
    var s = store(), c = null;
    try { c = s && s.getItem(CURRENT); } catch (e) { c = null; }
    if (c) return String(c);
    var p = readJson(PICK);
    return (p && p.id) ? String(p.id) : null;
  }

  function set(id, name) {
    if (!id) return;
    id = String(id);
    write(CURRENT, id);
    write(PICK, JSON.stringify({ id: id, at: Date.now() }));
    var imp = readJson(IMP);
    if (imp && imp.id && String(imp.id) !== id) write(IMP, JSON.stringify({ id: id, name: name || imp.name || "" }));
    try { root.dispatchEvent(new root.CustomEvent("vp-venue", { detail: { id: id, name: name || "" } })); } catch (e) {}
  }

  function choose(venues) {
    venues = venues || [];
    var id = current();
    for (var i = 0; i < venues.length; i++) { if (venues[i] && String(venues[i].id) === id) return venues[i]; }
    return venues[0] || null;
  }

  var STYLE = ".vpvp{display:flex;flex-direction:column;gap:6px;margin:0 0 16px}" +
    ".vpvp label{font-family:'JetBrains Mono',ui-monospace,Menlo,monospace;font-size:11px;letter-spacing:.08em;" +
    "text-transform:uppercase;color:var(--faint,#8a8a96)}" +
    ".vpvp select{width:100%;max-width:420px;min-height:46px;padding:11px 14px;font-size:15px;font-weight:700}" +
    ".vpvp .vpvp-note{margin:0;font-size:13px;color:var(--muted,#a6a6b0);line-height:1.45}" +
    "@media(max-width:520px){.vpvp select{max-width:none;font-size:16px}}";
  function addStyle(d) {
    if (d.getElementById("vpvpStyle")) return;
    var st = d.createElement("style"); st.id = "vpvpStyle"; st.textContent = STYLE;
    (d.head || d.documentElement).appendChild(st);
  }
  function settle(v, cb) {
    if (v && typeof v.then === "function") v.then(function (x) { cb(x !== false); }, function () { cb(false); });
    else cb(v !== false);
  }

  var seq = 0;
  function mount(box, o) {
    o = o || {};
    var d = root.document;
    if (!box || !d) return null;
    var venues = (o.venues || []).filter(function (v) { return v && v.id; });
    box.innerHTML = "";
    if (venues.length < 2) { box.hidden = true; return { select: null, set: function () {}, value: function () { return venues[0] ? String(venues[0].id) : null; } }; }
    addStyle(d);
    box.hidden = false;
    var id = "vpvp" + (++seq);
    var wrap = d.createElement("div"); wrap.className = "vpvp";
    var lab = d.createElement("label"); lab.setAttribute("for", id); lab.textContent = o.label || "Venue";
    var sel = d.createElement("select"); sel.id = id; sel.setAttribute("data-vp-venuepick", "1");
    venues.forEach(function (v) {
      var op = d.createElement("option"); op.value = String(v.id); op.textContent = v.name || "A venue"; sel.appendChild(op);
    });
    var start = o.value || (choose(venues) || {}).id;
    sel.value = String(start);
    var was = sel.value;
    wrap.appendChild(lab); wrap.appendChild(sel);
    if (o.note) { var p = d.createElement("p"); p.className = "vpvp-note"; p.textContent = o.note; wrap.appendChild(p); }
    box.appendChild(wrap);
    function nameOf(vid) { for (var i = 0; i < venues.length; i++) { if (String(venues[i].id) === vid) return venues[i].name || ""; } return ""; }
    sel.addEventListener("change", function () {
      var to = sel.value, from = was;
      if (to === from) return;
      settle(o.onChange ? o.onChange(to, nameOf(to)) : true, function (go) {
        if (!go) { sel.value = from; return; }
        was = to;
        set(to, nameOf(to));
      });
    });
    return {
      select: sel,
      set: function (vid) { if (vid) { sel.value = String(vid); was = sel.value; } },
      value: function () { return sel.value; }
    };
  }

  root.VPVenuePick = { current: current, set: set, choose: choose, mount: mount, KEYS: { current: CURRENT, pick: PICK, imp: IMP } };
})(typeof window !== "undefined" ? window : this);
