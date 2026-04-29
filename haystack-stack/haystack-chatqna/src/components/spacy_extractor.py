import spacy
from haystack import component
from typing import List, Dict, Any

@component
class SpacySlotExtractor:
    """
    Analyzes the user's incoming chat message using spaCy NLP.
    Extracts clinical entities and maps them to ArcadeDB metadata labels.
    """
    def __init__(self):
        print("⚙️ Initializing spaCy Slot Extractor...")
        
        # Clever trick: Auto-download the spaCy model if it's missing from Docker!
        try:
            self.nlp = spacy.load("en_core_web_sm")
        except OSError:
            print("⏳ Downloading spaCy English model. This only happens once...")
            from spacy.cli import download
            download("en_core_web_sm")
            self.nlp = spacy.load("en_core_web_sm")

        # -------------------------
        # REVERSE TAXONOMY MAPPING
        # Maps user chat keywords to our Database Labels
        # -------------------------
        self.keyword_to_label = {
            # Hypertension Triggers
            "hypertension": "topic_hypertension",
            "blood pressure": "topic_hypertension",
            "bp": "topic_hypertension",
            "140/90": "topic_hypertension",
            "sbp": "topic_hypertension",
            "dbp": "topic_hypertension",
            "amlodipine": "topic_hypertension",
            "enalapril": "topic_hypertension",
            "lisinopril": "topic_hypertension",
            "losartan": "topic_hypertension",

            # Tobacco Triggers
            "smoke": "topic_tobacco",
            "smoking": "topic_tobacco",
            "tobacco": "topic_tobacco",
            "quit": "topic_tobacco",
            "nicotine": "topic_tobacco",
            "shisha": "topic_tobacco",

            # Diabetes Triggers
            "diabetes": "topic_diabetes",
            "sugar": "topic_diabetes",
            "glucose": "topic_diabetes",
            "hba1c": "topic_diabetes",
            "metformin": "topic_diabetes",
            "insulin": "topic_diabetes",
            "hypoglycemia": "topic_diabetes",

            # CVD Triggers
            "heart": "topic_cvd",
            "heart attack": "topic_cvd",
            "stroke": "topic_cvd",
            "chest pain": "topic_cvd",
            "cardiovascular": "topic_cvd",
            "cholesterol": "topic_cvd",

            # Respiratory Triggers
            "asthma": "topic_respiratory",
            "copd": "topic_respiratory",
            "inhaler": "topic_respiratory",
            "wheezing": "topic_respiratory",
            "breathing": "topic_respiratory",
            "breathless": "topic_respiratory",

            # Cancer Triggers
            "cancer": "topic_cancer",
            "lump": "topic_cancer",
            "tumor": "topic_cancer",
            "cervical": "topic_cancer",
            "screening": "topic_cancer",

            # Lifestyle Triggers
            "diet": "topic_lifestyle",
            "exercise": "topic_lifestyle",
            "weight": "topic_lifestyle",
            "obesity": "topic_lifestyle",
            "salt": "topic_lifestyle",
            "nutrition": "topic_lifestyle",
            "food": "topic_lifestyle",
            "walking": "topic_lifestyle",

            # Kidney Disease Triggers
            "kidney": "topic_kidney",
            "creatinine": "topic_kidney",
            "dialysis": "topic_kidney",
            "renal": "topic_kidney",
            "urine protein": "topic_kidney",

            # Mental Health Triggers
            "depressed": "topic_mental_health",
            "depression": "topic_mental_health",
            "anxiety": "topic_mental_health",
            "suicide": "topic_mental_health",
            "hopeless": "topic_mental_health",
            "mental health": "topic_mental_health",

            # Ramadan Triggers
            "ramadan": "topic_ramadan",
            "fasting": "topic_ramadan",
            "suhoor": "topic_ramadan",
            "iftar": "topic_ramadan",

            # Gambia Health System Triggers
            "efsth": "topic_gambia_health",
            "health post": "topic_gambia_health",
            "health centre": "topic_gambia_health",
            "chw": "topic_gambia_health",
            "alkalo": "topic_gambia_health",
        }

    @component.output_types(query=str, extracted_labels=List[str], extracted_entities=Dict[str, List[str]])
    def run(self, query: str):
        # 1. Run the raw chat message through spaCy's NLP pipeline
        doc = self.nlp(query.lower())
        
        extracted_labels = set()
        extracted_entities = {"measurements": [], "clinical_terms": []}

        # 2. Extract Named Entities (like ages, dosages, or generic numbers)
        for ent in doc.ents:
            if ent.label_ in ["CARDINAL", "QUANTITY", "PERSON", "DATE"]:
                extracted_entities["measurements"].append(ent.text)

        # 3. Extract Noun Chunks (e.g., "severe chest pain")
        for chunk in doc.noun_chunks:
            extracted_entities["clinical_terms"].append(chunk.text)

        # 4. Map the chat text to our ArcadeDB labels!
        query_text = query.lower()
        for keyword, label in self.keyword_to_label.items():
            if keyword in query_text:
                extracted_labels.add(label)

        # 5. Fallback: If the user just says "Hello", don't break the database query
        if not extracted_labels:
            extracted_labels.add("general_ncd")

        print(f"🗣️ User Query: '{query}'")
        print(f"🔍 Extracted Entities: {extracted_entities}")
        print(f"🏷️ Mapped DB Labels: {list(extracted_labels)}")
        
        # We pass the original query AND the new labels to the next step
        return {
            "query": query, 
            "extracted_labels": list(extracted_labels),
            "extracted_entities": extracted_entities
        }