# GENIE.AI Development Guide

This guide covers all aspects of developing GENIE.AI, a sovereign RAG system for public sector services.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Project Structure](#project-structure)
- [Environment Configuration](#environment-configuration)
- [Component Development](#component-development)
  - [Frontend (Vue 3)](#frontend-vue-3)
  - [Backend (Node.js)](#backend-nodejs)
  - [Document Repository (Node.js)](#document-repository-nodejs)
  - [Mobile (Flutter)](#mobile-flutter)
  - [AI/ML Services (Python)](#aiml-services-python)
  - [API Gateway (Kong/NGINX)](#api-gateway-kongnginx)
- [Docker Development](#docker-development)
- [Database Setup](#database-setup)
- [Testing](#testing)
- [Linting and Formatting](#linting-and-formatting)
- [API Client Generation](#api-client-generation)
- [Git Workflow](#git-workflow)
- [Deployment](#deployment)

---

## Prerequisites

### Global Requirements

- **Node.js**: 22.x LTS (for all JS components)
- **npm**: 9.x or later
- **Python**: 3.10 or later (for AI/ML services)
- **Docker**: 24.x or later
- **Docker Compose**: v2.x
- **Git**: 2.x or later

### Component-Specific Requirements

| Component | Requirements |
|-----------|--------------|
| Frontend | Node.js 22+, npm 9+ |
| Backend | Node.js 22+, npm 9+ |
| Document Repository | Node.js 22+, npm 9+ |
| Mobile | Flutter 3.10+, Dart 3.10.8+, Android Studio / Xcode |
| AI/ML Services | Python 3.10+, pip, GPU (NVIDIA) for OPEA services |
| API Gateway | Docker, OpenSSL (for certificates) |

---

## Quick Start

### 1. Clone and Install Dependencies

```bash
# Clone the repository
git clone <repository-url>
cd genie-ai

# Install root dependencies
npm install

# Install component dependencies
npm install --prefix components/gov-chat-frontend
npm install --prefix components/gov-chat-backend
npm install --prefix components/document-repository
npm install --prefix components/shared/lib
```

### 2. Configure Environment

```bash
# Copy environment template
cp env .env

# Edit .env with your local values
# Required: ARANGO_PASSWORD, POSTGRES_PASSWORD, KONG_DB_PASSWORD,
#           KEYCLOAK_ADMIN_PASSWORD, KEYCLOAK_CLIENT_SECRET,
#           KEYCLOAK_PROXY_CLIENT_SECRET, KC_DATAPREP_CLIENT_SECRET,
#           EMAIL_* (SMTP configuration)
```

### 3. Start Services

```bash
# Option 1: Core services only (no AI/ML)
docker compose up -d

# Option 2: Full stack with AI/ML services
docker compose --profile opea up -d

# Option 3: With GPU-specific configuration
docker compose --env-file .env --env-file env.t4 --profile opea up -d
```

### 4. Access Services

- **Frontend**: http://localhost:8090 (or https://localhost via nginx)
- **Backend API**: http://localhost:3000/api
- **Document Repository**: http://localhost:3001/api
- **Keycloak Admin**: https://localhost/auth/admin
- **API Documentation**: http://localhost:3000/api-docs

---

## Project Structure

```
genie-ai/
├── components/
│   ├── gov-chat-frontend/      # Vue 3 web application
│   ├── gov-chat-backend/       # Node.js/Express API
│   ├── document-repository/    # File upload/processing service
│   └── shared/lib/             # Shared utilities (logger, ArangoDB)
├── mobile/
│   └── genie_ai_mobile/        # Flutter mobile application
├── genie-ai-overlay/           # OPEA AI/ML microservices
│   ├── chatqna/                # Main chat service
│   ├── retriever/              # Hybrid vector-graph retrieval
│   ├── reranker/               # Result reranking
│   ├── dataprep/               # Document ingestion pipeline
│   └── core/                   # Shared types and utilities
├── api-gateway-solution/       # Kong/NGINX configuration
├── deploy/ansible/             # Ansible deployment playbooks
├── configs/                    # Configuration files (Keycloak, prompts)
├── scripts/                    # Utility scripts
└── docs/                       # Documentation
```

---

## Environment Configuration

### Environment Files

- **`env`** (no extension): Template file, committed to git
- **`.env`** (with dot): Local overrides, **NEVER committed**

### Required Secrets

```bash
# Database passwords
ARANGO_PASSWORD=<strong-password>
POSTGRES_PASSWORD=<strong-password>
KONG_DB_PASSWORD=<different-strong-password>
KEYCLOAK_DB_PASSWORD=<different-strong-password>
TRANSLATION_CACHE_PASSWORD=<strong-password>

# Keycloak secrets
KEYCLOAK_ADMIN_PASSWORD=<strong-admin-password>
KEYCLOAK_CLIENT_SECRET=<generate-with-openssl-rand-base64-32>
KEYCLOAK_PROXY_CLIENT_SECRET=<generate-with-openssl-rand-base64-32>
GENIE_ADMIN_PASSWORD=<strong-password>
KC_DATAPREP_CLIENT_SECRET=<generate-with-openssl-rand-base64-32>

# Email configuration (required for user verification)
EMAIL_HOST=smtp.example.com
EMAIL_PORT=587
EMAIL_USER=your-email@example.com
EMAIL_PASSWORD=your-email-password
EMAIL_FROM=noreply@example.com

# Optional: AI model access
HUGGING_FACE_HUB_TOKEN=<your-huggingface-token>
```

### Generating Secure Passwords

```bash
# Using OpenSSL
openssl rand -base64 32

# Using Python
python3 -c "import secrets; print(secrets.token_urlsafe(32))"
```

---

## Component Development

### Frontend (Vue 3)

#### Prerequisites
- Node.js 22.x LTS
- npm 9.x or later

#### Installation

```bash
cd components/gov-chat-frontend
npm install
```

#### Development Commands

```bash
# Run development server
npm run serve

# Build for production
npm run build

# Run tests
npm test

# Lint code
npm run lint

# Auto-fix lint issues
npm run lint:fix

# Format code
npm run format

# Check formatting without modifying
npm run format:check
```

#### Common Development Tasks

**Adding a New Component**

```bash
# Create component in src/components/
touch src/components/MyComponent.vue
```

**Using the Design System**

```vue
<template>
  <div class="my-component">
    <DsButton variant="primary" @click="handleClick">
      Click Me
    </DsButton>
    <DsCard variant="elevated" :padding="md">
      <h2>Card Title</h2>
    </DsCard>
  </div>
</template>

<script>
import DsButton from '@/components/ds/Button.vue';
import DsCard from '@/components/ds/Card.vue';

export default {
  name: 'MyComponent',
  components: { DsButton, DsCard },
  methods: {
    handleClick() {
      console.log('Button clicked');
    }
  }
};
</script>

<style scoped>
.my-component {
  padding: var(--space-md);
  color: var(--fg);
}
</style>
```

**Adding Internationalization**

```javascript
// In component
this.$t('key.path');

// Or using translate() helper
translate('key.path', 'Default text');
```

#### Design System Rules

1. **Always use DS primitives** (DsButton, DsCard, DsModal, etc.) when available
2. **Always use DS tokens** (var(--fg), var(--accent), var(--space-md), etc.)
3. **No hardcoded values** — use CSS custom properties
4. **No !important** — indicates wrong component usage
5. **Options API** — all components use Vue 3 Options API

---

### Backend (Node.js)

#### Prerequisites
- Node.js 22.x LTS
- npm 9.x or later
- ArangoDB (running instance or Docker)

#### Installation

```bash
cd components/gov-chat-backend
npm install
```

#### Development Commands

```bash
# Run development server with auto-reload
npm run dev

# Run production server
npm start

# Setup database collections
npm run setup-db

# Initialize service categories
npm run init-categories

# Run all setup
npm run setup-all

# Run tests
npm test

# Lint code
npm run lint

# Auto-fix lint issues
npm run lint:fix

# Format code
npm run format

# Check formatting
npm run format:check
```

#### Common Development Tasks

**Adding a New Route**

```javascript
// routes/my-route.js
const express = require('express');
const router = express.Router();
const myService = require('../services/my-service');

/**
 * @swagger
 * /api/my-endpoint:
 *   get:
 *     summary: Get my data
 *     tags: [MyFeature]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Successful response
 */
router.get('/my-endpoint', authenticateKeycloak, async (req, res) => {
  try {
    const data = await myService.getData(req.user);
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
```

**Register Route in App**

```javascript
// app.js
const myRoutes = require('./routes/my-route');
app.use('/api/my', myRoutes);
```

**Adding a New Service**

```javascript
// services/my-service.js
const db = require('../shared/lib/arango-wrapper');
const logger = require('../shared/lib/logger');

class MyService {
  async getData(user) {
    try {
      const query = `FOR doc IN myCollection FILTER doc.userId == @userId RETURN doc`;
      const cursor = await db.query(query, { userId: user.sub });
      return await cursor.all();
    } catch (error) {
      logger.error('Error fetching data:', error);
      throw error;
    }
  }
}

module.exports = new MyService();
```

#### Architecture Patterns

- **Controller → Service pattern**: Controllers handle HTTP, Services contain business logic
- **Authentication**: Use `authenticateKeycloak` middleware for protected routes
- **Logging**: Use `logger` from shared/lib/logger.js
- **Database**: Use ArangoDB wrapper from shared/lib/arango-wrapper.js
- **Validation**: Use Joi for request validation

---

### Document Repository (Node.js)

#### Prerequisites
- Node.js 22.x LTS
- npm 9.x or later
- ArangoDB (running instance or Docker)
- ClamAV (for virus scanning)

#### Installation

```bash
cd components/document-repository
npm install
```

#### Development Commands

```bash
# Run development server
npm run dev

# Run production server
npm start

# Run tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage

# Lint code
npm run lint

# Auto-fix lint issues
npm run lint:fix

# Format code
npm run format

# Check formatting
npm run format:check
```

#### Common Development Tasks

**Adding File Type Support**

```javascript
// src/file-handlers/my-handler.js
class MyFileHandler {
  canHandle(fileType) {
    return fileType === 'application/my-type';
  }

  async extractText(filePath) {
    // Extract text from file
    return 'extracted text';
  }

  async getMetadata(filePath) {
    // Extract metadata from file
    return { title: 'My Document', author: 'Unknown' };
  }
}

module.exports = MyFileHandler;
```

**Testing File Upload**

```bash
# Upload test file
curl -X POST http://localhost:3001/api/files/upload \
  -H "Authorization: Bearer <token>" \
  -F "file=@test.pdf" \
  -F "category=my-category"
```

---

### Mobile (Flutter)

#### Prerequisites
- Flutter 3.10 or later
- Dart 3.10.8 or later
- Android Studio (Android development)
- Xcode (iOS development, macOS only)

#### Installation

```bash
cd mobile/genie_ai_mobile
flutter pub get
```

#### Development Commands

```bash
# Run on connected device/emulator
flutter run --flavor dev

# Run on specific device
flutter run -d <device-id> --flavor dev

# Build Android APK (debug)
flutter build apk --flavor dev --debug

# Build Android APK (release)
flutter build apk --flavor itu --release

# Build Android App Bundle (release)
flutter build appbundle --flavor itu --release

# Build iOS (macOS only)
flutter build ipa --flavor dev

# Run tests
flutter test

# Analyze code
flutter analyze

# Format code
dart format .

# Check formatting
dart format --set-exit-if-changed .
```

#### Flavors

| Flavor | Purpose | Build Command |
|--------|---------|---------------|
| dev | Local development | `flutter build apk --flavor dev --debug` |
| e2e | End-to-end testing | `flutter build apk --flavor e2e --debug` |
| staging | Staging environment | `flutter build apk --flavor staging --release` |
| itu | Production (ITU deployment) | `flutter build apk --flavor itu --release` |

#### Common Development Tasks

**Adding a New Screen**

```dart
// lib/screens/my_screen.dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

class MyScreen extends ConsumerWidget {
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Scaffold(
      appBar: AppBar(title: Text('My Screen')),
      body: Center(
        child: DsButton(
          variant: DsButtonVariant.primary,
          onPressed: () => _handlePress(ref),
          child: Text('Click Me'),
        ),
      ),
    );
  }

  void _handlePress(WidgetRef ref) {
    // Handle button press
  }
}
```

**Using the Design System**

```dart
import 'package:genie_ai_mobile/design_system/components/ds_button.dart';
import 'package:genie_ai_mobile/design_system/components/ds_card.dart';
import 'package:genie_ai_mobile/design_system/tokens/app_tokens.dart';

// Get theme manager
final tokens = ThemeManager().tokens;

// Use tokens
Container(
  color: tokens.surface,
  padding: DsSpacing.md(16),
  child: Text(
    'Hello',
    style: TextStyle(color: tokens.fg),
  ),
)
```

**Making API Calls**

```dart
import 'package:openapi/api.dart';

// Create API instance
final userApi = CurrentUserApi(authenticatedApiClient);

// Make API call
try {
  final response = await userApi.apiMeGetWithHttpInfo();
  final profile = jsonDecode(response.body);
  print('User: ${profile['username']}');
} catch (e) {
  print('Error: $e');
}
```

#### Keycloak Mobile Client Setup

For institutional deployments, follow the [Mobile Deployment Guide](mobile-deployment-guide.md).

**Variables to configure in .env:**
- `KC_MOBILE_CLIENT_ID` — OIDC client ID (e.g., `genie-mobile-itu`)
- `KC_MOBILE_REDIRECT_SCHEME` — Custom URL scheme (e.g., `com.itu.genieai`)

**Scheme Coherence Rule:**
The redirect scheme must match across:
1. Dart flavor config (`lib/config/flavors/*.dart`)
2. Android manifest (`android/app/build.gradle`)
3. iOS XCConfig (`ios/Flutter/*.xcconfig`)
4. Environment variable (`KC_MOBILE_REDIRECT_SCHEME`)

---

### AI/ML Services (Python)

#### Prerequisites
- Python 3.10 or later
- pip
- NVIDIA GPU (for vLLM, TEI services)
- Docker (for containerized deployment)

#### Installation

```bash
# Install Python dependencies (for local development)
cd genie-ai-overlay
pip install -r chatqna/requirements.txt
pip install -r retriever/requirements.txt
pip install -r reranker/requirements.txt
pip install -r dataprep/requirements.txt
```

#### Development Commands

```bash
# Lint Python code
cd genie-ai-overlay
ruff check .

# Auto-fix lint issues
ruff check --fix .

# Format code
ruff format .

# Check formatting
ruff format --check .
```

#### Common Development Tasks

**Running a Service Locally**

```bash
# ChatQnA service
cd genie-ai-overlay/chatqna
python genieai_chatqna.py

# Retriever service
cd genie-ai-overlay/retriever
python genieai_retriever.py

# Dataprep service
cd genie-ai-overlay/dataprep
python genieai_dataprep_arangodb.py
```

**Testing with Docker**

```bash
# Build specific service
docker compose build chatqna

# Run specific service
docker compose up chatqna

# View logs
docker compose logs -f chatqna
```

#### Python Code Standards

- Follow PEP 8
- Use `CustomLogger` from `comps` library
- Environment configuration via `os.getenv()` with defaults
- Copyright headers required (ITU or Intel+ITU for OPEA adaptations)

---

### API Gateway (Kong/NGINX)

#### Prerequisites
- Docker
- OpenSSL (for certificate generation)

#### Development Commands

```bash
# Start gateway services
docker compose up -d kong nginx

# Restart Kong
docker compose restart kong

# Reload Kong configuration
docker exec kong kong reload

# View Kong logs
docker compose logs -f kong

# View nginx logs
docker compose logs -f nginx

# Test configuration
curl -I http://localhost/
curl -I https://localhost/
```

#### Common Development Tasks

**Adding a New Kong Route**

```bash
# Add route via Kong Admin API
curl -X POST http://localhost:8001/services/ \
  -d "name=my-service" \
  -d "url=http://backend:3000"

curl -X POST http://localhost:8001/services/my-service/routes \
  -d "paths[]=/api/my" \
  -d "strip_path=true"
```

**Updating NGINX Configuration**

```bash
# Edit nginx configuration
nano api-gateway-solution/nginx/nginx.conf

# Restart nginx
docker compose restart nginx
```

**Testing SSL Configuration**

```bash
# Test SSL certificate
openssl s_client -connect localhost:443 -servername localhost

# View certificate details
openssl x509 -in secrets/ssl/server.crt -text -noout
```

---

## Docker Development

### Docker Compose Commands

```bash
# Start core services
docker compose up -d

# Start with OPEA/AI services
docker compose --profile opea up -d

# Start with GPU configuration
docker compose --env-file .env --env-file env.t4 --profile opea up -d

# Build specific service
docker compose build backend

# Rebuild and restart service
docker compose up -d --build backend

# View logs
docker compose logs -f backend

# Stop all services
docker compose down

# Stop and remove volumes
docker compose down -v

# Scale a service
docker compose up -d --scale backend=3
```

### Service Health Checks

```bash
# Check service status
docker compose ps

# Check service health
docker compose ps --format "table {{.Name}}\t{{.Status}}"

# View health check logs
docker inspect --format='{{json .State.Health}}' backend
```

### Development Workflow

1. **Make code changes** in your local directory
2. **Rebuild the service**: `docker compose build <service>`
3. **Restart the service**: `docker compose up -d <service>`
4. **Check logs**: `docker compose logs -f <service>`

---

## Database Setup

### ArangoDB Initialization

```bash
# Setup database collections
cd components/gov-chat-backend
npm run setup-db

# Initialize service categories
npm run init-categories

# Run all setup
npm run setup-all
```

### ArangoDB Web UI

- **URL**: http://localhost:8529
- **Username**: `root`
- **Password**: `<ARANGO_PASSWORD from .env>`
- **Database**: `genie-ai` (or custom `ARANGO_DB`)

### Common Database Tasks

```javascript
// Connect to ArangoDB
const db = require('arangojs')({
  url: process.env.ARANGO_URL,
  databaseName: process.env.ARANGO_DB,
  auth: { username: process.env.ARANGO_USER, password: process.env.ARANGO_PASSWORD }
});

// Query collection
const cursor = await db.query('FOR doc IN myCollection RETURN doc');
const results = await cursor.all();

// Insert document
await db.collection('myCollection').save({ name: 'Test', value: 123 });

// Update document
await db.collection('myCollection').update('document-key', { value: 456 });
```

---

## Testing

### Frontend Tests

```bash
cd components/gov-chat-frontend
npm test
```

### Backend Tests

```bash
cd components/gov-chat-backend
npm test
```

### Document Repository Tests

```bash
cd components/document-repository
npm test
npm run test:watch
npm run test:coverage
```

### Mobile Tests

```bash
cd mobile/genie_ai_mobile
flutter test

# Run specific test file
flutter test test/widget_test.dart
```

### E2E Tests

```bash
# Run all E2E tests
npm run test:e2e

# List E2E tests
npm run test:e2e:list

# Run specific test file
npx playwright test tests/e2e/my-test.spec.ts
```

---

## Linting and Formatting

### Root-Level Commands

```bash
# Lint all JavaScript/Vue files
npm run lint

# Auto-fix lint issues
npm run lint:fix

# Format all JavaScript/Vue files
npm run format

# Check formatting without modifying
npm run format:check

# Lint Python files
npm run lint:py

# Auto-fix Python lint issues
npm run lint:py:fix

# Format Python files
npm run format:py

# Check Python formatting
npm run format:py:check

# Lint Dart files
npm run lint:dart

# Format Dart files
npm run format:dart

# Check Dart formatting
npm run format:dart:check
```

### Component-Specific Commands

**Frontend**
```bash
cd components/gov-chat-frontend
npm run lint
npm run format
```

**Backend**
```bash
cd components/gov-chat-backend
npm run lint
npm run format
```

**Document Repository**
```bash
cd components/document-repository
npm run lint
npm run format
```

**Mobile**
```bash
cd mobile/genie_ai_mobile
flutter analyze
dart format .
```

**Python**
```bash
cd genie-ai-overlay
ruff check .
ruff format .
```

---

## API Client Generation

The mobile app uses an auto-generated OpenAPI client from the backend specification.

### Generate Client

```bash
# From project root
./scripts/generate-api-client.sh
```

### Prerequisites

- `openapi-generator-cli`: `npm install -g @openapitools/openapi-generator-cli`
- Node.js (for spec extraction)
- Backend dependencies: `cd components/gov-chat-backend && npm install`

### How It Works

1. Extracts OpenAPI spec from backend JSDoc annotations
2. Generates Dart client into `mobile/genie_ai_mobile/openapi_client/`
3. Client includes all API classes and DTOs

**Never edit generated files manually** — they are overwritten on regeneration.

---

## Git Workflow

### Branch Strategy

- **`main`**: Production-ready code
- **`feat/*`**: Feature branches (e.g., `feat/new-auth-flow`)
- **`fix/*`**: Bug fix branches (e.g., `fix/login-error`)
- **`chore/*`**: Maintenance tasks (e.g., `chore/update-deps`)

### Creating a Feature Branch

```bash
# Create and checkout feature branch
git checkout -b feat/my-feature

# Make changes
git add .
git commit -m "feat: add my feature"

# Push to remote
git push -u origin feat/my-feature
```

### Commit Message Convention

Follow [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` - New feature
- `fix:` - Bug fix
- `docs:` - Documentation changes
- `style:` - Code style changes (formatting, etc.)
- `refactor:` - Code refactoring
- `test:` - Adding or updating tests
- `chore:` - Maintenance tasks

**Example:**
```
feat: add OAuth2 login flow

- Implement authorization code flow with PKCE
- Add token refresh logic
- Update UI with login/logout buttons

Closes #123
```

### Pull Request Process

1. Create feature branch from `main`
2. Make changes and commit
3. Push to remote
4. Create pull request to `main`
5. Request review from team
6. Address feedback
7. Merge after approval

---

## Deployment

### Ansible Deployment (Recommended)

```bash
cd deploy/ansible

# Install dependencies
ansible-galaxy collection install -r requirements.yml

# Configure inventory
cp inventory.example inventory/test.ini
# Edit inventory/test.ini with your host IPs

# Configure secrets
cp group_vars/test.vault.example group_vars/test.vault
ansible-vault edit --vault-id test@prompt group_vars/test.vault

# Deploy
ansible-playbook -i inventory/test.ini deploy.yml --vault-id test@prompt

# Tagged re-runs
ansible-playbook -i inventory/test.ini deploy.yml --tags build,deploy --vault-id test@prompt
ansible-playbook -i inventory/test.ini deploy.yml --tags deploy --vault-id test@prompt
```

### Docker Deployment

```bash
# Core services only
docker compose up -d

# Full stack with AI/ML
docker compose --profile opea up -d

# With GPU configuration
docker compose --env-file .env --env-file env.t4 --profile opea up -d
```

### Deployment Checklist

Before deploying to production:

- [ ] All secrets configured in `.env`
- [ ] SSL certificates in place (`secrets/ssl/`)
- [ ] Email configuration tested (SMTP working)
- [ ] Keycloak realm configured correctly
- [ ] Database backups enabled
- [ ] Monitoring and logging configured
- [ ] Health checks passing
- [ ] Tests passing
- [ ] Code reviewed and approved

---

## Troubleshooting

### Common Issues

**Port Already in Use**

```bash
# Find process using port
lsof -i :3000

# Kill process
kill -9 <PID>
```

**Docker Container Not Starting**

```bash
# Check logs
docker compose logs <service>

# Check container status
docker compose ps

# Rebuild container
docker compose up -d --build <service>
```

**Database Connection Issues**

```bash
# Check ArangoDB is running
docker compose ps arangodb

# Check ArangoDB logs
docker compose logs arangodb

# Verify connection
curl http://localhost:8529/_api/database
```

**Keycloak Issues**

```bash
# Check Keycloak is running
docker compose ps keycloak

# Check Keycloak logs
docker compose logs keycloak

# Verify configuration
curl http://localhost:8080/realms/genie/.well-known/openid-configuration
```

### Getting Help

- **Documentation**: Check `docs/` directory
- **Issues**: Report bugs on GitHub
- **Community**: Ask questions in discussions

---

## Additional Resources

- [Architecture Overview](architecture.md)
- [API Documentation](http://localhost:3000/api-docs)
- [Mobile Deployment Guide](mobile-deployment-guide.md)
- [E2E Testing Guide](e2e-tests/README.md)
- [Deployment Guide](deployment.md)
