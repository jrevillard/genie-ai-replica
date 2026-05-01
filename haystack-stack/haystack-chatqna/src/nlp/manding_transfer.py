"""
BUG-031 status: NOT WIRED.

This module is imported by ``src/nlp/__init__.py`` for re-export but
no runtime path instantiates ``MandingTransferBridge`` or calls into
it today. The two sibling modules originally flagged by BUG-031
-- ``mandinka_temporal`` and ``notification_intent`` -- ARE wired
(temporal: TranslationCorrector Layer 2.5; notification: installed
via ``nlp_pipeline_integration._install_notif_patch``).

Do NOT remove this file without updating ``src/nlp/__init__.py``
to match.

Manding Transfer Bridge -- Bambara-mediated English-to-Mandinka translation.

Bambara and Mandinka are mutually intelligible Manding languages. Bambara has
far better NLP tooling (NLLB-200 includes bam_Latn). This module uses Bambara
as a translation bridge for Mandinka when the validated phrase bank in
``src.services.mandinka_phrases`` does not cover a term.

Direction: English -> Mandinka ONLY (response generation).
Never use this for Mandinka -> English (input understanding).

Pipeline:
  1. Check phrase bank (confidence 1.0, validated by native speakers)
  2. NLLB-200 English -> Bambara (facebook/nllb-200-distilled-600M)
  3. Lexical substitution Bambara -> Mandinka
  4. Quality scoring against known Mandinka vocabulary
"""

from __future__ import annotations

import logging
import re
from typing import Any, Dict, List, Optional, Set

__all__ = ["MandingTransferBridge"]

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Graceful import for transformers — may not be installed in every environment
# ---------------------------------------------------------------------------
_HAS_TRANSFORMERS = False
try:
    from transformers import AutoModelForSeq2SeqLM, AutoTokenizer  # type: ignore
    _HAS_TRANSFORMERS = True
except ImportError:
    AutoModelForSeq2SeqLM = None  # type: ignore[assignment,misc]
    AutoTokenizer = None  # type: ignore[assignment,misc]

try:
    import torch  # type: ignore
    _HAS_TORCH = True
except ImportError:
    torch = None  # type: ignore[assignment]
    _HAS_TORCH = False


# ═══════════════════════════════════════════════════════════════════════════
# BAMBARA -> MANDINKA LEXICAL MAP  (200+ entries)
#
# Three categories:
#   1. Identical cognates — same form in both languages
#   2. Regular phonological correspondences (ɔ->o, ɛ->e, etc.)
#   3. Divergent — genuinely different words
# ═══════════════════════════════════════════════════════════════════════════

BAMBARA_TO_MANDINKA: Dict[str, str] = {
    # ── 1. Identical / near-identical cognates ──────────────────────────
    "baara":        "baara",        # work
    "dimi":         "dimi",         # pain
    "fura":         "fura",         # remedy / medicine
    "jii":          "jii",          # water
    "kono":         "kono",         # stomach / inside
    "taa":          "taa",          # go
    "naa":          "naa",          # come
    "domo":         "domo",         # eat
    "miŋ":          "miŋ",          # drink
    "sii":          "sii",          # sit
    "wuli":         "wuli",         # stand up
    "boli":         "boli",         # run
    "taga":         "taga",         # go (variant)
    "sigi":         "sigi",         # sit (variant)
    "kuma":         "kumaa",        # speak / word
    "bala":         "bala",         # prohibition
    "kelen":        "kiliŋ",        # one
    "fila":         "fula",         # two
    "saba":         "saba",         # three
    "naani":        "naani",        # four
    "duuru":        "luulu",        # five
    "woro":         "wooro",        # six
    "wolonwula":    "worowula",     # seven
    "seegi":        "seyi",         # eight
    "kononto":      "kononto",      # nine
    "tan":          "taŋ",          # ten
    "tile":         "tilee",        # sun / day
    "kalo":         "karoo",        # moon / month
    "san":          "saŋ",          # year / rain
    "suu":          "suu",          # night
    "jeli":         "jeli",         # blood
    "ñaa":          "ñaa",          # eye
    "tulo":         "tuloo",        # ear
    "da":           "daa",          # mouth
    "kuŋ":          "kuŋ",          # head
    "bolo":         "boloo",        # hand / arm
    "seŋ":          "seŋ",          # foot / leg
    "juru":         "juroo",        # heart / rope
    "fari":         "faŋ",          # body
    "ja":           "jaa",          # image / self
    "ɲaa":          "ñaa",          # face / eye
    "so":           "soo",          # house
    "dunan":        "lunaŋ",        # stranger / guest
    "jamana":       "jamaanoo",     # country
    "sila":         "siiloo",       # road
    "ji":           "jii",          # water (short form)
    "kulu":         "kuloo",        # hill / back
    "wara":         "waraa",        # lion
    "kami":         "kami",         # snake (variant)
    "saa":          "saa",          # snake / die
    "malo":         "maloo",        # rice
    "ñɔ":           "ñoo",          # millet
    "tiga":         "tiyoo",        # groundnut
    "galamu":       "kalamoo",      # pen
    "bataki":       "batakoo",      # letter
    "dugu":         "dukoo",        # village
    "misiri":       "misiiroo",     # mosque
    "lakɔli":       "lakoli",       # school
    "se":           "se",           # arrive / be able
    "ko":           "ko",           # say / back
    "ka":           "ka",           # infinitive marker
    "bɛ":           "be",           # is / are (copula)
    "tɛ":           "te",           # is not
    "ye":           "ye",           # past tense marker
    "la":           "la",           # in / postposition
    "na":           "na",           # in / to
    "ni":           "niŋ",          # if / and
    "walasa":       "walasa",       # in order to
    "sabula":       "sabu",         # because
    "nka":          "baari",        # but
    "ani":          "aniŋ",         # and

    # ── 2. Regular phonological correspondences ─────────────────────────
    # Bambara ɔ -> Mandinka o
    "dɔgɔtɔrɔ":    "dokitaroo",    # doctor
    "kɔnɔ":        "kono",         # bird / stomach
    "bɔ":           "bo",           # leave / exit
    "kɔ":           "ko",           # back / behind
    "dɔn":          "doŋ",          # know / enter
    "mɔgɔ":        "moo",          # person
    "fɔ":           "fo",           # say / until
    "sɔrɔ":        "soto",         # get / obtain
    "kɔrɔ":        "koro",         # old / under
    "tɔ":           "to",           # suffix: in / at
    "dɔ":           "do",           # some / a certain
    "nɔ":           "no",           # ability / power
    "bɔli":         "boli",         # running
    "cɔgɔ":        "coŋo",         # manner / way
    "sɔgɔ":        "soŋo",         # meat (variant)
    "jɔn":          "joŋ",          # who
    "kɔlɔ":        "kolo",         # bone
    "gɔni":         "goni",         # almost
    "dɔgɔ":        "dogo",         # younger sibling
    "jɔ":           "jo",           # stand
    "pɔ":           "po",           # (variant)
    "tɔgɔ":        "toŋo",         # name

    # Bambara ɛ -> Mandinka e
    "kɛnɛ":        "kene",         # healthy / open space
    "kɛ":           "ke",           # do / make / man
    "bɛrɛ":        "bere",         # stone / other
    "jɛ":           "je",           # see / clear
    "dɛ":           "de",           # emphatic particle
    "sɛbɛn":       "seben",        # write
    "dɛmɛ":        "demmaa",       # help
    "jɛka":         "jeka",         # gather
    "nɛgɛ":        "neŋo",         # iron
    "sɛnɛ":        "sene",         # farm / cultivate
    "fɛn":          "feŋ",          # thing
    "hɛrɛ":        "here",         # peace / wellbeing
    "bɛɛ":         "bee",          # all / everyone
    "kɛlɛ":        "kelo",         # fight / war
    "sɛgɛn":       "seŋen",        # tired / bored
    "tɛmɛ":        "teme",         # pass / cross
    "cɛ":           "kee",          # man / husband
    "dɛmɛni":      "demmaariŋ",    # assistance
    "bɛɛn":        "beeŋ",         # agree
    "kɛnɛya":      "kendeyaa",     # health

    # Bambara final consonant -> Mandinka vowel lengthening
    "dumun":        "domoroo",      # food / eating
    "surun":        "suroo",        # close / near
    "bagan":        "bagaŋ",        # animal
    "dunan":        "lunaŋ",        # stranger
    "jalon":        "jaloo",        # genealogy
    "selen":        "seloo",        # arrive (at)
    "duman":        "diimaa",       # pleasant / good
    "birin":        "biriŋ",        # every / each
    "tuman":        "tumaŋ",        # time / occasion

    # Bambara "u" -> Mandinka "o" patterns
    "dumuni":       "domoroo",      # food / meal
    "kurusi":       "korosi",       # cross (religious)
    "sugu":         "bitiki",       # market / shop (divergent)
    "furu":         "futoo",        # marriage
    "kuru":         "kuroo",        # lump / knot

    # ── 3. Divergent forms — genuinely different words ──────────────────
    "bana":         "kuuraŋo",      # illness / disease
    "dɔgɔtɔrɔso":  "dokitaroobungo",  # hospital / clinic
    "lopitan":      "ospitaali",    # hospital (French loan)
    "fenw":         "feŋolu",       # things (plural)
    "musow":        "musuolu",      # women (plural)
    "cɛw":          "keeolu",       # men (plural)
    "denw":         "diŋolu",       # children (plural)
    "misɛn":        "misenoo",      # child (small)
    "den":          "diŋo",         # child
    "muso":         "musoo",        # woman
    "faso":         "fasoo",        # homeland
    "sigida":       "siidaa",       # residence / settlement
    "dunanba":      "lunaŋba",      # important stranger
    "hakili":       "hakilo",       # mind / memory
    "hami":         "hakiloo",      # thought (variant)
    "kisi":         "kiisii",       # save / protect
    "tubi":         "tubaa",        # repent
    "laseli":       "laseli",       # report / announce
    "dan":          "daŋ",          # create / limit
    "yɛlɛn":       "yelen",        # climb
    "taa ni na":    "taa niŋ naa",  # going and coming
    "jaabi":        "jaabii",       # answer / reply
    "ɲɔgɔn":       "ñoŋ",          # each other / together
    "basi":         "baasi",        # problem / harm
    "nafa":         "nafaa",        # benefit
    "sababu":       "sabu",         # cause / because
    "waati":        "waxatoo",      # time
    "kow":          "koolu",        # things / affairs (plural)
    "maana":        "maanoo",       # story / meaning
    "duwa":         "duwaawoo",     # prayer / blessing

    # ── Medical & health-specific vocabulary ────────────────────────────
    "furakɛli":     "furaŋo ke",    # treatment / taking medicine
    "banabagatɔ":   "kuurantiŋo",   # patient / sick person
    "joli":         "jeli",         # blood
    "joli ka bon":  "jeli ka jaŋjaŋ",  # high blood (pressure)
    "joli ka dɔgɔ": "jeli ka doyaa",   # low blood (pressure)
    "farigan":      "kurango",      # fever / malaria
    "kunkoloci":    "kuŋ dimi",     # headache
    "kɔnɔboli":    "kono naafoo",   # diarrhea
    "sagali":       "saŋkuuroo",    # vomiting (variant)
    "sukarabana":   "sukkaroo kuuraŋo",  # diabetes
    "joli bana":    "jeli kuuraŋo", # blood disease
    "kɛnɛyali":    "kendeyaali",    # healthcare
    "banabaatɔ":    "kuurantiŋo",   # sick person
    "dɛsɛ":        "daasee",       # be exhausted
    "fulaw":        "furaŋolu",     # medicines (plural)
    "sunguro":      "sunturoo",     # girl
    "kɔrɔmusow":   "keebaamusuolu",  # old women
    "kɔrɔcɛw":     "keebaaolu",    # old men
    "silatigɛ":     "siilaatigee",  # traveler

    # ── Food & nutrition ────────────────────────────────────────────────
    "dege":         "dege",         # porridge / paste
    "bassi":        "bassi",        # couscous
    "sira":         "siroo",        # syrup / path
    "dabilɛn":      "dabileŋ",      # prepare (food)
    "tukuni":       "tukuñoo",      # cooking pot
    "minɛ":         "mine",         # catch / grab
    "tulunin":      "tuloo dooyaa", # a little oil
    "sokɔn":        "sokoŋ",        # salt (variant)
    "sogo":         "soŋo",         # meat
    "jɛgɛ":        "jéwoo",        # fish
    "na":           "nakoo",        # sauce (ambiguous, context-dependent)
    "naaji":        "nakoo jii",    # sauce broth
    "kɔɔri":        "koori",        # rice (cooked, variant)
    "mugu":         "muŋkoo",       # flour / powder
    "ɲugin":        "ñiŋolu",       # seeds
    "mangoro":      "mankaroo",     # mango
    "bananu":       "banaanoo",     # banana
    "lɛmuru":       "lemunoo",      # lemon / citrus
    "jabibi":       "jabiboo",      # onion (variant)
    "tamati":       "tamaatoo",     # tomato

    # ── Time & scheduling ──────────────────────────────────────────────
    "sɔgɔma":      "subaa",        # morning
    "tile":         "tilee",        # midday / sun
    "wula":         "wulaaroo",     # afternoon / evening
    "su":           "suu",          # night
    "sini":         "saama",        # tomorrow
    "kunun":        "kuŋuŋ",        # yesterday
    "bi":           "bii",          # today
    "lɔgɔkun":     "lɔɔkuŋ",       # week
    "diɲɛ":        "duñaa",        # world

    # ── Common verbs ───────────────────────────────────────────────────
    "dun":          "domo",         # eat
    "min":          "miŋ",          # drink
    "lajɛ":        "laje",         # look / examine
    "dɛmɛ":        "demmaa",       # help
    "kalan":        "karaŋ",        # study / read
    "ladɛgɛ":      "ladee",        # prepare
    "labɛn":       "labeŋ",        # prepare / arrange
    "sɔn":         "soŋ",          # agree / accept
    "ban":          "baŋ",          # finish / refuse
    "lafasa":       "nafaa",        # benefit / be useful
    "dajɛ":        "daje",         # mix / share
    "sinɔgɔ":      "sinoo",        # sleep
    "kunu":         "kunu",         # wake up / swallow
    "mɛn":         "meŋ",          # hear / which
    "faamu":        "faamu",        # understand
    "latigɛ":      "latigee",      # decide / cut
    "ɲini":         "ñiŋ",          # seek / ask for
}


# ═══════════════════════════════════════════════════════════════════════════
# Build a set of all known Mandinka words for quality scoring
# ═══════════════════════════════════════════════════════════════════════════

def _build_known_mandinka_words() -> Set[str]:
    """Collect all known Mandinka words from the phrase bank and the lexical map."""
    words: Set[str] = set()

    # From the lexical map (target side)
    for mandinka_form in BAMBARA_TO_MANDINKA.values():
        for token in mandinka_form.lower().split():
            words.add(token)

    # From the phrase bank (lazy import to avoid circular dependency at module level)
    try:
        from src.services.mandinka_phrases import PHRASES, FOOD_NAMES
        for category in PHRASES.values():
            for phrase in category.values():
                for token in phrase.lower().split():
                    # Strip common punctuation from tokens
                    cleaned = re.sub(r"[!?,;:.\"'()\[\]{}]", "", token)
                    if cleaned:
                        words.add(cleaned)
        for entry in FOOD_NAMES.values():
            for token in entry["mandinka"].lower().split():
                cleaned = re.sub(r"[!?,;:.\"'()\[\]{}]", "", token)
                if cleaned:
                    words.add(cleaned)
    except ImportError:
        logger.warning("mandinka_phrases not available for quality scoring vocabulary")

    return words


# ═══════════════════════════════════════════════════════════════════════════
# Regex-based phonological rules for residual Bambara tokens not in the map
# ═══════════════════════════════════════════════════════════════════════════

_PHONOLOGICAL_RULES = [
    # Bambara open-o (ɔ) -> Mandinka closed-o
    (re.compile(r"ɔ"), "o"),
    # Bambara open-e (ɛ) -> Mandinka closed-e
    (re.compile(r"ɛ"), "e"),
    # Bambara ny -> Mandinka ñ
    (re.compile(r"ny"), "ñ"),
    # Bambara ng word-finally -> ŋ
    (re.compile(r"ng\b"), "ŋ"),
    # Bambara word-final n before pause -> ŋ
    (re.compile(r"n$"), "ŋ"),
    # Bambara dy -> Mandinka j
    (re.compile(r"dy"), "j"),
]


# ═══════════════════════════════════════════════════════════════════════════
# NLLB model identifier
# ═══════════════════════════════════════════════════════════════════════════

_NLLB_MODEL_ID = "facebook/nllb-200-distilled-600M"
_NLLB_SRC_LANG = "eng_Latn"
_NLLB_TGT_LANG = "bam_Latn"


class MandingTransferBridge:
    """Bambara-mediated English-to-Mandinka translation bridge.

    Uses the NLLB-200 model to translate English to Bambara, then applies
    lexical substitution rules to convert Bambara output to Mandinka.

    For RESPONSE generation only (English -> Mandinka).
    """

    def __init__(self) -> None:
        self._tokenizer: Any = None
        self._model: Any = None
        self._device: Optional[str] = None
        self._known_mandinka: Optional[Set[str]] = None

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def is_available(self) -> bool:
        """Check if the NLLB model is loaded and ready for inference."""
        return self._model is not None and self._tokenizer is not None

    def translate_via_bambara(self, english_text: str) -> Dict[str, Any]:
        """Translate English text to Mandinka via Bambara bridge.

        Pipeline:
          1. Check phrase bank first (confidence 1.0)
          2. NLLB-200 English -> Bambara
          3. Lexical substitution Bambara -> Mandinka
          4. Quality scoring

        Args:
            english_text: The English text to translate.

        Returns:
            Dict with keys:
                mandinka_text: The resulting Mandinka text.
                method: "phrase_bank" or "bambara_bridge".
                bambara_intermediate: Bambara text from NLLB, or None.
                substitutions_applied: List of substitution dicts.
                quality_score: Float 0.0 - 1.0.
                recommendation: "SERVE", "SERVE_WITH_WARNING", or "USE_ENGLISH".
        """
        if not english_text or not english_text.strip():
            return self._make_result(
                mandinka_text="",
                method="phrase_bank",
                bambara_intermediate=None,
                substitutions_applied=[],
                quality_score=0.0,
                recommendation="USE_ENGLISH",
            )

        # Step 1: Check validated phrase bank
        phrase_result = self._check_phrase_bank(english_text)
        if phrase_result is not None:
            return self._make_result(
                mandinka_text=phrase_result,
                method="phrase_bank",
                bambara_intermediate=None,
                substitutions_applied=[],
                quality_score=1.0,
                recommendation="SERVE",
            )

        # Step 2: NLLB English -> Bambara
        if not _HAS_TRANSFORMERS:
            logger.error(
                "transformers library not installed — cannot use Bambara bridge"
            )
            return self._make_result(
                mandinka_text=english_text,
                method="bambara_bridge",
                bambara_intermediate=None,
                substitutions_applied=[],
                quality_score=0.0,
                recommendation="USE_ENGLISH",
            )

        self._ensure_model_loaded()

        if not self.is_available():
            logger.error("NLLB model failed to load — falling back to English")
            return self._make_result(
                mandinka_text=english_text,
                method="bambara_bridge",
                bambara_intermediate=None,
                substitutions_applied=[],
                quality_score=0.0,
                recommendation="USE_ENGLISH",
            )

        bambara_text = self._translate_to_bambara(english_text)

        # Step 3: Bambara -> Mandinka substitution
        mandinka_text, substitutions = self._bambara_to_mandinka(bambara_text)

        # Step 4: Quality scoring
        quality_score = self._score_quality(mandinka_text)
        recommendation = self._get_recommendation(quality_score)

        return self._make_result(
            mandinka_text=mandinka_text,
            method="bambara_bridge",
            bambara_intermediate=bambara_text,
            substitutions_applied=substitutions,
            quality_score=quality_score,
            recommendation=recommendation,
        )

    # ------------------------------------------------------------------
    # Phrase bank lookup
    # ------------------------------------------------------------------

    def _check_phrase_bank(self, english_text: str) -> Optional[str]:
        """Check if the phrase bank has a validated translation.

        Searches across all categories for an exact key match against the
        lowercased, underscore-normalized input.
        """
        try:
            from src.services.mandinka_phrases import (
                PHRASES,
                find_symptom_phrase,
                find_food_phrases,
            )
        except ImportError:
            logger.warning("mandinka_phrases module not available")
            return None

        normalized = english_text.strip().lower().replace(" ", "_")

        # Direct key lookup across all categories
        for category_phrases in PHRASES.values():
            match = category_phrases.get(normalized)
            if match:
                return match

        # Try symptom matching
        symptom_matches = find_symptom_phrase(english_text)
        if symptom_matches and len(symptom_matches) == 1:
            # Only use if we get exactly one unambiguous match for the
            # entire input, otherwise the bridge translation is better
            _, mandinka_phrase = symptom_matches[0]
            # Verify the input is really just this symptom (not a longer sentence)
            key = symptom_matches[0][0]
            input_words = set(english_text.lower().split())
            key_words = set(key.replace("_", " ").split())
            if input_words == key_words or normalized == key:
                return mandinka_phrase

        # Try food matching
        food_matches = find_food_phrases(english_text)
        if food_matches and len(food_matches) == 1:
            input_lower = english_text.strip().lower()
            food_key = food_matches[0]["english"].replace(" ", "_")
            if input_lower == food_matches[0]["english"] or input_lower == food_key:
                return food_matches[0]["mandinka"]

        return None

    # ------------------------------------------------------------------
    # NLLB model management — lazy loading, cached after first call
    # ------------------------------------------------------------------

    def _ensure_model_loaded(self) -> None:
        """Lazily load the NLLB-200 distilled 600M model on first use.

        The distilled 600M variant fits in ~2GB RAM.
        Uses GPU if available, falls back to CPU (~200ms per sentence).
        """
        if self.is_available():
            return

        if not _HAS_TRANSFORMERS:
            logger.error("transformers library is not installed")
            return

        try:
            logger.info("Loading NLLB model: %s", _NLLB_MODEL_ID)

            self._tokenizer = AutoTokenizer.from_pretrained(
                _NLLB_MODEL_ID, src_lang=_NLLB_SRC_LANG
            )

            # Determine device
            if _HAS_TORCH and torch.cuda.is_available():
                self._device = "cuda"
                logger.info("NLLB will run on GPU (CUDA)")
            else:
                self._device = "cpu"
                logger.info("NLLB will run on CPU")

            self._model = AutoModelForSeq2SeqLM.from_pretrained(_NLLB_MODEL_ID)

            if self._device == "cuda":
                self._model = self._model.to(self._device)

            self._model.eval()
            logger.info("NLLB model loaded successfully on %s", self._device)

        except Exception:
            logger.exception("Failed to load NLLB model")
            self._model = None
            self._tokenizer = None

    # ------------------------------------------------------------------
    # Translation: English -> Bambara via NLLB
    # ------------------------------------------------------------------

    def _translate_to_bambara(self, english_text: str) -> str:
        """Translate English text to Bambara using NLLB-200."""
        try:
            inputs = self._tokenizer(
                english_text,
                return_tensors="pt",
                padding=True,
                truncation=True,
                max_length=512,
            )

            if self._device == "cuda":
                inputs = {k: v.to(self._device) for k, v in inputs.items()}

            # Get the target language token ID
            tgt_lang_id = self._tokenizer.convert_tokens_to_ids(_NLLB_TGT_LANG)

            if _HAS_TORCH:
                with torch.no_grad():
                    generated = self._model.generate(
                        **inputs,
                        forced_bos_token_id=tgt_lang_id,
                        max_new_tokens=256,
                    )
            else:
                generated = self._model.generate(
                    **inputs,
                    forced_bos_token_id=tgt_lang_id,
                    max_new_tokens=256,
                )

            bambara_text = self._tokenizer.batch_decode(
                generated, skip_special_tokens=True
            )[0]

            return bambara_text.strip()

        except Exception:
            logger.exception("NLLB translation failed for: %s", english_text[:100])
            return english_text

    # ------------------------------------------------------------------
    # Lexical substitution: Bambara -> Mandinka
    # ------------------------------------------------------------------

    def _bambara_to_mandinka(
        self, bambara_text: str
    ) -> tuple[str, List[Dict[str, str]]]:
        """Apply Bambara-to-Mandinka lexical substitutions.

        First tries multi-word substitutions (longest match first), then
        single-word, then falls back to phonological rules for unknown tokens.

        Returns:
            Tuple of (mandinka_text, list_of_substitution_records).
        """
        substitutions: List[Dict[str, str]] = []
        text = bambara_text

        # Sort multi-word entries by length (longest first) for greedy matching
        multi_word_entries = sorted(
            ((k, v) for k, v in BAMBARA_TO_MANDINKA.items() if " " in k),
            key=lambda kv: -len(kv[0]),
        )

        # Pass 1: Multi-word substitutions
        for bam_phrase, mand_phrase in multi_word_entries:
            if bam_phrase in text.lower():
                pattern = re.compile(re.escape(bam_phrase), re.IGNORECASE)
                if pattern.search(text):
                    text = pattern.sub(mand_phrase, text)
                    substitutions.append({
                        "bambara": bam_phrase,
                        "mandinka": mand_phrase,
                        "type": "multi_word",
                    })

        # Pass 2: Single-word substitutions
        single_word_map = {
            k: v for k, v in BAMBARA_TO_MANDINKA.items() if " " not in k
        }

        tokens = re.split(r"(\s+|[.,;:!?\"'()\[\]{}])", text)
        result_tokens: List[str] = []

        for token in tokens:
            lower_token = token.lower().strip()

            if not lower_token or not any(c.isalpha() for c in lower_token):
                # Whitespace or punctuation — pass through
                result_tokens.append(token)
                continue

            # Direct lookup
            if lower_token in single_word_map:
                mandinka_form = single_word_map[lower_token]
                result_tokens.append(mandinka_form)
                if mandinka_form != lower_token:
                    substitutions.append({
                        "bambara": lower_token,
                        "mandinka": mandinka_form,
                        "type": "direct",
                    })
                continue

            # Phonological rules fallback for unknown Bambara tokens
            transformed = lower_token
            for pattern, replacement in _PHONOLOGICAL_RULES:
                transformed = pattern.sub(replacement, transformed)

            if transformed != lower_token:
                result_tokens.append(transformed)
                substitutions.append({
                    "bambara": lower_token,
                    "mandinka": transformed,
                    "type": "phonological",
                })
            else:
                # Unknown token — pass through unchanged
                result_tokens.append(token)

        mandinka_text = "".join(result_tokens).strip()
        return mandinka_text, substitutions

    # ------------------------------------------------------------------
    # Quality scoring
    # ------------------------------------------------------------------

    def _get_known_mandinka(self) -> Set[str]:
        """Lazy-build and cache the set of known Mandinka words."""
        if self._known_mandinka is None:
            self._known_mandinka = _build_known_mandinka_words()
        return self._known_mandinka

    def _score_quality(self, mandinka_text: str) -> float:
        """Score translation quality based on recognized Mandinka vocabulary.

        Higher ratio of known Mandinka words in the output = higher score.

        Returns:
            Float between 0.0 and 1.0.
        """
        if not mandinka_text or not mandinka_text.strip():
            return 0.0

        known = self._get_known_mandinka()
        tokens = re.findall(r"[a-zA-ZñÑŋŊɛɔàáèéìíòóùú]+", mandinka_text.lower())

        if not tokens:
            return 0.0

        # Short function words that are common across many languages —
        # don't count these as strongly for or against quality
        _TRIVIAL = {"a", "i", "e", "o", "u", "n", "m", "k", "le", "la", "ka", "na"}

        recognized = 0
        scoreable = 0

        for token in tokens:
            if token in _TRIVIAL:
                # Trivial tokens get partial credit but don't dominate scoring
                recognized += 0.5
                scoreable += 1
                continue

            scoreable += 1
            if token in known:
                recognized += 1.0

        if scoreable == 0:
            return 0.0

        raw_score = recognized / scoreable

        # Penalize very short outputs (single-word translations are suspect
        # unless from the phrase bank, which bypasses scoring entirely)
        if len(tokens) == 1:
            raw_score *= 0.8

        return round(min(1.0, raw_score), 2)

    @staticmethod
    def _get_recommendation(quality_score: float) -> str:
        """Map quality score to a serving recommendation.

        - >= 0.7  -> SERVE  (high confidence)
        - >= 0.5  -> SERVE_WITH_WARNING  (usable but flag for review)
        - <  0.5  -> USE_ENGLISH  (bad Mandinka is worse than no Mandinka)
        """
        if quality_score >= 0.7:
            return "SERVE"
        if quality_score >= 0.5:
            return "SERVE_WITH_WARNING"
        return "USE_ENGLISH"

    # ------------------------------------------------------------------
    # Result construction
    # ------------------------------------------------------------------

    @staticmethod
    def _make_result(
        mandinka_text: str,
        method: str,
        bambara_intermediate: Optional[str],
        substitutions_applied: List[Dict[str, str]],
        quality_score: float,
        recommendation: str,
    ) -> Dict[str, Any]:
        return {
            "mandinka_text": mandinka_text,
            "method": method,
            "bambara_intermediate": bambara_intermediate,
            "substitutions_applied": substitutions_applied,
            "quality_score": quality_score,
            "recommendation": recommendation,
        }
