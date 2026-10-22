# GENIE.AI — AWS Deployment Options

## Overview

This document compares three AWS deployment options for GENIE.AI so a deployment path
can be chosen based on cost, quality, and IP/sovereignty needs.

GENIE.AI runs the full OPEA RAG pipeline (vLLM LLM, vLLM translation, TEI embedding +
reranker, retriever, dataprep, chatqna) alongside the GENIE.AI core services (frontend,
backend, ArangoDB, Redis, document-repository) and the gateway (Kong, NGINX, Keycloak,
PostgreSQL) — all defined in a single dual-mode [`docker-compose.yaml`](../docker-compose.yaml).
The existing GPU profiles target on-prem cards: [`env.t4`](../env.t4) (NVIDIA T4 16 GB)
and [`env.rtx6000`](../env.rtx6000) (RTX 6000 ADA 24 GB).

The three options differ in **what you run yourself vs. offload**:

- **Options 1 & 2** — fully self-hosted, including the LLM, on a single AWS G6e GPU
  instance (NVIDIA L40S, 48 GB VRAM). They differ only in box size and model choice.
- **Option 3** — a hybrid: the GPU-heavy LLM inference is offloaded to a managed,
  region-locked endpoint, while all GENIE.AI intellectual property (orchestration,
  retrieval, data) stays in your own containers on a small instance. With the LLM
  offloaded, only the lightweight embedding/reranker models need a GPU, so a small
  `g6.xlarge` (NVIDIA L4, 24 GB) is sufficient.

### Pricing assumptions

- **Region**: `us-east-1` (N. Virginia).
- **Date**: prices verified May 2026 (see [Pricing appendix](#pricing-appendix)).
- **Monthly** = hourly × 730 hours.
- Prices **exclude** EBS storage, data transfer, Elastic IP, and backups. Add roughly
  **$40–150/mo** for a 200–500 GB gp3 volume plus moderate egress.
- "1-yr reserved" = AWS 1-year Standard Reserved Instance / Savings Plan rate
  (approximate, no-upfront).

### AWS infrastructure beyond EC2

The EC2 instance is the headline cost, but a real deployment needs supporting AWS
services. The current Ansible tooling targets a single host, so these are either
co-located on the instance or wired in alongside it:

| AWS service | Purpose | Needed by |
|-------------|---------|-----------|
| **EC2** (GPU instance) | Runs the GENIE.AI stack | All — mandatory |
| **EBS** (gp3, 200–500 GB) | ArangoDB data, model cache, document uploads, call recordings | All — mandatory |
| **Elastic IP** | Stable public address for the domain | All — mandatory |
| **Route 53** (or external DNS) | Domain → instance | All — mandatory |
| **Security Groups** | Expose only 80/443; lock down everything else | All — mandatory |
| **S3** | ArangoDB snapshots + document backups | All — strongly recommended |
| **IAM role** | S3 backup access; **Bedrock access for Option 3** | Recommended; **mandatory for Option 3** |
| **CloudWatch** | Logs, plus alarms for disk-full / instance health | Recommended |
| **EBS snapshots / AWS Backup** | Disaster recovery | Recommended |
| **ACM + ALB** | Managed TLS instead of self-signed certs / certbot | Optional upgrade |

**Option 3 additionally requires**: AWS **Bedrock** enabled in a region you control (the
managed LLM), and — only if the databases are offloaded — **RDS** for PostgreSQL and
**ElastiCache** for Redis. The base Option 3 keeps the databases on the instance.

These supporting services add a modest, similar amount to every option (~$30–80/mo for
storage, EIP, DNS, and backups combined) and do not change the cost ranking.

---

## Option 1 — Same stack, lift to g6e.4xlarge

Lift-and-shift the existing stack, unchanged, onto a larger AWS box. No code or image
changes — only a new GPU env profile.

**Instance: g6e.4xlarge**

| Spec | Value |
|------|-------|
| vCPU | 16 |
| RAM | 128 GiB |
| GPU | 1× NVIDIA L40S |
| VRAM | 48 GB |

The L40S 48 GB has 2× the VRAM of the current RTX 6000 ADA profile, so this is a
comfortable migration with headroom to spare.

**Configuration**

- **Chat model**: keep `meta-llama/Meta-Llama-3.1-8B-Instruct` (current default).
- **Tuning**: a new `env.g6e-4xl` profile would raise the on-prem limits to use the
  larger card:

  | Variable | env.rtx6000 | env.g6e-4xl (proposed) |
  |----------|-------------|------------------------|
  | `VLLM_GPU_UTILIZATION` | 0.6 | ~0.5 |
  | `VLLM_MAX_MODEL_LEN` | 4096 | 8192 |
  | `VLLM_MAX_NUM_SEQS` | 1024 | ~256 |

- **Concurrency**: ~50–150 simultaneously-active users — see
  [Concurrent-user capacity](#concurrent-user-capacity). Single replica of each service;
  no horizontal scaling.
- **Best for**: a production pilot or single-tenant deployment that wants the full
  8B-model answer quality.

**Cost**

| | On-Demand | 1-yr Reserved |
|---|---|---|
| Hourly | $3.004 | ~$1.893 |
| **Monthly (730 h)** | **~$2,193/mo** | **~$1,382/mo** |
| + storage/transfer | +~$60–100/mo | +~$60–100/mo |

---

## Option 2 — Optimized: smaller model on g6e.2xlarge

Same architecture and images, but swap the chat LLM from 8B to a 3B model and run on a
smaller, cheaper instance. This is the lowest-cost option.

**Instance: g6e.2xlarge**

| Spec | Value |
|------|-------|
| vCPU | 8 |
| RAM | 64 GiB |
| GPU | 1× NVIDIA L40S |
| VRAM | 48 GB |

**Configuration**

- **Chat model**: `Qwen/Qwen2.5-3B-Instruct` — set via
  `VLLM_LLM_MODEL_ID=Qwen/Qwen2.5-3B-Instruct` in `.env`. This variable also flows to
  the `chatqna` `LLM_MODEL` and to `dataprep`, so a single override updates the whole
  pipeline.

  Why Qwen2.5-3B over Llama 3.1 8B:
  - **~6 GB** in FP16 vs **~16 GB** for the 8B model — frees VRAM for KV cache and for
    the Gemma-3-4B translation model + TEI embedding/reranker that share the GPU.
  - **Not HuggingFace-gated** — no access request needed (Llama models are gated).
  - Strong multilingual performance, well-suited to RAG; faster tokens/second.

- **Tuning**: a new `env.g6e-2xl-small` profile:

  | Variable | Value |
  |----------|-------|
  | `VLLM_GPU_UTILIZATION` | ~0.35 |
  | `VLLM_MAX_MODEL_LEN` | 4096 |
  | `VLLM_MAX_NUM_SEQS` | ~128 |

- **Trade-off**: lower answer quality than the 8B model. Qwen2.5-3B is strong on
  multilingual RAG, but expect shorter, less nuanced answers on complex queries.
- **Concurrency**: ~50–150 simultaneously-active users, same ceiling as Option 1 — see
  [Concurrent-user capacity](#concurrent-user-capacity). The 3B model produces tokens
  faster, so it feels snappier under load.
- **Best for**: cost-sensitive deployments where 3B-model quality is acceptable.

**Cost**

| | On-Demand | 1-yr Reserved |
|---|---|---|
| Hourly | $2.242 | ~$1.413 |
| **Monthly (730 h)** | **~$1,637/mo** | **~$1,031/mo** |
| + storage/transfer | +~$50–90/mo | +~$50–90/mo |

---

## Option 3 — Hybrid: managed LLM endpoint, self-host the rest

Offload only the GPU-heavy **LLM inference** to a managed inference provider, and keep
**everything that is GENIE.AI's intellectual property** running in your own containers.
This removes the largest cost driver (the GPU instance) without giving up the parts of
the system that are actually yours.

### What stays yours vs. what is offloaded

The LLM weights (Llama, Qwen, Gemma) are **open models you self-host today — they are
not GENIE.AI IP**. The IP is the orchestration, retrieval, and data layer around them.
This option draws the line there:

| Component | Where it runs | Why |
|-----------|---------------|-----|
| `chatqna` (RAG orchestration) | **Your container** | Core IP — prompt logic, abstention, citation handling |
| `retriever` (hybrid vector-graph) | **Your container** | Core IP — your retrieval algorithm over ArangoDB |
| `dataprep` (chunking, labeling) | **Your container** | Core IP — your ingestion pipeline |
| `backend`, `frontend` | **Your containers** | Core IP — auth, conversations, analytics, UI |
| ArangoDB (KB + embeddings) | **Your container** | Core IP — your knowledge base and data |
| TEI embedding + reranker | **Your container** | Small CPU/GPU footprint; keep for data control |
| **Chat LLM** (`vllm`) | **Managed endpoint** | Commodity — open model, no IP, GPU-expensive |
| **Translation LLM** (`vllm-translation`) | **Managed endpoint** | Commodity — open model, GPU-expensive |

Only the two vLLM services move out. Your prompts, your knowledge base, your retrieval
logic, your data, and your code all stay in containers you control.

### How services connect to the managed LLM

Every GENIE.AI service that calls an LLM already speaks the **OpenAI-compatible API**
(`/v1/chat/completions`), and the endpoint is fully driven by environment variables —
verified across the codebase:

| Service | Variable(s) to point at the managed endpoint | Source |
|---------|----------------------------------------------|--------|
| `chatqna` | `LLM_SERVER_HOST_IP`, `LLM_SERVER_PORT`, `OPENAI_API_KEY` | [`genieai_chatqna.py:62-68`](../genie-ai-overlay/chatqna/genieai_chatqna.py#L62-L68) |
| `dataprep` | `OPENAI_BASE_URL`, `OPENAI_API_KEY`, `OPENAI_LLM_MODEL` | [`genieai_dataprep_arangodb.py:348-354`](../genie-ai-overlay/dataprep/genieai_dataprep_arangodb.py#L348-L354) |
| `retriever` | `VLLM_ENDPOINT`, `VLLM_API_KEY`, `VLLM_MODEL_ID` | `genieai_retriever_arangodb.py` (uses `ChatOpenAI`) |
| `translation` | `LLM_ENDPOINT`, `LLM_MODEL_ID` | `docker-compose.yaml` |

This means: pointing GENIE.AI at **any OpenAI-compatible managed endpoint is env-var-only,
no application code changes** — just `.env` edits plus removing the `vllm` /
`vllm-translation-guardrail` services.

The catch: **AWS Bedrock is not OpenAI-compatible out of the box** (it uses its own
`InvokeModel` API), so a thin proxy/adapter is needed to bridge it — see
[Implementation effort](#implementation-effort) below. If a sovereign provider that
already exposes an OpenAI-compatible API is used instead, the swap stays env-var-only.

### Sovereignty constraint (hard requirement)

GENIE.AI is a sovereign, DPG-compliant framework, so the managed endpoint **must not**
send data to a closed US frontier API (OpenAI/Anthropic). It must:

- Serve an **open model** (Llama 3.1 8B / Qwen2.5, Gemma 3 for translation) — the same
  model class you run today, so quality and behavior are unchanged.
- Be **region-locked** to a jurisdiction you control, with a signed Data Processing
  Agreement and no training on your data.

Suitable patterns that satisfy this:
- **AWS Bedrock** with an open model (Llama 3.1 8B) in a region you control — keeps the
  whole stack inside one AWS account and region boundary, OpenAI-compatible via a thin
  proxy or the Bedrock OpenAI-compatible endpoint.
- A **sovereign / region-locked inference provider** that hosts open weights under a DPA.
- A **self-managed vLLM endpoint on a separate, smaller GPU box you own** — the most
  conservative reading of "sovereign": the model still runs on your hardware, just
  decoupled from the application node so the app node needs no GPU.

> The cost table below uses **AWS Bedrock (Llama 3.1 8B, open model, controlled region)**
> as the representative managed option, since it keeps data inside your AWS boundary.

### What else can be offloaded to managed services

The LLM is the highest-value offload, but the compose stack has ~36 services and several
others can move to managed/third-party APIs. The table below classifies every offloadable
component. **Anything marked "Keep self-hosted (IP)" should not be offloaded** — that is
GENIE.AI's intellectual property or your data.

**Safe to offload — commodity infrastructure & models:**

| Service(s) | Managed replacement | Effort | Sovereignty note |
|------------|---------------------|--------|------------------|
| `vllm` (chat LLM) | AWS Bedrock / region-locked open-model endpoint | Env var only | Open model, controlled region |
| `vllm-translation-guardrail` + `translation` | Same managed endpoint, or a managed translation API (e.g. AWS Translate) | Env var only | Open model, or region-locked API |
| `arango-vector-db` | **No managed equivalent** — ArangoDB has limited managed options; the closest is ArangoGraph Cloud | Connection string + region check | Holds your KB + embeddings — region-lock mandatory if offloaded |
| `redis-cache` | AWS ElastiCache for Redis (region-locked) | Connection string | Cache only, low sensitivity — easy offload |
| `postgres` (Kong/Keycloak DB) | AWS RDS for PostgreSQL (region-locked) | Connection string | Auth/gateway metadata — region-lock |
| `clamav` | A managed malware-scanning API, or keep — it is small and stateless-ish | Env var / API call | Files are scanned in-region either way |
| `asr-whisper` (speech-to-text) | **Deepgram Nova-3** (recommended), or AWS Transcribe | `voice-bridge` ASR endpoint env var | Audio leaves boundary — see voice note below |
| `tts-piper` (text-to-speech) | **ElevenLabs** (recommended), or AWS Polly | `voice-bridge` TTS endpoint env var | Text leaves boundary — see voice note below |
| `certbot` | AWS Certificate Manager (ACM) + ALB | Replace nginx TLS with ALB | No data, pure infra |

#### Voice services — Deepgram + ElevenLabs (replaces self-hosted)

In Option 3, voice is **fully managed**: the self-hosted voice stack (Whisper
`large-v3-turbo` + Piper) is **removed entirely** — the `asr-whisper` and `tts-piper`
containers are not deployed. That self-hosted stack is quality-limited anyway: Whisper is
batch-oriented so it lags on live calls, and Piper voices sound robotic. `voice-bridge`
instead points at managed providers, which are a large quality jump:

| Function | Provider | Why | Cost (May 2026) |
|----------|----------|-----|-----------------|
| STT (speech-to-text) | **Deepgram Nova-3** | True real-time streaming (~300 ms), live code-switching across 10 languages, speaker diarization | ~$0.0077/min streaming (~$0.46 per audio hour) |
| TTS (text-to-speech) | **ElevenLabs** | Dramatically more natural speech than Piper; 29+ languages, low-latency Flash models | ~$0.12–0.30 per 1,000 characters (volume-tiered; cut up to 55% in May 2026) |

Both are usage-based and inexpensive at pilot scale, and both plug into `voice-bridge`
via its existing endpoint configuration — no application code changes. Removing
`asr-whisper`/`tts-piper` also takes their GPU/CPU load off the node entirely.

> **Sovereignty caveat (accepted trade-off):** Deepgram and ElevenLabs are US providers
> with no in-region sovereign deployment, so call audio and response text leave the
> sovereign boundary. This is an **accepted trade-off for voice specifically** — voice
> quality is the priority here, and voice is a distinct channel from the core
> text/document RAG flow. If a deployment cannot accept any voice-data egress,
> **AWS Transcribe + AWS Polly** stay inside your AWS region boundary at lower quality,
> or keep Whisper/Piper self-hosted. The core LLM and document pipeline remain
> sovereignty-bound regardless.

**OCR / document extraction — partial offload:**

`dataprep` does content extraction with **Docling** on CPU (`CONTENT_EXTRACTION_METHOD=docling`,
`DOCLING_DEVICE=cpu`). Docling is open-source and embedded in the dataprep image. The OCR
step itself *could* be offloaded to a managed document-AI API (e.g. AWS Textract), but
note: the `dataprep` chunking, labeling, and embedding-orchestration logic around it **is
GENIE.AI IP** — only the raw text-extraction call would be swapped, and that needs a code
change (it is not an env-var switch like the LLM). Recommendation: **keep Docling local**
unless OCR quality on hard documents becomes a real problem.

**Keep self-hosted — this is GENIE.AI IP or your data:**

| Service(s) | Why it stays |
|------------|--------------|
| `chatqna` | RAG orchestration, prompt logic, abstention, citations — core IP |
| `retriever-arango-service` | Hybrid vector-graph retrieval algorithm — core IP |
| `dataprep` (the pipeline) | Chunking, LLM labeling, embedding orchestration — core IP |
| `reranker` (`genie-ai-reranker`) | Your reranking wrapper/strategy — core IP |
| `backend`, `frontend` | Auth, conversations, analytics, UI — core IP |
| `voice-bridge`, `whatsapp-service`, `http-service` | Channel adapters / orchestration — core IP |
| `keycloak` | Identity config and realms — your auth boundary (DB can be RDS) |
| `kong`, `nginx` | Your gateway routing and TLS policy |
| `lid` | Small CPU model, trivial to host — no benefit to offloading |
| `tei` embedding + `tei_reranker` | Could be offloaded, but they are small and process your
  documents/queries — keeping them local is the safer sovereignty choice |
| `document-repository` + uploaded files | Your users' documents — must stay in-boundary |

**Summary**: realistically, **the LLM is the only offload worth doing for cost** (it is
the GPU hog). Databases can move to managed AWS services (RDS, ElastiCache) for
operational convenience but not cost savings, and only if region-locked. Voice services
can offload if voice is in scope. Everything that makes GENIE.AI *GENIE.AI* — the RAG
orchestration, retrieval, ingestion logic, and data — stays in your containers.

### GPU resources required

This is the part that changes the most versus Options 1 & 2. **The LLM is the big GPU
consumer, and in Option 3 it is offloaded** — so the local GPU only has to serve the
lightweight RAG models:

| Service | GPU role in Option 3 | VRAM needed |
|---------|----------------------|-------------|
| `vllm` (chat LLM) | **Offloaded** to managed endpoint | 0 GB local |
| `vllm-translation` (translation LLM) | **Offloaded** to managed endpoint | 0 GB local |
| `tei` (embedding, BGE-base) | Runs locally — small | ~0.5 GB |
| `tei_reranker` (cross-encoder MiniLM) | Runs locally — small | ~0.1 GB |
| `dataprep` / Docling OCR | CPU by default (`DOCLING_DEVICE=cpu`) | 0 GB |
| `asr-whisper` (speech-to-text) | **Not deployed** — voice runs on Deepgram | 0 GB |
| `tts-piper` (text-to-speech) | **Not deployed** — voice runs on ElevenLabs | 0 GB |

Voice in Option 3 is fully managed (**Deepgram** for STT, **ElevenLabs** for TTS), so the
`asr-whisper` and `tts-piper` containers are removed from the deployment entirely — no
local GPU or CPU is spent on speech.

**Total local GPU demand: ~1 GB VRAM** — only the embedding + reranker models.

Because the requirement is so small, Option 3 uses a **`g6.xlarge`** (1× NVIDIA **L4**,
**24 GB** VRAM) — not the L40S-class card Options 1 & 2 need. The L4 24 GB has ample room
for the embedding + reranker models with headroom to spare, at roughly **half** the
hourly cost of a g6e instance. A CPU-only instance would technically work too, at the
cost of slower embedding/reranking latency under load — the small GPU is the better
default.

### Resulting deployment

- **Application node**: a **small GPU instance** — `g6.xlarge` (1× L4 24 GB). Runs the
  TEI embedding + reranker and all GENIE.AI containers; the chat/translation LLMs are
  remote.
- **LLM**: managed Bedrock endpoint, billed **per token** (pay-per-use, scales with
  actual traffic — no idle GPU cost).
- **Best for**: a SaaS pilot that needs elastic, traffic-proportional LLM cost while
  keeping all proprietary logic and data in-house.

### Cost

Two parts: a small fixed instance + variable per-token LLM usage.

**Fixed — application node (g6.xlarge):**

| | On-Demand | 1-yr Reserved |
|---|---|---|
| Hourly | $0.805 | ~$0.524 |
| **Monthly (730 h)** | **~$588/mo** | **~$383/mo** |

**Variable — managed LLM (AWS Bedrock, Llama 3.1 8B):**

- Rate: **$0.20 / 1M input tokens, $0.25 / 1M output tokens** (us-east-1, May 2026).
- Illustrative RAG usage — ~3,000 input + ~500 output tokens per query:

  | Queries / month | Approx. LLM cost / month |
  |-----------------|--------------------------|
  | 50,000 | ~$36 |
  | 200,000 | ~$145 |
  | 500,000 | ~$363 |

**Total (g6.xlarge on-demand + 200k queries/mo): ~$733/mo**, scaling down toward
~$590/mo at low traffic and up gradually with usage. Reserved instance brings the
fixed part to ~$383/mo (total ~$528/mo). *Storage/transfer +~$40–80/mo applies as with
the other options.*

This is **by far the cheapest option at low-to-moderate traffic** and the only one where
LLM cost tracks actual demand instead of paying for an idle GPU.

---

## Comparison

| | Option 1 | Option 2 | Option 3 |
|---|---|---|---|
| Approach | Self-host, bigger box | Self-host, smaller model | Managed LLM, self-host rest |
| Instance | g6e.4xlarge | g6e.2xlarge | g6.xlarge (app only) |
| vCPU / RAM | 16 / 128 GiB | 8 / 64 GiB | 4 / 16 GiB |
| GPU | 1× L40S 48 GB | 1× L40S 48 GB | 1× L4 24 GB (~1 GB used) |
| Chat model | Llama 3.1 8B (self-hosted) | Qwen2.5 3B (self-hosted) | Llama 3.1 8B (managed endpoint) |
| Code changes | None (env only) | None (env only) | Adapter services needed |
| Core IP location | Your containers | Your containers | Your containers |
| LLM cost model | Fixed (in instance) | Fixed (in instance) | Per-token, usage-based |
| Concurrent users | ~50–150 | ~50–150 | ~50–200 |
| Implementation effort | ~1 day | ~1 day | ~6–9 days |
| **On-demand /mo** | **~$2,193** | **~$1,637** | **~$733** (incl. 200k queries) |
| **1-yr reserved /mo** | **~$1,382** | **~$1,031** | **~$528** (incl. 200k queries) |

*Monthly figures exclude storage and data transfer — add ~$40–150/mo. Option 3's total
varies with LLM traffic; figures shown assume ~200k queries/month.*

---

## Concurrent-user capacity

An important finding: **the GPU is not the main concurrency limit.** All three options
run the *same* application architecture, which is **single-node by design** — and the
ceiling comes from the application tier, not the LLM:

- `arango-vector-db` runs as a **single instance** (`replicas: 1`, no clustering — the
  ArangoDB Community edition cannot cluster). Every chat, every retrieval, every session
  read/write funnels through it.
- `backend` is a **single Node.js process** (`replicas: 1`).
- The Kong gateway rate-limits each user to **1,000 requests/minute**.
- Sessions are stored in ArangoDB (not in-memory), so the backend *could* be scaled
  horizontally — but nothing in the current compose stack does so.

"Concurrent users" below means users **actively waiting on a response at the same
instant** — not registered or logged-in users. With normal think-time between messages,
each option serves several hundred to ~1,000 registered users; the simultaneous-active
number is much smaller:

| | Option 1 | Option 2 | Option 3 |
|---|---|---|---|
| LLM concurrency | ~64–128 parallel seqs (L40S, 8B) | ~128 parallel seqs (L40S, 3B — faster tokens) | Elastic — Bedrock auto-scales |
| **Realistic concurrent users** | **~50–150** | **~50–150** | **~50–200** |
| First bottleneck | ArangoDB single instance | ArangoDB single instance | ArangoDB / single backend process |

- **Options 1 & 2** are capped by **both** the single GPU *and* the single-instance
  database. Option 2's 3B model produces tokens faster, so it feels snappier under load,
  but the hard ceiling is the same — ArangoDB.
- **Option 3** has a slight edge: the managed LLM (Bedrock) scales elastically, so the
  LLM never becomes the cap — the database does. That is why its range reaches ~200.

**To exceed ~200 concurrent users, none of the three options is sufficient as-is.** True
SaaS scale would require: ArangoDB clustering (Enterprise edition), a horizontally-scaled
backend behind a load balancer, and a multi-node Swarm or Kubernetes deployment. That is
a separate, larger initiative beyond the scope of these three options.

---

## Implementation effort

Effort estimates assume an existing AWS account and the current Ansible deployment
tooling (`deploy/ansible/`).

### Option 1 — ~1 day

Pure configuration. The model and GPU tuning are entirely env-var driven.

- Create a new `env.g6e-4xl` GPU profile (a single file, like the existing `env.t4` /
  `env.rtx6000`), set `gpu_env_file: env.g6e-4xl` in the Ansible group vars.
- Deploy and validate (`nvidia-smi`, a few test queries).
- **No code changes.**

### Option 2 — ~1 day

Same as Option 1 plus a one-line model change. `VLLM_LLM_MODEL_ID` is consumed only via
environment variables across all 8 services that reference it — set
`vllm_llm_model_id: Qwen/Qwen2.5-3B-Instruct` in the Ansible vars, rebuild, deploy.

- **No code changes.** The model swap is genuinely env-var-only.

### Option 3 — ~6–9 days

This is the only option needing real engineering, because the managed providers do **not**
natively speak the API contracts GENIE.AI's services expect. Three pieces of work:

| Work item | Effort | Why it is not just an env var |
|-----------|--------|-------------------------------|
| **Bedrock LLM adapter** | ~3–5 days | The codebase has no Bedrock integration and all services expect an **OpenAI-compatible** API. A thin proxy service (FastAPI + boto3) must translate OpenAI `/v1/chat/completions` calls — including streaming — to Bedrock's `InvokeModel` API. Services then point at the proxy via env var. |
| **Deepgram + ElevenLabs voice adapters** | ~3–4 days | `voice-bridge` calls ASR/TTS via a fixed internal contract (`/v1/microservice/asr`, `/v1/microservice/tts` with an `x-sample-rate` header). Deepgram and ElevenLabs use different request/response shapes, so two small wrapper services are needed to translate. `voice-bridge` itself stays unchanged — only env vars repoint to the wrappers. |
| **Config + deploy + integration testing** | ~0.5–1 day | Wire env vars, add AWS IAM credentials as Swarm secrets, remove `vllm`/`asr-whisper`/`tts-piper` from the deployment, end-to-end test of chat + voice. |

**Note on the "no code changes" claim:** pointing GENIE.AI's services at *any
OpenAI-compatible* endpoint is genuinely env-var-only. The effort in Option 3 is
specifically because **Bedrock and the voice providers are not OpenAI-compatible** out of
the box — the adapter services bridge that gap. If a managed LLM provider that already
exposes an OpenAI-compatible API in a sovereign region were used instead of Bedrock, the
LLM adapter (~3–5 days) would drop to ~0.5 day, reducing Option 3 to ~4–5 days total.

The adapter services are small, reusable, and become part of your stack — a one-time
build, not recurring effort.

---

## Recommendation

- **Option 3** — best for a **SaaS pilot with sovereignty preserved**. Cheapest at
  low-to-moderate traffic, LLM cost scales with actual usage, and all GENIE.AI IP
  (orchestration, retrieval, data) stays in your own containers. Requires a
  region-locked managed endpoint serving an open model (e.g. AWS Bedrock Llama 3.1 8B)
  to satisfy the DPG/sovereignty requirement.
- **Option 1** — best for a **fully self-hosted, single-tenant** deployment where the
  entire stack — including model weights — must run on infrastructure you operate, with
  the full 8B model and zero code changes.
- **Option 2** — best for a **fully self-hosted, cost-minimised pilot**. Lowest fixed
  cost of the self-hosted options; the Qwen2.5-3B trade-off is acceptable answer quality
  for many use cases.

A common path: start on **Option 3** to validate the product with minimal fixed cost,
then move to **Option 1** if regulatory requirements later demand that the model itself
also run on owned infrastructure.

---

## Pricing appendix

AWS pricing, `us-east-1`, verified May 2026.

**EC2 GPU instances:**

| Instance | vCPU | RAM | GPU | VRAM | On-Demand $/hr | 1-yr Reserved $/hr | Used by |
|----------|------|-----|-----|------|----------------|--------------------|---------|
| g6.xlarge    | 4  | 16 GiB  | 1× L4   | 24 GB  | $0.805 | ~$0.524 | Option 3 (app node) |
| g6e.2xlarge  | 8  | 64 GiB  | 1× L40S | 48 GB  | $2.242 | ~$1.413 | Option 2 |
| g6e.4xlarge  | 16 | 128 GiB | 1× L40S | 48 GB  | $3.004 | ~$1.893 | Option 1 |

**Managed LLM (AWS Bedrock, Llama 3.1 8B — Option 3):**

| Token type | Rate |
|------------|------|
| Input  | $0.20 / 1M tokens |
| Output | $0.25 / 1M tokens |

Option 3 LLM cost assumes ~3,000 input + ~500 output tokens per RAG query. Sovereign
deployments should select a Bedrock region they control; GovCloud carries a ~20–30%
markup over the standard rate.

**Disclaimer**: prices exclude EBS storage, data transfer, Elastic IP, and backups.
Reserved-instance rates are approximate (1-year, no-upfront) and vary with payment
option and term. Bedrock token rates vary by region. Confirm against the AWS pricing
calculator before committing.

### Sources

- [AWS EC2 G6e instances](https://aws.amazon.com/ec2/instance-types/g6e/)
- [g6.xlarge pricing & specs — Vantage](https://instances.vantage.sh/aws/ec2/g6.xlarge)
- [g6e.2xlarge pricing & specs — Vantage](https://instances.vantage.sh/aws/ec2/g6e.2xlarge)
- [g6e.4xlarge pricing & specs — Vantage](https://instances.vantage.sh/aws/ec2/g6e.4xlarge)
- [Amazon Bedrock pricing](https://aws.amazon.com/bedrock/pricing/)
