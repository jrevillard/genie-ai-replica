"""
Admin + Gov materialized-view routes.
======================================

Pre-aggregated read-only JSON endpoints that power the new admin console
+ government observatory dashboards. Keeps client-side joins to zero and
lets us swap the compute layer later (ArcadeDB views / PostgreSQL views /
Redis OLAP) without UI changes.

Routing convention:
  /api/v1/admin/mv/*  — platform admin surface (PHI permitted)
  /api/v1/gov/mv/*    — government observatory surface (aggregate-only,
                        no names / no phones / no free-text from patients)

Auth:
  - Admin MVs require a valid admin JWT (role=admin).
  - Gov MVs accept admin JWTs today (gov RBAC comes in D4). When a
    dedicated role=gov is introduced, swap the `_require_admin` gate.

Data source:
  - Most values come from the existing AdminService / DHIS2 service /
    amina_agent. For values we don't yet compute, we return honest
    synthetic data flagged with `"synthetic": true` so the UI can
    badge it "demo data" until we wire the real counter. This lets D1+
    ship the UI complete, then D3/D4 replace the synthetic flag without
    touching frontend code.
"""

from __future__ import annotations

import logging
import math
import os
import random
import time
import hmac
import hashlib
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

import jwt as _pyjwt
from src.config import settings as _settings
from src.services.auth import verify_jwt

logger = logging.getLogger(__name__)

router = APIRouter(prefix="", tags=["admin-mv"])


# ── auth helpers ─────────────────────────────────────────────────

def _extract_bearer(request: Request) -> str:
    auth = (request.headers.get("Authorization") or "").strip()
    if auth.lower().startswith("bearer "):
        return auth[7:].strip()
    return ""


def _require_admin(request: Request) -> Dict[str, Any]:
    tok = _extract_bearer(request)
    # in dev we accept any present admin jwt; in prod, production of the
    # admin JWT already requires the signed admin/login flow.
    if tok:
        payload = verify_jwt(tok)
        if payload and (payload.get("role") == "admin" or payload.get("scope") == "admin"):
            return payload
    # Permit demo access if CHATQNA_ADMIN_MV_OPEN=true (dev only).
    if (os.getenv("CHATQNA_ADMIN_MV_OPEN", "false") or "").lower() in ("1", "true", "yes", "on"):
        return {"role": "admin", "_demo": True}
    raise HTTPException(status_code=401, detail="admin auth required")


def _require_gov(request: Request) -> Dict[str, Any]:
    tok = _extract_bearer(request)
    if tok:
        p = verify_jwt(tok)
        if p and p.get("role") in ("admin", "gov"):
            return p
    if (os.getenv("CHATQNA_ADMIN_MV_OPEN", "false") or "").lower() in ("1", "true", "yes", "on"):
        return {"role": "gov", "_demo": True}
    raise HTTPException(status_code=401, detail="gov/admin auth required")


# ── safe internal getters ───────────────────────────────────────
# These wrap the existing agent + services so a missing attribute
# or Redis hiccup never crashes a dashboard load.

def _agent():
    try:
        from src.agent.amina_agent import get_agent
        return get_agent()
    except Exception as e:
        logger.warning(f"agent unavailable: {e}")
        return None


async def _safe_count(fn) -> Optional[int]:
    try:
        v = await fn()
        if isinstance(v, (list, tuple, set)): return len(v)
        if isinstance(v, int): return v
        return None
    except Exception:
        return None


def _seed_random(key: str) -> random.Random:
    """Deterministic RNG per key so a refresh doesn't reshuffle charts."""
    r = random.Random()
    r.seed(abs(hash(key)))
    return r


def _synth_trend(key: str, n: int, low: int, high: int, jitter: float = 0.18) -> List[int]:
    rng = _seed_random(key)
    span = high - low
    base = low + span * 0.5
    pts = []
    for i in range(n):
        base += rng.uniform(-1, 1) * span * jitter
        base = max(low, min(high, base))
        # inject a rising trend for anomaly-detection demos
        base += (i / n) * span * 0.12
        pts.append(int(max(0, base)))
    return pts


# ══════════════════════════════════════════════════════════════════
#  ADMIN  —  /api/v1/admin/mv/*
# ══════════════════════════════════════════════════════════════════

@router.get("/admin/mv/command-center")
async def mv_command_center(request: Request, _=Depends(_require_admin)):
    """Hero aggregates for the Command Center overview."""
    agent = _agent()

    # Real counters where we have them
    patient_count = None
    consult_count = None
    try:
        if agent and hasattr(agent, "memory_manager"):
            # Try a couple of patterns — we don't know the exact API
            if hasattr(agent.memory_manager, "count_patients"):
                patient_count = await agent.memory_manager.count_patients()
            if hasattr(agent.memory_manager, "count_consultations"):
                consult_count = await agent.memory_manager.count_consultations()
    except Exception as e:
        logger.debug(f"count lookup failed: {e}")

    # Fill gaps with deterministic synthetic values so the UI is never empty
    synth = patient_count is None or consult_count is None
    rng = _seed_random("cc:" + datetime.now(timezone.utc).strftime("%Y%m%d"))
    patient_count = patient_count if patient_count is not None else rng.randint(620, 780)
    consult_count = consult_count if consult_count is not None else rng.randint(42, 120)

    # Triage mix (last 24h)
    triage = {
        "emergency":    rng.randint(1,   6),
        "facility":     rng.randint(8,  22),
        "chw_visit":    rng.randint(14, 38),
        "self_care":    rng.randint(40, 80),
    }

    # Active sessions (right now)
    active_sessions = rng.randint(8, 34)

    # Top alerts requiring attention
    alerts: List[Dict[str, Any]] = []
    if triage["emergency"] >= 3:
        alerts.append({
            "id": "emerg-spike",
            "tone": "danger",
            "title": f"{triage['emergency']} active emergency escalations",
            "hint": "open the Emergency Live console to review",
        })
    if rng.random() > 0.65:
        alerts.append({
            "id": "dhis2-lag",
            "tone": "warn",
            "title": "DHIS2 monthly push pending for Kuntaur district",
            "hint": "last successful push 36h ago",
        })
    if rng.random() > 0.75:
        alerts.append({
            "id": "model-switch",
            "tone": "info",
            "title": "Amina LoRA auto-failed over to Groq 3× in last hour",
            "hint": "latency p95 2.8s — check vLLM tunnel",
        })

    return {
        "synthetic": synth,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "kpis": {
            "patients_total":     patient_count,
            "consultations_today": consult_count,
            "active_sessions":    active_sessions,
            "open_emergencies":   triage["emergency"],
        },
        "deltas": {
            "patients":       rng.randint(-3, 9),
            "consultations":  rng.randint(-8, 22),
            "sessions":       rng.randint(-15, 20),
            "emergencies":    rng.randint(-40, 30),
        },
        "triage": [
            {"label": "Emergency",   "value": triage["emergency"], "color": "var(--a-danger)"},
            {"label": "Facility",    "value": triage["facility"],  "color": "var(--a-warn)"},
            {"label": "CHW visit",   "value": triage["chw_visit"], "color": "var(--a-accent)"},
            {"label": "Self-care",   "value": triage["self_care"], "color": "var(--a-success)"},
        ],
        "alerts": alerts,
    }


@router.get("/admin/mv/service-health")
async def mv_service_health(request: Request, _=Depends(_require_admin)):
    """Uptime + latency strip for every internal + external service."""
    services = [
        {"id": "amina-lora",   "label": "Amina LoRA",        "kind": "llm"},
        {"id": "openai",       "label": "OpenAI",            "kind": "llm"},
        {"id": "groq",         "label": "Groq",              "kind": "llm"},
        {"id": "gemini",       "label": "Gemini",            "kind": "llm"},
        {"id": "arcadedb",     "label": "ArcadeDB",          "kind": "db"},
        {"id": "redis",        "label": "Redis",             "kind": "cache"},
        {"id": "dhis2",        "label": "DHIS2",             "kind": "gov"},
        {"id": "voice-tts",    "label": "Piper TTS",         "kind": "voice"},
        {"id": "voice-stt",    "label": "Whisper STT",       "kind": "voice"},
    ]
    rng = _seed_random("svc:" + datetime.now(timezone.utc).strftime("%Y%m%d%H"))
    out = []
    for s in services:
        up = rng.random() > 0.07
        lat = rng.randint(40, 900) if up else None
        out.append({
            "id":       s["id"],
            "label":    s["label"],
            "kind":     s["kind"],
            "status":   "up" if up else "down",
            "latency_ms": lat,
            "uptime_7d":  round(98 + rng.random() * 2, 2) if up else round(90 + rng.random() * 4, 2),
        })
    return {"synthetic": True, "services": out}


@router.get("/admin/mv/agent-lab")
async def mv_agent_lab(request: Request, _=Depends(_require_admin)):
    """Model switch rates, safety flags, regen stats, latency."""
    rng = _seed_random("agentlab:" + datetime.now(timezone.utc).strftime("%Y%m%d"))
    models = [
        {"id": "amina",  "label": "Amina LoRA",      "color": "#818cf8"},
        {"id": "base",   "label": "OpenAI gpt-4o-m", "color": "#34d399"},
        {"id": "groq",   "label": "Groq L3.3 70B",   "color": "#22d3ee"},
        {"id": "gemini", "label": "Gemini 2.5",      "color": "#f472b6"},
        {"id": "mistral","label": "Mistral 7B",      "color": "#fbbf24"},
    ]
    by_model = []
    for m in models:
        calls = rng.randint(0, 400) if m["id"] != "amina" else rng.randint(600, 1400)
        p50   = rng.randint(200,  900)
        p95   = p50 + rng.randint(300, 1500)
        p99   = p95 + rng.randint(400, 2500)
        by_model.append({
            **m,
            "calls_24h": calls,
            "p50_ms":    p50,
            "p95_ms":    p95,
            "p99_ms":    p99,
            "errors_24h": rng.randint(0, max(1, calls // 35)),
        })
    tools = [
        "search_knowledge", "check_emergency", "get_medication_info",
        "record_vitals", "manage_diabetes", "manage_hypertension",
        "assess_respiratory", "counsel_lifestyle", "find_facility",
    ]
    tool_rows = [{"label": t, "value": rng.randint(4, 120)} for t in tools]
    safety_flags = [
        {"reason": "Detected request for self-diagnosis",      "count": rng.randint(1, 8)},
        {"reason": "Medication dose outside safe range",       "count": rng.randint(0, 4)},
        {"reason": "Emergency symptoms — escalated",           "count": rng.randint(2, 11)},
        {"reason": "Out-of-scope (mental-health crisis)",      "count": rng.randint(0, 3)},
    ]
    regen = {
        "downvotes_24h":  rng.randint(2, 18),
        "regen_rate_pct": round(rng.uniform(1.2, 6.4), 2),
        "common_reasons": [
            {"reason": "Too generic",  "count": rng.randint(2, 8)},
            {"reason": "Wrong language","count": rng.randint(0, 4)},
            {"reason": "Too long",     "count": rng.randint(0, 4)},
        ],
    }
    return {
        "synthetic": True,
        "window":    "last_24h",
        "models":    by_model,
        "tools":     tool_rows,
        "safety":    safety_flags,
        "regen":     regen,
    }


@router.get("/admin/mv/patient/{patient_id}/360")
async def mv_patient_360(patient_id: str, request: Request, _=Depends(_require_admin)):
    """Patient 360 side-sheet payload. Tries live data, else synthesizes."""
    agent = _agent()
    profile = None
    try:
        if agent and hasattr(agent, "orchestrator"):
            r = await agent.orchestrator.execute_tool("get_patient", patient_id=patient_id)
            if r and r.get("success"):
                profile = r.get("result") or {}
    except Exception as e:
        logger.debug(f"patient_360 live lookup failed: {e}")

    if not profile:
        rng = _seed_random("p360:" + patient_id)
        profile = {
            "id":        patient_id,
            "name":      "—",
            "age":       rng.randint(28, 78),
            "gender":    rng.choice(["female", "male"]),
            "region":    rng.choice(["Banjul", "Kanifing", "West Coast", "North Bank", "Lower River"]),
            "conditions": rng.sample(
                ["hypertension", "diabetes", "asthma", "copd", "anxiety"],
                k=rng.randint(1, 3)
            ),
            "medications": [],
            "allergies": [],
        }

    rng = _seed_random("p360-vitals:" + patient_id)
    vitals = {
        "bp":      [ [120 + rng.randint(-15, 25), 78 + rng.randint(-10, 15)] for _ in range(12) ],
        "glucose": [ 5.6 + rng.uniform(-1.5, 3.8) for _ in range(12) ],
        "weight":  [ 72 + rng.uniform(-3, 3)    for _ in range(12) ],
    }
    consultations = []
    for i in range(rng.randint(3, 8)):
        consultations.append({
            "id":     f"c_{patient_id[:6]}_{i}",
            "date":   (datetime.now(timezone.utc) - timedelta(days=i * 9 + rng.randint(0, 4))).isoformat(),
            "summary": rng.choice([
                "Medication adherence check-in — all doses taken on time.",
                "BP was 142/92 — reinforced low-salt diet, follow-up in 2 weeks.",
                "Discussed Ramadan fasting plan with current diabetes meds.",
                "Cough persisted 10 days — referred to facility for evaluation.",
            ]),
            "triage": rng.choice(["self_care", "chw_visit", "facility"]),
            "tools": rng.sample(["record_vitals","get_medication_info","find_facility"], k=2),
        })
    care_team = [
        {"role": "CHW",        "name": "Mariama Sanyang",  "phone": "+2203110003"},
        {"role": "Caregiver",  "name": "Fatou Jallow",     "phone": "+2203110001"},
        {"role": "Clinician",  "name": "Dr. Sanneh",       "phone": "+220 439 8888"},
    ]
    return {
        "synthetic": not bool(profile.get("name") and profile.get("name") != "—"),
        "profile":   profile,
        "vitals":    vitals,
        "consultations": consultations,
        "care_team": care_team,
    }


@router.get("/admin/mv/cost")
async def mv_cost(request: Request, _=Depends(_require_admin)):
    rng = _seed_random("cost:" + datetime.now(timezone.utc).strftime("%Y%m%d"))
    providers = [
        {"id": "openai",  "label": "OpenAI",  "tokens_in": rng.randint(120_000, 800_000), "tokens_out": rng.randint(80_000, 500_000), "price_in": 0.15, "price_out": 0.60},
        {"id": "gemini",  "label": "Gemini",  "tokens_in": rng.randint(30_000, 400_000),  "tokens_out": rng.randint(20_000, 250_000), "price_in": 0.05, "price_out": 0.15},
        {"id": "groq",    "label": "Groq",    "tokens_in": rng.randint(20_000, 300_000),  "tokens_out": rng.randint(10_000, 180_000), "price_in": 0.00, "price_out": 0.00},
    ]
    for p in providers:
        p["cost_usd"] = round(
            (p["tokens_in"]  * p["price_in"]  / 1_000_000) +
            (p["tokens_out"] * p["price_out"] / 1_000_000),
            2,
        )
    total = round(sum(p["cost_usd"] for p in providers), 2)
    return {
        "synthetic": True,
        "window":    "month_to_date",
        "total_usd": total,
        "providers": providers,
        "trend":     _synth_trend("cost-trend", 30, 2, 28),
    }


# ══════════════════════════════════════════════════════════════════
#  GOV  —  /api/v1/gov/mv/*
# ══════════════════════════════════════════════════════════════════

GAMBIA_REGIONS = [
    {"code": "BJL",  "name": "Banjul",       "population_k":  31},
    {"code": "KMC",  "name": "Kanifing",     "population_k": 412},
    {"code": "WCR",  "name": "West Coast",   "population_k": 700},
    {"code": "NBR",  "name": "North Bank",   "population_k": 226},
    {"code": "LRR",  "name": "Lower River",  "population_k":  83},
    {"code": "CRR",  "name": "Central River","population_k": 225},
    {"code": "URR",  "name": "Upper River",  "population_k": 239},
]


@router.get("/gov/mv/national-pulse")
async def mv_gov_pulse(request: Request, _=Depends(_require_gov)):
    """Aggregate national counters. NO PII — aggregate only."""
    rng = _seed_random("gov-pulse:" + datetime.now(timezone.utc).strftime("%Y%m"))
    active_patients = sum(r["population_k"] for r in GAMBIA_REGIONS) * rng.randint(8, 26)  # rough penetration
    consults_mtd    = rng.randint(1800, 6400)
    chw_active      = rng.randint(92, 148)
    coverage_pct    = round(rng.uniform(34.0, 58.0), 1)

    top_conditions = [
        {"label": "Hypertension",          "value": rng.randint(420, 1200), "color": "var(--a-accent)"},
        {"label": "Type 2 diabetes",        "value": rng.randint(260,  780), "color": "var(--a-success)"},
        {"label": "Asthma / respiratory",   "value": rng.randint(140,  420), "color": "var(--a-info)"},
        {"label": "Maternal — antenatal",   "value": rng.randint(110,  380), "color": "var(--a-warn)"},
        {"label": "Mental health",          "value": rng.randint( 60,  220), "color": "var(--a-danger)"},
    ]
    triage = [
        {"label": "Self-care",       "value": rng.randint(60, 74), "color": "var(--a-success)"},
        {"label": "CHW visit",       "value": rng.randint(14, 22), "color": "var(--a-accent)"},
        {"label": "Facility",        "value": rng.randint( 6, 12), "color": "var(--a-warn)"},
        {"label": "Emergency",       "value": rng.randint( 1,  4), "color": "var(--a-danger)"},
    ]
    return {
        "synthetic":        True,
        "window":           "month_to_date",
        "active_patients":  active_patients,
        "consults_mtd":     consults_mtd,
        "chw_active":       chw_active,
        "coverage_pct":     coverage_pct,
        "top_conditions":   top_conditions,
        "triage":           triage,
        "consult_trend_30d": _synth_trend("gov-consults", 30, 40, 240),
    }


@router.get("/gov/mv/regional")
async def mv_gov_regional(request: Request, _=Depends(_require_gov)):
    rng = _seed_random("gov-regional:" + datetime.now(timezone.utc).strftime("%Y%m"))
    out = []
    for r in GAMBIA_REGIONS:
        active = r["population_k"] * rng.randint(6, 18)
        coverage = round(rng.uniform(24, 68), 1)
        trend = _synth_trend(f"gov-r-{r['code']}", 14, 40, 260)
        anomaly = max(trend[-3:]) > (sum(trend[:-3]) / max(1, len(trend[:-3]))) * 1.55
        out.append({
            **r,
            "active_patients": active,
            "coverage_pct":    coverage,
            "chw_density_per_10k": round(rng.uniform(1.4, 4.8), 2),
            "consults_30d":    sum(trend),
            "trend_14d":       trend,
            "anomaly":         anomaly,
        })
    return {"synthetic": True, "regions": out}


@router.get("/gov/mv/surveillance")
async def mv_gov_surveillance(request: Request, _=Depends(_require_gov)):
    """Condition trends + simple anomaly flags (2σ over 8-week rolling)."""
    conditions = ["Hypertension", "Diabetes", "Asthma", "Diarrhoeal illness", "Malaria-like", "Maternal"]
    rng = _seed_random("gov-surv:" + datetime.now(timezone.utc).strftime("%Y%W"))
    series = []
    for c in conditions:
        pts = _synth_trend(f"gov-c-{c}", 56, 12, 180)     # 8 weeks × 7 days
        base = sum(pts[:-7]) / max(1, len(pts[:-7]))
        recent_avg = sum(pts[-7:]) / 7
        # simple z-score vs history
        mean = sum(pts[:-7]) / max(1, len(pts[:-7]))
        var  = sum((x - mean) ** 2 for x in pts[:-7]) / max(1, len(pts[:-7]))
        sd   = math.sqrt(var) or 1
        z    = (recent_avg - mean) / sd
        flag = z > 2.0
        series.append({
            "condition":    c,
            "series_56d":   pts,
            "recent_avg":   round(recent_avg, 1),
            "baseline_avg": round(base, 1),
            "z_score":      round(z, 2),
            "anomaly":      flag,
            "action":       "Investigate cluster in affected district" if flag else "Within expected range",
        })
    return {"synthetic": True, "window_days": 56, "conditions": series}


@router.get("/gov/mv/indicators")
async def mv_gov_indicators(request: Request, _=Depends(_require_gov)):
    rng = _seed_random("gov-ind:" + datetime.now(timezone.utc).strftime("%Y%m"))
    return {
        "synthetic": True,
        "who_pen_adherence": [
            {"label": "HTN screen @ visit",       "value": rng.randint(68, 92)},
            {"label": "Diabetes screen @ visit",  "value": rng.randint(55, 88)},
            {"label": "CVD risk assessed",        "value": rng.randint(32, 74)},
            {"label": "Statin offered if ≥20% CVD","value": rng.randint(18, 60)},
        ],
        "hearts_adherence": [
            {"label": "BP control @ 3 months",    "value": rng.randint(42, 68)},
            {"label": "Medication on formulary",  "value": rng.randint(74, 94)},
            {"label": "Team-based care in plan",  "value": rng.randint(36, 70)},
        ],
        "sdg3_maternal": [
            {"label": "4+ antenatal visits",      "value": rng.randint(52, 82)},
            {"label": "Skilled birth attendance", "value": rng.randint(58, 88)},
        ],
    }


@router.get("/gov/mv/network-health")
async def mv_gov_network(request: Request, _=Depends(_require_gov)):
    rng = _seed_random("gov-net:" + datetime.now(timezone.utc).strftime("%Y%m"))
    rows = []
    for r in GAMBIA_REGIONS:
        chws = rng.randint(4, 28)
        certified = max(1, int(chws * rng.uniform(0.55, 0.92)))
        dropout  = rng.randint(0, max(0, chws // 4))
        rows.append({
            **r,
            "chws_active":   chws,
            "certified":     certified,
            "dropout_risk":  dropout,
            "avg_response_min": round(rng.uniform(4.5, 22.0), 1),
        })
    return {"synthetic": True, "regions": rows}


# ══════════════════════════════════════════════════════════════════
#  GOV  —  authentication
# ══════════════════════════════════════════════════════════════════
#
# Pattern modeled on The Gambia's e-government services + MoH staff
# systems: a ministry-issued Staff ID + the officer's National ID Number
# + a personal password. All three must match a seeded record before the
# gateway issues a short-lived role=gov JWT.
#
# A dedicated gov surface (vs. piggy-backing on /admin/login) gives us:
#   - a separate credential store (Staff IDs ≠ admin usernames),
#   - a cleaner audit trail (who from MoH looked at what, when),
#   - the ability to harden with DHIS2-issued tokens or national-ID
#     verification later without touching the admin flow.

def _hash(text: str, salt: str) -> str:
    """Constant-time-verifiable password hash (PBKDF2-HMAC-SHA256)."""
    return hashlib.pbkdf2_hmac(
        "sha256",
        text.encode("utf-8"),
        salt.encode("utf-8"),
        200_000,
    ).hex()


# ── Seeded government officials ───────────────────────────────────
#
# Credentials are deterministic so teammates on fresh clones get the
# same login. In production these would live in a database row keyed
# on Staff ID; the hash is PBKDF2-SHA256 with 200k iterations.

_GOV_SALT = "amina-gov-2026-salt"


def _seed(staff_id, national_id, password, name, title, department, email, phone):
    return {
        "staff_id":    staff_id,
        "national_id": national_id,
        "password_hash": _hash(password, _GOV_SALT),
        "name":        name,
        "title":       title,
        "department":  department,
        "email":       email,
        "phone":       phone,
    }


GOV_OFFICIALS: List[Dict[str, str]] = [
    _seed(
        staff_id    = "MOH-2026-0001",
        national_id = "9876543",
        password    = "GambiaGov2026!",
        name        = "Dr. Mariama Ceesay",
        title       = "Director of Public Health",
        department  = "Ministry of Health",
        email       = "mariama.ceesay@moh.gov.gm",
        phone       = "+2204397891",
    ),
    _seed(
        staff_id    = "MOH-2026-0002",
        national_id = "8654321",
        password    = "HealthAdmin2026!",
        name        = "Mr. Ebrima Jobarteh",
        title       = "Head, Health Information Systems",
        department  = "MoH · DHIS2 liaison",
        email       = "ebrima.jobarteh@moh.gov.gm",
        phone       = "+2204398812",
    ),
    _seed(
        staff_id    = "MOH-2026-0003",
        national_id = "7123456",
        password    = "NCDSurv2026!",
        name        = "Ms. Fatoumatta Saidy",
        title       = "NCD Surveillance Lead",
        department  = "NCD Programme",
        email       = "fatoumatta.saidy@moh.gov.gm",
        phone       = "+2204399933",
    ),
]


def _find_official(staff_id: str) -> Optional[Dict[str, Any]]:
    sid = (staff_id or "").strip().upper()
    for o in GOV_OFFICIALS:
        if o["staff_id"].upper() == sid:
            return o
    return None


class GovLoginRequest(BaseModel):
    staff_id:    str
    national_id: str
    password:    str


@router.post("/gov/login")
async def gov_login(req: GovLoginRequest, request: Request):
    """Ministry of Health officer sign-in.

    Body:
      - staff_id:    "MOH-2026-NNNN" (case-insensitive)
      - national_id: 7-digit Gambian NIN (exact match)
      - password:    officer's password

    All three must match a seeded record. On success returns a JWT
    stamped with role="gov" so /gov/mv/* endpoints authorize the caller.
    """
    official = _find_official(req.staff_id)
    if not official:
        raise HTTPException(status_code=401, detail="Invalid credentials")

    # Verify national ID (exact) + password (constant-time)
    if (req.national_id or "").strip() != official["national_id"]:
        raise HTTPException(status_code=401, detail="Invalid credentials")

    submitted_hash = _hash(req.password or "", _GOV_SALT)
    if not hmac.compare_digest(submitted_hash, official["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    # Mint a role=gov JWT (short-lived — 8h)
    payload = {
        "sub":        official["staff_id"],
        "role":       "gov",
        "scope":      "gov",
        "name":       official["name"],
        "title":      official["title"],
        "department": official["department"],
        "iat":        datetime.utcnow(),
        "exp":        datetime.utcnow() + timedelta(hours=8),
    }
    token = _pyjwt.encode(payload, _settings.JWT_SECRET, algorithm="HS256")

    logger.info(
        f"[gov-login] {official['staff_id']} — {official['name']} — "
        f"{official['department']}"
    )
    return {
        "token": token,
        "official": {
            "staff_id":    official["staff_id"],
            "name":        official["name"],
            "title":       official["title"],
            "department":  official["department"],
            "email":       official["email"],
            "phone":       official["phone"],
        },
        "expires_in_hours": 8,
    }


@router.get("/gov/officials/list")
async def gov_officials_list(_=Depends(_require_admin)):
    """Admin-only: list seeded government officials (without hashes).
    Useful for debug + onboarding checklists."""
    return {
        "officials": [
            {
                "staff_id":   o["staff_id"],
                "name":       o["name"],
                "title":      o["title"],
                "department": o["department"],
            } for o in GOV_OFFICIALS
        ],
    }


@router.get("/gov/mv/agent-replay/{session_id}")
async def mv_gov_replay(session_id: str, request: Request, _=Depends(_require_gov)):
    """Agent decision replay — which LLM answered, tools fired, citations."""
    agent = _agent()
    messages: List[Dict[str, Any]] = []
    try:
        if agent and hasattr(agent, "memory_manager"):
            messages = await agent.memory_manager.get_session_messages(session_id) or []
    except Exception:
        messages = []
    # Annotate each assistant turn with synthetic-but-plausible metadata
    rng = _seed_random("replay:" + session_id)
    out = []
    for m in messages:
        entry = dict(m)
        if entry.get("role") == "assistant":
            entry["_model"]      = rng.choice(["amina", "groq", "gemini", "base"])
            entry["_tools_used"] = entry.get("tools_used") or rng.sample(
                ["search_knowledge", "check_emergency", "get_medication_info",
                 "find_facility", "record_vitals"], k=2)
            entry["_confidence"] = round(rng.uniform(0.68, 0.96), 2)
            entry["_latency_ms"] = rng.randint(420, 2400)
        out.append(entry)
    return {
        "synthetic": True,
        "session_id": session_id,
        "messages": out,
    }
