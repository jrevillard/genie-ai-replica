# Copyright (C) 2025 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""Tests for the shared model-endpoint HTTP budget policy.

Two things are asserted here, and the second is the one that matters:

1. the env-parsing rules (precedence, rejection of garbage);
2. that each in-repo call site actually *consumes* the policy.

(1) alone is what a policy module's own unit test can reach, and it passes
whether or not a single service reads the value — the failure mode where the
policy exists, is tested, and no client is bounded by it is invisible to it.
(2) is asserted by reading the client-construction call sites, so a service
that drops its budget fails here instead of silently reverting to its library
default in production.
"""

import ast
import importlib
import os
from pathlib import Path

import core.model_http_policy as policy

_ENV_KEYS = (
    "MODEL_LLM_TIMEOUT_SECONDS",
    "VLLM_TIMEOUT",
    "MODEL_LLM_MAX_RETRIES",
    "MODEL_TEI_TIMEOUT_SECONDS",
    "MODEL_CONTROL_PLANE_TIMEOUT_SECONDS",
)

OVERLAY_ROOT = Path(__file__).resolve().parent.parent


def _reload_with(**env):
    """Reload the policy with *env* applied; return a VALUE snapshot.

    importlib.reload mutates the module object in place, so returning the
    module would expose whatever the finally-block restore-reload computes.
    """
    saved = {k: os.environ.pop(k, None) for k in _ENV_KEYS}
    try:
        for k, v in env.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        m = importlib.reload(policy)
        return {
            "llm_timeout": m.LLM_TIMEOUT_SECONDS,
            "llm_retries": m.LLM_MAX_RETRIES,
            "tei_timeout": m.TEI_TIMEOUT_SECONDS,
            "control_plane_timeout": m.CONTROL_PLANE_TIMEOUT_SECONDS,
        }
    finally:
        for k, v in saved.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        importlib.reload(policy)


class TestDefaults:
    def test_llm_timeout_default(self):
        assert _reload_with()["llm_timeout"] == 180.0

    def test_llm_max_retries_default(self):
        assert _reload_with()["llm_retries"] == 2

    def test_tei_timeout_default(self):
        assert _reload_with()["tei_timeout"] == 120.0

    def test_control_plane_timeout_default(self):
        assert _reload_with()["control_plane_timeout"] == 30.0

    def test_llm_default_is_below_the_openai_sdk_default(self):
        """The default has to be a real change, not a restatement of the SDK.

        openai-python ships 600 s with 2 automatic retries, and this overlay's
        own call sites add a 3-attempt loop on top of some of them. Pinning
        the default back to 600 would make the policy a no-op that reads like a
        fix — which is the state this module was written to end.
        """
        assert _reload_with()["llm_timeout"] < 600.0


class TestPrecedence:
    def test_model_llm_timeout_wins_over_legacy(self):
        m = _reload_with(MODEL_LLM_TIMEOUT_SECONDS="120", VLLM_TIMEOUT="999")
        assert m["llm_timeout"] == 120.0

    def test_legacy_vllm_timeout_still_honored(self):
        assert _reload_with(VLLM_TIMEOUT="77")["llm_timeout"] == 77.0


class TestInvalidValues:
    def test_non_numeric_falls_back_to_default(self):
        m = _reload_with(MODEL_LLM_TIMEOUT_SECONDS="not-a-number")
        assert m["llm_timeout"] == 180.0

    def test_zero_rejected(self):
        assert _reload_with(MODEL_TEI_TIMEOUT_SECONDS="0")["tei_timeout"] == 120.0

    def test_negative_rejected(self):
        assert _reload_with(MODEL_LLM_MAX_RETRIES="-3")["llm_retries"] == 2


def _constructors(source_path: Path, *class_names: str) -> list[ast.Call]:
    """Every call to any of *class_names* anywhere in *source_path*.

    Parsed rather than text-matched so a mention in a comment or docstring is
    not mistaken for a call site — that mistake reads as "the client is
    unbounded", which is the verdict these tests exist to contradict.
    """
    tree = ast.parse(source_path.read_text(encoding="utf-8"))
    wanted = set(class_names)
    return [
        node
        for node in ast.walk(tree)
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in wanted
    ]


def _kwarg(call: ast.Call, name: str) -> ast.AST | None:
    return next((kw.value for kw in call.keywords if kw.arg == name), None)


def _source_names(node: ast.AST | None) -> set[str]:
    """Identifiers a value expression reads, e.g. ``L`` in ``TEI_TIMEOUT + L``."""
    return {n.id for n in ast.walk(node) if isinstance(n, ast.Name)} if node is not None else set()


class TestCallSitesConsumeThePolicy:
    """Every model-endpoint client in the overlay is built with a budget.

    A client constructed without one inherits a library default, and the
    library default is exactly what this policy exists to replace. Reading the
    construction sites keeps the two in step: adding a client without a budget
    fails here by name.
    """

    def test_dataprep_vllm_client_is_bounded(self):
        source = OVERLAY_ROOT / "dataprep" / "genieai_dataprep_arangodb.py"
        calls = [
            c
            for c in ast.walk(ast.parse(source.read_text(encoding="utf-8")))
            if isinstance(c, ast.Call) and isinstance(c.func, ast.Name) and c.func.id == "AsyncOpenAI"
        ]
        assert calls, "no AsyncOpenAI construction found — did the call site move?"
        for call in calls:
            assert _kwarg(call, "timeout") is not None, "AsyncOpenAI built without an explicit timeout"
            assert _kwarg(call, "max_retries") is not None, "AsyncOpenAI built without an explicit max_retries"

    def test_dataprep_vllm_client_timeout_comes_from_the_policy(self):
        source = OVERLAY_ROOT / "dataprep" / "genieai_dataprep_arangodb.py"
        calls = [
            c
            for c in ast.walk(ast.parse(source.read_text(encoding="utf-8")))
            if isinstance(c, ast.Call) and isinstance(c.func, ast.Name) and c.func.id == "AsyncOpenAI"
        ]
        for call in calls:
            assert "LLM_TIMEOUT_SECONDS" in _source_names(_kwarg(call, "timeout"))
            assert "LLM_MAX_RETRIES" in _source_names(_kwarg(call, "max_retries"))

    def test_reranker_tei_session_is_bounded(self):
        """A bare ClientSession inherits aiohttp's 300 s default silently."""
        source = OVERLAY_ROOT / "reranker" / "genieai_tei_reranker.py"
        calls = [
            c
            for c in ast.walk(ast.parse(source.read_text(encoding="utf-8")))
            if isinstance(c, ast.Call) and isinstance(c.func, ast.Attribute) and c.func.attr == "ClientSession"
        ]
        assert calls, "no aiohttp.ClientSession found — did the call site move?"
        for call in calls:
            assert _kwarg(call, "timeout") is not None, "aiohttp.ClientSession built without an explicit timeout"

    def test_reranker_tei_timeout_comes_from_the_policy(self):
        source = OVERLAY_ROOT / "reranker" / "genieai_tei_reranker.py"
        calls = [
            c
            for c in ast.walk(ast.parse(source.read_text(encoding="utf-8")))
            if isinstance(c, ast.Call) and isinstance(c.func, ast.Attribute) and c.func.attr == "ClientSession"
        ]
        for call in calls:
            assert "TEI_TIMEOUT_SECONDS" in _source_names(_kwarg(call, "timeout"))

    def test_retriever_llm_and_embedding_clients_are_bounded(self):
        """The retriever had three unbounded model clients; all three are bounded."""
        source = OVERLAY_ROOT / "retriever" / "genieai_retriever_arangodb.py"
        calls = _constructors(source, "ChatOpenAI") + _constructors(source, "OpenAIEmbeddings") + _constructors(
            source, "HuggingFaceEndpointEmbeddings"
        )
        assert len(calls) >= 3, f"expected the retriever's 3 model clients, found {len(calls)}"
        for call in calls:
            assert _kwarg(call, "timeout") is not None, (
                f"{ast.unparse(call.func)} built without an explicit timeout — "
                "it would inherit the client library default"
            )

    def test_retriever_timeouts_come_from_the_policy(self):
        source = OVERLAY_ROOT / "retriever" / "genieai_retriever_arangodb.py"
        calls = _constructors(source, "ChatOpenAI") + _constructors(source, "OpenAIEmbeddings") + _constructors(
            source, "HuggingFaceEndpointEmbeddings"
        )
        for call in calls:
            names = _source_names(_kwarg(call, "timeout"))
            assert names & {"VLLM_TIMEOUT", "TEI_TIMEOUT"}, (
                f"{ast.unparse(call.func)} timeout does not resolve to the shared policy: {names or 'not set'}"
            )

    def test_dataprep_keycloak_refresh_is_bounded(self):
        """An unbounded refresh wedges every ingestion-log writer behind it."""
        source = OVERLAY_ROOT / "dataprep" / "keycloak_service_account.py"
        calls = [
            c
            for c in ast.walk(ast.parse(source.read_text(encoding="utf-8")))
            if isinstance(c, ast.Call) and isinstance(c.func, ast.Attribute) and c.func.attr == "ClientSession"
        ]
        assert calls, "no aiohttp.ClientSession found in the Keycloak client"
        for call in calls:
            assert _kwarg(call, "timeout") is not None, (
                "the Keycloak token session is unbounded — a slow IdP wedges every "
                "_write_ingestion_log / _update_doc_status caller behind it"
            )