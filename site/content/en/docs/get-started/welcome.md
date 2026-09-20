---
title: "Welcome to GENIE.AI"
weight: 1
description: "The one-pager — what GENIE.AI is, who it is for, and where to go next."
mode: explanation
persona: mixed
owner: docs-stewards
last_reviewed: 2026-09-18
---

## What GENIE.AI is

GENIE.AI is an **open-source retrieval-augmented-generation framework** built
for the public sector. It bundles a multilingual chat UI, a self-hosted RAG
pipeline, an admin dashboard, an identity layer, and a configurable
observability stack — so a government or NGO can deploy a sovereign AI
assistant without sending a single query to a third-party model API.

The pipeline is built on top of [OPEA](https://opea.dev), the Open Platform
for Enterprise AI, and integrates with the [Digital Public Goods](https://digitalpublicgoods.net/)
ecosystem.

## Who it is for

- **Citizens** — ask questions about public services in their own language.
- **Operators** — keep the system healthy, update the knowledge base, and
  scale it.
- **Developers** — extend the API, customize the UI, swap models.
- **Contributors** — improve the codebase, the docs, and the translations.

## How a query flows

```
User → Frontend (Vue) → Backend (BFF) → ChatQnA → Embedding
  → Retriever (ArangoDB) → Reranker → LLM (vLLM) → Response
```

Every stage emits OpenTelemetry traces so a single query can be debugged
end-to-end in Grafana / VictoriaTraces.

## What is sovereign here

- **Models** run on your hardware (vLLM / TEI) — no model API keys required.
- **Data** stays in your ArangoDB and document store.
- **Identity** is delegated to your Keycloak (or any OIDC provider).
- **Telemetry** is optional — opt in with `ENABLE_OBSERVABILITY=1` and
  everything lands in Victoria* stores you control.

## Where to next?

- New user → [Quickstart: User](/docs/get-started/quickstart-user/)
- Installing → [Quickstart: Deployer](/docs/get-started/quickstart-deployer/)
- Extending → [Quickstart: Developer](/docs/get-started/quickstart-developer/)
- Contributing → [Quickstart: Contributor](/docs/get-started/quickstart-contributor/)

## Related

- [Concepts in 5 minutes](/docs/get-started/concepts/)
- [Glossary](/docs/get-started/glossary/)
- [Architecture overview](/docs/architecture/architecture/)