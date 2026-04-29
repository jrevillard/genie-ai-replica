"""
AMINA Agent Platform v1 — JSON-shaped input/output schemas.

Schema convention:
  - properties[name].injected = true  → server fills this from session;
    the LLM never sees the field. The policy gate STRIPS any injected
    fields the LLM tried to supply and replaces them from auth context.

The schemas are intentionally lightweight (no full JSON-Schema validator
needed). The policy gate enforces: type, required, min, max, max_length,
enum.
"""
from __future__ import annotations

# ── Read-only / safe ────────────────────────────────────────────────
GET_PATIENT_PROFILE = {
    "input_schema": {
        "type":     "object",
        "required": ["patient_id"],
        "properties": {
            "patient_id": {"type": "string", "injected": True},
        },
    },
    "output_schema": {
        "type": "object",
        "properties": {
            "name":        {"type": "string"},
            "age":         {"type": "integer"},
            "gender":      {"type": "string"},
            "region":      {"type": "string"},
            "conditions":  {"type": "array", "items": {"type": "string"}},
            "medications": {"type": "array", "items": {"type": "string"}},
        },
    },
}

GET_RECENT_VITALS = {
    "input_schema": {
        "type":     "object",
        "required": ["patient_id"],
        "properties": {
            "patient_id": {"type": "string", "injected": True},
            "days":       {"type": "integer", "min": 1, "max": 365, "default": 30},
            "vital_type": {
                "type": "string",
                "enum": ["bp", "glucose", "weight", "all"],
                "default": "all",
            },
        },
    },
    "output_schema": {
        "type": "object",
        "properties": {
            "summary": {"type": "string"},
            "trend":   {"type": "string"},
            "count":   {"type": "integer"},
        },
    },
}

GET_CARE_PLAN = {
    "input_schema": {
        "type":     "object",
        "required": ["patient_id"],
        "properties": {
            "patient_id": {"type": "string", "injected": True},
        },
    },
    "output_schema": {
        "type": "object",
        "properties": {
            "summary":    {"type": "string"},
            "next_steps": {"type": "array", "items": {"type": "string"}},
        },
    },
}

GET_MEDICATIONS = {
    "input_schema": {
        "type":     "object",
        "required": ["patient_id"],
        "properties": {
            "patient_id": {"type": "string", "injected": True},
        },
    },
    "output_schema": {
        "type": "object",
        "properties": {
            "medications": {"type": "array", "items": {"type": "string"}},
            "summary":     {"type": "string"},
        },
    },
}

GET_FOLLOWUPS = {
    "input_schema": {
        "type":     "object",
        "required": ["patient_id"],
        "properties": {
            "patient_id":    {"type": "string", "injected": True},
            "triage_level": {
                "type": "string",
                "enum": ["self_care", "chw_visit", "facility", "emergency"],
                "default": "chw_visit",
            },
            "condition":    {"type": "string", "max_length": 64, "default": ""},
        },
    },
    "output_schema": {
        "type": "object",
        "properties": {
            "next_action": {"type": "string"},
            "when":        {"type": "string"},
        },
    },
}

# ── Knowledge / protocol retrieval ──────────────────────────────────
RETRIEVE_WHO_PROTOCOL = {
    "input_schema": {
        "type":     "object",
        "required": ["topic"],
        "properties": {
            "topic": {
                "type": "string",
                "enum": [
                    "diabetes", "hypertension", "asthma", "copd",
                    "cvd", "cancer_screening", "lifestyle",
                ],
            },
        },
    },
    "output_schema": {
        "type": "object",
        "properties": {
            "summary":      {"type": "string"},
            "key_targets":  {"type": "array", "items": {"type": "string"}},
        },
    },
}

RETRIEVE_NCD_KNOWLEDGE = {
    "input_schema": {
        "type":     "object",
        "required": ["query"],
        "properties": {
            "query":     {"type": "string", "max_length": 200},
            "language":  {"type": "string", "enum": ["en", "ma"], "default": "en"},
        },
    },
    "output_schema": {
        "type": "object",
        "properties": {
            "snippets": {"type": "array", "items": {"type": "string"}},
            "summary":  {"type": "string"},
        },
    },
}

# ── Clinical-advice support (read-only assessments) ────────────────
CALCULATE_CVD_RISK = {
    "input_schema": {
        "type":     "object",
        "required": ["age", "sex", "systolic_bp", "is_smoker"],
        "properties": {
            "age":               {"type": "integer", "min": 30, "max": 90},
            "sex":               {"type": "string", "enum": ["M", "F"]},
            "systolic_bp":       {"type": "integer", "min": 80, "max": 240},
            "total_cholesterol": {"type": "number", "min": 2.0, "max": 12.0,
                                  "default": 5.0},
            "is_smoker":         {"type": "boolean"},
            "has_diabetes":      {"type": "boolean", "default": False},
        },
    },
    "output_schema": {
        "type": "object",
        "properties": {
            "risk_band":   {"type": "string"},
            "explanation": {"type": "string"},
        },
    },
}

ASSESS_TRIAGE = {
    "input_schema": {
        "type":     "object",
        "required": ["symptoms"],
        "properties": {
            "symptoms":    {"type": "array", "items": {"type": "string"}, "max_length": 20},
            "conditions":  {"type": "array", "items": {"type": "string"},
                            "default": [], "injected": True},
            "medications": {"type": "array", "items": {"type": "string"},
                            "default": [], "injected": True},
        },
    },
    "output_schema": {
        "type": "object",
        "properties": {
            "triage_level": {"type": "string"},
            "rationale":    {"type": "string"},
        },
    },
}

CHECK_EMERGENCY = {
    "input_schema": {
        "type":     "object",
        "required": ["symptoms"],
        "properties": {
            "symptoms": {"type": "array", "items": {"type": "string"}, "max_length": 20},
            "region":   {"type": "string", "max_length": 64, "default": ""},
        },
    },
    "output_schema": {
        "type": "object",
        "properties": {
            "is_emergency":   {"type": "boolean"},
            "recommendation": {"type": "string"},
        },
    },
}

GET_DIET_ADVICE = {
    "input_schema": {
        "type":     "object",
        "required": ["condition"],
        "properties": {
            "condition": {
                "type": "string",
                "enum": ["diabetes", "hypertension", "obesity", "general"],
            },
            "concern":   {"type": "string", "max_length": 200, "default": ""},
        },
    },
    "output_schema": {
        "type": "object",
        "properties": {
            "summary":      {"type": "string"},
            "do_examples":  {"type": "array", "items": {"type": "string"}},
            "avoid":        {"type": "array", "items": {"type": "string"}},
        },
    },
}

CHECK_RAMADAN = {
    "input_schema": {
        "type":     "object",
        "required": ["medications"],
        "properties": {
            "medications": {"type": "array", "items": {"type": "string"},
                            "max_length": 20, "injected": True},
        },
    },
    "output_schema": {
        "type": "object",
        "properties": {
            "summary":      {"type": "string"},
            "advisories":   {"type": "array", "items": {"type": "string"}},
        },
    },
}

CULTURAL_CONTEXT = {
    "input_schema": {
        "type":       "object",
        "required":   [],
        "properties": {},
    },
    "output_schema": {
        "type": "object",
        "properties": {
            "greeting": {"type": "string"},
            "context":  {"type": "string"},
        },
    },
}

SUGGEST_COMMUNITY_SUPPORT = {
    "input_schema": {
        "type":     "object",
        "required": ["barrier_type"],
        "properties": {
            "barrier_type": {
                "type": "string",
                "enum": ["cost", "transport", "language", "religion", "general"],
            },
            "religious_context": {
                "type": "string", "max_length": 64, "default": "",
            },
        },
    },
    "output_schema": {
        "type": "object",
        "properties": {
            "suggestions": {"type": "array", "items": {"type": "string"}},
        },
    },
}

FIND_FACILITY = {
    "input_schema": {
        "type":     "object",
        "required": [],
        "properties": {
            "region": {"type": "string", "max_length": 64, "default": ""},
            "kind":   {"type": "string",
                       "enum": ["hospital", "health_centre", "clinic", "any"],
                       "default": "any"},
        },
    },
    "output_schema": {
        "type": "object",
        "properties": {
            "facilities": {"type": "array", "items": {"type": "string"}},
        },
    },
}

# ── Forbidden in v1 (registered for completeness only) ─────────────
WRITE_VITALS = {  # mapped to existing record_vitals — DENIED in v1
    "input_schema": {
        "type":     "object",
        "required": ["patient_id", "vital_type", "value"],
        "properties": {
            "patient_id": {"type": "string", "injected": True},
            "vital_type": {"type": "string",
                           "enum": ["bp", "glucose", "weight"]},
            "value":      {"type": "string", "max_length": 32},
        },
    },
    "output_schema": {"type": "object"},
}

CREATE_REFERRAL = {  # forbidden — DENIED in v1
    "input_schema": {
        "type":     "object",
        "required": ["patient_id", "facility"],
        "properties": {
            "patient_id": {"type": "string", "injected": True},
            "facility":   {"type": "string", "max_length": 128},
            "reason":     {"type": "string", "max_length": 200},
        },
    },
    "output_schema": {"type": "object"},
}

SEND_SMS = {  # forbidden — DENIED in v1
    "input_schema": {
        "type":     "object",
        "required": ["phone", "text"],
        "properties": {
            "phone": {"type": "string", "max_length": 20, "injected": True},
            "text":  {"type": "string", "max_length": 320},
        },
    },
    "output_schema": {"type": "object"},
}

ADMIN_LOOKUP_PATIENT = {  # admin_only — DENIED in v1 for non-admin
    "input_schema": {
        "type":     "object",
        "required": ["query"],
        "properties": {
            "query": {"type": "string", "max_length": 64},
        },
    },
    "output_schema": {"type": "object"},
}
