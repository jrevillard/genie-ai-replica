# Copyright (c) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""Contract: the BM25 analyzer must speak the corpus language.

The lexical leg analyzes chunk text with ``RETRIEVER_HYBRID_BM25_ANALYZER``
(default ``text_en``, read in ``retriever/config.py``); the corpus side is
kept English by the document-repository ingest gate
``DOCUMENT_INGESTION_LANGUAGE`` (default ``en``). The two must move together:
a non-English analyzer against an English corpus stems and stop-words the
wrong morphology and the BM25 leg degrades to noise. Rationale, probe results
and the view delete+recreate procedure:
``site/content/en/docs/architecture/multilingual-ssot.md``.

This test pins the CONFIGURATION CONSISTENCY rule only — analyzer runtime
behaviour is out of scope (no ArangoDB, no models).
"""

import importlib.util
import os
import re
from pathlib import Path

import pytest

CONFIG_PATH = Path(__file__).resolve().parents[1] / "retriever" / "config.py"

ANALYZER_ENV_NAME = "RETRIEVER_HYBRID_BM25_ANALYZER"
INGEST_LANGUAGE_ENV_NAME = "DOCUMENT_INGESTION_LANGUAGE"


def _load_resolved_analyzer(monkeypatch, analyzer_value):
    """Resolve HYBRID_BM25_ANALYZER from retriever/config.py with analyzer_value (None = unset)."""
    if analyzer_value is None:
        monkeypatch.delenv(ANALYZER_ENV_NAME, raising=False)
    else:
        monkeypatch.setenv(ANALYZER_ENV_NAME, analyzer_value)
    spec = importlib.util.spec_from_file_location("retriever_config_analyzer_under_test", CONFIG_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.HYBRID_BM25_ANALYZER


def _analyzer_language(analyzer):
    """Language code a text analyzer name carries (``text_en`` -> ``en``), else None."""
    match = re.search(r"_([a-z]{2,3})(?:$|@)", analyzer.lower())
    return match.group(1) if match else None


def _assert_analyzer_matches_corpus_language(analyzer, ingestion_language):
    """Fail when the analyzer targets a language other than the corpus language."""
    analyzer_language = _analyzer_language(analyzer)
    if analyzer_language is not None and analyzer_language != ingestion_language:
        pytest.fail(
            f"BM25 analyzer {analyzer!r} targets {analyzer_language!r} but the ingest language "
            f"gate keeps the corpus in {ingestion_language!r} ({INGEST_LANGUAGE_ENV_NAME}). The "
            "analyzer and the corpus language must move together, and the ArangoSearch view must "
            "be recreated (see site/content/en/docs/architecture/multilingual-ssot.md)."
        )


def test_deployment_configuration_keeps_analyzer_and_corpus_language_aligned():
    """The environment this test runs in must not pair a non-English analyzer with the English gate."""
    analyzer = os.getenv(ANALYZER_ENV_NAME, "text_en")
    ingestion_language = os.getenv(INGEST_LANGUAGE_ENV_NAME, "en")
    _assert_analyzer_matches_corpus_language(analyzer, ingestion_language.lower())


def test_defaults_are_consistent(monkeypatch):
    # Neither var set — the shipped default pair must satisfy the rule. This is
    # what fails if someone flips the text_en default in retriever/config.py.
    monkeypatch.delenv(INGEST_LANGUAGE_ENV_NAME, raising=False)
    analyzer = _load_resolved_analyzer(monkeypatch, None)
    _assert_analyzer_matches_corpus_language(analyzer, "en")


def test_non_english_analyzer_with_english_gate_is_flagged(monkeypatch):
    # The regression the rule exists for: analyzer switched to a non-English
    # text analyzer while the ingest gate stays on its English default.
    monkeypatch.delenv(INGEST_LANGUAGE_ENV_NAME, raising=False)
    with pytest.raises(pytest.fail.Exception, match="targets 'es'"):
        _assert_analyzer_matches_corpus_language("text_es", "en")


def test_analyzer_moving_with_the_gate_is_consistent(monkeypatch):
    # Both sides reconfigured together is the documented, legitimate path.
    analyzer = _load_resolved_analyzer(monkeypatch, "text_es")
    _assert_analyzer_matches_corpus_language(analyzer, "es")
