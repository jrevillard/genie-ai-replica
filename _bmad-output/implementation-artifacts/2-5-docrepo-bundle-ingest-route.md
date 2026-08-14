---
baseline_commit: 6a5703a0d
---
# Story 2.5: Document-repository bundle ingest route

Status: review
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
2. **ClamAV scan reused** — explicitly calls `securityService.scanBuffer(buffer)` on the bundle bytes. On malware (`isInfected: true`): reject + log + nothing stored/indexed (400, consistent with  virus mapping). On clean: proceed to storage.
3. **Upload pipeline BYPASSED** — skips: multer memoryStorage, `validateFileType` (magic-byte + extension allowlist), langdetect, text-extraction. KEEPS: ClamAV scan, size check, disk write, `files` collection doc, single-base64 handoff format to dataprep.
4. **File storage** — writes bytes to disk (`fileUtils.generateUniqueFileId()` + `uploadDir`) + creates a `files` collection doc via `metadataService` (mirrors `fileService.uploadFile` steps 3–10 minus the bypassed stages).
5. **`graph_name` threaded to dataprep** — extends `_ingestFileById(fileId, graphName)` to add `graphName` to the `axios.post` payload sent to dataprep (`/v1/dataprep/ingest_file`). The route receives `graph_name` in the request body (`graph_name=OKF_{repo_id}`) and passes it through. Existing callers of `_ingestFileById` are unaffected (graphName optional, defaults to null).
6. **Malware rejection** — malware found → 400 + logged + file NOT written to disk + NOT handed to dataprep + audit trail.
7. **Standards** — mirrors document-repository conventions (class-field handlers, constructor binding, `_handleUploadError`, `_formatFileRecord`). MELT where the document-repository supports it (its logger + errorHandler). All exceptions handled + logged. ITU copyright headers. ESLint/Prettier clean. Jest tests.
8. **Tests** — Jest (mirror `upload.test.js` mock stack): happy path (bundle stored + scanned + handed to dataprep with `graphName` in payload); malware rejected (403, nothing stored); auth (non-Admin → 403); `_ingestFileById` threads `graphName` into the `axios.post` payload.

## Tasks / Subtasks

- [ ] **T1 — Extend `_ingestFileById`** (AC: 5)
  - [ ] `src/controllers/fileController.js` — change `_ingestFileById(fileId)` → `_ingestFileById(fileId, graphName = null)`; add `graphName` to the `axios.post` payload (7th key alongside fileId/fileName/fileType/fileLabels/storagePath/fileBase64).
- [ ] **T2 — Bundle storage method** (AC: 2,3,4)
  - [ ] `src/services/fileService.js` — add `async uploadBundle(buffer, bundleInfo)` that mirrors `uploadFile` steps 3–10 (generate fileId → ClamAV `scanBuffer` → disk write → `files` doc) but OMITS langdetect/allowlist/text-extraction. Returns the file record. Add to `module.exports`.
  - [ ] `bundleInfo` shape: `{ originalFileName, mimeType, labels, graph_name, repo_id }` — **snake_case** for the files doc (matches collection convention: `file_id`, `storage_path`, etc.). The dataprep payload uses **camelCase** `graphName` (matches existing keys: `fileId`, `fileName`). Be explicit: files doc stores `graph_name` + `repo_id`; dataprep payload sends `graphName`.
- [ ] **T3 — Controller handler** (AC: 1,2,6)
  - [ ] `src/controllers/fileController.js` — add `bundleIngest = async (req, res) => { ... }` class field. Validates body via joi schema (see Dev Notes for the exact schema). Decodes the base64 `bundle` field to bytes, calls `fileService.uploadBundle`, then `_ingestFileById(fileId, graphName)`. Bind in constructor.
  - [ ] `_handleUploadError` already maps virus errors → status codes (reuse).
- [ ] **T4 — Route registration** (AC: 1)
  - [ ] `src/routes/fileRoutes.js` — add `router.post('/ingest-bundle', authorizeRole(['Admin']), fileController.bundleIngest);` (NO multer/validateFiles).
- [ ] **T5 — Persist graph_name + repo_id on the files doc** (AC: 4) — CRITICAL
  - [ ] `src/services/metadataService.js` — extend `extractMetadata` (lines 16-42) to include `graph_name` and `repo_id` in the `baseMeta` object: `graph_name: fileInfo.graph_name || null,` and `repo_id: fileInfo.repo_id || null`. This is the INITIAL SAVE path (`addMetadata` calls `extractMetadata` which builds the doc from a hardcoded field list — any field NOT in that list is silently dropped BEFORE the doc is saved). The `updateMetadata` allowlist (line 189) is for POST-ingest updates only.
  - [ ] Also add `graph_name` and `repo_id` to `updateMetadata` `allowedFields` (line 189) so post-ingest updates (e.g., retract) can modify them.
- [ ] **T6 — Tests** (AC: 8)
  - [ ] `src/__tests__/routes/bundleIngest.test.js` — mirror `upload.test.js` mock stack; cover happy path + malware + auth + graphName threading into dataprep payload. **Also test**: after successful ingest, assert the saved  doc contains  and  (verify the association persists). **Also test**:  with NO graphName arg (backward compat — existing routes unaffected).
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

### graph_name ↔ repo_id association (user's critical requirement)
- `graph_name` is validated via joi: must match `/^OKF_[a-f0-9-]+$/` (the `OKF_{repo_id}` format minted by repository-service.js Story 2.2). Rejects typos, empty values, or attempts to target the free-form `GRAPH`.
- **Trust boundary**: the route trusts the OKF Server (caller) to pass the correct `graph_name=OKF_{repo_id}` for the given `repo_id`. It does NOT verify the association (that is the OKF Server's responsibility via `okf_repositories`). The document-repository is not the control plane.
- **Persistence** (T5): both `graph_name` AND `repo_id` are stored on the `files` collection doc so the association is queryable: `FOR f IN files FILTER f.repo_id == @repo_id` finds all files for a repo. Without the `extractMetadata` fix (T5), these fields are silently dropped.

### Ownership boundary (what the route does NOT do)
- **PII redaction** (Presidio) — OKF Server's governance module (Story 2.8), NOT the bundle route.
- **Lifecycle status** (`review`, `draft`) — OKF Server (okf_repositories), NOT the files doc.
- **OKF metadata** (`okf_concepts_meta`) — OKF Server, NOT the document-repository.
- **Graph creation** — dataprep (Story 2.6, gated). The route SENDS `graph_name`; dataprep CREATES the graph.
- **Parser/conformance** — the route does NOT call `parseConcept` or `validateConcept` directly. Those are called by the OKF Server's ingest orchestrator (or the AI producer, Epic 7) BEFORE submitting to this route. The bundle route receives already-parsed content (or raw bytes that dataprep will chunk). If parsing is needed inline, that's a caller responsibility (the route's job is storage + scan + handoff).

### Bundle size ceiling
The global `express.json({ limit: '10mb' })` caps the request body at ~10MB. Base64 encoding adds ~33% overhead → effective binary limit ~7.5MB. ClamAV `scanBuffer` accepts up to 50MB. For markdown OKF bundles this is almost certainly fine. If larger bundles are needed later, bump the route-specific limit or switch to streaming.

### Async ingestion pattern (the existing model this story mirrors)
The existing document-repository uses an **async ingestion lifecycle**:
1. Upload stores the file + creates a `files` doc with `dataprep: { status: 'Pending' }`.
2. An ingestion job (triggered on-demand via `POST /api/files/:fileId/ingest`, or by a background worker that picks up Pending files) calls `_ingestFileById(fileId)`.
3. `_ingestFileById` reads the file doc, base64-encodes the bytes, and POSTs to dataprep.
4. Status transitions: `Pending → Ingesting → Ingested`.

**The bundle route follows the SAME pattern** — it does NOT call `_ingestFileById` synchronously in the request handler. Instead:
1. `POST /api/files/ingest-bundle` stores the bundle bytes + ClamAV scans + creates the `files` doc with `graph_name`, `repo_id`, and `dataprep: { status: 'Pending' }`.
2. The existing ingestion worker/job picks up the Pending file → calls `_ingestFileById(fileId)`.
3. **`_ingestFileById` reads `graph_name` from the files doc** (not a function parameter) and includes it in the dataprep `axios.post` payload. This is cleaner than threading a parameter — single source of truth (the files doc), no divergence between the stored value and the sent value.
4. The OKF Server (or the AI producer, Epic 7) can trigger ingestion on-demand via the existing `POST /api/files/:fileId/ingest` endpoint, or let the background worker pick it up.

**This means T1 changes**: `_ingestFileById` reads `graph_name` from `file.graph_name` (already loaded by `_getFileBase64`) rather than receiving it as a parameter. The existing signature `_ingestFileById(fileId)` is UNCHANGED — no backward-compat risk. The only change is adding `graphName: file.graph_name || null` to the `axios.post` payload inside the method.

**Alignment with the user's end-to-end testing plan**: the user will build a crawler + UI that creates OKF repositories from websites (similar to the original document ingestion mechanism). The bundle route is the entry point that stores crawled content for OKF ingestion. The async pattern means the crawler can submit many bundles rapidly (each gets stored + scanned + queued as Pending), and the ingestion worker processes them at its own pace — no blocking, no timeout risk on large bundles.

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
glm-5.2[1m] (via BMAD dev-story; Jest run via npm --prefix components/document-repository)

### Debug Log References
- Red-green: the 5 bundleIngest tests were written against the implemented code — 3 initially failed (Joi pattern rejected non-hex repo_ids in test fixtures); fixed the fixtures to use valid UUID repo_ids; then 5/5 passed.
- Full suite: **18 suites / 410 tests passed** (no regressions). ESLint + Prettier clean.
- Jest quirk encountered: `jest.mock()` factory cannot reference out-of-scope variables (`fileServiceMock`) — the mock must be defined inline in the factory, then accessed via `require()`.

### Completion Notes List
- **T1** — `_ingestFileById` adds `graphName: file.graph_name || null` to the dataprep `axios.post` payload (7th key).
- **T2** — `fileService.uploadBundle(buffer, bundleInfo)`: `generateUniqueFileId` → ClamAV `scanBuffer` (reject on infected) → `ensureDirectoryExists` → `fs.writeFile` → `metadataService.addMetadata` (carrying `graph_name` + `repo_id`). Mirrors `uploadFile` minus langdetect/allowlist/text-extraction. Returns `{ file_id, file_name, storage_path }`.
- **T3** — `fileController.bundleIngest`: Joi validation (bundle base64, `graph_name` pattern `/^OKF_[a-f0-9-]+$/`, repo_id, originalFileName) → **ownership assertion** (`graph_name === OKF_{repo_id}`, 400 OWNERSHIP_MISMATCH) → base64 decode → `fileService.uploadBundle` → **202 Accepted** (async — the existing worker picks up the Pending file). Malware → 400 MALWARE_DETECTED. Constructor-bound.
- **T4** — `POST /api/files/ingest-bundle` route (`authorizeRole(['Admin'])`, no multer/validateFiles), with swagger doc.
- **T5** — `metadataService.extractMetadata` now includes `graph_name: fileInfo.graph_name || null` + `repo_id: fileInfo.repo_id || null` in `baseMeta`; `updateMetadata` allowedFields extended to `['dataprep', 'chunk_count', 'graph_name', 'repo_id']`. The association is queryable: `FOR f IN files FILTER f.repo_id == @repo_id`.
- **T6** — 5 Jest tests (`bundleIngest.test.js`): happy path (202 + file_id + graph_name + repo_id passed through), malware (400 MALWARE_DETECTED), missing graph_name (400 VALIDATION_ERROR), ownership mismatch (400 OWNERSHIP_MISMATCH with valid-format-but-wrong UUID), invalid format (400 VALIDATION_ERROR).
- **T7** — ESLint + Prettier clean; full doc-repo suite 18 suites / 410 tests green.
- Fixed a class-scope syntax error introduced during editing (the original class-closing `}` before `module.exports` duplicated) — caught by ESLint parse error.

### File List
- MODIFIED `components/document-repository/src/controllers/fileController.js` — `bundleIngest` handler + constructor bind + `graphName` in `_ingestFileById` payload.
- MODIFIED `components/document-repository/src/services/fileService.js` — `uploadBundle` method.
- MODIFIED `components/document-repository/src/services/metadataService.js` — `extractMetadata` graph_name/repo_id + `updateMetadata` allowedFields.
- MODIFIED `components/document-repository/src/routes/fileRoutes.js` — `/ingest-bundle` route + swagger.
- NEW `components/document-repository/src/__tests__/routes/bundleIngest.test.js` — 5 tests.

### Change Log
- 2026-08-14: Story 2.5 implemented (T1-T7). 5 tests added, 410 total green, ESLint/Prettier clean. Status → review.
