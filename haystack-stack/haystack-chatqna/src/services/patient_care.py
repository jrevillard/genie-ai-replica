"""
Patient Care Data Service — Medicine Supply + Dual-Path Care

Provides CRUD for:
  1. Medicine Supply (stock levels, refill location, cost, days remaining)
  2. Dual-Path Care (traditional + modern care tracking)

Data stored in Redis with TTL. Auto-updating mock simulation decays
medicine_days_remaining by 1 every time it's read (simulates daily consumption).

ROLES:
  - patient: read-only view
  - clinician / vhw: full read + write (can update supply, log visits, flag interactions)
  - alkalo: read-only village-wide summary
"""

from typing import Dict, Any, Optional, List
from datetime import datetime, timedelta
import json
import logging
import asyncio

logger = logging.getLogger(__name__)

# Default seed data — used when no patient-specific record exists
_DEFAULT_SUPPLY = {
    "medications": [
        {
            "name": "Amlodipine",
            "dosage": "5mg",
            "frequency": "daily",
            "tablets_remaining": 18,
            "tablets_per_day": 1,
            "cost_per_pack": "20 dalasi / 30 tablets",
            "refill_location": "Kerewan clinic",
            "in_stock": True,
            "last_refill": None,
            "next_refill_due": None,
        },
    ],
    "updated_at": None,
    "updated_by": None,
}

_DEFAULT_DUAL_PATH = {
    "traditional_care": {
        "active": True,
        "practitioner": "Local marabout",
        "practices": ["Prayers for wellbeing", "Bitter leaf tea (herbal)"],
        "last_visit_days_ago": 9,
        "last_visit_date": None,
        "notes": "",
    },
    "modern_care": {
        "active": True,
        "facility": "Kerewan Health Centre",
        "chw_name": "VHW Mariama",
        "medications": ["Amlodipine 5mg daily"],
        "last_visit_days_ago": 14,
        "last_visit_date": None,
        "notes": "",
    },
    "interactions_flag": {
        "safe": True,
        "notes": "Bitter leaf tea has no known interaction with amlodipine.",
        "checked_by": None,
        "checked_at": None,
    },
    "progress": {
        "bp_start": "160/100",
        "bp_current": "135/85",
        "months_on_plan": 3,
        "message": "Both paths are working together. Your pressure has dropped 25 points in 3 months.",
    },
    "updated_at": None,
    "updated_by": None,
}


class PatientCareService:
    """Redis-backed CRUD for medicine supply + dual-path care.

    Keys:
      care:supply:{session_id}     → medicine supply JSON
      care:dualpath:{session_id}   → dual-path care JSON
    """

    def __init__(self, redis_client):
        self.redis = redis_client
        self.ttl = 30 * 86400  # 30 days

    async def _persist_to_arcade(
        self, doc_id: str, category: str, data: Dict, role: str, action: str,
    ):
        """Fire-and-forget ArcadeDB write-through (non-blocking)."""
        try:
            from src.db.community_store import save_to_arcade
            asyncio.create_task(save_to_arcade(doc_id, category, data, role, action))
        except Exception as e:
            logger.warning(f"ArcadeDB write-through failed: {e}")

    def _supply_key(self, session_id: str) -> str:
        return f"care:supply:{session_id}"

    def _dualpath_key(self, session_id: str) -> str:
        return f"care:dualpath:{session_id}"

    # ── MEDICINE SUPPLY ────────────────────────────────────────

    async def get_supply(self, session_id: str) -> Dict[str, Any]:
        """Get medicine supply. Auto-seeds + auto-decays days remaining."""
        try:
            raw = self.redis.get(self._supply_key(session_id))
            if raw:
                data = json.loads(raw)
            else:
                data = json.loads(json.dumps(_DEFAULT_SUPPLY))
                data["updated_at"] = datetime.now().isoformat()

            # Auto-decay: simulate daily consumption
            for med in data.get("medications", []):
                tabs = med.get("tablets_remaining", 0)
                per_day = med.get("tablets_per_day", 1)
                days_remaining = max(0, tabs // per_day) if per_day > 0 else 0
                med["days_remaining"] = days_remaining
                med["low_stock"] = days_remaining <= 7
                med["critical_stock"] = days_remaining <= 3
                # Estimated next refill date
                if days_remaining > 0:
                    med["estimated_runout"] = (
                        datetime.now() + timedelta(days=days_remaining)
                    ).strftime("%Y-%m-%d")
                else:
                    med["estimated_runout"] = "NOW — out of stock"

            # Persist the (potentially auto-seeded) data
            self.redis.setex(self._supply_key(session_id), self.ttl, json.dumps(data, default=str))
            return data
        except Exception as e:
            logger.warning(f"Failed to get supply: {e}")
            return _DEFAULT_SUPPLY

    async def update_supply(
        self,
        session_id: str,
        medication_name: str,
        tablets_remaining: Optional[int] = None,
        cost_per_pack: Optional[str] = None,
        refill_location: Optional[str] = None,
        in_stock: Optional[bool] = None,
        updated_by: str = "clinician",
    ) -> Dict[str, Any]:
        """Update a specific medication's supply info. Clinician/VHW only."""
        data = await self.get_supply(session_id)
        found = False
        for med in data.get("medications", []):
            if med["name"].lower() == medication_name.lower():
                found = True
                if tablets_remaining is not None:
                    med["tablets_remaining"] = tablets_remaining
                    med["last_refill"] = datetime.now().isoformat()
                if cost_per_pack is not None:
                    med["cost_per_pack"] = cost_per_pack
                if refill_location is not None:
                    med["refill_location"] = refill_location
                if in_stock is not None:
                    med["in_stock"] = in_stock
                break

        if not found:
            # Add new medication to supply
            data["medications"].append({
                "name": medication_name,
                "dosage": "",
                "frequency": "",
                "tablets_remaining": tablets_remaining or 0,
                "tablets_per_day": 1,
                "cost_per_pack": cost_per_pack or "",
                "refill_location": refill_location or "",
                "in_stock": in_stock if in_stock is not None else True,
                "last_refill": datetime.now().isoformat(),
            })

        data["updated_at"] = datetime.now().isoformat()
        data["updated_by"] = updated_by
        self.redis.setex(self._supply_key(session_id), self.ttl, json.dumps(data, default=str))
        await self._persist_to_arcade(f"supply:{session_id}", "supply", data, updated_by, "update_supply")
        return data

    async def dispense_dose(self, session_id: str, medication_name: str) -> Dict[str, Any]:
        """Decrement tablets_remaining by tablets_per_day. Called daily by auto-updater."""
        data = await self.get_supply(session_id)
        for med in data.get("medications", []):
            if med["name"].lower() == medication_name.lower():
                per_day = med.get("tablets_per_day", 1)
                med["tablets_remaining"] = max(0, med.get("tablets_remaining", 0) - per_day)
                break
        data["updated_at"] = datetime.now().isoformat()
        self.redis.setex(self._supply_key(session_id), self.ttl, json.dumps(data, default=str))
        return data

    # ── DUAL-PATH CARE ─────────────────────────────────────────

    async def get_dual_path(self, session_id: str) -> Dict[str, Any]:
        """Get dual-path care data. Auto-seeds with defaults."""
        try:
            raw = self.redis.get(self._dualpath_key(session_id))
            if raw:
                data = json.loads(raw)
            else:
                data = json.loads(json.dumps(_DEFAULT_DUAL_PATH))
                data["updated_at"] = datetime.now().isoformat()
                self.redis.setex(self._dualpath_key(session_id), self.ttl, json.dumps(data, default=str))
                await self._persist_to_arcade(f"dualpath:{session_id}", "dualpath", data, updated_by if "updated_by" in dir() else "system", "get_dual_path")
            return data
        except Exception as e:
            logger.warning(f"Failed to get dual path: {e}")
            return _DEFAULT_DUAL_PATH

    async def update_traditional_care(
        self,
        session_id: str,
        practitioner: Optional[str] = None,
        practices: Optional[List[str]] = None,
        last_visit_days_ago: Optional[int] = None,
        notes: Optional[str] = None,
        updated_by: str = "clinician",
    ) -> Dict[str, Any]:
        """Update traditional care details. Clinician/VHW only."""
        data = await self.get_dual_path(session_id)
        tc = data["traditional_care"]
        if practitioner is not None:
            tc["practitioner"] = practitioner
        if practices is not None:
            tc["practices"] = practices
        if last_visit_days_ago is not None:
            tc["last_visit_days_ago"] = last_visit_days_ago
            tc["last_visit_date"] = (datetime.now() - timedelta(days=last_visit_days_ago)).strftime("%Y-%m-%d")
        if notes is not None:
            tc["notes"] = notes
        data["updated_at"] = datetime.now().isoformat()
        data["updated_by"] = updated_by
        self.redis.setex(self._dualpath_key(session_id), self.ttl, json.dumps(data, default=str))
        await self._persist_to_arcade(f"dualpath:{session_id}", "dualpath", data, updated_by if "updated_by" in dir() else "system", "update_dualpath")
        return data

    async def update_modern_care(
        self,
        session_id: str,
        facility: Optional[str] = None,
        chw_name: Optional[str] = None,
        medications: Optional[List[str]] = None,
        last_visit_days_ago: Optional[int] = None,
        notes: Optional[str] = None,
        updated_by: str = "clinician",
    ) -> Dict[str, Any]:
        """Update modern care details. Clinician/VHW only."""
        data = await self.get_dual_path(session_id)
        mc = data["modern_care"]
        if facility is not None:
            mc["facility"] = facility
        if chw_name is not None:
            mc["chw_name"] = chw_name
        if medications is not None:
            mc["medications"] = medications
        if last_visit_days_ago is not None:
            mc["last_visit_days_ago"] = last_visit_days_ago
            mc["last_visit_date"] = (datetime.now() - timedelta(days=last_visit_days_ago)).strftime("%Y-%m-%d")
        if notes is not None:
            mc["notes"] = notes
        data["updated_at"] = datetime.now().isoformat()
        data["updated_by"] = updated_by
        self.redis.setex(self._dualpath_key(session_id), self.ttl, json.dumps(data, default=str))
        await self._persist_to_arcade(f"dualpath:{session_id}", "dualpath", data, updated_by if "updated_by" in dir() else "system", "update_dualpath")
        return data

    async def update_interaction_flag(
        self,
        session_id: str,
        safe: bool,
        notes: str,
        checked_by: str = "clinician",
    ) -> Dict[str, Any]:
        """Flag or clear herb-drug interaction concerns. Clinician only."""
        data = await self.get_dual_path(session_id)
        data["interactions_flag"] = {
            "safe": safe,
            "notes": notes,
            "checked_by": checked_by,
            "checked_at": datetime.now().isoformat(),
        }
        data["updated_at"] = datetime.now().isoformat()
        data["updated_by"] = checked_by
        self.redis.setex(self._dualpath_key(session_id), self.ttl, json.dumps(data, default=str))
        await self._persist_to_arcade(f"dualpath:{session_id}", "dualpath", data, updated_by if "updated_by" in dir() else "system", "update_dualpath")
        return data

    async def update_progress(
        self,
        session_id: str,
        bp_current: Optional[str] = None,
        months_on_plan: Optional[int] = None,
        message: Optional[str] = None,
        updated_by: str = "clinician",
    ) -> Dict[str, Any]:
        """Update patient progress tracking."""
        data = await self.get_dual_path(session_id)
        prog = data["progress"]
        if bp_current is not None:
            prog["bp_current"] = bp_current
        if months_on_plan is not None:
            prog["months_on_plan"] = months_on_plan
        if message is not None:
            prog["message"] = message
        data["updated_at"] = datetime.now().isoformat()
        data["updated_by"] = updated_by
        self.redis.setex(self._dualpath_key(session_id), self.ttl, json.dumps(data, default=str))
        await self._persist_to_arcade(f"dualpath:{session_id}", "dualpath", data, updated_by if "updated_by" in dir() else "system", "update_dualpath")
        return data
