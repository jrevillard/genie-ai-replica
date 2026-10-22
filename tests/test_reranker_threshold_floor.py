# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""
Tests for the reranker's `threshold` strategy edges: the min_n floor, its
near-miss bound, and the removal of the top-N fallback.

Background, measured on the asante/1.0 demo box on 2026-09-30: the same eight
chunks scored 0.97/0.94/0.94/0.74/0.70/0.55/0.39/0.00 for "...what does that
mean?" and 0.63/0.54/0.41/0.31/0.17/0.09/0.08/0.00 for "...what does that
mena?". With a pure cut at 0.42 the typo collapsed the context from six chunks
to two, and the chunk that defines hypertension — ranked third — was dropped;
the model then called 140/90 "normal". The floor exists to put that chunk back
without lowering the bar. The number itself is DEFAULT_RERANKING_MIN_N in the
module and is never restated here: InvokeWiring derives its expectations from
it. This fixture can pin a default of 3 or 4 — two chunks clear the bar, two
more clear the near-miss bound. The values tried, and why they changed, are in
the git history of that constant.

The OPEA / aiohttp / kneed dependencies are stubbed so this runs against the
real module with nothing installed:

    python3 -m unittest tests.test_reranker_threshold_floor -v
"""

import asyncio
import os
import subprocess
import sys
import types
import unittest
from contextlib import contextmanager
from unittest import mock

_REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_RERANKER_DIR = os.path.join(_REPO_ROOT, "genie-ai-overlay", "reranker")

# Re-imports this module (and through it the reranker) in a fresh process so the
# module-level env parse can be exercised with different values.
_IMPORT_AND_PRINT_MIN_N = (
    "import importlib.util;"
    "spec=importlib.util.spec_from_file_location('t','tests/test_reranker_threshold_floor.py');"
    "m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);"
    "print(m.PARSED_MIN_N)"
)


class _Params:
    """Stand-in for the OPEA pydantic/docarray models: keyword args become attributes."""

    def __init__(self, **kwargs):
        for key, value in kwargs.items():
            setattr(self, key, value)


class _Logger:
    def __getattr__(self, _name):
        return lambda *a, **k: None


class _SearchedDoc:
    """Distinct base class so the module's isinstance(input, SearchedDoc) check is meaningful."""


class _Registry:
    @staticmethod
    def register(_name):
        return lambda cls: cls


class _KneeLocator:
    """kneed stand-in that never finds a knee, so `knee_threshold` keeps everything."""

    def __init__(self, *_args, **_kwargs):
        self.knee = None


def _stub_module(name, **attrs):
    module = types.ModuleType(name)
    for key, value in attrs.items():
        setattr(module, key, value)
    sys.modules[name] = module
    return module


def _install_import_stubs():
    _stub_module(
        "comps",
        CustomLogger=lambda *a, **k: _Logger(),
        LLMParamsDoc=_Params,
        OpeaComponentRegistry=_Registry,
        SearchedDoc=_SearchedDoc,
    )
    _stub_module("comps.cores")
    _stub_module("comps.cores.proto")
    _stub_module(
        "comps.cores.proto.api_protocol",
        ChatCompletionRequest=_Params,
        RerankingRequest=_Params,
        RerankingResponse=_Params,
        RerankingResponseData=_Params,
    )
    _stub_module("integrations")
    _stub_module("integrations.tei", OpeaTEIReranking=object)
    _stub_module("kneed", KneeLocator=_KneeLocator)
    _stub_module("aiohttp", ClientSession=object)


_install_import_stubs()
if _RERANKER_DIR not in sys.path:
    sys.path.insert(0, _RERANKER_DIR)

import genieai_tei_reranker as rr  # noqa: E402

# What the module parsed from the process environment, before this suite pins the
# floor so the tests below do not depend on whatever RERANKING_MIN_N the developer
# happens to have exported (the documented deploy command `source .env` exports it).
PARSED_MIN_N = rr.RERANKING_MIN_N
rr.RERANKING_MIN_N = rr.DEFAULT_RERANKING_MIN_N

THRESHOLD = 0.42
# Cross-encoder scores logged on the box for the same eight chunks. Indices 0-1 are
# the treatment-target and threshold rows that survived the typo on their own; index 2
# is "Definition of hypertension (mmHg) | >= 140/90"; index 3 is the stage table
# ("stage 1 hypertension 140-159/90-99"). Index 4 onward is below the near-miss bound.
MEAN_SCORES = [0.971, 0.940, 0.936, 0.739, 0.702, 0.553, 0.389, 0.000]
MENA_SCORES = [0.633, 0.539, 0.405, 0.312, 0.165, 0.085, 0.075, 0.000]
# "my blood pressure is 180/100. what does the mena?" — nothing relevant retrieved.
NOTHING_SCORES = [0.115, 0.007, 0.003, 0.001, 0.0, 0.0, 0.0, 0.0]


def _tei(scores):
    """TEI /rerank payload: one {index, score} per input text."""
    return [{"index": i, "score": s} for i, s in enumerate(scores)]


def _indices(selected):
    return [r["index"] for r in selected]


@contextmanager
def floor(min_n):
    """Run with a different RERANKING_MIN_N, as if the reranker had been started with it."""
    previous = rr.RERANKING_MIN_N
    rr.RERANKING_MIN_N = min_n
    try:
        yield
    finally:
        rr.RERANKING_MIN_N = previous


class SelectByThreshold(unittest.TestCase):
    def test_keeps_everything_above_the_bar_in_score_order(self):
        selected = rr.select_by_threshold(_tei(MEAN_SCORES), THRESHOLD, min_n=3)
        self.assertEqual(_indices(selected), [0, 1, 2, 3, 4, 5])

    def test_floor_tops_up_with_the_next_best_candidates(self):
        # Two clear the bar; the floor pulls in the third-ranked definition chunk.
        selected = rr.select_by_threshold(_tei(MENA_SCORES), THRESHOLD, min_n=3)
        self.assertEqual(_indices(selected), [0, 1, 2])
        self.assertEqual(selected[2]["score"], 0.405)

    def test_floor_of_four_also_admits_the_stage_table(self):
        selected = rr.select_by_threshold(_tei(MENA_SCORES), THRESHOLD, min_n=4)
        self.assertEqual(_indices(selected), [0, 1, 2, 3])

    def test_floor_is_not_a_fallback_when_nothing_clears_the_bar(self):
        self.assertEqual(rr.select_by_threshold(_tei(NOTHING_SCORES), THRESHOLD, min_n=3), [])

    def test_top_up_skips_candidates_below_the_near_miss_bound(self):
        # One survivor must not drag noise in behind it: 0.05 and 0.0 are below
        # half the threshold, so the floor stays unfilled rather than filled with junk.
        selected = rr.select_by_threshold(_tei([0.45, 0.05, 0.0, 0.0]), THRESHOLD, min_n=3)
        self.assertEqual(_indices(selected), [0])

    def test_near_miss_bound_is_half_the_threshold(self):
        bound = THRESHOLD * rr.NEAR_MISS_RATIO
        selected = rr.select_by_threshold(_tei([0.5, bound, bound - 0.001]), THRESHOLD, min_n=3)
        self.assertEqual(_indices(selected), [0, 1])

    def test_floor_disabled_with_zero_or_negative(self):
        for min_n in (0, -1):
            selected = rr.select_by_threshold(_tei(MENA_SCORES), THRESHOLD, min_n=min_n)
            self.assertEqual(_indices(selected), [0, 1], f"min_n={min_n}")

    def test_floor_never_exceeds_the_candidates(self):
        selected = rr.select_by_threshold(_tei([0.9, 0.3]), THRESHOLD, min_n=5)
        self.assertEqual(_indices(selected), [0, 1])

    def test_floor_does_not_trim_when_more_than_min_n_pass(self):
        selected = rr.select_by_threshold(_tei(MEAN_SCORES), THRESHOLD, min_n=2)
        self.assertEqual(len(selected), 6)

    def test_unsorted_input_is_ranked_by_score(self):
        shuffled = [
            {"index": 2, "score": 0.405},
            {"index": 0, "score": 0.633},
            {"index": 5, "score": 0.085},
            {"index": 1, "score": 0.539},
        ]
        selected = rr.select_by_threshold(shuffled, THRESHOLD, min_n=3)
        self.assertEqual(_indices(selected), [0, 1, 2])

    def test_exact_threshold_counts_as_clearing_the_bar(self):
        selected = rr.select_by_threshold(_tei([0.42, 0.1]), THRESHOLD, min_n=1)
        self.assertEqual(_indices(selected), [0])

    def test_count_above_matches_the_selection_rule(self):
        self.assertEqual(rr.count_above(_tei(MEAN_SCORES), THRESHOLD), 6)
        self.assertEqual(rr.count_above(_tei(MENA_SCORES), THRESHOLD), 2)
        self.assertEqual(rr.count_above(_tei(NOTHING_SCORES), THRESHOLD), 0)


class EnvParsing(unittest.TestCase):
    """RERANKING_MIN_N is read at import; a bad value must not take the service down."""

    # Fallback handed to the parser: not a plausible floor, so no assertion below can
    # pass by falling back to it.
    FALLBACK = 99

    def _env_int(self, raw):
        # Exercise the parser directly; only the import-time wiring needs a subprocess.
        env = {k: v for k, v in os.environ.items() if k != "RERANKING_MIN_N"}
        if raw is not None:
            env["RERANKING_MIN_N"] = raw
        with mock.patch.dict(os.environ, env, clear=True):
            return rr._env_int("RERANKING_MIN_N", self.FALLBACK)

    def test_unset_and_blank_fall_back_to_the_default(self):
        # compose's `${RERANKING_MIN_N:-}` passes an empty string through when unset.
        for raw in (None, "", "  "):
            self.assertEqual(self._env_int(raw), self.FALLBACK, repr(raw))

    def test_explicit_value_is_honoured(self):
        self.assertEqual(self._env_int("5"), 5)

    def test_integral_float_is_read_as_that_integer(self):
        # Ansible renders a YAML float as "3.0"; the operator meant 3, not the default.
        self.assertEqual(self._env_int("3.0"), 3)

    def test_malformed_falls_back_to_the_default(self):
        for raw in ("three", "3.5", "nan"):
            self.assertEqual(self._env_int(raw), self.FALLBACK, raw)

    def _import_in_subprocess(self, **env_overrides):
        env = {k: v for k, v in os.environ.items() if k != "RERANKING_MIN_N"}
        env.update(env_overrides)
        return subprocess.run(
            [sys.executable, "-c", _IMPORT_AND_PRINT_MIN_N],
            capture_output=True,
            text=True,
            env=env,
            cwd=_REPO_ROOT,
            check=False,
        )

    def test_import_wires_the_env_to_the_module_default(self):
        proc = self._import_in_subprocess()
        self.assertEqual(proc.returncode, 0, proc.stderr[-400:])
        self.assertEqual(proc.stdout.strip(), str(rr.DEFAULT_RERANKING_MIN_N))

    def test_blank_numeric_envs_do_not_crash_import(self):
        # Same block, same failure mode: blank or float-rendered values must not take the
        # service down at startup.
        proc = self._import_in_subprocess(RERANKER_TOP_N="", RERANKING_THRESHOLD="", RERANKING_MIN_N="")
        self.assertEqual(proc.returncode, 0, proc.stderr[-400:])


# --- invoke() wiring -------------------------------------------------------------


class _Doc:
    def __init__(self, text):
        self.text = text


class _Input(rr.GenieSearchedDoc):
    def __init__(self, **kwargs):
        self.__dict__.update(kwargs)

    def model_dump(self, **_kwargs):
        return {k: v for k, v in self.__dict__.items() if v is not None}


class _TeiError(Exception):
    pass


class _FakeResponse:
    def __init__(self, payload, status_error=None):
        self._payload = payload
        self._status_error = status_error

    def raise_for_status(self):
        if self._status_error:
            raise self._status_error

    async def json(self):
        return self._payload

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_exc):
        return False


class _FakeSession:
    def __init__(self, payload, status_error=None):
        self._payload = payload
        self._status_error = status_error
        self.calls = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_exc):
        return False

    def post(self, url, json=None):
        self.calls.append((url, json))
        return _FakeResponse(self._payload, self._status_error)


@contextmanager
def _fake_tei(scores, status_error=None):
    previous = rr.aiohttp.ClientSession
    rr.aiohttp.ClientSession = lambda: _FakeSession(_tei(scores), status_error)
    try:
        yield
    finally:
        rr.aiohttp.ClientSession = previous


def _service():
    svc = rr.GenieTEIReranking.__new__(rr.GenieTEIReranking)
    svc.base_url = "http://tei_reranker:80"
    return svc


def _request(**overrides):
    params = {
        "initial_query": "my blood pressure is 140/90. What does that mena?",
        "retrieved_docs": [_Doc(f"chunk-{i}") for i in range(8)],
        "reranking_strategy": "threshold",
        "reranking_threshold": THRESHOLD,
        # Deliberately not equal to the floor, so a threshold-path assertion cannot be
        # satisfied by the slice or unknown-strategy branches by coincidence.
        "top_n": 8,
    }
    params.update(overrides)
    return _Input(**params)


def _texts(result):
    return [doc.text for doc in result.reranked_docs]


class InvokeWiring(unittest.TestCase):
    # Expectations are derived from the constant rather than restated, so moving the
    # number is a one-line change. MENA_SCORES can pin a default of 3 or 4.
    DEFAULT = rr.DEFAULT_RERANKING_MIN_N

    def test_default_floor_reaches_the_response(self):
        n = self.DEFAULT
        with _fake_tei(MENA_SCORES):
            result = asyncio.run(_service().invoke(_request()))
        self.assertEqual(_texts(result), [f"chunk-{i}" for i in range(n)])
        self.assertEqual([doc.score for doc in result.reranked_docs], MENA_SCORES[:n])

    def test_floor_is_read_from_the_module_setting(self):
        # One below the default: the two above-bar chunks are kept regardless, so the
        # count still moves and the assertion cannot be met by the default alone.
        with floor(self.DEFAULT - 1), _fake_tei(MENA_SCORES):
            result = asyncio.run(_service().invoke(_request()))
        self.assertEqual(len(result.reranked_docs), self.DEFAULT - 1)

    def test_request_cannot_override_the_floor(self):
        # The floor is deliberately env-only; a request field of that name is ignored.
        # Asking for fewer than the default keeps the assertion discriminating whatever
        # the near-miss bound caps this fixture at.
        with _fake_tei(MENA_SCORES):
            result = asyncio.run(_service().invoke(_request(reranking_min_n=self.DEFAULT - 1)))
        self.assertEqual(len(result.reranked_docs), self.DEFAULT)

    def test_nothing_above_the_bar_returns_no_documents(self):
        # Previously the top-N fallback would have returned four near-zero chunks here.
        with _fake_tei(NOTHING_SCORES):
            result = asyncio.run(_service().invoke(_request()))
        self.assertEqual(result.reranked_docs, [])

    def test_slice_strategy_is_unchanged(self):
        with _fake_tei(MENA_SCORES):
            result = asyncio.run(_service().invoke(_request(reranking_strategy="slice", top_n=4)))
        self.assertEqual(_texts(result), ["chunk-0", "chunk-1", "chunk-2", "chunk-3"])

    def test_knee_strategy_without_a_knee_keeps_everything(self):
        with _fake_tei(MENA_SCORES):
            result = asyncio.run(_service().invoke(_request(reranking_strategy="knee_threshold")))
        self.assertEqual(len(result.reranked_docs), 8)

    def test_unknown_strategy_falls_back_to_a_top_n_slice(self):
        with _fake_tei(MENA_SCORES):
            result = asyncio.run(_service().invoke(_request(reranking_strategy="nope", top_n=2)))
        self.assertEqual(_texts(result), ["chunk-0", "chunk-1"])

    def test_unknown_strategy_without_top_n_uses_the_resolved_default(self):
        # Used to slice with the raw request field, so a missing top_n returned every chunk.
        previous = rr.RERANKER_TOP_N
        rr.RERANKER_TOP_N = 1
        try:
            with _fake_tei(MENA_SCORES):
                result = asyncio.run(_service().invoke(_request(reranking_strategy="nope", top_n=None)))
        finally:
            rr.RERANKER_TOP_N = previous
        self.assertEqual(_texts(result), ["chunk-0"])

    def test_tei_http_error_is_raised_not_swallowed(self):
        # A 429 error body is a JSON object; without raise_for_status it would reach the
        # strategy code and fail there with an opaque TypeError.
        with _fake_tei(MENA_SCORES, status_error=_TeiError("429 Model is overloaded")), self.assertRaises(_TeiError):
            asyncio.run(_service().invoke(_request()))


if __name__ == "__main__":
    unittest.main()
