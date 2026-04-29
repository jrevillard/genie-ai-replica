from dataclasses import dataclass, field
from typing import List, Dict, Optional
from datetime import datetime
from src.models.enums import TriageLevel, ConsultationStatus


@dataclass
class Consultation:
    consultation_id: str
    patient_id: str
    session_id: str
    status: ConsultationStatus = ConsultationStatus.ACTIVE
    triage_level: Optional[TriageLevel] = None
    chief_complaint: Optional[str] = None
    symptoms: List[str] = field(default_factory=list)
    tools_used: List[str] = field(default_factory=list)
    messages: List[Dict] = field(default_factory=list)
    recommendations: List[str] = field(default_factory=list)
    referral_facility: Optional[str] = None
    followup_date: Optional[str] = None
    created_at: datetime = field(default_factory=datetime.now)
    updated_at: datetime = field(default_factory=datetime.now)

    def add_message(self, role: str, content: str):
        self.messages.append({
            "role": role,
            "content": content,
            "timestamp": datetime.now().isoformat(),
        })
        self.updated_at = datetime.now()

    def to_dict(self) -> Dict:
        return {
            "consultation_id": self.consultation_id,
            "patient_id": self.patient_id,
            "session_id": self.session_id,
            "status": self.status.value,
            "triage_level": self.triage_level.value if self.triage_level else None,
            "chief_complaint": self.chief_complaint,
            "symptoms": self.symptoms,
            "tools_used": self.tools_used,
            "messages": self.messages,
            "recommendations": self.recommendations,
            "referral_facility": self.referral_facility,
            "followup_date": self.followup_date,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
        }

    @classmethod
    def from_dict(cls, data: Dict) -> "Consultation":
        triage = TriageLevel(data["triage_level"]) if data.get("triage_level") else None
        status = ConsultationStatus(data.get("status", "active"))

        return cls(
            consultation_id=data["consultation_id"],
            patient_id=data["patient_id"],
            session_id=data["session_id"],
            status=status,
            triage_level=triage,
            chief_complaint=data.get("chief_complaint"),
            symptoms=data.get("symptoms", []),
            tools_used=data.get("tools_used", []),
            messages=data.get("messages", []),
            recommendations=data.get("recommendations", []),
            referral_facility=data.get("referral_facility"),
            followup_date=data.get("followup_date"),
        )
