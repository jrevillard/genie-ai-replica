"""
Observatory Disclaimer & Consent API
====================================

Endpoints for the synthetic-data governance layer:

  POST /observatory/consent         -- record a consent acceptance
  GET  /observatory/consent/{id}    -- look up an existing receipt
  GET  /observatory/disclaimer      -- full legal disclaimer text
  GET  /observatory/data-mode       -- "synthetic" or "production"
  GET  /observatory/synthetic-metadata -- example metadata template

This module is purely additive -- no edits to existing flows.
"""
from __future__ import annotations

import logging
import secrets
from typing import Optional

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, Field

from src.services import observatory_synthetic as _syn

logger = logging.getLogger(__name__)

router = APIRouter(tags=["observatory-disclaimer"])


# ──────────────────────────────────────────────────────────────────
#  REQUEST MODELS
# ──────────────────────────────────────────────────────────────────

class ConsentRequest(BaseModel):
    accepted_synthetic: bool = Field(
        ..., description="User confirms data is synthetic (clause 1)"
    )
    accepted_no_real_use: bool = Field(
        ..., description="User confirms not interpreting as real data (clause 2)"
    )


# ──────────────────────────────────────────────────────────────────
#  HELPERS
# ──────────────────────────────────────────────────────────────────

def _client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def _user_agent(request: Request) -> str:
    return request.headers.get("user-agent", "")[:200]


# ──────────────────────────────────────────────────────────────────
#  ENDPOINTS
# ──────────────────────────────────────────────────────────────────

@router.get("/observatory/data-mode")
def get_data_mode():
    """Returns the current data mode -- always 'synthetic' unless
    a valid signed production-authorization file is present."""
    return {
        "data_mode":          _syn.data_mode(),
        "is_synthetic":       _syn.is_synthetic_mode(),
        "is_production":      _syn.is_production_mode(),
        "warning": (
            "All data in this environment is synthetic and intended for "
            "demonstration only."
            if _syn.is_synthetic_mode()
            else "Production mode is active. Real data may be processed."
        ),
    }


@router.get("/observatory/disclaimer")
def get_disclaimer():
    """Full legal disclaimer text for the consent gate + disclaimer page."""
    return _syn.get_disclaimer_text()


@router.get("/observatory/synthetic-metadata")
def get_synthetic_metadata_template():
    """Example synthetic-record metadata. For developer reference --
    use observatory_synthetic.synthetic_metadata() server-side."""
    return _syn.synthetic_metadata(
        generator="amina_synthetic_seed",
        extra={"_note": "This is a template only -- attach to real records server-side"},
    )


@router.post("/observatory/consent")
def post_consent(req: ConsentRequest, request: Request, response: Response):
    """Record a consent acceptance.

    Both clauses must be true. We assign a fresh consent_id, store the
    receipt server-side (Redis, 8h TTL), audit-log it, and set a
    session-only cookie.
    """
    if not req.accepted_synthetic or not req.accepted_no_real_use:
        raise HTTPException(400, detail={
            "code":    "consent_incomplete",
            "message": "Both consent clauses must be accepted to proceed.",
        })

    consent_id = f"CONSENT-{secrets.token_hex(10)}"
    ip = _client_ip(request)
    ua = _user_agent(request)

    receipt = _syn.record_consent(
        consent_id=consent_id,
        ip_address=ip,
        user_agent=ua,
        accepted_synthetic=req.accepted_synthetic,
        accepted_no_real_use=req.accepted_no_real_use,
    )

    # Session-only cookie (no max-age = browser-session lifetime, cleared on close)
    # SameSite=Strict because this is an internal admin tool
    response.set_cookie(
        key="observatory_consent",
        value=consent_id,
        httponly=False,  # readable by frontend so it can decide to skip the gate
        secure=False,    # set True in production behind HTTPS
        samesite="strict",
        path="/",
    )

    return {
        "status":     "accepted",
        "consent_id": consent_id,
        "receipt":    receipt,
        "expires":    "browser_session_end",
    }


@router.get("/observatory/consent/{consent_id}")
def get_consent(consent_id: str):
    """Verify an existing consent receipt is still valid."""
    if not consent_id or not consent_id.startswith("CONSENT-"):
        raise HTTPException(400, detail={"code": "invalid_consent_id"})
    receipt = _syn.get_consent_receipt(consent_id)
    if not receipt:
        raise HTTPException(404, detail={
            "code":    "consent_not_found",
            "message": "No active consent receipt -- please re-accept.",
        })
    return {"valid": True, "receipt": receipt}


@router.delete("/observatory/consent/{consent_id}")
def revoke_consent(consent_id: str):
    _syn.revoke_consent(consent_id)
    return {"status": "revoked"}
