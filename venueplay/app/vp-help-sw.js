/* ============================================================================
   HELP DESK PHONE ALERTS: the service worker (19 Oct 2026).

   Registered by HQ (vp-helpdesk-hq.js) with the narrow scope /app/help-push/, which no page
   lives under, so this never controls or intercepts any VenuePlay page. It has no fetch handler.

   The push that wakes it is EMPTY (see helpPushNew in venueplay-api-FULL.js: nothing of a
   customer's goes through Apple's or Google's push servers). It asks the Worker what arrived,
   using this device's own secret, and is told brand, kind and ticket number only.
   Every push MUST show a notification (iPhone switches alerts off for a site that does not), so
   if the question fails it still says something.

   STICKY SALES AND URGENT ALERTS (Dean, 3 Nov 2026: "buzz it so then it keeps the banner up on my
   screen but then like move it on"). A sales or urgent ticket's alert stays on screen until it is
   dealt with (requireInteraction), under its own tag, vp-help-<number>, so one ticket is one alert,
   and it is never silent. It "moves on" (closes itself) when:
     - it is tapped (that opens the ticket in HQ, which is handling it),
     - HQ on this device opens, replies to, closes or assigns that ticket (vp-helpdesk-hq.js closes it
       through this worker's registration), or HQ's ticket list shows it already dealt with,
     - the next alert reaches this device: the question to the Worker carries the numbers of the
       alerts still on screen, and the Worker answers which of them are handled (status past new, or
       assigned). Those close before the new one shows.
   There is deliberately NO separate "ticket handled" push: a push that shows nothing gets a site's
   alerts switched off on an iPhone after a few, and one that shows something would ding Dean's
   phone every time he deals with a ticket on the Mac. Other kinds of ticket keep the one shared,
   non-sticky "vp-help" alert they always had.
   ========================================================================== */
var SCOPE_CONFIG = "/app/help-push/config";

self.addEventListener("install", function () { self.skipWaiting(); });
self.addEventListener("activate", function (e) { e.waitUntil(self.clients.claim()); });

/* Sales and urgent stay up until dealt with. The ONE place that decides it. */
function stickyAlert(d) { return !!(d && d.ticket_no && (d.urgent || d.category === "sales")); }
function alertTag(no) { return "vp-help-" + no; }

/* The ticket numbers of this site's alerts still on screen (only numbers: the device already has them). */
function onScreen() {
  if (!self.registration.getNotifications) return Promise.resolve([]);
  return self.registration.getNotifications().then(function (list) {
    return (list || []).map(function (n) { return n.data && n.data.ticket_no; })
      .filter(function (x) { return /^\d{1,9}$/.test(String(x || "")); }).slice(0, 20);
  }).catch(function () { return []; });
}

/* Close the alerts for these ticket numbers. */
function closeAlerts(nos) {
  var want = {}; (nos || []).forEach(function (n) { want[String(n)] = true; });
  if (!Object.keys(want).length || !self.registration.getNotifications) return Promise.resolve(0);
  return self.registration.getNotifications().then(function (list) {
    var n = 0;
    (list || []).forEach(function (x) { if (x.data && want[String(x.data.ticket_no)]) { x.close(); n++; } });
    return n;
  }).catch(function () { return 0; });
}

function whatArrived(showing) {
  return caches.open("vp-help-push").then(function (c) { return c.match(SCOPE_CONFIG); }).then(function (r) {
    if (!r) return null;
    return r.json().then(function (cfg) {
      return fetch(cfg.api + "/help/push/peek", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: cfg.endpoint, token: cfg.token, showing: showing || [] }) }).then(function (x) { return x.ok ? x.json() : null; });
    });
  }).catch(function () { return null; });
}

self.addEventListener("push", function (e) {
  e.waitUntil(onScreen().then(whatArrived).then(function (d) {
    return closeAlerts(d && d.handled).then(function () { return d; });
  }).then(function (d) {
    var title = "Help desk", body = "Something new has come in.", url = "/app/hq.html#helpdesk";
    if (d && d.ticket_no) {
      title = "[" + (d.brand === "partyplay" ? "PartyPlay" : "venueplay") + "] " + (d.urgent ? "URGENT " : "") + (d.label || "New ticket");
      body = "Ticket #" + d.ticket_no + (d.count > 1 ? " and " + (d.count - 1) + " more" : "") + ". Tap to open it.";
      url = "/app/hq.html#help-" + d.ticket_no;
    }
    var opts = { body: body, tag: "vp-help", renotify: true,
      icon: "/logos/venueplay_appicon_rebuilt.png", data: { url: url, ticket_no: (d && d.ticket_no) || null } };
    /* A sales or urgent ticket: stays up until dealt with, its own tag, and it sounds (never silent). */
    if (stickyAlert(d)) { opts.tag = alertTag(d.ticket_no); opts.requireInteraction = true; opts.silent = false; }
    return self.registration.showNotification(title, opts);
  }));
});

self.addEventListener("notificationclick", function (e) {
  e.notification.close();
  var data = e.notification.data || {};
  var url = data.url || "/app/hq.html#helpdesk";
  /* openWindow, not navigate: this worker controls no page (its scope holds none), and navigate only
     works on a page it controls. On a phone, openWindow brings up HQ from the Home Screen.
     Tapping it is dealing with it: any other copy of that ticket's alert goes too. */
  e.waitUntil(Promise.all([closeAlerts(data.ticket_no ? [data.ticket_no] : []), self.clients.openWindow(url)]));
});
