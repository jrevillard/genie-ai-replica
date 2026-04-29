/**
 * PolicyReviewBootstrap — self-mounting policy-review overlay.
 *
 * Same additive pattern as CaregiverInboxBootstrap: we don't edit the
 * existing bell/panel components — we wrap window.fetch and listen
 * for the existing inbox traffic.
 *
 * How it integrates with the existing inbox flow
 * ----------------------------------------------
 *   1. GET /api/v1/caregiver/inbox/list → cache the items by inbox_id
 *      so we know which ones are policy reviews (source_id starts
 *      with "policy:").
 *   2. POST /api/v1/caregiver/inbox/{id}/read → on a 2xx response,
 *      look up the cached item. If it's a policy review, dispatch
 *      `amina:policy:open` with { inboxId } so the modal opens just
 *      after the existing bell marks the row read.
 *   3. The modal is the only consumer of /api/v1/policy/*.
 *
 * The user can also dispatch `amina:policy:open` manually from anywhere
 * (`window.dispatchEvent(new CustomEvent("amina:policy:open", { detail: { inboxId } }))`).
 *
 * Mount is idempotent across reloads / HMR.
 */

import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import PolicyReviewModal from "./PolicyReviewModal.jsx";
import { isPolicyReviewItem, hasCaregiverToken } from "./policyReviewApi.js";

const ROOT_ID = "amina-policy-review-root";

// ── Item cache (filled by the fetch interceptor) ─────────────────────
const _itemCache = new Map();   // inbox_id -> { source_id, kind, severity }

function _cacheItem(it) {
  if (!it || !it.inbox_id) return;
  _itemCache.set(it.inbox_id, {
    source_id: it.source_id || "",
    kind:      it.kind || "",
    severity:  it.severity || "",
  });
}

// ── Fetch interceptor ────────────────────────────────────────────────
function _installFetchInterceptor() {
  if (typeof window === "undefined") return;
  if (window.__aminaPolicyReviewFetchWrapped) return;
  window.__aminaPolicyReviewFetchWrapped = true;

  const orig = window.fetch.bind(window);

  window.fetch = async function wrappedFetch(input, init) {
    const url    = typeof input === "string" ? input : (input && input.url) || "";
    const method = ((init && init.method)
                    || (typeof input !== "string" && input && input.method)
                    || "GET").toUpperCase();

    const resp = await orig(input, init);

    try {
      // (1) Cache items returned by the caregiver inbox list.
      if (method === "GET"
          && typeof url === "string"
          && url.indexOf("/api/v1/caregiver/inbox/list") !== -1
          && resp && resp.ok) {
        // Clone before reading — caller still needs the body.
        const clone = resp.clone();
        clone.json().then((body) => {
          const items = (body && body.items) || [];
          for (const it of items) _cacheItem(it);
        }).catch(() => { /* noop */ });
      }

      // (2) Patient inbox list — cached too, in case admin (non-caregiver)
      // accounts ever review their own policy items via the patient bell.
      if (method === "GET"
          && typeof url === "string"
          && url.indexOf("/api/v1/inbox/list") !== -1
          && resp && resp.ok) {
        const clone = resp.clone();
        clone.json().then((body) => {
          const items = (body && body.items) || [];
          for (const it of items) _cacheItem(it);
        }).catch(() => { /* noop */ });
      }

      // (3) Inbox-read POST — if the read item is a policy review,
      // open the modal.
      if (method === "POST"
          && typeof url === "string"
          && (url.indexOf("/api/v1/caregiver/inbox/") !== -1
              || url.indexOf("/api/v1/inbox/") !== -1)
          && /\/inbox\/[^/]+\/read\b/.test(url)
          && resp && resp.ok) {
        const m = url.match(/\/inbox\/([^/]+)\/read\b/);
        const inboxId = m ? decodeURIComponent(m[1]) : "";
        const cached = inboxId ? _itemCache.get(inboxId) : null;
        if (cached && isPolicyReviewItem(cached)) {
          // Defer slightly so the bell's optimistic state-update
          // settles before we render the modal on top.
          setTimeout(() => {
            try {
              window.dispatchEvent(new CustomEvent("amina:policy:open",
                                                    { detail: { inboxId } }));
            } catch { /* noop */ }
          }, 60);
        }
      }
    } catch { /* noop — never break the original call */ }

    return resp;
  };
}

// ── Host component ───────────────────────────────────────────────────
function PolicyReviewHost() {
  const [open,    setOpen]    = useState(false);
  const [inboxId, setInboxId] = useState("");

  useEffect(() => {
    const onOpen = (e) => {
      const id = e?.detail?.inboxId || "";
      if (!id) return;
      // Only show for caregiver sessions. Patient tokens hitting the
      // patient inbox shouldn't see the caregiver-PIN flow.
      if (!hasCaregiverToken()) return;
      setInboxId(id);
      setOpen(true);
    };
    window.addEventListener("amina:policy:open", onOpen);
    return () => window.removeEventListener("amina:policy:open", onOpen);
  }, []);

  if (!open) return null;
  // key={inboxId} forces a fresh mount each time the user opens a
  // different policy item — so the modal's internal state (loading
  // phase, signature, PIN) starts clean without any reset effects.
  return (
    <PolicyReviewModal
      key={inboxId}
      inboxId={inboxId}
      onClose={() => { setOpen(false); setInboxId(""); }}
    />
  );
}

// ── Self-mount ───────────────────────────────────────────────────────
function mount() {
  if (typeof window === "undefined") return;
  if (window.__aminaPolicyReviewMounted) return;
  window.__aminaPolicyReviewMounted = true;

  _installFetchInterceptor();

  const attach = () => {
    try {
      if (document.getElementById(ROOT_ID)) return;
      const host = document.createElement("div");
      host.id = ROOT_ID;
      document.body.appendChild(host);
      createRoot(host).render(<PolicyReviewHost />);
    } catch (e) {
      console.warn("PolicyReviewBootstrap mount failed:", e);
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", attach);
  } else {
    attach();
  }
}

mount();

export default PolicyReviewHost;
