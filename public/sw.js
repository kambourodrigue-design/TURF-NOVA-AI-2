// Service worker minimal, uniquement pour satisfaire les critères d'installabilité
// PWA de Chrome. Il ne met rien en cache : les pronostics, cotes et résultats
// doivent toujours venir du réseau, jamais d'une copie locale périmée.
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  event.respondWith(fetch(event.request));
});

// --- Notifications push (pronostic du jour) ---
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    // payload non-JSON, on ignore et on affiche une notification générique
  }
  const title = data.title || "Turf Nova AI";
  const options = {
    body: data.body || "Le pronostic du jour est disponible.",
    icon: "/img/icon-192.png",
    badge: "/img/icon-192.png",
    data: { url: data.url || "/" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.includes(url) && "focus" in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
