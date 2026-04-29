/**
 * DisclaimerPage — full legal disclaimer, accessible at #/disclaimer.
 *
 * Loaded text from GET /observatory/disclaimer with a hard-coded
 * fallback so the page works even if the backend is unreachable.
 * Linked from the ConsentGate ("Read full legal disclaimer") and
 * from the SyntheticFooter on every Observatory page.
 */

import { useEffect, useState } from "react";
import {
  ArrowLeft, AlertTriangle, FileText, Shield, ExternalLink,
} from "lucide-react";

import { SyntheticBanner, SyntheticFooter } from "./SyntheticIndicators.jsx";


const API = ((typeof window !== "undefined" && window.AMINA_API) || "http://localhost:8000")
  .replace(/\/+$/, "");


/* ─── one-shot CSS ────────────────────────────────────────────── */

const DP_CSS = `
.dp-page {
  min-height: 100vh;
  background: var(--a-bg, #06080d);
  color: var(--a-fg, #e7ecf3);
  font-family: var(--a-font-ui);
  display: flex; flex-direction: column;
}
.dp-bg {
  position: fixed; inset: 0; pointer-events: none; z-index: 0;
  background:
    radial-gradient(900px 500px at 12% 10%, rgba(124,58,237,0.08), transparent 60%),
    radial-gradient(700px 400px at 88% 90%, rgba(58,119,40,0.06), transparent 60%);
}
.dp-content {
  position: relative; z-index: 1;
  width: 100%; max-width: 880px;
  margin: 0 auto;
  padding: 28px 28px 56px;
  flex: 1;
}
.dp-back {
  display: inline-flex; align-items: center; gap: 6px;
  background: transparent; border: 0; color: var(--a-fg-mute);
  cursor: pointer; padding: 6px 0;
  font-size: 13px;
  font-family: inherit;
}
.dp-back:hover { color: var(--a-fg); }

.dp-card {
  margin-top: 18px;
  background: linear-gradient(180deg,
    color-mix(in oklab, var(--a-bg-elev-1, #161c27), transparent 5%),
    color-mix(in oklab, var(--a-bg-elev-1, #11161f), transparent 5%));
  border: 1px solid var(--a-border-2);
  border-radius: 14px;
  overflow: hidden;
  box-shadow: 0 12px 36px rgba(0,0,0,0.40);
}
.dp-card-strip {
  height: 3px;
  background: linear-gradient(90deg, #fbbf24 0%, #fb923c 50%, #f87171 100%);
}
.dp-header {
  padding: 22px 28px 18px;
  border-bottom: 1px solid var(--a-border-1);
  display: flex; align-items: flex-start; gap: 14px;
}
.dp-header svg { color: #fcd34d; flex: none; margin-top: 4px; }
.dp-title {
  font-family: var(--a-font-disp);
  font-weight: 400; font-variation-settings: "opsz" 144;
  font-size: 26px; color: #fff;
  letter-spacing: -0.4px; line-height: 1.15;
}
.dp-meta {
  font-size: 11px; color: var(--a-fg-dim);
  letter-spacing: 0.06em; margin-top: 6px;
  font-family: var(--a-font-mono);
}

.dp-summary {
  padding: 18px 28px;
  background: rgba(251,191,36,0.06);
  border-bottom: 1px solid var(--a-border-1);
  font-size: 14.5px; color: #fcd34d; line-height: 1.55;
  font-weight: 500;
}

.dp-body {
  padding: 22px 28px 26px;
}
.dp-section {
  padding: 14px 0;
  border-bottom: 1px solid var(--a-border-1);
}
.dp-section:last-child { border-bottom: 0; }
.dp-section h2 {
  font-family: var(--a-font-disp);
  font-weight: 500; font-size: 16.5px;
  color: #fff;
  margin: 0 0 8px; letter-spacing: -0.1px;
}
.dp-section p {
  font-size: 14px; color: var(--a-fg-mute);
  line-height: 1.6; margin: 0;
}

.dp-clauses-block {
  margin-top: 22px; padding: 18px;
  background: var(--a-bg-inset);
  border: 1px solid var(--a-border-1);
  border-radius: 12px;
}
.dp-clauses-title {
  font-size: 11px; font-weight: 700;
  letter-spacing: 0.18em; text-transform: uppercase;
  color: var(--a-fg-dim); margin-bottom: 10px;
}
.dp-clauses-block ul {
  margin: 0; padding-left: 0; list-style: none;
  display: flex; flex-direction: column; gap: 10px;
}
.dp-clauses-block li {
  display: flex; gap: 10px; font-size: 13.5px;
  color: var(--a-fg); line-height: 1.55;
}
.dp-clauses-block li::before {
  content: "✓";
  color: #34d399; flex: none; font-weight: 700;
  width: 18px;
}

.dp-foot {
  margin-top: 24px; padding: 14px 18px;
  background: var(--a-bg-inset);
  border: 1px solid var(--a-border-1);
  border-radius: 10px;
  font-size: 12px; color: var(--a-fg-dim);
  line-height: 1.5;
}
.dp-foot b { color: var(--a-fg-mute); font-weight: 600; }

.dp-err {
  margin-top: 18px; padding: 12px 14px;
  border-radius: 10px;
  background: rgba(248,113,113,0.10);
  border: 1px solid rgba(248,113,113,0.30);
  color: #fecaca; font-size: 12.5px;
}
`;

if (typeof document !== "undefined" && !document.getElementById("amina-dp-css")) {
  const s = document.createElement("style");
  s.id = "amina-dp-css";
  s.textContent = DP_CSS;
  document.head.appendChild(s);
}


/* ─── hard-coded fallback (matches backend) ───────────────────── */

const FALLBACK = {
  title:        "AMINA NCD Observatory — Data Disclaimer",
  version:      "1.0",
  last_updated: "2026-04",
  data_mode:    "synthetic",
  summary:
    "This system contains SYNTHETIC DATA ONLY. No real patient " +
    "information is stored, displayed, or processed. This is a " +
    "TECHNICAL ARCHITECTURE DEMONSTRATION.",
  consent_clauses: [
    "I understand that ALL data in this system is synthetic and this is an architecture demonstration only.",
    "I agree not to interpret, cite, or use any data shown as representing real health statistics of The Gambia.",
  ],
  sections: [
    { heading: "1. Nature of Data",
      body: "All data displayed, stored, and processed within this demonstration environment of the AMINA NCD Observatory is entirely synthetic. It has been artificially generated using randomized algorithms and does not represent, reflect, or derive from any real individual, patient, health worker, community, health facility, or geographic area in The Gambia or any other country." },
    { heading: "2. No Real Patient Information",
      body: "This system contains zero real patient data. No Protected Health Information (PHI), Personally Identifiable Information (PII), or any data subject to health data protection regulations has been collected, stored, or displayed." },
    { heading: "3. Purpose",
      body: "This environment exists solely to demonstrate the technical architecture, user interface design, and workflow capabilities of the AMINA NCD Observatory platform. It is intended for evaluation by technical reviewers, competition judges, and potential deployment partners." },
    { heading: "4. Prohibited Uses",
      body: "Data from this system must NOT be: (a) used to make clinical decisions about any patient; (b) used to inform health policy decisions; (c) cited in academic papers, reports, or publications as representing real health statistics; (d) shared with media as real health data; (e) used for any statistical analysis claiming to represent The Gambia's health status." },
    { heading: "5. Future Production Use",
      body: "When deployed in a production environment with real patient data, this system will comply with: (a) The Gambia's health data governance framework; (b) WHO guidelines on health information systems; (c) the African Union Convention on Cyber Security and Personal Data Protection (Malabo Convention); (d) applicable data protection regulations as enacted by The Gambia." },
    { heading: "6. Contact",
      body: "For information about real NCD data in The Gambia: Ministry of Health, Directorate of Health Services; WHO Gambia Country Office; Gambia Bureau of Statistics (GBoS). For information about the AMINA platform: AMINA Technical Team / UNICC." },
  ],
};


/* ─── component ───────────────────────────────────────────────── */

export default function DisclaimerPage() {
  const [doc, setDoc] = useState(FALLBACK);
  const [warn, setWarn] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch(`${API}/api/v1/observatory/disclaimer`)
      .then((r) => r.json())
      .then((d) => { if (!cancelled && d && d.title) setDoc(d); })
      .catch(() => {
        if (!cancelled) {
          setWarn("Could not load latest disclaimer from server -- showing cached copy.");
        }
      });
    return () => { cancelled = true; };
  }, []);

  const goBack = () => {
    if (window.history.length > 1) window.history.back();
    else window.location.hash = "#/";
  };

  return (
    <div className="dp-page amina-admin-scope">
      <div className="dp-bg" />
      <SyntheticBanner />

      <div className="dp-content">
        <button type="button" className="dp-back" onClick={goBack}>
          <ArrowLeft size={14} />
          Back
        </button>

        <div className="dp-card">
          <div className="dp-card-strip" />

          <div className="dp-header">
            <FileText size={26} />
            <div style={{ flex: 1 }}>
              <div className="dp-title">{doc.title}</div>
              <div className="dp-meta">
                Version {doc.version} · last updated {doc.last_updated} · mode: {doc.data_mode}
              </div>
            </div>
          </div>

          {warn && <div className="dp-err">{warn}</div>}

          <div className="dp-summary">
            <AlertTriangle size={14} style={{ verticalAlign: "-2px", marginRight: 8 }} />
            {doc.summary}
          </div>

          <div className="dp-body">
            {(doc.sections || []).map((s, i) => (
              <div key={i} className="dp-section">
                <h2>{s.heading}</h2>
                <p>{s.body}</p>
              </div>
            ))}

            {Array.isArray(doc.consent_clauses) && doc.consent_clauses.length > 0 && (
              <div className="dp-clauses-block">
                <div className="dp-clauses-title">Consent clauses (required to access)</div>
                <ul>
                  {doc.consent_clauses.map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="dp-foot">
              <b>Need more information?</b> For inquiries about real NCD
              data in The Gambia, contact the Ministry of Health
              Directorate of Health Services or the WHO Gambia Country
              Office. For technical questions about this platform,
              contact the AMINA team via UNICC.
            </div>
          </div>
        </div>
      </div>

      <SyntheticFooter />
    </div>
  );
}


/* ─── screenshot reminder hook ────────────────────────────────── */

/**
 * useScreenshotReminder — flashes a 2s reminder banner when the
 * user presses PrintScreen or Ctrl+P. This is a polite nudge, not
 * a security control (most screenshots can't be detected).
 *
 * Usage:
 *   useScreenshotReminder();
 *
 * Mount once at the root of the Observatory experience.
 */
export function useScreenshotReminder() {
  useEffect(() => {
    const showReminder = () => {
      let el = document.getElementById("amina-screenshot-reminder");
      if (el) return;  // already showing
      el = document.createElement("div");
      el.id = "amina-screenshot-reminder";
      el.style.cssText = `
        position: fixed; top: 50%; left: 50%;
        transform: translate(-50%, -50%);
        z-index: 99999;
        background: rgba(20, 14, 0, 0.96);
        color: #ffd166;
        border: 2px solid #ffa500;
        padding: 18px 26px;
        border-radius: 14px;
        font: 600 14px/1.5 system-ui, sans-serif;
        box-shadow: 0 16px 48px rgba(0,0,0,0.6);
        max-width: 380px;
        text-align: center;
        animation: amina-flash 240ms ease;
      `;
      el.innerHTML = `
        <div style="font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase;
                    color: #fcd34d; margin-bottom: 8px;">
          ⚠ Synthetic data reminder
        </div>
        <div style="color: #fff; font-weight: 500; line-height: 1.5;">
          All data shown is <b style="color: #ffd166;">SYNTHETIC</b>.
          If sharing this screenshot, please label it
          <br/><b style="color: #ffd166;">"Synthetic Data Demo"</b>.
        </div>
      `;
      document.body.appendChild(el);
      setTimeout(() => { try { el.remove(); } catch {} }, 2200);
    };

    const onKey = (e) => {
      if (e.key === "PrintScreen") showReminder();
      else if ((e.ctrlKey || e.metaKey) && e.key === "p") showReminder();
    };
    const onCtx = () => showReminder();

    document.addEventListener("keydown", onKey);
    document.addEventListener("contextmenu", onCtx);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("contextmenu", onCtx);
    };
  }, []);
}
