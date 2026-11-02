# Copyright (C) 2025-2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0

"""K.2 llm-settings consumer pins (dataprep side — ingest prompts).

The label-selector and contextual-retrieval prompts read
llm-settings.json per ingest call (file over the env-seeded default);
edits apply at the NEXT re-ingestion. Pins: file-over-default
precedence at both consumer sites, {labels_list}/{document_context}
substitution, the no-drift seed law, and loud degradation to the coded
defaults when the file is missing.
"""

import asyncio
import json
import logging
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

import dataprep.genieai_dataprep_arangodb as dp_module
from core import pipeline_settings as ps

REPO_ROOT = Path(__file__).resolve().parents[2]
SEED_PATH = REPO_ROOT / "configs" / "pipeline" / "llm-settings.seed.json"
ENV_VAR = "LLM_SETTINGS_CONFIG"


@pytest.fixture(autouse=True)
def _isolated_settings(tmp_path, monkeypatch):
    monkeypatch.delenv(ENV_VAR, raising=False)
    ps._cache.clear()
    yield
    ps._cache.clear()


def _write_settings(doc: dict, tmp_path, monkeypatch) -> Path:
    file = tmp_path / "llm-settings.json"
    file.write_text(json.dumps(doc), encoding="utf-8")
    monkeypatch.setenv(ENV_VAR, str(file))
    return file


def _make_dataprep():
    dp = dp_module.GenieArangoDataprep.__new__(dp_module.GenieArangoDataprep)
    dp.db = MagicMock()
    dp.embeddings = MagicMock()
    dp.graph = MagicMock()
    dp.llm_transformer = MagicMock()
    dp._log_semaphore = asyncio.Semaphore(100)
    dp._initialize_llm = MagicMock()
    dp._initialize_embeddings = MagicMock()
    return dp


# ---------------------------------------------------------------------------
# No-drift law + loud degradation.
# ---------------------------------------------------------------------------


class TestIngestSeedNoDrift:
    def test_seed_matches_coded_defaults(self):
        seed = json.loads(SEED_PATH.read_text(encoding="utf-8"))
        assert seed["ingest"]["labelSelectorPrompt"] == dp_module._LLM_INGEST_DEFAULTS["ingest"]["labelSelectorPrompt"]
        assert seed["ingest"]["contextualRetrievalPrompt"] == dp_module._LLM_INGEST_DEFAULTS["ingest"]["contextualRetrievalPrompt"]
        # The seeded prompts carry the placeholders the consumers substitute.
        assert "{labels_list}" in seed["ingest"]["labelSelectorPrompt"]
        assert "{document_context}" in seed["ingest"]["contextualRetrievalPrompt"]

    def test_missing_file_degrades_loud_to_defaults(self, tmp_path, monkeypatch, caplog):
        monkeypatch.setenv(ENV_VAR, str(tmp_path / "missing.json"))
        with caplog.at_level(logging.WARNING, logger="core.pipeline_settings"):
            settings = ps.load_settings(ENV_VAR, dp_module._LLM_INGEST_DEFAULTS)
        assert settings is dp_module._LLM_INGEST_DEFAULTS
        assert "missing.json" in caplog.text


    def test_wrong_typed_ingest_fields_degrade_loud(self, tmp_path, monkeypatch, caplog):
        # K.1 never-crash law: a parseable file with a wrong-typed prompt
        # must not TypeError at the .replace() consumer.
        for bad_doc in (
            {"ingest": {"labelSelectorPrompt": 5}},
            {"ingest": {"contextualRetrievalPrompt": []}},
            {"ingest": "nope"},
        ):
            caplog.clear()
            _write_settings(bad_doc, tmp_path, monkeypatch)
            real_logger = logging.getLogger("dataprep.genieai_dataprep_arangodb")
            with (
                patch.object(dp_module, "logger", real_logger),
                caplog.at_level(logging.WARNING, logger="dataprep.genieai_dataprep_arangodb"),
            ):
                prompts = dp_module._ingest_prompts()
            assert prompts is dp_module._LLM_INGEST_DEFAULTS["ingest"], bad
            assert isinstance(prompts["labelSelectorPrompt"], str)
            assert "wrong-typed" in caplog.text


# ---------------------------------------------------------------------------
# Label-selector prompt site (_label_with_llm).
# ---------------------------------------------------------------------------


class TestLabelSelectorPrompt:
    @pytest.mark.asyncio
    async def test_file_prompt_reaches_the_llm_call(self, tmp_path, monkeypatch):
        _write_settings({"ingest": {"labelSelectorPrompt": "FILE LABEL PROMPT {labels_list}"}}, tmp_path, monkeypatch)
        monkeypatch.setenv("VLLM_API_KEY", "test-key")
        monkeypatch.setenv("VLLM_ENDPOINT", "http://localhost:8000")
        monkeypatch.setenv("VLLM_MODEL_ID", "test-model")

        mock_response = MagicMock()
        mock_response.choices = [MagicMock()]
        mock_response.choices[0].message.content = json.dumps({"labels": ["Healthcare"]})
        mock_client = AsyncMock()
        mock_client.chat.completions.create = AsyncMock(return_value=mock_response)

        dp = _make_dataprep()
        with (
            patch.object(dp_module, "AsyncOpenAI", return_value=mock_client),
            patch.object(dp, "_write_ingestion_log", new_callable=AsyncMock),
        ):
            await dp._label_with_llm(["test chunk"], ["Healthcare"], [], "file1")

        content = mock_client.chat.completions.create.call_args.kwargs["messages"][0]["content"]
        assert content.startswith("FILE LABEL PROMPT")
        assert "Healthcare" in content  # {labels_list} substituted

    @pytest.mark.asyncio
    async def test_edit_visible_on_next_call_same_path(self, tmp_path, monkeypatch):
        file = _write_settings({"ingest": {"labelSelectorPrompt": "FIRST {labels_list}"}}, tmp_path, monkeypatch)
        monkeypatch.setenv("VLLM_API_KEY", "test-key")
        monkeypatch.setenv("VLLM_ENDPOINT", "http://localhost:8000")
        monkeypatch.setenv("VLLM_MODEL_ID", "test-model")

        mock_response = MagicMock()
        mock_response.choices = [MagicMock()]
        mock_response.choices[0].message.content = json.dumps({"labels": []})
        mock_client = AsyncMock()
        mock_client.chat.completions.create = AsyncMock(return_value=mock_response)

        dp = _make_dataprep()
        with (
            patch.object(dp_module, "AsyncOpenAI", return_value=mock_client),
            patch.object(dp, "_write_ingestion_log", new_callable=AsyncMock),
        ):
            await dp._label_with_llm(["chunk"], ["L"], [], "f")
            first = mock_client.chat.completions.create.call_args.kwargs["messages"][0]["content"]
            Path(file).write_text(json.dumps({"ingest": {"labelSelectorPrompt": "SECOND {labels_list}"}}), encoding="utf-8")
            await dp._label_with_llm(["chunk"], ["L"], [], "f")
            second = mock_client.chat.completions.create.call_args.kwargs["messages"][0]["content"]
        assert first.startswith("FIRST")
        assert second.startswith("SECOND")


# ---------------------------------------------------------------------------
# Contextual-retrieval prompt site (_apply_contextualization, per_chunk path).
# ---------------------------------------------------------------------------


class TestContextualPrompt:
    @pytest.mark.asyncio
    async def test_file_prompt_reaches_per_chunk_contextualization(self, tmp_path, monkeypatch):
        _write_settings({"ingest": {"contextualRetrievalPrompt": "FILE CTX PROMPT {document_context}"}}, tmp_path, monkeypatch)
        dp = _make_dataprep()
        captured = {}

        async def fake_per_chunk(client, model, system_prompt, chunks, file_id, total):
            captured["system_prompt"] = system_prompt
            return list(chunks)

        with (
            patch.object(dp_module, "CONTEXTUAL_STRATEGY", "per_chunk"),
            patch.object(dp_module, "_build_vllm_client", return_value=(MagicMock(), "model")),
            patch.object(dp, "_build_doc_context", return_value="DOC-CTX"),
            patch.object(dp, "_contextualize_per_chunk", side_effect=fake_per_chunk),
        ):
            await dp._apply_contextualization(["chunk text"], MagicMock(), "file1")

        assert captured["system_prompt"] == "FILE CTX PROMPT DOC-CTX"

    @pytest.mark.asyncio
    async def test_default_when_file_absent(self, tmp_path, monkeypatch):
        monkeypatch.setenv(ENV_VAR, str(tmp_path / "missing.json"))
        dp = _make_dataprep()
        captured = {}

        async def fake_per_chunk(client, model, system_prompt, chunks, file_id, total):
            captured["system_prompt"] = system_prompt
            return list(chunks)

        with (
            patch.object(dp_module, "CONTEXTUAL_STRATEGY", "per_chunk"),
            patch.object(dp_module, "_build_vllm_client", return_value=(MagicMock(), "model")),
            patch.object(dp, "_build_doc_context", return_value="DOC-CTX"),
            patch.object(dp, "_contextualize_per_chunk", side_effect=fake_per_chunk),
        ):
            await dp._apply_contextualization(["chunk text"], MagicMock(), "file1")

        assert captured["system_prompt"] == dp_module.CONTEXTUAL_RETRIEVAL_PROMPT.replace(
            "{document_context}", "DOC-CTX"
        )
