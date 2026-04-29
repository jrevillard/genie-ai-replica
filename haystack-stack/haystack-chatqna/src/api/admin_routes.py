"""
Admin API — CRUD for patients, community data, knowledge base stats.
Protected by admin credentials (JWT with admin role).
"""

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from typing import Optional, List
import json
import hashlib
import hmac

from src.config import settings
from src.services.auth import verify_jwt

router = APIRouter(prefix="/admin", tags=["admin"])

# Hardcoded admin credentials (change in production)
ADMIN_USERNAME = "admin"
ADMIN_PASSWORD = "amina2026"
ADMIN_SECRET = "amina-admin-secret"


def _admin_token(username: str) -> str:
    import jwt
    from datetime import datetime, timedelta
    return jwt.encode(
        {"sub": username, "role": "admin", "exp": datetime.utcnow() + timedelta(hours=24)},
        settings.JWT_SECRET, algorithm="HS256",
    )


def _verify_admin(request: Request):
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Admin authentication required")
    token = auth[7:]
    payload = verify_jwt(token)
    if not payload or payload.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return payload


def _sql(query, params=None):
    """Direct ArcadeDB SQL with dict params."""
    import requests
    payload = {"language": "sql", "command": query}
    if params:
        payload["params"] = params
    resp = requests.post(
        f"{settings.ARCADEDB_URL}/api/v1/command/{settings.ARCADEDB_DB}",
        json=payload, auth=(settings.ARCADEDB_USER, settings.ARCADEDB_PASSWORD), timeout=10,
    )
    if resp.status_code != 200:
        raise Exception(f"ArcadeDB: {resp.text[:300]}")
    return resp.json()


def _rows(resp):
    return resp.get("result", [])


# ── Admin Auth ──

class AdminLoginRequest(BaseModel):
    username: str
    password: str


@router.post("/login")
async def admin_login(req: AdminLoginRequest):
    if req.username == ADMIN_USERNAME and req.password == ADMIN_PASSWORD:
        return {"success": True, "token": _admin_token(req.username), "role": "admin"}
    return {"success": False, "error": "Invalid admin credentials"}


# ── Dashboard Stats ──

@router.get("/stats")
async def admin_stats(request: Request):
    _verify_admin(request)
    counts = {}
    for table in ["PatientVertex", "ConsultationRecord", "CommunityData", "chunks", "entities", "MemoryVertex"]:
        try:
            r = _sql(f"SELECT count(*) as cnt FROM {table}")
            counts[table] = _rows(r)[0].get("cnt", 0) if _rows(r) else 0
        except Exception:
            counts[table] = "error"
    return {
        "patients": counts.get("PatientVertex", 0),
        "consultations": counts.get("ConsultationRecord", 0),
        "community_records": counts.get("CommunityData", 0),
        "knowledge_chunks": counts.get("chunks", 0),
        "entities": counts.get("entities", 0),
        "memories": counts.get("MemoryVertex", 0),
    }


# ── Patients CRUD ──

@router.get("/patients")
async def admin_list_patients(request: Request, limit: int = 50, offset: int = 0, search: str = ""):
    _verify_admin(request)
    if search:
        r = _sql(
            "SELECT id, name, phone, email, age, gender, region, conditions, medications, "
            "consultation_count, preferred_language, created_at, updated_at "
            "FROM PatientVertex WHERE name LIKE :q OR phone LIKE :q2 OR id LIKE :q3 "
            "ORDER BY updated_at DESC LIMIT :lim SKIP :off",
            {"q": f"%{search}%", "q2": f"%{search}%", "q3": f"%{search}%", "lim": limit, "off": offset},
        )
    else:
        r = _sql(
            "SELECT id, name, phone, email, age, gender, region, conditions, medications, "
            "consultation_count, preferred_language, created_at, updated_at "
            "FROM PatientVertex ORDER BY updated_at DESC LIMIT :lim SKIP :off",
            {"lim": limit, "off": offset},
        )
    patients = []
    for p in _rows(r):
        for f in ("conditions", "medications"):
            v = p.get(f, "[]")
            if isinstance(v, str):
                try: p[f] = json.loads(v)
                except: p[f] = []
        patients.append(p)
    return {"patients": patients, "count": len(patients)}


class PatientUpdateRequest(BaseModel):
    name: Optional[str] = None
    age: Optional[int] = None
    gender: Optional[str] = None
    region: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    conditions: Optional[List[str]] = None
    preferred_language: Optional[str] = None


@router.put("/patients/{patient_id}")
async def admin_update_patient(patient_id: str, req: PatientUpdateRequest, request: Request):
    _verify_admin(request)
    sets = []
    params = {}
    if req.name is not None: sets.append("name = :name"); params["name"] = req.name
    if req.age is not None: sets.append("age = :age"); params["age"] = req.age
    if req.gender is not None: sets.append("gender = :gender"); params["gender"] = req.gender
    if req.region is not None: sets.append("region = :region"); params["region"] = req.region
    if req.phone is not None: sets.append("phone = :phone"); params["phone"] = req.phone
    if req.email is not None: sets.append("email = :email"); params["email"] = req.email
    if req.conditions is not None: sets.append("conditions = :conds"); params["conds"] = json.dumps(req.conditions)
    if req.preferred_language is not None: sets.append("preferred_language = :lang"); params["lang"] = req.preferred_language
    if not sets:
        return {"updated": False, "error": "No fields to update"}
    from datetime import datetime
    sets.append("updated_at = :upd"); params["upd"] = datetime.now().isoformat()
    params["pid"] = patient_id
    _sql(f"UPDATE PatientVertex SET {', '.join(sets)} WHERE id = :pid", params)
    return {"updated": True, "patient_id": patient_id}


@router.delete("/patients/{patient_id}")
async def admin_delete_patient(patient_id: str, request: Request):
    _verify_admin(request)
    # Delete consultations
    try: _sql("DELETE FROM ConsultationRecord WHERE patient_id = :pid", {"pid": patient_id})
    except: pass
    # Delete memories
    try: _sql("DELETE FROM MemoryVertex WHERE patient_id = :pid", {"pid": patient_id})
    except: pass
    # Delete patient
    r = _sql("DELETE FROM PatientVertex WHERE id = :pid", {"pid": patient_id})
    count = _rows(r)[0].get("count", 0) if _rows(r) else 0
    return {"deleted": count > 0, "patient_id": patient_id}


# ── Community Data CRUD ──

@router.get("/community")
async def admin_list_community(request: Request):
    _verify_admin(request)
    r = _sql("SELECT * FROM CommunityData ORDER BY @rid DESC LIMIT 100")
    records = []
    for row in _rows(r):
        for f in ("data",):
            v = row.get(f, "{}")
            if isinstance(v, str):
                try: row[f] = json.loads(v)
                except: pass
        records.append(row)
    return {"records": records, "count": len(records)}


@router.delete("/community/{rid}")
async def admin_delete_community(rid: str, request: Request):
    _verify_admin(request)
    _sql(f"DELETE FROM CommunityData WHERE @rid = :rid", {"rid": f"#{rid}"})
    return {"deleted": True}


# ── Consultations ──

@router.get("/consultations")
async def admin_list_consultations(request: Request, patient_id: str = "", limit: int = 50):
    _verify_admin(request)
    if patient_id:
        r = _sql(
            "SELECT * FROM ConsultationRecord WHERE patient_id = :pid ORDER BY started_at DESC LIMIT :lim",
            {"pid": patient_id, "lim": limit},
        )
    else:
        r = _sql("SELECT * FROM ConsultationRecord ORDER BY started_at DESC LIMIT :lim", {"lim": limit})
    consultations = []
    for row in _rows(r):
        for f in ("messages", "symptoms_reported", "tools_used", "recommendations"):
            v = row.get(f, "[]")
            if isinstance(v, str):
                try: row[f] = json.loads(v)
                except: pass
        consultations.append(row)
    return {"consultations": consultations, "count": len(consultations)}


@router.delete("/consultations/{consultation_id}")
async def admin_delete_consultation(consultation_id: str, request: Request):
    _verify_admin(request)
    _sql("DELETE FROM ConsultationRecord WHERE id = :cid", {"cid": consultation_id})
    return {"deleted": True}


# ── Knowledge Base Stats ──

@router.get("/knowledge")
async def admin_knowledge_stats(request: Request):
    _verify_admin(request)
    r = _sql("SELECT source, count(*) as chunks FROM chunks GROUP BY source ORDER BY chunks DESC")
    return {"sources": _rows(r)}


# ── Audit Log ──

@router.post("/learning/run-cohort")
async def admin_run_cohort(request: Request):
    """Run population cohort analysis across all patients.
    Generates cohort-level insights and promotes them to knowledge chunks."""
    _verify_admin(request)
    from src.services.learning import compute_cohort_insights
    from src.agent.amina_agent import get_agent
    agent = get_agent()
    count = await compute_cohort_insights(agent.memory_manager.redis, agent.client)
    return {"cohort_insights_created": count}


@router.post("/learning/run-distillation")
async def admin_run_distillation(request: Request):
    """Run knowledge distillation — suggests system-wide prompt improvements
    based on population patterns and outcome data."""
    _verify_admin(request)
    from src.services.learning import distill_system_improvements
    from src.agent.amina_agent import get_agent
    agent = get_agent()
    improvements = await distill_system_improvements(agent.memory_manager.redis, agent.client)
    return {"improvements": improvements}


@router.get("/learning/outcomes")
async def admin_list_outcomes(request: Request, limit: int = 50):
    """List outcome records — shows how patient vitals changed after advice."""
    _verify_admin(request)
    r = _sql("SELECT * FROM OutcomeRecord ORDER BY created_at DESC LIMIT :lim", {"lim": limit})
    return {"outcomes": _rows(r), "count": len(_rows(r))}


@router.get("/learning/cohorts")
async def admin_list_cohorts(request: Request):
    """List population cohort insights."""
    _verify_admin(request)
    r = _sql("SELECT * FROM CohortInsight ORDER BY outcome_rate DESC LIMIT 50")
    return {"cohorts": _rows(r), "count": len(_rows(r))}


@router.get("/learning/improvements")
async def admin_get_improvements(request: Request):
    """Get latest system improvement suggestions from knowledge distillation."""
    _verify_admin(request)
    from src.agent.amina_agent import get_agent
    raw = get_agent().memory_manager.redis.get("system:improvements")
    if raw:
        return json.loads(raw)
    return {"new_rules": [], "underperforming_approaches": [], "cultural_findings": [], "confidence": "none"}


@router.post("/nudges/run")
async def admin_run_nudges(request: Request):
    """Process and send all due health nudges to patients via SMS."""
    _verify_admin(request)
    from src.services.nudge_scheduler import process_all_nudges
    from src.agent.amina_agent import get_agent
    stats = await process_all_nudges(get_agent().memory_manager.redis)
    return stats


@router.get("/nudges/preview")
async def admin_preview_nudges(request: Request, patient_id: str = ""):
    """Preview which nudges are due without sending them."""
    _verify_admin(request)
    from src.services.nudge_scheduler import compute_nudges_for_patient
    from src.agent.amina_agent import get_agent
    redis = get_agent().memory_manager.redis

    if patient_id:
        r = _sql("SELECT * FROM PatientVertex WHERE id = :pid LIMIT 1", {"pid": patient_id})
        patients = _rows(r)
    else:
        r = _sql("SELECT * FROM PatientVertex WHERE phone != '' LIMIT 50")
        patients = _rows(r)

    all_nudges = []
    for p in patients:
        for f in ("conditions", "medications"):
            v = p.get(f, "[]")
            if isinstance(v, str):
                try: p[f] = json.loads(v)
                except: p[f] = []
        nudges = compute_nudges_for_patient(p, redis)
        all_nudges.extend(nudges)

    return {"nudges": all_nudges, "count": len(all_nudges)}


@router.get("/audit")
async def admin_audit_log(request: Request, limit: int = 50):
    _verify_admin(request)
    try:
        r = _sql("SELECT * FROM CommunityAuditLog ORDER BY @rid DESC LIMIT :lim", {"lim": limit})
        return {"logs": _rows(r), "count": len(_rows(r))}
    except Exception:
        return {"logs": [], "count": 0}


# ── Caregiver Transfer Requests ──────────────────────────────────────────────
#
# Flow:
#  1. Patient submits a transfer request (POST /api/v1/patient/transfer-request)
#     — stored in Redis with status "pending"
#  2. Admin lists all requests (GET /admin/transfer-requests)
#  3. Admin approves (POST /admin/transfer-requests/{rid}/approve) choosing new CG
#     — calls CaregiverRepository to unlink old CG + link new CG
#  4. Admin declines (POST /admin/transfer-requests/{rid}/decline) with reason
#
# Redis keys:
#   transfer_request:{rid}              → full request JSON
#   transfer_requests_all               → sorted-set  score=ts  member=rid  (no expiry)
#   transfer_reqs_by_patient:{pid}      → sorted-set  score=ts  member=rid

TRANSFER_TTL = 180 * 24 * 3600  # 6 months


def _get_redis():
    import redis as _redis
    return _redis.Redis(
        host=settings.REDIS_HOST, port=settings.REDIS_PORT, decode_responses=True,
    )


def _load_transfer(redis, rid: str) -> Optional[dict]:
    raw = redis.get(f"transfer_request:{rid}")
    if not raw:
        return None
    return json.loads(raw)


def _save_transfer(redis, req: dict) -> None:
    rid = req["request_id"]
    redis.setex(f"transfer_request:{rid}", TRANSFER_TTL, json.dumps(req))
    ts = __import__("datetime").datetime.fromisoformat(req["submitted_at"].rstrip("Z")).timestamp()
    redis.zadd("transfer_requests_all", {rid: ts})
    redis.zadd(f"transfer_reqs_by_patient:{req['patient_id']}", {rid: ts})


@router.get("/transfer-requests")
async def admin_list_transfers(request: Request, status: str = ""):
    """List all caregiver transfer requests. Optional ?status=pending|approved|declined."""
    _verify_admin(request)
    redis = _get_redis()
    rids = redis.zrevrange("transfer_requests_all", 0, -1)
    reqs = []
    for rid in rids:
        r = _load_transfer(redis, rid)
        if r:
            if not status or r.get("status") == status:
                reqs.append(r)
    pending = sum(1 for r in reqs if r.get("status") == "pending")
    return {"total": len(reqs), "pending": pending, "requests": reqs}


class TransferApproveRequest(BaseModel):
    new_caregiver_id: str
    admin_note: Optional[str] = ""


@router.post("/transfer-requests/{rid}/approve")
async def admin_approve_transfer(rid: str, body: TransferApproveRequest, request: Request):
    """
    Approve a transfer request: unlink patient from old caregiver, link to new one.
    """
    _verify_admin(request)
    from src.repositories.caregiver_repo import CaregiverRepository
    import datetime

    redis  = _get_redis()
    repo   = CaregiverRepository()
    req    = _load_transfer(redis, rid)

    if not req:
        raise HTTPException(404, f"Transfer request {rid} not found or expired")
    if req["status"] != "pending":
        raise HTTPException(409, f"Request is already {req['status']}")

    patient_id     = req["patient_id"]
    old_caregiver  = req.get("current_caregiver_id", "")

    # Verify new caregiver exists and is accepting
    new_cg = repo.get_by_id(body.new_caregiver_id)
    if not new_cg:
        raise HTTPException(404, "New caregiver not found")

    # Unlink from old caregiver (best-effort)
    if old_caregiver:
        try:
            repo.remove_patient(old_caregiver, patient_id)
        except Exception as e:
            pass  # may not have a formal link — continue

    # Link to new caregiver
    try:
        repo.link_to_patient(
            caregiver_id = body.new_caregiver_id,
            patient_id   = patient_id,
            permissions  = ["vitals", "medications", "consultations", "alerts"],
            granted_by   = "admin",
            note         = f"Transfer approved — ref {rid}",
        )
    except Exception as e:
        raise HTTPException(500, f"Failed to link patient to new caregiver: {e}")

    req["status"]             = "approved"
    req["new_caregiver_id"]   = body.new_caregiver_id
    req["new_caregiver_name"] = new_cg.get("name", "")
    req["admin_note"]         = (body.admin_note or "").strip()
    req["resolved_at"]        = datetime.datetime.utcnow().isoformat() + "Z"
    _save_transfer(redis, req)

    return {
        "request_id": rid,
        "status": "approved",
        "patient_id": patient_id,
        "new_caregiver_id": body.new_caregiver_id,
        "new_caregiver_name": new_cg.get("name", ""),
        "message": f"Transfer approved. {patient_id} is now assigned to {new_cg.get('name', '')}.",
    }


class TransferDeclineRequest(BaseModel):
    reason: Optional[str] = ""


@router.post("/transfer-requests/{rid}/decline")
async def admin_decline_transfer(rid: str, body: TransferDeclineRequest, request: Request):
    """Decline a transfer request with an optional reason."""
    _verify_admin(request)
    import datetime

    redis = _get_redis()
    req   = _load_transfer(redis, rid)
    if not req:
        raise HTTPException(404, f"Transfer request {rid} not found")
    if req["status"] != "pending":
        raise HTTPException(409, f"Request is already {req['status']}")

    req["status"]      = "declined"
    req["admin_note"]  = (body.reason or "").strip()
    req["resolved_at"] = datetime.datetime.utcnow().isoformat() + "Z"
    _save_transfer(redis, req)

    return {"request_id": rid, "status": "declined"}


@router.get("/caregivers-directory")
async def admin_list_caregivers(request: Request):
    """Return all caregivers (for admin transfer selector)."""
    _verify_admin(request)
    try:
        r = _sql("SELECT caregiver_id, name, specialization, region, accepting_patients, max_patients FROM CaregiverVertex LIMIT 100")
        return {"caregivers": _rows(r)}
    except Exception as e:
        return {"caregivers": [], "error": str(e)}
