# Third-Party Software and Components Disclosure

This document provides a non-exhaustive list of third-party artefacts (software, components, and frameworks) used in the GENIE.AI project. GENIE.AI contains and references intellectual property owned by third parties ("Third Party IP"). Acceptance of these License Terms does not grant any rights to Third Party IP. Users must comply with all applicable license terms for each third-party component.

**Important Notice:** Use of third-party components may require separate licensing. ITU grants no rights over third-party IP. Users are responsible for ensuring compliance with all third-party licenses.

---

## Table of Contents

1. [Core AI/ML Frameworks](#core-aiml-frameworks)
2. [AI Models](#ai-models)
3. [Databases & Data Storage](#databases--data-storage)
4. [Backend Frameworks & Runtime](#backend-frameworks--runtime)
5. [Frontend Frameworks](#frontend-frameworks)
6. [API Gateway & Infrastructure](#api-gateway--infrastructure)
7. [Container & Orchestration](#container--orchestration)
8. [Security & Authentication](#security--authentication)
9. [Document Processing & Search](#document-processing--search)
10. [Mobile Development](#mobile-development)
11. [Monitoring & Logging](#monitoring--logging)
12. [Python Libraries](#python-libraries)
13. [Node.js Libraries](#nodejs-libraries)
14. [Vue.js Libraries](#vuejs-libraries)

---

## Core AI/ML Frameworks

### OPEA (Open Platform for Enterprise AI)
**Component Type:** Core RAG Pipeline Framework
**Version:** v1.3
**Repository:** https://github.com/opea-project
**License:** Apache 2.0
**License URL:** https://github.com/opea-project/blob/main/LICENSE

OPEA provides microservices for:
- ChatQnA (Chat with RAG)
- Data preparation/ingestion
- Embedding services
- Retrieval services
- Reranking services
- Guardrails/safety checks
- Translation services

**Usage:** GENIE.AI integrates OPEA as the core AI/ML orchestration layer for RAG pipeline functionality.

---

### vLLM
**Component Type:** LLM Inference Server
**Version:** latest (Docker image: vllm/vllm-openai:latest)
**Repository:** https://github.com/vllm-project/vllm
**License:** Apache 2.0
**License URL:** https://github.com/vllm-project/vllm/blob/main/LICENSE

**Usage:** High-throughput LLM serving with PagedAttention for efficient inference.

---

### Hugging Face Text Embeddings Inference (TEI)
**Component Type:** Embedding & Reranking Inference Server
**Version:** latest (Docker image: ghcr.io/huggingface/text-embeddings-inference:latest)
**Repository:** https://github.com/huggingface/text-embeddings-inference
**License:** Apache 2.0
**License URL:** https://github.com/huggingface/text-embeddings-inference/blob/main/LICENSE

**Usage:** Production-grade embedding and reranking model serving with GPU acceleration.

---

### Docling
**Component Type:** Document Parsing & Content Extraction
**Repository:** https://github.com/docling-project/docling
**License:** MIT License
**License URL:** https://github.com/docling-project/docling/blob/main/LICENSE

**Usage:** Advanced document parsing for PDF, DOCX, and other formats in the data preparation pipeline.

---

### Transformers (Hugging Face)
**Component Type:** NLP/ML Library
**Version:** Used in Python backend
**Repository:** https://github.com/huggingface/transformers
**License:** Apache 2.0
**License URL:** https://github.com/huggingface/transformers/blob/main/LICENSE

**Usage:** Pre-trained model support for translation, embeddings, and NLP tasks.

---

### @xenova/transformers
**Component Type:** Client-side ML for Node.js
**Version:** ^2.17.2
**Repository:** https://github.com/xenova/transformers.js
**License:** Apache 2.0
**License URL:** https://github.com/xenova/transformers.js/blob/main/LICENSE

**Usage:** Browser/Node.js transformer models for client-side ML inference.

---

## AI Models

The models on the OPEA-free agent path (the pre-existing legacy model legs
keep their licence records in
`site/content/en/docs/rag-pipeline/choosing-models.md` — until this section,
THIRD_PARTY.md carried no model entries at all). Licences per the
repository's model-licence table and the upstream
model cards; the full redistribution assessment is
[`docs/baselines/v07b-license-assessment-2026-11-24.md`](docs/baselines/v07b-license-assessment-2026-11-24.md).

### IBM Granite (granite-4.1-8b)
**Component Type:** LLM model weights (served by vLLM)
**Version:** ibm-granite/granite-4.1-8b (Hugging Face)
**Repository:** https://huggingface.co/ibm-granite/granite-4.1-8b
**License:** Apache 2.0
**License URL:** https://huggingface.co/ibm-granite/granite-4.1-8b/blob/main/LICENSE

**Usage:** The agent loop's language model on the OPEA-free path.

---

### BAAI bge family (bge-large-en-v1.5, bge-reranker-v2-m3)
**Component Type:** Embedding and reranker model weights (served by TEI)
**Version:** BAAI/bge-large-en-v1.5, BAAI/bge-reranker-v2-m3 (Hugging Face)
**Repository:** https://huggingface.co/BAAI
**License:** MIT
**License URL:** https://huggingface.co/BAAI/bge-large-en-v1.5/blob/main/LICENSE

**Usage:** The embedding and reranking models behind the document capability
contract's retrieval adapters.

---

### Gemma (gemma-3-4b-it)
**Component Type:** LLM model weights (served by vLLM — the translation leg)
**Version:** google/gemma-3-4b-it (Hugging Face)
**Repository:** https://huggingface.co/google/gemma-3-4b-it
**License:** Gemma Terms of Use (NOT an open-source licence; use and
  redistribution are subject to Google's terms and the Gemma prohibited-use
  policy; deployments above 700M monthly active users must request a direct
  licence from Google)
**License URL:** https://huggingface.co/google/gemma-3-4b-it/blob/main/LICENSE

**Usage:** The model the translation leg serves by default
(`VLLM_TRANSLATION_MODEL_ID`) — answer translation and the agent loop's
query-preparation translation. **Restricted terms** (see the Licence field
above): the redistribution consequence is recorded as a blocker owned by the
licensing reviewer in
[`docs/baselines/v07b-license-assessment-2026-11-24.md`](docs/baselines/v07b-license-assessment-2026-11-24.md).

---

## Databases & Data Storage

### ArangoDB
**Component Type:** Multi-Model Database (Graph + Vector)
**Version:** 3.12.4 (Docker image: arangodb/arangodb:3.12.4)
**Repository:** https://www.arangodb.com/
**License:**
- **Version 3.12.4:** Apache 2.0 License
- **Newer Versions (4.x+):** Business Source License (BSL) / Community License

**Important License Change:**
- Versions 3.12.x and earlier: Apache 2.0 - free for all use cases
- Versions 4.0 and later: BSL with usage limitations (e.g., >100GB data may require commercial license)

**License URLs:**
- Apache 2.0 (3.12.x): https://www.arangodb.com/legal/arangodb-license-faq/
- BSL (4.x+): https://www.arangodb.com/legal/arangodb-community-license/

**Usage:** Primary graph and vector database for knowledge graph, document storage, and vector similarity search. The experimental vector index feature is enabled.

---

### Redis
**Component Type:** In-Memory Cache & Data Store
**Version:** 7-alpine (Docker image: redis:7-alpine)
**Repository:** https://redis.io/
**License:** BSD 3-Clause
**License URL:** https://github.com/redis/redis/blob/COPYING

**Usage:** Translation cache, session storage, and high-performance caching layer.

---

### PostgreSQL
**Component Type:** Relational Database
**Version:** 13 (Kong database), 15 (Keycloak database)
**Repository:** https://www.postgresql.org/
**License:** PostgreSQL License (similar to MIT/BSD)
**License URL:** https://www.postgresql.org/about/licence/

**Usage:**
- PostgreSQL 13: Backend database for Kong API Gateway
- PostgreSQL 15: Backend database for Keycloak authentication server

---

### MongoDB
**Component Type:** NoSQL Document Database
**Version:** 4.4 (Docker image: mongo:4.4)
**Repository:** https://www.mongodb.com/
**License:** SSPL (Server Side Public License)
**License URL:** https://www.mongodb.com/licensing/server-side-public-license

**Important:** SSPL is not OSI-approved open source. Commercial license may be required for certain use cases.

**Usage:** Backend storage for Konga (Kong management UI).

---

## Backend Frameworks & Runtime

### Node.js
**Component Type:** JavaScript Runtime
**Version:** 22.14.0 (Docker base image)
**Repository:** https://nodejs.org/
**License:** MIT License
**License URL:** https://github.com/nodejs/node/blob/main/LICENSE

**Usage:** Primary runtime for all backend microservices (gov-chat-backend, document-repository).

---

### Express
**Component Type:** Web Framework
**Version:** ^4.18.2
**Repository:** https://expressjs.com/
**License:** MIT License
**License URL:** https://github.com/expressjs/express/blob/master/LICENSE

**Usage:** Web server framework for Node.js backend services.

---

### Python
**Component Type:** Programming Language Runtime
**Version:** 3.10, 3.11
**Repository:** https://www.python.org/
**License:** Python Software Foundation License (PSF)
**License URL:** https://docs.python.org/3/license.html

**Usage:** Runtime for OPEA microservices, AI/ML processing, and HTTP services.

---

### FastAPI
**Component Type:** Python Web Framework
**Repository:** https://fastapi.tiangolo.com/
**License:** MIT License
**License URL:** https://github.com/tiangolo/fastapi/blob/master/LICENSE

**Usage:** Modern async web framework for Python microservices.

---

### Uvicorn
**Component Type:** ASGI Server
**Repository:** https://www.uvicorn.org/
**License:** BSD 3-Clause
**License URL:** https://github.com/encode/uvicorn/blob/master/LICENSE

**Usage:** ASGI server for running FastAPI applications.

---

## Frontend Frameworks

### Vue.js
**Component Type:** Progressive JavaScript Framework
**Version:** ^3.2.0
**Repository:** https://vuejs.org/
**License:** MIT License
**License URL:** https://github.com/vuejs/core/blob/main/LICENSE

**Usage:** Core frontend framework for gov-chat-frontend web application.

---

### Vue Router
**Component Type:** Official Router for Vue.js
**Version:** ^4.0.0
**Repository:** https://router.vuejs.org/
**License:** MIT License
**License URL:** https://github.com/vuejs/router/blob/main/LICENSE

**Usage:** Client-side routing for Vue.js application.

---

### Vuex
**Component Type:** State Management for Vue.js
**Version:** ^4.0.2
**Repository:** https://vuex.vuejs.org/
**License:** MIT License
**License URL:** https://github.com/vuejs/vuex/blob/main/LICENSE

**Usage:** Centralized state management for Vue.js application.

---

### Vue CLI
**Component Type:** Standard Tool for Vue.js Development
**Version:** ^5.0.0
**Repository:** https://cli.vuejs.org/
**License:** MIT License
**License URL:** https://github.com/vuejs/vue-cli/blob/master/LICENSE

**Usage:** Build tool and development server for Vue.js application.

---

### Vite
**Component Type:** Next Generation Frontend Tooling
**Repository:** https://vitejs.dev/
**License:** MIT License
**License URL:** https://github.com/vitejs/vite/blob/main/LICENSE

**Usage:** Fast build tool and dev server (used via Vue CLI).

---

## API Gateway & Infrastructure

### Kong
**Component Type:** API Gateway & Management
**Version:** latest (Docker image: kong:latest)
**Repository:** https://konghq.com/kong/
**License:** Apache 2.0
**License URL:** https://github.com/Kong/kong/blob/master/LICENSE

**Usage:** Cloud-native API gateway for routing, authentication, rate limiting, and API management.

---

### NGINX
**Component Type:** Web Server & Reverse Proxy
**Version:** latest (Docker image: nginx:latest)
**Repository:** https://nginx.org/
**License:** BSD 2-Clause
**License URL:** https://nginx.org/LICENSE

**Usage:** Reverse proxy, SSL termination, and static file serving.

---

### Konga
**Component Type:** Kong GUI Manager
**Version:** 0.14.9 (Docker image: pantsel/konga:0.14.9)
**Repository:** https://github.com/pantsel/konga
**License:** Apache 2.0
**License URL:** https://github.com/pantsel/konga/blob/master/LICENSE

**Usage:** Graphical user interface for Kong API Gateway management.

---

## Container & Orchestration

### Docker
**Component Type:** Container Platform
**Repository:** https://www.docker.com/
**License:** Apache 2.0
**License URL:** https://github.com/moby/moby/blob/master/LICENSE

**Usage:** Container runtime for application deployment and development.

---

### Docker Compose
**Component Type:** Multi-Container Orchestration
**Repository:** https://docs.docker.com/compose/
**License:** Apache 2.0
**License URL:** https://github.com/docker/compose/blob/master/LICENSE

**Usage:** Define and run multi-container Docker applications.

---

### Kubernetes
**Component Type:** Container Orchestration Platform
**Repository:** https://kubernetes.io/
**License:** Apache 2.0
**License URL:** https://github.com/kubernetes/kubernetes/blob/master/LICENSE

**Usage:** Production-grade container orchestration (optional deployment target).

---

## Security & Authentication

### Keycloak
**Component Type:** Identity and Access Management
**Version:** 26.8.2 (Docker image: quay.io/keycloak/keycloak:26.8.2)
**Repository:** https://www.keycloak.org/
**License:** Apache 2.0
**License URL:** https://github.com/keycloak/keycloak/blob/main/LICENSE

**Usage:** Open-source identity and access management solution for SSO and user authentication.

---

### ClamAV
**Component Type:** Anti-Virus Scanner
**Version:** latest (Docker image: clamav/clamav)
**Repository:** https://www.clamav.net/
**License:** GPL 2.0
**License URL:** https://github.com/Cisco-Talos/clamav/blob/main/COPYING

**Usage:** Virus scanning for uploaded documents in the document repository.

**Important:** GPL 2.0 is a copyleft license that may require derivative works to be licensed under GPL.

---

### Helmet
**Component Type:** Security Headers Middleware
**Version:** ^7.0.0, ^7.1.0
**Repository:** https://helmetjs.github.io/
**License:** MIT License
**License URL:** https://github.com/helmetjs/helmet/blob/main/LICENSE

**Usage:** Security HTTP headers for Express.js applications.

---

### bcrypt
**Component Type:** Password Hashing Library
**Version:** ^5.1.1
**Repository:** https://github.com/kelektiv/node.bcrypt.js
**License:** MIT License
**License URL:** https://github.com/kelektiv/node.bcrypt.js/blob/master/LICENSE

**Usage:** Password hashing and verification for user authentication.

---

### jsonwebtoken
**Component Type:** JWT Authentication Library
**Version:** ^9.0.2
**Repository:** https://github.com/auth0/node-jsonwebtoken
**License:** MIT License
**License URL:** https://github.com/auth0/node-jsonwebtoken/blob/master/LICENSE

**Usage:** JWT token creation and validation for stateless authentication.

---

### OWASP ZAP (Zed Attack Proxy)
**Component Type:** Security Testing Tool
**Version:** stable (Docker image: ghcr.io/zaproxy/zaproxy:stable)
**Repository:** https://www.zaproxy.org/
**License:** Apache 2.0
**License URL:** https://github.com/zaproxy/zaproxy/blob/main/LICENSE

**Usage:** Security vulnerability scanning and penetration testing.

---

## Document Processing & Search

### pdf-parse
**Component Type:** PDF Parser
**Version:** ^1.1.4
**Repository:** https://github.com/ffalt/node-pdf-parse
**License:** MIT License

**Usage:** Extract text content from PDF files.

---

### pdfjs-dist
**Component Type:** PDF Rendering Library
**Version:** ^4.0.379
**Repository:** https://mozilla.github.io/pdf.js/
**License:** Apache 2.0
**License URL:** https://github.com/mozilla/pdf.js/blob/main/LICENSE

**Usage:** PDF rendering and viewing in browser.

---

### mammoth
**Component Type:** DOCX Parser
**Version:** ^1.11.0
**Repository:** https://github.com/mwilliamson/mammoth.js
**License:** BSD 2-Clause
**License URL:** https://github.com/mwilliamson/mammoth.js/blob/master/LICENSE

**Usage:** Convert .docx files to HTML.

---

### xlsx
**Component Type:** Excel Spreadsheet Parser
**Version:** ^0.18.5
**Repository:** https://github.com/SheetJS/sheetjs
**License:** Apache 2.0
**License URL:** https://github.com/SheetJS/sheetjs/blob/master/LICENSE

**Usage:** Parse and generate Excel spreadsheets.

---

### turndown
**Component Type:** HTML to Markdown Converter
**Version:** ^7.2.2
**Repository:** https://github.com/mixmark-io/turndown
**License:** MIT License
**License URL:** https://github.com/mixmark-io/turndown/blob/master/LICENSE

**Usage:** Convert HTML content to Markdown format.

---

### DOMPurify
**Component Type:** XSS Sanitizer
**Version:** ^3.2.6
**Repository:** https://github.com/cure53/DOMPurify
**License:** MPL 2.0 (Mozilla Public License)
**License URL:** https://github.com/cure53/DOMPurify/blob/main/LICENSE

**Usage:** Sanitize HTML to prevent XSS attacks.

---

### marked
**Component Type:** Markdown Parser
**Version:** ^15.0.12
**Repository:** https://marked.js.org/
**License:** MIT License
**License URL:** https://github.com/markedjs/marked/blob/master/LICENSE

**Usage:** Parse and render Markdown content.

---

## Mobile Development

### Flutter
**Component Type:** UI Toolkit for Cross-Platform Apps
**Version:** 3.10.8+ (SDK requirement)
**Repository:** https://flutter.dev/
**License:** BSD 3-Clause
**License URL:** https://github.com/flutter/flutter/blob/master/LICENSE

**Usage:** Cross-platform mobile application framework for Android, iOS, Web, and desktop.

---

### Dart
**Component Type:** Programming Language for Flutter
**Version:** 3.10.8+
**Repository:** https://dart.dev/
**License:** BSD 3-Clause
**License URL:** https://github.com/dart-lang/sdk/blob/main/LICENSE

**Usage:** Programming language for Flutter mobile app development.

---

## Monitoring & Logging

### Winston
**Component Type:** Logger for Node.js
**Version:** ^3.17.0
**Repository:** https://github.com/winstonjs/winston
**License:** MIT License
**License URL:** https://github.com/winstonjs/winston/blob/master/LICENSE

**Usage:** Multi-transport async logging library.

---

### winston-daily-rotate-file
**Component Type:** Log Rotation Transport
**Version:** ^5.0.0
**Repository:** https://github.com/winstonjs/winston-daily-rotate-file
**License:** MIT License

**Usage:** Daily log file rotation for Winston.

---

### express-winston
**Component Type:** Express.js Middleware for Winston
**Version:** ^4.2.0
**Repository:** https://github.com/bithavoc/express-winston
**License:** MIT License

**Usage:** HTTP request logging middleware for Express.

---

### Morgan
**Component Type:** HTTP Request Logger
**Version:** ^1.10.0
**Repository:** https://github.com/expressjs/morgan
**License:** MIT License

**Usage:** HTTP request logger middleware for Node.js.

---

## Python Libraries

### httpx
**Component Type:** Async HTTP Client
**Repository:** https://www.python-httpx.org/
**License:** Apache 2.0 (or BSD 3-Clause)
**License URL:** https://github.com/encode/httpx/blob/master/LICENSE

**Usage:** Modern async HTTP client for Python.

---

### requests
**Component Type:** HTTP Library
**Repository:** https://requests.readthedocs.io/
**License:** Apache 2.0
**License URL:** https://github.com/psf/requests/blob/main/LICENSE

**Usage:** Synchronous HTTP library for Python.

---

### pytest
**Component Type:** Test Framework
**Version:** 9.1.1
**Repository:** https://pytest.org/
**License:** MIT License
**License URL:** https://github.com/pytest-dev/pytest/blob/main/LICENSE

**Usage:** Test runner of the Python components (the agent service ships it as
a test-only dependency; it never reaches a runtime image).

---

### langdetect
**Component Type:** Language Detection Library
**Version:** 1.0.9 (Python — the pinned version of the agent service and the overlay); ^0.2.1 (npm — document-repository)
**Repository:** https://github.com/Mimino666/langdetect
**License:** Apache 2.0 (or BSD-like)
**License URL:** https://github.com/Mimino666/langdetect/blob/master/LICENSE

**Usage:** Automatic language detection for text content. The Python pin is
license-verified for its exact version in
`docs/dependencies/agent-service-dependency-evidence.json` (the artifact
LICENSE carries the vendored Cybozu Labs Apache-2.0 NOTICE).

---

### rank_bm25
**Component Type:** BM25 Ranking Algorithm
**Repository:** https://github.com/dorianbrown/rank_bm25
**License:** MIT License

**Usage:** BM25 ranking for hybrid search retrieval.

---

### OpenTelemetry Python (agent service)
**Component Type:** Observability SDK and exporters
**Version:** api/sdk/exporter/proto 1.27.0; instrumentation packages 0.48b0
**Repository:** https://github.com/open-telemetry/opentelemetry-python
**License:** Apache 2.0
**License URL:** https://github.com/open-telemetry/opentelemetry-python/blob/main/LICENSE

**Usage:** Traces and metrics for `components/agent-service`, exported over
OTLP/HTTP to the in-cluster collector. The instrumentation packages are a
pre-1.0 release - the exact versions the OPEA overlay already ships - and
carry an explicit operational-risk acceptance in
`docs/dependencies/agent-service-dependency-evidence.json`.

---

### Pydantic / Pydantic Core
**Component Type:** Data Validation Library
**Version:** 2.14.4 / 2.50.5
**Repository:** https://github.com/pydantic/pydantic
**License:** MIT License
**License URL:** https://github.com/pydantic/pydantic/blob/main/LICENSE

**Usage:** Request and response models of the FastAPI services. Pydantic Core
ships a compiled Rust binary; it performs no network access.

---

### Agent service dependency tree
**Component Type:** Python dependency tree
**Version:** the exact pins of `components/agent-service/requirements.txt`
**License:** MIT, Apache 2.0, BSD 2-Clause, BSD 3-Clause, MPL 2.0, ISC and
  PSF-2.0 - per package, verified for the exact version
**License URL:** `docs/dependencies/agent-service-dependency-evidence.json`

**Usage:** The full pin set of `components/agent-service` (FastAPI, Uvicorn,
Starlette, the OpenTelemetry packages, Pydantic and their transitive
dependencies). The per-package licence, its source, the defaults audit and
the release channel are recorded in
[`docs/dependencies/agent-service-dependency-evidence.json`](docs/dependencies/agent-service-dependency-evidence.json);
the procedure that produced it is
[`docs/dependencies/pre-adoption-checklist.md`](docs/dependencies/pre-adoption-checklist.md).

---

### python-arango
**Component Type:** ArangoDB Python Driver
**Version:** 8.3.7
**Repository:** https://github.com/joowani/python-arango
**License:** MIT License
**License URL:** https://github.com/joowani/python-arango/blob/main/LICENSE

**Usage:** The ArangoDB driver of the agent service's retrieval adapters
(`search_knowledge`). The JavaScript driver above (arangojs) serves the Node
services; this is the Python twin on the agent path.

---

### kneed
**Component Type:** Knee-Point Detection
**Version:** 0.9.0
**Repository:** https://github.com/arlyon/kneed
**License:** BSD 3-Clause
**License URL:** `docs/dependencies/agent-service-dependency-evidence.json`
(licence file sha256 recorded)

**Usage:** The `knee_threshold` reranking-selection strategy of the agent
service — the same pin the deployed reranker serves (behavior frozen to the
recorded V02 semantics).

---

### NumPy
**Component Type:** Numerical Library
**Version:** 1.26.4
**Repository:** https://github.com/numpy/numpy
**License:** BSD 2-Clause
**License URL:** https://github.com/numpy/numpy/blob/main/LICENSE.txt

**Usage:** The adaptive selection math of the agent service and the reranker.

---

### SciPy
**Component Type:** Scientific Computing Library
**Version:** 1.17.1
**Repository:** https://github.com/scipy/scipy
**License:** BSD 2-Clause
**License URL:** https://github.com/scipy/scipy/blob/main/LICENSE.txt

**Usage:** kneed's dependency tree on the agent service (the knee-detection math).

---

### setuptools
**Component Type:** Python Packaging Runtime Dependency
**Version:** 81.0.0
**Repository:** https://github.com/pypa/setuptools
**License:** MIT License
**License URL:** https://github.com/pypa/setuptools/blob/main/LICENSE

**Usage:** A RUNTIME dependency of the agent service: the OpenTelemetry
instrumentation 0.48b0 line resolves its entry points through `pkg_resources`,
which setuptools ships. 81.0.0 is the newest release that still carries it
(setuptools 82 dropped `pkg_resources`).

---

### rag-benchmarks eval tree
**Component Type:** Python dependency tree (eval-only, never in a runtime image)
**Version:** the 7 top-level pins of `tests/rag-benchmarks/eval/requirements.txt`
**License:** MIT, Apache 2.0 and BSD 3-Clause - per package, verified for the exact version
**License URL:** `docs/dependencies/rag-benchmarks-eval-dependency-evidence.json`

**Usage:** The evaluation harness's judge stack (ragas, the langchain
integration packages, the OpenAI SDK, openpyxl). The per-package licence, its
source (sha256 where the artifact licence file is the proof) and the defaults
audit are recorded in
[`docs/dependencies/rag-benchmarks-eval-dependency-evidence.json`](docs/dependencies/rag-benchmarks-eval-dependency-evidence.json).
The TRANSITIVE trees of this file are unpinned and are recorded as an open
supply-chain gap in
[`docs/baselines/v07b-license-assessment-2026-11-24.md`](docs/baselines/v07b-license-assessment-2026-11-24.md).

---

## Node.js Libraries

### arangojs
**Component Type:** ArangoDB JavaScript Driver
**Version:** ^8.8.1, ^10.1.2
**Repository:** https://github.com/arangodb/arangodb-js
**License:** Apache 2.0
**License URL:** https://github.com/arangodb/arangodb-js/blob/main/LICENSE

**Usage:** Official JavaScript driver for ArangoDB.

---

### ioredis
**Component Type:** Redis Client for Node.js
**Version:** ^5.8.2
**Repository:** https://github.com/luin/ioredis
**License:** MIT License
**License URL:** https://github.com/luin/ioredis/blob/main/LICENSE

**Usage:** Redis client for Node.js with cluster support.

---

### axios
**Component Type:** HTTP Client
**Version:** ^1.10.0, ^0.27.2, ^1.6.0
**Repository:** https://axios-http.com/
**License:** MIT License
**License URL:** https://github.com/axios/axios/blob/main/LICENSE

**Usage:** Promise-based HTTP client for browser and Node.js.

---

### multer
**Component Type:** File Upload Middleware
**Version:** ^1.4.5-lts.1
**Repository:** https://github.com/expressjs/multer
**License:** MIT License

**Usage:** Multipart/form-data handling for file uploads.

---

### joi
**Component Type:** Schema Validation
**Version:** ^17.9.2, ^17.11.0
**Repository:** https://github.com/hapijs/joi
**License:** BSD 3-Clause

**Usage:** Object schema validation and description language.

---

### socket.io
**Component Type:** Real-Time Communication
**Version:** ^4.8.1
**Repository:** https://socket.io/
**License:** MIT License

**Usage:** Real-time bidirectional event-based communication.

---

### nodemailer
**Component Type:** Email Sending Library
**Version:** ^6.10.0
**Repository:** https://nodemailer.com/
**License:** MIT License

**Usage:** Email sending for notifications and user communication.

---

### express-rate-limit
**Component Type:** Rate Limiting Middleware
**Version:** ^7.5.0
**Repository:** https://github.com/nfriedly/express-rate-limit
**License:** MIT License

**Usage:** Rate limiting to prevent abuse.

---

### express-validator
**Component Type:** Request Validation Middleware
**Version:** ^7.0.1
**Repository:** https://express-validator.github.io/
**License:** MIT License

**Usage:** Request validation middleware for Express.

---

### geoip-lite
**Component Type:** Geolocation Lookup
**Version:** ^1.4.10
**Repository:** https://github.com/bluesmoon/node-geoip
**License:** BSD 3-Clause
**License URL:** https://github.com/bluesmoon/node-geoip/blob/master/LICENSE

**Usage:** IP address geolocation lookup.

---

### async-retry
**Component Type:** Retry Logic
**Version:** ^1.3.3
**Repository:** https://github.com/vercel/async-retry
**License:** MIT License

**Usage:** Retry logic for async operations with exponential backoff.

---

### swagger-jsdoc
**Component Type:** Swagger/OpenAPI Documentation
**Version:** ^6.2.8
**Repository:** https://github.com/Surnet/swagger-jsdoc
**License:** MIT License

**Usage:** Generate OpenAPI (Swagger) specification from JSDoc comments.

---

### swagger-ui-express
**Component Type:** Swagger UI Middleware
**Version:** ^5.0.1, ^5.0.0
**Repository:** https://github.com/scottie1984/swagger-ui-express
**License:** MIT License

**Usage:** Serve Swagger UI for API documentation.

---

### compression
**Component Type:** Response Compression Middleware
**Version:** ^1.7.4
**Repository:** https://github.com/expressjs/compression
**License:** MIT License

**Usage:** Gzip compression for HTTP responses.

---

### cors
**Component Type:** CORS Middleware
**Version:** ^2.8.5
**Repository:** https://github.com/expressjs/cors
**License:** MIT License

**Usage:** Enable CORS for cross-origin requests.

---

### uuid
**Component Type:** UUID Generator
**Version:** ^9.0.0, ^9.0.1
**Repository:** https://github.com/uuidjs/uuid
**License:** MIT License

**Usage:** Generate RFC-compliant UUIDs.

---

### archiver
**Component Type:** ZIP Archiving Library
**Version:** ^7.0.1, 7.0.1
**Repository:** https://github.com/archiverjs/node-archiver
**License:** MIT License

**Usage:** Create ZIP archives for bulk downloads.

---

### clamscan
**Component Type:** ClamAV Wrapper for Node.js
**Version:** ^2.4.0
**Repository:** https://github.com/nstuff/clamscan
**License:** MIT License

**Usage:** Node.js wrapper for ClamAV virus scanning.

---

### file-type
**Component Type:** File Type Detection
**Version:** ^18.7.0
**Repository:** https://github.com/sindresorhus/file-type
**License:** MIT License

**Usage:** Detect file type from buffer/magic numbers.

---

### mime-types
**Component Type:** MIME Type Lookup
**Version:** ^2.1.35
**Repository:** https://github.com/jshttp/mime-types
**License:** MIT License

**Usage:** MIME type mapping based on file extension.

---

### cheerio
**Component Type:** HTML Parser
**Version:** ^1.0.0-rc.12
**Repository:** https://cheerio.js.org/
**License:** MIT License

**Usage:** Fast and flexible HTML parsing (jQuery-like syntax).

---

### yamljs
**Component Type:** YAML Parser
**Version:** ^0.3.0
**Repository:** https://github.com/jeremyfa/yaml.js
**License:** MIT License

**Usage:** Parse and stringify YAML files.

---

### body-parser
**Component Type:** Body Parsing Middleware
**Version:** ^1.20.2
**Repository:** https://github.com/expressjs/body-parser
**License:** MIT License

**Usage:** Parse HTTP request body.

---

### luxon
**Component Type:** DateTime Library
**Version:** ^3.6.1
**Repository:** https://moment.github.io/luxon/
**License:** MIT License

**Usage:** Modern DateTime library for JavaScript.

---

### validator
**Component Type:** String Validation
**Version:** ^13.15.0
**Repository:** https://github.com/validatorjs/validator.js
**License:** MIT License

**Usage:** String validation and sanitization.

---

### inquirer
**Component Type:** Interactive CLI
**Version:** ^12.9.2
**Repository:** https://github.com/SBoudrias/Inquirer.js
**License:** MIT License

**Usage:** Interactive command-line interface for setup scripts.

---

### yargs
**Component Type:** Command Line Parser
**Version:** ^18.0.0
**Repository:** https://yargs.js.org/
**License:** MIT License

**Usage:** Command-line argument parser.

---

### dotenv
**Component Type:** Environment Variable Loader
**Version:** ^16.6.1, ^16.3.1
**Repository:** https://github.com/motdotla/dotenv
**License:** BSD 2-Clause

**Usage:** Load environment variables from .env file.

---

## Vue.js Libraries

### vue-i18n
**Component Type:** Internationalization Plugin
**Version:** ^9.14.2
**Repository:** https://vue-i18n.intlify.dev/
**License:** MIT License

**Usage:** Internationalization and localization for Vue.js.

---

### vue3-apexcharts
**Component Type:** Chart Component
**Version:** ^1.8.0
**Repository:** https://github.com/apexcharts/vue3-apexcharts
**License:** MIT License

**Usage:** Chart.js integration for Vue 3.

---

### apexcharts
**Component Type:** Charting Library
**Version:** ^4.5.0
**Repository:** https://apexcharts.com/
**License:** MIT License
**License URL:** https://github.com/apexcharts/apexcharts.js/blob/master/LICENSE

**Usage:** Modern JavaScript charting library.

---

### chart.js
**Component Type:** Charting Library
**Version:** ^3.9.1
**Repository:** https://www.chartjs.org/
**License:** MIT License

**Usage:** Simple yet flexible JavaScript charting.

---

### echarts
**Component Type:** Charting Library
**Version:** ^5.6.0
**Repository:** https://echarts.apache.org/
**License:** Apache 2.0
**License URL:** https://github.com/apache/echarts/blob/main/LICENSE

**Usage:** Enterprise-grade JavaScript visualization library.

---

### d3
**Component Type:** Data Visualization Library
**Version:** ^7.9.0
**Repository:** https://d3js.org/
**License:** ISC License
**License URL:** https://github.com/d3/d3/blob/main/LICENSE

**Usage:** Data-driven documents for complex visualizations.

---

### jspdf
**Component Type:** PDF Generation Library
**Version:** ^3.0.1
**Repository:** https://github.com/parallax/jsPDF
**License:** MIT License

**Usage:** Generate PDF documents in JavaScript.

---

### jsdom
**Component Type:** DOM Implementation
**Version:** ^26.1.0
**Repository:** https://github.com/jsdom/jsdom
**License:** MIT License

**Usage:** DOM standard implementation for Node.js.

---

### @fortawesome/fontawesome-free
**Component Type:** Icon Font Library
**Version:** ^6.7.2
**Repository:** https://fontawesome.com/
**License:**
- Icons: CC BY 4.0 (Creative Commons Attribution 4.0)
- Fonts: SIL OFL 1.1 (Open Font License)
- Code: MIT License

**License URL:** https://fontawesome.com/license/free

**Usage:** Scalable vector icons and icon fonts.

---

## Flutter/Dart Libraries

### http
**Component Type:** HTTP Client Library
**Version:** ^1.6.0
**Repository:** https://pub.dev/packages/http
**License:** BSD 3-Clause

**Usage:** HTTP requests for Flutter applications.

---

### crypto
**Component Type:** Cryptographic Operations
**Version:** ^3.0.3
**Repository:** https://pub.dev/packages/crypto
**License:** BSD 3-Clause

**Usage:** Hashing and cryptographic operations.

---

### shared_preferences
**Component Type:** Local Storage
**Version:** ^2.2.2
**Repository:** https://pub.dev/packages/shared_preferences
**License:** BSD 3-Clause

**Usage:** Persistent key-value storage for Flutter.

---

### connectivity_plus
**Component Type:** Network Connectivity
**Version:** ^7.0.0
**Repository:** https://pub.dev/packages/connectivity_plus
**License:** BSD 3-Clause

**Usage:** Check network connectivity status for offline features.

---

### flutter_markdown
**Component Type:** Markdown Rendering
**Version:** ^0.7.7
**Repository:** https://pub.dev/packages/flutter_markdown
**License:** BSD 3-Clause

**Usage:** Render Markdown content in Flutter apps.

---

### pdf
**Component Type:** PDF Generation
**Version:** ^3.11.1
**Repository:** https://pub.dev/packages/pdf
**License:** BSD 3-Clause

**Usage:** Create PDF documents in Flutter.

---

### printing
**Component Type:** PDF Printing/Export
**Version:** ^5.13.1
**Repository:** https://pub.dev/packages/printing
**License:** BSD 3-Clause

**Usage:** Print and export PDF documents.

---

### path_provider
**Component Type:** File System Paths
**Version:** ^2.1.4
**Repository:** https://pub.dev/packages/path_provider
**License:** BSD 3-Clause

**Usage:** Access file system directories for saving files.

---

### url_launcher
**Component Type:** URL Launcher
**Version:** ^6.3.1
**Repository:** https://pub.dev/packages/url_launcher
**License:** BSD 3-Clause

**Usage:** Open URLs in browser or external applications.

---

### cached_network_image
**Component Type:** Cached Images
**Version:** ^3.3.1
**Repository:** https://pub.dev/packages/cached_network_image
**License:** BSD 3-Clause

**Usage:** Display and cache network images.

---

### flutter_svg
**Component Type:** SVG Rendering
**Version:** ^2.1.0
**Repository:** https://pub.dev/packages/flutter_svg
**License:** BSD 3-Clause

**Usage:** Render SVG images in Flutter.

---

### image_picker
**Component Type:** Image Selection
**Version:** ^1.1.2
**Repository:** https://pub.dev/packages/image_picker
**License:** BSD 3-Clause

**Usage:** Select images from gallery or camera.

---

### file_picker
**Component Type:** File Selection
**Version:** ^10.3.10
**Repository:** https://pub.dev/packages/file_picker
**License:** Apache 2.0

**Usage:** Select files from device storage.

---

### country_picker
**Component Type:** Country Selection
**Version:** ^2.0.26
**Repository:** https://pub.dev/packages/country_picker
**License:** Apache 2.0

**Usage:** Country selection dropdown for Flutter.

---

### package_info_plus
**Component Type:** App Package Information
**Version:** ^9.0.0
**Repository:** https://pub.dev/packages/package_info_plus
**License:** BSD 3-Clause

**Usage:** Query app version and build information.

---

## Additional Dependencies

### Google Cloud Translation API
**Component Type:** Cloud Translation Service
**Version:** ^9.1.0
**Repository:** https://cloud.google.com/translate
**License:** Apache 2.0

**Usage:** Google Cloud Translation API client library for Node.js.
**Note:** This is a client library; actual usage requires Google Cloud account and may incur charges.

---

## License Summary

### Permissive Licenses (Most Business-Friendly)
- **MIT License**: Vue.js, Express, Axios, Socket.io,大多数Node.js库, Flutter, Dart; the BAAI bge models (bge-large-en-v1.5, bge-reranker-v2-m3)
- **Apache 2.0**: OPEA, vLLM, ArangoDB 3.12.x, Kong, Hugging Face libraries, Keycloak, Nginx, Kubernetes, ECharts; IBM Granite (granite-4.1-8b)
- **BSD 2-Clause/3-Clause**: Redis, PostgreSQL, NGINX, ioredis, geoip-lite, Flutter/Dart packages
- **ISC License**: D3.js

### Custom / Restricted-Terms Model Licences
- **Gemma Terms of Use**: google/gemma-3-4b-it (the translation leg) — restricted terms, see the AI Models section and `docs/baselines/v07b-license-assessment-2026-11-24.md`

### Copyleft Licenses (Require Attribution/Derivative Works)
- **GPL 2.0**: ClamAV - requires derivative works to be licensed under GPL
- **MPL 2.0**: DOMPurify - file-level copyleft

### Non-Open Source / Custom Licenses
- **SSPL**: MongoDB 4.4 - not OSI-approved, may require commercial license
- **BSL**: ArangoDB 4.x+ - usage limits may apply (e.g., >100GB data)

### Creative Commons
- **CC BY 4.0**: FontAwesome icons (requires attribution)
- **SIL OFL 1.1**: FontAwesome fonts

---

## Attribution Requirements

### FontAwesome (Free)
**Requirement**: Attribution required for free version
- Icons: CC BY 4.0 - must provide attribution
- Fonts: SIL OFL 1.1
- Code: MIT

**Attribution Format**:
```
Font Awesome Free by @fontawesome - https://fontawesome.com
License: https://fontawesome.com/license/free (Icons: CC BY 4.0, Fonts: SIL OFL 1.1, Code: MIT License)
```

---

## Important License Change Warnings

### ArangoDB
- **Version 3.12.4 (Used)**: Apache 2.0 - Free for all use cases
- **Version 4.0+**: Changed to BSL (Business Source License) with usage restrictions
- **Recommendation**: Carefully evaluate before upgrading beyond 3.12.x

### MongoDB
- **Version 4.4 (Used)**: SSPL - Not OSI-approved open source
- **Impact**: May require commercial license for production use cases
- **Alternative**: Consider MongoDB alternatives (PostgreSQL, etc.) for strict open-source compliance

---

## Compliance Recommendations

1. **Review All Licenses**: Each organization should review these licenses in the context of their specific use case
2. **Maintain Attribution**: Keep all copyright notices and license text in deployed code
3. **Monitor Version Updates**: Check for license changes when upgrading dependencies
4. **Document Usage**: Maintain internal records of third-party component usage
5. **Consider Commercial Licenses**: For business-critical applications, consider commercial licenses for components with restrictive licenses

---

## General Disclaimer

**GENIE.AI contains and references intellectual property owned by third parties ("Third Party IP"). Acceptance of these License Terms does not grant any rights to Third Party IP.**

**ITU grants no rights over third-party IP. Users are responsible for:**
- Complying with all applicable third-party license terms
- Obtaining any necessary licenses or permissions
- Providing required attributions
- Respecting all license restrictions and requirements

**This document is provided for informational purposes only and does not constitute legal advice. Organizations should consult with legal counsel to ensure compliance with all applicable licenses.**

---

## Version Information

**Document Version:** 1.0
**Last Updated:** 2025-02-25
**Project:** GENIE.AI
**Maintained By:** ITU (International Telecommunication Union)

---

## Additional Resources

- [Open Source Initiative (OSI)](https://opensource.org/licenses)
- [SPDX License List](https://spdx.org/licenses/)
- [ChooseALicense.com](https://choosealicense.com/)
- [TLDRLegal](https://www.tldrlegal.com/)
