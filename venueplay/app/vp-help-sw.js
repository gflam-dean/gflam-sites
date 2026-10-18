/* ============================================================================
   HELP DESK PHONE ALERTS: the service worker (19 Oct 2026).

   Registered by HQ (vp-helpdesk-hq.js) with the narrow scope /app/help-push/, which no page
   lives under, so this never controls or intercepts any VenuePlay page. It has no fetch handler.

   The push that wakes it is EMPTY (see helpPushNew in venueplay-api-FULL.js: nothing of a
   customer's goes through Apple's or Google's push servers). It asks the Worker what arrived,
   using this device's own secret, and is told brand, kind and ticket number only.
   Every push MUST show a notification (iPhone switches alerts off for a site that does not), so
   if the question fails it still says something.
   ========================================================================== */
var SCOPE_CONFIG = "/app/help-push/config";

self.addEventListener("install", function () { self.skipWaiting(); });
self.addEventListener("activate", function (e) { e.waitUntil(self.clients.claim()); });

function whatArrived() {
  return caches.open("vp-help-push").then(function (c) { return c.match(SCOPE_CONFIG); }).then(function (r) {
    if (!r) return null;
    return r.json().then(function (cfg) {
      return fetch(cfg.api + "/help/push/peek", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: cfg.endpoint, token: cfg.token }) }).then(function (x) { return x.ok ? x.json() : null; });
    });
  }).catch(function () { return null; });
}

self.addEventListener("push", function (e) {
  e.waitUntil(whatArrived().then(function (d) {
    var title = "Help desk", body = "Something new has come in.", url = "/app/hq.html#helpdesk";
    if (d && d.ticket_no) {
      title = "[" + (d.brand === "partyplay" ? "PartyPlay" : "VenuePlay") + "] " + (d.urgent ? "URGENT " : "") + (d.label || "New ticket");
      body = "Ticket #" + d.ticket_no + (d.count > 1 ? " and " + (d.count - 1) + " more" : "") + ". Tap to open it.";
      url = "/app/hq.html#help-" + d.ticket_no;
    }
    return self.registration.showNotification(title, { body: body, tag: "vp-help", renotify: true,
      icon: "/logos/venueplay_appicon_rebuilt.png", data: { url: url } });
  }));
});

self.addEventListener("notificationclick", function (e) {
  e.notification.close();
  var url = (e.notification.data && e.notification.data.url) || "/app/hq.html#helpdesk";
  /* openWindow, not navigate: this worker controls no page (its scope holds none), and navigate only
     works on a page it controls. On a phone, openWindow brings up HQ from the Home Screen. */
  e.waitUntil(self.clients.openWindow(url));
});
