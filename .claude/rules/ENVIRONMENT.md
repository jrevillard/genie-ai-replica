# Environment Files Convention

## Standard
- **`env`** (no extension) = Configuration template, committed to git
- **`.env`** (with dot) = Local variables, **NEVER committed** (gitignored)

## Per-service structure
Each service has its own `env` file in its folder:

```
components/
├── gov-chat-backend/env      # Committed template
├── gov-chat-frontend/env     # Committed template
└── document-repository/env   # Committed template
```

## Local initialization
On first start or after cloning the repo:

```bash
# For each service that has secrets
cp components/gov-chat-backend/env components/gov-chat-backend/.env
cp components/gov-chat-frontend/env components/gov-chat-frontend/.env
cp components/document-repository/env components/document-repository/.env
```

Then edit `.env` files with your local values (passwords, API keys, etc.).

## Docker Compose
Services read variables either via `env_file` in `docker-compose.yaml` or via system environment variables.

**IMPORTANT:** Use the root `docker-compose.yaml` for all operations:

```bash
# Core services only
docker compose up -d

# Full stack with OPEA
docker compose --profile opea up -d

# Rebuild a specific service
docker compose build [service_name]
```

## NEVER commit
- `.env*` files → Contain secrets, are in `.gitignore`
- `env` files (no extension) → Templates, can be committed

## Centralized .gitignore
All ignore rules are in the root `.gitignore` - no per-service `.gitignore` files.

## Service Ports
| Service | Port |
|---------|------|
| Frontend | 8090 |
| Backend | 3000 |
| Document Repository | 3001 |
| ArangoDB | 8529 |
| Redis | 6380 (host) / 6379 (container) |
| ClamAV | 3310 |

## Test account
- **Username:** jrevillard
- **Password:** Test1234!
