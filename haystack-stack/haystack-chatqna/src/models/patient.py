from dataclasses import dataclass, field
from typing import List, Dict, Optional
from datetime import datetime
from src.models.enums import Gender, Region, NCDType


@dataclass
class Medication:
    name: str
    dosage: str
    frequency: str
    prescribed_date: Optional[str] = None
    notes: Optional[str] = None


@dataclass
class VitalReading:
    type: str  # "blood_pressure", "blood_glucose", "weight", etc.
    value: str
    unit: str
    recorded_at: datetime = field(default_factory=datetime.now)
    notes: Optional[str] = None


@dataclass
class Patient:
    patient_id: str
    name: str
    age: int
    gender: Gender
    region: Region = Region.KANIFING
    phone: Optional[str] = None
    conditions: List[NCDType] = field(default_factory=list)
    medications: List[Medication] = field(default_factory=list)
    allergies: List[str] = field(default_factory=list)
    emergency_contact: Optional[str] = None
    emergency_contact_name: Optional[str] = None
    vitals_history: List[VitalReading] = field(default_factory=list)
    last_bp: Optional[str] = None
    last_glucose: Optional[str] = None
    created_at: datetime = field(default_factory=datetime.now)
    updated_at: datetime = field(default_factory=datetime.now)

    def to_dict(self) -> Dict:
        return {
            "patient_id": self.patient_id,
            "name": self.name,
            "age": self.age,
            "gender": self.gender.value,
            "region": self.region.value,
            "phone": self.phone,
            "conditions": [c.value for c in self.conditions],
            "medications": [
                {"name": m.name, "dosage": m.dosage, "frequency": m.frequency}
                for m in self.medications
            ],
            "allergies": self.allergies,
            "emergency_contact": self.emergency_contact,
            "last_bp": self.last_bp,
            "last_glucose": self.last_glucose,
        }

    @classmethod
    def from_dict(cls, data: Dict) -> "Patient":
        meds = [
            Medication(name=m["name"], dosage=m.get("dosage", ""), frequency=m.get("frequency", ""))
            for m in data.get("medications", [])
        ]
        conditions = [NCDType(c) for c in data.get("conditions", [])]
        gender = Gender(data.get("gender", "other"))
        region = Region(data.get("region", "Kanifing"))

        return cls(
            patient_id=data["patient_id"],
            name=data["name"],
            age=data.get("age", 0),
            gender=gender,
            region=region,
            phone=data.get("phone"),
            conditions=conditions,
            medications=meds,
            allergies=data.get("allergies", []),
            emergency_contact=data.get("emergency_contact"),
            emergency_contact_name=data.get("emergency_contact_name"),
            last_bp=data.get("last_bp"),
            last_glucose=data.get("last_glucose"),
        )
