/**
 * ScribeFab — floating "Record visit" button with stepper state.
 *
 * Positioned bottom-left (opposite the ChannelLinkFab) so the clinician
 * always has it while chatting with / reviewing a patient. Hidden for
 * plain patient role — only caregivers + admins + self-recording patients
 * see it. (Patients recording for themselves is supported by the backend,
 * but we don't surface the FAB in the Beginner shell — it would be noise.)
 *
 * States:  idle → recorder open → review open → finalized toast → idle
 */

import { useCallback, useEffect, useState } from "react";
import ScribeRecorder from "./ScribeRecorder.jsx";
import ScribeReview   from "./ScribeReview.jsx";

function readActor() {
  try {
    // Caregiver has its own token in localStorage.cg_token + cg_info
    const cgToken = localStorage.getItem("cg_token");
    if (cgToken) {
      const info = JSON.parse(localStorage.getItem("cg_info") || "null") || {};
      return {
        role:      "caregiver",
        name:      info.name || "",
        patientId: info.patient_id || "",
      };
    }
    // Admin / patient tokens both under AMINA_TOKEN
    const tok = localStorage.getItem("AMINA_TOKEN");
    if (!tok) return null;
    const patient = JSON.parse(localStorage.getItem("AMINA_PATIENT") || "null") || {};
    return {
      role:      "patient",    // actual role claim lives in the JWT; for visibility we assume patient
      name:      patient.name || "",
      patientId: patient.id || "",
    };
  } catch {
    return null;
  }
}


export default function ScribeFab() {
  const [actor,     setActor]     = useState(readActor);
  const [recording, setRecording] = useState(false);
  const [review,    setReview]    = useState(null);     // { session }
  const [toast,     setToast]     = useState("");

  // Keep actor in sync with login/logout (cross-tab + same-tab).
  useEffect(() => {
    const sync = () => setActor(readActor());
    window.addEventListener("storage", sync);
    window.addEventListener("amina:auth-changed", sync);
    const t = setInterval(sync, 2000);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener("amina:auth-changed", sync);
      clearInterval(t);
    };
  }, []);

  const onDraft = useCallback((session) => {
    setRecording(false);
    setReview({ session });
  }, []);

  const onFinalized = useCallback(() => {
    setReview(null);
    setToast("Saved to inbox ✓");
    setTimeout(() => setToast(""), 3200);
  }, []);

  // Visibility: caregivers always, patients + admins only if patientId known.
  if (!actor || !actor.patientId) return null;
  // Keep the FAB out of Beginner shell to reduce visual noise — BeginnerShell
  // sets body[data-literacy-mode="beginner"] on sign-in.
  const mode = (typeof document !== "undefined" && document.body?.dataset?.literacyMode) || "";
  if (mode === "beginner") return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setRecording(true)}
        aria-label="Record visit"
        title="Record visit (scribe)"
        style={{
          // Row 4 of the right-side stack, docked in the empty area
          // below the "Today & Care" / "Dual-Path Care" cards:
          //   [InboxBell 490] [RoleSwitcher 548] [LanguagePicker 606] [ScribeFab 664]
          position:   "fixed",
          top:        664,
          right:      20,
          width:      52, height: 52,
          border:     "none",
          cursor:     "pointer",
          zIndex:     9250,
          background: "linear-gradient(135deg, #b91c1c 0%, #ef4444 100%)",
          color:      "#fff",
          borderRadius: "50%",
          boxShadow:  "0 4px 14px rgba(239, 68, 68, 0.35)",
          display:    "inline-flex",
          alignItems: "center", justifyContent: "center",
          fontSize:   20,
          transition: "transform 140ms ease, box-shadow 140ms ease",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.transform = "scale(1.05)";
          e.currentTarget.style.boxShadow = "0 6px 18px rgba(239, 68, 68, 0.45)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = "scale(1)";
          e.currentTarget.style.boxShadow = "0 4px 14px rgba(239, 68, 68, 0.35)";
        }}
      >
        {/* microphone glyph */}
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="9" y="2" width="6" height="12" rx="3" />
          <path d="M5 10v1a7 7 0 0 0 14 0v-1" />
          <line x1="12" y1="18" x2="12" y2="22" />
          <line x1="8"  y1="22" x2="16" y2="22" />
        </svg>
      </button>

      <ScribeRecorder
        open={recording}
        patientId={actor.patientId}
        language="en"
        onDraft={onDraft}
        onClose={() => setRecording(false)}
      />
      <ScribeReview
        open={!!review}
        session={review?.session}
        onFinalized={onFinalized}
        onClose={() => setReview(null)}
      />

      {toast ? (
        <div
          role="status"
          aria-live="polite"
          style={{
            position:  "fixed",
            bottom:    26,
            left:      "50%",
            transform: "translateX(-50%)",
            zIndex:    9295,
            padding:   "10px 16px",
            background:"rgba(15, 23, 42, 0.94)",
            color:     "#fff",
            borderRadius: 999,
            fontSize:  13,
            boxShadow: "0 8px 24px rgba(15,23,42,0.35)",
            fontFamily:"system-ui, -apple-system, Segoe UI, sans-serif",
            animation: "amina-scribe-toast 240ms cubic-bezier(0.22,1,0.36,1)",
          }}
        >{toast}</div>
      ) : null}

      <style>{`
        @keyframes amina-scribe-toast {
          from { opacity: 0; transform: translateX(-50%) translateY(8px); }
          to   { opacity: 1; transform: translateX(-50%) translateY(0); }
        }
      `}</style>
    </>
  );
}
