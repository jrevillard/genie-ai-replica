"""
Tier 5 — Caregiver Performance & Burnout Monitor
=================================================
Tracks CHW workload, complexity exposure, and task completion to compute a
burnout risk score and generate actionable performance recommendations.

Public API
----------
compute_burnout_risk(caregiver_id, panel_records, redis_client) -> BurnoutRisk
get_performance_report(caregiver_id, panel_records, redis_client) -> PerformanceReport
record_activity(caregiver_id, activity_type, redis_client) -> None
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass, field, asdict
from datetime import date, datetime, timedelta
from typing import Any, Optional

import redis as redis_lib

# ---------------------------------------------------------------------------
# WHO / programme thresholds
# ---------------------------------------------------------------------------
_WHO_MAX_PATIENTS        = 30    # recommended upper bound per CHW for high-complexity rural care
_HIGH_CRI_THRESHOLD      = 65    # CRI ≥ this → "high risk" patient
_CRITICAL_CRI_THRESHOLD  = 80    # CRI ≥ this → "critical" patient
_OVERDUE_TASK_WEIGHT     = 0.04  # burnout contribution per overdue task (max ~0.20)
_INACTIVITY_WARNING_DAYS = 7     # days without logged activity before flag fires

# Burnout score bands
_BURNOUT_BANDS = [
    (0.80, "critical",  "Immediate intervention required — supervisor review today"),
    (0.60, "high",      "Elevated burnout risk — schedule support check-in this week"),
    (0.40, "moderate",  "Moderate pressure — monitor and consider caseload adjustment"),
    (0.20, "elevated",  "Slightly above baseline — encourage peer support use"),
    (0.00, "normal",    "Caseload within healthy range"),
]

# Activity types tracked
ACTIVITY_VISIT      = "visit"
ACTIVITY_SOAP_NOTE  = "soap_note"
ACTIVITY_CHAT       = "chat"
ACTIVITY_TASK_DONE  = "task_done"
ACTIVITY_REFERRAL   = "referral"


# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------

@dataclass
class CaseloadMetrics:
    total_patients:         int
    high_risk_count:        int      # CRI ≥ 65
    critical_count:         int      # CRI ≥ 80
    avg_cri:                float
    avg_sdoh:               float
    high_risk_proportion:   float    # 0–1
    caseload_ratio:         float    # actual / WHO_MAX (>1.0 = over capacity)
    region_spread:          int      # number of distinct regions
    complexity_score:       float    # 0–1 composite


@dataclass
class TaskMetrics:
    overdue_count:          int
    completed_last_7d:      int
    completion_rate_7d:     float    # 0–1
    avg_task_age_days:      float    # average days tasks have been pending


@dataclass
class ActivityMetrics:
    visits_last_7d:         int
    soap_notes_last_7d:     int
    chats_last_7d:          int
    last_activity_date:     Optional[str]   # ISO date
    days_since_activity:    int
    inactivity_flag:        bool


@dataclass
class RiskFactor:
    factor:     str
    severity:   str      # "info" | "warning" | "critical"
    detail:     str


@dataclass
class BurnoutRisk:
    caregiver_id:       str
    computed_at:        str              # ISO datetime
    burnout_score:      float            # 0–1
    burnout_label:      str
    burnout_message:    str
    caseload:           CaseloadMetrics
    tasks:              TaskMetrics
    activity:           ActivityMetrics
    risk_factors:       list[RiskFactor]
    recommendations:    list[str]

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class PerformanceReport:
    caregiver_id:           str
    period_start:           str
    period_end:             str
    patients_managed:       int
    visits_completed:       int
    soap_notes_created:     int
    care_tasks_done:        int
    referrals_made:         int
    avg_response_hours:     float        # placeholder — derived from chat logs if available
    burnout_risk:           BurnoutRisk
    highlights:             list[str]    # positive achievements
    improvement_areas:      list[str]

    def to_dict(self) -> dict:
        d = asdict(self)
        d["burnout_risk"] = self.burnout_risk.to_dict()
        return d


# ---------------------------------------------------------------------------
# Caseload analyser
# ---------------------------------------------------------------------------

class CaseloadAnalyser:
    """Derives complexity and workload metrics from a CHW's patient panel."""

    def analyse(self, panel_records: list[dict]) -> CaseloadMetrics:
        if not panel_records:
            return CaseloadMetrics(0, 0, 0, 0.0, 0.0, 0.0, 0.0, 0, 0.0)

        total  = len(panel_records)
        cris   = []
        sdohs  = []
        high_risk   = 0
        critical    = 0
        regions: set[str] = set()

        for rec in panel_records:
            cri  = float(rec.get("cri",       rec.get("cri_score", 50)))
            sdoh = float(rec.get("sdoh_score", 0.50))
            cris.append(cri)
            sdohs.append(sdoh)
            if cri >= _CRITICAL_CRI_THRESHOLD:
                critical  += 1
                high_risk += 1
            elif cri >= _HIGH_CRI_THRESHOLD:
                high_risk += 1
            region = rec.get("region") or rec.get("patient_data", {}).get("region", "unknown")
            regions.add(region)

        avg_cri  = sum(cris)  / total
        avg_sdoh = sum(sdohs) / total

        # complexity_score: weighted blend of risk proportion + normalised avg CRI + SDOH
        hr_prop     = high_risk / total
        cri_norm    = avg_cri / 100.0
        complexity  = min(1.0, 0.40 * hr_prop + 0.40 * cri_norm + 0.20 * avg_sdoh)

        return CaseloadMetrics(
            total_patients       = total,
            high_risk_count      = high_risk,
            critical_count       = critical,
            avg_cri              = round(avg_cri, 1),
            avg_sdoh             = round(avg_sdoh, 3),
            high_risk_proportion = round(hr_prop, 3),
            caseload_ratio       = round(total / _WHO_MAX_PATIENTS, 2),
            region_spread        = len(regions),
            complexity_score     = round(complexity, 3),
        )


# ---------------------------------------------------------------------------
# Task metrics reader  (reads from Redis care-plan store)
# ---------------------------------------------------------------------------

class TaskMetricsReader:
    """Aggregates task states across all care plans owned by a caregiver."""

    def read(
        self,
        caregiver_id: str,
        panel_records: list[dict],
        redis_client: redis_lib.Redis,
        today: date,
    ) -> TaskMetrics:
        overdue_count  = 0
        completed_7d   = 0
        total_pending  = 0
        pending_ages: list[float] = []

        seven_days_ago = today - timedelta(days=7)
        cutoff_iso     = seven_days_ago.isoformat()

        for rec in panel_records:
            pid = rec.get("patient_id", rec.get("id", ""))
            if not pid:
                continue
            raw = redis_client.get(f"care_plan:{pid}")
            if not raw:
                continue
            try:
                plan = json.loads(raw)
            except Exception:
                continue

            for item in plan.get("items", []):
                status = item.get("status", "pending")
                due    = item.get("due_date", "")

                if status == "overdue":
                    overdue_count += 1

                if status == "completed" and item.get("completed_at", "") >= cutoff_iso:
                    completed_7d += 1

                if status in ("pending", "overdue"):
                    total_pending += 1
                    if due:
                        try:
                            due_date = date.fromisoformat(due)
                            age = (today - due_date).days
                            pending_ages.append(max(0, age))
                        except ValueError:
                            pass

        completion_rate = 0.0
        if total_pending + completed_7d > 0:
            completion_rate = completed_7d / (total_pending + completed_7d)

        avg_age = round(sum(pending_ages) / len(pending_ages), 1) if pending_ages else 0.0

        return TaskMetrics(
            overdue_count       = overdue_count,
            completed_last_7d   = completed_7d,
            completion_rate_7d  = round(completion_rate, 3),
            avg_task_age_days   = avg_age,
        )


# ---------------------------------------------------------------------------
# Activity tracker helpers  (Redis-based event log)
# ---------------------------------------------------------------------------

_ACT_KEY  = "chw_activity:{caregiver_id}"   # Redis sorted-set  score=unix_ts  member=json
_ACT_TTL  = 90 * 24 * 3600                  # keep 90 days of activity


def record_activity(
    caregiver_id: str,
    activity_type: str,
    redis_client: redis_lib.Redis,
    ts: Optional[datetime] = None,
) -> None:
    """Append an activity event to the caregiver's activity log."""
    now = ts or datetime.utcnow()
    key = _ACT_KEY.format(caregiver_id=caregiver_id)
    member = json.dumps({"type": activity_type, "ts": now.isoformat()})
    redis_client.zadd(key, {member: now.timestamp()})
    redis_client.expire(key, _ACT_TTL)


class ActivityReader:
    """Reads recent activity events from Redis for a caregiver."""

    def read(
        self,
        caregiver_id: str,
        redis_client: redis_lib.Redis,
        today: date,
    ) -> ActivityMetrics:
        key          = _ACT_KEY.format(caregiver_id=caregiver_id)
        seven_ago_ts = (datetime.combine(today, datetime.min.time()) - timedelta(days=7)).timestamp()
        now_ts       = datetime.utcnow().timestamp()

        # All events in last 7 days
        raw_7d = redis_client.zrangebyscore(key, seven_ago_ts, now_ts)
        visits_7d = soap_7d = chats_7d = 0
        for r in raw_7d:
            try:
                ev = json.loads(r)
                t  = ev.get("type", "")
                if t == ACTIVITY_VISIT:     visits_7d += 1
                elif t == ACTIVITY_SOAP_NOTE: soap_7d  += 1
                elif t == ACTIVITY_CHAT:    chats_7d   += 1
            except Exception:
                pass

        # Most recent event overall
        latest = redis_client.zrevrangebyscore(key, now_ts, 0, start=0, num=1)
        last_date_str   = None
        days_since      = _INACTIVITY_WARNING_DAYS + 1   # pessimistic default
        if latest:
            try:
                ev = json.loads(latest[0])
                last_dt    = datetime.fromisoformat(ev["ts"])
                last_date_str = last_dt.date().isoformat()
                days_since = (today - last_dt.date()).days
            except Exception:
                pass

        return ActivityMetrics(
            visits_last_7d      = visits_7d,
            soap_notes_last_7d  = soap_7d,
            chats_last_7d       = chats_7d,
            last_activity_date  = last_date_str,
            days_since_activity = days_since,
            inactivity_flag     = days_since >= _INACTIVITY_WARNING_DAYS,
        )


# ---------------------------------------------------------------------------
# Burnout risk scorer
# ---------------------------------------------------------------------------

class BurnoutRiskScorer:
    """
    Composite burnout score (0–1) from four dimensions:

      1. Caseload pressure  (0–1)  — caseload_ratio capped at 2× max
      2. Complexity burden  (0–1)  — high-CRI proportion + critical proportion
      3. Task backlog       (0–1)  — overdue count + low completion rate
      4. Inactivity signal  (0–1)  — days since last recorded activity

    Weights: 0.35 / 0.30 / 0.25 / 0.10
    """

    def score(
        self,
        caseload: CaseloadMetrics,
        tasks:    TaskMetrics,
        activity: ActivityMetrics,
    ) -> tuple[float, list[RiskFactor]]:
        factors: list[RiskFactor] = []

        # --- 1. Caseload pressure -------------------------------------------
        cr = min(1.0, caseload.caseload_ratio / 2.0)   # saturates at 2× WHO max
        if caseload.caseload_ratio > 1.5:
            factors.append(RiskFactor(
                "Caseload over capacity", "critical",
                f"{caseload.total_patients} patients — {caseload.caseload_ratio:.1f}× WHO recommended max ({_WHO_MAX_PATIENTS})"
            ))
        elif caseload.caseload_ratio > 1.0:
            factors.append(RiskFactor(
                "Caseload above recommended", "warning",
                f"{caseload.total_patients} patients ({caseload.caseload_ratio:.1f}× WHO max)"
            ))

        # --- 2. Complexity burden -------------------------------------------
        cx = min(1.0, caseload.high_risk_proportion * 1.5 + (caseload.critical_count / max(1, caseload.total_patients)) * 0.5)
        if caseload.critical_count >= 5:
            factors.append(RiskFactor(
                "High critical-patient load", "critical",
                f"{caseload.critical_count} patients with CRI ≥ 80 require intensive monitoring"
            ))
        elif caseload.high_risk_proportion > 0.40:
            factors.append(RiskFactor(
                "Elevated high-risk proportion", "warning",
                f"{caseload.high_risk_count} of {caseload.total_patients} patients ({caseload.high_risk_proportion:.0%}) are high-risk"
            ))

        if caseload.region_spread >= 4:
            factors.append(RiskFactor(
                "Wide geographic spread", "warning",
                f"Patients distributed across {caseload.region_spread} regions — significant travel burden"
            ))

        # --- 3. Task backlog ------------------------------------------------
        overdue_contrib = min(1.0, tasks.overdue_count * _OVERDUE_TASK_WEIGHT)
        completion_gap  = 1.0 - tasks.completion_rate_7d
        tb = min(1.0, overdue_contrib * 0.60 + completion_gap * 0.40)

        if tasks.overdue_count >= 10:
            factors.append(RiskFactor(
                "Critical task backlog", "critical",
                f"{tasks.overdue_count} overdue care tasks — patient safety risk"
            ))
        elif tasks.overdue_count >= 5:
            factors.append(RiskFactor(
                "Significant task backlog", "warning",
                f"{tasks.overdue_count} overdue care tasks, avg age {tasks.avg_task_age_days:.0f} days"
            ))

        if tasks.completion_rate_7d < 0.30 and tasks.completed_last_7d + tasks.overdue_count > 0:
            factors.append(RiskFactor(
                "Low task completion rate", "warning",
                f"Only {tasks.completion_rate_7d:.0%} of tasks completed in last 7 days"
            ))

        # --- 4. Inactivity signal -------------------------------------------
        ia = min(1.0, tasks.avg_task_age_days / 30.0) if activity.inactivity_flag else 0.0
        if activity.inactivity_flag:
            factors.append(RiskFactor(
                "Reduced activity detected", "warning",
                f"No activity logged in {activity.days_since_activity} days — possible disengagement or leave"
            ))

        # --- Composite ------------------------------------------------------
        burnout_score = min(1.0,
            0.35 * cr +
            0.30 * cx +
            0.25 * tb +
            0.10 * ia
        )
        return round(burnout_score, 3), factors


# ---------------------------------------------------------------------------
# Recommendation generator
# ---------------------------------------------------------------------------

def _make_recommendations(
    burnout_score: float,
    caseload:      CaseloadMetrics,
    tasks:         TaskMetrics,
    activity:      ActivityMetrics,
) -> list[str]:
    recs: list[str] = []

    if caseload.caseload_ratio > 1.0:
        recs.append(
            f"Discuss caseload rebalancing with supervisor — current panel ({caseload.total_patients}) "
            f"exceeds WHO guideline of {_WHO_MAX_PATIENTS} patients per CHW"
        )

    if caseload.critical_count >= 3:
        recs.append(
            f"Escalate {caseload.critical_count} critical patients (CRI ≥ 80) to clinical officer for shared management"
        )

    if tasks.overdue_count >= 5:
        recs.append(
            f"Prioritise clearing overdue task backlog ({tasks.overdue_count} tasks) — "
            "focus on immediate-priority items first"
        )

    if tasks.completion_rate_7d < 0.50:
        recs.append("Review care plan task feasibility — consider extending due dates for routine tasks")

    if activity.inactivity_flag:
        recs.append(
            f"Supervisor check-in recommended — no activity recorded for {activity.days_since_activity} days"
        )

    if caseload.region_spread >= 4:
        recs.append("Consider requesting motorbike fuel allowance or transport support given multi-region coverage")

    if burnout_score >= 0.60 and not activity.inactivity_flag:
        recs.append("Enrol in peer-support session this week — AMINA can help draft a caseload handover note")

    if burnout_score >= 0.80:
        recs.append(
            "URGENT: Request immediate caseload review and temporary patient redistribution — "
            "CHW wellbeing policy applies"
        )

    if not recs:
        recs.append("Maintain current routines — caseload and activity are within healthy range")

    return recs


# ---------------------------------------------------------------------------
# Highlights generator
# ---------------------------------------------------------------------------

def _make_highlights(
    tasks:    TaskMetrics,
    activity: ActivityMetrics,
    caseload: CaseloadMetrics,
) -> list[str]:
    highs: list[str] = []
    if tasks.completed_last_7d >= 10:
        highs.append(f"Strong task completion — {tasks.completed_last_7d} care tasks done this week")
    if tasks.completion_rate_7d >= 0.80:
        highs.append(f"Excellent task completion rate: {tasks.completion_rate_7d:.0%}")
    if activity.visits_last_7d >= 10:
        highs.append(f"High patient engagement — {activity.visits_last_7d} visits recorded this week")
    if activity.soap_notes_last_7d >= 5:
        highs.append(f"Good documentation — {activity.soap_notes_last_7d} SOAP notes submitted")
    if caseload.critical_count == 0 and caseload.total_patients > 0:
        highs.append("No critical patients this week — effective preventive care")
    if not highs:
        highs.append("Maintaining consistent care delivery")
    return highs


# ---------------------------------------------------------------------------
# Public interface
# ---------------------------------------------------------------------------

_caseload_analyser = CaseloadAnalyser()
_task_reader       = TaskMetricsReader()
_activity_reader   = ActivityReader()
_burnout_scorer    = BurnoutRiskScorer()


def compute_burnout_risk(
    caregiver_id:  str,
    panel_records: list[dict],
    redis_client:  redis_lib.Redis,
    today:         Optional[date] = None,
) -> BurnoutRisk:
    today = today or date.today()

    caseload = _caseload_analyser.analyse(panel_records)
    tasks    = _task_reader.read(caregiver_id, panel_records, redis_client, today)
    activity = _activity_reader.read(caregiver_id, redis_client, today)

    burnout_score, risk_factors = _burnout_scorer.score(caseload, tasks, activity)

    # Determine label + message
    label = message = ""
    for threshold, lbl, msg in _BURNOUT_BANDS:
        if burnout_score >= threshold:
            label   = lbl
            message = msg
            break

    recommendations = _make_recommendations(burnout_score, caseload, tasks, activity)

    return BurnoutRisk(
        caregiver_id    = caregiver_id,
        computed_at     = datetime.utcnow().isoformat(),
        burnout_score   = burnout_score,
        burnout_label   = label,
        burnout_message = message,
        caseload        = caseload,
        tasks           = tasks,
        activity        = activity,
        risk_factors    = risk_factors,
        recommendations = recommendations,
    )


def get_performance_report(
    caregiver_id:  str,
    panel_records: list[dict],
    redis_client:  redis_lib.Redis,
    today:         Optional[date] = None,
    period_days:   int = 7,
) -> PerformanceReport:
    today = today or date.today()
    period_start = (today - timedelta(days=period_days)).isoformat()
    period_end   = today.isoformat()

    burnout      = compute_burnout_risk(caregiver_id, panel_records, redis_client, today)
    activity     = burnout.activity
    tasks        = burnout.tasks
    caseload     = burnout.caseload

    highlights        = _make_highlights(tasks, activity, caseload)
    improvement_areas = [r for r in burnout.recommendations if "URGENT" not in r][:3]

    return PerformanceReport(
        caregiver_id        = caregiver_id,
        period_start        = period_start,
        period_end          = period_end,
        patients_managed    = caseload.total_patients,
        visits_completed    = activity.visits_last_7d,
        soap_notes_created  = activity.soap_notes_last_7d,
        care_tasks_done     = tasks.completed_last_7d,
        referrals_made      = 0,   # updated by caller when referral data is available
        avg_response_hours  = 0.0, # placeholder
        burnout_risk        = burnout,
        highlights          = highlights,
        improvement_areas   = improvement_areas,
    )
