# ADR okf-022: Node↔Python dataprep handoff contract — send pre-parsed concept bodies

- **Status**: Proposed
- **Date**: 2026-08-13
- **Decision owners**: Genie.ai Dev (architect)

## Context

Gap G7 (P1): the contract between the Node OKF Server (parser, orchestrator) and the Python dataprep (chunker/embedder) is undefined. Two failure modes hide here: either the Node-side parser's work (frontmatter → metadata, structural links) is **discarded** and re-derived poorly in Python, or — worse — the frontmatter is chunked as if it were body text (noise chunks, polluted embeddings). The OKF parser already runs Node-side (ADR-okf-010) and emits clean `{frontmatter, body, links}`; dataprep already chunks Markdown (`_load_and_chunk`) and accepts additive metadata (`concept_id`, `bundle_version`, `source_type`). The question is **what crosses the Node→Python boundary**: raw concept `.md` (frontmatter + body), or pre-parsed body with the frontmatter already extracted?

Basis: [okf-course-correction-2026-08-13 §3 D3](../../_bmad-output/planning-artifacts/okf-course-correction-2026-08-13.md).

## Decision

**The OKF Server sends pre-parsed `concept_bodies[]` to dataprep — frontmatter already stripped, metadata already extracted and handed separately.** (D3 = (a).)

1. **Frontmatter is parsed once, Node-side** (ADR-okf-010), by `parser-service.parseConcept()` (Story 2.3, done). The orchestrator (ADR-okf-021) upserts the parsed frontmatter into `okf_concepts_meta` and passes only the **body** to dataprep.

2. **Dataprep receives the stripped body** as the chunkable text, plus the additive metadata (`concept_id`, `repo_id`, `bundle_version`, `source_type`, ACL `file_labels`) it propagates to chunk-doc fields (ADR-okf-013). `_load_and_chunk` is OKF-aware: it does **not** re-parse frontmatter or chunk it.

3. **Structural links are not dataprep's job** (D4 = (a)). The orchestrator writes `_LINKS_TO` edges directly to Arango after indexing (Story 2.9.3), within-repo validated (ADR-okf-028). Dataprep stays focused on chunking + embedding.

4. **`_finalize_chunk_labels` preserves the ACL `file_labels`** (`t:`/`r:`/`d:`) into `chunk_labels` (Story 2.6a, ungated P0 — G4). The labels arrive in the handoff payload; dataprep must not drop them.

## Alternatives considered

| Alternative | Status |
|---|---|
| Send raw `.md`; let docling/dataprep chunk frontmatter (D3-b) | Rejected — discards the Node parser's work, pollutes embeddings with YAML, and forces a second parser to stay in sync with frontmatter v0.2. The Node parser is already the source of truth (ADR-okf-010). |
| Dataprep writes `_LINKS_TO` from a `links[]` it receives (D4-b) | Rejected — splits link-authorship across two services and couples dataprep to the within-repo validation rule (ADR-okf-028); the orchestrator already has the parsed links. |

## Consequences

- **Positive**: parser work is preserved; clean chunks (no YAML noise); a single frontmatter schema (Story 2.3's) governs both produce and consume; dataprep stays a focused chunker/embedder.
- **Negative**: the handoff payload is richer (body + metadata + labels); the contract is now explicit and versioned (a change in the parser output shape is a change in the handoff).
- **Mitigations**: additive-only metadata (NFR-S7); the contract is documented here + in Story 2.9.1; round-trip segmentation tests (Story 8.1/7.2) guard against drift.

## References

PRD §4.2 (FR-6); [okf-course-correction-2026-08-13 §3 D3/D4](../../_bmad-output/planning-artifacts/okf-course-correction-2026-08-13.md); [ADR-okf-010](okf-010-okf-markdown-loader-location.md); [ADR-okf-013](okf-013-graph-name-wiring.md); [ADR-okf-021](okf-021-write-side-orchestration.md); [ADR-okf-028](okf-028-cross-repo-structural-links.md).
