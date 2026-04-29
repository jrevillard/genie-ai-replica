"""
Observatory Synthetic Data Governance
=====================================

Central API for the Observatory's synthetic-data posture. This module
is the single source of truth for:
  - Whether the system is running in synthetic or production data mode
  - Synthetic-record metadata (db-level tagging)
  - Consent acceptance audit logging
  - Legal disclaimer text loading
  - Signed production-authorization file validation

Defense-in-depth principle: production mode requires deliberate,
documented, signed authorization. Default is synthetic. Without a
valid signed auth file at the configured path, is_production_mode()
returns False even if OBSERVATORY_DATA_MODE=production.

This module is purely additive -- no edits to existing flows.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import logging
import os
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from src.services import observatory_security as _obs

logger = logging.getLogger(__name__)


# ══════════════════════════════════════════════════════════════════
#  MODE FLAGS
# ══════════════════════════════════════════════════════════════════

_DATA_MODE_RAW = (os.getenv("OBSERVATORY_DATA_MODE") or "synthetic").strip().lower()
_PRODUCTION_AUTH_FILE = os.getenv("OBSERVATORY_PRODUCTION_AUTH_FILE", "")
_PRODUCTION_AUTH_KEY = os.getenv("OBSERVATORY_PRODUCTION_AUTH_KEY", "")


def is_synthetic_mode() -> bool:
    """True when the Observatory is in synthetic-data mode (default)."""
    return not is_production_mode()


def is_production_mode() -> bool:
    """True ONLY when:
      1. OBSERVATORY_DATA_MODE=production env var is set, AND
      2. A valid signed authorization file is present at the
         OBSERVATORY_PRODUCTION_AUTH_FILE path with all required
         keys + a verifiable HMAC signature.

    Any other state -> synthetic. Defense in depth: an env var
    alone cannot flip production. Authorization is a deliberate,
    documented, signed action.
    """
    if _DATA_MODE_RAW != "production":
        return False
    return production_authorization_valid(_PRODUCTION_AUTH_FILE)


def data_mode() -> str:
    """Returns 'synthetic' or 'production'."""
    return "production" if is_production_mode() else "synthetic"


# ══════════════════════════════════════════════════════════════════
#  SIGNED PRODUCTION AUTHORIZATION FILE
#
#  Required JSON keys:
#    moh_authorization_ref  -- MoH authorization reference number
#    ethics_clearance_ref   -- Ethics board clearance number
#    authorized_at          -- ISO-8601 date of authorization
#    authorized_by          -- name + title of authorizing officer
#    valid_through          -- ISO-8601 expiry
#    signature              -- HMAC-SHA256 hex of the canonicalized
#                              other keys, signed with
#                              OBSERVATORY_PRODUCTION_AUTH_KEY
# ══════════════════════════════════════════════════════════════════

_REQUIRED_AUTH_KEYS = (
    "moh_authorization_ref",
    "ethics_clearance_ref",
    "authorized_at",
    "authorized_by",
    "valid_through",
    "signature",
)


def production_authorization_valid(path: Optional[str]) -> bool:
    """Validate a signed production-authorization file.
    Returns False (not raises) on any error to fail safely
    toward synthetic mode.
    """
    if not path:
        return False
    if not os.path.isfile(path):
        logger.warning("Production auth file missing at %s -- staying synthetic", path)
        return False
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception as e:
        logger.warning("Production auth file unreadable: %s -- staying synthetic", e)
        return False

    for k in _REQUIRED_AUTH_KEYS:
        if not data.get(k):
            logger.warning("Production auth file missing required key %s", k)
            return False

    # Validate expiry
    try:
        valid_through = datetime.fromisoformat(
            data["valid_through"].replace("Z", "+00:00")
        )
        if valid_through < datetime.now(timezone.utc):
            logger.warning(
                "Production auth file expired (valid_through=%s) -- staying synthetic",
                data["valid_through"],
            )
            return False
    except Exception as e:
        logger.warning("Production auth valid_through unparseable: %s", e)
        return False

    # Validate signature -- the signature key must match an HMAC of
    # all other required keys serialized in canonical order.
    if not _PRODUCTION_AUTH_KEY:
        logger.warning(
            "OBSERVATORY_PRODUCTION_AUTH_KEY not set -- cannot verify "
            "production auth file. Staying synthetic."
        )
        return False

    payload = {k: data[k] for k in _REQUIRED_AUTH_KEYS if k != "signature"}
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    expected = hmac.new(
        _PRODUCTION_AUTH_KEY.encode("utf-8"),
        canonical.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    if not hmac.compare_digest(expected, data["signature"]):
        logger.warning("Production auth signature mismatch -- staying synthetic")
        return False

    logger.info(
        "Production mode authorized: ref=%s by=%s through=%s",
        data["moh_authorization_ref"], data["authorized_by"], data["valid_through"],
    )
    return True


# ══════════════════════════════════════════════════════════════════
#  SYNTHETIC RECORD METADATA
#
#  Helper for db-level tagging of synthetic records. Use this when
#  inserting any seeded / generated record so that even at the
#  storage layer there is no ambiguity about real vs synthetic.
# ══════════════════════════════════════════════════════════════════

_GENERATOR_VERSION = "1.0"


def synthetic_metadata(
    generator: str = "amina_synthetic_seed",
    extra: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Returns a flat metadata dict to spread into a record."""
    md = {
        "is_synthetic":        True,
        "generated_by":        generator,
        "generated_at":        datetime.now(timezone.utc).isoformat(),
        "synthetic_version":   _GENERATOR_VERSION,
        "based_on_real_data":  False,
        "safe_to_display":     True,
        "safe_to_export":      True,
        "safe_for_decisions":  False,
        "safe_for_citation":   False,
    }
    if extra:
        md.update(extra)
    return md


# ══════════════════════════════════════════════════════════════════
#  RESPONSE HEADERS (used by middleware)
# ══════════════════════════════════════════════════════════════════

SYNTHETIC_RESPONSE_HEADERS = {
    "X-Data-Classification": "SYNTHETIC",
    "X-Data-Disclaimer": (
        "Synthetic data only -- artificially generated for architecture "
        "demonstration. No real patient information."
    ),
    "X-Environment": "demonstration",
    "X-Real-Data": "false",
}

PRODUCTION_RESPONSE_HEADERS = {
    "X-Data-Classification": "PRODUCTION",
    "X-Environment": "production",
    "X-Real-Data": "true",
}


def response_headers() -> Dict[str, str]:
    """Headers to attach to every Observatory API response."""
    return dict(PRODUCTION_RESPONSE_HEADERS if is_production_mode() else SYNTHETIC_RESPONSE_HEADERS)


# ══════════════════════════════════════════════════════════════════
#  CONSENT RECORDING + AUDIT
#
#  Consent is session-scoped. We do not persist a "user has consented
#  forever" record -- per spec, users re-accept every session. We
#  audit-log every acceptance for legal traceability.
# ══════════════════════════════════════════════════════════════════

_CONSENT_TTL = 8 * 3600  # 8 hours, matches session lifetime


def record_consent(
    consent_id: str,
    ip_address: str,
    user_agent: str,
    accepted_synthetic: bool,
    accepted_no_real_use: bool,
) -> Dict[str, Any]:
    """Record a consent acceptance.
    Returns a receipt dict that the caller embeds in the response cookie.
    """
    timestamp = datetime.now(timezone.utc).isoformat()

    receipt = {
        "consent_id":            consent_id,
        "accepted_at":           timestamp,
        "accepted_synthetic":    bool(accepted_synthetic),
        "accepted_no_real_use":  bool(accepted_no_real_use),
        "ip_address":            ip_address,
        "user_agent":            (user_agent or "")[:200],
        "data_mode":             data_mode(),
        "version":               "consent.v1.2026-04",
    }

    # Stash in Redis with 8-hour TTL so server-side checks can verify
    # the cookie is bound to a real audit entry.
    r = _obs._get_redis()
    if r:
        try:
            r.setex(
                f"obs_consent:{consent_id}",
                _CONSENT_TTL,
                json.dumps(receipt),
            )
        except Exception as e:
            logger.debug("consent redis store failed: %s", e)

    # Audit log
    try:
        _obs.log_audit_event(
            event_type="observatory_consent_accepted",
            staff_id=f"consent:{consent_id[:12]}",
            ip_address=ip_address,
            user_agent=user_agent,
            success=True,
            session_id=consent_id,
            extra={
                "accepted_synthetic":   bool(accepted_synthetic),
                "accepted_no_real_use": bool(accepted_no_real_use),
                "data_mode":            data_mode(),
            },
        )
    except Exception as e:
        logger.debug("consent audit log failed: %s", e)

    logger.info(
        "Observatory consent accepted: id=%s ip=%s mode=%s",
        consent_id[:12], ip_address, data_mode(),
    )
    return receipt


def get_consent_receipt(consent_id: str) -> Optional[Dict[str, Any]]:
    """Look up a previously recorded consent (server-side check)."""
    if not consent_id:
        return None
    r = _obs._get_redis()
    if not r:
        return None
    try:
        raw = r.get(f"obs_consent:{consent_id}")
        if not raw:
            return None
        return json.loads(raw)
    except Exception:
        return None


def revoke_consent(consent_id: str) -> None:
    r = _obs._get_redis()
    if r:
        try:
            r.delete(f"obs_consent:{consent_id}")
        except Exception:
            pass


# ══════════════════════════════════════════════════════════════════
#  LEGAL DISCLAIMER TEXT
# ══════════════════════════════════════════════════════════════════

_DISCLAIMER_VERSION = "1.0"
_DISCLAIMER_LAST_UPDATED = "2026-04"

_DISCLAIMER_SECTIONS: List[Dict[str, str]] = [
    {
        "heading": "1. Nature of Data",
        "body": (
            "All data displayed, stored, and processed within this "
            "demonstration environment of the AMINA NCD Observatory is "
            "entirely synthetic. It has been artificially generated using "
            "randomized algorithms and does not represent, reflect, or "
            "derive from any real individual, patient, health worker, "
            "community, health facility, or geographic area in The Gambia "
            "or any other country."
        ),
    },
    {
        "heading": "2. No Real Patient Information",
        "body": (
            "This system contains zero real patient data. No Protected "
            "Health Information (PHI), Personally Identifiable Information "
            "(PII), or any data subject to health data protection regulations "
            "has been collected, stored, or displayed."
        ),
    },
    {
        "heading": "3. Purpose",
        "body": (
            "This environment exists solely to demonstrate the technical "
            "architecture, user interface design, and workflow capabilities "
            "of the AMINA NCD Observatory platform. It is intended for "
            "evaluation by technical reviewers, competition judges, and "
            "potential deployment partners."
        ),
    },
    {
        "heading": "4. Prohibited Uses",
        "body": (
            "Data from this system must NOT be: "
            "(a) used to make clinical decisions about any patient; "
            "(b) used to inform health policy decisions; "
            "(c) cited in academic papers, reports, or publications as "
            "representing real health statistics; "
            "(d) shared with media as real health data; "
            "(e) used for any statistical analysis claiming to represent "
            "The Gambia's health status."
        ),
    },
    {
        "heading": "5. Future Production Use",
        "body": (
            "When deployed in a production environment with real patient "
            "data, this system will comply with: (a) The Gambia's health "
            "data governance framework; (b) WHO guidelines on health "
            "information systems; (c) the African Union Convention on "
            "Cyber Security and Personal Data Protection (Malabo Convention); "
            "(d) applicable data protection regulations as enacted by The Gambia."
        ),
    },
    {
        "heading": "6. Contact",
        "body": (
            "For information about real NCD data in The Gambia: Ministry of "
            "Health, Directorate of Health Services; WHO Gambia Country Office; "
            "Gambia Bureau of Statistics (GBoS). For information about the "
            "AMINA platform: AMINA Technical Team / UNICC."
        ),
    },
]


def get_disclaimer_text() -> Dict[str, Any]:
    return {
        "title":         "AMINA NCD Observatory — Data Disclaimer",
        "version":       _DISCLAIMER_VERSION,
        "last_updated":  _DISCLAIMER_LAST_UPDATED,
        "data_mode":     data_mode(),
        "summary": (
            "This system contains SYNTHETIC DATA ONLY. No real patient "
            "information is stored, displayed, or processed. This is a "
            "TECHNICAL ARCHITECTURE DEMONSTRATION."
        ),
        "consent_clauses": [
            "I understand that ALL data in this system is synthetic and "
            "this is an architecture demonstration only.",
            "I agree not to interpret, cite, or use any data shown as "
            "representing real health statistics of The Gambia.",
        ],
        "sections": _DISCLAIMER_SECTIONS,
    }


# ══════════════════════════════════════════════════════════════════
#  EXPORT DISCLAIMER HELPERS
# ══════════════════════════════════════════════════════════════════

CSV_DISCLAIMER_HEADER = (
    "# SYNTHETIC DATA — ARCHITECTURE DEMONSTRATION ONLY\n"
    "# This file contains artificially generated data. No real patient information.\n"
    "# Not for clinical, policy, statistical, or academic use.\n"
)

PDF_DISCLAIMER_HEADER = "SYNTHETIC DATA — AMINA Architecture Demonstration"
PDF_DISCLAIMER_FOOTER = (
    "Contains no real patient data. Not for clinical or policy use."
)


def csv_disclaimer_lines() -> List[str]:
    if not is_synthetic_mode():
        return []
    return [line for line in CSV_DISCLAIMER_HEADER.strip().split("\n")]


# ══════════════════════════════════════════════════════════════════
#  BOOT BANNER
# ══════════════════════════════════════════════════════════════════

def log_boot_banner() -> None:
    """Print a clear startup banner so operators can see the mode."""
    mode = data_mode()
    if mode == "synthetic":
        logger.info(
            "[OBSERVATORY MODE] SYNTHETIC -- All data is artificially "
            "generated. Production mode requires a signed authorization "
            "file at OBSERVATORY_PRODUCTION_AUTH_FILE + valid HMAC key."
        )
    else:
        logger.warning(
            "[OBSERVATORY MODE] PRODUCTION -- Real data may be processed. "
            "Verify authorization is current."
        )


__all__ = [
    "is_synthetic_mode",
    "is_production_mode",
    "data_mode",
    "production_authorization_valid",
    "synthetic_metadata",
    "response_headers",
    "SYNTHETIC_RESPONSE_HEADERS",
    "record_consent",
    "get_consent_receipt",
    "revoke_consent",
    "get_disclaimer_text",
    "CSV_DISCLAIMER_HEADER",
    "PDF_DISCLAIMER_HEADER",
    "PDF_DISCLAIMER_FOOTER",
    "csv_disclaimer_lines",
    "log_boot_banner",
]
