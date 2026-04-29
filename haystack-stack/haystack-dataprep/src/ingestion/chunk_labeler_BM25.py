from haystack import component, Document
from typing import List, Dict, Tuple
from rank_bm25 import BM25Okapi
import re

# Tokenizer that protects medical composite tokens like "140/90", "hba1c"
_TOKEN_RE = re.compile(r"\b[a-zA-Z0-9]+(?:[/-][a-zA-Z0-9]+)*\b", re.UNICODE)

_STOPWORDS = {
    "the","a","an","and","or","of","to","in","for","on","with","as","at","by","from",
    "is","are","was","were","be","been","being","this","that","these","those","it",
    "may","might","can","could","should","will","would","also","such","than","then",
    "into","over","under","within","without","between","during","before","after",
    "patient","patients","clinical","care","health"
}

def tokenize(text: str) -> List[str]:
    tokens = _TOKEN_RE.findall((text or "").lower())
    return [t for t in tokens if t not in _STOPWORDS and len(t) > 1]

@component
class BM25ChunkLabeler:
    """
    Simplified Ingestion-time BM25 labeler (Dual-Axis NCD Taxonomy):
      - Builds a frozen BM25 index out of the label definitions.
      - Scores each incoming chunk strictly on semantic term frequency.
      - Assigns Topic + Content-Type labels into doc.meta["category_labels"].
    """

    def __init__(
        self,
        topic_top_k: int = 2,
        type_top_k: int = 2,
        topic_min_score: float = 2.0,
        type_min_score: float = 1.6,
        debug: bool = True,
    ):
        print("⚙️ Initializing Simplified Production BM25 NCD Labeler...")
        self.topic_top_k = topic_top_k
        self.type_top_k = type_top_k
        self.topic_min_score = topic_min_score
        self.type_min_score = type_min_score
        self.debug = debug

        # -------------------------
        # 1. TOPIC AXIS (What is the disease/area?)
        # -------------------------
        self.TOPIC_QUERIES: Dict[str, str] = {
            "topic_tobacco": "tobacco smoking cessation quit nicotine dependence 5as 5rs fagerstrom nrt nicotine replacement varenicline bupropion secondhand relapse withdrawal",
            "topic_hypertension": "hypertension high blood pressure sbp dbp 140/90 130-139 antihypertensive acei arb ccb thiazide single-pill combination target blood pressure follow up amlodipine enalapril losartan",
            "topic_diabetes": "diabetes type 2 glucose blood sugar hba1c a1c fasting ogtt metformin insulin sulfonylurea hyperglycemia hypoglycemia dka ketoacidosis gliclazide foot care retinopathy",
            "topic_cvd": "cardiovascular heart attack stroke myocardial infarction angina atherosclerosis cholesterol lipid statin aspirin risk chart who/ish peripheral vascular claudication",
            "topic_respiratory": "asthma copd chronic obstructive pulmonary wheezing inhaler salbutamol beclometasone bronchodilator peak flow spirometry exacerbation breathlessness cough sputum",
            "topic_cancer": "cancer cervical breast oral tumor lump screening via hpv mammography biopsy chemotherapy radiotherapy palliative retinoblastoma burkitt lymphoma",
            "topic_lifestyle": "diet exercise physical activity salt sugar weight obesity bmi nutrition fruit vegetable walking smoking cessation alcohol stress sleep",
            "topic_kidney": "kidney renal ckd chronic kidney disease egfr creatinine albuminuria dialysis nephrology proteinuria nephrotic glomerular filtration urine protein potassium anaemia",
            "topic_mental_health": "depression anxiety mental health suicide mood sadness hopeless psychosocial fluoxetine amitriptyline antidepressant mhgap sleep insomnia emotional wellbeing",
            "topic_ramadan": "ramadan fasting suhoor iftar sehri iftaar taraweeh prayer muslim islamic fast breaking glucose monitoring medication timing",
            "topic_gambia_health": "gambia gambian efsth banjul kerewan farafenni bansang basse chw vhw alkalo health post health centre dalasi lumo bantaba moringa benachin",
        }
        self.topic_keys = list(self.TOPIC_QUERIES.keys())
        self.topic_bm25 = BM25Okapi([tokenize(self.TOPIC_QUERIES[k]) for k in self.topic_keys])

        # -------------------------
        # 2. TYPE AXIS (What is the document doing?)
        # -------------------------
        self.TYPE_QUERIES: Dict[str, str] = {
            "type_guideline": "guideline recommendation protocol algorithm first-line indication contraindication dose titration follow-up management referral criteria step stepwise",
            "type_pharmacotherapy": "dose mg titration contraindication side effects drug medication nrt patch gum lozenge varenicline bupropion acei arb ccb thiazide beta-blocker metformin insulin sulfonylurea amlodipine enalapril",
            "type_lifestyle_counseling": "counseling advice behavioral motivational interviewing diet salt sodium exercise physical activity weight loss stop smoking quit moringa vegetables fruit walking stress sleep",
            "type_screening_diagnosis": "screening diagnosis criteria threshold assessment blood pressure measurement hba1c fasting ogtt random glucose risk factors complications retinopathy neuropathy microalbumin via hpv cervical breast examination",
            "type_emergency_red_flags": "emergency urgent danger signs seek care go to hospital chest pain stroke severe headache shortness of breath hypertensive crisis severe hypoglycemia dka ketoacidosis call 199 unconscious collapsed seizure",
            "type_patient_education": "patient education self-care self-management home monitoring foot care inhaler technique adherence compliance reminder trigger avoidance prevention warning signs when to seek care",
            "type_cultural_context": "gambia gambian traditional medicine marabout imam alkalo cultural religious ramadan fasting prayer community bantaba chw village health worker local food",
        }
        self.type_keys = list(self.TYPE_QUERIES.keys())
        self.type_bm25 = BM25Okapi([tokenize(self.TYPE_QUERIES[k]) for k in self.type_keys])

        print("✅ BM25 Labeler initialized!")

    @component.output_types(documents=List[Document])
    def run(self, documents: List[Document]):
        if not documents:
            return {"documents": []}

        for doc in documents:
            raw_text = (doc.content or "").lower()
            chunk_tokens = tokenize(raw_text)

            # ---- Score TOPIC labels
            topic_base_scores = self.topic_bm25.get_scores(chunk_tokens)
            topic_scores: List[Tuple[str, float]] = []

            for idx, label in enumerate(self.topic_keys):
                topic_scores.append((label, float(topic_base_scores[idx])))

            topic_scores.sort(key=lambda x: x[1], reverse=True)
            assigned_topics = [l for l, s in topic_scores[:self.topic_top_k] if s >= self.topic_min_score]

            # ---- Score TYPE labels
            type_base_scores = self.type_bm25.get_scores(chunk_tokens)
            type_scores: List[Tuple[str, float]] = []

            for idx, label in enumerate(self.type_keys):
                type_scores.append((label, float(type_base_scores[idx])))

            type_scores.sort(key=lambda x: x[1], reverse=True)
            assigned_types = [l for l, s in type_scores[:self.type_top_k] if s >= self.type_min_score]

            # ---- Finalize and Inject Metadata
            assigned = assigned_topics + assigned_types
            if not assigned:
                assigned = ["general"]

            doc.meta["category_labels"] = assigned

            # Simplified debug payload
            if self.debug:
                doc.meta["category_scores"] = {
                    **{l: round(s, 2) for l, s in topic_scores[:3]},
                    **{l: round(s, 2) for l, s in type_scores[:3]},
                }

        print(f"🏷️ Successfully labeled {len(documents)} chunks with Dual-Axis Taxonomy.")
        return {"documents": documents}