# Evidence map — OKF chat-source resolution

Hot-spots from the three survey reviews + party panel (2026-11-04). Every claim is
file:line-anchored; these anchors are what the PRD and stories cite.

## The dead-link chain (why every OKF citation 404s today)

1. **chatqna mints the citation** — `genie-ai-overlay/chatqna/genieai_chatqna.py:3524-3595`:
   the OKF branch sets `source: 'okf-concept'`, `documentId = concept_id`,
   title derived from chunk text. Mint stays verbatim (constraint).
2. **frontend stamps a doc-repo URL on it** —
   `components/gov-chat-frontend/src/store/modules/conversation.js:219-237`:
   `translateSources` builds `url: doc.url || /api/files/${documentId}/download`
   for EVERY source, OKF concepts included. This is the 404 generator.
3. **doc-repo cannot resolve it** —
   `components/document-repository/src/controllers/fileController.js:469-516`
   (`_getFileAndPath`, the 404 seam): no per-concept `files` doc exists on ANY of
   the four creation origins (content-only chunking — ADR okf-008). `downloadFile`
   :653-681 and `viewFileInBrowser` :778-806 both enter through that seam.

## The four creation origins (what exists where)

| Origin | Per-concept files doc | `sources[]` carries doc-repo id | Bundle zip per publish |
|---|---|---|---|
| Documents (wizard from Document Mgmt, Story 7-7) | NO | YES (intended) — stamp observed failing 41/41 | YES |
| Crawl (mode A/B) | NO | partially (crawl pages) | YES |
| Bundle import | NO | NO (bundle-internal only) | YES |
| Scratch (editor) | NO | NO | YES |

Consequence: concept content lives ONLY in `okf_concepts_meta` (markdown +
frontmatter, ArangoDB) — the CAP-2 serve source; the only per-origin provenance
is `sources[]` (CAP-4) and only for documents/crawl origins.

## Enrichment anchor points (retriever)

- `genie-ai-overlay/retriever/genieai_retriever_arangodb.py:1813-1834` — the AQL
  enrichment join where `repo_id` + `bundle_version` can be added additively
  (graph_name already carries the repo; the fields must become first-class so
  downstream never parses `OKF_{repo_id}` strings — the dirty-hack trap).
- `:2203-2232` — provenance assembly into the response payload (the ride-along
  point for the new fields).
- Authz context: `getAuthorizedGraphs` caches last-known-good on 5xx — a
  retrieval-only pattern that must NOT reach serve routes (constraint).

## The authorization line (CAP-2)

- Authority: `components/okf-server/services/scope-authz-service.js` +
  `access-control-service.js` (6-1c; `OKF_SCOPE_MODE` open/closed; `acl.restricted`
  fences RESTRICTED repos in BOTH modes).
- Forbidden on the user path: the internal shared secret
  (`x-okf-internal-secret`, see `internal-controller.js:159` — internal-only).
- Concept content source: `okf_concepts_meta` rows (title, labels, body markdown,
  `bundle_version`).

## Document Management / doc-repo hot-spots

- **Bundle minting**: `fileController.js:1441-1608` (`uploadBundle`) — one zip
  `files` doc per publish version, `is_bundle: true`, `repo_id`, `bundle_version`;
  lands UNLABELED in the default documents list (CAP-5 target).
- **WS2 protection**: `fileController.js:92-131` — bundle zips are
  okf-service-only for delete; explains the Pending-bundle
  deletable-in-UI-but-403 lie.
- **WS3 live-forever**: bundle-export-service exports are permanent artifacts
  (never swept).
- **Retract lifecycle (CORRECTED per Jerome's audit, 2026-11-04)**:
  `backing-file-service.js` (header directive, David 2026-10-12) — retract
  MARKS source documents `Retracted` (never deleted — the repo is in its
  reversible edit state) and hard-deletes ONLY bundle zips, as REGENERABLE
  artifacts of the next publish. So CAP-6's raw-file half is already correct
  today; the actual W7 change is a DELIBERATE REVERSAL of the recorded
  bundle-rule (per D3, retract now also KEEPS the zips). The earlier wording
  ("sweep REMOVEs raw files") was wrong.
- **No zip reader in doc-repo**: archiver is write-only; adm-zip extraction exists
  only in okf-server — extraction (deferred) would live there.

## Hygiene hot-spots (CAP-7)

- `ingestion_log` rows are keyed `concept_id`/`repo_id` but never purged on repo
  delete/retract — invisible, unbounded growth. Safety rule: purge only rows whose
  key resolves 1:1 to the repo's own concepts.
- SOURCES_NOT_RETRACTED gate (`retraction` path) fail-closes when a source files
  doc was hand-deleted → ingest permanently blocked with no remedy; downgrade must
  be deletion-aware.
- `okf_repo_id` stamp onto `sources[]` observed failing 41/41 on 2026-10-11 —
  **root causes already shipped on main in `3d3f4c484` (2026-10-30)**: doc-repo's
  PATCH /api/files/:id is open to the okf-service role (`rolePolicy.js:15`
  DOCUMENT_LIFECYCLE) and `updateFileSchema` accepts `okf_repo_id`
  (`fileController.js:191`). The stamp is written by okf-server's
  `producer-service.js:104-108` (PATCH to doc-repo), with a 100%-failure-rate
  loud error. CAP-4's gate is a live RE-MEASURE (expect ~100%), not a fix.

## Infrastructure facts that bent decisions

- **redis**: single instance, `noeviction`, no `maxmemory` — unbounded writes are
  a leak; only the backend has an ioredis client. Reason D5 rejected redis.
- **bundle zips** average well above chat-request budgets; a 100 MB zip is
  ~133 MB as base64 plus buffer copies — why member extraction was deferred with
  guardrails.
- **Kong** fronts okf-server (ADR okf-003) — a new public concept-content route
  needs no gateway change, only the route's own authz.
