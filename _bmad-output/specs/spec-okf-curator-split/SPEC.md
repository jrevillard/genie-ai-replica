---
id: SPEC-okf-curator-split
companions:
  - implementation-grounding.md
sources:
  - ../../implementation-artifacts/csr-w7-concept-ceiling-story.md
  - ../../planning-artifacts/workplans/workplan-okf-2026-11-05.md
---

> **Canonical contract.** This SPEC and `implementation-grounding.md` are the complete, preservation-validated contract for what to build, test, and validate. Source documents in frontmatter are traceability only.

# Curator-initiated concept split (#1577)

## Why

The ceiling initiative's guard half (!788, #1576) made oversized concept documents unsplittable-by-machine at every write path: imports split automatically, and anything that cannot split is refused with `CONCEPT_TOO_LARGE` naming the offending section. The refusal's advice — "split it into smaller concepts" — is **advice with no affordance behind it**: no tool lets a curator actually do that. It matters for the ~4% of oversized documents whose single heading section exceeds the ceiling alone (no automatic splitter may cut them), and for every curator who wants finer concept granularity than the automatic seams chose. This is a pain to solve (the curator is stuck) completing a mandate (the ceiling initiative's own deferred half, GitLab #1577).

## Capabilities

- **CAP-1 — per-concept lossless split**
  - **intent:** The curator can split ONE concept into ceiling-bounded parts along lossless seams, from the editor.
  - **success:** Splitting a seeded over-ceiling concept yields parts that EACH measure at or under the ceiling, and the parts rejoin to reproduce the original body byte-for-byte (original EOLs preserved). Any fragment exceeding every boundary class refuses per CAP-2 instead of being cut or dropped.

- **CAP-2 — honest refusal, zero partial state**
  - **intent:** A concept whose unbreakable unit exceeds the ceiling refuses clearly, writing nothing.
  - **success:** A seeded single-line-over-ceiling concept split attempt returns `409 CONCEPT_TOO_LARGE` (the shared refusal naming size, ceiling and remedy), writes zero rows, and leaves the repo's tree and graph untouched.

- **CAP-3 — legible before, provable after**
  - **intent:** The curator sees what the split will do before confirming, and can prove the outcome afterwards.
  - **success:** The confirm surface previews the proposed seam structure and per-part sizes before acting; after a successful split the concept tree shows part 1 under the ORIGINAL concept_id with parts 2..N suffixed, the summary reports the created/updated counts, and every new row carries `index_status: 'parsed'` with the repo's current graph name (born-right, drains immediately).

- **CAP-4 — the write surface holds**
  - **intent:** The operation respects the repository's existing write rules end to end.
  - **success:** Draft repos only (`assertWritable` — serving/restricted refuse), admin scope on the route, an audit record naming the actor and action, and the whole UI gated on the editor's read-only state.

## Constraints

- **One lossless engine.** `splitConceptBody` (concept-splitter.js) is the only splitter this operation may use; losslessness is structural (contiguous line ranges, byte-for-byte rejoin). The legacy `segmentMarkdown` behavior — silently discarding sub-200-char sections — must NOT be inherited, and `resplitRepo`'s destructive whole-repo semantics are never overlloaded: this operation is additive with its own route and result vocabulary.
- **Part-1 identity.** Part 1 keeps the original `concept_id` (inbound links keep resolving to a live document); parts 2..N use the established `-part-N` suffix convention.
- **One ceiling authority.** Every size decision reads `maxConceptDocChars()` — the same value the import path, the editor save guard, and the publish gate read. No second constant.
- **409 on refusal.** This is an editor write path: refusals carry `409 CONCEPT_TOO_LARGE` with the shared refusal body (import's 400 does not apply here).
- **Drain contract.** Every resulting meta row must re-drain: `index_status: 'parsed'` + born-right `graph_name`, through the existing upsert/requeue patterns — no new queue mechanism.
- **Front-of-house conventions.** DS primitives and tokens only; the editor's read-only gating; i18n keys in all 14+ locales, deep-key-identical, inserted verbatim; verbose structured logging on the new backend path; all database access through the shared db driver.
- **BMAD discipline.** The implementation stories carry the forward workflow (story → checklist → dev → review); bookkeeping rides the code MR.

## Non-goals

- No change to legacy `resplitRepo` (whole-repo re-ingest stays exactly as it is).
- No manual seam editing — the curator invokes the operation; the splitter chooses the seams. A seam picker is future work.
- No migration of existing over-ceiling rows — the operation acts on demand, per concept; corpus data decisions remain David's.
- No change to the import path's 400 refusal or the publish gate.
- No multi-select / batch splitting in the first cut (one concept per invocation).

## Success signal

A steward hits `CONCEPT_TOO_LARGE` on save or publish for a real over-ceiling concept, opens the editor, invokes the split on that concept, confirms — and the same publish then succeeds, with the concept's content intact byte-for-byte and nothing dropped. The refusal's advice finally has an affordance behind it.

## Assumptions

- The operation applies to ANY concept the curator picks, under-ceiling included (finer granularity is a legitimate goal per the original plan §6); the ceiling bounds the parts, not the act.
- The entry lives on BOTH editor surfaces — the concepts-tree row action AND the concept editor pane — both read-only-gated (David, 2026-11-14).
- Inheritance follows the import conventions: parts carry the concept's frontmatter, title lineage, topic links and sources — parts 2..N carry `sources[]` UNCHANGED (provenance is not partitioned; David, 2026-11-14).
- One file of record per concept: a concept derived from a doc-repo source splits against that source's body; a hand-authored concept splits against its stored markdown.
