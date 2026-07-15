---
title: Product Brief — GENIE.AI OKF Server
status: draft
created: 2026-07-15
updated: 2026-07-15
initiative: okf-server
branch: feat/okf-server
depends_on:
  - server-side-tools (SST) initiative — consumes Registry / ToolExecutor / Stream-Ingestor / mcpo once built
  - Sprint 24 #603 (LangGraph + MCP) — gates the MCP serving surface only
  - dataprep / retriever (exist on main) — reused unchanged
authors: Genie.ai Dev
---

# Product Brief: GENIE.AI OKF Server

## Executive Summary

In June 2026 Google published the **Open Knowledge Format (OKF v0.1)** — a vendor-neutral way to package organizational knowledge as Markdown + YAML frontmatter so any AI agent can read it. Google was explicit that OKF is a *format, not a platform*: it deliberately does not prescribe how knowledge bundles are stored, served, secured, curated, or queried. The result is a gap every agent builder hits — there is no open, sovereign, multi-tenant service that *hosts* many OKF bundles and *serves* them to agents with enterprise-grade governance. Every existing OKF consumer is either a local stdio tool or locked to Google Cloud; every open-source GraphRAG / agent-memory engine ships with **no multi-tenancy, RBAC, audit, or data-residency story** (Graphlit is winding down; KùzuDB is archived).

The **GENIE.AI OKF Server** fills that gap. It is an open-source service, built on Genie's existing stack (OPEA Python/FastAPI, ArangoDB, Keycloak, Kong, OTel, Docker Swarm), that ingests OKF bundles from Git and S3, indexes them as a graph+vector corpus **alongside the existing RAG pipeline**, and exposes them to AI agents over a read-only **REST API now**, with an **MCP** surface ready for Sprint 24's agentic workflows. It is **complementary** to Genie's dataprep/RAG pipeline and the planned Server-Side Tools foundation — it consumes them, it does not compete with them. It is engineered from the first commit for **enterprises and public services (government)**: sovereign, air-gappable, multi-tenant, privacy-protecting, and fully auditable.

## The Problem

- **OKF standardized the format, not the serving.** Producers can author bundles, but nothing fetches, hosts, secures, curates, or queries them at scale.
- **Every OKF consumer today is local or locked-in.** Community MCP servers are stdio-only; Google's serving is GCP-bound. No multi-tenant, authenticated, hosted, *governed* OKF server exists — open or commercial.
- **Open-source GraphRAG/memory engines lack governance.** Microsoft GraphRAG, LightRAG, LlamaIndex, Graphiti, Letta, Cognee, mem0 — none ship multi-tenancy, RBAC, audit, PII handling, or data residency.
- **Genie's agents have no addressable knowledge surface today.** Knowledge is queryable only through the BFF-mediated RAG chat path; an agent cannot discover, address, cite, or traverse a curated, version-pinned knowledge bundle.
- **Enterprise & government realities are unmet.** Agencies need data curation (review/approval, provenance, retention), privacy (PII minimization, GDPR/FOI, right-to-erasure), security (per-bundle access control, encryption, supply-chain integrity), sovereignty (data residency, air-gap), and accountability (FOI-exportable audit) — none of which the format or any existing consumer provides.

## The Solution

A config-driven **OKF Server** that:

1. **Hosts** multiple OKF bundles declared in configuration, synced from Git repositories and S3-compatible buckets (native git diff + rclone/boto3), with version tracking, provenance, and change-driven re-indexing.
2. **Indexes** each bundle through Genie's existing **dataprep** pipeline into a dedicated ArangoDB graph (`graph_name="OKF"`) — adding OKF-aware frontmatter extraction, Markdown-header chunking, and a structural **concept link-graph** alongside the existing LLM entity graph. The vector/graph store, TEI embeddings, hybrid retrieval, and retract cascade are reused unchanged.
3. **Serves** agents over a read-only **REST API** (search, get-document, list-bundles, outline) using progressive disclosure and token-budgeting; an **MCP** surface (`okf://` resources + search/get tools) is layered on when Sprint 24's `mcpo`/MCP infrastructure lands.
4. **Curates** the knowledge lifecycle: bundle registration, conformance validation on ingest (OKF §9), review/approval states, version pinning, citation/provenance capture, retention/TTL, and quality metrics — so knowledge is managed *as code*, like the rest of Genie.
5. **Governs & protects** per-tenant and per-bundle via Keycloak OIDC (terminated at Kong); mandatory PII redaction on ingest (BLOCK on failure); encryption in transit and at rest; no third-party egress; full OTel traceability and FOI-exportable audit logging. Air-gap deployable.

## What Makes This Different

- **The only open-source, sovereign, governed, hosted OKF serving layer** — the consumer Google's spec invited the ecosystem to build, with the enterprise/government grade no OSS GraphRAG tool provides.
- **Government- and public-service-ready by design.** Sovereign (runs inside a national boundary, air-gappable), multi-tenant (multiple agencies / departments on one deployment, isolated), privacy-protecting (PII redaction, data minimization, right-to-erasure), accountable (FOI-exportable audit, lineage), accessible and multilingual (inherits Genie's i18n).
- **Native to Genie's stack, ~80% reuse.** The OKF index is essentially zero-code (`graph_name` parameterization already exists); net-new code is the bundle manager, OKF loader, structural link emitter, curation/governance, and the serving API.
- **Single-store, minimal-vendor footprint.** ArangoDB (Apache-2.0) is the *only* data store — document + graph + vector + BM25 in one engine — so we add **no Neo4j (any edition), no separate vector DB, and no new search vendor**. Everything else is Genie's existing stack; new dependencies are permissive libraries, not infrastructure or SaaS.
- **Complementary, not competitive.** Extends dataprep/RAG; consumes the planned Server-Side Tools foundation; agents querying the existing ChatQnA retriever see OKF knowledge transparently.
- **Permissively licensed** (MIT/Apache-2.0) — mandatory under Genie's own DPG NFR26, and a condition of open-sourcing.

## Who This Serves

- **Government / public-sector Genie deployments** needing a sovereign, auditable knowledge fabric for AI agents (ministries, agencies, regulators).
- **Enterprise platform & data teams** curating knowledge-as-code (bundles in Git, reviewed like source).
- **AI agents** — Genie's own LangGraph agents (Sprint 24) and external MCP clients — that need structured, citable, version-pinned, access-controlled context.
- **Knowledge stewards / data-protection officers** who manage bundle access, provenance, retention, and compliance.

## Success Criteria

- Agents can search, fetch, and traverse OKF bundles; results are citable and version-pinned.
- Bundles added in config from Git/S3 are validated, indexed, and queryable with **no code change** to dataprep/retriever.
- **Curation:** bundle lifecycle (register → validate → review → publish → version → retire) is managed; provenance and lineage are captured; retention/TTL enforced.
- **Privacy & security:** per-bundle/per-tenant RBAC enforced; PII redacted on ingest; every access auditable and OTel-traceable; secrets managed; supply-chain integrity (SBOM, signed images per ADR-0001).
- **Sovereignty:** no third-party egress; data residency preserved; deployable air-gapped.
- Released as open-source under a permissive license, with reference bundles, and adopted beyond Genie.

## Scope

**In (v1 / MVP — read-only, REST-first):**
- Config-driven Git + S3 bundle sources, sync, version tracking, provenance, change-driven re-indexing.
- OKF loader: YAML frontmatter → metadata, Markdown-header chunking, structural concept link-graph into `OKF_*` collections; OKF §9 conformance validation on ingest.
- Read-only REST API: search, get-document, list-bundles, outline (progressive disclosure, token caps, cursor pagination).
- Curation: bundle lifecycle states, review/approval gate, version pinning, retention/TTL, quality/conformance metrics.
- Governance & privacy: per-tenant/per-bundle RBAC via Keycloak (Kong-terminated); PII redaction on ingest; ClamAV scan; encryption in transit/at rest; OTel spans + FOI-exportable audit; air-gap deployable.
- Open-source packaging (permissive license, ITU copyright headers, CI build/scan/promote per ADR-0001).

**Out (v1):**
- MCP serving surface (gated on Sprint 24 `mcpo`/MCP infra + SST Registry).
- Write / agent-propose curation loop (agents suggesting edits through the review gate).
- Formal typed ontology / semantic relationships (spec-pure + optional taxonomy only).
- A2A agent discovery; gRPC; non-OKF source formats.

**Dependencies (declared):** dataprep + retriever (exist, reused); SST Registry/Executor/Stream-Ingestor + Sprint 24 #603 (gate the **MCP surface only** — the REST MVP proceeds now).

## Vision

In 2–3 years, GENIE.AI is the **sovereign knowledge fabric for GovStack AI agents**, and the OKF Server is the canonical open-source reference implementation of a governed, enterprise- and government-grade OKF consumer/serving layer — around which a community of producers (catalog exporters, enrichment agents) and consumers (agent frameworks, visualizers) grows, exactly as Google's "format, not platform" thesis intended, but with the trust model public services require.
