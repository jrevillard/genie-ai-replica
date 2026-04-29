"""
AMINA Agent Platform v1 — tool catalogue.

Registers ToolSpec entries for every tool the LLM is allowed to know
about. ONLY ToolSpec entries whose `risk` is in V1_ALLOWED_RISKS will
actually execute (the policy gate enforces this).

Write / external / admin-only tools are registered here for shadow-mode
comparison and schema completeness, but the policy gate denies them.
"""
from __future__ import annotations

from typing import Dict, List

from src.agent_platform import tool_schemas as S
from src.agent_platform.models import ToolRisk, ToolSpec


# ── Build the catalogue ─────────────────────────────────────────────
_DEFAULT_PATIENT_ROLES = ["patient", "family", "vhw", "chn", "admin"]
_ADVANCED_ALL = ["advanced", "basic", "beginner"]


_SPECS: List[ToolSpec] = [
    # ── Read-only patient context (require auth) ──────────────────
    ToolSpec(
        name="get_patient_profile",
        description="Read the signed-in patient's basic profile (name, age, conditions, medications). "
                    "Use ONLY when the response needs the patient's own details.",
        input_schema=S.GET_PATIENT_PROFILE["input_schema"],
        output_schema=S.GET_PATIENT_PROFILE["output_schema"],
        risk=ToolRisk.READ_ONLY_CLINICAL,
        allowed_modes=_ADVANCED_ALL,
        allowed_roles=_DEFAULT_PATIENT_ROLES,
        requires_auth=True,
        adapter_name="patient_profile",
    ),
    ToolSpec(
        name="get_recent_vitals",
        description="Read the patient's recent BP / blood-sugar / weight readings. Use when the "
                    "user references a vital ('my BP', 'my sugar') or asks for trends.",
        input_schema=S.GET_RECENT_VITALS["input_schema"],
        output_schema=S.GET_RECENT_VITALS["output_schema"],
        risk=ToolRisk.READ_ONLY_CLINICAL,
        allowed_modes=_ADVANCED_ALL,
        allowed_roles=_DEFAULT_PATIENT_ROLES,
        requires_auth=True,
        adapter_name="recent_vitals",
    ),
    ToolSpec(
        name="get_care_plan",
        description="Read the patient's current care plan summary.",
        input_schema=S.GET_CARE_PLAN["input_schema"],
        output_schema=S.GET_CARE_PLAN["output_schema"],
        risk=ToolRisk.READ_ONLY_CLINICAL,
        allowed_modes=_ADVANCED_ALL,
        allowed_roles=_DEFAULT_PATIENT_ROLES,
        requires_auth=True,
        adapter_name="care_plan",
    ),
    ToolSpec(
        name="get_medications",
        description="Read the patient's active medication list.",
        input_schema=S.GET_MEDICATIONS["input_schema"],
        output_schema=S.GET_MEDICATIONS["output_schema"],
        risk=ToolRisk.READ_ONLY_CLINICAL,
        allowed_modes=_ADVANCED_ALL,
        allowed_roles=_DEFAULT_PATIENT_ROLES,
        requires_auth=True,
        adapter_name="medications",
    ),
    ToolSpec(
        name="get_followups",
        description="Read the patient's scheduled follow-up actions and next-visit guidance.",
        input_schema=S.GET_FOLLOWUPS["input_schema"],
        output_schema=S.GET_FOLLOWUPS["output_schema"],
        risk=ToolRisk.READ_ONLY_CLINICAL,
        allowed_modes=_ADVANCED_ALL,
        allowed_roles=_DEFAULT_PATIENT_ROLES,
        requires_auth=True,
        adapter_name="followups",
    ),

    # ── Knowledge / protocol retrieval (no auth required) ─────────
    ToolSpec(
        name="retrieve_who_protocol",
        description="Retrieve the WHO PEN protocol summary for an NCD topic (diabetes, "
                    "hypertension, asthma, copd, cvd, cancer_screening, lifestyle). Use when the "
                    "user asks about clinical thresholds or guideline-level guidance.",
        input_schema=S.RETRIEVE_WHO_PROTOCOL["input_schema"],
        output_schema=S.RETRIEVE_WHO_PROTOCOL["output_schema"],
        risk=ToolRisk.SAFE_READ_ONLY,
        allowed_modes=_ADVANCED_ALL,
        allowed_roles=_DEFAULT_PATIENT_ROLES + ["guest"],
        requires_auth=False,
        adapter_name="who_protocol",
    ),
    ToolSpec(
        name="retrieve_ncd_knowledge",
        description="Retrieve relevant NCD knowledge passages for a free-text query (RAG).",
        input_schema=S.RETRIEVE_NCD_KNOWLEDGE["input_schema"],
        output_schema=S.RETRIEVE_NCD_KNOWLEDGE["output_schema"],
        risk=ToolRisk.SAFE_READ_ONLY,
        allowed_modes=_ADVANCED_ALL,
        allowed_roles=_DEFAULT_PATIENT_ROLES + ["guest"],
        requires_auth=False,
        adapter_name="ncd_knowledge",
    ),

    # ── Clinical-advice support (read-only assessments) ───────────
    ToolSpec(
        name="calculate_cvd_risk",
        description="Compute a WHO/ISH cardiovascular-risk band from age, sex, BP, smoking and diabetes status.",
        input_schema=S.CALCULATE_CVD_RISK["input_schema"],
        output_schema=S.CALCULATE_CVD_RISK["output_schema"],
        risk=ToolRisk.CLINICAL_ADVICE_SUPPORT,
        allowed_modes=_ADVANCED_ALL,
        allowed_roles=_DEFAULT_PATIENT_ROLES,
        requires_auth=True,
        adapter_name="cvd_risk",
    ),
    ToolSpec(
        name="assess_triage",
        description="Read-only triage assessment (SELF_CARE / CHW_VISIT / FACILITY / EMERGENCY).",
        input_schema=S.ASSESS_TRIAGE["input_schema"],
        output_schema=S.ASSESS_TRIAGE["output_schema"],
        risk=ToolRisk.CLINICAL_ADVICE_SUPPORT,
        allowed_modes=_ADVANCED_ALL,
        allowed_roles=_DEFAULT_PATIENT_ROLES + ["guest"],
        requires_auth=False,
        adapter_name="triage",
    ),
    ToolSpec(
        name="check_emergency",
        description="Detect emergency keywords and return is_emergency + recommendation. "
                    "Always allowed (safety net).",
        input_schema=S.CHECK_EMERGENCY["input_schema"],
        output_schema=S.CHECK_EMERGENCY["output_schema"],
        risk=ToolRisk.CLINICAL_ADVICE_SUPPORT,
        allowed_modes=_ADVANCED_ALL,
        allowed_roles=_DEFAULT_PATIENT_ROLES + ["guest"],
        requires_auth=False,
        emergency_allowed=True,
        adapter_name="emergency",
    ),
    ToolSpec(
        name="get_diet_advice",
        description="Retrieve diet guidance for a condition (diabetes / hypertension / obesity / general).",
        input_schema=S.GET_DIET_ADVICE["input_schema"],
        output_schema=S.GET_DIET_ADVICE["output_schema"],
        risk=ToolRisk.CLINICAL_ADVICE_SUPPORT,
        allowed_modes=_ADVANCED_ALL,
        allowed_roles=_DEFAULT_PATIENT_ROLES + ["guest"],
        requires_auth=False,
        adapter_name="diet",
    ),
    ToolSpec(
        name="check_ramadan",
        description="Check whether the patient's medications need Ramadan-specific guidance.",
        input_schema=S.CHECK_RAMADAN["input_schema"],
        output_schema=S.CHECK_RAMADAN["output_schema"],
        risk=ToolRisk.CLINICAL_ADVICE_SUPPORT,
        allowed_modes=_ADVANCED_ALL,
        allowed_roles=_DEFAULT_PATIENT_ROLES,
        requires_auth=True,
        adapter_name="ramadan",
    ),
    ToolSpec(
        name="cultural_context",
        description="Return culturally-appropriate greeting and context block.",
        input_schema=S.CULTURAL_CONTEXT["input_schema"],
        output_schema=S.CULTURAL_CONTEXT["output_schema"],
        risk=ToolRisk.SAFE_READ_ONLY,
        allowed_modes=_ADVANCED_ALL,
        allowed_roles=_DEFAULT_PATIENT_ROLES + ["guest"],
        requires_auth=False,
        adapter_name="cultural",
    ),
    ToolSpec(
        name="suggest_community_support",
        description="Suggest local community / religious / financial support for a barrier_type.",
        input_schema=S.SUGGEST_COMMUNITY_SUPPORT["input_schema"],
        output_schema=S.SUGGEST_COMMUNITY_SUPPORT["output_schema"],
        risk=ToolRisk.SAFE_READ_ONLY,
        allowed_modes=_ADVANCED_ALL,
        allowed_roles=_DEFAULT_PATIENT_ROLES + ["guest"],
        requires_auth=False,
        adapter_name="community",
    ),
    ToolSpec(
        name="find_facility",
        description="Find nearby health facilities for a region/kind.",
        input_schema=S.FIND_FACILITY["input_schema"],
        output_schema=S.FIND_FACILITY["output_schema"],
        risk=ToolRisk.SAFE_READ_ONLY,
        allowed_modes=_ADVANCED_ALL,
        allowed_roles=_DEFAULT_PATIENT_ROLES + ["guest"],
        requires_auth=False,
        adapter_name="facility",
    ),

    # ── Forbidden in v1 (registered for completeness only) ───────
    ToolSpec(
        name="record_vitals",
        description="(WRITE) Record a new vital reading. NOT EXECUTABLE in v1.",
        input_schema=S.WRITE_VITALS["input_schema"],
        output_schema=S.WRITE_VITALS["output_schema"],
        risk=ToolRisk.WRITE_PATIENT_RECORD,
        allowed_modes=_ADVANCED_ALL,
        allowed_roles=_DEFAULT_PATIENT_ROLES,
        requires_auth=True,
        side_effecting=True,
        adapter_name=None,
    ),
    ToolSpec(
        name="create_referral",
        description="(WRITE) Create a clinical referral. NOT EXECUTABLE in v1.",
        input_schema=S.CREATE_REFERRAL["input_schema"],
        output_schema=S.CREATE_REFERRAL["output_schema"],
        risk=ToolRisk.EXTERNAL_SIDE_EFFECT,
        allowed_modes=_ADVANCED_ALL,
        allowed_roles=["chn", "admin"],
        requires_auth=True,
        side_effecting=True,
        adapter_name=None,
    ),
    ToolSpec(
        name="send_sms",
        description="(SIDE-EFFECT) Send an SMS. NOT EXECUTABLE in v1.",
        input_schema=S.SEND_SMS["input_schema"],
        output_schema=S.SEND_SMS["output_schema"],
        risk=ToolRisk.EXTERNAL_SIDE_EFFECT,
        allowed_modes=_ADVANCED_ALL,
        allowed_roles=["admin"],
        requires_auth=True,
        side_effecting=True,
        adapter_name=None,
    ),
    ToolSpec(
        name="admin_lookup_patient",
        description="(ADMIN) Look up any patient by query. NOT EXECUTABLE for non-admin.",
        input_schema=S.ADMIN_LOOKUP_PATIENT["input_schema"],
        output_schema=S.ADMIN_LOOKUP_PATIENT["output_schema"],
        risk=ToolRisk.ADMIN_ONLY,
        allowed_modes=_ADVANCED_ALL,
        allowed_roles=["admin"],
        requires_auth=True,
        adapter_name=None,
    ),
]


# ── Registry API ────────────────────────────────────────────────────
class ToolRegistry:
    def __init__(self, specs: List[ToolSpec]):
        self._by_name: Dict[str, ToolSpec] = {s.name: s for s in specs}

    def get(self, name: str) -> ToolSpec:
        return self._by_name[name]

    def get_all(self) -> Dict[str, ToolSpec]:
        return dict(self._by_name)

    def has(self, name: str) -> bool:
        return name in self._by_name

    def get_by_risk(self, risk: ToolRisk) -> List[ToolSpec]:
        return [s for s in self._by_name.values() if s.risk == risk]

    def get_for_mode(self, mode: str) -> List[ToolSpec]:
        m = (mode or "").lower()
        return [s for s in self._by_name.values() if m in [a.lower() for a in s.allowed_modes]]

    def get_for_role(self, role: str) -> List[ToolSpec]:
        r = (role or "").lower()
        return [s for s in self._by_name.values() if r in [a.lower() for a in s.allowed_roles]]

    def get_read_only(self) -> List[ToolSpec]:
        from src.agent_platform.models import V1_ALLOWED_RISKS
        return [s for s in self._by_name.values() if s.risk in V1_ALLOWED_RISKS]

    def get_schemas_for_llm(self, mode: str, role: str) -> List[dict]:
        """
        Return LLM-facing schemas. NEVER includes injected fields. Only
        includes tools the role+mode is allowed to invoke AND whose risk
        is in V1_ALLOWED_RISKS (so we never invite the LLM to propose a
        write/admin call we'll have to deny).
        """
        from src.agent_platform.models import V1_ALLOWED_RISKS
        m = (mode or "").lower()
        r = (role or "").lower()
        out: List[dict] = []
        for spec in self._by_name.values():
            if spec.risk not in V1_ALLOWED_RISKS:
                continue
            if spec.allowed_modes and m not in [x.lower() for x in spec.allowed_modes]:
                continue
            if spec.allowed_roles and r not in [x.lower() for x in spec.allowed_roles]:
                continue
            out.append(spec.to_llm_schema())
        return out


# Singleton registry
_REGISTRY = ToolRegistry(_SPECS)


def get_registry() -> ToolRegistry:
    return _REGISTRY
