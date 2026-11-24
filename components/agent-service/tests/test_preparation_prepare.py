# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The preparation entry: the recorded §5.1 order, the failure-class matrix.

Every row of the failure-class matrix lands here, against a REAL
langdetect (seeded for determinism — production stays unseeded) and the
REAL vendored registry; the translation endpoint is faked at the transport
seam. The three failure classes are asserted DISTINCT: the refusal RAISES,
the degraded classes RETURN unprepared — no single fallback exists.
"""

import asyncio
import dataclasses

import pytest
from conftest import ARABIC_SAMPLE, FRENCH_SAMPLE, VENDORED_REGISTRY_PATH, PreparationFakeTransport
from conftest import preparation_model_entry as _model_entry
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

import tracing as tracing_module
from capabilities.contract import PreparedQuery, QueryPreparationStatus
from preparation import PreparationConfig, QueryPreparer
from preparation.registry import LanguageRegistry
from preparation.translation import (
    TranslationClient,
    TranslationInputTooLongError,
)

VENDORED_REGISTRY = VENDORED_REGISTRY_PATH

ENGLISH_HISTORY_BLOB = "Hello, how does the city of Geneva manage public transport for residents and visitors?"


pytestmark = pytest.mark.usefixtures("seeded_langdetect")


def _config(**overrides) -> PreparationConfig:
    base = PreparationConfig.load(
        env={"VLLM_TRANSLATION_ENDPOINT": "http://translation.invalid", "OPENAI_API_KEY": "sk-test"}
    )
    return dataclasses.replace(base, **overrides)


def _translating_transport(translated=ENGLISH_HISTORY_BLOB, window=8192):
    """A fake translation endpoint: window discovery, an answerable /tokenize,
    and a canned English translation."""
    return PreparationFakeTransport(
        {
            "http://translation.invalid/v1/models": _model_entry(max_model_len=window),
            "http://translation.invalid/tokenize": (200, {"count": 40}),
            "http://translation.invalid/v1/chat/completions": (
                200,
                {"choices": [{"message": {"content": translated}, "finish_reason": "stop"}]},
            ),
            "http://translation.invalid/v1/completions": (
                200,
                {"choices": [{"text": translated, "finish_reason": "stop"}]},
            ),
        }
    )


def _preparer(config=None, transport=None) -> QueryPreparer:
    config = config or _config()
    registry = LanguageRegistry(config.registry_path)
    translator = TranslationClient(config, registry, transport=transport or _translating_transport())
    return QueryPreparer(config, registry, translator)


def _message_list(*contents):
    return [{"role": "user" if i % 2 == 0 else "assistant", "content": c} for i, c in enumerate(contents)]


# --- the happy matrix ---


def test_named_english_with_english_history_passes_through():
    result = asyncio.run(_preparer().prepare("USER: How does Geneva manage transport?", "en"))

    assert result.status is QueryPreparationStatus.PASSTHROUGH_ENGLISH
    assert result.query is not None
    assert isinstance(result.query, PreparedQuery)
    assert result.query.text == "How does Geneva manage transport?"
    assert result.query.preparation_status is result.status
    assert result.history_text == "USER: How does Geneva manage transport?"
    assert result.language == "EN"


def test_named_non_english_history_is_translated_and_the_query_is_the_translated_segment():
    blob = "USER: Bonjour |<-MSG->| ASSISTANT: Salut |<-MSG->| USER: Comment gérer les transports ?"
    result = asyncio.run(
        _preparer(transport=_translating_transport(translated=blob)).prepare(
            _message_list("Bonjour", "Salut", "Comment gérer les transports ?"), "fr"
        )
    )

    assert result.status is QueryPreparationStatus.TRANSLATED
    assert result.language == "FR"
    assert result.history_text == blob
    # The query is the last USER segment of the TRANSLATED blob, never of
    # the source text.
    assert result.query.text == "Comment gérer les transports ?"
    assert result.prepared


def test_no_name_detectable_last_user_message_drives_the_history_language():
    result = asyncio.run(_preparer().prepare(_message_list("Hi", "Hello there", FRENCH_SAMPLE)))

    assert result.status is QueryPreparationStatus.TRANSLATED
    assert result.language == "FR"
    assert result.query is not None


def test_the_arabic_non_latin_sample_is_detected_and_translated():
    """V02 §5.6 sample family: a non-Latin script detects and translates."""
    result = asyncio.run(_preparer().prepare(ARABIC_SAMPLE))

    assert result.status is QueryPreparationStatus.TRANSLATED
    assert result.language == "AR"
    assert result.query is not None
    assert result.query.text == ENGLISH_HISTORY_BLOB


def test_a_detected_code_the_map_does_not_key_still_translates(monkeypatch):
    """'zh-cn': the code names the source for the history rule; the history
    is translated to English regardless (the prompt does not carry it)."""
    import preparation.detection as detection_module

    monkeypatch.setattr(detection_module, "detect", lambda text: "zh-cn")
    transport = _translating_transport()
    result = asyncio.run(_preparer(transport=transport).prepare("任何文字"))

    assert result.status is QueryPreparationStatus.TRANSLATED
    assert result.language == "ZH-CN"
    assert result.query is not None


def test_an_unmapped_source_code_is_never_written_into_a_gemma_prompt(monkeypatch):
    import preparation.detection as detection_module

    monkeypatch.setattr(detection_module, "detect", lambda text: "zh-cn")
    config = _config(model_id="google/translategemma")
    transport = _translating_transport()
    registry = LanguageRegistry(config.registry_path)
    preparer = QueryPreparer(config, registry, TranslationClient(config, registry, transport=transport))
    asyncio.run(preparer.prepare("任何文字"))

    post = next(c for c in transport.calls if c["url"].endswith("/v1/completions"))
    assert "zh-cn" not in post["payload"]["prompt"]


def test_nothing_named_nothing_detected_returns_unprepared():
    result = asyncio.run(_preparer().prepare("   "))

    assert result.status is QueryPreparationStatus.PASSTHROUGH_UNKNOWN_LANGUAGE
    assert result.query is None
    assert not result.prepared


def test_a_detection_crash_is_treated_as_no_detection(monkeypatch):
    import preparation.detection as detection_module

    def explode(text):
        raise RuntimeError("detector exploded")

    monkeypatch.setattr(detection_module, "detect", explode)
    result = asyncio.run(_preparer().prepare(FRENCH_SAMPLE))

    assert result.status is QueryPreparationStatus.PASSTHROUGH_UNKNOWN_LANGUAGE
    assert result.query is None


# --- the three failure classes, DISTINCT ---


def test_oversized_single_message_raises_the_refusal():
    config = _config(max_translation_chars=100, max_translation_chars_cap=100)
    with pytest.raises(TranslationInputTooLongError):
        asyncio.run(_preparer(config).prepare("x" * 150, "en"))


def test_the_refusal_is_raised_before_the_language_map():
    """The refusal must not depend on registry health: a MISSING registry and
    an oversized non-English input still raise the typed refusal (an
    implementation that read the registry first would answer fallback_error)."""
    config = _config(
        registry_path="/nonexistent/registry.json", max_translation_chars=100, max_translation_chars_cap=100
    )
    with pytest.raises(TranslationInputTooLongError):
        asyncio.run(_preparer(config).prepare("Bonjour " * 30, "fr"))


def test_oversized_list_shape_never_refuses_at_the_char_budget():
    config = _config(max_translation_chars=100, max_translation_chars_cap=100)
    transport = _translating_transport()
    registry = LanguageRegistry(config.registry_path)
    preparer = QueryPreparer(config, registry, TranslationClient(config, registry, transport=transport))
    history = _message_list("A" * 90, "B" * 90, "C" * 90)
    result = asyncio.run(preparer.prepare(history, "fr"))

    assert result.status is QueryPreparationStatus.TRANSLATED
    # The newest message's tail was truncated to the budget (100 - 20 = 80).
    post = next(c for c in transport.calls if c["url"].endswith("/v1/chat/completions"))
    assert "C" * 80 in post["payload"]["messages"][0]["content"]


def test_a_translation_window_overflow_refuses_either_shape(monkeypatch):
    """The completion cap finds no room in the window → the typed refusal,
    NO untranslated fallback — the list shape refuses at the window too."""
    config = _config()
    transport = PreparationFakeTransport(
        {
            "http://translation.invalid/v1/models": _model_entry(max_model_len=8192),
            # 7999 prompt tokens: room = 8192 - 7999 - 128 < 256.
            "http://translation.invalid/tokenize": (200, {"count": 7999}),
            "http://translation.invalid/v1/chat/completions": (
                200,
                {"choices": [{"message": {"content": ENGLISH_HISTORY_BLOB}, "finish_reason": "stop"}]},
            ),
        }
    )
    history = _message_list("x" * 400)
    with pytest.raises(TranslationInputTooLongError):
        asyncio.run(_preparer(config, transport).prepare(history, "fr"))


def test_a_server_overflow_rejection_refuses_instead_of_falling_back(monkeypatch):
    config = _config()
    transport = PreparationFakeTransport(
        {
            "http://translation.invalid/v1/models": _model_entry(),
            "http://translation.invalid/tokenize": (200, {"count": 40}),
            "http://translation.invalid/v1/chat/completions": (
                400,
                {"error": {"message": "This model's maximum context length is 8192 tokens"}},
            ),
        }
    )
    with pytest.raises(TranslationInputTooLongError):
        asyncio.run(_preparer(config, transport).prepare(_message_list(FRENCH_SAMPLE), "fr"))


def test_a_timeout_returns_unprepared_with_the_timeout_status():
    import httpx

    config = _config()
    transport = PreparationFakeTransport(error=httpx.TimeoutException("read timed out"))
    result = asyncio.run(_preparer(config, transport).prepare(FRENCH_SAMPLE, "fr"))

    assert result.status is QueryPreparationStatus.FALLBACK_TIMEOUT
    assert result.query is None
    assert not result.prepared


def test_a_transport_failure_returns_unprepared_with_the_error_status():
    config = _config()
    transport = PreparationFakeTransport(error=ConnectionError("endpoint down"))
    result = asyncio.run(_preparer(config, transport).prepare(FRENCH_SAMPLE, "fr"))

    assert result.status is QueryPreparationStatus.FALLBACK_ERROR
    assert result.query is None


def test_a_server_5xx_returns_unprepared_with_the_error_status():
    config = _config()
    transport = PreparationFakeTransport(
        {
            "http://translation.invalid/v1/models": _model_entry(),
            "http://translation.invalid/tokenize": (200, {"count": 40}),
            "http://translation.invalid/v1/chat/completions": (500, {}),
        }
    )
    result = asyncio.run(_preparer(config, transport).prepare(FRENCH_SAMPLE, "fr"))
    assert result.status is QueryPreparationStatus.FALLBACK_ERROR


def test_a_malformed_body_returns_unprepared_with_the_error_status():
    config = _config()
    transport = PreparationFakeTransport(
        {
            "http://translation.invalid/v1/models": _model_entry(),
            "http://translation.invalid/tokenize": (200, {"count": 40}),
            "http://translation.invalid/v1/chat/completions": (200, {"no": "choices"}),
        }
    )
    result = asyncio.run(_preparer(config, transport).prepare(FRENCH_SAMPLE, "fr"))
    assert result.status is QueryPreparationStatus.FALLBACK_ERROR


def test_the_degraded_classes_carry_the_source_text_under_an_unprepared_status():
    """V02 §5.4 shape carries over as degradation-reported-to-caller; the
    source text is never dressed as prepared."""
    config = _config()
    transport = PreparationFakeTransport(error=ConnectionError("endpoint down"))
    result = asyncio.run(_preparer(config, transport).prepare(FRENCH_SAMPLE, "fr"))

    assert result.history_text == FRENCH_SAMPLE
    assert result.status is QueryPreparationStatus.FALLBACK_ERROR


def test_a_blank_completion_is_a_failure_never_a_silent_success():
    config = _config()
    transport = _translating_transport(translated="   ")
    result = asyncio.run(_preparer(config, transport).prepare(FRENCH_SAMPLE, "fr"))
    assert result.status is QueryPreparationStatus.FALLBACK_ERROR


def test_a_truncated_completion_is_a_failure():
    config = _config()
    transport = PreparationFakeTransport(
        {
            "http://translation.invalid/v1/models": _model_entry(),
            "http://translation.invalid/tokenize": (200, {"count": 40}),
            "http://translation.invalid/v1/chat/completions": (
                200,
                {"choices": [{"message": {"content": "half a translat"}, "finish_reason": "length"}]},
            ),
        }
    )
    result = asyncio.run(_preparer(config, transport).prepare(FRENCH_SAMPLE, "fr"))
    assert result.status is QueryPreparationStatus.FALLBACK_ERROR


def test_the_three_failure_classes_stay_distinct():
    """Refusal RAISES; timeout → fallback_timeout; failure → fallback_error;
    unknown language → passthrough_unknown_language. No single fallback."""
    config = _config()

    # 1. oversized → raises.
    small = _config(max_translation_chars=100, max_translation_chars_cap=100)
    with pytest.raises(TranslationInputTooLongError):
        asyncio.run(_preparer(small).prepare("x" * 150, "en"))

    # 2. translator unavailable → unprepared, timeout status.
    timeout = _preparer(config, PreparationFakeTransport(error=TimeoutError()))
    timed_out = asyncio.run(timeout.prepare(FRENCH_SAMPLE, "fr"))
    assert timed_out.status is QueryPreparationStatus.FALLBACK_TIMEOUT

    # 3. blank translation → unprepared, error status.
    blank = _preparer(config, _translating_transport(translated=""))
    failed = asyncio.run(blank.prepare(FRENCH_SAMPLE, "fr"))
    assert failed.status is QueryPreparationStatus.FALLBACK_ERROR

    # 4. no language → unprepared, unknown status.
    unknown = asyncio.run(_preparer(config).prepare("   "))
    assert unknown.status is QueryPreparationStatus.PASSTHROUGH_UNKNOWN_LANGUAGE

    statuses = {timed_out.status, failed.status, unknown.status}
    assert len(statuses) == 3
    for result in (timed_out, failed, unknown):
        assert result.query is None, "no degraded class may carry a PreparedQuery"


# --- the blank guards ---


def test_an_established_english_blank_downgrades_to_fallback_error():
    result = asyncio.run(_preparer().prepare("   ", "en"))
    assert result.status is QueryPreparationStatus.FALLBACK_ERROR
    assert result.query is None


def test_an_established_english_all_blank_list_downgrades_to_fallback_error():
    result = asyncio.run(_preparer().prepare([{"role": "user", "content": "   "}], "en"))
    assert result.status is QueryPreparationStatus.FALLBACK_ERROR


def test_a_blank_without_an_established_language_stays_unknown():
    result = asyncio.run(_preparer().prepare("   "))
    assert result.status is QueryPreparationStatus.PASSTHROUGH_UNKNOWN_LANGUAGE
    assert result.query is None


def test_an_all_blank_list_without_a_language_stays_unknown():
    result = asyncio.run(_preparer().prepare([{"role": "user", "content": ""}]))
    assert result.status is QueryPreparationStatus.PASSTHROUGH_UNKNOWN_LANGUAGE


# --- empty history ---


def test_an_empty_list_with_a_named_language_is_fallback_error_with_empty_text():
    named_en = asyncio.run(_preparer().prepare([], "en"))
    assert named_en.status is QueryPreparationStatus.FALLBACK_ERROR
    assert named_en.history_text == ""
    assert named_en.query is None

    named_fr = asyncio.run(_preparer().prepare([], "fr"))
    assert named_fr.status is QueryPreparationStatus.FALLBACK_ERROR
    assert named_fr.history_text == ""


def test_an_empty_list_without_a_language_stays_unknown():
    result = asyncio.run(_preparer().prepare([]))
    assert result.status is QueryPreparationStatus.PASSTHROUGH_UNKNOWN_LANGUAGE
    assert result.history_text == ""


def test_an_empty_string_with_a_language_is_fallback_error():
    assert asyncio.run(_preparer().prepare("", "en")).status is QueryPreparationStatus.FALLBACK_ERROR
    assert asyncio.run(_preparer().prepare("", "fr")).status is QueryPreparationStatus.FALLBACK_ERROR


def test_an_empty_string_without_a_language_stays_unknown():
    assert asyncio.run(_preparer().prepare("")).status is QueryPreparationStatus.PASSTHROUGH_UNKNOWN_LANGUAGE


# --- the registry at translation time ---


def test_an_unreadable_registry_at_translation_time_is_fallback_error():
    """English target name unresolvable → the deployed 'map does not know
    English' branch: returned UNPREPARED with fallback_error, never a
    crash, retried after the 60 s window."""
    config = _config(registry_path="/nonexistent/registry.json")
    result = asyncio.run(_preparer(config).prepare(FRENCH_SAMPLE, "fr"))

    assert result.status is QueryPreparationStatus.FALLBACK_ERROR
    assert result.query is None
    assert result.history_text is not None


# --- cancellation ---


def test_a_cancellation_mid_translation_propagates_untouched():
    """Cancelled while the translation call is in flight: CancelledError
    propagates — never caught, never mapped to any status."""
    config = _config()
    transport = PreparationFakeTransport(error=asyncio.CancelledError())
    registry = LanguageRegistry(config.registry_path)
    preparer = QueryPreparer(config, registry, TranslationClient(config, registry, transport=transport))

    async def cancelled_mid_flight():
        task = asyncio.ensure_future(preparer.prepare(FRENCH_SAMPLE, "fr"))
        await asyncio.sleep(0)  # let the task reach the translation call
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            return "cancelled"
        return "completed"

    assert asyncio.run(cancelled_mid_flight()) == "cancelled"


# --- refined mid-loop queries: one code path ---


def test_a_refined_query_gets_identical_treatment():
    """Query-only (no history, no name) through the SAME entry: the same
    detection, budget, translation and statuses as the initial request."""
    preparer = _preparer()

    initial = asyncio.run(preparer.prepare(FRENCH_SAMPLE, "fr"))
    refined = asyncio.run(preparer.prepare(FRENCH_SAMPLE, "fr"))

    assert refined.status is initial.status
    assert refined.query.text == initial.query.text
    assert refined.language == initial.language
    assert refined.history_text == initial.history_text

    unnamed_initial = asyncio.run(preparer.prepare(FRENCH_SAMPLE))
    unnamed_refined = asyncio.run(preparer.prepare(FRENCH_SAMPLE))
    assert unnamed_refined.status is unnamed_initial.status is QueryPreparationStatus.TRANSLATED
    assert unnamed_refined.query.text == unnamed_initial.query.text
    assert unnamed_refined.language == unnamed_initial.language == "FR"


# --- the span ---


def test_prepare_emits_a_span_carrying_the_status():
    """The `preparation.prepare` span with `query_translation_status`, on the
    test_tracing.py pattern (InMemorySpanExporter assertions).

    The provider is local to this test, NOT registered globally: OTel's
    `set_tracer_provider` ignores every call after the first, so a test that
    registered a global provider would starve every later tracing test of
    its spans (the full-suite pollution this shape exists to avoid).
    """
    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    patch = pytest.MonkeyPatch()
    patch.setattr(tracing_module, "get_tracer", lambda tracer_name="": provider.get_tracer(tracer_name))
    try:
        result = asyncio.run(_preparer().prepare(FRENCH_SAMPLE, "fr"))
        provider.force_flush()

        spans = [s for s in exporter.get_finished_spans() if s.name == "preparation.prepare"]
        assert len(spans) == 1
        assert spans[0].attributes["query_translation_status"] == result.status.value
    finally:
        patch.undo()
        provider.shutdown()
