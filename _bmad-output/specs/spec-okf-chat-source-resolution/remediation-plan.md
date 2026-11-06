# Remediation plan — MR waves

Canonical PRD input: each wave becomes an epic in the PRD; each MR is one
reviewable slice (forward workflow: create-story → checklist → dev-story →
code-review, per standing mandate). Waves 1→3 are strictly ordered; 4/6/7 are
independent and can interleave.

## Wave table

| Wave | MR slice | Capability | Scope | Depends on | Load-bearing verification |
|---|---|---|---|---|---|
| W1 | MR-1 retriever enrichment | CAP-1 | Additive AQL join returns `repo_id` + `bundle_version`; fields ride provenance into chatqna metadata; pytest covers enrichment | none | Enrichment returns both fields for OKF graphs; legacy graph results byte-identical; zero graph-name parsing downstream |
| W2 | MR-2 concept-content route | CAP-2 | okf-server route serves concept markdown from `okf_concepts_meta`; user bearer → `scope-authz-service` per request | none (W1 only for the e2e demo) | RESTRICTED body refused to ungranted user (dedicated test); `x-okf-internal-secret` absent from the path (grep test); no authz caching; scope-mode open/closed both exercised |
| W3 | MR-3 frontend okf-concept branch | CAP-3 | `conversation.js` branches on `source === 'okf-concept'`: title-first card, open → concept content, download → `.md`; unresolvable → plain text; persisted pre-fix rows resolve best-effort; async id→title swap | W1 + W2 | Zero 404s across all four origins (Playwright); persisted old conversation renders plain text, never a dead link; legacy document cards untouched |
| W4 | MR-4 stamp RE-MEASURE + serve refusal | CAP-4 gate, D4 | Re-measure the `okf_repo_id` stamp live (root causes shipped `3d3f4c484` 2026-10-30 — expect ~100%; writer is okf-server's producer-service, not dataprep); build the D4 refusal: doc-repo refuses RESTRICTED sources on serve paths via a stamped restricted snapshot on the files doc (mechanism (b): propagated by the Access panel toggle + the import stamp — okf-server→doc-repo PATCH precedent exists; no new runtime dependency, no outage semantics; toggle-propagation failure is audited both sides) | none | Stamp ~100% on a live documents-origin ingest; restricted source download returns the refusal envelope; unrestricted unchanged; Access-panel toggle propagates to the files docs |
| W5 | MR-5 original-source links | CAP-4 | Cards expose the originating doc-repo document when `sources[]` carries one; honest "source unavailable" render otherwise | W3 + **W4 (ordered pair — never dispatch W5 first)** | Documents/crawl origins show working source links; bundle-import/scratch origins show unavailable (no wrong document ever); retracted-source link degrades |
| W6 | MR-6 OKF artifacts view | CAP-5 | Bundles leave the default document list into a labeled artifacts view (`repo@version` pills, Studio deep links, truthful per-state actions); fixes the Pending-bundle deletable-but-403 lie. doc-repo `getFiles` already supports `is_bundle` (frontend param change + view) | none (independent, UI-heavy) | Zero unlabeled bundle rows in the default list; artifact ↔ repo navigation works; Pending bundles get a truthful action; `DsTable`/`DsDialog`/`DsPill` only |
| W7 | MR-7 retract-retention (D3 REVERSAL) | CAP-6 | **Deliberately reverses the recorded 2026-10-12 backing-file rule**: retract stops hard-deleting bundle zips (today the sweep's ONLY deletion — sources are already mark-only, that half is correct and untouched); regenerable-by-next-publish is superseded by D3's unpublish-not-erase. Repo delete unchanged (hard purge) | none | Retract deletes no `is_bundle` zips; VersionsDialog still downloads every version of a retracted repo; repo delete still purges everything; the file-header directive updated to record the reversal |
| W8 | MR-8 hygiene | CAP-7 | Purge concept-keyed `ingestion_log` rows with their repo (1:1 keying safety rule; the purge path gets a span per house tracing rules); SOURCES_NOT_RETRACTED downgrades deletion-aware; the purge discriminator pinned to the concept key family so dataprep file rows stay structurally unreachable; **the delete flow also captures a `deletion_reason` (#925 split ruling, 2026-11-05 — the TTL-sweep half stays parked pending the D3 revisit)** | none | Zero concept-keyed rows survive repo delete/retract; hand-deleted source no longer dead-locks the gate; 1:1 safety test proves no cross-repo rows die; dataprep-keyed rows never purge; a delete carries its reason |
| W9 | MR-9 concept tree browse | CAP-8 | okf-server lightweight paginated tree-index route (id + title + shape — a 6k-concept repo never ships its full corpus) + per-concept content on demand (CAP-2 route) + frontend MODAL viewer (D8: UX design pass via create-ux-design at story time) entered from the citation card. Both routes mount on `servingReads` (the default-open structural marker — outside it citizens 403 in open mode); new UI strings never author `okf.labErrors.*` keys (exact-21 producer pin); mobile disposition tracked separately (#1441) | W2 + W3 | Every hop scope-checked per request; unauthorized concepts unreachable (dedicated test); retracted/draft repos' trees refused (publication gate); every concept's rendered markdown reachable; tree-index payload bounded + paginated (pinned by test); browse serves the CURRENT indexed state (bundle_version = provenance identity, not a time machine); no zip extraction; DS primitives only; Playwright handles use the chat-surface `data-testid` spelling |

## Ordering rationale

- **W1 before W3**: a frontend branch without retrieval identity forces parsing
  `OKF_{repo_id}` out of graph names — the dirty-hack pattern, banned.
- **W2 before W3**: no affordance may render before its target exists
  (no-dead-affordance rule; the current 404s are exactly that violation).
- **W2 carries its own review pass** — it is the one security-sensitive line
  (user-facing authz). Treat its review like 6-1c's.
- **W4 before W5**: original-source links lie if the stamp is broken; W5 renders
  "unavailable" honestly only once the stamp is trustworthy.
- **W9 after W2 + W3**: the tree walks the same scope-authorized concept path W2
  builds and enters from the W3 card; independent of W4-W8, can interleave.
- Each UI wave (W3, W5, W6) carries its own i18n keys × 14 locales
  (`localeConsistency`) and its own Playwright handle sweep — W8 is server
  hygiene only, not an i18n catch-all.

## No-regression inventory (every wave re-checked)

- **Legacy query pipeline**: chatqna citation mint (`genieai_chatqna.py:3524-3595`)
  stays verbatim; retriever enrichment is additive — legacy graph results
  byte-identical; retrieval-mode governance, graph routing, RRF unchanged.
- **Legacy document handling**: doc-repo upload/download/view flows unchanged;
  every doc-repo change in this plan touches `is_bundle` rows or adds refusals on
  RESTRICTED sources only; legacy document retract sweeps keep processing raw
  documents exactly as today.
- Legacy document chat path: same URLs, same dialogs, same errors-for-legit-404s.
- 6-1c scope semantics: open mode's public-base grant, restricted fencing, both unchanged.
- VersionsDialog behaviour for NON-retracted repos unchanged.
- Wizard hand-off mechanics (documents → OKF entry point) untouched — documented
  fragile but working.
- Smoke harness extended per story and re-run live (standing rule).
- Coverage % never decreases; CI gates on the merged result.

## Deferred (recorded, not planned)

- **Zip-member extraction** — off the critical path because CAP-2 serves the
  grounding text directly; pick up only with the recorded guardrails (streaming
  members, per-member decompressed-size AND compression-ratio caps, request
  concurrency gate) and per-version cache keys (`bundle_file_id`, never
  per-repo "latest").
- **redis caching** — revisit only on measured serve-route latency evidence AND
  a `maxmemory`+LRU posture change on the redis instance.
