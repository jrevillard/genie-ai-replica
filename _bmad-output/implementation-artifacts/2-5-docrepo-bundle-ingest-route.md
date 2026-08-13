---
baseline_commit: pending
---
# Story 2.5: Document-repository bundle ingest route

Status: ready-for-dev
Story key: `2-5-docrepo-bundle-ingest-route` | GitLab: #881 (`prd::okf-server`, `okf-server::epic-2`)
Epic: 2 (OKF Server — Repository Ingestion & Management) | Branch: `feat/okf-server`
FRs: **FR-5** (safe ingest via document-repository), **FR-22** (bundle content via document-repository) | References: Architecture §8.2, §6 step 4; ADR-okf-008, ADR-okf-016

## Story

As a **platform engineer**,
I want **bundle/repository content stored, scanned, and handed to dataprep through the existing document-repository**,
so that **no new storage vendor or scanning infrastructure is introduced**.

This is the **ingest orchestrator** — the bridge between the OKF Server (control plane: repo CRUD, parser, conformance) and the dataprep indexing pipeline. It modifies the **document-repository** service (`components/document-repository/`), NOT the okf-server. **Ungated** (Node-only; dataprep graph_name consumption is Story 2.6, gated).

## Acceptance Criteria

1. **New route** — `POST /api/files/ingest-bundle` in `components/document-repository/src/routes/fileRoutes.js`, protected by `authorizeRole(['Admin'])`. Accepts JSON body (parsed by the existing global `express.json()`). Does NOT mount multer/`validateFiles` (those are the pipeline to bypass).
2. **ClamAV scan reused** — explicitly calls `securityService.scanBuffer(buffer)` on the bundle bytes. On malware (`isInfected: true`): reject + log + nothing stored/indexed (403). On clean: proceed to storage.
3. **Upload pipeline BYPASSED** — skips: multer memoryStorage, `validateFileType` (magic-byte + extension allowlist), langdetect, text-extraction. KEEPS: ClamAV scan, size check, disk write, `files` collection doc, single-base64 handoff format to dataprep.
4. **File storage** — writes bytes to disk (`fileUtils.generateUniqueFileId()` + `uploadDir`) + creates a `files` collection doc via `metadataService` (mirrors `fileService.uploadFile` steps 3–10 minus the bypassed stages).
5. **`graph_name` threaded to dataprep** — extends `_ingestFileById(fileId, graphName)` to add `graphName` to the `axios.post` payload sent to dataprep (`/v1/dataprep/ingest_file`). The route receives `graph_name` in the request body (`graph_name=OKF_{repo_id}`) and passes it through. Existing callers of `_ingestFileById` are unaffected (graphName optional, defaults to null).
6. **Malware rejection** — malware found → 403 + logged + file NOT written to disk + NOT handed to dataprep + audit trail.
7. **Standards** — mirrors document-repository conventions (class-field handlers, constructor binding, `_handleUploadError`, `_formatFileRecord`). MELT where the document-repository supports it (its logger + errorHandler). All exceptions handled + logged. ITU copyright headers. ESLint/Prettier clean. Jest tests.
8. **Tests** — Jest (mirror `upload.test.js` mock stack): happy path (bundle stored + scanned + handed to dataprep with `graphName` in payload); malware rejected (403, nothing stored); auth (non-Admin → 403); `_ingestFileById` threads `graphName` into the `axios.post` payload.

## Tasks / Subtasks

- [ ] **T1 — Extend `_ingestFileById`** (AC: 5)
  - [ ] `src/controllers/fileController.js` — change `_ingestFileById(fileId)` → `_ingestFileById(fileId, graphName = null)`; add `graphName` to the `axios.post` payload (7th key alongside fileId/fileName/fileType/fileLabels/storagePath/fileBase64).
- [ ] **T2 — Bundle storage method** (AC: 2,3,4)
  - [ ] `src/services/fileService.js` — add `async uploadBundle(buffer, bundleInfo)` that mirrors `uploadFile` steps 3–10 (generate fileId → ClamAV `scanBuffer` → disk write → `files` doc) but OMITS langdetect/allowlist/text-extraction. Returns the file record. Add to `module.exports`.
  - [ ] `bundleInfo` shape: `{ originalFileName, mimeType, labels, graphName, repoId }` (labels from the request body — used for ACL chunk_labels later; graphName/repoId stored on the files doc for retract-by-repo).
- [ ] **T3 — Controller handler** (AC: 1,2,6)
  - [ ] `src/controllers/fileController.js` — add `bundleIngest = async (req, res) => { ... }` class field. Validates body (joi), decodes bundle bytes, calls `fileService.uploadBundle`, then `_ingestFileById(fileId, graphName)`. Bind in constructor.
  - [ ] `_handleUploadError` already maps virus errors → status codes (reuse).
- [ ] **T4 — Route registration** (AC: 1)
  - [ ] `src/routes/fileRoutes.js` — add `router.post('/ingest-bundle', authorizeRole(['Admin']), fileController.bundleIngest);` (NO multer/validateFiles).
- [ ] **T5 — metadataService allowlist** (AC: 4)
  - [ ] `src/services/metadataService.js` — if `graphName`/`repoId` must persist on the `files` doc post-ingest, add them to `allowedFields` (line 189). Otherwise they're silently dropped by `updateMetadata`.
- [ ] **T6 — Tests** (AC: 8)
  - [ ] `src/__tests__/routes/bundleIngest.test.js` — mirror `upload.test.js` mock stack; cover happy path + malware + auth + graphName threading.
- [ ] **T7 — Lint/format/verify + deploy** (AC: 7)
  - [ ] `cd components/document-repository && npm run lint && npm run format:check && npm test` — all clean.
  - [ ] Deploy: rebuild the document-repository image + redeploy to local build; smoke-verify.

## Dev Notes

### CRITICAL: This modifies a DIFFERENT service
Story 2.5 is in **`components/document-repository/`** — NOT the okf-server. The document-repository has its OWN conventions:
- **No `createApp()` factory** — `src/app.js` exports a singleton Express `app`; tests import it directly: `const app = require('../../app')`.
- **Class-field handlers** in `fileController.js` (not prototype methods); constructor binds every method.
- **Auth**: `router.use(authenticateToken)` at the router level; `authorizeRole(['Admin'])` per-route.
- **Shared libs**: `shared-lib` is required via the build-time COPY pattern (same as okf-server). The document-repository imports `logger` + `dbService` from `shared-lib`.

### The document-repository codebase (exact patterns to mirror)

**App structure** (`src/app.js`): helmet → cors → trust proxy → compression → express.json({limit:'10mb'}) → express.urlencoded → `app.use('/api/files', fileRoutes)` → 404 → errorHandler. No `createApp()`.

**Route** (`src/routes/fileRoutes.js`): `router.use(authenticateToken)` covers all routes. Per-route: `router.post('/upload', authorizeRole(['Admin']), uploadSingle, validateFiles, fileController.uploadFile)`. The bundle route OMITS `uploadSingle` + `validateFiles` (the pipeline to bypass).

**ClamAV** (`src/services/securityService.js:83`):
```js
async scanBuffer(buffer) // returns { isInfected: boolean, viruses: string[] }
// Caller checks: if (scanResult.isInfected) throw new Error(`File contains virus: ${scanResult.viruses}`);
// If scanning disabled (appConfig.virusScanning === false): returns { isInfected: false } (no-op)
// Singleton: module.exports = new SecurityService()
```

**Dataprep handoff** (`src/controllers/fileController.js:975`):
```js
async _ingestFileById(fileId) {  // ← extend to _ingestFileById(fileId, graphName = null)
  const { file, base64String } = await this._getFileBase64(fileId);
  const dataprepUrl = `${config.dataprep.host}:${config.dataprep.port}${config.dataprep.ingestPath}`;
  const response = await axios.post(dataprepUrl, {
    fileId, fileName, fileType, fileLabels, storagePath, fileBase64,
    graphName  // ← NEW (7th key in the payload)
  });
  // ... update metadata on success
}
```

**File storage** (`src/services/fileService.js`): `fileUtils.generateUniqueFileId()` → `uploadDir` + `${fileId}${ext}` → `fs.writeFile` → `metadataService.addMetadata(filePath, fileRecord)` → `db.collection('files').save(metadata)`.

**`metadataService.updateMetadata` allowlist** (`src/services/metadataService.js:189`): `const allowedFields = ['dataprep', 'chunk_count'];` — any field NOT in this list is silently dropped. If `graphName`/`repoId` need to persist post-ingest, add them here.

**`authorizeRole`** (`src/middlewares/keycloak-auth-middleware.js:168`): `authorizeRole(allowedRoles)` → reads `req.user.role` (scalar) → 403 `FORBIDDEN` if not in list (case-insensitive).

### Upload pipeline: BYPASS vs KEEP

| Stage | Location | Decision |
|---|---|---|
| Multer (`uploadSingle`) | `middlewares/fileUpload.js` | **BYPASS** (don't mount on route) |
| `validateFiles` (magic-byte + extension) | `middlewares/fileUpload.js` → `utils/mimeTypeValidator.js` | **BYPASS** |
| Language detection (langdetect) | `fileService.uploadFile` | **BYPASS** |
| Text extraction (`_extractText`) | `fileService.uploadFile` | **BYPASS** |
| Single-base64 contract (dataprep payload format) | `fileController._getFileBase64` | **KEEP** (dataprep expects this) |
| `securityService.scanBuffer` (ClamAV) | `fileService.uploadFile:208` | **KEEP** (the whole point) |
| Disk write + `files` doc | `fileService.uploadFile:219-256` | **KEEP** |
| Size check | `fileService.uploadFile:198` | **KEEP** |
| `authorizeRole(['Admin'])` | route-level | **KEEP** |

### Architecture context (§8.2, §6 step 4, ADR-okf-008, ADR-okf-016)

The bundle route implements **Architecture §6 Step 4 (Store + scan)**:
> Bundle bytes routed through the document-repository new bundle route: storage + ClamAV + the `graph_name`. Malware → reject + audit.

**ADR-okf-008**: Reuse the document-repository as the bundle content + scan + handoff backend. The document-repository already provides disk storage, ArangoDB `files` collection, ClamAV `scanBuffer`, and dataprep handoff (`_ingestFileById`). The new route bypasses 4 pipeline stages (allowlist/magic-byte/langdetect/single-base64 text extraction) while keeping the other 4 (storage/scan/files-doc/handoff).

**ADR-okf-016**: Document-repository is the single source of truth for content after upload. The route writes bytes to disk + creates the `files` doc — this IS the source-of-truth record.

### Ownership boundary (what the route does NOT do)
- **PII redaction** (Presidio) — OKF Server's governance module (Story 2.8), NOT the bundle route.
- **Lifecycle status** (`review`, `draft`) — OKF Server (okf_repositories), NOT the files doc.
- **OKF metadata** (`okf_concepts_meta`) — OKF Server, NOT the document-repository.
- **Graph creation** — dataprep (Story 2.6, gated). The route SENDS `graph_name`; dataprep CREATES the graph.
- **Parser/conformance** — the route does NOT call `parseConcept` or `validateConcept` directly. Those are called by the OKF Server's ingest orchestrator (or the AI producer, Epic 7) BEFORE submitting to this route. The bundle route receives already-parsed content (or raw bytes that dataprep will chunk). If parsing is needed inline, that's a caller responsibility (the route's job is storage + scan + handoff).

### Inherited lessons from 2.1-2.4 reviews
Shared libs IMPORTED not copied · MELT on every method · all exceptions handled + logged · joi validation at boundary · snake_case responses · ITU copyright headers · package-lock committed · direct AQL (no ORM) · ESLint/Prettier clean.

### Out of scope
- Story 2.6 (dataprep reads `graph_name` + creates `OKF_{repo_id}` graph) — gated by OPEA 1.5 bump.
- Story 2.8 (PII redaction via Presidio) — ungated but separate.
- Epic 7 (AI producer) submits bundles through this route but is a separate consumer.
- Retract-by-repo (`_retractFileById` with `repo_id`/`bundle_version`) — noted in §8.2 but belongs to 2.6's retract path.

### References
- [Source: epics.md#Story-2.5] (AC verbatim)
- [Source: architecture.md#§8.2,§6-step4]
- [Source: docs/adr/okf-008-bundle-content-store.md] · [Source: docs/adr/okf-016-external-source-management.md]
- [Source: components/document-repository/src/controllers/fileController.js#_ingestFileById] (dataprep handoff — where graph_name is added)
- [Source: components/document-repository/src/services/securityService.js#scanBuffer] (ClamAV)
- [Source: components/document-repository/src/services/fileService.js#uploadFile] (storage pattern to mirror)
- [Source: components/document-repository/src/routes/fileRoutes.js] (route registration)
- [Source: components/document-repository/src/__tests__/routes/upload.test.js] (test mock stack)
- [Source: _bmad-output/project-context.md] (standards)

## Dev Agent Record

### Agent Model Used
_(filled during dev-story)_

### Debug Log References

### Completion Notes List

### File List
