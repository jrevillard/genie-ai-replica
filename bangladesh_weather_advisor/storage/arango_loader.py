"""ArangoDB loader for document/advisory records.

Colab setup:
    !pip install python-arango pandas

Example:
    from production_pipeline.storage.arango_loader import ArangoDocumentLoader
    loader = ArangoDocumentLoader()
    loader.ensure_database_and_collection(collection_name="documents")
    loader.upsert_documents(df, collection_name="documents")
"""

from __future__ import annotations

import logging
from typing import Dict, List

import pandas as pd

from production_pipeline.config import (
    ARANGO_DB,
    ARANGO_HOST,
    ARANGO_PASSWORD,
    ARANGO_PORT,
    ARANGO_USERNAME,
    LOG_LEVEL,
)
from production_pipeline.storage.schema_validator import validate_document_frame

logger = logging.getLogger(__name__)
logging.basicConfig(level=getattr(logging, LOG_LEVEL, logging.INFO))


class ArangoDocumentLoader:
    def __init__(
        self,
        host: str = ARANGO_HOST,
        port: str = ARANGO_PORT,
        username: str = ARANGO_USERNAME,
        password: str = ARANGO_PASSWORD,
        database_name: str = ARANGO_DB,
    ) -> None:
        self.host = host
        self.port = port
        self.username = username
        self.password = password
        self.database_name = database_name
        self._client = None
        self._db = None
        self._init_client()

    def _init_client(self) -> None:
        try:
            from arango import ArangoClient

            self._client = ArangoClient(hosts=f"http://{self.host}:{self.port}")
            sys_db = self._client.db("_system", username=self.username, password=self.password)
            if not sys_db.has_database(self.database_name):
                sys_db.create_database(self.database_name)
            self._db = self._client.db(self.database_name, username=self.username, password=self.password)
            logger.info("Connected to ArangoDB database=%s", self.database_name)
        except Exception as exc:  # pragma: no cover
            logger.warning("ArangoDB client unavailable/unreachable: %s", exc)
            self._client = None
            self._db = None

    def ensure_database_and_collection(self, collection_name: str = "documents") -> None:
        if self._db is None:
            logger.warning("Skipping collection ensure: no ArangoDB connection")
            return
        if not self._db.has_collection(collection_name):
            self._db.create_collection(collection_name)
            logger.info("Created Arango collection: %s", collection_name)

    def upsert_documents(self, df: pd.DataFrame, collection_name: str = "documents") -> None:
        validation = validate_document_frame(df)
        if not validation.is_valid:
            raise ValueError(f"Document schema validation failed: {validation}")

        if self._db is None:
            logger.warning("ArangoDB unavailable. Dry-run only; rows=%d", len(df))
            return

        collection = self._db.collection(collection_name)

        docs: List[Dict[str, object]] = []
        for row in df.to_dict(orient="records"):
            doc = dict(row)
            doc["_key"] = str(doc["doc_key"]).replace(" ", "_")
            docs.append(doc)

        # import_bulk with on_duplicate="update" supports idempotent writes.
        result = collection.import_bulk(docs, on_duplicate="update", sync=True)
        logger.info("Arango upsert finished. Result: %s", result)
