# ADR okf-019: AI-driven OKF Producer (Crawl → Draft) — a built-in, steward-gated producer

- **Status**: Proposed
- **Date**: 2026-08-12
- **Decision owners**: Genie.ai Dev (architect)

## Context

The OKF PRD §5 Non-Goal states the OKF Server "hosts and serves, and offers in-app authoring for human curators," and names only **external** producers (Google enrichment agent, OKFy, catalog exporters) for automatic production. There is no Genie-native producer today. The two existing ways to get content into an OKF repository are (a) Git/S3 sync of an externally-produced bundle (FR-1) and (b) in-app human authoring (FR-25).

The web crawler ([crawlWorker.js](../../components/document-repository/src/workers/crawlWorker.js)) is a fully-wired streaming pipeline whose **only** terminal output is a single flat `{fileId}.md` that concatenates crawled pages as `## Source: <url>` blocks separated by `---` (L210-211). It sets `crawl_job.status = 'Succeeded'` (L289-296) and stops — **there is no post-crawl hook and no connection to the OKF Server.** The output has no concept boundaries, no frontmatter, no cross-links, no provenance beyond the `## Source:` header, and is ingested only via a separate manual action into the **free-form `GRAPH` corpus**, not OKF. A product decision (2026-08-12) directs GENIE to build an **AI-driven producer** that lifts this dump into governed OKF concept drafts, as the **rapid means of creating OKF repositories** (for testing and bootstrapping) and of automating knowledge-hierarchy + label assignment. Basis: [okf-ai-producer-analysis-2026-08-12](../../_bmad-output/planning-artifacts/okf-ai-producer-analysis-2026-08-12.md) and the [Sprint Change Proposal 2026-08-12](../../_bmad-output/planning-artifacts/sprint-change-proposal-2026-08-12.md).

Three placement options were evaluated (see Alternatives). The load-bearing constraints are: ADR-okf-001 makes the OKF Server a **Node/Express** service; ADR-okf-010 places OKF markdown/frontmatter parsing **Node-side**; NFR-S6 makes the container **CPU-only/non-root**; the feature must land **after Epic 3 and ungated** by the OPEA 1.5 bump; and the producer's output must be **steward-gated** (drafts enter `review`, never auto-publish; trust-capped) per FR-9/FR-10 and the SM-C1 quality-over-volume counter-metric.

## Decision

**Add a bounded, Genie-native, steward-gated AI producer as a built-in OKF Server module (Epic 7), implemented inside the Node OKF Server and calling the model over HTTP.**

1. **Built-in producer (amends PRD §5 Non-Goal).** The producer is a Genie-native component — *not* a catalog-export replacement (the original non-goal target, Dataplex/Collibra/Unity, stays excluded). It is bounded to **crawl → draft**: crawled content is segmented and drafted into OKF concept `.md` files with YAML frontmatter, written to `okf_concepts_meta` at lifecycle state `review`. It exists to fill the sovereign internal-content gap external cloud producers cannot reach and to be the rapid repo-creation enabler for testing/bootstrapping.

2. **Placement: inside the Node OKF Server, model calls over HTTP** (skeleton-map "option b"). A new `components/okf-server/services/producer-service.js` (sibling to `repository-service.js`) reads the completed crawl `{fileId}.md`, splits on `## Source:` blocks, invokes the configurable model client ([ADR-okf-020](okf-020-configurable-inference-model-tier.md)) to derive concept title/summary/frontmatter/hierarchy/labels, and emits concept `.md` in exactly the format `parser-service` (Story 2.3) consumes — the producer is the **generator dual** of the Node parser, sharing the OKF v0.2 frontmatter schema + `gray-matter`/`markdown-it` deps (ADR-okf-010). CPU-only (NFR-S6) holds because inference is a **remote** HTTP call. This honors ADR-okf-001/010, reuses `axios`/`createApp()`/shared-lib, is ungated, and lands in time.

3. **Entry points.** (a) `POST /api/okf/repos/:repo_id/produce-from-crawl {file_id, model_tier}` (tools-admin, mirrors `repos-routes.js`); (b) a thin **fire-and-forget post-crawl trigger** in `crawlWorker.js`'s success block (L289-296) that reads a `crawl_job.config.okf` intent (`{produce, repo_id, model_tier}`) and signals the producer — wrapped so a producer failure **never** breaks crawl success. The document-repository stays thin; producer logic lives in the OKF Server.

4. **Steward-gated, never auto-publish (non-negotiable).** Producer concepts enter at `status = review`; **publish remains an explicit steward action** (FR-9/FR-10, FR-29). The producer stamps `generated.by = agent:okf-producer` and the trust tier is **`unverified`** ([ADR-okf-017](okf-017-okf-v02-trust-lifecycle-provenance.md)); steward publish writes `verified` but a concept's machine origin is preserved. This cap is **enforced server-side**, not producer-side, and covered by a test.

5. **Governance routing.** Producer drafts pass through the OKF Server's planned `governance/` module (Presidio PII redaction, **blocking** on failure; frontmatter scanned, not just bodies — [ADR-okf-004](okf-004-pii-redaction-strategy.md)) **before** staging `review`. The producer is a Node batch service and is therefore **not** wrapped by the SST `workflows/tools/governance.py` LangGraph-only wrapper — so the OKF Server's own governance module is the mitigation for the governance-bypass risk; do not assume the SST wrapper covers it.

6. **Hardening is in-scope (Epic 7 Story 7.5).** Producer-emitted frontmatter/link fields are treated as **untrusted** (server-side override of trust; links constrained to a closed concept-ID namespace) to resist **indirect prompt injection via crawled content**; a concept-quality eval harness + `steward rejection rate` guardrail police SM-C1; per-tenant/per-crawl quotas + trigger RBAC bound GPU/provider cost (including the future agent-trigger scenario); robots.txt/ToS + output-bundle `license` provenance are handled.

7. **Provenance.** The crawler's `## Source: <url>` header is promoted into frontmatter `sources` (FR-29). The crawler dump is **already inside** the document-repository (the runtime source of truth, ADR-okf-016); the producer consumes it by `fileId`, so the web crawl is **not** a Git/S3 sync source and does not create a query-time dependency on the origin.

## Alternatives considered

| Alternative | Status |
|---|---|
| **(a) Python OPEA-overlay module** the Node OKF Server calls over HTTP | Rejected for v1 — reuses the Python LLM stack + GPU, but **contradicts ADR-okf-001/010** (pushes OKF logic back into Python), adds a new image to build/scan/promote, and is **gated by the OPEA 1.5 bump**. Revisit only if Python-side synthesis ergonomics dominate. |
| **(c) LangGraph tool** in the workflows service (`workflows/tools/okf_producer.py`) | Deferred — inherits `governance.py` for free and is MCP-exposable, but **couples a deterministic batch job to the not-yet-built agentic layer** (Sprint 24 #603) and makes repo creation agent-driven. Natural **future evolution** of the Node producer once the agentic layer lands (then re-evaluate the governance + agent-trigger implications). |
| Auto-publish / "crawl → published OKF" | Rejected — violates FR-9/FR-10, the SM-C1 counter-metric, and the trust model. Drafts always land in `review`. |
| External producers only (keep §5 as-is) | Rejected for the sovereign internal-content + rapid-testing use case — external cloud producers cannot run air-gapped and require egress (NFR-S1). |

## Consequences

- **Positive**: a Genie-native, sovereignty-safe path to rapidly populate OKF repositories for testing and bootstrapping; crawled content becomes governed/citable/retractable (FR-9/10/12/18/19/29) instead of an invisible free-form dump; the producer is ungated and lands after Epic 3.
- **Negative**: a new Node module + new npm deps (supply-chain/SBOM); a fire-and-forget cross-service trigger (document-repo → OKF Server) to keep resilient; prompt-injection and rubber-stamp risks that Story 7.5 must mitigate; producer-assigned labels fully steer retrieval only after Story 2.6 (ACL-preserve) + Epic 1 (multi-graph fan-out) land — both gated.
- **Mitigations**: steward gate + server-side trust cap; sovereignty gate ([ADR-okf-020](okf-020-configurable-inference-model-tier.md)); untrusted-frontmatter handling; eval harness + rejection-rate guardrail; shared frontmatter contract with Story 2.3 to prevent producer/parser drift.

## References

PRD §5, §3, §4.9 (FR-30/32), §6, §7, §10, §12, §13; [Sprint Change Proposal 2026-08-12](../../_bmad-output/planning-artifacts/sprint-change-proposal-2026-08-12.md); [okf-ai-producer-analysis-2026-08-12](../../_bmad-output/planning-artifacts/okf-ai-producer-analysis-2026-08-12.md); [ADR-okf-001](okf-001-okf-server-component-and-stack.md); [ADR-okf-004](okf-004-pii-redaction-strategy.md); [ADR-okf-010](okf-010-okf-markdown-loader-location.md); [ADR-okf-015](okf-015-in-app-authoring-curation.md); [ADR-okf-016](okf-016-external-source-management.md); [ADR-okf-017](okf-017-okf-v02-trust-lifecycle-provenance.md); [ADR-okf-020](okf-020-configurable-inference-model-tier.md).
