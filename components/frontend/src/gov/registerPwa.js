/**
 * Register the gov-sw.js service worker when the user visits any
 * gov route. Idempotent. Fails silently in browsers without SW
 * support.
 */

export function registerGovSw() {
  if (typeof navigator === "undefined") return;
  if (!("serviceWorker" in navigator))  return;
  if (window.__aminaGovSwRegistered)    return;
  window.__aminaGovSwRegistered = true;
  try {
    navigator.serviceWorker.register("/gov-sw.js").catch((e) => {
      // eslint-disable-next-line no-console
      console.debug("gov-sw registration failed:", e);
    });
  } catch {}
}
