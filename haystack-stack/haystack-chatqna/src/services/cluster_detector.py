"""
Tier 3 — Population Cluster Intelligence Service
Detects symptom clusters, outbreak patterns, and produces CHW priority queues
across the caregiver's patient panel.

Components:
  - SymptomClusterDetector     : 7-day sliding window, symptom frequency aggregation
  - OutbreakPatternMatcher      : cholera / malaria / meningitis / respiratory signatures
  - CHWPatientPriorityQueue     : rank patients by CRI + urgency + SDOH vulnerability
  - RegionalHeatmapAggregator   : anonymised signals per region (for dashboard heatmap)
  - ProactiveBriefingScheduler  : weekly digest trigger logic
  - detect_clusters()           : master entry point
"""

from __future__ import annotations

import hashlib
import json
import math
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any, Optional

# ---------------------------------------------------------------------------
# Outbreak pattern signatures
# ---------------------------------------------------------------------------
# Each pattern is a dict of:
#   required_symptoms : symptoms that MUST appear (AND logic)
#   supporting        : symptoms that increase confidence (OR, each +weight)
#   min_cases         : minimum patient count to trigger alert
#   window_days       : how many days back to scan
#   severity          : "watch" / "alert" / "emergency"

_OUTBREAK_PATTERNS: list[dict] = [
    {
        "disease": "cholera",
        "required_symptoms": {"diarrhoea", "vomiting"},
        "supporting": {"dehydration", "watery stool", "rice water", "muscle cramps", "weakness"},
        "min_cases": 2,
        "window_days": 7,
        "severity": "emergency",
        "who_threshold": 1,   # WHO: even 1 suspected case is reportable in non-endemic setting
    },
    {
        "disease": "malaria",
        "required_symptoms": {"fever"},
        "supporting": {"chills", "rigors", "headache", "sweating", "fatigue", "anaemia", "jaundice", "vomiting"},
        "min_cases": 3,
        "window_days": 14,
        "severity": "alert",
        "who_threshold": 5,
    },
    {
        "disease": "meningitis",
        "required_symptoms": {"fever", "headache"},
        "supporting": {"neck stiffness", "photophobia", "rash", "vomiting", "confusion", "seizure"},
        "min_cases": 2,
        "window_days": 7,
        "severity": "emergency",
        "who_threshold": 1,
    },
    {
        "disease": "measles",
        "required_symptoms": {"fever", "rash"},
        "supporting": {"cough", "conjunctivitis", "runny nose", "koplik spots", "mouth sores"},
        "min_cases": 2,
        "window_days": 14,
        "severity": "alert",
        "who_threshold": 1,
    },
    {
        "disease": "acute_respiratory_illness",
        "required_symptoms": {"cough"},
        "supporting": {"fever", "difficulty breathing", "chest pain", "sore throat", "runny nose"},
        "min_cases": 5,
        "window_days": 7,
        "severity": "watch",
        "who_threshold": 10,
    },
    {
        "disease": "typhoid",
        "required_symptoms": {"fever"},
        "supporting": {"abdominal pain", "constipation", "diarrhoea", "headache", "weakness", "rose spots"},
        "min_cases": 3,
        "window_days": 14,
        "severity": "alert",
        "who_threshold": 3,
    },
    {
        "disease": "dengue",
        "required_symptoms": {"fever", "headache"},
        "supporting": {"eye pain", "joint pain", "muscle pain", "rash", "nausea", "bleeding"},
        "min_cases": 2,
        "window_days": 14,
        "severity": "alert",
        "who_threshold": 2,
    },
]

# Symptom keyword normalisation → canonical terms
_SYMPTOM_ALIASES: dict[str, str] = {
    "diarrhea": "diarrhoea",
    "loose stool": "diarrhoea",
    "watery stool": "watery stool",
    "stomachache": "abdominal pain",
    "stomach pain": "abdominal pain",
    "belly pain": "abdominal pain",
    "throwing up": "vomiting",
    "nausea/vomiting": "vomiting",
    "high temperature": "fever",
    "high temp": "fever",
    "pyrexia": "fever",
    "headache": "headache",
    "head pain": "headache",
    "stiff neck": "neck stiffness",
    "neck pain": "neck stiffness",
    "light sensitivity": "photophobia",
    "breathlessness": "difficulty breathing",
    "shortness of breath": "difficulty breathing",
    "sob": "difficulty breathing",
    "dyspnoea": "difficulty breathing",
    "runny nose": "runny nose",
    "coryza": "runny nose",
    "red eyes": "conjunctivitis",
    "eye redness": "conjunctivitis",
    "shivering": "chills",
    "rigors": "rigors",
    "tiredness": "fatigue",
    "weakness": "weakness",
    "rash": "rash",
    "skin rash": "rash",
    "spots": "rash",
}


def _normalise_symptom(raw: str) -> str:
    """Lower-case and map to canonical symptom name."""
    raw = raw.lower().strip()
    return _SYMPTOM_ALIASES.get(raw, raw)


def _extract_symptoms_from_text(text: str) -> set[str]:
    """
    Extract symptom mentions from free-text (consultation summary, caregiver notes).
    Uses keyword scanning; deliberately simple — no NLP dependency.
    """
    text_lower = text.lower()
    found: set[str] = set()

    # Collect all canonical symptom names from patterns + aliases
    all_terms: set[str] = set()
    for pat in _OUTBREAK_PATTERNS:
        all_terms.update(pat["required_symptoms"])
        all_terms.update(pat["supporting"])
    all_terms.update(_SYMPTOM_ALIASES.keys())
    all_terms.update(_SYMPTOM_ALIASES.values())

    for term in all_terms:
        if term and term in text_lower:
            found.add(_normalise_symptom(term))

    return found


# ---------------------------------------------------------------------------
# Dataclasses
# ---------------------------------------------------------------------------

@dataclass
class PatientSymptomSnapshot:
    patient_id: str
    patient_name: str
    region: str
    snapshot_date: str
    symptoms: set[str]
    urgency_score: float = 0.0
    cri: float = 0.0


@dataclass
class SymptomCluster:
    symptom: str
    patient_count: int
    patient_ids: list[str]
    frequency_7d: int
    frequency_14d: int
    is_trending: bool      # 14d→7d count increased
    trend_label: str       # "rising" / "stable" / "declining"


@dataclass
class OutbreakAlert:
    disease: str
    severity: str          # "watch" / "alert" / "emergency"
    confirmed_cases: int
    suspected_cases: list[str]   # anonymised patient IDs (hashed)
    region: str
    detected_at: str
    matched_symptoms: list[str]
    confidence: float      # 0-1
    action_required: str
    who_reportable: bool


@dataclass
class PriorityPatient:
    rank: int
    patient_id: str
    patient_name: str
    region: str
    composite_score: float      # CRI × SDOH × urgency weighted
    cri: float
    urgency_score: float
    sdoh_label: str
    top_flags: list[str]
    recommended_action: str


@dataclass
class RegionalHeatmapPoint:
    region: str
    patient_count: int          # de-identified total
    high_risk_count: int
    dominant_symptom: str
    alert_level: str            # "green" / "yellow" / "orange" / "red"


@dataclass
class WeeklyDigest:
    generated_at: str
    caregiver_id: str
    panel_size: int
    critical_patients: int
    new_outbreak_alerts: int
    top_symptoms: list[str]
    priority_queue: list[PriorityPatient]
    outbreak_alerts: list[OutbreakAlert]
    heatmap: list[RegionalHeatmapPoint]
    summary_text: str


@dataclass
class ClusterReport:
    generated_at: str
    panel_size: int
    symptom_clusters: list[SymptomCluster]
    outbreak_alerts: list[OutbreakAlert]
    priority_queue: list[PriorityPatient]
    heatmap: list[RegionalHeatmapPoint]
    has_emergency: bool
    has_alerts: bool
    alert_summary: str


# ---------------------------------------------------------------------------
# SymptomClusterDetector
# ---------------------------------------------------------------------------

class SymptomClusterDetector:
    """
    Aggregates symptom signals across a caregiver's patient panel
    using a 7-day and 14-day sliding window.
    """

    def detect(
        self,
        snapshots: list[PatientSymptomSnapshot],
        today: datetime | None = None,
    ) -> list[SymptomCluster]:
        today = today or datetime.utcnow()
        cutoff_7d  = today - timedelta(days=7)
        cutoff_14d = today - timedelta(days=14)

        counts_7d:  Counter[str] = Counter()
        counts_14d: Counter[str] = Counter()
        patients_per_symptom: dict[str, set[str]] = defaultdict(set)

        for snap in snapshots:
            try:
                snap_dt = datetime.fromisoformat(snap.snapshot_date.rstrip("Z"))
            except Exception:
                snap_dt = today  # treat as today if unparseable

            for sym in snap.symptoms:
                if snap_dt >= cutoff_7d:
                    counts_7d[sym] += 1
                if snap_dt >= cutoff_14d:
                    counts_14d[sym] += 1
                    patients_per_symptom[sym].add(snap.patient_id)

        clusters: list[SymptomCluster] = []
        for sym, cnt_14 in counts_14d.items():
            cnt_7 = counts_7d.get(sym, 0)
            # Trending: 7d count is more than half of 14d count (rate accelerating)
            is_trending = (cnt_7 / max(cnt_14, 1)) > 0.6
            if cnt_7 > cnt_14 / 2:
                trend_label = "rising"
            elif cnt_7 == 0:
                trend_label = "declining"
            else:
                trend_label = "stable"

            clusters.append(SymptomCluster(
                symptom=sym,
                patient_count=len(patients_per_symptom[sym]),
                patient_ids=list(patients_per_symptom[sym]),
                frequency_7d=cnt_7,
                frequency_14d=cnt_14,
                is_trending=is_trending,
                trend_label=trend_label,
            ))

        # Sort by 7d frequency descending
        clusters.sort(key=lambda c: (-c.frequency_7d, -c.patient_count))
        return clusters


# ---------------------------------------------------------------------------
# OutbreakPatternMatcher
# ---------------------------------------------------------------------------

class OutbreakPatternMatcher:
    """
    Checks symptom clusters against known outbreak signatures.
    Produces OutbreakAlert objects when thresholds are met.
    """

    @staticmethod
    def _anonymise(patient_id: str) -> str:
        """One-way hash for de-identification in public-facing reports."""
        return hashlib.sha256(patient_id.encode()).hexdigest()[:12]

    def match(
        self,
        snapshots: list[PatientSymptomSnapshot],
        today: datetime | None = None,
    ) -> list[OutbreakAlert]:
        today = today or datetime.utcnow()
        alerts: list[OutbreakAlert] = []

        for pattern in _OUTBREAK_PATTERNS:
            window_cutoff = today - timedelta(days=pattern["window_days"])
            required = pattern["required_symptoms"]
            supporting = pattern["supporting"]

            # Find patients within window who have all required symptoms
            matching_snaps: list[PatientSymptomSnapshot] = []
            for snap in snapshots:
                try:
                    snap_dt = datetime.fromisoformat(snap.snapshot_date.rstrip("Z"))
                except Exception:
                    snap_dt = today

                if snap_dt < window_cutoff:
                    continue

                # Check required symptoms (all must be present)
                if not required.issubset(snap.symptoms):
                    continue

                matching_snaps.append(snap)

            case_count = len(matching_snaps)

            # Apply WHO threshold (lower of min_cases and who_threshold)
            trigger_threshold = min(pattern["min_cases"], pattern.get("who_threshold", pattern["min_cases"]))

            if case_count < trigger_threshold:
                continue

            # Compute confidence: required match + supporting match ratio
            supporting_hits = sum(
                len(supporting & snap.symptoms) for snap in matching_snaps
            )
            max_supporting = len(supporting) * case_count if case_count > 0 else 1
            confidence = min(1.0, round(0.6 + 0.4 * (supporting_hits / max_supporting), 3))

            # Dominant region
            region_counter: Counter[str] = Counter(s.region for s in matching_snaps)
            dominant_region = region_counter.most_common(1)[0][0] if region_counter else "unknown"

            # Matched symptoms (union across all cases)
            all_matched: set[str] = set()
            for snap in matching_snaps:
                all_matched.update(required & snap.symptoms)
                all_matched.update(supporting & snap.symptoms)

            # Action text
            if pattern["severity"] == "emergency":
                action = (
                    f"IMMEDIATE: Notify district health officer. "
                    f"Isolate and refer all {case_count} suspected {pattern['disease'].replace('_',' ')} "
                    f"case(s) to {dominant_region} health facility."
                )
            elif pattern["severity"] == "alert":
                action = (
                    f"Notify CHW supervisor. Increase monitoring frequency. "
                    f"Collect samples for {pattern['disease'].replace('_',' ')} confirmation if available."
                )
            else:
                action = (
                    f"Flag for weekly review. Continue standard monitoring. "
                    f"Report if case count exceeds {pattern['min_cases'] * 2}."
                )

            alerts.append(OutbreakAlert(
                disease=pattern["disease"],
                severity=pattern["severity"],
                confirmed_cases=case_count,
                suspected_cases=[self._anonymise(s.patient_id) for s in matching_snaps],
                region=dominant_region,
                detected_at=today.isoformat() + "Z",
                matched_symptoms=sorted(all_matched),
                confidence=confidence,
                action_required=action,
                who_reportable=(case_count >= pattern.get("who_threshold", pattern["min_cases"])),
            ))

        # Sort: emergency first, then by confirmed case count
        _severity_order = {"emergency": 0, "alert": 1, "watch": 2}
        alerts.sort(key=lambda a: (_severity_order.get(a.severity, 9), -a.confirmed_cases))
        return alerts


# ---------------------------------------------------------------------------
# CHWPatientPriorityQueue
# ---------------------------------------------------------------------------

class CHWPatientPriorityQueue:
    """
    Ranks a caregiver's patients by composite risk score:
    CRI (Tier 1) × SDOH vulnerability (Tier 2) × urgency (Tier 0 pipeline)
    """

    def rank(
        self,
        patient_records: list[dict],
    ) -> list[PriorityPatient]:
        """
        Parameters
        ----------
        patient_records : list of dicts each with:
            patient_id, patient_name, region,
            cri (0-100), urgency_score (0-10),
            sdoh_label, sdoh_score (0-1),
            clinical_flags (list[str])
        """
        ranked: list[PriorityPatient] = []

        for rec in patient_records:
            cri           = float(rec.get("cri", 0))
            urgency       = float(rec.get("urgency_score", 0))
            sdoh_score    = float(rec.get("sdoh_score", 0.3))

            # Normalise to 0-1 ranges
            cri_n     = cri / 100.0
            urgency_n = urgency / 10.0

            # Composite: CRI 40%, urgency 40%, SDOH vulnerability 20%
            composite = round(0.40 * cri_n + 0.40 * urgency_n + 0.20 * sdoh_score, 4)

            flags = rec.get("clinical_flags", [])

            # Recommended action text
            if urgency >= 8 or cri >= 85:
                action = "Emergency — contact district health officer immediately"
            elif cri >= 65 or urgency >= 6:
                action = "Priority visit within 24 hours"
            elif cri >= 45 or urgency >= 4:
                action = "Schedule visit within 48-72 hours"
            else:
                action = "Routine monitoring — next scheduled visit"

            ranked.append(PriorityPatient(
                rank=0,  # filled after sort
                patient_id=rec["patient_id"],
                patient_name=rec.get("patient_name", "Unknown"),
                region=rec.get("region", "unknown"),
                composite_score=composite,
                cri=cri,
                urgency_score=urgency,
                sdoh_label=rec.get("sdoh_label", "unknown"),
                top_flags=flags[:3],
                recommended_action=action,
            ))

        ranked.sort(key=lambda p: -p.composite_score)
        for i, p in enumerate(ranked):
            p.rank = i + 1

        return ranked


# ---------------------------------------------------------------------------
# RegionalHeatmapAggregator
# ---------------------------------------------------------------------------

class RegionalHeatmapAggregator:
    """Produces anonymised per-region aggregate signals for the dashboard heatmap."""

    def aggregate(
        self,
        snapshots: list[PatientSymptomSnapshot],
        priority_queue: list[PriorityPatient],
    ) -> list[RegionalHeatmapPoint]:
        region_patients: dict[str, list[PatientSymptomSnapshot]] = defaultdict(list)
        region_high_risk: Counter[str] = Counter()
        region_symptoms: dict[str, Counter[str]] = defaultdict(Counter)

        for snap in snapshots:
            region_patients[snap.region].append(snap)
            for sym in snap.symptoms:
                region_symptoms[snap.region][sym] += 1

        # Count high-risk patients per region from priority queue
        for pp in priority_queue:
            if pp.composite_score >= 0.6 or pp.urgency_score >= 6:
                region_high_risk[pp.region] += 1

        points: list[RegionalHeatmapPoint] = []
        for region, snaps in region_patients.items():
            n_total   = len(snaps)
            n_high    = region_high_risk.get(region, 0)
            sym_count = region_symptoms[region]
            top_sym   = sym_count.most_common(1)[0][0] if sym_count else "none"

            high_ratio = n_high / max(n_total, 1)
            if high_ratio >= 0.5:
                alert_level = "red"
            elif high_ratio >= 0.30:
                alert_level = "orange"
            elif high_ratio >= 0.15:
                alert_level = "yellow"
            else:
                alert_level = "green"

            points.append(RegionalHeatmapPoint(
                region=region,
                patient_count=n_total,
                high_risk_count=n_high,
                dominant_symptom=top_sym,
                alert_level=alert_level,
            ))

        points.sort(key=lambda p: (
            {"red": 0, "orange": 1, "yellow": 2, "green": 3}.get(p.alert_level, 9),
            -p.high_risk_count,
        ))
        return points


# ---------------------------------------------------------------------------
# ProactiveBriefingScheduler
# ---------------------------------------------------------------------------

class ProactiveBriefingScheduler:
    """
    Decides whether to trigger a proactive weekly digest.
    Uses Redis sorted set convention compatible with existing nudge_scheduler pattern.
    Avoids any background daemon — purely lazy/pull model.
    """

    DIGEST_INTERVAL_HOURS = 168  # 7 days

    def should_trigger(
        self,
        caregiver_id: str,
        last_digest_iso: str | None,
        has_emergency_alert: bool,
        today: datetime | None = None,
    ) -> bool:
        """
        Returns True if a fresh digest should be generated.
        Triggers immediately if there is an emergency alert, regardless of schedule.
        """
        today = today or datetime.utcnow()

        if has_emergency_alert:
            return True

        if last_digest_iso is None:
            return True  # First time

        try:
            last = datetime.fromisoformat(last_digest_iso.rstrip("Z"))
            hours_elapsed = (today - last).total_seconds() / 3600
            return hours_elapsed >= self.DIGEST_INTERVAL_HOURS
        except Exception:
            return True

    def build_summary_text(
        self,
        panel_size: int,
        critical_count: int,
        alerts: list[OutbreakAlert],
        priority_queue: list[PriorityPatient],
    ) -> str:
        lines = [f"Weekly briefing — {panel_size} patients in your panel."]

        if critical_count > 0:
            lines.append(
                f"{critical_count} patient(s) require priority attention within 24 hours."
            )

        emergency_alerts = [a for a in alerts if a.severity == "emergency"]
        watch_alerts     = [a for a in alerts if a.severity in ("alert", "watch")]

        if emergency_alerts:
            for a in emergency_alerts:
                lines.append(
                    f"EMERGENCY: {a.confirmed_cases} suspected {a.disease.replace('_',' ')} case(s) "
                    f"detected in {a.region}. {a.action_required}"
                )
        if watch_alerts:
            for a in watch_alerts:
                lines.append(
                    f"Alert: {a.confirmed_cases} {a.disease.replace('_',' ')} case(s) "
                    f"detected — monitor and report if numbers rise."
                )

        if priority_queue:
            top = priority_queue[0]
            lines.append(
                f"Highest priority patient: {top.patient_name} "
                f"(CRI {top.cri:.0f}, urgency {top.urgency_score:.0f}/10). "
                f"Recommended: {top.recommended_action}."
            )

        if not emergency_alerts and not watch_alerts and critical_count == 0:
            lines.append("No outbreak signals detected. Panel is stable.")

        return " ".join(lines)


# ---------------------------------------------------------------------------
# Singletons
# ---------------------------------------------------------------------------
_cluster_detector  = SymptomClusterDetector()
_outbreak_matcher  = OutbreakPatternMatcher()
_priority_queue    = CHWPatientPriorityQueue()
_heatmap_agg       = RegionalHeatmapAggregator()
_briefing_sched    = ProactiveBriefingScheduler()


# ---------------------------------------------------------------------------
# Master entry point
# ---------------------------------------------------------------------------

def detect_clusters(
    patient_records: list[dict],
    today: datetime | None = None,
) -> ClusterReport:
    """
    Run full Tier 3 cluster detection across a caregiver's patient panel.

    Parameters
    ----------
    patient_records : list of dicts, each with:
        - patient_id       (str)
        - patient_name     (str)
        - region           (str)
        - cri              (float 0-100)
        - urgency_score    (float 0-10)
        - sdoh_label       (str)
        - sdoh_score       (float 0-1)
        - clinical_flags   (list[str])
        - recent_symptoms  (list[str])  — free-text or tokenised
        - last_visit_date  (str ISO)    — used as snapshot date

    Returns
    -------
    ClusterReport
    """
    today = today or datetime.utcnow()

    # Build PatientSymptomSnapshot list
    snapshots: list[PatientSymptomSnapshot] = []
    for rec in patient_records:
        raw_syms = rec.get("recent_symptoms", [])
        if isinstance(raw_syms, str):
            sym_set = _extract_symptoms_from_text(raw_syms)
        elif isinstance(raw_syms, list):
            sym_set = set()
            for s in raw_syms:
                sym_set.add(_normalise_symptom(str(s)))
                sym_set.update(_extract_symptoms_from_text(str(s)))
        else:
            sym_set = set()

        snapshots.append(PatientSymptomSnapshot(
            patient_id=rec.get("patient_id", ""),
            patient_name=rec.get("patient_name", "Unknown"),
            region=str(rec.get("region", "unknown")).lower(),
            snapshot_date=rec.get("last_visit_date", today.isoformat()),
            symptoms=sym_set,
            urgency_score=float(rec.get("urgency_score", 0)),
            cri=float(rec.get("cri", 0)),
        ))

    symptom_clusters = _cluster_detector.detect(snapshots, today)
    outbreak_alerts  = _outbreak_matcher.match(snapshots, today)
    priority_queue   = _priority_queue.rank(patient_records)
    heatmap          = _heatmap_agg.aggregate(snapshots, priority_queue)

    has_emergency = any(a.severity == "emergency" for a in outbreak_alerts)
    has_alerts    = bool(outbreak_alerts)

    critical_count = sum(1 for p in priority_queue if p.composite_score >= 0.6)

    if has_emergency:
        alert_summary = (
            f"EMERGENCY: {sum(1 for a in outbreak_alerts if a.severity == 'emergency')} "
            "outbreak alert(s) require immediate action. "
            f"{critical_count} patient(s) at critical risk."
        )
    elif has_alerts:
        alert_summary = (
            f"{len(outbreak_alerts)} cluster alert(s) detected. "
            f"{critical_count} patient(s) at elevated risk."
        )
    else:
        alert_summary = (
            f"No outbreak signals. Panel of {len(patient_records)} patient(s) is stable. "
            f"{critical_count} patient(s) at elevated risk requiring monitoring."
        )

    return ClusterReport(
        generated_at=today.isoformat() + "Z",
        panel_size=len(patient_records),
        symptom_clusters=symptom_clusters,
        outbreak_alerts=outbreak_alerts,
        priority_queue=priority_queue,
        heatmap=heatmap,
        has_emergency=has_emergency,
        has_alerts=has_alerts,
        alert_summary=alert_summary,
    )


def build_weekly_digest(
    caregiver_id: str,
    patient_records: list[dict],
    last_digest_iso: str | None = None,
    today: datetime | None = None,
) -> WeeklyDigest | None:
    """
    Build a WeeklyDigest if the schedule warrants it, or if there are emergencies.
    Returns None if no digest is due.
    """
    today = today or datetime.utcnow()
    report = detect_clusters(patient_records, today)

    if not _briefing_sched.should_trigger(caregiver_id, last_digest_iso, report.has_emergency, today):
        return None

    critical_count = sum(1 for p in report.priority_queue if p.composite_score >= 0.6)
    top_symptoms = [c.symptom for c in report.symptom_clusters[:5]]

    summary_text = _briefing_sched.build_summary_text(
        len(patient_records),
        critical_count,
        report.outbreak_alerts,
        report.priority_queue,
    )

    return WeeklyDigest(
        generated_at=today.isoformat() + "Z",
        caregiver_id=caregiver_id,
        panel_size=len(patient_records),
        critical_patients=critical_count,
        new_outbreak_alerts=len(report.outbreak_alerts),
        top_symptoms=top_symptoms,
        priority_queue=report.priority_queue,
        outbreak_alerts=report.outbreak_alerts,
        heatmap=report.heatmap,
        summary_text=summary_text,
    )
