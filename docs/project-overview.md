# GENIE.AI Project Overview

## Project Summary

GENIE.AI is an open-source generative AI framework for the public sector, providing a sovereign, DPG-compliant RAG (Retrieval-Augmented Generation) system with multilingual support. It integrates with OPEA (Open Platform for Enterprise AI) for AI/ML services.

## Project Structure

**Type:** Monorepo (Hybrid - JavaScript/Node.js + Flutter + Python + Infrastructure)

**Parts:** 9 distinct components
- Frontend (Vue.js)
- Backend (Node.js/Express)
- Mobile (Flutter)
- Document Repository (Node.js)
- AI/ML Layer (Python/OPEA)
- API Gateway (Kong/NGINX)
- Deployment Automation (Ansible)

## Technology Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| **Frontend** | Vue.js 3, Vite, Tailwind CSS | 3.2+ |
| **Mobile** | Flutter 3.10+, Dart | 3.10.8+ |
| **Backend** | Node.js, Express | 18+, 4.18.2 |
| **AI/ML** | OPEA, vLLM, TEI | Python 3.10 |
| **Database** | ArangoDB | 3.12+ |
| **Cache** | Redis | 5.8+ |
| **Gateway** | Kong, NGINX | Latest |
| **Identity** | Keycloak | 26 |
| **Container** | Docker, Docker Swarm | Latest |

## Key Features

- **Multilingual Support**: 11+ languages with automatic translation
- **RAG Pipeline**: Hybrid vector-graph retrieval for context-aware responses
- **Multi-Platform**: Web, mobile (Android, iOS, Web, desktop)
- **Authentication**: Keycloak OIDC with JWKS token validation
- **Analytics**: Comprehensive usage and performance analytics
- **Document Management**: Secure file upload, processing, and knowledge base integration
- **Offline Capabilities**: Mobile app works without internet connection

## Architecture Pattern

This is a **microservices architecture** with:
- API Gateway pattern (Kong)
- Service-oriented backend (Express)
- Event-driven AI processing (OPEA)
- Multi-model database (ArangoDB: graph + vector + document)
- Centralized identity (Keycloak OIDC)

## Documentation Index

### Generated Documentation
- [API Contracts - Backend](./api-contracts-gov-chat-backend.md)
- [State Management - Frontend](./state-management-gov-chat-frontend.md)
- [UI Component Inventory - Frontend](./ui-component-inventory-gov-chat-frontend.md)
- [Mobile Architecture](./mobile-architecture-genie-ai-mobile.md)
- [Source Tree Analysis](./source-tree-analysis.md)
- [Integration Architecture](./integration-architecture.md)
- [Development Guide](./development-guide.md)

### Existing Documentation
- [README.md](../README.md) - Main project README
- [CONTRIBUTING.md](../CONTRIBUTING.md) - Contribution guidelines
- [Architecture](../docs/architecture.md) - Main architecture documentation
- [Docker Compose Setup](../docs/docker-compose-setup.md)
- [Docker Swarm Setup](../docs/docker-swarm-setup.md)
- [Mobile Deployment Guide](../docs/mobile-deployment-guide.md)
- [Keycloak Admin Guide](../docs/keycloak-admin-guide.md)

## Getting Started

### Quick Start (Docker Compose)
```bash
# 1. Clone and configure
git clone <repository-url>
cd GENIE.AI
cp env .env
# Edit .env with your secrets

# 2. Deploy
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

## Component Communication

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

## Repository Structure

```
GENIE.AI/
├── components/           # Microservices
│   ├── gov-chat-frontend/   # Vue.js web app
│   ├── gov-chat-backend/    # Node.js API
│   ├── document-repository/ # File management
│   └── shared/              # Shared libraries
├── mobile/               # Flutter mobile app
├── genie-ai-overlay/     # OPEA AI services
├── api-gateway-solution/ # Kong + NGINX
├── configs/              # Keycloak, OPEA configs
├── deploy/               # Ansible playbooks
├── tests/                # E2E tests, benchmarks
├── docs/                 # Documentation
└── docker-compose.yaml   # Main orchestration
```
