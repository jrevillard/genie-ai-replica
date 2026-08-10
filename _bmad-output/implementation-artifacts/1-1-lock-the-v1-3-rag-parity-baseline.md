# Story 1.1: Lock the v1.3 RAG-parity baseline

Status: ready-for-dev

<!-- PRD: opea-1.5-upgrade | Epic 1: Upgrade foundation — provable-parity groundwork -->
<!-- Dependency: none. Must run BEFORE any overlay change (pre-rebase milestone (a)). -->
<!-- Sibling stories: 1.2 (CVE/SBOM baseline) is parallel; 3.1 consumes this artifact. -->

## Story

As a platform engineer,
I want the v1.3 retrieval baseline captured as a committed, seeded, multi-run artifact,
so that parity after the OPEA 1.5 bump is provable, not asserted.

## Acceptance Criteria

1. **Pinned baseline inputs.** A gold dataset (pinned corpus/queries/categoryLabels/serviceLabels, content-hash-keyed) and pinned model IDs (embedding, reranker, chat/vLLM, translation) are committed, and the eval runs through the existing `tests/rag-benchmarks` harness on the v1.3 stack.
2. **Seeded, deterministic runs.** All runs use `temperature=0` and a fixed seed; retrieval-side ordering is deterministic. Anchor metrics (no LLM) are exactly reproducible; the semantic (LLM-judged) path is seeded for max determinism.
3. **Run-triple artifact.** N runs (≥3) produce a per-metric `min / median / max` triple, committed as `_bmad-output/implementation-artifacts/rag-baseline-v1.3.json`.
4. **Variance-derived tolerance.** The parity tolerance is computed from the baseline's own run-to-run variance (not a guess), and recorded in the artifact. `one-run-vs-one-run` comparison is explicitly rejected as the parity method.
5. **Config-parity snapshot.** The artifact records the exact env/docker-compose defaults under test (resolved values, not placeholders), including `RERANKER_TOP_N`'s three homes pinned to one verified value (code, compose, env template — OQ-6/FR-18 coupling).
6. **Regression set defined.** The artifact pins the label-filter correctness, RAG-confidence, and abstention cases that Story 3.1 will re-run post-bump (architecture pattern 6).

## Tasks / Subtasks

- [ ] T1: Commit a real gold dataset as `tests/rag-benchmarks/eval/gold_dataset.json` (AC: 1)
  - [ ] Build from the production corpus via `dump_chunks.py` (content hashes), not hand-typed `_key`s
  - [ ] Verify each entry's `categoryLabels` is a LIST; include label-filter and abstention probes (AC: 6)
  - [ ] Record the corpus snapshot (file set + ingest commit) the gold set corresponds to
- [ ] T2: Add the multi-run baseline capture driver `tests/rag-benchmarks/capture_baseline.py` (AC: 3, 4)
  - [ ] Reuse `run_eval.py anchor` (deterministic) + `run_ragas_eval.py` (semantic) — do NOT fork the harness
  - [ ] Accept `--runs N --seed S --gold PATH --out PATH`; run N times; emit per-metric min/median/max
  - [ ] Compute tolerance from variance (e.g. median ± k·MAD or a confidence interval) and record the formula
  - [ ] Snapshot resolved env config (model IDs, RAG params, `RERANKER_TOP_N`, `RERANKING_STRATEGY`, graph name) into the artifact (AC: 5)
- [ ] T3: Capture + commit the v1.3 baseline on a v1.3 stack (AC: 3, 5)
  - [ ] Run against the deployed v1.3 stack (release/el-salvador or a dedicated v1.3 env) with `ENABLE_OBSERVABILITY=1` (trace harvest requires VictoriaTraces)
  - [ ] Record stack identity + image digests + date in the artifact
  - [ ] Commit `rag-baseline-v1.3.json` + gold set + config snapshot
- [ ] T4: Prove the harness's own tests still pass and the capture is idempotent (AC: 2)

## Dev Notes

### Non-negotiable constraints

- **Run on the v1.3 stack, BEFORE any overlay change.** This is pre-rebase milestone (a). Capturing after the bump defeats the purpose (PRD FR-11, architecture §6.1).
- **Reuse the existing harness — do not reinvent.** `tests/rag-benchmarks/eval/run_eval.py` (anchor + dump-tuples), `metrics.py`, `chunk_identity.py`, `calibrate.py`, `arango.py` already exist. Extend if needed; never fork.
- **Identity is content-based.** Gold `chunk_key` = `content_hash` (sha256 of normalized text) from `chunk_identity.py`, NOT ArangoDB `_key` (UUIDs churn on re-ingest). A chunking-param change correctly invalidates the gold set → signal, not bug.
- **`categoryLabels` is a LIST** (`["Tomato","Cucumber"]`). The legacy `categoryLabel` (string) shape silently deadens the label filter.
- **Deterministic vs semantic path:** anchor metrics are LLM-free (exactly reproducible). Semantic faithfulness uses an external LLM judge (`run_ragas_eval.py`) — non-deterministic; seed it and keep it out of the tolerance computation if it cannot be made stable, but record its variance separately.
- **`RERANKER_TOP_N` has three homes** (code, docker-compose, env template) that currently disagree (docs 3, code 2/1). Resolve to one verified value for the baseline; this doubles as FR-18/OQ-6 cleanup — record which value was used and note the drift.
- **Observability must be ON** (`ENABLE_OBSERVABILITY=1`). The eval harvests `chatqna.reranker_selection` spans from VictoriaTraces; without spans, every query reports "trace missed" and nothing scores.

### Environment / deployment facts (substitute for your stack)

- Run on the swarm node; resolve the chatqna container live: `docker ps --format '{{.Names}}' | grep chatqna-xeon-backend-server | head -1` (dynamic Swarm replica suffix — never hardcode).
- `CHATQNA_SERVICE_NAME=genieai-chatqna` (constant across stacks). `VICTORIATRACES_SVC=<stack>_victoriatraces` (hyphenated; wrong separator → DNS fails silently → empty trace → no span).
- Trace indexing lag can exceed 60s on a busy node; `TRACE_FETCH_TIMEOUT` default 120s, raise if needed. Poll with a wide window.
- TEI `/rerank` returns a JSON OBJECT on error (429/5xx), not a list — the reranker already guards this; don't regress it.
- Model pins to record: `EMBEDDING_MODEL_ID`, `RERANKER_MODEL_ID`, `VLLM_LLM_MODEL_ID`, translation model, `EMBEDDING_DIM`.

### Files to create / touch

| File | Action |
|------|--------|
| `tests/rag-benchmarks/eval/gold_dataset.json` | NEW — committed real gold set (content-hash-keyed) |
| `tests/rag-benchmarks/capture_baseline.py` | NEW — multi-run driver, run-triple + tolerance + config snapshot |
| `_bmad-output/implementation-artifacts/rag-baseline-v1.3.json` | NEW — the committed baseline artifact |
| `tests/rag-benchmarks/eval/*.py` | READ/EXTEND ONLY — reuse; extend `run_eval.py` only if seed/temp control is missing |
| `_bmad-output/implementation-artifacts/` | ADD — config-parity snapshot file if not embedded in the artifact |

### Testing standards

- Existing harness tests stay green: `tests/rag-benchmarks/eval/test_metrics.py`, `test_chunk_identity.py`.
- The capture driver is idempotent: two runs with the same seed produce the same anchor result (assert in a unit test).
- Tolerance formula is unit-tested against a synthetic multi-run sample.

### Project Structure Notes

- Baseline/parity/red-run artifacts live in `_bmad-output/implementation-artifacts/` (architecture verification boundary §4); keep the harness in `tests/rag-benchmarks/`. Do not put committed artifacts under `tests/rag-benchmarks/` output dirs (some are gitignored).
- The v1.3 baseline is versioned + retained as the reference for the next upgrade's parity (architecture §6).

### References

- PRD FR-11 (§FR-11, consequence: vector-space compat with the live corpus is load-bearing) — `_bmad-output/planning-artifacts/prds/prd-genie-ai-2026-08-07/prd.md`
- Architecture pattern 6 (verification-artifact: run-triple, temperature=0, seed, deterministic ordering, tolerance from variance, config recorded) + pattern 10 (config-parity: `RERANKER_TOP_N` three-home pinning) + pattern 12 (evidence-ledger) — `_bmad-output/planning-artifacts/architecture.md`
- Harness methodology + pitfalls — `tests/rag-benchmarks/CLAUDE.md`
- Gold dataset schema — `tests/rag-benchmarks/eval/gold_dataset.example.json`

## Dev Agent Record

### Agent Model Used

deepseek-v4-flash[1m] (Claude Code, bmad-create-story)

### Debug Log References

- Initial harness reads: `tests/rag-benchmarks/benchmark_config.py`, `tests/rag-benchmarks/eval/run_eval.py` (mode anchor / dump-tuples), `gold_dataset.example.json`

### Completion Notes List

- Story created from epics.md Story 1.1 + PRD FR-11 + architecture patterns 6/10/12. No previous story exists (first story in Epic 1) — no prior-story intelligence to inherit.
- The baseline is RAG-parity only; the CVE/SBOM baseline is Story 1.2 (parallel).

### File List

- `_bmad-output/implementation-artifacts/1-1-lock-the-v1-3-rag-parity-baseline.md` (this file)
