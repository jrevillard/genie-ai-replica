# UNICC-ITU Genie AI Repository Refactoring Plan

## Overview

The **Huduma AI framework** is a platform for developing Retrieval-Augmented Generation (RAG) based chatbots for public services. To support a new document repository component, improve modularity, enable third-party collaboration (e.g., NOOR-AI-AL-TAFSIR), and integrate with the Open Platform for Enterprise AI (OPEA), the GitLab repository structure requires refactoring. This plan proposes a **modular, scalable, and maintainable structure** within a single GitLab repository.

## Objectives

- **Modularity**: Organize components into self-contained directories.
- **Shared Libraries**: Extract reusable code for Node.js apps and frontend.
- **Third-Party Collaboration**: Support dedicated branches with selective merging.
- **OPEA Integration**: Isolate OPEA configurations for easy upgrades.
- **Scalability**: Allow new components without restructuring.
- **Documentation**: Centralize technical and collaboration documentation.

## Current Components

1. **OPEA**: Open Platform for Enterprise AI ([opea.dev](https://opea.dev/), [GitHub](https://github.com/opea-project)).
2. **OPEA Extensions**: Custom microservices in `/Microservices` and configurations in `/opea-config`.
3. **API Gateway Solution**: Nginx, Kong, and Keycloak in `/api-gateway-solution`.
4. **Huduma AI Backend**: Node.js Express server in `/examples/gov-chat-backend`.
5. **Huduma AI Frontend**: Vue 3 application in `/examples/gov-chat-frontend`.

## New Component

- **Document Repository**: A Node.js Express service for managing documents, chunking, ingestion into vector/graph databases, and LLM fine-tuning. It exposes APIs for OPEA and frontend, reusing backend libraries.

## Proposed Repository Structure

The structure organizes components, shared libraries, configurations, and documentation into clear directories.

### Root Directory Structure

```plaintext
/unicc-itu-genie-ai
├── api-gateway-solution/        # API gateway configs (nginx, Kong, Keycloak)
├── components/                  # Core application components
│   ├── gov-chat-backend/       # Huduma AI Node.js backend
│   ├── gov-chat-frontend/      # Huduma AI Vue 3 frontend
│   ├── document-repository/    # Document repository Node.js service
├── configs/                    # Configuration files
│   ├── opea-config/            # OPEA and vLLM configs
├── docs/                       # Technical and collaboration docs
├── microservices/              # Custom OPEA extensions
├── opea/                       # OPEA source or submodule
├── shared/                     # Shared libraries for Node.js and frontend
├── tests/                      # End-to-end and integration tests
├── .gitignore                  # Git ignore file
├── docker-compose.yaml         # Docker Compose for local dev
├── README.md                   # Repository overview
├── package.json                # Optional monorepo management
```

### Key Features

- **Components**: Self-contained apps (`gov-chat-backend`, `gov-chat-frontend`, `document-repository`) with `package.json`, `Dockerfile`, and `/src`, `/tests`, `/config` subdirectories.
- **Shared**: Reusable Node.js code in `/shared/lib`, `/shared/models`, `/shared/middleware`. Potential `/shared/frontend` for API clients.
- **API Gateway**: Retains `/api-gateway-solution` with configs and scripts.
- **OPEA**: `/opea` for source reference, `/microservices` for extensions, `/configs/opea-config` for versioned configs.
- **Configs**: Centralizes OPEA and vLLM configurations.
- **Docs**: Stores collaboration guidelines, API docs, and setup guides.
- **Tests**: End-to-end and integration tests for the framework.
- **Collaboration**: Supports `noor-al-tafsir` branch with cherry-picking.
- **Monorepo**: Optional root `package.json` for dependency management.
- **Docker**: Top-level `docker-compose.yaml` for local development.

### Detailed Directory Structure

```plaintext
/unicc-itu-genie-ai
├── api-gateway-solution/
│   ├── config/
│   │   ├── nginx.conf
│   │   ├── kong.yml
│   │   ├── keycloak.json
│   ├── docker-compose.yaml
│   ├── README.md
├── components/
│   ├── gov-chat-backend/
│   │   ├── src/
│   │   │   ├── controllers/
│   │   │   ├── routes/
│   │   │   ├── services/
│   │   ├── config/
│   │   ├── tests/
│   │   ├── package.json
│   │   ├── Dockerfile
│   │   ├── README.md
│   ├── gov-chat-frontend/
│   │   ├── src/
│   │   │   ├── components/
│   │   │   ├── views/
│   │   │   ├── assets/
│   │   ├── public/
│   │   ├── package.json
│   │   ├── Dockerfile
│   │   ├── README.md
│   ├── document-repository/
│   │   ├── src/
│   │   │   ├── controllers/
│   │   │   ├── routes/
│   │   │   ├── services/
│   │   ├── config/
│   │   ├── tests/
│   │   ├── package.json
│   │   ├── Dockerfile
│   │   ├── README.md
├── configs/
│   ├── opea-config/
│   │   ├── vllm-config.yaml
│   │   ├── opea-pipeline.yaml
│   │   ├── README.md
├── docs/
│   ├── collaboration-guidelines.md
│   ├── api-docs.md
│   ├── setup-guide.md
├── microservices/
│   ├── opea-extension-1/
│   │   ├── src/
│   │   ├── Dockerfile
│   │   ├── README.md
│   ├── opea-extension-2/
│   │   ├── src/
│   │   ├── Dockerfile
│   │   ├── README.md
├── opea/
│   ├── README.md
├── shared/
│   ├── lib/
│   │   ├── database.js
│   │   ├── vector-store.js
│   │   ├── llm-utils.js
│   ├── models/
│   │   ├── document-schema.js
│   ├── middleware/
│   │   ├── auth.js
│   ├── frontend/
│   │   ├── api-client.js
│   ├── package.json
├── tests/
│   ├── e2e-tests.js
│   ├── integration-tests.js
```

## Refactoring Existing Components

### gov-chat-backend
- Extract utilities (e.g., vector store, LLM APIs) to `/shared/lib`.
- Restructure into `/src` (controllers, routes, services), `/config`, `/tests`.
- Consume `document-repository` APIs.

### gov-chat-frontend
- Add API client in `/shared/frontend`.
- Maintain Vue 3 structure, document APIs in `/docs`.

### document-repository
- New Express app mirroring `gov-chat-backend`.
- Uses `/shared/lib` for database and vector store utilities.
- Exposes REST/GraphQL APIs for document management.
- Integrates with OPEA for LLM fine-tuning.

## Implementation Details

### Shared Library Setup
- `package.json` in `/shared` with dependencies (e.g., `pg`, `axios`).
- Use `npm link` for local development: `npm link` in `/shared`, `npm link @unicc/shared` in components.

### Document Repository APIs
- REST endpoints (e.g., `POST /documents/ingest`, `GET /documents/:id`) in `/components/document-repository/src/routes`.
- Documented in `/docs/api-docs.md`.

### OPEA Upgrades
- Track releases via [GitHub](https://github.com/opea-project).
- Test in feature branches, update `/configs/opea-config` and `/microservices`.

### Third-Party Workflow
- NOOR-AI-AL-TAFSIR uses `noor-al-tafsir` branch, creating feature branches (e.g., `noor-al-tafsir/backend-feature-x`).
- UNICC ITU reviews merge requests to `main`.

### Testing
- Jest for unit tests per component.
- Cypress/Playwright in `/tests` for end-to-end testing.

### Sample Files

#### `.gitignore`

```plaintext
node_modules/
dist/
.env
*.log
/build/
```

#### `README.md`

```markdown
# UNICC-ITU Genie AI Repository

The Huduma AI framework for RAG-based chatbots, integrating OPEA, microservices, API gateway, backend, frontend, and document repository.

## Setup

1. Clone: `git clone https://os.unicc.biz/un/itu/genie-ai`
2. Install: `npm install` (or per component)
3. Run: `docker-compose up`

## Structure

- `components/`: Backend, frontend, document repository
- `shared/`: Reusable libraries
- `api-gateway-solution/`: Nginx, Kong, Keycloak
- `configs/`: OPEA and vLLM configs
- `microservices/`: OPEA extensions
- `docs/`: Collaboration and API docs
- `tests/`: End-to-end and integration tests

## Collaboration

See `docs/collaboration-guidelines.md` for third-party workflows.
```

#### `docker-compose.yaml`

```yaml
version: '3.8'
services:
  api-gateway:
    build: ./api-gateway-solution
    ports:
      - "8080:8080"
  gov-chat-backend:
    build: ./components/gov-chat-backend
    ports:
      - "3000:3000"
    depends_on:
      - api-gateway
  gov-chat-frontend:
    build: ./components/gov-chat-frontend
    ports:
      - "8081:8081"
    depends_on:
      - api-gateway
  document-repository:
    build: ./components/document-repository
    ports:
      - "3001:3001"
    depends_on:
      - api-gateway
  opea-service:
    build: ./microservices/opea-extension-1
    depends_on:
      - api-gateway
```

## Next Steps

1. **Migrate Code**:
   - Move `/examples/gov-chat-backend` to `components/gov-chat-backend`.
   - Move `/examples/gov-chat-frontend` to `components/gov-chat-frontend`.
   - Move `/Microservices` to `microservices`.
   - Move `/opea-config` to `configs/opea-config`.

2. **Extract Shared Code**:
   - Move utilities from `gov-chat-backend` to `shared/`.

3. **Initialize Document Repository**:
   - Create Express app in `components/document-repository`.

4. **Update Docker Compose**:
   - Add `document-repository` service.

5. **Document**:
   - Update `docs/` with structure, APIs, and guidelines.

6. **Test**:
   - Validate locally and test collaboration workflows.

## Conclusion

This structure ensures **modularity**, **reusability**, and **collaboration** while supporting OPEA and scalability. For specific code or refinements, provide additional requirements.