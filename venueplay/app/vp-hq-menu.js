/* HQ MENU, STEP 1: Venues / Sales / Support / Reporting (Dean, 29 Oct 2026: "the screen is getting a little bit too much";
   design reports/hq-menu-18nov, 18 Nov 2026). Started from fix/hq-menu-restructure (5 Nov), copied, not rebased.

   HQ had fifteen tabs in one row. This puts them under four sections, each with its own row of tabs underneath.
   NOTHING IS REMOVED: every tab is still the same <button data-pane> inside #hqNav, so hq.html's goPane, the count
   badges, vp-helpdesk-hq.js (which adds its own button later) and every other tab script keep working. This file only
   decides which of those buttons are on show and in what order, from ONE table (GROUPS below). Tab names live on the
   buttons in hq.html, once; section names live here, once.

   - A pane this table does not know is always shown, so a tab added later is never lost; it just has no section yet.
   - Cancelled is in two sections (Venues and Sales): one button, shown in both, because it is the same list.
   - Opening any pane, by a click, by hq.html's goPane or by a link (#billing, #helpdesk, #help-12), moves the menu to
     that pane's section, so the highlighted section and tab always say where you are.
   - A section's red count adds up the counts its tabs already show, only the ones the design names (counts below).
   - If this file never loads, #hqNav still shows every tab, as before. */
(function (root) {
  "use strict";

  /* THE ONE TABLE. panes: the tabs, in the order they show. counts: the tabs whose red count adds up on the section.
     Journey is listed so it slots into Sales the day its tab lands; until then there is no button and nothing shows.
     The flagged tab is in Sales (design question 2, suggested yes): on live it is mostly sign-ups to check. */
  var GROUPS = [
    { id: "venues",    label: "Venues",    panes: ["venues", "live", "quiet", "groups", "screens", "cancelled"],
      counts: ["quiet"] },
    { id: "sales",     label: "Sales",     panes: ["prospects", "coaster", "journey", "flagged", "subscribers", "cancelled"],
      counts: ["prospects", "flagged", "cancelled"] },
    { id: "support",   label: "Support",   panes: ["helpdesk", "privacy", "team"],
      counts: ["helpdesk"] },
    /* Reporting has NO count in step 1. The design's "group nights nobody has billed" needs a Billing tab count that
       nothing sets yet, so listing billing here only promised a number that could never show. It is a step 2 item. */
    { id: "reporting", label: "Reporting", panes: ["billing", "usage", "reports", "audit"],
      counts: [] }
  ];

  function groupsOf(pane) {
    var out = [];
    GROUPS.forEach(function (g) { if (g.panes.indexOf(pane) >= 0) out.push(g.id); });
    return out;
  }
  function groupById(id) { for (var i = 0; i < GROUPS.length; i++) if (GROUPS[i].id === id) return GROUPS[i]; return null; }

  /* A link: "#billing" is the Billing pane, "#sales" is the Sales section (its first tab that is on show). "#helpdesk" and
     "#help-12" belong to vp-helpdesk-hq.js, which opens them itself; they are NOT routed here so nothing opens twice. */
  function parseHash(h) {
    h = String(h || "").replace(/^#/, "").toLowerCase();
    if (!h || h === "helpdesk" || /^help-\d+$/.test(h)) return null;
    var all = {};
    GROUPS.forEach(function (g) { g.panes.forEach(function (p) { all[p] = true; }); });
    if (all[h]) return { pane: h };
    if (groupById(h)) return { group: h };
    return null;
  }

  function create(doc, win) {
    var nav = doc.getElementById("hqNav"), bar = doc.getElementById("hqGroups");
    if (!nav || !bar) return null;
    var cur = "venues", lastIn = {}, gbtn = {};

    function panes() { return Array.prototype.slice.call(nav.querySelectorAll("button[data-pane]")); }
    /* A tab this admin may not have (role) or that its own script has not turned on yet (hidden) is not on offer. */
    function offered(b) { return !b.hasAttribute("hidden") && !(b.style && b.style.display === "none"); }
    function firstOffered(gid) {
      var g = groupById(gid), bs = panes();
      for (var i = 0; i < g.panes.length; i++) for (var j = 0; j < bs.length; j++)
        if (bs[j].getAttribute("data-pane") === g.panes[i] && offered(bs[j])) return bs[j];
      return null;
    }
    function badgeSum(gid) {
      var n = 0, g = groupById(gid);
      panes().forEach(function (b) {
        if (g.counts.indexOf(b.getAttribute("data-pane")) < 0 || !offered(b)) return;
        var sp = b.querySelector(".hdbadge");
        if (!sp || sp.hasAttribute("hidden")) return;
        var k = parseInt(String(sp.textContent).replace(/[^0-9]/g, ""), 10);
        if (k > 0) n += k;
      });
      return n;
    }
    function refresh() {
      var g = groupById(cur);
      panes().forEach(function (b) {
        var p = b.getAttribute("data-pane"), gs = groupsOf(p);
        var show = gs.length === 0 || gs.indexOf(cur) >= 0;
        b.classList.toggle("vpm-off", !show);
        /* The order the design gives, without moving a button: #hqNav is a flex row. A tab no section knows goes last. */
        var at = g.panes.indexOf(p), want = String(at >= 0 ? at : 99);
        if (b.style && b.style.order !== want) b.style.order = want;
      });
      GROUPS.forEach(function (x) {
        var gb = gbtn[x.id]; if (!gb) return;
        gb.classList.toggle("on", x.id === cur);
        gb.classList.toggle("vpm-off", !firstOffered(x.id));
        var sp = gb.querySelector(".hdbadge"), n = badgeSum(x.id), txt = n > 99 ? "99+" : (n ? String(n) : "");
        if (sp && sp.textContent !== txt) sp.textContent = txt;
        if (sp) { if (n) sp.removeAttribute("hidden"); else if (!sp.hasAttribute("hidden")) sp.setAttribute("hidden", ""); }
      });
    }
    /* The menu follows the pane. If the pane is in the section already showing, stay put (Cancelled is in two). */
    function sync(pane) {
      var gs = groupsOf(pane);
      if (gs.length && gs.indexOf(cur) < 0) cur = gs[0];
      if (gs.length) lastIn[cur] = pane;
      refresh();
    }
    function openGroup(gid) {
      if (!groupById(gid)) return;
      cur = gid; refresh();
      var want = lastIn[gid], target = null;
      panes().forEach(function (b) { if (b.getAttribute("data-pane") === want && offered(b)) target = b; });
      if (!target) target = firstOffered(gid);
      if (target) target.click();
    }
    function route(hash) {
      var r = parseHash(hash); if (!r) return false;
      if (r.group) { openGroup(r.group); return true; }
      var gs = groupsOf(r.pane), b = null;
      panes().forEach(function (x) { if (x.getAttribute("data-pane") === r.pane && offered(x)) b = x; });
      if (!b) return false;
      if (gs.indexOf(cur) < 0) { cur = gs[0]; }
      b.click(); return true;
    }

    /* The section buttons go before whatever the row already holds (the Show test venues switch stays at its right). */
    var tail = bar.firstChild || null;
    GROUPS.forEach(function (g) {
      var b = doc.createElement("button");
      b.setAttribute("type", "button"); b.setAttribute("data-group", g.id);
      b.appendChild(doc.createTextNode(g.label));
      var sp = doc.createElement("span"); sp.className = "hdbadge tabcount"; sp.setAttribute("hidden", ""); b.appendChild(sp);
      gbtn[g.id] = b; bar.insertBefore(b, tail);
    });
    bar.addEventListener("click", function (e) {
      var b = e.target.closest && e.target.closest("button"); if (!b) return;
      var gid = b.getAttribute("data-group"); if (gid) openGroup(gid);
    });
    nav.addEventListener("click", function (e) {
      var b = e.target.closest && e.target.closest("button"); if (!b) return;
      var p = b.getAttribute("data-pane"); if (p) sync(p);
    });
    if (win && typeof win.MutationObserver === "function") {
      try { new win.MutationObserver(function () { refresh(); }).observe(nav, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["hidden", "style"] }); } catch (e) {}
    }
    refresh();
    return { sync: sync, refresh: refresh, openGroup: openGroup, route: route, current: function () { return cur; } };
  }

  var live = null;
  function start(doc, win) {
    doc = doc || root.document; win = win || root;
    live = create(doc, win);
    if (live && win.addEventListener) {
      win.addEventListener("hashchange", function () { live.route(win.location && win.location.hash); });
      /* A link on load: wait until HQ has signed in and shown #app, and until the tab it names is on offer (Prospects turns
         itself on when its list arrives). Gives up quietly after about 30 seconds. */
      var h0 = win.location && win.location.hash, tries = 0;
      if (h0 && parseHash(h0)) (function tryRoute() {
        var app = doc.getElementById("app"), ready = !app || (app.style && app.style.display === "block");
        if (ready && live.route(h0)) return;
        if (tries++ < 60) win.setTimeout(tryRoute, 500);
      })();
    }
    return live;
  }
  root.VPHQMenu = {
    GROUPS: GROUPS, groupsOf: groupsOf, parseHash: parseHash, create: create, start: start,
    sync: function (pane) { if (live) live.sync(pane); }
  };
  if (root.document && root.document.getElementById && root.document.getElementById("hqGroups")) start();
})(typeof window !== "undefined" ? window : this);
