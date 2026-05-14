from fastapi import APIRouter, HTTPException, Depends, Request
from pydantic import BaseModel
from typing import Optional, List
import json
import time
import uuid

from src.services.auth import signup, login, verify_jwt, signup_email, login_email, handle_oauth_callback, request_password_reset, confirm_password_reset
from src.services.otp import send_otp, verify_otp, _normalize_phone
from src.agent.amina_agent import get_agent

# AUDIT-007: central audit store for auth events.
try:
    from src.services import audit_event_store as _aes
    _AUDIT_STORE_AVAILABLE = True
except Exception:
    _aes = None
    _AUDIT_STORE_AVAILABLE = False


def _safe_audit_event(**kwargs) -> None:
    """Fire-and-forget audit event. Never raises."""
    if not _AUDIT_STORE_AVAILABLE or _aes is None:
        return
    try:
        _aes.append_event(**kwargs)
    except Exception:
        pass


router = APIRouter(prefix="/auth", tags=["auth"])


class SignupRequest(BaseModel):
    phone: str
    pin: str
    name: str
    age: int = 0
    gender: str = "other"
    region: str = "Kanifing"
    conditions: List[str] = []
    language: str = "english"


class LoginRequest(BaseModel):
    phone: str
    pin: str


class EmailSignupRequest(BaseModel):
    email: str
    password: str
    name: str
    phone: str = ""
    age: int = 0
    gender: str = "other"
    region: str = "Kanifing"
    conditions: List[str] = []
    language: str = "english"


class EmailLoginRequest(BaseModel):
    email: str
    password: str


class OtpSendRequest(BaseModel):
    phone: str  # Full international format: +91XXXXXXXXXX or +220XXXXXXX


class OtpVerifyRequest(BaseModel):
    phone: str
    otp: str
    # Optional signup fields (if new user verifying for first time)
    name: str = ""
    age: int = 0
    gender: str = "other"
    region: str = "Kanifing"
    conditions: List[str] = []


class PasswordResetRequestBody(BaseModel):
    email: str


class PasswordResetConfirmBody(BaseModel):
    token: str
    new_password: str


class OAuthCallbackRequest(BaseModel):
    provider: str  # "google" | "facebook" | "dhis2"
    access_token: str
    id_token: str = ""


class AuthResponse(BaseModel):
    success: bool
    token: Optional[str] = None
    patient: Optional[dict] = None
    error: Optional[str] = None
    session_id: Optional[str] = None


def get_current_patient(request: Request) -> Optional[dict]:
    """Extract patient from JWT token in Authorization header.
    Returns None if no valid token (allows unauthenticated access for MVP)."""
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        return None
    token = auth[7:]
    return verify_jwt(token)


@router.post("/signup", response_model=AuthResponse)
async def auth_signup(req: SignupRequest):
    """Register a new patient with phone + 4-digit PIN.
    Auto-creates PatientVertex in ArcadeDB linked to agent memory."""
    ok, result = signup(
        phone=req.phone,
        pin=req.pin,
        name=req.name,
        age=req.age,
        gender=req.gender,
        region=req.region,
        conditions=req.conditions,
        language=req.language,
    )

    if not ok:
        _safe_audit_event(
            event_type="auth.signup",
            actor_type="patient",
            actor_id=req.phone,
            subject_type="patient",
            subject_id=req.phone,
            action="create",
            resource="/auth/signup",
            outcome="failure",
            reason_code=result.get("error", "unknown")[:64],
        )
        return AuthResponse(success=False, error=result.get("error"))

    # Create a session linked to this patient
    patient_id = result["patient"]["id"]
    _safe_audit_event(
        event_type="auth.signup",
        actor_type="patient",
        actor_id=patient_id,
        subject_type="patient",
        subject_id=patient_id,
        action="create",
        resource="/auth/signup",
        outcome="success",
    )
    sid = f"s_{patient_id}_{int(time.time())}_{uuid.uuid4().hex[:6]}"

    # Pre-seed Redis session + stats
    agent = get_agent()
    mm = agent.memory_manager
    await mm.link_patient_to_session(patient_id, sid)
    await mm.save_session(sid, {
        "messages": [],
        "started_at": __import__("datetime").datetime.now().isoformat(),
        "patient_id": patient_id,
    })
    mm.redis.setex(
        f"stats:{sid}", 365 * 86400,
        json.dumps({"interaction_count": 0, "first_call_at": None, "last_call_at": None}),
    )

    return AuthResponse(
        success=True,
        token=result["token"],
        patient=result["patient"],
        session_id=sid,
    )


@router.post("/login", response_model=AuthResponse)
async def auth_login(req: LoginRequest):
    """Login with phone + PIN. Returns JWT + patient profile + new session."""
    ok, result = login(phone=req.phone, pin=req.pin)

    if not ok:
        _safe_audit_event(
            event_type="auth.login",
            actor_type="patient",
            actor_id=req.phone,
            subject_type="patient",
            subject_id=req.phone,
            action="login",
            resource="/auth/login",
            outcome="failure",
            reason_code="invalid_credentials",
        )
        return AuthResponse(success=False, error=result.get("error"))

    # Create a fresh session for this login
    patient_id = result["patient"]["id"]
    _safe_audit_event(
        event_type="auth.login",
        actor_type="patient",
        actor_id=patient_id,
        subject_type="patient",
        subject_id=patient_id,
        action="login",
        resource="/auth/login",
        outcome="success",
    )
    sid = f"s_{patient_id}_{int(time.time())}_{uuid.uuid4().hex[:6]}"

    agent = get_agent()
    mm = agent.memory_manager
    await mm.link_patient_to_session(patient_id, sid)
    await mm.save_session(sid, {
        "messages": [],
        "started_at": __import__("datetime").datetime.now().isoformat(),
        "patient_id": patient_id,
    })

    # Seed stats from patient profile so trust-tier greeting works
    visit_count = result["patient"].get("visit_count", 0)
    try:
        from src.utils.arcade_client import command_sql as _csql, extract_rows as _er
        resp = _csql(
            "SELECT created_at, updated_at, consultation_count FROM PatientVertex WHERE id = :pid LIMIT 1",
            [patient_id],
        )
        rows = _er(resp)
        if rows:
            p = rows[0]
            count = p.get("consultation_count", visit_count) or visit_count
            stats = {
                "interaction_count": count,
                "first_call_at": p.get("created_at"),
                "last_call_at": p.get("updated_at"),
            }
            mm.redis.setex(f"stats:{sid}", 365 * 86400, json.dumps(stats, default=str))
    except Exception as e:
        # Fallback: seed with visit_count from login response
        stats = {"interaction_count": visit_count, "first_call_at": None, "last_call_at": None}
        mm.redis.setex(f"stats:{sid}", 365 * 86400, json.dumps(stats, default=str))

    return AuthResponse(
        success=True,
        token=result["token"],
        patient=result["patient"],
        session_id=sid,
    )


@router.post("/otp/send")
async def auth_otp_send(req: OtpSendRequest):
    """Send a 6-digit OTP to the phone number via SMS.
    In dev mode (OTP_DEV_MODE=true), returns the OTP in the response."""
    agent = get_agent()
    ok, result = send_otp(req.phone, agent.memory_manager.redis)
    if not ok:
        _safe_audit_event(
            event_type="auth.otp.sent",
            actor_type="patient",
            actor_id=req.phone,
            subject_type="patient",
            subject_id=req.phone,
            action="create",
            resource="/auth/otp/send",
            outcome="failure",
            reason_code=result.get("error", "unknown")[:64],
        )
        return {"success": False, "error": result.get("error")}
    _safe_audit_event(
        event_type="auth.otp.sent",
        actor_type="patient",
        actor_id=req.phone,
        subject_type="patient",
        subject_id=req.phone,
        action="create",
        resource="/auth/otp/send",
        outcome="success",
    )
    return {
        "success": True,
        "message": result.get("message"),
        "phone": result.get("phone"),
        "expires_in": result.get("expires_in"),
        "otp_dev": result.get("otp_dev"),  # Only present in dev mode
    }


@router.post("/otp/verify", response_model=AuthResponse)
async def auth_otp_verify(req: OtpVerifyRequest):
    """Verify OTP and login/signup the user.
    If the phone is new and name is provided, auto-creates account."""
    agent = get_agent()
    mm = agent.memory_manager

    ok, result = verify_otp(req.phone, req.otp, mm.redis)
    if not ok:
        _safe_audit_event(
            event_type="auth.otp.verified",
            actor_type="patient",
            actor_id=req.phone,
            subject_type="patient",
            subject_id=req.phone,
            action="login",
            resource="/auth/otp/verify",
            outcome="failure",
            reason_code=result.get("error", "unknown")[:64],
        )
        return AuthResponse(success=False, error=result.get("error"))

    _safe_audit_event(
        event_type="auth.otp.verified",
        actor_type="patient",
        actor_id=req.phone,
        subject_type="patient",
        subject_id=req.phone,
        action="login",
        resource="/auth/otp/verify",
        outcome="success",
    )

    normalized = result["phone"]
    # Strip + for storage
    phone_clean = normalized.lstrip("+")

    # Check if patient exists — use the auth module's _sql helper for dict params
    from src.services.auth import _sql, _create_jwt, extract_rows
    import json as _json
    try:
        resp = _sql(
            "SELECT id, name FROM PatientVertex WHERE phone = :phone LIMIT 1",
            {"phone": phone_clean},
        )
        rows = extract_rows(resp)
    except Exception:
        rows = []

    if rows:
        # Existing patient — OTP-verified, bypass PIN, generate token directly
        try:
            resp2 = _sql("SELECT * FROM PatientVertex WHERE phone = :phone LIMIT 1", {"phone": phone_clean})
            rows2 = extract_rows(resp2)
            if rows2:
                p = rows2[0]
                for f in ("conditions", "medications", "allergies", "key_facts"):
                    v = p.get(f, "[]")
                    if isinstance(v, str): p[f] = _json.loads(v)
                token = _create_jwt(p.get("id", ""), phone_clean, p.get("name", ""))
                sid = await _create_session_for_patient(p["id"])
                return AuthResponse(
                    success=True, token=token, session_id=sid,
                    patient={
                        "id": p.get("id"), "phone": phone_clean, "name": p.get("name"),
                        "age": p.get("age"), "gender": p.get("gender"), "region": p.get("region"),
                        "conditions": p.get("conditions", []),
                        "medications": [m.get("name", m) if isinstance(m, dict) else m for m in p.get("medications", [])],
                        "language": p.get("preferred_language", "english"),
                        "visit_count": p.get("consultation_count", 0),
                    },
                )
        except Exception:
            pass
        return AuthResponse(success=False, error="Failed to load patient profile")
    else:
        # New user — signup with OTP (no PIN needed, set a random one)
        import uuid as _uuid
        random_pin = str(hash(phone_clean + _uuid.uuid4().hex))[-4:]
        ok3, signup_result = signup(
            phone=phone_clean, pin=random_pin,
            name=req.name or "Patient", age=req.age,
            gender=req.gender, region=req.region,
            conditions=req.conditions, language="english",
        )
        if not ok3:
            return AuthResponse(success=False, error=signup_result.get("error"))
        sid = await _create_session_for_patient(signup_result["patient"]["id"])
        return AuthResponse(
            success=True, token=signup_result["token"],
            patient=signup_result["patient"], session_id=sid,
        )


async def _create_session_for_patient(patient_id: str) -> str:
    """Helper: create a linked session for a patient after login/signup."""
    sid = f"s_{patient_id}_{int(time.time())}_{uuid.uuid4().hex[:6]}"
    agent = get_agent()
    mm = agent.memory_manager
    await mm.link_patient_to_session(patient_id, sid)
    await mm.save_session(sid, {
        "messages": [],
        "started_at": __import__("datetime").datetime.now().isoformat(),
        "patient_id": patient_id,
    })
    return sid


@router.post("/signup/email", response_model=AuthResponse)
async def auth_signup_email(req: EmailSignupRequest):
    """Register with email + password. Auto-creates PatientVertex."""
    ok, result = signup_email(
        email=req.email, password=req.password, name=req.name,
        phone=req.phone, age=req.age, gender=req.gender,
        region=req.region, conditions=req.conditions, language=req.language,
    )
    if not ok:
        return AuthResponse(success=False, error=result.get("error"))

    sid = await _create_session_for_patient(result["patient"]["id"])
    return AuthResponse(
        success=True, token=result["token"],
        patient=result["patient"], session_id=sid,
    )


@router.post("/login/email", response_model=AuthResponse)
async def auth_login_email(req: EmailLoginRequest):
    """Login with email + password."""
    ok, result = login_email(email=req.email, password=req.password)
    if not ok:
        _safe_audit_event(
            event_type="auth.login.email",
            actor_type="patient",
            actor_id=req.email,
            subject_type="patient",
            subject_id=req.email,
            action="login",
            resource="/auth/login/email",
            outcome="failure",
            reason_code="invalid_credentials",
        )
        return AuthResponse(success=False, error=result.get("error"))

    patient_id = result["patient"]["id"]
    _safe_audit_event(
        event_type="auth.login.email",
        actor_type="patient",
        actor_id=patient_id,
        subject_type="patient",
        subject_id=patient_id,
        action="login",
        resource="/auth/login/email",
        outcome="success",
    )

    sid = await _create_session_for_patient(patient_id)
    return AuthResponse(
        success=True, token=result["token"],
        patient=result["patient"], session_id=sid,
    )


@router.post("/password/reset/request")
async def auth_password_reset_request(req: PasswordResetRequestBody):
    """
    Request a password-reset email.

    Always returns success (HTTP 200) regardless of whether the email
    exists — this prevents account enumeration attacks.

    In dev mode (SMTP not configured) the reset token is printed to the
    server log and also returned in the response as `dev_token` so you
    can test without an SMTP server.
    """
    agent = get_agent()
    redis = agent.memory_manager.redis
    ok, result = request_password_reset(req.email, redis)
    response = {"success": True, "message": "If that email is registered, a reset link has been sent."}
    if result.get("dev_token"):
        response["dev_token"] = result["dev_token"]  # only present when SMTP is not configured
    return response


@router.post("/password/reset/confirm")
async def auth_password_reset_confirm(req: PasswordResetConfirmBody):
    """
    Confirm a password reset using the token from the email link.

    On success, the token is invalidated (one-time use) and the patient
    can log in immediately with their new password.
    """
    agent = get_agent()
    redis = agent.memory_manager.redis
    ok, result = confirm_password_reset(req.token, req.new_password, redis)
    if not ok:
        return {"success": False, "error": result.get("error")}
    return {"success": True, "message": "Password updated. You can now sign in with your new password."}


@router.post("/oauth/callback", response_model=AuthResponse)
async def auth_oauth_callback(req: OAuthCallbackRequest):
    """Handle OAuth callback from Google, Facebook, or DHIS2.

    The frontend handles the OAuth popup/redirect and sends
    the access_token here. We verify it with the provider
    and create/login the patient.
    """
    from src.config import settings
    import httpx

    provider = req.provider.lower()
    email = ""
    name = ""
    oauth_id = ""

    try:
        if provider == "google":
            # Verify Google token
            async with httpx.AsyncClient() as client:
                r = await client.get(
                    "https://www.googleapis.com/oauth2/v3/userinfo",
                    headers={"Authorization": f"Bearer {req.access_token}"},
                )
                if r.status_code == 200:
                    data = r.json()
                    email = data.get("email", "")
                    name = data.get("name", "")
                    oauth_id = data.get("sub", "")
                else:
                    return AuthResponse(success=False, error="Google token verification failed")

        elif provider == "facebook":
            # BUG-028 fix: pass the FB access token via Authorization
            # header instead of the URL query string. The Graph API
            # accepts `Authorization: OAuth <token>`; this keeps the
            # token out of intermediate proxy logs, browser history,
            # and Referer headers.
            async with httpx.AsyncClient() as client:
                r = await client.get(
                    "https://graph.facebook.com/me?fields=id,name,email",
                    headers={"Authorization": f"OAuth {req.access_token}"},
                )
                if r.status_code == 200:
                    data = r.json()
                    email = data.get("email", "")
                    name = data.get("name", "")
                    oauth_id = data.get("id", "")
                else:
                    return AuthResponse(success=False, error="Facebook token verification failed")

        elif provider == "dhis2":
            async with httpx.AsyncClient() as client:
                r = await client.get(
                    f"{settings.DHIS2_BASE_URL}/api/me",
                    headers={"Authorization": f"Bearer {req.access_token}"},
                )
                if r.status_code == 200:
                    data = r.json()
                    email = data.get("email", "")
                    name = data.get("displayName", data.get("name", ""))
                    oauth_id = data.get("id", "")
                else:
                    return AuthResponse(success=False, error="DHIS2 token verification failed")
        else:
            return AuthResponse(success=False, error=f"Unknown provider: {provider}")

    except Exception as e:
        return AuthResponse(success=False, error=f"OAuth verification failed: {e}")

    if not oauth_id:
        return AuthResponse(success=False, error="Could not verify identity")

    ok, result = handle_oauth_callback(provider, oauth_id, email, name)
    if not ok:
        return AuthResponse(success=False, error=result.get("error"))

    sid = await _create_session_for_patient(result["patient"]["id"])
    return AuthResponse(
        success=True, token=result["token"],
        patient=result["patient"], session_id=sid,
    )


@router.get("/providers")
async def auth_providers():
    """Return which auth providers are configured.
    Frontend uses this to show/hide OAuth buttons."""
    from src.config import settings
    return {
        "phone_pin": True,
        "email_password": True,
        "google": bool(settings.GOOGLE_OAUTH_CLIENT_ID),
        "facebook": bool(settings.FACEBOOK_APP_ID),
        "dhis2": bool(settings.DHIS2_CLIENT_ID),
        "dhis2_url": settings.DHIS2_BASE_URL if settings.DHIS2_CLIENT_ID else None,
    }


@router.get("/me")
async def auth_me(request: Request):
    """Get current patient profile from JWT token."""
    patient = get_current_patient(request)
    if not patient:
        raise HTTPException(status_code=401, detail="Not authenticated")

    # Load full profile from ArcadeDB
    from src.utils.arcade_client import command_sql, extract_rows
    try:
        resp = command_sql(
            "SELECT * FROM PatientVertex WHERE id = :pid LIMIT 1",
            [patient["sub"]],
        )
        rows = extract_rows(resp)
        if not rows:
            raise HTTPException(status_code=404, detail="Patient not found")

        p = rows[0]
        for field in ("conditions", "medications", "allergies", "key_facts"):
            val = p.get(field, "[]")
            if isinstance(val, str):
                p[field] = json.loads(val)

        return {
            "id": p.get("id"),
            "name": p.get("name"),
            "phone": p.get("phone"),
            "age": p.get("age"),
            "gender": p.get("gender"),
            "region": p.get("region"),
            "conditions": p.get("conditions", []),
            "medications": [
                m.get("name", m) if isinstance(m, dict) else m
                for m in p.get("medications", [])
            ],
            "allergies": p.get("allergies", []),
            "key_facts": p.get("key_facts", []),
            "language": p.get("preferred_language", "english"),
            "visit_count": p.get("consultation_count", 0),
            "last_visit": p.get("last_consultation"),
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
