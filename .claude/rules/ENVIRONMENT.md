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
