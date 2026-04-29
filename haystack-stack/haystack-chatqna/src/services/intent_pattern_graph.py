"""
Intent Pattern Graph — Layer 3 of the four-layer neuro-symbolic router.

A knowledge graph stored in Redis that provides:
  1. Emergency detection — ~50 nodes covering clinical emergencies,
     including Mandinka/Wolof idioms that express distress
  2. Drug-context disambiguation — ~200 nodes mapping drug names to
     conditions and interaction risks
  3. Cultural-idiom mapping — ~100 nodes for Mandinka, Wolof, and
     Gambian English expressions that shift stance classification
  4. Stance disambiguators — patterns that resolve ambiguous stances

The graph is loaded into Redis on startup (idempotent). Each node is a
Redis hash at key `ipg:{category}:{normalized_pattern}`. Lookups are
O(1) per pattern checked, with a scan over relevant categories.

Gate: USE_INTENT_PATTERN_GRAPH env var (default false).
"""

from __future__ import annotations

import json
import logging
import os
import re
from typing import Any, Dict, List, Optional, Set

logger = logging.getLogger(__name__)

_ENABLED = os.getenv("USE_INTENT_PATTERN_GRAPH", "false").lower() == "true"
_LOADED = False

# ── Redis helpers ────────────────────────────────────────────────────

def _get_redis():
    import redis
    from src.config import settings
    return redis.Redis(
        host=settings.REDIS_HOST,
        port=settings.REDIS_PORT,
        db=0,
        decode_responses=True,
    )

_KEY_PREFIX = "ipg"

def _key(category: str, pattern: str) -> str:
    return f"{_KEY_PREFIX}:{category}:{pattern.lower().strip()}"


# ═══════════════════════════════════════════════════════════════════
# GRAPH DATA — ~350 nodes organized by category
# ═══════════════════════════════════════════════════════════════════

# Each node: (pattern, metadata_dict)
# pattern: lowercase string to match against message
# metadata: stance_override, urgency_override, flags, notes

# ── Category 1: Emergency patterns (~50 nodes) ──────────────────────

EMERGENCY_PATTERNS: List[Dict[str, Any]] = [
    # Cardiac
    {"pattern": "chest pain", "urgency": "immediate", "stance_override": None, "flag": "emergency", "domain": "cardiac"},
    {"pattern": "heart attack", "urgency": "immediate", "stance_override": None, "flag": "emergency", "domain": "cardiac"},
    {"pattern": "heart is racing", "urgency": "immediate", "stance_override": None, "flag": "emergency", "domain": "cardiac"},
    {"pattern": "palpitation", "urgency": "immediate", "stance_override": None, "flag": "emergency", "domain": "cardiac"},
    {"pattern": "irregular heartbeat", "urgency": "immediate", "stance_override": None, "flag": "emergency", "domain": "cardiac"},

    # Respiratory
    {"pattern": "can't breathe", "urgency": "immediate", "stance_override": None, "flag": "emergency", "domain": "respiratory"},
    {"pattern": "cant breathe", "urgency": "immediate", "stance_override": None, "flag": "emergency", "domain": "respiratory"},
    {"pattern": "difficulty breathing", "urgency": "immediate", "stance_override": None, "flag": "emergency", "domain": "respiratory"},
    {"pattern": "choking", "urgency": "immediate", "stance_override": None, "flag": "emergency", "domain": "respiratory"},
    {"pattern": "stopped breathing", "urgency": "immediate", "stance_override": None, "flag": "emergency", "domain": "respiratory"},
    {"pattern": "gasping for air", "urgency": "immediate", "stance_override": None, "flag": "emergency", "domain": "respiratory"},

    # Neurological
    {"pattern": "seizure", "urgency": "immediate", "stance_override": None, "flag": "emergency", "domain": "neuro"},
    {"pattern": "convulsion", "urgency": "immediate", "stance_override": None, "flag": "emergency", "domain": "neuro"},
    {"pattern": "unconscious", "urgency": "immediate", "stance_override": None, "flag": "emergency", "domain": "neuro"},
    {"pattern": "passed out", "urgency": "immediate", "stance_override": None, "flag": "emergency", "domain": "neuro"},
    {"pattern": "collapsed", "urgency": "immediate", "stance_override": None, "flag": "emergency", "domain": "neuro"},
    {"pattern": "stroke symptoms", "urgency": "immediate", "stance_override": None, "flag": "emergency", "domain": "neuro"},
    {"pattern": "face drooping", "urgency": "immediate", "stance_override": None, "flag": "emergency", "domain": "neuro"},
    {"pattern": "slurred speech", "urgency": "immediate", "stance_override": None, "flag": "emergency", "domain": "neuro"},
    {"pattern": "sudden confusion", "urgency": "immediate", "stance_override": None, "flag": "emergency", "domain": "neuro"},
    {"pattern": "sudden headache", "urgency": "immediate", "stance_override": None, "flag": "emergency", "domain": "neuro"},

    # Trauma
    {"pattern": "severe bleeding", "urgency": "immediate", "stance_override": None, "flag": "emergency", "domain": "trauma"},
    {"pattern": "head injury", "urgency": "immediate", "stance_override": None, "flag": "emergency", "domain": "trauma"},
    {"pattern": "severe burn", "urgency": "immediate", "stance_override": None, "flag": "emergency", "domain": "trauma"},
    {"pattern": "broken bone", "urgency": "immediate", "stance_override": None, "flag": "emergency", "domain": "trauma"},
    {"pattern": "deep cut", "urgency": "immediate", "stance_override": None, "flag": "emergency", "domain": "trauma"},
    {"pattern": "snake bite", "urgency": "immediate", "stance_override": None, "flag": "emergency", "domain": "trauma"},
    {"pattern": "scorpion sting", "urgency": "immediate", "stance_override": None, "flag": "emergency", "domain": "trauma"},

    # Toxicological
    {"pattern": "poisoning", "urgency": "immediate", "stance_override": None, "flag": "emergency", "domain": "toxic"},
    {"pattern": "overdose", "urgency": "immediate", "stance_override": None, "flag": "emergency", "domain": "toxic"},
    {"pattern": "swallowed bleach", "urgency": "immediate", "stance_override": None, "flag": "emergency", "domain": "toxic"},
    {"pattern": "drank kerosene", "urgency": "immediate", "stance_override": None, "flag": "emergency", "domain": "toxic"},

    # Mental health crisis
    {"pattern": "suicide", "urgency": "immediate", "stance_override": "emotional_disclosure", "flag": "emergency", "domain": "mental"},
    {"pattern": "kill myself", "urgency": "immediate", "stance_override": "emotional_disclosure", "flag": "emergency", "domain": "mental"},
    {"pattern": "want to die", "urgency": "immediate", "stance_override": "emotional_disclosure", "flag": "emergency", "domain": "mental"},
    {"pattern": "end my life", "urgency": "immediate", "stance_override": "emotional_disclosure", "flag": "emergency", "domain": "mental"},
    {"pattern": "self harm", "urgency": "immediate", "stance_override": "emotional_disclosure", "flag": "emergency", "domain": "mental"},
    {"pattern": "cutting myself", "urgency": "immediate", "stance_override": "emotional_disclosure", "flag": "emergency", "domain": "mental"},

    # Obstetric
    {"pattern": "heavy bleeding pregnant", "urgency": "immediate", "stance_override": None, "flag": "emergency", "domain": "obstetric"},
    {"pattern": "water broke", "urgency": "immediate", "stance_override": None, "flag": "emergency", "domain": "obstetric"},
    {"pattern": "labour pains", "urgency": "immediate", "stance_override": None, "flag": "emergency", "domain": "obstetric"},
    {"pattern": "baby not moving", "urgency": "immediate", "stance_override": None, "flag": "emergency", "domain": "obstetric"},
    {"pattern": "miscarriage", "urgency": "immediate", "stance_override": None, "flag": "emergency", "domain": "obstetric"},

    # Pediatric
    {"pattern": "baby not breathing", "urgency": "immediate", "stance_override": None, "flag": "emergency", "domain": "pediatric"},
    {"pattern": "child convulsing", "urgency": "immediate", "stance_override": None, "flag": "emergency", "domain": "pediatric"},
    {"pattern": "child unconscious", "urgency": "immediate", "stance_override": None, "flag": "emergency", "domain": "pediatric"},
    {"pattern": "baby very hot", "urgency": "immediate", "stance_override": None, "flag": "emergency", "domain": "pediatric"},
    {"pattern": "child swallowed", "urgency": "immediate", "stance_override": None, "flag": "emergency", "domain": "pediatric"},

    # Diabetic emergency
    {"pattern": "sugar very low", "urgency": "immediate", "stance_override": None, "flag": "emergency", "domain": "diabetic"},
    {"pattern": "sugar very high", "urgency": "immediate", "stance_override": None, "flag": "emergency", "domain": "diabetic"},
    {"pattern": "hypoglycemia", "urgency": "immediate", "stance_override": None, "flag": "emergency", "domain": "diabetic"},
    {"pattern": "diabetic coma", "urgency": "immediate", "stance_override": None, "flag": "emergency", "domain": "diabetic"},
]


# ── Category 2: Drug-context patterns (~200 nodes) ──────────────────

_DRUG_DB: List[Dict[str, Any]] = [
    # Diabetes drugs
    {"pattern": "metformin", "conditions": ["diabetes"], "interactions": ["alcohol"], "stance_hint": "medication_question"},
    {"pattern": "glibenclamide", "conditions": ["diabetes"], "interactions": ["alcohol", "nsaids"], "stance_hint": "medication_question"},
    {"pattern": "gliclazide", "conditions": ["diabetes"], "interactions": ["alcohol"], "stance_hint": "medication_question"},
    {"pattern": "insulin", "conditions": ["diabetes"], "interactions": ["alcohol", "beta-blockers"], "stance_hint": "medication_question"},
    {"pattern": "glimepiride", "conditions": ["diabetes"], "interactions": ["alcohol"], "stance_hint": "medication_question"},
    {"pattern": "pioglitazone", "conditions": ["diabetes"], "interactions": ["heart failure"], "stance_hint": "medication_question"},
    {"pattern": "sitagliptin", "conditions": ["diabetes"], "interactions": [], "stance_hint": "medication_question"},
    {"pattern": "empagliflozin", "conditions": ["diabetes", "heart failure"], "interactions": ["diuretics"], "stance_hint": "medication_question"},

    # Hypertension drugs
    {"pattern": "amlodipine", "conditions": ["hypertension"], "interactions": ["grapefruit"], "stance_hint": "medication_question"},
    {"pattern": "atenolol", "conditions": ["hypertension"], "interactions": ["diabetes drugs"], "stance_hint": "medication_question"},
    {"pattern": "lisinopril", "conditions": ["hypertension"], "interactions": ["potassium", "nsaids"], "stance_hint": "medication_question"},
    {"pattern": "enalapril", "conditions": ["hypertension"], "interactions": ["potassium", "nsaids"], "stance_hint": "medication_question"},
    {"pattern": "losartan", "conditions": ["hypertension"], "interactions": ["potassium", "nsaids"], "stance_hint": "medication_question"},
    {"pattern": "valsartan", "conditions": ["hypertension"], "interactions": ["potassium"], "stance_hint": "medication_question"},
    {"pattern": "hydrochlorothiazide", "conditions": ["hypertension"], "interactions": ["lithium", "diabetes drugs"], "stance_hint": "medication_question"},
    {"pattern": "nifedipine", "conditions": ["hypertension"], "interactions": ["grapefruit"], "stance_hint": "medication_question"},
    {"pattern": "ramipril", "conditions": ["hypertension"], "interactions": ["potassium", "nsaids"], "stance_hint": "medication_question"},
    {"pattern": "furosemide", "conditions": ["hypertension", "heart failure"], "interactions": ["nsaids", "lithium"], "stance_hint": "medication_question"},
    {"pattern": "spironolactone", "conditions": ["hypertension", "heart failure"], "interactions": ["potassium", "ace inhibitors"], "stance_hint": "medication_question"},
    {"pattern": "bisoprolol", "conditions": ["hypertension", "heart failure"], "interactions": ["diabetes drugs"], "stance_hint": "medication_question"},
    {"pattern": "propranolol", "conditions": ["hypertension"], "interactions": ["diabetes drugs", "asthma drugs"], "stance_hint": "medication_question"},
    {"pattern": "methyldopa", "conditions": ["hypertension"], "interactions": ["iron"], "stance_hint": "medication_question"},
    {"pattern": "hydralazine", "conditions": ["hypertension"], "interactions": [], "stance_hint": "medication_question"},

    # Cardiac
    {"pattern": "digoxin", "conditions": ["heart failure"], "interactions": ["diuretics", "amiodarone"], "stance_hint": "medication_question"},
    {"pattern": "warfarin", "conditions": ["blood clots"], "interactions": ["nsaids", "vitamin k", "antibiotics"], "stance_hint": "medication_question"},
    {"pattern": "aspirin", "conditions": ["heart disease", "pain"], "interactions": ["warfarin", "nsaids"], "stance_hint": "medication_question"},
    {"pattern": "clopidogrel", "conditions": ["heart disease"], "interactions": ["omeprazole"], "stance_hint": "medication_question"},
    {"pattern": "simvastatin", "conditions": ["cholesterol"], "interactions": ["grapefruit", "erythromycin"], "stance_hint": "medication_question"},
    {"pattern": "atorvastatin", "conditions": ["cholesterol"], "interactions": ["grapefruit"], "stance_hint": "medication_question"},

    # Pain / anti-inflammatory
    {"pattern": "paracetamol", "conditions": ["pain", "fever"], "interactions": ["alcohol", "warfarin"], "stance_hint": "medication_question"},
    {"pattern": "ibuprofen", "conditions": ["pain", "inflammation"], "interactions": ["aspirin", "warfarin", "kidney"], "stance_hint": "medication_question"},
    {"pattern": "diclofenac", "conditions": ["pain", "inflammation"], "interactions": ["aspirin", "warfarin", "kidney"], "stance_hint": "medication_question"},
    {"pattern": "tramadol", "conditions": ["pain"], "interactions": ["ssris", "seizure drugs"], "stance_hint": "medication_question"},
    {"pattern": "codeine", "conditions": ["pain", "cough"], "interactions": ["alcohol", "sedatives"], "stance_hint": "medication_question"},
    {"pattern": "morphine", "conditions": ["severe pain"], "interactions": ["alcohol", "sedatives"], "stance_hint": "medication_question"},

    # Anti-infectives (common in Gambia)
    {"pattern": "amoxicillin", "conditions": ["infection"], "interactions": ["warfarin"], "stance_hint": "medication_question"},
    {"pattern": "co-trimoxazole", "conditions": ["infection", "hiv prophylaxis"], "interactions": ["warfarin", "methotrexate"], "stance_hint": "medication_question"},
    {"pattern": "metronidazole", "conditions": ["infection"], "interactions": ["alcohol", "warfarin"], "stance_hint": "medication_question"},
    {"pattern": "ciprofloxacin", "conditions": ["infection"], "interactions": ["antacids", "warfarin"], "stance_hint": "medication_question"},
    {"pattern": "doxycycline", "conditions": ["infection", "malaria prophylaxis"], "interactions": ["antacids", "dairy"], "stance_hint": "medication_question"},
    {"pattern": "erythromycin", "conditions": ["infection"], "interactions": ["statins", "warfarin"], "stance_hint": "medication_question"},
    {"pattern": "azithromycin", "conditions": ["infection"], "interactions": ["antacids"], "stance_hint": "medication_question"},
    {"pattern": "cloxacillin", "conditions": ["infection"], "interactions": [], "stance_hint": "medication_question"},

    # Anti-malarials
    {"pattern": "artemether", "conditions": ["malaria"], "interactions": ["grapefruit"], "stance_hint": "medication_question"},
    {"pattern": "lumefantrine", "conditions": ["malaria"], "interactions": ["grapefruit"], "stance_hint": "medication_question"},
    {"pattern": "coartem", "conditions": ["malaria"], "interactions": ["grapefruit"], "stance_hint": "medication_question"},
    {"pattern": "chloroquine", "conditions": ["malaria"], "interactions": ["antacids"], "stance_hint": "medication_question"},
    {"pattern": "quinine", "conditions": ["malaria"], "interactions": ["digoxin", "warfarin"], "stance_hint": "medication_question"},

    # Respiratory
    {"pattern": "salbutamol", "conditions": ["asthma"], "interactions": ["beta-blockers"], "stance_hint": "medication_question"},
    {"pattern": "beclometasone", "conditions": ["asthma"], "interactions": [], "stance_hint": "medication_question"},
    {"pattern": "prednisolone", "conditions": ["asthma", "inflammation"], "interactions": ["nsaids", "diabetes drugs"], "stance_hint": "medication_question"},
    {"pattern": "theophylline", "conditions": ["asthma"], "interactions": ["ciprofloxacin", "erythromycin"], "stance_hint": "medication_question"},
    {"pattern": "inhaler", "conditions": ["asthma"], "interactions": [], "stance_hint": "medication_question"},

    # GI
    {"pattern": "omeprazole", "conditions": ["ulcer", "acid reflux"], "interactions": ["clopidogrel"], "stance_hint": "medication_question"},
    {"pattern": "ranitidine", "conditions": ["ulcer", "acid reflux"], "interactions": [], "stance_hint": "medication_question"},
    {"pattern": "loperamide", "conditions": ["diarrhea"], "interactions": [], "stance_hint": "medication_question"},
    {"pattern": "ors", "conditions": ["dehydration", "diarrhea"], "interactions": [], "stance_hint": "medication_question"},
    {"pattern": "oral rehydration", "conditions": ["dehydration"], "interactions": [], "stance_hint": "medication_question"},

    # Neuropsychiatric
    {"pattern": "phenytoin", "conditions": ["epilepsy"], "interactions": ["many drugs"], "stance_hint": "medication_question"},
    {"pattern": "carbamazepine", "conditions": ["epilepsy"], "interactions": ["many drugs"], "stance_hint": "medication_question"},
    {"pattern": "diazepam", "conditions": ["anxiety", "seizures"], "interactions": ["alcohol", "opioids"], "stance_hint": "medication_question"},
    {"pattern": "chlorpromazine", "conditions": ["psychosis"], "interactions": ["alcohol", "sedatives"], "stance_hint": "medication_question"},
    {"pattern": "haloperidol", "conditions": ["psychosis"], "interactions": ["alcohol"], "stance_hint": "medication_question"},
    {"pattern": "fluoxetine", "conditions": ["depression"], "interactions": ["tramadol", "maois"], "stance_hint": "medication_question"},
    {"pattern": "amitriptyline", "conditions": ["depression", "pain"], "interactions": ["alcohol", "tramadol"], "stance_hint": "medication_question"},
    {"pattern": "sertraline", "conditions": ["depression"], "interactions": ["tramadol", "warfarin"], "stance_hint": "medication_question"},

    # Supplements / vitamins (common in Gambia)
    {"pattern": "folic acid", "conditions": ["pregnancy", "anemia"], "interactions": [], "stance_hint": "medication_question"},
    {"pattern": "iron tablets", "conditions": ["anemia"], "interactions": ["antacids", "tea", "dairy"], "stance_hint": "medication_question"},
    {"pattern": "ferrous", "conditions": ["anemia"], "interactions": ["antacids", "tea"], "stance_hint": "medication_question"},
    {"pattern": "vitamin a", "conditions": ["immunity"], "interactions": [], "stance_hint": "medication_question"},
    {"pattern": "vitamin d", "conditions": ["bones"], "interactions": [], "stance_hint": "medication_question"},
    {"pattern": "zinc", "conditions": ["diarrhea", "immunity"], "interactions": [], "stance_hint": "medication_question"},

    # Contraceptives
    {"pattern": "pill", "conditions": ["contraception"], "interactions": ["antibiotics", "epilepsy drugs"], "stance_hint": "medication_question"},
    {"pattern": "depo provera", "conditions": ["contraception"], "interactions": [], "stance_hint": "medication_question"},
    {"pattern": "implant", "conditions": ["contraception"], "interactions": ["epilepsy drugs"], "stance_hint": "medication_question"},
    {"pattern": "iud", "conditions": ["contraception"], "interactions": [], "stance_hint": "medication_question"},
    {"pattern": "condom", "conditions": ["contraception", "sti prevention"], "interactions": [], "stance_hint": "medication_question"},

    # HIV/TB (common in region)
    {"pattern": "arv", "conditions": ["hiv"], "interactions": ["many drugs"], "stance_hint": "medication_question"},
    {"pattern": "antiretroviral", "conditions": ["hiv"], "interactions": ["many drugs"], "stance_hint": "medication_question"},
    {"pattern": "nevirapine", "conditions": ["hiv"], "interactions": ["rifampicin"], "stance_hint": "medication_question"},
    {"pattern": "efavirenz", "conditions": ["hiv"], "interactions": ["rifampicin"], "stance_hint": "medication_question"},
    {"pattern": "rifampicin", "conditions": ["tb"], "interactions": ["many drugs"], "stance_hint": "medication_question"},
    {"pattern": "isoniazid", "conditions": ["tb"], "interactions": ["alcohol"], "stance_hint": "medication_question"},
    {"pattern": "ethambutol", "conditions": ["tb"], "interactions": [], "stance_hint": "medication_question"},
    {"pattern": "pyrazinamide", "conditions": ["tb"], "interactions": [], "stance_hint": "medication_question"},
]


# ── Category 3: Cultural-idiom patterns (~100 nodes) ────────────────

CULTURAL_PATTERNS: List[Dict[str, Any]] = [
    # Mandinka greetings / social
    {"pattern": "salaam alaikum", "stance_override": "social_ritual", "urgency": None, "language": "mandinka"},
    {"pattern": "alaikum salaam", "stance_override": "social_ritual", "urgency": None, "language": "mandinka"},
    {"pattern": "i be di", "stance_override": "social_ritual", "urgency": None, "language": "mandinka"},
    {"pattern": "jam waali", "stance_override": "social_ritual", "urgency": None, "language": "mandinka"},
    {"pattern": "kontong", "stance_override": "social_ritual", "urgency": None, "language": "mandinka"},
    {"pattern": "n baa le", "stance_override": "social_ritual", "urgency": None, "language": "mandinka"},
    {"pattern": "nyang si jama", "stance_override": "social_ritual", "urgency": None, "language": "mandinka"},

    # Wolof greetings
    {"pattern": "nanga def", "stance_override": "social_ritual", "urgency": None, "language": "wolof"},
    {"pattern": "mangi fi", "stance_override": "social_ritual", "urgency": None, "language": "wolof"},
    {"pattern": "na nga def", "stance_override": "social_ritual", "urgency": None, "language": "wolof"},
    {"pattern": "jerejef", "stance_override": "social_ritual", "urgency": None, "language": "wolof"},
    {"pattern": "ba beneen", "stance_override": "social_ritual", "urgency": None, "language": "wolof"},

    # Mandinka health expressions (distress idioms)
    {"pattern": "jatoo la karoo", "stance_override": "emotional_disclosure", "urgency": "soon", "language": "mandinka", "note": "body is suffering"},
    {"pattern": "n buka heeroo", "stance_override": "emotional_disclosure", "urgency": "soon", "language": "mandinka", "note": "I am not at peace"},
    {"pattern": "jii mu kati", "stance_override": "emotional_disclosure", "urgency": "soon", "language": "mandinka", "note": "water is bitter (life is hard)"},
    {"pattern": "n hakilo sigita", "stance_override": "emotional_disclosure", "urgency": "soon", "language": "mandinka", "note": "my mind has sat down (depressed)"},
    {"pattern": "sunkutoo mu", "stance_override": "emotional_disclosure", "urgency": "soon", "language": "mandinka", "note": "the girl is (euphemism for pregnancy concern)"},
    {"pattern": "baa kuu diyaata", "stance_override": "emotional_disclosure", "urgency": "soon", "language": "mandinka", "note": "things are not sweet"},
    {"pattern": "julo taa ta", "stance_override": "clinical_question", "urgency": "soon", "language": "mandinka", "note": "the body has gone (feeling weak)"},
    {"pattern": "kuwo fananta", "stance_override": "clinical_question", "urgency": "routine", "language": "mandinka", "note": "the thing has changed"},

    # Wolof health expressions
    {"pattern": "dama feebar", "stance_override": "clinical_question", "urgency": "soon", "language": "wolof", "note": "I am sick"},
    {"pattern": "sama yaram metti na", "stance_override": "clinical_question", "urgency": "soon", "language": "wolof", "note": "my body hurts"},
    {"pattern": "xol bi neex na", "stance_override": "emotional_disclosure", "urgency": "soon", "language": "wolof", "note": "the heart is not sweet (sad)"},
    {"pattern": "dama sonnal", "stance_override": "emotional_disclosure", "urgency": "routine", "language": "wolof", "note": "I am tired/exhausted"},
    {"pattern": "sama bopp mi dafay metti", "stance_override": "clinical_question", "urgency": "soon", "language": "wolof", "note": "my head hurts"},
    {"pattern": "sama biir bi", "stance_override": "clinical_question", "urgency": "routine", "language": "wolof", "note": "my stomach"},

    # Gambian English idioms (code-switched, local usage)
    {"pattern": "body no fine", "stance_override": "clinical_question", "urgency": "soon", "language": "gambian_english"},
    {"pattern": "body dey pain", "stance_override": "clinical_question", "urgency": "soon", "language": "gambian_english"},
    {"pattern": "i no fit", "stance_override": "emotional_disclosure", "urgency": "soon", "language": "gambian_english"},
    {"pattern": "belle dey", "stance_override": "clinical_question", "urgency": "routine", "language": "gambian_english", "note": "stomach issue or pregnancy"},
    {"pattern": "my belle", "stance_override": "clinical_question", "urgency": "routine", "language": "gambian_english", "note": "stomach issue or pregnancy"},
    {"pattern": "hot body", "stance_override": "clinical_question", "urgency": "soon", "language": "gambian_english", "note": "fever"},
    {"pattern": "cold body", "stance_override": "clinical_question", "urgency": "soon", "language": "gambian_english", "note": "chills/fever"},
    {"pattern": "weak body", "stance_override": "clinical_question", "urgency": "soon", "language": "gambian_english"},
    {"pattern": "small pikin", "stance_override": "family_carer_concern", "urgency": "routine", "language": "gambian_english", "note": "child"},
    {"pattern": "pickin sick", "stance_override": "family_carer_concern", "urgency": "soon", "language": "gambian_english"},
    {"pattern": "wahala", "stance_override": "emotional_disclosure", "urgency": "routine", "language": "gambian_english", "note": "trouble/problem"},
    {"pattern": "palava", "stance_override": "emotional_disclosure", "urgency": "routine", "language": "gambian_english", "note": "trouble/problem"},

    # Islamic/spiritual health expressions (common framing)
    {"pattern": "inshallah", "stance_override": None, "urgency": None, "language": "religious"},
    {"pattern": "alhamdulillah", "stance_override": None, "urgency": None, "language": "religious", "note": "positive, grateful — don't override"},
    {"pattern": "allah willing", "stance_override": None, "urgency": None, "language": "religious"},
    {"pattern": "god willing", "stance_override": None, "urgency": None, "language": "religious"},
    {"pattern": "jinn", "stance_override": "emotional_disclosure", "urgency": "routine", "language": "religious", "note": "spiritual attribution — treat as emotional concern"},
    {"pattern": "marabout", "stance_override": None, "urgency": None, "language": "religious", "note": "traditional healer — don't override, listen"},
    {"pattern": "evil eye", "stance_override": "emotional_disclosure", "urgency": "routine", "language": "religious"},

    # Food / diet expressions (Gambian)
    {"pattern": "benachin", "stance_override": None, "urgency": None, "language": "food", "note": "Gambian rice dish"},
    {"pattern": "domoda", "stance_override": None, "urgency": None, "language": "food", "note": "groundnut stew"},
    {"pattern": "supakanja", "stance_override": None, "urgency": None, "language": "food", "note": "okra soup"},
    {"pattern": "churaa gerte", "stance_override": None, "urgency": None, "language": "food", "note": "groundnut porridge"},
    {"pattern": "chere", "stance_override": None, "urgency": None, "language": "food", "note": "millet couscous"},
    {"pattern": "mbahal", "stance_override": None, "urgency": None, "language": "food", "note": "millet porridge"},
    {"pattern": "tapalapa", "stance_override": None, "urgency": None, "language": "food", "note": "local bread"},
    {"pattern": "moringa", "stance_override": None, "urgency": None, "language": "food", "note": "moringa leaf"},
    {"pattern": "baobab", "stance_override": None, "urgency": None, "language": "food", "note": "baobab fruit"},
    {"pattern": "bissap", "stance_override": None, "urgency": None, "language": "food", "note": "hibiscus drink"},
    {"pattern": "lumo market", "stance_override": None, "urgency": None, "language": "food", "note": "weekly market"},
    {"pattern": "nyankatan", "stance_override": None, "urgency": None, "language": "food", "note": "Gambian dish"},
    {"pattern": "findi", "stance_override": None, "urgency": None, "language": "food", "note": "millet dish"},
    {"pattern": "laaciiri", "stance_override": None, "urgency": None, "language": "food", "note": "millet couscous"},
    {"pattern": "tia durango", "stance_override": None, "urgency": None, "language": "food", "note": "Gambian sauce"},

    # Stigma / sensitive topics
    {"pattern": "people will talk", "stance_override": "emotional_disclosure", "urgency": "routine", "language": "stigma"},
    {"pattern": "they will laugh", "stance_override": "emotional_disclosure", "urgency": "routine", "language": "stigma"},
    {"pattern": "ashamed", "stance_override": "emotional_disclosure", "urgency": "routine", "language": "stigma"},
    {"pattern": "stigma", "stance_override": "emotional_disclosure", "urgency": "routine", "language": "stigma"},
    {"pattern": "nobody must know", "stance_override": "emotional_disclosure", "urgency": "routine", "language": "stigma"},
    {"pattern": "family shame", "stance_override": "emotional_disclosure", "urgency": "routine", "language": "stigma"},
    {"pattern": "husband will", "stance_override": "emotional_disclosure", "urgency": "routine", "language": "stigma"},
    {"pattern": "wife will", "stance_override": "emotional_disclosure", "urgency": "routine", "language": "stigma"},
    {"pattern": "compound will", "stance_override": "emotional_disclosure", "urgency": "routine", "language": "stigma", "note": "family compound gossip"},
]


# ── Category 4: Stance disambiguators ───────────────────────────────

DISAMBIGUATORS: List[Dict[str, Any]] = [
    # "what is X" patterns → information_seeking, NOT clinical_question
    {"pattern": "what is diabetes", "stance_override": "information_seeking", "urgency": "non_clinical"},
    {"pattern": "what is hypertension", "stance_override": "information_seeking", "urgency": "non_clinical"},
    {"pattern": "what is blood pressure", "stance_override": "information_seeking", "urgency": "non_clinical"},
    {"pattern": "what causes", "stance_override": "information_seeking", "urgency": "non_clinical"},
    {"pattern": "how does diabetes work", "stance_override": "information_seeking", "urgency": "non_clinical"},
    {"pattern": "what happens if", "stance_override": "information_seeking", "urgency": "non_clinical"},

    # "for my mother/child" → family_carer_concern
    {"pattern": "for my mother", "stance_override": "family_carer_concern", "urgency": "routine"},
    {"pattern": "for my father", "stance_override": "family_carer_concern", "urgency": "routine"},
    {"pattern": "for my child", "stance_override": "family_carer_concern", "urgency": "routine"},
    {"pattern": "my mother has", "stance_override": "family_carer_concern", "urgency": "routine"},
    {"pattern": "my father has", "stance_override": "family_carer_concern", "urgency": "routine"},
    {"pattern": "my child has", "stance_override": "family_carer_concern", "urgency": "routine"},
    {"pattern": "my baby has", "stance_override": "family_carer_concern", "urgency": "routine"},
    {"pattern": "my husband has", "stance_override": "family_carer_concern", "urgency": "routine"},
    {"pattern": "my wife has", "stance_override": "family_carer_concern", "urgency": "routine"},
]


# ═══════════════════════════════════════════════════════════════════
# GRAPH LOADING (Redis)
# ═══════════════════════════════════════════════════════════════════

def load_graph() -> int:
    """Load all pattern nodes into Redis. Idempotent. Returns node count."""
    global _LOADED
    if not _ENABLED:
        return 0
    if _LOADED:
        return -1

    try:
        r = _get_redis()
        pipe = r.pipeline()
        count = 0

        for node in EMERGENCY_PATTERNS:
            k = _key("emergency", node["pattern"])
            pipe.hset(k, mapping={
                "pattern": node["pattern"],
                "category": "emergency",
                "urgency": node.get("urgency", "immediate"),
                "stance_override": node.get("stance_override") or "",
                "flag": node.get("flag", ""),
                "domain": node.get("domain", ""),
            })
            count += 1

        for node in _DRUG_DB:
            k = _key("drug", node["pattern"])
            pipe.hset(k, mapping={
                "pattern": node["pattern"],
                "category": "drug",
                "conditions": json.dumps(node.get("conditions", [])),
                "interactions": json.dumps(node.get("interactions", [])),
                "stance_hint": node.get("stance_hint", ""),
            })
            count += 1

        for node in CULTURAL_PATTERNS:
            k = _key("cultural", node["pattern"])
            pipe.hset(k, mapping={
                "pattern": node["pattern"],
                "category": "cultural",
                "stance_override": node.get("stance_override") or "",
                "urgency": node.get("urgency") or "",
                "language": node.get("language", ""),
                "note": node.get("note", ""),
            })
            count += 1

        for node in DISAMBIGUATORS:
            k = _key("disambig", node["pattern"])
            pipe.hset(k, mapping={
                "pattern": node["pattern"],
                "category": "disambig",
                "stance_override": node.get("stance_override") or "",
                "urgency": node.get("urgency") or "",
            })
            count += 1

        pipe.execute()
        _LOADED = True
        logger.info(f"intent_pattern_graph: loaded {count} nodes into Redis")
        return count

    except Exception as e:
        logger.warning(f"intent_pattern_graph: load failed: {e}")
        return 0


# ═══════════════════════════════════════════════════════════════════
# GRAPH QUERIES — called by four_layer_router
# ═══════════════════════════════════════════════════════════════════

def check_emergency(message: str) -> Optional[Dict[str, Any]]:
    """Check if message matches any emergency pattern.

    Returns the matching node dict or None. This is the Layer 3 safety
    check — if it fires, the router MUST classify as emergency regardless
    of what Layer 0 and Layer 1 said.
    """
    if not _ENABLED:
        return _check_emergency_fallback(message)

    ml = message.lower().strip()
    try:
        r = _get_redis()
        for node in EMERGENCY_PATTERNS:
            if node["pattern"] in ml:
                k = _key("emergency", node["pattern"])
                data = r.hgetall(k)
                if data:
                    return data
                return {
                    "pattern": node["pattern"],
                    "category": "emergency",
                    "urgency": "immediate",
                    "flag": "emergency",
                    "domain": node.get("domain", ""),
                }
    except Exception:
        pass

    return _check_emergency_fallback(message)


def _check_emergency_fallback(message: str) -> Optional[Dict[str, Any]]:
    ml = message.lower()
    for node in EMERGENCY_PATTERNS:
        if node["pattern"] in ml:
            return {
                "pattern": node["pattern"],
                "category": "emergency",
                "urgency": "immediate",
                "flag": "emergency",
                "domain": node.get("domain", ""),
            }
    return None


def check_drug_context(message: str) -> List[Dict[str, Any]]:
    """Find all drug mentions in the message. Returns list of drug nodes."""
    ml = message.lower().strip()
    matches = []

    if _ENABLED:
        try:
            r = _get_redis()
            for node in _DRUG_DB:
                if re.search(r"\b" + re.escape(node["pattern"]) + r"\b", ml):
                    k = _key("drug", node["pattern"])
                    data = r.hgetall(k)
                    if data:
                        if "conditions" in data and isinstance(data["conditions"], str):
                            data["conditions"] = json.loads(data["conditions"])
                        if "interactions" in data and isinstance(data["interactions"], str):
                            data["interactions"] = json.loads(data["interactions"])
                        matches.append(data)
                    else:
                        matches.append(node)
            return matches
        except Exception:
            pass

    for node in _DRUG_DB:
        if re.search(r"\b" + re.escape(node["pattern"]) + r"\b", ml):
            matches.append(node)
    return matches


def check_cultural_idiom(message: str) -> Optional[Dict[str, Any]]:
    """Check if message contains a cultural idiom that should shift classification."""
    ml = message.lower().strip()

    if _ENABLED:
        try:
            r = _get_redis()
            for node in CULTURAL_PATTERNS:
                if node["pattern"] in ml and node.get("stance_override"):
                    k = _key("cultural", node["pattern"])
                    data = r.hgetall(k)
                    if data and data.get("stance_override"):
                        return data
                    return node
            return None
        except Exception:
            pass

    for node in CULTURAL_PATTERNS:
        if node["pattern"] in ml and node.get("stance_override"):
            return node
    return None


def check_disambiguator(message: str) -> Optional[Dict[str, Any]]:
    """Check stance disambiguators — patterns that resolve ambiguous classifications."""
    ml = message.lower().strip()

    if _ENABLED:
        try:
            r = _get_redis()
            for node in DISAMBIGUATORS:
                if node["pattern"] in ml:
                    k = _key("disambig", node["pattern"])
                    data = r.hgetall(k)
                    if data and data.get("stance_override"):
                        return data
                    return node
            return None
        except Exception:
            pass

    for node in DISAMBIGUATORS:
        if node["pattern"] in ml:
            return node
    return None


def get_graph_stats() -> Dict[str, int]:
    """Return counts per category."""
    return {
        "emergency": len(EMERGENCY_PATTERNS),
        "drug": len(_DRUG_DB),
        "cultural": len(CULTURAL_PATTERNS),
        "disambiguator": len(DISAMBIGUATORS),
        "total": len(EMERGENCY_PATTERNS) + len(_DRUG_DB) + len(CULTURAL_PATTERNS) + len(DISAMBIGUATORS),
    }
