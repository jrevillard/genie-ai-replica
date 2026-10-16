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
- **Ansible** (`config_bootstrap` role) rsyncs repo defaults into `/opt/genieai-{{ env_name }}/config/` on every node at deploy time using `synchronize` with `delete: false` and `rsync_opts: [--ignore-existing]`. This:
  - Skips files that already exist on the node (preserves manual operator edits made between deploys)
  - Never deletes files that exist only on the node (no data loss)
  - Idempotent: second invocation is a no-op (all files already present)
- **rsync source paths** are computed from `playbook_dir` (role uses cross-tree rsync, not its own `files/` directory):
  - `frontend`: `{{ playbook_dir }}/../../components/gov-chat-frontend/public/config/`
  - `keycloak`: `{{ playbook_dir }}/../../configs/keycloak/themes/genie/`
  - Avoids role-local file duplication that would drift from the canonical repo paths
- **No shared filesystem** (NFS/CephFS) — Ansible is the single source-of-truth distributor, matching the existing deploy contract.
- **`env_name`** is defined in `group_vars/all.yml` as the inventory group name (e.g., `main`, `test`, `itu_rtx_el_salvador`) and used in the role's `config_dir` default. Fallback in the role: `config_dir: "/opt/genieai-{{ env_name | default(group_names[0] | default('default')) }}/config"`.

### Mount strategy

- Per-component bind mount (not full-image replacement). The image keeps its baked defaults; the mount provides a runtime overlay. If the mount is missing, services fall back to baked defaults.
- Two bind mounts total:
  - `/opt/genieai-<env>/config/frontend/` → `/app/dist/config/` (frontend, read-only)
  - `/opt/genieai-<env>/config/keycloak/themes/genie/` → `/opt/keycloak/themes/genie/` (keycloak, read-only)

## Component changes

### Frontend (`components/gov-chat-frontend/`)

- **Move**: `src/theme-variables.css` → `public/config/theme-variables.css`
  - The Vue CLI `public/` directory is copied verbatim to `dist/` at build time (passthrough, not bundled)
  - The CSS is then served at runtime via `/config/theme-variables.css`
- **`src/main.js`**:
  - Remove `import './theme-variables.css'` (line 24)
  - Existing `loadConfig()` already injects CSS custom properties from `genie-ai-config.json` (brand, colors, navbar, font) — no change needed
  - No further extension in this MR; future palette additions go through `genie-ai-config.json` schema
- **`public/index.html`**: add `<link rel="stylesheet" href="/config/theme-variables.css">` before the existing `<script src="/config.js">`. Add an HTML comment above the `<link>` documenting the load order contract: "CSS tokens load first; `main.js` overrides a runtime subset via `loadConfig()`."
- **`public/config/theme-variables-fallback.css`** (NEW): a verbatim copy of the upstream `theme-variables.css` content shipped inside the image as a safety net. `index.html` `<link onerror>` fetches this file and inlines it via JS (no inline-style spaghetti of 50+ tokens in HTML). Single source of truth: the canonical file is the fallback file; update both together.
- **`nginx.conf`**:
  - Add `location ^~ /config/` block (note the `^~` modifier, NOT plain `location /config/`). The `^~` modifier tells nginx to use this prefix match as the priority match even when a regex location also matches — without it, the existing regex `~* \.(js|css|...)` wins regardless of source-file ordering and would still apply `Cache-Control: immutable, max-age=31536000` to `/config/*`, defeating the entire purpose.
  - The block sets `Cache-Control: no-cache, must-revalidate`. Browsers send `If-Modified-Since` / `If-None-Match`; nginx returns `304 Not Modified` with the updated body when the file changed.
  - **Coverage**: `/config/` covers `theme-variables.css`, `genie-ai-config.json`, splash assets, AND the relocated `config.js` (see below).
- **`docker-entrypoint.sh` + `server.js`**: change `/config.js` → `/config/config.js` so the runtime-generated config file lives under the bind-mounted `config/` directory and inherits the no-cache policy. Update both the writer (entrypoint) and the loader (`index.html` `<script>` tag). This is the fix for the pre-existing immutable-cache bug on `/config.js` (out of scope for this MR originally, but trivial to include while `nginx.conf` is being touched).

### Keycloak (`configs/keycloak/`)

- **Delete**: `configs/keycloak/Dockerfile` (no longer needed — upstream image provides defaults)
- **Keep**: all four themed subdirectories under `configs/keycloak/themes/genie/`:
  - `login/` — login pages
  - `account/` — account console
  - `admin/` — admin console
  - `email/` — email templates (password reset, verify email, etc.)
  - The realm config (`configs/keycloak/genie-realm.yaml`) sets all four theme types (`loginTheme`, `accountTheme`, `adminTheme`, `emailTheme`) to the same value via `KEYCLOAK_THEME`, so ALL FOUR subdirs must be present or the relevant flow silently reverts to upstream defaults. The El Salvador `!385` brand overhaul shipped assets across all four flows.
- **`docker-compose.yaml`** (line 1578): replace `build: configs/keycloak/` with `image: quay.io/keycloak/keycloak:26.7.0` (exact patch pin for reproducibility; matches project pin-everything convention)
- Add bind mount for `/opt/keycloak/themes/genie/` (see Mount strategy above). The mount source must contain all four subdirs; the rsync step in `config_bootstrap` covers the entire `themes/genie/` subtree, not just `themes/genie/login/`.
- **CI impact**: deleting `configs/keycloak/Dockerfile` removes one image from the build matrix. Verify `.gitlab-ci.yml` does not reference `configs/keycloak/Dockerfile` paths in build, scan, promote, or smoke steps. Pipeline must build N-1 images post-merge.

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
    - `synchronize: src={{ playbook_dir }}/../../components/gov-chat-frontend/public/config/ dest={{ config_dir }}/frontend/ delete=false rsync_opts=["--ignore-existing"]`
    - `synchronize: src={{ playbook_dir }}/../../configs/keycloak/themes/genie/ dest={{ config_dir }}/keycloak/themes/genie/ delete=false rsync_opts=["--ignore-existing"]`
  - `defaults/main.yml`: `config_dir: "/opt/genieai-{{ env_name | default(group_names[0] | default('default')) }}/config"`
  - `meta/main.yml`: `galaxy_info` with author + dependencies

- **`deploy.yml`**: new play with `tags: [config]` that applies the role to `[all]`. Update header comment to document the new tag.

- **`templates/env.j2`**:
  - Add: `CONFIG_DIR_FRONTEND={{ config_dir }}/frontend`
  - Add: `CONFIG_DIR_KEYCLOAK={{ config_dir }}/keycloak`

- **`group_vars/all.yml`**: add `env_name: "{{ group_names[0] | default('default') }}"` so the role's `config_dir` resolves consistently across inventory groups. The `env_name` value is used purely as a path component (e.g., `/opt/genieai-main/`, `/opt/genieai-test/`); it does not change deploy semantics.

## File-level change list

| File | Change |
|------|--------|
| `components/gov-chat-frontend/src/theme-variables.css` | DELETE |
| `components/gov-chat-frontend/public/config/theme-variables.css` | CREATE (moved content) |
| `components/gov-chat-frontend/public/config/theme-variables-fallback.css` | CREATE (verbatim copy of `theme-variables.css` for `<link onerror>` recovery) |
| `components/gov-chat-frontend/src/main.js` | Remove `import './theme-variables.css'` |
| `components/gov-chat-frontend/public/index.html` | Add `<link rel="stylesheet" href="/config/theme-variables.css">` with `onerror`; relocate `<script src="/config.js">` to `<script src="/config/config.js">` |
| `components/gov-chat-frontend/nginx.conf` | Add `location ^~ /config/` block (note: `^~`, not bare prefix) with `no-cache, must-revalidate` |
| `components/gov-chat-frontend/docker-entrypoint.sh` | Update runtime config writer from `/app/dist/config.js` → `/app/dist/config/config.js` |
| `components/gov-chat-frontend/public/config/.goutputstream-0J6X82` | DELETE (GIMP temp file, 211K, accidentally tracked) |
| `components/gov-chat-frontend/public/config/splash.xcf` | DELETE (GIMP source file, 211K, accidentally tracked) |
| `configs/keycloak/Dockerfile` | DELETE |
| `docker-compose.yaml` | Replace keycloak `build:` with `image: quay.io/keycloak/keycloak:26.7.0`; add 2 bind mounts |
| `.gitlab-ci.yml` | Remove `configs/keycloak/Dockerfile` from build matrix (one fewer image) |
| `deploy/ansible/roles/config_bootstrap/` | NEW role |
| `deploy/ansible/deploy.yml` | Add new play with `tags: [config]`; update docstring |
| `deploy/ansible/templates/env.j2` | Add 2 new env vars |
| `deploy/ansible/group_vars/all.yml` | Add `env_name: "{{ group_names[0] | default('default') }}"` |

## Error handling

### Frontend: `/config/genie-ai-config.json` fetch fails

- Already handled: `loadConfig()` logs `console.error` and falls back to the bundled defaults in `public/config/config.js`. No change needed.

### Frontend: `/config/theme-variables.css` 404

- New risk: page renders unstyled (or renders with only the 7 CSS vars that `loadConfig()` injects from `genie-ai-config.json`, leaving 40+ tokens unset). Mitigation: `<link>` carries an `onerror` handler that fetches `/config/theme-variables-fallback.css` (sibling file shipped inside the image), inlines its textContent into a `<style>` element, and removes the broken link. The fallback file is a verbatim copy of the canonical `theme-variables.css` at build time, kept in sync via the implementation commit. Single source of truth — the canonical file IS the fallback file; update both together (or symlink within the repo).

### Frontend: `/config.js` cache staleness (pre-existing, fixed in this MR)

- Pre-existing bug: `docker-entrypoint.sh` writes `/app/dist/config.js` at container start based on env vars, but the regex `nginx.conf` location `~* \.(js|css|...)` applies `Cache-Control: immutable, max-age=31536000`. Env-var-driven URL changes were invisible to browsers for up to 1 year.
- Fix in this MR: relocate runtime config writer to `/app/dist/config/config.js` (under the bind-mounted `config/` directory), update `index.html` `<script>` tag, and let the new `location ^~ /config/` block apply `no-cache, must-revalidate`. Trivial to include while `nginx.conf` is being touched; otherwise we'd ship a half-fix.

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
  - Fetch `/config/theme-variables.css` → assert `Cache-Control` header is `no-cache, must-revalidate` (no `immutable`, no `max-age=31536000`)
  - Fetch `/assets/index-*.js` (hashed asset) → assert `Cache-Control` header is `immutable, max-age=31536000` (unchanged from current behavior)
  - Fetch `/config/config.js` (runtime-generated, after the relocation) → assert `Cache-Control` is `no-cache, must-revalidate` (fixes pre-existing stale-cache bug on env-var changes)
  - Edit `genie-ai-config.json` on a test fixture, `page.reload()` (NOT hard reload), assert new color applied AND the network panel shows ONE request (the `304` revalidation), not two. This guards against accidental reintroduction of `immutable` on `/config/`.
  - Edit `theme-variables.css` on the host, `docker service update --force frontend`, `page.reload()`, assert new token value applied. End-to-end acceptance test.

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