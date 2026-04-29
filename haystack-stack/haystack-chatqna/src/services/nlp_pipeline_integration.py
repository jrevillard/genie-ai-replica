"""
NLP Pipeline Integration — wires the 6-layer Mandinka NLP stack
into AminaAgent.process_message() as a pre-processing step.

Additive patch: monkey-patches AminaAgent at import time.
The existing English path is unchanged — NLP layers add Mandinka
understanding on top.

Import this module from main_with_rag_tuning.py to activate.
"""
from __future__ import annotations

import logging
import time
from typing import Dict, Any, Optional

_log = logging.getLogger("src.services.nlp_pipeline_integration")

_spellchecker = None
_code_switcher = None
_medical_ner = None
_sentiment_analyzer = None
_intent_normalizer = None


def _init_nlp():
    """Lazy-init all NLP layers once."""
    global _spellchecker, _code_switcher, _medical_ner
    global _sentiment_analyzer, _intent_normalizer
    if _spellchecker is not None:
        return

    try:
        from src.nlp.mandinka_spellcheck import MandinkaNormalizer
        _spellchecker = MandinkaNormalizer()
    except Exception as e:
        _log.warning("NLP: spellchecker init failed: %s", e)

    try:
        from src.nlp.code_switch_detector import CodeSwitchDetector
        _code_switcher = CodeSwitchDetector()
    except Exception as e:
        _log.warning("NLP: code-switch detector init failed: %s", e)

    try:
        from src.nlp.medical_ner import MedicalNERExtractor
        _medical_ner = MedicalNERExtractor()
    except Exception as e:
        _log.warning("NLP: medical NER init failed: %s", e)

    try:
        from src.nlp.mandinka_sentiment import MandinkaSentimentAnalyzer
        _sentiment_analyzer = MandinkaSentimentAnalyzer()
    except Exception as e:
        _log.warning("NLP: sentiment analyzer init failed: %s", e)

    try:
        from src.nlp.intent_normalizer import IntentNormalizer
        _intent_normalizer = IntentNormalizer()
    except Exception as e:
        _log.warning("NLP: intent normalizer init failed: %s", e)


def run_nlp_pipeline(message: str) -> Dict[str, Any]:
    """Run all 6 NLP layers on a message. Returns enrichment dict.

    Total target: < 25ms. All pure Python — no ML models.
    """
    _init_nlp()

    t0 = time.perf_counter()
    result = {
        "active": False,
        "spell": None,
        "language": None,
        "ner": None,
        "sentiment": None,
        "intent": None,
        "timings_ms": {},
    }

    # Layer 5: Spell normalization
    normalized_text = message
    spell_result = None
    if _spellchecker:
        t1 = time.perf_counter()
        try:
            spell_result = _spellchecker.normalize(message)
            normalized_text = spell_result.get("normalized", message)
            result["spell"] = spell_result
        except Exception as e:
            _log.debug("NLP spell failed: %s", e)
        result["timings_ms"]["spell"] = round((time.perf_counter() - t1) * 1000, 2)

    # Layer 1: Code-switch detection
    lang_info = None
    if _code_switcher:
        t1 = time.perf_counter()
        try:
            lang_info = _code_switcher.detect(normalized_text)
            result["language"] = lang_info
        except Exception as e:
            _log.debug("NLP code-switch failed: %s", e)
        result["timings_ms"]["codeswitch"] = round((time.perf_counter() - t1) * 1000, 2)

    # Layer 2: Medical NER
    ner_result = None
    if _medical_ner:
        t1 = time.perf_counter()
        try:
            ner_result = _medical_ner.extract(normalized_text, lang_info or {})
            result["ner"] = ner_result
        except Exception as e:
            _log.debug("NLP NER failed: %s", e)
        result["timings_ms"]["ner"] = round((time.perf_counter() - t1) * 1000, 2)

    # Layer 4: Sentiment & urgency
    sentiment = None
    if _sentiment_analyzer:
        t1 = time.perf_counter()
        try:
            sentiment = _sentiment_analyzer.analyze(
                normalized_text,
                ner_result or {},
                lang_info or {},
            )
            result["sentiment"] = sentiment
        except Exception as e:
            _log.debug("NLP sentiment failed: %s", e)
        result["timings_ms"]["sentiment"] = round((time.perf_counter() - t1) * 1000, 2)

    # Layer 6: Intent normalization
    intent_hint = None
    if _intent_normalizer:
        t1 = time.perf_counter()
        try:
            intent_hint = _intent_normalizer.normalize_for_pipeline(
                normalized_text,
                spell_result or {},
                lang_info or {},
                ner_result or {},
                sentiment or {},
            )
            result["intent"] = intent_hint
        except Exception as e:
            _log.debug("NLP intent failed: %s", e)
        result["timings_ms"]["intent"] = round((time.perf_counter() - t1) * 1000, 2)

    total_ms = round((time.perf_counter() - t0) * 1000, 2)
    result["timings_ms"]["total"] = total_ms
    result["active"] = True

    dominant = (lang_info or {}).get("dominant_language", "english")
    entities = (ner_result or {}).get("entities_found", 0)
    urgency = (sentiment or {}).get("urgency", 0)
    _log.info(
        "NLP pipeline: lang=%s entities=%d urgency=%.2f time=%.1fms",
        dominant, entities, urgency, total_ms,
    )

    return result


def _merge_nlp_tools(existing_tools: list, nlp_tools: list, cap: int = 3) -> list:
    """Merge NLP-suggested tools with keyword-routed tools, deduped, capped."""
    seen = set()
    merged = []

    priority_order = [
        "check_emergency", "assess_triage", "record_vitals",
        "manage_diabetes", "manage_hypertension", "assess_respiratory",
        "get_medication_info", "get_diet_advice", "suggest_community_support",
        "search_knowledge",
    ]

    all_tools = list(existing_tools) + list(nlp_tools)
    for tool in priority_order:
        if tool in all_tools and tool not in seen:
            merged.append(tool)
            seen.add(tool)
            if len(merged) >= cap:
                return merged

    for tool in all_tools:
        if tool not in seen:
            merged.append(tool)
            seen.add(tool)
            if len(merged) >= cap:
                return merged

    return merged


def build_nlp_context_block(nlp_result: Dict[str, Any]) -> str:
    """Build a compact context block for injection into the LLM prompt."""
    intent = nlp_result.get("intent")
    if not intent:
        return ""

    lang = nlp_result.get("language", {})
    sentiment = nlp_result.get("sentiment", {})
    dominant = lang.get("dominant_language", "english") if lang else "english"

    if dominant == "english":
        return ""

    parts = []
    original = intent.get("original_text", "")
    normalized = intent.get("normalized_query", "")

    if original and normalized and original != normalized:
        parts.append(f"PATIENT INPUT ({dominant}): {original}")
        parts.append(f"UNDERSTOOD AS: {normalized}")

    symptoms = intent.get("symptoms_english", [])
    if symptoms:
        parts.append(f"SYMPTOMS DETECTED: {', '.join(symptoms)}")

    vitals = intent.get("vitals_detected", {})
    if vitals:
        vstr = ", ".join(f"{k}={v}" for k, v in vitals.items())
        parts.append(f"VITALS THIS TURN: {vstr}")

    emotion = sentiment.get("emotional_state", "neutral") if sentiment else "neutral"
    urgency = sentiment.get("urgency", 0) if sentiment else 0
    pain = sentiment.get("pain_level", "none") if sentiment else "none"

    if emotion != "neutral" or urgency > 0.3:
        parts.append(f"EMOTIONAL STATE: {emotion} (urgency: {urgency:.1f}, pain: {pain})")

    if sentiment and sentiment.get("isolation_flag"):
        parts.append("WARNING: Patient may be alone/isolated")

    if sentiment and sentiment.get("masking_flag"):
        parts.append("CULTURAL NOTE: Patient says 'fine' but symptoms suggest otherwise — probe gently")

    parts.append("RESPOND IN: English with Mandinka key phrases where appropriate")

    return "\n".join(parts)


def _patch_agent():
    """Monkey-patch AminaAgent.process_message to inject NLP pre-processing."""
    try:
        from src.agent.amina_agent import AminaAgent
    except ImportError:
        _log.warning("NLP integration: AminaAgent not found, skipping patch")
        return

    _original_process = AminaAgent.process_message

    async def _patched_process_message(self, message, session_id, **kwargs):
        nlp_result = run_nlp_pipeline(message)

        intent = nlp_result.get("intent") or {}
        lang = nlp_result.get("language") or {}
        sentiment = nlp_result.get("sentiment") or {}
        ner = nlp_result.get("ner") or {}
        dominant = lang.get("dominant_language", "english")

        effective_message = message
        if dominant in ("mandinka", "mixed") and intent.get("normalized_query"):
            nlp_context = build_nlp_context_block(nlp_result)
            if nlp_context:
                if not hasattr(self, "_nlp_context_cache"):
                    self._nlp_context_cache = {}
                self._nlp_context_cache[session_id] = nlp_context

        emergency_flags = ner.get("emergency_flags", [])
        if emergency_flags:
            emergency_terms = " ".join(
                f.get("english", f.get("text", "")) if isinstance(f, dict) else str(f)
                for f in emergency_flags
            )
            if emergency_terms:
                effective_message = f"{message} [EMERGENCY: {emergency_terms}]"

        result = await _original_process(self, effective_message, session_id, **kwargs)

        nlp_metadata = {
            "input_language": dominant,
            "entities_found": ner.get("entities_found", 0),
            "urgency": sentiment.get("urgency", 0),
            "emotional_state": sentiment.get("emotional_state", "neutral"),
            "pain_level": sentiment.get("pain_level", "none"),
            "spell_corrections": len((nlp_result.get("spell") or {}).get("corrections", [])),
            "timings_ms": nlp_result.get("timings_ms", {}),
        }

        normalized_query = intent.get("normalized_query", "")
        if normalized_query:
            nlp_metadata["normalized_query"] = normalized_query

        result["nlp"] = nlp_metadata

        nlp_tools = intent.get("suggested_tools", [])
        if nlp_tools and dominant in ("mandinka", "mixed"):
            existing = result.get("tools_used", [])
            if not existing or existing == ["search_knowledge"]:
                result["nlp"]["suggested_tools"] = nlp_tools

        if sentiment.get("isolation_flag"):
            result["nlp"]["isolation_flag"] = True
        if sentiment.get("masking_flag"):
            result["nlp"]["masking_flag"] = True

        return result

    AminaAgent.process_message = _patched_process_message

    _original_route = AminaAgent._route_tools

    def _patched_route_tools(self, message):
        keyword_tools = _original_route(self, message)

        cache = getattr(self, "_nlp_context_cache", {})
        if not cache:
            return keyword_tools

        nlp_result = run_nlp_pipeline(message)
        intent = nlp_result.get("intent") or {}
        nlp_tools = intent.get("suggested_tools", [])

        if nlp_tools:
            return _merge_nlp_tools(keyword_tools, nlp_tools)

        return keyword_tools

    AminaAgent._route_tools = _patched_route_tools
    _log.info("NLP pipeline integrated into AminaAgent")


try:
    _patch_agent()
except Exception as e:
    _log.warning("NLP pipeline integration failed (non-fatal): %s", e)

try:
    from src.nlp.notification_intent import _install_patch as _install_notif_patch
    _install_notif_patch()
except Exception as e:
    _log.warning("Notification intent patch failed (non-fatal): %s", e)
