# Copyright (C) 2025-2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0

"""K.2 llm-settings consumer pins (chatqna side).

Pins the file-registry contract at the consumer sites: system-prompt
assembly order (EN prefix + file base + boot self-conf suffix), both
abstention paths (file-driven, ONE deduplicated fallback), the
answer-budget clamp, the request-explicit > file > coded gen-param
precedence (the falsy-zero fix, explicit-null handling), the typed-field
never-crash guard, and the no-drift law — the committed seed equals
today's effective coded values.
"""

import importlib
import json
import logging
import sys
import types
from enum import Enum
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from pydantic import BaseModel

import chatqna.genieai_chatqna as chatqna_module
from chatqna.genieai_chatqna import (
    _ABSTENTION_INSTRUCTIONS_DEFAULT,
    _CHATQNA_SYSTEM_DEFAULT,
    _LLM_DEFAULTS,
    _resolve_llm_gen_params,
    align_inputs,
    align_outputs,
)
from core import pipeline_settings as ps

REPO_ROOT = Path(__file__).resolve().parents[2]
SEED_PATH = REPO_ROOT / "configs" / "pipeline" / "llm-settings.seed.json"
ENV_VAR = "LLM_SETTINGS_CONFIG"


class FakeServiceType(Enum):
    TRANSLATOR = "translator"
    EMBEDDING = "embedding"
    RETRIEVER = "retriever"
    RERANK = "rerank"
    LLM = "llm"


@pytest.fixture(autouse=True)
def _isolated_settings(tmp_path, monkeypatch):
    """Each test gets a fresh settings file (or none) and a cold reader cache."""
    monkeypatch.delenv(ENV_VAR, raising=False)
    ps._cache.clear()
    chatqna_module._bad_settings_ref = None
    chatqna_module._MAX_TOKENS_CLAMP_WARNED.clear()
    yield
    ps._cache.clear()


def _write_settings(doc: dict, tmp_path, monkeypatch) -> Path:
    file = tmp_path / "llm-settings.json"
    file.write_text(json.dumps(doc), encoding="utf-8")
    monkeypatch.setenv(ENV_VAR, str(file))
    return file


def _mock_tokenizer(counts=None):
    tokenizer = MagicMock()

    def mock_encode(text):
        for key, count in (counts or {}).items():
            if key in text:
                return [0] * count
        return []

    tokenizer.encode = mock_encode
    return tokenizer


# ---------------------------------------------------------------------------
# No-drift law: the committed seed IS today's effective configuration.
# ---------------------------------------------------------------------------


class TestSeedNoDrift:
    def test_seed_matches_coded_defaults(self, monkeypatch):
        # An outer CHATQNA_SYSTEM_PROMPT must not spuriously fail this pin —
        # compare against the env-immune coded literal.
        monkeypatch.delenv("CHATQNA_SYSTEM_PROMPT", raising=False)
        seed = json.loads(SEED_PATH.read_text(encoding="utf-8"))
        assert seed["version"] == 1
        assert seed["updatedBy"] == "seed"
        assert seed["systemPrompt"] == _CHATQNA_SYSTEM_DEFAULT
        assert seed["abstentionInstructions"] == _ABSTENTION_INSTRUCTIONS_DEFAULT
        assert seed["enforceAbstention"] is True
        # generation: literal pins (maxTokens is the deliberate exception —
        # the seed carries the DEPLOYED compose value 8192, not the coded
        # MAX_MODEL_LEN_TEXTGEN default 4096).
        assert seed["generation"]["temperature"] == 0.01
        assert seed["generation"]["topP"] == 0.95
        assert seed["generation"]["repetitionPenalty"] == 1.03
        assert seed["generation"]["frequencyPenalty"] == 0.0
        assert seed["generation"]["presencePenalty"] == 0.0
        assert seed["generation"]["maxTokens"] == 8192

    def test_repo_seed_serves_when_env_unset(self):
        # No env var → the K.1 reader resolves the committed seed (local
        # dev/tests), so _llm_settings() returns the seeded values verbatim.
        settings = chatqna_module._llm_settings()
        assert settings["systemPrompt"] == json.loads(SEED_PATH.read_text())["systemPrompt"]

    def test_missing_file_loud_degradation(self, tmp_path, monkeypatch, caplog):
        monkeypatch.setenv(ENV_VAR, str(tmp_path / "never-exists.json"))
        with caplog.at_level(logging.WARNING, logger="core.pipeline_settings"):
            settings = chatqna_module._llm_settings()
        assert settings == _LLM_DEFAULTS  # coded defaults, chat proceeds
        assert "never-exists.json" in caplog.text

    def test_wrong_typed_fields_degrade_whole_doc_loud(self, tmp_path, monkeypatch, caplog):
        # K.1 never-crash law: a PARSEABLE file with wrong-typed values must
        # not TypeError at the consumer (prompt concat / numeric use).
        for bad_doc, needle in [
            ({"systemPrompt": 5}, "systemPrompt"),
            ({"systemPrompt": "   "}, "systemPrompt"),  # whitespace-only = rule-less chats, same degrade
            ({"generation": {"temperature": "hot"}}, "generation.temperature"),
            ({"enforceAbstention": "yes"}, "enforceAbstention"),
            ({"generation": {"maxTokens": True}}, "generation.maxTokens"),
        ]:
            caplog.clear()
            _write_settings(bad_doc, tmp_path, monkeypatch)
            with (
                patch.object(chatqna_module, "logger", logging.getLogger("chatqna.genieai_chatqna")),
                caplog.at_level(logging.WARNING, logger="chatqna.genieai_chatqna"),
            ):
                settings = chatqna_module._llm_settings()
            assert settings == _LLM_DEFAULTS, bad_doc
            assert needle in caplog.text
            # prompt concat / numeric use must be safe on the degraded doc
            assert isinstance(settings["systemPrompt"], str)
            assert isinstance(settings["generation"]["maxTokens"], int)

    def test_wrong_typed_warns_once_per_file_state(self, tmp_path, monkeypatch, caplog):
        file = _write_settings({"systemPrompt": 5}, tmp_path, monkeypatch)
        real_logger = logging.getLogger("chatqna.genieai_chatqna")
        with (
            patch.object(chatqna_module, "logger", real_logger),
            caplog.at_level(logging.WARNING, logger="chatqna.genieai_chatqna"),
        ):
            chatqna_module._llm_settings()
            chatqna_module._llm_settings()
        warns = [r for r in caplog.records if "systemPrompt" in r.message]
        assert len(warns) == 1  # no per-request spam
        file.write_text(json.dumps({"systemPrompt": 6}), encoding="utf-8")
        with (
            patch.object(chatqna_module, "logger", real_logger),
            caplog.at_level(logging.WARNING, logger="chatqna.genieai_chatqna"),
        ):
            chatqna_module._llm_settings()
        warns = [r for r in caplog.records if "systemPrompt" in r.message]
        assert len(warns) == 2  # new file state → warn again


# ---------------------------------------------------------------------------
# System-prompt assembly (align_inputs LLM site).
# ---------------------------------------------------------------------------


class TestSystemPromptAssembly:
    def _run(self, llm_params=None):
        self_mock = MagicMock()
        self_mock.services = {"llm_node": MagicMock(service_type=FakeServiceType.LLM)}
        inputs = {"inputs": "kb context", "stream": False, "frequency_penalty": 0.0, "temperature": 0.7}
        with (
            patch("chatqna.genieai_chatqna.ServiceType", FakeServiceType),
            patch("chatqna.genieai_chatqna.get_tokenizer", return_value=_mock_tokenizer()),
        ):
            return align_inputs(self_mock, inputs, "llm_node", MagicMock(), llm_params or {})

    def test_file_prompt_assembled_after_en_prefix(self, tmp_path, monkeypatch):
        _write_settings({"systemPrompt": "FILE PROMPT MARKER"}, tmp_path, monkeypatch)
        result = self._run(llm_params={"max_tokens": 128, "top_p": 0.9, "repetition_penalty": 1.0})
        system = result["messages"][0]["content"]
        # DEC-26 law: the ENGLISH-ONLY prefix is hardcoded and comes FIRST.
        assert system.index("MANDATORY: You MUST respond ONLY in English") < system.index("FILE PROMPT MARKER")

    def test_self_conf_suffix_appended_after_file_prompt(self, tmp_path, monkeypatch):
        _write_settings({"systemPrompt": "FILE PROMPT MARKER"}, tmp_path, monkeypatch)
        with patch.object(chatqna_module, "LLM_SELF_CONFIDENCE_ENABLED", True):
            result = self._run(llm_params={"max_tokens": 128, "top_p": 0.9, "repetition_penalty": 1.0})
        system = result["messages"][0]["content"]
        assert system.index("FILE PROMPT MARKER") < system.index("[[CONF:")

    def test_no_self_conf_suffix_when_disabled(self, tmp_path, monkeypatch):
        _write_settings({"systemPrompt": "FILE PROMPT MARKER"}, tmp_path, monkeypatch)
        with patch.object(chatqna_module, "LLM_SELF_CONFIDENCE_ENABLED", False):
            result = self._run(llm_params={"max_tokens": 128, "top_p": 0.9, "repetition_penalty": 1.0})
        assert "[[CONF:" not in result["messages"][0]["content"]

    def test_edit_visible_without_restart_same_path(self, tmp_path, monkeypatch):
        file = _write_settings({"systemPrompt": "FIRST"}, tmp_path, monkeypatch)
        first = self._run(llm_params={"max_tokens": 128, "top_p": 0.9, "repetition_penalty": 1.0})
        file.write_text(json.dumps({"systemPrompt": "SECOND"}), encoding="utf-8")
        second = self._run(llm_params={"max_tokens": 128, "top_p": 0.9, "repetition_penalty": 1.0})
        assert "FIRST" in first["messages"][0]["content"]
        assert "SECOND" in second["messages"][0]["content"]


# ---------------------------------------------------------------------------
# Abstention paths (align_inputs retriever site + align_outputs rerank site).
# ---------------------------------------------------------------------------


class TestAbstentionPaths:
    def _run_retriever_site(self):
        self_mock = MagicMock()
        self_mock.services = {"retriever_node": MagicMock(service_type=FakeServiceType.RETRIEVER)}
        graph = MagicMock()
        graph.downstream.return_value = ["llm_node"]  # NOT rerank → prompt branch
        data = {"initial_query": "test", "retrieved_docs": [], "metadata": []}
        with patch("chatqna.genieai_chatqna.ServiceType", FakeServiceType):
            return align_outputs(self_mock, data, "retriever_node", {"text": "test"}, graph, {})

    def _run_rerank_site(self):
        self_mock = MagicMock()
        self_mock.services = {"rerank_node": MagicMock(service_type=FakeServiceType.RERANK)}
        data = {"reranked_docs": []}
        inputs = {"initial_query": "test", "retrieved_docs": []}
        with patch("chatqna.genieai_chatqna.ServiceType", FakeServiceType):
            return align_outputs(self_mock, data, "rerank_node", inputs, MagicMock(), {})

    def test_custom_instructions_apply_on_both_sites(self, tmp_path, monkeypatch):
        _write_settings(
            {"enforceAbstention": True, "abstentionInstructions": "CUSTOM ABSTAIN"}, tmp_path, monkeypatch
        )
        assert "CUSTOM ABSTAIN" in self._run_retriever_site()["inputs"]
        assert "CUSTOM ABSTAIN" in self._run_rerank_site()["inputs"]

    def test_empty_instructions_fall_back_to_one_deduplicated_default(self, tmp_path, monkeypatch):
        _write_settings({"enforceAbstention": True, "abstentionInstructions": ""}, tmp_path, monkeypatch)
        retriever_text = self._run_retriever_site()["inputs"]
        rerank_text = self._run_rerank_site()["inputs"]
        # The two sites used to diverge ("[Returned Documents]" vs
        # "[Retrieved Documents]") — ONE shared default now.
        assert _ABSTENTION_INSTRUCTIONS_DEFAULT in retriever_text
        assert _ABSTENTION_INSTRUCTIONS_DEFAULT in rerank_text
        assert "cannot answer" in retriever_text.lower()

    def test_enforce_off_no_abstention_text(self, tmp_path, monkeypatch):
        _write_settings({"enforceAbstention": False, "abstentionInstructions": "CUSTOM ABSTAIN"}, tmp_path, monkeypatch)
        assert "CUSTOM ABSTAIN" not in self._run_rerank_site()["inputs"]

    def test_defaults_when_file_absent(self, tmp_path, monkeypatch):
        monkeypatch.setenv(ENV_VAR, str(tmp_path / "missing.json"))
        assert "cannot answer" in self._run_rerank_site()["inputs"].lower()


# ---------------------------------------------------------------------------
# Gen-param precedence (request-explicit > file > coded) — the falsy-zero fix.
# ---------------------------------------------------------------------------


class _FakeChatRequest(BaseModel):
    """Mirrors the real ChatCompletionRequest gen-param defaults (the baked
    non-None values are the point: they must NOT masquerade as explicit)."""

    top_k: float | None = None
    top_p: float | None = None
    temperature: float | None = 0.01
    frequency_penalty: float | None = 0.0
    presence_penalty: float | None = 0.0
    repetition_penalty: float | None = 1.0
    max_tokens: int | None = None
    stream: bool | None = False


class TestGenParamPrecedence:
    def test_unset_fields_take_file_values(self, tmp_path, monkeypatch):
        _write_settings(
            {"generation": {"temperature": 0.7, "topP": 0.5, "repetitionPenalty": 1.1, "maxTokens": 2048}},
            tmp_path,
            monkeypatch,
        )
        req = _FakeChatRequest.model_validate({"messages": "hi"})
        params = _resolve_llm_gen_params(req)
        assert params["temperature"] == 0.7
        assert params["top_p"] == 0.5
        assert params["repetition_penalty"] == 1.1
        # maxTokens honesty: the file value is the real outbound default now
        assert params["max_tokens"] == 2048
        # keys absent from the partial file fall back to coded defaults
        assert params["frequency_penalty"] == _LLM_DEFAULTS["generation"]["frequencyPenalty"]

    def test_explicit_zero_wins_over_everything(self, tmp_path, monkeypatch):
        # The falsy-zero bug: temperature=0 / frequency_penalty=0.0 sent
        # explicitly used to be replaced by the defaults.
        _write_settings({"generation": {"temperature": 0.99, "frequencyPenalty": 0.5}}, tmp_path, monkeypatch)
        req = _FakeChatRequest.model_validate(
            {"messages": "hi", "temperature": 0, "frequency_penalty": 0.0}
        )
        params = _resolve_llm_gen_params(req)
        assert params["temperature"] == 0
        assert params["frequency_penalty"] == 0.0

    def test_explicit_null_falls_back_to_file_value(self, tmp_path, monkeypatch):
        # JSON null is the OpenAI "unset" convention: it lands in
        # model_fields_set with value None and must NOT beat the file.
        _write_settings({"generation": {"temperature": 0.7, "maxTokens": 2048}}, tmp_path, monkeypatch)
        req = _FakeChatRequest.model_validate(
            {"messages": "hi", "temperature": None, "max_tokens": None}
        )
        assert "temperature" in req.model_fields_set  # explicit, not defaulted
        params = _resolve_llm_gen_params(req)
        assert params["temperature"] == 0.7
        assert params["max_tokens"] == 2048

    def test_explicit_max_tokens_wins_over_file(self, tmp_path, monkeypatch):
        _write_settings({"generation": {"maxTokens": 2048}}, tmp_path, monkeypatch)
        req = _FakeChatRequest.model_validate({"messages": "hi", "max_tokens": 512})
        assert _resolve_llm_gen_params(req)["max_tokens"] == 512

    def test_unset_and_no_file_equals_coded_defaults(self, tmp_path, monkeypatch):
        monkeypatch.setenv(ENV_VAR, str(tmp_path / "missing.json"))
        req = _FakeChatRequest.model_validate({"messages": "hi"})
        params = _resolve_llm_gen_params(req)
        gen = _LLM_DEFAULTS["generation"]
        assert params["temperature"] == gen["temperature"]
        assert params["top_p"] == gen["topP"]
        assert params["repetition_penalty"] == gen["repetitionPenalty"]
        assert params["max_tokens"] == gen["maxTokens"]


class TestRealProtocolFieldsSet:
    """The REAL protocol model under the precedence mechanism.

    A fake-mirror pin stays green if the protocol model ever changes; this
    imports the actual core.genieai_api_protocol (vendored api_protocol base
    stubbed) and pins that its baked defaults are NOT in model_fields_set —
    the property _resolve_llm_gen_params depends on.
    """

    def test_baked_defaults_are_not_explicit(self):
        import typing

        stub = types.ModuleType("api_protocol")
        # Permissive BaseModel stand-ins for every base class the protocol
        # file pulls from the vendored (Docker-only) api_protocol module.
        needed = [
            "RetrievalRequest", "RetrievalResponse", "ArangoDBDataprepRequest",
            "ResponseFormat", "StreamOptions", "ChatCompletionToolsParam",
            "ChatCompletionNamedToolChoiceParam", "EmbedDoc", "SearchedMultimodalDoc",
            "RetrievalResponseData", "RerankingResponseData", "EmbeddingResponse", "UploadFile",
        ]
        for name in needed:
            setattr(stub, name, type(name, (BaseModel,), {"model_config": {"extra": "allow"}}))
        for name in ("Any", "Union", "Literal", "Optional"):
            setattr(stub, name, getattr(typing, name))
        stub.__all__ = needed + ["Any", "Union", "Literal", "Optional"]
        saved = sys.modules.get("api_protocol")
        sys.modules["api_protocol"] = stub
        try:
            real = importlib.import_module("core.genieai_api_protocol")
            req = real.ChatCompletionRequest.model_validate({"messages": "hi"})
            for field in ("temperature", "top_p", "frequency_penalty", "presence_penalty", "repetition_penalty", "max_tokens"):
                assert field not in req.model_fields_set, field
            # sanity on the baked values the file must be able to shadow
            assert req.temperature == 0.01
            assert req.repetition_penalty == 1.0
            # and an explicitly-sent 0 IS explicit
            explicit = real.ChatCompletionRequest.model_validate({"messages": "hi", "temperature": 0})
            assert "temperature" in explicit.model_fields_set
            assert explicit.temperature == 0
        finally:
            sys.modules.pop("api_protocol", None)
            sys.modules.pop("core.genieai_api_protocol", None)
            if saved is not None:
                sys.modules["api_protocol"] = saved


# ---------------------------------------------------------------------------
# Answer-budget clamp (file generation.maxTokens vs the model-length budget).
# ---------------------------------------------------------------------------


class TestAnswerBudgetClamp:
    def test_file_value_clamped_into_model_length_budget(self, tmp_path, monkeypatch, caplog):
        _write_settings({"generation": {"maxTokens": 5000}}, tmp_path, monkeypatch)
        with (
            patch.object(chatqna_module, "MAX_MODEL_LEN_TEXTGEN", 600),
            patch.object(chatqna_module, "logger", logging.getLogger("chatqna.genieai_chatqna")),
            caplog.at_level(logging.WARNING, logger="chatqna.genieai_chatqna"),
        ):
            assert chatqna_module._clamped_file_max_tokens() == 88  # 600 - 512
        assert "clamping" in caplog.text  # loud law

    def test_in_budget_value_passes_unclamped_and_silent(self, tmp_path, monkeypatch, caplog):
        # in-budget = below MAX-512 (88 here); 100 WOULD clamp to 88
        _write_settings({"generation": {"maxTokens": 50}}, tmp_path, monkeypatch)
        with (
            patch.object(chatqna_module, "MAX_MODEL_LEN_TEXTGEN", 600),
            patch.object(chatqna_module, "logger", logging.getLogger("chatqna.genieai_chatqna")),
            caplog.at_level(logging.WARNING, logger="chatqna.genieai_chatqna"),
        ):
            assert chatqna_module._clamped_file_max_tokens() == 50
        assert "clamping" not in caplog.text

    def test_clamp_warms_once_per_value(self, tmp_path, monkeypatch, caplog):
        _write_settings({"generation": {"maxTokens": 5000}}, tmp_path, monkeypatch)
        with (
            patch.object(chatqna_module, "MAX_MODEL_LEN_TEXTGEN", 600),
            patch.object(chatqna_module, "logger", logging.getLogger("chatqna.genieai_chatqna")),
            caplog.at_level(logging.WARNING, logger="chatqna.genieai_chatqna"),
        ):
            chatqna_module._clamped_file_max_tokens()
            chatqna_module._clamped_file_max_tokens()
        warns = [r for r in caplog.records if "clamping" in r.message]
        assert len(warns) == 1  # no per-request spam


class TestAnswerBudgetFallback:
    def _run(self, llm_params):
        self_mock = MagicMock()
        self_mock.services = {"llm_node": MagicMock(service_type=FakeServiceType.LLM)}
        inputs = {"inputs": "kb", "stream": False, "frequency_penalty": 0.0, "temperature": 0.7}
        tokenizer = _mock_tokenizer({"USER": 100})  # history tokens count
        # max_tokens defaults to 0 (FALSY) so the file-driven fallback fires;
        # callers pass a real max_tokens to pin the request-wins branch.
        params = {"max_tokens": 0, "top_p": 0.9, "repetition_penalty": 1.0, **llm_params}
        with (
            patch("chatqna.genieai_chatqna.ServiceType", FakeServiceType),
            patch("chatqna.genieai_chatqna.get_tokenizer", return_value=tokenizer),
            patch("chatqna.genieai_chatqna.MAX_MODEL_LEN_TEXTGEN", 600),
        ):
            return align_inputs(
                self_mock,
                inputs,
                "llm_node",
                MagicMock(),
                params,
                full_chat_history_string="USER: m1 |<-MSG->| USER: m2 |<-MSG->| USER: m3",
            )

    def test_over_budget_file_value_no_longer_nukes_history(self, tmp_path, monkeypatch):
        # Budget = min(5000, 600-512) = 88; small prompt (0 tokens) + 88 does
        # NOT exceed the 400-token guard → history survives. Unclamped, a
        # 5000-token budget would truncate EVERY request's history away.
        _write_settings({"generation": {"maxTokens": 5000}}, tmp_path, monkeypatch)
        result = self._run({})
        assert "m3" in result["messages"][1]["content"]

    def test_small_file_budget_preserves_history(self, tmp_path, monkeypatch):
        # 100-200 < 400 → the truncation branch never fires.
        _write_settings({"generation": {"maxTokens": 100}}, tmp_path, monkeypatch)
        result = self._run({})
        assert "m3" in result["messages"][1]["content"]

    def test_request_max_tokens_still_wins(self, tmp_path, monkeypatch):
        # llm_parameters_dict carries max_tokens → the fallback is not consulted.
        _write_settings({"generation": {"maxTokens": 5000}}, tmp_path, monkeypatch)
        result = self._run({"max_tokens": 100})
        assert result["max_tokens"] == 100
