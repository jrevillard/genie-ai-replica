/**
 * CaregiverPrivacyReconsentBootstrap — Phase 5 + Phase 9 v3 popup-fix.
 *
 * Self-mounting side-effect import. Adding
 *   import "./CaregiverPrivacyReconsentBootstrap.jsx";
 * to main.jsx wires a re-consent prompt for caregivers whose stored
 * consent is missing or older than the current notice version.
 *
 * --------------------------------------------------------------------
 * Phase 9 v3 popup-behaviour rules (this revision)
 * --------------------------------------------------------------------
 * The Phase 5 implementation auto-popped the modal whenever
 * `has_current_consent === false`, regardless of whether enforcement
 * was actually on. That meant every CHW who had not yet re-accepted a
 * notice-version bump saw a modal on every browser session — even
 * though the backend was happy to serve them in warn-only mode. The
 * fix:
 *
 *   AUTO-POPUP ONLY ON THE CANONICAL ENFORCEMENT 403 EVENT.
 *
 * That event (`amina:caregiver-consent-required`) is dispatched by
 * `auth/caregiverConsent403Interceptor.js` when a gated caregiver
 * route returns the canonical 403 + `code: caregiver_privacy_consent_required`
 * shape. It only fires when:
 *   - the backend has `AMINA_CAREGIVER_PRIVACY_REQUIRED=true`, AND
 *   - the caregiver has no current-version consent on file, AND
 *   - the caregiver actually called a gated route.
 *
 * Plain warn-only stale (required_flag=false + has_current_consent=false)
 * never auto-pops. The non-blocking banner inside the caregiver
 * portal's Privacy & Data section is the warn-only surface; the
 * caregiver can review the notice from there at their own pace.
 *
 * --------------------------------------------------------------------
 * Storage keys (Phase 9 v3 — caregiver+version scoped)
 * --------------------------------------------------------------------
 * The single global session-only flag (`amina_caregiver_reconsent_dismissed`)
 * was wrong:
 *   - it leaked across caregivers on a shared device,
 *   - it didn't reset when the notice version bumped, and
 *   - it cleared on every browser close, so the modal popped again
 *     on the next session even after the user explicitly dismissed.
 *
 * Replaced with:
 *
 *   localStorage  amina:caregiver_privacy:dismissed:<tokenHash>:<noticeVersion>
 *
 * - `tokenHash` is a 32-bit FNV-1a hash of the JWT held in `cg_token`.
 *   Different caregivers on the same device → different hash → no
 *   cross-caregiver leak. Hashing means we never write the raw token
 *   to localStorage.
 * - `noticeVersion` is the current notice version from
 *   /api/v1/caregiver/privacy/version (or its embedded copy in the
 *   /privacy/status response). When the version bumps, the key
 *   stops matching and the dismissed flag is naturally invalidated.
 * - Persisted in localStorage (not sessionStorage) so the dismissal
 *   survives a browser restart — the spec is explicit that the
 *   modal must not reappear repeatedly after a dismissal.
 *
 * The key value is the literal "1" — never the token, name, phone,
 * signature, or consent payload.
 *
 * --------------------------------------------------------------------
 * Component (Phase 9 v3 — uses the new stepper)
 * --------------------------------------------------------------------
 * The bootstrap now mounts <CaregiverPrivacyStepper readOnly={false}>
 * for the actual signing flow (when enforcement-403 fires). The old
 * Phase 3 CaregiverPrivacyConsentStep is no longer used by the
 * bootstrap — that component is still imported by the signup wizard
 * (Phase 4) until that surface is separately migrated.
 *
 * --------------------------------------------------------------------
 * Privacy posture (unchanged from Phase 5)
 * --------------------------------------------------------------------
 *   - Never console-logs the typed signature, the consent payload, or
 *     anything resembling PHI.
 *   - Reads `cg_info` for the caregiver name (used by the privacy
 *     step's signature-match check). Name is treated as PHI-adjacent
 *     and never written to logs or new storage keys.
 */

import { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import CaregiverPrivacyStepper from "./CaregiverPrivacyStepper.jsx";
// Phase 6.7 — install the 403 interceptor as a side-effect import. It
// wraps window.fetch and fires `amina:caregiver-consent-required` on
// any caregiver-side 403/code combo. The bootstrap listens for that
// event below and opens the signing modal.
import "./auth/caregiverConsent403Interceptor.js";


// ── Constants ────────────────────────────────────────────────────────
const ROOT_ID         = "amina-caregiver-reconsent-root";
const TOKEN_KEY       = "cg_token";
const INFO_KEY        = "cg_info";
const POLL_MS         = 1500;

// Phase 9 v3 — scoped dismissal key prefix. The full key looks like:
//   amina:caregiver_privacy:dismissed:<tokenHash>:<noticeVersion>
const DISMISS_PREFIX  = "amina:caregiver_privacy:dismissed";

const API = ((typeof window !== "undefined" && window.AMINA_API)
  || "http://localhost:8000").replace(/\/+$/, "");


// ── Best-effort storage readers (never throw) ────────────────────────
function _readToken() {
  try { return localStorage.getItem(TOKEN_KEY) || ""; } catch { return ""; }
}

// ── Caregiver-id hash (FNV-1a on the token; 32-bit hex) ─────────────
// We hash the token itself rather than the caregiver name / phone
// because the token is already a high-entropy non-PHI value. The hash
// output is a deterministic 8-char hex string with no preimage path
// back to the token — sufficient to disambiguate caregivers on a
// shared device without putting PHI into localStorage.
function _tokenHash(token) {
  if (!token) return "anon";
  let h = 0x811c9dc5;
  for (let i = 0; i < token.length; i++) {
    h ^= token.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // Force unsigned + 8-char hex.
  return (h >>> 0).toString(16).padStart(8, "0");
}

function _dismissalKey(token, noticeVersion) {
  const h = _tokenHash(token);
  const v = (noticeVersion || "unknown").toString();
  return `${DISMISS_PREFIX}:${h}:${v}`;
}

function _wasDismissed(token, noticeVersion) {
  try {
    const k = _dismissalKey(token, noticeVersion);
    return localStorage.getItem(k) === "1";
  } catch { return false; }
}

function _markDismissed(token, noticeVersion) {
  try {
    const k = _dismissalKey(token, noticeVersion);
    localStorage.setItem(k, "1");
  } catch { /* noop */ }
}

function _clearDismissed(token, noticeVersion) {
  try {
    const k = _dismissalKey(token, noticeVersion);
    localStorage.removeItem(k);
  } catch { /* noop */ }
}


// ── Network — both calls fail-open ───────────────────────────────────
async function _fetchStatus(token) {
  if (!token) return null;
  try {
    const r = await fetch(`${API}/api/v1/caregiver/privacy/status`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}


// ── Host: drives the modal ───────────────────────────────────────────
//
// Phase 9 v3 contract:
//   - `mode` is one of "idle" | "signing".
//   - "idle": no modal rendered. This is the default. The bootstrap
//     stays idle on plain warn-only stale (required_flag=false). The
//     non-blocking banner in CaregiverPortal.jsx Privacy & Data
//     section is the warn-only surface.
//   - "signing": the canonical enforcement-403 event has fired (or a
//     status response carrying required_flag=true reported the
//     caregiver as stale). Open the signing stepper.
function ReconsentHost() {
  const [token,         setToken]         = useState(_readToken());
  const [mode,          setMode]          = useState("idle");
  const [noticeVersion, setNoticeVersion] = useState("");

  // ── Token watcher (login/logout, tab events) ───────────────────────
  useEffect(() => {
    const tick = () => setToken(_readToken());
    const t = setInterval(tick, POLL_MS);
    const onStorage = (e) => {
      if (!e.key || e.key === TOKEN_KEY) tick();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("amina:auth-changed", tick);
    return () => {
      clearInterval(t);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("amina:auth-changed", tick);
    };
  }, []);

  // ── Status read on token change (used to learn the notice version
  //     and to honour required_flag=true on first paint) ────────────
  useEffect(() => {
    if (!token) {
      // Token cleared (logout). Defer the state reset via rAF so we
      // don't trip the React 19 react-hooks/set-state-in-effect rule.
      const rafId = requestAnimationFrame(() => {
        setMode("idle");
        setNoticeVersion("");
      });
      return () => cancelAnimationFrame(rafId);
    }
    let cancelled = false;
    (async () => {
      const s = await _fetchStatus(token);
      if (cancelled) return;
      const v = (s && s.notice_version) || "";
      setNoticeVersion(v);
      // Phase 9 v3 — only auto-pop when enforcement is genuinely on
      // AND the caregiver is stale AND they haven't already dismissed
      // this version. Plain warn-only stale stays idle.
      if (s
          && s.has_current_consent === false
          && s.required_flag === true
          && !_wasDismissed(token, v)) {
        setMode("signing");
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  // ── Hard-403 enforcement handler ───────────────────────────────────
  // The fetch interceptor fires `amina:caregiver-consent-required`
  // when a gated route returns the canonical 403. That's the
  // canonical signal that enforcement is on AND this caregiver is
  // stale AND a route was just blocked — the only remaining auto-pop
  // path. Clearing the dismissed flag forces the modal to re-open
  // even if the caregiver clicked "Remind me later" earlier.
  useEffect(() => {
    const onConsentRequired = () => {
      const tok = _readToken();
      if (!tok) return;
      // Best-effort fetch of the current notice version so the
      // dismissal key clears the right slot. Fail-open.
      (async () => {
        const s = await _fetchStatus(tok);
        const v = (s && s.notice_version) || noticeVersion || "";
        setNoticeVersion(v);
        _clearDismissed(tok, v);
        setMode("signing");
      })();
    };
    window.addEventListener("amina:caregiver-consent-required", onConsentRequired);
    return () => {
      window.removeEventListener("amina:caregiver-consent-required", onConsentRequired);
    };
  }, [noticeVersion]);

  // ── Stepper callbacks ─────────────────────────────────────────────
  const onSigned = useCallback(() => {
    // Backend created (or no-op'd) the new versioned record.
    // Acceptance is durable, not a "remind later"; clear any
    // dismissal flag for this version so a future re-pop works.
    _clearDismissed(token, noticeVersion);
    setMode("idle");
  }, [token, noticeVersion]);

  const onRemindLater = useCallback(() => {
    // Persist a version-scoped dismissal so the modal does NOT
    // re-pop on the next session for this notice version.
    _markDismissed(token, noticeVersion);
    setMode("idle");
  }, [token, noticeVersion]);

  const onClose = useCallback(() => {
    // Plain close (X button / backdrop). Treat the same as
    // "Remind me later" — we never want to re-pop in a tight loop.
    _markDismissed(token, noticeVersion);
    setMode("idle");
  }, [token, noticeVersion]);

  if (mode !== "signing") return null;

  return (
    <CaregiverPrivacyStepper
      readOnly={false}
      authToken={token}
      apiBase={API}
      onClose={onClose}
      onSigned={onSigned}
      onRemindLater={onRemindLater}
      accent="baobab"
    />
  );
}


// ── Self-mount ───────────────────────────────────────────────────────
function mount() {
  if (typeof window === "undefined") return;
  if (window.__aminaCaregiverReconsentMounted) return;
  window.__aminaCaregiverReconsentMounted = true;

  const attach = () => {
    try {
      if (document.getElementById(ROOT_ID)) return;
      const host = document.createElement("div");
      host.id = ROOT_ID;
      document.body.appendChild(host);
      createRoot(host).render(<ReconsentHost />);
    } catch (e) {
      console.warn("CaregiverPrivacyReconsentBootstrap mount failed:", e);
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", attach);
  } else {
    attach();
  }
}

mount();

export default ReconsentHost;
