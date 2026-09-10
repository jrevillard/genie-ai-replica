# Sprint Change Proposal — B+C+E architecture course correction

**Date:** 2026-08-24 · **Branch:** `feat/okf-server` · **Mode:** Incremental (David approved each edit)
**Change scope classification:** **Minor** (documentation-only; the code is built, reviewed, and live-verified — the artifacts catch up to reality)

---

## 1. Issue Summary

**Problem:** The OKF ingest pipeline discarded the bundle's authored structure. The per-repo graph held only parser-derived markdown-syntax edges (brittle, sparse), a retriever had no O(repos) discovery layer for multi-domain fan-out (the PRD's FR-35 specified a BM25 scan over `okf_concepts_meta` — O(repos × concepts)), the bundle zip's doc-repo doc was born `'Ingested'` with no state machine, and labeling blanket-stamped the whole file-label set on every chunk of ACL-carrying files (precision collapse for label-filtered retrieval).

**Discovery:** David's directive chain, 2026-08-23 — "Is the created graph representative of the bundle's structure?" → options analysis against the 5 standing goals (RAG accuracy, completeness, efficiency, flexibility, multi-domain conjoined RAG; the 1-graph-per-repo strategy retained as central) → "let's just go for it with B+C+E" → manifest metadata "collected while the ingestion is happening and authored by the LLM" → ingestion logs "must reflect the changes".

**Evidence:** implemented + live-verified in one session (`504b1af..ccdd2601`): smoke v10 baseline 70/0 → v15 **FULL PASS 74/0** on a clean DB; 3-layer adversarial code review (50+ findings → 11 patches + 4 decisions + 2 defers, all patches applied in `5523da6`); CI green (#6359–#6369); ADR-okf-035 written; full graph audit of both ingestions (WP-A rejection held, manifest↔graph author-edge exact match, per-chunk label applicability verified).

## 2. Impact Analysis

**Epic impact:**
- **Epic 1 (multi-graph grounding, gated):** Stories 1.1/1.3 amended — tier-1 selection builds on `POST /repos/discovery` (manifest index) instead of the meta BM25 scan. 1.3's ≤20ms budget is trivially met by the O(repos) doc scan.
- **Epic 5:** Story 5.5 (neighbors) documents the dual-source edges (`source='author'|'parser'`).
- **Epics 2/2.9, 3, 4, 6, 7, 9, 10:** unaffected (B+C+E landed inside the existing 2.9/4.8-amend work; the UI's Ingestion Log tab gains Manifest/AuthorLinks stages informationally).

**Artifact conflicts — all resolved by this proposal's applied edits:**
- **PRD:** FR-6 (+manifest at settle, +state machine), FR-7 (dual-source edges), FR-35 (tier-1 via discovery), glossary.
- **Architecture:** Graph Router row, collection model (+`okf_bundle_manifest`, +`source` on `_LINKS_TO`), write-path steps [4]-[7] rewritten for content-only chunking + the settle path, ACL section (+candidate-pool labeling).
- **Epics:** Story 1.3 AC (b), Story 5.5 AC.
- **ADR-okf-024:** scoped superseded-note pointing to ADR-okf-035 (scope/cap/latency decisions unchanged).

**Technical impact:** none new — the code is merged on `feat/okf-server`, review-hardened, and CI-green. No deployment, infrastructure, or CI/CD changes.

## 3. Recommended Approach

**Direct Adjustment (Option 1)** — documentation-only course correction; the epics amendments ride existing gated stories. Effort: **Low** (already executed in this session). Risk: **Low** (no code changes). Rollback and MVP-review were evaluated and rejected (would discard a full-pass, review-hardened capability; MVP unaffected).

## 4. Detailed Change Proposals (all applied locally 2026-08-24)

1. **PRD FR-6/FR-7/FR-35 + glossary** — manifest at settle, dual-source edges, tier-1 discovery, state machine (approved [a]).
2. **Architecture** — Graph Router row, `okf_bundle_manifest` + `source` field in the collection model, write-path [4]-[7] rewrite (content-only, WP-A gate, worker direct-POST, secret callback, settle: state machine + manifest + author links + log mirrors), candidate-pool labeling note (approved [a]).
3. **Epics** — Story 1.3 AC (b) manifest discovery; Story 5.5 dual-source edges (approved [a]).
4. **ADR-okf-024** — superseded-note for the tier-1 ranking source (approved [a]).

## 5. Implementation Handoff

**Scope: Minor — direct implementation, complete.** The edits are applied in the working tree (uncommitted). Remaining mechanical steps (held for David's go — repo maintenance window):

1. Local commit of the 4 changed files + this proposal (no push).
2. Sprint-status: `bce-bundle-manifest-author-graph-discovery` flips `review → done` (no epic add/remove; no other sprint entries change).
3. Push `feat/okf-server` **only when David ends the maintenance window**.

**Success criteria:** artifacts describe the built system (no stale BM25-over-meta references); the next session reading PRD+ADRs+epics derives the manifest-based fan-out contract without oral history.
