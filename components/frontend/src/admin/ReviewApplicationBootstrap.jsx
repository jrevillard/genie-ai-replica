/**
 * ReviewApplicationBootstrap — wires the centered review modal into
 * the People applications table without editing People.jsx.
 *
 * How it works
 * ------------
 * 1. Self-mounts a React root containing <ReviewApplicationHost />.
 * 2. Installs a document capture-phase click listener that fires
 *    BEFORE React's root delegation. When the user clicks the green
 *    review button (`button.cr-row-action[title="Review & Approve"]`),
 *    we:
 *      - call e.stopImmediatePropagation() + e.preventDefault() so
 *        React's setExpanded never runs, and the inline panel below
 *        the table is never rendered;
 *      - extract the registration_id from the row's first cell
 *        (`td.cr-cell-id`);
 *      - dispatch `amina:approve-modal:open` with { rid, returnFocusEl }.
 *
 * 3. <ReviewApplicationHost /> listens for that event and mounts the
 *    centered modal. On close, focus returns to the originating button.
 *
 * The reject button is left unchanged — its existing prompt() flow is
 * already a modal-style interaction. The user can also choose Reject
 * from inside the new modal via a collapsed "Reject this application
 * instead" section.
 */

import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import ReviewApplicationModal from "./ReviewApplicationModal.jsx";

const ROOT_ID = "amina-review-modal-root";
const APPROVE_BTN_SELECTOR = 'button.cr-row-action[title="Review & Approve"]';
const ROW_ID_SELECTOR      = 'td.cr-cell-id';

function _installClickInterceptor() {
  if (typeof document === "undefined") return;
  if (window.__aminaReviewModalClickInstalled) return;
  window.__aminaReviewModalClickInstalled = true;

  document.addEventListener("click", (e) => {
    const btn = e.target?.closest?.(APPROVE_BTN_SELECTOR);
    if (!btn) return;

    // Locate the registration_id from the first cell of the row.
    const tr  = btn.closest("tr");
    const idCell = tr?.querySelector(ROW_ID_SELECTOR);
    const rid = (idCell?.textContent || "").trim();
    if (!rid || rid === "—") return;

    // Block the inline panel from expanding.
    e.stopImmediatePropagation();
    e.preventDefault();

    try {
      window.dispatchEvent(new CustomEvent("amina:approve-modal:open", {
        detail: { rid, returnFocusEl: btn },
      }));
    } catch { /* noop */ }
  }, true);  // capture phase — fires before React's root listener
}

// ── Host component ──────────────────────────────────────────────
function ReviewApplicationHost() {
  const [state, setState] = useState({ open: false, rid: "", returnFocusEl: null });

  useEffect(() => {
    const onOpen = (e) => {
      const d = e?.detail || {};
      if (!d.rid) return;
      setState({ open: true, rid: d.rid, returnFocusEl: d.returnFocusEl || null });
    };
    window.addEventListener("amina:approve-modal:open", onOpen);
    return () => window.removeEventListener("amina:approve-modal:open", onOpen);
  }, []);

  if (!state.open) return null;
  return (
    <ReviewApplicationModal
      key={state.rid}
      rid={state.rid}
      returnFocusEl={state.returnFocusEl}
      onClose={() => setState({ open: false, rid: "", returnFocusEl: null })}
    />
  );
}

// ── Self-mount ──────────────────────────────────────────────────
function mount() {
  if (typeof window === "undefined") return;
  if (window.__aminaReviewModalMounted) return;
  window.__aminaReviewModalMounted = true;

  _installClickInterceptor();

  const attach = () => {
    try {
      if (document.getElementById(ROOT_ID)) return;
      const host = document.createElement("div");
      host.id = ROOT_ID;
      document.body.appendChild(host);
      createRoot(host).render(<ReviewApplicationHost />);
    } catch (e) {
      console.warn("ReviewApplicationBootstrap mount failed:", e);
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", attach);
  } else {
    attach();
  }
}

mount();

export default ReviewApplicationHost;
