/**
 * LoginPage — #/login route.
 * =============================
 *
 * "Bioluminescent Calm" — deep midnight-violet sanctuary lit by slow
 * aurora-light. Implementation uses a dedicated stylesheet (login-page.css)
 * for tokens, animations, and structure. JSX stays minimal + semantic.
 *
 * Pattern highlights
 * ------------------
 *   - Sliding pill: a single absolutely-positioned element whose left+width
 *     are measured from the active button via getBoundingClientRect in
 *     useLayoutEffect (usePillRect). More reliable than layout animation
 *     for variable-width tab labels.
 *   - Floating labels: `.field.filled` / `:focus-within` CSS states toggle
 *     the label position. No per-input Motion.
 *   - CTA morph: state attribute `data-state="idle|loading|success"` drives
 *     all state changes via CSS. Simpler, more reliable, same visuals.
 *   - Particle field: positions computed once at mount; float-up keyframe
 *     handles lifecycle.
 *
 * Backend endpoints (unchanged):
 *   POST /api/v1/auth/otp/send      { phone }
 *   POST /api/v1/auth/otp/verify    { phone, otp, ... }
 *   POST /api/v1/auth/login/email   { email, password }
 *   POST /api/v1/caregiver/login    { phone, pin }
 *   POST /api/v1/admin/login        { username, password }
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Heart, HeartHandshake, ShieldCheck,
  Phone, Mail, Lock, Eye, EyeOff,
  ChevronDown, ArrowRight, Check, Globe, ChevronLeft,
} from "lucide-react";
import { navigate } from "../AppRouter.jsx";
import oauthLogin from "../oauthLogin.js";
import "../../styles/login-page.css";


// ── Static data ──────────────────────────────────────────────────

const ROLES = [
  { id: "pt", label: "Patient",    Icon: Heart,          img: "/auth-art/patient.avif",   alt: "A family of three generations together" },
  { id: "cg", label: "Caregiver",  Icon: HeartHandshake, img: "/auth-art/caregiver.webp", alt: "A nurse holding a bouquet of flowers" },
  { id: "ad", label: "Admin",      Icon: ShieldCheck,    img: "/auth-art/admin.webp",     alt: "A clinician at a laptop" },
];

const METHODS = [
  { id: "phone", label: "Phone", Icon: Phone },
  { id: "email", label: "Email", Icon: Mail  },
];

const ROLE_COPY = {
  pt: { title: "Welcome", emph: "back",     sub: "Continue your care — we've kept your place." },
  cg: { title: "Caring",  emph: "together", sub: "Sign in to check on the people who count on you." },
  ad: { title: "Good to see you,", emph: "doctor", sub: "Securely access clinical workflows and patient records." },
};

const COUNTRY_CODES = [
  { code: "+220", label: "Gambia",  flag: "🇬🇲" },
  { code: "+91",  label: "India",   flag: "🇮🇳" },
  { code: "+1",   label: "USA",     flag: "🇺🇸" },
  { code: "+44",  label: "UK",      flag: "🇬🇧" },
  { code: "+234", label: "Nigeria", flag: "🇳🇬" },
  { code: "+221", label: "Senegal", flag: "🇸🇳" },
  { code: "+233", label: "Ghana",   flag: "🇬🇭" },
  { code: "+254", label: "Kenya",   flag: "🇰🇪" },
];


// ── Helpers ──────────────────────────────────────────────────────

// Backend origin. Vite dev server doesn't proxy /api, so every fetch
// must target the absolute backend URL; window.AMINA_API can be set
// at build/serve time for prod.
const API_BASE = ((typeof window !== "undefined" && window.AMINA_API) || "http://localhost:8000")
  .replace(/\/+$/, "");

async function post(url, body) {
  try {
    const absolute = url.startsWith("http") ? url : `${API_BASE}${url}`;
    const r = await fetch(absolute, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, data };
  } catch {
    return { ok: false, status: 0, data: { error: "Network error — check your connection." } };
  }
}
function handoff(dest = "#/") {
  navigate(dest);
  setTimeout(() => { try { window.location.reload(); } catch {} }, 80);
}


// ── Sliding pill hook ────────────────────────────────────────────

function usePillRect(listRef, activeIdx, deps = []) {
  const [rect, setRect] = useState({ left: 0, width: 0 });
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const items = el.querySelectorAll("[data-pill-item]");
    const active = items[activeIdx];
    if (!active) return;
    const pRect = el.getBoundingClientRect();
    const aRect = active.getBoundingClientRect();
    setRect({ left: aRect.left - pRect.left, width: aRect.width });

    const onResize = () => {
      const p = el.getBoundingClientRect();
      const a = active.getBoundingClientRect();
      setRect({ left: a.left - p.left, width: a.width });
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIdx, ...deps]);
  return rect;
}


// ── Background ────────────────────────────────────────────────────

function Background() {
  const count = typeof window !== "undefined" && window.innerWidth < 520 ? 15 : 36;
  const particles = useMemo(() => (
    Array.from({ length: count }, (_, i) => {
      const tone = i % 3 === 0 ? "rgba(34, 211, 238,"
                 : i % 3 === 1 ? "rgba(244, 114, 182,"
                               : "rgba(255, 255, 255,";
      const op = 0.3 + Math.random() * 0.4;
      const size = 1 + Math.random() * 1.4;
      return {
        key:   i,
        left:  Math.random() * 100,
        top:   100 + Math.random() * 20,
        size,
        bg:    tone + op + ")",
        glow:  tone + (op * 0.8) + ")",
        dur:   24 + Math.random() * 20,
        delay: -Math.random() * 40,
        drift: (Math.random() - 0.5) * 80,
        opacity: op,
      };
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ), []);

  return (
    <>
      <div className="bg-base"    aria-hidden="true" />
      <div className="bg-aurora"  aria-hidden="true">
        <div className="orb orb-violet"   />
        <div className="orb orb-rose"     />
        <div className="orb orb-cyan"     />
        <div className="orb orb-violet-2" />
      </div>
      <div className="bg-particles" aria-hidden="true">
        {particles.map((p) => (
          <span
            key={p.key}
            className="particle"
            style={{
              left:   `${p.left}%`,
              top:    `${p.top}%`,
              width:  p.size,
              height: p.size,
              background: p.bg,
              boxShadow:  `0 0 ${p.size * 4}px ${p.glow}`,
              "--p-opacity": p.opacity,
              "--p-drift":   `${p.drift}px`,
              animation:     `amina-float-up ${p.dur}s linear ${p.delay}s infinite`,
            }}
          />
        ))}
      </div>
      <div className="bg-grain"    aria-hidden="true" />
      <div className="bg-vignette" aria-hidden="true" />
    </>
  );
}


// ── Role portrait (hero illustration) ────────────────────────────

function Portrait({ role }) {
  return (
    <div className="portrait" data-role={role} aria-hidden="true">
      <div className="portrait-halo" />
      <div className="portrait-ring" />
      <div className="portrait-frame">
        {ROLES.map((r) => (
          <div
            key={r.id}
            className="portrait-img"
            data-active={r.id === role}
            data-role={r.id}
          >
            <img src={r.img} alt="" draggable="false" />
          </div>
        ))}
        <div className="portrait-wash" />
        <div className="portrait-rim" />
      </div>
    </div>
  );
}


// ── Sliding-pill tab groups ──────────────────────────────────────

function RoleTabs({ value, onChange }) {
  const listRef = useRef(null);
  const activeIdx = ROLES.findIndex((r) => r.id === value);
  const [sliding, setSliding] = useState(false);
  const pill = usePillRect(listRef, activeIdx, [value]);

  useEffect(() => {
    setSliding(true);
    const t = setTimeout(() => setSliding(false), 520);
    return () => clearTimeout(t);
  }, [value]);

  return (
    <div
      ref={listRef}
      className="tablist"
      role="tablist"
      aria-label="Select your role"
      data-sliding={sliding}
    >
      <div className="tab-pill" style={{ left: pill.left, width: pill.width }} />
      {ROLES.map((r) => {
        const on = r.id === value;
        return (
          <button
            key={r.id}
            role="tab"
            type="button"
            aria-selected={on}
            tabIndex={on ? 0 : -1}
            data-pill-item
            className="tab"
            onClick={() => onChange(r.id)}
          >
            <r.Icon size={15} />
            <span>{r.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function MethodToggle({ value, onChange }) {
  const listRef = useRef(null);
  const activeIdx = METHODS.findIndex((m) => m.id === value);
  const pill = usePillRect(listRef, activeIdx, [value]);

  return (
    <div ref={listRef} className="methodlist" role="tablist" aria-label="Sign-in method">
      <div className="method-pill" style={{ left: pill.left, width: pill.width }} />
      {METHODS.map((m) => {
        const on = m.id === value;
        return (
          <button
            key={m.id}
            role="tab"
            type="button"
            aria-selected={on}
            tabIndex={on ? 0 : -1}
            data-pill-item
            className="method-tab"
            onClick={() => onChange(m.id)}
          >
            <m.Icon size={13} />
            <span>{m.label}</span>
          </button>
        );
      })}
    </div>
  );
}


// ── Field primitives ─────────────────────────────────────────────

function Field({
  label, value, onChange, type = "text", inputMode, maxLength,
  autoComplete, autoFocus, onEnter, rightSlot, otp = false, ...rest
}) {
  const filled = value != null && value !== "";
  return (
    <div className={`field${filled ? " filled" : ""}${otp ? " otp" : ""}`}>
      <label className="field-label">{label}</label>
      <input
        type={type}
        inputMode={inputMode}
        value={value ?? ""}
        onChange={onChange}
        onKeyDown={(e) => {
          if (onEnter && e.key === "Enter") { e.preventDefault(); onEnter(); }
        }}
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        maxLength={maxLength}
        {...rest}
      />
      {rightSlot ? <span className="field-right">{rightSlot}</span> : null}
    </div>
  );
}

function PhoneField({ cc, onCc, phone, onPhone, autoFocus, onEnter }) {
  const filled = phone != null && phone !== "";
  const sel = COUNTRY_CODES.find((c) => c.code === cc) || COUNTRY_CODES[0];
  return (
    <div className={`field has-prefix${filled ? " filled" : ""}`}>
      <div className="field-prefix" aria-label={`Country code: ${sel.label} ${sel.code}`}>
        <span className="flag flag-gm"><span /><span /><span /></span>
        <span>{cc}</span>
        <ChevronDown size={12} strokeWidth={2} />
        <select
          value={cc}
          onChange={(e) => onCc(e.target.value)}
          aria-label="Country code"
        >
          {COUNTRY_CODES.map((c) => (
            <option key={c.code} value={c.code}>
              {c.flag}  {c.code}  {c.label}
            </option>
          ))}
        </select>
      </div>
      <label className="field-label">Phone number</label>
      <input
        type="tel"
        inputMode="numeric"
        autoComplete="tel"
        value={phone}
        onChange={(e) => onPhone(e.target.value.replace(/\D/g, ""))}
        onKeyDown={(e) => {
          if (onEnter && e.key === "Enter") { e.preventDefault(); onEnter(); }
        }}
        maxLength={15}
        autoFocus={autoFocus}
      />
    </div>
  );
}

function PasswordFieldInline({ label, value, onChange, autoComplete, autoFocus, onEnter }) {
  const [visible, setVisible] = useState(false);
  return (
    <Field
      label={label}
      type={visible ? "text" : "password"}
      value={value}
      onChange={onChange}
      onEnter={onEnter}
      autoComplete={autoComplete}
      autoFocus={autoFocus}
      rightSlot={
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? "Hide password" : "Show password"}
          aria-pressed={visible}
        >
          {visible ? <EyeOff size={16} strokeWidth={1.8} />
                   : <Eye    size={16} strokeWidth={1.8} />}
        </button>
      }
    />
  );
}


// ── Alerts ───────────────────────────────────────────────────────

function Alert({ kind = "error", children }) {
  return (
    <div role={kind === "error" ? "alert" : "status"} className={`alert alert-${kind}`} aria-live="polite">
      {children}
    </div>
  );
}


// ── CTA ──────────────────────────────────────────────────────────

function CTA({ state, label, onClick, disabled, type = "button" }) {
  const [sparks, setSparks] = useState([]);

  useEffect(() => {
    if (state !== "success") return;
    const palette = ["#22d3ee", "#f472b6", "#ffffff", "#a78bfa"];
    const arr = Array.from({ length: 14 }, (_, i) => {
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * 1.2;
      const dist = 60 + Math.random() * 60;
      return {
        key: Date.now() + "-" + i,
        x: Math.cos(angle) * dist,
        y: Math.sin(angle) * dist,
        color: palette[i % palette.length],
        delay: Math.random() * 80,
        size: 3 + Math.random() * 4,
      };
    });
    setSparks(arr);
    const t = setTimeout(() => setSparks([]), 1000);
    return () => clearTimeout(t);
  }, [state]);

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || state === "loading" || state === "success"}
      className="cta"
      data-state={state}
      aria-live="polite"
    >
      <span className="cta-shimmer" aria-hidden="true" />
      <span className="cta-content cta-label">
        <span>{label}</span>
        <ArrowRight size={16} strokeWidth={2.4} />
      </span>
      <span className="cta-spinner" aria-hidden="true"><span className="spinner" /></span>
      <span className="cta-check"   aria-hidden="true">
        <Check size={22} strokeWidth={2.6} />
      </span>
      {sparks.map((s) => (
        <span key={s.key} className="spark"
          style={{
            left: "50%", top: "50%",
            width: s.size, height: s.size,
            background: s.color,
            boxShadow: `0 0 ${s.size * 2}px ${s.color}`,
            "--sx": `${s.x}px`,
            "--sy": `${s.y}px`,
            animation: `amina-spark-up 900ms ${s.delay}ms var(--ease-out-soft) forwards`,
          }}
        />
      ))}
    </button>
  );
}


// ── OAuth row ────────────────────────────────────────────────────

function GlyphGoogle() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M23.64 12.2c0-.85-.08-1.48-.24-2.14H12v4.05h6.62c-.13 1.08-.86 2.71-2.47 3.81l-.02.15 3.59 2.78.25.03c2.28-2.11 3.67-5.19 3.67-8.68z"/>
      <path fill="#34A853" d="M12 24c3.24 0 5.95-1.07 7.94-2.91l-3.78-2.94c-1.01.71-2.37 1.2-4.16 1.2-3.17 0-5.87-2.09-6.83-4.99l-.14.01-3.74 2.89-.05.14C3.21 21.3 7.28 24 12 24z"/>
      <path fill="#FBBC05" d="M5.17 14.36a7.34 7.34 0 01-.39-2.36c0-.83.14-1.62.38-2.36l-.01-.16L1.38 6.54l-.13.06A12.01 12.01 0 000 12c0 1.94.46 3.77 1.25 5.4l3.92-3.04z"/>
      <path fill="#EA4335" d="M12 4.75c2.24 0 3.76.97 4.62 1.78l3.39-3.3C17.93 1.18 15.24 0 12 0 7.28 0 3.21 2.7 1.25 6.6l3.92 3.04C6.13 6.84 8.83 4.75 12 4.75z"/>
    </svg>
  );
}
function GlyphFacebook() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#1877F2" d="M24 12.07C24 5.41 18.63 0 12 0S0 5.41 0 12.07c0 6.02 4.39 11.01 10.13 11.93v-8.44H7.08v-3.49h3.05V9.41c0-3.02 1.79-4.69 4.53-4.69 1.31 0 2.68.24 2.68.24v2.97h-1.51c-1.49 0-1.95.93-1.95 1.88v2.26h3.33l-.53 3.49h-2.8V24C19.61 23.08 24 18.09 24 12.07z"/>
    </svg>
  );
}
function GlyphDhis2() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" fill="none"
         stroke="#22d3ee" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 18V6h4a6 6 0 0 1 0 12H6z"/>
      <circle cx="18" cy="12" r="1.6" fill="#22d3ee"/>
    </svg>
  );
}

function SocialRow({ busy, onClick }) {
  const ripple = (e) => {
    const btn = e.currentTarget;
    const rect = btn.getBoundingClientRect();
    const r = document.createElement("span");
    r.className = "ripple";
    r.style.left = `${e.clientX - rect.left}px`;
    r.style.top  = `${e.clientY - rect.top}px`;
    r.style.width = r.style.height = "12px";
    btn.appendChild(r);
    setTimeout(() => r.remove(), 650);
  };

  const handle = (e, provider) => {
    ripple(e);
    onClick(provider);
  };

  return (
    <div className="socials">
      <button type="button" className="social" onClick={(e) => handle(e, "google")}
              disabled={!!busy} aria-label="Continue with Google">
        <span className="social-icon"><GlyphGoogle /></span>
        <span>{busy === "google" ? "…" : "Google"}</span>
      </button>
      <button type="button" className="social" onClick={(e) => handle(e, "facebook")}
              disabled={!!busy} aria-label="Continue with Facebook">
        <span className="social-icon"><GlyphFacebook /></span>
        <span>{busy === "facebook" ? "…" : "Facebook"}</span>
      </button>
      <button type="button" className="social" onClick={(e) => handle(e, "dhis2")}
              disabled={!!busy} aria-label="Continue with DHIS2">
        <span className="social-icon"><GlyphDhis2 /></span>
        <span>{busy === "dhis2" ? "…" : "DHIS2"}</span>
      </button>
    </div>
  );
}


// ── Patient form ─────────────────────────────────────────────────

function PatientForm() {
  const [method, setMethod] = useState("phone");
  const [step, setStep]     = useState("identify");    // identify | otp
  const [cc, setCc]         = useState("+220");
  const [phone, setPhone]   = useState("");
  const [email, setEmail]   = useState("");
  const [password, setPw]   = useState("");
  const [otp, setOtp]       = useState("");
  const [otpDev, setOtpDev] = useState("");
  const [ctaState, setCtaState] = useState("idle");
  const [oauthBusy, setOauthBusy] = useState(null);
  const [error, setError]   = useState("");
  const [info, setInfo]     = useState("");

  const fullPhone = cc + phone;

  const sendOtp = async () => {
    if (phone.length < 6) { setError("Enter a valid phone number"); return; }
    setCtaState("loading"); setError(""); setInfo(""); setOtpDev("");
    const { data } = await post("/api/v1/auth/otp/send", { phone: fullPhone });
    if (data.error) { setCtaState("idle"); setError(data.error); return; }
    setCtaState("idle");
    setStep("otp");
    if (data.otp_dev) setOtpDev(data.otp_dev);
    setInfo(
      data.method === "twilio" || data.method === "textbelt"
        ? `Code sent to ${fullPhone} by SMS.`
        : data.message || "Code generated."
    );
  };

  // Persist patient auth to the localStorage keys currentAuthRole()
  // inspects, AND to the session_id slot App.jsx reads when it mounts.
  // Without this, the post-login handoff to "#/" redirects back to the
  // home page because `currentAuthRole()` returns null.
  const _persistPatient = (data) => {
    try {
      if (data.token)       localStorage.setItem("AMINA_TOKEN", data.token);
      if (data.patient)     localStorage.setItem("AMINA_PATIENT", JSON.stringify(data.patient));
      if (data.session_id)  localStorage.setItem("AMINA_SID", data.session_id);
      if (data.patient?.id) localStorage.setItem("AMINA_PATIENT_ID", data.patient.id);
      localStorage.setItem("AMINA_ACTIVE", "pt");
      // Redundant flat-string email key — RoleSwitcher's allowlist
      // falls back to this if the JSON AMINA_PATIENT blob ever fails
      // to parse. Belt-and-braces: the admin-patient pill has to stay
      // visible even if one of the storage keys is corrupted.
      if (data.patient?.email) {
        localStorage.setItem(
          "AMINA_PATIENT_EMAIL",
          String(data.patient.email).trim().toLowerCase(),
        );
      }
      // Signal bootstraps that also read these keys (RoleSwitcher,
      // InboxBell, AdminPatientLiteracyOverride) to re-check their
      // visibility gates immediately — otherwise the RoleSwitcher
      // pill waits up to 1.5 s for its polling interval to notice
      // the new AMINA_PATIENT and becomes invisible for that gap.
      try {
        window.dispatchEvent(new CustomEvent("amina:auth-changed"));
        window.dispatchEvent(new CustomEvent("amina:role-changed"));
      } catch { /* noop */ }
    } catch { /* noop */ }
  };

  const verifyOtp = async () => {
    if (otp.length !== 6) { setError("Enter the 6-digit code"); return; }
    setCtaState("loading"); setError("");
    const { data } = await post("/api/v1/auth/otp/verify", {
      phone: fullPhone, otp, name: "", age: 0, gender: "", region: "", conditions: [],
    });
    if (!data.success) { setCtaState("idle"); setError(data.error || "Verification failed"); return; }
    _persistPatient(data);
    setCtaState("success");
    setTimeout(() => handoff("#/patient"), 700);
  };

  const emailLogin = async () => {
    if (!email || !password) { setError("Enter your email and password"); return; }
    setCtaState("loading"); setError("");
    const { ok, data } = await post("/api/v1/auth/login/email", { email, password });
    if (!ok || !data.success) {
      setCtaState("idle");
      setError(data.error || "Login failed");
      return;
    }
    _persistPatient(data);
    setCtaState("success");
    setTimeout(() => handoff("#/patient"), 700);
  };

  const doOAuth = async (provider) => {
    setOauthBusy(provider); setError("");
    const r = await oauthLogin(provider);
    setOauthBusy(null);
    if (!r.ok) setError(r.error || `${provider} sign-in failed`);
  };

  // OTP entry step
  if (step === "otp") {
    return (
      <div className="amina-form">
        <button
          type="button"
          onClick={() => { setStep("identify"); setOtp(""); setError(""); setInfo(""); setCtaState("idle"); }}
          style={{
            background: "transparent", border: "none", padding: "0 0 14px 0",
            color: "var(--text-secondary)", fontFamily: "inherit",
            fontSize: 12.5, fontWeight: 600, cursor: "pointer",
            display: "inline-flex", alignItems: "center", gap: 4,
          }}
        >
          <ChevronLeft size={14} strokeWidth={2} /> Change number
        </button>

        <p className="field-hint" style={{ margin: "0 0 14px", fontSize: 12.5, color: "var(--text-secondary)" }}>
          Sent a code to <strong style={{ color: "var(--text-primary)" }}>{fullPhone}</strong>
        </p>

        {info  && <Alert kind="info">{info}</Alert>}
        {error && <Alert kind="error">{error}</Alert>}
        {otpDev && <Alert kind="info">Dev code: <strong>{otpDev}</strong></Alert>}

        <Field
          label="6-digit code"
          value={otp}
          onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
          onEnter={verifyOtp}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          autoFocus
          otp
        />

        <div style={{ marginTop: 16 }}>
          <CTA
            state={ctaState}
            label={ctaState === "success" ? "Signed in" : "Verify & sign in"}
            onClick={verifyOtp}
            disabled={otp.length !== 6}
          />
        </div>

        <div className="switch-row">
          Didn't get it?{" "}
          <button type="button" className="link" onClick={sendOtp} disabled={ctaState === "loading"}>
            Resend code
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="amina-form">
      <SocialRow busy={oauthBusy} onClick={doOAuth} />

      <div className="divider">
        <div className="divider-line" />
        <span className="divider-label">or continue with</span>
        <div className="divider-line" />
      </div>

      <MethodToggle value={method} onChange={(m) => { setMethod(m); setError(""); setCtaState("idle"); }} />

      {error && <Alert kind="error">{error}</Alert>}

      {method === "phone" ? (
        <>
          <PhoneField
            cc={cc} onCc={setCc}
            phone={phone} onPhone={setPhone}
            onEnter={sendOtp}
            autoFocus
          />
          <div className="field-hint">
            <Lock size={10} strokeWidth={2} />
            <span>We'll send a 6-digit code. Standard SMS rates may apply.</span>
          </div>
          <div style={{ marginTop: 20 }}>
            <CTA
              state={ctaState}
              label="Send verification code"
              onClick={sendOtp}
              disabled={phone.length < 6}
            />
          </div>
        </>
      ) : (
        <>
          <Field
            label="Email address"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onEnter={emailLogin}
            autoComplete="email"
            autoFocus
          />
          <PasswordFieldInline
            label="Password"
            value={password}
            onChange={(e) => setPw(e.target.value)}
            onEnter={emailLogin}
            autoComplete="current-password"
          />
          <div style={{ marginTop: 20 }}>
            <CTA
              state={ctaState}
              label={ctaState === "success" ? "Signed in" : "Sign in"}
              onClick={emailLogin}
              disabled={!email || !password}
            />
          </div>
        </>
      )}

      <div className="switch-row">
        New to AMINA?{" "}
        <a href="#/signup" onClick={(e) => { e.preventDefault(); navigate("#/signup"); }}>
          Create an account
        </a>
      </div>
    </div>
  );
}


// ── Caregiver form ───────────────────────────────────────────────

function CaregiverForm() {
  const [cc, setCc]       = useState("+220");
  const [phone, setPhone] = useState("");
  const [pin, setPin]     = useState("");
  const [ctaState, setCtaState] = useState("idle");
  const [error, setError] = useState("");

  const submit = async () => {
    if (phone.length < 6) { setError("Enter your phone number"); return; }
    if (pin.length !== 4) { setError("Enter your 4-digit PIN"); return; }
    setCtaState("loading"); setError("");
    const { ok, data } = await post("/api/v1/caregiver/login", {
      phone: `${cc}${phone}`, pin,
    });
    if (!ok || !data.token) {
      setCtaState("idle");
      setError(data.detail || data.error || "Invalid phone or PIN");
      return;
    }
    // Persist to the localStorage keys currentAuthRole() + CaregiverPortal
    // look for. Without this, handoff("#/") bounces back to the home page
    // because no `cg_token` → currentAuthRole returns null.
    // CaregiverPortal expects `cg_info` as a single JSON blob (matches
    // the convention already used by AuthScreen.jsx).
    try {
      localStorage.setItem("cg_token", data.token);
      localStorage.setItem("cg_info", JSON.stringify({
        name:         data.name         || "",
        caregiver_id: data.caregiver_id || "",
        patient_id:   data.patient_id   || "",
        permissions:  data.permissions  || [],
      }));
      localStorage.setItem("AMINA_ROLE", "clinician");
      localStorage.setItem("AMINA_ACTIVE", "cg");
    } catch { /* noop */ }
    try {
      window.dispatchEvent(new CustomEvent("amina:role-changed", { detail: { role: "clinician" } }));
    } catch { /* noop */ }
    setCtaState("success");
    setTimeout(() => handoff("#/caregiver"), 700);
  };

  return (
    <div className="amina-form">
      {error && <Alert kind="error">{error}</Alert>}

      <PhoneField
        cc={cc} onCc={setCc}
        phone={phone} onPhone={setPhone}
        onEnter={submit}
        autoFocus
      />

      <Field
        label="4-digit PIN"
        type="password"
        inputMode="numeric"
        value={pin}
        onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
        onEnter={submit}
        maxLength={4}
        autoComplete="off"
        otp
      />

      <div style={{ marginTop: 20 }}>
        <CTA
          state={ctaState}
          label={ctaState === "success" ? "Signed in" : "Sign in as caregiver"}
          onClick={submit}
          disabled={pin.length !== 4 || !phone}
        />
      </div>

      <div className="switch-row">
        Got an invite code?{" "}
        <a href="#/signup?t=cg" onClick={(e) => { e.preventDefault(); navigate("#/signup?t=cg"); }}>
          Register as caregiver
        </a>
      </div>
    </div>
  );
}


// ── Admin form ───────────────────────────────────────────────────

function AdminForm() {
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [ctaState, setCtaState] = useState("idle");
  const [error, setError]       = useState("");

  const submit = async () => {
    if (!user || !pass) { setError("Enter username and password"); return; }
    setCtaState("loading"); setError("");
    const { ok, data } = await post("/api/v1/admin/login", {
      username: user, password: pass,
    });
    if (!ok || !data.token) {
      setCtaState("idle");
      setError(data.error || "Invalid credentials");
      return;
    }
    try {
      localStorage.setItem("AMINA_ADMIN_TOKEN", data.token);
      localStorage.setItem("AMINA_ADMIN", "true");
      localStorage.setItem("AMINA_ACTIVE", "ad");
    } catch { /* noop */ }
    // Force the observatory policy gate to re-prompt on this sign-in,
    // even if the user signed out and signed back in within the same
    // browser tab (sessionStorage survives intra-tab sign-out
    // otherwise, so the Phase-3 per-session storage doesn't cover
    // this case on its own).
    try {
      const { clearObservatoryConsent } = await import("../../auth/signOut.js");
      clearObservatoryConsent();
      window.dispatchEvent(new CustomEvent("amina:auth-changed"));
    } catch { /* noop */ }
    setCtaState("success");
    setTimeout(() => handoff("#/admin/console"), 700);
  };

  return (
    <div className="amina-form">
      {error && <Alert kind="error">{error}</Alert>}

      <Field
        label="Administrator username"
        value={user}
        onChange={(e) => setUser(e.target.value)}
        onEnter={submit}
        autoComplete="username"
        autoFocus
      />

      <PasswordFieldInline
        label="Password"
        value={pass}
        onChange={(e) => setPass(e.target.value)}
        onEnter={submit}
        autoComplete="current-password"
      />

      <div style={{ marginTop: 20 }}>
        <CTA
          state={ctaState}
          label={ctaState === "success" ? "Signed in" : "Sign in as admin"}
          onClick={submit}
          disabled={!user || !pass}
        />
      </div>
    </div>
  );
}


// ── Page shell ──────────────────────────────────────────────────

const ALLOWED_TABS = ["pt", "cg", "ad"];

export default function LoginPage({ initialTab }) {
  const [tab, setTab] = useState(() => {
    if (ALLOWED_TABS.includes(initialTab)) return initialTab;
    const m = window.location.hash.match(/t=([a-z]+)/i);
    return m && ALLOWED_TABS.includes(m[1]) ? m[1] : "pt";
  });

  useEffect(() => {
    if (ALLOWED_TABS.includes(initialTab)) {
      setTab(initialTab);
    }
  }, [initialTab]);

  const copy = ROLE_COPY[tab] || ROLE_COPY.pt;

  return (
    <div className="amina-auth-stage">
      <Background />

      <div className="corner-locale rise" style={{ "--d": "120ms" }}>
        <Globe size={11} strokeWidth={1.8} />
        <span>The Gambia · EN</span>
      </div>
      <div className="corner-status rise" style={{ "--d": "200ms" }}>
        <span className="brand-tag-dot" />
        <span>All systems calm</span>
      </div>

      <div className="card rise" style={{ "--d": "0ms" }}>
        <div className="brand rise" style={{ "--d": "120ms" }}>
          <div className="brand-mark" aria-hidden="true" />
          <div className="brand-name">AMINA</div>
          <div className="brand-tag">
            <span className="brand-tag-dot" />
            <span>Secure</span>
          </div>
        </div>

        <div className="rise" style={{ "--d": "160ms" }}>
          <Portrait role={tab} />
        </div>

        <div className="heading-block">
          <h1 className="hello rise" style={{ "--d": "220ms" }}>
            {copy.title} <em>{copy.emph}</em>
          </h1>
          <p className="hello-sub rise" style={{ "--d": "280ms" }}>
            {copy.sub}
          </p>
        </div>

        <div className="rise" style={{ "--d": "320ms" }}>
          <RoleTabs value={tab} onChange={setTab} />
        </div>

        <div className="rise" style={{ "--d": "420ms" }} key={tab}>
          {tab === "pt" && <PatientForm   />}
          {tab === "cg" && <CaregiverForm />}
          {tab === "ad" && <AdminForm     />}
        </div>

        <div className="trust rise" style={{ "--d": "820ms" }}>
          <Lock size={11} strokeWidth={1.8} />
          <span>HIPAA · end-to-end encrypted</span>
          <span className="trust-sep" />
          <span>v3.2</span>
        </div>
      </div>
    </div>
  );
}
