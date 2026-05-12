# ADR 0001 — Defer local-GPU LLM tier; keep cloud chain as primary

**Status:** Accepted
**Date:** 2026-05-09
**Authors:** Hrithik (with input from architecture review)

## Context

AMINA Care today serves all chat traffic through a cloud-LLM fallback chain configured by `LLM_FALLBACK_CHAIN` (default `groq, gemini, base`). On the A40 host we have an idle NVIDIA A40 with ~46 GB free VRAM. The natural question is whether to add a local vLLM tier (Llama-3.1-8B-Instruct, ~16 GB VRAM) as a fourth fallback or as the primary path.

After fixing the streaming bug ([components/frontend/src/router/pages/ChatPage.jsx](../../../components/frontend/src/router/pages/ChatPage.jsx) was hitting `/api/v1/agent/chat` instead of `/api/v1/agent/chat-stream`), measured time-to-first-token through the prod tunnel is ~196 ms median. The pre-fix UX (1.5–4 s of blank screen) was the actual user complaint, not LLM compute time.

Three motivations exist for adding a local tier:

1. **Latency** — already addressed by streaming. No further gain that users will notice.
2. **Resilience** — protection when the cloud chain (groq → gemini → base) is fully unavailable. Today we have no measurement of how often this happens; the assumption "rarely" is unverified.
3. **Data sovereignty** — Gambian healthcare data in cloud LLM prompts. Currently mitigated by API-level scrubbing and the `JAILBREAK_PROTECTION_REPORT.md` controls. Compliance reviewers (UNICC, internal) have not raised this in writing as of 2026-05-09.

Building local-vLLM costs ~1 day of work plus ongoing surface area (compose service, watchdog rule, model upgrades, GPU monitoring). Removing it after deployment is materially more expensive: dashboards, alerts, runbooks, and the watchdog all start depending on it. Therefore we apply a reversibility bias.

## Decision

**Defer** building the local-vLLM tier. Keep `LLM_FALLBACK_CHAIN=groq,gemini,base` as the production chain.

Instead, do the three things that gate the future build on evidence:

1. **This ADR** — pin the decision and revisit triggers so the conversation does not get relitigated every two months.
2. **Instrument the trigger** — `amina_llm_chain_exhausted_total` Prometheus counter at the point in [llm_provider_policy.py](../../../haystack-stack/haystack-chatqna/src/services/llm_provider_policy.py) where every provider in the chain has failed. Labels: `last_tier`, `failure_reason`, `request_kind`. Exposed at `/metrics`.
3. **Reserve VRAM on paper** — see [a40-resource-allocation.md](../../infra/a40-resource-allocation.md). 16 GB of A40 VRAM is earmarked for vLLM-Llama-3.1-8B and must not be silently consumed by a different workload (image gen, voice models, embeddings cache, etc.) without first re-opening this ADR.

## Revisit triggers

Build the local tier the moment **any** of the following is true:

- `amina_llm_chain_exhausted_total` shows a sustained chain-exhaustion rate exceeding **0.5 % of all chat requests over a rolling 7-day window**. (Quiet alert; on-call paged only above 1 %.)
- Any procurement or compliance reviewer (UNICC, MoH Gambia, internal counsel, or a partner) asks **in writing** "does patient data leave the region during inference?" or an equivalent. Verbal questions don't count.
- A new data class enters scope where on-prem inference is a **stated requirement** in the data-handling agreement (not a preference). Examples: minor patients without parental consent for cloud processing, named-patient longitudinal records, regulated trial data.
- `LLM_FALLBACK_CHAIN` policy changes such that a single non-cloud provider would route **>5 %** of traffic by design (e.g. a region-locked patient cohort).

Triggers are **measurable**, not aspirational. If the counter stays near zero and no reviewer puts the question in writing, this ADR remains in force indefinitely.

## Consequences

**Positive**
- Zero new operational surface area today. The watchdog, backup script, and compose stack stay simple.
- The decision is evidence-driven going forward: the counter answers "do we need this yet?" without anyone having to argue.
- VRAM is reserved on paper, so a future "let's add image generation on the idle GPU" proposal must explicitly re-open this ADR.

**Negative**
- We cannot answer "yes, inference happens on-prem" today. If a reviewer asks tomorrow, we have ~1 day of build work between question and answer. Mitigation: the counter and reserved VRAM mean we can begin immediately when the trigger fires.
- If groq/gemini both have a coordinated multi-hour outage before the counter alert fires, all chat traffic falls to the canned `safe_template_response()` text. Users will see "I am not able to answer this safely right now…" and a hotline number. This is the intended failure mode (clinical-safety-first) but is worth flagging.

**Neutral**
- ~16 GB VRAM remains idle. The A40 was sunk-cost from the existing host plan, so this is not a new cost — just an unrealised utilisation.

## How to revisit

1. Confirm trigger fired (counter value, written request, or new data class).
2. Re-open this ADR; supersede with `0002-local-llm-build-plan.md` describing the exact compose service, model selection, and rollout order.
3. Build (~1 day). Order: compose service → smoke test → add to `LLM_FALLBACK_CHAIN` as last tier, never primary → wire watchdog → update [a40-resource-allocation.md](../../infra/a40-resource-allocation.md) to mark VRAM as in-use.
4. Smoke condition before flipping live: forced-failure of all cloud tiers must reach the local tier and return a clinically reasonable response within 5 s.

## References

- [llm_provider_policy.py](../../../haystack-stack/haystack-chatqna/src/services/llm_provider_policy.py) — fallback chain implementation
- [a40-resource-allocation.md](../../infra/a40-resource-allocation.md) — VRAM reservation
- Prior conversation 2026-05-09 (streaming TTFT diagnosis) — established that latency is not a motivating factor
