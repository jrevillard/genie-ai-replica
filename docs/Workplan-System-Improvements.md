# Workplan — System Improvements

This document tracks planned system-level improvements for the GENIE.AI platform infrastructure, database, and operations.

**Last Updated:** June 12, 2026

---

## Recently Completed (June 2026)

### Document Ingestion Progress Feedback

**Status:** ✅ Complete  
**Date:** June 12, 2026  
**Spec:** `.kiro/specs/ingestion-progress-feedback/`

Full-stack real-time ingestion progress tracking implemented across three system layers:

- **Backend data layer** — `IngestionProgressService` with ArangoDB `ingestion_progress` collection, stage transition state machine (Extraction → Chunking → Guardrail → Labeling → Graph → Completed), progress clamping, error state preservation
- **API routes** — GET/PATCH `/api/files/:fileId/ingestion-progress` with role-based auth (Admin/Manager/AI Engineer)
- **Dataprep pipeline reporter** — `progress_reporter.py` in the Python dataprep service, fire-and-forget HTTP PATCH updates with 30-second throttling, per-stage percentage calculation (pages processed, chunks labeled, batches completed)
- **Frontend component** — `IngestionProgressIndicator.vue` with overall progress bar, stage pipeline icons (checkmark/spinner/circle/error), elapsed time counter, auto-refresh polling (configurable interval, stops on terminal state)
- **Property tests** — 10 property-based tests (fast-check) covering state machine transitions, progress clamping, re-trigger resets, stage icon assignment, overall progress formula, auto-refresh validation, log append preservation

**Key commits:** `362c229`, `dbb294f`, `76d0b93`, `cfed04b`, `c265076`

---

### Infrastructure Split — AKS Helm Chart

**Status:** ✅ Complete (merged PR 2486)  
**Date:** June 12, 2026  
**Spec:** `.kiro/specs/infrastructure-split/`

Complete Kubernetes deployment infrastructure via Helm chart (`helm/genieai/`):

- **GPU node pool** — vLLM, TEI, TEI Reranker, Dataprep with NVIDIA device plugin, GPU affinity/tolerations, startup probes (60s delay, 30 failure threshold)
- **CPU node pool** — Backend, Frontend, Document Repository, Kong, Nginx, ArangoDB, Redis, Keycloak, ClamAV, all microservices (embedding, reranker, textgen, translation, guardrail, retriever, http-service, chatqna)
- **Networking** — Default-deny NetworkPolicies, DNS egress, external ingress (Nginx/Kong only), cross-pool CPU↔GPU policies, Ingress with TLS termination
- **Storage** — PVCs for ArangoDB (50Gi managed-premium), Kong DB, Keycloak DB (10Gi each), document uploads (50Gi azurefile RWX), Redis (10Gi azurefile)
- **Health monitor** — Alpine/curl/jq container with state machine (healthy → degraded → unreachable), scaled-down detection, JSON health endpoint
- **Deployment scripts** — `deploy.sh` (helm lint + template validate + upgrade --install + rollback), `validate.sh` (post-deploy checks)
- **Cluster Autoscaler** — GPU min=0/max=2 with 10min scale-down, CPU min=1
- **Test suite** — 15 property tests (Python/Hypothesis), Helm unit tests (helm-unittest), integration tests (pytest + kubectl)

**Key commits:** `0ce7747`, `869019d`, `c86eac7`, `a6e2823`, `e0b37a3`

---

### Weather RAG Integration

**Status:** ✅ Phase 1 Complete  
**Date:** June 2-3, 2026  
**Docs:** `docs/weather-rag-integration-plan.md`

Weather-aware agricultural advisory — live weather data injected into LLM prompts:

- Geocoding from user queries (Nominatim, scoped to Lesotho) with graceful fallback cascade
- 7-day forecast from Open-Meteo API via backend weather service
- 15-minute weather cache, indefinite geocode cache
- Frontend widget location passthrough as secondary source
- ~145 tokens budget, toggled via `WEATHER_AUGMENTATION_ENABLED`

---

### Query Inspector

**Status:** ✅ Complete  
**Date:** June 2026  
**Docs:** `docs/Query-Inspector.md`

Admin-only RAG pipeline inspection tool:

- Full query lifecycle visibility (original question → RAG payload → retrieved docs → LLM response)
- Confidence scoring, response time, source document relevance (color-coded)
- LLM model tracking per query (for model comparison during evaluation)
- Filtering by confidence range, date range, user ID, full-text search
- User feedback correlation

---

### Knowledge Areas Sesotho Translation

**Status:** ✅ Complete  
**Date:** June 2, 2026

- Auto-translation of Knowledge Area categories using NLLB
- Bulk translation capability for existing content
- Fixed Knowledge Areas display for Sesotho locale

---

### RAG Quality Improvements (Ongoing)

**Status:** 🔄 Active evaluation  
**Date:** June 5, 2026  
**Docs:** `docs/RAG-Quality-Improvements.md`

- GPU consolidation (single vLLM at 85% utilization) ✅
- NLLB translation routing for ChatQnA pipeline ✅
- vLLM context window increase (8K → 16K) ✅
- Gateway timeout increase (60s → 180s) ✅
- LLM model evaluation in progress: AfriqueGemma-4B vs AfriqueQwen-14B vs Cloud API (GPT-4o-mini)

---

## Priority Items

### 1. ArangoDB Backup to Azure Storage Account

**Status:** Planned  
**Priority:** High  
**Component:** `gov-chat-backend/services/database-operations-service.js`

**Problem:**  
The current backup mechanism writes JSON exports to the local filesystem (`BACKUP_DIR`). This creates a single point of failure — if the server disk is lost, backups are lost with it. There is no off-site or cloud-based backup strategy.

**Proposed Solution:**  
Upload ArangoDB backups to an Azure Storage Account (Blob Storage) for durable, off-site retention.

**Implementation Approach:**

1. **Add Azure Blob Storage SDK dependency**
   - Package: `@azure/storage-blob`
   - Authentication: Managed Identity (preferred) or connection string via env var

2. **Extend `database-operations-service.js`**
   - After local backup completes, upload the file to Azure Blob Storage
   - Use a dedicated container (e.g., `arango-backups`)
   - Organize blobs by date: `backups/{YYYY}/{MM}/{filename}.json.gz`
   - Implement retry logic for upload failures

3. **New environment variables:**
   | Variable | Description |
   |---|---|
   | `AZURE_STORAGE_CONNECTION_STRING` | Connection string (if not using Managed Identity) |
   | `AZURE_STORAGE_ACCOUNT_NAME` | Storage account name (for Managed Identity auth) |
   | `AZURE_BACKUP_CONTAINER` | Blob container name (default: `arango-backups`) |
   | `AZURE_BACKUP_ENABLED` | Enable/disable cloud upload (default: `false`) |
   | `AZURE_BACKUP_RETENTION_DAYS` | Days to retain blobs before lifecycle deletion (default: `30`) |

4. **Azure Storage lifecycle policy**
   - Configure a lifecycle management rule on the container to auto-delete blobs older than retention period
   - Use Cool or Archive tier for backups older than 7 days to reduce cost

5. **Update admin UI**
   - Show cloud backup status in the Database tab (last upload time, storage location)
   - Add a "Backup to Cloud" button or make it automatic after every local backup

6. **Scheduling (future)**
   - Add a cron-based scheduled backup (e.g., daily at 02:00 UTC)
   - Could use `node-cron` or an external scheduler (Azure Functions timer trigger)

**Acceptance Criteria:**
- [ ] Backups are uploaded to Azure Blob Storage after successful local export
- [ ] Upload failures do not break the local backup flow (graceful degradation)
- [ ] Old cloud backups are automatically cleaned up via lifecycle policy
- [ ] Admin UI shows cloud backup status
- [ ] Feature is disabled by default and opt-in via `AZURE_BACKUP_ENABLED=true`
- [ ] Documentation updated in `docs/Database-Management.md`

**References:**
- [Azure Blob Storage Node.js SDK](https://learn.microsoft.com/en-us/azure/storage/blobs/storage-blob-javascript-get-started)
- [Lifecycle management policies](https://learn.microsoft.com/en-us/azure/storage/blobs/lifecycle-management-overview)
- Current backup logic: `gov-chat-backend/services/database-operations-service.js` → `backupDatabase()`

---

### 2. Primary LLM Selection Decision

**Status:** In Evaluation  
**Priority:** High  
**Docs:** `docs/RAG-Quality-Improvements.md`

**Problem:**  
Current Granite 3.3 2B has minimal Sesotho support and requires NLLB translation (adding ~45s latency). Need to select and deploy a model with native Sesotho capability.

**Options under evaluation:**
| Option | Model | Feasibility | Key Trade-off |
|--------|-------|-------------|---------------|
| A | AfriqueGemma-4B (FP16 on T4) | ✅ Easy | Base model only, needs prompt engineering |
| B | AfriqueQwen-14B (AWQ 4-bit on T4) | ⚠️ Tight | Best benchmarks, GPU memory constrained |
| C | Cloud API (GPT-4o-mini) | ✅ Easy | Data sovereignty concern |
| D | AfriqueQwen3.5-4B-ExtendedCM | ✅ Easy | Best 4B option (58.26 benchmark avg) |

**Pending actions:**
- [ ] Cloud API test — 20 queries (10 EN, 10 Sesotho) through RAG pipeline
- [ ] Data sovereignty review with ITU/Lesotho stakeholders
- [ ] AfriqueGemma-4B FP16 test on current T4
- [ ] Benchmark Sesotho quality comparison across candidates

---

### 3. Weather RAG Phase 2 — Historical Rainfall

**Status:** Planned  
**Priority:** Medium  
**Docs:** `docs/weather-rag-integration-plan.md` §10

**Planned additions:**
- 14-day rainfall history summary injected alongside forecast
- Source: Open-Meteo Historical API with 24-hour cache
- Per-district monthly climate profile documents ingested into knowledge base
- Additional ~50 tokens budget

---

## Backlog

_Items below are identified but not yet prioritized._

| # | Item | Component | Notes |
|---|---|---|---|
| 4 | Scheduled automatic backups (cron) | Backend | Daily/weekly automated backup without manual trigger |
| 5 | Backup restore functionality via admin UI | Backend + Frontend | Currently no restore endpoint exists |
| 6 | Database health monitoring alerts | Backend | Notify admins when DB size exceeds threshold or connections fail |
| 7 | Index performance dashboard | Frontend | Visualize index selectivity and query patterns |
| 8 | AKS deployment to staging | Infrastructure | Deploy Helm chart to Azure AKS staging cluster |
| 9 | NLLB fine-tuning on agricultural terminology | Translation | Domain-specific Sesotho translation improvements |
| 10 | Sesotho embedding evaluation | RAG Pipeline | Test zabantu-xlm-roberta / afro-xlmr-large vs BGE-M3 for native Sesotho retrieval |

---

## Completed

| # | Item | Date | Notes |
|---|---|---|---|
| — | Document Ingestion Progress Feedback | 2026-06-12 | Full-stack real-time progress tracking (backend + dataprep + frontend) |
| — | Infrastructure Split (AKS Helm Chart) | 2026-06-12 | Complete Helm chart with GPU/CPU separation, NetworkPolicies, health monitor, deploy scripts |
| — | Weather RAG Integration (Phase 1) | 2026-06-03 | Live weather + geocoding injected into LLM prompts |
| — | Query Inspector | 2026-06-03 | Admin tool for RAG pipeline inspection per query |
| — | Knowledge Areas Sesotho Translation | 2026-06-02 | Auto-translation + bulk translation of categories |
| — | User Approval Workflow | 2026-05-31 | Keycloak-based user validation and status management |
| — | Gateway Timeout Increase | 2026-05-29 | Nginx + Kong timeouts → 180s for NLLB pipeline |
| — | vLLM Context Window Increase | 2026-05-29 | 8K → 16K max_model_len, 8K textgen budget |
| — | GPU Consolidation | 2026-05-28 | Removed translation GPU container, primary vLLM at 85% |
| — | NLLB Translation Routing | 2026-05-28 | ChatQnA pipeline translation via CPU NLLB instead of LLM prompting |
| — | Language Scope Reduction | 2026-05-28 | 17 languages → English + Sesotho only |
| — | Database Management documentation | 2025-05-29 | Created `docs/Database-Management.md` and improved code comments |
