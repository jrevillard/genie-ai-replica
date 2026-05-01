"""
AMINA Care — SMART-on-FHIR HTTP surface
==========================================
Endpoints
---------
  GET  /api/v1/smart/.well-known/smart-configuration  — public discovery
  GET  /api/v1/smart/authorize                        — initiate auth + consent
  POST /api/v1/smart/approve                          — user approves consent
  GET  /api/v1/smart/deny                             — user denies
  POST /api/v1/smart/token                            — code -> access token

The authorize endpoint renders a minimal HTML consent page when the user is
already authenticated (AMINA_TOKEN cookie or query param), or a login prompt
when not. This keeps the MVP self-contained — no full OAuth UI framework
required.
"""

from __future__ import annotations

import base64
import logging
import secrets
from typing import Any, Dict, Optional
from urllib.parse import urlencode

import jwt
from fastapi import APIRouter, Form, HTTPException, Query, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse

from src.config import settings
from src.services import smart_service

logger = logging.getLogger(__name__)
router = APIRouter(tags=["smart"])


# ── Discovery ────────────────────────────────────────────────────────────────

@router.get("/.well-known/smart-configuration")
def well_known_smart():
    return JSONResponse(smart_service.smart_configuration())


# ── Helpers ──────────────────────────────────────────────────────────────────

def _err_redirect(redirect_uri: str, state: str, error: str, desc: str = "") -> RedirectResponse:
    q = {"error": error, "state": state or ""}
    if desc:
        q["error_description"] = desc
    url = f"{redirect_uri}{'&' if '?' in redirect_uri else '?'}{urlencode(q)}"
    return RedirectResponse(url, status_code=302)


def _decode_amina_jwt(token: str) -> Optional[Dict[str, Any]]:
    if not token:
        return None
    try:
        return jwt.decode(token, settings.JWT_SECRET, algorithms=["HS256"])
    except Exception:
        return None


def _try_read_current_user(request: Request, amina_token_query: Optional[str]) -> Optional[Dict[str, Any]]:
    """
    Resolve the current AMINA user from one of three sources, in order
    of preference:
      1. Header  Authorization: Bearer <token>      (preferred)
      2. Header  X-AMINA-Token: <token>             (preferred alt)
      3. Cookie  "AMINA_TOKEN"                      (preferred for browsers)
      4. Query   ?amina_token=...                   (DEPRECATED -- BUG-012)

    BUG-012 fix: query-string tokens leak into browser history, server
    access logs, and Referer headers. We still accept them so existing
    demo/QA flows do not break, but every successful resolution via the
    query string emits a deprecation warning naming the client IP so
    the operator can chase down the caller.
    """
    header = request.headers.get("Authorization") or ""
    bearer = header.split(" ", 1)[1] if header.lower().startswith("bearer ") else ""
    x_amina = (request.headers.get("X-AMINA-Token") or "").strip()
    cookie = request.cookies.get("AMINA_TOKEN")

    for tok in (bearer, x_amina, cookie):
        payload = _decode_amina_jwt(tok)
        if payload and payload.get("sub"):
            return payload

    # Last resort: query-string token. Log loudly.
    if amina_token_query:
        payload = _decode_amina_jwt(amina_token_query)
        if payload and payload.get("sub"):
            client_ip = request.client.host if request.client else "unknown"
            logger.warning(
                "[SECURITY] BUG-012: AMINA token received via ?amina_token= "
                "query string. This is deprecated and will be removed. "
                "Switch the caller to Authorization: Bearer <token>. "
                "ip=%s ua=%r path=%s",
                client_ip,
                request.headers.get("user-agent", "")[:120],
                request.url.path,
            )
            return payload
    return None


# ── Authorize ────────────────────────────────────────────────────────────────

@router.get("/smart/authorize")
def authorize(
    request: Request,
    response_type:         str = Query(...),
    client_id:             str = Query(...),
    redirect_uri:          str = Query(...),
    scope:                 str = Query(""),
    state:                 str = Query(""),
    aud:                   Optional[str] = Query(None),
    launch:                Optional[str] = Query(None),
    code_challenge:        Optional[str] = Query(None),
    code_challenge_method: Optional[str] = Query(None),
    amina_token:           Optional[str] = Query(None, description="DEV: passed-in AMINA JWT"),
):
    """
    SMART authorize endpoint. Validates the request, renders an inline
    consent page, and (on approval) issues an authorization code.
    """
    # --- Client & redirect validation ---
    client = smart_service.get_client(client_id)
    if not client:
        return JSONResponse({"error": "invalid_client"}, status_code=400)

    if not smart_service.validate_redirect_uri(client, redirect_uri):
        # DO NOT redirect — the redirect URI is precisely what we don't trust.
        return JSONResponse({"error": "invalid_redirect_uri"}, status_code=400)

    if response_type != "code":
        return _err_redirect(redirect_uri, state, "unsupported_response_type")

    # Filter scopes down to what the client is allowed.
    granted_scope = smart_service.filter_scopes(scope, client.get("scopes") or [])
    if not granted_scope:
        return _err_redirect(redirect_uri, state, "invalid_scope")

    # PKCE (public clients REQUIRED by SMART v2).
    if client.get("requires_pkce"):
        if not code_challenge:
            return _err_redirect(redirect_uri, state, "invalid_request", "pkce required")
        if code_challenge_method and code_challenge_method.upper() not in ("S256", "PLAIN"):
            return _err_redirect(redirect_uri, state, "invalid_request", "bad code_challenge_method")

    # Launch context (EHR-initiated launch).
    launch_patient = ""
    if launch:
        ctx = smart_service.resolve_launch_context(launch)
        if not ctx:
            return _err_redirect(redirect_uri, state, "invalid_request", "expired launch token")
        launch_patient = ctx.get("patient") or ""

    # --- Identity: do we already know who the user is? ---
    user = _try_read_current_user(request, amina_token)

    # Stash the request so /approve can pick it up on POST.
    req = smart_service.AuthRequest(
        request_id=secrets.token_urlsafe(16),
        client_id=client_id,
        redirect_uri=redirect_uri,
        scope=granted_scope,
        state=state,
        code_challenge=code_challenge or "",
        code_challenge_method=(code_challenge_method or ("S256" if code_challenge else "")),
        aud=aud or "",
        launch_patient_id=launch_patient,
        launch_token=launch or "",
        patient_id=(launch_patient or (user.get("sub") if user else "")),
        user_id=(user.get("sub") if user else ""),
        user_role=(user.get("role") if user else "patient"),
    )
    smart_service.stash_auth_request(req)

    # Render consent page.
    return HTMLResponse(_consent_html(req, client, user))


def _consent_html(req: smart_service.AuthRequest, client: Dict[str, Any], user: Optional[Dict[str, Any]]) -> str:
    scope_items = "".join(
        f"<li><code>{s}</code></li>" for s in req.scope.split()
    )
    display_name = client.get("name", req.client_id)
    if user:
        user_line = (
            f"<p class='who'>Signed in as <strong>"
            f"{user.get('name') or user.get('sub')}</strong> "
            f"<small>({user.get('role') or 'patient'})</small></p>"
        )
        patient_line = (
            f"<p class='pt'>FHIR patient: <code>{req.patient_id or '(none)'}</code></p>"
        )
        buttons = f"""
          <form method="POST" action="/api/v1/smart/approve" class="actions">
            <input type="hidden" name="request_id" value="{req.request_id}" />
            <button type="submit" class="btn approve">Approve access</button>
          </form>
          <a class="btn deny" href="/api/v1/smart/deny?request_id={req.request_id}">Deny</a>
        """
    else:
        # Minimal login prompt — real deployments should redirect to the full
        # AuthScreen. For MVP we give QA a way to sign in by pasting a token.
        user_line = "<p class='who warn'>You must be signed in to approve.</p>"
        patient_line = ""
        buttons = f"""
          <form method="GET" action="/api/v1/smart/authorize" class="actions">
            <input type="hidden" name="response_type" value="code"/>
            <input type="hidden" name="client_id"     value="{req.client_id}"/>
            <input type="hidden" name="redirect_uri"  value="{req.redirect_uri}"/>
            <input type="hidden" name="scope"         value="{req.scope}"/>
            <input type="hidden" name="state"         value="{req.state}"/>
            {'<input type="hidden" name="code_challenge" value="' + req.code_challenge + '"/>' if req.code_challenge else ''}
            {'<input type="hidden" name="code_challenge_method" value="' + req.code_challenge_method + '"/>' if req.code_challenge_method else ''}
            {'<input type="hidden" name="launch" value="' + req.launch_token + '"/>' if req.launch_token else ''}
            <label>Paste your AMINA access token to continue:</label>
            <input type="text" name="amina_token" required style="width:100%;margin-top:6px;padding:8px;"/>
            <button type="submit" class="btn approve" style="margin-top:10px;">Continue</button>
          </form>
        """

    return f"""
<!doctype html><html><head><meta charset='utf-8'>
<title>Authorize — {display_name}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  :root {{ color-scheme: light dark; }}
  * {{ box-sizing: border-box; }}
  body {{ font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
         margin: 0; padding: 24px;
         background: linear-gradient(135deg, #e0f2fe, #f0fdfa);
         color: #0f172a; min-height: 100vh;
         display:flex; align-items:center; justify-content:center; }}
  .card {{ background:#fff; max-width:520px; width:100%;
           border-radius:14px; padding:28px 30px;
           box-shadow:0 20px 60px rgba(15,23,42,0.12);
           border:1px solid #cbd5e1; }}
  h1 {{ margin:0 0 4px; font-size:18px; color:#0f766e; }}
  .sub {{ margin:0 0 18px; color:#64748b; font-size:13px; }}
  .who {{ margin:12px 0; font-size:13px; }}
  .who.warn {{ color:#b45309; }}
  .pt {{ margin:2px 0 14px; font-size:12.5px; color:#475569; }}
  ul {{ padding-left:20px; margin:10px 0 18px; font-size:13px; color:#334155;
        line-height:1.6; }}
  code {{ background:#f1f5f9; padding:1px 5px; border-radius:4px; font-size:12px; }}
  .actions {{ display:flex; gap:10px; margin-top:8px; flex-wrap:wrap; }}
  .btn {{ padding:9px 18px; border-radius:8px; border:none; cursor:pointer;
          font-weight:600; font-size:13px; text-decoration:none; display:inline-block; }}
  .btn.approve {{ background:linear-gradient(135deg,#0f766e,#14b8a6); color:#fff; }}
  .btn.deny {{ background:#f1f5f9; color:#475569; }}
  label {{ font-size:12.5px; color:#475569; font-weight:600; }}
  input[type=text] {{ border:1px solid #cbd5e1; border-radius:6px; font-size:13px; }}
</style></head>
<body><div class='card'>
  <h1>{display_name}</h1>
  <p class='sub'>wants to access your Amina Care record</p>
  {user_line}
  {patient_line}
  <div style="font-size:12.5px;font-weight:600;color:#0f172a;margin-top:4px;">
    Requested scopes
  </div>
  <ul>{scope_items}</ul>
  {buttons}
  <p style='font-size:11px;color:#94a3b8;margin-top:20px;'>
    By approving, you allow this app to read (not write) your clinical data
    for the scopes above. You can revoke access any time from your Amina
    account settings.
  </p>
</div></body></html>
"""


# ── Approve / Deny ───────────────────────────────────────────────────────────

@router.post("/smart/approve")
async def approve(request: Request, request_id: str = Form(...)):
    req = smart_service.load_auth_request(request_id)
    if not req:
        return JSONResponse({"error": "invalid_request", "detail": "pending request expired"},
                            status_code=400)

    # Re-check user identity now (avoid CSRF + consent forgery).
    user = _try_read_current_user(request, None)
    if not user:
        # Preserve the request and force re-auth by re-rendering authorize.
        # For MVP we just redirect back to the authorize endpoint which will
        # ask for the token again.
        q = {
            "response_type": "code",
            "client_id":     req.client_id,
            "redirect_uri":  req.redirect_uri,
            "scope":         req.scope,
            "state":         req.state,
        }
        if req.code_challenge:
            q["code_challenge"] = req.code_challenge
            q["code_challenge_method"] = req.code_challenge_method
        if req.launch_token:
            q["launch"] = req.launch_token
        return RedirectResponse(f"/api/v1/smart/authorize?{urlencode(q)}", status_code=302)

    # Bind the signed-in user into the request and issue a code.
    req.user_id    = user.get("sub") or ""
    req.user_role  = user.get("role") or "patient"
    if not req.patient_id:
        # Standalone launch: for patient accounts the subject IS the patient.
        if req.user_role == "patient":
            req.patient_id = req.user_id
        elif req.user_role == "caregiver":
            req.patient_id = user.get("patient_id") or req.user_id

    smart_service.stash_auth_request(req)   # refresh TTL so issue_code can read
    code = smart_service.issue_code(req)
    smart_service.discard_auth_request(req.request_id)

    q = {"code": code}
    if req.state:
        q["state"] = req.state
    redir = f"{req.redirect_uri}{'&' if '?' in req.redirect_uri else '?'}{urlencode(q)}"
    return RedirectResponse(redir, status_code=302)


@router.get("/smart/deny")
def deny(request_id: str = Query(...)):
    req = smart_service.load_auth_request(request_id)
    if not req:
        return JSONResponse({"error": "invalid_request"}, status_code=400)
    smart_service.discard_auth_request(req.request_id)
    return _err_redirect(req.redirect_uri, req.state,
                         "access_denied", "user declined consent")


# ── Token ────────────────────────────────────────────────────────────────────

@router.post("/smart/token")
async def token(request: Request):
    """
    Authorization-code -> access-token exchange. Accepts form-encoded body
    per OAuth 2 spec. Supports:
      - grant_type=authorization_code
      - PKCE code_verifier (required if code issued with challenge)
      - confidential clients via Basic auth (client_id:secret) OR form body
    """
    form = await request.form()
    grant_type    = (form.get("grant_type") or "").lower()
    code          = form.get("code") or ""
    redirect_uri  = form.get("redirect_uri") or ""
    client_id     = form.get("client_id") or ""
    client_secret = form.get("client_secret") or ""
    code_verifier = form.get("code_verifier") or ""

    # Basic-auth client credentials
    auth_hdr = request.headers.get("Authorization", "")
    if auth_hdr.lower().startswith("basic "):
        try:
            creds = base64.b64decode(auth_hdr.split(" ", 1)[1]).decode("utf-8", "replace")
            cid, _, csec = creds.partition(":")
            client_id = client_id or cid
            client_secret = client_secret or csec
        except Exception:
            pass

    if grant_type != "authorization_code":
        return JSONResponse({"error": "unsupported_grant_type"}, status_code=400)

    client = smart_service.get_client(client_id)
    if not client:
        return JSONResponse({"error": "invalid_client"}, status_code=401)

    expected_secret = client.get("client_secret")
    if expected_secret:
        if not secrets.compare_digest(expected_secret, client_secret or ""):
            return JSONResponse({"error": "invalid_client"}, status_code=401)

    rec = smart_service.consume_code(
        code,
        client_id=client_id,
        redirect_uri=redirect_uri,
        code_verifier=code_verifier or None,
    )
    if not rec:
        return JSONResponse({"error": "invalid_grant"}, status_code=400)

    token_resp = smart_service.issue_access_token(rec)
    return JSONResponse(token_resp, status_code=200,
                        headers={"Cache-Control": "no-store", "Pragma": "no-cache"})
