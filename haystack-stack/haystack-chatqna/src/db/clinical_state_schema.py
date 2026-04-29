"""
ArcadeDB schema for ClinicalStateSnapshot (Gap 6 — Structured Compaction).

Stores durable snapshots of the structured PatientClinicalState.
Redis holds the hot copy (30-day TTL); ArcadeDB holds the permanent record.
"""

from src.utils.arcade_client import command_sql
import logging

logger = logging.getLogger(__name__)


def setup_clinical_state_schema():
    """Create ClinicalStateSnapshot vertex type and indexes.
    Safe to call on every startup (uses IF NOT EXISTS)."""

    steps = [
        "CREATE VERTEX TYPE ClinicalStateSnapshot IF NOT EXISTS",
        "CREATE PROPERTY ClinicalStateSnapshot.id IF NOT EXISTS STRING",
        "CREATE PROPERTY ClinicalStateSnapshot.patient_id IF NOT EXISTS STRING",
        "CREATE PROPERTY ClinicalStateSnapshot.session_id IF NOT EXISTS STRING",
        "CREATE PROPERTY ClinicalStateSnapshot.state_json IF NOT EXISTS STRING",
        "CREATE PROPERTY ClinicalStateSnapshot.extraction_count IF NOT EXISTS INTEGER",
        "CREATE PROPERTY ClinicalStateSnapshot.created_at IF NOT EXISTS STRING",
    ]

    for sql in steps:
        try:
            command_sql(sql)
        except Exception as e:
            logger.warning(f"ClinicalState schema step warning: {sql[:60]}... → {e}")

    indexes = [
        "CREATE INDEX IF NOT EXISTS ON ClinicalStateSnapshot (id) UNIQUE",
        "CREATE INDEX IF NOT EXISTS ON ClinicalStateSnapshot (patient_id) NOTUNIQUE",
    ]
    for sql in indexes:
        try:
            command_sql(sql)
        except Exception as e:
            logger.warning(f"ClinicalState index warning: {e}")

    logger.info("ClinicalStateSnapshot schema setup complete")
