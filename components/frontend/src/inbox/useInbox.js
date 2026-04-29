/**
 * useInbox — React hook wrapping the Amina inbox API.
 *
 * Responsibilities
 *   - Hold the current item list, unread count, loading/error state.
 *   - Poll /unread-count every INBOX_POLL_MS while mounted (cheap query).
 *   - Re-fetch the full list on first open + whenever an item is marked read.
 *   - Expose imperative helpers: open(), close(), refresh(), markRead().
 *
 * Design note — cached open: the panel keeps the last list in state so
 * opening it twice in a row is instant, and a background refresh keeps it
 * fresh. Same pattern Gmail / Slack use.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import * as api from "./inboxApi";

const INBOX_POLL_MS = 20_000;

export function useInbox({ enabled = true } = {}) {
  const [items,  setItems]  = useState([]);
  const [unread, setUnread] = useState(0);
  const [open,   setOpen]   = useState(false);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState("");

  // Avoid concurrent list fetches — if one is in flight, new calls wait.
  const inflight = useRef(null);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    if (inflight.current) return inflight.current;
    setLoading(true);
    setError("");
    const p = (async () => {
      const d = await api.listInbox({ limit: 50 });
      if (d._error) setError(d._error);
      else {
        setItems(d.items || []);
        setUnread(Number(d.unread || 0));
      }
      setLoading(false);
      inflight.current = null;
    })();
    inflight.current = p;
    return p;
  }, [enabled]);

  const pollUnread = useCallback(async () => {
    if (!enabled) return;
    const n = await api.unreadCount();
    setUnread(n);
  }, [enabled]);

  // Poll loop — cheap /unread-count query.
  useEffect(() => {
    if (!enabled) return;
    pollUnread();
    const id = setInterval(pollUnread, INBOX_POLL_MS);
    return () => clearInterval(id);
  }, [enabled, pollUnread]);

  // First open → full fetch.
  useEffect(() => {
    if (open && items.length === 0) refresh();
  }, [open, items.length, refresh]);

  const markRead = useCallback(
    async (inboxId) => {
      const ok = await api.markRead(inboxId);
      if (ok) {
        setItems(prev => prev.map(i =>
          i.inbox_id === inboxId ? { ...i, read: true } : i,
        ));
        setUnread(prev => Math.max(0, prev - 1));
      }
      return ok;
    },
    [],
  );

  const markAllRead = useCallback(async () => {
    const n = await api.markAllRead();
    if (n >= 0) {
      setItems(prev => prev.map(i => ({ ...i, read: true })));
      setUnread(0);
    }
    return n;
  }, []);

  // Listen for "amina:inbox:refresh" window events so external code (e.g.
  // the ChatInterceptor that captures PDFs into the inbox) can nudge the
  // bell without knowing about this hook.
  useEffect(() => {
    if (!enabled) return;
    const handler = () => { refresh(); };
    window.addEventListener("amina:inbox:refresh", handler);
    return () => window.removeEventListener("amina:inbox:refresh", handler);
  }, [enabled, refresh]);

  return {
    items,
    unread,
    open,
    loading,
    error,
    setOpen,
    refresh,
    markRead,
    markAllRead,
  };
}
