import { useState } from "react";
import PasswordField from "./components/ui/PasswordField.jsx";
import Button3D from "./components/ui/Button3D.jsx";

const API = (window.AMINA_API || "http://localhost:8000").replace(/\/+$/, "");

const COUNTRIES = [
  { code: "+91",  label: "India (+91)",      flag: "\u{1F1EE}\u{1F1F3}", ph: "98XXX XXXXX" },
  { code: "+220", label: "Gambia (+220)",    flag: "\u{1F1EC}\u{1F1F2}", ph: "7XX XXXX" },
  { code: "+57",  label: "Colombia (+57)",   flag: "\u{1F1E8}\u{1F1F4}", ph: "3XX XXX XXXX" },
  { code: "+1",   label: "USA (+1)",         flag: "\u{1F1FA}\u{1F1F8}", ph: "XXX XXX XXXX" },
  { code: "+44",  label: "UK (+44)",         flag: "\u{1F1EC}\u{1F1E7}", ph: "7XXX XXXXXX" },
  { code: "+234", label: "Nigeria (+234)",   flag: "\u{1F1F3}\u{1F1EC}", ph: "80X XXX XXXX" },
  { code: "+221", label: "Senegal (+221)",   flag: "\u{1F1F8}\u{1F1F3}", ph: "7X XXX XXXX" },
  { code: "+233", label: "Ghana (+233)",     flag: "\u{1F1EC}\u{1F1ED}", ph: "XX XXX XXXX" },
  { code: "+254", label: "Kenya (+254)",     flag: "\u{1F1F0}\u{1F1EA}", ph: "7XX XXXXXX" },
  { code: "+27",  label: "S.Africa (+27)",   flag: "\u{1F1FF}\u{1F1E6}", ph: "XX XXX XXXX" },
  { code: "+971", label: "UAE (+971)",       flag: "\u{1F1E6}\u{1F1EA}", ph: "5X XXX XXXX" },
  { code: "+55",  label: "Brazil (+55)",     flag: "\u{1F1E7}\u{1F1F7}", ph: "XX XXXXX XXXX" },
  { code: "+49",  label: "Germany (+49)",    flag: "\u{1F1E9}\u{1F1EA}", ph: "XXX XXXXXXX" },
  { code: "+33",  label: "France (+33)",     flag: "\u{1F1EB}\u{1F1F7}", ph: "X XX XX XX XX" },
];

export default function AuthScreen({ onLogin, onAdminLogin, onCaregiverLogin }) {
  // Read ?reset_token from URL once at mount (lazy initializer — no useEffect needed)
  const _initialToken = new URLSearchParams(window.location.search).get("reset_token") || "";
  if (_initialToken) window.history.replaceState({}, "", window.location.pathname);

  // Steps: "phone" → "otp" → done (or "email_login" / "email_signup" / "admin"
  //         "forgot_password" → "reset_password")
  const [step, setStep] = useState(_initialToken ? "reset_password" : "phone");
  const [method, setMethod] = useState("phone"); // "phone" | "email"
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  // Phone fields
  const [cc, setCc] = useState("+91");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [otpDev, setOtpDev] = useState("");
  const [smsMethod, setSmsMethod] = useState("");

  // Email fields
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);

  // Profile fields (shown after OTP verify if new user, or email signup)
  const [name, setName] = useState("");
  const [age, setAge] = useState("");
  const [gender, setGender] = useState("other");
  const [region, setRegion] = useState("Kanifing");
  const [conditions, setConditions] = useState([]);


  // Password recovery — resetToken is read-only (comes from URL), never mutated
  const [resetEmail, setResetEmail] = useState("");
  const resetToken = _initialToken;
  const [newPassword, setNewPassword] = useState("");
  const [showNewPw, setShowNewPw] = useState(false);

  // Admin
  const [adminUser, setAdminUser] = useState("");
  const [adminPass, setAdminPass] = useState("");

  const post = async (url, body) => {
    const r = await fetch(API + url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return r.json();
  };

  const fullPhone = cc + phone;
  const selectedCountry = COUNTRIES.find(c => c.code === cc) || COUNTRIES[0];

  // ── Step 1: Send OTP ──
  const sendOtp = async () => {
    if (!phone || phone.length < 6) { setError("Enter a valid phone number"); return; }
    setLoading(true); setError(""); setInfo(""); setOtpDev("");
    try {
      const d = await post("/api/v1/auth/otp/send", { phone: fullPhone });
      if (d.error) { setError(d.error); }
      else {
        setStep("otp");
        setSmsMethod(d.method || "");
        if (d.otp_dev) setOtpDev(d.otp_dev);
        if (d.method === "textbelt" || d.method === "twilio") {
          setInfo(`Code sent to ${d.phone} via SMS`);
        } else {
          setInfo(d.message || "Code generated");
        }
      }
    } catch { setError("Network error. Check connection."); }
    setLoading(false);
  };

  // ── Step 2: Verify OTP ──
  const verifyOtp = async () => {
    if (otp.length !== 6) { setError("Enter the 6-digit code"); return; }
    setLoading(true); setError(""); setInfo("");
    try {
      const d = await post("/api/v1/auth/otp/verify", {
        phone: fullPhone, otp, name: name || "", age: parseInt(age) || 0, gender, region, conditions,
      });
      if (d.success) {
        onLogin(d.token, d.patient, d.session_id);
      } else {
        setError(d.error || "Verification failed");
      }
    } catch { setError("Network error."); }
    setLoading(false);
  };

  // ── OAuth login (Google / Facebook / DHIS2) ──
  const oauthLogin = async (provider) => {
    setLoading(true); setError("");
    try {
      let accessToken = "";

      if (provider === "google") {
        const clientId = window.__AMINA_GOOGLE_CLIENT_ID || "";
        if (!clientId || clientId.includes("%VITE_")) {
          setError("Google login not configured. Set VITE_GOOGLE_CLIENT_ID in frontend .env");
          setLoading(false); return;
        }
        if (!window.google) {
          setError("Google SDK failed to load. Check your internet connection.");
          setLoading(false); return;
        }
        accessToken = await new Promise((resolve, reject) => {
          window.google.accounts.oauth2.initTokenClient({
            client_id: clientId,
            scope: "email profile openid",
            callback: (resp) => resp.error ? reject(new Error(resp.error)) : resolve(resp.access_token),
          }).requestAccessToken();
        });

      } else if (provider === "facebook") {
        const appId = window.__AMINA_FACEBOOK_APP_ID || "";
        if (!appId || appId.includes("%VITE_")) {
          setError("Facebook login not configured. Set VITE_FACEBOOK_APP_ID in frontend .env");
          setLoading(false); return;
        }
        // 2026-05-04: wait for FB.init() to actually complete, not just
        // for the SDK script to load. The SDK is async/defer; FB.init
        // runs only after fbAsyncInit fires (in index.html) which sets
        // window.__AMINA_FB_INIT_DONE. Calling FB.login() before init
        // throws "init not called with valid version". Up to 5 s wait.
        const fbDeadline = Date.now() + 5000;
        while (Date.now() < fbDeadline && !(window.FB && window.__AMINA_FB_INIT_DONE)) {
          await new Promise((r) => setTimeout(r, 50));
        }
        if (window.__AMINA_FB_INIT_ERROR) {
          setError("Facebook SDK init failed: " + window.__AMINA_FB_INIT_ERROR);
          setLoading(false); return;
        }
        if (!window.FB) {
          setError("Facebook SDK failed to load. Check your internet connection.");
          setLoading(false); return;
        }
        if (!window.__AMINA_FB_INIT_DONE) {
          setError("Facebook SDK loaded but FB.init() never ran. Reload the page.");
          setLoading(false); return;
        }
        accessToken = await new Promise((resolve, reject) => {
          window.FB.login((resp) => {
            resp.status === "connected"
              ? resolve(resp.authResponse.accessToken)
              : reject(new Error("Facebook login cancelled"));
          }, { scope: "email,public_profile" });
        });

      } else if (provider === "dhis2") {
        const dhis2Url = (window.__AMINA_DHIS2_URL || "").replace(/%VITE_[^%]+%/g, "");
        if (!dhis2Url) {
          setError("DHIS2 login not configured. Set VITE_DHIS2_BASE_URL in frontend .env");
          setLoading(false); return;
        }
        const redirectUri = encodeURIComponent(window.location.origin + "/oauth/dhis2");
        const popup = window.open(
          `${dhis2Url}/uaa/oauth/authorize?response_type=token&client_id=amina&redirect_uri=${redirectUri}`,
          "dhis2_login", "width=600,height=700"
        );
        accessToken = await new Promise((resolve, reject) => {
          const timer = setInterval(() => {
            try {
              if (popup.closed) { clearInterval(timer); reject(new Error("DHIS2 login cancelled")); return; }
              const hash = popup.location.hash;
              if (hash) {
                clearInterval(timer); popup.close();
                resolve(new URLSearchParams(hash.slice(1)).get("access_token") || "");
              }
            } catch { /* cross-origin — still loading */ }
          }, 500);
          setTimeout(() => { clearInterval(timer); popup.close(); reject(new Error("DHIS2 login timed out")); }, 120000);
        });
      }

      const d = await post("/api/v1/auth/oauth/callback", { provider, access_token: accessToken, id_token: "" });
      if (d.success) onLogin(d.token, d.patient, d.session_id);
      else setError(d.error || `${provider} login failed`);
    } catch (e) {
      setError(e.message || `${provider} login failed`);
    }
    setLoading(false);
  };

  // ── Email login ──
  const emailLogin = async () => {
    setLoading(true); setError("");
    try {
      const d = await post("/api/v1/auth/login/email", { email, password });
      if (d.success) onLogin(d.token, d.patient, d.session_id);
      else setError(d.error || "Login failed");
    } catch { setError("Network error."); }
    setLoading(false);
  };

  // ── Email signup ──
  const emailSignup = async () => {
    if (!name.trim()) { setError("Name is required"); return; }
    setLoading(true); setError("");
    try {
      const d = await post("/api/v1/auth/signup/email", {
        email, password, name, phone: cc.replace("+","") + phone,
        age: parseInt(age) || 0, gender, region, conditions, language: "english",
      });
      if (d.success) onLogin(d.token, d.patient, d.session_id);
      else setError(d.error || "Signup failed");
    } catch { setError("Network error."); }
    setLoading(false);
  };

  // ── Admin login ──
  const adminLogin = async () => {
    setLoading(true); setError("");
    try {
      const d = await post("/api/v1/admin/login", { username: adminUser, password: adminPass });
      if (d.success) onAdminLogin(d.token);
      else setError(d.error || "Invalid credentials");
    } catch { setError("Network error."); }
    setLoading(false);
  };

  // ── Caregiver login / register ──
  const [cgPhone, setCgPhone] = useState("");
  const [cgPin, setCgPin] = useState("");
  const [cgTab, setCgTab] = useState("login");   // "login" | "register"
  // Register fields
  const [cgName, setCgName] = useState("");
  const [cgInviteCode, setCgInviteCode] = useState("");
  const [cgRel, setCgRel] = useState("chw");

  const caregiverLogin = async () => {
    if (!cgPhone || cgPin.length !== 4) { setError("Enter phone and 4-digit PIN"); return; }
    setLoading(true); setError("");
    try {
      const d = await post("/api/v1/caregiver/login", { phone: `${cc}${cgPhone}`, pin: cgPin });
      if (d.token) {
        localStorage.setItem("cg_token", d.token);
        localStorage.setItem("cg_info", JSON.stringify({ name: d.name, caregiver_id: d.caregiver_id, patient_id: d.patient_id, permissions: d.permissions }));
        localStorage.setItem("AMINA_ROLE", "clinician");
        try { window.dispatchEvent(new CustomEvent("amina:role-changed", { detail: { role: "clinician" } })); } catch {}
        onCaregiverLogin();
      } else {
        setError(d.detail || "Invalid phone or PIN");
      }
    } catch { setError("Network error."); }
    setLoading(false);
  };

  // ── Caregiver register (invite code flow) ──
  const caregiverRegister = async () => {
    if (!cgName.trim()) { setError("Enter your full name"); return; }
    if (!cgPhone || cgPhone.length < 5) { setError("Enter your phone number"); return; }
    if (cgInviteCode.trim().length !== 6) { setError("Enter the 6-character invite code"); return; }
    if (cgPin.length !== 4) { setError("Choose a 4-digit PIN"); return; }
    setLoading(true); setError("");
    try {
      const d = await post("/api/v1/caregiver/register", {
        phone: `${cc}${cgPhone}`,
        name: cgName.trim(),
        pin: cgPin,
        invite_code: cgInviteCode.trim().toUpperCase(),
        relationship: cgRel,
      });
      if (d.token) {
        localStorage.setItem("cg_token", d.token);
        localStorage.setItem("cg_info", JSON.stringify({ name: d.name, caregiver_id: d.caregiver_id, patient_id: d.patient_id, permissions: d.permissions }));
        localStorage.setItem("AMINA_ROLE", "clinician");
        try { window.dispatchEvent(new CustomEvent("amina:role-changed", { detail: { role: "clinician" } })); } catch {}
        onCaregiverLogin();
      } else if (d.caregiver_id) {
        // Registered but no auto-login token — switch to login tab
        setInfo("Registration successful! Sign in with your phone and PIN.");
        setCgTab("login");
        setError("");
      } else {
        setError(d.detail || d.error || "Registration failed");
      }
    } catch { setError("Network error."); }
    setLoading(false);
  };

  // ── Forgot password — request reset link ──
  const forgotPassword = async () => {
    if (!resetEmail.trim() || !resetEmail.includes("@")) { setError("Enter a valid email address"); return; }
    setLoading(true); setError(""); setInfo("");
    try {
      const d = await post("/api/v1/auth/password/reset/request", { email: resetEmail });
      setInfo("If that email is registered, a reset link has been sent. Check your inbox.");
      if (d.dev_token) {
        // SMTP not configured — show token in UI for local testing
        setInfo(`[Dev] No SMTP configured. Use this token to reset: ${d.dev_token}`);
      }
    } catch { setError("Network error. Please try again."); }
    setLoading(false);
  };

  // ── Reset password — confirm with token from email link ──
  const resetPasswordConfirm = async () => {
    if (newPassword.length < 4) { setError("Password must be at least 4 characters"); return; }
    setLoading(true); setError("");
    try {
      const d = await post("/api/v1/auth/password/reset/confirm", { token: resetToken, new_password: newPassword });
      if (d.success) {
        setInfo("Password updated! You can now sign in.");
        setStep("phone"); setNewPassword("");
      } else {
        setError(d.error || "Reset failed. The link may have expired.");
      }
    } catch { setError("Network error. Please try again."); }
    setLoading(false);
  };

  const toggleCond = (c) => setConditions(prev => prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c]);

  const goBack = () => { setStep("phone"); setOtp(""); setOtpDev(""); setError(""); setInfo(""); };

  return (
    <div className="ap">
      <div className="ap-grid" /><div className="ap-orb ap-o1" /><div className="ap-orb ap-o2" />
      <div className="ac">
        {/* ── Left: Brand ── */}
        <div className="ab">
          <div className="ab-c">
            <div className="ab-logo"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12h4l3-9 4 18 3-9h4"/></svg></div>
            <h1 className="ab-t">AMINA</h1>
            <p className="ab-s">Your Trusted Healthcare Companion</p>
            <div className="ab-d" />
            <p className="ab-desc">AI-powered health guidance for communities. Culturally sensitive. Clinically grounded. Always available.</p>
            <div className="ab-ft">
              {[["\u{1F3E5}","NCD Management (Diabetes, Hypertension, Asthma)"],["\u{1F512}","Private & Secure \u2014 Your data stays yours"],["\u{1F30D}","English & Mandinka \u2014 Built for communities"],["\u{1F4CB}","Remembers your health journey across visits"]].map(([ic,tx],i) => (
                <div key={i} className="ab-f"><span className="ab-fi">{ic}</span><span>{tx}</span></div>
              ))}
            </div>
            <div className="ab-bot"><span>Powered by WHO PEN Protocols</span><span>{"\u2022"}</span><span>Amina Care</span></div>
          </div>
        </div>

        {/* ── Right: Auth Form ── */}
        <div className="af">
          <div className="af-c">

            {/* ══ MAIN: Login / Signup with Phone(OTP) or Email tabs ══ */}
            {(step === "phone" || step === "signup") && (<>
              <h2 className="af-t">{step === "signup" ? "Create Your Account" : "Welcome Back"}</h2>
              <p className="af-s">{step === "signup" ? "Join AMINA for personalized healthcare guidance" : "Sign in to continue your health journey"}</p>

              {/* Phone / Email tabs */}
              <div className="af-tabs">
                <button className={"af-tab" + (method === "phone" ? " on" : "")} onClick={() => { setMethod("phone"); setError(""); }}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>
                  Phone + OTP
                </button>
                <button className={"af-tab" + (method === "email" ? " on" : "")} onClick={() => { setMethod("email"); setError(""); }}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>
                  Email
                </button>
              </div>

              {error && <div className="af-err">{error}</div>}

              {/* ── Phone + OTP method ── */}
              {method === "phone" ? (<>
                <div className="af-f"><label>Phone Number</label>
                  <div className="af-phone">
                    <select className="af-cc" value={cc} onChange={e => setCc(e.target.value)}>
                      {COUNTRIES.map(c => <option key={c.code} value={c.code}>{c.flag} {c.label}</option>)}
                    </select>
                    <input type="tel" className="af-ph" placeholder={selectedCountry.ph} value={phone} onChange={e => setPhone(e.target.value.replace(/\D/g,""))} maxLength={12} autoComplete="tel" />
                  </div>
                </div>
                {/* Signup: show profile fields */}
                {step === "signup" && (<>
                  <div className="af-f"><label>Full Name *</label><input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Fatou Ceesay" autoComplete="name" /></div>
                  <div className="af-row">
                    <div className="af-f af-half"><label>Age</label><input type="number" value={age} onChange={e => setAge(e.target.value)} placeholder="Age" min="0" max="120" /></div>
                    <div className="af-f af-half"><label>Gender</label><select value={gender} onChange={e => setGender(e.target.value)}><option value="female">Female</option><option value="male">Male</option><option value="other">Other</option></select></div>
                  </div>
                  <div className="af-f"><label>Region</label><select value={region} onChange={e => setRegion(e.target.value)}>{["Banjul","Kanifing","West_Coast","North_Bank","Lower_River","Central_River","Upper_River"].map(r => <option key={r} value={r}>{r.replace("_"," ")}</option>)}</select></div>
                  <div className="af-f"><label>Conditions (optional)</label>
                    <div className="af-conds">{["hypertension","diabetes","asthma","copd"].map(c => (
                      <button key={c} type="button" className={"af-chip" + (conditions.includes(c) ? " on" : "")} onClick={() => toggleCond(c)}>
                        {c === "hypertension" ? "High BP" : c.charAt(0).toUpperCase() + c.slice(1)}
                      </button>
                    ))}</div>
                  </div>
                </>)}
                <Button3D
                  type="button"
                  onClick={() => { if (step === "signup" && !name.trim()) { setError("Name is required"); return; } sendOtp(); }}
                  loading={loading}
                  disabled={loading || phone.length < 6}
                  style={{ marginTop: 4 }}
                >Send Verification Code</Button3D>

              {/* ── Email method ── */}
              </>) : (<>
                <div className="af-f"><label>Email Address</label><input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" /></div>
                <div className="af-f"><label>Password</label>
                  <PasswordField
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder={step === "signup" ? "Choose password (4+ chars)" : "Enter password"}
                    autoComplete={step === "signup" ? "new-password" : "current-password"}
                  />
                </div>
                {step === "signup" && (<>
                  <div className="af-f"><label>Full Name *</label><input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Fatou Ceesay" autoComplete="name" /></div>
                  <div className="af-row">
                    <div className="af-f af-half"><label>Age</label><input type="number" value={age} onChange={e => setAge(e.target.value)} placeholder="Age" min="0" max="120" /></div>
                    <div className="af-f af-half"><label>Gender</label><select value={gender} onChange={e => setGender(e.target.value)}><option value="female">Female</option><option value="male">Male</option><option value="other">Other</option></select></div>
                  </div>
                  <div className="af-f"><label>Region</label><select value={region} onChange={e => setRegion(e.target.value)}>{["Banjul","Kanifing","West_Coast","North_Bank","Lower_River","Central_River","Upper_River"].map(r => <option key={r} value={r}>{r.replace("_"," ")}</option>)}</select></div>
                  <div className="af-f"><label>Conditions (optional)</label>
                    <div className="af-conds">{["hypertension","diabetes","asthma","copd"].map(c => (
                      <button key={c} type="button" className={"af-chip" + (conditions.includes(c) ? " on" : "")} onClick={() => toggleCond(c)}>
                        {c === "hypertension" ? "High BP" : c.charAt(0).toUpperCase() + c.slice(1)}
                      </button>
                    ))}</div>
                  </div>
                </>)}
                <Button3D
                  type="button"
                  onClick={step === "signup" ? emailSignup : emailLogin}
                  loading={loading}
                  disabled={loading}
                  style={{ marginTop: 4 }}
                >{step === "signup" ? "Create Account" : "Sign In"}</Button3D>
                {step !== "signup" && (
                  <div className="af-forgot">
                    <button type="button" className="af-link" onClick={() => { setStep("forgot_password"); setResetEmail(email); setError(""); setInfo(""); }}>
                      Forgot password?
                    </button>
                  </div>
                )}
              </>)}
              <div className="af-div"><span>or continue with</span></div>
              <div className="af-oauth">
                <button className="af-ob" onClick={() => oauthLogin("google")} disabled={loading}>
                  <svg width="16" height="16" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
                  Google
                </button>
                <button className="af-ob" onClick={() => oauthLogin("facebook")} disabled={loading}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="#1877F2"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
                  Facebook
                </button>
                <button className="af-ob af-dhis2" onClick={() => oauthLogin("dhis2")} disabled={loading}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#0d47a1" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
                  DHIS2
                </button>
              </div>
              <div className="af-bottom">
                <button className="af-link" onClick={() => setStep("caregiver")}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
                  Caregiver Login
                </button>
                <button className="af-link" onClick={() => setStep("admin")}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                  Admin Login
                </button>
              </div>
              {/* Login / Signup toggle */}
              <div className="af-tog">
                {step === "signup"
                  ? <p>Already have an account? <button onClick={() => { setStep("phone"); setError(""); }}>Sign in</button></p>
                  : <p>Don't have an account? <button onClick={() => { setStep("signup"); setError(""); }}>Sign up free</button></p>
                }
              </div>
              <div className="af-hint"><details><summary>Test accounts (demo)</summary><div className="af-tests">
                <p><b>Fatou Ceesay</b> {"\u2014"} +220 1234001</p>
                <p><b>Lamin Jallow</b> {"\u2014"} +220 1234002</p>
                <p><b>Omar Bah</b> {"\u2014"} +220 1234004</p>
              </div></details></div>
            </>)}

            {/* ══ OTP VERIFY (separate screen after Send OTP) ══ */}
            {step === "otp" && (<>
              <button className="af-back" onClick={goBack}>{"\u2190"} Change number</button>
              <h2 className="af-t">Enter Verification Code</h2>
              <p className="af-s">We sent a 6-digit code to <strong>{fullPhone}</strong></p>
              {info && <div className="af-info">{info}</div>}
              {error && <div className="af-err">{error}</div>}
              {otpDev && <div className="af-dev">Your code: <strong>{otpDev}</strong>{smsMethod === "dev" ? " (SMS unavailable \u2014 showing here)" : " (dev mode)"}</div>}
              <div className="af-f">
                <input type="text" className="af-otp" value={otp} onChange={e => setOtp(e.target.value.replace(/\D/g,"").slice(0,6))} maxLength={6} autoFocus placeholder={"\u2022 \u2022 \u2022 \u2022 \u2022 \u2022"} />
              </div>
              <Button3D
                type="button"
                onClick={verifyOtp}
                loading={loading}
                disabled={loading || otp.length !== 6}
                style={{ marginTop: 4 }}
              >Verify & Sign In</Button3D>
              <button className="af-resend" onClick={sendOtp} disabled={loading}>Resend Code</button>
            </>)}

            {/* ══ FORGOT PASSWORD ══ */}
            {step === "forgot_password" && (<>
              <button className="af-back" onClick={() => { setStep("phone"); setMethod("email"); setError(""); setInfo(""); }}>{"\u2190"} Back to sign in</button>
              <h2 className="af-t">Reset Your Password</h2>
              <p className="af-s">Enter your registered email and we'll send a reset link from AMINA Care.</p>
              {error && <div className="af-err">{error}</div>}
              {info  && <div className="af-info">{info}</div>}
              <div className="af-f">
                <label>Email Address</label>
                <input type="email" value={resetEmail} onChange={e => setResetEmail(e.target.value)} placeholder="you@example.com" autoFocus autoComplete="email" />
              </div>
              <Button3D
                type="button"
                onClick={forgotPassword}
                loading={loading}
                disabled={loading || !resetEmail.includes("@")}
                style={{ marginTop: 4 }}
              >Send Reset Link</Button3D>
            </>)}

            {/* ══ RESET PASSWORD (arrived via email link ?reset_token=xxx) ══ */}
            {step === "reset_password" && (<>
              <h2 className="af-t">Choose a New Password</h2>
              <p className="af-s">Enter a new password for your AMINA Care account.</p>
              {error && <div className="af-err">{error}</div>}
              {info  && <div className="af-info">{info}</div>}
              <div className="af-f">
                <label>New Password</label>
                <PasswordField
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  placeholder="Choose password (4+ chars)"
                  autoComplete="new-password"
                  autoFocus
                />
              </div>
              <Button3D
                type="button"
                onClick={resetPasswordConfirm}
                loading={loading}
                disabled={loading || newPassword.length < 4}
                style={{ marginTop: 4 }}
              >Update Password</Button3D>
              <div className="af-tog"><p>Remembered it? <button onClick={() => { setStep("phone"); setMethod("email"); setError(""); setInfo(""); }}>Back to sign in</button></p></div>
            </>)}

            {/* ══ CAREGIVER LOGIN / REGISTER ══ */}
            {step === "caregiver" && (<>
              <button className="af-back" onClick={() => { setStep("phone"); setError(""); setInfo(""); }}>{"\u2190"} Back</button>
              <h2 className="af-t">{cgTab === "login" ? "Caregiver Login" : "Register as Caregiver"}</h2>
              <p className="af-s">{cgTab === "login" ? "Access your patient's health summary" : "Use the invite code your patient shared with you"}</p>

              {/* Login / Register tabs */}
              <div className="af-tabs" style={{ marginBottom: 16 }}>
                <button className={"af-tab" + (cgTab === "login" ? " on" : "")} onClick={() => { setCgTab("login"); setError(""); setInfo(""); }}>
                  Sign In
                </button>
                <button className={"af-tab" + (cgTab === "register" ? " on" : "")} onClick={() => { setCgTab("register"); setError(""); setInfo(""); }}>
                  Register with Invite Code
                </button>
              </div>

              {info  && <div className="af-info">{info}</div>}
              {error && <div className="af-err">{error}</div>}

              {/* Shared: phone field */}
              <div className="af-f">
                <label>Phone Number</label>
                <div className="af-phone">
                  <select className="af-cc" value={cc} onChange={e => setCc(e.target.value)}>
                    {COUNTRIES.map(c => <option key={c.code} value={c.code}>{c.flag} {c.label}</option>)}
                  </select>
                  <input type="tel" className="af-ph" placeholder="Phone number" value={cgPhone} onChange={e => setCgPhone(e.target.value.replace(/\D/g,""))} maxLength={12} />
                </div>
              </div>

              {/* Register-only fields */}
              {cgTab === "register" && (<>
                <div className="af-f">
                  <label>Full Name *</label>
                  <input value={cgName} onChange={e => setCgName(e.target.value)} placeholder="e.g. Fatou Ceesay" autoComplete="name" />
                </div>
                <div className="af-f">
                  <label>Invite Code (6 characters) *</label>
                  <input
                    value={cgInviteCode}
                    onChange={e => setCgInviteCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,"").slice(0,6))}
                    placeholder="e.g. A3BX7K"
                    style={{ letterSpacing: 6, fontSize: 18, fontWeight: 700, textAlign: "center", fontFamily: "monospace" }}
                    maxLength={6}
                  />
                </div>
                <div className="af-f">
                  <label>Your relationship to patient</label>
                  <select value={cgRel} onChange={e => setCgRel(e.target.value)}>
                    <option value="chw">Community Health Worker (CHW)</option>
                    <option value="spouse">Spouse</option>
                    <option value="parent">Parent</option>
                    <option value="child">Child</option>
                    <option value="sibling">Sibling</option>
                    <option value="friend">Friend / Neighbor</option>
                    <option value="other">Other</option>
                  </select>
                </div>
              </>)}

              {/* Shared: PIN field */}
              <div className="af-f">
                <label>{cgTab === "register" ? "Choose a 4-digit PIN *" : "4-digit PIN"}</label>
                <input type="password" value={cgPin} onChange={e => setCgPin(e.target.value.replace(/\D/g,"").slice(0,4))} placeholder="• • • •" maxLength={4} autoComplete="off" />
              </div>

              {cgTab === "login" ? (
                <Button3D
                  type="button"
                  onClick={caregiverLogin}
                  loading={loading}
                  disabled={loading || cgPin.length !== 4 || !cgPhone}
                  style={{ marginTop: 4 }}
                >Sign In as Caregiver</Button3D>
              ) : (
                <Button3D
                  type="button"
                  onClick={caregiverRegister}
                  loading={loading}
                  disabled={loading || cgPin.length !== 4 || !cgPhone || cgInviteCode.length !== 6 || !cgName.trim()}
                  style={{ marginTop: 4 }}
                >Register & Join Patient</Button3D>
              )}

              <div className="af-tog"><p>Not a caregiver? <button onClick={() => { setStep("phone"); setError(""); setInfo(""); }}>Patient login</button></p></div>
            </>)}

            {/* ══ ADMIN ══ */}
            {step === "admin" && (<>
              <button className="af-back" onClick={() => setStep("phone")}>{"\u2190"} Back</button>
              <h2 className="af-t">Admin Login</h2>
              <p className="af-s">Access the AMINA admin dashboard</p>
              {error && <div className="af-err">{error}</div>}
              <div className="af-f"><label>Username</label><input value={adminUser} onChange={e => setAdminUser(e.target.value)} placeholder="admin" autoFocus /></div>
              <div className="af-f"><label>Password</label>
                <PasswordField
                  value={adminPass}
                  onChange={e => setAdminPass(e.target.value)}
                  placeholder="Admin password"
                  autoComplete="current-password"
                />
              </div>
              <Button3D
                type="button"
                onClick={adminLogin}
                loading={loading}
                disabled={loading}
                style={{ marginTop: 4 }}
              >Login as Admin</Button3D>
            </>)}

          </div>
        </div>
      </div>
      <style>{CSS}</style>
    </div>
  );
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800;900&display=swap');
.ap{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:#050810;overflow:auto;padding:20px;font-family:'Outfit',sans-serif;color:#e2e8f0}
.ap *{box-sizing:border-box;margin:0;padding:0}
.ap-grid{position:fixed;inset:0;background-image:radial-gradient(rgba(99,102,241,.06)1px,transparent 1px);background-size:32px 32px;pointer-events:none}
.ap-orb{position:fixed;border-radius:50%;filter:blur(120px);pointer-events:none;opacity:.35}
.ap-o1{width:600px;height:600px;top:-150px;left:-150px;background:radial-gradient(circle,rgba(99,102,241,.3),transparent 70%)}
.ap-o2{width:500px;height:500px;bottom:-100px;right:-100px;background:radial-gradient(circle,rgba(168,85,247,.25),transparent 70%)}
.af-forgot{text-align:right;margin-top:6px}
.af-info{background:rgba(99,102,241,.12);border:1px solid rgba(99,102,241,.3);color:#a5b4fc;padding:10px 14px;border-radius:10px;font-size:13px;line-height:1.5;margin-bottom:12px}
.ac{display:flex;width:100%;max-width:980px;min-height:600px;background:rgba(12,17,40,.75);border:1px solid rgba(255,255,255,.06);border-radius:28px;backdrop-filter:blur(24px);box-shadow:0 40px 100px rgba(0,0,0,.6),inset 0 1px 0 rgba(255,255,255,.04);overflow:hidden;z-index:1;animation:au .5s cubic-bezier(.34,1.56,.64,1)}
@keyframes au{from{opacity:0;transform:translateY(24px)scale(.98)}to{opacity:1;transform:translateY(0)scale(1)}}
.ab{flex:0 0 380px;padding:48px 36px;display:flex;flex-direction:column;justify-content:center;background:linear-gradient(160deg,#141937,#0d1229 50%,#0a0f20);border-right:1px solid rgba(255,255,255,.04);position:relative;overflow:hidden}
.ab::before{content:'';position:absolute;top:-50%;right:-30%;width:400px;height:400px;background:radial-gradient(circle,rgba(99,102,241,.08),transparent 70%);border-radius:50%;pointer-events:none}
.ab-c{display:flex;flex-direction:column;gap:18px;position:relative;z-index:1}
.ab-logo{width:72px;height:72px;border-radius:20px;background:linear-gradient(135deg,#6366f1,#4f46e5,#7c3aed);display:flex;align-items:center;justify-content:center;margin-bottom:6px;box-shadow:0 12px 32px rgba(99,102,241,.35),inset 0 1px 0 rgba(255,255,255,.15)}
.ab-t{font-size:38px;font-weight:900;letter-spacing:4px;background:linear-gradient(135deg,#e2e8f0 30%,#818cf8 70%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
.ab-s{font-size:14px;color:#94a3b8;font-weight:500;margin-top:-8px}
.ab-d{width:50px;height:3px;border-radius:2px;background:linear-gradient(90deg,#6366f1,#a855f7)}
.ab-desc{font-size:13px;color:#64748b;line-height:1.8}
.ab-ft{display:flex;flex-direction:column;gap:12px;margin-top:4px}
.ab-f{display:flex;align-items:center;gap:10px;font-size:12px;color:#94a3b8;padding:7px 10px;border-radius:8px;background:rgba(255,255,255,.02);border:1px solid rgba(255,255,255,.03)}
.ab-fi{font-size:16px;flex-shrink:0}
.ab-bot{display:flex;gap:8px;font-size:9px;color:#475569;margin-top:16px;letter-spacing:.5px;text-transform:uppercase;font-weight:600}
.af{flex:1;padding:44px 40px;display:flex;flex-direction:column;justify-content:center;overflow-y:auto}
.af-c{max-width:380px;margin:0 auto;width:100%}
.af-t{font-size:24px;font-weight:800;color:#f1f5f9;margin-bottom:6px}
.af-s{font-size:13px;color:#64748b;margin-bottom:24px;line-height:1.6}
.af-s strong{color:#94a3b8}
.af-back{background:none;border:none;color:#64748b;font-size:12px;font-weight:600;font-family:'Outfit',sans-serif;cursor:pointer;margin-bottom:16px;padding:0;transition:color .2s}
.af-back:hover{color:#818cf8}
.af-tabs{display:flex;gap:8px;margin-bottom:20px}
.af-tab{flex:1;display:flex;align-items:center;justify-content:center;gap:8px;padding:11px 16px;border-radius:12px;border:1px solid rgba(255,255,255,.06);background:rgba(255,255,255,.02);color:#64748b;font-size:13px;font-weight:600;font-family:'Outfit',sans-serif;cursor:pointer;transition:all .25s}
.af-tab:hover{border-color:rgba(99,102,241,.25);color:#94a3b8}
.af-tab.on{background:rgba(99,102,241,.1);border-color:rgba(99,102,241,.35);color:#818cf8;box-shadow:0 0 20px rgba(99,102,241,.08)}
.af-err{padding:12px 16px;margin-bottom:16px;border-radius:12px;background:rgba(239,68,68,.06);border:1px solid rgba(239,68,68,.15);color:#f87171;font-size:12.5px;line-height:1.5;animation:ash .3s}
.af-info{padding:12px 16px;margin-bottom:16px;border-radius:12px;background:rgba(59,130,246,.06);border:1px solid rgba(59,130,246,.15);color:#60a5fa;font-size:12.5px;line-height:1.5}
.af-dev{padding:12px 16px;margin-bottom:16px;border-radius:12px;background:rgba(34,197,94,.06);border:1px solid rgba(34,197,94,.15);color:#4ade80;font-size:13px;text-align:center;font-weight:600}
.af-dev strong{font-size:20px;letter-spacing:4px}
@keyframes ash{0%,100%{transform:translateX(0)}25%{transform:translateX(-4px)}75%{transform:translateX(4px)}}
.af-f{display:flex;flex-direction:column;gap:7px;margin-bottom:14px}
.af-f label{font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.8px}
.af-f input,.af-f select{padding:12px 16px;border-radius:12px;border:1px solid rgba(255,255,255,.06);background:rgba(255,255,255,.03);color:#e2e8f0;font-size:14px;font-family:'Outfit',sans-serif;outline:none;transition:all .25s;width:100%}
.af-f input:focus,.af-f select:focus{border-color:rgba(99,102,241,.45);background:rgba(99,102,241,.04);box-shadow:0 0 0 3px rgba(99,102,241,.08)}
.af-f input::placeholder{color:#475569}
.af-f select{cursor:pointer}
.af-f select option{background:#0c1128;color:#e2e8f0}
.af-phone{display:flex;gap:8px}
.af-cc{flex:0 0 170px;padding:12px 10px;border-radius:12px;border:1px solid rgba(255,255,255,.06);background:rgba(255,255,255,.03);color:#e2e8f0;font-size:13px;font-family:'Outfit',sans-serif;cursor:pointer;outline:none;transition:all .25s}
.af-cc:focus{border-color:rgba(99,102,241,.45)}
.af-cc option{background:#0c1128;color:#e2e8f0}
.af-ph{flex:1;padding:12px 16px;border-radius:12px;border:1px solid rgba(255,255,255,.06);background:rgba(255,255,255,.03);color:#e2e8f0;font-size:16px;font-family:'Outfit',sans-serif;outline:none;letter-spacing:1.5px;transition:all .25s}
.af-ph:focus{border-color:rgba(99,102,241,.45);background:rgba(99,102,241,.04);box-shadow:0 0 0 3px rgba(99,102,241,.08)}
.af-ph::placeholder{color:#475569;letter-spacing:1px;font-size:14px}
.af-otp{text-align:center;letter-spacing:16px;font-size:28px!important;font-weight:800;padding:16px!important}
.af-ig{display:flex;align-items:center;border:1px solid rgba(255,255,255,.06);border-radius:12px;background:rgba(255,255,255,.03);overflow:hidden;transition:all .25s}
.af-ig:focus-within{border-color:rgba(99,102,241,.45);box-shadow:0 0 0 3px rgba(99,102,241,.08)}
.af-ig input{border:none!important;background:transparent!important;flex:1;padding:12px 16px;color:#e2e8f0;font-size:14px;font-family:'Outfit',sans-serif;outline:none;box-shadow:none!important}
.af-eye{padding:10px 14px;border:none;background:transparent;color:#64748b;font-size:10px;font-weight:800;cursor:pointer;font-family:'Outfit',sans-serif;letter-spacing:.8px;transition:color .2s}
.af-eye:hover{color:#818cf8}
.af-submit{width:100%;padding:14px;border-radius:14px;border:none;background:linear-gradient(135deg,#6366f1,#4f46e5);color:white;font-size:15px;font-weight:700;font-family:'Outfit',sans-serif;cursor:pointer;transition:all .3s;margin-top:4px;box-shadow:0 4px 16px rgba(99,102,241,.2)}
.af-submit:hover:not(:disabled){filter:brightness(1.1);transform:translateY(-2px);box-shadow:0 8px 28px rgba(99,102,241,.35)}
.af-submit:active:not(:disabled){transform:translateY(0)}
.af-submit:disabled{opacity:.45;cursor:not-allowed}
.af-spin{display:inline-block;width:20px;height:20px;border:2.5px solid rgba(255,255,255,.25);border-top-color:white;border-radius:50%;animation:asp .6s linear infinite}
@keyframes asp{to{transform:rotate(360deg)}}
.af-resend{width:100%;padding:10px;margin-top:10px;border-radius:10px;border:1px solid rgba(99,102,241,.2);background:transparent;color:#818cf8;font-size:12px;font-weight:700;font-family:'Outfit',sans-serif;cursor:pointer;transition:all .2s}
.af-resend:hover:not(:disabled){background:rgba(99,102,241,.06);border-color:rgba(99,102,241,.4)}
.af-resend:disabled{opacity:.4;cursor:not-allowed}
.af-div{display:flex;align-items:center;gap:16px;margin:20px 0}
.af-div::before,.af-div::after{content:'';flex:1;height:1px;background:rgba(255,255,255,.05)}
.af-div span{font-size:11px;color:#475569;text-transform:uppercase;letter-spacing:1px;font-weight:600}
.af-oauth{display:flex;flex-wrap:wrap;gap:8px}
.af-ob{flex:1;min-width:calc(50% - 4px);display:flex;align-items:center;justify-content:center;gap:7px;padding:10px 12px;border-radius:11px;border:1px solid rgba(255,255,255,.06);background:rgba(255,255,255,.02);color:#94a3b8;font-size:12px;font-weight:600;cursor:pointer;font-family:'Outfit',sans-serif;transition:all .25s}
.af-ob:hover{background:rgba(255,255,255,.05);border-color:rgba(255,255,255,.12);color:#e2e8f0;transform:translateY(-1px)}
.af-dhis2{border-color:rgba(13,71,161,.2)}
.af-dhis2:hover{background:rgba(13,71,161,.06);border-color:rgba(13,71,161,.4)}
.af-tog{text-align:center;margin-top:16px;font-size:13px;color:#64748b}
.af-tog button{background:none;border:none;color:#818cf8;cursor:pointer;font-weight:700;font-family:'Outfit',sans-serif;font-size:13px}
.af-tog button:hover{text-decoration:underline}
.af-row{display:flex;gap:12px}
.af-half{flex:1}
.af-conds{display:flex;flex-wrap:wrap;gap:8px}
.af-chip{padding:7px 16px;border-radius:20px;border:1px solid rgba(255,255,255,.06);background:rgba(255,255,255,.02);color:#94a3b8;font-size:12px;font-weight:600;cursor:pointer;font-family:'Outfit',sans-serif;transition:all .25s}
.af-chip:hover{border-color:rgba(99,102,241,.3);color:#e2e8f0}
.af-chip.on{background:rgba(99,102,241,.12);border-color:rgba(99,102,241,.4);color:#818cf8}
.af-bottom{display:flex;justify-content:center;gap:24px;margin-top:20px}
.af-link{background:none;border:none;color:#475569;font-size:11px;font-weight:600;font-family:'Outfit',sans-serif;cursor:pointer;display:flex;align-items:center;gap:6px;transition:color .2s;letter-spacing:.3px}
.af-link:hover{color:#818cf8}
.af-hint{margin-top:16px}
.af-hint details{border:1px solid rgba(255,255,255,.04);border-radius:10px;overflow:hidden;background:rgba(255,255,255,.01)}
.af-hint summary{padding:8px 14px;font-size:10px;color:#475569;cursor:pointer;font-weight:600}
.af-hint summary:hover{color:#94a3b8}
.af-tests{padding:10px 14px;font-size:11px;color:#64748b;line-height:2;border-top:1px solid rgba(255,255,255,.03)}
.af-tests p{margin:0}
.af-tests b{color:#94a3b8}
.af-row{display:flex;gap:12px}
.af-half{flex:1}
.af-conds{display:flex;flex-wrap:wrap;gap:8px}
.af-chip{padding:7px 16px;border-radius:20px;border:1px solid rgba(255,255,255,.06);background:rgba(255,255,255,.02);color:#94a3b8;font-size:12px;font-weight:600;cursor:pointer;font-family:'Outfit',sans-serif;transition:all .25s}
.af-chip:hover{border-color:rgba(99,102,241,.3);color:#e2e8f0}
.af-chip.on{background:rgba(99,102,241,.12);border-color:rgba(99,102,241,.4);color:#818cf8}
@media(max-width:768px){
  .ac{flex-direction:column;min-height:auto;max-width:500px;border-radius:20px}
  .ab{flex:0 0 auto;padding:28px 24px;border-right:none;border-bottom:1px solid rgba(255,255,255,.04)}
  .ab-t{font-size:28px}
  .ab-ft,.ab-bot{display:none}
  .af{padding:28px 24px}
  .af-phone{flex-direction:column}
  .af-cc{flex:1}
}
`;
