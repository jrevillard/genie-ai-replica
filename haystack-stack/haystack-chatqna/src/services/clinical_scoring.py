"""
Clinical Scoring Service — AMINA Caregiver Intelligence
=========================================================

Computes deterministic risk scores from patient database data.
Zero LLM calls — all rule-based.

Scores produced:
  news2_proxy        — adapted NEWS2 for NCD community context (0-14+)
  adherence_score    — Morisky-proxy from behavior + caregiver signal (0.0-1.0)
  phq2_proxy         — depression/mood proxy from symptom history (0-6)
  bp_at_target       — BP < 130/80 mmHg (JNC8 / WHO PEN)
  glucose_at_target  — fasting glucose < 126 mg/dL (7.0 mmol/L) or casual < 200
  hba1c_at_target    — HbA1c < 7.0 % (ADA) when recorded
  deterioration_risk — weighted composite 0-10

References:
  NEWS2: Royal College of Physicians 2017 (adapted for community NCD)
  Morisky: 4-item proxy (engagement + self-report)
  ADA 2024: HbA1c target < 7 % for most adults
  JNC8 / WHO PEN: BP target < 130/80 mmHg for diabetes/CKD, < 140/90 general
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional


# ─────────────────────────────────────────────────────────────────────────────
# Dataclass
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class ClinicalScoreCard:
    patient_id:          str
    computed_at:         str          # ISO-8601
    news2_proxy:         int          # 0-14+ (≥7 = critical)
    adherence_score:     float        # 0.0-1.0 (1.0 = perfect)
    phq2_proxy:          int          # 0-6 (≥3 = positive screen)
    bp_at_target:        bool
    glucose_at_target:   bool
    hba1c_at_target:     Optional[bool]
    deterioration_risk:  int          # 0-10
    risk_label:          str          # "low"|"moderate"|"high"|"critical"
    flags:               List[str] = field(default_factory=list)
    escalation_level:    str = "self_care"  # "self_care"|"chw_visit"|"health_post"|"emergency"


# ─────────────────────────────────────────────────────────────────────────────
# BP parsing helper
# ─────────────────────────────────────────────────────────────────────────────

def _parse_bp(raw: str) -> Optional[tuple[int, int]]:
    """Parse '145/92', '145 / 92', or '145-92' → (systolic, diastolic)."""
    if not raw:
        return None
    m = re.search(r"(\d{2,3})\s*[/\-]\s*(\d{2,3})", str(raw))
    if m:
        return int(m.group(1)), int(m.group(2))
    return None


def _parse_glucose(raw: str) -> Optional[float]:
    """
    Parse glucose as mg/dL.  If value looks like mmol/L (< 30) convert × 18.
    """
    if not raw:
        return None
    m = re.search(r"(\d+\.?\d*)", str(raw))
    if not m:
        return None
    val = float(m.group(1))
    return val * 18.0 if val < 30 else val


def _parse_hba1c(raw: str) -> Optional[float]:
    """Parse HbA1c string like '7.2%' or '7.2'."""
    if not raw:
        return None
    m = re.search(r"(\d+\.?\d*)", str(raw))
    return float(m.group(1)) if m else None


# ─────────────────────────────────────────────────────────────────────────────
# NEWS2 proxy
# ─────────────────────────────────────────────────────────────────────────────

# Triage-level → proxy NEWS2 contribution (community-adapted)
_TRIAGE_NEWS2 = {
    "emergency":   6,
    "urgent":      4,
    "moderate":    2,
    "low":         0,
    "self_care":   0,
}

_SYMPTOM_NEWS2 = {
    "unconscious":          4,
    "not responding":       4,
    "severe chest pain":    4,
    "cannot breathe":       4,
    "collapsed":            4,
    "seizure":              4,
    "shortness of breath":  3,
    "difficulty breathing": 3,
    "breathlessness":       3,
    "chest pain":           3,
    "confusion":            3,
    "altered consciousness":3,
    "high fever":           2,
    "fever":                2,
    "vomiting":             1,
    "diarrhoea":            1,
    "dizziness":            1,
    "headache":             1,
    "weakness":             1,
}


def _compute_news2_proxy(
    profile: Dict,
    consultations: List[Dict],
    behavior: Dict,
    caregiver_concern_text: str = "",
) -> tuple[int, List[str]]:
    """
    Returns (score, flags).
    score: 0-14+  (≥7 critical, 5-6 high, 3-4 moderate, 0-2 low)
    """
    score = 0
    flags: List[str] = []

    # ── Vital signs from profile ──────────────────────────────────────────────
    bp = _parse_bp(profile.get("last_bp", ""))
    if bp:
        sys, dia = bp
        if sys >= 180 or dia >= 110:
            score += 3; flags.append(f"Hypertensive crisis: {sys}/{dia} mmHg")
        elif sys >= 160 or dia >= 100:
            score += 2; flags.append(f"Severe hypertension: {sys}/{dia} mmHg")
        elif sys >= 140 or dia >= 90:
            score += 1; flags.append(f"Stage 1-2 hypertension: {sys}/{dia} mmHg")
        elif sys < 90:
            score += 3; flags.append(f"Hypotension: {sys}/{dia} mmHg")

    glu = _parse_glucose(str(profile.get("last_glucose", "")))
    if glu is not None:
        if glu >= 400:
            score += 3; flags.append(f"Severe hyperglycaemia: {glu:.0f} mg/dL")
        elif glu >= 200:
            score += 2; flags.append(f"Hyperglycaemia: {glu:.0f} mg/dL")
        elif glu < 70:
            score += 3; flags.append(f"Hypoglycaemia: {glu:.0f} mg/dL")

    # ── Recent consultation triage ────────────────────────────────────────────
    if consultations:
        recent = consultations[0]  # most recent
        triage = (recent.get("triage_level") or "low").lower()
        news2_triage = _TRIAGE_NEWS2.get(triage, 0)
        if news2_triage:
            score += news2_triage
            flags.append(f"Last visit triage: {triage}")

        # Symptom keyword scan across recent consultations (last 3)
        seen_syms: set[str] = set()
        for c in consultations[:3]:
            syms = c.get("symptoms_reported", [])
            if isinstance(syms, list):
                for s in syms:
                    for kw, pts in _SYMPTOM_NEWS2.items():
                        if kw in str(s).lower() and kw not in seen_syms:
                            score += min(pts, 2)  # cap per-symptom at 2 in proxy
                            seen_syms.add(kw)
                            if pts >= 3:
                                flags.append(f"Serious symptom reported: {kw}")

    # ── Caregiver concern text keyword scan ───────────────────────────────────
    concern_lower = caregiver_concern_text.lower()
    for kw, pts in _SYMPTOM_NEWS2.items():
        if kw in concern_lower:
            score += 1  # caregiver concern adds 1 regardless of pts
            flags.append(f"Caregiver reports: {kw}")

    # ── Behavior engagement ───────────────────────────────────────────────────
    engagement = (behavior.get("engagement_pattern") or "").lower()
    if "disengaged" in engagement or "dropout" in engagement:
        score += 1; flags.append("Low patient engagement pattern")

    return score, flags


# ─────────────────────────────────────────────────────────────────────────────
# Adherence score (Morisky-proxy)
# ─────────────────────────────────────────────────────────────────────────────

_ADHERENCE_KEYWORDS_POOR = [
    "not taking", "forgot", "missed", "stopped", "refuses", "no medication",
    "ran out", "skipping", "not compliant", "non-compliant", "forgets",
    "irregular", "inconsistent", "side effects stopped",
]

_ADHERENCE_KEYWORDS_GOOD = [
    "taking medication", "regular", "compliant", "on schedule",
    "never miss", "always takes", "good adherence", "following prescription",
]


def _compute_adherence_score(
    profile: Dict,
    behavior: Dict,
    consultations: List[Dict],
    caregiver_statements: List[str],
) -> tuple[float, List[str]]:
    """
    Returns (score 0.0-1.0, flags).
    1.0 = perfect; < 0.5 = poor adherence (flag).
    """
    score = 0.7  # default: assume moderate adherence
    flags: List[str] = []

    # ── Behavior signal ───────────────────────────────────────────────────────
    adherence_signal = (behavior.get("medication_adherence_signal") or "").lower()
    if "poor" in adherence_signal or "low" in adherence_signal:
        score -= 0.3; flags.append("Behavior profile: low medication adherence signal")
    elif "good" in adherence_signal or "high" in adherence_signal:
        score += 0.2
    elif "moderate" in adherence_signal:
        score += 0.0  # no change from default

    # ── Consultation history ──────────────────────────────────────────────────
    non_adherence_mentions = 0
    for c in consultations:
        summary = (c.get("summary") or "").lower()
        for kw in _ADHERENCE_KEYWORDS_POOR:
            if kw in summary:
                non_adherence_mentions += 1
                break
    if non_adherence_mentions >= 3:
        score -= 0.25; flags.append(f"Non-adherence noted in {non_adherence_mentions} past consultations")
    elif non_adherence_mentions >= 1:
        score -= 0.10

    # ── Caregiver statements (most authoritative — direct observation) ─────────
    for stmt in caregiver_statements:
        stmt_lower = stmt.lower()
        for kw in _ADHERENCE_KEYWORDS_POOR:
            if kw in stmt_lower:
                score -= 0.25
                flags.append(f"Caregiver reports non-adherence: '{kw}'")
                break
        for kw in _ADHERENCE_KEYWORDS_GOOD:
            if kw in stmt_lower:
                score += 0.15
                break

    score = max(0.0, min(1.0, score))
    if score < 0.5:
        flags.append(f"Adherence score {score:.2f} — medication non-compliance risk")
    return score, flags


# ─────────────────────────────────────────────────────────────────────────────
# PHQ-2 proxy (depression/mood screen)
# ─────────────────────────────────────────────────────────────────────────────

_PHQ2_KEYWORDS = {
    # item 1: little interest / pleasure (0-3)
    "no interest":    2, "not interested":   2, "no pleasure":      2,
    "doesn't enjoy":  2, "doesn't care":     1, "withdrawn":        1,
    "isolated":       1, "no motivation":    1,
    # item 2: feeling down / hopeless (0-3)
    "depressed":      3, "hopeless":         3, "feeling down":     2,
    "sad":            1, "crying":           2, "not sleeping":     1,
    "insomnia":       1, "not eating":       1, "loss of appetite":  1,
    "suicidal":       3, "wants to die":     3,
}


def _compute_phq2_proxy(
    behavior: Dict,
    consultations: List[Dict],
    caregiver_statements: List[str],
) -> tuple[int, List[str]]:
    """Returns (score 0-6, flags). ≥3 = positive screen for depression."""
    score = 0
    flags: List[str] = []
    seen: set[str] = set()

    sources = []
    for c in consultations[:5]:
        sources.append((c.get("summary") or "") + " " + " ".join(c.get("symptoms_reported") or []))
    sources.extend(caregiver_statements)
    if behavior.get("mood_notes"):
        sources.append(str(behavior["mood_notes"]))

    for text in sources:
        text_lower = text.lower()
        for kw, pts in _PHQ2_KEYWORDS.items():
            if kw in text_lower and kw not in seen:
                score += pts
                seen.add(kw)

    score = min(6, score)
    if score >= 3:
        flags.append(f"PHQ-2 proxy score {score}/6 — depression screen positive")
    elif score >= 1:
        flags.append(f"PHQ-2 proxy score {score}/6 — mood monitoring advised")
    return score, flags


# ─────────────────────────────────────────────────────────────────────────────
# Target range checks
# ─────────────────────────────────────────────────────────────────────────────

def _check_target_ranges(profile: Dict) -> tuple[bool, bool, Optional[bool], List[str]]:
    """
    Returns (bp_ok, glucose_ok, hba1c_ok, flags).
    hba1c_ok is None when no HbA1c data is available.
    """
    flags: List[str] = []

    # BP target: < 130/80 (diabetic/CKD) or < 140/90 (general)
    conditions = [c.lower() for c in profile.get("conditions", [])]
    is_diabetic = any("diabet" in c for c in conditions)
    is_ckd      = any("kidney" in c or "ckd" in c or "renal" in c for c in conditions)
    strict_bp   = is_diabetic or is_ckd

    bp_ok = True
    bp_raw = profile.get("last_bp", "")
    bp = _parse_bp(bp_raw)
    if bp:
        sys, dia = bp
        tgt_sys = 130 if strict_bp else 140
        tgt_dia = 80  if strict_bp else 90
        if sys > tgt_sys or dia > tgt_dia:
            bp_ok = False
            flags.append(f"BP {sys}/{dia} above target (<{tgt_sys}/{tgt_dia} mmHg)")
    else:
        bp_ok = True  # unknown → don't flag

    # Glucose target: fasting < 126 mg/dL (7 mmol/L), casual < 200 mg/dL
    glucose_ok = True
    glu = _parse_glucose(str(profile.get("last_glucose", "")))
    if glu is not None:
        if glu >= 200:
            glucose_ok = False
            flags.append(f"Glucose {glu:.0f} mg/dL — above casual threshold (200)")
        elif glu >= 126 and is_diabetic:
            glucose_ok = False
            flags.append(f"Glucose {glu:.0f} mg/dL — above fasting target (126)")

    # HbA1c target: < 7.0% (ADA 2024)
    hba1c_ok: Optional[bool] = None
    hba1c_raw = profile.get("hba1c") or profile.get("last_hba1c", "")
    hba1c = _parse_hba1c(str(hba1c_raw))
    if hba1c is not None:
        hba1c_ok = hba1c < 7.0
        if not hba1c_ok:
            flags.append(f"HbA1c {hba1c:.1f}% above target (<7.0%)")

    return bp_ok, glucose_ok, hba1c_ok, flags


# ─────────────────────────────────────────────────────────────────────────────
# Deterioration risk composite (0-10)
# ─────────────────────────────────────────────────────────────────────────────

def _compute_deterioration_risk(
    news2: int,
    adherence: float,
    phq2: int,
    bp_ok: bool,
    glucose_ok: bool,
    hba1c_ok: Optional[bool],
    consultations: List[Dict],
) -> tuple[int, str]:
    """
    Weighted composite:
      news2 (0-14)           → 40 % weight
      adherence (0-1)        → 20 % weight (inverse)
      phq2 (0-6)             → 10 % weight
      out-of-target vitals   → 15 % weight
      consultation recency   → 15 % weight

    Returns (score 0-10, risk_label).
    """
    # NEWS2 component (0-4)
    news2_c = min(4.0, news2 / 14 * 4) * 0.40

    # Adherence component (0-2) — poor adherence = higher risk
    adherence_c = (1.0 - adherence) * 2.0 * 0.20

    # PHQ-2 component (0-1)
    phq2_c = min(1.0, phq2 / 6) * 0.10 * 10  # normalise to 0-1 then ×10

    # Out-of-target vital component (0-1.5)
    target_miss = sum([not bp_ok, not glucose_ok, hba1c_ok is False])
    target_c = (target_miss / 3) * 1.5 * 0.15 * 10

    # Consultation recency (0-1.5) — no recent visit = higher risk
    recency_c = 0.0
    if consultations:
        latest_str = consultations[0].get("started_at", "")
        try:
            latest = datetime.fromisoformat(latest_str.replace("Z", "+00:00"))
            days_since = (datetime.now(timezone.utc) - latest).days
            if days_since > 90:
                recency_c = 1.5
            elif days_since > 60:
                recency_c = 1.0
            elif days_since > 30:
                recency_c = 0.5
        except Exception:
            recency_c = 0.5  # unknown date → moderate penalty
    else:
        recency_c = 1.5  # no visits at all → max penalty

    recency_c *= 0.15

    raw = news2_c + adherence_c + phq2_c / 10 + target_c / 10 + recency_c
    score = min(10, round(raw * 10))

    if score >= 8:
        label = "critical"
    elif score >= 6:
        label = "high"
    elif score >= 4:
        label = "moderate"
    else:
        label = "low"

    return score, label


# ─────────────────────────────────────────────────────────────────────────────
# Escalation level
# ─────────────────────────────────────────────────────────────────────────────

def _determine_escalation(
    deterioration: int,
    news2: int,
    adherence: float,
    flags: List[str],
) -> str:
    any_critical_flag = any(kw in " ".join(flags).lower() for kw in [
        "crisis", "hypoglycaemia", "hypotension", "severe hyperglycaemia",
        "suicidal", "wants to die", "cannot breathe", "collapsed", "unconscious",
    ])
    if any_critical_flag or news2 >= 7 or deterioration >= 8:
        return "emergency"
    if news2 >= 5 or deterioration >= 6 or adherence < 0.3:
        return "health_post"
    if news2 >= 3 or deterioration >= 4:
        return "chw_visit"
    return "self_care"


# ─────────────────────────────────────────────────────────────────────────────
# Master function
# ─────────────────────────────────────────────────────────────────────────────

def score_patient(
    patient_id: str,
    patient_data: Dict[str, Any],
    caregiver_statements: Optional[List[str]] = None,
) -> ClinicalScoreCard:
    """
    Master scoring function.

    patient_data = {
        "profile":       {...},          # from PatientVertex
        "consultations": [{...}, ...],   # from ConsultationRecord
        "behavior":      {...},          # from Redis behavior:{patient_id}
    }
    caregiver_statements: list of raw caregiver messages from this conversation
    """
    profile       = patient_data.get("profile", {})
    consultations = patient_data.get("consultations", [])
    behavior      = patient_data.get("behavior", {})
    statements    = caregiver_statements or []

    # Extract caregiver concern text (used in NEWS2 proxy)
    concern_text = " ".join(statements)

    news2, flags_news2 = _compute_news2_proxy(profile, consultations, behavior, concern_text)
    adherence, flags_adh = _compute_adherence_score(profile, behavior, consultations, statements)
    phq2, flags_phq2 = _compute_phq2_proxy(behavior, consultations, statements)
    bp_ok, glucose_ok, hba1c_ok, flags_targets = _check_target_ranges(profile)
    deterioration, risk_label = _compute_deterioration_risk(
        news2, adherence, phq2, bp_ok, glucose_ok, hba1c_ok, consultations,
    )

    all_flags = flags_news2 + flags_adh + flags_phq2 + flags_targets
    escalation = _determine_escalation(deterioration, news2, adherence, all_flags)

    return ClinicalScoreCard(
        patient_id         = patient_id,
        computed_at        = datetime.now(timezone.utc).isoformat(),
        news2_proxy        = news2,
        adherence_score    = round(adherence, 2),
        phq2_proxy         = phq2,
        bp_at_target       = bp_ok,
        glucose_at_target  = glucose_ok,
        hba1c_at_target    = hba1c_ok,
        deterioration_risk = deterioration,
        risk_label         = risk_label,
        flags              = all_flags,
        escalation_level   = escalation,
    )
