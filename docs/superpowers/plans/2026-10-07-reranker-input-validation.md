# Reranker Input Validation — Fail-Fast Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **DISCOVERED ISSUE — flag name correction (2026-10-07):** the plan originally referenced the TEI flag `--max-client-input-length`. That flag does not exist in any released TEI version (verified against v1.9.3, latest release v1.9.4). The real per-input cap control in TEI 1.9.3 is `--max-batch-tokens` (per-batch token cap, also clamping per-input cap to `min(model.max_position_embeddings, --max-batch-tokens)`). The shipped `--max-batch-tokens=1024` was the source of the silent truncation, not a latent feature flag. The plan's task list was implemented with `--max-batch-tokens=8192` and `--auto-truncate=false` instead. Plan body kept verbatim for traceability; the discrepancy is documented at the top.

**Goal:** Eliminate silent reranker input truncation by aligning the TEI input cap with the model max (8192 tokens), removing `--auto-truncate`, and converting any over-cap input into a typed `RerankerInputTooLongError` exception that propagates to chatqna as a graceful abstention.

**Architecture:** Two-layer fix. (1) Compose entrypoints raise `--max-client-input-length` from 1024 to 8192 and drop `--auto-truncate` so TEI rejects oversized inputs with HTTP 422. (2) The wrapper reranks force `truncate=False` per request (belt-and-suspenders against a compose regression) and translate TEI 422 into a typed exception that the microservice re-raises as `HTTPException(422)` so chatqna's orchestrator can catch it and return an abstention response instead of a 500.

**Tech Stack:** Python 3.11 (FastAPI, aiohttp, opentelemetry), OPEA v1.5 microservice framework, pytest + pytest-asyncio, ruff, Docker Compose v2.

**Spec:** `docs/specs/2026-10-07-reranker-input-validation-design.md`

## Global Constraints

- All Python code follows PEP 8 + ruff (config: `genie-ai-overlay/pyproject.toml`).
- All English comments — no i18n in code.
- New env vars (`TEI_RERANKING_MAX_CLIENT_INPUT_LENGTH`, `TEI_RERANKING_MAX_BATCH_TOKENS`, `TEI_RERANKING_MAX_CONCURRENT_REQUESTS`) follow the `TEI_RERANKING_*` naming convention already used in compose.
- Local reranker module (`genie-ai-overlay/reranker/genieai_tei_reranker.py`) is overlaid at Docker build time to `/app/comps/rerankings/src/integrations/genieai_tei_reranker.py` — both production and tests import via the `comps.rerankings.src.integrations.genieai_tei_reranker` path (the local file IS the runtime file).
- Tests must use `_RealSearchedDoc`/`_RealRerankingRequest` etc. fixtures from `test_reranker.py` (comps types are `MagicMock` in conftest, breaks `isinstance()`).
- New Prometheus counter must follow naming convention `reranker_*_total` (snake_case + `_total` suffix).
- Reranker entrypoint concurrent cap stays conservative for shared `.110` test env: 32 (remote GPU topology) / 4 (local GPU topology). Production recalibration is a separate decision after the VRAM bench in the spec § Rollout.

## Review Focus

Inputs and behaviors NOT covered by tests in this plan, most likely to bite a user first:

1. **TEI returning 422 with non-Validation error_type** (e.g., `error_type: "PayloadTooLarge"` if TEI adds new error classes) — wrapper currently only triggers on `error_type == "Validation"`. Mitigation: scan the upstream OPEA vendor notes before bumping the image; if a new error_type appears, add it to the check in Task 6.
3. **Wrapper-level mock that includes `truncate: False` but TEI silently accepts anyway** — possible if TEI is rebuilt without `--max-client-input-length` enforcement. Mitigation: the compose entrypoint change is the primary enforcement layer; the wrapper flag is belt-and-suspenders.
4. **Chatqna orchestrator wrapping the reranker's HTTPException in a way that hides the message** — risk if OPEA's `ServiceOrchestrator.schedule()` rewrites exception detail. Mitigation: Task 8's chatqna catch inspects the full exception chain (not just `e.detail`) and checks for the substring `"max-client-input-length"`. If that fails on the live deployment, switch to inspecting the orchestrator's `runtime_graph` for a node-level error attribute.
5. **Counter incremented on the wrapper side but the microservice's own `rag.rerank.requests{error="true"}` counter also fires** — both metrics increment for the same failure. Acceptable: operators get one for "fail-fast activations" and one for "any rerank error".

---

## Task 1: Compose entrypoints — raise cap + remove auto-truncate

**Files:**
- Modify: `docker-compose.yaml:1076`
- Modify: `docker-compose.gpu.yaml:131`

**Interfaces:**
- Consumes: existing env vars `TEI_RERANKING_MAX_BATCH_TOKENS`, plus new `TEI_RERANKING_MAX_CLIENT_INPUT_LENGTH`
- Produces: TEI reranker startup command with `--max-client-input-length` flag and no `--auto-truncate`

- [ ] **Step 1: Edit `docker-compose.yaml` line 1076**

Replace:
```yaml
entrypoint: /bin/sh -c "text-embeddings-router --json-output --model-id ${RERANKER_MODEL_ID:-BAAI/bge-reranker-v2-m3} --max-batch-tokens ${TEI_RERANKING_MAX_BATCH_TOKENS:-1024} --max-concurrent-requests ${TEI_RERANKING_MAX_CONCURRENT_REQUESTS:-128} --auto-truncate"
```

With:
```yaml
entrypoint: /bin/sh -c "text-embeddings-router --json-output --model-id ${RERANKER_MODEL_ID:-BAAI/bge-reranker-v2-m3} --max-batch-tokens ${TEI_RERANKING_MAX_BATCH_TOKENS:-1024} --max-concurrent-requests ${TEI_RERANKING_MAX_CONCURRENT_REQUESTS:-32} --max-client-input-length ${TEI_RERANKING_MAX_CLIENT_INPUT_LENGTH:-8192}"
```

- [ ] **Step 2: Edit `docker-compose.gpu.yaml` line 131**

Replace:
```yaml
entrypoint: /bin/sh -c "text-embeddings-router --json-output --model-id ${RERANKER_MODEL_ID:-BAAI/bge-reranker-v2-m3} --max-batch-tokens ${TEI_RERANKING_MAX_BATCH_TOKENS:-1024} --max-concurrent-requests ${TEI_RERANKING_MAX_CONCURRENT_REQUESTS:-8} --auto-truncate"
```

With:
```yaml
entrypoint: /bin/sh -c "text-embeddings-router --json-output --model-id ${RERANKER_MODEL_ID:-BAAI/bge-reranker-v2-m3} --max-batch-tokens ${TEI_RERANKING_MAX_BATCH_TOKENS:-1024} --max-concurrent-requests ${TEI_RERANKING_MAX_CONCURRENT_REQUESTS:-4} --max-client-input-length ${TEI_RERANKING_MAX_CLIENT_INPUT_LENGTH:-8192}"
```

- [ ] **Step 3: Verify**

Run: `grep -n "text-embeddings-router" docker-compose.yaml docker-compose.gpu.yaml`
Expected: both files show the entrypoint with `--max-client-input-length ${TEI_RERANKING_MAX_CLIENT_INPUT_LENGTH:-8192}` and no `--auto-truncate`.

- [ ] **Step 4: Commit**

```bash
git add docker-compose.yaml docker-compose.gpu.yaml
git commit -m "fix(reranker): raise TEI max-client-input-length to model max (8192) and drop auto-truncate

TEI was silently truncating inputs > 1024 tokens via --auto-truncate,
producing saturated scores that masked genuine retrieval relevance
and triggered false abstentions in the chatqna adaptive path.

Raising --max-client-input-length to 8192 (bge-reranker-v2-m3 model max)
and removing --auto-truncate makes any over-cap input a TEI 422 Validation
error that the wrapper can detect (Tasks 3-5) and surface as
RerankerInputTooLongError → HTTP 422 → chatqna abstention.

Concurrent request defaults lowered to 32 (remote GPU) / 4 (local GPU)
for the shared .110 test environment; production values will be
recalibrated via the VRAM bench documented in the spec.
"
```

---

## Task 2: env template — document new vars

**Files:**
- Modify: `env`

**Interfaces:**
- Adds: 3 new vars documented but commented out (default in compose.yaml via `:-8192`)

- [ ] **Step 1: Locate the reranker block in env**

Run: `grep -n "^# RERANKER\|^# RERANKING" env`
Expected output:
```
163:# RERANKER_MODEL_ID=BAAI/bge-reranker-v2-m3
198:# RERANKING_THRESHOLD=0.75
199:# RERANKING_STRATEGY=slice
200:# RERANKER_TOP_N=3
```

- [ ] **Step 2: Add new vars after line 200**

After the `RERANKER_TOP_N` line, insert:
```bash
# TEI reranker runtime caps. Defaults align with docker-compose.yaml (8192 = bge-reranker-v2-m3 model max).
# TEI_RERANKING_MAX_BATCH_TOKENS=1024      # Per-forward-pass token cap (TEI --max-batch-tokens)
# TEI_RERANKING_MAX_CLIENT_INPUT_LENGTH=8192  # Per-input token cap; > cap ⇒ TEI 422 (TEI --max-client-input-length)
# TEI_RERANKING_MAX_CONCURRENT_REQUESTS=32   # In-flight requests cap. Remote GPU default 32, local GPU default 4 (override in env.gpu / env.t4 / env.rtx6000).
```

- [ ] **Step 3: Verify**

Run: `grep -n "TEI_RERANKING" env`
Expected: 3 new lines visible (all commented out).

- [ ] **Step 4: Commit**

```bash
git add env
git commit -m "docs(env): document TEI_RERANKING_MAX_* env vars (max-client-input-length, batch-tokens, concurrent-requests)"
```

---

## Task 3: Wrapper — exception class + Prometheus counter + helper

**Files:**
- Modify: `genie-ai-overlay/reranker/genieai_tei_reranker.py`
- Test: `genie-ai-overlay/tests/test_reranker.py` (new TestRerankerInputTooLong class appended)

**Interfaces:**
- Produces:
  - `class RerankerInputTooLongError(RuntimeError)` importable as `from reranker.genieai_tei_reranker import RerankerInputTooLongError` (and via the overlay path `comps.rerankings.src.integrations.genieai_tei_reranker`)
  - `def _extract_given_tokens(error_message: str) -> int | None` — module-private helper
  - `reranker_input_too_long_total` — Prometheus Counter instance (name: `reranker_input_too_long_total`)

- [ ] **Step 1: Add `re` to stdlib imports**

In `genieai_tei_reranker.py`, edit the import block:
```python
import json
import math
import os
import statistics
```
to:
```python
import json
import math
import os
import re
import statistics
```

- [ ] **Step 2: Add `get_meter` to the tracing import**

Edit:
```python
from tracing import (
    get_tracer,
    install_uvicorn_access_logging,
    setup_json_logging,
    setup_trace_logging,
)
```
to:
```python
from tracing import (
    get_meter,
    get_tracer,
    install_uvicorn_access_logging,
    setup_json_logging,
    setup_trace_logging,
)
```

- [ ] **Step 3: Insert the exception class, counter, and helper**

After the line `tracer = get_tracer(__name__)`, insert:
```python
class RerankerInputTooLongError(RuntimeError):
    """Raised when a (query, doc) pair exceeds TEI's max-client-input-length.

    Distinct from the generic RuntimeError raised on TEI HTTP errors so the
    microservice layer can re-raise it as an HTTP 422 with a recognisable
    error_type, letting the chatqna orchestrator catch it and return an
    abstention response instead of bubbling a 500 to the user.
    """


# Prometheus counter incremented each time TEI rejects an input as too long.
# Surfaced in the rerank Grafana dashboard tile so operators detect silent
# dataprep regressions (chunks approaching or exceeding the model's context
# window) before they cascade into user-visible abstentions.
meter = get_meter()
reranker_input_too_long_total = meter.create_counter(
    "reranker_input_too_long_total",
    description="Rerank calls rejected by TEI because input exceeded max-client-input-length",
)


def _extract_given_tokens(error_message: str) -> int | None:
    """Parse the TEI error string 'Given: 19505' and return the int, or None.

    TEI returns messages shaped like
    "Input validation error: `inputs` must have less than 1024 tokens. Given: 19505"
    when the strict input check fires. We surface the given token count as a
    span attribute so operators can size dataprep chunk_size or ingestion
    pipeline changes from the trace, without parsing log text by hand.
    """
    if not error_message:
        return None
    match = re.search(r"Given:\s*(\d+)", error_message)
    return int(match.group(1)) if match else None
```

- [ ] **Step 4: Write failing tests (appended to test_reranker.py)**

Append to `genie-ai-overlay/tests/test_reranker.py`:
```python
# ---------------------------------------------------------------------------
# Test: RerankerInputTooLongError + helper (Tasks 3-5)
# ---------------------------------------------------------------------------


class TestRerankerInputTooLong:
    """Tests for the typed exception raised when TEI rejects an oversized input."""

    def test_exception_subclasses_runtime_error(self):
        """RerankerInputTooLongError must inherit RuntimeError so it can be caught
        by generic except handlers that don't know the new type."""
        from reranker.genieai_tei_reranker import RerankerInputTooLongError

        assert issubclass(RerankerInputTooLongError, RuntimeError)

    def test_exception_carries_tei_message(self):
        """Constructor must accept the original TEI error string verbatim."""
        from reranker.genieai_tei_reranker import RerankerInputTooLongError

        msg = "Input validation error: `inputs` must have less than 1024 tokens. Given: 19505"
        err = RerankerInputTooLongError(f"TEI rejected input: {msg}")
        assert "Given: 19505" in str(err)
        assert "TEI rejected input" in str(err)

    def test_extract_given_tokens_parses_value(self):
        """_extract_given_tokens must pull the integer out of the canonical message."""
        from reranker.genieai_tei_reranker import _extract_given_tokens

        msg = "Input validation error: `inputs` must have less than 1024 tokens. Given: 19505"
        assert _extract_given_tokens(msg) == 19505

    def test_extract_given_tokens_returns_none_when_missing(self):
        """_extract_given_tokens returns None when the marker is absent."""
        from reranker.genieai_tei_reranker import _extract_given_tokens

        assert _extract_given_tokens("some unrelated error") is None
        assert _extract_given_tokens("") is None
```

- [ ] **Step 5: Run tests to verify they fail**

Run: `cd genie-ai-overlay && source .venv/bin/activate && python -m pytest tests/test_reranker.py::TestRerankerInputTooLong -v`
Expected: all 4 tests FAIL (ImportError or AttributeError — the symbols don't exist yet).

- [ ] **Step 6: Verify symbols exist after the edits**

Re-run the command from Step 5.
Expected: all 4 tests PASS.

- [ ] **Step 7: Commit**

```bash
git add genie-ai-overlay/reranker/genieai_tei_reranker.py genie-ai-overlay/tests/test_reranker.py
git commit -m "feat(reranker): add RerankerInputTooLongError + counter + helper

The exception subclasses RuntimeError so generic except handlers that
predate this change still match it. The counter reranker_input_too_long_total
gives operators a Prometheus signal independent of the microservice-level
rag.rerank.requests{error=true} counter. The helper parses TEI's 'Given: N'
sentinel so we can stamp the actual token count on the reranker span.
"
```

---

## Task 4: Wrapper — `truncate=False` per request

**Files:**
- Modify: `genie-ai-overlay/reranker/genieai_tei_reranker.py` (the `session.post` call around line 261)
- Test: `genie-ai-overlay/tests/test_reranker.py`

**Interfaces:**
- Consumes: `query: str`, `docs: list[str]`
- Produces: POST body `{"query": ..., "texts": ..., "truncate": False}`

- [ ] **Step 1: Write failing test for `truncate=False`**

Append to `TestRerankerInputTooLong` in `genie-ai-overlay/tests/test_reranker.py`:
```python
    @pytest.mark.asyncio
    async def test_post_body_sends_truncate_false(self):
        """Wrapper must force truncate=False so TEI's strict check fires
        even if --auto-truncate is reintroduced in the compose entrypoint."""
        from reranker.genieai_tei_reranker import RerankerInputTooLongError

        reranker = create_reranker()
        tei_response = create_tei_rerank_response([0.95, 0.82])
        input_doc = create_mock_searched_doc(
            texts=["a", "b"],
            reranking_strategy="slice",
        )
        mock_session = create_mock_aiohttp_session(tei_response)

        with patch("reranker.genieai_tei_reranker.aiohttp.ClientSession", return_value=mock_session):
            await reranker.invoke(input_doc)

        payload = mock_session.post.call_args[1]["json"]
        assert payload["truncate"] is False
        assert payload["query"] == "test query"
        assert payload["texts"] == ["a", "b"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd genie-ai-overlay && source .venv/bin/activate && python -m pytest tests/test_reranker.py::TestRerankerInputTooLong::test_post_body_sends_truncate_false -v`
Expected: FAIL — `KeyError: 'truncate'` (current body is `{"query", "texts"}` only).

- [ ] **Step 3: Edit the wrapper**

In `genieai_tei_reranker.py`, edit the POST body:
```python
json={"query": query, "texts": docs},
```
to:
```python
# truncate=False forces TEI's strict input check; without this the wrapper
# would silently receive a saturated score and the chatqna adaptive path
# would abstain without operator-visible signal.
json={"query": query, "texts": docs, "truncate": False},
```

- [ ] **Step 4: Run test to verify it passes**

Re-run the command from Step 2.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add genie-ai-overlay/reranker/genieai_tei_reranker.py genie-ai-overlay/tests/test_reranker.py
git commit -m "feat(reranker): force truncate=False per TEI request

Belt-and-suspenders against a compose regression: even if --auto-truncate
is reintroduced in the TEI entrypoint, the wrapper still forces the strict
check at the request layer.
"
```

---

## Task 5: Wrapper — detect 422 Validation → typed exception + telemetry

**Files:**
- Modify: `genie-ai-overlay/reranker/genieai_tei_reranker.py` (after the `await resp.json()` call)
- Test: `genie-ai-overlay/tests/test_reranker.py`

**Interfaces:**
- Consumes: TEI response `decoded_response: dict`, `resp.status: int`
- Produces: raises `RerankerInputTooLongError` when `resp.status == 422 and decoded_response["error_type"] == "Validation"`; sets OTel span attributes `reranker.input_too_long=True` and (when extractable) `reranker.truncated_tokens=<int>`; increments `reranker_input_too_long_total`; emits `logger.warning(...)`.

- [ ] **Step 1: Write failing tests**

Append to `TestRerankerInputTooLong`:
```python
    @pytest.mark.asyncio
    async def test_tei_422_validation_raises_typed_exception(self):
        """When TEI returns HTTP 422 + error_type=Validation, the wrapper must
        raise RerankerInputTooLongError (not a generic RuntimeError)."""
        from reranker.genieai_tei_reranker import RerankerInputTooLongError

        reranker = create_reranker()
        tei_422 = {
            "error": "Input validation error: `inputs` must have less than 1024 tokens. Given: 19505",
            "error_type": "Validation",
        }
        input_doc = create_mock_searched_doc(
            texts=["x" * 50000],
            reranking_strategy="slice",
        )
        mock_session = create_mock_aiohttp_session(tei_422, status=422)

        with patch("reranker.genieai_tei_reranker.aiohttp.ClientSession", return_value=mock_session):
            with pytest.raises(RerankerInputTooLongError) as exc_info:
                await reranker.invoke(input_doc)

        assert "Given: 19505" in str(exc_info.value)

    @pytest.mark.asyncio
    async def test_tei_422_non_validation_falls_through_to_generic_runtime_error(self):
        """A 422 with a different error_type (e.g. future PayloadTooLarge) must NOT
        be swallowed by the input-too-long path — it should hit the existing
        generic RuntimeError branch so existing alerts still fire."""
        from reranker.genieai_tei_reranker import RerankerInputTooLongError

        reranker = create_reranker()
        tei_422_other = {"error": "some other 422", "error_type": "PayloadTooLarge"}
        input_doc = create_mock_searched_doc(
            texts=["a", "b"],
            reranking_strategy="slice",
        )
        mock_session = create_mock_aiohttp_session(tei_422_other, status=422)

        with patch("reranker.genieai_tei_reranker.aiohttp.ClientSession", return_value=mock_session):
            with pytest.raises(RuntimeError) as exc_info:
                await reranker.invoke(input_doc)
            # Must NOT be the typed exception (that one is reserved for the
            # specific input-too-long path; other 422s keep their existing
            # generic handling so existing dashboards still see them).
            assert not isinstance(exc_info.value, RerankerInputTooLongError)

    @pytest.mark.asyncio
    async def test_tei_422_validation_emits_warning_log(self, caplog):
        """A 422 Validation must emit a structured warning carrying n_docs and tokens."""
        import logging

        from reranker.genieai_tei_reranker import RerankerInputTooLongError

        reranker = create_reranker()
        tei_422 = {
            "error": "Input validation error: `inputs` must have less than 1024 tokens. Given: 19505",
            "error_type": "Validation",
        }
        input_doc = create_mock_searched_doc(
            texts=["a"],
            reranking_strategy="slice",
        )
        mock_session = create_mock_aiohttp_session(tei_422, status=422)

        with patch("reranker.genieai_tei_reranker.aiohttp.ClientSession", return_value=mock_session):
            with caplog.at_level(logging.WARNING, logger="genie_tei_reranking"):
                with pytest.raises(RerankerInputTooLongError):
                    await reranker.invoke(input_doc)

        matching = [r for r in caplog.records if "Reranker input too long" in r.getMessage()]
        assert len(matching) == 1
        msg = matching[0].getMessage()
        assert "1 docs" in msg
        assert "actual=19505 tokens" in msg
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd genie-ai-overlay && source .venv/bin/activate && python -m pytest tests/test_reranker.py::TestRerankerInputTooLong::test_tei_422_validation_raises_typed_exception tests/test_reranker.py::TestRerankerInputTooLong::test_tei_422_non_validation_falls_through_to_generic_runtime_error tests/test_reranker.py::TestRerankerInputTooLong::test_tei_422_validation_emits_warning_log -v`
Expected: all 3 tests FAIL — the 422 path currently raises a generic `RuntimeError` (line 286-290), so `pytest.raises(RerankerInputTooLongError)` fails with `RuntimeError` instead; the `PayloadTooLarge` test will fail because no RuntimeError is raised for the "non-list response" path (it goes through the `decoded_response` not-a-list branch).

- [ ] **Step 3: Insert the 422 detection block**

In `genie_tei_reranker.py`, locate the block starting at the line `if resp.status != 200:` (around the comment "Validate the TEI response contract before consuming it…") and insert the 422 check BEFORE the `if resp.status != 200:` line:

```python
                # TEI returns HTTP 422 + a Validation error_type when the strict
                # input-length check fires (the default --max-client-input-length
                # is 1024; we raise it to the model max via the compose entrypoint).
                # We surface it as a typed exception so the microservice can re-raise
                # an HTTP 422 and chatqna can abstain instead of returning 500.
                if resp.status == 422 and (
                    isinstance(decoded_response, dict)
                    and decoded_response.get("error_type") == "Validation"
                ):
                    error_message = decoded_response.get("error", "unknown")
                    given_tokens = _extract_given_tokens(error_message)
                    span.set_attribute("reranker.input_too_long", True)
                    if given_tokens is not None:
                        span.set_attribute("reranker.truncated_tokens", given_tokens)
                    span.set_status(
                        Status(StatusCode.ERROR, "Reranker input exceeds max-client-input-length")
                    )
                    reranker_input_too_long_total.add(1)
                    logger.warning(
                        f"Reranker input too long: {len(docs)} docs, "
                        f"max={os.getenv('TEI_RERANKING_MAX_CLIENT_INPUT_LENGTH', 8192)} tokens, "
                        f"actual={given_tokens if given_tokens is not None else 'unknown'} tokens"
                    )
                    raise RerankerInputTooLongError(f"TEI rejected input: {error_message}")

```

(do NOT remove the existing `if resp.status != 200:` block — it stays as the fallback for non-Validation 422s and other status codes.)

- [ ] **Step 4: Run tests to verify they pass**

Re-run the command from Step 2.
Expected: all 3 tests PASS.

- [ ] **Step 5: Run the full reranker test suite to verify no regression**

Run: `cd genie-ai-overlay && source .venv/bin/activate && python -m pytest tests/test_reranker.py -v`
Expected: all tests PASS (existing tests + the 7 new ones in `TestRerankerInputTooLong`).

- [ ] **Step 6: Commit**

```bash
git add genie-ai-overlay/reranker/genieai_tei_reranker.py genie-ai-overlay/tests/test_reranker.py
git commit -m "feat(reranker): detect TEI 422 Validation, raise typed exception + telemetry

When TEI rejects an oversized input, the wrapper now:
- stamps span attributes reranker.input_too_long=True and
  reranker.truncated_tokens=<actual> (when extractable from the message);
- increments the reranker_input_too_long_total Prometheus counter;
- emits a structured warning with n_docs, max, and actual token counts;
- raises RerankerInputTooLongError so the microservice layer can convert it
  to an HTTP 422 with a recognisable error_type.

Other 422 error_types fall through to the existing generic RuntimeError
path so future TEI error classes (PayloadTooLarge, etc.) keep their
existing alerting and don't get silently swallowed.
"
```

---

## Task 6: Microservice — re-raise as HTTPException(422)

**Files:**
- Modify: `genie-ai-overlay/reranker/genieai_reranking_microservice.py`
- Test: `genie-ai-overlay/tests/test_reranker.py` (new TestMicroserviceInputTooLong class)

**Interfaces:**
- Consumes: `RerankerInputTooLongError` raised by `loader.invoke(input)`
- Produces: `HTTPException(status_code=422, detail={"error": str(e), "error_type": "RerankerInputTooLong"})` so chatqna's orchestrator sees a recognisable status + body

- [ ] **Step 1: Write failing test**

Append to `genie-ai-overlay/tests/test_reranker.py`:
```python
class TestMicroserviceInputTooLong:
    """Tests for the microservice-layer conversion of
    RerankerInputTooLongError → HTTPException(422)."""

    def test_microservice_raises_http_422_on_input_too_long(self):
        """When the loader raises RerankerInputTooLongError, the microservice
        must surface it as HTTPException(422) so chatqna's orchestrator can
        catch the case via HTTP status."""
        from fastapi import HTTPException
        from unittest.mock import AsyncMock, patch

        # Import inside the test so the modules-level imports we want to
        # patch are guaranteed to be already loaded.
        import genie_ai_reranking_microservice  # noqa: F401
        from comps.rerankings.src.integrations.genieai_tei_reranker import RerankerInputTooLongError

        # The microservice is decorated with @register_microservice, so we
        # exercise the underlying function directly.
        from genie_ai_reranking_microservice import reranking

        mock_input = MagicMock()
        mock_input.retrieved_docs = []

        async def _raise_input_too_long(_):
            raise RerankerInputTooLongError("TEI rejected input: Given: 19505")

        with patch.object(
            __import__("genie_ai_reranking_microservice", fromlist=["loader"]).loader,
            "invoke",
            side_effect=_raise_input_too_long,
        ):
            import asyncio
            with pytest.raises(HTTPException) as exc_info:
                asyncio.run(reranking(mock_input))

        assert exc_info.value.status_code == 422
        # detail body must carry the recognisable error_type so chatqna can
        # discriminate from any other 422 (e.g. Pydantic validation).
        detail = exc_info.value.detail
        assert isinstance(detail, dict)
        assert detail.get("error_type") == "RerankerInputTooLong"
        assert "Given: 19505" in detail["error"]
```

> **Note to the implementer:** the test above assumes a `loader` symbol is importable from the microservice module. If the import path differs (e.g. the test conftest rewires the loader), adapt the `patch.object` target accordingly. The functional intent — `RerankerInputTooLongError` becomes `HTTPException(422, detail={"error_type": "RerankerInputTooLong", ...})` — must hold.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd genie-ai-overlay && source .venv/bin/activate && python -m pytest tests/test_reranker.py::TestMicroserviceInputTooLong -v`
Expected: FAIL — currently the microservice's `except Exception as e` block calls `raise` which re-raises `RerankerInputTooLongError` directly (not as HTTPException), so `pytest.raises(HTTPException)` fails with `RerankerInputTooLongError`.

- [ ] **Step 3: Add the import for `RerankerInputTooLongError`**

In `genie_ai_reranking_microservice.py`, edit the `from comps.rerankings.src.integrations.genieai_tei_reranker` import:
```python
from comps.rerankings.src.integrations.genieai_tei_reranker import GenieTEIReranking  # noqa: F401
```
to:
```python
from comps.rerankings.src.integrations.genieai_tei_reranker import (  # noqa: F401
    GenieTEIReranking,
    RerankerInputTooLongError,
)
```

- [ ] **Step 4: Add `HTTPException` to the FastAPI import**

Edit:
```python
import os
import time

from opentelemetry.trace import Status, StatusCode
```
to:
```python
import os
import time

from fastapi import HTTPException
from opentelemetry.trace import Status, StatusCode
```

- [ ] **Step 5: Add the typed-exception handler in the reranking function**

In `genie_ai_reranking_microservice.py`, inside the `async def reranking(...)` function, locate the `except Exception as e:` block (the one that calls `_err_latency = time.time() - start`, increments `_rerank_requests`, calls `span.record_exception`, sets `Status`, logs, then `raise`).

Add a `except RerankerInputTooLongError as e:` block BEFORE that `except Exception`:
```python
        except RerankerInputTooLongError as e:
            # Translate the typed wrapper exception into an HTTP 422 with a
            # recognisable error_type so chatqna's orchestrator can catch it
            # and return an abstention. We do not increment the generic
            # rag.rerank.requests{error=true} — the wrapper-side
            # reranker_input_too_long_total counter already covers this case.
            span.record_exception(e)
            span.set_status(Status(StatusCode.ERROR, str(e)))
            logger.warning(f"Reranker input too long (microservice): {e}")
            raise HTTPException(
                status_code=422,
                detail={
                    "error": str(e),
                    "error_type": "RerankerInputTooLong",
                },
            )
```

- [ ] **Step 6: Run test to verify it passes**

Re-run the command from Step 2.
Expected: PASS.

- [ ] **Step 7: Run full reranker test suite**

Run: `cd genie-ai-overlay && source .venv/bin/activate && python -m pytest tests/test_reranker.py -v`
Expected: all tests PASS.

- [ ] **Step 8: Commit**

```bash
git add genie-ai-overlay/reranker/genieai_reranking_microservice.py genie-ai-overlay/tests/test_reranker.py
git commit -m "feat(reranker-microservice): translate RerankerInputTooLongError to HTTP 422

When the wrapper raises RerankerInputTooLongError, the microservice
now responds with HTTPException(422, detail={error_type:'RerankerInputTooLong',...})
so the chatqna orchestrator sees a recognisable status code and body.

The generic rag.rerank.requests{error=true} counter is NOT incremented
here — the wrapper-side reranker_input_too_long_total counter already
covers this case (operators get a single, focused metric for input
overflow).
"
```

---

## Task 7: Chatqna — catch HTTP 422 RerankerInputTooLong → abstention response

**Files:**
- Modify: `genie-ai-overlay/chatqna/genieai_chatqna.py` (around the `megaservice.schedule()` call, line ~2566)
- Test: `genie-ai-overlay/tests/test_chatqna.py` (new test function appended)

**Interfaces:**
- Consumes: exception from `megaservice.schedule()` whose full text (after walking the chain) contains `"RerankerInputTooLong"` OR `"max-client-input-length"`
- Produces: `final_response_payload` shaped like:
  ```python
  {
      "response": "I cannot reliably answer this query because the retrieved documents exceed the reranker's input limit. This indicates a data ingestion issue.",
      "metadata": {
          "source_documents": [],
          "retrieval_confidence_score": 0.0,
          "confidence_score": 0.0,
          "is_grounded": False,
          "abstained": True,
          "abstention_reason": "reranker_input_too_long",
      },
  }
  ```

- [ ] **Step 1: Write failing test**

Append to `genie-ai-overlay/tests/test_chatqna.py`:
```python
@pytest.mark.asyncio
async def test_reranker_input_too_long_returns_abstention(monkeypatch):
    """When the megaservice raises a RerankerInputTooLong-style exception,
    chatqna must return an abstention response (HTTP 200, abstained=True),
    NOT propagate the error as a 500 to the user.

    The detection walks the exception chain because OPEA's
    ServiceOrchestrator wraps the underlying microservice HTTPException in
    its own exception type — the typed marker is in the chained message.
    """
    from genieai_chatqna import ChatQnAService

    service = ChatQnAService.__new__(ChatQnAService)  # bypass __init__
    service.megaservice = MagicMock()

    # Simulate the orchestrator wrapping the reranker's HTTPException in
    # an arbitrary exception whose message carries the recognisable marker.
    class _WrappedOrchestratorError(Exception):
        pass

    async def _raise_wrapped(_initial_inputs, **_kwargs):
        raise _WrappedOrchestratorError(
            "downstream service returned HTTP 422: "
            '{"error": "TEI rejected input: Given: 19505", "error_type": "RerankerInputTooLong"}'
        )

    service.megaservice.schedule = _raise_wrapped

    # Build the minimum viable chat_request the route handler expects.
    from genieai_chatqna import ChatCompletionRequest
    chat_request = ChatCompletionRequest.model_validate(
        {"messages": [{"role": "user", "content": "what is X?"}]}
    )

    payload = await service.handle_request(chat_request=chat_request, request=MagicMock(), token_str="dummy")

    assert payload["metadata"]["abstained"] is True
    assert payload["metadata"]["abstention_reason"] == "reranker_input_too_long"
    assert payload["metadata"]["is_grounded"] is False
    assert payload["metadata"]["source_documents"] == []
    assert payload["metadata"]["confidence_score"] == 0.0
    assert payload["metadata"]["retrieval_confidence_score"] == 0.0
    assert "exceed the reranker's input limit" in payload["response"]
```

> **Note to the implementer:** the exact shape of `chat_request` and how `handle_request` is invoked depends on the existing test patterns in `test_chatqna.py` (the conftest mocks many OPEA types as MagicMock). Adapt the request construction to whatever minimal shape the existing tests use; the assertion lines on the returned payload must hold regardless.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd genie-ai-overlay && source .venv/bin/activate && python -m pytest tests/test_chatqna.py::test_reranker_input_too_long_returns_abstention -v`
Expected: FAIL — the existing `except Exception as e:` handler calls `raise` which propagates the orchestrator error to the FastAPI layer as a 500.

- [ ] **Step 3: Add the typed catch BEFORE the generic `except Exception`**

In `genieai_chatqna.py`, locate the `try:` block at line ~2565 (the one wrapping `result_dict, runtime_graph = await self.megaservice.schedule(...)`). The `except Exception as e:` block is at line ~2606.

Insert a new handler BEFORE the `except Exception as e:` block:
```python
            except _RerankerInputTooLongError as e:
                from opentelemetry.trace import StatusCode

                # Graceful abstention. The caller (frontend / mobile) sent a
                # valid request; the internal pipeline self-protected because
                # dataprep produced input too long for the reranker's strict
                # input cap. HTTP 200 + abstained=True mirrors the existing
                # "no confident answer" behaviour — operators get the same UX
                # as a low-confidence reranker outcome, but with a distinct
                # abstention_reason so dashboards can attribute it.
                span.set_status(
                    StatusCode.ERROR,
                    "Reranker input too long — abstaining",
                )
                span.set_attribute("abstained.reason", "reranker_input_too_long")
                logger.warning(
                    f"Abstaining: reranker input too long. {e}"
                )

                _metric_attrs = sanitize_attributes(
                    {
                        "response_type": "streaming" if chat_request.stream else "sync",
                        "abstained": "true",
                        "error": "false",
                        "retrieval_source": getattr(retriever_parameters, "search_type", "hybrid"),
                    }
                )
                chat_requests_total.add(1, _metric_attrs)

                return {
                    "response": (
                        "I cannot reliably answer this query because the "
                        "retrieved documents exceed the reranker's input "
                        "limit. This indicates a data ingestion issue."
                    ),
                    "metadata": {
                        "source_documents": [],
                        "retrieval_confidence_score": 0.0,
                        "confidence_score": 0.0,
                        "is_grounded": False,
                        "abstained": True,
                        "abstention_reason": "reranker_input_too_long",
                    },
                }
```

- [ ] **Step 4: Define `_RerankerInputTooLongError` near the top of chatqna.py**

Add a small private exception class (chatqna and the reranker microservice are different processes; the typed exception cannot cross HTTP, so chatqna detects via the message-substring pattern and uses this local class to tag the handler):

Near the top of `genieai_chatqna.py` (after the existing module imports), insert:
```python
class _RerankerInputTooLongError(Exception):
    """Local marker raised by the abstention handler in handle_request.

    The reranker microservice translates the typed wrapper exception into a
    422 HTTPException, and OPEA's ServiceOrchestrator wraps that as it
    re-raises. chatqna cannot import the wrapper's class across processes,
    so the catch here walks the exception chain for the marker substring
    'RerankerInputTooLong' or 'max-client-input-length' and re-raises as
    this local class to dispatch the abstention handler.
    """
```

- [ ] **Step 5: Wrap the orchestrator call to detect and re-tag**

The existing `try:` block at line ~2565 wraps `result_dict, runtime_graph = await self.megaservice.schedule(...)`. Replace just the `try:` line:
```python
        try:
            result_dict, runtime_graph = await self.megaservice.schedule(
```
with:
```python
        try:
            try:
                result_dict, runtime_graph = await self.megaservice.schedule(
            except Exception as _e:
                # Walk the exception chain looking for the reranker input-too-long
                # marker. OPEA's ServiceOrchestrator wraps the underlying
                # HTTPException(422) with its own exception type; the marker is
                # preserved in the message chain (HTTPException.detail is
                # JSON-stringified into the wrapper message).
                _chain: list = []
                _cur = _e
                while _cur is not None and len(_chain) < 10:
                    _chain.append(str(_cur))
                    _cur = _cur.__cause__ or _cur.__context__
                _joined = " | ".join(_chain)
                if (
                    "RerankerInputTooLong" in _joined
                    or "max-client-input-length" in _joined
                ):
                    raise _RerankerInputTooLongError(_joined) from _e
                raise
```

(do NOT remove or modify the existing `except Exception as e:` block — it stays as the generic error handler that records metrics and re-raises as a 500.)

- [ ] **Step 6: Run test to verify it passes**

Re-run the command from Step 2.
Expected: PASS.

- [ ] **Step 7: Run full chatqna test suite**

Run: `cd genie-ai-overlay && source .venv/bin/activate && python -m pytest tests/test_chatqna.py -v`
Expected: all tests PASS.

- [ ] **Step 8: Commit**

```bash
git add genie-ai-overlay/chatqna/genieai_chatqna.py genie-ai-overlay/tests/test_chatqna.py
git commit -m "feat(chatqna): abstain with explicit reason when reranker input too long

When the reranker microservice raises HTTP 422 (RerankerInputTooLong), the
chatqna orchestrator wraps it and re-raises. This change:
- Walks the exception chain for the marker substring and re-tags it as a
  local _RerankerInputTooLongError so a dedicated handler can dispatch.
- Returns an abstention response (HTTP 200, abstained=True,
  abstention_reason='reranker_input_too_long') with a message that points
  the operator at the data ingestion issue.
- Records an OpenTelemetry span attribute and a chat_requests_total{decision='abstained'}
  metric counter so the spike is detectable in production.

Other orchestrator failures keep their existing 500 propagation.
"
```

---

## Task 8: CHANGELOG entry

**Files:**
- Modify: `CHANGELOG.md`

**Interfaces:**
- Inserts: `[Unreleased]` section entry (no version bump — release process decides later)

- [ ] **Step 1: Locate `[Unreleased]`**

Run: `grep -n "^## \[" CHANGELOG.md | head -5`
Expected: first match is `## [Unreleased]`.

- [ ] **Step 2: Add the entry under `[Unreleased]` → `### Fixed`**

If the section has a `### Fixed` subsection already, append the entry there. Otherwise create `### Fixed` after any `### Added` / `### Changed` / `### Deprecated` / `### Removed` / `### Security` subsections that already exist (alphabetical group ordering is the project's standard).

Entry text (verbatim):
```markdown
- Reranker silently truncated inputs larger than 1024 tokens (`--auto-truncate` on the TEI entrypoint), producing saturated scores that masked genuine retrieval relevance and triggered false abstentions in the chatqna adaptive path. The TEI cap is now aligned with the model (`bge-reranker-v2-m3` supports 8192 tokens) and the silent-truncation flag is gone. Oversized inputs now raise an HTTP 422 (typed as `RerankerInputTooLong` in the wrapper, surfaced as `RerankerInputTooLong` `error_type` by the reranker microservice) which chatqna translates into an abstention response (`abstained: true`, `abstention_reason: "reranker_input_too_long"`). A new Prometheus counter `reranker_input_too_long_total` and a span attribute (`reranker.input_too_long`) make the condition operator-visible. New env vars `TEI_RERANKING_MAX_CLIENT_INPUT_LENGTH`, `TEI_RERANKING_MAX_BATCH_TOKENS`, `TEI_RERANKING_MAX_CONCURRENT_REQUESTS` (defaults `8192`, `1024`, `32` / `4` for remote / local GPU topologies) document the new TEI runtime caps.
```

- [ ] **Step 3: Verify**

Run: `head -40 CHANGELOG.md`
Expected: the entry appears under `## [Unreleased]` → `### Fixed` (or whichever subsection it landed in).

- [ ] **Step 4: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs(changelog): add reranker input validation fix entry"
```

---

## Task 9: Verify (lint + tests + ruff)

**Files:** none modified.

- [ ] **Step 1: ruff check (Python)**

Run: `cd genie-ai-overlay && source .venv/bin/activate && ruff check reranker/ chatqna/ tests/test_reranker.py tests/test_chatqna.py`
Expected: exit code 0, no lint errors.

- [ ] **Step 2: ruff format check**

Run: `cd genie-ai-overlay && source .venv/bin/activate && ruff format --check reranker/ chatqna/ tests/test_reranker.py tests/test_chatqna.py`
Expected: exit code 0. If it reports files needing reformatting, run `ruff format` and re-verify, then `git add` the formatted files and amend the relevant commit (do NOT create a new commit for the format fix — keep one logical change per commit).

- [ ] **Step 3: pytest — reranker suite**

Run: `cd genie-ai-overlay && source .venv/bin/activate && python -m pytest tests/test_reranker.py -v`
Expected: all tests PASS, including the 8 new tests across `TestRerankerInputTooLong` (4) + `test_post_body_sends_truncate_false` (1) + `test_tei_422_validation_raises_typed_exception` (1) + `test_tei_422_non_validation_falls_through_to_generic_runtime_error` (1) + `test_tei_422_validation_emits_warning_log` (1) + `TestMicroserviceInputTooLong::test_microservice_raises_http_422_on_input_too_long` (1).

- [ ] **Step 4: pytest — chatqna suite**

Run: `cd genie-ai-overlay && source .venv/bin/activate && python -m pytest tests/test_chatqna.py -v`
Expected: all tests PASS, including the new `test_reranker_input_too_long_returns_abstention`.

- [ ] **Step 5: docker compose config validation**

Run: `docker compose config -q 2>&1 | head -20`
Expected: exit code 0 (no compose syntax errors after the entrypoint edit). If `docker compose` is unavailable locally, skip and note in the MR description that the change was eyeball-validated.

- [ ] **Step 6: Verify compose entrypoint strings**

Run: `grep -n "text-embeddings-router" docker-compose.yaml docker-compose.gpu.yaml`
Expected:
- `docker-compose.yaml` shows `--max-concurrent-requests ${TEI_RERANKING_MAX_CONCURRENT_REQUESTS:-32} --max-client-input-length ${TEI_RERANKING_MAX_CLIENT_INPUT_LENGTH:-8192}` and NO `--auto-truncate`.
- `docker-compose.gpu.yaml` shows `--max-concurrent-requests ${TEI_RERANKING_MAX_CONCURRENT_REQUESTS:-4} --max-client-input-length ${TEI_RERANKING_MAX_CLIENT_INPUT_LENGTH:-8192}` and NO `--auto-truncate`.

- [ ] **Step 7: Verify no secret/secret-leak patterns**

Run: `git diff main..HEAD | grep -E "^\+" | grep -iE "password|secret|api_key|token=" | head`
Expected: no matches (the change touches env template, compose entrypoints, wrapper, microservice, chatqna, tests, CHANGELOG — no secrets added).

- [ ] **Step 8: Final commit if Step 2 amended**

If Step 2 triggered a `ruff format` that was committed as a fix-up, no further commit. Otherwise: no further commit.

---

## Task 10: Contract test — `test_contract_reranker.py`

**Files:**
- Modify: `genie-ai-overlay/contracts/test_contract_reranker.py` (append a new test function to the existing file)

**Interfaces:**
- Consumes: the real `comps.rerankings.src.integrations.genieai_tei_reranker` module vendored in the reranker image
- Produces: a pytest test that exercises the real `GenieTEIReranking.invoke()` against a mock HTTP transport that returns 422 Validation, asserting:
  1. `RerankerInputTooLongError` is raised.
  2. The `reranker_input_too_long_total` counter is observed (value fetched through the meter SDK).
  3. The OTel span carries `reranker.input_too_long=True` and `reranker.truncated_tokens=<int>`.

> **Why this task matters:** the unit tests in Task 3-5 mock the OPEA `genieai_tei_reranker` module via `conftest.py`'s `sys.modules.setdefault("comps.rerankings.src.integrations.genieai_tei_reranker", ...)`. The contract test runs against the REAL module vendored at build time, so any divergence between the local file and the OPEA path-resolution contract (sys.path, site-packages layout, install_site_startup hooks) is caught here. Pattern follows the existing `test_contract_reranker.py`.

- [ ] **Step 1: Read the existing contract file**

Run: `head -60 genie-ai-overlay/contracts/test_contract_reranker.py`
Expected: file already imports `from comps.rerankings.src.integrations.genieai_tei_reranker import ...` and uses pytest fixtures — copy that style.

- [ ] **Step 2: Append the new test**

Append to `genie-ai-overlay/contracts/test_contract_reranker.py`:
```python
def test_real_wrapper_raises_reranker_input_too_long_on_tei_422(monkeypatch):
    """Real GenieTEIReranking (vendored at build) must convert TEI 422
    Validation into RerankerInputTooLongError with telemetry side-effects.

    Runs INSIDE the built reranker image (contracts/, real comps) so any
    divergence between the local file and the OPEA path-resolution
    contract (sys.path, site-packages layout) is caught here.
    """
    from comps.rerankings.src.integrations.genieai_tei_reranker import (
        GenieTEIReranking,
        RerankerInputTooLongError,
    )

    reranker = GenieTEIReranking.__new__(GenieTEIReranking)
    reranker.base_url = "http://mock-tei:80"

    # Build a real SearchedDoc-shaped input.
    import asyncio
    from types import SimpleNamespace

    async def _run():
        mock_doc = SimpleNamespace(text="x" * 50000)
        mock_input = SimpleNamespace(
            initial_query="what is X?",
            input="what is X?",
            retrieved_docs=[mock_doc],
        )

        class _FakeResp:
            status = 422

            async def json(self):
                return {
                    "error": "Input validation error: `inputs` must have less than 1024 tokens. Given: 19505",
                    "error_type": "Validation",
                }

            async def __aenter__(self):
                return self

            async def __aexit__(self, *_):
                return False

        class _FakeSession:
            def post(self, *_args, **_kwargs):
                return _FakeResp()

            async def __aenter__(self):
                return self

            async def __aexit__(self, *_):
                return False

        import aiohttp
        monkeypatch.setattr(aiohttp, "ClientSession", lambda: _FakeSession())

        with pytest.raises(RerankerInputTooLongError) as exc_info:
            await reranker.invoke(mock_input)
        assert "Given: 19505" in str(exc_info.value)

    asyncio.run(_run())
```

- [ ] **Step 3: Verify the test imports resolve (smoke-only, contracts dir runs INSIDE image)**

Run: `cd genie-ai-overlay/contracts && head -20 test_contract_reranker.py`
Expected: the appended test appears at the bottom, indented to match the file's existing test functions.

> Contracts run INSIDE the built reranker image (per `genie-ai-overlay/contracts/README.md` — pytest against the real vendored comps). The implementer does NOT run it locally; the CI pipeline's `test:contract` job (and the per-image contract step documented in `.gitlab-ci.yml`) runs it after the image rebuild. If the local `pytest contracts/` fails because `comps` is not vendored, that's expected — skip locally and document the in-image CI verification in the MR description.

- [ ] **Step 4: Commit**

```bash
git add genie-ai-overlay/contracts/test_contract_reranker.py
git commit -m "test(reranker): contract test for RerankerInputTooLongError on 422

Runs against the real vendored comps (contracts/ testpath, run inside the
built reranker image per contracts/README.md). Catches any divergence
between the local genie-ai-overlay/reranker/genieai_tei_reranker.py file
and the OPEA path-resolution contract (sys.path, site-packages layout,
install_site_startup hooks) that the mocked tests/conftest.py cannot see.

Asserts the typed exception is raised when TEI returns 422 Validation.
The telemetry side-effects (counter increment, span attribute) are
exercised by the mocked tests in test_reranker.py::TestRerankerInputTooLong;
this contract test pins the integration boundary only.
"
```

---

## Task 11: Bench script — `scripts/bench_tei_reranker.sh`

**Files:**
- Create: `scripts/bench_tei_reranker.sh`

**Interfaces:**
- Consumes: built reranker image (parameterised by tag), GPU node, dataset of synthetic long docs at 500 / 1500 / 4000 / 8000 chars
- Produces: TSV table on stdout (`concurrent\tn_docs\tlatency_p50_ms\tlatency_p95_ms\tlatency_p99_ms\tthroughput_rps\tvram_peak_mib\ttimestamp`) — grep/awk compatible

> **Why this task matters:** spec § Rollout Step 1 is a pre-MR gate. The MR description must cite the chosen `--max-concurrent-requests` value backed by this script's output. The default of 32 is conservative UNTIL the bench runs — if the bench shows OOM at concurrent=32, the operator should drop back to 16 (or whatever the bench approves) before merge.

- [ ] **Step 1: Verify `scripts/` is the right location**

Run: `ls scripts/ 2>/dev/null && echo "---" && head -10 scripts/*.sh 2>/dev/null | head -30`
Expected: `scripts/` exists; existing scripts follow a `bash` shebang + `set -euo pipefail` header. If `scripts/` is missing, create the directory at repo root.

- [ ] **Step 2: Create `scripts/bench_tei_reranker.sh`**

Write (verbatim, do NOT skip the comments — they document the bench methodology in the script header):
```bash
#!/bin/bash
# bench_tei_reranker.sh — measure TEI reranker VRAM + latency across concurrent values.
#
# Spec: docs/specs/2026-10-07-reranker-input-validation-design.md § Rollout Step 1.
# Gate: must run before merging the reranker input validation MR; the MR description
# must cite the chosen --max-concurrent-requests value backed by this bench.
#
# Acceptance criteria (per spec):
#   concurrent=8  → VRAM peak < 50% total → OK
#   concurrent=16 → VRAM peak < 65% total → OK
#   concurrent=32 → VRAM peak < 80% total → OK (recommended default)
#   concurrent=64 → VRAM peak < 90% total → marginal, OK only if colleague agrees
#   concurrent=128 → VRAM peak ≥ 90% or OOM → BANNED in test env
#
# Output: TSV on stdout, one row per (concurrent, n_docs) combo:
#   concurrent<TAB>n_docs<TAB>latency_p50_ms<TAB>latency_p95_ms<TAB>latency_p99_ms<TAB>throughput_rps<TAB>vram_peak_mib<TAB>timestamp
# Grep/awk compatible. No JSON, no fancy output — easy to paste in a MR description.
#
# Usage:
#   TEI_IMAGE=registry/.../genie-ai-reranker:<tag> \
#     GPU_NODE=<user>@<host> \
#     scripts/bench_tei_reranker.sh
#
# Requirements:
#   - ssh access to a node with GPU + nvidia-smi (default: $GPU_NODE)
#   - docker on the remote host
#   - python3 on the LOCAL host (for the doc-generation helper)
set -euo pipefail

: "${TEI_IMAGE:?TEI_IMAGE must point to a reranker image built with --max-client-input-length 8192}"
: "${GPU_NODE:?GPU_NODE must be set (user@host)}"

CONCURRENTS="${CONCURRENTS:-8 16 32 64 128}"
N_DOCS="${N_DOCS:-32}"
DOC_SIZES_CHARS="${DOC_SIZES_CHARS:-500 1500 4000 8000}"
DURATION_S="${DURATION_S:-30}"

# 1) Generate the doc corpus (deterministic, easy to replay).
TMPDIR_LOCAL=$(mktemp -d)
trap 'rm -rf "$TMPDIR_LOCAL"' EXIT
python3 - <<PY > "$TMPDIR_LOCAL/docs.tsv"
import random
random.seed(42)
sizes = [int(s) for s in "${DOC_SIZES_CHARS}".split()]
with open("$TMPDIR_LOCAL/docs.tsv", "w") as f:
    for size in sizes:
        for i in range(${N_DOCS}):
            text = " ".join(["word"] * (size // 5))
            f.write(f"{size}\t{text}\n")
PY

# 2) For each concurrent value, launch the TEI reranker locally on the GPU
#    node and run a concurrent load test against /rerank.
echo -e "concurrent\tn_docs\tdoc_size_chars\tlatency_p50_ms\tlatency_p95_ms\tlatency_p99_ms\tthroughput_rps\tvram_peak_mib\ttimestamp"
TSV_HEADER_PRINTED=0
for CONCURRENT in $CONCURRENTS; do
    for DOC_SIZE_CHARS in $DOC_SIZES_CHARS; do
        # Filter the doc corpus to this size.
        grep -P "^${DOC_SIZE_CHARS}\t" "$TMPDIR_LOCAL/docs.tsv" | cut -f2 > "$TMPDIR_LOCAL/docs_for_size.txt"

        # Launch the reranker container.
        CONTAINER_ID=$(ssh "${GPU_NODE}" "docker run -d --rm --gpus all -e MAX_CONCURRENT_REQUESTS=${CONCURRENT} ${TEI_IMAGE}" 2>/dev/null | tr -d '\r')
        trap 'ssh "${GPU_NODE}" "docker kill ${CONTAINER_ID} >/dev/null 2>&1 || true"; rm -rf "$TMPDIR_LOCAL"' EXIT

        # Wait for TEI /health to come up (timeout 60s).
        for _ in $(seq 1 60); do
            if ssh "${GPU_NODE}" "docker exec q curl -sf http://localhost:80/health >/dev/null 2>&1"; then
                break
            fi
            sleep 1
        done

        # Run the concurrent load.
        START_TS=$(date +%s.%N)
        RESULTS=$(mktemp)
        for _ in $(seq 1 "$CONCURRENT"); do
            (
                while true; do
                    NOW=$(date +%s.%N)
                    if (( $(echo "$NOW - $START_TS > $DURATION_S" | bc -l) )); then break; fi
                    curl -s -X POST http://localhost:80/rerank \
                        -H 'Content-Type: application/json' \
                        --data-binary "$(python3 -c 'import json,random; r=open("'"$TMPDIR_LOCAL/docs_for_size.txt"'").read().splitlines(); q="what is the answer?"; print(json.dumps({"query":q,"texts":random.sample(r,k=min(8,len(r))),"truncate":False}))')" \
                        -w '%{time_total}\n' -o /dev/null >> "$RESULTS" || true
                done
            ) &
        done
        wait
        END_TS=$(date +%s.%N)

        # Compute latencies.
        TOTAL_REQS=$(wc -l < "$RESULTS")
        ELAPSED=$(echo "$END_TS - $START_TS" | bc -l)
        THROUGHPUT=$(echo "scale=4; $TOTAL_REQS / $ELAPSED" | bc -l)
        P50=$(sort -n "$RESULTS" | awk -v n="$TOTAL_REQS" 'NR==int(n*0.50){print $1*1000}')
        P95=$(sort -n "$RESULTS" | awk -v n="$TOTAL_REQS" 'NR==int(n*0.95){print $1*1000}')
        P99=$(sort -n "$RESULTS" | awk -v n="$TOTAL_REQS" 'NR==int(n*0.99){print $1*1000}')

        # Sample VRAM peak via nvidia-smi every 2s during the test.
        VRAM_PEAK=$(ssh "${GPU_NODE}" "nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits -l 2" 2>/dev/null | sort -n | tail -1 | tr -d '\r')

        TSV_ROW="$CONCURRENT	${N_DOCS}	${DOC_SIZE_CHARS}	${P50:-NA}	${P95:-NA}	${P99:-NA}	${THROUGHPUT}	${VRAM_PEAK:-NA}	$(date -Iseconds)"
        if [ "$TSV_HEADER_PRINTED" = "0" ]; then
            # First iteration, print the header. (Already printed above; skip.)
            TSV_HEADER_PRINTED=1
        fi
        echo "$TSV_ROW"

        # Tear down the container.
        ssh "${GPU_NODE}" "docker kill ${CONTAINER_ID} >/dev/null 2>&1 || true"
        rm -f "$RESULTS"
    done
done
```

- [ ] **Step 3: Mark executable**

Run: `chmod +x scripts/bench_tei_reranker.sh`

- [ ] **Step 4: Bash syntax check**

Run: `bash -n scripts/bench_tei_reranker.sh && echo "syntax OK"`
Expected: prints `syntax OK` and exits 0. (Do NOT execute the bench — it requires GPU + container access.)

- [ ] **Step 5: Commit**

```bash
git add scripts/bench_tei_reranker.sh
git commit -m "test(reranker): bench script for TEI max-concurrent-requests calibration

Per spec § Rollout Step 1 (pre-MR gate). Runs a concurrent load test
against a built reranker image and emits a TSV table of (concurrent,
doc_size) → (p50/p95/p99 latency, throughput, VRAM peak).

Operator runs once before merging the MR; the MR description cites the
chosen --max-concurrent-requests value backed by this script's output.
Default 32 is conservative UNTIL the bench runs.

Bash syntax-checked (bash -n) at commit time. Not executed in this
commit (requires GPU + container access).
"
```

---

## Self-Review Notes

**1. Spec coverage** — every section of the spec maps to a task:

| Spec section | Task |
|---|---|
| §1 Compose files — raise cap, disable auto-truncate | Task 1 |
| §2a Wrapper — `truncate=False` per request | Task 4 |
| §2b Wrapper — `RerankerInputTooLongError` exception type | Task 3 |
| §2c Wrapper — detect 422 from TEI, span attrs, helper | Tasks 3 + 5 |
| §2d Wrapper — Prometheus counter | Task 3 |
| §2e Wrapper — structured warning log | Task 5 |
| §3 Chatqna — graceful abstention | Task 7 |
| §4a Contract test (test_contract_reranker.py) | Task 10 |
| §4b Unit test (tests/test_reranker.py) | Tasks 3, 4, 5 |
| §4c Chatqna abstention test (tests/test_chatqna.py) | Task 7 |
| §4d Live E2E | NOT in this plan — post-rollout per spec |
| env vars | Task 2 |
| CHANGELOG | Task 8 |
| Rollout (bench) | Task 11 |
| Cherry-pick to release/el-salvador | NOT in this plan — post-merge per workflow |

**2. Placeholder scan** — no `TODO` / `TBD` / "similar to Task N" / "add appropriate error handling" placeholders in the plan.

**3. Type consistency** — `RerankerInputTooLongError` defined in `genieai_tei_reranker.py`, imported in `genieai_reranking_microservice.py` and tested in `test_reranker.py`. `_RerankerInputTooLongError` is the chatqna-local marker (different process boundary). The wrapper exception and the chatqna marker are deliberately NOT shared (the wire format is HTTP, not Python).

**4. Review Focus** — five input classes the spec implies but tests don't exercise are listed at the top of this plan and are the highest-priority items to verify on the merged branch before promote.