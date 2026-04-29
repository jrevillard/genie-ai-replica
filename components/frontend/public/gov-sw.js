/**
 * AMINA Government Observatory · Service Worker
 * ================================================
 * Offline-capable PWA for field officers on low-bandwidth networks.
 *
 * Strategy:
 *   - Cache-first for static assets (JS, CSS, fonts, images, flags)
 *   - Stale-while-revalidate for /api/v1/gov/mv/* aggregate reads
 *   - Network-first for anything else (auth-sensitive endpoints)
 *
 * The SW registers only when visiting /#/gov or /gov* routes — see
 * gov-sw-register.js. On reconnect the SW syncs the MV caches.
 */

const VERSION      = "amina-gov-v1";
const STATIC_CACHE = `${VERSION}-static`;
const API_CACHE    = `${VERSION}-api`;

const STATIC_PRECACHE = [
  "/",
  "/amina.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((c) => c.addAll(STATIC_PRECACHE)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names
          .filter((n) => !n.startsWith(VERSION))
          .map((n) => caches.delete(n))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Aggregate gov MVs → stale-while-revalidate
  if (url.pathname.startsWith("/api/v1/gov/mv/")) {
    event.respondWith((async () => {
      const cache  = await caches.open(API_CACHE);
      const cached = await cache.match(req);
      const net    = fetch(req).then((resp) => {
        if (resp.ok) cache.put(req, resp.clone()).catch(() => {});
        return resp;
      }).catch(() => null);
      return cached || (await net) || new Response(JSON.stringify({
        offline: true, error: "No cached copy and network is unavailable.",
      }), { status: 503, headers: { "Content-Type": "application/json" } });
    })());
    return;
  }

  // Static assets → cache-first
  if (
    req.destination === "style"  ||
    req.destination === "script" ||
    req.destination === "image"  ||
    req.destination === "font"
  ) {
    event.respondWith((async () => {
      const cache  = await caches.open(STATIC_CACHE);
      const cached = await cache.match(req);
      if (cached) return cached;
      try {
        const resp = await fetch(req);
        if (resp.ok) cache.put(req, resp.clone()).catch(() => {});
        return resp;
      } catch {
        return cached || new Response("", { status: 503 });
      }
    })());
    return;
  }

  // Everything else → network-first (no caching auth responses)
});
