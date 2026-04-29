"""
Policy Review API Routes
========================

Mounted under /api/v1.

  POST /api/v1/policy/notify           super_admin   broadcast a policy
  POST /api/v1/policy/{inbox_id}/accept caregiver    submit acceptance
  GET  /api/v1/policy/status           caregiver    own pending + accepted + suspension
  GET  /api/v1/policy/compliance       super_admin   aggregate dashboard data

Auth split (per requested defaults B):
  notify, compliance  -> Observatory super_admin JWT
                         (verify via observatory_security.verify_observatory_jwt)
                         (claim required: super_admin == True)
  accept, status      -> Caregiver JWT
                         (verify via src.services.auth.verify_jwt)
                         (claim required: sub == caregiver_id)

Idempotency:
  notify  -> dual layer (already-accepted + already-notified-by-source_id)
             implemented in policy_notification.broadcast_policy_update()
  accept  -> repo's record_acceptance() returns {_status: "already_accepted"}
             on the (caregiver, policy_type, policy_version) triple

Acceptance binding (per requested constraint):
  - caregiver_id is taken from JWT only, never from the request body
  - inbox item is loaded by (inbox_id AND patient_id == caregiver_id)
  - policy_type/version is extracted FROM THE STORED INBOX METADATA,
    never from the request body. A caregiver cannot submit acceptance
    for a policy they were not actually notified about.
"""
from __future__ import annotations

import hashlib
import hmac
import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from src.models.policy_review import (
    ActionRequired,
    FRONTEND_CHECKBOX_WORDING_V1,
    NotificationType,
    PolicyAcceptRequest,
    PolicyAcceptResult,
    PolicyNotifyRequest,
    PolicyNotifyResult,
    PolicyStatusResponse,
    PolicyType,
)
from src.services import policy_acceptance_repo, policy_notification
from src.utils.arcade_client import command_sql

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/policy", tags=["policy-review"])
security = HTTPBearer(auto_error=False)


# ──────────────────────────────────────────────────────────────────
#  Auth dependencies
# ──────────────────────────────────────────────────────────────────

def require_super_admin(
    creds: Optional[HTTPAuthorizationCredentials] = Depends(security),
) -> Dict[str, Any]:
    """Verify the request carries a super_admin observatory JWT.
    Raises 401/403 otherwise. Returns the decoded payload on success."""
    if not creds or not creds.credentials:
        raise HTTPException(401, detail={"code": "no_token", "message": "Bearer token required"})
    try:
        from src.services.observatory_security import verify_observatory_jwt
        payload = verify_observatory_jwt(creds.credentials)
    except Exception as e:
        logger.debug("super_admin verify exception: %s", e)
        raise HTTPException(401, detail={"code": "invalid_token"})
    if not payload:
        raise HTTPException(401, detail={"code": "invalid_token"})
    if not payload.get("super_admin"):
        raise HTTPException(403, detail={
            "code": "forbidden",
            "message": "super_admin claim required for this endpoint",
        })
    return payload


def require_caregiver(
    creds: Optional[HTTPAuthorizationCredentials] = Depends(security),
) -> Dict[str, Any]:
    """Verify a caregiver JWT and return its payload (must include `sub`)."""
    if not creds or not creds.credentials:
        raise HTTPException(401, detail={"code": "no_token", "message": "Bearer token required"})
    try:
        from src.services.auth import verify_jwt
        payload = verify_jwt(creds.credentials) or {}
    except Exception as e:
        logger.debug("caregiver verify exception: %s", e)
        raise HTTPException(401, detail={"code": "invalid_token"})
    if not payload.get("sub"):
        raise HTTPException(401, detail={"code": "invalid_token", "message": "Token missing subject"})
    return payload


# ──────────────────────────────────────────────────────────────────
#  PIN reverification helper
# ──────────────────────────────────────────────────────────────────

def _verify_caregiver_pin(caregiver_id: str, pin: str) -> bool:
    """Match the existing caregiver_repo PIN-hash scheme exactly:
        hmac.new(salt, pin, sha256).hexdigest()
    Returns True iff the stored hash matches the typed PIN.
    """
    if not (caregiver_id and pin):
        return False
    try:
        resp = command_sql(
            "SELECT pin_hash, pin_salt FROM CaregiverVertex "
            "WHERE caregiver_id = :id LIMIT 1",
            {"id": caregiver_id},
        )
    except Exception as e:
        logger.debug("verify_caregiver_pin query failed: %s", e)
        return False
    rows = resp.get("result", []) if resp else []
    if not rows:
        return False
    cg = rows[0]
    stored_hash = cg.get("pin_hash") or ""
    salt = cg.get("pin_salt") or ""
    if not (stored_hash and salt):
        return False
    try:
        computed = hmac.new(
            salt.encode("utf-8"),
            pin.encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()
    except Exception as e:
        logger.debug("verify_caregiver_pin hash failed: %s", e)
        return False
    return hmac.compare_digest(computed, stored_hash)


# ──────────────────────────────────────────────────────────────────
#  Helpers
# ──────────────────────────────────────────────────────────────────

def _client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def _user_agent(request: Request) -> str:
    return (request.headers.get("user-agent") or "")[:200]


def _is_policy_review_item(inbox_item: Dict[str, Any]) -> bool:
    """An inbox item is a policy review iff:
      - notification_type is one of the policy review types
      - AND action_required == 'review_accept'"""
    nt = (inbox_item.get("notification_type") or "").strip()
    ar = (inbox_item.get("action_required") or "").strip()
    is_policy_type = nt in (
        NotificationType.PRIVACY_POLICY_REVIEW.value,
        NotificationType.DATA_AGREEMENT_REVIEW.value,
    )
    return is_policy_type and ar == ActionRequired.REVIEW_AND_ACCEPT.value


# ══════════════════════════════════════════════════════════════════
#  POST /api/v1/policy/notify     (super_admin)
# ══════════════════════════════════════════════════════════════════

@router.post("/notify", response_model=PolicyNotifyResult)
def post_notify(
    body: PolicyNotifyRequest,
    request: Request,
    payload: Dict[str, Any] = Depends(require_super_admin),
):
    """Broadcast a policy update to all (or filtered-by-role) active
    caregivers. Validated by Pydantic against the PolicyType enum and
    field-length limits. Idempotent on (policy_type, policy_version)."""
    result = policy_notification.broadcast_policy_update(
        policy_type=body.policy_type.value,
        policy_version=body.policy_version,
        title=body.title,
        body=body.body,
        mandinka_title=body.mandinka_title,
        mandinka_body=body.mandinka_body,
        deadline_days=body.deadline_days,
        changes_summary=body.changes_summary,
        deadline_overrides=body.deadline_overrides,
        target_roles=body.target_roles,
        triggered_by=str(payload.get("sub") or "super_admin"),
    )

    return PolicyNotifyResult(
        policy_type=result["policy_type"],
        policy_version=result["policy_version"],
        notified_count=result["notified_fresh"],
        skipped_already_accepted=result["skipped_already_accepted"],
        sample_inbox_ids=result.get("sample_inbox_ids", []),
    )


@router.get("/notify/result", response_model=Dict[str, Any])
def get_notify_result_template():
    """Documentation endpoint: returns the full broadcast result schema.
    Useful for admin tooling that needs to know the response shape."""
    return {
        "_doc": "Full structured result of POST /policy/notify",
        "fields": {
            "policy_type":              "string",
            "policy_version":           "string",
            "source_id":                "policy:{type}:{version}",
            "active_caregivers":        "int",
            "notified_fresh":           "int  -- new inbox items created",
            "skipped_already_accepted": "int  -- already accepted this exact version",
            "skipped_already_notified": "int  -- existing inbox item kept (idempotent)",
            "errors":                   "list of {caregiver_id, error}",
            "sample_inbox_ids":         "list of up to 5 fresh inbox_ids",
            "triggered_by":             "JWT sub of caller",
            "broadcast_at":             "ISO 8601 UTC",
        },
    }


# ══════════════════════════════════════════════════════════════════
#  POST /api/v1/policy/{inbox_id}/accept     (caregiver)
# ══════════════════════════════════════════════════════════════════

@router.get("/{inbox_id}/details")
def get_policy_details(
    inbox_id: str,
    payload: Dict[str, Any] = Depends(require_caregiver),
):
    """
    Frontend uses this to render the policy review screen. Per the 6.5
    requirement "prefer fetching by inbox_id over trusting local state",
    this is the canonical source of: title, body, mandinka_*,
    deadline, action state, and policy descriptor.

      - 401 if no caregiver JWT
      - 404 if the inbox_id doesn't exist OR is not owned by this caregiver
      - 200 with a flat object the frontend can bind to directly
    """
    caregiver_id = str(payload["sub"])
    item = policy_notification.get_inbox_item_for_acceptance(inbox_id, caregiver_id)
    if not item:
        raise HTTPException(404, detail={
            "code":    "inbox_item_not_found",
            "message": "Policy notification not available or not assigned to this account.",
        })

    policy = policy_notification.extract_policy_from_inbox_item(item) or {}

    # Has this caregiver already accepted this exact (type, version)?
    already_accepted = False
    if policy.get("policy_type") and policy.get("policy_version"):
        already_accepted = policy_acceptance_repo.has_accepted(
            caregiver_id, policy["policy_type"], policy["policy_version"],
        )

    return {
        "inbox_id":             inbox_id,
        "title":                item.get("title", ""),
        "body":                 item.get("body", ""),
        "mandinka_title":       item.get("mandinka_title") or "",
        "mandinka_body":        item.get("mandinka_body") or "",
        "notification_type":    item.get("notification_type") or "",
        "action_required":      item.get("action_required") or "",
        "action_deadline":      item.get("action_deadline") or "",
        "action_completed_at":  item.get("action_completed_at") or "",
        "created_at":           item.get("created_at") or "",
        "policy_type":          policy.get("policy_type", ""),
        "policy_version":       policy.get("policy_version", ""),
        "is_policy_review":     _is_policy_review_item(item),
        "is_already_accepted":  already_accepted,
        # Frontend uses this to render the gating checkboxes consistently.
        # Stored verbatim in the audit trail when the user submits.
        "required_confirmations": FRONTEND_CHECKBOX_WORDING_V1,
    }


@router.post("/{inbox_id}/accept", response_model=PolicyAcceptResult)
async def post_accept(
    inbox_id: str,
    request: Request,
    payload: Dict[str, Any] = Depends(require_caregiver),
):
    """
    Caregiver submits acceptance.

    Accepts either body shape (Pydantic-validated via from_either):
      canonical -- { "typed_signature": "...", "pin": "..." }
      legacy    -- { "typed_name": "...", "pin": "...", "checkboxes": {...} }

      - caregiver_id is taken from JWT.sub (never from the request body).
      - inbox item must exist AND be owned by this caregiver.
      - inbox item must be a policy review (action_required=review_accept).
      - policy_type + policy_version are extracted from the inbox item
        metadata (or stable source_id) -- never from the request body.
      - typed signature is required (>= 2 chars).
      - if `checkboxes` is supplied, all 4 must be true; if omitted, the
        client gate is trusted and the audit record reflects that.
      - PIN is reverified against the stored hash.
      - acceptance is idempotent on (caregiver_id, policy_type, version).
    """
    caregiver_id = str(payload["sub"])

    # Parse + validate either body shape (typed_signature OR typed_name).
    try:
        raw = await request.json()
    except Exception:
        raise HTTPException(400, detail={"code": "invalid_json"})
    try:
        body = PolicyAcceptRequest.from_either(raw or {})
    except Exception as e:
        # Pydantic validation error -- surface as 422 with details.
        raise HTTPException(422, detail={
            "code":    "validation_error",
            "message": str(e)[:500],
        })

    # 1. Bind to the actual inbox item this caregiver owns
    item = policy_notification.get_inbox_item_for_acceptance(inbox_id, caregiver_id)
    if not item:
        raise HTTPException(404, detail={
            "code":    "inbox_item_not_found",
            "message": "No inbox item with that id is owned by this caregiver.",
        })

    # 2. The item must be a policy review awaiting acceptance
    if not _is_policy_review_item(item):
        raise HTTPException(400, detail={
            "code":              "not_a_policy_review",
            "message":           "This inbox item is not a policy review awaiting acceptance (action_required must be review_accept).",
            "notification_type": item.get("notification_type"),
            "action_required":   item.get("action_required"),
        })

    # 3. Extract the policy descriptor from stored metadata -- not from request
    policy = policy_notification.extract_policy_from_inbox_item(item)
    if not policy:
        raise HTTPException(500, detail={
            "code":    "policy_metadata_missing",
            "message": "Inbox item is a policy review but has no extractable policy_type/version.",
        })
    policy_type = policy["policy_type"]
    policy_version = policy["policy_version"]

    # 4. Checkboxes: explicit (legacy) OR client-gated (canonical).
    if body.checkboxes is not None:
        if not body.checkboxes.all_checked():
            raise HTTPException(400, detail={
                "code":       "checkboxes_required",
                "message":    "All four consent checkboxes are required.",
                "checkboxes": body.checkboxes.model_dump(),
            })
        checkbox_audit = body.checkboxes.model_dump()
    else:
        # Trusted client gate. Record the *exact wording* the user saw so
        # the audit trail is legally meaningful even without explicit booleans.
        checkbox_audit = {
            "client_gated":     True,
            "wording_version":  "v1",
            "wording":          FRONTEND_CHECKBOX_WORDING_V1,
        }

    # 5. PIN reverification (existing caregiver pin_hash/salt scheme)
    if not _verify_caregiver_pin(caregiver_id, body.pin):
        raise HTTPException(401, detail={
            "code":    "pin_invalid",
            "message": "PIN reverification failed.",
        })

    # 6. Record acceptance (idempotent)
    rec = policy_acceptance_repo.record_acceptance(
        caregiver_id=caregiver_id,
        policy_type=policy_type,
        policy_version=policy_version,
        digital_signature=body.typed_signature.strip(),
        checkboxes=checkbox_audit,
        ip_address=_client_ip(request),
        user_agent=_user_agent(request),
        method="app",
        related_inbox_id=inbox_id,
    )

    # 7. Stamp the inbox item's action_completed_at (idempotent)
    policy_acceptance_repo.mark_inbox_item_actioned(inbox_id)

    return PolicyAcceptResult(
        status=rec["_status"],   # "accepted" | "already_accepted"
        acceptance_id=rec["acceptance_id"],
        policy_type=rec["policy_type"],
        policy_version=rec["policy_version"],
        accepted_at=rec["accepted_at"],
        inbox_id=inbox_id,
    )


# ══════════════════════════════════════════════════════════════════
#  GET /api/v1/policy/status     (caregiver)
# ══════════════════════════════════════════════════════════════════

@router.get("/status", response_model=PolicyStatusResponse)
def get_status(payload: Dict[str, Any] = Depends(require_caregiver)):
    """Return the calling caregiver's policy review state."""
    caregiver_id = str(payload["sub"])

    # Pending policy reviews: inbox items where action_required=review_accept
    # and action_completed_at is empty/null.
    pending: List[Dict[str, Any]] = []
    try:
        resp = command_sql(
            "SELECT inbox_id, title, mandinka_title, action_required, "
            "action_deadline, action_completed_at, source_id, created_at, "
            "notification_type, metadata "
            "FROM InboxItemVertex "
            "WHERE patient_id = :cg AND action_required = :ar "
            "AND (action_completed_at IS NULL OR action_completed_at = '') "
            "ORDER BY created_at DESC LIMIT 50",
            {"cg": caregiver_id, "ar": ActionRequired.REVIEW_AND_ACCEPT.value},
        )
        rows = resp.get("result", []) if resp else []
        for row in rows:
            pending.append({
                "inbox_id":          row.get("inbox_id"),
                "title":             row.get("title"),
                "mandinka_title":    row.get("mandinka_title") or "",
                "notification_type": row.get("notification_type"),
                "action_deadline":   row.get("action_deadline") or "",
                "source_id":         row.get("source_id"),
                "created_at":        row.get("created_at"),
            })
    except Exception as e:
        logger.debug("policy/status pending query failed: %s", e)

    # Accepted policies: PolicyAcceptanceVertex rows for this caregiver
    accepted: List[Dict[str, str]] = []
    for r in policy_acceptance_repo.list_acceptances_for_caregiver(caregiver_id):
        accepted.append({
            "policy_type":    r.get("policy_type", ""),
            "policy_version": r.get("policy_version", ""),
            "accepted_at":    r.get("accepted_at", ""),
            "method":         r.get("method", "app"),
        })

    # Suspension status
    is_susp = policy_acceptance_repo.is_suspended(caregiver_id)
    susp_reason = ""
    if is_susp:
        active = policy_acceptance_repo.get_active_suspension(caregiver_id)
        if active:
            susp_reason = active.get("reason", "")

    return PolicyStatusResponse(
        caregiver_id=caregiver_id,
        is_suspended=bool(is_susp),
        suspension_reason=susp_reason,
        pending_reviews=pending,
        accepted_versions=accepted,
    )


# ══════════════════════════════════════════════════════════════════
#  GET /api/v1/policy/compliance     (super_admin)
# ══════════════════════════════════════════════════════════════════

@router.get("/compliance")
def get_compliance(
    policy_type: Optional[str] = None,
    policy_version: Optional[str] = None,
    payload: Dict[str, Any] = Depends(require_super_admin),
):
    """Aggregate compliance dashboard.

    If policy_type + policy_version provided, returns per-policy stats.
    Otherwise returns counts grouped by (policy_type, policy_version)
    discovered from PolicyAcceptanceVertex.

    For the targeted breakdown:
      - active_caregivers : total caregivers in CaregiverVertex
      - accepted          : count from PolicyAcceptanceVertex
      - notified          : count from InboxItemVertex with this source_id
      - actioned          : notified AND action_completed_at != ''
      - pending           : notified AND not actioned AND deadline not passed
      - overdue           : notified AND not actioned AND deadline passed
      - by_role           : same breakdown grouped by caregiver relationship
    """
    # If no specific policy requested, return a list of recent broadcasts
    if not (policy_type and policy_version):
        try:
            resp = command_sql(
                "SELECT policy_type, policy_version, COUNT(*) AS accepted_n "
                "FROM PolicyAcceptanceVertex "
                "GROUP BY policy_type, policy_version"
            )
            rows = resp.get("result", []) if resp else []
        except Exception as e:
            logger.debug("compliance summary failed: %s", e)
            rows = []
        return {
            "scope": "summary",
            "by_policy": rows,
            "_hint": "Pass ?policy_type=...&policy_version=... for the per-policy breakdown",
        }

    # Targeted breakdown
    src_id = policy_acceptance_repo.make_policy_source_id(policy_type, policy_version)

    # Total caregivers
    try:
        all_cgs = policy_notification.list_active_caregivers()
    except Exception:
        all_cgs = []
    active_caregivers = len(all_cgs)
    role_counts: Dict[str, int] = {}
    for cg in all_cgs:
        role_counts[cg["role"]] = role_counts.get(cg["role"], 0) + 1

    # Acceptance count
    accepted_rows = policy_acceptance_repo.list_acceptances_for_policy(
        policy_type, policy_version,
    )
    accepted = len(accepted_rows)
    accepted_by_caregiver = {r.get("caregiver_id") for r in accepted_rows}

    # Notified count + breakdown of pending / actioned / overdue
    notified = 0
    actioned = 0
    pending = 0
    overdue = 0
    try:
        from datetime import datetime, timezone
        now_iso = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        resp = command_sql(
            "SELECT inbox_id, patient_id, action_completed_at, action_deadline "
            "FROM InboxItemVertex WHERE source_id = :sid",
            {"sid": src_id},
        )
        rows = resp.get("result", []) if resp else []
        notified = len(rows)
        for row in rows:
            ac = (row.get("action_completed_at") or "").strip()
            ad = (row.get("action_deadline") or "").strip()
            if ac:
                actioned += 1
            elif ad and ad < now_iso:
                overdue += 1
            else:
                pending += 1
    except Exception as e:
        logger.debug("compliance breakdown failed: %s", e)

    return {
        "scope":                 "policy",
        "policy_type":           policy_type,
        "policy_version":        policy_version,
        "source_id":             src_id,
        "active_caregivers":     active_caregivers,
        "notified":              notified,
        "accepted":              accepted,
        "actioned":              actioned,
        "pending":               pending,
        "overdue":               overdue,
        "active_caregivers_by_role": role_counts,
    }
