---
title: OKF chat-source resolution & Document Management integration
description: Map RAG citations to OKF concepts and their source files, serve them open/downloadable like legacy documents, and end the doc-repo garbage problem — without regressing shipped OKF features.
companions:
  - evidence-map.md
  - remediation-plan.md
sources:
  - _bmad-output/implementation-artifacts/3-6-document-mgmt-create-okf-entry-point.md
  - _bmad-output/implementation-artifacts/3-7-crawler-ui-create-okf-entry-point.md
  - _bmad-output/implementation-artifacts/7-7-produce-okf-from-selected-documents.md
  - docs/adr/okf-003-standalone-service-behind-kong.md
  - docs/adr/okf-017-okf-v02-trust-lifecycle-provenance.md
  - docs/adr/okf-035-bundle-manifest-and-author-graph.md
---

# Why

Chat answers cite their sources. For the legacy document pipeline those citations open and download; for OKF-served content every citation is a dead link — the frontend stamps OKF concepts with a doc-repo URL family that cannot resolve (no per-concept files doc exists on any creation origin), surfacing "Could not open the document" errors and 404 downloads. The same integration gap shows up in the Document Management tab: every publish mints a bundle zip that lands unlabeled in the documents table forever, retract silently destroys every version download the Versions dialog promises, and concept-keyed ingestion-log rows accumulate invisibly. The OKF pillar's credibility with citizens (working citations) and stewards (an honest document inventory) is gated on closing this end to end.

# Capabilities

- **CAP-1 Retrieval identity** — Every OKF chunk citation carries `repo_id` and `bundle_version` end to end. *Intent:* downstream resolvers never parse graph-name strings and never guess across repos. *Success:* the retriever enrichment AQL returns both fields; provenance reaches chatqna metadata and the frontend payload; pytest covers the enrichment; no graph-name parsing exists anywhere downstream.
- **CAP-2 Concept content serving** — A chat-user-accessible, scope-authorized okf-server route serves a concept's markdown (title, labels, body). *Intent:* the citizen reads what RAG actually grounded on, under the same 6-1c / `OKF_SCOPE_MODE` / `acl.restricted` authority as retrieval. *Success:* the user bearer authorizes per request through `scope-authz-service`; RESTRICTED bodies are refused to ungranted users (dedicated test); the internal shared secret appears nowhere on the path; no authz caching on the route.
- **CAP-3 Dead-link elimination** — OKF chat cards render title-first with working open/download targets; unresolvable sources degrade to plain text. *Intent:* no affordance without a working target — the "Could not open the document" banner class is extinct. *Success:* zero 404s/error banners on citations across all four creation origins; persisted pre-fix conversations degrade gracefully (plain text, never dead links); card titles resolve asynchronously (id → title swap) without blocking render.
- **CAP-4 Source-document links** — Cards expose the originating doc-repo document when `sources[]` carries one (documents/crawl origins), honestly rendering "source unavailable" otherwise. *Intent:* provenance for the steward/auditor without lying about availability. *Success:* gated on the `okf_repo_id` stamp fix (observed 41/41 failure) landing first; failed resolution renders unavailable, never a wrong document.
- **CAP-5 OKF artifacts view** — Bundle zips leave the default document list into a labeled view with `repo@version` provenance, Studio deep links, and truthful per-state actions. *Intent:* the documents table lists documents; machine artifacts get their own honest surface. *Success:* zero unlabeled bundle rows in the default list; the Pending-bundle deletable-but-403 lie is resolved; bidirectional navigation (artifact ↔ repo) exists.
- **CAP-6 Retract-retention contract** — Retract preserves every version bundle zip; repo delete purges. *Intent:* retract = unpublish, not erase; Versions downloads keep working. *Success:* the retract sweep exempts `is_bundle` docs; VersionsDialog links for a retracted repo still download; repo delete unchanged (hard purge, David's 2026-10-12 directive); the two verbs are named and explained in the UI.
- **CAP-7 Garbage elimination** — Concept-keyed ingestion-log rows are purged with their repo (1:1 keying safety rule); the SOURCES_NOT_RETRACTED gate downgrades deletion-aware; no per-concept doc-repo files are ever created. *Intent:* doc-repo holds no invisible, unbounded, or user-meaningless artifacts. *Success:* zero concept-keyed log rows survive a repo delete/retract; a hand-deleted source no longer dead-locks the ingest gate; the documents tab contains no unlabeled OKF rows.
- **CAP-8 Concept tree browsing** — From a cited concept the citizen walks the repo's within-repo concept graph starting at that concept (D6, 2026-11-04). *Intent:* the citation becomes an entry point into the knowledge base — read-only, under the same scope authority as retrieval, no steward UI. *Success:* every hop loads through the scope-authorized concept path (per-request authz, no internal secret); concepts the user could not retrieve are unreachable (dedicated test); the entry affordance renders only on working cards; DS primitives only.

# Constraints

- The internal shared secret (`x-okf-internal-secret`) must NEVER appear on the user-facing chat-card path; the user bearer through `scope-authz-service` (6-1c, `OKF_SCOPE_MODE`, `acl.restricted`) is the only authority; no authz caching on serve routes (the retrieval path's last-known-good-on-5xx pattern must not be imported).
- No-regression: legacy chat path untouched (frontend branch keyed on `source === 'okf-concept'`); chatqna's source mint stays verbatim; the retriever enrichment is purely additive; all 14 locales stay key-identical (`localeConsistency`); Playwright locators swept with any rename.
- Authz is enforced per-request from token claims; `getAuthorizedGraphs`'s last-known-good-on-5xx caching is a retrieval-only pattern and must not reach any serve route.
- Bundle-cache keys (if ever needed) must be per-version `bundle_file_id`, never per-repo "latest" (the bare-`limit=1` trap).
- Reuse the DS primitives (`DsTable`/`DsDialog`/`DsPill`), the `okf` Vuex store, `okfRepoOps`, and the `?tab=…&file=` deep-link pattern; no new UX paradigms.

# Non-goals

- No zip-member extraction in any wave (deferred; recorded guardrails: stream members, per-member decompressed-size AND compression-ratio caps, request concurrency gate — a 100 MB zip is ~133 MB as base64 plus buffer copies).
- No redis or any new cache layer (unanimous panel verdict; revisit only on measured latency evidence AND a `maxmemory`+LRU posture change on the redis instance).
- No change to legacy document chat behavior, the wizard hand-off mechanics (documented as fragile but working), or repo-delete's intentional hard purge.
- No migration/backfill of persisted history rows (best-effort resolution at render time only).

# Success signal

A citizen clicks any chat citation on any of the four creation origins and lands on the content — no 404, no error banner — and can walk from that citation into its repo's concept graph; an old pre-fix conversation renders gracefully; a retracted repo's Versions dialog still downloads every version; the Document Management default list contains zero unlabeled bundle rows; a deleted repo leaves zero concept-keyed log rows behind. All suites green: backend + frontend + okf-server Jest, overlay pytest, Playwright sweep, `localeConsistency`, and the per-story smoke harness extension.
