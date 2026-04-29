"""
Tier 4 — Automated Care Protocol Engine
=========================================

Generates, schedules, and tracks individualised care plans for each patient.
Derives directly from EnrichedClinicalContext — no LLM calls.

Components:
  - ProtocolGenerator   : builds CarePlanItems from enriched clinical context
  - ProtocolScheduler   : assigns specific due dates based on risk + care gaps
  - ProtocolTracker     : stores, updates, and retrieves plan state in Redis
  - CarePlan / CarePlanItem dataclasses

Redis keys:
  care_plan:{patient_id}           → JSON CarePlan   (TTL 35 days)
  care_plan_hist:{patient_id}      → list of previous plans (TTL 90 days)
"""

from __future__ import annotations

import json
import uuid
from dataclasses import dataclass, field, asdict
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

import redis as redis_lib

# ─────────────────────────────────────────────────────────────────────────────
# Dataclasses
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class CarePlanItem:
    task_id:       str
    category:      str       # visit | medication | lab | monitoring | education | referral
    description:   str
    rationale:     str       # why this task was generated
    due_date:      str       # ISO date string
    priority:      str       # immediate | urgent | routine
    responsible:   str       # caregiver | chw | health_post | hospital
    status:        str       # pending | completed | overdue | skipped
    completed_at:  Optional[str] = None
    skipped_reason: Optional[str] = None


@dataclass
class CarePlan:
    plan_id:               str
    patient_id:            str
    caregiver_id:          str
    patient_name:          str
    generated_at:          str
    valid_until:           str        # 35 days from generation
    escalation_level:      str
    items:                 List[CarePlanItem] = field(default_factory=list)
    next_visit_date:       str = ""
    review_frequency_days: int = 7
    overall_status:        str = "on_track"   # on_track | behind | critical
    completion_pct:        float = 0.0
    overdue_count:         int = 0
    summary:               str = ""


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _days_from_now(days: int, base: datetime | None = None) -> str:
    base = base or datetime.now(tz=timezone.utc)
    return (base + timedelta(days=days)).strftime("%Y-%m-%d")


def _today(base: datetime | None = None) -> str:
    base = base or datetime.now(tz=timezone.utc)
    return base.strftime("%Y-%m-%d")


# ─────────────────────────────────────────────────────────────────────────────
# ProtocolGenerator
# ─────────────────────────────────────────────────────────────────────────────

class ProtocolGenerator:
    """
    Derives a structured list of CarePlanItems from an EnrichedClinicalContext.
    All logic is deterministic — no LLM calls.
    """

    def generate(
        self,
        patient_id:   str,
        patient_name: str,
        caregiver_id: str,
        enriched:     Any,     # EnrichedClinicalContext
        now:          datetime | None = None,
    ) -> CarePlan:
        now   = now or datetime.now(tz=timezone.utc)
        items: List[CarePlanItem] = []

        esc_level  = enriched.escalation.level       if enriched.escalation  else "self_care"
        score      = enriched.score_card
        gap_report = enriched.gap_report
        ddi_report = enriched.ddi_report
        trend      = enriched.trend_report
        cri_score  = getattr(enriched.predictive_risk, "cri", 0) if enriched.predictive_risk else 0
        sdoh       = enriched.sdoh_score

        # ── Visit scheduling ────────────────────────────────────────────────
        if esc_level == "emergency":
            visit_days = 0
        elif esc_level == "health_post":
            visit_days = 2
        elif esc_level == "chw_visit" or cri_score >= 65:
            visit_days = 5
        elif cri_score >= 45:
            visit_days = 10
        else:
            visit_days = 14

        # Seasonal SDOH adjustment — rainy season or poor access adds 2 days
        if sdoh and (sdoh.seasonal.is_rainy_season or sdoh.accessibility.access_label in ("poor", "critical")):
            visit_days = min(visit_days + 2, 21)

        items.append(CarePlanItem(
            task_id     = _new_id(),
            category    = "visit",
            description = (
                f"Schedule {'emergency' if visit_days == 0 else 'priority'} visit"
                if visit_days <= 2 else
                f"CHW/facility check-in within {visit_days} days"
            ),
            rationale   = f"Escalation level: {esc_level}. CRI: {cri_score:.0f}/100.",
            due_date    = _days_from_now(visit_days, now),
            priority    = "immediate" if visit_days == 0 else "urgent" if visit_days <= 5 else "routine",
            responsible = "hospital" if esc_level == "emergency" else "health_post" if esc_level == "health_post" else "caregiver",
            status      = "pending",
        ))

        # ── Medication / DDI tasks ──────────────────────────────────────────
        if ddi_report and ddi_report.alerts:
            for alert in ddi_report.alerts[:3]:
                sev   = alert.severity
                prio  = "immediate" if sev == "contraindicated" else "urgent" if sev == "major" else "routine"
                days  = 0 if sev == "contraindicated" else 2 if sev == "major" else 7
                items.append(CarePlanItem(
                    task_id     = _new_id(),
                    category    = "medication",
                    description = f"Review combination: {alert.drug_a} + {alert.drug_b} — {alert.management}",
                    rationale   = f"DDI severity: {sev}. Effect: {alert.effect}",
                    due_date    = _days_from_now(days, now),
                    priority    = prio,
                    responsible = "health_post",
                    status      = "pending",
                ))

        if score and score.adherence_score < 0.5:
            items.append(CarePlanItem(
                task_id     = _new_id(),
                category    = "medication",
                description = "Medication adherence counselling — identify and address barriers",
                rationale   = f"Adherence score {score.adherence_score:.0%} (target ≥ 80%).",
                due_date    = _days_from_now(visit_days, now),
                priority    = "urgent",
                responsible = "caregiver",
                status      = "pending",
            ))

        # ── Care gap tasks ──────────────────────────────────────────────────
        if gap_report and gap_report.gaps:
            for gap in gap_report.gaps[:4]:
                overdue_days = gap.days_overdue or 0
                if overdue_days > 30:
                    task_days, prio = 7, "urgent"
                elif overdue_days > 0:
                    task_days, prio = 14, "urgent"
                else:
                    task_days, prio = 21, "routine"
                items.append(CarePlanItem(
                    task_id     = _new_id(),
                    category    = gap.category,
                    description = gap.action,
                    rationale   = f"Overdue by {overdue_days} days" if overdue_days > 0 else "Due soon.",
                    due_date    = _days_from_now(task_days, now),
                    priority    = prio,
                    responsible = "health_post",
                    status      = "pending",
                ))

        # ── Vital monitoring ────────────────────────────────────────────────
        if score:
            if not score.bp_at_target:
                items.append(CarePlanItem(
                    task_id     = _new_id(),
                    category    = "monitoring",
                    description = "Record blood pressure at every contact (target < 140/90 mmHg)",
                    rationale   = "BP not at target per last reading.",
                    due_date    = _days_from_now(visit_days, now),
                    priority    = "urgent",
                    responsible = "caregiver",
                    status      = "pending",
                ))
            if not score.glucose_at_target:
                items.append(CarePlanItem(
                    task_id     = _new_id(),
                    category    = "monitoring",
                    description = "Check fasting blood glucose (target 4–7 mmol/L fasting)",
                    rationale   = "Glucose not at target per last reading.",
                    due_date    = _days_from_now(visit_days, now),
                    priority    = "urgent",
                    responsible = "caregiver",
                    status      = "pending",
                ))

        # ── Predictive / CRI tasks ──────────────────────────────────────────
        if cri_score >= 65 and enriched.predictive_risk:
            pr = enriched.predictive_risk
            for vf in pr.vital_forecasts:
                if vf.breaches_target:
                    items.append(CarePlanItem(
                        task_id     = _new_id(),
                        category    = "monitoring",
                        description = (
                            f"Predictive alert: {vf.vital} projected at {vf.projected_7d} in 7 days "
                            f"(slope {vf.slope_per_day:+.2f}/day) — increase monitoring frequency"
                        ),
                        rationale   = f"CRI {cri_score:.0f}/100. Forecast breaches target.",
                        due_date    = _days_from_now(3, now),
                        priority    = "urgent",
                        responsible = "caregiver",
                        status      = "pending",
                    ))

        # ── SDOH-specific tasks ─────────────────────────────────────────────
        if sdoh and sdoh.sdoh_recommendations:
            for rec in sdoh.sdoh_recommendations[:2]:
                items.append(CarePlanItem(
                    task_id     = _new_id(),
                    category    = "education",
                    description = rec,
                    rationale   = f"SDOH label: {sdoh.sdoh_label}.",
                    due_date    = _days_from_now(14, now),
                    priority    = "routine",
                    responsible = "caregiver",
                    status      = "pending",
                ))

        # ── PHQ-2 / mental health ───────────────────────────────────────────
        if score and score.phq2_proxy >= 3:
            items.append(CarePlanItem(
                task_id     = _new_id(),
                category    = "education",
                description = "Mental health screening positive — refer for mhGAP assessment at nearest health facility",
                rationale   = f"PHQ-2 proxy score {score.phq2_proxy}/6.",
                due_date    = _days_from_now(7, now),
                priority    = "urgent",
                responsible = "health_post",
                status      = "pending",
            ))

        # ── Sort: immediate → urgent → routine, then by due_date ───────────
        _prio_order = {"immediate": 0, "urgent": 1, "routine": 2}
        items.sort(key=lambda i: (_prio_order.get(i.priority, 9), i.due_date))

        # ── Review frequency based on risk ──────────────────────────────────
        if esc_level == "emergency" or cri_score >= 85:
            review_freq = 2
        elif esc_level in ("health_post", "chw_visit") or cri_score >= 65:
            review_freq = 7
        else:
            review_freq = 14

        # ── Plan summary ────────────────────────────────────────────────────
        n_immediate = sum(1 for i in items if i.priority == "immediate")
        n_urgent    = sum(1 for i in items if i.priority == "urgent")
        summary = (
            f"{len(items)} task(s): {n_immediate} immediate, {n_urgent} urgent. "
            f"Next visit by {_days_from_now(visit_days, now)}. "
            f"Review every {review_freq} days."
        )

        plan = CarePlan(
            plan_id              = f"CP-{patient_id[:6].upper()}-{now.strftime('%Y%m%d')}",
            patient_id           = patient_id,
            caregiver_id         = caregiver_id,
            patient_name         = patient_name,
            generated_at         = now.isoformat() + "Z",
            valid_until          = _days_from_now(35, now),
            escalation_level     = esc_level,
            items                = items,
            next_visit_date      = _days_from_now(visit_days, now),
            review_frequency_days= review_freq,
            overall_status       = "critical" if n_immediate > 0 else "behind" if n_urgent > 2 else "on_track",
            completion_pct       = 0.0,
            overdue_count        = 0,
            summary              = summary,
        )
        return plan


def _new_id() -> str:
    return uuid.uuid4().hex[:10]


# ─────────────────────────────────────────────────────────────────────────────
# ProtocolTracker  (Redis persistence)
# ─────────────────────────────────────────────────────────────────────────────

class ProtocolTracker:
    """
    Stores and retrieves care plans from Redis.
    Merges new plans with existing ones — completed tasks are never re-opened.
    """

    PLAN_TTL  = 60 * 60 * 24 * 35    # 35 days
    HIST_TTL  = 60 * 60 * 24 * 90    # 90 days

    def __init__(self, redis_client: redis_lib.Redis):
        self._r = redis_client

    def save(self, plan: CarePlan) -> None:
        key  = f"care_plan:{plan.patient_id}"
        data = json.dumps(asdict(plan))
        self._r.setex(key, self.PLAN_TTL, data)

    def load(self, patient_id: str) -> CarePlan | None:
        raw = self._r.get(f"care_plan:{patient_id}")
        if not raw:
            return None
        d = json.loads(raw)
        items = [CarePlanItem(**i) for i in d.pop("items", [])]
        return CarePlan(**d, items=items)

    def merge(self, new_plan: CarePlan) -> CarePlan:
        """
        Merge a freshly generated plan with the existing stored plan:
        - Keep completed / skipped tasks from the old plan.
        - Add new tasks not present in the old plan.
        - Refresh due dates on pending tasks that have changed.
        """
        existing = self.load(new_plan.patient_id)
        if not existing:
            self.save(new_plan)
            return new_plan

        # Index existing by description (close enough for dedup)
        existing_map = {i.description: i for i in existing.items}
        merged_items: List[CarePlanItem] = []

        for item in new_plan.items:
            if item.description in existing_map:
                old = existing_map[item.description]
                if old.status in ("completed", "skipped"):
                    merged_items.append(old)   # preserve completed status
                else:
                    merged_items.append(item)  # refresh due date / priority
            else:
                merged_items.append(item)      # new task

        new_plan.items = merged_items
        new_plan = _recompute_stats(new_plan)
        self.save(new_plan)
        return new_plan

    def complete_task(self, patient_id: str, task_id: str) -> CarePlan | None:
        plan = self.load(patient_id)
        if not plan:
            return None
        for item in plan.items:
            if item.task_id == task_id and item.status == "pending":
                item.status       = "completed"
                item.completed_at = datetime.now(tz=timezone.utc).isoformat() + "Z"
                break
        plan = _recompute_stats(plan)
        self.save(plan)
        return plan

    def skip_task(self, patient_id: str, task_id: str, reason: str = "") -> CarePlan | None:
        plan = self.load(patient_id)
        if not plan:
            return None
        for item in plan.items:
            if item.task_id == task_id and item.status == "pending":
                item.status        = "skipped"
                item.skipped_reason = reason
                break
        plan = _recompute_stats(plan)
        self.save(plan)
        return plan


def _recompute_stats(plan: CarePlan) -> CarePlan:
    today = _today()
    total     = len(plan.items)
    completed = sum(1 for i in plan.items if i.status == "completed")
    overdue   = sum(
        1 for i in plan.items
        if i.status == "pending" and i.due_date < today
    )
    plan.completion_pct = round(completed / total * 100, 1) if total > 0 else 0.0
    plan.overdue_count  = overdue

    # Update per-item overdue flag
    for item in plan.items:
        if item.status == "pending" and item.due_date < today:
            item.status = "overdue"

    if any(i.priority == "immediate" and i.status in ("pending", "overdue") for i in plan.items):
        plan.overall_status = "critical"
    elif overdue > 2 or plan.completion_pct < 30:
        plan.overall_status = "behind"
    else:
        plan.overall_status = "on_track"

    return plan


# ─────────────────────────────────────────────────────────────────────────────
# Public API
# ─────────────────────────────────────────────────────────────────────────────

_generator = ProtocolGenerator()


def generate_and_store_plan(
    patient_id:   str,
    patient_name: str,
    caregiver_id: str,
    enriched:     Any,
    redis_client: redis_lib.Redis,
) -> CarePlan:
    """Generate a care plan from enriched context and merge with any existing plan."""
    new_plan = _generator.generate(patient_id, patient_name, caregiver_id, enriched)
    tracker  = ProtocolTracker(redis_client)
    return tracker.merge(new_plan)


def get_care_plan(
    patient_id:   str,
    redis_client: redis_lib.Redis,
) -> CarePlan | None:
    """Retrieve the current care plan for a patient."""
    tracker = ProtocolTracker(redis_client)
    plan = tracker.load(patient_id)
    if plan:
        plan = _recompute_stats(plan)
    return plan


def complete_task(
    patient_id:   str,
    task_id:      str,
    redis_client: redis_lib.Redis,
) -> CarePlan | None:
    return ProtocolTracker(redis_client).complete_task(patient_id, task_id)


def skip_task(
    patient_id:   str,
    task_id:      str,
    reason:       str,
    redis_client: redis_lib.Redis,
) -> CarePlan | None:
    return ProtocolTracker(redis_client).skip_task(patient_id, task_id, reason)
