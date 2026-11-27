# S3-plan-2b: the P3 re-run with three tool declarations

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-run the P3 tool-calling matrix against the venue with **three** tool declarations registered (`web_search` the target, two distractors), so the slice's evidence says the endpoint handles the three-tool catalog — not one declaration.

**Architecture:** The harness (`components/agent-service/measurement/v06_harness.py`) already judges a call against an EXPECTED tool name (`parse_nonstreaming_tool_calls(message, expected_name)`, `reassemble_streaming_tool_calls(events, expected_name)`) — the matrix is the only place that must change. The change is: three declarations in the request's `tools` array, the prompt naming the TARGET, `tool_choice` "named" naming the target, the judge expecting the target, and the evidence record naming the declared tools. The matrix's AXES (tool-choice mode × schema strictness × streaming = 12 cells) and the acceptance semantics stay exactly as they are.

**Tech Stack:** Python 3.11, pytest 9.1.1, httpx 0.28.1, vLLM 0.29.0 (the venue's).

**Spec:** `docs/superpowers/specs/2026-11-25-agentic-iteration-2-architecture-design.md` §10.8 (P3) and §13.3 ("S3-plan-2 re-runs it with `web_search` registered (three tools)"); ADR `docs/adr/agentic-002-first-agent-runtime-d03.md` (the acceptance the operator signs).

## Global Constraints

- **The harness's schemas are its OWN axis, deliberately not the product's.** The file says so at the `SCHEMAS` definition: the matrix measures how a tool-calling endpoint behaves under DIFFERENT declarations. The three declarations below are the MATRIX's own — do NOT import `SEARCH_KNOWLEDGE_DEFINITION` / `READ_SOURCE_DEFINITION` / `WEB_SEARCH_DEFINITION` from `agent/sources.py`.
- **The harness reads no environment of its own beyond the venue string.** The endpoint, the key and the TLS knob come from the deployment's env (`VLLM_LLM_ENDPOINT`, `VLLM_API_KEY`, `OPEA_SSL_SKIP_VERIFY`); `AGENT_VERIFICATION_VENUE` is the free-text venue label.
- **A failed cell is recorded, never skipped.** The record always exists, even on a crash (`_failure_record`).
- **Exit 0 means the FULL acceptance passed** (`acceptance_verdict`): the identity resolved, every cell valid with no error, the streaming demo cancelled + aborted + delivered nothing, the loop demo propagated the cancellation onto a proven dispatched call with no terminal event.
- **Lint with the PINNED version**: `uvx ruff@0.16.3 check --no-cache …` and `uvx ruff@0.16.3 format --no-cache --check …` (a local ruff 0.16.4 has different format rules — never use it, never `ruff --fix` with another version).
- **The venue is the GPU node, reached from the forge** (`https://ai.assembly.govstack.global:444/llm`), and the API key comes from the cluster's `vllm-api-key` Secret. The 2026-11-24 record's reproduction block is the recipe; the venue's known state is 10 of 12 cells valid — the two `auto` + `streaming` cells fail there for a SERVING reason (the record says so), not a code reason.
- **The previous record stays untouched**: `docs/baselines/v06-runtime-verification-2026-11-24.md` is the "before" evidence (one declaration). The new record is a DIFFERENT subject (three declarations) and says so.

---

### Task 1: The matrix declares three tools

**Files:**
- Modify: `components/agent-service/measurement/v06_harness.py` (the declarations, the payload, the prompt, `tool_choice_value`, `run_cell`'s expected name, the evidence record's declared-tools field)
- Test: `components/agent-service/tests/test_v06_harness.py` (the new pins)

**Interfaces:**
- Consumes: `parse_nonstreaming_tool_calls(message: dict, expected_name: str) -> ToolCallObservation` and `reassemble_streaming_tool_calls(events: list[dict], expected_name: str) -> ToolCallObservation` (unchanged — the judge is already parameterised); `SCHEMAS` (the strict/permissive axis, unchanged); `cell_label(mode, strictness, streaming)` (unchanged).
- Produces: `MATRIX_TOOL_NAMES: tuple[str, ...]` (the three declared names, the target FIRST); `MATRIX_TARGET: str` (the tool the prompt asks for and the judge expects — `"web_search"`); `tool_choice_value(mode: str, target: str = MATRIX_TARGET) -> Any` (the "named" wire value names the TARGET); `VerificationEvidence.declared_tools: tuple[str, ...]` (the three names, in the record); the prompt naming the target.

- [ ] **Step 1: Write the failing tests — the matrix declares three tools**

In `components/agent-service/tests/test_v06_harness.py`, add:

```python
def test_the_matrix_declares_three_tools_with_the_target_first():
    assert MATRIX_TOOL_NAMES == ("web_search", "search_knowledge", "read_source")
    assert MATRIX_TARGET == "web_search"


def test_the_payload_carries_the_three_declarations():
    payload = _matrix_payload("auto", "strict", streaming=False, model_id="m")
    names = [d["function"]["name"] for d in payload["tools"]]
    assert names == list(MATRIX_TOOL_NAMES)
    # the target's declaration carries the matrix's own schema axis
    target = next(d for d in payload["tools"] if d["function"]["name"] == MATRIX_TARGET)
    assert target["function"]["parameters"] == SCHEMAS["strict"]


def test_the_named_tool_choice_names_the_target():
    assert tool_choice_value("named") == {"type": "function", "function": {"name": MATRIX_TARGET}}


def test_the_prompt_asks_for_the_target_tool():
    assert MATRIX_TARGET in MATRIX_PROMPT


def test_the_record_names_the_declared_tools():
    evidence = VerificationEvidence(
        producer=PRODUCER_ID,
        venue="v",
        captured_at_utc="2026-11-27T00:00:00+00:00",
        identity=EndpointIdentity(
            generation_endpoint="https://venue/llm/v1/chat/completions",
            version_raw="{}",
            version_note="",
            model_id="m",
            max_model_len=1,
            served_at_utc="2026-11-27T00:00:00+00:00",
            venue="v",
        ),
        cells=(),
        first_call_latency_ms={},
        first_call_cell={},
        streaming_cancel=StreamingCancelObservation(
            deltas_received=3,
            cancelled_error_raised=True,
            connection_aborted=True,
            completion_delivered=False,
            wait_seconds=1.0,
        ),
        loop_cancel=LoopCancelObservation(
            cancelled_error_propagated=True,
            model_post_dispatched=True,
            terminal_event_seen=False,
            wait_seconds=1.0,
        ),
        plain_control=PlainControlObservation(status_ok=True, content_present=True),
        declared_tools=MATRIX_TOOL_NAMES,
    )
    assert evidence.as_dict()["declared_tools"] == list(MATRIX_TOOL_NAMES)
```

**These keywords are the dataclasses' REAL field names**, verified against
`measurement/v06_harness.py` on 2026-11-27: `EndpointIdentity` requires
`generation_endpoint` and `served_at_utc` beside the four the first draft
named; `LoopCancelObservation` requires `model_post_dispatched` (the dispatch
PROOF) and `wait_seconds`; `StreamingCancelObservation` names its facts
`cancelled_error_raised` / `connection_aborted` / `completion_delivered` /
`wait_seconds`; `PlainControlObservation` is `status_ok` / `content_present` /
`detail=None`. `notes` keeps its default. Re-read the classes before writing
the row — a drift here is a TypeError at test time, not a pin.

- [ ] **Step 2: Run the new pins and watch them fail**

Run: `cd components/agent-service && /tmp/genie-agent-service-venv/bin/python -m pytest tests/test_v06_harness.py -q -k "three_tools or three_declarations or target or declared_tools"`

Expected: FAIL — `ImportError: cannot import name 'MATRIX_TOOL_NAMES' from 'measurement.v06_harness'` (the names do not exist yet).

- [ ] **Step 3: The minimal implementation — three declarations**

In `components/agent-service/measurement/v06_harness.py`:

1. Replace `TOOL_NAME` with the three-name declaration and the target:

```python
MATRIX_TOOL_NAMES: tuple[str, ...] = ("web_search", "search_knowledge", "read_source")
"""The three declarations the matrix registers, the TARGET first. The
matrix measures how the endpoint behaves when SEVERAL declarations are
registered and the model must pick one: the slice's catalog carries three
tools, so a one-declaration matrix does not measure the deployed shape. The
target is ``web_search`` — the tool the slice added — and the other two are
distractors, present so the model's CHOICE is observable."""

MATRIX_TARGET: str = MATRIX_TOOL_NAMES[0]
"""The tool the prompt asks for and the judge expects. A cell is valid only
when the endpoint called THIS one: a call to a distractor is a wrong
answer, not a valid cell."""
```

2. The prompt names the target:

```python
MATRIX_PROMPT = (
    "Search the public web for the organization's remote-work policy. "
    "You must call the web_search tool with the query; do not answer from memory."
)
```

3. `tool_choice_value` takes the target:

```python
def tool_choice_value(mode: str, target: str = MATRIX_TARGET) -> Any:
    """The OpenAI-compatible ``tool_choice`` wire value of a matrix mode."""
    if mode == "auto":
        return "auto"
    if mode == "required":
        return "required"
    if mode == "named":
        return {"type": "function", "function": {"name": target}}
    raise ValueError(f"unknown tool-choice mode: {mode!r}")
```

4. `_matrix_payload` carries the three declarations:

```python
def _matrix_payload(mode: str, strictness: str, *, streaming: bool, model_id: str) -> dict:
    definitions = []
    for name in MATRIX_TOOL_NAMES:
        definitions.append(
            {
                "type": "function",
                "function": {
                    "name": name,
                    "description": TOOL_DESCRIPTIONS[name],
                    "parameters": SCHEMAS[strictness],
                },
            }
        )
    payload = {
        "model": model_id,
        "messages": [{"role": "user", "content": MATRIX_PROMPT}],
        "tools": definitions,
        "tool_choice": tool_choice_value(mode),
        **RECORDED_SAMPLING_PARAMS,
        "stream": streaming,
    }
    return payload
```

with a `TOOL_DESCRIPTIONS` dict giving each of the three its own one-line description (the target's: "Search the public web for reference material."; the distractors: their own shapes — a knowledge-corpus search and a document read). The descriptions must be DISTINCT so the model can tell them apart.

5. `run_cell` judges against the target:

```python
    observation = parse_nonstreaming_tool_calls(message, MATRIX_TARGET)
```
(and the streaming path's `reassemble_streaming_tool_calls(..., expected_name)` likewise).

6. The evidence record names the declared tools: add the field `declared_tools: tuple[str, ...] = field(default_factory=tuple)` to `VerificationEvidence` and pass `declared_tools=MATRIX_TOOL_NAMES` in `run_verification`'s constructor call. (Put the field AFTER the fields with defaults, or give it a default — the dataclass's field order is frozen by the existing constructors; read the class and keep it valid.)

- [ ] **Step 4: Run the harness's suite and make sure it passes**

Run: `cd components/agent-service && /tmp/genie-agent-service-venv/bin/python -m pytest tests/test_v06_harness.py -q`

Expected: the whole file green (the new pins + the existing ones). The existing pins that reference `TOOL_NAME` must be updated to `MATRIX_TARGET` — do that in the same step (they assert the SAME behaviour under the new name).

- [ ] **Step 5: The FULL agent-service suite**

Run: `cd components/agent-service && /tmp/genie-agent-service-venv/bin/python -m pytest tests/ -q`

Expected: the count the plan's Task 5 states (the harness pins grew — the count is the Task-5 baseline plus the pins added here).

- [ ] **Step 6: Lint**

```bash
cd components/agent-service
uvx ruff@0.16.3 check --no-cache measurement/ tests/
uvx ruff@0.16.3 format --no-cache --check measurement/ tests/
```

- [ ] **Step 7: Commit**

```bash
git add components/agent-service/measurement/v06_harness.py components/agent-service/tests/test_v06_harness.py
git commit -m "test(measurement): the matrix registers three tool declarations"
```

---

### Task 2: The live re-run against the venue

**Files:**
- Create: `_bmad-output/implementation-artifacts/v06-rerun-2026-11-27/harness-matrix.json` (the machine record)
- Create: `docs/baselines/v06-runtime-verification-2026-11-27-web3.md` (the human record, mirroring the 2026-11-24 doc's shape)

**Interfaces:**
- Consumes: Task 1's harness; the venue env (`VLLM_LLM_ENDPOINT`, `VLLM_API_KEY`, `OPEA_SSL_SKIP_VERIFY=1`, `AGENT_VERIFICATION_VENUE`); the cluster's `vllm-api-key` Secret.
- Produces: the JSON evidence record (the matrix's 12 cells + the 2 demos + the control + the acceptance verdict) and the baseline doc that cites it.

- [ ] **Step 1: The environment and the run**

```bash
cd components/agent-service
export VLLM_LLM_ENDPOINT="https://ai.assembly.govstack.global:444/llm"
export VLLM_API_KEY="$(kubectl -n genieai get secret vllm-api-key -o jsonpath='{.data.VLLM_API_KEY}' | base64 -d)"
export OPEA_SSL_SKIP_VERIFY=1
export AGENT_VERIFICATION_VENUE="GPU node ai.assembly.govstack.global (V03 baseline venue), reached from the forge k3s dev cluster host — three tool declarations registered"
/tmp/genie-agent-service-venv/bin/python -m measurement.v06_harness > /tmp/harness-matrix-3tools.json 2>/tmp/harness-matrix-3tools.stderr.txt
echo "exit=$?"
```

Expected: a JSON record on stdout (the exit code is the ACCEPTANCE verdict: 0 = passed, 1 = not passed — the 2026-11-24 venue's two `auto`+`streaming` cells are known-invalid, so **exit 1 is the EXPECTED outcome there**; a record with a traceback or an empty stdout is a defect to fix, not a verdict).

- [ ] **Step 2: Read the verdict honestly**

```bash
python3 -c "
import json
d=json.load(open('/tmp/harness-matrix-3tools.json'))
print('declared_tools:', d.get('declared_tools'))
print('model:', d['identity'].get('model_id'))
print('cells:', len(d['cells']), 'valid:', sum(1 for c in d['cells'] if c.get('valid')))
print('acceptance:', d.get('acceptance'))
for c in d['cells']:
    if not c.get('valid'):
        print(' INVALID', c['tool_choice_mode'] + '/' + c['schema_strictness'] + '/streaming=' + str(c['streaming']),
              '|', c.get('reasons') or c.get('error'))
```

**The cell record's field names are the REAL ones** (`CellRecord`): the JSON
carries `tool_choice_mode`, `schema_strictness`, `streaming`, `valid`,
`reasons`, `latency_ms`, `finish_reason`, `content_preview`, `tool_calls`,
`delta_count`, `error`. There is **no `label` key in the JSON** — `label` is a
PROPERTY on the dataclass and `asdict()` serialises fields only — so the
reader derives it from the three axis fields, and the issues list is named
`reasons`, not `issues`.
"
```

Expected: 12 cells; the same two `auto`+`streaming` cells invalid as on 2026-11-24 (the venue's serving property, documented in the "before" record); every other cell valid AND the target named in the valid cells' calls.

- [ ] **Step 3: The machine record**

```bash
mkdir -p _bmad-output/implementation-artifacts/v06-rerun-2026-11-27
cp /tmp/harness-matrix-3tools.json _bmad-output/implementation-artifacts/v06-rerun-2026-11-27/harness-matrix.json
```

- [ ] **Step 4: The baseline doc**

Write `docs/baselines/v06-runtime-verification-2026-11-27-web3.md` in the shape of `docs/baselines/v06-runtime-verification-2026-11-24.md` (the "before" record, kept verbatim and referenced): the captured date, the venue, the producer string (`measurement.v06_harness`), the machine record's path, the endpoint identity read from the endpoint itself (vLLM version, model id, context window), the MATRIX VERDICT (how many of the 12 cells valid, which invalid and WHY — the venue's serving property, not a code defect), the comparison with the one-declaration record, the acceptance verdict (NOT passed — the operator signs), and the reproduction block (the exact commands above).

- [ ] **Step 5: Commit**

```bash
git add _bmad-output/implementation-artifacts/v06-rerun-2026-11-27/harness-matrix.json docs/baselines/v06-runtime-verification-2026-11-27-web3.md
git commit -m "docs(measurement): the P3 re-run with three tool declarations"
```

---

## Out of scope

- **The deployed agent-service on the cluster** (the live `web_search` end-to-end proof) — a separate deployment exercise, not a harness change.
- **The `required` mode's semantics with three declarations**: the matrix records what the endpoint does; it does not assert the endpoint picked the target under `required` (the mode's own meaning is "some tool", not "the named one"). The judge is the SAME for every mode (it expects the target), so a `required` cell that calls a distractor is INVALID — that is the recorded fact, not a bug to hide.
- **The `probe`** (`agent.probe`, the as-found window probe) — the 2026-11-24 record's probe findings stand; this plan re-runs the MATRIX only.
- **Any change to the product's tool definitions** (`agent/sources.py`) — the harness's schemas are its own axis.
