/* PERS RRT service worker
 * 1. Shows an alert when the control room sends a push message (even if the app is closed).
 * 2. Opens / focuses the app when the alert is tapped.
 * 3. Shows a friendly page when the phone is offline.
 * Pages and data are never cached: the app always shows live information.
 */
const VERSION = "pers-rrt-v1";
const OFFLINE_URL = "/offline.html";
const PRECACHE = [OFFLINE_URL, "/icons/icon-192.png", "/icons/badge-96.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.mode === "navigate") {
    event.respondWith(fetch(req).catch(() => caches.match(OFFLINE_URL)));
  }
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: "PERS", body: event.data ? event.data.text() : "" };
  }
  const isOffer = data.type === "INCIDENT_OFFER";
  const title = data.title || "PERS";
  const options = {
    body: data.body || "",
    icon: "/icons/icon-192.png",
    badge: "/icons/badge-96.png",
    tag: data.tag || "pers",
    renotify: true,
    requireInteraction: isOffer,
    vibrate: isOffer ? [500, 200, 500, 200, 500, 200, 900] : [200, 100, 200],
    data: { url: data.url || "/rrt", type: data.type || null },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/rrt";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if (c.url.indexOf("/rrt") !== -1 && "focus" in c) return c.focus();
      }
      return self.clients.openWindow(url);
    }),
  );
});
