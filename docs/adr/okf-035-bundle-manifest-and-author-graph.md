---
title: Bundle Manifest & Author-Stated Graph — the bundle IS a graph
status: accepted
date: 2026-08-23
deciders: David Forden (steward directive), MiniMax-M3 (analysis + implementation)
---

# ADR-okf-035: Bundle Manifest & Author-Stated Graph

## Context

An OKF bundle is structurally a graph: each concept's frontmatter `links: [...]`
array declares the author's cross-references, and `type: index` marks the root.
Before this ADR the ingest pipeline **discarded** that structure — the only
concept-to-concept edges in the per-repo graph were parser-derived from markdown
link syntax (brittle: misses semantic relations, false-positives on code-block
URLs), and a retriever had no way to discover what a repo contains without
scanning its meta collection.

The five standing goals (2026-08-23, steward): (1) RAG accuracy, (2) response
completeness, (3) efficiency, (4) flexibility, (5) conjoined RAG across multiple
domains — with the **1-graph-per-OKF-repo strategy retained as central** to the
fan-out design.

Options analyzed:
- A: keep parser-only edges (status quo) — misses author structure
- B: persist author `links:` as explicit edges — additive, cheap
- C: bundle manifest doc — discovery index, self-description
- D: shared graph + bundle_id filter — **rejected**: trades away the per-repo
  isolation the fan-out strategy depends on
- E: tiered retrieval (manifest discovery → chunk scan → graph walk)

## Decision

Implement **B + C + E together**; the per-repo graph model is unchanged.

1. **Author-stated edges (B)**: at bundle settle, every concept's frontmatter
   `links:` is mirrored into the per-repo `_LINKS_TO` with `source='author'`
   (parser-derived edges live alongside with `source='parser'`). Both endpoints
   are ensured as ENTITY vertices with the SAME deterministic key scheme
   (`safeKey('c', concept_id)`) — `_LINKS_TO` is not graph-bound so nothing
   else enforces referential integrity. Within-repo boundary (G22) enforced:
   a link to a concept not in the repo is skipped, never materialized.

2. **Bundle manifest (C)**: one `okf_bundle_manifest` doc per repo
   (`_key=repo_id`, overwritten on re-settle): the concept list (id, title,
   type, is_index, index_status, chunk_count, labels), the author links, the
   root_id, summary_stats, cloned_from, version. The `summary_text` is
   **LLM-authored lazily** on the first discovery read (prompt built from the
   deterministic ingest-time metadata; cached on the doc; a steward override
   pins it; an unreachable LLM degrades to null — scoring never depends on it).
   Rejected concepts appear in the manifest as `index_status='rejected'`
   (surfaced, not hidden).

3. **Tiered retrieval fan-out (E)**:
   - **Tier 1 — discovery**: `POST /api/okf/repos/discovery {query, labels?,
     domain?, k?}` scores every settled manifest (label overlap ×3 +
     name/domain token ×1) and returns ranked candidate repos. O(repos).
   - **Tier 2 — chunk retrieval**: per candidate repo, the existing hybrid
     label/vector scan (the `chunk_labels` discriminator; ACL preserved).
   - **Tier 3 — relational context**: per-repo graph walk over `_LINKS_TO`
     (author + parser edges; `source` discriminates) for multi-hop queries,
     seeded from the `is_index` root.

## Consequences

- The graph now IS the bundle's structure; tier-3 walks have dense, explicit
  edges instead of sparse parser guesses (goals 1, 2).
- Multi-domain fan-out starts from an O(repos) manifest read instead of an
  O(repos × concepts) meta scan (goals 3, 5).
- Repos are self-describing — any client (UI, CLI, future retriever) can
  discover and walk a bundle from its manifest alone (goal 4).
- Per-repo isolation unchanged; additive only — no existing path was modified.
- Ingestion logs gain `Manifest` and `AuthorLinks` stages (mirrored to the
  bundle's ingestion_log — the UI's Ingestion Log tab reflects the process).
- Follow-up: `mintVersion` should refresh the manifest so `version`/`okf_tag`
  are current post-mint (settle writes them pre-mint).

## Compliance

- 1-graph-per-repo retained (fan-out strategy central — steward directive)
- NFR-S7 (additive chunk-schema only) — no schema changed; new collection only
- G22 (within-repo edges) enforced in the author-link writer
- Labels: candidate-pool semantics (per-chunk applicability; ADR for the
  labeling revision is okf-036)

## References

- Directive chain + live audit evidence: Story 4.8 Dev Agent Record
  (B+C+E section), `_bmad-output/implementation-artifacts/4-8-repository-clone-curated-forks.md`
- Implementation: `edge-service.writeRepoAuthorLinks`,
  `concept-meta-service.{writeManifest,readManifest,ensureSummary,discoverRepos}`,
  `internal-controller.settleBundleIfComplete`, `repos-routes.js`
  (`GET /:repo_id/manifest`, `POST /discovery`)
- Commits: 504b1af (B+C+E), fe8b9c9 (vertex integrity), c0e4267 (assert fixes)

## Revision (2026-09-10) — spine completion for the option-(d) retriever ([ADR-okf-039](okf-039-retrieval-mode-governance.md))

Live verification of the first serving graph (Alphabet, 2026-09-10) confirmed
the author-spine mirror works (52 `source='author'` edges over 17 concept-root
vertices) and surfaced three additive completion items the tiered fan-out
depends on:

1. **Curator label on author edges.** `writeRepoAuthorLinks` writes
   `weight` + `source` but drops the link's `label` (anchor text / link kind) —
   the live edges carry `label: null`. Both edge writers (settle mirror AND the
   drain-time rewrite) must propagate `label` (and `kind` when the link
   declares one) so tier-1 spine walks explain *why* concepts link.
2. **Concept-root enrichment.** Roots are minimal docs (`_key`, `concept_id`);
   upserts now also write `title` + `labels` (KH, from concept meta) so spine
   candidates are self-describing for provenance surfacing and label
   federation ([ADR-okf-039](okf-039-retrieval-mode-governance.md) D6).
3. **`concept_id` index on the serving `_SOURCE`.** The chunk→spine join is
   attribute-based by design (ADR-okf-039 D4 rejects per-chunk edges); ensure a
   persistent index on `concept_id` at drain so the join is O(log n), not a
   scan. (Index-only — the collection itself stays dataprep-owned.)

All three are additive (NFR-S7) and idempotent; existing graphs self-heal on
their next settle/re-ingest.
