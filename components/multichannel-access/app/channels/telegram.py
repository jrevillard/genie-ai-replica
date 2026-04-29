# app/channels/telegram.py

"""
AMINA Telegram Bot — Tier 1 + Tier 2 + Tier 3 features.

Patient auth flows:
  /login  → phone → OTP code  → logged in (full patient context)
  /pin    → phone → 4-digit PIN → logged in
  /logout → clears session

Patient commands (require login):
  /profile   — name, age, conditions, medications
  /history   — last 5 consultations with triage levels
  /vitals    — guided flow: enter BP + glucose → saved + interpreted
  /careplan  — personalised care plan from last conversation
  /report    — consultation summary as PDF document
  /nudge     — today's One-Spoon Swap lifestyle tip
  /language  — switch between English and Mandinka

Open commands (no login needed):
  /start     — welcome + topic menu
  /help      — full command list
  /clear     — reset conversation
  /link      — link code from web app (legacy)
  /community — Bantaba village board + seasonal tips + healer bridge

Tier 2 extras:
  Photo messages → prescription scan via OpenAI Vision
  Inline 👍/👎 buttons after every AMINA response → feedback saved
  Voice in/out unchanged

Tier 3 — Caregiver access:
  /cglogin      — caregiver phone + PIN login
  /cglogout     — sign out caregiver session
  /cgdashboard  — pending alerts + patient count + recent events
  /cgpatients   — list assigned patients
  /cgalert      — send info alert: /cgalert <patient_id> <message>
  /cgwarn       — start guided warning alert flow
  /cgemergency  — start guided emergency alert flow

Tier 3 — VHW referral warm-handoff:
  /refer  → name → reason → patient phone → referral created in AMINA
"""

import logging
import re
from typing import Optional

import httpx
from fastapi import APIRouter, Request, Response, BackgroundTasks

from app.config import settings
from app.services.audio import convert_to_ogg_opus
from app.services.tg_auth import (
    TgAuthStore,
    IDLE, AWAIT_PHONE_OTP, AWAIT_OTP, AWAIT_PHONE_PIN, AWAIT_PIN,
    LOGGED_IN, AWAIT_BP, AWAIT_GLUCOSE,
    AWAIT_CG_PHONE, AWAIT_CG_PIN, CG_LOGGED_IN, AWAIT_CG_ALERT_MSG,
    AWAIT_REFER_NAME, AWAIT_REFER_REASON, AWAIT_REFER_PHONE,
    INTERMEDIATE_TTL, LOGGED_IN_TTL, CG_LOGGED_IN_TTL,
)

log = logging.getLogger("telegram")
router = APIRouter(prefix="/telegram", tags=["telegram"])

_tg_client: Optional[httpx.AsyncClient] = None


def _api() -> str:
    return f"https://api.telegram.org/bot{settings.TELEGRAM_BOT_TOKEN}"


async def _get_client() -> httpx.AsyncClient:
    global _tg_client
    if _tg_client is None or _tg_client.is_closed:
        _tg_client = httpx.AsyncClient(
            timeout=httpx.Timeout(30.0, connect=10.0),
            limits=httpx.Limits(max_connections=50, max_keepalive_connections=10),
        )
    return _tg_client


# ── WEBHOOK ───────────────────────────────────────────────────────────────────

@router.post("/webhook")
async def webhook(request: Request, bg: BackgroundTasks):
    if not settings.TELEGRAM_BOT_TOKEN:
        return Response(status_code=200)
    try:
        data = await request.json()
    except Exception:
        return Response(status_code=200)
    bg.add_task(_process_update, data)
    return Response(status_code=200)


async def _process_update(data: dict):
    from app.main import gateway, sessions
    from app.services.rate_limiter import RateLimiter

    try:
        # ── Callback query (inline keyboard feedback) ──
        callback = data.get("callback_query")
        if callback:
            await _on_callback(callback, gateway)
            return

        msg = data.get("message") or data.get("edited_message")
        if not msg:
            return

        chat_id = msg.get("chat", {}).get("id")
        if not chat_id:
            return

        user_id = str(chat_id)
        text = msg.get("text", "").strip()

        # Rate limiting
        rate_limiter = RateLimiter(sessions._redis)
        if not await rate_limiter.check("telegram", user_id):
            await _send_text(chat_id, "⏳ You're sending messages too quickly. Please wait a moment.")
            return

        auth = TgAuthStore(sessions._redis)
        state = await auth.get_state(chat_id)

        # ── Photos → prescription scan ──
        if msg.get("photo"):
            await _on_photo(chat_id, msg["photo"], msg.get("caption", ""), gateway, auth, state)
            return

        # ── Command routing ──
        if text.startswith("/start"):
            await _cmd_start(chat_id, msg, sessions, auth)
            return
        if text.startswith("/help"):
            await _cmd_help(chat_id, state)
            return
        if text.startswith("/clear"):
            data = await auth.get(chat_id)
            sid = data.get("session_id")
            if sid:
                await gateway.end_session(sid)
            await sessions.clear("telegram", user_id)
            await _send_text(chat_id, "🔄 Conversation cleared. Ask me anything!")
            return
        if text.startswith("/login"):
            await _cmd_login(chat_id, auth)
            return
        if text.startswith("/pin"):
            await _cmd_pin(chat_id, auth)
            return
        if text.startswith("/logout"):
            await _cmd_logout(chat_id, auth)
            return
        if text.startswith("/profile"):
            await _cmd_profile(chat_id, auth, gateway)
            return
        if text.startswith("/history"):
            await _cmd_history(chat_id, auth, gateway)
            return
        if text.startswith("/vitals"):
            await _cmd_vitals(chat_id, auth, state)
            return
        if text.startswith("/careplan"):
            await _cmd_careplan(chat_id, auth, gateway)
            return
        if text.startswith("/report"):
            await _cmd_report(chat_id, auth, gateway)
            return
        if text.startswith("/language"):
            await _cmd_language(chat_id, text, auth)
            return
        if text.startswith("/nudge"):
            await _cmd_nudge(chat_id, auth, gateway)
            return
        if text.startswith("/community"):
            await _cmd_community(chat_id, auth, gateway)
            return
        if text.startswith("/link"):
            await _cmd_link(chat_id, text)
            return
        if text.startswith("/skip"):
            await _handle_skip(chat_id, auth, state, gateway)
            return
        # Tier 3 — Caregiver commands
        if text.startswith("/cglogin"):
            await _cmd_cglogin(chat_id, auth)
            return
        if text.startswith("/cglogout"):
            await _cmd_cglogout(chat_id, auth)
            return
        if text.startswith("/cgdashboard"):
            await _cmd_cgdashboard(chat_id, auth, gateway)
            return
        if text.startswith("/cgpatients"):
            await _cmd_cgpatients(chat_id, auth, gateway)
            return
        if text.startswith("/cgemergency"):
            await _cmd_cg_alert_flow(chat_id, text, auth, "emergency")
            return
        if text.startswith("/cgwarn"):
            await _cmd_cg_alert_flow(chat_id, text, auth, "warning")
            return
        if text.startswith("/cgalert"):
            await _cmd_cgalert(chat_id, text, auth, gateway)
            return
        # Tier 3 — VHW referral
        if text.startswith("/refer"):
            await _cmd_refer(chat_id, auth)
            return

        # ── State machine: intercept text during flows ──
        if state == AWAIT_PHONE_OTP:
            await _handle_phone_for_otp(chat_id, text, auth, gateway)
            return
        if state == AWAIT_OTP:
            await _handle_otp_code(chat_id, text, auth, gateway)
            return
        if state == AWAIT_PHONE_PIN:
            await _handle_phone_for_pin(chat_id, text, auth, gateway)
            return
        if state == AWAIT_PIN:
            await _handle_pin_code(chat_id, text, auth, gateway)
            return
        if state == AWAIT_BP:
            await _handle_bp_input(chat_id, text, auth, gateway)
            return
        if state == AWAIT_GLUCOSE:
            await _handle_glucose_input(chat_id, text, auth, gateway)
            return
        # Tier 3 — Caregiver auth state machine
        if state == AWAIT_CG_PHONE:
            await _handle_cg_phone(chat_id, text, auth)
            return
        if state == AWAIT_CG_PIN:
            await _handle_cg_pin(chat_id, text, auth, gateway)
            return
        if state == AWAIT_CG_ALERT_MSG:
            await _handle_cg_alert_msg(chat_id, text, auth, gateway)
            return
        # Tier 3 — Referral state machine
        if state == AWAIT_REFER_NAME:
            await _handle_refer_name(chat_id, text, auth)
            return
        if state == AWAIT_REFER_REASON:
            await _handle_refer_reason(chat_id, text, auth)
            return
        if state == AWAIT_REFER_PHONE:
            await _handle_refer_phone(chat_id, text, auth, gateway)
            return

        # ── Voice ──
        if msg.get("voice") or msg.get("audio"):
            await _on_voice(chat_id, msg.get("voice") or msg.get("audio"), gateway, sessions, auth)
            return

        # ── Normal text chat ──
        if text and not text.startswith("/"):
            await _on_text(chat_id, text, gateway, sessions, auth)

    except Exception as e:
        log.exception("process_error: %s", str(e))


# ── LOGIN FLOW ────────────────────────────────────────────────────────────────

async def _cmd_login(chat_id: int, auth: TgAuthStore):
    """Start OTP login flow."""
    if await auth.is_logged_in(chat_id):
        data = await auth.get(chat_id)
        await _send_text(chat_id,
            f"✅ You're already logged in as *{data.get('name', 'Patient')}*.\n\n"
            "Use /logout to sign out, or just ask AMINA a question!"
        )
        return
    await auth.set_state(chat_id, AWAIT_PHONE_OTP)
    await _send_text(chat_id,
        "📱 *Login with OTP*\n\n"
        "Please enter your registered phone number:\n"
        "Example: +220 1234567\n\n"
        "_You'll receive a 6-digit code via SMS._\n\n"
        "Prefer a PIN? Use /pin instead."
    )


async def _cmd_pin(chat_id: int, auth: TgAuthStore):
    """Start PIN login flow."""
    if await auth.is_logged_in(chat_id):
        data = await auth.get(chat_id)
        await _send_text(chat_id,
            f"✅ Already logged in as *{data.get('name', 'Patient')}*."
        )
        return
    await auth.set_state(chat_id, AWAIT_PHONE_PIN)
    await _send_text(chat_id,
        "🔐 *Login with PIN*\n\n"
        "Please enter your registered phone number:\n"
        "Example: +220 1234567"
    )


async def _handle_phone_for_otp(chat_id: int, text: str, auth: TgAuthStore, gateway):
    phone = _normalise_phone(text)
    if not phone:
        await _send_text(chat_id,
            "❌ That doesn't look like a valid phone number.\n"
            "Please enter in format: +220 1234567"
        )
        return
    await _typing(chat_id)
    result = await gateway.send_otp(phone)
    if not result or not result.get("success"):
        await _send_text(chat_id,
            "❌ Couldn't send OTP to that number. Please check it and try again."
        )
        return
    await auth.set_state(chat_id, AWAIT_OTP, {"phone": phone})
    msg = (
        "📨 *Code sent!* Check your SMS for a 6-digit code.\n\n"
        "Enter the code now:"
    )
    # Dev mode: show OTP inline
    if result.get("otp_dev"):
        msg += f"\n\n_🧪 Dev mode — your OTP is: *{result['otp_dev']}*_"
    await _send_text(chat_id, msg)


async def _handle_otp_code(chat_id: int, text: str, auth: TgAuthStore, gateway):
    code = text.strip().replace(" ", "")
    if not code.isdigit() or len(code) != 6:
        await _send_text(chat_id, "❌ Please enter the 6-digit code from your SMS.")
        return
    data = await auth.get(chat_id)
    phone = data.get("phone", "")
    await _typing(chat_id)
    result = await gateway.verify_otp(phone, code)
    if not result or not result.get("success"):
        await _send_text(chat_id,
            "❌ Invalid or expired code. Please try again, or use /login to restart."
        )
        return
    await _complete_login(chat_id, result, auth, gateway)


async def _handle_phone_for_pin(chat_id: int, text: str, auth: TgAuthStore, gateway):
    phone = _normalise_phone(text)
    if not phone:
        await _send_text(chat_id,
            "❌ Please enter a valid phone number, e.g. +220 1234567"
        )
        return
    await auth.set_state(chat_id, AWAIT_PIN, {"phone": phone})
    await _send_text(chat_id, "🔢 Enter your 4-digit PIN:")


async def _handle_pin_code(chat_id: int, text: str, auth: TgAuthStore, gateway):
    pin = text.strip()
    if not pin.isdigit() or len(pin) != 4:
        await _send_text(chat_id, "❌ PIN must be exactly 4 digits.")
        return
    data = await auth.get(chat_id)
    phone = data.get("phone", "")
    await _typing(chat_id)
    result = await gateway.login_pin(phone, pin)
    if not result or not result.get("success"):
        await _send_text(chat_id,
            "❌ Invalid phone or PIN. Please check and try again.\n"
            "Use /login for OTP if you've forgotten your PIN."
        )
        return
    await _complete_login(chat_id, result, auth, gateway)


async def _complete_login(chat_id: int, result: dict, auth: TgAuthStore, gateway):
    """Save auth state, link Telegram, and welcome the user."""
    patient = result.get("patient", {})
    jwt = result.get("token", "")
    patient_id = patient.get("id", result.get("patient_id", ""))
    name = patient.get("name", "Patient")
    phone = patient.get("phone", "")

    await auth.set_logged_in(chat_id, jwt, patient_id, name, phone)

    # Auto-link Telegram chat_id to patient account (no separate /link needed)
    await gateway.save_telegram_chat_id(jwt, str(chat_id))

    conditions = patient.get("conditions", [])
    if isinstance(conditions, str):
        import json as _json
        try: conditions = _json.loads(conditions)
        except: conditions = []

    cond_str = ", ".join(conditions) if conditions else "none recorded"
    await _send_text(chat_id,
        f"✅ *Welcome back, {name}!*\n\n"
        f"🩺 Conditions: {cond_str}\n\n"
        "You now have your full health profile. Ask me anything!\n\n"
        "📋 /profile · 📜 /history · 💊 /vitals · 📄 /careplan · 📥 /report"
    )
    log.info("login_complete chat_id=%d patient=%s", chat_id, patient_id)


async def _cmd_logout(chat_id: int, auth: TgAuthStore):
    from app.main import gateway
    state = await auth.get_state(chat_id)
    if state not in (LOGGED_IN, CG_LOGGED_IN):
        await _send_text(chat_id, "You're not logged in. Use /login to sign in.")
        return
    data = await auth.get(chat_id)
    name = data.get("name", "Patient")
    # Signal agent to persist session before clearing
    sid = data.get("session_id")
    if sid:
        await gateway.end_session(sid)
    if state == CG_LOGGED_IN:
        await auth.cg_logout(chat_id)
        await _send_text(chat_id,
            f"👋 Goodbye, {name}! Caregiver session ended.\n\n"
            "Use /cglogin to sign back in."
        )
    else:
        await auth.clear(chat_id)
        await _send_text(chat_id,
            f"👋 Goodbye, {name}! You've been signed out.\n\n"
            "You can still ask health questions anonymously, or /login again anytime."
        )


# ── TIER 3 — COMMUNITY ────────────────────────────────────────────────────────

async def _cmd_community(chat_id: int, auth: TgAuthStore, gateway):
    """Show Bantaba village board + seasonal tips + healer bridge content."""
    data = await auth.get(chat_id)
    user_id = data.get("patient_id") or str(chat_id)
    session_id = data.get("session_id") or f"telegram_{chat_id}"
    await _typing(chat_id)
    result = await gateway.get_community_all(user_id=user_id, session_id=session_id)
    if not result:
        await _send_text(chat_id,
            "❌ Community board is unavailable right now. Please try again later."
        )
        return

    lines = ["🌍 *AMINA Community*\n"]

    # Bantaba discussions
    bantaba = result.get("bantaba") or result.get("discussions", [])
    if bantaba:
        lines.append("💬 *Village Health Discussions (Bantaba):*")
        for post in (bantaba[:3] if isinstance(bantaba, list) else []):
            title   = post.get("title") or post.get("content", "")[:60]
            replies = post.get("reply_count", 0)
            lines.append(f"• {title} _{replies} replies_")
        lines.append("")

    # Seasonal tips
    seasonal = result.get("seasonal_tips") or result.get("tips", [])
    if seasonal:
        lines.append("🌦 *Seasonal Health Tips:*")
        for tip in (seasonal[:2] if isinstance(seasonal, list) else []):
            content = tip.get("content") or str(tip)
            lines.append(f"• {content[:120]}")
        lines.append("")

    # Healer bridge
    bridge = result.get("healer_bridge") or result.get("healers", [])
    if bridge:
        lines.append("🌿 *Healer Bridge — Traditional ↔ Modern:*")
        for entry in (bridge[:2] if isinstance(bridge, list) else []):
            content = entry.get("content") or str(entry)
            lines.append(f"• {content[:120]}")
        lines.append("")

    if len(lines) == 1:
        lines.append("_No community posts yet. Be the first to contribute!_")

    await _send_text(chat_id, "\n".join(lines))


# ── TIER 3 — CAREGIVER LOGIN ──────────────────────────────────────────────────

async def _cmd_cglogin(chat_id: int, auth: TgAuthStore):
    """Start caregiver PIN login flow."""
    if await auth.is_cg_logged_in(chat_id):
        data = await auth.get(chat_id)
        await _send_text(chat_id,
            f"✅ Already logged in as caregiver *{data.get('name', 'Caregiver')}*.\n\n"
            "/cgdashboard · /cgpatients · /cglogout"
        )
        return
    await auth.set_state(chat_id, AWAIT_CG_PHONE)
    await _send_text(chat_id,
        "👩‍⚕️ *Caregiver Login*\n\n"
        "Enter your registered phone number:\n"
        "Example: +220 1234567"
    )


async def _handle_cg_phone(chat_id: int, text: str, auth: TgAuthStore):
    phone = _normalise_phone(text)
    if not phone:
        await _send_text(chat_id,
            "❌ Please enter a valid phone number, e.g. +220 1234567"
        )
        return
    await auth.set_state(chat_id, AWAIT_CG_PIN, {"phone": phone})
    await _send_text(chat_id, "🔢 Enter your caregiver PIN:")


async def _handle_cg_pin(chat_id: int, text: str, auth: TgAuthStore, gateway):
    pin = text.strip()
    if not pin.isdigit() or len(pin) < 4:
        await _send_text(chat_id, "❌ PIN must be at least 4 digits.")
        return
    data = await auth.get(chat_id)
    phone = data.get("phone", "")
    await _typing(chat_id)
    result = await gateway.caregiver_login(phone, pin)
    if not result or not result.get("success"):
        await _send_text(chat_id,
            "❌ Invalid phone or PIN. Please check and try again.\n"
            "Use /cglogin to restart."
        )
        await auth.set_state(chat_id, IDLE)
        return

    caregiver = result.get("caregiver", {})
    jwt = result.get("token", "")
    caregiver_id = caregiver.get("id", result.get("caregiver_id", ""))
    name = caregiver.get("name", "Caregiver")

    await auth.set_cg_logged_in(
        chat_id=chat_id,
        jwt=jwt,
        caregiver_id=caregiver_id,
        name=name,
        phone=phone,
    )
    await _send_text(chat_id,
        f"✅ *Welcome, {name}!* Caregiver session active.\n\n"
        "📊 /cgdashboard — alerts & patient summary\n"
        "👥 /cgpatients  — your assigned patients\n"
        "🔔 /cgalert    — send patient an alert\n"
        "⚠️ /cgwarn     — send a warning\n"
        "🚨 /cgemergency — send emergency alert\n"
        "🔗 /refer      — refer a patient to AMINA\n"
        "🚪 /cglogout   — sign out"
    )
    log.info("cg_login_complete chat_id=%d caregiver=%s", chat_id, caregiver_id)


async def _cmd_cglogout(chat_id: int, auth: TgAuthStore):
    if not await auth.is_cg_logged_in(chat_id):
        await _send_text(chat_id, "You're not logged in as a caregiver. Use /cglogin.")
        return
    data = await auth.get(chat_id)
    name = data.get("name", "Caregiver")
    await auth.cg_logout(chat_id)
    await _send_text(chat_id,
        f"👋 Goodbye, {name}! Caregiver session ended.\n\n"
        "Use /cglogin to sign back in."
    )


# ── TIER 3 — CAREGIVER DASHBOARD & PATIENTS ───────────────────────────────────

async def _cmd_cgdashboard(chat_id: int, auth: TgAuthStore, gateway):
    if not await auth.is_cg_logged_in(chat_id):
        await _send_text(chat_id, "🔐 Please /cglogin first.")
        return
    data = await auth.get(chat_id)
    await _typing(chat_id)
    dash = await gateway.get_caregiver_dashboard(
        jwt=data["jwt"],
        patient_id=data.get("current_patient_id") or None,
    )
    if not dash:
        await _send_text(chat_id, "❌ Couldn't load dashboard. Please try again.")
        return

    lines = [f"📊 *Dashboard — {data.get('name', 'Caregiver')}*\n"]

    patients = dash.get("patients", [])
    lines.append(f"👥 Assigned patients: *{len(patients)}*")

    pending = dash.get("pending_alerts", dash.get("alerts", []))
    if isinstance(pending, list):
        lines.append(f"🔔 Pending alerts: *{len(pending)}*")
        for a in pending[:3]:
            sev = a.get("severity", "info").upper()
            msg = a.get("message", "")[:60]
            lines.append(f"  • [{sev}] {msg}")
    elif isinstance(pending, int):
        lines.append(f"🔔 Pending alerts: *{pending}*")

    rules = dash.get("alert_rules", [])
    if rules:
        lines.append(f"\n⚙️ Active alert rules: *{len(rules)}*")

    recent = dash.get("recent_events", dash.get("events", []))
    if recent:
        lines.append("\n📅 *Recent events:*")
        for ev in recent[:3]:
            desc = ev.get("description") or ev.get("message", "")[:80]
            lines.append(f"• {desc}")

    lines.append("\n/cgpatients · /cgalert · /cgwarn · /cgemergency")
    await _send_text(chat_id, "\n".join(lines))


async def _cmd_cgpatients(chat_id: int, auth: TgAuthStore, gateway):
    if not await auth.is_cg_logged_in(chat_id):
        await _send_text(chat_id, "🔐 Please /cglogin first.")
        return
    data = await auth.get(chat_id)
    await _typing(chat_id)
    result = await gateway.get_caregiver_patients(jwt=data["jwt"])
    if not result:
        await _send_text(chat_id, "❌ Couldn't load patient list. Please try again.")
        return

    patients = result.get("patients", result if isinstance(result, list) else [])
    if not patients:
        await _send_text(chat_id, "No patients assigned yet.")
        return

    lines = ["👥 *Your Assigned Patients:*\n"]
    for i, p in enumerate(patients[:10], 1):
        pid  = p.get("id", "?")
        name = p.get("name", "Unknown")
        cond = ", ".join(p.get("conditions", [])[:2]) or "—"
        last = (p.get("last_consultation") or "—")[:10]
        lines.append(f"{i}. *{name}* (`{pid[:8]}…`)\n   🩺 {cond} · 📅 {last}\n")

    lines.append("_To send an alert: /cgalert <patient\\_id> <message>_")
    await _send_text(chat_id, "\n".join(lines))


# ── TIER 3 — CAREGIVER ALERTS ─────────────────────────────────────────────────

async def _cmd_cgalert(chat_id: int, text: str, auth: TgAuthStore, gateway):
    """
    /cgalert <patient_id> <message>  — inline info alert (no guided flow).
    Falls back to guided flow if no args given.
    """
    if not await auth.is_cg_logged_in(chat_id):
        await _send_text(chat_id, "🔐 Please /cglogin first.")
        return
    parts = text.strip().split(None, 2)   # ["/cgalert", patient_id, message]
    if len(parts) < 3:
        await _send_text(chat_id,
            "Usage: `/cgalert <patient_id> <message>`\n\n"
            "For a guided flow use /cgwarn or /cgemergency.\n"
            "Get patient IDs with /cgpatients."
        )
        return
    patient_id = parts[1]
    message    = parts[2]
    data = await auth.get(chat_id)
    await _typing(chat_id)
    ok = await gateway.send_cg_patient_alert(
        jwt=data["jwt"],
        patient_id=patient_id,
        message=message,
        severity="info",
    )
    if ok:
        await _send_text(chat_id, f"✅ Alert sent to patient `{patient_id[:8]}…`")
    else:
        await _send_text(chat_id, "❌ Failed to send alert. Check the patient ID and try again.")


async def _cmd_cg_alert_flow(chat_id: int, text: str, auth: TgAuthStore, severity: str):
    """
    /cgwarn or /cgemergency — start guided alert: enter patient_id then message.
    severity: "warning" | "emergency"
    """
    if not await auth.is_cg_logged_in(chat_id):
        await _send_text(chat_id, "🔐 Please /cglogin first.")
        return

    # Allow /cgwarn <patient_id> as shortcut to skip patient_id prompt
    parts = text.strip().split(None, 1)
    if len(parts) == 2:
        patient_id = parts[1].strip()
        await auth.set_state(
            chat_id, AWAIT_CG_ALERT_MSG,
            {"cg_alert_severity": severity, "cg_alert_patient": patient_id},
        )
        emoji = "🚨" if severity == "emergency" else "⚠️"
        await _send_text(chat_id,
            f"{emoji} *{severity.upper()} alert for patient* `{patient_id[:8]}…`\n\n"
            "Type your message now:"
        )
    else:
        await auth.set_state(
            chat_id, AWAIT_CG_ALERT_MSG,
            {"cg_alert_severity": severity, "cg_alert_patient": ""},
        )
        await _send_text(chat_id,
            f"Enter the *patient ID* to alert\n"
            f"_(get IDs with /cgpatients)_:"
        )


async def _handle_cg_alert_msg(chat_id: int, text: str, auth: TgAuthStore, gateway):
    data = await auth.get(chat_id)
    severity   = data.get("cg_alert_severity", "info")
    patient_id = data.get("cg_alert_patient", "")

    if not patient_id:
        # First reply is the patient_id
        await auth.set_state(
            chat_id, AWAIT_CG_ALERT_MSG,
            {"cg_alert_patient": text.strip()},
            ttl=INTERMEDIATE_TTL,
        )
        emoji = "🚨" if severity == "emergency" else "⚠️"
        await _send_text(chat_id,
            f"{emoji} Patient set to `{text.strip()[:8]}…`\n\nNow type your alert message:"
        )
        return

    # Second reply is the message
    message = text.strip()
    await _typing(chat_id)
    ok = await gateway.send_cg_patient_alert(
        jwt=data["jwt"],
        patient_id=patient_id,
        message=message,
        severity=severity,
    )
    # Return caregiver to CG_LOGGED_IN state
    await auth.set_state(chat_id, CG_LOGGED_IN, ttl=CG_LOGGED_IN_TTL)
    if ok:
        emoji = "🚨" if severity == "emergency" else "⚠️"
        await _send_text(chat_id,
            f"{emoji} *{severity.upper()} alert sent!*\n\n"
            f"Patient: `{patient_id[:8]}…`\n"
            f"Message: _{message[:120]}_"
        )
    else:
        await _send_text(chat_id, "❌ Failed to send alert. Please try again.")


# ── TIER 3 — VHW REFERRAL ─────────────────────────────────────────────────────

async def _cmd_refer(chat_id: int, auth: TgAuthStore):
    """Start VHW referral warm-handoff flow."""
    await auth.set_state(chat_id, AWAIT_REFER_NAME, ttl=INTERMEDIATE_TTL)
    await _send_text(chat_id,
        "🔗 *Refer a Patient to AMINA*\n\n"
        "I'll need a few details to create the referral.\n\n"
        "1️⃣ What is the patient's *full name*?"
    )


async def _handle_refer_name(chat_id: int, text: str, auth: TgAuthStore):
    name = text.strip()
    if len(name) < 2:
        await _send_text(chat_id, "❌ Please enter the patient's full name.")
        return
    await auth.set_state(chat_id, AWAIT_REFER_REASON, {"refer_name": name}, ttl=INTERMEDIATE_TTL)
    await _send_text(chat_id,
        f"✅ Patient: *{name}*\n\n"
        "2️⃣ What is the *reason for referral*?\n"
        "_(e.g. uncontrolled diabetes, high BP, chest pain)_"
    )


async def _handle_refer_reason(chat_id: int, text: str, auth: TgAuthStore):
    reason = text.strip()
    if len(reason) < 5:
        await _send_text(chat_id, "❌ Please describe the referral reason in a few words.")
        return
    await auth.set_state(chat_id, AWAIT_REFER_PHONE, {"refer_reason": reason}, ttl=INTERMEDIATE_TTL)
    await _send_text(chat_id,
        f"✅ Reason: _{reason}_\n\n"
        "3️⃣ What is the patient's *phone number*?\n"
        "AMINA will contact them to start a consultation.\n"
        "Example: +220 1234567"
    )


async def _handle_refer_phone(chat_id: int, text: str, auth: TgAuthStore, gateway):
    phone = _normalise_phone(text)
    if not phone:
        await _send_text(chat_id,
            "❌ Please enter a valid phone number, e.g. +220 1234567"
        )
        return

    data = await auth.get(chat_id)
    refer_name   = data.get("refer_name", "Unknown")
    refer_reason = data.get("refer_reason", "")
    vhw_name     = data.get("name", "VHW")
    vhw_id       = data.get("patient_id") or data.get("caregiver_id") or str(chat_id)
    session_id   = data.get("session_id") or f"tg_{chat_id}"

    await _typing(chat_id)
    result = await gateway.create_referral(
        vhw_name=vhw_name,
        vhw_id=vhw_id,
        patient_phone=phone,
        reason=refer_reason,
        session_id=session_id,
    )

    # Reset state
    new_state = CG_LOGGED_IN if await auth.is_cg_logged_in(chat_id) else (
        LOGGED_IN if data.get("jwt") else IDLE
    )
    await auth.set_state(chat_id, new_state, ttl=CG_LOGGED_IN_TTL if new_state == CG_LOGGED_IN else LOGGED_IN_TTL)

    if result:
        ref_id = result.get("referral_id") or result.get("id", "")
        await _send_text(chat_id,
            f"✅ *Referral created!*\n\n"
            f"👤 Patient: *{refer_name}*\n"
            f"📱 Phone: {phone}\n"
            f"🩺 Reason: _{refer_reason}_\n"
            f"🆔 Ref ID: `{ref_id}`\n\n"
            "AMINA will reach out to the patient to begin their consultation."
        )
        log.info("referral_created chat_id=%d patient_phone=%s", chat_id, phone)
    else:
        await _send_text(chat_id,
            "❌ Referral could not be created right now.\n\n"
            "Please try again, or contact support."
        )


# ── PATIENT COMMANDS ──────────────────────────────────────────────────────────

async def _cmd_profile(chat_id: int, auth: TgAuthStore, gateway):
    if not await auth.is_logged_in(chat_id):
        await _send_text(chat_id, "🔐 Please /login first to view your profile.")
        return
    data = await auth.get(chat_id)
    await _typing(chat_id)
    profile = await gateway.get_profile(data["jwt"])
    if not profile:
        await _send_text(chat_id, "❌ Couldn't load your profile. Please try again.")
        return

    import json as _json
    def _parse(val):
        if isinstance(val, str):
            try: return _json.loads(val)
            except: return []
        return val or []

    conditions = _parse(profile.get("conditions"))
    medications = _parse(profile.get("medications"))
    allergies   = _parse(profile.get("allergies"))

    med_names = []
    for m in medications:
        if isinstance(m, dict): med_names.append(m.get("name", str(m)))
        else: med_names.append(str(m))

    lines = [
        f"👤 *{profile.get('name', 'Patient')}*",
        f"📅 Age: {profile.get('age', '—')} · {profile.get('gender', '—')}",
        f"📍 Region: {profile.get('region', '—')}",
        "",
        f"🩺 *Conditions:* {', '.join(conditions) or 'None on record'}",
        f"💊 *Medications:* {', '.join(med_names) or 'None on record'}",
        f"⚠️ *Allergies:* {', '.join(allergies) or 'None on record'}",
    ]
    if profile.get("last_bp"):
        lines.append(f"\n❤️ *Last BP:* {profile['last_bp']}")
    if profile.get("last_glucose"):
        lines.append(f"🩸 *Last Glucose:* {profile['last_glucose']} mmol/L")

    await _send_text(chat_id, "\n".join(lines))


async def _cmd_history(chat_id: int, auth: TgAuthStore, gateway):
    if not await auth.is_logged_in(chat_id):
        await _send_text(chat_id, "🔐 Please /login first to view your history.")
        return
    data = await auth.get(chat_id)
    await _typing(chat_id)
    hist = await gateway.get_patient_history(data["patient_id"])
    if not hist:
        await _send_text(chat_id, "❌ Couldn't load your history. Please try again.")
        return

    consultations = hist.get("consultations", [])[:5]
    if not consultations:
        await _send_text(chat_id,
            "📋 No consultation history yet.\n\n"
            "Start a conversation with me and your history will appear here!"
        )
        return

    TRIAGE_EMOJI = {
        "SELF_CARE": "🟢", "CHW_VISIT": "🟡",
        "FACILITY": "🟠",  "EMERGENCY": "🔴",
    }
    lines = ["📜 *Your last consultations:*\n"]
    for i, c in enumerate(consultations, 1):
        triage = c.get("triage_level", "SELF_CARE")
        emoji  = TRIAGE_EMOJI.get(triage, "⚪")
        date   = (c.get("started_at") or "")[:10]
        summary = c.get("summary") or "Consultation"
        lines.append(f"{i}. {emoji} {date}\n   _{summary}_\n")

    # Key facts
    memories = hist.get("memories", [])
    if memories:
        lines.append("\n💡 *AMINA remembers about you:*")
        for m in memories[:4]:
            content = m.get("content", "")
            if content:
                lines.append(f"• {content[:100]}")

    await _send_text(chat_id, "\n".join(lines))


async def _cmd_vitals(chat_id: int, auth: TgAuthStore, state: str):
    if not await auth.is_logged_in(chat_id):
        await _send_text(chat_id, "🔐 Please /login first to log your vitals.")
        return
    await auth.set_state(chat_id, AWAIT_BP, ttl=INTERMEDIATE_TTL)
    await _send_text(chat_id,
        "💓 *Record your vitals*\n\n"
        "1️⃣ What is your *blood pressure* reading?\n"
        "Format: 130/85\n\n"
        "_Send /skip to skip BP._"
    )


async def _handle_bp_input(chat_id: int, text: str, auth: TgAuthStore, gateway):
    bp = text.strip().upper()
    if not re.match(r"^\d{2,3}/\d{2,3}$", bp):
        await _send_text(chat_id,
            "❌ Please enter BP in format: 130/85\n"
            "Or /skip to skip this step."
        )
        return
    await auth.set_state(chat_id, AWAIT_GLUCOSE, {"vitals_bp": bp}, ttl=INTERMEDIATE_TTL)
    await _send_text(chat_id,
        f"✅ BP recorded: *{bp} mmHg*\n\n"
        "2️⃣ What is your *blood glucose* reading? (mmol/L)\n"
        "Example: 6.2\n\n"
        "_Send /skip to finish without glucose._"
    )


async def _handle_glucose_input(chat_id: int, text: str, auth: TgAuthStore, gateway):
    glucose_raw = text.strip().replace(",", ".")
    try:
        glucose_val = float(glucose_raw)
        if not (0.5 < glucose_val < 40):
            raise ValueError
    except ValueError:
        await _send_text(chat_id,
            "❌ Please enter glucose as a number (mmol/L), e.g. 6.2\n"
            "Or /skip to finish."
        )
        return

    data = await auth.get(chat_id)
    bp = data.get("vitals_bp", "")
    patient_id = data["patient_id"]
    await _typing(chat_id)

    ok = await gateway.update_vitals(patient_id, bp=bp or None, glucose=str(glucose_val))
    await auth.set_state(chat_id, LOGGED_IN, ttl=LOGGED_IN_TTL)

    if not ok:
        await _send_text(chat_id, "❌ Failed to save vitals. Please try again later.")
        return

    # Build interpretation
    lines = ["✅ *Vitals saved!*\n"]
    if bp:
        sys, dia = map(int, bp.split("/"))
        if sys >= 180 or dia >= 110:
            lines.append(f"❤️ BP: {bp} mmHg — ⚠️ *CRITICALLY HIGH*. Please seek medical care immediately.")
        elif sys >= 140 or dia >= 90:
            lines.append(f"❤️ BP: {bp} mmHg — 🟠 *High*. Monitor closely and contact your doctor.")
        elif sys >= 130 or dia >= 80:
            lines.append(f"❤️ BP: {bp} mmHg — 🟡 *Elevated*. Watch your salt and stress levels.")
        else:
            lines.append(f"❤️ BP: {bp} mmHg — 🟢 *Normal range*. Good job!")

    if glucose_val > 10:
        lines.append(f"🩸 Glucose: {glucose_val} mmol/L — ⚠️ *High*. Review your diet and medication.")
    elif glucose_val < 3.9:
        lines.append(f"🩸 Glucose: {glucose_val} mmol/L — ⚠️ *Low*. Eat something now.")
    else:
        lines.append(f"🩸 Glucose: {glucose_val} mmol/L — 🟢 *Normal*.")

    await _send_text(chat_id, "\n".join(lines))


async def _handle_skip(chat_id: int, auth: TgAuthStore, state: str, gateway):
    if state == AWAIT_BP:
        await auth.set_state(chat_id, AWAIT_GLUCOSE, {"vitals_bp": ""}, ttl=INTERMEDIATE_TTL)
        await _send_text(chat_id,
            "⏭ BP skipped.\n\n"
            "2️⃣ What is your *blood glucose* reading? (mmol/L)\n"
            "Or /skip to cancel."
        )
    elif state == AWAIT_GLUCOSE:
        data = await auth.get(chat_id)
        bp = data.get("vitals_bp", "")
        patient_id = data.get("patient_id", "")
        await auth.set_state(chat_id, LOGGED_IN, ttl=LOGGED_IN_TTL)
        if bp and patient_id:
            ok = await gateway.update_vitals(patient_id, bp=bp)
            if ok:
                await _send_text(chat_id, f"✅ BP {bp} mmHg saved. Glucose skipped.")
                return
        await _send_text(chat_id, "Vitals entry cancelled.")
    else:
        await _send_text(chat_id, "Nothing to skip right now.")


async def _cmd_careplan(chat_id: int, auth: TgAuthStore, gateway):
    if not await auth.is_logged_in(chat_id):
        await _send_text(chat_id, "🔐 Please /login first to view your care plan.")
        return
    data = await auth.get(chat_id)
    session_id = data.get("session_id", f"tg_{chat_id}")
    await _typing(chat_id)

    plan_data = await gateway.get_care_plan(session_id)
    if not plan_data or not plan_data.get("exists"):
        # Try generating one
        await _send_text(chat_id, "⏳ No plan yet — generating one from your history…")
        plan_data = await gateway.generate_care_plan(session_id)

    if not plan_data:
        await _send_text(chat_id,
            "❌ Could not generate a care plan yet.\n\n"
            "Have a conversation with me first so I can understand your health situation!"
        )
        return

    plan = plan_data.get("plan", {})
    if not plan:
        await _send_text(chat_id, "❌ No care plan data found. Chat with me first!")
        return

    lines = ["📋 *Your Personalised Care Plan*\n"]

    goals = plan.get("goals") or plan.get("health_goals", [])
    if goals:
        lines.append("🎯 *Goals:*")
        for g in (goals[:4] if isinstance(goals, list) else [str(goals)]):
            lines.append(f"• {g}")

    actions = plan.get("actions") or plan.get("immediate_actions", [])
    if actions:
        lines.append("\n✅ *Actions:*")
        for a in (actions[:4] if isinstance(actions, list) else [str(actions)]):
            lines.append(f"• {a}")

    monitoring = plan.get("monitoring") or plan.get("monitoring_plan", [])
    if monitoring:
        lines.append("\n📊 *Monitor:*")
        for m in (monitoring[:3] if isinstance(monitoring, list) else [str(monitoring)]):
            lines.append(f"• {m}")

    if plan.get("followup") or plan.get("follow_up"):
        lines.append(f"\n📅 *Follow-up:* {plan.get('followup') or plan.get('follow_up')}")

    await _send_text(chat_id, "\n".join(lines))


async def _cmd_report(chat_id: int, auth: TgAuthStore, gateway):
    if not await auth.is_logged_in(chat_id):
        await _send_text(chat_id, "🔐 Please /login first to download your report.")
        return
    data = await auth.get(chat_id)
    session_id = data.get("session_id", f"tg_{chat_id}")
    await _typing(chat_id)
    await _send_text(chat_id, "📄 Generating your consultation report…")
    pdf = await gateway.get_consultation_pdf(session_id)
    if not pdf:
        await _send_text(chat_id,
            "❌ No report available yet.\n\n"
            "Have a conversation with AMINA first, then try /report again."
        )
        return
    await _send_document(chat_id, pdf, "amina_consultation.pdf", "📋 Your AMINA Consultation Report")


async def _cmd_language(chat_id: int, text: str, auth: TgAuthStore):
    parts = text.strip().lower().split()
    lang_arg = parts[1] if len(parts) > 1 else ""

    LANG_MAP = {
        "english": "en", "en": "en",
        "mandinka": "ma", "ma": "ma", "manding": "ma",
    }

    if lang_arg and lang_arg in LANG_MAP:
        lang = LANG_MAP[lang_arg]
        await auth.set_language(chat_id, lang)
        label = "English" if lang == "en" else "Mandinka"
        await _send_text(chat_id, f"✅ Language set to *{label}*.")
    else:
        # Show picker
        await _send_keyboard(chat_id,
            "🌍 Choose your language:",
            [["🇬🇧 English (/language english)", "🇬🇲 Mandinka (/language mandinka)"]],
        )


async def _cmd_nudge(chat_id: int, auth: TgAuthStore, gateway):
    data = await auth.get(chat_id)
    patient_id = data.get("patient_id") if data.get("state") == LOGGED_IN else None
    await _typing(chat_id)
    nudge = await gateway.get_nudge(patient_id=patient_id)
    if not nudge:
        await _send_text(chat_id, "❌ Couldn't load today's nudge. Try again later.")
        return
    tip = nudge.get("tip") or nudge.get("nudge") or str(nudge)
    title = nudge.get("title", "Today's Health Tip")
    await _send_text(chat_id, f"🥗 *{title}*\n\n{tip}")


async def _cmd_link(chat_id: int, text: str):
    """Legacy /link <CODE> — still supported for web-generated codes."""
    parts = text.strip().split()
    if len(parts) < 2:
        await _send_text(chat_id,
            "Usage: /link <CODE>\n\n"
            "Get your code from AMINA app → Settings → Telegram.\n"
            "Or use /login to sign in directly."
        )
        return
    code = parts[1].upper()
    client = await _get_client()
    try:
        r = await client.post(
            f"{settings.GATEWAY_URL}/api/v1/patient/telegram/verify-link",
            json={"code": code, "telegram_chat_id": str(chat_id)},
            timeout=httpx.Timeout(10.0),
        )
        if r.status_code == 200:
            await _send_text(chat_id,
                "✅ *Telegram linked!*\n\n"
                "Caregiver alerts will now reach you here.\n"
                "Use /login to unlock your full health profile."
            )
        else:
            detail = r.json().get("detail", "Invalid or expired code.")
            await _send_text(chat_id, f"❌ Link failed: {detail}")
    except Exception as e:
        log.error("link_cmd_error chat_id=%d: %s", chat_id, str(e))
        await _send_text(chat_id, "Sorry, couldn't reach AMINA. Please try again.")


# ── CHAT ──────────────────────────────────────────────────────────────────────

async def _on_text(chat_id: int, text: str, gateway, sessions, auth: TgAuthStore):
    user_id  = str(chat_id)
    data     = await auth.get(chat_id)
    is_auth  = data.get("state") == LOGGED_IN
    lang     = data.get("language", "en")

    session_id = data.get("session_id") if is_auth else f"telegram_{user_id}"

    log.info("text_in chat_id=%d authed=%s len=%d", chat_id, is_auth, len(text))
    await _typing(chat_id)

    if is_auth:
        result = await gateway.agent_chat_authed(
            message=text,
            session_id=session_id,
            patient_id=data["patient_id"],
            language=lang,
            jwt=data.get("jwt"),
        )
    else:
        result = await gateway.agent_chat(message=text, session_id=session_id)

    if result and result.get("response"):
        answer = result["response"]
    else:
        history = await sessions.get_history("telegram", user_id)
        answer  = await gateway.text_chat(text, history)

    if not answer:
        await _send_text(chat_id, "Sorry, I'm having trouble right now. Please try again in a moment.")
        return

    await sessions.add_message("telegram", user_id, "user", text)
    await sessions.add_message("telegram", user_id, "assistant", answer)

    # Triage flag
    triage = result.get("triage_level") if result else None
    if triage in ("FACILITY", "EMERGENCY") and result:
        prefix = "🚨 *Emergency:* " if triage == "EMERGENCY" else "🏥 *Facility visit recommended.*\n\n"
        answer = prefix + answer

    await _send_text(chat_id, answer)

    # Inline feedback buttons
    await _send_inline_feedback(chat_id, session_id, answer[:60])

    # TTS voice note
    audio = await gateway.text_to_speech(answer)
    if audio:
        ogg = convert_to_ogg_opus(audio)
        if ogg:
            await _send_voice(chat_id, ogg)

    log.info("text_out chat_id=%d triage=%s", chat_id, triage)


async def _on_voice(chat_id: int, voice: dict, gateway, sessions, auth: TgAuthStore):
    user_id  = str(chat_id)
    data     = await auth.get(chat_id)
    is_auth  = data.get("state") == LOGGED_IN
    lang     = data.get("language", "en")
    session_id = data.get("session_id") if is_auth else f"telegram_{user_id}"

    file_id = voice.get("file_id", "")
    log.info("voice_in chat_id=%d authed=%s", chat_id, is_auth)
    await _typing(chat_id)

    audio_bytes = await _download_file(file_id)
    if not audio_bytes:
        await _send_text(chat_id, "Sorry, I couldn't process your voice message. Please try again.")
        return

    await _typing(chat_id)
    transcript = await gateway.speech_to_text(audio_bytes, "voice.ogg")
    if not transcript:
        await _send_text(chat_id, "I couldn't understand the audio. Could you type your message instead?")
        return

    await _send_text(chat_id, f'🎙 I heard: "{transcript}"')
    await _typing(chat_id)

    if is_auth:
        result = await gateway.agent_chat_authed(
            message=transcript,
            session_id=session_id,
            patient_id=data["patient_id"],
            language=lang,
            jwt=data.get("jwt"),
        )
    else:
        result = await gateway.agent_chat(message=transcript, session_id=session_id)

    if result and result.get("response"):
        answer = result["response"]
    else:
        history = await sessions.get_history("telegram", user_id)
        answer  = await gateway.text_chat(transcript, history)

    if not answer:
        await _send_text(chat_id, "Sorry, I'm having trouble right now.")
        return

    await sessions.add_message("telegram", user_id, "user", transcript)
    await sessions.add_message("telegram", user_id, "assistant", answer)

    await _send_text(chat_id, answer)
    await _send_inline_feedback(chat_id, session_id, answer[:60])

    audio = await gateway.text_to_speech(answer)
    if audio:
        ogg = convert_to_ogg_opus(audio)
        if ogg:
            await _send_voice(chat_id, ogg)


async def _on_photo(chat_id: int, photos: list, caption: str, gateway, auth: TgAuthStore, state: str):
    """Prescription scan — download highest-res photo, send to /agent/prescription."""
    if state in (AWAIT_PHONE_OTP, AWAIT_OTP, AWAIT_PHONE_PIN, AWAIT_PIN):
        await _send_text(chat_id, "Please complete login first, then send your prescription.")
        return

    await _send_text(chat_id, "🔍 Scanning your prescription…")
    await _typing(chat_id)

    # Telegram sends multiple sizes — use the last (highest res)
    best = photos[-1]
    image_bytes = await _download_file(best["file_id"])
    if not image_bytes:
        await _send_text(chat_id, "❌ Couldn't download the image. Please try again.")
        return

    data = await auth.get(chat_id)
    is_auth    = data.get("state") == LOGGED_IN
    patient_id = data.get("patient_id") if is_auth else None
    session_id = data.get("session_id") if is_auth else f"telegram_{chat_id}"
    lang       = data.get("language", "en")

    result = await gateway.analyze_prescription(
        image_bytes=image_bytes,
        session_id=session_id,
        patient_id=patient_id,
        language=lang,
    )

    if not result:
        await _send_text(chat_id,
            "❌ Couldn't analyse the prescription. "
            "Make sure the image is clear and try again."
        )
        return

    # Format response
    lines = ["💊 *Prescription Analysis*\n"]

    meds = result.get("medications") or result.get("extracted_medications", [])
    if meds:
        lines.append("*Medications found:*")
        for m in (meds if isinstance(meds, list) else [meds]):
            if isinstance(m, dict):
                name = m.get("name", "")
                dose = m.get("dosage", "")
                freq = m.get("frequency", "")
                lines.append(f"• *{name}* {dose} {freq}".strip())
            else:
                lines.append(f"• {m}")

    explanation = result.get("explanation") or result.get("amina_response", "")
    if explanation:
        lines.append(f"\n🩺 *AMINA's notes:*\n{explanation[:800]}")

    warnings = result.get("warnings", [])
    if warnings:
        lines.append("\n⚠️ *Warnings:*")
        for w in (warnings if isinstance(warnings, list) else [warnings]):
            lines.append(f"• {w}")

    await _send_text(chat_id, "\n".join(lines))


async def _on_callback(callback: dict, gateway):
    """Handle inline keyboard presses — feedback thumbs up/down."""
    query_id   = callback.get("id")
    chat_id    = callback.get("message", {}).get("chat", {}).get("id")
    cbdata     = callback.get("data", "")
    msg_text   = callback.get("message", {}).get("text", "")

    # Answer the callback to remove loading spinner
    try:
        client = await _get_client()
        await client.post(
            f"{_api()}/answerCallbackQuery",
            json={"callback_query_id": query_id, "text": "Thanks for your feedback! 🙏"},
        )
    except Exception:
        pass

    if not cbdata.startswith("fb_"):
        return

    parts   = cbdata.split("__", 2)   # fb_up__session_id  or  fb_dn__session_id
    if len(parts) < 2:
        return

    rating     = "thumbs_up" if parts[0] == "fb_up" else "thumbs_down"
    session_id = parts[1]
    preview    = msg_text[:80] if msg_text else ""

    await gateway.send_feedback(session_id, rating, preview)

    # Edit the message to remove the buttons (clean UX)
    try:
        msg_id = callback.get("message", {}).get("message_id")
        if chat_id and msg_id:
            client = await _get_client()
            await client.post(
                f"{_api()}/editMessageReplyMarkup",
                json={"chat_id": chat_id, "message_id": msg_id, "reply_markup": {"inline_keyboard": []}},
            )
    except Exception:
        pass


# ── COMMANDS ──────────────────────────────────────────────────────────────────

async def _cmd_start(chat_id: int, msg: dict, sessions, auth: TgAuthStore):
    name = msg.get("from", {}).get("first_name", "there")
    await sessions.clear("telegram", str(chat_id))
    data  = await auth.get(chat_id)
    state = data.get("state", "idle")

    if state == CG_LOGGED_IN:
        welcome = (
            f"👋 Welcome back, *{data.get('name', name)}* (Caregiver)!\n\n"
            "📊 /cgdashboard · 👥 /cgpatients · 🔔 /cgalert\n"
            "⚠️ /cgwarn · 🚨 /cgemergency · 🔗 /refer\n"
            "🚪 /cglogout"
        )
        await _send_text(chat_id, welcome)
    elif state == LOGGED_IN:
        welcome = (
            f"👋 Welcome back, *{data.get('name', name)}*!\n\n"
            "Ask me anything, or use a command:\n"
            "/profile · /history · /vitals · /careplan · /report · /nudge\n\n"
            "🌍 /community · 🔗 /refer · /help"
        )
        await _send_text(chat_id, welcome)
    else:
        welcome = (
            f"👋 Hello {name}! I'm *AMINA*, your AI health assistant.\n\n"
            "I specialize in Non-Communicable Diseases — diabetes, hypertension, "
            "heart health, asthma, and more.\n\n"
            "🔐 *Patient login:*\n"
            "/login — OTP via SMS\n"
            "/pin — use your PIN\n\n"
            "👩‍⚕️ *Caregiver?* Use /cglogin\n\n"
            "Or just type a health question — no login needed!\n\n"
            "/community · /nudge · /help"
        )
        await _send_text(chat_id, welcome)
        await _send_keyboard(chat_id, "Quick topics:", [
            ["🩺 Diabetes", "❤️ Blood Pressure"],
            ["💊 Medications", "🥗 Diet & Nutrition"],
            ["🧠 Mental Wellness", "🫀 Heart Health"],
        ])
    log.info("start chat_id=%d state=%s", chat_id, state)


async def _cmd_help(chat_id: int, state: str):
    is_patient  = state == LOGGED_IN
    is_cg       = state == CG_LOGGED_IN
    lines = [
        "🤖 *AMINA Commands*\n",
        "*— Always available —*",
        "/start      — Welcome & topic menu",
        "/help       — This message",
        "/clear      — Reset conversation",
        "/language   — Switch language (English / Mandinka)",
        "/login      — Sign in with phone + OTP",
        "/pin        — Sign in with phone + PIN",
        "/nudge      — Today's lifestyle tip",
        "/community  — Village board + seasonal tips",
        "/refer      — Refer a patient to AMINA",
        "/link       — Link code from web app",
        "",
    ]
    if is_patient:
        lines += [
            "*— Your account (logged in) —*",
            "/profile   — View your health profile",
            "/history   — Last 5 consultations",
            "/vitals    — Log blood pressure & glucose",
            "/careplan  — Your personalised care plan",
            "/report    — Download consultation PDF",
            "/logout    — Sign out",
            "",
        ]
    if is_cg:
        lines += [
            "*— Caregiver panel —*",
            "/cgdashboard  — Alerts & patient summary",
            "/cgpatients   — Your assigned patients",
            "/cgalert      — Send info alert (inline)",
            "/cgwarn       — Send warning alert (guided)",
            "/cgemergency  — Send emergency alert (guided)",
            "/cglogout     — Sign out caregiver session",
            "",
        ]
    if not is_cg:
        lines += [
            "*— Caregiver? —*",
            "/cglogin  — Sign in as caregiver",
            "",
        ]
    lines += [
        "*— Also —*",
        "📸 Send a photo of your prescription for analysis",
        "🎙 Send a voice note to talk to AMINA",
        "",
        "⚠️ For emergencies call your local emergency number.",
    ]
    await _send_text(chat_id, "\n".join(lines))


# ── TELEGRAM API ──────────────────────────────────────────────────────────────

async def _send_text(chat_id: int, text: str, parse_mode: str = "Markdown"):
    api    = _api()
    client = await _get_client()
    for chunk in [text[i:i+4000] for i in range(0, len(text), 4000)]:
        try:
            await client.post(f"{api}/sendMessage", json={
                "chat_id": chat_id, "text": chunk, "parse_mode": parse_mode,
            })
        except Exception as e:
            log.error("send_fail chat_id=%d: %s", chat_id, str(e))


async def _send_inline_feedback(chat_id: int, session_id: str, preview: str = ""):
    """Attach 👍/👎 inline keyboard after an AMINA response."""
    api    = _api()
    client = await _get_client()
    safe_sid = session_id.replace("__", "_")
    try:
        await client.post(f"{api}/sendMessage", json={
            "chat_id": chat_id,
            "text": "Was this helpful?",
            "reply_markup": {"inline_keyboard": [[
                {"text": "👍 Helpful",     "callback_data": f"fb_up__{safe_sid}"},
                {"text": "👎 Not helpful", "callback_data": f"fb_dn__{safe_sid}"},
            ]]},
        })
    except Exception as e:
        log.error("inline_feedback_fail: %s", str(e))


async def _send_keyboard(chat_id: int, text: str, buttons: list):
    api    = _api()
    client = await _get_client()
    try:
        await client.post(f"{api}/sendMessage", json={
            "chat_id": chat_id, "text": text,
            "reply_markup": {"keyboard": buttons, "resize_keyboard": True, "one_time_keyboard": True},
        })
    except Exception as e:
        log.error("keyboard_fail: %s", str(e))


async def _send_voice(chat_id: int, ogg_bytes: bytes):
    api    = _api()
    client = await _get_client()
    try:
        await client.post(f"{api}/sendVoice",
            data={"chat_id": str(chat_id)},
            files={"voice": ("voice.ogg", ogg_bytes, "audio/ogg")},
        )
        log.info("voice_sent chat_id=%d bytes=%d", chat_id, len(ogg_bytes))
    except Exception as e:
        log.error("voice_fail: %s", str(e))


async def _send_document(chat_id: int, data: bytes, filename: str, caption: str = ""):
    api    = _api()
    client = await _get_client()
    try:
        await client.post(f"{api}/sendDocument",
            data={"chat_id": str(chat_id), "caption": caption},
            files={"document": (filename, data, "application/pdf")},
        )
        log.info("doc_sent chat_id=%d filename=%s", chat_id, filename)
    except Exception as e:
        log.error("doc_fail: %s", str(e))


async def _typing(chat_id: int):
    try:
        client = await _get_client()
        await client.post(f"{_api()}/sendChatAction",
            json={"chat_id": chat_id, "action": "typing"}
        )
    except Exception:
        pass


async def _download_file(file_id: str) -> Optional[bytes]:
    try:
        client = await _get_client()
        r = await client.post(f"{_api()}/getFile", json={"file_id": file_id})
        if r.status_code != 200:
            return None
        file_path = r.json().get("result", {}).get("file_path", "")
        if not file_path:
            return None
        r = await client.get(
            f"https://api.telegram.org/file/bot{settings.TELEGRAM_BOT_TOKEN}/{file_path}"
        )
        return r.content if r.status_code == 200 else None
    except Exception as e:
        log.error("download_fail: %s", str(e))
        return None


# ── PHONE NORMALISATION ───────────────────────────────────────────────────────

def _normalise_phone(text: str) -> Optional[str]:
    """Accept various formats and return E.164-ish string, or None if invalid."""
    digits = re.sub(r"[\s\-\(\)\.]+", "", text.strip())
    if not digits:
        return None
    if digits.startswith("+"):
        cleaned = digits
    elif digits.startswith("00"):
        cleaned = "+" + digits[2:]
    elif len(digits) >= 7:
        cleaned = digits   # pass through — backend normalises
    else:
        return None
    if len(cleaned.replace("+", "")) < 6:
        return None
    return cleaned


# ── WEBHOOK MANAGEMENT ────────────────────────────────────────────────────────

@router.post("/set-webhook")
async def set_webhook(request: Request):
    if not settings.TELEGRAM_BOT_TOKEN:
        return {"error": "TELEGRAM_BOT_TOKEN not set"}
    body = await request.json()
    url  = body.get("url", "")
    if not url:
        return {"error": "url required"}
    client = await _get_client()
    r = await client.post(f"{_api()}/setWebhook", json={
        "url": url,
        "allowed_updates": ["message", "callback_query"],   # callback_query for feedback buttons
        "drop_pending_updates": True,
        "max_connections": 100,
    })
    result = r.json()
    log.info("webhook_set url=%s ok=%s", url, result.get("ok"))
    return result


@router.delete("/webhook")
async def delete_webhook():
    if not settings.TELEGRAM_BOT_TOKEN:
        return {"error": "TELEGRAM_BOT_TOKEN not set"}
    client = await _get_client()
    r = await client.post(f"{_api()}/deleteWebhook", json={"drop_pending_updates": True})
    return r.json()


@router.get("/webhook-info")
async def webhook_info():
    if not settings.TELEGRAM_BOT_TOKEN:
        return {"error": "TELEGRAM_BOT_TOKEN not set"}
    client = await _get_client()
    r = await client.get(f"{_api()}/getWebhookInfo")
    return r.json()
