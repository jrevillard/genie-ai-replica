"""
Clinical Citation Service — AMINA Caregiver Intelligence
=========================================================

Maps clinical content in AMINA responses to authoritative WHO / ADA / JNC8 /
GINA / Gambia MOH guideline sources.

Zero LLM calls — keyword-based lookup against a curated citation table.

Returns the top relevant citations to append to each AMINA response,
giving caregivers direct links to the source evidence.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import List, Dict, Optional


# ─────────────────────────────────────────────────────────────────────────────
# Dataclass
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class Citation:
    id:           str    # unique key
    title:        str    # short display title
    source:       str    # organisation: "WHO" | "ADA" | "JNC8" | "GINA" | "MOH Gambia" | ...
    year:         str
    url:          str    # canonical public URL
    section:      str    # specific section/page if applicable
    relevance:    int    # 0-10 (higher = more specific/actionable)


# ─────────────────────────────────────────────────────────────────────────────
# Citation table
# ─────────────────────────────────────────────────────────────────────────────

_CITATIONS: List[Dict] = [

    # ── Diabetes ──────────────────────────────────────────────────────────────
    {
        "id": "ada_2024_standards",
        "title": "Standards of Care in Diabetes 2024",
        "source": "ADA",
        "year": "2024",
        "url": "https://diabetesjournals.org/care/issue/47/Supplement_1",
        "section": "Comprehensive Medical Evaluation and Assessment of Comorbidities",
        "relevance": 9,
        "keywords": ["diabetes", "diabetic", "hba1c", "glycated", "insulin", "metformin",
                     "glucose", "blood sugar", "t2dm", "type 2", "type 1", "glibenclamide",
                     "glycaemic", "glycemic control", "hypoglycaemia", "hyperglycaemia"],
    },
    {
        "id": "who_diabetes_management",
        "title": "Classification and Diagnosis of Diabetes Mellitus",
        "source": "WHO",
        "year": "2019",
        "url": "https://www.who.int/publications/i/item/classification-of-diabetes-mellitus",
        "section": "Diagnostic Criteria and Classification",
        "relevance": 8,
        "keywords": ["diabetes diagnosis", "fasting glucose", "ogtt", "diabetes mellitus",
                     "diabetic criteria"],
    },
    {
        "id": "who_pen_diabetes",
        "title": "WHO PEN — Diabetes Protocol",
        "source": "WHO",
        "year": "2020",
        "url": "https://www.who.int/publications/i/item/who-package-of-essential-ncd-interventions",
        "section": "Diabetes Management Protocol (PEN 1)",
        "relevance": 10,
        "keywords": ["diabetes", "metformin", "glibenclamide", "insulin", "glucose monitoring",
                     "diabetic foot", "ncd protocol"],
    },

    # ── Hypertension ──────────────────────────────────────────────────────────
    {
        "id": "who_pen_hypertension",
        "title": "WHO PEN — Hypertension Protocol",
        "source": "WHO",
        "year": "2020",
        "url": "https://www.who.int/publications/i/item/who-package-of-essential-ncd-interventions",
        "section": "Hypertension Management Protocol (PEN 2)",
        "relevance": 10,
        "keywords": ["hypertension", "blood pressure", "bp", "antihypertensive", "amlodipine",
                     "lisinopril", "enalapril", "captopril", "losartan", "hydrochlorothiazide",
                     "atenolol", "systolic", "diastolic", "mmhg"],
    },
    {
        "id": "who_hypertension_2023",
        "title": "Global Report on Hypertension",
        "source": "WHO",
        "year": "2023",
        "url": "https://www.who.int/publications/i/item/9789240081062",
        "section": "Management of Hypertension in Low-Resource Settings",
        "relevance": 8,
        "keywords": ["hypertension control", "blood pressure target", "stage 1", "stage 2",
                     "resistant hypertension", "cardiovascular risk"],
    },
    {
        "id": "jnc8",
        "title": "2014 Evidence-Based Guideline for the Management of High Blood Pressure (JNC 8)",
        "source": "JNC8",
        "year": "2014",
        "url": "https://jamanetwork.com/journals/jama/fullarticle/1791497",
        "section": "BP Targets by Age and Comorbidity",
        "relevance": 9,
        "keywords": ["blood pressure target", "130/80", "140/90", "hypertension guideline",
                     "antihypertensive target", "ckd hypertension", "diabetic hypertension"],
    },

    # ── Cardiovascular / Lipids ────────────────────────────────────────────────
    {
        "id": "who_cvd_prevention",
        "title": "Prevention of Cardiovascular Disease",
        "source": "WHO",
        "year": "2007",
        "url": "https://www.who.int/publications/i/item/9789241547239",
        "section": "Risk Stratification and Management in Low-Resource Settings",
        "relevance": 7,
        "keywords": ["cardiovascular", "heart disease", "cholesterol", "lipid", "statin",
                     "atorvastatin", "simvastatin", "ldl", "hdl", "triglyceride",
                     "coronary", "myocardial", "stroke"],
    },
    {
        "id": "who_pen_cvd",
        "title": "WHO PEN — Cardiovascular Disease Protocol",
        "source": "WHO",
        "year": "2020",
        "url": "https://www.who.int/publications/i/item/who-package-of-essential-ncd-interventions",
        "section": "Cardiovascular Disease Protocol (PEN 3)",
        "relevance": 9,
        "keywords": ["heart failure", "atrial fibrillation", "digoxin", "amiodarone",
                     "aspirin", "warfarin", "anticoagulant", "cardiac"],
    },

    # ── Asthma / COPD ──────────────────────────────────────────────────────────
    {
        "id": "gina_2023",
        "title": "Global Strategy for Asthma Management and Prevention (GINA 2023)",
        "source": "GINA",
        "year": "2023",
        "url": "https://ginasthma.org/2023-gina-report-global-strategy-for-asthma-management-and-prevention/",
        "section": "Asthma Management and Control Assessment",
        "relevance": 10,
        "keywords": ["asthma", "wheeze", "wheezing", "breathlessness", "inhaler", "salbutamol",
                     "beclomethasone", "corticosteroid inhaler", "spacer", "peak flow",
                     "pefr", "bronchodilator", "reliever", "preventer"],
    },
    {
        "id": "who_pen_asthma",
        "title": "WHO PEN — Asthma Protocol",
        "source": "WHO",
        "year": "2020",
        "url": "https://www.who.int/publications/i/item/who-package-of-essential-ncd-interventions",
        "section": "Asthma Protocol (PEN 4)",
        "relevance": 9,
        "keywords": ["asthma control", "inhaler technique", "asthma action plan",
                     "asthma exacerbation", "salbutamol nebulizer"],
    },

    # ── Medication adherence ───────────────────────────────────────────────────
    {
        "id": "who_adherence_2003",
        "title": "Adherence to Long-Term Therapies: Evidence for Action",
        "source": "WHO",
        "year": "2003",
        "url": "https://www.who.int/publications/i/item/9241545992",
        "section": "Disease-Specific Reviews: Diabetes, Hypertension, Asthma",
        "relevance": 9,
        "keywords": ["medication adherence", "non-adherence", "non-compliant", "compliance",
                     "missed dose", "pill", "prescription", "medication reminder",
                     "adherence barrier", "medication schedule"],
    },

    # ── Nutrition / Lifestyle ──────────────────────────────────────────────────
    {
        "id": "who_healthy_diet",
        "title": "Healthy Diet — WHO Fact Sheet",
        "source": "WHO",
        "year": "2020",
        "url": "https://www.who.int/news-room/fact-sheets/detail/healthy-diet",
        "section": "Recommended Nutrient Intake for NCDs",
        "relevance": 8,
        "keywords": ["diet", "nutrition", "food", "sodium", "salt", "sugar", "fibre",
                     "whole grain", "fruit", "vegetable", "healthy eating", "meal",
                     "portion", "calorie", "fat intake", "omega-3"],
    },
    {
        "id": "who_physical_activity",
        "title": "WHO Guidelines on Physical Activity and Sedentary Behaviour",
        "source": "WHO",
        "year": "2020",
        "url": "https://www.who.int/publications/i/item/9789240015128",
        "section": "Recommendations for Adults with Chronic Conditions",
        "relevance": 7,
        "keywords": ["exercise", "physical activity", "walking", "sedentary", "activity level",
                     "weight loss", "bmi", "obesity", "overweight"],
    },

    # ── Mental health / PHQ-2 / Depression ────────────────────────────────────
    {
        "id": "who_mental_health_gap",
        "title": "mhGAP Intervention Guide for Mental, Neurological and Substance Use Disorders",
        "source": "WHO",
        "year": "2016",
        "url": "https://www.who.int/publications/i/item/9789241549790",
        "section": "Depression — Low-Resource Settings",
        "relevance": 9,
        "keywords": ["depression", "mental health", "mood", "anxiety", "phq", "hopeless",
                     "sad", "withdrawn", "suicidal", "sleep disturbance", "insomnia",
                     "mood disorder", "psychosocial"],
    },

    # ── Drug-drug interactions ─────────────────────────────────────────────────
    {
        "id": "who_model_formulary",
        "title": "WHO Model Formulary 2008",
        "source": "WHO",
        "year": "2008",
        "url": "https://www.who.int/publications/i/item/9789241547659",
        "section": "Drug Interactions — Section 28",
        "relevance": 8,
        "keywords": ["drug interaction", "drug-drug", "ddi", "contraindicated combination",
                     "medication interaction", "pharmacokinetic", "cyp450", "warfarin interaction",
                     "nsaid interaction", "statin interaction"],
    },

    # ── Kidney / CKD ──────────────────────────────────────────────────────────
    {
        "id": "kdigo_ckd_2022",
        "title": "KDIGO 2022 Clinical Practice Guideline for Diabetes Management in CKD",
        "source": "KDIGO",
        "year": "2022",
        "url": "https://kdigo.org/guidelines/diabetes-ckd/",
        "section": "Glycaemic Monitoring and Control in CKD",
        "relevance": 9,
        "keywords": ["kidney", "ckd", "renal", "egfr", "creatinine", "nephropathy",
                     "albumin", "proteinuria", "microalbuminuria", "dialysis"],
    },

    # ── Infection / Malaria / TB ────────────────────────────────────────────────
    {
        "id": "who_malaria_2023",
        "title": "WHO Guidelines for Malaria",
        "source": "WHO",
        "year": "2023",
        "url": "https://www.who.int/publications/i/item/9789240086173",
        "section": "Diagnosis and Treatment in Sub-Saharan Africa",
        "relevance": 9,
        "keywords": ["malaria", "fever", "plasmodium", "artemether", "quinine",
                     "rdt", "antimalarial", "malaria treatment", "falciparum"],
    },
    {
        "id": "who_tb_2023",
        "title": "WHO Consolidated Guidelines on Tuberculosis — Treatment",
        "source": "WHO",
        "year": "2022",
        "url": "https://www.who.int/publications/i/item/9789240048126",
        "section": "Drug-Susceptible TB Treatment",
        "relevance": 9,
        "keywords": ["tuberculosis", "tb", "rifampicin", "isoniazid", "ethambutol",
                     "pyrazinamide", "dots", "contact tracing", "tb treatment"],
    },

    # ── NEWS2 / Clinical deterioration ────────────────────────────────────────
    {
        "id": "rcp_news2",
        "title": "National Early Warning Score 2 (NEWS2)",
        "source": "Royal College of Physicians",
        "year": "2017",
        "url": "https://www.rcplondon.ac.uk/projects/outputs/national-early-warning-score-news-2",
        "section": "NEWS2 Scoring and Response Thresholds",
        "relevance": 8,
        "keywords": ["news2", "early warning", "deterioration", "clinical deterioration",
                     "respiratory rate", "oxygen saturation", "consciousness", "vital signs"],
    },

    # ── Maternal / child health ────────────────────────────────────────────────
    {
        "id": "who_anc_2016",
        "title": "WHO Recommendations on Antenatal Care for a Positive Pregnancy Experience",
        "source": "WHO",
        "year": "2016",
        "url": "https://www.who.int/publications/i/item/9789241549912",
        "section": "Nutrition Interventions",
        "relevance": 7,
        "keywords": ["pregnancy", "antenatal", "prenatal", "maternal", "gestational diabetes",
                     "folic acid", "iron", "preeclampsia"],
    },

    # ── Gambia MOH / ECOWAS ────────────────────────────────────────────────────
    {
        "id": "gambia_ncd_strategy",
        "title": "Gambia National NCD Strategy 2022-2026",
        "source": "MOH Gambia",
        "year": "2022",
        "url": "https://www.moh.gov.gm/",
        "section": "Community NCD Management and CHW Roles",
        "relevance": 10,
        "keywords": ["gambia", "gambian", "community health worker", "chw", "health post",
                     "chc", "health facility", "ncd gambia", "gambia health"],
    },
]

# ─────────────────────────────────────────────────────────────────────────────
# Source badge colours
# ─────────────────────────────────────────────────────────────────────────────

SOURCE_COLORS: Dict[str, str] = {
    "WHO":                    "#0078d4",
    "ADA":                    "#e63946",
    "JNC8":                   "#2a9d8f",
    "GINA":                   "#6a4c93",
    "KDIGO":                  "#457b9d",
    "Royal College of Physicians": "#c77dff",
    "MOH Gambia":             "#e76f51",
}


# ─────────────────────────────────────────────────────────────────────────────
# Main function
# ─────────────────────────────────────────────────────────────────────────────

def find_citations(response_text: str, max_citations: int = 3) -> List[Citation]:
    """
    Scan response text for clinical keyword matches.
    Returns top-N citations ordered by relevance score.
    """
    if not response_text:
        return []

    text_lower = response_text.lower()
    scored: List[tuple[int, Dict]] = []

    for entry in _CITATIONS:
        kw_hits = sum(1 for kw in entry["keywords"] if kw in text_lower)
        if kw_hits == 0:
            continue
        score = kw_hits * entry["relevance"]
        scored.append((score, entry))

    # Sort descending by score, deduplicate by source
    scored.sort(key=lambda x: -x[0])

    seen_sources: set = set()
    results: List[Citation] = []

    for score, entry in scored:
        # Allow at most 2 citations per source to keep variety
        src_count = sum(1 for r in results if r.source == entry["source"])
        if src_count >= 2:
            continue
        results.append(Citation(
            id        = entry["id"],
            title     = entry["title"],
            source    = entry["source"],
            year      = entry["year"],
            url       = entry["url"],
            section   = entry["section"],
            relevance = entry["relevance"],
        ))
        if len(results) >= max_citations:
            break

    return results


def citations_to_dict(citations: List[Citation]) -> List[Dict]:
    """Serialise Citation list to JSON-safe dicts."""
    return [
        {
            "id":      c.id,
            "title":   c.title,
            "source":  c.source,
            "year":    c.year,
            "url":     c.url,
            "section": c.section,
            "color":   SOURCE_COLORS.get(c.source, "#64748b"),
        }
        for c in citations
    ]
