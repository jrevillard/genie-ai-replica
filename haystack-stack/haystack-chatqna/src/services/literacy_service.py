"""
AMINA Care — Literacy Mode + Education Verification
=====================================================
Maps a patient's declared (and admin-verified) education level to one of
three UI literacy modes:

    beginner   — safest floor: big buttons, auto-narration, minimal text.
                 Default for all new patients until admin verifies.
    basic      — simplified chrome, larger fonts, 3 quick actions.
                 Unlocked when admin verifies at Upper Basic or equivalent.
    advanced   — full UI (what the app shipped with).
                 Unlocked when admin verifies at Senior Secondary / Tertiary.

Gambian education levels supported:
    none          — Never attended school                   → beginner
    lower_basic   — Lower Basic School (Grades 1–6)         → beginner
    upper_basic   — Upper Basic School (Grades 7–9)         → basic
    senior_sec    — Senior Secondary School (Grades 10–12)  → advanced
    tertiary      — University / college / vocational       → advanced

Verification policy:
    - Declared level is stored immediately on signup onboarding.
    - Certificate is optional for `none` / `lower_basic`; the admin can
      still approve those based on self-declaration.
    - For `upper_basic` and above, a certificate is required for
      verification. Until admin approves, user is capped at `beginner`.
    - Admin can approve at the declared level, approve at a lower level,
      or reject. Per the no-delete policy, rejected records are retained
      (status = "rejected") so the audit trail survives.

Storage:
    LiteracyProfileVertex(patient_id, declared_level, verified_level,
                          current_mode, status, verified_by,
                          verified_at, created_at, updated_at)
    EducationCertificateVertex(cert_id, patient_id, filename, mime_type,
                               size_bytes, storage_path, uploaded_at,
                               status, reviewer, reviewer_note, reviewed_at,
                               declared_level)

One profile row per patient; one certificate row per upload (patients can
re-upload, in which case the newest non-rejected cert is the active one).
"""

from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime
from typing import Dict, List, Optional

from src.utils.arcade_client import command_sql

logger = logging.getLogger(__name__)


# ── Level → mode mapping ─────────────────────────────────────────────────────

LEVELS = ("none", "lower_basic", "upper_basic", "senior_sec", "tertiary")

LEVEL_TO_MODE = {
    "none":        "beginner",
    "lower_basic": "beginner",
    "upper_basic": "basic",
    "senior_sec":  "advanced",
    "tertiary":    "advanced",
}

MODES = ("beginner", "basic", "advanced")

# Levels that require a certificate before admin verification.
LEVELS_REQUIRING_CERT = ("upper_basic", "senior_sec", "tertiary")

VERIFICATION_STATUS = ("not_submitted", "pending", "approved", "rejected")


def mode_for_level(level: Optional[str]) -> str:
    """Map an education level string to a literacy mode. Unknown → beginner."""
    return LEVEL_TO_MODE.get((level or "").strip().lower(), "beginner")


def _now_iso() -> str:
    return datetime.utcnow().isoformat() + "Z"


# ── Schema ────────────────────────────────────────────────────────────────────

def ensure_literacy_schema() -> None:
    """Idempotent. Creates LiteracyProfileVertex + EducationCertificateVertex."""
    stmts = [
        "CREATE VERTEX TYPE LiteracyProfileVertex IF NOT EXISTS",
        "CREATE PROPERTY LiteracyProfileVertex.patient_id IF NOT EXISTS STRING",
        "CREATE PROPERTY LiteracyProfileVertex.declared_level IF NOT EXISTS STRING",
        "CREATE PROPERTY LiteracyProfileVertex.verified_level IF NOT EXISTS STRING",
        "CREATE PROPERTY LiteracyProfileVertex.current_mode IF NOT EXISTS STRING",
        "CREATE PROPERTY LiteracyProfileVertex.status IF NOT EXISTS STRING",
        "CREATE PROPERTY LiteracyProfileVertex.verified_by IF NOT EXISTS STRING",
        "CREATE PROPERTY LiteracyProfileVertex.verified_at IF NOT EXISTS STRING",
        "CREATE PROPERTY LiteracyProfileVertex.created_at IF NOT EXISTS STRING",
        "CREATE PROPERTY LiteracyProfileVertex.updated_at IF NOT EXISTS STRING",
        "CREATE PROPERTY LiteracyProfileVertex.reviewer_note IF NOT EXISTS STRING",

        "CREATE VERTEX TYPE EducationCertificateVertex IF NOT EXISTS",
        "CREATE PROPERTY EducationCertificateVertex.cert_id IF NOT EXISTS STRING",
        "CREATE PROPERTY EducationCertificateVertex.patient_id IF NOT EXISTS STRING",
        "CREATE PROPERTY EducationCertificateVertex.declared_level IF NOT EXISTS STRING",
        "CREATE PROPERTY EducationCertificateVertex.filename IF NOT EXISTS STRING",
        "CREATE PROPERTY EducationCertificateVertex.mime_type IF NOT EXISTS STRING",
        "CREATE PROPERTY EducationCertificateVertex.size_bytes IF NOT EXISTS INTEGER",
        "CREATE PROPERTY EducationCertificateVertex.storage_path IF NOT EXISTS STRING",
        "CREATE PROPERTY EducationCertificateVertex.uploaded_at IF NOT EXISTS STRING",
        "CREATE PROPERTY EducationCertificateVertex.status IF NOT EXISTS STRING",
        "CREATE PROPERTY EducationCertificateVertex.reviewer IF NOT EXISTS STRING",
        "CREATE PROPERTY EducationCertificateVertex.reviewer_note IF NOT EXISTS STRING",
        "CREATE PROPERTY EducationCertificateVertex.reviewed_at IF NOT EXISTS STRING",
    ]
    for s in stmts:
        try:
            command_sql(s)
        except Exception as e:
            logger.debug(f"literacy schema step: {s[:60]}... -> {e}")


# ── Profile: read ─────────────────────────────────────────────────────────────

def get_profile(patient_id: str) -> Dict:
    """Return the patient's literacy profile (or a default if none)."""
    if not patient_id:
        return _default_profile("")
    try:
        resp = command_sql(
            "SELECT declared_level, verified_level, current_mode, status, "
            "verified_by, verified_at, created_at, updated_at, reviewer_note "
            "FROM LiteracyProfileVertex WHERE patient_id = :pid LIMIT 1",
            {"pid": patient_id},
        )
        rows = (resp or {}).get("result", [])
        if not rows:
            return _default_profile(patient_id)
        row = rows[0]
        return {
            "patient_id":     patient_id,
            "declared_level": row.get("declared_level") or "",
            "verified_level": row.get("verified_level") or "",
            "current_mode":   row.get("current_mode") or "beginner",
            "status":         row.get("status") or "not_submitted",
            "verified_by":    row.get("verified_by") or "",
            "verified_at":    row.get("verified_at") or "",
            "created_at":     row.get("created_at") or "",
            "updated_at":     row.get("updated_at") or "",
            "reviewer_note":  row.get("reviewer_note") or "",
            "exists":         True,
        }
    except Exception as e:
        logger.error(f"literacy: get_profile failed for {patient_id}: {e}")
        return _default_profile(patient_id)


def _default_profile(patient_id: str) -> Dict:
    return {
        "patient_id":     patient_id,
        "declared_level": "",
        "verified_level": "",
        "current_mode":   "beginner",
        "status":         "not_submitted",
        "verified_by":    "",
        "verified_at":    "",
        "created_at":     "",
        "updated_at":     "",
        "reviewer_note":  "",
        "exists":         False,
    }


def needs_onboarding(patient_id: str) -> bool:
    """True when the onboarding gate should be shown."""
    p = get_profile(patient_id)
    return not p.get("exists") or not p.get("declared_level")


# ── Profile: write ───────────────────────────────────────────────────────────

def declare_level(
    patient_id: str,
    declared_level: str,
) -> Dict:
    """
    Record the patient's self-declared education level. Called from the
    onboarding gate. The current_mode is always set to 'beginner' here —
    the declared level only *unlocks* higher modes once an admin verifies.
    """
    level = (declared_level or "").strip().lower()
    if level not in LEVELS:
        return {"ok": False, "error": f"invalid level {declared_level!r}"}
    if not patient_id:
        return {"ok": False, "error": "patient_id required"}

    existing = get_profile(patient_id)
    now = _now_iso()

    # Status:
    #   - levels requiring cert → pending (even before cert upload, so
    #     the review queue can hold a placeholder)
    #   - levels not requiring cert → pending (admin still reviews the
    #     self-declaration, but without a file)
    new_status = "pending"

    try:
        if existing.get("exists"):
            command_sql(
                "UPDATE LiteracyProfileVertex SET declared_level = :lvl, "
                "current_mode = 'beginner', status = :st, updated_at = :t "
                "WHERE patient_id = :pid",
                {"lvl": level, "st": new_status, "t": now, "pid": patient_id},
            )
        else:
            record = {
                "patient_id":     patient_id,
                "declared_level": level,
                "verified_level": "",
                "current_mode":   "beginner",
                "status":         new_status,
                "verified_by":    "",
                "verified_at":    "",
                "created_at":     now,
                "updated_at":     now,
                "reviewer_note":  "",
            }
            command_sql(
                "INSERT INTO LiteracyProfileVertex CONTENT " + json.dumps(record)
            )
    except Exception as e:
        logger.error(f"literacy: declare_level failed for {patient_id}: {e}")
        return {"ok": False, "error": str(e)}

    return {
        "ok":             True,
        "patient_id":     patient_id,
        "declared_level": level,
        "current_mode":   "beginner",
        "status":         new_status,
        "requires_cert":  level in LEVELS_REQUIRING_CERT,
    }


# ── Certificate records ──────────────────────────────────────────────────────

def record_certificate(
    patient_id: str,
    declared_level: str,
    filename: str,
    mime_type: str,
    size_bytes: int,
    storage_path: str,
) -> Dict:
    """Create an EducationCertificateVertex row for an uploaded file."""
    cert_id = uuid.uuid4().hex
    now = _now_iso()
    record = {
        "cert_id":        cert_id,
        "patient_id":     patient_id,
        "declared_level": (declared_level or "").strip().lower(),
        "filename":       filename[:200],
        "mime_type":      (mime_type or "")[:80],
        "size_bytes":     int(size_bytes or 0),
        "storage_path":   storage_path,
        "uploaded_at":    now,
        "status":         "pending",
        "reviewer":       "",
        "reviewer_note":  "",
        "reviewed_at":    "",
    }
    try:
        command_sql(
            "INSERT INTO EducationCertificateVertex CONTENT " + json.dumps(record)
        )
    except Exception as e:
        logger.error(f"literacy: record_certificate insert failed: {e}")
        return {"ok": False, "error": str(e)}

    # Ensure the profile is at least in 'pending' so the admin queue picks it up.
    try:
        command_sql(
            "UPDATE LiteracyProfileVertex SET status = 'pending', updated_at = :t "
            "WHERE patient_id = :pid",
            {"t": now, "pid": patient_id},
        )
    except Exception as e:
        logger.debug(f"literacy: profile status bump failed: {e}")

    return {"ok": True, "cert_id": cert_id, "status": "pending"}


def latest_certificate(patient_id: str) -> Optional[Dict]:
    """Return the most recent non-rejected cert for a patient, or None."""
    try:
        resp = command_sql(
            "SELECT cert_id, declared_level, filename, mime_type, size_bytes, "
            "storage_path, uploaded_at, status "
            "FROM EducationCertificateVertex "
            "WHERE patient_id = :pid AND status <> 'rejected' "
            "ORDER BY uploaded_at DESC LIMIT 1",
            {"pid": patient_id},
        )
        rows = (resp or {}).get("result", [])
        return rows[0] if rows else None
    except Exception as e:
        logger.error(f"literacy: latest_certificate failed: {e}")
        return None


def get_certificate(cert_id: str) -> Optional[Dict]:
    try:
        resp = command_sql(
            "SELECT cert_id, patient_id, declared_level, filename, mime_type, "
            "size_bytes, storage_path, uploaded_at, status, reviewer, "
            "reviewer_note, reviewed_at "
            "FROM EducationCertificateVertex WHERE cert_id = :cid LIMIT 1",
            {"cid": cert_id},
        )
        rows = (resp or {}).get("result", [])
        return rows[0] if rows else None
    except Exception as e:
        logger.error(f"literacy: get_certificate failed: {e}")
        return None


# ── Admin: queue + decisions ─────────────────────────────────────────────────

def list_pending_reviews(limit: int = 100) -> List[Dict]:
    """
    Return patients waiting for literacy verification. Includes:
      - patients with a declared level but status 'pending'
      - their latest non-rejected certificate (if any)
    Joins are done in Python because ArcadeDB SQL joins are limited.
    """
    try:
        resp = command_sql(
            "SELECT patient_id, declared_level, current_mode, status, "
            "created_at, updated_at FROM LiteracyProfileVertex "
            "WHERE status = 'pending' ORDER BY updated_at DESC LIMIT :lim",
            {"lim": limit},
        )
        profiles = (resp or {}).get("result", [])
    except Exception as e:
        logger.error(f"literacy: list_pending_reviews failed: {e}")
        return []

    out: List[Dict] = []
    for p in profiles:
        pid = p.get("patient_id") or ""
        cert = latest_certificate(pid)
        patient_name = _lookup_patient_name(pid)
        out.append({
            "patient_id":     pid,
            "patient_name":   patient_name,
            "declared_level": p.get("declared_level") or "",
            "status":         p.get("status") or "pending",
            "current_mode":   p.get("current_mode") or "beginner",
            "updated_at":     p.get("updated_at") or "",
            "created_at":     p.get("created_at") or "",
            "has_certificate": cert is not None,
            "certificate":    {
                "cert_id":     cert.get("cert_id") if cert else "",
                "filename":    cert.get("filename") if cert else "",
                "mime_type":   cert.get("mime_type") if cert else "",
                "size_bytes":  cert.get("size_bytes") if cert else 0,
                "uploaded_at": cert.get("uploaded_at") if cert else "",
            } if cert else None,
        })
    return out


def _lookup_patient_name(patient_id: str) -> str:
    try:
        resp = command_sql(
            "SELECT name FROM PatientVertex WHERE id = :pid LIMIT 1",
            {"pid": patient_id},
        )
        rows = (resp or {}).get("result", [])
        return rows[0].get("name", "") if rows else ""
    except Exception:
        return ""


def approve_verification(
    patient_id: str,
    verified_level: str,
    reviewer: str,
    note: str = "",
) -> Dict:
    """
    Admin approves a patient's literacy profile at the given verified level.
    The level granted may be equal to or lower than the declared level. The
    current_mode is set accordingly. Associated pending certificates are
    marked 'approved'.
    """
    level = (verified_level or "").strip().lower()
    if level not in LEVELS:
        return {"ok": False, "error": f"invalid level {verified_level!r}"}
    if not patient_id:
        return {"ok": False, "error": "patient_id required"}

    mode = mode_for_level(level)
    now = _now_iso()

    try:
        command_sql(
            "UPDATE LiteracyProfileVertex SET verified_level = :lvl, "
            "current_mode = :mode, status = 'approved', verified_by = :who, "
            "verified_at = :t, updated_at = :t, reviewer_note = :note "
            "WHERE patient_id = :pid",
            {
                "lvl":  level, "mode": mode, "who": reviewer or "admin",
                "t":    now,   "pid":  patient_id, "note": (note or "")[:500],
            },
        )
    except Exception as e:
        logger.error(f"literacy: approve update failed for {patient_id}: {e}")
        return {"ok": False, "error": str(e)}

    # Mark the patient's active (non-rejected) certificates as approved.
    try:
        command_sql(
            "UPDATE EducationCertificateVertex SET status = 'approved', "
            "reviewer = :who, reviewer_note = :note, reviewed_at = :t "
            "WHERE patient_id = :pid AND status = 'pending'",
            {"who": reviewer or "admin", "note": (note or "")[:500],
             "t":   now, "pid": patient_id},
        )
    except Exception as e:
        logger.debug(f"literacy: cert approve update failed: {e}")

    return {
        "ok":             True,
        "patient_id":     patient_id,
        "verified_level": level,
        "current_mode":   mode,
        "status":         "approved",
    }


def reject_verification(
    patient_id: str,
    reviewer: str,
    note: str,
) -> Dict:
    """Admin rejects the current verification. Per no-delete policy, we
    only flip statuses — nothing is removed."""
    if not patient_id:
        return {"ok": False, "error": "patient_id required"}
    if not (note or "").strip():
        return {"ok": False, "error": "rejection reason required"}

    now = _now_iso()
    try:
        command_sql(
            "UPDATE LiteracyProfileVertex SET status = 'rejected', "
            "current_mode = 'beginner', verified_level = '', "
            "verified_by = :who, verified_at = :t, updated_at = :t, "
            "reviewer_note = :note WHERE patient_id = :pid",
            {"who": reviewer or "admin", "t": now, "pid": patient_id,
             "note": (note or "")[:500]},
        )
    except Exception as e:
        logger.error(f"literacy: reject update failed for {patient_id}: {e}")
        return {"ok": False, "error": str(e)}

    try:
        command_sql(
            "UPDATE EducationCertificateVertex SET status = 'rejected', "
            "reviewer = :who, reviewer_note = :note, reviewed_at = :t "
            "WHERE patient_id = :pid AND status = 'pending'",
            {"who": reviewer or "admin", "note": (note or "")[:500],
             "t":   now, "pid": patient_id},
        )
    except Exception as e:
        logger.debug(f"literacy: cert reject update failed: {e}")

    return {
        "ok":           True,
        "patient_id":   patient_id,
        "status":       "rejected",
        "current_mode": "beginner",
    }
