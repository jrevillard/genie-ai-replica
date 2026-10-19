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
    "MODEL_TEI_TIMEOUT_SECONDS",
    "MODEL_RERANK_TIMEOUT_SECONDS",
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
        assert _reload_with(MODEL_TEI_TIMEOUT_SECONDS="0")["tei_timeout"] == 120.0

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
        assert _reload_with(MODEL_TEI_TIMEOUT_SECONDS="0")["tei_timeout"] == 120.0

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
    """Identifiers a value expression reads, e.g. ``L`` in ``TEI_TIMEOUT + L``."""
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

        ``MODEL_TEI_TIMEOUT_SECONDS=2`` has to stay a 2 s budget everywhere; a
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
        source = OVERLAY_ROOT / "retriever" / "genieai_retriever_arangodb.py"
        calls = _constructors(source, "ChatOpenAI", "OpenAIEmbeddings")
        for call in calls:
            names = _source_names(_kwarg(call, "timeout"))
            assert names & {"VLLM_TIMEOUT", "TEI_TIMEOUT"}, (
                f"{ast.unparse(call.func)} timeout does not resolve to the shared policy: {names or 'not set'}"
            )

    def test_the_retriever_clients_carry_the_retry_budget_too(self):
        """``MODEL_LLM_MAX_RETRIES`` must not read as deck-wide and reach one service.

        The dataprep SDK client is the one with the long ladder, but the
        retriever's summarizer and its embedding client are the same kind of
        contended-GPU call. A knob documented as a shared budget that silently
        applies to ingestion only is worse than no knob: an operator who sets
        ``MODEL_LLM_MAX_RETRIES=0`` to cap a busy GPU gets that cap on half the
        calls that make the GPU busy.
        """
        source = OVERLAY_ROOT / "retriever" / "genieai_retriever_arangodb.py"
        calls = _constructors(source, "ChatOpenAI", "OpenAIEmbeddings")
        assert calls, "the retriever's OpenAI-branch clients moved — re-check the pin"
        for call in calls:
            assert "LLM_MAX_RETRIES" in _source_names(_kwarg(call, "max_retries")), (
                f"{ast.unparse(call.func)} has no max_retries — MODEL_LLM_MAX_RETRIES silently does not reach it"
            )

    def test_no_openai_client_is_built_with_a_bare_number_timeout(self):
        """Every httpx-backed client goes through ``http_timeout``.

        A bare float is accepted by all four client classes and silently drops
        the SDK's 5 s connect ceiling, so this asserts on the call shape at every
        site rather than on the value any one of them happens to carry.
        """
        checked = 0
        for rel, names in (
            ("dataprep/genieai_dataprep_arangodb.py", ("AsyncOpenAI",)),
            ("retriever/genieai_retriever_arangodb.py", ("ChatOpenAI", "OpenAIEmbeddings")),
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
        assert checked >= 4, f"expected the openai/langchain client sites, found {checked}"

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
        text = source.read_text(encoding="utf-8")
        for fn in (
            "_context_batch_call",
            "_context_doc_call",
            "_context_single_call",
            "_llm_call_batch",
            "_llm_call_single",
        ):
            body = _function_body(text, fn)
            assert body, f"{fn} not found — has it moved or been renamed?"
            assert 'ATTRIBUTE_NAMES["dataprep_llm_timed_out"]' in body, (
                f"{fn} records no timeout marker, so its span is indistinguishable from a call still in flight"
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
            assert _kwarg(call, "timeout") is not None, (
                "the Keycloak token session is unbounded — a slow IdP wedges every "
                "_write_ingestion_log / _update_doc_status caller behind it"
            )

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

    def test_no_hardcoded_control_plane_timeout_is_left_behind(self):
        """No module that reads the policy may keep a literal beside it.

        Scoped to the modules that import it: a literal in one of them while the
        knob is presented as deck-wide means a deployer who raises it sees the
        new budget in one service and 30 s in another, with nothing saying so.
        """
        offenders = []
        for rel in (
            "dataprep/genieai_dataprep_arangodb.py",
            "dataprep/keycloak_service_account.py",
            "chatqna/genieai_chatqna.py",
        ):
            text = (OVERLAY_ROOT / rel).read_text(encoding="utf-8")
            if "CONTROL_PLANE_TIMEOUT_SECONDS" not in text:
                continue
            for i, line in enumerate(text.split("\n"), 1):
                if "ClientTimeout(total=30)" in line:
                    offenders.append(f"{rel}:{i}")
        assert not offenders, (
            f"a literal 30 s survived beside the knob in {offenders} — raising "
            "MODEL_CONTROL_PLANE_TIMEOUT_SECONDS would change some call sites and "
            "not others, which is the deck-wide claim the docstring denies"
        )
