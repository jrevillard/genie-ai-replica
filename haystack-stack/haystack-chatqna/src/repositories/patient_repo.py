from typing import Optional, List, Dict, Any
from src.utils.arcade_client import command_sql, extract_rows
from src.models.patient import Patient
from src.models.enums import Gender, Region, NCDType
import logging
import json
import uuid

logger = logging.getLogger(__name__)


class PatientRepository:
    TABLE_NAME = "Patient"

    async def ensure_schema(self):
        """Create the Patient document type if it doesn't exist."""
        try:
            command_sql(f"CREATE DOCUMENT TYPE {self.TABLE_NAME} IF NOT EXISTS")
            command_sql(f"CREATE PROPERTY {self.TABLE_NAME}.patient_id IF NOT EXISTS STRING")
            command_sql(f"CREATE PROPERTY {self.TABLE_NAME}.name IF NOT EXISTS STRING")
            command_sql(f"CREATE PROPERTY {self.TABLE_NAME}.age IF NOT EXISTS INTEGER")
            command_sql(f"CREATE PROPERTY {self.TABLE_NAME}.gender IF NOT EXISTS STRING")
            command_sql(f"CREATE PROPERTY {self.TABLE_NAME}.region IF NOT EXISTS STRING")
            command_sql(f"CREATE PROPERTY {self.TABLE_NAME}.phone IF NOT EXISTS STRING")
            command_sql(f"CREATE PROPERTY {self.TABLE_NAME}.conditions IF NOT EXISTS STRING")
            command_sql(f"CREATE PROPERTY {self.TABLE_NAME}.medications IF NOT EXISTS STRING")
            command_sql(f"CREATE PROPERTY {self.TABLE_NAME}.allergies IF NOT EXISTS STRING")
            command_sql(f"CREATE PROPERTY {self.TABLE_NAME}.emergency_contact IF NOT EXISTS STRING")
            command_sql(f"CREATE PROPERTY {self.TABLE_NAME}.last_bp IF NOT EXISTS STRING")
            command_sql(f"CREATE PROPERTY {self.TABLE_NAME}.last_glucose IF NOT EXISTS STRING")
        except Exception as e:
            logger.warning(f"Schema init warning: {e}")

    async def get_patient(self, patient_id: str) -> Optional[Patient]:
        try:
            resp = command_sql(
                f"SELECT * FROM {self.TABLE_NAME} WHERE patient_id = :pid LIMIT 1",
                [patient_id],
            )
            rows = extract_rows(resp)
            if not rows:
                return None
            return self._row_to_patient(rows[0])
        except Exception as e:
            logger.error(f"Failed to get patient {patient_id}: {e}")
            return None

    async def create_patient(self, patient: Patient) -> str:
        if not patient.patient_id:
            patient.patient_id = str(uuid.uuid4())[:8].upper()

        try:
            command_sql(
                f"INSERT INTO {self.TABLE_NAME} SET "
                f"patient_id = :pid, name = :name, age = :age, gender = :gender, "
                f"region = :region, phone = :phone, conditions = :conditions, "
                f"medications = :medications, allergies = :allergies, "
                f"emergency_contact = :ec, last_bp = :bp, last_glucose = :glucose",
                [
                    patient.patient_id,
                    patient.name,
                    patient.age,
                    patient.gender.value,
                    patient.region.value,
                    patient.phone or "",
                    json.dumps([c.value for c in patient.conditions]),
                    json.dumps([{"name": m.name, "dosage": m.dosage, "frequency": m.frequency} for m in patient.medications]),
                    json.dumps(patient.allergies),
                    patient.emergency_contact or "",
                    patient.last_bp or "",
                    patient.last_glucose or "",
                ],
            )
            return patient.patient_id
        except Exception as e:
            logger.error(f"Failed to create patient: {e}")
            raise

    async def update_vitals(self, patient_id: str, bp: str = None, glucose: str = None):
        updates = []
        params = []
        if bp:
            updates.append("last_bp = ?")
            params.append(bp)
        if glucose:
            updates.append("last_glucose = ?")
            params.append(glucose)

        if not updates:
            return

        params.append(patient_id)
        try:
            command_sql(
                f"UPDATE {self.TABLE_NAME} SET {', '.join(updates)} WHERE patient_id = ?",
                params,
            )
        except Exception as e:
            logger.error(f"Failed to update vitals for {patient_id}: {e}")

    async def list_patients(self, region: str = None, limit: int = 50) -> List[Patient]:
        try:
            if region:
                resp = command_sql(
                    f"SELECT * FROM {self.TABLE_NAME} WHERE region = :region LIMIT :limit",
                    [region, limit],
                )
            else:
                resp = command_sql(
                    f"SELECT * FROM {self.TABLE_NAME} LIMIT :limit",
                    [limit],
                )
            rows = extract_rows(resp)
            return [self._row_to_patient(r) for r in rows]
        except Exception as e:
            logger.error(f"Failed to list patients: {e}")
            return []

    def _row_to_patient(self, row: Dict[str, Any]) -> Patient:
        conditions_raw = row.get("conditions", "[]")
        if isinstance(conditions_raw, str):
            conditions_raw = json.loads(conditions_raw)
        conditions = [NCDType(c) for c in conditions_raw if c in NCDType._value2member_map_]

        meds_raw = row.get("medications", "[]")
        if isinstance(meds_raw, str):
            meds_raw = json.loads(meds_raw)

        from src.models.patient import Medication
        medications = [
            Medication(name=m.get("name", ""), dosage=m.get("dosage", ""), frequency=m.get("frequency", ""))
            for m in meds_raw
        ]

        allergies_raw = row.get("allergies", "[]")
        if isinstance(allergies_raw, str):
            allergies_raw = json.loads(allergies_raw)

        gender = Gender(row.get("gender", "other")) if row.get("gender") in Gender._value2member_map_ else Gender.OTHER
        region = Region(row.get("region", "Kanifing")) if row.get("region") in Region._value2member_map_ else Region.KANIFING

        return Patient(
            patient_id=row.get("patient_id", ""),
            name=row.get("name", ""),
            age=row.get("age", 0),
            gender=gender,
            region=region,
            phone=row.get("phone"),
            conditions=conditions,
            medications=medications,
            allergies=allergies_raw,
            emergency_contact=row.get("emergency_contact"),
            last_bp=row.get("last_bp"),
            last_glucose=row.get("last_glucose"),
        )
