from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, List
from src.repositories.patient_repo import PatientRepository
from src.repositories.consultation_repo import ConsultationRepository
from src.models.patient import Patient, Medication
from src.models.enums import Gender, Region, NCDType

router = APIRouter(prefix="/patients", tags=["patients"])

patient_repo = PatientRepository()
consultation_repo = ConsultationRepository()


class CreatePatientRequest(BaseModel):
    name: str
    age: int
    gender: str = "other"
    region: str = "Kanifing"
    phone: Optional[str] = None
    conditions: List[str] = []
    medications: List[dict] = []
    allergies: List[str] = []
    emergency_contact: Optional[str] = None


class UpdateVitalsRequest(BaseModel):
    bp: Optional[str] = None
    glucose: Optional[str] = None


class PatientResponse(BaseModel):
    patient_id: str
    name: str
    age: int
    gender: str
    region: str
    conditions: List[str] = []
    medications: List[dict] = []
    allergies: List[str] = []
    last_bp: Optional[str] = None
    last_glucose: Optional[str] = None


@router.post("/", response_model=PatientResponse)
async def create_patient(request: CreatePatientRequest):
    """Register a new patient."""
    try:
        gender = Gender(request.gender) if request.gender in Gender._value2member_map_ else Gender.OTHER
        region = Region(request.region) if request.region in Region._value2member_map_ else Region.KANIFING
        conditions = [NCDType(c) for c in request.conditions if c in NCDType._value2member_map_]
        medications = [
            Medication(name=m.get("name", ""), dosage=m.get("dosage", ""), frequency=m.get("frequency", ""))
            for m in request.medications
        ]

        patient = Patient(
            patient_id="",
            name=request.name,
            age=request.age,
            gender=gender,
            region=region,
            phone=request.phone,
            conditions=conditions,
            medications=medications,
            allergies=request.allergies,
            emergency_contact=request.emergency_contact,
        )

        patient_id = await patient_repo.create_patient(patient)

        return PatientResponse(
            patient_id=patient_id,
            name=request.name,
            age=request.age,
            gender=request.gender,
            region=request.region,
            conditions=request.conditions,
            medications=request.medications,
            allergies=request.allergies,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{patient_id}", response_model=PatientResponse)
async def get_patient(patient_id: str):
    """Get patient by ID."""
    patient = await patient_repo.get_patient(patient_id)
    if not patient:
        raise HTTPException(status_code=404, detail=f"Patient '{patient_id}' not found")

    return PatientResponse(
        patient_id=patient.patient_id,
        name=patient.name,
        age=patient.age,
        gender=patient.gender.value,
        region=patient.region.value,
        conditions=[c.value for c in patient.conditions],
        medications=[
            {"name": m.name, "dosage": m.dosage, "frequency": m.frequency}
            for m in patient.medications
        ],
        allergies=patient.allergies,
        last_bp=patient.last_bp,
        last_glucose=patient.last_glucose,
    )


@router.put("/{patient_id}/vitals")
async def update_vitals(patient_id: str, request: UpdateVitalsRequest):
    """Update patient vital signs."""
    patient = await patient_repo.get_patient(patient_id)
    if not patient:
        raise HTTPException(status_code=404, detail=f"Patient '{patient_id}' not found")

    await patient_repo.update_vitals(patient_id, bp=request.bp, glucose=request.glucose)
    return {"status": "updated", "patient_id": patient_id}


@router.get("/{patient_id}/consultations")
async def get_patient_consultations(patient_id: str, limit: int = 10):
    """Get recent consultations for a patient."""
    consultations = await consultation_repo.get_recent(patient_id, limit=limit)
    return {
        "patient_id": patient_id,
        "consultations": [c.to_dict() for c in consultations],
        "count": len(consultations),
    }


@router.get("/")
async def list_patients(region: Optional[str] = None, limit: int = 50):
    """List patients, optionally filtered by region."""
    patients = await patient_repo.list_patients(region=region, limit=limit)
    return {
        "patients": [
            PatientResponse(
                patient_id=p.patient_id,
                name=p.name,
                age=p.age,
                gender=p.gender.value,
                region=p.region.value,
                conditions=[c.value for c in p.conditions],
                medications=[
                    {"name": m.name, "dosage": m.dosage, "frequency": m.frequency}
                    for m in p.medications
                ],
                allergies=p.allergies,
                last_bp=p.last_bp,
                last_glucose=p.last_glucose,
            ).model_dump()
            for p in patients
        ],
        "count": len(patients),
    }
