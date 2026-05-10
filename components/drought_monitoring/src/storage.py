"""
DroughtStorage — writes drought assessments to ArangoDB.

Collection: drought_assessments
Key: {location}__drought   (e.g. dhaka__drought)
TTL: 30 days recommended
"""
import logging
import os
from datetime import datetime, timezone

from arango import ArangoClient
from arango.exceptions import DocumentInsertError, DocumentReplaceError

logger = logging.getLogger(__name__)

_COLLECTION = "drought_assessments"


def _norm_key(s: str) -> str:
    return (
        s.lower()
        .replace(" ", "_")
        .replace("'", "")
        .replace("-", "_")
        .replace("’", "")
    )


class DroughtStorage:
    def __init__(self) -> None:
        arango_url  = os.getenv("ARANGO_URL",      "http://arango-vector-db:8529")
        arango_db   = os.getenv("ARANGO_DB_NAME",  "genie-ai")
        arango_user = os.getenv("ARANGO_USER",     "root")
        arango_pass = os.getenv("ARANGO_PASSWORD", "test")

        client = ArangoClient(hosts=arango_url)
        self._db = client.db(arango_db, username=arango_user, password=arango_pass)
        self._ensure_collection()
        logger.info("[DROUGHT_STORAGE] Connected to ArangoDB at %s", arango_url)

    def _ensure_collection(self) -> None:
        if not self._db.has_collection(_COLLECTION):
            self._db.create_collection(_COLLECTION)
            logger.info("[DROUGHT_STORAGE] Created collection: %s", _COLLECTION)

    def upsert_drought_assessment(self, assessment: dict) -> str:
        key = _norm_key(f"{assessment['location']}__drought")
        col = self._db.collection(_COLLECTION)
        doc = {"_key": key, **assessment}
        try:
            if col.has(key):
                col.replace(doc)
            else:
                col.insert(doc)
        except (DocumentInsertError, DocumentReplaceError) as exc:
            logger.error("[DROUGHT_STORAGE] upsert failed for %s: %s", key, exc)
            raise
        logger.debug("[DROUGHT_STORAGE] Upserted %s (tier=%d)", key, assessment.get("tier", 0))
        return key
