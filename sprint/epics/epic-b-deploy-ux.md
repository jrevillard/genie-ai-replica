# Epic B — Deploy UX (certs, preflight, single-source-of-truth, users)

Pain sources: stale-cert trap, no domain decision point, CHANGE_ME passes asserts, models/configs
in 5 places with 3 values, dead `genie_admin_*` secrets, undocumented user lifecycle.
Audit evidence: `_bmad-output/planning-artifacts/audit-vm-commits-2026-09.md` + sprint design session.

## B1 — cert_mode decision point
One var `cert_mode: letsencrypt | provided | selfsigned` replacing orthogonal flags.
Preflight asserts: letsencrypt → FQDN + certbot_email set (else loud fail, no silent retry-burn);
provided → files exist (fix `group_names[0]` cert-path bug: resolve per-inventory env group);
selfsigned → allowed dev-only (prod inventory refuses); ANY mode → existing `server.crt`
CN/SAN must match `nginx_public_domain` else fail with "delete secrets/ssl/server.* or update
domain" (kills the stale-cert trap); container nginx entrypoint fallback cert: add SAN +
CN=$NGINX_PUBLIC_DOMAIN or remove it — one generator only; gpu: `gpu_self_signed_certs` →
require `opea_ssl_skip_verify="1"` when `gpu_node_host` set. Post-deploy smoke hits
`https://{{ nginx_public_domain }}` (validate_certs only in selfsigned).
**Files:** deploy.yml, group_vars/all.yml, templates/env.j2, tasks/preflight-cert.yml (new),
api-gateway-solution/nginx/entrypoint.sh. **Gate:** syntax ×3 + --check dry-run + negative
assert tests. **DECIDE:** DEC-1 gates B1 and all of D.

## B2 — Preflight coherence play
`tasks/preflight.yml` runs first in deploy.yml/deploy-gpu.yml: assert no CHANGE_ME/FILL-IN in
required vars (loop a required-var list, name each offender); coherence: cert rules (B1),
observability=1 → grafana secrets real, gpu_node_host → opea_ssl_skip_verify, swarm mode →
repo_url + registry token real, deploy_mode enum; deployment-plan printout (mode, domain,
cert_mode, models, profiles) + confirm gate (`--extra-vars confirm=yes`) when domain ≠ localhost.
**AC:** planted bad var → abort naming var+file; clean vars → pass <10s; plan block matches
rendered env. **Gate:** dry-run both modes + red-team workflow (agents plant bad vars — all
caught). **DECIDE:** none (values themselves are DEC-9/DEC-10).

## B3 — Single source of truth
Models named once in group_vars/all.yml → env.j2 → compose reads env (kill compose-side
disagreeing defaults: chat model Llama vs granite, contextual-retrieval true vs documented
false, TEI concurrency 128 vs 8); wire or delete dead image vars (`vllm_llm_image` etc. —
env.j2 emits nothing today); derive vue_app_api_url/csp/cors/keycloak origin from
`nginx_public_domain` (computed vars — no hand-copies per env); delete dead
`genie_admin_*` asserts + emissions (replaced by realm admin user in A2), dead
`KEYCLOAK_VALID_REDIRECT_URIS`/`KEYCLOAK_WEB_ORIGINS`, dead `genie-ai-keycloak-config`/
`genie-ai-postgres-init` entries in deploy-shared-facts (A2 restores keycloak-config properly);
root `env`/`env-T4` deleted (S2e cleanup completes here).
**AC:** one model-var change renders everywhere (render-diff check); `grep -rn genie_admin
deploy/` = 0; no localhost hand-copies in group_vars.
**Gate:** env render both modes + compose config + overlay pytest. **DECIDE:** DEC-9 (values).

## B4 — docs/users.md
One page: how users come to exist (self-register → Pending → admin approves via
`POST /api/admin/users/:id/approve` → roles via Keycloak console (realm roles = source of
truth post-A6) → Grafana mapping; admin bootstrap = realm admin user (A2); approval emails
need EMAIL_* set; keycloak admin console at `/auth/admin/`.
**AC:** a new deployer follows it step-by-step with no guesswork; matches A6 behavior.
**Gate:** walkthrough against running compose. **DECIDE:** DEC-3.

## B5 — rtx6000 vars hygiene + deploy-gpu parity
`vllm_gpu_util` → `vllm_gpu_utilization` (the 0.85-vs-0.55 bug); `keycloak_public_key` var
removed (dead post-A5); `swarm_registry_url` comment fixed (env.j2 uses it unconditionally —
set "" or real); stale `# FILL IN` inventory header removed; `.gitignore` duplicate
`.vault-pass-*` line removed; port deploy.yml's NVIDIA legacy-list removal hunk to
deploy-gpu.yml.
**AC:** diff deploy.yml vs deploy-gpu.yml NVIDIA blocks identical modulo gpu bits; single
spelling of the gpu-util var; `grep -r "FILL IN" deploy/ansible/inventory/` = 0.
**Gate:** ansible syntax ×3 + dry-run. **DECIDE:** none.
