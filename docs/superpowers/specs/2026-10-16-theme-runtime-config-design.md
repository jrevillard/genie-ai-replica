# Theme Runtime Config — Design Spec

- **Issue**: [#998](https://opensource.unicc.org/un/itu/genie-ai/-/issues/998)
- **Date**: 2026-10-16
- **Status**: Draft (post-brainstorming, pre-implementation)
- **Author**: brainstorming session output
- **Path**: architectural (multi-component, alters deploy interface)

## Problem

Theme and palette changes currently require a full image rebuild + redeploy (~10 min CI cycle) because:

1. `theme-variables.css` is bundled into hashed JS/CSS by Vite at build time → cannot be overridden at runtime
2. Keycloak theme CSS files are baked into the Keycloak image via `COPY themes/ /opt/keycloak/themes/`
3. `genie-ai-config.json` (brandColor, etc.) IS loaded at runtime by `main.js`, but most semantic overrides (success/warning/danger/info/bg/fg) live in the bundled CSS

Real impact: the El Salvador UI overhaul (MR !385) shipped via full image rebuild for a pure visual change.

## Goal

Move all theme assets (frontend palette + brand JSON + Keycloak theme) to runtime-mounted configuration, sourced from the host filesystem. Editing a file on the host → restart the affected service → change visible in browser. No image rebuild, no CI cycle.

## Non-goals

- Image rebuild pipeline changes (CI still produces the same images; only adds mount points)
- Generic multi-tenancy theme system (one palette per environment at a time)
- Theme picker UI for end users
- Secrets (passwords, API keys) — stay in vault.yml, not in mounted config dir

## Architecture

```
                    ┌─────────────────────────────────────────────┐
                    │ /opt/genieai-<env>/config/                   │
                    │   ├── frontend/                              │
                    │   │   ├── theme-variables.css                │
                    │   │   ├── genie-ai-config.json               │
                    │   │   ├── logo-genie-ai.jpeg                 │
                    │   │   └── splash-*.png                       │
                    │   └── keycloak/themes/genie/                 │
                    │       ├── login/theme.properties            │
                    │       ├── login/template.ftl                │
                    │       └── login/resources/css/*.css         │
                    └────────────┬────────────────────────────────┘
                                 │ bind mount (rsync initial)
                                 ▼
        ┌─────────────────────────┴─────────────────────────┐
        ▼                                                    ▼
   frontend (nginx:alpine)                       keycloak (upstream)
   /app/dist/config/                             /opt/keycloak/themes/genie/
   (image-baked default shadowed                (image-baked default shadowed
    by the mount)                                  by the mount)
        │                                                    │
        ▼                                                    ▼
   browser fetches:                                browser login page:
   - /config/theme-variables.css                  - styles from mounted CSS
   - /config/genie-ai-config.json                 - template.ftl from mounted
```

### Source-of-truth strategy

- **Repo** (`components/gov-chat-frontend/public/config/`, `configs/keycloak/themes/genie/`) is the canonical source for default theme assets.
- **Ansible** (`config_bootstrap` role) rsyncs the repo defaults into `/opt/genieai-<env>/config/` on every node at deploy time, **only if the destination directory is empty**. This preserves manual edits made directly on a node.
- **No shared filesystem** (NFS/CephFS) — Ansible is the single source-of-truth distributor, matching the existing deploy contract.

### Mount strategy

- Per-component bind mount (not full-image replacement). The image keeps its baked defaults; the mount provides a runtime overlay. If the mount is missing, services fall back to baked defaults.
- Two bind mounts total:
  - `/opt/genieai-<env>/config/frontend/` → `/app/dist/config/` (frontend, read-only)
  - `/opt/genieai-<env>/config/keycloak/themes/genie/` → `/opt/keycloak/themes/genie/` (keycloak, read-only)

## Component changes

### Frontend (`components/gov-chat-frontend/`)

- **Move**: `src/theme-variables.css` → `public/config/theme-variables.css`
  - `public/` is Vite's passthrough directory (not bundled, copied verbatim to `dist/`)
  - The CSS is then served at runtime via `/config/theme-variables.css`
- **`src/main.js`**:
  - Remove `import './theme-variables.css'` (line 24)
  - Existing `loadConfig()` already injects CSS custom properties from `genie-ai-config.json` (brand, colors, navbar, font) — no change needed
  - No further extension in this MR; future palette additions go through `genie-ai-config.json` schema
- **`public/index.html`**: add `<link rel="stylesheet" href="/config/theme-variables.css">` before the existing `<script src="/config.js">`
- **`nginx.conf`**: add a new `location /config/` block BEFORE the regex location that matches `.css`, with `Cache-Control: no-cache, must-revalidate`. The current regex `~* \.(js|css|...)` would otherwise impose `immutable, max-age=31536000` and break live updates.

### Keycloak (`configs/keycloak/`)

- **Delete**: `configs/keycloak/Dockerfile` (no longer needed — upstream image provides defaults)
- **Keep**: `configs/keycloak/themes/genie/login/{theme.properties, template.ftl}` and any `resources/css/*.css`
- **`docker-compose.yaml`** (line 1578): replace `build: configs/keycloak/` with `image: quay.io/keycloak/keycloak:26.7`
- Add bind mount for `/opt/keycloak/themes/genie/` (see Mount strategy above)

### docker-compose.yaml

Two new bind mounts using the existing `${VAR:-default}` envsubst pattern:

```yaml
services:
  frontend:
    volumes:
      - ${CONFIG_DIR_FRONTEND:-./components/gov-chat-frontend/public/config}:/app/dist/config:ro

  keycloak:
    volumes:
      - ${CONFIG_DIR_KEYCLOAK:-./configs/keycloak/themes/genie}:/opt/keycloak/themes/genie:ro
```

- Default values target the repo paths so `docker compose up` works locally with zero config.
- In Swarm mode, Ansible writes `CONFIG_DIR_FRONTEND` and `CONFIG_DIR_KEYCLOAK` into `/opt/genieai-<env>/.env` from the new role's defaults.

### Ansible (`deploy/ansible/`)

- **New role** `roles/config_bootstrap/`:
  - `tasks/main.yml`:
    - `file: path={{ config_dir }}/{{ item }} state=directory mode=0755` for `frontend/` and `keycloak/themes/genie/`
    - `synchronize: src={{ role_path }}/files/frontend/ dest={{ config_dir }}/frontend/` (rsync, `delete: false`, only copies files that don't exist locally)
    - Same for `keycloak/themes/genie/`
  - `defaults/main.yml`: `config_dir: /opt/genieai-{{ env_name }}/config`
  - `meta/main.yml`: `galaxy_info` with author + dependencies

- **`deploy.yml`**: new play with `tags: [config]` that applies the role to `[all]`. Update header comment to document the new tag.

- **`templates/env.j2`**:
  - Add: `CONFIG_DIR_FRONTEND={{ config_dir }}/frontend`
  - Add: `CONFIG_DIR_KEYCLOAK={{ config_dir }}/keycloak`

- **`group_vars/all.yml`**: no new entry needed (the var is local to the role's defaults).

## File-level change list

| File | Change |
|------|--------|
| `components/gov-chat-frontend/src/theme-variables.css` | DELETE |
| `components/gov-chat-frontend/public/config/theme-variables.css` | CREATE (moved content) |
| `components/gov-chat-frontend/src/main.js` | Remove `import './theme-variables.css'` |
| `components/gov-chat-frontend/public/index.html` | Add `<link rel="stylesheet" href="/config/theme-variables.css">` |
| `components/gov-chat-frontend/nginx.conf` | Add `location /config/` block with no-cache |
| `configs/keycloak/Dockerfile` | DELETE |
| `docker-compose.yaml` | Replace keycloak `build:` with `image:`; add 2 bind mounts |
| `deploy/ansible/roles/config_bootstrap/` | NEW role |
| `deploy/ansible/deploy.yml` | Add new play with `tags: [config]`; update docstring |
| `deploy/ansible/templates/env.j2` | Add 2 new env vars |

## Error handling

### Frontend: `/config/genie-ai-config.json` fetch fails

- Already handled: `loadConfig()` logs `console.error` and falls back to the bundled defaults in `public/config/config.js`. No change needed.

### Frontend: `/config/theme-variables.css` 404

- New risk: page renders unstyled. Mitigation: `<link>` carries `onerror="document.head.appendChild(Object.assign(document.createElement('style'),{textContent:':root{--brand:#4071cb;--bg:#fff;--fg:#1a1a1a;--success:#22c55e;--warning:#f59e0b;--danger:#ef4444;--info:#3b82f6;}'}))"` as an inline fallback. Page degrades to default GENIE.AI palette instead of unstyled white.

### Keycloak: theme CSS missing

- Keycloak falls back to upstream default theme. Acceptable degradation but ugly. Mitigation: the `config_bootstrap` role's `synchronize` step uses `delete: false` so baked images stay available. Ansible logs a warning if `config_dir/keycloak/themes/genie/` is empty after the role runs.

### Swarm: bind mount path missing

- Service starts normally using image-baked defaults. Ansible logs warning. This is the backwards-compat path — existing deploys continue to work without any host-side setup.

## Testing strategy

- **Jest unit tests** (`components/gov-chat-frontend/src/__tests__/`):
  - `loadConfig()` mock `fetch` to return 404 → assert bundled defaults used
  - `loadConfig()` mock `fetch` to return valid JSON → assert CSS custom properties set on `document.documentElement`
  - `loadConfig()` mock `fetch` to return malformed JSON → assert error logged, fallback used

- **Playwright E2E** (`tests/e2e/`):
  - Fetch `/config/theme-variables.css` → assert `Cache-Control` header is `no-cache, must-revalidate`
  - Fetch `/assets/index-*.js` (hashed asset) → assert `Cache-Control` header is `immutable, max-age=31536000`
  - Edit `genie-ai-config.json` on a test fixture, restart container, fetch the page → assert new color applied (visual regression)

- **Ansible smoke test**:
  - Run the role twice on a fresh VM → assert second run is no-op (`config_dir` already populated)
  - Delete one file in `config_dir/frontend/`, rerun → assert file NOT recreated (manual edits preserved)

- **Backward compat smoke**:
  - Deploy with no `CONFIG_DIR_FRONTEND` env set → assert frontend loads (uses image-baked defaults)
  - Deploy with no `CONFIG_DIR_KEYCLOAK` env set → assert keycloak serves upstream theme (or its own baked fallback)

## Migration & rollback

### Rollout

1. Merge MR on `main` → CI builds images that still contain baked-in defaults (no behavior change).
2. First Ansible deploy with `--tags config` → creates `/opt/genieai-<env>/config/{frontend,keycloak/themes/genie}/` with rsync'd defaults.
3. Future theme changes: edit file on the node + `docker service update --force <svc>`.

### Rollback

- Remove the bind mount lines from `docker-compose.yaml` and redeploy. Image-baked defaults restored. No data loss.
- Or unset `CONFIG_DIR_FRONTEND` / `CONFIG_DIR_KEYCLOAK` in `.env` and redeploy — mount paths fall back to `./components/gov-chat-frontend/public/config` and `./configs/keycloak/themes/genie` which don't exist in production but the service still starts using baked defaults.

### Deprecation

- `public/config/` stays in `public/` so image-baked defaults remain valid indefinitely. No cleanup task.

## Acceptance criteria

- Editing `theme-variables.css` on a host → visible in browser after `docker service update --force frontend`, no image rebuild
- Editing `genie-ai-config.json` on a host → visible in browser after `docker service update --force frontend`, no image rebuild
- Editing Keycloak login CSS on a host → visible in browser after `docker service update --force keycloak`, no image rebuild
- Existing tokens (AgroGenio for el-salvador, default for main) preserved as baked defaults
- Backwards-compatible: existing deploys continue to work without `CONFIG_DIR_*` env vars
- Ansible deploy supports both full (`build,deploy,config`) and theme-only (`config` alone, plus a `docker service update --force`) flows
- One MR implementing the full migration + updated docs

## Open questions

None. All ambiguities resolved during brainstorming 2026-10-16.