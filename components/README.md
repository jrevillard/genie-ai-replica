# GENIE.AI Components

This directory contains the core GENIE.AI services:

| Directory | Service | Description |
|-----------|---------|-------------|
| `gov-chat-frontend/` | Frontend | Vue 3 web application |
| `gov-chat-backend/` | Backend | Node.js/Express API |
| `document-repository/` | Document Repository | File upload/processing with ClamAV |
| `arangodb/` | Database | ArangoDB setup and backup scripts |

## Running

All services are defined in the root `docker-compose.yaml` (dual-mode: `docker compose up` and `docker stack deploy`).

```bash
# From project root — core services only
docker compose up -d

# Full stack with OPEA/AI services
docker compose --profile opea up -d
```

## Configuration

All services use a single `.env` file at the project root (copy from `env` template).

## Per-Service Documentation

- [Backend Services](gov-chat-backend/README.md) — API routes, services, configuration
- [Frontend Application](gov-chat-frontend/README.md) — Vue.js components, configuration
- [Document Repository](document-repository/README.md) — File upload, virus scanning
- [ArangoDB Setup](arangodb/README.md) — Database configuration, backup, restore
