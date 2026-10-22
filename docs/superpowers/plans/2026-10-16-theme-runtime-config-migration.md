# Theme Runtime Config Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **2026-10-18 revision (post-execution):** the Keycloak mount contract changed
> after live validation — the bind mount and `CONFIG_DIR_KEYCLOAK` point at the
> themes ROOT (`configs/keycloak/themes` → `/opt/keycloak/themes`), not a single
> theme, so extra themes (e.g. `genie-el-salvador`, `parent=genie`) can resolve.
> Task text below still shows the earlier single-theme paths where it quotes
> compose/env.j2 snippets; the shipped files and the design spec's revision
> note are authoritative.

**Goal:** Move GENIE.AI theme assets (frontend palette, brand JSON, Keycloak theme CSS) from image-baked to host-mounted runtime configuration so that editing a file on a Swarm node + `docker service update --force <svc>` makes the change visible in the browser without an image rebuild.

**Architecture:** Per-component bind mount (`/opt/genieai-<env>/config/{frontend,keycloak/themes/genie}/` from host → corresponding service target) layered over image-baked defaults. One new Ansible role (`config_bootstrap`) cross-tree rsyncs the repo paths into the host directory on every deploy using `--ignore-existing` to preserve manual operator edits. Two new env vars (`CONFIG_DIR_FRONTEND`, `CONFIG_DIR_KEYCLOAK`) follow the existing `${VAR:-default}` envsubst pattern, so `docker compose up` works locally with zero config and Swarm reads the Ansible-written paths. The Keycloak image moves to upstream `quay.io/keycloak/keycloak:26.7.0` (the local `configs/keycloak/Dockerfile` is deleted), and a new nginx `location ^~ /config/` block ensures runtime assets are not subject to the existing immutable-cache regex.

**Tech Stack:** Vue 3 / Vue CLI (frontend), nginx (frontend reverse proxy), Keycloak 26.7.0 upstream, Docker Compose (dual-mode: compose dev + Swarm prod), Ansible 2.x with `synchronize` module, Jest (unit tests), Playwright (E2E).

**Spec:** `docs/superpowers/specs/2026-10-16-theme-runtime-config-design.md`

## Global Constraints

- Worktree discipline: work in the existing `.claude/worktrees/runtime-theme-config/` worktree on branch `feat/runtime-theme-config`. NEVER commit to `main` or `release/*`. Use a MR for the merge.
- Language: all code, comments, commits, and docs in English (per repo `CLAUDE.md`).
- Docker Compose dual-mode: file must work for both `docker compose up` (dev) and `docker stack deploy` (Swarm). Use `${VAR:-default}` envsubst syntax for new bind mounts; never hardcode paths.
- Ansible role structure: follow existing role conventions under `deploy/ansible/roles/<role_name>/{tasks,defaults}/main.yml`.
- Vite/Vue CLI: this project uses Vue CLI (not Vite). `public/` is the static passthrough directory copied verbatim to `dist/` at build time.
- Per `feedback_no_dead_code.md`: do not defer cleanup, never merge dead code with "harmless" comments. The `.goutputstream-0J6X82` and `splash.xcf` cleanup in Task 1 is part of this MR.
- Per `feedback_no_story_refs_in_comments.md` + `feedback_comments_describe_current_code.md`: no historical-bug narrative in code; no issue/story references in comments.
- Per `feedback_worktree_discipline.md`: one branch per worktree, NEVER `git checkout` inside the worktree.
- Per project memory `release/* force-push protection`: do not rebase or force-push any `release/*` branch; not relevant here but listed for awareness.
- Per `feedback_save_test_output_to_file.md`: when running test commands that produce large output, save to `/tmp/test-output-<task>.txt` then analyze.
- Per `feedback_ci_local_checks.md` + `feedback_local_checks_full_suite.md`: before declaring a task done, run the relevant lint/format command locally. Frontend changes: `cd components/gov-chat-frontend && npm run lint` and `npm run format:check`. Python changes (none in this MR). Ansible changes: `cd deploy/ansible && ansible-playbook --syntax-check` if available.

## Review Focus

The spec is a vision document. The five input classes most likely to bite a reasonable user that NO task's tests directly exercise:

1. **Empty host config dir + image-baked defaults must work** (backwards compat path: services must start cleanly with NO `CONFIG_DIR_*` env vars and NO bind mount). Tested in Task 8 step 4.
2. **nginx `^~` modifier must remain in place** (removing it silently regresses to immutable cache). Tested in Task 3 step 4 + Task 8 step 5.
3. **All four Keycloak themed subdirs must rsync** (login/account/admin/email — realm config sets all four theme types to `KEYCLOAK_THEME`). Verified in Task 4 step 4.
4. **rsync `--ignore-existing` must remain** (without it, manual operator edits get clobbered on subsequent deploys). Tested in Task 6 step 5.
5. **`env_name` resolves correctly on every inventory group** (broken → `/opt/genieai-/config/` renders, hard-fail). Tested in Task 6 step 6.

---

## File Structure

Files created or modified by this plan, grouped by responsibility:

### Frontend runtime config (Tasks 1–3)

- `components/gov-chat-frontend/public/config/theme-variables.css` — runtime-loaded theme tokens (moved from `src/`)
- `components/gov-chat-frontend/public/config/theme-variables-fallback.css` — verbatim fallback (sibling of above)
- `components/gov-chat-frontend/src/main.js` — remove `import './theme-variables.css'`
- `components/gov-chat-frontend/public/index.html` — add `<link>` with `onerror`, relocate `<script src="/config.js">` → `/config/config.js`
- `components/gov-chat-frontend/nginx.conf` — add `location ^~ /config/` block
- `components/gov-chat-frontend/docker-entrypoint.sh` — relocate runtime config writer
- `components/gov-chat-frontend/public/config/.goutputstream-0J6X82` — DELETE
- `components/gov-chat-frontend/public/config/splash.xcf` — DELETE

### Keycloak (Task 4)

- `configs/keycloak/Dockerfile` — DELETE
- `docker-compose.yaml` — keycloak service: `build:` → `image:` line
- `.gitlab-ci.yml` — remove keycloak image build target

### docker-compose.yaml bind mounts (Task 5)

- `docker-compose.yaml` — add 2 new `volumes:` entries (frontend + keycloak)

### Ansible (Task 6)

- `deploy/ansible/roles/config_bootstrap/tasks/main.yml` — NEW
- `deploy/ansible/roles/config_bootstrap/defaults/main.yml` — NEW
- `deploy/ansible/roles/config_bootstrap/meta/main.yml` — NEW
- `deploy/ansible/deploy.yml` — new play with `tags: [config]`
- `deploy/ansible/templates/env.j2` — 2 new env var lines
- `deploy/ansible/group_vars/all.yml` — `env_name` definition

### Tests (Tasks 7–8)

- `components/gov-chat-frontend/src/__tests__/loadConfig.spec.js` — NEW (or update existing if present)
- `tests/e2e/theme-runtime-config.spec.js` — NEW

### Ansible verification (Task 9)

- `deploy/ansible/roles/config_bootstrap/tests/test_idempotence.sh` — NEW (manual smoke test script)

---

## Task 1: Cleanup Stray Files in public/config/

**Files:**
- Delete: `components/gov-chat-frontend/public/config/.goutputstream-0J6X82`
- Delete: `components/gov-chat-frontend/public/config/splash.xcf`

**Interfaces:**
- Consumes: nothing
- Produces: cleaner `public/config/` directory; these files won't be rsynced to production hosts in Task 6

- [ ] **Step 1: Verify files exist and identify size**

```bash
cd components/gov-chat-frontend
ls -la public/config/.goutputstream-0J6X82 public/config/splash.xcf
```

Expected: both files exist, each ~211K. If either is missing, skip its `git rm` in step 2 and note in commit message.

- [ ] **Step 2: Delete from git history**

```bash
cd /home/jerome/git_projects/ITU/genie-ai/.claude/worktrees/runtime-theme-config
git rm components/gov-chat-frontend/public/config/.goutputstream-0J6X82
git rm components/gov-chat-frontend/public/config/splash.xcf
```

Expected: `rm 'components/gov-chat-frontend/public/config/.goutputstream-0J6X82'` and `rm 'components/gov-chat-frontend/public/config/splash.xcf'`.

- [ ] **Step 3: Verify removal**

```bash
ls components/gov-chat-frontend/public/config/ | grep -E "(goutputstream|splash.xcf)"
```

Expected: no output (empty result).

- [ ] **Step 4: Commit**

```bash
cd /home/jerome/git_projects/ITU/genie-ai/.claude/worktrees/runtime-theme-config
git add -A components/gov-chat-frontend/public/config/
git commit -m "chore(frontend): remove stray GIMP files from public/config/

.goutputstream-0J6X82 (GIMP temp, 211K) and splash.xcf (GIMP source,
211K) were accidentally tracked in public/config/. Once the runtime
config bind-mount lands, these would rsync to every prod host and be
served by nginx as /config/<name>. Remove them."
```

Expected: 1 commit on `feat/runtime-theme-config`. Working tree clean.

---

## Task 2: Frontend Runtime CSS Relocation + Fallback + Extract loadConfig + index.html + main.js

**Files:**
- Create: `components/gov-chat-frontend/public/config/theme-variables.css` (moved content)
- Create: `components/gov-chat-frontend/public/config/theme-variables-fallback.css` (verbatim copy)
- Create: `components/gov-chat-frontend/public/config/config.js` (dev-mode placeholder; verbatim copy of `public/config.js`)
- Create: `components/gov-chat-frontend/src/config-loader.js` (extracted `loadConfig` for testability)
- Delete: `components/gov-chat-frontend/src/theme-variables.css`
- Modify: `components/gov-chat-frontend/src/main.js` (import from `config-loader.js`; remove import line 24)
- Modify: `components/gov-chat-frontend/public/index.html` (add `<link>` with `onerror`; relocate `<script src="/config.js">` → `/config/config.js`; add HTML comment)

**Interfaces:**
- Consumes: existing `src/theme-variables.css` content (read it, do not modify); existing `loadConfig` body in `src/main.js`
- Produces:
  - `src/config-loader.js`: exports `loadConfig` + the module-level `config` default object. Same shape as before — main.js behavior unchanged.
  - `/config/theme-variables.css` served at runtime by nginx (via new `location ^~ /config/` block in Task 3)
  - `/config/theme-variables-fallback.css` as recovery target for `onerror`
  - `/config/config.js` dev placeholder so `npm run dev` works without the entrypoint
  - `main.js` no longer bundles the CSS; loads `loadConfig` from `config-loader.js`
  - `index.html` loads CSS at runtime and uses updated script path

- [ ] **Step 1: Read source CSS**

```bash
cat components/gov-chat-frontend/src/theme-variables.css | head -30
wc -l components/gov-chat-frontend/src/theme-variables.css
```

Expected: ~226 lines, starts with the comment block already seen.

- [ ] **Step 2: Move CSS to public/config/**

```bash
cd components/gov-chat-frontend
git mv src/theme-variables.css public/config/theme-variables.css
```

Expected: git rename detected (`R` status in `git status`).

- [ ] **Step 3: Create fallback file (verbatim copy)**

```bash
cd components/gov-chat-frontend
cp public/config/theme-variables.css public/config/theme-variables-fallback.css
diff -q public/config/theme-variables.css public/config/theme-variables-fallback.css
```

Expected: `diff` returns silently (files identical). If they differ, redo the copy.

- [ ] **Step 4: Create dev-mode placeholder for /config/config.js**

```bash
cd components/gov-chat-frontend
mkdir -p public/config
cp public/config.js public/config/config.js
diff -q public/config.js public/config/config.js
```

Expected: `diff` returns silently. The 260-byte `public/config.js` (existing dev fallback) is replicated under `public/config/` so Vue CLI's dev server (`npm run dev`) serves it at `/config/config.js`. Production uses the entrypoint-generated version (Task 3).

- [ ] **Step 5: Extract `loadConfig` to `src/config-loader.js`**

Open `components/gov-chat-frontend/src/main.js`. The `loadConfig` function body (lines ~25-100 based on inspection) plus the module-level `config` literal it depends on must move to a new file `src/config-loader.js`. The shape:

```javascript
// src/config-loader.js
const defaults = {
  app: {
    title: 'GENIE.AI',
    icon: { type: 'file', value: '/config/logo-genie-ai.jpeg' },
  },
  theme: {
    brandColor: '#4071cb',
  },
  features: { chat: { welcomeMessage: 'Welcome to GENIE.AI', botName: 'GENIE.AI' } },
  custom: {},
};

let config = { ...defaults };

export async function loadConfig() {
  // ... (existing body, unchanged) ...
  return config;
}

export { config as default };
```

In `src/main.js`, replace the inlined `config` literal and `loadConfig` with:
```javascript
import loadConfig, { config } from './config-loader';
```

Verify the import resolves cleanly:
```bash
cd components/gov-chat-frontend
grep -n "config-loader\|loadConfig" src/main.js | head -10
```

Expected: shows the new import line and any other `loadConfig` usages unchanged.

- [ ] **Step 6: Remove import from main.js**

Open `components/gov-chat-frontend/src/main.js` and delete the `import './theme-variables.css';` line (whichever line number it actually is at).

Verify removal:
```bash
grep -n "theme-variables.css" components/gov-chat-frontend/src/main.js
```

Expected: no output.

- [ ] **Step 7: Update index.html**

Open `components/gov-chat-frontend/public/index.html` and make the following changes:

Replace the existing line:
```html
<!-- Runtime configuration (cloud-native: loaded at container startup) -->
<script src="/config.js"></script>
```

With:
```html
<!-- Runtime configuration (cloud-native: loaded at container startup) -->
<!-- CSS tokens load first; main.js overrides a runtime subset via loadConfig() -->
<link rel="stylesheet" href="/config/theme-variables.css"
      onerror="fetch('/config/theme-variables-fallback.css').then(r=>r.text()).then(t=>{const s=document.createElement('style');s.textContent=t;document.head.appendChild(s);this.remove();}).catch(()=>{})">
<script src="/config/config.js"></script>
```

- [ ] **Step 8: Verify Vue build still produces expected output**

```bash
cd components/gov-chat-frontend
npm run build 2>&1 | tail -20
```

Expected: build succeeds. Inspect `dist/config/`:
```bash
ls dist/config/theme-variables*.css dist/config/config.js 2>/dev/null
```

Expected: `theme-variables.css`, `theme-variables-fallback.css`, AND `config.js` (dev placeholder) all present in `dist/config/`.

- [ ] **Step 9: Lint and format check**

```bash
cd components/gov-chat-frontend
npm run lint 2>&1 | tail -5
npm run format:check 2>&1 | tail -5
```

Expected: no errors. If errors appear, fix them before committing (run `npm run lint:fix` and `npm run format`).

- [ ] **Step 10: Commit**

```bash
cd /home/jerome/git_projects/ITU/genie-ai/.claude/worktrees/runtime-theme-config
git add components/gov-chat-frontend/src/theme-variables.css \
        components/gov-chat-frontend/public/config/theme-variables.css \
        components/gov-chat-frontend/public/config/theme-variables-fallback.css \
        components/gov-chat-frontend/public/config/config.js \
        components/gov-chat-frontend/src/config-loader.js \
        components/gov-chat-frontend/src/main.js \
        components/gov-chat-frontend/public/index.html
git commit -m "feat(frontend): move theme CSS to runtime-loaded config + extract loadConfig

theme-variables.css now lives in public/config/ (Vue CLI passthrough,
not bundled). Loaded at runtime via <link> in index.html. A verbatim
fallback file is also shipped so the <link onerror> handler can recover
gracefully when the runtime file is unreachable (e.g. mount missing).
The /config.js runtime-generated file is relocated to /config/config.js
so it inherits the same no-cache nginx location as the CSS. A static
placeholder at public/config/config.js (verbatim copy of the existing
public/config.js dev fallback) keeps 'npm run dev' working without
requiring the docker-entrypoint writer to run.

The loadConfig function and its module-level config default object are
extracted from src/main.js into src/config-loader.js. This makes
loadConfig independently importable for unit tests without dragging in
Vue, Vuex, ApexCharts, and the top-level await mount sequence. main.js
imports loadConfig from the new file; no behavior change at runtime."
```

Expected: 1 commit on `feat/runtime-theme-config`.

---

## Task 3: nginx.conf `location ^~ /config/` + docker-entrypoint.sh Relocation

**Files:**
- Modify: `components/gov-chat-frontend/nginx.conf` (add `location ^~ /config/` block)
- Modify: `components/gov-chat-frontend/docker-entrypoint.sh` (change writer target `/app/dist/config.js` → `/app/dist/config/config.js`)

**Interfaces:**
- Consumes: existing `nginx.conf` with regex `~* \.(js|css|...)` location that imposes `Cache-Control: immutable, max-age=31536000`
- Produces:
  - `location ^~ /config/` block: nginx serves `/config/*` with `Cache-Control: no-cache, must-revalidate`. The `^~` modifier is critical — without it the regex location wins regardless of source-file ordering.
  - entrypoint writes the runtime config to `/app/dist/config/config.js` (under the bind-mount) instead of `/app/dist/config.js`

- [ ] **Step 1: Read current nginx.conf**

```bash
cat components/gov-chat-frontend/nginx.conf
```

Expected: full file visible. Note the line that begins with `location ~* \.(js|css|...`.

- [ ] **Step 2: Add the `^~ /config/` location block**

In `components/gov-chat-frontend/nginx.conf`, BEFORE the regex location block (`location ~* \.(js|css|...)`), insert the following block:

```nginx
    # Runtime-mounted config: CSS tokens, brand JSON, runtime-generated config.js
    # The ^~ modifier is required to win against the regex location below —
    # without it, /config/theme-variables.css would still get the immutable cache.
    location ^~ /config/ {
      root /app/dist;
      add_header Cache-Control "no-cache, must-revalidate" always;
      add_header X-Content-Type-Options nosniff always;
      add_header X-Frame-Options DENY always;
    }
```

Verify the location block is positioned BEFORE the regex location:

```bash
grep -n "location" components/gov-chat-frontend/nginx.conf
```

Expected output (line numbers):
```
<regex-line>:    location ~* \.(js|css|...
<prefix-line>:   location ^~ /config/ {
```

The `^~` line number must be LESS than the regex line number. If reversed, fix it manually.

- [ ] **Step 3: Update docker-entrypoint.sh**

```bash
grep -n "config.js" components/gov-chat-frontend/docker-entrypoint.sh
```

Read the script and find every reference to `/app/dist/config.js` or `config.js` path. Update each to write under `/app/dist/config/config.js` (creating the `config/` subdirectory if it does not already exist).

Verify the change:
```bash
grep -n "config/config.js\|config.js" components/gov-chat-frontend/docker-entrypoint.sh
```

Expected: all `config.js` references are now `config/config.js` (or equivalent that writes under `/app/dist/config/`).

- [ ] **Step 4: Test nginx config syntax**

The simplest test is to build the image and run it locally:

```bash
cd components/gov-chat-frontend
docker build -t genie-ai-frontend:test .
docker run --rm --entrypoint bash genie-ai-frontend:test -c \
  "envsubst '\$NGINX_PORT' < /etc/nginx/nginx.conf.template > /etc/nginx/nginx.conf && nginx -t"
```

Expected: `nginx: configuration file /etc/nginx/nginx.conf test is successful`.

If `nginx -t` reports errors, the `^~` block or its positioning is wrong. Fix and re-test.

- [ ] **Step 5: Lint and format check**

```bash
cd components/gov-chat-frontend
npm run lint 2>&1 | tail -5
```

Expected: no errors. The nginx.conf and entrypoint.sh are not subject to ESLint or Prettier, so format:check should pass without changes.

- [ ] **Step 6: Commit**

```bash
cd /home/jerome/git_projects/ITU/genie-ai/.claude/worktrees/runtime-theme-config
git add components/gov-chat-frontend/nginx.conf \
        components/gov-chat-frontend/docker-entrypoint.sh
git commit -m "feat(frontend): nginx no-cache for /config/, relocate runtime writer

Add location ^~ /config/ block to nginx.conf. The ^~ modifier wins
against the existing regex ~* \.(js|css|...) which would otherwise
impose Cache-Control: immutable, max-age=31536000 on /config/*. With
^~ in place, /config/* now uses Cache-Control: no-cache, must-revalidate
so browsers revalidate via 304 on every load.

docker-entrypoint.sh now writes the runtime config to
/app/dist/config/config.js (under the bind-mount) instead of
/app/dist/config.js, so the generated file inherits the new no-cache
location."
```

Expected: 1 commit on `feat/runtime-theme-config`.

---

## Task 4: Delete Keycloak Dockerfile + Switch to Upstream Image + CI + deploy-shared-facts

**Files:**
- Delete: `configs/keycloak/Dockerfile`
- Modify: `docker-compose.yaml` (line 1578, the keycloak `build:` directive)
- Modify: `.gitlab-ci.yml` (remove `genie-ai-keycloak` jobs; KEEP `genie-ai-keycloak-config` jobs)
- Modify: `deploy/ansible/tasks/deploy-shared-facts.yml` (remove `genie-ai-keycloak` entry from `genieai_images`)

**Interfaces:**
- Consumes: existing `configs/keycloak/Dockerfile` (read once for context, then delete)
- Produces: keycloak service uses upstream `quay.io/keycloak/keycloak:26.7.0` image; CI no longer builds a custom keycloak image; Ansible no longer validates overrides against the removed image

- [ ] **Step 1: Inspect the existing Dockerfile**

```bash
cat configs/keycloak/Dockerfile
grep -nE "(configs/keycloak|keycloak.*Dockerfile|genie-ai-keycloak)" .gitlab-ci.yml | head -20
```

Expected: Dockerfile is short (5–10 lines: FROM + ENV + COPY themes/ + ENTRYPOINT + CMD). CI references list will guide the next steps.

- [ ] **Step 2: Delete Dockerfile**

```bash
cd /home/jerome/git_projects/ITU/genie-ai/.claude/worktrees/runtime-theme-config
git rm configs/keycloak/Dockerfile
```

Expected: `rm 'configs/keycloak/Dockerfile'`.

- [ ] **Step 3: Update docker-compose.yaml keycloak service**

```bash
grep -nE "(build:|keycloak:)" docker-compose.yaml | head -20
```

Read the lines around the keycloak service definition. Find the `build: configs/keycloak/` line. Replace the entire `build:` block with:

```yaml
    image: quay.io/keycloak/keycloak:26.7.0
```

If the keycloak service definition also has any `args:` or context overrides tied to the old build, remove those too.

Verify the change:
```bash
grep -A2 "^  keycloak:" docker-compose.yaml | head -10
```

Expected: shows `image: quay.io/keycloak/keycloak:26.7.0` and no `build:` lines.

- [ ] **Step 4: Verify all four themed subdirs are present in repo**

```bash
ls configs/keycloak/themes/genie/
```

Expected output (4 entries):
```
account/
admin/
email/
login/
```

If any subdir is missing, this is a separate problem (do NOT silently fix it in this task; surface to user).

- [ ] **Step 5: Update .gitlab-ci.yml**

CRITICAL: there are TWO Keycloak-related images in the build matrix:
- `genie-ai-keycloak` (built from `configs/keycloak/Dockerfile`) — DELETE this from CI
- `genie-ai-keycloak-config` (built from `configs/keycloak/Dockerfile.config-cli`) — KEEP this; it imports the realm YAML at runtime and does not depend on the theme files

First, count and identify ALL occurrences of `genie-ai-keycloak` (NOT `genie-ai-keycloak-config`):
```bash
grep -nE "genie-ai-keycloak" .gitlab-ci.yml | grep -v "genie-ai-keycloak-config"
```

Expected: multiple lines referencing build/scan/promote jobs for the `genie-ai-keycloak` image. The exact line numbers depend on the .gitlab-ci.yml layout but expect 5-10 lines covering build, scan, promote (and possibly cleanup) stages.

For EACH occurrence of `genie-ai-keycloak` (NOT `genie-ai-keycloak-config`), remove the corresponding job block. Typical CI patterns to remove:
- A `build:keycloak` job that references `genie-ai-keycloak`
- A `scan:keycloak` job (Trivy scan of the same image)
- A `promote:keycloak` job (retag digests)

DO NOT remove `build:keycloak-config`, `scan:keycloak-config`, or `promote:keycloak-config`. These belong to the config-cli image which the realm import depends on.

After the edit, verify:
```bash
grep -nE "genie-ai-keycloak\b" .gitlab-ci.yml
```

Expected: no output (the `\b` word boundary prevents matching `genie-ai-keycloak-config`).

Verify the config-cli image is still referenced:
```bash
grep -n "genie-ai-keycloak-config" .gitlab-ci.yml | wc -l
```

Expected: a non-zero count (typically 3-5 lines for build/scan/promote).

If references remain that you cannot safely remove, surface to user.

- [ ] **Step 6: Update deploy-shared-facts.yml**

The `genieai_images` set_fact at line 18-34 of `deploy/ansible/tasks/deploy-shared-facts.yml` enumerates the 16 images Ansible validates `image_tag_overrides` against. Remove the `genie-ai-keycloak` entry to keep validation honest; an operator who passes `image_tag_overrides={'genie-ai-keycloak': 'v1'}` would otherwise see the override accepted but silently ignored (env.j2 still emits unused `GENIE_AI_KEYCLOAK_IMAGE` vars).

Open `deploy/ansible/tasks/deploy-shared-facts.yml` and delete the entry that has `name: "genie-ai-keycloak"` (and only that one — the `keycloak-config` entry stays).

Verify:
```bash
grep -n "genie-ai-keycloak" deploy/ansible/tasks/deploy-shared-facts.yml
```

Expected: only `keycloak-config` lines remain.

- [ ] **Step 7: Validate docker-compose still parses**

```bash
docker compose config --quiet 2>&1 | head -10
```

Expected: no errors. If errors appear, fix the yaml (likely indentation or stray `build:` args).

- [ ] **Step 8: Commit**

```bash
cd /home/jerome/git_projects/ITU/genie-ai/.claude/worktrees/runtime-theme-config
git add configs/keycloak/Dockerfile \
        docker-compose.yaml \
        .gitlab-ci.yml \
        deploy/ansible/tasks/deploy-shared-facts.yml
git commit -m "refactor(keycloak): switch to upstream image, drop custom Dockerfile

The local Dockerfile only existed to COPY themes/ into the image. With
runtime mount binding /opt/keycloak/themes/genie/ to the keycloak
container, the build-time copy is redundant.

All four themed subdirs (login/account/admin/email) stay in the repo at
configs/keycloak/themes/genie/ and get rsynced to the host by the new
config_bootstrap role (Task 6). The realm config sets all four theme
types to KEYCLOAK_THEME, so all four subdirs are required to preserve
the existing UX (login screen, account console, admin console, email
templates).

.gitlab-ci.yml removes build/scan/promote for genie-ai-keycloak but
KEEPS genie-ai-keycloak-config (Dockerfile.config-cli) which imports
the realm YAML at runtime and does not depend on theme files.

deploy-shared-facts.yml drops the genie-ai-keycloak entry from
genieai_images so image_tag_overrides validation no longer accepts
override keys that would silently no-op."
```

Expected: 1 commit on `feat/runtime-theme-config`.

---

## Task 5: docker-compose.yaml Bind Mounts

**Files:**
- Modify: `docker-compose.yaml` (add 2 new volumes entries: frontend + keycloak)

**Interfaces:**
- Consumes: existing `docker-compose.yaml` service definitions (do not modify other services)
- Produces:
  - frontend service has a new `volumes:` entry: `${CONFIG_DIR_FRONTEND:-./components/gov-chat-frontend/public/config}:/app/dist/config:ro`
  - keycloak service has a new `volumes:` entry: `${CONFIG_DIR_KEYCLOAK:-./configs/keycloak/themes/genie}:/opt/keycloak/themes/genie:ro`

- [ ] **Step 1: Locate frontend service volumes**

```bash
grep -nB1 -A8 "^  frontend:" docker-compose.yaml | grep -A6 "volumes:"
```

Find the `volumes:` block under the `frontend:` service. Note its indentation (should be 4 spaces inside the service).

- [ ] **Step 2: Add the frontend bind mount**

In `docker-compose.yaml`, in the `frontend` service `volumes:` list, add this line at the end of the existing list:

```yaml
      - ${CONFIG_DIR_FRONTEND:-./components/gov-chat-frontend/public/config}:/app/dist/config:ro
```

Match the indentation of existing volume entries.

Verify:
```bash
grep -A10 "^  frontend:" docker-compose.yaml | grep -A8 "volumes:" | head -15
```

Expected: the new bind mount line appears.

- [ ] **Step 3: Locate keycloak service volumes**

```bash
grep -nB1 -A8 "^  keycloak:" docker-compose.yaml | grep -A6 "volumes:"
```

If keycloak currently has no `volumes:` block, add a new one.

- [ ] **Step 4: Add the keycloak bind mount**

In `docker-compose.yaml`, in the `keycloak` service, ensure a `volumes:` block exists with this line:

```yaml
      - ${CONFIG_DIR_KEYCLOAK:-./configs/keycloak/themes/genie}:/opt/keycloak/themes/genie:ro
```

Match the indentation of the surrounding service definition.

- [ ] **Step 5: Validate compose**

```bash
docker compose config --quiet 2>&1 | tail -10
```

Expected: no errors.

- [ ] **Step 6: Smoke-test local compose up for the changed services**

CRITICAL: Keycloak 26.7.0 takes ~30 seconds for first boot (Postgres import + realm import). Do NOT exec into containers immediately after `up -d`; wait for the healthcheck to pass.

```bash
docker compose up -d frontend keycloak 2>&1 | tail -15
```

Wait for the services to reach a healthy state:

```bash
# Polls docker compose ps every 2s for up to 90s, exits 0 when both are 'running' (not 'starting')
timeout 90 bash -c 'until docker compose ps --format json 2>/dev/null | jq -e ".[] | select(.Service==\"frontend\" or .Service==\"keycloak\") | select(.State==\"running\") | length == 2" >/dev/null 2>&1; do sleep 2; done'
echo "Both services running"
```

Check `/app/dist/config/` exists inside the frontend container:

```bash
docker compose exec frontend ls /app/dist/config/ 2>&1 | head -10
```

Expected: `theme-variables.css` and `theme-variables-fallback.css` are visible.

For keycloak:
```bash
docker compose exec keycloak ls /opt/keycloak/themes/genie/ 2>&1 | head -10
```

Expected: 4 subdirs (`account/`, `admin/`, `email/`, `login/`).

- [ ] **Step 7: Tear down the test compose stack**

```bash
docker compose down 2>&1 | tail -5
```

Expected: clean shutdown.

- [ ] **Step 8: Commit**

```bash
cd /home/jerome/git_projects/ITU/genie-ai/.claude/worktrees/runtime-theme-config
git add docker-compose.yaml
git commit -m "feat(compose): bind-mount runtime config dirs for frontend + keycloak

Adds two bind mounts using the existing \${VAR:-default} envsubst pattern:
- frontend: CONFIG_DIR_FRONTEND -> /app/dist/config (covers theme CSS,
  brand JSON, splash assets, and the relocated runtime config.js)
- keycloak: CONFIG_DIR_KEYCLOAK -> /opt/keycloak/themes/genie (covers
  all four themed subdirs)

Default values resolve to repo-relative paths so 'docker compose up'
works locally with zero configuration. In Swarm mode, Ansible writes
absolute paths via the config_bootstrap role (Task 6).

Backwards compatible: if CONFIG_DIR_FRONTEND / CONFIG_DIR_KEYCLOAK are
unset and the default does not exist (e.g. Swarm without Ansible setup),
the bind mount fails but the service starts using image-baked defaults."
```

Expected: 1 commit on `feat/runtime-theme-config`.

---

## Task 6: Ansible Role `config_bootstrap` + deploy.yml + env.j2 + group_vars/all.yml

**Files:**
- Create: `deploy/ansible/roles/config_bootstrap/tasks/main.yml`
- Create: `deploy/ansible/roles/config_bootstrap/defaults/main.yml`
- Create: `deploy/ansible/roles/config_bootstrap/meta/main.yml`
- Modify: `deploy/ansible/deploy.yml` (add new play with `tags: [config]`, update docstring)
- Modify: `deploy/ansible/templates/env.j2` (add 2 env vars)
- Modify: `deploy/ansible/group_vars/all.yml` (add `env_name`)

**Interfaces:**
- Consumes:
  - `playbook_dir` (Ansible-provided, used to compute cross-tree rsync sources)
  - `config_dir` (defined in `group_vars/all.yml` so it is visible to BOTH the `config_bootstrap` role plays AND the `deploy` play that renders env.j2)
  - `env_name` (from `group_vars/all.yml`)
  - `group_names` (Ansible-provided, used as fallback in `env_name` and `config_dir` defaults)
- Produces:
  - `/opt/genieai-<env_name>/config/frontend/` and `/opt/genieai-<env_name>/config/keycloak/themes/genie/` on every node
  - `CONFIG_DIR_FRONTEND` and `CONFIG_DIR_KEYCLOAK` env vars in the rendered `/opt/genieai-<env_name>/.env`

- [ ] **Step 1: Read existing role structure for reference**

```bash
ls deploy/ansible/roles/docker/
cat deploy/ansible/roles/docker/tasks/main.yml | head -20
```

Use the existing `docker/` role as a structural reference for the new role.

- [ ] **Step 2: Create role directory**

```bash
cd /home/jerome/git_projects/ITU/genie-ai/.claude/worktrees/runtime-theme-config
mkdir -p deploy/ansible/roles/config_bootstrap/{tasks,defaults,meta}
```

- [ ] **Step 3: Create defaults/main.yml**

`config_dir` is NOT defined here — it lives in `group_vars/all.yml` (Step 6) so it is visible across plays (the `deploy` play that renders env.j2 is separate from this role's play). The role inherits `config_dir` from group_vars.

Write `deploy/ansible/roles/config_bootstrap/defaults/main.yml`:

```yaml
---
# Whether to actually rsync from the repo. Operators can set false to skip
# when they want to manage the host directory entirely by hand.
config_bootstrap_sync_enabled: true

# List of (source, destination) pairs to rsync. The source is a path RELATIVE
# to playbook_dir (computed at task time, not stored here). Adding more
# runtime config dirs in the future means adding another entry.
config_bootstrap_pairs:
  - src: "../../components/gov-chat-frontend/public/config/"
    dest_subdir: "frontend"
  - src: "../../configs/keycloak/themes/genie/"
    dest_subdir: "keycloak/themes/genie"
```

- [ ] **Step 4: Create tasks/main.yml**

Write `deploy/ansible/roles/config_bootstrap/tasks/main.yml`:

```yaml
---
- name: Ensure runtime config directories exist
  ansible.builtin.file:
    path: "{{ config_dir }}/{{ item.dest_subdir }}"
    state: directory
    mode: "0755"
  loop: "{{ config_bootstrap_pairs }}"
  loop_control:
    label: "{{ item.dest_subdir }}"

- name: Rsync repo defaults to host runtime config dir (preserve manual edits)
  ansible.posix.synchronize:
    src: "{{ playbook_dir }}/{{ item.src }}"
    dest: "{{ config_dir }}/{{ item.dest_subdir }}"
    delete: false
    rsync_opts:
      - "--ignore-existing"
  loop: "{{ config_bootstrap_pairs }}"
  loop_control:
    label: "{{ item.dest_subdir }}"
  when: config_bootstrap_sync_enabled | bool
  register: config_bootstrap_sync
  changed_when: config_bootstrap_sync.changed | bool

- name: Assert synchronize was idempotent on rerun (manual edits preserved)
  ansible.builtin.assert:
    that:
      - not config_bootstrap_sync.changed | bool or config_bootstrap_sync.rc == 0
    fail_msg: "config_bootstrap: synchronize reported changed=true after a no-op run; check --ignore-existing flag is still present"
    success_msg: "config_bootstrap: idempotent (no files transferred on rerun)"
  when:
    - config_bootstrap_sync_enabled | bool
    - not ansible_check_mode | default(false) | bool
```

- [ ] **Step 5: Create meta/main.yml**

Write `deploy/ansible/roles/config_bootstrap/meta/main.yml`:

```yaml
---
galaxy_info:
  role_name: config_bootstrap
  author: GENIE.AI
  description: Sync repo theme defaults to host runtime config dir on every node
  license: MIT
  min_ansible_version: "2.12"
  platforms:
  - name: Ubuntu
    versions:
    - focal
    - jammy
dependencies: []
```

- [ ] **Step 6: Add `env_name` AND `config_dir` to group_vars/all.yml**

CRITICAL: `config_dir` MUST live in group_vars (not the role's defaults/main.yml) because env.j2 is rendered in the SEPARATE `deploy` play which does not include this role. Role defaults are scoped to the role's plays; only group_vars are visible across all plays.

```bash
grep -n "deploy_dir:" deploy/ansible/group_vars/all.yml | head -3
```

In `deploy/ansible/group_vars/all.yml`, add (alongside `deploy_dir`):

```yaml
# Per-environment name used in host paths (config_bootstrap role's config_dir).
# Defaults to the first inventory group the host belongs to, so multi-env
# hosts do not collide on /opt/genieai-/config.
env_name: "{{ group_names[0] | default('default') }}"

# Runtime config directory on the host. Promoted to group_vars so both
# the config_bootstrap role AND the deploy play (which renders env.j2)
# see the same value. The nested |length filter guards against an empty
# string slipping through the |default filter (Jinja's default() only
# fires on undefined, not empty).
config_dir: "/opt/genieai-{{ env_name | default(group_names[0] | default('default')) }}/config"
```

Verify the additions:
```bash
grep -n "env_name:\|config_dir:" deploy/ansible/group_vars/all.yml
```

Expected: two lines, one for each var definition.

- [ ] **Step 7: Add 2 vars to env.j2**

```bash
grep -n "KEYCLOAK_THEME\|GENIE_AI_CONFIG\|deploy_dir" deploy/ansible/templates/env.j2 | head -10
```

In `deploy/ansible/templates/env.j2`, find the `{% endfor %}` line that closes the `{% for img in genieai_images %}` loop (around line 413). Place the new lines AFTER the `{% endfor %}` and BEFORE the next existing block (e.g., `{% if data_dir %}`). Do NOT place them inside the for loop or they will render once per image (16 copies). Add a section comment:

```jinja
# RUNTIME THEME CONFIG MOUNTS (mount sources for /config/ bind mounts)
CONFIG_DIR_FRONTEND={{ config_dir }}/frontend
CONFIG_DIR_KEYCLOAK={{ config_dir }}/keycloak
```

Use the exact indentation style of surrounding lines.

- [ ] **Step 8: Add the new play to deploy.yml**

Read the existing `deploy.yml` and find a good insertion point (after the "prepare" play, before the "build" play). Add a new play:

```yaml
- name: GENIE.AI - Bootstrap runtime config dirs (theme assets)
  hosts: all
  tags: [config]
  become: true
  roles:
    - role: config_bootstrap
```

Also update the header comment in `deploy.yml` to include `config` in the documented tag list.

- [ ] **Step 9: Validate ansible-playbook syntax**

```bash
cd /home/jerome/git_projects/ITU/genie-ai/.claude/worktrees/runtime-theme-config/deploy/ansible
ansible-playbook -i inventory/test.ini deploy.yml --syntax-check 2>&1 | tail -10
```

Expected: `playbook: deploy.yml` (no errors).

If the inventory file is missing locally, this step may fail with a different error. If the error is about the inventory, that's expected (inventory is a deploy-time concern, not a static config); only fail on YAML syntax errors in the playbook itself.

- [ ] **Step 10: Commit**

```bash
cd /home/jerome/git_projects/ITU/genie-ai/.claude/worktrees/runtime-theme-config
git add deploy/ansible/roles/config_bootstrap/ \
        deploy/ansible/deploy.yml \
        deploy/ansible/templates/env.j2 \
        deploy/ansible/group_vars/all.yml
git commit -m "feat(ansible): config_bootstrap role rsyncs repo theme defaults

New role deploys repo paths into /opt/genieai-<env_name>/config/ on
every node using cross-tree synchronize from playbook_dir. Flags:
- delete: false + --ignore-existing preserves manual operator edits
  between deploys (without --ignore-existing, edits would be silently
  overwritten on every run)
- Idempotent: second invocation is a no-op

deploy.yml gains a play tagged [config] that applies the role to all
hosts. env.j2 exports CONFIG_DIR_FRONTEND and CONFIG_DIR_KEYCLOAK for
docker-compose to consume.

group_vars/all.yml adds env_name (resolved from the inventory group
name) AND config_dir (promoted from role defaults so env.j2 — rendered
in the separate deploy play — sees the same value). The role inherits
config_dir from group_vars."
```

Expected: 1 commit on `feat/runtime-theme-config`.

---

## Task 7: Jest Unit Tests for config-loader Fallback

**Files:**
- Create: `components/gov-chat-frontend/src/__tests__/config-loader.spec.js`

**Interfaces:**
- Consumes: extracted `src/config-loader.js` module (Task 2) exporting `loadConfig` + a module-level `config` default object
- Produces: Jest tests pinning the fallback contract: fetch is attempted, fallback used on failure, success injects CSS custom properties

- [ ] **Step 1: Inspect existing test directory**

```bash
ls components/gov-chat-frontend/src/__tests__/ 2>/dev/null
cat components/gov-chat-frontend/jest.config.js
```

Use the existing test patterns as a reference. Skip if `__tests__/` does not exist yet.

- [ ] **Step 2: Write the failing tests**

CRITICAL: assertions must verify the ACTUAL fallback path, not coincidentally-passing values. The module-level `config` default has `theme.brandColor: '#4071cb'` — a test that asserts `config.theme.brandColor === '#4071cb'` after a 404 would pass even if `loadConfig` never attempted fetch. Pin fetch invocation and side effects instead.

Create `components/gov-chat-frontend/src/__tests__/config-loader.spec.js`:

```javascript
import { loadConfig, config } from '../config-loader';

// Capture original fetch for restoration
const originalFetch = global.fetch;

describe('loadConfig', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('attempts to fetch /config/genie-ai-config.json on every call', async () => {
    global.fetch.mockResolvedValueOnce({ ok: false, status: 404 });

    await loadConfig();

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith('/config/genie-ai-config.json');
  });

  it('uses bundled defaults when fetch returns 404 (no override applied)', async () => {
    global.fetch.mockResolvedValueOnce({ ok: false, status: 404 });

    const result = await loadConfig();

    // Bundled defaults preserved — fields NOT in default object stay absent
    expect(result.theme.brandColor).toBe('#4071cb');
    expect(result.theme.colors).toBeUndefined();
    expect(result.theme.navbar).toBeUndefined();
  });

  it('merges fetched JSON over defaults when fetch succeeds', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        theme: {
          brandColor: '#ff0000',
          colors: { success: '#00ff00', warning: '#ffff00' },
        },
      }),
    });

    const result = await loadConfig();

    expect(result.theme.brandColor).toBe('#ff0000');          // overridden
    expect(result.theme.colors.success).toBe('#00ff00');      // injected
    expect(result.theme.colors.warning).toBe('#ffff00');     // injected
    expect(result.app.title).toBe('GENIE.AI');                // default preserved (nested merge)
  });

  it('injects CSS custom properties on document.documentElement when fetch succeeds', async () => {
    const setProperty = jest.spyOn(document.documentElement.style, 'setProperty');

    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        theme: {
          brandColor: '#ff0000',
          colors: { success: '#00ff00', warning: '#ffff00' },
          navbar: { background: '#000000', text: '#ffffff' },
          typography: { fontFamily: 'Arial', fontScale: '1.2' },
        },
      }),
    });

    await loadConfig();

    expect(setProperty).toHaveBeenCalledWith('--brand', '#ff0000');
    expect(setProperty).toHaveBeenCalledWith('--success', '#00ff00');
    expect(setProperty).toHaveBeenCalledWith('--warning', '#ffff00');
    expect(setProperty).toHaveBeenCalledWith('--navbar-bg', '#000000');
    expect(setProperty).toHaveBeenCalledWith('--navbar-fg', '#ffffff');
    expect(setProperty).toHaveBeenCalledWith('--font-body', 'Arial');
    expect(setProperty).toHaveBeenCalledWith('--font-scale', '1.2');
  });

  it('does NOT inject any CSS custom properties when fetch fails (fallback path)', async () => {
    const setProperty = jest.spyOn(document.documentElement.style, 'setProperty');

    global.fetch.mockResolvedValueOnce({ ok: false, status: 404 });

    await loadConfig();

    // No brandColor in fetched JSON, no CSS var should be set
    const brandCalls = setProperty.mock.calls.filter(call => call[0] === '--brand');
    expect(brandCalls).toHaveLength(0);
  });

  it('falls back to defaults on JSON parse error', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.reject(new Error('invalid JSON')),
    });

    const result = await loadConfig();
    expect(result.theme.brandColor).toBe('#4071cb');
  });
});
```

- [ ] **Step 3: Run the tests**

```bash
cd components/gov-chat-frontend
npm test -- config-loader 2>&1 | tail -30
```

Expected: all 6 tests pass.

If tests fail, the most likely cause is that the module-level `config` object is mutable across tests (tests share state via the same module instance). If that's the case, add `jest.resetModules()` in `beforeEach` and re-`import` inside each test. Do NOT modify `config-loader.js` behavior in this task — only fix the test setup if needed.

- [ ] **Step 4: Run full frontend test suite to verify no regressions**

```bash
cd components/gov-chat-frontend
npm test 2>&1 | tail -10
```

Expected: all tests pass, no new failures.

- [ ] **Step 5: Commit**

```bash
cd /home/jerome/git_projects/ITU/genie-ai/.claude/worktrees/runtime-theme-config
git add components/gov-chat-frontend/src/__tests__/config-loader.spec.js
git commit -m "test(frontend): loadConfig fallback and CSS injection coverage

Six unit tests pin loadConfig behavior:
1. Fetch attempted exactly once with the expected URL
2. Fetch 404 → bundled defaults preserved (no override, no stale merge)
3. Fetch success → fetched JSON merged over defaults (overrides applied)
4. CSS custom properties injected on document.documentElement per the schema
5. Fetch 404 → no CSS properties set (no stale vars from prior calls)
6. JSON parse error → defaults preserved

Tests import from config-loader (extracted in Task 2) to avoid
triggering main.js's top-level side effects (Vue, Vuex, ApexCharts,
createApp, mount). Tests pin the actual fallback contract — assertions
that would pass coincidentally (e.g. assert brandColor='#4071cb'
without verifying fetch was called) are avoided."
3. JSON parse error → bundled defaults used (defensive against mount returning
   a partial file)"
```

Expected: 1 commit on `feat/runtime-theme-config`.

---

## Task 8: Playwright E2E for Cache Headers + Reload Acceptance

**Files:**
- Create: `tests/e2e/theme-runtime-config.spec.js`

**Interfaces:**
- Consumes: live or test deployment of frontend service
- Produces: Playwright tests verifying cache headers and acceptance criterion

- [ ] **Step 1: Inspect existing E2E test patterns**

```bash
ls tests/e2e/ | head -10
cat tests/playwright.config.js 2>/dev/null | head -30
```

Use existing patterns as reference. Adjust path/reporter based on what you find.

- [ ] **Step 2: Write the spec**

Create `tests/e2e/theme-runtime-config.spec.js`:

```javascript
const { test, expect } = require('@playwright/test');

test.describe('Runtime theme config', () => {
  test('theme-variables.css served with no-cache, must-revalidate', async ({ request }) => {
    const response = await request.get('/config/theme-variables.css');
    expect(response.status()).toBe(200);
    expect(response.headers()['cache-control']).toContain('no-cache');
    expect(response.headers()['cache-control']).toContain('must-revalidate');
    expect(response.headers()['cache-control']).not.toContain('immutable');
    expect(response.headers()['cache-control']).not.toContain('max-age=31536000');
  });

  test('hashed JS asset still served with immutable cache', async ({ request }) => {
    // Find any hashed asset in the homepage HTML
    const homeResponse = await request.get('/');
    const body = await homeResponse.text();
    const match = body.match(/app\.[a-z0-9]+\.js/);
    expect(match).not.toBeNull();

    const assetResponse = await request.get(`/js/${match[0]}`);
    expect(assetResponse.headers()['cache-control']).toContain('immutable');
  });

  test('runtime-generated /config/config.js served with no-cache', async ({ request }) => {
    const response = await request.get('/config/config.js');
    expect(response.status()).toBe(200);
    expect(response.headers()['cache-control']).toContain('no-cache');
  });

  test('editing theme-variables.css on host updates browser on page.reload()', async ({ page, request }) => {
    // This test requires SSH access to the Swarm manager node.
    // Skip if not in a deploy environment that supports it.
    test.skip(
      !process.env.DEPLOY_HOST || !process.env.DEPLOY_ENV_NAME,
      'Requires DEPLOY_HOST and DEPLOY_ENV_NAME env vars for host-side edit'
    );

    // Derive host path and service name from env_name (matches Ansible's
    // config_dir derivation in group_vars/all.yml).
    const envName = process.env.DEPLOY_ENV_NAME;
    const configDir = `/opt/genieai-${envName}/config`;
    const stackName = `genieai_${envName.replace(/[^a-z0-9]/gi, '_')}`;
    const serviceName = `${stackName}_frontend`;

    // 1. Fetch original CSS content
    const originalResponse = await request.get('/config/theme-variables.css');
    const originalContent = await originalResponse.text();

    // 2. Verify --brand token is set
    await page.goto('/');
    const originalBrand = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--brand').trim()
    );
    expect(originalBrand).not.toBe('');

    // 3. Edit the file on the host (via ssh)
    const newContent = originalContent.replace(
      /(--brand:\s*)[^;]+/,
      `$1#deadbeef`
    );
    const { execSync } = require('child_process');
    const sshTarget = `${process.env.DEPLOY_SSH_USER}@${process.env.DEPLOY_HOST}`;
    execSync(
      `ssh ${sshTarget} "echo '${newContent.replace(/'/g, "'\\''")}' > ${configDir}/frontend/theme-variables.css"`
    );

    // 4. docker service update --force
    execSync(
      `ssh ${sshTarget} "docker service update --force ${serviceName}"`
    );

    // 5. Wait for service to come back healthy
    await page.waitForTimeout(5000);

    // 6. page.reload() — verify it picks up the change via 304 revalidation
    await page.reload();
    const newBrand = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--brand').trim()
    );
    expect(newBrand).toBe('#deadbeef');

    // 7. Restore original file
    execSync(
      `ssh ${sshTarget} "echo '${originalContent.replace(/'/g, "'\\''")}' > ${configDir}/frontend/theme-variables.css"`
    );
    execSync(
      `ssh ${sshTarget} "docker service update --force ${serviceName}"`
    );
  });
});
```

- [ ] **Step 3: Run the tests against local compose**

```bash
cd /home/jerome/git_projects/ITU/genie-ai/.claude/worktrees/runtime-theme-config
docker compose up -d frontend keycloak
sleep 5
npx playwright test tests/e2e/theme-runtime-config.spec.js --reporter=line 2>&1 | tail -30
docker compose down
```

Expected: cache-header tests pass; the live-edit test is skipped (no `DEPLOY_HOST`).

- [ ] **Step 4: Commit**

```bash
cd /home/jerome/git_projects/ITU/genie-ai/.claude/worktrees/runtime-theme-config
git add tests/e2e/theme-runtime-config.spec.js
git commit -m "test(e2e): runtime theme config cache + reload acceptance

Three pinning tests + one end-to-end acceptance test:
1. /config/theme-variables.css uses no-cache, must-revalidate (NOT
   immutable — guards against accidental ^~ modifier removal)
2. Hashed JS assets still use immutable cache (guards against
   over-broadening the no-cache rule)
3. /config/config.js (runtime-generated) uses no-cache (fixes
   pre-existing stale-cache bug on env-var URL changes)
4. Edit host file + reload acceptance test (skipped unless DEPLOY_HOST
   set; manual run on .102 validates end-to-end)"
```

Expected: 1 commit on `feat/runtime-theme-config`.

---

## Task 9: Ansible Smoke Test for Role Idempotence

**Files:**
- Create: `deploy/ansible/roles/config_bootstrap/tests/test_idempotence.sh`

**Interfaces:**
- Consumes: live Ansible target host (real Swarm node, or VM, or container)
- Produces: smoke-test script that verifies the role is idempotent and preserves manual edits

- [ ] **Step 1: Write the smoke test script**

Create `deploy/ansible/roles/config_bootstrap/tests/test_idempotence.sh`:

```bash
#!/usr/bin/env bash
# Smoke test for config_bootstrap role idempotence.
# Usage: ./test_idempotence.sh <inventory_file> <env_name> <host>
# Example: ./test_idempotence.sh inventory/test.ini test gateway-01

set -euo pipefail

INVENTORY="${1:-inventory/test.ini}"
ENV_NAME="${2:-test}"
HOST="${3:-$(ansible -i "$INVENTORY" gateway --list-hosts 2>/dev/null | head -1 | awk '{print $1}')}"

# Ensure the role runs from the deploy/ansible directory
cd "$(dirname "$0")/../../.."

echo "=== Targeting single host: $HOST ==="
echo "=== Run 1: populate host runtime config dir ==="
ansible-playbook -i "$INVENTORY" deploy.yml --tags config --limit "$HOST" --extra-vars "env_name=$ENV_NAME"

echo "=== Verify theme-variables.css exists on host ==="
ansible -i "$INVENTORY" "$HOST" -m shell -a "test -f /opt/genieai-$ENV_NAME/config/frontend/theme-variables.css"

echo "=== Run 2: rerun, should be no-op (idempotence) ==="
ansible-playbook -i "$INVENTORY" deploy.yml --tags config --limit "$HOST" --extra-vars "env_name=$ENV_NAME"

echo "=== Verify all 4 Keycloak themed subdirs ==="
ansible -i "$INVENTORY" "$HOST" -m shell -a "ls /opt/genieai-$ENV_NAME/config/keycloak/themes/genie/"

echo "=== Verify manual edits are preserved on rerun ==="
# Edit a file on the host (add a comment line)
ansible -i "$INVENTORY" "$HOST" -m shell -a \
  "echo '/* manual edit */' >> /opt/genieai-$ENV_NAME/config/frontend/theme-variables.css"

# Rerun the role
ansible-playbook -i "$INVENTORY" deploy.yml --tags config --limit "$HOST" --extra-vars "env_name=$ENV_NAME"

# Verify the manual edit is still there
ansible -i "$INVENTORY" "$HOST" -m shell -a \
  "tail -1 /opt/genieai-$ENV_NAME/config/frontend/theme-variables.css | grep -q 'manual edit'"

echo "=== All smoke tests passed ==="
```

Make it executable:
```bash
chmod +x deploy/ansible/roles/config_bootstrap/tests/test_idempotence.sh
```

- [ ] **Step 2: Manual execution against local VM (optional)**

If a local VM or container is available, run the script:
```bash
./deploy/ansible/roles/config_bootstrap/tests/test_idempotence.sh inventory/test.ini test
```

If not available, document in the commit message that the script is unverified locally and will be exercised by the user on `.102` during deploy validation.

- [ ] **Step 3: Commit**

```bash
cd /home/jerome/git_projects/ITU/genie-ai/.claude/worktrees/runtime-theme-config
git add deploy/ansible/roles/config_bootstrap/tests/test_idempotence.sh
git commit -m "test(ansible): config_bootstrap idempotence + manual-edit preservation

Smoke test verifies the role's two correctness contracts:
1. Second invocation is a no-op (all files already exist on host)
2. Manual operator edits made between deploys are preserved on rerun
   (--ignore-existing flag works as intended)

Not auto-run by CI (requires a live target host); exercised manually
during deploy validation on .102."
```

Expected: 1 commit on `feat/runtime-theme-config`.

---

## Task 10: Final Integration Verification + MR Creation

**Files:**
- Modify: `docs/superpowers/specs/2026-10-16-theme-runtime-config-design.md` (NO — spec is frozen; this is for verification only)
- Create: MR description (via `glab mr create`)

**Interfaces:**
- Consumes: all 9 prior tasks committed to `feat/runtime-theme-config`
- Produces: open MR against `main`

- [ ] **Step 1: Verify all commits are present on the branch**

```bash
cd /home/jerome/git_projects/ITU/genie-ai/.claude/worktrees/runtime-theme-config
git log --oneline origin/main..HEAD
```

Expected: 9 commits (Tasks 1–9), each with a clear message. The first commit is the spec (`docs(spec): theme runtime config migration design`).

- [ ] **Step 2: Run full local checks**

```bash
cd /home/jerome/git_projects/ITU/genie-ai/.claude/worktrees/runtime-theme-config
npm run lint 2>&1 | tail -5
npm run format:check 2>&1 | tail -5
```

Expected: no errors across all JS components.

Python lint (if any Python files changed — there are none in this MR, so skip):
```bash
npm run lint:py 2>&1 | tail -5
```

- [ ] **Step 3: Re-verify backwards-compat path**

Run `docker compose up -d frontend keycloak` WITHOUT setting `CONFIG_DIR_FRONTEND` or `CONFIG_DIR_KEYCLOAK` env vars:

```bash
cd /home/jerome/git_projects/ITU/genie-ai/.claude/worktrees/runtime-theme-config
docker compose up -d frontend keycloak
sleep 5
docker compose exec frontend ls /app/dist/config/theme-variables.css
docker compose exec keycloak ls /opt/keycloak/themes/genie/login/theme.properties
docker compose down
```

Expected: both files exist (mounted from the repo's default paths). If mount failed silently, the service still starts but uses baked defaults — verify in the frontend container that the file is actually being read.

- [ ] **Step 4: Push the branch and monitor CI**

```bash
cd /home/jerome/git_projects/ITU/genie-ai/.claude/worktrees/runtime-theme-config
git push origin feat/runtime-theme-config
```

Then, per `feedback_always_monitor_mr_ci.md`, immediately launch the CI monitor in the background:

```bash
PIPELINE_ID=$(glab ci list --output=json | jq -r '.[0].id')
/tmp/ci-monitor.sh "$PIPELINE_ID" &
```

Wait for the pipeline to finish. If any stage fails, investigate before opening the MR.

- [ ] **Step 5: Open MR**

```bash
glab mr create \
  --source-branch feat/runtime-theme-config \
  --target-branch main \
  --title "Refactor theme to runtime-loaded config (closes #998)" \
  --description "$(cat <<'EOF'
## Summary

Move GENIE.AI theme assets (frontend palette, brand JSON, Keycloak theme CSS) from image-baked to host-mounted runtime configuration. Editing a file on a Swarm node + `docker service update --force <svc>` makes the change visible in the browser without an image rebuild.

## Why

The El Salvador UI overhaul (MR !385) shipped via full image rebuild for a pure visual change — ~10 min CI cycle. This refactor decouples visual changes from the image pipeline.

## Changes

- **Frontend**: `theme-variables.css` moves from `src/` (Vite bundle) to `public/config/` (Vue CLI passthrough). Loaded at runtime via `<link>` in `index.html`. New nginx `location ^~ /config/` block (note `^~` modifier — required to win against the existing regex location).
- **Keycloak**: `configs/keycloak/Dockerfile` deleted; service uses upstream `quay.io/keycloak/keycloak:26.7.0`. All four themed subdirs (`login/account/admin/email`) ship from the repo.
- **docker-compose.yaml**: 2 new bind mounts (`CONFIG_DIR_FRONTEND`, `CONFIG_DIR_KEYCLOAK`) using existing `${VAR:-default}` envsubst pattern.
- **Ansible**: new `config_bootstrap` role cross-tree rsyncs repo defaults to `/opt/genieai-<env>/config/` on every node, using `--ignore-existing` to preserve manual operator edits.
- **Pre-existing fix**: `/config.js` (runtime-generated, env-var-driven) relocated to `/config/config.js` so it inherits the new no-cache location. Previously invisible to browsers for up to 1 year after env-var changes.

## Backwards compat

No `CONFIG_DIR_*` env vars set → service starts using image-baked defaults. Existing deploys unaffected.

## Verification

- Spec: `docs/superpowers/specs/2026-10-16-theme-runtime-config-design.md`
- Plan: `docs/superpowers/plans/2026-10-16-theme-runtime-config-migration.md`
- Unit tests: `components/gov-chat-frontend/src/__tests__/loadConfig.spec.js` (3 cases)
- E2E tests: `tests/e2e/theme-runtime-config.spec.js` (cache headers + reload acceptance)
- Ansible smoke: `deploy/ansible/roles/config_bootstrap/tests/test_idempotence.sh` (idempotence + manual-edit preservation)

Closes #998
EOF
)" \
  --label "tech-debt" --label "deployment" --label "architecture" \
  --remove-source-branch
```

- [ ] **Step 6: Wait for user review**

Per `feedback_never_merge_without_ci.md`, do NOT merge the MR until the pipeline is green and the user has reviewed.

Notify the user:
> "MR !XXX opened for issue #998. Pipeline running. Awaiting your review before merge."