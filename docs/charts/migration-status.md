# Helm Migration — Status

Single-page map of the migration effort: which plans shipped, which were
superseded, what remains. Companion to `plan-defects.md` (review ledger) and
the design spec (`docs/superpowers/specs/2026-10-08-genie-ai-helm-charts-design.md`).
Plan checkboxes are not a status source — evidence is the chart, the deploy
repo, the cluster, and the SDD ledgers under `.superpowers/sdd/`.

## Current state (2026-10-15)

- Chart `genieai-umbrella` at **0.1.66** on `feat/k8s-migration`; deployed on
  the laptop minikube via Flux from `genie-ai-deploy` (`overlays/jrevillard-laptop/dev`).
- Full stack validated end-to-end live: OIDC login (PKCE, pinned issuer) →
  chat stream → chatqna → retriever → LLM on the external GPU node
  (10.0.0.110) → streamed FR translation → document upload → ClamAV scan →
  dataprep ingestion (contextual retrieval + labeling + embeddings, 109
  chunks) → RAG answers with citations.
- GPU tier is a binary choice: `opea.gpu.mode=external` (remote OpenAI-compatible
  API) or `in-cluster` (model Deployments behind `gpu=true` nodeSelector).
  Laptop runs external; in-cluster is render-validated only (no GPU locally).

## Plan map

| Plan | Artifact | Status |
|---|---|---|
| 1 — foundation | `2026-10-08-genie-ai-helm-charts-foundation.md` | ✅ shipped |
| 2 — data layer | `…-data-layer.md` | ✅ shipped (Arango, CNPG, Keycloak CRs live) |
| 3 — service tier (group 5) | `…-service-tier-group5.md` | ✅ shipped |
| keycloak v2beta1 rework | `2026-10-12-keycloak-v2beta1-chart-rework.md` | ↩️ superseded by the convergence plan |
| keycloak config convergence | `2026-10-13-keycloak-config-convergence.md` | ✅ shipped (realm converged via kcc job) |
| installable Phase 1 (app contract) | `2026-10-13-chart-installable-phase1.md` | ✅ shipped (chart 0.1.30 Ready; secrets surface, per-image securityContext, nginx `/auth/`, issuer pin, migrations job, dev-secrets) |
| 5 — AI/ML tier | `…-ai-ml.md` | ↩️ superseded by the OPEA-tier plan |
| OPEA tier (Phase 3) | `2026-10-15-opea-tier.md` | ✅ shipped (six orchestrators, four in-cluster model templates, NetworkPolicies, endpoint helpers; final review pass integrated at 0.1.61) |
| deploy repo | `…-deploy-repo.md` | ✅ shipped (`genie-ai-deploy`, Flux, per-laptop overlay) |
| 7 — CI | `…-ci.md` | 🟡 partial (`chart:lint` + `chart:install` jobs exist; no `chart:contract` gate, no ct full suite, no kind+Calico install gate) |
| 8 — docs | `…-docs.md` | 🟡 partial (`charts/README.md`; per-env overlay docs not written) |
| 4 — observability | `2026-10-15-observability-tier.md` | ✅ shipped (charts 0.2.0–0.2.20: VLSingle baseline + collector gateway + filelog agent + Grafana CRs + VMServiceScrapes; live-validated on the laptop — admin logs 200, PII smoke green on the chart-rendered config; 0.2.20 scopes the filelog agent to the stack namespaces after foreign-ns zap-JSON rows broke the admin TYPE column; metrics/traces/grafana opt-in flags are render-validated only) |
| 6 — per-env ingress | `…-per-env-ingress.md` | ⬜ Task 1 only → the "Phase 2" below |

## Supersessions (why two plans were replaced)

- **keycloak-v2beta1 rework → convergence (2026-10-13):** the rework planned a
  client-CR-based GitOps surface (`KeycloakOIDCClient` × N). Research showed
  realm-level settings still needed an imperative pass; the convergence plan
  ships a post-install kcc job that pins the issuer/origin/policies and
  leaves clients to the realm import. Simpler, validated live.
- **ai-ml → OPEA tier (2026-10-15):** the original plan modeled the AI tier as
  chart-internal `ai.*` services. The shipped design keeps the compose
  topology (six OPEA orchestrators) with the GPU backend as a binary external/
  in-cluster choice — one template set, two endpoint worlds.

## Remaining phases

1. **Merge `feat/k8s-migration` → main** (MR open; description to be reworked
   to cover the whole branch). Post-merge: unpin the doc-repo
   `feat-k8s-migration` image tag in the laptop overlay (source fixes ride the
   branch: `KEYCLOAK_EXPECTED_ISSUER`, ClamAV host forwarding, backend
   `OPEA_HOST` default, streaming translation default-on).
2. **Global code review of the whole MR** (running 2026-10-15) — findings
   triaged and fixed before any new tier lands on the branch.
3. **Documentation pass** (pre-merge, after review fixes):
   - `site/content/en/docs/deploy/` — new Kubernetes deployment page (chart,
     Flux, overlays, GPU modes external/in-cluster) alongside the
     compose/swarm pages.
   - `charts/README.md` + `charts/genieai-umbrella/README.md` — refresh
     against 0.1.66 (values surface, `_lib` helpers, model skeleton).
   - Root `CLAUDE.md` — helm/flux/kubectl essentials in Common Commands,
     chart + deploy-repo layers in Architecture, Helm/Flux in the stack
     table, `charts/` in Key Directories.
   - `.claude/rules/K8s-WORKFLOW.md` (new) — cluster access patterns
     (namespace, port-forwards), the `rtk proxy helm` output trap, the
     byte-compare render gate, the chart-push → overlay-bump → flux
     reconcile cycle.
   - genie-ai-deploy README — overlay/SealedSecret model if missing.
4. **Observability** — ✅ shipped 2026-10-15 (chart 0.2.17, commit range
   `a32c922ae..` incl. hotfixes): admin logs UI 200 with live rows, service
   filter functional, PII smoke green against the chart-rendered gateway
   config. Residuals: whole-tier adversarial review pending; VT OTLP port
   unverified until traces enabled somewhere; `${p}`/`${s}` OTTL
   capture-group refs are eaten by confmap in collector 0.152 (replacement
   drops boundary chars) — same latent behavior in the compose config, kept
   verbatim; backlog.
5. **Ingress (Phase 2)** — Gateway API (`Gateway` + `HTTPRoute`) + cert-manager,
   nginx stays the in-cluster aggregator; tighten the placeholder
   NetworkPolicy peers (`podSelector: {}`, broad `ipBlock`) once the gateway
   data-plane labels exist; kind+Calico CI gate for the policy surface.
6. **CI completion** — `chart:contract` render-gate job (MUST: render chart
   with overlay-shaped values, extract the gateway collector config, run
   `PII_SMOKE_CONFIG=<rendered> tests/otel-collector/run-pii-smoke.sh` — the
   PII OTTL now lives in the chart helper, a second copy of the compose
   regex that WILL drift without this gate — and assert operator Service
   names `<kind>-<cr-name>` in every rendered URL), `ct lint`/`ct install`
   on kind (kind prereqs now include cert-manager/vmoperator/otel-operator
   via `scripts/install-prereqs.sh`), dashboards for chart test results.

## Parked / backlog

- OPEA images hardcode tag `main` in templates → lift to values when
  branch-tagged images are needed (laptop uses registry `main` today).
- Translation orchestrator image `docker.io/opea/translation:1.3` hardcoded;
  document or expose as a value.
- `otlpEndpoint` helper assumes the OTel-operator `<cr>-collector` Service
  naming; sites without the operator need a `collectorService` override.
- GPU egress NetworkPolicies use broad `ipBlock 0.0.0.0/0` on 443/444; derive
  the port/host from the nodeHost URL when tightened.
- SealedSecrets consolidation in the deploy repo (nine single-key secrets →
  one); dead `secrets.sops.yaml` template cleanup; arango RBAC leftovers in
  `namespace.yaml`.
- In-cluster `docling` endpoint resolves to a Service the chart does not
  render (no docling model template); in-cluster mode needs either the
  Deployment or a fail-fast guard.
- Issue #1064 (compose-side ClamAV dual-mode + env mismatch) — the k8s side
  is fixed here; the image/compose side stays open upstream of this branch.
- Dataprep vendored `llm_transformer` (sync langchain in `to_thread`) has no
  effective request timeout; long ingestions can pin threads on a stalled
  upstream (observed once against the shared GPU node; pod restart recovered).
