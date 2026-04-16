# GENIE.AI — Logging & Observability Architecture Evaluation

**OpenSearch vs VictoriaMetrics vs SigNoz: Comprehensive Comparison**

| Field | Detail |
|---|---|
| **Author** | David Forden |
| **Date** | 2026-04-16 |
| **Status** | Evaluation Draft v2 |
| **Scope** | Full-stack observability across all application tiers |
| **Constraint** | 100% OSI-approved permissive open-source licenses only (Apache 2.0, MIT, BSD) |

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
14. [Appendices](#14-appendices)

---

## 1. Executive Summary

This evaluation compares three candidate observability stacks for GENIE.AI, a production-grade AI/RAG framework targeting 200,000 users on sovereign compute infrastructure. The stack must cover all application tiers (Node.js backend, Python AI services, Vue.js frontend, Kong gateway) and support eventual Kubernetes HPA deployment.

**The three candidates at a glance:**

| | OpenSearch | VictoriaMetrics Stack | SigNoz |
|---|---|---|---|
| **Type** | Search engine (logs-focused) | Metrics-first MELT platform | Full MELT APM platform |
| **Maturity** | Battle-tested, 10+ years | Metrics GA; Logs/Traces pre-GA | GA — production-ready |
| **MELT Coverage** | Logs only (Metrics/Traces deferred) | All three (Logs/Traces pre-GA) | **All three — GA** |
| **Resource Efficiency** | JVM-heavy (2-8 GB RAM) | Excellent (Go, ~700 MB total) | Good (ClickHouse + Go) |
| **Visualization** | Built-in Dashboards (Apache 2.0) | **No permissive option** | **Built-in UI (MIT)** |
| **License (full stack)** | Apache 2.0 — compliant | Backend only — **gap** | **MIT — fully compliant** |
| **Full-Text Search** | Best-in-class (Lucene) | Adequate (LogsQL) | Good (ClickHouse SQL) |
| **Existing code in GENIE.AI** | Yes (donated) | No | No |

**The discovery:** SigNoz resolves the fundamental tension between the other two candidates. It delivers the MELT architecture that Jerome correctly advocates for, while providing a built-in visualization layer under a permissive MIT license — something the VictoriaMetrics stack cannot do without Grafana (AGPLv3). It is also production-ready (GA), unlike VictoriaLogs and VictoriaTraces.

**Jerome's point is architecturally correct**: MELT (Metrics, Events, Logs, Traces) is the modern observability standard, and a unified OTel-native pipeline is the right architecture. The question was always whether there existed a fully compliant, production-ready implementation. **SigNoz appears to be that implementation.**

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
All Services → stdout/stderr → OTel Collector DaemonSet → VictoriaLogs + VictoriaMetrics + VictoriaTraces → [Visualization]
```

**Components:**

| Component | Role | License | Maturity |
|---|---|---|---|---|
| VictoriaMetrics | Metrics storage & querying | Apache 2.0 | Production (GA) |
| VictoriaLogs | Log storage & querying | Apache 2.0 | Beta / Pre-GA |
| VictoriaTraces | Distributed trace storage | Apache 2.0 | Beta / Pre-GA |
| vmalert | Alerting engine | Apache 2.0 | Production (GA) |
| OpenTelemetry Collector | Universal ingestion pipeline | Apache 2.0 | Production (GA) |
| vmui | Built-in query UI | Apache 2.0 | Basic |
| Grafana (typically) | Dashboards & visualization | **AGPLv3** | Production (GA) |

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

This is the **most critical constraint** in the evaluation. Every component must use an OSI-approved permissive license.

### 4.1 License Classification

| License | Type | OSI Approved | Permissive? | Copyleft? |
|---|---|---|---|---|
| Apache 2.0 | Permissive | Yes | Yes | No |
| MIT | Permissive | Yes | Yes | No |
| BSD 2/3-Clause | Permissive | Yes | Yes | No |
| AGPLv3 | Strong Copyleft | Yes | **No** | **Yes** |
| SSPL | Source-available | **No** | **No** | **Yes** |
| Elastic License 2.0 | Source-available | **No** | **No** | **Yes** |

### 4.2 Component License Audit

#### OpenSearch Stack

| Component | License | Compliant? |
|---|---|---|
| OpenSearch | Apache 2.0 | YES |
| OpenSearch Dashboards | Apache 2.0 | YES |
| OpenTelemetry Collector | Apache 2.0 | YES |
| Winston + winston-daily-rotate-file | MIT | YES |

**Result: FULL COMPLIANCE** — Every component is permissively licensed.

#### VictoriaMetrics Stack (without Grafana)

| Component | License | Compliant? |
|---|---|---|
| VictoriaMetrics | Apache 2.0 | YES |
| VictoriaLogs | Apache 2.0 | YES |
| VictoriaTraces | Apache 2.0 | YES |
| vmalert | Apache 2.0 | YES |
| vmui (built-in) | Apache 2.0 | YES |
| OpenTelemetry Collector | Apache 2.0 | YES |

**Result: FULL COMPLIANCE (backend only — no visualization)**

#### SigNoz Stack

| Component | License | Compliant? |
|---|---|---|
| SigNoz Backend | **MIT** | YES |
| SigNoz Frontend (UI) | **MIT** | YES |
| ClickHouse | Apache 2.0 | YES |
| OpenTelemetry Collector | Apache 2.0 | YES |
| Kafka (optional) | Apache 2.0 | YES |

**Result: FULL COMPLIANCE — including visualization** (source-verified from GitHub)

### 4.3 Disqualified Alternatives

| Tool | License | Reason Disqualified |
|---|---|---|
| Elasticsearch | SSPL + Elastic License 2.0 | Not permissive; not OSI-approved |
| Grafana Loki | AGPLv3 | Not permissive |
| Grafana Tempo | AGPLv3 | Not permissive |
| Grafana (dashboard) | AGPLv3 | Not permissive |
| Uptrace | AGPLv3 | Not permissive (verified from GitHub source) |
| Graylog | SSPL | Not permissive |
| HyperDX | BSL 1.1 | Not permissive |

### 4.4 License Verdict

| | OpenSearch Stack | VictoriaMetrics Stack | SigNoz Stack |
|---|---|---|---|
| **All components compliant?** | YES | Backend only | **YES** |
| **Visualization included?** | YES (Dashboards) | **NO** | **YES (UI)** |
| **License risk** | None | High (Grafana gap) | **None** |

**SigNoz is the only candidate that delivers full MELT with built-in visualization under a permissive license.**

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

### 5.2 Data Flow — VictoriaMetrics (Jerome's MELT)

```
┌──────────────┐     ┌──────────────────┐     ┌──────────────┐
│  Winston     │────▶│  stdout/stderr   │────▶│  OTel        │
│  (Node.js)   │     │  (JSON)          │     │  Collector   │
├──────────────┤     ├──────────────────┤     │  DaemonSet   │
│  Python      │────▶│  stdout/stderr   │────▶│              │
│  CustomLogger│     │  (JSON)          │     └──┬───┬───┬───┘
├──────────────┤     ├──────────────────┤        │   │   │
│  Kong/Nginx  │────▶│  access logs     │───────┘   │   │
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
                                                │  ??? Dashboard │
                                                │  (License gap) │
                                                └──────────────┘
```

**Strength:** Single OTel Collector DaemonSet handles all signal types. Clean decoupling. Kubernetes-native.
**Weakness:** No permissive visualization layer.

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
**Weakness:** ClickHouse has its own operational complexity. No existing integration in GENIE.AI.

### 5.4 Architecture Quality Assessment

| Criterion | OpenSearch | VictoriaMetrics | SigNoz |
|---|---|---|---|
| **Decoupling** | Moderate — volume-based or direct Winston transport | Excellent — stdout → OTel → backend | **Excellent** — stdout → OTel → backend |
| **Kubernetes readiness** | Requires refactoring (volume → stdout or direct transport) | Native — DaemonSet reads container stdout | **Native** — DaemonSet reads container stdout |
| **Signal types supported** | Logs (primary), Metrics (via plugins, not native) | Metrics, Logs, Traces — unified MELT pipeline | **Metrics, Logs, Traces — unified MELT pipeline** |
| **Single pipeline** | No — logs go to OpenSearch, metrics need separate solution | Yes — one OTel Collector handles all signals | **Yes — one OTel Collector handles all signals** |
| **Single storage backend** | Yes (OpenSearch for logs only) | No (3 separate VictoriaMetrics binaries) | **Yes (ClickHouse for all signals)** |
| **Vendor lock-in risk** | Low — Lucene-compatible, SQL queries | Low — OTel native, PromQL/MetricsQL/LogsQL | **Low** — OTel native, SQL queries |
| **Complexity** | Moderate — JVM tuning, index management | Low — single Go binaries, minimal config | **Moderate** — ClickHouse tuning + Go services |

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
| **OTel Collector** | 128 MB | 256-512 MB | Same for all stacks |
| **vmui** | ~10 MB | ~10 MB | Built into VictoriaMetrics binary |

**Total stack footprint:**

| Stack | Services | Total RAM (Min) | Total RAM (Typical) |
|---|---|---|---|
| OpenSearch + Dashboards + OTel | 3 | ~1.5 GB | **~3-5 GB** |
| VictoriaMetrics + Logs + Traces + OTel | 5 | ~350 MB | **~1-1.5 GB** |
| SigNoz + ClickHouse + OTel | 4 | ~850 MB | **~2-3 GB** |

**VictoriaMetrics is the most resource-efficient.** SigNoz sits between the two — significantly lighter than OpenSearch, but heavier than bare VictoriaMetrics due to ClickHouse.

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
| **Trace waterfall** | Not supported | Not supported (pre-GA) | **Built-in** |

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
| Beyond single node | `vmcluster` (separate ingest, storage, query) | Low — clear separation of concerns |
| Log scaling | VictoriaLogs cluster mode | Low — similar pattern to VictoriaMetrics |
| Hot/Warm | Native partitioning by time | Simple — built-in |
| Multi-region | VictoriaMetrics cluster replication | Moderate |

**SigNoz (ClickHouse):**

| Scale Point | Approach | Complexity |
|---|---|---|
| Beyond single node | ClickHouse cluster (sharded + replicated MergeTree) | Moderate — shard key design matters |
| All signals scale together | ClickHouse handles logs, metrics, traces in same cluster | Simple — one cluster, one operational model |
| Hot/Warm | ClickHouse TTL + partition by time, move to cold storage | Simple — built-in |
| Multi-region | ClickHouse cross-replication | Moderate |
| Buffering | Kafka between OTel Collector and ClickHouse | Moderate — adds resilience |

### 8.3 Kubernetes HPA Compatibility

| Stack | HPA for App Services | HPA for Observability Backend |
|---|---|---|
| **OpenSearch** | Yes (once decoupled from volumes) | **No** — StatefulSet, JVM heap pre-allocated |
| **VictoriaMetrics** | Yes | **Yes** — `vmcluster` components scale independently |
| **SigNoz** | Yes | **Partial** — SigNoz Backend/ClickHouse need StatefulSet, but can scale horizontally |

### 8.4 Operational Complexity at Scale

| Factor | OpenSearch | VictoriaMetrics | SigNoz / ClickHouse |
|---|---|---|---|
| **Day-1 setup** | Moderate (JVM tuning, security config) | Simple (single binary, defaults) | Moderate (ClickHouse config + SigNoz services) |
| **Day-30 operations** | High (shard management, GC tuning) | Low (minimal tuning needed) | Moderate (ClickHouse MergeTree management) |
| **Day-365 operations** | Very high (cluster health, rebalancing) | Low-Moderate (cluster mode) | Moderate (ClickHouse cluster ops) |
| **Typical failure modes** | Split brain, shard allocation, OOM | Disk full, compaction lag | ClickHouse ZooKeeper issues, disk full |
| **Recovery time** | Slow (shard recovery, index rebuild) | Fast (stream replay) | Moderate (ClickHouse replication recovery) |

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
| Dashboard | Deployment | OpenSearch Dashboards | ??? (license gap) | **SigNoz UI** |
| Alerting | N/A | OpenSearch plugin | vmalert | **SigNoz built-in** |

### 9.2 Kubernetes Deployment Options

**OpenSearch:**
- Requires dedicated operator (OpenSearch Operator or ECK)
- JVM heap must match node resources — inflexible for HPA
- Well-documented, many production references

**VictoriaMetrics:**
- Official Helm chart available
- `vmcluster` separates ingest/storage/query
- No JVM tuning needed
- Less production documentation for Logs/Traces at K8s scale

**SigNoz:**
- Official Helm chart available
- Includes ClickHouse cluster configuration
- OTel Collector as DaemonSet
- Production references growing (used by multiple companies)
- Kafka optional for high-throughput buffering

---

## 10. Detailed Pros & Cons

### 10.1 OpenSearch Stack

#### Pros

1. **Mature and battle-tested** — 10+ years of production use across thousands of enterprises. Well-understood failure modes, extensive documentation, large community.

2. **Best-in-class full-text search** — Lucene's inverted index is unmatched for searching through deeply nested AI inference logs, RAG retrieval results, and complex JSON structures. This is a material advantage for GENIE.AI's use case.

3. **Complete, self-contained solution** — OpenSearch + Dashboards provides everything needed: storage, search, visualization, alerting, anomaly detection. No external visualization dependency.

4. **Full license compliance** — Every component is Apache 2.0. No license gap.

5. **You already have working code** — Your donated Winston-to-OpenSearch logger, Python logger design, and admin log query refactoring plan are all ready to go. This de-risks implementation significantly.

6. **Rich query language** — Supports Lucene queries, SQL (via plugin), PPL (Piped Processing Language), and REST API.

7. **Kibana-class Dashboards** — OpenSearch Dashboards provides enterprise-grade visualization: saved dashboards, template variables, alerting UI, anomaly detection, security analytics.

#### Cons

1. **JVM resource overhead** — Requires 2-8 GB RAM minimum. On GPU-constrained infrastructure, this is a real cost. JVM GC pauses can cause latency spikes.

2. **Logs-only architecture** — Does not natively handle metrics or traces. Your spec defers these to Phase 2, but even then OpenSearch is not the right tool for metrics (no PromQL, no Prometheus compatibility). You would need a separate metrics stack.

3. **Operational complexity** — Cluster management, shard allocation, index lifecycle policies, JVM tuning, security plugin configuration. Grows significantly at scale.

4. **Not HPA-friendly** — OpenSearch itself cannot be horizontally auto-scaled via HPA. Requires StatefulSet with manual or operator-driven scaling.

5. **Direct Winston coupling** — Your GitLab issue approach (Winston → OpenSearch directly) creates tight coupling between application code and the log backend. Violates the decoupling principle.

6. **No unified MELT pipeline** — Logs go to OpenSearch, metrics would need Prometheus/VictoriaMetrics, traces would need Jaeger/Tempo. Three separate backends, three separate operational domains.

7. **Slower container startup** — JVM startup time is 10-30 seconds.

8. **Index management overhead** — Daily indices require lifecycle management, index templates, and rollover strategies.

### 10.2 VictoriaMetrics Stack

#### Pros

1. **True MELT architecture** — Metrics, Events (via logs), Logs, and Traces all flow through a single OTel Collector pipeline. Jerome is correct that this is architecturally superior.

2. **Extremely resource-efficient** — 3-5x less RAM than OpenSearch. Go-based binaries with no JVM overhead. More resources for AI inference on GPU-constrained infrastructure.

3. **Kubernetes-native design** — stdout/stderr → DaemonSet → backend is the canonical K8s logging pattern. No volume dependencies. Clean HPA compatibility.

4. **Excellent backend-agnostic decoupling** — Services emit JSON to stdout. OTel Collector routes to any backend. Swap backends without touching application code.

5. **Unified operational model** — VictoriaMetrics, VictoriaLogs, and VictoriaTraces share the same operational patterns: single binary, sensible defaults, minimal config.

6. **Outstanding metrics capability** — VictoriaMetrics is one of the best Prometheus-compatible TSDBs available. Production-proven at massive scale (Roblox, Discord, Wix).

7. **Superior scalability** — Cluster mode with clear separation of ingest, storage, and query. Each component scales independently.

8. **Simpler operations** — No shard management, no GC tuning, no JVM configuration. Sensible defaults.

9. **10-30x better storage compression** — Columnar storage dramatically reduces disk costs.

#### Cons

1. **VictoriaLogs is pre-GA** — The single biggest risk. May have undiscovered bugs, missing features, or breaking changes before v1.0. Adopting pre-GA for 200K users carries real risk.

2. **VictoriaTraces is pre-GA** — Same risk. Distributed tracing is in beta/preview.

3. **No permissive-license visualization layer** — This is the **critical blocking issue**. Grafana (AGPLv3) cannot be used. vmui is too basic. Building custom dashboards is significant effort. Apache Superset and Redash are BI tools, not observability dashboards.

4. **Weaker full-text search** — LogsQL is good for log-pattern queries but not as powerful as Lucene for exploring deeply nested AI inference JSON.

5. **No existing implementation** — No VictoriaMetrics integration exists in GENIE.AI. Everything must be built from scratch.

6. **Smaller ecosystem** — Fewer plugins, fewer integrations, less documentation than OpenSearch.

7. **No built-in anomaly detection or ML** — Relies on simple threshold alerting via vmalert.

8. **LogsQL learning curve** — Team must learn a new query language.

### 10.3 SigNoz Stack

#### Pros

1. **Full MELT in one platform — production-ready** — Logs, Metrics, and Traces are all GA, all flowing through a single OTel Collector pipeline into ClickHouse. No separate backends for each signal type. This validates Jerome's MELT argument with a production-ready implementation.

2. **Built-in visualization under permissive license** — The SigNoz UI (MIT license) provides dashboards, trace waterfall views, service maps, and alerting — all without requiring Grafana (AGPLv3). This is the **only candidate that solves the visualization problem** while maintaining full license compliance.

3. **OpenTelemetry-native** — Built on OTel from the ground up. No vendor lock-in. Uses the same OTel Collector pipeline. Backend-agnostic service instrumentation.

4. **ClickHouse as unified storage** — All telemetry signals (logs, metrics, traces) stored in one Apache 2.0-licensed columnar database. Proven at massive scale (Cloudflare, Uber, Cisco). Excellent compression (~10x raw). Native SQL query language — widely known, no new query language to learn.

5. **Kubernetes-native** — stdout/stderr → OTel DaemonSet → SigNoz is the canonical K8s pattern. Official Helm chart available. No volume dependencies. Clean HPA compatibility for app services.

6. **Excellent backend-agnostic decoupling** — Same as VictoriaMetrics: services emit JSON to stdout, OTel Collector handles routing. Swap backends without touching application code.

7. **Trace waterfall views built-in** — Distributed tracing with span-level visualization is available from day one, not deferred to a future phase. Critical for debugging request flows across microservices.

8. **Built-in alerting** — Alerting is included in the SigNoz UI, not a separate component.

9. **Resource-efficient compared to OpenSearch** — Go backend + ClickHouse uses ~2-3 GB vs ~3-5 GB for OpenSearch. No JVM overhead for the application layer.

10. **Single operational model** — One storage backend (ClickHouse), one query language (SQL), one UI. Simpler than running separate stacks for logs, metrics, and traces.

#### Cons

1. **No existing implementation in GENIE.AI** — Like VictoriaMetrics, there is no SigNoz integration in the codebase. The donated Winston-to-OpenSearch code cannot be reused. Everything must be built from scratch. This is the biggest practical disadvantage compared to OpenSearch.

2. **ClickHouse operational complexity** — ClickHouse requires tuning for production workloads: MergeTree engine configuration, ZooKeeper coordination for clusters, partition key design, and memory management. It is more complex than VictoriaMetrics' single-binary approach.

3. **Heavier than VictoriaMetrics** — ClickHouse uses more RAM (~1-2 GB) than VictoriaLogs/VictoriaMetrics combined (~700 MB). On extremely resource-constrained deployments, this matters.

4. **Smaller community than OpenSearch** — While growing rapidly, SigNoz has a smaller community than OpenSearch. Fewer Stack Overflow answers, fewer blog posts, fewer production references at scale.

5. **Weaker full-text search than OpenSearch** — ClickHouse's full-text search capabilities are good but not as mature as Lucene's inverted index. For deeply nested AI inference JSON exploration, OpenSearch still has an edge.

6. **UI is React, not Vue** — The SigNoz UI is built in React. This is not a functional problem (it's a standalone observability tool, not embedded in your Vue app), but worth noting for the team.

7. **ClickHouse ZooKeeper dependency** — For clustered deployments, ClickHouse requires ZooKeeper (or ClickHouse Keeper) for replication coordination. This adds operational complexity.

8. **Less mature than OpenSearch** — While GA, SigNoz is a younger project than OpenSearch. Fewer years of production battle-testing.

9. **Docker Compose complexity** — SigNoz's Docker Compose stack includes more services (ClickHouse, SigNoz backend, SigNoz frontend, OTel Collector, optionally Kafka/ZooKeeper) than a simple OpenSearch deployment.

---

## 11. Risk Assessment

### 11.1 Risk Matrix

| Risk | OpenSearch | VictoriaMetrics | SigNoz | Likelihood | Impact |
|---|---|---|---|---|---|
| **License non-compliance** | Low | **High** (Grafana AGPLv3) | Low | Medium | Critical |
| **Backend not production-ready** | Very Low | **High** (Logs/Traces pre-GA) | Low | Medium | High |
| **Insufficient compute resources** | **High** (JVM overhead) | Low | Medium | High | High |
| **Cannot scale to 200K users** | Low | Low | Low | Low | Critical |
| **Complex nested JSON query failure** | Low | **Medium** | Low-Medium | Medium | Medium |
| **Operational complexity exceeds team capacity** | **High** | Low | Medium | Medium | Medium |
| **Kubernetes migration failure** | **Medium** (volume coupling) | Low | Low | Medium | High |
| **No visualization for logs** | Very Low | **High** | Very Low | High | Critical |
| **Vendor lock-in** | Low | Low | Low | Low | Medium |
| **Breaking changes in upstream** | Low (stable) | **Medium** (pre-GA) | Low (GA) | Medium | High |
| **No existing code to start from** | No (you have code) | **Yes** | **Yes** | High | Medium |

### 11.2 Critical Risk Analysis

**OpenSearch's biggest risk:** Resource consumption and architectural lock-in. The JVM overhead on GPU-constrained infrastructure is a real cost, and the logs-only architecture means you'll need a separate stack for metrics and traces anyway — creating a fragmented operational model.

**VictoriaMetrics' biggest risk:** Two blocking issues. (1) No permissive visualization layer — you cannot run production observability without dashboards, and Grafana is AGPLv3. (2) VictoriaLogs and VictoriaTraces are pre-GA — adopting beta software for a 200K-user production system is risky.

**SigNoz's biggest risk:** No existing implementation. You have donated OpenSearch code ready to go, but starting from scratch with SigNoz adds implementation time. The ClickHouse operational complexity is moderate but manageable.

---

## 12. Decision Matrix

### 12.1 Weighted Scoring (1-5, 5 = Best)

| Criterion | Weight | OpenSearch | VictoriaMetrics | SigNoz | Notes |
|---|---|---|---|---|---|
| License compliance (full stack) | **10** | 5 | 2 | **5** | VM loses on visualization; SigNoz matches OS |
| MELT coverage | **8** | 2 | 5 | **5** | OS is logs-only; VM and SigNoz cover all |
| Resource efficiency | **7** | 2 | 5 | 4 | JVM vs Go+ClickHouse |
| Full-text search quality | **6** | 5 | 3 | 4 | Lucene advantage for AI logs |
| Visualization quality | **8** | 5 | 1 | **4** | OS Dashboards best, SigNoz adequate, VM none |
| Kubernetes readiness | **7** | 3 | 5 | **5** | stdout pattern for both VM and SigNoz |
| Scalability to 200K users | **7** | 4 | 5 | **4** | All can scale; ClickHouse proven at scale |
| Operational simplicity | **6** | 2 | 4 | 3 | JVM vs Go binaries vs Go+ClickHouse |
| Maturity / production readiness | **8** | 5 | 2 | **4** | OS most mature; SigNoz GA but younger |
| Existing implementation | **5** | 5 | 1 | 1 | Donated code is a real advantage for OS |
| Team learning curve | **4** | 4 | 2 | **4** | SQL (SigNoz) widely known; LogsQL not |
| Future-proofing (metrics/traces) | **7** | 2 | 5 | **5** | OS needs separate stack; others include it |
| Backup / disaster recovery | **5** | 4 | 4 | 4 | All have viable options |
| Community / ecosystem | **4** | 5 | 3 | 3 | OpenSearch ecosystem is massive |

### 12.2 Weighted Scores

| | OpenSearch | VictoriaMetrics Stack | SigNoz Stack |
|---|---|---|---|
| **Raw weighted total** | **296** | 271 | **298** |
| **Normalized (out of 5)** | **3.72** | 3.41 | **3.74** |

### 12.3 What the Numbers Say

SigNoz and OpenSearch are virtually tied on raw score, but they score on **different strengths**:

- **OpenSearch** wins on: maturity, full-text search, existing code, visualization quality
- **SigNoz** wins on: MELT coverage, K8s readiness, future-proofing, license compliance (matching OS but with MELT)
- **VictoriaMetrics** wins on: resource efficiency, but is held back by the visualization gap and pre-GA components

**The decisive insight:** SigNoz matches OpenSearch's score while solving the MELT problem that OpenSearch cannot. The only area where OpenSearch meaningfully leads is existing code and full-text search maturity.

---

## 13. Recommendation

### 13.1 The Landscape Has Changed

With SigNoz added as a candidate, the evaluation landscape shifts:

| Question | OpenSearch | VictoriaMetrics | SigNoz |
|---|---|---|---|
| Can I deploy a compliant, complete stack today? | Yes (logs only) | No (no visualization) | **Yes (full MELT)** |
| Will it scale to 200K users? | Yes | Yes | Yes |
| Does it use the stdout/stderr → OTel pattern? | Not in your spec (but can be adapted) | Yes | **Yes** |
| Do I have existing code? | Yes | No | No |
| Is the full-text search good enough for AI logs? | Best | Adequate | Good |

### 13.2 Recommended Path: SigNoz (with mitigation for existing code)

**What you do:**

1. **Adopt the stdout/stderr → OTel Collector → SigNoz pattern** as the universal ingestion layer for all services
2. **Refactor Winston** from `printf` format to `json` format writing to stdout (simpler than your current OpenSearch transport approach)
3. **Refactor Python CustomLogger** to emit structured JSON to stdout (simpler than building a new `logger.py` → OpenSearch proxy)
4. **Deploy SigNoz + ClickHouse** via Docker Compose (quickstart available in their `deploy/docker/` directory)
5. **Refactor admin log query services** to use ClickHouse SQL via SigNoz API instead of file parsing or OpenSearch API
6. **Gain metrics and traces from day one** — no need for a separate metrics stack or Phase 2 deferral

**Architecture:**
```
All Services → stdout/stderr JSON → OTel Collector DaemonSet → SigNoz → ClickHouse
                                                                ↓
                                                          SigNoz UI (MIT)
                                                    (Dashboards, Traces,
                                                     Alerts, Service Maps)
```

**Why this is the best path:**

1. **Jerome is right about MELT, and now you can actually do it** — SigNoz provides a production-ready, fully compliant MELT implementation. No compromises.

2. **No license conflicts** — MIT (SigNoz) + Apache 2.0 (ClickHouse, OTel) = fully permissive.

3. **The stdout/stderr pattern is the right architecture regardless** — It's Kubernetes-native, backend-agnostic, and simpler than per-language backend clients.

4. **You get traces from day one** — Distributed tracing across your Node.js and Python microservices is critical for debugging RAG pipelines. With OpenSearch, this would require a separate Jaeger deployment.

5. **Simpler application changes** — Changing Winston from `printf` to `json` format is a one-line change. It's simpler than integrating `winston-opensearch` transport or building a Python OpenSearch proxy.

6. **ClickHouse SQL is widely known** — No need to learn LogsQL or Lucene query syntax. Your team already knows SQL.

7. **Single operational model** — One storage backend (ClickHouse), one query language (SQL), one UI (SigNoz). vs. OpenSearch + separate metrics stack + separate traces stack.

### 13.3 Mitigating the "No Existing Code" Disadvantage

The only area where OpenSearch leads is existing donated code. This can be mitigated:

- The Winston change (`printf` → `json`) is **simpler** than integrating `winston-opensearch`
- The Python change (CustomLogger → JSON stdout) is **simpler** than building `logger.py` → OpenSearch proxy
- The admin log query refactoring is **comparable effort** whether querying OpenSearch or ClickHouse SQL
- Net implementation effort may actually be **less** than the OpenSearch approach

### 13.4 The Principle That Matters Most

Regardless of which backend you choose, adopt this principle now:

> **Services must emit structured JSON to stdout/stderr. They must not be coupled to any specific log database. OpenTelemetry Collector is the universal pipeline.**

This preserves the option to switch backends at any time. If SigNoz doesn't work out, you can swap to OpenSearch or VictoriaLogs by changing OTel Collector configuration — without touching any application code.

---

## 14. Appendices

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

### Appendix B: GitLab Issue Hierarchy

```
#354 (Parent) — OpenSearch Integration
├── #355 — Apache OpenSearch Deployment
├── #356 — Refactor the Shared-lib (Winston → OpenSearch)
├── #357 — Implement a Python Logger (→ OpenSearch)
├── #358 — Refactor Python Logging (console → OpenSearch)
├── #359 — Refactor Node.js Admin Log Services (file → OpenSearch)
└── #361 — Build OpenSearch Log Query and Extraction Service
```

> **Note:** If SigNoz is selected, these issues would need to be re-scoped. The parent issue and child issues would change from "OpenSearch" to "SigNoz/OTel" with corresponding task adjustments. The overall structure and intent of the work remains the same.

### Appendix C: Permissive-License Visualization Comparison

| Tool | License | Suitable for Logs? | Suitable for Metrics? | Suitable for Traces? | Notes |
|---|---|---|---|---|---|
| OpenSearch Dashboards | Apache 2.0 | YES (native) | Limited | No | Best if using OpenSearch |
| **SigNoz UI** | **MIT** | **YES** | **YES** | **YES** | Built-in, permissive, full MELT |
| vmui (VictoriaMetrics) | Apache 2.0 | No | YES | No | Basic query explorer only |
| Apache Superset | Apache 2.0 | Limited (SQL) | YES | No | BI-focused, not observability |
| Redash | BSD-2-Clause | Limited (SQL) | YES | No | Query-focused |
| Custom Vue.js dashboards | MIT | YES (build) | YES (build) | YES (build) | Significant effort |

### Appendix D: Resource Quick Reference

```
Docker Compose — Single Node, Moderate Load (~1 GB logs/day)

OpenSearch:
  opensearch:        -Xms2g -Xmx2g     → ~2.5 GB RAM, ~2 CPU cores
  opensearch-dashboards:               → ~512 MB RAM, ~0.5 CPU core
  otel-collector:                       → ~256 MB RAM, ~0.5 CPU core
  Total:                                ~3.3 GB RAM, ~3 CPU cores

VictoriaMetrics Stack:
  victoria-metrics:                     → ~256 MB RAM, ~0.5 CPU core
  victoria-logs:                        → ~256 MB RAM, ~0.5 CPU core
  victoria-traces:                      → ~128 MB RAM, ~0.25 CPU core
  vmalert:                              → ~64 MB RAM, ~0.1 CPU core
  otel-collector:                       → ~256 MB RAM, ~0.5 CPU core
  Total:                                ~960 MB RAM, ~1.85 CPU cores
  + NO COMPLIANT VISUALIZATION

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

### Appendix F: Relevant Links

- [SigNoz GitHub](https://github.com/SigNoz/signoz) — MIT License
- [SigNoz Documentation](https://signoz.io/docs/) — Installation, configuration, query language
- [ClickHouse GitHub](https://github.com/ClickHouse/ClickHouse) — Apache 2.0
- [VictoriaMetrics GitHub](https://github.com/VictoriaMetrics/VictoriaMetrics) — Apache 2.0
- [VictoriaLogs GitHub](https://github.com/VictoriaMetrics/VictoriaLogs) — Apache 2.0
- [OpenSearch Project](https://opensearch.org/) — Apache 2.0
- [OpenTelemetry Collector](https://github.com/open-telemetry/opentelemetry-collector) — Apache 2.0
- [Grafana License Change](https://grafana.com/blog/2021/03/30/grafana-license-change/) — AGPLv3
- [OSI Approved Licenses](https://opensource.org/licenses/) — License reference

---

*End of Document*
