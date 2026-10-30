# Copyright (C) 2026 ITU
# SPDX-License-Identifier: Apache-2.0
"""Fanout/judge parity between the two live _FanoutChatOpenAI implementations.

``components/ragas-service/ragas_engine.py`` is a port of this module's
``_FanoutChatOpenAI`` (its own docstring says so). Two live implementations
of the same behaviour drift silently — every token-budget/fanout change
would have to land twice with nothing failing when one side forgets. This
file pins the SHARED behaviour from both sides, in the style of shared-lib's
span-attrs test: build both classes against the same fakes and assert
identical results.

Deliberately NOT pinned as equal: the env-var families (the harness reads
``EVAL_JUDGE_*``; the sidecar reads ``RAGAS_JUDGE_*``) — different
deployment surfaces, different namespaces by design. The test pins the
NAMES as they are documented, so an accidental rename on either side is
loud.
"""

import importlib.util
import sys
from pathlib import Path

import pytest
import test_run_ragas_eval as harness

# The harness module imported run_ragas_eval WITH the langchain fakes already
# installed (its module-level chain) — reuse that module object; a direct
# `import run_ragas_eval` here would race the fake installation depending on
# import order.
run_ragas_eval = harness.run_ragas_eval

_REPO_ROOT = Path(__file__).resolve().parents[3]
_RAGAS_ENGINE_PATH = _REPO_ROOT / "components" / "ragas-service" / "ragas_engine.py"


def _load_sidecar_engine():
    spec = importlib.util.spec_from_file_location(
        "ragas_engine_under_test", _RAGAS_ENGINE_PATH
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture(scope="module")
def sidecar_engine():
    return _load_sidecar_engine()


@pytest.fixture(scope="module")
def sidecar_fanout(sidecar_engine):
    """The sidecar's _FanoutChatOpenAI, built against the SAME fake
    ChatOpenAI the harness class was defined against."""
    fake_openai = sys.modules["langchain_openai"]
    return sidecar_engine._make_fanout_class(fake_openai.ChatOpenAI)


# --- _effective_n: identical truth table ------------------------------------


@pytest.mark.parametrize(
    "kwargs_n,self_n,expected",
    [
        (None, 1, 1),
        (None, 3, 3),
        (2, 9, 2),  # kwargs win over self.n
        (0, 3, 1),  # clamped to >= 1
        (-5, 3, 1),
        ("x", 3, 1),  # garbage → 1
        (None, None, 1),
        ("4", 1, 4),  # numeric string accepted
    ],
)
def test_effective_n_truth_table_parity(sidecar_fanout, kwargs_n, self_n, expected):
    assert run_ragas_eval._FanoutChatOpenAI._effective_n(kwargs_n, self_n) == expected
    assert sidecar_fanout._effective_n(kwargs_n, self_n) == expected


# --- _merge_results: identical merge semantics -------------------------------


def _results_of(harness_cls, sidecar_cls, gens, outputs):
    from test_run_ragas_eval import _FakeChatGeneration, _FakeChatResult

    def build(cls):
        results = [
            _FakeChatResult(generations=[_FakeChatGeneration(text=g)], llm_output=o)
            for g, o in zip(gens, outputs)
        ]
        return cls._merge_results(results)

    return build(harness_cls), build(sidecar_cls)


def test_merge_generations_and_numeric_sum_parity(sidecar_fanout):

    harness_merged, sidecar_merged = _results_of(
        run_ragas_eval._FanoutChatOpenAI,
        sidecar_fanout,
        ["a", "b"],
        [{"prompt_tokens": 10, "flag": "on"}, {"prompt_tokens": 5, "flag": "off"}],
    )
    for merged in (harness_merged, sidecar_merged):
        assert [g.text for g in merged.generations] == ["a", "b"]  # flat, ordered
        assert merged.llm_output["prompt_tokens"] == 15  # numeric summed
        assert merged.llm_output["flag"] == "on"  # non-numeric: first call wins


def test_merge_excludes_bools_from_the_sum_parity(sidecar_fanout):
    """bool is an int in Python — a True flag would sum to N. The sidecar
    port excluded bools from the numeric sum; the harness copy matches it
    (this pin exists because the two copies previously disagreed HERE)."""
    harness_merged, sidecar_merged = _results_of(
        run_ragas_eval._FanoutChatOpenAI,
        sidecar_fanout,
        ["a", "b"],
        [{"cached": True}, {"cached": True}],
    )
    for merged in (harness_merged, sidecar_merged):
        assert merged.llm_output["cached"] is True  # first wins, never 2


def test_merge_empty_results_parity(sidecar_fanout):
    for cls in (run_ragas_eval._FanoutChatOpenAI, sidecar_fanout):
        out = cls._merge_results([])
        assert out.generations == []


# --- fan-out behaviour: n underlying calls, per-call n=1, exception path -----


def test_sync_fanout_calls_parent_n_times_with_n1_parity(sidecar_fanout):
    for cls in (run_ragas_eval._FanoutChatOpenAI, sidecar_fanout):
        harness._FANOUT_FAKE_PARENT_CALLS.clear()
        llm = cls(model="m", n=3)
        out = llm._generate(["q"])
        assert len(harness._FANOUT_FAKE_PARENT_CALLS) == 3
        assert all(call[2].get("n") == 1 for call in harness._FANOUT_FAKE_PARENT_CALLS)
        assert [g.text for g in out.generations] == ["gen-1", "gen-2", "gen-3"]


def test_n1_is_pass_through_parity(sidecar_fanout):
    for cls in (run_ragas_eval._FanoutChatOpenAI, sidecar_fanout):
        harness._FANOUT_FAKE_PARENT_CALLS.clear()
        llm = cls(model="m", n=1)
        llm._generate(["q"])
        assert len(harness._FANOUT_FAKE_PARENT_CALLS) == 1  # no fan-out machinery


def test_first_exception_propagates_parity(sidecar_fanout):
    for cls in (run_ragas_eval._FanoutChatOpenAI, sidecar_fanout):
        harness._FANOUT_FAKE_PARENT_CALLS.clear()
        harness._FANOUT_FAKE_STATE["raise_on"] = (
            1  # call #1 raises — always the propagated one
        )
        llm = cls(model="m", n=3)
        with pytest.raises(RuntimeError, match="fanout-injected"):
            llm._generate(["q"])
        harness._FANOUT_FAKE_STATE["raise_on"] = None


def test_async_fanout_calls_parent_n_times_parity(sidecar_fanout):
    import asyncio

    for cls in (run_ragas_eval._FanoutChatOpenAI, sidecar_fanout):
        harness._FANOUT_FAKE_PARENT_CALLS.clear()
        llm = cls(model="m", n=2)
        out = asyncio.run(llm._agenerate(["q"]))
        assert len(harness._FANOUT_FAKE_PARENT_CALLS) == 2
        assert all(call[2].get("n") == 1 for call in harness._FANOUT_FAKE_PARENT_CALLS)
        assert [g.text for g in out.generations] == ["agen-1", "agen-2"]


# --- env-contract pins (deliberately DIFFERENT namespaces) --------------------


def test_env_families_are_namespaced_per_surface():
    """The harness reads EVAL_JUDGE_*, the sidecar reads RAGAS_JUDGE_* —
    different deployment surfaces. Pin the names from both SOURCE files so a
    silent rename on either side fails here instead of surfacing as an
    'endpoint not configured' at run time."""
    harness_src = (
        _REPO_ROOT / "tests" / "rag-benchmarks" / "eval" / "run_ragas_eval.py"
    ).read_text(encoding="utf-8")
    sidecar_src = _RAGAS_ENGINE_PATH.read_text(encoding="utf-8")
    for name in (
        "EVAL_JUDGE_BASE_URL",
        "EVAL_JUDGE_MODEL",
        "EVAL_JUDGE_API_KEY",
        "EVAL_EMBED_MODEL",
    ):
        assert name in harness_src, f"harness env contract lost: {name}"
    for name in (
        "RAGAS_JUDGE_BASE_URL",
        "RAGAS_JUDGE_MODEL",
        "RAGAS_JUDGE_API_KEY",
        "RAGAS_EMBED_MODEL",
    ):
        assert name in sidecar_src, f"sidecar env contract lost: {name}"
