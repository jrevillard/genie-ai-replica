# AMINA LoRA — vLLM Context Window Bump

**Date:** 2026-04-14
**Phase:** A — LoRA context doubling (4K → 8K)
**Target host:** A40 vLLM server (Tailscale: `amina-a40.tail0da632.ts.net`)

---

## 1. What changed

AMINA LoRA's effective context window is being raised from **4,096 → 8,192 tokens** in vLLM. This matches the client-side bump in `amina_agent.py`:

| Setting | Old | New |
|---------|-----:|-----:|
| vLLM `--max-model-len` | 4096 | **8192** |
| Agent `_char_budget` (amina) | 12,000 | **20,000** |
| Agent `_max_history_turns` (amina) | 4 | **6** |
| Agent `_max_tok` (amina) | 300 | **400** |
| Per-message char cap in LoRA history | 350 | **500** |

The client-side bumps are deployed. This document is the A40-side step.

---

## 2. Why 8K, not more

AMINA LoRA was trained on **2,048 tokens** and served at 4,096 via RoPE extrapolation. Going to 8,192 is the last safe stop — it's 2× the served length and 4× the trained length, where quality starts to noticeably degrade.

Beyond 8K we'd need YaRN RoPE scaling and clinical quality evals. The context compactor ([src/services/context_compactor.py](../haystack-stack/haystack-chatqna/src/services/context_compactor.py)) makes 8K effectively infinite by compressing older turns automatically — so there's no operational reason to go further.

---

## 3. How to apply on the A40

### 3.1 SSH to the A40

```bash
ssh amina-a40
```

### 3.2 Edit the vLLM serve script

Typical location: `~/amina/deploy/run_vllm.sh` or similar. Find the `vllm serve` line:

```bash
# BEFORE
python -m vllm.entrypoints.openai.api_server \
    --model models/amina-v2-final \
    --max-model-len 4096 \
    --gpu-memory-utilization 0.90 \
    --dtype bfloat16 \
    --host 0.0.0.0 \
    --port 8000
```

Change `--max-model-len 4096` → `--max-model-len 8192`:

```bash
# AFTER
python -m vllm.entrypoints.openai.api_server \
    --model models/amina-v2-final \
    --max-model-len 8192 \
    --gpu-memory-utilization 0.90 \
    --dtype bfloat16 \
    --host 0.0.0.0 \
    --port 8000
```

### 3.3 Check VRAM headroom before restarting

Doubling max-model-len doubles the KV-cache memory per request. For Mistral-7B at bf16:

- 4K context: ~14.5 GB base + ~2 GB KV cache per request
- 8K context: ~14.5 GB base + ~4 GB KV cache per request
- A40 total: 46 GB — plenty of headroom for ~8 concurrent 8K requests

Run:
```bash
nvidia-smi
```

Confirm free VRAM is above **20 GB** before restart.

### 3.4 Restart vLLM

```bash
# If running under systemd:
sudo systemctl restart amina-vllm

# If running under tmux / screen:
# Kill the old process, re-run the serve script
```

### 3.5 Verify

```bash
curl https://amina-a40.tail0da632.ts.net/v1/models
```

Should return the model list. Then from the AMINA backend container:

```bash
docker exec haystack-chatqna python3 -c "
import asyncio
from openai import AsyncOpenAI
from src.config import settings

async def t():
    c = AsyncOpenAI(api_key='x', base_url=settings.AMINA_MODEL_URL)
    r = await c.chat.completions.create(
        model=settings.AMINA_MODEL_NAME,
        messages=[{'role':'user','content':'Salaam. How do I manage my blood pressure during Ramadan?'}],
        max_tokens=200,
    )
    print(r.choices[0].message.content)
asyncio.run(t())
"
```

If you get a clinical response, the bump is live.

---

## 4. Rollback

If 8K degrades LoRA quality in real conversations, revert `--max-model-len` to `4096`, restart vLLM, and update [src/agent/amina_agent.py:_MODEL_BUDGETS](../haystack-stack/haystack-chatqna/src/agent/amina_agent.py) to put amina back at `(12_000, 300, 4)`.

The context compactor is independent of this bump and will continue to work correctly at 4K — it just triggers more often.

---

## 5. What's next

- **Phase B (deployed):** `context_compactor.py` auto-compresses older turns via Gemini 2.5 Flash Lite. Effectively unlimited conversation length at the 8K window.
- **Phase C (future):** YaRN RoPE scaling + retraining on longer contexts if real patient conversations consistently need >8K.

---

*AMINA Care Programme · Ministry of Health, Republic of The Gambia*
