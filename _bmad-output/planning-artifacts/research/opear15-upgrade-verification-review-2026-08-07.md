# Review — OPEA 1.3 → 1.5 Upgrade Plan (Pillar 1 of the Agentic Enablement briefing)

**Date:** 2026-08-07
**Scope:** Verification of the OPEA 1.3 → 1.5 upgrade analysis in
`_bmad-output/planning-artifacts/team-briefing-agentic-enablement.md` (Pillar 1), plus the
`deferred-work.md` v1.3→v1.4 retirement checklist it relies on.
**Method:** claims cross-checked against (a) the code on `feat/agentic-enablement` (worktree at
`0eeba0fb`), and (b) the OPEA upstream repos `opea-project/GenAIComps` and `opea-project/GenAIExamples`
at tags `v1.3` / `v1.5` (raw file fetches + release page).
**Result:** The briefing is **substantively accurate**. The strategy (overlay rebase, not re-write;
preserve the Genie-owned RAG modules; verify the coupling surfaces) is sound and the current-state
inventory is nearly all correct. **Six factual errors and four material gaps** were found. None
invalidate the plan; several change the rebase work list and one downgrades a ranked risk.

---

## 1. Verified correct (high-value claims)

| Claim | Verdict |
|---|---|
| OPEA v1.3 tag = 2025-05-14 | ✅ (release page) |
| OPEA v1.5 = latest stable, released 2025-12-22 | ✅ — **still the latest as of 2026-08-07**; no v1.6/v1.7 exists (release page, "Latest" badge) |
| langchain 0.3.23 → 0.3.27 | ✅ (`comps/dataprep/src/requirements-cpu.txt` @v1.5 pins `langchain==0.3.27`) |
| langgraph 0.3.31 → 1.0.1 | ✅ (`comps/agent/src/requirements.txt` @v1.5 pins `langgraph==1.0.1`) |
| docling-core==2.44.2 in v1.5 | ✅ (exact; also matches deferred-work) |
| v1.4+ dataprep `requirements.txt` → `requirements-cpu.txt` | ✅ (v1.5 dir ships only `.in` / `-cpu` / `-gpu`, no `requirements.txt`) |
| Agent microservice w/ strategies `react_langgraph`, `react_llama`, `rag_agent`, `plan_execute`, `sql_agent` | ✅ (`comps/agent/src`, v1.5; also `react_langchain`, `rag_agent_llama`, `sql_agent_llama`) |
| `OpeaMCPToolsManager` (SSE + stdio) | ✅ (`comps/cores/mcp/manager.py`, v1.5; `OpeaMCPSSEServerConfig` / `OpeaMCPStdioServerConfig`) |
| YAML tool registry (endpoint / python fn / langchain tool) | ✅ (`custom_tools.yaml` in agent README, v1.5) |
| ArangoDB first-class retriever + dataprep in v1.5 | ✅ (`comps/retrievers/src/integrations/arangodb.py`, `comps/dataprep/src/integrations/arangodb.py`) |
| `enable_mcp` opt-in mechanism exists on `MicroService` / `register_microservice` | ✅ (v1.5 `micro_service.py`) |
| `register_microservice` + global `opea_microservices["opea_service@*"]` dict persist | ✅ (v1.5 `micro_service.py`) |
| `ServiceOrchestrator.align_inputs/outputs/generator` monkeypatch target still exists | ✅ — signatures became `(self, inputs, *args, **kwargs)`-style but GENIE's positional override is compatible (see §3-G6) |
| **All code-review file:line claims** — chatqna ~2,560 lines (2,561 actual), monkeypatch @1240, runtime graph mutation @1043-1044, `schedule()` 8-kwargs, dataprep `_parent_mod.ARANGO_DB_NAME` @39, retriever `graph_name` env-fallback, dataprep `graph_name` @1287, 4 Dockerfiles pinned `OPEA_VERSION="v1.3"`, embedding/textgen extend `opea/*:latest`, tests mock `comps` wholesale (`conftest.py` `sys.modules`), deferred-work L395-411, `docarray.py`→`opea_docarray.py` rename hack, `fix_dependencies.sh` shared by retriever+reranker, `opea_service@retrievers`/`opea_service@dataprep` wrapper keys, `import opea_dataprep_microservice as base`, 5 `flow_to` variants (`add_remote_service*`), `GenieaiRetrieverParms` has no `graph_name`, `align_inputs` RETRIEVER branch never sets `graph_name`, GenAIExamples ChatQnA@v1.3 dep | ✅ all confirmed against the branch tree |
| "GENIE has written zero LangGraph code" | ✅ — no `langgraph` anywhere in the overlay (sources, `.in`, lock) |

**Net:** the two pillars of the plan — "current overlay state" and "what OPEA 1.5 actually ships" — hold up.
This is a trustworthy analysis. The corrections below are refinements, not rebuilds.

---

## 2. Factual corrections (argued)

### C1. ❌ "Python stays 3.10" — OPEA 1.5 is **Python 3.11**
The briefing's dependency list asserts *"Python stays 3.10."* Upstream disagrees:

- v1.5 dataprep `Dockerfile` base is **`python:3.11-slim`**; its `requirements-cpu.txt` is compiled with
  `uv pip compile --python=/usr/local/bin/python3.11 …`.
- GENIE's current bases are **mixed**: retriever/chatqna/dataprep on `python:3.10-slim` (dataprep even
  installs `python3.10` + `update-alternatives`), reranker and the embedding wrapper already on 3.11.

**Consequence for the rebase:** the 3.10 images must move to 3.11. Concrete, currently-missed items:
- `sitecustomize.py` SSL-bypass patch paths in the chatqna + dataprep Dockerfiles target
  `/usr/local/lib/python3.10/site-packages` → must become `python3.11`.
- The dataprep `update-alternatives` python3.10 machinery becomes dead/conflicting.
- Recompiled/C-extension pins in the dataprep `requirements.lock` must be re-pinned for 3.11.

### C2. ❌ Reranker risk is *not* driven by an `opea_telemetry` rename — the module survives in v1.5
Blast-radius rank #4 says reranker is "sole consumer of `comps.cores.telemetry.opea_telemetry`
(**renamed in v1.4**)." Verified: **`comps/cores/telemetry/opea_telemetry.py` still exists at that exact
path in v1.5**, exporting the same `opea_telemetry` decorator factory. The v1.3→v1.5 diff at that path is
not the source of reranker risk. **Downgrade** this sub-claim; reranker's real 1.5 surface is the
`@register_microservice` params (compatible — verified) and `ServiceType.RERANK` (present — verified).

### C3. ❌ The "dependency bumps that come with 1.5" are partly moot for GENIE — the deployment is already beyond them
The briefing lists vLLM 0.8.3 → 0.10.x and TEI 1.6 → 1.7 as bumps *coming with 1.5*. The deployment
(`docker-compose.yaml`) already runs **`vllm/vllm-openai:v0.10.0`** (translation) and
**`text-embeddings-inference:1.9.3`** (embedding + rerank) — i.e. at/above 1.5's pins. Worse, the main
chat `vllm` service is on **`vllm/vllm-openai:latest` (unpinned)**. The vLLM/TEI/Docker portion of the 1.5
bump is not gated on OPEA and should be de-scoped from the "1.5 brings" narrative; pinning the `:latest`
vLLM tag is work that should happen regardless of the upgrade.

### C4. ⚠️ "OPEA ships quarterly; v1.6 is due Q1 2026" — did not happen
No v1.6 (or v1.7) exists as of 2026-08-07; v1.5 has been "Latest" for 7.5 months. This makes 1.5 the
*right* target (it *is* the latest), so the premise survives — but the plan should (a) not assume a fresh
1.6 soon, and (b) re-check the release page immediately before starting the rebase, since 1.6 landing
mid-overlay-rebase is the one event that could invalidate the work.

### C5. ⚠️ mcp pin: 1.25.0 claimed, **1.24.0** actual
v1.5 agent `requirements.txt` pins `mcp==1.24.0`. Patch-level, no strategy impact (mcp is genuinely *new*
in 1.5 — the briefing's "mcp → … (new)" point stands).

### C6. ❌ MicroService count: **20**, not "17 nodes" nor "21 constructions"
The briefing asserts "17 `MicroService(...)` nodes" (Pillar 1 §overlay) and "21 `MicroService(...)`
constructions" (code-review findings). Actual: **20** in `genieai_chatqna.py` (5× the 4-service builders
`add_remote_service*` = 19 … precisely: 4+3+4+4+4 node constructions + 1 `self.service` = 20). Both
counts are off. Cosmetic, but the doc cites exact numbers as evidence of precision.

### C7. ⚠️ flow_to "3 byte-identical variants" — there are **4**
`add_remote_service`, `add_remote_service_faqgen`, `add_remote_service_without_translation`,
`add_remote_service_genieai` all carry the identical 3-edge block `embedding→retriever→rerank→llm`;
only `add_remote_service_without_rerank` differs (2 edges). So 4, not 3.

### C8. ❌ dataprep "3 OPEA base-class subclasses" — there is **1**
`genieai_dataprep_arangodb.py` defines a single subclass: `class GenieArangoDataprep(OpeaArangoDataprep)`.
If "3" was meant across dataprep+retriever+reranker, say so; as written (under "dataprep") it is wrong.

### C9. ⚠️ retriever "11-symbol comps import" — **12**
`genieai_retriever_microservice.py:39` `from comps import (…)` carries 12 symbols (CustomLogger,
EmbedDoc, EmbedMultimodalDoc, OpeaComponentLoader, SearchedDoc, SearchedMultimodalDoc, ServiceType,
TextDoc, opea_microservices, register_microservice, register_statistics, statistics_dict). Off by one;
irrelevant to the coupling argument (which stands).

### C10. ⚠️ Assistants API is **react_llama-only** — not a vLLM-serving surface
The briefing maps "OpenAI-compatible `/v1/chat/completions` + Assistants API (`/v1/assistants`,
`/v1/threads`, Redis-backed memory, multi-turn via `thread_id`)" onto "Agent serving surface +
pause/resume (#603 1E)." Verified: the Assistants endpoints exist, **but the agent README states only
`react_llama` supports them**, and `react_llama` is the llama.cpp strategy — not vLLM. GENIE serves via
vLLM. So "adopt OPEA's native agent for multi-turn/pause-resume serving" is **not** free on the existing
stack; the viable strategy is `react_langchain`/`react_langgraph` over OpenAI-compatible chat completions
(which vLLM serves), and pause/resume-via-threads is out unless a llama.cpp backend is added. This
materially qualifies the #603 Phase-1 "adopt, don't build" claim.

### C11. ⚠️ constants.py fork is a *hard* rebase item with a numbering gotcha (briefing ranks it only MEDIUM #5)
`core/constants.py` (overlay fork of `comps/cores/mega/constants.py`) appends `TRANSLATOR = 24`. v1.5's
upstream enum has **no** TRANSLATOR — its slot 24 is `LANGUAGE_DETECTION` (then PROMPT_TEMPLATE,
PROMPT_REGISTRY, TEXT2QUERY, ARB_POST_HEARING_ASSISTANT). On rebase the fork must be **regenerated from
v1.5's enum wholesale, with `TRANSLATOR` re-appended at the end** (value 29) — not patched in-place. Any
v1.5 core module referencing a new member (e.g. `ServiceType.PROMPT_REGISTRY` from the prompt-registry
microservice) would `AttributeError` against a stale fork. That is a hard break, not drift: recommend
elevating this in the work list.

---

## 3. Gaps the briefing missed

### G1. `langchain-arangodb` (0.0.4) is a coupling surface, and it is absent from the "six surfaces"
The retriever's vector path is `langchain_arangodb.ArangoVector` (`genieai_retriever_arangodb.py:15,919`);
dataprep pins `langchain-arangodb==0.0.4`. OPEA 1.5 moves `langchain`/`langchain-core` (dataprep
`langchain-core==0.3.74`; agent tree 0.3.80). `langchain-arangodb` 0.0.4 predates this and already has a
known label-filter defect (the El Salvador finding). The retriever's real 1.5 risk may be here — *before*
`OpeaComponent` — because a `langchain-arangodb` that doesn't support the new `langchain-core` breaks the
whole vector path at import/instantiation. **Add as coupling surface #7**, with a pin-bump check.

### G2. langgraph 1.0.1 will be *installed*, not just "available to adopt"
The briefing treats langgraph 0.3→1.0 as a non-issue because GENIE writes no LangGraph code. Correct for
direct imports — but v1.5's comps tree (agent comps, and anything `pip install -e .`'d, as the chatqna
Dockerfile does) **pulls `langgraph==1.0.1` as a dependency**. The overlay images will therefore contain
it, and any v1.5 module that imports a langgraph-using path at import-time is a latent 0.3→1.0 break.
Verify, per image, that no module imported by chatqna/dataprep/retriever/reranker reaches langgraph at
import time. Cheap check; should be part of the 6-surface verification.

### G3. Python 3.10 → 3.11 path touches (see C1)
sitecustomize patch paths (`python3.10` → `python3.11`) in chatqna + dataprep Dockerfiles; dataprep
`update-alternatives` removal; recompiled pins.

### G4. `schedule()` kwargs-forwarding is the make-or-break detail of the #1 coupling
Verified v1.5 signature: `async def schedule(self, initial_inputs, llm_parameters=LLMParams(), **kwargs)`.
GENIE calls it with **6 extra named kwargs** (`retriever_parameters`, `reranker_parameters`,
`full_chat_history_string`, `retrieval_context`, `original_language`, `user_details`). These now ride in
`**kwargs` and survive only if v1.5's `execute()` forwards arbitrary kwargs into the `align_*` hooks.
If v1.5 filters/renames them, retriever/reranker/translation configuration is **silently dropped** — the
exact failure class the briefing warns about, and the monkeypatch won't catch it because the patch itself
(align_* positional override) is signature-compatible (verified). **Pre-rebase check:** diff
v1.3→v1.5 `execute()` kwargs forwarding. This should be the first item on the 6-surface list, not just
"verify align_*".

### G5. The dataprep lock machinery removal (deferred-work) is correct but under-stated as sequencing risk
Confirmed the v1.5 file layout (only `.in`/`-cpu`/`-gpu`). The removal list in deferred-work L395-411 is
accurate. Only note: the `--require-hashes` + `--no-deps` Dockerfile block is what currently makes
dataprep builds deterministic; the 1.5 migration to OPEA's compiled `requirements-cpu.txt` **must keep
`--require-hashes`** (or equivalent) — the briefing lists it, but it's worth making explicit in the
rebase task, not a cleanup aside.

---

## 4. Soundness assessment

1. **The overlay-rebase strategy is the right call.** GENIE's retriever/reranker/dataprep are almost
   entirely Genie-owned code with thin OPEA adapter contracts; re-base-not-re-write preserves the RAG
   investment. Confirmed by the actual code shape (OpeaComponent subclasses + wrappers, not deep comps
   forks).
2. **The blast-radius ranking is broadly right**, with corrections: reranker #4 is *lower* risk than
   stated (C2); constants.py #5 is *higher* (C11); the missed langchain-arangodb surface is *higher*
   than anything below #2.
3. **Sequencing (pre-rebase cleanup → bump → 6-surface verify → smoke tests) is sound.** The pre-rebase
   cleanup items (flow_to consolidation, `_parent_mod.ARANGO_DB_NAME` subclass override) are well-chosen:
   both are real (verified). The `#603`/`#604` deferral to "after 1.5" is consistent with the verified
   state.
4. **The "tests won't catch 1.5 breaks" claim is the single most important observation** and it is
   exactly right — `conftest.py` stubs `comps` at `sys.modules` level, so every overlay test runs against
   mocks and cannot detect any 1.5 API change. The smoke-test addition (import-only, one per module) is
   the highest-value risk reduction in the plan. Do it **before** the bump, not after.

---

## 5. Recommended additions to the rebase work list

1. Python 3.11 migration sub-task (C1/G3): base images, sitecustomize paths, `update-alternatives`,
   recompiled pins.
2. Pin the chat `vllm` image (currently `:latest`) — independent of OPEA (C3).
3. Add `langchain-arangodb` compatibility to the coupling-surface check (G1).
4. Add langgraph-import-time sweep per image (G2).
5. Add v1.3→v1.5 `execute()` kwargs-forwarding diff as the #1 pre-rebase check (G4).
6. Regenerate `constants.py` fork from v1.5 + re-append `TRANSLATOR` (C11).
7. Re-check the OPEA release page before starting (C4) — confirm no v1.6.
8. Decide the native-agent strategy on vLLM (`react_langchain`/`react_langgraph`, not the
   react_llama-only Assistants surface) before committing #603 scope (C10).

---

## 6. Pending verification (delegated, not yet returned)

- Exact adoption scope of `enable_mcp` (briefing: only ChatHistory / PromptRegistry / FeedbackManagement;
  "verified, 0 MCP refs" in retriever/dataprep/reranker/chatqna) — repo-wide grep on v1.5 pending.
- OPEAStore DB-agnostic decoupling (v1.4 release notes) — pending.
- vLLM/TEI exact pins inside the v1.5 GenAIExamples ChatQnA compose — moot for GENIE per C3, but listed
  for completeness.

These three do not change any conclusion above; they refine the OKF/SST pillar mapping, not the upgrade
mechanics.
