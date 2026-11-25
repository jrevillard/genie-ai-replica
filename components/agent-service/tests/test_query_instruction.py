# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The query-instruction contract, asserted against the recorded contract.

The recorded contract (fixtures: ``query_instruction``): the instruction is
MODEL-SPECIFIC — deployer overrides first (first match wins), the built-in
table second (first match wins, most specific first), a model with no entry
gets NO prefix, and the prefix applies to the query only.
"""

import asyncio
import json
from pathlib import Path

import pytest

from capabilities.adapters.query_instruction import (
    DEFAULT_EMBED_MODEL,
    _parse_query_instructions,
    get_query_instruction,
    resolve_embed_model,
)

FIXTURES = Path(__file__).resolve().parents[3] / "docs" / "baselines" / "v02-opea-query-path-contract.fixtures.json"


def _expected_instruction() -> str:
    fixtures = json.loads(FIXTURES.read_text())
    return fixtures["expectations"]["behaviors"]["query_instruction"]["expected_output"]["resolved_instruction"]


def test_recorded_default_model_resolves_the_recorded_instruction(monkeypatch):
    """The deployed model (default, no overrides) resolves the recorded instruction."""
    # The default resolution is env-independent: a host carrying its own
    # TEI_EMBED_MODEL must not turn this into a spurious failure.
    monkeypatch.delenv("TEI_EMBED_MODEL", raising=False)
    assert resolve_embed_model() == DEFAULT_EMBED_MODEL == "BAAI/bge-large-en-v1.5"
    assert get_query_instruction(resolve_embed_model(), overrides_raw="") == _expected_instruction()


def test_unset_tei_embed_model_falls_back_to_the_code_default(monkeypatch):
    monkeypatch.delenv("TEI_EMBED_MODEL", raising=False)
    assert resolve_embed_model() == "BAAI/bge-large-en-v1.5"


def test_no_prefix_models_get_no_prefix():
    """A model with no entry embeds RAW — the no-prefix branch is a contract, not a degradation."""
    for model_id in (
        "BAAI/bge-m3",
        "sentence-transformers/all-MiniLM-L6-v2",
        "mxbai-embed-large",
        "text-embedding-3-small",
    ):
        assert get_query_instruction(model_id, overrides_raw="") is None, model_id


def test_overrides_take_priority_over_the_builtin_table():
    builtin = get_query_instruction("BAAI/bge-large-en-v1.5", overrides_raw="")
    overridden = get_query_instruction(
        "BAAI/bge-large-en-v1.5", overrides_raw="BAAI/bge-large-en-v1.5=Custom instruction: "
    )
    assert builtin == "Represent this sentence for searching relevant passages: "
    assert overridden == "Custom instruction:"


def test_overrides_can_add_models_the_table_does_not_know():
    # The trailing space is stripped by the entry parser (pinned above); the
    # table's instructions carry the protocol space as code literals.
    assert get_query_instruction("my-org/bge-finetune", overrides_raw="my-org/bge-finetune=Finetune: ") == "Finetune:"


def test_builtin_table_first_match_wins_most_specific_first():
    # The zh variants must NOT receive the English instruction.
    assert get_query_instruction("BAAI/bge-large-zh-v1.5", overrides_raw="") == "为这个句子生成表示以用于检索相关文章："


def test_resolution_is_case_insensitive_on_the_substring():
    assert get_query_instruction("baai/bge-m3", overrides_raw="") is None
    assert (
        get_query_instruction("baai/BGE-LARGE-EN-v1.5", overrides_raw="")
        == "Represent this sentence for searching relevant passages: "
    )


def test_empty_or_malformed_override_entries_are_skipped():
    assert _parse_query_instructions(" ,  ,novalue, =x, k=v ") == (("k", "v"),)


def test_override_parser_strips_entry_whitespace():
    """The deployed parser strips each comma-separated entry BEFORE splitting.

    The deployed docstring claims trailing spaces are preserved, but the code
    strips the whole entry first — so an env-provided instruction loses its
    trailing space (the protocol space only survives via the built-in table).
    Behavior frozen to the code, not to the docstring.
    """
    parsed = _parse_query_instructions("m=Represent this sentence for searching relevant passages: ")
    assert parsed[0][1] == "Represent this sentence for searching relevant passages:"
    assert get_query_instruction("model-x", overrides_raw="model-x=Do search: ") == "Do search:"


def test_no_model_id_means_no_prefix():
    assert get_query_instruction(None) is None


def test_the_prefix_applies_to_the_query_only(tei_stub):
    """The embedder receives the PREFIXED text; the BM25 leg receives the RAW text."""
    embedded = tei_stub.embedded_query("How does Dubai manage public transport?")
    assert embedded.prefixed_text == (
        "Represent this sentence for searching relevant passages: How does Dubai manage public transport?"
    )
    assert embedded.raw_text == "How does Dubai manage public transport?"


@pytest.fixture()
def tei_stub(monkeypatch):
    """A TeiEmbeddingAdapter over a mock transport, no env instruction overrides."""
    import httpx

    from capabilities.adapters.tei_embedding import TeiEmbeddingAdapter

    monkeypatch.delenv("EMBEDDING_QUERY_INSTRUCTIONS", raising=False)
    monkeypatch.delenv("TEI_EMBED_MODEL", raising=False)
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["body"] = request.read()
        return httpx.Response(200, json=[[0.1, 0.2, 0.3]])

    adapter = TeiEmbeddingAdapter("https://tei.invalid/embed", transport=httpx.MockTransport(handler))
    adapter.captured = captured

    def embedded_query(text: str):
        return asyncio.run(adapter.embed(text))

    adapter.embedded_query = embedded_query
    return adapter
