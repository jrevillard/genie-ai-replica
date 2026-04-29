import os
import json
import faiss
from sentence_transformers import SentenceTransformer
from haystack import component

@component
class IntentClassifier:
    """
    Scans the user query and outputs an intent string to guide the Router.
    3 Layers: Rule-based → FAISS semantic → Default fallback
    """

    def __init__(self, confidence_threshold: float = 0.55):
        self.threshold = confidence_threshold

        # --- Load ML Layer ---
        print("⏳ Loading pre-trained FAISS Intent Classifier...")
        self.model = SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2")

        index_path = "src/models/intent/router.faiss"
        labels_path = "src/models/intent/intent_labels.json"

        if not os.path.exists(index_path) or not os.path.exists(labels_path):
            raise FileNotFoundError(
                "FAISS index missing! Run 'python -m src.utils.train_intents' first."
            )

        self.index = faiss.read_index(index_path)
        with open(labels_path, "r", encoding="utf-8") as f:
            self.intent_labels = json.load(f)

        print("✅ FAISS Intent Index loaded instantly!")

    @component.output_types(intent=str)
    def run(self, query: str):
        query_lower = query.lower().strip()
       
        # Layer 1: RULE-BASED MATCHING (instant)

        # Rule 1: Smalltalk / Greetings
        greetings = [
            "hi", "hello", "hey", "good morning", "good afternoon", "good evening",
            "how are you", "what's up", "howdy", "yo", "sup",
            "thank you", "thanks", "bye", "goodbye", "see you",
            "who are you", "what can you do", "what is your name", "your name",
        ]
        if query_lower in greetings or any(query_lower.startswith(g) for g in greetings):
            print("👋 Router: Greeting/smalltalk detected. Bypassing RAG.")
            return {"intent": "smalltalk"}

        # Rule 2: Emergency red flags → triage
        red_flags = [
            "emergency", "ambulance", "hospital", "dying", "suicide",
            "bleeding out", "heart attack", "stroke", "unconscious",
            "can't breathe", "cannot breathe", "collapsed", "seizure",
            "overdose", "poisoning", "choking",
        ]
        if any(word in query_lower for word in red_flags):
            print("🚨 Router: Red Flag Emergency intent detected.")
            return {"intent": "triage"}

        # Rule 3: Urgent symptom + urgency modifier → triage
        urgent_symptoms = [
            "pain", "hurt", "hurts", "burning", "breathing", "broken",
            "chest", "bleeding", "blood", "swollen", "numb", "dizzy",
            "fainting", "vomiting", "fever",
        ]
        urgency_modifiers = [
            "severe", "really bad", "very bad", "terrible", "extreme",
            "trouble", "help", "sudden", "sharp", "unbearable",
            "worst", "can't stop", "getting worse", "emergency",
        ]
        has_symptom = any(word in query_lower for word in urgent_symptoms)
        has_urgency = any(word in query_lower for word in urgency_modifiers)

        if has_symptom and has_urgency:
            print("🚨 Router: Urgent Symptom Triage intent detected.")
            return {"intent": "triage"}

        # Rule 4: Health assistant keywords → assistant (skip FAISS, high confidence)
        health_keywords = [
            "diabetes", "diabetic", "blood sugar", "glucose", "insulin", "hba1c",
            "hypertension", "blood pressure", "cholesterol", "heart",
            "cancer", "tumor", "screening", "biopsy",
            "asthma", "copd", "respiratory", "lung", "breathing",
            "obesity", "overweight", "bmi", "weight",
            "depression", "anxiety", "stress", "mental health", "insomnia",
            "medication", "medicine", "drug", "pill", "dose", "dosage",
            "diet", "nutrition", "exercise", "fitness", "vitamin",
            "smoking", "alcohol", "quit smoking", "cessation",
            "pregnancy", "pregnant", "prenatal",
            "vaccine", "vaccination", "screening", "checkup",
            "symptom", "symptoms", "diagnose", "treatment", "manage",
            "headache", "migraine", "fatigue", "cough", "fever",
            "kidney", "liver", "thyroid", "joint", "bone",
            # Gambian foods (health context)
            "domoda", "benachin", "chere", "supakanja", "moringa", "baobab",
            "millet", "sorghum", "groundnut", "palm oil",
        ]
        if any(kw in query_lower for kw in health_keywords):
            print("🏥 Router (Rule): Health keyword detected → Assistant.")
            return {"intent": "assistant"}

        # Rule 5: Question patterns about health → assistant
        health_patterns = [
            "what is", "what are", "how to", "how do i", "how can i",
            "can i eat", "should i", "is it safe", "tell me about",
            "help me with", "i have", "i feel", "my doctor",
            "what causes", "how to manage", "how to prevent",
            "what should i do", "when should i",
        ]
        if any(query_lower.startswith(p) for p in health_patterns):
            print("🏥 Router (Rule): Health question pattern → Assistant.")
            return {"intent": "assistant"}

        # Layer 2: FAISS SEMANTIC FALLBACK

        query_emb = self.model.encode([query], convert_to_numpy=True)
        faiss.normalize_L2(query_emb)

        scores, indices = self.index.search(query_emb, 1)
        top_score = scores[0][0]
        top_idx = indices[0][0]

        if top_score >= self.threshold:
            matched_intent = self.intent_labels[top_idx]
            print(f"🧠 Router (FAISS): Matched '{matched_intent}' (Confidence: {top_score:.2f})")
            return {"intent": matched_intent}

        # Layer 3: Default fallback → assistant

        print(f"🏥 Router (Fallback): Low confidence ({top_score:.2f}). Defaulting to Assistant.")
        return {"intent": "assistant"}