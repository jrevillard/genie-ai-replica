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

### Testing Infrastructure Overview

GENIE.AI uses a comprehensive testing strategy across all components:

| Component | Framework | Test Location | Type |
|-----------|-----------|---------------|------|
| Frontend | Jest + Vue Test Utils | `src/__tests__/` | Unit, Integration |
| Backend | Jest + Supertest | `__tests__/` | Unit, Integration, Contract |
| Document Repository | Jest + Supertest | `__tests__/` | Unit, Integration |
| OPEA Services | pytest | `genie-ai-overlay/tests/` | Unit, Integration |
| Mobile | flutter_test | `test/` | Unit, Widget |
| E2E | Playwright | `tests/e2e/` | End-to-End |
| Config Validation | Jest | `tests/config-validator/` | Schema Validation |

### Backend Testing (Node.js)

#### Test Structure

```
components/gov-chat-backend/
├── __tests__/
│   ├── routes/           # Route handler tests
│   ├── controllers/      # Controller tests
│   ├── services/         # Business logic tests
│   ├── middleware/       # Middleware tests
│   ├── mocks/            # Mock fixtures
│   └── fixtures/         # Test data fixtures
```

#### Test Commands

```bash
cd components/gov-chat-backend

# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage

# Run contract tests (OpenAPI validation)
npm run test:contract

# Run specific test file
npm test routes/chat.test.js

# Run tests matching pattern
npm test -- --testNamePattern="should create"
```

#### Backend Test Patterns

**Testing Routes with Supertest**

The backend uses the `createApp()` pattern for testing routes without starting an HTTP server:

```javascript
// __tests__/routes/chat.test.js
const request = require('supertest');
const { createApp } = require('../index'); // Exports createApp(), not app.listen()
const chatService = require('../../services/chat-service');

// Mock service dependencies
jest.mock('../../services/chat-service');
jest.mock('../../shared/lib/logger');

describe('POST /api/chat/messages', () => {
  let app;

  beforeEach(() => {
    // Clear mocks before each test
    jest.clearAllMocks();
    // Create fresh app instance
    app = createApp();
  });

  it('should send a message successfully', async () => {
    // Mock service response
    chatService.sendMessage.mockResolvedValue({
      messageId: 'msg123',
      response: 'Hello, user!'
    });

    const response = await request(app)
      .post('/api/chat/messages')
      .set('Authorization', 'Bearer valid-token')
      .send({
        conversationId: 'conv123',
        content: 'Hello, AI!'
      });

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('messageId');
    expect(chatService.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'Hello, AI!' })
    );
  });

  it('should return 401 without auth token', async () => {
    const response = await request(app)
      .post('/api/chat/messages')
      .send({
        conversationId: 'conv123',
        content: 'Hello, AI!'
      });

    expect(response.status).toBe(401);
  });
});
```

**Testing Services**

```javascript
// __tests__/services/chat-service.test.js
const chatService = require('../../services/chat-service');
const db = require('../../shared/lib/arango-wrapper');

jest.mock('../../shared/lib/arango-wrapper');

describe('ChatService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('sendMessage', () => {
    it('should save message and return response', async () => {
      const mockMessage = {
        _key: 'msg123',
        content: 'Hello, AI!',
        role: 'user',
        timestamp: Date.now()
      };

      db.query.mockResolvedValue({
        all: async () => [mockMessage]
      });

      const result = await chatService.sendMessage({
        conversationId: 'conv123',
        content: 'Hello, AI!'
      });

      expect(result).toHaveProperty('messageId');
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT'),
        expect.any(Object)
      );
    });

    it('should handle database errors', async () => {
      db.query.mockRejectedValue(new Error('Database connection failed'));

      await expect(
        chatService.sendMessage({
          conversationId: 'conv123',
          content: 'Hello, AI!'
        })
      ).rejects.toThrow('Database connection failed');
    });
  });
});
```

**Module Mocking with Jest**

```javascript
// __tests__/mocks/arango-wrapper.js
const mockDb = {
  query: jest.fn(),
  collection: jest.fn(() => ({
    save: jest.fn(),
    update: jest.fn(),
    remove: jest.fn()
  })),
  transaction: jest.fn()
};

module.exports = mockDb;

// In test file
jest.mock('../../shared/lib/arango-wrapper', () => require('../mocks/arango-wrapper'));
```

### Frontend Testing (Vue 3)

#### Test Structure

```
components/gov-chat-frontend/
├── src/__tests__/
│   ├── components/      # Component tests
│   ├── services/        # API service tests
│   ├── store/           # Vuex store tests
│   └── utils/           # Utility function tests
```

#### Test Commands

```bash
cd components/gov-chat-frontend

# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage

# Run contract tests (OpenAPI validation)
npm run test:contract

# Run specific test file
npm test src/__tests__/components/ChatMessage.test.js
```

#### Frontend Test Patterns

**Testing Components with Vue Test Utils**

```javascript
// src/__tests__/components/ChatMessage.test.js
import { mount, config } from '@vue/test-utils';
import ChatMessage from '@/components/ChatMessage.vue';
import Vuex from 'vuex';

// Mock global components
config.global.stubs = {
  DsCard: true,
  DsButton: true
};

describe('ChatMessage', () => {
  let store;
  let actions;

  beforeEach(() => {
    actions = {
      sendMessage: jest.fn()
    };

    store = new Vuex.Store({
      actions
    });
  });

  it('renders message content', () => {
    const wrapper = mount(ChatMessage, {
      props: {
        message: {
          content: 'Hello, user!',
          role: 'assistant',
          timestamp: Date.now()
        }
      },
      global: {
        plugins: [store]
      }
    });

    expect(wrapper.text()).toContain('Hello, user!');
  });

  it('emits send event when button clicked', async () => {
    const wrapper = mount(ChatMessage, {
      props: {
        message: {
          content: 'Hello!',
          role: 'user',
          timestamp: Date.now()
        }
      },
      global: {
        plugins: [store]
      }
    });

    await wrapper.find('[data-testid="send-button"]').trigger('click');
    expect(wrapper.emitted('send')).toBeTruthy();
  });
});
```

**Testing Vuex Store**

```javascript
// src/__tests__/store/chat.test.js
import { createStore } from 'vuex';
import chat from '@/store/modules/chat';

describe('Chat Store', () => {
  let store;

  beforeEach(() => {
    store = createStore({
      modules: {
        chat: {
          ...chat,
          state: {
            conversations: [],
            currentConversation: null
          }
        }
      }
    });
  });

  it('commits new conversation', () => {
    store.commit('chat/ADD_CONVERSATION', {
      id: 'conv123',
      title: 'New Chat'
    });

    expect(store.state.chat.conversations).toHaveLength(1);
    expect(store.state.chat.conversations[0].id).toBe('conv123');
  });

  it('dispatches sendMessage action', async () => {
    const mockResponse = { messageId: 'msg123', content: 'Response' };
    chatService.sendMessage = jest.fn().mockResolvedValue(mockResponse);

    await store.dispatch('chat/sendMessage', {
      conversationId: 'conv123',
      content: 'Hello'
    });

    expect(chatService.sendMessage).toHaveBeenCalled();
  });
});
```

**Testing API Services**

```javascript
// src/__tests__/services/chat-api.test.js
import chatApi from '@/services/chat-api';
import axios from 'axios';

jest.mock('axios');

describe('Chat API', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('fetches conversations successfully', async () => {
    const mockConversations = [
      { id: 'conv1', title: 'Chat 1' },
      { id: 'conv2', title: 'Chat 2' }
    ];

    axios.get.mockResolvedValue({ data: mockConversations });

    const result = await chatApi.getConversations();

    expect(result).toEqual(mockConversations);
    expect(axios.get).toHaveBeenCalledWith('/api/chat/conversations');
  });

  it('handles API errors', async () => {
    axios.get.mockRejectedValue(new Error('Network error'));

    await expect(chatApi.getConversations()).rejects.toThrow('Network error');
  });
});
```

### OPEA Services Testing (Python)

#### Test Structure

```
genie-ai-overlay/
├── tests/
│   ├── conftest.py          # Pytest fixtures
│   ├── test_chatqna.py       # ChatQnA tests
│   ├── test_retriever.py     # Retriever tests
│   ├── test_dataprep.py      # Dataprep tests
│   └── fixtures/             # Test data fixtures
```

#### Test Commands

```bash
cd genie-ai-overlay

# Run all tests
pytest

# Run specific test file
pytest tests/test_retriever.py

# Run tests with coverage
pytest --cov=chatqna --cov=retriever --cov=dataprep

# Run tests with verbose output
pytest -v

# Run tests matching pattern
pytest -k "test_embedding"

# Run tests in parallel
pytest -n auto
```

#### OPEA Test Patterns

**Pytest Fixtures (conftest.py)**

```python
# tests/conftest.py
import pytest
from unittest.mock import Mock, patch

@pytest.fixture
def mock_arango_client():
    """Mock ArangoDB client for testing."""
    client = Mock()
    client.query.return_value = []
    client.collection.return_value = Mock()
    return client

@pytest.fixture
def mock_logger():
    """Mock CustomLogger for testing."""
    logger = Mock()
    logger.info = Mock()
    logger.error = Mock()
    return logger

@pytest.fixture
def sample_document():
    """Sample document fixture for testing."""
    return {
        "_key": "doc123",
        "title": "Test Document",
        "content": "This is a test document content.",
        "category": "test-category",
        "language": "en"
    }
```

**Testing Retriever Service**

```python
# tests/test_retriever.py
import pytest
from genieai_retriever import RetrieverService

@pytest.mark.asyncio
async def test_hybrid_search(mock_arango_client, sample_document):
    """Test hybrid vector + graph search."""
    retriever = RetrieverService(mock_arango_client)

    # Mock query results
    mock_arango_client.query.return_value.all.return_value = [sample_document]

    results = await retriever.hybrid_search(
        query="test query",
        top_k=5,
        alpha=0.5  # Balance between vector and graph
    )

    assert len(results) == 1
    assert results[0]["_key"] == "doc123"
    mock_arango_client.query.assert_called_once()

@pytest.mark.asyncio
async def test_vector_search_fallback(mock_arango_client):
    """Test fallback to vector-only search."""
    retriever = RetrieverService(mock_arango_client)

    # Mock graph search failure
    mock_arango_client.query.side_effect = Exception("Graph search failed")

    with pytest.raises(Exception):
        await retriever.hybrid_search("test query")
```

**Mocking the comps Library**

```python
# tests/conftest.py
import sys
from unittest.mock import Mock

# Mock comps library modules
sys.modules['comps'] = Mock()
sys.modules['comps.utils'] = Mock()
sys.modules['comps.utils.tracing'] = Mock()

# Setup tracing mock
mock_tracer = Mock()
mock_span = Mock()
mock_span.__enter__ = Mock(return_value=mock_span)
mock_span.__exit__ = Mock(return_value=False)
mock_tracer.start_as_current_span.return_value = mock_span
sys.modules['comps.utils.tracing'].trace_span = Mock(return_value=mock_span)
```

### Document Repository Testing

#### Test Commands

```bash
cd components/document-repository

# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage

# Run specific test file
npm test __tests__/services/file-service.test.js
```

#### Test Patterns

**Testing File Upload**

```javascript
// __tests__/routes/upload.test.js
const request = require('supertest');
const fs = require('fs');
const path = require('path');
const { createApp } = require('../index');

describe('POST /api/files/upload', () => {
  let app;

  beforeEach(() => {
    app = createApp();
  });

  it('should upload PDF file successfully', async () => {
    const filePath = path.join(__dirname, 'fixtures/test.pdf');

    const response = await request(app)
      .post('/api/files/upload')
      .set('Authorization', 'Bearer valid-token')
      .attach('file', filePath)
      .field('category', 'test-category');

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('fileId');
    expect(response.body.category).toBe('test-category');
  });

  it('should reject files without auth', async () => {
    const filePath = path.join(__dirname, 'fixtures/test.pdf');

    const response = await request(app)
      .post('/api/files/upload')
      .attach('file', filePath);

    expect(response.status).toBe(401);
  });
});
```

### Mobile Testing (Flutter)

#### Test Commands

```bash
cd mobile/genie_ai_mobile

# Run all tests
flutter test

# Run specific test file
flutter test test/widget_test.dart

# Run tests with coverage
flutter test --coverage

# Run tests on specific device
flutter test -d <device-id>

# Run integration tests
flutter drive --target=test_driver/integration_test.dart
```

#### Test Patterns

**Widget Testing**

```dart
// test/widget_test.dart
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:genie_ai_mobile/screens/chat_screen.dart';

void main() {
  testWidgets('ChatScreen renders message list', (WidgetTester tester) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          chatMessagesProvider.overrideWith((ref) => [
            Message(content: 'Hello', role: 'user'),
            Message(content: 'Hi there!', role: 'assistant'),
          ]),
        ],
        child: MaterialApp(home: ChatScreen()),
      ),
    );

    expect(find.text('Hello'), findsOneWidget);
    expect(find.text('Hi there!'), findsOneWidget);
  });

  testWidgets('ChatScreen sends message on button tap', (WidgetTester tester) async {
    await tester.pumpWidget(
      ProviderScope(
        child: MaterialApp(home: ChatScreen()),
      ),
    );

    await tester.enterText(
      find.byType(TextField),
      'Test message',
    );
    await tester.tap(find.byType(DsButton));
    await tester.pump();

    expect(find.text('Test message'), findsOneWidget);
  });
}
```

### Config Validation Testing

#### Test Commands

```bash
cd tests/config-validator

# Run all config validation tests
npm test

# Test specific environment
npm test -- --env=development

# Validate actual env file
npm test -- --env-file=../../.env
```

### E2E Testing (Playwright)

#### Test Structure

```
tests/e2e/
├── auth/                   # Authentication flows
├── chat/                   # Chat functionality
├── documents/              # Document upload/management
├── admin/                  # Admin dashboard
└── fixtures/               # Test data fixtures
```

#### Test Commands

```bash
# Run all E2E tests
npm run test:e2e

# Run specific test file
npx playwright test tests/e2e/chat/chat-flow.spec.ts

# Run tests in headed mode (show browser)
npx playwright test --headed

# Debug tests
npx playwright test --debug

# List all tests
npm run test:e2e:list

# Run tests in specific browser
npx playwright test --project=chromium
npx playwright test --project=firefox
npx playwright test --project=webkit
```

#### E2E Test Patterns

```typescript
// tests/e2e/chat/chat-flow.spec.ts
import { test, expect } from '@playwright/test';

test.describe('Chat Flow', () => {
  test.beforeEach(async ({ page }) => {
    // Login before each test
    await page.goto('/login');
    await page.fill('[data-testid="username"]', 'testuser');
    await page.fill('[data-testid="password"]', 'testpass');
    await page.click('[data-testid="login-button"]');
    await page.waitForURL('/chat');
  });

  test('sends message and receives response', async ({ page }) => {
    await page.fill('[data-testid="message-input"]', 'Hello, AI!');
    await page.click('[data-testid="send-button"]');

    // Wait for assistant response
    await expect(page.locator('[data-testid="message-content"]').last()).toContainText(
      /assistant|ai|response/i,
      { timeout: 10000 }
    );
  });

  test('creates new conversation', async ({ page }) => {
    await page.click('[data-testid="new-chat-button"]');

    await expect(page).toHaveURL(/\/chat\/conv-[a-f0-9-]+/);
    await expect(page.locator('[data-testid="message-list"]')).toBeEmpty();
  });
});
```

### Coverage Reports

```bash
# Backend coverage
cd components/gov-chat-backend
npm run test:coverage
open coverage/lcov-report/index.html

# Frontend coverage
cd components/gov-chat-frontend
npm run test:coverage
open coverage/lcov-report/index.html

# Python coverage
cd genie-ai-overlay
pytest --cov=. --cov-report=html
open htmlcov/index.html

# Flutter coverage
cd mobile/genie_ai_mobile
flutter test --coverage
open coverage/lcov/index.html
```

---

## Observability Development

### Overview

The GENIE.AI observability stack provides distributed tracing, metrics, and logs for debugging and monitoring. It uses OpenTelemetry (OTel) for instrumentation and VictoriaMetrics family for storage, with Grafana dashboards for visualization.

**Stack Components:**
- **OTel Collector**: Central telemetry collection (traces, metrics, logs)
- **VictoriaMetrics**: Metrics storage (Prometheus-compatible)
- **VictoriaLogs**: Log aggregation and search
- **VictoriaTraces**: Distributed trace storage (Jaeger-compatible)
- **Grafana**: Dashboards and visualization

### Running the Observability Stack

#### Start Observability Services

```bash
# Start core services + observability
docker compose --profile observability up -d

# Verify observability services are running
docker compose ps otel-collector victoriametrics victorialogs victoriatraces grafana
```

#### Access Grafana

**Access via Kong route (authenticated):**
```
URL: https://localhost/grafana/
Auth: Keycloak SSO (same credentials as GENIE.AI)
```

**Access directly (development only):**
```bash
# Port forward to local machine
docker compose port grafana 3000

# Access at http://localhost:3000
# Default admin credentials (if SSO not configured):
# Username: admin
# Password: <GRAFANA_ADMIN_PASSWORD from .env>
```

### Available Dashboards

| Dashboard | Purpose | Key Metrics |
|-----------|---------|-------------|
| Service Health | Service uptime, error rates | Uptime %, Error rate, Request rate |
| App Metrics | Application performance | Response time, Throughput, Memory |
| Logs Viewer | Search and filter logs | Error logs, Warning logs, Custom queries |
| Trace Explorer | Distributed traces | Trace duration, Span timeline, Errors |
| RAG Waterfall | RAG pipeline performance | Embedding time, Retrieval time, LLM time |
| Stack Health | Infrastructure health | CPU, Memory, Disk, Network |
| VictoriaMetrics | Metrics storage health | Ingestion rate, Storage size |

### Viewing Traces and Logs

#### Query Logs

1. **Open Grafana** → Navigate to "Logs Viewer" dashboard
2. **Select filters**:
   - `service`: `backend`, `frontend`, `chatqna`, `retriever`, etc.
   - `level`: `error`, `warn`, `info`, `debug`
   - `environment`: `development`, `production`
3. **Search**: Enter query in search bar (e.g., `HTTP 500`, `ArangoDB error`)
4. **View details**: Click log entry to see full context, including `trace_id` for correlation

#### Explore Traces

1. **Open Grafana** → Navigate to "Trace Explorer" dashboard
2. **Select time range** (last 15 minutes, last hour, etc.)
3. **Filter traces**:
   - `service`: `backend`, `chatqna`, etc.
   - `operation`: `POST /api/chat/messages`, `hybrid_search`, etc.
   - `status`: `OK`, `ERROR`
4. **Click trace ID** to view waterfall visualization
5. **View spans**: Expand each span to see attributes, events, logs

#### Correlate Logs and Traces

Each log entry includes a `trace_id` attribute. Click it to jump directly to the associated trace in the Trace Explorer.

### Adding Tracing to Backend Routes

Backend uses the `withSpan()` helper for automatic tracing:

```javascript
// routes/chat.js
const { withSpan } = require('../tracing');

/**
 * POST /api/chat/messages
 */
router.post('/messages', authenticateKeycloak, withSpan('POST /api/chat/messages', async (req, res) => {
  // Automatically creates a span named "POST /api/chat/messages"
  // Includes attributes: http.method, http.route, http.status_code
  
  try {
    const response = await chatService.sendMessage(req.body);
    res.json(response);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}));
```

**Manual Span Creation:**

```javascript
const tracer = require('../tracing').tracer;

async function processMessage(message) {
  const span = tracer.startSpan('processMessage', {
    attributes: {
      'message.id': message.id,
      'message.length': message.content.length
    }
  });

  try {
    // Your business logic
    const result = await llmService.generate(message);
    span.addEvent('LLM response received', {
      'response.length': result.length
    });
    return result;
  } catch (error) {
    span.recordException(error);
    throw error;
  } finally {
    span.end();
  }
}
```

### Adding Tracing to Python Services

Python services use the `@trace_span` decorator:

```python
# genieai_chatqna.py
from comps.utils.tracing import trace_span

@trace_span("hybrid_search")
async def hybrid_search(query: str, top_k: int = 5):
    """
    Automatically traced with operation name "hybrid_search".
    Includes attributes: query, top_k
    """
    try:
        # Your business logic
        results = await retriever.search(query, top_k)
        return results
    except Exception as e:
        # Exception automatically recorded in span
        raise e
```

**Manual Span Creation:**

```python
from opentelemetry import trace

tracer = trace.get_tracer(__name__)

async def process_document(doc_id: str):
    with tracer.start_as_current_span("processDocument") as span:
        span.set_attribute("document.id", doc_id)
        
        # Business logic
        metadata = await extract_metadata(doc_id)
        span.add_event("Metadata extracted", {"metadata": metadata})
        
        return metadata
```

### OTel Collector Configuration

The collector configuration is in `configs/otel/otel-collector-config.yaml`:

```yaml
receivers:
  # Receive traces from app services (OTLP HTTP)
  otlp:
    protocols:
      http:
        endpoint: 0.0.0.0:4318
  
  # Receive container logs (fluentd)
  fluent_forward:
    endpoint: 0.0.0.0:24224

processors:
  batch:
    timeout: 1s
    send_batch_size: 1024

exporters:
  # Metrics to VictoriaMetrics
  prometheusremotewrite:
    endpoint: http://victoriametrics:8428/api/v1/write
  
  # Logs to VictoriaLogs
  otlp/http:
    endpoint: http://victorialogs:9428
  
  # Traces to VictoriaTraces
  otlp:
    endpoint: http://victoriatraces:10428
```

**Adding new receivers/exporters:**
1. Edit `configs/otel/otel-collector-config.yaml`
2. Restart collector: `docker compose restart otel-collector`
3. Verify logs: `docker compose logs -f otel-collector`

### Debugging with Distributed Tracing

#### Scenario: Slow RAG Response

1. **Navigate to Trace Explorer** → Filter by `service: chatqna`, `operation: /chatqna`
2. **Sort by duration** (descending) → Click slowest trace
3. **Examine waterfall**:
   - Long span in `retriever`? → Check ArangoDB query performance
   - Long span in `embedding`? → Check TEI service, GPU memory
   - Long span in `llm`? → Check vLLM queue, model size
4. **Drill down**: Click span to view attributes (e.g., `query.text`, `top_k`, `alpha`)
5. **Correlate logs**: Click log entries in span timeline to see error messages

#### Scenario: HTTP 500 Errors

1. **Navigate to Logs Viewer** → Filter `level: error`, `service: backend`
2. **Search for** `HTTP 500`, `ArangoDB error`, `Keycloak error`
3. **Click trace_id** in log entry → Jumps to associated trace
4. **View span timeline** → Identify which service/component failed
5. **Check span attributes** → View request parameters, user context

### Observability Environment Variables

Key variables in `.env` (Section 12C):

```bash
# Enable/disable observability stack (0 or 1)
ENABLE_OBSERVABILITY=1

# Grafana credentials
GRAFANA_ADMIN_USER=admin
GRAFANA_ADMIN_PASSWORD=<strong-password>

# Retention periods
VICTORIAMETRICS_RETENTION=30d
VICTORIALOGS_RETENTION=30d
VICTORIATRACES_RETENTION=30d

# Trace sampling rate (0.0-100.0)
OTEL_TRACES_SAMPLER_RATE=100.0

# OTLP Collector endpoint (for services to send telemetry)
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
```

---

## CI Pipeline

### Pipeline Scope (workflow rules)

The `workflow:` block controls which branches/sources trigger a pipeline at all:

| Source/Branch | Pipeline runs? |
|---|---|
| Merge request event | Yes (path-scoped jobs) |
| `main` branch push | Yes (all jobs) |
| `release/*` branch push | Yes (all jobs) |
| Scheduled (cron) | Yes (scheduled jobs only) |
| Web (manual trigger) | Yes (manual jobs only) |
| Tag | Yes (no lint/test jobs by design) |
| Feature branch push (no MR) | **No** — suppressed to avoid duplicates |
| Feature branch push (open MR) | **No** — MR pipeline runs instead |

### GitLab CI Stages

The pipeline runs in 6 stages:

| Stage | Jobs | Purpose |
|-------|------|---------|
| lint | lint:backend, lint:frontend, lint:doc-repo, lint:python, lint:dart | Code quality (ESLint, Prettier, Ruff, dart analyze) |
| test | test:backend, test:frontend, test:doc-repo, test:python, test:sitecustomize, test:flutter | Unit/integration tests with JUnit XML |
| config | config:validate | Environment variable coverage and consistency |
| e2e | e2e:integration, patrol:e2e, e2e:playwright | End-to-end tests (merge trains only) |
| scheduled | scheduled:integration, scheduled:e2e-mobile, scheduled:e2e-web, scheduled:melt-* | Nightly jobs via pipeline schedule |
| manual | manual:rag-quality | Manual RAG quality regression (web trigger, GPU runner) |

### Per-Job Rules (path-scoped on MR, full suite on main/release)

Each lint/test/config job uses a two-rule pattern:

```yaml
rules:
  - if: '$CI_PIPELINE_SOURCE == "merge_request_event"'
    changes:
      - "components/gov-chat-backend/**/*"
      - ".gitlab-ci.yml"
    when: on_success
  - if: '$CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH || $CI_COMMIT_BRANCH =~ /^release\/*/'
    when: on_success
```

- **Rule 1 (MR)**: Job only runs if changed files match the `changes:` glob. `.gitlab-ci.yml` is included in every job so CI changes trigger a full validation.
- **Rule 2 (main/release)**: Job always runs on `main` and `release/*` branches, regardless of changed files.

### Path-Based Trigger Mapping

| Changed files | MR jobs triggered |
|---|---|
| `components/gov-chat-backend/**/*` | lint:backend, test:backend |
| `components/gov-chat-frontend/**/*` | lint:frontend, test:frontend |
| `components/document-repository/**/*` | lint:doc-repo, test:doc-repo |
| `genie-ai-overlay/**/*.py` | lint:python, test:python |
| `mobile/genie_ai_mobile/**/*` | lint:dart, test:flutter |
| `configs/ssl/**/*` | test:sitecustomize |
| `env`, `docker-compose.yaml`, `api-gateway-solution/new-config/**/*` | config:validate |
| `.gitlab-ci.yml` | **All jobs** (full validation) |

### E2E Jobs

E2E jobs only run on **merge trains** (not regular MR pushes):

| Job | Scope | Trigger |
|---|---|---|
| e2e:integration | Mobile + web E2E | Merge train, changes in mobile/frontend/backend/e2e |
| patrol:e2e | Patrol mobile E2E | Merge train, changes in mobile |
| e2e:playwright | Playwright web E2E | Merge train, changes in e2e/frontend/backend/doc-repo |

Scheduled E2E runs nightly via pipeline schedule (`$CI_PIPELINE_SOURCE == "schedule"`).

### JUnit XML Reports

All test jobs generate JUnit XML reports for GitLab's test visualization:

```yaml
# Example: test:backend
test:backend:
  script:
    - cd components/gov-chat-backend && npm ci
    - npm test -- --coverage --coverageReporters=text-summary --coverageReporters=cobertura
  artifacts:
    when: always
    reports:
      junit: components/gov-chat-backend/junit.xml
      coverage_report:
        coverage_format: cobertura
        path: components/gov-chat-backend/coverage/cobertura-coverage.xml
```

**View test results:**
1. Open Pipeline in GitLab → Click "Test" job
2. "Tests" tab shows pass/fail summary
3. Click test file to see individual test cases
4. Download `junit.xml` for offline analysis

### MR Blocking on Failure

**Protected branches** (`main`, `release/*`):
- Pipeline **must pass** before MR can be merged
- Failing jobs block merge automatically
- No manual override allowed

**Feature branches** (`feat/*`, `fix/*`):
- Pipeline runs but does not block commits
- Warnings displayed in MR page

### Running CI Checks Locally

Before pushing, run the same checks locally to avoid CI failures:

```bash
# Run all lint checks
npm run lint
npm run lint:py
npm run lint:dart

# Run all tests
cd components/gov-chat-backend && npm test
cd components/gov-chat-frontend && npm test
cd components/document-repository && npm test
cd genie-ai-overlay && pytest

# Validate config
cd tests/config-validator && npm test

# Run E2E tests (requires services running)
npm run test:e2e
```

**Parallel execution with npm-run-all:**

```bash
# Install globally
npm install -g npm-run-all

# Run all lint checks in parallel
npm-run-all --parallel lint lint:py lint:dart

# Run all tests in parallel
npm-run-all --parallel test test:py
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
