/**
 * AdminReviewToast — center-top popup for admin caregiver-review actions.
 *
 * Wraps window.fetch (idempotent via window.__aminaAdminReviewToastWrapped)
 * and observes responses to:
 *   - POST /api/v1/caregiver-v2/admin/review/{rid}    (approve / reject / request_info)
 *   - POST /api/v1/caregiver-v2/admin/activate/{rid}  (force activate)
 *   - POST /api/v1/caregiver-v2/admin/suspend/{rid}   (suspend)
 *
 * On a successful response the toast shows the registration_id, the new
 * status, and the action. On 4xx/5xx it shows the server's error
 * message. Auto-dismisses after 5s, click to dismiss earlier.
 *
 * Self-mounting; visible only when AMINA_TOKEN decodes to role=admin
 * (the toast itself is admin-scoped — non-admin users cannot trigger
 * these endpoints anyway, so we just don't render to keep the DOM clean).
 *
 * Also fires `amina:admin-review:done` so AdminNotificationBell can
 * refresh its badge counts the moment an action lands.
 */

import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { adminToken } from "./adminNotificationsApi.js";

const ROOT_ID = "amina-admin-review-toast-root";
const Z_INDEX = 9320;

// ── Fetch interceptor ───────────────────────────────────────────────
function _installFetchInterceptor() {
  if (typeof window === "undefined") return;
  if (window.__aminaAdminReviewToastWrapped) return;
  window.__aminaAdminReviewToastWrapped = true;

  const orig = window.fetch.bind(window);

  window.fetch = async function wrappedFetch(input, init) {
    const url    = typeof input === "string" ? input : (input && input.url) || "";
    const method = ((init && init.method)
                    || (typeof input !== "string" && input && input.method)
                    || "GET").toUpperCase();

    const resp = await orig(input, init);

    try {
      const m = method === "POST"
        && typeof url === "string"
        && url.match(/\/api\/v1\/caregiver-v2\/admin\/(review|activate|suspend)\/([^/?#]+)/);
      if (m) {
        const action = m[1];      // review | activate | suspend
        const rid    = decodeURIComponent(m[2]);
        // Read the body without consuming the original response.
        const clone  = resp.clone();
        clone.json().then((body) => {
          const ok      = resp.ok;
          const status  = body?.status || (ok ? "ok" : `error ${resp.status}`);
          let decision  = "";
          try { decision = init && init.body ? (JSON.parse(init.body).decision || "") : ""; } catch { /* noop */ }
          window.dispatchEvent(new CustomEvent("amina:admin-review:done", {
            detail: { ok, action, decision, rid, status,
                      message: body?.detail?.message || body?.detail || body?.message || "" },
          }));
        }).catch(() => { /* noop */ });
      }
    } catch { /* noop */ }

    return resp;
  };
}

// ── Toast component ─────────────────────────────────────────────────
function AdminReviewToastHost() {
  const [visible, setVisible] = useState(() => Boolean(adminToken()));
  const [toast,   setToast]   = useState(null);  // {ok, title, sub}

  useEffect(() => {
    const tick = () => setVisible(Boolean(adminToken()));
    const onStorage = () => tick();
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    const onDone = (e) => {
      const d = e?.detail || {};
      const ok = !!d.ok;
      let title, sub;
      if (ok) {
        if (d.action === "review") {
          const verb = d.decision === "approve" ? "Approved"
                     : d.decision === "reject"  ? "Rejected"
                     : d.decision === "request_info" ? "Info requested"
                     : "Reviewed";
          title = `${verb} — ${d.rid}`;
          sub   = d.status === "active"
            ? "Caregiver activated. They can now sign in."
            : `Application status: ${d.status}.`;
        } else if (d.action === "activate") {
          title = `Activated — ${d.rid}`;
          sub   = "Caregiver account is live.";
        } else if (d.action === "suspend") {
          title = `Suspended — ${d.rid}`;
          sub   = "Caregiver access revoked.";
        } else {
          title = `Done — ${d.rid}`;
          sub   = `Status: ${d.status}`;
        }
      } else {
        title = `Failed — ${d.rid || ""}`;
        sub   = d.message || `Request did not succeed (${d.status || "unknown"}).`;
      }
      setToast({ ok, title, sub });
      // Tell other admin widgets (e.g. the notification bell) to re-fetch.
      try { window.dispatchEvent(new Event("amina:admin-data:refresh")); } catch { /* noop */ }
    };
    window.addEventListener("amina:admin-review:done", onDone);
    return () => window.removeEventListener("amina:admin-review:done", onDone);
  }, []);

  // Auto-dismiss
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  if (!visible || !toast) return null;

  return (
    <div
      role="alert"
      aria-live="assertive"
      onClick={() => setToast(null)}
      style={{
        position: "fixed", top: 26, left: "50%", transform: "translateX(-50%)",
        zIndex: Z_INDEX,
        minWidth: 320, maxWidth: 480,
        padding: "12px 18px",
        borderRadius: 12, cursor: "pointer",
        background: toast.ok
          ? "linear-gradient(135deg, #16a34a 0%, #15803d 100%)"
          : "linear-gradient(135deg, #dc2626 0%, #991b1b 100%)",
        color: "#fff",
        boxShadow: toast.ok
          ? "0 16px 38px rgba(22,163,74,0.45), 0 0 0 1px rgba(255,255,255,0.10) inset"
          : "0 16px 38px rgba(220,38,38,0.45), 0 0 0 1px rgba(255,255,255,0.10) inset",
        animation: "amina-admin-toast-pop 220ms cubic-bezier(0.22, 1, 0.36, 1)",
        fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
        display: "flex", gap: 12, alignItems: "flex-start",
      }}
    >
      <div style={{ fontSize: 22, lineHeight: 1, marginTop: 1 }}>
        {toast.ok ? "✓" : "⚠"}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 800, letterSpacing: 0.2 }}>
          {toast.title}
        </div>
        <div style={{ fontSize: 12, opacity: 0.92, marginTop: 3, lineHeight: 1.45 }}>
          {toast.sub}
        </div>
      </div>
      <div style={{ fontSize: 11, opacity: 0.75, marginTop: 2 }}>tap to dismiss</div>
      <style>{`
        @keyframes amina-admin-toast-pop {
          from { transform: translate(-50%, -8px); opacity: 0; }
          to   { transform: translate(-50%, 0);    opacity: 1; }
        }
      `}</style>
    </div>
  );
}

// ── Self-mount ──────────────────────────────────────────────────────
function mount() {
  if (typeof window === "undefined") return;
  if (window.__aminaAdminReviewToastMounted) return;
  window.__aminaAdminReviewToastMounted = true;

  _installFetchInterceptor();

  const attach = () => {
    try {
      if (document.getElementById(ROOT_ID)) return;
      const host = document.createElement("div");
      host.id = ROOT_ID;
      document.body.appendChild(host);
      createRoot(host).render(<AdminReviewToastHost />);
    } catch (e) {
      console.warn("AdminReviewToast mount failed:", e);
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", attach);
  } else {
    attach();
  }
}

mount();

export default AdminReviewToastHost;
