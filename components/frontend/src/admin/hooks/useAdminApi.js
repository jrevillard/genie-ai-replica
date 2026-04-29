/**
 * useAdminApi — thin stale-while-revalidate hook for admin + gov data.
 * =====================================================================
 *
 * Caches GET responses per URL in memory; refreshes in the background
 * on every new subscribe. Keeps re-renders cheap because only the
 * resolved JSON reference changes between revalidations.
 *
 *   const { data, loading, error, refresh } = useAdminApi("/api/v1/admin/mv/command-center");
 *
 * Auth: sends the Authorization: Bearer <token> header picked from
 * `localStorage.AMINA_ADMIN_TOKEN` (or `AMINA_TOKEN`). The guest-chat
 * routes don't need this; admin/gov MV endpoints do.
 */

import { useCallback, useEffect, useRef, useState } from "react";

const API = ((typeof window !== "undefined" && window.AMINA_API) || "http://localhost:8000")
  .replace(/\/+$/, "");

const _cache      = new Map();   // url → { data, ts }
const _inflight   = new Map();   // url → Promise
const _subs       = new Map();   // url → Set<fn>

function _authHeaders() {
  try {
    const tok =
      localStorage.getItem("AMINA_ADMIN_TOKEN")
      || localStorage.getItem("AMINA_TOKEN")
      || "";
    return tok
      ? { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" }
      : { "Content-Type": "application/json" };
  } catch {
    return { "Content-Type": "application/json" };
  }
}

function _notify(url, payload) {
  const set = _subs.get(url);
  if (!set) return;
  for (const fn of set) try { fn(payload); } catch {}
}

async function _fetch(url) {
  const inflight = _inflight.get(url);
  if (inflight) return inflight;
  const p = (async () => {
    try {
      const r = await fetch(`${API}${url}`, { headers: _authHeaders() });
      const j = await r.json().catch(() => ({}));
      const payload = r.ok
        ? { data: j, error: null }
        : { data: null, error: j.detail || `HTTP ${r.status}` };
      _cache.set(url, { ...payload, ts: Date.now() });
      _notify(url, payload);
      return payload;
    } catch (e) {
      const payload = { data: null, error: String(e) };
      _cache.set(url, { ...payload, ts: Date.now() });
      _notify(url, payload);
      return payload;
    } finally {
      _inflight.delete(url);
    }
  })();
  _inflight.set(url, p);
  return p;
}

export function useAdminApi(url, { refreshMs = 0 } = {}) {
  const cached = _cache.get(url);
  const [state, setState] = useState(() => ({
    data: cached?.data ?? null,
    error: cached?.error ?? null,
    loading: !cached,
  }));
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    if (!_subs.has(url)) _subs.set(url, new Set());
    const onUpdate = ({ data, error }) => {
      if (!mounted.current) return;
      setState({ data, error, loading: false });
    };
    _subs.get(url).add(onUpdate);

    _fetch(url);

    let t = null;
    if (refreshMs > 0) {
      t = setInterval(() => _fetch(url), refreshMs);
    }
    return () => {
      mounted.current = false;
      _subs.get(url)?.delete(onUpdate);
      if (t) clearInterval(t);
    };
  }, [url, refreshMs]);

  const refresh = useCallback(() => _fetch(url), [url]);

  return { ...state, refresh };
}

/** Clear all cached responses (use after a destructive admin action). */
export function clearAdminCache(prefix) {
  for (const k of _cache.keys()) {
    if (!prefix || k.startsWith(prefix)) _cache.delete(k);
  }
}

// Allow other admin widgets (review modal, notification bell, fetch
// interceptor) to force every subscribed table to refetch immediately,
// instead of waiting for the next 30s poll. detail.prefix optionally
// scopes the refresh to a single admin endpoint family.
if (typeof window !== "undefined" && !window.__aminaAdminApiRefreshListener) {
  window.__aminaAdminApiRefreshListener = true;
  window.addEventListener("amina:admin-data:refresh", (e) => {
    const prefix = e && e.detail && e.detail.prefix ? String(e.detail.prefix) : "";
    for (const url of _subs.keys()) {
      if (!prefix || url.startsWith(prefix)) _fetch(url);
    }
  });
}

export { _authHeaders as adminAuthHeaders, API as ADMIN_API };
