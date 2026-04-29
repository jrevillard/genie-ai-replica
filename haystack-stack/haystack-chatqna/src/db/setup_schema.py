from src.utils.arcade_client import command_sql
import logging

logger = logging.getLogger(__name__)


def setup_memory_schema():
    """Create all vertex types, edge types, properties, and indexes
    needed by the 3-tier memory system.

    Safe to call on every startup (uses IF NOT EXISTS).
    """

    steps = [
        # ── Vertex types ──
        "CREATE VERTEX TYPE PatientVertex IF NOT EXISTS",
        "CREATE VERTEX TYPE ConsultationRecord IF NOT EXISTS",
        "CREATE VERTEX TYPE MemoryVertex IF NOT EXISTS",

        # ── Edge types ──
        "CREATE EDGE TYPE HasConsultation IF NOT EXISTS",
        "CREATE EDGE TYPE HasMemory IF NOT EXISTS",

        # ── PatientVertex properties ──
        "CREATE PROPERTY PatientVertex.id IF NOT EXISTS STRING",
        "CREATE PROPERTY PatientVertex.phone IF NOT EXISTS STRING",
        "CREATE PROPERTY PatientVertex.name IF NOT EXISTS STRING",
        "CREATE PROPERTY PatientVertex.age IF NOT EXISTS INTEGER",
        "CREATE PROPERTY PatientVertex.gender IF NOT EXISTS STRING",
        "CREATE PROPERTY PatientVertex.region IF NOT EXISTS STRING",
        "CREATE PROPERTY PatientVertex.conditions IF NOT EXISTS STRING",
        "CREATE PROPERTY PatientVertex.medications IF NOT EXISTS STRING",
        "CREATE PROPERTY PatientVertex.allergies IF NOT EXISTS STRING",
        "CREATE PROPERTY PatientVertex.bp_readings IF NOT EXISTS STRING",
        "CREATE PROPERTY PatientVertex.glucose_readings IF NOT EXISTS STRING",
        "CREATE PROPERTY PatientVertex.emergency_contact IF NOT EXISTS STRING",
        "CREATE PROPERTY PatientVertex.preferred_language IF NOT EXISTS STRING",
        "CREATE PROPERTY PatientVertex.preferred_facility IF NOT EXISTS STRING",
        "CREATE PROPERTY PatientVertex.key_facts IF NOT EXISTS STRING",
        "CREATE PROPERTY PatientVertex.consultation_count IF NOT EXISTS INTEGER",
        "CREATE PROPERTY PatientVertex.last_consultation IF NOT EXISTS STRING",
        "CREATE PROPERTY PatientVertex.email IF NOT EXISTS STRING",
        "CREATE PROPERTY PatientVertex.pin_hash IF NOT EXISTS STRING",
        "CREATE PROPERTY PatientVertex.pin_salt IF NOT EXISTS STRING",
        "CREATE PROPERTY PatientVertex.oauth_id IF NOT EXISTS STRING",
        "CREATE PROPERTY PatientVertex.oauth_provider IF NOT EXISTS STRING",
        "CREATE PROPERTY PatientVertex.created_at IF NOT EXISTS STRING",
        "CREATE PROPERTY PatientVertex.updated_at IF NOT EXISTS STRING",
        "CREATE PROPERTY PatientVertex.telegram_chat_id IF NOT EXISTS STRING",

        # ── ConsultationRecord properties ──
        "CREATE PROPERTY ConsultationRecord.id IF NOT EXISTS STRING",
        "CREATE PROPERTY ConsultationRecord.patient_id IF NOT EXISTS STRING",
        "CREATE PROPERTY ConsultationRecord.session_id IF NOT EXISTS STRING",
        "CREATE PROPERTY ConsultationRecord.started_at IF NOT EXISTS STRING",
        "CREATE PROPERTY ConsultationRecord.ended_at IF NOT EXISTS STRING",
        "CREATE PROPERTY ConsultationRecord.messages IF NOT EXISTS STRING",
        "CREATE PROPERTY ConsultationRecord.symptoms_reported IF NOT EXISTS STRING",
        "CREATE PROPERTY ConsultationRecord.triage_level IF NOT EXISTS STRING",
        "CREATE PROPERTY ConsultationRecord.tools_used IF NOT EXISTS STRING",
        "CREATE PROPERTY ConsultationRecord.recommendations IF NOT EXISTS STRING",
        "CREATE PROPERTY ConsultationRecord.followup_scheduled IF NOT EXISTS STRING",
        "CREATE PROPERTY ConsultationRecord.summary IF NOT EXISTS STRING",

        # ── MemoryVertex properties ──
        "CREATE PROPERTY MemoryVertex.id IF NOT EXISTS STRING",
        "CREATE PROPERTY MemoryVertex.patient_id IF NOT EXISTS STRING",
        "CREATE PROPERTY MemoryVertex.type IF NOT EXISTS STRING",
        "CREATE PROPERTY MemoryVertex.content IF NOT EXISTS STRING",
        "CREATE PROPERTY MemoryVertex.metadata IF NOT EXISTS STRING",
        "CREATE PROPERTY MemoryVertex.embedding IF NOT EXISTS LIST",
        "CREATE PROPERTY MemoryVertex.importance IF NOT EXISTS DOUBLE",
        "CREATE PROPERTY MemoryVertex.created_at IF NOT EXISTS STRING",
    ]

    for sql in steps:
        try:
            command_sql(sql)
        except Exception as e:
            logger.warning(f"Schema step warning (may already exist): {sql[:60]}... → {e}")

    # ── Indexes (wrap separately — CREATE INDEX may fail if already exists) ──
    indexes = [
        "CREATE INDEX IF NOT EXISTS ON PatientVertex (id) UNIQUE",
        "CREATE INDEX IF NOT EXISTS ON PatientVertex (phone) UNIQUE",
        "CREATE INDEX IF NOT EXISTS ON ConsultationRecord (id) UNIQUE",
        "CREATE INDEX IF NOT EXISTS ON ConsultationRecord (patient_id) NOTUNIQUE",
        "CREATE INDEX IF NOT EXISTS ON MemoryVertex (id) UNIQUE",
        "CREATE INDEX IF NOT EXISTS ON MemoryVertex (patient_id) NOTUNIQUE",
    ]
    for sql in indexes:
        try:
            command_sql(sql)
        except Exception as e:
            logger.warning(f"Index creation warning: {e}")

    # ── Vector index on MemoryVertex.embedding (384-dim MiniLM) ──
    # NOTE: VECTOR(384, COSINE) syntax requires ArcadeDB 24.x+.
    # Older versions don't support it — the memory system falls back to
    # importance/recency ranking instead of semantic similarity. This is
    # non-fatal: the rest of the schema works fine without it.
    try:
        from src.utils.arcade_client import command_sql as _cmd
        # Use a single-try call (no retries) since this is expected to fail
        # on older ArcadeDB versions. Avoids 6 seconds of noisy retry logs.
        import requests
        from src.config import settings
        resp = requests.post(
            f"{settings.ARCADEDB_URL}/api/v1/command/{settings.ARCADEDB_DB}",
            json={"language": "sql", "command": "CREATE INDEX ON MemoryVertex (embedding) VECTOR(384, COSINE)"},
            auth=(settings.ARCADEDB_USER, settings.ARCADEDB_PASSWORD),
            timeout=5,
        )
        if resp.status_code == 200:
            logger.info("Vector index created on MemoryVertex.embedding")
        else:
            logger.info("Vector index not supported by this ArcadeDB version — using fallback ranking")
    except Exception:
        logger.info("Vector index skipped — ArcadeDB version does not support VECTOR indexes")

    logger.info("Memory schema setup complete")

    try:
        from src.db.compaction_schema import setup_compaction_schema
        setup_compaction_schema()
    except Exception as e:
        logger.warning(f"Compaction schema setup failed (non-fatal): {e}")

    try:
        from src.db.dialogue_state_schema import setup_dialogue_state_schema
        setup_dialogue_state_schema()
    except Exception as e:
        logger.warning(f"DialogueState schema setup failed (non-fatal): {e}")

    try:
        from src.db.clinical_state_schema import setup_clinical_state_schema
        setup_clinical_state_schema()
    except Exception as e:
        logger.warning(f"ClinicalState schema setup failed (non-fatal): {e}")
