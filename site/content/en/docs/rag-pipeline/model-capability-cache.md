---
title: Model Capability Cache
description: TTL-cached auto-detection of the model served by a remote vLLM endpoint — how the cache works, the MODEL_DETECT_TTL knob, and how services pick up model swaps without a restart.
weight: 13
mode: explanation
audience: developer, operator
last_reviewed: 2026-09-18
persona: developer
owner: "docs-stewards"
---

> **For backend developers and operators.** The
> `genie-ai-overlay/core/model_cache.py` module probes a remote vLLM
> endpoint's `/v1/models` route, caches the result for `MODEL_DETECT_TTL`
> seconds (default 60), and serves the cached value on subsequent calls.
> On expiry the endpoint is re-probed; on probe failure the last known
> value is returned. This lets services pick up model changes on the
> GPU node without a restart.

This page documents the cache contract, the env var, the failure modes,
and how to clear the cache for testing.

## Prerequisites

- A vLLM endpoint reachable from the OPEA service (default
  `http://<GPU_NODE_HOST>:8000/v1`).
- `VLLM_API_KEY` set (the cache sends `Authorization: Bearer $VLLM_API_KEY`
  if non-empty).
- Python 3.9+ for the module's `dict[str, dict]` syntax (PEP 585); the rest of the OPEA overlay requires Python 3.11+.
- Read access to
  [`genie-ai-overlay/core/model_cache.py`](https://gitlab.com/un/itu/genie-ai/-/blob/main/genie-ai-overlay/core/model_cache.py).

## Why the cache exists

The remote-GPU deployment pattern runs vLLM on a separate node
(`GPU_NODE_HOST`); the OPEA services run on CPU nodes and need to know
**which model the GPU is currently serving**. Without the cache, every
chat would probe `/v1/models` (a ~50–200 ms call), and after every model
swap the services would need a restart to pick up the new model ID.

With the cache:

- The first chat after a deploy probes once and caches the result.
- All subsequent chats within the TTL use the cached value (no probe).
- After the TTL expires, the next call re-probes — so a model swap
  propagates within `MODEL_DETECT_TTL` seconds, **without a restart**.
- If a probe fails (GPU down, network blip), the **stale cached value
  is served** rather than `None` — "stale > broken" is the design
  principle.

## Configuration

| Env var | Default | Effect |
|---------|---------|--------|
| `MODEL_DETECT_TTL` | `60` (seconds) | How long a cached model ID is considered fresh. After expiry, the next `get_model_id()` call re-probes. |
| `VLLM_API_KEY` | unset | If set, sent as `Authorization: Bearer …` on the probe request. |
| `OPEA_SSL_SKIP_VERIFY` | unset | If `1`, the httpx probe skips TLS verification (for self-signed GPU certs). |

Set `MODEL_DETECT_TTL` for each OPEA service that imports
`core/model_cache.py` (chatqna, retriever, etc.). The env template does
**not** currently declare a `MODEL_DETECT_TTL` entry; it is a Python-side
env var consumed by `core/model_cache.py` (`_resolve_ttl`,
`genie-ai-overlay/core/model_cache.py:36-43`). To set it, add the line to
your deployment's `.env`:

```bash
# Model capability cache TTL (seconds). Lower for fast model-swap
# propagation; raise for fewer probes on a stable GPU.
MODEL_DETECT_TTL=60
```

There is **no restart needed** for the change to take effect — the next
cache miss picks up the new TTL.

## How it works

The module exports two functions:

```python
from core.model_cache import get_model_id, clear_cache
```

`get_model_id(endpoint_url, ttl_seconds=None)` is the main entry
point. The logic, line by line
([`model_cache.py:69-105`](https://gitlab.com/un/itu/genie-ai/-/blob/main/genie-ai-overlay/core/model_cache.py#L69)):

```python
def get_model_id(endpoint_url, ttl_seconds=None):
    if not endpoint_url:
        return None
    now = time.monotonic()
    ttl = _resolve_ttl(ttl_seconds)            # explicit > env > 60s
    entry = _cache.get(endpoint_url)

    if entry and (now - entry["ts"]) < ttl:
        return entry["model_id"]               # cache HIT

    # Cache miss or expired — re-probe.
    model_id = _probe(endpoint_url)
    if model_id is not None:
        _cache[endpoint_url] = {"model_id": model_id, "ts": now}
        return model_id

    # Probe failed. Return stale value if available (stale > broken).
    if entry:
        return entry["model_id"]

    return None                                # never seen before, still failing
```

The cache is a process-local dict — not shared across the OPEA services
or across container restarts. Each service has its own cache; the TTL
keeps them roughly in sync.

## Probe behaviour

`_probe(endpoint_url)` ([`model_cache.py:46`](https://gitlab.com/un/itu/genie-ai/-/blob/main/genie-ai-overlay/core/model_cache.py#L46))
makes one HTTPS call:

```python
resp = httpx.get(f"{endpoint_url}/v1/models", headers=headers, timeout=10, verify=verify)
resp.raise_for_status()
models = resp.json()
if models.get("data"):
    return models["data"][0]["id"]
```

| Probe outcome | Cache state |
|---------------|-------------|
| 200 with `data: [{id: "…"}, …]` | Cache updated with the first model ID. |
| 200 with empty `data: []` | Probe treated as failure (warning logged). |
| 4xx / 5xx / network error | Probe treated as failure; stale value served if available. |
| Timeout (10 s) | Probe treated as failure; stale value served if available. |

The first entry in `data` is always the one cached. vLLM serves the
loaded model first; the rest are reserved slots in the model store.
The cache is therefore always "the model vLLM is currently using".

## When services call it

The module is consumed by any service that needs to address the LLM by
name (rather than letting vLLM pick the default). The most common
caller is the **prompt-template resolution** layer — the prompt the
service sends to vLLM is sometimes model-specific, and knowing the
current model avoids hard-coding it.

To check which services call `get_model_id`:

```bash
cd genie-ai-overlay
grep -rn "from core.model_cache import\|get_model_id" --include="*.py"
```

Expected: a handful of call sites in `chatqna/`, `retriever/`, and the
embedding pipeline. Each call site owns its own cache state — the
module is process-local.

## Verifying it works

### 1. Confirm the cache works in isolation

```bash
cd genie-ai-overlay
python -c "
from core.model_cache import get_model_id, clear_cache
import time

url = 'https://<GPU_NODE_HOST>:8000'

clear_cache()
t0 = time.time()
m1 = get_model_id(url)
t1 = time.time()
print(f'first call:  {m1!r}  ({1000*(t1-t0):.0f} ms)')

t0 = time.time()
m2 = get_model_id(url)
t1 = time.time()
print(f'cached call: {m2!r}  ({1000*(t1-t0):.0f} ms)')
assert m1 == m2
print('cache HIT path confirmed')
"
```

Expected: the second call is ~1 ms (no HTTP), the first is ~50–200 ms
(real probe). If both are equally slow, the cache is not engaged (see
failure modes).

### 2. Confirm TTL expiry triggers re-probe

```bash
MODEL_DETECT_TTL=2 python -c "
from core.model_cache import get_model_id
import time
url = 'https://<GPU_NODE_HOST>:8000'
print(get_model_id(url))   # probe #1
print(get_model_id(url))   # cache HIT
time.sleep(3)
print(get_model_id(url))   # probe #2 (cache expired)
"
```

### 3. Confirm stale-on-failure

Stop vLLM, then:

```bash
python -c "
from core.model_cache import get_model_id
url = 'https://<GPU_NODE_HOST>:8000'
print(get_model_id(url))      # probe fails — logs warning
print(get_model_id(url))      # stale value served (None if never seen)
"
```

Expected: the second call returns the cached value (or `None` if the
process has never probed successfully), not an exception.

## Failure modes and troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `get_model_id` returns `None` on every call | The vLLM endpoint is unreachable or `/v1/models` is returning empty `data` | Test from the OPEA container: `docker exec genieai_chatqna wget -qO- https://<GPU_NODE_HOST>:8000/v1/models`. If `data: []`, no model is loaded — start one in vLLM. |
| Model swaps do not propagate within `MODEL_DETECT_TTL` seconds | The cache is being hit because the cache entry is fresh, then expires, then the probe itself fails | Check vLLM logs: `docker logs genieai_vllm --since 5m 2>&1 \| grep "Loaded model"`. If the new model is loaded but the cache is stale, the GPU node's `/v1/models` response might still return the old one — restart vLLM to refresh its model listing. |
| Every call takes ~100 ms (no cache) | The probe is bypassing the cache | The probe path uses `endpoint_url` as the cache key — confirm all callers pass the **same** URL string (no trailing slash, no query params). `_cache.get(endpoint_url)` is exact-string matched. |
| `stale value served` warning logs but services keep working | vLLM is briefly down; the cache continues serving the last known model | Expected behaviour ("stale > broken"). Investigate vLLM only if the warning persists past `MODEL_DETECT_TTL × 2`. |
| `clear_cache()` does not take effect | `clear_cache` clears the dict but the next call will probe immediately | That **is** the intended behaviour. If you want to suppress the probe, set `MODEL_DETECT_TTL=999999` instead. |
| Probe fails with TLS error on self-signed GPU cert | `OPEA_SSL_SKIP_VERIFY=1` is not set | Set the env var. The `verify` argument is derived from it: `_probe` honours `OPEA_SSL_SKIP_VERIFY != "1"` as `True` (verify on) and `== "1"` as `False` (verify off) (`genie-ai-overlay/core/model_cache.py:56`). |
| Two OPEA services disagree about the current model | Each service has its own process-local cache | Within `MODEL_DETECT_TTL` seconds the two will align naturally (the one that probes first updates first; the other will update on its own next probe). For immediate consistency, restart the lagging service. |

## Operational playbook

| Operation | What to do |
|-----------|------------|
| **Swap the model on the GPU node** | Update `VLLM_LLM_MODEL_ID` in `.env`, run `ansible-playbook … --tags=vllm` (or scale the vLLM service down/up on Swarm). Wait `MODEL_DETECT_TTL` seconds. The next chat picks up the new model. |
| **Force an immediate probe** | Call `clear_cache()` from a Python REPL inside the OPEA container: `docker exec genieai_chatqna python -c "from core.model_cache import clear_cache; clear_cache()"`. |
| **Disable auto-detection** | Set `MODEL_DETECT_TTL=999999` (effectively never re-probe). The first probe on process start still runs. |
| **Add a second GPU endpoint** | Pass the new URL as `endpoint_url` to `get_model_id`. The cache key is the URL string, so the two endpoints are independent caches. |
| **Audit the cache in production** | The module does not emit metrics. Add a Prometheus gauge on `_cache` (size, age) if you need observability — the module is small enough to instrument in a few lines. |

## Related

- [OPEA Protocol Extensions](/docs/reference/opea-protocol/) — the
  request/response models that travel with each service call.
- [Service Registry](/docs/reference/service-registry/) — the
  `ServiceType` enum that names each microservice.
- [Choosing Models](/docs/rag-pipeline/choosing-models/) — which models
  the vLLM endpoint should serve for embedding, reranking, and chat.
- [Deploy → Remote GPU node](/docs/deploy/gpu/) — the deployment
  topology where the cache matters most.