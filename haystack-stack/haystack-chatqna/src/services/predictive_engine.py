"""
Predictive Deterioration Engine — AMINA Tier 1
===============================================

Computes a Composite Risk Index (CRI 0–100) for each patient by combining:

  1. VitalTrajectoryForecaster  — linear regression slope on BP/glucose series.
     Projects value at T+7 days; flags if projected value breaches threshold.

  2. SymptomEscalationPredictor — triage-sequence logistic score.
     Models P(urgent triage within 14 days) from historical escalation pattern.

  3. AdherenceDecayModel        — exponential time-decay on engagement signal.
     If last caregiver contact is old and adherence was already borderline,
     models decay toward non-adherence.

  4. ClinicalScoreCard          — deterioration_risk (0–10) from clinical_scoring.

CRI = weighted ensemble → 0–100 (higher = more risk).

Proactive alert thresholds:
  CRI ≥ 85  → CRITICAL  (open with emergency warning)
  CRI ≥ 65  → HIGH      (open with proactive clinical note)
  CRI ≥ 45  → MODERATE  (mention in opening context)

Redis caching:
  cri:{patient_id}  →  JSON  {cri, label, warnings, computed_at}  TTL 6h
"""

from __future__ import annotations

import json
import math
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional, Tuple

import redis as redis_lib

# ─────────────────────────────────────────────────────────────────────────────
# Dataclasses
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class VitalForecast:
    vital:           str              # "bp_systolic" | "bp_diastolic" | "glucose"
    current:         float
    projected_7d:    float
    slope_per_day:   float            # mmHg/day or mg/dL/day
    breaches_target: bool
    target:          float
    confidence:      str              # "high" | "moderate" | "low"
    warning:         str


@dataclass
class PredictiveRiskCard:
    patient_id:          str
    computed_at:         str
    cri:                 int           # 0–100
    cri_label:           str           # "low"|"moderate"|"high"|"critical"
    vital_forecasts:     List[VitalForecast] = field(default_factory=list)
    escalation_prob:     float = 0.0  # 0.0–1.0
    adherence_decay:     float = 1.0  # 1.0 = no decay; 0.0 = fully decayed
    warnings:            List[str] = field(default_factory=list)
    proactive_message:   str = ""     # AMINA opens with this if CRI ≥ 65


# ─────────────────────────────────────────────────────────────────────────────
# Parsing helpers
# ─────────────────────────────────────────────────────────────────────────────

def _parse_readings(raw: Any) -> List[Dict]:
    """Parse JSON array of reading objects from PatientVertex."""
    if not raw:
        return []
    if isinstance(raw, list):
        return raw
    try:
        return json.loads(raw)
    except Exception:
        return []


def _parse_date(raw: Optional[str]) -> Optional[datetime]:
    if not raw:
        return None
    for fmt in ("%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d", "%Y-%m-%dT%H:%M:%S.%f%z"):
        try:
            dt = datetime.strptime(str(raw)[:26], fmt)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt
        except ValueError:
            continue
    return None


def _today() -> datetime:
    return datetime.now(timezone.utc)


def _extract_bp_from_string(s: str) -> Optional[Tuple[int, int]]:
    m = re.search(r"(\d{2,3})\s*/\s*(\d{2,3})", str(s))
    return (int(m.group(1)), int(m.group(2))) if m else None


# ─────────────────────────────────────────────────────────────────────────────
# 1. Vital Trajectory Forecaster
# ─────────────────────────────────────────────────────────────────────────────

def _linear_slope(xs: List[float], ys: List[float]) -> float:
    """Ordinary least-squares slope."""
    if len(xs) < 2:
        return 0.0
    n = len(xs)
    mx = sum(xs) / n
    my = sum(ys) / n
    num   = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    denom = sum((x - mx) ** 2 for x in xs) or 1e-9
    return num / denom


def _confidence(n_points: int) -> str:
    if n_points >= 5:
        return "high"
    if n_points >= 3:
        return "moderate"
    return "low"


def _forecast_vitals(profile: Dict, consultations: List[Dict]) -> Tuple[List[VitalForecast], int]:
    """
    Build time-series from bp_readings / glucose_readings in profile,
    augmented by values extracted from consultation summaries.
    Returns (forecasts, risk_score_contribution 0-30).
    """
    forecasts: List[VitalForecast] = []
    risk_contrib = 0

    # ── BP series ─────────────────────────────────────────────────────────────
    bp_raw = _parse_readings(profile.get("bp_readings"))
    # Each reading: {"value": "145/92", "date": "2025-11-01"} or just "145/92"
    bp_series: List[Tuple[datetime, int, int]] = []
    for r in bp_raw:
        if isinstance(r, dict):
            dt  = _parse_date(r.get("date") or r.get("recorded_at"))
            val = _extract_bp_from_string(r.get("value", ""))
        else:
            dt  = None
            val = _extract_bp_from_string(str(r))
        if val and dt:
            bp_series.append((dt, val[0], val[1]))

    # Augment from consultation summaries
    for c in consultations:
        dt = _parse_date(c.get("started_at"))
        if not dt:
            continue
        text = (c.get("summary") or "") + " " + " ".join(c.get("recommendations") or [])
        val  = _extract_bp_from_string(text)
        if val:
            bp_series.append((dt, val[0], val[1]))

    # Deduplicate and sort ascending by date
    bp_series.sort(key=lambda x: x[0])
    bp_series = list({x[0].date(): x for x in bp_series}.values())  # one per day

    if len(bp_series) >= 2:
        days_from_first = [(x[0] - bp_series[0][0]).days for x in bp_series]
        systolics  = [x[1] for x in bp_series]
        diastolics = [x[2] for x in bp_series]

        slope_sys = _linear_slope(days_from_first, systolics)
        slope_dia = _linear_slope(days_from_first, diastolics)

        current_sys = systolics[-1]
        current_dia = diastolics[-1]
        proj_sys = current_sys + slope_sys * 7
        proj_dia = current_dia + slope_dia * 7

        # Detect diabetes or CKD for strict target
        conditions = [c.lower() for c in _parse_readings(profile.get("conditions")) if isinstance(c, str)]
        strict = any("diabet" in c or "ckd" in c or "kidney" in c for c in conditions)
        target_sys = 130 if strict else 140
        target_dia = 80  if strict else 90
        breaches   = proj_sys > target_sys + 10 or proj_dia > target_dia + 5

        warn = ""
        if slope_sys > 1.5 and proj_sys >= 160:
            warn = f"Systolic BP trending +{slope_sys:.1f} mmHg/day → projected {proj_sys:.0f} mmHg in 7 days"
            risk_contrib += 20
        elif slope_sys > 0.8:
            warn = f"Systolic BP rising slowly (+{slope_sys:.1f} mmHg/day)"
            risk_contrib += 10
        elif slope_sys < -1.0 and current_sys >= 140:
            warn = f"BP improving ({slope_sys:.1f} mmHg/day)"

        forecasts.append(VitalForecast(
            vital          = "bp_systolic",
            current        = current_sys,
            projected_7d   = round(proj_sys, 1),
            slope_per_day  = round(slope_sys, 2),
            breaches_target= breaches,
            target         = target_sys,
            confidence     = _confidence(len(bp_series)),
            warning        = warn,
        ))

    # ── Glucose series ────────────────────────────────────────────────────────
    glu_raw = _parse_readings(profile.get("glucose_readings"))
    glu_series: List[Tuple[datetime, float]] = []
    for r in glu_raw:
        if isinstance(r, dict):
            dt  = _parse_date(r.get("date") or r.get("recorded_at"))
            raw_val = r.get("value", "")
        else:
            dt, raw_val = None, str(r)
        m = re.search(r"(\d+\.?\d*)", str(raw_val))
        if m and dt:
            v = float(m.group(1))
            if v < 30:
                v *= 18  # mmol/L → mg/dL
            glu_series.append((dt, v))

    glu_series.sort(key=lambda x: x[0])

    if len(glu_series) >= 2:
        days_from_first = [(x[0] - glu_series[0][0]).days for x in glu_series]
        values          = [x[1] for x in glu_series]
        slope           = _linear_slope(days_from_first, values)
        current         = values[-1]
        projected       = current + slope * 7

        warn = ""
        if slope > 5 and projected >= 200:
            warn = f"Glucose trending +{slope:.1f} mg/dL/day → projected {projected:.0f} mg/dL in 7 days"
            risk_contrib += 15
        elif slope > 3:
            warn = f"Glucose rising slowly (+{slope:.1f} mg/dL/day)"
            risk_contrib += 8

        forecasts.append(VitalForecast(
            vital          = "glucose",
            current        = round(current, 1),
            projected_7d   = round(projected, 1),
            slope_per_day  = round(slope, 2),
            breaches_target= projected >= 126,
            target         = 126.0,
            confidence     = _confidence(len(glu_series)),
            warning        = warn,
        ))

    return forecasts, min(30, risk_contrib)


# ─────────────────────────────────────────────────────────────────────────────
# 2. Symptom Escalation Predictor
# ─────────────────────────────────────────────────────────────────────────────

_TRIAGE_SCORE = {"self_care": 0, "self care": 0, "low": 1, "moderate": 2, "urgent": 3, "emergency": 4}


def _predict_escalation(consultations: List[Dict]) -> Tuple[float, int]:
    """
    Logistic-style probability P(urgent triage in next 14 days).
    Uses:
      - Recent triage trend (slope over last 5 visits)
      - Proportion of urgent/emergency visits in last 10
      - Days since last visit
    Returns (probability 0.0–1.0, risk_contrib 0–25).
    """
    if not consultations:
        return 0.5, 12  # no data = moderate uncertainty

    recent = consultations[:5]
    scores = [_TRIAGE_SCORE.get((c.get("triage_level") or "low").lower(), 1) for c in recent]
    scores_asc = list(reversed(scores))

    # Slope
    if len(scores_asc) >= 2:
        n = len(scores_asc)
        xs = list(range(n))
        mx = sum(xs) / n
        my = sum(scores_asc) / n
        slope = sum((x - mx) * (y - my) for x, y in zip(xs, scores_asc)) / (
            sum((x - mx) ** 2 for x in xs) or 1
        )
    else:
        slope = 0.0

    # Proportion urgent/emergency in last 10
    last10 = consultations[:10]
    urgent_frac = sum(
        1 for c in last10
        if _TRIAGE_SCORE.get((c.get("triage_level") or "").lower(), 0) >= 3
    ) / max(1, len(last10))

    # Recency penalty
    latest_date = _parse_date((consultations[0].get("started_at") or ""))
    days_since  = (_today() - latest_date).days if latest_date else 60

    # Logistic components
    z = (
        slope * 1.2         # worsening trend
        + urgent_frac * 2.0 # history of urgent visits
        + (1 if days_since > 60 else 0) * 0.5   # long gap = missed deterioration
        + (scores[0] - 2) * 0.8                 # current triage
    )
    prob = 1 / (1 + math.exp(-z))  # sigmoid

    risk_contrib = min(25, int(prob * 30))
    return round(prob, 3), risk_contrib


# ─────────────────────────────────────────────────────────────────────────────
# 3. Adherence Decay Model
# ─────────────────────────────────────────────────────────────────────────────

def _adherence_decay(behavior: Dict, consultations: List[Dict]) -> Tuple[float, int]:
    """
    Exponential decay: adherence_now = adherence_base × e^(−λ × days_since_contact)
    λ = 0.01 (slow decay) if engagement was good; 0.025 (fast decay) if already borderline.
    Returns (decay_factor 0.0–1.0, risk_contrib 0–20).
    """
    signal = (behavior.get("medication_adherence_signal") or "").lower()
    if "good" in signal or "high" in signal:
        base_adherence, lam = 0.90, 0.008
    elif "poor" in signal or "low" in signal:
        base_adherence, lam = 0.45, 0.030
    else:
        base_adherence, lam = 0.70, 0.015

    # Days since last recorded contact (caregiver check-in or consultation)
    latest_dt = _parse_date((consultations[0].get("started_at") or "")) if consultations else None
    days = (_today() - latest_dt).days if latest_dt else 90
    days = min(days, 180)  # cap at 6 months

    decayed = base_adherence * math.exp(-lam * days)
    decayed = max(0.0, min(1.0, decayed))

    risk_contrib = 0
    if decayed < 0.4:
        risk_contrib = 20
    elif decayed < 0.6:
        risk_contrib = 12
    elif decayed < 0.75:
        risk_contrib = 6

    return round(decayed, 3), risk_contrib


# ─────────────────────────────────────────────────────────────────────────────
# 4. Composite Risk Index
# ─────────────────────────────────────────────────────────────────────────────

def _cri_label(cri: int) -> str:
    if cri >= 85:
        return "critical"
    if cri >= 65:
        return "high"
    if cri >= 45:
        return "moderate"
    return "low"


def _build_proactive_message(
    card: PredictiveRiskCard,
    patient_name: str,
    sdoh_context: str = "",
) -> str:
    if card.cri < 45:
        return ""

    top_warnings = [w for w in card.warnings if w][:2]
    warn_str = " · ".join(top_warnings) if top_warnings else "elevated risk indicators"

    if card.cri >= 85:
        return (
            f"⚠️ Before you share anything, I need to flag that {patient_name}'s data shows "
            f"critical risk signals: {warn_str}. "
            f"This needs urgent attention — please tell me what you are currently observing."
        )
    if card.cri >= 65:
        return (
            f"I've reviewed {patient_name}'s recent data before you arrived. "
            f"I want to flag: {warn_str}. "
            f"Let's make sure we cover this carefully today."
        )
    return (
        f"A note before we start: {patient_name}'s trends show {warn_str}. "
        f"I'll factor this into today's review."
    )


# ─────────────────────────────────────────────────────────────────────────────
# Redis cache
# ─────────────────────────────────────────────────────────────────────────────

_CRI_TTL = 6 * 3600   # 6 hours


def _get_redis():
    from src.config import settings
    return redis_lib.Redis(
        host=settings.REDIS_HOST, port=settings.REDIS_PORT, decode_responses=True,
    )


def _cache_key(patient_id: str) -> str:
    return f"cri:{patient_id}"


def _load_cached(patient_id: str) -> Optional[Dict]:
    try:
        raw = _get_redis().get(_cache_key(patient_id))
        return json.loads(raw) if raw else None
    except Exception:
        return None


def _save_cached(patient_id: str, card: PredictiveRiskCard) -> None:
    try:
        data = {
            "cri":               card.cri,
            "cri_label":         card.cri_label,
            "escalation_prob":   card.escalation_prob,
            "adherence_decay":   card.adherence_decay,
            "warnings":          card.warnings,
            "proactive_message": card.proactive_message,
            "computed_at":       card.computed_at,
            "vital_forecasts":   [
                {
                    "vital":           f.vital,
                    "current":         f.current,
                    "projected_7d":    f.projected_7d,
                    "slope_per_day":   f.slope_per_day,
                    "breaches_target": f.breaches_target,
                    "target":          f.target,
                    "confidence":      f.confidence,
                    "warning":         f.warning,
                }
                for f in card.vital_forecasts
            ],
        }
        _get_redis().setex(_cache_key(patient_id), _CRI_TTL, json.dumps(data))
    except Exception:
        pass


def invalidate_cri(patient_id: str) -> None:
    """Call this after a new consultation is recorded."""
    try:
        _get_redis().delete(_cache_key(patient_id))
    except Exception:
        pass


# ─────────────────────────────────────────────────────────────────────────────
# Master function
# ─────────────────────────────────────────────────────────────────────────────

def compute_cri(
    patient_id:    str,
    patient_data:  Dict[str, Any],
    patient_name:  str = "the patient",
    sdoh_context:  str = "",
    force_refresh: bool = False,
) -> PredictiveRiskCard:
    """
    Compute or retrieve cached Composite Risk Index for a patient.

    patient_data = {
        "profile":       { bp_readings, glucose_readings, conditions, ... },
        "consultations": [ { triage_level, started_at, symptoms_reported, ... } ],
        "behavior":      { medication_adherence_signal, engagement_pattern },
    }
    """
    if not force_refresh:
        cached = _load_cached(patient_id)
        if cached:
            return PredictiveRiskCard(
                patient_id        = patient_id,
                computed_at       = cached["computed_at"],
                cri               = cached["cri"],
                cri_label         = cached["cri_label"],
                escalation_prob   = cached["escalation_prob"],
                adherence_decay   = cached["adherence_decay"],
                warnings          = cached["warnings"],
                proactive_message = cached["proactive_message"],
                vital_forecasts   = [],  # not needed from cache for pipeline
            )

    profile       = patient_data.get("profile", {})
    consultations = patient_data.get("consultations", [])
    behavior      = patient_data.get("behavior", {})

    # Component scores
    vital_forecasts, vital_risk = _forecast_vitals(profile, consultations)
    escalation_prob, esc_risk   = _predict_escalation(consultations)
    adherence_decay, adh_risk   = _adherence_decay(behavior, consultations)

    # Clinical scoring deterioration (0-10) → 0-25
    try:
        from src.services.clinical_scoring import score_patient
        sc      = score_patient(patient_id, patient_data)
        clin_risk = min(25, sc.deterioration_risk * 2)
    except Exception:
        clin_risk = 10

    # CRI composite (max 100)
    raw_cri = vital_risk + esc_risk + adh_risk + clin_risk
    cri     = min(100, raw_cri)
    label   = _cri_label(cri)

    # Collect warnings
    warnings: List[str] = []
    for f in vital_forecasts:
        if f.warning and "rising" in f.warning.lower() or "trending" in f.warning.lower():
            warnings.append(f.warning)
    if escalation_prob >= 0.65:
        warnings.append(f"P(urgent triage in 14 days) = {escalation_prob:.0%}")
    if adherence_decay < 0.5:
        warnings.append(f"Adherence decay model: {adherence_decay:.0%} estimated remaining adherence")

    card = PredictiveRiskCard(
        patient_id      = patient_id,
        computed_at     = _today().isoformat(),
        cri             = cri,
        cri_label       = label,
        vital_forecasts = vital_forecasts,
        escalation_prob = escalation_prob,
        adherence_decay = adherence_decay,
        warnings        = warnings,
    )
    card.proactive_message = _build_proactive_message(card, patient_name, sdoh_context)

    _save_cached(patient_id, card)
    return card
