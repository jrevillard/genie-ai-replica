/**
 * ChatToastHost — surfaces new chat messages + emergency alerts as
 * top-right toast cards for BOTH patient and caregiver sessions.
 *
 * Detection is polling-based (every 4s) and works with the existing
 * backend — no new endpoints needed:
 *
 *   Patient role
 *     - partner = their caregiver (GET /patient/my-caregiver → caregiver_id)
 *     - message source: GET /direct-chat/messages?partner_id={cg}
 *       → any new entry where sender_type === 'caregiver' triggers a
 *       `caregiver_ping` toast.
 *     - emergency source: GET /inbox/list?kind=alert → severity=emergency
 *       items fire a red toast.
 *
 *   Caregiver role
 *     - partner = their linked patient (JWT `patient_id`)
 *     - message source: GET /direct-chat/messages?partner_id={pt}
 *       → any new entry where sender_type === 'patient' triggers a
 *       `patient_ping` toast.
 *     - emergency source: GET /caregiver/inbox/list → severity=emergency
 *       items fire a red toast.
 *
 * State is in-memory. We seed the "last-seen" cursor on first tick so
 * we never toast the pre-existing backlog — only genuinely-new items
 * that arrive while the tab is open.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import ChatToast from "./ChatToast.jsx";


const POLL_MS     = 4000;
const MAX_STACKED = 4;
const TOAST_TTL   = 8000;


function _base() {
  const raw = (typeof window !== "undefined" && window.__AMINA_API_BASE__)
           || (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.VITE_API_BASE)
           || "http://localhost:8000";
  return String(raw).replace(/\/+$/, "");
}


function _decode(tok) {
  try {
    const parts = String(tok || "").split(".");
    if (parts.length < 2) return null;
    const pad = "=".repeat((4 - (parts[1].length % 4)) % 4);
    return JSON.parse(atob((parts[1] + pad).replace(/-/g, "+").replace(/_/g, "/")));
  } catch { return null; }
}


function _currentRoleAndToken() {
  try {
    const cgTok = localStorage.getItem("AMINA_CG_TOKEN");
    if (cgTok && _decode(cgTok)?.role === "caregiver") {
      return { role: "caregiver", token: cgTok, payload: _decode(cgTok) };
    }
    const tok = localStorage.getItem("AMINA_TOKEN");
    if (!tok) return { role: null, token: "", payload: null };
    const p = _decode(tok);
    if (p?.role === "caregiver") return { role: "caregiver", token: tok, payload: p };
    return { role: "patient", token: tok, payload: p };
  } catch {
    return { role: null, token: "", payload: null };
  }
}


function _headers(token) {
  return token
    ? { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" }
    : { "Content-Type": "application/json" };
}


export default function ChatToastHost() {
  const [toasts,  setToasts]  = useState([]);
  const idRef                 = useRef(0);
  // Seeds: cursor + partner per poll cycle.
  const seenChatRef           = useRef(new Set());          // message ids already seen
  const seenInboxRef          = useRef(new Set());          // inbox item ids already seen
  const firstRunRef           = useRef(true);               // true until after first poll
  const partnerIdRef          = useRef("");                 // cached partner id
  const partnerNameRef        = useRef("");                 // cached partner display name

  const pushToast = useCallback((t) => {
    setToasts((xs) => {
      const nextId = ++idRef.current;
      const entry  = { id: nextId, ...t };
      // Keep at most MAX_STACKED; drop the oldest to make room.
      const trimmed = xs.length >= MAX_STACKED ? xs.slice(xs.length - (MAX_STACKED - 1)) : xs;
      return [...trimmed, entry];
    });
  }, []);

  const dismissToast = useCallback((id) => {
    setToasts((xs) => xs.filter((x) => x.id !== id));
  }, []);

  // ── partner resolution (patient → their caregiver; caregiver → their patient) ─
  // Also caches the partner's display name so the toast title is
  // "Fatou Jallow" rather than the generic "Your caregiver".
  const resolvePartner = useCallback(async (role, token, payload) => {
    if (role === "caregiver") {
      const pid = payload?.patient_id || "";
      // Best-effort: fetch patient profile name so the toast shows
      // "Dado Badjie" instead of "Your patient".
      try {
        const r = await fetch(
          `${_base()}/api/v1/patient/profile?patient_id=${encodeURIComponent(pid)}`,
          { credentials: "include", headers: _headers(token) },
        );
        if (r.ok) {
          const d = await r.json();
          partnerNameRef.current = d?.patient?.name || d?.name || "";
        }
      } catch { /* keep default */ }
      return pid;
    }
    // Patient: ask the backend who their linked caregiver is.
    try {
      const r = await fetch(`${_base()}/api/v1/patient/my-caregiver`,
                            { credentials: "include", headers: _headers(token) });
      if (!r.ok) return "";
      const d = await r.json();
      // Shape: { caregiver: { caregiver_id, name, ... } } or flat.
      const cg = d?.caregiver || d || {};
      partnerNameRef.current = cg.name || "";
      return cg.caregiver_id || d?.caregiver_id || "";
    } catch { return ""; }
  }, []);

  // ── chat poll ─────────────────────────────────────────────────────
  const pollChat = useCallback(async (role, token, partnerId) => {
    if (!partnerId) return;
    try {
      const r = await fetch(
        `${_base()}/api/v1/direct-chat/messages?partner_id=${encodeURIComponent(partnerId)}&limit=20`,
        { credentials: "include", headers: _headers(token) },
      );
      if (!r.ok) return;
      const d = await r.json();
      const msgs = d?.messages || [];
      const expectedSender = role === "caregiver" ? "patient" : "caregiver";

      for (const m of msgs) {
        if (!m?.id) continue;
        if (seenChatRef.current.has(m.id)) continue;
        seenChatRef.current.add(m.id);
        if (firstRunRef.current) continue;              // skip backlog on first tick
        if (m.sender_type !== expectedSender) continue; // only toast INCOMING

        const partnerName = partnerNameRef.current
          || (role === "caregiver" ? "Your patient" : "Your caregiver");
        pushToast({
          title:  partnerName,
          body:   m.text,
          sender: role === "caregiver" ? "Patient" : "Caregiver",
          variant: role === "caregiver" ? "patient_ping" : "caregiver_ping",
          ttlMs: TOAST_TTL,
        });
      }
    } catch { /* silent */ }
  }, [pushToast]);

  // ── inbox poll (for severity=emergency items) ────────────────────
  const pollInbox = useCallback(async (role, token) => {
    try {
      const url = role === "caregiver"
        ? `${_base()}/api/v1/caregiver/inbox/list?limit=10&unread_only=true`
        : `${_base()}/api/v1/inbox/list?limit=10&unread_only=true`;
      const r = await fetch(url, { credentials: "include", headers: _headers(token) });
      if (!r.ok) return;
      const d = await r.json();
      const items = d?.items || [];

      for (const it of items) {
        if (!it?.inbox_id) continue;
        if (seenInboxRef.current.has(it.inbox_id)) continue;
        seenInboxRef.current.add(it.inbox_id);
        if (firstRunRef.current) continue;   // skip backlog on first tick
        if (it.severity !== "emergency") continue;

        pushToast({
          title:  it.title || "Emergency alert",
          body:   it.body || "",
          variant: "emergency",
          ttlMs: 14000,   // lingers longer — emergency deserves attention
        });
      }
    } catch { /* silent */ }
  }, [pushToast]);

  // ── main loop ────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    let timer = null;

    const tick = async () => {
      if (cancelled) return;
      const { role, token, payload } = _currentRoleAndToken();
      if (role && token) {
        if (!partnerIdRef.current) {
          partnerIdRef.current = await resolvePartner(role, token, payload);
        }
        await pollChat(role, token, partnerIdRef.current);
        await pollInbox(role, token);
      }
      firstRunRef.current = false;
      if (!cancelled) timer = setTimeout(tick, POLL_MS);
    };

    tick();

    const onAuth = () => {
      // Auth changed → flush partner cache + seed cursors.
      partnerIdRef.current   = "";
      partnerNameRef.current = "";
      seenChatRef.current.clear();
      seenInboxRef.current.clear();
      firstRunRef.current = true;
    };
    window.addEventListener("amina:auth-changed", onAuth);
    window.addEventListener("storage", onAuth);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      window.removeEventListener("amina:auth-changed", onAuth);
      window.removeEventListener("storage", onAuth);
    };
  }, [pollChat, pollInbox, resolvePartner]);

  return (
    <div style={{
      position: "fixed",
      top: 80, right: 20,
      zIndex: 10100,                    // above bells, below modals
      display: "flex", flexDirection: "column", gap: 8,
      pointerEvents: "none",            // individual toasts re-enable
      maxWidth: "calc(100vw - 40px)",
    }}>
      {toasts.map((t) => (
        <ChatToast key={t.id} {...t} onDismiss={dismissToast} />
      ))}
    </div>
  );
}
