---
title: 'Story 4.1 — Evaluation harness (one runway)'
type: 'feature'
created: '2026-11-22'
status: 'in-progress'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '95dcd8d9aa200c03af98fcb412505e8289c1db7a'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-genie-ai-2026-11-16/ARCHITECTURE-SPINE.md'
---

<frozen-after-approval reason="human-owned intent — the issue #1977 acceptance criteria, operator-authored">

## Intent

**Problem:** Epic 4's experiments (E01 A/B, E02 B/C) have no shared machinery: configs A (legacy fixed RAG), B (story 1.9's service-side no-agent mode) and C (the agent) have no common invocation path, no run-level version record, no fixed evaluation-set composition, and nothing enforces the protocol's partial order (A-only reference measurement before thresholds are signed before the first gated B/C run). The existing `tests/rag-benchmarks` capture machinery can drive config A but nothing guards against blindly reusing a stale baseline artifact as if it were current evidence.

**Approach:** Build the versioned evaluation harness in the ratified home (`tests/rag-benchmarks/protocol/`, per AD-10/FG-5): an evaluation-set module with a fixed, validated composition and tuning/assessment separation; a run-manifest builder that versions corpus, cases, configurations, models, prompts and evaluator instructions for every run; three config drivers (A reusing the anchor eval machinery, B invoking the story 1.9 no-agent pipeline as its caller, C driving the `/v1/runs` agent seam); the A-only-first partial-order gate; and suitability/version checks that refuse stale reuse of capture artifacts. The harness delivers the machinery and enforces the order — the live reference measurement itself is an evaluation-campaign activity on a deployed venue (stories 4.3/4.4 consume its artifacts).

## Boundaries & Constraints

**Always:**
- Every run produces a version manifest recording: corpus identity (source collection + content-hash fingerprint), cases (set file digests), configurations (resolved-env snapshot per config), models (resolved model ids read from the serving endpoints), prompts (digests of the resolved prompt surfaces per config) and evaluator instructions (the versioned instructions file digest). No credentials in any record.
- The assessment set's composition is validated, never assumed: answerable, unanswerable, citation-check, representative-language (including at least one non-Latin language), restricted/public access, failure and cancellation classes must each be present and countable; a set missing a class fails validation naming the class.
- Tuning cases live in their own namespace (`sets/tuning/`); the assessment set (`sets/assessment/`) refuses any tuning-sourced case (by set provenance, not by naming convention alone) — the separation is FR-24 and is enforced, not documented.
- Config B is invoked, never re-implemented: the driver imports `noagent.pipeline` inside the agent-service environment (the same container the serving image ships) and consumes `NoAgentResult`; zero noagent behavior is duplicated in the harness.
- Config C is driven through the governed seam (`POST /v1/runs` SSE) with its admission, budgets and cancellation semantics untouched; a cancellation case closes the stream mid-run and records the honest terminal state.
- Per-pair conditions are recorded artifacts: the E01 pair (A/B) holds corpus, evaluation set, execution conditions and model services fixed with the retrieval backend as the recorded intentional difference; the E02 pair (B/C) shares retrieval backend, preparation and admission policy with orchestration as the recorded intentional difference. The pair manifest ships with the harness and rides every gated run's manifest.
- Partial order enforced by the gate, not by convention: A-only reference runs are always allowed; a gated B/C assessment run requires (1) a reference measurement artifact for the SAME corpus + set versions and (2) a signed thresholds file referencing it (story 4.4 signs; the harness verifies and refuses otherwise, naming the missing predecessor).
- Reuse of the existing capture machinery is checked, never blind: before any baseline/capture artifact is consumed, its `harness_sha`, `gold_sha256` and stack identity are verified against the current code and set — a mismatch refuses the reuse with the suitability report; there is no override flag.
- The harness runs on the evaluation venue with the eval toolchain's constraints (stdlib-only Python for the driver process; docker-exec transport like the existing eval machinery; no new runtime dependency).

**Never:**
- No change to config A's path (no chatqna, OPEA overlay, BFF or frontend code touched), no change to the noagent pipeline, the agent loop, budgets or admission (the harness is a caller on all three), no contract or seam change.
- No new persistence layer (AD-12): run artifacts are files under the protocol's output directory, versioned by content; nothing writes to application stores.
- No live-venue dependency in the test suite: every harness behavior is pytest-covered through fake seams (fake docker-exec, fake HTTP transport, fake in-container driver), CI-runnable like the rest of the eval tree.
- No thresholds invented in code: the gate verifies a signed artifact's presence, integrity and lineage — the numbers are story 4.4's decision, never a harness default.
- No widening into running the live E01/E02 campaigns, authoring a deployment's corpus-specific case content in this MR, or scoring changes to the existing anchor metrics.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| A-only reference run | config A driver, valid assessment set | versioned run report + manifest (reference kind); gate records the lineage | fail-fast on missed traces (existing anchor behavior, reused) |
| Gated run, no reference | B or C requested, no reference artifact for this corpus+set | refused before any query runs; names the missing reference | typed refusal, exit nonzero |
| Gated run, unsigned thresholds | reference exists, thresholds file absent/unreferenced | refused; names the missing signed thresholds | typed refusal |
| Gated run, complete lineage | reference + signed thresholds match corpus+set versions | run proceeds; manifest chains reference + thresholds digests | N/A |
| Assessment set missing a class | set file lacking, e.g. non-Latin cases | validation fails naming the missing class and its required minimum | typed validation error |
| Tuning case in assessment set | assessment set references a tuning-provenance case | validation fails naming the offending case id | typed validation error |
| Stale artifact reuse | baseline artifact whose `harness_sha`/`gold_sha256` differ from current | reuse refused with the suitability report (which digests mismatched) | typed refusal, no override |
| Config B invocation | driver executed inside agent-service environment | imports `noagent.pipeline`, runs the set, emits per-case JSON rows (answer, abstained, reason, source docs, metadata, wall time) | typed per-case failure rows; run continues |
| Config C cancellation case | SSE stream closed mid-run | outcome recorded as cancelled (honest terminal state), no fabricated answer | recorded, not retried silently |
| Config C failure case | service 503/429 (unconfigured/refused) | outcome recorded with the typed error the seam returned | recorded |
| Run interrupted mid-set | process dies after N cases | completed rows already on disk atomically; resume re-runs only unfinished case ids | atomic JSON writes (existing harness.py IO) |

</frozen-after-approval>

## Code Map

**Reuse (do not reinvent):**
- `tests/rag-benchmarks/eval/run_eval.py` — the config-A driver: `drive_query` (chatqna HTTP via docker-exec), `score_anchor`/`metrics.py` (recall/precision/ndcg), `_load_done`/`_write_out_post` (resume + atomic writes), token refresh. Invoked as subprocess (the `capture_baseline._run_anchor_eval` pattern), never forked.
- `tests/rag-benchmarks/capture_baseline.py` — `harness_sha()`, `gold_sha256` handling, `snapshot_resolved_env`, `snapshot_stack`, `compute_triples`/`metric_triples`, `build_artifact` — the capture/version machinery the AC mandates reusing with checks.
- `tests/rag-benchmarks/eval/harness.py` — `docker_exec`, `read_json`/`write_json` (atomic), `HarnessError`.
- `tests/rag-benchmarks/eval/keycloak.py`, `arango.py`, `chunk_identity.py` — token fetch, cursor, content-hash identity.
- `components/agent-service/noagent/pipeline.py` — `NoAgentPipeline.run(history, context, ...)` → `NoAgentResult(answer, abstained, abstention_reason, source_documents, metadata)`; `NoAgentPipeline.create(config)` assembly. The B driver imports this, nothing else.
- `components/agent-service/app.py:254` — `POST /v1/runs` (the C seam: SSE stream, 429 `admission_refused`, 503 typed configuration errors).
- `components/agent-service/agent/v06_harness.py` — the deployed-endpoint SSE-driving precedent (httpx SSE read, endpoint identity recorded from the endpoint itself).
- `tests/rag-benchmarks/eval/gold_dataset.example.json` — the gold schema the set schema extends (`id`, `query`, `categoryLabels`, `serviceLabels`, `language`, `reference_answer`, `expected_chunks`).
- `.gitlab-ci.yml:4467` (`test:rag-benchmarks`) — the CI job to extend with the protocol tests.

**Read before writing (pair conditions facts):**
- `ARCHITECTURE-SPINE.md` AD-10 (B/C share retrieval backend + preparation + admission; A/B retrieval backend is THE intentional difference), AD-12 (no new persistence), AD-13 (injection scenarios are story 4.2's set additions).
- Story 1.9 spec (noagent scope, lane semantics), story 4.4 AC (thresholds signing — the gate's consumer contract).

## Tasks & Acceptance

**Execution:**
- [x] `tests/rag-benchmarks/protocol/__init__.py` — package marker; stdlib-only.
- [x] `tests/rag-benchmarks/protocol/evalset.py` — the set schema (extends gold schema with `case_class`, `access_scenario`, `expectations`), the composition validator (per-class minimums incl. non-Latin), the tuning/assessment separation check (provenance-based).
- [x] `tests/rag-benchmarks/protocol/manifest.py` — the run manifest builder: corpus fingerprint, set digests, per-config resolved snapshot, resolved model ids, prompt digests, evaluator-instructions digest, kind (`reference` | `gated`) + lineage.
- [x] `tests/rag-benchmarks/protocol/pairs.py` — the E01/E02 pair-conditions manifest (held-fixed + intentional differences, verifiable against the run manifests it stamps).
- [x] `tests/rag-benchmarks/protocol/gate.py` — the partial-order gate: reference lineage check + signed-thresholds verification (digest + lineage match), typed refusals naming the missing predecessor.
- [x] `tests/rag-benchmarks/protocol/reuse.py` — suitability/version checks over capture artifacts (`harness_sha`, `gold_sha256`, stack identity) with the refusal report; no override.
- [x] `tests/rag-benchmarks/protocol/drivers.py` — A (run_eval anchor subprocess), B (in-container noagent invocation via docker-exec transport), C (`/v1/runs` SSE client with cancellation + failure case handling); per-case rows, atomic writes, resume.
- [x] `tests/rag-benchmarks/protocol/config_b_driver.py` — the script executed INSIDE the agent-service environment: imports `noagent.pipeline`, reads a case file, emits per-case JSON rows.
- [x] `tests/rag-benchmarks/protocol/evaluator-instructions.md` — the versioned evaluator instructions (what the judged dimensions check, abstention/citation verdict rules); digested by every run manifest.
- [x] `tests/rag-benchmarks/protocol/sets/assessment.sample.json` + `sets/tuning.sample.json` — composition-complete sample sets proving the validator (CI fixtures, not deployment case content).
- [x] `tests/rag-benchmarks/protocol/run_protocol.py` — the CLI: `validate-set`, `reference` (A-only), `assess` (gated B/C), `check-reuse`.
- [x] `tests/rag-benchmarks/test_protocol_*.py` — the acceptance evidence: every matrix row covered through fake seams (fake docker-exec, fake SSE transport, fake in-container driver, temp output dirs).
- [x] `.gitlab-ci.yml` — `test:rag-benchmarks` runs the protocol test suite.
- [ ] `_bmad-output/implementation-artifacts/sprint-status.yaml` — the story entry to `review` (at completion).

**Acceptance Criteria:**
- Given the harness, when any run executes (reference or gated), then its report carries the version manifest — corpus fingerprint, set digests, resolved configuration snapshot, model ids read from the endpoints, prompt digests and evaluator-instructions digest — with no credentials anywhere in the record.
- Given the set validator, when an assessment set lacks a required composition class or contains a tuning-provenance case, then validation fails naming the offense; a complete set passes and the sample sets demonstrate every class.
- Given the three configs, when the harness invokes them, then A reuses the anchor machinery via subprocess, B runs the story 1.9 pipeline as its caller (no reimplementation — verified by the driver importing `noagent.pipeline` and consuming `NoAgentResult` unchanged), and C drives the governed `/v1/runs` seam including a cancellation case whose honest terminal state is recorded.
- Given the pair manifest, when a gated run executes, then the E01/E02 held-fixed conditions and recorded intentional differences ride the run manifest and are checkable against it.
- Given the partial order, when a gated B/C run is requested without a matching reference artifact or without signed thresholds referencing it, then the gate refuses before any query runs, naming the missing predecessor; an A-only reference run is never gated.
- Given a capture artifact with mismatched `harness_sha`/`gold_sha256`/stack identity, when reuse is attempted, then the harness refuses with the suitability report and no override exists.
- Given the component tree, when `ruff check`, `pytest tests/rag-benchmarks` (eval + capture + protocol) run in CI, then all are green.

## Implementation Notes

**Delivered (2026-11-22, branch `feat/agentic-foundations/4-1-evaluation-harness-one-runway`).**
The package `tests/rag-benchmarks/protocol/` (stdlib-only driver side): `evalset.py`
(schema + composition validator + provenance separation), `manifest.py` (run-manifest
builder, credential redaction, corpus fingerprint), `pairs.py` (E01/E02 shipped pair
conditions + run-manifest check), `gate.py` (partial-order gate, typed refusals), `reuse.py`
(harness_sha/gold_sha256/stack suitability, no override), `drivers.py` (A/B/C drivers with
fake-able transports, resume, atomic writes), `config_b_driver.py` (the in-container script),
`run_protocol.py` (CLI: validate-set / reference / assess / check-reuse),
`evaluator-instructions.md` (versioned judged-dimension instructions), and the two sample
sets under `sets/` (CI fixtures). Tests: `test_protocol_{evalset,manifest,gate,reuse,drivers}.py`
(72 tests), all through fake docker-exec / SSE / in-container-driver seams — no live venue.
CI: `test:rag-benchmarks` runs the protocol suite (new junit report
`rag-benchmarks-protocol-report.xml`). The sprint-status entry stays in-progress per
dispatch instruction; it flips at review, not now.

**Decisions:**
- Composition minimums are data, not magic: `DEFAULT_COMPOSITION_MINIMUMS`
  (answerable 2, unanswerable 1, citation_check 1, representative_language 2 with ≥1
  non-Latin, failure 1, cancellation 1; access public/restricted ≥1 each), overridable
  upward per set via `_meta.minimums`. Non-Latin derivation: Unicode-block scan of the
  query (explicit `script` override per case supported; block list documented in
  `evalset.py`).
- Tuning separation is symmetric and field-based: every case carries `provenance`; a set
  refuses any case whose provenance differs from the set's namespace — copied files do
  not defeat it.
- The gate scans the run's out-dir for `artifact: run-manifest, kind: reference` files
  matching corpus fingerprint + assessment-set digest; newest matching reference wins
  (a re-measured reference supersedes); thresholds must be `signed: true` and reference
  the selected reference's canonical-JSON digest. Refusal reasons: `missing_reference`,
  `missing_thresholds`, `thresholds_not_signed`, `thresholds_lineage_mismatch`.
- Config A default runner calls `capture_baseline._run_anchor_eval` directly (the reuse
  mandate); fail-fast on missed traces replicated at the wrapper level. Resume rides
  run_eval's own `.done` sidecar on the stable report path.
- Config B transport ships the driver + case payload through base64-in-argv docker-exec
  (no stdin, no docker cp), batches `DEFAULT_B_BATCH=25` cases per exec, and merges rows
  per case id (a recorded failure row counts as finished; resume ships only missing ids).
  The driver assembles the pipeline from the deployment's own knobs (`NoAgentConfig.load`,
  `OrchestratorConfig.load` for the budget — the shared E02 admission/budget policy) and
  consumes `NoAgentResult` fields verbatim.
- Config C answers carry the answer text ONLY on the `answered` terminal — a cancelled
  or dead stream records no answer, not even the partial text received before the cut.
  Outcomes: answered / error / admission_refused (429) / configuration_error (503) /
  invalid_request (422) / http_error / cancelled / stream_error. SSE read is stdlib
  `urllib` (the driver process has no httpx).
- Manifest redaction is a key-name denylist (PASSWORD/SECRET/TOKEN/KEY/BEARER/CREDENTIAL,
  case-insensitive) applied to everything recorded.
- `reuse.py` derives missing gold digests from the artifact's recorded gold path when the
  CLI can hash it; the CLI also accepts explicit `--gold`/`--harness-sha`/`--stack`.

**Surprises:** ruff does not lint `tests/rag-benchmarks/` today (no lint lane covers the
tree) — the spec's fallback stands (`py_compile` in CI, ruff run locally clean with the
agent-service config: check + format, ruff 0.16.3). The pre-existing
`test_fanout_parity.py` flake under full-eval-suite ordering (PYTHONHASHSEED pollution
across tests) is NOT from this story — it passes standalone and in the post-change runs;
left untouched. The `NoAgentPipeline` capability is the `SearchKnowledgeCapability`
(created directly, with the authorized-set check story 1.9 records), not the
`AuthorizedExecutor` — `NoAgentPipeline.create` reads `capability.score_calibrator` and
passes `abstention_sink`, which the executor's protocol call does not carry.

**Known limits (honest):** the live-venue commands (`reference` / `assess` with real
transports) are exercised only through fakes here — the reference measurement itself is
stories 4.3/4.4 campaign work on a deployed venue, as the spec's Boundaries state. The
`--compute-fingerprint` path imports `run_eval` and needs the eval env (GRAPH_SOURCE,
Arango) — venue-side. Prompt digests and model ids are caller-supplied inputs to
`build_manifest` (CLI: `--models-endpoint` discovery; in-container B reads the generation
client's model id); a deployment that wants prompt-surface digests passes the resolved
prompt texts' digests via the configuration snapshot.

**Post-implementation session additions (2026-11-22, main session):** added
`test_config_b_driver_helpers_consume_a_result_verbatim` — the in-container driver's
module-level helpers (row assembly, atomic write, per-case ok/failure rows) are now
exercised against a fake pipeline with the contract's real `CallerContext` (pydantic in
the test env; `noagent` itself unimported), closing the gap between the driver docstring's
"exercised against a fake pipeline" claim and the suite (which only byte-compared the
shipped script). Suite now 104 protocol+capture tests, all green. Ruff (0.16.3,
agent-service config): check + format clean on the protocol tree after an I001 import-order
autofix on the drivers test. Verified live by the main session: 104 passed
(`test_capture_baseline.py` + 5 protocol suites), eval tree 185 passed + 1 skipped + the
pre-existing `test_fanout_parity.py` order-dependent flake (reproduced at the story's
baseline commit before any protocol file existed; NOT touched — recorded, not fixed here).
`_run_anchor_eval(gold, out, seed, env_extra)` signature verified against the reuse call;
`CallerContext` fields verified against `capabilities/contract.py` (user_id /
authorized_graph_names / requested_labels; `authorized_repos` defaults).

Scoped fix review, round 1 (`1fb17e055..681f979fc`, f=0, fresh context, correction diff only) — NOT clean: 3 findings (1 low CI comment, 1 medium-low missing-test, 1 low behavior), every claim re-verified against the tree; behavior-preservation checklist traced per path (answer surface, cancellation point, outcome-None guards, usage_record, `_split_by_bytes` math, reuse double-fire, validation-before-gate ordering, deepcopy pins, scope):

| Finding | Severity | Verdict | Disposition |
|---|---|---|---|
| CI comment claimed `capabilities/__init__` pulls adapters (requests, httpx) and the search capability (numpy, kneed) — FALSE: `__init__` imports only `.contract` + `.executor` → adapters.chunks/docrepo/okf → adapters/http (requests); httpx/numpy/kneed ride only `search_knowledge`, imported solely inside the in-container driver assembly the test never runs | low | confirmed (import graph traced) | **Fixed**: comment names the real closure; pip line trimmed to `pytest openpyxl pydantic requests` |
| Fix 8 (B status-based failure counting in the assess summary) had NO regression test — reverting the expression leaves all 114 tests green | medium-low | confirmed (grep + mutation-check by the reviewer) | **Fixed**: the E01 B wiring test now carries a `status: "failure"` row and asserts `1 non-answered outcome(s)` (diverges under the reverted expression — verified by the round-2 reviewer) |
| The unconditional driver-script ship broke the converged-resume semantic: zero pending now required a container round-trip (old flow did zero execs) | low | confirmed (old `range(0, len(pending), batch)` did nothing on zero pending) | **Fixed**: the ship is `if pending:`-gated; the resume test pins `converged.cmds == []` |

Scoped fix review, round 2 (`681f979fc..24b9e7889`, f=1, fresh context, correction diff only) — **CLEAN**: all three corrections verified (closure traced import-by-import; the pin diverges under the reverted expression; the `if pending:` gate preserves the pending-case ship and zeroes the converged case; scope exact). 114 passed. One minor doc-only finding filed and applied directly (bounded, non-behavioral): the `run_config_b` docstring's "ships ONCE per invocation" contradicted the new converged-resume behavior — reworded "at most once per invocation (zero times on a converged resume)". No further review needed for a doc-only delta.

## Spec Change Log

## Review Triage Log

## Design Notes

**Why the gate refuses rather than warns.** The partial order is the protocol's load-bearing invariant (A-only metrics exist before thresholds are signed before the first gated B/C run): a warning would let a campaign drift into comparing candidates against nothing. The refusal names the missing artifact so the operator knows exactly which stage to run next.

**Why B is driven in-container.** `noagent.pipeline` needs the vLLM/TEI/doc-repo network position and the component's own dependency set; the serving image already ships both. A docker-exec transport (the eval toolchain's established pattern for chatqna) keeps the harness stdlib-only on the driver side and makes B's invocation environment identical to C's serving environment.

**Why provenance-based tuning separation, not directory-only.** A file copied between directories would defeat a path check; each case carries its set provenance and the validator refuses an assessment set whose cases were sourced from a tuning set. The sample sets demonstrate the shape.

## Verification

**Commands:**
- `cd tests/rag-benchmarks/eval && pytest -q` — expected: existing suites green
- `cd tests/rag-benchmarks && pytest test_capture_baseline.py test_protocol_evalset.py test_protocol_manifest.py test_protocol_gate.py test_protocol_reuse.py test_protocol_drivers.py -q` — expected: all green
- `cd tests/rag-benchmarks && python3 -m py_compile protocol/*.py` — expected: clean
- `ruff check tests/rag-benchmarks/protocol/` (if the CI lint lane covers the tree — else `python3 -m py_compile` stands in) — expected: clean

**Manual checks:**
- The A-only reference flow and the gated refusal paths exercised end-to-end with the fake seams (no live venue needed); the sample assessment set validates and the sample tuning set separates.
