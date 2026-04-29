"""
ArcadeDB schema for durable compaction summaries.

CompactionSummary is a vertex type that stores every summary generated
by the context compactor. Redis is the hot cache; ArcadeDB is the
source of truth for audit, undo, and long-term clinical traceability.

Called from setup_schema.py on startup. Idempotent (IF NOT EXISTS).
"""

from src.utils.arcade_client import command_sql
import logging

logger = logging.getLogger(__name__)


def setup_compaction_schema():
    steps = [
        "CREATE VERTEX TYPE CompactionSummary IF NOT EXISTS",

        "CREATE PROPERTY CompactionSummary.id IF NOT EXISTS STRING",
        "CREATE PROPERTY CompactionSummary.session_id IF NOT EXISTS STRING",
        "CREATE PROPERTY CompactionSummary.summary_text IF NOT EXISTS STRING",
        "CREATE PROPERTY CompactionSummary.version IF NOT EXISTS INTEGER",
        "CREATE PROPERTY CompactionSummary.range_count IF NOT EXISTS INTEGER",
        "CREATE PROPERTY CompactionSummary.tokens_before IF NOT EXISTS INTEGER",
        "CREATE PROPERTY CompactionSummary.tokens_after IF NOT EXISTS INTEGER",
        "CREATE PROPERTY CompactionSummary.chars_before IF NOT EXISTS INTEGER",
        "CREATE PROPERTY CompactionSummary.chars_after IF NOT EXISTS INTEGER",
        "CREATE PROPERTY CompactionSummary.trigger_type IF NOT EXISTS STRING",
        "CREATE PROPERTY CompactionSummary.summarizer_model IF NOT EXISTS STRING",
        "CREATE PROPERTY CompactionSummary.created_at IF NOT EXISTS STRING",

        "CREATE EDGE TYPE HasCompaction IF NOT EXISTS",
    ]

    for sql in steps:
        try:
            command_sql(sql)
        except Exception as e:
            logger.warning(f"Compaction schema step warning: {sql[:60]}... → {e}")

    indexes = [
        "CREATE INDEX IF NOT EXISTS ON CompactionSummary (id) UNIQUE",
        "CREATE INDEX IF NOT EXISTS ON CompactionSummary (session_id) NOTUNIQUE",
    ]
    for sql in indexes:
        try:
            command_sql(sql)
        except Exception as e:
            logger.warning(f"Compaction index warning: {e}")

    logger.info("Compaction schema setup complete")
