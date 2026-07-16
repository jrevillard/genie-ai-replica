# ADR okf-010: OKF parsing lives in the Node component; header-aware chunking is a fast-follow

- **Status**: Proposed
- **Date**: 2026-07-15
- **Decision owners**: Genie.ai Dev (architect)

## Context

OKF concepts need frontmatter → metadata, Markdown-header-aware chunking, and structural link-edge extraction before embedding/storage. The pipeline spans two tiers: the Node OKF Server (okf-001) and the Python dataprep (which chunks/embeds/stores). Where should OKF-specific parsing live?

### Constraints

- Keep OKF logic in `components/okf-server/` (okf-001); dataprep is a reusable OPEA-overlay dependency (minimize its OKF coupling).
- Reuse TEI embedding (no duplicate embedder); reuse dataprep's ArangoGraph storage + retract cascade.

## Decision

**OKF parsing (frontmatter, Markdown structure, link extraction) lives in the Node OKF Server** (`okf-parser/`: `gray-matter` + `markdown-it`). 

- **MVP**: OKF Server extracts frontmatter + link edges and sends each concept's body to dataprep's **existing ingest path** (`graph_name=OKF`) for chunk+embed+store; OKF Server writes the structural `OKF_LINKS_TO` edges + `okf_concepts`/`okf_bundles` metadata. dataprep change: minimal/none (concept bodies flow through the existing path).
- **Fast-follow**: adopt **header-aware chunking** either (a) Node-side pre-split (`langchain/textsplitters` JS) sending pre-chunked text, or (b) a small additive OKF/markdown loader in dataprep `_load_and_chunk` (`MarkdownHeaderTextSplitter`, already a dependency). Choose based on which yields cleaner embeddings with least coupling.

## Alternatives considered

| Alternative | Status |
|---|---|
| All OKF parsing as a dataprep `_load_and_chunk` extension (Python) | Rejected as primary — puts OKF logic in the OPEA overlay (contradicts okf-001); kept as the fast-follow option (b). |
| OKF Server embeds itself (call TEI directly, write ArangoDB) | Rejected — duplicates dataprep's embed+store+retract machinery. |

## Consequences

- **Positive**: OKF logic stays in the Node component; dataprep stays a reusable dependency; MVP needs ~no dataprep change.
- **Negative**: MVP uses dataprep's generic chunking on concept bodies (header-aware chunking deferred); cross-tier handoff per concept.
- **Mitigations**: concepts are usually small/structured (generic chunking acceptable for MVP); fast-follow delivers header-aware chunking; idempotent content-hash keys prevent re-embed churn.

## Related — dataprep extensions (Architecture §15)

OKF tenant/bundle ACL is realized by encoding `t:<tenant>` / `b:<bundle>` as `chunk_labels`, reusing the retriever's **existing** label filter (`_chunk_passes_label_filter`, AND/OR) — **zero retriever code change**. The OKF-specific chunk-doc fields (`concept_id`, `bundle_version`, `source_type:"okf"`) are additive; tenant/bundle ride on `file_labels` → `chunk_labels`. OKF link edges written into `OKF_LINKS_TO` carry `file_id`/`bundle_id` + `label` so the existing `retract_file` cascade cleans them.

## References

- PRD FR-6, FR-7; Architecture §4, §5, §6.1, §15.
