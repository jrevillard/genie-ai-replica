# GENIE.AI Development Guide

## Prerequisites

**System Requirements:**
- Docker and Docker Compose v2+ (with Swarm support)
- NVIDIA GPU (for optimal AI performance)
- Hugging Face API token

**Software Versions:**
- **Node.js**: Latest LTS version
- **Python**: Latest version (used in OPEA services)
- **Flutter**: 3.10.8+ (for mobile applications)
- **Dart**: 3.10.8+ (for mobile applications)

## Installation Steps

**1. Repository Setup:**
```bash
git clone <repository-url>
cd GENIE.AI
cp env .env
# Edit .env with your secrets (ARANGO_PASSWORD, KEYCLOAK_ADMIN_PASSWORD, etc.)
```

**2. Backend Services:**
```bash
cd components/gov-chat-backend
npm install
```

**3. Frontend Application:**
```bash
cd ../gov-chat-frontend
npm install
```

**4. Mobile Application:**
```bash
cd ../../mobile/genie_ai_mobile
flutter pub get
```

## Environment Setup

**Environment Configuration:**
- Copy `env` to `.env` and configure required secrets
- Key variables: `ARANGO_PASSWORD`, `KEYCLOAK_ADMIN_PASSWORD`, `HUGGING_FACE_HUB_TOKEN`
- Optional: GPU-specific override files (`env.t4`, `env.rtx6000`)

**Development Environment Variables:**
```bash
# Frontend
VUE_APP_API_URL=/api
VUE_APP_CSP_CONNECT_SRC='self' http://localhost:3000

# Backend
LOG_LEVEL=info
CORS_ALLOWED_ORIGINS=http://localhost:3000,http://localhost:8090

# Mobile
FLAVOR=dev  # or itu, staging, e2e
```

## Build Commands

**Frontend (Vue.js):**
```bash
cd components/gov-chat-frontend
npm run build    # Production build
npm run serve    # Development server
```

**Backend (Node.js):**
```bash
cd components/gov-chat-backend
npm run start    # Production server
npm run dev      # Development with nodemon
```

**Mobile (Flutter):**
```bash
cd mobile/genie_ai_mobile
# Development
flutter run -d chrome                    # Web
flutter run                            # Android
flutter run --flavor dev               # Android with flavor

# Building for release
flutter build apk --flavor dev --debug    # Debug APK
flutter build apk --flavor itu --release # Release APK
```

## Test Commands

**Frontend Tests:**
```bash
cd components/gov-chat-frontend
npm test
npm run lint:fix
npm run format:check
```

**Backend Tests:**
```bash
cd components/gov-chat-backend
npm test
npm run lint:fix
npm run format:check
```

**Mobile Tests:**
```bash
cd mobile/genie_ai_mobile
flutter analyze                    # Static analysis
flutter test                      # Unit tests
dart format --check .             # Format check
```

**E2E Tests:**
```bash
# From monorepo root
npm run test:e2e          # Playwright E2E tests
npm run test:e2e:list    # List available tests
```

## Deployment

### Docker Compose (Local Development)
```bash
# Core services only
docker compose up -d

# Full stack with AI services
docker compose --profile opea up -d

# With GPU-specific configuration
docker compose --env-file .env --env-file env.t4 --profile opea up -d
```

### Docker Swarm (Production)
```bash
cd deploy/ansible
ansible-playbook -i inventory/<env>.ini deploy.yml --vault-id <env>@prompt
```

## Contribution Guidelines

### Code Style Rules

**JavaScript/Vue.js:**
- ESLint + Prettier configuration
- Follow Vue 3 Options API patterns

**Node.js:**
- Standard JavaScript conventions
- Winston logging with daily rotation

**Python:**
- Ruff for linting and formatting

**Flutter/Dart:**
- Material Design 3 guidelines
- Flutter linter (dart analyze)

### Commit Conventions

**Commit Message Format:**
```
type(scope): description

# Examples:
feat(auth): add OAuth2 login flow
fix(chat): resolve message sending timeout
docs(readme): update installation guide
test(api): add user authentication tests
```
