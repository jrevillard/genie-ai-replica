# AMINA LoRA — Token Limits & Context Window

## The Hard Limit

The AMINA v2 LoRA model is served by vLLM with a **2048-token maximum context window per request**.

This is a per-API-call limit — not per session. Every request must satisfy:

```
input tokens + output tokens ≤ 2048
```

---

## Why 2048?

Set in `training/finetune_lora_v2.py`:

```python
MAX_SEQ_LEN = 2048
```

Two reasons:

1. **VRAM during training** — attention memory scales quadratically with sequence length. Training on the A40 (46 GB) with `batch_size=4` at 2048 tokens was already near the limit. Doubling to 4096 would have required dropping batch size to 1–2, making training ~3× slower.

2. **Training data length** — the WHO/CHW conversation pairs used for fine-tuning were short by nature (patient question + CHW response). Sequences rarely exceeded 1000 tokens, so 2048 gave comfortable headroom without needing to go higher.

Note: the underlying base model (Mistral/Llama) supports 4096+ tokens. The 2048 limit is a **fine-tuning choice**, not a model architecture constraint.

---

## What Crashed and Why

### The Error

```
Error code: 400 - This model's maximum context length is 2048 tokens.
However, you requested 250 output tokens and your prompt contains
at least 1799 input tokens, for a total of at least 2049 tokens.
```

One token over the limit.

### Why the Input Was 1799 Tokens

The agent was sending the full production prompt stack to the AMINA model, designed for GPT-4o / Gemini (which have 128k+ context windows):

| Component | Tokens |
|---|---|
| `AMINA_SYSTEM_PROMPT` (full) | ~1,100 |
| `response_prompt` (patient ctx + RAG + instructions) | ~500–800 |
| Conversation history (6 msgs × 300 chars) | ~150–300 |
| **Total input** | **~1,800–2,200** |
| Output budget requested | 250 |
| **Grand total** | **~2,050–2,450** — over limit |

The AMINA LoRA model never needed this large a prompt — the WHO/CHW knowledge is **baked into the weights** from fine-tuning. The long prompt was scaffolding designed to teach GPT-4o how to behave like a Gambian CHW. The LoRA already knows.

---

## The Fix — Dynamic Token Budget

Instead of hard-coding trimmed lengths, the agent now calculates available budget dynamically based on the actual message length.

### Budget Allocation

```
Total limit:     2048 tokens
Output reserve:   220 tokens
Input budget:    1828 tokens  ≈  6,000 characters (at ~3.3 chars/token)
```

**Fixed components (always included):**
- Compact system prompt: ~85 tokens / ~300 chars
- User message: variable
- Template boilerplate: ~15 tokens / ~60 chars

**Flex budget** (what remains after fixed components) is split:

| Slot | Share | Purpose |
|---|---|---|
| Patient history | 40% | Personalisation from ArcadeDB memory |
| RAG evidence | 40% | WHO guideline chunks from knowledge base |
| Conversation history | 20% | Last 4 turns, strict alternation enforced |

### Effect by Message Length

| Message length | Patient history budget | RAG budget | History budget |
|---|---|---|---|
| Short (~50 chars) | ~2,376 chars | ~2,376 chars | ~1,188 chars |
| Medium (~300 chars) | ~2,256 chars | ~2,256 chars | ~1,128 chars |
| Long (~800 chars) | ~2,056 chars | ~2,056 chars | ~1,028 chars |

Longer messages automatically shrink the optional context. Short messages get more patient history and RAG detail.

### Compact System Prompt (AMINA model only)

```
You are AMINA, a Gambian community health worker (CHW) with 10 years experience.
Give warm, practical advice in simple English using WHO guidelines and Gambian context
(CHW, health posts, local foods like benachin/domoda, emergency number 199).
Be concise — 3-6 sentences. Never prescribe medication.
End with a specific question or next action.
```

~85 tokens vs the original ~1,100 token system prompt. The LoRA model does not need the detailed instructions — it learned the persona and clinical constraints from training data.

### Alternating Roles Fix

vLLM enforces strict `user → assistant → user → assistant` message alternation. The agent now filters conversation history to skip any consecutive messages with the same role before sending to the AMINA endpoint.

---

## The Other Models Are Unaffected

| Model | Context window | Prompt strategy |
|---|---|---|
| AMINA LoRA (vLLM) | 2048 tokens | Dynamic compact prompt (this doc) |
| Gemini 2.0 Flash | 1,000,000 tokens | Full `response_prompt` + `AMINA_SYSTEM_PROMPT` |
| GPT-4o mini | 128,000 tokens | Full `response_prompt` + `AMINA_SYSTEM_PROMPT` |

---

## How to Increase the Limit (Without Retraining)

The base model supports longer contexts. You can re-serve vLLM with a higher limit:

On the server, edit `/etc/systemd/system/amina-model.service`:

```ini
ExecStart=/path/to/vllm serve models/amina-v2-final \
    --max-model-len 4096 \
    ...
```

Then:

```bash
sudo systemctl daemon-reload
sudo systemctl restart amina-model
```

This gives an input budget of ~3,876 tokens — enough to use larger portions of the full system prompt and more conversation history.

**Caveat:** Test for quality regression. The LoRA was trained at 2048. Inference at 4096 uses positional encodings beyond what was seen during training, which may cause minor quality degradation on very long inputs. Short-to-medium conversations (under 2048 tokens total) are unaffected.

---

## Summary

- 2048 token limit is **per request**, set at fine-tuning time for VRAM reasons
- The crash was caused by sending GPT-4o-sized prompts to a 2048-token model
- Fixed with a dynamic budget that auto-scales context to fit within the limit
- The LoRA doesn't need large prompts — the knowledge is in the weights
- Limit can be raised to 4096 server-side without retraining if needed


--Update--

vLLM is now running with --max-model-len 4096.

On performance impact — minimal for your use case:

Latency: unchanged for short/medium messages. vLLM only allocates KV cache for the actual tokens in each request, not the full 4096 every time
VRAM: slightly more reserved for KV cache pool (~+2–3 GB on the A40), but at 46GB you have plenty of headroom
Quality: no degradation for conversations under 2048 tokens (the LoRA was trained at 2048, so within that range it behaves identically). Beyond 2048 tokens you may see slight quality drift but it's rare in normal chat


Updating to 8100 is possible but requres more vram memory
