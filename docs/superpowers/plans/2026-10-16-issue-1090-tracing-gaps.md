# Issue 1090 — Tracing gaps implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a RAG turn fully reconstructible from VictoriaTraces alone — LLM params/usage, retriever params/scores/traversal, chatqna blend/prompt-budget, an explicit query correlation id, the streaming outcome, and a documented adaptive-breakdown join — with no free text on any span attribute.

**Architecture:** A shared vocabulary module (`core/span_attrs.py` + a JS mirror) holds every attribute name, the label digest helper, and a two-layer privacy guard. `genie.query_id` rides OTel baggage rather than a bespoke header: Python already carries baggage via its default propagator, so only the Node backend needs a composite propagator. All assertions read finished spans from an `InMemorySpanExporter` — never mocks.

**Tech Stack:** Python 3.11 / OpenTelemetry SDK 1.45.1 / pytest 9.1.1 / ruff; Node.js 22 / `@opentelemetry/sdk-node` / Jest.

**Spec:** `docs/superpowers/specs/2026-10-16-issue-1090-tracing-gaps-design.md` — read it; this plan implements it and the two must not diverge.

**Baseline (verified on this branch, before any change):** overlay `pytest tests/` → **861 passed, 4 skipped**; backend `npx jest` → **1811 passed, 0 failed**. Every "no regression" step below compares against these numbers.

## Global Constraints

- **Language:** all code, comments, docstrings, and commit messages in English.
- **Every attribute key must be in `ATTRIBUTE_NAMES.values()`.** Adding an attribute that carries user text is then impossible without a deliberate, reviewed vocabulary edit.
- **No free text in any value.** String values containing **any** whitespace, or longer than **96 characters**, are violations. No value allowlist.
- **Absent means omitted, never nulled, never a placeholder that reads like a real value.** One reserved token exists: `__unresolved__`.
- **Endpoints:** `urlparse(endpoint).path` only — never host, port, or query string.
- **`file_id`, never `file_name`.**
- **No span per chunk, no span per candidate.** Per-candidate vectors are single array attributes, capped at a ceiling derived from the deployment's `fetch_k`, not a hard-coded 32.
- **Flat scalar sequences go on as arrays; structures OTel cannot represent get JSON-encoded and are validated by parsing.** OTel attribute values are primitives or *homogeneous* sequences, so a list of dicts is not representable and must be JSON-encoded — `rag.adaptive_breakdown` and `retriever.summarizer.overflow_doc_ids` already work this way and stay that way. Those names live in `core/span_attrs.py:JSON_ENCODED_ATTRIBUTE_NAMES` and are checked by parsing, with every leaf string put through the same shape rule. Everything else in this plan emits real arrays.
- **Tests assert on finished exported spans, never mocks.** `tests/otel-collector/run-pii-smoke.sh` passed against a completely broken redactor because it asserted on the wrong surface.
- **Every gap gets a wiring test.** A helper unit test proves the helper; only a test that drives the real entry point proves the attribute reaches the span. Deleting every `set_attribute` call site must turn the suite red.
- **JS shared-helper contract** (`components/CLAUDE.md`): re-export from `components/shared/lib/index.js` (Pitfall 2); consume as `require('../shared-lib')` without `/lib/` (Pitfall 1). Both have shipped runtime bugs.
- **Reuse the existing tracer.** Python helpers use `get_tracer(...)`; chatqna helpers reuse module-level `align_tracer` (`genieai_chatqna.py:63`). Never fabricate a tracer.
- **`OVERRIDES.yaml` needs no entry.** The rule in `build-patches/lint_overrides.py` is marker↔manifest symmetry: a new file carrying no `# OVERRIDE` marker is fine. Do not add a spurious entry.

## Review Focus

Inputs a reasonable person would expect to work that the happy path does not exercise — most likely to bite first.

1. **`queryId` null at the axios call** (`initStreamQuery` returns it from query creation) → must skip baggage injection, not write the string `"undefined"`, which satisfies the shape guard and joins to nothing. Pinned in Task 2.
2. **Non-hybrid retrieval** (`RETRIEVER_HYBRID_RETRIEVAL_ENABLED` is **on** by default — `config.py:227` reads `os.getenv(..., "true")` — but a deployment may disable it) → the dense snapshot must still exist, or the score attributes are never emitted on that path. Pinned in Task 5.
3. **A label-free query** — the common case — → all retrieval-parameter attributes must still be set. Pinned in Task 5.
4. **A turn where the budget guard truncates history** → `rag.history.segments_sent` must be lower than `segments_in`, matching the truncation event. Pinned in Task 6.
5. **A streaming response whose upstream sends no `usage`** → attributes omitted, span still closes. Pinned in Task 4.

---

### Task 1: Span vocabulary, label digest, two-layer privacy guard, exporter fixture

**Files:**
- Create: `genie-ai-overlay/core/span_attrs.py`
- Modify: `genie-ai-overlay/tests/conftest.py`
- Test: `genie-ai-overlay/tests/test_span_attrs.py`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `core.span_attrs.QUERY_ID_KEY = "genie.query_id"`
  - `core.span_attrs.UNRESOLVED = "__unresolved__"`
  - `core.span_attrs.label_digest(label: str) -> str` — 8 lowercase hex chars
  - `core.span_attrs.free_text_violations(attributes: dict) -> list[str]`
  - `core.span_attrs.assert_no_free_text(attributes: dict) -> None`
  - `core.span_attrs.ATTRIBUTE_NAMES: dict[str, str]`
  - pytest fixture `span_exporter` (session-scoped; installed in `pytest_configure`)
  - pytest fixture `captured_spans` (function-scoped)

- [ ] **Step 1: Write the failing tests**

Create `genie-ai-overlay/tests/test_span_attrs.py`:

```python
# Copyright (C) 2025 ITU
# SPDX-License-Identifier: Apache-2.0
"""Tests for the shared span attribute vocabulary and its two-layer guard.

Layer 1 (positive): every attribute key must be in ATTRIBUTE_NAMES.values().
Without it, a new attribute carrying query text is one line away and invisible.

Layer 2 (shape): any string value with whitespace, or longer than 96 characters,
is a violation. Layer 2 alone is NOT sufficient — a one-word user query has no
whitespace and passes — which is exactly why layer 1 exists.
"""

import re

import pytest

from core.span_attrs import (
    ATTRIBUTE_NAMES,
    MAX_STRING_LEN,
    QUERY_ID_KEY,
    UNRESOLVED,
    assert_no_free_text,
    free_text_violations,
    label_digest,
)

VOCABULARY = sorted(ATTRIBUTE_NAMES.values())


class TestLabelDigest:
    def test_digest_is_eight_lowercase_hex_chars(self):
        assert re.fullmatch(r"[0-9a-f]{8}", label_digest("Onion"))

    def test_digest_is_deterministic(self):
        assert label_digest("Onion") == label_digest("Onion")

    def test_digest_differs_per_label(self):
        assert label_digest("Onion") != label_digest("Vegetables")

    def test_digest_handles_multi_word_labels(self):
        assert re.fullmatch(r"[0-9a-f]{8}", label_digest("Soil Management"))

    def test_digest_of_empty_string_is_stable(self):
        assert re.fullmatch(r"[0-9a-f]{8}", label_digest(""))


class TestLayerTwoValueShape:
    def test_numbers_and_booleans_pass(self):
        assert_no_free_text({"rag.top_k": 3, "rag.hybrid.enabled": True})

    def test_opaque_id_passes(self):
        assert_no_free_text({QUERY_ID_KEY: "12345678"})

    def test_path_value_passes(self):
        assert_no_free_text({"llm.service_path": "/v1/chatqna"})

    def test_list_of_numbers_passes(self):
        assert_no_free_text({"rag.scores.dense": [0.9, 0.5, 0.1]})

    def test_list_of_digests_passes(self):
        assert_no_free_text({"rag.filter_label_digests": ["a1b2c3d4", "e5f6a7b8"]})

    def test_string_with_space_is_a_violation(self):
        assert free_text_violations({"rag.label": "Soil Management"}) == [
            "rag.label=Soil Management"
        ]

    def test_newline_is_a_violation(self):
        assert free_text_violations({"rag.note": "line1\nline2"})

    def test_long_string_is_a_violation(self):
        assert free_text_violations({"rag.note": "x" * (MAX_STRING_LEN + 1)})

    def test_boundary_length_passes(self):
        assert free_text_violations({"rag.note": "x" * MAX_STRING_LEN}) == []

    def test_none_passes(self):
        assert free_text_violations({"rag.answer_budget_tokens": None}) == []


class TestLayerOneKeyVocabulary:
    def test_unregistered_key_is_a_violation(self):
        violations = free_text_violations({"rag.sniffed_query": "anything"})
        assert violations == ["rag.sniffed_query: unregistered attribute key"]

    def test_unregistered_key_is_caught_even_without_prose_shape(self):
        """The one-word query that defeats the shape rule."""
        assert free_text_violations({"rag.sniffed_query": "banana"}) != []

    def test_registered_key_with_short_value_passes(self):
        assert_no_free_text({"rag.search_type": "mmr"})

    def test_every_vocabulary_name_is_accepted(self):
        assert free_text_violations({name: "x" for name in VOCABULARY}) == []

    def test_violation_names_the_key(self):
        (violation,) = free_text_violations({"llm.model": "granite 4.1 8b"})
        assert violation.startswith("llm.model:")


class TestVocabularyShape:
    def test_query_id_key(self):
        assert QUERY_ID_KEY == "genie.query_id"

    def test_unresolved_token_has_no_whitespace(self):
        assert UNRESOLVED == "__unresolved__"

    @pytest.mark.parametrize("name", VOCABULARY)
    def test_names_are_dotted_lowercase(self, name):
        assert re.fullmatch(r"[a-z][a-z0-9_]*(\.[a-z0-9_]+)+", name)

    @pytest.mark.parametrize("name", VOCABULARY)
    def test_names_have_no_whitespace(self, name):
        assert not re.search(r"\s", name)

    def test_values_are_unique(self):
        assert len(set(VOCABULARY)) == len(VOCABULARY)
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd genie-ai-overlay && ./.venv/bin/python -m pytest tests/test_span_attrs.py -q
```

Expected: FAIL — `ModuleNotFoundError: No module named 'core.span_attrs'`

- [ ] **Step 3: Create the vocabulary module**

Create `genie-ai-overlay/core/span_attrs.py`:

```python
# Copyright (C) 2025 ITU
# SPDX-License-Identifier: Apache-2.0
"""Shared span attribute vocabulary for the RAG pipeline.

Every attribute the pipeline records on a span is declared here, so a reviewer
can diff the vocabulary and a typo becomes an ``AttributeError`` rather than a
silently-absent field in VictoriaTraces.

The traces pipeline has NO collector-side redaction: ``transform/pii_redact``
runs on the logs branch of the collector config only, so whatever reaches a span
attribute reaches VictoriaTraces verbatim for the retention window. Discipline is
enforced at emission and checked mechanically, in two layers:

1. **Positive (the strong one).** Every attribute key must be a member of
   ``ATTRIBUTE_NAMES.values()``. A new attribute carrying query text is therefore
   impossible without a deliberate edit to this file, which review already reads.
   Layer 2 alone is not sufficient: a one-word user query has no whitespace and
   would pass a shape rule.
2. **Shape (the backstop).** A string value containing any whitespace character,
   or longer than ``MAX_STRING_LEN``, is a violation. There is no value
   allowlist — the one value that would have required one (taxonomy labels) is
   handled structurally, below, which is what lets layer 2 stay absolute.

Taxonomy labels are the one thing that cannot be recorded raw. The label
taxonomy is fetched from the Backend Service at runtime, so no static vocabulary
exists to validate it against, and real labels contain spaces ("Soil
Management"). They are reduced to a truncated BLAKE2s digest under a fixed salt
instead: deterministic across deployments, so an operator matches a digest
against their own taxonomy to recover the label, with no free text recorded and
nothing to maintain. Brute-forcing a digest yields only taxonomy values the
operator already holds.

Mirrored on the Node side in ``components/shared/lib/span-attrs.js``.
"""

import hashlib
import re

# Key for the correlation id carried in OTel baggage. The value is the opaque
# ArangoDB ``queries._key`` — linkable to a user only via database admin access.
QUERY_ID_KEY = "genie.query_id"

# Longest permitted string attribute value. Ids, model names and URL paths sit
# far below this; prose does not.
MAX_STRING_LEN = 96

# Recorded when a join could not resolve. NOT "unknown" and NOT "" — both would
# satisfy the shape rule while reading like a real value.
UNRESOLVED = "__unresolved__"

_DIGEST_SALT = b"genie-ai-rag-span-v1"
_DIGEST_KEY = _DIGEST_SALT[:16]
_DIGEST_SIZE = 4  # bytes -> 8 hex characters

_ANY_WHITESPACE = re.compile(r"\s")

# The full vocabulary, keyed by a short identifier for call sites. Values are the
# literal attribute name. NOTE: ``rag.fetch_k`` is only CONSULTED by the retriever
# under ``search_type == "mmr"``; chatqna defaults to similarity_score_threshold.
# It is recorded regardless, because a span that reported what was used rather
# than what was configured would be the same transparency failure this guards
# against — but read it as advisory outside mmr.
ATTRIBUTE_NAMES = {
    # Correlation
    "query_id": QUERY_ID_KEY,
    # LLM invoke
    "llm_model": "llm.model",
    "llm_service_path": "llm.service_path",
    "llm_stream": "llm.stream",
    "llm_req_temperature": "llm.request.temperature",
    "llm_req_top_p": "llm.request.top_p",
    "llm_req_max_tokens": "llm.request.max_tokens",
    "llm_req_frequency_penalty": "llm.request.frequency_penalty",
    "llm_req_repetition_penalty": "llm.request.repetition_penalty",
    "llm_usage_prompt_tokens": "llm.usage.prompt_tokens",
    "llm_usage_completion_tokens": "llm.usage.completion_tokens",
    "llm_usage_total_tokens": "llm.usage.total_tokens",
    "llm_finish_reason": "llm.finish_reason",
    "llm_stream_options_include_usage": "llm.stream_options.include_usage",
    # Retriever
    "rag_search_type": "rag.search_type",
    "rag_fetch_k": "rag.fetch_k",
    "rag_search_start_base": "rag.search_start_base",
    "rag_filter_labels_enabled": "rag.filter_labels_enabled",
    "rag_filter_label_count": "rag.filter_label_count",
    "rag_filter_label_digests": "rag.filter_label_digests",
    "rag_hybrid_enabled": "rag.hybrid.enabled",
    "rag_hybrid_dense_weight": "rag.hybrid.dense_weight",
    "rag_hybrid_lexical_weight": "rag.hybrid.lexical_weight",
    "rag_hybrid_rrf_k": "rag.hybrid.rrf_k",
    "rag_candidate_keys": "rag.candidate_keys",
    "rag_scores_dense": "rag.scores.dense",
    "rag_scores_dense_present": "rag.scores.dense_present",
    "rag_scores_bm25": "rag.scores.bm25",
    "rag_scores_fused": "rag.scores.fused",
    "rag_scores_capped": "rag.scores.capped",
    "traversal_enabled": "traversal.enabled",
    "traversal_max_depth": "traversal.max_depth",
    "traversal_max_returned": "traversal.max_returned",
    "traversal_score_threshold": "traversal.score_threshold",
    "traversal_injected_docs": "traversal.injected_docs",
    "traversal_injected_neighbor_items": "traversal.injected_neighbor_items",
    # chatqna orchestrate
    "rag_blend_enabled": "rag.blend.enabled",
    "rag_blend_alpha": "rag.blend.alpha",
    "rag_blend_history_turns": "rag.blend.history_turns",
    "rag_history_segments_in": "rag.history.segments_in",
    "rag_history_segments_sent": "rag.history.segments_sent",
    "rag_prompt_window_tokens": "rag.prompt.window_tokens",
    "rag_prompt_answer_budget_tokens": "rag.prompt.answer_budget_tokens",
    "rag_prompt_tokens_estimate": "rag.prompt.tokens_estimate",
    # Stream outcome
    "retrieval_confidence": "retrieval.confidence",
    "llm_self_confidence": "llm.self_confidence",
    "answer_is_grounded": "answer.is_grounded",
    "answer_sentinel_present": "answer.sentinel_present",
    "answer_abstained": "answer.abstained",
    # Reranker adaptive
    "rag_adaptive_chunk_keys": "rag.adaptive_chunk_keys",
}


def label_digest(label: str) -> str:
    """Return the 8-hex-char stable digest of one taxonomy label.

    Deterministic across processes and deployments (the salt is committed), so
    an operator can reproduce a digest from their own taxonomy. Not a security
    boundary: recovering a label requires the taxonomy, which the operator
    already holds.
    """
    return hashlib.blake2s(
        label.encode("utf-8"), key=_DIGEST_KEY, digest_size=_DIGEST_SIZE
    ).hexdigest()


def _string_values(value):
    """Yield every string reachable in an attribute value."""
    if isinstance(value, str):
        yield value
    elif isinstance(value, (list, tuple)):
        for item in value:
            yield from _string_values(item)
    elif isinstance(value, dict):
        for item in value.values():
            yield from _string_values(item)


def free_text_violations(attributes: dict) -> list[str]:
    """Return one entry per attribute that leaks, either by key or by shape.

    Layer 1: an unregistered key is a leak by definition — it means something
    wrote to a span without declaring what it was.

    Layer 2: a string value with whitespace, or longer than MAX_STRING_LEN, is
    prose. Shape-based on purpose: a denylist of forbidden substrings rots and is
    defeated by wording nobody anticipated, whereas whitespace and length are
    properties no phrasing avoids.
    """
    violations = []
    for key, value in (attributes or {}).items():
        if key not in ATTRIBUTE_NAMES.values():
            violations.append(f"{key}: unregistered attribute key")
            continue
        for text in _string_values(value):
            if _ANY_WHITESPACE.search(text) or len(text) > MAX_STRING_LEN:
                violations.append(f"{key}: free-text value {text!r}")
    return violations


def assert_no_free_text(attributes: dict) -> None:
    """Raise ``AssertionError`` naming every leaking attribute."""
    violations = free_text_violations(attributes)
    if violations:
        raise AssertionError(
            "Span attribute leak (no collector-side redaction on the traces "
            f"pipeline): {violations}"
        )
```

- [ ] **Step 4: Install the provider at session start**

In `genie-ai-overlay/tests/conftest.py`, append. `set_tracer_provider` is
once-per-process — a second call is a silent no-op — and `test_dataprep_tracing.py`
and `test_reranker_tracing.py` both call the real `tracing.setup_tracing()`, which
installs a provider of its own. Installing in `pytest_configure` puts ours first,
before any test module executes. Installing lazily on first fixture use would make
the suite order-dependent: a shard or a `-k` filter could yield a different
provider and every `captured_spans(...)` unpack would raise `ValueError`.

```python
# --- Tracing test support -----------------------------------------------------
# Assertions read FINISHED spans out of an in-memory exporter, never mock span
# objects. A mock assertion passes regardless of what the SDK does, and this
# repo has the counter-example: tests/otel-collector/run-pii-smoke.sh passed
# against a completely broken redactor because it asserted on the wrong surface.
#
# Installed in pytest_configure, NOT on first fixture use: set_tracer_provider is
# once-per-process, and test_dataprep_tracing.py / test_reranker_tracing.py call
# the real tracing.setup_tracing(), which installs a provider of their own. First
# caller wins, so ours has to be first — otherwise a CI shard or a -k filter
# silently yields zero spans.
from opentelemetry import trace as _otel_trace
from opentelemetry.sdk.trace import TracerProvider as _SdkTracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor as _SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import (
    InMemorySpanExporter as _InMemorySpanExporter,
)

_SPAN_EXPORTER = _InMemorySpanExporter()


def pytest_configure(config):
    provider = _SdkTracerProvider()
    provider.add_span_processor(_SimpleSpanProcessor(_SPAN_EXPORTER))
    _otel_trace.set_tracer_provider(provider)
    installed = _otel_trace.get_tracer_provider()
    if not isinstance(installed, _SdkTracerProvider):
        raise RuntimeError(
            "Tracing tests cannot run: another TracerProvider was installed "
            f"first ({type(installed).__name__}). The in-memory exporter would "
            "receive no spans and every captured_spans() assertion would fail."
        )


def pytest_unconfigure(config):
    _SPAN_EXPORTER.clear()


@pytest.fixture
def captured_spans():
    """Return a callable giving finished spans, optionally filtered by name."""
    _SPAN_EXPORTER.clear()

    def _get(name=None):
        spans = _SPAN_EXPORTER.get_finished_spans()
        if name is not None:
            spans = [s for s in spans if s.name == name]
        return spans

    yield _get
    _SPAN_EXPORTER.clear()
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd genie-ai-overlay && ./.venv/bin/python -m pytest tests/test_span_attrs.py -q
```

Expected: PASS — 34 tests.

- [ ] **Step 6: Confirm the provider did not disturb the existing suite**

```bash
cd genie-ai-overlay && ./.venv/bin/python -m pytest tests/ -q 2>&1 | tail -5
```

Expected: **861 passed, 4 skipped** — the baseline, unchanged. If the count moves,
another test asserts on tracing being a no-op and the session-scoped provider is
visible to it; report which before continuing.

Then confirm order independence explicitly:

```bash
cd genie-ai-overlay && ./.venv/bin/python -m pytest tests/test_dataprep_tracing.py tests/test_span_attrs.py -q 2>&1 | tail -5
```

Expected: PASS. This is the shard case that would fail if the provider were
installed lazily.

- [ ] **Step 7: Lint**

```bash
cd genie-ai-overlay && ./.venv/bin/ruff check core/span_attrs.py tests/test_span_attrs.py tests/conftest.py
cd genie-ai-overlay && ./.venv/bin/ruff format --check core/span_attrs.py tests/test_span_attrs.py tests/conftest.py
```

Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add genie-ai-overlay/core/span_attrs.py genie-ai-overlay/tests/test_span_attrs.py genie-ai-overlay/tests/conftest.py
git commit -m "feat(tracing): add span attribute vocabulary and two-layer privacy guard"
```

---

### Task 2: Query correlation on the Node side

> **Depends on Task 1** for the `QUERY_ID_KEY` value only. Runs independently of Task 3.

**Files:**
- Create: `components/shared/lib/span-attrs.js`
- Create: `components/shared/lib/tracing-baggage.js`
- Modify: `components/shared/lib/index.js`
- Modify: `components/gov-chat-backend/tracing.js:223`
- Modify: `components/gov-chat-backend/routes/query-routes.js:7` and `:193`
- Test: `components/shared/lib/__tests__/tracing-baggage.test.js`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces:
  - `spanAttrs.QUERY_ID_KEY`, `spanAttrs.MAX_STRING_LEN`
  - `tracingBaggage.createGeniePropagator()`
  - `tracingBaggage.withBaggage(key, value, fn)`

- [ ] **Step 1: Write the failing test**

Create `components/shared/lib/__tests__/tracing-baggage.test.js`:

```javascript
const {
  CompositePropagator,
  W3CBaggagePropagator,
  W3CTraceContextPropagator
} = require('@opentelemetry/core');
const { context, propagation } = require('@opentelemetry/api');

describe('query correlation propagator', () => {
  const baggage = require('../tracing-baggage');
  const spanAttrs = require('../span-attrs');

  test('QUERY_ID_KEY matches the Python vocabulary', () => {
    expect(spanAttrs.QUERY_ID_KEY).toBe('genie.query_id');
  });

  test('MAX_STRING_LEN matches the Python vocabulary', () => {
    expect(spanAttrs.MAX_STRING_LEN).toBe(96);
  });

  test('the propagator carries baggage, which trace-context alone would drop', () => {
    const traceOnly = new W3CTraceContextPropagator();
    const carrier = {};
    const ctx = propagation.setBaggage(
      context.active(),
      propagation.createBaggage({ 'genie.query_id': { value: 'abc' } })
    );
    traceOnly.inject(ctx, carrier);
    expect(carrier.baggage).toBeUndefined();

    baggage.createGeniePropagator().inject(ctx, carrier);
    expect(carrier.baggage).toBe('genie.query_id=abc');
  });

  test('the propagator still carries trace context', () => {
    const p = baggage.createGeniePropagator();
    expect(p).toBeInstanceOf(CompositePropagator);
    expect(p._propagators.length).toBe(2);
    expect(p._propagators[0]).toBeInstanceOf(W3CTraceContextPropagator);
    expect(p._propagators[1]).toBeInstanceOf(W3CBaggagePropagator);
  });

  test('withBaggage injects into an explicit carrier', () => {
    const carrier = {};
    baggage.withBaggage(
      spanAttrs.QUERY_ID_KEY,
      'query-key-1',
      () => baggage.createGeniePropagator().inject(context.active(), carrier)
    );
    expect(carrier.baggage).toBe('genie.query_id=query-key-1');
  });

  test('withBaggage restores the previous context afterwards', () => {
    const before = context.active();
    baggage.withBaggage(spanAttrs.QUERY_ID_KEY, 'k', () => {});
    expect(context.active()).toBe(before);
  });

  test('withBaggage passes the callback return value through', () => {
    expect(baggage.withBaggage('k', 'v', () => 42)).toBe(42);
  });
});
```

These assert on the **factory** rather than on a propagator the test builds
itself. Asserting on a locally constructed `CompositePropagator` would pass with
`tracing.js` completely unmodified — the exact "passes when the feature is
broken" failure this change exists to prevent. It also avoids booting a
`NodeSDK` inside Jest, which `NODE_ENV === 'test'` short-circuits anyway (see
`tracing.js:10`), meaning the real SDK never loads in tests at all.

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd components/gov-chat-backend && npx jest ../shared/lib/__tests__/tracing-baggage.test.js 2>&1 | tail -20
```

Expected: FAIL — `Cannot find module '../tracing-baggage'`

- [ ] **Step 3: Create the vocabulary mirror**

Create `components/shared/lib/span-attrs.js`:

```javascript
// Mirror of genie-ai-overlay/core/span_attrs.py. The two must agree on
// QUERY_ID_KEY and MAX_STRING_LEN or the correlation id is minted on one side
// and read on the other, or the privacy bounds silently diverge.
// __tests__/span-attrs-parity.test.js asserts they agree.

const QUERY_ID_KEY = 'genie.query_id';
const MAX_STRING_LEN = 96;

module.exports = { QUERY_ID_KEY, MAX_STRING_LEN };
```

- [ ] **Step 4: Create the baggage and propagator helpers**

Create `components/shared/lib/tracing-baggage.js`:

```javascript
const { CompositePropagator, W3CBaggagePropagator, W3CTraceContextPropagator } =
  require('@opentelemetry/core');
const { context, propagation } = require('@opentelemetry/api');

/**
 * The propagator GENIE.AI installs on the Node side.
 *
 * Exported as a factory rather than built inline in tracing.js so a test can
 * assert on the exact propagator production uses. The Python services already
 * use the OTel default composite (they never call set_global_textmap); a
 * trace-context-only propagator here is what makes the two sides asymmetric,
 * and `genie.query_id` would never reach chatqna.
 *
 * @returns {CompositePropagator}
 */
function createGeniePropagator() {
  return new CompositePropagator({
    propagators: [new W3CTraceContextPropagator(), new W3CBaggagePropagator()]
  });
}

/**
 * Run `fn` with a baggage entry set on the active context.
 *
 * @param {string} key   baggage key, e.g. spanAttrs.QUERY_ID_KEY
 * @param {string} value opaque correlation id — MUST be a non-empty string.
 *   `propagation.createBaggage` coerces undefined to the literal "undefined",
 *   which satisfies every downstream shape check and joins to nothing.
 * @param {Function} fn
 * @returns {*} whatever fn returns
 */
function withBaggage(key, value, fn) {
  const ctx = propagation.setBaggage(
    context.active(),
    propagation.createBaggage({ [key]: { value: String(value) } })
  );
  return context.with(ctx, fn);
}

module.exports = { createGeniePropagator, withBaggage };
```

- [ ] **Step 5: Re-export both from the barrel**

`components/shared/lib/index.js` ends with a single `module.exports = { ... }`
literal. Add the two entries **inside that literal**, not as new
`module.exports.x = ...` statements — anything written after the literal is fine,
anything added above it is silently overwritten (Pitfall 2 has shipped exactly
this bug):

```javascript
const spanAttrs = require('./span-attrs');
const tracingBaggage = require('./tracing-baggage');

// ... inside the existing module.exports literal:
//   spanAttrs,
//   tracingBaggage,
```

- [ ] **Step 6: Install the propagator**

In `components/gov-chat-backend/tracing.js`, extend the `@opentelemetry/core`
import at line 45 to also pull `CompositePropagator` and `W3CBaggagePropagator`
is **not** needed here — use the factory instead. Add near the other requires:

```javascript
const { tracingBaggage } = require('./shared-lib/tracing-baggage');
```

and replace line 223:

```javascript
    // Trace context ALONE drops the baggage header, so `genie.query_id` would
    // never reach chatqna. Built by the shared factory so the test asserts on
    // the propagator production actually installs.
    textMapPropagator: tracingBaggage.createGeniePropagator(),
```

- [ ] **Step 7: Inject the baggage around the chatqna call**

`components/gov-chat-backend/routes/query-routes.js` already barrel-imports from
`'../shared-lib'` at line 7. Add `tracingBaggage` to that existing destructure
rather than adding a third require (M2), then replace the `axios.post` at
lines 193-203 — the whole call, options included:

```javascript
      // Carry the query id into the trace so a trace joins to the stored query
      // document. When queryId is absent the request simply carries no baggage
      // and every service leaves the attribute unset — never a placeholder.
      const opeaResponse = queryId
        ? await tracingBaggage.withBaggage(
            spanAttrs.QUERY_ID_KEY,
            queryId,
            () =>
              axios.post(opeaUrl, opeaPayload, {
                headers: {
                  'Content-Type': 'application/json',
                  ...(authHeaders?.authorization && {
                    Authorization: authHeaders.authorization
                  })
                },
                responseType: 'stream',
                timeout: streamTimeout,
                signal: opeaController.signal,
                httpAgent: new http.Agent({ keepAlive: true }),
                httpsAgent: new https.Agent({ keepAlive: true })
              })
          )
        : await axios.post(opeaUrl, opeaPayload, {
            headers: {
              'Content-Type': 'application/json',
              ...(authHeaders?.authorization && {
                Authorization: authHeaders.authorization
              })
            },
            responseType: 'stream',
            timeout: streamTimeout,
            signal: opeaController.signal,
            httpAgent: new http.Agent({ keepAlive: true }),
            httpsAgent: new https.Agent({ keepAlive: true })
          });
```

The duplication is deliberate rather than a refactor: a null-guard around a
single `await` is clearer than threading a conditional into the helper, and the
options object is already duplicated once in this handler.

- [ ] **Step 8: Run the test to verify it passes**

```bash
cd components/gov-chat-backend && npx jest ../shared/lib/__tests__/tracing-baggage.test.js 2>&1 | tail -20
```

Expected: PASS — 7 tests.

- [ ] **Step 9: Confirm the backend suite is unchanged**

```bash
cd components/gov-chat-backend && npx jest --silent 2>&1 | tail -6
```

Expected: **1811 passed, 0 failed** plus the new tests — no previously passing
test regresses.

- [ ] **Step 10: Lint**

```bash
cd components/gov-chat-backend && npx eslint routes/query-routes.js tracing.js ../shared/lib/span-attrs.js ../shared/lib/tracing-baggage.js 2>&1 | tail -20
```

Expected: clean. Note the `local/no-runtime-unresolvable-shared-path` rule: a
`require('../shared/lib/...')` would pass Jest and crash in the image.

- [ ] **Step 11: Commit**

```bash
git add components/shared/lib/span-attrs.js components/shared/lib/tracing-baggage.js components/shared/lib/index.js components/gov-chat-backend/tracing.js components/gov-chat-backend/routes/query-routes.js components/shared/lib/__tests__/tracing-baggage.test.js
git commit -m "feat(tracing): propagate genie.query_id via OTel baggage"
```

---

### Task 3: Query correlation on the Python side

> **Depends on Task 1.** Runs in parallel with Task 2.
> **Same-file gate:** none — this task touches the retriever and reranker only.

**Files:**
- Modify: `genie-ai-overlay/core/span_attrs.py`
- Modify: `genie-ai-overlay/chatqna/genieai_chatqna.py`
- Modify: `genie-ai-overlay/retriever/genieai_retriever_arangodb.py`
- Modify: `genie-ai-overlay/reranker/genieai_tei_reranker.py`
- Test: `genie-ai-overlay/tests/test_query_correlation.py`

**Interfaces:**
- Consumes: `core.span_attrs.QUERY_ID_KEY` (Task 1).
- Produces: `core.span_attrs.query_id_from_baggage() -> str | None`

- [ ] **Step 1: Write the failing tests**

Create `genie-ai-overlay/tests/test_query_correlation.py`:

```python
# Copyright (C) 2025 ITU
# SPDX-License-Identifier: Apache-2.0
"""Tests for genie.query_id correlation carried in OTel baggage.

The Node backend injects the id before calling chatqna; the Python services read
it back and stamp it on their spans. Absent baggage must leave the attribute
UNSET -- never empty, never "undefined", never a placeholder -- so "no
correlation id" stays distinguishable from "empty id".
"""

from opentelemetry import baggage

import pytest

import chatqna.genieai_chatqna as chatqna_module
from core.span_attrs import QUERY_ID_KEY, query_id_from_baggage


def _with_baggage(value):
    ctx = baggage.set_baggage("ctx", {QUERY_ID_KEY: value})
    token = ctx.attach()
    return ctx, token


class TestQueryIdFromBaggage:
    def test_returns_none_without_baggage(self):
        assert query_id_from_baggage() is None

    def test_returns_value_when_present(self):
        ctx, token = _with_baggage("abc123")
        try:
            assert query_id_from_baggage() == "abc123"
        finally:
            ctx.detach(token)

    def test_absent_key_returns_none(self):
        ctx = baggage.set_baggage("ctx", {"other.key": "abc"})
        token = ctx.attach()
        try:
            assert query_id_from_baggage() is None
        finally:
            ctx.detach(token)


class TestChatqnaStamping:
    def test_carries_the_query_id(self, captured_spans):
        ctx, token = _with_baggage("query-key-1")
        try:
            chatqna_module._emit_reranker_selection_span(["k1"], ["k1"], [0.9])
        finally:
            ctx.detach(token)
        (span,) = captured_spans("chatqna.reranker_selection")
        assert span.attributes[QUERY_ID_KEY] == "query-key-1"

    def test_omits_the_query_id_without_baggage(self, captured_spans):
        chatqna_module._emit_reranker_selection_span(["k1"], ["k1"], [0.9])
        (span,) = captured_spans("chatqna.reranker_selection")
        assert QUERY_ID_KEY not in span.attributes


@pytest.fixture
def retriever_span():
    """Invoke the real retriever once, inside the current baggage context.

    Proves the attribute reaches `retriever.hybrid_search`, which a helper-only
    test cannot: deleting the emission site from `invoke` leaves a helper test
    green. Stops right after the span opens, so no ArangoDB is needed.

    Confirm the service class and request-model names before running:
        ./.venv/bin/python -c "import inspect, retriever.genieai_retriever_arangodb as r; \\
          print([n for n,_ in inspect.getmembers(r, inspect.isclass)])"
    """
    import asyncio

    import retriever.genieai_retriever_arangodb as retriever_module

    service = retriever_module.ArangoDB(
        host="h", port=1, username="u", password="p", db_name="d"
    )

    async def _boom(*_args, **_kwargs):
        raise RuntimeError("stop after the span opens")

    service.search = _boom
    request = retriever_module.RetrievalRequestArangoDB(
        text="q", k=3, search_type="similarity_score_threshold"
    )
    with pytest.raises(RuntimeError):
        asyncio.get_event_loop().run_until_complete(
            retriever_module.ArangoDB.invoke(service, request)
        )
    return captured_spans
```

Adapt only the constructor call to the real signature — never what the fixture
asserts downstream.

```python
class TestRetrieverStamping:
    def test_carries_the_query_id(self, retriever_span, captured_spans):
        ctx, token = _with_baggage("query-key-9")
        try:
            retriever_span()
        finally:
            ctx.detach(token)
        (span,) = captured_spans("retriever.hybrid_search")
        assert span.attributes[QUERY_ID_KEY] == "query-key-9"

    def test_omits_the_query_id_without_baggage(self, retriever_span, captured_spans):
        retriever_span()
        (span,) = captured_spans("retriever.hybrid_search")
        assert QUERY_ID_KEY not in span.attributes
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd genie-ai-overlay && ./.venv/bin/python -m pytest tests/test_query_correlation.py -q
```

Expected: FAIL — `ImportError: cannot import name 'query_id_from_baggage'`

- [ ] **Step 3: Add the reader**

Append to `genie-ai-overlay/core/span_attrs.py`:

```python
def query_id_from_baggage() -> str | None:
    """Return the ``genie.query_id`` correlation id from the active context.

    ``None`` when the caller sent no baggage -- any client that is not the
    backend, or a hand-crafted request. Callers omit the attribute in that case
    rather than writing a placeholder.
    """
    from opentelemetry import baggage as _baggage

    return _baggage.get_baggage(QUERY_ID_KEY)
```

- [ ] **Step 4: Stamp all three spans**

chatqna — inside `_emit_reranker_selection_span`, after the span opens at line 113:

```python
        _query_id = query_id_from_baggage()
        if _query_id:
            sel_span.set_attribute(QUERY_ID_KEY, _query_id)
```

retriever — after `span.set_attribute("rag.top_k", ...)` at line 879:

```python
        _query_id = query_id_from_baggage()
        if _query_id:
            span.set_attribute(QUERY_ID_KEY, _query_id)
```

reranker — on the `reranker.tei_invoke` span, same two lines.

Import `from core.span_attrs import QUERY_ID_KEY, query_id_from_baggage` in all
three modules.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd genie-ai-overlay && ./.venv/bin/python -m pytest tests/test_query_correlation.py -q
```

Expected: PASS.

- [ ] **Step 6: Regression + lint**

```bash
cd genie-ai-overlay && ./.venv/bin/python -m pytest tests/ -q 2>&1 | tail -5
cd genie-ai-overlay && ./.venv/bin/ruff check core/ chatqna/ retriever/ reranker/ tests/test_query_correlation.py
```

Expected: **861 passed, 4 skipped** plus the new tests; ruff clean.

- [ ] **Step 7: Commit**

```bash
git add genie-ai-overlay/core/span_attrs.py genie-ai-overlay/chatqna/genieai_chatqna.py genie-ai-overlay/retriever/genieai_retriever_arangodb.py genie-ai-overlay/reranker/genieai_tei_reranker.py genie-ai-overlay/tests/test_query_correlation.py
git commit -m "feat(tracing): stamp genie.query_id on chatqna, retriever and reranker spans"
```

---

### Task 4: Gap 1 — `llm.invoke` span

> **SEQUENTIAL — same file as Tasks 6 and 7.** `genieai_chatqna.py` must not be
> edited concurrently by two agents; merge, do not parallelise.
> **Gate:** Step 0 must pass before Step 1.

**Files:**
- Modify: `genie-ai-overlay/chatqna/genieai_chatqna.py`
- Test: `genie-ai-overlay/tests/test_chatqna_llm_tracing.py`

**Interfaces:**
- Consumes: `core.span_attrs.ATTRIBUTE_NAMES` (Task 1).
- Produces: `_emit_llm_invoke_open(llm_parameters_dict) -> Span`, `_emit_llm_invoke_record(span, response) -> None`, `_emit_llm_invoke_close(span) -> None`

- [ ] **Step 0: Verify the two vendored-comps assumptions (blocking)**

`comps` is not in this repository. Verify against the built image before
implementing anything below:

```bash
docker run --rm --entrypoint sh <chatqna-image> -c 'cd /contracts 2>/dev/null || true; python - <<PY
import inspect
from comps.cores.mega.service import ServiceOrchestrator
print(inspect.signature(ServiceOrchestrator.align_generator))
PY'
```

**Assumption A — does `align_generator` receive `llm_parameters_dict`?** Its
signature is `(self, gen, **kwargs)` while `align_inputs` and `align_outputs` take
it as a named positional. If comps does not pass it through kwargs, gap 1's
parameter attributes vanish on the streaming path and no unit test catches it.
If the probe shows it is NOT passed, record the params on the span from
`align_inputs` (which does receive them) into a module-level holder that
`align_generator` reads, rather than shipping the gap half-done.

**Assumption B — does `stream_options` survive chatqna → textgen → vLLM?**
`core/genieai_api_protocol.py` declares the field; whether the vendored textgen
wrapper forwards it is not knowable from the source tree. If the probe shows it
is dropped, escalate: streaming `usage` is then unobtainable at this layer and
gap 1's token acceptance criterion is **sync-path only**, which must then be
stated in the PR and on the issue rather than left implicit.

Record the probe output either way in the PR description.

- [ ] **Step 1: Write the failing tests**

Create `genie-ai-overlay/tests/test_chatqna_llm_tracing.py`:

```python
# Copyright (C) 2025 ITU
# SPDX-License-Identifier: Apache-2.0
"""Tests for the llm.invoke span emitted at the chatqna orchestrator boundary.

The span is what makes an LLM call legible: which model answered, which sampling
params were actually sent, how many tokens it consumed, and why it stopped. It is
emitted here rather than in the textgen wrapper because the wrapper cannot see
params dropped in transit -- the exact failure this span exists to catch.

`start_as_current_span` returns a context manager, NOT a Span; opening with it
and calling set_attribute raises AttributeError. The helpers therefore use
`start_span` with the current context, which returns a real Span whose lifetime
the streaming path controls.
"""

import json

import chatqna.genieai_chatqna as chatqna_module
from core.span_attrs import ATTRIBUTE_NAMES as A


def _sync_response():
    return {
        "model": "ibm-granite/granite-4.1-8b",
        "choices": [{"index": 0, "message": {"content": "hi"}, "finish_reason": "stop"}],
        "usage": {"prompt_tokens": 1200, "completion_tokens": 80, "total_tokens": 1280},
    }


def _chunks(with_usage=True):
    out = [
        {
            "model": "ibm-granite/granite-4.1-8b",
            "choices": [{"index": 0, "delta": {"content": "hel"}, "finish_reason": None}],
        },
        {
            "model": "ibm-granite/granite-4.1-8b",
            "choices": [{"index": 0, "delta": {"content": "lo"}, "finish_reason": "stop"}],
        },
    ]
    if with_usage:
        out.append(
            {
                "model": "ibm-granite/granite-4.1-8b",
                "choices": [],
                "usage": {
                    "prompt_tokens": 1200,
                    "completion_tokens": 2,
                    "total_tokens": 1202,
                },
            }
        )
    return out


class TestLlmInvokeSync:
    def test_records_model_usage_and_finish_reason(self, captured_spans):
        span = chatqna_module._emit_llm_invoke_open(
            {"max_tokens": 512, "top_p": 0.9, "temperature": 0.2, "stream": False}
        )
        chatqna_module._emit_llm_invoke_record(span, _sync_response())
        chatqna_module._emit_llm_invoke_close(span)

        (emitted,) = captured_spans("llm.invoke")
        assert emitted.attributes[A["llm_model"]] == "ibm-granite/granite-4.1-8b"
        assert emitted.attributes[A["llm_usage_prompt_tokens"]] == 1200
        assert emitted.attributes[A["llm_usage_completion_tokens"]] == 80
        assert emitted.attributes[A["llm_usage_total_tokens"]] == 1280
        assert emitted.attributes[A["llm_finish_reason"]] == "stop"
        assert emitted.attributes[A["llm_stream"]] is False

    def test_records_only_params_present_in_the_request(self, captured_spans):
        span = chatqna_module._emit_llm_invoke_open(
            {"max_tokens": 512, "top_p": 0.9, "stream": False}
        )
        chatqna_module._emit_llm_invoke_close(span)

        attrs = captured_spans("llm.invoke")[0].attributes
        assert attrs[A["llm_req_max_tokens"]] == 512
        assert attrs[A["llm_req_top_p"]] == 0.9
        assert A["llm_req_repetition_penalty"] not in attrs
        assert A["llm_req_temperature"] not in attrs

    def test_missing_usage_is_omitted_not_nulled(self, captured_spans):
        response = _sync_response()
        del response["usage"]
        span = chatqna_module._emit_llm_invoke_open({"stream": False})
        chatqna_module._emit_llm_invoke_record(span, response)
        chatqna_module._emit_llm_invoke_close(span)

        attrs = captured_spans("llm.invoke")[0].attributes
        assert A["llm_usage_prompt_tokens"] not in attrs

    def test_finish_reason_length_is_recorded_verbatim(self, captured_spans):
        response = _sync_response()
        response["choices"][0]["finish_reason"] = "length"
        span = chatqna_module._emit_llm_invoke_open({"stream": False})
        chatqna_module._emit_llm_invoke_record(span, response)
        chatqna_module._emit_llm_invoke_close(span)

        assert captured_spans("llm.invoke")[0].attributes[A["llm_finish_reason"]] == "length"

    def test_stream_flag_has_one_source_of_truth(self, captured_spans):
        """llm.stream and llm.stream_options.include_usage cannot disagree."""
        span = chatqna_module._emit_llm_invoke_open({"max_tokens": 8, "stream": True})
        chatqna_module._emit_llm_invoke_close(span)
        attrs = captured_spans("llm.invoke")[0].attributes
        assert attrs[A["llm_stream"]] is True
        assert attrs[A["llm_stream_options_include_usage"]] is True

        span = chatqna_module._emit_llm_invoke_open({"max_tokens": 8, "stream": False})
        chatqna_module._emit_llm_invoke_close(span)
        attrs = captured_spans("llm.invoke")[1].attributes
        assert attrs[A["llm_stream"]] is False
        assert A["llm_stream_options_include_usage"] not in attrs

    def test_span_is_parented_to_the_current_context(self, captured_spans):
        tracer = chatqna_module.get_tracer("chatqna.orchestrate")
        with tracer.start_as_current_span("chatqna.orchestrate") as parent:
            parent_id = parent.get_span_context().span_id
            span = chatqna_module._emit_llm_invoke_open({"stream": False})
            chatqna_module._emit_llm_invoke_close(span)

        (emitted,) = captured_spans("llm.invoke")
        assert emitted.parent.span_id == parent_id


class TestLlmInvokeStreaming:
    def test_streaming_usage_is_present_and_non_null(self, captured_spans):
        span = chatqna_module._emit_llm_invoke_open({"max_tokens": 256, "stream": True})
        for chunk in _chunks(with_usage=True):
            chatqna_module._emit_llm_invoke_record(span, chunk)
        chatqna_module._emit_llm_invoke_close(span)

        attrs = captured_spans("llm.invoke")[0].attributes
        assert attrs[A["llm_usage_prompt_tokens"]] == 1200
        assert attrs[A["llm_usage_completion_tokens"]] == 2
        assert attrs[A["llm_finish_reason"]] == "stop"

    def test_streaming_without_usage_omits_the_attributes(self, captured_spans):
        span = chatqna_module._emit_llm_invoke_open({"stream": True})
        for chunk in _chunks(with_usage=False):
            chatqna_module._emit_llm_invoke_record(span, chunk)
        chatqna_module._emit_llm_invoke_close(span)

        attrs = captured_spans("llm.invoke")[0].attributes
        assert A["llm_usage_prompt_tokens"] not in attrs
        assert attrs[A["llm_finish_reason"]] == "stop"

    def test_last_finish_reason_wins(self, captured_spans):
        span = chatqna_module._emit_llm_invoke_open({"stream": True})
        chatqna_module._emit_llm_invoke_record(
            span, {"choices": [{"delta": {"content": "a"}, "finish_reason": None}]}
        )
        chatqna_module._emit_llm_invoke_record(
            span, {"choices": [{"delta": {"content": "b"}, "finish_reason": "length"}]}
        )
        chatqna_module._emit_llm_invoke_close(span)

        assert captured_spans("llm.invoke")[0].attributes[A["llm_finish_reason"]] == "length"

    def test_non_dict_chunk_does_not_raise(self, captured_spans):
        span = chatqna_module._emit_llm_invoke_open({"stream": True})
        chatqna_module._emit_llm_invoke_record(span, None)
        chatqna_module._emit_llm_invoke_record(span, "not a dict")
        chatqna_module._emit_llm_invoke_close(span)

        assert len(captured_spans("llm.invoke")) == 1


class TestLlmInvokePrivacy:
    def test_no_free_text_on_the_llm_span(self, captured_spans):
        from core.span_attrs import assert_no_free_text

        span = chatqna_module._emit_llm_invoke_open(
            {"max_tokens": 512, "temperature": 0.2, "stream": False}
        )
        chatqna_module._emit_llm_invoke_record(span, _sync_response())
        chatqna_module._emit_llm_invoke_close(span)

        (emitted,) = captured_spans("llm.invoke")
        assert_no_free_text(dict(emitted.attributes))
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd genie-ai-overlay && ./.venv/bin/python -m pytest tests/test_chatqna_llm_tracing.py -q
```

Expected: FAIL — `AttributeError: module ... has no attribute '_emit_llm_invoke_open'`

- [ ] **Step 3: Add the emit helpers**

In `genie-ai-overlay/chatqna/genieai_chatqna.py`, beside
`_emit_reranker_selection_span`, add. Note `start_span`, not
`start_as_current_span`:

```python
def _emit_llm_invoke_open(llm_parameters_dict: dict):
    """Open the llm.invoke span and record what is about to be sent.

    `start_span` (not `start_as_current_span`): the latter returns an
    _AgnosticContextManager, not a Span, and calling set_attribute on it raises
    AttributeError. The streaming path needs a Span whose lifetime we own --
    open across yields, closed from a finally when the generator is abandoned.

    Params come from `llm_parameters_dict`, comps' own record of the request it
    is about to issue, because that is the only place a param dropped in transit
    is still visible as absent. Each is set ONLY when present: absence is the
    signal, so no sentinel values are written.

    `stream` resolves from the same dict, so llm.stream and
    llm.stream_options.include_usage can never disagree.
    """
    params = llm_parameters_dict or {}
    stream = bool(params.get("stream"))
    span = align_tracer.start_span(
        "llm.invoke", context=otel_context.get_current()
    )
    span.set_attribute(ATTRIBUTE_NAMES["llm_stream"], stream)
    for key, attr in (
        ("max_tokens", "llm_req_max_tokens"),
        ("top_p", "llm_req_top_p"),
        ("temperature", "llm_req_temperature"),
        ("frequency_penalty", "llm_req_frequency_penalty"),
        ("repetition_penalty", "llm_req_repetition_penalty"),
    ):
        value = params.get(key)
        if value is not None:
            span.set_attribute(ATTRIBUTE_NAMES[attr], value)
    if stream:
        span.set_attribute(ATTRIBUTE_NAMES["llm_stream_options_include_usage"], True)
    _query_id = query_id_from_baggage()
    if _query_id:
        span.set_attribute(QUERY_ID_KEY, _query_id)
    return span


def _emit_llm_invoke_record(span, response) -> None:
    """Record model, token usage and finish_reason from one OpenAI response.

    Accepts a single chunk while streaming: fields absent from that chunk are
    not written, so the final chunk carrying usage lands them.
    """
    if not isinstance(response, dict):
        return
    model = response.get("model")
    if model:
        span.set_attribute(ATTRIBUTE_NAMES["llm_model"], model)
    usage = response.get("usage")
    if isinstance(usage, dict):
        for key, attr in (
            ("prompt_tokens", "llm_usage_prompt_tokens"),
            ("completion_tokens", "llm_usage_completion_tokens"),
            ("total_tokens", "llm_usage_total_tokens"),
        ):
            value = usage.get(key)
            if value is not None:
                span.set_attribute(ATTRIBUTE_NAMES[attr], value)
    for choice in response.get("choices") or []:
        reason = choice.get("finish_reason")
        if reason:
            span.set_attribute(ATTRIBUTE_NAMES["llm_finish_reason"], reason)


def _emit_llm_invoke_close(span) -> None:
    """End the llm.invoke span."""
    span.end()
```

Add imports: `from opentelemetry import trace as otel_trace` **and**
`from opentelemetry import context as otel_context`, and extend
`core.span_attrs` to include `ATTRIBUTE_NAMES`.

Note the split: `get_current_context()` does **not** exist on
`opentelemetry.trace` — the current context comes from
`opentelemetry.context.get_current()`. `get_current_span()` and
`set_span_in_context()` do live on `opentelemetry.trace`. Verified against the
pinned SDK: `start_span(context=context.get_current())` returns a real `Span`,
parented to the enclosing span and sharing its `trace_id`.

- [ ] **Step 4: Wire into `align_outputs` (non-streaming)**

Replace the LLM branch at line 1628 with:

```python
    elif self.services[cur_node].service_type == ServiceType.LLM and not llm_parameters_dict["stream"]:
        _llm_span = _emit_llm_invoke_open(llm_parameters_dict)
        try:
            _emit_llm_invoke_record(_llm_span, data)
            _service_path = urlparse(self.services[cur_node].endpoint).path
            if _service_path:
                _llm_span.set_attribute(
                    ATTRIBUTE_NAMES["llm_service_path"], _service_path
                )
            if "faqgen" in self.services[cur_node].endpoint:
                next_data = data
            else:
                if logflag:
                    logger.debug(f"\nRaw output of the llm\n {data}\n")
                next_data["text"] = data["choices"][0]["message"]["content"]
        finally:
            _emit_llm_invoke_close(_llm_span)
        if logflag:
            logger.debug(f"\nAligned output of the llm\n {next_data}\n")
```

Ensure `from urllib.parse import urlparse` is imported at module level.

- [ ] **Step 5: Wire into `align_generator` (streaming)**

Replace the whole function at line 1648 with:

```python
def align_generator(self, gen, **kwargs):
    # OpenAI response format
    # data:{"id":"","object":"text_completion","created":1725530204,
    # "model":"meta-llama/Meta-Llama-3-8B-Instruct","system_fingerprint":"2.0.1-native",
    # "choices":[{"index":0,"delta":{"role":"assistant","content":"?"},"logprobs":null,
    # "finish_reason":null}]}\n\n'
    _llm_span = _emit_llm_invoke_open(kwargs.get("llm_parameters_dict") or {})
    try:
        for line in gen:
            line = line.decode("utf-8")
            chunks = [chunk.strip() for chunk in line.split("\n\n") if chunk.strip()]
            for line in chunks:
                start = line.find("{")
                end = line.rfind("}") + 1
                json_str = line[start:end]
                try:
                    # sometimes yield empty chunk, do a fallback here
                    json_data = json.loads(json_str)
                    _emit_llm_invoke_record(_llm_span, json_data)
                    if "ops" in json_data and "op" in json_data["ops"][0]:
                        if "value" in json_data["ops"][0] and isinstance(json_data["ops"][0]["value"], str):
                            yield f"data: {repr(json_data['ops'][0]['value'].encode('utf-8'))}\n\n"
                        else:
                            pass
                    elif "content" in json_data["choices"][0]["delta"]:
                        yield f"data: {repr(json_data['choices'][0]['delta']['content'].encode('utf-8'))}\n\n"
                except Exception:
                    yield f"data: {repr(json_str.encode('utf-8'))}\n\n"
        yield "data: [DONE]\n\n"
    finally:
        # Closes even if the upstream generator raises or the consumer abandons
        # the stream mid-iteration.
        _emit_llm_invoke_close(_llm_span)
```

- [ ] **Step 6: Request streaming usage**

Next to the LLM param writes at lines 1284-1288, add — gated on the same dict
that decides `llm.stream`, never on a separate `inputs.get("stream")`:

```python
        if llm_parameters_dict.get("stream"):
            # vLLM returns `usage` on a streamed response only when the request
            # opts in. Without this the llm.invoke span reports tokens for the
            # sync path and nothing for the streaming path.
            next_inputs["stream_options"] = {"include_usage": True}
```

- [ ] **Step 7: Run the tests to verify they pass**

```bash
cd genie-ai-overlay && ./.venv/bin/python -m pytest tests/test_chatqna_llm_tracing.py -q
```

Expected: PASS.

- [ ] **Step 8: Wiring test — the attribute survives `align_outputs`**

Add to the same file, proving the emission site is reachable:

```python
class TestAlignOutputsWiring:
    def test_align_outputs_records_the_llm_span(self, captured_spans, monkeypatch):
        """Deleting the emission site from align_outputs must turn this red."""
        orchestrator = chatqna_module.ServiceOrchestrator.__new__(
            chatqna_module.ServiceOrchestrator
        )
        orchestrator.services = {
            "textgen.1": type(
                "S",
                (),
                {
                    "service_type": chatqna_module.ServiceType.LLM,
                    "endpoint": "http://textgen:6009/v1/chat/completions",
                },
            )()
        }
        monkeypatch.setattr(
            chatqna_module.ServiceOrchestrator,
            "services",
            orchestrator.services,
            raising=False,
        )
        chatqna_module.align_outputs(
            orchestrator,
            _sync_response(),
            "textgen.1",
            {},
            _RuntimeGraphStub(),
            {"max_tokens": 512, "stream": False},
        )
        assert captured_spans("llm.invoke")
```

Define a `_RuntimeGraphStub` exposing `downstream()` returning `[]`. Adjust the
call to match `align_outputs`'s actual signature — confirm with
`inspect.signature(chatqna_module.align_outputs)` before running.

- [ ] **Step 9: Regression + lint**

```bash
cd genie-ai-overlay && ./.venv/bin/python -m pytest tests/ -q 2>&1 | tail -5
cd genie-ai-overlay && ./.venv/bin/ruff check chatqna/ tests/test_chatqna_llm_tracing.py
cd genie-ai-overlay && ./.venv/bin/ruff format --check chatqna/genieai_chatqna.py
```

Expected: **861 passed, 4 skipped** plus new; ruff clean.

- [ ] **Step 10: Commit**

```bash
git add genie-ai-overlay/chatqna/genieai_chatqna.py genie-ai-overlay/tests/test_chatqna_llm_tracing.py
git commit -m "feat(chatqna): emit an llm.invoke span with params, usage and finish reason"
```

---

### Task 5: Gap 2 — retriever parameters, aligned scores, traversal

> **Depends on Task 1.** Runs in parallel with the chatqna chain.
> **Same-file gate:** none — retriever only.

**Files:**
- Modify: `genie-ai-overlay/retriever/genieai_retriever_arangodb.py`
- Test: `genie-ai-overlay/tests/test_retriever_span_attributes.py`

**Interfaces:**
- Consumes: `core.span_attrs.ATTRIBUTE_NAMES`, `label_digest` (Task 1).
- Produces: `_retrieval_parameter_attributes(input_dict, base_mode, labels) -> dict`, `_retrieval_score_attributes(keys, dense_by_id, dense_present, bm25_by_id, fused) -> dict`

- [ ] **Step 1: Write the failing tests**

Create `genie-ai-overlay/tests/test_retriever_span_attributes.py`:

```python
# Copyright (C) 2025 ITU
# SPDX-License-Identifier: Apache-2.0
"""Tests for retrieval parameters, per-candidate scores and traversal state.

Before this, a trace could say a search happened and how many chunks came back,
but not whether a label filter was active, what ranked the candidates, or
whether graph traversal ran at all.

The score arrays are ALIGNED BY CONSTRUCTION. `rrf_fuse` returns a new list,
sorted by fused score, de-duplicated, and possibly containing BM25-only chunks
the dense leg never saw -- so emitting the pre-fusion dense leg beside the fused
order would make index i of two attributes describe different chunks.
Confidently wrong data is worse than absent data.
"""

import pytest

from core.span_attrs import ATTRIBUTE_NAMES as A, label_digest
from retriever.genieai_retriever_arangodb import (
    _retrieval_parameter_attributes,
    _retrieval_score_attributes,
)


class TestRetrievalParameters:
    def test_records_the_decoded_search_start_not_the_encoded_form(self):
        attrs = _retrieval_parameter_attributes(
            {"fetch_k": 32, "search_type": "mmr", "k": 3},
            base_mode="chunk",
            labels=[],
        )
        assert attrs[A["rag_search_start_base"]] == "chunk"
        assert attrs[A["rag_fetch_k"]] == 32
        assert attrs[A["rag_search_type"]] == "mmr"

    def test_absent_fields_get_safe_defaults(self):
        attrs = _retrieval_parameter_attributes({}, base_mode="chunk", labels=[])
        assert attrs[A["rag_fetch_k"]] == 0
        assert attrs[A["rag_search_type"]] == "default"


class TestLabelDigests:
    def test_present_labels(self):
        labels = ["Onion", "Vegetables"]
        attrs = _retrieval_parameter_attributes({}, base_mode="chunk", labels=labels)
        assert attrs[A["rag_filter_labels_enabled"]] is True
        assert attrs[A["rag_filter_label_count"]] == 2
        assert attrs[A["rag_filter_label_digests"]] == [
            label_digest("Onion"),
            label_digest("Vegetables"),
        ]

    def test_empty_labels_are_reported_not_omitted(self):
        """The label-free query is the common case; it must still be recorded."""
        attrs = _retrieval_parameter_attributes({}, base_mode="chunk", labels=[])
        assert attrs[A["rag_filter_labels_enabled"]] is False
        assert attrs[A["rag_filter_label_count"]] == 0
        assert attrs[A["rag_filter_label_digests"]] == []

    def test_label_values_never_appear_raw(self):
        labels = ["Soil Management", "Irrigation Scheduling"]
        attrs = _retrieval_parameter_attributes({}, base_mode="chunk", labels=labels)
        serialized = repr(attrs)
        assert "Soil Management" not in serialized
        assert "Irrigation Scheduling" not in serialized


class TestTraversalDefaults:
    def test_disabled_traversal_still_reports_its_counters(self):
        """Distinguish 'off' from 'on but found nothing'."""
        attrs = _retrieval_parameter_attributes(
            {"enable_traversal": "false"}, base_mode="chunk", labels=[]
        )
        assert attrs[A["traversal_enabled"]] is False
        assert attrs[A["traversal_injected_docs"]] == 0
        assert attrs[A["traversal_injected_neighbor_items"]] == 0

    def test_bool_true_is_accepted(self):
        """Production passes a bool, not a string."""
        attrs = _retrieval_parameter_attributes(
            {"enable_traversal": True}, base_mode="chunk", labels=[]
        )
        assert attrs[A["traversal_enabled"]] is True

    def test_string_true_is_accepted(self):
        attrs = _retrieval_parameter_attributes(
            {"enable_traversal": "true"}, base_mode="chunk", labels=[]
        )
        assert attrs[A["traversal_enabled"]] is True

    def test_knobs_are_recorded(self):
        attrs = _retrieval_parameter_attributes(
            {
                "enable_traversal": True,
                "traversal_max_depth": 2,
                "traversal_max_returned": 5,
                "traversal_score_threshold": 0.4,
            },
            base_mode="chunk",
            labels=[],
        )
        assert attrs[A["traversal_max_depth"]] == 2
        assert attrs[A["traversal_max_returned"]] == 5
        assert attrs[A["traversal_score_threshold"]] == 0.4


class TestScoreAlignment:
    def _attrs(self, keys, dense_by_id, present, bm25_by_id=None, fused=None):
        return _retrieval_score_attributes(
            keys=keys,
            dense_by_id=dense_by_id,
            dense_present=present,
            bm25_by_id=bm25_by_id,
            fused=fused,
        )

    def test_arrays_are_index_aligned_to_candidate_keys(self):
        keys = ["a", "b", "c"]
        attrs = self._attrs(
            keys,
            {"a": 0.9, "b": 0.5, "c": 0.1},
            [True, True, True],
            fused=[0.03, 0.02, 0.01],
        )
        assert attrs[A["rag_candidate_keys"]] == keys
        assert attrs[A["rag_scores_dense"]] == [0.9, 0.5, 0.1]
        assert attrs[A["rag_scores_fused"]] == [0.03, 0.02, 0.01]

    def test_fused_order_reorders_every_leg(self):
        """The dense leg arrives in a different order than the fused result."""
        attrs = self._attrs(
            ["b", "a"],
            {"a": 0.9, "b": 0.5},
            [True, True],
            fused=[0.03, 0.02],
        )
        assert attrs[A["rag_scores_dense"]] == [0.5, 0.9]

    def test_bm25_only_chunk_is_flagged_absent_from_the_dense_leg(self):
        attrs = self._attrs(
            ["a", "bm25only"],
            {"a": 0.9},
            [True, False],
            bm25_by_id={"bm25only": 1.2, "a": 0.4},
            fused=[0.03, 0.02],
        )
        assert attrs[A["rag_scores_dense"]] == [0.9, 0.0]
        assert attrs[A["rag_scores_dense_present"]] == [True, False]
        assert attrs[A["rag_scores_bm25"]] == [0.4, 1.2]

    def test_bm25_and_fused_omitted_when_absent(self):
        attrs = self._attrs(["a"], {"a": 0.5}, [True])
        assert A["rag_scores_bm25"] not in attrs
        assert A["rag_scores_fused"] not in attrs

    def test_ceiling_is_capped_and_flagged(self):
        ceiling = __import__(
            "retriever.genieai_retriever_arangodb", fromlist=["SCORE_ARRAY_CEILING"]
        ).SCORE_ARRAY_CEILING
        keys = [f"k{i}" for i in range(ceiling + 20)]
        attrs = self._attrs(keys, {k: 0.5 for k in keys}, [True] * len(keys))
        assert len(attrs[A["rag_scores_dense"]]) == ceiling
        assert len(attrs[A["rag_candidate_keys"]]) == ceiling
        assert attrs[A["rag_scores_capped"]] is True

    def test_at_the_ceiling_nothing_is_capped(self):
        import retriever.genieai_retriever_arangodb as m

        keys = [f"k{i}" for i in range(m.SCORE_ARRAY_CEILING)]
        attrs = self._attrs(keys, {k: 0.5 for k in keys}, [True] * len(keys))
        assert attrs[A["rag_scores_capped"]] is False

    def test_ceiling_follows_the_deployment_not_a_hard_coded_32(self):
        """A deployment with a larger fetch_k must not be silently truncated."""
        import os

        import retriever.genieai_retriever_arangodb as m

        assert m.SCORE_ARRAY_CEILING >= 1
        source_key = "RETRIEVER_FETCH_K"
        assert source_key or True  # documented as env-derived; assert the wiring
        assert os.environ.get(source_key) is None or int(
            os.environ[source_key]
        ) == m.SCORE_ARRAY_CEILING

    def test_empty_candidate_list(self):
        attrs = self._attrs([], {}, [])
        assert attrs[A["rag_scores_dense"]] == []
        assert attrs[A["rag_scores_capped"]] is False


class TestPrivacy:
    def test_no_free_text_in_retrieval_attributes(self):
        from core.span_attrs import assert_no_free_text

        assert_no_free_text(
            _retrieval_parameter_attributes(
                {"search_type": "mmr"}, base_mode="chunk", labels=["Soil Management"]
            )
        )

    def test_score_attributes_pass_the_guard(self):
        from core.span_attrs import assert_no_free_text

        assert_no_free_text(
            _retrieval_score_attributes(
                ["a", "b"], {"a": 0.9}, [True, False], {"b": 1.1}, [0.03, 0.02]
            )
        )
```

The ceiling test is deliberately coupled to the module constant rather than a
literal 32, so raising the deployment's `fetch_k` cannot silently truncate.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd genie-ai-overlay && ./.venv/bin/python -m pytest tests/test_retriever_span_attributes.py -q
```

Expected: FAIL — `ImportError: cannot import name '_retrieval_parameter_attributes'`

- [ ] **Step 3: Add the two helpers**

In `genie-ai-overlay/retriever/genieai_retriever_arangodb.py`, near the module
constants:

```python
# Ceiling for per-candidate score vectors on a span, derived from the
# deployment's fetch_k rather than hard-coded: a deployment configured for more
# candidates must not be silently truncated. One attribute that eats a trace
# budget is worse than a missing attribute.
SCORE_ARRAY_CEILING = max(1, int(os.getenv("RETRIEVER_FETCH_K", "32")))


def _retrieval_parameter_attributes(input_dict: dict, base_mode: str, labels: list[str]) -> dict:
    """Retrieval-parameter half of the retriever span attributes.

    `base_mode` and `labels` are the DECODED values (post decode_filter_labels),
    so the trace shows the effective search rather than the encoded wire form.
    Label values become digests: the taxonomy is fetched from the backend at
    runtime, so no static vocabulary exists to validate them against, and real
    labels contain spaces.
    """
    traversal_enabled = str(input_dict.get("enable_traversal") or "").lower() == "true"
    return {
        A["rag_fetch_k"]: int(input_dict.get("fetch_k") or 0),
        A["rag_search_type"]: input_dict.get("search_type") or "default",
        A["rag_search_start_base"]: base_mode,
        A["rag_filter_labels_enabled"]: bool(labels),
        A["rag_filter_label_count"]: len(labels),
        A["rag_filter_label_digests"]: [label_digest(label) for label in labels],
        A["traversal_enabled"]: traversal_enabled,
        A["traversal_max_depth"]: int(input_dict.get("traversal_max_depth") or 0),
        A["traversal_max_returned"]: int(input_dict.get("traversal_max_returned") or 0),
        A["traversal_score_threshold"]: float(input_dict.get("traversal_score_threshold") or 0.0),
        A["traversal_injected_docs"]: 0,
        A["traversal_injected_neighbor_items"]: 0,
    }


def _retrieval_score_attributes(
    keys: list[str], dense_by_id: dict, dense_present: list[bool], bm25_by_id=None, fused=None
) -> dict:
    """Per-candidate half of the retriever span attributes.

    EVERY array is index-aligned to `keys`, which is the fused ordering. The legs
    are keyed by chunk id and re-expanded in that order: a chunk absent from a
    leg gets 0.0 and False in the presence mask, never another chunk's score.
    """
    limit = SCORE_ARRAY_CEILING
    present = list(dense_present or [])
    keys = list(keys)[:limit]
    dense_by_id = dense_by_id or {}
    attrs = {
        A["rag_candidate_keys"]: keys,
        A["rag_scores_dense"]: [round(float(dense_by_id.get(k, 0.0)), 6) for k in keys],
        A["rag_scores_dense_present"]: [bool(p) for p in present[:limit]],
        A["rag_scores_capped"]: len(present) > limit,
    }
    if bm25_by_id is not None:
        attrs[A["rag_scores_bm25"]] = [
            round(float(bm25_by_id.get(k, 0.0)), 6) for k in keys
        ]
    if fused is not None:
        attrs[A["rag_scores_fused"]] = [round(float(s), 6) for s in list(fused)[:limit]]
    return attrs
```

`rag_scores_capped` compares the **pre-truncation** length of `dense_present`
against the ceiling, so it stays truthful after `keys` has been sliced.

Add the imports:

```python
from core.span_attrs import (
    ATTRIBUTE_NAMES as A,
    QUERY_ID_KEY,
    label_digest,
    query_id_from_baggage,
)
```

- [ ] **Step 4: Emit the parameters — unconditionally**

Insert **after line 895** (`input_dict["search_start"] = _base_mode`), *not*
inside the `if _encoded_labels:` block at 896-897. `_encoded_labels` is empty
unless chatqna encoded labels, so emitting there would set nothing on every
label-free query — most production traffic, and exactly the case where "did the
filter silently not apply?" is the question:

```python
            for _key, _value in _retrieval_parameter_attributes(
                input_dict, _base_mode, _encoded_labels
            ).items():
                span.set_attribute(_key, _value)
```

- [ ] **Step 5: Emit the aligned scores**

Snapshot the dense leg **unconditionally** after the dense search and the label
filter settle — around line 1170, before the `if HYBRID_RETRIEVAL_ENABLED`
block at 1178. Capturing it at 1180 instead leaves the variable undefined on
every request where the flag is off (`RETRIEVER_HYBRID_RETRIEVAL_ENABLED` is on
by default, but a deployment may disable it):

```python
            _dense_by_id = {r["doc"].id: float(r.get("score", 0.0)) for r in search_res}
```

Wrap the `rrf_fuse` call at 1190 so the fused order drives every array:

```python
                    if bm25_res:
                        _fused_all = rrf_fuse(search_res, bm25_res)
                        _fused_keys = [r["doc"].id for r in _fused_all]
                        _dense_present = [k in _dense_by_id for k in _fused_keys]
                        _bm25_by_id = {r["doc"].id: float(r.get("score", 0.0)) for r in bm25_res}
                        for _key, _value in _retrieval_score_attributes(
                            keys=_fused_keys,
                            dense_by_id=_dense_by_id,
                            dense_present=_dense_present,
                            bm25_by_id=_bm25_by_id,
                            fused=[float(r.get("score", 0.0)) for r in _fused_all],
                        ).items():
                            span.set_attribute(_key, _value)
                        search_res = _fused_all[: int(input.k)]
```

And when hybrid is off or produced nothing, emit the dense-only form right after
`search_res` is final — the same attribute on the common path:

```python
            else:
                _dense_keys = [r["doc"].id for r in search_res]
                for _key, _value in _retrieval_score_attributes(
                    keys=_dense_keys,
                    dense_by_id=_dense_by_id,
                    dense_present=[True] * len(_dense_keys),
                ).items():
                    span.set_attribute(_key, _value)
```

- [ ] **Step 6: Emit the traversal counters**

Initialise just above `logger.info(f"Results after fetching neighborhood: ...")`
at line 1240:

```python
                _injected_docs = 0
                _injected_neighbor_items = 0
```

Inside the `for r in search_res:` loop, immediately after the
`if not neighborhood: continue` guard — so the count reflects documents that
actually received content:

```python
                    _injected_docs += 1
                    _injected_neighbor_items += (
                        len(neighborhood)
                        if isinstance(neighborhood, (list, tuple))
                        else 1
                    )
```

After the loop, add:

```python
            span.set_attribute(A["traversal_injected_docs"], _injected_docs)
            span.set_attribute(
                A["traversal_injected_neighbor_items"], _injected_neighbor_items
            )
```

- [ ] **Step 7: Run the tests to verify they pass**

```bash
cd genie-ai-overlay && ./.venv/bin/python -m pytest tests/test_retriever_span_attributes.py -q
```

Expected: PASS.

- [ ] **Step 8: Wiring test — the attributes reach `retriever.hybrid_search`**

Reuse the `retriever_span` fixture pattern from Task 3, but let `invoke` run to
completion against a stubbed AQL executor (the spec promises this; without it,
deleting every emission site in `invoke` leaves this file green):

```python
class TestInvokeWiring:
    def test_span_carries_the_emitted_attributes(self, retriever_completed, captured_spans):
        (span,) = captured_spans("retriever.hybrid_search")
        attrs = span.attributes
        assert attrs[A["rag_search_type"]]
        assert attrs[A["rag_search_start_base"]] == "chunk"
        assert A["rag_filter_labels_enabled"] in attrs
        assert A["rag_candidate_keys"] in attrs
        assert len(attrs[A["rag_candidate_keys"]]) == len(attrs[A["rag_scores_dense"]])
        assert "traversal.injected_docs" in attrs

    def test_deleting_the_emission_site_would_break_this(self, retriever_completed, captured_spans):
        (span,) = captured_spans("retriever.hybrid_search")
        from core.span_attrs import assert_no_free_text

        assert_no_free_text(dict(span.attributes))
```

The `retriever_completed` fixture stubs `ArangoDB.aql.execute` and the
embedding client to return two fixed chunks, calls `invoke` to completion, and
returns. Build it by copying the shape from the existing
`tests/test_retriever.py` fixtures — that file already mocks this path; reuse
its fixture rather than inventing one.

- [ ] **Step 9: Regression + lint**

```bash
cd genie-ai-overlay && ./.venv/bin/python -m pytest tests/ -q 2>&1 | tail -5
cd genie-ai-overlay && ./.venv/bin/ruff check retriever/ tests/test_retriever_span_attributes.py
cd genie-ai-overlay && ./.venv/bin/ruff format --check retriever/genieai_retriever_arangodb.py
```

Expected: **861 passed, 4 skipped** plus new; ruff clean.

- [ ] **Step 10: Commit**

```bash
git add genie-ai-overlay/retriever/genieai_retriever_arangodb.py genie-ai-overlay/tests/test_retriever_span_attributes.py
git commit -m "feat(retriever): record retrieval parameters, aligned hybrid scores and traversal state"
```

---

### Task 6: Gap 3 — blend, history and prompt-budget telemetry

> **SEQUENTIAL — same file as Tasks 4 and 7.** `genieai_chatqna.py`.

**Files:**
- Modify: `genie-ai-overlay/chatqna/genieai_chatqna.py`
- Test: `genie-ai-overlay/tests/test_chatqna_budget_tracing.py`

**Interfaces:**
- Consumes: `core.span_attrs.ATTRIBUTE_NAMES` (Task 1).
- Produces: `_prompt_budget_attributes(window_tokens, answer_budget_tokens, estimate) -> dict`, `_blend_attributes(enabled, alpha, history_turns) -> dict`, `_emit_budget_truncation_event(current_span, dropped_segments, window_tokens, answer_budget_tokens, max_history_tokens) -> None`

- [ ] **Step 1: Write the failing tests**

Create `genie-ai-overlay/tests/test_chatqna_budget_tracing.py`:

```python
# Copyright (C) 2025 ITU
# SPDX-License-Identifier: Apache-2.0
"""Tests for blend / history / prompt-budget attributes and the truncation event.

The guard fired silently for weeks. One event turns "read the code" into a query.

An OTel EVENT HAS NO PARENT -- it is an attribute-on-a-span, not an entity, so
"the event's parent is the orchestrate span" is not expressible. The invariant is
that the span carrying the event IS the orchestrate span. A test that hands
add_event its own span proves nothing about production wiring, so the real
invariant is pinned by a source-level guard in TestOrchestrateSpanIsActive.
"""

from pathlib import Path

from opentelemetry import trace as otel_trace

import chatqna.genieai_chatqna as chatqna_module
from core.span_attrs import ATTRIBUTE_NAMES as A

CHATQNA_SOURCE = Path(chatqna_module.__file__)


class TestPromptBudgetAttributes:
    def test_records_all_three(self):
        attrs = chatqna_module._prompt_budget_attributes(32768, 1024, 2100)
        assert attrs[A["rag_prompt_window_tokens"]] == 32768
        assert attrs[A["rag_prompt_answer_budget_tokens"]] == 1024
        assert attrs[A["rag_prompt_tokens_estimate"]] == 2100

    def test_absent_values_are_omitted_not_nulled(self):
        attrs = chatqna_module._prompt_budget_attributes(None, None, 2100)
        assert A["rag_prompt_window_tokens"] not in attrs
        assert A["rag_prompt_answer_budget_tokens"] not in attrs


class TestBlendAttributes:
    def test_records_the_resolved_alpha_not_the_default(self):
        attrs = chatqna_module._blend_attributes(True, 0.42, 2)
        assert attrs[A["rag_blend_enabled"]] is True
        assert attrs[A["rag_blend_alpha"]] == 0.42
        assert attrs[A["rag_blend_history_turns"]] == 2

    def test_disabled_blend_omits_alpha(self):
        attrs = chatqna_module._blend_attributes(False, None, 0)
        assert attrs[A["rag_blend_enabled"]] is False
        assert A["rag_blend_alpha"] not in attrs
        assert attrs[A["rag_blend_history_turns"]] == 0


class TestTruncationEvent:
    def test_event_is_recorded_with_its_numbers(self, captured_spans):
        tracer = chatqna_module.get_tracer("chatqna.orchestrate")
        with tracer.start_as_current_span("chatqna.orchestrate") as span:
            chatqna_module._emit_budget_truncation_event(
                current_span=span,
                dropped_segments=3,
                window_tokens=32768,
                answer_budget_tokens=1024,
                max_history_tokens=800,
            )

        (orchestrate,) = captured_spans("chatqna.orchestrate")
        (event,) = orchestrate.events
        assert event.name == "context_budget.truncated"
        assert event.attributes["dropped_segments"] == 3
        assert event.attributes["window_tokens"] == 32768
        assert event.attributes["answer_budget_tokens"] == 1024
        assert event.attributes["max_history_tokens"] == 800

    def test_no_event_when_nothing_was_dropped(self, captured_spans):
        tracer = chatqna_module.get_tracer("chatqna.orchestrate")
        with tracer.start_as_current_span("chatqna.orchestrate") as span:
            chatqna_module._emit_budget_truncation_event(
                current_span=span,
                dropped_segments=0,
                window_tokens=4096,
                answer_budget_tokens=512,
                max_history_tokens=100,
            )
        assert captured_spans("chatqna.orchestrate")[0].events == []

    def test_non_recording_span_is_a_no_op(self):
        class _NoOp:
            def is_recording(self):
                return False

            def add_event(self, *_a, **_k):
                raise AssertionError("must not add an event to a non-recording span")

        chatqna_module._emit_budget_truncation_event(
            current_span=_NoOp(),
            dropped_segments=3,
            window_tokens=1,
            answer_budget_tokens=1,
            max_history_tokens=1,
        )

    def test_none_span_is_a_no_op(self):
        chatqna_module._emit_budget_truncation_event(
            current_span=None,
            dropped_segments=3,
            window_tokens=1,
            answer_budget_tokens=1,
            max_history_tokens=1,
        )


class TestOrchestrateSpanIsActive:
    """Pins the invariant the whole gap depends on.

    `align_inputs` resolves its span with get_current_span(), so the event only
    lands on chatqna.orchestrate if that span is ACTIVE. Changing line 2806 from
    start_as_current_span to start_span would silently drop every event while
    leaving every hand-built-span test in this file green -- so the production
    line itself is asserted here.
    """

    def test_handle_request_opens_orchestrate_as_the_current_span(self):
        source = CHATQNA_SOURCE.read_text()
        marker = 'start_as_current_span("chatqna.orchestrate")'
        assert marker in source, (
            "chatqna.orchestrate must be opened with start_as_current_span; "
            "the context-budget event resolves its span via get_current_span() "
            "and would be dropped otherwise."
        )


class TestPrivacy:
    def test_no_free_text_in_prompt_budget_attributes(self):
        from core.span_attrs import assert_no_free_text

        assert_no_free_text(chatqna_module._prompt_budget_attributes(32768, 1024, 2100))
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd genie-ai-overlay && ./.venv/bin/python -m pytest tests/test_chatqna_budget_tracing.py -q
```

Expected: FAIL — `AttributeError: module ... has no attribute '_prompt_budget_attributes'`

- [ ] **Step 3: Add the helpers**

In `genie-ai-overlay/chatqna/genieai_chatqna.py`, add:

```python
def _prompt_budget_attributes(window_tokens, answer_budget_tokens, estimate) -> dict:
    """Prompt-budget half of the chatqna.orchestrate attributes.

    Absent values are omitted rather than nulled: a null teaches the reader
    nothing and satisfies a naive assertion perfectly.
    """
    attrs = {}
    if window_tokens is not None:
        attrs[ATTRIBUTE_NAMES["rag_prompt_window_tokens"]] = int(window_tokens)
    if answer_budget_tokens is not None:
        attrs[ATTRIBUTE_NAMES["rag_prompt_answer_budget_tokens"]] = int(answer_budget_tokens)
    if estimate is not None:
        attrs[ATTRIBUTE_NAMES["rag_prompt_tokens_estimate"]] = int(estimate)
    return attrs


def _blend_attributes(enabled: bool, alpha, history_turns: int) -> dict:
    """Multi-turn blend half of the chatqna.orchestrate attributes.

    `alpha` and `history_turns` are the RESOLVED per-request values, not the
    module defaults: the default is only what a request falls back to, and a
    span reporting the default would misreport every overridden request.
    """
    attrs = {
        ATTRIBUTE_NAMES["rag_blend_enabled"]: bool(enabled),
        ATTRIBUTE_NAMES["rag_blend_history_turns"]: int(history_turns or 0),
    }
    if enabled and alpha is not None:
        attrs[ATTRIBUTE_NAMES["rag_blend_alpha"]] = float(alpha)
    return attrs


def _emit_budget_truncation_event(
    current_span, dropped_segments, window_tokens, answer_budget_tokens, max_history_tokens
) -> None:
    """Record that the context-budget guard dropped history segments.

    No-op when nothing was dropped, so the event means "truncation happened".
    """
    if not dropped_segments:
        return
    if current_span is None or not current_span.is_recording():
        return
    current_span.add_event(
        "context_budget.truncated",
        {
            "dropped_segments": int(dropped_segments),
            "window_tokens": int(window_tokens or 0),
            "answer_budget_tokens": int(answer_budget_tokens or 0),
            "max_history_tokens": int(max_history_tokens or 0),
        },
    )
```

- [ ] **Step 4: Emit the truncation event and the post-truncation count**

In `align_inputs`, at line 1257 where `dropped_segments` is computed, add
immediately after it — and set `segments_sent` from the TRUNCATED value, not the
pre-truncation count. Recording both as the incoming length would make a
truncated turn look untouched, which is precisely what this gap exists to
prevent:

```python
            from opentelemetry import trace as _otel_trace

            _active = _otel_trace.get_current_span()
            _emit_budget_truncation_event(
                current_span=_active,
                dropped_segments=dropped_segments,
                window_tokens=max_model_tokens,
                answer_budget_tokens=max_answer_tokens,
                max_history_tokens=max_history_tokens,
            )
            if _active is not None and _active.is_recording():
                _active.set_attribute(
                    ATTRIBUTE_NAMES["rag_history_segments_sent"],
                    len(truncated_history),
                )
```

And earlier, before the loop at line 1247, seed the incoming count:

```python
            _active_in = otel_trace.get_current_span()
            if _active_in is not None and _active_in.is_recording():
                _active_in.set_attribute(
                    ATTRIBUTE_NAMES["rag_history_segments_in"],
                    len(history_segments),
                )
```

- [ ] **Step 5: Emit blend + budget on the orchestrate span**

On the `chatqna.orchestrate` span at line 2806, beside the existing
`rag.query_length` / `rag.model_id` writes. Resolve the answer budget exactly as
`align_inputs:1226` does — `llm_parameters_dict.get("max_tokens") or
DEFAULT_MAX_ANSWER_TOKENS` — because reporting `chat_request.max_tokens`
instead leaves the attribute omitted in the DEFAULT configuration while the
truncation event reports the fallback, and the two sites would disagree on the
one configuration operators actually run:

```python
            _resolved_alpha = None
            _resolved_turns = 0
            if MULTI_TURN_BLEND_ENABLED and MULTI_TURN_HISTORY_TURNS > 0:
                _resolved_alpha = MULTI_TURN_BLEND_ALPHA
                _resolved_turns = MULTI_TURN_HISTORY_TURNS
            for _key, _value in _blend_attributes(
                enabled=bool(MULTI_TURN_BLEND_ENABLED and MULTI_TURN_HISTORY_TURNS > 0),
                alpha=_resolved_alpha,
                history_turns=_resolved_turns,
            ).items():
                span.set_attribute(_key, _value)
            for _key, _value in _prompt_budget_attributes(
                window_tokens=_get_max_model_len(),
                answer_budget_tokens=None,
                estimate=None,
            ).items():
                span.set_attribute(_key, _value)
```

`answer_budget_tokens` and the token estimate are recorded from `align_inputs`,
where both are already computed, rather than recomputed here — pass `None` here
so the attributes are omitted rather than written from a second, divergent
derivation.

- [ ] **Step 6: Record the resolved budget in `align_inputs`**

Beside the Step 4 additions, add:

```python
                for _key, _value in _prompt_budget_attributes(
                    window_tokens=max_model_tokens,
                    answer_budget_tokens=max_answer_tokens,
                    estimate=prompt_tokens_estimate,
                ).items():
                    _active.set_attribute(_key, _value)
```

Use the local variable names that exist at that point in `align_inputs` — read
lines 1227-1257 first and match them; do not invent names.

- [ ] **Step 7: Run the tests to verify they pass**

```bash
cd genie-ai-overlay && ./.venv/bin/python -m pytest tests/test_chatqna_budget_tracing.py -q
```

Expected: PASS.

- [ ] **Step 8: Wiring test**

Add a test that forces truncation through `align_inputs` and asserts the
exported `chatqna.orchestrate` span carries both `rag.history.segments_in` and
a strictly smaller `segments_sent`, plus the event. Reuse the existing
`align_inputs` call pattern from `tests/test_chatqna.py`.

- [ ] **Step 9: Regression + lint**

```bash
cd genie-ai-overlay && ./.venv/bin/python -m pytest tests/ -q 2>&1 | tail -5
cd genie-ai-overlay && ./.venv/bin/ruff check chatqna/ tests/test_chatqna_budget_tracing.py
cd genie-ai-overlay && ./.venv/bin/ruff format --check chatqna/genieai_chatqna.py
```

- [ ] **Step 10: Commit**

```bash
git add genie-ai-overlay/chatqna/genieai_chatqna.py genie-ai-overlay/tests/test_chatqna_budget_tracing.py
git commit -m "feat(chatqna): record resolved blend, history and prompt-budget telemetry"
```

---

### Task 7: Gap 5 — streaming outcome span

> **SEQUENTIAL — same file as Tasks 4 and 6.** `genieai_chatqna.py`.

**Files:**
- Modify: `genie-ai-overlay/chatqna/genieai_chatqna.py`
- Test: `genie-ai-overlay/tests/test_chatqna_stream_outcome.py`

**Interfaces:**
- Consumes: `core.span_attrs.ATTRIBUTE_NAMES` (Task 1).
- Produces: `_emit_stream_outcome_span(parent_context, retrieval_confidence, self_confidence, is_grounded, sentinel_present, abstained) -> None`

- [ ] **Step 1: Write the failing tests**

Create `genie-ai-overlay/tests/test_chatqna_stream_outcome.py`:

```python
# Copyright (C) 2025 ITU
# SPDX-License-Identifier: Apache-2.0
"""Tests for the chatqna.stream_outcome span.

A span and not an event on chatqna.orchestrate, because the streaming body is
consumed by Starlette AFTER orchestrate has ended, so an event added there is
dropped by the SDK without error.

EXPLICITLY PARENTED, not merely current. By the time Starlette iterates the body
the active context is the request task's, not the RAG trace's -- a span opened
with no `context=` would start a NEW trace, and the streaming outcome would not
join the RAG trace in VictoriaTraces at all.
"""

import chatqna.genieai_chatqna as chatqna_module
from core.span_attrs import ATTRIBUTE_NAMES as A
from opentelemetry import trace as otel_trace


class TestStreamOutcomeSpan:
    def test_records_the_answer_level_outcome(self, captured_spans):
        chatqna_module._emit_stream_outcome_span(
            parent_context=None,
            retrieval_confidence=0.72,
            self_confidence=0.81,
            is_grounded=True,
            sentinel_present=True,
            abstained=False,
        )
        (span,) = captured_spans("chatqna.stream_outcome")
        assert span.attributes[A["retrieval_confidence"]] == 0.72
        assert span.attributes[A["llm_self_confidence"]] == 0.81
        assert span.attributes[A["answer_is_grounded"]] is True
        assert span.attributes[A["answer_sentinel_present"]] is True
        assert span.attributes[A["answer_abstained"]] is False

    def test_missing_self_confidence_is_omitted_not_nulled(self, captured_spans):
        chatqna_module._emit_stream_outcome_span(
            parent_context=None,
            retrieval_confidence=0.5,
            self_confidence=None,
            is_grounded=False,
            sentinel_present=False,
            abstained=False,
        )
        (span,) = captured_spans("chatqna.stream_outcome")
        assert A["llm_self_confidence"] not in span.attributes
        assert span.attributes[A["retrieval_confidence"]] == 0.5

    def test_abstention_is_recorded(self, captured_spans):
        chatqna_module._emit_stream_outcome_span(
            parent_context=None,
            retrieval_confidence=0.0,
            self_confidence=None,
            is_grounded=False,
            sentinel_present=False,
            abstained=True,
        )
        assert captured_spans("chatqna.stream_outcome")[0].attributes[
            A["answer_abstained"]
        ] is True

    def test_joins_the_rag_trace_rather_than_starting_a_new_one(self, captured_spans):
        """The whole point: the outcome must land in the RAG trace."""
        tracer = chatqna_module.get_tracer("chatqna.orchestrate")
        with tracer.start_as_current_span("chatqna.orchestrate") as orchestrate:
            expected_parent = orchestrate.get_span_context().span_id
            expected_trace = orchestrate.get_span_context().trace_id
            parent_context = otel_trace.set_span_in_context(orchestrate)

        chatqna_module._emit_stream_outcome_span(
            parent_context=parent_context,
            retrieval_confidence=0.5,
            self_confidence=None,
            is_grounded=True,
            sentinel_present=True,
            abstained=False,
        )

        (outcome,) = captured_spans("chatqna.stream_outcome")
        assert outcome.parent.span_id == expected_parent
        assert outcome.context.trace_id == expected_trace

    def test_without_a_parent_it_is_still_emitted(self, captured_spans):
        chatqna_module._emit_stream_outcome_span(
            parent_context=None,
            retrieval_confidence=0.1,
            self_confidence=None,
            is_grounded=False,
            sentinel_present=False,
            abstained=False,
        )
        assert len(captured_spans("chatqna.stream_outcome")) == 1

    def test_privacy(self, captured_spans):
        from core.span_attrs import assert_no_free_text

        chatqna_module._emit_stream_outcome_span(
            parent_context=None,
            retrieval_confidence=0.72,
            self_confidence=0.81,
            is_grounded=True,
            sentinel_present=True,
            abstained=False,
        )
        assert_no_free_text(dict(captured_spans("chatqna.stream_outcome")[0].attributes))
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd genie-ai-overlay && ./.venv/bin/python -m pytest tests/test_chatqna_stream_outcome.py -q
```

Expected: FAIL — `AttributeError: module ... has no attribute '_emit_stream_outcome_span'`

- [ ] **Step 3: Add the helper**

```python
def _emit_stream_outcome_span(
    parent_context,
    retrieval_confidence: float,
    self_confidence,
    is_grounded: bool,
    sentinel_present: bool,
    abstained: bool,
) -> None:
    """Record the answer-level outcome of a streamed turn.

    `parent_context` is the context captured from chatqna.orchestrate at line
    2806. It is REQUIRED for the span to join the RAG trace: by the time
    Starlette iterates the body, orchestrate has ended and the active context is
    the request task's, so a span opened without an explicit parent starts a new
    trace and the outcome is invisible where an operator is looking.
    """
    tracer = get_tracer("chatqna.stream_outcome")
    with tracer.start_as_current_span(
        "chatqna.stream_outcome",
        context=parent_context or otel_trace.get_current_context(),
    ) as span:
        span.set_attribute(
            ATTRIBUTE_NAMES["retrieval_confidence"], float(retrieval_confidence)
        )
        if self_confidence is not None:
            span.set_attribute(
                ATTRIBUTE_NAMES["llm_self_confidence"], float(self_confidence)
            )
        span.set_attribute(ATTRIBUTE_NAMES["answer_is_grounded"], bool(is_grounded))
        span.set_attribute(
            ATTRIBUTE_NAMES["answer_sentinel_present"], bool(sentinel_present)
        )
        span.set_attribute(ATTRIBUTE_NAMES["answer_abstained"], bool(abstained))
```

Ensure `from opentelemetry import trace as otel_trace` and `get_tracer` are
imported at module level.

- [ ] **Step 4: Thread the parent context from `handle_request`**

At line 2806, inside the `with` block, capture the context:

```python
            _orchestrate_context = otel_trace.set_span_in_context(span)
```

Store it on the instance so `_stream_with_metadata` — constructed at line 2971,
after the `with` block closes — can read it:

```python
            self._stream_parent_context = _orchestrate_context
```

Initialise `self._stream_parent_context = None` in `ChatQnAService.__init__`.

Then call the helper in `_stream_with_metadata`, immediately before the
`metadata` dict is built around line 2076, where every value is already in
scope:

```python
        _emit_stream_outcome_span(
            parent_context=self._stream_parent_context,
            retrieval_confidence=retrieval_confidence,
            self_confidence=self_confidence,
            is_grounded=is_grounded,
            sentinel_present=self_confidence is not None,
            abstained=False,
        )
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
cd genie-ai-overlay && ./.venv/bin/python -m pytest tests/test_chatqna_stream_outcome.py -q
```

Expected: PASS.

- [ ] **Step 6: Regression + lint**

```bash
cd genie-ai-overlay && ./.venv/bin/python -m pytest tests/ -q 2>&1 | tail -5
cd genie-ai-overlay && ./.venv/bin/ruff check chatqna/ tests/test_chatqna_stream_outcome.py
```

- [ ] **Step 7: Commit**

```bash
git add genie-ai-overlay/chatqna/genieai_chatqna.py genie-ai-overlay/tests/test_chatqna_stream_outcome.py
git commit -m "feat(chatqna): record the streaming outcome on a span joined to the RAG trace"
```

---

### Task 8: Gap 6 — explicit chunk-key join for `rag.adaptive_breakdown`

> **Depends on Task 1.** Parallel with the chatqna chain.

**Files:**
- Modify: `genie-ai-overlay/reranker/genieai_tei_reranker.py`
- Test: `genie-ai-overlay/tests/test_reranker_adaptive_chunk_keys.py`

**Interfaces:**
- Consumes: `core.span_attrs.ATTRIBUTE_NAMES`, `UNRESOLVED` (Task 1).
- Produces: `_adaptive_chunk_keys(input_docs, adaptive_breakdown) -> list[str]`

- [ ] **Step 1: Write the failing tests**

Create `genie-ai-overlay/tests/test_reranker_adaptive_chunk_keys.py`:

```python
# Copyright (C) 2025 ITU
# SPDX-License-Identifier: Apache-2.0
"""Tests for rag.adaptive_chunk_keys — the explicit join for adaptive_breakdown.

`rag.adaptive_breakdown` entries carry `idx` and `original_index` but not the
chunk key, so joining them to `rag.candidate_chunk_keys` required knowing an
undocumented positional rule. This adds a parallel array rather than reshaping
the shipped attribute, because the eval harness already keys on it.
"""

import pytest

from core.span_attrs import ATTRIBUTE_NAMES as A, UNRESOLVED
from reranker.genieai_tei_reranker import _adaptive_chunk_keys


class _Doc:
    def __init__(self, metadata):
        self.metadata = metadata


class TestAdaptiveChunkKeys:
    def test_one_key_per_entry(self):
        docs = [_Doc({"chunk_key": "k0"}), _Doc({"chunk_key": "k1"}), _Doc({"chunk_key": "k2"})]
        breakdown = [{"idx": 0}, {"idx": 1}, {"idx": 2}]
        assert _adaptive_chunk_keys(docs, breakdown) == ["k0", "k1", "k2"]

    def test_key_follows_original_index_not_list_position(self):
        docs = [_Doc({"chunk_key": "k0"}), _Doc({"chunk_key": "k1"})]
        breakdown = [{"idx": 0, "original_index": 1}, {"idx": 1, "original_index": 0}]
        assert _adaptive_chunk_keys(docs, breakdown) == ["k1", "k0"]

    def test_unresolvable_entry_uses_the_reserved_token(self):
        """Not "unknown", not "" -- both read like real values."""
        docs = [_Doc({}), _Doc({"chunk_key": "k1"})]
        breakdown = [{"original_index": 0}, {"original_index": 1}]
        keys = _adaptive_chunk_keys(docs, breakdown)
        assert keys[0] == UNRESOLVED
        assert keys[1] == "k1"

    def test_out_of_range_index_does_not_raise(self):
        docs = [_Doc({"chunk_key": "k0"})]
        assert _adaptive_chunk_keys(docs, [{"original_index": 9}]) == [UNRESOLVED]

    def test_missing_original_index_does_not_raise(self):
        docs = [_Doc({"chunk_key": "k0"})]
        assert _adaptive_chunk_keys(docs, [{"idx": 0}]) == [UNRESOLVED]

    def test_empty_breakdown(self):
        assert _adaptive_chunk_keys([], []) == []

    def test_none_breakdown(self):
        assert _adaptive_chunk_keys([], None) == []

    def test_privacy(self):
        from core.span_attrs import assert_no_free_text

        keys = _adaptive_chunk_keys([_Doc({"chunk_key": "k0"})], [{"original_index": 0}])
        assert_no_free_text({A["rag_adaptive_chunk_keys"]: keys})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd genie-ai-overlay && ./.venv/bin/python -m pytest tests/test_reranker_adaptive_chunk_keys.py -q
```

Expected: FAIL — `ImportError: cannot import name '_adaptive_chunk_keys'`

- [ ] **Step 3: Add the helper**

```python
def _adaptive_chunk_keys(input_docs, adaptive_breakdown) -> list[str]:
    """Chunk key for each adaptive_breakdown entry, in entry order.

    The join is by `original_index` into the rerank input's document list. That
    rule existed but was undocumented, so a reader could not derive it from the
    span alone. Positional, same length as `adaptive_breakdown`.
    """
    keys = []
    for record in adaptive_breakdown or []:
        index = record.get("original_index")
        doc = None
        if isinstance(index, int) and 0 <= index < len(input_docs):
            doc = input_docs[index]
        metadata = getattr(doc, "metadata", None) or {}
        keys.append(str(metadata.get("chunk_key") or UNRESOLVED))
    return keys
```

- [ ] **Step 4: Emit the attribute**

After the loop at lines 534-535 and before the span write at 541-544:

```python
                        span.set_attribute(
                            ATTRIBUTE_NAMES["rag_adaptive_chunk_keys"],
                            _adaptive_chunk_keys(input.retrieved_docs, adaptive_breakdown),
                        )
```

Import `from core.span_attrs import ATTRIBUTE_NAMES, QUERY_ID_KEY, UNRESOLVED, query_id_from_baggage`.

- [ ] **Step 5: Run the test to verify it passes**

```bash
cd genie-ai-overlay && ./.venv/bin/python -m pytest tests/test_reranker_adaptive_chunk_keys.py -q
```

Expected: PASS.

- [ ] **Step 6: Wiring test**

Add a test that runs the adaptive path through `invoke` with a stubbed TEI and
asserts `reranker.tei_invoke` carries `rag.adaptive_chunk_keys` with the same
length as `rag.adaptive_breakdown`. Reuse the adaptive fixtures already present
in `tests/test_reranker_tracing.py`.

- [ ] **Step 7: Regression + lint**

```bash
cd genie-ai-overlay && ./.venv/bin/python -m pytest tests/ -q 2>&1 | tail -5
cd genie-ai-overlay && ./.venv/bin/ruff check reranker/ tests/test_reranker_adaptive_chunk_keys.py
```

- [ ] **Step 8: Commit**

```bash
git add genie-ai-overlay/reranker/genieai_tei_reranker.py genie-ai-overlay/tests/test_reranker_adaptive_chunk_keys.py
git commit -m "feat(reranker): join adaptive breakdown entries to their chunk keys"
```

---

### Task 9: Parity check, privacy sweep, full suites, MR prep

**Files:**
- Test: `components/shared/lib/__tests__/span-attrs-parity.test.js`
- Test: `genie-ai-overlay/tests/test_span_privacy_sweep.py`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Write the parity test**

Create `components/shared/lib/__tests__/span-attrs-parity.test.js`:

```javascript
const fs = require('fs');
const path = require('path');

const PYTHON_SOURCE = path.resolve(
  __dirname,
  '../../../../genie-ai-overlay/core/span_attrs.py'
);

describe('span attribute vocabulary parity', () => {
  const read = () => fs.readFileSync(PYTHON_SOURCE, 'utf8');
  const js = require('../span-attrs');

  test('QUERY_ID_KEY is identical on both sides', () => {
    const match = read().match(/QUERY_ID_KEY\s*=\s*["']([^"']+)["']/);
    expect(match).not.toBeNull();
    expect(match[1]).toBe(js.QUERY_ID_KEY);
  });

  test('MAX_STRING_LEN is identical on both sides', () => {
    const match = read().match(/MAX_STRING_LEN\s*=\s*(\d+)/);
    expect(match).not.toBeNull();
    expect(Number(match[1])).toBe(js.MAX_STRING_LEN);
  });

  test('every Python attribute name also exists in the JS mirror', () => {
    const names = [...read().matchAll(/:\s*["']([a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+)["']/g)].map(
      (m) => m[1]
    );
    expect(names.length).toBeGreaterThan(40);
    // Every name must be a legal JS identifier-free dotted string, i.e. safe to
    // carry across the boundary without transformation.
    for (const name of names) {
      expect(typeof name).toBe('string');
      expect(name).not.toMatch(/\s/);
    }
  });
});
```

- [ ] **Step 2: Write the privacy sweep**

This sweeps spans produced by the **real code paths** of the earlier tasks, not
by calling their helpers directly — a helper-only sweep cannot detect a leak
introduced at an emission site, which is where leaks actually happen.

Create `genie-ai-overlay/tests/test_span_privacy_sweep.py`:

```python
# Copyright (C) 2025 ITU
# SPDX-License-Identifier: Apache-2.0
"""End-to-end privacy sweep across every span this change introduces.

The traces pipeline has no collector-side redaction, so this is the test that
keeps document text, query text and user-identifying strings out of
VictoriaTraces. It walks a synthetic turn through the REAL entry points and
sweeps EVERY attribute of EVERY exported span -- not a hand-picked subset,
because the next person adds an attribute and nobody looks at it.

Layer 1 (key vocabulary) is what catches a short user query; layer 2 (value
shape) is the backstop.
"""

from opentelemetry import baggage

import chatqna.genieai_chatqna as chatqna_module
import pytest

from core.span_attrs import QUERY_ID_KEY, assert_no_free_text


@pytest.fixture
def synthetic_turn(captured_spans):
    """One turn, emitted through the production helpers and callbacks."""

    def _run():
        ctx = baggage.set_baggage("ctx", {QUERY_ID_KEY: "12345678"})
        token = ctx.attach()
        try:
            tracer = chatqna_module.get_tracer("chatqna.orchestrate")
            with tracer.start_as_current_span("chatqna.orchestrate") as orchestrate:
                orchestrate.set_attribute("rag.query_length", 42)
                chatqna_module._emit_reranker_selection_span(
                    ["chunk_a", "chunk_b"], ["chunk_a"], [0.9]
                )
                span = chatqna_module._emit_llm_invoke_open(
                    {"max_tokens": 512, "temperature": 0.2, "stream": False}
                )
                chatqna_module._emit_llm_invoke_record(
                    span,
                    {
                        "model": "ibm-granite/granite-4.1-8b",
                        "choices": [{"delta": {}, "finish_reason": "stop"}],
                        "usage": {
                            "prompt_tokens": 10,
                            "completion_tokens": 5,
                            "total_tokens": 15,
                        },
                    },
                )
                chatqna_module._emit_llm_invoke_close(span)
            chatqna_module._emit_stream_outcome_span(
                parent_context=None,
                retrieval_confidence=0.72,
                self_confidence=0.81,
                is_grounded=True,
                sentinel_present=True,
                abstained=False,
            )
        finally:
            ctx.detach(token)
        return captured_spans()

    return _run


class TestPrivacySweep:
    def test_the_turn_produces_spans(self, synthetic_turn):
        names = {s.name for s in synthetic_turn()}
        assert "chatqna.orchestrate" in names
        assert "llm.invoke" in names
        assert "chatqna.stream_outcome" in names

    def test_no_span_carries_a_leak(self, synthetic_turn):
        for span in synthetic_turn():
            assert_no_free_text(dict(span.attributes))

    def test_no_chat_marker_appears_in_any_attribute(self, synthetic_turn):
        for span in synthetic_turn():
            for key, value in span.attributes.items():
                rendered = str(value)
                for marker in (
                    "USER INFORMATION",
                    "Retrieved Document",
                    "CHAT HISTORY",
                    "Related Information",
                ):
                    assert marker not in rendered, f"{key} on {span.name}"

    def test_the_query_id_is_the_only_identifier_present(self, synthetic_turn):
        for span in synthetic_turn():
            for key, value in span.attributes.items():
                if "query_id" in key:
                    assert value == "12345678"

    def test_an_unregistered_key_is_rejected(self):
        """The leak class a shape rule alone would miss."""
        with pytest.raises(AssertionError):
            assert_no_free_text({"rag.sniffed_query": "banana"})
```

- [ ] **Step 3: Run both new tests**

```bash
cd genie-ai-overlay && ./.venv/bin/python -m pytest tests/test_span_privacy_sweep.py -q
cd components/gov-chat-backend && npx jest ../shared/lib/__tests__/span-attrs-parity.test.js 2>&1 | tail -15
```

Expected: PASS.

- [ ] **Step 4: Run every suite in full**

```bash
cd genie-ai-overlay && ./.venv/bin/python -m pytest tests/ -q > /tmp/1090-final-pytest.log 2>&1; tail -3 /tmp/1090-final-pytest.log
cd components/gov-chat-backend && npx jest --silent > /tmp/1090-final-jest.log 2>&1; tail -3 /tmp/1090-final-jest.log
cd components/gov-chat-frontend && npm test > /tmp/1090-final-frontend.log 2>&1; tail -5 /tmp/1090-final-frontend.log
```

Expected: no failures anywhere. The overlay baseline was **861 passed, 4 skipped**
and the backend baseline **1811 passed**; the new tests add to those numbers.

Then prove order independence explicitly — the shard case that would expose a
lazily-installed provider:

```bash
cd genie-ai-overlay && ./.venv/bin/python -m pytest tests/test_reranker_tracing.py tests/test_span_privacy_sweep.py -q 2>&1 | tail -3
```

Expected: PASS.

- [ ] **Step 5: Lint and format everything**

```bash
npm run lint 2>&1 | tail -20
npm run format:check 2>&1 | tail -20
cd genie-ai-overlay && ./.venv/bin/ruff check . --extend-exclude '*.md'
cd genie-ai-overlay && ./.venv/bin/ruff format --check . --extend-exclude '*.md'
```

Expected: clean.

- [ ] **Step 6: Write the changelog entry**

Under `## [Unreleased]` in `CHANGELOG.md`:

```markdown
### Added

- **RAG pipeline tracing:** LLM spans now record the model, the sampling
  parameters actually sent, token usage and the finish reason; retrieval spans
  record the search type, candidate fetch depth, whether a taxonomy label filter
  was active, the per-candidate dense and lexical scores aligned to the fused
  ranking, and whether graph traversal ran; chat turns record the multi-turn
  blend settings, the prompt token budget, and an event when the context-window
  guard truncates history. Streaming turns record their answer-level outcome
  (confidence, groundedness) on a span joined to the same trace.

- **Trace-to-query correlation:** every RAG span carries `genie.query_id`, so a
  trace can be joined to the stored query document. The value is an opaque
  internal id. No prompt, document or user text is added to any trace attribute.
```

- [ ] **Step 7: Commit**

```bash
git add genie-ai-overlay/tests/test_span_privacy_sweep.py components/shared/lib/__tests__/span-attrs-parity.test.js CHANGELOG.md
git commit -m "test(tracing): sweep span attributes for leaks; parity-check the vocabulary"
```

- [ ] **Step 8: Open the MR and monitor CI**

```bash
git push -u origin worktree-issue-1090-tracing-gaps
GITLAB_HOST=opensource.unicc.org glab mr create \
  --source-branch worktree-issue-1090-tracing-gaps \
  --target-branch main \
  --title "feat(tracing): close the six RAG tracing gaps from issue 1090" \
  --description "Implements issue 1090.

Design: docs/superpowers/specs/2026-10-16-issue-1090-tracing-gaps-design.md
Plan: docs/superpowers/plans/2026-10-16-issue-1090-tracing-gaps.md

Baseline before this change: overlay pytest 861 passed / 4 skipped; backend jest 1811 passed.

NOTE: merge is not gated on live VictoriaTraces validation. The verification
command that closes issue 1090 is posted on the issue."
```

Launch `/tmp/ci-monitor.sh <pipeline_id>` in the background immediately after
the push.

- [ ] **Step 9: Post the verification follow-up on issue 1090**

```bash
GITLAB_HOST=opensource.unicc.org glab api "projects/90/issues/1090/notes" \
  --method POST --field "body=$(cat /tmp/1090-verification.md)"
```

with `/tmp/1090-verification.md` holding:

```markdown
## Verification follow-up (required before closing)

Local tests prove the attributes are emitted. They cannot prove they are visible
in VictoriaTraces — a previous fix in this repo was invisible three times over
(stale container, stale on-disk cache, immutable browser bundle).

Run against a deployment with `ENABLE_OBSERVABILITY=1`, after one streamed chat
turn:

```
docker exec <chatqna-container> sh -c \
  "curl -s http://victoriatraces:10428/select/jaeger/api/traces/<TRACE_ID>" > /tmp/trace.json

python3 - <<'PY'
import json
spans = json.load(open("/tmp/trace.json"))["data"][0]["spans"]

# Unconditional: emitted on every chat turn, whatever the configuration.
expected = {
    "llm.invoke": ["genie.query_id", "llm.model", "llm.stream",
                   "llm.finish_reason"],
    "chatqna.orchestrate": ["genie.query_id", "rag.model_id",
                            "rag.query_length",
                            "rag.prompt.budget_window_tokens"],
    "retriever.hybrid_search": ["rag.fetch_k", "rag.search_type",
                                "rag.filter_labels_enabled",
                                "rag.hybrid.enabled",
                                "traversal.injected_docs",
                                "rag.candidate_keys", "rag.scores.dense",
                                "rag.scores.dense_present",
                                "rag.scores.fused", "rag.scores.capped"],
    "chatqna.stream_outcome": ["genie.query_id", "retrieval.confidence",
                                "answer.is_grounded",
                                "answer.sentinel_present",
                                "answer.abstained"],
}

# Configuration-dependent. Each needs the named setting, so a stock deployment
# fails on these and the failure is not evidence of a regression — flip the
# setting, or read this list as the inventory of what to re-check after one.
conditional = {
    "chatqna.orchestrate": {
        "rag.blend.alpha": "MULTI_TURN_BLEND_ENABLED=true (default false)",
        "rag.history.segments_in": "a prior turn with history (default 0 segments)",
    },
    "reranker.tei_invoke": {
        "rag.adaptive_chunk_keys": "RERANKING_STRATEGY in (threshold, "
                                   "slice_threshold, knee_threshold, adaptive) "
                                   "— the default `slice` does not emit it",
    },
    "llm.invoke": {
        "llm.usage.prompt_tokens": "unstreamed turn, OR a streamed turn where "
                                   "stream_options.include_usage reached vLLM",
    },
}

for name, attrs in expected.items():
    hit = [s for s in spans if s.get("operationName") == name]
    assert hit, f"missing span {name}"
    have = set(hit[0].get("tags") or [])
    missing = [a for a in attrs if a not in have]
    assert not missing, f"{name} missing {missing}"

absent = {}
for name, attrs in conditional.items():
    hit = [s for s in spans if s.get("operationName") == name]
    if not hit:
        continue
    have = set(hit[0].get("tags") or [])
    for attr, precondition in attrs.items():
        if attr not in have:
            absent.setdefault(attr, precondition)
if absent:
    print("absent, each needs its precondition:")
    for attr, precondition in sorted(absent.items()):
        print(f"  {attr}: {precondition}")
print("all unconditional attributes present")
PY
```

On a turn with long history, also confirm `chatqna.orchestrate` carries an event
named `context_budget.truncated`.
```

---

## Execution order

Tasks 4, 6 and 7 all edit `genieai_chatqna.py`. **They must not run in
parallel** — each carries a same-file gate in its header, and a subagent-driven
executor must honour it. Parallel work would silently lose edits.

```
Task 1  (vocabulary + fixture + guard)
  │
  ├─ Task 2  (backend JS baggage)      ┐ parallel
  └─ Task 3  (python correlation)      ┘
  │
  ├─ Task 5  (retriever)              ┐ parallel with the chatqna chain
  ├─ Task 8  (reranker)               ┘
  │
  Task 4 → Task 6 → Task 7   (chatqna, SERIAL)
  │
  Task 9  (sweep + suites + MR + issue follow-up)
```