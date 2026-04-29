from typing import Optional, List, Dict, Any
from src.utils.arcade_client import command_sql, extract_rows
from src.models.consultation import Consultation
from src.models.enums import TriageLevel, ConsultationStatus
import logging
import json
import uuid
from datetime import datetime

logger = logging.getLogger(__name__)


class ConsultationRepository:
    TABLE_NAME = "Consultation"

    async def ensure_schema(self):
        """Create the Consultation document type if it doesn't exist."""
        try:
            command_sql(f"CREATE DOCUMENT TYPE {self.TABLE_NAME} IF NOT EXISTS")
            command_sql(f"CREATE PROPERTY {self.TABLE_NAME}.consultation_id IF NOT EXISTS STRING")
            command_sql(f"CREATE PROPERTY {self.TABLE_NAME}.patient_id IF NOT EXISTS STRING")
            command_sql(f"CREATE PROPERTY {self.TABLE_NAME}.session_id IF NOT EXISTS STRING")
            command_sql(f"CREATE PROPERTY {self.TABLE_NAME}.status IF NOT EXISTS STRING")
            command_sql(f"CREATE PROPERTY {self.TABLE_NAME}.triage_level IF NOT EXISTS STRING")
            command_sql(f"CREATE PROPERTY {self.TABLE_NAME}.chief_complaint IF NOT EXISTS STRING")
            command_sql(f"CREATE PROPERTY {self.TABLE_NAME}.symptoms IF NOT EXISTS STRING")
            command_sql(f"CREATE PROPERTY {self.TABLE_NAME}.tools_used IF NOT EXISTS STRING")
            command_sql(f"CREATE PROPERTY {self.TABLE_NAME}.messages IF NOT EXISTS STRING")
            command_sql(f"CREATE PROPERTY {self.TABLE_NAME}.recommendations IF NOT EXISTS STRING")
            command_sql(f"CREATE PROPERTY {self.TABLE_NAME}.referral_facility IF NOT EXISTS STRING")
            command_sql(f"CREATE PROPERTY {self.TABLE_NAME}.followup_date IF NOT EXISTS STRING")
            command_sql(f"CREATE PROPERTY {self.TABLE_NAME}.created_at IF NOT EXISTS STRING")
        except Exception as e:
            logger.warning(f"Consultation schema init warning: {e}")

    async def save(
        self,
        patient_id: str,
        message: str,
        response: str,
        triage_level: str = None,
        tools_used: List[str] = None,
        session_id: str = None,
    ) -> str:
        consultation_id = str(uuid.uuid4())[:8].upper()
        now = datetime.now().isoformat()

        messages = json.dumps([
            {"role": "user", "content": message, "timestamp": now},
            {"role": "assistant", "content": response, "timestamp": now},
        ])

        try:
            command_sql(
                f"INSERT INTO {self.TABLE_NAME} SET "
                f"consultation_id = :cid, patient_id = :pid, session_id = :sid, "
                f"status = :status, triage_level = :triage, "
                f"chief_complaint = :complaint, tools_used = :tools, "
                f"messages = :messages, created_at = :created",
                [
                    consultation_id,
                    patient_id,
                    session_id or "",
                    ConsultationStatus.ACTIVE.value,
                    triage_level or "",
                    message[:200],
                    json.dumps(tools_used or []),
                    messages,
                    now,
                ],
            )
            return consultation_id
        except Exception as e:
            logger.error(f"Failed to save consultation: {e}")
            raise

    async def get_recent(self, patient_id: str, limit: int = 5) -> List[Consultation]:
        try:
            resp = command_sql(
                f"SELECT * FROM {self.TABLE_NAME} WHERE patient_id = :pid "
                f"ORDER BY created_at DESC LIMIT :limit",
                [patient_id, limit],
            )
            rows = extract_rows(resp)
            return [self._row_to_consultation(r) for r in rows]
        except Exception as e:
            logger.error(f"Failed to get recent consultations for {patient_id}: {e}")
            return []

    async def get_by_id(self, consultation_id: str) -> Optional[Consultation]:
        try:
            resp = command_sql(
                f"SELECT * FROM {self.TABLE_NAME} WHERE consultation_id = :cid LIMIT 1",
                [consultation_id],
            )
            rows = extract_rows(resp)
            if not rows:
                return None
            return self._row_to_consultation(rows[0])
        except Exception as e:
            logger.error(f"Failed to get consultation {consultation_id}: {e}")
            return None

    def _row_to_consultation(self, row: Dict[str, Any]) -> Consultation:
        messages_raw = row.get("messages", "[]")
        if isinstance(messages_raw, str):
            messages_raw = json.loads(messages_raw)

        tools_raw = row.get("tools_used", "[]")
        if isinstance(tools_raw, str):
            tools_raw = json.loads(tools_raw)

        triage = None
        triage_val = row.get("triage_level", "")
        if triage_val and triage_val in TriageLevel._value2member_map_:
            triage = TriageLevel(triage_val)

        status_val = row.get("status", "active")
        status = ConsultationStatus(status_val) if status_val in ConsultationStatus._value2member_map_ else ConsultationStatus.ACTIVE

        return Consultation(
            consultation_id=row.get("consultation_id", ""),
            patient_id=row.get("patient_id", ""),
            session_id=row.get("session_id", ""),
            status=status,
            triage_level=triage,
            chief_complaint=row.get("chief_complaint"),
            tools_used=tools_raw,
            messages=messages_raw,
            referral_facility=row.get("referral_facility"),
            followup_date=row.get("followup_date"),
        )
