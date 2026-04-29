"""
Caregiver Repository — ArcadeDB CRUD
======================================
Manages CaregiverVertex and CaregiverPatientEdge.

Graph structure:
  (CaregiverVertex) -[CaregiverPatientEdge]-> (PatientVertex)

Edge properties store: permissions, consent_date, is_revoked, etc.
"""

import json
import uuid
import hashlib
import hmac
import logging
from datetime import datetime
from typing import Optional, List, Dict, Any

import requests

from src.config import settings

logger = logging.getLogger(__name__)


def _sql(query: str, params: dict = None) -> dict:
    payload = {"language": "sql", "command": query}
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


def _rows(resp: dict) -> List[Dict]:
    result = resp.get("result", [])
    if isinstance(result, list):
        return result
    return []


def _hash_pin(pin: str, salt: str) -> str:
    return hmac.new(salt.encode(), pin.encode(), hashlib.sha256).hexdigest()


def _caregiver_id(phone: str) -> str:
    return f"CG_{hashlib.md5(phone.encode()).hexdigest()[:8].upper()}"


class CaregiverRepository:

    def ensure_schema(self):
        """Create CaregiverVertex and CaregiverPatientEdge if not present."""
        ddl = [
            "CREATE VERTEX TYPE CaregiverVertex IF NOT EXISTS",
            "CREATE EDGE TYPE CaregiverPatientEdge IF NOT EXISTS",

            "CREATE PROPERTY CaregiverVertex.caregiver_id IF NOT EXISTS STRING",
            "CREATE PROPERTY CaregiverVertex.name IF NOT EXISTS STRING",
            "CREATE PROPERTY CaregiverVertex.phone IF NOT EXISTS STRING",
            "CREATE PROPERTY CaregiverVertex.pin_hash IF NOT EXISTS STRING",
            "CREATE PROPERTY CaregiverVertex.pin_salt IF NOT EXISTS STRING",
            "CREATE PROPERTY CaregiverVertex.relationship IF NOT EXISTS STRING",
            "CREATE PROPERTY CaregiverVertex.created_at IF NOT EXISTS STRING",
            "CREATE PROPERTY CaregiverVertex.last_login IF NOT EXISTS STRING",

            "CREATE PROPERTY CaregiverPatientEdge.patient_id IF NOT EXISTS STRING",
            "CREATE PROPERTY CaregiverPatientEdge.caregiver_id IF NOT EXISTS STRING",
            "CREATE PROPERTY CaregiverPatientEdge.permissions IF NOT EXISTS STRING",
            "CREATE PROPERTY CaregiverPatientEdge.consent_date IF NOT EXISTS STRING",
            "CREATE PROPERTY CaregiverPatientEdge.granted_by IF NOT EXISTS STRING",
            "CREATE PROPERTY CaregiverPatientEdge.is_revoked IF NOT EXISTS BOOLEAN",
            "CREATE PROPERTY CaregiverPatientEdge.revoked_at IF NOT EXISTS STRING",
            "CREATE PROPERTY CaregiverPatientEdge.note IF NOT EXISTS STRING",

            "CREATE PROPERTY CaregiverVertex.patient_limit IF NOT EXISTS INTEGER",
            "CREATE PROPERTY CaregiverVertex.bio IF NOT EXISTS STRING",
            "CREATE PROPERTY CaregiverVertex.specialization IF NOT EXISTS STRING",
            "CREATE PROPERTY CaregiverVertex.profile_photo IF NOT EXISTS STRING",
            "CREATE PROPERTY CaregiverVertex.region IF NOT EXISTS STRING",
            "CREATE PROPERTY CaregiverVertex.years_experience IF NOT EXISTS INTEGER",
            "CREATE PROPERTY CaregiverVertex.languages IF NOT EXISTS STRING",
            "CREATE PROPERTY CaregiverVertex.specialty_tags IF NOT EXISTS STRING",
            "CREATE PROPERTY CaregiverVertex.max_patients IF NOT EXISTS INTEGER",
            "CREATE PROPERTY CaregiverVertex.is_directory_visible IF NOT EXISTS BOOLEAN",
            "CREATE PROPERTY CaregiverVertex.accepting_patients IF NOT EXISTS BOOLEAN",

            "CREATE INDEX IF NOT EXISTS ON CaregiverVertex (caregiver_id) UNIQUE",
            "CREATE INDEX IF NOT EXISTS ON CaregiverVertex (phone) UNIQUE",
        ]
        for stmt in ddl:
            try:
                _sql(stmt)
            except Exception as e:
                logger.warning(f"Schema step: {stmt[:60]}... -> {e}")

    # ── Caregiver CRUD ──────────────────────────────────────────────────────

    def get_by_phone(self, phone: str) -> Optional[Dict]:
        rows = _rows(_sql(
            "SELECT * FROM CaregiverVertex WHERE phone = :phone LIMIT 1",
            {"phone": phone},
        ))
        return rows[0] if rows else None

    def get_by_id(self, caregiver_id: str) -> Optional[Dict]:
        rows = _rows(_sql(
            "SELECT * FROM CaregiverVertex WHERE caregiver_id = :cid LIMIT 1",
            {"cid": caregiver_id},
        ))
        return rows[0] if rows else None

    def create(self, phone: str, name: str, pin: str, relationship: str) -> Dict:
        if self.get_by_phone(phone):
            raise ValueError("Phone already registered as caregiver")

        caregiver_id = _caregiver_id(phone)
        salt = uuid.uuid4().hex[:16]
        pin_hash = _hash_pin(pin, salt)
        now = datetime.now().isoformat()

        _sql(
            "INSERT INTO CaregiverVertex SET "
            "caregiver_id = :cid, name = :name, phone = :phone, "
            "pin_hash = :ph, pin_salt = :ps, relationship = :rel, "
            "patient_limit = :lim, created_at = :now, last_login = :now",
            {
                "cid": caregiver_id, "name": name, "phone": phone,
                "ph": pin_hash, "ps": salt, "rel": relationship,
                "lim": 10, "now": now,
            },
        )
        return {"caregiver_id": caregiver_id, "name": name, "phone": phone}

    def verify_pin(self, phone: str, pin: str) -> Optional[Dict]:
        """Verify caregiver PIN. Returns caregiver dict or None."""
        cg = self.get_by_phone(phone)
        if not cg:
            return None
        if _hash_pin(pin, cg["pin_salt"]) != cg["pin_hash"]:
            return None
        # Update last_login
        try:
            _sql(
                "UPDATE CaregiverVertex SET last_login = :now WHERE caregiver_id = :cid",
                {"now": datetime.now().isoformat(), "cid": cg["caregiver_id"]},
            )
        except Exception:
            pass
        return cg

    def update_profile(
        self,
        caregiver_id: str,
        name: Optional[str] = None,
        bio: Optional[str] = None,
        specialization: Optional[str] = None,
        photo: Optional[str] = None,
    ) -> bool:
        parts, params = [], {"cid": caregiver_id}
        if name is not None:
            parts.append("name = :name"); params["name"] = name
        if bio is not None:
            parts.append("bio = :bio"); params["bio"] = bio
        if specialization is not None:
            parts.append("specialization = :spec"); params["spec"] = specialization
        if photo is not None:
            parts.append("profile_photo = :photo"); params["photo"] = photo
        if not parts:
            return True
        _sql(
            f"UPDATE CaregiverVertex SET {', '.join(parts)} WHERE caregiver_id = :cid",
            params,
        )
        return True

    def update_patient_limit(self, caregiver_id: str, new_limit: int) -> bool:
        _sql(
            "UPDATE CaregiverVertex SET patient_limit = :lim WHERE caregiver_id = :cid",
            {"lim": new_limit, "cid": caregiver_id},
        )
        return True

    def get_active_patient_count(self, caregiver_id: str) -> int:
        rows = _rows(_sql(
            "SELECT count(*) as cnt FROM CaregiverPatientEdge "
            "WHERE caregiver_id = :cid AND is_revoked = false",
            {"cid": caregiver_id},
        ))
        return int(rows[0].get("cnt", 0)) if rows else 0

    # ── Edge (caregiver ↔ patient link) ────────────────────────────────────

    def link_to_patient(
        self,
        caregiver_id: str,
        patient_id: str,
        permissions: List[str],
        granted_by: str,
        note: str = "",
    ) -> bool:
        """Create CaregiverPatientEdge. Enforces patient_limit."""
        cg = self.get_by_id(caregiver_id)
        limit = int(cg.get("patient_limit") or 10) if cg else 10
        current = self.get_active_patient_count(caregiver_id)
        if current >= limit:
            raise ValueError(
                f"Patient limit ({limit}) reached. Upgrade your plan to add more patients."
            )

        now = datetime.now().isoformat()
        try:
            # Ensure PatientVertex exists (may be absent after DB wipe; new patients have it from signup)
            existing = _rows(_sql(
                "SELECT id FROM PatientVertex WHERE id = :pid LIMIT 1", {"pid": patient_id}
            ))
            if not existing:
                try:
                    _sql(
                        "INSERT INTO PatientVertex SET id = :pid, name = '', phone = '', created_at = :now",
                        {"pid": patient_id, "now": now},
                    )
                    logger.info(f"link_to_patient: created stub PatientVertex for {patient_id}")
                except Exception:
                    pass  # May already exist from concurrent write

            _sql(
                "CREATE EDGE CaregiverPatientEdge "
                "FROM (SELECT FROM CaregiverVertex WHERE caregiver_id = :cid) "
                "TO (SELECT FROM PatientVertex WHERE id = :pid) "
                "SET patient_id = :pid, caregiver_id = :cid, "
                "permissions = :perms, consent_date = :now, "
                "granted_by = :gb, is_revoked = false, note = :note",
                {
                    "cid": caregiver_id, "pid": patient_id,
                    "perms": json.dumps(permissions),
                    "now": now, "gb": granted_by, "note": note,
                },
            )
            return True
        except Exception as e:
            logger.error(f"link_to_patient failed: {e}")
            return False

    def get_patients_for_caregiver(self, caregiver_id: str) -> List[Dict]:
        """Return all active patients linked to this caregiver."""
        edge_rows = _rows(_sql(
            "SELECT patient_id, permissions, consent_date FROM CaregiverPatientEdge "
            "WHERE caregiver_id = :cid AND is_revoked = false",
            {"cid": caregiver_id},
        ))
        patients = []
        for edge in edge_rows:
            pid = edge["patient_id"]
            rows = _rows(_sql(
                "SELECT * FROM PatientVertex WHERE id = :pid LIMIT 1", {"pid": pid}
            ))
            if rows:
                p = rows[0]
                p["_permissions"] = json.loads(edge.get("permissions", "[]"))
                patients.append(p)
        return patients

    def get_patient_for_caregiver(self, caregiver_id: str) -> Optional[Dict]:
        """Get active patient linked to caregiver."""
        rows = _rows(_sql(
            "SELECT expand(out('CaregiverPatientEdge')) "
            "FROM CaregiverVertex WHERE caregiver_id = :cid",
            {"cid": caregiver_id},
        ))
        # Also get edge permissions
        edge_rows = _rows(_sql(
            "SELECT permissions, is_revoked FROM CaregiverPatientEdge "
            "WHERE caregiver_id = :cid AND is_revoked = false LIMIT 1",
            {"cid": caregiver_id},
        ))
        if not rows or not edge_rows:
            return None
        patient = rows[0]
        patient["_permissions"] = json.loads(edge_rows[0].get("permissions", "[]"))
        return patient

    def get_caregivers_for_patient(self, patient_id: str) -> List[Dict]:
        rows = _rows(_sql(
            "SELECT caregiver_id, permissions, consent_date, is_revoked, note "
            "FROM CaregiverPatientEdge WHERE patient_id = :pid",
            {"pid": patient_id},
        ))
        result = []
        for edge in rows:
            cg = self.get_by_id(edge["caregiver_id"])
            if cg:
                result.append({
                    "caregiver_id": cg["caregiver_id"],
                    "name": cg["name"],
                    "phone": cg["phone"],
                    "relationship": cg.get("relationship"),
                    "permissions": json.loads(edge.get("permissions", "[]")),
                    "consent_date": edge.get("consent_date"),
                    "is_revoked": edge.get("is_revoked", False),
                    "note": edge.get("note", ""),
                })
        return result

    def revoke_access(self, caregiver_id: str, patient_id: str) -> bool:
        try:
            _sql(
                "UPDATE CaregiverPatientEdge SET is_revoked = true, revoked_at = :now "
                "WHERE caregiver_id = :cid AND patient_id = :pid",
                {
                    "now": datetime.now().isoformat(),
                    "cid": caregiver_id, "pid": patient_id,
                },
            )
            return True
        except Exception as e:
            logger.error(f"revoke_access failed: {e}")
            return False

    def is_active_caregiver(self, caregiver_id: str, patient_id: str) -> bool:
        rows = _rows(_sql(
            "SELECT is_revoked FROM CaregiverPatientEdge "
            "WHERE caregiver_id = :cid AND patient_id = :pid LIMIT 1",
            {"cid": caregiver_id, "pid": patient_id},
        ))
        if not rows:
            return False
        return not rows[0].get("is_revoked", True)
