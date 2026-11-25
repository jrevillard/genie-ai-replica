# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The ported detection: langdetect on the last user message, crash-safe.

langdetect is UNSEEDED in production (deployed parity — the record notes the
detector is non-deterministic). These tests seed ``DetectorFactory`` for
stability only; the production module never seeds, and the non-Latin sample
detects robustly enough for the REAL detector to carry the test.
"""

from pathlib import Path

import pytest
from conftest import ARABIC_SAMPLE, FRENCH_SAMPLE

from preparation import detection

pytestmark = pytest.mark.usefixtures("seeded_langdetect")


def test_production_detection_is_never_seeded():
    """A seed in the production module would diverge from the deployed
    detector (the detector is non-deterministic by design). The check
    reads the module's AST, not its prose — the docstring is allowed to
    mention the seeding, the code is not."""
    import ast

    tree = ast.parse(Path(detection.__file__).read_text())
    for node in ast.walk(tree):
        names = [n.id for n in ast.walk(node) if isinstance(n, ast.Name) and isinstance(n.ctx, ast.Load)]
        attrs = [n.attr for n in ast.walk(node) if isinstance(n, ast.Attribute)]
        assert not any("DetectorFactory" in name for name in names), "the production module must not seed the detector"
        assert "seed" not in attrs


def test_the_french_v02_sample_detects_french():
    """The recorded locale sample family (shape, not wording)."""
    assert detection.detect_language(FRENCH_SAMPLE) == "FR"


def test_the_arabic_non_latin_sample_detects_arabic():
    """The non-Latin recorded sample — detected with the REAL detector."""
    assert detection.detect_language(ARABIC_SAMPLE) == "AR"


def test_english_detects_english():
    assert detection.detect_language("How does the city of Geneva manage public transport services?") == "EN"


def test_a_list_history_detects_the_last_user_message():
    history = [
        {"role": "user", "content": "Good morning, how are you?"},
        {"role": "assistant", "content": "Je vais bien, merci !"},
        {"role": "user", "content": "Comment gère-t-on les transports publics à Genève ?"},
    ]
    assert detection.detect_language(history) == "FR"


def test_a_list_without_a_user_message_detects_nothing():
    history = [{"role": "assistant", "content": "Bonjour !"}]
    assert detection.detect_language(history) is None


def test_blank_content_detects_nothing():
    assert detection.detect_language("") is None
    assert detection.detect_language("   ") is None
    assert detection.detect_language([]) is None
    assert detection.detect_language([{"role": "user", "content": "  "}]) is None


def test_a_string_history_is_detected_as_a_whole():
    assert detection.detect_language("¿Como gestiona la ciudad de Barcelona los servicios de transporte?") == "ES"


def test_a_detection_crash_is_no_detection():
    """langdetect raising must never reach the caller: the history side then
    has no detected code and the caller classifies passthrough_unknown."""
    original = detection.detect
    detection.detect = lambda text: (_ for _ in ()).throw(RuntimeError("detector exploded"))
    try:
        assert detection.detect_language("Bonjour tout le monde") is None
    finally:
        detection.detect = original


def test_detected_codes_are_upper_canonical(monkeypatch):
    """The uppercase rule: 'fr' → 'FR'; a dialect code the map does not key
    still names the source ('zh-cn' → 'ZH-CN')."""
    monkeypatch.setattr(detection, "detect", lambda text: "zh-cn")
    assert detection.detect_language("任何文字") == "ZH-CN"
    monkeypatch.setattr(detection, "detect", lambda text: "fr")
    assert detection.detect_language("bonjour") == "FR"


def test_resolve_named_language_canonicalises_the_named_code():
    codes = {"en": "English", "fr": "French", "st": "Sesotho"}
    assert detection.resolve_named_language("fr", codes) == "FR"
    # The trim comes FIRST: a padded language still names itself.
    assert detection.resolve_named_language("  fr  ", codes) == "FR"
    assert detection.resolve_named_language("EN", codes) == "EN"


def test_resolve_named_language_refuses_what_is_not_a_language():
    codes = {"en": "English", "fr": "French"}
    assert detection.resolve_named_language(None, codes) is None
    assert detection.resolve_named_language(42, codes) is None
    assert detection.resolve_named_language("", codes) is None
    assert detection.resolve_named_language("   ", codes) is None
    assert detection.resolve_named_language("auto", codes) is None
    # A code the map does not know is not accepted here (the BFF has already
    # refused it with HTTP 400 — the refused branch is unreachable).
    assert detection.resolve_named_language("xx", codes) is None


def test_a_long_caller_value_is_cut_before_it_is_judged():
    """Trim, then cut to 32, then lowercase — the backend's order, so a
    language the caller padded with spaces still names itself."""
    codes = {"en": "English"}
    padded = "  " + "en"
    assert detection.resolve_named_language(padded, codes) == "EN"
    # A value that only becomes garbage after the cut is refused, never
    # partially matched.
    garbage = "f" * 40
    assert detection.resolve_named_language(garbage, {}) is None
