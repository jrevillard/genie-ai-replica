# Lesotho Deployment — Development Summary

**Project:** BDT 9LES25007 — Open-Source AI Agriculture Advisory Service for Lesotho  
**Period:** March – June 2026  
**VM (current):** Azure NC4as_T4_v3 (1× NVIDIA T4 16GB, 4 vCPUs, 28GB RAM)  
**Target (AKS):** Azure Kubernetes Service — dual node pool (GPU NC-series + CPU Standard)  
**URL:** https://agrivisory.itu.int  
**Last Updated:** August 26, 2026

---

## Overview

This document summarizes all key improvements and customizations applied to the GENIE.AI framework for the Lesotho agricultural advisory deployment. Changes span infrastructure, AI/ML pipeline, frontend, user management, and operational tooling.

---

## 1. Infrastructure & VM Setup

### T4 GPU Deployment Configuration (Docker Compose — Current)

- Created `docker-compose-t4.yaml` — dedicated Docker Compose for T4 GPU hardware
- Created `env-T4` — environment configuration tuned for T4 constraints (16GB VRAM, 4 vCPUs)
- Configured vLLM with `dtype=half` (T4 doesn't support bfloat16 natively)
- Resolved Gemma-3 4B incompatibility with T4 (requires bfloat16) — switched to compatible models

### AKS Kubernetes Deployment (Helm Chart — Production Target)

**Status:** ✅ Helm chart complete, ready for staging deployment  
**Spec:** `.kiro/specs/infrastructure-split/`

Full Kubernetes deployment infrastructure via Helm chart (`helm/genieai/`) replacing the Docker Compose single-VM approach:

**Architecture:**
- Single AKS cluster with dual node pools (GPU NC-series + CPU Standard VMs)
- Node affinity + taints/tolerations for workload pinning
- Kubernetes internal DNS for all service discovery (no hardcoded IPs)
- NetworkPolicies for microsegmentation (replaces Azure NSGs between VMs)
- nginx Ingress Controller for TLS termination and external traffic routing

**GPU Node Pool (NC-series with T4):**
- vLLM (port 8000), TEI Embedding (port 80), TEI Reranker (port 80), Dataprep/Docling (port 5000)
- NVIDIA Device Plugin DaemonSet for GPU resource advertising
- Startup probes (initialDelaySeconds=60, failureThreshold=30) for model loading
- Cluster Autoscaler: min=0, max=2 nodes, scale-down-unneeded-time=10min (GPU scale-to-zero saves ~$1.50/hr when idle)

**CPU Node Pool (Standard VMs):**
- Application tier: Backend, Frontend, Document Repository, ChatQnA, Kong, Nginx
- Data tier: ArangoDB, Redis, Kong DB, Keycloak DB (with startup probes and PVCs)
- Microservices: embedding, reranker, textgen, translation, guardrail, retriever, http-service
- Auth/utility: Keycloak, ClamAV
- Health monitor: Alpine/curl/jq container with state machine (healthy → degraded → unreachable)
- Cluster Autoscaler: min=1 node

**Storage:**
- Azure Disk (managed-premium, ReadWriteOnce): ArangoDB 50Gi, Kong DB 10Gi, Keycloak DB 10Gi
- Azure File (azurefile, ReadWriteMany): Document uploads 50Gi, Redis 10Gi

**Networking:**
- Default-deny NetworkPolicy on all pods
- DNS egress allowed (kube-dns port 53)
- External ingress restricted to Nginx (:80,:443) and Kong (:8010)
- Cross-pool policies: CPU → GPU (inference), GPU → CPU (Dataprep → ArangoDB, etc.)
- Ingress with TLS 1.2 minimum, HTTP→HTTPS redirect (301)

**Deployment automation:**
- `scripts/deploy.sh` — helm lint → template validate → upgrade --install → automatic rollback on failure
- `scripts/validate.sh` — post-deployment checks (pods Running/Ready, GPU taint, Device Plugin, Ingress IP, TLS)
- Environment-specific values: `values-dev.yaml`, `values-staging.yaml`, `values-prod.yaml`

**Test suite:**
- 15 property-based tests (Python/Hypothesis) — GPU/CPU scheduling, NetworkPolicy, PVC config, health monitor state machine, deployment rollback, service generation, DNS format, rolling update
- Helm unit tests (helm-unittest plugin) — GPU/CPU/NetworkPolicy/storage template validation
- Integration tests (pytest + kubectl) — workload scheduling, networking, storage persistence, scale-to-zero

### Keycloak Authentication Integration

- Integrated Keycloak as identity provider (replacing local auth for production)
- Configured F5 reverse proxy ↔ Keycloak ↔ GENIE.AI authentication flow
- Fixed auth racing conditions and session expiration handling
- Added Keycloak user role mapping to ArangoDB user profiles

→ Related: [F5-IdP-Keycloak-Integration-Fix.md](../F5-IdP-Keycloak-Integration-Fix.md)

### API Gateway (Kong + Nginx)

- Configured Kong routes for all backend API endpoints
- Configured Nginx as front-facing reverse proxy with SSL termination
- Added CORS configuration for ITU health monitoring
- Increased gateway timeouts to 180s for NLLB translation pipeline

→ Related: [api-gateway-solution/README.md](../api-gateway-solution/README.md)

---

## 2. AI/ML Pipeline

### Primary LLM

- Model: `ibm-granite/granite-3.3-2b-instruct` served via vLLM
- GPU utilization: 85% (was 40% when sharing with translation model)
- Context window: 16,384 tokens (increased from 8,192)
- KV cache capacity: ~105,000 tokens

### Translation — CPU-Based NLLB-200

- Removed GPU translation container (`vllm-translation-guardrail`)
- All translation (UI + RAG pipeline) now uses `Xenova/nllb-200-distilled-600M` on CPU
- Native Sesotho (`sot_Latn`) support — purpose-built translation model
- Redis caching for repeated translations
- ChatQnA pipeline: Sesotho input → NLLB translates to English → RAG → LLM → NLLB translates back to Sesotho

→ Details: [GPU-Optimization-CPU-Translation.md](GPU-Optimization-CPU-Translation.md)

### Retrieval & Reranking

- Custom reranker microservice with configurable strategies: `slice`, `threshold`, `knee_threshold`
- Reranking threshold set to 0.90 for high-precision retrieval
- BGE-M3 multilingual embeddings (handles cross-lingual Sesotho↔English retrieval)
- ArangoDB hybrid vector-graph retrieval with configurable search modes

### Guardrail

- Content safety guardrail using primary vLLM (was separate Gemma instance)
- Applied during document ingestion to block unsafe content

### Data Preparation (Docling)

- Integrated Docling for document parsing (PDF, DOCX, XLSX, PPTX, HTML, TXT, MD)
- Configurable chunk sizes per file type
- LLM-based label assignment for knowledge hierarchy
- GPU/CPU mode configurable via `DOCLING_DEVICE`
- **Real-time ingestion progress tracking** (June 2026):
  - Backend: `IngestionProgressService` with ArangoDB `ingestion_progress` collection
  - 5-stage pipeline tracking: Extraction → Chunking → Guardrail → Labeling → Graph
  - Per-stage percentage (pages processed, chunks labeled, batches completed)
  - Dataprep `progress_reporter.py` — fire-and-forget HTTP PATCH with 30s throttling
  - Frontend `IngestionProgressIndicator.vue` — progress bar, stage pipeline icons, elapsed time, auto-refresh polling

→ Details: [RAG-Quality-Improvements.md](RAG-Quality-Improvements.md)

### Document Language Handling (July 2026)

The knowledge base is designed around English-language documents with Sesotho user interaction handled at query time via NLLB translation. Key points:

- **No translation during ingestion** — documents are embedded in their original language using BGE-M3 (multilingual, 100+ languages)
- **No hard language block** — non-English uploads are allowed with a warning; the system relies on BGE-M3 cross-lingual retrieval
- **OCR is English-only** — Sesotho text in scanned/image documents will not be extracted
- **Label assignment** uses English taxonomy — may misclassify non-English content
- **Recommendation:** prefer English documents; Sesotho documents accepted but retrieval quality is unverified for this language
- **Cross-lingual retrieval** depends on BGE-M3 mapping Sesotho and English into the same embedding space — works in theory but unvalidated for Sesotho specifically

→ Details: [Document-Language-Handling.md](Document-Language-Handling.md)

### Weather-Aware RAG (June 2026, updated August 2026)

- Live weather data injected into LLM prompts for agricultural advisory
- Location resolution priority: geocode from user query (Nominatim, scoped to Lesotho) → frontend widget selection → default Maseru
- 7-day forecast from Open-Meteo API via backend weather service
- 15-minute weather cache, indefinite geocode cache per place name
- ~145 tokens budget, toggled via `WEATHER_AUGMENTATION_ENABLED`
- Weather-aware system prompt instructs LLM to incorporate conditions into farming advice
- **Resilience improvements (August 2026):**
  - WeatherService now uses lazy initialization — retries `init()` on next request if startup failed
  - `init()` no longer fails when ipapi.co is unreachable — falls back to `WEATHER_DEFAULT_LATITUDE`/`WEATHER_DEFAULT_LONGITUDE` env vars (Maseru)
  - Route returns HTTP 503 (Service Unavailable) with retry hint instead of generic 500 during transient failures
  - Rate-limits init retries to one every 10 seconds to avoid hammering external services
- Phase 2 planned: historical rainfall summary + per-district climate profiles

→ Details: [weather-rag-integration-plan.md](weather-rag-integration-plan.md)

---

## 3. Frontend & User Interface

### Customization for Lesotho

- Branding: ITU/FAO logos, Agrivisory project name and favicon
- Language selector limited to English + Sesotho
- Knowledge areas configured for agriculture (crop management, livestock, weather, etc.)
- Quick Help buttons tailored to farming topics
- Terms and conditions with ITU Data Privacy Policy
- Simplified Settings and Profile screens

### Login & Registration

- Keycloak SSO integration with redirect handling
- Pending approval workflow for new user registrations
- Session expiration handling with user-friendly redirect

### Farmer Registration & Profile (June 2026, updated August 2026)

Standalone farmer profile modal with interactive map-based location management:

- **Interactive map** (Leaflet + OpenStreetMap): click to set farm center, draw polygon plot boundaries, multiple plots per farmer
- **GPS auto-detect**: one-tap location capture via browser Geolocation API
- **Plot management**: name each plot, automatic area calculation (hectares), edit/delete boundaries
- **Farm details**: size, ownership type (owned/leased/communal/rented/sharecropping), farming type, irrigation
- **Crop profiles**: dynamic list with crop name, season, area allocation
- **Livestock profiles**: type, head count, purpose (meat/dairy/eggs/wool/draft/breeding)
- **Cooperative memberships**: group name + farmer's role
- **Weather at farm location (August 2026)**: weather card showing current conditions (temperature, humidity, wind, condition) and 5-day forecast strip with weather emojis. Uses farmer's saved farm coordinates, falls back to Maseru default.
- **Manual coordinate fallback**: for low-connectivity environments
- **Backend**: `GET/PUT /api/users/farmer-profile` — stored as nested object on user document (no schema migration)
- **AI integration**: When `shareWithAI` is enabled, farm data (crops, livestock, location, farm size) is injected into the LLM prompt via the existing `/api/users/:userId/context` endpoint, enabling personalized advisory responses
- **Privacy control**: Per-user toggle (default OFF) — farmer must explicitly opt in to share data with the AI. Sensitive data (email, passwords, exact polygon coordinates, financial info) is never sent to the LLM regardless of the toggle setting. Enforcement is server-side.
- **Dependencies**: `leaflet@^1.9.4`, `leaflet-draw@^1.0.4` (~62KB gzipped total)

→ Details: [Farmer-Registration-Profile.md](Farmer-Registration-Profile.md)

### Chat Interface

- Improved terms and conditions message under chat
- Weather widget with location selection
- File ingestion status visible in UI
- Chat feedback mechanism

---

## 4. User Roles & Workflows

### New Roles

| Role | Access |
|------|--------|
| Admin | Full system access, Query Inspector, AI Configuration, user management, system health |
| AI Engineer | Query Inspector, AI Configuration, RAG pipeline monitoring, model evaluation |
| Manager | Analytics dashboard, document management, user oversight |
| User | Chat interface, profile management, farmer profile with weather |

### Pending Approval Workflow

New user registrations require admin/manager approval before access is granted. Prevents unauthorized access to the agricultural advisory service.

---

## 5. Operational Tooling

### Query Inspector

Admin tool for inspecting the full RAG pipeline per query:
- User's original question
- Payload sent to the OPEA RAG service
- Retrieved documents with relevance scores (color-coded: green ≥0.8, yellow ≥0.5, red <0.5)
- LLM model used and response generated
- Confidence scores for response quality monitoring
- User feedback correlation
- Filtering by confidence range, date range, user ID, full-text search
- Model tracking enables side-by-side evaluation when testing different LLMs

→ Details: [Query-Inspector.md](Query-Inspector.md)

### Document Ingestion Progress (June 2026)

Real-time tracking of document ingestion through the pipeline:
- 5-stage progress: Extraction (page-level), Chunking, Guardrail, Labeling (chunk-level), Graph (batch-level)
- Frontend: progress bar + stage pipeline icons (✓ completed, ⟳ active, ○ pending, ✗ error) + elapsed time
- Auto-refresh polling (configurable interval, auto-stops on terminal state)
- GET `/api/files/:fileId/ingestion-progress` API for programmatic access
- Re-triggering ingestion resets progress to initial state

### Security Scanning (June 2026)

Automated security monitoring available in the Admin Dashboard → Security tab:

- **Log-based vulnerability scanning:** Scans 10 days of application logs against 14 pattern rules (SQL injection, XSS, command injection, sensitive file probing, brute force, etc.)
- **HTTP security checks:** Live checks for missing CSP/HSTS/X-Frame-Options headers, server information leakage, CORS misconfiguration, and exposed hidden files
- **Severity classification:** Critical (active exploitation), Medium (confirmed hostile), Low (operational noise)
- **Threshold-based promotion:** Low-severity auth events auto-promoted to medium when >50 occurrences (distinguishes credential stuffing from normal session expiry)
- **Dynamic recommendations:** Recommendations derived from actual findings — each vulnerability type generates its own card with specific action items (no generic static messages)
- **Scan age indicator:** Shows how stale cached results are ("23 minutes ago", "3 hours ago")
- **False positive reduction:** Routine events (expired tokens, mistyped passwords, session timeouts) correctly classified as low/informational rather than security threats

→ Details: [Security-Alerts-Recommendations.md](Security-Alerts-Recommendations.md)

### Log Management (June 2026)

Admin log viewer providing backend observability without SSH access:

- **Daily summary:** Error and warning logs grouped by type and service with occurrence counts
- **Full-text search:** Filter by term, level (ERROR/WARN/INFO/DEBUG), service, and date range (today through custom)
- **Smart service detection:** Extracts service tags from log messages (e.g., `[ADMIN-ROUTES]` → "Admin", `[AUTH]` → "Auth") — 30+ tag mappings plus keyword fallback
- **Search term highlighting:** Matched terms highlighted in yellow within results
- **Pagination:** Server-side offset/limit with `hasMore` indicator for large result sets
- **Runtime configuration:** Log level and retention period changeable from the UI without container restart
- **Log rotation:** Manual rollover button to force immediate log file archival
- **File support:** Reads both active `.log` and compressed `.gz` archives, up to 10 days of history

→ Details: [Log-Management.md](Log-Management.md)

### System Health Monitoring (June 2026, updated August 2026)

Real-time service health probes replacing the previous hardcoded/heuristic status indicators:

- **9 services actively probed:** ArangoDB (AQL query), Redis (PING), vLLM (/health), TEI Embedding (/health), TEI Reranker (/health), ChatQnA (/), Kong (/status), Weather Service (Open-Meteo HTTPS probe + initialization state), Farmer Profile Service (AQL query on users collection)
- **GPU monitoring:** nvidia-smi integration reporting utilization %, VRAM %, temperature — displayed in NavBar dropdown and Admin Dashboard
- **Fixed CPU metric:** Replaced `os.loadavg()` (which exceeded 100% during ingestion) with `/proc/stat` sampling bounded to 0–100%
- **User-facing messages:** Each service reports a human-readable explanation when degraded or down (e.g., "API Gateway (Kong) is down (connection refused)")
- **3 status levels:** `good` (operational), `warning` (degraded with explanation), `error` (outage with cause)
- **Parallel probes:** All health checks run concurrently with 3s timeout per service — total response time ≈ max(individual probe times)
- **NavBar indicator:** All users see colored dot (green/yellow/red) with expandable dropdown listing affected services and GPU usage bars
- **Eliminated false positives:** Removed "Message Queue" (phantom service), removed CPU-as-proxy-for-API-health logic
- **AI Configuration panel (August 2026):** New `GET /api/admin/ai-config` endpoint exposes current LLM, translation, embedding, reranker, RAG pipeline, and ingestion parameters. Accessible by AI Engineers and Admins. Displayed as a full-width card in the admin overview tab with 5 sections. No secrets or tokens exposed.

→ Details: [System-Health-Monitoring.md](System-Health-Monitoring.md)

---

## 6. Language & Translation

### Architecture

```
Frontend (Sesotho UI via i18n)
    ↓
Backend /api/translate (NLLB-200 on CPU, cached in Redis)
    ↓
ChatQnA Pipeline:
    Input:  NLLB (st → en) → Embed → Retrieve → Rerank → LLM (English)
    Output: LLM response → NLLB (en → st) → User
```

### Key Decisions

- NLLB-200 chosen over prompt-based LLM translation (Granite can't handle Sesotho)
- BGE-M3 multilingual embeddings enable cross-lingual retrieval as fallback
- Redis caching eliminates repeated translation overhead
- Language auto-detection via `langdetect` as fallback when frontend doesn't specify

→ Details: [RAG-Quality-Improvements.md](RAG-Quality-Improvements.md#2-nllb-routing-for-chatqna-pipeline-translation-may-28-2026)

---

## 7. GPU/CPU Optimization

| Resource | Before | After |
|----------|--------|-------|
| GPU containers | 2 vLLM instances | 1 vLLM instance |
| GPU memory per LLM | 40% (6.4GB) | 85% (13.6GB) |
| KV cache capacity | ~50K tokens | ~105K tokens |
| Max context window | 8,192 tokens | 16,384 tokens |
| Translation | GPU (Gemma-3 1B, poor Sesotho) | CPU (NLLB-200, native Sesotho) |
| Cold start time | ~60s | ~30s |
| Gateway timeout | 60s | 180s |

→ Details: [GPU-Optimization-CPU-Translation.md](GPU-Optimization-CPU-Translation.md)

---

## 8. Planned Improvements

### Near-term

- **AKS staging deployment:** Deploy Helm chart to Azure AKS staging cluster for validation before production cutover
- **Primary LLM upgrade:** Evaluating AfriqueGemma-4B, AfriqueQwen-14B, AfriqueQwen3.5-4B-ExtendedCM, and Cloud API (GPT-4o-mini) for native Sesotho generation — could eliminate translation step entirely
- **Data sovereignty review:** Confirm with ITU/Lesotho stakeholders whether cloud API inference is acceptable for agricultural queries
- **ArangoDB backup to Azure Blob Storage:** Off-site backup with lifecycle retention policies

### Medium-term

- **NLLB latency:** Output translation takes ~37s for longer responses — consider upgrading to `nllb-200-1.3B` or increasing VM vCPUs
- **Weather RAG Phase 2:** Historical rainfall summary (14 days) + per-district monthly climate profiles
- **NLLB fine-tuning:** Domain-specific Sesotho agricultural terminology
- **Sesotho embedding evaluation:** Test zabantu-xlm-roberta / afro-xlmr-large vs BGE-M3 for native Sesotho retrieval

### Long-term

- **VM upgrade:** NC8as_T4_v3 (8 vCPUs, 56GB RAM) would provide CPU headroom for NLLB if staying on single-VM Docker Compose
- **Production AKS cutover:** Migrate from Docker Compose on single VM to the AKS Helm chart deployment with GPU scale-to-zero
- **AfriqueQwen-14B on A100/2×V100:** Full model quality, 32K context, no quantization trade-offs

→ Full roadmap: [RAG-Quality-Improvements.md](RAG-Quality-Improvements.md#under-investigation)  
→ Workplan: [Workplan-System-Improvements.md](Workplan-System-Improvements.md)

---

## Related Documentation

- [CHANGELOG](CHANGELOG.md)
- [GPU Optimization: CPU-Based Translation](GPU-Optimization-CPU-Translation.md)
- [RAG Quality Improvements](RAG-Quality-Improvements.md)
- [Query Inspector](Query-Inspector.md)
- [System Health Monitoring](System-Health-Monitoring.md)
- [Security Alerts & Recommendations](Security-Alerts-Recommendations.md)
- [Log Management](Log-Management.md)
- [Document Language Handling](Document-Language-Handling.md)
- [Weather RAG Integration Plan](weather-rag-integration-plan.md)
- [Farmer Registration & Profile](Farmer-Registration-Profile.md)
- [Workplan — System Improvements](Workplan-System-Improvements.md)
- [Translation Service Plan](translation-service-plan.md) (historical)
- [User Roles](users.md)
- [Database Management](Database-Management.md)
- [GENIE.AI Installation & Configuration Guide](../GENIE.AI-Installation-Configuration-Guide.md)
- [API Gateway](../api-gateway-solution/README.md)
- [README — AI/ML Models](../README.md#aiml-models)
- [Infrastructure Split Spec](../.kiro/specs/infrastructure-split/)
- [Ingestion Progress Feedback Spec](../.kiro/specs/ingestion-progress-feedback/)
