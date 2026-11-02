theme: Plain Jane, 1
footer: Agrivisory · GenieAI 2.0.1 upgrade
slidenumbers: true
autoscale: true

---

# [fit] Agrivisory on GenieAI 2.0.1
## Upgrade progress — team update

### 28 Aug 2026 · branch `feature/2.0-upgrade` · all local

^ Talk track: the job and how we approached it, then the proof — what actually got demonstrated end-to-end — then what's left and what we need.

---

## The job: swap the platform, keep the product

- Agrivisory (our product) rides on GenieAI (ITU framework)
  - old 1.x fork → **2.0.1**: new RAG services, PG16, current pins
- **Selective merge** — adopt the framework, never absorb the product into it:
  - **take**: `deploy/ansible` (stripped) · overlay · compose base · PG16
  - **never**: their frontend/login · CI/runner · agent configs
  - **untouched**: `components/` `mobile/` `helm/` — product dirs
- Our weather + Sesotho patches: **re-ported on top** of the new overlay
- One branch · every step test-proven · riskiest work last

^ The merge is curated, not wholesale — that's what makes the diff reviewable: it contains platform changes only. Re-ingestion + DB migration happen exactly once, at the end.

---

## Where we are

```
S1  platform      ██████████████  done
S2  backbone      ████████████░░  ingest + chat proven · streaming + GPU left
S3  security      ░░░░░░░░░░░░░░  next
LAST migrate      ░░░░░░░░░░░░░░  re-ingest + PG13→16 — once, at the end
```

- GPU-dependent items blocked on VM access — **not on us**
- Everything provable without GPUs has been proven

^ One-slide map. The risky parts — platform swap, auth, pipeline proof — are behind us.

---

## S2a — the stack boots, login works

```
https://localhost/api/health → nginx → kong → backend → 200
```

- `compose up`: **11 healthchecked services + 3 one-shot jobs green**
- Realm `agrivisory` as code, seed-free · Keycloak ↔ Arango identity bridge

| who | result |
|---|---|
| admin | 200 · role Admin |
| pending farmer | 403 pendingApproval |

^ Nastiest bug on the way: the realm JSON omitted Keycloak's `basic` client scope — tokens had no `sub`, every API call 401'd. Found, fixed, documented.

---

# [fit] Proving RAG without GPUs
## Only the inference is faked — everything else is real

^ The method slide: this is how we kept making progress with no GPU VMs since the start.

---

## The mock-inference trick

```
                    real services, real data
 ┌────────────────────────────────────────────────┐
 │  upload · ClamAV · doc-repo · dataprep · Arango │
 │  retriever · backend · kong · keycloak          │
 └────────────────────────────────────────────────┘
        calls out to inference — mocked:
        embed / rerank / vLLM  →  local mock server
```

- Containers reach the host mock via `host.docker.internal`
- Deterministic vectors, dummy scores, canned LLM text
- Honest limit: mock ignores `stream: true` → SSE can be *wired*, not *rendered*

^ When GPUs return: point three env vars at the T4 endpoints, re-run the same tests. That's the entire cutover plan.

---

## F4 — a real document, through the real pipeline

```
maize.pdf
  → upload → ClamAV scan → doc-repo
  → dataprep   chunking · BM25 labels · graph · embed (mock)
  → Arango     GRAPH_TEST_SOURCE, embedded: true
  → retriever  /v1/retrieval  ✅ returns the maize chunk
```

- Real chunking, real graph, real storage, real retrieval
- Only the embedding call was mocked

^ Caught a real production bug here: file-type v16 renamed its export — uploads silently failed validation. Fixed at the root, now unit-tested.

---

## S2c — a real question, through the whole graph

```
POST /api/queries
  → backend → chatqna
       ├─ embedding   (mock)
       ├─ retriever   REAL — Arango maize chunks
       ├─ reranker    (mock)
       └─ vLLM        (mock)
  ← response persisted to chat history
```

- Frontend suite 57/57 · 8/8 API endpoints 200 with admin token

^ The retrieval leg — the part that proves our data and wiring — is real. The mocked legs are exactly the ones that need GPUs.

---

## Receipts

- **648** overlay pytest — framework suite, green
- **60 / 26 / 57** jest — doc-repo · kong-config · frontend, all green
- **13/14** route matrix (logger 404 = benign) · **8/8** admin endpoints
- **216,438 lines** of dead weight purged · compose has **0** literal secrets

^ Every claim on the previous slides has one of these behind it.

---

## And then we tried to break it

- 18-agent adversarial review over the whole branch
  - every finding independently re-verified before counting
- **12 findings confirmed · 0 refuted · 12 fixed** — one commit
- What it caught:
  - committed credentials still tracked after the cleanup sweep
  - a deploy.yml bug that would *hang* local-mode deploys
  - the mock speaking the wrong embedding dialect — green tests, lying

^ The review also confirmed the good parts: test counts matched claims exactly, the auth bridge held up. The claims layer got the same scrutiny as the code.

---

## What's left

```
S2d  streaming chat UI   — wired now? render honestly after GPUs
S2b  GPU chat round-trip — BLOCKED on VM access (wiring ready)
S3   security sweep      — adopted framework code
LAST re-ingestion (bge-m3!) + Postgres 13→16 migration
```

- Ordering is deliberate: migrate and re-ingest **once**, at the end

^ bge-m3 means every embedding changes — the corpus gets re-ingested exactly once, after everything else is stable.

---

## Asks

1. **GPU VM access** — unblocks S2b; three env vars and we re-run everything
2. **Rotate exposed credentials** — list in PLAN.md (were in git history)
3. **Push decision** — branch stays local until Adem calls it

^ Rotation: Keycloak bootstrap admin, Konga token secret, DB passwords, one DB role hash, one legacy manager credential. Private repo, history retention accepted — rotation is the real fix.

---
