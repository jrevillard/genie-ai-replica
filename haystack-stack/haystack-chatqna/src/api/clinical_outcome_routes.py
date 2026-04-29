"""
AMINA Care — Clinical Outcome Dashboard API Routes
====================================================
Exposes clinical outcome metrics via REST endpoints for the
admin dashboard, Superset integration, and eval tooling.

Endpoints:
  GET /outcomes/dashboard           — full dashboard (all 8 metrics)
  GET /outcomes/vital-trend         — vital trend improvement rate
  GET /outcomes/adherence           — adherence signal rate
  GET /outcomes/reconsultation      — re-consultation rate
  GET /outcomes/safety-blocks       — safety block rate
  GET /outcomes/triage-escalation   — triage escalation rate
  GET /outcomes/quality-scores      — quality score distribution
  GET /outcomes/knowledge-promotion — knowledge chunk promotion stats
  GET /outcomes/engagement-trend    — weekly engagement trend
"""

from fastapi import APIRouter, Query
import logging

from src.services.clinical_outcome_dashboard import get_dashboard

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/outcomes", tags=["clinical-outcomes"])


@router.get("/dashboard")
async def full_dashboard(days: int = Query(90, ge=1, le=365)):
    """Full clinical outcome dashboard — all 8 metrics aggregated."""
    dashboard = get_dashboard()
    return await dashboard.full_dashboard(days)


@router.get("/vital-trend")
async def vital_trend(days: int = Query(90, ge=1, le=365)):
    """Percentage of patients with improving vital readings."""
    dashboard = get_dashboard()
    return await dashboard.vital_trend_improvement(days)


@router.get("/adherence")
async def adherence(days: int = Query(90, ge=1, le=365)):
    """Adherence signal rate across patient interactions."""
    dashboard = get_dashboard()
    return await dashboard.adherence_signal_rate(days)


@router.get("/reconsultation")
async def reconsultation(days: int = Query(90, ge=1, le=365)):
    """Average sessions per patient per month."""
    dashboard = get_dashboard()
    return await dashboard.reconsultation_rate(days)


@router.get("/safety-blocks")
async def safety_blocks(days: int = Query(90, ge=1, le=365)):
    """Percentage of messages that triggered safety guards."""
    dashboard = get_dashboard()
    return await dashboard.safety_block_rate(days)


@router.get("/triage-escalation")
async def triage_escalation(days: int = Query(90, ge=1, le=365)):
    """Percentage of sessions escalated to facility or emergency."""
    dashboard = get_dashboard()
    return await dashboard.triage_escalation_rate(days)


@router.get("/quality-scores")
async def quality_scores(days: int = Query(90, ge=1, le=365)):
    """Distribution of 5-dimension quality scores."""
    dashboard = get_dashboard()
    return await dashboard.quality_score_distribution(days)


@router.get("/knowledge-promotion")
async def knowledge_promotion():
    """Stats on clinical insights promoted to RAG knowledge chunks."""
    dashboard = get_dashboard()
    return await dashboard.knowledge_promotion_stats()


@router.get("/engagement-trend")
async def engagement_trend(
    days: int = Query(90, ge=1, le=365),
    bucket_days: int = Query(7, ge=1, le=30),
):
    """Weekly engagement trend — sessions and unique patients per bucket."""
    dashboard = get_dashboard()
    return await dashboard.engagement_trend(days, bucket_days)
