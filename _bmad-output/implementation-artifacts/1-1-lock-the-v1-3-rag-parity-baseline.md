---
baseline_commit: 611569b13d342bc77474a3dd6217cfece87c2a58
---

# Story 1.1: Lock the v1.3 RAG-parity baseline

Status: done

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

- [x] T1: Commit a real gold dataset as `tests/rag-benchmarks/eval/gold_dataset.json` (AC: 1)
  - [x] Build from the production corpus via `dump_chunks.py` (content hashes), not hand-typed `_key`s
  - [x] Verify each entry's `categoryLabels` is a LIST; include label-filter and abstention probes (AC: 6)
  - [x] Record the corpus snapshot (file set + ingest commit) the gold set corresponds to
- [x] T2: Add the multi-run baseline capture driver `tests/rag-benchmarks/capture_baseline.py` (AC: 3, 4)
  - [x] Reuse `run_eval.py anchor` (deterministic) + `run_ragas_eval.py` (semantic) — do NOT fork the harness
  - [x] Accept `--runs N --seed S --gold PATH --out PATH`; run N times; emit per-metric min/median/max
  - [x] Compute tolerance from variance (e.g. median ± k·MAD or a confidence interval) and record the formula
  - [x] Snapshot resolved env config (model IDs, RAG params, `RERANKER_TOP_N`, `RERANKING_STRATEGY`, graph name) into the artifact (AC: 5)
- [x] T3: Capture + commit the v1.3 baseline on a v1.3 stack (AC: 3, 5)
  - [x] Run against the deployed v1.3 stack (release/el-salvador or a dedicated v1.3 env) with `ENABLE_OBSERVABILITY=1` (trace harvest requires VictoriaTraces)
  - [x] Record stack identity + image digests + date in the artifact
  - [x] Commit `rag-baseline-v1.3.json` + gold set + config snapshot
- [x] T4: Prove the harness's own tests still pass and the capture is idempotent (AC: 2)

### Review Findings

- [x] [Review][Patch] **Map gold matching from ArangoDB `_key` to `content_hash` at eval time (AC:1 + content-based identity)** [tests/rag-benchmarks/eval/run_eval.py] — resolved (decision): keep the `_key`-emitting span but match gold on `content_hash` via a `_key`→`content_hash` map built from the SOURCE collection; gold already carries both fields; no overlay change; then re-capture the baseline.
- [x] [Review][Defer] **No RAG-confidence regression probe (AC:6)** — deferred, pre-existing: RAG confidence is uncalibrated (mean of reranker scores, project research), so pinning a confidence probe now would encode an uncalibrated signal. Deferred explicitly to Story 3.1, which consumes the calibrated-confidence work.
- [x] [Review][Patch] **`mad()` computes raw MAD but docstring/formula/artifact claim 1.4826-scaled** [tests/rag-benchmarks/capture_baseline.py:124-128] — re-captured tolerance ~1.48× narrower than the recorded formula implies.
- [x] [Review][Patch] **`PYTHONHASHSEED` via `setdefault` lets ambient env override `--seed`; artifact records the wrong seed** [tests/rag-benchmarks/capture_baseline.py:426,470]
- [x] [Review][Patch] **Semantic judge `temperature:0` is `setdefault`-ed but hardcoded in the artifact — judge may run at ambient temperature** [tests/rag-benchmarks/capture_baseline.py:471,504]
- [x] [Review][Patch] **`metric_triples` derives the metric set from run 1's aggregate — a degenerate run-1 drops metrics and 0.0-poisoned MAD collapses to a false "fully deterministic" lock** [tests/rag-benchmarks/capture_baseline.py:154-178]
- [x] [Review][Patch] **`git_identity` raises `FileNotFoundError` on a git-less node (no try/except in `_run`); also ignores `repo_root` as cwd** [tests/rag-benchmarks/capture_baseline.py:190-192,519-530] — contradicts the documented "returns null when git absent" fix.
- [x] [Review][Patch] **`homes_agree` excludes the resolved live value — claims "agree" while the deployed config drifts** [tests/rag-benchmarks/capture_baseline.py:369-387]
- [x] [Review][Patch] **`snapshot_resolved_env` last-writer-wins on multi-service keys (`RERANKER_TOP_N`/`RERANKING_STRATEGY` declared under chatqna+reranker)** [tests/rag-benchmarks/capture_baseline.py:274-310]
- [x] [Review][Patch] **No guard on empty container resolution — a typo'd `--stack-prefix` commits an artifact with an empty stack section** [tests/rag-benchmarks/capture_baseline.py:190,209-231]
- [x] [Review][Patch] **`_image_digest` returns `""` (not `None`) on inspect failure — `image_id:""` recorded in the artifact** [tests/rag-benchmarks/capture_baseline.py:234-248]
- [x] [Review][Patch] **Determinism tests are seed-invariant (`* 0.0` canned reports); "different seed" test asserts equality — suite passes even if seed threading is dropped** [tests/rag-benchmarks/test_capture_baseline.py:210-263]
- [x] [Review][Patch] **Translation model + `EMBEDDING_DIM` not pinned (AC:1/Dev Notes)** — `_meta.model_pins` lacks `VLLM_TRANSLATION_MODEL_ID` and `EMBEDDING_DIM`.
- [x] [Review][Patch] **AC:4 wording — `tolerance_semantics` endorses a "point comparison" instead of explicitly rejecting one-run-vs-one-run as the parity method** [tests/rag-benchmarks/capture_baseline.py:559-572]
- [x] [Review][Patch] **`--runs 1` accepted → fake exact-equality tolerance (AC:3 wants ≥3)** [tests/rag-benchmarks/capture_baseline.py:677-679]
- [x] [Review][Patch] **`runs.gold_dataset` records the transient node path, not the committed repo path** [tests/rag-benchmarks/capture_baseline.py:589-590]
- [x] [Review][Patch] **`harness_sha` globs all `*.py` in the eval dir — stray/uncommitted files change the recorded harness identity** [tests/rag-benchmarks/capture_baseline.py:408-418]
- [x] [Review][Patch] **Missed-traces abort fires only after all N anchor runs complete — up to 3h of wasted runs on a zero baseline** [tests/rag-benchmarks/capture_baseline.py:704-717]
- [x] [Review][Patch] **`capture_semantic` `float(None)` TypeError when a later ragas run omits a metric; `--semantic-runs` negative → empty `per_run`** [tests/rag-benchmarks/capture_baseline.py:500-509]
- [x] [Review][Patch] **No guard against `--out` == `--gold` — the pinned gold dataset is overwritten** [tests/rag-benchmarks/capture_baseline.py:686-691]
- [x] [Review][Patch] **`env_template_value` reads commented-out hints / first-hit `VAR=` — can fabricate or hide drift** [tests/rag-benchmarks/capture_baseline.py:354-367]
- [x] [Review][Patch] **Per-run temp files (`anchor_run_*.json`) written into the committed artifact dir, not gitignored** [tests/rag-benchmarks/capture_baseline.py:442-452]
- [x] [Review][Patch] **Container resolution first-match on `embedding`/`reranker` image markers — TEI-vs-wrapper ambiguity, nondeterministic `docker ps` order** [tests/rag-benchmarks/capture_baseline.py:226-230]
- [x] [Review][Patch] **Private IP `10.0.0.102` embedded in `_meta.baseline_stack`** [tests/rag-benchmarks/eval/gold_dataset.json] — infra detail, not PII; redact if the repo may become public.
- [x] [Review][Defer] **`graph`/`model_pins` hand-authored in gold `_meta`, no cross-check vs the live stack** [tests/rag-benchmarks/capture_baseline.py:726-736] — deferred, by-design + documented risk; revisit when pins go stale.

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
- Runtime: existing harness tests pass (22), new driver tests pass (14); ruff lint clean, ruff format applied

### Implementation Plan

**T2 — `capture_baseline.py` (DONE, code + tests).**
- Reuses the harness via subprocess: `run_eval.py anchor` (deterministic, N runs) + optional `run_ragas_eval.py` (semantic) from the eval dir — no fork.
- CLI: `--runs N --seed S --gold PATH --out PATH` (required), plus `--semantic`, `--stack`, `--compose`, `--tolerance-k` (default 3), `--semantic-runs`.
- Determinism: `PYTHONHASHSEED` set in every harness subprocess env; semantic path forces `EVAL_JUDGE_TEMPERATURE=0`. Temperature recorded as 0 (anchor scoring is LLM-free; semantic judge seeded).
- Per-metric `min/median/max` + MAD + tolerance `median ± k·MAD`, clamped to [0,1]; `parity_bound` recorded per metric (low for recall/precision/complete_recall/retrieval_recall, high for noise) so Story 3.1 applies the right one-sided inequality. Tolerance formula string written into the artifact (AC:4).
- Config snapshot (AC:5): resolved values read from LIVE containers via `docker exec printenv` (chatqna/embedding/reranker/dataprep); `RERANKER_TOP_N` + `RERANKING_STRATEGY` three homes recorded (code / docker-compose / env template) with `homes_agree` flag. Discovered drift: chatqna code default `RERANKING_STRATEGY=adaptive` vs reranker/compose/env `slice` — surfaced, not hidden.
- Stack identity: `docker ps` by image substring (dynamic Swarm replica-safe), image ID per service + capture date + git identity of the harness + `harness_sha` (sha256 of eval scripts, works on rsynced node without git).

**T4 — tests (DONE).** `tests/rag-benchmarks/test_capture_baseline.py` (14 tests): tolerance known-sample, determinism/order-independence, [0,1] clamp, empty-raise; parity-bound direction; homes snapshot against real repo files; compose-default parsing; and **idempotency** — `capture_anchor` with the harness subprocess mocked returns byte-identical per-run aggregates for the same seed, and seed is threaded into every subprocess call. Existing harness tests (`test_metrics.py`, `test_chunk_identity.py`) stay green (22 passed).

**T1 — gold dataset (DONE, built from + validated on the live v1.3 corpus).**
- Ran `dump_chunks.py` against the deployed `release/el-salvador` corpus (ArangoDB `el-salvador`, graph `GRAPH_TEST`, source `GRAPH_TEST_SOURCE`, 142 chunks). Dump date 2026-08-10.
- **Identity reality discovered (deployed ≠ Dev Notes):** the deployed v1.3 `chatqna.reranker_selection` span emits the ArangoDB `_key` (confirmed live), NOT `content_hash`. Gold `chunk_key` therefore = `_key` (from dump_chunks `key` field); each expected chunk ALSO carries `content_hash` (the stable cross-reingest identity) per AC:1. `_key`s are random per ingest and churn on re-ingest — the `_meta.eval_identity_gotcha` records this so Story 3.1 re-dumps if the corpus is re-ingested.
- Gold set: 17 scored entries + 1 documented semantic abstention probe (q18) kept OUT of the anchor scored set (empty expected → vacuous recall/pollution). Queries cover tomato (6), cucumber (3), potato (3), onion (2), multi-category (1), label-filter probes (q16 onion-herbicide, q17 potato-pH), abstention probe (documented). `categoryLabels` always a LIST. Corpus snapshot + model pins in `_meta`.
- **Validated on the live stack:** single anchor run → `recall 0.882, complete_recall 0.882, precision 0.314, noise 0.686, retrieval_recall 1.000, n_missed_traces 0`. Gold chunks always retrieved (rr 1.0); q3 (nitrogen) + q5 (zinc) gold chunks are dropped by the v1.3 reranker top-3 slice — an honest current-behavior data point the baseline pins.
- Existing Jul-3 gold set on the node is STALE (0/41 chunk keys survive the corpus re-ingest) — replaced by the fresh dump.

### Completion Notes List

- Story created from epics.md Story 1.1 + PRD FR-11 + architecture patterns 6/10/12. No previous story exists (first story in Epic 1) — no prior-story intelligence to inherit.
- The baseline is RAG-parity only; the CVE/SBOM baseline is Story 1.2 (parallel).
- **T2 + T4 complete**: `capture_baseline.py` driver + idempotency/tolerance tests, all green, ruff clean.
- **T1 complete**: fresh gold dataset built from the live v1.3 corpus via `dump_chunks.py`, validated on-stack (recall 0.882, rr 1.0, 0 missed traces). Deployed span emits `_key` (not content_hash) — gold uses `_key` for matching + `content_hash` as stable identity.
- **T3 complete**: `capture_baseline.py --runs 3 --seed 42 --stack release-el-salvador` run against the deployed v1.3 stack (release/el-salvador @ 10.0.0.102, ENABLE_OBSERVABILITY=1). Artifact `rag-baseline-v1.3.json` committed. **3 runs perfectly deterministic** (recall 0.882, precision 0.314, complete_recall 0.882, noise 0.686, retrieval_recall 1.000 — identical across all 3 runs; MAD=0 → tolerance = median). Two independent captures produced identical metrics → idempotency proven live. Config snapshot resolved from live containers; `RERANKER_TOP_N` three homes agree on `3`; `RERANKING_STRATEGY` drift surfaced (chatqna code `adaptive` vs resolved `slice`). Stack identity: 5 services, `release-el-salvador` images, captured 2026-08-10T12:44:42Z.

### Driver bugs found & fixed during live capture

- **`printenv` prints bare values** (no `KEY=`), so `snapshot_resolved_env` captured nothing → fixed with `env | grep -E '^(KEYS)='` (added `parse_env_lines` + `env_grep_cmd`).
- **`grep` exits 1 on no-match** → a container holding none of the requested keys was misreported as an exec failure → added `|| true`.

### Code review (superpowers) — findings addressed

A read-only code review of `611569b13..70946dfe6` flagged one Critical + four Important + minors. Addressed:

- **C1 (artifact integrity — MUST FIX):** the committed baseline was not regenerable from the committed driver. Root causes: (a) `harness_sha` was computed over the node's staged 5-file eval dir, not the committed 13-file set → sha mismatch; (b) `config_snapshot.graph` + `model_pins` were hand-injected post-capture, not driver-produced; (c) gold pinned by path, not hash. **Fixed in the driver:** `gold_sha256` added to `runs`; driver now reads gold `_meta` for `graph` + `model_pins`; `harness_sha` verified to match repo↔node staging; artifact re-captured with the improved driver → fully regenerable.
- **I1 (docs contradicted identity):** `run_eval.py` docstring + `CLAUDE.md` claimed "content hashes", but the deployed span emits `_key`. Updated both to the `_key` reality + re-ingest caveat.
- **I2 (`missing` semantics):** `snapshot_resolved_env` conflated container-exec failures with key-absence. Split into `missing` (infrastructure failure) vs `unresolved` (declared key absent from every reachable container).
- **I3 (zero-baseline guard):** driver now ABORTS (exit 2) when `n_missed_traces_total > 0`, unless `--allow-missed-traces` — a silent all-zero baseline (observability off / VT down) can no longer be committed as the reference artifact.
- **I4 (multi-stack hazard):** `resolve_containers` now takes `--stack-prefix` (e.g. `genieai-el-salvador_`) to disambiguate on nodes hosting several stacks.
- **Minors:** `metric_triples` no longer KeyErrors on runs that omit a metric; `git_identity` returns `null` (not falsely `tree_clean`) when git is absent; MAD=0 exact-equality semantics documented in the artifact (`anchor.tolerance_semantics`); misleading test name fixed.
- New/updated unit tests: gold_sha + graph/model_pins presence, tolerance_semantics on/off, missing-vs-unresolved, stack-prefix disambiguation. 22 driver + 22 harness tests green, ruff clean.

### File List

- `_bmad-output/implementation-artifacts/1-1-lock-the-v1-3-rag-parity-baseline.md` (this file)
- `_bmad-output/implementation-artifacts/rag-baseline-v1.3.json` (NEW — committed v1.3 RAG-parity baseline artifact: run-triples, tolerance, config snapshot, stack identity)
- `tests/rag-benchmarks/eval/gold_dataset.json` (NEW — committed gold dataset, 17 scored entries + corpus snapshot + probes)
- `tests/rag-benchmarks/eval/.gitignore` (MODIFIED — un-ignore the committed baseline `gold_dataset.json`)
- `tests/rag-benchmarks/capture_baseline.py` (NEW — multi-run baseline capture driver)
- `tests/rag-benchmarks/test_capture_baseline.py` (NEW — driver unit tests + idempotency)

### Change Log

- 2026-08-10: Story marked in-progress (sprint-status + GitLab #840). T2 (capture_baseline.py) + T4 (idempotency/harness tests) implemented and green. T1/T3 initially deferred — deployment network unreachable.
- 2026-08-10: WG tunnel up → T1 complete (fresh gold dataset from live corpus, validated recall 0.882/rr 1.0). T3 complete (3-run baseline captured on release/el-salvador, deterministic, artifact committed). All 4 tasks done → status to review.
- 2026-08-10: Code review (superpowers) — addressed Critical artifact-integrity (gold_sha256, driver-produced graph/model_pins, harness_sha repro match) + Important docs/semantics/guards + minors. Driver re-captured for a fully regenerable baseline. Committed to MR #281.
- 2026-08-10: BMAD code review (bmad-code-review) — 2 decision-needed resolved (D1: content-hash matching; D2: confidence probe deferred to Story 3.1), 22 patches applied, 2 deferred. Driver hardened: MAD 1.4826 scaling, seed/judge-temp forcing, per-run metric union, git_identity crash-safe+cwd, homes_agree includes resolved, env conflict detection, empty-container guard, fail-fast missed-traces, semantic guards, --runs>=3, --gold-repo-path, harness_sha pinned set, temp-dir per-run reports, container-marker disambiguation. Gold now content-hash-keyed (D1): identity survives re-ingest. Discovery: gold content_hash values were stale (raw-chunk hashes) vs stored text which includes the deterministic contextual-retrieval prefix (ctx gen temp 0) — regenerated all 18 from live stored text. Baseline re-captured on release/el-salvador: metrics identical to prior _key capture (recall 0.882, precision 0.314, complete_recall 0.882, noise 0.686, retrieval_recall 1.000, MAD=0). Artifact regenerable from committed code + gold.
- 2026-08-10: Superpowers code review (requesting-code-review) — 2 Important fixed: (1) `score_anchor` report `gold` kept as raw `_keys` (calibrator + CLAUDE.md schema compat) with hashes only in `*_hashes` — the prior shape zeroed calibrate.py's replay; (2) `_key`→`content_hash` projection now distinguishes `None` (legacy direct matching) from `{}` (empty map → every key unmapped) + `n_unmapped_chunk_keys` reported and the capture driver aborts on any unmapped key (closes the false-zero-baseline gap). Minor fixes: `_extract_selection` docstring, `_repo_relative` docstring, temp-capture-dir cleanup (`shutil.rmtree` in `finally`). New `eval/test_run_eval.py` (3 tests) locks the content-hash projection incl. the empty-map hazard. 49 pytest pass, ruff clean. Artifact `harness_sha` recomputed to match the committed eval code (gold_sha + metrics unchanged).
