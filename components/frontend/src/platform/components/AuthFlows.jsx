import { useState } from "react";
import { authFlowApi } from "../api/platformApi";

const S = {
  container: {
    maxWidth: 420, margin: "60px auto", padding: 32, background: "#fff",
    borderRadius: 16, boxShadow: "0 4px 24px rgba(0,0,0,0.08)",
    fontFamily: "inherit",
  },
  title: { fontSize: 20, fontWeight: 700, color: "#1e293b", marginBottom: 8, textAlign: "center" },
  subtitle: { fontSize: 14, color: "#64748b", marginBottom: 24, textAlign: "center" },
  input: {
    width: "100%", padding: "10px 14px", border: "1px solid #d1d5db",
    borderRadius: 8, fontSize: 14, marginBottom: 12, boxSizing: "border-box",
  },
  btn: {
    width: "100%", padding: "10px 0", border: "none", borderRadius: 8,
    fontSize: 14, fontWeight: 600, cursor: "pointer", marginBottom: 8,
    transition: "opacity 0.15s",
  },
  btnPrimary: { background: "#3b82f6", color: "#fff" },
  btnSecondary: { background: "#f1f5f9", color: "#334155" },
  msg: (ok) => ({
    padding: "10px 14px", borderRadius: 8, marginBottom: 12, fontSize: 13,
    background: ok ? "#f0fdf4" : "#fef2f2",
    color: ok ? "#16a34a" : "#dc2626",
    border: `1px solid ${ok ? "#bbf7d0" : "#fecaca"}`,
  }),
  link: { color: "#3b82f6", cursor: "pointer", fontSize: 13, textAlign: "center", marginTop: 8 },
};

export function ForgotPasswordForm({ onBack }) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!email.trim()) return;
    setLoading(true);
    setStatus(null);
    try {
      await authFlowApi.initiatePasswordReset(email.trim());
      setStatus({ ok: true, msg: "Password reset link sent! Check your email." });
    } catch (err) {
      setStatus({ ok: false, msg: "Failed to send reset link. Try again." });
    }
    setLoading(false);
  };

  return (
    <div style={S.container}>
      <div style={S.title}>Reset Password</div>
      <div style={S.subtitle}>Enter your email to receive a reset link</div>
      {status && <div style={S.msg(status.ok)}>{status.msg}</div>}
      <form onSubmit={submit}>
        <input
          style={S.input}
          type="email"
          placeholder="Email address"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <button style={{ ...S.btn, ...S.btnPrimary }} disabled={loading}>
          {loading ? "Sending..." : "Send Reset Link"}
        </button>
      </form>
      {onBack && (
        <div style={S.link} onClick={onBack}>
          Back to login
        </div>
      )}
    </div>
  );
}

export function ResetPasswordForm({ token, onSuccess }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (password !== confirm) {
      setStatus({ ok: false, msg: "Passwords do not match" });
      return;
    }
    if (password.length < 8) {
      setStatus({ ok: false, msg: "Password must be at least 8 characters" });
      return;
    }
    setLoading(true);
    setStatus(null);
    try {
      await authFlowApi.resetPassword(token, password);
      setStatus({ ok: true, msg: "Password reset successfully!" });
      setTimeout(() => onSuccess?.(), 1500);
    } catch {
      setStatus({ ok: false, msg: "Reset failed. The link may have expired." });
    }
    setLoading(false);
  };

  return (
    <div style={S.container}>
      <div style={S.title}>Set New Password</div>
      <div style={S.subtitle}>Enter your new password</div>
      {status && <div style={S.msg(status.ok)}>{status.msg}</div>}
      <form onSubmit={submit}>
        <input
          style={S.input}
          type="password"
          placeholder="New password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={8}
        />
        <input
          style={S.input}
          type="password"
          placeholder="Confirm password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
        />
        <button style={{ ...S.btn, ...S.btnPrimary }} disabled={loading}>
          {loading ? "Resetting..." : "Reset Password"}
        </button>
      </form>
    </div>
  );
}

export function EmailVerification({ token }) {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);

  useState(() => {
    if (!token) {
      setStatus({ ok: false, msg: "No verification token provided." });
      setLoading(false);
      return;
    }
    authFlowApi
      .verifyEmail(token)
      .then(() => setStatus({ ok: true, msg: "Email verified successfully! You can now log in." }))
      .catch(() => setStatus({ ok: false, msg: "Verification failed. The link may have expired." }))
      .finally(() => setLoading(false));
  }, [token]);

  const resend = async () => {
    const email = prompt("Enter your email to resend verification:");
    if (!email) return;
    try {
      await authFlowApi.resendVerification(email);
      setStatus({ ok: true, msg: "Verification email resent!" });
    } catch {
      setStatus({ ok: false, msg: "Failed to resend. Please try again." });
    }
  };

  return (
    <div style={S.container}>
      <div style={S.title}>Email Verification</div>
      {loading && <div style={S.subtitle}>Verifying your email...</div>}
      {status && <div style={S.msg(status.ok)}>{status.msg}</div>}
      {status && !status.ok && (
        <button style={{ ...S.btn, ...S.btnSecondary }} onClick={resend}>
          Resend Verification Email
        </button>
      )}
    </div>
  );
}

export function ChangePasswordForm({ onSuccess }) {
  const [current, setCurrent] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (newPw !== confirm) {
      setStatus({ ok: false, msg: "Passwords do not match" });
      return;
    }
    if (newPw.length < 8) {
      setStatus({ ok: false, msg: "Password must be at least 8 characters" });
      return;
    }
    setLoading(true);
    setStatus(null);
    try {
      await authFlowApi.changePassword(current, newPw);
      setStatus({ ok: true, msg: "Password changed successfully!" });
      setCurrent("");
      setNewPw("");
      setConfirm("");
      onSuccess?.();
    } catch {
      setStatus({ ok: false, msg: "Failed to change password. Check your current password." });
    }
    setLoading(false);
  };

  return (
    <div style={{ maxWidth: 420 }}>
      <div style={{ ...S.title, textAlign: "left", fontSize: 16, marginBottom: 16 }}>
        Change Password
      </div>
      {status && <div style={S.msg(status.ok)}>{status.msg}</div>}
      <form onSubmit={submit}>
        <input
          style={S.input}
          type="password"
          placeholder="Current password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          required
        />
        <input
          style={S.input}
          type="password"
          placeholder="New password"
          value={newPw}
          onChange={(e) => setNewPw(e.target.value)}
          required
          minLength={8}
        />
        <input
          style={S.input}
          type="password"
          placeholder="Confirm new password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
        />
        <button style={{ ...S.btn, ...S.btnPrimary }} disabled={loading}>
          {loading ? "Changing..." : "Change Password"}
        </button>
      </form>
    </div>
  );
}
