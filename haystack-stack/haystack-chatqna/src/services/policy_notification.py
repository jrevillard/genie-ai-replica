"""
Caregiver Policy Notification Service
=====================================

Broadcasts a policy update to all active caregivers by creating an
InboxItemVertex per caregiver. Uses the existing inbox_service.create_item()
to write the row, then stamps the new policy-specific fields onto it.

Idempotency
-----------
Two layers of protection against duplicate broadcasts:

  1. Per-caregiver dedup key: the deterministic source_id
        f"policy:{policy_type}:{policy_version}"
     is set on every inbox item created by this service. A pre-insert
     lookup on (patient_id, source_id) skips creation if a row already
     exists. POST /policy/notify is therefore safe to retry -- a second
     call with identical (policy_type, policy_version) creates 0 new
     inbox items and reports skipped_already_notified counts.

  2. Acceptance dedup: caregivers who have ALREADY accepted this
     (policy_type, policy_version) tuple are skipped entirely -- no
     inbox item created. PolicyAcceptanceVertex is the source of truth.

This module is purely additive -- it does not modify the existing
inbox_service or any caregiver code path.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from src.models.policy_review import (
    DEFAULT_DEADLINE_DAYS,
    ActionRequired,
    NotificationType,
    PolicyType,
)
from src.services import inbox_service, policy_acceptance_repo
from src.utils.arcade_client import command_sql

logger = logging.getLogger(__name__)


# ──────────────────────────────────────────────────────────────────
#  Helpers
# ──────────────────────────────────────────────────────────────────

def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _iso_in(days: int) -> str:
    return (datetime.now(timezone.utc) + timedelta(days=days)).isoformat().replace("+00:00", "Z")


def _human_date(iso: str) -> str:
    """ISO -> human like '2026-05-02'. Cheap; no locale magic."""
    if not iso:
        return ""
    try:
        return iso[:10]
    except Exception:
        return iso


# ──────────────────────────────────────────────────────────────────
#  Caregiver listing
# ──────────────────────────────────────────────────────────────────

# Map the existing CaregiverVertex.relationship values onto the spec's
# role taxonomy. Anything we don't recognise falls back to "other"
# which gets the conservative 14-day deadline.
_RELATIONSHIP_TO_ROLE = {
    "professional_chw": "chn",
    "chn":              "chn",
    "vhw":              "vhw",
    "scout":            "scout",
    "alkalo":           "alkalo",
    "family":           "family",
    "spouse":           "family",
    "parent":           "family",
    "child":            "family",
    "sibling":          "family",
    "other":            "other",
}


def _normalise_role(relationship: Optional[str]) -> str:
    if not relationship:
        return "other"
    return _RELATIONSHIP_TO_ROLE.get(str(relationship).strip().lower(), "other")


def list_active_caregivers(
    target_roles: Optional[List[str]] = None,
) -> List[Dict[str, Any]]:
    """Return every caregiver in CaregiverVertex, normalised to include
    a `role` field derived from `relationship`. CaregiverVertex doesn't
    have an explicit `status` column today, so 'active' = present.
    Filtering by target_roles is optional."""
    try:
        resp = command_sql("SELECT FROM CaregiverVertex LIMIT 5000")
    except Exception as e:
        logger.warning("list_active_caregivers query failed: %s", e)
        return []

    rows = resp.get("result", []) if resp else []
    out: List[Dict[str, Any]] = []
    target_set = set(r.lower() for r in (target_roles or []))
    for row in rows:
        cg_id = row.get("caregiver_id")
        if not cg_id:
            continue
        role = _normalise_role(row.get("relationship"))
        if target_set and role not in target_set:
            continue
        out.append({
            "caregiver_id":  cg_id,
            "name":          row.get("name") or "",
            "phone":         row.get("phone") or "",
            "relationship":  row.get("relationship") or "",
            "role":          role,
        })
    return out


# ──────────────────────────────────────────────────────────────────
#  Title + body builders (English + Mandinka)
# ──────────────────────────────────────────────────────────────────

def _build_titles_and_body(
    policy_type: str,
    policy_version: str,
    deadline_days: int,
    deadline_iso: str,
    changes_summary: str,
) -> Dict[str, str]:
    deadline_human = _human_date(deadline_iso)

    if policy_type == PolicyType.PATIENT_PRIVACY.value:
        title = "Updated Patient Privacy Policy — Review Required"
        body = (
            f"The AMINA Patient Privacy Policy has been updated to version "
            f"{policy_version}. As a caregiver with access to patient health "
            f"data, you are required to review and accept the updated policy "
            f"within {deadline_days} days.\n\n"
            f"Key changes in this version:\n{changes_summary or '(see full policy)'}\n\n"
            f"Your access to patient data may be restricted if you do not "
            f"review and accept the updated policy by {deadline_human}.\n\n"
            f"Tap 'Review Policy' to read and accept."
        )
        mandinka_title = "Kunnafoni Lakanoo Sariyaa Kura — Jaabiroo Kaŋ"
        mandinka_body = (
            f"AMINA kunnafoni lakanoo sariyaa kurayaata. "
            f"I ka a karaŋ ka a siyaa luŋ {deadline_days} kono. "
            f"Ni i maŋ a siyaa, i la siloo si dartoo."
        )
    elif policy_type == PolicyType.CAREGIVER_AGREEMENT.value:
        title = "Updated Caregiver Data Agreement — Acceptance Required"
        body = (
            f"The Caregiver Data Responsibility Agreement has been updated "
            f"to version {policy_version}. You must review and accept the "
            f"new agreement to maintain your access to patient health data.\n\n"
            f"This agreement defines your legal responsibilities for protecting "
            f"patient information under The Gambia's Personal Data Protection "
            f"and Privacy Act (2025).\n\n"
            f"Your access may be restricted if not accepted within "
            f"{deadline_days} days (by {deadline_human}).\n\n"
            f"Tap 'Review Agreement' to read and accept."
        )
        mandinka_title = "Diilaakao Kunnafoni Kaaŋaandoo Kura"
        mandinka_body = (
            f"Diilaakao kaaŋaandoo kurayaata. "
            f"I ka a karaŋ ka a siyaa luŋ {deadline_days} kono."
        )
    else:
        # Defensive: unknown policy_type. Should not happen because the
        # API enforces the PolicyType enum, but if a future caller bypasses
        # validation we still produce a sensible inbox item rather than crash.
        title = f"Policy Update Required — version {policy_version}"
        body = (
            f"A platform policy ({policy_type}) has been updated to version "
            f"{policy_version}. Please review and accept within {deadline_days} days."
        )
        mandinka_title = "Lakanoo Sariyaa Kura"
        mandinka_body = "I ka kunnafoni lakanoo sariyaa kuraa karaŋ ka a siyaa."

    return {
        "title":          title,
        "body":           body,
        "mandinka_title": mandinka_title,
        "mandinka_body":  mandinka_body,
    }


# ──────────────────────────────────────────────────────────────────
#  Broadcast
# ──────────────────────────────────────────────────────────────────

def broadcast_policy_update(
    *,
    policy_type: str,
    policy_version: str,
    title: Optional[str] = None,
    body: Optional[str] = None,
    mandinka_title: Optional[str] = None,
    mandinka_body: Optional[str] = None,
    deadline_days: Optional[int] = None,
    changes_summary: str = "",
    deadline_overrides: Optional[Dict[str, int]] = None,
    target_roles: Optional[List[str]] = None,
    triggered_by: str = "system",
) -> Dict[str, Any]:
    """
    Idempotent. Send a policy review notification to all caregivers (or a
    subset filtered by `target_roles`).

    Per caregiver, exactly one of these outcomes:
      - already_accepted    -> skipped, no inbox change
      - already_notified    -> existing inbox item kept, no duplicate
      - notified            -> NEW inbox item created with policy fields stamped

    Returns a structured summary suitable for logging/auditing/admin display.
    """
    if not policy_type:
        raise ValueError("policy_type required")
    if not policy_version:
        raise ValueError("policy_version required")

    source_id = policy_acceptance_repo.make_policy_source_id(policy_type, policy_version)

    if policy_type == PolicyType.PATIENT_PRIVACY.value:
        notif_type_value = NotificationType.PRIVACY_POLICY_REVIEW.value
    elif policy_type == PolicyType.CAREGIVER_AGREEMENT.value:
        notif_type_value = NotificationType.DATA_AGREEMENT_REVIEW.value
    else:
        notif_type_value = "policy_review_other"

    caregivers = list_active_caregivers(target_roles=target_roles)
    overrides = {(k or "").lower(): int(v) for k, v in (deadline_overrides or {}).items() if v}

    notified_fresh = 0
    skipped_already_accepted = 0
    skipped_already_notified = 0
    sample_inbox_ids: List[str] = []
    errors: List[Dict[str, str]] = []

    for cg in caregivers:
        cg_id = cg["caregiver_id"]
        role = cg["role"]

        # Layer 1: skip if already accepted this exact version
        if policy_acceptance_repo.has_accepted(cg_id, policy_type, policy_version):
            skipped_already_accepted += 1
            continue

        # Layer 2: skip if inbox item already exists for this (cg, policy)
        existing = policy_acceptance_repo.find_inbox_item_by_source_id(cg_id, source_id)
        if existing:
            skipped_already_notified += 1
            continue

        # Compute deadline based on role + overrides + uniform default
        cg_deadline = (
            overrides.get(role)
            or deadline_days
            or DEFAULT_DEADLINE_DAYS.get(role, 14)
        )
        deadline_iso = _iso_in(cg_deadline)

        # Admin-provided text wins; fall back to auto-generated defaults.
        if title and body:
            text = {
                "title":          title,
                "body":           body,
                "mandinka_title": mandinka_title or "",
                "mandinka_body":  mandinka_body or "",
            }
        else:
            text = _build_titles_and_body(
                policy_type=policy_type,
                policy_version=policy_version,
                deadline_days=cg_deadline,
                deadline_iso=deadline_iso,
                changes_summary=changes_summary,
            )

        try:
            item = inbox_service.create_item(
                patient_id=cg_id,
                kind="alert",  # existing valid kind
                title=text["title"],
                body=text["body"],
                severity="warning",
                source="system",
                source_id=source_id,  # deterministic dedup key
                action_url=f"#/policy/review",  # frontend resolves message_id
                metadata={
                    "policy_type":      policy_type,
                    "policy_version":   policy_version,
                    "deadline_days":    cg_deadline,
                    "deadline_iso":     deadline_iso,
                    "changes_summary":  changes_summary,
                    "role":             role,
                    "triggered_by":     triggered_by,
                },
                # Keep the inbox row a bit longer than the deadline so a
                # post-deadline review still finds the original notification.
                ttl_days=max(cg_deadline * 3, 30),
            )
        except Exception as e:
            logger.error("policy_notification: create_item failed for %s: %s", cg_id, e)
            errors.append({"caregiver_id": cg_id, "error": str(e)[:200]})
            continue

        inbox_id = item.get("inbox_id") if isinstance(item, dict) else None
        if not inbox_id:
            errors.append({"caregiver_id": cg_id, "error": "create_item returned no inbox_id"})
            continue

        # Stamp the policy-specific fields. If this fails the row still
        # exists in the inbox; the user will see title/body but not the
        # action_required state machine -- log a warning but don't roll back.
        ok = policy_acceptance_repo.update_inbox_policy_metadata(
            inbox_id=inbox_id,
            notification_type=notif_type_value,
            action_required=ActionRequired.REVIEW_AND_ACCEPT.value,
            action_deadline=deadline_iso,
            mandinka_title=text["mandinka_title"],
            mandinka_body=text["mandinka_body"],
        )
        if not ok:
            logger.warning(
                "policy_notification: stamp metadata failed for inbox_id=%s caregiver=%s",
                inbox_id, cg_id,
            )

        notified_fresh += 1
        if len(sample_inbox_ids) < 5:
            sample_inbox_ids.append(inbox_id)

    summary = {
        "policy_type":              policy_type,
        "policy_version":           policy_version,
        "source_id":                source_id,
        "active_caregivers":        len(caregivers),
        "notified_fresh":           notified_fresh,
        "skipped_already_accepted": skipped_already_accepted,
        "skipped_already_notified": skipped_already_notified,
        "errors":                   errors,
        "sample_inbox_ids":         sample_inbox_ids,
        "triggered_by":             triggered_by,
        "broadcast_at":             _now_iso(),
    }
    logger.info(
        "policy_notification: broadcast %s v%s -> "
        "fresh=%d already_accepted=%d already_notified=%d errors=%d",
        policy_type, policy_version,
        notified_fresh, skipped_already_accepted, skipped_already_notified,
        len(errors),
    )
    return summary


# ──────────────────────────────────────────────────────────────────
#  Acceptance binding -- enforces that the caregiver is accepting
#  a policy LINKED TO an inbox item they actually own.
#  (Spec point 3 requirement.)
# ──────────────────────────────────────────────────────────────────

def get_inbox_item_for_acceptance(
    inbox_id: str,
    caregiver_id: str,
) -> Optional[Dict[str, Any]]:
    """Look up the inbox item by id AND verify it's owned by the calling
    caregiver (patient_id = caregiver_id). Returns the row only if both
    conditions hold; None otherwise. Used by /policy/{inbox_id}/accept
    to bind the acceptance to the actual notification."""
    if not (inbox_id and caregiver_id):
        return None
    try:
        resp = command_sql(
            "SELECT FROM InboxItemVertex "
            "WHERE inbox_id = :id AND patient_id = :cg LIMIT 1",
            {"id": inbox_id, "cg": caregiver_id},
        )
    except Exception as e:
        logger.debug("get_inbox_item_for_acceptance failed: %s", e)
        return None
    rows = resp.get("result", []) if resp else []
    return rows[0] if rows else None


def extract_policy_from_inbox_item(
    inbox_item: Dict[str, Any],
) -> Optional[Dict[str, str]]:
    """Pull (policy_type, policy_version) out of an inbox item, with
    defense in depth -- prefer the structured metadata field, fall
    back to parsing the deterministic source_id, fall back to None
    if neither is present (item isn't a policy review)."""
    if not inbox_item:
        return None

    # Preferred: parse metadata JSON
    md_str = inbox_item.get("metadata") or ""
    if md_str:
        try:
            import json
            md = json.loads(md_str)
            pt = md.get("policy_type")
            pv = md.get("policy_version")
            if pt and pv:
                return {"policy_type": str(pt), "policy_version": str(pv)}
        except Exception:
            pass

    # Fallback: parse source_id "policy:{type}:{version}"
    sid = inbox_item.get("source_id") or ""
    if sid.startswith("policy:") and sid.count(":") >= 2:
        parts = sid.split(":", 2)  # ["policy", "<type>", "<version>"]
        if len(parts) == 3 and parts[1] and parts[2]:
            return {"policy_type": parts[1], "policy_version": parts[2]}

    return None


__all__ = [
    "list_active_caregivers",
    "broadcast_policy_update",
    "get_inbox_item_for_acceptance",
    "extract_policy_from_inbox_item",
]
