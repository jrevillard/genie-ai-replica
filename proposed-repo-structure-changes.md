UNICC-ITU Genie AI Repository Refactoring Plan
Overview
The Huduma AI framework serves as a general platform for developing Retrieval-Augmented Generation (RAG) based chatbots for public services and other applications. To support the addition of a new document repository component, enhance modularity, enable third-party collaboration (e.g., NOOR-AI-AL-TAFSIR), and ensure compatibility with the evolving Open Platform for Enterprise AI (OPEA) project, the GitLab repository structure needs refactoring. This plan proposes a modular, scalable, and maintainable structure within a single GitLab repository, accommodating existing components, shared libraries, and third-party workflows.
Objectives

Modularity: Organize components (backend, frontend, document repository, etc.) into self-contained directories.
Shared Libraries: Extract reusable code for Node.js apps and potentially the frontend into a shared module.
Third-Party Collaboration: Support dedicated branches (e.g., noor-al-tafsir) with selective merging, as outlined in the provided collaboration process.
OPEA Integration: Isolate OPEA configurations and extensions for easy upgrades.
Scalability: Allow addition of new components without restructuring.
Documentation: Centralize technical and collaboration documentation.

Current Components

OPEA: Open Platform for Enterprise AI (3rd-party project, opea.dev, GitHub).
OPEA Extensions: Custom microservices in /Microservices and configurations in /opea-config.
API Gateway Solution: Nginx, Kong, and Keycloak configurations in /api-gateway-solution, running on a bastion host.
Huduma AI Backend: Node.js Express server in /examples/gov-chat-backend.
Huduma AI Frontend: Vue 3 application in /examples/gov-chat-frontend.

New Component

Document Repository: A new Node.js Express service to manage original documents, chunking, ingestion into vector/graph databases, and LLM fine-tuning. It will expose APIs for OPEA and frontend consumption, reusing libraries from the existing backend.

Proposed Repository Structure
The refactored structure organizes the repository into clear, modular directories at the root level, separating core components, shared libraries, configurations, and documentation.
Root Directory Structure
/unicc-itu-genie-ai
├── /api-gateway-solution            # API gateway configurations (nginx, Kong, Keycloak)
├── /components                      # Core application components
│   ├── /gov-chat-backend           # Huduma AI Node.js backend
│   ├── /gov-chat-frontend          # Huduma AI Vue 3 frontend
│   ├── /document-repository        # New document repository Node.js service
├── /configs                        # Configuration files for OPEA and other services
│   ├── /opea-config                # OPEA and vLLM configurations
├── /docs                           # Documentation (technical, collaboration, APIs)
├── /microservices                  # Custom OPEA microservices/extensions
├── /opea                           # OPEA source or submodule (for reference or local mods)
├── /shared                         # Shared libraries for Node.js apps and frontend
├── /tests                          # End-to-end and integration tests
├── .gitignore                      # Git ignore file
├── docker-compose.yaml             # Top-level Docker Compose for local dev
├── README.md                       # Repository overview and setup instructions
├── package.json                    # Monorepo package management (optional)

Key Features

Components Directory:

Contains self-contained applications: gov-chat-backend, gov-chat-frontend, and document-repository.
Each component includes its own package.json, Dockerfile, and structure (/src, /tests, /config).
document-repository mirrors gov-chat-backend structure, reusing shared libraries.


Shared Directory:

Houses reusable code for Node.js apps (e.g., database connectors, vector store utilities, LLM helpers).
Subdirectories: /shared/lib (utilities), /shared/models (schemas), /shared/middleware (Express middleware).
Potential /shared/frontend for frontend code (e.g., API clients).
Managed as an internal npm package or via relative imports.


API Gateway Solution:

Retains /api-gateway-solution with docker-compose.yaml, nginx, Kong, and Keycloak configs.
Includes testing and deployment scripts for the bastion host.


OPEA Integration:

/opea: Optionally includes OPEA source as a Git submodule or reference for local modifications.
/microservices: Custom OPEA extensions, isolated for maintainability.
/configs/opea-config: Versioned OPEA and vLLM configurations.
Upgrades managed by updating /opea and testing configs.


Configs Directory:

Centralizes OPEA, vLLM, and other service configurations.
Supports versioning for OPEA release compatibility.


Docs Directory:

Stores collaboration guidelines, API documentation, and setup guides.
Facilitates third-party onboarding and tracks API changes.


Tests Directory:

Contains end-to-end and integration tests for the framework.
Includes suites for API gateway, backend, frontend, and document repository.


Third-Party Collaboration:

Supports noor-al-tafsir branch with selective cherry-picking from main.
Components support feature branches (e.g., noor-al-tafsir/backend-feature-x).
UNICC ITU reviews merge requests to main.


Monorepo Management:

Optional root package.json with npm workspaces or pnpm for dependency management.
Alternatively, each component manages its own dependencies.


Docker Compose:

Top-level docker-compose.yaml orchestrates local development, linking all services.



Detailed Directory Structure
/unicc-itu-genie-ai
├── /api-gateway-solution
│   ├── /config
│   │   ├── nginx.conf
│   │   ├── kong.yml
│   │   ├── keycloak.json
│   ├── docker-compose.yaml
│   ├── README.md
├── /components
│   ├── /gov-chat-backend
│   │   ├── /src
│   │   │   ├── /controllers
│   │   │   ├── /routes
│   │   │   ├── /services
│   │   ├── /config
│   │   ├── /tests
│   │   ├── package.json
│   │   ├── Dockerfile
│   │   ├── README.md
│   ├── /gov-chat-frontend
│   │   ├── /src
│   │   │   ├── /components
│   │   │   ├── /views
│   │   │   ├── /assets
│   │   ├── /public
│   │   ├── package.json
│   │   ├── Dockerfile
│   │   ├── README.md
│   ├── /document-repository
│   │   ├── /src
│   │   │   ├── /controllers
│   │   │   ├── /routes
│   │   │   ├── /services
│   │   ├── /config
│   │   ├── /tests
│   │   ├── package.json
│   │   ├── Dockerfile
│   │   ├── README.md
├── /configs
│   ├── /opea-config
│   │   ├── vllm-config.yaml
│   │   ├── opea-pipeline.yaml
│   │   ├── README.md
├── /docs
│   ├── collaboration-guidelines.md
│   ├── api-docs.md
│   ├── setup-guide.md
├── /microservices
│   ├── /opea-extension-1
│   │   ├── /src
│   │   ├── Dockerfile
│   │   ├── README.md
│   ├── /opea-extension-2
│   │   ├── /src
│   │   ├── Dockerfile
│   │   ├── README.md
├── /opea
│   ├── README.md  # Instructions for OPEA submodule or external dependency
├── /shared
│   ├── /lib
│   │   ├── database.js
│   │   ├── vector-store.js
│   │   ├── llm-utils.js
│   ├── /models
│   │   ├── document-schema.js
│   ├── /middleware
│   │   ├── auth.js
│   ├── /frontend
│   │   ├── api-client.js
│   ├── package.json
├── /tests
│   ├── e2e-tests.js
│   ├── integration-tests.js
├── .gitignore
├── docker-compose.yaml
├── README.md
├── package.json  # Optional for monorepo

Refactoring Existing Components
gov-chat-backend

Extract common utilities (e.g., vector store access, LLM API calls) to /shared/lib.
Restructure into /src (controllers, routes, services), /config, /tests.
Update to consume document-repository APIs for document retrieval.

gov-chat-frontend

Add API client in /shared/frontend for consistent backend and document repository interactions.
Maintain Vue 3 structure but document API dependencies in /docs.

document-repository

New Node.js Express app mirroring gov-chat-backend structure.
Uses /shared/lib for database and vector store utilities.
Exposes REST or GraphQL APIs for document ingestion, chunking, and retrieval.
Integrates with OPEA for LLM fine-tuning pipelines.

Implementation Details
Shared Library Setup

Create package.json in /shared with dependencies (e.g., pg, axios).
Example: Use npm link in /shared and npm link @unicc/shared in gov-chat-backend and document-repository for local development.

Document Repository APIs

Define REST endpoints (e.g., POST /documents/ingest, GET /documents/:id) in /components/document-repository/src/routes.
Document APIs in /docs/api-docs.md for frontend and OPEA consumption.

OPEA Upgrades

Track OPEA releases via GitHub.
Test new releases in a feature branch, updating /configs/opea-config and /microservices.

Third-Party Workflow

NOOR-AI-AL-TAFSIR works in noor-al-tafsir branch, creating feature branches per component (e.g., noor-al-tafsir/document-repository-feature).
UNICC ITU reviews merge requests to main, ensuring compatibility with shared libraries and OPEA.

Testing

Use Jest for unit tests in each component.
Use Cypress or Playwright in /tests for end-to-end testing of frontend-backend-document repository interactions.

Sample Files
.gitignore
node_modules/
dist/
.env
*.log
/build/

README.md
# UNICC-ITU Genie AI Repository

This repository contains the Huduma AI framework for RAG-based chatbots, integrating OPEA, custom microservices, API gateway, backend, frontend, and a document repository service.

## Setup
1. Clone the repository: `git clone https://os.unicc.biz/un/itu/genie-ai`
2. Install dependencies: `npm install` (or per component)
3. Start services: `docker-compose up`

## Directory Structure
- `/components`: Core applications (backend, frontend, document repository)
- `/shared`: Reusable libraries for Node.js and frontend
- `/api-gateway-solution`: Nginx, Kong, Keycloak configs
- `/configs`: OPEA and vLLM configurations
- `/microservices`: Custom OPEA extensions
- `/docs`: Documentation for collaboration and APIs
- `/tests`: End-to-end and integration tests

## Collaboration
See `/docs/collaboration-guidelines.md` for third-party workflows (e.g., NOOR-AI-AL-TAFSIR).

docker-compose.yaml
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

Next Steps

Migrate Existing Code:

Move /examples/gov-chat-backend to /components/gov-chat-backend.
Move /examples/gov-chat-frontend to /components/gov-chat-frontend.
Move /Microservices to /microservices.
Move /opea-config to /configs/opea-config.


Extract Shared Code:

Move common utilities from gov-chat-backend to /shared.


Initialize Document Repository:

Create boilerplate Express app in /components/document-repository, reusing /shared libraries.


Update Docker Compose:

Include document-repository and ensure service dependencies.


Document:

Update /docs with structure, APIs, and collaboration guidelines.


Test:

Validate setup locally and test third-party workflows.



Conclusion
This refactored structure balances modularity, reusability, and collaboration needs while supporting OPEA integration and future scalability. For specific code (e.g., document-repository routes) or further refinements, please provide additional requirements.
