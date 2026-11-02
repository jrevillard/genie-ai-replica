theme: Plain Jane, 1
footer: Agrivisory · GenieAI 2.0.1 upgrade
slidenumbers: true
autoscale: true

---

# [fit] Agrivisory on GenieAI 2.0.1
## Upgrade — where we stand

### 28 Aug 2026 · `feature/2.0-upgrade` · local only, no pushes

^ Short version of the full deck (docs/team-update-2026-08-28.md). Three workstreams — deployment, RAG, security — what changed in each and why. ~10 minutes.

---

## The task

**Agrivisory** = our product (Sesotho chat, weather, farmer profiles, mobile, Keycloak-F5)

**GenieAI** = the framework underneath (RAG pipeline, compose, deploy tooling)

Move from the old **1.x fork** onto **2.0.1** — new RAG services, PG16, current pins

The catch: our weather + translation patches live *inside* their services

^ The hard part isn't the upgrade — it's keeping our product modifications alive on a moving framework without forking again. Everything falls into three clusters: how we deploy, the RAG pipeline, and security of the adopted code.

---

## How: selective merge

[.column]
### TAKE

- Ansible deploy tree (stripped)
- 2.0.1 compose + overlay
- Version pins, PG 13→16

[.column]
### NEVER

- Their frontend / login
- CI, agent configs, site

Product code (`components/`, `mobile/`, `helm/`) untouched — our patches re-ported *on top*, not merged in

^ Decided up front in an adoption map. Rules: main stays clean, every step ends with a test, riskiest work (re-ingestion + DB migration) deliberately last.

---

# [fit] Three workstreams
## ① Deployment · ② RAG · ③ Security

---

## ① Deployment — one path instead of three

**Changed:**
- Adopted GenieAI's **ansible deploy tree** — stripped of gitlab-runner + ITU host envs
- One compose base, product services folded in (Keycloak two-Postgres, PG16, secrets via env — zero literals)
- One deploy path, two modes: `deploy_mode: local | registry` — ansible-switched
- Deleted the old t4 / RTX6000 variant composes (broken, hardcoded creds)

**Why:** the fork had three drifting deploy paths; now there's one reviewable one

**Status:** ✔ stack boots — 11 healthchecked services + 3 jobs green · `/api/health` 200

^ This tree is also the skeleton of the **installation playbook** I'm writing next: inventory → env.j2 render (deploy_mode picks local build vs Azure registry) → compose up. Verified by ansible syntax checks ×3, env render + compose config in both modes.

---

## ② RAG — our patches survive the upgrade

**Changed:**
- 2.0.1 overlay taken wholesale — new dataprep, retriever (v2 API: port + path changed), reranker
- Our **weather RAG + Sesotho translation** patches re-ported *on top* (old dataprep patch superseded by 2.0.1, docling fallback kept)
- Embedding model change → **bge-m3**, so the whole corpus gets re-ingested exactly once — at the end

**Why:** the new RAG services are the reason to upgrade — but our modifications must survive without re-forking

**Status:** ✔ both pipelines proven E2E (next slide) · GPU round-trip blocked on VM access

^ The re-port is the delicate bit: their dataprep internals moved, so our old patch didn't apply — it had to be re-derived against 2.0.1. Overlay's own suite: 648 passed.

---

## Proven without GPUs — the mock-inference trick

A small local server fakes **only the inference** — everything else is real

- Speaks TEI + vLLM dialects (`/embed`, `/rerank`, `/v1/chat/completions`)
- Real dataprep, real Arango, real wiring — containers reach it via `host.docker.internal`

**Ingest:** upload → ClamAV → doc-repo → dataprep → Arango → retriever returns the maize chunks ✔

**Chat:** `POST /api/queries` → chatqna → embed → **real Arango retrieval** → rerank → LLM → persisted ✔

When GPUs return: swap three env vars, re-run the same tests

^ Honest limit, stated in the docs: the mock ignores `stream: true`, so the streaming UI can be wired but not honestly rendered until VMs. Also caught a real prod bug here — file-type v16 renamed its export, uploads silently failed validation; fixed at the root, now unit-tested.

---

## ③ Security — earn trust in adopted code

**Changed:**
- 18-agent adversarial review of the whole branch + independent re-verification → **12 findings confirmed, 0 refuted, all fixed**
  - Committed credentials + kong backup dumps purged (216k lines out)
  - Realm file seed-free · register/forgot URLs env-switchable · compose carries zero literal secrets
  - deploy.yml bug that would *hang* local-mode deploys — caught before it ever ran
- Product code was swept separately (earlier commits)

**Why:** adopted framework code arrives with ITU's assumptions — it crosses our trust boundary, so we sweep it, not trust it

**Remaining:** S3 sweep of adopted framework code + credential rotation (list in PLAN.md)

^ Rotation list: Keycloak bootstrap admin, Konga token secret, several DB passwords — values sat in git history. Repo is private, but rotation is the real fix.

---

## What's left · what we need

[.column]
### Left

- **Installation playbook** — from the ansible tree
- GPU chat round-trip — *blocked on VMs*
- Streaming UI — deferred with it
- Security sweep (S3)
- PG 13→16 migration + full re-ingestion — **last, by design**

[.column]
### Asks

1. **GPU VM access**
2. **Rotate exposed creds** (list in PLAN.md)
3. **Push call** — Adem decides

^ Ordering is deliberate: re-ingestion + DB migration happen once, at the end, after everything else is stable.
