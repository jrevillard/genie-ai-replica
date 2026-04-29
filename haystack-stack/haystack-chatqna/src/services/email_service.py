"""
Email Service
=============
Sends transactional emails on behalf of the AMINA Care bot.

Config (via src/config.py / .env):
  SMTP_HOST  — mail server hostname  (e.g. smtp.gmail.com)
  SMTP_PORT  — 587 (STARTTLS) or 465 (SSL/TLS)
  SMTP_USER  — sender login / username
  SMTP_PASS  — sender password or app-password
  SMTP_FROM  — display address     (e.g. "AMINA Care <noreply@aminacare.health>")
  APP_URL    — frontend base URL   (e.g. https://aminacare.health)

When SMTP credentials are not configured the email body is printed to the
application log so developers can still test the reset flow locally.
"""

import logging
import smtplib
import ssl
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from src.config import settings

logger = logging.getLogger(__name__)


# ── Internal send helper ──────────────────────────────────────────────────────

def _send_email(to: str, subject: str, body_html: str, body_text: str) -> bool:
    host  = getattr(settings, "SMTP_HOST", "")
    port  = int(getattr(settings, "SMTP_PORT", 587))
    user  = getattr(settings, "SMTP_USER", "")
    pwd   = getattr(settings, "SMTP_PASS", "")
    from_ = getattr(settings, "SMTP_FROM", "AMINA Care <noreply@aminacare.health>")

    if not host or not user or not pwd:
        # Dev mode — log so the developer can copy the reset link
        logger.info(
            "[DEV EMAIL] SMTP not configured — printing email instead\n"
            f"  To:      {to}\n"
            f"  Subject: {subject}\n"
            f"{body_text}"
        )
        return False  # caller can treat False as "sent to log"

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"]    = from_
    msg["To"]      = to
    msg.attach(MIMEText(body_text, "plain"))
    msg.attach(MIMEText(body_html, "html"))

    try:
        ctx = ssl.create_default_context()
        if port == 465:
            with smtplib.SMTP_SSL(host, port, context=ctx) as smtp:
                smtp.login(user, pwd)
                smtp.sendmail(from_, to, msg.as_string())
        else:
            with smtplib.SMTP(host, port) as smtp:
                smtp.ehlo()
                smtp.starttls(context=ctx)
                smtp.login(user, pwd)
                smtp.sendmail(from_, to, msg.as_string())
        logger.info(f"Email sent to {to}: {subject}")
        return True
    except Exception as exc:
        logger.error(f"Email send failed to {to}: {exc}")
        return False


# ── Password reset email ──────────────────────────────────────────────────────

def send_password_reset_email(to_email: str, patient_name: str, reset_token: str) -> bool:
    """Send a password-reset link to the patient's registered email."""
    app_url   = getattr(settings, "APP_URL", "http://localhost:3000")
    reset_url = f"{app_url}?reset_token={reset_token}"
    subject   = "AMINA Care — Password Reset Request"

    body_text = (
        f"Hello {patient_name},\n\n"
        "We received a request to reset your AMINA Care password.\n\n"
        "Click the link below to set a new password (valid for 15 minutes):\n"
        f"{reset_url}\n\n"
        "If you did not request this, you can safely ignore this email. "
        "Your account remains secure.\n\n"
        "Stay healthy,\n"
        "AMINA Care Team"
    )

    body_html = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
</head>
<body style="margin:0;padding:0;background:#050810;font-family:'Helvetica Neue',Arial,sans-serif;color:#e2e8f0">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#050810;padding:40px 0">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0"
             style="background:#0f1117;border-radius:16px;border:1px solid rgba(99,102,241,.2);overflow:hidden;max-width:560px">

        <!-- ── Header ── -->
        <tr><td style="background:linear-gradient(135deg,#1e1b4b,#312e81);padding:32px;text-align:center">
          <div style="display:inline-block;background:rgba(255,255,255,.1);border-radius:12px;padding:12px 16px;margin-bottom:16px">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white"
                 stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 12h4l3-9 4 18 3-9h4"/>
            </svg>
          </div>
          <h1 style="color:white;font-size:24px;font-weight:700;margin:0">AMINA Care</h1>
          <p style="color:rgba(255,255,255,.7);font-size:14px;margin:8px 0 0">Your Trusted Healthcare Companion</p>
        </td></tr>

        <!-- ── Body ── -->
        <tr><td style="padding:40px 32px">
          <h2 style="color:#e2e8f0;font-size:20px;font-weight:600;margin:0 0 16px">
            Password Reset Request
          </h2>
          <p style="color:#94a3b8;font-size:15px;line-height:1.6;margin:0 0 16px">
            Hello <strong style="color:#e2e8f0">{patient_name}</strong>,
          </p>
          <p style="color:#94a3b8;font-size:15px;line-height:1.6;margin:0 0 24px">
            We received a request to reset your AMINA Care password.
            Click the button below to choose a new password.
            This link is valid for <strong style="color:#e2e8f0">15 minutes</strong>.
          </p>

          <div style="text-align:center;margin:32px 0">
            <a href="{reset_url}"
               style="display:inline-block;background:linear-gradient(135deg,#6366f1,#8b5cf6);
                      color:white;text-decoration:none;font-weight:600;font-size:15px;
                      padding:14px 36px;border-radius:10px;letter-spacing:.3px">
              Reset My Password
            </a>
          </div>

          <p style="color:#64748b;font-size:13px;line-height:1.6;margin:0 0 8px">
            Or copy this link into your browser:
          </p>
          <div style="background:#1e2333;border-radius:8px;padding:12px 16px;word-break:break-all">
            <a href="{reset_url}" style="color:#818cf8;font-size:12px;text-decoration:none">
              {reset_url}
            </a>
          </div>

          <p style="color:#64748b;font-size:13px;margin:24px 0 0">
            If you did not request a password reset, please ignore this email.
            Your account remains secure and no changes have been made.
          </p>
        </td></tr>

        <!-- ── Footer ── -->
        <tr><td style="background:#080b12;padding:20px 32px;border-top:1px solid rgba(99,102,241,.1)">
          <p style="color:#475569;font-size:12px;text-align:center;margin:0">
            Powered by WHO PEN Protocols &bull; AMINA Care &bull; Your health data stays private
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>"""

    return _send_email(to_email, subject, body_html, body_text)
