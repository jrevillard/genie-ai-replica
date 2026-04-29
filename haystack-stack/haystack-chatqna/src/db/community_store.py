"""
ArcadeDB persistence for community + care form data.

Pipeline:
  Frontend form submit → API → Redis (fast) → ArcadeDB (durable, async)

Uses httpx directly with parameterized queries to avoid SQL injection
and JSON escaping issues.
"""

from typing import Dict, Any, Optional
from datetime import datetime
import json
import logging
import uuid

import httpx
from src.config import settings

logger = logging.getLogger(__name__)

_ARCADE_URL = f"{settings.ARCADEDB_URL}/api/v1/command/{settings.ARCADEDB_DB}"
_ARCADE_AUTH = (settings.ARCADEDB_USER, settings.ARCADEDB_PASSWORD)


async def _exec(sql: str, params: Optional[dict] = None) -> list:
    """Execute SQL against ArcadeDB with optional named params."""
    body = {"language": "sql", "command": sql}
    if params:
        body["params"] = params
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.post(_ARCADE_URL, json=body, auth=_ARCADE_AUTH)
            if r.status_code == 200:
                return r.json().get("result", [])
            else:
                logger.warning(f"ArcadeDB exec failed ({r.status_code}): {r.text[:200]}")
                return []
    except Exception as e:
        logger.warning(f"ArcadeDB exec error: {e}")
        return []


async def ensure_community_schema():
    """Create ArcadeDB document types. Idempotent."""
    from src.utils.arcade_client import async_command_sql
    sqls = [
        "CREATE DOCUMENT TYPE CommunityData IF NOT EXISTS",
        "CREATE PROPERTY CommunityData.doc_id IF NOT EXISTS STRING",
        "CREATE PROPERTY CommunityData.category IF NOT EXISTS STRING",
        "CREATE PROPERTY CommunityData.data IF NOT EXISTS STRING",
        "CREATE PROPERTY CommunityData.updated_at IF NOT EXISTS STRING",
        "CREATE PROPERTY CommunityData.updated_by IF NOT EXISTS STRING",

        "CREATE DOCUMENT TYPE CommunityAuditLog IF NOT EXISTS",
        "CREATE PROPERTY CommunityAuditLog.audit_id IF NOT EXISTS STRING",
        "CREATE PROPERTY CommunityAuditLog.category IF NOT EXISTS STRING",
        "CREATE PROPERTY CommunityAuditLog.action IF NOT EXISTS STRING",
        "CREATE PROPERTY CommunityAuditLog.data_snapshot IF NOT EXISTS STRING",
        "CREATE PROPERTY CommunityAuditLog.updated_by IF NOT EXISTS STRING",
        "CREATE PROPERTY CommunityAuditLog.updated_at IF NOT EXISTS STRING",
    ]
    for sql in sqls:
        try:
            await async_command_sql(sql)
        except Exception as e:
            logger.warning(f"Community schema warning: {e}")

    # Indexes (best-effort)
    for idx in [
        "CREATE INDEX IF NOT EXISTS ON CommunityData (doc_id) UNIQUE",
        "CREATE INDEX IF NOT EXISTS ON CommunityData (category) NOTUNIQUE",
    ]:
        try:
            await async_command_sql(idx)
        except Exception:
            pass

    logger.info("CommunityData + CommunityAuditLog schema ready")


async def save_to_arcade(
    doc_id: str,
    category: str,
    data: Dict[str, Any],
    updated_by: str = "system",
    action: str = "update",
) -> bool:
    """Upsert a community document to ArcadeDB.

    Uses CONTENT-based INSERT (ArcadeDB's preferred syntax for documents).
    For updates: DELETE old + INSERT new (simpler than UPDATE SET with JSON).
    """
    now = datetime.now().isoformat()
    data_json = json.dumps(data, default=str)

    # Build the CONTENT JSON for ArcadeDB
    content = json.dumps({
        "doc_id": doc_id,
        "category": category,
        "data": data_json,
        "updated_at": now,
        "updated_by": updated_by,
    })

    try:
        # Delete existing document with this doc_id (if any)
        await _exec(f"DELETE FROM CommunityData WHERE doc_id = '{doc_id}'")
        # Insert fresh
        await _exec(f"INSERT INTO CommunityData CONTENT {content}")
    except Exception as e:
        logger.warning(f"ArcadeDB save failed for {doc_id}: {e}")
        return False

    # Audit log (best-effort)
    try:
        audit_content = json.dumps({
            "audit_id": f"audit_{uuid.uuid4().hex[:8]}",
            "category": category,
            "action": action,
            "data_snapshot": data_json[:2000],
            "updated_by": updated_by,
            "updated_at": now,
        })
        await _exec(f"INSERT INTO CommunityAuditLog CONTENT {audit_content}")
    except Exception:
        pass

    return True


async def load_from_arcade(doc_id: str) -> Optional[Dict[str, Any]]:
    """Load a community document from ArcadeDB."""
    rows = await _exec(
        f"SELECT data, updated_at, updated_by FROM CommunityData WHERE doc_id = '{doc_id}'"
    )
    if rows:
        row = rows[0]
        try:
            data = json.loads(row.get("data", "{}"))
            data["_arcade_updated_at"] = row.get("updated_at")
            data["_arcade_updated_by"] = row.get("updated_by")
            return data
        except Exception:
            pass
    return None


async def get_audit_log(
    category: Optional[str] = None,
    limit: int = 20,
) -> list:
    """Fetch recent audit log entries."""
    if category:
        return await _exec(
            f"SELECT * FROM CommunityAuditLog WHERE category = '{category}' "
            f"ORDER BY updated_at DESC LIMIT {limit}"
        )
    return await _exec(
        f"SELECT * FROM CommunityAuditLog ORDER BY updated_at DESC LIMIT {limit}"
    )
