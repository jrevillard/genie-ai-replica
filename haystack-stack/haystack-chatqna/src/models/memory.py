from pydantic import BaseModel, Field
from typing import List, Dict, Optional, Any
from datetime import datetime
from enum import Enum


class MemoryType(str, Enum):
    CONSULTATION = "consultation"
    FACT = "fact"
    SYMPTOM = "symptom"
    PREFERENCE = "preference"
    SUMMARY = "summary"


class Memory(BaseModel):
    id: str
    patient_id: str
    type: MemoryType
    content: str
    metadata: Dict[str, Any] = {}
    embedding: Optional[List[float]] = None
    importance: float = 0.5
    created_at: datetime = Field(default_factory=datetime.now)
    last_accessed: datetime = Field(default_factory=datetime.now)


class ConsultationRecord(BaseModel):
    """Persistent consultation record for episodic memory."""
    id: str
    patient_id: str
    session_id: str
    started_at: datetime
    ended_at: Optional[datetime] = None
    messages: List[Dict[str, str]] = []
    symptoms_reported: List[str] = []
    triage_level: Optional[str] = None
    tools_used: List[str] = []
    recommendations: List[str] = []
    followup_scheduled: Optional[str] = None
    summary: Optional[str] = None


class PatientProfile(BaseModel):
    """Persistent patient profile spanning all sessions."""
    id: str
    phone: str
    name: Optional[str] = None
    age: Optional[int] = None
    gender: Optional[str] = None
    region: str = "Kanifing"

    # Medical
    conditions: List[str] = []
    medications: List[Dict] = []
    allergies: List[str] = []

    # Vitals history
    bp_readings: List[Dict] = []
    glucose_readings: List[Dict] = []

    # Context
    emergency_contact: Optional[str] = None
    preferred_language: str = "english"
    preferred_facility: Optional[str] = None

    # Memory
    key_facts: List[str] = []
    consultation_count: int = 0
    last_consultation: Optional[datetime] = None

    created_at: datetime = Field(default_factory=datetime.now)
    updated_at: datetime = Field(default_factory=datetime.now)
