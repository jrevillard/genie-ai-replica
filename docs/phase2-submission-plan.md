# Phase 2 prototype — submission plan

**Status:** living document
**Last updated:** 2026-05-16

## 1. What we promised (from `Promised_Project_Submission_Docs/Young AI Leaders Linz HubPacket.pdf`)

Phase 1 was the narrative application (already submitted). Phase 2 is
the working prototype — code in the GENIE.AI GitLab repo under
Apache 2.0 / MIT, demonstrating a multi-channel NCD chatbot for The
Gambia. The evaluation rubric in the application form weights:

| Section | % |
|---|---|
| Team Background (B) | 15 |
| Solution Concept (C) | 15 |
| **Solution Design (D)** — Framework Extension (20%) + Architecture (20%) | **40** |
| **Implementation & Risk (E)** — Impact (5) + Collaboration (5) + Tech Impl (10) + Risk Mitigation (5) | **25** |

≈ **65 % of the score is what the prototype actually demonstrates.**

### 1.1 Framework extensions claimed (D.1, 20 %)

1. **Mobile application development** — iOS + Android native
2. **STT and TTS modules** in English (Gambian variant)
3. **Primary integration with WhatsApp** (Meta Cloud API)
4. **Time-Series Data Tracker** — headless backend, reusable for any
   time-series data
5. **User Feedback Module** — configurable ratings, persisted with
   chat transcripts for future RLHF
6. **Fully modular architecture** — clear separation, reusable across
   GENIE.AI applications

### 1.2 Architecture components claimed (D.2, 20 %)

1. **RAG Ingestion Pipeline** — ingest WHO Hypertension Treatment
   Guide, WHO HEARTS, WHO Mental Health Gap Action Programme, WHO
   Implementation Manual for Psychological Interventions, ASAM
   Clinical Guidelines for Alcohol Use Disorder, BHBM (Doing What
   Matters in Times of Stress, mActive, mBreathe Freely, mCervical
   Cancer, mDiabetes) message libraries, info on Gambian healthcare
   services
2. **LLM-generated + human-checked derived patient documents** —
   per-NCD patient FAQs, fictive patient chats, "if-then" rules,
   risk-assessment questionnaire
3. **Chatbot** — BGE-m3 embedding + bge-reranker-v2-m3 reranker,
   healthcare-expert system prompt, citation behaviour, risk-
   assessment mode, MCP tool calling for GovStack-compliant services
4. **STT/TTS** — open-source models, validated on Gambian English
5. **Vital Data & Habit Tracking** — Django + PostgreSQL backend,
   time series for BP, tobacco, mood, weight, habits; also stores
   patient profile (gender, DOB, height, region, per-condition risk
   status)
6. **User Feedback Module Backend** — Django
7. **WhatsApp Bot Backend** — Django + WhatsApp Cloud API
8. **Mobile Application** — SwiftUI (iOS) + Jetpack Compose
   (Android) with: login/registration incl. SSO, chat (with voice
   messaging and read-aloud), chat templates (anamnesis,
   condition-specific starters, GovStack-service starters),
   scheduled push notifications (server-initiated, pre-fetched for
   offline delivery), vitals/habits/mood tracking, data + chart
   export for medical check-ups, Apple Health and Google Fit
   integration, rewards/streaks per focus area / risk class,
   settings (push schedule)
9. **Testing & Evaluation** — LLM-as-a-judge with an array of
   different LLMs

### 1.3 Other commitments (E.3, 10 %)

- Backend: Python (Django) + PostgreSQL canonical store
- LLM: Granite 3.3 8B with a citation LoRA adaptor; LangChain
  orchestration
- DevOps: Docker + GitHub Actions CI/CD → AWS ECS/Fargate
- Observability: Prometheus/Grafana + Sentry
- Storage: S3-compatible + RDS
- Security: encryption at rest/in transit, role-based access,
  consent-driven data collection, retention policies, PII minimisation
- Pilot UAT in The Gambia (STT/TTS checks with native speakers)
- Accessibility: WCAG + WCAG Mobile

---

## 2. Current state (2026-05-16)

| # | Component | Promised | Current state | Gap |
|---|---|---|---|---|
| 1 | RAG Ingestion Pipeline | ~7 NCD documents + Gambia health-services info | Only **WHO Tobacco PDF** is indexed end-to-end. WHO Hypertension, BHBM mHypertension, BHBM mTobaccoCessation, Gambia NCD Policy, Gambia cessation guidelines are sitting in `/Users/peter/git/GenieAI_RAGDocuments/IEEE/` — not ingested. WHO HEARTS, Mental Health Gap, ASAM Alcohol, BHBM mActive/mBreathe/mDiabetes/mCervical, Gambia healthcare-services info — **not even sourced**. | **Major — ingestion of ~10 documents missing** |
| 2 | LLM-generated derived patient documents | Patient FAQs / fictive chats / if-then rules per NCD | **Not started.** This is exactly the medicine for the audience-mismatch problem the LLM-as-a-judge just surfaced (clinician-targeted chunks producing patient-unfriendly answers). | **Critical — needed for evaluation quality** |
| 3 | Chatbot (retrieval stack) | BGE-m3 + bge-reranker-v2-m3 | bge-base-en-v1.5 in vLLM. **Not migrated to m3.** Reranker exists but threshold tuning is on a stale model. | **Important — claimed in submission** |
| 3 | Chatbot (MCP tool calling) | MCP-callable tools for GovStack services + vitals tracker | **Not implemented.** | **Important — claimed in submission** |
| 4 | STT/TTS | Whisper/Vosk + Coqui TTS, Gambian English-tuned | **Not implemented** in any client or backend. Only constants `ASR=5`, `TTS=6` exist. | **Major** |
| 5 | Vital Data & Habit Tracking backend | Django + PostgreSQL | **Not implemented.** No `components/vitals-tracker` directory. | **Major** |
| 6 | User Feedback Module backend | Django | **Not implemented.** No feedback UI in apps, no backend. | **Major** |
| 7 | WhatsApp Bot backend | Django + Meta Cloud API | **EXISTS** at `/Users/peter/git/GenieAI_whatsapp_bot` but in **Node.js/TypeScript** (not Django). Has PRD, partial src layout (`routes/services/workers/`), Meta test number is wired up (per memory). State of end-to-end conversation flow needs verification. | **Verify + finish** |
| 8a | Mobile — SwiftUI iOS | Login + chat + voice + read-aloud + templates + push + vitals + chart export + Apple Health + rewards + settings | **~50 % complete.** Done: login (OIDC PKCE), chat, offline RAG, theme/locale, settings, offline library download, Liquid Glass UI. Missing: voice messaging, TTS read-aloud, chat templates (anamnesis / condition starters / GovStack), push notifications, vitals tracking UI + storage, data/chart export, Apple Health integration, rewards/streaks. | **Major** |
| 8b | Mobile — Jetpack Compose Android | Same as iOS | **~15 % complete** — 53 `.kt` files, basic app shell with AuthViewModel, ThemeViewModel, UserProfileViewModel. No chat UI, no offline RAG, no integrations. | **Critical — claimed as deliverable** |
| 9 | LLM-as-a-judge testing | "Array of LLMs different from Granite" | **DONE.** Harness in `tests/llm-judge/`, both pipelines, 29 cases, transcript dumps, 6-axis structured-output rubric (gpt-4o-mini). Findings written up in `tests/llm-judge/FINDINGS.md`. | ✅ |
| – | Cloud deployment | AWS ECS/Fargate | Currently Docker Swarm on a single VPS (`164.52.198.148`). | Deferred — submission likely OK with current deployment as long as code/compose is portable. |
| – | Observability | Prometheus + Grafana + Sentry | Not deployed. | Deferred unless reviewers ask. |
| – | CI/CD | GitHub Actions | Need to verify per-component CI status. | Verify. |
| – | Accessibility | WCAG + WCAG Mobile | Not audited. | Light audit before submission. |

### 2.1 What's strong right now

- Server-side RAG pipeline works end-to-end on the WHO tobacco
  corpus, with grounded citations and category-prompt extensions.
- iOS app has a full functional chat experience, OIDC PKCE login,
  and a working offline RAG path with Gemma 2 2B on-device.
- LLM-as-a-judge testing exists and produces actionable reports
  (87 % web / 73 % mobile on real patient prompts after the rubric
  fix).
- Codebase is well-modularised: server services are separate Docker
  containers, mobile apps are separate platform projects, common
  config in `configs/` and `deploy/ansible/`.

### 2.2 What's weak / risky right now

- **Single-document corpus** — almost every claim in the
  submission about NCD breadth (hypertension, mental health,
  diabetes, etc.) is unrepresented in retrieval today.
- **Mobile Android is a skeleton** — the submission explicitly
  promises both iOS and Android native apps. A reviewer who opens
  the Android project will find no chat.
- **Two big "claimed but missing" extensions:** STT/TTS and the
  vitals/habits tracker. Either of those, demoed, would be a
  visible differentiator. Both missing weakens the score on D.1.
- **Audience mismatch in answers** — the most recent LLM-as-a-judge
  run (`reports/20260516-064837/transcripts/`) shows the chatbot
  parroting clinician-targeted phrasing ("the document discusses…",
  "moderate certainty evidence") when answering lay patients.
  Partially addressed in the latest prompt push but not yet
  validated end-to-end.
- **Submission deadline is unknown to me** — the HubPacket doesn't
  state it. Needs confirming with the YAIL hub coordinator (Jan
  Korytar) before anyone can size the plan against time.

---

## 3. Prioritised plan to submission

Three tiers below: must-have before submission to claim credit on
the deliverables we wrote down, should-have to strengthen the
evaluation, nice-to-have polish.

The implicit ordering is **demo > prose**: a reviewer who sees a
working WhatsApp + iOS demo with multi-NCD answers will score the
prototype higher than one who reads a perfect README with a stub
demo. Optimise for what works end-to-end on demo day.

### 3.1 MUST-have (block submission if missing)

| # | Work item | Why | Owner suggestion | Rough size |
|---|---|---|---|---|
| M1 | **Ingest the remaining NCD documents we have.** Run the dataprep pipeline on: WHO Hypertension Treatment Guide, BHBM mHypertension, BHBM mTobaccoCessation, Gambia NCD Policy 2012-2016, Gambia cessation guidelines 2016. All sit in `/Users/peter/git/GenieAI_RAGDocuments/IEEE/` already. | Single biggest patient-quality lever per the LLM-judge run. Without it, every NCD claim in the submission is unsupported in the demo. | Jan (RAG owner) | 1-2 days |
| M2 | **Source + ingest the missing docs:** WHO HEARTS, WHO Mental Health Gap Action Programme, WHO Implementation Manual for Psychological Interventions, ASAM Clinical Guidelines for Alcohol Use Disorder, BHBM mActive/mBreathe Freely/mCervical Cancer/mDiabetes, info on Gambian healthcare services. | Same reason as M1 — they're named in the submission. | Jan | 2-3 days |
| M3 | **Derived patient documents pipeline (subset).** A scripted dataprep step that takes each clinical document and produces a patient-facing FAQ summary using an LLM, gated by manual review. At minimum: tobacco-cessation FAQ + hypertension FAQ to demo the concept. Re-index alongside the originals; rerank should prefer the patient versions when audience-appropriate. | Directly fixes the audience-mismatch problem the LLM-judge run surfaced. Also a literal promise in section D.2. | Jan + Peter | 2-3 days |
| M4 | **Android Compose: chat MVP.** A working chat screen on Android backed by the same backend route the iOS app uses. Login via OIDC, send/receive messages, display sources. Doesn't need feature parity with iOS — just needs to demonstrate the dual-platform claim isn't fictional. | The submission promised "iOS and Android native apps". Demoing one and showing the other as a stub damages credibility. | Peter | 4-5 days |
| M5 | **Finish the WhatsApp bot end-to-end.** Verify the bot in `/Users/peter/git/GenieAI_whatsapp_bot` can: receive an inbound message, route it through the GENIE.AI RAG backend, return the answer over the Meta Cloud API, persist conversation. Wire it up to the same Keycloak/backend the apps use (rather than its own Node/TS stack — or document the deviation). | WhatsApp is named as the PRIMARY outreach channel in the submission. Cannot demo "multi-channel" without it working. | Peter | 2-3 days |
| M6 | **Audience-aware prompt + post-gen filter on server.** Take the prompt fix from `genie-ai-overlay/chatqna/genieai_chatqna.py` (committed 2026-05-15) further: add a small Python pass after generation that (a) strips persona-adoption phrases (still failing the MegaHealth Pro test case after the prompt-only fix), (b) validates inline `[Source:]` titles against actual retrieved chunk titles, (c) redacts uncited specific numerics. | Closes the safety gap the LLM-judge run showed remains: prompt-only defences against jailbreaks don't work on Granite 3.3 8B. | Jan | 1-2 days |
| M7 | **Re-run LLM-judge sweep against M1-M6 changes; publish numbers.** Re-run `tests/llm-judge/run.py --target both` after each batch lands. Update `tests/llm-judge/FINDINGS.md` with the final pre-submission numbers. | Submission can cite concrete pass rates from a documented harness. | Peter (already wired) | 1 hour per run |

### 3.2 SHOULD-have (visible improvement to evaluation)

| # | Work item | Why | Rough size |
|---|---|---|---|
| S1 | **Vital Data & Habit Tracking backend (Django + PostgreSQL)** with REST endpoints for "record BP", "record cigarette count", "list time series", "export". Even a 100-line minimal implementation is enough to demo the concept and back the iOS vitals UI. | Promised in D.1 and D.2 — currently not started. | 3-4 days |
| S2 | **Vital-tracking + chart export in iOS.** Wire S1 into a Vitals tab; add a simple chart view; add a "share as PDF" button. | Promised in the mobile app feature list. | 2-3 days |
| S3 | **User Feedback Module (UI + backend).** Thumbs-up/thumbs-down on each assistant message in iOS + Android + WhatsApp; small Django service that stores rating + anonymised transcript ID. | Promised in D.1; also the foundation for future RLHF claimed in the submission. | 2-3 days |
| S4 | **STT/TTS minimal viable**: integrate Apple's on-device speech recognition + AVSpeechSynthesizer in iOS (zero new dependencies, runs offline, works for English). Bundle a Whisper.cpp / TTS server on the backend for the WhatsApp voice-note path. | STT/TTS is one of the six framework extensions claimed in D.1; even a small demo is better than nothing. | 3-5 days |
| S5 | **BGE-m3 + bge-reranker-v2-m3 migration on the server.** TEI service swap + retriever config update. Re-run the rag-benchmark CSVs. | Concrete model claim from D.2 that's currently bge-base. Migration is a config change + reload, not a code rewrite. | 1-2 days |
| S6 | **MCP tool-calling demo.** A single MCP tool: "register for a NCD screening appointment" (mock backend). Demonstrates the GovStack-tool-calling claim with one concrete tool. | D.2 names MCP tool calling as a chatbot capability. One working tool >> zero working tools. | 3-4 days |
| S7 | **Push notifications, server-initiated.** APNs + FCM token registration in mobile, scheduled-message sender service on the backend, pulling from the BHBM message libraries. | Named explicitly in D.2 mobile app feature list. | 3-4 days |

### 3.3 NICE-to-have (polish)

- **Apple Health / Google Fit integration** for vitals — claimed but
  removable without major credibility loss.
- **Rewards/streaks UI** in mobile.
- **WCAG accessibility audit + fixes** in iOS / Android / web.
- **Prometheus/Grafana/Sentry observability stack** — only matters
  if reviewers ask "how do you operate this?".
- **AWS ECS/Fargate deployment** — currently on a Docker Swarm VPS.
  Compose files are portable; the migration can wait unless the
  reviewers explicitly want to see it on AWS.

---

## 4. Suggested sequencing (3-4 weeks of focused work)

Assuming the team is 3 people (Peter, Jan, Viktor) and the
submission deadline is "several weeks out" (needs confirming):

**Week 1** — Corpus and audience fixes (the biggest lever).
- M1, M2 (Jan): all the documents ingested under proper labels.
- M3 (Jan + Peter): derived-document pipeline for at least tobacco
  and hypertension; re-index.
- M6 (Jan): server post-generation safety filter.
- M7 (Peter): re-run LLM-judge baseline after each batch.

**Week 2** — Multi-channel coverage.
- M4 (Viktor / Peter): Android Compose chat MVP — auth + chat +
  sources, against the same backend.
- M5 (Peter): WhatsApp bot end-to-end with the real RAG backend.
- S1 (Jan / Peter): vitals tracker backend (just enough to be
  demoable from iOS).

**Week 3** — Differentiators (pick 2 of the S-list to ship hard).
Recommended: **S2 (vitals UI in iOS)** + **S4 (STT/TTS minimal)** —
both are visible in a 5-minute demo. S5 (BGE-m3) in parallel — it's
a low-risk config swap.

**Week 4** — Polish, evaluation re-run, demo prep.
- Final LLM-judge sweep, refresh FINDINGS.md with numbers.
- Record a 5-minute demo video: WhatsApp question → mobile answer
  with citation → vitals entry → chart export.
- Update README + architecture.md to match what's actually built.
- Light WCAG check.

---

## 5. Open questions for the team

These all block sizing the plan and should be answered before the
team commits to any of the above:

1. **What's the Phase 2 submission deadline?** The HubPacket doesn't
   state it — Jan or the YAIL hub coordinator should confirm.
2. **Is the WhatsApp bot expected to share the GENIE.AI backend
   stack or stay as its own Node.js service?** The submission says
   Django; the existing code is TypeScript. Either decision is
   defensible but it needs to be one of them.
3. **Demo logistics** — is the prototype evaluated on the team's
   live deployment, on a video, or on a hand-off package the
   reviewers run themselves? Each implies a different "done"
   criterion (e.g. live demo doesn't need AWS migration; hand-off
   package does need polished setup docs).
4. **Stakeholder access** — when can we get one or two Gambian
   English speakers to validate STT/TTS quality? Without that,
   S4 ships untested.
5. **Cross-team dependencies** — are we relying on any
   GENIE.AI-framework changes that other teams haven't shipped yet
   (e.g. is there a downstream PR on BGE-m3 already in flight that
   we'd duplicate)?

---

## 6. What's deliberately NOT in this plan

To keep scope honest:

- The Sprint 20-25 roadmap in `docs/roadmap-sprint-20-to-25.md` —
  that's the project's 12-month roadmap, not the Phase 2 prototype
  scope. Several items overlap (STT/TTS, security hardening, K8s)
  but the Phase 2 cut is much narrower.
- Production-grade security (security ops team, scheduled
  penetration tests, vulnerability assessments) — the submission
  itself defers this to "when the system goes into production and
  additional financial resources are available, beyond the current
  financial scope".
- Native iOS/Android features that are visible polish only (Apple
  Health, Google Fit, rewards/streaks). These can be cut without
  damaging the credibility of the prototype demo.
