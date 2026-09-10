# OKF Import Scope — Enterprise Data Integration Gap Analysis & Course-Correction Input

**Author:** Enterprise data / RAG architecture review (Claude, at David's request)
**Date:** 2026-09-06
**Branch examined:** `feat/okf-server` (working tree, post `fb0d01c88`)
**Inputs:** Full read of the OKF PRD / architecture / epics + ADRs okf-001..035; code
surveys of `components/okf-server` (17 services, routes, worker), the crawler +
document-repository, and the OKF Studio frontend; the 2026-09-06 Auto-Curate and
UX-Onboarding specs; David's requirements statement + the external "Gemini blueprint"
(3-stage import wizard, source catalog, enrichment, commit router).
**Status:** **DECIDED 2026-09-06** — all 12 decision points and all 5 open questions
resolved with David in a structured interview (§8, §10); two deviations from the
author's recommendations were taken deliberately (DP-8 LLM client ownership; Q5
agent-readable sync status). Ready as direct input to a BMAD `correct-course` on the
OKF PRD and ADRs.
**Tagging convention (David, 2026-09-06):** every capability below is tagged —
**[LIVE]** = built and working on `feat/okf-server` · **[PLANNED]** = specced in
PRD/ADR/epics/spec docs but not yet built (citation given) · **[NOT PLANNED]** =
absent from ALL planning artifacts and ALL code (verified by search — see §1.2).
**David's stated concern is the [NOT PLANNED] set; [PLANNED] items are flagged as
planned and only summarized.**

---

## 0. Executive Summary

The OKF pipeline **spine is right and mostly built**: acquire → parse → enrich
(classify / label / link) → validate → review-by-exception → publish (version mint)
→ RAG ingest → retract, with PII gating, conformance gating, born-right graphs, and
the Studio wizard shell + full editor suite live. What exists today accepts exactly
**five creation inputs**: web crawl, zip-of-markdown, doc-repo text files, manual
authoring, and clone.

The gap David sensed is real, and it is concentrated in exactly three places:

1. **Acquisition breadth [NOT PLANNED].** No connector of any kind exists or is
   specced for: RSS/Atom feeds, REST/GraphQL API pull, SQL databases, data
   warehouses, SaaS collaboration tools (Confluence/Notion/SharePoint/Slack/Teams),
   or native spreadsheet/CSV/pptx/JSON sources. Verified: zero occurrences of these
   source types anywhere in the PRD, architecture, epics, or any of the 17 planning
   artifacts (§1.2).
2. **Recurrence [NOT PLANNED].** Every input today is a **one-shot manual import**.
   The `source.syncSchedule` field on repo creation is stored dead metadata
   (`validators/repository-validator.js` — persisted, no consumer). There is no
   scheduler, no delta detection, no sync run history. Feeds and API/DB sources are
   *inherently recurring* — without a sync model, they cannot be added coherently.
3. **Structured-source semantics [NOT PLANNED].** An OKF concept is a markdown
   knowledge unit. Nobody has decided what a database table, a spreadsheet sheet, a
   feed item, or a Slack channel *becomes*. Gemini's "treat each table as a distinct
   OKF Markdown file" is a category error as stated (row dumps destroy the efficiency
   mandate and the bounded Knowledge Hierarchy); the correct semantics
   (data-dictionary concepts, FK→`links[]`, row-group tables, item→concept) are
   proposed in §5.3 and need an ADR.

The recommended remedy is **not** a re-architecture: it is a **Source Adapter
Framework** bolted additively onto the two integration seams that already exist (the
crawl-dump → `crawl-conversion-service` seam, and the file-set →
`ingestRepoConcepts` seam), plus a **sync scheduler** generalizing the deferred
FR-1/FR-2 model, plus **connector governance** (egress classes, credentials,
quotas, PII-at-acquisition). Everything downstream — conversion, classification,
labels, links, lifecycle, publish gates, drain — stays untouched and source-agnostic.
This is FR-37's already-decided principle ("only the input adapter differs")
generalized from one source to a registry of them.

Three **live defects** were found during the review (§2.5): xlsx is accepted by the
document-repository but silently never text-extracted; the crawl API is single-seed
despite FR-33 being planned and the crawler library being array-capable; and
`maxExternalDepth` is accepted, persisted, and never read.

Four things from the Gemini blueprint are **deliberately rejected** (§3): vector-DB
commit targets (Pinecone/Milvus/pgvector — violates the single-store non-goal and
bypasses curation), the "commit router" duality, unbounded row/table ingestion, and
external-LLM-first enrichment.

---

## 1. Method & Evidence Base

### 1.1 What was reviewed

- **Planning artifacts** (`_bmad-output/planning-artifacts/`): PRD
  `prds/prd-okf-server-2026-07-15/prd.md` (FR-1..38), `architecture.md` (incl. the
  2026-08-13 course-correction §"End-to-end OKF architecture"), `epics.md` (Epics
  1–10), `okf-course-correction-2026-08-13.md`, `okf-studio-ux-design-2026-08-13.md`
  (+ 2026-08-18 amendments), `auto-curate-pass-2026-09-06.md`,
  `okf-ux-onboarding-proposal-2026-09-06.md`, `label-onboarding-design-2026-08-13.md`,
  sprint-status `implementation-artifacts/sprint-status-okf-server.yaml`.
- **ADRs**: all 36 `docs/adr/okf-*`; deep-read of okf-016/019/021/030/031/033/034/035.
- **Code** (`feat/okf-server` working tree): `components/okf-server` (all 17
  services, routes, controllers, worker, validators, tests),
  `components/document-repository` (upload/allowlist/magic-byte/extraction,
  `crawler.js`, `crawlWorker.js`, `pageProcessor.js`, bundle ingest route),
  `components/gov-chat-frontend` OKF surfaces (`components/okf/*` incl.
  `StudioWizard`, all 10 wizard steps, the 13-component editor suite, services,
  Vuex `okf` module).

### 1.2 Verification of the [NOT PLANNED] claims

Greps across the **entire** planning set (`_bmad-output/planning-artifacts/**`) and
the PRD/architecture/epics for: `rss | atom feed | confluence | notion | slack |
sharepoint | snowflake | bigquery | jdbc | odbc | sql server | mysql | postgres* |
spreadsheet | pptx | powerpoint | csv` return **zero** planning mentions of any of
these as OKF import sources. The only hits: FR-37's generic "spreadsheets" (as
uploaded documents) and one epics.md benefit line. The single SaaS-ish mention in
the whole artifact set is the **SST stream ingestor** in
`team-briefing-agentic-enablement.md` — a different initiative (agent tools), not
OKF import. Code-side, `components/okf-server` has no outbound integration except
document-repository, dataprep, the Presidio sidecar, vLLM (manifest summaries
only), and Keycloak.

---

## 2. Current State (verified, tagged)

### 2.1 The import pipeline spine — **[LIVE]**

The write path specified in ADR-okf-021 is implemented and smoke-proven
(2026-09-01 full-drain E2E):

| Stage | Implementation | Status |
|---|---|---|
| Crawl → repo conversion (mode A mega-concept / mode B per-page) | `okf-server/services/crawl-conversion-service.js` — streaming download (10 GB cap), `## Source:` split, two-pass cross-link rewrite → frontmatter `links[]` born at creation, `index.md` root, URL-segment titles, 202 + live `repo.conversion` progress | **[LIVE]** |
| Zip-of-`.md` bundle import | `POST /repos/:id/import` (`controllers/repository-controller.js`) — `zip` base64 / `concepts[]` / `file_ids[]` / `discover:true`; adm-zip, junk filter, zip-bomb guard (25 MiB), 200-concept cap; non-`.md` entries **silently filtered** | **[LIVE]** |
| Per-concept import pipeline | `ingest-service.ingestRepoConcepts()` — parse (gray-matter) → meta UPSERT (`index_status='parsed'`) → conformance (hard errors → `rejected`) → Presidio PII (fail-closed) → content-hash dedup; nothing chunked at import | **[LIVE]** |
| RAG drain worker | `workers/ingestWorker.js` — ArangoDB-rows-as-queue poll loop (no Redis — decision D-D), `OKF_INGEST_CONCURRENCY` lanes, armed only by the lifecycle ingest transition, sweeper + reaper | **[LIVE]** |
| Lifecycle / versioning / manifest | `lifecycle-service.js` (submit/approve/publish/ingest/retract, building-blocker, read-only-while-serving), `version-service.mintVersion()` (INSERT-only `okf_versions`), `okf_bundle_manifest`, born-right `OKF_<slug>_vN` serving graphs | **[LIVE]** |
| Resplit (A/B) | `ingest-service.resplitRepo()`; **mode C (LLM topic extraction) → `400 MODE_NOT_IMPLEMENTED`** | **[LIVE, C stubbed [PLANNED]]** |
| Clone | `repository-service.cloneRepository()` — metadata-only fork, isolation smoke-asserted | **[LIVE]** |
| Bundle export | `bundle-export-service.exportBundle()` at publish (`<name>-v<N>.zip`) | **[LIVE]** (Git-push export **[NOT PLANNED]** — acceptable) |

### 2.2 Enrichment / curation state

| Capability | Status |
|---|---|
| Heuristics type inference (`topic/entity/process/event/source`) | **[LIVE]** — `type-inference-service.inferTypeHeuristics()`, deterministic, zero LLM; explicit authorial types never clobbered |
| LLM / hybrid classification | **[PLANNED]** — payload key `classification` exists on both creation routes and coerces to heuristics; `resolveStrategy()` returns `heuristics-fallback`; un-stubbing = Auto-Curate **AC-5** (blocked on the okf-server↔vLLM client decision; recommended shape: a small classify endpoint on dataprep) |
| Labels → RAG (`ingest_labels` → worker `fileLabels` → chunk labeling) | **[LIVE]** — `composeIngestLabels()` single authority; re-composed on every frontmatter patch |
| KH L2 label candidates bounded to Subject Area, label onboarding wizard (Epic 9), pre-ingest gap analysis | **[PLANNED]** — Epic 9.1–9.5 all backlog; no label-candidate/gap code in okf-server |
| Auto-Curate Pass (mechanical fixes, coverage score, review-by-exception queue) | **[PLANNED]** — approved spec 2026-09-06 (AC-1..AC-5), sequenced after David's re-import readiness test |
| Links born at creation (body/wiki/relations → `links[]`) | **[LIVE]** — `parser-service.extractWikiLinks()/extractLinks()`, `relations` frontmatter, crawl cross-link rewrite; edges materialize post-index (`edge-service.js`) |
| Trust/staleness/provenance families (v0.2) | **[LIVE]** at parse/meta; retrieval surfacing **[PLANNED]** (ADR-026 denormalization, Epic 1 — bump-gated) |

### 2.3 Studio frontend state

| Surface | Status |
|---|---|
| Studio tab + dashboard + wizard shell + all 10 steps (`StudioTab/StudioDashboard/StudioWizard` + `steps/{Entry,Choose,Input,Produce,LabelOnboard,Curate,Validate,Autocorrect,Review,Publish}.vue`) — hosted as the `studio` tab inside `AdminDashboard.vue` (no OKF routes/views, by design) | **[LIVE]** shell — **sprint-status yaml (2026-08-19) is stale**; the wave landed |
| Step 0 Entry (name + Subject Area picker) / Step 1 Choose (4 cards: Documents / Website crawl / Manual / Clone, i18n'd) | **[LIVE]** |
| Step 2 Input | **[PLACEHOLDER]** — self-declared: "Phase 4 wires the selection UI". The AdminDashboard "Create OKF repository" button (gated on selection, `okf_repo_id` stamp check) opens the wizard with documents preloaded — the flow stops here |
| Step 3 Produce | **[PLACEHOLDER]** — "Phase 6 wires this to the producer service" (`studioService.fetchProducerJob/killProducerJob` exist unused) |
| Step 4 LabelOnboard | **[LOCAL-ONLY]** — chips add/remove in local state; the save path (`okf/updateLabels`) is optimistic-only/NOT_READY; Epic 9.3 backend absent |
| Step 5 Curate + full editor suite (`RepoEditorShell/RepoEditor/ConceptEditor/ConceptList/RepoGraphView/VersionsDialog/LogsDialog/ResplitModal/BuildProgressCard/AddConceptModal/AutocorrectPanel/...`) | **[LIVE]** — incl. live-mode bar + markdown toolbar (`fb0d01c88`), fcose graph view (link projection), KH-bounded label selects, frontmatter edit form with server-side merge, autosave + body-only PATCH |
| Step 6 Validate | **[LIVE data, PLANNED live-validation]** — renders health ring + issue groups from the real autocorrect dry-run / `index_status` / repo metrics; the per-concept live `conceptService.validate/validateFormatting` calls are **NOT_READY** stubs |
| Step 7 Autocorrect (wizard) | **[PLACEHOLDER]** ("Story 10.2"); real frontmatter autocorrect dry-run/apply exists only in the editor's `AutocorrectPanel` |
| StudioTab create dialog (name + Subject Area + zip-bundle import with `classification` select) | **[LIVE]** |
| Crawl→OKF entry (crawler UI footer → `crawlerToOkfService` → `convert-from-crawl` 202 → `repo.conversion` polling) | **[LIVE]** — incl. split-mode A/B + Subject Area + classification radios |
| Clone creation in UI | **[PLANNED-WIRING]** — backend + `repoOkfService.clone()` live, Choose card exists, but **no UI caller** (unit test only) |
| Wizard draft persistence (`PUT /okf/studio_drafts/:id`) | **[PLANNED]** — endpoint 404s until server Story 10.5; step state is in-memory only |
| Documents path UI (doc picker / dropzone in wizard) | **[PLANNED]** (Story 3.6 / Input step Phase 4) |
| Label-onboarding wizard UI (server-backed) | **[PLANNED]** (Epic 9.3) |
| Frontmatter panel | **[VERIFY]** — 2026-09-06 UX audit found a dead "Frontmatter" mode bar (rendered nothing); the editor's frontmatter *edit form* is functional and the mode bar + toolbar landed in `fb0d01c88` — confirm the dead-bar defect is closed or remove the remnant |
| i18n for all OKF copy | **[LIVE keys / PENDING translations]** — `okf.*` key sets present in all 14 locales (consistency test enforces parity) but the 13 non-English locales each carry **184–192 `__TODO_TRANSLATE__` placeholders** |

### 2.4 Source support matrix — Gemini catalog vs. OKF today

| Gemini source | OKF status | Notes |
|---|---|---|
| Documents: pdf / docx / txt / md | **[PLANNED]** (FR-37, Story 7.7, backlog) via doc-repo extraction | Extraction itself **[LIVE]** in doc-repo (`pdf-parse`, `mammoth`, text/*); the OKF documents *workflow* (select → produce → drafts) is not built |
| Documents: **xlsx / spreadsheets** | **[BROKEN-PLANNED]** | doc-repo **accepts** `.xlsx` by extension but `_extractText()` has **no xlsx branch — silently extracts `''`**; no `xlsx/exceljs/papaparse` dependency exists. FR-37 lists xlsx, so this is a planned path sitting on a broken foundation (§2.5 GAP-D1) |
| Documents: **csv / json** | **[NOT PLANNED]** | Rejected by doc-repo extension allowlist (`appConfig.js`: `.pdf .docx .xlsx .md .html .txt` only); no OKF mention |
| Documents: **pptx** | **[NOT PLANNED]** | Not accepted, not specced |
| Documents: **html files** | **[LIVE, LOSSY]** | Accepted + tag-stripped in doc-repo (regex strip, loses structure/links); okf-server file discovery admits `text/html`. Not the crawler's Turndown path — uploaded HTML loses the link graph |
| Web crawl / scraped markdown | **[LIVE]** | Multi-page, link-preserving, conversion with born-right links. Caveats: single-seed API (§2.5), no JS rendering (axios+cheerio), external pages not followed (`maxExternalDepth` dead) |
| **RSS / Atom feeds** | **[NOT PLANNED]** | Zero mentions anywhere |
| **API endpoints (JSON/XML)** | **[NOT PLANNED]** | Zero mentions anywhere |
| **SaaS tools (Slack/Teams/Confluence/Notion/SharePoint)** | **[NOT PLANNED]** | Zero mentions anywhere; external *catalog exporters* (Dataplex/Collibra) are explicitly excluded by ADR-okf-019 — but Confluence/Notion *content spaces* were never considered either way |
| **RDBMS (PostgreSQL/MySQL/SQL Server)** | **[NOT PLANNED]** | FR-1/FR-2 (deferred) cover **Git/S3 only**; ADR-okf-016's source model is Git/S3 only |
| **Data warehouses (BigQuery/Snowflake)** | **[NOT PLANNED]** | Zero mentions; also a sovereignty question by default |
| **Relational → concepts semantics** (schemas, data dictionaries) | **[NOT PLANNED]** | No ADR, no story, no FR |
| Spreadsheets → concepts semantics (tables, row groups) | **[NOT PLANNED]** | FR-37 treats xlsx as a flat text document |
| Recurring sync / delta detection / refresh | **[NOT PLANNED]** (FR-2 deferred = one-shot + reachability only, and even that unbuilt; `syncSchedule` dead metadata) | |
| Batch categorization rules / import defaults | **[NOT PLANNED]** | Closest planned relative: Auto-Curate AC-3 label pre-assignment (per-repo, post-import) — not per-source declarative rules |
| LLM frontmatter tagging (enrich) | **[PLANNED]** (AC-5; internal vLLM per ADR-020) | Gemini's Gemini-Flash/Haiku default = rejected (§3) |
| Visual frontmatter editor (split view) | **[PLANNED-FIX]** | FR-25 editor is live; the frontmatter *panel* is dead UI (§2.3) |
| Markdown bundle exporter | **[LIVE]** | `exportBundle()` at publish; zip download |
| "Database collection syncer" (Pinecone/Milvus/pgvector) | **[NOT PLANNED — RECOMMEND EXPLICIT REJECTION]** | Violates single-store non-goal; bypasses curation/publish gates (§3) |
| Git-repo push (export side) | **[NOT PLANNED]** | Acceptable omission; note as deliberate |

### 2.5 Live defects & risks found during this review

| # | Finding | Severity |
|---|---|---|
| **D1** | **xlsx accepted but never extracted** — `document-repository/src/services/fileService.js:_extractText()` handles pdf/docx/text only; `.xlsx` passes the allowlist and uploads "successfully" with empty text. Silent data-quality trap for the planned FR-37 path. | High (blocks FR-37 for xlsx) |
| **D2** | **Crawl API is single-seed** — `scheduleCrawlSchema` requires one `url`; `Crawler.crawl()` is array-capable (`crawler.js:345–370`); FR-33/Story 7.6 multi-seed is planned but not exposed. | Medium |
| **D3** | **`maxExternalDepth` is dead config** — validated + persisted (`fileController.js:118`), never read by `crawler.js`. Either wire it or remove it (no dead controls — UX principle applies to config too). | Low |
| **D4** | **Uploaded-HTML extraction is lossy** — regex tag-strip instead of the crawler's existing Turndown+cheerio pipeline (`pageProcessor.js`); uploaded HTML loses headings/tables/links that the crawl path preserves. | Medium |
| **D5** | **No JS-rendered crawling** — axios+cheerio only; SPA intranets/portals (common enterprise case) crawl empty. Gemini proposes Playwright — real decision needed (§5.3, DP-7). | Medium (scope-dependent) |
| **D6** | **Table-heavy chunk/label degradation** — known pipeline behavior (DEBUGGING-TRACING §6.5: table-row chunks → low label recall). Any spreadsheet/DB/table import multiplies this. Needs a table-aware chunking validation gate before structured imports scale (Epic 8 fixtures). | High (gates wave 3) |
| **D7** | **PII is scanned at OKF import + publish gate, not at doc-repo upload** — fine for files, but SaaS/message-channel sources raise the stakes; PII-at-acquisition must be explicit in the connector contract. | Medium (gates wave 4) |
| **D8** | **OKF i18n translations pending** — the 13 non-English locales each hold 184–192 `__TODO_TRANSLATE__` placeholders for `okf.*` keys (keys exist everywhere; translations do not). Blocks the "everything is i18n" UX principle for shipped surfaces. | Medium |
| **D9** | **Wizard draft state is volatile** — `PUT /okf/studio_drafts/:id` 404s (server Story 10.5 unbuilt); step state lives only in the Vuex store. | Medium |
| **D10** | **Clone is a UI orphan** — backend + service method + Choose card exist, but no component invokes clone. | Low |
| **D11** | **Live per-concept §11 validation absent from the editor** — `conceptService.validate/validateFormatting` throw NOT_READY; Curate falls back to client-side heuristics only. | Medium |

---

## 3. Critique of the Gemini Blueprint (adopt / adapt / reject)

The blueprint's shape — *Connect & Parse → Enrich & Standardize → Commit to Target* —
is broadly right, and largely **already exists here under different names**:
Connect&Parse = our acquisition + conversion; Enrich = our classification + labels +
links + Auto-Curate; Commit = our publish (version mint). What it gets wrong is the
**commit semantics** and the **default posture**.

**Adopt (fits, extends what exists):**
- The source-catalog ambition and the four functional categories (documents /
  feeds & APIs / SaaS / databases) — exactly the [NOT PLANNED] set.
- **Batch categorization rules** → becomes **Import Profiles** (§5.5): per-source
  declarable defaults (type, tags, KH-L2 label hints, Subject-Area pre-fill,
  stale_after template) applied at conversion and reviewable in the work queue.
  Small, high-leverage, rides Auto-Curate.
- Table preservation as markdown tables (with our D6 gate).
- Split-screen parsed-document vs. frontmatter review → already surpassed by the
  planned review-by-exception work queue (AC-2) — adopt the *intent*, not a new UI.

**Adapt (right idea, wrong default for GENIE):**
- "Lightweight LLM (Gemini Flash / Claude Haiku)" → internal vLLM granite by
  default (ADR-okf-20 sovereignty); external tier stays the explicit opt-in. Already
  decided — the blueprint must not reopen it.
- "Poll endpoints asynchronously / JDBC pull" → must run as **governed, scheduled
  sync jobs producing versioned draft updates** inside our six-step contract — never
  live query-time fetch (ADR-okf-016's runtime-egress prohibition extends naturally).
- "Treat each table as a distinct OKF file" → **data-dictionary concepts**, FK
  relationships as the author `links[]` graph, optional capped sample tables — not
  row dumps (§5.3).

**Reject (violates decided constraints):**
- **"Database Collection Syncer" (Pinecone/Milvus/pgvector) + "commit router"** —
  single data store = ArangoDB (PRD §9 non-goal, "no new vector DB"); worse, writing
  straight to a vector collection **bypasses curation, PII gating, conformance,
  publish versioning** — the exact "garbage in" failure the Studio exists to
  prevent. The course correction should record this as an explicit non-goal.
- **Unbounded ingestion** (every row/message/item = concept) — violates the
  efficiency mandate ("imports must NOT take fucking hours"), the bounded KH, and
  counter-metric SM-C1. Caps + steward-chosen scoping everywhere.
- **SaaS-first ordering** — GENIE's deployments are sovereign/public-sector:
  files → web → feeds/internal APIs → databases → SaaS-egress last (§7).

---

## 4. Gap Register (deduplicated, ranked)

Severity: **P0** = blocks the enterprise-integration objective structurally ·
**P1** = blocks a source class · **P2** = quality/security risk on a source class ·
**P3** = polish/completeness. Tag: `[NP]` not planned · `[PL]` planned (gap = not
built) · `[LV]` live defect.

| # | Gap | Tag | Sev | Fix locus |
|---|---|---|---|---|
| G1 | **No source-adapter framework** — no registry, no adapter contract, no staging normalization; each future source would hand-roll plumbing | [NP] | **P0** | New ADR-okf-036 + Epic 11 (§5) |
| G2 | **No recurrence machinery** — scheduler, sync runs, delta detection, sync history, failure backoff; `syncSchedule` dead metadata | [NP] | **P0** | Generalize deferred FR-1/FR-2 → FR-41 + ADR-okf-016 amendment |
| G3 | **No connector governance** — egress classes/opt-in flags, credential vault refs, per-source quotas/cost attribution (G36), PII-at-acquisition, sync audit | [NP] | **P0** (gates all egress sources) | New ADR-okf-037 + FR-40 |
| G4 | **Structured/tabular → concept semantics undecided** (spreadsheet sheets, DB tables, feed items, message channels) | [NP] | **P0** | New ADR-okf-038 + FR-42 (§5.3) |
| G5 | **Feeds (RSS/Atom) unsupported** — no fetch, no item→concept mapping, no GUID dedup, no stale_after derivation | [NP] | P1 | Feed adapter (Epic 11) |
| G6 | **API pull unsupported** (JSON/XML snapshots, pagination, auth) | [NP] | P1 | API adapter (Epic 11) |
| G7 | **Database / warehouse import unsupported** (read-only information-schema → data dictionaries; FK→links) | [NP] | P1 | DB adapter (Epic 11; Postgres-first, sovereign) |
| G8 | **SaaS connectors unsupported** (Confluence/Notion/SharePoint/Slack/Teams) | [NP] | P1 (deliberately last) | SaaS adapters behind Class-2 egress opt-in |
| G9 | **csv/json/pptx not accepted anywhere**; xlsx accepted-but-broken (D1) | [NP]/[LV] | P1 | File-breadth adapters + xlsx table extraction (the table adapter IS the xlsx fix) |
| G10 | **Documents workflow (FR-37/7.7) unbuilt** — doc-repo extraction exists, the select→produce→draft flow does not | [PL] | P1 | Story 7.7 — fold into the framework as the Class-0 "documents adapter" (§5.6) |
| G11 | **Import Profiles / per-source categorization defaults** absent | [NP] | P1 (high leverage) | FR-43; rides Auto-Curate queue |
| G12 | **Uploaded-HTML lossy extraction** (D4) — should reuse the crawler's Turndown pipeline | [LV] | P2 | doc-repo: route html through pageProcessor's converter |
| G13 | **No JS-rendered crawling** (D5) — SPA sites yield empty crawls | [NP] | P2 | Decision DP-7 (Playwright sidecar vs. defer) |
| G14 | **Multi-seed crawl not exposed** (D2, FR-33 planned) | [PL] | P2 | Small API + UI change (7.6) |
| G15 | **Table-aware chunking/labeling unvalidated** (D6) — gates spreadsheet/DB imports | [NP] | P2 | Epic 8 fixtures + chunking eval gate |
| G16 | **Wizard middle unbuilt**: Input + Produce + Autocorrect steps placeholder, LabelOnboard local-only, draft persistence 404s (Story 10.5), clone UI unwired, live concept validation NOT_READY, i18n translations pending (D8–D11) | [PL] | P2 | Stories 3.4-Phase4/6, 10.2, 10.5, UX-2/UX-3 slices, i18n pass |
| G17 | **LLM/hybrid classification stubbed** (AC-5) — needed by LLM enrichment of noisy enterprise sources | [PL] | P2 | AC-5 (dataprep classify endpoint decision) |
| G18 | **Mode C resplit (LLM topic extraction) stubbed** — the most source-agnostic segmentation tool for messy enterprise text | [PL] | P3 | Story 10.6 |
| G19 | `maxExternalDepth` dead config (D3) | [LV] | P3 | Wire or remove |
| G20 | **Bundle export** exists only as publish side-effect; no "download current draft as OKF bundle" for portability/external tooling | [NP] | P3 | Small: generalize `exportBundle()` |

---

## 5. Proposed Architecture — the Source Adapter Framework

### 5.1 Principle: adapters end at the staging seam

A connector's job **ends** when it has produced a **staged source artifact** — a
retained, versioned artifact set in the document-repository (exactly ADR-okf-016's
tier-2 "retained truth"). Two staging seams already exist and are generalized:

```
                       ┌────────────────────────────────────────────────────────┐
 Source classes         │  ACQUISITION (new — Epic 11)                          │
 ────────────────►      │  connector registry → adapter run (fetch/parse)       │
 files (pptx/csv/json)  │    → staged artifacts in doc-repo (files, dumps)      │
 feeds (RSS/Atom)       │    + source manifest (provenance, run, delta)         │
 APIs (JSON/XML)        │    + PII-at-acquisition scan (Presidio, fail-closed)  │
 DBs / warehouses       └──────────────────┬─────────────────────────────────────┘
 SaaS (opt-in)                             │  (existing, unchanged)
                                           ▼
                       CONVERSION per source type (pattern: crawl-conversion-service)
                         segment → derive frontmatter → resolve links[] → classify
                                           ▼
                       ingestRepoConcepts (4a–4g: parse→meta→conformance→PII→dedup)
                                           ▼
                       CURATE (editor, Auto-Curate, labels, Import-Profile hints)
                                           ▼
                       VALIDATE → REVIEW → PUBLISH (mintVersion) → RAG INGEST → RETRACT
```

Downstream of staging, **nothing changes**: lifecycle, gates, labels
(`composeIngestLabels`), KH bounding, publish-before-ingest, worker drain, born-right
graphs. This is FR-37's decided "source-agnostic producer core, only the input
adapter differs" — promoted from a principle to a framework.

### 5.2 Framework components (new, all in okf-server unless noted)

1. **Connector registry** (`services/connectors/registry.js` + Arango
   `okf_connectors`): declarative adapter manifests — `{id, category, egress_class,
   config_schema (joi → auto-generated Studio form), credential_refs, quotas,
   enabled}`. Registered adapters appear in the Studio source catalog; unregistered
   = invisible. Registry flags are the single source of truth for UI availability
   badges.
2. **Adapter interface** (`services/connectors/adapter.js` contract):
   `run(config, credentials) → { staged_files[], source_manifest, delta }` — pure
   acquire+normalize; **no OKF concept logic inside adapters** (anti-scope-creep
   rule from Epic 10 applies).
3. **Per-source converters** (pattern: `crawl-conversion-service.js`): feed-item →
   concept; sheet/table → concepts; schema → data-dictionary concepts; html upload →
   Turndown markdown. Converters own semantics; adapters own transport.
4. **Sync scheduler** (`workers/syncWorker.js`, crawlWorker-pattern poll loop):
   reads registry schedules → runs adapters → computes **delta** (content-hash per
   item vs. last sync — same SHA-256 idempotency as FR-2/NFR-S4) → stages **draft
   sync update** concepts into the repo (never auto-publish; feeds respect the
   six-step contract; per-run audit + backoff + degraded-health surfacing).
5. **Import Profiles** (part of the connector config + repo defaults): declarative
   `{default_type, tags[], label_hints[] (KH L2 under the repo's Subject Area),
   description_template, stale_after_template}` — applied at conversion, surfaced as
   pre-filled proposals in the Auto-Curate work queue (AC-2 UI), never silently.
   **DP-9 resolved: v1 = defaults only — no conditions, no rules engine.**
6. **Governance gates** (ADR-okf-037): egress classes below; credentials referenced
   from `.env`/vault only (FR-1 rule generalized); per-source quotas (items/pages/
   rows/concepts per run — closes course-correction G36 for connectors); sync runs
   audited; staged artifacts PII-scanned before concept drafting; **every adapter
   stamps frontmatter `sources[]` provenance, and Class 2 connectors carry a
   license/access-basis field before their first sync (Q4)**.

**Egress classes:**
- **Class 0 — user-provided files** (uploads, bundles): no egress; default-on.
- **Class 1 — internal network endpoints** (internal REST APIs, the deployment's own
  Postgres/Arango, intranet sites): allowed by default in sovereign deployments;
  still credential-governed + audited.
- **Class 2 — external internet** (external feeds/APIs, SaaS, warehouses): **off by
  default**, enabled per-connector behind an explicit opt-in flag mirroring
  `LLM_EXTERNAL_EGRESS_ENABLED` (e.g. `OKF_EGRESS_FEEDS=1`, `OKF_EGRESS_SAAS=1`);
  fail-closed; air-gap validation covers it (NFR-S1/SM-5 unchanged).

### 5.3 Source-class semantics (DECIDED with David 2026-09-06 — the ADR-okf-038 meat)

| Source | Concept semantics (DECIDED) | Notes |
|---|---|---|
| **Spreadsheet (xlsx/csv)** | Per **sheet**: 1 *data-dictionary concept* (title, purpose, column table: name/inferred type/sample) + N *data concepts* = row-groups rendered as markdown tables (cap ~200–500 rows/concept, configurable), split on natural keys; `links[]` between dictionary ↔ its data concepts; Import-Profile `stale_after` for time-series sheets | DP-3 resolved: dictionary + row-groups. Rows are NOT concepts. Dictionary-first mirrors how people actually ask about spreadsheets ("what does column X mean", "what was the 2025 value of Y") |
| **RDBMS / warehouse (read-only)** | Information-schema → per-table *data-dictionary concepts*; **FK relationships become the author `links[]` graph** (the DB's own structure is its knowledge graph — the crawl cross-link analogue); optional capped sample-rows table per table (steward opt-in per table); views/metrics get `type: process`/`source` candidates | DP-4 resolved: dictionaries + FK→links + opt-in samples; **no row-dump mode ever**. Read-only credentials. Postgres first (sovereign, already in stack); MySQL/SQL Server drivers additive; warehouses = Class 2 |
| **RSS/Atom feed** | Item → concept: `type: event` (news/updates) or `source`; `generated.at` from pubDate; `title`/`summary` from feed fields; body = content text; GUID/URL content-hash **dedup across syncs**; `sources[]` stamped with license/access-basis when declared | DP-5 resolved: every sync stages **drafts** — no auto-publish. Q2 resolved: **retention set by the steward per repo at creation** (no deletion-by-age default); `stale_after` marks aging items. The first *recurring* source: exercises the scheduler + delta path end-to-end |
| **API endpoint (JSON/XML)** | v1: snapshot pull → mapping template (JSONPath → concept fields) OR generic document-per-item fallback; pagination + item caps; auth headers/keys from vault | Internal APIs (Class 1) before external (Class 2) |
| **SaaS — Confluence/Notion/SharePoint** | Page/space → concept via the **existing html→markdown Turndown pipeline** (pageProcessor reuse); space hierarchy → `index.md` TOC; page links → `links[]` (identical to crawl resolution) | Class 2; OAuth/pat tokens in vault; license/access-basis required before first sync (Q4) |
| **SaaS — Slack/Teams** | Channel → **bounded daily-digest concepts** (type: `event`), never raw messages; heavy Presidio (D7); quotas tight | Class 2; lowest priority — explicitly deferred-able per deployment (DP-6) |
| **pptx** | Deck → concept per deck (+ optional per-section split): slide-outline headings, body text, speaker notes; slide→slide refs as weak `links[]` | Small adapter; unblocks QBR/training-material use case |
| **html upload** | Uploaded HTML through the crawler's Turndown+cheerio path (fixes D4) → concept per file, links resolved against the repo's concept set | Reuse, not new code |
| **Email / mailing lists** | **Deferred — catalog note only (Q3):** future Class 0/2 adapter (mbox/eml upload first, IMAP connector later); listed in the roadmap, built in a later initiative | Not in this initiative's scope |
| **Crawler (existing)** | Multi-seed exposure (G14); `maxExternalDepth` wire-or-remove (G19); **Playwright/JS-rendering deferred — SPA limitation documented** (DP-7) | |

### 5.4 Studio UX extension (most-usable-first; UX-Onboarding principles govern)

1. **Choose step becomes a source catalog** — the 4 cards grow into grouped
   categories (*Your files · The web · Feeds & APIs · Databases & business systems*),
   driven by the connector registry: unavailable cards render disabled **with the
   reason** ("External connectors are switched off on this deployment" /
   "Ask your administrator to enable database import") — guardrails-before-errors,
   and the availability truth is server-side, not hardcoded UI.
2. **Input step (Phase 4) renders adapter config forms declaratively** from each
   adapter's joi schema (DS form primitives; same pattern for every source — zero
   per-source bespoke UI). Every field carries intent copy per the UX proposal
   ("What does this connect to? Nothing is published — you review everything
   first").
3. **Schedule control** — "One-time import (default) | Keep updated: every N
   days/hours", with consequence copy ("Each refresh adds only what changed, as a
   draft you approve"). Sync state surfaces on the repo details **Sources & Sync
   tab** (last run, delta counts, errors, next run, quota usage).
4. **Import Profiles editor** — per-source defaults screen, framed as "rules that
   save you labeling time" with the live KH-L2 hint picker bounded to the repo's
   Subject Area.
5. **Post-import report extension** — the AC-1 report gains source-stats (items
   fetched, delta vs. previous, skipped + why) — partial-failure framing per UX §F.
6. All copy ×14 locales; DS primitives only; every action's RAG outcome stated.

### 5.5 What deliberately does NOT change

Lifecycle and gates (publish-before-ingest), `composeIngestLabels` sole-injector
rule, KH bounding (L1 Subject Area / L2 labels), bounded label growth (FR-36),
PII publish gate, ArangoDB-only storage, Redis-free worker pattern, born-right
graph naming, the free-form single-document flow, and the existing crawl path.

### 5.6 Relationship to planned work (fold, don't fork)

- **FR-37 documents path (Story 7.7) becomes the framework's Class-0 flagship
  adapter** — uploads already stage in doc-repo; its converter is the
  extraction→segment→draft logic already specced. Building it inside Epic 11 avoids
  a throwaway.
- **Auto-Curate AC-3** (bounded label pre-assignment) consumes Import-Profile hints
  for every source — one matcher, many sources.
- **Epic 9 label onboarding** is source-agnostic by design — untouched.
- **Epic 8 test infra** gains two fixture classes: table-heavy corpus (D6 gate) and
  a deterministic local RSS fixture (scheduler/delta tests).

---

## 6. PRD / ADR Impact Register (for the correct-course)

**New FRs:**
- **FR-39 Source Adapter Framework** — registry, adapter contract, staging seam,
  per-source converters; adapters end at staged doc-repo artifacts; registry drives
  Studio availability.
- **FR-40 Connector governance** — egress classes 0/1/2 with per-class opt-in flags
  (fail-closed), vault-referenced credentials, per-source quotas + cost attribution,
  PII-at-acquisition, sync audit, **provenance stamping (`sources[]`) with a
  mandatory license/access-basis field for Class 2 connectors before first sync**.
- **FR-41 Recurring sync & delta drafts** — scheduler, content-hash delta, draft
  sync updates under the six-step contract (**never auto-publish — DP-5**), sync
  history + degraded-health surfacing, **steward-set retention prompt at feed-repo
  creation (Q2)**. Supersedes the FR-1/FR-2 deferral note (Git/S3 become just two
  adapters on this machinery; the FR-1/FR-2 capability text is retired into it).
- **FR-42 Structured & tabular source semantics** — §5.3 DECIDED defaults
  (dictionary + row-groups; FK→links + opt-in samples; feed item mapping; digest
  channels; **no row-dump mode ever**).
- **FR-43 Import Profiles** — per-source declarable **defaults only in v1 (DP-9)**,
  surfaced as reviewable proposals.

**FR amendments:** FR-37 (formats: +csv/json/pptx/html-first-class; rides FR-39;
**interim: doc-repo loudly rejects .xlsx until 11.3 lands — DP-10**), FR-33
(unchanged, small), FR-38 (Step 1 = source catalog), FR-13 (source/sync metrics),
FR-19 (sync-run audit rows), **FR-17/FR-29 (agents see source freshness — last
sync, staleness — on served concepts; read-only, no sync-trigger tool — Q5)**,
**FR-11/FR-3 (draft-repository bundle export — G20 resolved YES)**.

**Non-Goal additions (record the rejections):** no vector-DB sync targets; no
query-time origin fetch (extends FR-27); no unbounded row/message ingestion; no
sync auto-publish path; SaaS egress only behind explicit opt-in.

**New ADRs:** okf-036 (source adapter framework & staging contract), okf-037
(connector governance & sovereignty egress classes), okf-038 (structured/tabular →
concept semantics + table-aware chunking gate + provenance/license discipline).
**ADR amendments:** okf-016 (source classes generalized beyond Git/S3), okf-019
(producer → converter nomenclature; documents adapter), okf-020 (**okf-server
consumes the model-tier config via its own vLLM client — DP-8; lane/batching
discipline replicated there**), okf-021 (staging artifacts alongside bundle zips),
okf-030/031 (sync-triggered drafts; version per publish unchanged), okf-008
(staging store reuse).
**Spec amendment:** `auto-curate-pass-2026-09-06.md` AC-5's "dataprep owns the
model — classify endpoint there recommended" note is **superseded by DP-8**
(okf-server owns the client) — amend during the correct-course.

**Epic sketch — Epic 11 "Enterprise Source Adapters"** (owner stories, each
extends the smoke harness per standing rule):
11.0 wave-0 hygiene (xlsx loud reject; multi-seed exposure; maxExternalDepth
wire-or-remove; html→Turndown reuse; **draft bundle export — G20 YES**) · 11.1
registry + adapter contract + staging seam · 11.2 Import Profiles + Auto-Curate
hint wiring · 11.3 file breadth I (csv/json + xlsx table adapter — dictionary +
row-groups, retires D1) · 11.4 pptx adapter · 11.5 sync scheduler + delta engine +
run history · 11.6 feed adapter (RSS/Atom; steward retention prompt; freshness on
served concepts) · 11.7 API pull adapter (Class 1 first) · 11.8 DB adapter
(Postgres read-only, dictionaries + FK→links + opt-in samples; table-chunking gate
from Epic 8) · 11.9 egress governance flags + quota/audit hardening (gates 11.10+;
license/access-basis enforcement) · 11.10 SaaS adapters
(Confluence/Notion/SharePoint; Slack/Teams digests last) · 11.11 Studio: source
catalog + declarative Input forms + Sources&Sync tab + schedule UI. Amendments:
3.4 (Input Phase-4 renders registry forms), 7.7 (documents adapter inside 11.x),
7.6 (multi-seed, pull forward — tiny), 8.x (table + feed fixtures).
**LLM client un-stub (DP-8):** okf-server's own vLLM client (ADR-020 tier
consumption, batched, lane-bounded) lands with 11.1 — it also un-stubs AC-5
(`classification: 'llm'/'hybrid'`) and later Mode C resplit.

---

## 7. Sequencing Proposal (waves; respects in-flight gates — order CONFIRMED, Q1)

- **Wave 0 — hygiene (tiny, parallel with anything):** D1-interim **xlsx loud
  reject (DP-10)**, D2 multi-seed exposure, D3 maxExternalDepth wire-or-remove,
  D4 html→Turndown reuse, G20 draft-bundle export (DECIDED YES). Nothing new
  architecturally.
- **Wave 1 — framework + files (Class 0, no egress):** 11.1 + 11.2 + 11.3 (+11.4).
  Studio: source catalog + Input wiring (folds 3.4 Phase 4 + 7.7 documents adapter).
  *This is also the FR-37 delivery vehicle.*
- **Wave 2 — recurrence (Class 1):** 11.5 + 11.6 + 11.7. First recurring source =
  feeds; internal APIs. Studio: schedule UI + Sources&Sync tab.
- **Wave 3 — databases (Class 1, sovereign-first):** 11.8 + the D6 table-chunking
  gate (Epic 8 fixtures must land here).
- **Wave 4 — egress connectors (Class 2):** 11.9 hardening first, then 11.10.
  Strictly behind ADR-okf-037 sign-off; skippable per deployment.
- Auto-Curate AC-1/AC-2 and David's re-import readiness test keep their current
  priority — waves assume they proceed as sequenced in the AC spec.

Effort classes (rough): framework core M; each file/feed adapter S; API adapter S–M;
DB adapter M; SaaS adapters L (OAuth, API quirks, PII intensity) — hence last and
opt-in.

---

## 8. Decisions (RESOLVED with David, 2026-09-06)

All twelve decision points were resolved in a structured interview. Resolutions are
binding input to the correct-course; consequences are folded into §5–§7 and §10.

| # | Decision | Resolution | Notes |
|---|---|---|---|
| DP-1/11 | Source Adapter Framework as the extension mechanism; adapter location | **ADOPTED — adapters in `components/okf-server/services/connectors/`, staging in the existing document-repository.** No new service, no new infrastructure; adapters end at the staging seam; downstream untouched. | As recommended |
| DP-2 | Egress governance | **Classes 0/1/2; Class 2 (external internet) default-OFF behind per-connector opt-in flags** (mirroring `LLM_EXTERNAL_EGRESS_ENABLED`), fail-closed; air-gap CI asserts zero enabled Class-2 connectors. | As recommended |
| DP-5 | Recurring sync → publish semantics | **Every sync run stages a DRAFT update under the six-step contract. No auto-publish path, no "trusted source" escape hatch.** | As recommended — the human gate is absolute |
| DP-6 | SaaS connectors in scope | **IN SCOPE, final wave, optional per deployment** (11.9 governance first, then 11.10 behind Class-2 flags). | As recommended |
| DP-3 | Spreadsheet semantics | **Data-dictionary concept + capped row-group table concepts per sheet (~200–500 rows, configurable), linked dictionary ↔ data.** | As recommended |
| DP-4 | Database semantics | **Read-only information-schema → data-dictionary concepts; FKs become the author `links[]` graph; sample rows are per-table steward opt-in. No row-dump mode, ever.** | As recommended |
| DP-7 | JS-rendered crawling | **DEFERRED.** Stay axios+cheerio; document the SPA limitation in crawler UI/docs; revisit only when a named deployment needs it. | As recommended |
| DP-8 | LLM/hybrid classification client (AC-5) | **okf-server OWNS its own vLLM client** — generalizing the existing manifest-summary call to serve classification, summaries, and later Mode C. *Deviation from the author's recommendation (dataprep endpoint).* | Consequences (binding): (a) ADR-okf-020's model-tier config is consumed by okf-server too (internal granite default, external opt-in); (b) the efficiency lane discipline (batched calls, bounded concurrency under `OKF_IMPORT_CONCURRENCY`, fail-soft) is replicated in this client; (c) the `auto-curate-pass-2026-09-06.md` AC-5 note ("dataprep owns the model — classify endpoint there recommended") is superseded — amend that spec during the correct-course; (d) okf-server stays CPU-only (remote HTTP to vLLM — ADR-okf-019 posture unchanged) |
| DP-9 | Import Profiles v1 | **Minimal declarable defaults only** (default type, tags, KH-L2 label hints, description/stale_after templates) — applied at conversion, reviewable in the Auto-Curate queue. No conditions, no rules engine. | As recommended |
| DP-10 | xlsx until 11.3 lands | **doc-repo REJECTS .xlsx loudly now** (clear error: spreadsheet import arrives with the table adapter) — removes the silent empty-text trap immediately; 11.3 (dictionary + row-groups) is the real fix. | As recommended |
| DP-12 | Vocabulary lock | **Confirmed** (standing ruling): connectors *import* (creation word); sync runs stage drafts; *ingest* remains exclusively the RAG step. All docs and UI copy follow. | Standing rule restated |
| — | Draft bundle export (G20) | **YES** — generalize `bundle-export-service.exportBundle()` so draft/review-state repos download as standard OKF zips via the same code path. Small story; rides wave 0. | As recommended |

---

## 9. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Scope explosion (Gemini's catalog is a 2-year roadmap if taken wholesale) | The framework + 3 adapters (files-breadth, feeds, DB-dictionary) deliver the structural capability; every additional source is a bounded S-sized adapter afterwards. Waves gate it. |
| Table-heavy imports degrade chunk/label quality (D6) | Hard gate: Epic 8 table fixtures + labeling-recall eval must pass before 11.3/11.8 ship beyond beta. |
| Import duration blowouts (efficiency mandate) | Item/row/concept caps at every layer (adapter quotas, conversion batches, `OKF_INGEST_MAX_CONCEPTS`), delta-only syncs, zero-LLM default path. |
| Prompt injection via fetched content (feeds/APIs/SaaS bodies) | Same posture as okf-019 hardening: fetched text is untrusted input; closed link namespace; steward gate stands. |
| Credential leakage | Vault/env references only; never in registry docs/logs (FR-1 rule generalized in FR-40). |
| Sovreignty regressions via connectors | Class 2 fail-closed flags; air-gap CI check extended to assert zero enabled Class-2 connectors by default. |
| Stale planning state (sprint yaml 2026-08-19 vs. live code) | Correct-course should also refresh `sprint-status-okf-server.yaml` — several "backlog" items are live in code. |

---

## 10. Open Questions (RESOLVED with David, 2026-09-06)

| # | Question | Resolution |
|---|---|---|
| Q1 | Do named deployments (Lesotho AgriConnect, Bangladesh Polisense, Gambia Innov8AI) reorder the waves? | **No — the default order stands** (files → feeds/internal APIs → databases → SaaS). Re-order when a named deployment confirms real source systems. |
| Q2 | Default retention for feed-born (monotonically growing) repositories? | **No deletion-by-age default — the steward sets retention per repo at creation** (the Studio prompts, with suggestions); `stale_after` marks aging items. Nothing silently lost. |
| Q3 | Are email / mailing-list archives an import source we commit to? | **Deferred — catalog note only.** Listed in the roadmap as a future Class 0/2 adapter (mbox/eml upload first, IMAP later); nothing built in this initiative. |
| Q4 | Provenance/licensing discipline for imported third-party content? | **Sources discipline now**: every adapter stamps frontmatter `sources[]` (kind, resource, fetched_at) and license when declared; **Class 2 connectors must carry a license/access-basis field before their first sync.** Lands inside ADR-okf-038. |
| Q5 | Can the agent/MCP surface trigger source syncs? | **Agents get READ-ONLY sync status** — source freshness (last sync, staleness) visible on served concepts; **no trigger capability** in v1. *Deviation from the author's recommendation (steward-only, no freshness): add a freshness attribute to the serving surface (FR-29 family), not a sync tool.* |

---

*Companion artifacts: [auto-curate-pass-2026-09-06](auto-curate-pass-2026-09-06.md)
(AC-1..5 ride this framework) · [okf-ux-onboarding-proposal-2026-09-06]
(okf-ux-onboarding-proposal-2026-09-06.md) (intent-copy principles govern every new
source card) · [okf-studio-ux-design-2026-08-13](okf-studio-ux-design-2026-08-13.md)
(the wizard spine this extends) · [okf-course-correction-2026-08-13]
(okf-course-correction-2026-08-13.md) (the format this document follows).*