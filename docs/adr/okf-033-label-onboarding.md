# ADR okf-033: Label Onboarding — pre-ingest gap-mode + bounded curation wizard

- **Status**: Proposed
- **Date**: 2026-08-13
- **Decision owners**: Genie.ai Dev (architect)

## Context

The OKF Knowledge Hierarchy (the service-category taxonomy) must grow deliberately as new repositories are ingested — but it must stay **curated and bounded**, never "an unlimited tree of every imaginable word" (user directive 2026-08-13; memory `feedback_bounded-knowledge-hierarchy`). The labeler prompt already forbids free-form suggestion (*"Do NOT suggest new labels. Use ONLY exact strings from the list."*, genieai_dataprep_arangodb.py:138-139), and the `_finalize_chunk_labels` function already computes a `new_labels` array (labels the LLM could not resolve to the taxonomy) but **discards it as a WARN string** (:1100-1102). Hierarchy additions are steward-gated (FR-32). The missing piece: a deliberate, bounded way to surface the *minimal* set of new labels a specific repo needs, for a steward to curate *before* the repo is indexed.

A 2026-08-13 design workflow (4 parallel approaches, 3 judges, synthesis — [label-onboarding-design-2026-08-13](../../_bmad-output/planning-artifacts/label-onboarding-design-2026-08-13.md)) selected a Progressive Wizard design with grafts from the runner-up approaches.

## Decision

**Add a pre-ingest Label Onboarding feature (Epic 9): a dataprep gap-mode that surfaces the minimal label gap for a repo's under-labeled concepts, and an okf-server + Vue wizard through which a steward curates (cluster → review → apply) the new labels before ingest — bounded by construction.** (D-UX = Wizard; D-fire = pre-ingest dry-run.)

1. **Gap-mode labeler (dataprep, additive).** A new `_label_gap_analysis` (sibling of `_label_with_llm`, :467) runs the taxonomy-only pass, then a gap-proposal pass **only on chunks that resolved <2 taxonomy labels** (the under-labeled trigger — a strict subset of the `new_labels` branch :1082-1083), capturing the previously-discarded `new_labels` **with per-chunk provenance**, then **short-circuits before `_process_batch`** (:1156) — no embed/index/SOURCE writes. Exposed via `POST /v1/dataprep/label_gap`.

2. **ONE shared `canonicalize_label()`** extracted from the lexical match at :1074-1080, used by BOTH `_finalize_chunk_labels` and the gap-mode — one code path so the gap measurement cannot drift from ingest-time resolution. Backed by a **contract test** (gap-resolved set == real-ingest resolved set on the same fixture). Plus a **layer-2 embedding-cosine variant merge** (cos ≥ 0.92, reusing `_label_with_embedding.embed_documents` :1111) to collapse true synonyms the lexical fold misses (maize/corn) — run Python-side, **no UMAP/canvas**.

3. **Wizard (okf-server + Vue, Epic 3).** `label-onboarding-service` + proposal API + an immutable `okf_label_proposals` collection (the diff + per-line decisions + actor + timestamp **IS** the audit record). `OkfLabelOnboardingWizard.vue` (Analyze → Cluster → Review → Apply) with smart-default traffic lights, per-candidate provenance cards, ghost-node placement on the live tree, and a live before/after coverage preview. Apply writes via the **existing service-category CRUD** + one-way-sync (ADR-okf-034); the **orchestrator** remains the sole `t:/r:/d:` ACL injector (FR-34/ADR-okf-021) — the wizard never injects ACLs.

4. **Bounded by construction (9 mechanisms).** Gap-only input + under-labeled trigger + lexical canonicalize + embedding variant merge + frequency floor + confidence threshold + learned per-domain denylist + a hard cap that **FAILS not truncates** + the FR-32 steward gate. Failure mode is "too conservative", never "every word".

5. **Producer unification.** Producer hierarchy/label proposals (Story 7.3) feed into the **same** `okf_label_proposals` collection + **same** wizard (`source='producer'` badge) — one steward gate for both pre-ingest gaps and AI-produced drafts.

## Alternatives considered

| Alternative | Status |
|---|---|
| **Curator Diff-Review** (PR-style code-review UI) | Close runner-up (judges 41-42). Grafts kept: immutable proposal-as-audit-record, FAIL-not-truncate cap, the taxonomy-endpoint-correctness invariant. Rejected as primary UX — a monospace diff assumes a technical steward; the live before/after preview serves a non-expert curator better. |
| **Semantic Clustering Canvas** (drag-clusters onto the tree) | Most creative UX but heaviest build (custom D3/Canvas + UMAP-in-Node on a CPU-only container, NFR-S6 risk; a11y burden). Graft kept: the embedding-cosine variant merge (without the canvas). |
| **Conversational Copilot** (chat-style) | Over-engineered for a tool used a few times per ingest; re-implements the labeler in Node (Python↔Node drift); SSE chat has no precedent in the dashboard. Graft kept: provenance cards + "Ask why" popover (amber-only, function-call-grounded). |
| Status quo (WARN on `new_labels`, no curation UI) | Rejected — the WARN is advisory noise; no bounded path to add the right labels; steward has no review surface. |

## Consequences

- **Positive**: a bounded, curator-driven, audit-native path to grow the hierarchy with exactly the labels a repo needs; directly improves Graph Router selection precision (FR-35); unifies producer + pre-ingest label review; the shared `canonicalize_label()` + contract test harden the labeler against drift.
- **Negative**: a new dataprep gap-mode + okf-server service + collection + Vue wizard (~5 stories); a second labeling pass per repo (GPU cost); depends on Story 2.9.1 (`ingest-service.js`) for the dry-run orchestration.
- **Mitigations**: ~70% reuse (service-category CRUD, audit/tracing, ECharts, the existing `new_labels` signal); conservative defaults + the SM-7 rejection-rate launch guardrail (Story 9.5); the contract test pins the drift risk.

## References

[label-onboarding-design-2026-08-13](../../_bmad-output/planning-artifacts/label-onboarding-design-2026-08-13.md); PRD FR-32/FR-34/FR-35/FR-36; [ADR-okf-021](okf-021-write-side-orchestration.md); [ADR-okf-024](okf-024-graph-selection-router.md); [ADR-okf-034](okf-034-knowledge-hierarchy-canonical-store.md); `genieai_dataprep_arangodb.py:130-153,355-396,467,1051-1133`.
