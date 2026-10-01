---
id: SPEC-corpus-tuning
companions:
  - corpus-profile.md
  - preset-matrix.md
  - sweep-protocol.md
  - ../../../../tests/rag-benchmarks/CLAUDE.md   # adopted — load-bearing reference for tunable surface
sources: []
---

> Canonical contract. SPEC + companions describe what to build. Adopted companion (`tests/rag-benchmarks/CLAUDE.md`) is the authoritative description of what the tooling tunes against.

# Corpus Tuning — per-instance RAG config tooling (Lite MVP)

## Why

GENIE.AI ships a sovereign RAG framework with ~15 configuration axes (CONTEXT_DECAY_FACTOR, MIN_VALUE_THRESHOLD, RETRIEVER_ARANGO_K, DATAPREP_CHUNK_SIZE_MD, LABELING_STRATEGY, RERANKING_STRATEGY, embedding model, prompt template, contextual retrieval, etc.). Each deployment instance currently picks a config by artisanal A/B with multi-week iteration cycles, while the framework has the diagnostic tooling (`tests/rag-benchmarks/eval/`) to evaluate any config it just needs a runner that proposes configs to evaluate and chooses a winner. Three operators are stuck today: a new sovereign deployment cannot get to a working baseline without senior support; existing instances run with sub-optimal configs because the tuning cost exceeds the gain; and operators have no map of the knob-impact surface so they tune blindly.

Lite MVP = three tools (corpus-shape analyzer, preset matrix, sweep runner) that close the "first-day-of-an-instance" loop in under two hours, using only the existing eval harness as the oracle. A proven Lite unblocks per-instance sovereignty adoption; demand will gate the rest.

- **CAP-1 — Corpus-shape analyzer.**
  - **intent:** Given an instance's ArangoDB corpus + taxonomy, emit a structured profile that summarizes shape, language, taxonomy size, and query-pattern signature so downstream tools can route config recommendations without re-scanning the corpus.
  - **success:** A single CLI invocation reads the corpus (read-only, no mutation) and produces a JSON profile (schema in `corpus-profile.md`) on stdout in under 30 seconds for a corpus of up to 50,000 chunks. Re-runs are byte-identical.

- **CAP-2 — Preset matrix.**
  - **intent:** Given a CAP-1 profile, emit a single recommended `vars.yml` baseline config (one of every tunable axis: CONTEXT_DECAY_FACTOR, MIN_VALUE_THRESHOLD, K, fetch_K, chunk_size, chunk_overlap, RERANKING_STRATEGY, LABELING_STRATEGY, embedding model, prompt template, plus GPU-fitting notes for hardware target).
  - **success:** Two distinct profiles (e.g. small Spanish agri corpus vs large English legal corpus) produce different recommended configs on at least 3 axes. Lookup is closed-form (no eval call), under 1 second.

- **CAP-3 — Sweep runner.**
  - **intent:** Given an instance + corpus + a small set (≤5) of candidate configs derived from CAP-2 + neighborhood, find the winning config and emit a sensitivity report (per-axis effect size).
  - **success:** End-to-end wall budget under 2 hours per instance, broken down as: ≤5 minutes CAP-1, ≤1 minute CAP-2, ≤15 minutes offline replay against the logged `adaptive_breakdown` (reuses `tests/rag-benchmarks/eval/calibrate.py` patterns), ≤100 minutes live A/B on the top 3 candidates (3 × 25-30 minutes for 42-query anchor + RAGAS). Output is one recommended config + sensitivity JSON + traceability to the instrumented spans it was scored against.

## Constraints

- **Offline-first.** Any candidate that can be scored via `calibrate.py` pure-function replay against a previously-captured `adaptive_breakdown` MUST be scored offline first. Live A/B is reserved for the top 3 candidates only — no blind redeploy per candidate.
- **Sovereign / air-gapped.** Zero external API keys required. No SaaS calls at any point in the pipeline. Must run on the `.102` style deployment (no internet, no OpenAI/Anthropic/HuggingFace endpoints other than the local vLLM/TEI already deployed).
- **Reuses existing harness.** Operates exclusively against the `chatqna.reranker_selection` + `reranker.tei_invoke` OTel spans already emitted by chatqna. No new instrumentation in the data plane.
- **Read-only on the corpus.** CAP-1 must not mutate ArangoDB or trigger re-ingest. Re-running CAP-1 on the same corpus must yield byte-identical output (deterministic AQL, stable ordering).

## Non-goals

- **Drift detector.** Needs at least one month of prod telemetry per instance before its signal outweighs noise. Deferred until CAP-3 produces at least one real winner.
- **Proxy-gold query generator.** Auto-generating gold queries from the corpus requires LLM access; sovereign deployments cannot depend on this. Manual gold authoring remains the path for v1.
- **Cross-instance learning / fleet intelligence.** Requires ≥5 instances with diverse profiles. Insufficient evidence today.
- **Sensitivity atlas, hardware-fitting advisor, full config recommender, multi-reranker A/B.** Each is its own epic; deferred.
- **Replacing operator judgment.** This tooling proposes; humans decide to deploy. No auto-deploy of sweep winners.
- **Working without a deployed instance.** All three capabilities assume a running GENIE.AI stack with chatqna + VictoriaTraces enabled. Pre-deployment scaffolding is out of scope.

## Success signal

After one quarter with two sovereign deployments onboarded through the Lite tool, both achieve ≥5% RAGAS faithfulness lift over their pre-tooling baseline AND reach a stable config within 2 hours of first run. If either criterion misses, the Lite tool is not adopted and the framework keeps the current artisanal A/B path — the Lite tooling either earns its place by delivering this lift, or it does not.

## Assumptions

- The profile dimensions in CAP-1 (n_docs, language distribution, taxonomy size, hardware target, etc.) are sufficient discrimination for CAP-2 to produce meaningfully different recommendations. Validated empirically; extend if CAP-2 outputs converge to identical configs across distinct profiles.
- Sweep top-3 A/B granularity is sufficient. If top-3 differences fall within SE noise for the n=42 gold, accept that — not chasing finer granularity in v1.
- An instance with 100+ documents and a populated taxonomy (≥3 categories) is the v1 target. Smaller / partially-set-up instances fall back to manual A/B.

## Open Questions

- Profile granularity: per-instance vs per-corpus-version. A re-ingest invalidates a profile — what is the cache invalidation policy?
- After 2-3 CAP-3 winners land, can the preset matrix be derived empirically from CAP-3 data instead of being hand-authored? Probably yes, but no v1 commitment.
- Does CAP-2 need a hardware-fitting tier separate from the corpus-shape tier, or do they merge cleanly? Initial design has them merged; revisit if a real instance trips on hardware.