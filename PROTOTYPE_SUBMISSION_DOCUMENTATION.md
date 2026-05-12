# GENIE.AI — Prototype Submission Documentation

**Document purpose:** This file accompanies the prototype codebase and satisfies submission requirements for **system design**, **functionality**, **setup**, and **intended use**, so that independent reviewers or operators can understand, evaluate, and (where applicable) reproduce or deploy the solution.

**Repository:** GENIE.AI — open-source generative AI framework for the public sector (sovereign, standards-aligned RAG with multilingual support).

**Primary references in this repository:** `README.md`, `docs/architecture.md`, `GENIE.AI-Installation-Configuration-Guide.md`, `CLAUDE.md`, `docker-compose.yaml`, root `env` template.

---

## 1. Executive summary

GENIE.AI is a modular **Retrieval-Augmented Generation (RAG)** platform intended for **public-sector** contexts: institutional control of data and models, containerized deployment, and integration with **OPEA** (Open Platform for Enterprise AI) for embeddings, retrieval, reranking, and LLM inference. The prototype delivers a **web client**, **BFF-style backend**, **document ingestion pipeline**, **hybrid vector + graph retrieval**, and **optional GPU-backed** inference (vLLM, TEI), behind **Kong/NGINX** with **Keycloak** for identity.

---

## 2. System design

### 2.1 High-level architecture

The platform is organized in layers:

| Layer | Main components | Role |
|--------|-----------------|------|
| Client | `components/gov-chat-frontend/` (Vue 3), `mobile/genie_ai_mobile/` (Flutter) | User-facing chat, admin flows, i18n |
| API gateway | `api-gateway-solution/` (Kong, NGINX) | TLS, reverse proxy, CORS, rate limiting |
| Application | `components/gov-chat-backend/` (Node.js/Express), `components/document-repository/` | Auth integration, chat orchestration, uploads, business APIs |
| Identity | Keycloak (via compose) | OIDC/OAuth2; optional brokering to external IdPs |
| Data | ArangoDB, Redis, PostgreSQL (Kong/Keycloak DBs) | Documents, vectors, graph edges, cache, gateway/IdP persistence |
| AI / ML | `genie-ai-overlay/` (ChatQnA, Retriever, Dataprep, Reranker), vLLM, TEI | RAG pipeline, ingestion, ranking, generation |

A detailed diagram and narrative are in **`docs/architecture.md`** (context diagram, service graph, authentication flows).

### 2.2 RAG data path (conceptual)

A typical query path:

1. **End user** submits a question through the **Vue frontend** (authenticated session / tokens per Keycloak).
2. **Backend** forwards the request to **ChatQnA** (OPEA-aligned microservice).
3. **Retriever** performs **hybrid retrieval** against **ArangoDB** (vector + graph-related data, per deployment configuration).
4. Optional **Reranker** (TEI) refines candidate chunks.
5. **LLM** (vLLM) generates an answer grounded on retrieved context, with configurable prompts and abstention behavior (see `genie-ai-overlay/chatqna/` and environment variables documented in `CLAUDE.md` / `env`).

**Document ingestion:** uploads flow through the **document repository** (with **ClamAV** scanning where enabled); **Dataprep** processes content into chunks and embeddings for storage in ArangoDB.

### 2.3 Key design choices

- **Modularity:** Core app services can run without the full AI profile; AI services are activated via Docker Compose **profiles** (e.g. `opea`).
- **Sovereignty & operations:** Single root **`docker-compose.yaml`** supports both `docker compose up` and Swarm-oriented deployment patterns used with Ansible (`deploy/ansible/`).
- **Security:** Identity centralized in Keycloak; gateway enforces edge policies; secrets expected via `.env` (never commit real secrets).

---

## 3. Functionality

### 3.1 End-user capabilities

- **Conversational access** to organization-approved knowledge via RAG.
- **Multilingual UI** patterns (i18n in frontend; translation services configurable in the AI layer as deployed).
- **Document-oriented workflows** aligned with admin-managed categories and services (see backend domain routes in `components/gov-chat-backend/`).

### 3.2 Administrative / operational capabilities

- **User and realm management** via Keycloak (IT admin persona).
- **Content administration** (functional admin): categories, services, document lifecycle — see backend route domains (`/api/admin/*`, `/api/files/*`, `/api/categories/*`, etc., as described in `CLAUDE.md`).

### 3.3 API and observability

- Backend exposes **Swagger** documentation at **`/api-docs`** when enabled.
- Structured logging (e.g. Winston on Node; Python services use project logging conventions).

For **behavioral verification**, the repository defines **multi-phase E2E procedures** under **`docs/e2e-tests/`** (including prerequisites and strict ordering — see `docs/e2e-tests/README.md`).

---

## 4. Setup and deployment

### 4.1 Prerequisites

- **Docker** and **Docker Compose** v2+ (Swarm-capable compose file at repository root).
- **GPU** (recommended for full LLM/embedding performance); optional CPU-only experimentation depends on your chosen images and models (not guaranteed for all model stacks).
- **Hugging Face Hub token** (and any vLLM API key your deployment requires) — see `env` template and `README.md`.

### 4.2 Environment configuration

1. Copy the template: `cp env .env`
2. Edit **`.env`** with required secrets (examples from template and `CLAUDE.md`): database passwords, Keycloak secrets, SMTP if email verification is used, `HUGGING_FACE_HUB_TOKEN`, domain/CORS settings, etc.

### 4.3 Running locally (Docker Compose)

```bash
# Core stack (application + data services; no OPEA profile)
docker compose up -d

# Full stack including OPEA / AI services
docker compose --profile opea up -d
```

GPU-specific override files (e.g. **`env.t4`**, **`env.rtx6000`**) can be combined with `.env` as documented in `README.md` / `CLAUDE.md`.

### 4.4 Production-style deployment

- **Ansible** automation for Docker Swarm: **`deploy/ansible/README.md`**
- **Gateway configuration** and scripts: **`api-gateway-solution/`**

### 4.5 Developer-oriented quality gates

From repository root (see root **`package.json`**):

- JavaScript/Vue: `npm run lint`, `npm run format:check`
- Python overlay: `npm run lint:py`, `npm run format:py:check`

---

## 5. Intended use

### 5.1 Target users and personas

- **Citizens / civil servants / program staff** — query internal knowledge bases through controlled interfaces.
- **IT administrators** — deploy, patch, scale, integrate IdPs, manage certificates and gateway policy.
- **Functional administrators** — curate documents, metadata, and service categories so answers remain **accurate, auditable, and policy-aligned**.

### 5.2 Representative public-sector use cases

Non-exhaustive examples aligned with the project mission (see **`README.md`** “Relevant use cases” and linked working-group materials):

- **Policy and program Q&A** over approved corpora  
- **Operational assistants** for internal manuals and procedures  
- **Multilingual access** to vetted content where translations are configured  

### 5.3 What this prototype is not (scope boundary)

GENIE.AI is a **framework and reference implementation**, not a single turnkey “national AI” product: **models, corpora, retention policies, and legal approvals** remain the responsibility of the deploying organization.

---

## 6. How reviewers can validate the submission

1. **Read:** `docs/architecture.md` — confirms design claims against diagrams.  
2. **Deploy:** follow Section 4 with a disposable environment and `.env` filled from `env`.  
3. **Exercise:** follow `docs/e2e-tests/README.md` phases appropriate to your environment.  
4. **Trace code:** RAG orchestration in `genie-ai-overlay/chatqna/`; retrieval in `genie-ai-overlay/retriever/`; ingestion in `genie-ai-overlay/dataprep/`; API surface in `components/gov-chat-backend/`.

---

## 7. Intellectual property and compliance pointers

- **Licensing:** see repository **LICENSE** and **`THIRD_PARTY.md`**.  
- **Contributing:** **`CONTRIBUTING.md`**, **`CLA.md`**.  
- **Standards:** **`STANDARDS.md`**.

---

## 8. Document control

| Field | Value |
|--------|--------|
| Title | GENIE.AI prototype submission documentation |
| Format | Markdown (readable as plain text; convertible to PDF/Word by the submitter if required) |
| Location | Repository root: `PROTOTYPE_SUBMISSION_DOCUMENTATION.md` |
| Maintainer | Submitting team (update version notes here when the prototype changes) |

*End of document.*
