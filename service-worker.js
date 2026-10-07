const CACHE_VERSION = "imv-louvor-pwa-v13";

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(cache =>
      cache.addAll(["/", "/manifest.webmanifest?v=8", "/imv-app-icon.svg?v=9", "/imv-logo.svg", "/apple-touch-icon-v9.png", "/pwa-192-v9.png"])
    ).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(key => key !== CACHE_VERSION).map(key => caches.delete(key)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    fetch(event.request)
      .then(response => {
        const copy = response.clone();
        caches.open(CACHE_VERSION).then(cache => cache.put(event.request, copy)).catch(() => {});
        return response;
      })
      .catch(() => caches.match(event.request).then(hit => hit || caches.match("/")))
  );
});

self.addEventListener("push", event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch {}
  event.waitUntil(self.registration.showNotification(data.title || "IMV Louvor", {
    body: data.body || "Você recebeu um novo aviso do Ministério de Louvor.",
    icon: "/pwa-192-v9.png",
    badge: "/pwa-192-v9.png",
    data: { url: data.url || "/" }
  }));
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  event.waitUntil(self.clients.openWindow(
    (event.notification.data && event.notification.data.url) || "/"
  ));
});