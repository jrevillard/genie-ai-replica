/**
 * CaregiverPrivacyConsentStep — Phase 3 (standalone; not yet wired into the wizard).
 *
 * Renders the AMINA caregiver privacy notice and captures the user's
 * consent. This component DOES NOT call the backend; it only emits a
 * payload via `onComplete(payload)` for the parent (the wizard, in
 * Phase 4) to dispatch.
 *
 * Content source of truth:
 *   components/frontend/src/content/CAREGIVER_PRIVACY_NOTICE.js
 *
 * Behavioural contract (from Phase 3 spec):
 *   - Renders the full caregiver notice OR the simplified scout notice
 *     depending on `role`.
 *   - Renders the role-specific section text when role is recognised.
 *   - Renders the Mandinka summary behind a toggle (sticky-once-seen).
 *   - Renders the cross-border notice + the consent-withdrawal notice.
 *   - Scrollable notice container with sticky scroll-unlock: once the
 *     user has reached the bottom (any visit), `scroll_completed`
 *     stays true for the rest of the component session.
 *   - The 5 required checkboxes are disabled until scroll-unlocked.
 *   - The submit button is disabled until:
 *         scroll_completed === true
 *       AND all 5 checkboxes are checked
 *       AND the typed digital signature matches `caregiverName`
 *           case-insensitively
 *       AND (role === "scout") implies guardian_consent === true
 *           AND guardian_signature is non-empty
 *
 * Privacy posture:
 *   - The component never console.logs the signature or any PHI.
 *   - The emitted payload is the minimum the backend needs (see
 *     Phase 2 service `caregiver_privacy_consent.py`). Hashing of the
 *     signature happens server-side.
 *
 * Phase 3 deliberate non-goals:
 *   - Not imported by the wizard yet (Phase 4 wires it).
 *   - Does not POST to /api/v1/caregiver/privacy/consent (parent wires).
 *   - Does not handle policy version-mismatch or re-consent flow
 *     (Phase 5).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  CAREGIVER_PRIVACY_NOTICE,
  SCOUT_PRIVACY_NOTICE,
  CAREGIVER_PRIVACY_NOTICE_VERSION,
  CONSENT_WITHDRAWAL_NOTICE,
  CROSS_BORDER_NOTICE,
  MINOR_HANDLING_POLICY,
} from "./content/CAREGIVER_PRIVACY_NOTICE.js";

// ── Inline style tokens (match CaregiverRegistrationWizard.jsx) ─────
const T = {
  bg:         "rgba(15, 23, 42, 0.85)",
  card:       "rgba(15, 23, 42, 0.55)",
  cardSolid:  "#0f172a",
  border:     "rgba(148, 163, 184, 0.30)",
  borderSoft: "rgba(148, 163, 184, 0.18)",
  text:       "#f1f5f9",
  muted:      "#94a3b8",
  subtle:     "#64748b",
  accent:     "#6366f1",
  accentBg:   "rgba(99, 102, 241, 0.12)",
  ok:         "#10b981",
  okBg:       "rgba(16, 185, 129, 0.12)",
  warn:       "#f59e0b",
  warnBg:     "rgba(245, 158, 11, 0.10)",
  danger:     "#ef4444",
};

const S = {
  wrap: {
    background: T.bg, color: T.text, fontFamily: "inherit",
    padding: "20px 22px", borderRadius: 14,
    border: `1px solid ${T.border}`,
    boxShadow: "0 18px 40px rgba(2, 6, 23, 0.45)",
  },
  header: {
    display: "flex", alignItems: "baseline", justifyContent: "space-between",
    gap: 12, marginBottom: 4,
  },
  title: { fontSize: 18, fontWeight: 800, lineHeight: 1.25 },
  badge: {
    fontSize: 11, fontWeight: 700, letterSpacing: 0.4,
    padding: "3px 8px", borderRadius: 6,
    background: T.accentBg, color: T.accent,
    border: `1px solid ${T.border}`,
  },
  sub:  { fontSize: 12, color: T.muted, marginTop: 2 },

  govLaw: {
    margin: "10px 0 14px", padding: "8px 12px", borderRadius: 8,
    background: T.card, border: `1px solid ${T.borderSoft}`,
    fontSize: 12, color: T.muted, lineHeight: 1.5,
  },

  scrollBox: {
    maxHeight: 320, overflowY: "auto",
    padding: "14px 16px", borderRadius: 10,
    background: T.cardSolid, border: `1px solid ${T.border}`,
    fontSize: 13, lineHeight: 1.55, color: T.text,
    whiteSpace: "pre-wrap",
  },
  sectionTitle: {
    fontSize: 13, fontWeight: 800, marginTop: 14, marginBottom: 4,
    color: T.text,
  },
  scrollHint: {
    marginTop: 6, fontSize: 12, color: T.muted, fontStyle: "italic",
  },
  scrollOk: {
    marginTop: 6, fontSize: 12, color: T.ok, fontWeight: 700,
  },

  noticeBlock: {
    margin: "12px 0", padding: "10px 12px", borderRadius: 8,
    background: T.warnBg, border: `1px solid ${T.warn}`,
    fontSize: 12, color: T.text, lineHeight: 1.55,
  },
  noticeBlockOk: {
    margin: "12px 0", padding: "10px 12px", borderRadius: 8,
    background: T.okBg, border: `1px solid ${T.ok}`,
    fontSize: 12, color: T.text, lineHeight: 1.55,
  },

  toggle: {
    marginTop: 8, padding: "8px 12px", borderRadius: 8,
    background: "transparent", color: T.accent,
    border: `1px solid ${T.border}`,
    fontSize: 12, fontWeight: 700, cursor: "pointer",
  },
  mandinkaBox: {
    marginTop: 8, padding: "10px 12px", borderRadius: 8,
    background: T.accentBg, border: `1px solid ${T.accent}`,
    fontSize: 12, color: T.text, whiteSpace: "pre-wrap",
    lineHeight: 1.55,
  },

  checkboxRow: {
    display: "flex", alignItems: "flex-start", gap: 10,
    marginTop: 10, padding: "10px 12px", borderRadius: 8,
    background: T.card, border: `1px solid ${T.borderSoft}`,
  },
  checkbox: { marginTop: 3, cursor: "pointer", flexShrink: 0 },
  checkboxLabel: { fontSize: 13, lineHeight: 1.5, color: T.text },
  checkboxLabelDim: { fontSize: 13, lineHeight: 1.5, color: T.subtle },

  signatureRow: { marginTop: 16 },
  signatureLabel: {
    fontSize: 12, fontWeight: 700, color: T.muted,
    display: "block", marginBottom: 6,
  },
  signatureInput: {
    width: "100%", boxSizing: "border-box",
    padding: "10px 12px", fontSize: 14, color: T.text,
    background: T.cardSolid, border: `1px solid ${T.border}`,
    borderRadius: 8, outline: "none", fontFamily: "inherit",
  },
  signatureHint: { marginTop: 6, fontSize: 11, color: T.muted },
  signatureMatch: { marginTop: 6, fontSize: 11, color: T.ok, fontWeight: 700 },
  signatureMismatch:
    { marginTop: 6, fontSize: 11, color: T.danger, fontWeight: 700 },

  guardianBlock: {
    marginTop: 16, padding: "12px 14px", borderRadius: 10,
    background: T.warnBg, border: `1px solid ${T.warn}`,
  },
  guardianTitle: {
    fontSize: 12, fontWeight: 800, color: T.warn,
    textTransform: "uppercase", letterSpacing: 0.5,
    marginBottom: 8,
  },

  actions: {
    marginTop: 18, display: "flex", gap: 10, justifyContent: "flex-end",
    flexWrap: "wrap",
  },
  btnPrimary: (enabled) => ({
    padding: "11px 18px", borderRadius: 9,
    background: enabled
      ? "linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)"
      : "rgba(99, 102, 241, 0.30)",
    color: "#fff", border: "none",
    fontSize: 13, fontWeight: 800,
    cursor: enabled ? "pointer" : "not-allowed",
    opacity: enabled ? 1 : 0.55,
    boxShadow: enabled ? "0 8px 18px rgba(99, 102, 241, 0.30)" : "none",
  }),
  btnGhost: {
    padding: "11px 16px", borderRadius: 9,
    background: "transparent", color: T.muted,
    border: `1px solid ${T.border}`,
    fontSize: 12, fontWeight: 700, cursor: "pointer",
  },

  whyDisabled: {
    marginTop: 8, fontSize: 12, color: T.muted, textAlign: "right",
  },
};

const ROLE_LABEL = {
  vhw:    "Village Health Worker",
  cbc:    "Community Birth Companion",
  chn:    "Community Health Nurse",
  tba:    "Traditional Birth Attendant",
  family: "Family caregiver",
  scout:  "Youth Health Scout",
  alkalo: "Alkalo",
};


// ── Component ────────────────────────────────────────────────────────
export default function CaregiverPrivacyConsentStep({
  caregiverName,
  role,
  onComplete,
  onCancel,
  disabled = false,
  initialMandinkaVisible = false,
  className,
}) {
  const isScout = (role || "").toLowerCase() === "scout";
  const notice = isScout ? SCOUT_PRIVACY_NOTICE : CAREGIVER_PRIVACY_NOTICE;

  // ── State ────────────────────────────────────────────────────────
  const [scrollCompleted, setScrollCompleted] = useState(false);
  const [mandinkaVisible, setMandinkaVisible] = useState(
    Boolean(initialMandinkaVisible),
  );
  // mandinkaViewed is sticky: once true, never goes back to false even
  // if the user re-collapses the section.
  const [mandinkaViewed, setMandinkaViewed] = useState(
    Boolean(initialMandinkaVisible),
  );
  const [checkboxes, setCheckboxes] = useState(() =>
    Object.fromEntries(
      CAREGIVER_PRIVACY_NOTICE.consent_checkboxes.map((c) => [c.id, false]),
    ),
  );
  const [signature, setSignature] = useState("");
  const [guardianConsent, setGuardianConsent] = useState(false);
  const [guardianSignature, setGuardianSignature] = useState("");

  const scrollRef = useRef(null);

  // ── Sticky scroll-unlock detector ────────────────────────────────
  const handleScroll = useCallback(() => {
    if (scrollCompleted) return;
    const el = scrollRef.current;
    if (!el) return;
    const remaining = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (remaining < 30) setScrollCompleted(true);
  }, [scrollCompleted]);

  // If the notice fits without overflow (large viewport, short content),
  // unlock immediately so the user is not stuck. The setState is
  // deferred via requestAnimationFrame so it does NOT happen
  // synchronously inside the effect body — that would trigger the
  // React 19 react-hooks/set-state-in-effect rule and cause an extra
  // render pass. rAF schedules it for after the current paint, which
  // is exactly the recommended pattern for "react to a measured DOM
  // dimension".
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;
    if (el.scrollHeight - el.clientHeight >= 4) return undefined;
    const id = requestAnimationFrame(() => setScrollCompleted(true));
    return () => cancelAnimationFrame(id);
  }, []);

  // ── Derived state ────────────────────────────────────────────────
  const allChecked = useMemo(
    () =>
      CAREGIVER_PRIVACY_NOTICE.consent_checkboxes.every(
        (c) => checkboxes[c.id] === true,
      ),
    [checkboxes],
  );

  const signatureMatches = useMemo(() => {
    const want = (caregiverName || "").trim().toLowerCase();
    const got  = (signature || "").trim().toLowerCase();
    return want.length > 0 && got.length > 0 && got === want;
  }, [caregiverName, signature]);

  const guardianBlockSatisfied = useMemo(() => {
    if (!isScout) return true;
    return (
      guardianConsent === true &&
      (guardianSignature || "").trim().length > 0
    );
  }, [isScout, guardianConsent, guardianSignature]);

  const canSubmit = !disabled
    && scrollCompleted
    && allChecked
    && signatureMatches
    && guardianBlockSatisfied;

  // Human-readable hint for why submit is disabled (no PHI).
  const whyDisabled = useMemo(() => {
    if (disabled) return "This step is disabled by the parent.";
    if (!scrollCompleted) return "Please scroll to the end of the notice.";
    if (!allChecked) return "Please tick all 5 acknowledgements.";
    if (!signatureMatches)
      return "Type your full registration name to acknowledge.";
    if (!guardianBlockSatisfied)
      return "Guardian acknowledgement is required for the Scout role.";
    return "";
  }, [disabled, scrollCompleted, allChecked, signatureMatches, guardianBlockSatisfied]);

  // ── Handlers ─────────────────────────────────────────────────────
  const toggleCheckbox = (id) => {
    if (!scrollCompleted || disabled) return;
    setCheckboxes((p) => ({ ...p, [id]: !p[id] }));
  };

  const toggleMandinka = () => {
    setMandinkaVisible((p) => {
      const next = !p;
      if (next) setMandinkaViewed(true);
      return next;
    });
  };

  const handleSubmit = () => {
    if (!canSubmit) return;
    // Privacy: do NOT log the payload (it contains the typed signature,
    // which is PHI-adjacent). The parent will POST it to the backend
    // where it is hashed before storage (see Phase 2 service).
    const payload = {
      notice_version:        CAREGIVER_PRIVACY_NOTICE_VERSION,
      role:                  role || "",
      checkboxes_accepted:   true,
      checkbox_count:        CAREGIVER_PRIVACY_NOTICE.consent_checkboxes.length,
      digital_signature:     (signature || "").trim(),
      guardian_consent:      isScout ? Boolean(guardianConsent) : false,
      guardian_signature:    isScout ? (guardianSignature || "").trim() : "",
      mandinka_viewed:       Boolean(mandinkaViewed),
      scroll_completed:      Boolean(scrollCompleted),
      method:                "app",
    };
    if (typeof onComplete === "function") onComplete(payload);
  };

  // ── Render: notice body ──────────────────────────────────────────
  // We render either the simplified scout content or the full
  // caregiver sections. The role-specific section (only on the full
  // caregiver path) renders ONLY the entry matching the chosen role.
  const renderNoticeBody = () => {
    if (isScout) {
      return (
        <div>
          <div style={S.sectionTitle}>{notice.title}</div>
          <div>{notice.content}</div>
        </div>
      );
    }
    return (
      <div>
        {CAREGIVER_PRIVACY_NOTICE.sections.map((section) => {
          if (section.id === "role_specific") {
            const key = (role || "").toLowerCase();
            const roleText = section.role_content?.[key];
            if (!roleText) return null; // no role yet — skip
            return (
              <div key={section.id}>
                <div style={S.sectionTitle}>
                  {section.title}{" "}
                  <span style={{ color: T.muted, fontWeight: 600 }}>
                    ({ROLE_LABEL[key] || key})
                  </span>
                </div>
                <div>{roleText}</div>
              </div>
            );
          }
          return (
            <div key={section.id}>
              <div style={S.sectionTitle}>{section.title}</div>
              <div>{section.content}</div>
            </div>
          );
        })}
      </div>
    );
  };

  // ── Render ───────────────────────────────────────────────────────
  return (
    <div className={className} style={S.wrap}>
      {/* Header */}
      <div style={S.header}>
        <div>
          <div style={S.title}>{notice.title}</div>
          <div style={S.sub}>
            Version {notice.version} · Effective {notice.effective_date} ·
            Jurisdiction {notice.jurisdiction}
          </div>
        </div>
        <span style={S.badge}>Required</span>
      </div>

      {/* Governing law (read-only) */}
      <div style={S.govLaw}>
        <div style={{ fontWeight: 800, color: T.text, marginBottom: 4 }}>
          Governing law
        </div>
        {notice.governing_law.map((law, i) => (
          <div key={i}>· {law}</div>
        ))}
      </div>

      {/* Scrollable notice body */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        style={S.scrollBox}
        tabIndex={0}
        role="region"
        aria-label="Privacy notice body — scroll to the end to enable the acknowledgements"
      >
        {renderNoticeBody()}
      </div>

      {scrollCompleted ? (
        <div style={S.scrollOk}>✓ You have read the full notice.</div>
      ) : (
        <div style={S.scrollHint}>
          Scroll to the end of the notice to enable the acknowledgements ↓
        </div>
      )}

      {/* Mandinka toggle (sticky-viewed) */}
      {/* TODO: Mandinka native-speaker review before pilot */}
      <button
        type="button"
        onClick={toggleMandinka}
        style={S.toggle}
        aria-expanded={mandinkaVisible ? "true" : "false"}
      >
        {mandinkaVisible
          ? "Hide Mandinka summary"
          : "Read in Mandinka / Mandinka la karaŋ"}
      </button>
      {mandinkaVisible && (
        <div style={S.mandinkaBox} aria-live="polite">
          {notice.mandinka_summary}
        </div>
      )}

      {/* Cross-border processing notice */}
      <div style={S.noticeBlock}>
        <div style={{ fontWeight: 800, marginBottom: 4 }}>
          Cross-border processing
        </div>
        {CROSS_BORDER_NOTICE}
      </div>

      {/* Consent withdrawal notice */}
      <div style={S.noticeBlockOk}>
        <div style={{ fontWeight: 800, marginBottom: 4 }}>
          You can withdraw your consent
        </div>
        {CONSENT_WITHDRAWAL_NOTICE}
      </div>

      {/* Children / minors note (compact) */}
      <div style={{ ...S.govLaw, marginTop: 12 }}>
        <div style={{ fontWeight: 800, color: T.text, marginBottom: 4 }}>
          Children and minors
        </div>
        <div>
          AMINA does not impose an age limit on receiving health support.
          Self-managed accounts are intended for users{" "}
          <strong>{MINOR_HANDLING_POLICY.self_managed_account_minimum_age}+</strong>;
          users under{" "}
          <strong>{MINOR_HANDLING_POLICY.unaccompanied_self_consent_minimum_age}</strong>{" "}
          require an approved adult, caregiver, or health-worker workflow.
          Pending Gambian legal review.
        </div>
      </div>

      {/* 5 required acknowledgements */}
      <div style={{ marginTop: 18 }}>
        <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 6 }}>
          Acknowledgements (all required)
        </div>
        {CAREGIVER_PRIVACY_NOTICE.consent_checkboxes.map((c) => {
          const checked = Boolean(checkboxes[c.id]);
          const enabled = scrollCompleted && !disabled;
          return (
            <label
              key={c.id}
              style={S.checkboxRow}
              title={
                enabled
                  ? ""
                  : "Please scroll to the end of the notice first"
              }
            >
              <input
                type="checkbox"
                checked={checked}
                disabled={!enabled}
                onChange={() => toggleCheckbox(c.id)}
                style={S.checkbox}
                aria-describedby={`cgconsent-cb-${c.id}-text`}
              />
              <span
                id={`cgconsent-cb-${c.id}-text`}
                style={enabled ? S.checkboxLabel : S.checkboxLabelDim}
              >
                {c.text}
              </span>
            </label>
          );
        })}
      </div>

      {/* Digital signature */}
      <div style={S.signatureRow}>
        <label style={S.signatureLabel} htmlFor="cgconsent-signature">
          Type your full name to acknowledge this agreement
        </label>
        <input
          id="cgconsent-signature"
          type="text"
          value={signature}
          onChange={(e) => setSignature(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          disabled={disabled || !scrollCompleted}
          style={S.signatureInput}
          aria-describedby="cgconsent-signature-hint"
        />
        {caregiverName ? (
          signatureMatches ? (
            <div style={S.signatureMatch} id="cgconsent-signature-hint">
              ✓ Matches your registration name.
            </div>
          ) : (
            <div style={S.signatureHint} id="cgconsent-signature-hint">
              Must match your registration name (case-insensitive).
            </div>
          )
        ) : (
          <div style={S.signatureMismatch} id="cgconsent-signature-hint">
            Caregiver name is missing — go back to the personal-info step.
          </div>
        )}
      </div>

      {/* Guardian block (scout role only) */}
      {isScout && (
        <div style={S.guardianBlock}>
          <div style={S.guardianTitle}>
            Guardian acknowledgement (Youth Health Scout)
          </div>
          <label
            style={{ display: "flex", alignItems: "flex-start", gap: 8,
                     marginBottom: 10 }}
          >
            <input
              type="checkbox"
              checked={guardianConsent}
              onChange={(e) => setGuardianConsent(e.target.checked)}
              disabled={disabled || !scrollCompleted}
              style={S.checkbox}
            />
            <span style={S.checkboxLabel}>
              {SCOUT_PRIVACY_NOTICE.guardian_consent_text}
            </span>
          </label>
          <label
            style={S.signatureLabel}
            htmlFor="cgconsent-guardian-signature"
          >
            Guardian: type your full name
          </label>
          <input
            id="cgconsent-guardian-signature"
            type="text"
            value={guardianSignature}
            onChange={(e) => setGuardianSignature(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            disabled={disabled || !scrollCompleted || !guardianConsent}
            style={S.signatureInput}
          />
        </div>
      )}

      {/* Actions */}
      <div style={S.actions}>
        {typeof onCancel === "function" && (
          <button
            type="button"
            onClick={onCancel}
            disabled={disabled}
            style={S.btnGhost}
          >
            Cancel
          </button>
        )}
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit}
          style={S.btnPrimary(canSubmit)}
          aria-disabled={!canSubmit}
        >
          I Accept — Continue
        </button>
      </div>
      {!canSubmit && whyDisabled && (
        <div style={S.whyDisabled}>{whyDisabled}</div>
      )}
    </div>
  );
}
