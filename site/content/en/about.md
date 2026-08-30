---
title: "About GENIE.AI"
weight: 20
description: "What GENIE.AI is, why it matters for the public sector, its security and data-protection model, and who it is for."
---

# About GENIE.AI

GENIE.AI is an open-source generative-AI framework for the public sector: a
sovereign, Digital Public Good (DPG)-compliant **Retrieval-Augmented Generation
(RAG)** platform with multilingual support. It answers questions strictly from a
knowledge base you control, running every model on infrastructure you own. It
integrates with [OPEA (Open Platform for Enterprise AI)](https://opea.dev) for
AI/ML services.

## Why it matters

Public-sector institutions have constraints that generic AI services cannot meet.
GENIE.AI is built around them:

- **Sovereignty.** Data, models, and the answering pipeline all run on
  infrastructure the operator controls. No query, document, or user interaction
  leaves the deployment to a third-party model API.
- **Grounded answers, not guesses.** The LLM is constrained to answer only from
  retrieved knowledge-base content and to **abstain** when the answer is not
  there — critical where a confident but wrong answer is worse than none.
- **No vendor lock-in.** Standards-based throughout: OIDC identity,
  OpenTelemetry observability, OpenAI-compatible model APIs, W3C trace context.
  Models, identity providers, and storage can be swapped without rewriting the
  platform.
- **Digital Public Good.** GENIE.AI is developed as a DPG — open and reusable
  across governments and public agencies.

## Security & data protection

GENIE.AI's security model assumes a deployment on infrastructure the operator
trusts:

- **Self-hosted models** — embedding, reranking, generation, and translation run
  on your own GPU/CPU via OPEA / vLLM / TEI. There is no call to an external
  model provider by default.
- **Identity & access** — Keycloak (OIDC) handles authentication and
  role-based access; the API gateway (Kong) enforces routing and rate limits.
  See [Configuration &rarr; Keycloak]({{< relref "/docs/configuration/keycloak-admin-guide" >}}).
- **Document safety** — every uploaded document is virus-scanned (ClamAV) before
  it is stored or processed. See [Knowledge base &rarr; Ingestion]({{< relref "/docs/knowledge-base/ingestion" >}}).
- **PII-safe telemetry** — observability spans are filtered to strip sensitive
  attributes (tokens, passwords, user PII) before export. See
  [Observability &rarr; Tracing]({{< relref "/docs/observability/tracing" >}}).
- **Hardened backend** — security headers (`helmet`), rate limiting, and
  CORS/CSP policies are applied at the backend and gateway.
- **Data residency** — because the whole stack is self-hosted, data stays within
  the deployment's jurisdiction.

## Who it is for

GENIE.AI serves a range of public-sector and institutional contexts — government
agencies, public services, NGOs, and international organisations that need a
trustworthy, self-hosted question-answering capability over their own content.

The people who use this documentation fall into four roles:

| Role | What you'll do | Start here |
|---|---|---|
| **Evaluator / decision-maker** | Assess fit, sovereignty, compliance. | This page + [Project overview]({{< relref "/docs/core/project-overview" >}}) |
| **Operator / admin** | Deploy, configure, run, observe. | [Deployment]({{< relref "/docs/deployment" >}}) + [Observability]({{< relref "/docs/observability" >}}) |
| **Knowledge / content manager** | Curate the knowledge base. | [Knowledge base]({{< relref "/docs/knowledge-base" >}}) |
| **Developer / integrator** | Extend, integrate, customise. | [Architecture]({{< relref "/docs/architecture" >}}) + [RAG pipeline]({{< relref "/docs/rag" >}}) |

## What you can do with it

- Stand up a multilingual, grounded Q&A service over your own document base.
- Organise content with a service-category taxonomy for precise, on-topic
  retrieval.
- Observe the full RAG pipeline (retrieval, reranking, generation) with
  distributed tracing and pre-built dashboards.
- Deploy on a single host (Compose) or a cluster (Swarm), with or without local
  GPUs.

For the full feature surface and the architecture behind it, read the
[Project overview]({{< relref "/docs/core/project-overview" >}}) and the
[Architecture]({{< relref "/docs/architecture" >}}) section.

## Getting started

New to GENIE.AI? The fastest path:

1. Read the [Project overview]({{< relref "/docs/core/project-overview" >}}) for
   the 10-minute orientation.
2. Follow the [Installation & Configuration Guide]({{< relref "/docs/deployment/install-guide" >}})
   to stand up a deployment.
3. Load documents via the [Knowledge base]({{< relref "/docs/knowledge-base" >}})
   workflow and start asking questions.
