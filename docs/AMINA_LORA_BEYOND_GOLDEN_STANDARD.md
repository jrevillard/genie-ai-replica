# AMINA-LoRA — Beyond the Golden Standard

**Strategic roadmap and competitive analysis**

**Document version:** 1.0
**Published:** April 2026
**Owner:** AMINA Engineering
**Purpose:** Reference document for planning AMINA-LoRA's fine-tuning and capability roadmap. Used when deciding what to build, in what order, and why.
**Status:** Plan — not yet in execution. Do not start implementing any item without explicit sign-off.

---

## 0. How to use this document

This is the **single source of truth** for where AMINA-LoRA stands, where it's going, and which items are worth pursuing. When we start building, we pick a Tier from Section 5, reference the item numbers (1.1, 2.3, 3.7, etc.), and cross back here for rationale.

Related documents:
- [AMINA_LORA_TECHNICAL_DOCUMENT.md](AMINA_LORA_TECHNICAL_DOCUMENT.md) — current model architecture, training config, pipeline
- [ITU_TECHNICAL_BRIEF_APRIL2026.md](ITU_TECHNICAL_BRIEF_APRIL2026.md) — ITU-facing questions, fp32 viability, upgrade questions
- [DHIS2_INTEGRATION.md](DHIS2_INTEGRATION.md) — Phase 1+2.1–2.3 DHIS2 integration spec
- [WHO_SMART_GUIDELINES_IG.md](WHO_SMART_GUIDELINES_IG.md) — FHIR Implementation Guide

---

## 1. Executive summary

AMINA-LoRA is a Mistral-7B fine-tune for Gambia community health. It beats IBM, Microsoft, and Hippocratic AI on **cultural grounding**, **LMIC deployment cost**, and **open-source transparency**, but trails them on **real patient data**, **clinician review**, and **formal safety validation**.

**Three-tier roadmap:**

| Tier | Goal | Effort | Outcome |
|:---:|---|:---:|---|
| **🥉 Tier 1** | Catch up to parity — close gaps that matter | 3-4 months | Clinician-validated, published safety eval, formal constitution, regulatory-ready |
| **🥈 Tier 2** | Match the golden standard — add missing capabilities | 6-9 months | Multi-agent architecture, Mandinka voice, 14B-24B base, active learning |
| **🥇 Tier 3** | Beyond the golden standard — capabilities no competitor has | 9-18 months | Offline-first, outbreak detection, global good reference implementation |

**Recommended starting path:** Tier 1 immediately, in parallel with one Tier 3 item (**3.9 — WHO SMART Guidelines reference implementation**, because it's nearly free and has huge strategic upside). Tier 2 waits until Tier 1 unlocks regulatory credibility and budget.

---

## 2. State of AMINA-LoRA today

### 2.1 Model snapshot

| Dimension | Current value |
|-----------|---------------|
| **Base model** | Mistral-7B-Instruct-v0.3 |
| **Fine-tune method** | LoRA r=32, α=64, 7 projection modules |
| **Trainable parameters** | 83.8M (1.16% of 7.24B total) |
| **Training data** | 145,000 synthetic examples |
| **Training pipeline** | SFT (3 epochs) + DPO (1 epoch), bf16 precision |
| **Dataset composition** | SFT single-turn + SFT multi-turn + DPO preference pairs + Mandinka single-turn + Mandinka conversations |
| **Trained context length** | 2,048 tokens |
| **Served context length** | 8,192 tokens (via vLLM RoPE extrapolation + context compactor) |
| **Inference backend** | vLLM on NVIDIA A40 via Tailscale Funnel (24/7 live) |
| **Typical latency** | 300–600 ms simple / 550–850 ms multi-tool |
| **Safety stack** | Pre-LLM medication gate + post-LLM GPT-4o-mini supervisor |
| **Fallback chain** | LoRA → Gemini 2.5 Flash Lite → Groq → GPT-4o-mini |
| **Languages** | English (strong) + Mandinka (25K examples, weak) |
| **Clinical protocol** | WHO PEN (Protocols 1–5) + Gambia NCD Strategy 2022-2027 |
| **Integrations** | DHIS2 (aggregate + Tracker + Android offline) · FHIR R4 dual-coded (ICD-10 + SNOMED) · ICD-10 coder · Consent management · PHI de-identification · Context compactor across all models |
| **Monthly cost** | ~$150 electricity (A40), $0 API (LoRA path) |
| **Deployment** | Self-hosted, no vendor lock-in |

### 2.2 Critical gaps in the current state

| Gap | Severity | Why it matters |
|-----|:---:|----------------|
| **100% synthetic training data** | HIGH | Model has never seen real Gambian CHW–patient speech; learns synthetic-data artifacts |
| **0 clinicians in the loop** | HIGH | No human labeller = no RLHF quality lift = ceiling on clinical accuracy and safety |
| **0 formal safety evaluations** | HIGH | No benchmark score to show ITU / Gambia FDA / WHO / MoH |
| **Single-agent architecture** | MEDIUM | One LoRA handles NCD, MCH, MH, emergencies — no specialization |
| **No active learning loop** | MEDIUM | Model doesn't improve from caregiver corrections or CHW feedback |
| **Weak voice-first for Mandinka** | MEDIUM | STT/TTS exists but is English-first |
| **7B ceiling for complex reasoning** | MEDIUM | Base model size limits depth on multi-condition cases |
| **No regulatory submission** | MEDIUM | Can't legally deploy to Gambia public health system without it |

### 2.3 AMINA's moats (things the big 3 will never do)

- **Mandinka linguistic depth.** No commercial incentive for IBM/Microsoft/Hippocratic to train on this language.
- **Gambia cultural grounding.** Ramadan fasting, moringa use, benachin meals, EFSTH referral, Alkallo communication norms.
- **LMIC deployment cost.** ~$150/month electricity vs. $30K–$300K/yr enterprise contracts.
- **Offline-first viability.** None of the big 3 run without cloud internet.
- **DHIS2 native integration.** Only one of the four that integrates with the standard LMIC Health Information System platform.
- **Full source-code transparency.** Reproducible, auditable, forkable.

---

## 3. Competitive comparison — 12 dimensions

Rating scale: ⬛⬛⬛⬛⬛ (5 = best in class, 1 = weak or absent)

| # | Dimension | IBM ACD / Merative | Microsoft DAX / Nuance | Hippocratic AI Polaris | AMINA-LoRA |
|---|-----------|:---:|:---:|:---:|:---:|
| 1 | **Training data scale** | ⬛⬛⬛⬛⬛ (millions of real records) | ⬛⬛⬛⬛⬛ (proprietary DAX recordings) | ⬛⬛⬛⬛ (constellation models, synthetic + real) | ⬛⬛ (145K synthetic only) |
| 2 | **Clinician in the loop** | ⬛⬛⬛⬛ (clinical SMEs) | ⬛⬛⬛⬛⬛ (Nuance clinician network) | ⬛⬛⬛⬛⬛ (1000+ nurse reviewers) | ⬛ (none yet) |
| 3 | **Safety validation** | ⬛⬛⬛⬛ (HIPAA, clinical trials) | ⬛⬛⬛⬛⬛ (FDA 510k on some products) | ⬛⬛⬛⬛⬛ (safety constitution + RLHF) | ⬛⬛ (med gate + LLM supervisor) |
| 4 | **Clinical vocabulary depth** | ⬛⬛⬛⬛⬛ (UMLS + SNOMED + RxNorm + ICD-10) | ⬛⬛⬛⬛ (SNOMED + ICD via backend) | ⬛⬛⬛ (not publicly documented) | ⬛⬛⬛ (60+ ICD-10 + SNOMED + LOINC crosswalk) |
| 5 | **EHR / HIS integration** | ⬛⬛⬛⬛ (Epic, Cerner via FHIR) | ⬛⬛⬛⬛⬛ (Epic native, ambient to EHR) | ⬛⬛⬛ (REST API + SaaS) | ⬛⬛⬛⬛ (DHIS2 bi-directional + FHIR R4 dual-coded) |
| 6 | **Real-time conversational** | ⬛ (batch NLP) | ⬛⬛⬛⬛ (ambient transcription, not dialogue) | ⬛⬛⬛⬛⬛ (conversational, non-diagnostic) | ⬛⬛⬛⬛ (conversational, WHO PEN-guided) |
| 7 | **Cultural / linguistic adaptation** | ⬛ (EN / ES) | ⬛⬛ (EN + some EU) | ⬛ (English only) | ⬛⬛⬛⬛⬛ (Gambian, Mandinka, Ramadan, moringa, Alkallo) |
| 8 | **LMIC accessibility** | ⬛ (enterprise only) | ⬛ (enterprise only) | ⬛⬛ (SaaS only) | ⬛⬛⬛⬛⬛ (self-hosted, $0 API, offline-capable) |
| 9 | **Model transparency** | ⬛ (closed) | ⬛ (closed) | ⬛ (closed) | ⬛⬛⬛⬛⬛ (open source + reproducible) |
| 10 | **Multi-agent orchestration** | ⬛⬛ (pipeline modules) | ⬛⬛⬛⬛ (healthcare-agent-orchestrator) | ⬛⬛⬛⬛⬛ (specialist constellation) | ⬛⬛ (single agent with tool calls) |
| 11 | **Voice / ambient capture** | ⬛ (text only) | ⬛⬛⬛⬛⬛ (DAX is literally ambient) | ⬛⬛⬛ (phone-call ready) | ⬛⬛ (Whisper + Bark, English-first) |
| 12 | **Regulatory track record** | ⬛⬛⬛⬛ (HIPAA) | ⬛⬛⬛⬛⬛ (FDA 510k) | ⬛⬛⬛ (non-diagnostic classification) | ⬛ (no submission yet) |

### 3.1 Summary

- **AMINA already wins on dimensions 7, 8, 9** (cultural, LMIC, open source).
- **AMINA ties on dimension 5** (integration — DHIS2 native is a peer move to Epic native).
- **AMINA trails on 1, 2, 3, 4, 6, 10, 11, 12.**

Of the 8 dimensions AMINA trails on, some are fixable (real data, clinician review, safety eval, multi-agent, regulatory) and some don't matter (vocabulary depth via UMLS licensing cost, enterprise integrations outside LMIC context).

### 3.2 Gaps that don't matter (strategic distinction)

- **Scale of corpus.** The big 3 trained on millions of US-centric clinical docs, which are mostly irrelevant to Gambia PEN care. More data ≠ more useful in this context.
- **FDA 510k clearance.** Gambia MoH is the regulatory body that matters for AMINA's deployment; FDA is irrelevant.
- **Enterprise SaaS pricing.** AMINA's entire value proposition is self-hostable.

---

## 4. Gap analysis — fixable vs. not

| Gap | Fixable? | Path |
|-----|:--------:|------|
| No real patient data | Yes | MoH data-sharing agreement + de-id pipeline (already built) |
| No clinician in the loop | Yes | Recruit 8–15 Gambia CHWs + 2–3 nurses + 1–2 WHO consultants |
| No formal safety eval | Yes | Design / adopt WHO PEN compliance benchmark |
| Single-agent architecture | Yes | Split into specialist LoRAs sharing a base |
| No active learning loop | Yes | Wire caregiver corrections back into training queue |
| Weak voice-first Mandinka | Yes | Fine-tune Whisper-medium + Coqui XTTS on native speaker corpus |
| 7B ceiling | Partly | Move base model to Mistral-Small-24B or Qwen-2.5-14B |
| No regulatory submission | Yes | Compile dossier and file with Gambia FDA |

Every gap is fixable. Roadmap below.

---

## 5. Roadmap — three tiers

### 🥉 Tier 1 — Catch up to parity (3-4 months)

**Goal:** Close the gaps that currently make AMINA look amateur next to Hippocratic's safety posture and IBM's coding depth.

| # | Item | Effort | Unlocks |
|---|------|:------:|---------|
| **1.1** | **Clinician review panel** — recruit 8–15 Gambia CHWs + 2–3 EFSTH nurses + 1–2 WHO consultants. Structured onboarding, NDA, review UI. | 3 weeks | Ground-truth labels, preference pairs, safety review |
| **1.2** | **RLHF data pipeline** — collect 5–10K preference pairs (chosen vs. rejected responses) from the panel via a simple review UI. | 6 weeks rolling | Replaces synthetic DPO pairs with human ones |
| **1.3** | **750K dataset upgrade** — 145K synthetic + 300K de-identified real + 300K active-learning-collected | 4–8 weeks data prep | Training corpus matches the ITU brief plan |
| **1.4** | **bf16 + fp32 LoRA hybrid retrain** at r=64 on the 750K corpus | ~13 days GPU on a single A40 (or ~4.5 days on H100) | Quality lift over r=32 bf16 |
| **1.5** | **WHO PEN compliance eval harness** — 200 test cases scoring adherence to each WHO PEN protocol step (triage + intake + management + referral) | 2 weeks | First formal benchmark AMINA can report |
| **1.6** | **Safety constitution** — a 15–20 rule AMINA Care safety charter (no doses, emergency escalation, cultural respect, privacy, consent) | 1 week | Gives regulators a document to review |
| **1.7** | **Safety DPO layer** — train DPO with the constitution's preferences against adversarial prompts | 2 weeks | Formal safety tune, measurable |
| **1.8** | **Technical report** — whitepaper documenting dataset, training, eval, safety for ITU/WHO/MoH review | 2 weeks | Credibility + foundation for regulatory dossier |

**End state after Tier 1:**
AMINA has clinician-validated training data, a published safety eval, a formal safety constitution, a WHO PEN compliance score, and a technical report. It is **on par with what Hippocratic Polaris publicly shows**, with Gambia-specific grounding that Hippocratic can't match.

---

### 🥈 Tier 2 — Match the golden standard (6-9 months)

**Goal:** Add the architectural + capability pieces the big 3 have that matter to clinical users.

| # | Item | Effort | Unlocks |
|---|------|:------:|---------|
| **2.1** | **Multi-agent architecture** — split the single LoRA into **Intake Agent**, **NCD Specialist**, **MCH Specialist**, **Mental Health Agent**, **Emergency Triage Agent**, **Pharmacist Agent**. Each is its own LoRA fine-tune sharing base weights. | 6–8 weeks | Matches Hippocratic constellation + Microsoft orchestrator |
| **2.2** | **Ambient conversation mode** — Whisper-large-v3 for Mandinka + speaker diarization → running SOAP note generation | 4–6 weeks | Matches Microsoft DAX for LMIC settings |
| **2.3** | **Mandinka Whisper fine-tune** — start from Whisper-medium, fine-tune on 500h Mandinka audio (Gambian radio broadcasts + CHW visit transcripts) | 8 weeks + data collection | No competitor has this |
| **2.4** | **Mandinka TTS fine-tune** — Coqui XTTS v2 or Bark fine-tune on native speaker corpus | 6 weeks | Voice-first parity with English systems |
| **2.5** | **Scale base model to Mistral-Small-24B or Qwen-2.5-14B** — retrain LoRA on the larger base | ~3 weeks (compute-intensive) | Closes 7B reasoning ceiling |
| **2.6** | **Active learning loop** — CHW corrections in the caregiver portal feed back into a training queue, retrain every N corrections | 4 weeks (infra) + continuous | Self-improving model |
| **2.7** | **Clinical vocabulary expansion** — ICD-10 crosswalk from 60 → 500 codes; full SNOMED CT primary care subset | 4 weeks | Matches IBM ACD vocabulary depth for primary care |
| **2.8** | **Regulatory dossier** — compile safety eval + clinical validation + data governance into a Gambia FDA SaMD submission package | 6–8 weeks | First regulatory filing for AMINA |

**End state after Tier 2:**
AMINA is architecturally and functionally comparable to Hippocratic Polaris and Microsoft DAX, but **specialized for LMIC primary care and self-hostable**.

---

### 🥇 Tier 3 — Beyond the golden standard (9-18 months, research-grade)

**Goal:** Capabilities no competitor has. Not all items are required — pick 2–3 moonshots to prioritize.

| # | Moonshot | Why "beyond" | Rough effort |
|---|----------|--------------|:---:|
| **3.1** | **On-device AMINA-Q4** — llama.cpp 4-bit quantized (≈4 GB), runs on $50 Android handsets with zero internet | No big 3 can run without cloud | 2–3 months |
| **3.2** | **Outbreak detection layer** — real-time symptom clustering (dengue, cholera, measles, COVID-like) → DHIS2 surveillance alerts | IBM does batch NLP, not real-time outbreak ML | 2–3 months |
| **3.3** | **Predictive NCD forecasting** — ML model forecasts next-month hypertension / diabetes caseloads per region → published to DHIS2 dashboard tile | Nobody pushes forecasts INTO the HIS | 2 months |
| **3.4** | **Voice-first DHIS2 reporting** — CHW speaks Mandinka → STT → ICD-10 coder → DHIS2 Tracker event in one pipeline | Unique LMIC capability | 3 months (after 2.3) |
| **3.5** | **Digital twin of CHW panels** — behavioral model per CHW predicting burnout + intervention suggestions | No workforce analytics competitor at this layer | 3 months |
| **3.6** | **Real-time emergency dispatch bridge** — EMERGENCY triage → ambulance API + SMS + DHIS2 event in < 10 seconds | Measurable lives-saved metric | 6 weeks |
| **3.7** | **FHIR Bulk `$export`** — research-grade de-identified cohort export for academic partnerships | First open-source LMIC health AI with bulk export | 4 weeks |
| **3.8** | **Semantic query over DHIS2 + AMINA** — GraphQL facade with embedding search: "patients with uncontrolled BP in URR not seen in 30 days" | Impossible in stock DHIS2, impossible in stock Hippocratic | 2 months |
| **3.9** | **WHO SMART Guidelines reference implementation** — open source AMINA as a WHO Digital Square global good; other LMICs reuse it | Strategic differentiation — global health credibility | 3 weeks (mostly repackaging) |
| **3.10** | **Wearable / IoT via Open mHealth** — BP cuffs, glucometers, pulse oximeters → AMINA → DHIS2 observations | Ready for MoH device distribution programs | 6 weeks |

**End state after Tier 3:**
AMINA is no longer directly comparable to the big 3 — it becomes **a different category of product**. It's the reference implementation for community-health AI in any LMIC, with publishable research on voice-first Mandinka care, outbreak detection, and offline-first deployment. This wins ITU/WHO credibility and positions AMINA as a global good.

---

## 6. Resource requirements per tier

| Tier | Data collection | GPU hours | Wall time | Cost (USD) | Risk | Team size |
|:---:|-----------------|:---:|:---:|:---:|:---:|:---:|
| **Tier 1** | 300–500K real records + 5–10K preferences (needs MoH data-sharing agreement) | ~320h on A40 (~13 days) | 3–4 months | $5–15K (data + compute + panel honoraria) | Low–Medium | 2 eng + 1 clinical lead + 1 data ops |
| **Tier 2** | 500h Mandinka audio + specialist curation per agent | ~800–1,200h on H100 | 6–9 months | $40–80K (H100 rent + audio data + expanded panel) | Medium | 3 eng + 2 clinical + 1 data ops |
| **Tier 3** | Varies per moonshot | Varies | 9–18 months | $80–300K per 2–3 items | High (research-grade) | 5 eng + 3 clinical + research partner |

### 6.1 Hardware cost scenarios (for reference)

| GPU | Hourly rent | Total for Tier 1 training (~320h) | Total for Tier 2 (1,200h) |
|-----|:---:|:---:|:---:|
| Single A40 (local, electricity only) | ~$0.20 | $64 | $240 |
| A40 cloud (RunPod / Lambda) | ~$0.35–0.60 | $112–192 | $420–720 |
| A100 80GB (cloud) | ~$1.20–1.80 | $384–576 | $1,440–2,160 |
| H100 80GB (cloud) | ~$2.50–3.50 | $800–1,120 | $3,000–4,200 |

Owning the A40 already means Tier 1 compute cost is **electricity only**.

---

## 7. Strategic recommendation

### 7.1 The priority path

**Start Tier 1 immediately, in parallel with Tier 3 item 3.9** (WHO SMART Guidelines open-source reference implementation).

**Rationale:**

1. **Only Tier 1 unlocks regulatory credibility.** Without real patient data, clinician review, and a safety eval, AMINA cannot be submitted to Gambia FDA or presented to WHO/ITU as a deployable system. Tier 2 and Tier 3 both depend on Tier 1's credibility lift for funding.

2. **Tier 3.9 is nearly free and has huge strategic upside.** It's mostly repackaging what we already built (DHIS2 integration + FHIR IG + ICD-10 coder). But it positions AMINA as a **global good** rather than "another African LLM experiment." That framing matters for ITU and WHO meetings.

3. **Tier 2 waits** until Tier 1 + 3.9 unlock regulatory credibility and budget.

### 7.2 What NOT to do

- **Don't start with a bigger base model.** Mistral-7B is fine for the current data scale. Only move to 14B–24B after real patient data + RLHF exhaust the 7B ceiling.
- **Don't try to match IBM on vocabulary depth.** UMLS licensing is expensive and UMLS's value for LMIC primary care is limited. WHO PEN + the 60-code ICD-10 crosswalk + SNOMED subset we already have is sufficient.
- **Don't pursue Microsoft DAX parity (English ambient transcription) until Mandinka Whisper works.** English ambient mode is a commodity; Mandinka is the unique angle.
- **Don't announce AMINA as "the next Hippocratic" or "Africa's DAX".** Position it as **the open-source WHO SMART Guidelines reference implementation** — that framing avoids direct competition and invites collaboration.

---

## 8. Decision points — needed before execution starts

Before any code is written against this roadmap, decisions needed on:

1. **Which tier to execute first?** (Recommendation: Tier 1 + Tier 3.9 in parallel)
2. **Which 2–3 Tier 3 moonshots interest you?** (Recommendation: 3.1 offline + 3.4 voice Mandinka + 3.9 global good)
3. **Is the MoH data-sharing agreement realistic on a 3-month timeline?** (Tier 1 depends on it — fallback: start with more synthetic + clinician-authored examples)
4. **Do we have access to Gambian CHWs for a review panel?** (Tier 1 depends on this)
5. **Is there budget for H100 compute in Tier 2?** (If no, Tier 2 stretches to 9–12 months on A40)
6. **Who owns clinical sign-off?** (Need a named clinical lead for any ITU/Gambia FDA submission)
7. **Do we file Gambia FDA during Tier 1 or wait for Tier 2?** (Recommendation: file during Tier 2 with full dossier)

Once a tier and items are agreed on, the next document to produce is a **concrete build plan**: file-by-file, week-by-week, which items block which, which can run in parallel. That plan is not written yet — this document stops at strategic intent.

---

## 9. Appendix — source materials

### 9.1 What I referenced when writing this

- **AMINA current state**: [AMINA_LORA_TECHNICAL_DOCUMENT.md](AMINA_LORA_TECHNICAL_DOCUMENT.md), [ITU_TECHNICAL_BRIEF_APRIL2026.md](ITU_TECHNICAL_BRIEF_APRIL2026.md)
- **IBM Watson Health / Merative**: IBM Annotator for Clinical Data (ACD), UIMA pipeline, UMLS/SNOMED integration, 2022 Francisco Partners acquisition
- **Microsoft DAX / Nuance**: Nuance Dragon Ambient eXperience, 2022 Microsoft acquisition, GPT-4-based SOAP generation, Epic native integration, partial FDA 510k
- **Hippocratic AI Polaris**: constellation of specialist models, 1000+ clinician reviewer panel, safety constitution, non-diagnostic classification, phone-call-ready deployment
- **Context cutoff**: Information about these three vendors is from public sources through August 2025. Verify any specific vendor claims before citing in external documents.

### 9.2 What I deliberately did NOT include

- Specific dollar contracts with IBM/Microsoft/Hippocratic clients (not publicly available)
- Exact Hippocratic Polaris architecture (not published)
- Microsoft DAX fine-tuning recipes (proprietary)
- Any claim about AMINA's clinical accuracy vs. the big 3 (no benchmark exists yet — that's Tier 1.5)

---

## 10. Change log

| Version | Date | Change |
|:---:|:---:|---|
| 1.0 | 2026-04-14 | Initial strategic roadmap published. Three-tier plan, competitive comparison, decision points. |

---

*AMINA Care Programme · Ministry of Health, Republic of The Gambia · April 2026*
