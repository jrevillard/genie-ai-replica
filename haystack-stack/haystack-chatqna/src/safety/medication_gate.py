"""
Medication Safety Gate — AMINA must NEVER prescribe, suggest, or recommend
any specific medication or dosage.

She can ONLY:
  - Educate about general health topics (no specific drug names as recommendations)
  - Remind patients about medicines THEIR DOCTOR already prescribed
  - Route to facility/VHW when medication decisions are needed
  - Escalate overdose/poisoning as EMERGENCY

This classifier runs BEFORE the LLM call. If the intent is BLOCKED,
the LLM is never called — a templated safe response is returned directly.

Performance: <2ms (keyword matching, no LLM).
"""

from enum import Enum
from typing import Dict, Any, Optional, Tuple
from datetime import datetime
import re
import logging

logger = logging.getLogger(__name__)


class MedicationIntent(Enum):
    REQUESTING_PRESCRIPTION = "requesting_prescription"
    DOSAGE_QUESTION = "dosage_question"
    EXISTING_PRESCRIPTION = "existing_prescription"
    REFILL_NEEDED = "refill_needed"
    SIDE_EFFECT_REPORT = "side_effect_report"
    DRUG_INTERACTION = "drug_interaction"
    OVERDOSE_EMERGENCY = "overdose_emergency"
    TRADITIONAL_REMEDY = "traditional_remedy"
    GENERAL_MED_INFO = "general_med_info"
    URGENT_SYMPTOM_RELIEF = "urgent_symptom_relief"
    NOT_MEDICATION = "not_medication"


# Action per intent
SAFETY_ACTION = {
    MedicationIntent.REQUESTING_PRESCRIPTION: "BLOCK",
    MedicationIntent.DOSAGE_QUESTION: "BLOCK",
    MedicationIntent.EXISTING_PRESCRIPTION: "ALLOW_CAUTION",
    MedicationIntent.REFILL_NEEDED: "ALLOW",
    MedicationIntent.SIDE_EFFECT_REPORT: "ALLOW_CAUTION",
    MedicationIntent.DRUG_INTERACTION: "BLOCK",
    MedicationIntent.OVERDOSE_EMERGENCY: "EMERGENCY",
    MedicationIntent.TRADITIONAL_REMEDY: "NEUTRAL",
    MedicationIntent.GENERAL_MED_INFO: "ALLOW_EDUCATION",
    MedicationIntent.URGENT_SYMPTOM_RELIEF: "BLOCK_WITH_FIRST_AID",
    MedicationIntent.NOT_MEDICATION: "PASS",
}


# Urgent distress signals — patient is in acute discomfort / crisis and
# asking for medicine out of desperation, not casually shopping for drugs.
_URGENT_DISTRESS_SIGNALS = [
    "pain", "hurts", "hurting", "ache", "aching",
    "dizzy", "dizziness", "fainting", "fainted", "nausea",
    "shaking", "trembling", "sweating", "can't see", "blurred",
    "weak", "feeling weak", "can't breathe", "difficulty breathing",
    "swollen", "swelling", "vomiting", "throwing up",
    "headache", "severe headache", "worst headache",
    "chest pain", "chest tight", "heart racing",
    "sugar is low", "sugar is high", "sugar dropped",
    "bp is high", "bp is very high", "pressure is high",
    "scared", "afraid", "worried", "help me", "please help",
    "what do i do", "what should i do", "i don't know what to do",
    "emergency", "urgent", "right now", "immediately",
    "can't sleep", "can't eat", "feel terrible", "very sick",
]

# Specific acute scenarios where interim first aid is safe and needed
_ACUTE_SCENARIOS = {
    "hypo": [
        "sugar is low", "sugar dropped", "sugar below", "sugar 50",
        "sugar 40", "sugar 60", "low blood sugar", "hypoglycemia",
        "shaking and sweating", "feel faint sugar",
    ],
    "hyper": [
        "sugar is very high", "sugar over 300", "sugar 400", "sugar 350",
        "sugar above 300", "high blood sugar", "sugar won't come down",
    ],
    "bp_crisis": [
        "bp is very high", "bp 180", "bp 190", "bp 200", "pressure very high",
        "blood pressure high headache", "nose bleeding bp",
    ],
    "breathing": [
        "can't breathe", "difficulty breathing", "asthma attack",
        "chest tight can't breathe", "wheezing badly", "choking",
    ],
    "pain_acute": [
        "severe pain", "unbearable pain", "pain won't stop",
        "chest pain", "stomach pain severe",
    ],
}


# Keyword sets for classification

_OVERDOSE_KEYWORDS = [
    "took too many", "took too much", "overdose", "child ate my medicine",
    "child ate my pill", "swallowed pills", "poisoning", "drank medicine",
    "baby ate", "my child took", "too many pills", "double dose",
]

_PRESCRIPTION_REQUEST_KEYWORDS = [
    "what medicine should i take", "give me medicine", "prescribe me",
    "what drug for", "which medicine for", "recommend me medicine",
    "what pill should", "need medicine for", "what tablet for",
    "should i take metformin", "should i take amlodipine",
    "can you prescribe", "what to take for", "best medicine for",
    "what medication for", "suggest a medicine", "recommend a drug",
]

_DOSAGE_KEYWORDS = [
    "how much", "what dose", "how many pills", "how many tablets",
    "dosage", "how often should i take", "increase my dose",
    "reduce my dose", "mg should i", "milligrams",
]

_INTERACTION_KEYWORDS = [
    "can i take together", "drug interaction", "mix with",
    "combine with", "take at same time", "interact with",
    "is it safe to take both", "conflict with",
]

_EXISTING_RX_KEYWORDS = [
    "my doctor prescribed", "my doctor gave me", "i was prescribed",
    "i take", "i am taking", "my medicine is", "my medication is",
    "i currently take", "doctor told me to take", "nurse gave me",
    "remind me to take", "set reminder for my",
]

_REFILL_KEYWORDS = [
    "ran out of", "need more", "refill", "where to buy",
    "pharmacy", "no more tablets", "finished my medicine",
    "where can i get more", "medicine is finished",
]

_SIDE_EFFECT_KEYWORDS = [
    "makes me dizzy", "feel sick after taking", "side effect",
    "allergic to", "reaction from", "medicine makes me",
    "pill makes me", "since i started taking", "after my medicine",
    "stomach pain from medicine", "headache from my pills",
]

_TRADITIONAL_KEYWORDS = [
    "herbal", "traditional medicine", "marabout gave me",
    "bitter leaf", "moringa tea", "neem", "herbal tea",
    "traditional healer", "local remedy", "home remedy",
]

_GENERAL_MED_INFO_KEYWORDS = [
    "what is metformin", "what is amlodipine", "what are",
    "tell me about", "how does", "what does this medicine do",
    "types of medicine for", "categories of", "classes of drugs",
]

# Drug names to detect medication context
_DRUG_NAMES = [
    "metformin", "amlodipine", "lisinopril", "enalapril",
    "hydrochlorothiazide", "hctz", "losartan", "atenolol",
    "glibenclamide", "gliclazide", "insulin", "aspirin",
    "atorvastatin", "simvastatin", "paracetamol", "ibuprofen",
    "amoxicillin", "salbutamol", "beclometasone", "theophylline",
    "omeprazole", "diclofenac", "prednisolone",
]


class MedicationSafetyGate:
    """Classifies medication intent and determines if the query should be
    BLOCKED (no LLM), ALLOWED (proceed with safety prompt), or EMERGENCY.

    Performance: <2ms — pure keyword matching.
    """

    def _detect_urgency(self, msg: str) -> bool:
        """Detect if the user is in acute distress or pain.
        Returns True if 2+ distress signals are present, indicating the
        patient is desperate — not casually asking for medicine names."""
        distress_count = sum(1 for s in _URGENT_DISTRESS_SIGNALS if s in msg)
        return distress_count >= 2

    def _detect_acute_scenario(self, msg: str) -> Optional[str]:
        """Detect specific acute medical scenarios where first aid is safe."""
        for scenario, keywords in _ACUTE_SCENARIOS.items():
            if any(kw in msg for kw in keywords):
                return scenario
        return None

    def classify(self, message: str) -> Tuple[MedicationIntent, str]:
        """Classify a user message into a MedicationIntent.

        Returns: (intent, action)
          action: "BLOCK" | "BLOCK_WITH_FIRST_AID" | "ALLOW" | "ALLOW_CAUTION" |
                  "ALLOW_EDUCATION" | "NEUTRAL" | "EMERGENCY" | "PASS"

        Key logic: if the patient is asking about medicine BUT is also in
        acute distress (pain, shaking, dizzy, scared), we don't give them
        a cold "I cannot prescribe" wall. Instead we route to
        BLOCK_WITH_FIRST_AID which provides calm, scenario-specific interim
        care (eat honey for low sugar, sit and breathe for high BP, etc.)
        while still NEVER prescribing or naming medications.
        """
        if not message:
            return MedicationIntent.NOT_MEDICATION, "PASS"

        msg = message.lower()

        # Priority 1: OVERDOSE/EMERGENCY — always check first
        if any(kw in msg for kw in _OVERDOSE_KEYWORDS):
            return MedicationIntent.OVERDOSE_EMERGENCY, "EMERGENCY"

        # Priority 2: Detect if patient is in acute distress or has a
        # recognizable urgent scenario. If they are asking about medicine
        # AND are in distress → FIRST AID path (not cold block).
        is_urgent = self._detect_urgency(msg)
        acute_scenario = self._detect_acute_scenario(msg)

        # Priority 3: Drug interactions (still block — but with empathy if urgent)
        if any(kw in msg for kw in _INTERACTION_KEYWORDS):
            if is_urgent or acute_scenario:
                return MedicationIntent.URGENT_SYMPTOM_RELIEF, "BLOCK_WITH_FIRST_AID"
            return MedicationIntent.DRUG_INTERACTION, "BLOCK"

        # Priority 4: Dosage questions
        if any(kw in msg for kw in _DOSAGE_KEYWORDS):
            has_drug = any(d in msg for d in _DRUG_NAMES)
            if has_drug:
                if is_urgent or acute_scenario:
                    return MedicationIntent.URGENT_SYMPTOM_RELIEF, "BLOCK_WITH_FIRST_AID"
                return MedicationIntent.DOSAGE_QUESTION, "BLOCK"

        # Priority 5: Prescription requests
        if any(kw in msg for kw in _PRESCRIPTION_REQUEST_KEYWORDS):
            if is_urgent or acute_scenario:
                return MedicationIntent.URGENT_SYMPTOM_RELIEF, "BLOCK_WITH_FIRST_AID"
            return MedicationIntent.REQUESTING_PRESCRIPTION, "BLOCK"

        # Priority 5b: Even without explicit prescription keywords, if patient
        # is in acute distress asking about medicine/symptoms → first aid path
        if acute_scenario:
            return MedicationIntent.URGENT_SYMPTOM_RELIEF, "BLOCK_WITH_FIRST_AID"

        # Priority 6: "My neighbor takes X, should I?" pattern
        neighbor_pattern = re.search(
            r"(neighbor|friend|sister|brother|husband|wife|mother|father).*(?:takes?|uses?|on)\s+(\w+)",
            msg,
        )
        if neighbor_pattern and any(d in msg for d in _DRUG_NAMES):
            return MedicationIntent.REQUESTING_PRESCRIPTION, "BLOCK"

        # Priority 7: Side effects
        if any(kw in msg for kw in _SIDE_EFFECT_KEYWORDS):
            return MedicationIntent.SIDE_EFFECT_REPORT, "ALLOW_CAUTION"

        # Priority 8: Existing prescription
        if any(kw in msg for kw in _EXISTING_RX_KEYWORDS):
            return MedicationIntent.EXISTING_PRESCRIPTION, "ALLOW_CAUTION"

        # Priority 9: Refill
        if any(kw in msg for kw in _REFILL_KEYWORDS):
            return MedicationIntent.REFILL_NEEDED, "ALLOW"

        # Priority 10: Traditional remedy
        if any(kw in msg for kw in _TRADITIONAL_KEYWORDS):
            return MedicationIntent.TRADITIONAL_REMEDY, "NEUTRAL"

        # Priority 11: General medication info
        if any(kw in msg for kw in _GENERAL_MED_INFO_KEYWORDS):
            return MedicationIntent.GENERAL_MED_INFO, "ALLOW_EDUCATION"

        # Default: not medication-related
        return MedicationIntent.NOT_MEDICATION, "PASS"

    def should_block_llm(self, action: str) -> bool:
        """Return True if the LLM should NOT be called."""
        return action in ("BLOCK", "BLOCK_WITH_FIRST_AID", "EMERGENCY")
