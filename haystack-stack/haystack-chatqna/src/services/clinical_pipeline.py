"""
Clinical Pipeline — AMINA Caregiver Intelligence
=================================================

Orchestrates the four golden-standard rule-based services into a single
enriched clinical context object, then generates a SOAP-format report via LLM.

Architecture (Step 1 of caregiver pipeline — zero extra LLM calls):

  patient_data
       │
       ├── clinical_scoring.py   → ClinicalScoreCard
       ├── care_gap_detector.py  → CareGapReport
       ├── ddi_checker.py        → DDIReport
       └── trend_analyzer.py     → TrendReport
       │
       ▼
  EnrichedClinicalContext
       │
       ├── [escalation rule engine]  → EscalationDecision  (deterministic)
       └── [SOAP generator]          → SOAPNote            (1 LLM call)

SOAP sections:
  S — Subjective  (caregiver's report + patient context)
  O — Objective   (vitals, scores, clinical measurements)
  A — Assessment  (LLM-generated synthesis — the only LLM call)
  P — Plan        (deterministic care tasks + gap closures)

Escalation levels (WHO PEN / Gambia MOH alignment):
  self_care   — reinforce home management
  chw_visit   — community health worker follow-up within 7 days
  health_post — attend nearest health post within 48 h
  emergency   — immediate referral to hospital / call 1666
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from openai import AsyncOpenAI

logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────────────────────
# Dataclasses
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class SOAPNote:
    subjective:  str = ""
    objective:   str = ""
    assessment:  str = ""  # LLM-generated
    plan:        str = ""


@dataclass
class CareTask:
    priority:    str        # "immediate" | "urgent" | "routine"
    category:    str        # "medication" | "vitals" | "lab" | "referral" | "education"
    action:      str
    timeframe:   str        # e.g. "within 24 h", "next visit", "monthly"
    responsible: str        # "caregiver" | "chw" | "health_post" | "hospital"


@dataclass
class EscalationDecision:
    level:        str       # "self_care"|"chw_visit"|"health_post"|"emergency"
    triggered_by: List[str] = field(default_factory=list)
    message:      str = ""  # human-readable instruction for caregiver


@dataclass
class EnrichedClinicalContext:
    """All clinical intelligence for one patient/conversation turn."""
    patient_id:        str
    urgency_score:     int          # 0-10 (from deterioration_risk)
    escalation:        EscalationDecision
    soap_note:         SOAPNote
    care_tasks:        List[CareTask]
    clinical_flags:    List[str]    # all flags merged from all services
    # Service outputs (attached for API response)
    score_card:        Optional[Any] = None   # ClinicalScoreCard
    gap_report:        Optional[Any] = None   # CareGapReport
    ddi_report:        Optional[Any] = None   # DDIReport
    trend_report:      Optional[Any] = None   # TrendReport
    # Tier 1+2 outputs
    predictive_risk:   Optional[Any] = None   # PredictiveRiskCard
    sdoh_score:        Optional[Any] = None   # SDOHScore


# ─────────────────────────────────────────────────────────────────────────────
# Escalation rule engine (8 deterministic rules)
# ─────────────────────────────────────────────────────────────────────────────

def _apply_escalation_rules(
    score_card: Any,   # ClinicalScoreCard
    gap_report:  Any,  # CareGapReport
    ddi_report:  Any,  # DDIReport
    trend_report: Any, # TrendReport
) -> EscalationDecision:
    """
    8 escalation rules — first match wins (highest severity).
    """
    triggers: List[str] = []
    level = "self_care"

    # ── Rule 1: NEWS2 proxy critical (≥ 7) → emergency ───────────────────────
    if score_card.news2_proxy >= 7:
        triggers.append(f"NEWS2 proxy score {score_card.news2_proxy} (critical threshold ≥7)")
        level = "emergency"

    # ── Rule 2: Contraindicated DDI → emergency ───────────────────────────────
    if ddi_report.contraindicated_count > 0:
        drug_pair = ddi_report.alerts[0] if ddi_report.alerts else None
        triggers.append(
            f"Contraindicated drug combination: "
            f"{drug_pair.drug_a} + {drug_pair.drug_b}" if drug_pair else
            "Contraindicated drug-drug interaction detected"
        )
        level = "emergency"

    # ── Rule 3: Critical trend trajectory → emergency ─────────────────────────
    if trend_report.overall_trajectory == "critical":
        triggers.append("Critical deterioration trend in clinical history")
        level = "emergency"

    # ── Rule 4: Any flag with crisis keywords → emergency ────────────────────
    emergency_keywords = [
        "hypertensive crisis", "hypoglycaemia", "hypotension",
        "severe hyperglycaemia", "suicidal", "cannot breathe",
        "collapsed", "unconscious", "red-flag symptoms",
    ]
    all_flags = " ".join(score_card.flags + getattr(trend_report, "summary", "").split()).lower()
    for kw in emergency_keywords:
        if kw in all_flags:
            triggers.append(f"Emergency flag: {kw}")
            level = "emergency"
            break

    # ── Rule 5: NEWS2 ≥ 5 OR deterioration ≥ 7 → health_post ────────────────
    if level == "self_care":
        if score_card.news2_proxy >= 5 or score_card.deterioration_risk >= 7:
            triggers.append(
                f"NEWS2={score_card.news2_proxy}, deterioration={score_card.deterioration_risk}"
            )
            level = "health_post"

    # ── Rule 6: Major DDI or poor adherence → health_post ────────────────────
    if level == "self_care":
        if ddi_report.major_count >= 2 or score_card.adherence_score < 0.3:
            triggers.append(
                f"Major DDIs={ddi_report.major_count}, adherence={score_card.adherence_score:.2f}"
            )
            level = "health_post"

    # ── Rule 7: Urgent care gaps or worsening trend → chw_visit ──────────────
    if level == "self_care":
        if gap_report.urgent_count >= 2 or trend_report.overall_trajectory == "worsening":
            triggers.append(
                f"Urgent care gaps={gap_report.urgent_count}, "
                f"trend={trend_report.overall_trajectory}"
            )
            level = "chw_visit"

    # ── Rule 8: Any care gap or moderate risk → chw_visit ────────────────────
    if level == "self_care":
        if (gap_report.urgent_count >= 1 or gap_report.due_count >= 2 or
                score_card.deterioration_risk >= 4):
            triggers.append("Care gaps present or moderate deterioration risk")
            level = "chw_visit"

    # Build caregiver message
    messages = {
        "emergency": (
            "⚠️ URGENT: This patient needs immediate medical attention. "
            "Contact the emergency line (1666) or bring them to the nearest hospital now."
        ),
        "health_post": (
            "This patient should visit the nearest health post within 48 hours. "
            "Please arrange transport and bring their medication list."
        ),
        "chw_visit": (
            "A community health worker should visit this patient within the next 7 days "
            "to assess and provide support."
        ),
        "self_care": (
            "Continue current management. Reinforce medication adherence, "
            "diet, and healthy behaviours. Next scheduled visit at health post."
        ),
    }

    return EscalationDecision(
        level        = level,
        triggered_by = triggers,
        message      = messages[level],
    )


# ─────────────────────────────────────────────────────────────────────────────
# SOAP — Subjective + Objective sections (deterministic)
# ─────────────────────────────────────────────────────────────────────────────

def _build_subjective(
    patient_name: str,
    caregiver_name: str,
    caregiver_statements: List[str],
    info_state: Dict,
) -> str:
    lines = [f"Caregiver report for {patient_name} (reported by {caregiver_name}):"]
    for stmt in caregiver_statements[-6:]:  # last 6 caregiver messages
        lines.append(f"  • {stmt}")
    if info_state.get("summary_of_known"):
        lines.append(f"\nSummary: {info_state['summary_of_known']}")
    return "\n".join(lines)


def _build_objective(
    score_card: Any,
    gap_report: Any,
    ddi_report: Any,
    trend_report: Any,
    predictive_risk: Any = None,
    sdoh_score: Any = None,
) -> str:
    lines = []

    # Clinical scores
    lines.append("CLINICAL SCORES")
    lines.append(f"  NEWS2 proxy        : {score_card.news2_proxy}  "
                 f"({'≥7 critical' if score_card.news2_proxy >= 7 else '≥5 high' if score_card.news2_proxy >= 5 else 'within range'})")
    lines.append(f"  Adherence score    : {score_card.adherence_score:.0%}  "
                 f"({'poor' if score_card.adherence_score < 0.5 else 'acceptable'})")
    lines.append(f"  PHQ-2 proxy        : {score_card.phq2_proxy}/6  "
                 f"({'screen positive' if score_card.phq2_proxy >= 3 else 'negative'})")
    lines.append(f"  Deterioration risk : {score_card.deterioration_risk}/10  "
                 f"[{score_card.risk_label.upper()}]")
    lines.append(f"  BP at target       : {'Yes' if score_card.bp_at_target else 'No'}")
    lines.append(f"  Glucose at target  : {'Yes' if score_card.glucose_at_target else 'No'}")
    if score_card.hba1c_at_target is not None:
        lines.append(f"  HbA1c at target    : {'Yes' if score_card.hba1c_at_target else 'No'}")

    # Care gaps
    if gap_report.gaps:
        lines.append(f"\nCARE GAPS ({gap_report.urgent_count} urgent, {gap_report.due_count} due)")
        for g in gap_report.gaps[:5]:
            overdue_str = f" — {g.days_overdue} days overdue" if g.days_overdue > 0 else " — due soon"
            lines.append(f"  [{g.priority.upper()}] {g.item}{overdue_str}")

    # DDI
    if ddi_report.alerts:
        lines.append(f"\nDRUG-DRUG INTERACTIONS ({len(ddi_report.alerts)} detected)")
        for a in ddi_report.alerts[:3]:
            lines.append(f"  [{a.severity.upper()}] {a.drug_a} + {a.drug_b}: {a.effect}")

    # Trends
    if trend_report.signals:
        lines.append(f"\nCLINICAL TRENDS (overall: {trend_report.overall_trajectory.upper()})")
        for sig in trend_report.signals[:4]:
            lines.append(f"  [{sig.severity.upper()}] {sig.name}: {sig.detail}")

    # Clinical flags
    if score_card.flags:
        lines.append(f"\nCLINICAL FLAGS")
        for f in score_card.flags[:6]:
            lines.append(f"  ⚑ {f}")

    # Tier 1 — Predictive Risk
    if predictive_risk:
        lines.append(f"\nPREDICTIVE RISK (CRI)")
        lines.append(f"  CRI score         : {predictive_risk.cri:.0f}/100  [{predictive_risk.cri_label.upper()}]")
        lines.append(f"  Escalation prob   : {predictive_risk.escalation_prob:.0%}")
        lines.append(f"  Adherence decay   : {predictive_risk.adherence_decay:.0%} of baseline")
        if predictive_risk.vital_forecasts:
            lines.append("  7-day vital forecasts:")
            for vf in predictive_risk.vital_forecasts[:3]:
                breach = " ⚠ WILL BREACH TARGET" if vf.breaches_target else ""
                lines.append(
                    f"    {vf.vital}: {vf.current} → {vf.projected_7d} "
                    f"(slope {vf.slope_per_day:+.2f}/day){breach}"
                )
        if predictive_risk.warnings:
            lines.append("  Warnings:")
            for w in predictive_risk.warnings[:3]:
                lines.append(f"    ⚠ {w}")

    # Tier 2 — SDOH
    if sdoh_score:
        lines.append(f"\nSDOH VULNERABILITY")
        lines.append(
            f"  Overall SDOH      : {sdoh_score.overall_sdoh_score:.2f}  [{sdoh_score.sdoh_label.upper()}]"
        )
        lines.append(
            f"  Access            : {sdoh_score.accessibility.access_label}  "
            f"({sdoh_score.accessibility.travel_minutes_current} min to {sdoh_score.accessibility.nearest_facility})"
        )
        if sdoh_score.seasonal.active_risks:
            for risk in sdoh_score.seasonal.active_risks[:2]:
                lines.append(f"  Seasonal risk     : {risk}")
        if sdoh_score.sdoh_flags:
            for flag in sdoh_score.sdoh_flags[:3]:
                lines.append(f"  ⚑ {flag}")

    return "\n".join(lines)


# ─────────────────────────────────────────────────────────────────────────────
# Care tasks (deterministic, from gap report + escalation)
# ─────────────────────────────────────────────────────────────────────────────

_ESCALATION_TIMEFRAMES = {
    "emergency":   "immediately",
    "health_post": "within 48 h",
    "chw_visit":   "within 7 days",
    "self_care":   "next scheduled visit",
}

_ESCALATION_RESPONSIBLE = {
    "emergency":   "hospital",
    "health_post": "health_post",
    "chw_visit":   "chw",
    "self_care":   "caregiver",
}


def _build_care_tasks(
    escalation: EscalationDecision,
    gap_report: Any,
    ddi_report: Any,
    score_card: Any,
) -> List[CareTask]:
    tasks: List[CareTask] = []

    # Escalation task
    if escalation.level != "self_care":
        tasks.append(CareTask(
            priority    = "immediate" if escalation.level == "emergency" else "urgent",
            category    = "referral",
            action      = escalation.message,
            timeframe   = _ESCALATION_TIMEFRAMES[escalation.level],
            responsible = _ESCALATION_RESPONSIBLE[escalation.level],
        ))

    # DDI management tasks
    for alert in ddi_report.alerts[:2]:
        if alert.severity in ("contraindicated", "major"):
            tasks.append(CareTask(
                priority    = "immediate",
                category    = "medication",
                action      = f"Alert prescriber: {alert.drug_a} + {alert.drug_b}. "
                              f"{alert.management}",
                timeframe   = "within 24 h",
                responsible = "health_post",
            ))

    # Adherence task
    if score_card.adherence_score < 0.5:
        tasks.append(CareTask(
            priority    = "urgent",
            category    = "medication",
            action      = "Address medication non-adherence: identify barriers (cost, side effects, "
                          "forgetting). Pill organiser or family reminder may help.",
            timeframe   = "this visit",
            responsible = "caregiver",
        ))

    # Care gap tasks (urgent only, max 3)
    for gap in gap_report.gaps:
        if gap.priority == "urgent" and len(tasks) < 6:
            tasks.append(CareTask(
                priority    = "urgent",
                category    = gap.category,
                action      = gap.action,
                timeframe   = "within 2 weeks",
                responsible = "health_post",
            ))

    # Due gap tasks (max 2 more)
    for gap in gap_report.gaps:
        if gap.priority == "due" and len(tasks) < 7:
            tasks.append(CareTask(
                priority    = "routine",
                category    = gap.category,
                action      = gap.action,
                timeframe   = "next scheduled visit",
                responsible = "health_post",
            ))

    return tasks


def _build_plan_text(
    care_tasks: List[CareTask],
    sdoh_score: Any = None,
    predictive_risk: Any = None,
) -> str:
    lines = []
    if not care_tasks:
        lines.append("Continue current management. No immediate actions required.")
    else:
        for i, t in enumerate(care_tasks, 1):
            lines.append(f"{i}. [{t.priority.upper()}] [{t.category}] {t.action}  "
                         f"(timeframe: {t.timeframe} / {t.responsible})")

    # Append SDOH escalation pathway
    if sdoh_score and sdoh_score.escalation_pathway:
        lines.append(f"\nSDOH REFERRAL PATHWAY: {sdoh_score.escalation_pathway}")

    # Append SDOH recommendations
    if sdoh_score and sdoh_score.sdoh_recommendations:
        lines.append("SDOH ACTIONS:")
        for rec in sdoh_score.sdoh_recommendations[:3]:
            lines.append(f"  • {rec}")

    # Append CRI trajectory note
    if predictive_risk and predictive_risk.cri >= 45:
        lines.append(
            f"\nPREDICTIVE NOTE: CRI {predictive_risk.cri:.0f}/100 — "
            f"7-day deterioration probability {predictive_risk.escalation_prob:.0%}. "
            "Increase monitoring frequency."
        )

    return "\n".join(lines)


# ─────────────────────────────────────────────────────────────────────────────
# Assessment — LLM call (the only one in the golden-standard pipeline)
# ─────────────────────────────────────────────────────────────────────────────

_ASSESSMENT_SYSTEM = """You are a clinical decision support system writing the Assessment section
of a SOAP note for a community health worker in The Gambia.

You will be given structured clinical data (scores, gaps, trends, drug interactions)
and the caregiver's report. Write a concise, clinical Assessment section (3-5 sentences) that:

1. States the patient's overall clinical status and risk level.
2. Identifies the 2-3 most important active clinical problems.
3. Names the primary driver of any deterioration or stability.
4. Flags any urgent safety concerns (DDI, uncontrolled vitals, rapid deterioration).

Be direct and clinical. Ground every statement in the provided data.
Do NOT invent findings. Use plain English — no jargon that a CHW cannot understand.
Respond with only the Assessment text — no labels, no SOAP headers."""


async def _generate_assessment(
    subjective: str,
    objective: str,
    client: AsyncOpenAI,
    model: str,
) -> str:
    prompt = f"SUBJECTIVE:\n{subjective}\n\nOBJECTIVE:\n{objective}"
    try:
        resp = await client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": _ASSESSMENT_SYSTEM},
                {"role": "user",   "content": prompt},
            ],
            temperature=0.2,
            max_tokens=300,
        )
        return resp.choices[0].message.content.strip()
    except Exception as e:
        logger.warning(f"clinical_pipeline: assessment LLM failed: {e}")
        return "Clinical assessment unavailable — review objective data above."


# ─────────────────────────────────────────────────────────────────────────────
# Report generator — replaces _generate_report() in caregiver_amina_service
# ─────────────────────────────────────────────────────────────────────────────

_REPORT_SYSTEM = """You are AMINA, an AI health-intelligence assistant generating a clinical briefing
for a caregiver in The Gambia. You have been given a complete SOAP note and clinical scores.

Generate a professional clinical briefing using exactly this structure:

---
**Clinical Briefing — {patient_name}**
**Risk Level: {risk_level}** | **Escalation: {escalation}**

**Current Status**
[2-3 sentences synthesising the Assessment and caregiver's observations.]

**Key Concerns**
[Bullet list of the top 3-4 clinical issues. Name red flags directly.]

**Medication Status**
[Adherence score, any DDI alerts, medication notes.]

**Symptom & Vital Trends**
[Trend direction + specific findings. Include BP/glucose if available.]

**Care Gaps**
[Overdue screenings, labs, or exams — cite the specific item and how overdue.]

**Recommended Actions**
[Numbered list — use the care tasks exactly. Ordered by priority.]
---

Be direct and factual. Do not invent data. Use the structured inputs provided."""


async def generate_soap_report(
    caregiver_name: str,
    patient_name: str,
    patient_block: str,
    enriched: EnrichedClinicalContext,
    caregiver_statements: List[str],
    history: List[Dict],
    message: str,
    client: AsyncOpenAI,
    model: str,
    info_state: Dict,
) -> str:
    """
    Full enriched report generator.
    Uses enriched clinical context to generate a professional briefing card.
    """
    soap = enriched.soap_note
    score = enriched.score_card
    esc   = enriched.escalation

    # Fill in objective + assessment
    soap.objective = _build_objective(
        enriched.score_card, enriched.gap_report, enriched.ddi_report, enriched.trend_report,
        enriched.predictive_risk, enriched.sdoh_score,
    )
    soap.subjective = _build_subjective(patient_name, caregiver_name, caregiver_statements, info_state)
    soap.assessment = await _generate_assessment(soap.subjective, soap.objective, client, model)
    soap.plan       = _build_plan_text(
        enriched.care_tasks, enriched.sdoh_score, enriched.predictive_risk,
    )

    # Build full briefing prompt context
    risk_level = f"{score.deterioration_risk}/10 — {score.risk_label.upper()}"
    escalation_str = esc.level.replace("_", " ").title()

    full_context = f"""SOAP NOTE:

S (Subjective): {soap.subjective}

O (Objective):
{soap.objective}

A (Assessment): {soap.assessment}

P (Plan):
{soap.plan}

ESCALATION: {escalation_str} — {esc.message}

PATIENT CONTEXT:
{patient_block}
"""

    report_system = _REPORT_SYSTEM.replace("{patient_name}", patient_name)\
                                   .replace("{risk_level}", risk_level)\
                                   .replace("{escalation}", escalation_str)

    msgs = [{"role": "system", "content": report_system}]
    msgs.extend(history[-8:])
    msgs.append({"role": "user", "content": full_context})

    try:
        resp = await client.chat.completions.create(
            model=model,
            messages=msgs,
            temperature=0.3,
            max_tokens=1200,
        )
        return resp.choices[0].message.content
    except Exception as e:
        logger.error(f"clinical_pipeline: report generation failed: {e}")
        # Fallback: return structured plain text
        return f"""**Clinical Briefing — {patient_name}**
**Risk Level: {risk_level}** | **Escalation: {escalation_str}**

**Assessment**
{soap.assessment}

**Plan**
{soap.plan}

**Escalation**
{esc.message}"""


# ─────────────────────────────────────────────────────────────────────────────
# Master enrichment function — called from caregiver_amina_service Step 1
# ─────────────────────────────────────────────────────────────────────────────

def enrich_patient_context(
    patient_id: str,
    patient_data: Dict[str, Any],
    caregiver_statements: List[str],
    caregiver_data: Optional[Dict[str, Any]] = None,
    patient_name: str = "",
) -> EnrichedClinicalContext:
    """
    Run all rule-based services synchronously (Tier 0 + Tier 1 + Tier 2).
    Returns EnrichedClinicalContext (no LLM calls here).

    Called before the info-state extractor so the report generator
    has all clinical intelligence available.
    """
    from src.services.clinical_scoring import score_patient
    from src.services.care_gap_detector import detect_care_gaps
    from src.services.ddi_checker import check_drug_interactions
    from src.services.trend_analyzer import analyze_trends
    from src.services.predictive_engine import compute_cri
    from src.services.sdoh_service import get_sdoh_score

    # ── Tier 0: golden-standard rule-based services ──────────────────────────
    score_card   = score_patient(patient_id, patient_data, caregiver_statements)
    gap_report   = detect_care_gaps(patient_id, patient_data)
    ddi_report   = check_drug_interactions(patient_id, patient_data)
    trend_report = analyze_trends(patient_id, patient_data)

    escalation   = _apply_escalation_rules(score_card, gap_report, ddi_report, trend_report)
    care_tasks   = _build_care_tasks(escalation, gap_report, ddi_report, score_card)

    # ── Tier 1: Predictive Deterioration Engine ───────────────────────────────
    predictive_risk = None
    try:
        predictive_risk = compute_cri(
            patient_id   = patient_id,
            patient_data = patient_data,
            patient_name = patient_name,
        )
    except Exception as e:
        logger.warning(f"clinical_pipeline: CRI computation failed: {e}")

    # ── Tier 2: SDOH Intelligence ─────────────────────────────────────────────
    sdoh_score = None
    try:
        sdoh_score = get_sdoh_score(
            patient_id     = patient_id,
            patient_data   = patient_data.get("profile", patient_data),
            caregiver_data = caregiver_data,
        )
    except Exception as e:
        logger.warning(f"clinical_pipeline: SDOH scoring failed: {e}")

    # Merge all flags
    clinical_flags = list(score_card.flags)
    for sig in trend_report.signals:
        if sig.severity in ("flag", "alert"):
            clinical_flags.append(sig.detail)
    for gap in gap_report.gaps:
        if gap.priority == "urgent":
            clinical_flags.append(f"Care gap: {gap.item} ({gap.days_overdue} days overdue)")
    for alert in ddi_report.alerts:
        if alert.severity in ("contraindicated", "major"):
            clinical_flags.append(
                f"DDI [{alert.severity}]: {alert.drug_a} + {alert.drug_b}"
            )
    # Add Tier 1 warnings as flags
    if predictive_risk:
        for w in predictive_risk.warnings:
            if w not in clinical_flags:
                clinical_flags.append(f"Predictive: {w}")
    # Add Tier 2 SDOH flags
    if sdoh_score:
        for f in sdoh_score.sdoh_flags:
            if f not in clinical_flags:
                clinical_flags.append(f"SDOH: {f}")

    return EnrichedClinicalContext(
        patient_id      = patient_id,
        urgency_score   = score_card.deterioration_risk,
        escalation      = escalation,
        soap_note       = SOAPNote(),   # filled in during generate_soap_report()
        care_tasks      = care_tasks,
        clinical_flags  = clinical_flags,
        score_card      = score_card,
        gap_report      = gap_report,
        ddi_report      = ddi_report,
        trend_report    = trend_report,
        predictive_risk = predictive_risk,
        sdoh_score      = sdoh_score,
    )
