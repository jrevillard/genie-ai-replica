"""
Caregiver notification helpers.
===============================

Bridges the existing `inbox_service.create_item` (originally scoped to
patients) so it can ALSO deliver items keyed on `caregiver_id`. The
underlying InboxItemVertex store is id-agnostic — it just indexes on
the `patient_id` field — so we reuse it for caregivers with no schema
change, and expose a thin set of typed helpers the rest of the code
can call without knowing the wiring.

Three entry points:

  - notify_caregiver_chat(...)    — new direct-chat message from patient
  - notify_patient_chat(...)      — new direct-chat message from caregiver
  - notify_caregiver_emergency(...)  — patient fired an SOS/emergency

All helpers are defensive: any Arcade hiccup is swallowed + logged, so
an inbox push never takes down the caller (chat send, alert SMS, etc).
"""

from __future__ import annotations

import logging
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)


def _clip(text: str, n: int) -> str:
    t = (text or "").strip()
    return t if len(t) <= n else (t[: n - 1] + "…")


def _push(
    owner_id: str,
    *,
    kind: str,
    title: str,
    body: str = "",
    severity: str = "info",
    source: str = "caregiver",
    source_id: str = "",
    action_url: str = "",
    metadata: Optional[Dict[str, Any]] = None,
    ttl_days: int = 60,
) -> Optional[str]:
    """Core wrapper — safe no-op if inbox_service is unavailable."""
    if not owner_id:
        return None
    try:
        from src.services import inbox_service
        item = inbox_service.create_item(
            patient_id=owner_id,   # inbox table is id-agnostic
            kind=kind,
            title=_clip(title, 200),
            body=_clip(body, 4000),
            severity=severity,
            source=source,
            source_id=source_id or "",
            action_url=action_url or "",
            metadata=metadata or {},
            ttl_days=ttl_days,
        )
        return (item or {}).get("inbox_id")
    except Exception as exc:
        logger.warning(f"caregiver_notify push failed for owner={owner_id}: {exc}")
        return None


# ── Chat messages ─────────────────────────────────────────────────────

def notify_caregiver_chat(
    caregiver_id: str, patient_id: str, patient_name: str, text: str,
) -> Optional[str]:
    """Patient → caregiver: new direct-chat message notification."""
    preview = _clip(text, 200)
    return _push(
        owner_id=caregiver_id,
        kind="caregiver_ping",
        title=f"New message from {patient_name or 'your patient'}",
        body=preview,
        severity="info",
        source="caregiver",
        source_id=f"chat:{patient_id}",
        action_url="/caregiver/chat",
        metadata={
            "event":      "chat.patient_to_caregiver",
            "patient_id": patient_id,
        },
    )


def notify_patient_chat(
    patient_id: str, caregiver_id: str, caregiver_name: str, text: str,
) -> Optional[str]:
    """Caregiver → patient: new direct-chat message notification."""
    preview = _clip(text, 200)
    return _push(
        owner_id=patient_id,
        kind="caregiver_ping",
        title=f"Message from {caregiver_name or 'your caregiver'}",
        body=preview,
        severity="info",
        source="caregiver",
        source_id=f"chat:{caregiver_id}",
        action_url="/chat/caregiver",
        metadata={
            "event":        "chat.caregiver_to_patient",
            "caregiver_id": caregiver_id,
        },
    )


# ── Emergency alerts ──────────────────────────────────────────────────

def notify_caregiver_emergency(
    caregiver_id: str,
    patient_id: str,
    patient_name: str,
    message: str,
    alert_type: str = "emergency_triage",
) -> Optional[str]:
    """Push an *emergency severity* inbox item so the caregiver's bell
    pulses red even if the SMS got eaten by a spam filter or weak
    network.  Redundancy with the existing SMS path is the point."""
    preview = _clip(message, 400)
    return _push(
        owner_id=caregiver_id,
        kind="alert",
        title=f"⚠ EMERGENCY — {patient_name or 'your patient'}",
        body=preview or "Emergency alert triggered. Please contact your patient immediately.",
        severity="emergency",
        source="system",
        source_id=f"emergency:{patient_id}:{alert_type}",
        action_url="/caregiver/emergency",
        metadata={
            "event":      "emergency.caregiver_alert",
            "patient_id": patient_id,
            "alert_type": alert_type,
        },
    )


# ── Batch helpers (many caregivers for one patient) ────────────────────

def fanout_caregiver_emergency(
    patient_id: str, patient_name: str, message: str,
    alert_type: str = "emergency_triage",
) -> Dict[str, Any]:
    """Resolve every active caregiver of a patient and push an emergency
    inbox item to each. Returns a small audit dict so the caller can
    log how many alerts landed."""
    recipients: list = []
    try:
        from src.repositories.caregiver_repo import CaregiverRepository
        cgs = CaregiverRepository().get_caregivers_for_patient(patient_id) or []
        for cg in cgs:
            if cg.get("is_revoked"):
                continue
            if "alerts" not in (cg.get("permissions") or []):
                continue
            cid = cg.get("caregiver_id") or cg.get("id") or ""
            if not cid:
                continue
            inbox_id = notify_caregiver_emergency(
                caregiver_id=cid,
                patient_id=patient_id,
                patient_name=patient_name,
                message=message,
                alert_type=alert_type,
            )
            recipients.append({
                "caregiver_id": cid,
                "inbox_id":     inbox_id,
                "delivered":    bool(inbox_id),
            })
    except Exception as exc:
        logger.warning(f"caregiver emergency fanout failed: {exc}")

    return {
        "delivered_count": sum(1 for r in recipients if r["delivered"]),
        "recipients":      recipients,
    }


def fanout_caregiver_chat(
    patient_id: str, patient_name: str, text: str,
) -> Dict[str, Any]:
    """Patient→caregiver chat: push to ALL linked caregivers' inboxes.
    (In practice the frontend also polls, but this gives any sleeping
    caregiver phone/desktop a wake-up.)"""
    recipients: list = []
    try:
        from src.repositories.caregiver_repo import CaregiverRepository
        cgs = CaregiverRepository().get_caregivers_for_patient(patient_id) or []
        for cg in cgs:
            if cg.get("is_revoked"):
                continue
            cid = cg.get("caregiver_id") or cg.get("id") or ""
            if not cid:
                continue
            inbox_id = notify_caregiver_chat(
                caregiver_id=cid,
                patient_id=patient_id,
                patient_name=patient_name,
                text=text,
            )
            recipients.append({"caregiver_id": cid, "inbox_id": inbox_id,
                               "delivered":    bool(inbox_id)})
    except Exception as exc:
        logger.warning(f"caregiver chat fanout failed: {exc}")
    return {
        "delivered_count": sum(1 for r in recipients if r["delivered"]),
        "recipients":      recipients,
    }
