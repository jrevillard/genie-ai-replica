"""
Scout Directory Service — patient-facing read layer + help suggestions.

Exposes scout profiles (public-safe fields only) to any authenticated
patient, regardless of tier. Adds:
  1. Availability tracking — scouts self-report free/busy via a Redis
     hash so patients know who is available right now.
  2. Help suggestions — any patient can suggest that a person (elder,
     neighbour, family member) needs a scout's attention. Suggestions
     land in the Alkalo/scout inbox for triage.
"""

from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

TTL = 30 * 86400
AVAILABILITY_KEY = "scout_directory:availability"
SUGGESTIONS_KEY = "scout_directory:suggestions"


class ScoutDirectoryService:
    def __init__(self, redis_client):
        self.redis = redis_client

    # ── Public scout listing ─────────────────────────────────────

    async def list_public_scouts(self, village: Optional[str] = None) -> List[Dict[str, Any]]:
        from src.services.community_admin import CommunityAdminService
        admin = CommunityAdminService(self.redis)
        raw_scouts = await admin.list_scouts()

        availability_map = self._get_availability_map()

        public = []
        for s in raw_scouts:
            if s.get("removed"):
                continue
            sid = s.get("scout_id", "")
            if village and (s.get("village") or "").lower() != village.lower():
                continue

            badge = admin._compute_badge(s.get("total_checks", 0))
            avail = availability_map.get(sid, {})

            public.append({
                "scout_id":    sid,
                "name":        s.get("name", ""),
                "age":         s.get("age", 0),
                "village":     s.get("village", ""),
                "locality":    s.get("locality", ""),
                "badge":       badge.get("current", {}).get("name", "First Check"),
                "badge_color": badge.get("current", {}).get("color", "bronze"),
                "total_checks": s.get("total_checks", 0),
                "elders_count": len(s.get("elders_monitored") or []),
                "availability": avail.get("status", "available"),
                "availability_note": avail.get("note", ""),
                "availability_updated": avail.get("updated_at", ""),
            })

        public.sort(key=lambda x: (
            0 if x["availability"] == "available" else 1,
            -x["total_checks"],
        ))
        return public

    async def get_public_scout(self, scout_id: str) -> Optional[Dict[str, Any]]:
        from src.services.community_admin import CommunityAdminService
        admin = CommunityAdminService(self.redis)
        try:
            s = await admin.get_scout(scout_id)
        except Exception:
            return None
        if not s or s.get("removed"):
            return None

        avail = self._get_availability(scout_id)
        badge = s.get("badge", {})

        elders_summary = []
        for e in (s.get("elders_monitored") or []):
            elders_summary.append({
                "name": e.get("name", ""),
                "relation": e.get("relation", ""),
                "flag": e.get("flag", "green"),
                "last_check": e.get("last_check", "not yet"),
            })

        return {
            "scout_id":    scout_id,
            "name":        s.get("name", ""),
            "age":         s.get("age", 0),
            "village":     s.get("village", ""),
            "locality":    s.get("locality", ""),
            "phone":       s.get("phone", ""),
            "badge":       badge,
            "total_checks": s.get("total_checks", 0),
            "weekly_duty": s.get("weekly_duty", ""),
            "elders":      elders_summary,
            "availability": avail.get("status", "available"),
            "availability_note": avail.get("note", ""),
            "scout_greeting": s.get("scout_greeting", ""),
        }

    # ── Availability tracking ────────────────────────────────────

    def _get_availability_map(self) -> Dict[str, Dict]:
        try:
            raw = self.redis.hgetall(AVAILABILITY_KEY) or {}
            return {k: json.loads(v) for k, v in raw.items()}
        except Exception:
            return {}

    def _get_availability(self, scout_id: str) -> Dict:
        try:
            raw = self.redis.hget(AVAILABILITY_KEY, scout_id)
            return json.loads(raw) if raw else {}
        except Exception:
            return {}

    async def set_availability(
        self, scout_id: str, status: str, note: str = "",
    ) -> Dict[str, Any]:
        entry = {
            "status": status if status in ("available", "busy", "offline") else "available",
            "note": (note or "").strip()[:200],
            "updated_at": datetime.now().isoformat(),
        }
        try:
            self.redis.hset(AVAILABILITY_KEY, scout_id, json.dumps(entry))
            self.redis.expire(AVAILABILITY_KEY, TTL)
        except Exception as exc:
            logger.warning(f"availability set failed: {exc}")
        return entry

    # ── Help suggestions ─────────────────────────────────────────

    async def create_suggestion(
        self,
        suggester_id: str,
        suggester_name: str,
        person_name: str,
        person_age: int,
        person_village: str,
        reason: str,
        urgency: str = "normal",
        preferred_scout_id: str = "",
    ) -> Dict[str, Any]:
        suggestion_id = "sug_" + uuid.uuid4().hex[:12]
        suggestion = {
            "suggestion_id":     suggestion_id,
            "status":            "pending",
            "suggester_id":      suggester_id,
            "suggester_name":    suggester_name,
            "person_name":       (person_name or "").strip(),
            "person_age":        int(person_age or 0),
            "person_village":    (person_village or "").strip(),
            "reason":            (reason or "").strip(),
            "urgency":           urgency if urgency in ("low", "normal", "urgent") else "normal",
            "preferred_scout_id": preferred_scout_id or "",
            "created_at":        datetime.now().isoformat(),
        }
        try:
            self.redis.hset(SUGGESTIONS_KEY, suggestion_id, json.dumps(suggestion, default=str))
            self.redis.expire(SUGGESTIONS_KEY, TTL)
        except Exception as exc:
            logger.warning(f"suggestion persist failed: {exc}")

        self._notify_suggestion(suggestion)
        return suggestion

    async def list_suggestions(
        self, status: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        out: List[Dict[str, Any]] = []
        try:
            raw = self.redis.hgetall(SUGGESTIONS_KEY) or {}
            for _, v in raw.items():
                try:
                    d = json.loads(v)
                    if status and d.get("status") != status:
                        continue
                    out.append(d)
                except Exception:
                    continue
        except Exception:
            pass
        out.sort(key=lambda r: r.get("created_at") or "", reverse=True)
        return out

    async def resolve_suggestion(
        self, suggestion_id: str, resolution: str, resolved_by: str,
    ) -> Optional[Dict[str, Any]]:
        try:
            raw = self.redis.hget(SUGGESTIONS_KEY, suggestion_id)
            if not raw:
                return None
            d = json.loads(raw)
            d["status"] = "resolved"
            d["resolution"] = resolution
            d["resolved_by"] = resolved_by
            d["resolved_at"] = datetime.now().isoformat()
            self.redis.hset(SUGGESTIONS_KEY, suggestion_id, json.dumps(d, default=str))

            if d.get("suggester_id"):
                self._notify_resolution(d)
            return d
        except Exception as exc:
            logger.warning(f"resolve suggestion failed: {exc}")
            return None

    # ── Notifications ────────────────────────────────────────────

    def _notify_suggestion(self, suggestion: Dict) -> None:
        try:
            from src.services import inbox_service
            title = f"Scout help suggested for {suggestion.get('person_name', 'someone')}"
            body = (
                f"{suggestion.get('suggester_name', 'A patient')} suggests that "
                f"{suggestion.get('person_name', 'someone')} "
                f"(age {suggestion.get('person_age', '?')}, "
                f"{suggestion.get('person_village', 'unknown village')}) "
                f"may need a youth scout's help.\n\n"
                f"Reason: {suggestion.get('reason', 'Not specified')}\n"
                f"Urgency: {suggestion.get('urgency', 'normal')}"
            )
            severity = "info" if suggestion.get("urgency") != "urgent" else "warning"
            metadata = {"event": "scout_help_suggested", **suggestion}

            alkalo_ids = self._find_alkalo_users()
            for pid in alkalo_ids:
                inbox_service.create_item(
                    patient_id=pid,
                    kind="scout_suggestion",
                    title=title,
                    body=body,
                    severity=severity,
                    source="scout_directory",
                    source_id=suggestion.get("suggestion_id", ""),
                    action_url="/community/scouts",
                    metadata=metadata,
                    ttl_days=30,
                )

            if not alkalo_ids:
                inbox_service.create_item(
                    patient_id="__alkalo__",
                    kind="scout_suggestion",
                    title=title,
                    body=body,
                    severity=severity,
                    source="scout_directory",
                    source_id=suggestion.get("suggestion_id", ""),
                    action_url="/community/scouts",
                    metadata=metadata,
                    ttl_days=30,
                )
        except Exception as exc:
            logger.warning(f"suggestion notification failed: {exc}")

    def _find_alkalo_users(self) -> list:
        """Find patient IDs of users with alkalo role."""
        try:
            from src.db.arango_client import execute_sql as _sql
        except Exception:
            try:
                from src.db.arcade_client import execute_sql as _sql
            except Exception:
                return []
        try:
            rows = _sql(
                "SELECT id FROM PatientVertex WHERE role = 'alkalo' LIMIT 10",
                {},
            ) or []
            return [r.get("id") for r in rows if r.get("id")]
        except Exception:
            pass
        try:
            keys = self.redis.keys("session:*:role") or []
            ids = []
            for k in keys[:50]:
                if self.redis.get(k) == "alkalo":
                    parts = str(k).split(":")
                    if len(parts) >= 2:
                        ids.append(parts[1])
            return ids[:10]
        except Exception:
            return []

    def _notify_resolution(self, suggestion: Dict) -> None:
        try:
            from src.services import inbox_service
            inbox_service.create_item(
                patient_id=suggestion["suggester_id"],
                kind="notification",
                title="Your scout help suggestion was reviewed",
                body=(
                    f"Your suggestion for {suggestion.get('person_name', 'someone')} "
                    f"has been reviewed.\n\n"
                    f"Resolution: {suggestion.get('resolution', 'Reviewed by the team')}"
                ),
                severity="info",
                source="scout_directory",
                source_id=suggestion.get("suggestion_id", ""),
                action_url="/community/scouts",
                metadata={"event": "scout_suggestion_resolved"},
                ttl_days=30,
            )
        except Exception as exc:
            logger.warning(f"resolution notification failed: {exc}")
