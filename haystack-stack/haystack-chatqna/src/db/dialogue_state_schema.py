"""
ArcadeDB schema for DialogueState snapshots.

DialogueStateSnapshot stores periodic snapshots of the dialogue state
for durability and audit. Redis is the hot cache; ArcadeDB is the
source of truth for long-term traceability.

Called from setup_schema.py on startup. Idempotent (IF NOT EXISTS).
"""

from src.utils.arcade_client import command_sql
import logging

logger = logging.getLogger(__name__)


def setup_dialogue_state_schema():
    steps = [
        "CREATE VERTEX TYPE DialogueStateSnapshot IF NOT EXISTS",

        "CREATE PROPERTY DialogueStateSnapshot.id IF NOT EXISTS STRING",
        "CREATE PROPERTY DialogueStateSnapshot.session_id IF NOT EXISTS STRING",
        "CREATE PROPERTY DialogueStateSnapshot.turn_count IF NOT EXISTS INTEGER",
        "CREATE PROPERTY DialogueStateSnapshot.state_json IF NOT EXISTS STRING",
        "CREATE PROPERTY DialogueStateSnapshot.created_at IF NOT EXISTS STRING",
    ]

    for sql in steps:
        try:
            command_sql(sql)
        except Exception as e:
            logger.warning(f"DialogueState schema step warning: {sql[:60]}... → {e}")

    indexes = [
        "CREATE INDEX IF NOT EXISTS ON DialogueStateSnapshot (id) UNIQUE",
        "CREATE INDEX IF NOT EXISTS ON DialogueStateSnapshot (session_id) NOTUNIQUE",
    ]
    for sql in indexes:
        try:
            command_sql(sql)
        except Exception as e:
            logger.warning(f"DialogueState index warning: {e}")

    logger.info("DialogueState schema setup complete")
