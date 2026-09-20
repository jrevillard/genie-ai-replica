---
title: "Dev workflow"
weight: 3
description: "Set up a local dev environment — install, lint, test, debug, and iterate."
mode: how-to
persona: contributor
owner: docs-stewards
last_reviewed: 2026-09-18
---

## Goal

Set up a local GENIE.AI dev environment so **lint, test, and a backend hot
reload** all work.

## Prerequisites

| Tool | Version | Why |
|---|---|---|
| Node.js | 22.x | Backend, frontend, doc-repo |
| npm | 10.x | Bundled with Node 22 |
| Python | 3.11 | OPEA overlay development |
| Docker Engine | 23+ with Compose v2 | Dependency stack (ArangoDB, Redis, Keycloak) |
| Flutter | 3.10+ | Mobile dev (optional) |
| git | 2.40+ | Branch / rebase |
| glab | latest | GitLab MR / CI |

## Backend (`components/gov-chat-backend/`)

```bash
cd components/gov-chat-backend
npm install
npm run dev          # nodemon index.js (hot-reloads on save)
npm test             # full Jest suite
npm run test:contract # route handlers only
```

Lint / format:

```bash
npm run lint
npm run format
```

## Frontend (`components/gov-chat-frontend/`)

```bash
cd components/gov-chat-frontend
npm install
npm run serve        # dev server with hot reload (vue-cli-service serve)
npm test
```

## Document repository (`components/document-repository/`)

```bash
cd components/document-repository
npm install
npm run dev
npm test
```

## OPEA overlay (`genie-ai-overlay/`)

```bash
cd genie-ai-overlay
python -m venv .venv && source .venv/bin/activate
pip install -e ".[test]"
pytest                                          # full suite (mocks comps)
pytest tests/test_retriever.py                  # one file
pytest contracts/                               # contract suite — real comps
```

> {{< callout type="warning" >}}
> The contract suite (`contracts/`) only works inside the built image where
> the vendored `comps` library is real. From the host it is skipped.
> {{< /callout >}}

Lint / format:

```bash
ruff check .
ruff format --check .
```

## Mobile (`mobile/genie_ai_mobile/`)

```bash
cd mobile/genie_ai_mobile
flutter pub get
flutter test
flutter run                                      # against a running backend
```

## E2E tests (`tests/e2e/`)

Multi-phase procedure documented in `docs/e2e-tests/`. Phase 0 (clean start)
must run first.

```bash
npm run test:e2e
npm run test:e2e:list  # what's available
```

## Config validator

```bash
cd tests/config-validator
npm install
npm test            # every required env var is documented in the site
```

## Debugging

- **Trace a request end-to-end** → enable the observability profile and
  query VictoriaTraces via Grafana. See
  [Observe → Tracing](/docs/observe/tracing/).
- **Inspect a per-chunk ingestion log** → the `ingestion_log` collection in
  ArangoDB. See [Debugging with Tracing & Logs](https://opensource.unicc.org/un/itu/genie-ai/-/blob/main/.claude/rules/DEBUGGING-TRACING.md).
- **Reset the dependency stack** → `docker compose down -v && docker compose up -d`.

## Dependencies

GENIE.AI pins its Python dependencies per overlay module. The `retriever/`
and `reranker/` modules each ship a `requirements.in` and a locked
`requirements-cpu.txt`. Update by running `make lock-retriever` or
`make lock-reranker` from the **repo root** — the Makefile lives at the
project root and does the `cd` into the module itself. The underlying
`uv pip compile` invocation is:

```bash
uv pip compile requirements.in \
  --generate-hashes \
  --python-version 3.11 \
  --python-platform x86_64-manylinux_2_31 \
  --output-file requirements-cpu.txt
```

```bash
# From the repo root
make lock-retriever   # or: make lock-reranker
git add genie-ai-overlay/retriever/requirements-cpu.txt
```

The CI `verify:overlay-locks:retriever` and `verify:overlay-locks:reranker`
jobs fail if the lock is out of sync with the corresponding `.in` file.

## Pre-push checklist

```bash
# JS
npm run lint
npm run format:check

# Python
npm run lint:py
npm run format:py:check

# Dart (if you touched the mobile app)
cd mobile/genie_ai_mobile
flutter analyze
dart format --set-exit-if-changed .
```

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `npm install` fails on `bcrypt` | Missing build tools | `apt install build-essential python3` |
| `pytest` can't import `comps` | venv missing the OPEA source | Tests stub `comps` in `sys.modules` via `genie-ai-overlay/tests/conftest.py` — no install needed. To run the real (unmocked) contract suite, use the in-image `pytest contracts/` workflow instead. |
| `flutter test` fails on `keycloak` mocks | Outdated fixtures | `flutter pub get` and re-run |
| Backend hot reload misses a file change | nodemon watcher glitch | `touch` the file or restart |

## Related

- [How to open a MR](/docs/contribute/how-to-mr/)
- [Repo layout](/docs/contribute/repo-layout/)
- [Style guide](/docs/contribute/style-guide/)