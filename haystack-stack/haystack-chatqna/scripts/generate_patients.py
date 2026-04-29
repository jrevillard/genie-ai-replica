"""
Gambian NCD Patient Data Generator

Generates 1,000 synthetic patients with realistic Gambian demographics
and NCD profiles (diabetes, hypertension, heart disease, COPD, asthma).
Outputs JSON compatible with ArcadeDB ingestion.

Based on WHO PEN protocols and Gambian health statistics:
- Population: ~2.4M, 48.6% below poverty line
- Life expectancy: ~62 years
- NCD prevalence: Hypertension ~30%, Diabetes ~5-7%, CVD ~15%
- 95% Muslim, Mandinka/Wolof/Fula ethnic groups
- Regions: Banjul, Kanifing, West Coast, North Bank, Lower River, Central River, Upper River
"""

import json
import random
import uuid
import hashlib
from datetime import datetime, timedelta
from pathlib import Path

# ─── Gambian Demographics ───

MALE_NAMES = [
    "Ousman", "Lamin", "Modou", "Ebrima", "Bakary", "Saikou", "Abdoulie",
    "Mamadou", "Alieu", "Buba", "Yusupha", "Momodou", "Baboucarr", "Musa",
    "Omar", "Seedy", "Alhagie", "Dawda", "Kebba", "Sarjo", "Alagie",
    "Ismaila", "Amadou", "Pa", "Dembo", "Kalifa", "Landing", "Yorro",
    "Sulayman", "Malick", "Karamo", "Tamsir", "Ansumana", "Sainey", "Sanna",
]

FEMALE_NAMES = [
    "Fatou", "Aminata", "Isatou", "Mariama", "Binta", "Kaddy", "Awa",
    "Saffie", "Nyima", "Haddy", "Jainaba", "Ndey", "Oumie", "Rohey",
    "Dado", "Kumba", "Sira", "Fatoumatta", "Adama", "Haddijatou",
    "Ida", "Sohna", "Aja", "Sainabou", "Neneh", "Fanta", "Bintou",
    "Ramou", "Sally", "Maimuna", "Amie", "Ndeye", "Nfamara", "Mahtarr",
]

SURNAMES = [
    "Jallow", "Ceesay", "Touray", "Njie", "Camara", "Bojang", "Sanneh",
    "Jammeh", "Drammeh", "Saidy", "Bah", "Manneh", "Colley", "Jobe",
    "Fatty", "Sonko", "Kanteh", "Dibba", "Fofana", "Darboe", "Sowe",
    "Baldeh", "Gaye", "Jawara", "Keita", "Sanyang", "Hydara", "Mendy",
    "Sarr", "Conteh", "Susso", "Tunkara", "Badjie", "Nyang", "Dem",
]

REGIONS = {
    "Kanifing": 0.30,     # Most urban, highest population
    "West Coast": 0.22,
    "Banjul": 0.08,
    "North Bank": 0.12,
    "Lower River": 0.10,
    "Central River": 0.10,
    "Upper River": 0.08,
}

PHONE_PREFIXES = ["+220-7", "+220-3", "+220-9", "+220-2"]

# ─── NCD Profiles ───

CONDITIONS = {
    "hypertension": {"prevalence": 0.30, "age_min": 30},
    "diabetes": {"prevalence": 0.07, "age_min": 25},
    "heart_disease": {"prevalence": 0.05, "age_min": 40},
    "kidney_disease": {"prevalence": 0.03, "age_min": 35},
    "respiratory": {"prevalence": 0.04, "age_min": 20},
}

MEDICATIONS_BY_CONDITION = {
    "hypertension": [
        {"name": "Amlodipine", "dosage": "5mg", "frequency": "Once daily"},
        {"name": "Lisinopril", "dosage": "10mg", "frequency": "Once daily"},
        {"name": "Hydrochlorothiazide", "dosage": "25mg", "frequency": "Once daily morning"},
    ],
    "diabetes": [
        {"name": "Metformin", "dosage": "500mg", "frequency": "Twice daily"},
        {"name": "Metformin", "dosage": "1000mg", "frequency": "Twice daily"},
        {"name": "Glibenclamide", "dosage": "5mg", "frequency": "Once daily before meals"},
    ],
    "heart_disease": [
        {"name": "Aspirin", "dosage": "75mg", "frequency": "Once daily"},
        {"name": "Atorvastatin", "dosage": "20mg", "frequency": "Once daily evening"},
        {"name": "Amlodipine", "dosage": "10mg", "frequency": "Once daily"},
    ],
    "kidney_disease": [
        {"name": "Lisinopril", "dosage": "5mg", "frequency": "Once daily"},
    ],
    "respiratory": [
        {"name": "Salbutamol inhaler", "dosage": "100mcg", "frequency": "As needed, up to 4x daily"},
    ],
}


def weighted_choice(choices: dict) -> str:
    items = list(choices.keys())
    weights = list(choices.values())
    return random.choices(items, weights=weights, k=1)[0]


def gen_phone() -> str:
    prefix = random.choice(PHONE_PREFIXES)
    return f"{prefix}{random.randint(100000, 999999)}"


def gen_bp(has_hypertension: bool, on_treatment: bool) -> str:
    if has_hypertension:
        if on_treatment:
            sbp = random.randint(125, 155)
            dbp = random.randint(78, 95)
        else:
            sbp = random.randint(140, 185)
            dbp = random.randint(88, 115)
    else:
        sbp = random.randint(100, 135)
        dbp = random.randint(60, 85)
    return f"{sbp}/{dbp}"


def gen_glucose(has_diabetes: bool, on_treatment: bool) -> str:
    if has_diabetes:
        if on_treatment:
            return str(random.randint(90, 200))
        else:
            return str(random.randint(140, 350))
    else:
        return str(random.randint(70, 110))


def gen_patient(idx: int) -> dict:
    gender = random.choice(["male", "female"])
    if gender == "male":
        first = random.choice(MALE_NAMES)
    else:
        first = random.choice(FEMALE_NAMES)
    last = random.choice(SURNAMES)

    # Age distribution: skewed younger (Gambian demographics)
    age = int(random.triangular(18, 80, 42))

    region = weighted_choice(REGIONS)
    phone = gen_phone()
    patient_id = f"P{hashlib.md5(phone.encode()).hexdigest()[:8].upper()}"

    # Assign conditions based on prevalence and age
    conditions = []
    for cond, info in CONDITIONS.items():
        if age >= info["age_min"] and random.random() < info["prevalence"]:
            conditions.append(cond)

    # Comorbidity boost: diabetes + hypertension often co-occur
    if "diabetes" in conditions and "hypertension" not in conditions:
        if random.random() < 0.5:
            conditions.append("hypertension")
    if "heart_disease" in conditions and "hypertension" not in conditions:
        if random.random() < 0.6:
            conditions.append("hypertension")

    # Medications
    medications = []
    for cond in conditions:
        if cond in MEDICATIONS_BY_CONDITION:
            med = random.choice(MEDICATIONS_BY_CONDITION[cond])
            if med not in medications:
                medications.append(med)

    on_treatment = len(medications) > 0

    # Vitals
    has_htn = "hypertension" in conditions
    has_dm = "diabetes" in conditions
    last_bp = gen_bp(has_htn, on_treatment)
    last_glucose = gen_glucose(has_dm, on_treatment) if has_dm or random.random() < 0.3 else None

    # Allergies
    allergies = []
    if random.random() < 0.08:
        allergies.append(random.choice(["Penicillin", "Sulfa drugs", "Aspirin", "Ibuprofen"]))

    # Smoking
    is_smoker = random.random() < 0.12  # ~12% smoking rate in Gambia

    # BMI indicators
    bmi = round(random.triangular(18, 38, 25), 1)

    # Emergency contact
    emergency_name = f"{random.choice(MALE_NAMES if random.random() > 0.5 else FEMALE_NAMES)} {last}"
    emergency_phone = gen_phone()

    # Consultation history
    consultation_count = random.randint(0, 15) if conditions else random.randint(0, 3)
    last_consultation = None
    if consultation_count > 0:
        days_ago = random.randint(1, 180)
        last_consultation = (datetime.now() - timedelta(days=days_ago)).isoformat()

    # Key facts (things Amina would remember)
    key_facts = []
    if is_smoker:
        key_facts.append("Current tobacco user")
    if bmi >= 30:
        key_facts.append(f"Obese (BMI {bmi})")
    elif bmi >= 25:
        key_facts.append(f"Overweight (BMI {bmi})")
    if has_dm and has_htn:
        key_facts.append("Dual NCD: diabetes + hypertension")
    if age >= 60:
        key_facts.append("Elderly patient — consider medication adjustments")
    if random.random() < 0.15:
        key_facts.append(random.choice([
            "Works at market, stands all day",
            "Farmer, physically active",
            "Struggles with diet on weekends",
            "Lives alone, limited family support",
            "Prefers morning appointments",
            "Low literacy — use simple language",
            "Traditional medicine user — bridge to modern care",
            "Cannot afford all medications",
            "Family history of heart disease",
            "Recently bereaved — monitor mental health",
        ]))

    return {
        "id": patient_id,
        "phone": phone,
        "name": f"{first} {last}",
        "age": age,
        "gender": gender,
        "region": region,
        "conditions": conditions,
        "medications": medications,
        "allergies": allergies,
        "is_smoker": is_smoker,
        "bmi": bmi,
        "last_bp": last_bp,
        "last_glucose": last_glucose,
        "emergency_contact": emergency_phone,
        "emergency_contact_name": emergency_name,
        "preferred_language": random.choice(["english", "english", "mandinka", "wolof"]),
        "preferred_facility": None,
        "key_facts": key_facts,
        "consultation_count": consultation_count,
        "last_consultation": last_consultation,
        "bp_readings": [],
        "glucose_readings": [],
        "created_at": (datetime.now() - timedelta(days=random.randint(30, 365))).isoformat(),
        "updated_at": datetime.now().isoformat(),
    }


def main():
    random.seed(42)  # Reproducible
    count = 1000

    patients = [gen_patient(i) for i in range(count)]

    # Stats
    conditions_count = {}
    for p in patients:
        for c in p["conditions"]:
            conditions_count[c] = conditions_count.get(c, 0) + 1

    stats = {
        "total_patients": count,
        "conditions_distribution": conditions_count,
        "avg_age": round(sum(p["age"] for p in patients) / count, 1),
        "gender_split": {
            "male": sum(1 for p in patients if p["gender"] == "male"),
            "female": sum(1 for p in patients if p["gender"] == "female"),
        },
        "with_conditions": sum(1 for p in patients if p["conditions"]),
        "on_medication": sum(1 for p in patients if p["medications"]),
        "smokers": sum(1 for p in patients if p["is_smoker"]),
        "regions": {r: sum(1 for p in patients if p["region"] == r) for r in REGIONS},
    }

    output_dir = Path(__file__).parent.parent / "data"
    output_dir.mkdir(exist_ok=True)

    # Write patients
    with open(output_dir / "synthetic_patients.json", "w") as f:
        json.dump(patients, f, indent=2)

    # Write stats
    with open(output_dir / "patient_stats.json", "w") as f:
        json.dump(stats, f, indent=2)

    print(f"Generated {count} synthetic Gambian NCD patients")
    print(f"Stats: {json.dumps(stats, indent=2)}")
    print(f"Output: {output_dir / 'synthetic_patients.json'}")


if __name__ == "__main__":
    main()
