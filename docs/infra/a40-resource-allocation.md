# A40 host — GPU resource allocation

**Host:** `e2e-64-198` (164.52.196.198)
**GPU:** NVIDIA A40, 46 068 MiB total VRAM
**Last reviewed:** 2026-05-09

This document tracks who is allowed to use the A40 GPU and how much VRAM each workload owns. It is the **authoritative allocation table** — do not deploy a new GPU workload without updating it.

## Current allocation

| Slice | Workload | VRAM (MiB) | Status | Owner |
|---|---|---|---|---|
| 1 | (unallocated) | ~30 000 | Free | — |
| 2 | **Reserved — vLLM Llama-3.1-8B-Instruct fallback tier** | ~16 000 | **Reserved (not deployed)** | LLM platform |

**Total in use:** 0 MiB
**Reserved on paper:** ~16 000 MiB
**Genuinely free:** ~30 000 MiB

`nvidia-smi` snapshot 2026-05-09 19:06 UTC: `0 MiB / 46 068 MiB, utilisation 0 %`.

## Why slice 2 is reserved

The 16 GB earmarked for vLLM-Llama-3.1-8B is **not** to be consumed by any other workload until [ADR 0001](../architecture/adrs/0001-local-llm-deferred.md) is re-opened.

Rationale: ADR 0001 defers building the local LLM tier on the basis that the cloud chain (groq → gemini → base) is healthy, with a measurable revisit trigger via `amina_llm_chain_exhausted_total`. The day that trigger fires, the local tier needs to be deployable immediately — not after evicting another workload that grew into the headroom.

If a contributor proposes a new GPU workload that would push total reserved + active above ~30 GB, they must:

1. Re-open ADR 0001 in writing — argue why the local-LLM reservation can be released, OR
2. Document explicitly which other slice they are taking from, OR
3. Defer until ADR 0001 trigger conditions can be re-evaluated.

A "the GPU is idle, let's just add X" PR is not sufficient.

## Adding a new workload

When you genuinely need GPU time, update this table in the same commit that adds the docker-compose service. The PR must show:

- Steady-state VRAM (run the workload for ≥30 min, take `nvidia-smi --query-gpu=memory.used` peak)
- Whether it shares the GPU with other workloads via MIG or simple co-tenancy (A40 default is co-tenancy)
- An eviction plan if the LLM tier is later activated and needs its 16 GB

## Eviction order

If for any reason the GPU becomes contended (a workload OOM-loops, or a future high-priority workload arrives), evict in this order:

1. Anything not listed in this table (unauthorised — kill immediately).
2. Anything marked `Discretionary` in a future row.
3. Voice / image / embeddings models, if they migrate to GPU later.
4. The vLLM tier (only if active *and* cloud-chain health permits — this is the tier of last resort for chat).

## Future considerations

- Voice TTS/STT (`voice-tts`, `voice-stt`, `voice-tts-mnk`) are **CPU-only today**. If they migrate to GPU, they go into a new slice with their own VRAM line in this table.
- Reranker (`reranker_registry`) is CPU-only; same rule.
- The NLLB translator (`nllb-translate`) is CPU. Same rule.

## References

- [ADR 0001 — Defer local-GPU LLM tier](../architecture/adrs/0001-local-llm-deferred.md)
- [llm_provider_policy.py](../../haystack-stack/haystack-chatqna/src/services/llm_provider_policy.py) — chain-exhausted counter wiring
