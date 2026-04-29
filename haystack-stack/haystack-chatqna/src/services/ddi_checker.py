"""
Drug-Drug Interaction Checker — AMINA Caregiver Intelligence
=============================================================

Checks a patient's medication list against a curated DDI table built from
the Gambian National Drug Formulary and WHO Model Formulary for NCD drugs
commonly used in community health settings in The Gambia.

Zero LLM calls — pure lookup table.

Severity levels:
  "contraindicated" — never co-prescribe; immediate escalation required
  "major"           — significant risk; clinical review needed
  "moderate"        — monitor closely; consider alternative
  "minor"           — low risk; document and inform

Coverage:
  ~25 high-priority drug pairs for hypertension, diabetes, cardiac,
  respiratory, anti-infective, and psychiatric medications.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Set


# ─────────────────────────────────────────────────────────────────────────────
# Dataclass
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class DDIAlert:
    drug_a:      str
    drug_b:      str
    severity:    str   # "contraindicated"|"major"|"moderate"|"minor"
    mechanism:   str
    effect:      str
    management:  str
    gambia_note: str = ""  # Gambia-specific context (availability, alternatives)


@dataclass
class DDIReport:
    patient_id:          str
    medications_checked: List[str]
    alerts:              List[DDIAlert] = field(default_factory=list)
    contraindicated_count: int = 0
    major_count:         int = 0
    summary:             str = ""


# ─────────────────────────────────────────────────────────────────────────────
# Drug name normalisation
# ─────────────────────────────────────────────────────────────────────────────

# Generic name aliases (brand → generic, common abbreviations)
_ALIASES: Dict[str, str] = {
    # Diabetes
    "glucophage": "metformin",
    "glucophage xr": "metformin",
    "amaryl": "glimepiride",
    "glibenclamide": "glibenclamide",  # Gambia formulary name
    "glyburide": "glibenclamide",
    "daonil": "glibenclamide",
    "humulin": "insulin",
    "mixtard": "insulin",
    "actrapid": "insulin",
    "lantus": "insulin glargine",
    "novomix": "insulin",
    # Hypertension
    "zestril": "lisinopril",
    "capoten": "captopril",
    "vasotec": "enalapril",
    "cozaar": "losartan",
    "amlor": "amlodipine",
    "norvasc": "amlodipine",
    "adalat": "nifedipine",
    "tenormin": "atenolol",
    "inderal": "propranolol",
    "lasix": "furosemide",
    "aldactone": "spironolactone",
    "hctz": "hydrochlorothiazide",
    # Cardiac
    "lanoxin": "digoxin",
    "cordarone": "amiodarone",
    "coumadin": "warfarin",
    "aspirin": "aspirin",
    "ecosprin": "aspirin",
    "atorva": "atorvastatin",
    "lipitor": "atorvastatin",
    "zocor": "simvastatin",
    # Anti-infective
    "augmentin": "amoxicillin-clavulanate",
    "zithromax": "azithromycin",
    "klacid": "clarithromycin",
    "cipro": "ciprofloxacin",
    "cotrimoxazole": "trimethoprim-sulfamethoxazole",
    "septrin": "trimethoprim-sulfamethoxazole",
    "bactrim": "trimethoprim-sulfamethoxazole",
    "rifampin": "rifampicin",
    "isoniazid": "isoniazid",
    "fluconazole": "fluconazole",
    "diflucan": "fluconazole",
    # NSAID
    "ibuprofen": "nsaid",
    "diclofenac": "nsaid",
    "voltaren": "nsaid",
    "naproxen": "nsaid",
    "indomethacin": "nsaid",
    "piroxicam": "nsaid",
    "feldene": "nsaid",
    # Psychiatric
    "haloperidol": "haloperidol",
    "chlorpromazine": "chlorpromazine",
    "amitriptyline": "amitriptyline",
    # Other
    "oral contraceptive": "oral contraceptive",
    "oc pill": "oral contraceptive",
    "combined pill": "oral contraceptive",
    "quinine": "quinine",
    "artemether": "artemether",
    "chloroquine": "chloroquine",
}

# Drug class groupings — used for class-level rules
_CLASS_MAP: Dict[str, str] = {
    "lisinopril":   "ace_inhibitor",
    "captopril":    "ace_inhibitor",
    "enalapril":    "ace_inhibitor",
    "losartan":     "arb",
    "valsartan":    "arb",
    "irbesartan":   "arb",
    "spironolactone": "k_sparing_diuretic",
    "amiloride":    "k_sparing_diuretic",
    "amlodipine":   "ccb_dihydropyridine",
    "nifedipine":   "ccb_dihydropyridine",
    "atenolol":     "beta_blocker",
    "propranolol":  "beta_blocker",
    "metoprolol":   "beta_blocker",
    "bisoprolol":   "beta_blocker",
    "hydrochlorothiazide": "thiazide",
    "chlortalidone": "thiazide",
    "metformin":    "biguanide",
    "glibenclamide":"sulfonylurea",
    "glimepiride":  "sulfonylurea",
    "gliclazide":   "sulfonylurea",
    "warfarin":     "anticoagulant",
    "nsaid":        "nsaid",
    "clarithromycin": "macrolide",
    "azithromycin": "macrolide",
    "erythromycin": "macrolide",
    "ciprofloxacin": "fluoroquinolone",
    "trimethoprim-sulfamethoxazole": "sulfonamide",
    "fluconazole":  "azole_antifungal",
    "simvastatin":  "statin",
    "atorvastatin": "statin",
    "digoxin":      "cardiac_glycoside",
    "amiodarone":   "antiarrhythmic",
    "quinine":      "antimalarial",
    "chloroquine":  "antimalarial",
    "haloperidol":  "typical_antipsychotic",
    "chlorpromazine": "typical_antipsychotic",
    "amitriptyline": "tca",
}


def _normalise(drug_name: str) -> str:
    """Normalise a drug name to a canonical generic/class key."""
    raw = drug_name.strip().lower()
    # Remove dose information: "metformin 500mg" → "metformin"
    raw = re.sub(r"\s*\d+\s*(mg|mcg|g|ml|iu|units?)\b.*", "", raw).strip()
    # Apply alias map
    mapped = _ALIASES.get(raw, raw)
    # Apply class map
    return _CLASS_MAP.get(mapped, mapped)


# ─────────────────────────────────────────────────────────────────────────────
# DDI table (generic/class pairs)
# ─────────────────────────────────────────────────────────────────────────────
# Keys are frozensets of normalised drug/class names.

_DDI_TABLE: Dict[frozenset, DDIAlert] = {}


def _add(drug_a: str, drug_b: str, severity: str, mechanism: str,
         effect: str, management: str, gambia_note: str = "") -> None:
    key = frozenset([drug_a, drug_b])
    _DDI_TABLE[key] = DDIAlert(
        drug_a=drug_a, drug_b=drug_b,
        severity=severity, mechanism=mechanism,
        effect=effect, management=management,
        gambia_note=gambia_note,
    )


# ── ACE inhibitor / ARB + potassium-sparing interactions ─────────────────────
_add("ace_inhibitor", "k_sparing_diuretic",
     "major",
     "Both drugs reduce renal potassium excretion.",
     "Hyperkalaemia — potentially life-threatening cardiac arrhythmias.",
     "Monitor serum potassium closely (2–4 weeks after any dose change). "
     "Avoid combination if K⁺ > 5.0 mEq/L. Reduce or stop spironolactone if needed.",
     "Spironolactone available at Regional Hospital level in The Gambia. "
     "Monitor at PHC if lab access limited.")

_add("arb", "k_sparing_diuretic",
     "major",
     "Both ARBs and K-sparing diuretics reduce renal potassium excretion.",
     "Hyperkalaemia — risk of fatal arrhythmia.",
     "Monitor potassium; avoid if K⁺ > 5.0 mEq/L.",
     "Same as ACE inhibitor combination — dual renin-angiotensin blockade is contraindicated.")

_add("ace_inhibitor", "arb",
     "contraindicated",
     "Dual RAAS blockade — no additive antihypertensive benefit, doubled risk of adverse effects.",
     "Hypotension, acute kidney injury, hyperkalaemia.",
     "Do NOT combine ACE inhibitor + ARB. Use one class only.",
     "Not recommended by WHO PEN or Gambia MOH NCD guidelines.")

# ── NSAIDs interactions ───────────────────────────────────────────────────────
_add("nsaid", "ace_inhibitor",
     "major",
     "NSAIDs inhibit prostaglandin-mediated renal vasodilation.",
     "Acute kidney injury; reduced antihypertensive effect.",
     "Avoid NSAIDs in hypertensive patients on ACE inhibitors. "
     "Use paracetamol for pain instead.",
     "Diclofenac/ibuprofen widely available OTC in Gambia — counsel patient/caregiver to avoid.")

_add("nsaid", "arb",
     "major",
     "Same mechanism as NSAIDs + ACE inhibitor.",
     "Acute kidney injury; reduced antihypertensive effect.",
     "Substitute paracetamol for pain. Alert prescribing clinician.",
     "Reinforce at every consultation — NSAIDs are commonly self-purchased.")

_add("nsaid", "anticoagulant",
     "contraindicated",
     "NSAIDs inhibit platelet aggregation and damage gastric mucosa.",
     "High risk of major GI bleeding.",
     "Contraindicated. Use paracetamol. If anticoagulant essential, add PPI.",
     "Warfarin is used in some cardiac patients at RVTH level.")

_add("nsaid", "beta_blocker",
     "moderate",
     "NSAIDs reduce prostaglandin synthesis, blunting beta-blocker antihypertensive effect.",
     "Reduced blood pressure control.",
     "Use paracetamol instead of NSAIDs. Monitor BP if NSAID required.",
     "")

_add("nsaid", "thiazide",
     "moderate",
     "NSAIDs reduce diuretic efficacy and may worsen fluid retention.",
     "Reduced diuresis; BP destabilisation.",
     "Avoid NSAIDs. Use paracetamol for analgesia.",
     "")

_add("nsaid", "biguanide",
     "moderate",
     "NSAIDs can cause acute kidney injury, increasing metformin accumulation.",
     "Risk of lactic acidosis if renal function deteriorates.",
     "Avoid NSAIDs in patients on metformin. Hydrate well if unavoidable.",
     "")

# ── Anticoagulant interactions ────────────────────────────────────────────────
_add("anticoagulant", "azole_antifungal",
     "major",
     "Azole antifungals inhibit CYP2C9, reducing warfarin metabolism.",
     "Elevated INR — major bleeding risk.",
     "Reduce warfarin dose by 25-50% when adding fluconazole. "
     "Monitor INR every 3 days until stable.",
     "Fluconazole used for candidiasis and cryptococcal meningitis in Gambia. "
     "Always alert prescribing clinician before combining.")

_add("anticoagulant", "macrolide",
     "major",
     "Macrolides inhibit CYP3A4 and alter gut flora (reducing vitamin K).",
     "Increased INR — bleeding risk.",
     "Monitor INR closely. Reduce warfarin dose if INR rises above 3.",
     "")

_add("anticoagulant", "sulfonamide",
     "major",
     "Cotrimoxazole inhibits warfarin metabolism via CYP2C9.",
     "Raised INR; bleeding risk.",
     "Avoid combination if possible. If essential, halve warfarin dose and check INR at day 3.",
     "Cotrimoxazole widely used in Gambia for PCP prophylaxis and UTI.")

_add("anticoagulant", "rifampicin",
     "major",
     "Rifampicin is a potent CYP450 inducer — greatly increases warfarin metabolism.",
     "Sub-therapeutic INR → thromboembolism risk.",
     "Double warfarin dose may be needed during TB treatment. Monitor INR weekly.",
     "TB is prevalent in The Gambia — this interaction is clinically important.")

# ── Statins ───────────────────────────────────────────────────────────────────
_add("statin", "macrolide",
     "major",
     "Macrolides inhibit CYP3A4, increasing statin plasma levels.",
     "Myopathy and rhabdomyolysis.",
     "Avoid simvastatin + clarithromycin. Use azithromycin or switch to rosuvastatin (CYP3A4 independent).",
     "Clarithromycin and simvastatin both available in Gambia — flag this combination.")

_add("statin", "azole_antifungal",
     "major",
     "Azoles inhibit CYP3A4, raising simvastatin/lovastatin levels markedly.",
     "Myopathy; rhabdomyolysis.",
     "Avoid simvastatin with azole antifungals. Use rosuvastatin or pravastatin instead.",
     "")

_add("statin", "amiodarone",
     "major",
     "Amiodarone inhibits CYP3A4 and CYP2C9.",
     "Elevated statin plasma level — myopathy risk.",
     "Do not exceed simvastatin 10 mg/day with amiodarone. Prefer rosuvastatin.",
     "")

# ── Digoxin ───────────────────────────────────────────────────────────────────
_add("cardiac_glycoside", "antiarrhythmic",
     "major",
     "Amiodarone inhibits P-glycoprotein — raises digoxin levels by ~70%.",
     "Digoxin toxicity: nausea, bradycardia, arrhythmia.",
     "Reduce digoxin dose by 50% when adding amiodarone. Monitor digoxin levels and ECG.",
     "Both drugs used at RVTH for heart failure — this is a high-risk combination in practice.")

_add("cardiac_glycoside", "macrolide",
     "moderate",
     "Macrolides inhibit gut flora and P-glycoprotein, increasing digoxin absorption.",
     "Elevated digoxin levels — toxicity risk.",
     "Monitor for digoxin toxicity symptoms. Check pulse before each dose.",
     "")

# ── Metformin ─────────────────────────────────────────────────────────────────
_add("biguanide", "sulfonamide",
     "moderate",
     "Trimethoprim competes with metformin renal tubular secretion (OCT2).",
     "Raised metformin plasma levels; lactic acidosis risk if renal function impaired.",
     "Monitor renal function. Avoid combination if eGFR < 45 mL/min.",
     "Cotrimoxazole frequently used for prophylaxis in The Gambia — monitor diabetic patients.")

_add("biguanide", "fluoroquinolone",
     "minor",
     "Fluoroquinolones can cause unpredictable blood glucose changes.",
     "Hypoglycaemia or hyperglycaemia in diabetic patients.",
     "Monitor blood glucose closely during ciprofloxacin course.",
     "")

# ── Beta-blockers ─────────────────────────────────────────────────────────────
_add("beta_blocker", "biguanide",
     "moderate",
     "Beta-blockers mask tachycardia (early hypoglycaemia symptom) in diabetics.",
     "Hypoglycaemia may go unrecognised; prolonged episodes.",
     "Educate patient/caregiver on non-adrenergic hypoglycaemia signs (sweating, confusion). "
     "Prefer cardioselective beta-blocker (atenolol, bisoprolol).",
     "")

_add("beta_blocker", "sulfonylurea",
     "moderate",
     "Beta-blockers mask hypoglycaemia and may prolong recovery.",
     "Unrecognised hypoglycaemia.",
     "Prefer cardioselective beta-blockers. Educate on non-adrenergic hypoglycaemia signs.",
     "")

# ── Antimalarial interactions ─────────────────────────────────────────────────
_add("antimalarial", "typical_antipsychotic",
     "major",
     "Both drugs prolong QTc interval.",
     "Combined QTc prolongation — risk of torsades de pointes / ventricular arrhythmia.",
     "Avoid co-prescription. If antimalarial essential, withhold antipsychotic and monitor ECG.",
     "Malaria is endemic in Gambia — this interaction is clinically significant. "
     "Alert prescriber immediately.")

_add("antimalarial", "anticoagulant",
     "moderate",
     "Quinine inhibits CYP2C9 — raises warfarin levels.",
     "Elevated INR; bleeding risk.",
     "Monitor INR during and after quinine course.",
     "Quinine still used for severe malaria in The Gambia.")

# ── Rifampicin (enzyme inducer) ───────────────────────────────────────────────
_add("rifampicin", "oral contraceptive",
     "major",
     "Rifampicin is a potent CYP3A4 inducer, dramatically reducing contraceptive plasma levels.",
     "Contraceptive failure — unintended pregnancy.",
     "Use barrier contraception during TB treatment and for 1 month after. "
     "Consider DMPA (injectable) which is less affected.",
     "TB treatment common in Gambia. Counsel all women of reproductive age on this interaction.")

_add("rifampicin", "ccb_dihydropyridine",
     "major",
     "Rifampicin induces CYP3A4, reducing amlodipine/nifedipine plasma levels by up to 90%.",
     "Loss of blood pressure control.",
     "May need 2-3× dose increase of CCB during TB treatment; monitor BP closely.",
     "")

# ── Isoniazid ─────────────────────────────────────────────────────────────────
_add("isoniazid", "anticoagulant",
     "moderate",
     "Isoniazid inhibits CYP2C9, raising warfarin levels.",
     "Elevated INR; bleeding risk.",
     "Monitor INR monthly during TB treatment.",
     "")

_add("isoniazid", "tca",
     "moderate",
     "Isoniazid inhibits monoamine oxidase; additive CNS effects with TCAs.",
     "CNS toxicity: seizures, serotonin-like effects.",
     "Monitor for CNS adverse effects. Reduce TCA dose if needed.",
     "")


# ─────────────────────────────────────────────────────────────────────────────
# Main function
# ─────────────────────────────────────────────────────────────────────────────

def check_drug_interactions(
    patient_id: str,
    patient_data: Dict[str, Any],
) -> DDIReport:
    """
    Check drug-drug interactions for a patient's current medication list.

    patient_data = {
        "profile": {"medications": [...], ...},
        ...
    }
    """
    profile = patient_data.get("profile", {})
    raw_meds = profile.get("medications", [])

    # Normalise medication names
    med_names: List[str] = []
    for m in raw_meds:
        if isinstance(m, dict):
            med_names.append(m.get("name", ""))
        else:
            med_names.append(str(m))

    normalised: List[str] = [_normalise(n) for n in med_names if n.strip()]
    unique_norm: List[str] = list(dict.fromkeys(normalised))  # preserve order, deduplicate

    alerts: List[DDIAlert] = []
    seen_pairs: Set[frozenset] = set()

    for i, drug_a in enumerate(unique_norm):
        for drug_b in unique_norm[i + 1:]:
            # Direct pair lookup
            key = frozenset([drug_a, drug_b])
            if key not in seen_pairs and key in _DDI_TABLE:
                seen_pairs.add(key)
                alert = _DDI_TABLE[key]
                # Replace class names with actual drug names for readability
                display_a = med_names[unique_norm.index(drug_a)] if drug_a in unique_norm else drug_a
                display_b = med_names[unique_norm.index(drug_b)] if drug_b in unique_norm else drug_b
                alerts.append(DDIAlert(
                    drug_a=display_a,
                    drug_b=display_b,
                    severity=alert.severity,
                    mechanism=alert.mechanism,
                    effect=alert.effect,
                    management=alert.management,
                    gambia_note=alert.gambia_note,
                ))

    # Sort: contraindicated first, then major, moderate, minor
    severity_order = {"contraindicated": 0, "major": 1, "moderate": 2, "minor": 3}
    alerts.sort(key=lambda a: severity_order.get(a.severity, 4))

    contraindicated = sum(1 for a in alerts if a.severity == "contraindicated")
    major           = sum(1 for a in alerts if a.severity == "major")

    if contraindicated:
        summary = (f"CONTRAINDICATED combination detected: {contraindicated} pair(s) — "
                   "immediate clinical review required.")
    elif major:
        summary = f"{major} major drug-drug interaction(s) — clinical review recommended."
    elif alerts:
        summary = f"{len(alerts)} moderate/minor drug interaction(s) detected. Monitor patient."
    else:
        summary = "No significant drug-drug interactions detected in current medication list."

    return DDIReport(
        patient_id           = patient_id,
        medications_checked  = med_names,
        alerts               = alerts,
        contraindicated_count= contraindicated,
        major_count          = major,
        summary              = summary,
    )
