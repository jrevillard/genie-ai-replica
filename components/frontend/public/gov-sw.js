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

// Bumped on 2026-04-30 (Phase 9 v2 follow-up). The previous v1 was
// caching ALL JS modules page-wide because the cache-first block
// below didn't scope by URL path. Once a caregiver-mode user happened
// to visit a gov route in the same browser session, the SW captured
// every subsequent script fetch — including caregiver-portal modules
// and Vite dev modules — and the operator's browser kept serving
// stale code even after dev-server restarts. The bump forces the
// activate handler to drop every old cache.
const VERSION      = "amina-gov-v2";
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

  // Static assets → cache-first.
  //
  // Phase 9 v2 follow-up — scope check. Without this guard the SW
  // captured EVERY script the page loaded (caregiver portal modules,
  // Vite dev modules, HMR client, etc.) and refused to refresh them
  // after a deploy / dev rebuild. The SW's purpose is the gov PWA,
  // so cache-first must only apply to:
  //   - the gov route's own modules (/src/gov/, /src/router/, etc.)
  //   - the explicitly precached static assets listed above
  //   - production-built hashed bundles under /assets/
  // and MUST skip:
  //   - Vite dev modules (/src/, /node_modules/, /@vite/, /@react-refresh)
  //   - caregiver portal modules (CaregiverPortal.jsx and its imports)
  //   - anything else outside the gov scope.
  // Everything skipped here falls through to the network-first
  // default at the bottom of this handler.
  const isViteDev = (
    url.pathname.startsWith("/@vite/") ||
    url.pathname.startsWith("/@react-refresh") ||
    url.pathname.startsWith("/@id/") ||
    url.pathname.startsWith("/@fs/") ||
    url.pathname.startsWith("/node_modules/")
  );
  const isProdAsset    = url.pathname.startsWith("/assets/");
  const isPrecached    = STATIC_PRECACHE.includes(url.pathname);
  const isGovSrcModule = (
    url.pathname.startsWith("/src/gov/") ||
    url.pathname.startsWith("/src/router/")
  );

  if (
    !isViteDev &&
    (req.destination === "style"  ||
     req.destination === "script" ||
     req.destination === "image"  ||
     req.destination === "font") &&
    (isProdAsset || isPrecached || isGovSrcModule)
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
