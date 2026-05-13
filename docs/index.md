# GENIE.AI Project Documentation Index

## Project Overview

- **Type:** Monorepo (Hybrid - JavaScript/Node.js + Flutter + Python + Infrastructure)
- **Primary Language:** JavaScript (Vue.js, Node.js), Dart (Flutter), Python (OPEA)
- **Architecture:** Microservices with API Gateway pattern

## Quick Reference

| Part | Type | Tech Stack | Root |
|------|------|------------|------|
| **Frontend** | Web | Vue.js 3.2+, Vuex 4, ApexCharts 5, Axios 1.13 | `components/gov-chat-frontend/` |
| **Backend** | API | Node.js 22, Express 4.18, ArangoDB 3.12, Redis 7 | `components/gov-chat-backend/` |
| **Document Repository** | Backend | Node.js 22, Express 4.18, Multer, ClamAV | `components/document-repository/` |
| **Mobile** | Mobile | Flutter 3.10+, Dart, Riverpod 3.0, SSE streaming | `mobile/genie_ai_mobile/` |
| **AI/ML (OPEA)** | Data/AI | Python 3.10+, FastAPI, LangChain, vLLM | `genie-ai-overlay/` |
| **API Gateway** | Infra | Kong, Nginx 1.28, PostgreSQL 13 (Kong DB) | `api-gateway-solution/` |

## Generated Documentation

### Core Documentation
- [Project Overview](./project-overview.md) — Executive summary, tech stack tables, architecture classification
- [Source Tree Analysis](./source-tree-analysis.md) — Annotated directory structure for all 6 parts
- [Integration Architecture](./integration-architecture.md) — 10 integration points, RAG pipeline, auth flow, SSE streaming diagrams
- [Development Guide](./development-guide.md) — Prerequisites, setup, build, test, lint commands per part

### Frontend (Vue.js)
- [UI Component Inventory](./ui-component-inventory-gov-chat-frontend.md) — 55 Vue components (12 DS primitives + 43 app components)
- [State Management](./state-management-gov-chat-frontend.md) — Vuex store architecture
- [Theme System](./theme-system.md) — OKLch design tokens, dark mode, DS component reference

### Backend (Node.js)
- [API Contracts](./api-contracts-gov-chat-backend.md) — 120+ endpoints across 14 route domains (incl. SSE streaming)

### Mobile (Flutter)
- [UI Component Inventory](./ui-component-inventory-mobile.md) — 76 Dart files (6 DS components, tokens, services, i18n)
- [Mobile Architecture](./mobile-architecture-genie-ai-mobile.md) — Flutter app architecture, flavors, auth flow

## Existing Documentation

### Project Root
- [README.md](../README.md) - Main project README
- [CONTRIBUTING.md](../CONTRIBUTING.md) - Contribution guidelines
- [CHANGELOG.md](../CHANGELOG.md) - Version history
- [STANDARDS.md](../STANDARDS.md) - Coding standards
- [THIRD_PARTY.md](../THIRD_PARTY.md) - Third-party dependencies

### Architecture
- [Architecture](../docs/architecture.md) - Main architecture documentation
- [Logging Architecture Evaluation](../docs/LOGGING-ARCHITECTURE-EVALUATION.md)
- [Translation Service Architecture](../components/gov-chat-backend/design/TRANSLATION-SERVICE-ARCHITECTURE.md)

### Deployment
- [Docker Compose Setup](../docs/docker-compose-setup.md)
- [Docker Swarm Setup](../docs/docker-swarm-setup.md)
- [Mobile Deployment Guide](../docs/mobile-deployment-guide.md)
- [Ansible Deployment](../deploy/ansible/README.md)

### Configuration
- [Keycloak Admin Guide](../docs/keycloak-admin-guide.md)
- [External IDP Integration Guide](../docs/external-idp-integration-guide.md)

### Testing
- [E2E Tests README](../docs/e2e-tests/README.md)
- [E2E Epic 1 - Keycloak Foundation](../docs/e2e-tests/epic1-keycloak-foundation.md)
- [E2E Epic 2 - Secure API Access](../docs/e2e-tests/epic2-secure-api-access.md)
- [E2E Epic 3 - Session Lifecycle](../docs/e2e-tests/epic3-session-lifecycle-gdpr.md)
- [E2E Clean Start](../docs/e2e-tests/00-clean-start.md)

## Getting Started

### Quick Start (Docker Compose)
```bash
# 1. Clone and configure
git clone <repository-url>
cd GENIE.AI
cp env .env
# Edit .env with your secrets

# 2. Deploy core services
docker compose up -d

# 3. Access
# Frontend: http://localhost
# Keycloak Admin: http://localhost/auth/admin
```

### Development Setup
```bash
# Backend
cd components/gov-chat-backend
npm install
npm run dev

# Frontend
cd components/gov-chat-frontend
npm install
npm run serve

# Mobile
cd mobile/genie_ai_mobile
flutter pub get
flutter run
```

## Component Communication Flow

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Frontend  │     │    Mobile   │     │   Document  │
│   (Vue.js)  │     │  (Flutter)  │     │ Repository  │
└──────┬──────┘     └──────┬──────┘     └──────┬──────┘
       │                   │                     │
       └─────────┬─────────┴─────────────────────┘
                 │
                 ▼
         ┌───────────────┐
         │   Kong Gateway │
         │   (NGINX)      │
         └───────┬───────┘
                 │
         ┌───────▼────────┐
         │   Backend API  │
         │   (Express)    │
         └───────┬────────┘
                 │
      ┌──────────┼──────────┐
      ▼          ▼          ▼
┌─────────┐ ┌────────┐ ┌──────────┐
│ArangoDB │ │ Redis  │ │  Keycloak│
└─────────┘ └────────┘ └──────────┘
                 │
         ┌───────▼────────┐
         │  OPEA Services │
         │  (AI/ML Layer) │
         └────────────────┘
```

## Documentation Status

**Generated:** 10 documents (Project Overview, Source Tree, Integration Architecture, Development Guide, API Contracts, Frontend Components, Mobile Components, State Management, Theme System, Mobile Architecture)

**Existing:** 45+ documentation files (README, architecture, deployment, E2E tests, Keycloak guides)

**Total:** 55+ documentation files across the project

---

_Last updated: 2026-05-13_
