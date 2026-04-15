# Environment Files Convention

## Standard
- **`env`** (no extension, project root) = Configuration template, committed to git
- **`.env`** (with dot, project root) = Local variables, **NEVER committed** (gitignored)

## Local initialization
On first start or after cloning the repo:

```bash
cp env .env
# Then edit .env with your local values (passwords, API keys, etc.)
```

## Docker Compose
Services read variables via `env_file` in `docker-compose.yaml` or system environment variables.

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
| Redis | 6379 (container, internal only) |
| ClamAV | 3310 |

## Test account
- **Username:** jrevillard
- **Password:** Test1234!
