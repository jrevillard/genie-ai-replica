theme: Plain Jane, 1
footer: Agrivisory · GenieAI 2.0.1 upgrade
slidenumbers: true
autoscale: true

---

# [fit] Agrivisory on GenieAI 2.0.1
## Upgrade — where we stand

### 28 Aug 2026 · `feature/2.0-upgrade` · local only, no pushes

^ Middle cut of the deck (between -brief and the full version): three workstreams — deployment, RAG, security — with the proof numbers kept in. ~12–15 minutes.

---

## The task

**Agrivisory** = our product (Sesotho chat, weather, farmer profiles, mobile, Keycloak-F5)

**GenieAI** = the framework underneath (RAG pipeline, compose, deploy tooling)

Move from the old **1.x fork** onto **2.0.1** — new RAG services, PG16, current pins

The catch: our weather + translation patches live *inside* their services

^ The hard part isn't the upgrade — it's keeping our product modifications alive on a moving framework without forking again. The merge is curated, not wholesale — that's what makes the diff reviewable: it contains platform changes only.

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

^ Decided up front in an adoption map. Rules: main stays clean, every step ends with a test, riskiest work (re-ingestion + DB migration) deliberately last — it happens exactly once, at the end.

---

## Where we are

```
S1  platform      ██████████████  done
S2  backbone      ████████████░░  ingest + chat + SSE wired · GPU round-trip left
S3  security      ██████████████  0 open findings · rotation left (ask 2)
LAST migrate      ░░░░░░░░░░░░░░  re-ingest + PG13→16 — once, at the end
```

- GPU-dependent items blocked on VM access — **not on us**
- Everything provable without GPUs has been proven

^ One-slide map. The risky parts — platform swap, auth, pipeline proof — are behind us. All non-VM work is complete: everything left needs GPU VMs, a rotation decision, or is the final migration by design.

---

## ① Deployment — one path instead of three

**Changed:**
- Adopted GenieAI's **ansible deploy tree** — stripped of gitlab-runner + ITU host envs
- One compose base, product services folded in (Keycloak two-Postgres, PG16, secrets via env — zero literals)
- One deploy path, two modes: `deploy_mode: local | registry` — ansible-switched
- Deleted the old t4 / RTX6000 variant composes (broken, hardcoded creds)

**Why:** the fork had three drifting deploy paths; now there's one reviewable one

| who | result |
|---|---|
| admin | 200 · role Admin |
| pending farmer | 403 pendingApproval |

**Status:** ✔ stack boots — 11 healthchecked services + 3 jobs green · `/api/health` 200 · login works

^ The ansible tree is also the skeleton of the **installation playbook** coming next: inventory → env.j2 render (deploy_mode picks local build vs Azure registry) → compose up. Nastiest bug on the way: the realm JSON omitted Keycloak's `basic` client scope — tokens had no `sub`, every API call 401'd. Found, fixed, documented.

---

## ② RAG — our patches survive the upgrade

**Changed:**
- 2.0.1 overlay taken wholesale — new dataprep, retriever (v2 API: port + path changed), reranker
- Our **weather RAG + Sesotho translation** patches re-ported *on top* (old dataprep patch superseded by 2.0.1, docling fallback kept)
- Embedding model change → **bge-m3**, so the whole corpus gets re-ingested exactly once — at the end

**Why:** the new RAG services are the reason to upgrade — but our modifications must survive without re-forking

**Status:** ✔ ingest + chat + SSE streaming proven E2E (next slide) · GPU round-trip blocked on VM access

^ The re-port is the delicate bit: their dataprep internals moved, so our old patch didn't apply — it had to be re-derived against 2.0.1. bge-m3 means every embedding changes — hence re-ingest exactly once, after everything else is stable. Overlay's own suite: 648 passed.

---

## Proven without GPUs — the mock-inference trick

A small local server fakes **only the inference** — everything else is real

- Speaks TEI + vLLM dialects (`/embed`, `/rerank`, `/v1/chat/completions`)
- Real dataprep, real Arango, real wiring — containers reach it via `host.docker.internal`

**Ingest:** upload → ClamAV → doc-repo → dataprep → Arango → retriever returns the maize chunks ✔

**Chat:** `POST /api/queries` → chatqna → embed → **real Arango retrieval** → rerank → LLM → persisted ✔

- SSE streaming **wired E2E** — live bubble, chunk-safe parser, silent fallback · mock ignores `stream: true`, so token-by-token *render* arrives with real vLLM
- When GPUs return: point three env vars at the T4 endpoints, re-run the same tests — that's the entire cutover plan

^ Also caught a real prod bug here — file-type v16 renamed its export, uploads silently failed validation; fixed at the root, now unit-tested. The retrieval leg — the part that proves our data and wiring — is real; the mocked legs are exactly the ones that need GPUs.

---

## Receipts

- **648** overlay pytest — framework suite, green
- **60 / 26 / 63** jest — doc-repo · kong-config · frontend, all green
- **13/14** route matrix (logger 404 = benign) · **8/8** admin endpoints
- **216,438 lines** of dead weight purged · compose has **0** literal secrets

^ Every claim on the previous slides has one of these behind it.

---

## ③ Security — earn trust in adopted code

**Changed:**
- 18-agent adversarial review of the whole branch + independent re-verification → **12 findings confirmed, 0 refuted, all fixed**
  - Committed credentials + kong backup dumps purged (216k lines out)
  - Realm file seed-free · register/forgot URLs env-switchable · compose carries zero literal secrets
  - deploy.yml bug that would *hang* local-mode deploys — caught before it ever ran
  - the mock speaking the wrong embedding dialect — green tests, lying
- Product code was swept separately (earlier commits)

**Why:** adopted framework code arrives with ITU's assumptions — it crosses our trust boundary, so we sweep it, not trust it

**Status:** ✔ S3 sweep complete — **0 open findings** · remaining: credential rotation only (ask 2)

^ The review also confirmed the good parts: test counts matched claims exactly, the auth bridge held up. Rotation list: Keycloak bootstrap admin, Konga token secret, several DB passwords — values sat in git history. Repo is private, but rotation is the real fix.

---

## What's left · what we need

[.column]
### Left

- **Installation playbook** — from the ansible tree
- GPU chat round-trip + honest SSE render — *blocked on VMs*
- PG 13→16 migration + full re-ingestion — **last, by design**

[.column]
### Asks

1. **GPU VM access** — unblocks S2b; three env vars and we re-run everything
2. **Rotate exposed creds** (list in PLAN.md)
3. **Push call** — Adem decides

^ Ordering is deliberate: re-ingestion + DB migration happen once, at the end, after everything else is stable. Rotation: Keycloak bootstrap admin, Konga token secret, DB passwords, one DB role hash, one legacy manager credential — private repo, history retention accepted, rotation is the real fix.
