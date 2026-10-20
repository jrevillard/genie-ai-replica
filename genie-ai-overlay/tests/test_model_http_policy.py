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

import pytest

import core.model_http_policy as policy

_ENV_KEYS = (
    "MODEL_LLM_TIMEOUT_SECONDS",
    "VLLM_TIMEOUT",
    "MODEL_LLM_MAX_RETRIES",
    "MODEL_EMBEDDING_TIMEOUT_SECONDS",
    "MODEL_RERANK_TIMEOUT_SECONDS",
    "MODEL_CONTROL_PLANE_TIMEOUT_SECONDS",
)

OVERLAY_ROOT = Path(__file__).resolve().parent.parent


def _dataprep_budget_present() -> bool:
    """True once dataprep's own vLLM client carries the shared budget.

    This MR bounds every model-endpoint client EXCEPT the one in
    ``dataprep/genieai_dataprep_arangodb.py``, which arrives with the
    phase-budget work that owns that module. The dataprep guards below are armed
    by this rather than skipped outright: a static skip would leave the module
    unguarded for good, whereas this starts checking it the moment that file
    gains the budget — and a hardcoded timeout creeping back in before it does
    is caught by the scan in ``test_no_hardcoded_control_plane_timeout_is_left_behind``,
    which covers the same module whenever the budget is present.
    """
    src = (OVERLAY_ROOT / "dataprep" / "genieai_dataprep_arangodb.py").read_text(encoding="utf-8")
    return "http_timeout(LLM_TIMEOUT_SECONDS)" in src


requires_dataprep_budget = pytest.mark.skipif(
    not _dataprep_budget_present(),
    reason=(
        "dataprep's own vLLM client is still at its pre-policy state; its budget lands with "
        "the phase-budget MR. This guard arms itself as soon as that module changes."
    ),
)


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
            "tei_timeout": m.EMBEDDING_TIMEOUT_SECONDS,
            "rerank_timeout": m.RERANK_TIMEOUT_SECONDS,
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

    def test_a_malformed_primary_knob_is_not_answered_by_the_legacy_one(self):
        """A typo must not resolve to a value the operator never asked for.

        Skipping a malformed value to reach the next name made
        ``MODEL_LLM_TIMEOUT_SECONDS=30m`` silently resolve to whatever
        ``VLLM_TIMEOUT`` said, and the container log would report that budget.
        The preferred knob is set, so its rejection is the answer.
        """
        assert _reload_with(MODEL_LLM_TIMEOUT_SECONDS="30m", VLLM_TIMEOUT="600")["llm_timeout"] == 180.0

    def test_an_empty_primary_knob_still_yields_to_the_legacy_one(self):
        """Unset and empty are different: an empty var is not a decision."""
        assert _reload_with(MODEL_LLM_TIMEOUT_SECONDS="", VLLM_TIMEOUT="600")["llm_timeout"] == 600.0


class TestInvalidValues:
    def test_non_numeric_falls_back_to_default(self):
        m = _reload_with(MODEL_LLM_TIMEOUT_SECONDS="not-a-number")
        assert m["llm_timeout"] == 180.0

    def test_zero_rejected(self):
        assert _reload_with(MODEL_EMBEDDING_TIMEOUT_SECONDS="0")["tei_timeout"] == 120.0

    def test_negative_rejected(self):
        assert _reload_with(MODEL_LLM_MAX_RETRIES="-3")["llm_retries"] == 2

    @pytest.mark.parametrize(
        "raw",
        ["30m", "0", "-5", "inf", "1e400", "-inf", "nan", "NaN", "  60  x"],
        ids=lambda v: repr(v),
    )
    def test_a_rejected_primary_knob_is_never_answered_by_the_legacy_one(self, raw):
        """Every rejection reason ends the search, not just the unparsable one.

        The legacy name is set on every case, so this pins the branch as well as
        the value: a parser that rejected unparsable input but let an
        out-of-range value fall through would return 600.0 here for every case
        except ``30m`` and the suite would still look green, because a rejection
        with no lower-precedence name behind it resolves to the same default
        either way.

        Both rejection classes matter to an operator: ``30m`` is a typo, and
        ``0`` is someone deliberately capping a budget. Answering either with
        the legacy name reports a budget they never set.
        """
        assert _reload_with(MODEL_LLM_TIMEOUT_SECONDS=raw, VLLM_TIMEOUT="600")["llm_timeout"] == 180.0

    @pytest.mark.parametrize("raw", ["0.5x", "-1", "nan", "inf"], ids=lambda v: repr(v))
    def test_a_rejected_retry_count_is_never_answered_by_a_later_name(self, raw):
        """Same rule on the retry parser, which takes two names too."""
        assert _reload_with(MODEL_LLM_MAX_RETRIES=raw, MODEL_LLM_TIMEOUT_SECONDS="600")["llm_retries"] == 2

    def test_zero_retries_is_honoured(self):
        """Zero is the meaningful value for a retry count, unlike for a timeout.

        An operator on a contended GPU sets 0 to cap a batch's worst-case
        latency. The positive parser must therefore not be reused here: it
        rejects zero because a zero *timeout* means "fail every call
        immediately", and reusing it would hand back the default with nothing to
        say so.
        """
        assert _reload_with(MODEL_LLM_MAX_RETRIES="0")["llm_retries"] == 0

    def test_negative_retries_still_rejected(self):
        assert _reload_with(MODEL_LLM_MAX_RETRIES="-3")["llm_retries"] == 2

    def test_fractional_retries_round_up(self):
        """A fractional count is nonsense; the safe reading is \"retry more\"."""
        assert _reload_with(MODEL_LLM_MAX_RETRIES="2.2")["llm_retries"] == 3

    def test_zero_timeout_is_still_rejected(self):
        """The two knobs disagree on zero, and that has to stay true."""
        assert _reload_with(MODEL_LLM_TIMEOUT_SECONDS="0")["llm_timeout"] == 180.0
        assert _reload_with(MODEL_EMBEDDING_TIMEOUT_SECONDS="0")["tei_timeout"] == 120.0

    def test_import_never_raises_on_any_garbage(self):
        """Importing the policy must not be able to kill a service."""
        for raw in ("", "inf", "-inf", "nan", "abc", "0", "-1", "1e999", "1,5", "  60  "):
            saved = {k: os.environ.get(k) for k in _ENV_KEYS}
            try:
                for k, v in saved.items():
                    if v is None:
                        os.environ.pop(k, None)
                    else:
                        os.environ[k] = v
                os.environ["MODEL_LLM_MAX_RETRIES"] = raw
                importlib.reload(policy)  # would raise here
            finally:
                for k, v in saved.items():
                    if v is None:
                        os.environ.pop(k, None)
                    else:
                        os.environ[k] = v
                importlib.reload(policy)


def _called_name(node: ast.AST) -> str | None:
    """The terminal name of a call target: ``OpenAI(...)`` and ``openai.OpenAI(...)``.

    Both spellings matter. Matching only a bare ``ast.Name`` left the
    retriever's readiness probe — built as ``openai.OpenAI(...)`` — invisible
    to every guard in this file, so the suite reported full coverage of "every
    httpx-backed client goes through http_timeout" while one of them was not
    being looked at.
    """
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        return node.attr
    return None


def _constructors(source_path: Path, *class_names: str) -> list[ast.Call]:
    """Every call to any of *class_names* anywhere in *source_path*.

    Parsed rather than text-matched so a mention in a comment or docstring is
    not mistaken for a call site — that mistake reads as "the client is
    unbounded", which is the verdict these tests exist to contradict.
    """
    tree = ast.parse(source_path.read_text(encoding="utf-8"))
    wanted = set(class_names)
    return [node for node in ast.walk(tree) if isinstance(node, ast.Call) and _called_name(node.func) in wanted]


def _function_body(source: str, name: str) -> str:
    """The source text of the method/function *name*, by indentation.

    Matches both ``def name(`` and ``async def name(`` — every one of these
    call sites is async, and a matcher that only saw the sync form would report
    them as absent rather than as unmarked.
    """
    lines = source.split("\n")
    start = next(
        (i for i, ln in enumerate(lines) if ln.lstrip().startswith(f"def {name}(")),
        None,
    )
    if start is None:
        start = next(
            (i for i, ln in enumerate(lines) if ln.lstrip().startswith(f"async def {name}(")),
            None,
        )
    if start is None:
        return ""
    indent = len(lines[start]) - len(lines[start].lstrip())
    out = [lines[start]]
    for line in lines[start + 1 :]:
        if line.strip() and (len(line) - len(line.lstrip())) <= indent:
            break
        out.append(line)
    return "\n".join(out)


def _kwarg(call: ast.Call, name: str) -> ast.AST | None:
    return next((kw.value for kw in call.keywords if kw.arg == name), None)


def _source_names(node: ast.AST | None) -> set[str]:
    """Identifiers a value expression reads, e.g. ``L`` in ``EMBEDDING_TIMEOUT + L``."""
    return {n.id for n in ast.walk(node) if isinstance(n, ast.Name)} if node is not None else set()


class TestHttpTimeoutKeepsTheConnectCeiling:
    """A total budget must not widen the connect ceiling it is layered on.

    The OpenAI SDK ships ``httpx.Timeout(timeout=600, connect=5.0)``. Handing a
    client a bare float REPLACES that object rather than shortening it, so
    ``timeout=180`` sets connect to 180 s too. On the failure this deck is most
    exposed to — a GPU node that stops answering and blackholes SYNs instead of
    refusing them — each attempt then waits out the full total before giving up,
    which is the stall the budget exists to bound.
    """

    def test_connect_stays_at_the_sdk_ceiling(self):
        t = policy.http_timeout(180.0)
        assert t.connect == policy.CONNECT_TIMEOUT_SECONDS

    def test_read_write_and_pool_carry_the_total(self):
        t = policy.http_timeout(180.0)
        assert (t.read, t.write, t.pool) == (180.0, 180.0, 180.0)

    def test_a_total_below_the_ceiling_is_not_inflated(self):
        """connect must never exceed the total, at any knob setting.

        ``MODEL_EMBEDDING_TIMEOUT_SECONDS=2`` has to stay a 2 s budget everywhere; a
        fixed 5 s connect would silently outlive it.
        """
        t = policy.http_timeout(2.0)
        assert t.connect == 2.0
        assert t.read == 2.0

    def test_it_is_an_httpx_timeout_and_not_a_bare_number(self):
        """The distinction the whole helper exists for.

        Asserted on the type rather than on the numbers above so a future edit
        that returns a plain float fails here instead of passing the checks that
        a float would also satisfy.
        """
        import httpx

        assert isinstance(policy.http_timeout(180.0), httpx.Timeout)

    def test_passing_a_float_to_httpx_is_what_widens_connect(self):
        """The httpx semantic that makes the helper necessary, asserted directly.

        openai 1.81.0 ships ``DEFAULT_TIMEOUT = httpx.Timeout(timeout=600,
        connect=5.0)``, but the SDK is mocked out of this suite, so the constant
        itself cannot be observed here. What can be is the httpx behaviour the
        constant exists to work around: ``httpx.Timeout(180.0)`` sets *every*
        dimension, connect included. Pinned here so the reason the helper exists
        stays true even if the SDK's own default is later re-pinned.
        """
        import httpx

        assert httpx.Timeout(180.0).connect == 180.0
        assert httpx.Timeout(180.0, connect=5.0).connect == 5.0


def _register_keys_set_on_spans(func: ast.AST) -> set[str]:
    """Vocabulary keys passed as the first argument of ``span.set_attribute``.

    Read from the AST rather than the source text so the key has to actually
    reach a call: a docstring naming the attribute, or a comment explaining why
    it is stamped, satisfies a substring search over the same function.
    """
    found: set[str] = set()
    for node in ast.walk(func):
        if not (isinstance(node, ast.Call) and _called_name(node.func) == "set_attribute" and node.args):
            continue
        first = node.args[0]
        if (
            isinstance(first, ast.Subscript)
            and isinstance(first.value, ast.Name)
            and first.value.id == "ATTRIBUTE_NAMES"
            and isinstance(first.slice, ast.Constant)
            and isinstance(first.slice.value, str)
        ):
            found.add(first.slice.value)
    return found


def _stamped_under_a_positive_timeout_guard(func: ast.AST) -> bool:
    """True when EVERY span stamp sits inside ``if _is_timeout(...)``.

    Requires each stamp to be a descendant of a guard whose test is a bare,
    positive call to ``_is_timeout``, and that guard's BODY — not the ``If``
    node, which ``ast.walk`` also descends into the ``orelse`` of. So:

    - ``if not _is_timeout(e)`` fails on the polarity;
    - a stamp hoisted above the ``if`` fails, because it is not under any guard;
    - a stamp moved into the ``else`` fails, because that is the NON-timeout
      path — the exact misreading the attribute exists to prevent.

    "Every", not "any": hoisting ``dataprep_llm_timed_out`` out of the guard
    while leaving ``dataprep_llm_timeout_seconds`` inside satisfies an ``any``.
    """
    # Scoped to the two timeout keys, not every span stamp: the same functions
    # also stamp dataprep.input_too_long and friends outside any timeout guard,
    # and requiring those to be guarded would be asserting the wrong invariant.
    timeout_keys = {"dataprep_llm_timed_out", "dataprep_llm_timeout_seconds"}
    stamps = {
        id(n)
        for n in ast.walk(func)
        if isinstance(n, ast.Call)
        and _called_name(n.func) == "set_attribute"
        and n.args
        and isinstance(n.args[0], ast.Subscript)
        and isinstance(n.args[0].value, ast.Name)
        and n.args[0].value.id == "ATTRIBUTE_NAMES"
        and isinstance(n.args[0].slice, ast.Constant)
        and n.args[0].slice.value in timeout_keys
    }
    if not stamps:
        return False
    guarded: set[int] = set()
    for node in ast.walk(func):
        if not isinstance(node, ast.If):
            continue
        if not (isinstance(node.test, ast.Call) and _called_name(node.test.func) == "_is_timeout"):
            continue
        for stmt in node.body:
            guarded |= {id(n) for n in ast.walk(stmt) if id(n) in stamps}
    return guarded == stamps


class TestCallSitesConsumeThePolicy:
    """Every model-endpoint client in the overlay is built with a budget.

    A client constructed without one inherits a library default, and the
    library default is exactly what this policy exists to replace. Reading the
    construction sites keeps the two in step: adding a client without a budget
    fails here by name.
    """

    @requires_dataprep_budget
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

    @requires_dataprep_budget
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
            assert "RERANK_TIMEOUT_SECONDS" in _source_names(_kwarg(call, "timeout"))

    def test_the_rerank_budget_is_never_tighter_than_the_library_default(self):
        """The one client with no fallback must not fail faster than it already did.

        Every other budget in the policy sits on a call that degrades — labelling
        to file labels, context to the raw chunk, embedding to the sparse
        channel. The reranker's timeout propagates to a 500 and fails the user's
        chat request, so shortening it converts a slow-but-successful rerank into
        a visible error. 120 s would be 2.5x more failures than a bare
        aiohttp.ClientSession already produced on a contended GPU, with no
        degraded path to catch them.
        """
        assert _reload_with()["rerank_timeout"] >= 300.0, (
            "the rerank budget defaults below the 300 s a bare aiohttp.ClientSession "
            "would have applied — that path has no fallback, so a tighter budget "
            "turns slow successes into 500s rather than bounding a stall"
        )

    def test_the_rerank_budget_is_still_configurable_and_tunable(self):
        assert _reload_with(MODEL_RERANK_TIMEOUT_SECONDS="45")["rerank_timeout"] == 45.0
        assert _reload_with(MODEL_RERANK_TIMEOUT_SECONDS="nonsense")["rerank_timeout"] == 300.0

    def test_retriever_llm_and_embedding_clients_are_bounded(self):
        """The retriever's OpenAI-branch clients are bounded.

        ``HuggingFaceEndpointEmbeddings`` is deliberately excluded: it is a
        pydantic model whose accepted fields depend on the pinned
        langchain-huggingface, an unrecognised ``timeout`` raises at
        construction, and on the remote-GPU path this branch selects that turns
        an unbounded single call into a 500 on every retrieval. The gap is
        tracked in OVERRIDES.yaml; asserting it here would only push the next
        author to add the kwarg back.
        """
        source = OVERLAY_ROOT / "retriever" / "genieai_retriever_arangodb.py"
        calls = _constructors(source, "ChatOpenAI", "OpenAIEmbeddings")
        assert len(calls) >= 2, f"expected the retriever's OpenAI-branch clients, found {len(calls)}"
        for call in calls:
            assert _kwarg(call, "timeout") is not None, (
                f"{ast.unparse(call.func)} built without an explicit timeout — "
                "it would inherit the client library default"
            )

    def test_retriever_timeouts_come_from_the_policy(self):
        """Each retriever client resolves to the constant that fits its fallback.

        Deliberately per-constructor rather than "some policy name": the
        summarizer and the embedding client must NOT share a constant. They have
        opposite failure shapes — a summarizer timeout re-raises out of
        retrieve() and becomes a 500, an embedding timeout returns an empty
        result set — and only one of them can afford the 180 s the LLM budget
        carries. A guard that accepted either name at either site would have
        passed while the summarizer sat on the tighter, wrong budget.
        """
        source = OVERLAY_ROOT / "retriever" / "genieai_retriever_arangodb.py"
        expected = {
            "ChatOpenAI": "SUMMARIZER_TIMEOUT_SECONDS",
            "OpenAIEmbeddings": "EMBEDDING_TIMEOUT",
        }
        calls = _constructors(source, "ChatOpenAI", "OpenAIEmbeddings")
        for call in calls:
            ctor = ast.unparse(call.func)
            names = _source_names(_kwarg(call, "timeout"))
            want = expected[ctor]
            assert want in names, (
                f"{ctor} timeout does not resolve to {want}: {names or 'not set'}. "
                f"It must not fall back to {sorted(set(expected.values()) - {want})} — "
                "that constant is sized for a call with a degradation route, and this one has none"
            )

    def test_the_retriever_config_names_rebind_to_the_policy(self):
        """``VLLM_TIMEOUT = LLM_TIMEOUT_SECONDS``, not a local re-read of the env.

        The retriever call sites assert on the *name* ``VLLM_TIMEOUT``, so
        nothing above notices what that name is bound to. Reverting this
        assignment to ``os.getenv("VLLM_TIMEOUT", 600)`` would leave the
        summarizer on a 10-minute budget — the exact live stall this policy
        exists to bound — with the call-site tests still reporting the
        retriever as budgeted.
        """
        source = (OVERLAY_ROOT / "retriever" / "config.py").read_text(encoding="utf-8")
        bindings = {}
        for node in ast.walk(ast.parse(source)):
            if isinstance(node, ast.Assign) and isinstance(node.value, ast.Name):
                for target in node.targets:
                    if isinstance(target, ast.Name):
                        bindings[target.id] = node.value.id
        for name, expected in (
            ("VLLM_TIMEOUT", "LLM_TIMEOUT_SECONDS"),
            ("EMBEDDING_TIMEOUT", "EMBEDDING_TIMEOUT_SECONDS"),
        ):
            assert name in bindings, f"{name} is no longer assigned at module level in retriever/config.py"
            assert bindings[name] == expected, (
                f"retriever/config.py rebinds {name} to {bindings[name]!r}, not {expected!r} — "
                "the retriever call sites read this name, so this is the value they get"
            )

    def test_the_retry_budget_reaches_the_gpu_clients_and_only_those(self):
        """``MODEL_LLM_MAX_RETRIES`` is the shared GPU's knob, so it stops there.

        Two directions, both load-bearing. It must reach the retriever's vLLM
        summarizer as well as the dataprep SDK client — a knob documented as
        shared that silently applied to ingestion only would leave half the
        calls that make the GPU busy uncapped. And it must NOT reach the two
        clients built from an operator-supplied ``OPENAI_API_KEY``: those talk
        to the OpenAI API, where the dominant transient failure is a 429 the
        SDK's own retry handling exists to absorb, so an operator setting 0 for
        a wedged vLLM node would silently disable it against a third party.
        """
        source = OVERLAY_ROOT / "retriever" / "genieai_retriever_arangodb.py"
        calls = _constructors(source, "ChatOpenAI", "OpenAIEmbeddings")
        assert len(calls) >= 3, f"expected the retriever's three OpenAI-compatible clients, found {len(calls)}"

        with_retries = [c for c in calls if "LLM_MAX_RETRIES" in _source_names(_kwarg(c, "max_retries"))]
        without = [c for c in calls if c not in with_retries]
        assert len(with_retries) == 1, (
            f"expected exactly one GPU-facing client to carry max_retries, got "
            f"{[ast.unparse(c.func) for c in with_retries]} — the vLLM summarizer "
            "(_create_vllm_client) is the one that needs it"
        )
        assert len(without) == len(calls) - 1, (
            "every retriever client ended up retry-capped: the OpenAI-API branch "
            "(self.llm and the OpenAIEmbeddings instance) must keep the SDK default"
        )
        # Every client is still bounded on timeout, retry knob or not.
        for call in without:
            assert "http_timeout" in _source_names(_kwarg(call, "timeout")), (
                f"{ast.unparse(call.func)} lost its timeout budget"
            )

    @requires_dataprep_budget
    def test_no_openai_client_is_built_with_a_bare_number_timeout(self):
        """Every httpx-backed client goes through ``http_timeout``.

        A bare float is accepted by all four client classes and silently drops
        the SDK's 5 s connect ceiling, so this asserts on the call shape at every
        site rather than on the value any one of them happens to carry.
        """
        checked = 0
        for rel, names in (
            ("dataprep/genieai_dataprep_arangodb.py", ("AsyncOpenAI",)),
            # "OpenAI" covers openai.OpenAI(...) — the retriever's API-key probe,
            # built through a dotted attribute rather than a bare name, which is
            # why it needs the helper to match both spellings.
            ("retriever/genieai_retriever_arangodb.py", ("OpenAI", "ChatOpenAI", "OpenAIEmbeddings")),
        ):
            for call in _constructors(OVERLAY_ROOT / rel, *names):
                checked += 1
                value = _kwarg(call, "timeout")
                assert value is not None, f"{rel}: {ast.unparse(call.func)} has no timeout"
                # No escape hatch for a bare Name here: VLLM_TIMEOUT and friends
                # are plain floats, so accepting one would accept exactly the
                # shape this test exists to reject. Verified by mutation --
                # rewriting a site to `timeout=VLLM_TIMEOUT` has to fail here.
                assert "http_timeout" in _source_names(value), (
                    f"{rel}: {ast.unparse(call.func)} builds its timeout as "
                    f"{ast.unparse(value)}, which replaces the httpx.Timeout object instead of "
                    "shortening its total — the SDK's 5 s connect ceiling is discarded with it"
                )
        assert checked >= 5, (
            f"expected the openai/langchain client sites (dataprep SDK client, the retriever "
            f"probe, its two summarizer clients and its embedding client), found {checked} — "
            "a client that moved out of these constructors is no longer guarded"
        )

    @requires_dataprep_budget
    def test_every_dataprep_llm_call_site_marks_a_timeout(self):
        """All five LLM call sites stamp the timeout, not just the first three.

        The attribute exists so a wedged GPU is distinguishable from a call
        still in flight. Three of the five sites carried it; the two
        Contextual Retrieval per-chunk paths did not, and those are exactly the
        ones the phase budget singles out as having the longest ladder — so
        their spans closed with no tokens, no status and no timeout marker,
        which is the state the attribute was added to eliminate.
        """
        source = OVERLAY_ROOT / "dataprep" / "genieai_dataprep_arangodb.py"
        functions = {
            node.name: node
            for node in ast.walk(ast.parse(source.read_text(encoding="utf-8")))
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
        }
        for fn in (
            "_context_batch_call",
            "_context_doc_call",
            "_context_single_call",
            "_llm_call_batch",
            "_llm_call_single",
        ):
            assert fn in functions, f"{fn} not found — has it moved or been renamed?"
            stamped = _register_keys_set_on_spans(functions[fn])
            for key in ("dataprep_llm_timed_out", "dataprep_llm_timeout_seconds"):
                assert key in stamped, (
                    f"{fn} never sets ATTRIBUTE_NAMES[{key!r}] on a span. Reading the function's "
                    "source text instead of its AST would let the explanatory comment satisfy this "
                    "check on its own, with the set_attribute calls deleted"
                )
            # The marker has to be INSIDE a positive _is_timeout guard, not
            # merely somewhere in the same function. Presence alone accepted
            # both hoisting the stamping out of the if (every failed call then
            # reported as a timeout) and inverting the test to `if not
            # _is_timeout(e)` — the same misreading with the sign flipped — so
            # this checks the enclosing guard of each stamp directly.
            assert _stamped_under_a_positive_timeout_guard(functions[fn]), (
                f"{fn} does not stamp the timeout marker inside `if _is_timeout(e):` — stamping "
                "every failed call, or stamping the non-timeout ones, is the misreading the "
                "attribute exists to prevent"
            )

    def test_the_unbudgeted_huggingface_client_is_left_unbudgeted(self):
        """Guard the deliberate omission on the AST, not on prose.

        The class is not given a timeout because langchain_huggingface's pydantic
        field set is version-dependent and an unrecognised kwarg raises at
        construction — which on the remote-GPU path would 500 every retrieval.
        Asserting on a comment string would fail on any reworded comment and pass
        on the kwarg being added back, so the assertion is on the shape of the
        call: this class must not grow a timeout keyword.
        """
        source = OVERLAY_ROOT / "retriever" / "genieai_retriever_arangodb.py"
        calls = _constructors(source, "HuggingFaceEndpointEmbeddings")
        assert calls, "the call site moved — re-check whether it can be budgeted now"
        for call in calls:
            assert _kwarg(call, "timeout") is None, (
                "HuggingFaceEndpointEmbeddings gained a timeout kwarg. That class is a "
                "pydantic model whose field set depends on the pinned langchain-huggingface; "
                "verify the field exists there before keeping it, or every retrieval on the "
                "remote-GPU path fails at construction."
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
            value = _kwarg(call, "timeout")
            assert value is not None, (
                "the Keycloak token session is unbounded — a slow IdP wedges every "
                "_write_ingestion_log / _update_doc_status caller behind it"
            )
            # Not just present: pointing it at a literal would satisfy the check
            # above while the module quietly stopped following a shared knob.
            #
            # AUTH_TIMEOUT_SECONDS, and deliberately NOT CONTROL_PLANE_* — which
            # is what this test asserted for several rounds, wrongly. Every
            # control-plane write waits on this token; it is one attempt with no
            # retry and the caller re-raises. Putting it on the 30 s
            # control-plane budget gave a call with no degradation route a 10x
            # cut below what aiohttp applied, which is the same mistake fixed on
            # the reranker (round 6) and the summarizer (round 8). The two must
            # not be collapsed back together.
            names = _source_names(value)
            assert "AUTH_TIMEOUT_SECONDS" in names, (
                f"the Keycloak session's timeout reads {ast.unparse(value)}, not the auth budget. "
                "Do not move it onto CONTROL_PLANE_*: this call has no degradation route"
            )
            assert "CONTROL_PLANE_TIMEOUT_SECONDS" not in names, (
                "the Keycloak token fetch is back on the 30 s control-plane budget — every "
                "_write_ingestion_log / _update_doc_status call waits on this token"
            )

    @requires_dataprep_budget
    def test_dataprep_control_plane_calls_use_the_shared_budget(self):
        """The docstring promises these read CONTROL_PLANE_TIMEOUT_SECONDS.

        A deployer whose backend needs a longer budget must find every one of
        these follow it, not just the Keycloak refresh — the ingestion-log
        writer is the one that matters, since the phase heartbeats go through it
        and a slow one stops the very reporting this change added.
        """
        source = OVERLAY_ROOT / "dataprep" / "genieai_dataprep_arangodb.py"
        text = source.read_text(encoding="utf-8")
        sessions = [
            c
            for c in ast.walk(ast.parse(text))
            if isinstance(c, ast.Call) and isinstance(c.func, ast.Attribute) and c.func.attr == "ClientSession"
        ]
        assert sessions, "no aiohttp.ClientSession found in the dataprep module"
        for call in sessions:
            assert "CONTROL_PLANE_TIMEOUT_SECONDS" in _source_names(_kwarg(call, "timeout")), (
                f"{ast.unparse(call.func)} at line {call.lineno} does not read the shared control-plane budget"
            )

    @requires_dataprep_budget
    def test_no_hardcoded_control_plane_timeout_is_left_behind(self):
        """No module that reads the policy may build a timeout from a literal.

        Scoped to the modules that import it: a literal in one of them while the
        knob is presented as deck-wide means a deployer who raises it sees the
        new budget in one service and the old one in another, with nothing
        saying so.

        Matched on the AST, not on the text of the source. The previous version
        searched for the literal string ``ClientTimeout(total=30)``, which any
        edit of the number or the spacing steps around — ``total=60``,
        ``total=30.0`` and ``total=30 )`` all slipped past, and for the chatqna
        and Keycloak modules this was the only guard there was.
        """
        offenders = []
        for rel in (
            "dataprep/genieai_dataprep_arangodb.py",
            "dataprep/keycloak_service_account.py",
            "chatqna/genieai_chatqna.py",
            "retriever/genieai_retriever_arangodb.py",
        ):
            text = (OVERLAY_ROOT / rel).read_text(encoding="utf-8")
            # No "does this module read the knob?" precondition. Skipping a
            # module that does not import CONTROL_PLANE_TIMEOUT_SECONDS makes
            # the guard blind to the one mutation it exists for: a module
            # dropping the import and hardcoding a literal back — which is
            # exactly the "raises the knob, sees it change in one service and
            # not another" case its docstring describes. The retriever was
            # permanently exempt for exactly that reason.
            for node in ast.walk(ast.parse(text)):
                if not (isinstance(node, ast.Call) and _called_name(node.func) == "ClientTimeout"):
                    continue
                total = _kwarg(node, "total")
                if total is None:
                    continue
                # Either shared constant counts, whichever the module's calls
                # are actually meant to read: a ClientTimeout must never be a
                # literal beside a knob that governs it. AUTH_TIMEOUT_SECONDS
                # is accepted because the Keycloak token fetch legitimately
                # sits on that one rather than on the control-plane budget.
                if not _source_names(total) & {"CONTROL_PLANE_TIMEOUT_SECONDS", "AUTH_TIMEOUT_SECONDS"}:
                    offenders.append(f"{rel}:{node.lineno} total={ast.unparse(total)}")
        assert not offenders, (
            f"a hardcoded control-plane timeout survived beside the knob at {offenders} — raising "
            "MODEL_CONTROL_PLANE_TIMEOUT_SECONDS would change some call sites and not others, "
            "which is the deck-wide claim the docstring denies"
        )
