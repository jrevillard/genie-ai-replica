"""
Care Gap Detector — AMINA Caregiver Intelligence
==================================================

Identifies missed or overdue preventive care intervals for NCD patients
based on condition-specific guidelines.

Zero LLM calls — all rule-based date arithmetic.

Guidelines used:
  ADA 2024       — Diabetes Standards of Care
  JNC8 / WHO PEN — Hypertension monitoring intervals
  GINA 2023      — Asthma monitoring
  WHO PEN        — NCD Essential Package for low-resource settings
  Gambia MOH     — District health facility visit cadences

Gap priority:
  "urgent"   — overdue > 2× the recommended interval, or critical measure
  "due"      — overdue within the recommended window
  "upcoming" — due within the next 2 weeks
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional


# ─────────────────────────────────────────────────────────────────────────────
# Dataclass
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class CareGap:
    category:    str          # "lab" | "vitals" | "visit" | "exam" | "education"
    item:        str          # human-readable name
    condition:   str          # which condition triggers this gap
    interval_days: int        # recommended max interval in days
    last_seen:   Optional[str]  # ISO date string when last performed (None = never)
    days_overdue: int         # > 0 means overdue; 0 means on schedule
    priority:    str          # "urgent" | "due" | "upcoming" | "ok"
    action:      str          # recommended caregiver/CHW action


@dataclass
class CareGapReport:
    patient_id:    str
    computed_at:   str
    gaps:          List[CareGap] = field(default_factory=list)
    urgent_count:  int = 0
    due_count:     int = 0
    summary:       str = ""


# ─────────────────────────────────────────────────────────────────────────────
# Condition-specific care interval definitions
# ─────────────────────────────────────────────────────────────────────────────

# Format: (category, item, interval_days, action, applies_to_conditions)
# applies_to_conditions: list of lowercase keywords — any match triggers rule

_INTERVAL_RULES = [
    # ── Diabetes ──────────────────────────────────────────────────────────────
    ("lab",     "HbA1c measurement",          90,
     "Order HbA1c test at next health post visit. Target < 7.0%.",
     ["diabet", "t2dm", "type 2", "type 1", "insulin"]),

    ("vitals",  "Blood pressure check",       30,
     "Measure BP at every contact. Diabetic target < 130/80 mmHg.",
     ["diabet", "t2dm", "type 2", "type 1"]),

    ("lab",     "Fasting glucose",            90,
     "Check fasting glucose. Alert if > 126 mg/dL (7 mmol/L).",
     ["diabet", "t2dm", "type 2", "type 1", "insulin", "glucose"]),

    ("lab",     "Renal function (eGFR/creatinine)", 180,
     "Screen for diabetic nephropathy annually; more often if abnormal.",
     ["diabet", "t2dm", "type 2", "type 1"]),

    ("lab",     "Urine albumin-to-creatinine ratio", 365,
     "Annual screening for microalbuminuria (diabetic kidney disease).",
     ["diabet", "t2dm", "type 2", "type 1"]),

    ("exam",    "Foot examination",           180,
     "Inspect both feet for wounds, callus, sensation loss. Refer to CHO if abnormal.",
     ["diabet", "t2dm", "type 2", "type 1", "neuropathy", "peripheral"]),

    ("exam",    "Eye/vision check",           365,
     "Annual diabetic retinopathy screen. Refer to optometrist or eye unit.",
     ["diabet", "t2dm", "type 2", "type 1", "retinopathy"]),

    ("education", "Diabetes self-management education", 180,
     "Reinforce diet, exercise, glucose monitoring, and medication adherence.",
     ["diabet", "t2dm", "type 2", "type 1"]),

    # ── Hypertension ──────────────────────────────────────────────────────────
    ("vitals",  "Blood pressure check",       30,
     "Monthly BP monitoring. Target < 140/90 mmHg (< 130/80 if diabetic/CKD).",
     ["hypertension", "hypertensive", "high blood pressure", "htn"]),

    ("lab",     "Renal function (creatinine/potassium)", 180,
     "Monitor for ACE inhibitor/ARB side effects and hypertensive nephropathy.",
     ["hypertension", "hypertensive", "htn"]),

    ("lab",     "Lipid profile",              365,
     "Annual cardiovascular risk screen. Target LDL < 100 mg/dL if high risk.",
     ["hypertension", "hypertensive", "htn", "cardiovascular"]),

    ("education", "Hypertension lifestyle counselling", 90,
     "Reinforce low-salt diet, alcohol reduction, physical activity, smoking cessation.",
     ["hypertension", "hypertensive", "htn"]),

    # ── Asthma ────────────────────────────────────────────────────────────────
    ("visit",   "Asthma control review",      90,
     "Assess symptom frequency, night awakenings, rescue inhaler use, and PEFR if available.",
     ["asthma", "wheez", "bronchospasm", "reactive airway"]),

    ("exam",    "Inhaler technique check",    180,
     "Demonstrate and assess inhaler technique. Reinforce spacer use.",
     ["asthma", "wheez", "inhaler", "salbutamol", "beclomethasone"]),

    ("education", "Asthma action plan review", 365,
     "Review and update written asthma action plan including emergency steps.",
     ["asthma"]),

    # ── Heart failure / cardiovascular ────────────────────────────────────────
    ("vitals",  "Weight and fluid status",    30,
     "Monitor for fluid retention (> 2 kg weight gain in 1 week → contact CHO).",
     ["heart failure", "cardiac failure", "chf", "cardiomyopathy"]),

    ("lab",     "BNP / chest X-ray",          180,
     "Periodic assessment of cardiac function. Refer if deteriorating.",
     ["heart failure", "cardiac failure", "chf"]),

    # ── CKD ───────────────────────────────────────────────────────────────────
    ("lab",     "eGFR and electrolytes",      90,
     "Monitor CKD progression. Alert if eGFR < 30 or potassium > 5.5 mEq/L.",
     ["kidney", "ckd", "renal", "nephropathy", "proteinuria"]),

    # ── General NCD — all patients ─────────────────────────────────────────────
    ("visit",   "Scheduled NCD follow-up visit", 90,
     "Every-3-month clinical review for NCD patients at health post or CHO level.",
     ["diabet", "hypertension", "asthma", "heart failure", "kidney", "chronic"]),

    ("education", "Medication adherence counselling", 90,
     "Review medication list, check for side effects, reinforce importance of adherence.",
     ["diabet", "hypertension", "asthma", "heart failure", "kidney", "chronic"]),
]


# ─────────────────────────────────────────────────────────────────────────────
# Date helpers
# ─────────────────────────────────────────────────────────────────────────────

def _parse_date(raw: Optional[str]) -> Optional[datetime]:
    if not raw:
        return None
    for fmt in ("%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d"):
        try:
            dt = datetime.strptime(raw[:len(fmt) + 6], fmt)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt
        except ValueError:
            continue
    return None


def _today() -> datetime:
    return datetime.now(timezone.utc)


# ─────────────────────────────────────────────────────────────────────────────
# Last-seen lookup from consultation history
# ─────────────────────────────────────────────────────────────────────────────

_ITEM_KEYWORDS: Dict[str, List[str]] = {
    "HbA1c measurement":               ["hba1c", "glycated", "a1c"],
    "Blood pressure check":            ["blood pressure", "bp ", "mmhg"],
    "Fasting glucose":                 ["glucose", "fasting glucose", "blood sugar", "rbs", "fbs"],
    "Renal function (eGFR/creatinine)": ["creatinine", "egfr", "renal function", "urea"],
    "Urine albumin-to-creatinine ratio": ["acr", "albumin", "microalbumin", "proteinuria"],
    "Foot examination":                ["foot", "feet", "neuropathy", "monofilament"],
    "Eye/vision check":                ["eye", "vision", "retinal", "retinopathy", "ophthalmol"],
    "Renal function (creatinine/potassium)": ["creatinine", "potassium", "electrolyte"],
    "Lipid profile":                   ["lipid", "cholesterol", "ldl", "hdl", "triglyceride"],
    "Asthma control review":           ["asthma", "control", "pefr", "peak flow"],
    "Inhaler technique check":         ["inhaler", "technique", "spacer"],
    "Weight and fluid status":         ["weight", "fluid", "oedema", "edema", "ascites"],
    "BNP / chest X-ray":              ["bnp", "chest x", "echocardiogram", "echo"],
    "eGFR and electrolytes":           ["egfr", "electrolyte", "potassium", "sodium", "creatinine"],
}


def _find_last_seen(item: str, consultations: List[Dict]) -> Optional[str]:
    """
    Scan consultation summaries and recommendations for keywords matching
    the care item. Returns ISO date string of most recent match, or None.
    """
    keywords = _ITEM_KEYWORDS.get(item, [])
    for c in consultations:  # already sorted newest-first
        text = " ".join([
            (c.get("summary") or ""),
            " ".join(c.get("recommendations") or []),
            " ".join(c.get("symptoms_reported") or []),
        ]).lower()
        if any(kw in text for kw in keywords):
            return (c.get("started_at") or "")[:10]
    return None


# ─────────────────────────────────────────────────────────────────────────────
# Gap classifier
# ─────────────────────────────────────────────────────────────────────────────

def _classify_gap(
    last_seen_dt: Optional[datetime],
    interval_days: int,
) -> tuple[int, str]:
    """
    Returns (days_overdue, priority).
    days_overdue > 0 means overdue by that many days.
    """
    today = _today()
    if last_seen_dt is None:
        # Never done — treat as maximally overdue
        return interval_days, "urgent"

    due_date = last_seen_dt + timedelta(days=interval_days)
    days_left = (due_date - today).days
    days_overdue = -days_left  # positive = overdue

    if days_overdue > interval_days:
        priority = "urgent"
    elif days_overdue > 0:
        priority = "due"
    elif days_left <= 14:
        priority = "upcoming"
    else:
        priority = "ok"

    return max(0, days_overdue), priority


# ─────────────────────────────────────────────────────────────────────────────
# Main function
# ─────────────────────────────────────────────────────────────────────────────

def detect_care_gaps(
    patient_id: str,
    patient_data: Dict[str, Any],
) -> CareGapReport:
    """
    Detect care gaps for a patient.

    patient_data = {
        "profile":       {"conditions": [...], ...},
        "consultations": [{...}, ...],  # sorted newest-first
    }
    Returns a CareGapReport with prioritised gaps.
    """
    profile       = patient_data.get("profile", {})
    consultations = patient_data.get("consultations", [])
    conditions    = [str(c).lower() for c in profile.get("conditions", [])]
    conditions_str = " ".join(conditions)

    # Use the most recent consultation date as "last NCD visit"
    last_visit_date: Optional[str] = None
    if consultations:
        last_visit_date = (consultations[0].get("started_at") or "")[:10]

    gaps: List[CareGap] = []
    seen_items: set[str] = set()  # avoid duplicate rules (e.g. BP from multiple conditions)

    for (category, item, interval_days, action, condition_keywords) in _INTERVAL_RULES:
        # Check if any condition keyword matches patient's conditions
        if not any(kw in conditions_str for kw in condition_keywords):
            continue

        item_key = (item, category)
        if item_key in seen_items:
            continue
        seen_items.add(item_key)

        # Special handling: generic "visit" uses last_visit_date
        if category == "visit" and item == "Scheduled NCD follow-up visit":
            last_seen_str = last_visit_date
        else:
            last_seen_str = _find_last_seen(item, consultations)

        last_seen_dt = _parse_date(last_seen_str)
        days_overdue, priority = _classify_gap(last_seen_dt, interval_days)

        if priority == "ok":
            continue  # only report actionable gaps

        # Which condition triggered this rule
        triggered_by = next((kw for kw in condition_keywords if kw in conditions_str), "chronic NCD")

        gaps.append(CareGap(
            category     = category,
            item         = item,
            condition    = triggered_by,
            interval_days= interval_days,
            last_seen    = last_seen_str,
            days_overdue = days_overdue,
            priority     = priority,
            action       = action,
        ))

    # Sort: urgent first, then due, then upcoming
    priority_order = {"urgent": 0, "due": 1, "upcoming": 2}
    gaps.sort(key=lambda g: (priority_order.get(g.priority, 3), -g.days_overdue))

    urgent_count = sum(1 for g in gaps if g.priority == "urgent")
    due_count    = sum(1 for g in gaps if g.priority == "due")

    # Build summary
    if urgent_count:
        summary = f"{urgent_count} urgent care gap(s) require immediate action."
    elif due_count:
        summary = f"{due_count} care item(s) are overdue."
    elif gaps:
        summary = f"{len(gaps)} care item(s) due within 2 weeks."
    else:
        summary = "No care gaps detected — all monitored items are on schedule."

    return CareGapReport(
        patient_id   = patient_id,
        computed_at  = _today().isoformat(),
        gaps         = gaps,
        urgent_count = urgent_count,
        due_count    = due_count,
        summary      = summary,
    )
