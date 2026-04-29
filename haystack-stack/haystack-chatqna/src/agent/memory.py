from dataclasses import dataclass, field
from typing import List, Dict, Optional
from datetime import datetime


@dataclass
class Message:
    role: str  # "user" or "assistant"
    content: str
    timestamp: datetime = field(default_factory=datetime.now)
    tools_used: List[str] = field(default_factory=list)


@dataclass
class PatientContext:
    patient_id: Optional[str] = None
    name: Optional[str] = None
    age: Optional[int] = None
    gender: Optional[str] = None
    region: str = "Kanifing"
    conditions: List[str] = field(default_factory=list)
    medications: List[Dict] = field(default_factory=list)
    allergies: List[str] = field(default_factory=list)
    emergency_contact: Optional[str] = None
    last_bp: Optional[str] = None
    last_glucose: Optional[str] = None
    current_symptoms: List[str] = field(default_factory=list)
    triage_level: Optional[str] = None


class ConversationMemory:
    def __init__(self, max_history: int = 20):
        self.messages: List[Message] = []
        self.max_history = max_history
        self.patient_context = PatientContext()
        self.session_id: Optional[str] = None
        self.started_at: datetime = datetime.now()
        # Track how many times we've suggested a structured form per type,
        # so we don't keep pushing it after the user skips
        self.form_prompts_given: Dict[str, int] = {}
        # Whether we've asked about notification preferences this session
        self.notifications_asked: bool = False
        self.goodbye_shown: bool = False
        # Whether we've already suggested switching to Mandinka this session
        self.language_switch_suggested: bool = False
        # Relationship-tier tracking (accumulates across sessions via Redis).
        # On-session defaults; the agent re-hydrates from Redis when available.
        self.interaction_count: int = 0
        self.days_since_first_call: int = 0
        self.days_since_last_call: int = 0
        # Detected ethnic language from greeting (persists for session)
        self.ethnic_language: str = "english"
        # Greeting ritual state machine (voice/sms/whatsapp only)
        # -1 = not started / web user, 0-2 = ritual phases, 3 = complete
        self.ritual_phase: int = -1
        # Elevated-role flag: 'alkalo' | 'imam' | 'vhw' | None
        # Triggers a respect-register greeting and unlocks village summaries.
        self.user_role: Optional[str] = None
        # Key facts from patient profile (cross-session memory)
        # Populated when patient_id is loaded from ArcadeDB
        self.key_facts: List[str] = []
        # Commitments the patient made last visit ("I will try half Maggi cube")
        # Used for care plan tracking / progressive profiling
        self.last_visit_commitments: List[str] = []

    def add_message(self, role: str, content: str, tools_used: List[str] = None):
        message = Message(
            role=role,
            content=content,
            tools_used=tools_used or [],
        )
        self.messages.append(message)

        if len(self.messages) > self.max_history:
            self.messages = self.messages[-self.max_history:]

    def get_history_for_llm(self) -> List[Dict]:
        return [
            {"role": msg.role, "content": msg.content}
            for msg in self.messages
        ]

    def get_summary(self) -> str:
        if not self.messages:
            return "No conversation history."

        summary = f"Session started: {self.started_at.strftime('%Y-%m-%d %H:%M')}\n"
        summary += f"Messages exchanged: {len(self.messages)}\n"

        if self.patient_context.patient_id:
            summary += f"Patient: {self.patient_context.name} ({self.patient_context.patient_id})\n"
            if self.patient_context.conditions:
                summary += f"Conditions: {', '.join(self.patient_context.conditions)}\n"
            if self.patient_context.triage_level:
                summary += f"Current triage level: {self.patient_context.triage_level}\n"

        return summary

    def update_patient_context(self, **kwargs):
        for key, value in kwargs.items():
            if hasattr(self.patient_context, key):
                setattr(self.patient_context, key, value)

    def clear(self):
        self.messages = []
        self.patient_context = PatientContext()
        self.started_at = datetime.now()
        self.form_prompts_given = {}
        self.notifications_asked = False
        self.goodbye_shown = False
        self.language_switch_suggested = False
        self.interaction_count = 0
        self.days_since_first_call = 0
        self.days_since_last_call = 0
        self.ethnic_language = "english"
        self.ritual_phase = -1
        self.user_role = None
