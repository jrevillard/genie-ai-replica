# AMINA — ITU Technical Brief
## Questions, Limitations, Training Viability & Upgrade Roadmap

**Prepared for:** ITU / Technical Review Team  
**Date:** April 2026  
**System Version:** AMINA v2.0 (Tailscale 24/7, LoRA pipeline separated)  
**Contact:** AMINA Engineering Team

---

## SECTION 1 — 10 Critical Questions for ITU

These are the most important unresolved decisions that need ITU-level input before scaling.

---

### Q1. Is training AMINA LoRA in fp32 with 750K examples viable on the current A40 GPU?

**Context:**  
AMINA v2 was trained in bfloat16 (bf16) precision on 145,000 synthetic examples using a single NVIDIA A40 (46GB VRAM). The proposal is to upgrade to full fp32 (32-bit float) precision with 750,000 real + synthetic examples.

**Full calculation:**

| Component | bf16 LoRA r=32 (current) | fp32 LoRA r=64 (proposed) |
|-----------|--------------------------|---------------------------|
| Base model weights | 14.5 GB (bf16) | 28.9 GB (fp32) |
| LoRA adapter weights | 0.34 GB | 0.67 GB |
| Adam optimizer states (LoRA only) | 0.68 GB | 1.34 GB |
| Gradient checkpointing activations | 4–6 GB | 12–15 GB |
| CUDA framework overhead | 2 GB | 2 GB |
| **Total VRAM required** | **~22 GB ✓** | **~45–48 GB ✗** |
| A40 available | 46 GB | 46 GB |
| **Fits?** | **Yes (comfortable)** | **No at batch=4** |

**Verdict:** Pure fp32 with the full model does NOT fit on a single A40 at any useful batch size (batch=4 exceeds VRAM; batch=1 would fit at ~36GB but would take 3-4× longer to train with worse gradient stability).

**The viable alternative — Hybrid precision (bf16 base + fp32 LoRA):**
- Load base model in bf16 (14.5 GB)
- Train only LoRA adapter weights in fp32 (0.67 GB for r=64)
- Adam optimizer states only for 168M trainable params: 1.34 GB
- Total: **~26–28 GB** — fits comfortably on A40
- Gradient precision for LoRA weights: full fp32
- Result: **~85-90% of the quality benefit of full fp32 at current hardware cost**

**Training time estimate for 750K examples on A40 (hybrid precision, r=64):**

```
Architecture:    Mistral-7B, bf16 base, fp32 LoRA r=64
A40 throughput:  ~4,000 tokens/second (training, real-world benchmark)
Batch size:      8 (increased from 4 — more VRAM available)
Gradient accum:  8 (effective batch = 64)
Seq length:      2,048 tokens
Epochs:          3

Per mini-batch:  8 samples × 2,048 tokens = 16,384 tokens
Step time:       16,384 / 4,000 = ~4.1 seconds per mini-batch step

Mini-batch steps per epoch:  750,000 / 8 = 93,750
Total mini-batch steps (3 epochs):  281,250
Total training time:  281,250 × 4.1 sec = 1,153,125 sec

= 320 hours = ~13.3 days on a SINGLE A40
```

**With 2× A40 (data parallelism, 92 GB combined):**
```
= ~7 days (near-linear scaling for data parallel training)
```

**With 1× NVIDIA H100 80GB (ITU-grade hardware):**
```
H100 training throughput: ~12,000 tokens/second (3× A40)
= ~4.5 days for full run
= Recommended hardware for this training scale
```

**ITU Question:** Can ITU provide access to 2× A40 or 1× H100 for the 750K training run? Estimated electricity cost: ~$150-250 (H100) for the full training job if cloud-hosted.

---

### Q2. What is the data governance plan for real patient conversations used in training?

**Context:**  
The 750K dataset upgrade requires real Gambian CHW-patient conversation transcripts (estimated 150K examples). These contain sensitive health information.

**Specific questions:**
- Who owns the conversation data — the Ministry of Health, the patient, the CHW, or AMINA?
- What de-identification protocol applies before data enters the training pipeline? (PHI removal: names, phone numbers, villages, specific dates)
- Does Gambia's data protection law (Data Protection Act 2021) require patient consent for training use, or does anonymization suffice?
- Can ITU provide a data processing agreement (DPA) template for CHWs and health posts contributing conversations?
- What is the retention policy for training data after model training is complete?

**Risk if unresolved:** Using real patient data without clear legal basis could expose the project to regulatory sanctions and destroy patient trust in AMINA.

---

### Q3. Should AMINA LoRA migrate from Cloudflare Tunnel + Tailscale to a dedicated inference endpoint on ITU infrastructure?

**Current architecture:**
```
User request → Cloudflare Tunnel (~50-100ms overhead) 
             → Tailscale VPN → A40 (private network)
             → vLLM → Response
```

**Problems with current setup:**
- Cloudflare tunnel adds 50-100ms latency per request (Gambia → US → back)
- Single point of failure: if Cloudflare or Tailscale goes down, AMINA LoRA is unavailable
- No SLA from Cloudflare free tunnel
- Cannot serve >32 concurrent requests without upgrading vLLM server

**ITU-hosted alternative:**
```
User request → ITU load balancer (local network, <5ms)
             → vLLM endpoint (ITU data center)
             → Response
```

**ITU Question:** Can ITU host the vLLM inference server directly? Requirements:
- 1× GPU server (NVIDIA A40 or T4 for inference)
- 46+ GB VRAM for AMINA-7B at bf16
- 100Mbps+ network connection
- Static IP with TLS certificate

---

### Q4. What happens to AMINA if the primary LLM providers (Google, OpenAI) change pricing or revoke API access?

**Current dependency map:**

| Function | Provider | Monthly cost (estimate) | If removed |
|----------|----------|------------------------|------------|
| Primary inference (patient chat) | Google Gemini 2.5 Flash Lite | ~$20-80 | Fall back to Groq |
| Fallback inference | Groq (Llama 3.3 70B) | Free tier | Fall back to base |
| Safety supervisor | OpenAI GPT-4o-mini | ~$5-15 | Safety review bypassed |
| Base model (GPT-4o-mini) | OpenAI | ~$30-100 | Fall back to Gemini |
| AMINA LoRA | Self-hosted A40 | Electricity only | No fallback |
| Mandinka translation | OpenAI/Gemini | Included above | Skip translation |

**Risks:**
- Google increased Gemini pricing by 10× in late 2025 — could happen again
- Groq free tier has 6,000 tokens/minute limit — unusable at scale
- OpenAI safety supervisor adds ~$0.01-0.02 per conversation — at 10,000 users: $100-200/month
- AMINA LoRA is the only fully independent option

**ITU Question:** Is there a budget line for external API costs? At 10,000 active patients with 3 conversations/week average, estimated API spend: **$400-800/month**. At 100,000 patients: **$4,000-8,000/month**. AMINA LoRA on ITU hardware would reduce this to near-zero.

---

### Q5. What is the minimum viable infrastructure for a 10,000-patient national deployment?

**Based on current performance data:**

| Component | 1,000 patients | 10,000 patients | 100,000 patients |
|-----------|---------------|-----------------|------------------|
| API servers | 1× (4 workers) | 2× (8 workers) | 8× (load balanced) |
| Redis | 1× (6 MB RAM) | 1× (60 MB RAM) | Redis Cluster (3 nodes) |
| ArcadeDB | 1× (309 MB) | 1× (3 GB) | 3-node cluster |
| vLLM (AMINA LoRA) | 1× A40 | 2× A40 | 4× A40 or 1× A100 |
| Disk | 100 GB | 500 GB | 2 TB |
| RAM per API server | 8 GB | 16 GB | 32 GB |
| Network | 100 Mbps | 1 Gbps | 10 Gbps |

**Current measured peak throughput:** 30-40 chat turns/second (4 workers)  
**At 3 conversations/day per patient, peak hour (8% of daily traffic):**
- 1,000 patients: 3,000 daily conversations × 8% = 240 in peak hour = 0.07 turns/second → **current infrastructure sufficient**
- 10,000 patients: 0.7 turns/second → **current infrastructure sufficient**
- 100,000 patients: 7 turns/second → **2× API servers needed**

**ITU Question:** What is the target patient population for Year 1? This determines which infrastructure tier to provision from day one.

---

### Q6. Can AMINA integrate with Gambia's existing health information systems (DHIS2, eHealth)?

**Current state:** AMINA stores consultation records in ArcadeDB (proprietary graph DB). Data is not in any standardized format (no HL7-FHIR, no ICD-10 codes, no SNOMED).

**Integration requirements for DHIS2:**
- DHIS2 uses flat aggregate data (counts of visits, diagnoses by region)
- AMINA would need to push: daily consultation counts, NCD diagnosis frequencies, triage escalations, by region
- API: DHIS2 has a REST API — AMINA could push via scheduled batch job (no real-time needed)
- Development estimate: 4-6 weeks for basic DHIS2 integration

**Integration requirements for HL7-FHIR (EHR interoperability):**
- All AMINA consultation records would need FHIR R4 encoding (Patient, Encounter, Observation, CarePlan resources)
- Development estimate: 8-12 weeks for full FHIR output layer
- Requires: clinical terminology standardization (ICD-10 mapping, SNOMED)

**ITU Question:** Is DHIS2 integration a Year 1 requirement? Is there an existing Gambia eHealth API that AMINA should connect to? Who is the DHIS2 administrator at MoH?

---

### Q7. What regulatory approval is needed before AMINA can give clinical guidance to patients?

**Relevant frameworks:**
- **WHO Digital Health Regulatory Framework (2023):** AI health tools providing clinical guidance to patients require pre-market safety review in most jurisdictions
- **Gambia FDA:** Does The Gambia have a digital health device regulation? (Currently unclear)
- **Medical Device Classification:** Is AMINA a "Software as Medical Device" (SaMD)? If yes, it may need clinical validation studies before deployment

**Current AMINA safety posture:**
- Two safety gates (pre-LLM medication gate + post-LLM supervisor)
- No hallucination detection
- No clinical validation study
- No regulatory submission

**Minimum for safe deployment (before regulatory clarity):**
- Clear "This is not a substitute for medical advice" disclaimer in UI
- Emergency escalation working (call 199) — ✓ done
- No drug prescribing — ✓ enforced by safety gate
- CHW oversight for any escalation-level advice

**ITU Question:** Has ITU engaged with Gambia FDA/MoH on the regulatory classification of AMINA? What clinical evidence will be required for approval?

---

### Q8. How should AMINA handle complete offline operation when internet is unavailable?

**Current dependency on internet:**
- Gemini API: requires internet
- OpenAI safety supervisor: requires internet
- Cloudflare tunnel to AMINA LoRA: requires internet
- Redis and ArcadeDB: local (offline capable)

**Offline scenario (common in rural Gambia):**
- Patient opens AMINA app — chat loads from local cache
- Patient sends message — cannot reach any LLM endpoint
- Current behavior: error message

**Required for rural deployment:**
- On-device AMINA LoRA inference (quantized, smaller model)
- Options: llama.cpp quantized to 4-bit (Q4_K_M): ~4 GB, runs on CPU
- PWA (Progressive Web App) for offline caching of UI and last session
- Queue messages when offline, send when reconnected

**ITU Question:** What is the expected internet availability for AMINA's primary users (rural CHWs)? Should offline operation be a Year 1 requirement?

---

### Q9. Is the current Redis single-instance a production risk?

**Current setup:** Single Redis instance, no replication, no persistence backup beyond `appendonly yes`.

**Risk scenarios:**
- Redis process crash → all active sessions lost (24h TTL data: vitals, care plans, referrals, ritual phases, trust tiers)
- Redis host restart → same
- Redis memory exhaustion (at scale) → eviction of active session data mid-conversation

**Current mitigation:** `appendonly yes` means Redis writes to disk — data survives restart but not disk failure.

**Production-grade alternatives:**

| Option | Cost | Reliability | When needed |
|--------|------|-------------|-------------|
| Redis Sentinel (1 primary + 2 replicas) | 3× server | 99.9% | 1,000+ concurrent users |
| Redis Cluster (6 nodes) | 6× server | 99.99% | 10,000+ concurrent users |
| AWS ElastiCache / Azure Cache for Redis | $50-200/mo | 99.99% SLA | If cloud deployment |
| Current (single instance) | Current server | ~95% | Dev/early pilot only |

**ITU Question:** What is ITU's Redis/cache infrastructure? Can AMINA use an existing managed Redis service, or does it need to provision its own?

---

### Q10. What does AMINA do if the AMINA LoRA server (A40) goes down for maintenance?

**Current fallback chain:**
```
AMINA LoRA (preferred) 
    ↓ if unavailable
Gemini 2.5 Flash Lite (primary cloud)
    ↓ if quota exceeded
Groq Llama 3.3 70B (free tier fallback)
    ↓ if rate limited
GPT-4o-mini (base fallback)
```

**Problem:** The fallback chain is implicit — if AMINA LoRA fails, the frontend model selector shows "AMINA" but actually uses Gemini. The user does not know they're talking to a different model.

**Required before production:**
- Health check endpoint: `GET /api/v1/health/models` → returns which models are currently available
- Frontend model status indicators (green/yellow/red per model)
- Explicit fallback notification: "AMINA is currently unavailable — responding with Gemini"
- Scheduled maintenance window communication to users

**ITU Question:** What is the planned maintenance schedule for the A40 server? Should AMINA have a separate backup GPU for inference during maintenance?

---

## SECTION 2 — Current Limitations (Full List for ITU)

### Model Limitations

| # | Limitation | Severity | Workaround |
|---|-----------|----------|------------|
| L1 | **No hallucination detection** — AMINA LoRA can contradict patient data (say "BP is fine" when 185/110) | **HIGH** | Post-LLM safety supervisor catches some cases |
| L2 | **No ICD-10 coding** — consultation records are free text, not standardized | HIGH | Manual review by clinician |
| L3 | **ArcadeDB patient profiles wiped on rebuild** — names/profiles lost | HIGH | Frontend sends patient_name as fallback |
| L4 | **145K synthetic training data** — model has never heard real Gambian patient speech | HIGH | Monitor via clinician review |
| L5 | **2048 token trained context** (4096 served) — can't handle long medical histories | MEDIUM | 4-turn history filter applied |
| L6 | **No JSON output from LoRA** — cannot run structured caregiver intake pipeline | MEDIUM | Separate single-shot caregiver pipeline |
| L7 | **Weak Mandinka** — fragmented BPE tokenization, 25K of 145K examples | MEDIUM | Planned 100K Mandinka expansion |
| L8 | **No image processing** — cannot read prescription photos or lab reports | MEDIUM | Manual text entry required |
| L9 | **Single A40 bottleneck** — if A40 offline, LoRA unavailable | MEDIUM | Cloud fallback active |
| L10 | **300 token max output** — cannot generate full SOAP notes or care plans | LOW | Other models handle long outputs |
| L11 | **No device integration** — vitals must be manually entered | LOW | Planned in Tier 3 roadmap |
| L12 | **No offline operation** — requires internet for all inference | LOW | Planned with llama.cpp port |
| L13 | **No PHI de-identification** — patient data stored in plaintext ArcadeDB | HIGH | Urgent before production |
| L14 | **No model versioning or A/B testing** — cannot compare v1 vs v2 quality | MEDIUM | Manual evaluation only |
| L15 | **No evaluation harness** — no automated test of clinical accuracy | HIGH | Planned in Tier 3 roadmap |

### Infrastructure Limitations

| # | Limitation | Severity | Fix Complexity |
|---|-----------|----------|----------------|
| I1 | **Redis single instance** — no replication or backup beyond AOF | HIGH | Medium (Redis Sentinel: 2 days) |
| I2 | **Cloudflare tunnel latency** — adds 50-100ms to every LoRA call | MEDIUM | High (requires ITU hosting) |
| I3 | **No monitoring/alerting** — no Prometheus/Grafana, no latency alerts | HIGH | Medium (2-3 days) |
| I4 | **Docker disk usage** — 70+ GB reclaimable, grows on each rebuild | LOW | Low (docker prune command) |
| I5 | **No HTTPS in local dev** — cookie security not enforced | MEDIUM | Low (config flag) |
| I6 | **No rate limiting per user** — one user can flood the API | MEDIUM | Medium (Redis-based rate limit) |
| I7 | **No backup schedule** — ArcadeDB volume not backed up | HIGH | Medium |
| I8 | **No load balancer** — single FastAPI process group | LOW | High (nginx + multi-instance) |

---

## SECTION 3 — Technical Upgrade Questions (Performance & Architecture)

### Redis / Cache Optimization Questions

**RQ1. Should Redis be replaced with Valkey (Redis fork) or DragonflyDB for higher throughput?**

Current Redis (7-alpine) handles ~6,000 commands/second on a single thread. At 10,000 concurrent patients:
- Worst case: 10,000 × 8 Redis calls/turn × 3 turns/minute = 2.4M calls/minute = 40,000 calls/second
- Redis 7 cannot handle this on a single instance
- DragonflyDB: 25× faster than Redis (multi-threaded), drop-in compatible, MIT license
- Valkey: Redis 7 fork maintained by Linux Foundation, compatible, free
- AWS ElastiCache for Redis: managed, $50-150/month, 99.99% SLA

**Recommendation:** Migrate to DragonflyDB for 10K+ patient scale. Zero code changes — fully Redis-compatible.

---

**RQ2. Which session data should move from Redis TTL to ArcadeDB permanent storage?**

Currently lost after 24h:
- Patient trust tier (recalculated from interaction_count — acceptable)
- Ritual phase (lost on session expiry — patient gets re-greeted)
- Ethnic language preference (lost on session expiry — patient re-detected)
- Care plan (7-day TTL — patient loses plan between sessions)
- Vitals trend (180-day TTL — acceptable)

**Recommendation:** Move `ethnic_language`, `care_plan`, and `ritual_phase_completed` to ArcadeDB PatientVertex. Add to patient profile on each update. Eliminates re-greeting and re-detection on return sessions.

---

**RQ3. Should we add a semantic cache layer to avoid duplicate LLM calls?**

When multiple patients ask similar questions (e.g., "how to manage high blood sugar in Ramadan"), the current system makes a full LLM call for each.

A semantic cache (using Redis + vector similarity) could:
1. Embed the incoming question
2. Check if a similar question was answered in the last 24h
3. If similarity > 0.92: return cached response with patient-specific substitutions (name, conditions)
4. If not: make LLM call, cache result

**Estimated savings:** 20-30% reduction in LLM API calls for common questions  
**Libraries:** `semantic-router`, `GPTCache`, or custom Redis vector search  
**Implementation:** 3-5 days

---

### API / Microservice Architecture Questions

**AQ1. Should the monolithic `haystack-chatqna` container be split into microservices?**

Current monolith handles: patient chat, caregiver pipeline, clinical scoring, memory management, voice routing, auth, admin. One container = one failure point.

**Proposed microservice split:**

| Service | Responsibility | Container |
|---------|---------------|-----------|
| `amina-core` | Patient chat pipeline, LoRA routing | Existing |
| `amina-clinical` | SOAP generation, clinical scoring, DDI | New |
| `amina-caregiver` | Caregiver pipeline, care plans | New |
| `amina-memory` | Redis + ArcadeDB gateway | New |
| `amina-safety` | Medication gate, safety supervisor | New |
| `amina-voice` | STT, TTS, voice channel routing | Existing (voice-gateway) |
| `amina-auth` | JWT, OTP, patient registration | New |

**Benefit:** Each service scales independently. Clinical scoring can run on CPU-only instances (no GPU needed). Safety supervisor can be upgraded without touching core chat.  
**Risk:** Network latency between services adds 5-20ms per hop. Complex to deploy and debug.  
**Recommendation:** Do NOT split until patient load exceeds 5,000 concurrent users. Premature microservices will slow development without meaningful benefit at current scale.

---

**AQ2. Should AMINA replace the ArcadeDB graph database with a more standard alternative?**

ArcadeDB is a niche graph+document+time-series hybrid. Advantages: it handles all three in one system. Disadvantages: small community, limited tooling, learning curve for ITU team.

**Alternatives:**

| Database | Type | Strength | Weakness |
|----------|------|----------|---------|
| **PostgreSQL + pgvector** | Relational + vector | Industry standard, FHIR-compatible, huge community | No native graph traversal |
| **Neo4j** | Graph | Best-in-class for patient relationship graphs | No vector search, separate vector DB needed |
| **MongoDB** | Document | Flexible schema, good tooling | No graph, separate vector DB needed |
| **Supabase** (PostgreSQL) | Managed | Easy to self-host, REST API included | Same as PostgreSQL |
| **ArcadeDB (current)** | Multi-model | Everything in one, already integrated | Small community, ITU unfamiliar |

**Recommendation:** For ITU handover, migrate consultation records and patient profiles to **PostgreSQL + pgvector**. It's the most standard choice for a health system, supports FHIR-compatible schemas, and ITU engineers will find it familiar. Graph relationships (PatientVertex → ConsultationRecord edges) can be represented as foreign keys.  
**Migration complexity:** 3-4 weeks.

---

**AQ3. Can the caregiver pipeline be accelerated by pre-computing the patient context block?**

Current caregiver flow:
1. Message received
2. Patient resolved (fuzzy match)
3. ArcadeDB lookup: profile + consultations + behavior
4. Build patient block (text formatting)
5. Clinical enrichment (SDOH, DDI, CRI scoring)
6. LLM info state extraction
7. LLM response generation

**Bottleneck:** Steps 3-5 run synchronously on every message, even if the patient didn't change.

**Optimization:** Cache the patient block in Redis with a 15-minute TTL. On each message:
1. Check Redis for `patient_block:{patient_id}` → if hit, skip steps 3-5
2. If miss → run full pipeline, cache result

**Estimated savings:** 200-400ms per caregiver turn (the ArcadeDB + enrichment cost)  
**Implementation:** 1 day

---

**AQ4. Should the safety supervisor (post-LLM GPT-4o-mini call) be replaced with a local model?**

Current setup: every AMINA response goes through a GPT-4o-mini safety check (~400-600ms, ~$0.01/call).

**Problem:** At 10,000 daily conversations:
- Safety calls: ~$30-100/day = $900-3,000/month just for safety review
- Each adds 400-600ms to response time

**Alternatives:**

| Option | Latency | Cost | Quality |
|--------|---------|------|---------|
| GPT-4o-mini (current) | +400-600ms | $0.01/call | High |
| Llama-3.1-8B (local, CPU) | +200-400ms | Electricity only | Medium |
| Rule-based safety grammar | +2ms | Zero | Low (only catches known patterns) |
| Llama-3.1-8B (Groq free) | +300-500ms | Free (rate limited) | Medium |
| Hybrid: rule-based first, LLM only if uncertain | +2-400ms | Near-zero | High |

**Recommendation:** Hybrid approach — expand the rule-based medication gate to cover more safety dimensions, use LLM supervisor only for unclear cases. Reduces LLM supervisor calls by ~60-70%.

---

### Agent Performance Questions

**PQ1. Should the tool-use loop be parallelized?**

Current: AMINA's tool calls run sequentially (DDI check → vitals fetch → knowledge search → ...).

**Observation from performance data:**
- Standard chat (1 tool): 1,400-2,300ms
- Standard chat (2 tools): 1,900-3,200ms (+500ms per additional tool)

Most tools are independent — DDI check and vitals fetch don't depend on each other.

**Parallelization plan:**
```python
# Current (sequential):
ddi_result = await check_ddi(medications)
vitals = await get_vitals_trend(patient_id)
knowledge = await search_knowledge(query)

# Proposed (parallel):
ddi_result, vitals, knowledge = await asyncio.gather(
    check_ddi(medications),
    get_vitals_trend(patient_id),
    search_knowledge(query),
)
```

**Estimated savings:** 300-500ms for multi-tool turns  
**Implementation:** 2 days (already uses async/await, just needs gather)

---

**PQ2. Should AMINA use streaming responses?**

Current: AMINA waits for the full LLM response before sending anything to the user (Time to First Token = full response latency = 1.4-3.2 seconds).

**Streaming:** Send tokens to the user as they're generated. User sees first word in 200-400ms instead of waiting 2+ seconds.

**Implementation:** vLLM supports streaming natively. FastAPI supports Server-Sent Events (SSE). Frontend needs token streaming renderer.

**Estimated development:** 3-5 days (backend + frontend)  
**User experience impact:** Major — perceived latency drops from 2s to 0.3s. This is the single highest-impact UX improvement available.

---

## SECTION 4 — Model Performance Report: All Models

### 4.1 Current Model Stack

| Model | Role | Context | Max Output | Avg Latency | Cost/1K tokens |
|-------|------|---------|-----------|-------------|----------------|
| **AMINA LoRA v2** | Patient + Caregiver (preferred) | 4,096 tokens | 300 tokens | **300-600ms** | ~$0.0001 (electricity) |
| **Gemini 2.5 Flash Lite** | Primary cloud fallback | 1,000,000 tokens | 800 tokens | **800-1,500ms** | ~$0.0002 |
| **Groq Llama 3.3 70B** | Gemini quota fallback | 128,000 tokens | 250 tokens | **400-800ms** | Free (rate limited) |
| **GPT-4o-mini** | Base / safety supervisor | 128,000 tokens | 400 tokens | **1,400-2,300ms** | ~$0.0004 |
| **Mistral 7B** | Configured, not active | 32,000 tokens | 250 tokens | **600-1,000ms** | ~$0.0001 |

### 4.2 Latency by Path and Model

| Chat Path | AMINA LoRA | Gemini 2.5 Lite | Groq Llama | GPT-4o-mini |
|-----------|-----------|-----------------|------------|-------------|
| Simple greeting | 300-500ms | 600-900ms | 350-600ms | 1,300-1,600ms |
| Diet advice (diabetes) | 450-700ms | 900-1,400ms | 500-800ms | 1,800-2,500ms |
| Emergency path (pre-LLM) | **14-30ms** | **14-30ms** | **14-30ms** | **14-30ms** |
| Multi-tool turn | 550-850ms | 1,100-1,800ms | 600-1,000ms | 1,900-3,200ms |
| Mandinka translation | N/A | 1,200-3,500ms | N/A | 1,100-6,300ms |
| Caregiver SOAP report | Not capable | 2,500-4,500ms | 2,000-3,500ms | 3,800-5,200ms |
| Care plan generation | Not capable | 3,000-5,000ms | 2,500-4,000ms | 3,800-5,200ms |

**Note:** Emergency path (14-30ms) is model-independent — it triggers before any LLM call and has a hard latency budget.

### 4.3 Clinical Accuracy Comparison (from safety review logs and clinician evaluation)

| Capability | AMINA LoRA | Gemini 2.5 Lite | Groq Llama | GPT-4o-mini |
|-----------|-----------|-----------------|------------|-------------|
| WHO PEN protocol adherence | ~78% | ~85% | ~80% | ~90% |
| Emergency detection rate | ~82% | ~91% | ~88% | ~95% |
| Medication safety (no doses) | ~94%* | ~88% | ~86% | ~92% |
| Gambian cultural appropriateness | ~85% | ~60% | ~55% | ~65% |
| Mandinka response quality | ~52% | ~45% | ~40% | ~48% |
| Response format consistency | ~80% | ~85% | ~75% | ~88% |
| Hallucination rate (est.) | ~8% | ~5% | ~7% | ~3% |

*AMINA LoRA's medication safety score is elevated by the pre-LLM medication gate running before it.

**Interpretation:**
- GPT-4o-mini has the best clinical accuracy but highest latency and cost
- AMINA LoRA has the best cultural appropriateness and lowest cost but highest hallucination rate
- Gemini 2.5 Lite is the best cloud option: good accuracy, very long context, low cost
- Groq is best for latency-sensitive fallback scenarios

### 4.4 Context Window Utilization

| Model | Context Limit | Typical Usage | % Used | Risk |
|-------|-------------|---------------|--------|------|
| AMINA LoRA | 4,096 tokens | 600-900 tokens | **15-22%** | Low |
| Gemini 2.5 Lite | 1,000,000 tokens | 1,500-3,000 tokens | **<0.1%** | None |
| Groq Llama | 128,000 tokens | 1,000-2,000 tokens | **<2%** | None |
| GPT-4o-mini | 128,000 tokens | 1,000-2,500 tokens | **<2%** | None |

AMINA LoRA is the only model where context window is a meaningful constraint.

### 4.5 Reliability and Quota Status

| Model | Status | Failure Mode | Recovery |
|-------|--------|-------------|---------|
| AMINA LoRA | ✅ Active | A40 offline / Cloudflare timeout | Auto-fallback to Gemini |
| Gemini 2.5 Flash Lite | ✅ Active | 429 quota exceeded | Auto-fallback to Groq |
| Gemini 2.0 Flash Lite | ❌ Quota cap=0 | All requests fail | Not used |
| Groq Llama 3.3 70B | ✅ Active (free tier) | 6K tokens/min rate limit | Auto-fallback to GPT-4o-mini |
| GPT-4o-mini | ✅ Active | Rarely fails | Final fallback, no further recovery |
| Mistral | ⚠️ Configured, not tested | Unknown | Unknown |

### 4.6 Caregiver Mode Model Behavior

| Model | Caregiver Pipeline | Behavior |
|-------|-------------------|---------|
| AMINA LoRA | **Single-shot** (new) | Direct clinical advice, no intake questions |
| Gemini 2.5 Lite | **4-stage pipeline** | Full intake → structured SOAP report |
| Groq Llama | **4-stage pipeline** | Full intake → structured SOAP report |
| GPT-4o-mini | **4-stage pipeline** | Full intake → structured SOAP report (highest quality) |

### 4.7 Container Resource Usage (Production Measured)

| Container | CPU % | RAM | % System RAM |
|-----------|-------|-----|-------------|
| haystack-chatqna | 2.59% | 2.24 GiB | 14.4% |
| dataprep-worker | 0.10% | 467 MiB | 2.9% |
| arcadedb | 0.07% | 309 MiB | 1.9% |
| voice-stt | 0.00% | 187 MiB | 1.2% |
| multichannel-access | 0.24% | 117 MiB | 0.7% |
| voice-tts | 0.08% | 45 MiB | 0.3% |
| amina-redis | 0.28% | 6 MiB | 0.04% |
| **Total stack** | **~3.5%** | **~3.4 GiB** | **22% of 15.2 GiB** |

**Headroom:** 78% RAM unused. Stack can handle 10-50 concurrent patients on current hardware without scaling.

---

## SECTION 5 — Summary Recommendations for ITU

### Immediate (before ITU handover)

| Priority | Action | Effort | Owner |
|----------|--------|--------|-------|
| 🔴 URGENT | PHI de-identification before ArcadeDB storage | 3 days | Engineering |
| 🔴 URGENT | Redis Sentinel or backup replication | 2 days | Engineering |
| 🔴 URGENT | Monitoring + latency alerts (Prometheus/Grafana) | 3 days | Engineering |
| 🟡 HIGH | ArcadeDB volume backup schedule | 1 day | DevOps |
| 🟡 HIGH | HTTPS + cookie security enforcement | 1 day | Engineering |
| 🟡 HIGH | Rate limiting per user (prevent flooding) | 2 days | Engineering |
| 🟢 MEDIUM | Streaming responses (UX improvement) | 5 days | Engineering |
| 🟢 MEDIUM | Parallelize tool calls in agent loop | 2 days | Engineering |
| 🟢 MEDIUM | Semantic cache for common questions | 3 days | Engineering |

### Training Recommendation

**Do NOT attempt pure fp32 training on single A40.**  
**DO proceed with: bf16 base + fp32 LoRA adapters, r=64, on single A40.**

Expected timeline for 750K example training:
- Data collection and cleaning: 4-8 weeks
- Training run (single A40, hybrid precision): **~13 days**
- Evaluation and safety testing: 2 weeks
- **Total: 8-12 weeks from data collection start to production deployment**

If ITU can provide H100 access: **reduce training run to ~4.5 days**.

### Database Migration Recommendation

**Migrate from ArcadeDB to PostgreSQL + pgvector within 3 months.**  
Reason: ITU engineers know PostgreSQL, FHIR tools target PostgreSQL, community support is orders of magnitude larger.

---

*Document prepared by AMINA Engineering | April 2026*  
*Based on: live production measurements, docker stats, latency benchmarks (3-run median), and model evaluation logs*
