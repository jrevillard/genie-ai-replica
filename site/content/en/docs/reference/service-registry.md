---
title: "Service registry enum"
weight: 6
description: "Canonical service-name enum — genieai-* service names, OTel attributes, and image tags."
mode: reference
persona: developer
owner: docs-stewards
last_reviewed: 2026-09-18
---

## Purpose

The canonical enum of service names used in OTel attributes, VictoriaLogs
filters, Kong routes, and Docker swarm service names. The Python enum lives
in `genie-ai-overlay/core/constants.py`.

## Service registry

> **Note:** The "Enum value" column is a logical role used in code and
> ops queries — there is no service-name enum in
> `genie-ai-overlay/core/constants.py` (only the OPEA service-`type`
> enum `ServiceType` lives there). The OTel `service.name` column shows
> the value passed to `setup_tracing(...)` for instrumented services, or
> the env-var / container name for uninstrumented ones. "Docker service"
> is the block name in `docker-compose.yaml`; in Docker Swarm it is
> prefixed by the stack name (e.g. `genieai_chatqna-xeon-backend-server`).

| Role | OTel `service.name` | Docker service | Image |
|---|---|---|---|
| `chatqna` | `genieai-chatqna` | `chatqna-xeon-backend-server` | `genie-ai-chatqna-server` |
| `retriever` | `genieai-retriever` | `retriever-arango-service` | `genie-ai-retriever-arango` |
| `reranker` | `genieai-reranker` | `reranker` | `genie-ai-reranker` |
| `embedding` | _(external — TEI)_ | `embedding` | `genie-ai-embedding` (TEI `text-embeddings-inference`) |
| `textgen` | _(external)_ | `textgen` | `genie-ai-textgen` |
| `vllm` | _(external)_ | `vllm` | `vllm/vllm-openai` |
| `dataprep` | `genieai-dataprep` | `dataprep-arango-service` | `genie-ai-dataprep-arango` |
| `translation` | _(part of chatqna)_ | `translation` | `opea/translation:1.5` |
| `doc-repo` | _(Node.js)_ | `document-repository` | `genie-ai-document-repository` |
| `backend` | `genie-backend` | `backend` | `genie-ai-backend` |
| `frontend` | _(not instrumented)_ | `frontend` | `genie-ai-frontend` |
| `kong` | _(Kong OTel plugin)_ | `kong` | `kong:3.9.3` |
| `nginx` | _(not instrumented)_ | `nginx` | `genie-ai-nginx` |
| `keycloak` | _(not instrumented)_ | `keycloak` | `genie-ai-keycloak` |
| `arangodb` | _(not instrumented)_ | `arango-vector-db` | `arangodb/arangodb:3.12.4` |
| `redis` | _(not instrumented)_ | `redis-cache` | `redis:7-alpine` |
| `clamav` | _(not instrumented)_ | `clamav` | `clamav/clamav:stable-debian` |
| `otel-collector` | `otel-collector` | `otel-collector` | `otel/opentelemetry-collector-contrib:0.152.0` |
| `victoriametrics` | `victoriametrics` | `victoriametrics` | `victoriametrics/victoria-metrics:v1.138.0` |
| `victorialogs` | `victorialogs` | `victorialogs` | `victoriametrics/victoria-logs:v1.50.0` |
| `victoriatraces` | `victoriatraces` | `victoriatraces` | `victoriametrics/victoria-traces:v0.9.2` |
| `grafana` | `grafana` | `grafana` | `grafana/grafana:12.4` |

## Swarm label convention

The Swarm label convention documented in earlier docs
(`genieai.service.name`, `genieai.component`, `genieai.persona`) is **not
currently applied** in `docker-compose.yaml`. If the OTel Collector uses
those labels for resource attribute enrichment, that enrichment is
inactive today — verify against `configs/otel/config.yaml` before
relying on it.

## VictoriaLogs query examples

```logsql
{service.name="genieai-chatqna"} | error
{service.name=~"genieai-(backend|chatqna|retriever)"}
{service.name="genieai-vllm"} AND _msg:"oom"
```

## Adding a new service

1. Add the enum to `genie-ai-overlay/core/constants.py`.
2. Add the OTel `service.name` to the new service's `OTEL_SERVICE_NAME`
   env var.
3. Add the Swarm label to the service's `docker-compose.yaml` block.
4. Document it on this page and in
   [Architecture → OPEA microservices](/docs/architecture/opea-microservices/).

## Related

- [Reference → OPEA protocol](/docs/reference/opea-protocol/)
- [Observe → Logs](/docs/operate/admin-logs/)
- [Architecture → OPEA microservices](/docs/architecture/opea-microservices/)