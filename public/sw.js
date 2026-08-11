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
