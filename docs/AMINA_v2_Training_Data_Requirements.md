# AMINA v2.0 — Training Data Requirements Document

**Prepared by:** AMINA Development Team  
**Date:** April 2026  
**Purpose:** Request for clinical training data to improve AMINA's healthcare AI model  
**Current Model:** Mistral 7B fine-tuned on 12K synthetic examples (v2.0-alpha)  
**Target:** Clinical-grade Gambian healthcare AI matching Hippocratic AI standards

---

## Executive Summary

AMINA is an AI-powered Community Health Worker assistant for The Gambia, focused on NCD management (diabetes, hypertension, asthma, chronic kidney disease, cancer screening). The model is trained and serving on GPU infrastructure, but needs **real-world clinical data** to reach production quality.

**Current state:** Trained on synthetic data — the model gives generally correct but sometimes generic responses, occasionally repeats itself, and lacks the nuanced clinical reasoning that comes from real patient interactions.

**What we need:** 5 categories of real-world data to transform AMINA from a prototype into a clinically validated tool.

---

## Data Category 1: Patient-CHW Conversation Transcripts

**What:** Real conversations between Community Health Workers and patients at Gambian health facilities.

**Why:** The model needs to learn how Gambian patients actually describe their symptoms, how CHWs actually respond, and the natural flow of a health consultation in The Gambian context.

**Format needed:**
```
{
  "patient": "My sugar has been high since Ramadan ended",
  "chw": "How high? When did you last check?",
  "patient": "It was 200 at the health post yesterday",
  "chw": "That is above our target of 130. Are you still taking your metformin?",
  ...
}
```

**Volume needed:** 1,000-5,000 conversations minimum  
**Priority conditions:**
- Diabetes management (highest priority — most common NCD queries)
- Hypertension management
- Combined diabetes + hypertension (very common in Gambia)
- Asthma/COPD (especially women exposed to cooking smoke)
- Pregnancy with NCD complications

**Anonymization required:** Remove all patient names, phone numbers, addresses, and facility-specific identifiers. Keep age range, gender, region, and condition.

**Languages:** English, Mandinka, Wolof (if available)

---

## Data Category 2: Clinical Decision Examples

**What:** Expert-validated question-answer pairs showing the *correct* clinical response to patient scenarios, based on WHO PEN protocols adapted for The Gambia.

**Why:** The model needs to know the RIGHT answer, not just a plausible answer. These serve as the "gold standard" for training.

**Format needed:**
```
{
  "scenario": "45-year-old female, diabetic, fasting sugar 210 mg/dL, on metformin 500mg twice daily",
  "correct_response": "Sugar at 210 is above target (70-130). Since already on metformin, assess diet compliance first — ask about rice portions, oil usage, sugar in attaya. If diet is already modified, needs doctor review for dose increase or adding gliclazide. Do NOT increase dose yourself.",
  "incorrect_response": "Take more metformin to bring your sugar down.",
  "why_incorrect": "CHWs cannot adjust medication doses — only a doctor can do this.",
  "who_pen_reference": "Protocol 1, Step 2-3"
}
```

**Volume needed:** 500-1,000 validated scenarios  
**Required scenarios by topic:**

| Topic | # Needed | Examples |
|-------|----------|----------|
| Diabetes diagnosis & targets | 50 | Fasting glucose interpretation, HbA1c targets |
| Diabetes diet (Gambian-specific) | 100 | Benachin modifications, chere vs white rice, Maggi cube salt content |
| Diabetes medication adherence | 50 | Missed doses, Ramadan adjustments, side effects |
| Diabetes emergencies | 50 | Hypoglycemia (<70), DKA (>300 + symptoms), foot ulcers |
| Hypertension diagnosis & targets | 50 | BP classification, when to refer, pregnancy HTN |
| Hypertension lifestyle | 100 | Salt reduction (Maggi cube quantification), bissap, exercise |
| Hypertension medication | 50 | Amlodipine vs ACEI selection for African populations, adherence |
| CVD risk assessment | 30 | WHO/ISH chart interpretation, stroke FAST, heart attack |
| Asthma/COPD | 50 | Inhaler technique, trigger avoidance, cooking smoke exposure |
| Cancer screening | 30 | Cervical (VIA), breast (CBE), red flags for referral |
| Kidney disease | 30 | CKD staging, when to refer, medication adjustments |
| Ramadan + NCD | 50 | Fasting risk categories, medication timing, when to break fast |
| Mental health + NCD | 50 | Depression screening, adherence in depressed patients |
| Pregnancy + NCD | 30 | Gestational diabetes, pre-eclampsia, medication safety |
| Emergency triage | 80 | Call 199 scenarios, first aid, referral urgency levels |
| Medication safety | 100 | What CHWs can/cannot do, drug interactions, herbal interactions |

**Validator requirements:** Each scenario should be reviewed by at least 1 licensed clinician familiar with Gambian health system and WHO PEN protocols.

---

## Data Category 3: Gambian Food & Nutrition Database

**What:** Nutritional profiles of common Gambian foods with health impact annotations.

**Why:** The model recommends "eat more vegetables" generically. It needs to know EXACTLY which Gambian foods affect blood sugar, blood pressure, and cholesterol — and how to modify common recipes.

**Format needed:**
```
{
  "food": "Benachin (Jollof Rice)",
  "ingredients": ["rice", "palm oil", "fish", "tomato", "Maggi cube", "vegetables"],
  "salt_content_per_serving": "2.5g (mainly from Maggi cube)",
  "glycemic_impact": "high (white rice base)",
  "modification_for_diabetes": "Swap half rice with vegetables, reduce oil by half",
  "modification_for_hypertension": "Use half Maggi cube, rinse dried fish before adding",
  "cost_dalasi": "25-50 per serving",
  "cultural_notes": "National dish, eaten daily, served from shared bowl"
}
```

**Foods needed (minimum 50):**

| Category | Foods |
|----------|-------|
| Rice dishes | Benachin, ceebu yapp, fried rice |
| Stews | Domoda, supakanja, mbahal, plasas |
| Porridges | Chere (millet), mono, lacciri |
| Proteins | Fresh fish (bonga, sole), dried fish (yeet, guedj), chicken, groundnuts, nyebbeh (beans) |
| Vegetables | Moringa, okra, bitter leaf, cassava leaf, sweet potato leaf, jaxatu |
| Fruits | Mango, papaya, banana, orange, watermelon, baobab (bouye) |
| Drinks | Attaya (green tea), bissap (hibiscus), wonjo, bouye juice, ginger water |
| Seasonings | Maggi cube, salt, netetu (locust bean), Jumbo cube |
| Street food | Accara (fried bean cake), fataya, kosam |
| Snacks | Groundnuts, cashews, dried fruit |

---

## Data Category 4: Mandinka Health Language Corpus

**What:** Mandinka health phrases, medical terms, and patient expressions as actually spoken in Gambian health facilities.

**Why:** Current Mandinka support uses limited dictionary translation. Real Mandinka health conversations have idioms, dialectal variations, and cultural expressions that no dictionary captures.

**Format needed:**
```
{
  "mandinka": "N la sugar kuuraŋo jiitata, n hakili ñaata",
  "english": "My diabetes is getting worse, I am worried",
  "context": "Patient expressing concern about diabetes progression",
  "region": "Kanifing",
  "formality": "informal",
  "health_terms": ["sugar kuuraŋo = diabetes", "jiitata = gotten worse/high", "hakili ñaata = worried"]
}
```

**Volume needed:**
- 500+ health-related phrase pairs (EN↔Mandinka)
- 100+ symptom descriptions in Mandinka
- 50+ common patient questions in Mandinka
- Cultural health expressions and idioms
- Regional variations (Kanifing vs rural Mandinka)

**Optional but valuable:**
- Wolof health phrases (second most common language)
- Fula health phrases (third most common)
- Audio recordings for future voice model training

---

## Data Category 5: Outcome & Effectiveness Data

**What:** Records showing what health advice was given, what the patient did, and what happened to their health metrics over time.

**Why:** AMINA needs to learn which advice actually *works* — not just which advice sounds good. This is the difference between a chatbot and a clinically effective tool.

**Format needed:**
```
{
  "patient_id": "anonymized_001",
  "condition": "hypertension",
  "advice_given": "Reduce to half Maggi cube per pot",
  "date_advised": "2025-01-15",
  "patient_action": "Reduced Maggi cube as advised",
  "bp_before": "160/100",
  "bp_after_30_days": "145/90",
  "bp_after_90_days": "135/85",
  "outcome": "improved",
  "notes": "Patient also started walking to market 3x/week"
}
```

**Volume needed:** 200-500 outcome records across conditions  
**Priority metrics:**
- Blood pressure changes after lifestyle advice
- Blood glucose changes after diet modification
- Medication adherence rates by intervention type
- Referral follow-through rates
- Emergency detection accuracy (did we catch emergencies correctly?)

---

## Data Sources We Recommend

| Source | Data Type | Contact |
|--------|-----------|---------|
| **MRC Gambia at Fajara** | Clinical research data, patient cohorts, CHW training materials | Research department |
| **Gambian MoH NCD Programme** | National NCD guidelines, facility data, DHIS2 indicators | NCD focal point |
| **WHO Gambia Country Office** | WHO PEN implementation data, training materials | NCD officer |
| **EFSTH** | Clinical case data, emergency presentations, referral outcomes | Medical records dept |
| **Kerewan Health Centre** | CHW interaction records, community screening data | CHW coordinator |
| **ITC/MRC Nutrition Programme** | Gambian food composition data, dietary surveys | Nutrition team |
| **University of The Gambia** | Health research, Mandinka linguistic resources | Linguistics dept |

---

## Data Protection & Ethics

All data must comply with:
- **Gambian Data Protection Act** — patient consent required
- **WHO ethical guidelines for AI in health** — transparency, fairness, privacy
- **De-identification standard** — remove all direct identifiers (name, phone, address, DOB)
- **Approved by** — relevant ethics review board (MRC Ethics Committee recommended)

**What we guarantee:**
- Data used ONLY for training AMINA healthcare AI
- No individual patient data is stored in the model (training data is processed, not memorized)
- Model outputs are always reviewed by safety supervisor AI before reaching patients
- All training data is stored encrypted and access-controlled

---

## Expected Impact

With this data, AMINA v2 can achieve:

| Metric | Current (synthetic data) | Expected (real data) |
|--------|------------------------|---------------------|
| Clinical accuracy | ~75% (estimated) | >95% |
| Cultural appropriateness | Good (template-based) | Excellent (learned from real conversations) |
| Emergency detection | 80% | >99% |
| Patient satisfaction | Unknown | Measurable via outcome data |
| Mandinka support | Basic dictionary | Native understanding |

**Comparison:** Hippocratic AI achieved 99.38% clinical accuracy using 1.8M real patient calls. With 5,000 Gambian-specific conversations + 1,000 validated clinical scenarios, AMINA can reach comparable quality for its NCD-focused domain.

---

## Timeline

| Phase | Data Needed | Training Time | Impact |
|-------|------------|---------------|--------|
| **Phase 1 (immediate)** | 500 clinical decision examples | 1 day | Fix accuracy issues |
| **Phase 2 (1-2 months)** | 1,000 CHW conversations + food database | 1 week | Gambian-specific quality |
| **Phase 3 (3-6 months)** | Full Mandinka corpus + outcome data | 2 weeks | Production-ready |

---

## Contact

For data partnership inquiries or to contribute data:
- **Project:** AMINA — AI-Powered Community Health Worker for The Gambia
- **Infrastructure:** Fine-tuned model on NVIDIA A40 GPU, 721 WHO PEN knowledge chunks, 7-layer self-learning system
- **Partners:** ITU, Amina Care

---

*This document is version 1.0. Updated April 2026.*
