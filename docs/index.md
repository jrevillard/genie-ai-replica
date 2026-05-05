# GENIE.AI Project Documentation Index

## Project Overview

- **Type:** Monorepo (Hybrid - JavaScript/Node.js + Flutter + Python + Infrastructure)
- **Primary Language:** JavaScript (Vue.js, Node.js), Dart (Flutter), Python (OPEA)
- **Architecture:** Microservices with API Gateway pattern

## Quick Reference

| Part | Type | Tech Stack | Root |
|------|------|------------|------|
| **Frontend** | Web | Vue.js 3, Express, ArangoDB | `components/gov-chat-frontend/` |
| **Backend** | API | Node.js 18+, Express 4.18, ArangoDB | `components/gov-chat-backend/` |
| **Mobile** | Mobile | Flutter 3.10+, Dart 3.10 | `mobile/genie_ai_mobile/` |
| **Document Repository** | Backend | Node.js, Express | `components/document-repository/` |
| **OPEA AI Layer** | Data/AI | Python 3.10, FastAPI | `genie-ai-overlay/` |
| **API Gateway** | Infra | Kong, NGINX | `api-gateway-solution/` |
| **Ansible Deploy** | Infra | Ansible Playbooks | `deploy/ansible/` |

## Generated Documentation

### Core Documentation
- [Project Overview](./project-overview.md) - Project summary, tech stack, getting started
- [Source Tree Analysis](./source-tree-analysis.md) - Annotated directory structure
- [Integration Architecture](./integration-architecture.md) - Multi-part communication patterns

### Frontend (Vue.js)
- [State Management](./state-management-gov-chat-frontend.md) - Vuex store architecture
- [UI Component Inventory](./ui-component-inventory-gov-chat-frontend.md) - 38 components catalog

### Backend (Node.js)
- [API Contracts](./api-contracts-gov-chat-backend.md) - REST endpoints documentation

### Mobile (Flutter)
- [Mobile Architecture](./mobile-architecture-genie-ai-mobile.md) - Flutter app architecture

### Development
- [Development Guide](./development-guide.md) - Setup, build, test commands

### _(To be generated)_
- Data Models Documentation
- Deployment Guide
- Architecture Documents per part

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

**Generated:** 8 documents (Project Overview, Source Tree, Integration, State Mgmt, UI Components, API Contracts, Mobile Architecture, Dev Guide)

**Existing:** 45+ documentation files (README, architecture, deployment, E2E tests)

**Total:** 50+ documentation files across the project
