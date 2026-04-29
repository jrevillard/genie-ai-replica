"""
Trend Analyzer — AMINA Caregiver Intelligence
==============================================

Detects clinical deterioration patterns from consultation history.
Zero LLM calls — all rule-based signal extraction.

Signals analyzed:
  triage_trend         — is triage level worsening over recent visits?
  symptom_recurrence   — recurring symptoms across multiple consultations
  vital_trend          — BP/glucose trajectory (improving / stable / worsening)
  engagement_decline   — decreasing visit frequency (missed appointments)
  high_risk_symptoms   — red-flag symptoms appearing in recent history
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple


# ─────────────────────────────────────────────────────────────────────────────
# Dataclasses
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class TrendSignal:
    name:      str
    direction: str   # "improving" | "stable" | "worsening" | "critical"
    detail:    str
    severity:  str   # "info" | "watch" | "flag" | "alert"


@dataclass
class TrendReport:
    patient_id:         str
    computed_at:        str
    signals:            List[TrendSignal] = field(default_factory=list)
    overall_trajectory: str = "stable"    # "improving"|"stable"|"worsening"|"critical"
    alert_count:        int = 0
    summary:            str = ""


# ─────────────────────────────────────────────────────────────────────────────
# Triage level ordering
# ─────────────────────────────────────────────────────────────────────────────

_TRIAGE_ORDER = {
    "self_care": 0,
    "self care": 0,
    "low":       1,
    "moderate":  2,
    "urgent":    3,
    "emergency": 4,
}


def _triage_score(raw: Optional[str]) -> int:
    return _TRIAGE_ORDER.get((raw or "").lower().strip(), 1)


# ─────────────────────────────────────────────────────────────────────────────
# Date helpers
# ─────────────────────────────────────────────────────────────────────────────

def _parse_date(raw: Optional[str]) -> Optional[datetime]:
    if not raw:
        return None
    for fmt in ("%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d"):
        try:
            dt = datetime.strptime(str(raw)[:len(fmt) + 6], fmt)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt
        except ValueError:
            continue
    return None


def _today() -> datetime:
    return datetime.now(timezone.utc)


# ─────────────────────────────────────────────────────────────────────────────
# [1] Triage trend
# ─────────────────────────────────────────────────────────────────────────────

def _analyze_triage_trend(consultations: List[Dict]) -> Optional[TrendSignal]:
    """
    Compare triage levels across last 5 consultations.
    Detect slope: worsening = average triage score increasing over time.
    """
    if len(consultations) < 2:
        return None

    recent = consultations[:5]  # newest first
    scores = [_triage_score(c.get("triage_level")) for c in recent]
    # Reverse so oldest is first (for slope calculation)
    scores_asc = list(reversed(scores))

    if len(scores_asc) >= 3:
        # Simple linear regression slope
        n = len(scores_asc)
        xs = list(range(n))
        mean_x = sum(xs) / n
        mean_y = sum(scores_asc) / n
        num   = sum((x - mean_x) * (y - mean_y) for x, y in zip(xs, scores_asc))
        denom = sum((x - mean_x) ** 2 for x in xs) or 1
        slope = num / denom
    else:
        slope = scores_asc[-1] - scores_asc[0]

    # Most recent triage
    latest_score = scores[0]
    latest_label = (consultations[0].get("triage_level") or "low").lower()

    if slope > 0.4 and latest_score >= 3:
        direction = "critical"
        severity  = "alert"
        detail    = (f"Triage level escalating: slope={slope:.2f} over last {len(recent)} visits. "
                     f"Most recent: {latest_label.upper()}")
    elif slope > 0.3:
        direction = "worsening"
        severity  = "flag"
        detail    = (f"Triage trend worsening over last {len(recent)} visits "
                     f"(slope={slope:.2f}). Latest: {latest_label}.")
    elif slope < -0.2:
        direction = "improving"
        severity  = "info"
        detail    = f"Triage trend improving (slope={slope:.2f}) — positive trajectory."
    else:
        direction = "stable"
        severity  = "info"
        detail    = f"Triage level stable over last {len(recent)} visits."

    return TrendSignal(name="triage_trend", direction=direction, detail=detail, severity=severity)


# ─────────────────────────────────────────────────────────────────────────────
# [2] Symptom recurrence
# ─────────────────────────────────────────────────────────────────────────────

_RED_FLAG_SYMPTOMS = [
    "chest pain", "difficulty breathing", "breathlessness", "shortness of breath",
    "palpitations", "fainting", "collapsed", "seizure", "unconscious",
    "severe headache", "blurred vision", "visual disturbance", "numbness",
    "weakness one side", "stroke", "facial droop",
    "severe vomiting", "blood in stool", "haematuria", "blood in urine",
    "severe pain", "high fever", "severe dehydration",
]

_CHRONIC_SYMPTOMS = [
    "fatigue", "tiredness", "weakness", "oedema", "swelling",
    "nocturia", "polyuria", "polydipsia", "poor appetite",
    "weight loss", "insomnia", "anxiety", "depression",
    "dizziness", "headache", "cough",
]


def _analyze_symptom_recurrence(consultations: List[Dict]) -> List[TrendSignal]:
    """
    Count how many times each symptom appears across consultations.
    Flag symptoms that recur 3+ times as chronic; red-flag symptoms
    appearing even once get an alert.
    """
    signals: List[TrendSignal] = []
    symptom_counts: Dict[str, int] = {}
    red_flags_seen: set = set()

    for c in consultations:
        syms = c.get("symptoms_reported") or []
        if isinstance(syms, str):
            syms = [syms]
        for s in syms:
            s_lower = str(s).lower()

            # Red flag check
            for rf in _RED_FLAG_SYMPTOMS:
                if rf in s_lower and rf not in red_flags_seen:
                    red_flags_seen.add(rf)

            # Chronic symptom counting
            for cs in _CHRONIC_SYMPTOMS:
                if cs in s_lower:
                    symptom_counts[cs] = symptom_counts.get(cs, 0) + 1

        # Also scan summary text
        summary = (c.get("summary") or "").lower()
        for rf in _RED_FLAG_SYMPTOMS:
            if rf in summary and rf not in red_flags_seen:
                red_flags_seen.add(rf)

    # Red flag signals
    if red_flags_seen:
        signals.append(TrendSignal(
            name="red_flag_symptoms",
            direction="critical",
            detail=f"Red-flag symptoms in history: {'; '.join(sorted(red_flags_seen))}.",
            severity="alert",
        ))

    # Recurring chronic symptoms (3+ consultations)
    recurring = {sym: cnt for sym, cnt in symptom_counts.items() if cnt >= 3}
    if recurring:
        top = sorted(recurring.items(), key=lambda x: -x[1])[:4]
        desc = ", ".join(f"{sym} (×{cnt})" for sym, cnt in top)
        signals.append(TrendSignal(
            name="recurrent_symptoms",
            direction="worsening",
            detail=f"Recurring symptoms across {len(consultations)} consultations: {desc}.",
            severity="flag",
        ))

    return signals


# ─────────────────────────────────────────────────────────────────────────────
# [3] Vital trends (BP and glucose from consultation text)
# ─────────────────────────────────────────────────────────────────────────────

def _extract_bp_values(text: str) -> List[Tuple[int, int]]:
    """Extract all BP readings from free text as (systolic, diastolic) pairs."""
    return [(int(m.group(1)), int(m.group(2)))
            for m in re.finditer(r"(\d{2,3})\s*/\s*(\d{2,3})", text)]


def _extract_glucose_values(text: str) -> List[float]:
    """Extract glucose readings in mg/dL from text."""
    values = []
    for m in re.finditer(r"(?:glucose|rbs|fbs|blood sugar)[^\d]*(\d+\.?\d*)", text, re.IGNORECASE):
        val = float(m.group(1))
        if val < 30:
            val *= 18  # mmol/L → mg/dL
        values.append(val)
    return values


def _analyze_vital_trend(profile: Dict, consultations: List[Dict]) -> List[TrendSignal]:
    signals: List[TrendSignal] = []

    # Collect BP values from consultations (oldest → newest)
    bp_series: List[Tuple[int, int]] = []
    for c in reversed(consultations):  # oldest first
        text = " ".join([
            c.get("summary") or "",
            " ".join(c.get("recommendations") or []),
        ])
        bps = _extract_bp_values(text)
        bp_series.extend(bps)

    # Also include profile's current BP
    from src.services.clinical_scoring import _parse_bp
    current_bp = _parse_bp(profile.get("last_bp", ""))
    if current_bp:
        bp_series.append(current_bp)

    if len(bp_series) >= 3:
        systolics = [bp[0] for bp in bp_series[-5:]]
        delta = systolics[-1] - systolics[0]
        avg_sys = sum(systolics) / len(systolics)
        if delta > 20 and systolics[-1] >= 140:
            signals.append(TrendSignal(
                name="bp_trend",
                direction="worsening",
                detail=(f"Systolic BP trending upward (+{delta:.0f} mmHg). "
                        f"Average: {avg_sys:.0f} mmHg. Current: {systolics[-1]} mmHg."),
                severity="flag",
            ))
        elif delta < -15 and systolics[-1] < 130:
            signals.append(TrendSignal(
                name="bp_trend",
                direction="improving",
                detail=f"Systolic BP improving ({delta:.0f} mmHg). Current: {systolics[-1]} mmHg.",
                severity="info",
            ))

    # Glucose trend from consultation text
    glu_series: List[float] = []
    for c in reversed(consultations):
        text = " ".join([c.get("summary") or "", " ".join(c.get("recommendations") or [])])
        glu_series.extend(_extract_glucose_values(text))

    if len(glu_series) >= 3:
        recent_glus = glu_series[-5:]
        delta = recent_glus[-1] - recent_glus[0]
        if delta > 50 and recent_glus[-1] >= 200:
            signals.append(TrendSignal(
                name="glucose_trend",
                direction="worsening",
                detail=(f"Glucose trending upward (+{delta:.0f} mg/dL over {len(recent_glus)} readings). "
                        f"Latest: {recent_glus[-1]:.0f} mg/dL."),
                severity="flag",
            ))
        elif delta < -40 and recent_glus[-1] < 126:
            signals.append(TrendSignal(
                name="glucose_trend",
                direction="improving",
                detail=f"Glucose improving ({delta:.0f} mg/dL). Latest: {recent_glus[-1]:.0f} mg/dL.",
                severity="info",
            ))

    return signals


# ─────────────────────────────────────────────────────────────────────────────
# [4] Visit frequency / engagement
# ─────────────────────────────────────────────────────────────────────────────

def _analyze_engagement(consultations: List[Dict]) -> Optional[TrendSignal]:
    if len(consultations) < 2:
        if not consultations:
            return TrendSignal(
                name="engagement",
                direction="worsening",
                detail="No consultation records found — patient may have never visited a facility.",
                severity="flag",
            )
        return None

    dates = [_parse_date(c.get("started_at")) for c in consultations]
    dates = [d for d in dates if d is not None]
    if len(dates) < 2:
        return None

    dates_sorted = sorted(dates)  # oldest → newest

    # Days between consecutive visits
    gaps = [(dates_sorted[i + 1] - dates_sorted[i]).days
            for i in range(len(dates_sorted) - 1)]

    avg_gap = sum(gaps) / len(gaps)
    latest_gap = (_today() - dates_sorted[-1]).days

    if latest_gap > 120:
        return TrendSignal(
            name="engagement",
            direction="worsening",
            detail=(f"Patient has not been seen for {latest_gap} days "
                    f"(average visit gap: {avg_gap:.0f} days)."),
            severity="flag",
        )
    elif latest_gap > 90:
        return TrendSignal(
            name="engagement",
            direction="worsening",
            detail=f"No visit in {latest_gap} days — overdue for scheduled NCD follow-up.",
            severity="watch",
        )

    # Check if gaps increasing over time (decreasing engagement)
    if len(gaps) >= 3:
        early_avg = sum(gaps[: len(gaps) // 2]) / (len(gaps) // 2)
        late_avg  = sum(gaps[len(gaps) // 2 :]) / max(1, len(gaps) - len(gaps) // 2)
        if late_avg > early_avg * 1.5 and late_avg > 60:
            return TrendSignal(
                name="engagement",
                direction="worsening",
                detail=(f"Visit frequency decreasing: recent avg gap {late_avg:.0f} days "
                        f"vs earlier {early_avg:.0f} days."),
                severity="watch",
            )

    return TrendSignal(
        name="engagement",
        direction="stable",
        detail=f"Regular engagement — last visit {latest_gap} days ago.",
        severity="info",
    )


# ─────────────────────────────────────────────────────────────────────────────
# Master function
# ─────────────────────────────────────────────────────────────────────────────

def analyze_trends(
    patient_id: str,
    patient_data: Dict[str, Any],
) -> TrendReport:
    """
    Analyze clinical trends from patient consultation history.

    patient_data = {
        "profile":       {...},
        "consultations": [{...}, ...],   # sorted newest-first
        "behavior":      {...},
    }
    """
    profile       = patient_data.get("profile", {})
    consultations = patient_data.get("consultations", [])
    behavior      = patient_data.get("behavior", {})

    signals: List[TrendSignal] = []

    # 1. Triage trend
    triage_sig = _analyze_triage_trend(consultations)
    if triage_sig:
        signals.append(triage_sig)

    # 2. Symptom recurrence + red flags
    symptom_sigs = _analyze_symptom_recurrence(consultations)
    signals.extend(symptom_sigs)

    # 3. Vital trends
    try:
        vital_sigs = _analyze_vital_trend(profile, consultations)
        signals.extend(vital_sigs)
    except Exception:
        pass  # vital trend is best-effort; don't break pipeline

    # 4. Engagement
    engagement_sig = _analyze_engagement(consultations)
    if engagement_sig:
        signals.append(engagement_sig)

    # 5. Behavior signal from Redis
    engagement_pattern = (behavior.get("engagement_pattern") or "").lower()
    if "disengaged" in engagement_pattern or "dropout" in engagement_pattern:
        signals.append(TrendSignal(
            name="behavior_engagement",
            direction="worsening",
            detail=f"Behavior profile indicates disengagement pattern: {engagement_pattern}.",
            severity="watch",
        ))

    # Compute overall trajectory
    severity_score = {"info": 0, "watch": 1, "flag": 2, "alert": 3}
    if signals:
        max_sev = max(severity_score.get(s.severity, 0) for s in signals)
    else:
        max_sev = 0

    direction_map = {
        "critical": "critical",
        "worsening": "worsening",
        "stable": "stable",
        "improving": "improving",
    }
    direction_scores = {"improving": -1, "stable": 0, "worsening": 1, "critical": 2}
    if signals:
        net = sum(direction_scores.get(s.direction, 0) for s in signals)
        if net >= 3 or any(s.direction == "critical" for s in signals):
            overall = "critical"
        elif net >= 1:
            overall = "worsening"
        elif net <= -1:
            overall = "improving"
        else:
            overall = "stable"
    else:
        overall = "stable"

    alert_count = sum(1 for s in signals if s.severity in ("flag", "alert"))

    # Summary
    if overall == "critical":
        summary = "Critical trends detected — immediate escalation required."
    elif overall == "worsening":
        worsening_names = [s.name for s in signals if s.direction in ("worsening", "critical")]
        summary = f"Deteriorating trends: {', '.join(worsening_names)}."
    elif overall == "improving":
        summary = "Positive trends — patient appears to be improving."
    else:
        summary = "Clinical trends are stable."

    return TrendReport(
        patient_id          = patient_id,
        computed_at         = _today().isoformat(),
        signals             = signals,
        overall_trajectory  = overall,
        alert_count         = alert_count,
        summary             = summary,
    )
