"""
Community Admin Service — Role-gated CRUD for community features.

ROLE MATRIX:
  Bantaba Circle:  VHW (manage members, log adherence), Alkalo (approve)
  Village Score:   VHW (update pillars), Alkalo (add notes)
  Youth Scout:     VHW (assign elders, log checks, award badges), Clinician (review)
  Seasonal:        Clinician (add custom tips)
  Supply/DualPath: Clinician + VHW (already in patient_care.py)

All data persists in Redis with 30-day TTL. Auto-seeds from the
mock data in community.py on first access.
"""

from typing import Dict, Any, Optional, List
from datetime import datetime
import json
import logging
import asyncio

logger = logging.getLogger(__name__)

TTL = 30 * 86400


def _first_name(full: Optional[str]) -> str:
    """Extract the first whitespace-separated token from a patient's
    full name. Used for circle labels ("Aminata's Circle" rather than
    "Aminata Ceesay's Circle") — gentler and more personal on-screen."""
    if not full:
        return ""
    return str(full).strip().split()[0] if str(full).strip() else ""


class CommunityAdminService:
    def __init__(self, redis_client):
        self.redis = redis_client

    async def _persist(
        self, doc_id: str, category: str, data: Dict,
        role: str, action: str, redis_key: str,
    ):
        """Write-through: save to Redis (fast) + fire-and-forget to ArcadeDB (durable)."""
        # 1. Redis — synchronous (serves reads immediately)
        data["updated_at"] = datetime.now().isoformat()
        data["updated_by"] = role
        self.redis.setex(redis_key, TTL, json.dumps(data, default=str))
        # 2. ArcadeDB — async background (non-blocking, durable backup)
        try:
            from src.db.community_store import save_to_arcade
            asyncio.create_task(save_to_arcade(doc_id, category, data, role, action))
        except Exception as e:
            logger.warning(f"ArcadeDB write-through failed for {doc_id}: {e}")

    # ═══════════════════════════════════════════════════════════
    # BANTABA CIRCLE
    # ═══════════════════════════════════════════════════════════

    def _bantaba_key(self, circle_id: str = "default") -> str:
        return f"community:bantaba:{circle_id}"

    async def get_bantaba(self, circle_id: str = "default") -> Dict[str, Any]:
        raw = self.redis.get(self._bantaba_key(circle_id))
        if raw:
            return json.loads(raw)
        from src.services.community import get_bantaba_circle
        return get_bantaba_circle()

    async def add_member(
        self, circle_id: str, name: str, age: int,
        conditions: List[str], role: str,
    ) -> Dict[str, Any]:
        data = await self.get_bantaba(circle_id)
        data["members"].append({
            "id": f"m{len(data['members'])+1}",
            "name": name, "age": age, "conditions": conditions,
            "adherence_week": 0, "adherence_target": len(conditions) * 7 if conditions else 0,
            "added_by": role, "added_at": datetime.now().isoformat(),
        })
        await self._persist(
            f"bantaba:{circle_id}", "bantaba", data, role, "add_member",
            self._bantaba_key(circle_id),
        )
        return data

    async def remove_member(self, circle_id: str, member_id: str) -> Dict[str, Any]:
        data = await self.get_bantaba(circle_id)
        data["members"] = [m for m in data["members"] if m.get("id") != member_id]
        await self._persist(
            f"bantaba:{circle_id}", "bantaba", data, "vhw", "remove_member",
            self._bantaba_key(circle_id),
        )
        return data

    async def log_adherence(
        self, circle_id: str, member_id: str,
        adherence_week: int, role: str,
    ) -> Dict[str, Any]:
        data = await self.get_bantaba(circle_id)
        for m in data["members"]:
            if m.get("id") == member_id:
                m["adherence_week"] = adherence_week
                m["logged_by"] = role
                m["logged_at"] = datetime.now().isoformat()
                break
        await self._persist(
            f"bantaba:{circle_id}", "bantaba", data, role, "log_adherence",
            self._bantaba_key(circle_id),
        )
        return data

    async def update_bantaba_highlight(
        self, circle_id: str, highlight: str, role: str,
    ) -> Dict[str, Any]:
        data = await self.get_bantaba(circle_id)
        data["this_week_highlight"] = highlight
        await self._persist(
            f"bantaba:{circle_id}", "bantaba", data, role, "update_highlight",
            self._bantaba_key(circle_id),
        )
        return data

    # ── Per-patient Bantaba circles (2026-04-19 rewrite) ──────────
    #
    # A Bantaba is a personal health circle, owned by one patient. The
    # circle's Redis key = `community:bantaba:{patient_id}` so every
    # account carries its own circle without cross-contamination. The
    # patient is the implicit first member; other friends/family are
    # added by the Alkalo for the village.
    #
    # The shared demo circle at `community:bantaba:default` is kept
    # untouched so the existing 97-check sanity tests + mock data
    # keep working.

    async def ensure_patient_circle(
        self, patient_id: str, patient_name: str,
        village: str = "Kerewan",
    ) -> Dict[str, Any]:
        """Get-or-create the circle owned by a specific patient. Idempotent."""
        if not patient_id or not patient_id.strip():
            raise ValueError("patient_id must be a non-empty string")
        raw = self.redis.get(self._bantaba_key(patient_id))
        if raw:
            data = json.loads(raw)
            # If the circle was created under a placeholder name and
            # the patient's real name is now known, upgrade the label.
            if patient_name and data.get("owner_name") != patient_name:
                data["owner_name"] = patient_name
                # Respect a user-set name: only auto-rename if the
                # current name still matches the default template
                # (includes legacy full-name variants so they upgrade
                # to the first-name label on next login).
                prev = (data.get("name") or "").strip()
                if prev == "" or prev.endswith("'s Circle"):
                    data["name"] = f"{_first_name(patient_name)}'s Circle"
                if data.get("members"):
                    first = data["members"][0]
                    if first.get("is_owner"):
                        first["name"] = patient_name
                await self._persist(
                    f"bantaba:{patient_id}", "bantaba", data,
                    "system", "rename_on_login",
                    self._bantaba_key(patient_id),
                )
            return data

        data: Dict[str, Any] = {
            "circle_id":           patient_id,
            "name":                f"{_first_name(patient_name)}'s Circle" if patient_name else "My Circle",
            "owner_id":            patient_id,
            "owner_name":          patient_name or "",
            "village":             village,
            "leader":              patient_name or "",
            "weekly_checkin_day":  "Thursday",
            "weekly_checkin_time": "18:00",
            "streak_weeks":        1,
            "this_week_highlight": "",
            "members":             [{
                "id":               "m1",
                "name":             patient_name or "Owner",
                "age":              0,
                "conditions":       [],
                "adherence_week":   0,
                "adherence_target": 7,
                "is_owner":         True,
                "added_by":         "system",
                "added_at":         datetime.now().isoformat(),
            }],
        }
        await self._persist(
            f"bantaba:{patient_id}", "bantaba", data,
            "system", "create_patient_circle",
            self._bantaba_key(patient_id),
        )
        return data

    async def rename_bantaba(
        self, circle_id: str, new_name: str, role: str,
    ) -> Dict[str, Any]:
        """Rename a circle. Alkalo/admin-gated at the route layer."""
        data = await self.get_bantaba(circle_id)
        cleaned = (new_name or "").strip()
        if not cleaned:
            from fastapi import HTTPException
            raise HTTPException(status_code=400, detail="Circle name cannot be empty")
        data["name"] = cleaned[:80]  # cap for dashboard layout
        await self._persist(
            f"bantaba:{circle_id}", "bantaba", data, role, "rename",
            self._bantaba_key(circle_id),
        )
        return data

    # ── Notifications helpers ────────────────────────────────────
    #
    # `inbox_service.create_item` is the canonical push path for the
    # patient/caregiver inbox UI (polled every 20s by InboxBell).
    # These helpers wrap it with consistent error-swallowing so a
    # downstream Arcade hiccup never blocks the primary business
    # action (add-member, approve-scout, assign-elder). We also
    # expose a best-effort name → patient lookup so the Bantaba flow
    # can notify a candidate who happens to have an Amina account.

    def _notify(
        self, patient_id: str, kind: str, title: str, body: str = "",
        severity: str = "info", source_id: str = "",
        action_url: str = "", metadata: Optional[Dict] = None,
    ) -> Optional[str]:
        """Best-effort inbox push. Returns the created inbox_id or None
        if nothing was delivered (missing patient_id, Arcade down, …)."""
        if not patient_id:
            return None
        try:
            from src.services import inbox_service
            item = inbox_service.create_item(
                patient_id=patient_id,
                kind=kind or "notification",
                title=title or "Amina update",
                body=body or "",
                severity=severity or "info",
                source="system",
                source_id=source_id or "",
                action_url=action_url or "",
                metadata=metadata or {},
                ttl_days=60,
            )
            return (item or {}).get("inbox_id")
        except Exception as exc:
            logger.warning(f"inbox notify failed for {patient_id}: {exc}")
            return None

    @staticmethod
    def _find_patient_by_name(name: str) -> Optional[Dict[str, Any]]:
        """Best-effort patient lookup by name. Returns
        {id, name, phone} or None. Case-insensitive exact match first,
        falls back to a normalized substring match.

        Used by the Bantaba approve flow: if the candidate already has
        an Amina account (e.g. Grandmother Aminata is also a signed-up
        patient) we want to notify her too.
        """
        if not name:
            return None
        try:
            from src.db.arango_client import execute_sql as _sql
        except Exception:
            try:
                from src.db.arcade_client import execute_sql as _sql  # type: ignore
            except Exception:
                try:
                    from src.services.auth import _sql  # type: ignore
                except Exception:
                    return None
        needle = name.strip().lower()
        if not needle:
            return None
        # Try exact-ish match first (case-insensitive).
        try:
            rows = _sql(
                "SELECT id, name, phone FROM PatientVertex "
                "WHERE name.toLowerCase() = :n LIMIT 1",
                {"n": needle},
            ) or []
            if rows:
                r = rows[0]
                return {"id": r.get("id"), "name": r.get("name"), "phone": r.get("phone")}
        except Exception:
            pass
        # Fall back to "starts with" — covers titles like "Grandmother …".
        try:
            rows = _sql(
                "SELECT id, name, phone FROM PatientVertex "
                "WHERE name.toLowerCase() LIKE :p LIMIT 1",
                {"p": f"%{needle}%"},
            ) or []
            if rows:
                r = rows[0]
                return {"id": r.get("id"), "name": r.get("name"), "phone": r.get("phone")}
        except Exception:
            pass
        return None

    # ── Add-member request queue (patient → alkalo approval) ──────
    #
    # A patient cannot directly add someone to their own circle (the
    # Bantaba is still a community instrument, not a personal chat).
    # Instead the patient submits a REQUEST: name, age, conditions,
    # relation (grandmother / brother / co-wife / neighbour / …) and
    # the reason WHY the person should be added. Any Alkalo with the
    # alkalo role can review and approve / reject. On approve the
    # member is auto-added to the requester's circle.
    #
    # Storage: a single Redis HASH `community:bantaba:requests` keyed
    # by req_id. Values are JSON blobs. Persistent 30-day TTL so a
    # backlog never silently evaporates on a Redis restart.

    _REQUESTS_KEY = "community:bantaba:requests"

    @staticmethod
    def _new_req_id() -> str:
        import uuid
        return "breq_" + uuid.uuid4().hex[:12]

    async def create_add_request(
        self,
        requester_id: str,
        requester_name: str,
        requester_circle_id: str,
        candidate_name: str,
        candidate_age: int,
        candidate_conditions: List[str],
        relation: str,
        reason: str,
        phone: str = "",
    ) -> Dict[str, Any]:
        req_id = self._new_req_id()
        req = {
            "req_id":               req_id,
            "status":               "pending",
            "requester_id":         requester_id,
            "requester_name":       requester_name,
            "requester_circle_id":  requester_circle_id,
            "candidate_name":       (candidate_name or "").strip(),
            "candidate_age":        int(candidate_age or 0),
            "candidate_conditions": list(candidate_conditions or []),
            "relation":             (relation or "").strip(),
            "reason":               (reason or "").strip(),
            "phone":                (phone or "").strip(),
            "created_at":           datetime.now().isoformat(),
        }
        try:
            self.redis.hset(self._REQUESTS_KEY, req_id, json.dumps(req, default=str))
            self.redis.expire(self._REQUESTS_KEY, TTL)
        except Exception as exc:
            logger.warning(f"bantaba request persist failed: {exc}")
        return req

    async def list_add_requests(self, status: Optional[str] = None) -> List[Dict[str, Any]]:
        out: List[Dict[str, Any]] = []
        try:
            raw = self.redis.hgetall(self._REQUESTS_KEY) or {}
            for _, v in raw.items():
                try:
                    d = json.loads(v)
                    if status and d.get("status") != status:
                        continue
                    out.append(d)
                except Exception:
                    continue
        except Exception as exc:
            logger.warning(f"bantaba requests read failed: {exc}")
        # Newest first — helps the alkalo triage the freshest ones.
        out.sort(key=lambda r: r.get("created_at") or "", reverse=True)
        return out

    async def _get_request(self, req_id: str) -> Optional[Dict[str, Any]]:
        try:
            raw = self.redis.hget(self._REQUESTS_KEY, req_id)
            return json.loads(raw) if raw else None
        except Exception:
            return None

    async def approve_add_request(self, req_id: str, approver_role: str) -> Dict[str, Any]:
        from fastapi import HTTPException
        req = await self._get_request(req_id)
        if not req:
            raise HTTPException(status_code=404, detail="request not found")
        if req.get("status") != "pending":
            raise HTTPException(
                status_code=409,
                detail=f"request is already {req.get('status')}",
            )
        # Add the candidate to the requester's circle with approver as
        # the audit trail (who accepted the entry).
        await self.add_member(
            req["requester_circle_id"],
            req["candidate_name"],
            req["candidate_age"],
            req["candidate_conditions"],
            approver_role,
        )
        req["status"]        = "approved"
        req["decided_at"]    = datetime.now().isoformat()
        req["decided_by"]    = approver_role
        try:
            self.redis.hset(self._REQUESTS_KEY, req_id, json.dumps(req, default=str))
        except Exception as exc:
            logger.warning(f"bantaba approve persist failed: {exc}")

        # ── Notifications ────────────────────────────────────────
        # 1. Always notify the requester — they asked for this.
        candidate_name = req.get("candidate_name") or ""
        requester_id   = req.get("requester_id") or ""
        notified = {"requester": None, "candidate": None}
        notified["requester"] = self._notify(
            patient_id=requester_id,
            kind="notification",
            title="Bantaba request approved",
            body=(
                f"Your Alkalo approved your request. {candidate_name} has "
                f"been added to your Bantaba circle."
            ),
            severity="info",
            source_id=req_id,
            action_url="/community/bantaba",
            metadata={"req_id": req_id, "event": "bantaba_request_approved"},
        )

        # 2. If the candidate already has an Amina account, notify
        #    them too — they just got added to someone's circle.
        found = self._find_patient_by_name(candidate_name)
        if found and found.get("id") and found["id"] != requester_id:
            requester_name = req.get("requester_name") or "a patient"
            notified["candidate"] = self._notify(
                patient_id=found["id"],
                kind="notification",
                title="You've been added to a Bantaba circle",
                body=(
                    f"{requester_name} invited you to join their Bantaba "
                    f"health circle, and the Alkalo has approved it."
                ),
                severity="info",
                source_id=req_id,
                action_url="/community/bantaba",
                metadata={"req_id": req_id, "event": "bantaba_added_to_circle"},
            )

        req["notified"] = notified
        return req

    async def reject_add_request(
        self, req_id: str, reason: str, rejector_role: str,
    ) -> Dict[str, Any]:
        from fastapi import HTTPException
        req = await self._get_request(req_id)
        if not req:
            raise HTTPException(status_code=404, detail="request not found")
        if req.get("status") != "pending":
            raise HTTPException(
                status_code=409,
                detail=f"request is already {req.get('status')}",
            )
        req["status"]        = "rejected"
        req["decided_at"]    = datetime.now().isoformat()
        req["decided_by"]    = rejector_role
        req["reject_reason"] = (reason or "").strip()
        try:
            self.redis.hset(self._REQUESTS_KEY, req_id, json.dumps(req, default=str))
        except Exception as exc:
            logger.warning(f"bantaba reject persist failed: {exc}")

        # Notify the requester so they see the decision + (optional) reason.
        candidate_name = req.get("candidate_name") or "your candidate"
        body = f"Your Alkalo reviewed your request to add {candidate_name}."
        if req["reject_reason"]:
            body += f"\n\nReason: {req['reject_reason']}"
        req["notified"] = {
            "requester": self._notify(
                patient_id=req.get("requester_id") or "",
                kind="notification",
                title="Bantaba request not approved",
                body=body,
                severity="warning",
                source_id=req_id,
                action_url="/community/bantaba",
                metadata={"req_id": req_id, "event": "bantaba_request_rejected"},
            ),
        }
        return req

    async def list_patient_circles(self) -> List[Dict[str, Any]]:
        """All known circles keyed on patient ids (used by Alkalo to
        pick which circle to edit). Includes the shared demo circle
        too so operators can always fall back to it."""
        out: List[Dict[str, Any]] = []
        # Scan for all community:bantaba:* keys (OK: small cardinality
        # in demo; acceptable 30-day-TTL pool in prod).
        try:
            for key in self.redis.scan_iter(match="community:bantaba:*"):
                raw = self.redis.get(key)
                if not raw:
                    continue
                try:
                    d = json.loads(raw)
                    out.append({
                        "circle_id":   d.get("circle_id", str(key).split(":")[-1]),
                        "name":        d.get("name", "(unnamed)"),
                        "owner_name":  d.get("owner_name", ""),
                        "village":     d.get("village", ""),
                        "members":     len(d.get("members") or []),
                    })
                except Exception:
                    continue
        except Exception as exc:
            logger.warning(f"scan_iter failed for bantaba list: {exc}")
        # Stable ordering: demo circle last, everything else alpha
        out.sort(key=lambda x: (x["circle_id"] == "default", x["name"].lower()))
        return out

    # ═══════════════════════════════════════════════════════════
    # VILLAGE SCOREBOARD
    # ═══════════════════════════════════════════════════════════

    def _village_key(self, village: str = "Kerewan") -> str:
        return f"community:village:{village}"

    async def get_village(self, village: str = "Kerewan") -> Dict[str, Any]:
        raw = self.redis.get(self._village_key(village))
        if raw:
            return json.loads(raw)
        from src.services.community import get_village_scoreboard
        data = get_village_scoreboard(village)
        self.redis.setex(self._village_key(village), TTL, json.dumps(data, default=str))
        return data

    async def update_pillar(
        self, village: str, pillar_id: str,
        score: int, detail: str, role: str,
    ) -> Dict[str, Any]:
        data = await self.get_village(village)
        for p in data.get("pillars", []):
            if p["id"] == pillar_id:
                p["score"] = min(score, p["max"])
                if detail:
                    p["detail"] = detail
                p["updated_by"] = role
                break
        data["score"] = sum(p["score"] for p in data.get("pillars", []))
        await self._persist(
            f"village:{village}", "village", data, role, f"update_pillar:{pillar_id}",
            self._village_key(village),
        )
        return data

    async def add_alkalo_note(
        self, village: str, note: str,
    ) -> Dict[str, Any]:
        data = await self.get_village(village)
        data["alkalo_notes"] = data.get("alkalo_notes", [])
        data["alkalo_notes"].append({
            "note": note,
            "at": datetime.now().isoformat(),
        })
        if len(data["alkalo_notes"]) > 10:
            data["alkalo_notes"] = data["alkalo_notes"][-10:]
        await self._persist(
            f"village:{village}", "village", data, "alkalo", "alkalo_note",
            self._village_key(village),
        )
        return data

    # ═══════════════════════════════════════════════════════════
    # YOUTH SCOUT
    # ═══════════════════════════════════════════════════════════

    def _scout_key(self, scout_id: str = "default") -> str:
        return f"community:scout:{scout_id}"

    async def get_scout(self, scout_id: str = "default") -> Dict[str, Any]:
        raw = self.redis.get(self._scout_key(scout_id))
        if raw:
            data = json.loads(raw)
        else:
            from src.services.community import get_youth_scout
            data = get_youth_scout()
            self.redis.setex(self._scout_key(scout_id), TTL, json.dumps(data, default=str))
        # Enrich with computed badge + weekly duty
        data["badge"] = self._compute_badge(data.get("total_checks", 0))
        data["weekly_duty"] = self._get_weekly_duty(data.get("scout_id", scout_id))
        data["scout_greeting"] = self._get_scout_greeting(data)
        return data

    # ═══════════════════════════════════════════════════════════
    # SCOUT REWARDS + DUTY SYSTEM
    # ═══════════════════════════════════════════════════════════

    BADGE_LADDER = [
        {"id": "first_check", "name": "First Check", "min_checks": 1, "color": "bronze",
         "reward": "You completed your first elder health check. The village thanks you."},
        {"id": "heart_watcher", "name": "Heart Watcher", "min_checks": 5, "color": "silver",
         "reward": "5 elders checked. You are becoming a trusted health scout. Your CHW will nominate you for training."},
        {"id": "village_scout", "name": "Village Scout Leader", "min_checks": 15, "color": "gold",
         "reward": "15 checks completed. You may now train other youth scouts. Certificate from VHW."},
        {"id": "amina_ambassador", "name": "AMINA Ambassador", "min_checks": 40, "color": "platinum",
         "reward": "40 checks. You are recognized at the village level. The Alkalo will announce your achievement at the next Bantaba."},
    ]

    WEEKLY_DUTIES = [
        "Check all assigned elders' BP this week.",
        "Ask each elder: 'Did you take your medicine every day?'",
        "Report any elder with BP above 160 to the VHW immediately.",
        "Remind your elders about their next health post visit.",
        "Ask your grandmother/elder: 'How are you sleeping? Any new pain?'",
    ]

    def _compute_badge(self, total_checks: int) -> Dict[str, Any]:
        """Compute current badge + next badge + progress."""
        current = self.BADGE_LADDER[0]
        next_badge = None
        for i, b in enumerate(self.BADGE_LADDER):
            if total_checks >= b["min_checks"]:
                current = b
                next_badge = self.BADGE_LADDER[i + 1] if i + 1 < len(self.BADGE_LADDER) else None
            else:
                next_badge = b
                break
        progress = 0
        if next_badge:
            span = next_badge["min_checks"] - current["min_checks"]
            done = total_checks - current["min_checks"]
            progress = min(100, round(100 * done / span)) if span > 0 else 100
        return {
            "current": current,
            "next": next_badge,
            "progress_to_next": progress,
            "total_checks": total_checks,
        }

    def _get_weekly_duty(self, scout_id: str) -> str:
        """Deterministic weekly duty based on scout_id + week number."""
        import hashlib
        week = datetime.now().isocalendar()[1]
        seed = int(hashlib.md5(f"{scout_id}:{week}".encode()).hexdigest(), 16)
        return self.WEEKLY_DUTIES[seed % len(self.WEEKLY_DUTIES)]

    def _get_scout_greeting(self, scout_data: Dict) -> str:
        """Generate a personalized scout greeting with duties + rewards."""
        name = scout_data.get("name", "Scout")
        badge = self._compute_badge(scout_data.get("total_checks", 0))
        duty = self._get_weekly_duty(scout_data.get("scout_id", "default"))

        lines = [f"Welcome back, Scout {name}!"]

        # Badge progress
        if badge["next"]:
            lines.append(
                f"You are a {badge['current']['name']} with {badge['total_checks']} check-ins. "
                f"{badge['progress_to_next']}% progress to {badge['next']['name']}."
            )
        else:
            lines.append(f"You are an {badge['current']['name']} — the highest rank. Well done!")

        # Reward info
        if badge["current"].get("reward"):
            lines.append(f"Reward: {badge['current']['reward']}")

        # This week's duty
        lines.append(f"This week's duty: {duty}")

        # Elders status
        elders = scout_data.get("elders_monitored", [])
        if elders:
            overdue = [e for e in elders if e.get("last_check") in ("not yet", None) or e.get("flag") == "red"]
            if overdue:
                lines.append(f"Urgent: {len(overdue)} elder(s) need a check — {', '.join(e['name'] for e in overdue[:3])}")

        return "\n".join(lines)

    async def list_scouts(self) -> List[Dict[str, Any]]:
        """List all scout profiles. Deduplicates by name and filters removed entries."""
        scouts = []
        seen_names = set()
        try:
            keys = self.redis.keys("community:scout:*") or []
            for k in keys:
                raw = self.redis.get(k)
                if not raw:
                    continue
                d = json.loads(raw)
                # Skip removed/ghost entries
                if d.get("removed"):
                    self.redis.delete(k)
                    continue
                # Skip entries without a name
                name = (d.get("name") or "").strip().lower()
                if not name:
                    self.redis.delete(k)
                    continue
                # Deduplicate by name (keep first seen)
                if name in seen_names:
                    self.redis.delete(k)
                    continue
                seen_names.add(name)
                scouts.append(d)
        except Exception:
            pass
        if not scouts:
            scouts.append(await self.get_scout("default"))
        return scouts

    async def create_scout(
        self, name: str, age: int, village: str, role: str,
    ) -> Dict[str, Any]:
        """Create a new youth scout profile. Rejects if a scout with the same name exists."""
        # Check for duplicate name
        existing = await self.list_scouts()
        name_lower = name.strip().lower()
        for s in existing:
            if (s.get("name") or "").strip().lower() == name_lower:
                return {"error": f"A scout named '{name}' already exists.", "duplicate": True, "existing_scout_id": s.get("scout_id")}

        import uuid
        scout_id = f"scout_{name.lower().replace(' ', '_')}_{uuid.uuid4().hex[:4]}"
        data = {
            "scout_id": scout_id,
            "name": name,
            "age": age,
            "village": village,
            "total_checks": 0,
            "badge": {
                "current": {"id": "first_check", "name": "First Check", "min_checks": 1, "color": "bronze"},
                "next": {"id": "heart_watcher", "name": "Heart Watcher", "min_checks": 5, "color": "silver"},
                "progress_to_next": 0,
            },
            "elders_monitored": [],
            "this_week_mission": {
                "title": "Check your first elder's BP this week",
                "progress": 0,
                "target": 1,
                "reward": "Unlocks 'First Check' badge",
            },
            "rank_in_village": 0,
            "total_scouts_in_village": 0,
            "created_by": role,
            "created_at": datetime.now().isoformat(),
        }
        await self._persist(
            f"scout:{scout_id}", "scout", data, role, "create_scout",
            self._scout_key(scout_id),
        )
        return data

    async def remove_scout(self, scout_id: str, role: str) -> bool:
        """Remove/deactivate a scout. VHW/Clinician only."""
        key = self._scout_key(scout_id)
        try:
            self.redis.delete(key)
            await self._persist(
                f"scout:{scout_id}", "scout", {"removed": True, "scout_id": scout_id},
                role, "remove_scout", key,
            )
            return True
        except Exception:
            return False

    async def apply_for_scout(
        self, name: str, age: int, village: str, phone: str = "",
        # New fields (2026-04-19 scout redesign) — all optional for
        # backward compatibility with older demo scripts.
        applicant_id: str = "",
        locality: str = "",
        availability: str = "",
        reason: str = "",
    ) -> Dict[str, Any]:
        """Patient applies to become a scout. Age must be 12..24.

        Creates a pending application record for the Alkalo inbox. If
        an applicant_id (patient JWT sub) is provided, we stamp it on
        the application so:
          - the applicant gets an "application received" confirmation
            notification,
          - on approval they get a "you're now a scout" notification,
          - on elder assignment they get a "new elder assigned" ping.
        """
        if age >= 25:
            return {"approved": False, "reason": "Youth scouts must be under 25 years old."}
        if age < 12:
            return {"approved": False, "reason": "You must be at least 12 years old to apply."}
        # Check if a scout with this name already exists
        existing = await self.list_scouts()
        name_lower = name.strip().lower()
        for s in existing:
            if (s.get("name") or "").strip().lower() == name_lower:
                return {"approved": False, "reason": f"A scout named '{name}' already exists. You may already be registered."}

        app_id = f"scout_app_{name.lower().replace(' ', '_')}_{datetime.now().strftime('%Y%m%d')}"
        application = {
            "app_id":       app_id,
            "name":         name,
            "age":          age,
            "village":      village,
            "phone":        phone,
            "applicant_id": applicant_id or "",
            "locality":     (locality or "").strip(),
            "availability": (availability or "").strip(),
            "reason":       (reason or "").strip(),
            "status":       "pending",
            "applied_at":   datetime.now().isoformat(),
        }
        # Store in Redis
        key = f"scout_application:{app_id}"
        self.redis.setex(key, 30 * 86400, json.dumps(application, default=str))
        # Add to applications list
        self.redis.lpush("scout_applications:pending", json.dumps(application, default=str))
        self.redis.ltrim("scout_applications:pending", 0, 99)

        # Ack notification to the applicant (if they're signed in).
        if applicant_id:
            self._notify(
                patient_id=applicant_id,
                kind="notification",
                title="Scout application received",
                body=(
                    f"We got your application to become a Youth Scout, {name}. "
                    f"Your Alkalo will review it and decide — you will be "
                    f"notified as soon as they do."
                ),
                severity="info",
                source_id=app_id,
                action_url="/community/scouts",
                metadata={"app_id": app_id, "event": "scout_application_received"},
            )

        return {"approved": True, "status": "pending", "application": application,
                "message": f"Your application has been submitted, {name}. "
                           f"Your Alkalo will review it soon."}

    async def get_pending_applications(self) -> List[Dict[str, Any]]:
        """Get all pending scout applications. VHW only."""
        try:
            raw_list = self.redis.lrange("scout_applications:pending", 0, -1) or []
            apps = [json.loads(r) for r in raw_list]
            return [a for a in apps if a.get("status") == "pending"]
        except Exception:
            return []

    async def approve_scout_application(
        self, app_id: str, role: str,
    ) -> Dict[str, Any]:
        """Alkalo approves a scout application → creates the scout
        profile, stamps it with the applicant's patient_id (so elder
        assignments can notify them later), and drops a congrats
        notification into the applicant's inbox."""
        key = f"scout_application:{app_id}"
        raw = self.redis.get(key)
        if not raw:
            return {"error": "Application not found"}
        app = json.loads(raw)
        if app.get("status") != "pending":
            return {"error": f"Application already {app.get('status')}"}

        # Create the scout, then stamp location/availability/applicant
        # metadata onto the record so later assignments can consider it.
        scout = await self.create_scout(app["name"], app["age"], app["village"], role)
        sid   = scout.get("scout_id") or ""
        if sid:
            # Re-read via the regular loader, merge extras, persist.
            try:
                sdata = await self.get_scout(sid)
                if app.get("applicant_id"): sdata["applicant_id"] = app["applicant_id"]
                if app.get("locality"):     sdata["locality"]     = app["locality"]
                if app.get("availability"): sdata["availability"] = app["availability"]
                if app.get("phone"):        sdata["phone"]        = app["phone"]
                await self._persist(
                    f"scout:{sid}", "scout", sdata, role, "approve_application",
                    self._scout_key(sid),
                )
                scout = sdata
            except Exception as exc:
                logger.warning(f"scout metadata stamp failed: {exc}")

        # Mark application as approved
        app["status"]      = "approved"
        app["approved_by"] = role
        app["approved_at"] = datetime.now().isoformat()
        app["scout_id"]    = sid
        self.redis.setex(key, 30 * 86400, json.dumps(app, default=str))

        # Notify the applicant: you're now a scout.
        if app.get("applicant_id"):
            self._notify(
                patient_id=app["applicant_id"],
                kind="notification",
                title="You are now a Youth Scout 🏅",
                body=(
                    f"Congratulations, {app.get('name')} — your Alkalo approved "
                    f"your application. You are now officially a Youth Scout in "
                    f"{app.get('village') or 'your village'}. Your Alkalo will "
                    f"assign elders for you to check on based on where you live "
                    f"and when you are free."
                ),
                severity="info",
                source_id=app_id,
                action_url="/community/scouts",
                metadata={
                    "app_id": app_id, "scout_id": sid,
                    "event": "scout_application_approved",
                },
            )

        return {"approved": True, "scout": scout, "application": app}

    async def reject_scout_application(
        self, app_id: str, reason: str, role: str,
    ) -> Dict[str, Any]:
        """Alkalo rejects. Notifies the applicant (with the reason if
        provided) so they know the outcome."""
        key = f"scout_application:{app_id}"
        raw = self.redis.get(key)
        if not raw:
            return {"error": "Application not found"}
        app = json.loads(raw)
        app["status"]           = "rejected"
        app["rejected_by"]      = role
        app["rejected_at"]      = datetime.now().isoformat()
        app["rejection_reason"] = reason
        self.redis.setex(key, 30 * 86400, json.dumps(app, default=str))

        if app.get("applicant_id"):
            body = (
                f"Your Alkalo reviewed your application to become a "
                f"Youth Scout. They decided not to approve it this time."
            )
            if reason:
                body += f"\n\nReason: {reason}"
            self._notify(
                patient_id=app["applicant_id"],
                kind="notification",
                title="Scout application not approved",
                body=body,
                severity="warning",
                source_id=app_id,
                action_url="/community/scouts",
                metadata={"app_id": app_id, "event": "scout_application_rejected"},
            )

        return {"rejected": True, "application": app}

    async def assign_elder(
        self, scout_id: str, elder_name: str, relation: str,
        age: int, role: str,
    ) -> Dict[str, Any]:
        data = await self.get_scout(scout_id)
        data["elders_monitored"].append({
            "name": elder_name, "relation": relation, "age": age,
            "last_check": "not yet", "last_bp": "—",
            "flag": "green", "assigned_by": role,
            "assigned_at": datetime.now().isoformat(),
        })
        await self._persist(
            f"scout:{scout_id}", "scout", data, role, "assign_elder",
            self._scout_key(scout_id),
        )

        # Notify the scout (if they have an Amina account linked via
        # applicant_id stamped during application approval).
        applicant_id = data.get("applicant_id") or ""
        if applicant_id:
            ctx_bits = []
            if data.get("locality"):     ctx_bits.append(f"in {data['locality']}")
            if data.get("availability"): ctx_bits.append(f"around {data['availability']}")
            ctx = f" ({'; '.join(ctx_bits)})" if ctx_bits else ""
            self._notify(
                patient_id=applicant_id,
                kind="notification",
                title=f"New elder assigned: {elder_name}",
                body=(
                    f"Your Alkalo asked you to check on {elder_name} "
                    f"({relation}, {age}){ctx}. Please visit soon and log "
                    f"the BP reading in your scout book."
                ),
                severity="info",
                source_id=scout_id,
                action_url="/community/scouts",
                metadata={
                    "scout_id":  scout_id,
                    "elder":     elder_name,
                    "relation":  relation,
                    "event":     "scout_elder_assigned",
                },
            )
        return data

    async def log_elder_check(
        self, scout_id: str, elder_name: str,
        bp: str, flag: str, role: str,
    ) -> Dict[str, Any]:
        data = await self.get_scout(scout_id)
        for elder in data["elders_monitored"]:
            if elder["name"].lower() == elder_name.lower():
                elder["last_check"] = "today"
                elder["last_bp"] = bp
                elder["flag"] = flag  # "green" | "yellow" | "red"
                elder["checked_by"] = role
                elder["checked_at"] = datetime.now().isoformat()
                break
        data["total_checks"] = data.get("total_checks", 0) + 1
        if data.get("this_week_mission"):
            data["this_week_mission"]["progress"] = min(
                data["this_week_mission"]["progress"] + 1,
                data["this_week_mission"]["target"],
            )
        await self._persist(
            f"scout:{scout_id}", "scout", data, role, "log_elder_check",
            self._scout_key(scout_id),
        )
        return data

    # ═══════════════════════════════════════════════════════════
    # SEASONAL TIPS (custom)
    # ═══════════════════════════════════════════════════════════

    def _custom_tips_key(self) -> str:
        return "community:custom_tips"

    async def get_custom_tips(self) -> List[Dict[str, str]]:
        raw = self.redis.get(self._custom_tips_key())
        return json.loads(raw) if raw else []

    async def add_custom_tip(
        self, icon: str, tip: str, season: str, role: str,
    ) -> List[Dict[str, str]]:
        tips = await self.get_custom_tips()
        tips.append({
            "icon": icon, "tip": tip, "season": season,
            "added_by": role, "added_at": datetime.now().isoformat(),
        })
        self.redis.setex(self._custom_tips_key(), TTL, json.dumps(tips, default=str))
        return tips
