# OKF Studio hardening window — 2026-09-12

Work log for the `feat/okf-server` stream on 2026-09-12 (lifecycle rules, graph
viewer UX, PII/conformance tooling, drain freeze, dashboard badges, live-drain
accounting). Companion to `docs/crawl-kill-incident-2026-09-12.md` (parallel
crawl-kill stream, same branch).

Branch tip after this window: `0c75b2b05` — pipeline fully green
(okf-server jest 611/611; frontend jest 1456/1456).

## 1. Promote-stage CI failure — fixed (`efcfe774`)

Every MR pipeline failed in `promote` (all 18 jobs). Cause: the promote jobs
declared `artifacts: false`, starving main's NFR-S1 report gate of its inputs.
Fix: `artifacts: true` on the 18 promote `needs:` entries; the duplicate
`container_scanning` `artifacts:` block (last-wins in GitLab, but breaks strict
parsers and IDEs) was merged into one.

## 2. Retraction exit — only via Submit → Review (`69279fee`)

Kenya v11 was retracted, edited, and re-ingested straight back into service —
no review, no new version. The state machine's publish/ingest from-lists still
contained `retracted` as an escape hatch.

Fix (creation point, not a rename): `lifecycle-service` TRANSITIONS now permit
`publish: {from: ['approve','publish']}` and `ingest: {from: ['publish']}` —
`retracted` remains ONLY in `submit.from`. A retracted repository must pass
Review → Approve → Publish → Ingest; changed content therefore always mints a
new version before it can serve again.

## 3. Graph viewer — hover summary cards + zoom (multiple commits)

- Hover summary card on the selected node AND every node in the highlighted
  neighborhood (`e51f2d6`, `61c7d79`, `83b3e27`, `a5fd45c`): a rounded card
  (DsPill chips, links/chunks/flagged counters, meta rows) built from concept
  meta + the links map.
- DOM lesson: the card must live OUTSIDE cytoscape's container (sibling of the
  stage wrapper). Inside it, cytoscape's internal DOM ops desync and Vue's
  patch crashes with `insertBefore: null`.
- Node click keeps the selection → file-viewer sync but no longer flips the
  pane from Graph to Files; users toggle manually and the Files pane lands on
  the clicked file.
- +/− zoom buttons (`e2013ac`): `cy.center()` PANS and returns the core — it
  does not return a position. Zoom now computes `{x: w/2, y: h/2}` in rendered
  coordinates and zooms about that point. Wheel zoom untouched.

## 4. Repo-wide PII actions + stable resolutions (`0e1bee1`)

Redact-all / Remove-all / Accept-all controls in the Files-view header bar
(`ConceptList` emits `pii-bulk`, `RepoEditor` confirms via DsDialog, okf-server
route `POST /:repo_id/pii-bulk` applies via `pii-service.repoBulkAction`).

Semantics: scan-free (uses `pii_hits_summary` as the ledger), per-concept
accept-resolutions are subtracted on every later scan, so resolved items never
re-flag orange unless the user explicitly re-scans; after actions the repo
passes the publish gate and nothing auto-rescans.

## 5. Conformance — severity-gated publish + real autocorrect (`c648400`)

- The publish gate blocked on ANY conformance issue ("1 concept(s) with
  conformance issues: index" with no detail). Issues are now shown in clear
  terms, and the gate keys on SEVERITY: only `error`-class issues
  (`MISSING_TYPE`, `BAD_ACTOR_PREFIX`) block; warnings advise.
- Autocorrect fixes issues (rule 3 fills an empty `sources[i].resource` from
  `meta.sources` provenance, then siblings) and `patchConceptMeta` recomputes
  `conformance_issues` via the pure `validateConcept` on every patch (a raw
  `col.update` previously left stale issues).
- `d3fa2bc`: repo-wide autocorrect 500 — the AQL query text and bind vars were
  built separately and diverged (`bind parameter 'c' not declared`).

## 6. Autocorrect stays mechanical (`1c3ab37`, `18012c2`)

David: "how the fuck do I know which concepts to process autocorrect for?"
The curated (LLM) path on a 997-concept repo proposed per-concept frontmatter
→ gateway timeout. Now:

- Explicit body mode (`llm|hybrid|heuristics`) WINS over the repo's persisted
  classification; omitted falls back to it.
- Repo-wide CURATED proposes are capped at 25 → HTTP 409
  `CURATED_PROPOSE_TOO_BROAD` (targeted per-concept runs are the LLM path).
- The AutocorrectPanel pins `heuristics` for its dry-run/apply.

## 7. Drain freeze (`d3718bc`)

David: "a GDPR scan must not be able to be performed on a published repository
while it is being ingested… in fact nothing must be able to modify it while it
is being ingested."

- `rag_drain_active === true` → every mutating route 409s with
  `DRAIN_IN_PROGRESS` (`assertWritable`), and `buildingBlocker` freezes every
  lifecycle transition.
- Retract stays exempt (it is the recovery path) and now DISARMS the flag and
  cancels the `rag_ingestion` record with a complete shape
  (`status: 'cancelled'`, counters zeroed) — no stale card state.

## 8. Dashboard popups wear badges at every stage (`ddfd74a`)

David: "all of the popup information cards on the okf repo cards in the
dashboard must wear appropriate badges at all stages (heuristics|llm|hybrid,
importing|reviewing|ingesting|serving|retracted)".

- `BuildProgressCard` covers six phases (`serving|rag|import|review|retracted|
  idle`): a neutral classification pill and a variant-colored lifecycle pill
  render on EVERY card; per-phase title/hint + a Stage row.
- `StudioDashboard.hasStatusPopup()` opens the popup for every repository —
  badges are never hidden behind "something is running".
- 15 new `okf.build.*` i18n keys English-filled into all 13 non-en locales
  (fill-missing-only — the earlier Gemini translations are preserved). A
  Gemini pass for real translations is queued (408 outstanding keys total).
- Same commit prettier-formats `StudioWizard.vue`, which had failed the CI
  `lint:frontend` format check for ~10 consecutive pipelines (everything else
  in lint was clean; the red was one unformatted file riding the branch).

## 9. Live-drain accounting — the 0/997 card (`0c75b2b`)

David: "it has been draining for a long time with 0/997 concepts ingested."

**Root cause.** The ingest worker refreshed drain progress with DOTTED patch
keys:

```js
db.collection('okf_repositories').update(repoId, {
  'rag_ingestion.status': 'draining',
  'rag_ingestion.concepts_done': indexed, ...
});
```

ArangoDB `update()` treats object keys as LITERAL attribute names. Every
refresh wrote invisible FLAT attributes (`"rag_ingestion.concepts_done": …`)
alongside the real doc, while the NESTED `rag_ingestion` object the dashboard
reads stayed exactly as the ingest transition wrote it: `concepts_done: 0`.
Indexing itself was progressing the whole time (okf_concepts_meta
`index_status` counts climbed normally).

**Fix.** Both worker refreshes (progress + failure augment) read-merge-write
the nested object. New regression test pins the contract: the patch must
contain a nested `rag_ingestion` and NO flat dotted attribute names. The
wedge test now asserts the nested shape too.

**Live repair.**

1. The polluted flat attributes were stripped from 3 repo docs. Gotcha: the
   first attempt used `UPDATE r WITH UNSET(r, bad)` — a no-op BY CONSTRUCTION,
   because `update()` deep-merges and resurrects keys the patch merely omits.
   Removal requires `REPLACE r._key WITH UNSET(r, bad)`.
2. The armed repo's nested record was backfilled from live counts; the
   dashboard card then climbed in real time (313 → 332/997 within minutes of
   the okf-server rebuild).

Note: `okf-server` was rebuilt/restarted mid-drain — the worker re-claims
in-flight rows, the drain continued uninterrupted (proven live, twice).

## 10. Session-collision note (shared checkout)

A parallel session's tooling rewound the local branch to `d3718bcfa` while
this stream pushed `ddfd74a47` + `0c75b2b05` (both on the remote; the pipeline
ran on them). Recovery: verified all 20 locally-dirty files byte-identical to
the remote tip, discarded only those duplicates (never the parallel stream's
WIP: `kong_config.json`, `shared/lib/logger.js`), then `git merge --ff-only
origin/feat/okf-server`. Rule of thumb for this checkout: fetch + compare
against the remote tip BEFORE discarding anything, and stage files by explicit
path only.
