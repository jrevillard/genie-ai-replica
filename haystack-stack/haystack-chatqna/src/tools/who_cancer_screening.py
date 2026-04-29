"""
WHO PEN Section 2.4 — Cancer Early Diagnosis

Screening for common cancer warning signs at primary care level.
Cervical cancer and breast cancer assessment flowcharts.
"""

from typing import Dict, Any, List
from src.tools.base import BaseTool


class WHOCancerScreeningTool(BaseTool):
    name = "screen_cancer"
    description = (
        "WHO PEN cancer early diagnosis screening. Identifies red-flag symptoms for common cancers, "
        "assesses cervical and breast cancer risk, and provides referral recommendations."
    )
    parameters = ["symptoms", "cancer_type", "age", "sex"]

    CANCER_SYMPTOMS = {
        "breast": {
            "symptoms": ["lump in breast", "breast asymmetry", "skin retraction", "nipple retraction", "bloody nipple discharge", "eczema areola"],
            "action": "Clinical breast examination. Women >30 or with risk factors/symptoms B/C: REFER immediately.",
        },
        "cervical": {
            "symptoms": ["post-coital bleeding", "bleeding after intercourse", "abnormal vaginal bleeding", "postmenopausal bleeding", "foul-smelling discharge", "pain during intercourse"],
            "action": "Speculum examination. If cervical growth/ulceration or palpable pelvic mass: REFER immediately.",
        },
        "colon": {
            "symptoms": ["change in bowel habits", "blood in stool", "rectal bleeding", "unexplained weight loss", "anaemia"],
            "action": "REFER for further investigation.",
        },
        "oral": {
            "symptoms": ["white lesion in mouth", "red lesion in mouth", "growth in mouth", "ulcer in mouth", "leukoplakia", "erythroplakia"],
            "action": "REFER for biopsy.",
        },
        "stomach": {
            "symptoms": ["upper abdominal pain", "recent indigestion", "unexplained weight loss"],
            "action": "REFER for endoscopy if symptoms persist.",
        },
        "prostate": {
            "symptoms": ["difficulty urinating", "frequent nocturnal urination", "weak urine stream"],
            "action": "REFER for further assessment.",
        },
        "lung": {
            "symptoms": ["persistent cough", "hoarseness", "coughing blood", "haemoptysis"],
            "action": "Rule out TB first (if cough >2 weeks). REFER for imaging.",
        },
        "skin": {
            "symptoms": ["skin lesion growing", "sore that won't heal", "mole changing", "irregular borders", "itching mole"],
            "action": "REFER for dermatological assessment.",
        },
    }

    def _screen_symptoms(self, symptoms: str, sex: str) -> List[Dict]:
        s = symptoms.lower()
        matches = []
        for cancer_type, info in self.CANCER_SYMPTOMS.items():
            if cancer_type in ("cervical", "breast") and sex.lower() in ("male", "m"):
                continue
            for symptom in info["symptoms"]:
                if symptom in s:
                    matches.append({
                        "cancer_type": cancer_type,
                        "matched_symptom": symptom,
                        "action": info["action"],
                    })
                    break
        return matches

    async def execute(
        self,
        symptoms: str = "",
        cancer_type: str = None,
        age: int = None,
        sex: str = "female",
        **kwargs,
    ) -> Dict[str, Any]:
        result = {"who_pen_reference": "Section 2.4 — Cancer Early Diagnosis"}

        # General symptom screening
        if symptoms:
            matches = self._screen_symptoms(symptoms, sex)
            if matches:
                result["warning_flags"] = matches
                result["urgency"] = "REFER to next level for confirmation of diagnosis"
                result["counselling"] = (
                    "Explain that symptoms may be related to cancer and timely referral is necessary. "
                    "Provide clear steps to the next level of care. "
                    "Also counsel on risk reduction (e.g. smoking cessation)."
                )
            else:
                result["warning_flags"] = []
                result["message"] = "No obvious cancer warning signs detected in reported symptoms. Continue routine screening."

        # Specific cancer type assessment
        if cancer_type == "cervical":
            result["cervical_assessment"] = {
                "who_to_screen": "Women aged ≥30 years",
                "symptoms_to_ask": [
                    "Abnormal vaginal bleeding (after intercourse, between periods, post-menopause)",
                    "Foul-smelling discharge",
                    "Pain during vaginal intercourse",
                ],
                "examination": "Speculum exam. Look for cervical growth or ulceration.",
                "refer_if": [
                    "Palpable pelvic mass with persistent low-back or abdominal pain",
                    "Clinically detected cervical growth or ulceration",
                    "Condition not manageable at PHC or persists/worsens",
                ],
                "prevention": "HPV vaccination for girls (primary prevention). Screening with VIA/HPV test.",
            }

        elif cancer_type == "breast":
            result["breast_assessment"] = {
                "symptoms_to_ask": [
                    "A: Breast lump or change in shape/consistency",
                    "B: Breast lump that enlarges and/or is fixed and hard",
                    "C: Eczematous skin changes, nipple retraction, peau d'orange, ulceration, bloody discharge, axillary lump",
                ],
                "age_based_action": {
                    "over_30": "REFER immediately to next level for any of symptoms A, B, or C",
                    "under_30_with_A_only": "Invite for follow-up after menstrual period. If symptoms B or C at follow-up: REFER.",
                    "under_30_with_B_or_C": "REFER immediately",
                },
                "examination": "Clinical examination of both breasts, axillae and neck",
            }

        # Follow-up
        result["follow_up"] = {
            "primary_care": "Coordinate with providers who diagnose and treat cancer",
            "information_transfer": "Direct link between primary care and higher levels improves timely access",
        }

        return result
