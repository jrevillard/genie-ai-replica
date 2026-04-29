"""
AMINA Agent Platform v1 — adapters that bridge our v1 tool names to
existing tool instances in src/agent/orchestrator.py.

If a v1 tool has no real backing implementation yet, the adapter
returns a safe `{ok: false, error_code: "not_implemented"}` shape so
the executor produces a `ToolResult(ok=False, ...)` and the runtime
records it in the trace without crashing.

NEVER mutates patient records, NEVER calls external APIs that have
side effects (SMS, referral, write_vitals). All adapters here are
strictly READ.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, Optional

logger = logging.getLogger("agent_platform.adapters")

# Lazy orchestrator handle
_orchestrator = None


def _get_orchestrator():
    global _orchestrator
    if _orchestrator is None:
        try:
            from src.agent.orchestrator import ToolOrchestrator
            _orchestrator = ToolOrchestrator()
        except Exception as e:  # pragma: no cover
            logger.warning("[adapters] orchestrator unavailable: %s", e)
            _orchestrator = False  # sentinel: tried, failed
    return _orchestrator if _orchestrator is not False else None


async def _call_existing(name: str, **kwargs) -> Dict[str, Any]:
    orch = _get_orchestrator()
    if orch is None:
        return {"success": False, "error": "orchestrator_unavailable"}
    return await orch.execute_tool(name, **kwargs)


def _summarise_dict(label: str, d: Dict[str, Any], keys: list, max_chars: int = 240) -> str:
    parts = [f"{label}:"]
    for k in keys:
        v = d.get(k)
        if v in (None, "", [], {}):
            continue
        if isinstance(v, list):
            v = ", ".join(str(x) for x in v[:6])
        parts.append(f"  {k}: {str(v)[:120]}")
    text = "\n".join(parts)
    return text[:max_chars]


# ── Adapter implementations ────────────────────────────────────────
async def adapter_patient_profile(arguments: Dict[str, Any], request) -> Dict[str, Any]:
    pid = (arguments.get("patient_id") or request.patient_id or "").strip()
    if not pid:
        return {"ok": False, "error_code": "missing_patient_id",
                "safe_summary": "no patient context available"}
    res = await _call_existing("get_patient", patient_id=pid)
    if not res.get("success"):
        return {"ok": False, "error_code": res.get("error", "lookup_failed"),
                "safe_summary": "patient lookup failed"}
    payload = res.get("result") or {}
    summary = _summarise_dict(
        "patient", payload,
        ["age", "gender", "region", "conditions", "medications"],
    )
    return {"ok": True, "data": payload, "safe_summary": summary}


async def adapter_recent_vitals(arguments: Dict[str, Any], request) -> Dict[str, Any]:
    pid = (arguments.get("patient_id") or request.patient_id or "").strip()
    if not pid:
        return {"ok": False, "error_code": "missing_patient_id",
                "safe_summary": "no patient context available"}
    # The existing orchestrator has only a writer (`record_vitals`); we
    # don't have a query tool yet. Return a safe placeholder.
    return {
        "ok": True,
        "data": {"summary": "no recent readings on file", "trend": "unknown", "count": 0},
        "safe_summary": "vitals: no recent readings on file (read-only adapter)",
    }


async def adapter_care_plan(arguments: Dict[str, Any], request) -> Dict[str, Any]:
    pid = (arguments.get("patient_id") or request.patient_id or "").strip()
    if not pid:
        return {"ok": False, "error_code": "missing_patient_id",
                "safe_summary": "no patient context available"}
    res = await _call_existing("generate_care_plan",
                               patient_id=pid,
                               conditions=request.conditions,
                               medications=[],
                               region="")
    if not res.get("success"):
        return {"ok": False, "error_code": res.get("error", "lookup_failed"),
                "safe_summary": "care plan unavailable"}
    payload = res.get("result") or {}
    summary = _summarise_dict("care_plan", payload, ["summary", "next_steps", "goals"])
    return {"ok": True, "data": payload, "safe_summary": summary}


async def adapter_medications(arguments: Dict[str, Any], request) -> Dict[str, Any]:
    pid = (arguments.get("patient_id") or request.patient_id or "").strip()
    if not pid:
        return {"ok": False, "error_code": "missing_patient_id",
                "safe_summary": "no patient context available"}
    # Read patient profile then surface the medications field.
    res = await _call_existing("get_patient", patient_id=pid)
    if not res.get("success"):
        return {"ok": False, "error_code": "lookup_failed",
                "safe_summary": "medication list unavailable"}
    profile = res.get("result") or {}
    meds = profile.get("medications") or []
    return {
        "ok": True,
        "data": {"medications": meds, "summary": f"{len(meds)} active medication(s)"},
        "safe_summary": f"medications on file: {', '.join(meds[:8]) if meds else 'none'}",
    }


async def adapter_followups(arguments: Dict[str, Any], request) -> Dict[str, Any]:
    res = await _call_existing(
        "schedule_followup",
        triage_level=arguments.get("triage_level", "chw_visit"),
        condition=arguments.get("condition", ""),
    )
    if not res.get("success"):
        return {"ok": False, "error_code": "lookup_failed",
                "safe_summary": "no follow-up info"}
    payload = res.get("result") or {}
    summary = _summarise_dict("followups", payload, ["next_action", "when"])
    return {"ok": True, "data": payload, "safe_summary": summary}


async def adapter_who_protocol(arguments: Dict[str, Any], request) -> Dict[str, Any]:
    topic = arguments.get("topic", "").lower()
    name_map = {
        "diabetes":          "manage_diabetes",
        "hypertension":      "manage_hypertension",
        "asthma":            "manage_respiratory",
        "copd":              "manage_respiratory",
        "cancer_screening":  "screen_cancer",
        "lifestyle":         "advise_lifestyle",
        "cvd":               "assess_cvd_risk",
    }
    existing = name_map.get(topic)
    if not existing:
        return {"ok": False, "error_code": "unknown_topic",
                "safe_summary": f"unknown WHO topic: {topic}"}
    res = await _call_existing(existing)
    if not res.get("success"):
        return {"ok": False, "error_code": "lookup_failed",
                "safe_summary": f"WHO {topic} protocol unavailable"}
    payload = res.get("result") or {}
    summary = _summarise_dict(f"WHO_{topic}", payload, ["summary", "key_targets", "recommendation"])
    return {"ok": True, "data": payload, "safe_summary": summary}


async def adapter_ncd_knowledge(arguments: Dict[str, Any], request) -> Dict[str, Any]:
    res = await _call_existing("search_knowledge", query=arguments.get("query", ""))
    if not res.get("success"):
        return {"ok": False, "error_code": "search_failed",
                "safe_summary": "knowledge search returned nothing"}
    payload = res.get("result") or {}
    snippets = payload.get("snippets") or payload.get("results") or []
    if isinstance(snippets, list):
        first = " | ".join(str(x)[:80] for x in snippets[:3])
    else:
        first = str(snippets)[:240]
    return {
        "ok": True,
        "data": payload,
        "safe_summary": f"knowledge: {first[:240]}" if first else "no results",
    }


async def adapter_cvd_risk(arguments: Dict[str, Any], request) -> Dict[str, Any]:
    res = await _call_existing("assess_cvd_risk", **arguments)
    if not res.get("success"):
        return {"ok": False, "error_code": "compute_failed",
                "safe_summary": "CVD risk computation failed"}
    payload = res.get("result") or {}
    summary = _summarise_dict("cvd_risk", payload, ["risk_band", "explanation"])
    return {"ok": True, "data": payload, "safe_summary": summary}


async def adapter_triage(arguments: Dict[str, Any], request) -> Dict[str, Any]:
    res = await _call_existing(
        "assess_triage",
        symptoms=arguments.get("symptoms", []),
        conditions=arguments.get("conditions", request.conditions),
        medications=arguments.get("medications", []),
    )
    if not res.get("success"):
        return {"ok": False, "error_code": "triage_failed",
                "safe_summary": "triage assessment failed"}
    payload = res.get("result") or {}
    summary = _summarise_dict("triage", payload, ["triage_level", "rationale"])
    return {"ok": True, "data": payload, "safe_summary": summary}


async def adapter_emergency(arguments: Dict[str, Any], request) -> Dict[str, Any]:
    res = await _call_existing(
        "check_emergency",
        symptoms=arguments.get("symptoms", []),
        region=arguments.get("region", ""),
    )
    if not res.get("success"):
        return {"ok": False, "error_code": "check_failed",
                "safe_summary": "emergency check failed"}
    payload = res.get("result") or {}
    summary = _summarise_dict("emergency", payload, ["is_emergency", "recommendation"])
    return {"ok": True, "data": payload, "safe_summary": summary}


async def adapter_diet(arguments: Dict[str, Any], request) -> Dict[str, Any]:
    res = await _call_existing(
        "get_diet_advice",
        condition=arguments.get("condition", "general"),
        concern=arguments.get("concern", ""),
    )
    if not res.get("success"):
        return {"ok": False, "error_code": "diet_failed",
                "safe_summary": "diet guidance unavailable"}
    payload = res.get("result") or {}
    summary = _summarise_dict("diet", payload, ["summary", "do_examples", "avoid"])
    return {"ok": True, "data": payload, "safe_summary": summary}


async def adapter_ramadan(arguments: Dict[str, Any], request) -> Dict[str, Any]:
    res = await _call_existing(
        "check_ramadan",
        medications=arguments.get("medications", []),
    )
    if not res.get("success"):
        return {"ok": False, "error_code": "check_failed",
                "safe_summary": "ramadan check unavailable"}
    payload = res.get("result") or {}
    summary = _summarise_dict("ramadan", payload, ["summary", "advisories"])
    return {"ok": True, "data": payload, "safe_summary": summary}


async def adapter_cultural(arguments: Dict[str, Any], request) -> Dict[str, Any]:
    res = await _call_existing("get_cultural_greeting")
    if not res.get("success"):
        return {"ok": True, "data": {}, "safe_summary": "cultural context: default"}
    payload = res.get("result") or {}
    summary = _summarise_dict("cultural", payload, ["greeting", "context"])
    return {"ok": True, "data": payload, "safe_summary": summary}


async def adapter_community(arguments: Dict[str, Any], request) -> Dict[str, Any]:
    res = await _call_existing(
        "suggest_community_support",
        barrier_type=arguments.get("barrier_type", "general"),
        religious_context=arguments.get("religious_context", ""),
    )
    if not res.get("success"):
        return {"ok": False, "error_code": "lookup_failed",
                "safe_summary": "community support lookup failed"}
    payload = res.get("result") or {}
    summary = _summarise_dict("community", payload, ["suggestions"])
    return {"ok": True, "data": payload, "safe_summary": summary}


async def adapter_facility(arguments: Dict[str, Any], request) -> Dict[str, Any]:
    # No existing facility tool — return safe placeholder.
    return {
        "ok": True,
        "data": {"facilities": []},
        "safe_summary": "facility lookup: not implemented yet",
    }


# ── Adapter dispatch table ─────────────────────────────────────────
ADAPTERS = {
    "patient_profile": adapter_patient_profile,
    "recent_vitals":   adapter_recent_vitals,
    "care_plan":       adapter_care_plan,
    "medications":     adapter_medications,
    "followups":       adapter_followups,
    "who_protocol":    adapter_who_protocol,
    "ncd_knowledge":   adapter_ncd_knowledge,
    "cvd_risk":        adapter_cvd_risk,
    "triage":          adapter_triage,
    "emergency":       adapter_emergency,
    "diet":            adapter_diet,
    "ramadan":         adapter_ramadan,
    "cultural":        adapter_cultural,
    "community":       adapter_community,
    "facility":        adapter_facility,
}


def get_adapter(name: Optional[str]):
    if not name:
        return None
    return ADAPTERS.get(name)
