# GENIE.AI — Logging & Observability Architecture Evaluation

**OpenSearch vs VictoriaMetrics vs SigNoz: Comprehensive Comparison**

| Field | Detail |
|---|---|
| **Author** | David Forden |
| **Date** | 2026-04-16 |
| **Status** | Evaluation Draft v3 |
| **Scope** | Full-stack observability across all application tiers |
| **Constraint** | OSI-approved open-source licenses; permissive preferred, AGPL acceptable for runtime dependencies (no modification) |

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Current State Assessment](#2-current-state-assessment)
3. [The Three Candidates](#3-the-three-candidates)
4. [Licensing Deep Dive](#4-licensing-deep-dive)
5. [Architecture Comparison](#5-architecture-comparison)
6. [Application Tier Coverage](#6-application-tier-coverage)
7. [Resource & Performance Analysis](#7-resource--performance-analysis)
8. [Scalability Analysis](#8-scalability-analysis)
9. [Kubernetes Migration Path](#9-kubernetes-migration-path)
10. [Detailed Pros & Cons](#10-detailed-pros--cons)
11. [Risk Assessment](#11-risk-assessment)
12. [Decision Matrix](#12-decision-matrix)
13. [Recommendation](#13-recommendation)
14. [MELT Provider API Architecture](#14-melt-provider-api-architecture)
15. [Appendices](#15-appendices)

---

## 1. Executive Summary

This evaluation compares three candidate observability stacks for GENIE.AI, a production-grade AI/RAG framework targeting 200,000 users on sovereign compute infrastructure. The stack must cover all application tiers (Node.js backend, Python AI services, Vue.js frontend, Kong gateway) and support Kubernetes HPA deployment.

### v3 Changes from Previous Evaluation

| Change | Previous (v2) | Current (v3) |
|---|---|---|
| **Top priority** | Balanced scoring | **Kubernetes simplicity & HPA compatibility** |
| **AGPL licensing** | Disqualified | **Acceptable for runtime dependencies** (not modifying) |
| **Visualization gap** | VictoriaMetrics had no compliant dashboard | **Grafana (AGPLv3) now acceptable** — resolves the gap |
| **Architecture** | Single backend recommendation | **MELT Provider API** — configurable backend abstraction |

**The three candidates at a glance:**

| | OpenSearch | VictoriaMetrics Stack | SigNoz |
|---|---|---|---|
| **Type** | Search engine (logs-focused) | Metrics-first MELT platform | Full MELT APM platform |
| **Maturity** | Battle-tested, 10+ years | Metrics GA; Logs/Traces pre-GA | GA — production-ready |
| **MELT Coverage** | Logs only (Metrics/Traces deferred) | All three (Logs/Traces pre-GA) | **All three — GA** |
| **Resource Efficiency** | JVM-heavy (2-8 GB RAM) | Excellent (Go, ~700 MB total) | Good (ClickHouse + Go) |
| **Visualization** | Built-in Dashboards (Apache 2.0) | **Grafana (AGPLv3 — acceptable)** | Built-in UI (MIT) |
| **License (full stack)** | Apache 2.0 | Apache 2.0 + AGPLv3 (Grafana runtime) | MIT + Apache 2.0 |
| **K8s HPA Compatibility** | Low (JVM, StatefulSet) | **Excellent** (stateless components) | Moderate (ClickHouse stateful) |
| **Full-Text Search** | Best-in-class (Lucene) | Adequate (LogsQL) | Good (ClickHouse SQL) |
| **Existing code in GENIE.AI** | Yes (donated) | No | No |

**The recommendation has changed.** With AGPL accepted for runtime dependencies and K8s/HPA simplicity as the top priority, **VictoriaMetrics + Grafana** emerges as the recommended stack. Its stateless architecture (vminsert, vmselect) is uniquely suited to Kubernetes HPA, and Grafana (AGPLv3) resolves the visualization gap that previously disqualified it.

The MELT Provider API abstraction layer ensures backend portability — VictoriaMetrics is the default provider, but SigNoz and OpenSearch can be swapped in via configuration without changing application code.

---

## 2. Current State Assessment

### 2.1 Application Architecture

GENIE.AI is a microservices architecture with **25+ Docker services** across 4 compose variants (RTX 4060, T4, RTX 6000 ADA, main).

**Application Tiers:**

| Tier | Technology | Services | Current Logging |
|---|---|---|---|
| **Frontend** | Vue 3 | `frontend` | Client-side only (not in scope) |
| **API Gateway** | Kong | `kong`, `nginx` | File-based (`./api-gateway-solution/kong_logs/`) |
| **Node.js Backend** | Express | `backend`, `document-repository` | Winston → files (`./logs/`) |
| **Python AI** | FastAPI/Flask | `chatqna`, `dataprep`, `retriever`, `reranker`, `guardrail`, `translation`, `http-service` | OPEA CustomLogger → console + print statements |
| **GPU Inference** | vLLM, TEI | `vllm`, `vllm-translation-guardrail`, `tei`, `tei_reranker`, `embedding`, `textgen` | Console output (unstructured) |
| **Infrastructure** | PostgreSQL, Redis, ArangoDB | `kong-database`, `redis-cache`, `arango-vector-db`, `clamav` | Container stdout/stderr only |

### 2.2 Node.js Logging (Winston)

**File:** `components/shared/lib/logger.js`

- **Format:** Plain text (NOT JSON) — `${timestamp} [${level.toUpperCase()}]: ${message}`
- **Transports:** Console (colorized), DailyRotateFile (error + combined), static combined.log (5 MB, tailable)
- **Levels:** error, warn, info, debug (default: `info`)
- **Retention:** 30 days (daily rotated, zipped)
- **Reconfiguration:** Runtime reconfiguration supported via `reconfigureLogger()`
- **Environment Variable:** `LOG_LEVEL=debug`, `LOGFLAG=true`

**197 logger calls** across the Node.js services, plus admin log query/search API endpoints that currently parse files.

### 2.3 Python Logging (OPEA CustomLogger)

- **Framework:** OPEA `CustomLogger` from `comps` module
- **Pattern:** `logger = CustomLogger("SERVICE_NAME")` with conditional `if logflag:` guards
- **Output:** Console/stdout only — no file persistence, no structured JSON
- **Levels:** info, warning, error, debug (debug behind `logflag` flag)
- **Print statements:** 26 raw `print()` calls remain (mostly config debugging in dataprep)
- **Services covered:** 9 Python files across chatqna, dataprep, retriever, reranker

### 2.4 What's Missing

- No centralized log aggregation
- No metrics collection
- No distributed tracing
- No structured JSON logging
- No log correlation IDs (`request_id`)
- No log shipping/forwarding agents
- No alerting on log patterns
- `TELEMETRY_ENDPOINT` defined in env but **not implemented**

---

## 3. The Three Candidates

### 3.1 Candidate A: OpenSearch (Current Specification)

**Your specification proposes:**

```
Winston → Shared Volume → OTel Collector (filelog receiver) → OpenSearch → OpenSearch Dashboards
```

**Components:**

| Component | Role | License |
|---|---|---|
| Winston | Application logging (existing) | MIT |
| OpenTelemetry Collector | Log ingestion pipeline | Apache 2.0 |
| OpenSearch | Log storage & search | Apache 2.0 |
| OpenSearch Dashboards | Visualization & dashboards | Apache 2.0 |

**Your GitLab issue (#354) takes a different approach** — direct-to-OpenSearch via Winston transport, bypassing the shared volume and OTel Collector. This is architecturally cleaner for Kubernetes (no volume dependencies) but creates tighter coupling between Winston and OpenSearch.

### 3.2 Candidate B: VictoriaMetrics Stack (Jerome's Recommendation)

**Jerome proposes the MELT approach:**

```
All Services → stdout/stderr → OTel Collector DaemonSet → VictoriaLogs + VictoriaMetrics + VictoriaTraces → Grafana
```

**Components:**

| Component | Role | License | Maturity |
|---|---|---|---|---|
| VictoriaMetrics | Metrics storage & querying | Apache 2.0 | Production (GA) |
| VictoriaLogs | Log storage & querying | Apache 2.0 | Beta / Pre-GA |
| VictoriaTraces | Distributed trace storage | Apache 2.0 | Beta / Pre-GA |
| vmalert | Alerting engine | Apache 2.0 | Production (GA) |
| vmui | Built-in query UI | Apache 2.0 | Basic |
| Grafana | Dashboards & visualization | **AGPLv3** (runtime) | Production (GA) |
| OpenTelemetry Collector | Universal ingestion pipeline | Apache 2.0 | Production (GA) |

### 3.3 Candidate C: SigNoz (Discovered Alternative)

**SigNoz provides a complete, OTel-native MELT platform:**

```
All Services → stdout/stderr → OTel Collector → SigNoz (Go backend) → ClickHouse (storage)
                                                                ↓
                                                         SigNoz UI (React)
                                                    (Dashboards, Traces,
                                                     Alerts, Service Maps)
```

**Components:**

| Component | Role | License | Maturity |
|---|---|---|---|---|
| SigNoz Backend | Query service, OTel ingestion | **MIT** | Production (GA) |
| SigNoz Frontend | React-based dashboard UI | **MIT** | Production (GA) |
| ClickHouse | Columnar storage for all telemetry | Apache 2.0 | Production (GA) |
| OpenTelemetry Collector | Universal ingestion pipeline | Apache 2.0 | Production (GA) |
| Kafka (optional) | Buffering for high-throughput | Apache 2.0 | Production (GA) |

**License verified from source** — the MIT Expat license is confirmed directly from the [SigNoz GitHub LICENSE file](https://github.com/SigNoz/signoz/blob/main/LICENSE). The `ee/` and `cmd/enterprise/` directories are under a separate proprietary license and are not required for self-hosted deployment.

---

## 4. Licensing Deep Dive

### 4.1 License Classification

| License | Type | OSI Approved | Permissive? | Copyleft? |
|---|---|---|---|---|
| Apache 2.0 | Permissive | Yes | Yes | No |
| MIT | Permissive | Yes | Yes | No |
| BSD 2/3-Clause | Permissive | Yes | Yes | No |
| AGPLv3 | Strong Copyleft | Yes | **No** | **Yes** |
| SSPL | Source-available | **No** | **No** | **Yes** |
| Elastic License 2.0 | Source-available | **No** | **No** | **Yes** |

### 4.2 AGPL Policy Update (v3)

**Previous policy:** AGPLv3 was disqualified entirely — no AGPL-licensed components permitted.

**Updated policy:** AGPLv3 is **acceptable for runtime dependencies that are not modified**. This means:

- **Allowed:** Running Grafana (AGPLv3) as-is, configured via YAML/env vars, with custom dashboards defined in JSON
- **Allowed:** Running Grafana Loki or Grafana Tempo as-is for log/trace storage
- **Not allowed:** Forking, patching, or modifying AGPL-licensed source code and distributing the modified version
- **Not allowed:** Incorporating AGPL-licensed code into GENIE.AI's own source

**Rationale:** GENIE.AI is not modifying Grafana — it is used as a standalone runtime dependency. Custom dashboards are defined in Grafana's JSON model (configuration data, not source code). This is the same model used by thousands of enterprises running Grafana internally without AGPL obligations extending to their application code.

### 4.3 Component License Audit

#### OpenSearch Stack

| Component | License | Compliant? |
|---|---|---|
| OpenSearch | Apache 2.0 | YES |
| OpenSearch Dashboards | Apache 2.0 | YES |
| OpenTelemetry Collector | Apache 2.0 | YES |
| Winston + winston-daily-rotate-file | MIT | YES |

**Result: FULL COMPLIANCE (all permissive)**

#### VictoriaMetrics Stack (with Grafana)

| Component | License | Compliant? |
|---|---|---|
| VictoriaMetrics | Apache 2.0 | YES |
| VictoriaLogs | Apache 2.0 | YES |
| VictoriaTraces | Apache 2.0 | YES |
| vmalert | Apache 2.0 | YES |
| vmui (built-in) | Apache 2.0 | YES |
| OpenTelemetry Collector | Apache 2.0 | YES |
| Grafana (runtime, unmodified) | AGPLv3 | **YES** (runtime dependency) |

**Result: FULL COMPLIANCE (AGPL acceptable for runtime)**

#### SigNoz Stack

| Component | License | Compliant? |
|---|---|---|
| SigNoz Backend | **MIT** | YES |
| SigNoz Frontend (UI) | **MIT** | YES |
| ClickHouse | Apache 2.0 | YES |
| OpenTelemetry Collector | Apache 2.0 | YES |
| Kafka (optional) | Apache 2.0 | YES |

**Result: FULL COMPLIANCE (all permissive)**

### 4.4 Disqualified Alternatives

| Tool | License | Reason Disqualified |
|---|---|---|
| Elasticsearch | SSPL + Elastic License 2.0 | Not OSI-approved |
| Grafana Loki (standalone) | AGPLv3 | Not permissive (but acceptable as runtime if needed) |
| Grafana Tempo (standalone) | AGPLv3 | Not permissive (but acceptable as runtime if needed) |
| Uptrace | AGPLv3 | Not permissive (verified from GitHub source) |
| Graylog | SSPL | Not OSI-approved |
| HyperDX | BSL 1.1 | Not permissive |

### 4.5 License Verdict

| | OpenSearch Stack | VictoriaMetrics Stack | SigNoz Stack |
|---|---|---|---|
| **All components compliant?** | YES | **YES** (AGPL runtime OK) | YES |
| **Visualization included?** | YES (Dashboards) | **YES** (Grafana) | YES (UI) |
| **License risk** | None | **Low** (AGPL runtime) | None |
| **All permissive?** | YES | No (Grafana AGPLv3) | YES |

**All three candidates are now license-compliant.** VictoriaMetrics + Grafana is the only stack using AGPL, but this is acceptable under the updated policy.

---

## 5. Architecture Comparison

### 5.1 Data Flow — OpenSearch (Your Specification)

```
┌──────────────┐     ┌──────────────────┐     ┌────────────┐
│  Winston     │────▶│  Shared Volume   │────▶│  OTel       │
│  (Node.js)   │     │  /app-logs       │     │  Collector  │
└──────────────┘     └──────────────────┘     └──────┬─────┘
                                                      │
┌──────────────┐     ┌──────────────────┐            │
│  Python      │────▶│  stdout/stderr   │────────────┤
│  CustomLogger│     │  (container)     │            │
└──────────────┘     └──────────────────┘            │
                                                     ▼
                                              ┌────────────┐
                                              │ OpenSearch │
                                              │ (Apache 2) │
                                              └──────┬─────┘
                                                     │
                                                     ▼
                                              ┌────────────────┐
                                              │ OpenSearch     │
                                              │ Dashboards     │
                                              │ (Apache 2)     │
                                              └────────────────┘
```

**Issue:** The shared-volume approach in your spec doesn't work for Kubernetes. Your GitLab issue #354 correctly identifies this and proposes direct Winston-to-OpenSearch transport instead. But that creates tight coupling.

### 5.2 Data Flow — VictoriaMetrics + Grafana (Recommended)

```
┌──────────────┐     ┌──────────────────┐     ┌──────────────┐
│  Winston     │────▶│  stdout/stderr   │────▶│  OTel        │
│  (Node.js)   │     │  (JSON)          │     │  Collector   │
├──────────────┤     ├──────────────────┤     │  DaemonSet   │
│  Python      │────▶│  stdout/stderr   │────▶│              │
│  CustomLogger│     │  (JSON)          │     └──┬───┬───┬───┘
├──────────────┤     ├──────────────────┤        │   │   │
│  Kong/Nginx  │────▶│  access logs     │───────┘   │   │
├──────────────┤     ├──────────────────┤            │   │
│  vLLM / TEI  │────▶│  stdout/stderr   │────────────┤   │
└──────────────┘     └──────────────────┘            │   │
                                                      │   │
                                    ┌─────────────────┘   │
                                    │                     │
                                    ▼                     ▼                     ▼
                             ┌────────────┐      ┌──────────────┐    ┌──────────────┐
                             │VictoriaLogs│      │VictoriaMetrics│   │VictoriaTraces│
                             │  (Logs)    │      │  (Metrics)    │   │  (Traces)    │
                             └──────┬─────┘      └──────┬───────┘    └──────┬───────┘
                                    │                   │                    │
                                    └───────────────────┼────────────────────┘
                                                        │
                                                        ▼
                                                ┌──────────────┐
                                                │   Grafana    │
                                                │  (AGPLv3)    │
                                                │              │
                                                │  Dashboards  │
                                                │  Traces      │
                                                │  Alerts      │
                                                └──────────────┘
```

**Strength:** Single OTel Collector DaemonSet handles all signal types. Clean decoupling. Kubernetes-native. VictoriaMetrics components (vminsert, vmselect) are **stateless and HPA-friendly**. Grafana provides enterprise-grade visualization.

### 5.3 Data Flow — SigNoz

```
┌──────────────┐     ┌──────────────────┐     ┌──────────────┐
│  Winston     │────▶│  stdout/stderr   │────▶│  OTel        │
│  (Node.js)   │     │  (JSON)          │     │  Collector   │
├──────────────┤     ├──────────────────┤     │  DaemonSet   │
│  Python      │────▶│  stdout/stderr   │────▶│              │
│  CustomLogger│     │  (JSON)          │     └──────┬───────┘
├──────────────┤     ├──────────────────┤            │
│  Kong/Nginx  │────▶│  access logs     │────────────┤
├──────────────┤     ├──────────────────┤            │
│  vLLM / TEI  │────▶│  stdout/stderr   │────────────┤
└──────────────┘     └──────────────────┘            │
                                                      │
                                                      ▼
                                               ┌──────────────┐
                                               │  SigNoz      │
                                               │  Backend     │
                                               │  (Go / MIT)  │
                                               └──────┬───────┘
                                                      │
                                                      ▼
                                               ┌──────────────┐
                                               │ ClickHouse   │
                                               │ (Apache 2.0) │
                                               │              │
                                               │ Logs         │
                                               │ Metrics      │
                                               │ Traces       │
                                               └──────────────┘
                                                      │
                                                      ▼
                                               ┌──────────────┐
                                               │ SigNoz UI    │
                                               │ (React / MIT)│
                                               │              │
                                               │ Dashboards   │
                                               │ Traces       │
                                               │ Alerts       │
                                               │ Service Maps │
                                               └──────────────┘
```

**Strength:** Single pipeline, single storage backend, single visualization layer — all permissively licensed. Production-ready. Kubernetes-native.
**Weakness:** ClickHouse is stateful and harder to HPA than VictoriaMetrics components. ZooKeeper dependency for clusters.

### 5.4 Architecture Quality Assessment

| Criterion | OpenSearch | VictoriaMetrics | SigNoz |
|---|---|---|---|
| **Decoupling** | Moderate — volume-based or direct Winston transport | Excellent — stdout → OTel → backend | Excellent — stdout → OTel → backend |
| **Kubernetes readiness** | Requires refactoring (volume → stdout or direct transport) | **Native** — DaemonSet reads container stdout | Native — DaemonSet reads container stdout |
| **HPA compatibility (backend)** | **Low** — JVM, StatefulSet, manual scaling | **Excellent** — stateless vminsert/vmselect, HPA-ready | **Moderate** — ClickHouse stateful, manual sharding |
| **Signal types supported** | Logs (primary), Metrics (via plugins) | Metrics, Logs, Traces — unified MELT | Metrics, Logs, Traces — unified MELT |
| **Single pipeline** | No — logs go to OpenSearch, metrics need separate solution | Yes — one OTel Collector handles all signals | Yes — one OTel Collector handles all signals |
| **Single storage backend** | Yes (OpenSearch for logs only) | No (3 separate VictoriaMetrics binaries) | Yes (ClickHouse for all signals) |
| **Vendor lock-in risk** | Low — Lucene-compatible, SQL queries | Low — OTel native, PromQL/MetricsQL/LogsQL | Low — OTel native, SQL queries |
| **Complexity** | High — JVM tuning, index management | **Low** — single Go binaries, minimal config | Moderate — ClickHouse tuning + Go services |

---

## 6. Application Tier Coverage

### 6.1 How Each Stack Addresses Every Tier

| Application Tier | OpenSearch Approach | VictoriaMetrics Approach | SigNoz Approach |
|---|---|---|---|
| **Vue.js Frontend** | Out of scope (deferred) | Same — defer to Phase 2 | Same — defer to Phase 2 |
| **Kong API Gateway** | Access logs via file tailing or OTel | OTel Collector tails container logs | OTel Collector tails container logs |
| **Node.js Backend** | Winston → OpenSearch transport (donated code) or OTel filelog | Winston → stdout JSON → OTel Collector | Winston → stdout JSON → OTel Collector |
| **Node.js Document Repo** | Same as backend | Same as backend | Same as backend |
| **Python ChatQnA** | New Python logger → OpenSearch API (#357) | Python logging → stdout JSON → OTel Collector | Python logging → stdout JSON → OTel Collector |
| **Python Dataprep** | Same | Same | Same |
| **Python Retriever** | Same | Same | Same |
| **Python Reranker** | Same | Same | Same |
| **Python Guardrail** | Same | Same | Same |
| **vLLM / TEI (GPU)** | Console capture via OTel filelog | OTel Collector tails container stdout | OTel Collector tails container stdout |
| **Infrastructure** | Not covered in spec | OTel Collector can capture container logs | OTel Collector can capture container logs |

### 6.2 Key Difference in Application Changes Required

**OpenSearch approach** requires a **custom logger for each language runtime** that writes to OpenSearch directly:
- Node.js: `winston-opensearch` transport (you have this code)
- Python: New `logger.py` proxy → OpenSearch API (Issue #357, #358)
- Each language needs its own OpenSearch client library integration
- Creates tight coupling to OpenSearch as the log backend

**VictoriaMetrics and SigNoz approaches** require **one change per language**: redirect output to structured JSON stdout/stderr.
- Node.js: Change Winston format from `printf` to `json`
- Python: Add JSON formatter to CustomLogger or standard `logging` module
- No backend-specific client libraries needed
- OTel Collector handles everything else uniformly
- **Backend-agnostic** — swap storage without touching application code

The stdout/stderr pattern is **cleaner and more portable** regardless of which backend you choose.

---

## 7. Resource & Performance Analysis

### 7.1 Memory Usage Comparison (Single-Node Docker)

| Component | Min RAM | Typical RAM | Notes |
|---|---|---|---|
| **OpenSearch** | 1-2 GB (JVM heap) | 2-8 GB | JVM overhead unavoidable; heap must be pre-allocated |
| **OpenSearch Dashboards** | 256-512 MB | 512 MB-1 GB | Node.js-based |
| **VictoriaMetrics** | 64 MB | 128-512 MB | Go binary, no JVM |
| **VictoriaLogs** | 64 MB | 128-256 MB | Go binary, no JVM |
| **VictoriaTraces** | 64 MB | 128-256 MB | Go binary, no JVM |
| **SigNoz Backend** | 128 MB | 256-512 MB | Go binary, no JVM |
| **SigNoz Frontend** | 64 MB | 128-256 MB | Node.js-based |
| **ClickHouse** | 512 MB | 1-2 GB | Columnar DB, can be tuned low |
| **Grafana** | 64 MB | 128-256 MB | Go binary |
| **OTel Collector** | 128 MB | 256-512 MB | Same for all stacks |
| **vmui** | ~10 MB | ~10 MB | Built into VictoriaMetrics binary |

**Total stack footprint:**

| Stack | Services | Total RAM (Min) | Total RAM (Typical) |
|---|---|---|---|
| OpenSearch + Dashboards + OTel | 3 | ~1.5 GB | **~3-5 GB** |
| VictoriaMetrics + Logs + Traces + Grafana + OTel | 6 | ~420 MB | **~1.2-1.8 GB** |
| SigNoz + ClickHouse + OTel | 4 | ~850 MB | **~2-3 GB** |

**VictoriaMetrics + Grafana is the most resource-efficient complete stack.** Even with Grafana added, the total footprint (~1.2-1.8 GB) is significantly less than OpenSearch (~3-5 GB) and SigNoz (~2-3 GB).

### 7.2 Storage Efficiency

| | OpenSearch | VictoriaLogs | ClickHouse (SigNoz) |
|---|---|---|---|
| **Compression** | Lucene standard (~5x raw) | Columnar, claims 10-30x raw | Columnar, ~10x raw |
| **Index overhead** | Inverted index segments, doc values | Stream-based columnar storage | MergeTree engine, parts merging |
| **Disk I/O pattern** | Heavy (index merging, segment flushes) | Light (append-only, compaction) | Moderate (MergeTree compaction) |
| **Storage for 1 TB raw logs** | ~200 GB | ~30-100 GB | ~100-150 GB |

### 7.3 CPU Usage

| | OpenSearch | VictoriaLogs | ClickHouse (SigNoz) |
|---|---|---|---|
| **Ingestion** | CPU-intensive (JSON parsing, index building) | Low (stream-based ingestion) | Moderate (columnar inserts) |
| **Query** | CPU-intensive for complex aggregations | Optimized for log-pattern queries | Very fast for analytical queries |
| **Background** | Segment merging, GC pauses | Compaction, no GC | MergeTree compaction, no GC |

### 7.4 Query Capabilities

| Query Type | OpenSearch | VictoriaLogs | SigNoz / ClickHouse |
|---|---|---|---|
| **Full-text search** | Best-in-class (Lucene) | Good (LogsQL full-text) | Good (ClickHouse full-text indexes) |
| **Nested JSON exploration** | Excellent (Lucene nested fields) | Adequate (JSON pipe in LogsQL) | Good (ClickHouse JSON functions) |
| **Aggregations** | Powerful (terms, histogram, cardinality) | Supported but less mature | Excellent (SUM, AVG, quantiles, etc.) |
| **Log pattern matching** | Good (Lucene query syntax) | Excellent (LogsQL pipe syntax) | Good (SQL WHERE + LIKE) |
| **Real-time alerting** | Built-in alerting plugin | vmalert (Prometheus-compatible) | Built-in alerting |
| **SQL queries** | SQL plugin available | No SQL support | **Native SQL** |
| **Trace waterfall** | Not supported | Grafana Jaeger plugin | **Built-in** |

**For GENIE.AI specifically:** Your logs contain deeply nested JSON from AI inference (RAG retrieval results, LLM responses, embedding vectors). OpenSearch's Lucene-based nested field querying is the strongest for this. ClickHouse has solid JSON support and excellent aggregation capabilities. VictoriaLogs' LogsQL can parse JSON but is less optimized for deep exploration of complex nested structures.

---

## 8. Scalability Analysis

### 8.1 Target: 200,000 Users

At 200K users, assuming average 10 requests/user/day with logging at each tier:
- Estimated log volume: **5-50 GB/day** (depending on debug level and AI inference verbosity)
- Peak ingestion: **5,000-50,000 logs/second**
- Required retention: 30 days hot + archive

### 8.2 Horizontal Scaling Paths

**OpenSearch:**

| Scale Point | Approach | Complexity |
|---|---|---|
| Beyond single node | Add data nodes, dedicated master, coordinator nodes | High — shard management, rebalancing |
| Index management | Daily indices (`backend-logs-%Y.%m.%d`), ILM policies | Moderate — requires tuning |
| Hot/Warm architecture | SSD for recent, HDD for old | Complex — requires index state management |
| Multi-region | Cross-cluster replication | Very complex |

**VictoriaMetrics:**

| Scale Point | Approach | Complexity |
|---|---|---|
| Beyond single node | `vmcluster` (separate ingest, storage, query) | **Low** — clear separation of concerns |
| Log scaling | VictoriaLogs cluster mode | **Low** — similar pattern to VictoriaMetrics |
| Hot/Warm | Native partitioning by time | Simple — built-in |
| Multi-region | VictoriaMetrics cluster replication | Moderate |

**SigNoz (ClickHouse):**

| Scale Point | Approach | Complexity |
|---|---|---|
| Beyond single node | ClickHouse cluster (sharded + replicated MergeTree) | **High** — shard key design matters |
| All signals scale together | ClickHouse handles logs, metrics, traces in same cluster | Simple — one cluster, one operational model |
| Hot/Warm | ClickHouse TTL + partition by time, move to cold storage | Simple — built-in |
| Multi-region | ClickHouse cross-replication | Moderate |
| Buffering | Kafka between OTel Collector and ClickHouse | Moderate — adds resilience |

### 8.3 Kubernetes HPA Compatibility

This is the **top-priority criterion** for GENIE.AI's Kubernetes migration.

| Stack | HPA for App Services | HPA for Observability Backend | Complexity |
|---|---|---|---|
| **OpenSearch** | Yes (once decoupled from volumes) | **No** — StatefulSet, JVM heap pre-allocated, manual scaling | **High** |
| **VictoriaMetrics** | Yes | **Yes** — `vmcluster` components (vminsert, vmselect) are **stateless**, scale independently via HPA; vmstorage is StatefulSet but handles scaling internally | **Low** |
| **SigNoz** | Yes | **Partial** — SigNoz Backend can scale, but ClickHouse requires StatefulSet with manual sharding | **Moderate** |

**Why VictoriaMetrics wins on HPA:**

The `vmcluster` architecture separates concerns into three component types:

```
                    ┌─────────────┐
                    │  vminsert   │ ◄── Stateless, HPA-ready
                    │  (ingest)   │     Scales with write volume
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │  vmstorage  │ ◄── Stateful, but handles partitioning internally
                    │  (storage)  │     Scales by adding nodes
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │  vmselect   │ ◄── Stateless, HPA-ready
                    │  (query)    │     Scales with query load
                    └─────────────┘
```

- **vminsert** and **vmselect** are stateless — they can be deployed as standard Deployments with HPA
- **vmstorage** is stateful but each node owns a partition of the time series — adding nodes is a simple operation
- No JVM tuning, no shard rebalancing, no GC pauses
- Compare to ClickHouse (SigNoz): manual shard key selection, ZooKeeper coordination, complex resharding operations

### 8.4 Operational Complexity at Scale

| Factor | OpenSearch | VictoriaMetrics | SigNoz / ClickHouse |
|---|---|---|---|
| **Day-1 setup** | Moderate (JVM tuning, security config) | **Simple** (single binary, defaults) | Moderate (ClickHouse config + SigNoz services) |
| **Day-30 operations** | High (shard management, GC tuning) | **Low** (minimal tuning needed) | Moderate (ClickHouse MergeTree management) |
| **Day-365 operations** | Very high (cluster health, rebalancing) | **Low-Moderate** (cluster mode) | Moderate (ClickHouse cluster ops) |
| **Typical failure modes** | Split brain, shard allocation, OOM | Disk full, compaction lag | ClickHouse ZooKeeper issues, disk full |
| **Recovery time** | Slow (shard recovery, index rebuild) | **Fast** (stream replay) | Moderate (ClickHouse replication recovery) |
| **K8s operational model** | Complex (Operator + StatefulSet) | **Simple** (Deployments + HPA + 1 StatefulSet) | Moderate (StatefulSet + ZooKeeper) |

---

## 9. Kubernetes Migration Path

### 9.1 Component Mapping

| Component | K8s Primitive | OpenSearch | VictoriaMetrics | SigNoz |
|---|---|---|---|---|
| Node.js App | Deployment / HPA | Same | Same | Same |
| Python AI Services | Deployment / HPA | Same | Same | Same |
| OTel Collector | DaemonSet | Same | Same | Same |
| Log Storage | StatefulSet + PVC | OpenSearch (complex) | VictoriaLogs (simpler) | ClickHouse (moderate) |
| Metrics Storage | N/A (not in spec) | Not covered | VictoriaMetrics | ClickHouse (same cluster) |
| Trace Storage | N/A (Phase 2) | Not covered | VictoriaTraces | ClickHouse (same cluster) |
| Dashboard | Deployment | OpenSearch Dashboards | **Grafana** | SigNoz UI |
| Alerting | N/A | OpenSearch plugin | vmalert → Grafana | SigNoz built-in |
| Ingest Router | N/A | Not needed | **vminsert (HPA)** | SigNoz Backend |
| Query Router | N/A | Not needed | **vmselect (HPA)** | SigNoz Backend |

### 9.2 Kubernetes Deployment Options

**OpenSearch:**
- Requires dedicated operator (OpenSearch Operator or ECK)
- JVM heap must match node resources — inflexible for HPA
- Well-documented, many production references

**VictoriaMetrics:**
- Official Helm chart available
- `vmcluster` separates ingest/storage/query
- **vminsert and vmselect are Deployments with HPA** — K8s auto-scales based on CPU/memory/custom metrics
- No JVM tuning needed
- vmstorage uses StatefulSet but scaling is straightforward (add node, it claims a time partition)

**SigNoz:**
- Official Helm chart available
- Includes ClickHouse cluster configuration
- OTel Collector as DaemonSet
- ClickHouse requires StatefulSet + ZooKeeper/Keeper for replication
- **ClickHouse horizontal scaling requires manual shard key design** — not HPA-friendly

### 9.3 HPA Readiness Summary

| Aspect | OpenSearch | VictoriaMetrics | SigNoz |
|---|---|---|---|
| **Can ingest layer auto-scale via HPA?** | No | **Yes (vminsert)** | Partial (SigNoz Backend) |
| **Can query layer auto-scale via HPA?** | No | **Yes (vmselect)** | Partial (SigNoz Backend) |
| **Storage layer scaling model** | Shard rebalancing | Add vmstorage nodes | Manual ClickHouse sharding |
| **Stateful components to manage** | OpenSearch cluster | vmstorage only | ClickHouse + ZooKeeper |
| **Operator required?** | Yes (recommended) | No (Helm chart sufficient) | No (Helm chart sufficient) |

---

## 10. Detailed Pros & Cons

### 10.1 OpenSearch Stack

#### Pros

1. **Mature and battle-tested** — 10+ years of production use across thousands of enterprises. Well-understood failure modes, extensive documentation, large community.

2. **Best-in-class full-text search** — Lucene's inverted index is unmatched for searching through deeply nested AI inference logs, RAG retrieval results, and complex JSON structures. This is a material advantage for GENIE.AI's use case.

3. **Complete, self-contained solution** — OpenSearch + Dashboards provides everything needed: storage, search, visualization, alerting, anomaly detection. No external visualization dependency.

4. **Full license compliance** — Every component is Apache 2.0. No license concerns whatsoever.

5. **You already have working code** — Your donated Winston-to-OpenSearch logger, Python logger design, and admin log query refactoring plan are all ready to go. This de-risks implementation significantly.

6. **Rich query language** — Supports Lucene queries, SQL (via plugin), PPL (Piped Processing Language), and REST API.

7. **Kibana-class Dashboards** — OpenSearch Dashboards provides enterprise-grade visualization: saved dashboards, template variables, alerting UI, anomaly detection, security analytics.

#### Cons

1. **JVM resource overhead** — Requires 2-8 GB RAM minimum. On GPU-constrained infrastructure, this is a real cost. JVM GC pauses can cause latency spikes.

2. **Logs-only architecture** — Does not natively handle metrics or traces. Your spec defers these to Phase 2, but even then OpenSearch is not the right tool for metrics (no PromQL, no Prometheus compatibility). You would need a separate metrics stack.

3. **Operational complexity** — Cluster management, shard allocation, index lifecycle policies, JVM tuning, security plugin configuration. Grows significantly at scale.

4. **Not HPA-friendly** — OpenSearch itself cannot be horizontally auto-scaled via HPA. Requires StatefulSet with manual or operator-driven scaling. **This is the top-priority criterion and OpenSearch fails it.**

5. **Direct Winston coupling** — Your GitLab issue approach (Winston → OpenSearch directly) creates tight coupling between application code and the log backend. Violates the decoupling principle.

6. **No unified MELT pipeline** — Logs go to OpenSearch, metrics would need Prometheus/VictoriaMetrics, traces would need Jaeger/Tempo. Three separate backends, three separate operational domains.

7. **Slower container startup** — JVM startup time is 10-30 seconds.

8. **Index management overhead** — Daily indices require lifecycle management, index templates, and rollover strategies.

### 10.2 VictoriaMetrics Stack

#### Pros

1. **True MELT architecture** — Metrics, Events (via logs), Logs, and Traces all flow through a single OTel Collector pipeline. Jerome is correct that this is architecturally superior.

2. **Extremely resource-efficient** — 3-5x less RAM than OpenSearch. Go-based binaries with no JVM overhead. More resources for AI inference on GPU-constrained infrastructure.

3. **Kubernetes-native design** — stdout/stderr → DaemonSet → backend is the canonical K8s logging pattern. No volume dependencies.

4. **Best HPA compatibility of all candidates** — vminsert and vmselect are stateless and scale independently via HPA. vmstorage handles internal partitioning. This is the **only stack where the ingest and query layers can auto-scale** without operator intervention.

5. **Excellent backend-agnostic decoupling** — Services emit JSON to stdout. OTel Collector routes to any backend. Swap backends without touching application code.

6. **Unified operational model** — VictoriaMetrics, VictoriaLogs, and VictoriaTraces share the same operational patterns: single binary, sensible defaults, minimal config.

7. **Outstanding metrics capability** — VictoriaMetrics is one of the best Prometheus-compatible TSDBs available. Production-proven at massive scale (Roblox, Discord, Wix).

8. **Superior scalability** — Cluster mode with clear separation of ingest, storage, and query. Each component scales independently.

9. **Simpler operations** — No shard management, no GC tuning, no JVM configuration. Sensible defaults.

10. **10-30x better storage compression** — Columnar storage dramatically reduces disk costs.

11. **Grafana integration is mature** — VictoriaMetrics has first-class Grafana data source plugins. Grafana's Jaeger tracing plugin works with VictoriaTraces. Dashboards, alerts, and trace waterfalls all work out of the box.

12. **Minimal stateful components** — Only vmstorage requires StatefulSet. Everything else is Deployment + HPA.

#### Cons

1. **VictoriaLogs is pre-GA** — The single biggest risk. May have undiscovered bugs, missing features, or breaking changes before v1.0. Adopting pre-GA for 200K users carries real risk.

2. **VictoriaTraces is pre-GA** — Same risk. Distributed tracing is in beta/preview.

3. **AGPL dependency (Grafana)** — Grafana is AGPLv3. While acceptable as a runtime dependency, it introduces a license that is not permissive. Some organizations may still find this uncomfortable.

4. **Weaker full-text search** — LogsQL is good for log-pattern queries but not as powerful as Lucene for exploring deeply nested AI inference JSON.

5. **No existing implementation** — No VictoriaMetrics integration exists in GENIE.AI. Everything must be built from scratch.

6. **Smaller ecosystem** — Fewer plugins, fewer integrations, less documentation than OpenSearch.

7. **No built-in anomaly detection or ML** — Relies on simple threshold alerting via vmalert.

8. **LogsQL learning curve** — Team must learn a new query language.

### 10.3 SigNoz Stack

#### Pros

1. **Full MELT in one platform — production-ready** — Logs, Metrics, and Traces are all GA, all flowing through a single OTel Collector pipeline into ClickHouse. No separate backends for each signal type.

2. **Built-in visualization under permissive license** — The SigNoz UI (MIT license) provides dashboards, trace waterfall views, service maps, and alerting. The only fully permissive MELT stack.

3. **OpenTelemetry-native** — Built on OTel from the ground up. No vendor lock-in. Uses the same OTel Collector pipeline. Backend-agnostic service instrumentation.

4. **ClickHouse as unified storage** — All telemetry signals stored in one Apache 2.0-licensed columnar database. Proven at massive scale (Cloudflare, Uber, Cisco). Native SQL query language.

5. **Kubernetes-native** — stdout/stderr → OTel DaemonSet → SigNoz is the canonical K8s pattern. Official Helm chart available.

6. **Excellent backend-agnostic decoupling** — Same as VictoriaMetrics: services emit JSON to stdout, OTel Collector handles routing.

7. **Trace waterfall views built-in** — Distributed tracing with span-level visualization is available from day one.

8. **Built-in alerting** — Alerting is included in the SigNoz UI, not a separate component.

9. **Single operational model** — One storage backend (ClickHouse), one query language (SQL), one UI.

#### Cons

1. **No existing implementation in GENIE.AI** — Like VictoriaMetrics, there is no SigNoz integration in the codebase.

2. **ClickHouse is harder to HPA than VictoriaMetrics** — ClickHouse requires StatefulSet, ZooKeeper/Keeper for coordination, and manual shard key design. Cannot auto-scale via HPA like vminsert/vmselect. **This is the decisive disadvantage vs VictoriaMetrics for the K8s priority.**

3. **ClickHouse operational complexity** — MergeTree engine configuration, ZooKeeper coordination for clusters, partition key design, and memory management.

4. **Heavier than VictoriaMetrics** — ClickHouse uses more RAM (~1-2 GB) than VictoriaLogs/VictoriaMetrics combined (~700 MB).

5. **Smaller community than OpenSearch** — While growing rapidly, fewer Stack Overflow answers, fewer blog posts, fewer production references at scale.

6. **Weaker full-text search than OpenSearch** — ClickHouse's full-text search capabilities are good but not as mature as Lucene's inverted index.

7. **ClickHouse ZooKeeper dependency** — For clustered deployments, ClickHouse requires ZooKeeper (or ClickHouse Keeper) for replication coordination. This adds operational complexity.

8. **Less mature than OpenSearch** — While GA, SigNoz is a younger project than OpenSearch.

---

## 11. Risk Assessment

### 11.1 Risk Matrix

| Risk | OpenSearch | VictoriaMetrics | SigNoz | Likelihood | Impact |
|---|---|---|---|---|---|
| **License non-compliance** | Low | Low (AGPL runtime OK) | Low | Low | Critical |
| **Backend not production-ready** | Very Low | **Medium** (Logs/Traces pre-GA) | Low | Medium | High |
| **Insufficient compute resources** | **High** (JVM overhead) | Low | Medium | High | High |
| **Cannot scale to 200K users** | Low | Low | Low | Low | Critical |
| **Complex nested JSON query failure** | Low | Medium | Low-Medium | Medium | Medium |
| **Operational complexity exceeds team capacity** | **High** | **Low** | Medium | Medium | Medium |
| **Kubernetes HPA failure** | **High** (JVM, StatefulSet) | **Low** (stateless components) | **Medium** (ClickHouse stateful) | Medium | **Critical** |
| **No visualization for logs** | Very Low | Low (Grafana resolves) | Very Low | Low | Critical |
| **Vendor lock-in** | Low | Low | Low | Low | Medium |
| **Breaking changes in upstream** | Low (stable) | **Medium** (pre-GA) | Low (GA) | Medium | High |
| **No existing code to start from** | No (you have code) | **Yes** | **Yes** | High | Medium |

### 11.2 Critical Risk Analysis

**OpenSearch's biggest risk (v3):** Kubernetes HPA incompatibility. With K8s/HPA simplicity as the top priority, OpenSearch's JVM overhead, StatefulSet requirement, and inability to auto-scale its ingest/query layers are the decisive disqualifying factors. The logs-only architecture further compounds this — you'd need separate metrics and traces stacks, each with their own K8s management burden.

**VictoriaMetrics' biggest risk:** VictoriaLogs and VictoriaTraces are pre-GA. Adopting beta software for a 200K-user production system is risky. However, VictoriaMetrics (the metrics component) is battle-tested at massive scale, and the architecture (stateless vminsert/vmselect) is proven. The MELT Provider API abstraction mitigates this — if VictoriaLogs proves problematic, you can swap to SigNoz or OpenSearch for logs without changing application code.

**SigNoz's biggest risk:** ClickHouse is harder to manage in Kubernetes than VictoriaMetrics components. ClickHouse's stateful nature and ZooKeeper dependency make it less HPA-friendly. For the K8s/HPA priority, this is a meaningful disadvantage.

---

## 12. Decision Matrix

### 12.1 Weighted Scoring (1-5, 5 = Best)

**v3 Weighting: K8s/HPA simplicity is the top priority.**

| Criterion | Weight | OpenSearch | VictoriaMetrics | SigNoz | Notes |
|---|---|---|---|---|---|
| **K8s HPA compatibility** | **12** | 1 | **5** | 3 | VM stateless ingest/query; OS cannot HPA |
| **Operational simplicity** | **10** | 2 | **5** | 3 | Go binaries vs JVM vs ClickHouse+ZK |
| **Resource efficiency** | **9** | 2 | **5** | 4 | ~1.5 GB vs ~3-5 GB vs ~2-3 GB |
| MELT coverage | **8** | 2 | **5** | **5** | OS logs-only; VM and SigNoz full MELT |
| License compliance | **7** | 5 | 4 | **5** | VM has AGPL runtime (acceptable) |
| Visualization quality | **7** | 5 | **5** | 4 | Grafana matches OS Dashboards |
| Scalability to 200K users | **7** | 4 | **5** | 4 | All can scale; VM cluster cleanest |
| Kubernetes readiness | **7** | 3 | **5** | 4 | stdout pattern for all; VM best HPA |
| Maturity / production readiness | **6** | 5 | 3 | 4 | OS most mature; VM metrics GA, logs/traces pre-GA |
| Future-proofing (metrics/traces) | **6** | 2 | **5** | **5** | OS needs separate stack |
| Full-text search quality | **5** | 5 | 3 | 4 | Lucene advantage for AI logs |
| Existing implementation | **4** | 5 | 1 | 1 | Donated code advantage for OS |
| Team learning curve | **4** | 4 | 3 | **4** | SQL (SigNoz) widely known; LogsQL new |
| Backup / disaster recovery | **4** | 4 | 4 | 4 | All have viable options |
| Community / ecosystem | **3** | 5 | 3 | 3 | OpenSearch ecosystem is massive |

### 12.2 Weighted Scores

| | OpenSearch | VictoriaMetrics Stack | SigNoz Stack |
|---|---|---|---|
| **Raw weighted total** | **258** | **341** | **300** |
| **Normalized (out of 5)** | **3.17** | **4.19** | **3.69** |

### 12.3 What the Numbers Say

**VictoriaMetrics is the clear winner when K8s/HPA simplicity is the top priority.** The gap between VictoriaMetrics (341) and SigNoz (300) is significant — 41 points driven primarily by:

- **HPA compatibility** (12 points): VictoriaMetrics 5 vs SigNoz 3 = 24-point gap on the highest-weighted criterion
- **Operational simplicity** (10 points): VictoriaMetrics 5 vs SigNoz 3 = 20-point gap
- **Resource efficiency** (9 points): VictoriaMetrics 5 vs SigNoz 4 = 9-point gap

OpenSearch drops to third place (258) due to poor HPA compatibility, JVM overhead, and logs-only architecture.

### 12.4 v2 vs v3 Score Comparison

| | v2 Score | v3 Score | Change |
|---|---|---|---|
| **OpenSearch** | 296 | 258 | -38 (HPA weight hurts JVM) |
| **VictoriaMetrics** | 271 | **341** | +70 (AGPL resolves viz gap + HPA weight rewards stateless arch) |
| **SigNoz** | **298** | 300 | +2 (stable, minor gains from HPA weight) |

**The winner flipped.** In v2, SigNoz won by 2 points over OpenSearch, with VictoriaMetrics in last place due to the visualization gap. In v3, accepting AGPL for Grafana resolves VictoriaMetrics' blocking issue, and the K8s/HPA weighting amplifies its architectural advantage (stateless components) over ClickHouse (SigNoz) and JVM (OpenSearch).

---

## 13. Recommendation

### 13.1 Recommended Stack: VictoriaMetrics + Grafana

**What you deploy:**

```
All Services → stdout/stderr JSON → OTel Collector DaemonSet → VictoriaMetrics Stack → Grafana
                                                        │
                                                        ├── VictoriaLogs (logs storage)
                                                        ├── VictoriaMetrics (metrics storage)
                                                        └── VictoriaTraces (trace storage)
```

**Why VictoriaMetrics wins:**

1. **Best K8s/HPA compatibility** — vminsert and vmselect are stateless Deployments that auto-scale via HPA. No other candidate offers this. For a system targeting 200K users on sovereign compute, this is the decisive factor.

2. **Lightest resource footprint** — ~1.2-1.8 GB total (including Grafana) vs ~2-3 GB (SigNoz) vs ~3-5 GB (OpenSearch). More resources available for GPU inference.

3. **Simplest operations** — Go binaries, sensible defaults, no JVM tuning, no shard management, no ZooKeeper. Minimal stateful components (only vmstorage).

4. **Grafana resolves the visualization gap** — AGPLv3 is acceptable for runtime dependencies. Grafana provides enterprise-grade dashboards, alerting, and Jaeger-compatible trace visualization.

5. **MELT Provider API provides insurance** — If VictoriaLogs (pre-GA) proves problematic, the abstraction layer allows swapping to SigNoz or OpenSearch for logs without changing application code.

### 13.2 Implementation Plan

**Phase 1: Foundation (stdout/stderr + OTel Collector)**

1. **Refactor Winston** — Change format from `printf` to `json`, remove file transports, emit to stdout only
2. **Refactor Python CustomLogger** — Add JSON formatter, emit to stdout
3. **Deploy OTel Collector** — DaemonSet in Docker Compose (development) / Kubernetes (production)
4. **Define MELT Provider API** — TypeScript interfaces for log, metric, and trace queries

**Phase 2: VictoriaMetrics Deployment**

5. **Deploy VictoriaMetrics cluster** — Single-node for development, vmcluster for production
6. **Deploy VictoriaLogs** — Log storage backend
7. **Deploy VictoriaTraces** — Trace storage backend
8. **Deploy Grafana** — Dashboard, alerting, trace visualization
9. **Implement VictoriaMetricsProvider** — MELT Provider API implementation

**Phase 3: Integration**

10. **Refactor admin log query services** — Use MELT Provider API instead of file parsing
11. **Add distributed tracing** — OTel SDK instrumentation in Node.js and Python services
12. **Configure alerts** — vmalert rules for critical metrics and log patterns
13. **Build dashboards** — Service health, request latency, error rates, AI inference metrics

### 13.3 The MELT Provider API Insurance Policy

The key architectural decision is the **MELT Provider API abstraction layer** (detailed in Section 14). This ensures:

- **VictoriaMetrics is the default** — but not a hard dependency
- **SigNoz can replace VictoriaMetrics** if VictoriaLogs (pre-GA) proves insufficient
- **OpenSearch can be used for logs** if full-text search quality becomes critical
- **Switching backends requires only a configuration change** — no application code changes

### 13.4 GitLab Issue Rescope

The existing issues (#354-#361) were written for OpenSearch. They need rescope:

```
#354 (Parent) — Observability Platform Integration
├── #355 — Deploy VictoriaMetrics Stack (was: OpenSearch Deployment)
├── #356 — Refactor Shared-lib Winston (was: Winston → OpenSearch)
│         └── NOW: Winston → JSON stdout + OTel trace context
├── #357 — Implement MELT Provider API (was: Python Logger → OpenSearch)
│         └── NOW: TypeScript interfaces + VictoriaMetricsProvider
├── #358 — Refactor Python Logging (was: console → OpenSearch)
│         └── NOW: CustomLogger → JSON stdout
├── #359 — Refactor Node.js Admin Log Services (was: file → OpenSearch)
│         └── NOW: file → MELT Provider API
└── #361 — Build MELT Query Service (was: OpenSearch Log Query)
            └── NOW: logs-service.js thin wrapper over MELTService
```

### 13.5 The Principle That Matters Most

Regardless of which backend you choose, adopt this principle now:

> **Services must emit structured JSON to stdout/stderr. They must not be coupled to any specific log database. OpenTelemetry Collector is the universal pipeline. The MELT Provider API abstracts backend-specific query logic.**

This preserves the option to switch backends at any time. If VictoriaMetrics doesn't work out, you can swap to SigNoz or OpenSearch by changing the `MELT_PROVIDER` environment variable — without touching any application code.

---

## 14. MELT Provider API Architecture

### 14.1 Design Philosophy

The MELT Provider API is an abstraction layer that decouples application code from the specific observability backend. It provides a uniform interface for querying logs, metrics, and traces regardless of whether the backend is VictoriaMetrics, SigNoz, OpenSearch, or a future provider.

**Key principles:**

1. **Backend-agnostic** — Application code imports `MELTService`, never a specific provider
2. **Configuration-driven** — Provider selected via environment variable (`MELT_PROVIDER=victoriametrics`)
3. **Factory pattern** — `createMELTService()` returns the correct provider implementation
4. **Type-safe** — TypeScript interfaces for all query and response types
5. **Graceful fallback** — If the configured provider is unavailable, the service fails with a clear error (no silent fallback to wrong backend)

### 14.2 TypeScript Interfaces

```typescript
// components/shared/lib/melt/types.ts

/**
 * Represents a single log entry returned from a MELT provider.
 */
export interface LogEntry {
  timestamp: string;       // ISO 8601
  level: string;           // 'debug' | 'info' | 'warn' | 'error'
  message: string;
  service: string;         // e.g., 'backend', 'chatqna', 'dataprep'
  traceId?: string;        // OpenTelemetry trace ID
  spanId?: string;         // OpenTelemetry span ID
  requestId?: string;      // Application-level request ID
  userId?: string;         // User who triggered the request
  metadata?: Record<string, unknown>;  // Additional structured fields
}

/**
 * Query parameters for log searches.
 */
export interface LogQuery {
  service?: string;        // Filter by service name
  level?: string;          // Filter by log level
  message?: string;        // Full-text search in message
  startTime: string;       // ISO 8601 start time
  endTime?: string;        // ISO 8601 end time (defaults to now)
  traceId?: string;        // Filter by trace ID
  requestId?: string;      // Filter by request ID
  userId?: string;         // Filter by user
  limit?: number;          // Max results (default: 100)
  offset?: number;         // Pagination offset (default: 0)
  sort?: 'asc' | 'desc';   // Sort by timestamp (default: 'desc')
}

/**
 * Response from a log query.
 */
export interface LogQueryResult {
  entries: LogEntry[];
  total: number;           // Total matching entries (for pagination)
  took: number;            // Query execution time in ms
}

/**
 * Represents a distributed trace span.
 */
export interface TraceSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  operationName: string;
  serviceName: string;
  startTime: string;       // ISO 8601
  duration: number;        // Duration in milliseconds
  status: string;          // 'ok' | 'error'
  tags?: Record<string, string>;
  logs?: Array<{
    timestamp: string;
    fields: Record<string, unknown>;
  }>;
}

/**
 * Query parameters for trace lookups.
 */
export interface TraceQuery {
  traceId: string;         // Required: look up by trace ID
  startTime?: string;      // Optional time range
  endTime?: string;
}

/**
 * Response from a trace query.
 */
export interface TraceQueryResult {
  spans: TraceSpan[];
  traceId: string;
  totalSpans: number;
  duration: number;        // Total trace duration in ms
  services: string[];      // Services involved in this trace
  took: number;            // Query execution time in ms
}

/**
 * Query parameters for metric queries.
 */
export interface MetricQuery {
  metric: string;          // e.g., 'http_requests_total', 'llm_inference_duration_ms'
  service?: string;        // Filter by service
  startTime: string;       // ISO 8601
  endTime?: string;        // ISO 8601 (defaults to now)
  step?: string;           // Prometheus-style step (e.g., '5m', '1h')
  labels?: Record<string, string>;  // Additional label filters
}

/**
 * Response from a metric query.
 */
export interface MetricQueryResult {
  metric: string;
  datapoints: Array<{
    timestamp: string;     // ISO 8601
    value: number;
  }>;
  took: number;            // Query execution time in ms
}

/**
 * The MELT Provider interface — all backends must implement this.
 */
export interface MELTProvider {
  readonly name: string;

  // Health check
  isHealthy(): Promise<boolean>;

  // Logs
  queryLogs(query: LogQuery): Promise<LogQueryResult>;

  // Traces
  queryTrace(query: TraceQuery): Promise<TraceQueryResult>;

  // Metrics
  queryMetric(query: MetricQuery): Promise<MetricQueryResult>;
}
```

### 14.3 MELTService Facade

```typescript
// components/shared/lib/melt/melt-service.ts

import { MELTProvider, LogQuery, LogQueryResult, TraceQuery, TraceQueryResult, MetricQuery, MetricQueryResult } from './types';
import { VictoriaMetricsProvider } from './providers/victoriametrics-provider';
import { SignozProvider } from './providers/signoz-provider';
import { OpenSearchProvider } from './providers/opensearch-provider';

export class MELTService {
  private provider: MELTProvider;

  private constructor(provider: MELTProvider) {
    this.provider = provider;
  }

  /**
   * Factory function — creates a MELTService with the configured provider.
   * Provider is selected via MELT_PROVIDER environment variable.
   *
   * Supported values: 'victoriametrics' (default), 'signoz', 'opensearch'
   */
  static async create(): Promise<MELTService> {
    const providerName = process.env.MELT_PROVIDER || 'victoriametrics';

    let provider: MELTProvider;

    switch (providerName) {
      case 'victoriametrics':
        provider = new VictoriaMetricsProvider({
          logsUrl: process.env.MELT_LOGS_URL || 'http://victoriametrics-logs:9428',
          metricsUrl: process.env.MELT_METRICS_URL || 'http://victoriametrics:8428',
          tracesUrl: process.env.MELT_TRACES_URL || 'http://victoriametrics-traces:9411',
        });
        break;

      case 'signoz':
        provider = new SignozProvider({
          baseUrl: process.env.MELT_BASE_URL || 'http://signoz-backend:8080',
          clickHouseUrl: process.env.MELT_CLICKHOUSE_URL || 'http://clickhouse:9000',
        });
        break;

      case 'opensearch':
        provider = new OpenSearchProvider({
          url: process.env.MELT_OPENSEARCH_URL || 'https://opensearch:9200',
          index: process.env.MELT_OPENSEARCH_INDEX || 'genie-ai-logs-*',
        });
        break;

      default:
        throw new Error(`Unknown MELT provider: ${providerName}. Supported: victoriametrics, signoz, opensearch`);
    }

    // Verify connectivity
    const healthy = await provider.isHealthy();
    if (!healthy) {
      throw new Error(`MELT provider '${providerName}' is not reachable. Check configuration and network.`);
    }

    return new MELTService(provider);
  }

  /** Query logs from the configured backend */
  async queryLogs(query: LogQuery): Promise<LogQueryResult> {
    return this.provider.queryLogs(query);
  }

  /** Query a distributed trace by trace ID */
  async queryTrace(query: TraceQuery): Promise<TraceQueryResult> {
    return this.provider.queryTrace(query);
  }

  /** Query time-series metrics */
  async queryMetric(query: MetricQuery): Promise<MetricQueryResult> {
    return this.provider.queryMetric(query);
  }

  /** Check if the backend is healthy */
  async isHealthy(): Promise<boolean> {
    return this.provider.isHealthy();
  }
}

// Singleton export for use across the application
let meltServiceInstance: MELTService | null = null;

export async function getMELTService(): Promise<MELTService> {
  if (!meltServiceInstance) {
    meltServiceInstance = await MELTService.create();
  }
  return meltServiceInstance;
}
```

### 14.4 VictoriaMetrics Provider Implementation

```typescript
// components/shared/lib/melt/providers/victoriametrics-provider.ts

import {
  MELTProvider,
  LogQuery, LogQueryResult,
  TraceQuery, TraceQueryResult,
  MetricQuery, MetricQueryResult,
  LogEntry, TraceSpan,
} from '../types';

interface VictoriaMetricsConfig {
  logsUrl: string;     // VictoriaLogs endpoint (e.g., http://victoriametrics-logs:9428)
  metricsUrl: string;  // VictoriaMetrics endpoint (e.g., http://victoriametrics:8428)
  tracesUrl: string;   // VictoriaTraces Jaeger-compatible endpoint (e.g., http://victoriametrics-traces:9411)
}

export class VictoriaMetricsProvider implements MELTProvider {
  readonly name = 'victoriametrics';
  private config: VictoriaMetricsConfig;

  constructor(config: VictoriaMetricsConfig) {
    this.config = config;
  }

  async isHealthy(): Promise<boolean> {
    try {
      const [logs, metrics, traces] = await Promise.all([
        fetch(`${this.config.logsUrl}/health`),
        fetch(`${this.config.metricsUrl}/health`),
        fetch(`${this.config.tracesUrl}/api/health`),
      ]);
      return logs.ok && metrics.ok && traces.ok;
    } catch {
      return false;
    }
  }

  async queryLogs(query: LogQuery): Promise<LogQueryResult> {
    const start = Date.now();

    // Build LogsQL query
    // Format: {_service:"backend"} AND _level:"error" AND "search term" | json
    let logsQL = '';
    const filters: string[] = [];

    if (query.service) filters.push(`_service:"${query.service}"`);
    if (query.level) filters.push(`_level:"${query.level}"`);
    if (query.traceId) filters.push(`trace_id:"${query.traceId}"`);
    if (query.requestId) filters.push(`request_id:"${query.requestId}"`);
    if (query.userId) filters.push(`user_id:"${query.userId}"`);
    if (query.message) filters.push(`"${query.message}"`);

    logsQL = filters.join(' AND ');
    if (logsQL) logsQL += ' ';
    logsQL += '| json';

    const params = new URLSearchParams({
      query: logsQL,
      start: new Date(query.startTime).getTime() / 1000,
      limit: String(query.limit || 100),
      offset: String(query.offset || 0),
    });

    if (query.endTime) {
      params.set('end', new Date(query.endTime).getTime() / 1000);
    }

    const response = await fetch(`${this.config.logsUrl}/select/logsql/query?${params}`);
    if (!response.ok) throw new Error(`VictoriaLogs query failed: ${response.statusText}`);

    const data = await response.json();
    const entries: LogEntry[] = (data?.hits || []).map((hit: Record<string, unknown>) => ({
      timestamp: hit._time as string || hit.timestamp as string,
      level: (hit._level as string || hit.level as string || 'info').toLowerCase(),
      message: hit._msg as string || hit.message as string || '',
      service: hit._service as string || hit.service as string || '',
      traceId: hit.trace_id as string,
      spanId: hit.span_id as string,
      requestId: hit.request_id as string,
      userId: hit.user_id as string,
      metadata: hit as Record<string, unknown>,
    }));

    return {
      entries,
      total: data?.total || entries.length,
      took: Date.now() - start,
    };
  }

  async queryTrace(query: TraceQuery): Promise<TraceQueryResult> {
    const start = Date.now();

    // VictoriaTraces provides Jaeger-compatible API
    const params = new URLSearchParams({ traceID: query.traceId });
    if (query.startTime) {
      params.set('start', new Date(query.startTime).getTime() * 1000); // microseconds
    }
    if (query.endTime) {
      params.set('end', new Date(query.endTime).getTime() * 1000);
    }

    const response = await fetch(`${this.config.tracesUrl}/api/traces?${params}`);
    if (!response.ok) throw new Error(`VictoriaTraces query failed: ${response.statusText}`);

    const data = await response.json();
    const traceData = data?.data?.[0];
    const spans: TraceSpan[] = (traceData?.spans || []).map((span: Record<string, unknown>) => ({
      traceId: span.traceID as string,
      spanId: span.spanID as string,
      parentSpanId: span.parentSpanID as string || undefined,
      operationName: span.operationName as string,
      serviceName: span.process?.serviceName as string || '',
      startTime: new Date((span.startTime as number) / 1000).toISOString(),
      duration: span.duration as number / 1000, // microseconds to ms
      status: (span.tags?.error ? 'error' : 'ok'),
      tags: span.tags as Record<string, string> | undefined,
    }));

    return {
      spans,
      traceId: query.traceId,
      totalSpans: spans.length,
      duration: Math.max(...spans.map(s => s.startTime).map(t => new Date(t).getTime())) -
                Math.min(...spans.map(s => s.startTime).map(t => new Date(t).getTime())),
      services: [...new Set(spans.map(s => s.serviceName))],
      took: Date.now() - start,
    };
  }

  async queryMetric(query: MetricQuery): Promise<MetricQueryResult> {
    const start = Date.now();

    // Build PromQL query
    let promQL = query.metric;
    const labelFilters: string[] = [];
    if (query.service) labelFilters.push(`job="${query.service}"`);
    if (query.labels) {
      for (const [key, value] of Object.entries(query.labels)) {
        labelFilters.push(`${key}="${value}"`);
      }
    }
    if (labelFilters.length > 0) {
      promQL += `{${labelFilters.join(',')}}`;
    }

    const params = new URLSearchParams({
      query: promQL,
      start: String(new Date(query.startTime).getTime() / 1000),
      step: query.step || '5m',
    });

    if (query.endTime) {
      params.set('end', String(new Date(query.endTime).getTime() / 1000));
    }

    const response = await fetch(`${this.config.metricsUrl}/api/v1/query_range?${params}`);
    if (!response.ok) throw new Error(`VictoriaMetrics query failed: ${response.statusText}`);

    const data = await response.json();
    const result = data?.data?.result?.[0];
    const datapoints = (result?.values || []).map((dp: [number, string]) => ({
      timestamp: new Date(dp[0] * 1000).toISOString(),
      value: parseFloat(dp[1]),
    }));

    return {
      metric: query.metric,
      datapoints,
      took: Date.now() - start,
    };
  }
}
```

### 14.5 Logger.js Refactoring Design

The existing Winston logger (`components/shared/lib/logger.js`) needs refactoring to support the MELT architecture. The key changes are:

**Before (current):**
```javascript
// Plain text format, writes to files
const logFormat = format.printf(({ level, message, timestamp }) => {
  return `${timestamp} [${level.toUpperCase()}]: ${message}`;
});
// Transports: Console (colorized), DailyRotateFile (error), DailyRotateFile (combined), File (combined.log)
```

**After (refactored):**
```javascript
// JSON format, writes to stdout only, with OTel trace context injection
const logFormat = format.combine(
  format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  format.errors({ stack: true }),
  // Auto-inject OpenTelemetry trace/span/request IDs when available
  format((info, opts) => {
    // OTel trace context (set by @opentelemetry/sdk-node auto-instrumentation)
    const activeSpan = trace.getActiveSpan();
    if (activeSpan) {
      const spanContext = activeSpan.spanContext();
      info.trace_id = spanContext.traceId;
      info.span_id = spanContext.spanId;
    }
    // Request ID (set by Express middleware)
    if (info.req?.requestId) {
      info.request_id = info.req.requestId;
    }
    // Service name (from env)
    info.service = process.env.SERVICE_NAME || 'unknown';
    return info;
  })(),
  format.json()  // Structured JSON output for OTel Collector
);

// Transports: Console only (stdout) — OTel Collector DaemonSet handles the rest
const loggerConfig = {
  level: process.env.LOG_LEVEL || 'info',
  format: logFormat,
  transports: [
    new transports.Console({
      handleExceptions: true,
      json: true,          // JSON output for OTel Collector parsing
      colorize: false,     // No color codes in JSON output
    }),
  ],
};
```

**Key changes:**
1. **Format:** `printf` → `format.json()` — structured JSON for OTel Collector parsing
2. **Transports:** Remove all file transports (DailyRotateFile, File) — stdout only
3. **Trace context:** Auto-inject `trace_id`, `span_id` from active OTel span
4. **Request ID:** Auto-inject `request_id` from Express middleware
5. **Service name:** Auto-inject `service` from environment variable
6. **Colorize:** Disable — JSON output must not contain ANSI color codes
7. **Log rotation:** No longer handled by Winston — handled by VictoriaLogs / OTel Collector

**Impact on existing 197 logger calls:** **Zero changes required.** The existing calls like `logger.info('message')` and `logger.error('message', { data })` will continue to work. The format change is transparent to callers.

### 14.6 logs-service.js Thin Wrapper Design

The existing admin log query API endpoints (in the Node.js backend) currently parse log files from the filesystem. These need to be refactored to use the MELT Provider API.

**Before (current):**
```javascript
// Reads log files from filesystem
const logContent = fs.readFileSync('./logs/combined.log', 'utf-8');
// Parse, filter, paginate manually
```

**After (refactored):**
```javascript
// components/shared/lib/melt/logs-service.js

import { getMELTService } from './melt-service';
import type { LogQuery, LogQueryResult } from './types';

/**
 * Logs service — thin wrapper over MELTService for log-specific operations.
 * Used by admin API endpoints for log querying and display.
 */
export class LogsService {
  /**
   * Search logs with filters and pagination.
   */
  async searchLogs(params: {
    service?: string;
    level?: string;
    message?: string;
    startTime?: string;
    endTime?: string;
    traceId?: string;
    requestId?: string;
    userId?: string;
    page?: number;     // 1-based page number
    pageSize?: number; // Items per page (default: 50)
  }): Promise<LogQueryResult> {
    const melt = await getMELTService();

    const query: LogQuery = {
      service: params.service,
      level: params.level,
      message: params.message,
      startTime: params.startTime || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      endTime: params.endTime,
      traceId: params.traceId,
      requestId: params.requestId,
      userId: params.userId,
      limit: params.pageSize || 50,
      offset: ((params.page || 1) - 1) * (params.pageSize || 50),
      sort: 'desc',
    };

    return melt.queryLogs(query);
  }

  /**
   * Get logs for a specific trace — useful for debugging request flows.
   */
  async getLogsForTrace(traceId: string): Promise<LogQueryResult> {
    const melt = await getMELTService();

    return melt.queryLogs({
      traceId,
      startTime: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      sort: 'asc',
      limit: 1000,
    });
  }

  /**
   * Get logs for a specific user.
   */
  async getLogsForUser(userId: string, params: {
    page?: number;
    pageSize?: number;
    startTime?: string;
  } = {}): Promise<LogQueryResult> {
    const melt = await getMELTService();

    return melt.queryLogs({
      userId,
      startTime: params.startTime || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      limit: params.pageSize || 50,
      offset: ((params.page || 1) - 1) * (params.pageSize || 50),
      sort: 'desc',
    });
  }

  /**
   * Get error logs for a service.
   */
  async getErrors(service: string, params: {
    page?: number;
    pageSize?: number;
    startTime?: string;
  } = {}): Promise<LogQueryResult> {
    const melt = await getMELTService();

    return melt.queryLogs({
      service,
      level: 'error',
      startTime: params.startTime || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      limit: params.pageSize || 50,
      offset: ((params.page || 1) - 1) * (params.pageSize || 50),
      sort: 'desc',
    });
  }
}
```

### 14.7 Folder Structure

```
components/shared/lib/
├── logger.js                    # Winston logger (refactored: JSON stdout + OTel context)
├── melt/
│   ├── types.ts                 # MELT Provider interfaces and type definitions
│   ├── melt-service.ts          # MELTService facade + factory + singleton
│   ├── logs-service.ts          # Thin wrapper for admin log query API endpoints
│   └── providers/
│       ├── victoriametrics-provider.ts  # VictoriaMetrics implementation (default)
│       ├── signoz-provider.ts           # SigNoz implementation (alternative)
│       └── opensearch-provider.ts       # OpenSearch implementation (alternative)
```

### 14.8 Environment Configuration

```bash
# MELT Provider Configuration
# ============================
# Which MELT backend to use: 'victoriametrics' (default), 'signoz', 'opensearch'
MELT_PROVIDER=victoriametrics

# VictoriaMetrics endpoints (used when MELT_PROVIDER=victoriametrics)
MELT_LOGS_URL=http://victoriametrics-logs:9428
MELT_METRICS_URL=http://victoriametrics:8428
MELT_TRACES_URL=http://victoriametrics-traces:9411

# SigNoz endpoints (used when MELT_PROVIDER=signoz)
MELT_BASE_URL=http://signoz-backend:8080
MELT_CLICKHOUSE_URL=http://clickhouse:9000

# OpenSearch endpoints (used when MELT_PROVIDER=opensearch)
MELT_OPENSEARCH_URL=https://opensearch:9200
MELT_OPENSEARCH_INDEX=genie-ai-logs-*

# Logger configuration
LOG_LEVEL=info
SERVICE_NAME=backend              # Auto-injected into all log entries
```

### 14.9 Provider Comparison — What Changes Per Backend

| Aspect | VictoriaMetricsProvider | SignozProvider | OpenSearchProvider |
|---|---|---|---|
| **Log query language** | LogsQL | ClickHouse SQL | Lucene query DSL |
| **Trace query API** | Jaeger-compatible REST API | SigNoz trace API | N/A (no traces) |
| **Metric query language** | PromQL / MetricsQL | ClickHouse SQL | N/A (no metrics) |
| **Health check** | `/health` on each component | `/api/v1/health` | `/_cluster/health` |
| **Pagination** | `limit` + `offset` params | SQL `LIMIT` + `OFFSET` | `from` + `size` params |
| **Log field mapping** | `_time`, `_level`, `_msg`, `_service` | `timestamp`, `severity_text`, `body`, `resource_attributes` | `@timestamp`, `log.level`, `message`, `service.name` |

The provider implementations handle all these differences internally. Application code only sees the uniform `LogEntry`, `TraceSpan`, and `MetricQueryResult` types.

---

## 15. Appendices

### Appendix A: Current Codebase Logging Statistics

| Metric | Value |
|---|---|
| Node.js Winston logger calls | 197 |
| Python CustomLogger calls | 197 |
| Python print statements | 26 |
| Docker services with log volumes | 3 (backend, document-repo, kong) |
| Docker compose files | 9 |
| Total Docker services | 25+ |
| Python files using CustomLogger | 9 |
| Admin log query API endpoints | 4+ |

### Appendix B: GitLab Issue Hierarchy (Rescope)

```
#354 (Parent) — Observability Platform Integration (was: OpenSearch Integration)
├── #355 — Deploy VictoriaMetrics Stack (was: Apache OpenSearch Deployment)
├── #356 — Refactor Shared-lib Winston (was: Winston → OpenSearch)
│         └── Winston → JSON stdout + OTel trace context injection
├── #357 — Implement MELT Provider API (was: Implement Python Logger → OpenSearch)
│         └── TypeScript interfaces + VictoriaMetricsProvider
├── #358 — Refactor Python Logging (was: console → OpenSearch)
│         └── CustomLogger → JSON stdout
├── #359 — Refactor Node.js Admin Log Services (was: file → OpenSearch)
│         └── File parsing → MELT Provider API (logs-service.js)
└── #361 — Build MELT Query Service (was: OpenSearch Log Query and Extraction)
            └── logs-service.js thin wrapper over MELTService
```

### Appendix C: Visualization Comparison (Updated)

| Tool | License | Suitable for Logs? | Suitable for Metrics? | Suitable for Traces? | Notes |
|---|---|---|---|---|---|
| **Grafana** | AGPLv3 (runtime OK) | **YES** (via Loki or VM plugin) | **YES** (native) | **YES** (Jaeger plugin) | **Recommended** — enterprise-grade |
| OpenSearch Dashboards | Apache 2.0 | YES (native) | Limited | No | Best if using OpenSearch |
| **SigNoz UI** | MIT | YES | YES | YES | Built-in, permissive, full MELT |
| vmui (VictoriaMetrics) | Apache 2.0 | No | YES | No | Basic query explorer only |

### Appendix D: Resource Quick Reference (Updated)

```
Docker Compose — Single Node, Moderate Load (~1 GB logs/day)

OpenSearch:
  opensearch:        -Xms2g -Xmx2g     → ~2.5 GB RAM, ~2 CPU cores
  opensearch-dashboards:               → ~512 MB RAM, ~0.5 CPU core
  otel-collector:                       → ~256 MB RAM, ~0.5 CPU core
  Total:                                ~3.3 GB RAM, ~3 CPU cores

VictoriaMetrics Stack + Grafana:
  victoria-metrics:                     → ~256 MB RAM, ~0.5 CPU core
  victoria-logs:                        → ~256 MB RAM, ~0.5 CPU core
  victoria-traces:                      → ~128 MB RAM, ~0.25 CPU core
  vmalert:                              → ~64 MB RAM, ~0.1 CPU core
  grafana:                              → ~128 MB RAM, ~0.25 CPU core
  otel-collector:                       → ~256 MB RAM, ~0.5 CPU core
  Total:                                ~1.1 GB RAM, ~2.1 CPU cores
  + FULL MELT WITH ENTERPRISE-GRADE VISUALIZATION

SigNoz Stack:
  signoz-backend:                       → ~256 MB RAM, ~0.5 CPU core
  signoz-frontend:                      → ~128 MB RAM, ~0.25 CPU core
  clickhouse:                           → ~1.5 GB RAM, ~1.5 CPU cores
  otel-collector:                       → ~256 MB RAM, ~0.5 CPU core
  Total:                                ~2.1 GB RAM, ~2.75 CPU cores
  + FULL MELT WITH COMPLIANT VISUALIZATION
```

### Appendix E: License Verification Sources

Licenses verified directly from GitHub source files:

| Component | Source | License Text |
|---|---|---|
| SigNoz | [github.com/SigNoz/signoz/LICENSE](https://github.com/SigNoz/signoz/blob/main/LICENSE) | "MIT Expat" — open-source core |
| Uptrace | [github.com/uptrace/uptrace/LICENSE](https://github.com/uptrace/uptrace/blob/master/LICENSE) | "GNU AFFERO GENERAL PUBLIC LICENSE v3" — **disqualified** |
| ClickHouse | [github.com/ClickHouse/ClickHouse/LICENSE](https://github.com/ClickHouse/ClickHouse/blob/master/LICENSE) | "Apache License, Version 2.0" |
| VictoriaMetrics | [github.com/VictoriaMetrics/VictoriaMetrics/LICENSE](https://github.com/VictoriaMetrics/VictoriaMetrics/blob/master/LICENSE) | "Apache License, Version 2.0" |
| OpenSearch | [opensearch.org](https://opensearch.org/) | "Apache License, Version 2.0" |
| Grafana | [github.com/grafana/grafana/LICENSE](https://github.com/grafana/grafana/blob/main/LICENSE) | "GNU AFFERO GENERAL PUBLIC LICENSE v3" — acceptable as runtime dependency |

### Appendix F: Relevant Links

- [VictoriaMetrics GitHub](https://github.com/VictoriaMetrics/VictoriaMetrics) — Apache 2.0
- [VictoriaLogs GitHub](https://github.com/VictoriaMetrics/VictoriaLogs) — Apache 2.0
- [VictoriaMetrics Cluster Documentation](https://docs.victoriametrics.com/Cluster-VictoriaMetrics/) — vmcluster architecture
- [VictoriaMetrics Helm Chart](https://github.com/VictoriaMetrics/helm-charts) — Kubernetes deployment
- [Grafana VictoriaMetrics Datasource](https://grafana.com/grafana/plugins/victoriametrics-datasource/) — Grafana plugin
- [Grafana Jaeger Tracing](https://grafana.com/docs/grafana/latest/explore/trace-integration/) — Trace visualization
- [SigNoz GitHub](https://github.com/SigNoz/signoz) — MIT License
- [OpenSearch Project](https://opensearch.org/) — Apache 2.0
- [OpenTelemetry Collector](https://github.com/open-telemetry/opentelemetry-collector) — Apache 2.0
- [Grafana License](https://grafana.com/blog/2021/03/30/grafana-license-change/) — AGPLv3
- [OSI Approved Licenses](https://opensource.org/licenses/) — License reference

---

*v3 — Updated 2026-04-16: K8s/HPA priority weighting, AGPL runtime acceptance, MELT Provider API architecture*
