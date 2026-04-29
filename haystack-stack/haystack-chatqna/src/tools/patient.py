from typing import Dict, Any, Optional
from src.tools.base import BaseTool
from src.repositories.patient_repo import PatientRepository
from src.repositories.consultation_repo import ConsultationRepository
import logging

logger = logging.getLogger(__name__)


class PatientTool(BaseTool):
    name = "get_patient"
    description = "Retrieve patient information and history"
    parameters = ["patient_id"]

    def __init__(self):
        self.patient_repo = PatientRepository()
        self.consultation_repo = ConsultationRepository()

    async def execute(
        self,
        patient_id: str = None,
        **kwargs,
    ) -> Dict[str, Any]:
        if not patient_id:
            return {"error": "Patient ID is required"}

        try:
            patient = await self.patient_repo.get_patient(patient_id)
            if not patient:
                return {
                    "error": f"Patient '{patient_id}' not found",
                    "patient_id": patient_id,
                }

            # Get recent consultations
            recent = await self.consultation_repo.get_recent(patient_id, limit=3)

            return {
                "patient_id": patient.patient_id,
                "name": patient.name,
                "age": patient.age,
                "gender": patient.gender.value,
                "region": patient.region.value,
                "conditions": [c.value for c in patient.conditions],
                "medications": [
                    {"name": m.name, "dosage": m.dosage, "frequency": m.frequency}
                    for m in patient.medications
                ],
                "allergies": patient.allergies,
                "emergency_contact": patient.emergency_contact,
                "last_bp": patient.last_bp,
                "last_glucose": patient.last_glucose,
                "recent_consultations": [c.to_dict() for c in recent],
            }
        except Exception as e:
            logger.error(f"Failed to retrieve patient {patient_id}: {e}")
            return {"error": str(e), "patient_id": patient_id}


class SaveConsultationTool(BaseTool):
    name = "save_consultation"
    description = "Save a consultation record for a patient"
    parameters = ["patient_id", "message", "response", "triage_level", "tools_used"]

    def __init__(self):
        self.consultation_repo = ConsultationRepository()

    async def execute(
        self,
        patient_id: str = None,
        message: str = None,
        response: str = None,
        triage_level: str = None,
        tools_used: list = None,
        **kwargs,
    ) -> Dict[str, Any]:
        if not patient_id:
            return {"error": "Patient ID is required"}

        try:
            consultation_id = await self.consultation_repo.save(
                patient_id=patient_id,
                message=message or "",
                response=response or "",
                triage_level=triage_level,
                tools_used=tools_used or [],
            )
            return {
                "success": True,
                "consultation_id": consultation_id,
                "patient_id": patient_id,
            }
        except Exception as e:
            logger.error(f"Failed to save consultation for {patient_id}: {e}")
            return {"error": str(e), "success": False}
