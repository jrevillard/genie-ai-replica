"""
AMINA Care — Caregiver Registration: Optional Invite Code Patch
================================================================
Strict-additive shim for /api/v1/caregiver-v2/register that drops the
"Invalid or expired invite code" hard-fail for family caregivers.

Why
---
The original v2 route (src/api/caregiver_registration_v2_routes.py) hard
rejects family caregivers without a server-stored caregiver_invite:<code>.
That blocks the legitimate flow where a family member signs up first and
the patient links them later via the existing admin approval queue.

What changes
------------
- Family caregivers may register WITH or WITHOUT an invite code.
- If a code is supplied AND it matches a stored invite, we record the
  patient_id from the invite onto the application (existing behaviour).
- If the code is missing, blank, or unknown, the application is still
  saved as `pending` and shows up in the admin approval queue exactly
  the same way every other role does. Admin can then approve/reject
  manually.
- Every other role's flow is byte-identical to the original.

How it integrates
-----------------
This is a pure shim: it inserts a NEW route at /api/v1/caregiver-v2/register
at index 0 of app.routes so it is matched BEFORE the original. The
original route remains in app.routes and is reachable as a fallback
only if the shim is later disabled.

Wired by main_with_rag_tuning.py via install_optional_invite(app).
"""
from __future__ import annotations

import json
import logging
import time
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, FastAPI, HTTPException, Request

_log = logging.getLogger("caregiver_registration_optional_invite")

_INSTALLED = False


async def _register_with_optional_invite(request: Request):
    """Replacement endpoint for POST /caregiver-v2/register.

    Mirrors the original logic exactly except for the family invite
    block, which becomes optional + soft-validated.
    """
    # Imports are deferred so a stale module reference can't break startup.
    from src.api.caregiver_registration_v2_routes import (
        _validate_registration,
        _gen_reg_id,
        _save_application,
        _redis,
    )
    from src.models.caregiver_roles import (
        REGISTRATION_REQUIREMENTS,
        ROLE_LABELS,
        CaregiverApprovalStatus,
    )

    try:
        body = await request.json()
    except Exception:
        raise HTTPException(400, "Invalid JSON body")

    errors = _validate_registration(body)
    role = body.get("role", "")
    # Family is allowed to register without a patient_invite_code or a
    # relationship; admin approves them via the existing
    # /caregiver-v2/admin/review queue. We strip just those two
    # missing-field errors and let everything else (phone format, PIN,
    # etc.) continue to gate as before.
    if role == "family":
        _OPTIONAL_FAMILY = {
            "Missing required field: patient_invite_code",
            "Missing required field: relationship",
        }
        errors = [e for e in errors if e not in _OPTIONAL_FAMILY]
    if errors:
        raise HTTPException(400, detail={"errors": errors})

    role = body["role"]
    reqs = REGISTRATION_REQUIREMENTS.get(role)
    if not reqs:
        raise HTTPException(400, f"Unknown role: {role}")

    reg_id = _gen_reg_id()
    now = datetime.utcnow().isoformat() + "Z"

    # ── Family invite handling: SOFT validation ──────────────────────
    # Accept any of: missing, blank, or non-matching code. Record the
    # code on the application either way so admins can spot impostor
    # attempts. If the code matches a stored invite, attach the
    # patient_id so admin sees the linkage at review time.
    invite_status = "none"
    invite_patient_id: Optional[str] = None
    if role == "family":
        invite_code_raw = (body.get("patient_invite_code") or "").strip()
        if invite_code_raw:
            invite_code = invite_code_raw.upper()
            r = _redis()
            if r:
                invite_data = r.get(f"caregiver_invite:{invite_code}")
                if invite_data:
                    invite_status = "matched"
                    try:
                        parsed = json.loads(invite_data)
                        invite_patient_id = parsed.get("patient_id")
                    except Exception:
                        # Older invites may be stored as a bare patient_id.
                        invite_patient_id = invite_data
                else:
                    invite_status = "unknown"
            else:
                invite_status = "redis_unavailable"
        else:
            invite_status = "missing"

    # ── Approval chain ───────────────────────────────────────────────
    # For most roles we use whatever REGISTRATION_REQUIREMENTS defines.
    # For family caregivers we override the chain so that the admin
    # review queue actually activates the account on a single approve:
    #   - matched invite -> original patient_confirmation chain (the
    #     patient that issued the code is still asked to confirm)
    #   - no/unknown invite -> single admin_review step so the existing
    #     /caregiver-v2/admin/review POST flips status straight to active
    if role == "family" and invite_status != "matched":
        chain_steps = ["admin_review"]
    else:
        chain_steps = list(reqs["approval_chain"])
    chain = [
        {
            "step_name":    step_name,
            "completed":    False,
            "completed_at": None,
            "completed_by": None,
            "note":         None,
        }
        for step_name in chain_steps
    ]

    app_record = {
        "registration_id":    reg_id,
        "caregiver_id":       None,
        "role":               role,
        "role_label":         ROLE_LABELS.get(role, role),
        "status":             CaregiverApprovalStatus.PENDING.value,
        "full_name":          body["full_name"].strip(),
        "phone":              body["phone"].strip(),
        "pin":                body["pin"],
        "village":            (body.get("village") or "").strip() or None,
        "health_region":      (body.get("health_region") or "").strip() or None,
        "registration_data": {
            k: v for k, v in body.items()
            if k not in ("full_name", "phone", "pin", "role")
        },
        "uploaded_documents": {},
        "approval_chain":     chain,
        "submitted_at":       now,
        "reviewed_at":        None,
        "reviewed_by":        None,
        "activated_at":       None,
        "rejection_reason":   None,
        "audit_log": [
            {"ts": now, "action": "registered", "by": "self",
             "detail": f"Registered as {ROLE_LABELS.get(role, role)}"},
        ],
    }

    # Family-only: stamp the invite outcome onto the application so the
    # existing admin UI can render it without any UI change.
    if role == "family":
        app_record["registration_data"]["invite_status"] = invite_status
        if invite_patient_id:
            app_record["registration_data"]["invited_by_patient_id"] = invite_patient_id
        app_record["audit_log"].append({
            "ts":     now,
            "action": "invite_check",
            "by":     "system",
            "detail": (f"Invite code matched patient {invite_patient_id}"
                       if invite_status == "matched"
                       else f"Invite code {invite_status} — admin approval required"),
        })

    if not _save_application(app_record):
        raise HTTPException(500, "Failed to save registration")

    timeout = reqs.get("approval_timeout_days", 14)
    if role == "family" and invite_status == "matched":
        next_steps = "Your patient will receive a notification to confirm."
    else:
        next_steps = f"Your application will be reviewed by an admin within {timeout} days."

    return {
        "ok":              True,
        "registration_id": reg_id,
        "status":          "pending",
        "role":            role,
        "role_label":      ROLE_LABELS.get(role, role),
        "next_steps":      next_steps,
        "message":         f"Registration submitted. We will SMS you at {body['phone']} when approved.",
    }


def install_optional_invite(app: FastAPI) -> None:
    """Insert the relaxed /caregiver-v2/register route ahead of the
    original. Idempotent — safe to call repeatedly across reloads."""
    global _INSTALLED
    if _INSTALLED:
        return

    target_path = "/api/v1/caregiver-v2/register"

    # Build the shim router and wire it onto the app.
    tmp = APIRouter()
    tmp.add_api_route(
        path=target_path,
        endpoint=_register_with_optional_invite,
        methods=["POST"],
        name="register_caregiver_v2_optional_invite",
        tags=["caregiver-registration-v2"],
    )

    n_before = len(app.routes)
    app.include_router(tmp)
    new_routes = app.routes[n_before:]

    # Move the new route to index 0 so it shadows the original on match.
    for r in new_routes:
        try:
            app.routes.remove(r)
        except ValueError:
            pass
    for r in reversed(new_routes):
        app.routes.insert(0, r)

    _INSTALLED = True
    _log.info("optional_invite patch installed — /caregiver-v2/register now accepts family caregivers without invite codes")


# Convenience wrapper so main_with_rag_tuning.py can do
#     from src.services.caregiver_registration_optional_invite import install
# without thinking about the name.
install = install_optional_invite
