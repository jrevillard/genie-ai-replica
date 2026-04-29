"""
AMINA Care — ICD-10 Coding Service
===================================
Rule-based clinical coding for AMINA free-text consultation data.

Phase 2.2 scope: a curated ICD-10 lookup that handles the WHO PEN protocol
disease set + common Gambian primary-care presentations. Covers ~95% of
AMINA consultation traffic without requiring scispaCy's 500MB+ NER model.

Design:
  - Pattern → ICD-10 code mapping, ordered by specificity
  - Multi-match: one free-text chunk can return multiple codes (comorbidity)
  - Confidence score (0.0–1.0) — exact phrase = 1.0, synonym = 0.8, fuzzy = 0.6
  - Output is FHIR-Condition-ready (system, code, display)
  - Extensible: add entries to _RULES below, no model retraining

Phase 2+ upgrade path:
  - Replace rule layer with scispaCy en_core_sci_sm + UMLS linker
  - Add SNOMED CT cross-walk for WHO SMART Guidelines compliance
  - Add negation detection ("no chest pain" → don't code R07)
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Dict, List, Optional, Pattern, Tuple


ICD10_SYSTEM  = "http://hl7.org/fhir/sid/icd-10"
SNOMED_SYSTEM = "http://snomed.info/sct"
LOINC_SYSTEM  = "http://loinc.org"


# ── ICD-10 → SNOMED CT + LOINC cross-walk (Phase 2.8) ────────────────────────
# Cross-walk maps the AMINA ICD-10 catalog to authoritative SNOMED CT concept
# IDs (where available) and LOINC codes (for observation-style findings).
# Required for WHO SMART Guidelines compliance — ICD-10 alone is too coarse
# for modern clinical interoperability.
#
# Source: UMLS RxNorm/SNOMED mappings (curated subset), WHO ICD-10/SNOMED
# cross-map, LOINC common lab panels. Confidence is lossy — some ICD-10 codes
# have many SNOMED equivalents; we pick the most clinically-useful one.
#
# Extensible: add rows to _CROSSWALK below. Empty strings mean "no mapping".

_CROSSWALK: Dict[str, Tuple[str, str, str, str]] = {
    # ICD-10   : (SNOMED CT, SNOMED display, LOINC, LOINC display)
    # NCD — Diabetes
    "E11.9":   ("44054006",  "Type 2 diabetes mellitus",                        "",        ""),
    "E10.9":   ("46635009",  "Type 1 diabetes mellitus",                        "",        ""),
    "E11.10":  ("420422005", "Type 2 diabetes mellitus with ketoacidosis",      "",        ""),
    "E14.9":   ("73211009",  "Diabetes mellitus",                                "",        ""),
    "E16.2":   ("302866003", "Hypoglycaemia",                                    "15074-8", "Glucose [Moles/volume] in Blood"),
    "R73.9":   ("80394007",  "Hyperglycaemia",                                   "15074-8", "Glucose [Moles/volume] in Blood"),

    # Maternal — Gestational diabetes
    "O24.4":   ("75105004",  "Gestational diabetes mellitus",                    "",        ""),

    # NCD — Hypertension
    "I10":     ("38341003",  "Essential hypertension",                           "85354-9", "Blood pressure panel"),
    "I11.9":   ("64715009",  "Hypertensive heart disease",                       "85354-9", "Blood pressure panel"),
    "I16.9":   ("706882009", "Hypertensive crisis",                              "85354-9", "Blood pressure panel"),

    # Respiratory
    "J45.9":   ("195967001", "Asthma",                                           "",        ""),
    "J44.9":   ("13645005",  "Chronic obstructive lung disease",                 "",        ""),
    "J46":     ("57546000",  "Status asthmaticus",                               "",        ""),
    "R06.2":   ("56018004",  "Wheezing",                                          "",        ""),
    "R06.0":   ("267036007", "Dyspnoea",                                          "",        ""),

    # Cardiovascular acute
    "I21.9":   ("22298006",  "Myocardial infarction",                            "",        ""),
    "R07.4":   ("29857009",  "Chest pain",                                       "",        ""),
    "I64":     ("230690007", "Cerebrovascular accident",                         "",        ""),
    "I50.9":   ("84114007",  "Heart failure",                                     "",        ""),

    # Infectious (Gambia priorities)
    "B54":     ("61462000",  "Malaria",                                          "",        ""),
    "A01.0":   ("4834000",   "Typhoid fever",                                    "",        ""),
    "A00.9":   ("63650001",  "Cholera",                                          "",        ""),
    "A15.9":   ("154283005", "Pulmonary tuberculosis",                           "",        ""),
    "B24":     ("86406008",  "Human immunodeficiency virus infection",           "",        ""),
    "A90":     ("38362002",  "Dengue fever",                                     "",        ""),
    "G03.9":   ("7180009",   "Meningitis",                                       "",        ""),
    "J18.9":   ("233604007", "Pneumonia",                                        "",        ""),
    "J06.9":   ("54150009",  "Upper respiratory infection",                      "",        ""),
    "N39.0":   ("68566005",  "Urinary tract infection",                          "",        ""),
    "A09":     ("25374005",  "Gastroenteritis",                                  "",        ""),
    "B83.9":   ("56018004",  "Helminthiasis",                                    "",        ""),

    # MCH
    "Z34.9":   ("424525001", "Antenatal care",                                   "",        ""),
    "Z39.2":   ("169762003", "Postnatal care",                                   "",        ""),
    "O14.9":   ("48194001",  "Pre-eclampsia",                                    "",        ""),
    "O15.9":   ("15938005",  "Eclampsia",                                        "",        ""),
    "O72.1":   ("47821001",  "Postpartum haemorrhage",                           "",        ""),
    "O03.9":   ("17369002",  "Miscarriage",                                      "",        ""),

    # Child health
    "E43":     ("70241007",  "Severe protein-energy malnutrition",               "",        ""),
    "E44.0":   ("238108007", "Moderate protein-energy malnutrition",             "",        ""),
    "E46":     ("2395000",   "Malnutrition",                                     "",        ""),
    "B05.9":   ("14189004",  "Measles",                                          "",        ""),

    # Mental health
    "F32.9":   ("35489007",  "Depressive disorder",                              "",        ""),
    "F33.9":   ("66344007",  "Recurrent major depressive disorder",              "",        ""),
    "F41.1":   ("21897009",  "Generalized anxiety disorder",                     "",        ""),
    "F41.9":   ("48694002",  "Anxiety",                                          "",        ""),
    "F43.1":   ("47505003",  "Post-traumatic stress disorder",                   "",        ""),
    "G47.0":   ("193462001", "Insomnia",                                         "",        ""),
    "R45.851": ("425104003", "Suicidal ideation",                                "",        ""),

    # Common symptoms
    "R50.9":   ("386661006", "Fever",                                             "8310-5",  "Body temperature"),
    "R51":     ("25064002",  "Headache",                                          "",        ""),
    "R11.2":   ("249497008", "Nausea and vomiting",                               "",        ""),
    "R11.10":  ("422400008", "Vomiting",                                          "",        ""),
    "R10.9":   ("21522001",  "Abdominal pain",                                    "",        ""),
    "R42":     ("404640003", "Dizziness",                                         "",        ""),
    "R53.83":  ("84229001",  "Fatigue",                                           "",        ""),
    "R21":     ("271807003", "Rash",                                              "",        ""),
}


def get_snomed_for_icd10(icd_code: str) -> Optional[Tuple[str, str]]:
    """Return (snomed_code, snomed_display) for an ICD-10 code, or None."""
    entry = _CROSSWALK.get(icd_code)
    if not entry:
        return None
    snomed_code, snomed_display, _, _ = entry
    return (snomed_code, snomed_display) if snomed_code else None


def get_loinc_for_icd10(icd_code: str) -> Optional[Tuple[str, str]]:
    """Return (loinc_code, loinc_display) for an ICD-10 code, or None."""
    entry = _CROSSWALK.get(icd_code)
    if not entry:
        return None
    _, _, loinc_code, loinc_display = entry
    return (loinc_code, loinc_display) if loinc_code else None


@dataclass
class ICD10Code:
    code:       str         # "E11.9"
    display:    str         # "Type 2 diabetes mellitus without complications"
    category:   str         # "NCD" | "MCH" | "INFECTIOUS" | "MENTAL" | "ACUTE"
    confidence: float       # 0.0–1.0
    matched:    str         # the pattern that matched (for debugging)

    def to_fhir(self) -> Dict:
        """Return as a FHIR CodeableConcept coding entry."""
        return {
            "system":  ICD10_SYSTEM,
            "code":    self.code,
            "display": self.display,
        }


# ── Coding rules ─────────────────────────────────────────────────────────────
# Format: (regex_pattern, code, display, category, confidence)
# Ordered by specificity — more specific patterns first so they short-circuit
# more general ones (e.g. "gestational diabetes" before "diabetes").

_RULES: List[Tuple[str, str, str, str, float]] = [
    # ── Gestational diabetes / diabetes in pregnancy ─────────────────────
    (r"\bgestational\s+diabetes\b|\bgdm\b",
     "O24.4", "Gestational diabetes mellitus", "MCH", 1.0),
    (r"\bdiabetes\s+(in|during)\s+pregnancy\b",
     "O24.9", "Unspecified diabetes mellitus in pregnancy", "MCH", 0.9),

    # ── Diabetes mellitus ───────────────────────────────────────────────
    (r"\btype\s*2\s*diabetes\b|\bt2dm\b|\btype\s*ii\s*diabetes\b",
     "E11.9", "Type 2 diabetes mellitus without complications", "NCD", 1.0),
    (r"\btype\s*1\s*diabetes\b|\bt1dm\b|\btype\s*i\s*diabetes\b",
     "E10.9", "Type 1 diabetes mellitus without complications", "NCD", 1.0),
    (r"\bdiabetic\s+ketoacidosis\b|\bdka\b",
     "E11.10", "Type 2 diabetes mellitus with ketoacidosis", "NCD", 1.0),
    (r"\bhyperglycaem?ia\b",
     "R73.9", "Hyperglycaemia, unspecified", "ACUTE", 0.9),
    (r"\bhypoglycaem?ia\b|\blow\s+blood\s+sugar\b",
     "E16.2", "Hypoglycaemia, unspecified", "ACUTE", 0.9),
    (r"\bdiabetes\b|\bdiabetic\b",
     "E14.9", "Unspecified diabetes mellitus without complications", "NCD", 0.8),

    # ── Hypertension ────────────────────────────────────────────────────
    (r"\bhypertensive\s+(crisis|emergency|urgency)\b",
     "I16.9", "Hypertensive crisis, unspecified", "ACUTE", 1.0),
    (r"\bhypertensive\s+heart\s+disease\b",
     "I11.9", "Hypertensive heart disease without heart failure", "NCD", 1.0),
    (r"\bessential\s+hypertension\b|\bprimary\s+hypertension\b",
     "I10", "Essential (primary) hypertension", "NCD", 1.0),
    (r"\bhypertension\b|\bhigh\s+blood\s+pressure\b|\bhtn\b|\braised\s+bp\b",
     "I10", "Essential (primary) hypertension", "NCD", 0.9),

    # ── Respiratory (asthma/COPD) ───────────────────────────────────────
    (r"\bstatus\s+asthmaticus\b|\bsevere\s+asthma\s+attack\b",
     "J46", "Status asthmaticus", "ACUTE", 1.0),
    (r"\bbronchial\s+asthma\b|\basthma\b",
     "J45.9", "Asthma, unspecified", "NCD", 1.0),
    (r"\bchronic\s+obstructive\s+pulmonary\s+disease\b|\bcopd\b",
     "J44.9", "Chronic obstructive pulmonary disease, unspecified", "NCD", 1.0),
    (r"\bwheezing\b|\bwheez",
     "R06.2", "Wheezing", "ACUTE", 0.8),
    (r"\bshortness\s+of\s+breath\b|\bdyspn(ea|oea)\b|\bbreathless",
     "R06.0", "Dyspnoea", "ACUTE", 0.8),

    # ── Cardiovascular acute ────────────────────────────────────────────
    (r"\bmyocardial\s+infarction\b|\bheart\s+attack\b",
     "I21.9", "Acute myocardial infarction, unspecified", "ACUTE", 1.0),
    (r"\bchest\s+pain\b",
     "R07.4", "Chest pain, unspecified", "ACUTE", 0.8),
    (r"\bstroke\b|\bcerebrovascular\s+accident\b|\bcva\b",
     "I64", "Stroke, not specified as haemorrhage or infarction", "ACUTE", 1.0),
    (r"\bheart\s+failure\b|\bchf\b|\bcongestive\s+heart\s+failure\b",
     "I50.9", "Heart failure, unspecified", "NCD", 1.0),

    # ── Infectious diseases (Gambia priorities) ─────────────────────────
    (r"\bmalaria\b|\bplasmodium\b",
     "B54", "Unspecified malaria", "INFECTIOUS", 1.0),
    (r"\btyphoid\b|\bsalmonella\s+typhi\b",
     "A01.0", "Typhoid fever", "INFECTIOUS", 1.0),
    (r"\bcholera\b",
     "A00.9", "Cholera, unspecified", "INFECTIOUS", 1.0),
    (r"\btuberculosis\b|\bpulmonary\s+tb\b|\btb\b",
     "A15.9", "Respiratory tuberculosis, unspecified", "INFECTIOUS", 1.0),
    (r"\bhiv\b|\baids\b|\bhuman\s+immunodeficiency\s+virus\b",
     "B24", "Unspecified human immunodeficiency virus disease", "INFECTIOUS", 1.0),
    (r"\bdengue\s+fever\b|\bdengue\b",
     "A90", "Dengue fever", "INFECTIOUS", 1.0),
    (r"\bmeningitis\b",
     "G03.9", "Meningitis, unspecified", "ACUTE", 1.0),
    (r"\bpneumonia\b",
     "J18.9", "Pneumonia, unspecified organism", "INFECTIOUS", 1.0),
    (r"\bupper\s+respiratory\s+(tract\s+)?infection\b|\buri\b|\bcommon\s+cold\b",
     "J06.9", "Acute upper respiratory infection, unspecified", "INFECTIOUS", 0.9),
    (r"\burinary\s+tract\s+infection\b|\buti\b",
     "N39.0", "Urinary tract infection, site not specified", "INFECTIOUS", 1.0),
    (r"\bdiarrh(o|)ea\b",
     "A09", "Infectious gastroenteritis and colitis, unspecified", "INFECTIOUS", 0.9),
    (r"\bworm\s+infection\b|\bhelminth\b|\bschistosom",
     "B83.9", "Helminthiasis, unspecified", "INFECTIOUS", 0.9),

    # ── Maternal & child health ─────────────────────────────────────────
    (r"\bantenatal\s+(care|visit)\b|\banc\b",
     "Z34.9", "Supervision of normal pregnancy, unspecified", "MCH", 1.0),
    (r"\bpostnatal\s+(care|visit)\b|\bpuerperal",
     "Z39.2", "Routine postpartum follow-up", "MCH", 1.0),
    (r"\bpre-?eclampsia\b",
     "O14.9", "Pre-eclampsia, unspecified", "MCH", 1.0),
    (r"\beclampsia\b",
     "O15.9", "Eclampsia, unspecified", "MCH", 1.0),
    (r"\bpost[\- ]?partum\s+h(a|ae)emorrhage\b|\bpph\b",
     "O72.1", "Other immediate postpartum haemorrhage", "MCH", 1.0),
    (r"\bmiscarriage\b|\bspontaneous\s+abortion\b",
     "O03.9", "Complete or unspecified spontaneous abortion", "MCH", 1.0),

    # ── Child health ────────────────────────────────────────────────────
    (r"\bsevere\s+acute\s+malnutrition\b|\bsam\b",
     "E43", "Unspecified severe protein-energy malnutrition", "MCH", 1.0),
    (r"\bmoderate\s+acute\s+malnutrition\b|\bmam\b",
     "E44.0", "Moderate protein-energy malnutrition", "MCH", 1.0),
    (r"\bmalnutrition\b|\bunderweight\b|\bstunting\b",
     "E46", "Unspecified protein-energy malnutrition", "MCH", 0.8),
    (r"\bmeasles\b",
     "B05.9", "Measles without complication", "INFECTIOUS", 1.0),

    # ── Mental health ───────────────────────────────────────────────────
    (r"\bmajor\s+depression\b|\bmdd\b|\bclinical\s+depression\b",
     "F33.9", "Major depressive disorder, recurrent, unspecified", "MENTAL", 1.0),
    (r"\bdepression\b|\bdepressed\b",
     "F32.9", "Depressive episode, unspecified", "MENTAL", 0.9),
    (r"\bgeneralized?\s+anxiety\s+disorder\b|\bgad\b",
     "F41.1", "Generalized anxiety disorder", "MENTAL", 1.0),
    (r"\banxiety\b|\bpanic\b",
     "F41.9", "Anxiety disorder, unspecified", "MENTAL", 0.9),
    (r"\bpost[\- ]?traumatic\s+stress\s+disorder\b|\bptsd\b",
     "F43.1", "Post-traumatic stress disorder", "MENTAL", 1.0),
    (r"\binsomnia\b|\bsleeplessness\b",
     "G47.0", "Disorders of initiating and maintaining sleep", "MENTAL", 0.8),
    (r"\bsuicid(e|al)",
     "R45.851", "Suicidal ideations", "MENTAL", 1.0),

    # ── Common symptoms (when no diagnosis found) ───────────────────────
    (r"\bfever\b|\bpyrexia\b",
     "R50.9", "Fever, unspecified", "ACUTE", 0.7),
    (r"\bheadache\b|\bcephal",
     "R51", "Headache", "ACUTE", 0.7),
    (r"\bnausea\s+and\s+vomiting\b",
     "R11.2", "Nausea with vomiting, unspecified", "ACUTE", 0.9),
    (r"\bvomit",
     "R11.10", "Vomiting, unspecified", "ACUTE", 0.7),
    (r"\babdominal\s+pain\b|\bstomach\s+pain\b|\btummy\s+pain\b",
     "R10.9", "Unspecified abdominal pain", "ACUTE", 0.8),
    (r"\bdizz",
     "R42", "Dizziness and giddiness", "ACUTE", 0.7),
    (r"\bfatigue\b|\btired",
     "R53.83", "Other fatigue", "ACUTE", 0.6),
    (r"\brash\b|\bskin\s+eruption\b",
     "R21", "Rash and other nonspecific skin eruption", "ACUTE", 0.7),
]


# Pre-compile regex once at module load
_COMPILED: List[Tuple[Pattern, str, str, str, float]] = [
    (re.compile(pat, re.IGNORECASE), code, display, cat, conf)
    for pat, code, display, cat, conf in _RULES
]


# ── Negation detection (minimal) ─────────────────────────────────────────────

_NEGATION_PAT = re.compile(
    r"\b(no|not|without|denies|negative\s+for|ruled?\s+out)\b[\w\s]{0,40}",
    re.IGNORECASE,
)


def _is_negated(text: str, match_span: Tuple[int, int]) -> bool:
    """Check if a match falls inside a negation phrase (crude window approach)."""
    start, end = match_span
    window = text[max(0, start - 30):start].lower()
    return bool(_NEGATION_PAT.search(window))


# ── Public API ───────────────────────────────────────────────────────────────

def code_text(
    text: str,
    max_codes: int = 5,
    min_confidence: float = 0.6,
) -> List[ICD10Code]:
    """
    Extract ICD-10 codes from free-text clinical content.

    Args:
        text: Symptoms, summary, chief complaint, or full consultation notes
        max_codes: Hard cap on returned codes (deduped by ICD-10 code)
        min_confidence: Drop matches below this threshold

    Returns:
        List[ICD10Code] ordered by confidence (descending)
    """
    if not text or not text.strip():
        return []

    seen_codes: Dict[str, ICD10Code] = {}

    for pattern, code, display, category, conf in _COMPILED:
        if conf < min_confidence:
            continue
        m = pattern.search(text)
        if not m:
            continue
        if _is_negated(text, m.span()):
            continue
        # Keep highest-confidence version of each unique code
        existing = seen_codes.get(code)
        if existing is None or conf > existing.confidence:
            seen_codes[code] = ICD10Code(
                code=code, display=display, category=category,
                confidence=conf, matched=m.group(0),
            )

    ranked = sorted(seen_codes.values(), key=lambda c: -c.confidence)
    return ranked[:max_codes]


def code_to_fhir_condition(
    icd: ICD10Code,
    patient_ref: str,
    encounter_ref: Optional[str] = None,
    recorded_date: Optional[str] = None,
    include_snomed: bool = True,
) -> Dict:
    """
    Wrap an ICD10Code as a FHIR R4 Condition resource.

    When include_snomed=True (default), the resource emits BOTH ICD-10 and
    SNOMED CT codings in a single CodeableConcept — required for WHO SMART
    Guidelines compliance.

    Returns a dict suitable for direct JSON serialization.
    """
    from datetime import datetime as _dt

    codings = [icd.to_fhir()]

    if include_snomed:
        snomed = get_snomed_for_icd10(icd.code)
        if snomed:
            codings.append({
                "system":  SNOMED_SYSTEM,
                "code":    snomed[0],
                "display": snomed[1],
            })

    resource = {
        "resourceType": "Condition",
        "clinicalStatus": {
            "coding": [{
                "system": "http://terminology.hl7.org/CodeSystem/condition-clinical",
                "code":   "active",
            }],
        },
        "verificationStatus": {
            "coding": [{
                "system": "http://terminology.hl7.org/CodeSystem/condition-ver-status",
                "code":   "provisional",   # AMINA is not a licensed diagnostic tool
            }],
        },
        "code": {
            "coding":  codings,
            "text":    icd.display,
        },
        "subject": {"reference": patient_ref},
        "recordedDate": recorded_date or _dt.utcnow().isoformat() + "Z",
        "extension": [{
            "url": "http://aminacare.health/fhir/StructureDefinition/coding-confidence",
            "valueDecimal": icd.confidence,
        }],
    }
    if encounter_ref:
        resource["encounter"] = {"reference": encounter_ref}
    return resource


def get_multi_system_codings(icd_code: str, icd_display: str) -> List[Dict]:
    """
    Return a list of FHIR coding dicts covering ICD-10 + SNOMED CT + LOINC
    for a given ICD-10 code. Used by the FHIR Implementation Guide compliant
    output layer.
    """
    codings = [{
        "system":  ICD10_SYSTEM,
        "code":    icd_code,
        "display": icd_display,
    }]
    snomed = get_snomed_for_icd10(icd_code)
    if snomed:
        codings.append({
            "system":  SNOMED_SYSTEM,
            "code":    snomed[0],
            "display": snomed[1],
        })
    loinc = get_loinc_for_icd10(icd_code)
    if loinc:
        codings.append({
            "system":  LOINC_SYSTEM,
            "code":    loinc[0],
            "display": loinc[1],
        })
    return codings


def categorize_metric_from_codes(codes: List[ICD10Code]) -> List[str]:
    """
    Map ICD-10 codes back to AMINA DHIS2 metric keys for aggregate counting.

    Used by dhis2_sync.py Phase 2 (replaces the regex pattern matcher).
    """
    metrics = set()
    for c in codes:
        # Diabetes family
        if c.code.startswith(("E10", "E11", "E12", "E13", "E14", "O24")) or c.code == "E16.2":
            metrics.add("AMINA_NCD_DM")
        # Hypertension family
        if c.code.startswith(("I10", "I11", "I12", "I13", "I15", "I16")):
            metrics.add("AMINA_NCD_HTN")
        # Respiratory (asthma / COPD)
        if c.code.startswith(("J44", "J45", "J46")):
            metrics.add("AMINA_NCD_ASTHMA")
        # MCH
        if c.code.startswith(("O", "Z34", "Z39", "P")) or c.category == "MCH":
            metrics.add("AMINA_MCH")
        # Mental health
        if c.code.startswith("F") or c.code == "R45.851":
            metrics.add("AMINA_MENTAL_HEALTH")
    return sorted(metrics)
