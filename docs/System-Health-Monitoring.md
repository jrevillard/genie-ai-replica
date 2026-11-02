# System Health Monitoring

**Project:** BDT 9LES25007 — Open-Source AI Agriculture Advisory Service for Lesotho  
**Last Updated:** August 26, 2026

---

## Overview

The system health monitoring provides real-time visibility into the operational state of all services in the GENIE.AI deployment. It performs actual connectivity probes against each service (rather than inferring health from host-level metrics) and communicates clear, actionable information to both admins and end users when services are degraded or unavailable.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Frontend (Vue.js)                            │
│                                                                     │
│  ┌─────────────┐  ┌────────────────────┐  ┌──────────────────────┐ │
│  │  NavBar     │  │  Admin Dashboard   │  │  ChatBot Inline      │ │
│  │  Status Dot │  │  Health Cards +    │  │  Online/Offline +    │ │
│  │  + Dropdown │  │  Resource Bars     │  │  Error Message       │ │
│  └──────┬──────┘  └────────┬───────────┘  └──────────┬───────────┘ │
│         │                   │                         │             │
│         └───────────────────┼─────────────────────────┘             │
│                             │                                       │
│                   GET /admin/system-health                           │
└─────────────────────────────┼───────────────────────────────────────┘
                              │
┌─────────────────────────────┼───────────────────────────────────────┐
│                    Backend (Node.js)                                 │
│                                                                     │
│  ┌──────────────────────────┴──────────────────────────────────┐    │
│  │            AdminDashboardService.getSystemHealth()           │    │
│  │                                                             │    │
│  │  ┌─────────────────────────────────────────────────────┐    │    │
│  │  │           checkAllServices() — Parallel              │    │    │
│  │  │                                                     │    │    │
│  │  │  • checkDatabase()      → AQL: RETURN 1             │    │    │
│  │  │  • checkRedis()         → PING → PONG               │    │    │
│  │  │  • checkVllm()          → GET /health (port 8000)   │    │    │
│  │  │  • checkEmbedding()     → GET /health (TEI port 80) │    │    │
│  │  │  • checkReranker()      → GET /health (TEI port 80) │    │    │
│  │  │  • checkChatQnA()       → GET / (OPEA port 8888)    │    │    │
│  │  │  • checkKong()          → GET /status (port 8001)   │    │    │
│  │  │  • checkWeather()       → WeatherService.initialized│    │    │
│  │  │                           + GET api.open-meteo.com   │    │    │
│  │  │  • checkFarmerProfile() → UserProfileService init    │    │    │
│  │  │                           + AQL users collection     │    │    │
│  │  └─────────────────────────────────────────────────────┘    │    │
│  │                                                             │    │
│  │  ┌─────────────────────────────────────────────────────┐    │    │
│  │  │        ResourceUsageMonitor.getResourceUsage()       │    │    │
│  │  │                                                     │    │    │
│  │  │  • CPU:     /proc/stat (500ms sample, capped 100%)  │    │    │
│  │  │  • Memory:  os.totalmem() - os.freemem()            │    │    │
│  │  │  • Storage: df -h /                                  │    │    │
│  │  │  • Network: /proc/net/dev                            │    │    │
│  │  │  • GPU:     nvidia-smi (utilization + VRAM + temp)   │    │    │
│  │  └─────────────────────────────────────────────────────┘    │    │
│  └─────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Services Monitored

| Service | Probe Method | Health Endpoint | Timeout |
|---------|-------------|-----------------|---------|
| Database (ArangoDB) | AQL query: `RETURN 1` | Internal (arangojs client) | 3s |
| Cache (Redis) | `PING` command via ioredis | Internal (TCP 6379) | 3s |
| AI Model (vLLM) | HTTP GET | `http://vllm:8000/health` | 3s |
| Embedding Service (TEI) | HTTP GET | `http://tei:80/health` | 3s |
| Reranker Service (TEI) | HTTP GET | `http://tei_reranker:80/health` | 3s |
| ChatQnA Pipeline | HTTP GET | `http://chatqna-xeon-backend-server:8888/` | 3s |
| API Gateway (Kong) | HTTP GET | `http://kong:8001/status` | 3s |
| Weather Service (Open-Meteo) | `WeatherService.initialized` + HTTPS GET | `https://api.open-meteo.com/v1/forecast` | 3s |
| Farmer Profile Service | `UserProfileService` init + AQL query | Internal (users collection, `farmerProfile != null`) | 3s |
| GPU (NVIDIA T4) | `nvidia-smi` CLI | Shell command | 5s |
| Disk Storage | `df -h /` | Shell command | — |

All service probes run in parallel via `Promise.allSettled()` — a single slow service doesn't block the others.

---

## Status Levels

Each service reports one of three statuses with an explanatory message:

| Status | Meaning | Frontend Display | Trigger |
|--------|---------|-----------------|---------|
| `good` | Healthy, responding normally | Green dot, "Operational" | Responds within 2s, valid response |
| `warning` | Functional but degraded | Yellow dot, "Degraded" | Responds between 2–3s (slow), or GPU ≥ 95% |
| `error` | Down or unreachable | Red dot, "Outage" | Connection refused, timeout, host not found, HTTP 5xx |

### Example Messages

| Scenario | Status | Message |
|----------|--------|---------|
| Kong container stopped | `error` | "API Gateway (Kong) is down (connection refused)" |
| Kong DNS stale after restart | `error` | "API Gateway (Kong) host not found — container may not be running" |
| vLLM model loading | `error` | "AI Model (vLLM) not responding (timed out after 3000ms)" |
| Redis password mismatch | `error` | "Redis unreachable: NOAUTH Authentication required" |
| ArangoDB slow under load | `warning` | "Database responding slowly (2340ms)" |
| GPU during RAG ingestion | `warning` | "GPU utilization at 97% — document ingestion or heavy inference in progress, responses may be slower" |
| Disk nearly full | `warning` | "Disk usage at 92% — free up space to avoid service interruption" |
| Everything normal | `good` | *(no message)* |

---

## GPU Monitoring

GPU metrics are collected via `nvidia-smi` on the host:

```bash
nvidia-smi --query-gpu=utilization.gpu,memory.used,memory.total,temperature.gpu --format=csv,noheader,nounits
```

### Metrics Collected

| Metric | Key | Description |
|--------|-----|-------------|
| GPU Utilization | `gpu` | Compute utilization percentage (0–100%) |
| GPU Memory Usage | `gpuMemory` | VRAM utilization percentage |
| GPU Memory Used | `gpuMemoryUsedMB` | Megabytes of VRAM in use |
| GPU Memory Total | `gpuMemoryTotalMB` | Total VRAM (15360 MB for T4) |
| GPU Temperature | `gpuTemperature` | GPU die temperature (°C) |

### Behavior

- If `nvidia-smi` is not available (no GPU, or driver not installed), all GPU metrics return `null` and GPU is omitted from the UI
- GPU metrics are cached for 30 seconds to avoid spamming nvidia-smi
- GPU ≥ 95% utilization triggers a `warning` status with a user-facing explanation (ingestion/inference in progress)
- GPU bars are shown in both the NavBar dropdown and Admin Dashboard resource panel

---

## Resource Usage Monitoring

### CPU (Fixed)

**Previous behavior:** Used `os.loadavg()[0] / numCpus` which could exceed 100% (load average includes I/O-waiting processes). During RAG ingestion, this would show "130% CPU" and falsely trigger "API Services degraded."

**Current behavior:** On Linux, reads `/proc/stat` twice with a 500ms interval and calculates actual CPU time percentage (always 0–100%). Falls back to capped load average on non-Linux platforms.

### Resource Bars Displayed

| Resource | Source | Shown In |
|----------|--------|----------|
| CPU | `/proc/stat` sampling | Admin Dashboard |
| Memory | `os.totalmem() - os.freemem()` | Admin Dashboard |
| Storage | `df -h /` | Admin Dashboard |
| Network | `/proc/net/dev` | Admin Dashboard |
| GPU | `nvidia-smi` | Admin Dashboard + NavBar dropdown |
| GPU Memory | `nvidia-smi` | Admin Dashboard + NavBar dropdown |

---

## Frontend Integration

### NavBar Status Indicator (All Users)

- Colored dot visible at all times: green (all operational), yellow (some degraded), red (any outage)
- Click to expand dropdown showing:
  - Counts: operational / degraded / outage
  - Individual services with issues (name + descriptive message)
  - GPU/VRAM usage bars (when GPU is present)
  - Link to full Admin Dashboard

### Admin Dashboard (Admin Users)

- Full service list with colored badges per service
- Message text shown below each service name when issues exist
- Resource usage bars (CPU, Memory, Storage, Network, GPU, GPU Memory)
- "Run Diagnostics" button to trigger fresh health check

### ChatBot Inline Status (All Users)

- Online/Offline indicator with response time
- When a chat request fails, shows the error message inline (e.g., "API Gateway timeout")
- Automatically recovers to "Online" on next successful response

---

## API Endpoint

### `GET /admin/system-health`

**Authentication:** Required (Bearer token)  
**Authorization:** Any authenticated user (NavBar calls this for all logged-in users)

### Response Shape

```json
{
  "metrics": {
    "systemUptime": 99.98,
    "avgResponseTime": 3420,
    "errorRate": 0.12,
    "monthlyActiveUsers": 47
  },
  "trends": {
    "uptime": 0.02,
    "responseTime": -5.3,
    "errorRate": -0.04,
    "activeUsers": 12.5
  },
  "resourceUsage": {
    "cpu": 34,
    "memory": 72,
    "storage": 61,
    "network": 18,
    "gpu": 45,
    "gpuMemory": 88,
    "gpuMemoryUsedMB": 13516,
    "gpuMemoryTotalMB": 15360,
    "gpuTemperature": 62
  },
  "healthServices": [
    { "id": "database", "name": "Database (ArangoDB)", "status": "good", "message": null },
    { "id": "cache", "name": "Cache (Redis)", "status": "good", "message": null },
    { "id": "llm", "name": "AI Model (vLLM)", "status": "good", "message": null },
    { "id": "embedding", "name": "Embedding Service", "status": "good", "message": null },
    { "id": "reranker", "name": "Reranker Service", "status": "good", "message": null },
    { "id": "chatqna", "name": "ChatQnA Pipeline", "status": "good", "message": null },
    { "id": "gateway", "name": "API Gateway (Kong)", "status": "good", "message": null },
    { "id": "weather", "name": "Weather Service (Open-Meteo)", "status": "good", "message": null },
    { "id": "farmerProfile", "name": "Farmer Profile Service", "status": "good", "message": null },
    { "id": "gpu", "name": "GPU (NVIDIA T4)", "status": "good", "message": null }
  ]
}
```

When a service has issues:

```json
{
  "id": "gateway",
  "name": "API Gateway (Kong)",
  "status": "error",
  "message": "API Gateway (Kong) is down (connection refused)"
}
```

---

## AI Configuration Endpoint

### `GET /admin/ai-config`

**Authentication:** Required (Bearer token)  
**Authorization:** AI Engineer or Admin role (`isAIEngineerOrAbove` middleware)

Returns the current AI/ML configuration parameters read from environment variables. No secrets are exposed.

### Response Sections

| Section | Parameters Included |
|---------|-------------------|
| LLM | Model name, temperature, top_p, max_tokens, repetition_penalty |
| Translation | Engine, source/target languages, model |
| Embedding | Model, dimensions, endpoint |
| Reranker | Model, top_n, endpoint |
| RAG Pipeline | Chunk size, chunk overlap, retrieval top_k, similarity threshold |
| Ingestion | Batch size, supported file types, max file size |

### Frontend

Rendered as a full-width card in the Admin Dashboard overview tab with 5 collapsible sections. Visible to both Admin and AI Engineer roles.

---

## Caching & Performance

| Data | Cache Duration | Notes |
|------|---------------|-------|
| Resource usage (CPU, memory, storage, network, GPU) | 30 seconds | Avoids repeated nvidia-smi/proc reads |
| Health probes | Not cached | Always fresh on each request |
| Frontend fetch | On mount + manual refresh | No automatic polling interval |

The health check endpoint typically completes in 1–3 seconds (dominated by the service with the highest response time, since probes are parallel).

---

## Known Behaviors

### Kong IP Stale After Container Rebuild

When a container (e.g., frontend) is rebuilt, Docker assigns it a new internal IP. Kong's upstream config still points to the old IP, causing 502 errors. The health monitor will correctly show "API Gateway (Kong) returned HTTP 502" in this case.

**Resolution:** Restart Kong to refresh DNS: `docker restart $(docker ps -qf "ancestor=kong:latest")`

### GPU "Warning" During Ingestion

When documents are being ingested through the RAG pipeline, GPU utilization hits 95–100% (Docling + vLLM labeling). The health monitor reports this as a warning with an explanatory message rather than incorrectly attributing it to API degradation.

### Backend Container Can't Reach Services on First Boot

If the backend starts before GPU services finish loading their models (vLLM takes ~30-60s), the health check will show those services as "error" until they're ready. This is expected during cold starts.

---

## Files Modified

| File | Change |
|------|--------|
| `components/gov-chat-backend/services/admin-dashboard-service.js` | Real health probes, GPU monitoring, fixed CPU calculation, Weather + Farmer Profile checks, AI config reader |
| `components/gov-chat-backend/routes/admin-routes.js` | Added `GET /admin/ai-config` endpoint with AI Engineer access |
| `components/gov-chat-frontend/src/components/NavBarComponent.vue` | Service issue list, GPU bars, message display in dropdown |
| `components/gov-chat-frontend/src/components/AdminDashboard.vue` | Message text per service, GPU/VRAM resource bars, AI Configuration card |
| `components/gov-chat-frontend/src/services/adminDashboardService.js` | Added `getAIConfig()` API call |

---

## Future Improvements

- **Automatic polling:** Add configurable frontend polling interval (e.g., every 60s) instead of only on mount
- **Health history:** Store probe results in ArangoDB for uptime dashboards and trend analysis
- **Alerting:** Push notifications to admins when services transition from good → error
- **Individual container restart:** Admin UI button to restart a specific container via Docker API
- **Keycloak health check:** Add probe to Keycloak's `/auth/realms/agrivisory` endpoint
- **Response time tracking per service:** Store probe latencies over time for SLA reporting
