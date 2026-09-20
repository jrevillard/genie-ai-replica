# Story 1.7 — Retrieval Mode Governance (runtime config + engagement gate)

**Status:** IN-PROGRESS — ungated legs LANDED 2026-09-20 (commit 44127eb); gated
consumption legs ride Wave R4/R6 of the fan-out build.
**Sources:** [ADR-okf-039](../../../docs/adr/okf-039-retrieval-mode-governance.md) D1–D3,
FR-44, [fan-out course-correction](../planning-artifacts/okf-fanout-course-correction-2026-09-20.md).

## What landed (the ungated legs)

| Piece | Where |
|---|---|
| `okf_system_config` collection (keyed docs, `_key='retrieval'`) | `db/collections.js` |
| Env boot defaults (`OKF_RETRIEVAL_*`) | `config.js` → `retrieval` |
| Service: effective config, serving set, PUT + audit | `services/retrieval-config-service.js` |
| `GET /api/okf/retrieval-config` (read-scoped) | `routes/okf-routes.js` + `controllers/retrieval-config-controller.js` |
| `PUT /api/okf/retrieval-config` (`tools-admin`) | same |
| Tests | `__tests__/retrieval-config-service.test.js` (15) |

### Behavior

- **Effective config** = env boot defaults overlaid **field-by-field** with the
  governed row; the row never has to exist (`legacy` needs no row — the safe
  default). `source: 'env-defaults' | 'database'` tells operators which regime
  is live. A non-404 storage failure surfaces (no silent env fallback).
- **Read-model** (GET response): `{config, source, serving_graph_count,
  serving_repo_ids, serving_graphs[{repo_id, graph_name, domain}], engaged, warnings}`.
- **Engagement gate (D2)** computed server-side: `engaged = mode !== 'legacy'
  && serving_graph_count >= 1`. `okf_only` with zero serving graphs reports
  `engaged:false` **with a structured warning** — never a silent legacy fallback.
- **Serving truth** = `lifecycle_state === 'publish' && ingested_at != null &&
  deleted_at == null` (the same predicate as the frontend `laneFor` Ingested
  lane). Graph names come from the **workingGraphName authority**
  (`OKF_<slug>_v<version>` from the repo doc) — never a static
  `OKF_{repo_id}` name and never the manifest's stamped version (skews during
  a re-publish drain window — course-correction §1.3 Trap 2).
- **PUT**: `tools-admin` role; payload validated (mode enum `legacy|okf_only|hybrid`;
  integer caps within sane maxima; unknown fields rejected); revision-bumped;
  **before→after audited** to `okf_audit_logs` with `repo_id='_system'`
  (ADR-029 spine). Audit description reads e.g.
  `mode: "legacy" → "hybrid" (revision 1)`.

### Config shape

```json
{
  "mode": "legacy",              // legacy | okf_only | hybrid
  "max_fanout_graphs": 5,        // 1..20
  "spine_max_hops": 2,           // 1..3   (ADR-039 D4 tier-1)
  "extracted_hop_cap": 1,        // 1..3   (tier-2)
  "candidate_cap_per_graph": 50, // 1..200
  "candidate_cap_global": 200,   // 1..1000
  "revision": 0, "updated_at": null, "updated_by": null
}
```

Env boot defaults: `OKF_RETRIEVAL_MODE`, `OKF_RETRIEVAL_MAX_FANOUT_GRAPHS`,
`OKF_RETRIEVAL_SPINE_MAX_HOPS`, `OKF_RETRIEVAL_EXTRACTED_HOP_CAP`,
`OKF_RETRIEVAL_CANDIDATE_CAP_PER_GRAPH`, `OKF_RETRIEVAL_CANDIDATE_CAP_GLOBAL`.

## Verification

- New tests 15/15 (defaults merge, 404-vs-failure semantics, engagement gate,
  versioned graph names, PUT validation matrix, revision bump, audit fields).
- Full okf-server suite green (`--maxWorkers=2`, exit 0). Note: a pre-existing
  5s timeout flake in `import-links-integration.test.js` under full parallel
  load — passes in isolation and at the house `maxWorkers=2`; NOT touched by
  this change (additive only).

## Remaining legs (gated/consumers — later waves by design)

1. **Read side** (Wave R4): chatqna + retriever consume GET with a ≤30s TTL
   cache + last-known-good; fan-out path runs only when `engaged=true`.
2. **Legacy invariant (D8)**: CI assertion that `legacy` + single-graph calls
   are byte-identical to pre-Epic-1 results and spans (Wave R4 smoke).
3. **Studio card (Story 10.7)**: mode selector + serving count + cap editors +
   audit trail in the OKF Studio tab — i18n ×14 locales and the site docs
   (operator guide for mode governance) are **completion gates** for that story.
