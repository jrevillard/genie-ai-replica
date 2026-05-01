"""
AMINA Care — Mandinka Translation v3 (three-stage pipeline)
============================================================

Problem:  GPT-4o-mini / Gemma have almost no Mandinka training data.
          Asking them to translate directly produces English words
          in Mandinka-like sentence shapes — not real Mandinka.

Solution: A three-stage pipeline inspired by how ChatGPT handles
          low-resource languages with grounding material.

  Stage 1 — SIMPLIFY
    Rewrite the English source into simple, medically careful language.
    Short sentences, no jargon, no fancy nutrition claims.
    A CHW reading this aloud should be understood by a patient with
    no formal education.

  Stage 2 — TRANSLATE with grounding
    Translate the simplified English into Mandinka using:
    (a) A curated Mandinka reference grammar block injected into context
    (b) A clinical glossary of ~200 verified terms
    (c) 20+ parallel example sentences (EN → MNK) as few-shot examples
    (d) Explicit Mandinka grammar rules (SOV order, postpositions, etc.)
    The model is told to ONLY use Mandinka words from the glossary or
    examples — if it doesn't know a word, leave it in English with
    a parenthetical note rather than inventing a fake Mandinka word.

  Stage 3 — VERIFY back-translation
    Back-translate the Mandinka output into English using a separate
    LLM call. Compare the back-translation against the simplified
    source. If meaning diverges significantly, flag for human review
    rather than serving a bad translation.

This file generates the code but does NOT ingest or deploy.

BUG-030 status: NOT WIRED. The original docstring claimed
"set USE_V3_TRANSLATOR=true and restart" would activate v3, but no
runtime path reads that variable -- callers always use the v2
backend via translator.py / translation_v2.py. Treat translator_v3
as a WIP scaffold; do not assume any env-var flips it on.

Reference: Peace Corps Mandinka Language Manual (The Gambia),
           Mandinka-English Dictionary (Creissels & Sambou),
           WEC Mandinka literacy materials.
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
from typing import Any, Dict, List, Optional, Tuple

from openai import AsyncOpenAI
from src.config import settings

logger = logging.getLogger(__name__)


# ═══════════════════════════════════════════════════════════════════════
#  MANDINKA REFERENCE GRAMMAR (injected into Stage 2 context)
# ═══════════════════════════════════════════════════════════════════════

MANDINKA_GRAMMAR_REFERENCE = """
MANDINKA GRAMMAR RULES (Gambian standard orthography):

1. WORD ORDER: Subject-Object-Verb (SOV), NOT English SVO.
   EN: "I take medicine" → MNK: "Nte saraabu le domorinta" (I medicine EMPH took)
   EN: "The doctor said" → MNK: "Doktoro ye a fo" (Doctor PAST it say)

2. VERB SYSTEM:
   - Completive (past): subject + ye + object + verb-ta
     "I ate rice" → "Nte ye maanoo domo-ta"
   - Progressive (present): subject + be + object + verb-la
     "I am taking medicine" → "Nte be saraabu domo-la"
   - Habitual: subject + ka + object + verb
     "I take medicine daily" → "Nte ka saraabu domo luŋ wo luŋ"
   - Imperative: verb + object
     "Drink water" → "Jiyo miŋ"
   - Negative: subject + ma (past) / te (present/habitual)
     "I didn't eat" → "Nte ma domo"
     "I don't drink" → "Nte te miŋ-la"

3. POSTPOSITIONS (not prepositions):
   "to the hospital" → "saraabuubaa baa to" (hospital at/to)
   "from Banjul" → "Banjul to" (Banjul from)
   "for your health" → "i kendeyaa la" (your health for)

4. PRONOUNS:
   I/me = nte, you = ite/i, he/she = ate/a, we = ntolu, they = itolu
   my = n/nte ka, your = i/ite ka, his/her = a ka

5. EMPHASIS PARTICLE "le":
   Used after the focused element. Very common in Mandinka.
   "It is important" → "A nafaa le mu"
   "This is medicine" → "Niŋ saraabu le ti"

6. PLURALS: add -lu or -olu
   saraabu (medicine) → saraabulu (medicines)
   diŋo (child) → diŋolu (children)

7. GREETINGS (always use these exact forms):
   "Peace be upon you" → "Salaamaalekum"
   "Good morning" → "I suba sita?" / "Isama?"
   "Good afternoon" → "I tilii bata?"
   "Good evening" → "I wulaara?"
   "Thank you" → "Abaraka" / "Ibaarake"
   "How is your health?" → "I kendeyaa be di?"

8. COMMON HEALTH PHRASES:
   "How do you feel?" → "I jaatoo be di?"
   "Where does it hurt?" → "Minte le be i dimi-la?"
   "Take your medicine" → "I ka i saraabu domo"
   "Go to the health post" → "Taa kendeyaa dulaa to"
   "Call 199" → "199 waali"
   "Your blood pressure is high" → "I yele fankoo ka jaŋ"
   "Your blood sugar is high" → "I yele sukkaroo ka jaŋ"
   "Drink plenty of water" → "Jiyo miŋ siyaa la"
   "Eat less salt" → "Soloo domo doomaŋ"
   "This is serious" → "Niŋ kuu nafamaa le mu"
"""

# ═══════════════════════════════════════════════════════════════════════
#  PARALLEL EXAMPLES (few-shot grounding)
# ═══════════════════════════════════════════════════════════════════════

PARALLEL_EXAMPLES = [
    ("Your blood pressure is a bit high today. Try to eat less salt and drink more water.",
     "I yele fankoo ka jaŋ doomaŋ bi. I ka soloo domo doomaŋ, i ka jiyo miŋ siyaa la."),

    ("Please take your metformin every morning with food.",
     "I ka i metformin domo suubaa wo suubaa domoroo kumaa."),

    ("You should go to the health post if you feel dizzy or very tired.",
     "Ni kungo be i meŋmeŋ-la, walla ni seeyaa baa be i la, taa kendeyaa dulaa to."),

    ("How are you feeling since your last visit?",
     "I jaatoo be di kabiriŋ i naŋo laban?"),

    ("Your blood sugar is 180. That is higher than normal. Have you been eating your meals on time?",
     "I yele sukkaroo mu 180 le ti. A ka jaŋ a siifaa la. I be i domoroo domo-la a waatoo le la?"),

    ("It is very important to take your medicine every day, even during Ramadan.",
     "A nafamaa baa le mu i ka i saraabu domo luŋ wo luŋ, hani Koritoo tumaa."),

    ("I want to check your weight today. Please stand on the scale.",
     "N b'a fe ka i jiibiroo kisikisi bi. I joo taamasiroo kaŋ."),

    ("If you have chest pain or difficulty breathing, call 199 immediately.",
     "Ni kankeŋ dimi be i la, walla ni i te niijiyo soto-la, 199 waali joona."),

    ("Do not stop taking your medicine without talking to the doctor first.",
     "I kana i saraabu to, fo i ye doktoro kumandi folo."),

    ("Drink at least 6 glasses of water every day.",
     "Jiyo miŋ keme woorowula baaree luŋ wo luŋ."),

    ("Reduce sugary foods and drinks to help manage your diabetes.",
     "Sukkari domoroolu niŋ miŋ-fanoolu domo doomaŋ, a be maakoyiroo ke i sukari-kuuraŋo la."),

    ("You are doing well. Keep taking your medicine and come back in two weeks.",
     "I be a ke-la beteyaa la. I to i saraabu domo-la, i naŋ seyin sibi fula too."),

    ("Salaam alaikum. How is your family?",
     "Salaamaalekum. I somandalu be di?"),

    ("Good morning. Thank you for coming to see me.",
     "Isama. Abaraka, i ye naŋ n ye-la."),

    ("I am going to measure your blood pressure now.",
     "N be i yele fankoo kisikisi-la saayiŋ."),

    ("Please eat more vegetables and less oil in your food.",
     "I ka nakoo siyaa domo, i ka tuloo domo doomaŋ i domoroo kono."),

    ("This is nothing to worry about, but let us check again next week.",
     "A te kuu jaatoo ti, bariŋ aŋ ka a kisikisi seyin sibi naatoo to."),

    ("Your condition is stable. That is good news.",
     "I kuuraŋo siitoo le. Kibaaree beteyaa le mu niŋ ti."),

    ("We need to send you to EFSTH for more tests.",
     "Fo aŋ ka i kiiti EFSTH to, kisikisi wuloo la."),

    ("Make sure you rest well and avoid heavy work for now.",
     "I ka i lafii beteyaa la, i kana baraa jabiroo ke saayiŋ."),
]


# ═══════════════════════════════════════════════════════════════════════
#  EXTENDED CLINICAL GLOSSARY
# ═══════════════════════════════════════════════════════════════════════

CLINICAL_GLOSSARY = {
    # ── Anatomy ───────────────────────────────────────────────────────
    "blood": "yeloo",
    "blood pressure": "yele fankoo",
    "blood sugar": "yele sukkaroo",
    "blood glucose": "yele sukkaroo",
    "heart": "jusoo",
    "head": "kungo",
    "stomach": "konoo",
    "chest": "kankeŋo",
    "body": "balajaatoo",
    "breath": "niijiyo",
    "breathing": "niijiyo",
    "eye": "ñaayoo",
    "ear": "tuluu",
    "skin": "goloo",
    "bone": "koloo",
    "leg": "siŋo",
    "hand": "buloo",
    "back": "koŋo",
    "tooth": "ñiŋo",
    "throat": "kaŋkaŋo",
    "kidney": "juuroo",
    "liver": "siyoo",
    "lung": "fuufuuroo",

    # ── Symptoms & conditions ─────────────────────────────────────────
    "pain": "dimi",
    "headache": "kung dimi",
    "stomach pain": "konoo dimi",
    "chest pain": "kankeŋ dimi",
    "fever": "kandi jaatoo",
    "cough": "soloo-sooloo",
    "dizziness": "kungo meŋmeŋoo",
    "vomiting": "foonoo",
    "nausea": "jusu-koyaa",
    "diarrhea": "konoboloo",
    "swelling": "fuutoo",
    "tiredness": "seeyaa",
    "weakness": "seeyaa",
    "itching": "kusuu",
    "rash": "golo kuuraŋo",
    "wound": "joloo",
    "bleeding": "yele booroo",
    "diabetes": "sukari-kuuraŋo",
    "high blood pressure": "yele fankoo jaŋoo",
    "hypertension": "yele fankoo jaŋoo",
    "malaria": "sumaya kuuraŋo",
    "illness": "kuuraŋo",
    "sickness": "kuuraŋo",
    "sick": "saasaaringo",
    "symptom": "taamasiroo",
    "symptoms": "taamasiroolu",
    "infection": "kuuraŋ jiyaajiyaa",
    "pregnant": "konoto",
    "pregnancy": "konoto",

    # ── Clinical actions ──────────────────────────────────────────────
    "medicine": "saraabu",
    "medication": "saraabu",
    "medicines": "saraabulu",
    "doctor": "doktoro",
    "nurse": "sayifoo",
    "clinic": "saraabuubaa",
    "hospital": "saraabuubaa baa",
    "health post": "kendeyaa dulaa",
    "health worker": "kendeyaa dookuulaa",
    "check": "kisikisi",
    "examine": "kisikisi",
    "monitor": "kisikisiroo",
    "visit": "naŋo",
    "last visit": "naŋo laban",
    "emergency": "sutoo kuuraŋo",
    "ambulance": "kuuraŋ moobiloo",
    "test": "kisikisiroo",
    "injection": "pikiroo",
    "treatment": "saraabuloo",
    "care": "maakoyiroo",
    "rest": "lafiroo",

    # ── General / daily life ──────────────────────────────────────────
    "water": "jiyo",
    "drink": "miŋ",
    "food": "domoroo",
    "meal": "domorisoo",
    "eat": "domo",
    "salt": "soloo",
    "sugar": "sukkaroo",
    "oil": "tuloo",
    "vegetable": "nakoo",
    "fruit": "tuloo-yiroo",
    "rice": "maanoo",
    "fish": "jiyoo",
    "meat": "suboo",
    "help": "maakoyiroo",
    "important": "nafamaa",
    "dangerous": "jaaloo",
    "good": "beteyaa",
    "bad": "juurumoo",
    "healthy": "kendeyaa",
    "health": "kendeyaa",
    "strong": "seŋoo",
    "weak": "seeyaaringo",
    "day": "luŋo",
    "week": "siboo",
    "month": "karoo",
    "morning": "suubaa",
    "afternoon": "tiloo la",
    "evening": "wulaaroo",
    "today": "bi",
    "tomorrow": "suniŋ",
    "yesterday": "kuŋuŋ",
    "always": "tumaa bee",
    "never": "abada",
    "sometimes": "wati doo la",
    "plenty": "siyaa",
    "a little": "doomaŋ",
    "too much": "baa doyaa",
    "family": "somandaa",
    "child": "diŋo",
    "children": "diŋolu",
    "woman": "musoo",
    "man": "kewo",
    "old person": "keebaaroo",
    "community": "kafoo",
    "village": "saatee",
    "home": "luwo",
    "traditional": "aadoo",
    "prayer": "saliwo",
    "Ramadan": "Koritoo",
    "fasting": "suroo",

    # ── Do-not-translate (preserve verbatim) ──────────────────────────
    "metformin": "metformin",
    "amlodipine": "amlodipine",
    "paracetamol": "paracetamol",
    "insulin": "insulin",
    "Banjul": "Banjul",
    "EFSTH": "EFSTH",
    "Kanifing": "Kanifing",
    "benachin": "benachin",
    "domoda": "domoda",
    "supakanja": "supakanja",
    "bissap": "bissap",
    "attaya": "attaya",
    "bouye": "bouye",
    "moringa": "moringa",
    "mg/dL": "mg/dL",
    "mmol/L": "mmol/L",
    "BP": "BP",
    "DKA": "DKA",
}


# ═══════════════════════════════════════════════════════════════════════
#  STAGE 1 — SIMPLIFY English source
# ═══════════════════════════════════════════════════════════════════════

SIMPLIFY_SYSTEM = """You are a medical language simplifier for AMINA Care, \
a community health programme in The Gambia.

Rewrite the user's English text so it can be easily understood by a \
patient with no formal education when read aloud by a community health worker.

Rules:
- Use short, simple sentences (max 12 words each).
- Replace medical jargon with plain language:
  "hypertension" → "high blood pressure"
  "adherence" → "taking your medicine regularly"
  "glycemic control" → "keeping your blood sugar normal"
  "cardiovascular risk" → "risk of heart problems"
- Do NOT make health claims that are not medically verified.
  BAD: "Lemon lowers blood pressure"
  GOOD: "Eating fruits and vegetables is good for your health"
- Keep medication names unchanged (metformin, amlodipine, insulin).
- Keep place names unchanged (EFSTH, Banjul).
- Keep Gambian food names unchanged (benachin, domoda, supakanja).
- Keep numbers and measurements unchanged.
- Do NOT add information that was not in the original.
- Return ONLY the simplified text. No preamble."""


# ═══════════════════════════════════════════════════════════════════════
#  STAGE 2 — TRANSLATE with grounding
# ═══════════════════════════════════════════════════════════════════════

def _build_translation_system_prompt(glossary_extra: str = "") -> str:
    """Build the Stage 2 system prompt with grammar + glossary + examples."""

    glossary_block = "\n\nCLINICAL GLOSSARY (use these exact Mandinka words):\n"
    for en, mnk in sorted(CLINICAL_GLOSSARY.items()):
        if en != mnk:
            glossary_block += f"  {en} = {mnk}\n"

    if glossary_extra:
        glossary_block += f"\n{glossary_extra}\n"

    examples_block = "\n\nPARALLEL EXAMPLES (follow this style and register):\n"
    for en, mnk in PARALLEL_EXAMPLES:
        examples_block += f"  EN: {en}\n  MNK: {mnk}\n\n"

    return f"""You are a Mandinka translator for AMINA Care, a community health \
programme in The Gambia. You translate simplified English into natural \
Gambian Mandinka as spoken in the Greater Banjul area and rural provinces.

CRITICAL RULES:
1. ONLY use Mandinka words you see in the glossary or examples below. \
If you do not know the Mandinka word for something, keep the English \
word in the output. NEVER invent or guess a Mandinka word.
2. Follow Mandinka SOV (Subject-Object-Verb) word order.
3. Write as a community health worker speaks to a patient — warm, \
direct, using short sentences. Not bookish or literal.
4. Keep medication names, place names, food names, numbers, and units \
exactly as they appear in the source.
5. Do NOT repeat words or phrases. If you cannot translate something \
fluently, stop and keep the English. Truncation is always better \
than repetition or invention.
6. Do NOT add greetings, explanations, or preamble. Return ONLY the \
Mandinka translation.
7. Use standard Gambian Mandinka orthography with proper diacritics: \
ŋ (not ng), ñ (not ny), ɛ, ɔ, ɲ where appropriate.

{MANDINKA_GRAMMAR_REFERENCE}
{glossary_block}
{examples_block}"""


# ═══════════════════════════════════════════════════════════════════════
#  STAGE 3 — VERIFY via back-translation
# ═══════════════════════════════════════════════════════════════════════

BACKTRANSLATE_SYSTEM = """You are a Mandinka-to-English translator. \
Translate the following Mandinka text back into English as literally \
as possible. Preserve the meaning and structure. If you encounter a \
word you don't recognize, transliterate it in brackets like [unknown: word].

Return ONLY the English translation. No commentary."""


VERIFY_SYSTEM = """You are a translation quality checker for a Gambian \
health programme. Compare the ORIGINAL English text with a BACK-TRANSLATION \
from Mandinka.

Score the translation on:
1. MEANING PRESERVED (0-10): Does the back-translation convey the same \
medical information? Are any critical health instructions lost or changed?
2. SAFETY (0-10): Could the translation cause a patient to take wrong \
medicine, miss an emergency, or get harmful advice?

Return ONLY a JSON object:
{
  "meaning_score": <0-10>,
  "safety_score": <0-10>,
  "issues": ["list of specific problems, if any"],
  "verdict": "pass" | "review" | "fail"
}

Scoring guide:
- "pass": meaning ≥ 7 AND safety ≥ 8 — safe to serve to patient
- "review": meaning 4-6 OR safety 5-7 — needs human review
- "fail": meaning < 4 OR safety < 5 — do not serve, return English instead"""


# ═══════════════════════════════════════════════════════════════════════
#  TRANSLATOR CLASS
# ═══════════════════════════════════════════════════════════════════════

class TranslatorV3:
    """Three-stage Mandinka translator with grounding and verification."""

    def __init__(self):
        self.client = AsyncOpenAI(
            api_key=settings.OPENAI_API_KEY,
            base_url=settings.OPENAI_BASE_URL,
        )
        self.model = settings.OPENAI_MODEL or "gpt-4o-mini"

        if getattr(settings, "GOOGLE_API_KEY", ""):
            self.gemini_client = AsyncOpenAI(
                api_key=settings.GOOGLE_API_KEY,
                base_url=getattr(settings, "GEMINI_BASE_URL",
                                 "https://generativelanguage.googleapis.com/v1beta/openai/"),
            )
            self.gemini_model = getattr(settings, "GEMINI_MODEL", "gemini-2.5-flash-lite")
        else:
            self.gemini_client = None
            self.gemini_model = None

        self._redis = None
        self._translation_system = _build_translation_system_prompt()

    @property
    def redis(self):
        if self._redis is None:
            from src.agent.memory_manager import get_memory_manager
            self._redis = get_memory_manager().redis
        return self._redis

    def _cache_key(self, text: str, source: str, target: str) -> str:
        h = hashlib.sha1(f"v3|{source}|{target}|{text}".encode()).hexdigest()[:16]
        return f"translate:v3:{source}:{target}:{h}"

    # ── Main entry point ──────────────────────────────────────────────

    async def translate(
        self,
        text: str,
        source: str = "en",
        target: str = "ma",
        verify: bool = True,
    ) -> Dict[str, Any]:
        """Translate text through the three-stage pipeline.

        Returns:
          {
            "translation": str,        # Mandinka text (or original if failed)
            "simplified": str,          # Stage 1 output
            "back_translation": str,    # Stage 3 output (if verify=True)
            "verification": dict|None,  # Stage 3 scores (if verify=True)
            "source": str,
            "served_from": "cache" | "pipeline",
            "quality": "pass" | "review" | "fail" | "unverified",
          }
        """
        if not text or not text.strip():
            return self._empty_result(text, source)
        if source == target:
            return self._empty_result(text, source)

        # Check cache
        try:
            cached = self.redis.get(self._cache_key(text, source, target))
            if cached:
                data = json.loads(cached)
                data["served_from"] = "cache"
                return data
        except Exception as e:
            logger.debug(f"v3 cache read failed: {e}")

        # Stage 1: Simplify
        simplified = await self._simplify(text)
        if not simplified:
            simplified = text

        # Stage 2: Translate with grounding
        translation = await self._translate_grounded(simplified)
        if not translation:
            return self._empty_result(text, source, simplified=simplified)

        result = {
            "translation": translation,
            "simplified": simplified,
            "back_translation": "",
            "verification": None,
            "source": text,
            "served_from": "pipeline",
            "quality": "unverified",
        }

        # Stage 3: Verify
        if verify:
            back_trans = await self._back_translate(translation)
            result["back_translation"] = back_trans or ""

            if back_trans:
                verification = await self._verify(simplified, back_trans)
                result["verification"] = verification
                result["quality"] = verification.get("verdict", "review") if verification else "review"

                if result["quality"] == "fail":
                    logger.warning(
                        f"v3: translation failed verification, returning English. "
                        f"Issues: {verification.get('issues', [])}"
                    )
                    result["translation"] = simplified
            else:
                result["quality"] = "review"

        # Cache successful translations
        if result["quality"] in ("pass", "unverified"):
            try:
                self.redis.setex(
                    self._cache_key(text, source, target),
                    30 * 86400,
                    json.dumps(result, default=str),
                )
            except Exception as e:
                logger.debug(f"v3 cache write failed: {e}")

        return result

    # ── Stage 1: Simplify ─────────────────────────────────────────────

    async def _simplify(self, text: str) -> Optional[str]:
        """Rewrite English into simple, medically careful language."""
        try:
            resp = await self._call_llm(
                system=SIMPLIFY_SYSTEM,
                user=text,
                temperature=0.1,
                max_tokens=500,
            )
            return resp
        except Exception as e:
            logger.warning(f"v3 simplify failed: {e}")
            return None

    # ── Stage 2: Translate with grounding ─────────────────────────────

    async def _translate_grounded(self, simplified_text: str) -> Optional[str]:
        """Translate simplified English to Mandinka using grammar + glossary + examples."""
        try:
            resp = await self._call_llm(
                system=self._translation_system,
                user=simplified_text,
                temperature=0.2,
                max_tokens=800,
                frequency_penalty=0.5,
                presence_penalty=0.3,
            )
            if resp:
                resp = self._post_process(resp)
            return resp
        except Exception as e:
            logger.warning(f"v3 translate failed: {e}")
            return None

    # ── Stage 3: Back-translate and verify ─────────────────────────────

    async def _back_translate(self, mandinka_text: str) -> Optional[str]:
        """Translate Mandinka back to English for verification."""
        try:
            return await self._call_llm(
                system=BACKTRANSLATE_SYSTEM,
                user=mandinka_text,
                temperature=0.1,
                max_tokens=500,
            )
        except Exception as e:
            logger.warning(f"v3 back-translate failed: {e}")
            return None

    async def _verify(self, original: str, back_translation: str) -> Optional[Dict]:
        """Compare original against back-translation for quality scoring."""
        try:
            user_msg = (
                f"ORIGINAL ENGLISH:\n{original}\n\n"
                f"BACK-TRANSLATION FROM MANDINKA:\n{back_translation}"
            )
            resp = await self._call_llm(
                system=VERIFY_SYSTEM,
                user=user_msg,
                temperature=0.0,
                max_tokens=300,
            )
            if resp:
                resp = resp.strip()
                if resp.startswith("```"):
                    resp = re.sub(r"```json?\s*", "", resp)
                    resp = resp.rstrip("`").strip()
                return json.loads(resp)
        except (json.JSONDecodeError, Exception) as e:
            logger.warning(f"v3 verify failed: {e}")
        return None

    # ── LLM call helper ───────────────────────────────────────────────

    async def _call_llm(
        self,
        system: str,
        user: str,
        temperature: float = 0.2,
        max_tokens: int = 500,
        frequency_penalty: float = 0.0,
        presence_penalty: float = 0.0,
    ) -> Optional[str]:
        """Call LLM with Gemini primary, GPT-4o-mini fallback."""
        messages = [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ]

        # Try Gemini first (cheaper, faster)
        if self.gemini_client:
            try:
                resp = await self.gemini_client.chat.completions.create(
                    model=self.gemini_model,
                    messages=messages,
                    temperature=temperature,
                    max_tokens=max_tokens,
                    timeout=15,
                )
                text = (resp.choices[0].message.content or "").strip()
                if text:
                    return text
            except Exception as e:
                logger.debug(f"v3 Gemini call failed, falling back: {e}")

        # Fallback to GPT-4o-mini
        try:
            resp = await self.client.chat.completions.create(
                model=self.model,
                messages=messages,
                temperature=temperature,
                max_tokens=max_tokens,
                frequency_penalty=frequency_penalty,
                presence_penalty=presence_penalty,
                timeout=20,
            )
            return (resp.choices[0].message.content or "").strip()
        except Exception as e:
            logger.error(f"v3 LLM call failed: {e}")
            return None

    # ── Post-processing ───────────────────────────────────────────────

    def _post_process(self, text: str) -> str:
        """Clean up translation output."""
        text = text.strip().strip('"').strip("'").strip()

        # Strip common LLM artifacts
        for prefix in ("Translation:", "MNK:", "Mandinka:", "Output:"):
            if text.lower().startswith(prefix.lower()):
                text = text[len(prefix):].strip()

        # Repetition guard: detect and truncate repeated phrases
        text = self._truncate_repetitions(text)

        return text

    @staticmethod
    def _truncate_repetitions(text: str) -> str:
        """Detect and truncate any phrase repeated 3+ times."""
        words = text.split()
        if len(words) < 10:
            return text

        for window in range(3, 1, -1):
            for i in range(len(words) - window * 3):
                phrase = " ".join(words[i:i + window])
                rest = " ".join(words[i + window:])
                count = rest.count(phrase)
                if count >= 2:
                    idx = text.find(phrase)
                    second = text.find(phrase, idx + len(phrase))
                    if second > 0:
                        return text[:second].rstrip(" ,.")  + "."
        return text

    # ── Helpers ────────────────────────────────────────────────────────

    def _empty_result(
        self, text: str, source: str, simplified: str = ""
    ) -> Dict[str, Any]:
        return {
            "translation": text,
            "simplified": simplified or text,
            "back_translation": "",
            "verification": None,
            "source": text,
            "served_from": "passthrough",
            "quality": "unverified",
        }


# ═══════════════════════════════════════════════════════════════════════
#  SINGLETON
# ═══════════════════════════════════════════════════════════════════════

_translator_v3: Optional[TranslatorV3] = None


def get_translator_v3() -> TranslatorV3:
    global _translator_v3
    if _translator_v3 is None:
        _translator_v3 = TranslatorV3()
    return _translator_v3
