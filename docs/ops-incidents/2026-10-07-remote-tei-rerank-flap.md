# Remote TEI Rerank Flap — 2026-10-07

**Status:** Endpoints healthy at time of writing (probes 1-3 above). The incident
itself is a transient model-server glitch on the shared TEI rerank endpoint
(separate from the langchain_arangodb / build-side code paths we own).

## What we saw

| Time (UTC) | Call | Wall (chatqna) | Rerank verdict | Grounded | Sources surfaced |
|---|---|---|---|---|---|
| 07:29:53 | T1 Alphabet corporate structure | 31.2s | **7** (healthy) | True | 4 OKF sources (governance/index/alphabet_inc/venture_capital_arms) |
| 07:30:45 | T2 follow-up share structure | 20.9s | **7** (healthy) | True | 4 OKF sources (governance/balance_sheet/alphabet_inc/index) |
| 07:31:41 | T3 financial table | 26.9s | **0** (all scores 0.0000-0.0001) | **False** | none — LLM abstained and produced general-knowledge table |

The three calls were made back-to-back (about 50s apart). T1 and T2 produced
healthy rerank scores (0.93-0.99). T3's reranker returned all 20 candidates at
near-zero score — sigmoid on logits near zero — so the adaptive selector
correctly selected `[]` and chatqna marked the response `is_grounded=False`.

## What was returned to the user

The default chatqna abstention prompt (`_DEFAULT_CHATQNA_ABSTENTION_INSTRUCTIONS`
in `genieai_chatqna.py`) explicitly invites a training-data fallback when
grounding fails:

> "You may still generate a response, but begin by clearly stating that you
> do not have sufficient information from verified source documents and
> that your response is based on general AI training data rather than the
> knowledge base."

That fallback is what produced the invented "Company/Subsidiary" table.
This is **documented expected behavior** when the rerank endpoint is sick —
but it's also a sharp UX failure that **the operator (or the model operator)
should be aware of**.

## Endpoints

- **Chatqna re-routing (this stack)** — verified working today: re-routes pure
  Alphabet query to `{alphabet + GRAPH}` only (was fanning out to 8 repos
  before Story 1.3 — calibration on local build at $TEMP/probe1.3.py showed
  `probed=8, qualified=['alphabet'], routed=2/9, wall=0.75-6.45s`).
- **Adaptive rerank selection (this stack)** — verified working: chunk
  embeddings attach 20/20, selected position count == 0 when the model
  returns garbage (the LLM is then told "no grounded content", per the
  default prompt above).
- **Remote TEI rerank endpoint** (`https://ai.assembly.govstack.global:444/rerank`)
  — **shared GPU node** with a known vLLM crash-loop history
  (see memory `remote-llm-endpoint.md`). Direct probes right now return
  on-topic score 0.72, off-topic -11.0 — endpoints alive. T3's failure
  was a transient ~60s window where the model returned near-zero outputs.

## What's broken vs. what's working

- ❌ The remote TEI rerank model returns degenerate outputs for at least
  one class of queries (financial-table-style long-context queries on
  2026-10-06 evening, and again on 2026-10-07 morning, both around
  alphabetically-similar contexts). Window of degradation is short
  (50-90s based on the 17:57 → next-call evidence from 2026-10-06).
- ✅ The local RAG pipeline correctly abstains on bad rerank output
  (verdict=0 → `is_grounded=False` → "I don't have this" path). The
  accuracy regression is the **default abstention prompt** that lets
  the LLM fill in with general knowledge anyway.

## Recommended actions (handoff to model operator)

1. **Re-image or restart the remote TEI rerank pod** — the vllm crash-loop
   history on `bb-ai-gpu-01` (10.0.0.110) suggests the model container is
   serving stale weights or hung sessions. A clean restart clears both.
2. **Add a probe** that hits `/rerank` with a known-good query pair every
   60s and alerts on score=0.0000 or score=-1.0 (sigmoid 0.5 = model
   has no opinion). The current behavior is silent from our side — the
   pipeline can't tell "model said irrelevant" from "model is broken."
3. **Tighten the default abstention prompt** to refuse training-data
   fallback for "financial table / numbers" queries. The current prompt
   is permissive; the right answer for a 0-verdict query is "I don't have
   this" with the source panel left empty — not an invented table.
4. **Consider pinning the rerank model version** in compose (not currently
   pinned — `TEI_RERANKING_IMAGE` defaults to `ghcr.io/...:1.9.3` but the
   GPU node may be running a different build). Stable pin would let us
   bisect vs. a known-good model.

## Local evidence

Captured at 2026-10-07 ~07:32 UTC from the live local build
(`C:\Dev\builds\main` @ eab46080):

- `docker logs main-reranker-1 --since 5m | grep ADAPTIVE`:
  - T1 + T2: healthy score distribution (0.9-0.99 visible in adjacent calls).
  - T3 at 07:31:33: all 20 candidates `score=0.0000-0.0001` followed by
    `[ADAPTIVE] Selected candidate positions: []` and `[ DEBUG ] Total number
    of documents in reranker output: 0`.
- `docker logs main-chatqna-xeon-backend-server-1`:
  - T3 shows `Grounding decision: is_grounded=False (reranker_present=True,
    rerank_verdict=0, retriever_docs=20)` and the route back to the BFF
    returns 200 with the AI-generated body in the response.
- Direct probe at 07:33 UTC (reranker container → remote):
  - 3/3 probes healthy (0.72 on-topic, -11.0 off-topic). Endpoint is
    alive; the T3 failure was a transient model glitch.

## Related (from previous session)

The 2026-10-06 evening T3 failure had the **same signature** (all scores
near-zero, 0 verdict, AI-generated body). Same root cause: shared GPU
node `bb-ai-gpu-01` returning degraded outputs for short windows.
Memory: `remote-llm-endpoint.md`.
