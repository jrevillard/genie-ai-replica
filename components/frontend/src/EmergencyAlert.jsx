/**
 * EmergencyAlert — beginner-friendly SOS module.
 *
 * Full-screen overlay that walks the patient through a 3-step flow:
 *
 *   Step 1 — Pick a reason (6 big tiles: chest pain / breathing /
 *            stroke signs / bleeding / fainted / other)
 *   Step 2 — Confirm: shows the reason, counts caregivers who will be
 *            notified, optional one-tap "share my location" toggle,
 *            and a bold red "Send Alert" button + Cancel.
 *   Step 3 — Result: big green check, shows how many caregivers were
 *            notified, a giant red "Call 199 now" tel: link (Gambia
 *            emergency number), nearest facility hint, Close button.
 *
 * Calls POST /api/v1/caregiver/alert/send with:
 *   { patient_id, alert_type: "emergency_triage", severity: "emergency",
 *     message: "<reason> | <location> | <note>" }
 *
 * All failures are surfaced inline with a retry button. The module
 * never blocks calling 199 — the tel: link is available on every screen.
 *
 * Z-index 9300 (above BeginnerShell overlays 9100 but below
 * ConsentGate 9999 and EducationOnboardingGate 10000).
 */

import { useEffect, useState, useCallback, useRef } from "react";

const API = (window.AMINA_API || "http://localhost:8000").replace(/\/+$/, "");

// ── Design tokens ───────────────────────────────────────────────────────────

const T = {
  bg:         "#050810",
  bgSoft:     "#0a0f1f",
  surface:    "#0c1128",
  surface2:   "#111633",
  border:     "rgba(255,255,255,.08)",
  text:       "#e2e8f0",
  textDim:    "#cbd5e1",
  muted:      "#94a3b8",
  subtle:     "#64748b",
  danger:     "#f87171",
  dangerDeep: "#dc2626",
  dangerSoft: "rgba(248,113,113,.10)",
  dangerRing: "rgba(248,113,113,.40)",
  emerald:    "#34d399",
  amber:      "#fbbf24",
  accent:     "#818cf8",
};

const FONT = "'Outfit','DM Sans',ui-sans-serif,system-ui,-apple-system,sans-serif";

// Gambia national emergency number (from EmergencyTool.FACILITIES)
const EMERGENCY_NUMBER = "199";

// ── Reason catalog ──────────────────────────────────────────────────────────

export const REASONS = [
  {
    id:    "chest_pain",
    title: "Chest pain",
    sub:   "Pain or pressure in the chest",
    firstAid: "Sit upright. Stay calm. Do NOT lie flat. Chew one aspirin if you have it.",
    emoji: "💔",
  },
  {
    id:    "breathing",
    title: "Can't breathe",
    sub:   "Severe shortness of breath",
    firstAid: "Sit upright. Loosen tight clothing. Breathe slowly through your nose.",
    emoji: "🫁",
  },
  {
    id:    "stroke",
    title: "Stroke signs",
    sub:   "Face drooping, weak arm, slurred speech",
    firstAid: "Note the time NOW. Do NOT eat or drink anything. Stay still.",
    emoji: "🧠",
  },
  {
    id:    "bleeding",
    title: "Heavy bleeding",
    sub:   "Blood that won't stop",
    firstAid: "Press firmly with a clean cloth. Raise the injured part if you can.",
    emoji: "🩸",
  },
  {
    id:    "fainted",
    title: "Fainted / unconscious",
    sub:   "Someone passed out",
    firstAid: "Place the person on their side. Clear the airway. Do NOT give food or water.",
    emoji: "😵",
  },
  {
    id:    "other",
    title: "Something else",
    sub:   "Another urgent problem",
    firstAid: "Stay calm. Call 199. Tell them exactly what is happening.",
    emoji: "🚨",
  },
];

// ── Helpers ─────────────────────────────────────────────────────────────────

function getPatient() {
  try {
    return JSON.parse(localStorage.getItem("AMINA_PATIENT") || "null") || null;
  } catch {
    return null;
  }
}

function buildMessage({ patient, reason, coords, note }) {
  const lines = [];
  lines.push(`EMERGENCY ALERT`);
  lines.push(`Patient: ${patient?.name || "(unknown)"}`);
  lines.push(`Reason: ${reason?.title || "Unknown"}`);
  if (coords) {
    lines.push(`Location: https://maps.google.com/?q=${coords.lat},${coords.lng}`);
  } else {
    lines.push(`Location: not shared`);
  }
  if (note && note.trim()) {
    lines.push(`Note: ${note.trim()}`);
  }
  lines.push(`Time: ${new Date().toLocaleString()}`);
  lines.push(`Please respond immediately or call ${EMERGENCY_NUMBER}.`);
  return lines.join("\n");
}

// ── Inline icons ────────────────────────────────────────────────────────────

const I = {
  x: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 6 6 18M6 6l12 12"/>
    </svg>
  ),
  back: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 12H5M12 19l-7-7 7-7"/>
    </svg>
  ),
  check: (
    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5"/>
    </svg>
  ),
  alert: (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.3 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
      <path d="M12 9v4M12 17h.01"/>
    </svg>
  ),
  phone: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>
    </svg>
  ),
  pin: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
      <circle cx="12" cy="10" r="3"/>
    </svg>
  ),
  users: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
      <circle cx="9" cy="7" r="4"/>
      <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
      <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
    </svg>
  ),
};

// ── Main component ──────────────────────────────────────────────────────────

export default function EmergencyAlert({ token, patient: patientProp, onClose, initialReasonId = null }) {
  const preset = initialReasonId
    ? REASONS.find(r => r.id === initialReasonId) || null
    : null;
  const [step, setStep]             = useState(preset ? "confirm" : "pick");
  const [reason, setReason]         = useState(preset);
  const [shareLoc, setShareLoc]     = useState(true);
  const [coords, setCoords]         = useState(null);
  const [locError, setLocError]     = useState("");
  const [note, setNote]             = useState("");
  const [sendErr, setSendErr]       = useState("");
  const [sentResult, setSentResult] = useState(null);     // { sent, failed }
  const [caregivers, setCaregivers] = useState(null);     // count
  const acquiringRef                = useRef(false);

  const patient = patientProp || getPatient();
  const patientId = patient?.id || patient?.patient_id || null;

  // Load active caregiver count (for the confirm screen label)
  useEffect(() => {
    if (!patientId) { setCaregivers(0); return; }
    fetch(`${API}/api/v1/caregiver/by-patient/${encodeURIComponent(patientId)}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        const arr = Array.isArray(d) ? d : (d?.caregivers || []);
        const active = arr.filter(c => !c.is_revoked && (c.permissions || []).includes("alerts"));
        setCaregivers(active.length);
      })
      .catch(() => setCaregivers(null));
  }, [patientId, token]);

  // Acquire geolocation lazily when user advances to confirm (with shareLoc on)
  const acquireLocation = useCallback(() => {
    if (acquiringRef.current || !("geolocation" in navigator)) {
      setLocError("Location is not available on this device.");
      return;
    }
    acquiringRef.current = true;
    setLocError("");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        acquiringRef.current = false;
        setCoords({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        });
      },
      (err) => {
        acquiringRef.current = false;
        setLocError(
          err.code === err.PERMISSION_DENIED
            ? "Location permission was denied."
            : "Could not get your location."
        );
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  }, []);

  // If we were booted directly into "confirm" with a preset reason, start
  // acquiring location on mount (mirrors onPick).
  useEffect(() => {
    if (preset && shareLoc) acquireLocation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onPick = (r) => {
    setReason(r);
    setStep("confirm");
    if (shareLoc) acquireLocation();
  };

  const onToggleLoc = (next) => {
    setShareLoc(next);
    if (next && !coords) acquireLocation();
  };

  const sendAlert = async () => {
    if (!patientId) {
      setSendErr("Your patient profile is missing. Please sign in again.");
      setStep("error");
      return;
    }
    setStep("sending");
    setSendErr("");
    try {
      const message = buildMessage({
        patient, reason,
        coords: shareLoc ? coords : null,
        note,
      });
      const r = await fetch(`${API}/api/v1/caregiver/alert/send`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          patient_id: patientId,
          alert_type: "emergency_triage",
          severity:   "emergency",
          message,
        }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      setSentResult({
        sent:   Number(d.sent || 0),
        failed: Number(d.failed || 0),
      });
      setStep("sent");
    } catch (e) {
      setSendErr("Could not send the alert. Please try again — or call 199 now.");
      setStep("error");
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 9300,
        background:
          `radial-gradient(900px 500px at 50% -10%, rgba(248,113,113,.16), transparent 60%),` +
          T.bg,
        color: T.text,
        fontFamily: FONT,
        display: "flex", flexDirection: "column",
        overflow: "auto",
      }}
      data-literacy-ignore
    >
      <Header step={step} onClose={onClose} onBack={() => setStep("pick")} />

      {/* Always-visible emergency call rail — regardless of step */}
      <CallRail />

      <main
        style={{
          flex: 1,
          width: "100%", maxWidth: 820, margin: "0 auto",
          padding: "14px 24px 48px",
        }}
      >
        {step === "pick"   && <ReasonPicker onPick={onPick} />}
        {step === "confirm" && reason && (
          <ConfirmScreen
            reason={reason}
            shareLoc={shareLoc}
            onToggleLoc={onToggleLoc}
            coords={coords}
            locError={locError}
            note={note}
            setNote={setNote}
            caregivers={caregivers}
            onSend={sendAlert}
            onBack={() => setStep("pick")}
          />
        )}
        {step === "sending" && <SendingScreen />}
        {step === "sent"    && reason && (
          <SentScreen
            reason={reason}
            sentResult={sentResult}
            onClose={onClose}
          />
        )}
        {step === "error" && (
          <ErrorScreen
            message={sendErr}
            onRetry={sendAlert}
            onBack={() => setStep("confirm")}
          />
        )}
      </main>
    </div>
  );
}


// ── Header ──────────────────────────────────────────────────────────────────

function Header({ step, onClose, onBack }) {
  const showBack = step === "confirm" || step === "error";
  return (
    <header
      style={{
        padding: "18px 26px",
        borderBottom: `1px solid ${T.border}`,
        background: "rgba(12,17,40,.65)",
        backdropFilter: "blur(14px)",
        display: "flex", alignItems: "center", gap: 14,
        position: "sticky", top: 0, zIndex: 2,
      }}
    >
      {showBack ? (
        <button
          onClick={onBack}
          data-literacy-ignore
          aria-label="Back"
          style={iconButtonStyle()}
        >
          {I.back}
        </button>
      ) : (
        <div style={{ width: 40 }} />
      )}

      <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 12 }}>
        <div
          style={{
            width: 44, height: 44, borderRadius: 12,
            background: T.dangerSoft,
            border: `1px solid ${T.dangerRing}`,
            color: T.danger,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          {I.alert}
        </div>
        <div>
          <div
            style={{
              fontSize: 11, fontWeight: 700, letterSpacing: "1.8px",
              textTransform: "uppercase", color: T.muted,
            }}
          >
            AMINA Care
          </div>
          <div style={{ fontSize: 18, fontWeight: 800, color: T.text, lineHeight: 1.15 }}>
            Emergency Alert
          </div>
        </div>
      </div>

      <button
        onClick={onClose}
        data-literacy-ignore
        aria-label="Close"
        style={iconButtonStyle()}
      >
        {I.x}
      </button>
    </header>
  );
}

function iconButtonStyle() {
  return {
    all: "unset",
    cursor: "pointer",
    width: 40, height: 40, borderRadius: 10,
    background: T.surface2,
    border: `1px solid ${T.border}`,
    color: T.text,
    display: "flex", alignItems: "center", justifyContent: "center",
    fontFamily: FONT,
  };
}


// ── Always-visible emergency call rail ──────────────────────────────────────

function CallRail() {
  return (
    <div
      style={{
        width: "100%", maxWidth: 820, margin: "0 auto",
        padding: "18px 24px 0",
      }}
    >
      <a
        href={`tel:${EMERGENCY_NUMBER}`}
        data-literacy-ignore
        style={{
          display: "flex", alignItems: "center", gap: 16,
          padding: "18px 22px",
          borderRadius: 18,
          background:
            `linear-gradient(135deg, ${T.dangerDeep}, #ef4444),` +
            T.surface,
          border: `1px solid ${T.dangerRing}`,
          color: "#fff",
          textDecoration: "none",
          fontFamily: FONT,
          boxShadow: "0 18px 40px rgba(220,38,38,.35)",
        }}
      >
        <div
          style={{
            width: 54, height: 54, borderRadius: 14,
            background: "rgba(255,255,255,.18)",
            display: "flex", alignItems: "center", justifyContent: "center",
            flexShrink: 0,
          }}
        >
          {I.phone}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 11, fontWeight: 700, letterSpacing: "1.6px",
              textTransform: "uppercase", opacity: .85,
            }}
          >
            Call emergency services now
          </div>
          <div style={{ fontSize: 26, fontWeight: 800, lineHeight: 1.1, marginTop: 3 }}>
            Call {EMERGENCY_NUMBER}
          </div>
        </div>
        <div
          style={{
            fontSize: 12, fontWeight: 700,
            background: "rgba(255,255,255,.18)",
            padding: "8px 14px", borderRadius: 999,
            whiteSpace: "nowrap",
          }}
        >
          Tap to call
        </div>
      </a>
    </div>
  );
}


// ── Step 1 — reason picker ──────────────────────────────────────────────────

function ReasonPicker({ onPick }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22, paddingTop: 22 }}>
      <div>
        <div style={{ fontSize: 22, fontWeight: 800, color: T.text, marginBottom: 8 }}>
          What is happening?
        </div>
        <div style={{ fontSize: 14, color: T.muted, lineHeight: 1.6 }}>
          Tap the closest match. AMINA will alert your caregivers right away.
          You can still call 199 at any time using the red button above.
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
          gap: 14,
        }}
      >
        {REASONS.map(r => (
          <ReasonTile key={r.id} reason={r} onClick={() => onPick(r)} />
        ))}
      </div>
    </div>
  );
}

function ReasonTile({ reason, onClick }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      data-literacy-ignore
      style={{
        all: "unset",
        cursor: "pointer",
        padding: "22px 22px",
        background: hover
          ? `linear-gradient(180deg, ${T.dangerSoft}, rgba(255,255,255,.01)), ${T.surface2}`
          : T.surface,
        border: `1px solid ${hover ? T.dangerRing : T.border}`,
        borderRadius: 18,
        display: "flex", flexDirection: "column", gap: 12,
        minHeight: 140,
        transition: "all .15s ease",
        transform: hover ? "translateY(-2px)" : "translateY(0)",
        boxShadow: hover
          ? "0 18px 40px rgba(0,0,0,.5)"
          : "0 6px 18px rgba(0,0,0,.2)",
        fontFamily: FONT,
      }}
    >
      <div
        style={{
          width: 54, height: 54, borderRadius: 14,
          background: T.dangerSoft,
          border: `1px solid ${T.dangerRing}`,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 28,
        }}
        aria-hidden="true"
      >
        {reason.emoji}
      </div>
      <div style={{ fontSize: 17, fontWeight: 800, color: T.text, lineHeight: 1.25 }}>
        {reason.title}
      </div>
      <div style={{ fontSize: 13, color: T.muted, lineHeight: 1.5 }}>
        {reason.sub}
      </div>
    </button>
  );
}


// ── Step 2 — confirm ────────────────────────────────────────────────────────

function ConfirmScreen({
  reason, shareLoc, onToggleLoc, coords, locError,
  note, setNote, caregivers, onSend, onBack,
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, paddingTop: 22 }}>
      {/* Reason card */}
      <div
        style={{
          padding: "22px 24px",
          background:
            `linear-gradient(135deg, ${T.dangerSoft}, rgba(255,255,255,.01)),` +
            T.surface,
          border: `1px solid ${T.dangerRing}`,
          borderRadius: 18,
          display: "flex", alignItems: "center", gap: 16,
        }}
      >
        <div
          style={{
            width: 56, height: 56, borderRadius: 14,
            background: "rgba(248,113,113,.14)",
            border: `1px solid ${T.dangerRing}`,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 30,
          }}
          aria-hidden="true"
        >
          {reason.emoji}
        </div>
        <div style={{ flex: 1 }}>
          <div
            style={{
              fontSize: 11, fontWeight: 700, letterSpacing: "1.4px",
              textTransform: "uppercase", color: T.danger, marginBottom: 4,
            }}
          >
            Reported reason
          </div>
          <div style={{ fontSize: 20, fontWeight: 800, color: T.text, lineHeight: 1.2 }}>
            {reason.title}
          </div>
        </div>
      </div>

      {/* First-aid hint */}
      <div
        style={{
          padding: "16px 20px",
          background: T.surface,
          border: `1px solid ${T.border}`,
          borderRadius: 14,
          display: "flex", alignItems: "flex-start", gap: 12,
        }}
      >
        <div
          style={{
            width: 32, height: 32, borderRadius: 8,
            background: "rgba(251,191,36,.12)",
            border: "1px solid rgba(251,191,36,.35)",
            color: T.amber,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 14, fontWeight: 800,
            flexShrink: 0,
          }}
        >
          !
        </div>
        <div>
          <div
            style={{
              fontSize: 10, fontWeight: 700, letterSpacing: "1.4px",
              textTransform: "uppercase", color: T.amber, marginBottom: 4,
            }}
          >
            What to do right now
          </div>
          <div style={{ fontSize: 14, color: T.textDim, lineHeight: 1.55 }}>
            {reason.firstAid}
          </div>
        </div>
      </div>

      {/* Who will be notified */}
      <div
        style={{
          padding: "18px 22px",
          background: T.surface,
          border: `1px solid ${T.border}`,
          borderRadius: 14,
          display: "flex", alignItems: "center", gap: 14,
        }}
      >
        <div
          style={{
            width: 40, height: 40, borderRadius: 11,
            background: "rgba(129,140,248,.12)",
            border: `1px solid rgba(129,140,248,.35)`,
            color: T.accent,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          {I.users}
        </div>
        <div style={{ flex: 1 }}>
          <div
            style={{
              fontSize: 10, fontWeight: 700, letterSpacing: "1.4px",
              textTransform: "uppercase", color: T.muted,
            }}
          >
            Who will be notified
          </div>
          <div style={{ fontSize: 15, fontWeight: 700, color: T.text, marginTop: 3 }}>
            {caregivers === null
              ? "Your caregivers"
              : caregivers === 0
                ? "No caregivers linked yet"
                : `${caregivers} caregiver${caregivers === 1 ? "" : "s"} will get an SMS`}
          </div>
          {caregivers === 0 && (
            <div style={{ fontSize: 12, color: T.amber, marginTop: 4 }}>
              You can still call 199 right now using the red button above.
            </div>
          )}
        </div>
      </div>

      {/* Location toggle */}
      <div
        style={{
          padding: "18px 22px",
          background: T.surface,
          border: `1px solid ${T.border}`,
          borderRadius: 14,
          display: "flex", alignItems: "center", gap: 14,
        }}
      >
        <div
          style={{
            width: 40, height: 40, borderRadius: 11,
            background: "rgba(52,211,153,.12)",
            border: "1px solid rgba(52,211,153,.35)",
            color: T.emerald,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          {I.pin}
        </div>
        <div style={{ flex: 1 }}>
          <div
            style={{
              fontSize: 10, fontWeight: 700, letterSpacing: "1.4px",
              textTransform: "uppercase", color: T.muted,
            }}
          >
            Share my location
          </div>
          <div style={{ fontSize: 15, fontWeight: 700, color: T.text, marginTop: 3 }}>
            {shareLoc
              ? (coords
                  ? "Location ready — will be sent in the alert"
                  : locError || "Getting your location…")
              : "Location will NOT be shared"}
          </div>
        </div>
        <SwitchToggle on={shareLoc} onChange={onToggleLoc} />
      </div>

      {/* Optional note */}
      <div
        style={{
          padding: "18px 22px",
          background: T.surface,
          border: `1px solid ${T.border}`,
          borderRadius: 14,
        }}
      >
        <div
          style={{
            fontSize: 10, fontWeight: 700, letterSpacing: "1.4px",
            textTransform: "uppercase", color: T.muted, marginBottom: 8,
          }}
        >
          Add a note (optional)
        </div>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          placeholder="For example: I fell down. I cannot stand up."
          data-literacy-ignore
          style={{
            width: "100%",
            padding: "12px 14px",
            background: T.bgSoft,
            border: `1px solid ${T.border}`,
            borderRadius: 10,
            color: T.text,
            fontSize: 14,
            fontFamily: FONT,
            resize: "vertical",
            outline: "none",
            boxSizing: "border-box",
          }}
        />
      </div>

      {/* Actions */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 4 }}>
        <button
          onClick={onSend}
          data-literacy-ignore
          style={bigRedButtonStyle()}
        >
          Send alert to my caregivers
        </button>
        <button
          onClick={onBack}
          data-literacy-ignore
          style={{
            all: "unset",
            cursor: "pointer",
            padding: "14px 20px",
            textAlign: "center",
            borderRadius: 14,
            border: `1px solid ${T.border}`,
            color: T.muted,
            fontSize: 14, fontWeight: 700,
            fontFamily: FONT,
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function SwitchToggle({ on, onChange }) {
  return (
    <button
      onClick={() => onChange(!on)}
      role="switch"
      aria-checked={on}
      data-literacy-ignore
      style={{
        all: "unset",
        cursor: "pointer",
        width: 46, height: 26,
        borderRadius: 999,
        background: on ? T.emerald : "rgba(255,255,255,.1)",
        border: `1px solid ${on ? T.emerald : T.border}`,
        position: "relative",
        transition: "all .15s ease",
        flexShrink: 0,
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 2, left: on ? 22 : 2,
          width: 20, height: 20,
          borderRadius: "50%",
          background: "#fff",
          transition: "left .15s ease",
          boxShadow: "0 2px 6px rgba(0,0,0,.3)",
        }}
      />
    </button>
  );
}

function bigRedButtonStyle() {
  return {
    all: "unset",
    cursor: "pointer",
    width: "100%",
    boxSizing: "border-box",
    padding: "20px 22px",
    textAlign: "center",
    borderRadius: 16,
    background: `linear-gradient(135deg, ${T.dangerDeep}, #ef4444)`,
    color: "#fff",
    fontSize: 17, fontWeight: 800,
    boxShadow: "0 20px 48px rgba(220,38,38,.45)",
    letterSpacing: ".3px",
    fontFamily: FONT,
  };
}


// ── Step 3 — sending ────────────────────────────────────────────────────────

function SendingScreen() {
  return (
    <div
      style={{
        display: "flex", flexDirection: "column", alignItems: "center",
        gap: 18, padding: "60px 20px",
      }}
    >
      <div
        style={{
          width: 72, height: 72, borderRadius: "50%",
          border: `4px solid ${T.dangerRing}`,
          borderTopColor: T.danger,
          animation: "amina-sos-spin 1s linear infinite",
        }}
      />
      <div style={{ fontSize: 20, fontWeight: 800, color: T.text }}>
        Sending your alert…
      </div>
      <div style={{ fontSize: 14, color: T.muted, textAlign: "center", maxWidth: 420 }}>
        Please stay calm. You can still call 199 using the red button at the top.
      </div>
      <style>{`@keyframes amina-sos-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}


// ── Step 4 — sent result ────────────────────────────────────────────────────

function SentScreen({ reason, sentResult, onClose }) {
  const sent = sentResult?.sent || 0;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, paddingTop: 28 }}>
      <div
        style={{
          background:
            `linear-gradient(135deg, rgba(52,211,153,.18), rgba(52,211,153,.03)),` +
            T.surface,
          border: "1px solid rgba(52,211,153,.35)",
          borderRadius: 22,
          padding: "34px 26px",
          textAlign: "center",
        }}
      >
        <div
          style={{
            width: 88, height: 88, borderRadius: "50%",
            background: "rgba(52,211,153,.18)",
            border: "1px solid rgba(52,211,153,.35)",
            color: T.emerald,
            margin: "0 auto 16px",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          {I.check}
        </div>
        <div style={{ fontSize: 24, fontWeight: 800, color: T.emerald, marginBottom: 6 }}>
          Alert sent
        </div>
        <div style={{ fontSize: 14, color: T.textDim, lineHeight: 1.55, maxWidth: 480, margin: "0 auto" }}>
          {sent > 0
            ? `${sent} caregiver${sent === 1 ? " was" : "s were"} notified by SMS about your ${reason.title.toLowerCase()}.`
            : `Your report was recorded. No caregivers were reachable right now — please call 199 immediately.`}
        </div>
      </div>

      <div
        style={{
          padding: "18px 22px",
          background: T.surface,
          border: `1px solid ${T.border}`,
          borderRadius: 14,
        }}
      >
        <div
          style={{
            fontSize: 10, fontWeight: 700, letterSpacing: "1.4px",
            textTransform: "uppercase", color: T.amber, marginBottom: 8,
          }}
        >
          What to do right now
        </div>
        <div style={{ fontSize: 14, color: T.textDim, lineHeight: 1.6 }}>
          {reason.firstAid}
        </div>
      </div>

      <a
        href={`tel:${EMERGENCY_NUMBER}`}
        data-literacy-ignore
        style={{
          ...bigRedButtonStyle(),
          textDecoration: "none",
          display: "flex", alignItems: "center", justifyContent: "center", gap: 12,
        }}
      >
        {I.phone} Call {EMERGENCY_NUMBER} now
      </a>

      <button
        onClick={onClose}
        data-literacy-ignore
        style={{
          all: "unset",
          cursor: "pointer",
          padding: "14px 20px",
          textAlign: "center",
          borderRadius: 14,
          border: `1px solid ${T.border}`,
          color: T.muted,
          fontSize: 14, fontWeight: 700,
          fontFamily: FONT,
        }}
      >
        Close
      </button>
    </div>
  );
}


// ── Error screen ────────────────────────────────────────────────────────────

function ErrorScreen({ message, onRetry, onBack }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, paddingTop: 28 }}>
      <div
        style={{
          padding: "22px 24px",
          background:
            `linear-gradient(135deg, ${T.dangerSoft}, rgba(255,255,255,.01)),` +
            T.surface,
          border: `1px solid ${T.dangerRing}`,
          borderRadius: 18,
          textAlign: "center",
        }}
      >
        <div
          style={{
            width: 60, height: 60, borderRadius: "50%",
            background: "rgba(248,113,113,.14)",
            border: `1px solid ${T.dangerRing}`,
            color: T.danger,
            margin: "0 auto 14px",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          {I.alert}
        </div>
        <div style={{ fontSize: 18, fontWeight: 800, color: T.text, marginBottom: 6 }}>
          Could not send the alert
        </div>
        <div style={{ fontSize: 14, color: T.muted, lineHeight: 1.55 }}>
          {message || "Please try again. If this keeps happening, call 199 right now."}
        </div>
      </div>

      <a
        href={`tel:${EMERGENCY_NUMBER}`}
        data-literacy-ignore
        style={{
          ...bigRedButtonStyle(),
          textDecoration: "none",
          display: "flex", alignItems: "center", justifyContent: "center", gap: 12,
        }}
      >
        {I.phone} Call {EMERGENCY_NUMBER} now
      </a>

      <button
        onClick={onRetry}
        data-literacy-ignore
        style={{
          all: "unset",
          cursor: "pointer",
          padding: "15px 20px",
          textAlign: "center",
          borderRadius: 14,
          background: T.surface2,
          border: `1px solid rgba(129,140,248,.35)`,
          color: T.accent,
          fontSize: 14, fontWeight: 800,
          fontFamily: FONT,
        }}
      >
        Try sending again
      </button>

      <button
        onClick={onBack}
        data-literacy-ignore
        style={{
          all: "unset",
          cursor: "pointer",
          padding: "14px 20px",
          textAlign: "center",
          borderRadius: 14,
          border: `1px solid ${T.border}`,
          color: T.muted,
          fontSize: 13, fontWeight: 700,
          fontFamily: FONT,
        }}
      >
        Back
      </button>
    </div>
  );
}
