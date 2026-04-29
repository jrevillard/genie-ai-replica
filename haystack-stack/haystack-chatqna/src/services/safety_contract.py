"""
Safety Contract — Gap 5 Bridge.

Replaces the LLM safety-review call (_safety_review) with deterministic
validation.  Instead of generating freely then reviewing with a second
LLM call (300ms, fail-open), we define response constraints as schemas
and validate deterministically.

    Medication mentions → must reference patient's known prescriptions
                          or include "your doctor/healthcare provider"
    Emergency keywords  → response MUST include emergency protocol
    Clinical numbers    → must be within valid ranges
    Harm patterns       → blacklisted phrases that could cause harm

Fail-CLOSED: if validation fails, the response is flagged with specific
violations and a regeneration hint is returned. The caller regenerates
with explicit constraints — no silent pass-through.

Gate: settings.USE_SAFETY_CONTRACT (default false).
When false, the existing _safety_review LLM call is used unchanged.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Set

from src.config import settings

logger = logging.getLogger(__name__)

_ENABLED = settings.USE_SAFETY_CONTRACT


# ── Known medication database (generic names, lowercase) ───────────────
# Medications that AMINA patients commonly encounter. If the response
# mentions one of these without the patient having it prescribed,
# it's flagged as unsolicited prescribing.

_MEDICATION_NAMES: Set[str] = {
    # Diabetes
    "metformin", "glibenclamide", "gliclazide", "insulin", "glimepiride",
    "sitagliptin", "empagliflozin", "dapagliflozin",
    # Hypertension
    "amlodipine", "lisinopril", "enalapril", "losartan", "hydrochlorothiazide",
    "nifedipine", "atenolol", "methyldopa", "captopril",
    # Respiratory
    "salbutamol", "beclomethasone", "budesonide", "prednisolone", "theophylline",
    # Pain / general
    "paracetamol", "ibuprofen", "aspirin", "diclofenac", "tramadol",
    "amoxicillin", "ciprofloxacin", "doxycycline", "metronidazole",
    # Mental health
    "amitriptyline", "fluoxetine", "diazepam", "chlorpromazine",
    # Anti-malarials
    "artemether", "lumefantrine", "quinine",
}

# Dosage pattern: number + unit (mg, ml, g, mcg, iu, units)
_DOSAGE_PATTERN = re.compile(
    r"\b(\d+(?:\.\d+)?)\s*(mg|ml|g|mcg|iu|units?|tablet|capsule|pill)s?\b",
    re.IGNORECASE,
)

# Emergency keywords in user message that REQUIRE emergency protocol in response
_EMERGENCY_KEYWORDS = [
    "chest pain", "can't breathe", "cannot breathe", "difficulty breathing",
    "collapsed", "unconscious", "seizure", "convulsion", "overdose",
    "heart attack", "stroke", "bleeding heavily", "heavy bleeding",
    "not breathing", "dying", "suicide", "want to die", "kill myself",
    "poisoning", "poison",
]

# Emergency protocol phrases that MUST appear in response if emergency detected
_EMERGENCY_PROTOCOL_PHRASES = [
    "199", "efsth", "hospital", "emergency", "ambulance", "clinic",
]

# Clinical number ranges (for validation)
_CLINICAL_RANGES = {
    "bp_systolic": (60, 250),
    "bp_diastolic": (30, 150),
    "glucose_mgdl": (20, 600),
    "glucose_mmol": (1.0, 33.3),
    "temperature_c": (35.0, 42.0),
    "heart_rate": (30, 220),
    "bmi": (10, 60),
}

# Harm patterns — phrases that should never appear in a healthcare response
_HARM_PATTERNS = [
    r"stop\s+taking\s+your\s+(?:medication|medicine|pills?|drugs?)",
    r"you\s+don'?t\s+need\s+(?:a\s+)?doctor",
    r"don'?t\s+(?:go|visit)\s+(?:the\s+)?(?:hospital|clinic|doctor)",
    r"drink\s+alcohol\s+(?:to|for|with)",
    r"traditional\s+medicine\s+(?:is\s+)?better\s+than",
    r"you\s+(?:are|'re)\s+(?:going\s+to\s+)?die",
    r"nothing\s+(?:can|we\s+can)\s+(?:be\s+)?done",
    r"you\s+should\s+(?:just\s+)?accept",
]

# Safe prescribing phrases (these make a med mention OK)
_SAFE_MED_CONTEXTS = [
    "your doctor prescribed",
    "your prescribed",
    "as prescribed",
    "your healthcare provider",
    "your nurse",
    "your clinician",
    "you mentioned taking",
    "you said you take",
    "continue taking your",
    "take your prescribed",
    "the medicine your doctor gave",
]


# ── Violation types ────────────────────────────────────────────────────

@dataclass
class SafetyViolation:
    category: str        # "medication", "emergency", "clinical_number", "harm"
    severity: str        # "critical", "warning"
    detail: str          # Human-readable description
    evidence: str        # The offending text snippet
    fix_hint: str        # Instruction for regeneration


@dataclass
class SafetyResult:
    safe: bool
    violations: List[SafetyViolation] = field(default_factory=list)
    regeneration_prompt: str = ""


# ── Validators ─────────────────────────────────────────────────────────

def _check_medication_safety(
    response: str,
    patient_medications: List[str],
) -> List[SafetyViolation]:
    """Check if response recommends medications without safe context."""
    violations = []
    resp_lower = response.lower()

    # Find all medication mentions in response
    mentioned_meds = []
    for med in _MEDICATION_NAMES:
        if med in resp_lower:
            mentioned_meds.append(med)

    if not mentioned_meds:
        return violations

    # Check if mentions are in safe context
    has_safe_context = any(ctx in resp_lower for ctx in _SAFE_MED_CONTEXTS)

    # Check if mentioned meds are in patient's known medications
    patient_meds_lower = [m.lower() if isinstance(m, str) else m.get("name", "").lower()
                          for m in patient_medications] if patient_medications else []

    for med in mentioned_meds:
        in_patient_meds = any(med in pm for pm in patient_meds_lower)

        if not in_patient_meds and not has_safe_context:
            violations.append(SafetyViolation(
                category="medication",
                severity="critical",
                detail=f"Response mentions '{med}' without safe prescribing context",
                evidence=med,
                fix_hint=(
                    f"Do NOT recommend '{med}' specifically. Instead say "
                    f"'speak to your doctor about medication options' or "
                    f"reference the patient's existing prescriptions."
                ),
            ))

    # Check for dosage recommendations (almost always unsafe)
    dosage_matches = _DOSAGE_PATTERN.findall(resp_lower)
    if dosage_matches and not has_safe_context:
        for amount, unit in dosage_matches:
            violations.append(SafetyViolation(
                category="medication",
                severity="critical",
                detail=f"Response includes specific dosage: {amount}{unit}",
                evidence=f"{amount}{unit}",
                fix_hint="Never recommend specific dosages. Say 'take as your doctor prescribed'.",
            ))

    return violations


def _check_emergency_protocol(
    user_message: str,
    response: str,
) -> List[SafetyViolation]:
    """If user message contains emergency keywords, response MUST include
    emergency protocol."""
    violations = []
    msg_lower = user_message.lower()
    resp_lower = response.lower()

    has_emergency = any(kw in msg_lower for kw in _EMERGENCY_KEYWORDS)
    if not has_emergency:
        return violations

    has_protocol = any(phrase in resp_lower for phrase in _EMERGENCY_PROTOCOL_PHRASES)
    if not has_protocol:
        violations.append(SafetyViolation(
            category="emergency",
            severity="critical",
            detail="Patient described emergency symptoms but response lacks emergency protocol",
            evidence=next((kw for kw in _EMERGENCY_KEYWORDS if kw in msg_lower), ""),
            fix_hint=(
                "EMERGENCY: Tell the patient to call 199 immediately or go to EFSTH. "
                "Include what to do while waiting for help."
            ),
        ))

    return violations


def _check_clinical_numbers(response: str) -> List[SafetyViolation]:
    """Check if clinical numbers in the response are within valid ranges."""
    violations = []
    resp_lower = response.lower()

    # BP patterns: "systolic/diastolic" or "should be below X/Y"
    bp_matches = re.findall(r"(\d{2,3})\s*/\s*(\d{2,3})", response)
    for sys_str, dia_str in bp_matches:
        sys_val = int(sys_str)
        dia_val = int(dia_str)
        if not (_CLINICAL_RANGES["bp_systolic"][0] <= sys_val <= _CLINICAL_RANGES["bp_systolic"][1]):
            violations.append(SafetyViolation(
                category="clinical_number",
                severity="warning",
                detail=f"BP systolic {sys_val} outside valid range",
                evidence=f"{sys_str}/{dia_str}",
                fix_hint="Normal BP target is below 140/90 mmHg.",
            ))
        if not (_CLINICAL_RANGES["bp_diastolic"][0] <= dia_val <= _CLINICAL_RANGES["bp_diastolic"][1]):
            violations.append(SafetyViolation(
                category="clinical_number",
                severity="warning",
                detail=f"BP diastolic {dia_val} outside valid range",
                evidence=f"{sys_str}/{dia_str}",
                fix_hint="Normal BP target is below 140/90 mmHg.",
            ))

    # Glucose patterns: "glucose of X" or "sugar X mg/dl"
    glucose_mg = re.findall(r"(\d{2,3})\s*(?:mg/?dl|mg)", resp_lower)
    for g_str in glucose_mg:
        g_val = int(g_str)
        if not (_CLINICAL_RANGES["glucose_mgdl"][0] <= g_val <= _CLINICAL_RANGES["glucose_mgdl"][1]):
            violations.append(SafetyViolation(
                category="clinical_number",
                severity="warning",
                detail=f"Glucose {g_val} mg/dL outside valid range",
                evidence=f"{g_str} mg/dL",
                fix_hint="Fasting glucose target is 70-130 mg/dL.",
            ))

    return violations


def _check_harm_patterns(response: str) -> List[SafetyViolation]:
    """Check for phrases that could cause patient harm."""
    violations = []
    resp_lower = response.lower()

    for pattern in _HARM_PATTERNS:
        match = re.search(pattern, resp_lower)
        if match:
            violations.append(SafetyViolation(
                category="harm",
                severity="critical",
                detail=f"Response contains potentially harmful phrase",
                evidence=match.group(0),
                fix_hint=(
                    "Remove harmful language. Always encourage patients to follow "
                    "medical advice, visit their healthcare provider, and continue "
                    "prescribed treatments."
                ),
            ))

    return violations


# ── Regeneration prompt builder ────────────────────────────────────────

def _build_regeneration_prompt(violations: List[SafetyViolation]) -> str:
    """Build a prompt addendum that tells the model exactly what to fix."""
    if not violations:
        return ""

    parts = ["SAFETY CONSTRAINTS (you MUST follow these):"]

    for v in violations:
        parts.append(f"- {v.fix_hint}")

    # Deduplicate
    seen = set()
    unique_parts = [parts[0]]
    for p in parts[1:]:
        if p not in seen:
            seen.add(p)
            unique_parts.append(p)

    return "\n".join(unique_parts)


# ── Public API ─────────────────────────────────────────────────────────

def validate_response(
    response: str,
    user_message: str,
    patient_medications: Optional[List[Any]] = None,
) -> SafetyResult:
    """Validate a response against safety contracts.

    Returns SafetyResult with:
      - safe=True if no critical violations
      - safe=False with violations and regeneration prompt if unsafe

    When flag is off, always returns safe=True (no-op).
    """
    if not _ENABLED:
        return SafetyResult(safe=True)

    if not response or len(response) < 10:
        return SafetyResult(safe=True)

    meds = patient_medications or []
    violations = []

    violations.extend(_check_medication_safety(response, meds))
    violations.extend(_check_emergency_protocol(user_message, response))
    violations.extend(_check_clinical_numbers(response))
    violations.extend(_check_harm_patterns(response))

    critical = [v for v in violations if v.severity == "critical"]

    if critical:
        regen_prompt = _build_regeneration_prompt(critical)
        logger.warning(
            f"safety_contract: BLOCKED — {len(critical)} critical violations: "
            f"{[v.category for v in critical]}"
        )
        return SafetyResult(
            safe=False,
            violations=violations,
            regeneration_prompt=regen_prompt,
        )

    if violations:
        logger.info(f"safety_contract: {len(violations)} warnings (non-blocking)")

    return SafetyResult(safe=True, violations=violations)


def get_preemptive_constraints(
    user_message: str,
    patient_context: Any = None,
    intent_extraction: Optional[Dict[str, Any]] = None,
) -> str:
    """Generate pre-generation safety constraints based on user message.

    These constraints are injected INTO the prompt BEFORE generation,
    preventing violations rather than catching them after.

    Returns empty string when flag is off or no constraints needed.
    """
    if not _ENABLED:
        return ""

    msg_lower = user_message.lower()
    constraints = []

    # Emergency keywords → force emergency protocol
    has_emergency = any(kw in msg_lower for kw in _EMERGENCY_KEYWORDS)
    if has_emergency:
        constraints.append(
            "SAFETY: Patient described emergency symptoms. You MUST tell them "
            "to call 199 or go to EFSTH immediately. Include what to do while waiting."
        )

    # Intent extraction says critical urgency
    if intent_extraction and intent_extraction.get("urgency") == "critical":
        if not has_emergency:
            constraints.append(
                "SAFETY: This message has critical urgency. Direct the patient "
                "to seek immediate medical attention."
            )

    # Medication question → prescribing guard
    med_question_cues = [
        "what medicine", "what drug", "what pill", "what should i take",
        "can i take", "should i take", "give me medicine", "prescribe",
    ]
    if any(cue in msg_lower for cue in med_question_cues):
        constraints.append(
            "SAFETY: Do NOT recommend specific medications or dosages. "
            "Instead, advise the patient to consult their doctor or healthcare provider."
        )

    # Patient asking about stopping meds
    stop_cues = ["stop taking", "quit taking", "stop my", "don't want to take"]
    if any(cue in msg_lower for cue in stop_cues):
        constraints.append(
            "SAFETY: Patient is considering stopping medication. NEVER encourage "
            "stopping prescribed medication. Advise them to discuss with their doctor first."
        )

    if not constraints:
        return ""

    return "\n".join(constraints)
