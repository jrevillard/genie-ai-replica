# Sprint Change Proposal — AI-Driven OKF Producer (Crawl → Draft)

**Date:** 2026-08-12 · **Branch:** `feat/okf-server` · **Scope:** Major · **Status:** Applied (2026-08-12) — see §6
**Workflow:** BMAD `correct-course`
**Basis:** [okf-ai-producer-analysis-2026-08-12.md](./okf-ai-producer-analysis-2026-08-12.md) (6-lens assessment + adversarial review) and the 6-area floor-to-ceiling codebase map (crawler/UI, ingest/bundle, dataprep model layer, OKF skeleton, admin UI, hierarchy/labels).

## 1. Issue Summary

**Trigger (product decision, 2026-08-12).** Add a Genie-native **AI-driven OKF producer** that lifts the web crawler's flat Markdown dump into governed OKF concept drafts, as the **rapid means of creating OKF repositories** (for testing and bootstrapping) and of **automating knowledge-hierarchy + label assignment**. Six directives govern it:

- **D-1** New **Epic 7 — AI-Driven OKF Producer (Crawl → Draft)**; **steward-gated** (drafts enter `review`, never auto-publish; trust-capped `unverified`).
- **D-2** Sequenced **after Epic 3** (admin UI drives it); depends on Story 2.2 (done), **2.3 (in progress — defines the frontmatter contract the producer emits)**, 2.5 (bundle route), 3.x. Co-develops with 4.2/4.3/4.4.
- **D-3** Purpose: rapid repo creation from authoritative/internal web sources + automated hierarchy/labels (ingest **and** query).
- **D-4** **Configurable model tier** — internal granite-4.1-8b (vLLM, OpenAI-compatible) **OR** frontier via API key, multi-provider: **Anthropic, xA­I/Grok, Gemini, OpenAI**. Default internal/sovereign; external = explicit opt-in.
- **D-5** Amend PRD §5 non-goal to permit a bounded Genie-native steward-gated producer (distinct from "catalog-export replacement").
- **D-6** Update **both** BMAD artifacts **and** GitLab.

**Evidence (repo-grounded).** The crawler terminates in a single flat `{fileId}.md` of `## Source: <url>` blocks with **no post-crawl hook** ([crawlWorker.js:289-296](components/document-repository/src/workers/crawlWorker.js#L289)), **no OKF connection** (zero `okf`/`graph_name` matches in document-repository), and **no model-tier config anywhere**. The producer, the model client, and the crawler→OKF bridge are entirely new. The label/hierarchy machinery and service-category CRUD already exist and are reused.

## 2. Impact Analysis

### 2.1 Epic impact
- **New Epic 7** (appended — **no renumbering** of epics 4–6, which would break existing story IDs + GitLab labels `okf-server::epic-4..6`). Built **after Epic 3**, before curation/serving test data is needed.
- **Epic 2 — one scope addition:** Story 2.6 gains an additive correctness fix (preserve ACL-prefixed `file_labels` into `chunk_labels` — today silently dropped, HIGH-severity for OKF ACL isolation). 2.6 remains bump-gated.
- **Epics 1, 4, 5, 6 — unchanged scope**; Epic 7 produces the draft repos they curate/serve/ground. Producer-assigned labels fully steer retrieval only after Epic 1 (multi-graph fan-out) + 2.6 land (both gated) — noted as a downstream activation, not a blocker for building Epic 7.

### 2.2 Story impact
- **In progress:** Story **2.3 (parser)** is untouched functionally, but it now also **defines the producer's output contract** — the producer emits exactly what `parser-service` consumes (concept `.md` + YAML frontmatter). No change to 2.3's AC; a dependency note is added.
- **New stories 7.1–7.5** (see §4.4).
- **Backlog additions to 2.6** (ACL-label preserve) — additive, gated.

### 2.3 Artifact conflicts (all resolvable by amendment, no rollback)
- **PRD §5 non-goal** conflicts with a Genie-native producer → amended (D-5).
- **ADR-okf-001/010** place OKF logic Node-side; the **Node producer calling the model over HTTP** *honors* these (CPU-only is fine — inference is remote). No ADR conflict; new ADRs record the decision.
- **ADR-okf-016** (external sources are sync-only) — clarified: the crawler dump is *already inside* the document-repository; the producer consumes it by `fileId`, so it is **not** a sync source. Addendum only.
- **NFR-S1 (sovereignty)** — external model providers are egress; resolved by a fail-closed `LLM_EXTERNAL_EGRESS_ENABLED` gate (default off).

### 2.4 Technical impact (grounded)
- **New Node module** `components/okf-server/services/producer-service.js` + `services/model-client/` + `routes/producer-routes.js`; new npm deps (an OpenAI-compatible client for internal/openai/xai; `@anthropic-ai/sdk`, `@google/generative-ai` for frontier) → flow through the **blocking** `scan:okf-server` CI gate + CycloneDX SBOM.
- **document-repository** gets a thin, fire-and-forget post-crawl trigger (crawlWorker success block) + a `crawl_job.config.okf` intent field. The crawl streaming design is **not** touched.
- **doc-repo bundle route (Story 2.5)** is the producer's ingest path (ClamAV + `graph_name` threading) — unchanged scope, just consumed.
- **dataprep** (2.6, gated): ACL-preserve additive fix + short-circuit LLM when concept frontmatter already carries labels.
- **Frontend**: new `OkfProducerWizard.vue` (clone of `AddFromLinkDialog.vue`), `okfProducerService.js`, Vuex `okf` module, model-tier selector, "Generate Hierarchy / Auto-label" actions on the existing hierarchy tab, `{silent:true}` progress polling.
- **Governance**: producer drafts route through the OKF Server's planned `governance/` (Presidio, blocking) before staging `review` — **not** the SST `governance.py` wrapper (which only covers LangGraph tools; the producer is a Node batch service). Recorded explicitly to close the governance-bypass risk.
- **Secrets**: frontier API keys in `.env`/Ansible vault only, referenced by name (never in code/committed `env`).

## 3. Recommended Approach

**Option 1 — Direct Adjustment** (chosen): add Epic 7 + 2 new ADRs + targeted PRD/Architecture amendments + one additive 2.6 scope item + GitLab sync. **No rollback, no MVP replan.** Effort: ~3–5 engineer-weeks across Node + frontend + (gated) small Python additions. Risk: **medium** — mitigated by the steward gate, server-side trust cap, sovereignty gate, and the producer-hardening story (7.5). Sequencing keeps it off the critical path (after Epic 3) and ungated from the OPEA bump.

**Scope classification: Major** → PM/Architect sign-off (this approval gate), then Developer execution.

## 4. Detailed Change Proposals

### 4.1 PRD (`prd-okf-server-2026-07-15/prd.md`)

| Section | Change |
|---|---|
| §5 Non-Goals | Amend: permit a **bounded Genie-native steward-gated AI producer** (crawl→draft, never auto-publish). Keep the exclusion of "catalog-export replacement." |
| §3 Glossary | Add: **Producer**, **Model tier (configurable inference)**, **Producer job**. |
| §4 Features | New **§4.9 AI-Driven OKF Production (Crawl → Draft)** with **FR-30** (AI-driven production from crawl results; drafts→review; never auto-publish; server-side trust cap `unverified`), **FR-31** (configurable model tier: internal vLLM/granite OR frontier Anthropic/xAI/Gemini/OpenAI by API key; external = sovereignty opt-in), **FR-32** (automated knowledge-hierarchy + label assignment for ingest+query; reuses service-category CRUD + `chunk_labels`). |
| §6 Production Scope | Add Epic 7 (producer) to in-scope, sequenced after Epic 3. |
| §7 Success Metrics | Add **SM-7** (bootstrap velocity: crawl→draft repo ready for steward review ≤ target), guardrail **steward rejection rate** (too low = rubber-stamp; too high = poor drafts); reaffirm SM-C1 applies (quality > volume). |
| §10 Dependencies | Producer depends on 2.2/2.3/2.5/3.x; co-develops with 4.2–4.4; label→retrieval steering activates post-bump (2.6 + Epic 1). |
| §12 Why Now | Add: producer = the rapid repo-creation enabler that unblocks testing of curation/serving; fills the sovereign internal-content gap external cloud producers cannot reach. |
| §13 Open Questions | Close "build a producer?" (yes). Add: default model tier for the landing; segmentation policy (page vs cluster); agent-trigger authorization + per-tenant quotas; eval-harness ownership; output-bundle licensing. |

### 4.2 Architecture (`architecture.md`)

| Section | Change |
|---|---|
| §8.1 | Add **producer** + **model-client** to the OKF Server module list (Node). |
| §6 (ingestion) | Insert a producer stage: crawl-complete → producer (segment + draft + label) → governance (Presidio, blocking) → `review`. |
| §8.2 | Note producer submits drafts via the FR-5/FR-22 bundle route (`graph_name=OKF_{repo_id}`, `lifecycle=draft`). |
| §8.6 | Add model-tier env + secrets to the `okf-server` compose block; `LLM_EXTERNAL_EGRESS_ENABLED` gate. |
| §10 | Promote "generate via a producer" from external-only to **built-in (Epic 7)** in the Author lane. |
| §13 sequencing | Add **step 3.5: AI-driven producer** after step 3 (UI), before step 4 (curation). |

### 4.3 New ADRs

- **`docs/adr/okf-019-ai-driven-okf-producer.md`** — Decision: build the producer **inside the Node OKF Server** (skeleton-map option b), calling the model over HTTP; steward-gated drafts; server-side trust cap (`generated.by=agent:okf-producer`, `trust_tier=unverified`, never auto-publish); drafts route through OKF `governance/` (Presidio) — **not** the SST wrapper; §5 non-goal amendment; rejects option (a) Python (contradicts ADR-001/010, gated) and defers option (c) LangGraph tool (future, once agentic layer lands). Amends/notes ADR-okf-010 (producer is the generator dual of the Node parser), ADR-okf-016 (crawler dump is not a sync source).
- **`docs/adr/okf-020-configurable-inference-model-tier.md`** — Decision: Node `model-client` abstraction; **internal** = OpenAI-compatible vLLM (granite-4.1-8b, reuses `VLLM_ENDPOINT`/`VLLM_API_KEY`); **frontier** = Anthropic/xAI/Gemini/OpenAI adapters (xAI/OpenAI are OpenAI-compatible; Anthropic/Gemini need message-format + guided-JSON-via-tool-envelope adapters); secrets in `.env`/vault by name; **`LLM_EXTERNAL_EGRESS_ENABLED` fail-closed sovereignty gate**; new npm deps through blocking `scan:okf-server` + SBOM. Notes a future Python `core/llm_provider.py` (unify dataprep/retriever clients) as **out of scope** (gated, separate initiative).

### 4.4 Epics (`epics.md`) — add Epic 7 (executes after Epic 3)

**Epic 7: AI-Driven OKF Producer (Crawl → Draft)** — steward-gated drafts from crawled content; configurable model tier; automated hierarchy/labels. *FRs: FR-30, FR-31, FR-32. Depends: 2.2, 2.3, 2.5, 3.x. Co-develops: 4.2/4.3/4.4.*

- **Story 7.1: Multi-provider model client + config/secrets + sovereignty gate.** *Given* the OKF Server (Node, CPU-only), *when* configured, *then* `services/model-client/` resolves the tier from env (`OKF_PRODUCER_MODEL_PROVIDER` ∈ internal|openai|anthropic|xai|gemini), internal reuses the OpenAI-compatible vLLM client, frontier uses provider SDKs + vault-referenced API keys, **`LLM_EXTERNAL_EGRESS_ENABLED` fails closed at startup** if a frontier tier is selected without the gate, all new deps pass the blocking `scan:okf-server` + SBOM, and a Jest `createApp()` test covers provider resolution + the gate. *(FR-31; ADR-okf-020; NFR-S1, NFR-S5.)*
- **Story 7.2: Crawl→concept draft producer pipeline + post-crawl trigger.** *Given* a completed crawl (`{fileId}.md`) and a target repo, *when* the produce endpoint `POST /api/okf/repos/:repo_id/produce-from-crawl {file_id, model_tier}` is called (tools-admin) **or** the fire-and-forget post-crawl trigger fires (crawlWorker success block, reads `crawl_job.config.okf`, never breaks crawl success), *then* `producer-service.js` splits the flat dump on `## Source:` blocks, derives concept title/summary/frontmatter via the model client (emitting exactly `parser-service`-input format), stamps `generated.by`/`trust_tier=unverified`, runs Presidio (blocking) before staging, writes drafts to `okf_concepts_meta` at `status=review` (never publish) with audit rows, and a producer-job lifecycle (mirroring `crawl_job`) surfaces progress. *(FR-30; ADR-okf-019; FR-5, FR-9, FR-10.)*
- **Story 7.3: Automated knowledge-hierarchy + label assignment.** *Given* crawled content + the existing service-category taxonomy, *when* the producer runs, *then* it proposes categories/services/labels (staged `pending`, steward-approved via the **existing** service-category CRUD + `labelService` — no new API), stamps `t:/r:/d:` ACL labels into concept frontmatter/`file_labels`, reuses the `LABEL_SELECTOR` prompt semantics, and surfaces "consider adding to hierarchy" candidates. *(FR-32; downstream steering activates after 2.6 + Epic 1 — noted.)*
- **Story 7.4: Producer UI — wizard + model-tier selector + Generate Hierarchy/Auto-label + live progress.** *Given* `AdminDashboard.vue` (Options API), *when* an operator acts, *then* `OkfProducerWizard.vue` (clone of `AddFromLinkDialog.vue` — Teleport, DS primitives, SITE_PRESETS, crawl config) adds a domain picker (`serviceTreeService.getAdminCategories`) + model-tier selector (deployment default + per-repo override; **keys server-side only**), `okfProducerService.js` + Vuex `okf` module back it, a "Generate Hierarchy (AI)"/"Auto-label" action appears on the existing hierarchy tab, `OkfIngestionProgress` polls with `{silent:true}`, and all strings use `translate('okf.…','default')` across locales. *(FR-30/32; UX-DRs; project-context: Options API, `translate()` not `$t()`, httpService.)*
- **Story 7.5: Producer hardening — injection resistance, eval harness, cost controls.** *Given* the risk register (analysis §6), *when* hardening lands, *then* frontmatter/link fields are treated as untrusted (server-side override of trust + closed concept-ID link namespace) to resist **indirect prompt injection via crawled content**, a concept-quality **eval harness** (reference set + `steward rejection rate` guardrail, policing SM-C1/SM-7) exists, per-tenant/per-crawl quotas + trigger RBAC bound GPU/provider cost (incl. the agent-trigger scenario), and robots.txt/ToS + output-bundle `license` provenance are handled. *(NFR-S1/S5; FR-19 audit; analysis §6.1, §6.3, §6.7.)*

**Additions to existing epics:**
- **Story 2.6 scope add (additive, gated):** preserve ACL-prefixed `file_labels` (`t:/r:/d:`) into `chunk_labels` in `_finalize_chunk_labels` (today dropped — HIGH-severity ACL-correctness fix), and short-circuit the LLM label call when concept frontmatter already carries labels. *(genie-ai-overlay/dataprep/genieai_dataprep_arangodb.py:1051-1104.)*
- **FR coverage map:** FR-30/31/32 → Epic 7. **Build-order note:** Epic 7 after Epic 3; ungated except label→retrieval activation (2.6 + Epic 1).

### 4.5 sprint-status-okf-server.yaml — add (backlog, after epic-3)

```yaml
  epic-7: backlog            # AI-Driven OKF Producer (Crawl→Draft) — builds AFTER epic-3
  7-1-model-client-provider-tier-sovereignty-gate: backlog
  7-2-crawl-to-concept-draft-producer-pipeline: backlog   # depends 2-5
  7-3-automated-hierarchy-label-assignment: backlog
  7-4-producer-ui-wizard-modeltier-hierarchy-actions: backlog   # depends epic-3
  7-5-producer-hardening-injection-eval-cost: backlog
  epic-7-retrospective: optional
```
Plus annotate **2-6** with the ACL-preserve additive item.

### 4.6 GitLab sync (D-6)
- Create label **`okf-server::epic-7`** (scope `okf-server`, color matching epic-1..6).
- Create 5 story issues (7.1–7.5) labeled `type::story`, `status::backlog`, `prd::okf-server`, `okf-server::epic-7`, titles matching the sprint-status keys, descriptions = the AC above. (Drives via `glab api projects/:id/issues` against project 90; auth verified working.)
- Update the in-progress 2.3 issue with a dependency note (producer consumes its parser contract).

## 5. Implementation Handoff

- **Scope: Major** — PM/Architect sign-off at this gate, then **Developer** execution (Node + frontend first, ungated; gated Python 2.6 add + Epic 1 activation on the bump path).
- **Approval requested** before applying: PRD/Architecture/ADR/epics/sprint-status edits + GitLab mutations (issue creation is outward-facing/hard-to-reverse).
- **On approval:** apply §4.1–4.5 to the branch, then run the §4.6 GitLab sync, then offer to run `bmad-create-story` for 7.1 (the foundational model client) when the team is ready.
- **Success criteria:** Epic 7 artifacts consistent with PRD/ADRs; GitLab label + 5 issues created; sprint-status reflects new epic; no changes to in-progress Story 2.3 behavior.

## Appendix A — BMAD `correct-course` checklist status
- §1 Trigger/context: **Done** (D-1…D-6 + repo evidence). §2 Epic impact: **Done** (new Epic 7; 2.6 add). §3 Artifact conflicts: **Done** (PRD §5, ADR-001/010/016, NFR-S1 — all amended, none blocking). §4 Path forward: **Done** (Direct Adjustment). §5 Proposal components: **Done** (§4 above). §6 Final review/handoff: **Action-needed** — awaiting explicit approval (this gate); sprint-status + GitLab update deferred to post-approval per §6.4/§6.5.

## Appendix B — Decisions to confirm at approval
1. **Default model tier for the landing** = internal granite-4.1-8b (sovereignty-safe, recommended) vs frontier (better drafts, egress)?
2. **Producer segmentation policy** = one concept per crawled page (cheap, default) vs cluster-into-concepts (better, more LLM cost)?
3. **Frontier API keys** = deployment-wide server-side env (recommended) vs per-repo override by steward?
4. **Producer draft ingestion** = via the bundle route (2.5, one ClamAV scan, recommended) vs direct `okf_concepts_meta` write?
5. **Eval harness owner/timing** = part of 7.5 before any auto-publish relaxation (recommended)?

## 6. Applied (2026-08-12)

**Approved** ("Approve — apply everything"). Applied to `feat/okf-server` + GitLab. Recommended defaults used for the Appendix-B decisions (internal granite default tier, page-level segmentation, deployment-wide server-side keys, bundle-route ingestion, eval harness in 7.5).

**BMAD artifacts updated:**
- **PRD** — §5 non-goal amended (ADR-okf-019); §3 glossary (Producer / Model tier / Producer job); new §4.9 with **FR-30 / FR-31 / FR-32 / FR-33**; §6 scope; §7 (SM-7 + steward-rejection-rate guardrail); §10 dependency; §12; §13 (open questions 11–15).
- **Architecture** — §6 producer trigger stage; §8.1 `producer/` + `model-client/` modules; §8.2 bundle-route note; §8.6 model-tier env/secrets; §10 Author-lane built-in producer; §13 step 3.5.
- **New ADRs** — [okf-019](../../docs/adr/okf-019-ai-driven-okf-producer.md) (producer: Node placement, steward-gate, server-side trust cap, governance routing, non-goal amendment) and [okf-020](../../docs/adr/okf-020-configurable-inference-model-tier.md) (configurable model tier: internal vs frontier adapters, fail-closed sovereignty gate).
- **epics.md** — FR-coverage map (FR-30/31/32/33 → Epic 7); build-order note; Story 2.6 scope add (ACL-preserve correctness fix); **Epic 7 with stories 7.1–7.6**.
- **sprint-status-okf-server.yaml** — epic-7 block (7.1–7.6) + Story 2.6 annotation.

**GitLab updated (D-6):** label `okf-server::epic-7` created (id 376); 6 story issues created — **#910 (7.1), #911 (7.2), #912 (7.3), #913 (7.4), #914 (7.5), #915 (7.6)** — labeled `type::story` / `status::backlog` / `prd::okf-server` / `okf-server::epic-7`.

**Directives added during apply (folded into the artifacts above):**
- Producer UI **tightly integrated into the crawl features** (`AddFromLinkDialog` OKF target + `FileDetailsDialog` "Create OKF repository from this crawl") — FR-30 / Story 7.4.
- Producer **assembles → AI-adjusts → cross-links** drafts into the most structured bundle (FR-7, closed concept-ID namespace) — FR-30 consequence / Story 7.2.
- **All hierarchy/label edits are steward-vetted** — the producer never mutates the service-category taxonomy directly — FR-32 / Story 7.3.
- **Multi-URL crawl seeding** — new **FR-33 / Story 7.6**.
- **Configurable model tier** — internal granite OR frontier API (Anthropic/xAI/Gemini/OpenAI) — FR-31 / ADR-okf-020.

**Not touched:** Story 2.3 (GitLab #879) — owned by another context; it completed to `done` during this apply. Its role as the producer's frontmatter-contract dependency is recorded in epics.md and PRD §10.

**Next:** run `bmad-create-story` for **7.1** (foundational model client) when the team is ready; 7.2–7.6 follow per the dependency notes. No git commit was made by this course-correction (another context is actively working the branch) — the artifacts are left in the working tree for review/commit.
