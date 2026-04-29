"""
Protocol Repository -- ArcadeDB CRUD for CHW Protocol Builder.

Stores clinical protocols (e.g. NCD screening flow, hypertension
follow-up, diabetes medication titration) as Protocol document type
nodes in ArcadeDB, with versioning and condition-tagging so the
agent can retrieve the active protocol for a given clinical context.

Schema fields:
  protocol_id     unique slug (e.g. "htn-stage-1-followup-v2")
  name            human-readable name
  version         integer
  condition       primary clinical condition tag (e.g. "hypertension")
  steps           JSON array of {order, action, criterion, branch}
  source          publisher/origin (e.g. "WHO PEN", "MoH Gambia 2025")
  status          "active" | "draft" | "deprecated"
  created_at      ISO-8601 timestamp
  updated_at      ISO-8601 timestamp
  created_by      author staff_id (if known)
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import requests

from src.config import settings

logger = logging.getLogger(__name__)


def _sql(query: str, params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    payload: Dict[str, Any] = {"language": "sql", "command": query}
    if params:
        payload["params"] = params
    resp = requests.post(
        f"{settings.ARCADEDB_URL}/api/v1/command/{settings.ARCADEDB_DB}",
        json=payload,
        auth=(settings.ARCADEDB_USER, settings.ARCADEDB_PASSWORD),
        timeout=10,
    )
    if resp.status_code != 200:
        raise Exception(f"ArcadeDB error {resp.status_code}: {resp.text[:300]}")
    return resp.json()


def _rows(resp: Dict[str, Any]) -> List[Dict[str, Any]]:
    result = resp.get("result", [])
    return result if isinstance(result, list) else []


class ProtocolRepository:

    async def ensure_schema(self) -> None:
        """Create Protocol document type + indexes. Idempotent."""
        _sql("CREATE DOCUMENT TYPE Protocol IF NOT EXISTS")
        _sql("CREATE PROPERTY Protocol.protocol_id IF NOT EXISTS STRING")
        _sql("CREATE PROPERTY Protocol.name IF NOT EXISTS STRING")
        _sql("CREATE PROPERTY Protocol.version IF NOT EXISTS INTEGER")
        _sql("CREATE PROPERTY Protocol.condition IF NOT EXISTS STRING")
        _sql("CREATE PROPERTY Protocol.steps IF NOT EXISTS STRING")
        _sql("CREATE PROPERTY Protocol.source IF NOT EXISTS STRING")
        _sql("CREATE PROPERTY Protocol.status IF NOT EXISTS STRING")
        _sql("CREATE PROPERTY Protocol.created_at IF NOT EXISTS STRING")
        _sql("CREATE PROPERTY Protocol.updated_at IF NOT EXISTS STRING")
        _sql("CREATE PROPERTY Protocol.created_by IF NOT EXISTS STRING")
        _sql("CREATE INDEX IF NOT EXISTS ON Protocol (protocol_id) UNIQUE")
        _sql("CREATE INDEX IF NOT EXISTS ON Protocol (condition) NOTUNIQUE")
        _sql("CREATE INDEX IF NOT EXISTS ON Protocol (status) NOTUNIQUE")

    def get(self, protocol_id: str) -> Optional[Dict[str, Any]]:
        resp = _sql(
            "SELECT FROM Protocol WHERE protocol_id = :pid LIMIT 1",
            {"pid": protocol_id},
        )
        rows = _rows(resp)
        if not rows:
            return None
        return _hydrate(rows[0])

    def list_by_condition(
        self, condition: str, status: str = "active"
    ) -> List[Dict[str, Any]]:
        resp = _sql(
            "SELECT FROM Protocol "
            "WHERE condition = :cond AND status = :st "
            "ORDER BY version DESC",
            {"cond": condition, "st": status},
        )
        return [_hydrate(r) for r in _rows(resp)]

    def upsert(self, protocol: Dict[str, Any]) -> Dict[str, Any]:
        """Insert or update a Protocol by protocol_id."""
        now = datetime.now(timezone.utc).isoformat()
        steps_json = json.dumps(protocol.get("steps", []))
        row = {
            "protocol_id": protocol["protocol_id"],
            "name":        protocol.get("name", ""),
            "version":     int(protocol.get("version", 1)),
            "condition":   protocol.get("condition", ""),
            "steps":       steps_json,
            "source":      protocol.get("source", ""),
            "status":      protocol.get("status", "draft"),
            "created_by":  protocol.get("created_by", ""),
            "updated_at":  now,
        }

        existing = self.get(protocol["protocol_id"])
        if existing:
            update_set = (
                "name = :name, version = :version, condition = :condition, "
                "steps = :steps, source = :source, status = :status, "
                "created_by = :created_by, updated_at = :updated_at"
            )
            _sql(
                f"UPDATE Protocol SET {update_set} WHERE protocol_id = :protocol_id",
                row,
            )
        else:
            row["created_at"] = now
            _sql(
                "INSERT INTO Protocol SET "
                "protocol_id = :protocol_id, name = :name, version = :version, "
                "condition = :condition, steps = :steps, source = :source, "
                "status = :status, created_by = :created_by, "
                "created_at = :created_at, updated_at = :updated_at",
                row,
            )
        return self.get(protocol["protocol_id"]) or row


def _hydrate(row: Dict[str, Any]) -> Dict[str, Any]:
    """Decode JSON-string fields back to native types."""
    out = dict(row)
    steps = out.get("steps")
    if isinstance(steps, str):
        try:
            out["steps"] = json.loads(steps)
        except Exception:
            out["steps"] = []
    return out


__all__ = ["ProtocolRepository"]
