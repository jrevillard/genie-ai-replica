/**
 * SignupPage — #/signup route. Patient signup + Caregiver invite-code
 * registration on one page (admin accounts are provisioned out-of-band).
 */

import { useEffect, useState } from "react";
import { navigate } from "../AppRouter.jsx";
import PasswordField from "../../components/ui/PasswordField.jsx";
import CaregiverRegistrationWizard from "../../components/CaregiverRegistrationWizard.jsx";



const INPUT = {
  width: "100%", boxSizing: "border-box",
  padding: "11px 13px",
  background: "rgba(15, 23, 42, 0.75)",
  border: "1px solid rgba(148, 163, 184, 0.30)",
  borderRadius: 10,
  color: "#f1f5f9", fontSize: 14, fontFamily: "inherit", outline: "none",
};

const BTN = {
  width: "100%", padding: "12px 16px",
  background: "linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)",
  color: "#fff", border: "none", borderRadius: 10,
  fontSize: 14, fontWeight: 800, cursor: "pointer",
  boxShadow: "0 10px 24px rgba(99, 102, 241, 0.35)",
};


// Same absolute-URL pattern as LoginPage. Vite has no proxy, so a
// relative path like "/api/v1/auth/signup/email" would hit the dev
// server itself, return non-JSON, and surface as "Signup failed".
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
    return { ok: r.ok, status: r.status, data: await r.json().catch(() => ({})) };
  } catch {
    return { ok: false, status: 0, data: { error: "Network error — check your connection." } };
  }
}


function Tab({ active, onClick, icon, label }) {
  return (
    <button type="button" onClick={onClick}
            style={{
              flex: 1, padding: "10px 8px",
              background: active ? "rgba(99, 102, 241, 0.18)" : "transparent",
              border: "none",
              borderBottom: `2px solid ${active ? "#8b5cf6" : "transparent"}`,
              color: active ? "#fff" : "#94a3b8",
              fontSize: 13, fontWeight: 700, cursor: "pointer",
              display: "inline-flex", flexDirection: "column", alignItems: "center", gap: 2,
            }}>
      <span style={{ fontSize: 18 }}>{icon}</span>
      <span>{label}</span>
    </button>
  );
}


function Field({ label, children, span = 1 }) {
  return (
    <label style={{ display: "block", gridColumn: `span ${span}`, marginBottom: 12 }}>
      <span style={{
        display: "block", fontSize: 11, fontWeight: 700, letterSpacing: 0.4,
        textTransform: "uppercase", color: "#94a3b8", marginBottom: 6,
      }}>{label}</span>
      {children}
    </label>
  );
}


function Err({ children }) {
  return (
    <div style={{
      padding: "9px 12px", marginBottom: 10,
      background: "rgba(248, 113, 113, 0.12)",
      border: "1px solid rgba(248, 113, 113, 0.40)",
      color: "#fecaca", borderRadius: 8,
      fontSize: 12, fontWeight: 600,
    }}>{children}</div>
  );
}


function PatientSignup() {
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [name,     setName]     = useState("");
  const [age,      setAge]      = useState("");
  const [gender,   setGender]   = useState("female");
  const [region,   setRegion]   = useState("Banjul");
  const [cond,     setCond]     = useState("");
  const [busy,     setBusy]     = useState(false);
  const [error,    setError]    = useState("");

  const disabled = busy || !email || !password || !name || !age;

  const submit = async () => {
    if (disabled) return;
    setBusy(true); setError("");
    const { ok, data } = await post("/api/v1/auth/signup/email", {
      email, password,
      name,
      age:        parseInt(age, 10) || 0,
      gender,
      region,
      conditions: cond.split(",").map((s) => s.trim()).filter(Boolean),
      language:   "english",
    });
    setBusy(false);
    if (!ok || !data.success) { setError(data.error || "Signup failed"); return; }
    navigate("#/");
    setTimeout(() => { try { window.location.reload(); } catch { /* noop */ } }, 80);
  };

  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10 }}>
        <Field label="Full name" span={2}>
          <input style={INPUT} value={name} onChange={(e) => setName(e.target.value)}
                 placeholder="Awa Ceesay" />
        </Field>
        <Field label="Email" span={2}>
          <input style={INPUT} type="email" value={email}
                 onChange={(e) => setEmail(e.target.value)}
                 placeholder="you@example.com" />
        </Field>
        <Field label="Password" span={2}>
          <PasswordField
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Choose a strong password"
            autoComplete="new-password"
            inputStyle={INPUT}
          />
        </Field>
        <Field label="Age">
          <input style={INPUT} type="number" value={age}
                 onChange={(e) => setAge(e.target.value)} />
        </Field>
        <Field label="Gender">
          <select style={INPUT} value={gender}
                  onChange={(e) => setGender(e.target.value)}>
            <option value="female">Female</option>
            <option value="male">Male</option>
            <option value="other">Other</option>
          </select>
        </Field>
        <Field label="Region" span={2}>
          <input style={INPUT} value={region}
                 onChange={(e) => setRegion(e.target.value)}
                 placeholder="Kanifing" />
        </Field>
        <Field label="Conditions (comma separated)" span={2}>
          <input style={INPUT} value={cond}
                 onChange={(e) => setCond(e.target.value)}
                 placeholder="hypertension, diabetes" />
        </Field>
      </div>
      {error && <Err>{error}</Err>}
      <button style={{ ...BTN, opacity: disabled ? 0.5 : 1 }}
              disabled={disabled} onClick={submit}>
        {busy ? "Creating…" : "Create patient account"}
      </button>
    </>
  );
}


function CaregiverRegister() {
  return <CaregiverRegistrationWizard onDone={() => navigate("#/")} />;
}


export default function SignupPage({ initialTab }) {
  const [tab, setTab] = useState(() => {
    if (initialTab === "pt" || initialTab === "cg") return initialTab;
    const m = window.location.hash.match(/t=(pt|cg)/i);
    return m ? m[1] : "pt";
  });

  useEffect(() => {
    if (initialTab === "pt" || initialTab === "cg") setTab(initialTab);
  }, [initialTab]);

  return (
    <div style={{ maxWidth: 520, margin: "64px auto 40px auto", padding: "0 18px" }}>
      <div style={{
        background: "rgba(15, 23, 42, 0.80)",
        border: "1px solid rgba(148, 163, 184, 0.18)",
        borderRadius: 18, padding: 0,
        boxShadow: "0 30px 80px rgba(0, 0, 0, 0.50)",
        overflow: "hidden",
      }}>
        <div style={{
          padding: "22px 24px 14px 24px",
          borderBottom: "1px solid rgba(148, 163, 184, 0.15)",
          textAlign: "center",
        }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: "#fff" }}>
            Create your AMINA account
          </div>
          <div style={{ fontSize: 12.5, color: "#94a3b8", marginTop: 4 }}>
            Start as a patient, or register as a caregiver with an invite code.
          </div>
        </div>
        <div style={{ display: "flex",
                      borderBottom: "1px solid rgba(148, 163, 184, 0.15)" }}>
          <Tab active={tab === "pt"} onClick={() => setTab("pt")} icon="👤" label="Patient" />
          <Tab active={tab === "cg"} onClick={() => setTab("cg")} icon="🫶" label="Caregiver" />
        </div>
        <div style={{ padding: "22px 24px 24px 24px" }}>
          {tab === "pt" && <PatientSignup />}
          {tab === "cg" && <CaregiverRegister />}
        </div>
        <div style={{
          padding: "12px 24px", textAlign: "center",
          borderTop: "1px solid rgba(148, 163, 184, 0.15)",
          fontSize: 12, color: "#94a3b8",
        }}>
          Already have an account?{" "}
          <a href="#/login" onClick={(e) => { e.preventDefault(); navigate("#/login"); }}
             style={{ color: "#a78bfa", fontWeight: 700 }}>Sign in</a>
        </div>
      </div>
    </div>
  );
}
